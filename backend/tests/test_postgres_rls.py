from __future__ import annotations

import os
import importlib.util
from datetime import timedelta

import pytest
from sqlalchemy import text

from backend.app import create_app
from backend.extensions import db
from backend.models import Organization, OrganizationMembership, OrganizationModule, RestaurantLocation, SquareConnection, SquareDailySalesSummary, SquareOrder, SupportAccessGrant, Supplier, User
from backend.seed import LOCAL_OWNER_EMAIL, seed_pilot_data
from backend.utils import utc_now


POSTGRES_URL = os.environ.get("FLOWTALLY_TEST_POSTGRES_URL") or os.environ.get("DATABASE_URL", "")

_rls_spec = importlib.util.spec_from_file_location(
    "backend.migrations.versions.0009_postgres_row_level_security",
    os.path.join(os.path.dirname(__file__), "..", "migrations", "versions", "0009_postgres_row_level_security.py"),
)
assert _rls_spec and _rls_spec.loader
_rls_module = importlib.util.module_from_spec(_rls_spec)
_rls_spec.loader.exec_module(_rls_module)
upgrade = _rls_module.upgrade

_square_rls_spec = importlib.util.spec_from_file_location(
    "backend.migrations.versions.0011_postgres_row_level_security_square_orders",
    os.path.join(os.path.dirname(__file__), "..", "migrations", "versions", "0011_postgres_row_level_security_square_orders.py"),
)
assert _square_rls_spec and _square_rls_spec.loader
_square_rls_module = importlib.util.module_from_spec(_square_rls_spec)
_square_rls_spec.loader.exec_module(_square_rls_module)
square_upgrade = _square_rls_module.upgrade


pytestmark = pytest.mark.skipif(
    not POSTGRES_URL.startswith("postgres"),
    reason="PostgreSQL test database is not configured.",
)


@pytest.fixture()
def postgres_app(tmp_path):
    application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": POSTGRES_URL,
            "SESSION_COOKIE_SECURE": False,
            "ALLOWED_ORIGINS": ["http://127.0.0.1:5173"],
            "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://",
            "WTF_CSRF_ENABLED": True,
        }
    )
    with application.app_context():
        db.drop_all()
        db.create_all()
        seed_pilot_data(reset=False)
        upgrade()
        square_upgrade()
        yield application
        db.session.remove()
        db.drop_all()


def _set_rls_context(*, access_scope: str, organization_id: int | None = None, support_grant_id: int | None = None) -> None:
    db.session.connection().exec_driver_sql("select set_config(%s, %s, true)", ("flowtally.access_scope", access_scope))
    db.session.connection().exec_driver_sql(
        "select set_config(%s, %s, true)",
        ("flowtally.organization_id", "" if organization_id is None else str(organization_id)),
    )
    db.session.connection().exec_driver_sql(
        "select set_config(%s, %s, true)",
        ("flowtally.support_grant_id", "" if support_grant_id is None else str(support_grant_id)),
    )


def _create_org(owner: User, name: str) -> Organization:
    organization = Organization(
        name=name,
        lifecycle_status="ACTIVE",
        setup_status="COMPLETE",
        subscription_status="ACTIVE",
        setup_template_key="GENERIC_RESTAURANT",
        setup_fee_status="confirmed",
        subscription_provider="manual",
        is_prospect=False,
        active_at=utc_now(),
        setup_completed_at=utc_now(),
    )
    db.session.add(organization)
    db.session.flush()
    db.session.add(OrganizationMembership(user=owner, organization=organization, role="owner"))
    db.session.add(
        RestaurantLocation(
            organization=organization,
            name=f"{name} Main",
            address_line1="123 Test St",
            city="Toronto",
            region="ON",
            postal_code="M5V 1A1",
            country="Canada",
            timezone="America/Toronto",
        )
    )
    db.session.add(
        OrganizationModule(
            organization=organization,
            module_key="PURCHASES",
            status="ENABLED",
        )
    )
    db.session.commit()
    return organization


def test_rls_hides_other_tenant_rows(postgres_app):
    with postgres_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org_a = _create_org(owner, "RLS Alpha")
        org_b = _create_org(owner, "RLS Beta")
        db.session.add(Supplier(organization_id=org_a.id, name="Alpha Supplier", normalized_name="alpha supplier"))
        db.session.add(Supplier(organization_id=org_b.id, name="Beta Supplier", normalized_name="beta supplier"))
        db.session.commit()

        _set_rls_context(access_scope="customer", organization_id=org_a.id)
        assert Supplier.query.filter_by(organization_id=org_a.id).count() == 1
        assert Supplier.query.filter_by(organization_id=org_b.id).count() == 0

        rows = db.session.execute(text("select count(*) from suppliers where organization_id = :org_id"), {"org_id": org_b.id}).scalar_one()
        assert rows == 0


def test_rls_blocks_cross_tenant_insert_and_update(postgres_app):
    with postgres_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org_a = _create_org(owner, "RLS Insert Alpha")
        org_b = _create_org(owner, "RLS Insert Beta")

        _set_rls_context(access_scope="customer", organization_id=org_a.id)
        db.session.add(Supplier(organization_id=org_b.id, name="Wrong Org", normalized_name="wrong org"))
        with pytest.raises(Exception):
            db.session.commit()
        db.session.rollback()

        supplier = Supplier(organization_id=org_a.id, name="Right Org", normalized_name="right org")
        db.session.add(supplier)
        db.session.commit()

        db.session.execute(text("update suppliers set name = :name where id = :id"), {"name": "Changed", "id": supplier.id})
        db.session.commit()
        assert Supplier.query.filter_by(id=supplier.id).first().name == "Changed"

        _set_rls_context(access_scope="customer", organization_id=org_b.id)
        with pytest.raises(Exception):
            db.session.execute(text("update suppliers set name = :name where id = :id"), {"name": "Blocked", "id": supplier.id})
            db.session.commit()


def test_support_requires_active_grant(postgres_app):
    with postgres_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        support = User.query.filter_by(email="support@example.com").first()
        if support is None:
            support = User(email="support@example.com", is_active=True)
            support.set_password("Support123!")
            db.session.add(support)
            db.session.commit()
        org = _create_org(owner, "RLS Support Org")
        db.session.add(Supplier(organization_id=org.id, name="Support Supplier", normalized_name="support supplier"))
        db.session.commit()

        _set_rls_context(access_scope="support", organization_id=org.id, support_grant_id=None)
        assert Supplier.query.filter_by(organization_id=org.id).count() == 0

        grant = SupportAccessGrant(
            organization_id=org.id,
            support_user_id=support.id,
            reason="Investigate import issue",
            case_reference="CASE-123",
            status="active",
            starts_at=utc_now() - timedelta(minutes=1),
            expires_at=utc_now() + timedelta(minutes=30),
        )
        db.session.add(grant)
        db.session.commit()

        _set_rls_context(access_scope="support", organization_id=org.id, support_grant_id=grant.id)
        assert Supplier.query.filter_by(organization_id=org.id).count() == 1


def test_rls_protects_square_sales_tables(postgres_app):
    with postgres_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org_a = _create_org(owner, "RLS Square Alpha")
        org_b = _create_org(owner, "RLS Square Beta")
        connection_a = SquareConnection(organization_id=org_a.id, environment="sandbox", status="connected", square_merchant_id="merchant-a")
        connection_b = SquareConnection(organization_id=org_b.id, environment="sandbox", status="connected", square_merchant_id="merchant-b")
        db.session.add_all([connection_a, connection_b])
        db.session.flush()
        db.session.add(SquareOrder(square_connection_id=connection_a.id, square_order_id="order-a", square_location_id="LOC-A", order_state="COMPLETED"))
        db.session.add(SquareOrder(square_connection_id=connection_b.id, square_order_id="order-b", square_location_id="LOC-B", order_state="COMPLETED"))
        db.session.add(SquareDailySalesSummary(square_connection_id=connection_a.id, square_location_id="LOC-A", sale_date=utc_now().date()))
        db.session.add(SquareDailySalesSummary(square_connection_id=connection_b.id, square_location_id="LOC-B", sale_date=utc_now().date()))
        db.session.commit()

        _set_rls_context(access_scope="customer", organization_id=org_a.id)
        assert SquareOrder.query.filter_by(square_connection_id=connection_a.id).count() == 1
        assert SquareOrder.query.filter_by(square_connection_id=connection_b.id).count() == 0
        assert SquareDailySalesSummary.query.filter_by(square_connection_id=connection_a.id).count() == 1
        assert SquareDailySalesSummary.query.filter_by(square_connection_id=connection_b.id).count() == 0
