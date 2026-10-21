from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from flask import Blueprint, current_app, jsonify, redirect, request, session
from flask_login import current_user, login_required

from .audit import record_audit_event
from .clover import CloverRequestError, clover_authorize_url, clover_enabled, clover_request, parse_clover_timestamp
from .extensions import db
from .models import CloverConnection, Organization, OrganizationMembership
from .square import decrypt_integration_secret, encrypt_integration_secret
from .tenant_context import apply_org_tenant_context
from .utils import isoformat, json_error, get_platform_role

bp = Blueprint("clover_integration", __name__)
STATE_KEY = "clover_oauth_context"
LAUNCH_KEY = "clover_launch_context"
STATE_TTL = timedelta(minutes=10)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _can_manage(organization: Organization) -> bool:
    if get_platform_role(current_user.id) and get_platform_role(current_user.id).role == "setup_admin":
        return True
    return OrganizationMembership.query.filter_by(user_id=current_user.id, organization_id=organization.id, role="owner").first() is not None


def _organization(org_id: int | None) -> Organization | None:
    return Organization.query.filter_by(id=org_id).first() if org_id else None


def _allowlisted(organization: Organization | None) -> bool:
    if organization is None:
        return False
    allowed_ids = {int(value) for value in (current_app.config.get("CLOVER_ALLOWED_ORGANIZATION_IDS") or [])}
    return organization.id in allowed_ids


def _clover_access_configured() -> bool:
    if not clover_enabled():
        return False
    if str(current_app.config.get("FLOWTALLY_ENV") or "").strip().lower() == "production":
        return bool(current_app.config.get("CLOVER_ALLOWED_ORGANIZATION_IDS"))
    return True


def _require(organization: Organization | None):
    if organization is None:
        return json_error("Organization not found.", 404)
    if not _clover_access_configured() or not _allowlisted(organization):
        return json_error("Clover is unavailable for this organization.", 404)
    if not _can_manage(organization):
        return json_error("Clover access is restricted to the organization owner or platform setup staff.", 403)
    apply_org_tenant_context(organization, access_scope="setup" if get_platform_role(current_user.id) else None)
    return None


def _frontend_path(path: str) -> str:
    origin = str(current_app.config.get("FLOWTALLY_FRONTEND_ORIGIN") or "").rstrip("/")
    return f"{origin}{path}"


def _new_oauth_context(*, organization: Organization, merchant_id: str | None = None) -> str:
    state = secrets.token_urlsafe(32)
    context: dict[str, Any] = {
        "state": state,
        "organization_id": organization.id,
        "user_id": current_user.id,
        "expires_at": (_now() + STATE_TTL).isoformat(),
    }
    if merchant_id:
        context["launch_merchant_id"] = merchant_id
    session[STATE_KEY] = context
    return state


def _authorize_redirect(*, state: str):
    return redirect(clover_authorize_url(state=state, client_id=current_app.config["CLOVER_CLIENT_ID"], redirect_uri=current_app.config["CLOVER_REDIRECT_URI"]))


def _serialize(connection: CloverConnection | None) -> dict[str, Any]:
    if connection is None:
        return {"status": "disconnected", "environment": current_app.config.get("CLOVER_ENVIRONMENT", "sandbox"), "region": current_app.config.get("CLOVER_REGION", "north_america")}
    return {
        "id": connection.id,
        "organizationId": connection.organization_id,
        "environment": connection.environment,
        "region": connection.region,
        "merchantId": connection.merchant_id,
        "merchantName": connection.merchant_name,
        "status": connection.status,
        "accessExpiresAt": isoformat(connection.access_expires_at),
        "refreshExpiresAt": isoformat(connection.refresh_expires_at),
        "lastConnectionCheckAt": isoformat(connection.last_connection_check_at),
        "revokedAt": isoformat(connection.revoked_at),
        "disconnectedAt": isoformat(connection.disconnected_at),
        "error": connection.last_error or None,
        "reconnectRequired": connection.status == "reauthorization_required",
    }


@bp.get("/api/integrations/clover/start")
@login_required
def start_clover_oauth():
    if not _clover_access_configured():
        return json_error("Clover is not enabled.", 404)
    try:
        org_id = int(request.args.get("organizationId", ""))
    except ValueError:
        org_id = None
    organization = _organization(org_id)
    denied = _require(organization)
    if denied is not None:
        return denied
    assert organization is not None
    return _authorize_redirect(state=_new_oauth_context(organization=organization))


@bp.get("/api/integrations/clover/launch")
def clover_launch():
    """Receive Clover's merchant-dashboard launch without trusting it for tenant binding.

    Clover supplies the merchant identifier, but only an authenticated Flowtally
    user who explicitly continues for the selected organization can start OAuth.
    """
    if not _clover_access_configured():
        return json_error("Clover is unavailable.", 404)
    client_id = str(request.args.get("client_id") or request.args.get("clientId") or "").strip()
    if client_id and client_id != current_app.config["CLOVER_CLIENT_ID"]:
        return json_error("Clover launch client is not recognized.", 400)
    merchant_id = str(request.args.get("merchant_id") or request.args.get("merchantId") or "").strip()
    if not merchant_id or len(merchant_id) > 128:
        return json_error("Clover launch merchant identity is required.", 400)
    session[LAUNCH_KEY] = {
        "merchant_id": merchant_id,
        "client_id": current_app.config["CLOVER_CLIENT_ID"],
        "nonce": secrets.token_urlsafe(24),
        "expires_at": (_now() + STATE_TTL).isoformat(),
    }
    # The user must choose/confirm the Flowtally organization in the workspace;
    # the Clover merchant id is never used to select one automatically.
    return redirect(_frontend_path("/app/login?redirectTo=/app/square?cloverLaunch=1"), code=303)


@bp.get("/api/integrations/clover/launch/resume")
@login_required
def resume_clover_launch():
    if not clover_enabled():
        return json_error("Clover is not enabled.", 404)
    context = session.get(LAUNCH_KEY) or {}
    try:
        expires = datetime.fromisoformat(str(context.get("expires_at")))
    except (TypeError, ValueError):
        expires = None
    if not context or expires is None or expires < _now():
        session.pop(LAUNCH_KEY, None)
        return json_error("Clover launch session is invalid or expired.", 400)
    try:
        org_id = int(request.args.get("organizationId", ""))
    except ValueError:
        org_id = None
    organization = _organization(org_id)
    denied = _require(organization)
    if denied is not None:
        return denied
    assert organization is not None
    merchant_id = str(context.get("merchant_id") or "").strip()
    if not merchant_id:
        session.pop(LAUNCH_KEY, None)
        return json_error("Clover launch merchant identity is missing.", 400)
    session.pop(LAUNCH_KEY, None)
    return _authorize_redirect(state=_new_oauth_context(organization=organization, merchant_id=merchant_id))


@bp.get("/api/integrations/clover/callback")
@login_required
def clover_callback():
    context = session.pop(STATE_KEY, None) or {}
    try:
        expires = datetime.fromisoformat(str(context.get("expires_at")))
    except (TypeError, ValueError):
        expires = None
    if not context or context.get("state") != request.args.get("state") or context.get("user_id") != current_user.id or expires is None or expires < _now():
        return json_error("Clover authorization session is invalid or expired.", 400)
    organization = _organization(int(context.get("organization_id")))
    denied = _require(organization)
    if denied is not None:
        return denied
    merchant_id = str(request.args.get("merchant_id") or "").strip()
    client_id = str(request.args.get("client_id") or "").strip()
    code = str(request.args.get("code") or "").strip()
    if not merchant_id or client_id != current_app.config["CLOVER_CLIENT_ID"] or not code:
        return json_error("Clover authorization response is incomplete.", 400)
    expected_merchant_id = str(context.get("launch_merchant_id") or "").strip()
    if expected_merchant_id and merchant_id != expected_merchant_id:
        return json_error("Clover merchant identity does not match the launch.", 400)
    try:
        token_payload = clover_request("POST", "/oauth/v2/token", payload={"client_id": current_app.config["CLOVER_CLIENT_ID"], "client_secret": current_app.config["CLOVER_CLIENT_SECRET"], "code": code})
        access_token = str(token_payload.get("access_token") or "")
        if not access_token or not str(token_payload.get("refresh_token") or "").strip():
            raise CloverRequestError("Clover did not return a complete token pair.")
        merchant = clover_request("GET", f"/v3/merchants/{merchant_id}", token=access_token)
        returned_id = str(merchant.get("id") or merchant.get("merchant_id") or "").strip()
        if not returned_id or returned_id != merchant_id:
            raise CloverRequestError("Clover merchant identity could not be verified.")
    except CloverRequestError as exc:
        return jsonify({"error": str(exc), "code": exc.code}), 502
    assert organization is not None
    connection = CloverConnection.query.filter_by(organization_id=organization.id).first() or CloverConnection(organization_id=organization.id)
    connection.environment = current_app.config.get("CLOVER_ENVIRONMENT", "sandbox")
    connection.region = current_app.config.get("CLOVER_REGION", "north_america")
    connection.merchant_id = merchant_id
    connection.merchant_name = str(merchant.get("name") or merchant.get("label") or "")[:255]
    connection.status = "connected"
    connection.access_token_ciphertext = encrypt_integration_secret(access_token)
    connection.refresh_token_ciphertext = encrypt_integration_secret(str(token_payload.get("refresh_token") or ""))
    connection.access_expires_at = parse_clover_timestamp(token_payload.get("access_token_expiration"))
    connection.refresh_expires_at = parse_clover_timestamp(token_payload.get("refresh_token_expiration"))
    connection.revoked_at = None
    connection.disconnected_at = None
    connection.last_error = ""
    connection.last_connection_check_at = _now()
    db.session.add(connection)
    record_audit_event(event_type="clover.oauth.connected", entity_type="clover_connection", entity_id=connection.id, organization_id=organization.id, actor_user_id=current_user.id, metadata={"merchantId": merchant_id, "environment": connection.environment})
    db.session.commit()
    return redirect(f"{current_app.config.get('FLOWTALLY_FRONTEND_ORIGIN', '').rstrip('/')}/app/square?clover=connected", code=302)


@bp.get("/api/integrations/clover/status")
@login_required
def clover_status():
    try:
        org_id = int(request.args.get("organizationId", ""))
    except ValueError:
        org_id = None
    organization = _organization(org_id)
    if organization is None:
        return json_error("Organization not found.", 404)
    # Authorize the requested organization before evaluating or revealing
    # Clover allowlist state. This prevents callers from probing which tenant
    # IDs are enabled for Clover.
    if not _can_manage(organization):
        return json_error("Clover access is restricted to the organization owner or platform setup staff.", 403)
    if not _clover_access_configured() or not _allowlisted(organization):
        apply_org_tenant_context(organization, access_scope="setup" if get_platform_role(current_user.id) else None)
        return jsonify({"enabled": False, "connection": None}), 200
    apply_org_tenant_context(organization, access_scope="setup" if get_platform_role(current_user.id) else None)
    return jsonify({"enabled": True, "connection": _serialize(CloverConnection.query.filter_by(organization_id=organization.id).first())}), 200


@bp.post("/api/integrations/clover/disconnect")
@login_required
def clover_disconnect():
    payload = request.get_json(silent=True) or {}
    try:
        org_id = int(payload.get("organizationId") or request.args.get("organizationId") or "")
    except ValueError:
        org_id = None
    organization = _organization(org_id)
    denied = _require(organization)
    if denied is not None:
        return denied
    assert organization is not None
    connection = CloverConnection.query.filter_by(organization_id=organization.id).first()
    if connection is None:
        return jsonify({"connection": _serialize(None)}), 200
    connection.status = "disconnected"
    connection.access_token_ciphertext = ""
    connection.refresh_token_ciphertext = ""
    connection.recovery_token_ciphertext = ""
    connection.revoked_at = _now()
    connection.disconnected_at = _now()
    connection.last_error = ""
    record_audit_event(event_type="clover.oauth.disconnected", entity_type="clover_connection", entity_id=connection.id, organization_id=organization.id, actor_user_id=current_user.id, metadata={"remoteRevocation": "not_supported"})
    db.session.commit()
    return jsonify({"connection": _serialize(connection), "remoteRevocation": "not_supported"}), 200


@bp.post("/api/integrations/clover/refresh")
@login_required
def clover_refresh():
    payload = request.get_json(silent=True) or {}
    try:
        org_id = int(payload.get("organizationId") or request.args.get("organizationId") or "")
    except ValueError:
        org_id = None
    organization = _organization(org_id)
    denied = _require(organization)
    if denied is not None:
        return denied
    assert organization is not None
    connection = CloverConnection.query.filter_by(organization_id=organization.id).with_for_update().first()
    if connection is None or not connection.refresh_token_ciphertext:
        return json_error("Clover requires authorization.", 409)
    old_refresh = decrypt_integration_secret(connection.refresh_token_ciphertext)
    try:
        token_payload = clover_request("POST", "/oauth/v2/refresh", payload={"client_id": current_app.config["CLOVER_CLIENT_ID"], "refresh_token": old_refresh})
    except CloverRequestError as exc:
        # Timeouts, rate limits, and provider outages do not prove revocation;
        # leave the current credentials and connected state intact.
        if exc.status_code not in {401, 403}:
            return jsonify({"connection": _serialize(connection), "error": "Clover refresh is temporarily unavailable.", "code": exc.code}), 503
        if not connection.recovery_token_ciphertext:
            connection.status = "reauthorization_required"
            connection.last_error = exc.code
            db.session.commit()
            return jsonify({"connection": _serialize(connection), "error": "Clover authorization must be renewed.", "code": "clover_reauthorization_required"}), 409
        try:
            token_payload = clover_request("POST", "/oauth/v2/recovery", payload={"client_id": current_app.config["CLOVER_CLIENT_ID"], "client_secret": current_app.config["CLOVER_CLIENT_SECRET"], "recovery_token": decrypt_integration_secret(connection.recovery_token_ciphertext)})
        except CloverRequestError as recovery_exc:
            if recovery_exc.status_code not in {401, 403}:
                return jsonify({"connection": _serialize(connection), "error": "Clover recovery is temporarily unavailable.", "code": recovery_exc.code}), 503
            connection.status = "reauthorization_required"
            connection.last_error = "clover_reauthorization_required"
            db.session.commit()
            return jsonify({"connection": _serialize(connection), "error": "Clover authorization must be renewed.", "code": "clover_reauthorization_required"}), 409
    access_token = str(token_payload.get("access_token") or "").strip()
    new_refresh = str(token_payload.get("refresh_token") or "").strip()
    if not access_token or not new_refresh:
        return json_error("Clover refresh did not return a complete token pair.", 502)
    connection.recovery_token_ciphertext = encrypt_integration_secret(old_refresh)
    connection.recovery_expires_at = _now() + timedelta(days=14)
    connection.refresh_token_ciphertext = encrypt_integration_secret(new_refresh)
    connection.access_token_ciphertext = encrypt_integration_secret(access_token)
    connection.access_expires_at = parse_clover_timestamp(token_payload.get("access_token_expiration"))
    connection.refresh_expires_at = parse_clover_timestamp(token_payload.get("refresh_token_expiration"))
    connection.status = "connected"
    connection.last_error = ""
    connection.last_connection_check_at = _now()
    record_audit_event(event_type="clover.oauth.refreshed", entity_type="clover_connection", entity_id=connection.id, organization_id=organization.id, actor_user_id=current_user.id)
    db.session.commit()
    return jsonify({"connection": _serialize(connection)}), 200
