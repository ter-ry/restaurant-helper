from __future__ import annotations

from decimal import Decimal

from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement, User
from backend.pilot_api import _status_for_item
from backend.showcase_inventory import TARGETS, replenish_showcase_inventory
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
    initial = {"Chicken Breast": "2.94", "Bread Buns": "7.50", "Lettuce": "0.26"}
    for spec in TARGETS:
        quantity = initial.get(spec.item_name, str(spec.target_quantity))
        db.session.add(
            InventoryItem(
                organization_id=organization.id,
                location_id=location.id,
                name=spec.item_name,
                normalized_name=spec.item_name.lower().replace(" ", "-"),
                category="Showcase",
                stock_unit=spec.unit,
                current_on_hand=Decimal(quantity),
                min_quantity=spec.minimum_quantity,
                par_level=spec.par_level,
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
    assert len(result["targets"]) == len(TARGETS) == 23
    assert [(row["item"], row["unit"], row["minimum"], row["par"]) for row in result["targets"]] == [
        (spec.item_name, spec.unit, float(spec.minimum_quantity), float(spec.par_level)) for spec in TARGETS
    ]
    by_item = {row["item"]: row for row in result["targets"]}
    assert [(by_item[name]["current"], by_item[name]["target"], by_item[name]["adjustment"], by_item[name]["unit"]) for name in ("Chicken Breast", "Bread Buns", "Lettuce")] == [
        (2.94, 10.0, 7.06, "kg"),
        (7.5, 20.0, 12.5, "pack"),
        (0.26, 8.0, 7.74, "head"),
    ]
    assert all(row["write"] == (row["adjustment"] > 0) for row in result["targets"])
    assert {row["intendedStatus"] for row in result["targets"]} == {"healthy", "low", "reorder", "out_of_stock"}
    assert {status: sum(row["intendedStatus"] == status for row in result["targets"]) for status in ("healthy", "low", "reorder", "out_of_stock")} == {
        "healthy": 16,
        "low": 4,
        "reorder": 2,
        "out_of_stock": 1,
    }
    assert InventoryMovement.query.filter_by(organization_id=organization.id).count() == 0


def test_showcase_replenishment_is_increase_only_for_at_and_above_target_items(app):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Flowtally Showcase", location_name="Harbour Kitchen")
    location = organization.locations[0]
    _add_targets(organization, location, owner)
    for spec in TARGETS:
        item = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, name=spec.item_name).one()
        item.current_on_hand = spec.target_quantity
    bread = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, name="Bread Buns").one()
    bread.current_on_hand = Decimal("22.00")
    db.session.commit()
    _configure_showcase(app, organization.id)

    result = replenish_showcase_inventory(organization_id=organization.id, location_id=location.id, actor_id=owner.id, dry_run=True)

    by_item = {row["item"]: row for row in result["targets"]}
    assert by_item["Chicken Breast"]["status"] == "at_target"
    assert by_item["Bread Buns"]["status"] == "already_above_target"
    assert by_item["Lettuce"]["status"] == "at_target"
    assert all(row["adjustment"] == 0.0 for row in result["targets"])
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
        {**row, "current": row["target"], "adjustment": 0.0, "status": "at_target", "write": False}
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


def test_showcase_replenishment_does_not_touch_another_tenant(app):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    showcase = make_operational_organization(owner, name="Flowtally Showcase", location_name="Harbour Kitchen")
    showcase_location = showcase.locations[0]
    _add_targets(showcase, showcase_location, owner)
    other = make_operational_organization(owner, name="Other Restaurant", location_name="Other Location")
    other_location = other.locations[0]
    _add_targets(other, other_location, owner)
    before = {
        item.name: Decimal(str(item.current_on_hand))
        for item in InventoryItem.query.filter_by(organization_id=other.id, location_id=other_location.id).all()
    }
    _configure_showcase(app, showcase.id)

    replenish_showcase_inventory(organization_id=showcase.id, location_id=showcase_location.id, actor_id=owner.id)

    after = {
        item.name: Decimal(str(item.current_on_hand))
        for item in InventoryItem.query.filter_by(organization_id=other.id, location_id=other_location.id).all()
    }
    assert after == before
    assert InventoryMovement.query.filter_by(organization_id=other.id).count() == 0


def test_showcase_targets_match_actual_reorder_status_rules(app):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Flowtally Showcase", location_name="Harbour Kitchen")
    location = organization.locations[0]
    _add_targets(organization, location, owner)

    expected = {
        "healthy": "In stock",
        "low": "Low stock",
        "reorder": "Reorder now",
        "out_of_stock": "Out of stock",
    }
    for spec in TARGETS:
        item = InventoryItem.query.filter_by(
            organization_id=organization.id,
            location_id=location.id,
            name=spec.item_name,
        ).one()
        item.current_on_hand = spec.target_quantity
        assert _status_for_item(item)["status"] == expected[spec.intended_status]
