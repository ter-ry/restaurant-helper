from __future__ import annotations

from flask import Blueprint, jsonify, request, session
from flask_login import current_user, login_required

from .audit import record_audit_event
from .extensions import db
from .models import Organization, RestaurantLocation
from .utils import (
    clear_pilot_context,
    get_current_location,
    get_current_organization_bundle,
    get_user_memberships,
    json_error,
    membership_for_organization,
    serialize_location,
    serialize_membership,
    serialize_organization,
)

bp = Blueprint("organizations", __name__)


def _serialize_bundle(organization: Organization, locations: list[RestaurantLocation], role: str | None = None) -> dict:
    current_location = get_current_location()
    payload = {
        "organization": serialize_organization(organization),
        "restaurantLocations": [serialize_location(location) for location in locations],
        "currentLocation": serialize_location(current_location) if current_location else None,
    }
    if role is not None:
        payload["membershipRole"] = role
    return payload


@bp.get("/api/organizations")
@login_required
def organizations() -> tuple[object, int]:
    memberships = get_user_memberships(current_user.id)
    current_organization, current_membership, _ = get_current_organization_bundle()
    current_location = get_current_location()
    current_bundle = None
    current_locations: list[dict[str, object]] = []
    if current_organization is not None and current_membership is not None:
        _, _, organization_locations = get_current_organization_bundle()
        current_bundle = _serialize_bundle(current_organization, organization_locations, current_membership.role)
        current_locations = [serialize_location(location) for location in organization_locations]
    return (
        jsonify(
            {
                "organizations": [
                    {
                        "membership": serialize_membership(membership),
                        "organization": serialize_organization(membership.organization),
                        "membershipRole": membership.role,
                        "selected": bool(current_organization and membership.organization_id == current_organization.id),
                    }
                    for membership in memberships
                    if membership.organization is not None
                ],
                "currentOrganizationId": current_organization.id if current_organization else None,
                "currentMembershipId": current_membership.id if current_membership else None,
                "currentLocationId": current_location.id if current_location else None,
                "currentOrganization": current_bundle,
                "restaurantLocations": current_locations,
            }
        ),
        200,
    )


@bp.get("/api/organizations/current")
@login_required
def current_organization() -> tuple[object, int]:
    organization, membership, locations = get_current_organization_bundle()
    if organization is None or membership is None:
        return json_error("No organization is available for the current account.", 404)
    return jsonify(_serialize_bundle(organization, locations, membership.role)), 200


@bp.get("/api/organizations/<int:organization_id>")
@login_required
def organization_detail(organization_id: int) -> tuple[object, int]:
    organization, membership, locations = get_current_organization_bundle()
    if organization is None or membership is None:
        return json_error("That organization is not available to the current account.", 403)
    if organization.id != organization_id:
        return json_error("That organization is not available to the current account.", 403)

    return jsonify(_serialize_bundle(organization, locations, membership.role)), 200


@bp.post("/api/organizations/select")
@login_required
def select_organization() -> tuple[object, int]:
    body = request.get_json(silent=True) or {}
    organization_id = body.get("organizationId")
    try:
        organization_id = int(organization_id)
    except (TypeError, ValueError):
        return json_error("Validation failed.", 400, errors={"organizationId": "This field is required."})

    membership = membership_for_organization(current_user.id, organization_id)
    if membership is None:
        return json_error("That organization is not available to the current account.", 403)

    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)

    locations = (
        RestaurantLocation.query.filter_by(organization_id=organization.id)
        .order_by(RestaurantLocation.created_at.asc(), RestaurantLocation.id.asc())
        .all()
    )
    clear_pilot_context()

    session["pilot_current_membership_id"] = membership.id
    session["pilot_current_organization_id"] = organization.id
    if len(locations) == 1:
        session["pilot_current_location_id"] = locations[0].id

    record_audit_event(
        event_type="tenant.organization_selected",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"membershipRole": membership.role},
    )
    db.session.commit()
    return jsonify(_serialize_bundle(organization, locations, membership.role)), 200


@bp.get("/api/locations")
@login_required
def locations() -> tuple[object, int]:
    organization, membership, locations = get_current_organization_bundle()
    if organization is None or membership is None:
        return json_error("No organization is selected for the current account.", 404)
    current_location = get_current_location()
    return (
        jsonify(
            {
                "organizationId": organization.id,
                "restaurantLocations": [serialize_location(location) for location in locations],
                "currentLocation": serialize_location(current_location) if current_location else None,
            }
        ),
        200,
    )


@bp.post("/api/locations/select")
@login_required
def select_location() -> tuple[object, int]:
    organization, membership, locations = get_current_organization_bundle()
    if organization is None or membership is None:
        return json_error("No organization is selected for the current account.", 404)

    payload = request.get_json(silent=True) or {}
    location_id = payload.get("locationId")
    try:
        location_id = int(location_id)
    except (TypeError, ValueError):
        return json_error("Validation failed.", 400, errors={"locationId": "This field is required."})

    location = next((entry for entry in locations if entry.id == location_id), None)
    if location is None:
        return json_error("That location is not available to the current account.", 403)

    session["pilot_current_location_id"] = location.id
    record_audit_event(
        event_type="tenant.location_selected",
        entity_type="restaurant_location",
        entity_id=location.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"membershipRole": membership.role},
    )
    db.session.commit()
    return jsonify({"currentLocation": serialize_location(location)}), 200
