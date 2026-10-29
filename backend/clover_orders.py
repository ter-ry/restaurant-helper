"""Read-only Clover shadow-order normalization and retrieval.

This module intentionally never creates provider orders or inventory movements.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping
from urllib.parse import urlencode

from .clover import CloverRequestError, clover_request


def _text(value: Any) -> str:
    return str(value or "").strip()


def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _timestamp(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        parsed = datetime.fromtimestamp(float(value) / 1000, tz=timezone.utc)
        return parsed
    except (TypeError, ValueError, OverflowError):
        return None


def _elements(value: Any) -> list[Mapping[str, Any]]:
    if isinstance(value, Mapping):
        values = value.get("elements")
        if values is None:
            values = value.get("data")
        return [item for item in values or [] if isinstance(item, Mapping)]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, Mapping)]
    return []


def _id(value: Any) -> str:
    if isinstance(value, Mapping):
        return _text(value.get("id") or value.get("uuid"))
    return _text(value)


@dataclass(frozen=True)
class CloverShadowLine:
    provider_id: str
    item_id: str
    item_group_id: str | None
    name: str
    quantity: Decimal
    unit_price_cents: int | None
    modifiers: tuple[dict[str, Any], ...]
    provider_status: str
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class CloverShadowOrder:
    provider_id: str
    provider_status: str
    normalized_status: str
    payment_status: str
    potentially_eligible: bool
    requires_review: bool
    created_at: datetime | None
    modified_at: datetime | None
    closed_at: datetime | None
    total_cents: int | None
    currency: str
    lines: tuple[CloverShadowLine, ...]
    raw: Mapping[str, Any]


def classify_order(payload: Mapping[str, Any]) -> tuple[str, str, bool, bool]:
    provider_status = _text(payload.get("state") or payload.get("status")).upper()
    deleted = bool(payload.get("deletedTime"))
    refunds = _elements(payload.get("refunds"))
    payments = _elements(payload.get("payments"))
    total = _decimal(payload.get("total"))
    paid = sum((_decimal(payment.get("amount")) for payment in payments), Decimal("0"))
    if deleted or provider_status in {"VOIDED", "CANCELLED", "CANCELED", "DELETED"}:
        return provider_status or "DELETED", "cancelled", False, False
    if refunds or provider_status in {"REFUNDED", "PARTIALLY_REFUNDED"}:
        return provider_status or "REFUNDED", "refunded", False, True
    if provider_status in {"PAID", "CLOSED", "LOCKED", "COMPLETED"} or (total > 0 and paid >= total):
        return provider_status or "PAID", "paid", True, False
    if provider_status in {"OPEN", "PENDING", "UNPAID", "PAYMENT_PENDING"}:
        return provider_status or "PENDING", "pending", False, False
    return provider_status or "UNKNOWN", "review", False, True


def normalize_order(payload: Mapping[str, Any]) -> CloverShadowOrder:
    provider_id = _id(payload)
    if not provider_id:
        raise CloverRequestError("Clover order did not include an id.", code="clover_order_identity_missing")
    provider_status, normalized_status, eligible, requires_review = classify_order(payload)
    lines_payload = _elements(payload.get("lineItems") or payload.get("line_items"))
    lines: list[CloverShadowLine] = []
    for line in lines_payload:
        item = line.get("item") if isinstance(line.get("item"), Mapping) else {}
        item_id = _id(item) or _text(line.get("itemId"))
        line_id = _id(line)
        if not line_id:
            continue
        modifiers = tuple(dict(value) for value in _elements(line.get("modifications")))
        lines.append(
            CloverShadowLine(
                provider_id=line_id,
                item_id=item_id,
                item_group_id=_id(item.get("itemGroup")) or None,
                name=_text(line.get("name") or item.get("name")) or "(Unnamed item)",
                quantity=_decimal(line.get("quantity") or 0),
                unit_price_cents=int(_decimal(line.get("price"))) if line.get("price") is not None else None,
                modifiers=modifiers,
                provider_status=_text(line.get("state") or line.get("status")),
                raw=dict(line),
            )
        )
    return CloverShadowOrder(
        provider_id=provider_id,
        provider_status=provider_status,
        normalized_status=normalized_status,
        payment_status="paid" if eligible else ("refunded" if requires_review and _elements(payload.get("refunds")) else "unpaid"),
        potentially_eligible=eligible,
        requires_review=requires_review,
        created_at=_timestamp(payload.get("createdTime") or payload.get("clientCreatedTime")),
        modified_at=_timestamp(payload.get("modifiedTime")),
        closed_at=_timestamp(payload.get("closedTime")),
        total_cents=int(_decimal(payload.get("total"))) if payload.get("total") is not None else None,
        currency=_text(payload.get("currency") or "CAD") or "CAD",
        lines=tuple(lines),
        raw=dict(payload),
    )


class CloverOrderClient:
    """Bounded, sandbox-only order reader."""

    def __init__(self, *, merchant_id: str, token: str):
        self.merchant_id = merchant_id
        self.token = token

    def fetch_orders(self, *, start: datetime | None = None, end: datetime | None = None, max_pages: int = 5, page_size: int = 50) -> tuple[list[CloverShadowOrder], bool]:
        if max_pages < 1 or page_size < 1 or page_size > 100:
            raise ValueError("Invalid Clover order retrieval bounds.")
        orders: list[CloverShadowOrder] = []
        complete = True
        offset = 0
        for _ in range(max_pages):
            query = {"limit": str(page_size), "offset": str(offset), "expand": "payments,lineItems,lineItems.modifications,discounts,refunds"}
            payload = clover_request(
                "GET",
                f"/v3/merchants/{self.merchant_id}/orders?{urlencode(query)}",
                token=self.token,
            )
            elements = _elements(payload)
            for raw in elements:
                order = normalize_order(raw)
                if start and order.modified_at and order.modified_at < start:
                    continue
                if end and order.modified_at and order.modified_at >= end:
                    continue
                orders.append(order)
            if len(elements) < page_size:
                break
            offset += len(elements)
        else:
            complete = False
        return orders, complete
