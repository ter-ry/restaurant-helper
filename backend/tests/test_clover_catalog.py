from __future__ import annotations

import pytest

from backend.clover import CloverRequestError
from backend.clover_catalog import (
    CloverCatalogClient,
    CloverCatalogDisabled,
    CloverCatalogIncomplete,
    normalize_catalog,
)


def test_catalog_gate_is_opt_in(monkeypatch):
    monkeypatch.delenv("CLOVER_CATALOG_ENABLED", raising=False)
    with pytest.raises(CloverCatalogDisabled):
        CloverCatalogClient(merchant_id="merchant-1", token="token").fetch_snapshot()


def test_item_groups_preserve_item_and_option_associations_without_fake_variants():
    snapshot = normalize_catalog(
        merchant={
            "id": "merchant-1",
            "name": "Sandbox Cafe",
            "address": {"street1": "1 Main St", "zip": "M5V 1A1"},
            "location": {"id": "location-1", "name": "Main"},
        },
        item_groups=[
            {
                "id": "group-1",
                "name": "T-shirt",
                "items": {"elements": [{"id": "item-1"}, {"id": "item-2"}]},
                "attributes": {"elements": [{"id": "attribute-size"}]},
            }
        ],
        items=[
            {
                "id": "item-1",
                "name": "T-shirt / Small",
                "price": 500,
                "itemGroup": {"id": "group-1"},
                "options": {"elements": [{"id": "option-small"}]},
                "available": False,
                "itemGroupItems": {"elements": [{"id": "invented-variant"}]},
            },
            {
                "id": "item-2",
                "name": "T-shirt / Large",
                "price": 600,
                "itemGroup": {"id": "group-1"},
                "options": {"elements": [{"id": "option-large"}]},
            },
        ],
    )
    assert snapshot.location is not None
    assert snapshot.location.provider_id == "location-1"
    assert snapshot.item_groups[0].item_ids == ("item-1", "item-2")
    assert snapshot.item_groups[0].attribute_ids == ("attribute-size",)
    assert snapshot.items[0].item_group_id == "group-1"
    assert snapshot.items[0].option_ids == ("option-small",)
    assert snapshot.items[0].available is False
    assert snapshot.items[0].hidden is False
    assert snapshot.items[0].variations == ()
    assert snapshot.items[0].raw["itemGroupItems"]


def test_modifier_expansion_and_duplicate_names_are_preserved_by_id():
    snapshot = normalize_catalog(
        merchant={"id": "merchant-1", "name": "Sandbox Cafe"},
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
            {"id": "item-2", "name": "Latte", "price": 600},
            {"id": "item-2", "name": "Duplicate", "price": 999},
        ],
    )
    assert [item.provider_id for item in snapshot.items] == ["item-1", "item-2"]
    assert [item.name for item in snapshot.items] == ["Latte", "Latte"]
    assert snapshot.items[0].modifier_groups[0].modifiers[0].price_cents == 50
    assert [category.provider_id for category in snapshot.categories] == ["cat-1", "cat-2"]


def test_missing_fields_deleted_items_and_address_without_location_are_safe():
    snapshot = normalize_catalog(
        merchant={
            "id": "merchant-1",
            "name": "Cafe",
            "address": {"street1": "1 Main St", "zip": "M5V 1A1"},
        },
        items=[
            {"id": "item-1", "name": None, "hidden": True},
            {"id": "item-2", "name": "Archived", "deletedTime": 1700000000000},
            {"id": "item-3", "name": "Unavailable", "available": False},
            {"name": "no-id"},
        ],
    )
    assert snapshot.location is None
    assert snapshot.merchant_address["street1"] == "1 Main St"
    assert [item.provider_id for item in snapshot.items] == ["item-1", "item-2", "item-3"]
    assert snapshot.items[0].active is True and snapshot.items[0].hidden is True
    assert snapshot.items[0].deleted is False
    assert snapshot.items[1].active is False and snapshot.items[1].deleted is True
    assert snapshot.items[2].active is True and snapshot.items[2].available is False


def test_client_pages_resources_with_expansion_and_preserves_get_only_request(monkeypatch):
    responses = {
        "/v3/merchants/merchant-1": {"id": "merchant-1", "name": "Cafe"},
        "/v3/merchants/merchant-1/categories?offset=0&limit=2": {
            "elements": [{"id": "cat-1"}, {"id": "cat-2"}]
        },
        "/v3/merchants/merchant-1/categories?offset=2&limit=2": {
            "elements": [{"id": "cat-3"}]
        },
        "/v3/merchants/merchant-1/modifier_groups?expand=modifiers&offset=0&limit=2": {
            "elements": [{"id": "group-1", "modifiers": {"elements": []}}]
        },
        "/v3/merchants/merchant-1/item_groups?expand=items,attributes&offset=0&limit=2": {
            "elements": [
                {"id": "item-group-1", "items": {"elements": []}, "attributes": {"elements": []}},
                {"id": "item-group-2", "items": {"elements": []}, "attributes": {"elements": []}},
            ]
        },
        "/v3/merchants/merchant-1/item_groups?expand=items,attributes&offset=2&limit=2": {
            "elements": [{"id": "item-group-3", "items": {"elements": []}, "attributes": {"elements": []}}]
        },
        "/v3/merchants/merchant-1/items?expand=categories,modifierGroups,options&offset=0&limit=2": {
            "elements": [{"id": "item-1", "name": "Latte"}, {"id": "item-2", "name": "Tea"}]
        },
        "/v3/merchants/merchant-1/items?expand=categories,modifierGroups,options&offset=2&limit=2": {
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
    assert [group.provider_id for group in snapshot.item_groups] == [
        "item-group-1",
        "item-group-2",
        "item-group-3",
    ]
    assert [item.provider_id for item in snapshot.items] == ["item-1", "item-2", "item-3"]
    item_request_paths = [path for _, path, _ in calls if "/items?" in path]
    assert item_request_paths and all("expand=categories,modifierGroups,options" in path for path in item_request_paths)
    assert all(method == "GET" for method, _, _ in calls)
    assert all(kwargs["token"] == "token" for _, _, kwargs in calls)
    assert len(calls) == 8


@pytest.mark.parametrize("merchant_payload, error_code", [
    ({"name": "missing-id"}, "clover_merchant_identity_missing"),
    ({"id": "other-merchant", "name": "wrong"}, "clover_merchant_identity_mismatch"),
])
def test_client_rejects_missing_or_mismatched_merchant_identity(
    monkeypatch, merchant_payload, error_code
):
    def request(method, path, **kwargs):
        return merchant_payload

    monkeypatch.setenv("CLOVER_CATALOG_ENABLED", "true")
    with pytest.raises(CloverRequestError) as error:
        CloverCatalogClient(
            merchant_id="merchant-1",
            token="token",
            requester=request,
        ).fetch_snapshot()
    assert error.value.code == error_code


def test_page_bound_never_returns_an_exact_limit_as_complete(monkeypatch):
    def request(method, path, **kwargs):
        if path.endswith("/merchant-1"):
            return {"id": "merchant-1"}
        return {"elements": [{"id": "x"}, {"id": "y"}]}

    monkeypatch.setenv("CLOVER_CATALOG_ENABLED", "true")
    with pytest.raises(CloverCatalogIncomplete):
        CloverCatalogClient(
            merchant_id="merchant-1",
            token="token",
            requester=request,
            page_size=2,
            max_pages=1,
        ).fetch_snapshot()


def test_page_bound_rejects_multiple_full_pages(monkeypatch):
    def request(method, path, **kwargs):
        if path.endswith("/merchant-1"):
            return {"id": "merchant-1"}
        return {"elements": [{"id": f"{path}-1"}, {"id": f"{path}-2"}]}

    monkeypatch.setenv("CLOVER_CATALOG_ENABLED", "true")
    with pytest.raises(CloverCatalogIncomplete):
        CloverCatalogClient(
            merchant_id="merchant-1",
            token="token",
            requester=request,
            page_size=2,
            max_pages=2,
        ).fetch_snapshot()


def test_nested_expansion_limit_is_explicitly_incomplete(monkeypatch):
    def request(method, path, **kwargs):
        if path.endswith("/merchant-1"):
            return {"id": "merchant-1"}
        if "modifier_groups" in path:
            return {"elements": [{"id": "group-1", "modifiers": {"elements": [{"id": str(i)} for i in range(100)]}}]}
        return {"elements": []}

    monkeypatch.setenv("CLOVER_CATALOG_ENABLED", "true")
    with pytest.raises(CloverCatalogIncomplete):
        CloverCatalogClient(
            merchant_id="merchant-1",
            token="token",
            requester=request,
        ).fetch_snapshot()


def test_client_requires_explicit_provider_identity_and_never_calls_requester(monkeypatch):
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
        raise CloverRequestError("provider unavailable", status_code=status_code, code="clover_request_failed")

    client = CloverCatalogClient(
        merchant_id="merchant-1",
        token="token",
        requester=request,
    )
    monkeypatch.setenv("CLOVER_CATALOG_ENABLED", "true")
    with pytest.raises(CloverRequestError) as error:
        client.fetch_snapshot()
    assert error.value.status_code == status_code
