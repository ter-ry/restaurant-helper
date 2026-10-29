from datetime import datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import parse_qs, urlparse

from backend.clover_orders import CloverOrderClient, normalize_order


def _line(*, quantity=None, unit_qty=None, price_type=None, line_id="line-1", item_id="TE0BYZH7B28AJ"):
    value = {"id": line_id, "name": "Test Burger", "price": 1800, "item": {"id": item_id, "name": "Test Burger"}, "modifications": {"elements": [], "total": 0}}
    if quantity is not None:
        value["quantity"] = quantity
    if unit_qty is not None:
        value["unitQty"] = unit_qty
    if price_type is not None:
        value["priceType"] = price_type
    return value


def _order(**overrides):
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    value = {
        "id": "order-1", "state": "CLOSED", "paymentState": "PAID", "total": 1800, "currency": "CAD",
        "createdTime": now_ms, "modifiedTime": now_ms,
        "payments": {"elements": [{"id": "payment-1", "amount": 1800, "result": "SUCCESS"}], "total": 1},
        "refunds": {"elements": [], "total": 0},
        "lineItems": {"elements": [_line(quantity=1)], "total": 1},
    }
    value.update(overrides)
    return value


def test_real_clover_style_test_burger_without_quantity_is_one():
    normalized = normalize_order(_order(lineItems={"elements": [_line()], "total": 1}))
    assert normalized.lines[0].item_id == "TE0BYZH7B28AJ"
    assert normalized.lines[0].quantity == Decimal("1")
    assert normalized.lines[0].quantity_ambiguous is False


def test_unit_quantity_scaling_and_ambiguous_quantities_are_safe():
    assert normalize_order(_order(lineItems={"elements": [_line(unit_qty=1000, price_type="PER_UNIT")], "total": 1})).lines[0].quantity == Decimal("1")
    assert normalize_order(_order(lineItems={"elements": [_line(unit_qty=2500, price_type="PER_UNIT")], "total": 1})).lines[0].quantity == Decimal("2.5")
    assert normalize_order(_order(lineItems={"elements": [_line(unit_qty=500, price_type="PER_UNIT")], "total": 1})).lines[0].quantity == Decimal("0.5")
    ignored = normalize_order(_order(lineItems={"elements": [_line(unit_qty=2500, price_type="FIXED")], "total": 1}))
    assert ignored.lines[0].quantity == Decimal("1")
    ambiguous = normalize_order(_order(lineItems={"elements": [_line(quantity=2, unit_qty=2500)], "total": 1}))
    assert ambiguous.lines[0].quantity_ambiguous is True
    assert ambiguous.requires_review is True
    assert ambiguous.potentially_eligible is False
    unknown = normalize_order(_order(lineItems={"elements": [_line(unit_qty=2500)], "total": 1}))
    assert unknown.lines[0].quantity_ambiguous is True
    assert unknown.requires_review is True


def test_normalize_paid_order_preserves_provider_identity_and_line():
    order = normalize_order(_order())
    assert order.provider_id == "order-1"
    assert order.provider_status == "CLOSED"
    assert order.payment_status == "paid"
    assert order.normalized_status == "paid"
    assert order.potentially_eligible is True
    assert order.incomplete is False


def test_documented_payment_states_are_conservative():
    assert normalize_order(_order(paymentState="OPEN")).normalized_status == "pending"
    assert normalize_order(_order(paymentState="PARTIALLY_PAID")).normalized_status == "pending"
    assert normalize_order(_order(paymentState="REFUNDED")).normalized_status == "refunded"
    assert normalize_order(_order(paymentState="CREDITED")).normalized_status == "refunded"
    assert normalize_order(_order(paymentState="PARTIALLY_REFUNDED")).normalized_status == "refunded"
    assert normalize_order(_order(state="LOCKED", paymentState="OPEN")).normalized_status == "pending"


def test_failed_outstanding_and_conflicting_payment_information_requires_review():
    failed = normalize_order(_order(paymentState="PAID", payments={"elements": [{"id": "p", "amount": 1800, "result": "FAILED"}], "total": 1}))
    assert failed.requires_review is True and failed.potentially_eligible is False
    assert normalize_order(_order(paymentState="PAID", unpaidBalance=100)).requires_review is True
    assert normalize_order(_order(paymentState="OPEN", unpaidBalance=0)).requires_review is True


def test_optional_empty_collections_can_be_omitted_without_fabricating_data():
    payload = _order()
    payload.pop("refunds")
    payload["lineItems"]["elements"][0].pop("modifications")
    normalized = normalize_order(payload)
    assert normalized.incomplete is False
    assert normalized.potentially_eligible is True


def test_missing_or_incomplete_nested_collections_are_review_only():
    missing_lines = dict(_order())
    missing_lines.pop("lineItems")
    assert normalize_order(missing_lines).potentially_eligible is False
    oversized = _order(lineItems={"elements": [_line(quantity=1)], "total": 2})
    assert normalize_order(oversized).incomplete is True


def test_cancelled_deleted_and_unknown_orders_are_not_eligible():
    assert normalize_order(_order(state="VOIDED")).normalized_status == "cancelled"
    assert normalize_order(_order(deletedTime=int(datetime.now(timezone.utc).timestamp() * 1000))).normalized_status == "cancelled"
    unknown = normalize_order(_order(state="SOMETHING_NEW", paymentState="UNKNOWN"))
    assert unknown.normalized_status == "review"
    assert unknown.requires_review is True


def test_client_uses_one_safe_list_expansion_and_separate_gets(monkeypatch):
    captured = []
    def fake_request(method, path, **kwargs):
        captured.append(path)
        if "/orders?" in path:
            payload = _order()
            payload.pop("lineItems"); payload.pop("payments"); payload.pop("refunds")
            return {"elements": [payload]}
        if "/line_items?" in path:
            return {"elements": [_line()], "total": 1}
        if "/payments?" in path:
            return {"elements": [{"id": "payment-1", "amount": 1800, "result": "SUCCESS"}], "total": 1}
        if "/merchants/merchant/refunds?" in path:
            return {"elements": [], "total": 0}
        raise AssertionError(path)
    monkeypatch.setattr("backend.clover_orders.clover_request", fake_request)
    start = datetime.now(timezone.utc) - timedelta(days=1)
    end = datetime.now(timezone.utc) + timedelta(minutes=1)
    orders, complete = CloverOrderClient(merchant_id="merchant", token="token").fetch_orders(start=start, end=end, page_size=2)
    assert complete is True and len(orders) == 1 and orders[0].potentially_eligible is True
    list_call = next(path for path in captured if "/orders?" in path)
    query = parse_qs(urlparse(list_call).query)
    assert query["expand"] == ["lineItems"]
    assert any("/line_items?" in path and "expand=modifications" in path for path in captured)
    assert any("/payments?" in path for path in captured)
    assert any("/merchants/merchant/refunds?" in path and "orderRef.id=order-1" in path for path in captured)
    assert not any("/orders/order-1/refunds?" in path for path in captured)


def test_restricted_payment_and_refund_gets_preserve_review_state(monkeypatch):
    def fake_request(method, path, **kwargs):
        if "/orders?" in path:
            payload = _order()
            payload.pop("lineItems"); payload.pop("payments"); payload.pop("refunds")
            return {"elements": [payload]}
        if "/line_items?" in path:
            return {"elements": [_line()], "total": 1}
        from backend.clover import CloverRequestError
        if "/payments?" in path:
            raise CloverRequestError("forbidden", status_code=403)
        if "/merchants/merchant/refunds?" in path:
            raise CloverRequestError("forbidden", status_code=403)
        raise AssertionError(path)
    monkeypatch.setattr("backend.clover_orders.clover_request", fake_request)
    orders, complete = CloverOrderClient(merchant_id="merchant", token="token").fetch_orders(
        start=datetime.now(timezone.utc) - timedelta(days=1),
        end=datetime.now(timezone.utc) + timedelta(minutes=1),
    )
    assert complete is True and orders[0].incomplete is True
    assert orders[0].requires_review is True and orders[0].potentially_eligible is False


def test_client_rejects_more_than_ninety_days():
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    try:
        CloverOrderClient(merchant_id="merchant", token="token").fetch_orders(start=start, end=start + timedelta(days=91))
    except ValueError as exc:
        assert "90 days" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_restricted_merchant_refunds_keep_open_order_visible_and_reviewable(monkeypatch):
    captured = []
    def fake_request(method, path, **kwargs):
        captured.append(path)
        if "/orders?" in path:
            payload = _order(state="OPEN", paymentState="OPEN")
            payload.pop("lineItems"); payload.pop("payments"); payload.pop("refunds")
            return {"elements": [payload]}
        if "/line_items?" in path:
            return {"elements": [_line()], "total": 1}
        if "/payments?" in path:
            return {"elements": [], "total": 0}
        if "/merchants/merchant/refunds?" in path:
            from backend.clover import CloverRequestError
            raise CloverRequestError("forbidden", status_code=401)
        raise AssertionError(path)
    monkeypatch.setattr("backend.clover_orders.clover_request", fake_request)
    orders, complete = CloverOrderClient(merchant_id="merchant", token="token").fetch_orders(
        start=datetime.now(timezone.utc) - timedelta(days=1),
        end=datetime.now(timezone.utc) + timedelta(minutes=1),
    )
    assert complete is True and len(orders) == 1
    assert orders[0].provider_id == "order-1"
    assert orders[0].incomplete is True
    assert orders[0].requires_review is True
    assert orders[0].potentially_eligible is False
    assert any("/merchants/merchant/refunds?" in path for path in captured)
    assert not any("/orders/order-1/refunds?" in path for path in captured)


def test_shadow_failure_diagnostics_use_operation_labels_without_sensitive_data(monkeypatch, caplog):
    from backend.clover import CloverRequestError

    def fake_request(method, path, **kwargs):
        if "/orders?" in path:
            raise CloverRequestError("rejected", status_code=503, code="clover_unavailable")
        raise AssertionError(path)

    monkeypatch.setattr("backend.clover_orders.clover_request", fake_request)
    client = CloverOrderClient(merchant_id="merchant-secret", token="access-secret")
    with caplog.at_level("WARNING", logger="backend.clover_orders"):
        try:
            client.fetch_orders(
                start=datetime.now(timezone.utc) - timedelta(days=1),
                end=datetime.now(timezone.utc) + timedelta(minutes=1),
            )
        except CloverRequestError:
            pass
    messages = [record.getMessage() for record in caplog.records]
    assert any("operation=order_list" in message and "status=503" in message and "handled=False" in message for message in messages)
    assert all("merchant-secret" not in message and "access-secret" not in message for message in messages)
    assert all("order-1" not in message and "Authorization" not in message for message in messages)


def test_shadow_handled_payment_and_refund_failures_are_labeled(monkeypatch, caplog):
    from backend.clover import CloverRequestError

    def fake_request(method, path, **kwargs):
        if "/orders?" in path:
            payload = _order()
            payload.pop("lineItems")
            payload.pop("payments")
            payload.pop("refunds")
            return {"elements": [payload]}
        if "/line_items?" in path:
            raise CloverRequestError("line item failure", status_code=503, code="clover_unavailable")
        if "/payments?" in path:
            raise CloverRequestError("payment denied", status_code=403, code="clover_forbidden")
        if "/merchants/merchant/refunds?" in path:
            raise CloverRequestError("refund denied", status_code=401, code="clover_unauthorized")
        raise AssertionError(path)

    monkeypatch.setattr("backend.clover_orders.clover_request", fake_request)
    with caplog.at_level("WARNING", logger="backend.clover_orders"):
        orders, complete = CloverOrderClient(merchant_id="merchant", token="token").fetch_orders(
            start=datetime.now(timezone.utc) - timedelta(days=1),
            end=datetime.now(timezone.utc) + timedelta(minutes=1),
        )
    assert complete is True and len(orders) == 1
    messages = [record.getMessage() for record in caplog.records]
    assert any("operation=line_items" in message and "handled=True" in message for message in messages)
    assert any("operation=order_payments" in message and "status=403" in message and "handled=True" in message for message in messages)
    assert any("operation=merchant_refunds" in message and "status=401" in message and "handled=True" in message for message in messages)
