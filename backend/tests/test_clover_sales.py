from datetime import date, datetime, timezone
from types import SimpleNamespace

from backend.clover_orders import normalize_order
from backend.clover_sales import CASH_TENDER_KEY, business_day_window, order_financials, summarize_orders

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
