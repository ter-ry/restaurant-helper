from __future__ import annotations

from uuid import uuid4

from backend.extensions import db
from backend.models import Organization, PlatformRole, User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD


def login(client, email: str = LOCAL_OWNER_EMAIL, password: str = LOCAL_OWNER_PASSWORD):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 200


def csrf_headers(client):
    return {"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]}


def test_platform_setup_console_can_activate_an_organization(app, client):
    login(client)

    with app.app_context():
        user = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert user is not None
        if PlatformRole.query.filter_by(user_id=user.id).first() is None:
            db.session.add(PlatformRole(user_id=user.id, role="setup_admin", is_active=True))
            db.session.commit()

    create_response = client.post(
        "/api/onboarding/organizations",
        headers=csrf_headers(client),
        json={
            "name": f"Setup Org {uuid4().hex[:6]}",
            "templateKey": "CAFE",
            "locationName": "Setup Kitchen",
            "city": "Toronto",
        },
    )
    assert create_response.status_code == 201
    organization_id = create_response.get_json()["organization"]["id"]

    list_response = client.get("/api/platform/setup/organizations?state=ONBOARDING")
    assert list_response.status_code == 200
    assert any(entry["organization"]["id"] == organization_id for entry in list_response.get_json()["organizations"])

    detail_response = client.get(f"/api/platform/setup/organizations/{organization_id}")
    assert detail_response.status_code == 200

    template_response = client.post(
        f"/api/platform/setup/organizations/{organization_id}/template",
        headers=csrf_headers(client),
        json={"templateKey": "CAFE"},
    )
    assert template_response.status_code == 200

    module_response = client.post(
        f"/api/platform/setup/organizations/{organization_id}/modules",
        headers=csrf_headers(client),
        json={
            "modules": [
                {"moduleKey": "PURCHASES", "status": "ENABLED"},
                {"moduleKey": "INVENTORY", "status": "ENABLED"},
                {"moduleKey": "REORDER_PLANS", "status": "ENABLED"},
                {"moduleKey": "STOCK_COUNTS", "status": "ENABLED"},
                {"moduleKey": "REPORTING", "status": "ENABLED"},
            ]
        },
    )
    assert module_response.status_code == 200

    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/locations",
        headers=csrf_headers(client),
        json={"locations": [{"id": create_response.get_json()["currentLocationId"], "name": "Setup Kitchen", "city": "Toronto"}]},
    ).status_code == 200

    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/imports",
        headers=csrf_headers(client),
        json={"imports": []},
    ).status_code == 200
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/square",
        headers=csrf_headers(client),
        json={"square": {"required": False, "locationMappings": []}},
    ).status_code == 200
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/custom-fields",
        headers=csrf_headers(client),
        json={"fields": {"supplier": [], "inventoryItem": [], "purchaseInvoice": []}},
    ).status_code == 200
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/notes",
        headers=csrf_headers(client),
        json={"notes": ["Ready for platform review"]},
    ).status_code == 200
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/blockers",
        headers=csrf_headers(client),
        json={"blockers": []},
    ).status_code == 200

    review_response = client.post(f"/api/platform/setup/organizations/{organization_id}/review", headers=csrf_headers(client))
    assert review_response.status_code == 200

    approval_response = client.post(f"/api/platform/setup/organizations/{organization_id}/review/approve", headers=csrf_headers(client))
    assert approval_response.status_code == 200

    state_response = client.post(
        f"/api/platform/setup/organizations/{organization_id}/state",
        headers=csrf_headers(client),
        json={
            "lifecycleStatus": "READY_FOR_REVIEW",
            "setupStatus": "COMPLETE",
            "subscriptionStatus": "ACTIVE",
            "setupFeeStatus": "confirmed",
        },
    )
    assert state_response.status_code == 200
    assert state_response.get_json()["checklist"]["readyForActivation"] is True

    activate_response = client.post(f"/api/platform/setup/organizations/{organization_id}/activate", headers=csrf_headers(client))
    assert activate_response.status_code == 200
    body = activate_response.get_json()
    assert body["organization"]["lifecycleStatus"] == "ACTIVE"
    assert body["organization"]["setupStatus"] == "COMPLETE"
    assert body["organization"]["subscriptionStatus"] == "ACTIVE"

    with app.app_context():
        organization = Organization.query.filter_by(id=organization_id).first()
        assert organization is not None
        assert organization.lifecycle_status == "ACTIVE"
        assert organization.setup_status == "COMPLETE"

    dashboard = client.get("/api/pilot/dashboard")
    assert dashboard.status_code == 200
