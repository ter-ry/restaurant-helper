from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from backend.extensions import db
from backend.models import RestaurantLocation, SquareConnection, SquareLocation, SquareLocationMapping, User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization


def _login(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 200


def test_connected_square_without_physical_counts_is_ready(app, client, monkeypatch):
    _login(client)
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert owner is not None
        organization = make_operational_organization(
            owner,
            name=f"Daily Close Ready {uuid4().hex[:8]}",
            location_name="Toronto Kitchen",
            enabled_modules=(
                "PURCHASES",
                "INVENTORY",
                "MENU_COSTING",
                "STOCK_COUNTS",
                "REORDER_PLANS",
                "SQUARE_INTEGRATION",
                "DAILY_CLOSE",
            ),
        )
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
        assert location is not None
        connection = SquareConnection(
            organization_id=organization.id,
            environment="sandbox",
            square_merchant_id="merchant-ready",
            status="connected",
            sync_status="idle",
            last_sync_at=datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc),
        )
        db.session.add(connection)
        db.session.flush()
        square_location = SquareLocation(
            square_connection_id=connection.id,
            square_location_id="LOC-READY",
            name="Toronto Kitchen",
            status="ACTIVE",
            raw_payload_json={},
        )
        db.session.add(square_location)
        db.session.flush()
        db.session.add(
            SquareLocationMapping(
                square_location_id=square_location.id,
                restaurant_location_id=location.id,
                mapped_by_user_id=owner.id,
            )
        )
        db.session.commit()
        location_id = location.id
        organization_id = organization.id

    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    selected = client.post(
        "/api/organizations/select",
        headers={"X-CSRFToken": csrf},
        json={"organizationId": organization_id},
    )
    assert selected.status_code == 200

    monkeypatch.setattr(
        "backend.daily_close._daily_close_usage",
        lambda *args, **kwargs: {
            "period": {"startAt": "2026-08-30T04:00:00Z", "endAt": "2026-08-31T03:59:59Z"},
            "coverage": {
                "totalSoldUnits": 1,
                "mappedSoldUnits": 1,
                "calculableSoldUnits": 1,
                "unmappedVariationCount": 0,
            },
            "ingredientUsage": [],
            "contributingMenuItems": [{"warnings": []}],
            "unmappedVariations": [],
            "totals": {
                "theoreticalUsage": 2,
                "actualUsage": None,
                "discrepancy": None,
                "discrepancyPercent": None,
            },
        },
    )

    response = client.get(
        "/api/pilot/daily-close",
        query_string={"locationId": location_id, "businessDate": "2026-08-30"},
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["exceptions"] == []
    assert body["snapshot"]["healthStatus"] == "Ready"
from backend.daily_close import _merge_manual_reconciliation


def test_manual_cash_reconciliation_is_namespaced_and_recomputed():
    class Session:
        summary_snapshot_json = {"manualReconciliation": {"countedCash": 97.5}}

    snapshot = {"cashReconciliation": {"status": "available", "expectedCash": 100.0}, "manualReconciliation": {}}
    merged = _merge_manual_reconciliation(snapshot, Session())
    assert merged["manualReconciliation"] == {"countedCash": 97.5}
    assert merged["cashReconciliation"]["overShort"] == -2.5

    updated = _merge_manual_reconciliation(snapshot, Session(), {"reconciliation": {"countedCash": 100}})
    assert updated["cashReconciliation"]["overShort"] == 0


def test_cash_reconciliation_uses_exact_business_day_payments_and_paginates(monkeypatch):
    from types import SimpleNamespace
    from datetime import date
    from backend import daily_close

    connection = SimpleNamespace(status="connected", environment="production")
    location = SimpleNamespace(timezone="America/Toronto", id=1)
    calls = []

    monkeypatch.setattr(daily_close, "_square_location_ids_for_location", lambda *_args: ["SQ-1"])
    monkeypatch.setattr(daily_close, "_connection_token", lambda *_args: "token")

    def request(method, path, **_kwargs):
        calls.append(path)
        if "cash-drawers/shifts?" in path:
            return {"cash_drawer_shifts": []}
        if "cursor=next" in path:
            return {"payments": [{"status": "COMPLETED", "source_type": "CASH", "total_money": {"amount": 2500, "currency": "CAD"}}]}
        return {"payments": [], "cursor": "next"}

    monkeypatch.setattr(daily_close, "_square_request", request)
    result = daily_close._cash_reconciliation(connection, location, date(2026, 10, 4))
    assert result["cashPayments"] == 25
    payment_calls = [call for call in calls if "/v2/payments?" in call]
    assert len(payment_calls) == 2
    assert "begin_time=2026-10-04T04%3A00%3A00Z" in payment_calls[0]
    assert "end_time=2026-10-05T03%3A59%3A59.999999Z" in payment_calls[0]
    assert "2026-10-03" not in payment_calls[0] and "2026-10-06" not in payment_calls[0]


def test_cash_reconciliation_mixes_shift_expected_cash_and_matches_events(monkeypatch):
    from types import SimpleNamespace
    from datetime import date
    from backend import daily_close

    connection = SimpleNamespace(status="connected", environment="production")
    location = SimpleNamespace(timezone="America/Toronto", id=1)
    event_pages = iter([
        {"events": [{"event_type": "PAID_OUT", "event_money": {"amount": 500, "currency": "CAD"}}], "cursor": "events-2"},
        {"events": [{"event_type": "CASH_TENDER_PAYMENT", "event_money": {"amount": 2500, "currency": "CAD"}}]},
    ])
    monkeypatch.setattr(daily_close, "_square_location_ids_for_location", lambda *_args: ["SQ-1"])
    monkeypatch.setattr(daily_close, "_connection_token", lambda *_args: "token")

    def request(_method, path, **_kwargs):
        if "/events?" in path:
            return next(event_pages)
        return {"cash_drawer_shifts": [
            {"id": "shift-1", "state": "CLOSED", "opened_at": "2026-10-04T12:00:00Z", "closed_at": "2026-10-04T22:00:00Z", "opened_cash_money": {"amount": 10000, "currency": "CAD"}, "cash_payment_money": {"amount": 2000, "currency": "CAD"}, "cash_refunds_money": {"amount": 100, "currency": "CAD"}, "cash_paid_in_money": {"amount": 300, "currency": "CAD"}, "cash_paid_out_money": {"amount": 50, "currency": "CAD"}, "expected_cash_money": {"amount": 12150, "currency": "CAD"}, "closed_cash_money": {"amount": 12100, "currency": "CAD"}},
            {"id": "shift-2", "state": "OPEN", "opened_at": "2026-10-04T23:00:00Z", "opened_cash_money": {"amount": 5000, "currency": "CAD"}, "cash_payment_money": {"amount": 1000, "currency": "CAD"}, "cash_refunds_money": {"amount": 0, "currency": "CAD"}, "cash_paid_in_money": {"amount": 0, "currency": "CAD"}, "cash_paid_out_money": {"amount": 0, "currency": "CAD"}},
        ]}

    monkeypatch.setattr(daily_close, "_square_request", request)
    result = daily_close._cash_reconciliation(connection, location, date(2026, 10, 4))
    assert result["basis"] == "mixed"
    assert result["expectedCash"] == 181.5
    assert result["closedCash"] == 121
    assert result["overShort"] == -60.5
    assert [match["type"] for match in result["possibleMatches"]] == ["CASH_TENDER_PAYMENT", "PAID_OUT"]
