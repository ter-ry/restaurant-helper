"""Release hardening (#175): the central authorization maps must stay complete, and the
Daily Close blueprint — which sits outside the central `pilot_api.*` gate — must keep
enforcing its own module entitlement.

`backend/policy.enforce_endpoint_permission` raises `RuntimeError` for any registered
`pilot_api.*` endpoint that is missing from `ENDPOINT_PERMISSIONS`, so a new endpoint added
without a mapping first fails as a 500 on a real request instead of at test time. These tests
make that a build-time failure.

`backend/access.access_state_for_request` returns early for every endpoint whose name does not
start with `pilot_api.`, so entries keyed on an unregistered endpoint are dead configuration
that can never gate anything. Daily Close therefore gates itself in
`backend/daily_close._require_daily_close_access`, and the last test here proves that gate
refuses every Daily Close route and mutates nothing when the module is disabled.
"""
from __future__ import annotations

from uuid import uuid4

from backend.access import ENDPOINT_MODULE_KEYS
from backend.extensions import db
from backend.models import DailyCloseSession, OrganizationModule, RestaurantLocation, User
from backend.modules import MODULE_REGISTRY
from backend.policy import ENDPOINT_PERMISSIONS, PERMISSION_ROLES
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization

# `pilot_api.health` is deliberately unauthenticated; see backend/policy.enforce_endpoint_permission.
UNAUTHENTICATED_PILOT_ENDPOINTS = {"pilot_api.health"}


def _registered_pilot_endpoints(app) -> set[str]:
    return {rule.endpoint for rule in app.url_map.iter_rules() if rule.endpoint.startswith("pilot_api.")}


def test_every_pilot_api_endpoint_has_a_centralized_permission_backed_by_roles(app):
    registered = _registered_pilot_endpoints(app) - UNAUTHENTICATED_PILOT_ENDPOINTS
    assert registered, "no pilot_api endpoints were registered; the fixture is wrong"

    unmapped = sorted(registered - set(ENDPOINT_PERMISSIONS))
    assert unmapped == [], f"pilot_api endpoints without a centralized permission (they 500 on a live request): {unmapped}"

    without_roles = sorted(
        endpoint for endpoint in registered if not PERMISSION_ROLES.get(ENDPOINT_PERMISSIONS[endpoint])
    )
    assert without_roles == [], f"endpoints whose permission grants no role at all (always 403): {without_roles}"


def test_central_authorization_maps_contain_no_dead_endpoint_keys(app):
    registered = _registered_pilot_endpoints(app)

    stale_permissions = sorted(set(ENDPOINT_PERMISSIONS) - registered)
    assert stale_permissions == [], f"ENDPOINT_PERMISSIONS keys that are not registered endpoints: {stale_permissions}"

    # Entries keyed on an unregistered endpoint can never gate a request, because
    # access_state_for_request only looks at registered pilot_api.* endpoint names.
    stale_modules = sorted(set(ENDPOINT_MODULE_KEYS) - registered)
    assert stale_modules == [], f"ENDPOINT_MODULE_KEYS keys that can never gate a request: {stale_modules}"

    unknown_modules = sorted({key for key in ENDPOINT_MODULE_KEYS.values() if key not in MODULE_REGISTRY})
    assert unknown_modules == [], f"ENDPOINT_MODULE_KEYS values that are not real modules: {unknown_modules}"


def test_daily_close_routes_refuse_a_disabled_module_and_change_nothing(app, client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    assert client.post(
        "/api/auth/login",
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
        headers={"X-CSRFToken": csrf},
    ).status_code == 200

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        organization = make_operational_organization(
            owner,
            name=f"Daily Close Module Gate {uuid4().hex[:8]}",
            location_name="Toronto Kitchen",
            enabled_modules=("PURCHASES", "INVENTORY", "REPORTING", "DAILY_CLOSE"),
        )
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).one()
        db.session.commit()
        organization_id, location_id = organization.id, location.id

    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    headers = {"X-CSRFToken": csrf}
    assert client.post("/api/organizations/select", headers=headers, json={"organizationId": organization_id}).status_code == 200

    # A real session exists while the module is enabled, so the disabled-module checks below
    # exercise the session routes too, not just the "nothing to find" path.
    opened = client.post(
        "/api/pilot/daily-close",
        headers=headers,
        json={"locationId": location_id, "businessDate": "2026-08-30"},
    )
    assert opened.status_code in {200, 201}, opened.get_data(as_text=True)
    session_id = opened.get_json()["session"]["id"]

    with app.app_context():
        before = DailyCloseSession.query.filter_by(id=session_id).one()
        baseline = (before.status, before.notes, before.completed_at, before.summary_snapshot_json)
        for module in OrganizationModule.query.filter_by(organization_id=organization_id, module_key="DAILY_CLOSE").all():
            module.status = "DISABLED"
        db.session.commit()

    refused = {
        "read": client.get("/api/pilot/daily-close", query_string={"locationId": location_id, "businessDate": "2026-08-30"}),
        "open": client.post("/api/pilot/daily-close", headers=headers, json={"locationId": location_id, "businessDate": "2026-08-31"}),
        "sync": client.post(f"/api/pilot/daily-close/{session_id}/sync-sales", headers=headers, json={}),
        "update": client.patch(f"/api/pilot/daily-close/{session_id}", headers=headers, json={"notes": "edited while disabled"}),
        "finalize": client.post(f"/api/pilot/daily-close/{session_id}/finalize", headers=headers, json={}),
    }
    for name, response in refused.items():
        assert response.status_code == 403, f"{name} returned {response.status_code}: {response.get_data(as_text=True)}"

    with app.app_context():
        after = DailyCloseSession.query.filter_by(id=session_id).one()
        assert (after.status, after.notes, after.completed_at, after.summary_snapshot_json) == baseline
        assert DailyCloseSession.query.filter_by(organization_id=organization_id).count() == 1
