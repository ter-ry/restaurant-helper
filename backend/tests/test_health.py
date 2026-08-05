from __future__ import annotations


def test_health_endpoint_returns_ok(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "ok"
    assert body["service"] == "flowtally-pilot-backend"
    assert body["environment"] == "testing"
