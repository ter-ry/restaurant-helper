"""Acceptance coverage for owner decision #199 Option A (issue #230).

The expected quantities in these tests are hand-calculated.  Manual inventory
corrections and receipts must stay non-negative; verified POS consumption may
cross zero and remains visible in the movement ledger for later reconciliation.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement, SquareConnection, SquareOrder, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_inventory_reconciliation import assert_ledger_reconciles
from backend.tests.test_pilot_api import csrf_headers, login, select_org
from backend.tests.test_square_integration import _create_square_usage_fixture


def test_manual_adjustment_rejects_below_zero_without_ledger_write(app, client):
    login(client)

    with app.app_context():
        item = InventoryItem.query.filter_by(name="Eggs").one()
        item_id = item.id
        before = Decimal(item.current_on_hand)
        movement_count = InventoryMovement.query.filter_by(inventory_item_id=item_id).count()

    response = client.post(
        f"/api/pilot/inventory/items/{item_id}/adjustments",
        headers=csrf_headers(client),
        json={
            "reason": "Option A negative-stock acceptance",
            "quantityDelta": "0.25",
            "movementType": "manual decrease",
            "sourceRecordId": f"negative-policy-{uuid4().hex}",
            "sourceLineId": "manual",
        },
    )

    assert response.status_code == 400
    assert response.get_json()["errors"]["quantityDelta"] == "Quantity cannot reduce stock below zero."
    with app.app_context():
        assert Decimal(db.session.get(InventoryItem, item_id).current_on_hand) == before
        assert InventoryMovement.query.filter_by(inventory_item_id=item_id).count() == movement_count


def test_verified_square_consumption_may_cross_zero_and_replay_is_idempotent(app, client):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
    organization, location = _create_square_usage_fixture(
        app, owner, organization_name=f"Negative POS {uuid4().hex[:8]}"
    )

    with app.app_context():
        connection = SquareConnection.query.filter_by(organization_id=organization.id).one()
        connection.inventory_depletion_activated_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
        item = InventoryItem.query.filter_by(
            organization_id=organization.id, location_id=location.id, name="Beef"
        ).one()
        item.current_on_hand = Decimal("0")
        item.average_unit_cost = Decimal("7.25")
        order = SquareOrder.query.filter_by(
            square_connection_id=connection.id, square_order_id="ORDER-1"
        ).one()

        from backend.square_integration import _apply_square_order_inventory_consumption

        _apply_square_order_inventory_consumption(organization, connection, order)
        db.session.commit()
        movement_count = InventoryMovement.query.filter_by(source_record_id="ORDER-1").count()

        assert Decimal(item.current_on_hand) == Decimal("-1.8000")
        assert Decimal(item.average_unit_cost) == Decimal("7.25")
        assert_ledger_reconciles(item.id, opening="0", expected_on_hand="-1.8")

        _apply_square_order_inventory_consumption(organization, connection, order)
        db.session.commit()
        assert InventoryMovement.query.filter_by(source_record_id="ORDER-1").count() == movement_count
        assert Decimal(db.session.get(InventoryItem, item.id).current_on_hand) == Decimal("-1.8000")


def test_late_receipt_reconciles_prior_pos_negative_and_sets_receipt_cost(app, client):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
    organization, location = _create_square_usage_fixture(
        app, owner, organization_name=f"Late Receipt {uuid4().hex[:8]}"
    )
    select_org(client, organization.id)

    with app.app_context():
        connection = SquareConnection.query.filter_by(organization_id=organization.id).one()
        connection.inventory_depletion_activated_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
        item = InventoryItem.query.filter_by(
            organization_id=organization.id, location_id=location.id, name="Beef"
        ).one()
        item.current_on_hand = Decimal("0")
        item.average_unit_cost = Decimal("7.25")
        item_id = item.id
        order = SquareOrder.query.filter_by(
            square_connection_id=connection.id, square_order_id="ORDER-1"
        ).one()
        from backend.square_integration import _apply_square_order_inventory_consumption

        _apply_square_order_inventory_consumption(organization, connection, order)
        db.session.commit()

    # One 10 kg receipt at $20 arrives after the 1.8 kg POS consumption:
    # 0 - 1.8 + 10 = 8.2 kg, with $2.00/kg receipt cost.
    supplier_name = f"Late Receipt Supplier {uuid4().hex[:8]}"
    assert client.post(
        "/api/pilot/suppliers",
        headers=csrf_headers(client),
        json={"name": supplier_name, "isActive": True},
    ).status_code == 201
    invoice_response = client.post(
        "/api/pilot/purchases/invoices",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": f"LATE-{uuid4().hex[:8].upper()}",
            "invoiceDate": "2026-07-16",
            "subtotal": 20,
            "tax": 0,
            "totalAmount": 20,
            "notes": "receipt after POS consumption",
            "status": "Ready",
            "sourceFileName": "late-receipt.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "manual",
            "extractedText": "late receipt",
            "lineItems": [{
                "description": "Beef",
                "inventoryItemId": item_id,
                "purchaseUnit": "kg",
                "inventoryUnit": "kg",
                "conversionFactor": 1,
                "quantity": 10,
                "unitPrice": 2,
                "lineTotal": 20,
                "confidence": 0.99,
                "needsReview": False,
                "note": "",
            }],
        },
    )
    assert invoice_response.status_code == 201, invoice_response.get_json()
    invoice = invoice_response.get_json()
    assert client.post(
        f"/api/pilot/purchases/invoices/{invoice['id']}/receive",
        headers=csrf_headers(client),
    ).status_code == 200

    with app.app_context():
        item = db.session.get(InventoryItem, item_id)
        assert item is not None
        assert Decimal(item.current_on_hand) == Decimal("8.2000")
        assert Decimal(item.average_unit_cost) == Decimal("2.00")
        assert_ledger_reconciles(item_id, opening="0", expected_on_hand="8.2")
        assert InventoryMovement.query.filter_by(
            inventory_item_id=item_id, source_type="square sale consumption"
        ).count() == 1
        assert InventoryMovement.query.filter_by(
            inventory_item_id=item_id, source_type="invoice receipt"
        ).count() == 1


def test_inventory_adjustment_cannot_cross_tenant_boundary(app, client):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
    organization = make_operational_organization(
        owner,
        name=f"Other Tenant {uuid4().hex[:8]}",
        location_name="Other Kitchen",
    )
    location = organization.locations[0]
    with app.app_context():
        foreign_item = InventoryItem(
            organization_id=organization.id,
            location_id=location.id,
            name="Foreign Flour",
            normalized_name=f"foreign-flour-{uuid4().hex}",
            stock_unit="kg",
            current_on_hand=Decimal("4"),
            average_unit_cost=Decimal("2"),
        )
        db.session.add(foreign_item)
        db.session.commit()
        foreign_item_id = foreign_item.id

    # Keep the pilot organization selected; the foreign item must be invisible.
    response = client.post(
        f"/api/pilot/inventory/items/{foreign_item_id}/adjustments",
        headers=csrf_headers(client),
        json={
            "reason": "cross-tenant probe",
            "quantityDelta": 1,
            "movementType": "manual increase",
            "sourceRecordId": "cross-tenant",
            "sourceLineId": "cross-tenant",
        },
    )
    assert response.status_code == 404
    with app.app_context():
        assert Decimal(db.session.get(InventoryItem, foreign_item_id).current_on_hand) == Decimal("4")
        assert InventoryMovement.query.filter_by(inventory_item_id=foreign_item_id).count() == 0
