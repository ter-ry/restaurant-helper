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


class CloverCatalogIncomplete(RuntimeError):
    """Raised when a bounded response cannot be proven complete."""


@dataclass(frozen=True)
class CloverCatalogItemGroup:
    provider_id: str
    name: str
    item_ids: tuple[str, ...]
    attribute_ids: tuple[str, ...]
    active: bool
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class CloverCatalogVariation:
    """Compatibility value object; Clover variants remain unresolved.

    Clover represents a variant as an item in an item group, with attributes,
    options, and option-item associations. The foundation preserves those
    identifiers on CloverCatalogItem rather than fabricating variations.
    """

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
    deleted: bool
    hidden: bool
    available: bool | None
    price_cents: int | None
    item_group_id: str | None
    option_ids: tuple[str, ...]
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
    merchant_address: Mapping[str, Any]
    location: CloverCatalogLocation | None
    item_groups: tuple[CloverCatalogItemGroup, ...]
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


def _deleted(payload: Mapping[str, Any]) -> bool:
    # Clover may expose deletion as a boolean or a non-empty deletedTime.
    return bool(payload.get("deleted") or payload.get("isDeleted") or payload.get("deletedTime"))


def _hidden(payload: Mapping[str, Any]) -> bool:
    return bool(payload.get("hidden"))


def _available(payload: Mapping[str, Any]) -> bool | None:
    value = payload.get("available")
    return value if isinstance(value, bool) else None


def _active(payload: Mapping[str, Any]) -> bool:
    return not _deleted(payload)


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


def _nested(payload: Mapping[str, Any], field: str) -> list[Mapping[str, Any]]:
    return _elements(payload.get(field) or {})


def _assert_nested_complete(
    payload: Mapping[str, Any],
    fields: Iterable[str],
    *,
    nested_limit: int = 100,
) -> None:
    """Clover does not paginate expanded collections; reject ambiguous truncation."""
    for field in fields:
        if len(_nested(payload, field)) >= nested_limit:
            raise CloverCatalogIncomplete(
                f"Clover expanded {field} collection reached its provider limit."
            )


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
    _assert_nested_complete(payload, ("modifiers",))
    modifiers = tuple(
        modifier
        for modifier in (
            normalize_modifier(item)
            for item in _nested(payload, "modifiers")
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


def normalize_item_group(payload: Mapping[str, Any]) -> CloverCatalogItemGroup | None:
    identifier = _identifier(payload)
    if not identifier:
        return None
    _assert_nested_complete(payload, ("items", "attributes"))
    return CloverCatalogItemGroup(
        provider_id=identifier,
        name=_text(payload.get("name")) or "(Unnamed item group)",
        item_ids=tuple(
            item_id
            for item_id in (_identifier(item) for item in _nested(payload, "items"))
            if item_id
        ),
        attribute_ids=tuple(
            attribute_id
            for attribute_id in (_identifier(item) for item in _nested(payload, "attributes"))
            if attribute_id
        ),
        active=_active(payload),
        raw=dict(payload),
    )


def _item_group_id(payload: Mapping[str, Any]) -> str | None:
    group = payload.get("itemGroup") or payload.get("item_group")
    if isinstance(group, Mapping):
        return _identifier(group) or None
    return _text(group) or None


def _related_identifier(payload: Mapping[str, Any]) -> str:
    return _identifier(payload) or _identifier(payload.get("option") or {}) or _identifier(payload.get("item") or {})


def normalize_item(
    payload: Mapping[str, Any],
    *,
    categories: Mapping[str, CloverCatalogCategory] | None = None,
    modifier_groups: Mapping[str, CloverCatalogModifierGroup] | None = None,
) -> CloverCatalogItem | None:
    identifier = _identifier(payload)
    if not identifier:
        return None
    _assert_nested_complete(payload, ("categories", "modifierGroups", "options", "optionItems"))
    item_categories = tuple(
        category
        for category in (
            normalize_category(item) for item in _nested(payload, "categories")
        )
        if category is not None
    )
    item_groups = tuple(
        group
        for group in (
            normalize_modifier_group(item)
            for item in (
                _nested(payload, "modifierGroups")
                or _nested(payload, "modifier_groups")
            )
        )
        if group is not None
    )
    if categories:
        item_categories = tuple(categories.get(item.provider_id, item) for item in item_categories)
    if modifier_groups:
        item_groups = tuple(modifier_groups.get(item.provider_id, item) for item in item_groups)

    option_ids = tuple(
        option_id
        for option_id in (
            _related_identifier(item)
            for item in (_nested(payload, "options") or _nested(payload, "optionItems"))
        )
        if option_id
    )
    # Clover's documented item-group model represents variants as separate
    # items linked by itemGroup/attributes/options. Do not treat itemGroupItems
    # as variants; preserve its raw payload only for future provider-specific
    # resolution.
    return CloverCatalogItem(
        provider_id=identifier,
        name=_text(payload.get("name")) or "(Unnamed item)",
        active=_active(payload),
        deleted=_deleted(payload),
        hidden=_hidden(payload),
        available=_available(payload),
        price_cents=_price_cents(payload),
        item_group_id=_item_group_id(payload),
        option_ids=option_ids,
        categories=item_categories,
        variations=(),
        modifier_groups=item_groups,
        raw=dict(payload),
    )


def normalize_catalog(
    *,
    merchant: Mapping[str, Any],
    items: Iterable[Mapping[str, Any]],
    item_groups: Iterable[Mapping[str, Any]] = (),
    categories: Iterable[Mapping[str, Any]] = (),
    modifier_groups: Iterable[Mapping[str, Any]] = (),
) -> CloverCatalogSnapshot:
    merchant_id = _identifier(merchant)
    if not merchant_id:
        raise CloverRequestError(
            "Clover merchant response did not include an id.",
            code="clover_merchant_identity_missing",
        )
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
    normalized_item_groups = tuple(
        group
        for group in (
            normalize_item_group(value) for value in _dedupe_by_id(item_groups)
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
    address = merchant.get("address") or {}
    address_metadata = dict(address) if isinstance(address, Mapping) else {}
    location_payload = merchant.get("location")
    location_id = _identifier(location_payload) if isinstance(location_payload, Mapping) else ""
    location = None
    if location_id and isinstance(location_payload, Mapping):
            location = CloverCatalogLocation(
                provider_id=location_id,
                name=_text(location_payload.get("name") or merchant.get("name")) or "(Unnamed location)",
                address=dict(address_metadata),
                raw=dict(location_payload),
            )
    return CloverCatalogSnapshot(
        merchant_id=merchant_id,
        merchant_name=_text(merchant.get("name") or merchant.get("label")),
        merchant_address=address_metadata,
        location=location,
        item_groups=normalized_item_groups,
        categories=normalized_categories,
        modifier_groups=normalized_groups,
        items=normalized_items,
    )


class CloverCatalogClient:
    """Read-only Clover v3 catalog client."""

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

    def _paged(self, resource: str, *, nested_fields: Iterable[str] = ()) -> list[Mapping[str, Any]]:
        values: list[Mapping[str, Any]] = []
        for page in range(self.max_pages):
            offset = page * self.page_size
            separator = "&" if "?" in resource else "?"
            query = urlencode({"offset": offset, "limit": self.page_size})
            payload = self._get(
                f"/v3/merchants/{self.merchant_id}/{resource}{separator}{query}"
            )
            page_values = _elements(payload)
            for value in page_values:
                _assert_nested_complete(value, nested_fields)
            values.extend(page_values)
            if len(page_values) < self.page_size:
                return _dedupe_by_id(values)
        raise CloverCatalogIncomplete(
            f"Clover {resource.split('?')[0]} exceeded the configured page bound."
        )

    def fetch_snapshot(self) -> CloverCatalogSnapshot:
        if not clover_catalog_enabled():
            raise CloverCatalogDisabled("Clover catalog integration is disabled.")
        merchant = self._get(f"/v3/merchants/{self.merchant_id}")
        response_merchant_id = _identifier(merchant)
        if not response_merchant_id:
            raise CloverRequestError(
                "Clover merchant response did not include an id.",
                code="clover_merchant_identity_missing",
            )
        if response_merchant_id != self.merchant_id:
            raise CloverRequestError(
                "Clover merchant identity did not match the requested merchant.",
                code="clover_merchant_identity_mismatch",
            )
        categories = self._paged("categories")
        modifier_groups = self._paged(
            "modifier_groups?expand=modifiers",
            nested_fields=("modifiers",),
        )
        item_groups = self._paged(
            "item_groups?expand=items,attributes",
            nested_fields=("items", "attributes"),
        )
        items = self._paged(
            "items?expand=categories,modifierGroups,options",
            nested_fields=("categories", "modifierGroups", "options"),
        )
        return normalize_catalog(
            merchant=merchant,
            items=items,
            item_groups=item_groups,
            categories=categories,
            modifier_groups=modifier_groups,
        )
