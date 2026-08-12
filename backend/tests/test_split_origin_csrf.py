from __future__ import annotations

from uuid import uuid4

from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD


TRUSTED_FRONTEND_ORIGIN = "https://staging.flowtally.ca"
API_BASE_URL = "https://api-staging.flowtally.ca"


def _csrf_headers(client, *, origin: str = TRUSTED_FRONTEND_ORIGIN) -> dict[str, str]:
    csrf_token = client.get("/api/auth/csrf", base_url=API_BASE_URL, headers={"Origin": origin}).get_json()["csrfToken"]
    return {
        "X-CSRFToken": csrf_token,
        "Origin": origin,
        "Referer": f"{origin}/auth/google/complete?status=success",
    }


def _login(client, *, origin: str = TRUSTED_FRONTEND_ORIGIN) -> None:
    response = client.post(
        "/api/auth/login",
        base_url=API_BASE_URL,
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
        headers=_csrf_headers(client, origin=origin),
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


def test_google_callback_remains_unaffected_by_split_origin_guard(client):
    response = client.get(
        "/api/auth/google/callback?error=access_denied",
        base_url=API_BASE_URL,
        headers={"Origin": "https://evil.example", "Referer": "https://evil.example/"},
    )

    assert response.status_code == 404
    assert response.get_json()["error"] == "Google login is not enabled."


def test_anonymous_protected_route_remains_rejected(client):
    response = client.get("/api/onboarding/organizations", base_url=API_BASE_URL)

    assert response.status_code == 401


def test_cors_allows_trusted_frontend_with_credentials(client):
    response = client.get("/api/health", base_url=API_BASE_URL, headers={"Origin": TRUSTED_FRONTEND_ORIGIN})

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == TRUSTED_FRONTEND_ORIGIN
    assert response.headers["Access-Control-Allow-Credentials"] == "true"
