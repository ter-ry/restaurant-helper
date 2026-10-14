from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from backend.reporting import _date_range, _line_gross, _orders_for_period, _period_delta, _sales_totals


class Location:
    timezone = "America/Toronto"


def test_period_delta_has_no_fake_percent_for_zero_prior():
    result = _period_delta(10, 0)
    assert result["current"] == 10.0
    assert result["delta"] == 10.0
    assert result["percent"] is None


def test_daily_range_is_exact_and_weekly_has_equal_prior_window():
    daily = _date_range("daily", date(2026, 10, 7), None, Location())
    assert daily == (date(2026, 10, 7), date(2026, 10, 7), None, None)
    weekly = _date_range("weekly", date(2026, 10, 1), date(2026, 10, 7), Location())
    assert weekly == (date(2026, 10, 1), date(2026, 10, 7), date(2026, 9, 24), date(2026, 9, 30))


def test_line_gross_uses_authoritative_gross_or_safe_fallbacks_without_double_multiplication():
    order = SimpleNamespace()
    authoritative = SimpleNamespace(
        gross_amount=Decimal("18"),
        quantity=Decimal("2"),
        raw_payload_json={"gross_sales_money": {"amount": 3600, "currency": "CAD"}},
    )
    base_price_fallback = SimpleNamespace(
        gross_amount=Decimal("36"),
        quantity=Decimal("2"),
        raw_payload_json={"base_price_money": {"amount": 1800, "currency": "CAD"}},
    )
    persisted_fallback = SimpleNamespace(gross_amount=Decimal("36"), quantity=Decimal("2"), raw_payload_json={})
    assert _line_gross(order, authoritative) == Decimal("36")
    assert _line_gross(order, base_price_fallback) == Decimal("36")
    assert _line_gross(order, persisted_fallback) == Decimal("36")


def _showcase_order(order_number, quantity, *, discount="0", tip="0", state="COMPLETED", raw_line=None):
    # Raw line payload mirrors Square's current total_*_money field names and tax-free menu semantics.
    line_raw = raw_line or {
        "base_price_money": {"amount": 1800, "currency": "CAD"},
        "gross_sales_money": {"amount": int(1800 * quantity), "currency": "CAD"},
        "total_discount_money": {"amount": int(Decimal(discount) * 100), "currency": "CAD"},
        "total_tax_money": {"amount": 0, "currency": "CAD"},
        "total_money": {"amount": int((Decimal("18") * quantity - Decimal(discount)) * 100), "currency": "CAD"},
    }
    line = SimpleNamespace(
        quantity=Decimal(str(quantity)),
        gross_amount=Decimal("18") * quantity,
        discount_amount=Decimal(discount),
        tax_amount=Decimal("0"),
        tip_amount=Decimal("0"),
        net_amount=Decimal(str(line_raw.get("total_money", {}).get("amount", 0))) / 100,
        raw_payload_json=line_raw,
    )
    return SimpleNamespace(
        is_deleted=False,
        order_state=state,
        ordered_at=__import__("datetime").datetime(2026, 10, 4, 12, order_number, tzinfo=__import__("datetime").timezone.utc),
        closed_at=None,
        lines=[line],
        discount_amount=Decimal(discount),
        tax_amount=Decimal("0"),
        tip_amount=Decimal(tip),
        refund_amount=Decimal("0"),
    )


def test_showcase_eight_completed_orders_use_current_square_money_fields():
    quantities = [1, 2, 1, 1, 2, 1, 1, 1]
    discounts = ["0", "0", "0", "2.70", "0", "0", "0", "0"]
    tips = ["0", "0", "3.24", "0", "0", "1.26", "0", "0"]
    orders = [
        _showcase_order(index + 1, quantity, discount=discount, tip=tip)
        for index, (quantity, discount, tip) in enumerate(zip(quantities, discounts, tips))
    ]
    totals = _sales_totals(orders, [], date(2026, 10, 4), date(2026, 10, 4))
    assert totals["orders"] == 8
    assert totals["units"] == Decimal("10")
    assert totals["gross"] == Decimal("180")
    assert totals["discount"] == Decimal("2.70")
    assert totals["net_item_sales"] == Decimal("177.30")
    assert totals["tip"] == Decimal("4.50")
    assert totals["tax"] == Decimal("0")
    assert totals["refund"] == Decimal("0")
    assert totals["net"] == Decimal("181.80")


def test_sales_period_excludes_open_cancelled_and_voided_orders():
    completed = _showcase_order(1, 1)
    open_order = _showcase_order(2, 1, state="OPEN")
    canceled = _showcase_order(3, 1, state="CANCELED")
    cancelled = _showcase_order(4, 1, state="CANCELLED")
    voided = _showcase_order(5, 1, state="VOIDED")
    scoped = _orders_for_period([completed, open_order, canceled, cancelled, voided], Location(), date(2026, 10, 4), date(2026, 10, 4))
    assert scoped == [completed]
    totals = _sales_totals(scoped, [], date(2026, 10, 4), date(2026, 10, 4))
    assert totals["orders"] == 1
    assert totals["units"] == Decimal("1")
    assert totals["gross"] == Decimal("18")
