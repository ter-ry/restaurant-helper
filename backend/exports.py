"""Bookkeeping and audit exports (#315, owner decisions of 2026-11-27).

Pure builders used by thin routes in ``pilot_api``; the routes own authentication, the role/module gates
and tenant/location scoping.  Rules the owner approved:

* Bookkeeping purchase export: financially valid *received* invoices only.  Drafts, ready-to-receive
  invoices and voided originals are excluded, so a corrected invoice is never counted twice.  A received
  correction carries the number of the invoice it replaces and the void reason, preserving the lineage.
* Purchase history export: every status, including voided originals, with the full void/correction trail.
* Audit export: complete for the requested date range with explicit scope, cursor pagination and a
  completeness flag, never a silent truncation.
* Every text cell is neutralised against spreadsheet formula injection.
"""
from __future__ import annotations

import csv
import io
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import joinedload

from .models import AuditEvent, PurchaseInvoice
from .utils import isoformat, serialize_audit_event

RECEIVED_STATUS = "Completed"
VOIDED_STATUS = "Corrected"
MAX_RANGE_DAYS = 400
AUDIT_DEFAULT_PAGE = 500
AUDIT_MAX_PAGE = 1000

_FORMULA_LEADERS = ("=", "+", "-", "@", "\t", "\r", "\n")


class ExportRequestError(ValueError):
    pass


def csv_safe(value: Any) -> str:
    """Text cell safe to open in a spreadsheet: a leading formula character is neutralised with an apostrophe."""
    text = "" if value is None else str(value)
    if text.startswith(_FORMULA_LEADERS):
        return "'" + text
    return text


def money(value: Any) -> str:
    return format(Decimal(value or 0).quantize(Decimal("0.01")), "f")


def parse_date_range(raw_from: str | None, raw_to: str | None) -> tuple[date, date]:
    """Both bounds are required (explicit scope), inclusive, ISO dates, at most ``MAX_RANGE_DAYS`` apart."""
    if not raw_from or not raw_to:
        raise ExportRequestError("Both 'from' and 'to' dates (YYYY-MM-DD) are required.")
    try:
        start, end = date.fromisoformat(raw_from), date.fromisoformat(raw_to)
    except ValueError as exc:
        raise ExportRequestError("'from' and 'to' must be dates in YYYY-MM-DD format.") from exc
    if end < start:
        raise ExportRequestError("'to' must not be before 'from'.")
    if (end - start).days > MAX_RANGE_DAYS:
        raise ExportRequestError(f"Choose a date range of at most {MAX_RANGE_DAYS} days.")
    return start, end


def _csv_bytes(header: list[str], rows: list[list[str]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue()


_PURCHASE_HEADER = [
    "invoice_date", "supplier", "invoice_number", "status", "subtotal", "tax", "total", "line_total_sum",
    "ocr_total_override", "received_at", "corrects_invoice_number", "correction_reason",
]
_HISTORY_EXTRA = ["voided_at", "void_reason", "corrected_by_invoice_number", "created_at"]


def _query(location_id: int, start: date, end: date, statuses: set[str] | None):
    query = PurchaseInvoice.query.filter(
        PurchaseInvoice.location_id == location_id,
        PurchaseInvoice.invoice_date >= start,
        PurchaseInvoice.invoice_date <= end,
    )
    if statuses is not None:
        query = query.filter(PurchaseInvoice.status.in_(statuses))
    return query.options(joinedload(PurchaseInvoice.supplier)).order_by(PurchaseInvoice.invoice_date.asc(), PurchaseInvoice.id.asc())


def _number_map(invoices: list[PurchaseInvoice], location_id: int) -> dict[int, tuple[str, str]]:
    """invoice id -> (number, void reason) for lineage columns; the other side of a correction may sit outside the date range."""
    ids = {i.corrects_invoice_id for i in invoices if i.corrects_invoice_id} | {i.corrected_by_invoice_id for i in invoices if i.corrected_by_invoice_id}
    if not ids:
        return {}
    rows = PurchaseInvoice.query.filter(PurchaseInvoice.location_id == location_id, PurchaseInvoice.id.in_(ids)).with_entities(PurchaseInvoice.id, PurchaseInvoice.invoice_number, PurchaseInvoice.void_reason).all()
    return {row.id: (row.invoice_number, row.void_reason or "") for row in rows}


def _line_sums(invoice_ids: list[int]) -> dict[int, Decimal]:
    from .extensions import db
    from .models import PurchaseInvoiceLine

    if not invoice_ids:
        return {}
    rows = (
        db.session.query(PurchaseInvoiceLine.invoice_id, db.func.coalesce(db.func.sum(PurchaseInvoiceLine.line_total), 0))
        .filter(PurchaseInvoiceLine.invoice_id.in_(invoice_ids))
        .group_by(PurchaseInvoiceLine.invoice_id)
        .all()
    )
    return {invoice_id: Decimal(total) for invoice_id, total in rows}


def build_purchases_csv(location_id: int, start: date, end: date, *, history: bool) -> tuple[str, int]:
    """Return ``(csv_text, row_count)``.  ``history=False`` is the bookkeeping export (received invoices only)."""
    invoices = _query(location_id, start, end, None if history else {RECEIVED_STATUS}).all()
    numbers = _number_map(invoices, location_id)
    sums = _line_sums([i.id for i in invoices])
    rows: list[list[str]] = []
    for invoice in invoices:
        row = [
            invoice.invoice_date.isoformat(),
            csv_safe(invoice.supplier.name if invoice.supplier else ""),
            csv_safe(invoice.invoice_number),
            invoice.status,
            money(invoice.subtotal),
            money(invoice.tax),
            money(invoice.total_amount),
            money(sums.get(invoice.id, 0)),
            "yes" if invoice.ocr_override_at is not None else "no",
            isoformat(invoice.received_at) or "",
            csv_safe(numbers.get(invoice.corrects_invoice_id, ("", ""))[0] if invoice.corrects_invoice_id else ""),
            csv_safe(numbers.get(invoice.corrects_invoice_id, ("", ""))[1] if invoice.corrects_invoice_id else ""),
        ]
        if history:
            row += [
                isoformat(invoice.voided_at) or "",
                csv_safe(invoice.void_reason),
                csv_safe(numbers.get(invoice.corrected_by_invoice_id, ("", ""))[0] if invoice.corrected_by_invoice_id else ""),
                isoformat(invoice.created_at) or "",
            ]
        rows.append(row)
    return _csv_bytes(_PURCHASE_HEADER + (_HISTORY_EXTRA if history else []), rows), len(rows)


def _zone(timezone_name: str | None):
    try:
        return ZoneInfo(timezone_name or "America/Toronto")
    except ZoneInfoNotFoundError:
        return timezone.utc


def audit_page(
    organization_id: int, timezone_name: str | None, start: date, end: date, *, cursor: int | None, limit: int
) -> dict[str, Any]:
    """One page of audit events for the organization, oldest first, keyset-paginated on id.

    ``complete`` is true only when no events remain after this page; callers must follow ``nextCursor``.
    Day bounds are the location's business-day boundaries.
    """
    zone = _zone(timezone_name)
    lower = datetime.combine(start, time.min, tzinfo=zone).astimezone(timezone.utc)
    upper = datetime.combine(end + timedelta(days=1), time.min, tzinfo=zone).astimezone(timezone.utc)
    query = AuditEvent.query.filter(
        AuditEvent.organization_id == organization_id,
        AuditEvent.created_at >= lower,
        AuditEvent.created_at < upper,
    )
    if cursor is not None:
        query = query.filter(AuditEvent.id > cursor)
    events = query.order_by(AuditEvent.id.asc()).limit(limit + 1).all()
    has_more = len(events) > limit
    events = events[:limit]
    return {
        "events": [serialize_audit_event(event) for event in events],
        "scope": {"organizationId": organization_id, "from": start.isoformat(), "to": end.isoformat(), "timezone": zone.key if hasattr(zone, "key") else "UTC"},
        "count": len(events),
        "complete": not has_more,
        "nextCursor": events[-1].id if has_more and events else None,
    }


def audit_csv(events: list[dict[str, Any]]) -> str:
    import json

    header = ["id", "created_at", "event_type", "entity_type", "entity_id", "actor_user_id", "location_id", "request_id", "metadata"]
    rows = [
        [
            str(e["id"]), e["createdAt"] or "", csv_safe(e["eventType"]), csv_safe(e["entityType"]), csv_safe(e["entityId"]),
            "" if e["actorUserId"] is None else str(e["actorUserId"]), "" if e["locationId"] is None else str(e["locationId"]),
            csv_safe(e["requestId"]), csv_safe(json.dumps(e["metadata"], sort_keys=True, default=str)),
        ]
        for e in events
    ]
    return _csv_bytes(header, rows)
