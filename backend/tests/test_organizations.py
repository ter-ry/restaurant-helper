from __future__ import annotations

from uuid import uuid4

from backend.extensions import db
from backend.models import AuditEvent, OrganizationModule, RestaurantLocation, User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization


def login(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    return client.post(
        "/api/auth/login",
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
        headers={"X-CSRFToken": csrf},
    )


def test_current_organization_bundle(client):
    assert login(client).status_code == 200

    response = client.get("/api/organizations/current")
    assert response.status_code == 200
    body = response.get_json()
    assert body["organization"]["name"] == "Flowtally Pilot Restaurant"
    assert body["membershipRole"] == "owner"
    assert "enabledModuleKeys" in body
    assert len(body["restaurantLocations"]) == 1
    assert body["currentLocation"]["name"] == "Flowtally Pilot Kitchen"


def test_enabled_module_keys_track_current_organization_and_ignore_disabled_rows(app, client):
    assert login(client).status_code == 200

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        enabled_org = make_operational_organization(
            owner,
            name="Enabled Module Cafe",
            location_name="Enabled Kitchen",
            enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING", "STOCK_COUNTS", "REORDER_PLANS"),
        )
        disabled_org = make_operational_organization(
            owner,
            name="Disabled Module Cafe",
            location_name="Disabled Kitchen",
        )
        db.session.add(
            OrganizationModule(
                organization=disabled_org,
                module_key="MENU_COSTING",
                status="DISABLED",
            )
        )
        db.session.commit()
        enabled_org_id = enabled_org.id
        disabled_org_id = disabled_org.id

    select_enabled = client.post(
        "/api/organizations/select",
        headers={"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]},
        json={"organizationId": enabled_org_id},
    )
    assert select_enabled.status_code == 200
    enabled_bundle = client.get("/api/organizations/current")
    assert enabled_bundle.status_code == 200
    enabled_bundle_body = enabled_bundle.get_json()
    assert "MENU_COSTING" in enabled_bundle_body["enabledModuleKeys"]
    assert enabled_bundle_body["enabledModuleKeys"].count("MENU_COSTING") == 1

    me_enabled = client.get("/api/auth/me")
    assert me_enabled.status_code == 200
    assert "MENU_COSTING" in me_enabled.get_json()["enabledModuleKeys"]

    select_disabled = client.post(
        "/api/organizations/select",
        headers={"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]},
        json={"organizationId": disabled_org_id},
    )
    assert select_disabled.status_code == 200
    disabled_bundle = client.get("/api/organizations/current")
    assert disabled_bundle.status_code == 200
    disabled_bundle_body = disabled_bundle.get_json()
    assert "MENU_COSTING" not in disabled_bundle_body["enabledModuleKeys"]

    me_disabled = client.get("/api/auth/me")
    assert me_disabled.status_code == 200
    assert "MENU_COSTING" not in me_disabled.get_json()["enabledModuleKeys"]


def test_organization_detail_isolated_by_membership(app, client):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        other_org = make_operational_organization(owner, name="Another Test Restaurant", location_name="Another Kitchen")
        other_org_id = other_org.id

    assert login(client).status_code == 200

    response = client.get(f"/api/organizations/{other_org_id}")
    assert response.status_code == 403
    assert response.get_json()["error"] == "That organization is not available to the current account."


def test_explicit_organization_and_location_selection_records_audit(app, client):
    assert login(client).status_code == 200

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org = make_operational_organization(owner, name="Explicit Selection Cafe", location_name="Cafe Front")
        second_location = RestaurantLocation(
            organization=org,
            name="Cafe Back",
            address_line1="2 Front St",
            city="Toronto",
            region="ON",
            postal_code="M5H 1A2",
            country="Canada",
            timezone="America/Toronto",
        )
        db.session.add(second_location)
        db.session.commit()
        organization_id = org.id
        second_location_id = second_location.id

    organizations_response = client.get("/api/organizations")
    assert organizations_response.status_code == 200
    organizations_body = organizations_response.get_json()
    assert organizations_body["currentOrganizationId"] is not None
    assert any(entry["organization"]["id"] == organization_id for entry in organizations_body["organizations"])

    select_org = client.post("/api/organizations/select", headers={"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]}, json={"organizationId": organization_id})
    assert select_org.status_code == 200
    select_org_body = select_org.get_json()
    assert select_org_body["organization"]["id"] == organization_id
    assert len(select_org_body["restaurantLocations"]) == 2
    assert select_org_body["currentLocation"] is None

    locations = client.get("/api/locations")
    assert locations.status_code == 200
    assert len(locations.get_json()["restaurantLocations"]) == 2

    dashboard_before_location = client.get("/api/pilot/dashboard")
    assert dashboard_before_location.status_code == 404

    select_location = client.post("/api/locations/select", headers={"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]}, json={"locationId": second_location_id})
    assert select_location.status_code == 200
    assert select_location.get_json()["currentLocation"]["id"] == second_location_id

    dashboard_after_location = client.get("/api/pilot/dashboard")
    assert dashboard_after_location.status_code == 200

    with app.app_context():
        events = AuditEvent.query.filter(AuditEvent.event_type.in_(["tenant.organization_selected", "tenant.location_selected"])).all()
        assert {event.event_type for event in events} == {"tenant.organization_selected", "tenant.location_selected"}


def test_multi_membership_login_requires_explicit_selection(app, client):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        secondary_org = make_operational_organization(
            owner,
            name=f"Secondary Org {uuid4().hex[:8]}",
            location_name="Secondary Kitchen",
        )
        secondary_org_id = secondary_org.id

    response = login(client)
    assert response.status_code == 200
    body = response.get_json()
    assert body["currentOrganization"] is None
    assert len(body["organizations"]) >= 2

    organizations_response = client.get("/api/organizations")
    assert organizations_response.status_code == 200
    organizations_body = organizations_response.get_json()
    assert organizations_body["currentOrganizationId"] is None
    assert any(entry["organization"]["id"] == secondary_org_id for entry in organizations_body["organizations"])
