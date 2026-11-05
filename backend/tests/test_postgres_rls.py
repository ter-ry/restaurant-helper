from __future__ import annotations

import importlib.util
import os
import threading
import time
from pathlib import Path
from decimal import Decimal
from datetime import datetime, timedelta, timezone
import textwrap
from uuid import uuid4

import pytest
from flask import g
from alembic import command as alembic_command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.pool import NullPool

from backend.app import create_app
from backend.extensions import db
from backend.models import (
    AuditEvent,
    CloverConnection,
    DataImportChange,
    DataImportFile,
    DataImportJob,
    DataImportIssue,
    DataImportMapping,
    DataImportRow,
    DashboardLayout,
    InventoryItem,
    Organization,
    OrganizationMembership,
    PlatformRole,
    OrganizationModule,
    OrganizationConfiguration,
    DailyCloseSession,
    MenuItem,
    Recipe,
    RecipeIngredient,
    RestaurantLocation,
    SquareConnection,
    SquareDailySalesSummary,
    SquareLocation,
    SquareLocationMapping,
    SquareOrder,
    SupportAccessGrant,
    Supplier,
    User,
)
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD, seed_pilot_data
from backend.tests.conftest import make_operational_organization
from backend.tests.test_square_integration import configure_square, oauth_responder
from backend.utils import utc_now
from backend.clover_inventory import apply_clover_order_inventory


MIGRATION_POSTGRES_URL = (
    os.environ.get("FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL")
    or os.environ.get("FLOWTALLY_TEST_POSTGRES_ADMIN_URL")
    or os.environ.get("FLOWTALLY_TEST_POSTGRES_URL")
    or ""
)
ADMIN_POSTGRES_URL = (
    os.environ.get("FLOWTALLY_TEST_POSTGRES_ADMIN_URL")
    or ""
)
CATALOG_POSTGRES_URL = (
    os.environ.get("FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL")
    or os.environ.get("FLOWTALLY_TEST_POSTGRES_ADMIN_URL")
    or os.environ.get("FLOWTALLY_TEST_POSTGRES_URL")
    or ""
)
RUNTIME_POSTGRES_URL = os.environ.get("FLOWTALLY_TEST_POSTGRES_URL", "")
POSTGRES_URL = RUNTIME_POSTGRES_URL or MIGRATION_POSTGRES_URL
DIAGNOSTIC_STATEMENT_TIMEOUT = "5s"
DIAGNOSTIC_LOCK_TIMEOUT = "3s"
DIAGNOSTIC_PROBE_STATEMENT_TIMEOUT = "15s"
DIAGNOSTIC_PROBE_LOCK_TIMEOUT = "3s"
DIAGNOSTIC_WAIT_INSPECTION_SECONDS = 2.0
DIAGNOSTIC_PROBE_DEADLINE_SECONDS = 25.0
BOOTSTRAP_STATEMENT_TIMEOUT = "120s"
BOOTSTRAP_LOCK_TIMEOUT = "5s"

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

_membership_discovery_spec = importlib.util.spec_from_file_location(
    "backend.migrations.versions.0014_authenticated_membership_discovery",
    os.path.join(os.path.dirname(__file__), "..", "migrations", "versions", "0014_authenticated_membership_discovery.py"),
)
assert _membership_discovery_spec and _membership_discovery_spec.loader
_membership_discovery_module = importlib.util.module_from_spec(_membership_discovery_spec)
_membership_discovery_spec.loader.exec_module(_membership_discovery_module)
membership_discovery_apply_postgres_rls = _membership_discovery_module.apply_postgres_rls


pytestmark = pytest.mark.skipif(
    not POSTGRES_URL.startswith("postgres"),
    reason="PostgreSQL test database is not configured.",
)

SUPPORT_ACCESS_DEFERRED = pytest.mark.skip(reason="Support access deferred for the current staging milestone.")


@pytest.fixture()
def postgres_app(tmp_path):
    migrator_application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": MIGRATION_POSTGRES_URL,
            "SESSION_COOKIE_SECURE": False,
            "ALLOWED_ORIGINS": ["http://127.0.0.1:5173"],
            "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://",
            "WTF_CSRF_ENABLED": True,
        }
    )
    if not ADMIN_POSTGRES_URL:
        pytest.fail("FLOWTALLY_TEST_POSTGRES_ADMIN_URL is required: forced RLS applies to the table owner, so fixtures seed through the superuser admin connection.")
    print("BEFORE: postgres_app schema reset", flush=True)
    _reset_public_schema_for_rls_tests()
    print("AFTER: postgres_app schema reset", flush=True)
    # Build the schema with the real Alembic chain so every table gets the same
    # RLS DDL production does, instead of a hand-maintained subset of migrations.
    alembic_config = Config()
    alembic_config.set_main_option("script_location", str((Path(__file__).resolve().parents[1] / "migrations").resolve()))
    alembic_config.set_main_option("sqlalchemy.url", MIGRATION_POSTGRES_URL)
    with migrator_application.app_context():
        print(f"STATE: postgres_app migrator url -> {MIGRATION_POSTGRES_URL}", flush=True)
        print("BEFORE: postgres_app alembic upgrade head", flush=True)
        alembic_command.upgrade(alembic_config, "head")
        db.session.remove()
        print("AFTER: postgres_app alembic upgrade head", flush=True)
    # Forced RLS applies to the table owner too, so seed through the superuser
    # admin connection (same path the per-test dataset seeders use).
    print("BEFORE: postgres_app seed_pilot_data", flush=True)
    _seed_admin_fixture("postgres_app", lambda: seed_pilot_data(reset=False))
    print("AFTER: postgres_app seed_pilot_data", flush=True)
    runtime_application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": RUNTIME_POSTGRES_URL,
            "SESSION_COOKIE_SECURE": False,
            "ALLOWED_ORIGINS": ["http://127.0.0.1:5173"],
            "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://",
            "WTF_CSRF_ENABLED": True,
        }
    )
    with runtime_application.app_context():
        print(f"STATE: postgres_app runtime url -> {RUNTIME_POSTGRES_URL}", flush=True)
        print("BEFORE: postgres_app runtime role verification", flush=True)
        runtime_role = _log_row_probe(
            "postgres_app runtime role metadata",
            """
            select
                current_user,
                session_user,
                current_role,
                current_setting('row_security', true) as row_security,
                current_setting('flowtally.access_scope', true) as access_scope,
                current_setting('flowtally.organization_id', true) as organization_id,
                current_setting('flowtally.support_grant_id', true) as support_grant_id
            """,
        )
        runtime_flags = _log_row_probe(
            "postgres_app runtime role flags",
            """
            select rolname, rolsuper, rolbypassrls, rolcanlogin
            from pg_roles
            where rolname = current_user
            """,
        )
        supplier_metadata = _log_row_probe(
            "postgres_app suppliers ownership and RLS metadata",
            """
            select
                c.relname,
                r.rolname as table_owner,
                c.relrowsecurity,
                c.relforcerowsecurity
            from pg_class c
            join pg_roles r on r.oid = c.relowner
            where c.relname = 'suppliers'
            """,
        )
        application_table_ownership = _log_scalar_probe(
            "postgres_app runtime table ownership count",
            """
            select count(*)
            from pg_class c
            join pg_roles r on r.oid = c.relowner
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relkind = 'r'
              and r.rolname = current_user
            """,
        )
        assert runtime_role[0] == "flowtally_runtime"
        assert runtime_role[1] == "flowtally_runtime"
        assert runtime_role[2] == "flowtally_runtime"
        assert runtime_role[3] == "on"
        assert runtime_role[4] in (None, "")
        assert runtime_role[5] in (None, "")
        assert runtime_role[6] in (None, "")
        assert runtime_flags[0] == "flowtally_runtime"
        assert runtime_flags[1] is False
        assert runtime_flags[2] is False
        assert runtime_flags[3] is True
        assert supplier_metadata[0] == "suppliers"
        assert supplier_metadata[1] == "flowtally_migrator"
        assert supplier_metadata[2] is True
        assert supplier_metadata[3] is True
        assert application_table_ownership == 0
        print("AFTER: postgres_app runtime role verification", flush=True)
        _log_session_state("after runtime role verification")
    print("BEFORE: postgres_app session timeouts", flush=True)
    with runtime_application.app_context():
        db.session.execute(text(f"set statement_timeout = '{DIAGNOSTIC_STATEMENT_TIMEOUT}'"))
        db.session.execute(text(f"set lock_timeout = '{DIAGNOSTIC_LOCK_TIMEOUT}'"))
    print("AFTER: postgres_app session timeouts", flush=True)
    yield runtime_application
    print("BEFORE: postgres_app teardown", flush=True)
    with runtime_application.app_context():
        _log_session_state("before runtime teardown")
        db.session.remove()
    with migrator_application.app_context():
        _log_session_state("before migrator teardown")
        db.session.remove()
    print("BEFORE: postgres_app schema reset teardown", flush=True)
    _reset_public_schema_for_rls_tests()
    print("AFTER: postgres_app schema reset teardown", flush=True)
    print("AFTER: postgres_app teardown", flush=True)


def _set_rls_context(
    *,
    access_scope: str,
    organization_id: int | None = None,
    support_grant_id: int | None = None,
    user_id: int | None = None,
) -> None:
    db.session.execute(
        text("select set_config(:name, :value, true)"),
        {"name": "flowtally.access_scope", "value": access_scope},
    )
    db.session.execute(
        text("select set_config(:name, :value, true)"),
        {"name": "flowtally.user_id", "value": "" if user_id is None else str(user_id)},
    )
    db.session.execute(
        text("select set_config(:name, :value, true)"),
        {"name": "flowtally.organization_id", "value": "" if organization_id is None else str(organization_id)},
    )
    db.session.execute(
        text("select set_config(:name, :value, true)"),
        {"name": "flowtally.support_grant_id", "value": "" if support_grant_id is None else str(support_grant_id)},
    )


def _pin_rls_context(
    *,
    access_scope: str,
    organization_id: int | None = None,
    user_id: int | None = None,
) -> None:
    """Set the RLS context for this transaction and re-install it on every later transaction.

    Production does this through ``g.flowtally_tenant_context`` plus the Session
    ``after_begin`` hook. ``set_config(..., true)`` is transaction-local, so without
    pinning, the first commit silently drops the context and RLS hides the caller's own
    rows (surfacing as ObjectDeletedError on expired ORM instances). Requires a request
    context.
    """
    _set_rls_context(access_scope=access_scope, organization_id=organization_id, user_id=user_id)
    g.flowtally_tenant_context = {
        "flowtally.access_scope": access_scope,
        "flowtally.organization_id": "" if organization_id is None else str(organization_id),
        "flowtally.user_id": "" if user_id is None else str(user_id),
        "flowtally.support_grant_id": "",
    }


def _login_owner(client) -> None:
    csrf_response = client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001")
    csrf_token = csrf_response.get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        base_url="http://127.0.0.1:5001",
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
        headers={"X-CSRFToken": csrf_token},
    )
    assert response.status_code == 200, response.get_data(as_text=True)


def _login_user(client, email: str, password: str) -> None:
    csrf_response = client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001")
    csrf_token = csrf_response.get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        base_url="http://127.0.0.1:5001",
        json={"email": email, "password": password},
        headers={"X-CSRFToken": csrf_token},
    )
    assert response.status_code == 200, response.get_data(as_text=True)


def _github_warning(message: str) -> None:
    print(f"::warning file=backend/tests/test_postgres_rls.py,line=2199::{message}", flush=True)


def _log_connection_identity(connection, label: str) -> dict[str, object]:
    snapshot = connection.execute(
        text(
            """
            select
                current_user,
                session_user,
                current_role,
                current_database() as current_database,
                pg_backend_pid() as backend_pid
            """
        )
    ).mappings().one()
    data = dict(snapshot)
    print(f"STATE: {label} -> {data}", flush=True)
    return data


def _apply_diagnostic_timeouts(connection) -> None:
    connection.exec_driver_sql(f"set statement_timeout = '{DIAGNOSTIC_STATEMENT_TIMEOUT}'")
    connection.exec_driver_sql(f"set lock_timeout = '{DIAGNOSTIC_LOCK_TIMEOUT}'")


def _apply_bootstrap_timeouts(connection) -> None:
    connection.exec_driver_sql(f"set statement_timeout = '{BOOTSTRAP_STATEMENT_TIMEOUT}'")
    connection.exec_driver_sql(f"set lock_timeout = '{BOOTSTRAP_LOCK_TIMEOUT}'")


def _log_bootstrap_connection_state(label: str, connection) -> dict[str, object]:
    snapshot = {
        "backend_pid": connection.exec_driver_sql("select pg_backend_pid()").scalar_one(),
        "current_user": connection.exec_driver_sql("select current_user").scalar_one(),
        "session_user": connection.exec_driver_sql("select session_user").scalar_one(),
        "current_role": connection.exec_driver_sql("select current_role").scalar_one(),
        "current_database": connection.exec_driver_sql("select current_database()").scalar_one(),
        "application_name": connection.exec_driver_sql("show application_name").scalar_one(),
        "txid_current_if_assigned": connection.exec_driver_sql("select txid_current_if_assigned()").scalar_one(),
        "sqlalchemy_connection_in_transaction": connection.in_transaction(),
    }
    print(f"STATE: {label} -> {snapshot}", flush=True)
    return snapshot


def _dump_admin_organizations_snapshot(label: str, bootstrap_pid: int, engine) -> None:
    print(f"BEFORE: admin organizations snapshot {label}", flush=True)
    with engine.connect() as admin_connection:
        _apply_diagnostic_timeouts(admin_connection)
        organizations_oid = admin_connection.exec_driver_sql("select 'organizations'::regclass::oid").scalar_one()
        rows = admin_connection.execute(
            text(
                """
                select
                    a.pid,
                    a.usename,
                    a.application_name,
                    a.state,
                    a.wait_event_type,
                    a.wait_event,
                    a.xact_start,
                    a.query_start,
                    a.backend_xid,
                    a.backend_xmin,
                    a.query,
                    pg_blocking_pids(a.pid) as blocking_pids,
                    l.mode,
                    l.granted
                from pg_stat_activity a
                left join pg_locks l on l.pid = a.pid and l.relation = :organizations_oid
                where a.pid = :bootstrap_pid
                   or a.pid = any(pg_blocking_pids(:bootstrap_pid))
                   or exists (
                        select 1
                        from pg_locks other_l
                        where other_l.pid = a.pid
                          and other_l.relation = :organizations_oid
                   )
                order by a.pid, l.mode
                """
            ),
            {"bootstrap_pid": bootstrap_pid, "organizations_oid": organizations_oid},
        ).all()
        for row in rows:
            print(f"ADMIN ROW: {tuple(row)}", flush=True)
    print(f"AFTER: admin organizations snapshot {label}", flush=True)


def _log_session_state(label: str) -> None:
    session = db.session()
    print(
        f"STATE: {label} -> session_in_transaction={session.in_transaction()} "
        f"session_in_nested_transaction={session.in_nested_transaction()} "
        f"session_is_active={session.is_active}",
        flush=True,
    )


def _summarize_sql(sql: str, limit: int = 160) -> str:
    compact = " ".join(sql.split())
    return textwrap.shorten(compact, width=limit, placeholder=" ...")


class _LoggingConnection:
    def __init__(self, connection, label: str):
        self._connection = connection
        self._label = label
        self._counter = 0

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def exec_driver_sql(self, statement, *args, **kwargs):
        self._counter += 1
        summary = _summarize_sql(statement)
        print(f"BEFORE: {self._label} sql[{self._counter}] {summary}", flush=True)
        try:
            if 'ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY' in statement:
                _log_bootstrap_connection_state(f"{self._label} before organizations RLS", self._connection)
                bootstrap_pid = self._connection.exec_driver_sql("select pg_backend_pid()").scalar_one()
                admin_engine = db.engine

                def _delayed_snapshot() -> None:
                    time.sleep(1)
                    _dump_admin_organizations_snapshot(
                        f"while {self._label} waits on organizations RLS",
                        bootstrap_pid,
                        admin_engine,
                    )

                threading.Thread(target=_delayed_snapshot, daemon=True).start()
            result = self._connection.exec_driver_sql(statement, *args, **kwargs)
            print(f"AFTER: {self._label} sql[{self._counter}]", flush=True)
            return result
        except Exception as exc:
            print(
                f"ERROR: {self._label} sql[{self._counter}] -> {exc.__class__.__name__}: {exc}",
                flush=True,
            )
            raise


def _log_scalar_probe(label: str, statement, params: dict[str, object] | None = None) -> object:
    print(f"BEFORE: {label}", flush=True)
    try:
        connection = db.session.connection()
        _apply_diagnostic_timeouts(connection)
        _log_connection_identity(connection, f"{label} connection identity")
        result = connection.execute(text(statement), params or {}).scalar_one()
        print(f"AFTER: {label} -> {result}", flush=True)
        return result
    except Exception as exc:
        print(f"ERROR: {label} -> {exc.__class__.__name__}: {exc}", flush=True)
        db.session.rollback()
        raise


def _log_row_probe(label: str, statement, params: dict[str, object] | None = None):
    print(f"BEFORE: {label}", flush=True)
    try:
        connection = db.session.connection()
        _apply_diagnostic_timeouts(connection)
        _log_connection_identity(connection, f"{label} connection identity")
        row = connection.execute(text(statement), params or {}).one()
        print(f"AFTER: {label} -> {tuple(row)}", flush=True)
        return row
    except Exception as exc:
        print(f"ERROR: {label} -> {exc.__class__.__name__}: {exc}", flush=True)
        db.session.rollback()
        raise


def _log_rows_probe(label: str, statement, params: dict[str, object] | None = None):
    print(f"BEFORE: {label}", flush=True)
    try:
        connection = db.session.connection()
        _apply_diagnostic_timeouts(connection)
        _log_connection_identity(connection, f"{label} connection identity")
        rows = connection.execute(text(statement), params or {}).all()
        print(f"AFTER: {label} -> {len(rows)} row(s)", flush=True)
        for row in rows:
            print(f"  ROW: {tuple(row)}", flush=True)
        return rows
    except Exception as exc:
        print(f"ERROR: {label} -> {exc.__class__.__name__}: {exc}", flush=True)
        db.session.rollback()
        raise


def _log_supplier_enforcement_snapshot(*, org_a_id: int, org_b_id: int) -> dict[str, object]:
    label = "test_rls_hides_other_tenant_rows enforcement snapshot"
    print(f"BEFORE: {label}", flush=True)
    connection = db.session.connection()
    _apply_diagnostic_timeouts(connection)

    snapshot: dict[str, object] = {}

    connection_identity = connection.execute(
        text(
            """
            SELECT
                current_user,
                session_user,
                current_role,
                current_setting('row_security', true) AS row_security,
                current_setting('flowtally.access_scope', true) AS access_scope,
                current_setting('flowtally.organization_id', true) AS organization_id,
                current_setting('flowtally.support_grant_id', true) AS support_grant_id
            """
        )
    ).mappings().one()
    snapshot["connection_identity"] = dict(connection_identity)
    print(f"STATE: {label} connection_identity -> {snapshot['connection_identity']}", flush=True)

    role_properties = connection.execute(
        text(
            """
            SELECT
                rolname,
                rolsuper,
                rolbypassrls,
                rolcanlogin
            FROM pg_roles
            WHERE rolname = current_user
            """
        )
    ).mappings().all()
    snapshot["role_properties"] = [dict(row) for row in role_properties]
    print(f"STATE: {label} role_properties -> {snapshot['role_properties']}", flush=True)

    table_metadata = connection.execute(
        text(
            """
            SELECT
                c.relname,
                owner_role.rolname AS table_owner,
                c.relrowsecurity,
                c.relforcerowsecurity
            FROM pg_class c
            JOIN pg_roles owner_role
                ON owner_role.oid = c.relowner
            WHERE c.relname = 'suppliers'
            """
        )
    ).mappings().all()
    snapshot["table_metadata"] = [dict(row) for row in table_metadata]
    print(f"STATE: {label} table_metadata -> {snapshot['table_metadata']}", flush=True)

    policy_rows = connection.execute(
        text(
            """
            SELECT
                policyname,
                cmd,
                roles,
                permissive,
                qual,
                with_check
            FROM pg_policies
            WHERE tablename = 'suppliers'
            ORDER BY policyname
            """
        )
    ).mappings().all()
    snapshot["policy_rows"] = [dict(row) for row in policy_rows]
    print(f"STATE: {label} policy_rows -> {snapshot['policy_rows']}", flush=True)

    has_org_access_a = connection.execute(
        text("select flowtally_has_org_access(:org_id)"),
        {"org_id": org_a_id},
    ).scalar_one()
    has_org_access_b = connection.execute(
        text("select flowtally_has_org_access(:org_id)"),
        {"org_id": org_b_id},
    ).scalar_one()
    support_has_access_b = connection.execute(
        text("select flowtally_support_has_access(:org_id)"),
        {"org_id": org_b_id},
    ).scalar_one()
    snapshot["has_org_access_a"] = has_org_access_a
    snapshot["has_org_access_b"] = has_org_access_b
    snapshot["support_has_access_b"] = support_has_access_b
    print(
        f"STATE: {label} helper_access -> "
        f"has_org_access_a={has_org_access_a} "
        f"has_org_access_b={has_org_access_b} "
        f"support_has_access_b={support_has_access_b}",
        flush=True,
    )

    supplier_rows = connection.execute(
        text(
            """
            select id, organization_id
            from suppliers
            order by organization_id, id
            """
        )
    ).mappings().all()
    snapshot["supplier_rows"] = [dict(row) for row in supplier_rows]
    print(f"STATE: {label} supplier_rows -> {snapshot['supplier_rows']}", flush=True)

    orm_count_a = Supplier.query.filter_by(organization_id=org_a_id).count()
    orm_count_b = Supplier.query.filter_by(organization_id=org_b_id).count()
    snapshot["orm_count_a"] = orm_count_a
    snapshot["orm_count_b"] = orm_count_b
    print(f"STATE: {label} orm_counts -> org_a={orm_count_a} org_b={orm_count_b}", flush=True)
    print(f"AFTER: {label}", flush=True)
    return snapshot


def _format_probe_rows(rows: list[dict[str, object]]) -> str:
    return "[" + ", ".join(str(row) for row in rows) + "]"


def _capture_pg_wait_state(engine, label: str, backend_pid: int) -> None:
    with engine.connect() as connection:
        connection.exec_driver_sql(f"set statement_timeout = '{DIAGNOSTIC_PROBE_STATEMENT_TIMEOUT}'")
        connection.exec_driver_sql(f"set lock_timeout = '{DIAGNOSTIC_PROBE_LOCK_TIMEOUT}'")
        activity = connection.execute(
            text(
                """
                select
                    pid,
                    state,
                    wait_event_type,
                    wait_event,
                    xact_start,
                    query_start,
                    state_change,
                    backend_xid,
                    backend_xmin,
                    left(query, 500) as query
                from pg_stat_activity
                where pid = :pid
                """
            ),
            {"pid": backend_pid},
        ).mappings().first()
        if activity is None:
            print(f"WAIT STATE [{label}] pid={backend_pid} not found in pg_stat_activity", flush=True)
            return

        print(
            "WAIT STATE "
            f"[{label}] "
            f"pid={activity['pid']} "
            f"state={activity['state']} "
            f"wait_event_type={activity['wait_event_type']} "
            f"wait_event={activity['wait_event']} "
            f"xact_start={activity['xact_start']} "
            f"query_start={activity['query_start']} "
            f"state_change={activity['state_change']} "
            f"backend_xid={activity['backend_xid']} "
            f"backend_xmin={activity['backend_xmin']} "
            f"query={activity['query']!r}",
            flush=True,
        )

        blocking_pids = connection.execute(
            text("select unnest(pg_blocking_pids(:pid)) as blocking_pid"),
            {"pid": backend_pid},
        ).scalars().all()
        print(f"WAIT STATE [{label}] blocking_pids={blocking_pids}", flush=True)

        if blocking_pids:
            blockers = connection.execute(
                text(
                    """
                    select
                        pid,
                        state,
                        wait_event_type,
                        wait_event,
                        xact_start,
                        query_start,
                        state_change,
                        left(query, 500) as query
                    from pg_stat_activity
                    where pid in (select unnest(pg_blocking_pids(:pid)))
                    order by pid
                    """
                ),
                {"pid": backend_pid},
            ).mappings().all()
            for blocker in blockers:
                print(
                    "WAIT STATE "
                    f"[{label}] blocker_pid={blocker['pid']} "
                    f"state={blocker['state']} "
                    f"wait_event_type={blocker['wait_event_type']} "
                    f"wait_event={blocker['wait_event']} "
                    f"xact_start={blocker['xact_start']} "
                    f"query_start={blocker['query_start']} "
                    f"state_change={blocker['state_change']} "
                    f"query={blocker['query']!r}",
                    flush=True,
                )

        lock_rows = connection.execute(
            text(
                """
                select
                    pid,
                    locktype,
                    mode,
                    granted,
                    relation::regclass::text as relation,
                    transactionid,
                    virtualxid,
                    classid,
                    objid,
                    objsubid
                from pg_locks
                where pid = :pid
                   or pid in (select unnest(pg_blocking_pids(:pid)))
                order by granted, pid, locktype, relation nulls last, mode
                """
            ),
            {"pid": backend_pid},
        ).mappings().all()
        print(f"WAIT STATE [{label}] lock_rows={_format_probe_rows([dict(row) for row in lock_rows])}", flush=True)


def _run_pg_diagnostic_probe(
    engine,
    *,
    label: str,
    sql_category: str,
    statement: str,
    params: dict[str, object] | None = None,
    result_mode: str = "rows",
) -> dict[str, object]:
    probe_state: dict[str, object] = {
        "label": label,
        "sql_category": sql_category,
        "backend_pid": None,
        "status": "pending",
        "result": None,
        "exception": None,
    }
    ready = threading.Event()
    finished = threading.Event()
    started_at: float | None = None
    wait_marks = [1.0, 5.0]

    def _worker() -> None:
        nonlocal started_at
        try:
            with engine.connect() as connection:
                connection.exec_driver_sql(f"set statement_timeout = '{DIAGNOSTIC_PROBE_STATEMENT_TIMEOUT}'")
                connection.exec_driver_sql(f"set lock_timeout = '{DIAGNOSTIC_PROBE_LOCK_TIMEOUT}'")
                identity = _log_connection_identity(connection, f"probe {label} identity")
                probe_state["backend_pid"] = connection.exec_driver_sql("select pg_backend_pid()").scalar_one()
                probe_state["connection_in_transaction"] = connection.in_transaction()
                probe_state["statement_timeout"] = connection.exec_driver_sql("show statement_timeout").scalar_one()
                probe_state["lock_timeout"] = connection.exec_driver_sql("show lock_timeout").scalar_one()
                probe_state["current_user"] = identity["current_user"]
                probe_state["session_user"] = identity["session_user"]
                probe_state["current_role"] = identity["current_role"]
                ready.set()
                start_stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                print(
                    f"START PROBE [{label}] category={sql_category} "
                    f"started_at={start_stamp} "
                    f"backend_pid={probe_state['backend_pid']} "
                    f"current_user={probe_state['current_user']} "
                    f"session_user={probe_state['session_user']} "
                    f"current_role={probe_state['current_role']} "
                    f"connection_in_transaction={probe_state['connection_in_transaction']} "
                    f"statement_timeout={probe_state['statement_timeout']} "
                    f"lock_timeout={probe_state['lock_timeout']}",
                    flush=True,
                )
                started_at = time.monotonic()
                if result_mode == "scalar":
                    result = connection.execute(text(statement), params or {}).scalar_one()
                elif result_mode == "row":
                    result = dict(connection.execute(text(statement), params or {}).mappings().one())
                else:
                    result = [dict(row) for row in connection.execute(text(statement), params or {}).mappings().all()]
                elapsed = time.monotonic() - started_at
                probe_state["status"] = "success"
                probe_state["result"] = result
                print(
                    f"DONE PROBE [{label}] category={sql_category} elapsed={elapsed:.3f}s status=success result={result!r}",
                    flush=True,
                )
        except Exception as exc:
            elapsed = time.monotonic() - started_at if started_at is not None else 0.0
            probe_state["exception"] = exc
            orig = getattr(exc, "orig", None)
            pgcode = getattr(orig, "pgcode", None)
            message = str(exc)
            if pgcode == "57014" or "statement timeout" in message.lower():
                probe_state["status"] = "timeout"
            else:
                probe_state["status"] = "exception"
            print(
                f"DONE PROBE [{label}] category={sql_category} elapsed={elapsed:.3f}s status={probe_state['status']} exception={exc.__class__.__name__}: {message}",
                flush=True,
            )
        finally:
            finished.set()

    worker = threading.Thread(target=_worker, name=f"pg-diagnostic-{label}", daemon=True)
    worker.start()

    if not ready.wait(timeout=5.0):
        print(f"WAIT STATE [{label}] backend pid was not captured within 5s", flush=True)

    inspected = False
    probe_started_at = time.monotonic()
    deadline = time.monotonic() + DIAGNOSTIC_PROBE_DEADLINE_SECONDS
    while not finished.wait(timeout=0.5):
        if not inspected and probe_state["backend_pid"] is not None:
            elapsed = time.monotonic() - probe_started_at
            if wait_marks and elapsed >= wait_marks[0]:
                _capture_pg_wait_state(engine, label, int(probe_state["backend_pid"]))
                wait_marks.pop(0)
                if not wait_marks:
                    inspected = True
        if time.monotonic() >= deadline:
            print(f"WAIT STATE [{label}] exceeded diagnostic deadline; continuing to next probe", flush=True)
            if probe_state["backend_pid"] is not None:
                _capture_pg_wait_state(engine, label, int(probe_state["backend_pid"]))
            break

    if worker.is_alive():
        worker.join(timeout=0.5)

    return probe_state


def _run_connection_probe(
    connection,
    *,
    label: str,
    sql_category: str,
    statement: str,
    params: dict[str, object] | None = None,
    result_mode: str = "rows",
) -> dict[str, object]:
    probe_state: dict[str, object] = {
        "label": label,
        "sql_category": sql_category,
        "backend_pid": None,
        "connection_in_transaction": connection.in_transaction(),
        "statement_timeout": None,
        "lock_timeout": None,
        "status": "pending",
        "result": None,
        "exception": None,
    }

    start_stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    identity = _log_connection_identity(connection, f"probe {label} identity")
    probe_state["backend_pid"] = connection.exec_driver_sql("select pg_backend_pid()").scalar_one()
    probe_state["statement_timeout"] = connection.exec_driver_sql("show statement_timeout").scalar_one()
    probe_state["lock_timeout"] = connection.exec_driver_sql("show lock_timeout").scalar_one()
    probe_state["current_user"] = identity["current_user"]
    probe_state["session_user"] = identity["session_user"]
    probe_state["current_role"] = identity["current_role"]

    print(
        "START PROBE "
        f"[{label}] "
        f"category={sql_category} "
        f"started_at={start_stamp} "
        f"backend_pid={probe_state['backend_pid']} "
        f"current_user={probe_state['current_user']} "
        f"session_user={probe_state['session_user']} "
        f"current_role={probe_state['current_role']} "
        f"connection_in_transaction={probe_state['connection_in_transaction']} "
        f"statement_timeout={probe_state['statement_timeout']} "
        f"lock_timeout={probe_state['lock_timeout']}",
        flush=True,
    )

    started_at = time.monotonic()
    try:
        if result_mode == "scalar":
            result = connection.execute(text(statement), params or {}).scalar_one()
        elif result_mode == "row":
            result = dict(connection.execute(text(statement), params or {}).mappings().one())
        else:
            result = [dict(row) for row in connection.execute(text(statement), params or {}).mappings().all()]
        elapsed = time.monotonic() - started_at
        probe_state["status"] = "success"
        probe_state["result"] = result
        print(
            f"DONE PROBE [{label}] category={sql_category} elapsed={elapsed:.3f}s status=success result={result!r}",
            flush=True,
        )
    except Exception as exc:
        elapsed = time.monotonic() - started_at
        probe_state["exception"] = exc
        orig = getattr(exc, "orig", None)
        pgcode = getattr(orig, "pgcode", None)
        message = str(exc)
        if pgcode == "57014" or "statement timeout" in message.lower():
            probe_state["status"] = "timeout"
        else:
            probe_state["status"] = "exception"
        print(
            f"DONE PROBE [{label}] category={sql_category} elapsed={elapsed:.3f}s status={probe_state['status']} exception={exc.__class__.__name__}: {message}",
            flush=True,
        )

    return probe_state


def _run_session_probe(
    *,
    label: str,
    sql_category: str,
    statement: str,
    params: dict[str, object] | None = None,
    result_mode: str = "rows",
) -> dict[str, object]:
    print(f"BEFORE: session probe acquire {label}", flush=True)
    session = db.session()
    print(
        f"STATE: session probe before acquire {label} -> "
        f"session_in_transaction={session.in_transaction()} "
        f"session_in_nested_transaction={session.in_nested_transaction()} "
        f"session_is_active={session.is_active}",
        flush=True,
    )
    acquired_at = time.monotonic()
    try:
        connection = db.session.connection()
    except Exception as exc:
        elapsed = time.monotonic() - acquired_at
        print(
            f"DONE PROBE [{label}] category={sql_category} elapsed={elapsed:.3f}s status=connection_error "
            f"exception={exc.__class__.__name__}: {exc}",
            flush=True,
        )
        db.session.rollback()
        return {
            "label": label,
            "sql_category": sql_category,
            "backend_pid": None,
            "connection_in_transaction": session.in_transaction(),
            "statement_timeout": None,
            "lock_timeout": None,
            "status": "connection_error",
            "result": None,
            "exception": exc,
        }
    try:
        return _run_connection_probe(
            connection,
            label=label,
            sql_category=sql_category,
            statement=statement,
            params=params,
            result_mode=result_mode,
        )
    finally:
        db.session.rollback()
        print(
            f"STATE: session probe after rollback {label} -> "
            f"session_in_transaction={session.in_transaction()} "
            f"session_in_nested_transaction={session.in_nested_transaction()} "
            f"session_is_active={session.is_active}",
            flush=True,
        )


def _collect_function_catalog_diagnostics(
    name: str,
    argcount: int,
    *,
    detailed: bool = False,
    include_definition: bool = False,
) -> dict[str, object]:
    print(f"BEGIN CATALOG DIAGNOSTICS {name}/{argcount}", flush=True)
    catalog_engine = create_engine(CATALOG_POSTGRES_URL, poolclass=NullPool)
    summary: dict[str, object] = {
        "name": name,
        "argcount": argcount,
        "fixture": {},
        "fresh": {},
    }

    fixture_select = _run_session_probe(
        label=f"{name} fixture select 1",
        sql_category="connectivity",
        statement="select 1",
        result_mode="scalar",
    )
    summary["fixture"]["select_1"] = fixture_select

    fixture_metadata = _run_session_probe(
        label=f"{name} fixture pg_proc lookup",
        sql_category="pg_proc metadata",
        statement="""
            select
                oid,
                proname,
                pronargs
            from pg_catalog.pg_proc
            where proname = :name
              and pronargs = :argcount
            order by oid
        """,
        params={"name": name, "argcount": argcount},
    )
    summary["fixture"]["pg_proc_lookup"] = fixture_metadata

    fresh_select = _run_pg_diagnostic_probe(
        catalog_engine,
        label=f"{name} fresh select 1",
        sql_category="connectivity",
        statement="select 1",
        result_mode="scalar",
    )
    summary["fresh"]["select_1"] = fresh_select

    fresh_metadata = _run_pg_diagnostic_probe(
        catalog_engine,
        label=f"{name} fresh pg_proc lookup",
        sql_category="pg_proc metadata",
        statement="""
            select
                oid,
                proname,
                pronargs
            from pg_catalog.pg_proc
            where proname = :name
              and pronargs = :argcount
            order by oid
        """,
        params={"name": name, "argcount": argcount},
    )
    summary["fresh"]["pg_proc_lookup"] = fresh_metadata

    if detailed:
        fresh_namespace = _run_pg_diagnostic_probe(
            catalog_engine,
            label=f"{name} fresh namespace lookup",
            sql_category="pg_namespace",
            statement="""
                select
                    n.oid,
                    n.nspname
                from pg_catalog.pg_namespace n
                where n.oid in (
                    select p.pronamespace
                    from pg_catalog.pg_proc p
                    where p.proname = :name
                      and p.pronargs = :argcount
                )
                order by n.oid
            """,
            params={"name": name, "argcount": argcount},
        )
        summary["fresh"]["namespace_lookup"] = fresh_namespace

        fresh_join = _run_pg_diagnostic_probe(
            catalog_engine,
            label=f"{name} fresh namespace join",
            sql_category="pg_proc join pg_namespace",
            statement="""
                select
                    p.oid,
                    p.proname,
                    p.pronargs,
                    n.nspname as schema_name,
                    p.prokind,
                    p.prosecdef,
                    p.provolatile
                from pg_catalog.pg_proc p
                join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                where p.proname = :name
                  and p.pronargs = :argcount
                order by p.oid
            """,
            params={"name": name, "argcount": argcount},
        )
        summary["fresh"]["namespace_join"] = fresh_join

        join_rows = (fresh_join.get("result") or []) if isinstance(fresh_join, dict) else []
        for row in join_rows:
            oid = row.get("oid")
            if oid is None:
                continue
            fresh_identity = _run_pg_diagnostic_probe(
                catalog_engine,
                label=f"{name} fresh function identity arguments oid={oid}",
                sql_category="pg_get_function_identity_arguments",
                statement="select pg_get_function_identity_arguments(:oid) as identity_arguments",
                params={"oid": oid},
                result_mode="row",
            )
            summary["fresh"].setdefault("identity_arguments", []).append(fresh_identity)

            fresh_definition = _run_pg_diagnostic_probe(
                catalog_engine,
                label=f"{name} fresh pg_get_functiondef oid={oid}",
                sql_category="pg_get_functiondef",
                statement="select pg_get_functiondef(:oid) as definition",
                params={"oid": oid},
                result_mode="row",
            )
            summary["fresh"].setdefault("function_definition", []).append(fresh_definition)
    elif include_definition:
        fresh_oid_rows = (fresh_metadata.get("result") or []) if isinstance(fresh_metadata, dict) else []
        fresh_oid = fresh_oid_rows[0]["oid"] if fresh_oid_rows else None
        if fresh_oid is None:
            print(f"SKIP PROBE [{name} fresh pg_get_functiondef] no oid available", flush=True)
            summary["fresh"]["function_definition"] = {"status": "skipped", "reason": "no oid from metadata probe"}
        else:
            fresh_definition = _run_pg_diagnostic_probe(
                catalog_engine,
                label=f"{name} fresh pg_get_functiondef",
                sql_category="pg_get_functiondef",
                statement="select pg_get_functiondef(:oid) as definition",
                params={"oid": fresh_oid},
                result_mode="row",
            )
            summary["fresh"]["function_definition"] = fresh_definition

    print(f"END CATALOG DIAGNOSTICS {name}/{argcount} -> {summary}", flush=True)
    catalog_engine.dispose()
    return summary


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


def _seed_two_organizations_with_suppliers(owner: User, prefix: str = "RLS") -> dict[str, object]:
    print("BEFORE: seed two organizations", flush=True)
    org_a = _create_org(owner, f"{prefix} Alpha")
    org_b = _create_org(owner, f"{prefix} Beta")
    db.session.add_all(
        [
            Supplier(organization_id=org_a.id, name="Alpha Supplier", normalized_name="alpha supplier"),
            Supplier(organization_id=org_b.id, name="Beta Supplier", normalized_name="beta supplier"),
        ]
    )
    db.session.commit()
    print("AFTER: seed two organizations", flush=True)
    return {"org_a_id": org_a.id, "org_b_id": org_b.id}


def _seed_membership_discovery_dataset(prefix: str = "RLS") -> dict[str, object]:
    print("BEFORE: seed membership discovery dataset", flush=True)
    user_a = User(email=f"{prefix.lower()}-membership-a-{uuid4().hex[:8]}@example.com", is_active=True)
    user_a.set_password("MembershipA123!")
    user_b = User(email=f"{prefix.lower()}-membership-b-{uuid4().hex[:8]}@example.com", is_active=True)
    user_b.set_password("MembershipB123!")
    support_user = User(email=f"{prefix.lower()}-support-{uuid4().hex[:8]}@example.com", is_active=True)
    support_user.set_password("Support123!")
    db.session.add_all([user_a, user_b, support_user])
    db.session.flush()
    org_a = _create_org(user_a, f"{prefix} Discovery Alpha")
    org_b = _create_org(user_b, f"{prefix} Discovery Beta")
    db.session.commit()
    print("AFTER: seed membership discovery dataset", flush=True)
    return {
        "user_a_id": user_a.id,
        "org_a_id": org_a.id,
        "org_b_id": org_b.id,
        "support_user_id": support_user.id,
    }


def _reset_public_schema_for_rls_tests() -> None:
    admin_url = ADMIN_POSTGRES_URL or MIGRATION_POSTGRES_URL
    if not admin_url:
        raise RuntimeError("PostgreSQL admin or migrator URL is required for RLS test schema reset")
    print(f"STATE: rls test schema reset url -> {admin_url}", flush=True)
    admin_engine = create_engine(admin_url, poolclass=NullPool)
    with admin_engine.begin() as connection:
        _apply_bootstrap_timeouts(connection)
        print("BEFORE: rls test drop schema if exists public cascade", flush=True)
        connection.exec_driver_sql("drop schema if exists public cascade")
        print("AFTER: rls test drop schema if exists public cascade", flush=True)
        print("BEFORE: rls test create schema public authorization flowtally_migrator", flush=True)
        connection.exec_driver_sql("create schema public authorization flowtally_migrator")
        print("AFTER: rls test create schema public authorization flowtally_migrator", flush=True)
        _restore_runtime_schema_privileges(connection)
        _log_connection_identity(connection, "rls test schema reset connection")
    admin_engine.dispose()


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


def _seed_admin_fixture(label: str, seed_fn):
    admin_application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": ADMIN_POSTGRES_URL or MIGRATION_POSTGRES_URL,
            "SESSION_COOKIE_SECURE": False,
            "ALLOWED_ORIGINS": ["http://127.0.0.1:5173"],
            "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://",
            "WTF_CSRF_ENABLED": True,
        }
    )
    with admin_application.app_context():
        print(f"STATE: {label} admin url -> {ADMIN_POSTGRES_URL or MIGRATION_POSTGRES_URL}", flush=True)
        _log_session_state(f"before {label} admin seed")
        connection = db.session.connection()
        _apply_bootstrap_timeouts(connection)
        _log_connection_identity(connection, f"{label} admin seed connection")
        try:
            result = seed_fn()
            db.session.commit()
            print(f"AFTER: {label} admin seed commit", flush=True)
            _log_session_state(f"after {label} admin seed commit")
            return result
        finally:
            print(f"BEFORE: {label} admin seed cleanup", flush=True)
            db.session.remove()
            _log_session_state(f"after {label} admin seed cleanup")
            print(f"AFTER: {label} admin seed cleanup", flush=True)


def _seed_admin_org_pair_with_suppliers(prefix: str) -> dict[str, object]:
    return _seed_admin_fixture(
        f"{prefix} org pair with suppliers",
        lambda: _seed_two_organizations_with_suppliers(
            User.query.filter_by(email=LOCAL_OWNER_EMAIL).first(),
            prefix,
        ),
    )


def _seed_admin_support_org(prefix: str, *, include_active_grant: bool = True) -> dict[str, object]:
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        support = User.query.filter_by(email="support@example.com").first()
        if support is None:
            support = User(email="support@example.com", is_active=True)
            support.set_password("Support123!")
            db.session.add(support)
            db.session.flush()
        org = _create_org(owner, f"{prefix} Support Org")
        db.session.add(Supplier(organization_id=org.id, name="Support Supplier", normalized_name="support supplier"))
        result: dict[str, object] = {"org_id": org.id, "support_id": support.id}
        if include_active_grant:
            active_grant = SupportAccessGrant(
                organization_id=org.id,
                support_user_id=support.id,
                reason="Investigate import issue",
                case_reference="CASE-123",
                status="active",
                starts_at=utc_now() - timedelta(minutes=1),
                expires_at=utc_now() + timedelta(minutes=30),
            )
            db.session.add(active_grant)
            db.session.flush()
            result["active_grant_id"] = active_grant.id
        return result

    return _seed_admin_fixture(f"{prefix} support org", _seed)


def _seed_admin_support_grant_for_org(*, label: str, org_id: int, support_id: int, case_reference: str, reason: str = "Investigate import issue") -> dict[str, object]:
    def _seed():
        grant = SupportAccessGrant(
            organization_id=org_id,
            support_user_id=support_id,
            reason=reason,
            case_reference=case_reference,
            status="active",
            starts_at=utc_now() - timedelta(minutes=1),
            expires_at=utc_now() + timedelta(minutes=30),
        )
        db.session.add(grant)
        db.session.flush()
        return {"active_grant_id": grant.id}

    return _seed_admin_fixture(label, _seed)


def _seed_admin_support_grant_dataset(prefix: str) -> dict[str, object]:
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        support = User.query.filter_by(email="support-rls@example.com").first()
        if support is None:
            support = User(email="support-rls@example.com", is_active=True)
            support.set_password("Support123!")
            db.session.add(support)
            db.session.flush()

        org_a = _create_org(owner, f"{prefix} Support Grant Alpha")
        org_b = _create_org(owner, f"{prefix} Support Grant Beta")
        db.session.add_all(
            [
                Supplier(organization_id=org_a.id, name="Alpha Supplier", normalized_name="alpha supplier"),
                Supplier(organization_id=org_b.id, name="Beta Supplier", normalized_name="beta supplier"),
            ]
        )

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
        db.session.flush()
        return {
            "org_a_id": org_a.id,
            "org_b_id": org_b.id,
            "support_id": support.id,
            "active_grant_id": active_grant.id,
            "expired_grant_id": expired_grant.id,
            "revoked_grant_id": revoked_grant.id,
        }

    return _seed_admin_fixture(f"{prefix} support grant dataset", _seed)


def _seed_admin_square_dataset(prefix: str) -> dict[str, object]:
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org_a = _create_org(owner, f"{prefix} Square Alpha")
        org_b = _create_org(owner, f"{prefix} Square Beta")
        connection_a = SquareConnection(organization_id=org_a.id, environment="sandbox", status="connected", square_merchant_id="merchant-a")
        connection_b = SquareConnection(organization_id=org_b.id, environment="sandbox", status="connected", square_merchant_id="merchant-b")
        db.session.add_all([connection_a, connection_b])
        db.session.flush()
        db.session.add(SquareOrder(square_connection_id=connection_a.id, square_order_id="order-a", square_location_id="LOC-A", order_state="COMPLETED"))
        db.session.add(SquareOrder(square_connection_id=connection_b.id, square_order_id="order-b", square_location_id="LOC-B", order_state="COMPLETED"))
        db.session.add(SquareDailySalesSummary(square_connection_id=connection_a.id, square_location_id="LOC-A", sale_date=utc_now().date()))
        db.session.add(SquareDailySalesSummary(square_connection_id=connection_b.id, square_location_id="LOC-B", sale_date=utc_now().date()))
        return {"org_a_id": org_a.id, "org_b_id": org_b.id, "connection_a_id": connection_a.id, "connection_b_id": connection_b.id}

    return _seed_admin_fixture(f"{prefix} square dataset", _seed)


def _seed_admin_daily_close_dataset(prefix: str) -> dict[str, object]:
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org_a = _create_org(owner, f"{prefix} Daily Close Alpha")
        org_b = _create_org(owner, f"{prefix} Daily Close Beta")
        location_a = RestaurantLocation.query.filter_by(organization_id=org_a.id).first()
        location_b = RestaurantLocation.query.filter_by(organization_id=org_b.id).first()
        assert location_a is not None
        assert location_b is not None
        db.session.add(
            DailyCloseSession(
                organization_id=org_a.id,
                location_id=location_a.id,
                business_date=utc_now().date(),
                status="DRAFT",
                summary_snapshot_json={"healthStatus": "Open"},
                usage_snapshot_json={},
                exceptions_snapshot_json=[],
                notes="",
                created_by_user_id=owner.id,
            )
        )
        db.session.add(
            DailyCloseSession(
                organization_id=org_b.id,
                location_id=location_b.id,
                business_date=utc_now().date(),
                status="COMPLETED",
                summary_snapshot_json={"healthStatus": "Reconciled"},
                usage_snapshot_json={},
                exceptions_snapshot_json=[],
                notes="",
                completed_by_user_id=owner.id,
                created_by_user_id=owner.id,
            )
        )
        db.session.flush()
        return {"org_a_id": org_a.id, "org_b_id": org_b.id}

    return _seed_admin_fixture(f"{prefix} daily close dataset", _seed)


def _seed_admin_import_dataset(prefix: str) -> dict[str, object]:
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org_a = _create_org(owner, f"{prefix} Import Alpha")
        org_b = _create_org(owner, f"{prefix} Import Beta")

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
        return {"org_a_id": org_a.id, "org_b_id": org_b.id, "owner_id": owner.id, "job_a_id": job_a.id, "job_b_id": job_b.id}

    return _seed_admin_fixture(f"{prefix} import dataset", _seed)


def _seed_admin_setup_dataset(prefix: str, *, separate_org_b_owner: bool = False) -> dict[str, object]:
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org_b_owner = owner
        if separate_org_b_owner:
            org_b_owner = User(email=f"{prefix.lower().replace(' ', '-')}-beta-owner-{uuid4().hex[:8]}@example.com", is_active=True)
            org_b_owner.set_password("BetaOwner123!")
            db.session.add(org_b_owner)
            db.session.flush()
        org_a = _create_org(owner, f"{prefix} Setup Alpha")
        org_b = _create_org(org_b_owner, f"{prefix} Setup Beta")
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
        return {"org_a_id": org_a.id, "org_b_id": org_b.id, "owner_id": owner.id}

    return _seed_admin_fixture(f"{prefix} setup dataset", _seed)


def _seed_admin_menu_costing_dataset(prefix: str) -> dict[str, object]:
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org_a = _create_org(owner, f"{prefix} Menu Alpha")
        org_b = _create_org(owner, f"{prefix} Menu Beta")

        location_a = RestaurantLocation.query.filter_by(organization_id=org_a.id).one()
        location_b = RestaurantLocation.query.filter_by(organization_id=org_b.id).one()

        inventory_a = InventoryItem(
            organization_id=org_a.id,
            location_id=location_a.id,
            supplier_id=None,
            name="Alpha Flour",
            normalized_name="alpha flour",
            category="Dry Goods",
            stock_unit="kg",
            current_on_hand=Decimal("10"),
            min_quantity=Decimal("1"),
            par_level=Decimal("5"),
            preferred_supplier_name="",
            latest_purchase_price=Decimal("4.99"),
            last_purchase_unit="kg",
            last_purchase_conversion_factor=Decimal("1"),
            active=True,
            notes="",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        inventory_b = InventoryItem(
            organization_id=org_b.id,
            location_id=location_b.id,
            supplier_id=None,
            name="Beta Flour",
            normalized_name="beta flour",
            category="Dry Goods",
            stock_unit="kg",
            current_on_hand=Decimal("10"),
            min_quantity=Decimal("1"),
            par_level=Decimal("5"),
            preferred_supplier_name="",
            latest_purchase_price=Decimal("4.99"),
            last_purchase_unit="kg",
            last_purchase_conversion_factor=Decimal("1"),
            active=True,
            notes="",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        db.session.add_all([inventory_a, inventory_b])
        db.session.flush()

        recipe_a = Recipe(
            organization_id=org_a.id,
            location_id=location_a.id,
            name="Alpha Sandwich",
            normalized_name="alpha sandwich",
            description="",
            yield_quantity=Decimal("1"),
            yield_unit="servings",
            active=True,
            notes="",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        recipe_b = Recipe(
            organization_id=org_b.id,
            location_id=location_b.id,
            name="Beta Sandwich",
            normalized_name="beta sandwich",
            description="",
            yield_quantity=Decimal("1"),
            yield_unit="servings",
            active=True,
            notes="",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        db.session.add_all([recipe_a, recipe_b])
        db.session.flush()

        ingredient_a = RecipeIngredient(
            organization_id=org_a.id,
            recipe_id=recipe_a.id,
            inventory_item_id=inventory_a.id,
            quantity_required=Decimal("0.25"),
            unit="kg",
            notes="",
            sort_order=1,
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        ingredient_b = RecipeIngredient(
            organization_id=org_b.id,
            recipe_id=recipe_b.id,
            inventory_item_id=inventory_b.id,
            quantity_required=Decimal("0.25"),
            unit="kg",
            notes="",
            sort_order=1,
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        menu_item_a = MenuItem(
            organization_id=org_a.id,
            location_id=location_a.id,
            recipe_id=recipe_a.id,
            name="Alpha Sandwich",
            normalized_name="alpha sandwich",
            category="Lunch",
            selling_price=Decimal("12.50"),
            active=True,
            notes="",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        menu_item_b = MenuItem(
            organization_id=org_b.id,
            location_id=location_b.id,
            recipe_id=recipe_b.id,
            name="Beta Sandwich",
            normalized_name="beta sandwich",
            category="Lunch",
            selling_price=Decimal("12.50"),
            active=True,
            notes="",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        db.session.add_all([ingredient_a, ingredient_b, menu_item_a, menu_item_b])
        db.session.commit()
        return {"org_a_id": org_a.id, "org_b_id": org_b.id}

    return _seed_admin_fixture(f"{prefix} menu costing dataset", _seed)


def _restore_rls_context(access_scope: str, organization_id: int | None = None, support_grant_id: int | None = None) -> None:
    _set_rls_context(access_scope=access_scope, organization_id=organization_id, support_grant_id=support_grant_id)


def _set_rls_context_on_connection(
    connection,
    *,
    access_scope: str,
    organization_id: int | None = None,
    support_grant_id: int | None = None,
    user_id: int | None = None,
) -> None:
    connection.execute(
        text("select set_config(:name, :value, true)"),
        {"name": "flowtally.access_scope", "value": access_scope},
    )
    connection.execute(
        text("select set_config(:name, :value, true)"),
        {"name": "flowtally.user_id", "value": "" if user_id is None else str(user_id)},
    )
    connection.execute(
        text("select set_config(:name, :value, true)"),
        {"name": "flowtally.organization_id", "value": "" if organization_id is None else str(organization_id)},
    )
    connection.execute(
        text("select set_config(:name, :value, true)"),
        {"name": "flowtally.support_grant_id", "value": "" if support_grant_id is None else str(support_grant_id)},
    )


def _log_probe(label: str, statement, params: dict[str, object] | None = None) -> object:
    return _log_scalar_probe(label, statement, params)


def _dump_function_metadata(name: str, argcount: int) -> None:
    _collect_function_catalog_diagnostics(
        name,
        argcount,
        detailed=name == "flowtally_current_access_scope",
        include_definition=False,
    )


def _dump_function_definition(name: str, argcount: int) -> None:
    _collect_function_catalog_diagnostics(
        name,
        argcount,
        detailed=False,
        include_definition=True,
    )


def _dump_policy_metadata(table_name: str) -> None:
    print(f"BEGIN POLICY DIAGNOSTICS {table_name}", flush=True)
    catalog_engine = create_engine(CATALOG_POSTGRES_URL, poolclass=NullPool)
    _run_session_probe(
        label=f"policy metadata {table_name} fixture",
        sql_category="pg_policies",
        statement="""
            select
                schemaname,
                tablename,
                policyname,
                permissive,
                roles,
                cmd,
                qual,
                with_check
            from pg_policies
            where tablename = :table_name
            order by policyname
        """,
        params={"table_name": table_name},
    )
    _run_pg_diagnostic_probe(
        catalog_engine,
        label=f"policy metadata {table_name} fresh",
        sql_category="pg_policies",
        statement="""
            select
                schemaname,
                tablename,
                policyname,
                permissive,
                roles,
                cmd,
                qual,
                with_check
            from pg_policies
            where tablename = :table_name
            order by policyname
        """,
        params={"table_name": table_name},
    )
    catalog_engine.dispose()
    print(f"END POLICY DIAGNOSTICS {table_name}", flush=True)


def _dump_pg_definitions() -> None:
    for name, argcount in [
        ("flowtally_current_access_scope", 0),
        ("flowtally_current_organization_id", 0),
        ("flowtally_current_support_grant_id", 0),
        ("flowtally_support_has_access", 1),
        ("flowtally_has_org_access", 1),
    ]:
        _collect_function_catalog_diagnostics(
            name,
            argcount,
            detailed=name == "flowtally_current_access_scope",
            include_definition=True,
        )

    for table_name in ["suppliers", "support_access_grants"]:
        _dump_policy_metadata(table_name)


@pytest.fixture()
def postgres_rls_probe_context(postgres_app):
    admin_application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": ADMIN_POSTGRES_URL or MIGRATION_POSTGRES_URL,
            "SESSION_COOKIE_SECURE": False,
            "ALLOWED_ORIGINS": ["http://127.0.0.1:5173"],
            "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://",
            "WTF_CSRF_ENABLED": True,
        }
    )
    with admin_application.app_context():
        print(f"STATE: postgres_rls_probe_context admin url -> {ADMIN_POSTGRES_URL or MIGRATION_POSTGRES_URL}", flush=True)
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None

        org_a = _create_org(owner, "RLS Probe Alpha")
        org_b = _create_org(owner, "RLS Probe Beta")
        db.session.add_all(
            [
                Supplier(organization_id=org_a.id, name="Alpha Supplier", normalized_name="alpha supplier"),
                Supplier(organization_id=org_b.id, name="Beta Supplier", normalized_name="beta supplier"),
            ]
        )

        support = User.query.filter_by(email="support-probe@example.com").first()
        if support is None:
            support = User(email="support-probe@example.com", is_active=True)
            support.set_password("Support123!")
            db.session.add(support)
        db.session.commit()

        active_grant = SupportAccessGrant(
            organization_id=org_a.id,
            support_user_id=support.id,
            reason="Probe grant",
            case_reference="CASE-PROBE",
            status="active",
            starts_at=utc_now() - timedelta(minutes=1),
            expires_at=utc_now() + timedelta(minutes=30),
        )
        db.session.add(active_grant)
        db.session.commit()

        probe_context = {
            "org_a_id": org_a.id,
            "org_b_id": org_b.id,
            "active_grant_id": active_grant.id,
        }
        print(f"STATE: postgres_rls_probe_context seeded -> {probe_context}", flush=True)
        db.session.remove()
    return probe_context


def test_postgres_rls_connection_sanity(postgres_app):
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer")
        assert _log_scalar_probe("sanity select 1", "select 1") == 1
        assert _log_scalar_probe("sanity now()", "select now()") is not None
        row = _log_row_probe("sanity current_user and session_user", "select current_user, session_user")
        assert row[0] == row[1]
        assert _log_scalar_probe("sanity current_database()", "select current_database()") == db.engine.url.database
        assert _log_scalar_probe("sanity pg_backend_pid()", "select pg_backend_pid()") > 0
        assert _log_scalar_probe("sanity statement_timeout", "show statement_timeout") in {"5s", "5000ms"}
        assert _log_scalar_probe("sanity lock_timeout", "show lock_timeout") in {"3s", "3000ms"}


def test_postgres_rls_activity_and_lock_snapshot(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=postgres_rls_probe_context["org_a_id"])
        _log_rows_probe(
            "pg_stat_activity snapshot",
            """
            select
                pid,
                usename,
                state,
                wait_event_type,
                wait_event,
                query
            from pg_stat_activity
            where datname = current_database()
            order by pid
            """,
        )
        _log_rows_probe(
            "pg_locks snapshot",
            """
            select
                pid,
                locktype,
                relation::regclass::text as relation_name,
                mode,
                granted
            from pg_locks
            where relation in (
                'pg_proc'::regclass,
                'pg_policy'::regclass,
                'pg_class'::regclass,
                'support_access_grants'::regclass,
                'suppliers'::regclass
            )
            order by pid, relation_name, mode
            """,
        )


def test_postgres_rls_function_metadata_current_access_scope(postgres_app):
    with postgres_app.app_context():
        _dump_function_metadata("flowtally_current_access_scope", 0)


def test_postgres_rls_function_metadata_current_organization_id(postgres_app):
    with postgres_app.app_context():
        _dump_function_metadata("flowtally_current_organization_id", 0)


@SUPPORT_ACCESS_DEFERRED
def test_postgres_rls_function_metadata_current_support_grant_id(postgres_app):
    with postgres_app.app_context():
        _dump_function_metadata("flowtally_current_support_grant_id", 0)


@SUPPORT_ACCESS_DEFERRED
def test_postgres_rls_function_metadata_support_has_access(postgres_app):
    with postgres_app.app_context():
        _dump_function_metadata("flowtally_support_has_access", 1)


def test_postgres_rls_function_metadata_has_org_access(postgres_app):
    with postgres_app.app_context():
        _dump_function_metadata("flowtally_has_org_access", 1)


def test_postgres_rls_function_definition_current_access_scope(postgres_app):
    with postgres_app.app_context():
        _dump_function_definition("flowtally_current_access_scope", 0)


def test_postgres_rls_function_definition_current_organization_id(postgres_app):
    with postgres_app.app_context():
        _dump_function_definition("flowtally_current_organization_id", 0)


@SUPPORT_ACCESS_DEFERRED
def test_postgres_rls_function_definition_current_support_grant_id(postgres_app):
    with postgres_app.app_context():
        _dump_function_definition("flowtally_current_support_grant_id", 0)


@SUPPORT_ACCESS_DEFERRED
def test_postgres_rls_function_definition_support_has_access(postgres_app):
    with postgres_app.app_context():
        _dump_function_definition("flowtally_support_has_access", 1)


def test_postgres_rls_function_definition_has_org_access(postgres_app):
    with postgres_app.app_context():
        _dump_function_definition("flowtally_has_org_access", 1)


def test_postgres_rls_policy_metadata_suppliers(postgres_app):
    with postgres_app.app_context():
        _dump_policy_metadata("suppliers")


@SUPPORT_ACCESS_DEFERRED
def test_postgres_rls_policy_metadata_support_access_grants(postgres_app):
    with postgres_app.app_context():
        _dump_policy_metadata("support_access_grants")


def test_rls_hides_other_tenant_rows(postgres_app):
    seeded = _seed_admin_fixture(
        "test_rls_hides_other_tenant_rows",
        lambda: _seed_two_organizations_with_suppliers(
            User.query.filter_by(email=LOCAL_OWNER_EMAIL).first(),
            "RLS",
        ),
    )
    with postgres_app.app_context():
        print("BEFORE: test_rls_hides_other_tenant_rows show statement_timeout", flush=True)
        statement_timeout = db.session.execute(text("show statement_timeout")).scalar_one()
        print(f"STATE: test_rls_hides_other_tenant_rows statement_timeout -> {statement_timeout}", flush=True)
        _apply_diagnostic_timeouts(db.session.connection())
        print("AFTER: test_rls_hides_other_tenant_rows show statement_timeout", flush=True)
        org_a_id = seeded["org_a_id"]
        org_b_id = seeded["org_b_id"]
        print("BEFORE: test_rls_hides_other_tenant_rows set customer context", flush=True)
        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        _log_row_probe(
            "test_rls_hides_other_tenant_rows active role metadata",
            """
            select
                current_user,
                session_user,
                current_role,
                current_setting('row_security', true),
                current_setting('flowtally.access_scope', true),
                current_setting('flowtally.organization_id', true),
                current_setting('flowtally.support_grant_id', true)
            """,
        )
        _log_row_probe(
            "test_rls_hides_other_tenant_rows role flags",
            """
            select rolname, rolsuper, rolbypassrls
            from pg_roles
            where rolname = current_user
            """,
        )
        _log_row_probe(
            "test_rls_hides_other_tenant_rows suppliers ownership metadata",
            """
            select
                c.relname,
                r.rolname as table_owner,
                c.relrowsecurity,
                c.relforcerowsecurity
            from pg_class c
            join pg_roles r on r.oid = c.relowner
            where c.relname = 'suppliers'
            """,
        )
        _log_rows_probe(
            "test_rls_hides_other_tenant_rows supplier visibility snapshot",
            "select id, organization_id from suppliers order by organization_id, id",
        )
        print("AFTER: test_rls_hides_other_tenant_rows set customer context", flush=True)
        _log_row_probe(
            "test_rls_hides_other_tenant_rows context snapshot",
            """
            select
                flowtally_access_scope(),
                flowtally_current_organization_id(),
                flowtally_current_support_grant_id(),
                current_setting('flowtally.access_scope', true),
                current_setting('flowtally.organization_id', true),
                current_setting('flowtally.support_grant_id', true)
            """,
        )
        _log_supplier_enforcement_snapshot(org_a_id=org_a_id, org_b_id=org_b_id)
        print("BEFORE: test_rls_hides_other_tenant_rows supplier count org_a", flush=True)
        assert Supplier.query.filter_by(organization_id=org_a_id).count() == 1
        print("AFTER: test_rls_hides_other_tenant_rows supplier count org_a", flush=True)
        print("BEFORE: test_rls_hides_other_tenant_rows supplier count org_b", flush=True)
        assert Supplier.query.filter_by(organization_id=org_b_id).count() == 0
        print("AFTER: test_rls_hides_other_tenant_rows supplier count org_b", flush=True)

        print("BEFORE: test_rls_hides_other_tenant_rows direct count org_b", flush=True)
        rows = db.session.execute(text("select count(*) from suppliers where organization_id = :org_id"), {"org_id": org_b_id}).scalar_one()
        print("AFTER: test_rls_hides_other_tenant_rows direct count org_b", flush=True)
        assert rows == 0


def test_rls_blocks_cross_tenant_insert_and_update(postgres_app):
    seeded = _seed_admin_fixture(
        "test_rls_blocks_cross_tenant_insert_and_update",
        lambda: _seed_two_organizations_with_suppliers(
            User.query.filter_by(email=LOCAL_OWNER_EMAIL).first(),
            "RLS Insert",
        ),
    )
    with postgres_app.app_context():
        org_a_id = seeded["org_a_id"]
        org_b_id = seeded["org_b_id"]

        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        db.session.add(Supplier(organization_id=org_b_id, name="Wrong Org", normalized_name="wrong org"))
        with pytest.raises(Exception):
            db.session.commit()
        db.session.rollback()
        _restore_rls_context("customer", organization_id=org_a_id)

        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        supplier = Supplier(organization_id=org_a_id, name="Right Org", normalized_name="right org")
        db.session.add(supplier)
        db.session.commit()

        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        db.session.execute(text("update suppliers set name = :name where id = :id"), {"name": "Changed", "id": supplier.id})
        db.session.commit()
        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        assert Supplier.query.filter_by(id=supplier.id).first().name == "Changed"

        _set_rls_context(access_scope="customer", organization_id=org_b_id)
        result = db.session.execute(text("update suppliers set name = :name where id = :id"), {"name": "Blocked", "id": supplier.id})
        db.session.commit()
        assert result.rowcount == 0
        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        assert Supplier.query.filter_by(id=supplier.id).first().name == "Changed"


@SUPPORT_ACCESS_DEFERRED
def test_support_requires_active_grant(postgres_app):
    seeded = _seed_admin_support_org("RLS", include_active_grant=False)
    with postgres_app.app_context():
        org_id = seeded["org_id"]
        support_id = seeded["support_id"]

        _set_rls_context(access_scope="support", organization_id=org_id, support_grant_id=None)
        assert Supplier.query.filter_by(organization_id=org_id).count() == 0

        grant_seed = _seed_admin_support_grant_for_org(
            label="test_support_requires_active_grant active grant",
            org_id=org_id,
            support_id=support_id,
            case_reference="CASE-123",
        )
        active_grant_id = grant_seed["active_grant_id"]
        _set_rls_context(access_scope="support", organization_id=org_id, support_grant_id=active_grant_id)
        assert Supplier.query.filter_by(organization_id=org_id).count() == 1


@SUPPORT_ACCESS_DEFERRED
def test_support_access_grants_are_not_recursive_and_respect_scope(postgres_app):
    seeded = _seed_admin_support_grant_dataset("RLS")
    with postgres_app.app_context():
        org_a_id = seeded["org_a_id"]
        org_b_id = seeded["org_b_id"]
        active_grant_id = seeded["active_grant_id"]
        expired_grant_id = seeded["expired_grant_id"]
        revoked_grant_id = seeded["revoked_grant_id"]
        support_id = seeded["support_id"]

        _set_rls_context(access_scope="support", organization_id=org_a_id, support_grant_id=active_grant_id)
        assert Supplier.query.filter_by(organization_id=org_a_id).count() == 1
        assert Supplier.query.filter_by(organization_id=org_b_id).count() == 0

        _set_rls_context(access_scope="support", organization_id=org_b_id, support_grant_id=expired_grant_id)
        assert Supplier.query.filter_by(organization_id=org_b_id).count() == 0

        _set_rls_context(access_scope="support", organization_id=org_a_id, support_grant_id=revoked_grant_id)
        assert Supplier.query.filter_by(organization_id=org_a_id).count() == 0

        _set_rls_context(access_scope="support", organization_id=org_a_id, support_grant_id=active_grant_id)
        with pytest.raises(Exception):
            db.session.add(
                SupportAccessGrant(
                    organization_id=org_a_id,
                    support_user_id=support_id,
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
            active_grant = db.session.get(SupportAccessGrant, active_grant_id)
            assert active_grant is not None
            active_grant.expires_at = active_grant.expires_at + timedelta(minutes=10)
            db.session.commit()
        db.session.rollback()

        with pytest.raises(Exception):
            active_grant = db.session.get(SupportAccessGrant, active_grant_id)
            assert active_grant is not None
            active_grant.organization_id = org_b_id
            db.session.commit()
        db.session.rollback()

        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        with pytest.raises(Exception):
            db.session.add(
                SupportAccessGrant(
                    organization_id=org_a_id,
                    support_user_id=support_id,
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
            active_grant = db.session.get(SupportAccessGrant, active_grant_id)
            assert active_grant is not None
            active_grant.revoked_at = utc_now()
            db.session.commit()
        db.session.rollback()

        _set_rls_context(access_scope="setup")
        setup_grant = SupportAccessGrant(
            organization_id=org_b_id,
            support_user_id=support_id,
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


@SUPPORT_ACCESS_DEFERRED
def test_postgres_rls_authorization_chain_diagnostics(postgres_app):
    seeded = _seed_admin_support_grant_dataset("RLS Probe")
    with postgres_app.app_context():
        _dump_pg_definitions()

        org_a_id = seeded["org_a_id"]
        active_grant_id = seeded["active_grant_id"]

        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        _log_probe("1 flowtally_access_scope()", "select flowtally_access_scope()")
        _log_probe("2 flowtally_current_organization_id()", "select flowtally_current_organization_id()")
        _log_probe("3 flowtally_current_support_grant_id()", "select flowtally_current_support_grant_id()")
        _log_probe("4 support_access_grants count", "select count(*) from support_access_grants")

        _set_rls_context(access_scope="customer", organization_id=org_a_id, support_grant_id=active_grant_id)
        _log_probe("5 flowtally_support_has_access(org_a)", "select flowtally_support_has_access(:org_id)", {"org_id": org_a_id})
        _log_probe("6 flowtally_has_org_access(org_a)", "select flowtally_has_org_access(:org_id)", {"org_id": org_a_id})
        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        _log_probe(
            "7 suppliers count for org_a",
            "select count(*) from suppliers where organization_id = :org_id",
            {"org_id": org_a_id},
        )


def test_postgres_rls_probe_definitions(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _dump_pg_definitions()


def test_postgres_rls_probe_1_access_scope(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        with db.engine.connect() as connection:
            _apply_diagnostic_timeouts(connection)
            before_pid = connection.execute(text("select pg_backend_pid()")).scalar_one()
            print(f"STATE: probe 1 runtime connection before set_config -> backend_pid={before_pid}", flush=True)
            _set_rls_context_on_connection(
                connection,
                access_scope="customer",
                organization_id=postgres_rls_probe_context["org_a_id"],
            )
            after_set_pid = connection.execute(text("select pg_backend_pid()")).scalar_one()
            print(f"STATE: probe 1 runtime connection after set_config -> backend_pid={after_set_pid}", flush=True)
            context_row = connection.execute(
                text(
                    """
                    select
                        current_user,
                        session_user,
                        current_role,
                        current_setting('flowtally.access_scope', true),
                        current_setting('flowtally.organization_id', true),
                        current_setting('flowtally.support_grant_id', true),
                        flowtally_access_scope()
                    """
                )
            ).one()
            final_pid = connection.execute(text("select pg_backend_pid()")).scalar_one()
            print(f"STATE: probe 1 runtime connection after helper -> backend_pid={final_pid}", flush=True)
            print(f"STATE: probe 1 runtime tuple -> {tuple(context_row)}", flush=True)
            runtime_tuple = tuple(context_row)
            print(
                f"::warning file=backend/tests/test_postgres_rls.py,line=1730::runtime context probe: {runtime_tuple!r}",
                flush=True,
            )
            assert before_pid == after_set_pid == final_pid, f"runtime context probe pid mismatch: {runtime_tuple!r}"
            assert runtime_tuple[0] == "flowtally_runtime", f"runtime context probe: {runtime_tuple!r}"
            assert runtime_tuple[1] == "flowtally_runtime", f"runtime context probe: {runtime_tuple!r}"
            assert runtime_tuple[2] == "flowtally_runtime", f"runtime context probe: {runtime_tuple!r}"
            assert runtime_tuple[3] == "customer", f"runtime context probe: {runtime_tuple!r}"
            assert runtime_tuple[4] == str(postgres_rls_probe_context["org_a_id"]), f"runtime context probe: {runtime_tuple!r}"
            assert runtime_tuple[5] in (None, ""), f"runtime context probe: {runtime_tuple!r}"
            assert runtime_tuple[6] == "customer", f"runtime context probe: {runtime_tuple!r}"


def test_postgres_rls_probe_2_current_organization_id(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=postgres_rls_probe_context["org_a_id"])
        assert _log_probe("2 flowtally_current_organization_id()", "select flowtally_current_organization_id()") == postgres_rls_probe_context["org_a_id"]


def test_postgres_onboarding_bootstrap_creates_prospect_organization(postgres_app):
    with postgres_app.app_context():
        client = postgres_app.test_client()
        zero_org_email = f"zero-org-onboarding-{int(time.time() * 1000)}@example.com"
        zero_org_password = "ZeroOrg!123"
        zero_org_user = User(email=zero_org_email, is_active=True)
        zero_org_user.set_password(zero_org_password)
        db.session.add(zero_org_user)
        db.session.flush()
        zero_org_user_id = zero_org_user.id
        db.session.commit()

        assert OrganizationMembership.query.filter_by(user_id=zero_org_user_id).count() == 0
        assert Organization.query.join(OrganizationMembership).filter(OrganizationMembership.user_id == zero_org_user_id).count() == 0
        assert PlatformRole.query.filter_by(user_id=zero_org_user_id).count() == 0
        _github_warning("onboarding regression: zero-org user seeded")

        with client.session_transaction(base_url="http://127.0.0.1:5001") as session:
            assert "pilot_current_organization_id" not in session
            assert "pilot_current_location_id" not in session

        _github_warning("onboarding regression: session confirmed empty before login")
        _login_user(client, zero_org_email, zero_org_password)
        _github_warning("onboarding regression: authenticated zero-org user")

        _github_warning("onboarding regression: before onboarding POST")
        response = client.post(
            "/api/onboarding/organizations",
            base_url="http://127.0.0.1:5001",
            json={
                "name": "Flowtally Test Cafe",
                "templateKey": "GENERIC_RESTAURANT",
                "locationName": "Flowtally Test Kitchen",
                "city": "Toronto",
            },
            headers={"X-CSRFToken": client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001").get_json()["csrfToken"]},
        )
        _github_warning(f"onboarding regression: after onboarding POST status={response.status_code}")

        assert response.status_code == 201, response.get_data(as_text=True)
        _github_warning("onboarding regression: onboarding POST returned 201")
        body = response.get_json()
        assert body["membershipRole"] == "owner"
        organization_id = body["organization"]["id"]
        current_location_id = body["currentLocationId"]
        assert current_location_id > 0

        _set_rls_context(access_scope="setup", organization_id=organization_id)
        organization = Organization.query.filter_by(id=organization_id).first()
        assert organization is not None
        assert organization.name == "Flowtally Test Cafe"
        assert organization.lifecycle_status == "ONBOARDING"
        assert organization.setup_status == "INTAKE"
        assert organization.subscription_status == "NONE"
        assert organization.is_prospect is True
        assert OrganizationMembership.query.filter_by(organization_id=organization_id).count() == 1
        assert RestaurantLocation.query.filter_by(organization_id=organization_id).count() == 1
        assert OrganizationConfiguration.query.filter_by(organization_id=organization_id).count() == 1
        configuration = OrganizationConfiguration.query.filter_by(organization_id=organization_id).first()
        assert configuration is not None
        assert configuration.draft_name == "Flowtally Test Cafe setup"
        module_keys = {
            module.module_key
            for module in OrganizationModule.query.filter_by(organization_id=organization_id).all()
        }
        assert module_keys == {"PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS", "MENU_COSTING", "DAILY_CLOSE"}
        _github_warning("onboarding regression: persisted organization, location, modules, and configuration")
        with postgres_app.app_context():
            _set_rls_context(access_scope="setup", organization_id=organization_id)
            membership = OrganizationMembership.query.filter_by(organization_id=organization_id, user_id=zero_org_user_id).first()
            assert membership is not None
            membership_id = membership.id

        with postgres_app.app_context():
            _set_rls_context(access_scope="setup", organization_id=organization_id)
            other_user = User(email=f"onboarding-other-{int(time.time() * 1000)}@example.com", is_active=True)
            other_user.set_password("OtherOrg!123")
            db.session.add(other_user)
            db.session.flush()
            other_org = Organization(
                name=f"Other Tenant Cafe {int(time.time() * 1000)}",
                lifecycle_status="ONBOARDING",
                setup_status="INTAKE",
                subscription_status="NONE",
                setup_template_key="CAFE",
                setup_fee_status="NONE",
                is_prospect=True,
            )
            db.session.add(other_org)
            db.session.flush()
            other_org_id = other_org.id
            db.session.add(OrganizationMembership(user_id=other_user.id, organization_id=other_org.id, role="owner"))
            db.session.commit()

        with client.session_transaction(base_url="http://127.0.0.1:5001") as session:
            session.pop("pilot_current_membership_id", None)
            session.pop("pilot_current_organization_id", None)
            session.pop("pilot_current_location_id", None)

        me_response = client.get("/api/auth/me", base_url="http://127.0.0.1:5001")
        assert me_response.status_code == 200, me_response.get_data(as_text=True)
        me_body = me_response.get_json()
        assert me_body["currentOrganizationId"] == organization_id, me_body
        assert me_body["currentLocationId"] == current_location_id, me_body
        assert me_body["organizations"], me_body
        assert me_body["organizations"][0]["organization"]["id"] == organization_id, me_body
        assert me_body["organizations"][0]["selected"] is True, me_body
        assert all(entry["organization"]["id"] != other_org_id for entry in me_body["organizations"]), me_body

        locations_response = client.get("/api/locations", base_url="http://127.0.0.1:5001")
        assert locations_response.status_code == 200, locations_response.get_data(as_text=True)
        locations_body = locations_response.get_json()
        assert locations_body["organizationId"] == organization_id, locations_body
        assert locations_body["currentLocation"]["id"] == current_location_id, locations_body
        assert len(locations_body["restaurantLocations"]) == 1, locations_body
        assert locations_body["restaurantLocations"][0]["id"] == current_location_id, locations_body

        select_response = client.post(
            "/api/organizations/select",
            base_url="http://127.0.0.1:5001",
            headers={
                "X-CSRFToken": client.get(
                    "/api/auth/csrf",
                    base_url="http://127.0.0.1:5001",
                ).get_json()["csrfToken"]
            },
            json={"organizationId": organization_id},
        )
        assert select_response.status_code == 200, select_response.get_data(as_text=True)

        with postgres_app.app_context():
            _set_rls_context(access_scope="customer", organization_id=organization_id, user_id=zero_org_user_id)
            organization_selected_events = AuditEvent.query.filter_by(
                event_type="tenant.organization_selected",
                entity_type="organization",
                entity_id=str(organization_id),
                organization_id=organization_id,
                actor_user_id=zero_org_user_id,
            ).all()
            assert len(organization_selected_events) == 1

        with client.session_transaction(base_url="http://127.0.0.1:5001") as session:
            assert session["pilot_current_membership_id"] == membership_id
            assert session["pilot_current_organization_id"] == organization_id
            assert session["pilot_current_location_id"] == current_location_id

        follow_up = client.get("/api/onboarding/organizations", base_url="http://127.0.0.1:5001")
        assert follow_up.status_code == 200, follow_up.get_data(as_text=True)
        follow_up_body = follow_up.get_json()
        assert any(entry["organization"]["id"] == organization_id for entry in follow_up_body["organizations"])

        with postgres_app.app_context():
            _set_rls_context(access_scope="customer", organization_id=organization_id, user_id=zero_org_user_id)
            assert (
                AuditEvent.query.filter_by(
                    event_type="tenant.organization_selected",
                    entity_type="organization",
                    entity_id=str(organization_id),
                    organization_id=organization_id,
                    actor_user_id=zero_org_user_id,
                ).count()
                == 1
            )
        _github_warning("onboarding regression: follow-up onboarding list sees new organization")


def test_postgres_setup_console_mutations_materialize_before_commit(postgres_app):
    # Org B needs its own owner so the later "other organizations are not listed for this owner" check is meaningful.
    seeded = _seed_admin_setup_dataset("RLS Setup Console", separate_org_b_owner=True)
    with postgres_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        owner_id = owner.id
        if PlatformRole.query.filter_by(user_id=owner.id, role="setup_admin", is_active=True).first() is None:
            db.session.add(PlatformRole(user_id=owner.id, role="setup_admin", is_active=True))
            db.session.commit()

        _set_rls_context(access_scope="setup")
        org_a_id = seeded["org_a_id"]
        org_b_id = seeded["org_b_id"]
        org_a_location = RestaurantLocation.query.filter_by(organization_id=org_a_id).order_by(RestaurantLocation.id.asc()).first()
        assert org_a_location is not None
        org_a_location_id = org_a_location.id
        org_b_module_snapshot = {
            module.module_key: module.status
            for module in OrganizationModule.query.filter_by(organization_id=org_b_id).all()
        }

    client = postgres_app.test_client()
    _login_owner(client)

    def csrf_headers() -> dict[str, str]:
        return {"X-CSRFToken": client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001").get_json()["csrfToken"]}

    template_response = client.post(
        f"/api/platform/setup/organizations/{org_a_id}/template",
        base_url="http://127.0.0.1:5001",
        headers=csrf_headers(),
        json={"templateKey": "GENERIC_RESTAURANT"},
    )
    assert template_response.status_code == 200, template_response.get_data(as_text=True)
    assert template_response.get_json()["organization"]["setupTemplateKey"] == "GENERIC_RESTAURANT"

    module_response = client.post(
        f"/api/platform/setup/organizations/{org_a_id}/modules",
        base_url="http://127.0.0.1:5001",
        headers=csrf_headers(),
        json={
            "modules": [
                {"moduleKey": "PURCHASES", "status": "ENABLED"},
                {"moduleKey": "INVENTORY", "status": "ENABLED"},
                {"moduleKey": "MENU_COSTING", "status": "ENABLED"},
                {"moduleKey": "DAILY_CLOSE", "status": "ENABLED"},
                {"moduleKey": "REORDER_PLANS", "status": "ENABLED"},
                {"moduleKey": "STOCK_COUNTS", "status": "ENABLED"},
            ]
        },
    )
    assert module_response.status_code == 200, module_response.get_data(as_text=True)
    module_body = module_response.get_json()
    module_statuses = {entry["key"]: entry["status"] for entry in module_body["modules"]}
    assert module_statuses["PURCHASES"] == "ENABLED"
    assert module_statuses["INVENTORY"] == "ENABLED"
    assert module_statuses["REORDER_PLANS"] == "ENABLED"
    assert module_statuses["STOCK_COUNTS"] == "ENABLED"
    assert module_body["checklist"]["missingModules"] == []

    with postgres_app.app_context():
        _set_rls_context(access_scope="setup")
        assert (
            AuditEvent.query.filter_by(
                event_type="setup.modules_updated",
                entity_type="organization",
                entity_id=str(org_a_id),
                organization_id=org_a_id,
                actor_user_id=owner_id,
            ).count()
            == 1
        )

    assert (
        client.post(
            f"/api/platform/setup/organizations/{org_a_id}/locations",
            base_url="http://127.0.0.1:5001",
            headers=csrf_headers(),
            json={"locations": [{"id": org_a_location_id, "name": "Setup Kitchen", "city": "Toronto"}]},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/platform/setup/organizations/{org_a_id}/dashboard-layout",
            base_url="http://127.0.0.1:5001",
            headers=csrf_headers(),
            json={"layoutKey": "owner", "widgets": ["sales-today", "inventory-alerts"]},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/platform/setup/organizations/{org_a_id}/custom-fields",
            base_url="http://127.0.0.1:5001",
            headers=csrf_headers(),
            json={"fields": {"supplier": [], "inventoryItem": [], "purchaseInvoice": []}},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/platform/setup/organizations/{org_a_id}/notes",
            base_url="http://127.0.0.1:5001",
            headers=csrf_headers(),
            json={"notes": ["Ready for platform review"]},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/platform/setup/organizations/{org_a_id}/blockers",
            base_url="http://127.0.0.1:5001",
            headers=csrf_headers(),
            json={"blockers": []},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/platform/setup/organizations/{org_a_id}/imports",
            base_url="http://127.0.0.1:5001",
            headers=csrf_headers(),
            json={"imports": []},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/platform/setup/organizations/{org_a_id}/square",
            base_url="http://127.0.0.1:5001",
            headers=csrf_headers(),
            json={"square": {"required": False, "locationMappings": []}},
        ).status_code
        == 200
    )
    assert client.post(f"/api/platform/setup/organizations/{org_a_id}/review", base_url="http://127.0.0.1:5001", headers=csrf_headers()).status_code == 200
    assert (
        client.post(f"/api/platform/setup/organizations/{org_a_id}/review/approve", base_url="http://127.0.0.1:5001", headers=csrf_headers()).status_code
        == 200
    )
    # The seeded setup dataset leaves an UPLOADED import job on org A. The product
    # correctly refuses activation while an import is unapproved, so approve it
    # here the way an operator would before requesting the final state change.
    with postgres_app.app_context():
        _set_rls_context(access_scope="setup")
        for import_job in DataImportJob.query.filter_by(organization_id=org_a_id).all():
            import_job.status = "APPROVED"
        db.session.commit()

    state_response = client.post(
        f"/api/platform/setup/organizations/{org_a_id}/state",
        base_url="http://127.0.0.1:5001",
        headers=csrf_headers(),
        json={
            "lifecycleStatus": "READY_FOR_REVIEW",
            "setupStatus": "COMPLETE",
            "subscriptionStatus": "ACTIVE",
            "setupFeeStatus": "confirmed",
        },
    )
    assert state_response.status_code == 200, state_response.get_data(as_text=True)
    assert state_response.get_json()["checklist"]["readyForActivation"] is True, state_response.get_json()["checklist"]
    assert client.post(f"/api/platform/setup/organizations/{org_a_id}/activate", base_url="http://127.0.0.1:5001", headers=csrf_headers()).status_code == 200

    with postgres_app.app_context():
        _set_rls_context(access_scope="setup")
        organization = Organization.query.filter_by(id=org_a_id).first()
        assert organization is not None
        assert organization.lifecycle_status == "ACTIVE"
        assert organization.setup_status == "COMPLETE"
        assert organization.subscription_status == "ACTIVE"

        persisted_modules = {
            module.module_key: module.status
            for module in OrganizationModule.query.filter_by(organization_id=org_a_id).all()
        }
        assert persisted_modules["PURCHASES"] == "ENABLED"
        assert persisted_modules["INVENTORY"] == "ENABLED"
        assert persisted_modules["REORDER_PLANS"] == "ENABLED"
        assert persisted_modules["STOCK_COUNTS"] == "ENABLED"

        assert {
            module.module_key: module.status
            for module in OrganizationModule.query.filter_by(organization_id=org_b_id).all()
        } == org_b_module_snapshot

        layout = DashboardLayout.query.filter_by(organization_id=org_a_id, role="owner").first()
        assert layout is not None
        assert layout.widgets_json == ["sales-today", "inventory-alerts"]

    # The owner belongs to several organizations, so the customer-facing view needs
    # an explicit selection (as the real UI does) before org-scoped reads.
    select_org_response = client.post(
        "/api/organizations/select",
        base_url="http://127.0.0.1:5001",
        headers=csrf_headers(),
        json={"organizationId": org_a_id},
    )
    assert select_org_response.status_code == 200, select_org_response.get_data(as_text=True)

    me_response = client.get("/api/auth/me", base_url="http://127.0.0.1:5001")
    assert me_response.status_code == 200, me_response.get_data(as_text=True)
    me_body = me_response.get_json()
    assert me_body["currentOrganizationId"] == org_a_id, me_body
    assert me_body["currentLocationId"] == org_a_location_id, me_body
    assert all(entry["organization"]["id"] != org_b_id for entry in me_body["organizations"]), me_body

    dashboard_response = client.get("/api/pilot/dashboard", base_url="http://127.0.0.1:5001")
    assert dashboard_response.status_code == 200, dashboard_response.get_data(as_text=True)
    dashboard_body = dashboard_response.get_json()
    # The dashboard snapshot does not echo the location; scope is proven by an
    # empty tenant seeing none of the seeded pilot organization's invoices.
    assert dashboard_body["recentInvoices"] == [], dashboard_body
    assert dashboard_body["summary"]["monthlyInvoiceCount"] == 0, dashboard_body


def test_postgres_operational_mutations_materialize_before_commit(postgres_app):
    owner_email = f"owner-{uuid4().hex[:8]}@example.com"
    owner_password = f"PilotOwner-{uuid4().hex[:12]}!"
    other_email = f"other-{uuid4().hex[:8]}@example.com"
    other_password = f"PilotOther-{uuid4().hex[:12]}!"

    with postgres_app.app_context():
        owner = User(email=owner_email, is_active=True)
        owner.set_password(owner_password)
        db.session.add(owner)
        db.session.flush()
        org_a_name = f"Purchase Trial {uuid4().hex[:8]}"
        org_a_location_name = f"Purchase Kitchen {uuid4().hex[:8]}"
        _set_rls_context(access_scope="setup", user_id=owner.id)
        make_operational_organization(
            owner,
            name=org_a_name,
            location_name=org_a_location_name,
            enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING", "DAILY_CLOSE", "STOCK_COUNTS", "REORDER_PLANS"),
        )
        _set_rls_context(access_scope="setup", user_id=owner.id)
        organization_id = Organization.query.filter_by(name=org_a_name).first().id
        location_id = RestaurantLocation.query.filter_by(organization_id=organization_id, name=org_a_location_name).first().id
        db.session.remove()

    with postgres_app.app_context():
        other_owner = User(email=other_email, is_active=True)
        other_owner.set_password(other_password)
        db.session.add(other_owner)
        db.session.flush()
        other_org_name = f"Purchase Trial Other {uuid4().hex[:8]}"
        other_location_name = f"Other Kitchen {uuid4().hex[:8]}"
        _set_rls_context(access_scope="setup", user_id=other_owner.id)
        make_operational_organization(
            other_owner,
            name=other_org_name,
            location_name=other_location_name,
            enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING", "DAILY_CLOSE", "STOCK_COUNTS", "REORDER_PLANS"),
        )
        db.session.remove()

    client = postgres_app.test_client()
    _login_user(client, owner_email, owner_password)

    def csrf_headers() -> dict[str, str]:
        return {"X-CSRFToken": client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001").get_json()["csrfToken"]}

    supplier_name = f"Trial Dairy {uuid4().hex[:8]}"
    item_name = f"Trial Cream {uuid4().hex[:8]}"
    invoice_number = f"TRIAL-{uuid4().hex[:8].upper()}"

    supplier_response = client.post(
        "/api/pilot/suppliers",
        base_url="http://127.0.0.1:5001",
        headers=csrf_headers(),
        json={
            "name": supplier_name,
            "categoryFocus": "Dairy",
            "contactName": "Trial Buyer",
            "contactPhone": "416-555-0144",
            "contactEmail": "buyer@example.com",
            "orderingNotes": "Call before noon.",
            "notes": "Operational mutation regression.",
            "isActive": True,
        },
    )
    assert supplier_response.status_code == 201, supplier_response.get_data(as_text=True)
    supplier = supplier_response.get_json()
    assert supplier["name"] == supplier_name

    supplier_list = client.get("/api/pilot/suppliers", base_url="http://127.0.0.1:5001")
    assert supplier_list.status_code == 200, supplier_list.get_data(as_text=True)
    assert any(entry["id"] == supplier["id"] for entry in supplier_list.get_json()["suppliers"])

    inventory_response = client.post(
        "/api/pilot/inventory/items",
        base_url="http://127.0.0.1:5001",
        headers=csrf_headers(),
        json={
            "name": item_name,
            "category": "Dairy",
            "stockUnit": "case",
            "currentOnHand": 0,
            "minQuantity": 0,
            "parLevel": 0,
            "preferredSupplierName": supplier_name,
            "latestPurchasePrice": 10.0,
            "lastPurchaseUnit": "case",
            "lastPurchaseConversionFactor": 1,
            "averageDailyUsage": 0,
            "notes": "Operational mutation regression.",
            "active": True,
        },
    )
    assert inventory_response.status_code == 201, inventory_response.get_data(as_text=True)
    item = inventory_response.get_json()
    assert item["name"] == item_name

    purchase_response = client.post(
        "/api/pilot/purchases/invoices",
        base_url="http://127.0.0.1:5001",
        headers=csrf_headers(),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": invoice_number,
            "invoiceDate": "2026-08-18",
            "subtotal": 20.0,
            "tax": 2.6,
            "totalAmount": 22.6,
            "notes": "Operational mutation regression.",
            "status": "Draft",
            "sourceFileName": "trial-invoice.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "manual",
            "extractedText": "Trial Cream 2 case $10.00",
            "lineItems": [
                {
                    "description": item_name,
                    "inventoryItemId": item["id"],
                    "purchaseUnit": "case",
                    "inventoryUnit": "case",
                    "conversionFactor": 1,
                    "quantity": 2,
                    "unitPrice": 10.0,
                    "lineTotal": 20.0,
                    "confidence": 0.98,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert purchase_response.status_code == 201, purchase_response.get_data(as_text=True)
    invoice = purchase_response.get_json()
    assert invoice["supplier"]["name"] == supplier_name
    assert invoice["lineItems"][0]["inventoryItemId"] == item["id"]

    invoice_update = client.patch(
        f"/api/pilot/purchases/invoices/{invoice['id']}",
        base_url="http://127.0.0.1:5001",
        headers=csrf_headers(),
        json={
            "supplierName": supplier_name,
            "invoiceNumber": invoice_number,
            "invoiceDate": "2026-08-18",
            "subtotal": 20.0,
            "tax": 2.6,
            "totalAmount": 22.6,
            "notes": "Updated operational mutation regression.",
            "status": "Draft",
            "lineItems": [
                {
                    "description": item_name,
                    "inventoryItemId": item["id"],
                    "purchaseUnit": "case",
                    "inventoryUnit": "case",
                    "conversionFactor": 1,
                    "quantity": 2,
                    "unitPrice": 10.0,
                    "lineTotal": 20.0,
                    "confidence": 0.98,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert invoice_update.status_code == 200, invoice_update.get_data(as_text=True)
    assert invoice_update.get_json()["notes"] == "Updated operational mutation regression."

    receive_response = client.post(
        f"/api/pilot/purchases/invoices/{invoice['id']}/receive",
        base_url="http://127.0.0.1:5001",
        headers=csrf_headers(),
    )
    assert receive_response.status_code == 200, receive_response.get_data(as_text=True)
    received_invoice = receive_response.get_json()
    assert received_invoice["status"] == "Completed"

    item_detail = client.get(f"/api/pilot/inventory/items/{item['id']}", base_url="http://127.0.0.1:5001")
    assert item_detail.status_code == 200, item_detail.get_data(as_text=True)
    item_detail_body = item_detail.get_json()
    assert item_detail_body["item"]["currentOnHand"] == 2, item_detail_body
    assert len(item_detail_body["movementHistory"]) == 1, item_detail_body
    assert item_detail_body["movementHistory"][0]["quantityAfter"] == 2, item_detail_body
    assert item_detail_body["purchaseHistory"][0]["invoiceId"] == invoice["id"], item_detail_body

    owner_suppliers = client.get("/api/pilot/suppliers", base_url="http://127.0.0.1:5001")
    assert owner_suppliers.status_code == 200, owner_suppliers.get_data(as_text=True)
    owner_suppliers_body = owner_suppliers.get_json()
    assert any(entry["id"] == supplier["id"] for entry in owner_suppliers_body["suppliers"])
    assert all(entry["organizationId"] == organization_id for entry in owner_suppliers_body["suppliers"])

    other_client = postgres_app.test_client()
    _login_user(other_client, other_email, other_password)
    other_suppliers = other_client.get("/api/pilot/suppliers", base_url="http://127.0.0.1:5001")
    assert other_suppliers.status_code == 200, other_suppliers.get_data(as_text=True)
    assert other_suppliers.get_json()["suppliers"] == [], other_suppliers.get_data(as_text=True)
    other_inventory = other_client.get("/api/pilot/inventory", base_url="http://127.0.0.1:5001")
    assert other_inventory.status_code == 200, other_inventory.get_data(as_text=True)
    assert other_inventory.get_json()["items"] == [], other_inventory.get_data(as_text=True)
    other_purchases = other_client.get("/api/pilot/purchases", base_url="http://127.0.0.1:5001")
    assert other_purchases.status_code == 200, other_purchases.get_data(as_text=True)
    assert other_purchases.get_json()["invoices"] == [], other_purchases.get_data(as_text=True)
    _github_warning("operational mutation regression: supplier, inventory, invoice, receive, and tenant isolation succeeded")


def test_postgres_select_organization_audits_under_rls_and_enforces_membership(postgres_app):
    """Issue #178: selecting an organization must audit under that organization's RLS context.

    A multi-organization user selects A, switches to B, and is refused C (not a member).
    Authorization must come first: a refused request leaves no audit row and does not
    change the effective tenant.
    """
    suffix = uuid4().hex[:8]

    def _seed():
        user = User(email=f"select-org-{suffix}@example.com", is_active=True)
        user.set_password("SelectOrg123!")
        outsider = User(email=f"select-org-outsider-{suffix}@example.com", is_active=True)
        outsider.set_password("Outsider123!")
        db.session.add_all([user, outsider])
        db.session.flush()
        org_a = _create_org(user, f"Select Alpha {suffix}")
        org_b = _create_org(user, f"Select Beta {suffix}")
        org_c = _create_org(outsider, f"Select Gamma {suffix}")
        db.session.add_all(
            [
                Supplier(organization_id=org_a.id, name=f"Alpha Supplier {suffix}", normalized_name=f"alpha supplier {suffix}"),
                Supplier(organization_id=org_b.id, name=f"Beta Supplier {suffix}", normalized_name=f"beta supplier {suffix}"),
                Supplier(organization_id=org_c.id, name=f"Gamma Supplier {suffix}", normalized_name=f"gamma supplier {suffix}"),
            ]
        )
        db.session.commit()
        return {"user_id": user.id, "org_a_id": org_a.id, "org_b_id": org_b.id, "org_c_id": org_c.id}

    seeded = _seed_admin_fixture("RLS select organization dataset", _seed)
    user_id, org_a_id, org_b_id, org_c_id = (seeded[key] for key in ("user_id", "org_a_id", "org_b_id", "org_c_id"))

    client = postgres_app.test_client()
    _login_user(client, f"select-org-{suffix}@example.com", "SelectOrg123!")

    def csrf_headers() -> dict[str, str]:
        return {"X-CSRFToken": client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001").get_json()["csrfToken"]}

    def select(organization_id: int):
        return client.post(
            "/api/organizations/select",
            base_url="http://127.0.0.1:5001",
            headers=csrf_headers(),
            json={"organizationId": organization_id},
        )

    def visible_supplier_names() -> set[str]:
        response = client.get("/api/pilot/suppliers", base_url="http://127.0.0.1:5001")
        assert response.status_code == 200, response.get_data(as_text=True)
        body = response.get_json()
        rows = body.get("suppliers", body) if isinstance(body, dict) else body
        return {row["name"] for row in rows}

    def selected_audit_count(organization_id: int) -> int:
        with postgres_app.app_context():
            _set_rls_context(access_scope="setup")
            return AuditEvent.query.filter_by(
                event_type="tenant.organization_selected",
                entity_type="organization",
                entity_id=str(organization_id),
                organization_id=organization_id,
                actor_user_id=user_id,
            ).count()

    def current_organization_id() -> int | None:
        response = client.get("/api/organizations/current", base_url="http://127.0.0.1:5001")
        assert response.status_code == 200, response.get_data(as_text=True)
        return response.get_json()["organization"]["id"]

    # Valid selection: succeeds, the audit row is persisted, and only A's data is visible afterwards.
    response = select(org_a_id)
    assert response.status_code == 200, response.get_data(as_text=True)
    assert selected_audit_count(org_a_id) == 1
    assert current_organization_id() == org_a_id
    assert visible_supplier_names() == {f"Alpha Supplier {suffix}"}

    # Switching organizations audits under the new organization and isolates the previous one.
    response = select(org_b_id)
    assert response.status_code == 200, response.get_data(as_text=True)
    assert selected_audit_count(org_b_id) == 1
    assert selected_audit_count(org_a_id) == 1
    assert current_organization_id() == org_b_id
    assert visible_supplier_names() == {f"Beta Supplier {suffix}"}

    # Unauthorized organization: refused before any tenant context or audit write for it.
    response = select(org_c_id)
    assert response.status_code == 403, response.get_data(as_text=True)
    assert selected_audit_count(org_c_id) == 0
    with postgres_app.app_context():
        _set_rls_context(access_scope="setup")
        assert AuditEvent.query.filter_by(event_type="tenant.organization_selected", organization_id=org_c_id).count() == 0
    assert current_organization_id() == org_b_id
    assert visible_supplier_names() == {f"Beta Supplier {suffix}"}

    # Unknown organization ids are refused the same way.
    assert select(987654321).status_code == 403
    assert current_organization_id() == org_b_id

    # The runtime role itself still cannot write another tenant's audit row (RLS not weakened).
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=org_b_id, user_id=user_id)
        db.session.add(
            AuditEvent(
                organization_id=org_c_id,
                actor_user_id=user_id,
                event_type="tenant.organization_selected",
                entity_type="organization",
                entity_id=str(org_c_id),
                request_id=uuid4().hex,
                metadata_json={},
            )
        )
        with pytest.raises(Exception, match="row-level security"):
            db.session.flush()
        db.session.rollback()


def test_postgres_daily_close_mutations_restore_context_after_commit(postgres_app):
    owner_email = f"daily-close-{uuid4().hex[:8]}@example.com"
    owner_password = f"DailyClose-{uuid4().hex[:12]}!"

    def seed_daily_close():
        owner = User(email=owner_email, is_active=True)
        owner.set_password(owner_password)
        db.session.add(owner)
        db.session.flush()
        organization = _create_org(owner, f"Daily Close RLS {uuid4().hex[:8]}")
        db.session.add(OrganizationModule(organization_id=organization.id, module_key="DAILY_CLOSE", status="ENABLED"))
        db.session.commit()
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        return {"location_id": location.id}

    seeded = _seed_admin_fixture("daily close post-commit RLS", seed_daily_close)
    client = postgres_app.test_client()
    _login_user(client, owner_email, owner_password)

    csrf_token = client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001").get_json()["csrfToken"]
    opened = client.post(
        "/api/pilot/daily-close",
        base_url="http://127.0.0.1:5001",
        headers={"X-CSRFToken": csrf_token},
        json={"locationId": seeded["location_id"], "businessDate": "2026-09-01"},
    )
    assert opened.status_code == 200, opened.get_data(as_text=True)
    session_id = opened.get_json()["session"]["id"]

    updated = client.patch(
        f"/api/pilot/daily-close/{session_id}",
        base_url="http://127.0.0.1:5001",
        headers={"X-CSRFToken": csrf_token},
        json={"notes": "Post-commit RLS context"},
    )
    assert updated.status_code == 200, updated.get_data(as_text=True)
    assert updated.get_json()["session"]["notes"] == "Post-commit RLS context"

    finalized = client.post(
        f"/api/pilot/daily-close/{session_id}/finalize",
        base_url="http://127.0.0.1:5001",
        headers={"X-CSRFToken": csrf_token},
    )
    assert finalized.status_code == 200, finalized.get_data(as_text=True)
    assert finalized.get_json()["session"]["status"] == "COMPLETED"

    refetched = client.get(
        "/api/pilot/daily-close",
        base_url="http://127.0.0.1:5001",
        query_string={"locationId": seeded["location_id"], "businessDate": "2026-09-01"},
    )
    assert refetched.status_code == 200, refetched.get_data(as_text=True)
    assert refetched.get_json()["session"]["notes"] == "Post-commit RLS context"


def test_postgres_daily_close_cash_policy_persists_through_finalize_and_matches_reports(postgres_app, monkeypatch):
    """#206 on PostgreSQL with forced RLS: staff count + Square drawer evidence survive finalize; reports match."""
    from datetime import date
    from backend.models import SquareConnection, SquareDailySalesSummary, SquareLocation, SquareLocationMapping

    owner_email = f"close-cash-{uuid4().hex[:8]}@example.com"
    owner_password = f"CloseCash-{uuid4().hex[:12]}!"

    def seed():
        owner = User(email=owner_email, is_active=True)
        owner.set_password(owner_password)
        db.session.add(owner)
        db.session.flush()
        organization = _create_org(owner, f"Close Cash RLS {uuid4().hex[:8]}")
        for module in ("INVENTORY", "REPORTING", "DAILY_CLOSE"):
            db.session.add(OrganizationModule(organization_id=organization.id, module_key=module, status="ENABLED"))
        db.session.commit()
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        connection = SquareConnection(
            organization_id=organization.id, environment="production", square_merchant_id=f"m-{uuid4().hex[:6]}",
            status="connected", sync_status="idle", last_sync_at=datetime(2026, 8, 30, 23, 0, tzinfo=timezone.utc),
        )
        db.session.add(connection)
        db.session.flush()
        square_location = SquareLocation(square_connection_id=connection.id, square_location_id="LOC-PG", name="PG", status="ACTIVE", raw_payload_json={})
        db.session.add(square_location)
        db.session.flush()
        db.session.add(SquareLocationMapping(square_location_id=square_location.id, restaurant_location_id=location.id, mapped_by_user_id=owner.id))
        db.session.add(SquareDailySalesSummary(
            square_connection_id=connection.id, square_location_id="LOC-PG", restaurant_location_id=location.id, sale_date=date(2026, 8, 30),
            gross_amount=1000, discount_amount=50, tax_amount=123.5, tip_amount=80, refund_amount=40, net_amount=910, order_count=42, cancelled_order_count=2,
            raw_payload_json={},
        ))
        db.session.commit()
        return {"location_id": location.id}

    seeded = _seed_admin_fixture("daily close cash policy", seed)
    shift = {
        "id": "SHIFT-PG", "state": "CLOSED", "opened_at": "2026-08-30T11:00:00Z", "ended_at": "2026-08-30T22:00:00Z", "closed_at": "2026-08-30T22:00:00Z",
        "opened_cash_money": {"amount": 10000}, "cash_payment_money": {"amount": 45000}, "cash_refunds_money": {"amount": 2000},
        "cash_paid_in_money": {"amount": 0}, "cash_paid_out_money": {"amount": 3000}, "closed_cash_money": {"amount": 49500},
    }

    def fake_square(method, path, **kwargs):
        if "/events" in path:
            return {"cash_drawer_shift_events": []}
        if path.startswith("/v2/cash-drawers/shifts/"):
            return {"cash_drawer_shift": shift}
        if path.startswith("/v2/cash-drawers/shifts"):
            return {"cash_drawer_shifts": [{"id": "SHIFT-PG", "opened_at": shift["opened_at"], "closed_at": shift["closed_at"]}]}
        return {"payments": []}

    monkeypatch.setattr("backend.daily_close._square_request", fake_square)
    monkeypatch.setattr("backend.daily_close._connection_token", lambda connection: "token")
    monkeypatch.setattr("backend.daily_close.ensure_square_orders_fresh", lambda *a, **k: {"state": "fresh"})

    client = postgres_app.test_client()
    _login_user(client, owner_email, owner_password)
    base = "http://127.0.0.1:5001"

    def headers():
        return {"X-CSRFToken": client.get("/api/auth/csrf", base_url=base).get_json()["csrfToken"]}

    opened = client.post("/api/pilot/daily-close", base_url=base, headers=headers(), json={"locationId": seeded["location_id"], "businessDate": "2026-08-30"})
    assert opened.status_code == 200, opened.get_data(as_text=True)
    session_id = opened.get_json()["session"]["id"]
    assert opened.get_json()["snapshot"]["cashReconciliation"]["overShort"] is None  # no staff count yet

    counted = client.patch(f"/api/pilot/daily-close/{session_id}", base_url=base, headers=headers(), json={"reconciliation": {"countedCash": 490}})
    assert counted.status_code == 200, counted.get_data(as_text=True)
    cash = counted.get_json()["snapshot"]["cashReconciliation"]
    assert (cash["expectedCash"], cash["countedCash"], cash["overShort"], cash["closedCash"]) == (500.0, 490.0, -10.0, 495.0)

    finalized = client.post(f"/api/pilot/daily-close/{session_id}/finalize", base_url=base, headers=headers())
    assert finalized.status_code == 200, finalized.get_data(as_text=True)
    frozen = finalized.get_json()["snapshot"]["cashReconciliation"]
    assert (frozen["expectedCash"], frozen["countedCash"], frozen["overShort"], frozen["providerClosedCash"], frozen["providerCountDifference"]) == (500.0, 490.0, -10.0, 495.0, -5.0)

    assert client.post(f"/api/pilot/daily-close/{session_id}/finalize", base_url=base, headers=headers()).status_code == 409
    assert client.patch(f"/api/pilot/daily-close/{session_id}", base_url=base, headers=headers(), json={"reconciliation": {"countedCash": 500}}).status_code == 409

    refetched = client.get("/api/pilot/daily-close", base_url=base, query_string={"locationId": seeded["location_id"], "businessDate": "2026-08-30"})
    assert refetched.get_json()["snapshot"]["cashReconciliation"]["countedCash"] == 490.0
    # The completed-close CSV export reads the persisted session.summarySnapshot: it must carry the frozen figures under RLS.
    persisted = refetched.get_json()["session"]["summarySnapshot"]
    assert (persisted["sales"]["netSales"], persisted["sales"]["orders"], persisted["cashReconciliation"]["expectedCash"],
            persisted["cashReconciliation"]["countedCash"], persisted["cashReconciliation"]["overShort"]) == (910.0, 42, 500.0, 490.0, -10.0)

    report = client.get("/api/pilot/reports", base_url=base, query_string={"view": "daily", "date": "2026-08-30"})
    assert report.status_code == 200, report.get_data(as_text=True)
    sales = report.get_json()["sales"]
    close_sales = finalized.get_json()["snapshot"]["sales"]
    assert (sales["grossItemSales"], sales["discounts"], sales["tax"], sales["tips"], sales["refunds"], sales["totalCollected"], sales["orderCount"], sales["cancelledOrderCount"]) == (
        close_sales["grossSales"], close_sales["discounts"], close_sales["tax"], close_sales["tips"], close_sales["refunds"], close_sales["netSales"], close_sales["orders"], close_sales["cancelledOrders"],
    ) == (1000.0, 50.0, 123.5, 80.0, 40.0, 910.0, 42, 2)


def test_postgres_active_owner_can_load_dashboard_after_request_bootstrap(postgres_app):
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None

        organization = Organization(
            name=f"Bootstrap Dashboard {int(time.time() * 1000)}",
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
        location = RestaurantLocation(
            organization=organization,
            name="Bootstrap Kitchen",
            address_line1="123 Test St",
            city="Toronto",
            region="ON",
            postal_code="M5V 1A1",
            country="Canada",
            timezone="America/Toronto",
        )
        db.session.add(location)
        db.session.add_all(
            [
                OrganizationModule(organization=organization, module_key="PURCHASES", status="ENABLED", enabled_at=utc_now()),
                OrganizationModule(organization=organization, module_key="INVENTORY", status="ENABLED", enabled_at=utc_now()),
                OrganizationModule(organization=organization, module_key="STOCK_COUNTS", status="ENABLED", enabled_at=utc_now()),
                OrganizationModule(organization=organization, module_key="REORDER_PLANS", status="ENABLED", enabled_at=utc_now()),
            ]
        )
        other_user = User(email=f"bootstrap-dashboard-other-{int(time.time() * 1000)}@example.com", is_active=True)
        other_user.set_password("OtherOrg!123")
        db.session.add(other_user)
        db.session.flush()
        other_organization = Organization(
            name=f"Bootstrap Dashboard Other {int(time.time() * 1000)}",
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
        db.session.add(other_organization)
        db.session.flush()
        db.session.add(OrganizationMembership(user=other_user, organization=other_organization, role="owner"))
        db.session.commit()
        return {
            "organization_id": organization.id,
            "location_id": location.id,
            "other_organization_id": other_organization.id,
        }

    # Forced RLS rejects tenant-less organization inserts from the runtime role,
    # so seed through the same superuser admin path as the other datasets.
    seeded = _seed_admin_fixture("RLS bootstrap dashboard dataset", _seed)
    organization_id = seeded["organization_id"]
    location_id = seeded["location_id"]
    other_organization_id = seeded["other_organization_id"]

    client = postgres_app.test_client()
    _login_owner(client)

    csrf_token = client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001").get_json()["csrfToken"]
    select_org_response = client.post(
        "/api/organizations/select",
        base_url="http://127.0.0.1:5001",
        headers={"X-CSRFToken": csrf_token},
        json={"organizationId": organization_id},
    )
    assert select_org_response.status_code == 200, select_org_response.get_data(as_text=True)

    select_location_response = client.post(
        "/api/locations/select",
        base_url="http://127.0.0.1:5001",
        headers={"X-CSRFToken": client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001").get_json()["csrfToken"]},
        json={"locationId": location_id},
    )
    assert select_location_response.status_code == 200, select_location_response.get_data(as_text=True)

    current_response = client.get("/api/organizations/current", base_url="http://127.0.0.1:5001")
    assert current_response.status_code == 200, current_response.get_data(as_text=True)
    current_body = current_response.get_json()
    assert current_body["organization"]["id"] == organization_id, current_body
    assert current_body["currentLocation"]["id"] == location_id, current_body
    assert [entry["id"] for entry in current_body["restaurantLocations"]] == [location_id], current_body

    me_response = client.get("/api/auth/me", base_url="http://127.0.0.1:5001")
    assert me_response.status_code == 200, me_response.get_data(as_text=True)
    me_body = me_response.get_json()
    assert me_body["currentOrganizationId"] == organization_id, me_body
    assert me_body["currentLocationId"] == location_id, me_body
    assert any(entry["organization"]["id"] == organization_id for entry in me_body["organizations"]), me_body
    assert all(entry["organization"]["id"] != other_organization_id for entry in me_body["organizations"]), me_body

    with postgres_app.app_context():
        rls_state = db.session.execute(
            text(
                """
                SELECT c.relrowsecurity, c.relforcerowsecurity
                FROM pg_class AS c
                JOIN pg_namespace AS n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = 'restaurant_locations'
                """
            )
        ).one()
        assert rls_state == (True, True)

    dashboard_response = client.get("/api/pilot/dashboard", base_url="http://127.0.0.1:5001")
    assert dashboard_response.status_code == 200, dashboard_response.get_data(as_text=True)
    dashboard_body = dashboard_response.get_json()
    # The dashboard snapshot does not echo the location; scope is proven by an
    # empty tenant seeing none of the seeded pilot organization's invoices.
    assert dashboard_body["recentInvoices"] == [], dashboard_body
    assert dashboard_body["summary"]["monthlyInvoiceCount"] == 0, dashboard_body


@SUPPORT_ACCESS_DEFERRED
def test_postgres_rls_probe_3_current_support_grant_id(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=postgres_rls_probe_context["org_a_id"])
        assert _log_probe("3 flowtally_current_support_grant_id()", "select flowtally_current_support_grant_id()") is None


@SUPPORT_ACCESS_DEFERRED
def test_postgres_rls_probe_4_support_access_grants_count(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=postgres_rls_probe_context["org_a_id"])
        assert _log_probe("4 support_access_grants count", "select count(*) from support_access_grants") >= 0


@SUPPORT_ACCESS_DEFERRED
def test_postgres_rls_probe_5_support_has_access(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _set_rls_context(
            access_scope="customer",
            organization_id=postgres_rls_probe_context["org_a_id"],
            support_grant_id=postgres_rls_probe_context["active_grant_id"],
        )
        assert _log_probe(
            "5 flowtally_support_has_access(org_a)",
            "select flowtally_support_has_access(:org_id)",
            {"org_id": postgres_rls_probe_context["org_a_id"]},
        ) is True


@SUPPORT_ACCESS_DEFERRED
def test_postgres_rls_probe_6_has_org_access(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _set_rls_context(
            access_scope="customer",
            organization_id=postgres_rls_probe_context["org_a_id"],
            support_grant_id=postgres_rls_probe_context["active_grant_id"],
        )
        assert _log_probe(
            "6 flowtally_has_org_access(org_a)",
            "select flowtally_has_org_access(:org_id)",
            {"org_id": postgres_rls_probe_context["org_a_id"]},
        ) is True


def test_postgres_rls_probe_7_suppliers_count(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=postgres_rls_probe_context["org_a_id"])
        assert _log_probe(
            "7 suppliers count for org_a",
            "select count(*) from suppliers where organization_id = :org_id",
            {"org_id": postgres_rls_probe_context["org_a_id"]},
        ) == 1


def test_postgres_rls_membership_discovery_limits_organization_visibility(postgres_app):
    seeded = _seed_admin_fixture("RLS membership discovery dataset", lambda: _seed_membership_discovery_dataset("RLS"))
    with postgres_app.app_context():
        user_a_id = seeded["user_a_id"]
        org_a_id = seeded["org_a_id"]
        org_b_id = seeded["org_b_id"]
        support_user_id = seeded["support_user_id"]

        with db.session.connection() as connection:
            _apply_diagnostic_timeouts(connection)
            _set_rls_context_on_connection(connection, access_scope="customer", user_id=user_a_id)
            runtime_context = connection.execute(
                text(
                    """
                    select
                        current_user,
                        session_user,
                        current_role,
                        current_setting('flowtally.access_scope', true),
                        current_setting('flowtally.user_id', true),
                        current_setting('flowtally.organization_id', true),
                        current_setting('flowtally.support_grant_id', true)
                    """
                )
            ).one()
            assert runtime_context[0] == "flowtally_runtime", f"membership discovery runtime context: {tuple(runtime_context)!r}"
            assert runtime_context[1] == "flowtally_runtime", f"membership discovery runtime context: {tuple(runtime_context)!r}"
            assert runtime_context[2] == "flowtally_runtime", f"membership discovery runtime context: {tuple(runtime_context)!r}"
            assert runtime_context[3] == "customer", f"membership discovery runtime context: {tuple(runtime_context)!r}"
            assert runtime_context[4] == str(user_a_id), f"membership discovery runtime context: {tuple(runtime_context)!r}"
            assert runtime_context[5] in (None, ""), f"membership discovery runtime context: {tuple(runtime_context)!r}"
            assert runtime_context[6] in (None, ""), f"membership discovery runtime context: {tuple(runtime_context)!r}"

            visible_org_ids = [
                row[0]
                for row in connection.execute(
                    text("select id from organizations order by id")
                ).all()
            ]
            visible_membership_org_ids = [
                row[0]
                for row in connection.execute(
                    text("select organization_id from organization_memberships where user_id = :user_id order by organization_id"),
                    {"user_id": user_a_id},
                ).all()
            ]
            assert visible_org_ids == [org_a_id], (
                "membership discovery should only expose the selected user's organization set: "
                f"runtime_context={tuple(runtime_context)!r}, visible_org_ids={visible_org_ids!r}, "
                f"org_a_id={org_a_id}, org_b_id={org_b_id}, user_a_id={user_a_id}"
            )
            assert visible_membership_org_ids == [org_a_id], (
                "membership discovery should only expose the selected user's memberships: "
                f"runtime_context={tuple(runtime_context)!r}, visible_membership_org_ids={visible_membership_org_ids!r}, "
                f"org_a_id={org_a_id}, org_b_id={org_b_id}, user_a_id={user_a_id}"
            )
            assert connection.execute(text("select count(*) from organizations where id = :org_id"), {"org_id": org_b_id}).scalar_one() == 0

            _set_rls_context_on_connection(connection, access_scope="public")
            public_context = connection.execute(
                text(
                    """
                    select
                        current_user,
                        session_user,
                        current_role,
                        current_setting('flowtally.access_scope', true),
                        current_setting('flowtally.user_id', true),
                        current_setting('flowtally.organization_id', true),
                        current_setting('flowtally.support_grant_id', true)
                    """
                )
            ).one()
            assert public_context[3] == "public", f"public discovery context: {tuple(public_context)!r}"
            assert connection.execute(text("select count(*) from organizations")).scalar_one() == 0

            _set_rls_context_on_connection(connection, access_scope="public", user_id=support_user_id)
            support_public_context = connection.execute(
                text(
                    """
                    select
                        current_user,
                        session_user,
                        current_role,
                        current_setting('flowtally.access_scope', true),
                        current_setting('flowtally.user_id', true),
                        current_setting('flowtally.organization_id', true),
                        current_setting('flowtally.support_grant_id', true)
                    """
                )
            ).one()
            assert support_public_context[3] == "public", f"support public discovery context: {tuple(support_public_context)!r}"
            assert support_public_context[4] == str(support_user_id), f"support public discovery context: {tuple(support_public_context)!r}"
            assert connection.execute(text("select count(*) from organizations")).scalar_one() == 0


def test_rls_protects_menu_costing_tables(postgres_app):
    seeded = _seed_admin_menu_costing_dataset("RLS")
    with postgres_app.app_context():
        org_a_id = seeded["org_a_id"]
        org_b_id = seeded["org_b_id"]

        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        assert Recipe.query.filter_by(organization_id=org_a_id).count() == 1
        assert Recipe.query.filter_by(organization_id=org_b_id).count() == 0
        assert RecipeIngredient.query.filter_by(organization_id=org_a_id).count() == 1
        assert RecipeIngredient.query.filter_by(organization_id=org_b_id).count() == 0
        assert MenuItem.query.filter_by(organization_id=org_a_id).count() == 1
        assert MenuItem.query.filter_by(organization_id=org_b_id).count() == 0


def test_rls_protects_square_sales_tables(postgres_app):
    seeded = _seed_admin_square_dataset("RLS")
    with postgres_app.app_context():
        org_a_id = seeded["org_a_id"]
        org_b_id = seeded["org_b_id"]
        connection_a_id = seeded["connection_a_id"]
        connection_b_id = seeded["connection_b_id"]

        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        assert SquareOrder.query.filter_by(square_connection_id=connection_a_id).count() == 1
        assert SquareOrder.query.filter_by(square_connection_id=connection_b_id).count() == 0
        assert SquareDailySalesSummary.query.filter_by(square_connection_id=connection_a_id).count() == 1
        assert SquareDailySalesSummary.query.filter_by(square_connection_id=connection_b_id).count() == 0


def test_square_oauth_callback_commits_audit_event_under_rls(postgres_app, monkeypatch):
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        organization = make_operational_organization(
            owner,
            name=f"RLS Square OAuth {uuid4().hex[:6]}",
            location_name="Main Kitchen",
            enabled_modules=("PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS", "MENU_COSTING", "SQUARE_INTEGRATION"),
        )
        return {"organization_id": organization.id}

    seeded = _seed_admin_fixture("RLS square oauth dataset", _seed)
    organization_id = int(seeded["organization_id"])

    configure_square(postgres_app)
    with postgres_app.app_context():
        postgres_app.config["FLOWTALLY_FRONTEND_ORIGIN"] = "https://frontend.example.test"

    fake_urlopen = oauth_responder()
    monkeypatch.setattr("backend.square_integration.urlopen", fake_urlopen)

    client = postgres_app.test_client()
    _login_owner(client)
    csrf_response = client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001")
    csrf_token = csrf_response.get_json()["csrfToken"]
    select_org_response = client.post(
        "/api/organizations/select",
        base_url="http://127.0.0.1:5001",
        headers={"X-CSRFToken": csrf_token},
        json={"organizationId": organization_id},
    )
    assert select_org_response.status_code == 200, select_org_response.get_data(as_text=True)

    start_response = client.get(f"/api/integrations/square/start?organizationId={organization_id}", base_url="http://127.0.0.1:5001")
    assert start_response.status_code == 302, start_response.get_data(as_text=True)
    # The test client keeps cookies per host, so read the session from the same base URL the requests used.
    with client.session_transaction(base_url="http://127.0.0.1:5001") as session:
        context = session["square_oauth_context"]

    callback_response = client.get(
        "/api/integrations/square/callback",
        base_url="http://127.0.0.1:5001",
        query_string={"state": context["state"], "code": "auth-code"},
    )
    assert callback_response.status_code == 302, callback_response.get_data(as_text=True)
    assert callback_response.headers["Location"] == "https://frontend.example.test/app/square?organizationId=%s&connected=1" % organization_id
    assert "access_token" not in callback_response.headers["Location"]
    assert "refresh_token" not in callback_response.headers["Location"]
    assert fake_urlopen.calls["locations"] == 1
    assert fake_urlopen.calls["catalog"] == 2

    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=organization_id)
        connection = SquareConnection.query.filter_by(organization_id=organization_id).one()
        assert connection.status == "connected"
        assert connection.square_merchant_id == "merchant-123"
        audit_event = AuditEvent.query.filter_by(
            event_type="square.oauth.connected",
            entity_type="square_connection",
            organization_id=organization_id,
        ).one()
        assert audit_event.entity_id == str(connection.id)
        assert "merchantId" in audit_event.metadata_json
        assert client.get(f"/api/integrations/square/status?organizationId={organization_id}", base_url="http://127.0.0.1:5001").status_code == 200


def test_square_location_mapping_serializes_before_commit_under_rls(postgres_app):
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        organization = _create_org(owner, f"RLS Square Mapping {uuid4().hex[:6]}")
        restaurant_location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        assert restaurant_location is not None
        connection = SquareConnection(
            organization_id=organization.id,
            environment="sandbox",
            square_merchant_id="merchant-mapping",
            status="connected",
        )
        db.session.add(connection)
        db.session.flush()
        square_location = SquareLocation(
            square_connection_id=connection.id,
            square_location_id="LOC-MAPPING",
            name="Sandbox Mapping",
            status="active",
            raw_payload_json={"id": "LOC-MAPPING", "name": "Sandbox Mapping"},
        )
        db.session.add(square_location)
        db.session.flush()
        return {
            "organization_id": organization.id,
            "restaurant_location_id": restaurant_location.id,
            "square_location_id": square_location.id,
        }

    seeded = _seed_admin_fixture("RLS square location mapping dataset", _seed)
    organization_id = int(seeded["organization_id"])

    configure_square(postgres_app)
    client = postgres_app.test_client()
    _login_owner(client)
    csrf_response = client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001")
    csrf_token = csrf_response.get_json()["csrfToken"]
    select_org_response = client.post(
        "/api/organizations/select",
        base_url="http://127.0.0.1:5001",
        headers={"X-CSRFToken": csrf_token},
        json={"organizationId": organization_id},
    )
    assert select_org_response.status_code == 200, select_org_response.get_data(as_text=True)

    response = client.post(
        "/api/integrations/square/location-mappings",
        base_url="http://127.0.0.1:5001",
        headers={"X-CSRFToken": csrf_token},
        json={
            "organizationId": organization_id,
            "squareLocationId": int(seeded["square_location_id"]),
            "restaurantLocationId": int(seeded["restaurant_location_id"]),
        },
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    response_connection = response.get_json()["connection"]
    assert response_connection["squareMerchantId"] == "merchant-mapping"
    assert response_connection["locations"][0]["mappings"][0]["restaurantLocationId"] == int(seeded["restaurant_location_id"])

    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=organization_id)
        mapping = SquareLocationMapping.query.filter_by(square_location_id=int(seeded["square_location_id"])).one()
        assert mapping.restaurant_location_id == int(seeded["restaurant_location_id"])
        audit_event = AuditEvent.query.filter_by(
            event_type="square.location_mapped",
            entity_type="square_location_mapping",
            organization_id=organization_id,
        ).one()
        assert audit_event.entity_id == str(mapping.id)

    status_response = client.get(
        f"/api/integrations/square/status?organizationId={organization_id}",
        base_url="http://127.0.0.1:5001",
    )
    assert status_response.status_code == 200, status_response.get_data(as_text=True)
    status_connection = status_response.get_json()["connection"]
    assert status_connection["locations"][0]["mappings"][0]["restaurantLocationId"] == int(seeded["restaurant_location_id"])


def test_rls_protects_daily_close_sessions(postgres_app):
    seeded = _seed_admin_daily_close_dataset("RLS")
    with postgres_app.app_context():
        org_a_id = seeded["org_a_id"]
        org_b_id = seeded["org_b_id"]

        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        assert DailyCloseSession.query.filter_by(organization_id=org_a_id).count() == 1
        assert DailyCloseSession.query.filter_by(organization_id=org_b_id).count() == 0


def test_rls_covers_import_tables_and_selected_organization_views(postgres_app):
    seeded = _seed_admin_import_dataset("RLS")
    with postgres_app.app_context():
        org_a_id = seeded["org_a_id"]
        org_b_id = seeded["org_b_id"]
        owner_id = seeded["owner_id"]

        _set_rls_context(access_scope="customer", organization_id=org_a_id)
        assert DataImportJob.query.filter_by(organization_id=org_a_id).count() == 1
        assert DataImportJob.query.filter_by(organization_id=org_b_id).count() == 0
        assert DataImportFile.query.join(DataImportJob).filter(DataImportJob.organization_id == org_a_id).count() == 1
        assert DataImportRow.query.join(DataImportJob).filter(DataImportJob.organization_id == org_a_id).count() == 1
        assert DataImportRow.query.join(DataImportJob).filter(DataImportJob.organization_id == org_b_id).count() == 0
        assert DataImportIssue.query.join(DataImportRow).join(DataImportJob).filter(DataImportJob.organization_id == org_a_id).count() == 1
        assert DataImportChange.query.join(DataImportJob).filter(DataImportJob.organization_id == org_a_id).count() == 1
        assert OrganizationMembership.query.filter_by(user_id=owner_id).count() == 1

        rows = db.session.execute(text("select count(*) from data_import_jobs where organization_id = :org_id"), {"org_id": org_b_id}).scalar_one()
        assert rows == 0

        _set_rls_context(access_scope="customer", organization_id=org_b_id)
        assert OrganizationMembership.query.filter_by(user_id=owner_id).count() == 1
        assert DataImportJob.query.filter_by(organization_id=org_b_id).count() == 1


def test_setup_scope_can_access_platform_data_across_organizations(postgres_app):
    seeded = _seed_admin_setup_dataset("RLS")
    with postgres_app.app_context():
        org_a_id = seeded["org_a_id"]
        org_b_id = seeded["org_b_id"]

        with db.session.connection() as connection:
            _apply_diagnostic_timeouts(connection)
            before_pid = connection.execute(text("select pg_backend_pid()")).scalar_one()
            print(f"STATE: test_setup_scope_can_access_platform_data_across_organizations before context -> backend_pid={before_pid}", flush=True)
            _set_rls_context_on_connection(connection, access_scope="setup")
            after_pid = connection.execute(text("select pg_backend_pid()")).scalar_one()
            print(f"STATE: test_setup_scope_can_access_platform_data_across_organizations after context -> backend_pid={after_pid}", flush=True)
            context_snapshot = connection.execute(
                text(
                    """
                    select
                        current_user,
                        session_user,
                        current_role,
                        current_setting('flowtally.access_scope', true),
                        current_setting('flowtally.organization_id', true),
                        current_setting('flowtally.support_grant_id', true)
                    """
                )
            ).one()
            print(f"STATE: test_setup_scope_can_access_platform_data_across_organizations context snapshot -> {tuple(context_snapshot)}", flush=True)
            assert before_pid == after_pid, f"setup scope runtime pid changed: {tuple(context_snapshot)!r}"
            assert context_snapshot[0] == "flowtally_runtime", f"setup scope runtime context: {tuple(context_snapshot)!r}"
            assert context_snapshot[1] == "flowtally_runtime", f"setup scope runtime context: {tuple(context_snapshot)!r}"
            assert context_snapshot[2] == "flowtally_runtime", f"setup scope runtime context: {tuple(context_snapshot)!r}"
            assert context_snapshot[3] == "setup", f"setup scope runtime context: {tuple(context_snapshot)!r}"
            assert context_snapshot[4] in (None, ""), f"setup scope runtime context: {tuple(context_snapshot)!r}"
            assert context_snapshot[5] in (None, ""), f"setup scope runtime context: {tuple(context_snapshot)!r}"
            assert connection.execute(text("select count(*) from organizations where id = :org_id"), {"org_id": org_a_id}).scalar_one() == 1
            assert connection.execute(text("select count(*) from organizations where id = :org_id"), {"org_id": org_b_id}).scalar_one() == 1
            assert (
                connection.execute(text("select count(*) from suppliers where organization_id = :org_id"), {"org_id": org_a_id}).scalar_one()
                == 1
            ), f"setup scope supplier count mismatch for org_a: expected=1, org_a_id={org_a_id}, org_b_id={org_b_id}"
            assert (
                connection.execute(text("select count(*) from suppliers where organization_id = :org_id"), {"org_id": org_b_id}).scalar_one()
                == 1
            ), f"setup scope supplier count mismatch for org_b: expected=1, org_a_id={org_a_id}, org_b_id={org_b_id}"
            assert (
                connection.execute(text("select count(*) from data_import_jobs where organization_id = :org_id"), {"org_id": org_a_id}).scalar_one()
                == 1
            ), f"setup scope import count mismatch for org_a: expected=1, org_a_id={org_a_id}, org_b_id={org_b_id}"
            assert (
                connection.execute(text("select count(*) from data_import_jobs where organization_id = :org_id"), {"org_id": org_b_id}).scalar_one()
                == 1
            ), f"setup scope import count mismatch for org_b: expected=1, org_a_id={org_a_id}, org_b_id={org_b_id}"
            assert connection.execute(text("select count(*) from organizations")).scalar_one() >= 2
            owner_membership_count = connection.execute(
                text("select count(*) from organization_memberships where user_id = :owner_id"),
                {"owner_id": seeded["owner_id"]},
            ).scalar_one()
            assert owner_membership_count >= 3, f"setup scope membership count mismatch: expected >= 3, actual={owner_membership_count}, org_a_id={org_a_id}, org_b_id={org_b_id}, owner_id={seeded['owner_id']}"


def test_postgres_pilot_vertical_workflow_uses_real_receiving_and_square_consumption(postgres_app):
    """Run the core purchase -> inventory -> recipe -> Square path on disposable PostgreSQL."""
    from datetime import date
    from decimal import Decimal
    from backend.models import (
        InventoryItem,
        InventoryMovement,
        MenuItem,
        PurchaseInvoice,
        PurchaseInvoiceLine,
        Recipe,
        RecipeIngredient,
        RestaurantLocation,
        SquareCatalogMapping,
        SquareCatalogObject,
        SquareConnection,
        SquareLocation,
        SquareLocationMapping,
        Supplier,
        User,
    )
    from backend.pilot_api import _record_receipt
    from backend.square_integration import _apply_square_order_inventory_consumption, _upsert_order
    from backend.seed import LOCAL_LOCATION_NAME, LOCAL_ORGANIZATION_NAME

    client = postgres_app.test_client()
    _login_owner(client)

    with postgres_app.app_context():
        _set_rls_context(access_scope="setup", user_id=None)
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        organization = Organization.query.filter_by(name=LOCAL_ORGANIZATION_NAME).one()
        location = RestaurantLocation.query.filter_by(organization_id=organization.id, name=LOCAL_LOCATION_NAME).one()

        _set_rls_context(access_scope="organization", organization_id=organization.id, user_id=owner.id)
        suffix = uuid4().hex[:8]
        supplier = Supplier(
            organization_id=organization.id,
            name=f"Vertical Supplier {suffix}",
            normalized_name=f"vertical supplier {suffix}",
        )
        item = InventoryItem(
            organization_id=organization.id,
            location_id=location.id,
            supplier=supplier,
            name=f"Vertical Ingredient {suffix}",
            normalized_name=f"vertical ingredient {suffix}",
            stock_unit="kg",
            current_on_hand=Decimal("10"),
            average_unit_cost=Decimal("2"),
            min_quantity=Decimal("2"),
            par_level=Decimal("10"),
            latest_purchase_price=Decimal("2"),
            last_purchase_unit="kg",
            last_purchase_conversion_factor=Decimal("1"),
            preferred_supplier_name=supplier.name,
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        db.session.add_all([supplier, item])
        db.session.flush()

        recipe = Recipe(
            organization_id=organization.id,
            location_id=location.id,
            name=f"Vertical Recipe {suffix}",
            normalized_name=f"vertical recipe {suffix}",
            yield_quantity=Decimal("1"),
            yield_unit="serving",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        db.session.add(recipe)
        db.session.flush()
        db.session.add(RecipeIngredient(
            organization_id=organization.id,
            recipe_id=recipe.id,
            inventory_item_id=item.id,
            quantity_required=Decimal("0.25"),
            unit="kg",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        ))
        menu_item = MenuItem(
            organization_id=organization.id,
            location_id=location.id,
            recipe_id=recipe.id,
            name=f"Vertical Burger {suffix}",
            normalized_name=f"vertical burger {suffix}",
            selling_price=Decimal("18"),
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        db.session.add(menu_item)
        db.session.flush()

        connection = SquareConnection(
            organization_id=organization.id,
            environment="sandbox",
            square_merchant_id=f"merchant-{suffix}",
            status="connected",
            inventory_depletion_activated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        db.session.add(connection)
        db.session.flush()
        square_location = SquareLocation(
            square_connection_id=connection.id,
            square_location_id=f"LOC-{suffix}",
            name="Vertical Test Location",
            status="active",
        )
        db.session.add(square_location)
        db.session.flush()
        db.session.add(SquareLocationMapping(
            square_location_id=square_location.id,
            restaurant_location_id=location.id,
            mapped_by_user_id=owner.id,
        ))
        catalog_object = SquareCatalogObject(
            square_connection_id=connection.id,
            square_object_id=f"VAR-{suffix}",
            object_type="ITEM_VARIATION",
            version=1,
            is_deleted=False,
            raw_payload_json={"item_variation_data": {"name": menu_item.name}},
        )
        db.session.add(catalog_object)
        db.session.flush()
        db.session.add(SquareCatalogMapping(
            square_catalog_object_id=catalog_object.id,
            mapping_type="menu_item",
            flowtally_entity_type="menu_item",
            flowtally_entity_id=str(menu_item.id),
            status="mapped",
            mapped_by_user_id=owner.id,
        ))

        invoice = PurchaseInvoice(
            organization_id=organization.id,
            location_id=location.id,
            supplier_id=supplier.id,
            invoice_number=f"VERTICAL-{suffix}",
            invoice_date=date(2026, 10, 20),
            subtotal=Decimal("15"),
            tax=Decimal("0"),
            total_amount=Decimal("15"),
            status="Ready",
            extraction_status="manual",
            created_by_user_id=owner.id,
            updated_by_user_id=owner.id,
        )
        db.session.add(invoice)
        db.session.flush()
        db.session.add(PurchaseInvoiceLine(
            invoice_id=invoice.id,
            inventory_item_id=item.id,
            line_index=0,
            description=item.name,
            normalized_description=item.normalized_name,
            purchase_unit="kg",
            inventory_unit="kg",
            conversion_factor=Decimal("1"),
            quantity=Decimal("5"),
            unit_price=Decimal("3"),
            line_total=Decimal("15"),
            confidence=Decimal("0.99"),
            needs_review=False,
        ))
        invoice_id = invoice.id
        item_id = item.id
        recipe_id = recipe.id
        connection_id = connection.id
        location_id = location.id
        organization_id = organization.id
        owner_id = owner.id
        menu_item_id = menu_item.id
        db.session.commit()

    receive = client.post(
        f"/api/pilot/purchases/invoices/{invoice_id}/receive",
        base_url="http://127.0.0.1:5001",
        headers={"X-CSRFToken": client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001").get_json()["csrfToken"]},
    )
    assert receive.status_code == 200, receive.get_data(as_text=True)

    with postgres_app.app_context():
        _set_rls_context(access_scope="organization", organization_id=organization_id, user_id=owner_id)
        organization = db.session.get(Organization, organization_id)
        assert organization is not None
        item = db.session.get(InventoryItem, item_id)
        assert item is not None
        assert Decimal(str(item.current_on_hand)) == Decimal("15.0000")
        assert Decimal(str(item.average_unit_cost)).quantize(Decimal("0.0001")) == Decimal("2.3333")
        assert InventoryMovement.query.filter_by(source_type="invoice receipt", source_record_id=str(invoice_id)).count() == 1

        connection = db.session.get(SquareConnection, connection_id)
        assert connection is not None
        payload = {
            "id": f"ORDER-{suffix}",
            "location_id": f"LOC-{suffix}",
            "state": "COMPLETED",
            "created_at": "2026-10-20T15:00:00Z",
            "closed_at": "2026-10-20T15:05:00Z",
            "gross_sales_money": {"amount": 1800, "currency": "CAD"},
            "total_discount_money": {"amount": 0, "currency": "CAD"},
            "total_tax_money": {"amount": 0, "currency": "CAD"},
            "total_tip_money": {"amount": 0, "currency": "CAD"},
            "total_money": {"amount": 1800, "currency": "CAD"},
            "line_items": [{
                "uid": "line-1",
                "name": f"Vertical Burger {suffix}",
                "catalog_object_id": f"VAR-{suffix}",
                "quantity": "2",
                "gross_sales_money": {"amount": 1800, "currency": "CAD"},
                "total_discount_money": {"amount": 0, "currency": "CAD"},
                "total_tax_money": {"amount": 0, "currency": "CAD"},
                "total_money": {"amount": 1800, "currency": "CAD"},
            }],
        }
        order = _upsert_order(connection, payload)
        db.session.flush()
        warnings = _apply_square_order_inventory_consumption(organization, connection, order)
        assert warnings == []
        db.session.commit()
        _set_rls_context(access_scope="organization", organization_id=organization_id, user_id=owner_id)

        item = db.session.get(InventoryItem, item_id)
        assert item is not None
        assert Decimal(str(item.current_on_hand)).quantize(Decimal("0.0001")) == Decimal("14.5000")
        assert InventoryMovement.query.filter_by(source_type="square sale consumption", source_record_id=f"ORDER-{suffix}").count() == 1

        # Replaying the same completed order must not create another movement.
        replay = _upsert_order(connection, payload)
        db.session.flush()
        _apply_square_order_inventory_consumption(organization, connection, replay)
        db.session.commit()
        _set_rls_context(access_scope="organization", organization_id=organization_id, user_id=owner_id)
        assert InventoryMovement.query.filter_by(source_type="square sale consumption", source_record_id=f"ORDER-{suffix}").count() == 1
        assert Decimal(str(db.session.get(InventoryItem, item_id).current_on_hand)).quantize(Decimal("0.0001")) == Decimal("14.5000")

        # An unmapped variation contributes no ingredient depletion.
        unmapped_payload = {
            **payload,
            "id": f"ORDER-UNMAPPED-{suffix}",
            "line_items": [{**payload["line_items"][0], "uid": "line-unmapped", "catalog_object_id": f"UNMAPPED-{suffix}", "quantity": "1", "gross_sales_money": {"amount": 500, "currency": "CAD"}, "total_money": {"amount": 500, "currency": "CAD"}}],
            "gross_sales_money": {"amount": 500, "currency": "CAD"},
            "total_money": {"amount": 500, "currency": "CAD"},
        }
        unmapped = _upsert_order(connection, unmapped_payload)
        db.session.flush()
        unmapped_warnings = _apply_square_order_inventory_consumption(organization, connection, unmapped)
        db.session.commit()
        _set_rls_context(access_scope="organization", organization_id=organization_id, user_id=owner_id)
        assert any("unmapped" in warning.lower() for warning in unmapped_warnings)
        assert InventoryMovement.query.filter_by(source_record_id=f"ORDER-UNMAPPED-{suffix}").count() == 0
        assert Decimal(str(db.session.get(InventoryItem, item_id).current_on_hand)).quantize(Decimal("0.0001")) == Decimal("14.5000")

        recipe = db.session.get(Recipe, recipe_id)
        assert recipe is not None
        assert Decimal(str(item.average_unit_cost)).quantize(Decimal("0.0001")) == Decimal("2.3333")
        assert recipe.ingredients[0].quantity_required == Decimal("0.2500")
        assert db.session.get(MenuItem, menu_item_id).selling_price == Decimal("18.00")


@pytest.mark.parametrize("refresh_mode", ("proactive", "401"))
def test_postgres_clover_refresh_serializes_single_use_rotation(postgres_app, monkeypatch, refresh_mode):
    """Two independent PostgreSQL sessions must rotate a single-use token only once."""
    from concurrent.futures import ThreadPoolExecutor
    from cryptography.fernet import Fernet

    from backend.clover import CloverRequestError
    from backend.clover_integration import _catalog_snapshot_for_connection, _refresh_connection_token
    from backend.square import decrypt_integration_secret, encrypt_integration_secret
    from backend.seed import LOCAL_ORGANIZATION_NAME

    with postgres_app.app_context():
        postgres_app.config.update(
            CLOVER_CLIENT_ID="clover-client",
            CLOVER_CLIENT_SECRET="clover-secret",
            INTEGRATION_ENCRYPTION_KEY=Fernet.generate_key().decode("utf-8"),
        )
        _set_rls_context(access_scope="setup")
        organization = Organization.query.filter_by(name=LOCAL_ORGANIZATION_NAME).one()
        connection = CloverConnection(
            organization_id=organization.id,
            environment="sandbox",
            region="north_america",
            merchant_id=f"concurrency-{refresh_mode}",
            status="connected",
            access_token_ciphertext=encrypt_integration_secret("access-old"),
            refresh_token_ciphertext=encrypt_integration_secret("refresh-old"),
            access_expires_at=(
                datetime.now(timezone.utc) - timedelta(minutes=5)
                if refresh_mode == "proactive"
                else datetime.now(timezone.utc) + timedelta(hours=1)
            ),
        )
        db.session.add(connection)
        db.session.flush()
        connection_id = connection.id
        organization_id = organization.id
        db.session.commit()

    refresh_started = threading.Event()
    release_refresh = threading.Event()
    refresh_calls = []
    refresh_lock = threading.Lock()

    def fake_clover_request(method, path, **kwargs):
        assert method == "POST"
        assert path == "/oauth/v2/refresh"
        with refresh_lock:
            refresh_calls.append(kwargs["payload"]["refresh_token"])
            call_number = len(refresh_calls)
        if call_number == 1:
            refresh_started.set()
            assert release_refresh.wait(timeout=10)
        return {
            "access_token": "access-new",
            "refresh_token": "refresh-new",
            "access_token_expiration": 4102444800,
            "refresh_token_expiration": 4102444800,
        }

    monkeypatch.setattr("backend.clover_integration.clover_request", fake_clover_request)

    if refresh_mode == "401":
        fetch_calls = []
        fetch_lock = threading.Lock()

        def fake_fetch(self):
            with fetch_lock:
                fetch_calls.append(self.token)
            if self.token == "access-old":
                raise CloverRequestError("expired", status_code=401, code="clover_unauthorized")
            return object()

        monkeypatch.setattr("backend.clover_integration.CloverCatalogClient.fetch_snapshot", fake_fetch)

    barrier = threading.Barrier(2)

    def worker():
        with postgres_app.test_request_context("/"):
            _pin_rls_context(access_scope="setup")
            local_connection = db.session.get(CloverConnection, connection_id)
            local_organization = db.session.get(Organization, organization_id)
            assert local_connection is not None
            assert local_organization is not None
            observed = local_connection.access_token_ciphertext
            barrier.wait(timeout=10)
            if refresh_mode == "401":
                token = _catalog_snapshot_for_connection(local_connection, local_organization)
                assert token is not None
                result = "catalog"
            else:
                result = _refresh_connection_token(
                    local_connection,
                    local_organization,
                    observed_ciphertext=observed,
                )
            db.session.remove()
            return result

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(worker)
        second = executor.submit(worker)
        assert refresh_started.wait(timeout=10)
        # The second session must be waiting on the locked row, not rotating
        # the single-use refresh token independently.
        time.sleep(0.25)
        with refresh_lock:
            assert refresh_calls == ["refresh-old"]
        release_refresh.set()
        assert first.result(timeout=20) in {"access-new", "catalog"}
        assert second.result(timeout=20) in {"access-new", "catalog"}

    assert refresh_calls == ["refresh-old"]
    with postgres_app.app_context():
        _set_rls_context(access_scope="setup")
        saved = db.session.get(CloverConnection, connection_id)
        assert saved is not None
        assert decrypt_integration_secret(saved.access_token_ciphertext) == "access-new"
        assert decrypt_integration_secret(saved.refresh_token_ciphertext) == "refresh-new"
        db.session.delete(saved)
        db.session.commit()


def test_clover_inventory_execution_idempotency_corrections_rollback_and_concurrency(postgres_app):
    from decimal import Decimal
    from backend.models import CloverConnection, CloverShadowOrder, CloverShadowOrderLine, CloverShadowOrderLineInventoryConsumption, InventoryItem, InventoryMovement, RestaurantLocation, User

    application = postgres_app
    with application.test_request_context("/"):
        application.config["CLOVER_ORDER_INVENTORY_ENABLED"] = True
        _pin_rls_context(access_scope="setup")
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        owner_id = owner.id
        organization = make_operational_organization(owner, name=f"Clover inventory {uuid4()}", location_name="Main")
        organization_id = organization.id
        location = RestaurantLocation.query.filter_by(organization_id=organization_id).first()
        _pin_rls_context(access_scope="customer", organization_id=organization_id, user_id=owner_id)
        connection = CloverConnection(
            organization_id=organization.id,
            environment="sandbox",
            merchant_id="merchant-inventory",
            status="connected",
            access_token_ciphertext="ciphertext",
        )
        db.session.add(connection)
        db.session.flush()
        chicken = InventoryItem(
            organization_id=organization.id,
            location_id=location.id,
            name="Chicken",
            normalized_name=f"chicken-{uuid4()}",
            stock_unit="kg",
            current_on_hand=Decimal("10"),
            average_unit_cost=Decimal("12.50"),
        )
        buns = InventoryItem(
            organization_id=organization.id,
            location_id=location.id,
            name="Buns",
            normalized_name=f"buns-{uuid4()}",
            stock_unit="pack",
            current_on_hand=Decimal("20"),
            average_unit_cost=Decimal("2.00"),
        )
        db.session.add_all([chicken, buns])
        db.session.flush()
        order = CloverShadowOrder(
            organization_id=organization.id,
            clover_connection_id=connection.id,
            restaurant_location_id=location.id,
            clover_merchant_id=connection.merchant_id,
            clover_order_id=f"paid-{uuid4()}",
            provider_status="CLOSED",
            normalized_status="paid",
            payment_status="paid",
            potentially_eligible=True,
            requires_review=False,
            total_cents=1800,
            raw_payload_json={},
        )
        db.session.add(order)
        db.session.flush()
        line = CloverShadowOrderLine(
            organization_id=organization.id,
            restaurant_location_id=location.id,
            shadow_order_id=order.id,
            clover_line_item_id=f"line-{uuid4()}",
            clover_item_id="burger",
            name="Test Burger",
            quantity=Decimal("1"),
            mapping_status="mapped",
            recipe_preview_json={
                "ingredients": [
                    {"inventoryItemId": chicken.id, "quantity": "0.1800", "unit": "kg", "name": "Chicken"},
                    {"inventoryItemId": buns.id, "quantity": "0.2500", "unit": "pack", "name": "Buns"},
                ],
            },
        )
        db.session.add(line)
        db.session.commit()

        first = apply_clover_order_inventory(order=order, connection=connection)
        db.session.commit()
        assert first["applied"] is True
        assert InventoryMovement.query.filter_by(source_record_id=order.clover_order_id).count() == 2
        assert CloverShadowOrderLineInventoryConsumption.query.filter_by(clover_shadow_order_line_id=line.id).count() == 2
        assert InventoryItem.query.get(chicken.id).current_on_hand == Decimal("9.8200")
        assert InventoryItem.query.get(buns.id).current_on_hand == Decimal("19.7500")

        second = apply_clover_order_inventory(order=order, connection=connection)
        db.session.commit()
        assert second["alreadyApplied"]
        assert InventoryMovement.query.filter_by(source_record_id=order.clover_order_id).count() == 2

        line.recipe_preview_json["ingredients"][0]["quantity"] = "0.2000"
        # db.JSON is not mutable-tracked, so in-place edits must be flagged or they never reach the database
        # (and the concurrent workers below would load the stale recipe and record an extra correction).
        flag_modified(line, "recipe_preview_json")
        db.session.flush()
        correction = apply_clover_order_inventory(order=order, connection=connection)
        db.session.commit()
        assert any(item["state"] == "correction" for item in correction["movements"])
        assert InventoryItem.query.get(chicken.id).current_on_hand == Decimal("9.8000")
        assert InventoryMovement.query.filter_by(source_record_id=order.clover_order_id).count() == 3
        assert CloverShadowOrderLineInventoryConsumption.query.filter_by(clover_shadow_order_line_id=line.id, inventory_item_id=chicken.id).one().unit_cost_snapshot == Decimal("12.500000")

        line.recipe_preview_json["ingredients"].append({"inventoryItemId": 999999, "quantity": "1", "unit": "kg", "name": "Missing"})
        flag_modified(line, "recipe_preview_json")
        db.session.flush()
        before_movements = InventoryMovement.query.filter_by(source_record_id=order.clover_order_id).count()
        try:
            apply_clover_order_inventory(order=order, connection=connection)
        except ValueError:
            db.session.rollback()
        else:
            raise AssertionError("missing ingredient should abort atomically")
        assert InventoryMovement.query.filter_by(source_record_id=order.clover_order_id).count() == before_movements

        open_order = CloverShadowOrder(
            organization_id=organization.id,
            clover_connection_id=connection.id,
            restaurant_location_id=location.id,
            clover_merchant_id=connection.merchant_id,
            clover_order_id=f"open-{uuid4()}",
            provider_status="OPEN",
            normalized_status="pending",
            payment_status="open",
            potentially_eligible=False,
            requires_review=True,
            raw_payload_json={"paymentStateConflict": True},
        )
        db.session.add(open_order)
        db.session.commit()
        assert apply_clover_order_inventory(order=open_order, connection=connection)["eligible"] is False

        application.config["CLOVER_ORDER_INVENTORY_ENABLED"] = False
        dry = apply_clover_order_inventory(order=order, connection=connection, dry_run=True)
        assert dry["dryRun"] is True
        assert InventoryMovement.query.filter_by(source_record_id=order.clover_order_id).count() == before_movements

        application.config["CLOVER_ORDER_INVENTORY_ENABLED"] = True
        # End the main session's open transaction first: the dry run above can leave
        # row locks held, which would make both workers block until the join timeout.
        db.session.commit()
        barrier = threading.Barrier(2)
        errors = []

        order_id = order.id
        connection_id = connection.id

        def worker():
            try:
                with application.test_request_context("/"):
                    _pin_rls_context(access_scope="customer", organization_id=organization_id, user_id=owner_id)
                    local_order = CloverShadowOrder.query.filter_by(id=order_id).one()
                    local_connection = CloverConnection.query.filter_by(id=connection_id).one()
                    barrier.wait(timeout=10)
                    apply_clover_order_inventory(order=local_order, connection=local_connection)
                    db.session.commit()
            except Exception as exc:
                errors.append(exc)
                db.session.rollback()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        assert not any(thread.is_alive() for thread in threads), "concurrent Clover apply workers did not finish"
        assert not errors
        assert InventoryMovement.query.filter_by(source_record_id=order.clover_order_id).count() == before_movements
        assert CloverShadowOrderLineInventoryConsumption.query.filter_by(clover_shadow_order_line_id=line.id).count() == 2



def test_clover_inventory_concurrent_first_apply_and_mid_transaction_rollback(postgres_app, monkeypatch):
    from decimal import Decimal
    from backend.clover_inventory import apply_clover_order_inventory
    from backend.models import (
        CloverConnection,
        CloverShadowOrder,
        CloverShadowOrderLine,
        CloverShadowOrderLineInventoryConsumption,
        InventoryItem,
        InventoryMovement,
        Organization,
        RestaurantLocation,
        User,
    )

    application = postgres_app
    with application.test_request_context("/"):
        application.config["CLOVER_ORDER_INVENTORY_ENABLED"] = True
        _pin_rls_context(access_scope="setup")
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        organization_name = f"Clover concurrent {uuid4()}"
        make_operational_organization(owner, name=organization_name, location_name="Main")
        _pin_rls_context(access_scope="setup")
        organization = Organization.query.filter_by(name=organization_name).one()
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        _pin_rls_context(access_scope="customer", organization_id=organization.id, user_id=owner.id)
        organization_id = organization.id
        owner_id = owner.id
        connection = CloverConnection(
            organization_id=organization.id,
            environment="sandbox",
            merchant_id=f"merchant-{uuid4()}",
            status="connected",
            access_token_ciphertext="ciphertext",
        )
        chicken = InventoryItem(
            organization_id=organization.id,
            location_id=location.id,
            name="Chicken",
            normalized_name=f"chicken-{uuid4()}",
            stock_unit="kg",
            current_on_hand=Decimal("10"),
            average_unit_cost=Decimal("12.50"),
        )
        buns = InventoryItem(
            organization_id=organization.id,
            location_id=location.id,
            name="Buns",
            normalized_name=f"buns-{uuid4()}",
            stock_unit="pack",
            current_on_hand=Decimal("20"),
            average_unit_cost=Decimal("2.00"),
        )
        db.session.add_all([connection, chicken, buns])
        db.session.flush()
        order = CloverShadowOrder(
            organization_id=organization.id,
            clover_connection_id=connection.id,
            restaurant_location_id=location.id,
            clover_merchant_id=connection.merchant_id,
            clover_order_id=f"concurrent-first-{uuid4()}",
            provider_status="CLOSED",
            normalized_status="paid",
            payment_status="paid",
            potentially_eligible=True,
            requires_review=False,
            total_cents=1800,
            raw_payload_json={},
        )
        db.session.add(order)
        db.session.flush()
        line = CloverShadowOrderLine(
            organization_id=organization.id,
            restaurant_location_id=location.id,
            shadow_order_id=order.id,
            clover_line_item_id=f"line-{uuid4()}",
            clover_item_id="burger",
            name="Test Burger",
            quantity=Decimal("1"),
            mapping_status="mapped",
            recipe_preview_json={
                "ingredients": [
                    {"inventoryItemId": chicken.id, "quantity": "0.1800", "unit": "kg", "name": "Chicken"},
                    {"inventoryItemId": buns.id, "quantity": "0.2500", "unit": "pack", "name": "Buns"},
                ],
            },
        )
        db.session.add_all([order, line])
        db.session.commit()
        order_id = order.id
        connection_id = connection.id

        from sqlalchemy.orm import Session

        def open_session():
            local_session = Session(bind=db.engine)
            for name, value in (
                ("flowtally.access_scope", "customer"),
                ("flowtally.organization_id", str(organization_id)),
                ("flowtally.user_id", str(owner_id)),
                ("flowtally.support_grant_id", ""),
            ):
                local_session.execute(text("select set_config(:name, :value, true)"), {"name": name, "value": value})
            return local_session

        session_one = open_session()
        session_two = open_session()
        try:
            local_order_one = session_one.query(CloverShadowOrder).filter_by(id=order_id).one()
            local_connection_one = session_one.query(CloverConnection).filter_by(id=connection_id).one()
            local_order_two = session_two.query(CloverShadowOrder).filter_by(id=order_id).one()
            local_connection_two = session_two.query(CloverConnection).filter_by(id=connection_id).one()

            first_result = apply_clover_order_inventory(
                order=local_order_one,
                connection=local_connection_one,
                session=session_one,
            )
            session_one.commit()
            second_result = apply_clover_order_inventory(
                order=local_order_two,
                connection=local_connection_two,
                session=session_two,
            )
            session_two.commit()
        finally:
            session_one.close()
            session_two.close()

        _pin_rls_context(access_scope="customer", organization_id=organization_id, user_id=owner_id)
        assert first_result["applied"] is True
        assert second_result["alreadyApplied"]
        assert InventoryMovement.query.filter_by(source_record_id=order.clover_order_id).count() == 2
        assert CloverShadowOrderLineInventoryConsumption.query.filter_by(clover_shadow_order_line_id=line.id).count() == 2
        assert InventoryItem.query.get(chicken.id).current_on_hand == Decimal("9.8200")
        assert InventoryItem.query.get(buns.id).current_on_hand == Decimal("19.7500")

        rollback_order = CloverShadowOrder(
            organization_id=organization.id,
            clover_connection_id=connection.id,
            restaurant_location_id=location.id,
            clover_merchant_id=connection.merchant_id,
            clover_order_id=f"rollback-{uuid4()}",
            provider_status="CLOSED",
            normalized_status="paid",
            payment_status="paid",
            potentially_eligible=True,
            requires_review=False,
            total_cents=1800,
            raw_payload_json={},
        )
        db.session.add(rollback_order)
        db.session.flush()
        rollback_order_id = db.session.query(CloverShadowOrder.id).filter_by(clover_order_id=rollback_order.clover_order_id).scalar()
        assert rollback_order_id is not None
        rollback_line = CloverShadowOrderLine(
            organization_id=organization.id,
            restaurant_location_id=location.id,
            shadow_order_id=rollback_order_id,
            clover_line_item_id=f"line-{uuid4()}",
            clover_item_id="burger",
            name="Test Burger",
            quantity=Decimal("1"),
            mapping_status="mapped",
            recipe_preview_json={
                "ingredients": [
                    {"inventoryItemId": chicken.id, "quantity": "0.1800", "unit": "kg", "name": "Chicken"},
                    {"inventoryItemId": buns.id, "quantity": "0.2500", "unit": "pack", "name": "Buns"},
                ],
            },
        )
        db.session.add(rollback_line)
        db.session.commit()
        _pin_rls_context(access_scope="customer", organization_id=organization_id, user_id=owner_id)
        before_chicken = InventoryItem.query.get(chicken.id).current_on_hand
        before_buns = InventoryItem.query.get(buns.id).current_on_hand
        before_movements = InventoryMovement.query.count()
        before_ledgers = CloverShadowOrderLineInventoryConsumption.query.count()

        rollback_session = db.session()
        real_add = rollback_session.add

        def add_then_fail(instance, *args, **kwargs):
            real_add(instance, *args, **kwargs)
            if isinstance(instance, InventoryMovement):
                raise RuntimeError("controlled mid-transaction failure")

        monkeypatch.setattr(rollback_session, "add", add_then_fail)
        try:
            apply_clover_order_inventory(order=rollback_order, connection=connection, session=rollback_session)
        except RuntimeError:
            rollback_session.rollback()
        else:
            raise AssertionError("controlled failure should abort inventory execution")

        _pin_rls_context(access_scope="customer", organization_id=organization_id, user_id=owner_id)
        assert InventoryItem.query.get(chicken.id).current_on_hand == before_chicken
        assert InventoryItem.query.get(buns.id).current_on_hand == before_buns
        assert InventoryMovement.query.count() == before_movements
        assert CloverShadowOrderLineInventoryConsumption.query.count() == before_ledgers


def test_postgres_supplier_item_mappings_enforce_location_isolation_and_unique_races(postgres_app, monkeypatch):
    """Supplier-item mappings are org-scoped rows whose location comes from the inventory item.

    Runs the real endpoints on PostgreSQL with forced RLS: another location's mappings are
    invisible and immutable, other organizations' suppliers are 404, and a lost
    create race is a deterministic 409 decided by the unique constraint.
    """
    import threading
    from backend import pilot_api
    from backend.models import InventoryItem, RestaurantLocation, Supplier, SupplierItemMapping
    from backend.seed import LOCAL_LOCATION_NAME, LOCAL_ORGANIZATION_NAME

    suffix = uuid4().hex[:8]

    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        organization = Organization.query.filter_by(name=LOCAL_ORGANIZATION_NAME).one()
        home = RestaurantLocation.query.filter_by(organization_id=organization.id, name=LOCAL_LOCATION_NAME).one()
        other_location = RestaurantLocation(
            organization_id=organization.id, name=f"Second {suffix}", address_line1="2 Other St",
            city="Toronto", region="ON", postal_code="M5V 2B2", country="Canada", timezone="America/Toronto",
        )
        supplier = Supplier(organization_id=organization.id, name=f"Map Supplier {suffix}", normalized_name=f"map supplier {suffix}")
        db.session.add_all([other_location, supplier])
        db.session.flush()
        home_item = InventoryItem(organization_id=organization.id, location_id=home.id, name=f"Home Item {suffix}", normalized_name=f"home item {suffix}", stock_unit="kg")
        other_item = InventoryItem(organization_id=organization.id, location_id=other_location.id, name=f"Other Item {suffix}", normalized_name=f"other item {suffix}", stock_unit="kg")
        db.session.add_all([home_item, other_item])
        db.session.flush()
        other_mapping = SupplierItemMapping(
            organization_id=organization.id, supplier_id=supplier.id, inventory_item_id=other_item.id,
            supplier_item_name="Location B Sack", normalized_supplier_item_name="location b sack",
            purchase_unit="sack", inventory_unit="kg", conversion_factor=10,
        )
        db.session.add(other_mapping)
        db.session.flush()
        foreign_owner = User(email=f"foreign-owner-{suffix}@example.com", password_hash="!unusable", is_active=True)
        db.session.add(foreign_owner)
        db.session.flush()
        foreign_org = _create_org(foreign_owner, f"Foreign {suffix}")
        foreign_supplier = Supplier(organization_id=foreign_org.id, name=f"Foreign Supplier {suffix}", normalized_name=f"foreign supplier {suffix}")
        db.session.add(foreign_supplier)
        db.session.flush()
        return {
            "home_location_id": home.id, "supplier_id": supplier.id, "home_item_id": home_item.id, "other_item_id": other_item.id,
            "other_mapping_id": other_mapping.id, "foreign_supplier_id": foreign_supplier.id,
        }

    ids = _seed_admin_fixture("supplier item mappings", _seed)
    base = f"/api/pilot/suppliers/{ids['supplier_id']}/item-mappings"

    def _headers(client):
        return {"X-CSRFToken": client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001").get_json()["csrfToken"]}

    def _call(client, method, url, **kwargs):
        return getattr(client, method)(url, base_url="http://127.0.0.1:5001", headers=_headers(client), **kwargs)

    def _login_at_home(test_client):
        _login_owner(test_client)
        selected = _call(test_client, "post", "/api/locations/select", json={"locationId": ids["home_location_id"]})
        assert selected.status_code == 200, selected.get_data(as_text=True)

    client = postgres_app.test_client()
    _login_at_home(client)
    payload = {"supplierItemName": "Location A Sack", "inventoryItemId": ids["home_item_id"], "purchaseUnit": "sack", "inventoryUnit": "kg", "conversionFactor": 5}

    first = client.get(base, base_url="http://127.0.0.1:5001")
    assert first.status_code == 200, first.get_data(as_text=True)
    assert first.get_json()["mappings"] == []
    created = _call(client, "post", base, json=payload)
    assert created.status_code == 201, created.get_data(as_text=True)
    own_id = created.get_json()["id"]
    listed = client.get(base, base_url="http://127.0.0.1:5001").get_json()["mappings"]
    assert [row["supplierItemName"] for row in listed] == ["Location A Sack"]

    # Cross-location read/update/delete and re-pointing are all rejected.
    assert _call(client, "patch", f"{base}/{ids['other_mapping_id']}", json={"conversionFactor": 99}).status_code == 404
    assert _call(client, "delete", f"{base}/{ids['other_mapping_id']}").status_code == 404
    assert _call(client, "patch", f"{base}/{own_id}", json={"inventoryItemId": ids["other_item_id"]}).status_code == 404
    assert _call(client, "post", base, json={**payload, "supplierItemName": "X", "inventoryItemId": ids["other_item_id"]}).status_code == 404
    # Another organization's supplier is invisible.
    foreign_base = f"/api/pilot/suppliers/{ids['foreign_supplier_id']}/item-mappings"
    assert client.get(foreign_base, base_url="http://127.0.0.1:5001").status_code == 404
    assert _call(client, "post", foreign_base, json=payload).status_code == 404

    def _verify():
        other = SupplierItemMapping.query.get(ids["other_mapping_id"])
        own = SupplierItemMapping.query.get(own_id)
        return float(other.conversion_factor), own.inventory_item_id, SupplierItemMapping.query.filter_by(supplier_id=ids["supplier_id"]).count()

    assert _seed_admin_fixture("supplier item mappings verify", _verify) == (10.0, ids["home_item_id"], 2)

    # Lost create race: both requests pass the duplicate pre-check, the unique constraint picks one winner.
    barrier = threading.Barrier(2, timeout=10)
    original = pilot_api._mapping_duplicate

    def _racy_duplicate(*args, **kwargs):
        result = original(*args, **kwargs)
        try:
            barrier.wait()
        except threading.BrokenBarrierError:
            pass
        return result

    monkeypatch.setattr(pilot_api, "_mapping_duplicate", _racy_duplicate)
    race_payload = {**payload, "supplierItemName": "Racing Sack"}
    results: list[int] = []

    def _worker():
        worker_client = postgres_app.test_client()
        _login_at_home(worker_client)
        results.append(_call(worker_client, "post", base, json=race_payload).status_code)

    threads = [threading.Thread(target=_worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert sorted(results) == [201, 409]

    count = _seed_admin_fixture(
        "supplier item mappings race verify",
        lambda: SupplierItemMapping.query.filter_by(supplier_id=ids["supplier_id"], normalized_supplier_item_name="racing sack").count(),
    )
    assert count == 1


def test_clover_applied_order_is_flagged_never_restored_and_fails_closed_under_concurrency(postgres_app):
    """#183: applied usage is reversed (once) when the order later becomes refunded/voided or loses a line."""
    from backend.models import CloverConnection, CloverShadowOrder, CloverShadowOrderLine, CloverShadowOrderLineInventoryConsumption, InventoryItem, InventoryMovement, RestaurantLocation, User

    application = postgres_app
    with application.test_request_context("/"):
        application.config["CLOVER_ORDER_INVENTORY_ENABLED"] = True
        _pin_rls_context(access_scope="setup")
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        owner_id = owner.id
        organization = make_operational_organization(owner, name=f"Clover reversal {uuid4()}", location_name="Main")
        organization_id = organization.id
        location = RestaurantLocation.query.filter_by(organization_id=organization_id).first()
        _pin_rls_context(access_scope="customer", organization_id=organization_id, user_id=owner_id)
        connection = CloverConnection(organization_id=organization_id, environment="sandbox", merchant_id="merchant-reversal", status="connected", access_token_ciphertext="ciphertext")
        db.session.add(connection)
        db.session.flush()
        items = [
            InventoryItem(organization_id=organization_id, location_id=location.id, name=name, normalized_name=f"{name}-{uuid4()}", stock_unit=unit, current_on_hand=Decimal("10"), average_unit_cost=Decimal("2"))
            for name, unit in (("Chicken", "kg"), ("Buns", "pack"))
        ]
        db.session.add_all(items)
        db.session.flush()

        def make_order(label):
            order = CloverShadowOrder(
                organization_id=organization_id, clover_connection_id=connection.id, restaurant_location_id=location.id,
                clover_merchant_id=connection.merchant_id, clover_order_id=f"{label}-{uuid4()}", provider_status="CLOSED",
                normalized_status="paid", payment_status="PAID", potentially_eligible=True, requires_review=False, raw_payload_json={},
            )
            db.session.add(order)
            db.session.flush()
            lines = []
            for index, item in enumerate(items):
                line = CloverShadowOrderLine(
                    organization_id=organization_id, restaurant_location_id=location.id, shadow_order_id=order.id,
                    clover_line_item_id=f"{label}-l{index}-{uuid4()}", clover_item_id=f"i{index}", name=f"Dish {index}", quantity=Decimal("1"),
                    mapping_status="mapped",
                    recipe_preview_json={"ingredients": [{"inventoryItemId": item.id, "quantity": "1.0000", "unit": item.stock_unit, "name": item.name}]},
                )
                db.session.add(line)
                lines.append(line)
            db.session.commit()
            assert apply_clover_order_inventory(order=order, connection=connection)["applied"] is True
            db.session.commit()
            return order, lines

        def on_hand():
            return [InventoryItem.query.get(item.id).current_on_hand for item in items]

        forged = lambda lines: {"notPrepared": True, "lineItems": [{"id": line.clover_line_item_id, "notPrepared": True} for line in lines]}

        def flag(order, lines, *, status, provider, payment, extra=None):
            order.normalized_status, order.provider_status, order.payment_status = status, provider, payment
            order.potentially_eligible, order.requires_review, order.total_cents = False, True, 1800
            order.raw_payload_json = {**forged(lines), **(extra or {})}
            db.session.commit()

        def reconcile_twice(order):
            results = []
            for _ in range(2):
                results.append(apply_clover_order_inventory(order=order, connection=connection))
                db.session.commit()
            return results

        scenarios = {
            "refund": dict(status="refunded", provider="PAID", payment="refunded", extra={"orderComponents": [], "payments": [{"id": "p", "amount": 1800, "result": "SUCCESS", "components": []}], "refunds": [{"id": "r", "amount": 1800, "components": []}]}),
            "void": dict(status="cancelled", provider="VOIDED", payment="VOIDED"),
            "partial": dict(status="refunded", provider="PAID", payment="refunded", extra={"refunds": [{"id": "r", "amount": 400, "components": []}]}),
            "conflict": dict(status="review", provider="CLOSED", payment="PAID", extra={"paymentStateConflict": True}),
        }
        expected_on_hand = Decimal("9")
        for label, scenario in scenarios.items():
            order, lines = make_order(label)
            if label == "refund":
                refund_order_id = order.id
            assert on_hand() == [expected_on_hand, expected_on_hand], label
            flag(order, lines, **scenario)
            for result in reconcile_twice(order):
                assert result["applied"] is False and result["appliedRequiresReview"] is True, label
                assert len(result["staleApplied"]) == 2, label
            # Stock unchanged by the review state (forged notPrepared markers are ignored).
            assert on_hand() == [expected_on_hand, expected_on_hand], label
            assert InventoryMovement.query.filter_by(source_record_id=order.clover_order_id).count() == 2, label
            expected_on_hand -= 1

        # Removed mapped line: flagged, nothing restored.
        removed, lines = make_order("removed")
        lines[1].mapping_status = "review_required"
        lines[1].recipe_preview_json = {"reason": "Clover removed a line after inventory application; manual correction is required."}
        removed.raw_payload_json = forged(lines)
        db.session.commit()
        before = on_hand()
        for result in reconcile_twice(removed):
            assert result["applied"] is False and result["appliedRequiresReview"] is True
        assert on_hand() == before
        assert InventoryMovement.query.filter_by(source_record_id=removed.clover_order_id).count() == 2

        # Two concurrent reconciliations of a flagged order both fail closed and write nothing.
        from concurrent.futures import ThreadPoolExecutor
        from sqlalchemy.orm import Session

        flagged_id, flagged_connection_id = refund_order_id, connection.id
        db.session.commit()

        engine = db.engine

        def worker():
            local = Session(bind=engine)
            try:
                for name, value in (("flowtally.access_scope", "customer"), ("flowtally.organization_id", str(organization_id)), ("flowtally.user_id", str(owner_id)), ("flowtally.support_grant_id", "")):
                    local.execute(text("select set_config(:name, :value, true)"), {"name": name, "value": value})
                local_order = local.query(CloverShadowOrder).filter_by(id=flagged_id).one()
                local_connection = local.query(CloverConnection).filter_by(id=flagged_connection_id).one()
                with application.app_context():
                    outcome = apply_clover_order_inventory(order=local_order, connection=local_connection, session=local)
                local.commit()
                return outcome
            finally:
                local.close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = [future.result(timeout=30) for future in [executor.submit(worker), executor.submit(worker)]]
        assert all(outcome["applied"] is False and outcome["appliedRequiresReview"] is True for outcome in outcomes)
        _pin_rls_context(access_scope="customer", organization_id=organization_id, user_id=owner_id)
        assert on_hand() == before


# --- #215: one active POS provider per location (PostgreSQL, endpoint-level) ---------------------

def _provider_fixture(*, square_status: str = "connected", extra_org: bool = False):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    assert owner is not None
    organization = _create_org(owner, f"RLS Provider {uuid4().hex[:6]}")
    location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
    square_connection = SquareConnection(organization_id=organization.id, environment="sandbox", square_merchant_id="m-sq", status=square_status)
    clover_connection = CloverConnection(organization_id=organization.id, environment="sandbox", merchant_id="m-cl", status="connected", access_token_ciphertext="x")
    db.session.add_all([square_connection, clover_connection])
    db.session.flush()
    square_location = SquareLocation(square_connection_id=square_connection.id, square_location_id=f"L-{uuid4().hex[:6]}", name="SQ", status="active", raw_payload_json={})
    db.session.add(square_location)
    db.session.flush()
    result = {"organization_id": organization.id, "location_id": location.id, "square_location_id": square_location.id}
    if extra_org:
        other = _create_org(owner, f"RLS Provider Other {uuid4().hex[:6]}")
        result["other_location_id"] = RestaurantLocation.query.filter_by(organization_id=other.id).first().id
    return result


def _provider_client(app, organization_id):
    from types import SimpleNamespace  # noqa: F401  (kept local; used by monkeypatch targets)

    client = app.test_client()
    _login_owner(client)
    token = client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001").get_json()["csrfToken"]
    selected = client.post("/api/organizations/select", base_url="http://127.0.0.1:5001", headers={"X-CSRFToken": token}, json={"organizationId": organization_id})
    assert selected.status_code == 200, selected.get_data(as_text=True)
    return client, token


def _provider_requests(app, seeded, tokens):
    base = "http://127.0.0.1:5001"
    org_id, loc_id = seeded["organization_id"], seeded["location_id"]
    return {
        "square": lambda client: client.post("/api/integrations/square/location-mappings", base_url=base, headers={"X-CSRFToken": tokens[id(client)]},
                                             json={"organizationId": org_id, "squareLocationId": seeded["square_location_id"], "restaurantLocationId": loc_id}),
        "clover": lambda client: client.post("/api/integrations/clover/location-mapping", base_url=base, headers={"X-CSRFToken": tokens[id(client)]},
                                             json={"organizationId": org_id, "locationId": loc_id, "cloverLocationId": None, "confirm": True}),
    }


def _prepare_provider_app(postgres_app, monkeypatch, organization_id, *, delay=0.0):
    import time as _time
    from types import SimpleNamespace

    from backend import clover_integration, pos_provider, square_integration
    from backend.tests.test_clover_mapping import _configure

    configure_square(postgres_app)
    _configure(postgres_app, organization_id)
    monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", lambda _: "token")
    monkeypatch.setattr("backend.clover_integration.CloverCatalogClient.fetch_snapshot", lambda self: SimpleNamespace(items=(), location=None))
    if delay:
        real = pos_provider.other_active_provider

        def slow_check(*args, **kwargs):
            found = real(*args, **kwargs)
            _time.sleep(delay)  # widen the check-then-write window; only the row lock can close it
            return found

        monkeypatch.setattr(clover_integration, "other_active_provider", slow_check)
        monkeypatch.setattr(square_integration, "other_active_provider", slow_check)


def _active_providers_at(organization_id, location_id):
    from backend.models import CloverLocationMapping

    with_square = SquareLocationMapping.query.join(SquareLocation, SquareLocation.id == SquareLocationMapping.square_location_id).filter(SquareLocationMapping.restaurant_location_id == location_id).count()
    with_clover = CloverLocationMapping.query.filter_by(restaurant_location_id=location_id, organization_id=organization_id).count()
    return with_square, with_clover


@pytest.mark.parametrize("square_status", ["connected"])
def test_concurrent_square_and_clover_mapping_never_activate_two_providers(postgres_app, monkeypatch, square_status):
    seeded = _seed_admin_fixture("provider race dataset", lambda: _provider_fixture())
    org_id, loc_id = int(seeded["organization_id"]), int(seeded["location_id"])
    _prepare_provider_app(postgres_app, monkeypatch, org_id, delay=0.6)
    clients, tokens = [], {}
    for _ in range(2):
        client, token = _provider_client(postgres_app, org_id)
        clients.append(client)
        tokens[id(client)] = token
    requests = _provider_requests(postgres_app, seeded, tokens)
    barrier = threading.Barrier(2)
    results: dict[str, int] = {}

    def _run(name, client):
        barrier.wait()
        results[name] = requests[name](client).status_code

    threads = [threading.Thread(target=_run, args=("square", clients[0])), threading.Thread(target=_run, args=("clover", clients[1]))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert sorted(results.values()) == [200, 409], results
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=org_id)
        square_count, clover_count = _active_providers_at(org_id, loc_id)
        assert square_count + clover_count == 1, (results, square_count, clover_count)


def test_sequential_provider_conflict_and_disconnected_switch_via_endpoints(postgres_app, monkeypatch):
    seeded = _seed_admin_fixture("provider switch dataset", lambda: _provider_fixture(square_status="disconnected"))
    org_id, loc_id = int(seeded["organization_id"]), int(seeded["location_id"])
    _prepare_provider_app(postgres_app, monkeypatch, org_id)
    client, token = _provider_client(postgres_app, org_id)
    requests = _provider_requests(postgres_app, seeded, {id(client): token})
    # Square is disconnected, so Clover may take the location...
    assert requests["clover"](client).status_code == 200
    # ...and Square (still disconnected) is not blocked by an inactive state of its own, but Clover is active now.
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=org_id)
        assert _active_providers_at(org_id, loc_id) == (0, 1)
    # Reconnect Square: a second active provider must be refused without a partial write.
    def _reconnect():
        SquareConnection.query.filter_by(organization_id=org_id).update({"status": "connected"})

    _seed_admin_fixture("provider reconnect", _reconnect)
    refused = requests["square"](client)
    assert refused.status_code == 409 and "Clover" in refused.get_json()["error"]
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=org_id)
        assert _active_providers_at(org_id, loc_id) == (0, 1)


def test_provider_mapping_cannot_target_another_organizations_location(postgres_app, monkeypatch):
    seeded = _seed_admin_fixture("provider tenant dataset", lambda: _provider_fixture(extra_org=True))
    org_id = int(seeded["organization_id"])
    other_location_id = int(seeded["other_location_id"])
    _prepare_provider_app(postgres_app, monkeypatch, org_id)
    client, token = _provider_client(postgres_app, org_id)
    base = "http://127.0.0.1:5001"
    square = client.post("/api/integrations/square/location-mappings", base_url=base, headers={"X-CSRFToken": token},
                         json={"organizationId": org_id, "squareLocationId": seeded["square_location_id"], "restaurantLocationId": other_location_id})
    clover = client.post("/api/integrations/clover/location-mapping", base_url=base, headers={"X-CSRFToken": token},
                         json={"organizationId": org_id, "locationId": other_location_id, "cloverLocationId": None, "confirm": True})
    assert square.status_code == 404 and clover.status_code in {404, 409}
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=org_id)
        assert _active_providers_at(org_id, other_location_id) == (0, 0)


def _clover_usage_fixture():
    from backend.models import CloverShadowOrder, CloverShadowOrderLine, CloverShadowOrderLineInventoryConsumption

    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    ids = []
    for label in ("A", "B"):
        organization = _create_org(owner, f"RLS Clover Usage {label} {uuid4().hex[:6]}")
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        connection = CloverConnection(organization_id=organization.id, environment="sandbox", merchant_id=f"m-{label}", status="connected", access_token_ciphertext="x")
        item = InventoryItem(organization_id=organization.id, location_id=location.id, name="Chicken", normalized_name=f"chicken-{uuid4().hex[:6]}", stock_unit="kg", current_on_hand=10, average_unit_cost=8)
        db.session.add_all([connection, item])
        db.session.flush()
        order = CloverShadowOrder(organization_id=organization.id, clover_connection_id=connection.id, restaurant_location_id=location.id, clover_merchant_id=f"m-{label}",
                                  clover_order_id=f"o-{uuid4().hex[:6]}", normalized_status="paid", requires_review=False, raw_payload_json={},
                                  source_closed_at=datetime(2026, 11, 3, 17, 0, tzinfo=timezone.utc))
        db.session.add(order)
        db.session.flush()
        qty = "0.5000" if label == "A" else "50.0000"
        line = CloverShadowOrderLine(organization_id=organization.id, restaurant_location_id=location.id, shadow_order_id=order.id, clover_line_item_id=f"l-{uuid4().hex[:6]}",
                                     clover_item_id="i", name="Plate", quantity=2, mapping_status="mapped",
                                     recipe_preview_json={"flowtallyMenuItemName": "Plate", "ingredients": [{"inventoryItemId": item.id, "quantity": qty, "unit": "kg", "name": "Chicken"}]})
        db.session.add(line)
        db.session.flush()
        db.session.add(CloverShadowOrderLineInventoryConsumption(organization_id=organization.id, location_id=location.id, clover_shadow_order_line_id=line.id,
                                                                 inventory_item_id=item.id, applied_quantity=qty, unit_cost_snapshot=8))
        ids.append({"organization_id": organization.id, "location_id": location.id})
    return ids


def test_clover_usage_queries_respect_rls_and_tenant_scope(postgres_app):
    from datetime import date

    from backend.clover_usage import clover_usage_for_day

    org_a, org_b = _seed_admin_fixture("clover usage rls dataset", _clover_usage_fixture)
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=org_a["organization_id"])
        location_a = RestaurantLocation.query.filter_by(id=org_a["location_id"]).one()
        result = clover_usage_for_day(location_a, date(2026, 11, 3), net_sales_cents=1000)
        assert result["usageAvailable"] and result["usageCostCents"] == 400 and result["foodCostPercent"] == 40.0
        assert [row["quantity"] for row in result["usage"]] == ["0.5000"]
        db.session.rollback()
        # Organization B's rows are invisible under A's context even when asked for B's location id directly.
        _set_rls_context(access_scope="customer", organization_id=org_a["organization_id"])
        foreign = RestaurantLocation(id=org_b["location_id"], organization_id=org_b["organization_id"], timezone="America/Toronto")
        leaked = clover_usage_for_day(foreign, date(2026, 11, 3), net_sales_cents=1000)
        assert leaked["usage"] == [] and leaked["menuSales"] == [] and leaked["exceptions"] == []
        db.session.rollback()
        _set_rls_context(access_scope="customer", organization_id=org_b["organization_id"])
        location_b = RestaurantLocation.query.filter_by(id=org_b["location_id"]).one()
        assert clover_usage_for_day(location_b, date(2026, 11, 3), net_sales_cents=1000)["usage"][0]["quantity"] == "50.0000"
        db.session.rollback()
