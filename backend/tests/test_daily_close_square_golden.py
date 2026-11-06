"""Square Daily Close golden output (#222): the shared Daily Close/report/export responses for a Square cafe must
stay byte-for-byte identical when Clover support is added.

The golden file was generated from the Square code on ``main`` *before* the Clover integration. Volatile values
(row ids, wall-clock stamps, random merchant ids) are normalized; every business figure and key is compared
exactly. Regenerate only for an intentional Square behavior change: ``FLOWTALLY_WRITE_GOLDEN=1``.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from backend.extensions import db
from backend.tests.test_daily_close_acceptance import (
    DAY,
    SquareDrawer,
    _close_figures,
    _count,
    _get,
    _open,
    _post,
    _production_cafe,
    _report_sales,
    _seed_report_sales,
)

GOLDEN = Path(__file__).parent / "golden" / "daily_close_square.json"
VOLATILE_KEYS = {"createdAt", "updatedAt", "completedAt", "capturedAt"}
ID_KEYS = {"id", "sessionId", "organizationId", "locationId", "completedByUserId", "createdByUserId", "inventoryItemId"}


def _normalize(value, key=None):
    if isinstance(value, dict):
        return {k: _normalize(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize(v, key) for v in value]
    if key in VOLATILE_KEYS and value:
        return "<timestamp>"
    if key in ID_KEYS and isinstance(value, int) and not isinstance(value, bool):
        return "<id>"
    if isinstance(value, str) and re.fullmatch(r"merchant-[0-9a-f]{6}", value):
        return "<merchant>"
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}(Z|[+-]\d{2}:\d{2})?", value):
        return "<wall-clock>"  # fixtures use whole-second times; microseconds mean "now"
    return value


def test_square_daily_close_reports_and_snapshots_match_the_golden_output(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift(closed=49500)
    _, location_id, connection_id = _production_cafe(app, client, monkeypatch, drawer)
    _seed_report_sales(connection_id, location_id)

    drafted = _open(client, location_id)
    session_id = drafted["session"]["id"]
    counted = _count(client, session_id, 490)
    finalized = _post(client, f"/api/pilot/daily-close/{session_id}/finalize").get_json()
    reread = _get(client, location_id).get_json()
    daily = client.get("/api/pilot/reports", query_string={"view": "daily", "date": DAY}).get_json()
    weekly = client.get("/api/pilot/reports", query_string={"view": "weekly", "startDate": "2026-08-24", "endDate": DAY}).get_json()

    produced = _normalize({"opened": drafted, "counted": counted, "finalized": finalized, "reread": reread, "dailyReport": daily, "weeklyReport": weekly})
    db.session.expire_all()
    if os.environ.get("FLOWTALLY_WRITE_GOLDEN") == "1":
        GOLDEN.write_text(json.dumps(produced, indent=2, sort_keys=True) + "\n")
    expected = json.loads(GOLDEN.read_text())
    assert json.dumps(produced, indent=2, sort_keys=True) == json.dumps(expected, indent=2, sort_keys=True)
    # Sanity: the golden really contains the Square figures the close froze, not an empty shape.
    assert _close_figures(produced["finalized"]["snapshot"]["sales"])["totalCollected"] == 740.0
    assert _report_sales(client, view="daily", date=DAY)["orderCount"] == 45
