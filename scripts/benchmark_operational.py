"""Repeatable LOCAL fixture benchmark, never a deployed/customer database.

Example: python scripts/benchmark_operational.py --database /tmp/perf.db --seed
         --output /tmp/before.json --runs 10
Reuse the same fixture and script against the other revision for comparison.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor
from time import perf_counter
from urllib.parse import urlencode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--diagnostics", action="store_true")
    parser.add_argument("--concurrent", action="store_true", help="also run an in-process concurrent fixture probe")
    args = parser.parse_args()
    if args.seed and args.database.exists():
        parser.error("Refusing to seed an existing file")
    if not args.seed and not args.database.is_file():
        parser.error("Create a new fixture with --seed first")
    # Do not inherit credentials or network database settings.
    for key in list(os.environ):
        if key.startswith(("FLOWTALLY_", "SQUARE_", "GOOGLE_", "SESSION_")) or key in {"DATABASE_URL", "SECRET_KEY", "FLASK_ENV"}:
            os.environ.pop(key)
    os.environ["FLOWTALLY_ENV"] = "testing"
    sys.path.insert(0, str(Path(args.repo).resolve()))
    from backend.app import create_app
    from backend.extensions import db
    from sqlalchemy import event

    args.database.parent.mkdir(parents=True, exist_ok=True)
    app = create_app({"TESTING": True, "SECRET_KEY": "local-benchmark-only",
        "SQLALCHEMY_DATABASE_URI": "sqlite:///" + args.database.resolve().as_posix(),
        "SESSION_COOKIE_SECURE": False, "WTF_CSRF_ENABLED": False,
        "FLOWTALLY_DEMO_ISOLATED": True, "FLOWTALLY_DEMO_DATABASE_NAME": args.database.name,
        "FLOWTALLY_PERFORMANCE_DIAGNOSTICS": args.diagnostics})
    if args.seed:
        result = app.test_cli_runner().invoke(args=["seed-demo"])
        if result.exit_code:
            raise RuntimeError(result.output) from result.exception
    app.config["FLOWTALLY_DEMO_READ_ONLY"] = True
    client = app.test_client()
    assert client.post("/api/auth/demo-login").status_code == 200
    bundle = client.get("/api/organizations/current").get_json()
    org, loc = bundle["organization"]["id"], bundle["currentLocation"]["id"]
    # Fixed UTC day boundaries allow comparing unchanged data across revisions.
    end = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    query = urlencode({"organizationId": org, "locationId": loc,
        "startAt": (end-timedelta(days=7)).isoformat(), "endAt": end.isoformat()})
    paths = ["/api/health", "/api/auth/me", "/api/organizations/current", "/api/pilot/attention",
        f"/api/integrations/square/status?organizationId={org}", "/api/pilot/menu-costing",
        f"/api/integrations/square/catalog/mappings?organizationId={org}&locationId={loc}",
        "/api/integrations/square/usage?" + query, "/api/pilot/inventory/count-sessions",
        "/api/pilot/dashboard", "/api/pilot/inventory", "/api/pilot/suppliers"]
    active = ContextVar("benchmark", default=None)

    def before(conn, cursor, statement, parameters, context, executemany):
        stats = active.get()
        if stats is not None:
            context._benchmark_start = perf_counter()
            stats["sqlCount"] += 1

    def after(conn, cursor, statement, parameters, context, executemany):
        stats = active.get()
        if stats is not None:
            stats["sqlMs"] += (perf_counter()-context._benchmark_start)*1000

    with app.app_context():
        event.listen(db.engine, "before_cursor_execute", before)
        event.listen(db.engine, "after_cursor_execute", after)
    rows, snapshots = [], {}
    for path in paths:
        assert client.get(path).status_code == 200  # Warm-up excluded.
        for run in range(args.runs):
            stats = {"sqlCount": 0, "sqlMs": 0.0}
            token = active.set(stats)
            started = perf_counter()
            response = client.get(path)
            elapsed = (perf_counter()-started)*1000
            active.reset(token)
            assert response.status_code == 200, (path, response.status_code)
            rows.append({"path": path, "run": run+1, "totalMs": elapsed, **stats,
                "serverTiming": response.headers.get("Server-Timing")})
            if "/auth/" not in path:
                snapshots[path] = response.get_json()
    summary = []
    for path in paths:
        samples = [r for r in rows if r["path"] == path]
        summary.append({"path": path, "runs": len(samples),
            "medianMs": round(statistics.median(r["totalMs"] for r in samples), 3),
            "maxMs": round(max(r["totalMs"] for r in samples), 3),
            "sqlCounts": sorted(set(r["sqlCount"] for r in samples))})
    concurrent_rows = []
    if args.concurrent:
        concurrent_paths = ["/api/health", "/api/auth/me",
            f"/api/integrations/square/catalog/mappings?organizationId={org}&locationId={loc}"]

        def concurrent_probe(path):
            isolated_client = app.test_client()
            if isolated_client.post("/api/auth/demo-login").status_code != 200:
                raise RuntimeError("demo login failed in concurrent probe")
            started = perf_counter()
            response = isolated_client.get(path)
            return {"path": path, "status": response.status_code,
                "totalMs": (perf_counter() - started) * 1000}

        with ThreadPoolExecutor(max_workers=len(concurrent_paths)) as executor:
            concurrent_rows = list(executor.map(concurrent_probe, concurrent_paths))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"environment": "local SQLite fixture; not live Render",
        "concurrencyNote": "in-process Flask test clients; does not model Gunicorn worker scheduling",
        "summary": summary, "samples": rows, "concurrent": concurrent_rows,
        "snapshots": snapshots}, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
