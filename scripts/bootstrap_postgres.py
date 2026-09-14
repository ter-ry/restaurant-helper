"""Production PostgreSQL provisioning and verification.

URLs are accepted only from environment variables and are never printed. The
provisioning phase operates only on the already-created production roles; it
never creates roles or changes passwords.
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


RUNTIME_ROLE = "flowtally_prod_runtime"
MIGRATOR_ROLE = "flowtally_prod_migrator"
EXPECTED_DATABASE = "flowtally_prod"


def configured_role_names() -> tuple[str, str]:
    """Return role names only when they are the production roles we guard."""
    runtime = os.environ.get("FLOWTALLY_PRODUCTION_RUNTIME_ROLE", RUNTIME_ROLE).strip() or RUNTIME_ROLE
    migrator = os.environ.get("FLOWTALLY_PRODUCTION_MIGRATOR_ROLE", MIGRATOR_ROLE).strip() or MIGRATOR_ROLE
    if (runtime, migrator) != (RUNTIME_ROLE, MIGRATOR_ROLE):
        raise RuntimeError("Production provisioning is restricted to the flowtally_prod roles.")
    return runtime, migrator


def connect(url: str):
    return psycopg2.connect(url, connect_timeout=10, application_name="flowtally-production-bootstrap")


def query_one(connection: Any, sql: str, params: tuple[Any, ...] = ()):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchone()


def check(label: str, passed: bool, detail: object) -> tuple[str, bool, str]:
    return label, passed, str(detail)


def admin_url_from_environment() -> str:
    value = os.environ.get("FLOWTALLY_BOOTSTRAP_ADMIN_URL", "").strip()
    if not value:
        raise RuntimeError("FLOWTALLY_BOOTSTRAP_ADMIN_URL is required for provisioning.")
    return value


def execute_statements(connection: Any, statements: list[tuple[str, tuple[Any, ...]]]) -> None:
    with connection.cursor() as cursor:
        for sql, params in statements:
            cursor.execute(sql, params)


def provisioning_statements(runtime_role: str = RUNTIME_ROLE, migrator_role: str = MIGRATOR_ROLE) -> list[str]:
    """Return the idempotent grant/hardening statements without credentials."""
    return [
        f"ALTER ROLE {migrator_role} NOSUPERUSER NOBYPASSRLS NOINHERIT",
        f"ALTER ROLE {runtime_role} NOSUPERUSER NOBYPASSRLS NOINHERIT",
        f"REVOKE ALL PRIVILEGES ON DATABASE \"{EXPECTED_DATABASE}\" FROM PUBLIC",
        f"GRANT CONNECT ON DATABASE \"{EXPECTED_DATABASE}\" TO {migrator_role}, {runtime_role}",
        "REVOKE ALL ON SCHEMA public FROM PUBLIC",
        f"GRANT USAGE, CREATE ON SCHEMA public TO {migrator_role}",
        f"GRANT USAGE ON SCHEMA public TO {runtime_role}",
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {runtime_role}",
        f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {runtime_role}",
        f"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO {runtime_role}",
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {migrator_role} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {runtime_role}",
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {migrator_role} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {runtime_role}",
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {migrator_role} IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO {runtime_role}",
    ]


def provision_database() -> list[tuple[str, bool, str]]:
    """Apply the production role boundary and grants, then verify key facts."""
    runtime_role, migrator_role = configured_role_names()
    admin_url = admin_url_from_environment()
    try:
        with connect(admin_url) as admin:
            db_name, current_user = query_one(admin, "SELECT current_database(), current_user")
            if db_name != EXPECTED_DATABASE:
                return [check("admin database target", False, db_name)]
            if current_user != "avnadmin":
                return [check("bootstrap admin identity", False, "expected avnadmin")]
            roles = query_one(
                admin,
                "SELECT count(*) FROM pg_roles WHERE rolname IN (%s, %s)",
                (migrator_role, runtime_role),
            )[0]
            if roles != 2:
                return [check("production roles exist", False, roles)]
            execute_statements(admin, [(sql, ()) for sql in provisioning_statements(runtime_role, migrator_role)])
            owner = query_one(admin, "SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'public'")[0]
            if owner != migrator_role:
                try:
                    execute_statements(admin, [(f"ALTER SCHEMA public OWNER TO {migrator_role}", ())])
                except Exception as exc:
                    admin.rollback()
                    raise RuntimeError(
                        "Aiven did not permit public-schema ownership transfer; use the provider's "
                        "aiven_extras/claim_public_schema_ownership procedure, then rerun provision."
                    ) from exc
            admin.commit()
            return [
                check("admin database target", True, db_name),
                check("bootstrap admin identity", True, current_user),
                check("production roles exist", True, 2),
                check("production grants applied", True, "idempotent"),
                check("public schema owner", True, migrator_role),
            ]
    except Exception as exc:
        detail = str(exc) if isinstance(exc, RuntimeError) and str(exc).startswith("Aiven did not permit") else type(exc).__name__
        return [check("production provisioning", False, detail)]


def finalize_database() -> list[tuple[str, bool, str]]:
    """Reapply grants after migrations without changing passwords or roles."""
    return provision_database()


def verify_database(targets: ProductionTargets) -> list[tuple[str, bool, str]]:
    results: list[tuple[str, bool, str]] = []
    runtime_role, migrator_role = configured_role_names()
    try:
        with connect(targets.migration_url) as migration:
            db_name, role, version = query_one(migration, "SELECT current_database(), current_user, version()")
            results.append(check("migration database", db_name == targets.expected_name, db_name))
            results.append(check("migration role", role == migrator_role, role))
            results.append(check("PostgreSQL version", bool(version), "available"))
            head = query_one(migration, "SELECT version_num FROM public.alembic_version ORDER BY version_num DESC LIMIT 1")
            results.append(check("Alembic head present", bool(head and head[0]), head[0] if head else "missing"))
            role_row = query_one(migration, "SELECT rolsuper, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = %s", (runtime_role,))
            results.append(check("runtime role exists", bool(role_row), runtime_role if role_row else "missing"))
            if role_row:
                results.append(check("runtime NOSUPERUSER", role_row[0] is False, role_row[0]))
                results.append(check("runtime NOBYPASSRLS", role_row[1] is False, role_row[1]))
                results.append(check("runtime NOINHERIT", role_row[2] is False, role_row[2]))
            owners = query_one(migration, "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND pg_get_userbyid(relowner) = %s", (runtime_role,))[0]
            results.append(check("runtime owns no public tables", owners == 0, owners))
            db_owner = query_one(migration, "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()")[0]
            results.append(check("runtime is not database owner", db_owner != runtime_role, db_owner))
            schema_owner = query_one(migration, "SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'public'")[0]
            results.append(check("runtime is not schema owner", schema_owner != runtime_role, schema_owner))
            create = query_one(migration, "SELECT has_schema_privilege(%s, 'public', 'CREATE'), has_database_privilege(%s, current_database(), 'CREATE')", (runtime_role, runtime_role))
            results.append(check("runtime cannot create schema objects", create == (False, False), create))
            public_acl = query_one(migration, "SELECT has_database_privilege('public', current_database(), 'CONNECT'), has_schema_privilege('public', 'public', 'USAGE'), has_schema_privilege('public', 'public', 'CREATE')")
            results.append(check("public has no database/schema privileges", public_acl == (False, False, False), public_acl))
            membership = query_one(migration, "SELECT count(*) FROM pg_auth_members m JOIN pg_roles member ON member.oid = m.member JOIN pg_roles granted ON granted.oid = m.roleid WHERE member.rolname = %s AND (granted.rolsuper OR granted.rolbypassrls)", (runtime_role,))[0]
            results.append(check("runtime has no bypass role membership", membership == 0, membership))
            migrator_create = query_one(migration, "SELECT has_schema_privilege(%s, 'public', 'CREATE')", (migrator_role,))[0]
            results.append(check("migrator can manage public schema", migrator_create is True, migrator_create))
            defaults = query_one(migration, "SELECT count(*) FROM pg_default_acl da JOIN pg_roles r ON r.oid = da.defaclrole WHERE r.rolname = %s AND da.defaclnamespace = 'public'::regnamespace AND da.defaclobjtype IN ('r', 'S', 'f') AND array_to_string(da.defaclacl, ',') LIKE %s", (migrator_role, f"%{runtime_role}%"))[0]
            results.append(check("runtime default privileges configured", defaults == 3, defaults))
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
            results.append(check("runtime identity", role == runtime_role, role))
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
    parser = argparse.ArgumentParser(description="Provision or verify production PostgreSQL without changing passwords or creating roles.")
    parser.add_argument("--phase", choices=("preflight", "provision", "pre-migrate", "finalize", "verify"), default="verify")
    args = parser.parse_args(argv)
    if args.phase == "preflight":
        return print_results(validate_preflight_environment())
    if args.phase == "provision":
        return print_results(provision_database())
    if args.phase == "finalize":
        return print_results(finalize_database())
    try:
        targets = production_targets_from_environment()
    except Exception as exc:
        return print_results([check("production targets", False, str(exc))])
    if args.phase == "pre-migrate":
        return print_results([check("production database target", True, targets.expected_name), check("runtime/migration database match", targets.runtime_name == targets.migration_name, targets.runtime_name)])
    return print_results(verify_database(targets))


if __name__ == "__main__":
    raise SystemExit(main())
