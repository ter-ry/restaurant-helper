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
