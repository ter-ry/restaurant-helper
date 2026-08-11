from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import re
from typing import Any

from sqlalchemy.exc import IntegrityError

from flask import Blueprint, jsonify, request, session
from flask_login import current_user, login_required

from .audit import record_audit_event
from .extensions import db
from .models import (
    AuditEvent,
    InventoryItem,
    InventoryMovement,
    OrganizationMembership,
    PurchaseInvoice,
    PurchaseInvoiceLine,
    ReorderPlan,
    ReorderPlanLine,
    ReorderIntent,
    RestaurantLocation,
    StockCountSession,
    StockCountSessionLine,
    Supplier,
    SupplierItemMapping,
)
from .policy import require_permission
from .utils import (
    decimal_to_float,
    isoformat,
    get_current_location,
    get_current_membership,
    get_current_organization_bundle,
    json_error,
    serialize_count_session,
    serialize_inventory_item,
    serialize_inventory_movement,
    serialize_location,
    serialize_purchase_invoice,
    serialize_purchase_invoice_line,
    serialize_audit_event,
    serialize_reorder_plan,
    serialize_reorder_plan_line,
    serialize_reorder_intent,
    serialize_supplier,
    serialize_supplier_item_mapping,
)
from .validation import RequestValidationError

bp = Blueprint("pilot_api", __name__)

MONEY = Decimal("0.01")
QTY = Decimal("0.0001")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _start_of_week(now: datetime | None = None) -> datetime:
    current = now or _now()
    start = current - timedelta(days=current.weekday())
    return datetime(start.year, start.month, start.day, tzinfo=timezone.utc)


def _aware_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.strip().lower())).strip()


def _to_decimal(value: Any, *, field: str, required: bool = True, places: str = "0.01") -> Decimal:
    if value in (None, ""):
        if required:
            raise RequestValidationError("Validation failed.", {field: "This field is required."})
        return Decimal("0")
    try:
        return Decimal(str(value)).quantize(Decimal(places))
    except (InvalidOperation, ValueError):
        raise RequestValidationError("Validation failed.", {field: "Enter a valid number."}) from None


def _to_quantity(value: Any, *, field: str, required: bool = True) -> Decimal:
    return _to_decimal(value, field=field, required=required, places="0.0001")


def _to_int(value: Any, *, field: str, required: bool = True) -> int:
    if value in (None, ""):
        if required:
            raise RequestValidationError("Validation failed.", {field: "This field is required."})
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        raise RequestValidationError("Validation failed.", {field: "Enter a valid whole number."}) from None


def _parse_date(value: Any, *, field: str) -> date:
    if not value:
      raise RequestValidationError("Validation failed.", {field: "This field is required."})
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise RequestValidationError("Validation failed.", {field: "Enter a valid date (YYYY-MM-DD)."}) from None


def _json_body() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise RequestValidationError("Request body must be JSON.", {"body": "Expected a JSON object."})
    return payload


def _current_context():
    organization, membership, locations = get_current_organization_bundle()
    location = get_current_location()
    if organization is None or membership is None or location is None:
        return None, None, None, None
    return organization, membership, locations, location


def _require_context():
    organization, membership, locations, location = _current_context()
    if organization is None or membership is None or location is None:
        return None
    return organization, membership, locations, location


def _check_location_access(location_id: int, locations: list[RestaurantLocation]) -> RestaurantLocation | None:
    return next((candidate for candidate in locations if candidate.id == location_id), None)


def _require_role(membership, permission: str):
    return require_permission(membership.role if membership else None, permission)


def _status_for_item(item: InventoryItem) -> dict[str, Any]:
    avg_usage = decimal_to_float(item.average_daily_usage)
    current = decimal_to_float(item.current_on_hand) or 0
    min_quantity = decimal_to_float(item.min_quantity) or 0
    par_level = decimal_to_float(item.par_level) or 0
    days_remaining = None
    if avg_usage and avg_usage > 0:
        days_remaining = round(current / avg_usage, 1)

    if current <= 0:
        status = "Out of stock"
    elif current <= min_quantity or (days_remaining is not None and days_remaining <= 3):
        status = "Reorder now"
    elif current < par_level or (days_remaining is not None and days_remaining <= 10):
        status = "Low stock"
    else:
        status = "In stock"

    return {"status": status, "daysRemaining": days_remaining}


def _reorder_suggestion_for_item(item: InventoryItem) -> dict[str, Any] | None:
    status_data = _status_for_item(item)
    status = status_data["status"]
    if status not in {"Out of stock", "Reorder now", "Low stock"}:
        return None

    target = decimal_to_float(item.par_level) or decimal_to_float(item.min_quantity) or 0
    current = decimal_to_float(item.current_on_hand) or 0
    suggested = max(0, round(target - current, 4))
    estimated_cost = None
    if item.last_purchase_conversion_factor and item.last_purchase_conversion_factor > 0:
        estimated_cost = round((Decimal(str(suggested)) / item.last_purchase_conversion_factor * item.latest_purchase_price).quantize(MONEY), 2)

    return {
        "id": item.id,
        "inventoryItemId": item.id,
        "inventoryItemName": item.name,
        "category": item.category,
        "supplier": item.preferred_supplier_name or (item.supplier.name if item.supplier else "Unknown supplier"),
        "currentQuantity": current,
        "unit": item.stock_unit,
        "minimumQuantity": decimal_to_float(item.min_quantity) or 0,
        "parLevel": decimal_to_float(item.par_level) or 0,
        "suggestedQuantity": suggested,
        "adjustedQuantity": suggested,
        "latestPurchasePrice": decimal_to_float(item.latest_purchase_price) or 0,
        "estimatedCost": estimated_cost,
        "stockStatus": status,
        "status": "Needs ordering",
        "daysRemaining": status_data["daysRemaining"],
    }


def _inventory_summary(location_id: int):
    items = InventoryItem.query.filter_by(location_id=location_id, active=True).all()
    statuses = [_status_for_item(item)["status"] for item in items]
    low = sum(1 for status in statuses if status == "Low stock")
    reorder = sum(1 for status in statuses if status == "Reorder now")
    out = sum(1 for status in statuses if status == "Out of stock")
    count_needed = sum(1 for item in items if item.last_counted_at is None or (_now() - _aware_datetime(item.last_counted_at)).days > 14)
    value = sum((decimal_to_float(item.current_on_hand) or 0) * (decimal_to_float(item.latest_purchase_price) or 0) for item in items)
    return {
        "inventoryItemCount": len(items),
        "inventoryLowStockCount": low,
        "inventoryReorderNowCount": reorder,
        "inventoryOutOfStockCount": out,
        "inventoryCountNeededCount": count_needed,
        "inventoryMovementCount": InventoryMovement.query.filter_by(location_id=location_id).count(),
        "inventoryReceiptCount": PurchaseInvoice.query.filter_by(location_id=location_id, status="Completed").count(),
        "inventoryValue": round(value, 2),
    }


def _price_changes_for_location(location_id: int):
    invoices = PurchaseInvoice.query.filter_by(location_id=location_id).order_by(PurchaseInvoice.invoice_date.asc(), PurchaseInvoice.created_at.asc()).all()
    seen: dict[tuple[str, str], Decimal] = {}
    changes: list[dict[str, Any]] = []
    for invoice in invoices:
        for line in invoice.lines:
            item_key = _normalize_name(line.description)
            key = (invoice.supplier.normalized_name, item_key)
            previous = seen.get(key)
            if previous is not None and previous > 0:
                current = Decimal(line.unit_price).quantize(MONEY)
                change = ((current - previous) / previous) * 100
                if abs(change) >= 0.01:
                    changes.append(
                        {
                            "id": f"pc-{invoice.id}-{line.id}",
                            "invoiceId": invoice.id,
                            "invoiceDate": invoice.invoice_date.isoformat(),
                            "previousInvoiceDate": invoice.invoice_date.isoformat(),
                            "supplier": invoice.supplier.name,
                            "itemName": line.description,
                            "originalDescription": line.description,
                            "rawSourceLine": line.description,
                            "comparisonKey": line.normalized_description,
                            "category": line.inventory_item.category if line.inventory_item else "Other",
                            "previousPrice": float(previous),
                            "currentPrice": float(current),
                            "changePercent": round(float(change), 1),
                            "status": "Increased" if change > 0 else "Decreased" if change < 0 else "Stable",
                            "severity": "High" if abs(change) >= 10 else "Medium" if abs(change) >= 5 else "Low",
                        }
                    )
            seen[key] = Decimal(line.unit_price).quantize(MONEY)
    return list(reversed(changes[-25:]))


def _dashboard_snapshot(location_id: int):
    start = _start_of_week()
    invoices = PurchaseInvoice.query.filter_by(location_id=location_id).all()
    recent_invoices = sorted(invoices, key=lambda invoice: (invoice.created_at, invoice.invoice_date), reverse=True)[:5]
    draft_invoices = [invoice for invoice in invoices if invoice.status == "Draft"]
    movements = InventoryMovement.query.filter_by(location_id=location_id).order_by(InventoryMovement.created_at.desc()).limit(6).all()
    count_sessions = StockCountSession.query.filter_by(location_id=location_id).order_by(StockCountSession.updated_at.desc()).all()
    reorder_plans = ReorderPlan.query.filter_by(location_id=location_id).order_by(ReorderPlan.updated_at.desc()).all()
    inventory_items = InventoryItem.query.filter_by(location_id=location_id, active=True).all()
    recent_price_changes = _price_changes_for_location(location_id)
    inventory_summary = _inventory_summary(location_id)
    week_invoices = [invoice for invoice in invoices if invoice.invoice_date >= start.date()]
    week_spend = round(sum(float(invoice.total_amount) for invoice in week_invoices), 2)
    purchase_workflow = {
        "invoiceReviewQueueCount": len(draft_invoices),
        "inventoryReceiptCount": inventory_summary["inventoryReceiptCount"],
        "inventoryItemsToReorderCount": inventory_summary["inventoryReorderNowCount"] + inventory_summary["inventoryOutOfStockCount"],
        "todayReconciliationStatus": "Incomplete",
        "todayReconciliationVariance": 0,
    }
    top_supplier_totals: dict[str, dict[str, Any]] = {}
    for invoice in invoices:
        key = invoice.supplier.name
        bucket = top_supplier_totals.setdefault(key, {"supplier": key, "spend": 0.0, "invoiceCount": 0})
        bucket["spend"] += float(invoice.total_amount)
        bucket["invoiceCount"] += 1
    top_supplier = sorted(top_supplier_totals.values(), key=lambda entry: entry["spend"], reverse=True)[:3]
    top_reorder = [_reorder_suggestion_for_item(item) for item in inventory_items]
    top_reorder = [entry for entry in top_reorder if entry is not None]
    top_reorder.sort(key=lambda entry: (entry["stockStatus"] != "Out of stock", entry["stockStatus"] != "Reorder now", entry["suggestedQuantity"]), reverse=False)
    return {
        "summary": {
            "weeklyInvoiceCount": len(week_invoices),
            "weeklyInvoiceSpend": week_spend,
            "monthlyInvoiceCount": len(invoices),
            "monthlyInvoiceSpend": round(sum(float(invoice.total_amount) for invoice in invoices), 2),
            "invoiceReviewQueueCount": len(draft_invoices),
            **inventory_summary,
            "recentPriceChangeCount": len(recent_price_changes),
        },
        "recentInvoices": [serialize_purchase_invoice(invoice) for invoice in recent_invoices],
        "recentMovements": [serialize_inventory_movement(movement) for movement in movements],
        "recentPriceChanges": recent_price_changes[:6],
        "pendingDraftInvoices": [serialize_purchase_invoice(invoice) for invoice in draft_invoices[:5]],
        "pendingDraftCountSessions": [serialize_count_session(session_record) for session_record in count_sessions if session_record.status == "Draft"][:5],
        "pendingDraftReorderPlans": [serialize_reorder_plan(plan) for plan in reorder_plans if plan.status == "Draft"][:5],
        "supplierSpend": top_supplier,
        "reorderSuggestions": top_reorder[:12],
        "workflow": {
            "purchase": "Done" if any(invoice.status == "Completed" for invoice in invoices) else "Needs review",
            "review": "Needs review" if draft_invoices else "Done",
            "inventory": "Updated" if inventory_summary["inventoryReceiptCount"] > 0 else "Not ready",
            "reorder": "Alert" if inventory_summary["inventoryReorderNowCount"] or inventory_summary["inventoryOutOfStockCount"] else "Done",
            "close": "Not ready",
            "export": "Not ready",
        },
    }


def _get_supplier_by_name(organization_id: int, name: str) -> Supplier:
    normalized = _normalize_name(name)
    supplier = Supplier.query.filter_by(organization_id=organization_id, normalized_name=normalized).first()
    if supplier is None:
        supplier = Supplier(organization_id=organization_id, name=name.strip(), normalized_name=normalized, category_focus="Other", notes="")
        db.session.add(supplier)
        db.session.flush()
    return supplier


def _require_management_role(membership: OrganizationMembership):
    return _require_role(membership, "suppliers.manage")


def _validate_supplier_payload(payload: dict[str, Any]) -> dict[str, Any]:
    errors: dict[str, str] = {}
    name = str(payload.get("name") or "").strip()
    if not name:
        errors["name"] = "Supplier name is required."
    contact_email = str(payload.get("contactEmail") or "").strip()
    if contact_email and ("@" not in contact_email or "." not in contact_email.rsplit("@", 1)[-1]):
        errors["contactEmail"] = "Enter a valid email address."
    if errors:
        raise RequestValidationError("Supplier validation failed.", errors)
    return payload


def _serialize_supplier_with_counts(
    supplier: Supplier,
    *,
    inventory_item_count: int = 0,
    purchase_invoice_count: int = 0,
    supplier_item_mapping_count: int = 0,
    latest_invoice_date: date | None = None,
    historical_reference_count: int = 0,
    recent_invoices: list[dict[str, Any]] | None = None,
    recent_mappings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    payload = serialize_supplier(supplier)
    payload.update(
        {
            "inventoryItemCount": inventory_item_count,
            "purchaseInvoiceCount": purchase_invoice_count,
            "supplierItemMappingCount": supplier_item_mapping_count,
            "latestInvoiceDate": latest_invoice_date.isoformat() if latest_invoice_date else None,
            "historicalReferenceCount": historical_reference_count,
            "recentInvoices": recent_invoices or [],
            "recentMappings": recent_mappings or [],
        }
    )
    return payload


def _validate_invoice_payload(payload: dict[str, Any]) -> dict[str, Any]:
    errors: dict[str, str] = {}
    supplier_name = str(payload.get("supplierName") or payload.get("supplier") or "").strip()
    if not supplier_name:
        errors["supplierName"] = "Supplier is required."
    invoice_number = str(payload.get("invoiceNumber") or "").strip()
    if not invoice_number:
        errors["invoiceNumber"] = "Invoice number is required."
    invoice_date_value = payload.get("invoiceDate")
    if not invoice_date_value:
        errors["invoiceDate"] = "Invoice date is required."
    total_amount = payload.get("totalAmount")
    if total_amount in (None, ""):
        errors["totalAmount"] = "Total is required."
    lines = payload.get("lineItems")
    if not isinstance(lines, list) or not lines:
        errors["lineItems"] = "Add at least one invoice line."
    if errors:
        raise RequestValidationError("Invoice validation failed.", errors)
    return payload


def _invoice_from_payload(organization_id: int, location_id: int, payload: dict[str, Any], *, existing: PurchaseInvoice | None = None):
    supplier = _get_supplier_by_name(organization_id, str(payload.get("supplierName") or payload.get("supplier") or ""))
    invoice = existing or PurchaseInvoice(
        organization_id=organization_id,
        location_id=location_id,
        supplier_id=supplier.id,
        invoice_number=str(payload.get("invoiceNumber") or "").strip(),
        invoice_date=_parse_date(payload.get("invoiceDate"), field="invoiceDate"),
    )
    invoice.supplier_id = supplier.id
    invoice.invoice_number = str(payload.get("invoiceNumber") or "").strip()
    invoice.invoice_date = _parse_date(payload.get("invoiceDate"), field="invoiceDate")
    invoice.subtotal = _to_decimal(payload.get("subtotal", 0), field="subtotal", required=False)
    invoice.tax = _to_decimal(payload.get("tax", 0), field="tax", required=False)
    invoice.total_amount = _to_decimal(payload.get("totalAmount"), field="totalAmount")
    invoice.notes = str(payload.get("notes") or "").strip()
    invoice.status = str(payload.get("status") or "Draft")
    invoice.source_file_name = str(payload.get("sourceFileName") or payload.get("fileName") or "").strip()
    invoice.source_file_type = str(payload.get("sourceFileType") or payload.get("fileType") or "").strip()
    invoice.source_file_key = str(payload.get("sourceFileKey") or "").strip()
    invoice.extracted_text = str(payload.get("extractedText") or "").strip()
    invoice.extraction_status = str(payload.get("extractionStatus") or "manual").strip()
    return invoice, supplier


def _replace_invoice_lines(invoice: PurchaseInvoice, organization_id: int, payload_lines: list[dict[str, Any]]):
    if invoice.lines:
        invoice.lines = []
        db.session.flush()

    line_map: list[PurchaseInvoiceLine] = []
    for index, line_payload in enumerate(payload_lines):
        description = str(line_payload.get("description") or line_payload.get("itemName") or "").strip()
        if not description:
            raise RequestValidationError("Invoice validation failed.", {f"lineItems[{index}].description": "Description is required."})
        mapped_item_id = line_payload.get("inventoryItemId")
        inventory_item = None
        if mapped_item_id:
            inventory_item = InventoryItem.query.filter_by(id=int(mapped_item_id), organization_id=organization_id, location_id=invoice.location_id).first()
            if inventory_item is None:
                raise RequestValidationError("Invoice validation failed.", {f"lineItems[{index}].inventoryItemId": "That inventory item is not available for this location."})

        quantity = _to_quantity(line_payload.get("quantity", 0), field=f"lineItems[{index}].quantity", required=False)
        unit_price = _to_decimal(line_payload.get("unitPrice", 0), field=f"lineItems[{index}].unitPrice", required=False)
        line_total = _to_decimal(line_payload.get("lineTotal", quantity * unit_price), field=f"lineItems[{index}].lineTotal", required=False)
        confidence = _to_decimal(line_payload.get("confidence", 0), field=f"lineItems[{index}].confidence", required=False, places="0.0001")
        conversion_factor = _to_quantity(line_payload.get("conversionFactor", 1), field=f"lineItems[{index}].conversionFactor", required=False)
        previous_price = line_payload.get("previousUnitPrice")
        price_change_percent = line_payload.get("priceChangePercent")
        line_map.append(
            PurchaseInvoiceLine(
                invoice=invoice,
                inventory_item_id=inventory_item.id if inventory_item else None,
                line_index=index,
                description=description,
                normalized_description=_normalize_name(str(line_payload.get("normalizedDescription") or description)),
                purchase_unit=str(line_payload.get("purchaseUnit") or "each").strip(),
                inventory_unit=str(line_payload.get("inventoryUnit") or (inventory_item.stock_unit if inventory_item else "each")).strip(),
                conversion_factor=conversion_factor,
                quantity=quantity,
                unit_price=unit_price,
                line_total=line_total,
                confidence=confidence,
                needs_review=bool(line_payload.get("needsReview", True)),
                previous_unit_price=_to_decimal(previous_price, field=f"lineItems[{index}].previousUnitPrice", required=False) if previous_price not in (None, "") else None,
                price_change_percent=_to_decimal(price_change_percent, field=f"lineItems[{index}].priceChangePercent", required=False, places="0.01") if price_change_percent not in (None, "") else None,
                note=str(line_payload.get("note") or "").strip(),
            )
        )
    invoice.lines = line_map


def _sync_supplier_item_mappings(invoice: PurchaseInvoice, actor_id: int):
    now = _now()
    for line in invoice.lines:
        if line.inventory_item_id is None:
            continue
        if line.conversion_factor <= 0:
            raise RequestValidationError("Invoice validation failed.", {f"lineItems[{line.line_index}].conversionFactor": "Conversion factor must be greater than zero."})
        inventory_item = InventoryItem.query.filter_by(id=line.inventory_item_id, organization_id=invoice.organization_id, location_id=invoice.location_id).first()
        if inventory_item is None:
            continue
        mapping = SupplierItemMapping.query.filter_by(
            organization_id=invoice.organization_id,
            supplier_id=invoice.supplier_id,
            inventory_item_id=inventory_item.id,
            normalized_supplier_item_name=_normalize_name(line.description),
        ).first()
        if mapping is None:
            mapping = SupplierItemMapping(
                organization_id=invoice.organization_id,
                supplier_id=invoice.supplier_id,
                inventory_item_id=inventory_item.id,
                supplier_item_name=line.description,
                normalized_supplier_item_name=_normalize_name(line.description),
                purchase_unit=line.purchase_unit,
                inventory_unit=line.inventory_unit or inventory_item.stock_unit,
                conversion_factor=line.conversion_factor,
                last_seen_at=invoice.invoice_date,
                created_by_user_id=actor_id,
                updated_by_user_id=actor_id,
            )
            db.session.add(mapping)
        else:
            mapping.supplier_item_name = line.description
            mapping.purchase_unit = line.purchase_unit
            mapping.inventory_unit = line.inventory_unit or inventory_item.stock_unit
            mapping.conversion_factor = line.conversion_factor
            mapping.last_seen_at = invoice.invoice_date
            mapping.updated_by_user_id = actor_id
        line.supplier_item_mapping = mapping


def _record_receipt(invoice: PurchaseInvoice, actor_id: int):
    if invoice.status in {"Completed", "Corrected"}:
        raise RequestValidationError("Invoice already received.", {"invoice": "This invoice has already been received."})

    mapped_lines = [line for line in invoice.lines if line.inventory_item_id]
    if not mapped_lines:
        raise RequestValidationError("Invoice receipt failed.", {"lineItems": "Map at least one line to inventory before receiving."})

    unmapped = [line.description for line in invoice.lines if not line.inventory_item_id]
    if unmapped:
        raise RequestValidationError("Invoice receipt failed.", {"lineItems": f"Map all invoice lines before receiving. Unmapped: {', '.join(unmapped[:3])}{'...' if len(unmapped) > 3 else ''}"})

    now = _now()
    for line in invoice.lines:
        item = InventoryItem.query.filter_by(id=line.inventory_item_id, organization_id=invoice.organization_id, location_id=invoice.location_id).first() if line.inventory_item_id else None
        if item is None:
            continue
        quantity_delta = (Decimal(line.quantity) * Decimal(line.conversion_factor)).quantize(QTY)
        before = Decimal(item.current_on_hand)
        after = (before + quantity_delta).quantize(QTY)
        if after < 0:
            raise RequestValidationError("Inventory receipt failed.", {"inventory": f"Receiving {line.description} would make {item.name} negative."})

        existing = InventoryMovement.query.filter_by(
            organization_id=invoice.organization_id,
            location_id=invoice.location_id,
            source_type="invoice receipt",
            source_record_id=str(invoice.id),
            source_line_id=str(line.id),
        ).first()
        if existing is not None:
            raise RequestValidationError("Invoice already received.", {"invoice": "This invoice has already been received."})

        movement = InventoryMovement(
            organization_id=invoice.organization_id,
            location_id=invoice.location_id,
            inventory_item_id=item.id,
            quantity_delta=quantity_delta,
            quantity_before=before,
            quantity_after=after,
            unit=item.stock_unit,
            source_type="invoice receipt",
            source_record_id=str(invoice.id),
            source_line_id=str(line.id),
            reason=f"Invoice {invoice.invoice_number} received",
            actor_user_id=actor_id,
        )
        item.current_on_hand = after
        item.latest_purchase_price = line.unit_price
        item.last_purchase_unit = line.purchase_unit
        item.last_purchase_conversion_factor = line.conversion_factor
        item.preferred_supplier_name = invoice.supplier.name
        item.last_received_at = now
        item.updated_by_user_id = actor_id
        item.updated_at = now

        mapping = SupplierItemMapping.query.filter_by(
            organization_id=invoice.organization_id,
            supplier_id=invoice.supplier_id,
            inventory_item_id=item.id,
            normalized_supplier_item_name=_normalize_name(line.description),
        ).first()
        if mapping is None:
            mapping = SupplierItemMapping(
                organization_id=invoice.organization_id,
                supplier_id=invoice.supplier_id,
                inventory_item_id=item.id,
                supplier_item_name=line.description,
                normalized_supplier_item_name=_normalize_name(line.description),
                purchase_unit=line.purchase_unit,
                inventory_unit=item.stock_unit,
                conversion_factor=line.conversion_factor,
                last_seen_at=invoice.invoice_date,
                created_by_user_id=actor_id,
                updated_by_user_id=actor_id,
            )
            db.session.add(mapping)
        else:
            mapping.supplier_item_name = line.description
            mapping.purchase_unit = line.purchase_unit
            mapping.inventory_unit = item.stock_unit
            mapping.conversion_factor = line.conversion_factor
            mapping.last_seen_at = now
            mapping.updated_by_user_id = actor_id

        if line.previous_unit_price and line.previous_unit_price > 0:
            line.price_change_percent = (((line.unit_price - line.previous_unit_price) / line.previous_unit_price) * 100).quantize(Decimal("0.1"))
        else:
            line.price_change_percent = None
        line.previous_unit_price = line.previous_unit_price
        line.needs_review = False

        db.session.add(movement)

    invoice.status = "Completed"
    invoice.received_at = now
    invoice.received_by_user_id = actor_id
    invoice.updated_by_user_id = actor_id
    invoice.posted_at = now


def _latest_completed_receipt_line_for_item(organization_id: int, location_id: int, item_id: int, *, excluded_invoice_id: int | None = None):
    query = (
        PurchaseInvoiceLine.query.join(PurchaseInvoice, PurchaseInvoiceLine.invoice_id == PurchaseInvoice.id)
        .filter(
            PurchaseInvoice.organization_id == organization_id,
            PurchaseInvoice.location_id == location_id,
            PurchaseInvoice.status == "Completed",
            PurchaseInvoiceLine.inventory_item_id == item_id,
        )
    )
    if excluded_invoice_id is not None:
        query = query.filter(PurchaseInvoice.id != excluded_invoice_id)
    return query.order_by(
        PurchaseInvoice.invoice_date.desc(),
        PurchaseInvoice.created_at.desc(),
        PurchaseInvoice.id.desc(),
        PurchaseInvoiceLine.line_index.desc(),
    ).first()


def _refresh_inventory_snapshot_from_recent_receipt(
    organization_id: int,
    location_id: int,
    item: InventoryItem,
    *,
    excluded_invoice_id: int | None = None,
    actor_id: int | None = None,
):
    latest_line = _latest_completed_receipt_line_for_item(organization_id, location_id, item.id, excluded_invoice_id=excluded_invoice_id)
    now = _now()
    if actor_id is not None:
        item.updated_by_user_id = actor_id
    item.updated_at = now
    if latest_line is None:
        item.latest_purchase_price = Decimal("0")
        item.last_purchase_unit = item.stock_unit
        item.last_purchase_conversion_factor = Decimal("1")
        item.preferred_supplier_name = ""
        item.supplier_id = None
        item.last_received_at = None
        return

    item.latest_purchase_price = latest_line.unit_price
    item.last_purchase_unit = latest_line.purchase_unit
    item.last_purchase_conversion_factor = latest_line.conversion_factor
    item.preferred_supplier_name = latest_line.invoice.supplier.name if latest_line.invoice and latest_line.invoice.supplier else ""
    item.supplier_id = latest_line.invoice.supplier_id if latest_line.invoice else None
    item.last_received_at = latest_line.invoice.received_at or latest_line.invoice.posted_at or now


@bp.post("/api/pilot/purchases/invoices/<int:invoice_id>/correct")
@login_required
def correct_purchase_invoice(invoice_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "purchases.manage")
    if permission_error is not None:
        return permission_error
    invoice = PurchaseInvoice.query.filter_by(id=invoice_id, organization_id=organization.id, location_id=location.id).first()
    if invoice is None:
        return json_error("Purchase invoice not found.", 404)
    if invoice.status == "Corrected":
        return json_error("This invoice has already been corrected.", 409)
    if invoice.status != "Completed":
        return json_error("Only completed invoices can be corrected.", 409)

    payload = _json_body()
    reason = str(payload.get("reason") or "").strip()
    if not reason:
        return json_error("Validation failed.", 400, errors={"reason": "Enter a correction reason."})

    existing_correction = InventoryMovement.query.filter_by(
        organization_id=invoice.organization_id,
        location_id=invoice.location_id,
        source_type="invoice correction",
        source_record_id=str(invoice.id),
    ).first()
    if existing_correction is not None:
        return json_error("This invoice has already been corrected.", 409)

    now = _now()
    affected_items: set[int] = set()

    try:
        for line in invoice.lines:
            item = InventoryItem.query.filter_by(id=line.inventory_item_id, organization_id=invoice.organization_id, location_id=invoice.location_id).first() if line.inventory_item_id else None
            if item is None:
                continue

            receipt_movement = InventoryMovement.query.filter_by(
                organization_id=invoice.organization_id,
                location_id=invoice.location_id,
                source_type="invoice receipt",
                source_record_id=str(invoice.id),
                source_line_id=str(line.id),
            ).first()
            if receipt_movement is None:
                return json_error("This invoice cannot be corrected because its receipt movements are missing.", 409)

            correction_delta = Decimal(receipt_movement.quantity_delta) * Decimal("-1")
            before = Decimal(item.current_on_hand)
            after = (before + correction_delta).quantize(QTY)
            if after < 0:
                return json_error(
                    "This invoice cannot be corrected because stock has already moved.",
                    409,
                    errors={"inventory": f"Correction would make {item.name} negative."},
                )

            movement = InventoryMovement(
                organization_id=invoice.organization_id,
                location_id=invoice.location_id,
                inventory_item_id=item.id,
                quantity_delta=correction_delta,
                quantity_before=before,
                quantity_after=after,
                unit=item.stock_unit,
                source_type="invoice correction",
                source_record_id=str(invoice.id),
                source_line_id=str(line.id),
                reason=f"Correction for invoice {invoice.invoice_number}: {reason}",
                actor_user_id=current_user.id,
            )
            item.current_on_hand = after
            affected_items.add(item.id)
            db.session.add(movement)

        invoice.status = "Corrected"
        invoice.updated_by_user_id = current_user.id
        invoice.posted_at = now

        for item_id in affected_items:
            item = InventoryItem.query.filter_by(id=item_id, organization_id=invoice.organization_id, location_id=invoice.location_id).first()
            if item is None:
                continue
            _refresh_inventory_snapshot_from_recent_receipt(
                invoice.organization_id,
                invoice.location_id,
                item,
                excluded_invoice_id=invoice.id,
                actor_id=current_user.id,
            )

        record_audit_event(
            event_type="purchases.invoice_corrected",
            entity_type="purchase_invoice",
            entity_id=invoice.id,
            organization_id=organization.id,
            location_id=location.id,
            actor_user_id=current_user.id,
            metadata={
                "invoiceNumber": invoice.invoice_number,
                "reason": reason,
                "affectedItemIds": sorted(affected_items),
            },
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise

    return jsonify(serialize_purchase_invoice(invoice)), 200


@bp.get("/api/pilot/bootstrap")
@login_required
def bootstrap():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, locations, location = context
    permission_error = _require_role(membership, "operational.read")
    if permission_error is not None:
        return permission_error
    return (
        jsonify(
            {
                "user": {
                    "id": current_user.id,
                    "email": current_user.email,
                },
                "membershipRole": membership.role,
                "organization": {
                    "id": organization.id,
                    "name": organization.name,
                },
                "locations": [serialize_location(entry) for entry in locations],
                "currentLocation": serialize_location(location),
            }
        ),
        200,
    )


@bp.post("/api/locations/current")
@login_required
def set_current_location():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, locations, _ = context
    permission_error = _require_role(membership, "operational.read")
    if permission_error is not None:
        return permission_error
    payload = _json_body()
    location_id = _to_int(payload.get("locationId"), field="locationId")
    location = _check_location_access(location_id, locations)
    if location is None:
        return json_error("That location is not available to the current account.", 403)
    session["pilot_current_location_id"] = location.id
    record_audit_event(
        event_type="tenant.location_selected",
        entity_type="restaurant_location",
        entity_id=location.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"source": "legacy-location-endpoint", "membershipRole": membership.role},
    )
    db.session.commit()
    return jsonify({"currentLocation": serialize_location(location)}), 200


@bp.get("/api/pilot/dashboard")
@login_required
def dashboard():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    _, membership, _, location = context
    permission_error = _require_role(membership, "operational.read")
    if permission_error is not None:
        return permission_error
    return jsonify(_dashboard_snapshot(location.id)), 200


@bp.get("/api/pilot/purchases")
@login_required
def purchases():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    _, membership, _, location = context
    permission_error = _require_role(membership, "operational.read")
    if permission_error is not None:
        return permission_error
    invoices = PurchaseInvoice.query.filter_by(location_id=location.id).order_by(PurchaseInvoice.invoice_date.desc(), PurchaseInvoice.created_at.desc()).all()
    suppliers = Supplier.query.filter_by(organization_id=location.organization_id, is_active=True).order_by(Supplier.name.asc()).all()
    purchase_lines = [line for invoice in invoices for line in invoice.lines]
    price_changes = [change for change in _price_changes_for_location(location.id) if change["status"] in {"Increased", "Decreased"}]
    ready_for_csv = sum(1 for invoice in invoices if invoice.status == "Completed")
    needs_review = sum(1 for invoice in invoices if invoice.status == "Draft")
    needs_mapping = sum(1 for invoice in invoices if invoice.status == "Ready" and any(not line.inventory_item_id for line in invoice.lines))
    return (
        jsonify(
            {
                "invoices": [serialize_purchase_invoice(invoice) for invoice in invoices],
                "suppliers": [serialize_supplier(supplier) for supplier in suppliers],
                "purchaseLines": [serialize_purchase_invoice_line(line) for line in purchase_lines],
                "priceChanges": price_changes,
                "summary": {
                    "thisMonthSpend": round(sum(float(invoice.total_amount) for invoice in invoices if invoice.invoice_date >= (_now().date().replace(day=1))), 2),
                    "uploadsNeedingReview": needs_review,
                    "priceChangesFlagged": len(price_changes),
                    "mappedItems": sum(1 for line in purchase_lines if line.inventory_item_id),
                    "exportReady": ready_for_csv,
                    "needsMapping": needs_mapping,
                },
                "exportReadiness": {
                    "readyForCsv": ready_for_csv,
                    "needsReview": needs_review,
                    "needsMapping": needs_mapping,
                    "quickBooksFutureOnly": True,
                },
            }
        ),
        200,
    )


@bp.get("/api/pilot/suppliers")
@login_required
def suppliers():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "suppliers.manage")
    if permission_error is not None:
        return permission_error
    supplier_rows = Supplier.query.filter_by(organization_id=organization.id).order_by(Supplier.is_active.desc(), Supplier.name.asc()).all()
    inventory_items = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id).all()
    invoices = PurchaseInvoice.query.filter_by(organization_id=organization.id, location_id=location.id).all()
    mappings = SupplierItemMapping.query.filter_by(organization_id=organization.id).all()
    item_counts: dict[int, int] = {}
    invoice_counts: dict[int, int] = {}
    mapping_counts: dict[int, int] = {}
    latest_invoice_dates: dict[int, date] = {}
    for item in inventory_items:
        if item.supplier_id is None:
            continue
        item_counts[item.supplier_id] = item_counts.get(item.supplier_id, 0) + 1
    for mapping in mappings:
        mapping_counts[mapping.supplier_id] = mapping_counts.get(mapping.supplier_id, 0) + 1
    for invoice in invoices:
        supplier_id = invoice.supplier_id
        if supplier_id is None:
            continue
        invoice_counts[supplier_id] = invoice_counts.get(supplier_id, 0) + 1
        previous = latest_invoice_dates.get(supplier_id)
        if previous is None or invoice.invoice_date > previous:
            latest_invoice_dates[supplier_id] = invoice.invoice_date
    invoices_by_supplier: dict[int, list[PurchaseInvoice]] = {}
    for invoice in sorted(invoices, key=lambda entry: (entry.invoice_date, entry.created_at), reverse=True):
        invoices_by_supplier.setdefault(invoice.supplier_id, []).append(invoice)
    mappings_by_supplier: dict[int, list[SupplierItemMapping]] = {}
    for mapping in sorted(mappings, key=lambda entry: (entry.updated_at or entry.created_at, entry.created_at), reverse=True):
        mappings_by_supplier.setdefault(mapping.supplier_id, []).append(mapping)
    return (
        jsonify(
            {
                "suppliers": [
                    _serialize_supplier_with_counts(
                        supplier,
                        inventory_item_count=item_counts.get(supplier.id, 0),
                        purchase_invoice_count=invoice_counts.get(supplier.id, 0),
                        supplier_item_mapping_count=mapping_counts.get(supplier.id, 0),
                        latest_invoice_date=latest_invoice_dates.get(supplier.id),
                        historical_reference_count=item_counts.get(supplier.id, 0) + invoice_counts.get(supplier.id, 0) + mapping_counts.get(supplier.id, 0),
                        recent_invoices=[
                            {
                                "id": invoice.id,
                                "invoiceNumber": invoice.invoice_number,
                                "invoiceDate": invoice.invoice_date.isoformat(),
                                "status": invoice.status,
                                "totalAmount": decimal_to_float(invoice.total_amount) or 0,
                            }
                            for invoice in invoices_by_supplier.get(supplier.id, [])[:3]
                        ],
                        recent_mappings=[
                            {
                                "id": mapping.id,
                                "supplierItemName": mapping.supplier_item_name,
                                "inventoryItemName": mapping.inventory_item.name if mapping.inventory_item else "",
                                "purchaseUnit": mapping.purchase_unit,
                                "inventoryUnit": mapping.inventory_unit,
                                "conversionFactor": decimal_to_float(mapping.conversion_factor) or 1,
                                "lastSeenAt": isoformat(mapping.last_seen_at),
                            }
                            for mapping in mappings_by_supplier.get(supplier.id, [])[:3]
                        ],
                    )
                    for supplier in supplier_rows
                ]
            }
        ),
        200,
    )


@bp.post("/api/pilot/suppliers")
@login_required
def create_supplier():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, _ = context
    permission_error = _require_role(membership, "suppliers.manage")
    if permission_error is not None:
        return permission_error
    payload = _validate_supplier_payload(_json_body())
    name = str(payload.get("name") or "").strip()
    normalized = _normalize_name(name)
    existing = Supplier.query.filter_by(organization_id=organization.id, normalized_name=normalized).first()
    if existing is not None:
        return json_error("A supplier with that name already exists.", 409)
    supplier = Supplier(
        organization_id=organization.id,
        name=name,
        normalized_name=normalized,
        category_focus=str(payload.get("categoryFocus") or "Other").strip() or "Other",
        contact_name=str(payload.get("contactName") or "").strip(),
        contact_phone=str(payload.get("contactPhone") or "").strip(),
        contact_email=str(payload.get("contactEmail") or "").strip(),
        ordering_notes=str(payload.get("orderingNotes") or "").strip(),
        notes=str(payload.get("notes") or "").strip(),
        is_active=bool(payload.get("isActive", True)),
    )
    db.session.add(supplier)
    db.session.flush()
    record_audit_event(
        event_type="suppliers.created",
        entity_type="supplier",
        entity_id=supplier.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"supplierName": supplier.name, "categoryFocus": supplier.category_focus, "isActive": supplier.is_active},
    )
    db.session.commit()
    return jsonify(_serialize_supplier_with_counts(supplier)), 201


@bp.patch("/api/pilot/suppliers/<int:supplier_id>")
@login_required
def update_supplier(supplier_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, _ = context
    permission_error = _require_role(membership, "suppliers.manage")
    if permission_error is not None:
        return permission_error
    supplier = Supplier.query.filter_by(id=supplier_id, organization_id=organization.id).first()
    if supplier is None:
        return json_error("Supplier not found.", 404)
    payload = _json_body()
    if "name" in payload:
        _validate_supplier_payload(payload)
    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            return json_error("Validation failed.", 400, errors={"name": "Supplier name is required."})
        normalized = _normalize_name(name)
        duplicate = Supplier.query.filter(
            Supplier.organization_id == organization.id,
            Supplier.normalized_name == normalized,
            Supplier.id != supplier.id,
        ).first()
        if duplicate is not None:
            return json_error("A supplier with that name already exists.", 409)
        supplier.name = name
        supplier.normalized_name = normalized
    if "categoryFocus" in payload:
        supplier.category_focus = str(payload.get("categoryFocus") or "Other").strip() or "Other"
    if "contactName" in payload:
        supplier.contact_name = str(payload.get("contactName") or "").strip()
    if "contactPhone" in payload:
        supplier.contact_phone = str(payload.get("contactPhone") or "").strip()
    if "contactEmail" in payload:
        contact_email = str(payload.get("contactEmail") or "").strip()
        if contact_email and ("@" not in contact_email or "." not in contact_email.rsplit("@", 1)[-1]):
            return json_error("Validation failed.", 400, errors={"contactEmail": "Enter a valid email address."})
        supplier.contact_email = contact_email
    if "orderingNotes" in payload:
        supplier.ordering_notes = str(payload.get("orderingNotes") or "").strip()
    if "notes" in payload:
        supplier.notes = str(payload.get("notes") or "").strip()
    if "isActive" in payload:
        supplier.is_active = bool(payload.get("isActive"))
    record_audit_event(
        event_type="suppliers.updated",
        entity_type="supplier",
        entity_id=supplier.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"supplierName": supplier.name, "isActive": supplier.is_active},
    )
    db.session.commit()
    return jsonify(_serialize_supplier_with_counts(supplier)), 200


@bp.get("/api/pilot/purchases/invoices/<int:invoice_id>")
@login_required
def purchase_invoice_detail(invoice_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "operational.read")
    if permission_error is not None:
        return permission_error
    invoice = PurchaseInvoice.query.filter_by(id=invoice_id, organization_id=organization.id, location_id=location.id).first()
    if invoice is None:
        return json_error("Purchase invoice not found.", 404)
    return jsonify(serialize_purchase_invoice(invoice)), 200


@bp.post("/api/pilot/purchases/invoices")
@login_required
def create_purchase_invoice():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "purchases.manage")
    if permission_error is not None:
        return permission_error
    payload = _validate_invoice_payload(_json_body())
    invoice, supplier = _invoice_from_payload(organization.id, location.id, payload)
    invoice.created_by_user_id = current_user.id
    invoice.updated_by_user_id = current_user.id
    invoice.extraction_status = str(payload.get("extractionStatus") or "manual")
    _replace_invoice_lines(invoice, organization.id, list(payload.get("lineItems") or []))
    _sync_supplier_item_mappings(invoice, current_user.id)
    db.session.add(invoice)
    db.session.flush()
    for line in invoice.lines:
        if line.inventory_item_id is None:
            continue
        mapping = SupplierItemMapping.query.filter_by(
            organization_id=organization.id,
            supplier_id=supplier.id,
            inventory_item_id=line.inventory_item_id,
            normalized_supplier_item_name=_normalize_name(line.description),
        ).first()
        if mapping:
            line.supplier_item_mapping = mapping
    record_audit_event(
        event_type="purchases.invoice_created",
        entity_type="purchase_invoice",
        entity_id=invoice.invoice_number,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"invoiceId": invoice.id, "invoiceNumber": invoice.invoice_number, "status": invoice.status},
    )
    db.session.commit()
    return jsonify(serialize_purchase_invoice(invoice)), 201


@bp.patch("/api/pilot/purchases/invoices/<int:invoice_id>")
@login_required
def update_purchase_invoice(invoice_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, _, _, location = context
    permission_error = _require_role(get_current_membership(), "purchases.manage")
    if permission_error is not None:
        return permission_error
    invoice = PurchaseInvoice.query.filter_by(id=invoice_id, organization_id=organization.id, location_id=location.id).first()
    if invoice is None:
        return json_error("Purchase invoice not found.", 404)
    if invoice.status in {"Completed", "Corrected"}:
        return json_error("Completed invoices are read-only.", 409)
    body = _json_body()
    payload = _validate_invoice_payload({**body, "supplierName": body.get("supplierName") or body.get("supplier")})
    invoice, _ = _invoice_from_payload(organization.id, location.id, payload, existing=invoice)
    invoice.updated_by_user_id = current_user.id
    _replace_invoice_lines(invoice, organization.id, list(payload.get("lineItems") or []))
    _sync_supplier_item_mappings(invoice, current_user.id)
    for line in invoice.lines:
        if line.inventory_item_id is None:
            continue
        mapping = SupplierItemMapping.query.filter_by(
            organization_id=organization.id,
            supplier_id=invoice.supplier_id,
            inventory_item_id=line.inventory_item_id,
            normalized_supplier_item_name=_normalize_name(line.description),
        ).first()
        if mapping:
            line.supplier_item_mapping = mapping
    record_audit_event(
        event_type="purchases.invoice_updated",
        entity_type="purchase_invoice",
        entity_id=invoice.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"invoiceNumber": invoice.invoice_number, "status": invoice.status},
    )
    db.session.commit()
    return jsonify(serialize_purchase_invoice(invoice)), 200


@bp.post("/api/pilot/purchases/invoices/<int:invoice_id>/receive")
@login_required
def receive_purchase_invoice(invoice_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, _, _, location = context
    permission_error = _require_role(get_current_membership(), "purchases.manage")
    if permission_error is not None:
        return permission_error
    invoice = PurchaseInvoice.query.filter_by(id=invoice_id, organization_id=organization.id, location_id=location.id).first()
    if invoice is None:
        return json_error("Purchase invoice not found.", 404)
    if invoice.status == "Corrected":
        return json_error("This invoice has already been corrected.", 409)
    try:
        _record_receipt(invoice, current_user.id)
        record_audit_event(
            event_type="purchases.invoice_received",
            entity_type="purchase_invoice",
            entity_id=invoice.id,
            organization_id=organization.id,
            location_id=location.id,
            actor_user_id=current_user.id,
            metadata={"invoiceNumber": invoice.invoice_number, "status": invoice.status},
        )
        db.session.commit()
    except RequestValidationError as exc:
        db.session.rollback()
        if exc.message == "Invoice already received.":
            return json_error(exc.message, 409, errors=exc.errors)
        return json_error(exc.message, 400, errors=exc.errors)
    return jsonify(serialize_purchase_invoice(invoice)), 200


@bp.get("/api/pilot/inventory")
@login_required
def inventory():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "operational.read")
    if permission_error is not None:
        return permission_error
    items = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id).order_by(InventoryItem.updated_at.desc(), InventoryItem.created_at.desc()).all()
    movements = InventoryMovement.query.filter_by(organization_id=organization.id, location_id=location.id).order_by(InventoryMovement.created_at.desc()).limit(50).all()
    count_sessions = StockCountSession.query.filter_by(organization_id=organization.id, location_id=location.id).order_by(StockCountSession.updated_at.desc()).all()
    reorder_intents = ReorderIntent.query.filter_by(organization_id=organization.id, location_id=location.id).all()
    reorder_suggestions = [entry for entry in (_reorder_suggestion_for_item(item) for item in items) if entry]
    for suggestion in reorder_suggestions:
        intent = next((entry for entry in reorder_intents if entry.inventory_item_id == suggestion["inventoryItemId"]), None)
        if intent:
            suggestion["status"] = intent.status
            suggestion["adjustedQuantity"] = float(intent.adjusted_quantity)
            suggestion["estimatedCost"] = decimal_to_float(intent.estimated_cost)
    reorder_suggestions.sort(key=lambda entry: (entry["stockStatus"] != "Out of stock", entry["stockStatus"] != "Reorder now", entry["inventoryItemName"]))
    return (
        jsonify(
            {
                "items": [serialize_inventory_item(item) for item in items],
                "movements": [serialize_inventory_movement(movement) for movement in movements],
                "countSessions": [serialize_count_session(session_record) for session_record in count_sessions],
                "reorderPlan": {
                    "suggestions": reorder_suggestions,
                    "groupedBySupplier": _group_reorder_by_supplier(reorder_suggestions),
                },
                "summary": _inventory_summary(location.id),
            }
        ),
        200,
    )


def _group_reorder_by_supplier(suggestions: list[dict[str, Any]]):
    groups: dict[str, list[dict[str, Any]]] = {}
    for suggestion in suggestions:
        groups.setdefault(suggestion["supplier"] or "Unknown supplier", []).append(suggestion)
    return [
        {
            "supplier": supplier,
            "lines": lines,
            "itemCount": len(lines),
            "estimatedOrderTotal": round(sum(float(line["estimatedCost"] or 0) for line in lines), 2),
        }
        for supplier, lines in sorted(groups.items(), key=lambda entry: entry[0].lower())
    ]


def _inventory_item_has_history(item: InventoryItem, organization_id: int, location_id: int) -> bool:
    has_invoice_history = (
        PurchaseInvoiceLine.query.join(PurchaseInvoice, PurchaseInvoiceLine.invoice_id == PurchaseInvoice.id)
        .filter(
            PurchaseInvoice.organization_id == organization_id,
            PurchaseInvoice.location_id == location_id,
            PurchaseInvoiceLine.inventory_item_id == item.id,
        )
        .first()
        is not None
    )
    if has_invoice_history:
        return True

    has_movement_history = InventoryMovement.query.filter_by(
        organization_id=organization_id,
        location_id=location_id,
        inventory_item_id=item.id,
    ).first()
    return has_movement_history is not None


@bp.get("/api/pilot/inventory/items/<int:item_id>")
@login_required
def inventory_item_detail(item_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "operational.read")
    if permission_error is not None:
        return permission_error
    item = InventoryItem.query.filter_by(id=item_id, organization_id=organization.id, location_id=location.id).first()
    if item is None:
        return json_error("Inventory item not found.", 404)

    purchase_history = (
        PurchaseInvoiceLine.query.join(PurchaseInvoice, PurchaseInvoiceLine.invoice_id == PurchaseInvoice.id)
        .filter(
            PurchaseInvoice.organization_id == organization.id,
            PurchaseInvoice.location_id == location.id,
            PurchaseInvoiceLine.inventory_item_id == item.id,
        )
        .order_by(PurchaseInvoice.invoice_date.desc(), PurchaseInvoice.created_at.desc(), PurchaseInvoiceLine.line_index.desc())
        .limit(12)
        .all()
    )
    movement_history = (
        InventoryMovement.query.filter_by(organization_id=organization.id, location_id=location.id, inventory_item_id=item.id)
        .order_by(InventoryMovement.created_at.desc())
        .limit(20)
        .all()
    )
    supplier_mappings = (
        SupplierItemMapping.query.filter_by(organization_id=organization.id, inventory_item_id=item.id)
        .order_by(SupplierItemMapping.updated_at.desc(), SupplierItemMapping.created_at.desc())
        .limit(10)
        .all()
    )

    return (
        jsonify(
            {
                "item": serialize_inventory_item(item),
                "purchaseHistory": [serialize_purchase_invoice_line(line) for line in purchase_history],
                "movementHistory": [serialize_inventory_movement(movement) for movement in movement_history],
                "supplierMappings": [serialize_supplier_item_mapping(mapping) for mapping in supplier_mappings],
            }
        ),
        200,
    )


@bp.post("/api/pilot/inventory/items")
@login_required
def create_inventory_item():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "inventory.manage")
    if permission_error is not None:
        return permission_error
    payload = _json_body()
    name = str(payload.get("name") or "").strip()
    if not name:
        return json_error("Validation failed.", 400, errors={"name": "Name is required."})
    normalized = _normalize_name(name)
    existing = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, normalized_name=normalized).first()
    if existing:
        return json_error("An inventory item with that name already exists.", 409)
    supplier_name = str(payload.get("preferredSupplierName") or payload.get("preferredSupplier") or "").strip()
    supplier = _get_supplier_by_name(organization.id, supplier_name) if supplier_name else None
    item = InventoryItem(
        organization_id=organization.id,
        location_id=location.id,
        supplier_id=supplier.id if supplier else None,
        name=name,
        normalized_name=normalized,
        category=str(payload.get("category") or "Other").strip() or "Other",
        stock_unit=str(payload.get("stockUnit") or payload.get("unit") or "each").strip() or "each",
        current_on_hand=_to_quantity(payload.get("currentOnHand", 0), field="currentOnHand", required=False),
        min_quantity=_to_quantity(payload.get("minQuantity", 0), field="minQuantity", required=False),
        par_level=_to_quantity(payload.get("parLevel", 0), field="parLevel", required=False),
        preferred_supplier_name=supplier_name,
        latest_purchase_price=_to_decimal(payload.get("latestPurchasePrice", 0), field="latestPurchasePrice", required=False),
        last_purchase_unit=str(payload.get("lastPurchaseUnit") or payload.get("stockUnit") or payload.get("unit") or "each"),
        last_purchase_conversion_factor=_to_quantity(payload.get("lastPurchaseConversionFactor", 1), field="lastPurchaseConversionFactor", required=False),
        average_daily_usage=_to_quantity(payload.get("averageDailyUsage"), field="averageDailyUsage", required=False) if payload.get("averageDailyUsage") not in (None, "") else None,
        active=bool(payload.get("active", True)),
        notes=str(payload.get("notes") or "").strip(),
        created_by_user_id=current_user.id,
        updated_by_user_id=current_user.id,
    )
    db.session.add(item)
    db.session.flush()
    record_audit_event(
        event_type="inventory.item_created",
        entity_type="inventory_item",
        entity_id=item.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"itemName": item.name, "stockUnit": item.stock_unit, "active": item.active},
    )
    db.session.commit()
    return jsonify(serialize_inventory_item(item)), 201


@bp.patch("/api/pilot/inventory/items/<int:item_id>")
@login_required
def update_inventory_item(item_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "inventory.manage")
    if permission_error is not None:
        return permission_error
    item = InventoryItem.query.filter_by(id=item_id, organization_id=organization.id, location_id=location.id).first()
    if item is None:
        return json_error("Inventory item not found.", 404)
    payload = _json_body()
    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            return json_error("Validation failed.", 400, errors={"name": "Name is required."})
        item.name = name
        item.normalized_name = _normalize_name(name)
    if "category" in payload:
        item.category = str(payload.get("category") or "Other").strip() or "Other"
    if "stockUnit" in payload or "unit" in payload:
        new_stock_unit = str(payload.get("stockUnit") or payload.get("unit") or "each").strip() or "each"
        if new_stock_unit != item.stock_unit and _inventory_item_has_history(item, organization.id, location.id):
            return json_error(
                "Changing the base unit is blocked after inventory history exists.",
                409,
                errors={"stockUnit": "Create a new item instead of changing the base unit on a used item."},
            )
        item.stock_unit = new_stock_unit
    if "currentOnHand" in payload:
        item.current_on_hand = _to_quantity(payload.get("currentOnHand"), field="currentOnHand")
    if "minQuantity" in payload:
        item.min_quantity = _to_quantity(payload.get("minQuantity"), field="minQuantity")
    if "parLevel" in payload:
        item.par_level = _to_quantity(payload.get("parLevel"), field="parLevel")
    if "preferredSupplierName" in payload or "preferredSupplier" in payload:
        item.preferred_supplier_name = str(payload.get("preferredSupplierName") or payload.get("preferredSupplier") or "").strip()
        if item.preferred_supplier_name:
            supplier = _get_supplier_by_name(organization.id, item.preferred_supplier_name)
            item.supplier_id = supplier.id
    if "latestPurchasePrice" in payload:
        item.latest_purchase_price = _to_decimal(payload.get("latestPurchasePrice"), field="latestPurchasePrice")
    if "averageDailyUsage" in payload:
        item.average_daily_usage = _to_quantity(payload.get("averageDailyUsage"), field="averageDailyUsage", required=False)
    if "notes" in payload:
        item.notes = str(payload.get("notes") or "").strip()
    if "active" in payload:
        item.active = bool(payload.get("active"))
    item.updated_by_user_id = current_user.id
    record_audit_event(
        event_type="inventory.item_updated",
        entity_type="inventory_item",
        entity_id=item.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"itemName": item.name, "stockUnit": item.stock_unit, "active": item.active},
    )
    db.session.commit()
    return jsonify(serialize_inventory_item(item)), 200


@bp.post("/api/pilot/inventory/items/<int:item_id>/adjustments")
@login_required
def create_inventory_adjustment(item_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "inventory.manage")
    if permission_error is not None:
        return permission_error
    item = InventoryItem.query.filter_by(id=item_id, organization_id=organization.id, location_id=location.id).first()
    if item is None:
        return json_error("Inventory item not found.", 404)
    payload = _json_body()
    reason = str(payload.get("reason") or "").strip()
    if not reason:
        return json_error("Validation failed.", 400, errors={"reason": "Reason is required."})
    movement_type = str(payload.get("movementType") or "manual decrease").strip()
    delta = _to_quantity(payload.get("quantityDelta"), field="quantityDelta")
    if movement_type in {"manual decrease", "waste", "spoilage / expired", "damaged", "staff meal / comped", "breakage"}:
        delta = -abs(delta)
    elif movement_type in {"manual increase", "manual addition", "adjustment", "correction"}:
        delta = abs(delta)
    before = Decimal(item.current_on_hand)
    after = (before + delta).quantize(QTY)
    if after < 0:
        return json_error("Adjustment would make inventory negative.", 400, errors={"quantityDelta": "Quantity cannot reduce stock below zero."})
    movement = InventoryMovement(
        organization_id=organization.id,
        location_id=location.id,
        inventory_item_id=item.id,
        quantity_delta=delta,
        quantity_before=before,
        quantity_after=after,
        unit=item.stock_unit,
        source_type=movement_type,
        source_record_id=str(payload.get("sourceRecordId") or "manual"),
        source_line_id=str(payload.get("sourceLineId") or "manual"),
        reason=reason,
        actor_user_id=current_user.id,
    )
    item.current_on_hand = after
    item.updated_by_user_id = current_user.id
    item.updated_at = _now()
    db.session.add(movement)
    db.session.flush()
    record_audit_event(
        event_type="inventory.adjustment_created",
        entity_type="inventory_movement",
        entity_id=movement.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={
            "inventoryItemId": item.id,
            "sourceType": movement.source_type,
            "quantityDelta": float(delta),
            "reason": reason,
        },
    )
    db.session.commit()
    return jsonify(serialize_inventory_movement(movement)), 201


def _build_count_session_for_location(location: RestaurantLocation, organization_id: int):
    items = InventoryItem.query.filter_by(organization_id=organization_id, location_id=location.id, active=True).order_by(InventoryItem.name.asc()).all()
    return items


def _count_session_movement_conflicts(session_record: StockCountSession) -> list[dict[str, Any]]:
    conflicts: list[dict[str, Any]] = []
    if session_record.started_at is None:
        return conflicts
    for line in session_record.lines:
        if line.inventory_item_id is None:
            continue
        movement_count = InventoryMovement.query.filter(
            InventoryMovement.organization_id == session_record.organization_id,
            InventoryMovement.location_id == session_record.location_id,
            InventoryMovement.inventory_item_id == line.inventory_item_id,
            InventoryMovement.created_at > session_record.started_at,
        ).count()
        if movement_count > 0:
            item = line.inventory_item
            conflicts.append(
                {
                    "lineId": line.id,
                    "inventoryItemId": line.inventory_item_id,
                    "itemName": item.name if item else line.item_name_snapshot,
                    "movementCount": movement_count,
                }
            )
    return conflicts


@bp.get("/api/pilot/inventory/count-sessions")
@login_required
def list_count_sessions():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "operational.read")
    if permission_error is not None:
        return permission_error
    sessions = StockCountSession.query.filter_by(organization_id=organization.id, location_id=location.id).order_by(StockCountSession.updated_at.desc()).all()
    return jsonify({"countSessions": [serialize_count_session(entry) for entry in sessions]}), 200


@bp.post("/api/pilot/inventory/count-sessions")
@login_required
def create_count_session():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, _, _, location = context
    permission_error = _require_role(get_current_membership(), "stock_counts.manage")
    if permission_error is not None:
        return permission_error
    payload = _json_body()
    item_ids = payload.get("itemIds")
    if not isinstance(item_ids, list) or not item_ids:
        item_ids = [item.id for item in _build_count_session_for_location(location, organization.id)]
    requested_ids = [int(item_id) for item_id in item_ids]
    candidate_items = (
        InventoryItem.query.filter(
            InventoryItem.id.in_(requested_ids),
            InventoryItem.organization_id == organization.id,
            InventoryItem.location_id == location.id,
            InventoryItem.active.is_(True),
        )
        .order_by(InventoryItem.name.asc())
        .all()
    )
    if not candidate_items:
        return json_error("No inventory items available for this count session.", 400)
    candidate_ids = {item.id for item in candidate_items}
    missing_ids = [item_id for item_id in requested_ids if item_id not in candidate_ids]
    if missing_ids:
        return json_error("Validation failed.", 400, errors={"itemIds": "Some requested inventory items are unavailable or inactive."})
    session_record = StockCountSession(
        organization_id=organization.id,
        location_id=location.id,
        status="Draft",
        started_at=_now(),
        counted_by=str(payload.get("countedBy") or "").strip(),
        notes=str(payload.get("notes") or "").strip(),
        item_count=len(candidate_items),
        created_by_user_id=current_user.id,
        updated_at=_now(),
    )
    db.session.add(session_record)
    db.session.flush()
    lines = []
    for index, item in enumerate(candidate_items):
        lines.append(
            StockCountSessionLine(
                session_id=session_record.id,
                inventory_item_id=item.id,
                line_index=index,
                item_name_snapshot=item.name,
                stock_unit_snapshot=item.stock_unit,
                expected_quantity=item.current_on_hand,
                counted_quantity=None,
                variance=None,
                resulting_quantity=None,
                note="",
                status="pending",
            )
        )
    db.session.add_all(lines)
    record_audit_event(
        event_type="stock_counts.session_created",
        entity_type="stock_count_session",
        entity_id=session_record.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"itemCount": session_record.item_count, "countedBy": session_record.counted_by},
    )
    db.session.commit()
    return jsonify(serialize_count_session(session_record)), 201


@bp.get("/api/pilot/inventory/count-sessions/<int:session_id>")
@login_required
def get_count_session(session_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "operational.read")
    if permission_error is not None:
        return permission_error
    session_record = StockCountSession.query.filter_by(id=session_id, organization_id=organization.id, location_id=location.id).first()
    if session_record is None:
        return json_error("Stock count session not found.", 404)
    return jsonify(serialize_count_session(session_record)), 200


@bp.patch("/api/pilot/inventory/count-sessions/<int:session_id>")
@login_required
def update_count_session(session_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "stock_counts.manage")
    if permission_error is not None:
        return permission_error
    session_record = StockCountSession.query.filter_by(id=session_id, organization_id=organization.id, location_id=location.id).first()
    if session_record is None:
        return json_error("Stock count session not found.", 404)
    if session_record.status == "Completed":
        return json_error("Completed stock counts are read-only.", 409)
    payload = _json_body()
    if "updatedAt" in payload and payload.get("updatedAt") and session_record.updated_at is not None:
        expected_updated_at = str(payload.get("updatedAt") or "").strip()
        current_updated_at = session_record.updated_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        if expected_updated_at not in {current_updated_at, session_record.updated_at.isoformat()}:
            return json_error("This stock count has changed since it was opened.", 409, errors={"updatedAt": "Reload the count before saving again."})
    if "countedBy" in payload:
        session_record.counted_by = str(payload.get("countedBy") or "").strip()
    if "notes" in payload:
        session_record.notes = str(payload.get("notes") or "").strip()
    if "lines" in payload and isinstance(payload.get("lines"), list):
        line_payloads = payload.get("lines")
        lines_by_id = {line.id: line for line in session_record.lines}
        for index, line_payload in enumerate(line_payloads):
            line = lines_by_id.get(int(line_payload.get("id"))) if line_payload.get("id") else None
            if line is None:
                continue
            if "countedQuantity" in line_payload:
                counted = line_payload.get("countedQuantity")
                line.counted_quantity = _to_quantity(counted, field=f"lines[{index}].countedQuantity", required=False) if counted not in (None, "") else None
                if line.counted_quantity is not None and line.counted_quantity < 0:
                    return json_error("Counted quantity cannot be negative.", 400, errors={f"lines[{index}].countedQuantity": "Enter a quantity of zero or more."})
                line.variance = None if line.counted_quantity is None else (Decimal(line.counted_quantity) - Decimal(line.expected_quantity)).quantize(QTY)
                line.resulting_quantity = line.counted_quantity
                line.status = "confirmed" if line.counted_quantity is not None else "pending"
            if "note" in line_payload:
                line.note = str(line_payload.get("note") or "").strip()
    session_record.updated_at = _now()
    record_audit_event(
        event_type="stock_counts.session_updated",
        entity_type="stock_count_session",
        entity_id=session_record.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"countedBy": session_record.counted_by, "status": session_record.status},
    )
    db.session.commit()
    return jsonify(serialize_count_session(session_record)), 200


@bp.post("/api/pilot/inventory/count-sessions/<int:session_id>/finalize")
@login_required
def finalize_count_session(session_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "stock_counts.manage")
    if permission_error is not None:
        return permission_error
    session_record = StockCountSession.query.filter_by(id=session_id, organization_id=organization.id, location_id=location.id).first()
    if session_record is None:
        return json_error("Stock count session not found.", 404)
    if session_record.status == "Completed":
        return json_error("This stock count has already been finalized.", 409)
    incomplete = [line for line in session_record.lines if line.counted_quantity is None]
    if incomplete:
        return json_error("Finalize requires a counted quantity for every line.", 400, errors={"lines": "Fill in every line before finalizing."})
    payload = request.get_json(silent=True) or {}
    confirm_concurrency = bool(payload.get("confirmConcurrency"))
    conflicts = _count_session_movement_conflicts(session_record)
    if conflicts and not confirm_concurrency:
        return (
            jsonify(
                {
                    "error": "Inventory changed after this count began.",
                    "errors": {"concurrency": "Review the later movements before finalizing."},
                    "conflicts": conflicts,
                }
            ),
            409,
        )

    now = _now()
    try:
        for line in session_record.lines:
            item = line.inventory_item
            if item is None or line.counted_quantity is None:
                continue
            after = Decimal(line.counted_quantity).quantize(QTY)
            before = Decimal(item.current_on_hand)
            delta = (after - before).quantize(QTY)
            if after < 0:
                raise RequestValidationError("Stock count would make inventory negative.", {"countedQuantity": f"{line.item_name_snapshot} cannot be negative."})
            movement = InventoryMovement(
                organization_id=organization.id,
                location_id=location.id,
                inventory_item_id=item.id,
                quantity_delta=delta,
                quantity_before=before,
                quantity_after=after,
                unit=item.stock_unit,
                source_type="stock count reconciliation",
                source_record_id=str(session_record.id),
                source_line_id=str(line.id),
                reason=line.note or f"Stock count {session_record.id}",
                actor_user_id=current_user.id,
            )
            item.current_on_hand = after
            item.last_counted_at = now
            item.updated_by_user_id = current_user.id
            item.updated_at = now
            db.session.add(movement)
        session_record.status = "Completed"
        session_record.completed_at = now
        session_record.updated_at = now
        session_record.finalized_by_user_id = current_user.id
        record_audit_event(
            event_type="stock_counts.session_finalized",
            entity_type="stock_count_session",
            entity_id=session_record.id,
            organization_id=organization.id,
            location_id=location.id,
            actor_user_id=current_user.id,
            metadata={"itemCount": session_record.item_count, "status": session_record.status},
        )
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        refreshed = StockCountSession.query.filter_by(id=session_id, organization_id=organization.id, location_id=location.id).first()
        if refreshed is not None and refreshed.status == "Completed":
            return json_error("This stock count has already been finalized.", 409)
        return json_error("Could not finalize the stock count.", 500)
    except RequestValidationError as exc:
        db.session.rollback()
        return json_error(exc.message, 400, errors=exc.errors)
    except Exception:
        db.session.rollback()
        return json_error("Could not finalize the stock count.", 500)
    return jsonify(serialize_count_session(session_record)), 200


@bp.post("/api/pilot/reorder-plan/<int:item_id>/ordered")
@login_required
def mark_reorder_item_ordered(item_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "reorder.manage")
    if permission_error is not None:
        return permission_error
    item = InventoryItem.query.filter_by(id=item_id, organization_id=organization.id, location_id=location.id).first()
    if item is None:
        return json_error("Inventory item not found.", 404)
    suggestion = _reorder_suggestion_for_item(item)
    if suggestion is None:
        return json_error("That item does not need ordering.", 400)
    intent = ReorderIntent.query.filter_by(organization_id=organization.id, location_id=location.id, inventory_item_id=item.id).first()
    if intent is None:
        intent = ReorderIntent(
            organization_id=organization.id,
            location_id=location.id,
            inventory_item_id=item.id,
            suggested_quantity=Decimal(str(suggestion["suggestedQuantity"])),
            adjusted_quantity=Decimal(str(suggestion["adjustedQuantity"])),
            estimated_cost=Decimal(str(suggestion["estimatedCost"])) if suggestion["estimatedCost"] is not None else None,
            status="Ordered",
            ordered_at=_now(),
            notes="",
            actor_user_id=current_user.id,
        )
        db.session.add(intent)
    else:
        intent.status = "Ordered"
        intent.ordered_at = _now()
        intent.updated_at = _now()
        intent.actor_user_id = current_user.id
    db.session.flush()
    record_audit_event(
        event_type="reorder.intent_marked_ordered",
        entity_type="reorder_intent",
        entity_id=intent.id if intent.id is not None else item.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"inventoryItemId": item.id, "status": intent.status},
    )
    db.session.commit()
    return jsonify(serialize_reorder_intent(intent)), 200


@bp.get("/api/pilot/reorder-plan")
@login_required
def reorder_plan():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "reorder.manage")
    if permission_error is not None:
        return permission_error
    items = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, active=True).order_by(InventoryItem.name.asc()).all()
    intents = ReorderIntent.query.filter_by(organization_id=organization.id, location_id=location.id).all()
    intent_by_item = {intent.inventory_item_id: intent for intent in intents}
    suggestions = []
    for item in items:
        suggestion = _reorder_suggestion_for_item(item)
        if suggestion is None:
            continue
        intent = intent_by_item.get(item.id)
        if intent is not None:
            suggestion["status"] = intent.status
            suggestion["adjustedQuantity"] = float(intent.adjusted_quantity)
            suggestion["estimatedCost"] = decimal_to_float(intent.estimated_cost)
        suggestions.append(suggestion)
    suggestions.sort(key=lambda entry: (entry["stockStatus"] != "Out of stock", entry["stockStatus"] != "Reorder now", entry["inventoryItemName"]))
    groups = _group_reorder_by_supplier(suggestions)
    return jsonify({"suggestions": suggestions, "groupedBySupplier": groups}), 200


def _current_reorder_suggestions_for_location(organization_id: int, location_id: int) -> list[dict[str, Any]]:
    items = InventoryItem.query.filter_by(organization_id=organization_id, location_id=location_id, active=True).order_by(InventoryItem.name.asc()).all()
    intents = ReorderIntent.query.filter_by(organization_id=organization_id, location_id=location_id).all()
    intent_by_item = {intent.inventory_item_id: intent for intent in intents}
    suggestions = []
    for item in items:
        suggestion = _reorder_suggestion_for_item(item)
        if suggestion is None:
            continue
        intent = intent_by_item.get(item.id)
        if intent is not None:
            suggestion["status"] = intent.status
            suggestion["adjustedQuantity"] = float(intent.adjusted_quantity)
            suggestion["estimatedCost"] = decimal_to_float(intent.estimated_cost)
        suggestions.append(suggestion)
    suggestions.sort(key=lambda entry: (entry["stockStatus"] != "Out of stock", entry["stockStatus"] != "Reorder now", entry["inventoryItemName"]))
    return suggestions


def _current_reorder_groups_for_location(organization_id: int, location_id: int):
    suggestions = _current_reorder_suggestions_for_location(organization_id, location_id)
    return suggestions, _group_reorder_by_supplier(suggestions)


def _create_reorder_plan_from_current(organization_id: int, location_id: int, *, user_id: int) -> ReorderPlan:
    existing_draft = ReorderPlan.query.filter_by(organization_id=organization_id, location_id=location_id, status="Draft").order_by(ReorderPlan.updated_at.desc()).first()
    if existing_draft is not None:
        return existing_draft

    suggestions = _current_reorder_suggestions_for_location(organization_id, location_id)
    plan = ReorderPlan(
        organization_id=organization_id,
        location_id=location_id,
        name=f"Reorder plan { _now().date().isoformat() }",
        status="Draft",
        notes="",
        created_by_user_id=user_id,
    )
    db.session.add(plan)
    db.session.flush()
    lines = []
    for index, suggestion in enumerate(suggestions):
        item = InventoryItem.query.filter_by(id=suggestion["inventoryItemId"], organization_id=organization_id, location_id=location_id).first()
        if item is None:
            continue
        lines.append(
            ReorderPlanLine(
                plan_id=plan.id,
                inventory_item_id=item.id,
                supplier_id=item.supplier_id,
                line_index=index,
                inventory_item_name_snapshot=item.name,
                supplier_name_snapshot=suggestion["supplier"] or item.preferred_supplier_name or (item.supplier.name if item.supplier else ""),
                category_snapshot=item.category,
                purchase_unit_snapshot=item.last_purchase_unit or item.stock_unit or "each",
                inventory_unit_snapshot=item.stock_unit or "each",
                conversion_factor_snapshot=item.last_purchase_conversion_factor or Decimal("1"),
                current_on_hand_snapshot=item.current_on_hand,
                minimum_quantity_snapshot=item.min_quantity,
                par_level_snapshot=item.par_level,
                suggested_quantity_snapshot=Decimal(str(suggestion["suggestedQuantity"])),
                order_quantity=Decimal(str(suggestion["adjustedQuantity"] or suggestion["suggestedQuantity"])),
                excluded=False,
                estimated_unit_cost_snapshot=Decimal(str(suggestion["latestPurchasePrice"])) if suggestion.get("latestPurchasePrice") is not None else None,
                estimated_line_cost_snapshot=Decimal(str(suggestion["estimatedCost"])) if suggestion.get("estimatedCost") is not None else None,
                notes="",
            )
        )
    db.session.add_all(lines)
    db.session.flush()
    return plan


def _reorder_plan_queryset(organization_id: int, location_id: int):
    return ReorderPlan.query.filter_by(organization_id=organization_id, location_id=location_id).order_by(ReorderPlan.created_at.desc(), ReorderPlan.updated_at.desc())


def _reorder_plan_line_estimated_cost(line: ReorderPlanLine) -> Decimal | None:
    if line.excluded or line.estimated_unit_cost_snapshot is None:
        return None
    conversion_factor = Decimal(line.conversion_factor_snapshot or 1)
    if conversion_factor <= 0:
        return None
    quantity = Decimal(line.order_quantity or 0)
    return (quantity / conversion_factor * Decimal(line.estimated_unit_cost_snapshot)).quantize(MONEY)


@bp.get("/api/pilot/reorder-plans")
@login_required
def list_reorder_plans():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "reorder.manage")
    if permission_error is not None:
        return permission_error
    plans = _reorder_plan_queryset(organization.id, location.id).all()
    active_draft = next((plan for plan in plans if plan.status == "Draft"), None)
    return jsonify({"plans": [serialize_reorder_plan(plan) for plan in plans], "activeDraftPlanId": active_draft.id if active_draft else None}), 200


@bp.post("/api/pilot/reorder-plans")
@login_required
def create_or_open_reorder_plan():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "reorder.manage")
    if permission_error is not None:
        return permission_error
    existing_draft = ReorderPlan.query.filter_by(organization_id=organization.id, location_id=location.id, status="Draft").order_by(ReorderPlan.updated_at.desc()).first()
    plan = _create_reorder_plan_from_current(organization.id, location.id, user_id=current_user.id)
    try:
        record_audit_event(
            event_type="reorder.plan_created",
            entity_type="reorder_plan",
            entity_id=plan.id,
            organization_id=organization.id,
            location_id=location.id,
            actor_user_id=current_user.id,
            metadata={"status": plan.status, "name": plan.name},
        )
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        existing = ReorderPlan.query.filter_by(organization_id=organization.id, location_id=location.id, status="Draft").order_by(ReorderPlan.updated_at.desc()).first()
        if existing is None:
            return json_error("Could not start the reorder plan.", 500)
        plan = existing
    return jsonify(serialize_reorder_plan(plan)), 200 if existing_draft is not None else 201


@bp.get("/api/pilot/reorder-plans/<int:plan_id>")
@login_required
def get_reorder_plan(plan_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "reorder.manage")
    if permission_error is not None:
        return permission_error
    plan = ReorderPlan.query.filter_by(id=plan_id, organization_id=organization.id, location_id=location.id).first()
    if plan is None:
        return json_error("Reorder plan not found.", 404)
    return jsonify(serialize_reorder_plan(plan)), 200


@bp.patch("/api/pilot/reorder-plans/<int:plan_id>")
@login_required
def update_reorder_plan(plan_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "reorder.manage")
    if permission_error is not None:
        return permission_error
    plan = ReorderPlan.query.filter_by(id=plan_id, organization_id=organization.id, location_id=location.id).first()
    if plan is None:
        return json_error("Reorder plan not found.", 404)
    if plan.status == "Completed":
        return json_error("Completed reorder plans are read-only.", 409)
    payload = _json_body()
    if "name" in payload:
        plan.name = str(payload.get("name") or "").strip() or plan.name
    if "notes" in payload:
        plan.notes = str(payload.get("notes") or "").strip()
    if "lines" in payload and isinstance(payload.get("lines"), list):
        lines_by_id = {line.id: line for line in plan.lines}
        for index, line_payload in enumerate(payload.get("lines")):
            line = lines_by_id.get(int(line_payload.get("id"))) if line_payload.get("id") else None
            if line is None:
                continue
            if "orderQuantity" in line_payload:
                line.order_quantity = _to_quantity(line_payload.get("orderQuantity"), field=f"lines[{index}].orderQuantity", required=False)
            if "excluded" in line_payload:
                line.excluded = bool(line_payload.get("excluded"))
            if "notes" in line_payload:
                line.notes = str(line_payload.get("notes") or "").strip()
            if "supplierNameSnapshot" in line_payload and line_payload.get("supplierNameSnapshot") is not None:
                line.supplier_name_snapshot = str(line_payload.get("supplierNameSnapshot") or "").strip()
            line.estimated_line_cost_snapshot = _reorder_plan_line_estimated_cost(line)
    plan.updated_at = _now()
    record_audit_event(
        event_type="reorder.plan_updated",
        entity_type="reorder_plan",
        entity_id=plan.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"status": plan.status, "name": plan.name},
    )
    db.session.commit()
    return jsonify(serialize_reorder_plan(plan)), 200


@bp.post("/api/pilot/reorder-plans/<int:plan_id>/prepare")
@login_required
def prepare_reorder_plan(plan_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "reorder.manage")
    if permission_error is not None:
        return permission_error
    plan = ReorderPlan.query.filter_by(id=plan_id, organization_id=organization.id, location_id=location.id).first()
    if plan is None:
        return json_error("Reorder plan not found.", 404)
    if plan.status == "Completed":
        return json_error("Completed reorder plans are read-only.", 409)
    plan.status = "Prepared"
    plan.prepared_at = _now()
    plan.prepared_by_user_id = current_user.id
    plan.updated_at = _now()
    record_audit_event(
        event_type="reorder.plan_prepared",
        entity_type="reorder_plan",
        entity_id=plan.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"status": plan.status},
    )
    db.session.commit()
    return jsonify(serialize_reorder_plan(plan)), 200


@bp.post("/api/pilot/reorder-plans/<int:plan_id>/complete")
@login_required
def complete_reorder_plan(plan_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_role(membership, "reorder.manage")
    if permission_error is not None:
        return permission_error
    plan = ReorderPlan.query.filter_by(id=plan_id, organization_id=organization.id, location_id=location.id).first()
    if plan is None:
        return json_error("Reorder plan not found.", 404)
    if plan.status == "Completed":
        return json_error("This reorder plan has already been completed.", 409)
    plan.status = "Completed"
    plan.completed_at = _now()
    plan.completed_by_user_id = current_user.id
    plan.updated_at = _now()
    record_audit_event(
        event_type="reorder.plan_completed",
        entity_type="reorder_plan",
        entity_id=plan.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"status": plan.status},
    )
    db.session.commit()
    return jsonify(serialize_reorder_plan(plan)), 200


@bp.get("/api/pilot/audit-events")
@login_required
def list_audit_events():
    context = _require_context()
    if context is None:
        return json_error("No pilot organization is available for the current account.", 404)
    organization, membership, _, _ = context
    permission_error = _require_role(membership, "audit.view")
    if permission_error is not None:
        return permission_error
    events = (
        AuditEvent.query.filter_by(organization_id=organization.id)
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .limit(100)
        .all()
    )
    return jsonify({"events": [serialize_audit_event(event) for event in events]}), 200
