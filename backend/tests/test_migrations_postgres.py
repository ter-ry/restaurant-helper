from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from backend.app import create_app
from backend.extensions import db


def _postgres_url(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value.startswith("postgres"):
            return value
    return ""


ADMIN_POSTGRES_URL = _postgres_url("FLOWTALLY_TEST_POSTGRES_ADMIN_URL", "DATABASE_URL")
MIGRATION_POSTGRES_URL = _postgres_url(
    "FLOWTALLY_MIGRATION_DATABASE_URL",
    "FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL",
    "FLOWTALLY_TEST_POSTGRES_ADMIN_URL",
    "FLOWTALLY_TEST_POSTGRES_URL",
    "DATABASE_URL",
)
RUNTIME_POSTGRES_URL = _postgres_url(
    "FLOWTALLY_TEST_POSTGRES_URL",
    "DATABASE_URL",
    "FLOWTALLY_MIGRATION_DATABASE_URL",
)
POSTGRES_URL = RUNTIME_POSTGRES_URL or MIGRATION_POSTGRES_URL

pytestmark = pytest.mark.skipif(
    not POSTGRES_URL.startswith("postgres"),
    reason="PostgreSQL test database is not configured.",
)


def _runtime_postgres_url() -> str:
    return _postgres_url("FLOWTALLY_TEST_POSTGRES_URL", "DATABASE_URL", "FLOWTALLY_MIGRATION_DATABASE_URL")


def _migration_postgres_url() -> str:
    return _postgres_url(
        "FLOWTALLY_MIGRATION_DATABASE_URL",
        "FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL",
        "FLOWTALLY_TEST_POSTGRES_ADMIN_URL",
        "FLOWTALLY_TEST_POSTGRES_URL",
        "DATABASE_URL",
    )


def _admin_postgres_url() -> str:
    return _postgres_url("FLOWTALLY_TEST_POSTGRES_ADMIN_URL", "DATABASE_URL")


def _create_app():
    runtime_url = _runtime_postgres_url() or POSTGRES_URL
    return create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": runtime_url,
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


def _log_connection_state(connection, label: str) -> None:
    snapshot = connection.execute(
        text(
            """
            select
                current_user,
                session_user,
                current_role,
                current_database() as current_database,
                pg_backend_pid() as backend_pid,
                datname,
                pg_get_userbyid(datdba) as database_owner,
                has_database_privilege(current_user, current_database(), 'CREATE') as can_create
            from pg_database
            where datname = current_database()
            """
        )
    ).mappings().one()
    print(f"STATE: {label} -> {dict(snapshot)}", flush=True)


def _schema_owner(connection, schema_name: str) -> str:
    return connection.execute(
        text(
            """
            select pg_get_userbyid(nspowner)
            from pg_namespace
            where nspname = :schema_name
            """
        ),
        {"schema_name": schema_name},
    ).scalar_one()


def _table_owner(connection, table_name: str) -> str:
    return connection.execute(
        text(
            """
            select pg_get_userbyid(c.relowner)
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname = :table_name
            """
        ),
        {"table_name": table_name},
    ).scalar_one()


def _pg_role_flags(connection, role_name: str) -> tuple[bool, bool, bool]:
    return connection.execute(
        text(
            """
            select rolsuper, rolbypassrls, rolcanlogin
            from pg_roles
            where rolname = :role_name
            """
        ),
        {"role_name": role_name},
    ).one()


def _assert_login_identity(connection, role_name: str) -> None:
    identity = connection.execute(
        text(
            """
            select current_user, session_user, current_role
            """
        )
    ).one()
    assert identity[0] == role_name, f"expected login as {role_name!r}, got {identity!r}"
    assert identity[1] == role_name, f"expected session user {role_name!r}, got {identity!r}"
    assert identity[2] == role_name, f"expected current role {role_name!r}, got {identity!r}"


def _assert_runtime_schema_usage(connection) -> None:
    has_usage = connection.execute(
        text(
            """
            select has_schema_privilege('flowtally_runtime', 'public', 'USAGE')
            """
        )
    ).scalar_one()
    assert has_usage is True, "expected flowtally_runtime to have USAGE on schema public"


def _restore_runtime_schema_privileges(connection) -> None:
    print("BEFORE: restore runtime schema privileges", flush=True)
    connection.exec_driver_sql("revoke all on schema public from public")
    connection.exec_driver_sql("grant usage on schema public to flowtally_runtime")
    connection.exec_driver_sql("grant select, insert, update, delete on all tables in schema public to flowtally_runtime")
    connection.exec_driver_sql("grant usage, select on all sequences in schema public to flowtally_runtime")
    connection.exec_driver_sql("grant execute on all functions in schema public to flowtally_runtime")
    connection.exec_driver_sql(
        """
        alter default privileges for role flowtally_migrator in schema public
            grant select, insert, update, delete on tables to flowtally_runtime
        """
    )
    connection.exec_driver_sql(
        """
        alter default privileges for role flowtally_migrator in schema public
            grant usage, select on sequences to flowtally_runtime
        """
    )
    connection.exec_driver_sql(
        """
        alter default privileges for role flowtally_migrator in schema public
            grant execute on functions to flowtally_runtime
        """
    )
    print("AFTER: restore runtime schema privileges", flush=True)


def _reset_public_schema(application) -> None:
    admin_url = _admin_postgres_url()
    if not admin_url:
        raise RuntimeError("FLOWTALLY_TEST_POSTGRES_ADMIN_URL is required for migration bootstrap reset")

    admin_engine = create_engine(admin_url, poolclass=NullPool)
    with admin_engine.begin() as connection:
        print("BEFORE: reset_public_schema connection state", flush=True)
        _log_connection_state(connection, "reset_public_schema connection state")
        print("BEFORE: drop schema if exists public cascade", flush=True)
        connection.exec_driver_sql("drop schema if exists public cascade")
        print("AFTER: drop schema if exists public cascade", flush=True)
        print("BEFORE: create schema public authorization flowtally_migrator", flush=True)
        _log_connection_state(connection, "before create schema public")
        connection.exec_driver_sql("create schema public authorization flowtally_migrator")
        print("AFTER: create schema public authorization flowtally_migrator", flush=True)
        assert _schema_owner(connection, "public") == "flowtally_migrator"
        print("STATE: public schema owner -> flowtally_migrator", flush=True)
        _restore_runtime_schema_privileges(connection)
        _assert_runtime_schema_usage(connection)


def _upgrade_to(application, revision: str) -> Config:
    config = _alembic_config(application)
    with application.app_context():
        command.upgrade(config, revision)
    return config


def _downgrade_to(application, revision: str) -> Config:
    config = _alembic_config(application)
    with application.app_context():
        command.downgrade(config, revision)
    return config


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


def _assert_runtime_connection() -> None:
    identity = db.session.execute(
        text(
            """
            select
                current_user,
                session_user,
                current_role
            """
        )
    ).one()
    assert identity[0] == "flowtally_runtime", f"expected runtime connection, got {identity!r}"
    assert identity[1] == "flowtally_runtime", f"expected runtime connection, got {identity!r}"
    assert identity[2] == "flowtally_runtime", f"expected runtime connection, got {identity!r}"


def _assert_migration_identity(config: Config) -> None:
    identity = config.attributes.get("flowtally_migration_identity")
    assert identity == ("flowtally_migrator", "flowtally_migrator"), f"migration identity snapshot: {identity!r}"


def _assert_table_owned_by_migrator(table_name: str) -> None:
    with db.engine.connect() as connection:
        assert _table_owner(connection, table_name) == "flowtally_migrator"


def test_postgres_migrations_upgrade_from_fresh_database():
    application = _create_app()
    _reset_public_schema(application)
    migration_config = _upgrade_to(application, "head")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0013_menu_items_and_recipes"
        _assert_table_owned_by_migrator("suppliers")
        _assert_policy_exists("flowtally_organizations_tenant_access", "organizations")
        _assert_policy_exists("flowtally_suppliers_tenant_access", "suppliers")
        _assert_policy_exists("flowtally_data_import_jobs_tenant_access", "data_import_jobs")
        _assert_policy_exists("flowtally_square_orders_tenant_access", "square_orders")
        _assert_policy_exists("flowtally_support_access_grants_select_access", "support_access_grants")
        _assert_policy_exists("flowtally_menu_items_tenant_access", "menu_items")
        _assert_policy_exists("flowtally_menu_recipes_tenant_access", "menu_recipes")
        _assert_policy_exists("flowtally_menu_recipe_lines_tenant_access", "menu_recipe_lines")


def test_postgres_migrations_upgrade_from_secure_backend_head():
    application = _create_app()
    _reset_public_schema(application)
    migration_config = _upgrade_to(application, "0006_audit_events_and_tenant_constraints")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0006_audit_events_and_tenant_constraints"

    migration_config = _upgrade_to(application, "head")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0013_menu_items_and_recipes"
        _assert_table_owned_by_migrator("audit_events")
        _assert_policy_exists("flowtally_audit_events_tenant_access", "audit_events")


def test_postgres_migrations_upgrade_from_partial_commercial_head():
    application = _create_app()
    _reset_public_schema(application)
    migration_config = _upgrade_to(application, "0007_commercial_onboarding_and_square_foundation")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0007_commercial_onboarding_and_square_foundation"

    migration_config = _upgrade_to(application, "head")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0013_menu_items_and_recipes"
        _assert_table_owned_by_migrator("square_location_mappings")
        _assert_policy_exists("flowtally_menu_items_tenant_access", "menu_items")
        _assert_policy_exists("flowtally_menu_recipes_tenant_access", "menu_recipes")
        _assert_policy_exists("flowtally_menu_recipe_lines_tenant_access", "menu_recipe_lines")

    migration_config = _downgrade_to(application, "0007_commercial_onboarding_and_square_foundation")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0007_commercial_onboarding_and_square_foundation"

    migration_config = _upgrade_to(application, "head")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0013_menu_items_and_recipes"
        _assert_policy_exists("flowtally_square_location_mappings_tenant_access", "square_location_mappings")
