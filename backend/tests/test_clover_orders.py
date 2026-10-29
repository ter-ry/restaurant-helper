from datetime import datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import parse_qs, urlparse

from backend.clover_orders import CloverOrderClient, normalize_order


def _order(**overrides):
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    value = {
        "id": "order-1",
        "state": "CLOSED",
        "paymentState": "PAID",
        "total": 1800,
        "currency": "CAD",
        "createdTime": now_ms,
        "modifiedTime": now_ms,
        "payments": {"elements": [{"id": "payment-1", "amount": 1800, "result": "SUCCESS"}], "total": 1},
        "refunds": {"elements": [], "total": 0},
        "lineItems": {"elements": [{
            "id": "line-1",
            "name": "Test Burger",
            "quantity": 1,
            "price": 1800,
            "item": {"id": "TE0BYZH7B28AJ", "name": "Test Burger"},
            "modifications": {"elements": [], "total": 0},
        }], "total": 1},
    }
    value.update(overrides)
    return value


def test_normalize_paid_order_preserves_provider_identity_and_line():
    order = normalize_order(_order())
    assert order.provider_id == "order-1"
    assert order.provider_status == "CLOSED"
    assert order.payment_status == "paid"
    assert order.normalized_status == "paid"
    assert order.potentially_eligible is True
    assert order.lines[0].item_id == "TE0BYZH7B28AJ"
    assert order.lines[0].quantity == Decimal("1")
    assert order.incomplete is False


def test_documented_payment_states_are_conservative():
    assert normalize_order(_order(paymentState="OPEN")).normalized_status == "pending"
    assert normalize_order(_order(paymentState="PARTIALLY_PAID")).normalized_status == "pending"
    assert normalize_order(_order(paymentState="REFUNDED")).normalized_status == "refunded"
    assert normalize_order(_order(paymentState="CREDITED")).normalized_status == "refunded"
    assert normalize_order(_order(paymentState="PARTIALLY_REFUNDED")).normalized_status == "refunded"
    locked = normalize_order(_order(state="LOCKED", paymentState="OPEN"))
    assert locked.normalized_status == "pending"
    assert locked.potentially_eligible is False


def test_conflicting_or_missing_payment_information_requires_review():
    assert normalize_order(_order(paymentState="PAID", payments={"elements": [], "total": 0})).requires_review is True
    assert normalize_order(_order(state="LOCKED", paymentState="", payments={"elements": [], "total": 0})).normalized_status == "review"
    assert normalize_order(_order(paymentState="PAID", total=2000)).requires_review is True


def test_cancelled_and_deleted_orders_are_not_eligible():
    assert normalize_order(_order(state="VOIDED")).normalized_status == "cancelled"
    assert normalize_order(_order(deletedTime=int(datetime.now(timezone.utc).timestamp() * 1000))).normalized_status == "cancelled"


def test_missing_or_incomplete_nested_collections_are_review_only():
    missing_lines = dict(_order())
    missing_lines.pop("lineItems")
    normalized = normalize_order(missing_lines)
    assert normalized.incomplete is True
    assert normalized.potentially_eligible is False
    oversized = _order(lineItems={"elements": _order()["lineItems"]["elements"], "total": 2})
    assert normalize_order(oversized).incomplete is True


def test_unknown_state_requires_review():
    order = normalize_order(_order(state="SOMETHING_NEW", paymentState="UNKNOWN"))
    assert order.normalized_status == "review"
    assert order.requires_review is True
    assert order.potentially_eligible is False


def test_client_applies_recent_window_filters_and_orders_server_query(monkeypatch):
    captured = []
    monkeypatch.setattr("backend.clover_orders.clover_request", lambda method, path, **kwargs: captured.append(path) or {"elements": [_order()]})
    start = datetime.now(timezone.utc) - timedelta(days=1)
    end = datetime.now(timezone.utc)
    orders, complete = CloverOrderClient(merchant_id="merchant", token="token").fetch_orders(start=start, end=end, max_pages=3, page_size=2)
    assert complete is True
    assert len(orders) == 1
    query = parse_qs(urlparse(captured[0]).query)
    assert any(value.startswith("modifiedTime>=") for value in query["filter"])
    assert any(value.startswith("modifiedTime<=") for value in query["filter"])


def test_client_rejects_more_than_ninety_days():
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=91)
    try:
        CloverOrderClient(merchant_id="merchant", token="token").fetch_orders(start=start, end=end)
    except ValueError as exc:
        assert "90 days" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_client_reports_incomplete_bounded_page(monkeypatch):
    pages = iter([
        {"elements": [_order(id="1")]},
        {"elements": [_order(id="2")]},
    ])
    monkeypatch.setattr("backend.clover_orders.clover_request", lambda *args, **kwargs: next(pages))
    start = datetime.now(timezone.utc) - timedelta(days=1)
    end = datetime.now(timezone.utc) + timedelta(minutes=1)
    orders, complete = CloverOrderClient(merchant_id="merchant", token="token").fetch_orders(start=start, end=end, max_pages=2, page_size=1)
    assert complete is False
    assert [order.provider_id for order in orders] == ["1", "2"]


def test_client_stops_when_page_is_short(monkeypatch):
    monkeypatch.setattr("backend.clover_orders.clover_request", lambda *args, **kwargs: {"elements": [_order()]})
    start = datetime.now(timezone.utc) - timedelta(days=1)
    end = datetime.now(timezone.utc) + timedelta(minutes=1)
    orders, complete = CloverOrderClient(merchant_id="merchant", token="token").fetch_orders(start=start, end=end, max_pages=3, page_size=2)
    assert complete is True
    assert len(orders) == 1
