"""Read-only Clover shadow-order normalization and retrieval.

This module intentionally never creates provider orders or inventory movements.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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
        return datetime.fromtimestamp(float(value) / 1000, tz=timezone.utc)
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


def _expanded(value: Any) -> tuple[list[Mapping[str, Any]], bool]:
    """Return expanded elements and whether the provider says the collection is complete."""
    if value is None:
        return [], False
    if isinstance(value, list):
        return [item for item in value if isinstance(item, Mapping)], True
    if not isinstance(value, Mapping):
        return [], False
    values = _elements(value)
    complete = not bool(value.get("hasMore") or value.get("more") or value.get("next"))
    total = value.get("total")
    try:
        if total is not None and int(total) > len(values):
            complete = False
    except (TypeError, ValueError):
        complete = False
    return values, complete


def _id(value: Any) -> str:
    if isinstance(value, Mapping):
        return _text(value.get("id") or value.get("uuid"))
    return _text(value)


def _safe_line(raw: Mapping[str, Any]) -> dict[str, Any]:
    item = raw.get("item") if isinstance(raw.get("item"), Mapping) else {}
    return {
        "id": _id(raw),
        "itemId": _id(item) or _text(raw.get("itemId")),
        "itemGroupId": _id(item.get("itemGroup")) or None,
        "name": _text(raw.get("name") or item.get("name")),
        "quantity": str(_decimal(raw.get("quantity"))),
        "price": int(_decimal(raw.get("price"))) if raw.get("price") is not None else None,
        "state": _text(raw.get("state") or raw.get("status")),
        "modificationIds": [_id(value) for value in _elements(raw.get("modifications")) if _id(value)],
    }


def _safe_order(raw: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": _id(raw),
        "state": _text(raw.get("state") or raw.get("status")),
        "paymentState": _text(raw.get("paymentState") or raw.get("payment_state")),
        "total": int(_decimal(raw.get("total"))) if raw.get("total") is not None else None,
        "unpaidBalance": int(_decimal(raw.get("unpaidBalance"))) if raw.get("unpaidBalance") is not None else None,
        "currency": _text(raw.get("currency") or "CAD") or "CAD",
        "createdTime": raw.get("createdTime") or raw.get("clientCreatedTime"),
        "modifiedTime": raw.get("modifiedTime"),
        "closedTime": raw.get("closedTime"),
        "deletedTime": raw.get("deletedTime"),
        "payments": [
            {"id": _id(value), "amount": int(_decimal(value.get("amount"))), "result": _text(value.get("result") or value.get("state"))}
            for value in _elements(raw.get("payments"))
        ],
        "refunds": [{"id": _id(value), "amount": int(_decimal(value.get("amount")))} for value in _elements(raw.get("refunds"))],
        "lineItems": [_safe_line(value) for value in _elements(raw.get("lineItems") or raw.get("line_items"))],
    }


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
    payment_status: str
    normalized_status: str
    potentially_eligible: bool
    requires_review: bool
    incomplete: bool
    created_at: datetime | None
    modified_at: datetime | None
    closed_at: datetime | None
    total_cents: int | None
    currency: str
    lines: tuple[CloverShadowLine, ...]
    raw: Mapping[str, Any]


def _payment_totals(payments: list[Mapping[str, Any]]) -> tuple[Decimal, bool, bool]:
    successful_results = {"SUCCESS", "PAID", "COMPLETED", "APPROVED", "CAPTURED"}
    failed_results = {"FAILED", "VOIDED", "DECLINED", "CANCELED", "CANCELLED", "REVERSED"}
    total = Decimal("0")
    unknown = False
    failed = False
    for payment in payments:
        result = _text(payment.get("result") or payment.get("state")).upper()
        amount = _decimal(payment.get("amount"))
        if result in failed_results:
            failed = True
        elif result in successful_results:
            total += amount
        else:
            unknown = True
    return total, unknown, failed


def classify_order(payload: Mapping[str, Any]) -> tuple[str, str, str, bool, bool]:
    provider_status = _text(payload.get("state") or payload.get("status")).upper()
    provider_payment_state = _text(payload.get("paymentState") or payload.get("payment_state")).upper()
    refunds, refunds_complete = _expanded(payload.get("refunds")) if "refunds" in payload else ([], True)
    payments, payments_complete = _expanded(payload.get("payments"))
    total = _decimal(payload.get("total"))
    paid, unknown_payment, failed_payment = _payment_totals(payments)
    unpaid_balance = _decimal(payload.get("unpaidBalance")) if payload.get("unpaidBalance") is not None else None
    deleted = bool(payload.get("deletedTime"))
    if deleted or provider_status in {"VOIDED", "CANCELLED", "CANCELED", "DELETED"}:
        return provider_status or "DELETED", provider_payment_state or "VOIDED", "cancelled", False, False
    if provider_payment_state in {"REFUNDED", "CREDITED", "PARTIALLY_REFUNDED"} or refunds or provider_status in {"REFUNDED", "PARTIALLY_REFUNDED"}:
        return provider_status or "REFUNDED", provider_payment_state or "REFUNDED", "refunded", False, True
    if provider_payment_state == "PAID":
        conflict = failed_payment or unknown_payment or not payments_complete or not payments or total <= 0
        conflict = conflict or (unpaid_balance is not None and unpaid_balance > 0)
        verified = not conflict and paid >= total
        return provider_status or "PAID", provider_payment_state, "paid" if verified else "review", verified, not verified
    if provider_payment_state in {"OPEN", "PARTIALLY_PAID"}:
        conflict = failed_payment or unknown_payment or (unpaid_balance is not None and unpaid_balance <= 0 and paid >= total)
        return provider_status or provider_payment_state, provider_payment_state, "review" if conflict else "pending", False, conflict or provider_payment_state == "PARTIALLY_PAID"
    # Backward-compatible fallback for older synthetic fixtures: state PAID is
    # accepted only when successful payment results prove the amount.
    if not provider_payment_state and provider_status in {"PAID", "COMPLETED", "CLOSED"}:
        conflict = failed_payment or unknown_payment or not payments_complete or not payments or total <= 0
        conflict = conflict or (unpaid_balance is not None and unpaid_balance > 0)
        verified = not conflict and paid >= total
        return provider_status, provider_payment_state or "UNKNOWN", "paid" if verified else "review", verified, not verified
    return provider_status or "UNKNOWN", provider_payment_state or "UNKNOWN", "review", False, True


def normalize_order(payload: Mapping[str, Any]) -> CloverShadowOrder:
    provider_id = _id(payload)
    if not provider_id:
        raise CloverRequestError("Clover order did not include an id.", code="clover_order_identity_missing")
    line_payload, lines_complete = _expanded(payload.get("lineItems") or payload.get("line_items"))
    payment_payload, payments_complete = _expanded(payload.get("payments"))
    refund_payload, refunds_complete = _expanded(payload.get("refunds")) if "refunds" in payload else ([], True)
    provider_status, provider_payment_state, normalized_status, eligible, requires_review = classify_order(payload)
    lines: list[CloverShadowLine] = []
    nested_incomplete = not lines_complete or not payments_complete
    for line in line_payload:
        item = line.get("item") if isinstance(line.get("item"), Mapping) else {}
        line_id = _id(line)
        if not line_id:
            nested_incomplete = True
            continue
        modifications, modifications_complete = _expanded(line.get("modifications")) if "modifications" in line else ([], True)
        nested_incomplete = nested_incomplete or not modifications_complete
        lines.append(CloverShadowLine(
            provider_id=line_id,
            item_id=_id(item) or _text(line.get("itemId")),
            item_group_id=_id(item.get("itemGroup")) or None,
            name=_text(line.get("name") or item.get("name")) or "(Unnamed item)",
            quantity=_decimal(line.get("quantity")),
            unit_price_cents=int(_decimal(line.get("price"))) if line.get("price") is not None else None,
            modifiers=tuple(dict(value) for value in modifications),
            provider_status=_text(line.get("state") or line.get("status")),
            raw=_safe_line(line),
        ))
    incomplete = nested_incomplete or not refunds_complete
    if incomplete:
        eligible = False
        requires_review = True
        normalized_status = "review"
    return CloverShadowOrder(
        provider_id=provider_id,
        provider_status=provider_status,
        payment_status=provider_payment_state.lower() if provider_payment_state else ("refunded" if refund_payload else "unknown"),
        normalized_status=normalized_status,
        potentially_eligible=eligible,
        requires_review=requires_review,
        incomplete=incomplete,
        created_at=_timestamp(payload.get("createdTime") or payload.get("clientCreatedTime")),
        modified_at=_timestamp(payload.get("modifiedTime")),
        closed_at=_timestamp(payload.get("closedTime")),
        total_cents=int(_decimal(payload.get("total"))) if payload.get("total") is not None else None,
        currency=_text(payload.get("currency") or "CAD") or "CAD",
        lines=tuple(lines),
        raw=_safe_order(payload),
    )


class CloverOrderClient:
    """Bounded, sandbox-only order reader."""

    def __init__(self, *, merchant_id: str, token: str):
        self.merchant_id = merchant_id
        self.token = token

    def fetch_orders(
        self,
        *,
        start: datetime | None = None,
        end: datetime | None = None,
        max_pages: int = 5,
        page_size: int = 50,
    ) -> tuple[list[CloverShadowOrder], bool]:
        if max_pages < 1 or max_pages > 5 or page_size < 1 or page_size > 100:
            raise ValueError("Invalid Clover order retrieval bounds.")
        now = datetime.now(timezone.utc)
        start = start or now - timedelta(days=7)
        end = end or now
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError("Clover order bounds must be timezone-aware.")
        start = start.astimezone(timezone.utc)
        end = end.astimezone(timezone.utc)
        if start >= end or end - start > timedelta(days=90):
            raise ValueError("Clover order bounds must be a positive interval no longer than 90 days.")
        filter_values = [f"modifiedTime>={int(start.timestamp() * 1000)}", f"modifiedTime<={int(end.timestamp() * 1000)}"]
        orders: list[CloverShadowOrder] = []
        complete = True
        offset = 0
        for _ in range(max_pages):
            query_items = [
                ("limit", str(page_size)),
                ("offset", str(offset)),
                ("filter", filter_values[0]),
                ("filter", filter_values[1]),
                ("expand", "payments,lineItems,lineItems.modifications,discounts,refunds"),
            ]
            payload = clover_request("GET", f"/v3/merchants/{self.merchant_id}/orders?{urlencode(query_items)}", token=self.token)
            elements = _elements(payload)
            for raw in elements:
                order = normalize_order(raw)
                if order.modified_at and (order.modified_at < start or order.modified_at >= end):
                    continue
                orders.append(order)
            if len(elements) < page_size:
                break
            offset += len(elements)
        else:
            complete = False
        orders.sort(key=lambda value: value.modified_at or value.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return orders, complete
