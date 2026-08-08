from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config
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


def _alembic_config(application) -> Config:
    config = Config()
    config.set_main_option("script_location", str((Path(__file__).resolve().parents[1] / "migrations").resolve()))
    config.set_main_option("sqlalchemy.url", application.config["SQLALCHEMY_DATABASE_URI"])
    return config


def _reset_public_schema(application) -> None:
    with application.app_context():
        db.session.execute(text("drop schema if exists public cascade"))
        db.session.execute(text("create schema public"))
        db.session.commit()


def _upgrade_to(application, revision: str) -> None:
    with application.app_context():
        command.upgrade(_alembic_config(application), revision)


def _downgrade_to(application, revision: str) -> None:
    with application.app_context():
        command.downgrade(_alembic_config(application), revision)


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
    return db.session.execute(text("select version_num from public.alembic_version")).scalar_one()


def test_postgres_migrations_upgrade_from_fresh_database():
    application = _create_app()
    _reset_public_schema(application)
    _upgrade_to(application, "head")
    with application.app_context():
        assert _current_revision() == "0012_fix_support_access_grant_rls_recursion"
        _assert_policy_exists("flowtally_organizations_tenant_access", "organizations")
        _assert_policy_exists("flowtally_suppliers_tenant_access", "suppliers")
        _assert_policy_exists("flowtally_data_import_jobs_tenant_access", "data_import_jobs")
        _assert_policy_exists("flowtally_square_orders_tenant_access", "square_orders")
        _assert_policy_exists("flowtally_support_access_grants_select_access", "support_access_grants")


def test_postgres_migrations_upgrade_from_secure_backend_head():
    application = _create_app()
    _reset_public_schema(application)
    _upgrade_to(application, "0006_audit_events_and_tenant_constraints")
    with application.app_context():
        assert _current_revision() == "0006_audit_events_and_tenant_constraints"

    _upgrade_to(application, "head")
    with application.app_context():
        assert _current_revision() == "0012_fix_support_access_grant_rls_recursion"
        _assert_policy_exists("flowtally_audit_events_tenant_access", "audit_events")


def test_postgres_migrations_upgrade_from_partial_commercial_head():
    application = _create_app()
    _reset_public_schema(application)
    _upgrade_to(application, "0007_commercial_onboarding_and_square_foundation")
    with application.app_context():
        assert _current_revision() == "0007_commercial_onboarding_and_square_foundation"

    _upgrade_to(application, "head")
    with application.app_context():
        assert _current_revision() == "0012_fix_support_access_grant_rls_recursion"

    _downgrade_to(application, "0007_commercial_onboarding_and_square_foundation")
    with application.app_context():
        assert _current_revision() == "0007_commercial_onboarding_and_square_foundation"

    _upgrade_to(application, "head")
    with application.app_context():
        assert _current_revision() == "0012_fix_support_access_grant_rls_recursion"
        _assert_policy_exists("flowtally_square_location_mappings_tenant_access", "square_location_mappings")
