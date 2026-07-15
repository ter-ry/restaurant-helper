from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from flask import Response, jsonify, session
from flask_login import current_user

from .models import Organization, OrganizationMembership, RestaurantLocation, User


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


def get_current_membership() -> OrganizationMembership | None:
    if not current_user.is_authenticated:
        return None

    membership_id = session.get("pilot_current_membership_id")
    if membership_id:
        membership = OrganizationMembership.query.filter_by(id=membership_id, user_id=current_user.id).first()
        if membership is not None:
            return membership

    membership = (
        OrganizationMembership.query.filter_by(user_id=current_user.id)
        .order_by(OrganizationMembership.created_at.asc(), OrganizationMembership.id.asc())
        .first()
    )
    if membership is not None:
        session["pilot_current_membership_id"] = membership.id
    return membership


def get_current_organization_bundle() -> tuple[Organization | None, OrganizationMembership | None, list[RestaurantLocation]]:
    membership = get_current_membership()
    if membership is None:
        return None, None, []

    organization = Organization.query.filter_by(id=membership.organization_id).first()
    if organization is None:
        return None, None, []

    locations = (
        RestaurantLocation.query.filter_by(organization_id=organization.id)
        .order_by(RestaurantLocation.created_at.asc(), RestaurantLocation.id.asc())
        .all()
    )
    return organization, membership, locations


def membership_for_organization(user_id: int, organization_id: int) -> OrganizationMembership | None:
    return OrganizationMembership.query.filter_by(user_id=user_id, organization_id=organization_id).first()

