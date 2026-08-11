from __future__ import annotations

from pathlib import Path

import pytest

from backend.app import create_app
from backend.extensions import db
from backend.seed import seed_pilot_data


@pytest.fixture()
def rate_limited_app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("FLOWTALLY_ENV", "testing")
    application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'pilot.db').as_posix()}",
            "SESSION_COOKIE_SECURE": False,
            "ALLOWED_ORIGINS": ["http://127.0.0.1:5173"],
            "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://",
            "RATELIMIT_DEFAULT": "1 per minute",
            "WTF_CSRF_ENABLED": False,
        }
    )

    with application.app_context():
        db.create_all()
        seed_pilot_data(reset=False)
        yield application
        db.session.remove()
        db.drop_all()


def test_health_endpoint_returns_ok(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "ok"
    assert body["service"] == "flowtally-pilot-backend"
    assert body["environment"] == "testing"


def test_health_endpoint_is_exempt_from_rate_limits(rate_limited_app):
    client = rate_limited_app.test_client()

    responses = [client.get("/api/health") for _ in range(3)]
    assert [response.status_code for response in responses] == [200, 200, 200]


def test_application_rate_limits_still_apply(rate_limited_app):
    client = rate_limited_app.test_client()

    responses = [client.post("/api/auth/login", json={"email": "user@example.com", "password": "wrong"}) for _ in range(6)]

    assert responses[0].status_code == 401
    assert responses[-1].status_code == 429
