import re
from datetime import date

from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.card_benefit import CardBenefit
from app.models.card_bonus import CardBonus
from app.models.card_event import CardEvent
from app.schemas.card import CardCreate, CardUpdate
from app.services.template_loader import get_template, get_old_version, get_template_versions
from app.utils.period_utils import get_current_period
from app.utils.timezone import get_today


def _build_fee_timeline(template_id: str, current_fee: int) -> dict[int, int]:
    """Build a year→annual_fee mapping from template version history.

    For each version_id matching pattern `_YYYY_`, extract the year and fee.
    Returns a dict like {2024: 695, 2025: 895}.
    Falls back to {current year: current_fee} if no versions found.
    """
    versions = get_template_versions(template_id)
    timeline: dict[int, int] = {}
    for v in versions:
        if v.annual_fee is None:
            continue
        match = re.search(r"_(\d{4})_", v.version_id)
        if match:
            year = int(match.group(1))
            timeline[year] = v.annual_fee
    return timeline


def _get_fee_for_year(timeline: dict[int, int], year: int) -> int | None:
    """Look up the fee for a given anniversary year from the timeline.

    Finds the latest version year <= the anniversary year.
    If none found, uses the oldest version's fee.
    """
    if not timeline:
        return None
    applicable = [y for y in timeline if y <= year]
    if applicable:
        return timeline[max(applicable)]
    # Pre-history: use oldest known version's fee
    return timeline[min(timeline)]


def _populate_benefits_from_template(
    db: Session,
    card_id: int,
    template_id: str,
    open_date: date | None,
    version_id: str | None = None,
) -> None:
    """Populate benefits from a template (or a specific old version)."""
    credits = None
    spend_thresholds = None

    if version_id:
        # Check if it's the current version
        tmpl = get_template(template_id)
        if tmpl and tmpl.version_id == version_id:
            if tmpl.benefits:
                credits = tmpl.benefits.credits
                spend_thresholds = tmpl.benefits.spend_thresholds
        else:
            old_ver = get_old_version(template_id, version_id)
            if old_ver and old_ver.benefits:
                credits = old_ver.benefits.credits
                spend_thresholds = old_ver.benefits.spend_thresholds
    else:
        tmpl = get_template(template_id)
        if tmpl and tmpl.benefits:
            credits = tmpl.benefits.credits
            spend_thresholds = tmpl.benefits.spend_thresholds

    if credits:
        for credit in credits:
            period_start, _ = get_current_period(
                credit.frequency,
                credit.reset_type,
                open_date,
            )
            benefit = CardBenefit(
                card_id=card_id,
                benefit_name=credit.name,
                benefit_amount=credit.amount,
                frequency=credit.frequency,
                reset_type=credit.reset_type,
                from_template=True,
                amount_used=0,
                period_start=period_start,
            )
            db.add(benefit)

    if spend_thresholds:
        for threshold in spend_thresholds:
            period_start, _ = get_current_period(
                threshold.frequency,
                threshold.reset_type,
                open_date,
            )
            benefit = CardBenefit(
                card_id=card_id,
                benefit_name=threshold.name,
                benefit_amount=threshold.spend_required,
                frequency=threshold.frequency,
                reset_type=threshold.reset_type,
                benefit_type="spend_threshold",
                from_template=True,
                amount_used=0,
                notes=threshold.description,
                period_start=period_start,
            )
            db.add(benefit)


def create_card(db: Session, data: CardCreate, user_id: int | None = None) -> Card:
    # Resolve template version_id if creating from template
    template_version_id = None
    use_old_version = False
    if data.template_id:
        if data.template_version_id:
            # User selected a specific (possibly old) version
            template_version_id = data.template_version_id
            # Check if it differs from current
            tmpl = get_template(data.template_id)
            if tmpl and tmpl.version_id != data.template_version_id:
                use_old_version = True
        else:
            tmpl = get_template(data.template_id)
            if tmpl:
                template_version_id = tmpl.version_id

    card = Card(
        profile_id=data.profile_id,
        template_id=data.template_id,
        template_version_id=template_version_id,
        card_image=data.card_image,
        card_name=data.card_name,
        last_digits=data.last_digits,
        issuer=data.issuer,
        network=data.network,
        card_type=data.card_type,
        status=data.status,
        open_date=data.open_date,
        close_date=data.close_date,
        annual_fee=data.annual_fee,
        annual_fee_date=data.annual_fee_date,
        credit_limit=data.credit_limit,
        custom_notes=data.custom_notes,
        custom_tags=data.custom_tags,
        spend_reminder_enabled=data.spend_reminder_enabled,
        spend_requirement=data.spend_requirement,
        spend_deadline=data.spend_deadline,
        spend_reminder_notes=data.spend_reminder_notes,
        signup_bonus_amount=data.signup_bonus_amount,
        signup_bonus_type=data.signup_bonus_type,
        signup_bonus_earned=data.signup_bonus_earned,
    )
    # Auto-clear annual_fee_date when fee is 0 or None (matches update_card behavior)
    if card.annual_fee is None or card.annual_fee == 0:
        card.annual_fee_date = None

    db.add(card)
    db.flush()

    # Create "opened" event if open_date is provided
    if data.open_date:
        event = CardEvent(
            card_id=card.id,
            event_type="opened",
            event_date=data.open_date,
            description=f"Opened {data.card_name}",
        )
        db.add(event)

    # Auto-populate benefits from template
    if data.template_id:
        _populate_benefits_from_template(
            db,
            card.id,
            data.template_id,
            data.open_date,
            version_id=data.template_version_id if use_old_version else None,
        )

    # Auto-generate past annual fee events (including first year at open_date)
    if data.open_date and data.annual_fee and data.annual_fee > 0:
        today = get_today(db, user_id)
        fee_timeline: dict[int, int] = {}
        if data.template_id:
            fee_timeline = _build_fee_timeline(data.template_id, data.annual_fee)

        # Start from open_date (first year fee), then each anniversary
        anniversary = data.open_date
        while anniversary <= today:
            fee = (
                _get_fee_for_year(fee_timeline, anniversary.year)
                if fee_timeline
                else data.annual_fee
            )
            if fee is None:
                fee = data.annual_fee
            af_event = CardEvent(
                card_id=card.id,
                event_type="annual_fee_posted",
                event_date=anniversary,
                metadata_json={"annual_fee": fee, "approximate_date": True},
            )
            db.add(af_event)
            anniversary = anniversary + relativedelta(years=1)
        # Set annual_fee_date to the next upcoming anniversary if not already set
        if not data.annual_fee_date:
            card.annual_fee_date = anniversary

    db.commit()
    db.refresh(card)
    return card


def update_card(db: Session, card: Card, data: CardUpdate, user_id: int | None = None) -> Card:
    old_open_date = card.open_date
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(card, field, value)

    # Auto-clear annual_fee_date when fee set to 0 or None
    if "annual_fee" in update_data and (card.annual_fee is None or card.annual_fee == 0):
        card.annual_fee_date = None

    # Track that user manually modified the annual fee
    if "annual_fee" in update_data:
        card.annual_fee_user_modified = True

    # Validate spend_reminder cross-field dependency
    if card.spend_reminder_enabled and not (card.spend_requirement and card.spend_deadline):
        raise ValueError("spend_reminder_enabled requires both spend_requirement and spend_deadline")

    # Backfill AF events if open_date was just set and card has annual_fee
    if old_open_date is None and card.open_date and card.annual_fee and card.annual_fee > 0:
        existing_af = (
            db.query(CardEvent)
            .filter(
                CardEvent.card_id == card.id,
                CardEvent.event_type == "annual_fee_posted",
            )
            .first()
        )
        if not existing_af:
            today = get_today(db, user_id)
            fee_timeline: dict[int, int] = {}
            if card.template_id:
                fee_timeline = _build_fee_timeline(card.template_id, card.annual_fee)

            anniversary = card.open_date
            while anniversary <= today:
                fee = (
                    _get_fee_for_year(fee_timeline, anniversary.year)
                    if fee_timeline
                    else card.annual_fee
                )
                if fee is None:
                    fee = card.annual_fee
                af_event = CardEvent(
                    card_id=card.id,
                    event_type="annual_fee_posted",
                    event_date=anniversary,
                    metadata_json={"annual_fee": fee, "approximate_date": True},
                )
                db.add(af_event)
                anniversary = anniversary + relativedelta(years=1)
            if not card.annual_fee_date:
                card.annual_fee_date = anniversary

    db.commit()
    db.refresh(card)
    return card


def close_card(db: Session, card: Card, close_date: date) -> Card:
    if card.status == "closed":
        raise ValueError("Card is already closed")
    if card.open_date and close_date < card.open_date:
        raise ValueError("close_date cannot be before open_date")
    card.status = "closed"
    card.close_date = close_date
    card.annual_fee_date = None
    card.spend_reminder_enabled = False
    card.spend_deadline = None
    event = CardEvent(
        card_id=card.id,
        event_type="closed",
        event_date=close_date,
        description=f"Closed {card.card_name}",
    )
    db.add(event)
    db.commit()
    db.refresh(card)
    return card


def reopen_card(db: Session, card: Card, user_id: int | None = None) -> Card:
    if card.status != "closed":
        raise ValueError("Card is not closed")
    card.status = "active"
    card.close_date = None
    today = get_today(db, user_id)
    event = CardEvent(
        card_id=card.id,
        event_type="reopened",
        event_date=today,
        description=f"Reopened {card.card_name}",
    )
    db.add(event)

    # Restore annual fee tracking if card has an annual fee
    if card.open_date and card.annual_fee and card.annual_fee > 0:
        fee_timeline: dict[int, int] = {}
        if card.template_id:
            fee_timeline = _build_fee_timeline(card.template_id, card.annual_fee)

        # Find the next upcoming anniversary from open_date
        anniversary = card.open_date
        while anniversary <= today:
            # Generate AF events for any missed anniversaries that don't already exist
            existing = (
                db.query(CardEvent)
                .filter(
                    CardEvent.card_id == card.id,
                    CardEvent.event_type == "annual_fee_posted",
                    CardEvent.event_date == anniversary,
                )
                .first()
            )
            if not existing:
                fee = (
                    _get_fee_for_year(fee_timeline, anniversary.year)
                    if fee_timeline
                    else card.annual_fee
                )
                if fee is None:
                    fee = card.annual_fee
                af_event = CardEvent(
                    card_id=card.id,
                    event_type="annual_fee_posted",
                    event_date=anniversary,
                    metadata_json={"annual_fee": fee, "approximate_date": True},
                )
                db.add(af_event)
            anniversary = anniversary + relativedelta(years=1)
        card.annual_fee_date = anniversary

    db.commit()
    db.refresh(card)
    return card


def product_change(
    db: Session,
    card: Card,
    new_template_id: str | None,
    new_card_name: str,
    change_date: date,
    new_annual_fee: int | None = None,
    new_network: str | None = None,
    sync_benefits: bool = False,
    new_card_image: str | None = None,
    upgrade_bonus_amount: int | None = None,
    upgrade_bonus_type: str | None = None,
    upgrade_spend_requirement: int | None = None,
    upgrade_spend_deadline: date | None = None,
    upgrade_spend_reminder_notes: str | None = None,
    reset_af_anniversary: bool = True,
    user_id: int | None = None,
) -> Card:
    if card.status == "closed":
        raise ValueError("Cannot product-change a closed card")
    if new_template_id is not None and new_template_id == card.template_id:
        raise ValueError("Card already has this template")
    if card.open_date and change_date < card.open_date:
        raise ValueError("change_date cannot be before open_date")
    old_template_id = card.template_id
    old_card_name = card.card_name

    card.template_id = new_template_id
    card.card_name = new_card_name
    card.annual_fee_user_modified = False  # new template = new fee baseline
    # Reset card_image (use new template's default or explicit value)
    card.card_image = new_card_image or None
    # Update version_id and issuer from new template
    if new_template_id:
        new_tmpl = get_template(new_template_id)
        if new_tmpl:
            card.template_version_id = new_tmpl.version_id
            card.issuer = new_tmpl.issuer
    else:
        card.template_version_id = None
    if new_annual_fee is not None:
        card.annual_fee = new_annual_fee
    if new_network is not None:
        card.network = new_network

    event = CardEvent(
        card_id=card.id,
        event_type="product_change",
        event_date=change_date,
        description=f"Product changed from {old_card_name} to {new_card_name}",
        metadata_json={
            "from_template": old_template_id,
            "to_template": new_template_id,
            "from_name": old_card_name,
            "to_name": new_card_name,
        },
    )
    db.add(event)
    db.flush()  # get event.id for bonus linking

    # Sync benefits from new template if requested
    if sync_benefits:
        _sync_benefits_for_product_change(db, card)

    if reset_af_anniversary:
        # Create AF event at the product change date for the new card's fee
        if card.annual_fee and card.annual_fee > 0:
            af_event = CardEvent(
                card_id=card.id,
                event_type="annual_fee_posted",
                event_date=change_date,
                description=f"Annual fee after product change to {new_card_name}",
                metadata_json={"annual_fee": card.annual_fee, "approximate_date": True},
            )
            db.add(af_event)

        # Recalculate AF events from change_date forward
        _recalculate_af_events_after_change(db, card, change_date, user_id)

    # Create upgrade bonus if provided
    if upgrade_bonus_amount:
        bonus = CardBonus(
            card_id=card.id,
            event_id=event.id,
            bonus_source="upgrade",
            bonus_amount=upgrade_bonus_amount,
            bonus_type=upgrade_bonus_type,
            spend_requirement=upgrade_spend_requirement,
            spend_deadline=upgrade_spend_deadline,
            spend_reminder_enabled=bool(upgrade_spend_requirement and upgrade_spend_deadline),
            spend_reminder_notes=upgrade_spend_reminder_notes,
            description=f"Upgrade bonus: {old_card_name} to {new_card_name}",
        )
        db.add(bonus)

    db.commit()
    db.refresh(card)
    return card


def _sync_benefits_for_product_change(db: Session, card: Card) -> None:
    """Retire old template benefits and populate new ones from the new template."""
    # Retire all from_template benefits
    old_benefits = (
        db.query(CardBenefit)
        .filter(
            CardBenefit.card_id == card.id,
            CardBenefit.from_template == True,
        )
        .all()
    )
    for b in old_benefits:
        b.retired = True

    # Populate new template benefits
    if card.template_id:
        _populate_benefits_from_template(
            db, card.id, card.template_id, card.open_date
        )


def _recalculate_af_events_after_change(
    db: Session, card: Card, change_date: date, user_id: int | None = None
) -> None:
    """Delete future approximate AF events after change_date and regenerate
    using the new template's fee timeline."""
    # Always clean up approximate AF events after change_date (even for $X→$0)
    future_af_events = (
        db.query(CardEvent)
        .filter(
            CardEvent.card_id == card.id,
            CardEvent.event_type == "annual_fee_posted",
            CardEvent.event_date > change_date,
        )
        .all()
    )
    for evt in future_af_events:
        if evt.metadata_json and evt.metadata_json.get("approximate_date"):
            db.delete(evt)

    if not card.annual_fee or card.annual_fee <= 0:
        # Transitioning to $0 AF — clear the next AF date
        card.annual_fee_date = None
        return

    # Regenerate from change_date forward using new template's fee timeline.
    # After a PC, the AF anniversary resets to the change_date (since the full
    # new AF is charged at the PC date, the next AF is change_date + 1 year).
    today = get_today(db, user_id)
    fee_timeline: dict[int, int] = {}
    if card.template_id:
        fee_timeline = _build_fee_timeline(card.template_id, card.annual_fee)

    anniversary = change_date + relativedelta(years=1)
    while anniversary <= today:
        fee = (
            _get_fee_for_year(fee_timeline, anniversary.year)
            if fee_timeline
            else card.annual_fee
        )
        if fee is None:
            fee = card.annual_fee
        af_event = CardEvent(
            card_id=card.id,
            event_type="annual_fee_posted",
            event_date=anniversary,
            metadata_json={"annual_fee": fee, "approximate_date": True},
        )
        db.add(af_event)
        anniversary = anniversary + relativedelta(years=1)

    # Next AF = first anniversary of the PC date that's in the future
    card.annual_fee_date = anniversary
