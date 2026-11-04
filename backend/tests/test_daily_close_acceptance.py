"""Daily Close acceptance suite (Square baseline, issues #206/#208).

Every expected figure is hand-computed from the fixture data, not derived from production formulas.
The Square outputs asserted here are the baseline the Clover Daily Close work (#167) must keep identical.

Owner-approved cash policy (#206): expected cash comes from verified Square drawer evidence; the cash staff
physically counted is the primary actual cash; variance = counted - expected; Square's closed-drawer count is
kept separately as provider evidence and never overrides the staff count; disagreements are surfaced; when
expected cash cannot be verified the variance is unavailable (never invented or assumed zero); the evidence
persists through finalize and completed closes are read-only.

Fixed cafe day: 2026-08-30, America/Toronto (UTC-4), i.e. 04:00Z -> 03:59:59Z. The Square drawer tests answer the
real Square Cash Drawer/Payments REST paths through the request seam (not a patched expected-cash calculation).
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import (
    DailyCloseSession,
    InventoryItem,
    InventoryMovement,
    InventoryWasteEvent,
    RestaurantLocation,
    SquareConnection,
    SquareDailySalesSummary,
    SquareLocation,
    SquareLocationMapping,
    User,
)
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.square_integration import SquareRequestError
from backend.tests.conftest import make_operational_organization

DAY = "2026-08-30"
IN_DAY = datetime(2026, 8, 30, 16, 0, tzinfo=timezone.utc)  # noon Toronto
OUT_OF_DAY = datetime(2026, 8, 29, 16, 0, tzinfo=timezone.utc)
MODULES = ("PURCHASES", "INVENTORY", "REPORTING", "MENU_COSTING", "STOCK_COUNTS", "REORDER_PLANS", "SQUARE_INTEGRATION", "DAILY_CLOSE")


def _csrf(client) -> str:
    return client.get("/api/auth/csrf").get_json()["csrfToken"]


def _setup(app, client, monkeypatch, *, environment="sandbox", square_location_ids=("LOC-A",)):
    """Log in as the owner and build a cafe org with a connected, mapped Square."""
    token = _csrf(client)
    assert client.post("/api/auth/login", json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD}, headers={"X-CSRFToken": token}).status_code == 200
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name=f"Close Cafe {uuid4().hex[:8]}", location_name="Queen St Cafe", enabled_modules=MODULES)
    location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
    connection = SquareConnection(
        organization_id=organization.id, environment=environment, square_merchant_id=f"merchant-{uuid4().hex[:6]}",
        status="connected", sync_status="idle", last_sync_at=datetime(2026, 8, 30, 23, 0, tzinfo=timezone.utc),
    )
    db.session.add(connection)
    db.session.flush()
    for sq_id in square_location_ids:
        sq = SquareLocation(square_connection_id=connection.id, square_location_id=sq_id, name=sq_id, status="ACTIVE", raw_payload_json={})
        db.session.add(sq)
        db.session.flush()
        db.session.add(SquareLocationMapping(square_location_id=sq.id, restaurant_location_id=location.id, mapped_by_user_id=owner.id))
    db.session.commit()
    selected = client.post("/api/organizations/select", headers={"X-CSRFToken": _csrf(client)}, json={"organizationId": organization.id})
    assert selected.status_code == 200
    # No network: order freshness is a Square API call and is outside what these tests assert.
    monkeypatch.setattr("backend.daily_close.ensure_square_orders_fresh", lambda *a, **k: {"state": "fresh"})
    return organization.id, location.id, connection.id


def _summary(connection_id, location_id, sq_id, sale_date=date(2026, 8, 30), mapped=True, **amounts):
    defaults = dict(gross_amount=0, discount_amount=0, tax_amount=0, tip_amount=0, refund_amount=0, net_amount=0, order_count=0, cancelled_order_count=0)
    defaults.update(amounts)
    db.session.add(SquareDailySalesSummary(
        square_connection_id=connection_id, square_location_id=sq_id, restaurant_location_id=location_id if mapped else None,
        sale_date=sale_date, raw_payload_json={}, **defaults,
    ))


def _post(client, path, body=None):
    return client.post(path, json=body or {}, headers={"X-CSRFToken": _csrf(client)})


def _patch(client, path, body):
    return client.patch(path, json=body, headers={"X-CSRFToken": _csrf(client)})


def _get(client, location_id):
    return client.get("/api/pilot/daily-close", query_string={"locationId": location_id, "businessDate": DAY})


def _open(client, location_id):
    response = _post(client, "/api/pilot/daily-close", {"locationId": location_id, "businessDate": DAY})
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _count(client, session_id, amount):
    response = _patch(client, f"/api/pilot/daily-close/{session_id}", {"reconciliation": {"countedCash": amount}})
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _seed_sales(connection_id, location_id):
    # LOC-A + LOC-B are both mapped to the cafe; LOC-OTHER is not and must be ignored.
    _summary(connection_id, location_id, "LOC-A", gross_amount=800, discount_amount=40, tax_amount=100, tip_amount=60, refund_amount=20, net_amount=740, order_count=30, cancelled_order_count=1)
    _summary(connection_id, location_id, "LOC-B", gross_amount=400, discount_amount=10, tax_amount=50, tip_amount=20, refund_amount=0, net_amount=390, order_count=15)
    _summary(connection_id, location_id, "LOC-OTHER", gross_amount=9999, net_amount=9999, order_count=99)
    _summary(connection_id, location_id, "LOC-A", sale_date=date(2026, 8, 29), gross_amount=5000, net_amount=5000, order_count=77)
    db.session.commit()


# --------------------------------------------------------------------------------------------------
# Realistic Square Cash Drawer / Payments responses, answered at the request seam.
# --------------------------------------------------------------------------------------------------
class SquareDrawer:
    """A tiny fake of the Square REST paths Daily Close reads. Amounts are in cents, like Square."""

    def __init__(self):
        self.shifts: list[dict] = []
        self.payments: list[dict] = []
        self.list_error: SquareRequestError | None = None
        self.detail_error: SquareRequestError | None = None
        self.payments_error: SquareRequestError | None = None

    def shift(self, shift_id="SHIFT-1", *, opened=10000, payments=45000, refunds=2000, paid_in=0, paid_out=3000, closed=None, expected=None):
        record = {
            "id": shift_id, "state": "CLOSED" if closed is not None else "OPEN",
            "opened_at": "2026-08-30T11:00:00Z",
            "opened_cash_money": {"amount": opened, "currency": "CAD"},
            "cash_payment_money": {"amount": payments, "currency": "CAD"},
            "cash_refunds_money": {"amount": refunds, "currency": "CAD"},
            "cash_paid_in_money": {"amount": paid_in, "currency": "CAD"},
            "cash_paid_out_money": {"amount": paid_out, "currency": "CAD"},
        }
        if closed is not None:
            record["ended_at"] = record["closed_at"] = "2026-08-30T22:00:00Z"
            record["closed_cash_money"] = {"amount": closed, "currency": "CAD"}
        if expected is not None:
            record["expected_cash_money"] = {"amount": expected, "currency": "CAD"}
        self.shifts.append(record)
        return record

    def __call__(self, method, path, **kwargs):
        if path.startswith("/v2/payments"):
            if self.payments_error:
                raise self.payments_error
            return {"payments": self.payments}
        if "/events" in path:
            return {"cash_drawer_shift_events": []}
        if path.startswith("/v2/cash-drawers/shifts/"):
            if self.detail_error:
                raise self.detail_error
            shift_id = path.split("/v2/cash-drawers/shifts/")[1].split("?")[0]
            return {"cash_drawer_shift": next(s for s in self.shifts if s["id"] == shift_id)}
        if path.startswith("/v2/cash-drawers/shifts"):
            if self.list_error:
                raise self.list_error
            return {"cash_drawer_shifts": [{k: s[k] for k in ("id", "opened_at") if k in s} | ({"closed_at": s["closed_at"]} if "closed_at" in s else {}) for s in self.shifts]}
        raise AssertionError(f"unexpected Square path {path}")


def _use_drawer(monkeypatch, drawer: SquareDrawer):
    monkeypatch.setattr("backend.daily_close._square_request", drawer)
    monkeypatch.setattr("backend.daily_close._connection_token", lambda connection: "token")


def _production_cafe(app, client, monkeypatch, drawer: SquareDrawer):
    ids = _setup(app, client, monkeypatch, environment="production")
    _use_drawer(monkeypatch, drawer)
    return ids


# --------------------------------------------------------------------------------------------------
# Sales, inventory basis and session flow
# --------------------------------------------------------------------------------------------------
def test_sales_figures_sum_mapped_locations_for_the_business_day_only(app, client, monkeypatch):
    _, location_id, connection_id = _setup(app, client, monkeypatch, square_location_ids=("LOC-A", "LOC-B"))
    _seed_sales(connection_id, location_id)
    body = _get(client, location_id).get_json()
    sales = body["snapshot"]["sales"]
    # Hand sums: 800+400, 40+10, 100+50, 60+20, 20+0, 740+390, 30+15, 1+0
    assert sales["grossSales"] == 1200.0
    assert sales["discounts"] == 50.0
    assert sales["tax"] == 150.0
    assert sales["tips"] == 80.0
    assert sales["refunds"] == 20.0
    assert sales["netSales"] == 1130.0
    assert sales["orders"] == 45
    assert sales["cancelledOrders"] == 1
    assert body["snapshot"]["square"] == sales
    assert "Refunds/cancellations present." in body["exceptions"]
    assert [i["type"] for i in body["snapshot"]["attentionItems"] if i["type"] == "sales_exceptions"] == ["sales_exceptions"]


def test_inventory_variance_basis_excludes_square_consumption(app, client, monkeypatch):
    org_id, location_id, _ = _setup(app, client, monkeypatch)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    item = InventoryItem(organization_id=org_id, location_id=location_id, name="Whole Milk", normalized_name="whole milk", stock_unit="L", current_on_hand=Decimal("10"), average_unit_cost=Decimal("2.00"), created_by_user_id=owner.id)
    db.session.add(item)
    db.session.flush()
    seq: list[int] = []

    def move(delta, source, when=IN_DAY):
        m = InventoryMovement(organization_id=org_id, location_id=location_id, inventory_item_id=item.id, quantity_delta=Decimal(str(delta)), quantity_before=Decimal("0"), quantity_after=Decimal("0"), unit="L", source_type=source, source_record_id=f"fixture-{len(seq)}", created_at=when)
        seq.append(1)
        db.session.add(m)
        db.session.flush()
        return m

    move(-3, "square sale consumption")  # POS depletion: explained by sales, NOT an adjustment
    waste_move = move(-1, "inventory waste")
    move(5, "invoice receipt")
    move(-0.5, "manual adjustment")  # the only unexplained adjustment
    move(-0.25, "stock count reconciliation")
    move(-40, "manual adjustment", when=OUT_OF_DAY)  # previous day: excluded
    db.session.add(InventoryWasteEvent(organization_id=org_id, location_id=location_id, inventory_item_id=item.id, inventory_movement_id=waste_move.id, quantity=Decimal("1"), unit="L", reason="spoiled", occurred_at=IN_DAY, unit_cost=Decimal("2.00"), total_cost=Decimal("2.00")))
    db.session.commit()

    snap = _get(client, location_id).get_json()["snapshot"]
    rec = snap["reconciliation"]
    assert rec["recordedWasteQuantity"] == 1.0
    assert rec["recordedWasteCost"] == 2.0
    assert rec["otherAdjustmentQuantity"] == -0.5  # consumption, waste, receipt, count excluded
    assert rec["physicalCountCorrectionQuantity"] == -0.25
    assert rec["unexplainedVarianceQuantity"] is None  # no opening/closing counts -> not invented
    assert snap["variance"]["value"] == 0.0
    assert snap["inventoryValue"] == 20.0  # 10 L x $2.00


def test_session_flow_open_sync_update_finalize_and_read_only_after(app, client, monkeypatch):
    org_id, location_id, connection_id = _setup(app, client, monkeypatch, square_location_ids=("LOC-A", "LOC-B"))
    _seed_sales(connection_id, location_id)
    sync_calls = []
    monkeypatch.setattr("backend.daily_close.sync_square_orders_for_range", lambda *a, **k: sync_calls.append(k))

    opened = _open(client, location_id)
    session_id = opened["session"]["id"]
    assert opened["session"]["status"] == "DRAFT"
    assert _open(client, location_id)["session"]["id"] == session_id  # duplicate submit: same session
    assert DailyCloseSession.query.filter_by(organization_id=org_id, location_id=location_id).count() == 1

    assert _post(client, f"/api/pilot/daily-close/{session_id}/sync-sales", {}).status_code == 200
    assert len(sync_calls) == 1
    assert sync_calls[0]["start_at"] == datetime(2026, 8, 30, 4, 0, tzinfo=timezone.utc)
    assert sync_calls[0]["end_at"] == datetime(2026, 8, 31, 3, 59, 59, 999999, tzinfo=timezone.utc)

    updated = _patch(client, f"/api/pilot/daily-close/{session_id}", {"notes": "Short-staffed lunch", "reconciliation": {"countedCash": 495}})
    assert updated.status_code == 200
    body = updated.get_json()
    assert body["session"]["notes"] == "Short-staffed lunch"
    assert body["snapshot"]["manualReconciliation"]["countedCash"] == 495.0
    assert body["snapshot"]["sales"]["netSales"] == 1130.0
    # Sandbox Square has no verified drawer evidence: the count is kept, the variance is unavailable (not 0).
    assert body["snapshot"]["cashReconciliation"]["countedCash"] == 495.0
    assert body["snapshot"]["cashReconciliation"]["overShort"] is None
    assert body["snapshot"]["cashReconciliation"]["varianceStatus"] == "unavailable"

    final = _post(client, f"/api/pilot/daily-close/{session_id}/finalize")
    assert final.status_code == 200
    assert final.get_json()["session"]["status"] == "COMPLETED"
    frozen_sales = final.get_json()["snapshot"]["sales"]
    assert frozen_sales["netSales"] == 1130.0 and frozen_sales["orders"] == 45
    completed_at = db.session.get(DailyCloseSession, session_id).completed_at

    for resp in (
        _post(client, f"/api/pilot/daily-close/{session_id}/finalize"),
        _patch(client, f"/api/pilot/daily-close/{session_id}", {"notes": "late edit", "reconciliation": {"countedCash": 1}}),
        _post(client, f"/api/pilot/daily-close/{session_id}/sync-sales", {}),
    ):
        assert resp.status_code == 409
        assert "read-only" in str(resp.get_json())
    db.session.expire_all()
    record = db.session.get(DailyCloseSession, session_id)
    assert record.completed_at == completed_at
    assert record.notes == "Short-staffed lunch"
    assert record.summary_snapshot_json["manualReconciliation"]["countedCash"] == 495.0
    assert len(sync_calls) == 1

    assert _open(client, location_id)["session"]["status"] == "COMPLETED"  # re-open does not reopen or alter

    row = SquareDailySalesSummary.query.filter_by(square_connection_id=connection_id, square_location_id="LOC-A", sale_date=date(2026, 8, 30)).one()
    row.gross_amount = 9000
    row.net_amount = 8940
    db.session.commit()
    after = _get(client, location_id).get_json()
    assert after["snapshot"]["sales"] == frozen_sales
    history_entry = next(h for h in after["history"] if h["id"] == session_id)
    assert history_entry["currentSnapshot"]["sales"] == frozen_sales


def test_unknown_and_foreign_sessions_are_not_found(app, client, monkeypatch):
    _, location_id, _ = _setup(app, client, monkeypatch)
    assert _patch(client, "/api/pilot/daily-close/999999", {"notes": "x"}).status_code == 404
    assert _post(client, "/api/pilot/daily-close/999999/finalize").status_code == 404
    assert _post(client, "/api/pilot/daily-close/999999/sync-sales", {}).status_code == 404

    session_id = _open(client, location_id)["session"]["id"]
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    other = make_operational_organization(owner, name=f"Other Cafe {uuid4().hex[:8]}", location_name="Elsewhere", enabled_modules=MODULES)
    assert client.post("/api/organizations/select", headers={"X-CSRFToken": _csrf(client)}, json={"organizationId": other.id}).status_code == 200
    assert _patch(client, f"/api/pilot/daily-close/{session_id}", {"notes": "x"}).status_code == 404
    assert _post(client, f"/api/pilot/daily-close/{session_id}/finalize").status_code == 404


# --------------------------------------------------------------------------------------------------
# Cash policy against realistic Square drawer responses
# --------------------------------------------------------------------------------------------------
# Drawer arithmetic used below: opening 100.00 + cash payments 450.00 - refunds 20.00 + paid in 0.00 - paid out 30.00 = 500.00.
def test_open_drawer_with_a_staff_count_yields_the_primary_variance(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift()  # still open: Square has no closed count yet
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    snap = _count(client, session_id, 480)["snapshot"]
    cash = snap["cashReconciliation"]
    assert cash["mode"] == "drawer_shift" and cash["basis"] == "calculated_drawer_cash"
    assert (cash["openingFloat"], cash["cashPayments"], cash["cashRefunds"], cash["paidIn"], cash["paidOut"]) == (100.0, 450.0, 20.0, 0.0, 30.0)
    assert cash["expectedCash"] == 500.0
    assert cash["countedCash"] == 480.0
    assert cash["overShort"] == -20.0 and cash["varianceStatus"] == "available"
    assert cash["closedCash"] is None and cash["providerCountDisagrees"] is False
    assert cash["expectedCashComplete"] is False and cash["openShiftCount"] == 1
    assert [a["detail"] for a in snap["attentionItems"] if a["type"] == "cash_variance"] == ["$20.00 short"]
    assert snap["healthStatus"] == "Ready with warnings"


def test_closed_drawer_without_a_staff_count_shows_square_evidence_but_no_primary_variance(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift(closed=49500)  # Square says 495.00 against 500.00 expected
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    body = _open(client, location_id)
    cash = body["snapshot"]["cashReconciliation"]
    assert cash["expectedCash"] == 500.0 and cash["closedCash"] == 495.0 and cash["providerClosedCash"] == 495.0
    assert cash["providerOverShort"] == -5.0
    # Square's count is provider evidence: it is not silently promoted to the primary actual cash.
    assert cash["overShort"] is None and cash["varianceStatus"] == "unavailable"
    assert "counted cash" in cash["varianceUnavailableReason"]
    assert "countedCash" not in cash
    types = [a["type"] for a in body["snapshot"]["attentionItems"]]
    assert "provider_cash_variance" in types and "cash_variance" not in types
    assert "Square cash drawer short." in body["exceptions"]
    assert body["snapshot"]["healthStatus"] == "Ready with warnings"


def test_staff_count_matching_expected_cash_is_balanced_even_when_square_disagrees(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift(closed=49500)
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    snap = _count(client, session_id, 500)["snapshot"]
    cash = snap["cashReconciliation"]
    assert cash["countedCash"] == 500.0 and cash["overShort"] == 0.0 and cash["varianceStatus"] == "available"
    assert cash["closedCash"] == 495.0  # Square's figure preserved untouched
    assert cash["providerCountDisagrees"] is True and cash["providerCountDifference"] == 5.0  # staff minus Square
    disagreement = next(a for a in snap["attentionItems"] if a["type"] == "cash_count_disagreement")
    assert disagreement["detail"] == "Staff counted $500.00; Square reported $495.00 (+$5.00)"
    assert not any(a["type"] == "cash_variance" for a in snap["attentionItems"])  # no primary variance
    assert snap["healthStatus"] == "Ready with warnings"


def test_staff_count_below_square_count_reports_both_the_variance_and_the_disagreement(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift(closed=49500)
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    cash = _count(client, session_id, 490)["snapshot"]["cashReconciliation"]
    assert cash["overShort"] == -10.0  # 490 - 500
    assert cash["providerOverShort"] == -5.0 and cash["providerCountDifference"] == -5.0  # 490 - 495


def test_staff_and_square_counts_that_agree_do_not_raise_a_disagreement(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift(closed=49500)
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    snap = _count(client, session_id, 495)["snapshot"]
    assert snap["cashReconciliation"]["overShort"] == -5.0
    assert snap["cashReconciliation"]["providerCountDisagrees"] is False
    assert not any(a["type"] == "cash_count_disagreement" for a in snap["attentionItems"])


def test_exact_staff_count_on_an_exact_drawer_is_balanced_without_warnings(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift(closed=50000)
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    snap = _count(client, session_id, 500)["snapshot"]
    assert snap["cashReconciliation"]["overShort"] == 0.0
    assert not [a for a in snap["attentionItems"] if "cash" in a["type"]]


def test_square_expected_cash_is_preferred_over_the_calculated_figure(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift(closed=None, expected=51000)  # Square's own expected_cash_money (510.00) differs from the 500.00 arithmetic
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    cash = _count(client, session_id, 505)["snapshot"]["cashReconciliation"]
    assert cash["basis"] == "square_expected_cash" and cash["expectedCash"] == 510.0 and cash["overShort"] == -5.0


def test_multiple_shifts_are_summed_into_one_expected_figure(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift("SHIFT-1", closed=49500)  # expected 500.00, counted 495.00 by Square
    drawer.shift("SHIFT-2", opened=5000, payments=12000, refunds=0, paid_in=0, paid_out=0)  # open: expected 170.00
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    cash = _count(client, session_id, 660)["snapshot"]["cashReconciliation"]
    assert cash["expectedCash"] == 670.0 and cash["overShort"] == -10.0
    assert cash["shiftCount"] == 2 and cash["openShiftCount"] == 1 and cash["expectedCashComplete"] is False
    assert cash["providerClosedCash"] == 495.0 and cash["providerCountDisagrees"] is False  # one shift still open: not comparable


def test_incomplete_drawer_evidence_makes_the_variance_unavailable_never_zero(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift()
    drawer.detail_error = SquareRequestError("Square is unavailable", status_code=503)
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    body = _count(client, session_id, 480)
    cash = body["snapshot"]["cashReconciliation"]
    assert cash["expectedCash"] is None  # payments fallback has no opening float or paid in/out: not verifiable
    assert cash["countedCash"] == 480.0  # the staff count is still saved
    assert cash["overShort"] is None and cash["varianceStatus"] == "unavailable"
    assert "could not be verified" in cash["varianceUnavailableReason"]
    assert not any(a["type"] == "cash_variance" for a in body["snapshot"]["attentionItems"])


def test_drawer_permission_failure_requires_reconnect_and_leaves_variance_unavailable(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.list_error = SquareRequestError("Forbidden", status_code=403)
    drawer.payments = [{"status": "COMPLETED", "source_type": "CASH", "total_money": {"amount": 8000, "currency": "CAD"}}]
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    cash = _count(client, session_id, 80)["snapshot"]["cashReconciliation"]
    assert cash["mode"] == "payments" and cash["expectedCashTakings"] == 80.0  # takings are not expected drawer cash
    assert cash["reconnectRequired"] is True
    assert cash["expectedCash"] is None and cash["overShort"] is None and cash["varianceStatus"] == "unavailable"


def test_no_square_cash_evidence_at_all_is_unavailable(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.list_error = SquareRequestError("Forbidden", status_code=403)
    drawer.payments_error = SquareRequestError("Forbidden", status_code=403)
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    cash = _count(client, session_id, 80)["snapshot"]["cashReconciliation"]
    assert cash["status"] == "unavailable" and cash["expectedCash"] is None
    assert cash["countedCash"] == 80.0 and cash["overShort"] is None and cash["varianceStatus"] == "unavailable"


def test_counts_are_idempotent_replaceable_and_clearable(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift()
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    for _ in range(3):  # duplicate submits give the identical figures and exactly one warning
        snap = _count(client, session_id, 480)["snapshot"]
        assert snap["cashReconciliation"]["overShort"] == -20.0
        assert len([a for a in snap["attentionItems"] if a["type"] == "cash_variance"]) == 1
    assert _patch(client, f"/api/pilot/daily-close/{session_id}", {"notes": "tip jar"}).get_json()["snapshot"]["cashReconciliation"]["countedCash"] == 480.0
    for bad in ("abc", -5):  # invalid entries are ignored and never change the stored count
        assert _count(client, session_id, bad)["snapshot"]["cashReconciliation"]["countedCash"] == 480.0
    assert _count(client, session_id, 500)["snapshot"]["cashReconciliation"]["overShort"] == 0.0
    cleared = _count(client, session_id, None)["snapshot"]["cashReconciliation"]
    assert "countedCash" not in cleared and cleared["overShort"] is None and cleared["varianceStatus"] == "unavailable"


def test_finalize_freezes_the_count_variance_and_square_evidence(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift(closed=49500)
    _, location_id, connection_id = _production_cafe(app, client, monkeypatch, drawer)
    _summary(connection_id, location_id, "LOC-A", gross_amount=1000, net_amount=910, order_count=42)
    db.session.commit()
    session_id = _open(client, location_id)["session"]["id"]
    _count(client, session_id, 490)
    final = _post(client, f"/api/pilot/daily-close/{session_id}/finalize")
    assert final.status_code == 200, final.get_data(as_text=True)
    cash = final.get_json()["snapshot"]["cashReconciliation"]
    assert final.get_json()["session"]["status"] == "COMPLETED"
    assert (cash["expectedCash"], cash["countedCash"], cash["overShort"]) == (500.0, 490.0, -10.0)
    assert cash["closedCash"] == 495.0 and cash["providerCountDifference"] == -5.0 and cash["providerCountDisagrees"] is True
    assert cash["shifts"][0]["id"] == "SHIFT-1" and cash["capturedAt"]
    assert {"cash_variance", "cash_count_disagreement"} <= {a["type"] for a in final.get_json()["snapshot"]["attentionItems"]}

    # Square later changes its mind and a new count is attempted: the completed record cannot move.
    drawer.shifts[0]["closed_cash_money"]["amount"] = 1000
    assert _patch(client, f"/api/pilot/daily-close/{session_id}", {"reconciliation": {"countedCash": 500}}).status_code == 409
    assert _post(client, f"/api/pilot/daily-close/{session_id}/finalize").status_code == 409
    reread = _get(client, location_id).get_json()["snapshot"]["cashReconciliation"]
    assert (reread["countedCash"], reread["overShort"], reread["closedCash"]) == (490.0, -10.0, 495.0)
    db.session.expire_all()
    stored = db.session.get(DailyCloseSession, session_id).summary_snapshot_json["cashReconciliation"]
    assert (stored["countedCash"], stored["overShort"], stored["expectedCash"], stored["providerClosedCash"]) == (490.0, -10.0, 500.0, 495.0)


def test_finalize_keeps_verified_evidence_when_square_is_unreadable_at_that_moment(app, client, monkeypatch):
    drawer = SquareDrawer()
    drawer.shift()
    _, location_id, _ = _production_cafe(app, client, monkeypatch, drawer)
    session_id = _open(client, location_id)["session"]["id"]
    assert _count(client, session_id, 480)["snapshot"]["cashReconciliation"]["overShort"] == -20.0
    drawer.list_error = SquareRequestError("Square is down", status_code=503)
    drawer.payments_error = SquareRequestError("Square is down", status_code=503)
    cash = _post(client, f"/api/pilot/daily-close/{session_id}/finalize").get_json()["snapshot"]["cashReconciliation"]
    assert cash["carriedFromDraft"] is True  # flagged, never presented as freshly verified
    assert (cash["expectedCash"], cash["countedCash"], cash["overShort"]) == (500.0, 480.0, -20.0)


def test_finalize_without_any_verified_evidence_stays_unavailable(app, client, monkeypatch):
    _, location_id, _ = _setup(app, client, monkeypatch)  # sandbox: never verified
    session_id = _open(client, location_id)["session"]["id"]
    _count(client, session_id, 480)
    cash = _post(client, f"/api/pilot/daily-close/{session_id}/finalize").get_json()["snapshot"]["cashReconciliation"]
    assert cash["countedCash"] == 480.0 and cash["overShort"] is None and cash["varianceStatus"] == "unavailable"
    assert "carriedFromDraft" not in cash


# --------------------------------------------------------------------------------------------------
# Reports and exports must agree with completed Daily Close sessions
# --------------------------------------------------------------------------------------------------
def _seed_report_sales(connection_id, location_id):
    # Two mapped Square locations on the close date; an unmapped location and a date outside the week must not leak in.
    _summary(connection_id, location_id, "LOC-A", gross_amount=800, discount_amount=40, tax_amount=100, tip_amount=60, refund_amount=20, net_amount=740, order_count=30, cancelled_order_count=1)
    _summary(connection_id, location_id, "LOC-B", gross_amount=400, discount_amount=10, tax_amount=50, tip_amount=20, refund_amount=0, net_amount=390, order_count=15)
    _summary(connection_id, location_id, "LOC-OTHER", mapped=False, gross_amount=9999, net_amount=9999, order_count=99)
    _summary(connection_id, location_id, "LOC-A", sale_date=date(2026, 8, 1), gross_amount=5000, net_amount=5000, order_count=77)
    db.session.commit()


def _report_sales(client, **params):
    response = client.get("/api/pilot/reports", query_string=params)
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()["sales"]


def _close_figures(sales):
    return {
        "grossItemSales": sales["grossSales"], "discounts": sales["discounts"], "tax": sales["tax"], "tips": sales["tips"],
        "refunds": sales["refunds"], "totalCollected": sales["netSales"], "orderCount": sales["orders"], "cancelledOrderCount": sales["cancelledOrders"],
    }


def test_daily_and_weekly_reports_match_the_completed_close_exactly(app, client, monkeypatch):
    _, location_id, connection_id = _setup(app, client, monkeypatch, square_location_ids=("LOC-A", "LOC-B"))
    _seed_report_sales(connection_id, location_id)
    session_id = _open(client, location_id)["session"]["id"]
    final = _post(client, f"/api/pilot/daily-close/{session_id}/finalize").get_json()
    expected = {"grossItemSales": 1200.0, "discounts": 50.0, "tax": 150.0, "tips": 80.0, "refunds": 20.0, "totalCollected": 1130.0, "orderCount": 45, "cancelledOrderCount": 1}
    assert _close_figures(final["snapshot"]["sales"]) == expected  # hand-computed, see _seed_report_sales

    daily = _report_sales(client, view="daily", date=DAY)
    weekly = _report_sales(client, view="weekly", startDate="2026-08-24", endDate=DAY)
    for report in (daily, weekly):
        assert {key: report[key] for key in expected} == expected
    # The history entry for the completed session carries the same frozen figures.
    history = next(h for h in _get(client, location_id).get_json()["history"] if h["id"] == session_id)
    assert _close_figures(history["currentSnapshot"]["sales"]) == expected
    # A report for another day does not pick up the close.
    assert _report_sales(client, view="daily", date="2026-08-02")["orderCount"] == 0


def test_report_follows_late_pos_data_while_the_completed_close_stays_frozen(app, client, monkeypatch):
    """Documented behavior: the completed close is a frozen snapshot; reports are live. They match at close time."""
    _, location_id, connection_id = _setup(app, client, monkeypatch, square_location_ids=("LOC-A", "LOC-B"))
    _seed_report_sales(connection_id, location_id)
    session_id = _open(client, location_id)["session"]["id"]
    _post(client, f"/api/pilot/daily-close/{session_id}/finalize")
    row = SquareDailySalesSummary.query.filter_by(square_connection_id=connection_id, square_location_id="LOC-A", sale_date=date(2026, 8, 30)).one()
    row.net_amount = 800
    row.order_count = 33
    db.session.commit()
    assert _report_sales(client, view="daily", date=DAY)["totalCollected"] == 1190.0  # 800 + 390, live
    frozen = _get(client, location_id).get_json()["snapshot"]["sales"]
    assert frozen["netSales"] == 1130.0 and frozen["orders"] == 45  # the close did not move
