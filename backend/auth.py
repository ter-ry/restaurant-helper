from __future__ import annotations

from datetime import datetime, timezone
import secrets
from urllib.parse import urlencode

from flask import Blueprint, current_app, jsonify, redirect, request, session
from flask_login import current_user, login_required, login_user, logout_user
from flask_wtf.csrf import generate_csrf

from .audit import record_audit_event
from .access import support_grant_for_user
from .google_oidc import (
    GoogleOIDCError,
    build_google_authorization_url,
    exchange_google_code,
    generate_google_nonce,
    generate_google_state,
    google_oidc_enabled,
    pop_google_session_context,
    store_google_session_context,
    verify_google_id_token,
)
from .extensions import db, limiter
from .models import ExternalIdentity, Organization, OrganizationMembership, User
from .validation import RequestValidationError, clean_email, parse_login_payload
from .utils import clear_pilot_context, enabled_module_keys_for_organization, get_current_location, get_current_organization_bundle, get_platform_role, get_user_memberships, json_error, serialize_membership_summaries, serialize_organization, serialize_user

bp = Blueprint("auth", __name__)
INVALID_LOGIN_MESSAGE = "Invalid email or password."


def _google_complete_redirect(*, status: str, message: str | None = None, linked: bool = False) -> object:
    params: dict[str, str] = {"status": status}
    if message:
        params["message"] = message
    if linked:
        params["linked"] = "true"
    frontend_origin = str(current_app.config.get("FLOWTALLY_FRONTEND_ORIGIN") or "").rstrip("/")
    return redirect(f"{frontend_origin}/auth/google/complete?{urlencode(params)}", code=303)


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

    return _complete_login(user, event_type_success="auth.login.success")


def _login_payload(user: User, memberships: list[OrganizationMembership], membership: OrganizationMembership | None, organization: Organization | None, current_location) -> dict[str, object]:
    support_grant = support_grant_for_user(user.id, organization.id) if organization is not None else None
    return {
        "user": serialize_user(user),
        "platformRole": get_platform_role(user.id).role if get_platform_role(user.id) else None,
        "membershipRole": membership.role if membership else None,
        "currentOrganization": serialize_organization(organization) if organization else None,
        "currentLocationId": current_location.id if current_location else None,
        "enabledModuleKeys": enabled_module_keys_for_organization(organization.id) if organization is not None else [],
        "supportAccessGrant": {
            "id": support_grant.id,
            "organizationId": support_grant.organization_id,
            "reason": support_grant.reason,
            "caseReference": support_grant.case_reference,
            "status": support_grant.status,
            "startsAt": support_grant.starts_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "expiresAt": support_grant.expires_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        if support_grant is not None
        else None,
        "organizations": serialize_membership_summaries(memberships, selected_organization_id=membership.organization_id if membership else None),
        "csrfToken": generate_csrf(),
    }


def _choose_membership_for_user(user: User) -> tuple[list[OrganizationMembership], OrganizationMembership | None]:
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
    return memberships, membership


def _complete_login(
    user: User,
    *,
    event_type_success: str,
    success_metadata: dict[str, object] | None = None,
    status_code: int = 200,
) -> tuple[object, int]:
    memberships, membership = _choose_membership_for_user(user)
    if membership is None:
        login_user(user)
        clear_pilot_context()
        record_audit_event(
            event_type="auth.login.signed_in_without_selection",
            entity_type="user",
            entity_id=user.id,
            actor_user_id=user.id,
            metadata={"membershipCount": len(memberships), **(success_metadata or {})},
        )
        db.session.commit()
        return jsonify(_login_payload(user, memberships, None, None, None)), status_code

    login_user(user)
    session["pilot_current_membership_id"] = membership.id
    session["pilot_current_organization_id"] = membership.organization_id
    organization, _, locations = get_current_organization_bundle()
    current_location = get_current_location()
    record_audit_event(
        event_type=event_type_success,
        entity_type="user",
        entity_id=user.id,
        organization_id=organization.id if organization else None,
        location_id=current_location.id if current_location else None,
        actor_user_id=user.id,
        metadata={"membershipRole": membership.role, **(success_metadata or {})},
    )
    db.session.commit()
    return jsonify(_login_payload(user, memberships, membership, organization, current_location)), status_code


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


@bp.get("/api/auth/google/start")
@limiter.limit("10 per minute")
def google_start() -> object:
    if not google_oidc_enabled():
        return json_error("Google login is not enabled.", 404)
    purpose = request.args.get("purpose", "login").strip().lower()
    if purpose not in {"login", "link"}:
        return json_error("Unsupported Google login purpose.", 400)
    state = generate_google_state()
    nonce = generate_google_nonce()
    store_google_session_context(state=state, nonce=nonce, purpose=purpose)
    return redirect(build_google_authorization_url(state=state, nonce=nonce), code=302)


@bp.get("/api/auth/google/callback")
@limiter.limit("10 per minute")
def google_callback():
    if not google_oidc_enabled():
        return json_error("Google login is not enabled.", 404)

    query_state = request.args.get("state", "").strip()
    code = request.args.get("code", "").strip()
    error = request.args.get("error", "").strip()
    if error:
        return json_error("Google authentication was not completed.", 400)
    if not query_state or not code:
        return json_error("Google callback is missing the authorization response.", 400)

    context = pop_google_session_context()
    if not context["state"] or context["state"] != query_state:
        return json_error("Google login state validation failed.", 400)
    if not context["expires_at"] or context["purpose"] not in {"login", "link"}:
        return _google_complete_redirect(status="error", message="Google login session expired.")

    try:
        tokens = exchange_google_code(code)
        claims = verify_google_id_token(tokens.id_token, nonce=context["nonce"])
    except GoogleOIDCError as exc:
        return _google_complete_redirect(status="error", message=str(exc))
    except Exception:
        return _google_complete_redirect(status="error", message="Google login failed.")

    email = clean_email(str(claims.get("email") or ""))
    subject = str(claims.get("sub") or "").strip()
    if not email or not subject:
        return json_error("Google account information was incomplete.", 400)

    identity = ExternalIdentity.query.filter_by(provider="google", provider_subject=subject).first()
    user = identity.user if identity and identity.user else None
    if user is None:
        existing_user = User.query.filter_by(email=email).first()
        if existing_user is not None:
            if context["purpose"] == "link" and current_user.is_authenticated and current_user.id == existing_user.id:
                user = existing_user
            else:
                return json_error("That Google account is already associated with a different Flowtally account.", 409)
        else:
            user = User(email=email, is_active=True)
            user.set_password(secrets.token_urlsafe(32))
            db.session.add(user)
            db.session.flush()
        identity = ExternalIdentity(user_id=user.id, provider="google", provider_subject=subject, email_at_link=email, last_login_at=datetime.now(timezone.utc))
        db.session.add(identity)
    else:
        identity.email_at_link = email
        identity.last_login_at = datetime.now(timezone.utc)

    if context["purpose"] == "link" and current_user.is_authenticated:
        if clean_email(current_user.email) != email:
            return _google_complete_redirect(status="error", message="Google account email does not match the signed-in account.")
        if user.id != current_user.id:
            return _google_complete_redirect(status="error", message="That Google account is already linked to another Flowtally user.")
        db.session.commit()
        return _google_complete_redirect(status="success", linked=True)

    session.clear()
    login_user(user)
    memberships, membership = _choose_membership_for_user(user)
    if membership is None:
        clear_pilot_context()
        record_audit_event(
            event_type="auth.google.login",
            entity_type="user",
            entity_id=user.id,
            actor_user_id=user.id,
            metadata={"providerSubject": subject, "membershipCount": len(memberships)},
        )
        db.session.commit()
        return _google_complete_redirect(status="success")

    session["pilot_current_membership_id"] = membership.id
    session["pilot_current_organization_id"] = membership.organization_id
    organization, _, _ = get_current_organization_bundle()
    current_location = get_current_location()
    record_audit_event(
        event_type="auth.google.login",
        entity_type="user",
        entity_id=user.id,
        organization_id=organization.id if organization else None,
        location_id=current_location.id if current_location else None,
        actor_user_id=user.id,
        metadata={"providerSubject": subject, "membershipRole": membership.role},
    )
    db.session.commit()
    return _google_complete_redirect(status="success")


@bp.get("/api/auth/me")
@login_required
def me() -> tuple[object, int]:
    organization, membership, locations = get_current_organization_bundle()
    current_location = get_current_location()
    support_grant = support_grant_for_user(current_user.id, organization.id) if organization is not None else None
    return (
        jsonify(
            {
                "user": serialize_user(current_user),
                "platformRole": get_platform_role(current_user.id).role if get_platform_role(current_user.id) else None,
                "membershipRole": membership.role if membership else None,
                "currentOrganizationId": organization.id if organization else None,
                "currentLocationId": current_location.id if current_location else None,
                "enabledModuleKeys": enabled_module_keys_for_organization(organization.id) if organization else [],
                "supportAccessGrant": {
                    "id": support_grant.id,
                    "organizationId": support_grant.organization_id,
                    "reason": support_grant.reason,
                    "caseReference": support_grant.case_reference,
                    "status": support_grant.status,
                    "startsAt": support_grant.starts_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "expiresAt": support_grant.expires_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                }
                if support_grant is not None
                else None,
                "organizations": serialize_membership_summaries(
                    get_user_memberships(current_user.id),
                    selected_organization_id=organization.id if organization else None,
                ),
                "csrfToken": generate_csrf(),
            }
        ),
        200,
    )
