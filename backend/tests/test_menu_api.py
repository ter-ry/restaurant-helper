from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import (
    InventoryItem,
    InventoryMovement,
    MenuItem,
    MenuRecipe,
    MenuRecipeLine,
    Organization,
    PurchaseInvoice,
    PurchaseInvoiceLine,
    RestaurantLocation,
    SquareCatalogMapping,
    SquareCatalogObject,
    SquareConnection,
    SquareLocation,
    SquareLocationMapping,
    SquareOrder,
    SquareOrderLine,
    StockCountSession,
    StockCountSessionLine,
    Supplier,
    User,
)
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization


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


def create_inventory_item(client, *, name: str, stock_unit: str, current_on_hand: float, latest_purchase_price: float, last_purchase_unit: str | None = None):
    response = client.post(
        "/api/pilot/inventory/items",
        headers=csrf_headers(client),
        json={
            "name": name,
            "category": "Prep",
            "stockUnit": stock_unit,
            "currentOnHand": current_on_hand,
            "minQuantity": 0,
            "parLevel": 0,
            "preferredSupplierName": "",
            "latestPurchasePrice": latest_purchase_price,
            "lastPurchaseUnit": last_purchase_unit or stock_unit,
            "lastPurchaseConversionFactor": 1,
            "active": True,
            "notes": "",
        },
    )
    assert response.status_code == 201
    return response.get_json()


def create_count_session(
    app,
    *,
    organization_id: int,
    location_id: int,
    counted_by: str,
    completed_at: datetime,
    counts: list[tuple[int, float]],
):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        session_record = StockCountSession(
            organization_id=organization_id,
            location_id=location_id,
            status="Completed",
            started_at=completed_at - timedelta(hours=1),
            completed_at=completed_at,
            counted_by=counted_by,
            notes="Seeded count session",
            item_count=len(counts),
            created_by_user_id=owner.id,
            finalized_by_user_id=owner.id,
        )
        db.session.add(session_record)
        db.session.flush()

        for index, (inventory_item_id, counted_quantity) in enumerate(counts):
            item = db.session.get(InventoryItem, inventory_item_id)
            assert item is not None
            counted = Decimal(str(counted_quantity))
            expected = Decimal(str(item.current_on_hand))
            db.session.add(
                StockCountSessionLine(
                    session_id=session_record.id,
                    inventory_item_id=item.id,
                    line_index=index,
                    item_name_snapshot=item.name,
                    stock_unit_snapshot=item.stock_unit,
                    expected_quantity=expected,
                    counted_quantity=counted,
                    variance=(counted - expected).quantize(Decimal("0.0001")),
                    resulting_quantity=counted,
                    note="Seeded count line",
                    status="confirmed",
                )
            )
            item.current_on_hand = counted
            item.last_counted_at = completed_at
            item.updated_by_user_id = owner.id

        db.session.commit()
        return session_record.id


def create_completed_receipt(
    app,
    *,
    organization_id: int,
    location_id: int,
    inventory_item_id: int,
    supplier_name: str,
    invoice_number: str,
    invoice_date: datetime,
    quantity: float,
    unit_price: float,
    purchase_unit: str,
    inventory_unit: str,
    conversion_factor: float,
):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        supplier = Supplier.query.filter_by(organization_id=organization_id, normalized_name=supplier_name.lower()).first()
        if supplier is None:
            supplier = Supplier(
                organization_id=organization_id,
                name=supplier_name,
                normalized_name=supplier_name.lower(),
                category_focus="General",
                contact_name="",
                contact_phone="",
                contact_email="",
                ordering_notes="",
                notes="",
                is_active=True,
            )
            db.session.add(supplier)
            db.session.flush()

        item = db.session.get(InventoryItem, inventory_item_id)
        assert item is not None
        purchase_quantity = Decimal(str(quantity))
        factor = Decimal(str(conversion_factor))
        receipt_delta = (purchase_quantity * factor).quantize(Decimal("0.0001"))
        before = Decimal(str(item.current_on_hand))
        after = (before + receipt_delta).quantize(Decimal("0.0001"))

        invoice = PurchaseInvoice(
            organization_id=organization_id,
            location_id=location_id,
            supplier_id=supplier.id,
            invoice_number=invoice_number,
            invoice_date=invoice_date.date(),
            subtotal=(purchase_quantity * Decimal(str(unit_price))).quantize(Decimal("0.01")),
            tax=Decimal("0.00"),
            total_amount=(purchase_quantity * Decimal(str(unit_price))).quantize(Decimal("0.01")),
            notes="Seeded receipt",
            status="Completed",
            source_file_name=f"{invoice_number}.pdf",
            source_file_type="application/pdf",
            source_file_key="",
            extracted_text="Seeded receipt",
            extraction_status="manual",
            received_at=invoice_date,
            received_by_user_id=owner.id,
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
            posted_at=invoice_date,
        )
        db.session.add(invoice)
        db.session.flush()

        line = PurchaseInvoiceLine(
            invoice_id=invoice.id,
            inventory_item_id=item.id,
            line_index=0,
            description=f"{item.name} receipt",
            normalized_description=item.name.lower(),
            purchase_unit=purchase_unit,
            inventory_unit=inventory_unit,
            conversion_factor=factor,
            quantity=purchase_quantity,
            unit_price=Decimal(str(unit_price)),
            line_total=(purchase_quantity * Decimal(str(unit_price))).quantize(Decimal("0.01")),
            confidence=Decimal("1.0"),
            needs_review=False,
            previous_unit_price=Decimal(str(unit_price)),
            price_change_percent=None,
            note="",
        )
        db.session.add(line)
        db.session.flush()

        db.session.add(
            InventoryMovement(
                organization_id=organization_id,
                location_id=location_id,
                inventory_item_id=item.id,
                quantity_delta=receipt_delta,
                quantity_before=before,
                quantity_after=after,
                unit=item.stock_unit,
                source_type="invoice receipt",
                source_record_id=str(invoice.id),
                source_line_id=str(line.id),
                reason=f"Invoice {invoice_number} received",
                actor_user_id=owner.id,
            )
        )
        item.current_on_hand = after
        item.latest_purchase_price = Decimal(str(unit_price))
        item.last_purchase_unit = purchase_unit
        item.last_purchase_conversion_factor = factor
        item.last_received_at = invoice_date
        item.updated_by_user_id = owner.id
        item.updated_at = invoice_date
        db.session.commit()
        return invoice.id


def create_square_connection(app, *, organization_id: int, merchant_id: str):
    with app.app_context():
        connection = SquareConnection(
            organization_id=organization_id,
            environment="sandbox",
            square_merchant_id=merchant_id,
            status="connected",
            access_token_ciphertext="",
            refresh_token_ciphertext="",
        )
        db.session.add(connection)
        db.session.flush()
        connection.updated_at = datetime(2026, 8, 12, 23, 59, tzinfo=timezone.utc)
        db.session.commit()
        return connection.id


def create_square_location(app, *, square_connection_id: int, square_location_id: str, name: str, restaurant_location_id: int, mapped_by_user_id: int):
    with app.app_context():
        square_location = SquareLocation(
            square_connection_id=square_connection_id,
            square_location_id=square_location_id,
            name=name,
            status="active",
            raw_payload_json={},
        )
        db.session.add(square_location)
        db.session.flush()
        db.session.add(
            SquareLocationMapping(
                square_location_id=square_location.id,
                restaurant_location_id=restaurant_location_id,
                mapped_by_user_id=mapped_by_user_id,
            )
        )
        db.session.commit()
        return square_location.id


def create_square_menu_mapping(app, *, square_connection_id: int, square_object_id: str, menu_item_id: int, mapped_by_user_id: int):
    with app.app_context():
        catalog_object = SquareCatalogObject(
            square_connection_id=square_connection_id,
            square_object_id=square_object_id,
            object_type="ITEM_VARIATION",
            version=1,
            is_deleted=False,
            raw_payload_json={"name": square_object_id},
        )
        db.session.add(catalog_object)
        db.session.flush()
        db.session.add(
            SquareCatalogMapping(
                square_catalog_object_id=catalog_object.id,
                mapping_type="menu_item",
                flowtally_entity_type="menu_item",
                flowtally_entity_id=str(menu_item_id),
                status="mapped",
                mapped_by_user_id=mapped_by_user_id,
            )
        )
        db.session.commit()
        return catalog_object.id


def create_square_order(app, *, square_connection_id: int, square_location_id: str, restaurant_location_id: int, square_order_id: str, square_item_variation_id: str, name: str, quantity: float, net_amount: float, ordered_at: datetime, closed_at: datetime):
    with app.app_context():
        order = SquareOrder(
            square_connection_id=square_connection_id,
            square_order_id=square_order_id,
            square_location_id=square_location_id,
            restaurant_location_id=restaurant_location_id,
            order_state="COMPLETED",
            currency="CAD",
            gross_amount=net_amount,
            discount_amount=0,
            tax_amount=0,
            tip_amount=0,
            refund_amount=0,
            net_amount=net_amount,
            item_quantity=quantity,
            line_count=1,
            ordered_at=ordered_at,
            closed_at=closed_at,
            raw_payload_json={"id": square_order_id},
            last_synced_at=closed_at,
            is_deleted=False,
        )
        db.session.add(order)
        db.session.flush()
        db.session.add(
            SquareOrderLine(
                square_order_id=order.id,
                line_uid=f"{square_order_id}:1",
                line_index=0,
                square_item_variation_id=square_item_variation_id,
                name=name,
                quantity=quantity,
                gross_amount=net_amount,
                discount_amount=0,
                tax_amount=0,
                tip_amount=0,
                net_amount=net_amount,
                raw_payload_json={"name": name},
            )
        )
        db.session.commit()
        return order.id


def _menu_item_by_name(payload: dict, name: str) -> dict:
    return next(item for item in payload["menuItems"] if item["name"] == name)


def test_menu_item_crud_persists_and_tenant_isolation_is_enforced(app, client):
    login_owner(client)

    inventory = client.get("/api/pilot/inventory").get_json()
    item_ids = {item["name"]: item["id"] for item in inventory["items"]}

    create_response = client.post(
        "/api/pilot/menu-items",
        headers=csrf_headers(client),
        json={
            "name": "Persistence Chicken Bowl",
            "category": "Lunch bowls",
            "sellingPrice": 14.95,
            "active": True,
            "notes": "Created during the readiness pass.",
            "recipeLines": [
                {"ingredientName": "Chicken Breast", "inventoryItemId": item_ids["Chicken Breast"], "quantity": 0.16, "unit": "kg", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
                {"ingredientName": "Rice", "inventoryItemId": item_ids["Rice"], "quantity": 0.14, "unit": "kg", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
            ],
        },
    )
    assert create_response.status_code == 201
    created_snapshot = create_response.get_json()
    created_item = _menu_item_by_name(created_snapshot, "Persistence Chicken Bowl")
    assert created_item["recipe"]["lineCount"] == 2

    detail_response = client.get(f"/api/pilot/menu-items/{created_item['id']}")
    assert detail_response.status_code == 200
    assert detail_response.get_json()["name"] == "Persistence Chicken Bowl"

    update_response = client.patch(
        f"/api/pilot/menu-items/{created_item['id']}",
        headers=csrf_headers(client),
        json={
            "name": "Persistence Chicken Bowl Updated",
            "category": "Lunch bowls",
            "sellingPrice": 15.25,
            "active": False,
            "notes": "Archive after launch.",
            "recipeLines": [
                {"ingredientName": "Chicken Breast", "inventoryItemId": item_ids["Chicken Breast"], "quantity": 0.18, "unit": "kg", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
                {"ingredientName": "Rice", "inventoryItemId": item_ids["Rice"], "quantity": 0.15, "unit": "kg", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
            ],
        },
    )
    assert update_response.status_code == 200
    updated_snapshot = update_response.get_json()
    updated_item = _menu_item_by_name(updated_snapshot, "Persistence Chicken Bowl Updated")
    assert updated_item["active"] is False
    assert updated_item["recipe"]["lines"][0]["quantity"] == 0.18

    deactivate_response = client.delete(f"/api/pilot/menu-items/{created_item['id']}", headers=csrf_headers(client))
    assert deactivate_response.status_code == 200
    deactivated_item = _menu_item_by_name(deactivate_response.get_json(), "Persistence Chicken Bowl Updated")
    assert deactivated_item["active"] is False

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        other_org = make_operational_organization(owner, name=f"Tenant B {uuid4().hex[:6]}", location_name="Tenant B Kitchen")
        other_location = RestaurantLocation.query.filter_by(organization_id=other_org.id).first()
        assert other_location is not None

        other_item = InventoryItem(
            organization_id=other_org.id,
            location_id=other_location.id,
            supplier_id=None,
            name="Tenant B Beef",
            normalized_name="tenant b beef",
            category="Protein",
            stock_unit="kg",
            current_on_hand=Decimal("4.0"),
            min_quantity=Decimal("0"),
            par_level=Decimal("0"),
            preferred_supplier_name="",
            latest_purchase_price=Decimal("11.00"),
            last_purchase_unit="kg",
            last_purchase_conversion_factor=Decimal("1"),
            active=True,
            notes="",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        db.session.add(other_item)
        db.session.flush()

        other_menu_item = MenuItem(
            organization_id=other_org.id,
            location_id=other_location.id,
            name="Tenant B Burger",
            normalized_name="tenant b burger",
            category="Burgers",
            selling_price=Decimal("12.00"),
            active=True,
            notes="Tenant B recipe",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        db.session.add(other_menu_item)
        db.session.flush()
        recipe = MenuRecipe(
            organization_id=other_org.id,
            location_id=other_location.id,
            menu_item_id=other_menu_item.id,
            notes="Tenant B recipe",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        db.session.add(recipe)
        db.session.flush()
        db.session.add(
            MenuRecipeLine(
                organization_id=other_org.id,
                location_id=other_location.id,
                recipe_id=recipe.id,
                inventory_item_id=other_item.id,
                line_index=0,
                ingredient_name="Tenant B Beef",
                quantity=Decimal("0.18"),
                unit="kg",
                inventory_unit="kg",
                purchase_unit="kg",
                conversion_factor=Decimal("1"),
                notes="",
            )
        )
        db.session.commit()
        other_menu_item_id = other_menu_item.id
        other_inventory_item_id = other_item.id

    assert client.get(f"/api/pilot/menu-items/{other_menu_item_id}").status_code == 404
    assert client.patch(
        f"/api/pilot/menu-items/{other_menu_item_id}",
        headers=csrf_headers(client),
        json={"name": "Tenant B Burger Updated", "category": "Burgers", "sellingPrice": 12, "active": True, "notes": "", "recipeLines": []},
    ).status_code == 404

    invalid_recipe_response = client.post(
        "/api/pilot/menu-items",
        headers=csrf_headers(client),
        json={
            "name": "Wrong Tenant Ingredient",
            "category": "Lunch bowls",
            "sellingPrice": 11.0,
            "active": True,
            "notes": "",
            "recipeLines": [
                {"ingredientName": "Tenant B Beef", "inventoryItemId": other_inventory_item_id, "quantity": 0.1, "unit": "kg", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
            ],
        },
    )
    assert invalid_recipe_response.status_code == 400


def test_menu_costing_proves_unit_normalization_mapping_costing_and_variance_chain(app, client):
    login_owner(client)

    beef = create_inventory_item(client, name="Burger Beef", stock_unit="kg", current_on_hand=10, latest_purchase_price=11.11)
    bun = create_inventory_item(client, name="Burger Bun", stock_unit="each", current_on_hand=50, latest_purchase_price=0.50)
    sauce = create_inventory_item(client, name="Burger Sauce", stock_unit="each", current_on_hand=20, latest_purchase_price=0.25)
    pasta = create_inventory_item(client, name="Bulk Pasta", stock_unit="kg", current_on_hand=10, latest_purchase_price=4.60)
    broth = create_inventory_item(client, name="Free Soup Broth", stock_unit="each", current_on_hand=5, latest_purchase_price=0)
    weird = create_inventory_item(client, name="Mystery Greens", stock_unit="kg", current_on_hand=1, latest_purchase_price=3.00)

    burger_create = client.post(
        "/api/pilot/menu-items",
        headers=csrf_headers(client),
        json={
            "name": "Burger",
            "category": "Burgers",
            "sellingPrice": 15.00,
            "active": True,
            "notes": "",
            "recipeLines": [
                {"ingredientName": "Burger Beef", "inventoryItemId": beef["id"], "quantity": 180, "unit": "g", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
                {"ingredientName": "Burger Bun", "inventoryItemId": bun["id"], "quantity": 1, "unit": "each", "inventoryUnit": "each", "purchaseUnit": "each", "conversionFactor": 1},
                {"ingredientName": "Burger Sauce", "inventoryItemId": sauce["id"], "quantity": 1, "unit": "each", "inventoryUnit": "each", "purchaseUnit": "each", "conversionFactor": 1},
            ],
        },
    )
    assert burger_create.status_code == 201
    burger_snapshot = burger_create.get_json()
    burger = _menu_item_by_name(burger_snapshot, "Burger")

    deluxe_create = client.post(
        "/api/pilot/menu-items",
        headers=csrf_headers(client),
        json={
            "name": "Beef Deluxe",
            "category": "Burgers",
            "sellingPrice": 18.00,
            "active": True,
            "notes": "",
            "recipeLines": [
                {"ingredientName": "Burger Beef", "inventoryItemId": beef["id"], "quantity": 100, "unit": "g", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
                {"ingredientName": "Burger Bun", "inventoryItemId": bun["id"], "quantity": 1, "unit": "each", "inventoryUnit": "each", "purchaseUnit": "each", "conversionFactor": 1},
            ],
        },
    )
    assert deluxe_create.status_code == 201
    deluxe_item = _menu_item_by_name(deluxe_create.get_json(), "Beef Deluxe")

    plain_create = client.post(
        "/api/pilot/menu-items",
        headers=csrf_headers(client),
        json={
            "name": "Plain Coffee",
            "category": "Drinks",
            "sellingPrice": 3.00,
            "active": True,
            "notes": "",
        },
    )
    assert plain_create.status_code == 201

    salad_create = client.post(
        "/api/pilot/menu-items",
        headers=csrf_headers(client),
        json={
            "name": "Mystery Salad",
            "category": "Salads",
            "sellingPrice": 7.50,
            "active": True,
            "notes": "",
            "recipeLines": [
                {"ingredientName": "Mystery Greens", "inventoryItemId": weird["id"], "quantity": 1, "unit": "L", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
            ],
        },
    )
    assert salad_create.status_code == 201

    free_soup_create = client.post(
        "/api/pilot/menu-items",
        headers=csrf_headers(client),
        json={
            "name": "Free Soup",
            "category": "Soup",
            "sellingPrice": 0,
            "active": True,
            "notes": "",
            "recipeLines": [
                {"ingredientName": "Free Soup Broth", "inventoryItemId": broth["id"], "quantity": 1, "unit": "each", "inventoryUnit": "each", "purchaseUnit": "each", "conversionFactor": 1},
            ],
        },
    )
    assert free_soup_create.status_code == 201

    pasta_create = client.post(
        "/api/pilot/menu-items",
        headers=csrf_headers(client),
        json={
            "name": "Bulk Pasta",
            "category": "Pasta",
            "sellingPrice": 16.00,
            "active": True,
            "notes": "",
            "recipeLines": [
                {"ingredientName": "Bulk Pasta", "inventoryItemId": pasta["id"], "quantity": 180, "unit": "g", "inventoryUnit": "kg", "purchaseUnit": "kg", "conversionFactor": 1},
            ],
        },
    )
    assert pasta_create.status_code == 201
    pasta_item = _menu_item_by_name(pasta_create.get_json(), "Bulk Pasta")

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        organization_id = burger["organizationId"]
        location_id = burger["locationId"]

        connection_id = create_square_connection(app, organization_id=organization_id, merchant_id=f"merchant-{uuid4().hex[:8]}")
        create_square_location(
            app,
            square_connection_id=connection_id,
            square_location_id="square-location-1",
            name="Flowtally Pilot Kitchen",
            restaurant_location_id=location_id,
            mapped_by_user_id=owner.id,
        )
        create_square_menu_mapping(app, square_connection_id=connection_id, square_object_id="VAR-BURGER", menu_item_id=burger["id"], mapped_by_user_id=owner.id)
        create_square_menu_mapping(app, square_connection_id=connection_id, square_object_id="VAR-DELUXE", menu_item_id=deluxe_item["id"], mapped_by_user_id=owner.id)
        create_square_menu_mapping(app, square_connection_id=connection_id, square_object_id="VAR-PASTA", menu_item_id=pasta_item["id"], mapped_by_user_id=owner.id)

        create_square_order(
            app,
            square_connection_id=connection_id,
            square_location_id="square-location-1",
            restaurant_location_id=location_id,
            square_order_id="ORDER-BURGER-1",
            square_item_variation_id="VAR-BURGER",
            name="Burger",
            quantity=6,
            net_amount=90.0,
            ordered_at=datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc),
            closed_at=datetime(2026, 8, 11, 12, 2, tzinfo=timezone.utc),
        )
        create_square_order(
            app,
            square_connection_id=connection_id,
            square_location_id="square-location-1",
            restaurant_location_id=location_id,
            square_order_id="ORDER-BURGER-2",
            square_item_variation_id="VAR-BURGER",
            name="Burger",
            quantity=4,
            net_amount=60.0,
            ordered_at=datetime(2026, 8, 11, 13, 0, tzinfo=timezone.utc),
            closed_at=datetime(2026, 8, 11, 13, 2, tzinfo=timezone.utc),
        )
        create_square_order(
            app,
            square_connection_id=connection_id,
            square_location_id="square-location-1",
            restaurant_location_id=location_id,
            square_order_id="ORDER-PASTA-1",
            square_item_variation_id="VAR-PASTA",
            name="Bulk Pasta",
            quantity=50,
            net_amount=800.0,
            ordered_at=datetime(2026, 8, 11, 14, 0, tzinfo=timezone.utc),
            closed_at=datetime(2026, 8, 11, 14, 2, tzinfo=timezone.utc),
        )
        create_square_order(
            app,
            square_connection_id=connection_id,
            square_location_id="square-location-1",
            restaurant_location_id=location_id,
            square_order_id="ORDER-DELUXE-1",
            square_item_variation_id="VAR-DELUXE",
            name="Beef Deluxe",
            quantity=3,
            net_amount=54.0,
            ordered_at=datetime(2026, 8, 11, 14, 30, tzinfo=timezone.utc),
            closed_at=datetime(2026, 8, 11, 14, 32, tzinfo=timezone.utc),
        )
        create_square_order(
            app,
            square_connection_id=connection_id,
            square_location_id="square-location-1",
            restaurant_location_id=location_id,
            square_order_id="ORDER-UNMAPPED-1",
            square_item_variation_id="VAR-FRIES",
            name="Fries",
            quantity=1,
            net_amount=5.0,
            ordered_at=datetime(2026, 8, 11, 15, 0, tzinfo=timezone.utc),
            closed_at=datetime(2026, 8, 11, 15, 2, tzinfo=timezone.utc),
        )

    opening_count_id = create_count_session(
        app,
        organization_id=organization_id,
        location_id=location_id,
        counted_by="Opening cashier",
        completed_at=datetime(2026, 7, 10, 8, 0, tzinfo=timezone.utc),
        counts=[
            (beef["id"], 10),
            (bun["id"], 50),
            (sauce["id"], 20),
            (pasta["id"], 10),
            (broth["id"], 5),
            (weird["id"], 1),
        ],
    )
    assert opening_count_id is not None

    receipt_id = create_completed_receipt(
        app,
        organization_id=organization_id,
        location_id=location_id,
        inventory_item_id=pasta["id"],
        supplier_name="Harbour Dry Goods",
        invoice_number="PASTA-RECEIPT-1",
        invoice_date=datetime(2026, 8, 10, 9, 0, tzinfo=timezone.utc),
        quantity=5,
        unit_price=4.60,
        purchase_unit="kg",
        inventory_unit="kg",
        conversion_factor=1,
    )
    assert receipt_id is not None

    closing_count_id = create_count_session(
        app,
        organization_id=organization_id,
        location_id=location_id,
        counted_by="Closing cashier",
        completed_at=datetime(2026, 8, 11, 22, 0, tzinfo=timezone.utc),
        counts=[
            (beef["id"], 5.5),
            (bun["id"], 40),
            (sauce["id"], 18),
            (pasta["id"], 5.5),
            (broth["id"], 5),
            (weird["id"], 1),
        ],
    )
    assert closing_count_id is not None

    costing = client.get("/api/pilot/menu-costing?lookbackDays=30")
    assert costing.status_code == 200
    body = costing.get_json()

    assert body["summary"]["menuItemCount"] >= 6
    assert body["summary"]["mappedMenuItemCount"] >= 2
    assert body["summary"]["unmappedSalesCount"] == 1
    assert body["summary"]["receivedPurchasesCount"] >= 1
    assert body["openingCountSession"]["id"] == opening_count_id

    burger_item = _menu_item_by_name(body, "Burger")
    assert burger_item["salesUnits"] == 10
    assert burger_item["recipeCost"] == 2.75
    assert burger_item["grossProfit"] == 12.25
    assert burger_item["foodCostPercent"] == pytest.approx(18.3, rel=1e-3)
    assert burger_item["marginPercent"] == pytest.approx(81.7, rel=1e-3)
    assert burger_item["costingComplete"] is True
    assert burger_item["usageComplete"] is True

    plain_item = _menu_item_by_name(body, "Plain Coffee")
    assert plain_item["costingComplete"] is False
    assert "Recipe missing" in plain_item["dataIssues"]

    salad_item = _menu_item_by_name(body, "Mystery Salad")
    assert salad_item["costingComplete"] is False
    assert any("Incompatible units" in issue for issue in salad_item["dataIssues"])

    free_soup_item = _menu_item_by_name(body, "Free Soup")
    assert free_soup_item["recipeCost"] is None
    assert free_soup_item["foodCostPercent"] is None
    assert free_soup_item["costingComplete"] is False

    beef_usage = next(row for row in body["inventoryUsage"] if row["inventoryItemName"] == "Burger Beef")
    bun_usage = next(row for row in body["inventoryUsage"] if row["inventoryItemName"] == "Burger Bun")
    sauce_usage = next(row for row in body["inventoryUsage"] if row["inventoryItemName"] == "Burger Sauce")
    pasta_usage = next(row for row in body["inventoryUsage"] if row["inventoryItemName"] == "Bulk Pasta")

    assert beef_usage["theoreticalUsage"] == pytest.approx(2.1, rel=1e-6)
    assert bun_usage["theoreticalUsage"] == pytest.approx(13, rel=1e-6)
    assert sauce_usage["theoreticalUsage"] == pytest.approx(10, rel=1e-6)
    assert pasta_usage["theoreticalUsage"] == pytest.approx(9, rel=1e-6)
    assert pasta_usage["expectedInventory"] == pytest.approx(6, rel=1e-6)
    assert pasta_usage["actualStockCount"] == pytest.approx(5.5, rel=1e-6)
    assert pasta_usage["variance"] == pytest.approx(-0.5, rel=1e-6)
    assert pasta_usage["estimatedCostVariance"] == pytest.approx(-2.3, rel=1e-3)
