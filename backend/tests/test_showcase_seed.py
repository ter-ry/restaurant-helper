from __future__ import annotations

from datetime import datetime, timezone

import pytest

import backend.seed as seed_module
from backend.extensions import db
from backend.models import (
    AuditEvent,
    InventoryItem,
    MenuItem,
    Organization,
    OrganizationMembership,
    OrganizationModule,
    PurchaseInvoice,
    RestaurantLocation,
    StockCountSession,
    User,
)
from backend.seed import OFFICIAL_DEMO_MODULE_KEYS, seed_showcase_tenant


def _create_showcase(app):
    with app.app_context():
        owner = User(email="showcase-owner@example.test", is_active=True)
        owner.set_password("showcase-test-password")
        organization = Organization(
            name="Flowtally Showcase",
            lifecycle_status="ACTIVE",
            setup_status="COMPLETE",
            subscription_status="ACTIVE",
            setup_template_key="GENERIC_RESTAURANT",
            setup_fee_status="confirmed",
            subscription_provider="manual",
            external_customer_reference="showcase-tenant-marker",
            external_subscription_reference="showcase-subscription",
            is_prospect=False,
            active_at=datetime.now(timezone.utc),
            setup_completed_at=datetime.now(timezone.utc),
        )
        db.session.add_all([owner, organization])
        db.session.flush()
        location = RestaurantLocation(
            organization_id=organization.id,
            name="Harbour Kitchen",
            city="Toronto",
            region="ON",
            country="Canada",
            timezone="America/Toronto",
        )
        db.session.add(location)
        db.session.add(OrganizationMembership(user_id=owner.id, organization_id=organization.id, role="owner"))
        db.session.commit()
        return organization.id, location.id, owner.id


def test_showcase_seed_is_idempotent_and_tenant_scoped(app, monkeypatch):
    organization_id, location_id, owner_id = _create_showcase(app)
    monkeypatch.setattr(seed_module, "_clear_seed_data", lambda: (_ for _ in ()).throw(AssertionError("global reset invoked")))

    with app.app_context():
        other = Organization.query.filter(Organization.id != organization_id).first()
        before_other = {
            "inventory": InventoryItem.query.filter_by(organization_id=other.id).count(),
            "purchases": PurchaseInvoice.query.filter_by(organization_id=other.id).count(),
            "menu": MenuItem.query.filter_by(organization_id=other.id).count(),
        }
        seed_showcase_tenant(organization_id=organization_id, location_id=location_id, owner_id=owner_id)
        first_counts = {
            "inventory": InventoryItem.query.filter_by(organization_id=organization_id).count(),
            "purchases": PurchaseInvoice.query.filter_by(organization_id=organization_id).count(),
            "menu": MenuItem.query.filter_by(organization_id=organization_id).count(),
            "counts": StockCountSession.query.filter_by(organization_id=organization_id).count(),
        }
        seed_showcase_tenant(organization_id=organization_id, location_id=location_id, owner_id=owner_id)
        second_counts = {
            "inventory": InventoryItem.query.filter_by(organization_id=organization_id).count(),
            "purchases": PurchaseInvoice.query.filter_by(organization_id=organization_id).count(),
            "menu": MenuItem.query.filter_by(organization_id=organization_id).count(),
            "counts": StockCountSession.query.filter_by(organization_id=organization_id).count(),
        }
        assert second_counts == first_counts
        assert {entry.module_key for entry in OrganizationModule.query.filter_by(organization_id=organization_id, status="ENABLED").all()} == set(OFFICIAL_DEMO_MODULE_KEYS)
        assert {entry.name for entry in MenuItem.query.filter_by(organization_id=organization_id).all()} == {
            "Harbour Burger", "Chicken Rice Bowl", "Toronto Breakfast", "House Salad", "Iced Latte", "Berry Parfait", "Seasonal Soup",
        }
        assert {
            "inventory": InventoryItem.query.filter_by(organization_id=other.id).count(),
            "purchases": PurchaseInvoice.query.filter_by(organization_id=other.id).count(),
            "menu": MenuItem.query.filter_by(organization_id=other.id).count(),
        } == before_other
        assert AuditEvent.query.filter_by(organization_id=organization_id, event_type="showcase.seeded").count() == 2


def test_showcase_seed_rejects_wrong_location(app):
    organization_id, location_id, owner_id = _create_showcase(app)
    with app.app_context():
        other_location = RestaurantLocation(organization_id=organization_id, name="Other location", city="Toronto", region="ON", country="Canada", timezone="America/Toronto")
        db.session.add(other_location)
        db.session.commit()
        with pytest.raises(RuntimeError, match="marker|does not belong"):
            seed_showcase_tenant(organization_id=organization_id, location_id=other_location.id, owner_id=owner_id)
        with pytest.raises(RuntimeError, match="owner was not found"):
            seed_showcase_tenant(organization_id=organization_id, location_id=location_id, owner_id=owner_id + 99999)


def test_showcase_command_requires_explicit_target_and_confirmation(app):
    organization_id, location_id, owner_id = _create_showcase(app)
    app.config.update(
        FLOWTALLY_ENV="production",
        FLOWTALLY_SHOWCASE_ORGANIZATION_ID=str(organization_id),
        FLOWTALLY_PRODUCTION_DATABASE_NAME="pilot.db",
        SQLALCHEMY_DATABASE_URI="sqlite:///pilot.db",
    )
    runner = app.test_cli_runner()
    missing_confirmation = runner.invoke(args=["showcase-seed", "--organization-id", str(organization_id), "--location-id", str(location_id), "--owner-id", str(owner_id)])
    assert missing_confirmation.exit_code != 0
    assert "confirm-production" in missing_confirmation.output

    wrong_target = runner.invoke(args=["showcase-seed", "--organization-id", str(organization_id + 1), "--location-id", str(location_id), "--owner-id", str(owner_id), "--confirm-production"])
    assert wrong_target.exit_code != 0
    assert "must exactly match" in wrong_target.output

    app.config["FLOWTALLY_PRODUCTION_DATABASE_NAME"] = "flowtally_prod"
    wrong_database = runner.invoke(args=["showcase-seed", "--organization-id", str(organization_id), "--location-id", str(location_id), "--owner-id", str(owner_id), "--confirm-production"])
    assert wrong_database.exit_code != 0
    assert "production database" in wrong_database.output
