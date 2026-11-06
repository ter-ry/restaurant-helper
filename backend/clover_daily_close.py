"""Clover branch of the shared Daily Close snapshot (#222, slice 4 of #213 / #167).

Builds the same snapshot/usage/exceptions triple as the Square path in ``daily_close.py`` from the already
merged Clover pieces: ``clover_sales`` (#214, net sales / cash tenders / delivery) and ``clover_usage`` (#216,
ledger usage and food cost). Nothing here writes data, talks to Clover, or touches Square.

Rules (owner decisions in docs/clover-daily-close-design.md):
- A figure that cannot be verified is ``None`` and labelled unavailable. It is never zero, never gross-as-net.
- Expected cash is the verified Clover cash-tender total only. If any order that could hold cash evidence is
  excluded or incomplete, expected cash is unavailable (the staff count is still recorded, variance is not invented).
- Usage variance from physical counts is not provided for Clover yet; actual usage and variance stay ``None``.
- The Square snapshot keys are untouched: this module only runs when the location's active provider is Clover.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from .clover_sales import CloverDaySales, clover_sales_for_day
from .clover_usage import clover_usage_for_day
from .models import CloverConnection, CloverLocationMapping, InventoryMovement, InventoryWasteEvent
from .pos import CLOVER_SALE_SOURCE_TYPES

CENT = Decimal("0.01")
# Sales exceptions that do not put cash evidence in doubt: the order moved no cash (cancelled / never paid), or
# the exception is already a per-order "unavailable" marker on an order that was counted.
_CASH_NEUTRAL_REASONS = {"cancelled", "not_fully_paid", "net_sales_unavailable", "cash_tender_unavailable"}
_SALES_REASON_TEXT = {
    "refunded_or_refund_unverified": "refunded or refund not verified",
    "refund_present": "has a refund Flowtally cannot net off",
    "incomplete_evidence": "has incomplete payment or line evidence",
    "needs_review": "needs review",
    "missing_close_time": "has no close time",
}


def _dollars(cents: int | None) -> float | None:
    return None if cents is None else float((Decimal(cents) / Decimal(100)).quantize(CENT))


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def active_clover_connection(organization_id: int, location_id: int) -> CloverConnection | None:
    return (
        CloverConnection.query.join(CloverLocationMapping, CloverLocationMapping.clover_connection_id == CloverConnection.id)
        .filter(
            CloverLocationMapping.organization_id == organization_id,
            CloverLocationMapping.restaurant_location_id == location_id,
            CloverConnection.organization_id == organization_id,
            CloverConnection.status == "connected",
        )
        .order_by(CloverConnection.id.asc())
        .first()
    )


def _cash_reconciliation(sales: CloverDaySales) -> dict[str, Any]:
    review_orders = {e["orderId"] for e in sales.exceptions if e["reason"] not in _CASH_NEUTRAL_REASONS}
    reason = None
    expected_cents = sales.cash_expected_cents
    if review_orders:
        expected_cents = None
        reason = (
            f"Cash reconciliation unavailable: {len(review_orders)} Clover order(s) for this day need review, "
            "so the cash taken cannot be verified."
        )
    elif expected_cents is None:
        reason = "Cash reconciliation unavailable: Clover did not report the payment type for every paid order."
    cash: dict[str, Any] = {
        "status": "available" if expected_cents is not None else "unavailable",
        "mode": "clover_cash_tenders",
        "basis": "clover_cash_tenders",
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "expectedCash": _dollars(expected_cents),
        "openingFloat": None,
        "cashPayments": _dollars(expected_cents),
        "cashRefunds": None,
        "paidIn": None,
        "paidOut": None,
        "closedCash": None,
        "reason": reason,
        "reconnectRequired": False,
    }
    if reason:
        cash["expectedCashUnavailableReason"] = reason
    return cash


def _sales_summary(connection: CloverConnection | None, sales: CloverDaySales) -> dict[str, Any]:
    excluded = {e["orderId"] for e in sales.exceptions if e["reason"] not in {"net_sales_unavailable", "cash_tender_unavailable"}}
    return {
        "provider": "clover",
        "cloverStatus": connection.status if connection is not None else "Not connected",
        "locationMapped": connection is not None,
        "dataBasis": "fetched_clover_orders",
        "orders": sales.order_count,
        "netSales": _dollars(sales.net_sales_cents),
        "netSalesAvailable": sales.net_sales_available,
        "tax": _dollars(sales.tax_cents),
        "tips": _dollars(sales.tips_cents),
        "deliveryOrders": sales.delivery_order_count,
        "deliveryNetSales": _dollars(sales.delivery_net_cents),
        # Not derived from Clover data, so unavailable rather than zero.
        "grossSales": None,
        "discounts": None,
        "refunds": None,
        "cancelledOrders": None,
        "excludedOrders": len(excluded),
        "exceptions": [{"orderId": e["orderId"], "reason": e["reason"]} for e in sales.exceptions],
    }


def _usage_report(location, business_date: date, start_at: datetime, end_at: datetime, sales: CloverDaySales) -> tuple[dict[str, Any], dict[str, Any]]:
    cu = clover_usage_for_day(location, business_date, net_sales_cents=sales.net_sales_cents)
    units = {row["unit"] for row in cu["usage"] if row.get("unit")}
    rows = [
        {
            "inventoryItemId": row["inventoryItemId"],
            "inventoryItemName": row["name"],
            "unit": row["unit"],
            "theoreticalUsage": float(Decimal(row["quantity"])),
            "costCents": row["costCents"],
            "actualUsage": None,
            "discrepancy": None,
            "discrepancyPercent": None,
            "warnings": [] if cu["usageAvailable"] else ["Usage is incomplete for this day."],
        }
        for row in cu["usage"]
    ]
    unmapped = [
        {"name": e.get("name"), "orderId": e.get("orderId")} for e in cu["exceptions"] if e.get("reason") == "needs_mapping"
    ]
    usage = {
        "provider": "clover",
        "period": {"startAt": _iso(start_at), "endAt": _iso(end_at)},
        "coverage": {
            "totalSoldUnits": float(sum((Decimal(m["quantity"]) for m in cu["menuSales"]), Decimal("0"))),
            "unmappedVariationCount": len(unmapped),
        },
        # Quantities across kg / L / each are not one meaningful total, and physical-count variance is not
        # provided for Clover yet, so these stay unavailable.
        "totals": {"theoreticalUsage": None, "actualUsage": None, "discrepancy": None, "discrepancyPercent": None},
        "contributingMenuItems": [{"name": m["name"], "quantity": float(Decimal(m["quantity"]))} for m in cu["menuSales"]],
        "unmappedVariations": unmapped,
        "ingredientUsage": rows,
        "availability": {
            "usageAvailable": cu["usageAvailable"],
            "usageCostCents": cu["usageCostCents"],
            "foodCostPercent": cu["foodCostPercent"],
            "mixedUnits": len(units) > 1,
        },
        "exceptions": cu["exceptions"],
    }
    return usage, cu


def _movement_reconciliation(organization_id: int, location_id: int, start_at: datetime, end_at: datetime) -> dict[str, float]:
    waste = InventoryWasteEvent.query.filter(
        InventoryWasteEvent.organization_id == organization_id,
        InventoryWasteEvent.location_id == location_id,
        InventoryWasteEvent.occurred_at >= start_at,
        InventoryWasteEvent.occurred_at <= end_at,
    ).all()
    movements = InventoryMovement.query.filter(
        InventoryMovement.organization_id == organization_id,
        InventoryMovement.location_id == location_id,
        InventoryMovement.created_at >= start_at,
        InventoryMovement.created_at <= end_at,
    ).all()
    # Same exclusions as the Square path: POS consumption, receipts and count corrections are not "other adjustments".
    explained = {"inventory waste", "square sale consumption", "invoice receipt", "stock count reconciliation"} | CLOVER_SALE_SOURCE_TYPES
    return {
        "recordedWasteQuantity": float(sum((Decimal(str(e.quantity or 0)) for e in waste), Decimal("0"))),
        "recordedWasteCost": float(sum((Decimal(str(e.total_cost or 0)) for e in waste), Decimal("0")).quantize(CENT)),
        "otherAdjustmentQuantity": float(sum((Decimal(str(m.quantity_delta or 0)) for m in movements if m.source_type not in explained), Decimal("0"))),
        "physicalCountCorrectionQuantity": float(sum((Decimal(str(m.quantity_delta or 0)) for m in movements if m.source_type == "stock count reconciliation"), Decimal("0"))),
    }


def _messages(sales: CloverDaySales, cu: dict[str, Any], cash: dict[str, Any]) -> tuple[list[str], list[dict[str, Any]]]:
    exceptions: list[str] = []
    items: list[dict[str, Any]] = []

    excluded = [e for e in sales.exceptions if e["reason"] not in {"net_sales_unavailable", "cash_tender_unavailable", "cancelled", "not_fully_paid"}]
    if excluded:
        reasons = sorted({_SALES_REASON_TEXT.get(e["reason"], e["reason"]) for e in excluded})
        exceptions.append("Clover orders excluded from sales.")
        items.append({"type": "clover_sales_exceptions", "label": "Review sales", "title": f"{len({e['orderId'] for e in excluded})} Clover order(s) excluded from sales", "severity": "warning", "href": "/app/square", "detail": "Excluded because they are " + "; ".join(reasons) + "."})
    if any(e["reason"] == "net_sales_unavailable" for e in sales.exceptions):
        exceptions.append("Clover net sales unavailable.")
        items.append({"type": "clover_net_sales_unavailable", "label": "Review sales", "title": "Net sales unavailable", "severity": "warning", "href": "/app/square", "detail": "Clover did not provide a tax breakdown for every paid order, so net sales are not shown."})
    if not sales.order_count and not sales.exceptions:
        exceptions.append("No Clover orders are stored for this business date.")
        items.append({"type": "clover_no_orders", "label": "Review Clover", "title": "No Clover orders stored for this date", "severity": "info", "href": "/app/square", "detail": "Fetch recent orders in Clover settings if sales are expected."})

    by_reason: dict[str, int] = {}
    for e in cu["exceptions"]:
        by_reason[e["reason"]] = by_reason.get(e["reason"], 0) + 1
    if by_reason.get("needs_mapping"):
        exceptions.append("Sold Clover item unmapped.")
        items.append({"type": "unmapped_clover_sales", "label": "Review mappings", "title": "Unmapped Clover items", "severity": "warning", "href": "/app/square", "detail": "Map sold Clover items before relying on recipe usage."})
    if by_reason.get("recipe_missing") or by_reason.get("line_needs_review"):
        exceptions.append("Recipe or inventory mapping gaps exist.")
    if by_reason.get("cancelled_after_inventory_applied"):
        exceptions.append("Clover order cancelled after inventory was applied.")
        items.append({"type": "clover_cancelled_after_inventory", "title": "Cancelled order already used stock", "severity": "warning", "href": "/app/square", "label": "Review Clover", "detail": "Stock was deducted before the order was cancelled and is not restocked automatically, so usage and food cost stay unavailable until it is reviewed."})
    if by_reason.get("inventory_not_applied"):
        exceptions.append("Clover inventory has not been applied for some sold items.")
        items.append({"type": "clover_inventory_not_applied", "title": "Inventory not applied for some Clover sales", "severity": "info", "detail": "Usage and food cost stay unavailable until Clover inventory reconciliation has been run for these sales."})
    if cash.get("expectedCash") is None and cash.get("reason"):
        items.append({"type": "clover_cash_unavailable", "title": "Cash reconciliation unavailable", "severity": "info", "detail": cash["reason"]})
    return list(dict.fromkeys(exceptions)), items


def build_clover_snapshot(organization, location, business_date: date, *, start_at: datetime, end_at: datetime, inventory_value: float) -> tuple[dict[str, Any], dict[str, Any], list[str], None]:
    """Return ``(snapshot, usage, exceptions, None)``, the same shape as ``_daily_close_snapshot`` (no Square connection)."""
    connection = active_clover_connection(organization.id, location.id)
    sales = clover_sales_for_day(location, business_date)
    summary = _sales_summary(connection, sales)
    usage, cu = _usage_report(location, business_date, start_at, end_at, sales)
    cash = _cash_reconciliation(sales)
    exceptions, attention = _messages(sales, cu, cash)
    movement = _movement_reconciliation(organization.id, location.id, start_at, end_at)
    availability = usage["availability"]
    food_reason = None
    if availability["foodCostPercent"] is None:
        food_reason = "Net sales are unavailable." if not sales.net_sales_available or not sales.net_sales_cents else "Usage cost is not complete for this day."
    snapshot = {
        "provider": "clover",
        "healthStatus": "Ready with warnings" if (exceptions or attention) else "Ready",
        "inventoryValue": inventory_value,
        "sales": summary,
        "usage": {key: usage[key] for key in ("period", "coverage", "totals", "contributingMenuItems", "unmappedVariations", "ingredientUsage", "availability")},
        "foodCost": {
            "available": availability["foodCostPercent"] is not None,
            "usageCostCents": availability["usageCostCents"],
            "netSalesCents": sales.net_sales_cents,
            "percent": availability["foodCostPercent"],
            "unavailableReason": food_reason,
        },
        "variance": {"quantity": None, "percent": None, "value": None},
        "reconciliation": {"theoreticalPosUsage": None, "unexplainedVarianceQuantity": None, **movement},
        "cashReconciliation": cash,
        "attentionItems": attention,
        "manualReconciliation": {},
        "readyToFinalize": True,
    }
    return snapshot, usage, exceptions, None
