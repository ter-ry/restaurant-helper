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
