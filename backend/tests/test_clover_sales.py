from datetime import date, datetime, timezone
from types import SimpleNamespace

from backend.clover_orders import normalize_order
from backend.clover_sales import CASH_TENDER_KEY, business_day_window, order_financials, summarize_orders
from backend.clover_usage import _window as usage_business_day_window

WINDOW = business_day_window(date(2026, 11, 3), "America/Toronto")
NOON = datetime(2026, 11, 3, 17, 0, tzinfo=timezone.utc)


def _pay(amount, tax=0, tip=None, tender=CASH_TENDER_KEY, result="SUCCESS"):
    return {"id": "p", "amount": amount, "result": result, "components": [], "taxAmount": tax, "tipAmount": tip, "tender": tender}


def _order(oid, payments, *, status="paid", review=False, closed=NOON, raw=None, order_type=""):
    return SimpleNamespace(
        id=oid, clover_order_id=f"C{oid}", clover_connection_id=1, normalized_status=status, requires_review=review,
        source_closed_at=closed, raw_payload_json={"payments": payments, "orderType": order_type, **(raw or {})},
    )


def test_net_excludes_tax_and_tip_and_splits_cash():
    orders = [
        _order(1, [_pay(1130, tax=130, tip=200)]),
        _order(2, [_pay(2260, tax=260, tender="com.clover.tender.credit_card")]),
    ]
    day = summarize_orders(orders, WINDOW)
    assert day.net_sales_cents == 1000 + 2000
    assert day.tax_cents == 390 and day.tips_cents == 200
    assert day.cash_expected_cents == 1130 + 200  # cash amount + cash tip only
    assert day.order_count == 2 and day.exceptions == []


def test_missing_tax_breakdown_is_unavailable_never_gross():
    day = summarize_orders([_order(1, [_pay(1130, tax=None)]), _order(2, [_pay(500)])], WINDOW)
    assert day.net_sales_cents is None and not day.net_sales_available
    assert day.as_dict()["netSalesCents"] is None
    assert any(e["reason"] == "net_sales_unavailable" for e in day.exceptions)


def test_missing_tender_makes_cash_unavailable_but_net_still_available():
    day = summarize_orders([_order(1, [_pay(1130, tax=130, tender="")])], WINDOW)
    assert day.net_sales_cents == 1000 and day.cash_expected_cents is None


def test_non_paid_and_review_orders_are_exceptions_not_sales():
    orders = [_order(1, [_pay(100)], status="refunded", review=True), _order(2, [_pay(100)], status="cancelled"), _order(3, [_pay(100)], status="paid", review=True), _order(4, [_pay(500, 0)])]
    day = summarize_orders(orders, WINDOW)
    assert day.order_count == 1 and day.net_sales_cents == 500
    assert sorted(e["reason"] for e in day.exceptions) == ["cancelled", "needs_review", "refunded_or_refund_unverified"]


def test_excluded_cash_order_is_marked_as_cash_evidence_but_cash_neutral_cancel_is_not():
    cancelled_cash = _order(1, [_pay(500)], status="cancelled")
    partial_cash = _order(2, [_pay(500)], status="pending", review=True)
    cancelled_card = _order(3, [_pay(500, tender="com.clover.tender.credit_card")], status="cancelled")

    day = summarize_orders([cancelled_cash, partial_cash, cancelled_card], WINDOW)

    by_id = {exception["orderId"]: exception for exception in day.exceptions}
    assert by_id[1] == {"orderId": 1, "cloverOrderId": "C1", "reason": "cancelled", "cashEvidence": True}
    assert by_id[2] == {"orderId": 2, "cloverOrderId": "C2", "reason": "not_fully_paid", "cashEvidence": True}
    assert "cashEvidence" not in by_id[3]


def test_sales_and_usage_helpers_use_the_same_dst_aware_local_day_window():
    cases = ((date(2026, 3, 8), 23), (date(2026, 11, 1), 25), (date(2026, 2, 15), 24))
    for business_date, hours in cases:
        sales_window = business_day_window(business_date, "America/Toronto")
        usage_window = usage_business_day_window(business_date, "America/Toronto")
        assert sales_window == usage_window
        assert (sales_window[1] - sales_window[0]).total_seconds() == hours * 3600


def test_order_is_attributed_by_closed_time_not_an_untrusted_payment_date():
    in_day = datetime(2026, 11, 4, 4, 59, tzinfo=timezone.utc)
    out_of_day = datetime(2026, 11, 4, 5, 1, tzinfo=timezone.utc)
    order = _order(1, [_pay(500)], closed=in_day, raw={"payments": [{**_pay(500), "createdTime": int(out_of_day.timestamp() * 1000)}]})

    day = summarize_orders([order], WINDOW)

    assert day.order_count == 1 and day.net_sales_cents == 500


def test_failed_payment_not_counted_and_financial_incomplete_unavailable():
    fin = order_financials(1, {"payments": [_pay(500, result="FAILED")]})
    assert fin.net_cents is None
    fin = order_financials(1, {"payments": [_pay(500)], "financialIncomplete": True})
    assert fin.net_cents is None
    fin = order_financials(1, {"payments": [_pay(500), _pay(300, result="VOIDED")]})
    assert fin.net_cents == 500


def test_timezone_boundary_and_duplicate_replay_counted_once():
    inside_late = datetime(2026, 11, 4, 4, 59, tzinfo=timezone.utc)  # 23:59 Toronto (EST, UTC-5)
    next_day = datetime(2026, 11, 4, 5, 0, tzinfo=timezone.utc)  # 00:00 next day
    orders = [_order(1, [_pay(100)], closed=inside_late), _order(2, [_pay(100)], closed=next_day), _order(3, [_pay(100)], closed=NOON), _order(4, [_pay(100)], closed=NOON)]
    orders[3].clover_order_id = orders[2].clover_order_id  # same provider order replayed
    day = summarize_orders(orders, WINDOW)
    assert day.order_count == 2 and day.net_sales_cents == 200


def test_delivery_orders_included_once_and_reported():
    day = summarize_orders([_order(1, [_pay(1130, tax=130)], order_type="Delivery"), _order(2, [_pay(500)])], WINDOW)
    assert day.order_count == 2 and day.net_sales_cents == 1500 and day.delivery_order_count == 1 and day.delivery_net_cents == 1000


def test_normalize_order_captures_amounts_for_sales_math():
    payload = {
        "id": "o1", "state": "LOCKED", "paymentState": "PAID", "total": 1130, "currency": "CAD", "closedTime": 1, "createdTime": 1, "modifiedTime": 1,
        "orderType": {"label": "Delivery"},
        "lineItems": {"elements": [{"id": "l1", "name": "Burger", "quantity": 1, "price": 1000, "item": {"id": "i1"}}], "total": 1},
        "payments": {"elements": [{"id": "p1", "amount": 1130, "taxAmount": 130, "tipAmount": 150, "result": "SUCCESS", "tender": {"labelKey": "com.clover.tender.cash"}}], "total": 1},
        "refunds": {"elements": [], "total": 0},
    }
    n = normalize_order(payload)
    fin = order_financials(1, n.raw)
    assert (fin.net_cents, fin.tax_cents, fin.tip_cents, fin.cash_cents, fin.delivery) == (1000, 130, 150, 1280, True)


import pytest


@pytest.mark.parametrize("flag", ["incomplete", "lineItemsIncomplete", "financialIncomplete", "refundsUnverified", "paymentStateConflict"])
def test_paid_order_with_any_uncertainty_marker_is_excluded_and_flagged(flag):
    good = _order(1, [_pay(1130, tax=130)])
    bad = _order(2, [_pay(2260, tax=260)], raw={flag: True})
    day = summarize_orders([good, bad], WINDOW)
    assert day.order_count == 1 and day.net_sales_cents == 1000
    assert [e["reason"] for e in day.exceptions] == ["incomplete_evidence"]
    assert order_financials(2, bad.raw_payload_json).net_cents is None


def test_partial_refund_on_paid_order_is_never_overstated():
    partial = _order(1, [_pay(2260, tax=260)], raw={"refunds": [{"id": "r", "amount": 500, "components": []}]})
    day = summarize_orders([partial, _order(2, [_pay(1130, tax=130)])], WINDOW)
    assert day.net_sales_cents == 1000 and day.order_count == 1  # refunded order is not counted at full value
    assert day.exceptions[0]["reason"] == "refund_present" and day.exceptions[0]["orderId"] == 1


def test_refunded_status_with_refund_records_stays_an_exception():
    full = _order(1, [_pay(1130, tax=130)], status="refunded", review=True, raw={"refunds": [{"id": "r", "amount": 1130, "components": []}]})
    day = summarize_orders([full], WINDOW)
    assert day.order_count == 0 and day.net_sales_cents == 0 and day.exceptions[0]["reason"] == "refunded_or_refund_unverified"


def test_normalized_order_with_unverified_refunds_never_contributes():
    payload = {
        "id": "o9", "state": "LOCKED", "paymentState": "PAID", "total": 1130, "closedTime": 1, "createdTime": 1, "modifiedTime": 1,
        "lineItems": {"elements": [{"id": "l1", "name": "Burger", "quantity": 1, "price": 1000, "item": {"id": "i1"}}], "total": 1},
        "payments": {"elements": [{"id": "p1", "amount": 1130, "taxAmount": 130, "result": "SUCCESS", "tender": {"labelKey": "com.clover.tender.cash"}}], "total": 1},
        "_shadow_refunds_unverified": True,
    }
    n = normalize_order(payload)
    order = _order(1, [], status=n.normalized_status, review=n.requires_review, raw=n.raw)
    day = summarize_orders([order], WINDOW)
    assert day.order_count == 0 and day.net_sales_cents == 0 and day.exceptions
