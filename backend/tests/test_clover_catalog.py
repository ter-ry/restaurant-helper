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
    assert snapshot.items[0].modifier_groups[0].modifiers[0].price_cents == 50
    assert [category.provider_id for category in snapshot.categories] == ["cat-1", "cat-2"]


def test_missing_fields_and_inactive_items_are_safe():
    snapshot = normalize_catalog(
        merchant={"id": "m", "name": "Cafe"},
        items=[{"id": "item-1", "name": None, "hidden": True}, {"name": "no-id"}],
    )
    assert snapshot.items[0].name == "(Unnamed item)"
    assert snapshot.items[0].active is False
    assert len(snapshot.items) == 1


def test_client_pages_items_and_preserves_read_only_request(monkeypatch):
    responses = {
        "/v3/merchants/merchant-1": {"id": "merchant-1", "name": "Cafe"},
        "/v3/merchants/merchant-1/categories?offset=0&limit=2": {
            "elements": [{"id": "cat-1", "name": "Breakfast"}]
        },
        "/v3/merchants/merchant-1/modifier_groups?offset=0&limit=2": {
            "elements": [{"id": "group-1", "name": "Milk"}]
        },
        "/v3/merchants/merchant-1/items?expand=categories,modifierGroups&offset=0&limit=2": {
            "elements": [{"id": "item-1", "name": "Latte"}]
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
    assert snapshot.items[0].provider_id == "item-1"
    assert all(method == "GET" for method, _, _ in calls)
    assert all("limit=2" in path for _, path, _ in calls if "?" in path)
    assert all(kwargs["token"] == "token" for _, _, kwargs in calls)


def test_provider_failures_remain_safe_and_do_not_write(monkeypatch):
    def request(method, path, **kwargs):
        assert method == "GET"
        raise CloverRequestError(
            "rate limited",
            status_code=429,
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
    assert error.value.status_code == 429
