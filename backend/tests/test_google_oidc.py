from __future__ import annotations

import base64
import json
from datetime import datetime, timezone

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from backend import google_oidc
from backend.google_oidc import verify_google_id_token


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def test_verify_google_id_token_accepts_valid_signature(app):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_numbers = key.public_key().public_numbers()
    jwk = {
        "kid": "test-key",
        "kty": "RSA",
        "alg": "RS256",
        "use": "sig",
        "n": _b64url(public_numbers.n.to_bytes((public_numbers.n.bit_length() + 7) // 8, "big")),
        "e": _b64url(public_numbers.e.to_bytes((public_numbers.e.bit_length() + 7) // 8, "big")),
    }
    now = datetime.now(timezone.utc)
    payload = {
        "iss": "https://accounts.google.com",
        "aud": "google-client",
        "sub": "google-subject-123",
        "email": "person@example.com",
        "email_verified": True,
        "nonce": "nonce-value",
        "iat": int(now.timestamp()) - 10,
        "exp": int(now.timestamp()) + 300,
    }
    header = {"alg": "RS256", "kid": "test-key", "typ": "JWT"}
    signing_input = ".".join(
        [
            _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8")),
            _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
        ]
    )
    signature = key.sign(signing_input.encode("ascii"), padding.PKCS1v15(), hashes.SHA256())
    token = f"{signing_input}.{_b64url(signature)}"

    with app.app_context():
        app.config.update(
            {
                "GOOGLE_CLIENT_ID": "google-client",
                "GOOGLE_CLIENT_SECRET": "google-secret",
                "GOOGLE_REDIRECT_URI": "https://example.com/oauth/callback",
            }
        )
        claims = verify_google_id_token(token, nonce="nonce-value", jwks_document={"keys": [jwk]}, now=now)

    assert claims["sub"] == "google-subject-123"
    assert claims["email"] == "person@example.com"


def test_google_start_redirects_with_state_and_nonce(app, client, monkeypatch):
    class FakeResponse:
        def __init__(self, payload: str):
            self.payload = payload.encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return self.payload

    with app.app_context():
        app.config.update(
            {
                "GOOGLE_OIDC_ENABLED": True,
                "GOOGLE_CLIENT_ID": "client-id",
                "GOOGLE_CLIENT_SECRET": "client-secret",
                "GOOGLE_REDIRECT_URI": "https://example.com/auth/google/callback",
            }
        )

    monkeypatch.setattr(
        google_oidc.urllib_request,
        "urlopen",
        lambda *_args, **_kwargs: FakeResponse('{"token_endpoint":"https://example.com/token","jwks_uri":"https://example.com/jwks"}'),
    )

    response = client.get("/api/auth/google/start?purpose=link")

    assert response.status_code == 302
    assert "accounts.google.com/o/oauth2/v2/auth" in response.headers["Location"]
    with client.session_transaction() as session:
        assert session["google_oidc_purpose"] == "link"
        assert session["google_oidc_state"]
        assert session["google_oidc_nonce"]


def test_google_callback_redirects_to_frontend_completion_page(app, client, monkeypatch):
    with app.app_context():
        app.config.update(
            {
                "GOOGLE_OIDC_ENABLED": True,
                "GOOGLE_CLIENT_ID": "client-id",
                "GOOGLE_CLIENT_SECRET": "client-secret",
                "GOOGLE_REDIRECT_URI": "https://example.com/api/auth/google/callback",
            }
        )

    with client.session_transaction() as session:
        session["google_oidc_state"] = "state"
        session["google_oidc_nonce"] = "nonce"
        session["google_oidc_purpose"] = "login"
        session["google_oidc_expires_at"] = "2026-08-06T12:00:00+00:00"

    monkeypatch.setattr(
        google_oidc,
        "exchange_google_code",
        lambda code: type("Token", (), {"id_token": "stub-id-token"})(),
    )
    monkeypatch.setattr(
        google_oidc,
        "verify_google_id_token",
        lambda id_token, nonce: {
            "iss": "https://accounts.google.com",
            "aud": "client-id",
            "sub": "google-subject",
            "email": "person@example.com",
            "email_verified": True,
            "nonce": nonce,
            "exp": 9999999999,
            "iat": 9999990000,
        },
    )

    response = client.get("/api/auth/google/callback?state=state&code=test-code", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["Location"].startswith("/auth/google/complete?")
