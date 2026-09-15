from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


def _script_module():
    path = Path(__file__).resolve().parents[2] / "scripts" / "bootstrap_postgres.py"
    spec = importlib.util.spec_from_file_location("production_bootstrap_script", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_provisioning_is_restricted_to_production_roles(monkeypatch):
    module = _script_module()
    monkeypatch.setenv("FLOWTALLY_PRODUCTION_RUNTIME_ROLE", "flowtally_runtime")
    with pytest.raises(RuntimeError, match="restricted"):
        module.configured_role_names()


def test_provisioning_statements_target_flowtally_prod_and_never_passwords():
    module = _script_module()
    statements = module.provisioning_statements()
    joined = "\n".join(statements)

    assert "flowtally_prod" in joined
    assert "flowtally_prod_migrator" in joined
    assert "flowtally_prod_runtime" in joined
    assert "defaultdb" not in joined
    assert "PASSWORD" not in joined.upper()
    assert any("REVOKE ALL PRIVILEGES ON DATABASE" in statement for statement in statements)
    defaults = module.migrator_default_privilege_statements()
    assert len(defaults) == 3
    assert all("FOR ROLE" not in statement for statement in defaults)
    assert all("flowtally_prod_runtime" in statement for statement in defaults)


def test_provisioning_statements_are_safe_to_rerun():
    module = _script_module()
    assert module.provisioning_statements() == module.provisioning_statements()
    assert all("CREATE ROLE" not in statement.upper() for statement in module.provisioning_statements())


def test_provision_requires_admin_url(monkeypatch):
    module = _script_module()
    monkeypatch.delenv("FLOWTALLY_BOOTSTRAP_ADMIN_URL", raising=False)
    with pytest.raises(RuntimeError, match="FLOWTALLY_BOOTSTRAP_ADMIN_URL"):
        module.admin_url_from_environment()


def test_admin_database_target_rejects_defaultdb():
    module = _script_module()
    with pytest.raises(RuntimeError, match="flowtally_prod"):
        module.validate_admin_database_target("postgresql://avnadmin@example/defaultdb")


def test_admin_database_target_accepts_flowtally_prod():
    module = _script_module()
    assert module.validate_admin_database_target("postgresql://avnadmin@example/flowtally_prod") == "flowtally_prod"


def test_migration_database_target_rejects_staging():
    module = _script_module()
    with pytest.raises(RuntimeError, match="flowtally_prod"):
        module.validate_migration_database_target("postgresql+psycopg2://migrator@example/flowtally_staging")


def test_sqlalchemy_postgres_url_is_normalized_for_psycopg2():
    module = _script_module()
    assert module.normalize_postgres_url("postgresql+psycopg2://user@example/flowtally_prod") == "postgresql://user@example/flowtally_prod"


class _FakeCursor:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=()):
        self.connection.statements.append(sql)

    def fetchone(self):
        return (self.connection.claimed_owner,)


class _FakeConnection:
    def __init__(self, claimed_owner="avnadmin"):
        self.claimed_owner = claimed_owner
        self.statements = []

    def cursor(self):
        return _FakeCursor(self)


def test_postgres_owned_public_uses_aiven_claim_path():
    module = _script_module()
    connection = _FakeConnection()

    assert module.ensure_aiven_public_schema_owner(connection, "postgres") == "avnadmin"
    assert connection.statements == [
        "CREATE EXTENSION IF NOT EXISTS aiven_extras CASCADE",
        "SELECT * FROM aiven_extras.claim_public_schema_ownership()",
        "SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'public'",
    ]


def test_avnadmin_owned_public_skips_claim():
    module = _script_module()
    connection = _FakeConnection()

    assert module.ensure_aiven_public_schema_owner(connection, "avnadmin") == "avnadmin"
    assert connection.statements == []


def test_provider_owned_public_schema_skips_unavailable_claim():
    module = _script_module()
    connection = _FakeConnection()

    assert module.ensure_aiven_public_schema_owner(connection, "pg_database_owner") == "pg_database_owner"
    assert connection.statements == []


def test_claim_failure_is_actionable():
    module = _script_module()
    connection = _FakeConnection(claimed_owner="postgres")

    with pytest.raises(RuntimeError, match="aiven_extras.*claim_public_schema_ownership"):
        module.ensure_aiven_public_schema_owner(connection, "postgres")


def test_verifier_uses_explicit_global_rls_exemptions():
    module = _script_module()

    assert module.GLOBAL_RLS_EXEMPT_PUBLIC_TABLES == {
        "alembic_version",
        "users",
        "external_identities",
        "platform_roles",
    }
    sql = module._tenant_table_filter_sql()
    for table_name in module.GLOBAL_RLS_EXEMPT_PUBLIC_TABLES:
        assert table_name in sql
    assert "organization_id" not in sql


def test_verifier_rejects_any_unprotected_non_exempt_table():
    module = _script_module()

    assert module.rls_coverage_is_complete(44, 44, 44) is True
    assert module.rls_coverage_is_complete(45, 44, 44) is False
    assert module.rls_coverage_is_complete(44, 44, 43) is False
