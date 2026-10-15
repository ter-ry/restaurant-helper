from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Any
from urllib.parse import urlencode

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from .access import organization_has_enabled_module, organization_is_operational
from .extensions import db
from .models import DailyCloseSession, InventoryItem, InventoryMovement, InventoryWasteEvent, RestaurantLocation, SquareConnection, SquareDailySalesSummary, SquareLocation, SquareLocationMapping
from .square_integration import (
    _build_square_usage_report,
    _connection_token,
    _current_square_location_ids,
    _square_request,
    SquareRequestError,
    sync_square_orders_for_range,
)
from .utils import get_current_organization_bundle, json_error, serialize_daily_close_session

bp = Blueprint("daily_close", __name__)

VARIANCE_ALERT_PERCENT = Decimal("10")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _selected_location(organization_id: int, locations: list[RestaurantLocation]) -> RestaurantLocation | None:
    raw_location_id = request.args.get("locationId") or (request.get_json(silent=True) or {}).get("locationId")
    if raw_location_id in {None, ""}:
        return locations[0] if len(locations) == 1 else None
    try:
        location_id = int(raw_location_id)
    except (TypeError, ValueError):
        return None
    return next((location for location in locations if location.id == location_id and location.organization_id == organization_id), None)


def _business_date_for_location(location: RestaurantLocation) -> date:
    raw = str(request.args.get("businessDate") or (request.get_json(silent=True) or {}).get("businessDate") or "").strip()
    if raw:
        try:
            return date.fromisoformat(raw)
        except ValueError:
            pass
    try:
        tz = ZoneInfo(location.timezone or "America/Toronto")
    except ZoneInfoNotFoundError:
        tz = timezone.utc
    return datetime.now(tz).date()


def _business_date_bounds(location: RestaurantLocation, business_date: date) -> tuple[datetime, datetime]:
    try:
        tz = ZoneInfo(location.timezone or "America/Toronto")
    except ZoneInfoNotFoundError:
        tz = timezone.utc
    start_local = datetime(business_date.year, business_date.month, business_date.day, 0, 0, 0, tzinfo=tz)
    end_local = start_local + timedelta(days=1) - timedelta(microseconds=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _connection_for_organization(organization_id: int) -> SquareConnection | None:
    return SquareConnection.query.filter_by(organization_id=organization_id).first()


def _square_location_ids_for_location(connection: SquareConnection | None, location: RestaurantLocation) -> list[str]:
    if connection is None:
        return []
    current_location_ids = set(_current_square_location_ids(connection))
    location_ids = [
        square_location.square_location_id
        for square_location in SquareLocation.query.join(SquareLocationMapping, SquareLocationMapping.square_location_id == SquareLocation.id).filter(
            SquareLocation.square_connection_id == connection.id,
            SquareLocationMapping.restaurant_location_id == location.id,
        ).all()
        if square_location.square_location_id in current_location_ids
    ]
    return location_ids


def _sales_summary_for_day(connection: SquareConnection | None, location: RestaurantLocation, business_date: date) -> dict[str, Any]:
    if connection is None:
        return {
            "squareSynced": False,
            "squareStatus": "Not connected",
            "squareMerchantId": "",
            "environment": "",
            "lastSyncAt": None,
            "syncStatus": "idle",
            "syncError": "",
            "locationMapped": False,
            "squareLocationIds": [],
            "grossSales": 0,
            "discounts": 0,
            "tax": 0,
            "tips": 0,
            "refunds": 0,
            "netSales": 0,
            "orders": 0,
            "cancelledOrders": 0,
        }

    square_location_ids = _square_location_ids_for_location(connection, location)
    location_mapped = bool(square_location_ids and SquareLocationMapping.query.join(SquareLocation, SquareLocationMapping.square_location_id == SquareLocation.id).filter(
        SquareLocation.square_connection_id == connection.id,
        SquareLocationMapping.restaurant_location_id == location.id,
    ).count())
    if not square_location_ids:
        square_location_ids = [""]
    raw_summaries = SquareDailySalesSummary.query.filter(
        SquareDailySalesSummary.square_connection_id == connection.id,
        SquareDailySalesSummary.sale_date == business_date,
    ).filter(SquareDailySalesSummary.square_location_id.in_(square_location_ids)).all()
    gross = sum((Decimal(str(summary.gross_amount or 0)) for summary in raw_summaries), start=Decimal("0"))
    discounts = sum((Decimal(str(summary.discount_amount or 0)) for summary in raw_summaries), start=Decimal("0"))
    tax = sum((Decimal(str(summary.tax_amount or 0)) for summary in raw_summaries), start=Decimal("0"))
    tips = sum((Decimal(str(summary.tip_amount or 0)) for summary in raw_summaries), start=Decimal("0"))
    refunds = sum((Decimal(str(summary.refund_amount or 0)) for summary in raw_summaries), start=Decimal("0"))
    net = sum((Decimal(str(summary.net_amount or 0)) for summary in raw_summaries), start=Decimal("0"))
    orders = sum((int(summary.order_count or 0) for summary in raw_summaries), start=0)
    cancelled_orders = sum((int(summary.cancelled_order_count or 0) for summary in raw_summaries), start=0)
    return {
        "squareSynced": bool(connection.last_sync_at),
        "squareStatus": connection.status,
        "squareMerchantId": connection.square_merchant_id,
        "environment": connection.environment,
        "lastSyncAt": connection.last_sync_at.isoformat() if connection.last_sync_at else None,
        "syncStatus": connection.sync_status,
        "syncError": connection.sync_error,
        "locationMapped": location_mapped,
        "squareLocationIds": square_location_ids,
        "grossSales": float(gross),
        "discounts": float(discounts),
        "tax": float(tax),
        "tips": float(tips),
        "refunds": float(refunds),
        "netSales": float(net),
        "orders": orders,
        "cancelledOrders": cancelled_orders,
    }



def _money_amount(value: Any) -> Decimal:
    if not isinstance(value, dict):
        return Decimal("0")
    try:
        return Decimal(str(value.get("amount") or 0)) / Decimal("100")
    except (TypeError, ValueError):
        return Decimal("0")


def _cash_reconciliation(connection: SquareConnection | None, location: RestaurantLocation, business_date: date) -> dict[str, Any]:
    """Read bounded, business-day Square cash evidence without inventing totals."""
    unavailable = {"status": "unavailable", "mode": None, "expectedCash": None, "reconciledExpectedCash": None, "openingFloat": None,
        "cashPayments": None, "cashRefunds": None, "paidIn": None, "paidOut": None, "closedCash": None,
        "reason": "Cash drawer or payment read access is temporarily unavailable.", "reconnectRequired": False}
    if connection is None or connection.status != "connected" or str(connection.environment or "").lower() != "production":
        return unavailable
    location_ids = _square_location_ids_for_location(connection, location)
    if not location_ids:
        return {**unavailable, "reason": "Map the Square location before reconciling cash."}
    start_at, end_at = _business_date_bounds(location, business_date)
    query_start = start_at - timedelta(days=1)
    query_end = end_at + timedelta(days=1)
    start_iso = query_start.isoformat().replace("+00:00", "Z")
    end_iso = query_end.isoformat().replace("+00:00", "Z")
    try:
        token = _connection_token(connection)
    except Exception:
        return unavailable
    for square_location_id in location_ids:
        query_base = {"location_id": square_location_id, "begin_time": start_iso, "end_time": end_iso, "limit": "100"}
        shifts: list[dict[str, Any]] = []
        drawer_failed = False
        cursor = None
        seen_cursors: set[str] = set()
        try:
            for _ in range(10):
                query = dict(query_base)
                if cursor: query["cursor"] = cursor
                drawer = _square_request("GET", "/v2/cash-drawers/shifts?" + urlencode(query), token=token, stage="daily_close_cash_drawer")
                page = drawer if isinstance(drawer, dict) else {}
                shifts.extend(item for item in (page.get("cash_drawer_shifts") or []) if isinstance(item, dict))
                next_cursor = page.get("cursor")
                if not next_cursor or next_cursor in seen_cursors: break
                seen_cursors.add(next_cursor); cursor = next_cursor
        except SquareRequestError:
            drawer_failed = True
            shifts = []
        except Exception:
            drawer_failed = True
            shifts = []
        def parsed(value: Any) -> datetime | None:
            if not value: return None
            try: return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except ValueError: return None
        shifts = [s for s in shifts if (opened := parsed(s.get("opened_at"))) and opened <= end_at and (parsed(s.get("ended_at") or s.get("closed_at")) or _now()) >= start_at]
        detailed_shifts: list[dict[str, Any]] = []
        for summary in shifts:
            shift_id = summary.get("id")
            if not shift_id:
                continue
            try:
                detail_page = _square_request("GET", f"/v2/cash-drawers/shifts/{shift_id}?" + urlencode({"location_id": square_location_id}), token=token, stage="daily_close_cash_drawer_detail")
                detail = (detail_page or {}).get("cash_drawer_shift") if isinstance(detail_page, dict) else None
                if isinstance(detail, dict):
                    detailed_shifts.append(detail)
            except Exception:
                drawer_failed = True
                continue
        shifts = detailed_shifts
        if shifts:
            opening = sum((_money_amount(s.get("opened_cash_money")) for s in shifts), Decimal("0"))
            payments = sum((_money_amount(s.get("cash_payment_money")) for s in shifts), Decimal("0"))
            refunds = sum((_money_amount(s.get("cash_refunds_money")) for s in shifts), Decimal("0"))
            paid_in = sum((_money_amount(s.get("cash_paid_in_money")) for s in shifts), Decimal("0"))
            paid_out = sum((_money_amount(s.get("cash_paid_out_money")) for s in shifts), Decimal("0"))
            expected_values = [s.get("expected_cash_money") for s in shifts]
            expected_parts = [(_money_amount(s.get("expected_cash_money")) if s.get("expected_cash_money") is not None else _money_amount(s.get("opened_cash_money")) + _money_amount(s.get("cash_payment_money")) - _money_amount(s.get("cash_refunds_money")) + _money_amount(s.get("cash_paid_in_money")) - _money_amount(s.get("cash_paid_out_money"))) for s in shifts]
            reconciled = [(s, expected) for s, expected in zip(shifts, expected_parts) if s.get("closed_cash_money") is not None]
            reconciled_expected = sum((expected for _, expected in reconciled), Decimal("0")) if reconciled else None
            closed = sum((_money_amount(s.get("closed_cash_money")) for s, _ in reconciled), Decimal("0")) if reconciled else None
            expected = reconciled_expected
            basis = "square_expected_cash" if all(value is not None for value in expected_values) else "mixed" if any(value is not None for value in expected_values) else "calculated_drawer_cash"
            possible_matches: list[dict[str, Any]] = []
            for shift, shift_expected in reconciled:
                shift_id = shift.get("id")
                if not shift_id or closed is None or expected is None: continue
                try:
                    event_cursor = None; event_seen: set[str] = set()
                    for _ in range(10):
                        event_query = {"limit": "100"}
                        if event_cursor: event_query["cursor"] = event_cursor
                        event_query["location_id"] = square_location_id
                        event_page = _square_request("GET", f"/v2/cash-drawers/shifts/{shift_id}/events?" + urlencode(event_query), token=token, stage="daily_close_cash_events")
                        for event in (event_page or {}).get("cash_drawer_shift_events", []):
                            event_type = str(event.get("event_type") or "").upper()
                            if event_type not in {"CASH_TENDER_PAYMENT", "CASH_TENDER_CANCELLED_PAYMENT", "CASH_TENDER_REFUND", "PAID_IN", "PAID_OUT"}: continue
                            money = event.get("event_money") or event.get("cash_payment_money") or event.get("cash_paid_in_money") or event.get("cash_paid_out_money") or event.get("amount_money")
                            amount = _money_amount(money)
                            if amount == 0: continue
                            possible_matches.append({"type": event_type, "amount": float(amount), "createdAt": event.get("created_at"), "description": event.get("description") or event_type.replace("_", " ").title(), "differenceFromVariance": float(abs(amount - abs(_money_amount(shift.get("closed_cash_money")) - shift_expected))), "shiftId": shift_id})
                        next_cursor = (event_page or {}).get("cursor")
                        if not next_cursor or next_cursor in event_seen: break
                        event_seen.add(next_cursor); event_cursor = next_cursor
                except Exception: continue
            possible_matches.sort(key=lambda item: (round(item["differenceFromVariance"], 2), str(item.get("createdAt") or ""), str(item.get("shiftId") or ""), str(item.get("type") or "")))
            reconciled_count = len(reconciled)
            open_count = sum(1 for s in shifts if str(s.get("state") or "").upper() == "OPEN")
            return {"status": "available", "mode": "drawer_shift", "basis": basis, "expectedCash": float(expected) if expected is not None else None, "reconciledExpectedCash": float(reconciled_expected) if reconciled_expected is not None else None, "openingFloat": float(opening), "cashPayments": float(payments), "cashRefunds": float(refunds), "paidIn": float(paid_in), "paidOut": float(paid_out), "closedCash": float(closed) if closed is not None else None, "overShort": float(closed - expected) if closed is not None and expected is not None else None, "possibleMatches": possible_matches[:5], "shiftCount": len(shifts), "reconciledShiftCount": reconciled_count, "unreconciledShiftCount": len(shifts) - reconciled_count, "openShiftCount": open_count, "closedShiftCount": reconciled_count, "shifts": [{"id": s.get("id"), "state": s.get("state"), "openedAt": s.get("opened_at"), "closedAt": s.get("closed_at"), "expectedCash": float(_money_amount(s.get("expected_cash_money"))) if s.get("expected_cash_money") is not None else None, "closedCash": float(_money_amount(s.get("closed_cash_money"))) if s.get("closed_cash_money") is not None else None} for s in shifts], "reconnectRequired": False}
        payments: list[dict[str, Any]] = []
        cursor = None; seen_cursors = set(); payments_ok = False
        payment_query_base = {"location_id": square_location_id, "begin_time": start_at.isoformat().replace("+00:00", "Z"), "end_time": end_at.isoformat().replace("+00:00", "Z"), "limit": "100"}
        try:
            for _ in range(10):
                query = dict(payment_query_base)
                if cursor: query["cursor"] = cursor
                response = _square_request("GET", "/v2/payments?" + urlencode(query), token=token, stage="daily_close_cash_payments")
                payments_ok = True; page = response if isinstance(response, dict) else {}
                payments.extend(item for item in (page.get("payments") or []) if isinstance(item, dict))
                next_cursor = page.get("cursor")
                if not next_cursor or next_cursor in seen_cursors: break
                seen_cursors.add(next_cursor); cursor = next_cursor
        except SquareRequestError as exc:
            if exc.status_code == 403:
                return {**unavailable, "reason": "Square access does not include payments read permission.", "reconnectRequired": True}
            payments_ok = False
        except Exception:
            payments_ok = False
        if payments_ok:
            cash = [p for p in payments if str(p.get("status") or "").upper() == "COMPLETED" and str(p.get("source_type") or "").upper() == "CASH"]
            cash_payments = sum((_money_amount(p.get("total_money")) for p in cash), Decimal("0"))
            refunds = sum((_money_amount(p.get("refunded_money")) for p in cash), Decimal("0"))
            drawer_reason = "Reconnect Square to enable full cash drawer reconciliation." if drawer_failed else None
            return {"status": "available", "mode": "payments", "basis": "cash_payments", "expectedCash": None, "expectedCashTakings": float(max(Decimal("0"), cash_payments - refunds)), "openingFloat": None, "cashPayments": float(cash_payments), "cashRefunds": float(refunds), "paidIn": None, "paidOut": None, "closedCash": None, "paymentCount": len(cash), "reason": drawer_reason, "reconnectRequired": bool(drawer_reason)}
    return unavailable

def _inventory_value(location_id: int) -> float:
    total = sum(
        (Decimal(str(item.current_on_hand or 0)) * Decimal(str(item.average_unit_cost or 0)) for item in InventoryItem.query.filter_by(location_id=location_id, active=True).all()),
        start=Decimal("0"),
    )
    return float(total.quantize(Decimal("0.01")))


def _daily_close_usage(organization, location: RestaurantLocation, business_date: date, connection: SquareConnection | None) -> dict[str, Any]:
    start_at, end_at = _business_date_bounds(location, business_date)
    if connection is None:
        return {
            "period": {"startAt": start_at.isoformat().replace("+00:00", "Z"), "endAt": end_at.isoformat().replace("+00:00", "Z")},
            "coverage": {
                "totalSoldUnits": 0,
                "mappedSoldUnits": 0,
                "calculableSoldUnits": 0,
                "excludedUnmappedUnits": 0,
                "excludedIncompleteUnits": 0,
                "excludedCancelledUnits": 0,
                "mappedSalesCoveragePercent": 0,
                "calculableSalesCoveragePercent": 0,
                "mappedVariationCount": 0,
                "unmappedVariationCount": 0,
            },
            "ingredientUsage": [],
            "totals": {"theoreticalUsage": 0, "actualUsage": None, "discrepancy": None, "discrepancyPercent": None},
            "contributingMenuItems": [],
            "unmappedVariations": [],
            "warnings": ["Square is not connected."],
        }
    return _build_square_usage_report(organization, connection, location=location, start_at=start_at, end_at=end_at)


def _physical_usage_matches_period(usage: dict[str, Any], start_at: datetime, end_at: datetime) -> bool:
    rows = [row for row in usage.get("ingredientUsage", []) if row.get("actualUsage") is not None]
    if not rows:
        return False
    def parse(value: Any) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    for row in rows:
        basis = row.get("actualUsageBasis") or {}
        opening = parse(basis.get("openingCountCompletedAt"))
        closing = parse(basis.get("closingCountCompletedAt"))
        if opening is None or closing is None or opening != start_at or closing != end_at or closing <= opening:
            return False
    return True


def _daily_close_exceptions(connection: SquareConnection | None, summary: dict[str, Any], usage: dict[str, Any], period_matches: bool = True) -> list[str]:
    exceptions: list[str] = []
    if connection is None or not connection.last_sync_at:
        exceptions.append("Square not synced.")
    if connection is not None and not summary["locationMapped"]:
        exceptions.append("Square location unmapped.")
    if connection is not None and connection.sync_status == "error":
        exceptions.append("Square sync failure.")
    if usage.get("coverage", {}).get("unmappedVariationCount", 0) > 0:
        exceptions.append("Sold Square variation unmapped.")
    if any(item.get("warnings") for item in usage.get("contributingMenuItems", [])):
        exceptions.extend(sorted({warning for item in usage.get("contributingMenuItems", []) for warning in item.get("warnings", []) if "recipe" in warning.lower()}))
    # Missing physical counts make actual usage unavailable, but are not a
    # recipe or mapping defect. Only surface warnings that describe a real
    # mapping/recipe problem as a mapping exception.
    mapping_warnings = [
        warning
        for row in usage.get("ingredientUsage", [])
        for warning in (row.get("warnings") or [])
        if "stock count" not in warning.lower()
    ]
    if mapping_warnings:
        exceptions.append("Recipe or inventory mapping gaps exist.")
    ingredient_rows = usage.get("ingredientUsage", [])
    if period_matches and any(
        row.get("actualUsage") is not None
        and
        row.get("discrepancyPercent") is not None
        and abs(float(row["discrepancyPercent"])) >= float(VARIANCE_ALERT_PERCENT)
        for row in ingredient_rows
    ):
        exceptions.append("Material usage variance exceeds threshold.")
    if summary["refunds"] or summary["cancelledOrders"]:
        exceptions.append("Refunds/cancellations present.")
    return list(dict.fromkeys(exceptions))



def _attention_items(summary: dict[str, Any], usage: dict[str, Any], location: RestaurantLocation, period_matches: bool = True) -> list[dict[str, Any]]:
    period = usage.get("period") or {}
    start_at = str(period.get("startAt") or "")
    end_at = str(period.get("endAt") or "")
    usage_href = f"/app/inventory?view=usage&locationId={location.id}&startAt={urlencode({'x': start_at})[2:]}&endAt={urlencode({'x': end_at})[2:]}"
    items: list[dict[str, Any]] = []
    if usage.get("coverage", {}).get("unmappedVariationCount", 0) > 0:
        items.append({"type": "unmapped_square_sales", "title": "Unmapped Square sales", "severity": "warning", "href": "/app/square", "detail": "Map sold Square variations before relying on recipe usage."})
    for row in usage.get("ingredientUsage", []) if period_matches else []:
        discrepancy = row.get("discrepancy")
        percent = row.get("discrepancyPercent")
        if discrepancy is None or percent is None or abs(float(percent)) < float(VARIANCE_ALERT_PERCENT):
            continue
        direction = "over" if float(discrepancy) > 0 else "under"
        items.append({"type": "usage_variance", "title": f"{row.get('inventoryItemName') or 'Item'} usage {direction}", "severity": "warning", "href": usage_href, "detail": f"{abs(float(discrepancy)):g} {row.get('unit') or ''} {direction} expected."})
    if summary.get("refunds") or summary.get("cancelledOrders"):
        items.append({"type": "sales_exceptions", "title": "Refunds or cancellations", "severity": "info", "href": "/app/square", "detail": "Review finalized Square sales before completing the close."})
    return items

def _daily_close_snapshot(organization, location: RestaurantLocation, business_date: date) -> tuple[dict[str, Any], dict[str, Any], list[str], SquareConnection | None]:
    connection = _connection_for_organization(organization.id)
    summary = _sales_summary_for_day(connection, location, business_date)
    usage = _daily_close_usage(organization, location, business_date, connection)
    period_start, period_end = _business_date_bounds(location, business_date)
    period_matches = _physical_usage_matches_period(usage, period_start, period_end)
    if not period_matches:
        usage = {
            **usage,
            "ingredientUsage": [
                {**row, "actualUsage": None, "discrepancy": None, "discrepancyPercent": None}
                for row in usage.get("ingredientUsage", [])
            ],
            "totals": {
                **(usage.get("totals") or {}),
                "actualUsage": None,
                "discrepancy": None,
                "discrepancyPercent": None,
            },
        }
    usage_units = {str(row.get("unit") or "").strip() for row in usage.get("ingredientUsage", []) if row.get("unit") }
    if len(usage_units) > 1:
        # Totals across kg, L, each, etc. are not a meaningful Daily Close
        # quantity. Keep detailed per-item rows, but make aggregate
        # reconciliation unavailable unless all rows share one unit.
        usage = {
            **usage,
            "totals": {
                **(usage.get("totals") or {}),
                "theoreticalUsage": None,
                "actualUsage": None,
                "discrepancy": None,
                "discrepancyPercent": None,
            },
        }
    exceptions = _daily_close_exceptions(connection, summary, usage, period_matches)
    attention_items = _attention_items(summary, usage, location, period_matches)
    actual_usage = usage.get("totals", {}).get("actualUsage")
    theoretical_usage = usage.get("totals", {}).get("theoreticalUsage") or 0
    discrepancy = usage.get("totals", {}).get("discrepancy")
    discrepancy_percent = usage.get("totals", {}).get("discrepancyPercent")
    start_at, end_at = _business_date_bounds(location, business_date)
    cash_reconciliation = _cash_reconciliation(connection, location, business_date)
    if cash_reconciliation.get("overShort") is not None and abs(float(cash_reconciliation["overShort"])) >= 0.01:
        amount = float(cash_reconciliation["overShort"])
        direction = "over" if amount > 0 else "short"
        exceptions.append(f"Cash drawer {direction}.")
        attention_items.append({"type": "cash_variance", "title": f"Cash drawer {direction}", "severity": "warning", "detail": f"${abs(amount):.2f} {direction}"})
    waste_events = InventoryWasteEvent.query.filter(
        InventoryWasteEvent.organization_id == organization.id,
        InventoryWasteEvent.location_id == location.id,
        InventoryWasteEvent.occurred_at >= start_at,
        InventoryWasteEvent.occurred_at <= end_at,
    ).all()
    waste_quantity = sum((Decimal(str(event.quantity or 0)) for event in waste_events), start=Decimal("0"))
    waste_cost = sum((Decimal(str(event.total_cost or 0)) for event in waste_events), start=Decimal("0"))
    movements = InventoryMovement.query.filter(
        InventoryMovement.organization_id == organization.id,
        InventoryMovement.location_id == location.id,
        InventoryMovement.created_at >= start_at,
        InventoryMovement.created_at <= end_at,
    ).all()
    other_adjustment_quantity = sum(
        (Decimal(str(movement.quantity_delta or 0)) for movement in movements if movement.source_type not in {"inventory waste", "square sale consumption", "invoice receipt", "stock count reconciliation"}),
        start=Decimal("0"),
    )
    physical_count_correction = sum(
        (Decimal(str(movement.quantity_delta or 0)) for movement in movements if movement.source_type == "stock count reconciliation"),
        start=Decimal("0"),
    )
    variance_value = 0.0
    for row in usage.get("ingredientUsage", []):
        if row.get("discrepancy") is None:
            continue
        item = InventoryItem.query.filter_by(id=row["inventoryItemId"], organization_id=organization.id, location_id=location.id).first()
        if item is None or item.average_unit_cost is None:
            continue
        variance_value += float(Decimal(str(row["discrepancy"])) * Decimal(str(item.average_unit_cost)))
    health_status = "Incomplete"
    if connection is None or connection.status != "connected":
        health_status = "Ready with warnings" if theoretical_usage or summary["orders"] else "Incomplete"
    elif exceptions:
        health_status = "Ready with warnings"
    elif actual_usage is None:
        health_status = "Ready"
    else:
        health_status = "Reconciled"
    snapshot = {
        "healthStatus": health_status,
        "inventoryValue": _inventory_value(location.id),
        "sales": summary,
        "usage": {
            "period": usage.get("period"),
            "coverage": usage.get("coverage"),
            "totals": usage.get("totals"),
            "contributingMenuItems": usage.get("contributingMenuItems"),
            "unmappedVariations": usage.get("unmappedVariations"),
            "ingredientUsage": usage.get("ingredientUsage"),
        },
        "variance": {
            "quantity": discrepancy,
            "percent": discrepancy_percent,
            "value": round(variance_value, 2),
        },
        "reconciliation": {
            "theoreticalPosUsage": theoretical_usage,
            "recordedWasteQuantity": float(waste_quantity),
            "recordedWasteCost": float(waste_cost.quantize(Decimal("0.01"))),
            "otherAdjustmentQuantity": float(other_adjustment_quantity),
            "physicalCountCorrectionQuantity": float(physical_count_correction),
            "unexplainedVarianceQuantity": discrepancy,
        },
        "square": summary,
        "cashReconciliation": cash_reconciliation,
        "attentionItems": attention_items,
        "manualReconciliation": {},
        "readyToFinalize": True,
    }
    return snapshot, usage, exceptions, connection


def _merge_manual_reconciliation(snapshot: dict[str, Any], session_record: DailyCloseSession | None, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    manual = dict(snapshot.get("manualReconciliation") or {})
    if session_record is not None:
        stored = (session_record.summary_snapshot_json or {}).get("manualReconciliation") or {}
        if isinstance(stored, dict): manual.update(stored)
    reconciliation = payload.get("reconciliation") if isinstance(payload, dict) else None
    if isinstance(reconciliation, dict) and "countedCash" in reconciliation:
        raw = reconciliation.get("countedCash")
        if raw in {None, ""}: manual.pop("countedCash", None)
        else:
            try: counted = float(raw)
            except (TypeError, ValueError): counted = None
            if counted is not None and counted >= 0: manual["countedCash"] = counted
    snapshot["manualReconciliation"] = manual
    cash = dict(snapshot.get("cashReconciliation") or {})
    if manual.get("countedCash") is not None and cash.get("expectedCash") is not None:
        cash["countedCash"] = manual["countedCash"]
        if cash.get("closedCash") is None:
            cash["overShort"] = round(manual["countedCash"] - float(cash["expectedCash"]), 2)
    else:
        cash.pop("countedCash", None)
        if cash.get("closedCash") is None:
            cash.pop("overShort", None)
    snapshot["cashReconciliation"] = cash
    attention = [item for item in (snapshot.get("attentionItems") or []) if item.get("type") != "cash_variance"]
    if cash.get("closedCash") is None and cash.get("overShort") is not None and abs(float(cash["overShort"])) >= 0.01:
        amount = float(cash["overShort"])
        direction = "over" if amount > 0 else "short"
        attention.append({"type": "cash_variance", "title": f"Cash drawer {direction}", "severity": "warning", "detail": f"${abs(amount):.2f} {direction}"})
    snapshot["attentionItems"] = attention
    return snapshot


def _stored_session_snapshot(session_record: DailyCloseSession, snapshot: dict[str, Any], usage: dict[str, Any], exceptions: list[str]) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    if session_record.status != "COMPLETED":
        return snapshot, usage, exceptions
    return (
        dict(session_record.summary_snapshot_json or snapshot),
        dict(session_record.usage_snapshot_json or usage),
        list(session_record.exceptions_snapshot_json or exceptions),
    )


def _serialize_session_with_snapshot(session_record: DailyCloseSession, snapshot: dict[str, Any]) -> dict[str, Any]:
    payload = serialize_daily_close_session(session_record)
    payload["currentSnapshot"] = snapshot
    return payload


def _require_daily_close_access():
    if not current_user.is_authenticated:
        return json_error("Authentication required.", 401)
    organization, membership, locations = get_current_organization_bundle()
    if organization is None or membership is None or not locations:
        return json_error("No pilot organization is available for the current account.", 404)
    if not organization_is_operational(organization):
        return json_error("This organization is not ready for operational access yet.", 403)
    if not organization_has_enabled_module(organization.id, "DAILY_CLOSE"):
        return json_error("This organization does not have access to that module yet.", 403)
    return organization, membership, locations


@bp.get("/api/pilot/daily-close")
@login_required
def daily_close():
    context = _require_daily_close_access()
    if isinstance(context, tuple) and len(context) == 2 and hasattr(context[0], "status_code"):
        return context
    organization, membership, locations = context
    location = _selected_location(organization.id, locations)
    if location is None:
        return json_error("Choose a location first.", 404)
    business_date = _business_date_for_location(location)
    session_record = DailyCloseSession.query.filter_by(organization_id=organization.id, location_id=location.id, business_date=business_date).first()
    snapshot, usage, exceptions, connection = _daily_close_snapshot(organization, location, business_date)
    if session_record is not None:
        snapshot = _merge_manual_reconciliation(snapshot, session_record)
        snapshot, usage, exceptions = _stored_session_snapshot(session_record, snapshot, usage, exceptions)
    history = [
        _serialize_session_with_snapshot(record, snapshot if record.status != "COMPLETED" else dict(record.summary_snapshot_json or {}))
        for record in DailyCloseSession.query.filter_by(organization_id=organization.id, location_id=location.id).order_by(DailyCloseSession.business_date.desc(), DailyCloseSession.id.desc()).all()
    ]
    return jsonify(
        {
            "session": _serialize_session_with_snapshot(session_record, snapshot) if session_record else None,
            "snapshot": snapshot,
            "usage": usage,
            "exceptions": exceptions,
            "history": history,
            "location": {"id": location.id, "name": location.name, "timezone": location.timezone},
            "businessDate": business_date.isoformat(),
            "square": snapshot["square"],
        }
    ), 200


@bp.post("/api/pilot/daily-close")
@login_required
def open_daily_close():
    context = _require_daily_close_access()
    if isinstance(context, tuple) and len(context) == 2 and hasattr(context[0], "status_code"):
        return context
    organization, membership, locations = context
    payload = request.get_json(silent=True) or {}
    raw_location_id = payload.get("locationId")
    raw_business_date = payload.get("businessDate")
    try:
        location_id = int(raw_location_id)
    except (TypeError, ValueError):
        return json_error("Location id is required.", 400)
    location = next((entry for entry in locations if entry.id == location_id), None)
    if location is None:
        return json_error("Restaurant location not found.", 404)
    try:
        business_date = date.fromisoformat(str(raw_business_date))
    except (TypeError, ValueError):
        business_date = _business_date_for_location(location)
    session_record = DailyCloseSession.query.filter_by(organization_id=organization.id, location_id=location.id, business_date=business_date).first()
    if session_record is None:
        session_record = DailyCloseSession(
            organization_id=organization.id,
            location_id=location.id,
            business_date=business_date,
            status="DRAFT",
            notes="",
            summary_snapshot_json={},
            usage_snapshot_json={},
            exceptions_snapshot_json=[],
            created_by_user_id=current_user.id,
        )
        db.session.add(session_record)
        db.session.flush()
    snapshot, usage, exceptions, _ = _daily_close_snapshot(organization, location, business_date)
    snapshot = _merge_manual_reconciliation(snapshot, session_record)
    if session_record.status != "COMPLETED":
        session_record.summary_snapshot_json = snapshot
        session_record.usage_snapshot_json = usage
        session_record.exceptions_snapshot_json = exceptions
    db.session.commit()
    snapshot, usage, exceptions = _stored_session_snapshot(session_record, snapshot, usage, exceptions)
    history = [
        _serialize_session_with_snapshot(record, snapshot if record.status != "COMPLETED" else dict(record.summary_snapshot_json or {}))
        for record in DailyCloseSession.query.filter_by(organization_id=organization.id, location_id=location.id).order_by(DailyCloseSession.business_date.desc(), DailyCloseSession.id.desc()).all()
    ]
    return jsonify(
        {
            "session": _serialize_session_with_snapshot(session_record, snapshot),
            "snapshot": snapshot,
            "usage": usage,
            "exceptions": exceptions,
            "history": history,
            "location": {"id": location.id, "name": location.name, "timezone": location.timezone},
            "businessDate": business_date.isoformat(),
            "square": snapshot["square"],
        }
    ), 200


@bp.post("/api/pilot/daily-close/<int:session_id>/sync-sales")
@login_required
def sync_daily_close_sales(session_id: int):
    context = _require_daily_close_access()
    if isinstance(context, tuple) and len(context) == 2 and hasattr(context[0], "status_code"):
        return context
    organization, membership, locations = context
    payload = request.get_json(silent=True) or {}
    session_record = DailyCloseSession.query.filter_by(id=session_id, organization_id=organization.id).first()
    if session_record is None:
        return json_error("Daily close session not found.", 404)
    if session_record.status == "COMPLETED":
        return json_error("Completed daily closes are read-only.", 409)
    location = next((entry for entry in locations if entry.id == session_record.location_id), None)
    if location is None:
        return json_error("Restaurant location not found.", 404)
    connection = _connection_for_organization(organization.id)
    if connection is None:
        return json_error("Square is not connected.", 409)
    square_location_ids = _square_location_ids_for_location(connection, location)
    if not square_location_ids:
        return json_error("Map Square locations before syncing sales.", 409)
    raw_business_date = payload.get("businessDate")
    try:
        business_date = date.fromisoformat(str(raw_business_date)) if raw_business_date else session_record.business_date
    except (TypeError, ValueError):
        business_date = session_record.business_date
    start_at, end_at = _business_date_bounds(location, business_date)
    try:
        sync_square_orders_for_range(
            organization,
            connection,
            start_at=start_at,
            end_at=end_at,
            location_ids=square_location_ids,
        )
    except RuntimeError as exc:
        return json_error(str(exc), 400)
    snapshot, usage, exceptions, _ = _daily_close_snapshot(organization, location, session_record.business_date)
    snapshot = _merge_manual_reconciliation(snapshot, session_record)
    session_record.summary_snapshot_json = snapshot
    session_record.usage_snapshot_json = usage
    session_record.exceptions_snapshot_json = exceptions
    db.session.commit()
    history = [
        _serialize_session_with_snapshot(record, snapshot if record.status != "COMPLETED" else dict(record.summary_snapshot_json or {}))
        for record in DailyCloseSession.query.filter_by(organization_id=organization.id, location_id=session_record.location_id).order_by(DailyCloseSession.business_date.desc(), DailyCloseSession.id.desc()).all()
    ]
    return jsonify(
        {
            "session": _serialize_session_with_snapshot(session_record, snapshot),
            "snapshot": snapshot,
            "usage": usage,
            "exceptions": exceptions,
            "history": history,
            "location": {"id": location.id, "name": location.name, "timezone": location.timezone},
            "businessDate": session_record.business_date.isoformat(),
            "square": snapshot["square"],
        }
    ), 200


@bp.patch("/api/pilot/daily-close/<int:session_id>")
@login_required
def update_daily_close(session_id: int):
    context = _require_daily_close_access()
    if isinstance(context, tuple) and len(context) == 2 and hasattr(context[0], "status_code"):
        return context
    organization, membership, locations = context
    payload = request.get_json(silent=True) or {}
    session_record = DailyCloseSession.query.filter_by(id=session_id, organization_id=organization.id).first()
    if session_record is None:
        return json_error("Daily close session not found.", 404)
    if session_record.status == "COMPLETED":
        return json_error("Completed daily closes are read-only.", 409)
    session_record.notes = str(payload.get("notes") or "").strip()
    location = next((entry for entry in locations if entry.id == session_record.location_id), None)
    if location is None:
        return json_error("Restaurant location not found.", 404)
    snapshot, usage, exceptions, _ = _daily_close_snapshot(organization, location, session_record.business_date)
    snapshot = _merge_manual_reconciliation(snapshot, session_record, payload)
    session_record.summary_snapshot_json = snapshot
    session_record.usage_snapshot_json = usage
    session_record.exceptions_snapshot_json = exceptions
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return jsonify(
        {
            "session": _serialize_session_with_snapshot(session_record, snapshot),
            "snapshot": snapshot,
            "usage": usage,
            "exceptions": exceptions,
            "history": [
                _serialize_session_with_snapshot(record, snapshot if record.status != "COMPLETED" else dict(record.summary_snapshot_json or {}))
                for record in DailyCloseSession.query.filter_by(organization_id=organization.id, location_id=session_record.location_id).order_by(DailyCloseSession.business_date.desc(), DailyCloseSession.id.desc()).all()
            ],
            "location": {"id": location.id, "name": location.name, "timezone": location.timezone},
            "businessDate": session_record.business_date.isoformat(),
            "square": snapshot["square"],
        }
    ), 200


@bp.post("/api/pilot/daily-close/<int:session_id>/finalize")
@login_required
def finalize_daily_close(session_id: int):
    context = _require_daily_close_access()
    if isinstance(context, tuple) and len(context) == 2 and hasattr(context[0], "status_code"):
        return context
    organization, membership, locations = context
    session_record = DailyCloseSession.query.filter_by(id=session_id, organization_id=organization.id).first()
    if session_record is None:
        return json_error("Daily close session not found.", 404)
    if session_record.status == "COMPLETED":
        return json_error("Completed daily closes are read-only.", 409)
    location = next((entry for entry in locations if entry.id == session_record.location_id), None)
    if location is None:
        return json_error("Restaurant location not found.", 404)
    snapshot, usage, exceptions, _ = _daily_close_snapshot(organization, location, session_record.business_date)
    session_record.status = "COMPLETED"
    session_record.summary_snapshot_json = snapshot
    session_record.usage_snapshot_json = usage
    session_record.exceptions_snapshot_json = exceptions
    session_record.completed_at = _now()
    session_record.completed_by_user_id = current_user.id
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return jsonify(
        {
            "session": _serialize_session_with_snapshot(session_record, snapshot),
            "snapshot": snapshot,
            "usage": usage,
            "exceptions": exceptions,
            "history": [
                _serialize_session_with_snapshot(record, snapshot if record.status != "COMPLETED" else dict(record.summary_snapshot_json or {}))
                for record in DailyCloseSession.query.filter_by(organization_id=organization.id, location_id=session_record.location_id).order_by(DailyCloseSession.business_date.desc(), DailyCloseSession.id.desc()).all()
            ],
            "location": {"id": location.id, "name": location.name, "timezone": location.timezone},
            "businessDate": session_record.business_date.isoformat(),
            "square": snapshot["square"],
        }
    ), 200
