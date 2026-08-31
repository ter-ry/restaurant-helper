from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from cryptography.fernet import Fernet
from sqlalchemy import text

from backend.extensions import db
from backend.models import InventoryItem, MenuItem, Organization, OrganizationMembership, Recipe, RecipeIngredient, RestaurantLocation, SquareCatalogMapping, SquareCatalogObject, SquareConnection, SquareDailySalesSummary, SquareLocation, SquareLocationMapping, SquareOrder, SquareOrderLine, SquareSyncJob, SquareWebhookEvent, StockCountSession, StockCountSessionLine, User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.square import square_notification_signature
from backend.tests.conftest import make_operational_organization


class FakeResponse:
    def __init__(self, payload: dict[str, object]):
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


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


def configure_square(app):
    with app.app_context():
        app.config.update(
            {
                "SQUARE_ENABLED": True,
                "SQUARE_ENVIRONMENT": "sandbox",
                "SQUARE_APPLICATION_ID": "square-app",
                "SQUARE_APPLICATION_SECRET": "square-secret",
                "SQUARE_REDIRECT_URI": "http://testserver/api/integrations/square/callback",
                "SQUARE_WEBHOOK_SIGNATURE_KEY": "c2lnbmF0dXJlLWtleQ==",
                "INTEGRATION_ENCRYPTION_KEY": Fernet.generate_key().decode("utf-8"),
            }
        )


def configure_square_usage(app):
    configure_square(app)


def oauth_responder():
    calls = {"locations": 0, "catalog": 0, "orders": 0, "token_requests": []}

    def handler(request_obj, timeout=30):
        url = request_obj.full_url
        if url.endswith("/oauth2/token"):
            raw_body = request_obj.data.decode("utf-8") if request_obj.data else "{}"
            token_payload = json.loads(raw_body)
            calls["token_requests"].append(token_payload)
            return FakeResponse(
                {
                    "access_token": "square-access-token",
                    "refresh_token": "square-refresh-token",
                    "merchant_id": "merchant-123",
                    "expires_at": "2027-01-01T00:00:00Z",
                }
            )
        if url.endswith("/v2/locations"):
            calls["locations"] += 1
            return FakeResponse(
                {
                    "locations": [
                        {"id": "LOC-1", "name": "Sandbox A", "status": "ACTIVE"},
                    ]
                }
            )
        if "/v2/catalog/list" in url:
            calls["catalog"] += 1
            if "cursor=page-2" in url:
                return FakeResponse(
                    {
                        "objects": [
                            {"id": "CAT-3", "type": "CATEGORY", "version": 1788210903622, "is_deleted": False},
                        ]
                    }
                )
            return FakeResponse(
                {
                        "objects": [
                            {
                                "id": "ITEM_TEST_BURGER",
                                "type": "ITEM",
                                "version": 1788210903619,
                                "is_deleted": False,
                                "item_data": {"name": "Test Burger", "variations": [{"id": "VAR_TEST_BURGER_REGULAR"}]},
                            },
                            {
                                "id": "VAR_TEST_BURGER_REGULAR",
                                "type": "ITEM_VARIATION",
                                "version": 1788210903620,
                                "is_deleted": False,
                                "item_variation_data": {"item_id": "ITEM_TEST_BURGER", "name": "Regular"},
                            },
                            {"id": "CAT-2", "type": "MODIFIER", "version": 1788210903621, "is_deleted": False},
                        ],
                    "cursor": "page-2",
                }
            )
        if "/v2/orders/search" in url:
            calls["orders"] += 1
            if calls["orders"] > 1:
                return FakeResponse(
                    {
                        "orders": [
                            {
                                "id": "order-1",
                                "location_id": "LOC-1",
                                "state": "CANCELED",
                                "created_at": "2026-08-07T10:00:00Z",
                                "closed_at": "2026-08-07T10:20:00Z",
                                "total_money": {"amount": 1500, "currency": "CAD"},
                                "discount_money": {"amount": 100, "currency": "CAD"},
                                "tax_money": {"amount": 162, "currency": "CAD"},
                                "tip_money": {"amount": 200, "currency": "CAD"},
                                "refunded_money": {"amount": 250, "currency": "CAD"},
                                "line_items": [
                                    {
                                        "uid": "line-1",
                                        "name": "Latte",
                                        "catalog_object_id": "VAR_TEST_BURGER_REGULAR",
                                        "quantity": "1",
                                        "base_price_money": {"amount": 625, "currency": "CAD"},
                                        "total_money": {"amount": 625, "currency": "CAD"},
                                    },
                                    {
                                        "uid": "line-2",
                                        "name": "Espresso",
                                        "catalog_object_id": "VAR_TEST_BURGER_REGULAR",
                                        "quantity": "2",
                                        "base_price_money": {"amount": 437, "currency": "CAD"},
                                        "total_money": {"amount": 875, "currency": "CAD"},
                                    },
                                ],
                            }
                        ]
                    }
                )
            return FakeResponse(
                {
                    "orders": [
                        {
                            "id": "order-1",
                            "location_id": "LOC-1",
                            "state": "COMPLETED",
                            "created_at": "2026-08-07T10:00:00Z",
                            "closed_at": "2026-08-07T10:10:00Z",
                            "total_money": {"amount": 1250, "currency": "CAD"},
                            "discount_money": {"amount": 100, "currency": "CAD"},
                            "tax_money": {"amount": 162, "currency": "CAD"},
                            "tip_money": {"amount": 200, "currency": "CAD"},
                            "refunded_money": {"amount": 0, "currency": "CAD"},
                            "line_items": [
                                {
                                    "uid": "line-1",
                                    "name": "Latte",
                                    "catalog_object_id": "VAR_TEST_BURGER_REGULAR",
                                    "quantity": "2",
                                    "base_price_money": {"amount": 625, "currency": "CAD"},
                                    "total_money": {"amount": 1250, "currency": "CAD"},
                                }
                            ],
                        }
                    ]
                }
            )
        raise AssertionError(f"Unexpected Square request: {url}")

    handler.calls = calls
    return handler


def connect_square(client, monkeypatch, app, organization_id: int):
    configure_square(app)
    fake_urlopen = oauth_responder()
    monkeypatch.setattr("backend.square_integration.urlopen", fake_urlopen)

    start_response = client.get(f"/api/integrations/square/start?organizationId={organization_id}")
    assert start_response.status_code == 302
    assert "connect.square" in start_response.headers["Location"]
    with client.session_transaction() as session:
        context = session["square_oauth_context"]
    callback_response = client.get(
        "/api/integrations/square/callback",
        query_string={"state": context["state"], "code": "auth-code"},
    )
    assert callback_response.status_code == 302
    expected_frontend_origin = str(app.config["FLOWTALLY_FRONTEND_ORIGIN"]).rstrip("/")
    assert callback_response.headers["Location"] == f"{expected_frontend_origin}/app/square?organizationId={organization_id}&connected=1"
    assert "access_token" not in callback_response.headers["Location"]
    assert "refresh_token" not in callback_response.headers["Location"]
    return fake_urlopen


def test_square_oauth_callback_rejects_invalid_state(app, client, monkeypatch):
    login(client)
    organization = make_operational_organization(
        User.query.filter_by(email=LOCAL_OWNER_EMAIL).first(),
        name=f"Square Org {uuid4().hex[:6]}",
        location_name="Main Kitchen",
    )
    select_org = client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization.id})
    assert select_org.status_code == 200

    configure_square(app)
    fake_urlopen = oauth_responder()
    monkeypatch.setattr("backend.square_integration.urlopen", fake_urlopen)

    start_response = client.get(f"/api/integrations/square/start?organizationId={organization.id}")
    assert start_response.status_code == 302
    with client.session_transaction() as session:
        context = session["square_oauth_context"]

    callback_response = client.get(
        "/api/integrations/square/callback",
        query_string={"state": f'{context["state"]}-wrong', "code": "auth-code"},
    )
    assert callback_response.status_code == 400
    assert callback_response.get_json()["error"] == "Square state validation failed."
    assert fake_urlopen.calls["locations"] == 0
    assert fake_urlopen.calls["catalog"] == 0
    assert fake_urlopen.calls["orders"] == 0
    assert fake_urlopen.calls["token_requests"] == []


def _create_square_usage_fixture(app, owner: User, *, organization_name: str):
    organization = make_operational_organization(
        owner,
        name=organization_name,
        location_name="Main Kitchen",
        enabled_modules=("PURCHASES", "INVENTORY", "REPORTING", "STOCK_COUNTS", "REORDER_PLANS", "MENU_COSTING", "SQUARE_INTEGRATION"),
    )
    location = organization.locations[0]

    with app.app_context():
        square_connection = SquareConnection(
            organization_id=organization.id,
            environment="sandbox",
            square_merchant_id="merchant-usage",
            status="connected",
            sync_status="idle",
        )
        db.session.add(square_connection)
        db.session.flush()

        square_location = SquareLocation(
            square_connection_id=square_connection.id,
            square_location_id="LOC-1",
            name="Front Bar",
            status="active",
            raw_payload_json={"id": "LOC-1", "name": "Front Bar"},
        )
        db.session.add(square_location)
        db.session.flush()
        db.session.add(
            SquareLocationMapping(
                square_location_id=square_location.id,
                restaurant_location_id=location.id,
                mapped_by_user_id=owner.id,
            )
        )

        recipe = Recipe(
            organization_id=organization.id,
            location_id=location.id,
            name="Classic Cheeseburger",
            normalized_name="classic cheeseburger",
            yield_quantity=Decimal("1"),
            yield_unit="servings",
            active=True,
        )
        db.session.add(recipe)
        db.session.flush()

        inventory_item = InventoryItem(
            organization_id=organization.id,
            location_id=location.id,
            name="Beef",
            normalized_name="beef",
            category="Meat",
            stock_unit="kg",
            current_on_hand=Decimal("20"),
            min_quantity=Decimal("0"),
            par_level=Decimal("0"),
            preferred_supplier_name="",
            latest_purchase_price=Decimal("0"),
            last_purchase_unit="kg",
            last_purchase_conversion_factor=Decimal("1"),
            average_daily_usage=Decimal("0"),
            active=True,
            notes="",
        )
        db.session.add(inventory_item)
        db.session.flush()
        db.session.add(
            RecipeIngredient(
                organization_id=organization.id,
                recipe_id=recipe.id,
                inventory_item_id=inventory_item.id,
                quantity_required=Decimal("0.18"),
                unit="kg",
                notes="",
                sort_order=0,
            )
        )

        menu_item = MenuItem(
            organization_id=organization.id,
            location_id=location.id,
            recipe_id=recipe.id,
            name="Classic Cheeseburger",
            normalized_name="classic cheeseburger",
            category="Burgers",
            selling_price=Decimal("18"),
            active=True,
            notes="",
        )
        db.session.add(menu_item)
        db.session.flush()

        square_catalog_object = SquareCatalogObject(
            square_connection_id=square_connection.id,
            square_object_id="VAR-1",
            object_type="ITEM_VARIATION",
            version=1,
            is_deleted=False,
            raw_payload_json={"id": "VAR-1", "type": "ITEM_VARIATION"},
        )
        db.session.add(square_catalog_object)
        db.session.flush()
        db.session.add(
            SquareCatalogMapping(
                square_catalog_object_id=square_catalog_object.id,
                mapping_type="menu_item",
                flowtally_entity_type="menu_item",
                flowtally_entity_id=str(menu_item.id),
                status="mapped",
                mapped_by_user_id=owner.id,
            )
        )

        order = SquareOrder(
            square_connection_id=square_connection.id,
            square_order_id="ORDER-1",
            square_location_id="LOC-1",
            restaurant_location_id=location.id,
            order_state="COMPLETED",
            currency="CAD",
            gross_amount=Decimal("12.50"),
            discount_amount=Decimal("0"),
            tax_amount=Decimal("1.63"),
            tip_amount=Decimal("2.00"),
            refund_amount=Decimal("0"),
            net_amount=Decimal("12.50"),
            item_quantity=Decimal("10"),
            line_count=1,
            ordered_at=datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc),
            closed_at=datetime(2026, 8, 8, 12, 15, tzinfo=timezone.utc),
            raw_payload_json={"id": "ORDER-1"},
        )
        db.session.add(order)
        db.session.flush()
        db.session.add(
            SquareOrderLine(
                order=order,
                line_uid="line-1",
                line_index=0,
                square_item_variation_id="VAR-1",
                name="Classic Cheeseburger",
                quantity=Decimal("10"),
                gross_amount=Decimal("12.50"),
                discount_amount=Decimal("0"),
                tax_amount=Decimal("1.63"),
                tip_amount=Decimal("2.00"),
                net_amount=Decimal("12.50"),
                raw_payload_json={"uid": "line-1"},
            )
        )

        opening_session = StockCountSession(
            organization_id=organization.id,
            location_id=location.id,
            status="Completed",
            started_at=datetime(2026, 8, 4, 9, 0, tzinfo=timezone.utc),
            completed_at=datetime(2026, 8, 4, 9, 30, tzinfo=timezone.utc),
            counted_by="Owner",
            notes="",
            item_count=1,
        )
        closing_session = StockCountSession(
            organization_id=organization.id,
            location_id=location.id,
            status="Completed",
            started_at=datetime(2026, 8, 11, 9, 0, tzinfo=timezone.utc),
            completed_at=datetime(2026, 8, 11, 9, 30, tzinfo=timezone.utc),
            counted_by="Owner",
            notes="",
            item_count=1,
        )
        db.session.add_all([opening_session, closing_session])
        db.session.flush()
        db.session.add(
            StockCountSessionLine(
                session_id=opening_session.id,
                inventory_item_id=inventory_item.id,
                line_index=0,
                item_name_snapshot="Beef",
                stock_unit_snapshot="kg",
                expected_quantity=Decimal("0"),
                counted_quantity=Decimal("21.6"),
                variance=Decimal("0"),
                resulting_quantity=Decimal("21.6"),
                note="",
                status="completed",
            )
        )
        db.session.add(
            StockCountSessionLine(
                session_id=closing_session.id,
                inventory_item_id=inventory_item.id,
                line_index=0,
                item_name_snapshot="Beef",
                stock_unit_snapshot="kg",
                expected_quantity=Decimal("0"),
                counted_quantity=Decimal("19.5"),
                variance=Decimal("0"),
                resulting_quantity=Decimal("19.5"),
                note="",
                status="completed",
            )
        )
        db.session.commit()

    return organization, location


def test_square_oauth_connection_catalog_and_status(app, client, monkeypatch):
    login(client)
    organization = make_operational_organization(
        User.query.filter_by(email=LOCAL_OWNER_EMAIL).first(),
        name=f"Square Org {uuid4().hex[:6]}",
        location_name="Main Kitchen",
    )
    select_org = client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization.id})
    assert select_org.status_code == 200

    with app.app_context():
        app.config["FLOWTALLY_FRONTEND_ORIGIN"] = "https://frontend.example.test"

    fake_urlopen = connect_square(client, monkeypatch, app, organization.id)
    assert fake_urlopen.calls["locations"] == 1
    assert fake_urlopen.calls["catalog"] == 2
    assert fake_urlopen.calls["token_requests"][0] == {
        "client_id": "square-app",
        "client_secret": "square-secret",
        "code": "auth-code",
        "grant_type": "authorization_code",
        "redirect_uri": app.config["SQUARE_REDIRECT_URI"],
    }

    status_response = client.get(f"/api/integrations/square/status?organizationId={organization.id}")
    assert status_response.status_code == 200
    connection = status_response.get_json()["connection"]
    assert connection["status"] == "connected"
    assert connection["squareMerchantId"] == "merchant-123"
    assert connection["catalogCount"] >= 2
    assert connection["locationCount"] == 1
    assert "accessToken" not in connection
    assert "refreshToken" not in connection
    assert "access_token" not in connection
    assert "refresh_token" not in connection

    disconnect_response = client.post("/api/integrations/square/disconnect", headers=csrf_headers(client), json={"organizationId": organization.id})
    assert disconnect_response.status_code == 200
    disconnected = disconnect_response.get_json()["connection"]
    assert disconnected["status"] == "disconnected"
    assert disconnected["revokedAt"] is not None

    with app.app_context():
        square_connection = SquareConnection.query.filter_by(organization_id=organization.id).first()
        assert square_connection is not None
        assert square_connection.access_token_ciphertext != "square-access-token"
        assert square_connection.refresh_token_ciphertext != "square-refresh-token"


def test_square_oauth_refresh_token_grant_does_not_require_redirect_uri(app, monkeypatch):
    configure_square(app)
    from backend.square import encrypt_square_secret
    from backend.square_integration import SquareConnection as SquareConnectionModel, _refresh_token

    fake_urlopen = oauth_responder()
    monkeypatch.setattr("backend.square_integration.urlopen", fake_urlopen)

    with app.app_context():
        connection = SquareConnectionModel(
            organization_id=1,
            environment="sandbox",
            square_merchant_id="merchant-123",
            status="connected",
            access_token_ciphertext=encrypt_square_secret("square-access-token"),
            refresh_token_ciphertext=encrypt_square_secret("square-refresh-token"),
        )
        token_payload = _refresh_token(connection)

    assert token_payload["access_token"] == "square-access-token"
    assert fake_urlopen.calls["token_requests"][0] == {
        "client_id": "square-app",
        "client_secret": "square-secret",
        "refresh_token": "square-refresh-token",
        "grant_type": "refresh_token",
    }


def test_square_location_mapping_catalog_pagination_and_orders(app, client, monkeypatch):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    assert owner is not None
    organization = make_operational_organization(
        owner,
        name=f"Square Orders {uuid4().hex[:6]}",
        location_name="Main Kitchen",
        enabled_modules=("PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS", "MENU_COSTING", "SQUARE_INTEGRATION"),
    )
    client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization.id})

    fake_urlopen = connect_square(client, monkeypatch, app, organization.id)

    status_response = client.get(f"/api/integrations/square/status?organizationId={organization.id}")
    connection = status_response.get_json()["connection"]
    square_location_row_id = connection["locations"][0]["id"]
    with app.app_context():
        square_connection = SquareConnection.query.filter_by(organization_id=organization.id).first()
        assert square_connection is not None
        restaurant_location_id = RestaurantLocation.query.filter_by(organization_id=organization.id).first().id

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

    catalog_sync = client.post("/api/integrations/square/catalog/sync", headers=csrf_headers(client), json={"organizationId": organization.id})
    assert catalog_sync.status_code == 200
    assert fake_urlopen.calls["catalog"] == 4
    with app.app_context():
        large_catalog_object = SquareCatalogObject.query.filter_by(square_object_id="VAR_TEST_BURGER_REGULAR").one()
        assert large_catalog_object.version == 1788210903620

    mapping_summary = client.get(f"/api/integrations/square/catalog/mappings?organizationId={organization.id}")
    assert mapping_summary.status_code == 200
    mapping_payload = mapping_summary.get_json()
    assert [row["squareObjectId"] for row in mapping_payload["mappings"]] == ["VAR_TEST_BURGER_REGULAR"]
    assert mapping_payload["mappings"][0]["squareObjectName"] == "Test Burger · Regular"
    assert mapping_payload["mappings"][0]["squareItemName"] == "Test Burger"
    assert mapping_payload["mappingCoverage"]["totalVariationCount"] == 1

    orders_sync = client.post(
        "/api/integrations/square/orders/sync",
        headers=csrf_headers(client),
        json={
            "organizationId": organization.id,
            "startAt": "2026-08-07T00:00:00Z",
            "endAt": "2026-08-08T00:00:00Z",
        },
    )
    assert orders_sync.status_code == 200

    with app.app_context():
        assert SquareOrder.query.filter_by(square_connection_id=square_connection.id).count() == 1
        assert SquareDailySalesSummary.query.filter_by(square_connection_id=square_connection.id).count() == 1

    repeated_orders_sync = client.post(
        "/api/integrations/square/orders/sync",
        headers=csrf_headers(client),
        json={
            "organizationId": organization.id,
            "startAt": "2026-08-07T00:00:00Z",
            "endAt": "2026-08-08T00:00:00Z",
        },
    )
    assert repeated_orders_sync.status_code == 200

    with app.app_context():
        order = SquareOrder.query.filter_by(square_connection_id=square_connection.id, square_order_id="order-1").first()
        assert order is not None
        assert order.order_state == "CANCELED"
        assert order.line_count == 2
        assert SquareOrder.query.filter_by(square_connection_id=square_connection.id).count() == 1
        assert SquareOrderLine.query.filter_by(square_order_id=order.id).count() == 2
        summary = SquareDailySalesSummary.query.filter_by(square_connection_id=square_connection.id).first()
        assert summary is not None
        assert summary.cancelled_order_count == 1
        assert float(summary.refund_amount) == 2.5


def test_square_catalog_sync_rolls_back_failed_transaction_before_recording_error(app, client, monkeypatch):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    assert owner is not None
    organization = make_operational_organization(owner, name=f"Square Catalog Error {uuid4().hex[:6]}", location_name="Main Kitchen")
    client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization.id})
    connect_square(client, monkeypatch, app, organization.id)

    def fail_after_database_error(connection, token):
        db.session.execute(text("select * from missing_square_catalog_table"))
        raise AssertionError("the invalid query should fail first")

    monkeypatch.setattr("backend.square_integration._sync_catalog", fail_after_database_error)
    response = client.post(
        "/api/integrations/square/catalog/sync",
        headers=csrf_headers(client),
        json={"organizationId": organization.id},
    )
    assert response.status_code == 400
    assert "Square catalog sync failed" in response.get_json()["error"]
    with app.app_context():
        connection = SquareConnection.query.filter_by(organization_id=organization.id).one()
        assert connection.sync_status == "error"
        assert "missing_square_catalog_table" in connection.sync_error
        assert SquareSyncJob.query.filter_by(square_connection_id=connection.id, job_type="catalog", status="failed").count() == 1

    monkeypatch.setattr("backend.square_integration._sync_catalog", lambda connection, token: {"objectCount": 0, "pages": 1, "squareObjectIds": []})
    successful_sync = client.post(
        "/api/integrations/square/catalog/sync",
        headers=csrf_headers(client),
        json={"organizationId": organization.id},
    )
    assert successful_sync.status_code == 200
    with app.app_context():
        connection = SquareConnection.query.filter_by(organization_id=organization.id).one()
        assert connection.sync_status == "idle"
        assert connection.sync_error == ""
        assert SquareSyncJob.query.filter_by(square_connection_id=connection.id, job_type="catalog", status="failed").count() == 1


def test_square_webhook_signature_validation_and_idempotency(app, client, monkeypatch):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    assert owner is not None
    organization = make_operational_organization(owner, name=f"Square Webhook {uuid4().hex[:6]}", location_name="Main Kitchen")
    client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization.id})
    connect_square(client, monkeypatch, app, organization.id)

    body = {
        "merchant_id": "merchant-123",
        "event_id": "event-1",
        "type": "order.updated",
        "data": {
            "order": {
                "id": "order-webhook-1",
                "location_id": "LOC-1",
                "state": "COMPLETED",
                "created_at": "2026-08-07T10:00:00Z",
                "closed_at": "2026-08-07T10:15:00Z",
                "total_money": {"amount": 1500, "currency": "CAD"},
                "line_items": [],
            }
        },
    }
    body_bytes = json.dumps(body).encode("utf-8")
    signature = square_notification_signature(body_bytes, "http://localhost/api/integrations/square/webhooks", "c2lnbmF0dXJlLWtleQ==")
    response = client.post(
        "/api/integrations/square/webhooks",
        data=body_bytes,
        headers={
            "Content-Type": "application/json",
            "x-square-hmacsha256-signature": signature,
        },
    )
    assert response.status_code == 200

    duplicate = client.post(
        "/api/integrations/square/webhooks",
        data=body_bytes,
        headers={
            "Content-Type": "application/json",
            "x-square-hmacsha256-signature": signature,
        },
    )
    assert duplicate.status_code == 200
    assert duplicate.get_json()["duplicate"] is True

    invalid = client.post(
        "/api/integrations/square/webhooks",
        data=body_bytes,
        headers={
            "Content-Type": "application/json",
            "x-square-hmacsha256-signature": "invalid",
        },
    )
    assert invalid.status_code == 403

    with app.app_context():
        square_connection = SquareConnection.query.filter_by(organization_id=organization.id).first()
        assert square_connection is not None
        assert SquareWebhookEvent.query.filter_by(square_connection_id=square_connection.id).count() == 1
        assert SquareOrder.query.filter_by(square_connection_id=square_connection.id).count() == 1


def test_square_owner_requires_active_organization(app, client, monkeypatch):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    assert owner is not None
    organization = Organization(
        name=f"Square Prospect {uuid4().hex[:6]}",
        lifecycle_status="ONBOARDING",
        setup_status="INTAKE",
        subscription_status="NONE",
        setup_template_key="CAFE",
        setup_fee_status="NONE",
        is_prospect=True,
    )
    db.session.add(organization)
    db.session.flush()
    db.session.add(OrganizationMembership(user=owner, organization=organization, role="owner"))
    db.session.commit()

    client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization.id})
    configure_square(app)
    start_response = client.get(f"/api/integrations/square/start?organizationId={organization.id}")
    assert start_response.status_code == 403


def test_square_usage_report_calculates_theoretical_and_actual_usage(app, client, monkeypatch):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    assert owner is not None
    organization, location = _create_square_usage_fixture(app, owner, organization_name=f"Square Usage {uuid4().hex[:6]}")
    client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization.id})
    configure_square_usage(app)

    with app.app_context():
        seeded_orders = SquareOrder.query.filter_by(square_connection_id=SquareConnection.query.filter_by(organization_id=organization.id).first().id).all()
        for order in seeded_orders:
            _ = list(order.lines)

    class _FakeQuery:
        def __init__(self, rows):
            self._rows = rows

        def filter_by(self, *args, **kwargs):
            return self

        def filter(self, *args, **kwargs):
            return self

        def order_by(self, *args, **kwargs):
            return self

        def limit(self, *args, **kwargs):
            return self

        def count(self):
            return len(self._rows)

        def all(self):
            return self._rows

    monkeypatch.setattr("backend.square_integration.SquareOrder.query", _FakeQuery(seeded_orders))
    monkeypatch.setattr(
        "backend.square_integration._inventory_usage_basis",
        lambda *args, **kwargs: {
            "available": True,
            "warnings": [],
            "openingQuantity": 21.6,
            "openingCountSessionId": 1,
            "openingCountCompletedAt": "2026-08-04T09:30:00Z",
            "closingQuantity": 19.5,
            "closingCountSessionId": 2,
            "closingCountCompletedAt": "2026-08-11T09:30:00Z",
            "movementNet": 0,
            "actualUsage": 2.1,
        },
    )

    response = client.get(
        "/api/integrations/square/usage",
        query_string={
            "organizationId": organization.id,
            "locationId": location.id,
            "startAt": "2026-08-04T00:00:00Z",
            "endAt": "2026-08-11T23:59:59Z",
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["mappingCoverage"] == {"mappedVariationCount": 1, "totalVariationCount": 1, "mappedPercent": 100}
    assert payload["usage"]["coverage"]["mappedSalesCoveragePercent"] == 100
    assert payload["usage"]["coverage"]["calculableSalesCoveragePercent"] == 100
    assert payload["usage"]["totals"]["theoreticalUsage"] == 1.8
    assert payload["usage"]["totals"]["actualUsage"] == 2.1
    assert payload["usage"]["totals"]["discrepancy"] == 0.3
    assert payload["usage"]["ingredientUsage"][0]["inventoryItemName"] == "Beef"
    assert payload["usage"]["ingredientUsage"][0]["actualUsageBasis"]["available"] is True


def test_square_catalog_mapping_rejects_non_variation_catalog_objects(app, client):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    assert owner is not None
    organization, _ = _create_square_usage_fixture(app, owner, organization_name=f"Square Mapping {uuid4().hex[:6]}")
    client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization.id})
    configure_square_usage(app)

    with app.app_context():
        connection = SquareConnection.query.filter_by(organization_id=organization.id).first()
        assert connection is not None
        bad_object = SquareCatalogObject(
            square_connection_id=connection.id,
            square_object_id="ITEM-1",
            object_type="ITEM",
            version=1,
            is_deleted=False,
            raw_payload_json={"id": "ITEM-1", "type": "ITEM"},
        )
        db.session.add(bad_object)
        db.session.flush()
        bad_object_id = bad_object.id
        db.session.commit()

    response = client.post(
        "/api/integrations/square/catalog/mappings",
        headers=csrf_headers(client),
        json={
            "organizationId": organization.id,
            "squareCatalogObjectId": bad_object_id,
            "mappingType": "menu_item",
            "flowtallyEntityType": "menu_item",
            "flowtallyEntityId": "1",
            "status": "mapped",
        },
    )
    assert response.status_code == 400
