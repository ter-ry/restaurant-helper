from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request, session
from flask_login import current_user, login_required, login_user, logout_user
from flask_wtf.csrf import generate_csrf

from .audit import record_audit_event
from .extensions import db, limiter
from .models import User
from .validation import RequestValidationError, clean_email, parse_login_payload
from .utils import clear_pilot_context, get_current_location, get_current_organization_bundle, get_user_memberships, json_error, serialize_organization, serialize_user

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
        record_audit_event(
            event_type="auth.login.failed",
            entity_type="user",
            entity_id=clean_email(email),
            metadata={"loginEmail": clean_email(email), "reason": "invalid_credentials"},
        )
        db.session.commit()
        return json_error(INVALID_LOGIN_MESSAGE, 401)

    memberships = get_user_memberships(user.id)
    membership = None
    current_organization_id = session.get("pilot_current_organization_id")
    if current_organization_id is not None:
        try:
            current_organization_id = int(current_organization_id)
        except (TypeError, ValueError):
            current_organization_id = None
    if current_organization_id is not None:
        membership = next((entry for entry in memberships if entry.organization_id == current_organization_id), None)
    if membership is None and len(memberships) == 1:
        membership = memberships[0]
    if membership is None:
        login_user(user)
        clear_pilot_context()
        record_audit_event(
            event_type="auth.login.signed_in_without_selection",
            entity_type="user",
            entity_id=user.id,
            actor_user_id=user.id,
            metadata={"membershipCount": len(memberships)},
        )
        db.session.commit()
        return (
            jsonify(
                {
                    "user": serialize_user(user),
                    "membershipRole": None,
                    "currentOrganization": None,
                    "currentLocationId": None,
                    "organizations": [
                        {
                            **serialize_organization(entry.organization),
                            "membershipRole": entry.role,
                        }
                        for entry in memberships
                        if entry.organization is not None
                    ],
                    "csrfToken": generate_csrf(),
                }
            ),
            200,
        )

    login_user(user)
    session["pilot_current_membership_id"] = membership.id
    session["pilot_current_organization_id"] = membership.organization_id
    organization, _, locations = get_current_organization_bundle()
    current_location = get_current_location()
    record_audit_event(
        event_type="auth.login.success",
        entity_type="user",
        entity_id=user.id,
        organization_id=organization.id if organization else None,
        location_id=current_location.id if current_location else None,
        actor_user_id=user.id,
        metadata={"membershipRole": membership.role},
    )
    db.session.commit()
    return (
        jsonify(
            {
                "user": serialize_user(user),
                "membershipRole": membership.role,
                "currentOrganization": serialize_organization(organization) if organization else None,
                "currentLocationId": current_location.id if current_location else None,
                "organizations": [
                    {
                        **serialize_organization(entry.organization),
                        "membershipRole": entry.role,
                    }
                    for entry in memberships
                    if entry.organization is not None
                ],
                "csrfToken": generate_csrf(),
            }
        ),
        200,
    )


@bp.post("/api/auth/logout")
@login_required
def logout() -> tuple[dict[str, bool], int]:
    organization, membership, _ = get_current_organization_bundle()
    record_audit_event(
        event_type="auth.logout",
        entity_type="user",
        entity_id=current_user.id,
        organization_id=organization.id if organization else None,
        actor_user_id=current_user.id,
    )
    clear_pilot_context()
    logout_user()
    db.session.commit()
    return {"ok": True}, 200


@bp.get("/api/auth/me")
@login_required
def me() -> tuple[object, int]:
    organization, membership, locations = get_current_organization_bundle()
    current_location = get_current_location()
    return (
        jsonify(
            {
                "user": serialize_user(current_user),
                "membershipRole": membership.role if membership else None,
                "currentOrganizationId": organization.id if organization else None,
                "currentLocationId": current_location.id if current_location else None,
                "organizations": [
                    {
                        **serialize_organization(entry.organization),
                        "membershipRole": entry.role,
                    }
                    for entry in get_user_memberships(current_user.id)
                    if entry.organization is not None
                ],
                "csrfToken": generate_csrf(),
            }
        ),
        200,
    )
