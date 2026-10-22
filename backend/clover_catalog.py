"""Read-only Clover catalog foundation.

This module deliberately stops at provider normalization. It does not persist
provider objects, create mappings, enqueue sync work, or touch inventory.
"""
from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import urlencode

from .clover import CloverRequestError, clover_request


class CloverCatalogDisabled(RuntimeError):
    """Raised when the opt-in catalog feature gate is disabled."""


@dataclass(frozen=True)
class CloverCatalogVariation:
    provider_id: str
    name: str
    price_cents: int | None
    active: bool
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class CloverCatalogCategory:
    provider_id: str
    name: str
    active: bool
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class CloverCatalogModifier:
    provider_id: str
    name: str
    price_cents: int | None
    active: bool
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class CloverCatalogModifierGroup:
    provider_id: str
    name: str
    active: bool
    modifiers: tuple[CloverCatalogModifier, ...]
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class CloverCatalogItem:
    provider_id: str
    name: str
    active: bool
    price_cents: int | None
    categories: tuple[CloverCatalogCategory, ...]
    variations: tuple[CloverCatalogVariation, ...]
    modifier_groups: tuple[CloverCatalogModifierGroup, ...]
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class CloverCatalogLocation:
    provider_id: str
    name: str
    address: Mapping[str, Any]
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class CloverCatalogSnapshot:
    merchant_id: str
    merchant_name: str
    location: CloverCatalogLocation | None
    categories: tuple[CloverCatalogCategory, ...]
    modifier_groups: tuple[CloverCatalogModifierGroup, ...]
    items: tuple[CloverCatalogItem, ...]


Requester = Callable[..., Mapping[str, Any]]


def clover_catalog_enabled() -> bool:
    """Return the explicit opt-in gate; it is false unless configured."""
    return os.environ.get("CLOVER_CATALOG_ENABLED", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _text(value: Any) -> str:
    return str(value or "").strip()


def _identifier(payload: Mapping[str, Any]) -> str:
    return _text(payload.get("id") or payload.get("uuid") or payload.get("merchantId"))


def _active(payload: Mapping[str, Any]) -> bool:
    return not bool(payload.get("deleted") or payload.get("isDeleted") or payload.get("hidden"))


def _price_cents(payload: Mapping[str, Any]) -> int | None:
    value = payload.get("price")
    if value is None:
        value = payload.get("priceInCents")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _elements(payload: Any) -> list[Mapping[str, Any]]:
    if isinstance(payload, Mapping):
        values = payload.get("elements")
        if values is None:
            values = payload.get("data")
        if values is None:
            values = payload.get("items")
        return [item for item in values or [] if isinstance(item, Mapping)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, Mapping)]
    return []


def _dedupe_by_id(values: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    seen: set[str] = set()
    result: list[Mapping[str, Any]] = []
    for value in values:
        identifier = _identifier(value)
        if not identifier or identifier in seen:
            continue
        seen.add(identifier)
        result.append(value)
    return result


def normalize_category(payload: Mapping[str, Any]) -> CloverCatalogCategory | None:
    identifier = _identifier(payload)
    if not identifier:
        return None
    return CloverCatalogCategory(
        provider_id=identifier,
        name=_text(payload.get("name")) or "(Unnamed category)",
        active=_active(payload),
        raw=dict(payload),
    )


def normalize_modifier(payload: Mapping[str, Any]) -> CloverCatalogModifier | None:
    identifier = _identifier(payload)
    if not identifier:
        return None
    return CloverCatalogModifier(
        provider_id=identifier,
        name=_text(payload.get("name")) or "(Unnamed modifier)",
        price_cents=_price_cents(payload),
        active=_active(payload),
        raw=dict(payload),
    )


def normalize_modifier_group(payload: Mapping[str, Any]) -> CloverCatalogModifierGroup | None:
    identifier = _identifier(payload)
    if not identifier:
        return None
    modifiers = tuple(
        modifier
        for modifier in (
            normalize_modifier(item)
            for item in _elements(payload.get("modifiers") or payload.get("modifierItems") or {})
        )
        if modifier is not None
    )
    return CloverCatalogModifierGroup(
        provider_id=identifier,
        name=_text(payload.get("name")) or "(Unnamed modifier group)",
        active=_active(payload),
        modifiers=modifiers,
        raw=dict(payload),
    )


def normalize_item(
    payload: Mapping[str, Any],
    *,
    categories: Mapping[str, CloverCatalogCategory] | None = None,
    modifier_groups: Mapping[str, CloverCatalogModifierGroup] | None = None,
) -> CloverCatalogItem | None:
    identifier = _identifier(payload)
    if not identifier:
        return None
    item_categories = tuple(
        category
        for category in (
            normalize_category(item) for item in _elements(payload.get("categories") or {})
        )
        if category is not None
    )
    item_groups = tuple(
        group
        for group in (
            normalize_modifier_group(item)
            for item in _elements(payload.get("modifierGroups") or payload.get("modifier_groups") or {})
        )
        if group is not None
    )
    if categories:
        item_categories = tuple(categories.get(item.provider_id, item) for item in item_categories)
    if modifier_groups:
        item_groups = tuple(modifier_groups.get(item.provider_id, item) for item in item_groups)

    variations = tuple(
        CloverCatalogVariation(
            provider_id=_identifier(item),
            name=_text(item.get("name")) or "(Unnamed variation)",
            price_cents=_price_cents(item),
            active=_active(item),
            raw=dict(item),
        )
        for item in _elements(payload.get("itemGroupItems") or payload.get("variations") or {})
        if _identifier(item)
    )
    return CloverCatalogItem(
        provider_id=identifier,
        name=_text(payload.get("name")) or "(Unnamed item)",
        active=_active(payload),
        price_cents=_price_cents(payload),
        categories=item_categories,
        variations=variations,
        modifier_groups=item_groups,
        raw=dict(payload),
    )


def normalize_catalog(
    *,
    merchant: Mapping[str, Any],
    items: Iterable[Mapping[str, Any]],
    categories: Iterable[Mapping[str, Any]] = (),
    modifier_groups: Iterable[Mapping[str, Any]] = (),
) -> CloverCatalogSnapshot:
    normalized_categories = tuple(
        category
        for category in (
            normalize_category(value) for value in _dedupe_by_id(categories)
        )
        if category is not None
    )
    normalized_groups = tuple(
        group
        for group in (
            normalize_modifier_group(value) for value in _dedupe_by_id(modifier_groups)
        )
        if group is not None
    )
    category_map = {value.provider_id: value for value in normalized_categories}
    group_map = {value.provider_id: value for value in normalized_groups}
    normalized_items = tuple(
        item
        for item in (
            normalize_item(value, categories=category_map, modifier_groups=group_map)
            for value in _dedupe_by_id(items)
        )
        if item is not None
    )
    address = merchant.get("address") or merchant.get("location") or {}
    location = None
    if isinstance(address, Mapping) and (_identifier(address) or address):
        location = CloverCatalogLocation(
            provider_id=_identifier(address) or _identifier(merchant),
            name=_text(address.get("name") or merchant.get("name")) or "(Unnamed location)",
            address=dict(address),
            raw=dict(address),
        )
    return CloverCatalogSnapshot(
        merchant_id=_identifier(merchant),
        merchant_name=_text(merchant.get("name") or merchant.get("label")),
        location=location,
        categories=normalized_categories,
        modifier_groups=normalized_groups,
        items=normalized_items,
    )


class CloverCatalogClient:
    """Read-only Clover v3 catalog client.

    The requester is injectable so all tests use fixtures. The production
    requester is the existing GET-only-safe clover_request boundary.
    """

    def __init__(
        self,
        *,
        merchant_id: str,
        token: str,
        requester: Requester = clover_request,
        page_size: int = 100,
        max_pages: int = 100,
    ):
        self.merchant_id = _text(merchant_id)
        self.token = _text(token)
        self.requester = requester
        self.page_size = max(1, min(int(page_size), 1000))
        self.max_pages = max(1, int(max_pages))

    def _get(self, path: str) -> Mapping[str, Any]:
        if not self.merchant_id or not self.token:
            raise CloverRequestError(
                "Clover catalog identity is incomplete.",
                code="clover_catalog_identity_missing",
            )
        return self.requester("GET", path, token=self.token)

    def _paged(self, resource: str) -> list[Mapping[str, Any]]:
        values: list[Mapping[str, Any]] = []
        for page in range(self.max_pages):
            offset = page * self.page_size
            separator = "&" if "?" in resource else "?"
            query = urlencode({"offset": offset, "limit": self.page_size})
            payload = self._get(
                f"/v3/merchants/{self.merchant_id}/{resource}{separator}{query}"
            )
            page_values = _elements(payload)
            values.extend(page_values)
            if len(page_values) < self.page_size:
                break
        return _dedupe_by_id(values)

    def fetch_snapshot(self) -> CloverCatalogSnapshot:
        if not clover_catalog_enabled():
            raise CloverCatalogDisabled("Clover catalog integration is disabled.")
        merchant = self._get(f"/v3/merchants/{self.merchant_id}")
        categories = self._paged("categories")
        modifier_groups = self._paged("modifier_groups")
        items = self._paged("items?expand=categories,modifierGroups")
        return normalize_catalog(
            merchant=merchant,
            items=items,
            categories=categories,
            modifier_groups=modifier_groups,
        )
