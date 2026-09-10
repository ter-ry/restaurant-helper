from __future__ import annotations

from sqlalchemy import event

from backend.extensions import db
from backend.tests.test_pilot_api import login


def _count_sql(app, client, path: str) -> int:
    statements = 0

    def count_statement(*_args):
        nonlocal statements
        statements += 1

    event.listen(db.engine, "before_cursor_execute", count_statement)
    try:
        response = client.get(path)
        assert response.status_code == 200
    finally:
        event.remove(db.engine, "before_cursor_execute", count_statement)
    return statements


def test_operational_endpoints_have_bounded_query_counts(app, client):
    login(client)

    assert _count_sql(app, client, "/api/pilot/attention") <= 8
    assert _count_sql(app, client, "/api/pilot/dashboard") <= 20
    assert _count_sql(app, client, "/api/pilot/inventory") <= 24
    assert _count_sql(app, client, "/api/pilot/suppliers") <= 12
    assert _count_sql(app, client, "/api/pilot/purchases") <= 16
