from __future__ import annotations

from decimal import Decimal

from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement, User
from backend.showcase_inventory import replenish_showcase_inventory
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization


def _configure_showcase(app, organization_id: int):
    app.config.update(
        FLOWTALLY_ENV="production",
        FLOWTALLY_SHOWCASE_ORGANIZATION_ID=str(organization_id),
        FLOWTALLY_PRODUCTION_DATABASE_NAME="flowtally_prod",
        SQLALCHEMY_DATABASE_URI="postgresql://test/flowtally_prod",
    )


def _add_targets(organization, location, owner):
    for name, unit, quantity in (("Chicken Breast", "kg", "2.94"), ("Bread Buns", "pack", "7.50"), ("Lettuce", "head", "0.26")):
        db.session.add(
            InventoryItem(
                organization_id=organization.id,
                location_id=location.id,
                name=name,
                normalized_name=name.lower().replace(" ", "-"),
                category="Showcase",
                stock_unit=unit,
                current_on_hand=Decimal(quantity),
                created_by_user_id=owner.id,
                updated_by_user_id=owner.id,
            )
        )
    db.session.commit()


def test_showcase_replenishment_dry_run_is_target_based_and_writes_nothing(app):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Flowtally Showcase", location_name="Harbour Kitchen")
    location = organization.locations[0]
    _add_targets(organization, location, owner)
    _configure_showcase(app, organization.id)

    result = replenish_showcase_inventory(organization_id=organization.id, location_id=location.id, actor_id=owner.id, dry_run=True)

    assert result["writes"] is False
    assert [(row["item"], row["current"], row["target"], row["adjustment"], row["unit"]) for row in result["targets"]] == [
        ("Chicken Breast", 2.94, 10.0, 7.06, "kg"),
        ("Bread Buns", 7.5, 20.0, 12.5, "pack"),
        ("Lettuce", 0.26, 8.0, 7.74, "head"),
    ]
    assert InventoryMovement.query.filter_by(organization_id=organization.id).count() == 0


def test_showcase_replenishment_is_increase_only_for_at_and_above_target_items(app):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Flowtally Showcase", location_name="Harbour Kitchen")
    location = organization.locations[0]
    for name, unit, quantity in (
        ("Chicken Breast", "kg", "10.00"),
        ("Bread Buns", "pack", "22.00"),
        ("Lettuce", "head", "8.00"),
    ):
        db.session.add(
            InventoryItem(
                organization_id=organization.id,
                location_id=location.id,
                name=name,
                normalized_name=name.lower().replace(" ", "-"),
                category="Showcase",
                stock_unit=unit,
                current_on_hand=Decimal(quantity),
                created_by_user_id=owner.id,
                updated_by_user_id=owner.id,
            )
        )
    db.session.commit()
    _configure_showcase(app, organization.id)

    result = replenish_showcase_inventory(organization_id=organization.id, location_id=location.id, actor_id=owner.id, dry_run=True)

    assert [(row["item"], row["adjustment"], row["status"]) for row in result["targets"]] == [
        ("Chicken Breast", 0.0, "at_target"),
        ("Bread Buns", 0.0, "already_above_target"),
        ("Lettuce", 0.0, "at_target"),
    ]
    assert all(row["adjustment"] >= 0 for row in result["targets"])
    applied = replenish_showcase_inventory(organization_id=organization.id, location_id=location.id, actor_id=owner.id)
    assert all(row["adjustment"] >= 0 for row in applied["targets"])
    assert InventoryMovement.query.filter_by(organization_id=organization.id).count() == 0


def test_showcase_replenishment_is_idempotent_at_target(app):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Flowtally Showcase", location_name="Harbour Kitchen")
    location = organization.locations[0]
    _add_targets(organization, location, owner)
    _configure_showcase(app, organization.id)

    first = replenish_showcase_inventory(organization_id=organization.id, location_id=location.id, actor_id=owner.id)
    second = replenish_showcase_inventory(organization_id=organization.id, location_id=location.id, actor_id=owner.id)

    assert first["writes"] is True
    assert second["targets"] == [
        {**row, "current": row["target"], "adjustment": 0.0, "status": "at_target"}
        for row in first["targets"]
    ]
    assert InventoryMovement.query.filter_by(organization_id=organization.id, source_type="showcase inventory replenishment").count() == 3


def test_showcase_replenishment_can_run_again_after_later_consumption(app):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Flowtally Showcase", location_name="Harbour Kitchen")
    location = organization.locations[0]
    _add_targets(organization, location, owner)
    _configure_showcase(app, organization.id)

    first = replenish_showcase_inventory(organization_id=organization.id, location_id=location.id, actor_id=owner.id)
    chicken = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, name="Chicken Breast").one()
    chicken.current_on_hand = Decimal("8.20")
    db.session.add(
        InventoryMovement(
            organization_id=organization.id,
            location_id=location.id,
            inventory_item_id=chicken.id,
            quantity_delta=Decimal("-1.80"),
            quantity_before=Decimal("10.00"),
            quantity_after=Decimal("8.20"),
            unit=chicken.stock_unit,
            source_type="square sale",
            source_record_id="later-sale-1",
            source_line_id="burger",
            reason="Later legitimate consumption",
            actor_user_id=owner.id,
        )
    )
    db.session.commit()

    second = replenish_showcase_inventory(organization_id=organization.id, location_id=location.id, actor_id=owner.id)
    chicken_replenishments = InventoryMovement.query.filter_by(
        organization_id=organization.id,
        location_id=location.id,
        inventory_item_id=chicken.id,
        source_type="showcase inventory replenishment",
    ).order_by(InventoryMovement.id).all()

    assert first["targets"][0]["adjustment"] == 7.06
    assert second["targets"][0]["current"] == 8.2
    assert second["targets"][0]["adjustment"] == 1.8
    assert chicken.current_on_hand == Decimal("10.00")
    assert len(chicken_replenishments) == 2

    immediate = replenish_showcase_inventory(organization_id=organization.id, location_id=location.id, actor_id=owner.id)
    assert immediate["targets"][0]["adjustment"] == 0.0
    assert len(InventoryMovement.query.filter_by(
        organization_id=organization.id,
        location_id=location.id,
        inventory_item_id=chicken.id,
        source_type="showcase inventory replenishment",
    ).all()) == 2
