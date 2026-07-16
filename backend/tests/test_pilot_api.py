from __future__ import annotations

from uuid import uuid4

from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement, Organization, OrganizationMembership, PurchaseInvoice, RestaurantLocation, ReorderIntent, StockCountSession, Supplier, SupplierItemMapping, User
from backend.seed import LOCAL_MANAGER_EMAIL, LOCAL_MANAGER_PASSWORD, LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD


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


def test_pilot_mutations_require_auth_csrf_and_active_users(app, client):
    anonymous_dashboard = client.get("/api/pilot/dashboard")
    assert anonymous_dashboard.status_code == 401

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
        correction_movements = InventoryMovement.query.filter_by(
            organization_id=invoice["organizationId"],
            location_id=invoice["locationId"],
            source_type="invoice correction",
            source_record_id=str(invoice["id"]),
        ).count()
        assert correction_movements == 1
        stored_invoice = PurchaseInvoice.query.filter_by(id=invoice["id"]).first()
        assert stored_invoice is not None and stored_invoice.status == "Corrected"


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
    cups = next(item for item in inventory["items"] if item["name"] == "Cups")

    create_response = client.post(
        "/api/pilot/inventory/count-sessions",
        headers=csrf_headers(client),
        json={
            "countedBy": "Manager on duty",
            "notes": "Evening count",
            "itemIds": [chicken["id"], cups["id"]],
        },
    )
    assert create_response.status_code == 201
    session_id = create_response.get_json()["id"]
    stale_updated_at = create_response.get_json()["updatedAt"]

    update_response = client.patch(
        f"/api/pilot/inventory/count-sessions/{session_id}",
        headers=csrf_headers(client),
        json={
            "countedBy": "Manager on duty",
            "notes": "Evening count",
            "lines": [
                {"id": create_response.get_json()["lines"][0]["id"], "countedQuantity": 0.0, "note": "Counted on shelf"},
                {"id": create_response.get_json()["lines"][1]["id"], "countedQuantity": 31.0, "note": "Good"},
            ],
        },
    )
    assert update_response.status_code == 200

    finalize = client.post(f"/api/pilot/inventory/count-sessions/{session_id}/finalize", headers=csrf_headers(client))
    assert finalize.status_code == 200
    assert finalize.get_json()["status"] == "Completed"

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
        cups_item = InventoryItem.query.filter_by(name="Cups").first()
        assert chicken_item is not None and cups_item is not None
        assert float(chicken_item.current_on_hand) == 0.0
        assert float(cups_item.current_on_hand) == 31.0
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
    session_id = create_response.get_json()["id"]
    stale_updated_at = create_response.get_json()["updatedAt"]

    update_response = client.patch(
        f"/api/pilot/inventory/count-sessions/{session_id}",
        headers=csrf_headers(client),
        json={
            "countedBy": "Closer",
            "notes": "Draft count",
            "lines": [
                {
                    "id": create_response.get_json()["lines"][0]["id"],
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
                    "id": create_response.get_json()["lines"][0]["id"],
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
        other_org = Organization(name=f"Other Supplier Org {uuid4().hex[:8]}")
        db.session.add(other_org)
        db.session.flush()
        other_location = RestaurantLocation(
            organization=other_org,
            name="Other Location",
            address_line1="1 Test St",
            address_line2="",
            city="Toronto",
            region="ON",
            postal_code="M5V 2T6",
            country="Canada",
            timezone="America/Toronto",
        )
        db.session.add(other_location)
        manager_user = User.query.filter_by(email=LOCAL_MANAGER_EMAIL).first()
        assert manager_user is not None
        other_membership = OrganizationMembership(user=manager_user, organization=other_org, role="manager")
        db.session.add(other_membership)
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
        other_membership_id = other_membership.id

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
        },
    )
    assert update_response.status_code == 200
    updated = update_response.get_json()
    assert updated["parLevel"] == 8

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
