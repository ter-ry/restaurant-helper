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


def clover_usage_for_day(location, business_date: date, *, net_sales_cents: int | None = None) -> dict[str, Any]:
    """``net_sales_cents`` comes from the Clover sales summary; ``None`` (unavailable) suppresses food-cost %."""
    window = _window(business_date, getattr(location, "timezone", None))
    orders = CloverShadowOrder.query.filter(
        CloverShadowOrder.organization_id == location.organization_id,
        CloverShadowOrder.restaurant_location_id == location.id,
        CloverShadowOrder.source_closed_at >= window[0],
        CloverShadowOrder.source_closed_at < window[1],
    ).all()
    counted = {
        o.id for o in orders
        if o.normalized_status == "paid" and not o.requires_review
    }
    # De-duplicate replays the same way sales does (first row per provider order id).
    seen: set = set()
    counted_ids: set[int] = set()
    for o in sorted(orders, key=lambda x: x.id):
        if o.id in counted and (o.clover_connection_id, o.clover_order_id) not in seen:
            seen.add((o.clover_connection_id, o.clover_order_id))
            counted_ids.add(o.id)

    lines = CloverShadowOrderLine.query.filter(
        CloverShadowOrderLine.organization_id == location.organization_id,
        CloverShadowOrderLine.restaurant_location_id == location.id,
        CloverShadowOrderLine.shadow_order_id.in_(counted_ids or [-1]),
    ).all()
    ledgers = CloverShadowOrderLineInventoryConsumption.query.filter(
        CloverShadowOrderLineInventoryConsumption.organization_id == location.organization_id,
        CloverShadowOrderLineInventoryConsumption.location_id == location.id,
        CloverShadowOrderLineInventoryConsumption.clover_shadow_order_line_id.in_([l.id for l in lines] or [-1]),
    ).all()
    line_order = {l.id: l.shadow_order_id for l in lines}
    exceptions: list[dict[str, Any]] = []
    for o in orders:
        if o.id not in counted and o.normalized_status != "pending":
            exceptions.append({"orderId": o.id, "reason": "not_counted_" + (o.normalized_status or "review")})

    ingredient_qty: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    ingredient_cost: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    cost_unavailable = False
    ordered_with_ledger: set[int] = set()
    for ledger in ledgers:
        ordered_with_ledger.add(line_order[ledger.clover_shadow_order_line_id])
        qty = Decimal(str(ledger.applied_quantity or 0))
        ingredient_qty[ledger.inventory_item_id] += qty
        if ledger.unit_cost_snapshot is None:
            if qty != 0:
                cost_unavailable = True
        else:
            ingredient_cost[ledger.inventory_item_id] += qty * Decimal(str(ledger.unit_cost_snapshot))

    menu_sales: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    orders_with_mapped_line: set[int] = set()
    for line in lines:
        if line.mapping_status == "mapped":
            orders_with_mapped_line.add(line.shadow_order_id)
            name = (line.recipe_preview_json or {}).get("flowtallyMenuItemName") or line.name
            menu_sales[name] += Decimal(str(line.quantity or 0))
        else:
            exceptions.append({"orderId": line.shadow_order_id, "lineId": line.id, "reason": "needs_mapping" if line.mapping_status == "unmapped" else "line_needs_review", "name": line.name})

    # A counted order with mapped lines but no applied ledger means inventory was not (yet) consumed:
    # usage cost is incomplete and must not be presented as complete.
    not_applied = sorted(orders_with_mapped_line - ordered_with_ledger)
    for order_id in not_applied:
        exceptions.append({"orderId": order_id, "reason": "inventory_not_applied"})
    usage_available = not cost_unavailable and not not_applied

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
    usage_cost_cents = sum(r["costCents"] for r in usage_rows) if usage_available else None
    food_cost_pct = None
    if usage_cost_cents is not None and net_sales_cents:  # None or 0 net -> no percentage
        food_cost_pct = float((Decimal(usage_cost_cents) * 100 / Decimal(net_sales_cents)).quantize(CENT))
    return {
        "provider": "clover",
        "exceptions": exceptions,
        "usage": usage_rows,
        "usageAvailable": usage_available,
        "usageCostCents": usage_cost_cents,
        "foodCostPercent": food_cost_pct,
        "menuSales": [{"name": n, "quantity": str(q)} for n, q in sorted(menu_sales.items())],
    }
