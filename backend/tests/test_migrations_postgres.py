from __future__ import annotations

import os
import secrets
import shutil
import subprocess
from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
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


def _psql_command(url: str, *, database_name: str, migrator_password: str, runtime_password: str) -> list[str]:
    parsed = make_url(url)
    command_parts = [
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        f"database_name={database_name}",
        "-v",
        f"migrator_password={migrator_password}",
        "-v",
        f"runtime_password={runtime_password}",
        "-f",
        str((Path(__file__).resolve().parents[2] / "scripts" / "provision_postgres_roles_staging.sql").resolve()),
        "-h",
        parsed.host or "localhost",
        "-p",
        str(parsed.port or 5432),
        "-U",
        parsed.username or "postgres",
        "-d",
        parsed.database or database_name,
    ]
    return command_parts


def _run_staging_role_script(*, database_name: str, migrator_password: str, runtime_password: str) -> None:
    if not shutil.which("psql"):
        pytest.skip("psql is required for the staging provisioning acceptance test.")

    admin_url = _admin_postgres_url()
    if not admin_url:
        raise RuntimeError("FLOWTALLY_TEST_POSTGRES_ADMIN_URL is required for staging provisioning acceptance tests")

    command_parts = _psql_command(
        admin_url,
        database_name=database_name,
        migrator_password=migrator_password,
        runtime_password=runtime_password,
    )
    parsed = make_url(admin_url)
    env = os.environ.copy()
    if parsed.password:
        env["PGPASSWORD"] = parsed.password

    print(f"BEFORE: staging provisioning script for database {database_name}", flush=True)
    result = subprocess.run(command_parts, env=env, capture_output=True, text=True)
    print(result.stdout, end="" if result.stdout.endswith("\n") else "\n", flush=True)
    if result.returncode != 0:
        print(result.stderr, end="" if result.stderr.endswith("\n") else "\n", flush=True)
    assert result.returncode == 0, f"staging provisioning script failed with exit code {result.returncode}"
    print("AFTER: staging provisioning script", flush=True)


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


def _rebuild_role_url(base_url: str, *, username: str, password: str) -> str:
    parsed = make_url(base_url)
    return parsed.set(username=username, password=password).render_as_string(hide_password=False)


def _restore_default_role_passwords(database_name: str, migrator_password: str, runtime_password: str) -> None:
    admin_url = _admin_postgres_url()
    if not admin_url:
        return
    _run_staging_role_script(
        database_name=database_name,
        migrator_password=migrator_password,
        runtime_password=runtime_password,
    )


def test_staging_postgres_role_provisioning_script_executes_with_temporary_passwords(monkeypatch: pytest.MonkeyPatch):
    admin_url = _admin_postgres_url()
    if not admin_url:
        pytest.skip("staging provisioning acceptance test requires an admin PostgreSQL URL.")

    database_name = make_url(admin_url).database
    if not database_name:
        pytest.skip("staging provisioning acceptance test requires a database name.")

    original_migrator_password = make_url(_migration_postgres_url() or admin_url).password or "flowtally_migrator"
    original_runtime_password = make_url(_runtime_postgres_url() or admin_url).password or "flowtally_runtime"
    temporary_migrator_password = f"migrator-{secrets.token_urlsafe(24)}"
    temporary_runtime_password = f"runtime-{secrets.token_urlsafe(24)}"

    try:
        _run_staging_role_script(
            database_name=database_name,
            migrator_password=temporary_migrator_password,
            runtime_password=temporary_runtime_password,
        )

        temporary_migrator_url = _rebuild_role_url(
            _runtime_postgres_url() or POSTGRES_URL,
            username="flowtally_migrator",
            password=temporary_migrator_password,
        )
        temporary_runtime_url = _rebuild_role_url(
            _runtime_postgres_url() or POSTGRES_URL,
            username="flowtally_runtime",
            password=temporary_runtime_password,
        )

        migrator_engine = create_engine(temporary_migrator_url, poolclass=NullPool)
        runtime_engine = create_engine(temporary_runtime_url, poolclass=NullPool)

        with migrator_engine.connect() as connection:
            _assert_login_identity(connection, "flowtally_migrator")
            role_flags = _pg_role_flags(connection, "flowtally_migrator")
            assert role_flags[0] is False
            assert role_flags[1] is False
            assert role_flags[2] is True

        with runtime_engine.connect() as connection:
            _assert_login_identity(connection, "flowtally_runtime")
            role_flags = _pg_role_flags(connection, "flowtally_runtime")
            assert role_flags[0] is False
            assert role_flags[1] is False
            assert role_flags[2] is True

        monkeypatch.setenv("FLOWTALLY_MIGRATION_DATABASE_URL", temporary_migrator_url)
        monkeypatch.setenv("FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL", temporary_migrator_url)
        monkeypatch.setenv("FLOWTALLY_TEST_POSTGRES_URL", temporary_runtime_url)
        monkeypatch.setenv("DATABASE_URL", temporary_runtime_url)

        application = _create_app()
        _reset_public_schema(application)
        migration_config = _upgrade_to(application, "head")

        with application.app_context():
            _assert_migration_identity(migration_config)
            _assert_runtime_connection()
            assert _current_revision() == "0012_fix_support_access_grant_rls_recursion"
            _assert_table_owned_by_migrator("suppliers")
            _assert_policy_exists("flowtally_organizations_tenant_access", "organizations")
            _assert_policy_exists("flowtally_suppliers_tenant_access", "suppliers")
            _assert_policy_exists("flowtally_data_import_jobs_tenant_access", "data_import_jobs")
            _assert_policy_exists("flowtally_square_orders_tenant_access", "square_orders")
            _assert_policy_exists("flowtally_support_access_grants_select_access", "support_access_grants")
    finally:
        _restore_default_role_passwords(
            database_name,
            original_migrator_password,
            original_runtime_password,
        )


def test_postgres_migrations_upgrade_from_fresh_database():
    application = _create_app()
    _reset_public_schema(application)
    migration_config = _upgrade_to(application, "head")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0012_fix_support_access_grant_rls_recursion"
        _assert_table_owned_by_migrator("suppliers")
        _assert_policy_exists("flowtally_organizations_tenant_access", "organizations")
        _assert_policy_exists("flowtally_suppliers_tenant_access", "suppliers")
        _assert_policy_exists("flowtally_data_import_jobs_tenant_access", "data_import_jobs")
        _assert_policy_exists("flowtally_square_orders_tenant_access", "square_orders")
        _assert_policy_exists("flowtally_support_access_grants_select_access", "support_access_grants")


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
        assert _current_revision() == "0012_fix_support_access_grant_rls_recursion"
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
        assert _current_revision() == "0012_fix_support_access_grant_rls_recursion"
        _assert_table_owned_by_migrator("square_location_mappings")

    migration_config = _downgrade_to(application, "0007_commercial_onboarding_and_square_foundation")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0007_commercial_onboarding_and_square_foundation"

    migration_config = _upgrade_to(application, "head")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0012_fix_support_access_grant_rls_recursion"
        _assert_policy_exists("flowtally_square_location_mappings_tenant_access", "square_location_mappings")
