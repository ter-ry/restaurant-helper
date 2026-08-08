from __future__ import annotations

import os
import importlib.util
from datetime import timedelta

import pytest
from sqlalchemy import text

from backend.app import create_app
from backend.extensions import db
from backend.models import (
    DataImportChange,
    DataImportFile,
    DataImportJob,
    DataImportIssue,
    DataImportMapping,
    DataImportRow,
    Organization,
    OrganizationMembership,
    OrganizationModule,
    RestaurantLocation,
    SquareConnection,
    SquareDailySalesSummary,
    SquareOrder,
    SupportAccessGrant,
    Supplier,
    User,
)
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
apply_postgres_rls = _rls_module.apply_postgres_rls

_square_rls_spec = importlib.util.spec_from_file_location(
    "backend.migrations.versions.0011_postgres_row_level_security_square_orders",
    os.path.join(os.path.dirname(__file__), "..", "migrations", "versions", "0011_postgres_row_level_security_square_orders.py"),
)
assert _square_rls_spec and _square_rls_spec.loader
_square_rls_module = importlib.util.module_from_spec(_square_rls_spec)
_square_rls_spec.loader.exec_module(_square_rls_module)
square_apply_postgres_rls = _square_rls_module.apply_postgres_rls

_support_rls_spec = importlib.util.spec_from_file_location(
    "backend.migrations.versions.0012_fix_support_access_grant_rls_recursion",
    os.path.join(os.path.dirname(__file__), "..", "migrations", "versions", "0012_fix_support_access_grant_rls_recursion.py"),
)
assert _support_rls_spec and _support_rls_spec.loader
_support_rls_module = importlib.util.module_from_spec(_support_rls_spec)
_support_rls_spec.loader.exec_module(_support_rls_module)
support_apply_postgres_rls = _support_rls_module.apply_postgres_rls


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
        with db.engine.begin() as connection:
            apply_postgres_rls(connection)
            square_apply_postgres_rls(connection)
            support_apply_postgres_rls(connection)
        db.session.execute(text("set statement_timeout = '5s'"))
        yield application
        db.session.remove()
        db.drop_all()


def _set_rls_context(*, access_scope: str, organization_id: int | None = None, support_grant_id: int | None = None) -> None:
    db.session.execute(
        text("select set_config(:name, :value, true)"),
        {"name": "flowtally.access_scope", "value": access_scope},
    )
    db.session.execute(
        text("select set_config(:name, :value, true)"),
        {"name": "flowtally.organization_id", "value": "" if organization_id is None else str(organization_id)},
    )
    db.session.execute(
        text("select set_config(:name, :value, true)"),
        {"name": "flowtally.support_grant_id", "value": "" if support_grant_id is None else str(support_grant_id)},
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


def _restore_rls_context(access_scope: str, organization_id: int | None = None, support_grant_id: int | None = None) -> None:
    _set_rls_context(access_scope=access_scope, organization_id=organization_id, support_grant_id=support_grant_id)


def test_rls_hides_other_tenant_rows(postgres_app):
    with postgres_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        assert db.session.execute(text("show statement_timeout")).scalar_one() in {"5s", "5000ms"}
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
        _restore_rls_context("customer", organization_id=org_a.id)

        _set_rls_context(access_scope="customer", organization_id=org_a.id)
        supplier = Supplier(organization_id=org_a.id, name="Right Org", normalized_name="right org")
        db.session.add(supplier)
        db.session.commit()

        _set_rls_context(access_scope="customer", organization_id=org_a.id)
        db.session.execute(text("update suppliers set name = :name where id = :id"), {"name": "Changed", "id": supplier.id})
        db.session.commit()
        _set_rls_context(access_scope="customer", organization_id=org_a.id)
        assert Supplier.query.filter_by(id=supplier.id).first().name == "Changed"

        _set_rls_context(access_scope="customer", organization_id=org_b.id)
        with pytest.raises(Exception):
            db.session.execute(text("update suppliers set name = :name where id = :id"), {"name": "Blocked", "id": supplier.id})
            db.session.commit()
        db.session.rollback()


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


def test_support_access_grants_are_not_recursive_and_respect_scope(postgres_app):
    with postgres_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        support = User.query.filter_by(email="support-rls@example.com").first()
        if support is None:
            support = User(email="support-rls@example.com", is_active=True)
            support.set_password("Support123!")
            db.session.add(support)
            db.session.commit()

        org_a = _create_org(owner, "RLS Support Grant Alpha")
        org_b = _create_org(owner, "RLS Support Grant Beta")
        db.session.add_all(
            [
                Supplier(organization_id=org_a.id, name="Alpha Supplier", normalized_name="alpha supplier"),
                Supplier(organization_id=org_b.id, name="Beta Supplier", normalized_name="beta supplier"),
            ]
        )
        db.session.commit()

        active_grant = SupportAccessGrant(
            organization_id=org_a.id,
            support_user_id=support.id,
            reason="Investigate alpha",
            case_reference="CASE-ALPHA",
            status="active",
            starts_at=utc_now() - timedelta(minutes=1),
            expires_at=utc_now() + timedelta(minutes=30),
        )
        expired_grant = SupportAccessGrant(
            organization_id=org_b.id,
            support_user_id=support.id,
            reason="Investigate beta",
            case_reference="CASE-BETA",
            status="active",
            starts_at=utc_now() - timedelta(hours=2),
            expires_at=utc_now() - timedelta(minutes=1),
        )
        revoked_grant = SupportAccessGrant(
            organization_id=org_a.id,
            support_user_id=support.id,
            reason="Investigate revoked",
            case_reference="CASE-REVOKED",
            status="revoked",
            starts_at=utc_now() - timedelta(minutes=5),
            expires_at=utc_now() + timedelta(minutes=30),
            revoked_at=utc_now() - timedelta(minutes=1),
        )
        db.session.add_all([active_grant, expired_grant, revoked_grant])
        db.session.commit()

        _set_rls_context(access_scope="support", organization_id=org_a.id, support_grant_id=active_grant.id)
        assert Supplier.query.filter_by(organization_id=org_a.id).count() == 1
        assert Supplier.query.filter_by(organization_id=org_b.id).count() == 0

        _set_rls_context(access_scope="support", organization_id=org_b.id, support_grant_id=expired_grant.id)
        assert Supplier.query.filter_by(organization_id=org_b.id).count() == 0

        _set_rls_context(access_scope="support", organization_id=org_a.id, support_grant_id=revoked_grant.id)
        assert Supplier.query.filter_by(organization_id=org_a.id).count() == 0

        _set_rls_context(access_scope="support", organization_id=org_a.id, support_grant_id=active_grant.id)
        with pytest.raises(Exception):
            db.session.add(
                SupportAccessGrant(
                    organization_id=org_a.id,
                    support_user_id=support.id,
                    reason="Self create attempt",
                    case_reference="CASE-CREATE",
                    status="active",
                    starts_at=utc_now(),
                    expires_at=utc_now() + timedelta(minutes=10),
                )
            )
            db.session.commit()
        db.session.rollback()

        with pytest.raises(Exception):
            active_grant.expires_at = active_grant.expires_at + timedelta(minutes=10)
            db.session.commit()
        db.session.rollback()

        with pytest.raises(Exception):
            active_grant.organization_id = org_b.id
            db.session.commit()
        db.session.rollback()

        _set_rls_context(access_scope="customer", organization_id=org_a.id)
        with pytest.raises(Exception):
            db.session.add(
                SupportAccessGrant(
                    organization_id=org_a.id,
                    support_user_id=support.id,
                    reason="Customer create attempt",
                    case_reference="CASE-CUSTOMER",
                    status="active",
                    starts_at=utc_now(),
                    expires_at=utc_now() + timedelta(minutes=10),
                )
            )
            db.session.commit()
        db.session.rollback()

        with pytest.raises(Exception):
            active_grant.revoked_at = utc_now()
            db.session.commit()
        db.session.rollback()

        _set_rls_context(access_scope="setup")
        setup_grant = SupportAccessGrant(
            organization_id=org_b.id,
            support_user_id=support.id,
            reason="Setup access",
            case_reference="CASE-SETUP",
            status="active",
            starts_at=utc_now() - timedelta(minutes=1),
            expires_at=utc_now() + timedelta(minutes=30),
        )
        db.session.add(setup_grant)
        db.session.commit()
        setup_grant.reason = "Setup access updated"
        db.session.commit()
        setup_grant.revoked_at = utc_now()
        setup_grant.status = "revoked"
        db.session.commit()


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


def test_rls_covers_import_tables_and_selected_organization_views(postgres_app):
    with postgres_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org_a = _create_org(owner, "RLS Import Alpha")
        org_b = _create_org(owner, "RLS Import Beta")

        job_a = DataImportJob(
            organization_id=org_a.id,
            created_by_user_id=owner.id,
            source_type="csv",
            source_file_name="suppliers-alpha.csv",
            source_file_extension=".csv",
            source_mime_type="text/csv",
            source_hash="hash-a",
            storage_path="/tmp/a",
            status="APPROVED",
            entity_scope="supplier",
            mapping_json={"name": "name"},
            summary_json={"rows": 1},
            row_count=1,
            preview_row_count=1,
            applied_row_count=0,
            blocked_row_count=0,
            warning_count=0,
            batch_id="batch-a",
        )
        job_b = DataImportJob(
            organization_id=org_b.id,
            created_by_user_id=owner.id,
            source_type="xlsx",
            source_file_name="suppliers-beta.xlsx",
            source_file_extension=".xlsx",
            source_mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            source_hash="hash-b",
            storage_path="/tmp/b",
            status="UPLOADED",
            entity_scope="supplier",
            mapping_json={"name": "name"},
            summary_json={"rows": 1},
            row_count=1,
            preview_row_count=0,
            applied_row_count=0,
            blocked_row_count=0,
            warning_count=0,
            batch_id="batch-b",
        )
        db.session.add_all([job_a, job_b])
        db.session.flush()
        db.session.add(DataImportFile(data_import_job_id=job_a.id, role="source", original_file_name="suppliers-alpha.csv", storage_path="/tmp/a.csv", sha256="file-a", byte_size=12, mime_type="text/csv"))
        db.session.add(DataImportMapping(data_import_job_id=job_a.id, source_column_name="Name", target_field_name="name", mapping_type="manual", display_order=1, is_required=True))
        row_a = DataImportRow(data_import_job_id=job_a.id, row_number=1, entity_type="supplier", source_row_json={"Name": "Alpha Supplier"}, normalized_row_json={"name": "Alpha Supplier"}, row_fingerprint="row-a", status="preview", target_entity_type="supplier", target_entity_id="", issue_summary="", warning_count=0, blocked_count=0, can_rollback=True)
        row_b = DataImportRow(data_import_job_id=job_b.id, row_number=1, entity_type="supplier", source_row_json={"Name": "Beta Supplier"}, normalized_row_json={"name": "Beta Supplier"}, row_fingerprint="row-b", status="preview", target_entity_type="supplier", target_entity_id="", issue_summary="", warning_count=0, blocked_count=0, can_rollback=True)
        db.session.add_all([row_a, row_b])
        db.session.flush()
        db.session.add(DataImportIssue(data_import_row_id=row_a.id, severity="warning", field_name="name", code="missing_note", message="Name mapped but notes missing"))
        db.session.add(DataImportChange(data_import_job_id=job_a.id, data_import_row_id=row_a.id, entity_type="supplier", change_type="create", target_entity_id="supplier-alpha", row_fingerprint="change-a", previous_json={}, applied_json={"name": "Alpha Supplier"}, rollbackable=True, status="preview"))
        db.session.commit()

        _set_rls_context(access_scope="customer", organization_id=org_a.id)
        assert DataImportJob.query.filter_by(organization_id=org_a.id).count() == 1
        assert DataImportJob.query.filter_by(organization_id=org_b.id).count() == 0
        assert DataImportFile.query.join(DataImportJob).filter(DataImportJob.organization_id == org_a.id).count() == 1
        assert DataImportRow.query.join(DataImportJob).filter(DataImportJob.organization_id == org_a.id).count() == 1
        assert DataImportRow.query.join(DataImportJob).filter(DataImportJob.organization_id == org_b.id).count() == 0
        assert DataImportIssue.query.join(DataImportRow).join(DataImportJob).filter(DataImportJob.organization_id == org_a.id).count() == 1
        assert DataImportChange.query.join(DataImportJob).filter(DataImportJob.organization_id == org_a.id).count() == 1
        assert OrganizationMembership.query.filter_by(user_id=owner.id).count() == 1

        rows = db.session.execute(text("select count(*) from data_import_jobs where organization_id = :org_id"), {"org_id": org_b.id}).scalar_one()
        assert rows == 0

        _set_rls_context(access_scope="customer", organization_id=org_b.id)
        assert OrganizationMembership.query.filter_by(user_id=owner.id).count() == 1
        assert DataImportJob.query.filter_by(organization_id=org_b.id).count() == 1


def test_setup_scope_can_access_platform_data_across_organizations(postgres_app):
    with postgres_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org_a = _create_org(owner, "RLS Setup Alpha")
        org_b = _create_org(owner, "RLS Setup Beta")
        db.session.add_all(
            [
                Supplier(organization_id=org_a.id, name="Alpha Supplier", normalized_name="alpha supplier"),
                Supplier(organization_id=org_b.id, name="Beta Supplier", normalized_name="beta supplier"),
                DataImportJob(
                    organization_id=org_a.id,
                    created_by_user_id=owner.id,
                    source_type="csv",
                    source_file_name="setup-alpha.csv",
                    source_file_extension=".csv",
                    source_mime_type="text/csv",
                    source_hash="setup-a",
                    storage_path="/tmp/setup-a",
                    status="UPLOADED",
                    entity_scope="supplier",
                    mapping_json={},
                    summary_json={},
                    row_count=0,
                    preview_row_count=0,
                    applied_row_count=0,
                    blocked_row_count=0,
                    warning_count=0,
                    batch_id="setup-a",
                ),
                DataImportJob(
                    organization_id=org_b.id,
                    created_by_user_id=owner.id,
                    source_type="xlsx",
                    source_file_name="setup-beta.xlsx",
                    source_file_extension=".xlsx",
                    source_mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    source_hash="setup-b",
                    storage_path="/tmp/setup-b",
                    status="UPLOADED",
                    entity_scope="supplier",
                    mapping_json={},
                    summary_json={},
                    row_count=0,
                    preview_row_count=0,
                    applied_row_count=0,
                    blocked_row_count=0,
                    warning_count=0,
                    batch_id="setup-b",
                ),
            ]
        )
        db.session.commit()

        _set_rls_context(access_scope="setup")
        assert Organization.query.filter_by(id=org_a.id).count() == 1
        assert Organization.query.filter_by(id=org_b.id).count() == 1
        assert Supplier.query.count() == 2
        assert DataImportJob.query.count() == 2
        assert db.session.execute(text("select count(*) from organizations")).scalar_one() >= 2
