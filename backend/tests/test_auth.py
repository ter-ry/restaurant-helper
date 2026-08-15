from __future__ import annotations

from types import SimpleNamespace

from backend.extensions import db
from backend.models import User
from backend.seed import (
    LOCAL_MANAGER_EMAIL,
    LOCAL_MANAGER_PASSWORD,
    LOCAL_OWNER_EMAIL,
    LOCAL_OWNER_PASSWORD,
)
from backend import tenant_context


def login(client, email: str, password: str):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    return client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"X-CSRFToken": csrf},
    )


def test_owner_login_and_me_returns_session(client):
    response = login(client, LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD)

    assert response.status_code == 200
    body = response.get_json()
    assert body["user"]["email"] == LOCAL_OWNER_EMAIL
    assert body["membershipRole"] == "owner"
    assert body["currentOrganization"]["name"] == "Flowtally Pilot Restaurant"

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    me_body = me.get_json()
    assert me_body["user"]["email"] == LOCAL_OWNER_EMAIL
    assert me_body["membershipRole"] == "owner"
    assert me_body["currentOrganizationId"] == body["currentOrganization"]["id"]
    assert me_body["organizations"][0]["organization"]["name"] == "Flowtally Pilot Restaurant"
    assert me_body["organizations"][0]["membershipRole"] == "owner"
    assert me_body["organizations"][0]["selected"] is True


def test_login_rejects_unknown_or_wrong_password(client):
    bad_password = login(client, LOCAL_OWNER_EMAIL, "wrong-password")
    assert bad_password.status_code == 401
    assert bad_password.get_json()["error"] == "Invalid email or password."

    unknown_user = login(client, "missing@flowtally.local", "anything")
    assert unknown_user.status_code == 401
    assert unknown_user.get_json()["error"] == "Invalid email or password."


def test_inactive_user_cannot_login(app, client):
    with app.app_context():
        user = User.query.filter_by(email=LOCAL_MANAGER_EMAIL).first()
        assert user is not None
        user.is_active = False
        db.session.commit()

    response = login(client, LOCAL_MANAGER_EMAIL, LOCAL_MANAGER_PASSWORD)
    assert response.status_code == 401


def test_logout_clears_session(client):
    login_response = login(client, LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD)
    assert login_response.status_code == 200

    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    logout = client.post("/api/auth/logout", headers={"X-CSRFToken": csrf})
    assert logout.status_code == 200
    assert logout.get_json() == {"ok": True}

    me_after_logout = client.get("/api/auth/me")
    assert me_after_logout.status_code == 401


def test_login_requires_csrf(client):
    response = client.post("/api/auth/login", json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD})
    assert response.status_code == 400
    assert response.get_json()["error"]


def test_disabled_support_access_does_not_set_tenant_scope(monkeypatch):
    captured: list[tuple[str, str]] = []

    monkeypatch.setattr(tenant_context, "_is_postgresql", lambda: True)
    monkeypatch.setattr(
        tenant_context,
        "_set_local_setting",
        lambda name, value: captured.append((name, value or "")),
    )
    monkeypatch.setattr(tenant_context, "request", SimpleNamespace(endpoint="pilot_api.dashboard"))
    monkeypatch.setattr(tenant_context, "current_user", SimpleNamespace(is_authenticated=True, id=77))
    monkeypatch.setattr(
        tenant_context,
        "get_current_organization_bundle",
        lambda: (SimpleNamespace(id=42), SimpleNamespace(id=1), []),
    )
    monkeypatch.setattr(
        tenant_context,
        "get_platform_role",
        lambda user_id: SimpleNamespace(is_active=True, role="support"),
    )
    monkeypatch.setattr(tenant_context, "support_grant_for_user", lambda *_args, **_kwargs: SimpleNamespace(id=99))

    tenant_context.apply_request_tenant_context()

    assert captured == [
        ("flowtally.user_id", "77"),
        ("flowtally.access_scope", "public"),
        ("flowtally.organization_id", ""),
        ("flowtally.support_grant_id", ""),
    ]


def test_explicit_setup_scope_is_preserved_for_onboarding_endpoint(monkeypatch):
    captured: list[tuple[str, str]] = []

    monkeypatch.setattr(tenant_context, "_is_postgresql", lambda: True)
    monkeypatch.setattr(
        tenant_context,
        "_set_local_setting",
        lambda name, value: captured.append((name, value or "")),
    )
    monkeypatch.setattr(tenant_context, "request", SimpleNamespace(endpoint="commercial.create_prospect_organization"))
    monkeypatch.setattr(tenant_context, "current_user", SimpleNamespace(is_authenticated=True, id=77))
    monkeypatch.setattr(
        tenant_context,
        "get_current_organization_bundle",
        lambda: (None, None, []),
    )
    monkeypatch.setattr(tenant_context, "get_platform_role", lambda user_id: None)
    monkeypatch.setattr(tenant_context, "support_grant_for_user", lambda *_args, **_kwargs: None)

    tenant_context.apply_request_tenant_context(access_scope="setup")

    assert captured == [
        ("flowtally.user_id", "77"),
        ("flowtally.access_scope", "setup"),
        ("flowtally.organization_id", ""),
        ("flowtally.support_grant_id", ""),
    ]


def test_authenticated_request_sets_user_identity_before_tenant_discovery(monkeypatch):
    captured: list[tuple[str, str]] = []
    discovery_calls: list[str] = []

    monkeypatch.setattr(tenant_context, "_is_postgresql", lambda: True)
    monkeypatch.setattr(
        tenant_context,
        "_set_local_setting",
        lambda name, value: captured.append((name, value or "")),
    )
    monkeypatch.setattr(tenant_context, "request", SimpleNamespace(endpoint="pilot_api.dashboard"))
    monkeypatch.setattr(tenant_context, "current_user", SimpleNamespace(is_authenticated=True, id=77))
    monkeypatch.setattr(tenant_context, "get_platform_role", lambda user_id: None)
    monkeypatch.setattr(tenant_context, "support_grant_for_user", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        tenant_context,
        "get_current_organization_bundle",
        lambda: (
            discovery_calls.append("bundle") or SimpleNamespace(id=42),
            SimpleNamespace(id=1),
            [],
        ),
    )

    tenant_context.apply_request_tenant_context()

    assert discovery_calls == ["bundle"]
    assert captured[0] == ("flowtally.user_id", "77")
    assert captured[1:] == [
        ("flowtally.access_scope", "customer"),
        ("flowtally.organization_id", "42"),
        ("flowtally.support_grant_id", ""),
    ]
