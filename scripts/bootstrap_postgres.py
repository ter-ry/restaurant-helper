"""Read-only production PostgreSQL bootstrap and verification.

The command never accepts a URL argument and never prints a URL, password, host,
or credential. Existing Aiven roles are inspected; role creation and grants stay
an explicit provider/operator step when the provider does not permit them.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

import psycopg2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.production_bootstrap import ProductionTargets, production_targets_from_environment, validate_preflight_environment


RUNTIME_ROLE = os.environ.get("FLOWTALLY_PRODUCTION_RUNTIME_ROLE", "flowtally_prod_runtime").strip() or "flowtally_prod_runtime"
MIGRATOR_ROLE = os.environ.get("FLOWTALLY_PRODUCTION_MIGRATOR_ROLE", "flowtally_prod_migrator").strip() or "flowtally_prod_migrator"


def connect(url: str):
    return psycopg2.connect(url, connect_timeout=10, application_name="flowtally-production-bootstrap")


def query_one(connection: Any, sql: str, params: tuple[Any, ...] = ()):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchone()


def check(label: str, passed: bool, detail: object) -> tuple[str, bool, str]:
    return label, passed, str(detail)


def verify_database(targets: ProductionTargets) -> list[tuple[str, bool, str]]:
    results: list[tuple[str, bool, str]] = []
    try:
        with connect(targets.migration_url) as migration:
            db_name, role, version = query_one(migration, "SELECT current_database(), current_user, version()")
            results.append(check("migration database", db_name == targets.expected_name, db_name))
            results.append(check("migration role", role == MIGRATOR_ROLE, role))
            results.append(check("PostgreSQL version", bool(version), "available"))
            head = query_one(migration, "SELECT version_num FROM public.alembic_version ORDER BY version_num DESC LIMIT 1")
            results.append(check("Alembic head present", bool(head and head[0]), head[0] if head else "missing"))
            role_row = query_one(migration, "SELECT rolsuper, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = %s", (RUNTIME_ROLE,))
            results.append(check("runtime role exists", bool(role_row), RUNTIME_ROLE if role_row else "missing"))
            if role_row:
                results.append(check("runtime NOSUPERUSER", role_row[0] is False, role_row[0]))
                results.append(check("runtime NOBYPASSRLS", role_row[1] is False, role_row[1]))
                results.append(check("runtime NOINHERIT", role_row[2] is False, role_row[2]))
            owners = query_one(migration, "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND pg_get_userbyid(relowner) = %s", (RUNTIME_ROLE,))[0]
            results.append(check("runtime owns no public tables", owners == 0, owners))
            db_owner = query_one(migration, "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()")[0]
            results.append(check("runtime is not database owner", db_owner != RUNTIME_ROLE, db_owner))
            schema_owner = query_one(migration, "SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'public'")[0]
            results.append(check("runtime is not schema owner", schema_owner != RUNTIME_ROLE, schema_owner))
            protected = query_one(migration, "SELECT count(*), count(*) FILTER (WHERE c.relrowsecurity), count(*) FILTER (WHERE c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('alembic_version')")[0:]
            results.append(check("protected tables use RLS", protected[1] == protected[0], f"{protected[1]}/{protected[0]}"))
            results.append(check("protected tables use FORCE RLS", protected[2] == protected[0], f"{protected[2]}/{protected[0]}"))
            policy_count = query_one(migration, "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'")[0]
            results.append(check("tenant policies exist", policy_count > 0, policy_count))
    except Exception as exc:
        results.append(check("migration connection", False, type(exc).__name__))
        return results
    try:
        with connect(targets.runtime_url) as runtime:
            db_name, role = query_one(runtime, "SELECT current_database(), current_user")
            results.append(check("runtime database matches", db_name == targets.expected_name, db_name))
            results.append(check("runtime identity", role == RUNTIME_ROLE, role))
            query_one(runtime, "SELECT 1")
            results.append(check("runtime connection available", True, "SELECT 1"))
    except Exception as exc:
        results.append(check("runtime connection", False, type(exc).__name__))
    return results


def print_results(results: list[tuple[str, bool, str]]) -> int:
    print("Production preflight")
    for label, passed, detail in results:
        print(f"{'PASS' if passed else 'FAIL':4}  {label}: {detail}")
    return 0 if all(passed for _, passed, _ in results) else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify production PostgreSQL bootstrap without changing it.")
    parser.add_argument("--phase", choices=("preflight", "pre-migrate", "finalize", "verify"), default="verify")
    args = parser.parse_args(argv)
    if args.phase == "preflight":
        return print_results(validate_preflight_environment())
    try:
        targets = production_targets_from_environment()
    except Exception as exc:
        return print_results([check("production targets", False, str(exc))])
    if args.phase == "pre-migrate":
        return print_results([check("production database target", True, targets.expected_name), check("runtime/migration database match", targets.runtime_name == targets.migration_name, targets.runtime_name)])
    return print_results(verify_database(targets))


if __name__ == "__main__":
    raise SystemExit(main())
