"""Guarded Clover shadow-order inventory reconciliation.

The feature is intentionally opt-in. It consumes only fully verified, mapped
shadow orders and records applied quantities so retries and corrections are
deterministic. No provider writes are performed here.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from flask import current_app
from sqlalchemy.exc import IntegrityError

from .extensions import db
from .models import (
    CloverConnection,
    CloverShadowOrder,
    CloverShadowOrderLine,
    CloverShadowOrderLineInventoryConsumption,
    InventoryItem,
    InventoryMovement,
)
from .pos import PosProvider, ensure_inventory_source


QTY = Decimal("0.0001")


def clover_order_inventory_enabled() -> bool:
    return bool(current_app.config.get("CLOVER_ORDER_INVENTORY_ENABLED", False))


def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("Invalid Clover ingredient quantity.")


def _order_is_eligible(order: CloverShadowOrder) -> tuple[bool, str]:
    raw = order.raw_payload_json or {}
    if not order.potentially_eligible or order.requires_review or order.normalized_status != "paid":
        return False, "order_not_financially_verified"
    if any(bool(raw.get(key)) for key in ("incomplete", "lineItemsIncomplete", "financialIncomplete", "refundsUnverified", "paymentStateConflict")):
        return False, "financial_or_line_data_incomplete"
    return True, ""


def _line_ingredients(line: CloverShadowOrderLine) -> list[dict[str, Any]]:
    preview = line.recipe_preview_json or {}
    if line.mapping_status != "mapped" or not isinstance(preview, dict):
        return []
    ingredients = preview.get("ingredients")
    if not isinstance(ingredients, list) or not ingredients:
        return []
    return [item for item in ingredients if isinstance(item, dict)]


def _source_line_id(consumption_id: int, sequence: int) -> str:
    return f"clover:{consumption_id}:{sequence}"


def plan_clover_order_inventory(order: CloverShadowOrder) -> dict[str, Any]:
    """Return a side-effect-free eligibility and movement plan."""
    eligible, reason = _order_is_eligible(order)
    if not eligible:
        return {"orderId": order.clover_order_id, "eligible": False, "reason": reason, "movements": []}

    movements: list[dict[str, Any]] = []
    for line in order.lines:
        ingredients = _line_ingredients(line)
        if not ingredients:
            return {"orderId": order.clover_order_id, "eligible": False, "reason": "line_mapping_or_recipe_missing", "movements": []}
        for ingredient in ingredients:
            try:
                quantity = _decimal(ingredient.get("quantity")).quantize(QTY)
            except ValueError:
                return {"orderId": order.clover_order_id, "eligible": False, "reason": "invalid_recipe_quantity", "movements": []}
            if quantity <= 0:
                return {"orderId": order.clover_order_id, "eligible": False, "reason": "invalid_recipe_quantity", "movements": []}
            inventory_item_id = ingredient.get("inventoryItemId")
            unit = str(ingredient.get("unit") or "").strip()
            if not inventory_item_id or not unit:
                return {"orderId": order.clover_order_id, "eligible": False, "reason": "ingredient_identity_missing", "movements": []}
            movements.append({
                "lineId": line.id,
                "inventoryItemId": int(inventory_item_id),
                "quantity": str((-quantity).quantize(QTY)),
                "unit": unit,
                "itemName": str(ingredient.get("name") or ""),
            })
    return {"orderId": order.clover_order_id, "eligible": True, "reason": "", "movements": movements}


def apply_clover_order_inventory(
    *,
    order: CloverShadowOrder,
    connection: CloverConnection,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Apply one verified order atomically, or return a dry-run plan.

    The caller owns the surrounding transaction. A failed preflight raises and
    therefore rolls back all movements for the request.
    """
    ensure_inventory_source(PosProvider.CLOVER)
    plan = plan_clover_order_inventory(order)
    if dry_run or not clover_order_inventory_enabled() or not plan["eligible"]:
        plan["enabled"] = clover_order_inventory_enabled()
        plan["dryRun"] = bool(dry_run)
        plan["applied"] = False
        return plan

    # Serialize all retries/corrections for a provider line before reading its
    # applied ledger. This prevents two requests from consuming the same line.
    planned = list(plan["movements"])
    for movement in planned:
        line = (
            CloverShadowOrderLine.query.filter_by(id=movement["lineId"], shadow_order_id=order.id, organization_id=order.organization_id, restaurant_location_id=order.restaurant_location_id)
            .with_for_update()
            .first()
        )
        if line is None:
            raise ValueError("Clover shadow line scope changed during reconciliation.")
        item = (
            InventoryItem.query.filter_by(id=movement["inventoryItemId"], organization_id=order.organization_id, location_id=order.restaurant_location_id)
            .with_for_update()
            .first()
        )
        if item is None or str(item.stock_unit or "").strip() != movement["unit"]:
            raise ValueError("Clover recipe ingredient no longer matches the inventory scope.")
        ledger = (
            CloverShadowOrderLineInventoryConsumption.query.filter_by(
                clover_shadow_order_line_id=line.id,
                inventory_item_id=item.id,
            )
            .with_for_update()
            .first()
        )
        if ledger is None:
            ledger = CloverShadowOrderLineInventoryConsumption(
                organization_id=order.organization_id,
                location_id=order.restaurant_location_id,
                clover_shadow_order_line_id=line.id,
                inventory_item_id=item.id,
                applied_quantity=Decimal("0"),
            )
            db.session.add(ledger)
            db.session.flush()
        wanted = _decimal(movement["quantity"])
        current = _decimal(ledger.applied_quantity or 0)
        correction = (wanted - current).quantize(QTY)
        if correction == 0:
            continue
        before = _decimal(item.current_on_hand or 0)
        after = (before + correction).quantize(QTY)
        sequence = InventoryMovement.query.filter(
            InventoryMovement.organization_id == order.organization_id,
            InventoryMovement.location_id == order.restaurant_location_id,
            InventoryMovement.source_type.in_(("clover sale consumption", "clover sale correction")),
            InventoryMovement.source_record_id == order.clover_order_id,
            InventoryMovement.source_line_id.like(f"clover:{ledger.id}:%"),
        ).count() + 1
        db.session.add(InventoryMovement(
            organization_id=order.organization_id,
            location_id=order.restaurant_location_id,
            inventory_item_id=item.id,
            quantity_delta=correction,
            quantity_before=before,
            quantity_after=after,
            unit=movement["unit"],
            source_type="clover sale consumption" if correction < 0 else "clover sale correction",
            source_record_id=order.clover_order_id,
            source_line_id=_source_line_id(ledger.id, sequence),
            reason="Verified Clover sale recipe consumption",
        ))
        item.current_on_hand = after
        ledger.applied_quantity = wanted
    return {**plan, "enabled": True, "dryRun": False, "applied": True}
