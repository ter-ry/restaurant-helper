from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class RequestValidationError(ValueError):
    message: str
    errors: dict[str, str] = field(default_factory=dict)


def clean_email(value: Any) -> str:
    return str(value or "").strip().lower()


def parse_login_payload(payload: Any) -> tuple[str, str]:
    if not isinstance(payload, dict):
        raise RequestValidationError("Request body must be JSON.", {"body": "Expected a JSON object."})

    email = clean_email(payload.get("email"))
    password = str(payload.get("password") or "")
    errors: dict[str, str] = {}

    if not email:
        errors["email"] = "Email is required."
    elif "@" not in email or "." not in email.split("@")[-1]:
        errors["email"] = "Enter a valid email address."

    if not password:
        errors["password"] = "Password is required."

    if errors:
        raise RequestValidationError("Login validation failed.", errors)

    return email, password

