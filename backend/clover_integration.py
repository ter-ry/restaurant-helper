from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from flask import Blueprint, current_app, jsonify, redirect, request, session
from flask_login import current_user, login_required

from .audit import record_audit_event
from .clover import CloverRequestError, clover_authorize_url, clover_enabled, clover_request, parse_clover_timestamp
from .clover_catalog import CloverCatalogClient, CloverCatalogDisabled, CloverCatalogIncomplete, clover_catalog_enabled
from .clover_orders import CloverOrderClient
from .pos import recipe_ingredient_quantity
from .extensions import db
from .models import CloverConnection, CloverLocationMapping, CloverMenuMapping, CloverShadowOrder, CloverShadowOrderLine, MenuItem, Organization, OrganizationMembership, RecipeIngredient, RestaurantLocation
from .square import SquareSecurityError, decrypt_integration_secret, encrypt_integration_secret
from .tenant_context import apply_org_tenant_context
from .utils import isoformat, json_error, get_platform_role

bp = Blueprint("clover_integration", __name__)
STATE_KEY = "clover_oauth_context"
LAUNCH_KEY = "clover_launch_context"
STATE_TTL = timedelta(minutes=10)


def _now() -> datetime:
    return datetime.now(timezone.utc)


CLOVER_REFRESH_SKEW = timedelta(minutes=2)


def _token_is_stale(connection: CloverConnection) -> bool:
    expires_at = connection.access_expires_at
    # Missing metadata is unknown, not proof of expiry; the first provider
    # request is allowed to establish whether a bounded 401 refresh is needed.
    if expires_at is None:
        return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at <= _now() + CLOVER_REFRESH_SKEW


def _refresh_connection_token(
    connection: CloverConnection,
    organization: Organization,
    *,
    observed_ciphertext: str | None = None,
    force: bool = False,
) -> str:
    """Refresh one Clover connection while serializing single-use token rotation."""
    locked = (
        CloverConnection.query.filter_by(id=connection.id, organization_id=organization.id)
        # Refresh the identity-mapped instance before taking the row lock. A
        # concurrent request may have rotated the single-use refresh token
        # since this connection was first loaded in the session.
        .populate_existing()
        .with_for_update()
        .first()
    )
    if locked is None or not locked.refresh_token_ciphertext:
        raise CloverRequestError("Clover authorization must be renewed.", status_code=401, code="clover_reauthorization_required")

    if (
        force
        and observed_ciphertext
        and locked.access_token_ciphertext
        and locked.access_token_ciphertext != observed_ciphertext
        and locked.status == "connected"
        and not _token_is_stale(locked)
    ):
        return decrypt_integration_secret(locked.access_token_ciphertext)
    if (
        not force
        and locked.status == "connected"
        and locked.access_token_ciphertext
        and not _token_is_stale(locked)
    ):
        return decrypt_integration_secret(locked.access_token_ciphertext)

    old_refresh = decrypt_integration_secret(locked.refresh_token_ciphertext)
    try:
        token_payload = clover_request(
            "POST",
            "/oauth/v2/refresh",
            payload={"client_id": current_app.config["CLOVER_CLIENT_ID"], "refresh_token": old_refresh},
        )
    except CloverRequestError as exc:
        if exc.status_code not in {401, 403}:
            raise
        if not locked.recovery_token_ciphertext:
            locked.status = "reauthorization_required"
            locked.last_error = exc.code
            db.session.commit()
            raise CloverRequestError("Clover authorization must be renewed.", status_code=409, code="clover_reauthorization_required") from exc
        try:
            token_payload = clover_request(
                "POST",
                "/oauth/v2/recovery",
                payload={
                    "client_id": current_app.config["CLOVER_CLIENT_ID"],
                    "client_secret": current_app.config["CLOVER_CLIENT_SECRET"],
                    "recovery_token": decrypt_integration_secret(locked.recovery_token_ciphertext),
                },
            )
        except CloverRequestError as recovery_exc:
            if recovery_exc.status_code not in {401, 403}:
                raise
            locked.status = "reauthorization_required"
            locked.last_error = recovery_exc.code
            db.session.commit()
            raise CloverRequestError("Clover authorization must be renewed.", status_code=409, code="clover_reauthorization_required") from recovery_exc

    access_token = str(token_payload.get("access_token") or "").strip()
    new_refresh = str(token_payload.get("refresh_token") or "").strip()
    if not access_token or not new_refresh:
        raise CloverRequestError("Clover refresh did not return a complete token pair.", status_code=502, code="clover_incomplete_token")
    locked.recovery_token_ciphertext = encrypt_integration_secret(old_refresh)
    locked.recovery_expires_at = _now() + timedelta(days=14)
    locked.refresh_token_ciphertext = encrypt_integration_secret(new_refresh)
    locked.access_token_ciphertext = encrypt_integration_secret(access_token)
    locked.access_expires_at = parse_clover_timestamp(token_payload.get("access_token_expiration"))
    locked.refresh_expires_at = parse_clover_timestamp(token_payload.get("refresh_token_expiration"))
    locked.status = "connected"
    locked.last_error = ""
    locked.last_connection_check_at = _now()
    record_audit_event(
        event_type="clover.oauth.refreshed",
        entity_type="clover_connection",
        entity_id=locked.id,
        organization_id=organization.id,
        actor_user_id=current_user.id if current_user.is_authenticated else None,
    )
    db.session.commit()
    return access_token


def _catalog_snapshot_for_connection(connection: CloverConnection, organization: Organization):
    token = decrypt_integration_secret(connection.access_token_ciphertext)
    if not token:
        raise CloverRequestError("Clover authorization is required.", status_code=409, code="clover_authorization_required")
    observed_ciphertext = connection.access_token_ciphertext
    if _token_is_stale(connection):
        token = _refresh_connection_token(connection, organization, observed_ciphertext=observed_ciphertext)
    try:
        return CloverCatalogClient(merchant_id=connection.merchant_id, token=token).fetch_snapshot()
    except CloverRequestError as exc:
        if exc.status_code != 401:
            raise
        retry_token = _refresh_connection_token(connection, organization, observed_ciphertext=observed_ciphertext, force=True)
        return CloverCatalogClient(merchant_id=connection.merchant_id, token=retry_token).fetch_snapshot()


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


def clover_mapping_enabled() -> bool:
    return str(current_app.config.get("CLOVER_MAPPING_ENABLED") or "").strip().lower() in {"1", "true", "yes", "on"}


def _clover_access_configured() -> bool:
    if not clover_enabled():
        return False
    if str(current_app.config.get("FLOWTALLY_ENV") or "").strip().lower() == "production":
        return bool(current_app.config.get("CLOVER_ALLOWED_ORGANIZATION_IDS"))
    return True


def _require(organization: Organization | None):
    if organization is None:
        return json_error("Organization not found.", 404)
    # Authorize first so unavailable/allowlisted state is never observable by
    # a caller who cannot manage the requested organization.
    if not _can_manage(organization):
        return json_error("Clover access is restricted to the organization owner or platform setup staff.", 403)
    if not _clover_access_configured() or not _allowlisted(organization):
        return json_error("Clover is unavailable for this organization.", 404)
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


def _catalog_snapshot_payload(snapshot) -> dict[str, Any]:
    """Return a safe, read-only catalog view without provider payloads or tokens."""
    def category_payload(category: Any) -> dict[str, Any]:
        return {"id": category.provider_id, "name": category.name, "active": category.active}

    def modifier_payload(modifier: Any) -> dict[str, Any]:
        return {"id": modifier.provider_id, "name": modifier.name, "priceCents": modifier.price_cents, "active": modifier.active}

    return {
        "readOnly": True,
        "merchantName": snapshot.merchant_name,
        "location": ({"id": snapshot.location.provider_id, "name": snapshot.location.name} if snapshot.location else None),
        "itemCount": len(snapshot.items),
        "items": [
            {
                "id": item.provider_id,
                "name": item.name,
                "priceCents": item.price_cents,
                "active": item.active,
                "deleted": item.deleted,
                "hidden": item.hidden,
                "available": item.available,
                "itemGroupId": item.item_group_id,
                "optionIds": list(item.option_ids),
                "categories": [category_payload(category) for category in item.categories],
                "modifierGroups": [
                    {"id": group.provider_id, "name": group.name, "active": group.active, "modifiers": [modifier_payload(modifier) for modifier in group.modifiers]}
                    for group in item.modifier_groups
                ],
            }
            for item in snapshot.items
        ],
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
    previous_merchant_id = connection.merchant_id
    invalidated_location_ids: list[int] = []
    invalidated_menu_ids: list[int] = []
    if connection.id is not None and previous_merchant_id and previous_merchant_id != merchant_id:
        invalidated_location_ids = [row.id for row in CloverLocationMapping.query.filter_by(clover_connection_id=connection.id).all()]
        invalidated_menu_ids = [row.id for row in CloverMenuMapping.query.filter_by(clover_connection_id=connection.id).all()]
        CloverMenuMapping.query.filter_by(clover_connection_id=connection.id).delete(synchronize_session=False)
        CloverLocationMapping.query.filter_by(clover_connection_id=connection.id).delete(synchronize_session=False)
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
    if previous_merchant_id and previous_merchant_id != merchant_id:
        record_audit_event(
            event_type="clover.mapping.invalidated_merchant_change",
            entity_type="clover_connection",
            entity_id=connection.id,
            organization_id=organization.id,
            actor_user_id=current_user.id,
            metadata={"previousMerchantId": previous_merchant_id, "newMerchantId": merchant_id, "locationMappingIds": invalidated_location_ids, "menuMappingIds": invalidated_menu_ids},
        )
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
        return jsonify({"enabled": False, "catalogEnabled": False, "mappingEnabled": False, "connection": None}), 200
    apply_org_tenant_context(organization, access_scope="setup" if get_platform_role(current_user.id) else None)
    return jsonify({"enabled": True, "catalogEnabled": clover_catalog_enabled(), "mappingEnabled": clover_mapping_enabled(), "shadowOrdersEnabled": _clover_order_shadow_enabled(), "connection": _serialize(CloverConnection.query.filter_by(organization_id=organization.id).first())}), 200


def _mapping_connection(organization: Organization) -> CloverConnection | None:
    connection = CloverConnection.query.filter_by(organization_id=organization.id).first()
    if connection is None or connection.status != "connected" or connection.environment != "sandbox":
        return None
    return connection


def _serialize_location_mapping(mapping: CloverLocationMapping | None) -> dict[str, Any] | None:
    if mapping is None:
        return None
    return {
        "id": mapping.id,
        "organizationId": mapping.organization_id,
        "restaurantLocationId": mapping.restaurant_location_id,
        "cloverMerchantId": mapping.clover_merchant_id,
        "cloverLocationId": mapping.clover_location_id,
        "confirmedAt": isoformat(mapping.confirmed_at),
    }


def _serialize_menu_mapping(mapping: CloverMenuMapping) -> dict[str, Any]:
    menu_item = mapping.flowtally_menu_item
    recipe = getattr(menu_item, "recipe", None) if menu_item is not None else None
    return {
        "id": mapping.id,
        "organizationId": mapping.organization_id,
        "restaurantLocationId": mapping.restaurant_location_id,
        "cloverMerchantId": mapping.clover_merchant_id,
        "cloverItemId": mapping.clover_item_id,
        "cloverItemGroupId": mapping.clover_item_group_id,
        "cloverOptionIds": list(mapping.clover_option_ids_json or []),
        "cloverModifierGroupIds": list(mapping.clover_modifier_group_ids_json or []),
        "flowtallyMenuItemId": mapping.flowtally_menu_item_id,
        "flowtallyMenuItemName": menu_item.name if menu_item is not None else None,
        "hasRecipe": recipe is not None,
        "status": mapping.status,
    }


def _mapping_guard(organization: Organization | None):
    denied = _require(organization)
    if denied is not None:
        return denied
    if not clover_mapping_enabled():
        return json_error("Clover menu mapping is unavailable.", 404)
    return None


@bp.get("/api/integrations/clover/mappings")
@login_required
def clover_mappings():
    try:
        org_id = int(request.args.get("organizationId", ""))
        location_id = int(request.args.get("locationId", ""))
    except ValueError:
        return json_error("Organization and location are required.", 400)
    organization = _organization(org_id)
    denied = _mapping_guard(organization)
    if denied is not None:
        return denied
    assert organization is not None
    location = RestaurantLocation.query.filter_by(id=location_id, organization_id=organization.id).first()
    if location is None:
        return json_error("Location not found.", 404)
    connection = _mapping_connection(organization)
    if connection is None:
        return jsonify({"enabled": True, "locationMapping": None, "menuMappings": []}), 200
    location_mapping = CloverLocationMapping.query.filter_by(clover_connection_id=connection.id, restaurant_location_id=location.id, clover_merchant_id=connection.merchant_id).first()
    mappings = CloverMenuMapping.query.filter_by(clover_connection_id=connection.id, restaurant_location_id=location.id, clover_merchant_id=connection.merchant_id).order_by(CloverMenuMapping.id.asc()).all()
    return jsonify({"enabled": True, "locationMapping": _serialize_location_mapping(location_mapping), "menuMappings": [_serialize_menu_mapping(item) for item in mappings]}), 200


@bp.post("/api/integrations/clover/location-mapping")
@login_required
def create_clover_location_mapping():
    payload = request.get_json(silent=True) or {}
    try:
        org_id = int(payload.get("organizationId"))
        location_id = int(payload.get("locationId"))
    except (TypeError, ValueError):
        return json_error("Organization and location are required.", 400)
    organization = _organization(org_id)
    denied = _mapping_guard(organization)
    if denied is not None:
        return denied
    assert organization is not None
    if payload.get("confirm") is not True:
        return json_error("Explicit location confirmation is required.", 400)
    location = RestaurantLocation.query.filter_by(id=location_id, organization_id=organization.id).first()
    connection = _mapping_connection(organization)
    if location is None or connection is None:
        return json_error("Connected Clover merchant and Flowtally location are required.", 409)
    requested_clover_location_id = str(payload.get("cloverLocationId") or "").strip() or None
    try:
        snapshot = _catalog_snapshot_for_connection(connection, organization)
    except SquareSecurityError:
        return json_error("Clover authorization could not be read.", 502, code="clover_authorization_unreadable")
    except CloverCatalogIncomplete:
        return json_error("Clover catalog is incomplete; try again later.", 503, code="clover_catalog_incomplete")
    except CloverCatalogDisabled:
        return json_error("Clover catalog preview is unavailable.", 404, code="clover_catalog_disabled")
    except CloverRequestError as exc:
        return json_error("Clover location identity could not be verified.", 503, code=exc.code)
    snapshot_location = getattr(snapshot, "location", None)
    authoritative_clover_location_id = snapshot_location.provider_id if snapshot_location is not None else None
    if authoritative_clover_location_id:
        if requested_clover_location_id not in {None, authoritative_clover_location_id}:
            return json_error("The Clover location does not match the connected merchant.", 409)
        clover_location_id = authoritative_clover_location_id
    else:
        if requested_clover_location_id is not None:
            return json_error("Clover did not provide a trustworthy location identity.", 409)
        clover_location_id = None
    existing = CloverLocationMapping.query.filter_by(clover_connection_id=connection.id, restaurant_location_id=location.id, clover_merchant_id=connection.merchant_id).first()
    if existing is None and clover_location_id is None:
        merchant_level_conflict = CloverLocationMapping.query.filter_by(clover_connection_id=connection.id, clover_location_id=None).filter(CloverLocationMapping.restaurant_location_id != location.id).first()
        if merchant_level_conflict is not None:
            return json_error("This Clover merchant has already been confirmed for another Flowtally location.", 409)
    if existing is None:
        existing = CloverLocationMapping(clover_connection_id=connection.id, organization_id=organization.id, restaurant_location_id=location.id, clover_merchant_id=connection.merchant_id, confirmed_by_user_id=current_user.id)
        db.session.add(existing)
        db.session.flush([existing])
    existing.clover_merchant_id = connection.merchant_id
    existing.clover_location_id = clover_location_id
    existing.confirmed_by_user_id = current_user.id
    existing.confirmed_at = _now()
    record_audit_event(event_type="clover.mapping.location_confirmed", entity_type="clover_location_mapping", entity_id=existing.id, organization_id=organization.id, location_id=location.id, actor_user_id=current_user.id, metadata={"restaurantLocationId": location.id, "cloverLocationId": clover_location_id})
    db.session.commit()
    return jsonify({"locationMapping": _serialize_location_mapping(existing)}), 200


@bp.delete("/api/integrations/clover/location-mapping")
@login_required
def delete_clover_location_mapping():
    try:
        org_id = int(request.args.get("organizationId", ""))
        location_id = int(request.args.get("locationId", ""))
    except ValueError:
        return json_error("Organization and location are required.", 400)
    organization = _organization(org_id)
    denied = _mapping_guard(organization)
    if denied is not None:
        return denied
    assert organization is not None
    connection = _mapping_connection(organization)
    mapping = CloverLocationMapping.query.filter_by(
        clover_connection_id=connection.id if connection else -1,
        restaurant_location_id=location_id,
        organization_id=organization.id,
        clover_merchant_id=connection.merchant_id if connection else "",
    ).first()
    if mapping is not None:
        dependent_mappings = CloverMenuMapping.query.filter_by(
            clover_connection_id=connection.id,
            restaurant_location_id=location_id,
            organization_id=organization.id,
            clover_merchant_id=connection.merchant_id,
        ).all()
        dependent_ids = [item.id for item in dependent_mappings]
        for item in dependent_mappings:
            db.session.delete(item)
        db.session.delete(mapping)
        record_audit_event(
            event_type="clover.mapping.location_removed",
            entity_type="clover_location_mapping",
            entity_id=mapping.id,
            organization_id=organization.id,
            location_id=location_id,
            actor_user_id=current_user.id,
            metadata={"removedMenuMappingIds": dependent_ids},
        )
        for mapping_id in dependent_ids:
            record_audit_event(
                event_type="clover.mapping.menu_item_invalidated",
                entity_type="clover_menu_mapping",
                entity_id=mapping_id,
                organization_id=organization.id,
                location_id=location_id,
                actor_user_id=current_user.id,
                metadata={"reason": "location_mapping_removed"},
            )
        db.session.commit()
    return jsonify({"ok": True}), 200


@bp.post("/api/integrations/clover/menu-mappings")
@login_required
def create_clover_menu_mapping():
    payload = request.get_json(silent=True) or {}
    try:
        org_id = int(payload.get("organizationId"))
        location_id = int(payload.get("locationId"))
        menu_item_id = int(payload.get("flowtallyMenuItemId"))
    except (TypeError, ValueError):
        return json_error("Organization, location and menu item are required.", 400)
    organization = _organization(org_id)
    denied = _mapping_guard(organization)
    if denied is not None:
        return denied
    assert organization is not None
    if payload.get("confirm") is not True:
        return json_error("Explicit mapping confirmation is required.", 400)
    connection = _mapping_connection(organization)
    location_mapping = CloverLocationMapping.query.filter_by(clover_connection_id=connection.id if connection else -1, restaurant_location_id=location_id, organization_id=organization.id, clover_merchant_id=connection.merchant_id if connection else "").first()
    menu_item = MenuItem.query.filter_by(id=menu_item_id, organization_id=organization.id, location_id=location_id, active=True).first()
    clover_item_id = str(payload.get("cloverItemId") or "").strip()
    if connection is None or location_mapping is None or menu_item is None or not clover_item_id:
        return json_error("Confirm a Clover location and select a valid Flowtally menu item.", 409)
    try:
        snapshot = _catalog_snapshot_for_connection(connection, organization)
    except SquareSecurityError:
        return json_error("Clover authorization could not be read.", 502, code="clover_authorization_unreadable")
    except CloverCatalogIncomplete:
        return json_error("Clover catalog is incomplete; try again later.", 503, code="clover_catalog_incomplete")
    except CloverCatalogDisabled:
        return json_error("Clover catalog preview is unavailable.", 404, code="clover_catalog_disabled")
    except CloverRequestError as exc:
        return json_error("Clover catalog could not be verified.", 503, code=exc.code)
    item = next((value for value in snapshot.items if value.provider_id == clover_item_id), None)
    if item is None or item.deleted:
        return json_error("The Clover item is missing or deleted.", 409)
    if item.item_group_id or item.option_ids or item.modifier_groups:
        return json_error("Variant and modifier mappings require a later mapping phase.", 409)
    route_mapping_id = request.view_args.get("mapping_id")
    payload_mapping_id = payload.get("mappingId")
    if route_mapping_id is not None and payload_mapping_id is not None:
        try:
            if int(payload_mapping_id) != int(route_mapping_id):
                return json_error("Mapping identity does not match the requested resource.", 409)
        except (TypeError, ValueError):
            return json_error("Mapping identity is invalid.", 400)
    if route_mapping_id is not None:
        existing = CloverMenuMapping.query.filter_by(
            id=route_mapping_id,
            organization_id=organization.id,
            clover_connection_id=connection.id,
            restaurant_location_id=location_id,
            clover_item_id=clover_item_id,
            clover_merchant_id=connection.merchant_id,
        ).first()
        if existing is None:
            return json_error("Mapping not found for this Clover item and location.", 404)
    else:
        existing = CloverMenuMapping.query.filter_by(clover_connection_id=connection.id, restaurant_location_id=location_id, clover_item_id=clover_item_id, clover_merchant_id=connection.merchant_id).first()
    conflicting = CloverMenuMapping.query.filter_by(clover_connection_id=connection.id, restaurant_location_id=location_id, flowtally_menu_item_id=menu_item.id, clover_merchant_id=connection.merchant_id).first()
    if conflicting is not None and (existing is None or conflicting.id != existing.id):
        return json_error("That Flowtally menu item is already mapped for this Clover location.", 409)
    if existing is None:
        existing = CloverMenuMapping(clover_connection_id=connection.id, organization_id=organization.id, restaurant_location_id=location_id, clover_merchant_id=connection.merchant_id, clover_item_id=clover_item_id, mapped_by_user_id=current_user.id)
        db.session.add(existing)
    existing.clover_merchant_id = connection.merchant_id
    existing.clover_item_group_id = item.item_group_id
    existing.clover_option_ids_json = list(item.option_ids)
    existing.clover_modifier_group_ids_json = [group.provider_id for group in item.modifier_groups]
    existing.flowtally_menu_item_id = menu_item.id
    existing.status = "review" if item.hidden or item.available is False else "active"
    existing.mapped_by_user_id = current_user.id
    if existing.id is None:
        db.session.flush([existing])
    record_audit_event(event_type="clover.mapping.menu_item_saved", entity_type="clover_menu_mapping", entity_id=existing.id, organization_id=organization.id, actor_user_id=current_user.id, metadata={"cloverItemId": clover_item_id, "flowtallyMenuItemId": menu_item.id, "status": existing.status})
    db.session.commit()
    return jsonify({"mapping": _serialize_menu_mapping(existing)}), 200


@bp.patch("/api/integrations/clover/menu-mappings/<int:mapping_id>")
@login_required
def update_clover_menu_mapping(mapping_id: int):
    return create_clover_menu_mapping()


@bp.delete("/api/integrations/clover/menu-mappings/<int:mapping_id>")
@login_required
def delete_clover_menu_mapping(mapping_id: int):
    organization = _organization(request.args.get("organizationId", type=int))
    denied = _mapping_guard(organization)
    if denied is not None:
        return denied
    assert organization is not None
    connection = _mapping_connection(organization)
    mapping = CloverMenuMapping.query.filter_by(
        id=mapping_id,
        organization_id=organization.id,
        clover_connection_id=connection.id if connection else -1,
        clover_merchant_id=connection.merchant_id if connection else "",
    ).first()
    if mapping is None:
        return json_error("Mapping not found.", 404)
    db.session.delete(mapping)
    record_audit_event(event_type="clover.mapping.menu_item_deleted", entity_type="clover_menu_mapping", entity_id=mapping_id, organization_id=organization.id, actor_user_id=current_user.id)
    db.session.commit()
    return jsonify({"ok": True}), 200




def _clover_order_shadow_enabled() -> bool:
    return bool(current_app.config.get("CLOVER_ORDER_SHADOW_ENABLED"))


def _parse_order_bound(value: str | None) -> datetime | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid Clover order date.") from exc
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _shadow_recipe_preview(menu_item: MenuItem | None, quantity) -> tuple[str, dict[str, Any]]:
    if menu_item is None:
        return "unmapped", {}
    recipe = menu_item.recipe
    if recipe is None or not recipe.active or recipe.yield_quantity is None or recipe.yield_quantity <= 0:
        return "missing_recipe", {"reason": "A valid active recipe yield is required."}
    ingredients: list[dict[str, Any]] = []
    for ingredient in recipe.ingredients:
        required = recipe_ingredient_quantity(
            sale_quantity=quantity,
            ingredient_quantity=ingredient.quantity_required,
            yield_quantity=recipe.yield_quantity,
        )
        ingredients.append({
            "inventoryItemId": ingredient.inventory_item_id,
            "quantity": str(required),
            "unit": ingredient.unit,
            "name": ingredient.inventory_item.name if ingredient.inventory_item else "",
        })
    return "mapped", {"recipeId": recipe.id, "recipeName": recipe.name, "ingredients": ingredients}


def _serialize_shadow_order(order: CloverShadowOrder) -> dict[str, Any]:
    return {
        "id": order.id,
        "cloverOrderId": order.clover_order_id,
        "providerStatus": order.provider_status,
        "status": order.normalized_status,
        "paymentStatus": order.payment_status,
        "potentiallyEligible": order.potentially_eligible,
        "requiresReview": order.requires_review,
        "createdAt": isoformat(order.source_created_at),
        "modifiedAt": isoformat(order.source_modified_at),
        "closedAt": isoformat(order.source_closed_at),
        "totalCents": order.total_cents,
        "currency": order.currency,
        "incomplete": False,
        "lines": [
            {
                "id": line.id,
                "cloverLineItemId": line.clover_line_item_id,
                "cloverItemId": line.clover_item_id,
                "name": line.name,
                "quantity": float(line.quantity),
                "unitPriceCents": line.unit_price_cents,
                "mappingStatus": line.mapping_status,
                "recipePreview": line.recipe_preview_json,
                "modifiers": line.modifier_json,
            }
            for line in order.lines
        ],
    }


def _ingest_shadow_orders(
    *,
    connection: CloverConnection,
    organization: Organization,
    location: RestaurantLocation,
    orders,
) -> tuple[list[CloverShadowOrder], int]:
    mapping = CloverLocationMapping.query.filter_by(
        clover_connection_id=connection.id,
        organization_id=organization.id,
        restaurant_location_id=location.id,
        clover_merchant_id=connection.merchant_id,
    ).first()
    if mapping is None:
        raise CloverRequestError(
            "Confirm the Clover merchant/location association before retrieving orders.",
            status_code=409,
            code="clover_location_mapping_required",
        )
    ingested: list[CloverShadowOrder] = []
    for normalized in orders:
        shadow = CloverShadowOrder.query.filter_by(
            clover_connection_id=connection.id,
            clover_order_id=normalized.provider_id,
        ).first()
        if shadow is None:
            shadow = CloverShadowOrder(
                organization_id=organization.id,
                clover_connection_id=connection.id,
                restaurant_location_id=location.id,
                clover_merchant_id=connection.merchant_id,
                clover_order_id=normalized.provider_id,
            )
            db.session.add(shadow)
        elif (
            shadow.organization_id != organization.id
            or shadow.restaurant_location_id != location.id
            or shadow.clover_merchant_id != connection.merchant_id
        ):
            raise CloverRequestError("Clover order is already associated with another tenant/location.", status_code=409, code="clover_order_scope_conflict")
        shadow.provider_status = normalized.provider_status
        shadow.normalized_status = normalized.normalized_status
        shadow.payment_status = normalized.payment_status
        shadow.potentially_eligible = normalized.potentially_eligible
        shadow.requires_review = normalized.requires_review
        shadow.source_created_at = normalized.created_at
        shadow.source_modified_at = normalized.modified_at
        shadow.source_closed_at = normalized.closed_at
        shadow.total_cents = normalized.total_cents
        shadow.currency = normalized.currency
        shadow.raw_payload_json = dict(normalized.raw)
        db.session.flush()

        existing_lines = {line.clover_line_item_id: line for line in list(shadow.lines)}
        seen_line_ids: set[str] = set()
        for line in normalized.lines:
            seen_line_ids.add(line.provider_id)
            local_line = existing_lines.get(line.provider_id)
            menu_mapping = CloverMenuMapping.query.filter_by(
                clover_connection_id=connection.id,
                organization_id=organization.id,
                restaurant_location_id=location.id,
                clover_merchant_id=connection.merchant_id,
                clover_item_id=line.item_id,
                status="active",
            ).first() if line.item_id else None
            menu_item = menu_mapping.flowtally_menu_item if menu_mapping is not None else None
            if line.modifiers:
                mapping_status, recipe_preview = "review_required", {"reason": "Modifiers may change ingredient consumption; review required."}
            else:
                mapping_status, recipe_preview = _shadow_recipe_preview(menu_item, line.quantity)
                if mapping_status == "mapped":
                    recipe_preview["flowtallyMenuItemName"] = menu_item.name if menu_item is not None else ""
            if normalized.incomplete:
                mapping_status = "review_required"
                recipe_preview = {"reason": "Clover expanded order data was incomplete."}
            if local_line is None:
                local_line = CloverShadowOrderLine(
                    organization_id=organization.id,
                    restaurant_location_id=location.id,
                    shadow_order_id=shadow.id,
                    clover_line_item_id=line.provider_id,
                )
                db.session.add(local_line)
            local_line.clover_item_id = line.item_id
            local_line.clover_item_group_id = line.item_group_id
            local_line.name = line.name
            local_line.quantity = line.quantity
            local_line.unit_price_cents = line.unit_price_cents
            local_line.provider_status = line.provider_status
            local_line.modifier_json = list(line.modifiers)
            local_line.mapping_status = mapping_status
            local_line.recipe_preview_json = recipe_preview
        # A response marked incomplete is not deletion evidence. Preserve all
        # previously stored lines until a complete provider collection arrives.
        if not normalized.incomplete:
            for line in existing_lines.values():
                if line.clover_line_item_id not in seen_line_ids:
                    db.session.delete(line)
        ingested.append(shadow)
    db.session.flush()
    return ingested, len(ingested)


@bp.post("/api/integrations/clover/shadow-orders/fetch")
@login_required
def clover_shadow_orders_fetch():
    if not _clover_order_shadow_enabled():
        return json_error("Clover shadow orders are unavailable.", 404, code="clover_shadow_orders_disabled")
    payload = request.get_json(silent=True) or {}
    try:
        organization_id = int(payload.get("organizationId") or request.args.get("organizationId") or "")
        location_id = int(payload.get("locationId") or request.args.get("locationId") or "")
    except (TypeError, ValueError):
        return json_error("Organization and location are required.", 400, code="clover_scope_required")
    organization = _organization(organization_id)
    denied = _require(organization)
    if denied is not None:
        return denied
    assert organization is not None
    location = RestaurantLocation.query.filter_by(id=location_id, organization_id=organization.id).first()
    if location is None:
        return json_error("Location not found.", 404)
    connection = CloverConnection.query.filter_by(organization_id=organization.id).first()
    if connection is None or connection.status != "connected" or connection.environment != "sandbox":
        return json_error("Clover sandbox authorization is required.", 409, code="clover_authorization_required")
    try:
        start = _parse_order_bound(payload.get("startDate") or request.args.get("startDate"))
        end = _parse_order_bound(payload.get("endDate") or request.args.get("endDate"))
        max_pages = int(payload.get("maxPages") or 3)
        if max_pages < 1 or max_pages > 5:
            raise ValueError("Invalid maxPages.")
        if start is not None and end is not None and (start >= end or end - start > timedelta(days=90)):
            raise ValueError("Invalid Clover order date range.")
    except (TypeError, ValueError):
        return json_error("Invalid Clover order date range or pagination bounds.", 400, code="clover_order_query_invalid")
    try:
        token = decrypt_integration_secret(connection.access_token_ciphertext)
        if not token:
            raise CloverRequestError("Clover authorization is required.", status_code=409, code="clover_authorization_required")
        observed_ciphertext = connection.access_token_ciphertext
        if _token_is_stale(connection):
            token = _refresh_connection_token(connection, organization, observed_ciphertext=observed_ciphertext)
        try:
            orders, complete = CloverOrderClient(merchant_id=connection.merchant_id, token=token).fetch_orders(start=start, end=end, max_pages=max_pages)
        except CloverRequestError as exc:
            if exc.status_code != 401:
                raise
            token = _refresh_connection_token(connection, organization, observed_ciphertext=observed_ciphertext, force=True)
            orders, complete = CloverOrderClient(merchant_id=connection.merchant_id, token=token).fetch_orders(start=start, end=end, max_pages=max_pages)
        if not complete:
            return json_error("Clover order retrieval reached its safety bound; no complete snapshot was saved.", 502, code="clover_orders_incomplete")
        imported, count = _ingest_shadow_orders(connection=connection, organization=organization, location=location, orders=orders)
        record_audit_event(event_type="clover.shadow_orders.ingested", entity_type="clover_connection", entity_id=connection.id, organization_id=organization.id, location_id=location.id, actor_user_id=current_user.id, metadata={"count": count, "previewOnly": True})
        db.session.commit()
    except ValueError:
        db.session.rollback()
        return json_error("Invalid Clover order query.", 400, code="clover_order_query_invalid")
    except SquareSecurityError:
        db.session.rollback()
        return json_error("Clover authorization could not be read.", 502, code="clover_authorization_unreadable")
    except CloverRequestError as exc:
        db.session.rollback()
        if exc.status_code == 403:
            return json_error("Clover order permission is not available for this connection.", 502, code="clover_orders_forbidden")
        if exc.status_code == 429:
            return json_error("Clover is rate limited; try again later.", 503, code="clover_rate_limited")
        return json_error("Clover orders could not be loaded.", 503, code=exc.code)
    orders = CloverShadowOrder.query.filter_by(organization_id=organization.id, restaurant_location_id=location.id, clover_connection_id=connection.id).order_by(CloverShadowOrder.source_modified_at.desc().nullslast(), CloverShadowOrder.id.desc()).limit(50).all()
    return jsonify({
        "readOnly": True,
        "previewOnly": True,
        "retrievedAt": _now().isoformat(),
        "count": len(orders),
        "orders": [_serialize_shadow_order(order) for order in orders],
    }), 200


@bp.get("/api/integrations/clover/catalog")
@login_required
def clover_catalog_preview():
    try:
        org_id = int(request.args.get("organizationId", ""))
    except ValueError:
        org_id = None
    organization = _organization(org_id)
    denied = _require(organization)
    if denied is not None:
        return denied
    assert organization is not None
    if not clover_catalog_enabled():
        return json_error("Clover catalog preview is unavailable.", 404)
    connection = CloverConnection.query.filter_by(organization_id=organization.id).first()
    if connection is None or connection.status != "connected":
        return json_error("Clover authorization is required.", 409)
    if connection.environment != "sandbox":
        return json_error("Clover catalog preview is unavailable.", 404)
    if not connection.merchant_id or not connection.access_token_ciphertext:
        return json_error("Clover authorization is required.", 409)
    try:
        snapshot = _catalog_snapshot_for_connection(connection, organization)
    except SquareSecurityError:
        return json_error("Clover authorization could not be read.", 502, code="clover_authorization_unreadable")
    except CloverCatalogIncomplete:
        return json_error("Clover catalog is incomplete; try again later.", 502, code="clover_catalog_incomplete")
    except CloverCatalogDisabled:
        return json_error("Clover catalog preview is unavailable.", 404)
    except CloverRequestError as exc:
        if exc.status_code == 403:
            return json_error("Clover access is not permitted for this connection.", 502, code="clover_forbidden")
        return json_error("Clover catalog could not be loaded.", 503, code=exc.code)
    return jsonify(_catalog_snapshot_payload(snapshot)), 200


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
    connection = CloverConnection.query.filter_by(organization_id=organization.id).first()
    if connection is None or not connection.refresh_token_ciphertext:
        return json_error("Clover requires authorization.", 409, code="clover_authorization_required")
    try:
        observed_ciphertext = connection.access_token_ciphertext
        _refresh_connection_token(
            connection,
            organization,
            observed_ciphertext=observed_ciphertext,
            force=True,
        )
    except SquareSecurityError:
        return json_error("Clover authorization could not be read.", 502, code="clover_authorization_unreadable")
    except CloverRequestError as exc:
        if exc.status_code == 409:
            return json_error("Clover authorization must be renewed.", 409, code=exc.code)
        if exc.status_code in {429, 500, 502, 503, 504}:
            return json_error("Clover refresh is temporarily unavailable.", 503, code=exc.code)
        return json_error("Clover refresh failed.", 502, code=exc.code)
    connection = CloverConnection.query.filter_by(organization_id=organization.id).first()
    return jsonify({"connection": _serialize(connection)}), 200

