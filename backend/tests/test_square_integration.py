from __future__ import annotations

import json
from uuid import uuid4

from cryptography.fernet import Fernet

from backend.extensions import db
from backend.models import Organization, OrganizationMembership, RestaurantLocation, SquareConnection, SquareDailySalesSummary, SquareOrder, SquareWebhookEvent, User
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


def oauth_responder():
    calls = {"locations": 0, "catalog": 0}

    def handler(request_obj, timeout=30):
        url = request_obj.full_url
        if url.endswith("/oauth2/token"):
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
                            {"id": "CAT-3", "type": "CATEGORY", "version": 3, "is_deleted": False},
                        ]
                    }
                )
            return FakeResponse(
                {
                    "objects": [
                        {"id": "CAT-1", "type": "ITEM_VARIATION", "version": 1, "is_deleted": False},
                        {"id": "CAT-2", "type": "MODIFIER", "version": 2, "is_deleted": False},
                    ],
                    "cursor": "page-2",
                }
            )
        if "/v2/orders/search" in url:
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
                                    "catalog_object_id": "CAT-1",
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
    assert "/integrations/square" in callback_response.headers["Location"]
    return fake_urlopen


def test_square_oauth_connection_catalog_and_status(app, client, monkeypatch):
    login(client)
    organization = make_operational_organization(
        User.query.filter_by(email=LOCAL_OWNER_EMAIL).first(),
        name=f"Square Org {uuid4().hex[:6]}",
        location_name="Main Kitchen",
    )
    select_org = client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization.id})
    assert select_org.status_code == 200

    fake_urlopen = connect_square(client, monkeypatch, app, organization.id)
    assert fake_urlopen.calls["locations"] == 1
    assert fake_urlopen.calls["catalog"] == 2

    status_response = client.get(f"/api/integrations/square/status?organizationId={organization.id}")
    assert status_response.status_code == 200
    connection = status_response.get_json()["connection"]
    assert connection["status"] == "connected"
    assert connection["squareMerchantId"] == "merchant-123"
    assert connection["catalogCount"] >= 2
    assert connection["locationCount"] == 1

    with app.app_context():
        square_connection = SquareConnection.query.filter_by(organization_id=organization.id).first()
        assert square_connection is not None
        assert square_connection.access_token_ciphertext != "square-access-token"
        assert square_connection.refresh_token_ciphertext != "square-refresh-token"
        assert square_connection.square_merchant_id == "merchant-123"


def test_square_location_mapping_catalog_pagination_and_orders(app, client, monkeypatch):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    assert owner is not None
    organization = make_operational_organization(owner, name=f"Square Orders {uuid4().hex[:6]}", location_name="Main Kitchen")
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
        assert SquareOrder.query.filter_by(square_connection_id=square_connection.id).count() == 1
        assert SquareDailySalesSummary.query.filter_by(square_connection_id=square_connection.id).count() == 1


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
