"""In-app multi-select bulk edit for inventory items (issue #234, owner decision #198 Option B).

One request applies one set of field changes to up to ``MAX_ITEMS`` selected inventory items of the current
location.  Supported fields are deliberately narrow: reorder threshold (``minQuantity``), ``parLevel``,
preferred supplier (``supplierId``, ``null`` clears it) and ``active``.  Quantities, costs and the movement
ledger are never touched.

Semantics (documented for reviewers):
* All-or-nothing.  Any validation failure or stale item rejects the whole request and writes nothing.
* Stale / concurrent edits: the client sends the value it last saw for every changed field per item
  (``expected``).  Item rows are locked ``FOR UPDATE`` (shared ``lock_inventory_items``, ascending id), so a
  concurrent writer either finishes first (this request then sees its value and reports a conflict) or waits.
  A field already at its target value is never a conflict, which makes a retry after a lost response, or a
  double submit, an idempotent no-op ("unchanged", no audit noise).
* ``dryRun`` validates against current server state and returns the same review payload without writing.
* Audit: one ``inventory.item_bulk_updated`` event per changed item plus one batch ``inventory.bulk_edit_applied``.
"""
from __future__ import annotations

import math
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import uuid4

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from .access import missing_module_dependencies, organization_has_enabled_module, organization_is_operational
from .audit import record_audit_event
from .extensions import db
from .models import InventoryItem, Supplier
from .pilot_api import _now, lock_inventory_items
from .policy import require_permission
from .utils import get_current_location, get_current_organization_bundle, json_error, serialize_inventory_item

bp = Blueprint("inventory_bulk_edit", __name__)

MAX_ITEMS = 200
MAX_QUANTITY = Decimal("9999999.9999")
QTY = Decimal("0.0001")
SUPPORTED_FIELDS = ("minQuantity", "parLevel", "supplierId", "active")


class _Reject(Exception):
    def __init__(self, message: str, status: int, errors: dict[str, str]):
        super().__init__(message)
        self.message, self.status, self.errors = message, status, errors


def _quantity(value: Any, field: str) -> Decimal:
    if isinstance(value, bool) or value is None or value == "":
        raise _Reject("Validation failed.", 400, {field: "Enter a number."})
    try:
        number = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise _Reject("Validation failed.", 400, {field: "Enter a valid number."}) from None
    if not number.is_finite() or (isinstance(value, float) and not math.isfinite(value)):
        raise _Reject("Validation failed.", 400, {field: "Enter a valid number."})
    if number < 0:
        raise _Reject("Validation failed.", 400, {field: "Cannot be negative."})
    if number > MAX_QUANTITY:
        raise _Reject("Validation failed.", 400, {field: "That quantity is too large."})
    return number.quantize(QTY)


def _int_id(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, str)) or (isinstance(value, str) and not value.strip().isdigit()):
        raise _Reject("Validation failed.", 400, {field: "Invalid id."})
    return int(value)


def _parse_changes(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or not raw:
        raise _Reject("Validation failed.", 400, {"changes": "Choose at least one field to change."})
    unknown = sorted(set(raw) - set(SUPPORTED_FIELDS))
    if unknown:
        raise _Reject("Validation failed.", 400, {"changes": f"Unsupported field: {', '.join(unknown)}."})
    changes: dict[str, Any] = {}
    for field in ("minQuantity", "parLevel"):
        if field in raw:
            changes[field] = _quantity(raw[field], field)
    if "supplierId" in raw:
        changes["supplierId"] = None if raw["supplierId"] is None else _int_id(raw["supplierId"], "supplierId")
    if "active" in raw:
        if not isinstance(raw["active"], bool):
            raise _Reject("Validation failed.", 400, {"active": "Choose active or inactive."})
        changes["active"] = raw["active"]
    return changes


def _current_values(item: InventoryItem) -> dict[str, Any]:
    return {
        "minQuantity": Decimal(item.min_quantity or 0).quantize(QTY),
        "parLevel": Decimal(item.par_level or 0).quantize(QTY),
        "supplierId": item.supplier_id,
        "active": bool(item.active),
    }


def _supplier_at_target(item: InventoryItem, target: int | None, supplier: Supplier | None) -> bool:
    """A supplier change is a no-op only when BOTH stored representations already match.

    Receipts set ``preferred_supplier_name`` without ``supplier_id``, so an item can show a supplier name while
    ``supplier_id`` is null; clearing (or assigning) must still act on it.
    """
    name = (item.preferred_supplier_name or "").strip()
    if target is None:
        return item.supplier_id is None and name == ""
    return item.supplier_id == target and supplier is not None and name == supplier.name


def _expected_value(field: str, value: Any) -> Any:
    if field in ("minQuantity", "parLevel"):
        return _quantity(value, f"expected.{field}")
    if field == "supplierId":
        return None if value is None else _int_id(value, "expected.supplierId")
    if not isinstance(value, bool):
        raise _Reject("Validation failed.", 400, {"expected": "expected.active must be true or false."})
    return value


def _plain(value: Any) -> Any:
    return float(value) if isinstance(value, Decimal) else value


def _evaluate(organization_id: int, location_id: int, ids: list[int], changes: dict[str, Any], expected_raw: Any, items: dict[int, InventoryItem]):
    """Validate every selected item against ``items`` (already tenant/location scoped). Returns review rows."""
    errors: dict[str, str] = {}
    missing = [item_id for item_id in ids if item_id not in items]
    for item_id in missing:
        errors[f"item-{item_id}"] = "Item not found in this location. Refresh and select again."
    if missing:
        raise _Reject("Some selected items are not available.", 404, errors)

    supplier = None
    if changes.get("supplierId") is not None:
        supplier = Supplier.query.filter_by(id=changes["supplierId"], organization_id=organization_id).first()
        if supplier is None:
            raise _Reject("Supplier validation failed.", 400, {"supplierId": "Supplier not found."})
        if not supplier.is_active:
            raise _Reject(
                "Supplier validation failed.",
                400,
                {"supplierId": f"{supplier.name} is archived. Restore it before using it for new purchasing."},
            )

    expected_all = expected_raw if isinstance(expected_raw, dict) else {}
    rows: list[dict[str, Any]] = []
    for item_id in ids:
        item = items[item_id]
        current = _current_values(item)
        expected_item = expected_all.get(str(item_id))
        if not isinstance(expected_item, dict):
            raise _Reject("Validation failed.", 400, {"expected": f"Missing the values you reviewed for {item.name}. Reload and review again."})
        before = {field: current[field] for field in changes}
        after = dict(before)
        stale = False
        # Every reviewed value must be well-formed even when the item is already at target (fail closed).
        reviewed: dict[str, Any] = {}
        for field in changes:
            if field not in expected_item:
                raise _Reject("Validation failed.", 400, {"expected": f"Missing the reviewed {field} for {item.name}."})
            reviewed[field] = _expected_value(field, expected_item[field])
        if "supplierId" in changes and not isinstance(expected_item.get("supplierName"), str):
            raise _Reject("Validation failed.", 400, {"expected": f"Missing the reviewed supplierName for {item.name}."})
        for field, target in changes.items():
            if field == "supplierId":
                if _supplier_at_target(item, target, supplier):
                    continue
            elif current[field] == target:
                continue  # already at target: idempotent, never stale
            if reviewed[field] != current[field]:
                stale = True
            if field == "supplierId":
                # Both stored representations are validated: receipts change the name without the id.
                if expected_item["supplierName"].strip() != (item.preferred_supplier_name or "").strip():
                    stale = True
            after[field] = target
        if stale:
            errors[f"item-{item_id}"] = f"{item.name} was changed by someone else since you reviewed it. Refresh and review again."
            continue
        merged = {**current, **after}
        if merged["parLevel"] < merged["minQuantity"] and ("parLevel" in changes or "minQuantity" in changes) and before != after:
            errors[f"item-{item_id}"] = f"PAR for {item.name} cannot be below its reorder threshold."
            continue
        changed_fields = [field for field in changes if before[field] != after[field]]
        if "supplierId" in changes and "supplierId" not in changed_fields and not _supplier_at_target(item, changes["supplierId"], supplier):
            changed_fields.append("supplierId")
        rows.append({
            "item": item, "before": before, "after": after, "changedFields": changed_fields,
            "beforeSupplierName": (item.preferred_supplier_name or "").strip(),
            "afterSupplierName": supplier.name if supplier is not None else "",
        })
    if errors:
        status = 409 if any("changed by someone else" in message for message in errors.values()) else 400
        raise _Reject("Bulk edit was not applied. Nothing was changed.", status, errors)
    return rows, supplier


def _review_payload(rows: list[dict[str, Any]], *, applied: bool, batch_id: str | None) -> dict[str, Any]:
    entries = [
        {
            "id": row["item"].id,
            "name": row["item"].name,
            "status": "changed" if row["changedFields"] else "unchanged",
            "changedFields": row["changedFields"],
            "beforeSupplierName": row["beforeSupplierName"],
            "afterSupplierName": row["afterSupplierName"],
            "before": {key: _plain(value) for key, value in row["before"].items()},
            "after": {key: _plain(value) for key, value in row["after"].items()},
        }
        for row in rows
    ]
    changed = sum(1 for entry in entries if entry["status"] == "changed")
    return {
        "applied": applied,
        "batchId": batch_id,
        "summary": {"selected": len(entries), "changed": changed, "unchanged": len(entries) - changed},
        "items": entries,
    }


@bp.post("/api/pilot/inventory/bulk-edit")
@login_required
def bulk_edit_inventory_items():
    organization, membership, locations = get_current_organization_bundle()
    if organization is None or membership is None or not locations:
        return json_error("No pilot organization is available for the current account.", 404)
    location = get_current_location()
    if location is None:
        return json_error("No pilot location is available for the current account.", 404)
    if not organization_is_operational(organization):
        return json_error("This organization is not ready for operational access yet.", 403)
    permission_error = require_permission(membership.role, "inventory.manage")
    if permission_error is not None:
        return permission_error
    # Same boundary the central pilot_api middleware enforces: the module itself and its declared dependencies.
    if not organization_has_enabled_module(organization.id, "INVENTORY"):
        return json_error("This organization does not have access to that module yet.", 403, errors={"module": "Inventory", "dependencies": "PURCHASES"})
    missing = missing_module_dependencies(organization.id, "INVENTORY")
    if missing:
        return json_error("This organization does not have access to that module yet.", 403, errors={"module": "Inventory", "dependencies": ", ".join(missing)})

    payload = request.get_json(silent=True)
    try:
        if not isinstance(payload, dict):
            raise _Reject("Request body must be JSON.", 400, {"body": "Expected a JSON object."})
        raw_ids = payload.get("itemIds")
        if not isinstance(raw_ids, list) or not raw_ids:
            raise _Reject("Validation failed.", 400, {"itemIds": "Select at least one item."})
        ids = sorted({_int_id(value, "itemIds") for value in raw_ids})
        if len(ids) > MAX_ITEMS:
            raise _Reject("Validation failed.", 400, {"itemIds": f"Select at most {MAX_ITEMS} items at a time."})
        changes = _parse_changes(payload.get("changes"))
        # The preview flag must be a real boolean: a truthy string or number must never silently turn into an apply.
        raw_dry_run = payload.get("dryRun", False)
        if not isinstance(raw_dry_run, bool):
            raise _Reject("Validation failed.", 400, {"dryRun": "Must be true or false."})
        dry_run = raw_dry_run

        if dry_run:
            items = {
                row.id: row
                for row in InventoryItem.query.filter(
                    InventoryItem.id.in_(ids), InventoryItem.organization_id == organization.id, InventoryItem.location_id == location.id
                ).all()
            }
        else:
            items = lock_inventory_items(organization.id, location.id, ids)
        rows, supplier = _evaluate(organization.id, location.id, ids, changes, payload.get("expected"), items)

        if dry_run:
            db.session.rollback()
            return jsonify(_review_payload(rows, applied=False, batch_id=None)), 200

        batch_id = uuid4().hex
        now = _now()
        for row in rows:
            if not row["changedFields"]:
                continue
            item: InventoryItem = row["item"]
            after = row["after"]
            if "minQuantity" in after:
                item.min_quantity = after["minQuantity"]
            if "parLevel" in after:
                item.par_level = after["parLevel"]
            if "supplierId" in after:
                item.supplier_id = after["supplierId"]
                item.preferred_supplier_name = supplier.name if supplier is not None else ""
            if "active" in after:
                item.active = after["active"]
            item.updated_by_user_id = current_user.id
            item.updated_at = now
            record_audit_event(
                event_type="inventory.item_bulk_updated",
                entity_type="inventory_item",
                entity_id=item.id,
                organization_id=organization.id,
                location_id=location.id,
                actor_user_id=current_user.id,
                metadata={
                    "batchId": batch_id,
                    "itemName": item.name,
                    "fields": row["changedFields"],
                    "before": {key: _plain(row["before"][key]) for key in row["changedFields"]},
                    "after": {key: _plain(after[key]) for key in row["changedFields"]},
                    **({"beforeSupplierName": row["beforeSupplierName"], "afterSupplierName": row["afterSupplierName"]} if "supplierId" in row["changedFields"] else {}),
                },
            )
        review = _review_payload(rows, applied=True, batch_id=batch_id)
        if review["summary"]["changed"]:
            record_audit_event(
                event_type="inventory.bulk_edit_applied",
                entity_type="inventory_bulk_edit",
                entity_id=batch_id,
                organization_id=organization.id,
                location_id=location.id,
                actor_user_id=current_user.id,
                metadata={"fields": sorted(changes), "selected": review["summary"]["selected"], "changed": review["summary"]["changed"]},
            )
        db.session.commit()
        # Authoritative state: re-read what was committed rather than echoing the request.
        fresh = InventoryItem.query.filter(InventoryItem.id.in_(ids), InventoryItem.organization_id == organization.id, InventoryItem.location_id == location.id).order_by(InventoryItem.id).all()
        review["refreshedItems"] = [serialize_inventory_item(item) for item in fresh]
        return jsonify(review), 200
    except _Reject as rejection:
        db.session.rollback()
        return json_error(rejection.message, rejection.status, errors=rejection.errors)
