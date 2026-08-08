from __future__ import annotations

import importlib.util
import os
import threading
import time
from datetime import timedelta
import textwrap

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
        print("BEFORE: postgres_app drop_all", flush=True)
        _log_session_state("before drop_all")
        db.drop_all()
        print("AFTER: postgres_app drop_all", flush=True)
        print("BEFORE: postgres_app create_all", flush=True)
        _log_session_state("before create_all")
        db.create_all()
        print("AFTER: postgres_app create_all", flush=True)
        print("BEFORE: postgres_app seed_pilot_data", flush=True)
        _log_session_state("before seed_pilot_data")
        seed_pilot_data(reset=False)
        print("AFTER: postgres_app seed_pilot_data", flush=True)
        _log_session_state("after seed_pilot_data")
        with db.engine.begin() as connection:
            print("STATE: postgres_app bootstrap connection acquired", flush=True)
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
        print("BEFORE: postgres_app session timeouts", flush=True)
        db.session.execute(text(f"set statement_timeout = '{DIAGNOSTIC_STATEMENT_TIMEOUT}'"))
        db.session.execute(text(f"set lock_timeout = '{DIAGNOSTIC_LOCK_TIMEOUT}'"))
        print("AFTER: postgres_app session timeouts", flush=True)
        _log_session_state("after session timeouts")
        yield application
        print("BEFORE: postgres_app teardown", flush=True)
        _log_session_state("before teardown")
        db.session.remove()
        db.drop_all()
        print("AFTER: postgres_app teardown", flush=True)


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
        rows = connection.execute(text(statement), params or {}).all()
        print(f"AFTER: {label} -> {len(rows)} row(s)", flush=True)
        for row in rows:
            print(f"  ROW: {tuple(row)}", flush=True)
        return rows
    except Exception as exc:
        print(f"ERROR: {label} -> {exc.__class__.__name__}: {exc}", flush=True)
        db.session.rollback()
        raise


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

    def _worker() -> None:
        nonlocal started_at
        try:
            with engine.connect() as connection:
                connection.exec_driver_sql(f"set statement_timeout = '{DIAGNOSTIC_PROBE_STATEMENT_TIMEOUT}'")
                connection.exec_driver_sql(f"set lock_timeout = '{DIAGNOSTIC_PROBE_LOCK_TIMEOUT}'")
                probe_state["backend_pid"] = connection.exec_driver_sql("select pg_backend_pid()").scalar_one()
                ready.set()
                print(f"START PROBE [{label}] category={sql_category}", flush=True)
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
            if elapsed >= DIAGNOSTIC_WAIT_INSPECTION_SECONDS:
                _capture_pg_wait_state(engine, label, int(probe_state["backend_pid"]))
                inspected = True
        if time.monotonic() >= deadline:
            print(f"WAIT STATE [{label}] exceeded diagnostic deadline; continuing to next probe", flush=True)
            break

    if worker.is_alive():
        worker.join(timeout=0.5)

    return probe_state


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
    return {"org_a": org_a, "org_b": org_b}


def _restore_rls_context(access_scope: str, organization_id: int | None = None, support_grant_id: int | None = None) -> None:
    _set_rls_context(access_scope=access_scope, organization_id=organization_id, support_grant_id=support_grant_id)


def _log_probe(label: str, statement, params: dict[str, object] | None = None) -> object:
    return _log_scalar_probe(label, statement, params)


def _dump_function_metadata(name: str, argcount: int) -> None:
    rows = _log_rows_probe(
        f"function metadata {name}/{argcount}",
        """
        select
            p.oid::regprocedure::text as signature,
            p.prosecdef,
            p.proconfig,
            pg_get_userbyid(p.proowner) as owner,
            pg_get_function_identity_arguments(p.oid) as identity_arguments,
            pg_get_function_arguments(p.oid) as arguments
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = current_schema()
          and p.proname = :name
          and p.pronargs = :argcount
        order by p.oid
        """,
        {"name": name, "argcount": argcount},
    )
    assert rows


def _dump_function_definition(name: str, argcount: int) -> None:
    rows = _log_rows_probe(
        f"function definition {name}/{argcount}",
        """
        select
            p.oid::regprocedure::text as signature,
            p.prosecdef,
            p.proconfig,
            pg_get_userbyid(p.proowner) as owner,
            pg_get_functiondef(p.oid) as definition
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = current_schema()
          and p.proname = :name
          and p.pronargs = :argcount
        order by p.oid
        """,
        {"name": name, "argcount": argcount},
    )
    assert rows


def _dump_policy_metadata(table_name: str) -> None:
    rows = _log_rows_probe(
        f"policy metadata {table_name}",
        """
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
        {"table_name": table_name},
    )
    assert rows


def _dump_pg_definitions() -> None:
    engine = db.engine
    _run_pg_diagnostic_probe(
        engine,
        label="basic connectivity",
        sql_category="connectivity",
        statement="""
            select
                version() as version,
                current_database() as current_database,
                current_user as current_user,
                session_user as session_user,
                pg_backend_pid() as backend_pid
        """,
        result_mode="row",
    )

    function_specs = [
        ("flowtally_current_access_scope", 0),
        ("flowtally_current_organization_id", 0),
        ("flowtally_current_support_grant_id", 0),
        ("flowtally_support_has_access", 1),
        ("flowtally_has_org_access", 1),
    ]
    for name, argcount in function_specs:
        metadata = _run_pg_diagnostic_probe(
            engine,
            label=f"pg_proc metadata {name}/{argcount}",
            sql_category="pg_proc metadata",
            statement="""
                select
                    p.oid as oid,
                    n.nspname as schema_name,
                    p.proname as function_name,
                    pg_get_function_identity_arguments(p.oid) as identity_arguments,
                    p.prokind as prokind,
                    p.prosecdef as prosecdef,
                    p.provolatile as provolatile
                from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = current_schema()
                  and p.proname = :name
                  and p.pronargs = :argcount
                order by p.oid
            """,
            params={"name": name, "argcount": argcount},
        )
        for row in metadata["result"] or []:
            _run_pg_diagnostic_probe(
                engine,
                label=f"pg_get_functiondef {name}/{argcount} oid={row['oid']}",
                sql_category="pg_get_functiondef",
                statement="select pg_get_functiondef(:oid) as definition",
                params={"oid": row["oid"]},
                result_mode="row",
            )

    for table_name in ["suppliers", "support_access_grants"]:
        _run_pg_diagnostic_probe(
            engine,
            label=f"policy metadata {table_name}",
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


@pytest.fixture()
def postgres_rls_probe_context(postgres_app):
    with postgres_app.app_context():
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

        return {
            "org_a_id": org_a.id,
            "org_b_id": org_b.id,
            "active_grant_id": active_grant.id,
        }


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


def test_postgres_rls_function_metadata_current_support_grant_id(postgres_app):
    with postgres_app.app_context():
        _dump_function_metadata("flowtally_current_support_grant_id", 0)


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


def test_postgres_rls_function_definition_current_support_grant_id(postgres_app):
    with postgres_app.app_context():
        _dump_function_definition("flowtally_current_support_grant_id", 0)


def test_postgres_rls_function_definition_support_has_access(postgres_app):
    with postgres_app.app_context():
        _dump_function_definition("flowtally_support_has_access", 1)


def test_postgres_rls_function_definition_has_org_access(postgres_app):
    with postgres_app.app_context():
        _dump_function_definition("flowtally_has_org_access", 1)


def test_postgres_rls_policy_metadata_suppliers(postgres_app):
    with postgres_app.app_context():
        _dump_policy_metadata("suppliers")


def test_postgres_rls_policy_metadata_support_access_grants(postgres_app):
    with postgres_app.app_context():
        _dump_policy_metadata("support_access_grants")


def test_rls_hides_other_tenant_rows(postgres_app):
    with postgres_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        print("BEFORE: test_rls_hides_other_tenant_rows show statement_timeout", flush=True)
        assert db.session.execute(text("show statement_timeout")).scalar_one() in {"5s", "5000ms"}
        print("AFTER: test_rls_hides_other_tenant_rows show statement_timeout", flush=True)
        print("BEFORE: test_rls_hides_other_tenant_rows create org_a", flush=True)
        org_a = _create_org(owner, "RLS Alpha")
        print("AFTER: test_rls_hides_other_tenant_rows create org_a", flush=True)
        print("BEFORE: test_rls_hides_other_tenant_rows create org_b", flush=True)
        org_b = _create_org(owner, "RLS Beta")
        print("AFTER: test_rls_hides_other_tenant_rows create org_b", flush=True)
        print("BEFORE: test_rls_hides_other_tenant_rows insert alpha supplier", flush=True)
        db.session.add(Supplier(organization_id=org_a.id, name="Alpha Supplier", normalized_name="alpha supplier"))
        print("AFTER: test_rls_hides_other_tenant_rows insert alpha supplier", flush=True)
        print("BEFORE: test_rls_hides_other_tenant_rows insert beta supplier", flush=True)
        db.session.add(Supplier(organization_id=org_b.id, name="Beta Supplier", normalized_name="beta supplier"))
        print("AFTER: test_rls_hides_other_tenant_rows insert beta supplier", flush=True)
        print("BEFORE: test_rls_hides_other_tenant_rows commit seed rows", flush=True)
        db.session.commit()
        print("AFTER: test_rls_hides_other_tenant_rows commit seed rows", flush=True)

        print("BEFORE: test_rls_hides_other_tenant_rows set customer context", flush=True)
        _set_rls_context(access_scope="customer", organization_id=org_a.id)
        print("AFTER: test_rls_hides_other_tenant_rows set customer context", flush=True)
        print("BEFORE: test_rls_hides_other_tenant_rows supplier count org_a", flush=True)
        assert Supplier.query.filter_by(organization_id=org_a.id).count() == 1
        print("AFTER: test_rls_hides_other_tenant_rows supplier count org_a", flush=True)
        print("BEFORE: test_rls_hides_other_tenant_rows supplier count org_b", flush=True)
        assert Supplier.query.filter_by(organization_id=org_b.id).count() == 0
        print("AFTER: test_rls_hides_other_tenant_rows supplier count org_b", flush=True)

        print("BEFORE: test_rls_hides_other_tenant_rows direct count org_b", flush=True)
        rows = db.session.execute(text("select count(*) from suppliers where organization_id = :org_id"), {"org_id": org_b.id}).scalar_one()
        print("AFTER: test_rls_hides_other_tenant_rows direct count org_b", flush=True)
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


def test_postgres_rls_authorization_chain_diagnostics(postgres_app):
    with postgres_app.app_context():
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

        _dump_pg_definitions()

        _set_rls_context(access_scope="customer", organization_id=org_a.id)
        _log_probe("1 flowtally_access_scope()", "select flowtally_access_scope()")
        _log_probe("2 flowtally_current_organization_id()", "select flowtally_current_organization_id()")
        _log_probe("3 flowtally_current_support_grant_id()", "select flowtally_current_support_grant_id()")
        _log_probe("4 support_access_grants count", "select count(*) from support_access_grants")

        _set_rls_context(access_scope="customer", organization_id=org_a.id, support_grant_id=active_grant.id)
        _log_probe("5 flowtally_support_has_access(org_a)", "select flowtally_support_has_access(:org_id)", {"org_id": org_a.id})
        _log_probe("6 flowtally_has_org_access(org_a)", "select flowtally_has_org_access(:org_id)", {"org_id": org_a.id})
        _set_rls_context(access_scope="customer", organization_id=org_a.id)
        _log_probe(
            "7 suppliers count for org_a",
            "select count(*) from suppliers where organization_id = :org_id",
            {"org_id": org_a.id},
        )


def test_postgres_rls_probe_definitions(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _dump_pg_definitions()


def test_postgres_rls_probe_1_access_scope(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=postgres_rls_probe_context["org_a_id"])
        assert _log_probe("1 flowtally_access_scope()", "select flowtally_access_scope()") == "customer"


def test_postgres_rls_probe_2_current_organization_id(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=postgres_rls_probe_context["org_a_id"])
        assert _log_probe("2 flowtally_current_organization_id()", "select flowtally_current_organization_id()") == postgres_rls_probe_context["org_a_id"]


def test_postgres_rls_probe_3_current_support_grant_id(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=postgres_rls_probe_context["org_a_id"])
        assert _log_probe("3 flowtally_current_support_grant_id()", "select flowtally_current_support_grant_id()") is None


def test_postgres_rls_probe_4_support_access_grants_count(postgres_app, postgres_rls_probe_context):
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=postgres_rls_probe_context["org_a_id"])
        assert _log_probe("4 support_access_grants count", "select count(*) from support_access_grants") >= 0


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
