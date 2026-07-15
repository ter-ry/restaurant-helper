from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request, session
from flask_login import current_user, login_required, login_user, logout_user
from flask_wtf.csrf import generate_csrf

from .extensions import db, limiter
from .models import User
from .validation import RequestValidationError, clean_email, parse_login_payload
from .utils import get_current_organization_bundle, json_error, serialize_organization, serialize_user

bp = Blueprint("auth", __name__)
INVALID_LOGIN_MESSAGE = "Invalid email or password."


@bp.get("/api/auth/csrf")
def csrf_token() -> tuple[dict[str, str], int]:
    return {"csrfToken": generate_csrf()}, 200


@bp.post("/api/auth/login")
@limiter.limit("5 per minute")
def login() -> tuple[object, int]:
    payload = request.get_json(silent=True)
    try:
        email, password = parse_login_payload(payload)
    except RequestValidationError as exc:
        return json_error(exc.message, 400, errors=exc.errors)

    user = User.query.filter_by(email=clean_email(email)).first()
    if user is None or not user.is_active or not user.check_password(password):
        return json_error(INVALID_LOGIN_MESSAGE, 401)

    membership = user.memberships[0] if user.memberships else None
    if membership is None:
        return json_error(INVALID_LOGIN_MESSAGE, 401)

    login_user(user)
    session["pilot_current_membership_id"] = membership.id
    organization, _, locations = get_current_organization_bundle()
    current_location = locations[0] if locations else None
    return (
        jsonify(
            {
                "user": serialize_user(user),
                "membershipRole": membership.role,
                "currentOrganization": serialize_organization(organization) if organization else None,
                "currentLocationId": current_location.id if current_location else None,
                "csrfToken": generate_csrf(),
            }
        ),
        200,
    )


@bp.post("/api/auth/logout")
@login_required
def logout() -> tuple[dict[str, bool], int]:
    session.pop("pilot_current_membership_id", None)
    logout_user()
    return {"ok": True}, 200


@bp.get("/api/auth/me")
@login_required
def me() -> tuple[object, int]:
    organization, membership, locations = get_current_organization_bundle()
    current_location = locations[0] if locations else None
    return (
        jsonify(
            {
                "user": serialize_user(current_user),
                "membershipRole": membership.role if membership else None,
                "currentOrganizationId": organization.id if organization else None,
                "currentLocationId": current_location.id if current_location else None,
                "csrfToken": generate_csrf(),
            }
        ),
        200,
    )

