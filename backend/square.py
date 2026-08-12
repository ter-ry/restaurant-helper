from __future__ import annotations

import base64
import hashlib
import hmac
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from flask import current_app


class SquareSecurityError(RuntimeError):
    pass


def square_enabled() -> bool:
    return bool(current_app.config.get("SQUARE_ENABLED"))


def square_environment() -> str:
    return str(current_app.config.get("SQUARE_ENVIRONMENT") or "sandbox").strip().lower()


def square_notification_signature(raw_body: bytes | str, notification_url: str, signature_key: str) -> str:
    if isinstance(raw_body, str):
        raw_body = raw_body.encode("utf-8")
    decoded_key = _decode_signature_key(signature_key)
    digest = hmac.new(decoded_key, notification_url.encode("utf-8") + raw_body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def verify_square_webhook_signature(*, raw_body: bytes | str, notification_url: str, signature_header: str, signature_key: str) -> bool:
    expected = square_notification_signature(raw_body, notification_url, signature_key)
    return hmac.compare_digest(expected, signature_header)


def _decode_signature_key(signature_key: str) -> bytes:
    signature_key = signature_key.strip()
    if not signature_key:
        raise SquareSecurityError("Square signature key is required.")
    try:
        decoded = base64.b64decode(signature_key, validate=True)
        if decoded:
            return decoded
    except Exception:
        pass
    return signature_key.encode("utf-8")


def _integration_fernet() -> Fernet:
    key = str(current_app.config.get("INTEGRATION_ENCRYPTION_KEY") or "").strip()
    if not key:
        raise SquareSecurityError("INTEGRATION_ENCRYPTION_KEY is required when Square is enabled.")
    try:
        return Fernet(key.encode("utf-8"))
    except Exception as exc:
        raise SquareSecurityError("INTEGRATION_ENCRYPTION_KEY must be a valid Fernet key.") from exc


def encrypt_square_secret(value: str) -> str:
    if not value:
        return ""
    return _integration_fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_square_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _integration_fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise SquareSecurityError("Stored Square secret could not be decrypted.") from exc

