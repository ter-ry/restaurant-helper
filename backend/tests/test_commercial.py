from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from backend.extensions import db
from backend.models import Organization, OrganizationMembership, OrganizationModule, RestaurantLocation, User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD


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


def test_public_templates_and_modules_are_available(client):
    templates = client.get("/api/public/setup-templates")
    modules = client.get("/api/public/modules")

    assert templates.status_code == 200
    assert modules.status_code == 200
    assert any(template["templateKey"] == "CAFE" for template in templates.get_json()["templates"])
    assert any(module["key"] == "PURCHASES" for module in modules.get_json()["modules"])


def test_registered_prospect_can_create_one_prospective_organization(app, client):
    login(client)

    create_response = client.post(
        "/api/onboarding/organizations",
        headers=csrf_headers(client),
        json={"name": f"Prospect Cafe {uuid4().hex[:6]}", "templateKey": "CAFE"},
    )
    assert create_response.status_code == 201
    body = create_response.get_json()
    assert body["membershipRole"] == "owner"

    with app.app_context():
        organization = Organization.query.filter_by(name=body["organization"]["name"]).first()
        assert organization is not None
        assert organization.lifecycle_status == "ONBOARDING"
        assert organization.setup_status == "INTAKE"
        assert organization.subscription_status == "NONE"
        assert organization.is_prospect is True
        assert OrganizationMembership.query.filter_by(organization_id=organization.id).count() == 1
        assert OrganizationModule.query.filter_by(organization_id=organization.id).count() >= 2

    duplicate_response = client.post(
        "/api/onboarding/organizations",
        headers=csrf_headers(client),
        json={"name": f"Prospect Cafe {uuid4().hex[:6]}", "templateKey": "CAFE"},
    )
    assert duplicate_response.status_code == 409


def test_onboarding_tenant_cannot_access_operational_workspace(app, client):
    login(client)

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        organization = Organization(
            name=f"Onboarding Org {uuid4().hex[:6]}",
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
        location = RestaurantLocation(
            organization=organization,
            name="Prospect Kitchen",
            address_line1="1 Prospect Ave",
            city="Toronto",
            region="ON",
            postal_code="M5V 1A1",
            country="Canada",
            timezone="America/Toronto",
        )
        db.session.add(location)
        db.session.add(OrganizationModule(organization=organization, module_key="PURCHASES", status="ENABLED", enabled_at=datetime.now(timezone.utc)))
        db.session.commit()
        organization_id = organization.id
        location_id = location.id

    select_org = client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization_id})
    assert select_org.status_code == 200
    select_location = client.post("/api/locations/select", headers=csrf_headers(client), json={"locationId": location_id})
    assert select_location.status_code == 200

    dashboard = client.get("/api/pilot/dashboard")
    assert dashboard.status_code == 403
    assert dashboard.get_json()["error"] == "This organization is not ready for operational access yet."
