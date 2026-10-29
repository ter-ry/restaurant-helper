from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from backend.clover_orders import normalize_order
from backend.extensions import db
from backend.models import CloverConnection, CloverLocationMapping, CloverMenuMapping, CloverShadowOrder, CloverShadowOrderLine, InventoryItem, InventoryMovement, MenuItem, Recipe, RecipeIngredient, RestaurantLocation, User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization


def _login(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
        headers={"X-CSRFToken": csrf},
    )
    if response.status_code != 200:
        # The shared seed password is the authoritative fixture; keep the
        # assertion useful if the seed changes.
        assert response.status_code == 200


def _order():
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    return normalize_order({
        "id": "clover-order-1",
        "state": "CLOSED",
        "paymentState": "PAID",
        "total": 1800,
        "payments": {"elements": [{"id": "payment-1", "amount": 1800}], "total": 1},
        "refunds": {"elements": [], "total": 0},
        "lineItems": {"elements": [{
            "id": "line-1",
            "name": "Test Burger",
            "quantity": 1,
            "price": 1800,
            "item": {"id": "TE0BYZH7B28AJ", "name": "Test Burger"},
            "modifications": {"elements": [], "total": 0},
        }], "total": 1},
        "createdTime": now_ms,
        "modifiedTime": now_ms,
    })


def test_shadow_order_endpoint_is_idempotent_and_non_mutating(app, client, monkeypatch):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        organization = make_operational_organization(owner, name="Shadow Orders Org", location_name="Main")
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        app.config.update(
            CLOVER_ENABLED=True,
            CLOVER_ORDER_SHADOW_ENABLED=True,
            CLOVER_ENVIRONMENT="sandbox",
            CLOVER_ALLOWED_ORGANIZATION_IDS=[organization.id],
            CLOVER_CLIENT_ID="client",
            CLOVER_CLIENT_SECRET="secret",
            CLOVER_MAPPING_ENABLED=True,
        )
        connection = CloverConnection(
            organization_id=organization.id,
            environment="sandbox",
            merchant_id="merchant-1",
            merchant_name="Sandbox Cafe",
            status="connected",
            access_token_ciphertext="encrypted",
        )
        db.session.add(connection)
        db.session.flush()
        db.session.add(CloverLocationMapping(
            clover_connection_id=connection.id,
            organization_id=organization.id,
            restaurant_location_id=location.id,
            clover_merchant_id="merchant-1",
            clover_location_id=None,
            confirmed_by_user_id=owner.id,
        ))
        inventory_item = InventoryItem(
            organization_id=organization.id,
            location_id=location.id,
            name="Lettuce",
            normalized_name="lettuce",
            stock_unit="head",
            current_on_hand=Decimal("8"),
        )
        recipe = Recipe(
            organization_id=organization.id,
            location_id=location.id,
            name="Burger recipe",
            normalized_name="burger recipe",
            yield_quantity=Decimal("1"),
            yield_unit="serving",
            active=True,
        )
        menu_item = MenuItem(
            organization_id=organization.id,
            location_id=location.id,
            recipe=recipe,
            name="Harbour Burger",
            normalized_name="harbour burger",
            selling_price=Decimal("18"),
        )
        db.session.add_all([inventory_item, recipe, menu_item])
        db.session.flush()
        db.session.add(RecipeIngredient(
            organization_id=organization.id,
            recipe_id=recipe.id,
            inventory_item_id=inventory_item.id,
            quantity_required=Decimal("0.5"),
            unit="head",
        ))
        db.session.add(CloverMenuMapping(
            clover_connection_id=connection.id,
            organization_id=organization.id,
            restaurant_location_id=location.id,
            clover_merchant_id="merchant-1",
            clover_item_id="TE0BYZH7B28AJ",
            flowtally_menu_item_id=menu_item.id,
            mapped_by_user_id=owner.id,
        ))
        db.session.commit()
        monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", lambda _: "token")
        monkeypatch.setattr("backend.clover_integration.CloverOrderClient.fetch_orders", lambda *args, **kwargs: ([_order()], True))
        _login(client)
        csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
        payload = {"organizationId": organization.id, "locationId": location.id, "startDate": "2026-10-20T00:00:00Z", "endDate": "2026-10-30T00:00:00Z"}
        first = client.post("/api/integrations/clover/shadow-orders/fetch", json=payload, headers={"X-CSRFToken": csrf})
        assert first.status_code == 200
        first_order = CloverShadowOrder.query.filter_by(organization_id=organization.id).one()
        first_line = CloverShadowOrderLine.query.filter_by(shadow_order_id=first_order.id).one()
        order_json = first.get_json()["orders"][0]
        assert order_json["potentiallyEligible"] is True
        assert order_json["lines"][0]["mappingStatus"] == "mapped"
        assert order_json["lines"][0]["recipePreview"]["ingredients"][0]["quantity"] == "0.5000"
        assert order_json["lines"][0]["recipePreview"]["ingredients"][0]["unit"] == "head"
        assert InventoryMovement.query.filter_by(organization_id=organization.id).count() == 0
        second = client.post("/api/integrations/clover/shadow-orders/fetch", json=payload, headers={"X-CSRFToken": csrf})
        assert second.status_code == 200
        second_order = CloverShadowOrder.query.filter_by(organization_id=organization.id).one()
        second_line = CloverShadowOrderLine.query.filter_by(shadow_order_id=second_order.id).one()
        assert second_order.id == first_order.id
        assert second_line.id == first_line.id
        assert second_line.quantity == first_line.quantity
        assert db.session.query(CloverShadowOrder).filter_by(organization_id=organization.id).count() == 1
        assert InventoryMovement.query.filter_by(organization_id=organization.id).count() == 0
