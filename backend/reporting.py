"""Read-only reporting projections built from the operational ledger.

Reports deliberately do not introduce a reporting table.  The source of truth remains
Square's imported summaries/orders, invoices, inventory movements, menu costing and
completed stock counts.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from .menu_costing import serialize_menu_item
from .models import (
    InventoryItem,
    InventoryMovement,
    MenuItem,
    PurchaseInvoice,
    PurchaseInvoiceLine,
    RestaurantLocation,
    SquareCatalogMapping,
    SquareCatalogObject,
    SquareConnection,
    SquareDailySalesSummary,
    SquareOrder,
    StockCountSession,
)
from .utils import decimal_to_float, serialize_inventory_movement


MONEY = Decimal("0.01")


def _business_date_for_location(location: RestaurantLocation, value: datetime | None = None) -> date:
    value = value or datetime.now(timezone.utc)
    return value.astimezone(ZoneInfo(location.timezone or "UTC")).date()


def _order_business_date(order: SquareOrder, location: RestaurantLocation) -> date:
    raw = order.ordered_at or order.closed_at or order.created_at
    if raw is None:
        return _business_date_for_location(location)
    if raw.tzinfo is None:
        raw = raw.replace(tzinfo=timezone.utc)
    return _business_date_for_location(location, raw)


def _dec(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except Exception:
        return Decimal("0")


def _money(value: Decimal) -> float:
    return float(Decimal(str(value)).quantize(MONEY))


def _period_delta(current: Decimal, prior: Decimal) -> dict[str, Any]:
    delta = current - prior
    return {
        "current": _money(current),
        "prior": _money(prior),
        "delta": _money(delta),
        "percent": _money((delta / prior) * Decimal("100")) if prior else None,
    }


def _date_range(view: str, start: date | None, end: date | None, location: RestaurantLocation) -> tuple[date, date, date | None, date | None]:
    if view == "daily":
        current = start or _business_date_for_location(location)
        return current, current, None, None
    current_end = end or _business_date_for_location(location)
    current_start = start or (current_end - timedelta(days=6))
    days = (current_end - current_start).days + 1
    prior_end = current_start - timedelta(days=1)
    return current_start, current_end, prior_end - timedelta(days=days - 1), prior_end


def _orders_for_period(orders: list[SquareOrder], location: RestaurantLocation, start: date, end: date) -> list[SquareOrder]:
    return [
        order
        for order in orders
        if not order.is_deleted
        and start <= _order_business_date(order, location) <= end
    ]


def _sales_totals(orders: list[SquareOrder], summaries: list[SquareDailySalesSummary], start: date, end: date) -> dict[str, Any]:
    scoped_summaries = [summary for summary in summaries if start <= summary.sale_date <= end]
    if scoped_summaries:
        return {
            "gross": sum((_dec(row.gross_amount) for row in scoped_summaries), Decimal("0")),
            "discount": sum((_dec(row.discount_amount) for row in scoped_summaries), Decimal("0")),
            "tax": sum((_dec(row.tax_amount) for row in scoped_summaries), Decimal("0")),
            "tip": sum((_dec(row.tip_amount) for row in scoped_summaries), Decimal("0")),
            "refund": sum((_dec(row.refund_amount) for row in scoped_summaries), Decimal("0")),
            "net": sum((_dec(row.net_amount) for row in scoped_summaries), Decimal("0")),
            "orders": sum(int(row.order_count or 0) for row in scoped_summaries),
            "cancelled": sum(int(row.cancelled_order_count or 0) for row in scoped_summaries),
            "source": "square_daily_sales_summaries",
        }
    return {
        "gross": sum((_dec(row.gross_amount) for row in orders), Decimal("0")),
        "discount": sum((_dec(row.discount_amount) for row in orders), Decimal("0")),
        "tax": sum((_dec(row.tax_amount) for row in orders), Decimal("0")),
        "tip": sum((_dec(row.tip_amount) for row in orders), Decimal("0")),
        "refund": sum((_dec(row.refund_amount) for row in orders), Decimal("0")),
        "net": sum((_dec(row.net_amount) for row in orders), Decimal("0")),
        "orders": len(orders),
        "cancelled": sum(1 for row in orders if row.cancelled_at is not None),
        "source": "square_orders",
    }


def _menu_sales(orders: list[SquareOrder], connection: SquareConnection | None, menu_items: list[MenuItem]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if connection is None:
        return [], []
    object_ids = {obj.square_object_id: obj.id for obj in SquareCatalogObject.query.filter_by(square_connection_id=connection.id, is_deleted=False).all()}
    mappings = {
        object_id: mapping
        for object_id, mapping in (
            (square_id, SquareCatalogMapping.query.filter_by(square_catalog_object_id=obj_id, mapping_type="menu_item").first())
            for square_id, obj_id in object_ids.items()
        )
        if mapping is not None and mapping.status == "mapped" and mapping.flowtally_entity_type == "menu_item"
    }
    menu_by_id = {item.id: item for item in menu_items}
    buckets: dict[int, dict[str, Any]] = {}
    unmapped: dict[str, dict[str, Any]] = {}
    for order in orders:
        for line in order.lines:
            mapping = mappings.get(line.square_item_variation_id)
            if mapping is None or int(mapping.flowtally_entity_id or 0) not in menu_by_id:
                key = line.square_item_variation_id or line.name
                row = unmapped.setdefault(key, {"variationId": key, "name": line.name, "quantity": Decimal("0"), "grossAmount": Decimal("0"), "orderCount": 0})
                row["quantity"] += _dec(line.quantity)
                row["grossAmount"] += _dec(line.gross_amount)
                row["orderCount"] += 1
                continue
            menu = menu_by_id[int(mapping.flowtally_entity_id)]
            row = buckets.setdefault(menu.id, {"menuItemId": menu.id, "name": menu.name, "category": menu.category, "quantity": Decimal("0"), "grossAmount": Decimal("0"), "discountAmount": Decimal("0"), "netAmount": Decimal("0"), "orderCount": 0})
            row["quantity"] += _dec(line.quantity)
            row["grossAmount"] += _dec(line.gross_amount)
            row["discountAmount"] += _dec(line.discount_amount)
            row["netAmount"] += _dec(line.net_amount)
            row["orderCount"] += 1
    output = []
    for row in buckets.values():
        costing = serialize_menu_item(menu_by_id[row["menuItemId"]])
        cost = _dec(costing.get("recipeCostPerYield"))
        selling_price = _dec(costing.get("sellingPrice"))
        row.update({
            "quantity": float(row["quantity"]),
            "grossAmount": _money(row["grossAmount"]),
            "discountAmount": _money(row["discountAmount"]),
            "netAmount": _money(row["netAmount"]),
            "orderCount": row["orderCount"],
            "costAvailable": bool(costing.get("costAvailable")),
            "currentCostPerSale": _money(cost) if costing.get("costAvailable") else None,
            "estimatedGrossProfit": _money((selling_price - cost) * row["quantity"]) if costing.get("costAvailable") else None,
            "estimatedFoodCostPercent": costing.get("foodCostPercent"),
            "estimatedGrossMarginPercent": costing.get("grossMarginPercent"),
        })
        output.append(row)
    return sorted(output, key=lambda row: row["netAmount"], reverse=True), [
        {**row, "quantity": float(row["quantity"]), "grossAmount": _money(row["grossAmount"])} for row in unmapped.values()
    ]


def _purchasing(invoices: list[PurchaseInvoice], start: date, end: date) -> dict[str, Any]:
    scoped = [invoice for invoice in invoices if start <= invoice.invoice_date <= end]
    completed = [invoice for invoice in scoped if invoice.status == "Completed"]
    supplier: dict[str, dict[str, Any]] = {}
    for invoice in completed:
        name = invoice.supplier.name if invoice.supplier else "Unknown supplier"
        bucket = supplier.setdefault(name, {"supplierName": name, "spend": Decimal("0"), "invoiceCount": 0})
        bucket["spend"] += _dec(invoice.total_amount)
        bucket["invoiceCount"] += 1
    return {
        "spend": _money(sum((_dec(invoice.total_amount) for invoice in completed), Decimal("0"))),
        "invoiceCount": len(scoped),
        "completedInvoiceCount": len(completed),
        "draftInvoiceCount": sum(1 for invoice in scoped if invoice.status == "Draft"),
        "needsReviewCount": sum(1 for invoice in scoped for line in invoice.lines if line.needs_review),
        "supplierSpend": [{**row, "spend": _money(row["spend"])} for row in supplier.values()],
    }


def _stock_variance(sessions: list[StockCountSession], start: date, end: date) -> dict[str, Any]:
    completed = [session for session in sessions if session.status == "Completed" and session.completed_at and start <= session.completed_at.date() <= end]
    rows = [line for session in completed for line in session.lines if line.variance is not None]
    return {
        "completedCountSessions": len(completed),
        "lineCount": len(rows),
        "varianceExceptionCount": sum(1 for line in rows if _dec(line.variance) != 0),
        "rows": [{"itemName": line.item_name_snapshot, "unit": line.stock_unit_snapshot, "variance": float(line.variance)} for line in rows if _dec(line.variance) != 0],
        "missingCountEvidence": not bool(completed),
    }


def _usage_variance(location: RestaurantLocation, items: list[InventoryItem], orders: list[SquareOrder], connection: SquareConnection | None, start: date, end: date) -> dict[str, Any]:
    sessions = StockCountSession.query.filter_by(organization_id=location.organization_id, location_id=location.id, status="Completed").all()
    opening = max((session for session in sessions if session.completed_at and session.completed_at.date() <= start), key=lambda session: session.completed_at, default=None)
    closing = min((session for session in sessions if session.completed_at and session.completed_at.date() >= end), key=lambda session: session.completed_at, default=None)
    if connection is None or opening is None or closing is None or opening.id == closing.id:
        return {"valid": False, "message": "No completed count evidence", "rows": []}
    opening_by_item = {line.inventory_item_id: _dec(line.counted_quantity) for line in opening.lines if line.counted_quantity is not None}
    closing_by_item = {line.inventory_item_id: _dec(line.counted_quantity) for line in closing.lines if line.counted_quantity is not None}
    rows = []
    for item in items:
        if item.id not in opening_by_item or item.id not in closing_by_item:
            continue
        movements = InventoryMovement.query.filter_by(organization_id=location.organization_id, location_id=location.id, inventory_item_id=item.id).all()
        qualifying = sum((_dec(m.quantity_delta) for m in movements if m.created_at and start <= m.created_at.date() <= end and m.source_type not in {"square_sale", "square_order", "sale"}), Decimal("0"))
        physical = opening_by_item[item.id] + qualifying - closing_by_item[item.id]
        theoretical = Decimal("0")
        menu_by_variation: dict[str, MenuItem] = {}
        for catalog in SquareCatalogObject.query.filter_by(square_connection_id=connection.id, is_deleted=False).all():
            mapping = SquareCatalogMapping.query.filter_by(square_catalog_object_id=catalog.id, mapping_type="menu_item", status="mapped", flowtally_entity_type="menu_item").first()
            if mapping and int(mapping.flowtally_entity_id or 0) in {item.id for item in MenuItem.query.filter_by(organization_id=location.organization_id, location_id=location.id).all()}:
                menu_by_variation[catalog.square_object_id] = MenuItem.query.filter_by(id=int(mapping.flowtally_entity_id), organization_id=location.organization_id, location_id=location.id).first()
        for order in orders:
            for line in order.lines:
                menu = menu_by_variation.get(line.square_item_variation_id)
                if menu and menu.recipe:
                    theoretical += _dec(line.quantity) * sum((_dec(ingredient.quantity_required) / _dec(menu.recipe.yield_quantity) for ingredient in menu.recipe.ingredients if ingredient.inventory_item_id == item.id), Decimal("0"))
        variance = physical - theoretical
        rows.append({"inventoryItemId": item.id, "itemName": item.name, "unit": item.stock_unit, "theoretical": float(theoretical), "physical": float(physical), "variance": float(variance), "variancePercent": float((variance / theoretical * 100).quantize(Decimal("0.1"))) if theoretical else None})
    return {"valid": True, "message": None, "rows": rows}


def build_report(*, location: RestaurantLocation, view: str, start: date | None = None, end: date | None = None) -> dict[str, Any]:
    from .pilot_api import _inventory_summary, _price_changes_for_location, _reorder_suggestion_for_item, _status_for_item

    start_date, end_date, prior_start, prior_end = _date_range(view, start, end, location)
    organization_id = location.organization_id
    items = InventoryItem.query.filter_by(organization_id=organization_id, location_id=location.id, active=True).all()
    invoices = PurchaseInvoice.query.filter_by(organization_id=organization_id, location_id=location.id).all()
    sessions = StockCountSession.query.filter_by(organization_id=organization_id, location_id=location.id).all()
    connection = SquareConnection.query.filter_by(organization_id=organization_id).first()
    orders = _orders_for_period(SquareOrder.query.filter_by(restaurant_location_id=location.id).all(), location, start_date, end_date)
    prior_orders = _orders_for_period(SquareOrder.query.filter_by(restaurant_location_id=location.id).all(), location, prior_start, prior_end) if prior_start and prior_end else []
    summaries = SquareDailySalesSummary.query.filter_by(restaurant_location_id=location.id).all()
    menu_items = MenuItem.query.filter_by(organization_id=organization_id, location_id=location.id, active=True).all()
    totals = _sales_totals(orders, summaries, start_date, end_date)
    prior_totals = _sales_totals(prior_orders, summaries, prior_start, prior_end) if prior_start and prior_end else None
    menu_sales, unmapped = _menu_sales(orders, connection, menu_items)
    prior_menu_sales, _ = _menu_sales(prior_orders, connection, menu_items)
    prior_by_id = {row["menuItemId"]: row for row in prior_menu_sales}
    for row in menu_sales:
        prior_row = prior_by_id.get(row["menuItemId"], {"quantity": 0, "netAmount": 0})
        row["priorQuantity"] = prior_row["quantity"]
        row["currentQuantity"] = row["quantity"]
        row["quantityDelta"] = row["quantity"] - prior_row["quantity"]
        row["quantityDeltaPercent"] = ((row["quantityDelta"] / prior_row["quantity"]) * 100) if prior_row["quantity"] else None
        row["priorNetSales"] = prior_row["netAmount"]
        row["salesDelta"] = row["netAmount"] - prior_row["netAmount"]
        row["salesDeltaPercent"] = ((row["salesDelta"] / prior_row["netAmount"]) * 100) if prior_row["netAmount"] else None
    statuses = [_status_for_item(item)["status"] for item in items]
    reorder = [_reorder_suggestion_for_item(item) for item in items]
    reorder = [row for row in reorder if row]
    purchasing = _purchasing(invoices, start_date, end_date)
    variance = _stock_variance(sessions, start_date, end_date)
    usage = _usage_variance(location, items, orders, connection, start_date, end_date)
    cost_ready_sales = sum((_dec(row["netAmount"]) for row in menu_sales if row["costAvailable"]), Decimal("0"))
    total_menu_sales = sum((_dec(row["netAmount"]) for row in menu_sales), Decimal("0"))
    exceptions = []
    exceptions.extend({"type": "reorder_now", "severity": "warning", "entityType": "inventory_item", "entityId": row["inventoryItemId"], "title": f"{row['inventoryItemName']} needs reordering", "href": "/app/reorder-plan"} for row in reorder if row["stockStatus"] in {"Out of stock", "Reorder now"})
    if unmapped:
        exceptions.append({"type": "unmapped_square_sales", "severity": "warning", "entityType": "square", "title": "Square sales need mapping", "href": "/app/square"})
    if variance["missingCountEvidence"]:
        exceptions.append({"type": "missing_count_evidence", "severity": "info", "entityType": "stock_count", "title": "No completed count evidence", "href": "/app/stock-counts"})
    if usage["valid"]:
        exceptions.extend({"type": "usage_variance", "severity": "warning", "entityType": "inventory_item", "entityId": row["inventoryItemId"], "title": f"{row['itemName']} usage variance", "href": "/app/square/usage"} for row in usage["rows"] if abs(row["variance"]) > 0)
    response = {
        "scope": {"organizationId": organization_id, "locationId": location.id, "locationName": location.name, "timezone": location.timezone},
        "period": {"view": view, "startDate": start_date.isoformat(), "endDate": end_date.isoformat(), "priorStartDate": prior_start.isoformat() if prior_start else None, "priorEndDate": prior_end.isoformat() if prior_end else None},
        "sales": {"currency": "CAD", "grossItemSales": _money(totals["gross"]), "discounts": _money(totals["discount"]), "tax": _money(totals["tax"]), "tips": _money(totals["tip"]), "refunds": _money(totals["refund"]), "totalCollected": _money(totals["net"]), "orderCount": totals["orders"], "cancelledOrderCount": totals["cancelled"], "source": totals["source"], "byMenuItem": menu_sales, "unmappedLines": unmapped},
        "purchasing": purchasing,
        "inventory": {"summary": _inventory_summary(location.id), "statusCounts": {"inStock": statuses.count("In stock"), "lowStock": statuses.count("Low stock"), "reorderNow": statuses.count("Reorder now"), "outOfStock": statuses.count("Out of stock")}, "reorderNow": reorder, "recentMovements": [serialize_inventory_movement(movement) for movement in InventoryMovement.query.filter_by(organization_id=organization_id, location_id=location.id).order_by(InventoryMovement.created_at.desc()).limit(20).all()]},
        "costing": {"costReadySalesAmount": _money(cost_ready_sales), "totalMappedMenuSalesAmount": _money(total_menu_sales), "estimatedFoodCostPercent": _money((sum((_dec(row["currentCostPerSale"]) * _dec(row["quantity"]) for row in menu_sales if row["costAvailable"]), Decimal("0")) / cost_ready_sales) * 100) if cost_ready_sales else None, "costCoveragePercent": _money((cost_ready_sales / total_menu_sales) * 100) if total_menu_sales else 0},
        "variance": variance,
        "usageVariance": usage,
        "changes": {"sales": _period_delta(totals["net"], prior_totals["net"]) if prior_totals else None, "orders": _period_delta(Decimal(totals["orders"]), Decimal(prior_totals["orders"])) if prior_totals else None, "purchaseSpend": _period_delta(Decimal(str(purchasing["spend"])), Decimal(str(_purchasing(invoices, prior_start, prior_end)["spend"]))) if prior_totals else None, "menuMovers": menu_sales} if view == "weekly" else None,
        "exceptions": exceptions[:12],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    return response
