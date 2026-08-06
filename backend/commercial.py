from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from .audit import record_audit_event
from .extensions import db
from .models import Organization, OrganizationConfiguration, OrganizationConfigurationVersion, OrganizationMembership, OrganizationModule
from .modules import MODULE_REGISTRY
from .utils import get_user_memberships, json_error, serialize_organization

bp = Blueprint("commercial", __name__)

ORG_LIFECYCLE_DEMO = "DEMO"
ORG_LIFECYCLE_ONBOARDING = "ONBOARDING"
ORG_LIFECYCLE_READY_FOR_REVIEW = "READY_FOR_REVIEW"
ORG_LIFECYCLE_ACTIVE = "ACTIVE"
ORG_LIFECYCLE_SUSPENDED = "SUSPENDED"
ORG_LIFECYCLE_CANCELLED = "CANCELLED"

SETUP_NOT_STARTED = "NOT_STARTED"
SETUP_INTAKE = "INTAKE"
SETUP_DATA_REQUESTED = "DATA_REQUESTED"
SETUP_CONFIGURATION_IN_PROGRESS = "CONFIGURATION_IN_PROGRESS"
SETUP_CUSTOMER_REVIEW = "CUSTOMER_REVIEW"
SETUP_COMPLETE = "COMPLETE"

SUBSCRIPTION_NONE = "NONE"
SUBSCRIPTION_SETUP_PAYMENT_PENDING = "SETUP_PAYMENT_PENDING"
SUBSCRIPTION_SETUP_PAID = "SETUP_PAID"
SUBSCRIPTION_ACTIVE = "ACTIVE"
SUBSCRIPTION_PAST_DUE = "PAST_DUE"
SUBSCRIPTION_CANCELLED = "CANCELLED"

SETUP_TEMPLATES: list[dict[str, Any]] = [
    {
        "templateKey": "GENERIC_RESTAURANT",
        "displayName": "Generic independent restaurant",
        "description": "A balanced setup for a small full-service restaurant.",
        "defaultModules": ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS"],
    },
    {
        "templateKey": "CAFE",
        "displayName": "Café",
        "description": "A lighter purchasing and inventory setup for a café or drink shop.",
        "defaultModules": ["PURCHASES", "INVENTORY", "REORDER_PLANS"],
    },
    {
        "templateKey": "BAKERY",
        "displayName": "Bakery",
        "description": "A setup tuned for bakery production and ingredient control.",
        "defaultModules": ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS"],
    },
    {
        "templateKey": "QSR",
        "displayName": "Quick-service restaurant",
        "description": "A fast-moving setup for order-heavy operations.",
        "defaultModules": ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS"],
    },
    {
        "templateKey": "MULTI_LOCATION",
        "displayName": "Multi-location restaurant",
        "description": "A setup for groups operating more than one location.",
        "defaultModules": ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS", "REPORTING"],
    },
]


def _prospect_org_for_user(user_id: int) -> Organization | None:
    return (
        Organization.query.join(OrganizationMembership, OrganizationMembership.organization_id == Organization.id)
        .filter(OrganizationMembership.user_id == user_id)
        .filter(Organization.is_prospect.is_(True))
        .order_by(Organization.created_at.desc(), Organization.id.desc())
        .first()
    )


def list_module_definitions() -> list[dict[str, Any]]:
    return list(MODULE_REGISTRY.values())


def list_setup_templates() -> list[dict[str, Any]]:
    return list(SETUP_TEMPLATES)


def organization_operationally_ready(organization: Organization | None) -> bool:
    if organization is None:
        return False
    return (
        organization.lifecycle_status == ORG_LIFECYCLE_ACTIVE
        and organization.setup_status == SETUP_COMPLETE
        and organization.subscription_status == SUBSCRIPTION_ACTIVE
    )


@bp.get("/api/public/modules")
def public_modules() -> tuple[dict[str, list[dict[str, Any]]], int]:
    return {"modules": list(MODULE_REGISTRY.values())}, 200


@bp.get("/api/public/setup-templates")
def public_setup_templates() -> tuple[dict[str, list[dict[str, Any]]], int]:
    return {"templates": SETUP_TEMPLATES}, 200


@bp.get("/api/onboarding/organizations")
@login_required
def list_onboarding_organizations() -> tuple[dict[str, Any], int]:
    memberships = get_user_memberships(current_user.id)
    return (
        {
            "organizations": [
                {
                    "organization": serialize_organization(membership.organization),
                    "membershipRole": membership.role,
                    "selected": False,
                }
                for membership in memberships
                if membership.organization is not None
            ]
        },
        200,
    )


@bp.post("/api/onboarding/organizations")
@login_required
def create_prospect_organization() -> tuple[object, int]:
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    template_key = str(payload.get("templateKey") or "GENERIC_RESTAURANT").strip() or "GENERIC_RESTAURANT"
    if not name:
        return json_error("Organization name is required.", 400)
    if template_key not in {template["templateKey"] for template in SETUP_TEMPLATES}:
        return json_error("Unknown setup template.", 400)

    existing = _prospect_org_for_user(current_user.id)
    if existing is not None and existing.lifecycle_status != "CANCELLED":
        return json_error("This account already has a prospective organization.", 409)

    organization = Organization(
        name=name,
        lifecycle_status="ONBOARDING",
        setup_status="INTAKE",
        subscription_status="NONE",
        setup_template_key=template_key,
        setup_fee_status="NONE",
        subscription_provider="",
        external_customer_reference="",
        external_subscription_reference="",
        is_prospect=True,
    )
    db.session.add(organization)
    db.session.flush()

    membership = OrganizationMembership(user_id=current_user.id, organization_id=organization.id, role="owner")
    db.session.add(membership)

    template = next(template for template in SETUP_TEMPLATES if template["templateKey"] == template_key)
    for module_key in template["defaultModules"]:
        db.session.add(
            OrganizationModule(
                organization_id=organization.id,
                module_key=module_key,
                status="SETUP_REQUIRED",
                configuration_json={},
                enabled_at=None,
                enabled_by_user_id=None,
            )
        )

    configuration = OrganizationConfiguration(organization_id=organization.id, draft_name=f"{name} setup")
    db.session.add(configuration)

    record_audit_event(
        event_type="onboarding.prospect_created",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"templateKey": template_key},
    )
    db.session.commit()
    return jsonify({"organization": serialize_organization(organization), "membershipRole": "owner"}), 201


@bp.post("/api/onboarding/organizations/<int:organization_id>/request-setup")
@login_required
def request_setup(organization_id: int) -> tuple[object, int]:
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    membership = next((entry for entry in get_user_memberships(current_user.id) if entry.organization_id == organization.id), None)
    if membership is None or membership.role != "owner":
        return json_error("Only the owner can request setup.", 403)

    organization.lifecycle_status = "READY_FOR_REVIEW"
    organization.setup_status = "CUSTOMER_REVIEW"
    organization.subscription_status = "SETUP_PAYMENT_PENDING"
    organization.setup_fee_status = "pending"
    record_audit_event(
        event_type="onboarding.setup_requested",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
    )
    db.session.commit()
    return jsonify({"organization": serialize_organization(organization)}), 200
