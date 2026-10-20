from decimal import Decimal

import pytest

from backend.pos import (
    PosInventorySourceConflict,
    PosProvider,
    eligible_sale_quantity,
    ensure_inventory_source,
    recipe_ingredient_quantity,
)


@pytest.mark.parametrize("state", ["OPEN", "CANCELED", "CANCELLED", "VOIDED"])
def test_only_completed_pos_sales_are_eligible_for_inventory(state):
    assert eligible_sale_quantity(state=state, is_deleted=False, quantity=2) == Decimal("0.0000")


def test_completed_sale_subtracts_refunded_quantity_once():
    assert eligible_sale_quantity(
        state="COMPLETED", is_deleted=False, quantity="3", refunded_quantity="1"
    ) == Decimal("2.0000")


def test_recipe_quantity_uses_yield_and_stock_unit_conversion():
    # 10 burgers with 0.25 kg per batch of 5 burgers = 0.5 kg.
    assert recipe_ingredient_quantity(
        sale_quantity=Decimal("10"), ingredient_quantity=Decimal("0.25"), yield_quantity=Decimal("5")
    ) == Decimal("0.5000")


def test_inventory_source_requires_known_and_explicit_provider():
    assert ensure_inventory_source(PosProvider.SQUARE) is PosProvider.SQUARE
    with pytest.raises(PosInventorySourceConflict):
        ensure_inventory_source("unknown")
    with pytest.raises(PosInventorySourceConflict):
        ensure_inventory_source(PosProvider.CLOVER, configured_provider=PosProvider.SQUARE)
