from __future__ import annotations

from typing import Any

from flask import request
from flask_login import current_user
from sqlalchemy import text

from .access import SUPPORT_ACCESS_ENABLED, support_grant_for_user
from .extensions import db
from .models import Organization
from .utils import get_current_organization_bundle, get_platform_role


def _is_postgresql() -> bool:
    try:
        return db.engine.dialect.name == "postgresql"
    except Exception:
        return False


def _set_local_setting(name: str, value: str | None) -> None:
    if not _is_postgresql():
        return
    db.session.execute(text("select set_config(:name, :value, true)"), {"name": name, "value": value or ""})


def apply_request_tenant_context(*, access_scope: str | None = None, organization_id: int | None = None, support_grant_id: int | None = None) -> None:
    if not _is_postgresql():
        return

    scope = access_scope or "customer"
    org_id = organization_id
    grant_id = support_grant_id

    if org_id is None:
        organization, membership, _ = get_current_organization_bundle()
        if organization is not None and membership is not None:
            org_id = organization.id
            if current_user.is_authenticated:
                grant = support_grant_for_user(current_user.id, organization.id)
                if grant is not None:
                    grant_id = grant.id
        elif access_scope is None and request.endpoint == "commercial.create_prospect_organization":
            scope = "public"

    if current_user.is_authenticated:
        role = get_platform_role(current_user.id)
        if role and role.is_active and role.role == "setup_admin":
            scope = "setup"
        elif role and role.is_active and role.role == "support":
            if SUPPORT_ACCESS_ENABLED and grant_id is not None:
                scope = "support"
            else:
                scope = "public"
                org_id = None
                grant_id = None

    _set_local_setting("flowtally.access_scope", scope)
    _set_local_setting("flowtally.organization_id", str(org_id) if org_id is not None else "")
    _set_local_setting("flowtally.support_grant_id", str(grant_id) if grant_id is not None else "")


def apply_org_tenant_context(organization: Organization | None, *, access_scope: str | None = None) -> None:
    if organization is None:
        return
    grant_id = None
    if current_user.is_authenticated:
        grant = support_grant_for_user(current_user.id, organization.id)
        if grant is not None:
            grant_id = grant.id
    apply_request_tenant_context(access_scope=access_scope, organization_id=organization.id, support_grant_id=grant_id)
