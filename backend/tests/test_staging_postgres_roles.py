from __future__ import annotations

import os
import secrets
import shutil
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool


def _postgres_url(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value.startswith("postgres"):
            return value
    return ""


ADMIN_POSTGRES_URL = _postgres_url("FLOWTALLY_TEST_POSTGRES_ADMIN_URL", "DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not ADMIN_POSTGRES_URL.startswith("postgres"),
    reason="PostgreSQL test database admin URL is not configured.",
)


def _admin_postgres_url() -> str:
    return _postgres_url("FLOWTALLY_TEST_POSTGRES_ADMIN_URL", "DATABASE_URL")


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


def _psql_command(url: str, *, database_name: str, migrator_password: str, runtime_password: str) -> list[str]:
    parsed = make_url(url)
    return [
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


def _rebuild_role_url(base_url: str, *, username: str, password: str) -> str:
    parsed = make_url(base_url)
    return parsed.set(username=username, password=password).render_as_string(hide_password=False)


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


def _restore_default_role_passwords(database_name: str, migrator_password: str, runtime_password: str) -> None:
    admin_url = _admin_postgres_url()
    if not admin_url:
        return
    _run_staging_role_script(
        database_name=database_name,
        migrator_password=migrator_password,
        runtime_password=runtime_password,
    )


def test_staging_postgres_role_provisioning_script_executes_with_temporary_passwords():
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
            _runtime_postgres_url() or ADMIN_POSTGRES_URL,
            username="flowtally_migrator",
            password=temporary_migrator_password,
        )
        temporary_runtime_url = _rebuild_role_url(
            _runtime_postgres_url() or ADMIN_POSTGRES_URL,
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

    finally:
        _restore_default_role_passwords(
            database_name,
            original_migrator_password,
            original_runtime_password,
        )
