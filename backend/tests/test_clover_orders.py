from datetime import datetime, timezone
from decimal import Decimal

from backend.clover_orders import CloverOrderClient, normalize_order


def _order(**overrides):
    value = {
        "id": "order-1",
        "state": "PAID",
        "total": 1800,
        "createdTime": 1_728_000_000_000,
        "modifiedTime": 1_728_000_100_000,
        "payments": {"elements": [{"id": "payment-1", "amount": 1800}]},
        "lineItems": {"elements": [{
            "id": "line-1",
            "name": "Test Burger",
            "quantity": 1,
            "price": 1800,
            "item": {"id": "TE0BYZH7B28AJ", "name": "Test Burger"},
        }]},
    }
    value.update(overrides)
    return value


def test_normalize_paid_order_preserves_provider_identity_and_line():
    order = normalize_order(_order())
    assert order.provider_id == "order-1"
    assert order.normalized_status == "paid"
    assert order.potentially_eligible is True
    assert order.lines[0].item_id == "TE0BYZH7B28AJ"
    assert order.lines[0].quantity == Decimal("1")


def test_normalize_pending_cancelled_and_refunded_orders_require_no_consumption():
    assert normalize_order(_order(state="OPEN", payments={"elements": []})).normalized_status == "pending"
    assert normalize_order(_order(state="VOIDED")).normalized_status == "cancelled"
    assert normalize_order(_order(state="PAID", refunds={"elements": [{"id": "refund-1"}]})).normalized_status == "refunded"


def test_unknown_state_requires_review():
    order = normalize_order(_order(state="SOMETHING_NEW", payments={"elements": []}))
    assert order.normalized_status == "review"
    assert order.requires_review is True
    assert order.potentially_eligible is False


def test_client_reports_incomplete_bounded_page(monkeypatch):
    pages = iter([
        {"elements": [{"id": "1"}]},
        {"elements": [{"id": "2"}]},
    ])
    monkeypatch.setattr("backend.clover_orders.clover_request", lambda *args, **kwargs: next(pages))
    orders, complete = CloverOrderClient(merchant_id="merchant", token="token").fetch_orders(max_pages=2, page_size=1)
    assert complete is False
    assert [order.provider_id for order in orders] == ["1", "2"]


def test_client_stops_when_page_is_short(monkeypatch):
    monkeypatch.setattr("backend.clover_orders.clover_request", lambda *args, **kwargs: {"elements": [_order()]})
    orders, complete = CloverOrderClient(merchant_id="merchant", token="token").fetch_orders(max_pages=3, page_size=2)
    assert complete is True
    assert len(orders) == 1
