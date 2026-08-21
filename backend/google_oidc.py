from __future__ import annotations

import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from flask import current_app, session
from urllib import error, request as urllib_request


GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration"
GOOGLE_ISSUERS = {"https://accounts.google.com", "accounts.google.com"}
GOOGLE_OAUTH_SCOPES = ["openid", "email", "profile"]


class GoogleOIDCError(RuntimeError):
    pass


@dataclass(slots=True)
class GoogleOIDCTokens:
    access_token: str
    id_token: str
    expires_in: int | None = None
    refresh_token: str | None = None
    token_type: str | None = None
    scope: str | None = None


def google_oidc_enabled() -> bool:
    return bool(current_app.config.get("GOOGLE_OIDC_ENABLED"))


def google_client_id() -> str:
    return current_app.config.get("GOOGLE_CLIENT_ID") or ""


def google_client_secret() -> str:
    return current_app.config.get("GOOGLE_CLIENT_SECRET") or ""


def google_redirect_uri() -> str:
    return current_app.config.get("GOOGLE_REDIRECT_URI") or ""


def generate_google_state() -> str:
    return secrets.token_urlsafe(32)


def generate_google_nonce() -> str:
    return secrets.token_urlsafe(32)


def store_google_session_context(*, state: str, nonce: str, purpose: str = "login") -> None:
    session["google_oidc_state"] = state
    session["google_oidc_nonce"] = nonce
    session["google_oidc_purpose"] = purpose
    session["google_oidc_expires_at"] = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()


def pop_google_session_context() -> dict[str, str]:
    return {
        "state": session.pop("google_oidc_state", ""),
        "nonce": session.pop("google_oidc_nonce", ""),
        "purpose": session.pop("google_oidc_purpose", ""),
        "expires_at": session.pop("google_oidc_expires_at", ""),
    }


def build_google_authorization_url(*, state: str, nonce: str) -> str:
    query = urlencode(
        {
            "client_id": google_client_id(),
            "redirect_uri": google_redirect_uri(),
            "response_type": "code",
            "scope": " ".join(GOOGLE_OAUTH_SCOPES),
            "state": state,
            "nonce": nonce,
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
        }
    )
    return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"


def exchange_google_code(code: str) -> GoogleOIDCTokens:
    discovery = get_google_discovery_document()
    payload = urlencode(
        {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": google_client_id(),
            "client_secret": google_client_secret(),
            "redirect_uri": google_redirect_uri(),
        }
    ).encode("utf-8")
    try:
        token_request = urllib_request.Request(
            discovery["token_endpoint"],
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            method="POST",
        )
        with urllib_request.urlopen(token_request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except error.URLError as exc:  # pragma: no cover - network failure
        raise GoogleOIDCError(f"Google token exchange failed: {exc}") from exc
    if "id_token" not in payload or "access_token" not in payload:
        raise GoogleOIDCError("Google token exchange did not return the expected tokens.")
    return GoogleOIDCTokens(
        access_token=str(payload["access_token"]),
        id_token=str(payload["id_token"]),
        expires_in=payload.get("expires_in"),
        refresh_token=payload.get("refresh_token"),
        token_type=payload.get("token_type"),
        scope=payload.get("scope"),
    )


def get_google_discovery_document() -> dict[str, Any]:
    try:
        with urllib_request.urlopen(GOOGLE_DISCOVERY_URL, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except error.URLError as exc:  # pragma: no cover - network failure
        raise GoogleOIDCError(f"Google discovery lookup failed: {exc}") from exc
    if not isinstance(payload, dict):
        raise GoogleOIDCError("Google discovery document was not a JSON object.")
    return payload


def _base64url_decode(value: str) -> bytes:
    padding_needed = (-len(value)) % 4
    return base64.urlsafe_b64decode(value + ("=" * padding_needed))


def _load_rsa_public_key_from_jwk(jwk: dict[str, Any]) -> rsa.RSAPublicKey:
    modulus = int.from_bytes(_base64url_decode(str(jwk["n"])), "big")
    exponent = int.from_bytes(_base64url_decode(str(jwk["e"])), "big")
    public_numbers = rsa.RSAPublicNumbers(exponent, modulus)
    return public_numbers.public_key()


def _decode_unsigned_jwt(token: str) -> tuple[dict[str, Any], dict[str, Any], bytes]:
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError as exc:
        raise GoogleOIDCError("Google ID token is malformed.") from exc
    header = json.loads(_base64url_decode(header_b64))
    payload = json.loads(_base64url_decode(payload_b64))
    signature = _base64url_decode(signature_b64)
    return header, payload, signature


def verify_google_id_token(
    id_token: str,
    *,
    nonce: str,
    discovery_document: dict[str, Any] | None = None,
    jwks_document: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    if jwks_document is None:
        discovery = discovery_document or get_google_discovery_document()
        try:
            with urllib_request.urlopen(discovery["jwks_uri"], timeout=10) as response:
                jwks = json.loads(response.read().decode("utf-8", errors="replace"))
        except error.URLError as exc:  # pragma: no cover - network failure
            raise GoogleOIDCError(f"Google JWKS lookup failed: {exc}") from exc
    else:
        jwks = jwks_document
    header, payload, signature = _decode_unsigned_jwt(id_token)

    if header.get("alg") != "RS256":
        raise GoogleOIDCError("Google ID token must use RS256.")
    kid = header.get("kid")
    if not kid:
        raise GoogleOIDCError("Google ID token is missing a key id.")

    keys = jwks.get("keys", []) if isinstance(jwks, dict) else []
    jwk = next((item for item in keys if item.get("kid") == kid), None)
    if jwk is None:
        raise GoogleOIDCError("Google ID token key was not found.")

    public_key = _load_rsa_public_key_from_jwk(jwk)
    public_key.verify(signature, ".".join(id_token.split(".")[:2]).encode("ascii"), padding.PKCS1v15(), hashes.SHA256())

    current_time = now or datetime.now(timezone.utc)
    issuer = payload.get("iss")
    if issuer not in GOOGLE_ISSUERS:
        raise GoogleOIDCError("Google issuer validation failed.")

    audience = payload.get("aud")
    client_id = google_client_id()
    if isinstance(audience, list):
        if client_id not in audience:
            raise GoogleOIDCError("Google audience validation failed.")
    elif audience != client_id:
        raise GoogleOIDCError("Google audience validation failed.")

    if payload.get("nonce") != nonce:
        raise GoogleOIDCError("Google nonce validation failed.")

    email_verified = payload.get("email_verified")
    if isinstance(email_verified, str):
        email_verified = email_verified.lower() == "true"
    if not bool(email_verified):
        raise GoogleOIDCError("Google email must be verified.")

    subject = str(payload.get("sub") or "").strip()
    if not subject:
        raise GoogleOIDCError("Google subject claim is required.")

    expiration = payload.get("exp")
    issued_at = payload.get("iat")
    if expiration is None or int(expiration) <= int(current_time.timestamp()):
        raise GoogleOIDCError("Google ID token has expired.")
    if issued_at is not None and int(issued_at) - 300 > int(current_time.timestamp()):
        raise GoogleOIDCError("Google ID token was issued in the future.")

    return payload


def subject_fingerprint(provider_subject: str) -> str:
    return hashlib.sha256(provider_subject.encode("utf-8")).hexdigest()
