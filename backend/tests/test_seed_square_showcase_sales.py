from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError

import pytest

from scripts.seed_square_showcase_sales import (
    Identity,
    SquareClient,
    SquareShowcaseError,
    TARGET_VARIATION,
    Variation,
    _order_payload,
    _reference_id,
    _square_error_metadata,
    discover_variation,
    plans,
    seed_sales,
    verify_identity,
)
from scripts.seed_square_showcase_sales import main


class FakeResponse:
    status = 200

    def __init__(self, payload):
        self.payload = payload
        self.headers = {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


class FakeSquare:
    def __init__(self):
        self.calls = []
        self.orders = {}
        self.next_id = 1

    def __call__(self, request, timeout=30):
        method = request.method
        path = request.full_url.removeprefix("https://connect.squareup.com")
        body = json.loads(request.data.decode()) if request.data else None
        self.calls.append((method, path, body))
        if path.startswith("/v2/merchants/"):
            merchant_id = path.rsplit("/", 1)[-1]
            return FakeResponse({"merchant": {"id": "MERCHANT" if merchant_id == "MERCHANT" else "OTHER"}})
        if path == "/v2/locations/LOCATION":
            return FakeResponse({"location": {"id": "LOCATION", "name": "Flowtally"}})
        if path.startswith("/v2/catalog/list"):
            return FakeResponse({"objects": [
                {"type": "ITEM", "id": "ITEM", "item_data": {"name": "Flowtally Test Burger"}},
                {"type": "ITEM_VARIATION", "id": "VARIATION", "item_variation_data": {"item_id": "ITEM", "name": "Base", "price_money": {"amount": 1800, "currency": "CAD"}}},
            ]})
        if path.startswith("/v2/orders/") and method == "GET":
            order_id = path.rsplit("/", 1)[-1]
            return FakeResponse({"order": self.orders.get(order_id, {"id": order_id, "state": "OPEN"})})
        if path == "/v2/orders" and method == "POST":
            order_id = f"ORDER-{self.next_id}"
            self.next_id += 1
            self.orders[order_id] = {"id": order_id, "state": "OPEN"}
            return FakeResponse({"order": {"id": order_id, "state": "OPEN"}})
        if path == "/v2/payments":
            return FakeResponse({"payment": {"id": f"PAYMENT-{self.next_id}"}})
        if path.startswith("/v2/orders/") and path.endswith("/pay"):
            order_id = path.split("/")[3]
            self.orders[order_id]["state"] = "COMPLETED"
            return FakeResponse({"order": {"id": order_id, "state": "COMPLETED"}})
        raise AssertionError((method, path, body))


def client(fake):
    return SquareClient("token-is-never-printed", opener=fake)


def test_identity_and_exact_catalog_variation():
    fake = FakeSquare()
    identity = verify_identity(client(fake), merchant_id="MERCHANT", location_id="LOCATION", location_name="Flowtally")
    variation = discover_variation(client(fake))
    assert identity == Identity("MERCHANT", "LOCATION", "Flowtally")
    assert variation == Variation("VARIATION", TARGET_VARIATION, 1800, "CAD")


def test_wrong_identity_is_rejected():
    fake = FakeSquare()
    with pytest.raises(SquareShowcaseError, match="merchant identity"):
        verify_identity(client(fake), merchant_id="WRONG", location_id="LOCATION", location_name="Flowtally")


def test_square_location_name_mismatch_is_rejected():
    fake = FakeSquare()
    with pytest.raises(SquareShowcaseError, match="location name"):
        verify_identity(client(fake), merchant_id="MERCHANT", location_id="LOCATION", location_name="Harbour Kitchen")


def test_default_and_max_order_guardrails():
    assert [plan.quantity for plan in plans(1)] == [1]
    assert plans(3)[1].tip_percent == 15
    assert plans(3)[2].discount_percent == 10
    assert len(plans(5)) == 5
    with pytest.raises(SquareShowcaseError):
        plans(6)


def test_dry_run_never_calls_write_endpoints(tmp_path: Path):
    fake = FakeSquare()
    result = seed_sales(client(fake), fixture_name="test-fixture", identity=Identity("MERCHANT", "LOCATION", "Flowtally"), variation=Variation("VARIATION", TARGET_VARIATION, 1800, "CAD"), order_count=1, manifest_path=tmp_path / "manifest.json", dry_run=True)
    assert result["writes"] is False
    assert result["paymentType"] == "CASH"
    assert result["plannedTotals"]["totalBurgerQuantity"] == 1
    assert "Flowtally sync will consume" in result["inventoryWarning"]
    assert not [call for call in fake.calls if call[0] == "POST"]
    assert not (tmp_path / "manifest.json").exists()


def test_order_payload_keeps_catalog_variation_and_discount():
    payload = _order_payload(plans(3)[2], Variation("VARIATION", TARGET_VARIATION, 1800, "CAD"), "fixture", "LOCATION")
    assert payload["line_items"] == [{"catalog_object_id": "VARIATION", "quantity": "1"}]
    assert payload["discounts"][0]["percentage"] == "10"
    assert payload["location_id"] == "LOCATION"
    assert len(payload["reference_id"]) <= 40


def test_reference_id_is_deterministic_distinct_and_bounded():
    first = _reference_id("alpha-video-2026-10", 1)
    assert first == _reference_id("alpha-video-2026-10", 1)
    assert len(first) <= 40
    assert first != _reference_id("alpha-video-2026-10", 2)
    assert first != _reference_id("different-fixture", 1)
    assert len(_reference_id("x" * 500, 1)) <= 40
    assert _order_payload(plans(1)[0], Variation("VARIATION", TARGET_VARIATION, 1800, "CAD"), "alpha-video-2026-10", "LQ5R7NF4W2MTZ")["reference_id"] == _reference_id("alpha-video-2026-10", 1)


def test_square_error_metadata_is_structured_and_sanitized():
    metadata = _square_error_metadata(json.dumps({"errors": [{"category": "INVALID_REQUEST_ERROR", "code": "INVALID_VALUE", "detail": "reference_id is too long"}]}))
    assert metadata == "category=INVALID_REQUEST_ERROR code=INVALID_VALUE detail=reference_id is too long"
    assert "secret-value" not in (_square_error_metadata(json.dumps({"errors": [{"category": "INVALID_REQUEST_ERROR", "detail": "Bearer secret-value"}]})) or "")


def test_completed_sequence_and_safe_manifest_idempotency(tmp_path: Path):
    fake = FakeSquare()
    kwargs = dict(fixture_name="test-fixture", identity=Identity("MERCHANT", "LOCATION", "Flowtally"), variation=Variation("VARIATION", TARGET_VARIATION, 1800, "CAD"), order_count=3, manifest_path=tmp_path / "manifest.json", confirm_inventory_reviewed=True)
    first = seed_sales(client(fake), dry_run=False, **kwargs)
    assert [entry["status"] for entry in first["orders"]] == ["completed"] * 3
    assert [call[1] for call in fake.calls if call[0] == "POST"] == ["/v2/orders", "/v2/payments", "/v2/orders/ORDER-1/pay", "/v2/orders", "/v2/payments", "/v2/orders/ORDER-2/pay", "/v2/orders", "/v2/payments", "/v2/orders/ORDER-3/pay"]
    payment_request = next(body for method, path, body in fake.calls if method == "POST" and path == "/v2/payments")
    assert payment_request["source_id"] == "CASH"
    assert payment_request["autocomplete"] is False
    assert payment_request["amount_money"] == {"amount": 1800, "currency": "CAD"}
    assert payment_request["tip_money"] == {"amount": 0, "currency": "CAD"}
    assert payment_request["order_id"] == "ORDER-1"
    assert payment_request["location_id"] == "LOCATION"
    assert payment_request["cash_details"]["buyer_supplied_money"] == {"amount": 1800, "currency": "CAD"}
    assert "buyer_tendered_money" not in payment_request["cash_details"]
    assert "change_back_money" not in payment_request["cash_details"]
    first_totals = first["completedTotals"]
    manifest_before = json.loads((tmp_path / "manifest.json").read_text())
    post_count = len([call for call in fake.calls if call[0] == "POST"])
    second = seed_sales(client(fake), dry_run=False, **kwargs)
    assert [entry["status"] for entry in second["orders"]] == ["completed"] * 3
    assert second["completedTotals"] == first_totals
    assert len([call for call in fake.calls if call[0] == "POST"]) == post_count
    assert json.loads((tmp_path / "manifest.json").read_text()) == manifest_before


def test_single_order_completed_totals_are_reported_and_reused(tmp_path: Path):
    fake = FakeSquare()
    kwargs = dict(
        fixture_name="single-order",
        identity=Identity("MERCHANT", "LOCATION", "Flowtally"),
        variation=Variation("VARIATION", TARGET_VARIATION, 1800, "CAD"),
        order_count=1,
        manifest_path=tmp_path / "manifest.json",
    )
    first = seed_sales(client(fake), dry_run=False, **kwargs)
    expected = {
        "orderCount": 1,
        "totalBurgerQuantity": 1,
        "grossAmount": {"amount": 1800, "currency": "CAD"},
        "discountAmount": {"amount": 0, "currency": "CAD"},
        "tipAmount": {"amount": 0, "currency": "CAD"},
        "finalTotal": {"amount": 1800, "currency": "CAD"},
    }
    assert first["completedTotals"] == expected
    manifest_before = json.loads((tmp_path / "manifest.json").read_text())
    post_count = len([call for call in fake.calls if call[0] == "POST"])
    second = seed_sales(client(fake), dry_run=False, **kwargs)
    assert second["completedTotals"] == expected
    assert second["orders"][0]["status"] == "completed"
    assert len([call for call in fake.calls if call[0] == "POST"]) == post_count
    assert json.loads((tmp_path / "manifest.json").read_text()) == manifest_before


def test_larger_fixture_requires_inventory_review_confirmation(tmp_path: Path):
    fake = FakeSquare()
    kwargs = dict(fixture_name="test-fixture", identity=Identity("MERCHANT", "LOCATION", "Flowtally"), variation=Variation("VARIATION", TARGET_VARIATION, 1800, "CAD"), order_count=3, manifest_path=tmp_path / "manifest.json", dry_run=True)
    with pytest.raises(SquareShowcaseError, match="inventory-reviewed"):
        seed_sales(client(fake), **kwargs)
    result = seed_sales(client(fake), confirm_inventory_reviewed=True, **kwargs)
    assert result["plannedTotals"]["totalBurgerQuantity"] == 4


def test_manifest_never_contains_token(tmp_path: Path):
    fake = FakeSquare()
    seed_sales(client(fake), fixture_name="safe-fixture", identity=Identity("MERCHANT", "LOCATION", "Flowtally"), variation=Variation("VARIATION", TARGET_VARIATION, 1800, "CAD"), order_count=1, manifest_path=tmp_path / "manifest.json", dry_run=False)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    order = manifest["orders"]["1"]
    assert manifest["paymentType"] == "CASH"
    assert manifest["plannedTotals"]["totalBurgerQuantity"] == 1
    assert {"fixtureName", "orderNumber", "quantity", "squareOrderId", "paymentId", "grossAmount", "discountAmount", "tipAmount", "finalTotal", "currency", "catalogVariationId", "squareLocationId", "paymentType", "status"}.issubset(order)
    assert "token-is-never-printed" not in json.dumps(manifest)


def test_missing_token_is_a_safe_cli_failure(monkeypatch):
    monkeypatch.delenv("SQUARE_SHOWCASE_ACCESS_TOKEN", raising=False)
    assert main(["--environment", "production", "--fixture-name", "fixture", "--dry-run"]) == 2


def test_production_write_requires_explicit_confirmation(monkeypatch):
    monkeypatch.setenv("SQUARE_SHOWCASE_ACCESS_TOKEN", "temporary-token")
    assert main(["--environment", "production", "--fixture-name", "fixture"]) == 2


def test_square_http_failure_does_not_expose_token():
    class Body:
        def read(self):
            return b'{"message":"temporary-token leaked by provider"}'

        def close(self):
            return None

    def failing(request, timeout=30):
        raise HTTPError(request.full_url, 401, "Unauthorized", {"x-square-request-id": "safe-request-id"}, Body())

    with pytest.raises(SquareShowcaseError) as raised:
        SquareClient("temporary-token", opener=failing).request("GET", "/v2/locations/LOCATION")
    assert "temporary-token" not in str(raised.value)
    assert raised.value.status == 401
    assert raised.value.request_id == "safe-request-id"


def test_square_http_failure_includes_safe_structured_metadata():
    class Body:
        def read(self):
            return b'{"errors":[{"category":"INVALID_REQUEST_ERROR","code":"INVALID_VALUE","detail":"reference_id is too long"}]}'

        def close(self):
            return None

    def failing(request, timeout=30):
        raise HTTPError(request.full_url, 400, "Bad Request", {"x-square-request-id": "safe-400-id"}, Body())

    with pytest.raises(SquareShowcaseError) as raised:
        SquareClient("temporary-token", opener=failing).request("POST", "/v2/orders", {})
    assert raised.value.status == 400
    assert raised.value.request_id == "safe-400-id"
    assert "code=INVALID_VALUE" in str(raised.value)
    assert "reference_id is too long" in str(raised.value)
