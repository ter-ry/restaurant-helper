from __future__ import annotations

from backend.extensions import db
from backend.models import User
from backend.seed import (
    LOCAL_MANAGER_EMAIL,
    LOCAL_MANAGER_PASSWORD,
    LOCAL_OWNER_EMAIL,
    LOCAL_OWNER_PASSWORD,
)


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
