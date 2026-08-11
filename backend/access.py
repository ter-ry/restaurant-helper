from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from flask import request, session
from flask_login import current_user

from .models import Organization, OrganizationModule, SupportAccessGrant
from .modules import MODULE_REGISTRY, module_dependency_keys
from .utils import get_current_organization_bundle, json_error


OPERATIONAL_ORG_STATUSES = {"ACTIVE"}
OPERATIONAL_SETUP_STATUSES = {"COMPLETE"}
OPERATIONAL_SUBSCRIPTION_STATUSES = {"ACTIVE"}
ENABLED_MODULE_STATUSES = {"ENABLED"}
SUPPORT_ACCESS_ENABLED = False

ENDPOINT_MODULE_KEYS: dict[str, str] = {
    "pilot_api.correct_purchase_invoice": "PURCHASES",
    "pilot_api.bootstrap": "PURCHASES",
    "pilot_api.set_current_location": "PURCHASES",
    "pilot_api.dashboard": "REPORTING",
    "pilot_api.purchases": "PURCHASES",
    "pilot_api.purchase_invoice_detail": "PURCHASES",
    "pilot_api.suppliers": "PURCHASES",
    "pilot_api.create_supplier": "PURCHASES",
    "pilot_api.update_supplier": "PURCHASES",
    "pilot_api.create_purchase_invoice": "PURCHASES",
    "pilot_api.update_purchase_invoice": "PURCHASES",
    "pilot_api.receive_purchase_invoice": "PURCHASES",
    "pilot_api.inventory": "INVENTORY",
    "pilot_api.inventory_item_detail": "INVENTORY",
    "pilot_api.create_inventory_item": "INVENTORY",
    "pilot_api.update_inventory_item": "INVENTORY",
    "pilot_api.create_inventory_adjustment": "INVENTORY",
    "pilot_api.list_count_sessions": "STOCK_COUNTS",
    "pilot_api.create_count_session": "STOCK_COUNTS",
    "pilot_api.get_count_session": "STOCK_COUNTS",
    "pilot_api.update_count_session": "STOCK_COUNTS",
    "pilot_api.finalize_count_session": "STOCK_COUNTS",
    "pilot_api.mark_reorder_item_ordered": "REORDER_PLANS",
    "pilot_api.reorder_plan": "REORDER_PLANS",
    "pilot_api.list_reorder_plans": "REORDER_PLANS",
    "pilot_api.create_or_open_reorder_plan": "REORDER_PLANS",
    "pilot_api.get_reorder_plan": "REORDER_PLANS",
    "pilot_api.update_reorder_plan": "REORDER_PLANS",
    "pilot_api.prepare_reorder_plan": "REORDER_PLANS",
    "pilot_api.complete_reorder_plan": "REORDER_PLANS",
    "pilot_api.menu_costing": "MENU_COSTING",
    "pilot_api.create_menu_costing_recipe": "MENU_COSTING",
    "pilot_api.update_menu_costing_recipe": "MENU_COSTING",
    "pilot_api.delete_menu_costing_recipe": "MENU_COSTING",
    "pilot_api.create_menu_costing_recipe_ingredient": "MENU_COSTING",
    "pilot_api.update_menu_costing_recipe_ingredient": "MENU_COSTING",
    "pilot_api.delete_menu_costing_recipe_ingredient": "MENU_COSTING",
    "pilot_api.create_menu_costing_menu_item": "MENU_COSTING",
    "pilot_api.update_menu_costing_menu_item": "MENU_COSTING",
    "pilot_api.delete_menu_costing_menu_item": "MENU_COSTING",
    "pilot_api.list_audit_events": "REPORTING",
}


def current_organization() -> Organization | None:
    organization, _, _ = get_current_organization_bundle()
    return organization


def organization_module_status(organization_id: int, module_key: str) -> OrganizationModule | None:
    return OrganizationModule.query.filter_by(organization_id=organization_id, module_key=module_key).first()


def organization_has_enabled_module(organization_id: int, module_key: str) -> bool:
    module = organization_module_status(organization_id, module_key)
    return bool(module and module.status in ENABLED_MODULE_STATUSES)


def organization_is_operational(organization: Organization | None) -> bool:
    if organization is None:
        return False
    return (
        organization.lifecycle_status in OPERATIONAL_ORG_STATUSES
        and organization.setup_status in OPERATIONAL_SETUP_STATUSES
        and organization.subscription_status in OPERATIONAL_SUBSCRIPTION_STATUSES
    )


def missing_module_dependencies(organization_id: int, module_key: str) -> list[str]:
    missing: list[str] = []
    for dependency_key in module_dependency_keys(module_key):
        if not organization_has_enabled_module(organization_id, dependency_key):
            missing.append(dependency_key)
    return missing


def module_access_error(module_key: str, *, dependency_keys: list[str] | None = None):
    module = MODULE_REGISTRY.get(module_key)
    if module is None:
        return json_error("That module is not available.", 404)
    return json_error(
        "This organization does not have access to that module yet.",
        403,
        errors={
            "module": module["displayName"],
            "dependencies": ", ".join(dependency_keys or module_dependency_keys(module_key)),
        },
    )


def access_state_for_request(endpoint: str) -> dict[str, Any] | None:
    if not endpoint.startswith("pilot_api."):
        return None

    if not current_user.is_authenticated:
        return {"status": 401, "message": "Authentication required."}

    organization, membership, locations = get_current_organization_bundle()
    if organization is None or membership is None:
        return {"status": 404, "message": "No pilot organization is available for the current account."}

    location_id = session.get("pilot_current_location_id")
    if location_id is None and locations:
        location_id = locations[0].id if len(locations) == 1 else None
    if location_id is None:
        return {"status": 404, "message": "No pilot location is available for the current account."}

    if not organization_is_operational(organization):
        return {
            "status": 403,
            "message": "This organization is not ready for operational access yet.",
            "errors": {
                "organizationLifecycle": organization.lifecycle_status,
                "setupStatus": organization.setup_status,
                "subscriptionStatus": organization.subscription_status,
            },
        }

    module_key = ENDPOINT_MODULE_KEYS.get(endpoint)
    if module_key:
        if not organization_has_enabled_module(organization.id, module_key):
            module = MODULE_REGISTRY.get(module_key)
            return {
                "status": 403,
                "message": "This organization does not have access to that module yet.",
                "errors": {
                    "module": module["displayName"] if module else module_key,
                    "dependencies": ", ".join(module_dependency_keys(module_key)),
                },
            }
        missing_dependencies = missing_module_dependencies(organization.id, module_key)
        if missing_dependencies:
            module = MODULE_REGISTRY.get(module_key)
            return {
                "status": 403,
                "message": "This organization does not have access to that module yet.",
                "errors": {
                    "module": module["displayName"] if module else module_key,
                    "dependencies": ", ".join(missing_dependencies),
                },
            }

    return None


def support_grant_for_user(user_id: int, organization_id: int) -> SupportAccessGrant | None:
    if not SUPPORT_ACCESS_ENABLED:
        return None
    now = datetime.now(timezone.utc)
    return (
        SupportAccessGrant.query.filter(
            SupportAccessGrant.support_user_id == user_id,
            SupportAccessGrant.organization_id == organization_id,
            SupportAccessGrant.status == "active",
            SupportAccessGrant.starts_at <= now,
            SupportAccessGrant.expires_at >= now,
            SupportAccessGrant.revoked_at.is_(None),
        )
        .order_by(SupportAccessGrant.expires_at.desc(), SupportAccessGrant.id.desc())
        .first()
    )


def support_access_is_active_for_current_user() -> bool:
    if not SUPPORT_ACCESS_ENABLED:
        return False
    if not current_user.is_authenticated:
        return False
    organization = current_organization()
    if organization is None:
        return False
    return support_grant_for_user(current_user.id, organization.id) is not None


def enforce_operational_access():
    if request.method == "OPTIONS":
        return None

    endpoint = request.endpoint or ""
    state = access_state_for_request(endpoint)
    if state is None:
        return None
    if state.get("status") == 404:
        return json_error(str(state.get("message") or "Not found."), 404)
    return json_error(str(state.get("message") or "Access denied."), int(state.get("status") or 403), errors=state.get("errors"))
