"""Fixed per-request database round-trip budget on PostgreSQL (#315 performance).

Every request used to spend ~14 statements before the handler ran (duplicate user, module and
org/location lookups, one round trip per tenant setting). Each statement is a network round trip
to the hosted database, so this overhead dominates ordinary save/update/delete latency. These
budgets guard against it creeping back. They do not weaken tenant context: the same four
settings are installed, in fewer statements.
"""
from __future__ import annotations

import re

import pytest
from sqlalchemy import event

from backend.extensions import db
from backend.tests.test_inventory_concurrency_postgres import BASE, POSTGRES_URL, _make_world, postgres_app  # noqa: F401

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")


def _statements(app, client, method: str, path: str, **kwargs) -> tuple[list[str], int]:
    captured: list[str] = []

    def record(_conn, _cursor, statement, *_rest):
        captured.append(re.sub(r"\s+", " ", statement))

    if method != "get":
        kwargs["headers"] = {"X-CSRFToken": client.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]}
    with app.app_context():
        engine = db.engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        response = getattr(client, method)(path, base_url=BASE, **kwargs)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return captured, response.status_code


def test_request_fixed_overhead_stays_within_budget(postgres_app):
    world = _make_world(postgres_app, item_names=("Flour",))
    client = world.client()
    item_id = world.items["Flour"]

    statements, status = _statements(postgres_app, client, "patch", f"/api/pilot/inventory/items/{item_id}", json={"notes": "budget"})
    assert status == 200
    # 13 today: 1 user, platform role, membership, org+location (x2 around RLS context), 2 settings,
    # modules, item, audit insert, update. Was 17 before batching settings/modules/user lookups.
    assert len(statements) <= 13, statements
    assert sum("set_config" in s for s in statements) <= 2
    assert sum("FROM users" in s for s in statements) == 1, "user must be loaded once per request"
    assert sum("FROM organization_modules" in s for s in statements) <= 1, "modules must be read once per request"

    statements, status = _statements(postgres_app, client, "get", "/api/pilot/attention")
    assert status == 200
    assert len(statements) <= 11, statements
