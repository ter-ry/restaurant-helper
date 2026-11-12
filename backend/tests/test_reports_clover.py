"""Clover-sourced Owner Reports acceptance (#262, owner-approved Option B).

Fixed cafe day 2026-08-30 in America/Toronto (UTC-4). Every expected figure is hand-computed from the fixture amounts
(cents), not derived from production formulas.  Same day as the Daily Close suite so Reports and Daily Close can be
compared on identical data.

  O1 cash   1130 tax 130 tip 150 -> net 1000
  O2 card   2260 tax 260         -> net 2000
  O3 card    565 tax  65         -> net  500
  O4 card    113 tax  13, 23:59 local -> net 100
  outside the day: 2026-08-29 noon (7827 collected incl. tax 777 + tip 50) and 2026-08-31 00:00 local.
Day totals: net 36.00, tax 4.68, tips 1.50, collected 42.18, 4 orders.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import (
    CloverConnection,
    CloverLocationMapping,
    CloverShadowOrder,
    CloverShadowOrderLine,
    CloverShadowOrderLineInventoryConsumption,
    InventoryItem,
    RestaurantLocation,
    SquareConnection,
    SquareLocation,
    SquareLocationMapping,
    User,
)
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization

DAY = "2026-08-30"
NOON = datetime(2026, 8, 30, 16, 0, tzinfo=timezone.utc)
LATE = datetime(2026, 8, 31, 3, 59, tzinfo=timezone.utc)
NEXT_DAY = datetime(2026, 8, 31, 4, 0, tzinfo=timezone.utc)
PREVIOUS_DAY = datetime(2026, 8, 29, 16, 0, tzinfo=timezone.utc)
CASH = "com.clover.tender.cash"
CARD = "com.clover.tender.credit_card"
MODULES = ("PURCHASES", "INVENTORY", "REPORTING", "MENU_COSTING", "STOCK_COUNTS", "REORDER_PLANS", "SQUARE_INTEGRATION", "DAILY_CLOSE")


def _csrf(client) -> str:
    return client.get("/api/auth/csrf").get_json()["csrfToken"]


def _login(client):
    assert client.post("/api/auth/login", json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD}, headers={"X-CSRFToken": _csrf(client)}).status_code == 200


def _select(client, organization_id):
    assert client.post("/api/organizations/select", headers={"X-CSRFToken": _csrf(client)}, json={"organizationId": organization_id}).status_code == 200


def _select_location(client, location_id):
    return client.post("/api/locations/select", headers={"X-CSRFToken": _csrf(client)}, json={"locationId": location_id})


def _report(client, **params):
    params.setdefault("view", "daily")
    if params["view"] == "daily":
        params.setdefault("date", DAY)
    return client.get("/api/pilot/reports", query_string=params)


def _clover_cafe(name="Clover Reports Cafe", *, status="connected"):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    org = make_operational_organization(owner, name=f"{name} {uuid4().hex[:8]}", location_name="Queen St Cafe", enabled_modules=MODULES)
    location = RestaurantLocation.query.filter_by(organization_id=org.id).first()
    connection = CloverConnection(organization_id=org.id, environment="sandbox", merchant_id=f"m-{uuid4().hex[:6]}", status=status, access_token_ciphertext="x")
    db.session.add(connection)
    db.session.flush()
    db.session.add(CloverLocationMapping(clover_connection_id=connection.id, organization_id=org.id, restaurant_location_id=location.id, clover_merchant_id=connection.merchant_id))
    db.session.commit()
    return org, location, connection


def _pay(amount, tax, tip=None, tender=CARD):
    return {"id": f"p-{uuid4().hex[:6]}", "amount": amount, "result": "SUCCESS", "taxAmount": tax, "tipAmount": tip, "tender": tender}


def _order(org, location, connection, payments, *, closed=NOON, status="paid", review=False, raw=None):
    order = CloverShadowOrder(
        organization_id=org.id, clover_connection_id=connection.id, restaurant_location_id=location.id, clover_merchant_id=connection.merchant_id,
        clover_order_id=f"o-{uuid4().hex[:8]}", normalized_status=status, requires_review=review, source_closed_at=closed,
        raw_payload_json={"payments": payments, **(raw or {})},
    )
    db.session.add(order)
    db.session.flush()
    return order


def _seed_day(org, location, connection):
    o1 = _order(org, location, connection, [_pay(1130, 130, 150, CASH)])
    _order(org, location, connection, [_pay(2260, 260)])
    _order(org, location, connection, [_pay(565, 65)])
    _order(org, location, connection, [_pay(113, 13)], closed=LATE)
    _order(org, location, connection, [_pay(9999, 999)], closed=NEXT_DAY)
    _order(org, location, connection, [_pay(7777, 777, 50, CASH)], closed=PREVIOUS_DAY)
    db.session.commit()
    return o1


def _item(org, location, name="Chicken", unit="kg", cost="8"):
    item = InventoryItem(organization_id=org.id, location_id=location.id, name=name, normalized_name=f"{name}-{uuid4().hex[:6]}", stock_unit=unit, current_on_hand=Decimal("10"), average_unit_cost=Decimal(cost))
    db.session.add(item)
    db.session.flush()
    return item


def _line(org, location, order, item, quantity="0.5000", *, ledger=True, mapping="mapped", name="Chicken Plate", sold="2"):
    line = CloverShadowOrderLine(
        organization_id=org.id, restaurant_location_id=location.id, shadow_order_id=order.id, clover_line_item_id=f"l-{uuid4().hex[:6]}", clover_item_id="i",
        name=name, quantity=Decimal(sold), mapping_status=mapping,
        recipe_preview_json={"flowtallyMenuItemName": name, "ingredients": [{"inventoryItemId": item.id, "quantity": quantity, "unit": item.stock_unit, "name": item.name}]},
    )
    db.session.add(line)
    db.session.flush()
    if ledger:
        db.session.add(CloverShadowOrderLineInventoryConsumption(organization_id=org.id, location_id=location.id, clover_shadow_order_line_id=line.id, inventory_item_id=item.id, applied_quantity=-Decimal(quantity), unit_cost_snapshot=item.average_unit_cost))
    db.session.flush()
    return line


@pytest.fixture()
def cafe(app, client, monkeypatch):
    """A Clover-only cafe. Any Square call from a Clover location's report fails the test."""
    def boom(*args, **kwargs):
        raise AssertionError("Square was called while building a Clover location's report")

    monkeypatch.setattr("backend.square_integration._build_square_usage_report", boom)
    _login(client)
    org, location, connection = _clover_cafe()
    _select(client, org.id)
    return org, location, connection


def test_daily_report_shows_exact_clover_figures_and_excludes_other_days(cafe, client):
    org, location, connection = cafe
    _seed_day(org, location, connection)
    body = _report(client).get_json()
    sales = body["sales"]
    assert body["provider"] == "clover" and sales["source"] == "clover_orders" and sales["provider"] == "clover"
    assert (sales["status"], sales["available"], sales["unavailableReason"]) == ("available", True, None)
    assert (sales["orderCount"], sales["netItemSales"], sales["tax"], sales["tips"], sales["totalCollected"]) == (4, 36.0, 4.68, 1.5, 42.18)
    # Not derivable from Clover evidence: unavailable, never zero.
    assert sales["grossItemSales"] is None and sales["discounts"] is None and sales["refunds"] is None
    assert body["period"]["startDate"] == body["period"]["endDate"] == DAY
    assert body["usageVariance"]["valid"] is False and body["changes"] is None


def test_reports_agree_with_daily_close_on_the_same_data(cafe, client):
    org, location, connection = cafe
    _seed_day(org, location, connection)
    close = client.get("/api/pilot/daily-close", query_string={"locationId": location.id, "businessDate": DAY}).get_json()["snapshot"]["sales"]
    sales = _report(client).get_json()["sales"]
    assert (sales["orderCount"], sales["netItemSales"], sales["tax"], sales["tips"]) == (close["orders"], close["netSales"], close["tax"], close["tips"])


def test_a_day_with_no_stored_orders_is_unavailable_never_a_confident_zero(cafe, client):
    body = _report(client).get_json()
    sales = body["sales"]
    assert sales["status"] == "unavailable" and sales["available"] is False
    assert sales["netItemSales"] is None and sales["totalCollected"] is None and sales["tax"] is None and sales["tips"] is None
    assert sales["source"] == "clover_orders" and "No verified paid Clover orders" in sales["unavailableReason"]
    assert body["costing"]["estimatedFoodCostPercent"] is None


def test_only_cancelled_or_unpaid_orders_are_not_a_confident_zero(cafe, client):
    org, location, connection = cafe
    _order(org, location, connection, [], status="cancelled")
    _order(org, location, connection, [], status="pending")
    db.session.commit()
    sales = _report(client).get_json()["sales"]
    assert sales["status"] == "unavailable" and sales["totalCollected"] is None and sales["netItemSales"] is None
    assert "2 cancelled or unpaid" in sales["unavailableReason"]


@pytest.mark.parametrize("raw,review", [({"refunds": [{"id": "r1", "amount": 500}]}, False), ({"incomplete": True}, False), ({}, True)])
def test_an_excluded_order_makes_headline_money_unavailable_but_keeps_verified_subtotal(cafe, client, raw, review):
    org, location, connection = cafe
    _seed_day(org, location, connection)
    _order(org, location, connection, [_pay(1000, 100)], raw=raw, review=review)
    db.session.commit()
    body = _report(client).get_json()
    sales = body["sales"]
    assert sales["status"] == "partial" and sales["available"] is False
    assert sales["netItemSales"] is None and sales["totalCollected"] is None and sales["tax"] is None and sales["tips"] is None
    assert sales["excludedOrderCount"] == 1
    assert sales["verified"] == {"orderCount": 4, "netItemSales": 36.0, "tax": 4.68, "tips": 1.5}
    assert any(e["type"] == "clover_sales_exceptions" for e in body["exceptions"])
    assert body["costing"]["estimatedFoodCostPercent"] is None


def test_a_refunded_order_is_counted_not_netted_and_refund_amount_stays_unavailable(cafe, client):
    org, location, connection = cafe
    _seed_day(org, location, connection)
    _order(org, location, connection, [_pay(1000, 100)], status="refunded", review=True, raw={"refunds": [{"id": "r1", "amount": 1000}]})
    db.session.commit()
    sales = _report(client).get_json()["sales"]
    assert sales["refundOrderCount"] == 1 and sales["refunds"] is None
    assert sales["status"] == "partial" and sales["totalCollected"] is None


def test_missing_tax_breakdown_never_shows_gross_as_net(cafe, client):
    org, location, connection = cafe
    _order(org, location, connection, [{"id": "p1", "amount": 1130, "result": "SUCCESS", "tender": CARD}])
    db.session.commit()
    sales = _report(client).get_json()["sales"]
    assert sales["status"] == "unavailable" and sales["netItemSales"] is None and sales["totalCollected"] is None
    assert "tax breakdown" in sales["unavailableReason"]


def test_food_cost_and_item_sales_come_from_the_signed_ledger(cafe, client):
    org, location, connection = cafe
    o1 = _seed_day(org, location, connection)
    chicken = _item(org, location, "Chicken", "kg", "8")
    _line(org, location, o1, chicken, "0.5000", sold="2")
    db.session.commit()
    body = _report(client).get_json()
    # 0.5 kg x $8 = $4.00 of usage against $36.00 net = 11.11%.
    assert body["costing"]["estimatedFoodCostPercent"] == 11.11 and body["costing"]["usageCost"] == 4.0 and body["costing"]["usageAvailable"] is True
    assert body["sales"]["unitsSold"] == 2.0
    assert [(r["name"], r["quantity"], r["netAmount"]) for r in body["sales"]["byMenuItem"]] == [("Chicken Plate", 2.0, None)]
    assert body["usageVariance"]["theoreticalUsage"] == [{"inventoryItemId": chicken.id, "itemName": "Chicken", "unit": "kg", "quantity": 0.5, "costCents": 400}]


def test_unapplied_or_unmapped_usage_makes_food_cost_and_items_unavailable_but_keeps_sales(cafe, client):
    org, location, connection = cafe
    o1 = _seed_day(org, location, connection)
    chicken = _item(org, location, "Chicken", "kg", "8")
    _line(org, location, o1, chicken, "0.5000", ledger=False)
    _line(org, location, o1, chicken, "0.5000", mapping="unmapped", name="Mystery Special")
    db.session.commit()
    body = _report(client).get_json()
    assert body["sales"]["totalCollected"] == 42.18
    assert body["costing"]["estimatedFoodCostPercent"] is None and body["costing"]["usageCost"] is None and body["costing"]["usageAvailable"] is False
    assert body["sales"]["unitsSold"] is None and body["sales"]["byMenuItem"] == [] and body["sales"]["byMenuItemUnavailableReason"]
    assert body["usageVariance"]["theoreticalUsage"] == []
    types = {e["type"] for e in body["exceptions"]}
    assert {"unmapped_clover_sales", "clover_usage_unavailable"} <= types


def test_weekly_report_compares_with_the_prior_window_from_clover_orders(cafe, client):
    org, location, connection = cafe
    _seed_day(org, location, connection)
    body = _report(client, view="weekly", startDate=DAY, endDate=DAY).get_json()
    assert (body["period"]["priorStartDate"], body["period"]["priorEndDate"]) == ("2026-08-29", "2026-08-29")
    # Prior day: 7777 collected + 50 tip = 78.27.  Current 42.18.  Delta -36.09 = -46.11%.
    sales = body["changes"]["sales"]
    assert (sales["current"], sales["prior"], sales["delta"]) == (42.18, 78.27, -36.09)
    assert sales["percent"] == pytest.approx(-46.11, abs=0.01)
    assert body["changes"]["orders"]["current"] == 4 and body["changes"]["orders"]["prior"] == 1


def test_weekly_comparison_is_withheld_when_either_window_is_unverified(cafe, client):
    org, location, connection = cafe
    _seed_day(org, location, connection)
    _order(org, location, connection, [_pay(500, 50)], closed=PREVIOUS_DAY, raw={"refunds": [{"id": "r"}]})
    db.session.commit()
    body = _report(client, view="weekly", startDate=DAY, endDate=DAY).get_json()
    assert body["sales"]["totalCollected"] == 42.18
    assert body["changes"]["sales"] is None and body["changes"]["orders"] is None


def test_an_overlong_window_is_unavailable_rather_than_slow_or_partial(cafe, client):
    org, location, connection = cafe
    _seed_day(org, location, connection)
    body = _report(client, view="weekly", startDate="2026-01-01", endDate=DAY).get_json()
    assert body["sales"]["status"] == "unavailable" and body["sales"]["totalCollected"] is None and "62 days" in body["sales"]["unavailableReason"]


def test_clover_tenant_and_location_isolation(cafe, client):
    org, location, connection = cafe
    _seed_day(org, location, connection)
    other_org, other_location, other_connection = _clover_cafe("Other Clover Cafe")
    _order(other_org, other_location, other_connection, [_pay(500000, 50000, 0, CASH)])
    second = RestaurantLocation(organization_id=org.id, name="Second Site", timezone="America/Toronto")
    db.session.add(second)
    db.session.flush()
    _order(org, second, connection, [_pay(80000, 8000, 0, CASH)])
    db.session.commit()
    assert _report(client).get_json()["sales"]["totalCollected"] == 42.18
    # The second site of the same organization is not mapped to Clover: it must not borrow the first site's orders.
    assert _select_location(client, second.id).status_code == 200
    other_site = _report(client).get_json()
    assert other_site["scope"]["locationId"] == second.id
    assert other_site["sales"]["source"] == "square_orders" and other_site["sales"]["totalCollected"] == 0.0  # existing no-provider behaviour, never Clover money
    # The other organization (same owner, so selectable) sees only its own order, never this cafe's.
    _select(client, other_org.id)
    other = _report(client).get_json()["sales"]
    assert (other["orderCount"], other["netItemSales"], other["tax"], other["totalCollected"]) == (1, 4500.0, 500.0, 5000.0)


def test_square_locations_keep_the_square_report_byte_for_byte(app, client, monkeypatch):
    """Square active (even with a leftover Clover mapping) or no provider: the Square-sourced shape is unchanged."""
    _login(client)
    org, location, clover = _clover_cafe("Mixed")
    square = SquareConnection(organization_id=org.id, environment="sandbox", square_merchant_id=f"sq-{uuid4().hex[:6]}", status="connected", sync_status="idle", last_sync_at=NOON)
    db.session.add(square)
    db.session.flush()
    sq_location = SquareLocation(square_connection_id=square.id, square_location_id="LOC-A", name="A", status="ACTIVE", raw_payload_json={})
    db.session.add(sq_location)
    db.session.flush()
    db.session.add(SquareLocationMapping(square_location_id=sq_location.id, restaurant_location_id=location.id))
    _order(org, location, clover, [_pay(1130, 130, 150, CASH)])
    db.session.commit()
    _select(client, org.id)
    both = _report(client).get_json()
    assert both["sales"]["source"] == "square_orders" and "provider" not in both and "status" not in both["sales"]
    assert both["sales"]["orderCount"] == 0  # the Clover order is never mixed into Square figures

    clover.status = "disconnected"
    db.session.commit()
    assert _report(client).get_json()["sales"]["source"] == "square_orders"


def test_a_disconnected_clover_only_location_keeps_the_square_empty_state(app, client):
    _login(client)
    org, location, _ = _clover_cafe("Disconnected", status="disconnected")
    _select(client, org.id)
    body = _report(client).get_json()
    assert body["sales"]["source"] == "square_orders" and "provider" not in body
