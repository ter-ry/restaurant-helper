from __future__ import annotations

from decimal import Decimal
from datetime import datetime, timezone
from typing import Any

from flask import Response, jsonify, session
from flask_login import current_user
from sqlalchemy import and_

from .models import (
    AuditEvent,
    InventoryItem,
    InventoryMovement,
    Organization,
    OrganizationMembership,
    PlatformRole,
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
    User,
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def json_error(message: str, status_code: int, *, errors: dict[str, str] | None = None) -> tuple[Response, int]:
    payload: dict[str, Any] = {"error": message}
    if errors:
        payload["errors"] = errors
    return jsonify(payload), status_code


def isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def decimal_to_float(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value)


def serialize_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "isActive": bool(user.is_active),
        "createdAt": isoformat(user.created_at),
        "updatedAt": isoformat(user.updated_at),
    }


def serialize_organization(organization: Organization) -> dict[str, Any]:
    return {
        "id": organization.id,
        "name": organization.name,
        "lifecycleStatus": organization.lifecycle_status,
        "onboardingStatus": organization.setup_status,
        "setupStatus": organization.setup_status,
        "subscriptionStatus": organization.subscription_status,
        "setupTemplateKey": organization.setup_template_key,
        "setupFeeStatus": organization.setup_fee_status,
        "subscriptionProvider": organization.subscription_provider,
        "externalCustomerReference": organization.external_customer_reference,
        "externalSubscriptionReference": organization.external_subscription_reference,
        "isProspect": bool(organization.is_prospect),
        "activeAt": isoformat(organization.active_at),
        "setupCompletedAt": isoformat(organization.setup_completed_at),
        "suspendedAt": isoformat(organization.suspended_at),
        "cancelledAt": isoformat(organization.cancelled_at),
        "createdAt": isoformat(organization.created_at),
        "updatedAt": isoformat(organization.updated_at),
    }


def serialize_membership(membership: OrganizationMembership) -> dict[str, Any]:
    return {
        "id": membership.id,
        "organizationId": membership.organization_id,
        "role": membership.role,
        "createdAt": isoformat(membership.created_at),
    }


def get_platform_role(user_id: int) -> PlatformRole | None:
    return PlatformRole.query.filter_by(user_id=user_id, is_active=True).first()


def serialize_location(location: RestaurantLocation) -> dict[str, Any]:
    return {
        "id": location.id,
        "organizationId": location.organization_id,
        "name": location.name,
        "addressLine1": location.address_line1,
        "addressLine2": location.address_line2,
        "city": location.city,
        "region": location.region,
        "postalCode": location.postal_code,
        "country": location.country,
        "timezone": location.timezone,
        "createdAt": isoformat(location.created_at),
        "updatedAt": isoformat(location.updated_at),
    }


def serialize_supplier(supplier: Supplier) -> dict[str, Any]:
    return {
        "id": supplier.id,
        "organizationId": supplier.organization_id,
        "name": supplier.name,
        "normalizedName": supplier.normalized_name,
        "categoryFocus": supplier.category_focus,
        "contactName": supplier.contact_name,
        "contactPhone": supplier.contact_phone,
        "contactEmail": supplier.contact_email,
        "orderingNotes": supplier.ordering_notes,
        "notes": supplier.notes,
        "isActive": bool(supplier.is_active),
        "createdAt": isoformat(supplier.created_at),
        "updatedAt": isoformat(supplier.updated_at),
    }


def serialize_inventory_item(item: InventoryItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "organizationId": item.organization_id,
        "locationId": item.location_id,
        "supplierId": item.supplier_id,
        "name": item.name,
        "normalizedName": item.normalized_name,
        "category": item.category,
        "stockUnit": item.stock_unit,
        "currentOnHand": decimal_to_float(item.current_on_hand) or 0,
        "minQuantity": decimal_to_float(item.min_quantity) or 0,
        "parLevel": decimal_to_float(item.par_level) or 0,
        "preferredSupplierName": item.preferred_supplier_name,
        "latestPurchasePrice": decimal_to_float(item.latest_purchase_price) or 0,
        "lastPurchaseUnit": item.last_purchase_unit,
        "lastPurchaseConversionFactor": decimal_to_float(item.last_purchase_conversion_factor) or 1,
        "lastReceivedAt": isoformat(item.last_received_at),
        "lastCountedAt": isoformat(item.last_counted_at),
        "averageDailyUsage": decimal_to_float(item.average_daily_usage),
        "estimatedCostMethod": item.estimated_cost_method,
        "active": bool(item.active),
        "notes": item.notes,
        "createdByUserId": item.created_by_user_id,
        "updatedByUserId": item.updated_by_user_id,
        "createdAt": isoformat(item.created_at),
        "updatedAt": isoformat(item.updated_at),
    }


def serialize_supplier_item_mapping(mapping: SupplierItemMapping) -> dict[str, Any]:
    return {
        "id": mapping.id,
        "organizationId": mapping.organization_id,
        "supplierId": mapping.supplier_id,
        "inventoryItemId": mapping.inventory_item_id,
        "supplierItemName": mapping.supplier_item_name,
        "normalizedSupplierItemName": mapping.normalized_supplier_item_name,
        "purchaseUnit": mapping.purchase_unit,
        "inventoryUnit": mapping.inventory_unit,
        "conversionFactor": decimal_to_float(mapping.conversion_factor) or 1,
        "lastSeenAt": isoformat(mapping.last_seen_at),
        "createdAt": isoformat(mapping.created_at),
        "updatedAt": isoformat(mapping.updated_at),
    }


def serialize_purchase_invoice_line(line: PurchaseInvoiceLine) -> dict[str, Any]:
    return {
        "id": line.id,
        "invoiceId": line.invoice_id,
        "supplierName": line.invoice.supplier.name if line.invoice and line.invoice.supplier else "",
        "invoiceNumber": line.invoice.invoice_number if line.invoice else "",
        "invoiceDate": line.invoice.invoice_date.isoformat() if line.invoice else "",
        "inventoryItemId": line.inventory_item_id,
        "supplierItemMappingId": line.supplier_item_mapping_id,
        "lineIndex": line.line_index,
        "description": line.description,
        "normalizedDescription": line.normalized_description,
        "purchaseUnit": line.purchase_unit,
        "inventoryUnit": line.inventory_unit,
        "conversionFactor": decimal_to_float(line.conversion_factor) or 1,
        "quantity": decimal_to_float(line.quantity) or 0,
        "unitPrice": decimal_to_float(line.unit_price) or 0,
        "lineTotal": decimal_to_float(line.line_total) or 0,
        "confidence": decimal_to_float(line.confidence) or 0,
        "needsReview": bool(line.needs_review),
        "previousUnitPrice": decimal_to_float(line.previous_unit_price),
        "priceChangePercent": decimal_to_float(line.price_change_percent),
        "note": line.note,
        "createdAt": isoformat(line.created_at),
        "updatedAt": isoformat(line.updated_at),
    }


def serialize_purchase_invoice(invoice: PurchaseInvoice) -> dict[str, Any]:
    return {
        "id": invoice.id,
        "organizationId": invoice.organization_id,
        "locationId": invoice.location_id,
        "supplierId": invoice.supplier_id,
        "supplier": serialize_supplier(invoice.supplier) if invoice.supplier else None,
        "invoiceNumber": invoice.invoice_number,
        "invoiceDate": invoice.invoice_date.isoformat(),
        "subtotal": decimal_to_float(invoice.subtotal) or 0,
        "tax": decimal_to_float(invoice.tax) or 0,
        "totalAmount": decimal_to_float(invoice.total_amount) or 0,
        "notes": invoice.notes,
        "status": invoice.status,
        "sourceFileName": invoice.source_file_name,
        "sourceFileType": invoice.source_file_type,
        "sourceFileKey": invoice.source_file_key,
        "extractedText": invoice.extracted_text,
        "extractionStatus": invoice.extraction_status,
        "receivedAt": isoformat(invoice.received_at),
        "receivedByUserId": invoice.received_by_user_id,
        "createdByUserId": invoice.created_by_user_id,
        "updatedByUserId": invoice.updated_by_user_id,
        "postedAt": isoformat(invoice.posted_at),
        "lineItems": [serialize_purchase_invoice_line(line) for line in invoice.lines],
        "createdAt": isoformat(invoice.created_at),
        "updatedAt": isoformat(invoice.updated_at),
    }


def serialize_inventory_movement(movement: InventoryMovement) -> dict[str, Any]:
    return {
        "id": movement.id,
        "organizationId": movement.organization_id,
        "locationId": movement.location_id,
        "inventoryItemId": movement.inventory_item_id,
        "inventoryItemName": movement.inventory_item.name if movement.inventory_item else "",
        "quantityDelta": decimal_to_float(movement.quantity_delta) or 0,
        "quantityBefore": decimal_to_float(movement.quantity_before) or 0,
        "quantityAfter": decimal_to_float(movement.quantity_after) or 0,
        "unit": movement.unit,
        "sourceType": movement.source_type,
        "sourceRecordId": movement.source_record_id,
        "sourceLineId": movement.source_line_id,
        "reason": movement.reason,
        "actorUserId": movement.actor_user_id,
        "createdAt": isoformat(movement.created_at),
        "updatedAt": isoformat(movement.updated_at),
    }


def serialize_count_session_line(line: StockCountSessionLine) -> dict[str, Any]:
    session = line.session
    movement_count_since_start = 0
    if session is not None and session.started_at is not None and line.inventory_item_id is not None:
        query = InventoryMovement.query.filter(
            InventoryMovement.organization_id == session.organization_id,
            InventoryMovement.location_id == session.location_id,
            InventoryMovement.inventory_item_id == line.inventory_item_id,
            InventoryMovement.created_at > session.started_at,
        )
        if session.completed_at is not None:
            query = query.filter(InventoryMovement.created_at < session.completed_at)
            query = query.filter(~and_(InventoryMovement.source_type == "stock count reconciliation", InventoryMovement.source_record_id == str(session.id)))
        movement_count_since_start = query.count()

    return {
        "id": line.id,
        "sessionId": line.session_id,
        "inventoryItemId": line.inventory_item_id,
        "lineIndex": line.line_index,
        "itemNameSnapshot": line.item_name_snapshot,
        "stockUnitSnapshot": line.stock_unit_snapshot,
        "expectedQuantity": decimal_to_float(line.expected_quantity) or 0,
        "countedQuantity": decimal_to_float(line.counted_quantity),
        "variance": decimal_to_float(line.variance),
        "resultingQuantity": decimal_to_float(line.resulting_quantity),
        "note": line.note,
        "status": line.status,
        "movementCountSinceStart": movement_count_since_start,
        "hasMovementSinceStart": movement_count_since_start > 0,
        "createdAt": isoformat(line.created_at),
        "updatedAt": isoformat(line.updated_at),
    }


def serialize_count_session(session_record: StockCountSession) -> dict[str, Any]:
    line_payloads = [serialize_count_session_line(line) for line in session_record.lines]
    counted_line_count = sum(1 for line in line_payloads if line["countedQuantity"] is not None)
    uncounted_line_count = sum(1 for line in line_payloads if line["countedQuantity"] is None)
    variance_total = round(sum((line["variance"] or 0) for line in line_payloads), 4)
    movement_count_since_start = sum(line["movementCountSinceStart"] for line in line_payloads)
    return {
        "id": session_record.id,
        "organizationId": session_record.organization_id,
        "locationId": session_record.location_id,
        "status": session_record.status,
        "startedAt": isoformat(session_record.started_at),
        "completedAt": isoformat(session_record.completed_at),
        "countedBy": session_record.counted_by,
        "notes": session_record.notes,
        "itemCount": session_record.item_count,
        "countedLineCount": counted_line_count,
        "uncountedLineCount": uncounted_line_count,
        "varianceTotal": variance_total,
        "movementCountSinceStart": movement_count_since_start,
        "hasMovementSinceStart": movement_count_since_start > 0,
        "createdByUserId": session_record.created_by_user_id,
        "finalizedByUserId": session_record.finalized_by_user_id,
        "lines": line_payloads,
        "createdAt": isoformat(session_record.created_at),
        "updatedAt": isoformat(session_record.updated_at),
    }


def serialize_reorder_intent(intent: ReorderIntent) -> dict[str, Any]:
    return {
        "id": intent.id,
        "organizationId": intent.organization_id,
        "locationId": intent.location_id,
        "inventoryItemId": intent.inventory_item_id,
        "inventoryItemName": intent.inventory_item.name if intent.inventory_item else "",
        "suggestedQuantity": decimal_to_float(intent.suggested_quantity) or 0,
        "adjustedQuantity": decimal_to_float(intent.adjusted_quantity) or 0,
        "estimatedCost": decimal_to_float(intent.estimated_cost),
        "status": intent.status,
        "orderedAt": isoformat(intent.ordered_at),
        "notes": intent.notes,
        "actorUserId": intent.actor_user_id,
        "createdAt": isoformat(intent.created_at),
        "updatedAt": isoformat(intent.updated_at),
    }


def serialize_reorder_plan_line(line: ReorderPlanLine) -> dict[str, Any]:
    return {
        "id": line.id,
        "planId": line.plan_id,
        "inventoryItemId": line.inventory_item_id,
        "supplierId": line.supplier_id,
        "lineIndex": line.line_index,
        "inventoryItemName": line.inventory_item_name_snapshot,
        "supplierName": line.supplier_name_snapshot,
        "category": line.category_snapshot,
        "purchaseUnit": line.purchase_unit_snapshot,
        "inventoryUnit": line.inventory_unit_snapshot,
        "conversionFactor": decimal_to_float(line.conversion_factor_snapshot) or 1,
        "currentOnHand": decimal_to_float(line.current_on_hand_snapshot) or 0,
        "minimumQuantity": decimal_to_float(line.minimum_quantity_snapshot) or 0,
        "parLevel": decimal_to_float(line.par_level_snapshot) or 0,
        "suggestedQuantity": decimal_to_float(line.suggested_quantity_snapshot) or 0,
        "orderQuantity": decimal_to_float(line.order_quantity) or 0,
        "excluded": bool(line.excluded),
        "estimatedUnitCost": decimal_to_float(line.estimated_unit_cost_snapshot),
        "estimatedLineCost": decimal_to_float(line.estimated_line_cost_snapshot),
        "notes": line.notes,
        "createdAt": isoformat(line.created_at),
        "updatedAt": isoformat(line.updated_at),
    }


def serialize_reorder_plan(plan: ReorderPlan) -> dict[str, Any]:
    lines = [serialize_reorder_plan_line(line) for line in plan.lines]
    return {
        "id": plan.id,
        "organizationId": plan.organization_id,
        "locationId": plan.location_id,
        "name": plan.name,
        "status": plan.status,
        "notes": plan.notes,
        "createdByUserId": plan.created_by_user_id,
        "preparedByUserId": plan.prepared_by_user_id,
        "completedByUserId": plan.completed_by_user_id,
        "preparedAt": isoformat(plan.prepared_at),
        "completedAt": isoformat(plan.completed_at),
        "lineCount": len(lines),
        "supplierCount": len({line["supplierName"] or "Unassigned" for line in lines}),
        "estimatedCost": round(sum((line["estimatedLineCost"] or 0) for line in lines if not line["excluded"]), 2),
        "includedCost": round(sum((line["estimatedLineCost"] or 0) for line in lines if not line["excluded"]), 2),
        "excludedCount": sum(1 for line in lines if line["excluded"]),
        "lines": lines,
        "createdAt": isoformat(plan.created_at),
        "updatedAt": isoformat(plan.updated_at),
    }


def serialize_audit_event(event: AuditEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "organizationId": event.organization_id,
        "locationId": event.location_id,
        "actorUserId": event.actor_user_id,
        "eventType": event.event_type,
        "entityType": event.entity_type,
        "entityId": event.entity_id,
        "requestId": event.request_id,
        "sourceIp": event.source_ip,
        "userAgent": event.user_agent,
        "metadata": event.metadata_json,
        "createdAt": isoformat(event.created_at),
    }


def clear_pilot_context() -> None:
    session.pop("pilot_current_membership_id", None)
    session.pop("pilot_current_organization_id", None)
    session.pop("pilot_current_location_id", None)


def get_user_memberships(user_id: int) -> list[OrganizationMembership]:
    return (
        OrganizationMembership.query.filter_by(user_id=user_id)
        .order_by(OrganizationMembership.created_at.asc(), OrganizationMembership.id.asc())
        .all()
    )


def get_user_organizations(user_id: int) -> list[Organization]:
    memberships = get_user_memberships(user_id)
    organization_ids = [membership.organization_id for membership in memberships]
    if not organization_ids:
        return []
    organizations = Organization.query.filter(Organization.id.in_(organization_ids)).order_by(Organization.created_at.asc(), Organization.id.asc()).all()
    organization_by_id = {organization.id: organization for organization in organizations}
    return [organization_by_id[organization_id] for organization_id in organization_ids if organization_id in organization_by_id]


def get_current_membership() -> OrganizationMembership | None:
    if not current_user.is_authenticated:
        return None

    memberships = get_user_memberships(current_user.id)
    if not memberships:
        clear_pilot_context()
        return None

    selected_membership_id = session.get("pilot_current_membership_id")
    if selected_membership_id is not None:
        try:
            selected_membership_id = int(selected_membership_id)
        except (TypeError, ValueError):
            selected_membership_id = None

    selected_organization_id = session.get("pilot_current_organization_id")
    if selected_organization_id is not None:
        try:
            selected_organization_id = int(selected_organization_id)
        except (TypeError, ValueError):
            selected_organization_id = None

    membership: OrganizationMembership | None = None
    if selected_membership_id is not None:
        membership = next((entry for entry in memberships if entry.id == selected_membership_id), None)
    if membership is None and selected_organization_id is not None:
        membership = next((entry for entry in memberships if entry.organization_id == selected_organization_id), None)
    if membership is None and len(memberships) == 1:
        membership = memberships[0]

    if membership is None:
        clear_pilot_context()
        return None

    membership_id = session.get("pilot_current_membership_id")
    if membership_id != membership.id:
        session["pilot_current_membership_id"] = membership.id
    organization_id = session.get("pilot_current_organization_id")
    if organization_id != membership.organization_id:
        session["pilot_current_organization_id"] = membership.organization_id
        session.pop("pilot_current_location_id", None)
    return membership


def get_current_location() -> RestaurantLocation | None:
    organization, membership, locations = get_current_organization_bundle()
    if organization is None or membership is None or not locations:
        return None

    location_id = session.get("pilot_current_location_id")
    if location_id is not None:
        try:
            location_id = int(location_id)
        except (TypeError, ValueError):
            location_id = None
    if location_id is not None:
        location = next((entry for entry in locations if entry.id == location_id), None)
        if location is not None:
            return location

    if len(locations) == 1:
        location = locations[0]
        session["pilot_current_location_id"] = location.id
        return location

    session.pop("pilot_current_location_id", None)
    return None


def get_current_organization_bundle() -> tuple[Organization | None, OrganizationMembership | None, list[RestaurantLocation]]:
    membership = get_current_membership()
    if membership is None:
        return None, None, []

    organization = Organization.query.filter_by(id=membership.organization_id).first()
    if organization is None:
        clear_pilot_context()
        return None, None, []

    locations = (
        RestaurantLocation.query.filter_by(organization_id=organization.id)
        .order_by(RestaurantLocation.created_at.asc(), RestaurantLocation.id.asc())
        .all()
    )
    return organization, membership, locations


def membership_for_organization(user_id: int, organization_id: int) -> OrganizationMembership | None:
    return OrganizationMembership.query.filter_by(user_id=user_id, organization_id=organization_id).first()
