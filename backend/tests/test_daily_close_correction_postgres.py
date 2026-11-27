"""Daily Close completed-close corrections on PostgreSQL under forced RLS (#315 Milestone D).

Real endpoint, restricted runtime role: audit chaining, concurrent duplicate submit (row lock), cross-tenant
refusal and rollback on a failing write. The original frozen close is asserted unchanged throughout.
"""
from __future__ import annotations

import threading
from datetime import date, datetime, timezone

import pytest

from backend.extensions import db
from backend.models import AuditEvent, DailyCloseSession, OrganizationModule, RestaurantLocation
from backend.tests.test_inventory_concurrency_postgres import (  # noqa: F401  (postgres_app is a fixture)
    BASE,
    WAIT_SECONDS,
    Gate,
    POSTGRES_URL,
    _make_world,
    _post,
    postgres_app,
    race,
)
from backend.tests.test_postgres_rls import _seed_admin_fixture, _set_rls_context

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")

class AuditGate(Gate):
    """Pauses the first writer right before it flushes its correction audit row (after taking the session lock)."""

    def __call__(self, session, flush_context, instances) -> None:
        if self.fired or threading.current_thread() is not self.thread:
            return
        if not any(isinstance(obj, AuditEvent) and obj.event_type == "daily_close.correction" for obj in session.new):
            return
        self.fired = True
        self.reached.set()
        assert self.release.wait(WAIT_SECONDS), "test harness: gate was never released"


ORIGINAL = {"sales": {"netSales": 1130.0}, "manualReconciliation": {"countedCash": 495.0}, "attentionItems": [], "healthStatus": "Ready"}


def _completed_close(world) -> int:
    def seed():
        db.session.add(OrganizationModule(organization_id=world.org_id, module_key="DAILY_CLOSE", status="ENABLED", enabled_at=datetime.now(timezone.utc)))
        location = RestaurantLocation.query.filter_by(organization_id=world.org_id).first()
        record = DailyCloseSession(
            organization_id=world.org_id, location_id=location.id, business_date=date(2026, 8, 30), status="COMPLETED",
            notes="Original note", summary_snapshot_json=dict(ORIGINAL), usage_snapshot_json={}, exceptions_snapshot_json=[],
            completed_at=datetime(2026, 8, 31, 5, 0, tzinfo=timezone.utc),
        )
        db.session.add(record)
        db.session.flush()
        return record.id

    return _seed_admin_fixture("daily close correction session", seed)


def _state(world, session_id):
    with world.app.app_context():
        _set_rls_context(access_scope="customer", organization_id=world.org_id)
        record = db.session.get(DailyCloseSession, session_id)
        events = AuditEvent.query.filter_by(event_type="daily_close.correction", entity_id=str(session_id)).order_by(AuditEvent.id).all()
        out = (record.summary_snapshot_json, record.notes, record.status, [e.metadata_json["after"] for e in events])
        db.session.rollback()
        db.session.remove()
    return out


def _correct(client, session_id, **body):
    body.setdefault("reason", "Manager recount of the drawer")
    return _post(client, f"/api/pilot/daily-close/{session_id}/corrections", body)


def test_correction_chains_and_leaves_the_frozen_close_untouched(postgres_app):
    world = _make_world(postgres_app)
    session_id = _completed_close(world)
    client = world.client()
    assert _correct(client, session_id, countedCash=480).status_code == 200
    assert _correct(client, session_id, countedCash=480).status_code == 409  # retry of the same values
    second = _correct(client, session_id, countedCash=500, notes="Recounted")
    assert second.status_code == 200
    body = second.get_json()
    assert [c["before"]["countedCash"] for c in body["corrections"]] == [495.0, 480.0]
    assert body["effectiveSnapshot"]["manualReconciliation"]["countedCash"] == 500.0
    snapshot, notes, status, afters = _state(world, session_id)
    assert snapshot == ORIGINAL and notes == "Original note" and status == "COMPLETED"
    assert [a["countedCash"] for a in afters] == [480.0, 500.0]


def test_concurrent_duplicate_correction_writes_one_audit_row(postgres_app, monkeypatch):
    monkeypatch.setattr("backend.tests.test_inventory_concurrency_postgres.Gate", AuditGate)
    world = _make_world(postgres_app)
    session_id = _completed_close(world)
    client_a, client_b = world.client(), world.client()
    run_a, run_b = race(lambda: _correct(client_a, session_id, countedCash=480), lambda: _correct(client_b, session_id, countedCash=480))
    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert (run_a.result.status_code, run_b.result.status_code) == (200, 409)
    assert len(_state(world, session_id)[3]) == 1


def test_other_tenant_cannot_correct_and_a_failed_write_rolls_back(postgres_app, monkeypatch):
    world = _make_world(postgres_app)
    other = _make_world(postgres_app)
    session_id = _completed_close(world)
    _completed_close(other)
    assert _correct(other.client(), session_id, countedCash=1).status_code == 404
    assert _state(world, session_id)[3] == []

    def boom(*args, **kwargs):
        raise RuntimeError("simulated write failure")

    monkeypatch.setattr("backend.daily_close.record_audit_event", boom)
    client = world.client()
    client.application.config["PROPAGATE_EXCEPTIONS"] = False
    assert _correct(client, session_id, countedCash=1).status_code == 500
    monkeypatch.undo()
    snapshot, notes, _, afters = _state(world, session_id)
    assert afters == [] and snapshot == ORIGINAL and notes == "Original note"
    assert _correct(client, session_id, countedCash=1).status_code == 200  # lock released, retry succeeds
