"""Keep verified-free evidence honest when stock is consumed (#311, #279 carried-forward limit).

Invariant: unrevoked remaining evidence for an item never exceeds its on-hand quantity. Any flush that lowers
``InventoryItem.current_on_hand`` (POS consumption, waste, count, invoice void, ...) consumes evidence oldest first
in the same transaction, so stale evidence can never later "cover" new unverified zero-cost stock. Increases never
restore evidence. No Square/Clover adapter code is involved.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

ZERO = Decimal("0")


def _shrink_item_evidence(session: Session, item) -> None:
    from .models import InventoryCostVerification

    cap = max(Decimal(item.current_on_hand or 0), ZERO)
    with session.no_autoflush:
        rows = (
            session.query(InventoryCostVerification)
            .filter_by(organization_id=item.organization_id, location_id=item.location_id, inventory_item_id=item.id)
            .filter(InventoryCostVerification.revoked_at.is_(None))
            .order_by(InventoryCostVerification.id)
            .with_for_update()
            .all()
        )
    remaining = sum((Decimal(r.quantity) - Decimal(r.consumed_quantity or 0) for r in rows), ZERO)
    excess = remaining - cap
    for row in rows:
        if excess <= 0:
            break
        take = min(excess, Decimal(row.quantity) - Decimal(row.consumed_quantity or 0))
        if take > 0:
            row.consumed_quantity = Decimal(row.consumed_quantity or 0) + take
            excess -= take


@event.listens_for(Session, "before_flush")
def _shrink_evidence_on_stock_decrease(session: Session, flush_context, instances) -> None:
    from .models import InventoryItem

    for obj in list(session.dirty):
        if not isinstance(obj, InventoryItem) or obj.id is None:
            continue
        history = inspect(obj).attrs.current_on_hand.history
        if not history.has_changes() or not history.deleted:
            continue
        old, new = history.deleted[0], obj.current_on_hand
        if old is None or new is None or Decimal(new) >= Decimal(old):
            continue
        _shrink_item_evidence(session, obj)
