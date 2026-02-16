from dateutil.relativedelta import relativedelta

from sqlalchemy.orm import Session

from app.models.card import Card
from app.utils.timezone import get_today


def get_524_count(db: Session, profile_id: int, user_id: int | None = None) -> int:
    """Count personal cards opened in the last 24 months for a profile."""
    cutoff = get_today(db, user_id) - relativedelta(months=24)
    return (
        db.query(Card)
        .filter(
            Card.profile_id == profile_id,
            Card.card_type == "personal",
            Card.open_date != None,  # noqa: E711
            Card.open_date >= cutoff,
        )
        .count()
    )


def get_524_details(db: Session, profile_id: int, user_id: int | None = None) -> dict:
    """Get 5/24 count and per-card drop-off dates for a profile."""
    cutoff = get_today(db, user_id) - relativedelta(months=24)
    cards = (
        db.query(Card)
        .filter(
            Card.profile_id == profile_id,
            Card.card_type == "personal",
            Card.open_date != None,  # noqa: E711
            Card.open_date >= cutoff,
        )
        .order_by(Card.open_date)
        .all()
    )

    dropoff_dates = []
    for card in cards:
        dropoff = card.open_date + relativedelta(months=24)
        dropoff_dates.append({
            "card_id": card.id,
            "card_name": card.card_name,
            "open_date": card.open_date.isoformat(),
            "dropoff_date": dropoff.isoformat(),
        })

    count = len(cards)
    return {
        "count": count,
        "status": "green" if count < 4 else ("yellow" if count == 4 else "red"),
        "dropoff_dates": dropoff_dates,
    }
