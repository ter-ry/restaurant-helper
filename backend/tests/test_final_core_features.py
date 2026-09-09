from __future__ import annotations

from decimal import Decimal

from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement, InventoryWasteEvent, MenuItem, SquareCatalogMapping, SquareCatalogObject, SquareConnection, User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization


def csrf_headers(client):
    return {"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]}


def login(client):
    response = client.post("/api/auth/login", json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD}, headers=csrf_headers(client))
    assert response.status_code == 200


def select_org(client, organization_id):
    assert client.post("/api/organizations/select", json={"organizationId": organization_id}, headers=csrf_headers(client)).status_code == 200


def test_square_variation_import_is_idempotent_and_recipe_optional(app, client):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Square import", location_name="Kitchen", enabled_modules=("INVENTORY", "MENU_COSTING", "SQUARE_INTEGRATION"))
    location = organization.locations[0]
    select_org(client, organization.id)
    with app.app_context():
        connection = SquareConnection(organization_id=organization.id, status="connected", environment="sandbox")
        db.session.add(connection)
        db.session.flush()
        item = SquareCatalogObject(square_connection_id=connection.id, square_object_id="item-latte", object_type="ITEM", raw_payload_json={"item_data": {"name": "Latte"}})
        variation = SquareCatalogObject(square_connection_id=connection.id, square_object_id="var-latte-small", object_type="ITEM_VARIATION", raw_payload_json={"item_variation_data": {"item_id": "item-latte", "name": "Small", "price_money": {"amount": 450}}})
        db.session.add_all([item, variation])
        db.session.flush()
        db.session.add(SquareCatalogMapping(square_catalog_object_id=variation.id, mapping_type="menu_item", status="review_required"))
        db.session.commit()

    payload = {"organizationId": organization.id, "locationId": location.id}
    response = client.post("/api/integrations/square/catalog/menu-import", json=payload, headers=csrf_headers(client))
    assert response.status_code == 200
    assert response.get_json()["result"]["new"] == 1
    response = client.post("/api/integrations/square/catalog/menu-import", json=payload, headers=csrf_headers(client))
    assert response.status_code == 200
    with app.app_context():
        menu_item = MenuItem.query.filter_by(organization_id=organization.id, location_id=location.id).one()
        mapping = SquareCatalogMapping.query.one()
        assert menu_item.name == "Latte · Small"
        assert menu_item.recipe_id is None
        assert menu_item.selling_price == Decimal("4.50")
        assert mapping.flowtally_entity_id == str(menu_item.id)
        assert mapping.status == "imported_recipe_needed"
        assert MenuItem.query.count() == 1


def test_waste_event_creates_one_linked_negative_movement_and_cost_snapshot(app, client):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Waste cafe", location_name="Kitchen", enabled_modules=("INVENTORY",))
    location = organization.locations[0]
    select_org(client, organization.id)
    with app.app_context():
        item = InventoryItem(organization_id=organization.id, location_id=location.id, name="Milk", normalized_name="milk", stock_unit="litre", current_on_hand=Decimal("10"), average_unit_cost=Decimal("3.25"), active=True)
        db.session.add(item)
        db.session.commit()
        item_id = item.id

    response = client.post("/api/pilot/inventory/waste-events", json={"inventoryItemId": item_id, "quantity": 2, "unit": "litre", "reason": "spoilage / expired", "note": "Expired milk"}, headers=csrf_headers(client))
    assert response.status_code == 201
    body = response.get_json()
    assert body["unitCost"] == 3.25
    assert body["totalCost"] == 6.5
    with app.app_context():
        event = InventoryWasteEvent.query.one()
        movement = InventoryMovement.query.filter_by(source_type="inventory waste").one()
        item = InventoryItem.query.get(item_id)
        assert event.inventory_movement_id == movement.id
        assert movement.source_type == "inventory waste"
        assert movement.quantity_delta == Decimal("-2.0000")
        assert item.current_on_hand == Decimal("8.0000")
