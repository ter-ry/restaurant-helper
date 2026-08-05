from __future__ import annotations

from uuid import uuid4

from backend.extensions import db
from backend.models import AuditEvent, Organization, OrganizationMembership, RestaurantLocation, User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD


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
    assert len(body["restaurantLocations"]) == 1
    assert body["currentLocation"]["name"] == "Flowtally Pilot Kitchen"


def test_organization_detail_isolated_by_membership(app, client):
    with app.app_context():
        other_org = Organization(name="Another Test Restaurant")
        db.session.add(other_org)
        db.session.flush()
        db.session.add(
            RestaurantLocation(
                organization=other_org,
                name="Another Kitchen",
                address_line1="1 Test Way",
                city="Toronto",
                region="ON",
                postal_code="M5V 1A1",
                country="Canada",
                timezone="America/Toronto",
            )
        )
        db.session.commit()
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

        org = Organization(name="Explicit Selection Cafe")
        db.session.add(org)
        db.session.flush()
        db.session.add(OrganizationMembership(user=owner, organization=org, role="owner"))
        first_location = RestaurantLocation(
            organization=org,
            name="Cafe Front",
            address_line1="1 Front St",
            city="Toronto",
            region="ON",
            postal_code="M5H 1A1",
            country="Canada",
            timezone="America/Toronto",
        )
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
        db.session.add_all([first_location, second_location])
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

        secondary_org = Organization(name=f"Secondary Org {uuid4().hex[:8]}")
        db.session.add(secondary_org)
        db.session.flush()
        db.session.add(OrganizationMembership(user=owner, organization=secondary_org, role="owner"))
        db.session.add(
            RestaurantLocation(
                organization=secondary_org,
                name="Secondary Kitchen",
                address_line1="99 Test Way",
                city="Toronto",
                region="ON",
                postal_code="M5V 1A9",
                country="Canada",
                timezone="America/Toronto",
            )
        )
        db.session.commit()
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
