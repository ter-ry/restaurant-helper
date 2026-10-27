from __future__ import annotations

from types import SimpleNamespace
from cryptography.fernet import Fernet

from backend.extensions import db
from backend.models import AuditEvent, CloverConnection, CloverLocationMapping, CloverMenuMapping, MenuItem, Organization, RestaurantLocation, User
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
        "CLOVER_CLIENT_ID": "clover-client",
        "CLOVER_CLIENT_SECRET": "clover-secret",
        "CLOVER_REDIRECT_URI": "http://testserver/api/integrations/clover/callback",
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
        events = {event.event_type for event in AuditEvent.query.filter_by(organization_id=organization.id).all()}
        assert "clover.mapping.location_confirmed" in events
        assert "clover.mapping.menu_item_saved" in events


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


def _basic_snapshot(location_id=None):
    location = SimpleNamespace(provider_id=location_id, name="Clover Main") if location_id else None
    item = SimpleNamespace(provider_id="item-1", deleted=False, item_group_id=None, option_ids=(), modifier_groups=(), hidden=False, available=True)
    second = SimpleNamespace(provider_id="item-2", deleted=False, item_group_id=None, option_ids=(), modifier_groups=(), hidden=False, available=True)
    return SimpleNamespace(location=location, items=(item, second))


def _mapping_fixture(app, owner, name="Clover Mapping Edit Org"):
    organization = make_operational_organization(owner, name=name, location_name="Main")
    location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
    _configure(app, organization.id)
    connection = CloverConnection(organization_id=organization.id, environment="sandbox", merchant_id="merchant-edit", status="connected", access_token_ciphertext="encrypted")
    menu_one = MenuItem(organization_id=organization.id, location_id=location.id, name="Burger One", normalized_name="burger one", selling_price=18)
    menu_two = MenuItem(organization_id=organization.id, location_id=location.id, name="Burger Two", normalized_name="burger two", selling_price=19)
    db.session.add_all([connection, menu_one, menu_two])
    db.session.commit()
    return organization, location, connection, menu_one, menu_two


def test_patch_updates_exact_mapping_and_rejects_unrelated_mapping(app, client, monkeypatch):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        organization, location, connection, menu_one, menu_two = _mapping_fixture(app, owner)
        monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", lambda _: "token")
        monkeypatch.setattr("backend.clover_integration.CloverCatalogClient.fetch_snapshot", lambda self: _basic_snapshot())
        _login(client)
        csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
        assert client.post("/api/integrations/clover/location-mapping", json={"organizationId": organization.id, "locationId": location.id, "confirm": True}, headers={"X-CSRFToken": csrf}).status_code == 200
        created = client.post("/api/integrations/clover/menu-mappings", json={"organizationId": organization.id, "locationId": location.id, "cloverItemId": "item-1", "flowtallyMenuItemId": menu_one.id, "confirm": True}, headers={"X-CSRFToken": csrf})
        assert created.status_code == 200
        mapping_id = created.get_json()["mapping"]["id"]
        edited = client.patch(f"/api/integrations/clover/menu-mappings/{mapping_id}", json={"organizationId": organization.id, "locationId": location.id, "cloverItemId": "item-1", "flowtallyMenuItemId": menu_two.id, "confirm": True}, headers={"X-CSRFToken": csrf})
        assert edited.status_code == 200
        assert edited.get_json()["mapping"]["flowtallyMenuItemId"] == menu_two.id
        unrelated = client.patch("/api/integrations/clover/menu-mappings/999999", json={"organizationId": organization.id, "locationId": location.id, "cloverItemId": "item-1", "flowtallyMenuItemId": menu_one.id, "confirm": True}, headers={"X-CSRFToken": csrf})
        assert unrelated.status_code == 404


def test_location_removal_invalidates_dependent_menu_mappings(app, client, monkeypatch):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        organization, location, connection, menu_one, _ = _mapping_fixture(app, owner, name="Clover Mapping Removal Org")
        monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", lambda _: "token")
        monkeypatch.setattr("backend.clover_integration.CloverCatalogClient.fetch_snapshot", lambda self: _basic_snapshot())
        _login(client)
        csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
        assert client.post("/api/integrations/clover/location-mapping", json={"organizationId": organization.id, "locationId": location.id, "confirm": True}, headers={"X-CSRFToken": csrf}).status_code == 200
        created = client.post("/api/integrations/clover/menu-mappings", json={"organizationId": organization.id, "locationId": location.id, "cloverItemId": "item-1", "flowtallyMenuItemId": menu_one.id, "confirm": True}, headers={"X-CSRFToken": csrf})
        assert created.status_code == 200
        removed = client.delete(f"/api/integrations/clover/location-mapping?organizationId={organization.id}&locationId={location.id}", headers={"X-CSRFToken": csrf})
        assert removed.status_code == 200
        state = client.get(f"/api/integrations/clover/mappings?organizationId={organization.id}&locationId={location.id}")
        assert state.status_code == 200
        assert state.get_json()["locationMapping"] is None
        assert state.get_json()["menuMappings"] == []
        events = {event.event_type for event in AuditEvent.query.filter_by(organization_id=organization.id).all()}
        assert "clover.mapping.location_removed" in events
        assert "clover.mapping.menu_item_invalidated" in events


def test_merchant_level_location_mapping_is_single_and_untrusted_ids_rejected(app, client, monkeypatch):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        organization, location, connection, _, _ = _mapping_fixture(app, owner, name="Clover Merchant Level Org")
        second_location = RestaurantLocation(organization_id=organization.id, name="Second", timezone="America/Toronto")
        db.session.add(second_location)
        db.session.commit()
        monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", lambda _: "token")
        monkeypatch.setattr("backend.clover_integration.CloverCatalogClient.fetch_snapshot", lambda self: _basic_snapshot())
        _login(client)
        csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
        fake = client.post("/api/integrations/clover/location-mapping", json={"organizationId": organization.id, "locationId": location.id, "cloverLocationId": "forged", "confirm": True}, headers={"X-CSRFToken": csrf})
        assert fake.status_code == 409
        first = client.post("/api/integrations/clover/location-mapping", json={"organizationId": organization.id, "locationId": location.id, "confirm": True}, headers={"X-CSRFToken": csrf})
        assert first.status_code == 200
        second = client.post("/api/integrations/clover/location-mapping", json={"organizationId": organization.id, "locationId": second_location.id, "confirm": True}, headers={"X-CSRFToken": csrf})
        assert second.status_code == 409


def _prepare_oauth_callback(client, organization_id):
    client.get(f"/api/integrations/clover/start?organizationId={organization_id}")
    with client.session_transaction() as stored:
        return stored["clover_oauth_context"]["state"]


def test_same_merchant_reconnection_preserves_mappings_and_audits(app, client, monkeypatch):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        organization, location, connection, menu_one, _ = _mapping_fixture(app, owner, name="Clover Same Merchant Org")
        location_mapping = CloverLocationMapping(
            clover_connection_id=connection.id,
            organization_id=organization.id,
            restaurant_location_id=location.id,
            clover_merchant_id="merchant-edit",
            confirmed_by_user_id=owner.id,
        )
        menu_mapping = CloverMenuMapping(
            clover_connection_id=connection.id,
            organization_id=organization.id,
            restaurant_location_id=location.id,
            clover_merchant_id="merchant-edit",
            clover_item_id="item-1",
            flowtally_menu_item_id=menu_one.id,
            mapped_by_user_id=owner.id,
        )
        db.session.add_all([location_mapping, menu_mapping])
        db.session.commit()
        original_ids = (location_mapping.id, menu_mapping.id)
        _login(client)
        state = _prepare_oauth_callback(client, organization.id)
        monkeypatch.setattr(
            "backend.clover_integration.clover_request",
            lambda method, path, **kwargs: (
                {"access_token": "access", "refresh_token": "refresh"}
                if path.endswith("/token")
                else {"id": "merchant-edit", "name": "Same Merchant"}
            ),
        )
        response = client.get(f"/api/integrations/clover/callback?state={state}&code=auth-code&merchant_id=merchant-edit&client_id=clover-client")
        assert response.status_code == 302
        assert (CloverLocationMapping.query.one().id, CloverMenuMapping.query.one().id) == original_ids


def test_different_merchant_reconnection_invalidates_mappings_atomically(app, client, monkeypatch):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        organization, location, connection, menu_one, _ = _mapping_fixture(app, owner, name="Clover Different Merchant Org")
        location_mapping = CloverLocationMapping(
            clover_connection_id=connection.id,
            organization_id=organization.id,
            restaurant_location_id=location.id,
            clover_merchant_id="merchant-edit",
            confirmed_by_user_id=owner.id,
        )
        menu_mapping = CloverMenuMapping(
            clover_connection_id=connection.id,
            organization_id=organization.id,
            restaurant_location_id=location.id,
            clover_merchant_id="merchant-edit",
            clover_item_id="item-1",
            flowtally_menu_item_id=menu_one.id,
            mapped_by_user_id=owner.id,
        )
        db.session.add_all([location_mapping, menu_mapping])
        db.session.commit()
        invalidated_location_id = location_mapping.id
        invalidated_menu_id = menu_mapping.id
        _login(client)
        state = _prepare_oauth_callback(client, organization.id)
        monkeypatch.setattr(
            "backend.clover_integration.clover_request",
            lambda method, path, **kwargs: (
                {"access_token": "access", "refresh_token": "refresh"}
                if path.endswith("/token")
                else {"id": "merchant-new", "name": "New Merchant"}
            ),
        )
        response = client.get(f"/api/integrations/clover/callback?state={state}&code=auth-code&merchant_id=merchant-new&client_id=clover-client")
        assert response.status_code == 302
        assert CloverLocationMapping.query.filter_by(clover_connection_id=connection.id).count() == 0
        assert CloverMenuMapping.query.filter_by(clover_connection_id=connection.id).count() == 0
        event = AuditEvent.query.filter_by(event_type="clover.mapping.invalidated_merchant_change", organization_id=organization.id).one()
        assert event.metadata_json["previousMerchantId"] == "merchant-edit"
        assert event.metadata_json["locationMappingIds"] == [invalidated_location_id]
        assert event.metadata_json["menuMappingIds"] == [invalidated_menu_id]


def test_stale_mapping_merchant_identity_is_not_read_or_deleted(app, client):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        organization, location, connection, menu_one, _ = _mapping_fixture(app, owner, name="Clover Stale Merchant Org")
        location_mapping = CloverLocationMapping(
            clover_connection_id=connection.id,
            organization_id=organization.id,
            restaurant_location_id=location.id,
            clover_merchant_id="merchant-old",
            confirmed_by_user_id=owner.id,
        )
        menu_mapping = CloverMenuMapping(
            clover_connection_id=connection.id,
            organization_id=organization.id,
            restaurant_location_id=location.id,
            clover_merchant_id="merchant-old",
            clover_item_id="item-1",
            flowtally_menu_item_id=menu_one.id,
            mapped_by_user_id=owner.id,
        )
        connection.merchant_id = "merchant-current"
        db.session.add_all([location_mapping, menu_mapping])
        db.session.commit()
        _login(client)
        state = client.get(f"/api/integrations/clover/mappings?organizationId={organization.id}&locationId={location.id}")
        assert state.status_code == 200
        assert state.get_json()["locationMapping"] is None
        assert state.get_json()["menuMappings"] == []
        assert client.delete(
            f"/api/integrations/clover/menu-mappings/{menu_mapping.id}?organizationId={organization.id}",
            headers={"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]},
        ).status_code == 404
        assert CloverLocationMapping.query.one().id == location_mapping.id
