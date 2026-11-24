"""Verified-free evidence shrinks when stock is consumed (#311). Hand-calculated values."""
from __future__ import annotations

from decimal import Decimal

from backend.extensions import db
from backend.models import InventoryItem
from backend.tests.test_inventory_transfers import world  # noqa: F401  (fixture)
from backend.tests.test_verified_free_transfers import _rows, _transfer, _verify, _zero


def _set_on_hand(app, item_id, value):
    with app.app_context():
        db.session.get(InventoryItem, item_id).current_on_hand = Decimal(value)
        db.session.commit()


def test_consumption_shrinks_evidence_oldest_first_and_increase_does_not_restore(app, client, world):  # noqa: F811
    item = world["flour_main"]
    _zero(app, item)  # on hand 5
    assert _verify(client, item, 3).status_code == 201
    assert _verify(client, item, 2).status_code == 201
    assert _rows(app, item) == [(Decimal("3"), Decimal("0"), False), (Decimal("2"), Decimal("0"), False)]

    _set_on_hand(app, item, "4")  # POS-style decrease of 1: cap 4, remaining 5 -> consume 1 from oldest
    assert _rows(app, item) == [(Decimal("3"), Decimal("1"), False), (Decimal("2"), Decimal("0"), False)]
    _set_on_hand(app, item, "1")  # remaining 4 -> cap 1: consume 2 more from first, 1 from second
    assert _rows(app, item) == [(Decimal("3"), Decimal("3"), False), (Decimal("2"), Decimal("1"), False)]
    _set_on_hand(app, item, "9")  # increases never restore evidence
    assert _rows(app, item) == [(Decimal("3"), Decimal("3"), False), (Decimal("2"), Decimal("1"), False)]


def test_stale_evidence_cannot_verify_new_unverified_zero_cost_stock(app, client, world):  # noqa: F811
    item = world["flour_main"]
    _zero(app, item)
    assert _verify(client, item, 5).status_code == 201
    _set_on_hand(app, item, "0")  # all free stock consumed
    assert _rows(app, item) == [(Decimal("5"), Decimal("5"), False)]
    _set_on_hand(app, item, "5")  # count increase at $0: unverified
    assert _transfer(client, world, quantity=4).status_code == 409
    assert _rows(app, item) == [(Decimal("5"), Decimal("5"), False)]
