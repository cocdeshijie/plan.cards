from datetime import date

from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.card_benefit import CardBenefit
from app.models.profile import Profile
from app.schemas.card_benefit import (
    CardBenefitCreate,
    CardBenefitUpdate,
    BenefitUsageUpdate,
    CardBenefitOut,
    BenefitSummaryItem,
)
from app.utils.period_utils import get_current_period, period_end_for_start
from app.utils.timezone import get_today


def _refresh_period(benefit: CardBenefit, card_open_date: date | None, today: date) -> None:
    """Re-anchor the benefit to the current period, resetting usage if it lapsed.

    `today` MUST be the user's timezone-local date. Using the server's date
    rolls the period over at UTC midnight, which for a Los Angeles user wipes
    March's amount_used at 17:00 on March 31.

    The comparison is `!=`, not `<`. A one-sided check only handles time moving
    forward; it silently does nothing when the *anchor* moves — editing a card's
    open_date backwards left period_start stranded in a period that no longer
    exists, so the API returned a period_start later than its own period_end and
    a monthly credit stopped resetting entirely.

    When re-anchoring, usage carries over if the old period overlaps the new one
    (the anchor shifted within the same window) and resets if it does not (a
    genuine rollover, or a move to an unrelated period).
    """
    if benefit.retired:
        return
    period_start, _ = get_current_period(
        benefit.frequency, benefit.reset_type, card_open_date, today
    )
    if benefit.period_start == period_start:
        return

    if benefit.period_start is not None:
        old_end = period_end_for_start(benefit.frequency, benefit.period_start)
        if old_end >= period_start:
            # Overlapping window — keep what the user recorded.
            benefit.period_start = period_start
            return

    benefit.amount_used = 0
    benefit.period_start = period_start


def _benefit_to_out(benefit: CardBenefit, card_open_date: date | None, today: date | None = None) -> CardBenefitOut:
    """Convert model to response with computed fields."""
    if today is None:
        today = date.today()
    # Same `today` drives the period and the countdown; mixing a server-date
    # period with a user-date "today" produced "Resets Mar 31 · 0d left" on Apr 1.
    period_start, period_end = get_current_period(
        benefit.frequency, benefit.reset_type, card_open_date, today
    )
    days_until_reset = (period_end - today).days + 1 if period_end >= today else 0

    reset_label = _make_reset_label(period_end, benefit.reset_type)

    return CardBenefitOut(
        id=benefit.id,
        card_id=benefit.card_id,
        benefit_name=benefit.benefit_name,
        benefit_amount=benefit.benefit_amount,
        frequency=benefit.frequency,
        reset_type=benefit.reset_type,
        benefit_type=benefit.benefit_type,
        from_template=benefit.from_template,
        retired=benefit.retired,
        notes=benefit.notes,
        amount_used=benefit.amount_used,
        # Report the computed start, not the stored one: they agree after
        # _refresh_period, and this can never emit start > end.
        period_start=period_start,
        period_end=period_end,
        days_until_reset=days_until_reset,
        reset_label=reset_label,
        created_at=benefit.created_at,
    )


def _make_reset_label(period_end: date, reset_type: str) -> str:
    label = f"Resets {period_end.strftime('%b %-d')}"
    if reset_type == "cardiversary":
        label += " (cardiversary)"
    return label


def list_benefits(db: Session, card: Card, user_id: int | None = None) -> list[CardBenefitOut]:
    benefits = db.query(CardBenefit).filter(CardBenefit.card_id == card.id).all()
    today = get_today(db, user_id)
    for b in benefits:
        _refresh_period(b, card.open_date, today)
    db.commit()
    return [_benefit_to_out(b, card.open_date, today) for b in benefits]


def create_benefit(db: Session, card: Card, data: CardBenefitCreate, user_id: int | None = None) -> CardBenefitOut:
    today = get_today(db, user_id)
    period_start, _ = get_current_period(
        data.frequency, data.reset_type, card.open_date, today
    )
    benefit = CardBenefit(
        card_id=card.id,
        benefit_name=data.benefit_name,
        benefit_amount=data.benefit_amount,
        frequency=data.frequency,
        reset_type=data.reset_type,
        benefit_type=data.benefit_type,
        notes=data.notes,
        amount_used=0,
        period_start=period_start,
    )
    db.add(benefit)
    db.commit()
    db.refresh(benefit)
    return _benefit_to_out(benefit, card.open_date, today)


def update_benefit(
    db: Session, benefit: CardBenefit, card: Card, data: CardBenefitUpdate, user_id: int | None = None
) -> CardBenefitOut:
    today = get_today(db, user_id)
    update_data = data.model_dump(exclude_unset=True)
    old_frequency = benefit.frequency
    old_reset_type = benefit.reset_type
    for field, value in update_data.items():
        setattr(benefit, field, value)

    # The user has taken ownership: template sync must stop overwriting this.
    # Without it, every edit to a template-sourced credit was silently reverted
    # on the next version bump.
    if update_data:
        benefit.user_modified = True

    # Only reset tracking if frequency or reset_type actually changed
    if benefit.frequency != old_frequency or benefit.reset_type != old_reset_type:
        period_start, _ = get_current_period(
            benefit.frequency, benefit.reset_type, card.open_date, today
        )
        benefit.period_start = period_start
        benefit.amount_used = 0

    db.commit()
    db.refresh(benefit)
    return _benefit_to_out(benefit, card.open_date, today)


def delete_benefit(db: Session, benefit: CardBenefit) -> None:
    db.delete(benefit)
    db.commit()


def update_usage(
    db: Session, benefit: CardBenefit, card: Card, data: BenefitUsageUpdate, user_id: int | None = None
) -> CardBenefitOut:
    today = get_today(db, user_id)
    _refresh_period(benefit, card.open_date, today)
    benefit.amount_used = data.amount_used
    db.commit()
    db.refresh(benefit)
    return _benefit_to_out(benefit, card.open_date, today)


def populate_from_template(
    db: Session, card: Card, credits: list[dict], user_id: int | None = None
) -> list[CardBenefitOut]:
    """Bulk create benefits from template credit list, skipping duplicates by name."""
    existing_names = {
        b.benefit_name
        for b in db.query(CardBenefit).filter(CardBenefit.card_id == card.id).all()
    }
    today = get_today(db, user_id)
    results = []
    for credit in credits:
        if credit["name"] in existing_names:
            continue
        period_start, _ = get_current_period(
            credit["frequency"],
            credit.get("reset_type", "calendar"),
            card.open_date,
            today,
        )
        benefit = CardBenefit(
            card_id=card.id,
            benefit_name=credit["name"],
            benefit_amount=credit["amount"],
            frequency=credit["frequency"],
            reset_type=credit.get("reset_type", "calendar"),
            benefit_type=credit.get("benefit_type", "credit"),
            from_template=True,
            amount_used=0,
            notes=credit.get("notes"),
            period_start=period_start,
        )
        db.add(benefit)
        results.append(benefit)
    db.commit()
    for b in results:
        db.refresh(b)
    return [_benefit_to_out(b, card.open_date, today) for b in results]


def list_all_benefits(
    db: Session, profile_id: int | None = None, user_id: int | None = None
) -> list[BenefitSummaryItem]:
    """Return all non-retired benefits from active cards, with card/profile context."""
    query = (
        db.query(CardBenefit, Card, Profile)
        .join(Card, CardBenefit.card_id == Card.id)
        .join(Profile, Card.profile_id == Profile.id)
        .filter(Card.status == "active")
        .filter(Card.deleted_at == None)  # noqa: E711
        .filter(CardBenefit.retired == False)  # noqa: E712
    )
    if user_id is not None:
        query = query.filter(Profile.user_id == user_id)
    if profile_id is not None:
        query = query.filter(Card.profile_id == profile_id)

    rows = query.all()
    today = get_today(db, user_id)

    results = []
    for benefit, card, profile in rows:
        _refresh_period(benefit, card.open_date, today)
        out = _benefit_to_out(benefit, card.open_date, today)
        results.append(BenefitSummaryItem(
            **out.model_dump(),
            card_name=card.card_name,
            issuer=card.issuer,
            last_digits=card.last_digits,
            template_id=card.template_id,
            card_image=card.card_image,
            profile_id=profile.id,
            profile_name=profile.name,
        ))
    db.commit()
    return results
