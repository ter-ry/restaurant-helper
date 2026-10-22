# Clover read-only catalog foundation

This milestone adds a disabled-by-default, connection-only catalog foundation. It normalizes mocked Clover responses into provider-neutral value objects and performs no persistence, mapping, inventory movement, order import, webhook registration, or scheduled work.

## Feature gate

Set CLOVER_CATALOG_ENABLED=true only in an isolated sandbox environment after the Clover OAuth connection exists. The gate is independent from CLOVER_ENABLED; enabling Clover OAuth does not activate catalog reads. There are no catalog routes or UI controls in this milestone.

## Read-only endpoints

The client uses only GET requests against Clover's North America sandbox base:

- GET /v3/merchants/{merchantId} for merchant identity and embedded address/location data when present.
- GET /v3/merchants/{merchantId}/items?expand=categories,modifierGroups.
- GET /v3/merchants/{merchantId}/categories.
- GET /v3/merchants/{merchantId}/modifier_groups.

Clover collection responses are paged with offset and limit (bounded at 1,000 per request), and duplicate provider IDs are de-duplicated. Distinct IDs with the same display name remain distinct.

Clover documents these resources and paging behavior in its REST API guide, items, categories, modifier groups, and pagination documentation.

## Normalization boundary

The normalized objects retain the Clover provider ID and raw metadata while exposing names, active state, prices, categories, variations, and modifier groups. They are intentionally not Flowtally MenuItem or Recipe records. Mapping will be a later explicit, user-reviewed step; no Square identifiers or mappings are reused.

## Optional local smoke test

A local utility can be added later once a sandbox token is available. This PR intentionally does not call Clover and does not store or print tokens. No Production API calls are made.
