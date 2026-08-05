from datetime import date, timedelta

from app.utils.period_utils import get_current_period


# --- Calendar monthly ---

def test_calendar_monthly_mid_month():
    start, end = get_current_period("monthly", "calendar", reference_date=date(2025, 3, 15))
    assert start == date(2025, 3, 1)
    assert end == date(2025, 3, 31)


def test_calendar_monthly_first_day():
    start, end = get_current_period("monthly", "calendar", reference_date=date(2025, 1, 1))
    assert start == date(2025, 1, 1)
    assert end == date(2025, 1, 31)


def test_calendar_monthly_last_day():
    start, end = get_current_period("monthly", "calendar", reference_date=date(2025, 2, 28))
    assert start == date(2025, 2, 1)
    assert end == date(2025, 2, 28)


# --- Calendar quarterly ---

def test_calendar_quarterly_q1():
    start, end = get_current_period("quarterly", "calendar", reference_date=date(2025, 2, 15))
    assert start == date(2025, 1, 1)
    assert end == date(2025, 3, 31)


def test_calendar_quarterly_q4():
    start, end = get_current_period("quarterly", "calendar", reference_date=date(2025, 12, 1))
    assert start == date(2025, 10, 1)
    assert end == date(2025, 12, 31)


# --- Calendar semi_annual ---

def test_calendar_semi_annual_h1():
    start, end = get_current_period("semi_annual", "calendar", reference_date=date(2025, 4, 10))
    assert start == date(2025, 1, 1)
    assert end == date(2025, 6, 30)


def test_calendar_semi_annual_h2():
    start, end = get_current_period("semi_annual", "calendar", reference_date=date(2025, 9, 1))
    assert start == date(2025, 7, 1)
    assert end == date(2025, 12, 31)


# --- Calendar annual ---

def test_calendar_annual():
    start, end = get_current_period("annual", "calendar", reference_date=date(2025, 6, 15))
    assert start == date(2025, 1, 1)
    assert end == date(2025, 12, 31)


# --- Cardiversary monthly ---

def test_cardiversary_monthly():
    start, end = get_current_period(
        "monthly", "cardiversary",
        open_date=date(2024, 1, 15),
        reference_date=date(2025, 3, 20),
    )
    assert start == date(2025, 3, 15)
    assert end == date(2025, 4, 14)


# --- Cardiversary annual ---

def test_cardiversary_annual():
    start, end = get_current_period(
        "annual", "cardiversary",
        open_date=date(2023, 6, 1),
        reference_date=date(2025, 8, 15),
    )
    assert start == date(2025, 6, 1)
    assert end == date(2026, 5, 31)


# --- Cardiversary quarterly ---

def test_cardiversary_quarterly():
    start, end = get_current_period(
        "quarterly", "cardiversary",
        open_date=date(2024, 3, 10),
        reference_date=date(2025, 4, 5),
    )
    assert start == date(2025, 3, 10)
    assert end == date(2025, 6, 9)


# --- Edge case: card opened on 31st ---

def test_cardiversary_open_on_31st():
    """A short month clamps that period only — it must not shift every period
    after it. Anniversaries are recomputed from open_date, so the series is
    ... 2025-01-31, 2025-02-28, 2025-03-31 ... and Feb's clamp does not drag
    March back to the 28th.
    """
    start, end = get_current_period(
        "monthly", "cardiversary",
        open_date=date(2024, 1, 31),
        reference_date=date(2025, 3, 15),
    )
    assert start == date(2025, 2, 28)
    assert end == date(2025, 3, 30)  # day before the 2025-03-31 anniversary


def test_cardiversary_month_end_does_not_ratchet():
    """Regression: adding the delta to the previously *clamped* date walked a
    card opened on the 31st down to the 28th permanently."""
    open_date = date(2024, 1, 31)
    expected_starts = [
        date(2024, 1, 31), date(2024, 2, 29), date(2024, 3, 31), date(2024, 4, 30),
        date(2024, 5, 31), date(2024, 6, 30), date(2024, 7, 31), date(2024, 8, 31),
    ]
    ref = open_date
    for expected in expected_starts:
        start, end = get_current_period("monthly", "cardiversary", open_date, ref)
        assert start == expected, f"expected period starting {expected}, got {start}"
        ref = end + timedelta(days=1)


def test_cardiversary_leap_day_returns_in_leap_years():
    """Regression: a card opened on Feb 29 never saw Feb 29 again."""
    open_date = date(2024, 2, 29)
    starts = []
    ref = open_date
    for _ in range(5):
        start, end = get_current_period("annual", "cardiversary", open_date, ref)
        starts.append(start)
        ref = end + timedelta(days=1)
    assert starts == [
        date(2024, 2, 29), date(2025, 2, 28), date(2026, 2, 28),
        date(2027, 2, 28), date(2028, 2, 29),
    ]


def test_reference_date_always_falls_inside_returned_period():
    """The period returned must actually contain the reference date."""
    for open_date in (date(2024, 1, 31), date(2024, 2, 29), date(2020, 12, 31), date(2024, 6, 15)):
        for frequency in ("monthly", "quarterly", "semi_annual", "annual"):
            for offset in range(0, 1200, 13):
                ref = open_date + timedelta(days=offset)
                start, end = get_current_period(frequency, "cardiversary", open_date, ref)
                assert start <= ref <= end, (
                    f"{frequency} period [{start}, {end}] does not contain {ref} "
                    f"(open_date={open_date})"
                )


# --- Edge case: today is exactly on period boundary ---

def test_cardiversary_on_boundary():
    start, end = get_current_period(
        "annual", "cardiversary",
        open_date=date(2023, 6, 1),
        reference_date=date(2025, 6, 1),
    )
    assert start == date(2025, 6, 1)
    assert end == date(2026, 5, 31)
