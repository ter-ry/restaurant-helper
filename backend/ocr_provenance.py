"""Server-signed OCR provenance for purchase invoices (#169).

The OCR endpoint signs the amounts the document actually printed. A saved invoice stores them, so the receipt guard
compares reviewed line totals with what the *document* said, never with editable invoice totals.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from flask import current_app
from itsdangerous import BadSignature, URLSafeTimedSerializer

_SALT = "flowtally-ocr-provenance-v1"
MAX_AGE_SECONDS = 7 * 24 * 3600
CENT = Decimal("0.01")


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_SALT)


def _printed(field: dict[str, Any] | None) -> str | None:
    """A printed amount only: missing or inferred figures (needsReview) are unknown, never zero."""
    if not field or field.get("needsReview") or float(field.get("confidence") or 0) <= 0:
        return None
    value = field.get("value")
    if value in (None, ""):
        return None
    try:
        return str(Decimal(str(value)).quantize(CENT))
    except Exception:
        return None


def sign_provenance(parsed: dict[str, Any], organization_id: int, location_id: int) -> str:
    fields = parsed.get("fields") or {}
    data = {
        "org": organization_id,
        "loc": location_id,
        "subtotal": _printed(fields.get("subtotal")),
        "tax": _printed(fields.get("tax")),
        "total": _printed(fields.get("total")),
    }
    return _serializer().dumps(data)


def verify_provenance(token: str, organization_id: int, location_id: int) -> dict[str, Decimal | None] | None:
    try:
        data = _serializer().loads(token, max_age=MAX_AGE_SECONDS)
    except BadSignature:
        return None
    if not isinstance(data, dict) or data.get("org") != organization_id or data.get("loc") != location_id:
        return None
    return {key: (Decimal(data[key]) if data.get(key) is not None else None) for key in ("subtotal", "tax", "total")}


def expected_line_amount(subtotal: Decimal | None, tax: Decimal | None, total: Decimal | None) -> Decimal | None:
    """Amount the reviewed lines must add up to: printed subtotal, else printed total less printed tax."""
    if subtotal is not None and subtotal > 0:
        return subtotal
    if total is not None and total > 0:
        return total - (tax or Decimal("0"))
    return None
