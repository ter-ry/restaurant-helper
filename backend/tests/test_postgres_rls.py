from __future__ import annotations

import importlib.util
import os
import threading
import time
from datetime import timedelta
import textwrap
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from backend.app import create_app
from backend.extensions import db
from backend.models import (
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
    MenuItem,
    Recipe,
    RecipeIngredient,
    RestaurantLocation,
    SquareConnection,
    SquareDailySalesSummary,
    SquareOrder,
    SupportAccessGrant,
    Supplier,
    User,
)
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD, seed_pilot_data
from backend.tests.conftest import make_operational_organization
from backend.utils import utc_now


MIGRATION_POSTGRES_URL = (
    os.environ.get("FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL")
    or os.environ.get("FLOWTALLY_MIGRATION_DATABASE_URL")
    or os.environ.get("FLOWTALLY_TEST_POSTGRES_ADMIN_URL")
    or os.environ.get("FLOWTALLY_TEST_POSTGRES_URL")
    or os.environ.get("DATABASE_URL", "")
)
ADMIN_POSTGRES_URL = (
    os.environ.get("FLOWTALLY_TEST_POSTGRES_ADMIN_URL")
    or os.environ.get("DATABASE_URL", "")
)
CATALOG_POSTGRES_URL = (
    os.environ.get("FLOWTALLY_MIGRATION_DATABASE_URL")
    or os.environ.get("FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL")
    or os.environ.get("FLOWTALLY_TEST_POSTGRES_ADMIN_URL")
    or os.environ.get("FLOWTALLY_TEST_POSTGRES_URL")
    or os.environ.get("DATABASE_URL", "")
)
RUNTIME_POSTGRES_URL = os.environ.get("FLOWTALLY_TEST_POSTGRES_URL") or os.environ.get("DATABASE_URL", "")
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
    print("BEFORE: postgres_app schema reset", flush=True)
    _reset_public_schema_for_rls_tests()
    print("AFTER: postgres_app schema reset", flush=True)
    with migrator_application.app_context():
        print(f"STATE: postgres_app migrator url -> {MIGRATION_POSTGRES_URL}", flush=True)
        print("BEFORE: postgres_app create_all", flush=True)
        _log_session_state("before create_all")
        with db.engine.connect() as connection:
            _log_connection_identity(connection, "postgres_app migrator create_all connection")
        db.create_all()
        print("AFTER: postgres_app create_all", flush=True)
        print("BEFORE: postgres_app seed_pilot_data", flush=True)
        _log_session_state("before seed_pilot_data")
        seed_pilot_data(reset=False)
        print("AFTER: postgres_app seed_pilot_data", flush=True)
        _log_session_state("after seed_pilot_data")
        print("BEFORE: postgres_app session cleanup experiment", flush=True)
        seed_session = db.session()
        if seed_session.in_transaction():
            seed_session.commit()
        db.session.remove()
        print("AFTER: postgres_app session cleanup experiment", flush=True)
        _log_session_state("after session cleanup experiment")
        with db.engine.begin() as connection:
            print("STATE: postgres_app bootstrap connection acquired", flush=True)
            _log_connection_identity(connection, "postgres_app bootstrap connection before RLS")
            print("BEFORE: postgres_app apply_postgres_rls", flush=True)
            _apply_bootstrap_timeouts(connection)
            _log_bootstrap_connection_state("postgres_app bootstrap pre-RLS", connection)
            apply_postgres_rls(_LoggingConnection(connection, "postgres_app apply_postgres_rls"))
            print("AFTER: postgres_app apply_postgres_rls", flush=True)
            print("BEFORE: postgres_app square_apply_postgres_rls", flush=True)
            square_apply_postgres_rls(_LoggingConnection(connection, "postgres_app square_apply_postgres_rls"))
            print("AFTER: postgres_app square_apply_postgres_rls", flush=True)
            print("BEFORE: postgres_app support_apply_postgres_rls", flush=True)
            support_apply_postgres_rls(_LoggingConnection(connection, "postgres_app support_apply_postgres_rls"))
            print("AFTER: postgres_app support_apply_postgres_rls", flush=True)
            print("BEFORE: postgres_app membership_discovery_apply_postgres_rls", flush=True)
            membership_discovery_apply_postgres_rls(_LoggingConnection(connection, "postgres_app membership_discovery_apply_postgres_rls"))
            print("AFTER: postgres_app membership_discovery_apply_postgres_rls", flush=True)
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


def _seed_admin_setup_dataset(prefix: str) -> dict[str, object]:
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        org_a = _create_org(owner, f"{prefix} Setup Alpha")
        org_b = _create_org(owner, f"{prefix} Setup Beta")
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
        assert module_keys == {"PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS"}
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

        with client.session_transaction(base_url="http://127.0.0.1:5001") as session:
            assert session["pilot_current_membership_id"] == membership_id
            assert session["pilot_current_organization_id"] == organization_id
            assert session["pilot_current_location_id"] == current_location_id

        follow_up = client.get("/api/onboarding/organizations", base_url="http://127.0.0.1:5001")
        assert follow_up.status_code == 200, follow_up.get_data(as_text=True)
        follow_up_body = follow_up.get_json()
        assert any(entry["organization"]["id"] == organization_id for entry in follow_up_body["organizations"])
        _github_warning("onboarding regression: follow-up onboarding list sees new organization")


def test_postgres_setup_console_mutations_materialize_before_commit(postgres_app):
    seeded = _seed_admin_setup_dataset("RLS Setup Console")
    with postgres_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
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
    assert state_response.get_json()["checklist"]["readyForActivation"] is True
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

    me_response = client.get("/api/auth/me", base_url="http://127.0.0.1:5001")
    assert me_response.status_code == 200, me_response.get_data(as_text=True)
    me_body = me_response.get_json()
    assert me_body["currentOrganizationId"] == org_a_id, me_body
    assert me_body["currentLocationId"] == org_a_location_id, me_body
    assert all(entry["organization"]["id"] != org_b_id for entry in me_body["organizations"]), me_body

    dashboard_response = client.get("/api/pilot/dashboard", base_url="http://127.0.0.1:5001")
    assert dashboard_response.status_code == 200, dashboard_response.get_data(as_text=True)
    dashboard_body = dashboard_response.get_json()
    assert dashboard_body["currentLocation"]["id"] == org_a_location_id, dashboard_body


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
            enabled_modules=("PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS"),
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
            enabled_modules=("PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS"),
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


def test_postgres_active_owner_can_load_dashboard_after_request_bootstrap(postgres_app):
    with postgres_app.app_context():
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
        organization_id = organization.id
        location_id = location.id
        other_organization_id = other_organization.id

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

    me_response = client.get("/api/auth/me", base_url="http://127.0.0.1:5001")
    assert me_response.status_code == 200, me_response.get_data(as_text=True)
    me_body = me_response.get_json()
    assert me_body["currentOrganizationId"] == organization_id, me_body
    assert me_body["currentLocationId"] == location_id, me_body
    assert any(entry["organization"]["id"] == organization_id for entry in me_body["organizations"]), me_body
    assert all(entry["organization"]["id"] != other_organization_id for entry in me_body["organizations"]), me_body

    dashboard_response = client.get("/api/pilot/dashboard", base_url="http://127.0.0.1:5001")
    assert dashboard_response.status_code == 200, dashboard_response.get_data(as_text=True)
    dashboard_body = dashboard_response.get_json()
    assert dashboard_body["currentLocation"]["id"] == location_id, dashboard_body


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
    seeded = _seed_membership_discovery_dataset("RLS")
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
