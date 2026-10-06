"""Guarded, auditable inventory preparation for the private showcase tenant."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import uuid4

from flask import current_app
from sqlalchemy import text

from .audit import record_audit_event
from .config import database_name_from_url
from .extensions import db
from .models import InventoryItem, InventoryMovement, Organization, OrganizationMembership, RestaurantLocation, User


SHOWCASE_ORGANIZATION_NAME = "Flowtally Showcase"
SHOWCASE_LOCATION_NAME = "Harbour Kitchen"
SHOWCASE_REASON = "showcase inventory replenishment"
TARGETS: tuple[tuple[str, str, Decimal], ...] = (
    ("Chicken Breast", "kg", Decimal("10.00")),
    ("Bread Buns", "pack", Decimal("20.00")),
    ("Lettuce", "head", Decimal("8.00")),
)


class ShowcaseInventoryError(RuntimeError):
    """A safe validation error for the explicit showcase operation."""


@dataclass(frozen=True)
class ShowcaseInventoryTarget:
    item_id: int
    item_name: str
    unit: str
    current_quantity: Decimal
    target_quantity: Decimal
    adjustment: Decimal

    @property
    def status(self) -> str:
        if self.current_quantity > self.target_quantity:
            return "already_above_target"
        if self.current_quantity == self.target_quantity:
            return "at_target"
        return "needs_replenishment"


def _production_identity_guard(organization_id: int, location_id: int) -> tuple[Organization, RestaurantLocation]:
    if str(current_app.config.get("FLOWTALLY_ENV") or "").strip().lower() != "production":
        raise ShowcaseInventoryError("Showcase replenishment is production-only.")
    configured_id = str(current_app.config.get("FLOWTALLY_SHOWCASE_ORGANIZATION_ID") or "").strip()
    if not configured_id or configured_id != str(organization_id):
        raise ShowcaseInventoryError("The organization id must exactly match FLOWTALLY_SHOWCASE_ORGANIZATION_ID.")
    configured_database = str(current_app.config.get("FLOWTALLY_PRODUCTION_DATABASE_NAME") or "flowtally_prod").strip().lower()
    configured_uri_database = database_name_from_url(str(current_app.config.get("SQLALCHEMY_DATABASE_URI") or "")).strip().lower()
    if configured_uri_database != configured_database or configured_uri_database in {"defaultdb", "staging"}:
        raise ShowcaseInventoryError("Showcase replenishment requires the explicitly configured production database.")
    if db.engine.dialect.name == "postgresql":
        current_database = str(db.session.execute(text("SELECT current_database()")).scalar() or "").strip().lower()
        if current_database != configured_database or current_database in {"defaultdb", "staging"}:
            raise ShowcaseInventoryError("The selected database is not the configured production database.")
    organization = Organization.query.filter_by(id=organization_id).first()
    location = RestaurantLocation.query.filter_by(id=location_id, organization_id=organization_id).first()
    if organization is None or organization.name != SHOWCASE_ORGANIZATION_NAME:
        raise ShowcaseInventoryError("The target is not the configured Flowtally Showcase organization.")
    if location is None or location.name != SHOWCASE_LOCATION_NAME:
        raise ShowcaseInventoryError("The target location is not Harbour Kitchen in the showcase organization.")
    return organization, location


def inspect_showcase_replenishment(*, organization_id: int, location_id: int) -> tuple[Organization, RestaurantLocation, list[ShowcaseInventoryTarget]]:
    organization, location = _production_identity_guard(organization_id, location_id)
    targets: list[ShowcaseInventoryTarget] = []
    for name, unit, target in TARGETS:
        matches = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, name=name).all()
        if len(matches) != 1:
            raise ShowcaseInventoryError(f"Expected exactly one {name} item in {SHOWCASE_LOCATION_NAME}; found {len(matches)}.")
        item = matches[0]
        if item.stock_unit != unit:
            raise ShowcaseInventoryError(f"{name} must use stock unit {unit}; found {item.stock_unit}.")
        current_quantity = Decimal(str(item.current_on_hand or 0)).quantize(Decimal("0.01"))
        adjustment = max(target - current_quantity, Decimal("0")).quantize(Decimal("0.01"))
        targets.append(ShowcaseInventoryTarget(item.id, item.name, unit, current_quantity, target, adjustment))
    return organization, location, targets


def replenish_showcase_inventory(*, organization_id: int, location_id: int, actor_id: int, dry_run: bool = False) -> dict[str, Any]:
    organization, location, targets = inspect_showcase_replenishment(organization_id=organization_id, location_id=location_id)
    owner_membership = OrganizationMembership.query.filter_by(organization_id=organization.id, user_id=actor_id, role="owner").first()
    if owner_membership is None or db.session.get(User, actor_id) is None:
        raise ShowcaseInventoryError("The actor must be an owner of the showcase organization.")
    payload = {
        "organizationId": organization.id,
        "organizationName": organization.name,
        "locationId": location.id,
        "locationName": location.name,
        "reason": SHOWCASE_REASON,
        "targets": [
            {
                "itemId": target.item_id,
                "item": target.item_name,
                "unit": target.unit,
                "current": float(target.current_quantity),
                "target": float(target.target_quantity),
                "adjustment": float(target.adjustment),
                "status": target.status,
            }
            for target in targets
        ],
        "writes": not dry_run,
    }
    if dry_run:
        return payload
    for target in targets:
        if target.adjustment == 0:
            continue
        before = Decimal(str(target.current_quantity))
        after = target.target_quantity
        item = db.session.get(InventoryItem, target.item_id)
        if item is None or Decimal(str(item.current_on_hand or 0)).quantize(Decimal("0.01")) != before:
            raise ShowcaseInventoryError(f"{target.item_name} changed while replenishment was being prepared; rerun the dry-run.")
        item.current_on_hand = after
        item.updated_by_user_id = actor_id
        item.updated_at = datetime.now(timezone.utc)
        movement = InventoryMovement(
            organization_id=organization.id,
            location_id=location.id,
            inventory_item_id=item.id,
            quantity_delta=target.adjustment,
            quantity_before=before,
            quantity_after=after,
            unit=item.stock_unit,
            source_type=SHOWCASE_REASON,
            # A target-based replenishment may legitimately run again after
            # later sales consume stock.  Use a unique operation id rather
            # than treating an old before/after pair as permanently applied.
            source_record_id=f"showcase-replenishment:{target.item_id}:{uuid4().hex}",
            source_line_id="target",
            reason=SHOWCASE_REASON,
            actor_user_id=actor_id,
        )
        db.session.add(movement)
        db.session.flush()
        record_audit_event(
            event_type="showcase.inventory_replenished",
            entity_type="inventory_movement",
            entity_id=movement.id,
            organization_id=organization.id,
            location_id=location.id,
            actor_user_id=actor_id,
            request_id="showcase-replenishment",
            source_ip="local-cli",
            user_agent="showcase-replenishment",
            metadata={"itemName": item.name, "quantityDelta": float(target.adjustment), "targetQuantity": float(after)},
        )
    db.session.commit()
    return payload
