from __future__ import annotations

from uuid import uuid4
from typing import Any

from flask import g, request

from .extensions import db
from .models import AuditEvent


def ensure_request_id() -> str:
    request_id = getattr(g, "request_id", None)
    if request_id:
        return str(request_id)

    request_id = request.headers.get("X-Request-Id") or uuid4().hex
    g.request_id = request_id
    return request_id


def request_ip_address() -> str | None:
    forwarded_for = request.headers.get("X-Forwarded-For", "").strip()
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip() or None
    return request.remote_addr


def request_user_agent() -> str | None:
    user_agent = request.headers.get("User-Agent", "").strip()
    return user_agent[:255] if user_agent else None


def record_audit_event(
    *,
    event_type: str,
    entity_type: str,
    entity_id: str | int | None = None,
    organization_id: int | None = None,
    location_id: int | None = None,
    actor_user_id: int | None = None,
    metadata: dict[str, Any] | None = None,
    request_id: str | None = None,
    source_ip: str | None = None,
    user_agent: str | None = None,
) -> AuditEvent:
    event = AuditEvent(
        organization_id=organization_id,
        location_id=location_id,
        actor_user_id=actor_user_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else "",
        request_id=request_id or ensure_request_id(),
        source_ip=source_ip if source_ip is not None else request_ip_address(),
        user_agent=user_agent if user_agent is not None else request_user_agent(),
        metadata_json=metadata or {},
    )
    db.session.add(event)
    return event
