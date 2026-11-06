"""Evidence for negative on-hand stock (owner decision #199 Option A, issue #237).

Manual receipts, corrections, adjustments and waste can never take stock below zero.  Verified Square/Clover
sale consumption can, when a sale is synced before the matching receipt is recorded.  This module is read-only:
it explains each negative position from the movement ledger and never writes movements, adjustments, variance
or cost.  The on-hand quantity itself stays the ledger truth; a late receipt reconciles it through the normal
receipt path.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from flask import Blueprint, jsonify
from flask_login import login_required

from .access import organization_is_operational
from .models import InventoryItem, InventoryMovement
from .policy import require_permission
from .pos import CLOVER_SALE_SOURCE_TYPES, POS_SALE_SOURCE_TYPES, SQUARE_SALE_SOURCE_TYPES
from .utils import get_current_location, get_current_organization_bundle, json_error

bp = Blueprint("negative_stock", __name__)

_QTY = Decimal("0.0001")


def _plain(value: Decimal) -> str:
    text = format(value.quantize(_QTY).normalize(), "f")
    return text if text not in {"-0", ""} else "0"


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _providers(source_types: set[str]) -> list[str]:
    providers = []
    if source_types & SQUARE_SALE_SOURCE_TYPES:
        providers.append("Square")
    if source_types & CLOVER_SALE_SOURCE_TYPES:
        providers.append("Clover")
    return providers


def _position(item: InventoryItem, movements: list[InventoryMovement]) -> dict[str, Any]:
    on_hand = Decimal(item.current_on_hand or 0)
    shortfall = -on_hand
    unit = item.stock_unit or "each"

    # The trailing run of movements that left the item below zero; its first movement is where it crossed zero.
    run: list[InventoryMovement] = []
    for movement in reversed(movements):
        if Decimal(movement.quantity_after or 0) >= 0:
            break
        run.append(movement)
    run.reverse()

    pos_run = [movement for movement in run if movement.source_type in POS_SALE_SOURCE_TYPES]
    caused_by_pos = bool(run) and run[0].source_type in POS_SALE_SOURCE_TYPES
    pos_consumed = -sum((Decimal(m.quantity_delta or 0) for m in pos_run), start=Decimal("0"))
    orders = {m.source_record_id for m in pos_run if Decimal(m.quantity_delta or 0) < 0}
    providers = _providers({m.source_type for m in pos_run})
    provider_label = " and ".join(providers)

    if caused_by_pos:
        count = len(orders)
        sales = f"{count} {provider_label} order{'s' if count != 1 else ''}"
        explanation = (
            f"{sales} used {_plain(pos_consumed)} {unit} before enough stock was received; "
            f"on hand is {_plain(on_hand)} {unit}."
        )
        explanation += " Record the delivery or count the item to reconcile."
    else:
        explanation = (
            f"On hand is {_plain(on_hand)} {unit} but no verified POS sale caused it. "
            "Count the item to correct it."
        )

    return {
        "inventoryItemId": item.id,
        "inventoryItemName": item.name,
        "unit": unit,
        "onHand": float(on_hand),
        "shortfall": float(shortfall),
        "cause": "pos_sale" if caused_by_pos else "unverified",
        "provider": provider_label or None,
        "posConsumedQuantity": float(pos_consumed) if caused_by_pos else None,
        "orderCount": len(orders) if caused_by_pos else 0,
        "crossedZeroAt": _iso(run[0].created_at) if run else None,
        "lastPosSaleAt": _iso(pos_run[-1].created_at) if pos_run else None,
        "explanation": explanation,
    }


def negative_stock_positions(organization_id: int, location_id: int) -> list[dict[str, Any]]:
    """Active items below zero at one tenant location, most negative first."""
    items = InventoryItem.query.filter(
        InventoryItem.organization_id == organization_id,
        InventoryItem.location_id == location_id,
        InventoryItem.active.is_(True),
        InventoryItem.current_on_hand < 0,
    ).all()
    if not items:
        return []
    movements_by_item: dict[int, list[InventoryMovement]] = {item.id: [] for item in items}
    for movement in (
        InventoryMovement.query.filter(
            InventoryMovement.organization_id == organization_id,
            InventoryMovement.location_id == location_id,
            InventoryMovement.inventory_item_id.in_(list(movements_by_item)),
        )
        .order_by(InventoryMovement.id.asc())
        .all()
    ):
        movements_by_item[movement.inventory_item_id].append(movement)
    positions = [_position(item, movements_by_item[item.id]) for item in items]
    positions.sort(key=lambda position: (position["onHand"], position["inventoryItemName"]))
    return positions


def negative_stock_summary(organization_id: int, location_id: int) -> dict[str, Any]:
    positions = negative_stock_positions(organization_id, location_id)
    return {
        "count": len(positions),
        "posCausedCount": sum(1 for position in positions if position["cause"] == "pos_sale"),
        "items": positions,
    }


def negative_stock_attention_item(summary: dict[str, Any]) -> dict[str, Any]:
    """One Daily Close attention row with the actual quantities (first three items; the rest are counted)."""
    items = summary["items"]
    shown = [
        f"{item['inventoryItemName']} {_plain(Decimal(str(item['onHand'])))} {item['unit']}"
        + (f" ({item['provider']} sales)" if item["cause"] == "pos_sale" else " (not from POS sales)")
        for item in items[:3]
    ]
    more = len(items) - len(shown)
    detail = "On hand: " + "; ".join(shown) + (f"; and {more} more" if more > 0 else "") + "."
    count = summary["count"]
    return {
        "type": "negative_stock",
        "title": f"{count} item{'s' if count != 1 else ''} below zero on hand",
        "severity": "warning",
        "href": "/app/reorder-plan",
        "label": "Review stock",
        "detail": detail,
    }


@bp.get("/api/pilot/inventory/negative-stock")
@login_required
def list_negative_stock():
    organization, membership, locations = get_current_organization_bundle()
    if organization is None or membership is None or not locations:
        return json_error("No pilot organization is available for the current account.", 404)
    if not organization_is_operational(organization):
        return json_error("This organization is not ready for operational access yet.", 403)
    permission_error = require_permission(membership.role, "operational.read")
    if permission_error is not None:
        return permission_error
    location = get_current_location()
    if location is None:
        return json_error("Choose a location first.", 404)
    return jsonify(negative_stock_summary(organization.id, location.id)), 200
