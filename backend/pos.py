"""Provider-neutral POS value objects and inventory calculation boundaries.

This module intentionally contains no persistence or provider API code.  POS
adapters normalize their payloads here before the shared recipe-consumption
rules run.  Square remains the only adapter today; Clover can implement the
same contract in a later integration without duplicating inventory logic.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import Enum


class PosProvider(str, Enum):
    SQUARE = "square"
    CLOVER = "clover"


class PosPaymentState(str, Enum):
    UNKNOWN = "unknown"
    UNPAID = "unpaid"
    PAID = "paid"
    REFUNDED = "refunded"


@dataclass(frozen=True)
class PosMoney:
    amount: Decimal
    currency: str


@dataclass(frozen=True)
class PosMappingEligibility:
    mapped: bool
    eligible_for_inventory: bool
    reason: str = ""


class PosInventorySourceConflict(ValueError):
    """Raised when an adapter tries to use a different POS source for a scope."""


@dataclass(frozen=True)
class PosMerchantIdentity:
    provider: PosProvider
    merchant_id: str


@dataclass(frozen=True)
class PosLocationIdentity:
    provider: PosProvider
    merchant_id: str
    location_id: str


@dataclass(frozen=True)
class PosOrderLine:
    external_line_id: str
    catalog_variation_id: str
    quantity: Decimal
    refunded_quantity: Decimal = Decimal("0")
    modifiers: tuple[str, ...] = ()


@dataclass(frozen=True)
class PosOrder:
    provider: PosProvider
    external_order_id: str
    merchant_id: str
    location_id: str
    state: str
    payment_state: PosPaymentState = PosPaymentState.UNKNOWN
    gross: PosMoney | None = None
    discount: PosMoney | None = None
    tax: PosMoney | None = None
    tip: PosMoney | None = None
    refund: PosMoney | None = None
    total: PosMoney | None = None
    ordered_at: object | None = None
    updated_at: object | None = None
    lines: tuple[PosOrderLine, ...] = ()


def ensure_inventory_source(provider: PosProvider, configured_provider: PosProvider | None = None) -> PosProvider:
    """Require an explicit, known provider before automatic depletion.

    The provider is part of the shared boundary even though the current
    persistence model is Square-specific.  A future adapter must not silently
    reuse another provider's inventory source.
    """
    try:
        normalized = PosProvider(provider)
    except (TypeError, ValueError) as exc:
        raise PosInventorySourceConflict("Unknown POS provider cannot consume inventory.") from exc
    if configured_provider is not None and normalized != PosProvider(configured_provider):
        raise PosInventorySourceConflict("POS providers cannot share an inventory source implicitly.")
    return normalized


def eligible_sale_quantity(*, state: str, is_deleted: bool, quantity: Decimal | int | str, refunded_quantity: Decimal | int | str = Decimal("0"), quantum: Decimal = Decimal("0.0001")) -> Decimal:
    """Return the finalized, non-refunded quantity eligible for depletion."""
    if is_deleted or str(state or "").upper() != "COMPLETED":
        return Decimal("0")
    try:
        sold = Decimal(str(quantity or 0))
        refunded = Decimal(str(refunded_quantity or 0))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")
    return max(sold - max(refunded, Decimal("0")), Decimal("0")).quantize(quantum)


def recipe_ingredient_quantity(*, sale_quantity: Decimal, ingredient_quantity: Decimal, yield_quantity: Decimal, quantum: Decimal = Decimal("0.0001")) -> Decimal:
    """Convert a finalized sale quantity into one recipe ingredient quantity."""
    if sale_quantity <= 0 or ingredient_quantity <= 0 or yield_quantity <= 0:
        return Decimal("0")
    return (sale_quantity * ingredient_quantity / yield_quantity).quantize(quantum)
