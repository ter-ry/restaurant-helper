from __future__ import annotations

from decimal import Decimal

AVERAGE_COST_PRECISION = Decimal("0.000001")


def _decimal(value: Decimal | int | float | str | None, default: str = "0") -> Decimal:
    if value in (None, ""):
        return Decimal(default)
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def stock_unit_cost_from_purchase(unit_price: Decimal | int | float | str | None, conversion_factor: Decimal | int | float | str | None) -> Decimal:
    price = _decimal(unit_price)
    factor = _decimal(conversion_factor, "1")
    if price <= 0 or factor <= 0:
        return Decimal("0")
    return (price / factor).quantize(AVERAGE_COST_PRECISION)


def weighted_average_inventory_cost(
    current_quantity: Decimal | int | float | str | None,
    current_average_unit_cost: Decimal | int | float | str | None,
    received_quantity: Decimal | int | float | str | None,
    received_unit_cost: Decimal | int | float | str | None,
) -> Decimal:
    quantity = _decimal(current_quantity)
    average_unit_cost = _decimal(current_average_unit_cost)
    receipt_quantity = _decimal(received_quantity)
    receipt_unit_cost = _decimal(received_unit_cost)

    if receipt_quantity <= 0 or receipt_unit_cost <= 0:
        return average_unit_cost.quantize(AVERAGE_COST_PRECISION) if average_unit_cost > 0 else Decimal("0")
    if quantity <= 0 or average_unit_cost <= 0:
        return receipt_unit_cost.quantize(AVERAGE_COST_PRECISION)

    total_quantity = quantity + receipt_quantity
    if total_quantity <= 0:
        return receipt_unit_cost.quantize(AVERAGE_COST_PRECISION)

    total_value = (quantity * average_unit_cost) + (receipt_quantity * receipt_unit_cost)
    if total_value <= 0:
        return Decimal("0")
    return (total_value / total_quantity).quantize(AVERAGE_COST_PRECISION)


def reverse_weighted_average_inventory_cost(
    current_quantity: Decimal | int | float | str | None,
    current_average_unit_cost: Decimal | int | float | str | None,
    removed_quantity: Decimal | int | float | str | None,
    removed_unit_cost: Decimal | int | float | str | None,
) -> Decimal:
    quantity = _decimal(current_quantity)
    average_unit_cost = _decimal(current_average_unit_cost)
    removal_quantity = _decimal(removed_quantity)
    removal_unit_cost = _decimal(removed_unit_cost)

    if removal_quantity <= 0:
        return average_unit_cost.quantize(AVERAGE_COST_PRECISION) if average_unit_cost > 0 else Decimal("0")
    if quantity <= 0 or average_unit_cost <= 0:
        return average_unit_cost.quantize(AVERAGE_COST_PRECISION) if average_unit_cost > 0 else Decimal("0")

    new_quantity = quantity - removal_quantity
    if new_quantity <= 0:
        return average_unit_cost.quantize(AVERAGE_COST_PRECISION)

    new_value = (quantity * average_unit_cost) - (removal_quantity * removal_unit_cost)
    if new_value <= 0:
        return Decimal("0")
    return (new_value / new_quantity).quantize(AVERAGE_COST_PRECISION)
