"""Pure verification logic for explicitly verified free ($0) stock (#279 Phase A).

No database or endpoint access. A zero ``average_unit_cost`` is *unknown* unless covered by active,
unrevoked verification batches. Nothing here is wired into receipts or transfers yet; integration is #279.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Sequence

EVIDENCE_TYPES = ("supplier_free_goods", "donation", "promotional_sample", "other_documented")

STATUS_NO_STOCK = "no_stock"
STATUS_PRICED = "priced"
STATUS_UNVERIFIED_ZERO = "unverified_zero"
STATUS_PARTIAL_FREE = "partially_verified_free"
STATUS_VERIFIED_FREE = "verified_free"

ZERO = Decimal("0")


class VerificationError(ValueError):
    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


@dataclass(frozen=True)
class VerificationBatch:
    id: int
    organization_id: int
    location_id: int
    item_id: int
    quantity: Decimal
    consumed_quantity: Decimal = ZERO
    revoked: bool = False

    @property
    def remaining(self) -> Decimal:
        if self.revoked:
            return ZERO
        return max(self.quantity - self.consumed_quantity, ZERO)


@dataclass(frozen=True)
class CostBasis:
    status: str
    unit_cost: Decimal
    verified_free_quantity: Decimal
    unverified_quantity: Decimal


@dataclass(frozen=True)
class TransferCostDecision:
    allowed: bool
    unit_cost: Decimal
    verified_free: bool
    reason: str


def _dec(value) -> Decimal:
    if value in (None, ""):
        return ZERO
    return value if isinstance(value, Decimal) else Decimal(str(value))


def active_verified_quantity(batches: Iterable[VerificationBatch]) -> Decimal:
    return sum((batch.remaining for batch in batches), ZERO)


def classify_cost_basis(on_hand, average_unit_cost, batches: Sequence[VerificationBatch] = ()) -> CostBasis:
    """Classify an item's cost. Legacy zero cost with no evidence is ``unverified_zero``, never free."""
    stock = _dec(on_hand)
    average = _dec(average_unit_cost)
    if stock <= 0:
        return CostBasis(STATUS_NO_STOCK, average, ZERO, ZERO)
    # Evidence can never cover more than the physical stock.
    covered = min(active_verified_quantity(batches), stock)
    if average > 0:
        # Free units mixed into positive-cost stock are already blended into the weighted average; value is not fabricated.
        return CostBasis(STATUS_PRICED, average, covered, ZERO)
    if covered <= 0:
        return CostBasis(STATUS_UNVERIFIED_ZERO, ZERO, ZERO, stock)
    if covered >= stock:
        return CostBasis(STATUS_VERIFIED_FREE, ZERO, covered, ZERO)
    return CostBasis(STATUS_PARTIAL_FREE, ZERO, covered, stock - covered)


def zero_cost_transfer_decision(on_hand, average_unit_cost, quantity, batches: Sequence[VerificationBatch] = ()) -> TransferCostDecision:
    """What cost may travel with a transfer. $0 only when verified evidence covers the whole quantity."""
    stock = _dec(on_hand)
    average = _dec(average_unit_cost)
    qty = _dec(quantity)
    if qty <= 0:
        return TransferCostDecision(False, average, False, "quantity_not_positive")
    if qty > stock:
        return TransferCostDecision(False, average, False, "insufficient_stock")
    if average > 0:
        return TransferCostDecision(True, average, False, "priced_stock_uses_average_cost")
    if active_verified_quantity(batches) >= qty:
        return TransferCostDecision(True, ZERO, True, "verified_free")
    return TransferCostDecision(False, ZERO, False, "unknown_cost_not_verified_free")


def validate_new_verification(
    *,
    organization_id: int,
    location_id: int,
    item_organization_id: int,
    item_location_id: int,
    on_hand,
    quantity,
    evidence_type: str,
    evidence_note: str,
    existing_batches: Sequence[VerificationBatch] = (),
) -> None:
    """Raise ``VerificationError`` unless the evidence is in scope, documented and covers real, not-yet-verified stock."""
    if organization_id != item_organization_id:
        raise VerificationError("cross_tenant", "Item belongs to another organization.")
    if location_id != item_location_id:
        raise VerificationError("cross_location", "Item belongs to another location.")
    qty = _dec(quantity)
    if qty <= 0:
        raise VerificationError("quantity_not_positive")
    if evidence_type not in EVIDENCE_TYPES:
        raise VerificationError("evidence_type_invalid")
    if not (evidence_note or "").strip():
        raise VerificationError("evidence_missing", "A free-stock verification needs a written evidence note.")
    unverified = _dec(on_hand) - active_verified_quantity(existing_batches)
    if qty > unverified:
        raise VerificationError("exceeds_unverified_stock", "Cannot verify more stock than is on hand and not already verified.")


def verification_fingerprint(*, item_id: int, quantity, evidence_type: str, evidence_note: str = "", source_type: str = "", source_record_id: str = "", source_line_id: str = "") -> tuple:
    """Everything that defines the request, including the justification text (a changed note is a changed request)."""
    return (item_id, _dec(quantity).normalize(), evidence_type, (evidence_note or "").strip(), source_type, source_record_id, source_line_id)


def idempotent_outcome(existing_fingerprint: tuple | None, new_fingerprint: tuple) -> str:
    """``create`` (key unseen), ``replay`` (same key, same request) or ``conflict`` (same key, different request)."""
    if existing_fingerprint is None:
        return "create"
    return "replay" if existing_fingerprint == new_fingerprint else "conflict"


def validate_revocation(batch: VerificationBatch, reason: str) -> None:
    if batch.revoked:
        raise VerificationError("already_revoked")
    if not (reason or "").strip():
        raise VerificationError("revocation_reason_missing")


def validate_correction(batch: VerificationBatch, corrected_quantity) -> None:
    """A correction revokes the original and records a new batch; it cannot drop below what was already consumed at $0."""
    if batch.revoked:
        raise VerificationError("already_revoked")
    qty = _dec(corrected_quantity)
    if qty <= 0:
        raise VerificationError("quantity_not_positive")
    if qty < batch.consumed_quantity:
        raise VerificationError("below_consumed_quantity", "Corrected quantity is less than stock already consumed at $0.")
