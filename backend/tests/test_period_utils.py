from datetime import date

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
    start, end = get_current_period(
        "monthly", "cardiversary",
        open_date=date(2024, 1, 31),
        reference_date=date(2025, 3, 15),
    )
    # dateutil rolls 2025-02-31 → 2025-02-28, then 2025-03-28 is after ref
    # so period should be [Feb 28, Mar 27]
    assert start == date(2025, 2, 28)
    assert end == date(2025, 3, 27)


# --- Edge case: today is exactly on period boundary ---

def test_cardiversary_on_boundary():
    start, end = get_current_period(
        "annual", "cardiversary",
        open_date=date(2023, 6, 1),
        reference_date=date(2025, 6, 1),
    )
    assert start == date(2025, 6, 1)
    assert end == date(2026, 5, 31)
