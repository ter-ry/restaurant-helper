"""Issue #252 (owner decision #249 Option A): positive receipts may partially repair POS-negative stock.

Quantities are hand-calculated: POS sale -> -1.8 kg; +1 kg receipt -> -0.8; +1 kg -> +0.2.
Manual decreases must still never create or worsen a negative position.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement, SquareConnection, SquareOrder, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.test_inventory_reconciliation import assert_ledger_reconciles
from backend.tests.test_pilot_api import csrf_headers, login, select_org
from backend.tests.test_square_integration import _create_square_usage_fixture


def _negative_beef(app, client, name):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
    organization, location = _create_square_usage_fixture(app, owner, organization_name=f"{name} {uuid4().hex[:8]}")
    select_org(client, organization.id)
    with app.app_context():
        connection = SquareConnection.query.filter_by(organization_id=organization.id).one()
        connection.inventory_depletion_activated_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
        item = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, name="Beef").one()
        item.current_on_hand = Decimal("0")
        item.average_unit_cost = Decimal("7.25")
        order = SquareOrder.query.filter_by(square_connection_id=connection.id, square_order_id="ORDER-1").one()
        from backend.square_integration import _apply_square_order_inventory_consumption

        _apply_square_order_inventory_consumption(organization, connection, order)
        db.session.commit()
        assert Decimal(item.current_on_hand) == Decimal("-1.8000")
        return item.id


def _receive(client, item_id, quantity, unit_price="2"):
    supplier = f"Partial Supplier {uuid4().hex[:8]}"
    assert client.post("/api/pilot/suppliers", headers=csrf_headers(client), json={"name": supplier, "isActive": True}).status_code == 201
    total = Decimal(quantity) * Decimal(unit_price)
    created = client.post(
        "/api/pilot/purchases/invoices",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier, "invoiceNumber": f"PR-{uuid4().hex[:8].upper()}", "invoiceDate": "2026-07-16",
            "subtotal": float(total), "tax": 0, "totalAmount": float(total), "notes": "", "status": "Ready",
            "sourceFileName": "p.pdf", "sourceFileType": "application/pdf", "extractionStatus": "manual", "extractedText": "p",
            "lineItems": [{
                "description": "Beef", "inventoryItemId": item_id, "purchaseUnit": "kg", "inventoryUnit": "kg",
                "conversionFactor": 1, "quantity": float(quantity), "unitPrice": float(unit_price), "lineTotal": float(total),
                "confidence": 0.99, "needsReview": False, "note": "",
            }],
        },
    )
    assert created.status_code == 201, created.get_json()
    invoice_id = created.get_json()["id"]
    return invoice_id, client.post(f"/api/pilot/purchases/invoices/{invoice_id}/receive", headers=csrf_headers(client))


def _adjust(client, item_id, delta, movement_type):
    return client.post(
        f"/api/pilot/inventory/items/{item_id}/adjustments",
        headers=csrf_headers(client),
        json={"reason": "partial receipt policy", "quantityDelta": delta, "movementType": movement_type,
              "sourceRecordId": f"p-{uuid4().hex}", "sourceLineId": "manual"},
    )


def test_partial_receipts_repair_negative_in_steps_and_replay_is_rejected(app, client):
    item_id = _negative_beef(app, client, "Partial Receipt")

    first_id, first = _receive(client, item_id, "1")
    assert first.status_code == 200, first.get_json()
    with app.app_context():
        item = db.session.get(InventoryItem, item_id)
        assert Decimal(item.current_on_hand) == Decimal("-0.8000")
        assert Decimal(item.average_unit_cost) == Decimal("2.00")

    replay = client.post(f"/api/pilot/purchases/invoices/{first_id}/receive", headers=csrf_headers(client))
    assert replay.status_code == 409
    with app.app_context():
        assert Decimal(db.session.get(InventoryItem, item_id).current_on_hand) == Decimal("-0.8000")
        assert InventoryMovement.query.filter_by(inventory_item_id=item_id, source_type="invoice receipt").count() == 1

    _, second = _receive(client, item_id, "1")
    assert second.status_code == 200, second.get_json()
    with app.app_context():
        item = db.session.get(InventoryItem, item_id)
        assert Decimal(item.current_on_hand) == Decimal("0.2000")
        assert_ledger_reconciles(item_id, opening="0", expected_on_hand="0.2")
        receipts = InventoryMovement.query.filter_by(inventory_item_id=item_id, source_type="invoice receipt").order_by(InventoryMovement.id).all()
        assert [(Decimal(m.quantity_before), Decimal(m.quantity_after)) for m in receipts] == [
            (Decimal("-1.8"), Decimal("-0.8")), (Decimal("-0.8"), Decimal("0.2"))]


def test_manual_increase_may_partially_repair_but_decrease_cannot_worsen_negative(app, client):
    item_id = _negative_beef(app, client, "Manual Negative")

    for movement_type in ("manual decrease", "waste"):
        blocked = _adjust(client, item_id, "0.1", movement_type)
        assert blocked.status_code == 400
    with app.app_context():
        assert Decimal(db.session.get(InventoryItem, item_id).current_on_hand) == Decimal("-1.8000")

    ok = _adjust(client, item_id, "1", "manual increase")
    assert ok.status_code == 201, ok.get_json()
    with app.app_context():
        assert Decimal(db.session.get(InventoryItem, item_id).current_on_hand) == Decimal("-0.8000")
        assert_ledger_reconciles(item_id, opening="0", expected_on_hand="-0.8")

    movement_id = ok.get_json()["id"]
    # Reversing the increase would worsen the negative again, so it must be refused with nothing written.
    reversal = client.post(
        f"/api/pilot/inventory/movements/{movement_id}/reverse",
        headers=csrf_headers(client),
        json={"reason": "undo", "idempotencyKey": f"rev-{uuid4().hex}"},
    )
    assert reversal.status_code == 409, reversal.get_json()
    with app.app_context():
        assert Decimal(db.session.get(InventoryItem, item_id).current_on_hand) == Decimal("-0.8000")
