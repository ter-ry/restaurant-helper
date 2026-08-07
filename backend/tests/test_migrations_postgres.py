from __future__ import annotations

import os

import pytest
from sqlalchemy import text

from backend.app import create_app
from backend.extensions import db


POSTGRES_URL = os.environ.get("FLOWTALLY_TEST_POSTGRES_URL") or os.environ.get("DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not POSTGRES_URL.startswith("postgres"),
    reason="PostgreSQL test database is not configured.",
)


def _create_app():
    return create_app(
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


def _assert_policy_exists(policy_name: str, table_name: str) -> None:
    row = db.session.execute(
        text(
            """
            select count(*)
            from pg_policies
            where schemaname = current_schema()
              and tablename = :table_name
              and policyname = :policy_name
            """
        ),
        {"table_name": table_name, "policy_name": policy_name},
    ).scalar_one()
    assert row == 1


def _current_revision() -> str:
    return db.session.execute(text("select version_num from alembic_version")).scalar_one()


def test_postgres_migrations_upgrade_from_fresh_database():
    application = _create_app()
    with application.app_context():
        runner = application.test_cli_runner()
        result = runner.invoke(args=["db", "upgrade"])
        assert result.exit_code == 0, result.output
        assert _current_revision() == "0011_postgres_row_level_security_square_orders"
        _assert_policy_exists("flowtally_organizations_tenant_access", "organizations")
        _assert_policy_exists("flowtally_suppliers_tenant_access", "suppliers")
        _assert_policy_exists("flowtally_data_import_jobs_tenant_access", "data_import_jobs")
        _assert_policy_exists("flowtally_square_orders_tenant_access", "square_orders")


def test_postgres_migrations_upgrade_from_secure_backend_head():
    application = _create_app()
    with application.app_context():
        runner = application.test_cli_runner()
        result = runner.invoke(args=["db", "upgrade", "0006_audit_events_and_tenant_constraints"])
        assert result.exit_code == 0, result.output
        assert _current_revision() == "0006_audit_events_and_tenant_constraints"

        result = runner.invoke(args=["db", "upgrade"])
        assert result.exit_code == 0, result.output
        assert _current_revision() == "0011_postgres_row_level_security_square_orders"
        _assert_policy_exists("flowtally_audit_events_tenant_access", "audit_events")


def test_postgres_migrations_upgrade_from_partial_commercial_head():
    application = _create_app()
    with application.app_context():
        runner = application.test_cli_runner()
        result = runner.invoke(args=["db", "upgrade", "0007_commercial_onboarding_and_square_foundation"])
        assert result.exit_code == 0, result.output
        assert _current_revision() == "0007_commercial_onboarding_and_square_foundation"

        result = runner.invoke(args=["db", "upgrade"])
        assert result.exit_code == 0, result.output
        assert _current_revision() == "0011_postgres_row_level_security_square_orders"

        result = runner.invoke(args=["db", "downgrade", "0007_commercial_onboarding_and_square_foundation"])
        assert result.exit_code == 0, result.output
        assert _current_revision() == "0007_commercial_onboarding_and_square_foundation"

        result = runner.invoke(args=["db", "upgrade"])
        assert result.exit_code == 0, result.output
        assert _current_revision() == "0011_postgres_row_level_security_square_orders"
        _assert_policy_exists("flowtally_square_location_mappings_tenant_access", "square_location_mappings")
