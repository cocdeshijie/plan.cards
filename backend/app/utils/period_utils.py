from datetime import date

from dateutil.relativedelta import relativedelta


_FREQUENCY_MONTHS = {
    "monthly": 1,
    "quarterly": 3,
    "semi_annual": 6,
    "annual": 12,
}


def nth_anniversary(origin: date, months: int, n: int) -> date:
    """The nth anniversary of `origin`, `months` apart, computed FROM ORIGIN.

    Always `origin + relativedelta(months=months * n)` — never repeated addition
    onto the previous result. relativedelta clamps a day that doesn't exist in
    the target month (Jan 31 + 1 month -> Feb 28/29), and if you then add the
    next month to that *clamped* value the clamp becomes permanent and
    cumulative: a card opened 2024-01-31 with a monthly credit walks
    01-31 -> 02-29 -> 03-29 -> ... -> 02-28 and stays on the 28th forever, and a
    card opened 2024-02-29 never sees Feb 29 again even in a leap year.

    Recomputing from the origin self-corrects after every short month:
    01-31 -> 02-29 -> 03-31 -> 04-30 -> 05-31.
    """
    return origin + relativedelta(months=months * n)


def period_length_months(frequency: str) -> int:
    """How many months one period of `frequency` spans."""
    return _FREQUENCY_MONTHS.get(frequency, 12)


def period_end_for_start(frequency: str, start: date) -> date:
    """The last day of the period beginning at `start`."""
    return start + relativedelta(months=period_length_months(frequency)) - relativedelta(days=1)


def get_current_period(
    frequency: str,
    reset_type: str,
    open_date: date | None = None,
    reference_date: date | None = None,
) -> tuple[date, date]:
    """Return (period_start, period_end) for the current tracking period.

    For calendar resets, periods align to calendar boundaries.
    For cardiversary resets, periods align to the card's open_date anniversary.
    """
    ref = reference_date or date.today()

    if reset_type == "cardiversary" and open_date:
        return _cardiversary_period(frequency, open_date, ref)
    return _calendar_period(frequency, ref)


def _calendar_period(frequency: str, ref: date) -> tuple[date, date]:
    if frequency == "monthly":
        start = ref.replace(day=1)
        end = start + relativedelta(months=1) - relativedelta(days=1)
    elif frequency == "quarterly":
        quarter_month = ((ref.month - 1) // 3) * 3 + 1
        start = date(ref.year, quarter_month, 1)
        end = start + relativedelta(months=3) - relativedelta(days=1)
    elif frequency == "semi_annual":
        half_month = 1 if ref.month <= 6 else 7
        start = date(ref.year, half_month, 1)
        end = start + relativedelta(months=6) - relativedelta(days=1)
    else:  # annual
        start = date(ref.year, 1, 1)
        end = date(ref.year, 12, 31)
    return start, end


def _cardiversary_period(frequency: str, open_date: date, ref: date) -> tuple[date, date]:
    months = _FREQUENCY_MONTHS.get(frequency, 12)

    # Guard: if open_date is in the future, return the first period immediately
    if open_date > ref:
        return open_date, nth_anniversary(open_date, months, 1) - relativedelta(days=1)

    # Find n such that ref falls in [origin + n*months, origin + (n+1)*months).
    # Estimate from the month difference, then correct — the estimate can be off
    # by one when the day-of-month clamps.
    n = ((ref.year - open_date.year) * 12 + (ref.month - open_date.month)) // months
    while nth_anniversary(open_date, months, n) > ref:
        n -= 1
    while nth_anniversary(open_date, months, n + 1) <= ref:
        n += 1

    return (
        nth_anniversary(open_date, months, n),
        nth_anniversary(open_date, months, n + 1) - relativedelta(days=1),
    )
