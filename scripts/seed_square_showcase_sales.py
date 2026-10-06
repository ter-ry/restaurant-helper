#!/usr/bin/env python3
"""Create a small, deterministic Square Production sales fixture.

This utility is deliberately separate from Flowtally's OAuth and database code.
It writes only to the explicitly identified Square seller and is never called by
the application.  The access token is read from the process environment and is
never included in output, manifests, or exceptions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


SQUARE_API_VERSION = "2026-07-15"
SQUARE_API_BASE = "https://connect.squareup.com"
TARGET_VARIATION = "Flowtally Test Burger · Base"
DEFAULT_ORDER_COUNT = 1
VIDEO_FIXTURE_NAME = "alpha-video-full-sales-2026-10"
MAX_ORDER_COUNT = 5
MAX_TOTAL_BURGERS = 8
VIDEO_ORDER_COUNT = 8
VIDEO_TOTAL_BURGERS = 10


class SquareShowcaseError(RuntimeError):
    """A safe, user-facing error that never contains an access token."""

    def __init__(self, message: str, *, status: int | None = None, request_id: str | None = None):
        super().__init__(message)
        self.status = status
        self.request_id = request_id


def _square_error_metadata(raw: bytes | str) -> str | None:
    """Return only structured, non-sensitive Square error fields."""
    try:
        payload = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    entries = payload.get("errors")
    if not isinstance(entries, list):
        entries = [payload] if any(key in payload for key in ("category", "code", "detail", "type")) else []
    summaries: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        parts: list[str] = []
        for key in ("category", "code", "type", "detail"):
            value = entry.get(key)
            if not isinstance(value, str) or not value.strip():
                continue
            safe = re.sub(r"(?i)bearer\s+\S+", "Bearer [redacted]", value.strip())
            safe = re.sub(r"(?i)((?:token|secret|authorization)\s*[:=])\s*\S+", r"\1 [redacted]", safe)
            parts.append(f"{key}={safe[:200]}")
        if parts:
            summaries.append(" ".join(parts))
    return "; ".join(summaries) or None


class SquareClient:
    def __init__(self, token: str, *, opener: Callable[..., Any] = urlopen):
        self._token = token
        self._opener = opener

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{SQUARE_API_BASE}{path}"
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "Square-Version": SQUARE_API_VERSION,
        }
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(url, data=body, headers=headers, method=method.upper())
        try:
            with self._opener(request, timeout=30) as response:
                raw = response.read().decode("utf-8")
                request_id = response.headers.get("x-square-request-id")
                status = getattr(response, "status", 200)
        except HTTPError as exc:
            request_id = exc.headers.get("x-square-request-id") if exc.headers else None
            try:
                metadata = _square_error_metadata(exc.read())
            except OSError:
                metadata = None
            message = "Square request failed."
            if metadata:
                message += f" {metadata}"
            raise SquareShowcaseError(message, status=exc.code, request_id=request_id) from exc
        except URLError as exc:
            raise SquareShowcaseError("Square request could not reach the Production API.") from exc
        except TimeoutError as exc:
            raise SquareShowcaseError("Square request timed out.") from exc
        try:
            parsed = json.loads(raw or "{}")
        except json.JSONDecodeError as exc:
            raise SquareShowcaseError("Square returned an invalid response.", status=status, request_id=request_id) from exc
        if not isinstance(parsed, dict):
            raise SquareShowcaseError("Square returned an unexpected response.", status=status, request_id=request_id)
        return parsed


@dataclass(frozen=True)
class Identity:
    merchant_id: str
    location_id: str
    location_name: str


@dataclass(frozen=True)
class Variation:
    object_id: str
    display_name: str
    price_cents: int
    currency: str


@dataclass(frozen=True)
class OrderPlan:
    number: int
    quantity: int
    discount_percent: int = 0
    tip_percent: int = 0


def _key(fixture_name: str, kind: str, number: int) -> str:
    digest = hashlib.sha256(f"flowtally:{fixture_name}:{kind}:{number}".encode("utf-8")).hexdigest()
    return f"flowtally-showcase-{digest[:32]}"


def _reference_id(fixture_name: str, order_number: int) -> str:
    digest = hashlib.sha256(f"flowtally:{fixture_name}:order:{order_number}".encode("utf-8")).hexdigest()
    return f"ft-showcase-{digest[:28]}"


def plans(order_count: int) -> list[OrderPlan]:
    if order_count < 1 or order_count > MAX_ORDER_COUNT:
        raise SquareShowcaseError(f"order count must be between 1 and {MAX_ORDER_COUNT}")
    base = [
        OrderPlan(1, 1),
        OrderPlan(2, 2, tip_percent=15),
        OrderPlan(3, 1, discount_percent=10),
        OrderPlan(4, 1, tip_percent=10),
        OrderPlan(5, 2, discount_percent=5),
    ]
    selected = base[:order_count]
    total = sum(item.quantity for item in selected)
    if total > MAX_TOTAL_BURGERS:
        raise SquareShowcaseError(f"fixture would create {total} burger servings; maximum is {MAX_TOTAL_BURGERS}")
    return selected


def fixture_plans(fixture_name: str, requested_order_count: int | None) -> list[OrderPlan]:
    """Resolve the safe default or the explicitly named recording fixture."""
    if fixture_name == VIDEO_FIXTURE_NAME:
        if requested_order_count not in (None, VIDEO_ORDER_COUNT):
            raise SquareShowcaseError(f"{VIDEO_FIXTURE_NAME} is fixed at 8 orders and 10 burger servings")
        selected = [
            OrderPlan(1, 1),
            OrderPlan(2, 2),
            OrderPlan(3, 1, tip_percent=15),
            OrderPlan(4, 1, discount_percent=10),
            OrderPlan(5, 2),
            OrderPlan(6, 1, tip_percent=10),
            OrderPlan(7, 1),
            OrderPlan(8, 1, discount_percent=5),
        ]
        if len(selected) != VIDEO_ORDER_COUNT or sum(plan.quantity for plan in selected) != VIDEO_TOTAL_BURGERS:
            raise SquareShowcaseError(f"{VIDEO_FIXTURE_NAME} fixture definition is invalid")
        return selected
    return plans(requested_order_count if requested_order_count is not None else DEFAULT_ORDER_COUNT)


def _money(amount: int, currency: str) -> dict[str, Any]:
    return {"amount": int(amount), "currency": currency}


def verify_identity(client: SquareClient, *, merchant_id: str, location_id: str, location_name: str) -> Identity:
    if not merchant_id or not location_id:
        raise SquareShowcaseError("SQUARE_SHOWCASE_EXPECTED_MERCHANT_ID and SQUARE_SHOWCASE_EXPECTED_LOCATION_ID are required")
    merchant = client.request("GET", f"/v2/merchants/{merchant_id}").get("merchant") or {}
    if str(merchant.get("id") or "") != merchant_id:
        raise SquareShowcaseError("Square merchant identity did not match the configured expectation")
    location = client.request("GET", f"/v2/locations/{location_id}").get("location") or {}
    if str(location.get("id") or "") != location_id:
        raise SquareShowcaseError("Square location identity did not match the configured expectation")
    actual_name = str(location.get("name") or "")
    if location_name and actual_name != location_name:
        raise SquareShowcaseError("Square location name did not match the configured showcase location")
    return Identity(merchant_id, location_id, actual_name)


def _catalog_pages(client: SquareClient) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    related: list[dict[str, Any]] = []
    cursor = ""
    while True:
        suffix = "&" + urlencode({"cursor": cursor}) if cursor else ""
        payload = client.request("GET", f"/v2/catalog/list?types=ITEM,ITEM_VARIATION&include_related_objects=true{suffix}")
        objects.extend(payload.get("objects") or [])
        related.extend(payload.get("related_objects") or [])
        cursor = str(payload.get("cursor") or "")
        if not cursor:
            break
    return objects + related


def discover_variation(client: SquareClient) -> Variation:
    entries = _catalog_pages(client)
    items = {str(entry.get("id")): entry for entry in entries if entry.get("type") == "ITEM"}
    matches: list[Variation] = []
    for entry in entries:
        if entry.get("type") != "ITEM_VARIATION":
            continue
        data = entry.get("item_variation_data") or {}
        variation_name = str(data.get("name") or "").strip()
        item_name = str((items.get(str(data.get("item_id"))) or {}).get("item_data", {}).get("name") or "").strip()
        display = " · ".join(part for part in (item_name, variation_name) if part)
        if display == TARGET_VARIATION or str(data.get("name") or "").strip() == TARGET_VARIATION:
            price = data.get("price_money") or {}
            amount = price.get("amount")
            if not isinstance(amount, int) or amount <= 0:
                raise SquareShowcaseError("the showcase burger variation has no valid price")
            currency = str(price.get("currency") or "")
            if currency != "CAD":
                raise SquareShowcaseError("the showcase burger variation is not priced in CAD")
            matches.append(Variation(str(entry.get("id") or ""), display or TARGET_VARIATION, amount, currency))
    if len(matches) != 1:
        raise SquareShowcaseError("expected exactly one Flowtally Test Burger · Base variation")
    return matches[0]


def _order_payload(plan: OrderPlan, variation: Variation, fixture_name: str, location_id: str) -> dict[str, Any]:
    order: dict[str, Any] = {
        "reference_id": _reference_id(fixture_name, plan.number),
        "location_id": location_id,
        "line_items": [{"catalog_object_id": variation.object_id, "quantity": str(plan.quantity)}],
    }
    if plan.discount_percent:
        order["discounts"] = [{
            "uid": f"flowtally-discount-{plan.number}",
            "name": "Showcase welcome discount",
            "type": "FIXED_PERCENTAGE",
            "percentage": str(plan.discount_percent),
            "scope": "ORDER",
        }]
    return order


def _manifest_load(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"fixture": None, "orders": {}}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SquareShowcaseError("fixture manifest could not be read") from exc
    return parsed if isinstance(parsed, dict) else {"fixture": None, "orders": {}}


def _manifest_save(path: Path, manifest: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _safe_request_id(error: SquareShowcaseError) -> str | None:
    return error.request_id if error.request_id and len(error.request_id) <= 120 else None


def seed_sales(
    client: SquareClient,
    *,
    fixture_name: str,
    identity: Identity,
    variation: Variation,
    order_count: int | None,
    manifest_path: Path,
    dry_run: bool,
    confirm_inventory_reviewed: bool = False,
) -> dict[str, Any]:
    order_plans = fixture_plans(fixture_name, order_count)
    if len(order_plans) > DEFAULT_ORDER_COUNT and not confirm_inventory_reviewed:
        raise SquareShowcaseError("larger fixtures require --confirm-inventory-reviewed after checking Flowtally ingredient stock")
    planned: list[dict[str, Any]] = []
    for plan in order_plans:
        subtotal = variation.price_cents * plan.quantity
        discount = subtotal * plan.discount_percent // 100
        net = subtotal - discount
        tip = net * plan.tip_percent // 100
        planned.append({
            "fixtureName": fixture_name,
            "orderNumber": plan.number,
            "quantity": plan.quantity,
            "grossAmount": {"amount": subtotal, "currency": variation.currency},
            "discountAmount": {"amount": discount, "currency": variation.currency},
            "tipAmount": {"amount": tip, "currency": variation.currency},
            "finalTotal": {"amount": net + tip, "currency": variation.currency},
            "currency": variation.currency,
            "catalogVariationId": variation.object_id,
            "squareLocationId": identity.location_id,
            "paymentType": "CASH",
            "grossCents": subtotal,
            "discountCents": discount,
            "tipCents": tip,
            "totalCents": net + tip,
        })
    total_planned = {
        "orderCount": len(planned),
        "totalBurgerQuantity": sum(item["quantity"] for item in planned),
        "grossAmount": {"amount": sum(item["grossCents"] for item in planned), "currency": variation.currency},
        "discountAmount": {"amount": sum(item["discountCents"] for item in planned), "currency": variation.currency},
        "tipAmount": {"amount": sum(item["tipCents"] for item in planned), "currency": variation.currency},
        "finalTotal": {"amount": sum(item["totalCents"] for item in planned), "currency": variation.currency},
    }
    warning = (
        f"This fixture contains {total_planned['totalBurgerQuantity']} burger serving(s). "
        "Flowtally sync will consume the mapped burger recipe inventory; verify ingredient stock before running a larger fixture."
    )
    if dry_run:
        return {"fixture": fixture_name, "identity": identity.__dict__, "variation": variation.__dict__, "paymentType": "CASH", "plannedTotals": total_planned, "inventoryWarning": warning, "orders": planned, "writes": False}

    manifest = _manifest_load(manifest_path)
    if manifest.get("fixture") not in (None, fixture_name):
        raise SquareShowcaseError("fixture manifest belongs to a different fixture")
    manifest.update({
        "fixture": fixture_name,
        "currency": variation.currency,
        "catalogVariationId": variation.object_id,
        "squareLocationId": identity.location_id,
        "paymentType": "CASH",
        "plannedTotals": total_planned,
    })
    manifest.setdefault("orders", {})
    results: list[dict[str, Any]] = []
    for plan, summary in zip(order_plans, planned):
        key = str(plan.number)
        entry = manifest["orders"].setdefault(key, {})
        order_id = str(entry.get("squareOrderId") or entry.get("orderId") or "")
        if order_id:
            current = client.request("GET", f"/v2/orders/{order_id}").get("order") or {}
            state = str(current.get("state") or "")
            if state == "COMPLETED":
                entry.update({
                    **summary,
                    "squareOrderId": order_id,
                    "status": "completed",
                    "createdAt": current.get("created_at") or entry.get("createdAt"),
                    "closedAt": current.get("closed_at") or entry.get("closedAt"),
                })
                results.append(dict(entry))
                continue
        if not order_id:
            created = client.request("POST", "/v2/orders", {"idempotency_key": _key(fixture_name, "order", plan.number), "order": _order_payload(plan, variation, fixture_name, identity.location_id)})
            order = created.get("order") or {}
            order_id = str(order.get("id") or "")
            if not order_id:
                raise SquareShowcaseError(f"Square did not return an order ID for order {plan.number}")
            entry.update({**summary, "squareOrderId": order_id, "referenceId": _order_payload(plan, variation, fixture_name, identity.location_id)["reference_id"]})
            _manifest_save(manifest_path, manifest)
        payment_id = str(entry.get("paymentId") or "")
        if not payment_id:
            payment = client.request("POST", "/v2/payments", {
                "idempotency_key": _key(fixture_name, "payment", plan.number)[:45],
                "source_id": "CASH",
                "amount_money": _money(summary["totalCents"] - summary["tipCents"], variation.currency),
                "tip_money": _money(summary["tipCents"], variation.currency),
                "order_id": order_id,
                "location_id": identity.location_id,
                "autocomplete": False,
                "cash_details": {"buyer_supplied_money": _money(summary["totalCents"], variation.currency)},
            })
            payment_id = str((payment.get("payment") or {}).get("id") or "")
            if not payment_id:
                raise SquareShowcaseError(f"Square did not return a payment ID for order {plan.number}")
            entry["paymentId"] = payment_id
            _manifest_save(manifest_path, manifest)
        paid = client.request("POST", f"/v2/orders/{order_id}/pay", {"idempotency_key": _key(fixture_name, "pay", plan.number), "payment_ids": [payment_id]})
        final_order = paid.get("order") or {}
        if str(final_order.get("state") or "") != "COMPLETED":
            raise SquareShowcaseError(f"Square did not complete order {plan.number}")
        entry.update({
            "status": "completed",
            "squareOrderId": order_id,
            "paymentId": payment_id,
            "createdAt": final_order.get("created_at"),
            "closedAt": final_order.get("closed_at"),
        })
        results.append(dict(entry))
        _manifest_save(manifest_path, manifest)
    completed = [item for item in results if item.get("status") == "completed"]
    completed_totals = {
        "orderCount": len(completed),
        "totalBurgerQuantity": sum(item.get("quantity", 0) for item in completed),
        "grossAmount": {"amount": sum(item.get("grossCents", 0) for item in completed), "currency": variation.currency},
        "discountAmount": {"amount": sum(item.get("discountCents", 0) for item in completed), "currency": variation.currency},
        "tipAmount": {"amount": sum(item.get("tipCents", 0) for item in completed), "currency": variation.currency},
        "finalTotal": {"amount": sum(item.get("totalCents", 0) for item in completed), "currency": variation.currency},
    }
    manifest["completedTotals"] = completed_totals
    _manifest_save(manifest_path, manifest)
    return {"fixture": fixture_name, "identity": identity.__dict__, "variation": variation.__dict__, "paymentType": "CASH", "plannedTotals": total_planned, "completedTotals": completed_totals, "inventoryWarning": warning, "orders": results, "writes": True}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Seed a small guarded Square Production showcase fixture.")
    parser.add_argument("--environment", required=True, choices=("production",), help="must be production")
    parser.add_argument("--fixture-name", required=True, help="stable fixture name used in references and idempotency keys")
    parser.add_argument("--orders", type=int, default=None, help=f"number of orders (default {DEFAULT_ORDER_COUNT}, max {MAX_ORDER_COUNT}; {VIDEO_FIXTURE_NAME} is fixed at 8)")
    parser.add_argument("--manifest", type=Path, default=None, help="local non-secret manifest path")
    parser.add_argument("--dry-run", action="store_true", help="discover and print the plan without writes")
    parser.add_argument("--confirm-showcase-production", action="store_true", help="required for Production writes")
    parser.add_argument("--confirm-inventory-reviewed", action="store_true", help="required for more than the one-order safe default after checking Flowtally ingredient stock")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.environment != "production":
        print("ERROR: only the production environment is supported.", file=sys.stderr)
        return 2
    if not args.dry_run and not args.confirm_showcase_production:
        print("ERROR: Production writes require --confirm-showcase-production.", file=sys.stderr)
        return 2
    try:
        fixture_plans(args.fixture_name, args.orders)
    except SquareShowcaseError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    effective_order_count = len(fixture_plans(args.fixture_name, args.orders))
    if effective_order_count > DEFAULT_ORDER_COUNT and not args.confirm_inventory_reviewed:
        print("ERROR: larger fixtures require --confirm-inventory-reviewed after checking Flowtally ingredient stock.", file=sys.stderr)
        return 2
    token = os.environ.get("SQUARE_SHOWCASE_ACCESS_TOKEN", "").strip()
    if not token:
        print("ERROR: SQUARE_SHOWCASE_ACCESS_TOKEN is required and was not printed.", file=sys.stderr)
        return 2
    merchant_id = os.environ.get("SQUARE_SHOWCASE_EXPECTED_MERCHANT_ID", "").strip()
    location_id = os.environ.get("SQUARE_SHOWCASE_EXPECTED_LOCATION_ID", "").strip()
    location_name = os.environ.get("SQUARE_SHOWCASE_EXPECTED_LOCATION_NAME", "").strip()
    if not location_name:
        print("ERROR: SQUARE_SHOWCASE_EXPECTED_LOCATION_NAME is required; configure the Square seller location name explicitly.", file=sys.stderr)
        return 2
    manifest = args.manifest or Path.cwd() / f"square-showcase-{args.fixture_name}.manifest.json"
    try:
        client = SquareClient(token)
        identity = verify_identity(client, merchant_id=merchant_id, location_id=location_id, location_name=location_name)
        variation = discover_variation(client)
        result = seed_sales(client, fixture_name=args.fixture_name, identity=identity, variation=variation, order_count=args.orders, manifest_path=manifest, dry_run=args.dry_run, confirm_inventory_reviewed=args.confirm_inventory_reviewed)
    except SquareShowcaseError as exc:
        details = f" status={exc.status}" if exc.status is not None else ""
        if _safe_request_id(exc):
            details += f" request_id={_safe_request_id(exc)}"
        print(f"ERROR: {exc}{details}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    if args.dry_run:
        print("DRY RUN: no Square write endpoints were called.")
    else:
        print(f"Fixture completed. Keep the temporary access token out of logs and remove it from the local environment.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
