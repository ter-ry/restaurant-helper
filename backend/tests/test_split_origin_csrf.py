from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from backend.app import create_app
from backend.extensions import db
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.seed import seed_pilot_data


TRUSTED_FRONTEND_ORIGIN = "http://127.0.0.1:5173"
API_BASE_URL = "http://127.0.0.1:5001"


@pytest.fixture()
def app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("FLOWTALLY_ENV", "testing")

    database_path = tmp_path / "pilot.db"
    application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{database_path.as_posix()}",
            "SESSION_COOKIE_SECURE": False,
            "ALLOWED_ORIGINS": [TRUSTED_FRONTEND_ORIGIN],
            "FLOWTALLY_FRONTEND_ORIGIN": TRUSTED_FRONTEND_ORIGIN,
            "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://",
            "FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF": True,
            "WTF_CSRF_ENABLED": True,
        }
    )

    with application.app_context():
        db.create_all()
        seed_pilot_data(reset=False)
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def _csrf_headers(client, *, origin: str = TRUSTED_FRONTEND_ORIGIN, include_origin: bool = True, include_referer: bool = True) -> dict[str, str]:
    csrf_token = client.get("/api/auth/csrf", base_url=API_BASE_URL, headers={"Origin": origin}).get_json()["csrfToken"]
    headers = {"X-CSRFToken": csrf_token}
    if include_origin:
        headers["Origin"] = origin
    if include_referer:
        headers["Referer"] = f"{origin}/auth/google/complete?status=success"
    return headers


def _login(client) -> None:
    response = client.post(
        "/api/auth/login",
        base_url=API_BASE_URL,
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
        headers=_csrf_headers(client),
    )
    assert response.status_code == 200


def test_split_origin_onboarding_accepts_trusted_frontend(app, client):
    _login(client)

    response = client.post(
        "/api/onboarding/organizations",
        base_url=API_BASE_URL,
        headers=_csrf_headers(client),
        json={
            "name": f"Split Origin Cafe {uuid4().hex[:6]}",
            "templateKey": "CAFE",
            "locationName": "Split Origin Kitchen",
            "city": "Toronto",
        },
    )

    assert response.status_code == 201
    body = response.get_json()
    assert body["membershipRole"] == "owner"
    assert body["currentLocationId"] > 0


def test_split_origin_rejects_untrusted_origin_even_with_csrf(app, client):
    _login(client)

    response = client.post(
        "/api/onboarding/organizations",
        base_url=API_BASE_URL,
        headers=_csrf_headers(client, origin="https://evil.example"),
        json={
            "name": f"Evil Origin Cafe {uuid4().hex[:6]}",
            "templateKey": "CAFE",
            "locationName": "Evil Kitchen",
            "city": "Toronto",
        },
    )

    assert response.status_code == 403
    assert response.get_json()["error"] == "Origin does not match the configured frontend."


def test_split_origin_rejects_fake_flowtally_origin_even_with_csrf(app, client):
    _login(client)

    response = client.post(
        "/api/onboarding/organizations",
        base_url=API_BASE_URL,
        headers=_csrf_headers(client, origin="https://fake.flowtally.ca"),
        json={
            "name": f"Fake Flowtally Cafe {uuid4().hex[:6]}",
            "templateKey": "CAFE",
            "locationName": "Fake Kitchen",
            "city": "Toronto",
        },
    )

    assert response.status_code == 403
    assert response.get_json()["error"] == "Origin does not match the configured frontend."


def test_split_origin_rejects_missing_origin_and_referer_even_with_csrf(app, client):
    _login(client)

    response = client.post(
        "/api/onboarding/organizations",
        base_url=API_BASE_URL,
        headers=_csrf_headers(client, include_origin=False, include_referer=False),
        json={
            "name": f"No Origin Cafe {uuid4().hex[:6]}",
            "templateKey": "CAFE",
            "locationName": "No Origin Kitchen",
            "city": "Toronto",
        },
    )

    assert response.status_code == 403
    assert response.get_json()["error"] == "Origin or referrer is required for browser API requests."


def test_split_origin_still_requires_csrf_from_trusted_frontend(app, client):
    _login(client)

    response = client.post(
        "/api/onboarding/organizations",
        base_url=API_BASE_URL,
        headers={
            "Origin": TRUSTED_FRONTEND_ORIGIN,
            "Referer": f"{TRUSTED_FRONTEND_ORIGIN}/auth/google/complete?status=success",
        },
        json={
            "name": f"Missing Csrf Cafe {uuid4().hex[:6]}",
            "templateKey": "CAFE",
            "locationName": "Missing Csrf Kitchen",
            "city": "Toronto",
        },
    )

    assert response.status_code in {400, 403}


def test_anonymous_protected_route_remains_rejected(client):
    response = client.get("/api/onboarding/organizations", base_url=API_BASE_URL)

    assert response.status_code == 401


def test_google_callback_remains_unaffected_by_split_origin_guard(client):
    response = client.get(
        "/api/auth/google/callback?error=access_denied",
        base_url=API_BASE_URL,
        headers={"Origin": "https://evil.example", "Referer": "https://evil.example/"},
    )

    assert response.status_code == 404
    assert response.get_json()["error"] == "Google login is not enabled."


def test_cors_allows_trusted_frontend_with_credentials(client):
    response = client.get("/api/health", base_url=API_BASE_URL, headers={"Origin": TRUSTED_FRONTEND_ORIGIN})

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == TRUSTED_FRONTEND_ORIGIN
    assert response.headers["Access-Control-Allow-Credentials"] == "true"
