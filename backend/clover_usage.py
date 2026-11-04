"""Clover ingredient usage, food cost and menu sales for Daily Close (#167).

Reads the recorded consumption ledger (``applied_quantity`` x ``unit_cost_snapshot``) instead of
recomputing from recipes, so figures reconcile to the inventory movement ledger. Read-only.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from .models import (
    CloverShadowOrder,
    CloverShadowOrderLine,
    CloverShadowOrderLineInventoryConsumption,
    InventoryItem,
)

CENT = Decimal("0.01")


def _window(business_date: date, tz_name: str | None) -> tuple[datetime, datetime]:
    """[start, end) UTC bounds of the business day in the location timezone."""
    try:
        tz = ZoneInfo(tz_name or "America/Toronto")
    except ZoneInfoNotFoundError:
        tz = timezone.utc
    start = datetime(business_date.year, business_date.month, business_date.day, tzinfo=tz)
    end = datetime.combine(business_date + timedelta(days=1), datetime.min.time(), tzinfo=tz)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


UNCERTAINTY_FLAGS = ("incomplete", "lineItemsIncomplete", "financialIncomplete", "refundsUnverified", "paymentStateConflict")


def _order_problem(order) -> str | None:
    """Why an in-window order cannot contribute trusted usage, or None if it is a clean verified sale."""
    raw = order.raw_payload_json or {}
    if any(raw.get(flag) for flag in UNCERTAINTY_FLAGS):
        return "incomplete_evidence"
    if raw.get("refunds"):
        return "refund_present"
    if order.normalized_status != "paid" or order.requires_review:
        return "cancelled" if order.normalized_status == "cancelled" else f"not_counted_{order.normalized_status or 'review'}"
    return None


def clover_usage_for_day(location, business_date: date, *, net_sales_cents: int | None = None) -> dict[str, Any]:
    """Ingredient usage / food cost for one business day.

    ``net_sales_cents`` comes from the Clover sales summary; ``None`` (unavailable) suppresses food-cost %.
    Usage is reported *available* only when every counted line is mapped and every recipe ingredient of
    that line has a consumption-ledger row with the expected quantity and a cost snapshot, and no
    in-window order was excluded for uncertainty. Otherwise rows are returned for inspection but
    ``usageAvailable`` is False and cost / food-cost % are None (never a partial figure labelled complete).
    """
    window = _window(business_date, getattr(location, "timezone", None))
    orders = CloverShadowOrder.query.filter(
        CloverShadowOrder.organization_id == location.organization_id,
        CloverShadowOrder.restaurant_location_id == location.id,
        CloverShadowOrder.source_closed_at >= window[0],
        CloverShadowOrder.source_closed_at < window[1],
    ).order_by(CloverShadowOrder.id.asc()).all()

    exceptions: list[dict[str, Any]] = []
    counted_ids: set[int] = set()
    seen: set = set()
    blocking_exclusion = False
    for order in orders:
        problem = _order_problem(order)
        if problem is None:
            key = (order.clover_connection_id, order.clover_order_id)
            if key not in seen:
                seen.add(key)
                counted_ids.add(order.id)
            continue
        exceptions.append({"orderId": order.id, "reason": problem})
        if problem != "cancelled":
            # An excluded order may still have moved stock, so the day's usage cannot be called complete.
            blocking_exclusion = True

    lines = CloverShadowOrderLine.query.filter(
        CloverShadowOrderLine.organization_id == location.organization_id,
        CloverShadowOrderLine.restaurant_location_id == location.id,
        CloverShadowOrderLine.shadow_order_id.in_(counted_ids or [-1]),
    ).order_by(CloverShadowOrderLine.id.asc()).all()
    ledgers = CloverShadowOrderLineInventoryConsumption.query.filter(
        CloverShadowOrderLineInventoryConsumption.organization_id == location.organization_id,
        CloverShadowOrderLineInventoryConsumption.location_id == location.id,
        CloverShadowOrderLineInventoryConsumption.clover_shadow_order_line_id.in_([l.id for l in lines] or [-1]),
    ).all()
    ledger_by_key = {(l.clover_shadow_order_line_id, l.inventory_item_id): l for l in ledgers}

    complete = not blocking_exclusion
    menu_sales: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    covered_lines: set[int] = set()
    for line in lines:
        if line.mapping_status != "mapped":
            complete = False
            exceptions.append({"orderId": line.shadow_order_id, "lineId": line.id, "name": line.name,
                               "reason": "needs_mapping" if line.mapping_status == "unmapped" else "line_needs_review"})
            continue
        ingredients = (line.recipe_preview_json or {}).get("ingredients")
        if not isinstance(ingredients, list) or not ingredients:
            complete = False
            exceptions.append({"orderId": line.shadow_order_id, "lineId": line.id, "name": line.name, "reason": "recipe_missing"})
            continue
        line_ok = True
        for ingredient in ingredients:
            try:
                item_id = int(ingredient.get("inventoryItemId"))
                expected = Decimal(str(ingredient.get("quantity")))
            except (TypeError, ValueError, ArithmeticError):
                line_ok = False
                continue
            ledger = ledger_by_key.get((line.id, item_id))
            if ledger is None or ledger.unit_cost_snapshot is None or Decimal(str(ledger.applied_quantity or 0)) != expected:
                line_ok = False
        if line_ok:
            covered_lines.add(line.id)
            name = (line.recipe_preview_json or {}).get("flowtallyMenuItemName") or line.name
            menu_sales[name] += Decimal(str(line.quantity or 0))
        else:
            complete = False
            exceptions.append({"orderId": line.shadow_order_id, "lineId": line.id, "name": line.name, "reason": "inventory_not_applied"})

    ingredient_qty: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    ingredient_cost: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for ledger in ledgers:
        qty = Decimal(str(ledger.applied_quantity or 0))
        ingredient_qty[ledger.inventory_item_id] += qty
        ingredient_cost[ledger.inventory_item_id] += qty * Decimal(str(ledger.unit_cost_snapshot or 0))

    names = {i.id: (i.name, i.stock_unit) for i in InventoryItem.query.filter(
        InventoryItem.organization_id == location.organization_id,
        InventoryItem.location_id == location.id,
        InventoryItem.id.in_(list(ingredient_qty) or [-1]),
    ).all()}
    usage_rows = [
        {"inventoryItemId": item_id, "name": names.get(item_id, ("", ""))[0], "unit": names.get(item_id, ("", ""))[1],
         "quantity": str(ingredient_qty[item_id]), "costCents": int((ingredient_cost[item_id] * 100).quantize(Decimal("1")))}
        for item_id in sorted(ingredient_qty)
    ]
    usage_cost_cents = sum(r["costCents"] for r in usage_rows) if complete else None
    food_cost_pct = None
    if usage_cost_cents is not None and net_sales_cents:
        food_cost_pct = float((Decimal(usage_cost_cents) * 100 / Decimal(net_sales_cents)).quantize(CENT))
    return {
        "provider": "clover",
        "exceptions": exceptions,
        "usage": usage_rows,
        "usageAvailable": complete,
        "usageCostCents": usage_cost_cents,
        "foodCostPercent": food_cost_pct,
        "menuSales": [{"name": n, "quantity": str(q)} for n, q in sorted(menu_sales.items())],
    }
