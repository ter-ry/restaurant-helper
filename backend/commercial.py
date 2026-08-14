from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from flask import Blueprint, jsonify, request, session
from flask_login import current_user, login_required

from .audit import record_audit_event
from .extensions import csrf, db
from .models import Organization, OrganizationConfiguration, OrganizationConfigurationVersion, OrganizationInvitation, OrganizationMembership, OrganizationModule, RestaurantLocation
from .modules import MODULE_REGISTRY
from .tenant_context import apply_request_tenant_context
from .utils import clear_pilot_context, get_current_organization_bundle, get_user_memberships, json_error, serialize_organization
from .validation import clean_email

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
    location_name = str(payload.get("locationName") or "").strip()
    city = str(payload.get("city") or "").strip()
    region = str(payload.get("region") or "ON").strip() or "ON"
    postal_code = str(payload.get("postalCode") or "").strip()
    country = str(payload.get("country") or "Canada").strip() or "Canada"
    timezone = str(payload.get("timezone") or "America/Toronto").strip() or "America/Toronto"
    address_line1 = str(payload.get("addressLine1") or "").strip()
    address_line2 = str(payload.get("addressLine2") or "").strip()
    if not name:
        return json_error("Organization name is required.", 400)
    if not location_name:
        return json_error("At least one location name is required.", 400)
    if not city:
        return json_error("Location city is required.", 400)
    if template_key not in {template["templateKey"] for template in SETUP_TEMPLATES}:
        return json_error("Unknown setup template.", 400)

    apply_request_tenant_context(access_scope="setup")

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

    location = RestaurantLocation(
        organization_id=organization.id,
        name=location_name,
        address_line1=address_line1,
        address_line2=address_line2,
        city=city,
        region=region,
        postal_code=postal_code,
        country=country,
        timezone=timezone,
    )
    db.session.add(location)

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
        metadata={"templateKey": template_key, "locationName": location_name},
    )
    db.session.commit()
    clear_pilot_context()
    session["pilot_current_membership_id"] = membership.id
    session["pilot_current_organization_id"] = organization.id
    session["pilot_current_location_id"] = location.id
    return (
        jsonify(
            {
                "organization": serialize_organization(organization),
                "membershipRole": "owner",
                "currentLocationId": location.id,
            }
        ),
        201,
    )


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


def _invite_token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _serialize_invitation(invitation: OrganizationInvitation) -> dict[str, Any]:
    return {
        "id": invitation.id,
        "organizationId": invitation.organization_id,
        "invitedEmail": invitation.invited_email,
        "role": invitation.role,
        "status": invitation.status,
        "expiresAt": invitation.expires_at.isoformat() if invitation.expires_at else None,
        "revokedAt": invitation.revoked_at.isoformat() if invitation.revoked_at else None,
        "acceptedAt": invitation.accepted_at.isoformat() if invitation.accepted_at else None,
        "createdAt": invitation.created_at.isoformat() if invitation.created_at else None,
        "updatedAt": invitation.updated_at.isoformat() if invitation.updated_at else None,
    }


def _current_owner_organization():
    organization, membership, _ = get_current_organization_bundle()
    if organization is None or membership is None:
        return None, None
    if membership.role != "owner":
        return organization, None
    return organization, membership


@bp.get("/api/organization-invitations")
@login_required
def list_organization_invitations() -> tuple[object, int]:
    organization, membership = _current_owner_organization()
    if organization is None or membership is None:
        return json_error("Only the owner can manage invitations.", 403)

    invitations = (
        OrganizationInvitation.query.filter_by(organization_id=organization.id)
        .order_by(OrganizationInvitation.created_at.desc(), OrganizationInvitation.id.desc())
        .all()
    )
    return jsonify({"invitations": [_serialize_invitation(invitation) for invitation in invitations]}), 200


@bp.post("/api/organization-invitations")
@login_required
def create_organization_invitation() -> tuple[object, int]:
    organization, membership = _current_owner_organization()
    if organization is None or membership is None:
        return json_error("Only the owner can manage invitations.", 403)

    payload = request.get_json(silent=True) or {}
    invited_email = clean_email(str(payload.get("email") or ""))
    role = str(payload.get("role") or "manager").strip().lower()
    if not invited_email:
        return json_error("Invitation email is required.", 400)
    if invited_email == clean_email(current_user.email):
        return json_error("You cannot invite yourself.", 400)
    if role != "manager":
        return json_error("Only manager invitations are supported yet.", 400)

    now = datetime.now(timezone.utc)
    existing = (
        OrganizationInvitation.query.filter_by(organization_id=organization.id, invited_email=invited_email)
        .filter(OrganizationInvitation.status == "pending")
        .filter(OrganizationInvitation.revoked_at.is_(None))
        .filter(OrganizationInvitation.expires_at >= now)
        .first()
    )
    if existing is not None:
        return json_error("That invitation is already pending.", 409)

    raw_token = secrets.token_urlsafe(32)
    invitation = OrganizationInvitation(
        organization_id=organization.id,
        invited_email=invited_email,
        role=role,
        token=_invite_token_hash(raw_token),
        status="pending",
        created_by_user_id=current_user.id,
        expires_at=now + timedelta(days=7),
        single_use=True,
    )
    db.session.add(invitation)
    record_audit_event(
        event_type="invitation.created",
        entity_type="organization_invitation",
        entity_id=None,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"invitedEmail": invited_email, "role": role},
    )
    db.session.commit()
    return (
        jsonify(
            {
                "invitation": _serialize_invitation(invitation),
                "invitationUrl": f"/invite/{raw_token}",
            }
        ),
        201,
    )


@bp.post("/api/organization-invitations/<string:raw_token>/cancel")
@login_required
def cancel_organization_invitation(raw_token: str) -> tuple[object, int]:
    organization, membership = _current_owner_organization()
    if organization is None or membership is None:
        return json_error("Only the owner can manage invitations.", 403)

    invitation = OrganizationInvitation.query.filter_by(organization_id=organization.id, token=_invite_token_hash(raw_token)).first()
    if invitation is None:
        return json_error("Invitation not found.", 404)
    if invitation.status == "revoked":
        return json_error("That invitation was already revoked.", 409)
    if invitation.status == "accepted":
        return json_error("That invitation was already accepted.", 409)

    invitation.status = "revoked"
    invitation.revoked_at = datetime.now(timezone.utc)
    record_audit_event(
        event_type="invitation.revoked",
        entity_type="organization_invitation",
        entity_id=invitation.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"invitedEmail": invitation.invited_email, "role": invitation.role},
    )
    db.session.commit()
    return jsonify({"invitation": _serialize_invitation(invitation)}), 200


@bp.post("/api/organization-invitations/<int:invitation_id>/cancel")
@login_required
def cancel_organization_invitation_by_id(invitation_id: int) -> tuple[object, int]:
    organization, membership = _current_owner_organization()
    if organization is None or membership is None:
        return json_error("Only the owner can manage invitations.", 403)

    invitation = OrganizationInvitation.query.filter_by(organization_id=organization.id, id=invitation_id).first()
    if invitation is None:
        return json_error("Invitation not found.", 404)
    if invitation.status == "revoked":
        return json_error("That invitation was already revoked.", 409)
    if invitation.status == "accepted":
        return json_error("That invitation was already accepted.", 409)

    invitation.status = "revoked"
    invitation.revoked_at = datetime.now(timezone.utc)
    record_audit_event(
        event_type="invitation.revoked",
        entity_type="organization_invitation",
        entity_id=invitation.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"invitedEmail": invitation.invited_email, "role": invitation.role},
    )
    db.session.commit()
    return jsonify({"invitation": _serialize_invitation(invitation)}), 200


@csrf.exempt
@bp.post("/api/organization-invitations/<string:raw_token>/accept")
@login_required
def accept_organization_invitation(raw_token: str) -> tuple[object, int]:
    invitation = OrganizationInvitation.query.filter_by(token=_invite_token_hash(raw_token)).first()
    if invitation is None:
        return json_error("Invitation not found.", 404)
    if invitation.status == "revoked":
        return json_error("That invitation was revoked.", 409)
    if invitation.status == "accepted":
        return json_error("That invitation was already accepted.", 409)
    now = datetime.now(timezone.utc)
    expires_at = _as_utc(invitation.expires_at)
    if expires_at is None or expires_at <= now:
        invitation.status = "expired"
        db.session.commit()
        return json_error("That invitation has expired.", 410)
    if clean_email(current_user.email) != clean_email(invitation.invited_email):
        return json_error("That invitation was sent to a different email address.", 403)

    membership = OrganizationMembership.query.filter_by(
        organization_id=invitation.organization_id,
        user_id=current_user.id,
    ).first()
    if membership is None:
        membership = OrganizationMembership(
            organization_id=invitation.organization_id,
            user_id=current_user.id,
            role=invitation.role,
        )
        db.session.add(membership)
    else:
        membership.role = invitation.role

    invitation.status = "accepted"
    invitation.accepted_by_user_id = current_user.id
    invitation.accepted_at = now
    record_audit_event(
        event_type="invitation.accepted",
        entity_type="organization_invitation",
        entity_id=invitation.id,
        organization_id=invitation.organization_id,
        actor_user_id=current_user.id,
        metadata={"invitedEmail": invitation.invited_email, "role": invitation.role},
    )
    db.session.commit()
    return jsonify({"ok": True, "accepted": True, "organizationId": invitation.organization_id, "role": invitation.role}), 200
