"""Opt-in, removable diagnostics for isolated demos and local/test instances.

Never records SQL text/parameters, URLs, request headers, identities, or payloads.
No global query cache, extra database connection, or change to pool capacity.
"""
from __future__ import annotations

from functools import wraps
import hashlib
import json
import os
from time import perf_counter, thread_time, time
from uuid import uuid4

from flask import has_request_context, request
from sqlalchemy import event
from sqlalchemy.pool import QueuePool, StaticPool

from .extensions import db

_KEY = "flowtally.performance"
_MAX_GROUPS = 64


def _metrics():
    return request.environ.get(_KEY) if has_request_context() else None


class _TimedAcquisition:
    def connect(self):
        metrics = _metrics()
        if metrics is None:
            return super().connect()
        start = perf_counter()
        try:
            return super().connect()
        finally:
            metrics["db_acquire_ms"] += (perf_counter() - start) * 1000
            metrics["db_acquire_count"] += 1


class DiagnosticQueuePool(_TimedAcquisition, QueuePool):
    """Time public Pool.connect: queue wait, physical connect, pre-ping, checkout."""


class DiagnosticStaticPool(_TimedAcquisition, StaticPool):
    """Equivalent instrumentation for local in-memory test fixtures."""


def configure_performance(app):
    enabled = bool(app.config.get("FLOWTALLY_PERFORMANCE_DIAGNOSTICS")) and (
        app.config.get("FLOWTALLY_ENV") in {"testing", "development"}
        or (app.config.get("FLOWTALLY_DEMO_ISOLATED") and app.config.get("FLOWTALLY_DEMO_READ_ONLY"))
    )
    app.extensions["performance_diagnostics"] = enabled
    if not enabled:
        return
    options = dict(app.config.get("SQLALCHEMY_ENGINE_OPTIONS") or {})
    # Preserve custom pool implementations. Their acquisition time is unavailable.
    if "poolclass" not in options:
        uri = str(app.config["SQLALCHEMY_DATABASE_URI"])
        options["poolclass"] = DiagnosticStaticPool if uri.startswith("sqlite:") and (":memory:" in uri or uri in {"sqlite://", "sqlite:///"}) else DiagnosticQueuePool
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = options
    original_wsgi = app.wsgi_app

    def measured_wsgi(environ, start_response):
        metrics = {"trace_id": uuid4().hex, "started": perf_counter(), "cpu_started": thread_time(),
            "handler_ms": 0.0, "sql_ms": 0.0, "sql_count": 0, "db_acquire_ms": 0.0,
            "db_acquire_count": 0, "db_connections_created": 0, "groups": {},
            "upstream_wait_ms": None}
        # Only a trusted server/WSGI adapter can supply this key. Never accept an
        # HTTP X-Request-Start header: client-controlled clocks are not queue data.
        upstream = environ.get("flowtally.request_received_at")
        if isinstance(upstream, (float, int)) and 0 <= time() - upstream <= 300:
            metrics["upstream_wait_ms"] = (time() - upstream) * 1000
        environ[_KEY] = metrics
        return original_wsgi(environ, start_response)

    app.wsgi_app = measured_wsgi


def _group_id(context):
    compiled = getattr(context, "compiled", None)
    key = getattr(compiled, "cache_key", None)
    if key is None:
        return "uncompiled"
    # Cache-key structure excludes bind values. A stable digest lets operators
    # correlate the same query shape across requests and processes without
    # logging SQL text or parameter values.
    return "q_" + hashlib.sha256(repr(key.key).encode()).hexdigest()[:16]


def install_performance(app):
    if not app.extensions.get("performance_diagnostics"):
        return

    def before_cursor(conn, cursor, statement, parameters, context, executemany):
        metrics = _metrics()
        if metrics is not None:
            context._flowtally_perf = (perf_counter(), _group_id(context))
            metrics["sql_count"] += 1

    def finish_cursor(context):
        metrics = _metrics()
        started = getattr(context, "_flowtally_perf", None)
        if metrics is None or started is None:
            return
        del context._flowtally_perf
        duration = (perf_counter() - started[0]) * 1000
        metrics["sql_ms"] += duration
        group_id = started[1]
        groups = metrics["groups"]
        if group_id not in groups and len(groups) >= _MAX_GROUPS:
            group_id = "other"
        group = groups.setdefault(group_id, {"count": 0, "total_ms": 0.0, "max_ms": 0.0})
        group["count"] += 1
        group["total_ms"] += duration
        group["max_ms"] = max(group["max_ms"], duration)

    def after_cursor(conn, cursor, statement, parameters, context, executemany):
        finish_cursor(context)

    def query_error(exception_context):
        finish_cursor(exception_context.execution_context)

    def connected(connection, record):
        metrics = _metrics()
        if metrics is not None:
            metrics["db_connections_created"] += 1

    with app.app_context():
        engine = db.engine
        event.listen(engine, "before_cursor_execute", before_cursor)
        event.listen(engine, "after_cursor_execute", after_cursor)
        event.listen(engine, "handle_error", query_error)
        event.listen(engine, "connect", connected)

    def measure_view(view):
        @wraps(view)
        def measured(*args, **kwargs):
            metrics = _metrics()
            if metrics is None:
                return view(*args, **kwargs)
            start = perf_counter()
            try:
                return view(*args, **kwargs)
            finally:
                metrics["handler_ms"] += (perf_counter() - start) * 1000
        return measured

    for endpoint, view in app.view_functions.items():
        app.view_functions[endpoint] = measure_view(view)

    @app.after_request
    def report(response):
        metrics = _metrics()
        if metrics is None:
            return response
        app_ms = (perf_counter() - metrics["started"]) * 1000
        record = {"event": "request_performance", "trace_id": metrics["trace_id"],
            "endpoint": request.endpoint or "unmatched", "status": response.status_code,
            "app_ms": round(app_ms, 3), "handler_ms": round(metrics["handler_ms"], 3),
            "thread_cpu_ms": round((thread_time() - metrics["cpu_started"]) * 1000, 3),
            "sql_ms": round(metrics["sql_ms"], 3), "sql_count": metrics["sql_count"],
            "db_acquire_ms": round(metrics["db_acquire_ms"], 3) if isinstance(engine.pool, _TimedAcquisition) else None,
            "db_acquire_count": metrics["db_acquire_count"],
            "db_connections_created": metrics["db_connections_created"],
            "upstream_wait_ms": metrics["upstream_wait_ms"],
            "slow_query_groups": [{"id": key, **{k: round(v, 3) for k, v in value.items()}}
                for key, value in sorted(metrics["groups"].items(), key=lambda entry: entry[1]["total_ms"], reverse=True)[:5]]}
        app.logger.info("%s", json.dumps(record, separators=(",", ":")))
        timing = [f'app;dur={app_ms:.3f}', f'handler;dur={metrics["handler_ms"]:.3f}',
            f'sql;dur={metrics["sql_ms"]:.3f}', f'sql_count;desc="{metrics["sql_count"]}"']
        if record["db_acquire_ms"] is not None:
            timing.append(f'db_acquire;dur={metrics["db_acquire_ms"]:.3f}')
        if metrics["upstream_wait_ms"] is not None:
            timing.append(f'upstream_wait;dur={metrics["upstream_wait_ms"]:.3f}')
        response.headers["Server-Timing"] = ", ".join(timing)
        response.headers["X-Performance-Id"] = metrics["trace_id"]
        # Expose only to the already-configured frontend; never wildcard timing.
        origin = request.headers.get("Origin", "")
        if origin and origin in set(app.config.get("ALLOWED_ORIGINS", [])):
            response.headers["Timing-Allow-Origin"] = origin
            response.headers.add("Access-Control-Expose-Headers", "Server-Timing, X-Performance-Id")
        return response
