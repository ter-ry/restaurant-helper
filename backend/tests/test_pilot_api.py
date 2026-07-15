from __future__ import annotations

from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement, PurchaseInvoice, ReorderIntent, StockCountSession
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD


def login(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
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

    duplicate = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=csrf_headers(client))
    assert duplicate.status_code == 409

    with app.app_context():
        cream = InventoryItem.query.filter_by(name="Cream").first()
        assert cream is not None
        assert float(cream.current_on_hand) == before + 1
        assert InventoryMovement.query.filter_by(source_record_id=str(invoice["id"])).count() >= 3


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

    update_response = client.patch(
        f"/api/pilot/inventory/count-sessions/{session_id}",
        headers=csrf_headers(client),
        json={
            "countedBy": "Manager on duty",
            "notes": "Evening count",
            "lines": [
                {"id": create_response.get_json()["lines"][0]["id"], "countedQuantity": 4.0, "note": "Counted on shelf"},
                {"id": create_response.get_json()["lines"][1]["id"], "countedQuantity": 31.0, "note": "Good"},
            ],
        },
    )
    assert update_response.status_code == 200

    finalize = client.post(f"/api/pilot/inventory/count-sessions/{session_id}/finalize", headers=csrf_headers(client))
    assert finalize.status_code == 200
    assert finalize.get_json()["status"] == "Completed"

    with app.app_context():
        chicken_item = InventoryItem.query.filter_by(name="Chicken Breast").first()
        cups_item = InventoryItem.query.filter_by(name="Cups").first()
        assert chicken_item is not None and cups_item is not None
        assert float(chicken_item.current_on_hand) == 4.0
        assert float(cups_item.current_on_hand) == 31.0
        assert StockCountSession.query.filter_by(id=session_id, status="Completed").count() == 1


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
