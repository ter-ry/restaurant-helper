"""Local-only, read-only Clover Sandbox catalog smoke test.

This utility intentionally accepts credentials only from environment variables,
forces the Clover Sandbox API host, and reuses CloverCatalogClient for all
catalog retrieval and normalization. It never writes provider or Flowtally data.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from backend.clover import CloverRequestError
from backend.clover_catalog import (
    CloverCatalogClient,
    CloverCatalogDisabled,
    CloverCatalogIncomplete,
    CloverCatalogSnapshot,
)

SANDBOX_API_BASE = "https://apisandbox.dev.clover.com"
MERCHANT_ENV = "CLOVER_SANDBOX_MERCHANT_ID"
TOKEN_ENV = "CLOVER_SANDBOX_API_TOKEN"
EXPECTED_TEST_ITEM_ID = "TE0BYZH7B28AJ"
EXPECTED_TEST_ITEM_NAME = "Test Burger"
EXPECTED_TEST_ITEM_PRICE_CENTS = 1800


class CloverCatalogSmokeFailure(RuntimeError):
    """Raised when the expected Sandbox smoke-test fixture is absent."""


def sandbox_requester(
    method: str,
    path: str,
    *,
    token: str | None = None,
    opener: Callable[..., object] = urlopen,
) -> Mapping[str, object]:
    """Perform one GET against the fixed Clover Sandbox API host.

    The injected opener exists only to make the request boundary mockable in
    tests; callers cannot override the host or issue a non-GET request.
    """

    if method.upper() != "GET":
        raise CloverRequestError(
            "The catalog smoke test permits GET requests only.",
            code="clover_catalog_smoke_read_only",
        )
    if not path.startswith("/v3/merchants/"):
        raise CloverRequestError(
            "The catalog smoke test permits merchant catalog paths only.",
            code="clover_catalog_smoke_path_rejected",
        )

    request = Request(
        f"{SANDBOX_API_BASE}{path}",
        method="GET",
        headers={"Accept": "application/json"},
    )
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with opener(request, timeout=15) as response:
            raw = response.read().decode("utf-8")
            value = json.loads(raw) if raw else {}
    except HTTPError as exc:
        raise CloverRequestError(
            "Clover Sandbox request was rejected.",
            status_code=exc.code,
            code="clover_unauthorized" if exc.code in {401, 403} else "clover_request_failed",
        ) from exc
    except (URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        raise CloverRequestError(
            "Clover Sandbox request could not be completed.",
            code="clover_unavailable",
        ) from exc

    if not isinstance(value, Mapping):
        raise CloverRequestError(
            "Clover Sandbox returned an invalid catalog response.",
            code="clover_invalid_response",
        )
    return value


def _price_label(price_cents: int | None) -> str:
    return "unavailable" if price_cents is None else f"{price_cents} cents"


def build_summary(snapshot: CloverCatalogSnapshot) -> dict[str, object]:
    """Return concise, credential-free output suitable for local review."""

    items: list[dict[str, object]] = []
    for item in snapshot.items:
        modifiers = [
            {
                "id": modifier.provider_id,
                "name": modifier.name,
                "priceCents": modifier.price_cents,
                "active": modifier.active,
            }
            for group in item.modifier_groups
            for modifier in group.modifiers
        ]
        items.append(
            {
                "id": item.provider_id,
                "name": item.name,
                "priceCents": item.price_cents,
                "price": _price_label(item.price_cents),
                "active": item.active,
                "deleted": item.deleted,
                "hidden": item.hidden,
                "available": item.available,
                "itemGroupId": item.item_group_id,
                "optionIds": list(item.option_ids),
                "categories": [
                    {"id": category.provider_id, "name": category.name, "active": category.active}
                    for category in item.categories
                ],
                "modifiers": modifiers,
            }
        )

    return {
        "merchant": {"id": snapshot.merchant_id, "name": snapshot.merchant_name},
        "location": (
            {"id": snapshot.location.provider_id, "name": snapshot.location.name}
            if snapshot.location
            else None
        ),
        "counts": {
            "items": len(snapshot.items),
            "categories": len(snapshot.categories),
            "itemGroups": len(snapshot.item_groups),
            "modifierGroups": len(snapshot.modifier_groups),
        },
        "items": items,
    }


def verify_test_burger(snapshot: CloverCatalogSnapshot) -> None:
    matches = [item for item in snapshot.items if item.provider_id == EXPECTED_TEST_ITEM_ID]
    if not matches:
        raise CloverCatalogSmokeFailure(
            f"Expected {EXPECTED_TEST_ITEM_NAME} ({EXPECTED_TEST_ITEM_ID}) was not returned by Clover Sandbox."
        )
    item = matches[0]
    if item.name != EXPECTED_TEST_ITEM_NAME or item.price_cents != EXPECTED_TEST_ITEM_PRICE_CENTS:
        raise CloverCatalogSmokeFailure(
            f"Expected {EXPECTED_TEST_ITEM_NAME} ({EXPECTED_TEST_ITEM_ID}) at "
            f"{EXPECTED_TEST_ITEM_PRICE_CENTS} cents; received the provider's current values."
        )


def _parser() -> argparse.ArgumentParser:
    return argparse.ArgumentParser(
        description="Read-only Clover Sandbox catalog smoke test; credentials come from environment variables."
    )


def main(argv: list[str] | None = None) -> int:
    _parser().parse_args(argv)
    merchant_id = os.environ.get(MERCHANT_ENV, "").strip()
    token = os.environ.get(TOKEN_ENV, "").strip()
    if not merchant_id or not token:
        missing = [name for name, value in ((MERCHANT_ENV, merchant_id), (TOKEN_ENV, token)) if not value]
        print(f"Missing required environment variable(s): {', '.join(missing)}", file=sys.stderr)
        return 2

    # The local utility is the explicit opt-in boundary for this process. The
    # shared client still retains its default-disabled feature gate elsewhere.
    os.environ["CLOVER_CATALOG_ENABLED"] = "true"
    client = CloverCatalogClient(
        merchant_id=merchant_id,
        token=token,
        requester=sandbox_requester,
    )
    try:
        snapshot = client.fetch_snapshot()
        verify_test_burger(snapshot)
    except CloverCatalogDisabled as exc:
        print(f"DISABLED: {exc}", file=sys.stderr)
        return 2
    except CloverCatalogIncomplete as exc:
        print(f"INCOMPLETE: {exc}", file=sys.stderr)
        return 3
    except CloverCatalogSmokeFailure as exc:
        print(f"FIXTURE CHECK FAILED: {exc}", file=sys.stderr)
        return 4
    except CloverRequestError as exc:
        print(f"CLOVER REQUEST FAILED: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(build_summary(snapshot), indent=2, sort_keys=True))
    print(
        f"Verified {EXPECTED_TEST_ITEM_NAME} {EXPECTED_TEST_ITEM_ID} "
        f"at {EXPECTED_TEST_ITEM_PRICE_CENTS} cents (CAD).",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
