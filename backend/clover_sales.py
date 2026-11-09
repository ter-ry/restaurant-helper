"""Clover sales figures for Daily Close (#167): net sales, cash tenders and delivery.

Pure functions over stored ``CloverShadowOrder`` rows. Nothing here writes data or talks to Clover.

Basis (owner decisions in docs/clover-daily-close-design.md):
- Only verified paid orders (``normalized_status == "paid"``, not ``requires_review``, not incomplete)
  are counted. Refunded / cancelled / review orders are returned as exceptions, never silently counted.
- Net sales = sum(successful payment ``amount`` - ``taxAmount``). Clover payment amounts are already
  after discounts and exclude tips (``tipAmount`` is separate); tips are reported separately.
  If any counted payment lacks an explicit ``taxAmount`` the figure is ``None`` (unavailable), never gross.
- Expected cash = verified cash-tender payments (amount + tip). If any counted payment lacks a tender
  identifier the cash figure is ``None`` (unavailable).
Assumption about Clover's amount/tip semantics is exercised only by fixtures; it needs #166 Sandbox evidence.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

SUCCESS_RESULTS = {"SUCCESS", "PAID", "COMPLETED", "APPROVED", "CAPTURED"}
CASH_TENDER_KEY = "com.clover.tender.cash"


def business_day_window(business_date: date, tz_name: str | None) -> tuple[datetime, datetime]:
    try:
        tz = ZoneInfo(tz_name or "America/Toronto")
    except ZoneInfoNotFoundError:
        tz = timezone.utc
    start = datetime(business_date.year, business_date.month, business_date.day, tzinfo=tz)
    end = datetime.combine(business_date + timedelta(days=1), datetime.min.time(), tzinfo=tz)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


@dataclass
class OrderFinancials:
    order_id: Any
    net_cents: int | None
    tax_cents: int | None
    tip_cents: int | None
    cash_cents: int | None
    delivery: bool


@dataclass
class CloverDaySales:
    order_count: int = 0
    net_sales_cents: int | None = 0
    tax_cents: int | None = 0
    tips_cents: int | None = 0
    cash_expected_cents: int | None = 0
    delivery_order_count: int = 0
    delivery_net_cents: int | None = 0
    exceptions: list[dict[str, Any]] = field(default_factory=list)

    @property
    def net_sales_available(self) -> bool:
        return self.net_sales_cents is not None

    @property
    def cash_available(self) -> bool:
        return self.cash_expected_cents is not None

    def as_dict(self) -> dict[str, Any]:
        return {
            "provider": "clover",
            "orderCount": self.order_count,
            "netSalesCents": self.net_sales_cents,
            "netSalesAvailable": self.net_sales_available,
            "taxCents": self.tax_cents,
            "tipsCents": self.tips_cents,
            "cashExpectedCents": self.cash_expected_cents,
            "cashReconciliationAvailable": self.cash_available,
            "deliveryOrderCount": self.delivery_order_count,
            "deliveryNetCents": self.delivery_net_cents,
            "exceptions": list(self.exceptions),
        }


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


UNCERTAINTY_FLAGS = ("incomplete", "lineItemsIncomplete", "financialIncomplete", "refundsUnverified", "paymentStateConflict")


def uncertainty_reason(raw: Mapping[str, Any]) -> str | None:
    """Why a stored order cannot be trusted for sales, or None. Fails closed on every known marker.

    Refunds: any refund record (partial or full) excludes the order. Clover refund tax/tip semantics are
    unverified (#166), so a refund is never netted off; the order is listed as an exception instead.
    """
    if any(raw.get(flag) for flag in UNCERTAINTY_FLAGS):
        return "incomplete_evidence"
    if raw.get("refunds"):
        return "refund_present"
    return None


def _has_successful_cash_payment(raw: Mapping[str, Any]) -> bool:
    """Whether the safe payload contains explicit successful cash evidence.

    This deliberately does not infer Clover's cancellation or settlement semantics. It only
    identifies the provider evidence that makes an excluded order relevant to cash completeness.
    """
    return any(
        isinstance(payment, Mapping)
        and str(payment.get("result") or "").upper() in SUCCESS_RESULTS
        and (not str(payment.get("tender") or "") or str(payment.get("tender")) == CASH_TENDER_KEY)
        for payment in (raw.get("payments") or [])
    )


def order_financials(order_id: Any, raw: Mapping[str, Any]) -> OrderFinancials:
    """Extract per-order figures from the stored safe payload; ``None`` fields mean unavailable."""
    payments = [p for p in raw.get("payments") or [] if isinstance(p, Mapping)]
    counted = [p for p in payments if str(p.get("result") or "").upper() in SUCCESS_RESULTS]
    delivery = "delivery" in str(raw.get("orderType") or "").lower()
    if uncertainty_reason(raw) or not counted:
        return OrderFinancials(order_id, None, None, None, None, delivery)

    taxes = [_int(p.get("taxAmount")) for p in counted]
    net = tax = None
    if all(t is not None for t in taxes):
        tax = sum(taxes)
        net = sum(int(p.get("amount") or 0) for p in counted) - tax
        if net < 0:
            net = tax = None
    # A missing tipAmount means "no tip supplied"; a tip that is present is excluded from net automatically.
    tips = [_int(p.get("tipAmount")) for p in counted]
    tip_total = sum(t or 0 for t in tips)
    tenders = [str(p.get("tender") or "") for p in counted]
    cash = None
    if all(tenders):
        cash = sum(int(p.get("amount") or 0) + (_int(p.get("tipAmount")) or 0) for p, t in zip(counted, tenders) if t == CASH_TENDER_KEY)
    return OrderFinancials(order_id, net, tax, tip_total, cash, delivery)


def _exception(order: Any, reason: str) -> dict[str, Any]:
    raw = getattr(order, "raw_payload_json", None) or {}
    has_refund = bool(raw.get("refunds")) or getattr(order, "normalized_status", "") == "refunded"
    # hasRefund records known refund evidence independently of the primary exclusion reason (e.g. incomplete evidence).
    return {"orderId": getattr(order, "id", None), "cloverOrderId": getattr(order, "clover_order_id", None), "reason": reason, "hasRefund": has_refund}


def summarize_orders(orders: Iterable[Any], window: tuple[datetime, datetime]) -> CloverDaySales:
    """Aggregate shadow orders closed inside ``window`` ([start, end) in UTC). Each order counts once."""
    start, end = window
    result = CloverDaySales()
    seen: set[Any] = set()
    for order in sorted(orders, key=lambda o: (getattr(o, "source_closed_at", None) or start, getattr(o, "id", 0) or 0)):
        closed = getattr(order, "source_closed_at", None)
        if closed is None:
            if getattr(order, "normalized_status", "") != "pending":
                result.exceptions.append(_exception(order, "missing_close_time"))
            continue
        if closed.tzinfo is None:
            closed = closed.replace(tzinfo=timezone.utc)
        if not (start <= closed < end):
            continue
        key = (getattr(order, "clover_connection_id", None), getattr(order, "clover_order_id", None)) if getattr(order, "clover_order_id", None) else getattr(order, "id", None)
        if key in seen:
            continue
        seen.add(key)
        status = getattr(order, "normalized_status", "")
        if status != "paid" or getattr(order, "requires_review", True):
            exception = _exception(order, {"refunded": "refunded_or_refund_unverified", "cancelled": "cancelled", "pending": "not_fully_paid"}.get(status, "needs_review"))
            if status in {"cancelled", "pending"} and _has_successful_cash_payment(getattr(order, "raw_payload_json", None) or {}):
                exception["cashEvidence"] = True
            result.exceptions.append(exception)
            continue
        raw = getattr(order, "raw_payload_json", None) or {}
        reason = uncertainty_reason(raw)
        if reason:
            result.exceptions.append(_exception(order, reason))
            continue
        fin = order_financials(getattr(order, "id", None), raw)
        result.order_count += 1
        if fin.net_cents is None:
            result.exceptions.append(_exception(order, "net_sales_unavailable"))
        for name, attr in (("net_sales_cents", fin.net_cents), ("tax_cents", fin.tax_cents), ("tips_cents", fin.tip_cents), ("cash_expected_cents", fin.cash_cents)):
            current = getattr(result, name)
            setattr(result, name, None if current is None or attr is None else current + attr)
        if fin.cash_cents is None:
            result.exceptions.append(_exception(order, "cash_tender_unavailable"))
        if fin.delivery:
            result.delivery_order_count += 1
            result.delivery_net_cents = None if result.delivery_net_cents is None or fin.net_cents is None else result.delivery_net_cents + fin.net_cents
    return result


def clover_sales_for_day(location, business_date: date) -> CloverDaySales:
    """Query shadow orders for one location/business day (location timezone) and summarize them.

    Tenant isolation: filtered on the location's organization AND location id (RLS also applies).
    """
    from .models import CloverShadowOrder

    window = business_day_window(business_date, getattr(location, "timezone", None))
    orders = CloverShadowOrder.query.filter(
        CloverShadowOrder.organization_id == location.organization_id,
        CloverShadowOrder.restaurant_location_id == location.id,
        CloverShadowOrder.source_closed_at >= window[0],
        CloverShadowOrder.source_closed_at < window[1],
    ).all()
    return summarize_orders(orders, window)
