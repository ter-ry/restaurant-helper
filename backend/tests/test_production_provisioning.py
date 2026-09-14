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
    assert any("ALTER DEFAULT PRIVILEGES" in statement for statement in statements)


def test_provisioning_statements_are_safe_to_rerun():
    module = _script_module()
    assert module.provisioning_statements() == module.provisioning_statements()
    assert all("CREATE ROLE" not in statement.upper() for statement in module.provisioning_statements())


def test_provision_requires_admin_url(monkeypatch):
    module = _script_module()
    monkeypatch.delenv("FLOWTALLY_BOOTSTRAP_ADMIN_URL", raising=False)
    with pytest.raises(RuntimeError, match="FLOWTALLY_BOOTSTRAP_ADMIN_URL"):
        module.admin_url_from_environment()

