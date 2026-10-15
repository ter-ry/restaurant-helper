from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from backend.extensions import db
from backend.models import RestaurantLocation, SquareConnection, SquareLocation, SquareLocationMapping, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization


def _login(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": LOCAL_OWNER_EMAIL, "password": "local-owner-password"},
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

    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    selected = client.post(
        "/api/organizations/select",
        headers={"X-CSRFToken": csrf},
        json={"organizationId": organization.id},
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
