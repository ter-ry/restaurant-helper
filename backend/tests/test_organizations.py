from __future__ import annotations

from backend.extensions import db
from backend.models import Organization, RestaurantLocation, User
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
