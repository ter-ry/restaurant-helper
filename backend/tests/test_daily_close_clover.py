"""Clover Daily Close integration acceptance (#222, slice 4 of #213 / #167).

Fixed cafe day 2026-08-30 in America/Toronto (UTC-4): 04:00Z through 03:59:59Z the next day. Every expected figure is
hand-computed from the fixture amounts below (cents), not derived from production formulas. The Square baseline is
guarded separately by ``test_daily_close_square_golden.py`` and ``test_daily_close_acceptance.py``.

Fixture orders (amount includes tax; tip is separate; net = amount - tax):
  O1 cash   1130 tax 130 tip 150 -> net 1000, cash taken 1130 + 150 = 1280
  O2 card   2260 tax 260         -> net 2000
  O3 card    565 tax  65 (Delivery) -> net 500
  O4 card    113 tax  13, closed 23:59 local -> net 100
  outside the day: 2026-08-29 noon and 2026-08-31 00:00 local (04:00Z) must not count.
Day totals: net 3600, tax 468, tips 150, 4 orders, delivery 1 order / net 500, expected cash 1280.
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
    DailyCloseSession,
    InventoryItem,
    InventoryMovement,
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
LATE = datetime(2026, 8, 31, 3, 59, tzinfo=timezone.utc)  # 23:59 local, still the 30th
NEXT_DAY = datetime(2026, 8, 31, 4, 0, tzinfo=timezone.utc)  # 00:00 local on the 31st
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


def _post(client, path, body=None):
    return client.post(path, json=body or {}, headers={"X-CSRFToken": _csrf(client)})


def _patch(client, path, body):
    return client.patch(path, json=body, headers={"X-CSRFToken": _csrf(client)})


def _get(client, location_id):
    return client.get("/api/pilot/daily-close", query_string={"locationId": location_id, "businessDate": DAY})


def _open(client, location_id):
    response = _post(client, "/api/pilot/daily-close", {"locationId": location_id, "businessDate": DAY})
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _clover_cafe(name="Clover Cafe", *, connection_status="connected"):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    org = make_operational_organization(owner, name=f"{name} {uuid4().hex[:8]}", location_name="Queen St Cafe", enabled_modules=MODULES)
    location = RestaurantLocation.query.filter_by(organization_id=org.id).first()
    connection = CloverConnection(organization_id=org.id, environment="sandbox", merchant_id=f"m-{uuid4().hex[:6]}", status=connection_status, access_token_ciphertext="x")
    db.session.add(connection)
    db.session.flush()
    db.session.add(CloverLocationMapping(clover_connection_id=connection.id, organization_id=org.id, restaurant_location_id=location.id, clover_merchant_id=connection.merchant_id))
    db.session.commit()
    return org, location, connection


def _pay(amount, tax, tip=None, tender=CARD):
    return {"id": f"p-{uuid4().hex[:6]}", "amount": amount, "result": "SUCCESS", "taxAmount": tax, "tipAmount": tip, "tender": tender}


def _order(org, location, connection, payments, *, closed=NOON, status="paid", review=False, order_type="", raw=None):
    order = CloverShadowOrder(
        organization_id=org.id, clover_connection_id=connection.id, restaurant_location_id=location.id, clover_merchant_id=connection.merchant_id,
        clover_order_id=f"o-{uuid4().hex[:8]}", normalized_status=status, requires_review=review, source_closed_at=closed,
        raw_payload_json={"payments": payments, "orderType": order_type, **(raw or {})},
    )
    db.session.add(order)
    db.session.flush()
    return order


def _seed_day(org, location, connection):
    o1 = _order(org, location, connection, [_pay(1130, 130, 150, CASH)])
    _order(org, location, connection, [_pay(2260, 260)])
    _order(org, location, connection, [_pay(565, 65)], order_type="Delivery")
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


def _line(org, location, order, item, quantity="0.5000", *, ledger=True, mapping="mapped", name="Chicken Plate"):
    line = CloverShadowOrderLine(
        organization_id=org.id, restaurant_location_id=location.id, shadow_order_id=order.id, clover_line_item_id=f"l-{uuid4().hex[:6]}", clover_item_id="i",
        name=name, quantity=Decimal("2"), mapping_status=mapping,
        recipe_preview_json={"flowtallyMenuItemName": name, "ingredients": [{"inventoryItemId": item.id, "quantity": quantity, "unit": item.stock_unit, "name": item.name}]},
    )
    db.session.add(line)
    db.session.flush()
    if ledger:
        db.session.add(CloverShadowOrderLineInventoryConsumption(organization_id=org.id, location_id=location.id, clover_shadow_order_line_id=line.id, inventory_item_id=item.id, applied_quantity=-Decimal(quantity), unit_cost_snapshot=item.average_unit_cost))
        db.session.flush()
    return line


@pytest.fixture()
def no_square(monkeypatch):
    """Clover locations must never reach Square: any Square call fails the test."""
    def boom(*args, **kwargs):
        raise AssertionError("Square was called for a Clover location")

    for name in ("ensure_square_orders_fresh", "_square_request", "sync_square_orders_for_range", "_build_square_usage_report"):
        monkeypatch.setattr(f"backend.daily_close.{name}", boom)


@pytest.fixture()
def cafe(app, client, no_square):
    _login(client)
    org, location, connection = _clover_cafe()
    _select(client, org.id)
    return org, location, connection


def test_clover_day_figures_are_exact_provider_labelled_and_exclude_other_days(app, client, cafe):
    org, location, connection = cafe
    o1 = _seed_day(org, location, connection)
    item = _item(org, location)
    _line(org, location, o1, item, "0.5000")  # 0.5 kg at $8.00 = $4.00 from the consumption ledger
    db.session.commit()

    body = _get(client, location.id).get_json()
    snapshot = body["snapshot"]
    assert snapshot["provider"] == "clover"
    assert "square" not in snapshot and body["square"] is None
    sales = snapshot["sales"]
    assert (sales["orders"], sales["netSales"], sales["tax"], sales["tips"]) == (4, 36.0, 4.68, 1.5)
    assert (sales["deliveryOrders"], sales["deliveryNetSales"], sales["netSalesAvailable"]) == (1, 5.0, True)
    # Figures Clover data cannot supply are unavailable, never zero.
    assert (sales["grossSales"], sales["discounts"], sales["refunds"], sales["cancelledOrders"]) == (None, None, None, None)
    assert sales["cloverStatus"] == "connected" and sales["locationMapped"] is True
    cash = snapshot["cashReconciliation"]
    assert (cash["status"], cash["mode"], cash["expectedCash"]) == ("available", "clover_cash_tenders", 12.8)
    assert snapshot["foodCost"] == {"available": True, "usageCostCents": 400, "netSalesCents": 3600, "percent": 11.11, "unavailableReason": None}
    row = snapshot["usage"]["ingredientUsage"][0]
    assert (row["inventoryItemName"], row["theoreticalUsage"], row["costCents"], row["actualUsage"]) == ("Chicken", 0.5, 400, None)
    assert snapshot["variance"] == {"quantity": None, "percent": None, "value": None}
    assert snapshot["healthStatus"] == "Ready" and body["exceptions"] == []
    assert snapshot["usage"]["totals"]["actualUsage"] is None


def test_counted_cash_gives_variance_and_the_completed_close_is_frozen(app, client, cafe):
    org, location, connection = cafe
    _seed_day(org, location, connection)
    session_id = _open(client, location.id)["session"]["id"]
    counted = _patch(client, f"/api/pilot/daily-close/{session_id}", {"reconciliation": {"countedCash": 12.3}}).get_json()["snapshot"]["cashReconciliation"]
    assert (counted["expectedCash"], counted["countedCash"], counted["overShort"], counted["varianceStatus"]) == (12.8, 12.3, -0.5, "available")

    final = _post(client, f"/api/pilot/daily-close/{session_id}/finalize")
    assert final.status_code == 200, final.get_data(as_text=True)
    frozen = final.get_json()["snapshot"]
    assert final.get_json()["session"]["status"] == "COMPLETED"
    assert frozen["cashReconciliation"]["overShort"] == -0.5 and "cash_variance" in {a["type"] for a in frozen["attentionItems"]}

    # Late Clover data, a recount and a second finalize cannot move the completed record.
    _order(org, location, connection, [_pay(11300, 1300, 0, CASH)])
    db.session.commit()
    assert _patch(client, f"/api/pilot/daily-close/{session_id}", {"reconciliation": {"countedCash": 99}}).status_code == 409
    assert _post(client, f"/api/pilot/daily-close/{session_id}/finalize").status_code == 409
    reread = _get(client, location.id).get_json()["snapshot"]
    assert (reread["sales"]["orders"], reread["sales"]["netSales"], reread["cashReconciliation"]["expectedCash"], reread["cashReconciliation"]["overShort"]) == (4, 36.0, 12.8, -0.5)
    db.session.expire_all()
    stored = db.session.get(DailyCloseSession, session_id).summary_snapshot_json
    assert stored["provider"] == "clover" and stored["cashReconciliation"]["countedCash"] == 12.3


def test_opening_the_close_twice_is_one_session_with_identical_figures(app, client, cafe):
    org, location, connection = cafe
    _seed_day(org, location, connection)
    first = _open(client, location.id)
    second = _open(client, location.id)
    assert first["session"]["id"] == second["session"]["id"]
    assert DailyCloseSession.query.filter_by(organization_id=org.id, location_id=location.id).count() == 1
    assert first["snapshot"]["sales"] == second["snapshot"]["sales"]


def test_missing_payment_type_makes_cash_unavailable_but_keeps_net_sales(app, client, cafe):
    org, location, connection = cafe
    _order(org, location, connection, [_pay(1130, 130, 0, tender="")])
    db.session.commit()
    session_id = _open(client, location.id)["session"]["id"]
    body = _patch(client, f"/api/pilot/daily-close/{session_id}", {"reconciliation": {"countedCash": 50}}).get_json()
    cash = body["snapshot"]["cashReconciliation"]
    assert body["snapshot"]["sales"]["netSales"] == 10.0
    assert (cash["status"], cash["expectedCash"], cash["countedCash"]) == ("unavailable", None, 50.0)
    assert (cash["overShort"], cash["varianceStatus"]) == (None, "unavailable")
    assert "payment type" in cash["varianceUnavailableReason"] and "Square" not in cash["varianceUnavailableReason"]


def test_an_excluded_order_makes_expected_cash_unavailable_not_understated(app, client, cafe):
    org, location, connection = cafe
    _order(org, location, connection, [_pay(1130, 130, 0, CASH)])
    _order(org, location, connection, [_pay(500, 0, 0, CASH)], status="refunded", review=True)
    db.session.commit()
    snapshot = _get(client, location.id).get_json()["snapshot"]
    assert snapshot["sales"]["orders"] == 1 and snapshot["sales"]["netSales"] == 10.0 and snapshot["sales"]["excludedOrders"] == 1
    cash = snapshot["cashReconciliation"]
    assert cash["expectedCash"] is None and cash["status"] == "unavailable" and "need review" in cash["reason"]
    assert {"clover_sales_exceptions", "clover_cash_unavailable"} <= {a["type"] for a in snapshot["attentionItems"]}
    assert snapshot["healthStatus"] == "Ready with warnings"


@pytest.mark.parametrize("status", ["cancelled", "pending"])
def test_cash_bearing_cancelled_or_partially_paid_order_makes_expected_cash_unavailable(app, client, cafe, status):
    org, location, connection = cafe
    _order(org, location, connection, [_pay(1130, 130, 0, CARD)])
    _order(org, location, connection, [_pay(500, 0, 0, CASH)], status=status, review=status == "pending")
    db.session.commit()

    snapshot = _get(client, location.id).get_json()["snapshot"]
    session_id = _open(client, location.id)["session"]["id"]
    counted = _patch(client, f"/api/pilot/daily-close/{session_id}", {"reconciliation": {"countedCash": 11.3}}).get_json()["snapshot"]

    assert snapshot["sales"]["orders"] == 1
    assert snapshot["cashReconciliation"]["status"] == "unavailable"
    assert snapshot["cashReconciliation"]["expectedCash"] is None
    assert counted["cashReconciliation"]["varianceStatus"] == "unavailable"
    assert counted["cashReconciliation"]["overShort"] is None
    assert "unavailable" in counted["cashReconciliation"]["varianceUnavailableReason"]


def test_cancelled_card_order_keeps_expected_cash_and_zero_variance_available(app, client, cafe):
    org, location, connection = cafe
    _order(org, location, connection, [_pay(1130, 130, 0, CASH)])
    _order(org, location, connection, [_pay(500, 0, 0, CARD)], status="cancelled")
    db.session.commit()

    session_id = _open(client, location.id)["session"]["id"]
    counted = _patch(client, f"/api/pilot/daily-close/{session_id}", {"reconciliation": {"countedCash": 11.3}}).get_json()["snapshot"]["cashReconciliation"]

    assert counted["status"] == "available"
    assert counted["expectedCash"] == 11.3
    assert counted["varianceStatus"] == "available"
    assert counted["overShort"] == 0.0


@pytest.mark.parametrize("tender", [None, ""])
def test_excluded_successful_payment_without_tender_makes_cash_unavailable(app, client, cafe, tender):
    org, location, connection = cafe
    _order(org, location, connection, [_pay(1130, 130, 0, CARD)])
    _order(org, location, connection, [_pay(500, 0, 0, tender)], status="cancelled")
    db.session.commit()

    session_id = _open(client, location.id)["session"]["id"]
    counted = _patch(client, f"/api/pilot/daily-close/{session_id}", {"reconciliation": {"countedCash": 11.3}}).get_json()["snapshot"]["cashReconciliation"]

    assert counted["status"] == "unavailable"
    assert counted["expectedCash"] is None
    assert counted["varianceStatus"] == "unavailable"
    assert counted["overShort"] is None
    assert "unavailable" in counted["varianceUnavailableReason"]


def test_null_closed_time_open_partially_paid_order_is_not_attributed_and_requires_sandbox_policy(app, client, cafe):
    """Known limitation: an open Clover tab has no business-day attribution without owner/Sandbox policy (#166)."""
    org, location, connection = cafe
    _order(org, location, connection, [_pay(1130, 130, 0, CARD)])
    _order(org, location, connection, [_pay(500, 0, 0, CASH)], status="pending", review=True, closed=None)
    db.session.commit()

    snapshot = _get(client, location.id).get_json()["snapshot"]

    assert snapshot["sales"]["orders"] == 1
    assert snapshot["cashReconciliation"]["status"] == "available"
    assert snapshot["cashReconciliation"]["expectedCash"] == 0.0
    assert snapshot["cashReconciliation"].get("reason") is None


def test_missing_tax_breakdown_never_shows_gross_as_net_and_blocks_food_cost(app, client, cafe):
    org, location, connection = cafe
    order = _order(org, location, connection, [_pay(1130, None, 0, CASH)])
    _line(org, location, order, _item(org, location), "0.5000")
    db.session.commit()
    snapshot = _get(client, location.id).get_json()["snapshot"]
    assert snapshot["sales"]["netSales"] is None and snapshot["sales"]["netSalesAvailable"] is False and snapshot["sales"]["orders"] == 1
    assert snapshot["foodCost"]["percent"] is None and snapshot["foodCost"]["usageCostCents"] == 400
    assert snapshot["foodCost"]["unavailableReason"] == "Net sales are unavailable."
    assert "Clover net sales unavailable." in _get(client, location.id).get_json()["exceptions"]


def test_usage_is_unavailable_until_inventory_has_been_applied_and_unmapped_items_are_listed(app, client, cafe):
    org, location, connection = cafe
    order = _order(org, location, connection, [_pay(1130, 130, 0, CASH)])
    item = _item(org, location)
    _line(org, location, order, item, "0.5000", ledger=False)  # mapped, recipe present, but the flag-gated ledger has no row
    _line(org, location, order, item, "0.5000", ledger=False, mapping="unmapped", name="Mystery Special")
    db.session.commit()
    body = _get(client, location.id).get_json()
    snapshot = body["snapshot"]
    assert snapshot["usage"]["availability"]["usageAvailable"] is False
    assert snapshot["foodCost"] == {"available": False, "usageCostCents": None, "netSalesCents": 1000, "percent": None, "unavailableReason": "Usage cost is not complete for this day."}
    assert snapshot["usage"]["unmappedVariations"][0]["name"] == "Mystery Special"
    assert {"Sold Clover item unmapped.", "Clover inventory has not been applied for some sold items."} <= set(body["exceptions"])
    assert snapshot["usage"]["ingredientUsage"] == []  # nothing was consumed, so nothing is claimed


def test_a_day_with_no_stored_orders_is_flagged_rather_than_shown_as_a_confident_zero(app, client, cafe):
    org, location, connection = cafe
    body = _get(client, location.id).get_json()
    assert body["snapshot"]["sales"]["orders"] == 0
    assert "No Clover orders are stored for this business date." in body["exceptions"]
    assert body["snapshot"]["healthStatus"] == "Ready with warnings"


def test_finalize_does_not_carry_stale_draft_cash_for_clover(app, client, cafe):
    org, location, connection = cafe
    order = _order(org, location, connection, [_pay(1130, 130, 0, CASH)])
    db.session.commit()
    session_id = _open(client, location.id)["session"]["id"]
    assert _get(client, location.id).get_json()["snapshot"]["cashReconciliation"]["expectedCash"] == 11.3
    order.raw_payload_json = {"payments": [_pay(1130, 130, 0, tender="")], "orderType": ""}  # evidence is now incomplete
    db.session.commit()
    final = _post(client, f"/api/pilot/daily-close/{session_id}/finalize").get_json()["snapshot"]["cashReconciliation"]
    assert final["expectedCash"] is None and "carriedFromDraft" not in final


def test_clover_tenant_and_location_isolation(app, client, cafe):
    org, location, connection = cafe
    _seed_day(org, location, connection)
    other_org, other_location, other_connection = _clover_cafe("Other Clover Cafe")
    _order(other_org, other_location, other_connection, [_pay(500000, 50000, 0, CASH)])
    second = RestaurantLocation(organization_id=org.id, name="Second Site", timezone="America/Toronto")
    db.session.add(second)
    db.session.flush()
    _order(org, second, connection, [_pay(80000, 8000, 0, CASH)])
    db.session.commit()
    sales = _get(client, location.id).get_json()["snapshot"]["sales"]
    assert (sales["orders"], sales["netSales"]) == (4, 36.0)
    # Another organization's location is not reachable by id.
    assert client.get("/api/pilot/daily-close", query_string={"locationId": other_location.id, "businessDate": DAY}).status_code == 404


def test_square_locations_keep_the_square_path(app, client, monkeypatch):
    """Square active, Clover leftover/disconnected, or both mapped: the existing Square snapshot is still used."""
    monkeypatch.setattr("backend.daily_close.ensure_square_orders_fresh", lambda *a, **k: {"state": "fresh"})
    _login(client)
    org, location, clover = _clover_cafe("Mixed")
    square = SquareConnection(organization_id=org.id, environment="sandbox", square_merchant_id=f"sq-{uuid4().hex[:6]}", status="connected", sync_status="idle", last_sync_at=NOON)
    db.session.add(square)
    db.session.flush()
    sq_location = SquareLocation(square_connection_id=square.id, square_location_id="LOC-A", name="A", status="ACTIVE", raw_payload_json={})
    db.session.add(sq_location)
    db.session.flush()
    db.session.add(SquareLocationMapping(square_location_id=sq_location.id, restaurant_location_id=location.id))
    db.session.commit()
    _select(client, org.id)
    both = _get(client, location.id).get_json()["snapshot"]
    assert "provider" not in both and "squareStatus" in both["square"]  # legacy both-active data stays on Square

    clover.status = "disconnected"
    db.session.commit()
    assert "provider" not in _get(client, location.id).get_json()["snapshot"]


def test_a_disconnected_clover_location_without_square_uses_the_square_empty_state(app, client, monkeypatch):
    monkeypatch.setattr("backend.daily_close.ensure_square_orders_fresh", lambda *a, **k: {"state": "fresh"})
    _login(client)
    org, location, _ = _clover_cafe("Disconnected", connection_status="disconnected")
    _select(client, org.id)
    snapshot = _get(client, location.id).get_json()["snapshot"]
    assert "provider" not in snapshot and snapshot["square"]["squareStatus"] == "Not connected"


def test_sync_sales_is_not_offered_for_clover_and_never_calls_square(app, client, cafe):
    org, location, connection = cafe
    session_id = _open(client, location.id)["session"]["id"]
    response = _post(client, f"/api/pilot/daily-close/{session_id}/sync-sales")
    assert response.status_code == 409 and "Clover" in response.get_json()["error"]


# --------------------------------------------------------------------------------------------------
# Engine-driven Daily Close: the REAL Clover inventory engine writes the ledger (test app only, flag on),
# and every figure below is read back through the Daily Close API, never through the usage helper alone.
# Hand figures: chicken 0.18 kg x $12.50 = $2.25 and buns 0.25 pack x $2.00 = $0.50 -> $2.75 (275c) on a 1000c
# net sale = 27.5%. Corrected recipe 0.20 kg chicken: $2.50 + $0.50 = $3.00 (300c) = 30.0%.
# --------------------------------------------------------------------------------------------------
def _engine_world(app, monkeypatch, org, location, connection, *, chicken_cost="12.50"):
    monkeypatch.setitem(app.config, "CLOVER_ORDER_INVENTORY_ENABLED", True)  # controlled test app only; default stays off
    chicken = _item(org, location, "Chicken", "kg", chicken_cost)
    buns = _item(org, location, "Buns", "pack", "2.00")
    chicken.current_on_hand, buns.current_on_hand = Decimal("10"), Decimal("20")
    db.session.commit()
    return chicken, buns


def _engine_order(org, location, connection, chicken, buns, *, chicken_qty="0.1800", recipe=None):
    order = _order(org, location, connection, [_pay(1130, 130, 0, CASH)])  # net 1000c
    order.provider_status, order.payment_status, order.potentially_eligible, order.total_cents = "CLOSED", "paid", True, 1130
    ingredients = [
        {"inventoryItemId": chicken.id, "quantity": chicken_qty, "unit": "kg", "name": "Chicken"},
        {"inventoryItemId": buns.id, "quantity": "0.2500", "unit": "pack", "name": "Buns"},
    ]
    line = CloverShadowOrderLine(
        organization_id=org.id, restaurant_location_id=location.id, shadow_order_id=order.id, clover_line_item_id=f"l-{uuid4().hex[:6]}", clover_item_id="burger",
        name="Test Burger", quantity=Decimal("1"), mapping_status="mapped",
        recipe_preview_json=recipe if recipe is not None else {"flowtallyMenuItemName": "Test Burger", "ingredients": ingredients},
    )
    db.session.add(line)
    db.session.commit()
    return order, line


def _apply(order, connection):
    from backend.clover_inventory import apply_clover_order_inventory

    result = apply_clover_order_inventory(order=order, connection=connection)
    db.session.commit()
    return result


def _close(client, location_id):
    body = _get(client, location_id).get_json()
    return body["snapshot"], body["exceptions"]


def test_engine_applied_order_shows_275_and_27_5_percent_in_daily_close_then_300_and_30_after_correction(app, client, cafe, monkeypatch):
    from sqlalchemy.orm.attributes import flag_modified

    org, location, connection = cafe
    chicken, buns = _engine_world(app, monkeypatch, org, location, connection)
    order, line = _engine_order(org, location, connection, chicken, buns)

    snapshot, exceptions = _close(client, location.id)
    assert snapshot["foodCost"]["available"] is False  # nothing applied yet: never a guessed cost
    assert "Clover inventory has not been applied for some sold items." in exceptions

    assert _apply(order, connection)["applied"] is True
    assert (db.session.get(type(chicken), chicken.id).current_on_hand, db.session.get(type(buns), buns.id).current_on_hand) == (Decimal("9.8200"), Decimal("19.7500"))
    snapshot, exceptions = _close(client, location.id)
    assert snapshot["foodCost"] == {"available": True, "usageCostCents": 275, "netSalesCents": 1000, "percent": 27.5, "unavailableReason": None}
    assert {r["inventoryItemName"]: (r["theoreticalUsage"], r["costCents"]) for r in snapshot["usage"]["ingredientUsage"]} == {"Chicken": (0.18, 225), "Buns": (0.25, 50)}
    assert snapshot["usage"]["availability"]["usageAvailable"] is True and exceptions == []

    # Replay is idempotent: no new movement, no new ledger row, same Daily Close.
    movements_before = InventoryMovement.query.filter_by(organization_id=org.id).count()
    assert _apply(order, connection)["alreadyApplied"]
    assert InventoryMovement.query.filter_by(organization_id=org.id).count() == movements_before
    assert _close(client, location.id)[0]["foodCost"]["usageCostCents"] == 275

    line.recipe_preview_json["ingredients"][0]["quantity"] = "0.2000"
    flag_modified(line, "recipe_preview_json")
    db.session.flush()
    assert any(m["state"] == "correction" for m in _apply(order, connection)["movements"])
    assert db.session.get(type(chicken), chicken.id).current_on_hand == Decimal("9.8000")
    corrected, _ = _close(client, location.id)
    assert (corrected["foodCost"]["usageCostCents"], corrected["foodCost"]["percent"]) == (300, 30.0)
    assert {r["inventoryItemName"]: r["costCents"] for r in corrected["usage"]["ingredientUsage"]} == {"Chicken": 250, "Buns": 50}
    # Reconciles to the stock that actually moved: (10 - 9.80) x 12.50 + (20 - 19.75) x 2.00 = $3.00.
    assert (Decimal("10") - Decimal("9.80")) * Decimal("12.50") + (Decimal("20") - Decimal("19.75")) * Decimal("2.00") == Decimal("3.00")


def test_historical_cost_snapshots_do_not_move_when_the_current_item_cost_changes(app, client, cafe, monkeypatch):
    org, location, connection = cafe
    chicken, buns = _engine_world(app, monkeypatch, org, location, connection)
    first, _ = _engine_order(org, location, connection, chicken, buns)
    _apply(first, connection)
    assert _close(client, location.id)[0]["foodCost"]["usageCostCents"] == 275

    chicken.average_unit_cost = Decimal("20.00")  # supplier price rises after the first sale
    db.session.commit()
    assert _close(client, location.id)[0]["foodCost"]["usageCostCents"] == 275  # first sale keeps its recorded $12.50

    second, _ = _engine_order(org, location, connection, chicken, buns)
    _apply(second, connection)
    snapshot, _ = _close(client, location.id)
    # Second sale uses the new cost: 0.18 x $20.00 + 0.25 x $2.00 = $4.10; total $2.75 + $4.10 = $6.85 on 2000c net = 34.25%.
    assert (snapshot["foodCost"]["usageCostCents"], snapshot["foodCost"]["netSalesCents"], snapshot["foodCost"]["percent"]) == (685, 2000, 34.25)
    assert {r["inventoryItemName"]: r["costCents"] for r in snapshot["usage"]["ingredientUsage"]} == {"Chicken": 225 + 360, "Buns": 100}


def test_completed_close_keeps_the_engine_figures_after_a_later_correction(app, client, cafe, monkeypatch):
    from sqlalchemy.orm.attributes import flag_modified

    org, location, connection = cafe
    chicken, buns = _engine_world(app, monkeypatch, org, location, connection)
    order, line = _engine_order(org, location, connection, chicken, buns)
    _apply(order, connection)
    session_id = _open(client, location.id)["session"]["id"]
    final = _post(client, f"/api/pilot/daily-close/{session_id}/finalize")
    assert final.status_code == 200 and final.get_json()["snapshot"]["foodCost"]["usageCostCents"] == 275

    line.recipe_preview_json["ingredients"][0]["quantity"] = "0.2000"
    flag_modified(line, "recipe_preview_json")
    db.session.flush()
    _apply(order, connection)
    reread, _ = _close(client, location.id)
    assert (reread["foodCost"]["usageCostCents"], reread["foodCost"]["percent"]) == (275, 27.5)  # frozen, not the corrected $3.00
    assert _patch(client, f"/api/pilot/daily-close/{session_id}", {"notes": "late"}).status_code == 409
    db.session.expire_all()
    assert db.session.get(DailyCloseSession, session_id).summary_snapshot_json["foodCost"]["usageCostCents"] == 275


@pytest.mark.parametrize("bad_recipe", [
    {},                                                                        # no ingredients at all
    {"flowtallyMenuItemName": "Test Burger", "ingredients": []},               # empty recipe
    {"flowtallyMenuItemName": "Test Burger", "ingredients": ["chicken"]},      # malformed ingredient entry
    "not-a-recipe",                                                            # malformed recipe payload
])
def test_missing_or_malformed_recipes_make_the_whole_day_unavailable_never_partial(app, client, cafe, monkeypatch, bad_recipe):
    org, location, connection = cafe
    chicken, buns = _engine_world(app, monkeypatch, org, location, connection)
    good, _ = _engine_order(org, location, connection, chicken, buns)
    _apply(good, connection)
    assert _close(client, location.id)[0]["foodCost"]["usageCostCents"] == 275
    _engine_order(org, location, connection, chicken, buns, recipe=bad_recipe)  # a second sale whose recipe cannot be trusted

    snapshot, exceptions = _close(client, location.id)
    assert snapshot["usage"]["availability"]["usageAvailable"] is False
    assert (snapshot["foodCost"]["available"], snapshot["foodCost"]["usageCostCents"], snapshot["foodCost"]["percent"]) == (False, None, None)
    assert snapshot["sales"]["netSales"] == 20.0  # sales stay exact; only the cost claim is withheld
    assert "Recipe or inventory mapping gaps exist." in exceptions or "Clover inventory has not been applied for some sold items." in exceptions


def test_a_nonpositive_recipe_quantity_is_never_costed(app, client, cafe, monkeypatch):
    org, location, connection = cafe
    chicken, buns = _engine_world(app, monkeypatch, org, location, connection)
    order, _ = _engine_order(org, location, connection, chicken, buns, chicken_qty="-0.1800")
    result = _apply(order, connection)
    assert result["applied"] is False  # the engine refuses it, so nothing moves and nothing is costed
    assert db.session.get(type(chicken), chicken.id).current_on_hand == Decimal("10.0000")
    snapshot, _ = _close(client, location.id)
    assert snapshot["foodCost"]["available"] is False and snapshot["foodCost"]["usageCostCents"] is None


# --------------------------------------------------------------------------------------------------
# Multi-quantity lines (reviewer finding at e672db7). A real stored line is built by the production ingestion path
# (_ingest_shadow_orders -> _shadow_recipe_preview), which already scales every ingredient by quantity / yield, so
# recipe_preview_json holds LINE-TOTAL quantities and the engine must not multiply again. These tests prove the whole
# chain (ingestion -> enabled engine -> Daily Close) for quantity 2 and for quantity 4 on a yield-2 recipe.
# --------------------------------------------------------------------------------------------------
def _raw_clover_order(order_id, *, quantity, tax, closed=NOON, payment_state="PAID", refunds=None, state="CLOSED"):
    ms = int(closed.timestamp() * 1000)
    amount = quantity * 1000 + tax
    refunds = refunds or []
    return {
        "id": order_id, "state": state, "paymentState": payment_state, "total": amount, "currency": "CAD",
        "createdTime": ms, "modifiedTime": ms, "closedTime": ms,
        "lineItems": {"elements": [{"id": "line-1", "name": "Test Burger", "quantity": quantity, "price": 1000, "item": {"id": "burger-1"}, "modifications": {"elements": [], "total": 0}}], "total": 1},
        "payments": {"elements": [{"id": "p1", "amount": amount, "taxAmount": tax, "tipAmount": 0, "result": "SUCCESS", "tender": {"labelKey": CASH}}], "total": 1},
        "refunds": {"elements": refunds, "total": len(refunds)},
    }


def _mapped_recipe(app, monkeypatch, org, location, connection, *, yield_quantity="1", chicken_per_yield="0.18"):
    from backend.models import CloverMenuMapping, MenuItem, Recipe, RecipeIngredient

    chicken, buns = _engine_world(app, monkeypatch, org, location, connection)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    recipe = Recipe(organization_id=org.id, location_id=location.id, name="Burger recipe", normalized_name=f"burger-{uuid4().hex[:6]}", yield_quantity=Decimal(yield_quantity), yield_unit="serving", active=True)
    menu_item = MenuItem(organization_id=org.id, location_id=location.id, recipe=recipe, name="Test Burger", normalized_name=f"tb-{uuid4().hex[:6]}", selling_price=Decimal("10"))
    db.session.add_all([recipe, menu_item])
    db.session.flush()
    chicken_row = RecipeIngredient(organization_id=org.id, recipe_id=recipe.id, inventory_item_id=chicken.id, quantity_required=Decimal(chicken_per_yield), unit="kg")
    db.session.add_all([chicken_row, RecipeIngredient(organization_id=org.id, recipe_id=recipe.id, inventory_item_id=buns.id, quantity_required=Decimal("0.25"), unit="pack")])
    db.session.add(CloverMenuMapping(clover_connection_id=connection.id, organization_id=org.id, restaurant_location_id=location.id, clover_merchant_id=connection.merchant_id, clover_item_id="burger-1", flowtally_menu_item_id=menu_item.id, mapped_by_user_id=owner.id))
    db.session.commit()
    return chicken, buns, chicken_row


def _ingest(org, location, connection, raw):
    from backend.clover_integration import _ingest_shadow_orders
    from backend.clover_orders import normalize_order

    _ingest_shadow_orders(connection=connection, organization=org, location=location, orders=[normalize_order(raw)])
    db.session.commit()
    return CloverShadowOrder.query.filter_by(organization_id=org.id, clover_order_id=raw["id"]).one()


def test_quantity_two_line_is_consumed_and_costed_at_line_total_through_ingestion_engine_and_daily_close(app, client, cafe, monkeypatch):
    """Quantity 2 x (0.18 kg chicken + 0.25 pack buns): ledger -0.36 / -0.50, stock 9.64 / 19.50, usage $4.50 + $1.00 = $5.50
    (550c) on 2000c net = 27.5%. Recipe corrected to 0.20 kg: 0.40 / 0.50 -> $5.00 + $1.00 = $6.00 (600c) = 30.0%."""
    org, location, connection = cafe
    chicken, buns, chicken_row = _mapped_recipe(app, monkeypatch, org, location, connection)
    order = _ingest(org, location, connection, _raw_clover_order("multi-2", quantity=2, tax=260))
    line = CloverShadowOrderLine.query.filter_by(shadow_order_id=order.id).one()
    assert line.quantity == Decimal("2")
    assert {i["name"]: i["quantity"] for i in line.recipe_preview_json["ingredients"]} == {"Chicken": "0.3600", "Buns": "0.5000"}  # already line totals

    assert _apply(order, connection)["applied"] is True
    assert (db.session.get(type(chicken), chicken.id).current_on_hand, db.session.get(type(buns), buns.id).current_on_hand) == (Decimal("9.6400"), Decimal("19.5000"))
    ledger = {l.inventory_item_id: (l.applied_quantity, l.unit_cost_snapshot) for l in CloverShadowOrderLineInventoryConsumption.query.filter_by(clover_shadow_order_line_id=line.id)}
    assert ledger == {chicken.id: (Decimal("-0.3600"), Decimal("12.500000")), buns.id: (Decimal("-0.5000"), Decimal("2.000000"))}
    assert sorted(m.quantity_delta for m in InventoryMovement.query.filter_by(organization_id=org.id)) == [Decimal("-0.5000"), Decimal("-0.3600")]
    snapshot, exceptions = _close(client, location.id)
    assert snapshot["foodCost"] == {"available": True, "usageCostCents": 550, "netSalesCents": 2000, "percent": 27.5, "unavailableReason": None}
    assert {r["inventoryItemName"]: (r["theoreticalUsage"], r["costCents"]) for r in snapshot["usage"]["ingredientUsage"]} == {"Chicken": (0.36, 450), "Buns": (0.5, 100)}
    assert snapshot["usage"]["contributingMenuItems"] == [{"name": "Test Burger", "quantity": 2.0}] and exceptions == []
    # Stock that actually left the shelf, priced independently: 0.36 x 12.50 + 0.50 x 2.00 = $5.50.
    assert (Decimal("10") - Decimal("9.64")) * Decimal("12.50") + (Decimal("20") - Decimal("19.50")) * Decimal("2.00") == Decimal("5.50")

    # Replay: re-fetching the identical order and re-applying changes nothing.
    movements = InventoryMovement.query.filter_by(organization_id=org.id).count()
    again = _ingest(org, location, connection, _raw_clover_order("multi-2", quantity=2, tax=260))
    assert _apply(again, connection)["alreadyApplied"] and InventoryMovement.query.filter_by(organization_id=org.id).count() == movements
    assert _close(client, location.id)[0]["foodCost"]["usageCostCents"] == 550

    # Recipe correction through the production path: the changed recipe is re-previewed at line total (0.20 x 2 = 0.40).
    chicken_row.quantity_required = Decimal("0.20")
    db.session.commit()
    corrected_order = _ingest(org, location, connection, _raw_clover_order("multi-2", quantity=2, tax=260))
    assert any(m["state"] == "correction" for m in _apply(corrected_order, connection)["movements"])
    assert db.session.get(type(chicken), chicken.id).current_on_hand == Decimal("9.6000")
    corrected, _ = _close(client, location.id)
    assert (corrected["foodCost"]["usageCostCents"], corrected["foodCost"]["percent"]) == (600, 30.0)
    assert {r["inventoryItemName"]: r["costCents"] for r in corrected["usage"]["ingredientUsage"]} == {"Chicken": 500, "Buns": 100}


def test_quantity_four_line_on_a_yield_two_recipe_scales_by_quantity_over_yield_once(app, client, cafe, monkeypatch):
    """Recipe makes 2 servings from 0.18 kg chicken + 0.25 pack buns; 4 sold -> x2 -> 0.36 kg / 0.50 pack, $5.50 (550c) on 4000c net = 13.75%."""
    org, location, connection = cafe
    chicken, buns, _ = _mapped_recipe(app, monkeypatch, org, location, connection, yield_quantity="2")
    order = _ingest(org, location, connection, _raw_clover_order("multi-4", quantity=4, tax=520))
    assert _apply(order, connection)["applied"] is True
    assert (db.session.get(type(chicken), chicken.id).current_on_hand, db.session.get(type(buns), buns.id).current_on_hand) == (Decimal("9.6400"), Decimal("19.5000"))
    snapshot, _ = _close(client, location.id)
    assert (snapshot["foodCost"]["usageCostCents"], snapshot["foodCost"]["netSalesCents"], snapshot["foodCost"]["percent"]) == (550, 4000, 13.75)


def test_a_multi_quantity_order_refunded_after_application_never_reports_an_available_understated_cost(app, client, cafe, monkeypatch):
    org, location, connection = cafe
    chicken, buns, _ = _mapped_recipe(app, monkeypatch, org, location, connection)
    order = _ingest(org, location, connection, _raw_clover_order("multi-refund", quantity=2, tax=260))
    _apply(order, connection)
    assert _close(client, location.id)[0]["foodCost"]["usageCostCents"] == 550

    refunded = _ingest(org, location, connection, _raw_clover_order("multi-refund", quantity=2, tax=260, payment_state="PARTIALLY_REFUNDED", refunds=[{"id": "r1", "amount": 1000}]))
    plan = _apply(refunded, connection)
    assert plan["applied"] is False and plan["appliedRequiresReview"] is True  # stock is left alone and surfaced for review
    assert db.session.get(type(chicken), chicken.id).current_on_hand == Decimal("9.6400")  # nothing silently restocked
    snapshot, exceptions = _close(client, location.id)
    assert snapshot["foodCost"]["available"] is False and snapshot["foodCost"]["usageCostCents"] is None
    assert snapshot["sales"]["orders"] == 0 and snapshot["sales"]["excludedOrders"] == 1  # the refunded order is excluded, not counted as a clean sale
    assert snapshot["cashReconciliation"]["expectedCash"] is None


def test_a_multi_quantity_order_voided_after_application_is_not_hidden_from_usage(app, client, cafe, monkeypatch):
    org, location, connection = cafe
    chicken, buns, _ = _mapped_recipe(app, monkeypatch, org, location, connection)
    order = _ingest(org, location, connection, _raw_clover_order("multi-void", quantity=2, tax=260))
    _apply(order, connection)
    stock_after_sale = db.session.get(type(chicken), chicken.id).current_on_hand
    assert stock_after_sale == Decimal("9.6400")

    voided = _ingest(org, location, connection, _raw_clover_order("multi-void", quantity=2, tax=260, state="DELETED", payment_state="PAID"))
    _apply(voided, connection)
    assert db.session.get(type(chicken), chicken.id).current_on_hand == stock_after_sale  # the engine never auto-restocks a void
    snapshot, exceptions = _close(client, location.id)
    # Stock really left the shelf (550c), so Daily Close must not present a complete, smaller (here $0) cost that ignores it.
    assert snapshot["usage"]["availability"]["usageAvailable"] is False
    assert (snapshot["foodCost"]["available"], snapshot["foodCost"]["usageCostCents"]) == (False, None)
    assert "Clover order cancelled after inventory was applied." in exceptions
    assert "clover_cancelled_after_inventory" in {a["type"] for a in snapshot["attentionItems"]}
    assert snapshot["sales"]["orders"] == 0  # the void is not counted as a sale
