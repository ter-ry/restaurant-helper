from __future__ import annotations

import json
import secrets
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import Blueprint, current_app, jsonify, redirect, request, session
from flask_login import current_user, login_required

from .access import support_access_is_active_for_current_user
from .audit import record_audit_event
from .extensions import csrf, db
from .models import (
    Organization,
    OrganizationMembership,
    RestaurantLocation,
    SquareCatalogMapping,
    SquareCatalogObject,
    SquareConnection,
    SquareDailySalesSummary,
    SquareLocation,
    SquareLocationMapping,
    SquareOrder,
    SquareOrderLine,
    SquareSyncCursor,
    SquareSyncJob,
    SquareWebhookEvent,
)
from .square import decrypt_square_secret, encrypt_square_secret, square_enabled, square_environment, verify_square_webhook_signature
from .tenant_context import apply_org_tenant_context
from .utils import get_platform_role, isoformat, json_error, serialize_location, serialize_organization

bp = Blueprint("square_integration", __name__)

SQUARE_API_VERSION = "2026-07-15"
SQUARE_OAUTH_STATE_KEY = "square_oauth_context"
SQUARE_OAUTH_STATE_TTL_SECONDS = 600
SQUARE_SCOPES = ["MERCHANT_PROFILE_READ", "ITEMS_READ", "ITEMS_WRITE", "ORDERS_READ", "ORDERS_WRITE"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _square_base_url() -> str:
    return "https://connect.squareupsandbox.com" if square_environment() == "sandbox" else "https://connect.squareup.com"


def _square_api_base() -> str:
    return _square_base_url()


def _platform_role() -> str | None:
    role = get_platform_role(current_user.id) if current_user.is_authenticated else None
    return role.role if role else None


def _can_manage_org(organization: Organization) -> bool:
    if not current_user.is_authenticated:
        return False
    if _platform_role() == "setup_admin":
        return True
    if organization.lifecycle_status != "ACTIVE" or organization.setup_status != "COMPLETE" or organization.subscription_status != "ACTIVE":
        return False
    return OrganizationMembership.query.filter_by(user_id=current_user.id, organization_id=organization.id, role="owner").first() is not None


def _require_org_access(organization: Organization | None):
    if organization is None:
        return json_error("Organization not found.", 404)
    if not _can_manage_org(organization):
        return json_error("Square access is restricted to the organization owner or platform setup staff.", 403)
    apply_org_tenant_context(organization, access_scope="setup" if _platform_role() == "setup_admin" else None)
    return None


def _organization_from_request() -> Organization | None:
    payload = request.get_json(silent=True) or {}
    raw_org_id = request.args.get("organizationId") or payload.get("organizationId")
    if raw_org_id in {None, ""}:
        return None
    try:
        return Organization.query.filter_by(id=int(raw_org_id)).first()
    except (TypeError, ValueError):
        return None


def _serialize_location_mapping(mapping: SquareLocationMapping) -> dict[str, Any]:
    return {
        "id": mapping.id,
        "squareLocationId": mapping.square_location_id,
        "restaurantLocationId": mapping.restaurant_location_id,
        "restaurantLocation": serialize_location(mapping.restaurant_location) if mapping.restaurant_location else None,
        "mappedByUserId": mapping.mapped_by_user_id,
        "mappedAt": isoformat(mapping.mapped_at),
        "createdAt": isoformat(mapping.created_at),
        "updatedAt": isoformat(mapping.updated_at),
    }


def _serialize_catalog_mapping(mapping: SquareCatalogMapping) -> dict[str, Any]:
    return {
        "id": mapping.id,
        "squareCatalogObjectId": mapping.square_catalog_object_id,
        "mappingType": mapping.mapping_type,
        "flowtallyEntityType": mapping.flowtally_entity_type,
        "flowtallyEntityId": mapping.flowtally_entity_id,
        "status": mapping.status,
        "mappedByUserId": mapping.mapped_by_user_id,
        "createdAt": isoformat(mapping.created_at),
        "updatedAt": isoformat(mapping.updated_at),
    }


def _serialize_catalog_object(obj: SquareCatalogObject) -> dict[str, Any]:
    return {
        "id": obj.id,
        "squareConnectionId": obj.square_connection_id,
        "squareObjectId": obj.square_object_id,
        "objectType": obj.object_type,
        "version": obj.version,
        "isDeleted": bool(obj.is_deleted),
        "rawPayload": dict(obj.raw_payload_json or {}),
        "mappings": [_serialize_catalog_mapping(mapping) for mapping in SquareCatalogMapping.query.filter_by(square_catalog_object_id=obj.id).order_by(SquareCatalogMapping.id.asc()).all()],
        "createdAt": isoformat(obj.created_at),
        "updatedAt": isoformat(obj.updated_at),
    }


def _serialize_order_line(line: SquareOrderLine) -> dict[str, Any]:
    return {
        "id": line.id,
        "lineUid": line.line_uid,
        "lineIndex": line.line_index,
        "squareItemVariationId": line.square_item_variation_id,
        "name": line.name,
        "quantity": float(line.quantity or 0),
        "grossAmount": float(line.gross_amount or 0),
        "discountAmount": float(line.discount_amount or 0),
        "taxAmount": float(line.tax_amount or 0),
        "tipAmount": float(line.tip_amount or 0),
        "netAmount": float(line.net_amount or 0),
        "rawPayload": dict(line.raw_payload_json or {}),
        "createdAt": isoformat(line.created_at),
        "updatedAt": isoformat(line.updated_at),
    }


def _serialize_order(order: SquareOrder) -> dict[str, Any]:
    return {
        "id": order.id,
        "squareConnectionId": order.square_connection_id,
        "squareOrderId": order.square_order_id,
        "squareLocationId": order.square_location_id,
        "restaurantLocationId": order.restaurant_location_id,
        "orderState": order.order_state,
        "currency": order.currency,
        "grossAmount": float(order.gross_amount or 0),
        "discountAmount": float(order.discount_amount or 0),
        "taxAmount": float(order.tax_amount or 0),
        "tipAmount": float(order.tip_amount or 0),
        "refundAmount": float(order.refund_amount or 0),
        "netAmount": float(order.net_amount or 0),
        "itemQuantity": float(order.item_quantity or 0),
        "lineCount": order.line_count,
        "orderedAt": isoformat(order.ordered_at),
        "closedAt": isoformat(order.closed_at),
        "cancelledAt": isoformat(order.cancelled_at),
        "refundedAt": isoformat(order.refunded_at),
        "isDeleted": bool(order.is_deleted),
        "rawPayload": dict(order.raw_payload_json or {}),
        "lines": [_serialize_order_line(line) for line in order.lines],
        "createdAt": isoformat(order.created_at),
        "updatedAt": isoformat(order.updated_at),
    }


def _serialize_daily_summary(summary: SquareDailySalesSummary) -> dict[str, Any]:
    return {
        "id": summary.id,
        "squareConnectionId": summary.square_connection_id,
        "squareLocationId": summary.square_location_id,
        "restaurantLocationId": summary.restaurant_location_id,
        "saleDate": summary.sale_date.isoformat(),
        "currency": summary.currency,
        "grossAmount": float(summary.gross_amount or 0),
        "discountAmount": float(summary.discount_amount or 0),
        "taxAmount": float(summary.tax_amount or 0),
        "tipAmount": float(summary.tip_amount or 0),
        "refundAmount": float(summary.refund_amount or 0),
        "netAmount": float(summary.net_amount or 0),
        "orderCount": summary.order_count,
        "cancelledOrderCount": summary.cancelled_order_count,
        "rawPayload": dict(summary.raw_payload_json or {}),
        "createdAt": isoformat(summary.created_at),
        "updatedAt": isoformat(summary.updated_at),
    }


def _serialize_webhook_event(event: SquareWebhookEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "squareConnectionId": event.square_connection_id,
        "eventId": event.event_id,
        "eventType": event.event_type,
        "status": event.status,
        "processedAt": isoformat(event.processed_at),
        "errorMessage": event.error_message,
        "rawPayload": dict(event.raw_payload_json or {}),
        "createdAt": isoformat(event.created_at),
        "updatedAt": isoformat(event.updated_at),
    }


def _serialize_connection(connection: SquareConnection) -> dict[str, Any]:
    return {
        "id": connection.id,
        "organizationId": connection.organization_id,
        "organization": serialize_organization(connection.organization) if connection.organization else None,
        "environment": connection.environment,
        "squareMerchantId": connection.square_merchant_id,
        "status": connection.status,
        "tokenExpiresAt": isoformat(connection.token_expires_at),
        "revokedAt": isoformat(connection.revoked_at),
        "lastSyncAt": isoformat(connection.last_sync_at),
        "syncStatus": connection.sync_status,
        "syncError": connection.sync_error,
        "catalogCount": SquareCatalogObject.query.filter_by(square_connection_id=connection.id).count(),
        "orderCount": SquareOrder.query.filter_by(square_connection_id=connection.id).count(),
        "locationCount": SquareLocation.query.filter_by(square_connection_id=connection.id).count(),
        "dailySalesCount": SquareDailySalesSummary.query.filter_by(square_connection_id=connection.id).count(),
        "locations": [
            {
                "id": location.id,
                "squareLocationId": location.square_location_id,
                "name": location.name,
                "status": location.status,
                "rawPayload": dict(location.raw_payload_json or {}),
                "mappings": [_serialize_location_mapping(mapping) for mapping in SquareLocationMapping.query.filter_by(square_location_id=location.id).all()],
                "createdAt": isoformat(location.created_at),
                "updatedAt": isoformat(location.updated_at),
            }
            for location in SquareLocation.query.filter_by(square_connection_id=connection.id).order_by(SquareLocation.name.asc(), SquareLocation.id.asc()).all()
        ],
        "catalogObjects": [_serialize_catalog_object(obj) for obj in SquareCatalogObject.query.filter_by(square_connection_id=connection.id).order_by(SquareCatalogObject.updated_at.desc(), SquareCatalogObject.id.desc()).limit(100).all()],
        "orders": [_serialize_order(order) for order in SquareOrder.query.filter_by(square_connection_id=connection.id).order_by(SquareOrder.updated_at.desc(), SquareOrder.id.desc()).limit(50).all()],
        "dailySales": [_serialize_daily_summary(summary) for summary in SquareDailySalesSummary.query.filter_by(square_connection_id=connection.id).order_by(SquareDailySalesSummary.sale_date.desc(), SquareDailySalesSummary.id.desc()).limit(60).all()],
        "syncJobs": [
            {
                "id": job.id,
                "jobType": job.job_type,
                "status": job.status,
                "requestedAt": isoformat(job.requested_at),
                "startedAt": isoformat(job.started_at),
                "completedAt": isoformat(job.completed_at),
                "errorMessage": job.error_message,
                "cursorJson": dict(job.cursor_json or {}),
            }
            for job in SquareSyncJob.query.filter_by(square_connection_id=connection.id).order_by(SquareSyncJob.created_at.desc(), SquareSyncJob.id.desc()).limit(12).all()
        ],
        "webhookEvents": [_serialize_webhook_event(event) for event in SquareWebhookEvent.query.filter_by(square_connection_id=connection.id).order_by(SquareWebhookEvent.created_at.desc(), SquareWebhookEvent.id.desc()).limit(12).all()],
    }


def _load_oauth_context() -> dict[str, Any]:
    context = session.get(SQUARE_OAUTH_STATE_KEY) or {}
    return context if isinstance(context, dict) else {}


def _save_oauth_context(**payload: Any) -> None:
    session[SQUARE_OAUTH_STATE_KEY] = payload


def _clear_oauth_context() -> None:
    session.pop(SQUARE_OAUTH_STATE_KEY, None)


def _square_authorize_url(*, state: str, organization_id: int) -> str:
    query = urlencode(
        {
            "client_id": current_app.config.get("SQUARE_APPLICATION_ID", ""),
            "scope": " ".join(SQUARE_SCOPES),
            "session": "false",
            "state": state,
            "redirect_uri": current_app.config.get("SQUARE_REDIRECT_URI", ""),
            "organization_id": str(organization_id),
        }
    )
    return f"{_square_base_url()}/oauth2/authorize?{query}"


def _square_request(method: str, path: str, *, token: str | None = None, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{_square_api_base()}{path}"
    headers = {"Content-Type": "application/json", "Square-Version": SQUARE_API_VERSION}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(payload or {}).encode("utf-8") if payload is not None else None
    request_obj = Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urlopen(request_obj, timeout=30) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        try:
            body = exc.read().decode("utf-8")
        except Exception:
            body = ""
        raise RuntimeError(f"Square request failed ({exc.code}). {body[:400]}".strip()) from exc
    except URLError as exc:
        raise RuntimeError(f"Square request failed: {exc.reason}") from exc
    try:
        parsed = json.loads(body or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError("Square response was not valid JSON.") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("Square response was not a JSON object.")
    return parsed


def _exchange_token(code: str) -> dict[str, Any]:
    return _square_request(
        "POST",
        "/oauth2/token",
        payload={
            "client_id": current_app.config.get("SQUARE_APPLICATION_ID", ""),
            "client_secret": current_app.config.get("SQUARE_APPLICATION_SECRET", ""),
            "code": code,
            "grant_type": "authorization_code",
        },
    )


def _refresh_token(connection: SquareConnection) -> dict[str, Any]:
    refresh_token = decrypt_square_secret(connection.refresh_token_ciphertext)
    if not refresh_token:
        raise RuntimeError("Square refresh token is not available.")
    return _square_request(
        "POST",
        "/oauth2/token",
        payload={
            "client_id": current_app.config.get("SQUARE_APPLICATION_ID", ""),
            "client_secret": current_app.config.get("SQUARE_APPLICATION_SECRET", ""),
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )


def _upsert_connection_tokens(connection: SquareConnection, token_payload: dict[str, Any]) -> None:
    connection.environment = square_environment()
    connection.square_merchant_id = str(token_payload.get("merchant_id") or connection.square_merchant_id or "")
    connection.status = "connected"
    connection.access_token_ciphertext = encrypt_square_secret(str(token_payload.get("access_token") or ""))
    refresh_token = str(token_payload.get("refresh_token") or "")
    connection.refresh_token_ciphertext = encrypt_square_secret(refresh_token)
    expires_at = token_payload.get("expires_at")
    if expires_at:
        connection.token_expires_at = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")).astimezone(timezone.utc)
    elif connection.token_expires_at is None:
        connection.token_expires_at = _now() + timedelta(hours=1)
    connection.revoked_at = None
    connection.sync_error = ""
    connection.sync_status = "idle"


def _ensure_connection(organization: Organization) -> SquareConnection:
    connection = SquareConnection.query.filter_by(organization_id=organization.id).first()
    if connection is None:
        connection = SquareConnection(organization_id=organization.id, environment=square_environment(), status="disconnected")
        db.session.add(connection)
        db.session.flush()
    return connection


def _connection_token(connection: SquareConnection) -> str:
    token = decrypt_square_secret(connection.access_token_ciphertext)
    if not token:
        raise RuntimeError("Square is not connected.")
    expires_at = _parse_iso_datetime(connection.token_expires_at)
    if expires_at and expires_at <= _now() and connection.refresh_token_ciphertext:
        token_payload = _refresh_token(connection)
        _upsert_connection_tokens(connection, token_payload)
        db.session.flush()
        token = decrypt_square_secret(connection.access_token_ciphertext)
    return token


def _money_to_decimal(money: dict[str, Any] | None) -> Decimal:
    if not isinstance(money, dict):
        return Decimal("0")
    amount = money.get("amount")
    try:
        return Decimal(str(amount or 0)) / Decimal("100")
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _parse_iso_datetime(value: Any) -> datetime | None:
    if value in {None, ""}:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _infer_restaurant_location_id(connection: SquareConnection, square_location_id: str) -> int | None:
    square_location = SquareLocation.query.filter_by(square_connection_id=connection.id, square_location_id=square_location_id).first()
    if square_location is None:
        return None
    mapping = SquareLocationMapping.query.filter_by(square_location_id=square_location.id).first()
    return mapping.restaurant_location_id if mapping else None


def _upsert_square_location(connection: SquareConnection, entry: dict[str, Any]) -> SquareLocation | None:
    location_id = str(entry.get("id") or "").strip()
    if not location_id:
        return None
    square_location = SquareLocation.query.filter_by(square_connection_id=connection.id, square_location_id=location_id).first()
    if square_location is None:
        square_location = SquareLocation(square_connection_id=connection.id, square_location_id=location_id, name=str(entry.get("name") or ""), raw_payload_json=dict(entry))
        db.session.add(square_location)
    square_location.name = str(entry.get("name") or "")
    square_location.status = str(entry.get("status") or "active").lower()
    square_location.raw_payload_json = dict(entry)
    return square_location


def _sync_locations(connection: SquareConnection, token: str) -> dict[str, Any]:
    payload = _square_request("GET", "/v2/locations", token=token)
    locations = payload.get("locations") or []
    persisted = 0
    for entry in locations:
        if _upsert_square_location(connection, entry) is not None:
            persisted += 1
    return {"locations": persisted, "squareLocationIds": [str(entry.get("id") or "") for entry in locations if str(entry.get("id") or "").strip()]}


def _default_catalog_mapping_status(object_type: str) -> str:
    normalized = object_type.upper()
    if normalized in {"ITEM", "ITEM_VARIATION"}:
        return "review_required"
    if normalized in {"CATEGORY", "MODIFIER", "MODIFIER_LIST", "TAX"}:
        return "preview_only"
    return "unmapped"


def _sync_catalog(connection: SquareConnection, token: str) -> dict[str, Any]:
    cursor = ""
    total = 0
    page_count = 0
    object_ids: list[str] = []
    while True:
        query = {"types": "ITEM,ITEM_VARIATION,CATEGORY,MODIFIER,MODIFIER_LIST,TAX", "include_deleted_objects": "true"}
        if cursor:
            query["cursor"] = cursor
        payload = _square_request("GET", "/v2/catalog/list?" + urlencode(query), token=token)
        objects = payload.get("objects") or []
        for entry in objects:
            object_id = str(entry.get("id") or "").strip()
            if not object_id:
                continue
            object_ids.append(object_id)
            catalog_object = SquareCatalogObject.query.filter_by(square_connection_id=connection.id, square_object_id=object_id).first()
            if catalog_object is None:
                catalog_object = SquareCatalogObject(square_connection_id=connection.id, square_object_id=object_id, object_type=str(entry.get("type") or ""), raw_payload_json=dict(entry))
                db.session.add(catalog_object)
            catalog_object.object_type = str(entry.get("type") or "")
            catalog_object.version = int(entry.get("version") or 0)
            catalog_object.is_deleted = bool(entry.get("is_deleted") or False)
            catalog_object.raw_payload_json = dict(entry)

            mapping = SquareCatalogMapping.query.filter_by(square_catalog_object_id=catalog_object.id, mapping_type="menu_item").first()
            if mapping is None:
                mapping = SquareCatalogMapping(
                    square_catalog_object=catalog_object,
                    mapping_type="menu_item",
                    flowtally_entity_type="",
                    flowtally_entity_id="",
                    status=_default_catalog_mapping_status(catalog_object.object_type),
                    mapped_by_user_id=None,
                )
                db.session.add(mapping)
            elif not mapping.flowtally_entity_id:
                mapping.status = _default_catalog_mapping_status(catalog_object.object_type)
            total += 1
        cursor = str(payload.get("cursor") or "")
        page_count += 1
        if not cursor:
            break
    SquareSyncCursor.query.filter_by(square_connection_id=connection.id, cursor_key="catalog").delete()
    db.session.add(SquareSyncCursor(square_connection_id=connection.id, cursor_key="catalog", cursor_value=cursor))
    return {"objectCount": total, "pages": page_count, "squareObjectIds": object_ids}


def _order_summary_key(order_date: date, square_location_id: str) -> tuple[date, str]:
    return order_date, square_location_id


def _upsert_order(connection: SquareConnection, entry: dict[str, Any]) -> SquareOrder | None:
    order_id = str(entry.get("id") or "").strip()
    if not order_id:
        return None
    square_location_id = str(entry.get("location_id") or entry.get("locationId") or "").strip()
    currency = str((entry.get("total_money") or entry.get("totalMoney") or {}).get("currency") or "CAD")
    order = SquareOrder.query.filter_by(square_connection_id=connection.id, square_order_id=order_id).first()
    if order is None:
        order = SquareOrder(square_connection_id=connection.id, square_order_id=order_id)
        db.session.add(order)
    order.square_location_id = square_location_id
    order.restaurant_location_id = _infer_restaurant_location_id(connection, square_location_id)
    order.order_state = str(entry.get("state") or "").upper()
    order.currency = currency
    order.gross_amount = _money_to_decimal(entry.get("total_money") or entry.get("totalMoney"))
    order.discount_amount = _money_to_decimal(entry.get("discount_money") or entry.get("discountMoney"))
    order.tax_amount = _money_to_decimal(entry.get("tax_money") or entry.get("taxMoney"))
    order.tip_amount = _money_to_decimal(entry.get("tip_money") or entry.get("tipMoney"))
    order.refund_amount = _money_to_decimal(entry.get("refunded_money") or entry.get("refundedMoney"))
    order.net_amount = _money_to_decimal(entry.get("net_amount") or entry.get("netAmount") or entry.get("total_money") or entry.get("totalMoney"))
    order.ordered_at = _parse_iso_datetime(entry.get("created_at") or entry.get("createdAt"))
    order.closed_at = _parse_iso_datetime(entry.get("closed_at") or entry.get("closedAt"))
    order.cancelled_at = _parse_iso_datetime(entry.get("canceled_at") or entry.get("cancelled_at") or entry.get("updated_at"))
    order.refunded_at = _parse_iso_datetime(entry.get("refunded_at") or entry.get("refundedAt"))
    order.raw_payload_json = dict(entry)
    order.last_synced_at = _now()
    order.is_deleted = bool(entry.get("is_deleted") or False)

    existing_lines = {line.line_uid: line for line in order.lines}
    incoming_line_uids: set[str] = set()
    quantity_total = Decimal("0")
    line_count = 0
    for index, line_entry in enumerate(entry.get("line_items") or entry.get("lineItems") or []):
        line_uid = str(line_entry.get("uid") or line_entry.get("id") or f"{order_id}:{index}").strip()
        incoming_line_uids.add(line_uid)
        line = existing_lines.get(line_uid)
        if line is None:
            line = SquareOrderLine(order=order, line_uid=line_uid)
            db.session.add(line)
        line.line_index = index
        line.square_item_variation_id = str((line_entry.get("catalog_object_id") or line_entry.get("catalogObjectId") or line_entry.get("variation_id") or "")).strip()
        line.name = str(line_entry.get("name") or line_entry.get("display_name") or "")
        line.quantity = Decimal(str(line_entry.get("quantity") or 0))
        line.gross_amount = _money_to_decimal(line_entry.get("base_price_money") or line_entry.get("basePriceMoney"))
        line.discount_amount = _money_to_decimal(line_entry.get("discount_money") or line_entry.get("discountMoney"))
        line.tax_amount = _money_to_decimal(line_entry.get("tax_money") or line_entry.get("taxMoney"))
        line.tip_amount = _money_to_decimal(line_entry.get("tip_money") or line_entry.get("tipMoney"))
        line.net_amount = _money_to_decimal(line_entry.get("total_money") or line_entry.get("totalMoney"))
        line.raw_payload_json = dict(line_entry)
        quantity_total += Decimal(str(line.quantity or 0))
        line_count += 1
    for line_uid, line in existing_lines.items():
        if line_uid not in incoming_line_uids:
            db.session.delete(line)
    order.item_quantity = quantity_total
    order.line_count = line_count
    return order


def _rebuild_daily_summaries(connection: SquareConnection, orders: list[SquareOrder]) -> None:
    aggregates: dict[tuple[date, str], dict[str, Any]] = defaultdict(lambda: {"gross": Decimal("0"), "discount": Decimal("0"), "tax": Decimal("0"), "tip": Decimal("0"), "refund": Decimal("0"), "net": Decimal("0"), "count": 0, "cancelled": 0, "currency": "CAD", "restaurant_location_id": None})
    for order in orders:
        sale_source = order.closed_at or order.ordered_at or _now()
        sale_date = sale_source.date()
        key = _order_summary_key(sale_date, order.square_location_id)
        aggregate = aggregates[key]
        aggregate["gross"] += Decimal(str(order.gross_amount or 0))
        aggregate["discount"] += Decimal(str(order.discount_amount or 0))
        aggregate["tax"] += Decimal(str(order.tax_amount or 0))
        aggregate["tip"] += Decimal(str(order.tip_amount or 0))
        aggregate["refund"] += Decimal(str(order.refund_amount or 0))
        aggregate["net"] += Decimal(str(order.net_amount or 0))
        aggregate["count"] += 1
        aggregate["cancelled"] += 1 if order.order_state in {"CANCELED", "CANCELLED", "VOIDED", "REFUNDED"} else 0
        aggregate["currency"] = order.currency or aggregate["currency"]
        aggregate["restaurant_location_id"] = order.restaurant_location_id

    for (sale_date, square_location_id), aggregate in aggregates.items():
        summary = SquareDailySalesSummary.query.filter_by(
            square_connection_id=connection.id,
            sale_date=sale_date,
            square_location_id=square_location_id,
        ).first()
        if summary is None:
            summary = SquareDailySalesSummary(
                square_connection_id=connection.id,
                sale_date=sale_date,
                square_location_id=square_location_id,
            )
            db.session.add(summary)
        summary.restaurant_location_id = aggregate["restaurant_location_id"]
        summary.currency = aggregate["currency"]
        summary.gross_amount = aggregate["gross"]
        summary.discount_amount = aggregate["discount"]
        summary.tax_amount = aggregate["tax"]
        summary.tip_amount = aggregate["tip"]
        summary.refund_amount = aggregate["refund"]
        summary.net_amount = aggregate["net"]
        summary.order_count = aggregate["count"]
        summary.cancelled_order_count = aggregate["cancelled"]
        summary.raw_payload_json = {"saleDate": sale_date.isoformat(), "squareLocationId": square_location_id, "source": "square-orders-sync"}


def _sync_orders(connection: SquareConnection, token: str, *, start_at: str, end_at: str, location_ids: list[str]) -> dict[str, Any]:
    cursor = ""
    order_count = 0
    pages = 0
    synced_orders: list[SquareOrder] = []
    while True:
        payload = _square_request(
            "POST",
            "/v2/orders/search",
            token=token,
            payload={
                "location_ids": location_ids,
                "query": {
                    "filter": {
                        "date_time_filter": {
                            "created_at": {
                                "start_at": start_at,
                                "end_at": end_at,
                            }
                        }
                    },
                    "sort": {"sort_field": "CREATED_AT", "sort_order": "ASC"},
                },
                **({"cursor": cursor} if cursor else {}),
            },
        )
        orders = payload.get("orders") or []
        for entry in orders:
            order = _upsert_order(connection, entry)
            if order is not None:
                synced_orders.append(order)
                order_count += 1
        cursor = str(payload.get("cursor") or "")
        pages += 1
        if not cursor:
            break
    SquareSyncCursor.query.filter_by(square_connection_id=connection.id, cursor_key="orders").delete()
    db.session.add(SquareSyncCursor(square_connection_id=connection.id, cursor_key="orders", cursor_value=cursor))
    _rebuild_daily_summaries(connection, synced_orders)
    return {"orderCount": order_count, "pages": pages, "cursor": cursor, "locationIds": location_ids}


def _ensure_connection_and_access(organization_id: int) -> tuple[Organization | None, SquareConnection | None, tuple[dict[str, Any], int] | None]:
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return None, None, json_error("Organization not found.", 404)
    permission_error = _require_org_access(organization)
    if permission_error is not None:
        return organization, None, permission_error
    return organization, _ensure_connection(organization), None


def _parse_org_id_from_payload() -> int | None:
    payload = request.get_json(silent=True) or {}
    raw_org_id = request.args.get("organizationId") or payload.get("organizationId")
    if raw_org_id in {None, ""}:
        return None
    try:
        return int(raw_org_id)
    except (TypeError, ValueError):
        return None


@bp.get("/api/integrations/square/start")
@login_required
def start_square_oauth():
    if not square_enabled():
        return json_error("Square is not enabled.", 404)
    organization = _organization_from_request()
    if organization is None:
        return json_error("Organization not found.", 404)
    permission_error = _require_org_access(organization)
    if permission_error is not None:
        return permission_error
    state = secrets.token_urlsafe(24)
    _save_oauth_context(
        state=state,
        organization_id=organization.id,
        user_id=current_user.id,
        expires_at=(_now() + timedelta(seconds=SQUARE_OAUTH_STATE_TTL_SECONDS)).isoformat(),
    )
    return redirect(_square_authorize_url(state=state, organization_id=organization.id), code=302)


@bp.get("/api/integrations/square/callback")
@login_required
def square_callback():
    if not square_enabled():
        return json_error("Square is not enabled.", 404)
    query_state = str(request.args.get("state") or "").strip()
    code = str(request.args.get("code") or "").strip()
    error = str(request.args.get("error") or "").strip()
    if error:
        _clear_oauth_context()
        return json_error("Square authorization was not completed.", 400)
    context = _load_oauth_context()
    if not query_state or not code or context.get("state") != query_state:
        _clear_oauth_context()
        return json_error("Square state validation failed.", 400)
    expires_at = context.get("expires_at")
    if not expires_at or _parse_iso_datetime(expires_at) is None or _parse_iso_datetime(expires_at) < _now():
        _clear_oauth_context()
        return json_error("Square authorization session expired.", 400)
    if context.get("user_id") != current_user.id:
        _clear_oauth_context()
        return json_error("Square authorization was started by a different user.", 403)
    organization = Organization.query.filter_by(id=int(context.get("organization_id") or 0)).first()
    if organization is None:
        _clear_oauth_context()
        return json_error("Organization not found.", 404)
    permission_error = _require_org_access(organization)
    if permission_error is not None:
        return permission_error
    try:
        token_payload = _exchange_token(code)
    except Exception as exc:
        _clear_oauth_context()
        return json_error(f"Square token exchange failed: {exc}", 400)

    connection = _ensure_connection(organization)
    _upsert_connection_tokens(connection, token_payload)
    db.session.flush()
    try:
        token = decrypt_square_secret(connection.access_token_ciphertext)
        location_summary = _sync_locations(connection, token)
        catalog_summary = _sync_catalog(connection, token)
        connection.last_sync_at = _now()
        connection.sync_status = "idle"
        db.session.commit()
    except Exception as exc:
        connection.sync_status = "error"
        connection.sync_error = str(exc)
        db.session.commit()
        _clear_oauth_context()
        return json_error(f"Square sync failed after connection: {exc}", 400)

    _clear_oauth_context()
    record_audit_event(
        event_type="square.oauth.connected",
        entity_type="square_connection",
        entity_id=connection.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"merchantId": connection.square_merchant_id, "locationSummary": location_summary, "catalogSummary": catalog_summary},
    )
    db.session.commit()
    return redirect(f"/integrations/square?organizationId={organization.id}&connected=1", code=302)


@bp.get("/api/integrations/square/status")
@login_required
def square_status():
    organization = _organization_from_request()
    if organization is None:
        return json_error("Organization not found.", 404)
    permission_error = _require_org_access(organization)
    if permission_error is not None:
        return permission_error
    connection = _ensure_connection(organization)
    return jsonify({"connection": _serialize_connection(connection)}), 200


@bp.post("/api/integrations/square/disconnect")
@login_required
def square_disconnect():
    organization = _organization_from_request()
    if organization is None:
        return json_error("Organization not found.", 404)
    permission_error = _require_org_access(organization)
    if permission_error is not None:
        return permission_error
    connection = _ensure_connection(organization)
    connection.status = "disconnected"
    connection.revoked_at = _now()
    connection.access_token_ciphertext = ""
    connection.refresh_token_ciphertext = ""
    connection.sync_status = "disconnected"
    connection.sync_error = ""
    record_audit_event(
        event_type="square.oauth.disconnected",
        entity_type="square_connection",
        entity_id=connection.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
    )
    db.session.commit()
    return jsonify({"connection": _serialize_connection(connection)}), 200


@bp.post("/api/integrations/square/locations/sync")
@login_required
def square_sync_locations():
    org_id = _parse_org_id_from_payload()
    if org_id is None:
        return json_error("Organization id is required.", 400)
    organization, connection, error = _ensure_connection_and_access(org_id)
    if error is not None:
        return error
    assert organization is not None and connection is not None
    try:
        token = _connection_token(connection)
    except Exception as exc:
        return json_error(str(exc), 409)
    job = SquareSyncJob(square_connection_id=connection.id, job_type="locations", status="running", started_at=_now(), requested_at=_now())
    db.session.add(job)
    try:
        result = _sync_locations(connection, token)
        connection.last_sync_at = _now()
        connection.sync_status = "idle"
        job.status = "completed"
        job.completed_at = _now()
        job.cursor_json = result
        db.session.commit()
        record_audit_event(
            event_type="square.locations_synced",
            entity_type="square_connection",
            entity_id=connection.id,
            organization_id=organization.id,
            actor_user_id=current_user.id,
            metadata=result,
        )
        db.session.commit()
        return jsonify({"connection": _serialize_connection(connection), "job": {"id": job.id, "status": job.status, "cursorJson": result}}), 200
    except Exception as exc:
        connection.sync_status = "error"
        connection.sync_error = str(exc)
        job.status = "failed"
        job.completed_at = _now()
        job.error_message = str(exc)
        db.session.commit()
        return json_error(f"Square location sync failed: {exc}", 400)


@bp.post("/api/integrations/square/catalog/sync")
@login_required
def square_sync_catalog():
    org_id = _parse_org_id_from_payload()
    if org_id is None:
        return json_error("Organization id is required.", 400)
    organization, connection, error = _ensure_connection_and_access(org_id)
    if error is not None:
        return error
    assert organization is not None and connection is not None
    try:
        token = _connection_token(connection)
    except Exception as exc:
        return json_error(str(exc), 409)
    job = SquareSyncJob(square_connection_id=connection.id, job_type="catalog", status="running", started_at=_now(), requested_at=_now())
    db.session.add(job)
    try:
        result = _sync_catalog(connection, token)
        connection.last_sync_at = _now()
        connection.sync_status = "idle"
        job.status = "completed"
        job.completed_at = _now()
        job.cursor_json = result
        db.session.commit()
        record_audit_event(
            event_type="square.catalog_synced",
            entity_type="square_connection",
            entity_id=connection.id,
            organization_id=organization.id,
            actor_user_id=current_user.id,
            metadata=result,
        )
        db.session.commit()
        return jsonify({"connection": _serialize_connection(connection), "job": {"id": job.id, "status": job.status, "cursorJson": result}}), 200
    except Exception as exc:
        connection.sync_status = "error"
        connection.sync_error = str(exc)
        job.status = "failed"
        job.completed_at = _now()
        job.error_message = str(exc)
        db.session.commit()
        return json_error(f"Square catalog sync failed: {exc}", 400)


@bp.post("/api/integrations/square/orders/sync")
@login_required
def square_sync_orders():
    payload = request.get_json(silent=True) or {}
    org_id = _parse_org_id_from_payload()
    if org_id is None:
        return json_error("Organization id is required.", 400)
    start_at = str(payload.get("startAt") or "").strip()
    end_at = str(payload.get("endAt") or "").strip()
    if not start_at or not end_at:
        return json_error("Start and end timestamps are required.", 400)
    organization, connection, error = _ensure_connection_and_access(org_id)
    if error is not None:
        return error
    assert organization is not None and connection is not None
    try:
        token = _connection_token(connection)
    except Exception as exc:
        return json_error(str(exc), 409)
    location_ids = [str(item) for item in payload.get("locationIds") or [] if str(item).strip()]
    if not location_ids:
        location_ids = [location.square_location_id for location in SquareLocation.query.filter_by(square_connection_id=connection.id).all()]
    if not location_ids:
        return json_error("Sync Square locations before importing orders.", 409)
    job = SquareSyncJob(square_connection_id=connection.id, job_type="orders", status="running", started_at=_now(), requested_at=_now())
    db.session.add(job)
    try:
        result = _sync_orders(connection, token, start_at=start_at, end_at=end_at, location_ids=location_ids)
        connection.last_sync_at = _now()
        connection.sync_status = "idle"
        job.status = "completed"
        job.completed_at = _now()
        job.cursor_json = result
        db.session.commit()
        record_audit_event(
            event_type="square.orders_synced",
            entity_type="square_connection",
            entity_id=connection.id,
            organization_id=organization.id,
            actor_user_id=current_user.id,
            metadata=result,
        )
        db.session.commit()
        return jsonify({"connection": _serialize_connection(connection), "job": {"id": job.id, "status": job.status, "cursorJson": result}}), 200
    except Exception as exc:
        connection.sync_status = "error"
        connection.sync_error = str(exc)
        job.status = "failed"
        job.completed_at = _now()
        job.error_message = str(exc)
        db.session.commit()
        return json_error(f"Square order sync failed: {exc}", 400)


@bp.post("/api/integrations/square/location-mappings")
@login_required
def square_location_mapping():
    payload = request.get_json(silent=True) or {}
    try:
        organization_id = int(payload.get("organizationId"))
        square_location_id = int(payload.get("squareLocationId"))
        restaurant_location_id = int(payload.get("restaurantLocationId"))
    except (TypeError, ValueError):
        return json_error("Organization, Square location, and restaurant location ids are required.", 400)
    organization, connection, error = _ensure_connection_and_access(organization_id)
    if error is not None:
        return error
    assert organization is not None and connection is not None
    square_location = SquareLocation.query.filter_by(id=square_location_id, square_connection_id=connection.id).first()
    restaurant_location = RestaurantLocation.query.filter_by(id=restaurant_location_id, organization_id=organization.id).first()
    if square_location is None:
        return json_error("Square location not found.", 404)
    if restaurant_location is None:
        return json_error("Restaurant location not found.", 404)
    mapping = SquareLocationMapping.query.filter_by(square_location_id=square_location.id).first()
    if mapping is None:
        mapping = SquareLocationMapping(square_location_id=square_location.id, restaurant_location_id=restaurant_location_id, mapped_by_user_id=current_user.id)
        db.session.add(mapping)
    else:
        mapping.restaurant_location_id = restaurant_location_id
        mapping.mapped_by_user_id = current_user.id
        mapping.mapped_at = _now()
    db.session.flush()
    record_audit_event(
        event_type="square.location_mapped",
        entity_type="square_location_mapping",
        entity_id=mapping.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"squareLocationId": square_location.square_location_id, "restaurantLocationId": restaurant_location_id},
    )
    db.session.commit()
    return jsonify({"connection": _serialize_connection(connection)}), 200


@bp.post("/api/integrations/square/catalog/mappings")
@login_required
def square_catalog_mapping():
    payload = request.get_json(silent=True) or {}
    try:
        organization_id = int(payload.get("organizationId"))
        square_catalog_object_id = int(payload.get("squareCatalogObjectId"))
    except (TypeError, ValueError):
        return json_error("Organization and catalog object ids are required.", 400)
    mapping_type = str(payload.get("mappingType") or "menu_item").strip() or "menu_item"
    flowtally_entity_type = str(payload.get("flowtallyEntityType") or "").strip()
    flowtally_entity_id = str(payload.get("flowtallyEntityId") or "").strip()
    status = str(payload.get("status") or "mapped").strip() or "mapped"
    organization, connection, error = _ensure_connection_and_access(organization_id)
    if error is not None:
        return error
    assert organization is not None and connection is not None
    catalog_object = SquareCatalogObject.query.filter_by(id=square_catalog_object_id, square_connection_id=connection.id).first()
    if catalog_object is None:
        return json_error("Square catalog object not found.", 404)
    mapping = SquareCatalogMapping.query.filter_by(square_catalog_object_id=catalog_object.id, mapping_type=mapping_type).first()
    if mapping is None:
        mapping = SquareCatalogMapping(square_catalog_object_id=catalog_object.id, mapping_type=mapping_type, flowtally_entity_type=flowtally_entity_type, flowtally_entity_id=flowtally_entity_id, status=status, mapped_by_user_id=current_user.id)
        db.session.add(mapping)
    else:
        mapping.flowtally_entity_type = flowtally_entity_type
        mapping.flowtally_entity_id = flowtally_entity_id
        mapping.status = status
        mapping.mapped_by_user_id = current_user.id
    db.session.flush()
    record_audit_event(
        event_type="square.catalog_mapped",
        entity_type="square_catalog_mapping",
        entity_id=mapping.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"squareObjectId": catalog_object.square_object_id, "mappingType": mapping_type, "status": status},
    )
    db.session.commit()
    return jsonify({"connection": _serialize_connection(connection)}), 200


def _apply_webhook_event(connection: SquareConnection, payload: dict[str, Any]) -> dict[str, Any]:
    event_type = str(payload.get("type") or payload.get("event_type") or "").strip()
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        data = {}
    if "order" in event_type.lower():
        order_payload = data.get("object") or data.get("order") or data
        if isinstance(order_payload, dict):
            _upsert_order(connection, order_payload)
            _rebuild_daily_summaries(connection, [order for order in SquareOrder.query.filter_by(square_connection_id=connection.id).all()])
    elif "catalog" in event_type.lower():
        catalog_payload = data.get("object") or data.get("catalog_object") or data
        if isinstance(catalog_payload, dict):
            _sync_catalog_object_from_webhook(connection, catalog_payload)
    return {"handled": event_type or "unknown"}


def _sync_catalog_object_from_webhook(connection: SquareConnection, entry: dict[str, Any]) -> None:
    object_id = str(entry.get("id") or "").strip()
    if not object_id:
        return
    catalog_object = SquareCatalogObject.query.filter_by(square_connection_id=connection.id, square_object_id=object_id).first()
    if catalog_object is None:
        catalog_object = SquareCatalogObject(square_connection_id=connection.id, square_object_id=object_id, object_type=str(entry.get("type") or ""), raw_payload_json=dict(entry))
        db.session.add(catalog_object)
    catalog_object.object_type = str(entry.get("type") or "")
    catalog_object.version = int(entry.get("version") or 0)
    catalog_object.is_deleted = bool(entry.get("is_deleted") or False)
    catalog_object.raw_payload_json = dict(entry)


@csrf.exempt
@bp.post("/api/integrations/square/webhooks")
def square_webhooks():
    raw_body = request.get_data(cache=True, as_text=False)
    signature = request.headers.get("x-square-hmacsha256-signature") or request.headers.get("x-square-signature") or ""
    if not verify_square_webhook_signature(
        raw_body=raw_body,
        notification_url=str(current_app.config.get("SQUARE_WEBHOOK_NOTIFICATION_URL") or request.url),
        signature_header=signature,
        signature_key=str(current_app.config.get("SQUARE_WEBHOOK_SIGNATURE_KEY") or ""),
    ):
        return json_error("Invalid Square webhook signature.", 403)
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        return json_error("Webhook body was not valid JSON.", 400)
    if not isinstance(payload, dict):
        return json_error("Webhook body was not valid JSON.", 400)
    merchant_id = str(payload.get("merchant_id") or payload.get("merchantId") or "").strip()
    event_id = str(payload.get("event_id") or payload.get("eventId") or payload.get("id") or "").strip()
    event_type = str(payload.get("type") or payload.get("eventType") or "").strip()
    connection = SquareConnection.query.filter_by(square_merchant_id=merchant_id).first()
    if connection is None:
        return json_error("Square connection not found.", 404)
    duplicate = SquareWebhookEvent.query.filter_by(square_connection_id=connection.id, event_id=event_id).first()
    if duplicate is not None:
        duplicate.status = "duplicate"
        db.session.commit()
        return jsonify({"ok": True, "duplicate": True}), 200
    event = SquareWebhookEvent(
        square_connection_id=connection.id,
        event_id=event_id or secrets.token_hex(16),
        event_type=event_type or "unknown",
        status="received",
        raw_payload_json=payload,
    )
    db.session.add(event)
    try:
        result = _apply_webhook_event(connection, payload)
        connection.last_sync_at = _now()
        connection.sync_status = "webhook_received"
        event.status = "processed"
        event.processed_at = _now()
        record_audit_event(
            event_type="square.webhook_processed",
            entity_type="square_webhook_event",
            entity_id=event.event_id,
            organization_id=connection.organization_id,
            actor_user_id=current_user.id if current_user.is_authenticated else None,
            metadata={"eventType": event.event_type, **result},
        )
        db.session.commit()
    except Exception as exc:
        event.status = "failed"
        event.error_message = str(exc)
        connection.sync_status = "error"
        connection.sync_error = str(exc)
        db.session.commit()
        return json_error(f"Square webhook processing failed: {exc}", 400)
    return jsonify({"ok": True}), 200
