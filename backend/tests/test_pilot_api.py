from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from backend.extensions import db
from backend.models import DailyCloseSession, InventoryItem, InventoryMovement, Organization, OrganizationMembership, PurchaseInvoice, RestaurantLocation, ReorderIntent, SquareConnection, SquareDailySalesSummary, SquareLocation, SquareLocationMapping, StockCountSession, Supplier, SupplierItemMapping, User
from backend.seed import (
    LOCAL_LOCATION_NAME,
    LOCAL_MANAGER_EMAIL,
    LOCAL_MANAGER_PASSWORD,
    LOCAL_ORGANIZATION_NAME,
    LOCAL_OWNER_EMAIL,
    LOCAL_OWNER_PASSWORD,
)
from backend.tests.conftest import make_operational_organization
from backend.tests.test_square_integration import connect_square


def login(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 200


def login_manager(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": LOCAL_MANAGER_EMAIL, "password": LOCAL_MANAGER_PASSWORD},
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 200


def csrf_headers(client):
    return {"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]}


def select_org(client, organization_id: int):
    response = client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization_id})
    assert response.status_code == 200


def test_pilot_dashboard_and_inventory_smoke(client):
    login(client)

    bootstrap = client.get("/api/pilot/bootstrap")
    assert bootstrap.status_code == 200
    assert bootstrap.get_json()["currentLocation"]["name"] == "Flowtally Pilot Kitchen"

    dashboard = client.get("/api/pilot/dashboard")
    assert dashboard.status_code == 200
    dashboard_body = dashboard.get_json()
    assert dashboard_body["summary"]["inventoryReorderNowCount"] == 4
    assert dashboard_body["summary"]["inventoryOutOfStockCount"] == 1
    assert dashboard_body["summary"]["inventoryLowStockCount"] == 6
    assert dashboard_body["recentPriceChanges"]
    assert dashboard_body["operationalAttention"]["reorder"]["count"] == 11

    purchases = client.get("/api/pilot/purchases")
    assert purchases.status_code == 200
    purchases_body = purchases.get_json()
    assert purchases_body["exportReadiness"]["readyForCsv"] >= 6
    assert purchases_body["summary"]["uploadsNeedingReview"] == 2
    assert any(invoice["status"] == "Draft" for invoice in purchases_body["invoices"])

    inventory = client.get("/api/pilot/inventory")
    assert inventory.status_code == 200
    inventory_body = inventory.get_json()
    assert inventory_body["summary"]["inventoryItemCount"] >= 18
    assert inventory_body["summary"]["inventoryReorderNowCount"] == 4
    assert inventory_body["reorderPlan"]["suggestions"]

    suppliers = client.get("/api/pilot/suppliers")
    assert suppliers.status_code == 200
    supplier_body = suppliers.get_json()
    assert len(supplier_body["suppliers"]) >= 6
    assert any(entry["name"] == "Harbour Dry Goods" for entry in supplier_body["suppliers"])


def test_pilot_dashboard_lists_live_drafts(client):
    login(client)

    inventory = client.get("/api/pilot/inventory").get_json()
    item_id = inventory["items"][0]["id"]

    reorder_plan = client.post("/api/pilot/reorder-plans", headers=csrf_headers(client))
    assert reorder_plan.status_code == 201
    reorder_plan_id = reorder_plan.get_json()["id"]

    count_session = client.post(
        "/api/pilot/inventory/count-sessions",
        headers=csrf_headers(client),
        json={
            "countedBy": "Floor lead",
            "notes": "Draft count",
            "itemIds": [item_id],
        },
    )
    assert count_session.status_code == 201
    count_session_id = count_session.get_json()["id"]

    dashboard = client.get("/api/pilot/dashboard")
    assert dashboard.status_code == 200
    body = dashboard.get_json()
    assert any(plan["id"] == reorder_plan_id for plan in body["pendingDraftReorderPlans"])
    assert any(session["id"] == count_session_id for session in body["pendingDraftCountSessions"])


def test_pilot_operational_journey_persists_across_refetches(app, client):
    login(client)

    supplier_name = f"Journey Dairy {uuid4().hex[:8]}"
    item_name = f"Journey Cream {uuid4().hex[:8]}"
    invoice_number = f"JRN-{uuid4().hex[:8].upper()}"

    supplier_create = client.post(
        "/api/pilot/suppliers",
        headers=csrf_headers(client),
        json={
            "name": supplier_name,
            "categoryFocus": "Dairy",
            "contactName": "Pilot Buyer",
            "contactPhone": "416-555-0188",
            "contactEmail": "buyer@example.com",
            "orderingNotes": "Call before noon.",
            "notes": "Seeded during the readiness audit.",
            "isActive": True,
        },
    )
    assert supplier_create.status_code == 201
    supplier = supplier_create.get_json()

    supplier_update = client.patch(
        f"/api/pilot/suppliers/{supplier['id']}",
        headers=csrf_headers(client),
        json={
            "notes": "Primary dairy supplier",
            "contactPhone": "416-555-0199",
        },
    )
    assert supplier_update.status_code == 200
    assert supplier_update.get_json()["notes"] == "Primary dairy supplier"

    supplier_list = client.get("/api/pilot/suppliers")
    assert supplier_list.status_code == 200
    assert any(entry["id"] == supplier["id"] and entry["notes"] == "Primary dairy supplier" for entry in supplier_list.get_json()["suppliers"])

    item_create = client.post(
        "/api/pilot/inventory/items",
        headers=csrf_headers(client),
        json={
            "name": item_name,
            "category": "Dairy",
            "stockUnit": "case",
            "currentOnHand": 4,
            "minQuantity": 2,
            "parLevel": 8,
            "preferredSupplierName": supplier_name,
            "latestPurchasePrice": 18.5,
            "lastPurchaseUnit": "case",
            "lastPurchaseConversionFactor": 1,
            "averageDailyUsage": 0.5,
            "notes": "Initial readiness item",
            "active": True,
        },
    )
    assert item_create.status_code == 201
    item = item_create.get_json()

    item_update = client.patch(
        f"/api/pilot/inventory/items/{item['id']}",
        headers=csrf_headers(client),
        json={
            "notes": "Used for the pilot readiness pass",
            "averageDailyUsage": 0.75,
        },
    )
    assert item_update.status_code == 200
    assert item_update.get_json()["notes"] == "Used for the pilot readiness pass"

    with app.app_context():
        item_after_update = InventoryItem.query.filter_by(id=item["id"]).first()
        assert item_after_update is not None
        assert float(item_after_update.average_unit_cost) == pytest.approx(18.5)

    inventory = client.get("/api/pilot/inventory")
    assert inventory.status_code == 200
    inventory_body = inventory.get_json()
    assert any(entry["id"] == item["id"] and entry["notes"] == "Used for the pilot readiness pass" for entry in inventory_body["items"])

    invoice_create = client.post(
        "/api/pilot/purchases/invoices",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": invoice_number,
            "invoiceDate": "2026-08-11",
            "subtotal": 37.0,
            "tax": 4.81,
            "totalAmount": 41.81,
            "notes": "OCR draft from the readiness pass",
            "status": "Draft",
            "sourceFileName": "journey-invoice.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "ocr",
            "extractedText": "Journey Cream 2 case $18.50",
            "lineItems": [
                {
                    "description": item_name,
                    "inventoryItemId": item["id"],
                    "purchaseUnit": "case",
                    "inventoryUnit": "case",
                    "conversionFactor": 1,
                    "quantity": 2,
                    "unitPrice": 18.5,
                    "lineTotal": 37.0,
                    "confidence": 0.97,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert invoice_create.status_code == 201
    invoice = invoice_create.get_json()

    invoice_update = client.patch(
        f"/api/pilot/purchases/invoices/{invoice['id']}",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": invoice_number,
            "invoiceDate": "2026-08-11",
            "subtotal": 37.0,
            "tax": 4.81,
            "totalAmount": 41.81,
            "notes": "Reviewed and ready",
            "status": "Ready",
            "sourceFileName": "journey-invoice.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "ocr",
            "extractedText": "Journey Cream 2 case $18.50",
            "lineItems": [
                {
                    "description": item_name,
                    "inventoryItemId": item["id"],
                    "purchaseUnit": "case",
                    "inventoryUnit": "case",
                    "conversionFactor": 1,
                    "quantity": 2,
                    "unitPrice": 18.5,
                    "lineTotal": 37.0,
                    "confidence": 0.97,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert invoice_update.status_code == 200
    assert invoice_update.get_json()["notes"] == "Reviewed and ready"

    invoice_detail = client.get(f"/api/pilot/purchases/invoices/{invoice['id']}")
    assert invoice_detail.status_code == 200
    assert invoice_detail.get_json()["notes"] == "Reviewed and ready"

    receive = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=csrf_headers(client))
    assert receive.status_code == 200
    assert receive.get_json()["status"] == "Completed"

    item_detail = client.get(f"/api/pilot/inventory/items/{item['id']}")
    assert item_detail.status_code == 200
    item_body = item_detail.get_json()
    assert item_body["item"]["notes"] == "Used for the pilot readiness pass"
    assert item_body["purchaseHistory"]
    assert item_body["movementHistory"]

    count_create = client.post(
        "/api/pilot/inventory/count-sessions",
        headers=csrf_headers(client),
        json={
            "countedBy": "Readiness tester",
            "notes": "Count after receipt",
            "itemIds": [item["id"]],
        },
    )
    assert count_create.status_code == 201
    count_session = count_create.get_json()

    count_update = client.patch(
        f"/api/pilot/inventory/count-sessions/{count_session['id']}",
        headers=csrf_headers(client),
        json={
            "countedBy": "Readiness tester",
            "notes": "Count after receipt",
            "lines": [
                {
                    "id": count_session["lines"][0]["id"],
                    "countedQuantity": 6.0,
                    "note": "Shelf count matched after receipt",
                }
            ],
        },
    )
    assert count_update.status_code == 200
    assert count_update.get_json()["countedLineCount"] == 1

    count_finalize = client.post(f"/api/pilot/inventory/count-sessions/{count_session['id']}/finalize", headers=csrf_headers(client))
    assert count_finalize.status_code == 200
    assert count_finalize.get_json()["status"] == "Completed"

    count_detail = client.get(f"/api/pilot/inventory/count-sessions/{count_session['id']}")
    assert count_detail.status_code == 200
    assert count_detail.get_json()["status"] == "Completed"

    reorder_plan = client.get("/api/pilot/reorder-plan")
    assert reorder_plan.status_code == 200
    assert any(suggestion["inventoryItemId"] == item["id"] for suggestion in reorder_plan.get_json()["suggestions"])

    with app.app_context():
        reloaded_supplier = Supplier.query.filter_by(id=supplier["id"]).first()
        reloaded_item = InventoryItem.query.filter_by(id=item["id"]).first()
        reloaded_invoice = PurchaseInvoice.query.filter_by(id=invoice["id"]).first()
        reloaded_count = StockCountSession.query.filter_by(id=count_session["id"]).first()
        assert reloaded_supplier is not None and reloaded_supplier.notes == "Primary dairy supplier"
        assert reloaded_item is not None and float(reloaded_item.current_on_hand) == 6.0
        assert reloaded_invoice is not None and reloaded_invoice.status == "Completed"
        assert reloaded_count is not None and reloaded_count.status == "Completed"


def test_pilot_mutations_require_auth_csrf_and_active_users(app, client):
    protected_endpoints = [
        ("GET", "/api/pilot/dashboard"),
        ("GET", "/api/pilot/purchases"),
        ("GET", "/api/pilot/inventory"),
        ("GET", "/api/pilot/suppliers"),
        ("GET", "/api/pilot/reorder-plan"),
        ("GET", "/api/pilot/reorder-plans"),
        ("GET", "/api/pilot/inventory/count-sessions"),
        ("POST", "/api/pilot/purchases/invoices"),
        ("POST", "/api/pilot/inventory/items"),
        ("POST", "/api/pilot/inventory/count-sessions"),
        ("POST", "/api/pilot/reorder-plans"),
    ]
    for method, path in protected_endpoints:
        response = getattr(client, method.lower())(path)
        assert response.status_code in ({401} if method == "GET" else {400, 401})

    login_manager(client)
    inventory = client.get("/api/pilot/inventory").get_json()
    item = inventory["items"][0]

    missing_csrf = client.post(
        f"/api/pilot/inventory/items/{item['id']}/adjustments",
        json={
            "reason": "Missing token",
            "quantityDelta": 1,
            "movementType": "manual increase",
            "sourceRecordId": "csrf-test",
            "sourceLineId": "csrf-test-line",
        },
    )
    assert missing_csrf.status_code in {400, 403}

    with app.app_context():
        manager = User.query.filter_by(email=LOCAL_MANAGER_EMAIL).first()
        assert manager is not None
        manager.is_active = False
        db.session.commit()

    stale_session_dashboard = client.get("/api/pilot/dashboard")
    assert stale_session_dashboard.status_code == 401

    fresh_client = app.test_client()
    csrf = fresh_client.get("/api/auth/csrf").get_json()["csrfToken"]
    inactive_login = fresh_client.post(
        "/api/auth/login",
        json={"email": LOCAL_MANAGER_EMAIL, "password": LOCAL_MANAGER_PASSWORD},
        headers={"X-CSRFToken": csrf},
    )
    assert inactive_login.status_code in {400, 401}


def test_audit_events_endpoint_is_owner_only(client):
    login_manager(client)

    response = client.get("/api/pilot/audit-events")
    assert response.status_code == 403


def test_receiving_invoice_updates_inventory_and_is_idempotent(app, client):
    login(client)

    with app.app_context():
        initial_cream = InventoryItem.query.filter_by(name="Cream").first()
        assert initial_cream is not None
        before = float(initial_cream.current_on_hand)

    purchases = client.get("/api/pilot/purchases").get_json()
    invoice = next(entry for entry in purchases["invoices"] if entry["invoiceNumber"] == "FD-4400")

    receive = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=csrf_headers(client))
    assert receive.status_code == 200
    assert receive.get_json()["status"] == "Completed"

    refreshed_purchases = client.get("/api/pilot/purchases").get_json()
    refreshed_invoice = next(entry for entry in refreshed_purchases["invoices"] if entry["id"] == invoice["id"])
    assert refreshed_invoice["status"] == "Completed"

    duplicate = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=csrf_headers(client))
    assert duplicate.status_code == 409

    with app.app_context():
        cream = InventoryItem.query.filter_by(name="Cream").first()
        assert cream is not None
        assert float(cream.current_on_hand) == before + 1
        assert InventoryMovement.query.filter_by(source_record_id=str(invoice["id"])).count() >= 3


def test_received_invoice_correction_reverses_inventory_and_blocks_repeat(app, client):
    login(client)

    with app.app_context():
        cream = InventoryItem.query.filter_by(name="Cream").first()
        assert cream is not None
        before = float(cream.current_on_hand)
        before_average = float(cream.average_unit_cost)
        cream_stock_unit = cream.stock_unit

    supplier_name = f"Correction Dairy {uuid4().hex[:8]}"
    invoice_number = f"CR-{uuid4().hex[:8].upper()}"
    create_response = client.post(
        "/api/pilot/purchases/invoices",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": invoice_number,
            "invoiceDate": "2026-07-15",
            "subtotal": 24,
            "tax": 3.12,
            "totalAmount": 27.12,
            "notes": "Correction test invoice",
            "status": "Draft",
            "sourceFileName": "correction-test.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "manual",
            "extractedText": "",
            "lineItems": [
                {
                    "description": "Cream",
                    "inventoryItemId": cream.id,
                    "purchaseUnit": "case",
                    "inventoryUnit": cream_stock_unit,
                    "conversionFactor": 2,
                    "quantity": 2,
                    "unitPrice": 12,
                    "lineTotal": 24,
                    "confidence": 0.94,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert create_response.status_code == 201
    invoice = create_response.get_json()

    receive = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=csrf_headers(client))
    assert receive.status_code == 200
    assert receive.get_json()["status"] == "Completed"

    correction = client.post(
        f"/api/pilot/purchases/invoices/{invoice['id']}/correct",
        headers=csrf_headers(client),
        json={"reason": "Wrong carton delivered"},
    )
    assert correction.status_code == 200
    corrected = correction.get_json()
    assert corrected["status"] == "Corrected"

    duplicate_correction = client.post(
        f"/api/pilot/purchases/invoices/{invoice['id']}/correct",
        headers=csrf_headers(client),
        json={"reason": "Second correction"},
    )
    assert duplicate_correction.status_code == 409

    duplicate_receive = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=csrf_headers(client))
    assert duplicate_receive.status_code == 409

    update_after_correction = client.patch(
        f"/api/pilot/purchases/invoices/{invoice['id']}",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": invoice_number,
            "invoiceDate": "2026-07-15",
            "subtotal": 24,
            "tax": 3.12,
            "totalAmount": 27.12,
            "status": "Draft",
            "lineItems": [],
        },
    )
    assert update_after_correction.status_code == 409

    with app.app_context():
        cream_after = InventoryItem.query.filter_by(name="Cream").first()
        assert cream_after is not None
        assert float(cream_after.current_on_hand) == before
        assert float(cream_after.average_unit_cost) == pytest.approx(before_average)
        correction_movements = InventoryMovement.query.filter_by(
            organization_id=invoice["organizationId"],
            location_id=invoice["locationId"],
            source_type="invoice correction",
            source_record_id=str(invoice["id"]),
        ).count()
        assert correction_movements == 1
        stored_invoice = PurchaseInvoice.query.filter_by(id=invoice["id"]).first()
        assert stored_invoice is not None and stored_invoice.status == "Corrected"


def test_weighted_average_receipt_flow_preserves_latest_price_and_supports_costing(app, client):
    login(client)

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        organization = make_operational_organization(
            owner,
            name=f"Weighted Average Org {uuid4().hex[:8]}",
            location_name="Weighted Average Kitchen",
            enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING", "STOCK_COUNTS", "REORDER_PLANS"),
        )
        organization_id = organization.id
    select_org(client, organization_id)

    item_name = f"Weighted Avg Chicken {uuid4().hex[:8]}"
    supplier_name = f"Weighted Avg Supplier {uuid4().hex[:8]}"
    first_invoice_number = f"WA-{uuid4().hex[:8].upper()}"
    second_invoice_number = f"WA-{uuid4().hex[:8].upper()}"

    item_create = client.post(
        "/api/pilot/inventory/items",
        headers=csrf_headers(client),
        json={
            "name": item_name,
            "category": "Protein",
            "stockUnit": "kg",
            "currentOnHand": 100,
            "minQuantity": 90,
            "parLevel": 110,
            "preferredSupplierName": supplier_name,
            "latestPurchasePrice": 7,
            "lastPurchaseUnit": "kg",
            "lastPurchaseConversionFactor": 1,
            "averageDailyUsage": 1.5,
            "notes": "Weighted average test item",
            "active": True,
        },
    )
    assert item_create.status_code == 201
    item = item_create.get_json()
    item_id = item["id"]
    assert item["averageUnitCost"] == pytest.approx(7.0)

    initial_inventory = client.get("/api/pilot/inventory").get_json()
    inventory_value_before_receipts = initial_inventory["summary"]["inventoryValue"]

    first_invoice = client.post(
        "/api/pilot/purchases/invoices",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": first_invoice_number,
            "invoiceDate": "2027-01-15",
            "subtotal": 7,
            "tax": 0,
            "totalAmount": 7,
            "notes": "Initial receipt at current cost",
            "status": "Draft",
            "sourceFileName": "weighted-average-initial.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "manual",
            "extractedText": "",
            "lineItems": [
                {
                    "description": item_name,
                    "inventoryItemId": item_id,
                    "purchaseUnit": "kg",
                    "inventoryUnit": "kg",
                    "conversionFactor": 1,
                    "quantity": 1,
                    "unitPrice": 7,
                    "lineTotal": 7,
                    "confidence": 1,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert first_invoice.status_code == 201
    first_invoice_body = first_invoice.get_json()
    first_receive = client.post(f"/api/pilot/purchases/invoices/{first_invoice_body['id']}/receive", headers=csrf_headers(client))
    assert first_receive.status_code == 200

    with app.app_context():
        item_after_first = InventoryItem.query.filter_by(id=item_id).first()
        assert item_after_first is not None
        assert float(item_after_first.current_on_hand) == 101
        assert float(item_after_first.latest_purchase_price) == pytest.approx(7.0)
        assert float(item_after_first.average_unit_cost) == pytest.approx(7.0)

    inventory_value_after_first_receipt = client.get("/api/pilot/inventory").get_json()["summary"]["inventoryValue"]
    assert inventory_value_after_first_receipt - inventory_value_before_receipts == pytest.approx(7.0)

    count_session = client.post(
        "/api/pilot/inventory/count-sessions",
        headers=csrf_headers(client),
        json={
            "countedBy": "Floor manager",
            "notes": "Reset to a round stock count",
            "itemIds": [item_id],
        },
    )
    assert count_session.status_code == 201
    count_session_body = count_session.get_json()
    count_session_id = count_session_body["id"]
    count_line_id = count_session_body["lines"][0]["id"]
    exact_updated_at = client.get(f"/api/pilot/inventory/count-sessions/{count_session_id}").get_json()["updatedAt"]

    count_save = client.patch(
        f"/api/pilot/inventory/count-sessions/{count_session_id}",
        headers=csrf_headers(client),
        json={
            "updatedAt": exact_updated_at,
            "countedBy": "Floor manager",
            "notes": "Reset to a round stock count",
            "lines": [
                {
                    "id": count_line_id,
                    "countedQuantity": 100,
                    "note": "Physical count",
                }
            ],
        },
    )
    assert count_save.status_code == 200
    count_save_body = count_save.get_json()
    assert count_save_body["lines"][0]["variance"] == pytest.approx(-1.0)
    assert count_save_body["lines"][0]["resultingQuantity"] == 100

    finalize_count = client.post(f"/api/pilot/inventory/count-sessions/{count_session_id}/finalize", headers=csrf_headers(client))
    assert finalize_count.status_code == 200
    assert finalize_count.get_json()["status"] == "Completed"

    with app.app_context():
        item_after_count = InventoryItem.query.filter_by(id=item_id).first()
        assert item_after_count is not None
        assert float(item_after_count.current_on_hand) == 100
        assert float(item_after_count.average_unit_cost) == pytest.approx(7.0)
        reconciliation_count = InventoryMovement.query.filter_by(
            source_record_id=str(count_session_id),
            source_type="stock count reconciliation",
        ).count()
        assert reconciliation_count == 1

    inventory_value_before_second_receipt = client.get("/api/pilot/inventory").get_json()["summary"]["inventoryValue"]
    assert inventory_value_before_second_receipt == pytest.approx(inventory_value_before_receipts)

    second_invoice = client.post(
        "/api/pilot/purchases/invoices",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": second_invoice_number,
            "invoiceDate": "2027-01-16",
            "subtotal": 8,
            "tax": 0,
            "totalAmount": 8,
            "notes": "Higher-cost receipt",
            "status": "Draft",
            "sourceFileName": "weighted-average-followup.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "manual",
            "extractedText": "",
            "lineItems": [
                {
                    "description": item_name,
                    "inventoryItemId": item_id,
                    "purchaseUnit": "kg",
                    "inventoryUnit": "kg",
                    "conversionFactor": 1,
                    "quantity": 1,
                    "unitPrice": 8,
                    "lineTotal": 8,
                    "confidence": 1,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert second_invoice.status_code == 201
    second_invoice_body = second_invoice.get_json()
    second_receive = client.post(f"/api/pilot/purchases/invoices/{second_invoice_body['id']}/receive", headers=csrf_headers(client))
    assert second_receive.status_code == 200

    with app.app_context():
        item_after_second = InventoryItem.query.filter_by(id=item_id).first()
        assert item_after_second is not None
        assert float(item_after_second.current_on_hand) == 101
        assert float(item_after_second.latest_purchase_price) == pytest.approx(8.0)
        assert float(item_after_second.average_unit_cost) == pytest.approx((100 * 7 + 8) / 101, rel=1e-6)

    inventory_value_after_second_receipt = client.get("/api/pilot/inventory").get_json()["summary"]["inventoryValue"]
    assert inventory_value_after_second_receipt - inventory_value_before_second_receipt == pytest.approx(8.0)

    dashboard = client.get("/api/pilot/dashboard").get_json()
    assert any(
        change["supplier"] == supplier_name
        and change["itemName"] == item_name
        and change["previousPrice"] == pytest.approx(7.0)
        and change["currentPrice"] == pytest.approx(8.0)
        for change in dashboard["recentPriceChanges"]
    )

    inventory_summary = client.get("/api/pilot/inventory").get_json()
    reorder_suggestion = next(
        suggestion
        for suggestion in inventory_summary["reorderPlan"]["suggestions"]
        if suggestion["inventoryItemId"] == item_id
    )
    assert float(reorder_suggestion["estimatedCost"]) == pytest.approx(72.0)
    assert reorder_suggestion["latestPurchasePrice"] == pytest.approx(8.0)

    menu_recipe = client.post(
        "/api/pilot/menu-costing/recipes",
        headers=csrf_headers(client),
        json={
            "name": f"Weighted Avg Bowl {uuid4().hex[:8]}",
            "description": "Recipe priced from weighted average cost",
            "yieldQuantity": 1,
            "yieldUnit": "servings",
            "active": True,
            "notes": "Weighted average costing test",
        },
    )
    assert menu_recipe.status_code == 201
    recipe_id = menu_recipe.get_json()["id"]

    ingredient_response = client.post(
        f"/api/pilot/menu-costing/recipes/{recipe_id}/ingredients",
        headers=csrf_headers(client),
        json={
            "inventoryItemId": item_id,
            "quantityRequired": 0.2,
            "unit": "kg",
            "sortOrder": 1,
            "notes": "Two-tenths of a kilogram",
        },
    )
    assert ingredient_response.status_code == 201
    ingredient_body = ingredient_response.get_json()
    assert ingredient_body["ingredients"][0]["inventoryItemCostPerStockUnit"] == pytest.approx(7.01)
    assert ingredient_body["ingredients"][0]["lineCost"] == pytest.approx(1.4)
    assert ingredient_body["costPerYield"] == pytest.approx(1.4)

    menu_item = client.post(
        "/api/pilot/menu-costing/menu-items",
        headers=csrf_headers(client),
        json={
            "name": f"Weighted Avg Bowl {uuid4().hex[:8]}",
            "category": "Bowls",
            "recipeId": recipe_id,
            "sellingPrice": 10,
            "active": True,
            "notes": "Menu item priced from weighted average recipe cost",
        },
    )
    assert menu_item.status_code == 201
    menu_item_body = menu_item.get_json()
    assert menu_item_body["recipeCostPerYield"] == pytest.approx(1.4)
    assert menu_item_body["foodCostPercent"] == pytest.approx(14.0)
    assert menu_item_body["grossProfit"] == pytest.approx(8.6)


def test_daily_close_session_lifecycle_respects_module_enablement(app, client):
    login(client)

    blocked = client.get("/api/pilot/daily-close")
    assert blocked.status_code == 403

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        organization = make_operational_organization(
            owner,
            name=f"Daily Close Org {uuid4().hex[:8]}",
            location_name="Daily Close Kitchen",
            enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING", "STOCK_COUNTS", "REORDER_PLANS", "DAILY_CLOSE"),
        )
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        assert location is not None
        location_id = location.id
    select_org(client, organization.id)

    initial = client.get(f"/api/pilot/daily-close?locationId={location_id}")
    assert initial.status_code == 200
    initial_body = initial.get_json()
    assert initial_body["session"] is None
    assert initial_body["location"]["id"] == location_id
    assert "Square not synced." in initial_body["exceptions"]

    opened = client.post(
        "/api/pilot/daily-close",
        headers=csrf_headers(client),
        json={"locationId": location_id, "businessDate": "2026-08-30"},
    )
    assert opened.status_code == 200
    opened_body = opened.get_json()
    session_id = opened_body["session"]["id"]
    assert opened_body["session"]["status"] == "DRAFT"
    assert opened_body["session"]["notes"] == ""
    assert opened_body["history"][0]["id"] == session_id

    updated = client.patch(
        f"/api/pilot/daily-close/{session_id}",
        headers=csrf_headers(client),
        json={"notes": "End-of-day notes"},
    )
    assert updated.status_code == 200
    updated_body = updated.get_json()
    assert updated_body["session"]["notes"] == "End-of-day notes"
    assert updated_body["session"]["status"] == "DRAFT"

    finalized = client.post(f"/api/pilot/daily-close/{session_id}/finalize", headers=csrf_headers(client))
    assert finalized.status_code == 200
    finalized_body = finalized.get_json()
    assert finalized_body["session"]["status"] == "COMPLETED"
    assert finalized_body["session"]["notes"] == "End-of-day notes"
    assert finalized_body["session"]["completedByUserId"] == 1

    read_only = client.patch(
        f"/api/pilot/daily-close/{session_id}",
        headers=csrf_headers(client),
        json={"notes": "Another note"},
    )
    assert read_only.status_code == 409

    with app.app_context():
        stored = DailyCloseSession.query.filter_by(id=session_id).first()
        assert stored is not None
        assert stored.status == "COMPLETED"
        assert stored.notes == "End-of-day notes"

    refetched = client.get("/api/pilot/daily-close", query_string={"locationId": location_id, "businessDate": "2026-08-30"})
    assert refetched.status_code == 200
    refetched_body = refetched.get_json()
    assert refetched_body["businessDate"] == "2026-08-30"
    assert refetched_body["session"] is not None
    assert refetched_body["session"]["id"] == session_id


def test_daily_close_sync_sales_uses_business_date_bounds(app, client, monkeypatch):
    login(client)

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        organization = make_operational_organization(
            owner,
            name=f"Square Daily Close Org {uuid4().hex[:8]}",
            location_name="Toronto Kitchen",
            enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING", "STOCK_COUNTS", "REORDER_PLANS", "SQUARE_INTEGRATION", "DAILY_CLOSE"),
        )
        restaurant_location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        assert restaurant_location is not None
        restaurant_location_id = restaurant_location.id
    select_org(client, organization.id)

    connect_square(client, monkeypatch, app, organization.id)

    status_response = client.get(f"/api/integrations/square/status?organizationId={organization.id}")
    assert status_response.status_code == 200
    square_location_row_id = status_response.get_json()["connection"]["locations"][0]["id"]

    mapping_response = client.post(
        "/api/integrations/square/location-mappings",
        headers=csrf_headers(client),
        json={
            "organizationId": organization.id,
            "squareLocationId": square_location_row_id,
            "restaurantLocationId": restaurant_location_id,
        },
    )
    assert mapping_response.status_code == 200

    opened = client.post(
        "/api/pilot/daily-close",
        headers=csrf_headers(client),
        json={"locationId": restaurant_location_id, "businessDate": "2026-08-28"},
    )
    assert opened.status_code == 200
    opened_body = opened.get_json()
    session_id = opened_body["session"]["id"]

    captured: dict[str, object] = {}

    def fake_sync(organization_arg, connection_arg, *, start_at, end_at, location_ids):
      captured["organization_id"] = organization_arg.id
      captured["connection_id"] = connection_arg.id
      captured["start_at"] = start_at
      captured["end_at"] = end_at
      captured["location_ids"] = list(location_ids)
      return {"connection": {"id": connection_arg.id}, "job": {"id": 1, "status": "completed", "cursorJson": {}}}

    monkeypatch.setattr("backend.daily_close.sync_square_orders_for_range", fake_sync)

    synced = client.post(
        f"/api/pilot/daily-close/{session_id}/sync-sales",
        headers=csrf_headers(client),
        json={"businessDate": "2026-08-28"},
    )
    assert synced.status_code == 200

    tz = ZoneInfo("America/Toronto")
    expected_start = datetime(2026, 8, 28, 0, 0, tzinfo=tz).astimezone(timezone.utc)
    expected_end = (datetime(2026, 8, 28, 0, 0, tzinfo=tz) + timedelta(days=1) - timedelta(microseconds=1)).astimezone(timezone.utc)
    assert captured["organization_id"] == organization.id
    assert captured["connection_id"] > 0
    assert captured["start_at"] == expected_start
    assert captured["end_at"] == expected_end
    assert captured["location_ids"] == ["LOC-1"]


def test_completed_daily_close_keeps_stored_snapshot_after_source_mutation(app, client, monkeypatch):
    login(client)

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        organization = make_operational_organization(
            owner,
            name=f"Daily Close Snapshot {uuid4().hex[:8]}",
            location_name="Toronto Kitchen",
            enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING", "STOCK_COUNTS", "REORDER_PLANS", "SQUARE_INTEGRATION", "DAILY_CLOSE"),
        )
        restaurant_location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        assert restaurant_location is not None
        square_connection = SquareConnection(
            organization_id=organization.id,
            environment="sandbox",
            square_merchant_id="merchant-daily-close",
            status="connected",
            sync_status="idle",
            last_sync_at=datetime(2026, 8, 28, 12, 0, tzinfo=timezone.utc),
        )
        db.session.add(square_connection)
        db.session.flush()
        square_location = SquareLocation(
            square_connection_id=square_connection.id,
            square_location_id="LOC-1",
            name="Toronto Kitchen",
            status="ACTIVE",
            raw_payload_json={},
        )
        db.session.add(square_location)
        db.session.flush()
        db.session.add(
            SquareLocationMapping(
                square_location_id=square_location.id,
                restaurant_location_id=restaurant_location.id,
                mapped_by_user_id=owner.id,
            )
        )
        db.session.add(
            SquareDailySalesSummary(
                square_connection_id=square_connection.id,
                square_location_id="LOC-1",
                restaurant_location_id=restaurant_location.id,
                sale_date=date(2026, 8, 28),
                currency="CAD",
                gross_amount=Decimal("1500"),
                discount_amount=Decimal("50"),
                tax_amount=Decimal("100"),
                tip_amount=Decimal("75"),
                refund_amount=Decimal("25"),
                net_amount=Decimal("1600"),
                order_count=4,
                cancelled_order_count=0,
                raw_payload_json={"source": "test"},
            )
        )
        db.session.commit()
        organization_id = organization.id
        square_connection_id = square_connection.id
        restaurant_location_id = restaurant_location.id
    select_org(client, organization_id)

    opened = client.post(
        "/api/pilot/daily-close",
        headers=csrf_headers(client),
        json={"locationId": restaurant_location_id, "businessDate": "2026-08-28"},
    )
    assert opened.status_code == 200
    opened_body = opened.get_json()
    session_id = opened_body["session"]["id"]
    assert opened_body["session"]["currentSnapshot"]["sales"]["netSales"] == 1600

    finalized = client.post(f"/api/pilot/daily-close/{session_id}/finalize", headers=csrf_headers(client))
    assert finalized.status_code == 200
    finalized_body = finalized.get_json()

    with app.app_context():
        summary = SquareDailySalesSummary.query.filter_by(square_connection_id=square_connection_id, square_location_id="LOC-1").first()
        assert summary is not None
        summary.net_amount = Decimal("9999")
        summary.order_count = 99
        db.session.commit()

    refetched = client.get("/api/pilot/daily-close", query_string={"locationId": restaurant_location_id, "businessDate": "2026-08-28"})
    assert refetched.status_code == 200
    refetched_body = refetched.get_json()
    assert refetched_body["session"]["status"] == "COMPLETED"
    assert refetched_body["session"]["summarySnapshot"] == finalized_body["session"]["summarySnapshot"]
    assert refetched_body["session"]["usageSnapshot"] == finalized_body["session"]["usageSnapshot"]
    assert refetched_body["session"]["exceptionsSnapshot"] == finalized_body["session"]["exceptionsSnapshot"]
    assert refetched_body["session"]["currentSnapshot"]["sales"]["netSales"] == finalized_body["session"]["currentSnapshot"]["sales"]["netSales"]


def test_receipt_initializes_weighted_average_when_inventory_starts_at_zero(app, client):
    login(client)

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        organization = make_operational_organization(
            owner,
            name=f"Zero Start Org {uuid4().hex[:8]}",
            location_name="Zero Start Kitchen",
            enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING", "STOCK_COUNTS", "REORDER_PLANS"),
        )
        organization_id = organization.id
    select_org(client, organization_id)

    item_name = f"Zero Start Item {uuid4().hex[:8]}"
    supplier_name = f"Zero Start Supplier {uuid4().hex[:8]}"
    invoice_number = f"ZS-{uuid4().hex[:8].upper()}"

    item_create = client.post(
        "/api/pilot/inventory/items",
        headers=csrf_headers(client),
        json={
            "name": item_name,
            "category": "Dairy",
            "stockUnit": "kg",
            "currentOnHand": 0,
            "latestPurchasePrice": 0,
            "lastPurchaseUnit": "kg",
            "lastPurchaseConversionFactor": 1,
            "active": True,
        },
    )
    assert item_create.status_code == 201
    item_id = item_create.get_json()["id"]

    invoice = client.post(
        "/api/pilot/purchases/invoices",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": invoice_number,
            "invoiceDate": "2026-07-17",
            "subtotal": 8,
            "tax": 0,
            "totalAmount": 8,
            "notes": "First-ever receipt",
            "status": "Draft",
            "sourceFileName": "zero-start.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "manual",
            "extractedText": "",
            "lineItems": [
                {
                    "description": item_name,
                    "inventoryItemId": item_id,
                    "purchaseUnit": "kg",
                    "inventoryUnit": "kg",
                    "conversionFactor": 1,
                    "quantity": 1,
                    "unitPrice": 8,
                    "lineTotal": 8,
                    "confidence": 1,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert invoice.status_code == 201
    invoice_body = invoice.get_json()

    receive = client.post(f"/api/pilot/purchases/invoices/{invoice_body['id']}/receive", headers=csrf_headers(client))
    assert receive.status_code == 200

    with app.app_context():
        item = InventoryItem.query.filter_by(id=item_id).first()
        assert item is not None
        assert float(item.current_on_hand) == 1
        assert float(item.latest_purchase_price) == pytest.approx(8.0)
        assert float(item.average_unit_cost) == pytest.approx(8.0)


def test_mapped_invoice_save_syncs_supplier_mapping_and_receipt_uses_conversion(app, client):
    login(client)

    with app.app_context():
        cream = InventoryItem.query.filter_by(name="Cream").first()
        assert cream is not None
        before = float(cream.current_on_hand)
        cream_stock_unit = cream.stock_unit

    supplier_name = f"Unit Test Dairy {uuid4().hex[:8]}"
    invoice_number = f"UT-{uuid4().hex[:8].upper()}"
    create_response = client.post(
        "/api/pilot/purchases/invoices",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": invoice_number,
            "invoiceDate": "2026-07-15",
            "subtotal": 24,
            "tax": 3.12,
            "totalAmount": 27.12,
            "notes": "Unit test invoice",
            "status": "Draft",
            "sourceFileName": "unit-test.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "manual",
            "extractedText": "",
            "lineItems": [
                {
                    "description": "Cream",
                    "inventoryItemId": cream.id,
                    "purchaseUnit": "case",
                    "inventoryUnit": cream_stock_unit,
                    "conversionFactor": 2,
                    "quantity": 2,
                    "unitPrice": 12,
                    "lineTotal": 24,
                    "confidence": 0.94,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert create_response.status_code == 201
    invoice = create_response.get_json()

    with app.app_context():
        mapping = SupplierItemMapping.query.filter_by(
            organization_id=invoice["organizationId"],
            supplier_id=invoice["supplierId"],
            inventory_item_id=cream.id,
        ).first()
        assert mapping is not None
        assert float(mapping.conversion_factor) == 2
        assert mapping.purchase_unit == "case"
        assert mapping.inventory_unit == cream_stock_unit

    receive = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=csrf_headers(client))
    assert receive.status_code == 200
    received = receive.get_json()
    assert received["status"] == "Completed"

    update_after_receive = client.patch(
        f"/api/pilot/purchases/invoices/{invoice['id']}",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": invoice_number,
            "invoiceDate": "2026-07-15",
            "subtotal": 24,
            "tax": 3.12,
            "totalAmount": 27.12,
            "status": "Draft",
            "lineItems": [],
        },
    )
    assert update_after_receive.status_code == 409

    duplicate = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=csrf_headers(client))
    assert duplicate.status_code == 409

    detail_response = client.get(f"/api/pilot/inventory/items/{cream.id}")
    assert detail_response.status_code == 200
    detail = detail_response.get_json()
    assert detail["purchaseHistory"]
    assert detail["movementHistory"]

    base_unit_blocked = client.patch(
        f"/api/pilot/inventory/items/{cream.id}",
        headers=csrf_headers(client),
        json={"stockUnit": "box"},
    )
    assert base_unit_blocked.status_code == 409

    with app.app_context():
        cream_after = InventoryItem.query.filter_by(name="Cream").first()
        assert cream_after is not None
        assert float(cream_after.current_on_hand) == before + 4
        assert InventoryMovement.query.filter_by(source_record_id=str(invoice["id"])).count() == 1
        stored_invoice = PurchaseInvoice.query.filter_by(id=invoice["id"]).first()
        assert stored_invoice is not None and stored_invoice.status == "Completed"


def test_count_session_finalize_updates_inventory(app, client):
    login(client)

    inventory = client.get("/api/pilot/inventory").get_json()
    chicken = next(item for item in inventory["items"] if item["name"] == "Chicken Breast")

    create_response = client.post(
        "/api/pilot/inventory/count-sessions",
        headers=csrf_headers(client),
        json={
            "countedBy": "Manager on duty",
            "notes": "Evening count",
            "itemIds": [chicken["id"]],
        },
    )
    assert create_response.status_code == 201
    created = create_response.get_json()
    session_id = created["id"]
    line_id = created["lines"][0]["id"]
    starting_quantity = float(chicken["currentOnHand"])
    assert created["lines"][0]["expectedQuantity"] == starting_quantity
    exact_updated_at = client.get(f"/api/pilot/inventory/count-sessions/{session_id}").get_json()["updatedAt"]
    assert exact_updated_at is not None

    update_response = client.patch(
        f"/api/pilot/inventory/count-sessions/{session_id}",
        headers=csrf_headers(client),
        json={
            "updatedAt": exact_updated_at,
            "countedBy": "Manager on duty",
            "notes": "Evening count",
            "lines": [
                {"id": line_id, "countedQuantity": 4.0, "note": "Counted on shelf"},
            ],
        },
    )
    assert update_response.status_code == 200
    saved = update_response.get_json()
    expected_variance = 4.0 - starting_quantity
    assert saved["countedLineCount"] == 1
    assert saved["uncountedLineCount"] == 0
    assert saved["lines"][0]["variance"] == pytest.approx(expected_variance)
    assert saved["lines"][0]["resultingQuantity"] == 4.0

    finalize = client.post(f"/api/pilot/inventory/count-sessions/{session_id}/finalize", headers=csrf_headers(client))
    assert finalize.status_code == 200
    finalized = finalize.get_json()
    assert finalized["status"] == "Completed"

    duplicate_finalize = client.post(f"/api/pilot/inventory/count-sessions/{session_id}/finalize", headers=csrf_headers(client))
    assert duplicate_finalize.status_code == 409

    update_after_finalize = client.patch(
        f"/api/pilot/inventory/count-sessions/{session_id}",
        headers=csrf_headers(client),
        json={
            "notes": "Should not change",
            "lines": [
                {"id": create_response.get_json()["lines"][0]["id"], "countedQuantity": 2.0, "note": "Nope"},
            ],
        },
    )
    assert update_after_finalize.status_code == 409

    with app.app_context():
        chicken_item = InventoryItem.query.filter_by(name="Chicken Breast").first()
        assert chicken_item is not None
        assert float(chicken_item.current_on_hand) == 4.0
        assert InventoryMovement.query.filter_by(source_record_id=str(session_id), source_type="stock count reconciliation").count() == 1
        movement = InventoryMovement.query.filter_by(source_record_id=str(session_id), source_type="stock count reconciliation").first()
        assert movement is not None
        assert float(movement.quantity_delta) == pytest.approx(expected_variance)
        assert float(movement.quantity_before) == starting_quantity
        assert float(movement.quantity_after) == 4.0
        assert StockCountSession.query.filter_by(id=session_id, status="Completed").count() == 1


def test_count_session_creation_rejects_unknown_or_inactive_items(app, client):
    login(client)

    create_response = client.post(
        "/api/pilot/inventory/count-sessions",
        headers=csrf_headers(client),
        json={
            "countedBy": "Closer",
            "notes": "Bad selection",
            "itemIds": [999999],
        },
    )
    assert create_response.status_code == 400

    inventory = client.get("/api/pilot/inventory").get_json()
    item = inventory["items"][0]

    deactivate = client.patch(
        f"/api/pilot/inventory/items/{item['id']}",
        headers=csrf_headers(client),
        json={"active": False},
    )
    assert deactivate.status_code == 200

    inactive_response = client.post(
        "/api/pilot/inventory/count-sessions",
        headers=csrf_headers(client),
        json={
            "countedBy": "Closer",
            "notes": "Inactive selection",
            "itemIds": [item["id"]],
        },
    )
    assert inactive_response.status_code == 400


def test_count_session_save_resume_and_concurrency_confirmation(app, client):
    login(client)

    with app.app_context():
        cups = InventoryItem.query.filter_by(name="Cups").first()
        assert cups is not None
        original = float(cups.current_on_hand)

    create_response = client.post(
        "/api/pilot/inventory/count-sessions",
        headers=csrf_headers(client),
        json={
            "countedBy": "Closer",
            "notes": "Draft count",
            "itemIds": [cups.id],
        },
    )
    assert create_response.status_code == 201
    created = create_response.get_json()
    session_id = created["id"]
    exact_updated_at = client.get(f"/api/pilot/inventory/count-sessions/{session_id}").get_json()["updatedAt"]
    stale_updated_at = exact_updated_at

    update_response = client.patch(
        f"/api/pilot/inventory/count-sessions/{session_id}",
        headers=csrf_headers(client),
        json={
            "updatedAt": exact_updated_at,
            "countedBy": "Closer",
            "notes": "Draft count",
            "lines": [
                {
                    "id": created["lines"][0]["id"],
                    "countedQuantity": original,
                    "note": "Shelf count",
                }
            ],
        },
    )
    assert update_response.status_code == 200
    saved = update_response.get_json()
    assert saved["countedLineCount"] == 1
    assert saved["uncountedLineCount"] == 0
    assert saved["movementCountSinceStart"] == 0

    stale_save = client.patch(
        f"/api/pilot/inventory/count-sessions/{session_id}",
        headers=csrf_headers(client),
        json={
            "updatedAt": stale_updated_at,
            "countedBy": "Closer",
            "notes": "Draft count",
            "lines": [
                {
                    "id": created["lines"][0]["id"],
                    "countedQuantity": original,
                    "note": "Stale retry",
                }
            ],
        },
    )
    assert stale_save.status_code == 409

    resumed = client.get(f"/api/pilot/inventory/count-sessions/{session_id}")
    assert resumed.status_code == 200
    assert resumed.get_json()["lines"][0]["countedQuantity"] == original

    with app.app_context():
        cups_item = InventoryItem.query.filter_by(name="Cups").first()
        assert cups_item is not None
        before_adjustment = float(cups_item.current_on_hand)

    manual_adjustment = client.post(
        f"/api/pilot/inventory/items/{cups.id}/adjustments",
        headers=csrf_headers(client),
        json={
            "reason": "Test timing adjustment",
            "quantityDelta": 2,
            "movementType": "manual increase",
            "sourceRecordId": "count-test-timing",
            "sourceLineId": "count-test-timing-line",
            "note": "During draft count",
        },
    )
    assert manual_adjustment.status_code == 201

    draft_after_adjustment = client.get(f"/api/pilot/inventory/count-sessions/{session_id}").get_json()
    assert draft_after_adjustment["movementCountSinceStart"] >= 1
    assert draft_after_adjustment["hasMovementSinceStart"] is True

    blocked = client.post(
        f"/api/pilot/inventory/count-sessions/{session_id}/finalize",
        headers=csrf_headers(client),
    )
    assert blocked.status_code == 409
    assert blocked.get_json()["error"] == "Inventory changed after this count began."

    confirmed = client.post(
        f"/api/pilot/inventory/count-sessions/{session_id}/finalize",
        headers=csrf_headers(client),
        json={"confirmConcurrency": True},
    )
    assert confirmed.status_code == 200
    assert confirmed.get_json()["status"] == "Completed"

    with app.app_context():
        cups_after = InventoryItem.query.filter_by(name="Cups").first()
        assert cups_after is not None
        assert float(cups_after.current_on_hand) == original
        assert InventoryMovement.query.filter_by(source_record_id=str(session_id), source_type="stock count reconciliation").count() == 1
        assert StockCountSession.query.filter_by(id=session_id, status="Completed").count() == 1
        assert float(cups_after.current_on_hand) == before_adjustment + 2 - 2


def test_count_session_finalize_rolls_back_if_commit_fails(app, client, monkeypatch):
    login(client)

    inventory = client.get("/api/pilot/inventory").get_json()
    cups = next(item for item in inventory["items"] if item["name"] == "Cups")

    create_response = client.post(
        "/api/pilot/inventory/count-sessions",
        headers=csrf_headers(client),
        json={
            "countedBy": "Closer",
            "notes": "Rollback test",
            "itemIds": [cups["id"]],
        },
    )
    assert create_response.status_code == 201
    session_id = create_response.get_json()["id"]

    update_response = client.patch(
        f"/api/pilot/inventory/count-sessions/{session_id}",
        headers=csrf_headers(client),
        json={
            "countedBy": "Closer",
            "notes": "Rollback test",
            "lines": [
                {
                    "id": create_response.get_json()["lines"][0]["id"],
                    "countedQuantity": cups["currentOnHand"],
                    "note": "Rollback line",
                }
            ],
        },
    )
    assert update_response.status_code == 200

    original_commit = db.session.commit

    def failing_commit():
        raise RuntimeError("boom")

    monkeypatch.setattr(db.session, "commit", failing_commit)

    response = client.post(
        f"/api/pilot/inventory/count-sessions/{session_id}/finalize",
        headers=csrf_headers(client),
        json={"confirmConcurrency": True},
    )
    assert response.status_code == 500

    monkeypatch.setattr(db.session, "commit", original_commit)

    with app.app_context():
        session_record = StockCountSession.query.filter_by(id=session_id).first()
        assert session_record is not None
        assert session_record.status == "Draft"
        assert InventoryMovement.query.filter_by(source_record_id=str(session_id), source_type="stock count reconciliation").count() == 0


def test_manual_inventory_adjustment_records_movement_and_updates_quantity(app, client):
    login(client)

    with app.app_context():
        cups = InventoryItem.query.filter_by(name="Cups").first()
        assert cups is not None
        before = float(cups.current_on_hand)

    response = client.post(
        f"/api/pilot/inventory/items/{cups.id}/adjustments",
        headers=csrf_headers(client),
        json={
            "reason": "Broken cup stock take",
            "quantityDelta": 3,
            "movementType": "manual increase",
            "sourceRecordId": "manual-test",
            "sourceLineId": "manual-test-line",
            "note": "Test adjustment",
        },
    )
    assert response.status_code == 201
    body = response.get_json()
    assert body["quantityDelta"] == 3

    with app.app_context():
        cups_after = InventoryItem.query.filter_by(name="Cups").first()
        assert cups_after is not None
        assert float(cups_after.current_on_hand) == before + 3
        assert InventoryMovement.query.filter_by(source_record_id="manual-test", source_line_id="manual-test-line").count() == 1


def test_inventory_item_patch_rejects_quantity_and_cost_basis_changes(app, client):
    login(client)

    with app.app_context():
        cups = InventoryItem.query.filter_by(name="Cups").first()
        assert cups is not None
        cups_id = cups.id
        before_current_on_hand = float(cups.current_on_hand)
        before_latest_purchase_price = float(cups.latest_purchase_price)
        before_last_purchase_unit = cups.last_purchase_unit
        before_last_purchase_conversion_factor = float(cups.last_purchase_conversion_factor)

    response = client.patch(
        f"/api/pilot/inventory/items/{cups_id}",
        headers=csrf_headers(client),
        json={
            "currentOnHand": before_current_on_hand + 5,
            "averageUnitCost": 99.99,
            "latestPurchasePrice": before_latest_purchase_price + 1,
            "lastPurchaseUnit": "case",
            "lastPurchaseConversionFactor": before_last_purchase_conversion_factor + 1,
        },
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body["errors"]["currentOnHand"] == "Current on hand is controlled by receipts, adjustments, and stock counts."
    assert body["errors"]["averageUnitCost"] == "Average unit cost is derived from purchase history."
    assert body["errors"]["latestPurchasePrice"] == "Latest price is derived from purchase receipts."
    assert body["errors"]["lastPurchaseUnit"] == "Last purchase unit is derived from purchase receipts."
    assert body["errors"]["lastPurchaseConversionFactor"] == "Purchase conversion is derived from purchase receipts."

    with app.app_context():
        cups_after = InventoryItem.query.filter_by(id=cups_id).first()
        assert cups_after is not None
        assert float(cups_after.current_on_hand) == before_current_on_hand
        assert float(cups_after.latest_purchase_price) == before_latest_purchase_price
        assert cups_after.last_purchase_unit == before_last_purchase_unit
        assert float(cups_after.last_purchase_conversion_factor) == before_last_purchase_conversion_factor


def test_reorder_plan_mark_ordered(app, client):
    login(client)

    response = client.get("/api/pilot/reorder-plan")
    assert response.status_code == 200
    body = response.get_json()
    assert body["suggestions"]
    assert body["suggestions"][0]["stockStatus"] in {"Out of stock", "Reorder now", "Low stock"}

    item_id = body["suggestions"][0]["inventoryItemId"]
    mark = client.post(f"/api/pilot/reorder-plan/{item_id}/ordered", headers=csrf_headers(client))
    assert mark.status_code == 200
    assert mark.get_json()["status"] == "Ordered"

    with app.app_context():
        assert ReorderIntent.query.filter_by(inventory_item_id=item_id, status="Ordered").count() == 1


def test_reorder_plan_draft_lifecycle_preserves_snapshots(app, client):
    login(client)

    create_response = client.post("/api/pilot/reorder-plans", headers=csrf_headers(client))
    assert create_response.status_code == 201
    plan = create_response.get_json()
    assert plan["status"] == "Draft"
    assert plan["lines"]
    original_plan_id = plan["id"]
    first_line = plan["lines"][0]
    original_unit_cost = first_line["estimatedUnitCost"]

    duplicate_open = client.post("/api/pilot/reorder-plans", headers=csrf_headers(client))
    assert duplicate_open.status_code == 200
    assert duplicate_open.get_json()["id"] == original_plan_id

    update_response = client.patch(
        f"/api/pilot/reorder-plans/{original_plan_id}",
        headers=csrf_headers(client),
        json={
            "name": "Weekly reorder",
            "notes": "Draft reorder plan",
            "lines": [
                {
                    "id": first_line["id"],
                    "orderQuantity": first_line["orderQuantity"] + 2,
                    "notes": "Add buffer",
                    "excluded": False,
                }
            ],
        },
    )
    assert update_response.status_code == 200
    updated = update_response.get_json()
    assert updated["name"] == "Weekly reorder"
    assert updated["notes"] == "Draft reorder plan"
    assert updated["lines"][0]["orderQuantity"] == first_line["orderQuantity"] + 2

    refreshed = client.get(f"/api/pilot/reorder-plans/{original_plan_id}")
    assert refreshed.status_code == 200
    assert refreshed.get_json()["lines"][0]["orderQuantity"] == first_line["orderQuantity"] + 2

    with app.app_context():
        item = InventoryItem.query.filter_by(id=first_line["inventoryItemId"]).first()
        assert item is not None
        item.latest_purchase_price = item.latest_purchase_price + 10
        db.session.commit()

    reopened = client.get(f"/api/pilot/reorder-plans/{original_plan_id}")
    assert reopened.status_code == 200
    reopened_plan = reopened.get_json()
    assert reopened_plan["lines"][0]["estimatedUnitCost"] == original_unit_cost

    prepared = client.post(f"/api/pilot/reorder-plans/{original_plan_id}/prepare", headers=csrf_headers(client))
    assert prepared.status_code == 200
    assert prepared.get_json()["status"] == "Prepared"

    completed = client.post(f"/api/pilot/reorder-plans/{original_plan_id}/complete", headers=csrf_headers(client))
    assert completed.status_code == 200
    assert completed.get_json()["status"] == "Completed"

    duplicate = client.post(f"/api/pilot/reorder-plans/{original_plan_id}/complete", headers=csrf_headers(client))
    assert duplicate.status_code == 409

    list_response = client.get("/api/pilot/reorder-plans")
    assert list_response.status_code == 200
    plans = list_response.get_json()["plans"]
    assert any(entry["id"] == original_plan_id and entry["status"] == "Completed" for entry in plans)


def test_reorder_plan_isolated_by_membership(app, client):
    login(client)

    create_response = client.post("/api/pilot/reorder-plans", headers=csrf_headers(client))
    assert create_response.status_code == 201
    original_plan_id = create_response.get_json()["id"]

    with app.app_context():
        owner_user = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner_user is not None
        other_org = make_operational_organization(
            owner_user,
            name=f"Other Reorder Org {uuid4().hex[:8]}",
            location_name="Other Reorder Location",
        )
        other_membership_id = other_org.memberships[0].id

    with client.session_transaction() as session:
        session["pilot_current_membership_id"] = other_membership_id

    isolated_list = client.get("/api/pilot/reorder-plans")
    assert isolated_list.status_code == 200
    isolated_plans = isolated_list.get_json()["plans"]
    assert all(plan["id"] != original_plan_id for plan in isolated_plans)

    isolated_detail = client.get(f"/api/pilot/reorder-plans/{original_plan_id}")
    assert isolated_detail.status_code == 404


def test_pilot_end_to_end_workflow_updates_dashboard_and_ledger(app, client):
    login(client)

    dashboard_before = client.get("/api/pilot/dashboard").get_json()
    inventory_before = client.get("/api/pilot/inventory").get_json()
    starting_quantities = {item["id"]: float(item["currentOnHand"]) for item in inventory_before["items"]}
    with app.app_context():
        organization = Organization.query.filter_by(name=LOCAL_ORGANIZATION_NAME).first()
        location = RestaurantLocation.query.filter_by(name=LOCAL_LOCATION_NAME).first()
        assert organization is not None and location is not None
        org_id = organization.id
        location_id = location.id
        starting_ledger_totals = {
            item.id: sum(
                float(movement.quantity_delta)
                for movement in InventoryMovement.query.filter_by(
                    organization_id=org_id,
                    location_id=location_id,
                    inventory_item_id=item.id,
                ).all()
            )
            for item in InventoryItem.query.filter_by(organization_id=org_id, location_id=location_id).all()
        }

    supplier_name = f"Integration Supplier {uuid4().hex[:8]}"
    supplier_response = client.post(
        "/api/pilot/suppliers",
        headers=csrf_headers(client),
        json={
            "name": supplier_name,
            "categoryFocus": "Dry goods",
            "contactName": "Integration Contact",
            "contactPhone": "416-555-0100",
            "contactEmail": "integration@supplier.example",
            "orderingNotes": "Leave by kitchen door.",
            "notes": "Integration test supplier",
            "isActive": True,
        },
    )
    assert supplier_response.status_code == 201

    item_name = f"Integration Rice {uuid4().hex[:8]}"
    item_response = client.post(
        "/api/pilot/inventory/items",
        headers=csrf_headers(client),
        json={
            "name": item_name,
            "category": "Dry goods",
            "stockUnit": "kg",
            "currentOnHand": 0,
            "minQuantity": 2,
            "parLevel": 6,
            "preferredSupplierName": supplier_name,
            "latestPurchasePrice": 4.25,
            "lastPurchaseUnit": "case",
            "lastPurchaseConversionFactor": 4,
            "averageDailyUsage": 0.5,
        },
    )
    assert item_response.status_code == 201
    item = item_response.get_json()
    assert item["lastPurchaseUnit"] == "case"
    assert float(item["lastPurchaseConversionFactor"]) == 4

    invoice_number = f"INT-{uuid4().hex[:8].upper()}"
    invoice_response = client.post(
        "/api/pilot/purchases/invoices",
        headers=csrf_headers(client),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": invoice_number,
            "invoiceDate": "2026-07-16",
            "subtotal": 34,
            "tax": 4.42,
            "totalAmount": 38.42,
            "notes": "Integration flow invoice",
            "status": "Ready",
            "sourceFileName": "integration-flow.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "manual",
            "extractedText": "Integration flow invoice text",
            "lineItems": [
                {
                    "description": "Integration Rice 2kg",
                    "inventoryItemId": item["id"],
                    "purchaseUnit": "case",
                    "inventoryUnit": "kg",
                    "conversionFactor": 4,
                    "quantity": 2,
                    "unitPrice": 17,
                    "lineTotal": 34,
                    "confidence": 0.98,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert invoice_response.status_code == 201
    invoice = invoice_response.get_json()

    receive_response = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=csrf_headers(client))
    assert receive_response.status_code == 200
    received_invoice = receive_response.get_json()
    assert received_invoice["status"] == "Completed"
    assert received_invoice["lineItems"][0]["inventoryItemId"] == item["id"]

    with app.app_context():
        receipt_movements = InventoryMovement.query.filter_by(
            organization_id=invoice["organizationId"],
            location_id=invoice["locationId"],
            source_type="invoice receipt",
            source_record_id=str(invoice["id"]),
        ).all()
        assert len(receipt_movements) == 1
        current_item = InventoryItem.query.filter_by(id=item["id"]).first()
        assert current_item is not None
        quantity_after_receipt = float(current_item.current_on_hand)

    adjustment_response = client.post(
        f"/api/pilot/inventory/items/{item['id']}/adjustments",
        headers=csrf_headers(client),
        json={
            "reason": "Integration adjustment",
            "quantityDelta": 1,
            "movementType": "manual decrease",
            "sourceRecordId": "integration-adjustment",
            "sourceLineId": "integration-adjustment-line",
            "note": "Integration flow",
        },
    )
    assert adjustment_response.status_code == 201

    count_session_response = client.post(
        "/api/pilot/inventory/count-sessions",
        headers=csrf_headers(client),
        json={
            "countedBy": "Integration Manager",
            "notes": "Integration count",
            "itemIds": [item["id"]],
        },
    )
    assert count_session_response.status_code == 201
    count_session = count_session_response.get_json()
    count_line = count_session["lines"][0]

    save_count_response = client.patch(
        f"/api/pilot/inventory/count-sessions/{count_session['id']}",
        headers=csrf_headers(client),
        json={
            "countedBy": "Integration Manager",
            "notes": "Integration count",
                "lines": [
                    {
                        "id": count_line["id"],
                        "countedQuantity": quantity_after_receipt + 1,
                        "note": "Counted after shelf review",
                    }
                ],
        },
    )
    assert save_count_response.status_code == 200

    finalize_count_response = client.post(f"/api/pilot/inventory/count-sessions/{count_session['id']}/finalize", headers=csrf_headers(client))
    assert finalize_count_response.status_code == 200
    assert finalize_count_response.get_json()["status"] == "Completed"

    reorder_plan_response = client.post("/api/pilot/reorder-plans", headers=csrf_headers(client))
    assert reorder_plan_response.status_code in {200, 201}
    reorder_plan = reorder_plan_response.get_json()
    assert reorder_plan["lines"]

    prepare_response = client.post(f"/api/pilot/reorder-plans/{reorder_plan['id']}/prepare", headers=csrf_headers(client))
    assert prepare_response.status_code == 200
    assert prepare_response.get_json()["status"] == "Prepared"

    complete_response = client.post(f"/api/pilot/reorder-plans/{reorder_plan['id']}/complete", headers=csrf_headers(client))
    assert complete_response.status_code == 200
    assert complete_response.get_json()["status"] == "Completed"

    correction_response = client.post(
        f"/api/pilot/purchases/invoices/{invoice['id']}/correct",
        headers=csrf_headers(client),
        json={"reason": "Integration correction"},
    )
    assert correction_response.status_code == 200
    assert correction_response.get_json()["status"] == "Corrected"

    dashboard_after = client.get("/api/pilot/dashboard").get_json()
    assert dashboard_after["summary"]["inventoryMovementCount"] >= dashboard_before["summary"]["inventoryMovementCount"] + 3
    assert any(entry["invoiceNumber"] == invoice_number for entry in dashboard_after["recentInvoices"])
    assert any(movement["inventoryItemName"] == item_name for movement in dashboard_after["recentMovements"])

    with app.app_context():
        org_id = invoice["organizationId"]
        location_id = invoice["locationId"]
        all_items = InventoryItem.query.filter_by(organization_id=org_id, location_id=location_id).all()
        for inventory_item in all_items:
            ending_ledger_total = sum(
                float(movement.quantity_delta)
                for movement in InventoryMovement.query.filter_by(
                    organization_id=org_id,
                    location_id=location_id,
                    inventory_item_id=inventory_item.id,
                ).all()
            )
            starting_quantity = starting_quantities.get(inventory_item.id, 0.0)
            starting_ledger_total = starting_ledger_totals.get(inventory_item.id, 0.0)
            expected_quantity = starting_quantity + (ending_ledger_total - starting_ledger_total)
            assert round(float(inventory_item.current_on_hand), 4) == round(expected_quantity, 4)

    with app.app_context():
        owner_user = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner_user is not None
        other_org = make_operational_organization(
            owner_user,
            name=f"Other Integration Org {uuid4().hex[:8]}",
            location_name="Other Integration Location",
        )
        other_membership_id = other_org.memberships[0].id

    with client.session_transaction() as session:
        session["pilot_current_membership_id"] = other_membership_id

    assert client.get(f"/api/pilot/purchases/invoices/{invoice['id']}").status_code == 404
    assert client.get(f"/api/pilot/inventory/items/{item['id']}").status_code == 404
    assert client.get(f"/api/pilot/reorder-plans/{reorder_plan['id']}").status_code == 404


def test_supplier_management_create_update_and_deactivate(app, client):
    login(client)

    create_response = client.post(
        "/api/pilot/suppliers",
        headers=csrf_headers(client),
        json={
            "name": "Toronto Greens Market",
            "categoryFocus": "Produce",
            "contactName": "Ava Chen",
            "contactPhone": "416-555-0199",
            "contactEmail": "orders@torontogreens.ca",
            "orderingNotes": "Call before 3pm for same-day delivery.",
            "notes": "Weekend produce vendor",
            "isActive": True,
        },
    )
    assert create_response.status_code == 201
    supplier = create_response.get_json()
    assert supplier["name"] == "Toronto Greens Market"
    assert supplier["isActive"] is True
    assert supplier["contactName"] == "Ava Chen"
    assert supplier["contactEmail"] == "orders@torontogreens.ca"

    update_response = client.patch(
        f"/api/pilot/suppliers/{supplier['id']}",
        headers=csrf_headers(client),
        json={
            "name": "Toronto Greens Market Co",
            "categoryFocus": "Produce",
            "contactName": "Ava Chen",
            "contactPhone": "416-555-0101",
            "contactEmail": "purchasing@torontogreens.ca",
            "orderingNotes": "Leave at back door.",
            "notes": "Updated vendor notes",
            "isActive": False,
        },
    )
    assert update_response.status_code == 200
    updated = update_response.get_json()
    assert updated["name"] == "Toronto Greens Market Co"
    assert updated["isActive"] is False
    assert updated["contactPhone"] == "416-555-0101"
    assert updated["orderingNotes"] == "Leave at back door."

    bad_email_response = client.patch(
        f"/api/pilot/suppliers/{supplier['id']}",
        headers=csrf_headers(client),
        json={"contactEmail": "not-an-email"},
    )
    assert bad_email_response.status_code == 400

    duplicate_response = client.post(
        "/api/pilot/suppliers",
        headers=csrf_headers(client),
        json={"name": "Toronto Greens Market Co"},
    )
    assert duplicate_response.status_code == 409

    with app.app_context():
        stored = Supplier.query.filter_by(name="Toronto Greens Market Co").first()
        assert stored is not None
        assert stored.is_active is False


def test_supplier_list_exposes_history_and_manager_access_is_required(app, client):
    login_manager(client)

    created_response = client.post(
        "/api/pilot/suppliers",
        headers=csrf_headers(client),
        json={
            "name": f"Manager Supply {uuid4().hex[:8]}",
            "categoryFocus": "Dry goods",
            "contactName": "Manager Contact",
            "contactPhone": "416-555-0180",
            "contactEmail": "manager@supply.example",
            "orderingNotes": "Place order before noon.",
            "notes": "Created by manager",
            "isActive": True,
        },
    )
    assert created_response.status_code == 201
    created_supplier = created_response.get_json()

    updated_response = client.patch(
        f"/api/pilot/suppliers/{created_supplier['id']}",
        headers=csrf_headers(client),
        json={
            "contactPhone": "416-555-0181",
            "orderingNotes": "Leave at front desk.",
        },
    )
    assert updated_response.status_code == 200
    assert updated_response.get_json()["contactPhone"] == "416-555-0181"

    supplier_response = client.get("/api/pilot/suppliers")
    assert supplier_response.status_code == 200
    suppliers = supplier_response.get_json()["suppliers"]
    harbour = next(entry for entry in suppliers if entry["name"] == "Harbour Dry Goods")
    assert harbour["purchaseInvoiceCount"] >= 1
    assert harbour["supplierItemMappingCount"] >= 1
    assert harbour["historicalReferenceCount"] >= harbour["purchaseInvoiceCount"]
    assert harbour["recentInvoices"]
    assert harbour["recentMappings"]

    with app.app_context():
        manager_user = User.query.filter_by(email=LOCAL_MANAGER_EMAIL).first()
        assert manager_user is not None
        other_org = make_operational_organization(
            manager_user,
            name=f"Other Supplier Org {uuid4().hex[:8]}",
            location_name="Other Location",
            role="manager",
        )
        db.session.add(
            Supplier(
                organization=other_org,
                name="Isolated Supplier",
                normalized_name="isolated supplier",
                category_focus="Other",
                contact_name="Other Contact",
                contact_phone="",
                contact_email="other@example.com",
                ordering_notes="",
                notes="",
                is_active=True,
            )
        )
        db.session.commit()
        other_membership_id = other_org.memberships[0].id

    with client.session_transaction() as session:
        session["pilot_current_membership_id"] = other_membership_id

    isolated_suppliers = client.get("/api/pilot/suppliers")
    assert isolated_suppliers.status_code == 200
    isolated_names = [entry["name"] for entry in isolated_suppliers.get_json()["suppliers"]]
    assert "Isolated Supplier" in isolated_names
    assert "Harbour Dry Goods" not in isolated_names


def test_manager_can_create_update_and_adjust_inventory_item(app, client):
    login_manager(client)

    unique_name = f"Manager Test Item {uuid4().hex[:8]}"
    create_response = client.post(
        "/api/pilot/inventory/items",
        headers=csrf_headers(client),
        json={
            "name": unique_name,
            "category": "Dry goods",
            "stockUnit": "kg",
            "currentOnHand": 4,
            "minQuantity": 2,
            "parLevel": 6,
            "preferredSupplierName": "Harbour Dry Goods",
            "latestPurchasePrice": 3.5,
            "lastPurchaseUnit": "case",
            "lastPurchaseConversionFactor": 4,
        },
    )
    assert create_response.status_code == 201
    item = create_response.get_json()
    assert item["name"] == unique_name

    update_response = client.patch(
        f"/api/pilot/inventory/items/{item['id']}",
        headers=csrf_headers(client),
        json={
            "parLevel": 8,
            "notes": "Updated by manager",
            "active": False,
        },
    )
    assert update_response.status_code == 200
    updated = update_response.get_json()
    assert updated["parLevel"] == 8
    assert updated["active"] is False

    adjustment_response = client.post(
        f"/api/pilot/inventory/items/{item['id']}/adjustments",
        headers=csrf_headers(client),
        json={
            "reason": "Manager count",
            "quantityDelta": 2,
            "movementType": "manual increase",
            "sourceRecordId": "manager-item-test",
            "sourceLineId": "manager-item-test-line",
            "note": "Manager verification",
        },
    )
    assert adjustment_response.status_code == 201

    with app.app_context():
        stored = InventoryItem.query.filter_by(name=unique_name).first()
        assert stored is not None
        assert float(stored.current_on_hand) == 6
        assert stored.last_purchase_unit == "case"
        assert float(stored.last_purchase_conversion_factor) == 4


def test_inventory_items_are_isolated_by_membership(app, client):
    login_manager(client)

    original_inventory = client.get("/api/pilot/inventory").get_json()
    original_names = [entry["name"] for entry in original_inventory["items"]]
    assert "Cream" in original_names

    with app.app_context():
        manager_user = User.query.filter_by(email=LOCAL_MANAGER_EMAIL).first()
        assert manager_user is not None
        other_org = make_operational_organization(
            manager_user,
            name=f"Other Inventory Org {uuid4().hex[:8]}",
            location_name="Other Inventory Location",
            role="manager",
        )
        other_location = other_org.locations[0]
        db.session.add(
            InventoryItem(
                organization=other_org,
                location=other_location,
                name="Isolated Inventory Item",
                normalized_name="isolated inventory item",
                category="Other",
                stock_unit="each",
                current_on_hand=1,
                min_quantity=0,
                par_level=1,
                preferred_supplier_name="",
                latest_purchase_price=1,
                last_purchase_unit="each",
                last_purchase_conversion_factor=1,
                active=True,
                notes="",
            )
        )
        db.session.commit()
        other_membership_id = other_org.memberships[0].id

    with client.session_transaction() as session:
        session["pilot_current_membership_id"] = other_membership_id

    isolated_inventory = client.get("/api/pilot/inventory")
    assert isolated_inventory.status_code == 200
    isolated_names = [entry["name"] for entry in isolated_inventory.get_json()["items"]]
    assert "Isolated Inventory Item" in isolated_names
    assert "Cream" not in isolated_names

    detail = client.get(f"/api/pilot/inventory/items/{isolated_inventory.get_json()['items'][0]['id']}")
    assert detail.status_code == 200
