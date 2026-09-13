from __future__ import annotations


def test_demo_mode_blocks_api_writes_but_keeps_reads_and_session_mechanics(app, client, monkeypatch):
    app.config["FLOWTALLY_DEMO_READ_ONLY"] = True

    blocked = client.post("/api/pilot/inventory/items", json={"name": "Should not persist"})
    assert blocked.status_code == 403
    assert blocked.get_json()["error"] == "Demo mode is read-only; changes are disabled."

    assert client.get("/api/health").status_code == 200
    # Logout is an authentication mechanic and must not be intercepted by demo mode.
    assert client.post("/api/auth/logout").status_code != 403
