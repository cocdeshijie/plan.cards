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
from app.utils.period_utils import get_current_period
from app.utils.timezone import get_today


def _refresh_period(benefit: CardBenefit, card_open_date: date | None) -> None:
    """If stored period_start is from a previous period, reset amount_used and update period_start."""
    if benefit.retired:
        return
    period_start, _ = get_current_period(
        benefit.frequency, benefit.reset_type, card_open_date
    )
    if benefit.period_start is None or benefit.period_start < period_start:
        benefit.amount_used = 0
        benefit.period_start = period_start


def _benefit_to_out(benefit: CardBenefit, card_open_date: date | None, today: date | None = None) -> CardBenefitOut:
    """Convert model to response with computed fields."""
    period_start, period_end = get_current_period(
        benefit.frequency, benefit.reset_type, card_open_date
    )
    if today is None:
        today = date.today()
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
        period_start=benefit.period_start,
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
    for b in benefits:
        _refresh_period(b, card.open_date)
    db.commit()
    today = get_today(db, user_id)
    return [_benefit_to_out(b, card.open_date, today) for b in benefits]


def create_benefit(db: Session, card: Card, data: CardBenefitCreate, user_id: int | None = None) -> CardBenefitOut:
    period_start, _ = get_current_period(
        data.frequency, data.reset_type, card.open_date
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
    return _benefit_to_out(benefit, card.open_date, get_today(db, user_id))


def update_benefit(
    db: Session, benefit: CardBenefit, card: Card, data: CardBenefitUpdate, user_id: int | None = None
) -> CardBenefitOut:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(benefit, field, value)

    # Recompute period if frequency or reset_type changed
    if "frequency" in update_data or "reset_type" in update_data:
        period_start, _ = get_current_period(
            benefit.frequency, benefit.reset_type, card.open_date
        )
        benefit.period_start = period_start
        benefit.amount_used = 0

    db.commit()
    db.refresh(benefit)
    return _benefit_to_out(benefit, card.open_date, get_today(db, user_id))


def delete_benefit(db: Session, benefit: CardBenefit) -> None:
    db.delete(benefit)
    db.commit()


def update_usage(
    db: Session, benefit: CardBenefit, card: Card, data: BenefitUsageUpdate, user_id: int | None = None
) -> CardBenefitOut:
    _refresh_period(benefit, card.open_date)
    benefit.amount_used = data.amount_used
    db.commit()
    db.refresh(benefit)
    return _benefit_to_out(benefit, card.open_date, get_today(db, user_id))


def populate_from_template(
    db: Session, card: Card, credits: list[dict], user_id: int | None = None
) -> list[CardBenefitOut]:
    """Bulk create benefits from template credit list, skipping duplicates by name."""
    existing_names = {
        b.benefit_name
        for b in db.query(CardBenefit).filter(CardBenefit.card_id == card.id).all()
    }
    results = []
    for credit in credits:
        if credit["name"] in existing_names:
            continue
        period_start, _ = get_current_period(
            credit["frequency"],
            credit.get("reset_type", "calendar"),
            card.open_date,
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
    today = get_today(db, user_id)
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
        _refresh_period(benefit, card.open_date)
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
