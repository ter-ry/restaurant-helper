"""#183: operator-visible review state for already-applied Clover orders, through the real fetch endpoint."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from backend.clover_orders import normalize_order
from backend.extensions import db
from backend.models import (
    CloverConnection,
    CloverLocationMapping,
    CloverMenuMapping,
    CloverShadowOrder,
    CloverShadowOrderLine,
    InventoryItem,
    InventoryMovement,
    MenuItem,
    Recipe,
    RecipeIngredient,
    RestaurantLocation,
    User,
)
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_clover_shadow_orders import _login


def _payload(*, refunded=False, lines=True, forged=False):
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    line = {"id": "line-1", "name": "Test Burger", "quantity": 1, "price": 1800, "item": {"id": "TE0BYZH7B28AJ"}, "modifications": {"elements": [], "total": 0}}
    if forged:
        line["notPrepared"] = True
    data = {
        "id": "clover-order-applied", "state": "CLOSED", "paymentState": "REFUNDED" if refunded else "PAID", "total": 1800,
        "payments": {"elements": [{"id": "pay-1", "amount": 1800, "result": "SUCCESS"}], "total": 1},
        "refunds": {"elements": [{"id": "ref-1", "amount": 1800}], "total": 1} if refunded else {"elements": [], "total": 0},
        "lineItems": {"elements": [line] if lines else [], "total": 1 if lines else 0},
        "createdTime": now_ms, "modifiedTime": now_ms,
        **({"notPrepared": True} if forged else {}),
    }
    return normalize_order(data)


def _setup(app):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Applied Review Org", location_name="Main")
    location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
    app.config.update(
        CLOVER_ENABLED=True, CLOVER_ORDER_SHADOW_ENABLED=True, CLOVER_ENVIRONMENT="sandbox",
        CLOVER_ALLOWED_ORGANIZATION_IDS=[organization.id], CLOVER_CLIENT_ID="c", CLOVER_CLIENT_SECRET="s",
        CLOVER_MAPPING_ENABLED=True, CLOVER_ORDER_INVENTORY_ENABLED=True,
    )
    connection = CloverConnection(organization_id=organization.id, environment="sandbox", merchant_id="m-1", merchant_name="Cafe", status="connected", access_token_ciphertext="enc")
    db.session.add(connection)
    db.session.flush()
    db.session.add(CloverLocationMapping(clover_connection_id=connection.id, organization_id=organization.id, restaurant_location_id=location.id, clover_merchant_id="m-1", clover_location_id=None, confirmed_by_user_id=owner.id))
    item = InventoryItem(organization_id=organization.id, location_id=location.id, name="Lettuce", normalized_name="lettuce", stock_unit="head", current_on_hand=Decimal("8"))
    recipe = Recipe(organization_id=organization.id, location_id=location.id, name="Burger", normalized_name="burger", yield_quantity=Decimal("1"), yield_unit="serving", active=True)
    menu_item = MenuItem(organization_id=organization.id, location_id=location.id, recipe=recipe, name="Harbour Burger", normalized_name="harbour burger", selling_price=Decimal("18"))
    db.session.add_all([item, recipe, menu_item])
    db.session.flush()
    db.session.add(RecipeIngredient(organization_id=organization.id, recipe_id=recipe.id, inventory_item_id=item.id, quantity_required=Decimal("0.5"), unit="head"))
    db.session.add(CloverMenuMapping(clover_connection_id=connection.id, organization_id=organization.id, restaurant_location_id=location.id, clover_merchant_id="m-1", clover_item_id="TE0BYZH7B28AJ", flowtally_menu_item_id=menu_item.id, mapped_by_user_id=owner.id))
    db.session.commit()
    return organization, location, item


def test_applied_order_refund_or_removed_line_is_flagged_in_the_operator_response_and_stock_is_unchanged(app, client, monkeypatch):
    with app.app_context():
        organization, location, item = _setup(app)
        monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", lambda _: "token")
        responses = iter([
            ([_payload()], True),                           # paid -> applied
            ([_payload(refunded=True, forged=True)], True),  # full refund, forged evidence in provider JSON
            ([_payload(lines=False)], True),                # complete snapshot that removed the applied line
        ])
        monkeypatch.setattr("backend.clover_integration.CloverOrderClient.fetch_orders", lambda *a, **k: next(responses))
        _login(client)
        csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
        body = {"organizationId": organization.id, "locationId": location.id, "startDate": "2026-10-20T00:00:00Z", "endDate": "2026-10-30T00:00:00Z", "executeInventory": True}

        def fetch():
            response = client.post("/api/integrations/clover/shadow-orders/fetch", json=body, headers={"X-CSRFToken": csrf})
            assert response.status_code == 200
            db.session.expire_all()
            return response.get_json()

        applied = fetch()
        assert applied["inventoryAutomation"]["results"][0]["applied"] is True
        assert db.session.get(InventoryItem, item.id).current_on_hand == Decimal("7.5000")
        assert InventoryMovement.query.filter_by(organization_id=organization.id).count() == 1

        for step in ("refund", "removed"):
            data = fetch()
            order_json = data["orders"][0]
            results = [r for r in data["inventoryAutomation"]["results"] if r["orderId"] == order_json["cloverOrderId"]]
            assert len(results) == 1, step
            result = results[0]
            assert result["applied"] is False and result["appliedRequiresReview"] is True, step
            assert result["staleApplied"] and result["staleApplied"][0]["appliedQuantity"] == "-0.5000", step
            # Stock and ledger are untouched; nothing was restored.
            assert db.session.get(InventoryItem, item.id).current_on_hand == Decimal("7.5000"), step
            assert InventoryMovement.query.filter_by(organization_id=organization.id).count() == 1, step
            if step == "refund":
                assert result["refundKind"] == "full" and order_json["status"] == "refunded"
        # The historical line is preserved (not cascaded away) so the audit trail remains.
        line = CloverShadowOrderLine.query.filter_by(organization_id=organization.id).one()
        assert line.mapping_status == "review_required"
        assert CloverShadowOrder.query.filter_by(organization_id=organization.id).count() == 1
