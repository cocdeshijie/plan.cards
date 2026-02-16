from datetime import date

from dateutil.relativedelta import relativedelta


_FREQUENCY_DELTA = {
    "monthly": relativedelta(months=1),
    "quarterly": relativedelta(months=3),
    "semi_annual": relativedelta(months=6),
    "annual": relativedelta(years=1),
}


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
    delta = _FREQUENCY_DELTA.get(frequency, relativedelta(years=1))

    # Walk forward from open_date to find the period containing ref
    cursor = open_date
    while True:
        next_cursor = cursor + delta
        if next_cursor > ref:
            # ref is in the period [cursor, next_cursor - 1 day]
            return cursor, next_cursor - relativedelta(days=1)
        cursor = next_cursor
