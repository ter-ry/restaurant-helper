from __future__ import annotations

from functools import wraps
from typing import Any, Callable, ParamSpec, TypeVar

from flask import request, g
from flask_login import current_user, login_required

from .utils import get_current_membership, json_error

P = ParamSpec("P")
R = TypeVar("R")


PERMISSION_ROLES: dict[str, set[str]] = {
    "operational.read": {"owner", "manager"},
    "suppliers.manage": {"owner", "manager"},
    "inventory.manage": {"owner", "manager"},
    "purchases.manage": {"owner", "manager"},
    "stock_counts.manage": {"owner", "manager"},
    "reorder.manage": {"owner", "manager"},
    "organization.manage": {"owner"},
    "memberships.manage": {"owner"},
    "audit.view": {"owner"},
}

ENDPOINT_PERMISSIONS: dict[str, str] = {
    "pilot_api.correct_purchase_invoice": "purchases.manage",
    "pilot_api.bootstrap": "operational.read",
    "pilot_api.set_current_location": "operational.read",
    "pilot_api.dashboard": "operational.read",
    "pilot_api.purchases": "operational.read",
    "pilot_api.purchase_invoice_detail": "operational.read",
    "pilot_api.suppliers": "suppliers.manage",
    "pilot_api.create_supplier": "suppliers.manage",
    "pilot_api.update_supplier": "suppliers.manage",
    "pilot_api.create_purchase_invoice": "purchases.manage",
    "pilot_api.update_purchase_invoice": "purchases.manage",
    "pilot_api.receive_purchase_invoice": "purchases.manage",
    "pilot_api.inventory": "inventory.manage",
    "pilot_api.inventory_item_detail": "inventory.manage",
    "pilot_api.create_inventory_item": "inventory.manage",
    "pilot_api.update_inventory_item": "inventory.manage",
    "pilot_api.create_inventory_adjustment": "inventory.manage",
    "pilot_api.list_count_sessions": "stock_counts.manage",
    "pilot_api.create_count_session": "stock_counts.manage",
    "pilot_api.get_count_session": "stock_counts.manage",
    "pilot_api.update_count_session": "stock_counts.manage",
    "pilot_api.finalize_count_session": "stock_counts.manage",
    "pilot_api.mark_reorder_item_ordered": "reorder.manage",
    "pilot_api.reorder_plan": "reorder.manage",
    "pilot_api.list_reorder_plans": "reorder.manage",
    "pilot_api.create_or_open_reorder_plan": "reorder.manage",
    "pilot_api.get_reorder_plan": "reorder.manage",
    "pilot_api.update_reorder_plan": "reorder.manage",
    "pilot_api.prepare_reorder_plan": "reorder.manage",
    "pilot_api.complete_reorder_plan": "reorder.manage",
    "pilot_api.list_audit_events": "audit.view",
}


def membership_has_permission(role: str | None, permission: str) -> bool:
    return bool(role) and role in PERMISSION_ROLES.get(permission, set())


def require_pilot_permission(permission: str):
    def decorator(view: Callable[P, R]):
        @wraps(view)
        @login_required
        def wrapper(*args: P.args, **kwargs: P.kwargs):
            membership = get_current_membership()
            if membership is None:
                return json_error("No pilot organization is available for the current account.", 404)
            if not membership_has_permission(membership.role, permission):
                return json_error("You do not have permission to do that.", 403, errors={"permission": "Access is restricted for this action."})
            return view(*args, **kwargs)

        return wrapper

    return decorator


def require_permission(membership_role: str | None, permission: str):
    if membership_has_permission(membership_role, permission):
        return None
    return json_error("You do not have permission to do that.", 403, errors={"permission": "Access is restricted for this action."})


def enforce_endpoint_permission():
    if request.method == "OPTIONS":
        return None

    endpoint = request.endpoint or ""
    if not endpoint.startswith("pilot_api."):
        return None
    if endpoint == "pilot_api.health":
        return None
    permission = ENDPOINT_PERMISSIONS.get(endpoint)
    if permission is None:
        raise RuntimeError(f"Missing centralized permission mapping for {endpoint}.")

    membership = get_current_membership()
    if membership is None:
        return None

    return require_permission(membership.role, permission)


def actor_summary() -> dict[str, Any]:
    user = current_user if current_user.is_authenticated else None
    return {
        "actorUserId": user.id if user else None,
        "actorEmail": user.email if user else None,
        "requestId": getattr(g, "request_id", None),
    }
