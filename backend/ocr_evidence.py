"""Durable, server-authoritative OCR printed-amount evidence (#169).

The OCR endpoint signs what the provider actually printed; invoice creation verifies that signature and stores the
amounts on the invoice. Receiving compares the *persisted lines* with those stored amounts, so editing the
editable subtotal/total, saving, reloading or reopening can never make an incomplete extraction receivable.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

TOKEN_SALT = "flowtally-ocr-evidence-v1"
TOKEN_MAX_AGE_SECONDS = 24 * 60 * 60
TOLERANCE = Decimal("0.01")
CENT = Decimal("0.01")


class EvidenceTokenError(ValueError):
    pass


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=TOKEN_SALT)


def text_digest(raw_text: str) -> str:
    return hashlib.sha256((raw_text or "").strip().encode("utf-8")).hexdigest()


def _printed(field: dict[str, Any] | None) -> str | None:
    """Only an amount the parser really read counts; missing/inferred fields are unknown, a printed 0.00 is kept."""
    if not isinstance(field, dict) or field.get("needsReview") or float(field.get("confidence") or 0) <= 0:
        return None
    value = field.get("value")
    if value in (None, ""):
        return None
    try:
        return str(Decimal(str(value)).quantize(CENT))
    except Exception:
        return None


def issue_token(parsed: dict[str, Any], *, organization_id: int, location_id: int, user_id: int) -> str:
    fields = parsed.get("fields") or {}
    return _serializer().dumps(
        {
            "o": organization_id,
            "l": location_id,
            "u": user_id,
            "sub": _printed(fields.get("subtotal")),
            "tax": _printed(fields.get("tax")),
            "tot": _printed(fields.get("total")),
            "txt": text_digest(parsed.get("rawText") or ""),
        }
    )


def verify_token(token: str, *, organization_id: int, location_id: int, extracted_text: str) -> dict[str, Decimal | None]:
    try:
        data = _serializer().loads(token, max_age=TOKEN_MAX_AGE_SECONDS)
    except SignatureExpired as exc:
        raise EvidenceTokenError("The OCR evidence has expired. Upload the invoice again.") from exc
    except BadSignature as exc:
        raise EvidenceTokenError("The OCR evidence is not valid. Upload the invoice again.") from exc
    if not isinstance(data, dict) or data.get("o") != organization_id or data.get("l") != location_id:
        raise EvidenceTokenError("The OCR evidence belongs to a different location.")
    if data.get("txt") != text_digest(extracted_text):
        raise EvidenceTokenError("The OCR evidence does not match the extracted invoice text.")
    return {key: (Decimal(data[name]) if data.get(name) is not None else None) for key, name in (("subtotal", "sub"), ("tax", "tax"), ("total", "tot"))}


def expected_line_amount(invoice) -> Decimal | None:
    if getattr(invoice, "ocr_evidence_captured_at", None) is None:
        return None
    if invoice.ocr_printed_subtotal is not None:
        return Decimal(invoice.ocr_printed_subtotal).quantize(CENT)
    if invoice.ocr_printed_total is not None:
        return (Decimal(invoice.ocr_printed_total) - Decimal(invoice.ocr_printed_tax or 0)).quantize(CENT)
    return None


def line_sum(invoice) -> Decimal:
    return sum((Decimal(line.line_total or 0) for line in invoice.lines), Decimal("0")).quantize(CENT)


def evaluate(invoice) -> dict[str, Any] | None:
    """Server verdict for an OCR invoice, or None when the invoice carries no OCR evidence."""
    if getattr(invoice, "ocr_evidence_captured_at", None) is None:
        return None
    expected = expected_line_amount(invoice)
    current = line_sum(invoice)
    result: dict[str, Any] = {"status": "unverified", "expectedAmount": expected, "lineTotal": current, "difference": None, "overridden": False}
    if expected is None:
        return result
    difference = (expected - current).quantize(CENT)
    result["difference"] = difference
    if abs(difference) <= TOLERANCE:
        result["status"] = "matched"
        return result
    overridden = invoice.ocr_override_at is not None and invoice.ocr_override_line_total is not None and abs(Decimal(invoice.ocr_override_line_total) - current) <= TOLERANCE
    result["status"] = "overridden" if overridden else "incomplete"
    result["overridden"] = overridden
    return result


def serialize(invoice) -> dict[str, Any] | None:
    verdict = evaluate(invoice)
    if verdict is None:
        return None
    return {
        "status": verdict["status"],
        "printedSubtotal": float(invoice.ocr_printed_subtotal) if invoice.ocr_printed_subtotal is not None else None,
        "printedTax": float(invoice.ocr_printed_tax) if invoice.ocr_printed_tax is not None else None,
        "printedTotal": float(invoice.ocr_printed_total) if invoice.ocr_printed_total is not None else None,
        "expectedAmount": float(verdict["expectedAmount"]) if verdict["expectedAmount"] is not None else None,
        "lineTotal": float(verdict["lineTotal"]),
        "difference": float(verdict["difference"]) if verdict["difference"] is not None else None,
        "override": {
            "reason": invoice.ocr_override_reason,
            "acknowledgedLineTotal": float(invoice.ocr_override_line_total),
            "byUserId": invoice.ocr_override_by_user_id,
            "at": invoice.ocr_override_at.isoformat() if invoice.ocr_override_at else None,
            "validForCurrentLines": verdict["overridden"],
        }
        if invoice.ocr_override_at is not None
        else None,
    }


def now() -> datetime:
    return datetime.now(timezone.utc)
