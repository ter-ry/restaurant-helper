from datetime import date

from backend.reporting import _date_range, _period_delta


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
