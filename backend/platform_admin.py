from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from .audit import record_audit_event
from .extensions import db
from .models import AuditEvent, DashboardLayout, DataImportJob, Organization, OrganizationConfiguration, OrganizationConfigurationVersion, OrganizationMembership, OrganizationModule, PlatformRole, RestaurantLocation, SquareConnection, SquareLocation, SquareLocationMapping, SupportAccessGrant, User
from .modules import MODULE_REGISTRY
from .tenant_context import apply_request_tenant_context
from .utils import get_platform_role, get_user_memberships, json_error, isoformat, serialize_location, serialize_organization, serialize_user, serialize_audit_event
from .validation import clean_email

bp = Blueprint("platform_admin", __name__)

DEFAULT_CONFIGURATION = {
    "templateKey": "",
    "moduleEntitlements": {},
    "dashboardLayouts": {},
    "customFields": {"supplier": [], "inventoryItem": [], "purchaseInvoice": []},
    "launchBlockers": [],
    "imports": [],
    "square": {"status": "not_connected", "required": False, "locationMappings": []},
    "customerReview": {"requestedAt": None, "approvedAt": None, "approvedByUserId": None, "approvedVersionId": None},
    "internalNotes": [],
}

SETUP_TEMPLATES: list[dict[str, Any]] = [
    {
        "templateKey": "GENERIC_RESTAURANT",
        "defaultModules": ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS"],
    },
    {
        "templateKey": "CAFE",
        "defaultModules": ["PURCHASES", "INVENTORY", "REORDER_PLANS"],
    },
    {
        "templateKey": "BAKERY",
        "defaultModules": ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS"],
    },
    {
        "templateKey": "QSR",
        "defaultModules": ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS"],
    },
    {
        "templateKey": "MULTI_LOCATION",
        "defaultModules": ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS", "REPORTING"],
    },
]


def _platform_role() -> PlatformRole | None:
    if not current_user.is_authenticated:
        return None
    return get_platform_role(current_user.id)


def _require_platform_role(*roles: str):
    role = _platform_role()
    if role is None or role.role not in roles:
        return json_error("Platform setup access is required.", 403)
    apply_request_tenant_context(access_scope="setup" if role.role == "setup_admin" else "support" if role.role == "support" else None)
    return None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(value: Any, *, default: datetime | None = None) -> datetime:
    if value in {None, ""}:
        if default is not None:
            return default
        raise ValueError("A timestamp is required.")
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _ensure_configuration(organization: Organization) -> OrganizationConfiguration:
    configuration = OrganizationConfiguration.query.filter_by(organization_id=organization.id).first()
    if configuration is None:
        configuration = OrganizationConfiguration(organization_id=organization.id, draft_name=f"{organization.name} setup")
        db.session.add(configuration)
        db.session.flush()
    version = OrganizationConfigurationVersion.query.filter_by(organization_configuration_id=configuration.id).order_by(OrganizationConfigurationVersion.version_number.desc()).first()
    if version is None:
        version = OrganizationConfigurationVersion(
            organization_configuration_id=configuration.id,
            version_number=1,
            status="draft",
            configuration_json=deepcopy(DEFAULT_CONFIGURATION),
        )
        db.session.add(version)
        db.session.flush()
        configuration.current_version_id = version.id
        db.session.flush()
    return configuration


def _current_configuration(configuration: OrganizationConfiguration) -> OrganizationConfigurationVersion:
    version = None
    if configuration.current_version_id is not None:
        version = OrganizationConfigurationVersion.query.filter_by(id=configuration.current_version_id).first()
    if version is None:
        version = (
            OrganizationConfigurationVersion.query.filter_by(organization_configuration_id=configuration.id)
            .order_by(OrganizationConfigurationVersion.version_number.desc())
            .first()
        )
    if version is None:
        version = OrganizationConfigurationVersion(
            organization_configuration_id=configuration.id,
            version_number=1,
            status="draft",
            configuration_json=deepcopy(DEFAULT_CONFIGURATION),
        )
        db.session.add(version)
        db.session.flush()
        configuration.current_version_id = version.id
        db.session.flush()
    return version


def _serialized_modules(organization: Organization) -> list[dict[str, Any]]:
    return [
        {
            "key": module.module_key,
            "status": module.status,
            "configuration": module.configuration_json,
            "enabledAt": module.enabled_at.isoformat() if module.enabled_at else None,
        }
        for module in OrganizationModule.query.filter_by(organization_id=organization.id).order_by(OrganizationModule.module_key.asc()).all()
    ]


def _serialized_locations(organization: Organization) -> list[dict[str, Any]]:
    return [serialize_location(location) for location in RestaurantLocation.query.filter_by(organization_id=organization.id).order_by(RestaurantLocation.created_at.asc(), RestaurantLocation.id.asc()).all()]


def _serialized_configuration(organization: Organization) -> dict[str, Any]:
    configuration = _ensure_configuration(organization)
    version = _current_configuration(configuration)
    return {
        "configuration": {
            "id": configuration.id,
            "organizationId": configuration.organization_id,
            "draftName": configuration.draft_name,
            "currentVersionId": configuration.current_version_id,
            "currentVersion": {
                "id": version.id,
                "versionNumber": version.version_number,
                "status": version.status,
                "configurationJson": version.configuration_json,
                "createdAt": version.created_at.isoformat() if version.created_at else None,
                "publishedAt": version.published_at.isoformat() if version.published_at else None,
            },
        },
        "versions": [
            {
                "id": entry.id,
                "versionNumber": entry.version_number,
                "status": entry.status,
                "createdAt": entry.created_at.isoformat() if entry.created_at else None,
                "publishedAt": entry.published_at.isoformat() if entry.published_at else None,
                "revertedFromVersionId": entry.reverted_from_version_id,
            }
            for entry in OrganizationConfigurationVersion.query.filter_by(organization_configuration_id=configuration.id).order_by(OrganizationConfigurationVersion.version_number.desc()).all()
        ],
    }


def _checklist(organization: Organization) -> dict[str, Any]:
    configuration = _ensure_configuration(organization)
    version = _current_configuration(configuration)
    payload = version.configuration_json or {}
    locations = RestaurantLocation.query.filter_by(organization_id=organization.id).count()
    owner_count = (
        OrganizationMembership.query.filter_by(organization_id=organization.id, role="owner").count()
    )
    template = _select_template(organization.setup_template_key)
    required_module_keys = set(template["defaultModules"] if template else [])
    modules = {entry.module_key: entry for entry in OrganizationModule.query.filter_by(organization_id=organization.id).all()}
    enabled_module_keys = {key for key, entry in modules.items() if entry.status == "ENABLED"}
    missing_modules = sorted(required_module_keys - enabled_module_keys)
    square_connection = SquareConnection.query.filter_by(organization_id=organization.id).first()
    square_required = bool(payload.get("square", {}).get("required")) or "SQUARE_INTEGRATION" in enabled_module_keys
    square_location_mapping_count = 0
    if square_connection is not None:
        square_location_ids = [location.id for location in SquareLocation.query.filter_by(square_connection_id=square_connection.id).all()]
        if square_location_ids:
            square_location_mapping_count = SquareLocationMapping.query.filter(SquareLocationMapping.square_location_id.in_(square_location_ids)).count()
    square_complete = not square_required or bool(square_connection and square_connection.status == "connected" and square_location_mapping_count > 0)
    import_jobs = DataImportJob.query.filter_by(organization_id=organization.id).all()
    imports_complete = all(job.status in {"APPROVED", "COMPLETED", "COMPLETED_WITH_WARNINGS", "ROLLED_BACK"} for job in import_jobs) if import_jobs else True
    blockers = [str(item) for item in payload.get("launchBlockers", []) if str(item).strip()]
    customer_review = payload.get("customerReview", {})
    approved = bool(customer_review.get("approvedAt"))
    activation_ready = (
        owner_count > 0
        and locations > 0
        and organization.setup_fee_status == "confirmed"
        and organization.setup_status == "COMPLETE"
        and organization.subscription_status == "ACTIVE"
        and approved
        and imports_complete
        and not blockers
        and not missing_modules
        and square_complete
    )
    return {
        "ownerCount": owner_count,
        "locationCount": locations,
        "setupFeeStatus": organization.setup_fee_status,
        "setupStatus": organization.setup_status,
        "subscriptionStatus": organization.subscription_status,
        "launchBlockers": blockers,
        "missingModules": missing_modules,
        "squareRequired": square_required,
        "squareComplete": square_complete,
        "squareLocationMappingCount": square_location_mapping_count,
        "importsComplete": imports_complete,
        "customerApproved": approved,
        "readyForActivation": activation_ready,
    }


def _serialize_organization_detail(organization: Organization) -> dict[str, Any]:
    owner_memberships = OrganizationMembership.query.filter_by(organization_id=organization.id).order_by(OrganizationMembership.created_at.asc()).all()
    platform_role = _platform_role()
    return {
        "organization": serialize_organization(organization),
        "memberships": [
            {
                "id": membership.id,
                "user": serialize_user(membership.user),
                "role": membership.role,
                "createdAt": membership.created_at.isoformat() if membership.created_at else None,
            }
            for membership in owner_memberships
            if membership.user is not None
        ],
        "locations": _serialized_locations(organization),
        "modules": _serialized_modules(organization),
        "configuration": _serialized_configuration(organization),
        "checklist": _checklist(organization),
        "auditEvents": [serialize_audit_event(event) for event in AuditEvent.query.filter_by(organization_id=organization.id).order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc()).limit(50).all()],
        "platformRole": platform_role.role if platform_role else None,
    }


def _serialize_support_grant(grant: SupportAccessGrant) -> dict[str, Any]:
    return {
        "id": grant.id,
        "organizationId": grant.organization_id,
        "organizationName": grant.organization.name if grant.organization else "",
        "supportUserId": grant.support_user_id,
        "supportUserEmail": grant.support_user.email if grant.support_user else "",
        "requestedByUserId": grant.requested_by_user_id,
        "approvedByUserId": grant.approved_by_user_id,
        "reason": grant.reason,
        "caseReference": grant.case_reference,
        "status": grant.status,
        "startsAt": isoformat(grant.starts_at),
        "expiresAt": isoformat(grant.expires_at),
        "revokedAt": isoformat(grant.revoked_at),
        "visibleInUi": bool(grant.visible_in_ui),
        "createdAt": isoformat(grant.created_at),
        "updatedAt": isoformat(grant.updated_at),
    }


def _select_template(template_key: str) -> dict[str, Any] | None:
    return next((template for template in SETUP_TEMPLATES if template["templateKey"] == template_key), None)


def _commit_json_response(payload: dict[str, Any], status_code: int = 200):
    db.session.commit()
    return jsonify(payload), status_code


@bp.get("/api/platform/setup/organizations")
@login_required
def list_setup_organizations():
    permission_error = _require_platform_role("setup_admin", "support")
    if permission_error is not None:
        return permission_error
    query = Organization.query
    search = str(request.args.get("search") or "").strip().lower()
    state = str(request.args.get("state") or "").strip().upper()
    if state:
        if state == "ONBOARDING":
            query = query.filter(Organization.lifecycle_status.in_(["ONBOARDING", "READY_FOR_REVIEW"]))
        else:
            query = query.filter(Organization.lifecycle_status == state)
    organizations = query.order_by(Organization.created_at.desc(), Organization.id.desc()).all()
    payload = []
    for organization in organizations:
        if search and search not in organization.name.lower():
            continue
        payload.append(
            {
                "organization": serialize_organization(organization),
                "checklist": _checklist(organization),
                "locations": _serialized_locations(organization),
                "modules": _serialized_modules(organization),
            }
        )
    return jsonify({"organizations": payload}), 200


@bp.get("/api/platform/setup/organizations/<int:organization_id>")
@login_required
def get_setup_organization(organization_id: int):
    permission_error = _require_platform_role("setup_admin", "support", "owner")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    role = _platform_role()
    if role is not None and role.role in {"setup_admin", "support"}:
        pass
    else:
        owner_membership = OrganizationMembership.query.filter_by(organization_id=organization.id, user_id=current_user.id, role="owner").first()
        if owner_membership is None:
            return json_error("Platform setup access is required.", 403)
    return jsonify(_serialize_organization_detail(organization)), 200


def _update_configuration_json(organization: Organization, updater: Any):
    configuration = _ensure_configuration(organization)
    version = _current_configuration(configuration)
    payload = deepcopy(version.configuration_json or {})
    updater(payload)
    new_version = OrganizationConfigurationVersion(
        organization_configuration_id=configuration.id,
        version_number=version.version_number + 1,
        status="draft",
        configuration_json=payload,
    )
    db.session.add(new_version)
    db.session.flush()
    configuration.current_version_id = new_version.id
    db.session.flush()
    return new_version


@bp.post("/api/platform/setup/organizations/<int:organization_id>/template")
@login_required
def set_setup_template(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    payload = request.get_json(silent=True) or {}
    template_key = str(payload.get("templateKey") or "").strip()
    template = _select_template(template_key)
    if template is None:
        return json_error("Unknown setup template.", 400)
    organization.setup_template_key = template_key
    organization.lifecycle_status = "ONBOARDING"
    organization.setup_status = "INTAKE"
    organization.is_prospect = True
    for module_key in MODULE_REGISTRY.keys():
        module = OrganizationModule.query.filter_by(organization_id=organization.id, module_key=module_key).first()
        if module is None:
            module = OrganizationModule(organization_id=organization.id, module_key=module_key, status="DISABLED", configuration_json={})
            db.session.add(module)
        if module_key in template["defaultModules"]:
            module.status = "SETUP_REQUIRED"
    _update_configuration_json(organization, lambda data: data.update({"templateKey": template_key, "requiredModules": list(template["defaultModules"])}))
    record_audit_event(
        event_type="setup.template_assigned",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"templateKey": template_key},
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/modules")
@login_required
def update_module_entitlements(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    payload = request.get_json(silent=True) or {}
    entries = payload.get("modules")
    if not isinstance(entries, list):
        return json_error("Modules payload is required.", 400)
    normalized: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        module_key = str(entry.get("moduleKey") or "").strip()
        status = str(entry.get("status") or "").strip().upper()
        if not module_key or module_key not in MODULE_REGISTRY:
            continue
        if status not in {"DISABLED", "SETUP_REQUIRED", "CONFIGURING", "READY_FOR_REVIEW", "ENABLED", "SUSPENDED"}:
            continue
        normalized[module_key] = status
    for module_key, status in normalized.items():
        module = OrganizationModule.query.filter_by(organization_id=organization.id, module_key=module_key).first()
        if module is None:
            module = OrganizationModule(organization_id=organization.id, module_key=module_key, status=status, configuration_json={})
            db.session.add(module)
        else:
            module.status = status
        if status == "ENABLED" and module.enabled_at is None:
            module.enabled_at = _utcnow()
            module.enabled_by_user_id = current_user.id
    _update_configuration_json(organization, lambda data: data.update({"moduleEntitlements": normalized}))
    record_audit_event(
        event_type="setup.modules_updated",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"moduleKeys": sorted(normalized.keys())},
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/locations")
@login_required
def update_locations(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    payload = request.get_json(silent=True) or {}
    locations = payload.get("locations")
    if not isinstance(locations, list):
        return json_error("Locations payload is required.", 400)
    updated: list[int] = []
    for item in locations:
        if not isinstance(item, dict):
            continue
        location_id = item.get("id")
        name = str(item.get("name") or "").strip()
        city = str(item.get("city") or "").strip()
        if not name or not city:
            continue
        if location_id is not None:
            try:
                location_id_int = int(location_id)
            except (TypeError, ValueError):
                return json_error("Location id must be numeric.", 400)
            location = RestaurantLocation.query.filter_by(id=location_id_int, organization_id=organization.id).first()
        else:
            location = None
        if location is None:
            location = RestaurantLocation(organization_id=organization.id, name=name, city=city)
            db.session.add(location)
        location.name = name
        location.address_line1 = str(item.get("addressLine1") or "").strip()
        location.address_line2 = str(item.get("addressLine2") or "").strip()
        location.city = city
        location.region = str(item.get("region") or "").strip()
        location.postal_code = str(item.get("postalCode") or "").strip()
        location.country = str(item.get("country") or "Canada").strip() or "Canada"
        location.timezone = str(item.get("timezone") or "America/Toronto").strip() or "America/Toronto"
        updated.append(location.id if location.id is not None else -1)
    record_audit_event(
        event_type="setup.locations_updated",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"locationCount": len(updated)},
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/dashboard-layout")
@login_required
def update_dashboard_layout(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    payload = request.get_json(silent=True) or {}
    layout_key = str(payload.get("layoutKey") or "owner").strip() or "owner"
    location_id = payload.get("locationId")
    widgets = payload.get("widgets")
    if not isinstance(widgets, list):
        return json_error("Widgets payload is required.", 400)
    scope_location_id = None
    if location_id not in {None, ""}:
        try:
            scope_location_id = int(location_id)
        except (TypeError, ValueError):
            return json_error("Location id must be numeric.", 400)
    layout = DashboardLayout.query.filter_by(organization_id=organization.id, location_id=scope_location_id, role=layout_key).first()
    if layout is None:
        layout = DashboardLayout(organization_id=organization.id, location_id=scope_location_id, role=layout_key, widgets_json=list(widgets))
        db.session.add(layout)
    else:
        layout.widgets_json = list(widgets)
        layout.version += 1
        layout.published_at = _utcnow()
    record_audit_event(
        event_type="setup.dashboard_layout_updated",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"layoutKey": layout_key, "locationId": scope_location_id},
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/custom-fields")
@login_required
def update_custom_fields(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    payload = request.get_json(silent=True) or {}
    fields = payload.get("fields")
    if not isinstance(fields, dict):
        return json_error("Custom fields payload is required.", 400)
    def _write(data: dict[str, Any]) -> None:
        data["customFields"] = fields
    _update_configuration_json(organization, _write)
    record_audit_event(
        event_type="setup.custom_fields_updated",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/blockers")
@login_required
def update_blockers(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    payload = request.get_json(silent=True) or {}
    blockers = payload.get("blockers")
    if not isinstance(blockers, list):
        return json_error("Blockers payload is required.", 400)
    def _write(data: dict[str, Any]) -> None:
        data["launchBlockers"] = [str(item).strip() for item in blockers if str(item).strip()]
    _update_configuration_json(organization, _write)
    record_audit_event(
        event_type="setup.blockers_updated",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/notes")
@login_required
def update_internal_notes(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    payload = request.get_json(silent=True) or {}
    notes = payload.get("notes")
    if not isinstance(notes, list):
        return json_error("Notes payload is required.", 400)

    def _write(data: dict[str, Any]) -> None:
        data["internalNotes"] = [str(item).strip() for item in notes if str(item).strip()]

    _update_configuration_json(organization, _write)
    record_audit_event(
        event_type="setup.notes_updated",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/imports")
@login_required
def update_imports(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    payload = request.get_json(silent=True) or {}
    imports = payload.get("imports")
    if not isinstance(imports, list):
        return json_error("Imports payload is required.", 400)
    def _write(data: dict[str, Any]) -> None:
        data["imports"] = imports
    _update_configuration_json(organization, _write)
    record_audit_event(
        event_type="setup.imports_updated",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/square")
@login_required
def update_square_status(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    payload = request.get_json(silent=True) or {}
    square = payload.get("square")
    if not isinstance(square, dict):
        return json_error("Square payload is required.", 400)
    def _write(data: dict[str, Any]) -> None:
        data["square"] = square
    _update_configuration_json(organization, _write)
    record_audit_event(
        event_type="setup.square_updated",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/review")
@login_required
def mark_customer_review(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    configuration = _ensure_configuration(organization)
    version = _current_configuration(configuration)

    def _write(data: dict[str, Any]) -> None:
        review = dict(data.get("customerReview") or {})
        review["requestedAt"] = review.get("requestedAt") or _utcnow().isoformat()
        review["approvedAt"] = None
        review["approvedByUserId"] = None
        review["approvedVersionId"] = version.id
        data["customerReview"] = review
    _update_configuration_json(organization, _write)
    organization.setup_status = "CUSTOMER_REVIEW"
    organization.lifecycle_status = "READY_FOR_REVIEW"
    record_audit_event(
        event_type="setup.customer_review_requested",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/review/approve")
@login_required
def approve_customer_review(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    configuration = _ensure_configuration(organization)
    version = _current_configuration(configuration)
    def _write(data: dict[str, Any]) -> None:
        review = dict(data.get("customerReview") or {})
        review["requestedAt"] = review.get("requestedAt") or _utcnow().isoformat()
        review["approvedAt"] = _utcnow().isoformat()
        review["approvedByUserId"] = current_user.id
        review["approvedVersionId"] = version.id
        data["customerReview"] = review
    _update_configuration_json(organization, _write)
    organization.setup_status = "COMPLETE"
    organization.lifecycle_status = "READY_FOR_REVIEW"
    organization.setup_completed_at = organization.setup_completed_at or _utcnow()
    record_audit_event(
        event_type="setup.customer_review_approved",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/state")
@login_required
def update_setup_state(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    payload = request.get_json(silent=True) or {}
    lifecycle_status = str(payload.get("lifecycleStatus") or organization.lifecycle_status).strip().upper()
    setup_status = str(payload.get("setupStatus") or organization.setup_status).strip().upper()
    subscription_status = str(payload.get("subscriptionStatus") or organization.subscription_status).strip().upper()
    setup_fee_status = str(payload.get("setupFeeStatus") or organization.setup_fee_status).strip().lower()
    if lifecycle_status not in {"DEMO", "ONBOARDING", "READY_FOR_REVIEW", "ACTIVE", "SUSPENDED", "CANCELLED"}:
        return json_error("Invalid lifecycle status.", 400)
    if setup_status not in {"NOT_STARTED", "INTAKE", "DATA_REQUESTED", "CONFIGURATION_IN_PROGRESS", "CUSTOMER_REVIEW", "COMPLETE"}:
        return json_error("Invalid setup status.", 400)
    if subscription_status not in {"NONE", "SETUP_PAYMENT_PENDING", "SETUP_PAID", "ACTIVE", "PAST_DUE", "CANCELLED"}:
        return json_error("Invalid subscription status.", 400)
    organization.lifecycle_status = lifecycle_status
    organization.setup_status = setup_status
    organization.subscription_status = subscription_status
    organization.setup_fee_status = setup_fee_status
    if lifecycle_status == "ACTIVE":
        organization.active_at = organization.active_at or _utcnow()
    if setup_status == "COMPLETE":
        organization.setup_completed_at = organization.setup_completed_at or _utcnow()
    if lifecycle_status == "SUSPENDED":
        organization.suspended_at = _utcnow()
    if lifecycle_status == "CANCELLED":
        organization.cancelled_at = _utcnow()
    record_audit_event(
        event_type="setup.state_updated",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={
            "lifecycleStatus": lifecycle_status,
            "setupStatus": setup_status,
            "subscriptionStatus": subscription_status,
            "setupFeeStatus": setup_fee_status,
        },
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.post("/api/platform/setup/organizations/<int:organization_id>/activate")
@login_required
def activate_organization(organization_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    organization = Organization.query.filter_by(id=organization_id).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    checklist = _checklist(organization)
    if not checklist["readyForActivation"]:
        return json_error("Activation checks are incomplete.", 409, errors={"blockers": ", ".join(checklist["launchBlockers"] or checklist["missingModules"] or ["activation not ready"])})
    organization.lifecycle_status = "ACTIVE"
    organization.setup_status = "COMPLETE"
    organization.subscription_status = "ACTIVE"
    organization.is_prospect = False
    organization.active_at = organization.active_at or _utcnow()
    organization.setup_completed_at = organization.setup_completed_at or _utcnow()
    record_audit_event(
        event_type="setup.organization_activated",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
    )
    payload = _serialize_organization_detail(organization)
    return _commit_json_response(payload)


@bp.get("/api/platform/support/grants")
@login_required
def list_support_grants():
    permission_error = _require_platform_role("setup_admin", "support")
    if permission_error is not None:
        return permission_error
    query = SupportAccessGrant.query
    organization_id = request.args.get("organizationId")
    support_user_id = request.args.get("supportUserId")
    status = str(request.args.get("status") or "").strip().lower()
    if organization_id not in {None, ""}:
        try:
            query = query.filter(SupportAccessGrant.organization_id == int(organization_id))
        except (TypeError, ValueError):
            return json_error("Organization id must be numeric.", 400)
    if support_user_id not in {None, ""}:
        try:
            query = query.filter(SupportAccessGrant.support_user_id == int(support_user_id))
        except (TypeError, ValueError):
            return json_error("Support user id must be numeric.", 400)
    if status:
        query = query.filter(db.func.lower(SupportAccessGrant.status) == status)
    role = _platform_role()
    if role is not None and role.role == "support":
        query = query.filter(SupportAccessGrant.support_user_id == current_user.id)
    grants = query.order_by(SupportAccessGrant.created_at.desc(), SupportAccessGrant.id.desc()).all()
    return jsonify({"grants": [_serialize_support_grant(grant) for grant in grants]}), 200


@bp.post("/api/platform/support/grants")
@login_required
def create_support_grant():
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    payload = request.get_json(silent=True) or {}
    organization_id = payload.get("organizationId")
    support_user_email = clean_email(payload.get("supportUserEmail"))
    reason = str(payload.get("reason") or "").strip()
    case_reference = str(payload.get("caseReference") or "").strip()
    if organization_id in {None, ""}:
        return json_error("Organization id is required.", 400)
    if not support_user_email:
        return json_error("Support user email is required.", 400)
    if not reason:
        return json_error("A support reason is required.", 400)
    try:
        organization_id_int = int(organization_id)
    except (TypeError, ValueError):
        return json_error("Organization id must be numeric.", 400)
    organization = Organization.query.filter_by(id=organization_id_int).first()
    if organization is None:
        return json_error("Organization not found.", 404)
    support_user = User.query.filter_by(email=support_user_email).first()
    if support_user is None:
        return json_error("Support user not found.", 404)
    starts_at = _parse_datetime(payload.get("startsAt"), default=_utcnow())
    expires_at = _parse_datetime(payload.get("expiresAt"), default=starts_at + timedelta(hours=1))
    if expires_at <= starts_at:
        return json_error("Expiry must be after the start time.", 400)
    grant = SupportAccessGrant(
        organization_id=organization.id,
        requested_by_user_id=current_user.id,
        approved_by_user_id=current_user.id,
        support_user_id=support_user.id,
        reason=reason,
        case_reference=case_reference,
        status="active",
        starts_at=starts_at,
        expires_at=expires_at,
        visible_in_ui=True,
    )
    db.session.add(grant)
    db.session.flush()
    record_audit_event(
        event_type="support.grant_created",
        entity_type="support_access_grant",
        entity_id=grant.id,
        organization_id=organization.id,
        actor_user_id=current_user.id,
        metadata={"supportUserEmail": support_user.email, "caseReference": case_reference, "expiresAt": isoformat(expires_at)},
    )
    payload = {"grant": _serialize_support_grant(grant)}
    return _commit_json_response(payload, 201)


@bp.post("/api/platform/support/grants/<int:grant_id>/revoke")
@login_required
def revoke_support_grant(grant_id: int):
    permission_error = _require_platform_role("setup_admin")
    if permission_error is not None:
        return permission_error
    grant = SupportAccessGrant.query.filter_by(id=grant_id).first()
    if grant is None:
        return json_error("Support grant not found.", 404)
    if grant.revoked_at is not None:
        return json_error("Support grant is already revoked.", 409)
    grant.revoked_at = _utcnow()
    grant.status = "revoked"
    record_audit_event(
        event_type="support.grant_revoked",
        entity_type="support_access_grant",
        entity_id=grant.id,
        organization_id=grant.organization_id,
        actor_user_id=current_user.id,
        metadata={"supportUserEmail": grant.support_user.email if grant.support_user else "", "caseReference": grant.case_reference},
    )
    payload = {"grant": _serialize_support_grant(grant)}
    return _commit_json_response(payload)
