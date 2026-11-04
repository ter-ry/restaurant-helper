"""Inventory ledger / on-hand / weighted-average cost reconciliation (issue #192).

Drives the real pilot endpoints through a realistic day and asserts the movement
ledger reconciles to on-hand. Expected values are computed by hand in this file,
never by importing production costing helpers.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement
from backend.models import User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.test_pilot_api import csrf_headers, login
from backend.tests.test_square_integration import _create_square_usage_fixture


def _movements(item_id: int) -> list[InventoryMovement]:
    return InventoryMovement.query.filter_by(inventory_item_id=item_id).order_by(InventoryMovement.id).all()


def assert_ledger_reconciles(item_id: int, *, expected_on_hand: str, opening: str = "0") -> None:
    """opening + sum(deltas) == on-hand and every movement chains before + delta == after."""
    item = db.session.get(InventoryItem, item_id)
    movements = _movements(item_id)
    running = Decimal(opening)
    for movement in movements:
        assert Decimal(movement.quantity_before) == running, f"chain broken at movement {movement.id}"
        assert Decimal(movement.quantity_before) + Decimal(movement.quantity_delta) == Decimal(movement.quantity_after)
        running = Decimal(movement.quantity_after)
    assert Decimal(opening) + sum((Decimal(m.quantity_delta) for m in movements), Decimal("0")) == Decimal(item.current_on_hand)
    assert Decimal(item.current_on_hand) == Decimal(expected_on_hand)


def _create_item(client, name: str, supplier: str) -> dict:
    response = client.post(
        "/api/pilot/inventory/items",
        headers=csrf_headers(client),
        json={
            "name": name,
            "category": "Dry goods",
            "stockUnit": "kg",
            "currentOnHand": 0,
            "minQuantity": 1,
            "parLevel": 5,
            "preferredSupplierName": supplier,
            "latestPurchasePrice": 2,
            "lastPurchaseUnit": "case",
            "lastPurchaseConversionFactor": 10,
            "averageDailyUsage": 1,
        },
    )
    assert response.status_code == 201
    return response.get_json()


def _create_invoice(client, supplier: str, item_id: int, *, cases: int, case_price: float) -> dict:
    subtotal = round(cases * case_price, 2)
    response = client.post(
        "/api/pilot/purchases/invoices",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier,
            "invoiceNumber": f"REC-{uuid4().hex[:8].upper()}",
            "invoiceDate": "2026-07-16",
            "subtotal": subtotal,
            "tax": 0,
            "totalAmount": subtotal,
            "notes": "reconciliation",
            "status": "Ready",
            "sourceFileName": "recon.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "manual",
            "extractedText": "recon",
            "lineItems": [
                {
                    "description": "Recon Flour 10kg",
                    "inventoryItemId": item_id,
                    "purchaseUnit": "case",
                    "inventoryUnit": "kg",
                    "conversionFactor": 10,
                    "quantity": cases,
                    "unitPrice": case_price,
                    "lineTotal": subtotal,
                    "confidence": 0.99,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert response.status_code == 201
    return response.get_json()


def _adjust(client, item_id: int, delta: float, movement_type: str, key: str):
    return client.post(
        f"/api/pilot/inventory/items/{item_id}/adjustments",
        headers=csrf_headers(client),
        json={"reason": "reconciliation", "quantityDelta": delta, "movementType": movement_type, "sourceRecordId": key, "sourceLineId": key},
    )


def test_pilot_day_ledger_reconciles_with_independent_weighted_average(app, client):
    login(client)
    supplier = f"Recon Supplier {uuid4().hex[:6]}"
    assert client.post("/api/pilot/suppliers", headers=csrf_headers(client), json={"name": supplier, "isActive": True}).status_code == 201
    item = _create_item(client, f"Recon Flour {uuid4().hex[:6]}", supplier)
    item_id = item["id"]

    # Receipt 1: 1 case of 10 kg at $20.00/case => $2.00/kg. Avg cost = 2.00, on-hand 10.
    first = _create_invoice(client, supplier, item_id, cases=1, case_price=20)
    assert client.post(f"/api/pilot/purchases/invoices/{first['id']}/receive", headers=csrf_headers(client)).status_code == 200
    with app.app_context():
        assert Decimal(db.session.get(InventoryItem, item_id).average_unit_cost) == Decimal("2")
        assert_ledger_reconciles(item_id, expected_on_hand="10")

    # Receipt 2: 1 case of 10 kg at $30.00/case => $3.00/kg.
    # Independent expectation: (10 * 2.00 + 10 * 3.00) / 20 = 2.50.
    second = _create_invoice(client, supplier, item_id, cases=1, case_price=30)
    assert client.post(f"/api/pilot/purchases/invoices/{second['id']}/receive", headers=csrf_headers(client)).status_code == 200
    with app.app_context():
        assert Decimal(db.session.get(InventoryItem, item_id).average_unit_cost) == Decimal("2.5")
        assert_ledger_reconciles(item_id, expected_on_hand="20")

    # Duplicate receive is rejected and adds no movement.
    with app.app_context():
        count_before = len(_movements(item_id))
    assert client.post(f"/api/pilot/purchases/invoices/{second['id']}/receive", headers=csrf_headers(client)).status_code == 409
    with app.app_context():
        assert len(_movements(item_id)) == count_before

    # Manual increase +2 and waste -3: on-hand 19; usage movements never reprice stock.
    assert _adjust(client, item_id, 2, "manual increase", "recon-up").status_code == 201
    waste = client.post(
        "/api/pilot/inventory/waste-events",
        headers=csrf_headers(client),
        json={"inventoryItemId": item_id, "quantity": 3, "unit": "kg", "reason": "spoilage / expired"},
    )
    assert waste.status_code == 201, waste.get_json()
    with app.app_context():
        assert Decimal(db.session.get(InventoryItem, item_id).average_unit_cost) == Decimal("2.5")
        assert_ledger_reconciles(item_id, expected_on_hand="19")

    # Failure cases: negative stock is rejected for adjustments and waste, with no movement written.
    with app.app_context():
        count_before = len(_movements(item_id))
    assert _adjust(client, item_id, 25, "manual decrease", "recon-too-much").status_code == 400
    too_much_waste = client.post(
        "/api/pilot/inventory/waste-events",
        headers=csrf_headers(client),
        json={"inventoryItemId": item_id, "quantity": 25, "unit": "kg", "reason": "spoilage / expired"},
    )
    assert too_much_waste.status_code == 400
    with app.app_context():
        assert len(_movements(item_id)) == count_before

    # Stock count: system says 19, counted 17 => -2 reconciliation movement, on-hand 17.
    session = client.post(
        "/api/pilot/inventory/count-sessions",
        headers=csrf_headers(client),
        json={"countedBy": "Recon", "notes": "", "itemIds": [item_id]},
    ).get_json()
    line = session["lines"][0]
    assert client.patch(
        f"/api/pilot/inventory/count-sessions/{session['id']}",
        headers=csrf_headers(client),
        json={"countedBy": "Recon", "notes": "", "lines": [{"id": line["id"], "countedQuantity": 17, "note": ""}]},
    ).status_code == 200
    assert client.post(f"/api/pilot/inventory/count-sessions/{session['id']}/finalize", headers=csrf_headers(client)).status_code == 200
    with app.app_context():
        assert_ledger_reconciles(item_id, expected_on_hand="17")
        count_movements = len(_movements(item_id))

    # Replayed finalize must not write another movement.
    client.post(f"/api/pilot/inventory/count-sessions/{session['id']}/finalize", headers=csrf_headers(client))
    with app.app_context():
        assert len(_movements(item_id)) == count_movements
        assert_ledger_reconciles(item_id, expected_on_hand="17")

    # Correcting the second receipt removes 10 kg valued at its $3.00 receipt cost.
    # Independent expectation: stock value 17 * 2.50 = 42.50, minus 10 * 3.00 = 30.00 => 12.50 / 7 kg = 1.785714/kg.
    correction = client.post(
        f"/api/pilot/purchases/invoices/{second['id']}/correct",
        headers=csrf_headers(client),
        json={"reason": "Reconciliation correction"},
    )
    assert correction.status_code == 200
    with app.app_context():
        assert_ledger_reconciles(item_id, expected_on_hand="7")
        assert Decimal(db.session.get(InventoryItem, item_id).average_unit_cost) == pytest.approx(Decimal("1.785714"), abs=Decimal("0.000001"))
    repeat = client.post(f"/api/pilot/purchases/invoices/{second['id']}/correct", headers=csrf_headers(client), json={"reason": "again"})
    assert repeat.status_code in {400, 409}
    with app.app_context():
        assert_ledger_reconciles(item_id, expected_on_hand="7")


def test_square_sale_consumption_reversal_and_replay_reconcile_to_on_hand(app, client):
    from datetime import datetime, timezone

    from backend.models import SquareConnection, SquareOrder
    from backend.square_integration import _apply_square_order_inventory_consumption

    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization, location = _create_square_usage_fixture(app, owner, organization_name=f"Recon Square {uuid4().hex[:6]}")

    with app.app_context():
        connection = SquareConnection.query.filter_by(organization_id=organization.id).one()
        connection.inventory_depletion_activated_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
        beef = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, name="Beef").one()
        beef.average_unit_cost = Decimal("7.25")
        beef_id = beef.id
        order = SquareOrder.query.filter_by(square_connection_id=connection.id, square_order_id="ORDER-1").one()

        def apply() -> int:
            _apply_square_order_inventory_consumption(organization, connection, order)
            db.session.commit()
            return len(_movements(beef_id))

        # Sale consumes 1.8 kg (20 -> 18.2); a webhook replay adds nothing.
        assert apply() == 1
        assert_ledger_reconciles(beef_id, opening="20", expected_on_hand="18.2")
        assert apply() == 1

        # Edited order (quantity 5 => 0.9 kg) writes a single compensating movement.
        order.lines[0].quantity = Decimal("5")
        assert apply() == 2
        assert_ledger_reconciles(beef_id, opening="20", expected_on_hand="19.1")
        assert apply() == 2

        # Cancellation fully reverses stock to the opening balance; replay adds nothing.
        order.order_state = "CANCELED"
        assert apply() == 3
        assert_ledger_reconciles(beef_id, opening="20", expected_on_hand="20")
        assert apply() == 3

        # Sales and reversals never reprice stock.
        assert Decimal(db.session.get(InventoryItem, beef_id).average_unit_cost) == Decimal("7.25")
