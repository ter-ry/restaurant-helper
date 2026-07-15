from __future__ import annotations

from flask import Blueprint, jsonify
from flask_login import current_user, login_required

from .models import Organization, RestaurantLocation
from .utils import get_current_organization_bundle, json_error, membership_for_organization, serialize_location, serialize_organization

bp = Blueprint("organizations", __name__)


def _serialize_bundle(organization: Organization, locations: list[RestaurantLocation], role: str | None = None) -> dict:
    current_location = locations[0] if locations else None
    payload = {
        "organization": serialize_organization(organization),
        "restaurantLocations": [serialize_location(location) for location in locations],
        "currentLocation": serialize_location(current_location) if current_location else None,
    }
    if role is not None:
        payload["membershipRole"] = role
    return payload


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
    return jsonify(_serialize_bundle(organization, locations, membership.role)), 200

