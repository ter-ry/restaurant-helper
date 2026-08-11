from __future__ import annotations

from datetime import datetime, timezone

from backend.extensions import db
from backend.models import (
    InventoryItem,
    MenuItem,
    SquareCatalogMapping,
    SquareCatalogObject,
    SquareConnection,
    SquareLocation,
    SquareLocationMapping,
    SquareOrder,
    SquareOrderLine,
    User,
)
from backend.seed import LOCAL_MANAGER_EMAIL, LOCAL_MANAGER_PASSWORD, LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD


def login_owner(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 200


def csrf_headers(client):
    return {"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]}


def test_menu_costing_supports_recipe_editing_sales_matching_and_variance(app, client):
    login_owner(client)

    inventory = client.get("/api/pilot/inventory").get_json()
    item_ids = {item["name"]: item["id"] for item in inventory["items"]}
    chicken_id = item_ids["Chicken Breast"]
    rice_id = item_ids["Rice"]
    cream_id = item_ids["Cream"]

    create_response = client.post(
        "/api/pilot/menu-items",
        headers=csrf_headers(client),
        json={
            "name": "Readiness Chicken Bowl",
            "category": "Lunch bowls",
            "sellingPrice": 14.95,
            "active": True,
            "notes": "Created during the menu readiness pass.",
            "recipeLines": [
                {"ingredientName": "Chicken Breast", "inventoryItemId": chicken_id, "quantity": 0.16, "unit": "kg", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
                {"ingredientName": "Rice", "inventoryItemId": rice_id, "quantity": 0.14, "unit": "kg", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
                {"ingredientName": "Cream drizzle", "inventoryItemId": cream_id, "quantity": 0.05, "unit": "L", "inventoryUnit": "L", "purchaseUnit": "L", "conversionFactor": 1},
            ],
        },
    )
    assert create_response.status_code == 201
    created_snapshot = create_response.get_json()
    created_item = next(item for item in created_snapshot["menuItems"] if item["name"] == "Readiness Chicken Bowl")
    assert created_item["recipe"]["lineCount"] == 3

    update_response = client.patch(
        f"/api/pilot/menu-items/{created_item['id']}",
        headers=csrf_headers(client),
        json={
            "name": "Readiness Chicken Bowl",
            "category": "Lunch bowls",
            "sellingPrice": 15.25,
            "active": True,
            "notes": "Margin reviewed after launch.",
            "recipeLines": [
                {"ingredientName": "Chicken Breast", "inventoryItemId": chicken_id, "quantity": 0.18, "unit": "kg", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
                {"ingredientName": "Rice", "inventoryItemId": rice_id, "quantity": 0.15, "unit": "kg", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
                {"ingredientName": "Cream drizzle", "inventoryItemId": cream_id, "quantity": 0.04, "unit": "L", "inventoryUnit": "L", "purchaseUnit": "L", "conversionFactor": 1},
            ],
        },
    )
    assert update_response.status_code == 200
    updated_snapshot = update_response.get_json()
    updated_item = next(item for item in updated_snapshot["menuItems"] if item["id"] == created_item["id"])
    assert updated_item["sellingPrice"] == 15.25
    assert updated_item["recipe"]["lines"][0]["quantity"] == 0.18

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        organization_id = created_item["organizationId"]
        location_id = created_item["locationId"]

        connection = SquareConnection(
            organization_id=organization_id,
            environment="sandbox",
            square_merchant_id="menu-costing-test",
            status="connected",
            access_token_ciphertext="",
            refresh_token_ciphertext="",
        )
        db.session.add(connection)
        db.session.flush()

        square_location = SquareLocation(
            square_connection_id=connection.id,
            square_location_id="square-location-test",
            name="Flowtally Pilot Kitchen",
            status="active",
            raw_payload_json={},
        )
        db.session.add(square_location)
        db.session.flush()
        db.session.add(
            SquareLocationMapping(
                square_location_id=square_location.id,
                restaurant_location_id=location_id,
                mapped_by_user_id=owner.id,
            )
        )

        catalog_object = SquareCatalogObject(
            square_connection_id=connection.id,
            square_object_id="VARIANT-CHICKEN-RICE",
            object_type="ITEM_VARIATION",
            version=1,
            is_deleted=False,
            raw_payload_json={"name": "Chicken Rice Bowl"},
        )
        db.session.add(catalog_object)
        db.session.flush()
        db.session.add(
            SquareCatalogMapping(
                square_catalog_object_id=catalog_object.id,
                mapping_type="menu_item",
                flowtally_entity_type="menu_item",
                flowtally_entity_id=str(created_item["id"]),
                status="mapped",
                mapped_by_user_id=owner.id,
            )
        )

        order = SquareOrder(
            square_connection_id=connection.id,
            square_order_id="ORDER-MENU-001",
            square_location_id=square_location.square_location_id,
            restaurant_location_id=location_id,
            order_state="COMPLETED",
            currency="CAD",
            gross_amount=30.50,
            discount_amount=0,
            tax_amount=0,
            tip_amount=0,
            refund_amount=0,
            net_amount=30.50,
            item_quantity=2,
            line_count=1,
            ordered_at=datetime(2026, 8, 10, 18, 0, tzinfo=timezone.utc),
            closed_at=datetime(2026, 8, 10, 18, 5, tzinfo=timezone.utc),
            raw_payload_json={"id": "ORDER-MENU-001"},
            last_synced_at=datetime(2026, 8, 10, 18, 5, tzinfo=timezone.utc),
            is_deleted=False,
        )
        db.session.add(order)
        db.session.flush()
        db.session.add(
            SquareOrderLine(
                square_order_id=order.id,
                line_uid="ORDER-MENU-001:1",
                line_index=0,
                square_item_variation_id="VARIANT-CHICKEN-RICE",
                name="Chicken Rice Bowl",
                quantity=2,
                gross_amount=30.50,
                discount_amount=0,
                tax_amount=0,
                tip_amount=0,
                net_amount=30.50,
                raw_payload_json={"name": "Chicken Rice Bowl"},
            )
        )
        db.session.commit()

    costing = client.get("/api/pilot/menu-costing?lookbackDays=30")
    assert costing.status_code == 200
    body = costing.get_json()

    assert body["summary"]["menuItemCount"] >= 1
    assert body["summary"]["mappedMenuItemCount"] >= 1
    assert body["summary"]["salesUnits"] >= 2

    menu_item = next(item for item in body["menuItems"] if item["id"] == created_item["id"])
    assert menu_item["salesUnits"] == 2
    assert menu_item["mappingStatus"] == "Mapped"
    assert menu_item["recipeCost"] > 0
    assert menu_item["marginPercent"] is not None

    chicken_usage = next(row for row in body["inventoryUsage"] if row["inventoryItemName"] == "Chicken Breast")
    assert chicken_usage["theoreticalUsage"] > 0
    assert chicken_usage["actualStockCount"] is not None
    assert chicken_usage["variance"] is not None
