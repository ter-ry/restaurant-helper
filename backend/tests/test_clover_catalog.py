from __future__ import annotations

import pytest

from backend.clover import CloverRequestError
from backend.clover_catalog import (
    CloverCatalogClient,
    CloverCatalogDisabled,
    normalize_catalog,
)


def test_catalog_gate_is_opt_in(monkeypatch):
    monkeypatch.delenv("CLOVER_CATALOG_ENABLED", raising=False)
    with pytest.raises(CloverCatalogDisabled):
        CloverCatalogClient(merchant_id="merchant-1", token="token").fetch_snapshot()


def test_normalizes_duplicate_names_with_distinct_ids_and_modifiers():
    snapshot = normalize_catalog(
        merchant={
            "id": "merchant-1",
            "name": "Sandbox Cafe",
            "address": {"id": "loc-1", "name": "Main"},
        },
        categories=[
            {"id": "cat-1", "name": "Breakfast"},
            {"id": "cat-2", "name": "Breakfast"},
        ],
        modifier_groups=[
            {
                "id": "group-1",
                "name": "Milk",
                "modifiers": {
                    "elements": [{"id": "mod-1", "name": "Oat", "price": 50}],
                },
            }
        ],
        items=[
            {
                "id": "item-1",
                "name": "Latte",
                "price": 500,
                "categories": {"elements": [{"id": "cat-1", "name": "Breakfast"}]},
                "modifierGroups": {"elements": [{"id": "group-1", "name": "Milk"}]},
                "itemGroupItems": {
                    "elements": [
                        {"id": "variation-1", "name": "12 oz", "price": 500},
                    ]
                },
            },
            {
                "id": "item-2",
                "name": "Latte",
                "price": 600,
                "categories": {"elements": [{"id": "cat-2", "name": "Breakfast"}]},
            },
            {"id": "item-2", "name": "Duplicate", "price": 999},
        ],
    )
    assert [item.provider_id for item in snapshot.items] == ["item-1", "item-2"]
    assert [item.name for item in snapshot.items] == ["Latte", "Latte"]
    assert snapshot.items[0].variations[0].provider_id == "variation-1"
    assert snapshot.items[0].modifier_groups[0].modifiers[0].price_cents == 50
    assert [category.provider_id for category in snapshot.categories] == ["cat-1", "cat-2"]
    assert snapshot.location is not None
    assert snapshot.location.provider_id == "loc-1"


def test_missing_fields_deleted_items_and_optional_location_are_safe():
    snapshot = normalize_catalog(
        merchant={"id": "m", "name": "Cafe"},
        items=[
            {"id": "item-1", "name": None, "hidden": True},
            {"id": "item-2", "name": "Archived", "deleted": True},
            {"name": "no-id"},
        ],
    )
    assert snapshot.location is None
    assert snapshot.items[0].name == "(Unnamed item)"
    assert snapshot.items[0].active is False
    assert snapshot.items[1].active is False
    assert len(snapshot.items) == 2


def test_client_pages_resources_and_preserves_read_only_request(monkeypatch):
    responses = {
        "/v3/merchants/merchant-1": {"id": "merchant-1", "name": "Cafe"},
        "/v3/merchants/merchant-1/categories?offset=0&limit=2": {
            "elements": [
                {"id": "cat-1", "name": "Breakfast"},
                {"id": "cat-2", "name": "Lunch"},
            ]
        },
        "/v3/merchants/merchant-1/categories?offset=2&limit=2": {
            "elements": [{"id": "cat-3", "name": "Dinner"}]
        },
        "/v3/merchants/merchant-1/modifier_groups?offset=0&limit=2": {
            "elements": [{"id": "group-1", "name": "Milk"}]
        },
        "/v3/merchants/merchant-1/items?expand=categories,modifierGroups&offset=0&limit=2": {
            "elements": [
                {"id": "item-1", "name": "Latte"},
                {"id": "item-2", "name": "Tea"},
            ]
        },
        "/v3/merchants/merchant-1/items?expand=categories,modifierGroups&offset=2&limit=2": {
            "elements": [{"id": "item-3", "name": "Soup"}]
        },
    }
    calls = []

    def request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        return responses[path]

    monkeypatch.setenv("CLOVER_CATALOG_ENABLED", "true")
    snapshot = CloverCatalogClient(
        merchant_id="merchant-1",
        token="token",
        requester=request,
        page_size=2,
    ).fetch_snapshot()
    assert snapshot.merchant_id == "merchant-1"
    assert [item.provider_id for item in snapshot.items] == ["item-1", "item-2", "item-3"]
    assert [category.provider_id for category in snapshot.categories] == ["cat-1", "cat-2", "cat-3"]
    assert all(method == "GET" for method, _, _ in calls)
    assert all("limit=2" in path for _, path, _ in calls if "?" in path)
    assert all(kwargs["token"] == "token" for _, _, kwargs in calls)
    assert len(calls) == 6


def test_client_requires_explicit_provider_identity_and_does_not_call_requester(monkeypatch):
    calls = []

    def request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        return {}

    monkeypatch.setenv("CLOVER_CATALOG_ENABLED", "true")
    with pytest.raises(CloverRequestError):
        CloverCatalogClient(merchant_id="", token="token", requester=request).fetch_snapshot()
    with pytest.raises(CloverRequestError):
        CloverCatalogClient(merchant_id="merchant-1", token="", requester=request).fetch_snapshot()
    assert calls == []


@pytest.mark.parametrize("status_code", [429, 500, 504])
def test_provider_failures_remain_safe_and_never_write(monkeypatch, status_code):
    def request(method, path, **kwargs):
        assert method == "GET"
        raise CloverRequestError(
            "provider unavailable",
            status_code=status_code,
            code="clover_request_failed",
        )

    client = CloverCatalogClient(
        merchant_id="merchant-1",
        token="token",
        requester=request,
    )
    monkeypatch.setenv("CLOVER_CATALOG_ENABLED", "true")
    with pytest.raises(CloverRequestError) as error:
        client.fetch_snapshot()
    assert error.value.status_code == status_code
