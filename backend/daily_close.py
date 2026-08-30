from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from .access import organization_has_enabled_module, organization_is_operational
from .extensions import db
from .models import DailyCloseSession, InventoryItem, RestaurantLocation, SquareConnection, SquareDailySalesSummary, SquareLocation, SquareLocationMapping
from .square_integration import _build_square_usage_report, sync_square_orders_for_range
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
    location_ids = [
        square_location.square_location_id
        for square_location in SquareLocation.query.join(SquareLocationMapping, SquareLocationMapping.square_location_id == SquareLocation.id).filter(
            SquareLocation.square_connection_id == connection.id,
            SquareLocationMapping.restaurant_location_id == location.id,
        ).all()
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


def _daily_close_exceptions(connection: SquareConnection | None, summary: dict[str, Any], usage: dict[str, Any]) -> list[str]:
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
    if any(row.get("warnings") for row in usage.get("ingredientUsage", [])):
        exceptions.append("Recipe or inventory mapping gaps exist.")
    if usage.get("totals", {}).get("actualUsage") is None:
        exceptions.append("Actual usage unavailable — stock-count basis is incomplete.")
    discrepancy_percent = usage.get("totals", {}).get("discrepancyPercent")
    if discrepancy_percent is not None and abs(float(discrepancy_percent)) >= float(VARIANCE_ALERT_PERCENT):
        exceptions.append("Material usage variance exceeds threshold.")
    if summary["refunds"] or summary["cancelledOrders"]:
        exceptions.append("Refunds/cancellations present.")
    return list(dict.fromkeys(exceptions))


def _daily_close_snapshot(organization, location: RestaurantLocation, business_date: date) -> tuple[dict[str, Any], dict[str, Any], list[str], SquareConnection | None]:
    connection = _connection_for_organization(organization.id)
    summary = _sales_summary_for_day(connection, location, business_date)
    usage = _daily_close_usage(organization, location, business_date, connection)
    exceptions = _daily_close_exceptions(connection, summary, usage)
    actual_usage = usage.get("totals", {}).get("actualUsage")
    theoretical_usage = usage.get("totals", {}).get("theoreticalUsage") or 0
    discrepancy = usage.get("totals", {}).get("discrepancy")
    discrepancy_percent = usage.get("totals", {}).get("discrepancyPercent")
    variance_value = 0.0
    if discrepancy is not None:
        for row in usage.get("ingredientUsage", []):
            if row.get("discrepancy") is None:
                continue
            item = InventoryItem.query.filter_by(id=row["inventoryItemId"], organization_id=organization.id, location_id=location.id).first()
            if item is None:
                continue
            variance_value += float(Decimal(str(row["discrepancy"])) * Decimal(str(item.average_unit_cost or 0)))
    health_status = "Incomplete"
    if connection is None or connection.status != "connected":
        health_status = "Ready with warnings" if theoretical_usage or summary["orders"] else "Incomplete"
    elif actual_usage is None:
        health_status = "Ready with warnings"
    elif exceptions:
        health_status = "Ready with warnings"
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
        "square": summary,
        "readyToFinalize": True,
    }
    return snapshot, usage, exceptions, connection


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
    session_record.summary_snapshot_json = snapshot
    session_record.usage_snapshot_json = usage
    session_record.exceptions_snapshot_json = exceptions
    db.session.commit()
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
    db.session.commit()
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
