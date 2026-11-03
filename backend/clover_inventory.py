"""Guarded Clover shadow-order inventory reconciliation."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from flask import current_app, has_app_context

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
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("Invalid Clover ingredient quantity.") from exc


def _line_removed(line: Any) -> bool:
    """True when Clover's complete collection dropped a line that had been applied."""
    preview = getattr(line, "recipe_preview_json", None)
    return isinstance(preview, dict) and bool(preview.get("removed"))


def _refund_kind(order: CloverShadowOrder) -> str:
    """Classify refunds from Clover's numeric amounts, not status strings."""
    raw = order.raw_payload_json or {}
    try:
        refunded = sum(int(Decimal(str(value.get("amount") or 0))) for value in (raw.get("refunds") or []) if isinstance(value, dict))
        total = int(order.total_cents if order.total_cents is not None else (raw.get("total") or 0))
    except (InvalidOperation, TypeError, ValueError):
        return "unknown"
    if refunded <= 0:
        return "none"
    return "full" if total > 0 and refunded >= total else "partial"


def _not_prepared_established(order: CloverShadowOrder, line_id: int) -> bool:
    """True only with explicit per-line evidence that the item was never prepared.

    Clover refunds, voids and removed lines do not prove the food was not made
    (a refunded burger was still cooked), and `printed` is unusable at counters
    without kitchen printers. So stock is restored only when the line carries an
    explicit ``notPrepared: true`` marker (reserved for a verified signal such as
    an owner confirmation or kitchen-display status). Clover's API sets none
    today, so every case currently surfaces for review instead.
    """
    line = next((value for value in order.lines if value.id == line_id), None)
    clover_line_id = getattr(line, "clover_line_item_id", None)
    if not clover_line_id:
        return False
    raw_lines = (order.raw_payload_json or {}).get("lineItems") or []
    return any(isinstance(entry, dict) and str(entry.get("id")) == str(clover_line_id) and entry.get("notPrepared") is True for entry in raw_lines)


def _reversal_reason(order: CloverShadowOrder, rows: list[CloverShadowOrderLineInventoryConsumption]) -> str:
    """Reversal needs a definitive cancel/full refund AND not-prepared evidence for every applied line."""
    status = str(getattr(order, "normalized_status", "") or "")
    if status == "cancelled":
        reason = "order_cancelled_or_voided_not_prepared"
    elif status == "refunded" and _refund_kind(order) == "full":
        reason = "order_fully_refunded_not_prepared"
    else:
        return ""
    if rows and all(_not_prepared_established(order, row.clover_shadow_order_line_id) for row in rows):
        return reason
    return ""


def _reverse_row(row: CloverShadowOrderLineInventoryConsumption) -> dict[str, Any]:
    applied = _decimal(row.applied_quantity or 0).quantize(QTY)
    return {
        "lineId": row.clover_shadow_order_line_id,
        "inventoryItemId": row.inventory_item_id,
        "quantity": "0.0000",
        "appliedQuantity": str(applied),
        "correction": str((-applied).quantize(QTY)),
        "state": "correction",
        "unit": getattr(row.inventory_item, "stock_unit", ""),
        "itemName": getattr(row.inventory_item, "name", ""),
    }


def _base_plan(order: CloverShadowOrder) -> dict[str, Any]:
    raw = order.raw_payload_json or {}
    if not order.potentially_eligible or order.requires_review or order.normalized_status != "paid":
        return {"orderId": order.clover_order_id, "eligible": False, "reason": "order_not_financially_verified", "movements": [], "staleApplied": []}
    if any(bool(raw.get(key)) for key in ("incomplete", "lineItemsIncomplete", "financialIncomplete", "refundsUnverified", "paymentStateConflict")):
        return {"orderId": order.clover_order_id, "eligible": False, "reason": "financial_or_line_data_incomplete", "movements": [], "staleApplied": []}

    desired: dict[tuple[int, int], dict[str, Any]] = {}
    for line in order.lines:
        preview = line.recipe_preview_json or {}
        if _line_removed(line):
            continue
        ingredients = preview.get("ingredients") if isinstance(preview, dict) else None
        if line.mapping_status != "mapped" or not isinstance(ingredients, list) or not ingredients:
            return {"orderId": order.clover_order_id, "eligible": False, "reason": "line_mapping_or_recipe_missing", "movements": [], "staleApplied": []}
        for ingredient in ingredients:
            if not isinstance(ingredient, dict):
                return {"orderId": order.clover_order_id, "eligible": False, "reason": "invalid_recipe_ingredient", "movements": [], "staleApplied": []}
            try:
                quantity = _decimal(ingredient.get("quantity")).quantize(QTY)
            except ValueError:
                return {"orderId": order.clover_order_id, "eligible": False, "reason": "invalid_recipe_quantity", "movements": [], "staleApplied": []}
            inventory_item_id = ingredient.get("inventoryItemId")
            unit = str(ingredient.get("unit") or "").strip()
            if quantity <= 0 or not inventory_item_id or not unit:
                return {"orderId": order.clover_order_id, "eligible": False, "reason": "invalid_recipe_ingredient", "movements": [], "staleApplied": []}
            key = (line.id, int(inventory_item_id))
            row = desired.setdefault(key, {"lineId": line.id, "inventoryItemId": int(inventory_item_id), "quantity": Decimal("0"), "unit": unit, "itemName": str(ingredient.get("name") or "")})
            if row["unit"] != unit:
                return {"orderId": order.clover_order_id, "eligible": False, "reason": "ingredient_unit_conflict", "movements": [], "staleApplied": []}
            row["quantity"] += quantity

    movements = []
    for row in desired.values():
        movements.append({
            "lineId": row["lineId"],
            "inventoryItemId": row["inventoryItemId"],
            "quantity": str((-row["quantity"]).quantize(QTY)),
            "unit": row["unit"],
            "itemName": row["itemName"],
        })
    return {"orderId": order.clover_order_id, "eligible": True, "reason": "", "movements": movements, "staleApplied": []}


def _with_ledger_deltas(order: CloverShadowOrder, plan: dict[str, Any], ledgers: list[CloverShadowOrderLineInventoryConsumption]) -> dict[str, Any]:
    by_key = {(row.clover_shadow_order_line_id, row.inventory_item_id): row for row in ledgers}
    desired_keys = {(int(row["lineId"]), int(row["inventoryItemId"])) for row in plan["movements"]}
    removed_line_ids = {line.id for line in order.lines if _line_removed(line) and _not_prepared_established(order, line.id)}
    stale_all = [row for key, row in by_key.items() if key not in desired_keys and _decimal(row.applied_quantity or 0) != 0]
    reversible = [row for row in stale_all if row.clover_shadow_order_line_id in removed_line_ids]
    stale = [row for row in stale_all if row.clover_shadow_order_line_id not in removed_line_ids]
    plan["staleApplied"] = [
        {"lineId": row.clover_shadow_order_line_id, "inventoryItemId": row.inventory_item_id, "appliedQuantity": str(_decimal(row.applied_quantity or 0).quantize(QTY))}
        for row in stale
    ]
    if stale:
        plan["eligible"] = False
        plan["appliedRequiresReview"] = True
        plan["reason"] = "stale_applied_ingredient_requires_review"
        for row in stale:
            plan["movements"].append({
                "lineId": row.clover_shadow_order_line_id,
                "inventoryItemId": row.inventory_item_id,
                "quantity": "0.0000",
                "appliedQuantity": str(_decimal(row.applied_quantity or 0).quantize(QTY)),
                "correction": None,
                "state": "stale_requires_review",
                "unit": getattr(row.inventory_item, "stock_unit", ""),
                "itemName": getattr(row.inventory_item, "name", ""),
            })
        return plan

    for row in reversible:
        plan["movements"].append(_reverse_row(row))
    for movement in plan["movements"]:
        if movement.get("state") == "correction" and movement.get("correction") is not None:
            continue
        key = (int(movement["lineId"]), int(movement["inventoryItemId"]))
        ledger = by_key.get(key)
        applied = _decimal(ledger.applied_quantity or 0) if ledger else Decimal("0")
        wanted = _decimal(movement["quantity"])
        correction = (wanted - applied).quantize(QTY)
        movement["appliedQuantity"] = str(applied.quantize(QTY))
        movement["correction"] = str(correction)
        movement["state"] = "new" if ledger is None else ("unchanged" if correction == 0 else "correction")
    plan["newlyRequired"] = [m for m in plan["movements"] if m.get("state") == "new"]
    plan["corrections"] = [m for m in plan["movements"] if m.get("state") == "correction"]
    plan["alreadyApplied"] = [m for m in plan["movements"] if m.get("state") == "unchanged"]
    return plan


def _with_ineligible_ledger(order: CloverShadowOrder, plan: dict[str, Any], ledgers: list[CloverShadowOrderLineInventoryConsumption]) -> dict[str, Any]:
    """Never leave previously applied usage unaddressed on an ineligible order."""
    applied = [row for row in ledgers if _decimal(row.applied_quantity or 0) != 0]
    if not applied:
        return plan
    reversal_reason = _reversal_reason(order, applied)
    if reversal_reason:
        plan["eligible"] = True
        plan["reason"] = reversal_reason
        plan["movements"] = [_reverse_row(row) for row in applied]
        plan["newlyRequired"] = []
        plan["corrections"] = list(plan["movements"])
        plan["alreadyApplied"] = []
        return plan
    plan["appliedRequiresReview"] = True
    plan["refundKind"] = _refund_kind(order)
    plan["staleApplied"] = [
        {"lineId": row.clover_shadow_order_line_id, "inventoryItemId": row.inventory_item_id, "appliedQuantity": str(_decimal(row.applied_quantity or 0).quantize(QTY))}
        for row in applied
    ]
    return plan


def plan_clover_order_inventory(
    order: CloverShadowOrder,
    *,
    existing_ledgers: list[CloverShadowOrderLineInventoryConsumption] | None = None,
) -> dict[str, Any]:
    """Return the exact execution deltas without changing persistence."""
    plan = _base_plan(order)
    ledgers = existing_ledgers
    if ledgers is None and not has_app_context():
        ledgers = []
    if ledgers is None:
        line_ids = [line.id for line in order.lines if line.id is not None]
        ledgers = CloverShadowOrderLineInventoryConsumption.query.filter(
            CloverShadowOrderLineInventoryConsumption.clover_shadow_order_line_id.in_(line_ids or [-1]),
            CloverShadowOrderLineInventoryConsumption.organization_id == order.organization_id,
            CloverShadowOrderLineInventoryConsumption.location_id == order.restaurant_location_id,
        ).all()
    if not plan["eligible"]:
        return _with_ineligible_ledger(order, plan, ledgers)
    return _with_ledger_deltas(order, plan, ledgers)


def _source_line_id(consumption_id: int, sequence: int) -> str:
    return f"clover:{consumption_id}:{sequence}"


def apply_clover_order_inventory(
    *,
    order: CloverShadowOrder,
    connection: CloverConnection,
    dry_run: bool = False,
    session=None,
) -> dict[str, Any]:
    """Apply a verified order atomically, or return an exact dry-run plan."""
    session = session or db.session
    ensure_inventory_source(PosProvider.CLOVER)
    if (
        connection.organization_id != order.organization_id
        or getattr(order, "clover_connection_id", connection.id) != connection.id
        or connection.status != "connected"
        or connection.environment != "sandbox"
        or (getattr(order, "clover_merchant_id", connection.merchant_id) and str(order.clover_merchant_id) != str(connection.merchant_id or ""))
    ):
        raise ValueError("Clover order and connection scope do not match.")
    line_ids = sorted(line.id for line in order.lines if line.id is not None)
    locked_lines = {
        line.id: line for line in (
            session.query(CloverShadowOrderLine).filter(
                CloverShadowOrderLine.id.in_(line_ids or [-1]),
                CloverShadowOrderLine.shadow_order_id == order.id,
                CloverShadowOrderLine.organization_id == order.organization_id,
                CloverShadowOrderLine.restaurant_location_id == order.restaurant_location_id,
            ).order_by(CloverShadowOrderLine.id.asc()).with_for_update().all()
        )
    }
    if len(locked_lines) != len(line_ids) and not (dry_run or not clover_order_inventory_enabled()):
        raise ValueError("Clover shadow line scope changed during reconciliation.")

    # Lock inventory rows in deterministic ID order before changing any state.
    ledger_item_ids = {
        row.inventory_item_id for row in session.query(CloverShadowOrderLineInventoryConsumption).filter(
            CloverShadowOrderLineInventoryConsumption.clover_shadow_order_line_id.in_(line_ids or [-1]),
            CloverShadowOrderLineInventoryConsumption.organization_id == order.organization_id,
            CloverShadowOrderLineInventoryConsumption.location_id == order.restaurant_location_id,
        ).all()
    }
    ingredient_ids = sorted({
        int(ingredient.get("inventoryItemId"))
        for line in order.lines
        for ingredient in ((line.recipe_preview_json or {}).get("ingredients") or [])
        if isinstance(ingredient, dict) and ingredient.get("inventoryItemId")
    } | ledger_item_ids)
    locked_items = {
        item.id: item for item in (
            session.query(InventoryItem).filter(
                InventoryItem.id.in_(ingredient_ids or [-1]),
                InventoryItem.organization_id == order.organization_id,
                InventoryItem.location_id == order.restaurant_location_id,
            ).order_by(InventoryItem.id.asc()).with_for_update().all()
        )
    }
    if any(item_id not in locked_items for item_id in ingredient_ids) and not (dry_run or not clover_order_inventory_enabled()):
        raise ValueError("Clover recipe ingredient no longer matches the inventory scope.")

    ledgers = session.query(CloverShadowOrderLineInventoryConsumption).filter(
        CloverShadowOrderLineInventoryConsumption.clover_shadow_order_line_id.in_(line_ids or [-1]),
        CloverShadowOrderLineInventoryConsumption.organization_id == order.organization_id,
        CloverShadowOrderLineInventoryConsumption.location_id == order.restaurant_location_id,
    ).order_by(
        CloverShadowOrderLineInventoryConsumption.clover_shadow_order_line_id.asc(),
        CloverShadowOrderLineInventoryConsumption.inventory_item_id.asc(),
    ).with_for_update().all()
    plan = plan_clover_order_inventory(order, existing_ledgers=ledgers)
    plan["enabled"] = clover_order_inventory_enabled()
    plan["dryRun"] = bool(dry_run or not clover_order_inventory_enabled())
    plan["applied"] = False
    if dry_run or not clover_order_inventory_enabled() or not plan["eligible"]:
        return plan

    by_key = {(row.clover_shadow_order_line_id, row.inventory_item_id): row for row in ledgers}
    for movement in sorted(plan["movements"], key=lambda value: (int(value["inventoryItemId"]), int(value["lineId"]))):
        if movement.get("state") == "unchanged":
            continue
        line = locked_lines[int(movement["lineId"])]
        item = locked_items[int(movement["inventoryItemId"])]
        if str(item.stock_unit or "").strip() != movement["unit"]:
            raise ValueError("Clover recipe ingredient no longer matches the inventory scope.")
        ledger = by_key.get((line.id, item.id))
        if ledger is None:
            ledger = CloverShadowOrderLineInventoryConsumption(
                organization_id=order.organization_id,
                location_id=order.restaurant_location_id,
                clover_shadow_order_line_id=line.id,
                inventory_item_id=item.id,
                applied_quantity=Decimal("0"),
                unit_cost_snapshot=Decimal(str(item.average_unit_cost or 0)),
            )
            session.add(ledger)
            session.flush()
            by_key[(line.id, item.id)] = ledger
        correction = _decimal(movement["correction"])
        if correction == 0:
            continue
        before = _decimal(item.current_on_hand or 0)
        after = (before + correction).quantize(QTY)
        sequence = session.query(InventoryMovement).filter(
            InventoryMovement.organization_id == order.organization_id,
            InventoryMovement.location_id == order.restaurant_location_id,
            InventoryMovement.source_type.in_(("clover sale consumption", "clover sale correction")),
            InventoryMovement.source_record_id == order.clover_order_id,
            InventoryMovement.source_line_id.like(f"clover:{ledger.id}:%"),
        ).count() + 1
        session.add(InventoryMovement(
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
            reason="Verified Clover sale recipe consumption" if correction < 0 else "Clover sale correction or reversal",
        ))
        item.current_on_hand = after
        ledger.applied_quantity = _decimal(movement["quantity"])
    return {**plan, "applied": True}
