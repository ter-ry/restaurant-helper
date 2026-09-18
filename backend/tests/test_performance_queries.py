from __future__ import annotations

from sqlalchemy import event
from backend.app import create_app

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


def test_performance_diagnostics_are_opt_in_and_redacted(tmp_path):
    application = create_app({
        "TESTING": True,
        "SECRET_KEY": "diagnostic-test-secret",
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'diagnostic.db').as_posix()}",
        "SESSION_COOKIE_SECURE": False,
        "FLOWTALLY_ENV": "testing",
        "FLOWTALLY_DEMO_ISOLATED": True,
        "FLOWTALLY_DEMO_READ_ONLY": True,
        "FLOWTALLY_PERFORMANCE_DIAGNOSTICS": True,
    })
    response = application.test_client().get("/api/health")
    assert response.status_code == 200
    assert response.headers["Server-Timing"].startswith("app;dur=")
    assert response.headers["X-Performance-Id"]
    assert "parameters" not in response.headers["Server-Timing"]

    disabled = create_app({
        "TESTING": True,
        "SECRET_KEY": "diagnostic-test-secret",
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'disabled.db').as_posix()}",
        "SESSION_COOKIE_SECURE": False,
        "FLOWTALLY_ENV": "testing",
        "FLOWTALLY_DEMO_ISOLATED": True,
        "FLOWTALLY_DEMO_READ_ONLY": True,
    })
    disabled_response = disabled.test_client().get("/api/health")
    assert "Server-Timing" not in disabled_response.headers
