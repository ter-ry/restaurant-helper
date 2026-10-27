from __future__ import annotations

from types import SimpleNamespace
from cryptography.fernet import Fernet

from backend.extensions import db
from backend.models import CloverConnection, MenuItem, Organization, RestaurantLocation, User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization


def _login(client):
    token = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post("/api/auth/login", json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD}, headers={"X-CSRFToken": token})
    assert response.status_code == 200


def _configure(app, organization_id):
    app.config.update({
        "CLOVER_ENABLED": True,
        "CLOVER_ENVIRONMENT": "sandbox",
        "CLOVER_ALLOWED_ORGANIZATION_IDS": [organization_id],
        "CLOVER_MAPPING_ENABLED": True,
        "INTEGRATION_ENCRYPTION_KEY": Fernet.generate_key().decode(),
    })


def test_owner_can_confirm_location_and_map_basic_item(app, client, monkeypatch):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        organization = make_operational_organization(owner, name="Clover Mapping Org", location_name="Main")
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        _configure(app, organization.id)
        connection = CloverConnection(organization_id=organization.id, environment="sandbox", merchant_id="merchant-1", status="connected", access_token_ciphertext="encrypted")
        menu_item = MenuItem(organization_id=organization.id, location_id=location.id, name="Test Burger", normalized_name="test burger", selling_price=18)
        db.session.add_all([connection, menu_item])
        db.session.commit()
        monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", lambda _: "token")
        monkeypatch.setattr("backend.clover_integration.CloverCatalogClient.fetch_snapshot", lambda self: SimpleNamespace(items=(SimpleNamespace(provider_id="item-1", deleted=False, item_group_id=None, option_ids=(), modifier_groups=(), hidden=False, available=True),)))
        _login(client)
        csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
        location_response = client.post("/api/integrations/clover/location-mapping", json={"organizationId": organization.id, "locationId": location.id, "cloverLocationId": None, "confirm": True}, headers={"X-CSRFToken": csrf})
        assert location_response.status_code == 200
        mapping_response = client.post("/api/integrations/clover/menu-mappings", json={"organizationId": organization.id, "locationId": location.id, "cloverItemId": "item-1", "flowtallyMenuItemId": menu_item.id, "confirm": True}, headers={"X-CSRFToken": csrf})
        assert mapping_response.status_code == 200
        assert mapping_response.get_json()["mapping"]["flowtallyMenuItemName"] == "Test Burger"


def test_mapping_gate_is_disabled_by_default(app, client):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        organization = make_operational_organization(owner, name="Clover Disabled Org", location_name="Main")
        _configure(app, organization.id)
        app.config["CLOVER_MAPPING_ENABLED"] = False
        _login(client)
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        assert location is not None
        assert client.get(f"/api/integrations/clover/mappings?organizationId={organization.id}&locationId={location.id}").status_code == 404


def test_cross_tenant_mapping_is_rejected(app, client):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        first = make_operational_organization(owner, name="Clover Org A", location_name="Main A")
        second = make_operational_organization(owner, name="Clover Org B", location_name="Main B")
        _configure(app, first.id)
        _login(client)
        response = client.get(f"/api/integrations/clover/mappings?organizationId={second.id}&locationId=2")
        assert response.status_code in {403, 404}
