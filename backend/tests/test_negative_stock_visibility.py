"""Negative on-hand visibility (issue #237, owner decision #199 Option A, phase 2).

Hand-calculated fixture: one Square cheeseburger order sells 10 units at 0.18 kg Beef each = 1.8 kg consumed.
Beef starts at 0 kg, so verified POS consumption leaves it at -1.8 kg.  Manual flows stay non-negative; the
negative position is explained from the movement ledger and never becomes a variance, adjustment or cost.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import (
    InventoryItem,
    InventoryMovement,
    OrganizationModule,
    SquareConnection,
    SquareOrder,
    SquareOrderLine,
    User,
)
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_inventory_reconciliation import assert_ledger_reconciles
from backend.tests.test_pilot_api import csrf_headers, login, select_org
from backend.tests.test_square_integration import _create_square_usage_fixture

DAY = "2026-08-30"
IN_DAY = datetime(2026, 8, 30, 16, 0, tzinfo=timezone.utc)  # noon Toronto
NEGATIVE_URL = "/api/pilot/inventory/negative-stock"
BEEF_EXPLANATION = (
    "1 Square order used 1.8 kg before enough stock was received; on hand is -1.8 kg. "
    "Record the delivery or count the item to reconcile."
)


def _apply_order(organization_id, order_id="ORDER-1"):
    from backend.square_integration import _apply_square_order_inventory_consumption

    organization = db.session.get(type(db.session.get(InventoryItem, 1).organization), organization_id)
    connection = SquareConnection.query.filter_by(organization_id=organization_id).one()
    order = SquareOrder.query.filter_by(square_connection_id=connection.id, square_order_id=order_id).one()
    _apply_square_order_inventory_consumption(organization, connection, order)
    db.session.commit()


@pytest.fixture()
def beef_world(app, client, monkeypatch):
    """Square cafe whose Beef is at 0 kg; ORDER-1 consumes 1.8 kg once applied. Daily Close is enabled."""
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
    organization, location = _create_square_usage_fixture(app, owner, organization_name=f"Negative Beef {uuid4().hex[:8]}")
    select_org(client, organization.id)
    monkeypatch.setattr("backend.daily_close.ensure_square_orders_fresh", lambda *a, **k: {"state": "fresh"})
    with app.app_context():
        db.session.add(OrganizationModule(organization_id=organization.id, module_key="DAILY_CLOSE", status="ENABLED", enabled_at=datetime.now(timezone.utc)))
        connection = SquareConnection.query.filter_by(organization_id=organization.id).one()
        connection.inventory_depletion_activated_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
        beef = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, name="Beef").one()
        beef.current_on_hand = Decimal("0")
        beef.average_unit_cost = Decimal("7.25")
        db.session.commit()
        return organization.id, location.id, beef.id


def _negative(client):
    response = client.get(NEGATIVE_URL)
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _receive(client, item_id, quantity, unit_price):
    supplier = f"Neg Supplier {uuid4().hex[:8]}"
    assert client.post("/api/pilot/suppliers", headers=csrf_headers(client), json={"name": supplier, "isActive": True}).status_code == 201
    total = quantity * unit_price
    created = client.post("/api/pilot/purchases/invoices", headers=csrf_headers(client), json={
        "supplierName": supplier, "invoiceNumber": f"NEG-{uuid4().hex[:8].upper()}", "invoiceDate": "2026-08-31",
        "subtotal": total, "tax": 0, "totalAmount": total, "notes": "", "status": "Ready", "sourceFileName": "n.pdf",
        "sourceFileType": "application/pdf", "extractionStatus": "manual", "extractedText": "x",
        "lineItems": [{"description": "Beef", "inventoryItemId": item_id, "purchaseUnit": "kg", "inventoryUnit": "kg", "conversionFactor": 1,
                       "quantity": quantity, "unitPrice": unit_price, "lineTotal": total, "confidence": 0.99, "needsReview": False, "note": ""}],
    })
    assert created.status_code == 201, created.get_json()
    received = client.post(f"/api/pilot/purchases/invoices/{created.get_json()['id']}/receive", headers=csrf_headers(client))
    assert received.status_code == 200, received.get_json()


def _daily_close(client, location_id):
    response = client.get("/api/pilot/daily-close", query_string={"locationId": location_id, "businessDate": DAY})
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


# --------------------------------------------------------------------------------------------------
# API: exact quantities, evidence, replay
# --------------------------------------------------------------------------------------------------
def test_verified_square_sale_is_reported_with_exact_quantities_and_evidence(app, client, beef_world):
    organization_id, _, beef_id = beef_world
    assert _negative(client) == {"count": 0, "posCausedCount": 0, "items": []}

    _apply_order(organization_id)

    body = _negative(client)
    assert (body["count"], body["posCausedCount"]) == (1, 1)
    position = body["items"][0]
    assert position["inventoryItemId"] == beef_id
    assert (position["onHand"], position["shortfall"], position["unit"]) == (-1.8, 1.8, "kg")
    assert (position["cause"], position["provider"], position["orderCount"]) == ("pos_sale", "Square", 1)
    assert position["posConsumedQuantity"] == 1.8
    assert position["explanation"] == BEEF_EXPLANATION
    assert position["crossedZeroAt"] and position["lastPosSaleAt"]
    with app.app_context():
        assert_ledger_reconciles(beef_id, opening="0", expected_on_hand="-1.8")  # the ledger, not this report, is the truth


def test_pos_replay_is_idempotent_and_the_report_does_not_change(app, client, beef_world):
    organization_id, _, beef_id = beef_world
    _apply_order(organization_id)
    first = _negative(client)
    _apply_order(organization_id)
    _apply_order(organization_id)
    assert _negative(client) == first
    assert InventoryMovement.query.filter_by(inventory_item_id=beef_id).count() == 1


def test_a_pos_correction_reduces_the_reported_consumption_to_the_net_quantity(app, client, beef_world):
    organization_id, _, beef_id = beef_world
    _apply_order(organization_id)
    line = SquareOrderLine.query.filter_by(line_uid="line-1").one()
    line.quantity = Decimal("5")  # the order is corrected from 10 to 5 sold: 0.9 kg wanted, 0.9 kg given back
    db.session.commit()
    _apply_order(organization_id)

    position = _negative(client)["items"][0]
    assert (position["onHand"], position["posConsumedQuantity"], position["orderCount"]) == (-0.9, 0.9, 1)
    assert [m.source_type for m in InventoryMovement.query.filter_by(inventory_item_id=beef_id).order_by(InventoryMovement.id)] == [
        "square sale consumption", "square sale reversal",
    ]


def test_a_late_receipt_that_covers_the_shortfall_clears_the_position_and_keeps_the_ledger_whole(app, client, beef_world):
    organization_id, _, beef_id = beef_world
    _apply_order(organization_id)
    assert _negative(client)["count"] == 1

    _receive(client, beef_id, 10, 2)  # -1.8 + 10 = 8.2 kg at $2.00/kg

    assert _negative(client) == {"count": 0, "posCausedCount": 0, "items": []}
    with app.app_context():
        item = db.session.get(InventoryItem, beef_id)
        assert (Decimal(item.current_on_hand), Decimal(item.average_unit_cost)) == (Decimal("8.2000"), Decimal("2.00"))
        assert_ledger_reconciles(beef_id, opening="0", expected_on_hand="8.2")


# --------------------------------------------------------------------------------------------------
# Manual restrictions stay in force
# --------------------------------------------------------------------------------------------------
def test_manual_reductions_stay_prohibited_even_on_a_pos_negative_item(app, client, beef_world):
    organization_id, _, beef_id = beef_world
    _apply_order(organization_id)
    before = InventoryMovement.query.filter_by(inventory_item_id=beef_id).count()

    adjustment = client.post(f"/api/pilot/inventory/items/{beef_id}/adjustments", headers=csrf_headers(client), json={
        "reason": "try to push further negative", "quantityDelta": "-0.1", "movementType": "manual decrease",
        "sourceRecordId": f"neg-{uuid4().hex}", "sourceLineId": "manual",
    })
    assert adjustment.status_code == 400
    assert adjustment.get_json()["errors"]["quantityDelta"] == "Quantity cannot reduce stock below zero."
    waste = client.post("/api/pilot/inventory/waste-events", headers=csrf_headers(client), json={
        "inventoryItemId": beef_id, "quantity": "0.1", "reason": "Spoilage", "occurredAt": "2026-08-30T16:00:00Z",
    })
    assert waste.status_code == 400

    assert InventoryMovement.query.filter_by(inventory_item_id=beef_id).count() == before
    position = _negative(client)["items"][0]
    assert (position["onHand"], position["cause"]) == (-1.8, "pos_sale")


def test_a_negative_not_caused_by_a_pos_sale_is_never_called_a_pos_sale(app, client, beef_world):
    _, _, beef_id = beef_world
    item = db.session.get(InventoryItem, beef_id)
    item.current_on_hand = Decimal("-2")  # e.g. legacy data; no movement explains it
    db.session.commit()

    position = _negative(client)["items"][0]
    assert (position["cause"], position["provider"], position["posConsumedQuantity"], position["orderCount"]) == ("unverified", None, None, 0)
    assert position["explanation"] == "On hand is -2 kg but no verified POS sale caused it. Count the item to correct it."


# --------------------------------------------------------------------------------------------------
# Tenant isolation and access
# --------------------------------------------------------------------------------------------------
def test_other_tenants_negative_stock_is_never_visible(app, client, beef_world):
    organization_id, _, _ = beef_world
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
    other = make_operational_organization(owner, name=f"Other Negative {uuid4().hex[:8]}", location_name="Other Kitchen")
    other_location = other.locations[0]
    db.session.add(InventoryItem(
        organization_id=other.id, location_id=other_location.id, name="Foreign Milk", normalized_name=f"fm-{uuid4().hex}",
        stock_unit="L", current_on_hand=Decimal("-9"), average_unit_cost=Decimal("2"),
    ))
    db.session.commit()

    assert _negative(client)["count"] == 0  # the selected tenant has nothing negative
    select_org(client, other.id)
    assert [i["inventoryItemName"] for i in _negative(client)["items"]] == ["Foreign Milk"]
    select_org(client, organization_id)
    assert _negative(client)["count"] == 0


def test_negative_stock_requires_a_signed_in_user(client):
    assert client.get(NEGATIVE_URL).status_code == 401


# --------------------------------------------------------------------------------------------------
# Daily Close: visible, exact, and never double-counted as variance
# --------------------------------------------------------------------------------------------------
def test_daily_close_flags_the_position_without_changing_any_variance_figure(app, client, beef_world):
    organization_id, location_id, beef_id = beef_world
    before = _daily_close(client, location_id)["snapshot"]
    assert "negativeStock" not in before
    assert not any(a["type"] == "negative_stock" for a in before["attentionItems"])

    _apply_order(organization_id)
    for movement in InventoryMovement.query.filter_by(inventory_item_id=beef_id):
        movement.created_at = IN_DAY  # inside the business day, so day-movement sums see it
    db.session.commit()
    after = _daily_close(client, location_id)["snapshot"]

    assert after["negativeStock"]["count"] == 1
    assert after["negativeStock"]["items"][0]["onHand"] == -1.8
    attention = [a for a in after["attentionItems"] if a["type"] == "negative_stock"]
    assert attention == [{
        "type": "negative_stock", "title": "1 item below zero on hand", "severity": "warning",
        "href": "/app/reorder-plan", "label": "Review stock", "detail": "On hand: Beef -1.8 kg (Square sales).",
    }]
    # No double counting: the POS consumption is explained, so it is not an adjustment, count correction,
    # waste, unexplained variance or a variance value; cash is untouched.
    for key in ("unexplainedVarianceQuantity", "otherAdjustmentQuantity", "physicalCountCorrectionQuantity", "recordedWasteQuantity", "recordedWasteCost"):
        assert after["reconciliation"][key] == before["reconciliation"][key], key
    assert after["reconciliation"]["otherAdjustmentQuantity"] == 0.0
    assert after["variance"] == before["variance"]
    assert after["cashReconciliation"] == before["cashReconciliation"]


def test_a_square_sale_reversal_is_explained_not_an_other_adjustment(app, client, beef_world):
    organization_id, location_id, beef_id = beef_world
    _apply_order(organization_id)
    line = SquareOrderLine.query.filter_by(line_uid="line-1").one()
    line.quantity = Decimal("5")
    db.session.commit()
    _apply_order(organization_id)
    for movement in InventoryMovement.query.filter_by(inventory_item_id=beef_id):
        movement.created_at = IN_DAY
    db.session.commit()

    reconciliation = _daily_close(client, location_id)["snapshot"]["reconciliation"]
    assert reconciliation["otherAdjustmentQuantity"] == 0.0  # +0.9 kg reversal is POS-explained


def test_finalized_close_freezes_the_negative_position_while_the_live_report_follows_receipts(app, client, beef_world):
    organization_id, location_id, beef_id = beef_world
    _apply_order(organization_id)
    opened = client.post("/api/pilot/daily-close", headers=csrf_headers(client), json={"locationId": location_id, "businessDate": DAY})
    assert opened.status_code == 200, opened.get_data(as_text=True)
    session_id = opened.get_json()["session"]["id"]
    finalized = client.post(f"/api/pilot/daily-close/{session_id}/finalize", headers=csrf_headers(client))
    assert finalized.status_code == 200, finalized.get_data(as_text=True)

    _receive(client, beef_id, 10, 2)
    assert _negative(client)["count"] == 0
    frozen = _daily_close(client, location_id)["snapshot"]
    assert frozen["negativeStock"]["items"][0]["onHand"] == -1.8


# --------------------------------------------------------------------------------------------------
# Clover differs from Square: disabled by default, its own source types and provider label
# --------------------------------------------------------------------------------------------------
from backend.tests.test_daily_close_clover import (  # noqa: E402  (fixtures + helpers shared with the Clover Daily Close suite)
    _apply,
    _close,
    _engine_order,
    _engine_world,
    cafe,  # noqa: F401
    no_square,  # noqa: F401
)


def test_clover_inventory_is_off_by_default_so_a_clover_sale_never_creates_a_negative_position(app, client, cafe):  # noqa: F811
    org, location, connection = cafe
    assert app.config.get("CLOVER_ORDER_INVENTORY_ENABLED", False) is False
    from backend.tests.test_daily_close_clover import _item

    chicken, buns = _item(org, location, "Chicken", "kg", "12.50"), _item(org, location, "Buns", "pack", "2.00")
    chicken.current_on_hand = Decimal("0.10")
    db.session.commit()
    order, _ = _engine_order(org, location, connection, chicken, buns)
    assert _apply(order, connection)["applied"] is False  # flag off: nothing is written

    assert db.session.get(InventoryItem, chicken.id).current_on_hand == Decimal("0.1000")
    assert _negative(client)["count"] == 0
    assert "negativeStock" not in _close(client, location.id)[0]


def test_verified_clover_consumption_crossing_zero_is_labelled_clover_and_not_double_counted(app, client, cafe, monkeypatch):  # noqa: F811
    org, location, connection = cafe
    chicken, buns = _engine_world(app, monkeypatch, org, location, connection)  # flag on in this controlled test app only
    chicken.current_on_hand = Decimal("0.10")  # recipe uses 0.18 kg: 0.10 - 0.18 = -0.08
    db.session.commit()
    order, _ = _engine_order(org, location, connection, chicken, buns)
    before, _ = _close(client, location.id)
    assert _apply(order, connection)["applied"] is True
    for movement in InventoryMovement.query.filter_by(organization_id=org.id):
        movement.created_at = IN_DAY
    db.session.commit()

    position = _negative(client)["items"][0]
    assert (position["inventoryItemName"], position["onHand"], position["shortfall"], position["unit"]) == ("Chicken", -0.08, 0.08, "kg")
    assert (position["cause"], position["provider"], position["orderCount"], position["posConsumedQuantity"]) == ("pos_sale", "Clover", 1, 0.18)
    assert position["explanation"] == "1 Clover order used 0.18 kg before enough stock was received; on hand is -0.08 kg. Record the delivery or count the item to reconcile."

    snapshot, _ = _close(client, location.id)
    assert snapshot["negativeStock"]["items"][0]["provider"] == "Clover"
    assert [a["detail"] for a in snapshot["attentionItems"] if a["type"] == "negative_stock"] == ["On hand: Chicken -0.08 kg (Clover sales)."]
    assert snapshot["reconciliation"]["otherAdjustmentQuantity"] == 0.0
    assert snapshot["reconciliation"]["unexplainedVarianceQuantity"] == before["reconciliation"].get("unexplainedVarianceQuantity")
    assert snapshot["foodCost"]["usageCostCents"] == 275  # cost is the ledger-based usage; negative stock adds none


def test_square_and_clover_locations_do_not_borrow_each_others_labels(app, client, beef_world):
    organization_id, _, beef_id = beef_world
    _apply_order(organization_id)
    position = _negative(client)["items"][0]
    assert position["provider"] == "Square" and "Clover" not in position["explanation"]


# --------------------------------------------------------------------------------------------------
# Independent acceptance findings (Codex, issue #237 comment 6689009842)
# --------------------------------------------------------------------------------------------------
PARITY = {"onHand": -1.8, "shortfall": 1.8, "cause": "pos_sale", "posConsumedQuantity": 1.8, "orderCount": 1, "reviewOrderCount": 0}


def _core(position):
    return {key: position[key] for key in PARITY}


def _make_in_day(organization_id):
    for movement in InventoryMovement.query.filter_by(organization_id=organization_id):
        movement.created_at = IN_DAY
    db.session.commit()


def test_reorder_api_keeps_the_actual_negative_quantity_and_the_report_explains_it(app, client, beef_world):
    organization_id, _, beef_id = beef_world
    beef = db.session.get(InventoryItem, beef_id)
    beef.min_quantity, beef.par_level = Decimal("2"), Decimal("10")
    db.session.commit()
    _apply_order(organization_id)

    suggestion = next(s for s in client.get("/api/pilot/reorder-plan").get_json()["suggestions"] if s["inventoryItemId"] == beef_id)
    # The reorder API reports the real quantity (never clamped to zero) and the shortfall is ordered on top of PAR:
    # 10 PAR - (-1.8) on hand = 11.8 kg.
    assert (suggestion["currentQuantity"], suggestion["stockStatus"], suggestion["suggestedQuantity"]) == (-1.8, "Out of stock", 11.8)
    position = next(p for p in _negative(client)["items"] if p["inventoryItemId"] == beef_id)
    assert _core(position) == PARITY and position["onHand"] == suggestion["currentQuantity"]
    # Manual guards are unchanged by the report: still no ledger write.
    movements = InventoryMovement.query.filter_by(inventory_item_id=beef_id).count()
    assert client.post(f"/api/pilot/inventory/items/{beef_id}/adjustments", headers=csrf_headers(client), json={
        "reason": "x", "quantityDelta": "-0.5", "movementType": "manual decrease", "sourceRecordId": f"g-{uuid4().hex}", "sourceLineId": "m",
    }).status_code == 400
    assert InventoryMovement.query.filter_by(inventory_item_id=beef_id).count() == movements


def test_square_late_receipt_keeps_the_pos_movement_and_is_not_an_unexplained_adjustment(app, client, beef_world):
    organization_id, location_id, beef_id = beef_world
    _apply_order(organization_id)
    _receive(client, beef_id, 10, 2)  # -1.8 + 10 = 8.2 kg; weighted cost restarts at the receipt's $2.00/kg
    _make_in_day(organization_id)

    types = [m.source_type for m in InventoryMovement.query.filter_by(inventory_item_id=beef_id).order_by(InventoryMovement.id)]
    assert types == ["square sale consumption", "invoice receipt"]  # the POS movement stays attributable
    item = db.session.get(InventoryItem, beef_id)
    assert (Decimal(item.current_on_hand), Decimal(item.average_unit_cost)) == (Decimal("8.2000"), Decimal("2.00"))
    assert_ledger_reconciles(beef_id, opening="0", expected_on_hand="8.2")
    snapshot = _daily_close(client, location_id)["snapshot"]
    assert "negativeStock" not in snapshot and not any(a["type"] == "negative_stock" for a in snapshot["attentionItems"])
    assert snapshot["reconciliation"]["otherAdjustmentQuantity"] == 0.0  # neither the sale nor the receipt is an adjustment
    assert snapshot["reconciliation"]["unexplainedVarianceQuantity"] is None


def test_square_negative_close_never_claims_variance_or_a_reconciled_close_without_count_evidence(app, client, beef_world):
    organization_id, location_id, beef_id = beef_world
    _apply_order(organization_id)
    _make_in_day(organization_id)
    snapshot = _daily_close(client, location_id)["snapshot"]

    assert snapshot["healthStatus"] == "Ready with warnings"  # not "Ready" / "Reconciled"
    assert snapshot["usage"]["totals"]["actualUsage"] is None
    assert (snapshot["variance"]["quantity"], snapshot["variance"]["percent"]) == (None, None)
    assert snapshot["reconciliation"]["unexplainedVarianceQuantity"] is None


def test_mixed_units_keep_aggregate_usage_unavailable_while_the_negative_is_flagged(app, client, beef_world):
    from backend.models import Recipe, RecipeIngredient

    organization_id, location_id, beef_id = beef_world
    recipe = Recipe.query.filter_by(organization_id=organization_id, name="Classic Cheeseburger").one()
    milk = InventoryItem(organization_id=organization_id, location_id=location_id, name="Milk", normalized_name="milk", stock_unit="L",
                         current_on_hand=Decimal("50"), average_unit_cost=Decimal("2"), active=True)
    db.session.add(milk)
    db.session.flush()
    db.session.add(RecipeIngredient(organization_id=organization_id, recipe_id=recipe.id, inventory_item_id=milk.id,
                                    quantity_required=Decimal("0.05"), unit="L", notes="", sort_order=1))
    order = SquareOrder.query.filter_by(square_order_id="ORDER-1").one()
    order.ordered_at = order.closed_at = IN_DAY  # sold on the business day being closed
    db.session.commit()
    _apply_order(organization_id)
    _make_in_day(organization_id)

    snapshot = _daily_close(client, location_id)["snapshot"]
    assert {r["unit"] for r in snapshot["usage"]["ingredientUsage"]} == {"kg", "L"}
    assert snapshot["usage"]["totals"]["theoreticalUsage"] is None and snapshot["usage"]["totals"]["actualUsage"] is None
    assert snapshot["negativeStock"]["items"][0]["inventoryItemName"] == "Beef"  # only Beef is below zero; Milk 50 - 0.5 L is not
    assert [i["inventoryItemName"] for i in snapshot["negativeStock"]["items"]] == ["Beef"]
    assert snapshot["healthStatus"] == "Ready with warnings"


def test_a_square_order_cancelled_after_consumption_restores_stock_and_makes_no_negative_or_variance_claim(app, client, beef_world):
    organization_id, location_id, beef_id = beef_world
    _apply_order(organization_id)
    assert _negative(client)["count"] == 1
    order = SquareOrder.query.filter_by(square_order_id="ORDER-1").one()
    order.order_state = "CANCELED"
    db.session.commit()
    _apply_order(organization_id)
    _make_in_day(organization_id)

    assert [m.source_type for m in InventoryMovement.query.filter_by(inventory_item_id=beef_id).order_by(InventoryMovement.id)] == [
        "square sale consumption", "square sale reversal",
    ]
    assert _negative(client) == {"count": 0, "posCausedCount": 0, "items": []}
    assert_ledger_reconciles(beef_id, opening="0", expected_on_hand="0")
    snapshot = _daily_close_snapshot_for(client, location_id)
    assert "negativeStock" not in snapshot
    assert snapshot["reconciliation"]["otherAdjustmentQuantity"] == 0.0  # the reversal is POS-explained, not an adjustment
    assert snapshot["reconciliation"]["unexplainedVarianceQuantity"] is None


def _daily_close_snapshot_for(client, location_id):
    return _daily_close(client, location_id)["snapshot"]


# ---- Clover ---------------------------------------------------------------------------------------
def test_clover_and_square_report_the_same_quantities_for_the_same_sale_and_clover_replay_is_idempotent(app, client, cafe, monkeypatch):  # noqa: F811
    org, location, connection = cafe
    chicken, buns = _engine_world(app, monkeypatch, org, location, connection)
    chicken.current_on_hand = Decimal("0")
    db.session.commit()
    order, _ = _engine_order(org, location, connection, chicken, buns, chicken_qty="1.8000")  # 1.8 kg consumed from 0
    assert _apply(order, connection)["applied"] is True
    movements = InventoryMovement.query.filter_by(inventory_item_id=chicken.id).count()
    assert _apply(order, connection)["alreadyApplied"]
    assert InventoryMovement.query.filter_by(inventory_item_id=chicken.id).count() == movements == 1

    position = _negative(client)["items"][0]
    assert _core(position) == PARITY  # identical to the Square position in test_verified_square_sale_is_reported...
    assert position["provider"] == "Clover" and "Clover order" in position["explanation"]
    reorder = client.get("/api/pilot/reorder-plan").get_json()
    assert next(i for i in reorder["inventoryItems"] if i["id"] == chicken.id)["currentOnHand"] == -1.8
    assert db.session.get(InventoryItem, chicken.id).average_unit_cost == Decimal("12.5000")  # POS consumption never changes cost


def test_clover_late_receipt_reconciles_ledger_and_cost_and_is_not_an_adjustment(app, client, cafe, monkeypatch):  # noqa: F811
    org, location, connection = cafe
    chicken, buns = _engine_world(app, monkeypatch, org, location, connection)
    chicken.current_on_hand = Decimal("0")
    db.session.commit()
    order, _ = _engine_order(org, location, connection, chicken, buns)  # 0.18 kg
    _apply(order, connection)
    assert _negative(client)["items"][0]["onHand"] == -0.18

    _receive(client, chicken.id, 5, 10)  # -0.18 + 5 = 4.82 kg at $10.00/kg
    _make_in_day(org.id)

    item = db.session.get(InventoryItem, chicken.id)
    assert (Decimal(item.current_on_hand), Decimal(item.average_unit_cost)) == (Decimal("4.8200"), Decimal("10.00"))
    assert [m.source_type for m in InventoryMovement.query.filter_by(inventory_item_id=chicken.id).order_by(InventoryMovement.id)] == [
        "clover sale consumption", "invoice receipt",
    ]
    assert_ledger_reconciles(chicken.id, opening="0", expected_on_hand="4.82")
    snapshot, _ = _close(client, location.id)
    assert "negativeStock" not in snapshot and snapshot["reconciliation"]["otherAdjustmentQuantity"] == 0.0


def test_clover_close_with_a_negative_is_a_review_state_with_no_variance_claim(app, client, cafe, monkeypatch):  # noqa: F811
    org, location, connection = cafe
    chicken, buns = _engine_world(app, monkeypatch, org, location, connection)
    chicken.current_on_hand = Decimal("0.10")
    db.session.commit()
    order, line = _engine_order(org, location, connection, chicken, buns)
    _apply(order, connection)
    _make_in_day(org.id)
    snapshot, _ = _close(client, location.id)

    assert snapshot["healthStatus"] == "Ready with warnings"
    assert (snapshot["variance"]["quantity"], snapshot["variance"]["percent"]) == (None, None)
    assert snapshot["reconciliation"]["otherAdjustmentQuantity"] == 0.0
    assert snapshot["negativeStock"]["items"][0]["onHand"] == -0.08

    # A later recipe correction writes a 'clover sale correction' movement: still POS-explained, never an adjustment.
    from sqlalchemy.orm.attributes import flag_modified

    line.recipe_preview_json["ingredients"][0]["quantity"] = "0.1200"
    flag_modified(line, "recipe_preview_json")
    db.session.flush()
    _apply(order, connection)
    _make_in_day(org.id)
    corrected, _ = _close(client, location.id)
    assert [m.source_type for m in InventoryMovement.query.filter_by(inventory_item_id=chicken.id).order_by(InventoryMovement.id)] == [
        "clover sale consumption", "clover sale correction",
    ]
    assert corrected["reconciliation"]["otherAdjustmentQuantity"] == 0.0
    # 0.10 - 0.18 + 0.06 (corrected to 0.12 kg used) = -0.02: still short, now by the net 0.12 kg the order used.
    position = corrected["negativeStock"]["items"][0]
    assert (position["onHand"], position["posConsumedQuantity"], position["orderCount"]) == (-0.02, 0.12, 1)


def test_clover_order_cancelled_after_consumption_stays_attributable_but_is_marked_for_review(app, client, cafe, monkeypatch):  # noqa: F811
    org, location, connection = cafe
    chicken, buns = _engine_world(app, monkeypatch, org, location, connection)
    chicken.current_on_hand = Decimal("0.10")
    db.session.commit()
    order, _ = _engine_order(org, location, connection, chicken, buns)
    _apply(order, connection)
    assert db.session.get(InventoryItem, chicken.id).current_on_hand == Decimal("-0.0800")

    order.normalized_status, order.provider_status = "cancelled", "DELETED"
    db.session.commit()
    assert _apply(order, connection)["applied"] is False  # Clover never auto-restocks
    assert db.session.get(InventoryItem, chicken.id).current_on_hand == Decimal("-0.0800")
    _make_in_day(org.id)

    position = _negative(client)["items"][0]
    assert (position["onHand"], position["cause"], position["reviewOrderCount"]) == (-0.08, "pos_sale", 1)
    assert position["explanation"].endswith("1 of those orders was cancelled or flagged for review after stock was used; the stock was not restored.")
    snapshot, exceptions = _close(client, location.id)
    types = {a["type"] for a in snapshot["attentionItems"]}
    assert {"clover_cancelled_after_inventory", "negative_stock"} <= types  # a distinct review state, not a normal ready close
    assert "Clover order cancelled after inventory was applied." in exceptions
    assert snapshot["healthStatus"] == "Ready with warnings"
    assert [a["detail"] for a in snapshot["attentionItems"] if a["type"] == "negative_stock"] == ["On hand: Chicken -0.08 kg (Clover sales, order under review)."]
    assert snapshot["usage"]["availability"]["usageAvailable"] is False and snapshot["foodCost"]["available"] is False
    assert snapshot["reconciliation"]["otherAdjustmentQuantity"] == 0.0
