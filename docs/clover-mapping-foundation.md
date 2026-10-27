# Clover sandbox mapping foundation

This phase is read-only with respect to Clover sales and Flowtally inventory.

## Enablement

CLOVER_MAPPING_ENABLED defaults to false. Enable it only in an isolated sandbox environment after confirming:

- CLOVER_ENABLED=true
- CLOVER_ENVIRONMENT=sandbox
- the organization is present in CLOVER_ALLOWED_ORGANIZATION_IDS
- the connected Clover merchant is the intended sandbox merchant

## Manual verification

1. Sign in as the Flowtally Showcase owner.
2. Open Square / POS and confirm the Clover sandbox connection.
3. Preview the catalog.
4. Choose the Flowtally restaurant location and select **Confirm location**.
5. For a basic Clover item, choose an existing Flowtally menu item and save the mapping.
6. Confirm the mapped menu item and recipe status.

The first phase deliberately does not map item-group variants or modifier-bearing items. It does not import sales, create webhooks, consume inventory, alter recipes, or alter Square mappings. Test Burger must be selected explicitly; it is never auto-mapped.
