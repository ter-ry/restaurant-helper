"""Clover-sourced Owner Reports (#262).

Used by ``reporting.build_report`` only when Clover is the sole active POS for the location. It reuses the public
interfaces of the Daily Close engines (``clover_sales.clover_sales_for_day`` and
``clover_usage.clover_usage_for_day``) once per business day and aggregates them over the requested window, so
Reports and Daily Close can never disagree on the same data. Read-only; nothing here writes or calls Clover.

Rules (owner decision on #262, same as Daily Close):
- A figure Flowtally cannot verify is ``None`` ("unavailable") and carries a reason. It is never zero and never
  gross-as-net.
- If any in-window order was excluded for uncertainty (refund, incomplete evidence, review), the headline money
  figures are unavailable (``sales.status == "partial"``); the verified-orders-only subtotal is exposed
  separately under ``sales.verified`` so the owner can still see what is solid.
- No stored orders for the whole window is "unavailable", not a $0 day.
- Refund amounts are not netted (Clover refund tax/tip semantics are unverified, #166): the amount is unavailable
  and the number of orders with a refund is reported instead.
- Usage / food cost come from the signed consumption ledger and are available only when every day in the window is
  complete. Physical-count usage variance is not provided for Clover.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from .clover_sales import CloverDaySales, clover_sales_for_day
from .clover_usage import clover_usage_for_day

CENT = Decimal("0.01")
MAX_WINDOW_DAYS = 62
SOURCE = "clover_orders"
# Sales exceptions that do not make the window's money figures doubtful: nothing was paid (cancelled / not yet
# paid), or the marker is a per-order "unavailable" flag handled separately.
_NON_BLOCKING_REASONS = {"cancelled", "not_fully_paid", "net_sales_unavailable", "cash_tender_unavailable"}
_REFUND_REASONS = {"refund_present", "refunded_or_refund_unverified"}
_REASON_TEXT = {
    "refund_present": "has a refund Flowtally cannot net off",
    "refunded_or_refund_unverified": "was refunded or the refund is not verified",
    "incomplete_evidence": "has incomplete payment or line evidence",
    "needs_review": "needs review",
    "missing_close_time": "has no close time",
}


def _dollars(cents: int | None) -> float | None:
    return None if cents is None else float((Decimal(cents) / Decimal(100)).quantize(CENT))


def _days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def location_uses_clover(location) -> bool:
    """True only when Clover is the sole active POS for the location (one provider per location)."""
    from .pos_provider import PosProvider, other_active_provider

    return (
        other_active_provider(location.id, location.organization_id, PosProvider.SQUARE) == PosProvider.CLOVER
        and other_active_provider(location.id, location.organization_id, PosProvider.CLOVER) is None
    )


def _add(total: int | None, part: int | None) -> int | None:
    return None if total is None or part is None else total + part


def clover_period(location, start: date, end: date, *, today: date | None = None) -> dict[str, Any]:
    """Aggregate Clover sales and ledger usage over ``[start, end]`` (location business days)."""
    if (end - start).days + 1 > MAX_WINDOW_DAYS:
        return {"status": "unavailable", "reason": f"Choose a period of {MAX_WINDOW_DAYS} days or fewer for Clover reports.", "orderCount": 0,
                "excluded": [], "refundOrders": 0, "net": None, "tax": None, "tips": None, "verified": None, "includesToday": False,
                "usage": {"available": False, "costCents": None, "foodCostPercent": None, "rows": [], "menu": {}, "exceptions": []}}

    order_count = 0
    net: int | None = 0
    tax: int | None = 0
    tips: int | None = 0
    exceptions: list[dict[str, Any]] = []
    usage_days: list[dict[str, Any]] = []
    for day in _days(start, end):
        sales: CloverDaySales = clover_sales_for_day(location, day)
        order_count += sales.order_count
        net, tax, tips = _add(net, sales.net_sales_cents), _add(tax, sales.tax_cents), _add(tips, sales.tips_cents)
        exceptions.extend({**e, "date": day.isoformat()} for e in sales.exceptions)
        usage_days.append(clover_usage_for_day(location, day, net_sales_cents=sales.net_sales_cents))

    excluded = [e for e in exceptions if e["reason"] not in _NON_BLOCKING_REASONS]
    refund_orders = len({e["orderId"] for e in excluded if e["reason"] in _REFUND_REASONS or e.get("hasRefund")})
    verified = {"orderCount": order_count, "netItemSales": _dollars(net), "tax": _dollars(tax), "tips": _dollars(tips)}
    includes_today = today is not None and start <= today <= end

    if order_count == 0 and not excluded:
        # Never a confident $0: either nothing is stored, or only cancelled / unpaid orders are.
        status = "unavailable"
        reason = (
            "No verified paid Clover orders are stored for this period. Fetch recent orders in Clover settings if sales are expected."
            if not exceptions
            else f"No verified paid Clover orders for this period ({len({e['orderId'] for e in exceptions})} cancelled or unpaid order(s) are stored)."
        )
    elif excluded:
        status = "partial"
        reason = f"{len({e['orderId'] for e in excluded})} Clover order(s) in this period are excluded because they have a refund, incomplete evidence or need review, so sales totals are not shown."
    elif net is None:
        status, reason = "unavailable", "Clover did not provide a tax breakdown for every paid order, so net sales are not shown."
    else:
        status, reason = "available", None

    usage_available = all(day["usageAvailable"] for day in usage_days)
    quantities: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    costs: dict[int, int] = defaultdict(int)
    meta: dict[int, tuple[str, str]] = {}
    menu: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    usage_exceptions: list[dict[str, Any]] = []
    for day, result in zip(_days(start, end), usage_days):
        for row in result["usage"]:
            quantities[row["inventoryItemId"]] += Decimal(row["quantity"])
            costs[row["inventoryItemId"]] += row["costCents"]
            meta[row["inventoryItemId"]] = (row["name"], row["unit"])
        for row in result["menuSales"]:
            menu[row["name"]] += Decimal(row["quantity"])
        usage_exceptions.extend({**e, "date": day.isoformat()} for e in result["exceptions"])
    cost_cents = sum(costs.values()) if usage_available else None
    food_cost_percent = None
    if status == "available" and cost_cents is not None and net:
        food_cost_percent = float((Decimal(cost_cents) * 100 / Decimal(net)).quantize(CENT))
    return {
        "status": status, "reason": reason, "orderCount": order_count, "excluded": excluded, "refundOrders": refund_orders,
        "net": net if status == "available" else None, "tax": tax if status == "available" else None,
        "tips": tips if status == "available" else None, "verified": verified, "includesToday": includes_today,
        "usage": {
            "available": usage_available, "costCents": cost_cents, "foodCostPercent": food_cost_percent,
            "rows": [{"inventoryItemId": i, "itemName": meta[i][0], "unit": meta[i][1], "quantity": float(quantities[i]), "costCents": costs[i]} for i in sorted(quantities)],
            "menu": {name: qty for name, qty in sorted(menu.items())},
            "exceptions": usage_exceptions,
        },
    }


def _total_collected(period: dict[str, Any]) -> float | None:
    if period["status"] != "available" or period["tips"] is None:
        return None
    return _dollars(period["net"] + period["tax"] + period["tips"])


def _menu_rows(period: dict[str, Any], prior: dict[str, Any] | None) -> tuple[list[dict[str, Any]], str | None]:
    usage = period["usage"]
    if usage is None or not usage["available"] or period["status"] != "available":
        return [], "Item sales need verified sales and complete inventory usage for the whole period."
    prior_menu = prior["usage"]["menu"] if prior and prior["usage"] and prior["usage"]["available"] and prior["status"] == "available" else None
    rows = []
    for name, quantity in usage["menu"].items():
        row = {"menuItemId": None, "name": name, "category": "", "quantity": float(quantity), "grossAmount": None, "discountAmount": None, "netAmount": None,
               "orderCount": None, "costAvailable": False, "currentCostPerSale": None, "estimatedGrossProfit": None, "estimatedFoodCostPercent": None, "estimatedGrossMarginPercent": None}
        if prior_menu is not None:
            before = prior_menu.get(name, Decimal("0"))
            delta = quantity - before
            row.update({"priorQuantity": float(before), "currentQuantity": float(quantity), "quantityDelta": float(delta),
                        "quantityDeltaPercent": float(delta / before * 100) if before else None})
        rows.append(row)
    return sorted(rows, key=lambda r: (-r["quantity"], r["name"])), None


def _attention(period: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if period["status"] != "available":
        items.append({"type": "clover_sales_unavailable", "severity": "warning" if period["status"] == "partial" else "info", "entityType": "clover", "title": "Clover sales totals unavailable", "detail": period["reason"], "href": "/app/square"})
    reasons = sorted({_REASON_TEXT.get(e["reason"], e["reason"]) for e in period["excluded"]})
    if period["excluded"]:
        items.append({"type": "clover_sales_exceptions", "severity": "warning", "entityType": "clover", "title": f"{len({e['orderId'] for e in period['excluded']})} Clover order(s) excluded", "detail": "Excluded because they are " + "; ".join(reasons) + ".", "href": "/app/square"})
    usage = period["usage"]
    by_reason = {e["reason"] for e in usage["exceptions"]} if usage else set()
    if "needs_mapping" in by_reason:
        items.append({"type": "unmapped_clover_sales", "severity": "warning", "entityType": "clover", "title": "Unmapped Clover items", "detail": "Map sold Clover items before relying on recipe usage.", "href": "/app/square"})
    if usage and not usage["available"] and by_reason - {"needs_mapping"}:
        items.append({"type": "clover_usage_unavailable", "severity": "info", "entityType": "clover", "title": "Usage and food cost unavailable", "detail": "Usage stays unavailable until every sold item is mapped, has a recipe and Clover inventory has been applied.", "href": "/app/square"})
    return items


def build_clover_report(*, location, view: str, start: date, end: date, prior_start: date | None, prior_end: date | None) -> dict[str, Any]:
    from .models import InventoryItem, InventoryMovement, PurchaseInvoice, StockCountSession
    from .pilot_api import _inventory_summary, _reorder_suggestion_for_item, _status_for_item
    from .reporting import _business_date_for_location, _period_delta, _purchasing, _stock_variance
    from .utils import serialize_inventory_movement

    organization_id = location.organization_id
    today = _business_date_for_location(location)
    period = clover_period(location, start, end, today=today)
    prior = clover_period(location, prior_start, prior_end, today=today) if prior_start and prior_end else None
    menu_rows, menu_reason = _menu_rows(period, prior)
    items = InventoryItem.query.filter_by(organization_id=organization_id, location_id=location.id, active=True).all()
    invoices = PurchaseInvoice.query.filter_by(organization_id=organization_id, location_id=location.id).all()
    sessions = StockCountSession.query.filter_by(organization_id=organization_id, location_id=location.id).all()
    statuses = [_status_for_item(item)["status"] for item in items]
    reorder = [row for row in (_reorder_suggestion_for_item(item) for item in items) if row]
    purchasing = _purchasing(invoices, start, end)
    variance = _stock_variance(sessions, start, end)
    usage = period["usage"]
    collected = _total_collected(period)
    available = period["status"] == "available"
    units = sum((row["quantity"] for row in menu_rows), 0.0) if menu_rows else None

    exceptions = [{"type": "reorder_now", "severity": "warning", "entityType": "inventory_item", "entityId": row["inventoryItemId"], "title": f"{row['inventoryItemName']} needs reordering", "href": "/app/reorder-plan"} for row in reorder if row["stockStatus"] in {"Out of stock", "Reorder now"}]
    exceptions.extend(_attention(period))
    if variance["missingCountEvidence"]:
        exceptions.append({"type": "missing_count_evidence", "severity": "info", "entityType": "stock_count", "title": "No completed count evidence", "href": "/app/stock-counts"})

    changes = None
    if view == "weekly":
        prior_collected = _total_collected(prior) if prior else None
        both = prior is not None and collected is not None and prior_collected is not None
        changes = {
            "sales": _period_delta(Decimal(str(collected)), Decimal(str(prior_collected))) if both else None,
            "orders": _period_delta(Decimal(period["orderCount"]), Decimal(prior["orderCount"])) if both else None,
            "purchaseSpend": _period_delta(Decimal(str(purchasing["spend"])), Decimal(str(_purchasing(invoices, prior_start, prior_end)["spend"]))) if prior else None,
            "menuMovers": [row for row in menu_rows if "quantityDelta" in row],
        }

    return {
        "provider": "clover",
        "scope": {"organizationId": organization_id, "locationId": location.id, "locationName": location.name, "timezone": location.timezone},
        "period": {"view": view, "startDate": start.isoformat(), "endDate": end.isoformat(), "priorStartDate": prior_start.isoformat() if prior_start else None, "priorEndDate": prior_end.isoformat() if prior_end else None},
        "sales": {
            "currency": "CAD", "source": SOURCE, "provider": "clover", "status": period["status"], "available": available, "unavailableReason": period["reason"],
            "includesToday": period["includesToday"],
            # Clover does not give authoritative line gross / discount / refund amounts: unavailable, never zero.
            "grossItemSales": None, "discounts": None, "refunds": None, "cancelledOrderCount": None,
            "netItemSales": _dollars(period["net"]), "tax": _dollars(period["tax"]), "tips": _dollars(period["tips"]),
            "totalCollected": collected, "orderCount": period["orderCount"], "unitsSold": units if available else None,
            "excludedOrderCount": len({e["orderId"] for e in period["excluded"]}), "refundOrderCount": period["refundOrders"],
            "verified": period["verified"],
            "byMenuItem": menu_rows, "byMenuItemUnavailableReason": menu_reason, "unmappedLines": [],
        },
        "purchasing": purchasing,
        "inventory": {"summary": _inventory_summary(location.id), "statusCounts": {"inStock": statuses.count("In stock"), "lowStock": statuses.count("Low stock"), "reorderNow": statuses.count("Reorder now"), "outOfStock": statuses.count("Out of stock")}, "reorderNow": reorder, "recentMovements": [serialize_inventory_movement(m) for m in InventoryMovement.query.filter_by(organization_id=organization_id, location_id=location.id).order_by(InventoryMovement.created_at.desc()).limit(20).all()]},
        "costing": {
            "costReadySalesAmount": None, "totalMappedMenuSalesAmount": None, "costCoveragePercent": None,
            "estimatedFoodCostPercent": usage["foodCostPercent"],
            "usageAvailable": usage["available"], "usageCost": _dollars(usage["costCents"]),
            "unavailableReason": None if usage["foodCostPercent"] is not None else ("Net sales are unavailable." if not available or not period["net"] else "Usage cost is not complete for this period."),
        },
        "variance": variance,
        "usageVariance": {"valid": False, "message": "Physical usage variance is not available for Clover locations yet.", "rows": [], "theoreticalUsage": usage["rows"] if usage["available"] else []},
        "changes": changes,
        "exceptions": exceptions[:12],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
