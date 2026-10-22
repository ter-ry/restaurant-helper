# Clover read-only catalog foundation

This milestone adds a disabled-by-default, connection-only catalog foundation. It normalizes mocked Clover responses into provider-neutral value objects and performs no persistence, mapping, inventory movement, order import, webhook registration, or scheduled work.

## Feature gate

Set `CLOVER_CATALOG_ENABLED=true` only in an isolated sandbox environment after the Clover OAuth connection exists. The gate is independent from `CLOVER_ENABLED`; enabling Clover OAuth does not activate catalog reads. There are no catalog routes or UI controls in this milestone.

## Read-only endpoints

The client uses only GET requests against Clover's North America sandbox base:

- `GET /v3/merchants/{merchantId}` for merchant identity and address metadata, plus an explicit location object only when Clover supplies a location ID.
- `GET /v3/merchants/{merchantId}/items?expand=categories,modifierGroups`.
- `GET /v3/merchants/{merchantId}/item_groups?expand=items,attributes`.
- `GET /v3/merchants/{merchantId}/categories`.
- `GET /v3/merchants/{merchantId}/modifier_groups?expand=modifiers`.

Clover collection responses are paged with `offset` and `limit` (bounded at 1,000 per request). A full final page is not assumed complete: if the configured page bound is exhausted, the client raises an explicit incomplete outcome. Clover does not paginate nested expanded fields; expanded collections reaching the documented 100-item nested limit are also rejected as incomplete rather than silently truncated. Duplicate provider IDs are de-duplicated, while distinct IDs with the same display name remain distinct.

## Normalization boundary

The normalized objects retain Clover provider IDs and raw metadata while exposing names, active state, prices, categories, item-group IDs, option IDs, and modifier groups. Clover's documented variant model represents each variant as an item linked to an item group, attributes, options, and option-item associations. This foundation preserves those identifiers and does not fabricate a `variations` collection. Mapping to Flowtally MenuItem or Recipe records remains an explicit, user-reviewed future step; no Square identifiers or mappings are reused.

Merchant identity is checked against the requested merchant ID. Postal address data is retained as address metadata and is never promoted to a location ID without an explicit Clover location object.

Clover API references: [REST API](https://docs.clover.com/dev/docs/clover-rest-api-index), [items and item groups](https://docs.clover.com/dev/docs/managing-items-item-groups), [item groups](https://docs.clover.com/dev/reference/inventorygetitemgroups), [categories](https://docs.clover.com/dev/docs/managing-categories), [modifier groups](https://docs.clover.com/dev/reference/modifiergetmodifiergroups), and [pagination](https://docs.clover.com/dev/docs/paginating-elements).

## Optional local smoke test

A local utility can be added later once a sandbox token is available. This PR intentionally does not call Clover and does not store or print tokens. No Production API calls are made.
