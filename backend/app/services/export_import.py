from datetime import datetime, timezone

from sqlalchemy.orm import Session, selectinload

from app.models.card import Card
from app.models.card_benefit import CardBenefit
from app.models.card_bonus import CardBonus
from app.models.card_bonus_category import CardBonusCategory
from app.models.card_event import CardEvent
from app.models.profile import Profile
from app.models.setting import Setting
from app.models.user_setting import UserSetting
from app.schemas.export_import import (
    ExportBenefit,
    ExportBonus,
    ExportBonusCategory,
    ExportCard,
    ExportData,
    ExportEvent,
    ExportProfile,
    ImportResult,
)


def export_profiles(db: Session, profile_id: int | None = None, user_id: int | None = None) -> ExportData:
    query = db.query(Profile).options(
        selectinload(Profile.cards).selectinload(Card.events),
        selectinload(Profile.cards).selectinload(Card.benefits),
        selectinload(Profile.cards).selectinload(Card.bonuses),
        selectinload(Profile.cards).selectinload(Card.bonus_categories),
    )
    if user_id is not None:
        query = query.filter(Profile.user_id == user_id)
    if profile_id is not None:
        query = query.filter(Profile.id == profile_id)
    profiles = query.all()

    export_profiles_list = []
    for profile in profiles:
        export_cards = []
        for card in profile.cards:
            if card.deleted_at is not None:
                continue
            export_events = [
                ExportEvent(
                    original_id=e.id,
                    event_type=e.event_type,
                    event_date=e.event_date,
                    description=e.description,
                    metadata_json=e.metadata_json,
                )
                for e in card.events
            ]
            export_benefits = [
                ExportBenefit(
                    benefit_name=b.benefit_name,
                    benefit_amount=b.benefit_amount,
                    frequency=b.frequency,
                    reset_type=b.reset_type,
                    from_template=b.from_template,
                    retired=b.retired,
                    notes=b.notes,
                    amount_used=b.amount_used,
                    benefit_type=b.benefit_type,
                    period_start=b.period_start,
                )
                for b in card.benefits
            ]
            export_bonuses = [
                ExportBonus(
                    bonus_source=b.bonus_source,
                    event_id=b.event_id,
                    bonus_amount=b.bonus_amount,
                    bonus_credit_amount=b.bonus_credit_amount,
                    bonus_type=b.bonus_type,
                    bonus_earned=b.bonus_earned,
                    bonus_missed=b.bonus_missed,
                    spend_requirement=b.spend_requirement,
                    spend_deadline=b.spend_deadline,
                    spend_reminder_enabled=b.spend_reminder_enabled,
                    spend_reminder_notes=b.spend_reminder_notes,
                    description=b.description,
                )
                for b in card.bonuses
            ]
            export_bonus_categories = [
                ExportBonusCategory(
                    category=bc.category,
                    multiplier=bc.multiplier,
                    portal_only=bc.portal_only,
                    cap=bc.cap,
                    from_template=bc.from_template,
                )
                for bc in card.bonus_categories
            ]
            export_cards.append(
                ExportCard(
                    template_id=card.template_id,
                    template_version_id=card.template_version_id,
                    card_image=card.card_image,
                    card_name=card.card_name,
                    last_digits=card.last_digits,
                    issuer=card.issuer,
                    network=card.network,
                    card_type=card.card_type,
                    status=card.status,
                    open_date=card.open_date,
                    close_date=card.close_date,
                    annual_fee=card.annual_fee,
                    annual_fee_date=card.annual_fee_date,
                    credit_limit=card.credit_limit,
                    custom_notes=card.custom_notes,
                    custom_tags=card.custom_tags,
                    spend_reminder_enabled=card.spend_reminder_enabled,
                    spend_requirement=card.spend_requirement,
                    spend_deadline=card.spend_deadline,
                    spend_reminder_notes=card.spend_reminder_notes,
                    signup_bonus_amount=card.signup_bonus_amount,
                    signup_bonus_type=card.signup_bonus_type,
                    signup_bonus_earned=card.signup_bonus_earned,
                    events=export_events,
                    benefits=export_benefits,
                    bonuses=export_bonuses,
                    bonus_categories=export_bonus_categories,
                )
            )
        export_profiles_list.append(
            ExportProfile(name=profile.name, cards=export_cards)
        )

    # Export settings (prefer per-user settings)
    if user_id is not None:
        all_settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).all()
    else:
        all_settings = db.query(Setting).all()
    settings_dict = {s.key: s.value for s in all_settings} if all_settings else None

    return ExportData(
        version=1,
        exported_at=datetime.now(timezone.utc),
        profiles=export_profiles_list,
        settings=settings_dict,
    )


def _create_cards_and_events(
    db: Session, profile: Profile, cards_data: list[ExportCard]
) -> tuple[int, int, int, int, int]:
    cards_count = 0
    events_count = 0
    benefits_count = 0
    bonuses_count = 0
    bonus_categories_count = 0
    for card_data in cards_data:
        card = Card(
            profile_id=profile.id,
            template_id=card_data.template_id,
            template_version_id=card_data.template_version_id,
            card_image=card_data.card_image,
            card_name=card_data.card_name,
            last_digits=card_data.last_digits,
            issuer=card_data.issuer,
            network=card_data.network,
            card_type=card_data.card_type,
            status=card_data.status,
            open_date=card_data.open_date,
            close_date=card_data.close_date,
            annual_fee=card_data.annual_fee,
            annual_fee_date=card_data.annual_fee_date,
            credit_limit=card_data.credit_limit,
            custom_notes=card_data.custom_notes,
            custom_tags=card_data.custom_tags,
            spend_reminder_enabled=card_data.spend_reminder_enabled,
            spend_requirement=card_data.spend_requirement,
            spend_deadline=card_data.spend_deadline,
            spend_reminder_notes=card_data.spend_reminder_notes,
            signup_bonus_amount=card_data.signup_bonus_amount,
            signup_bonus_type=card_data.signup_bonus_type,
            signup_bonus_earned=card_data.signup_bonus_earned,
        )
        db.add(card)
        db.flush()
        cards_count += 1

        event_id_map: dict[int, int] = {}
        for event_data in card_data.events:
            event = CardEvent(
                card_id=card.id,
                event_type=event_data.event_type,
                event_date=event_data.event_date,
                description=event_data.description,
                metadata_json=event_data.metadata_json,
            )
            db.add(event)
            if event_data.original_id is not None:
                db.flush()
                event_id_map[event_data.original_id] = event.id
            events_count += 1

        for benefit_data in card_data.benefits:
            benefit = CardBenefit(
                card_id=card.id,
                benefit_name=benefit_data.benefit_name,
                benefit_amount=benefit_data.benefit_amount,
                frequency=benefit_data.frequency,
                reset_type=benefit_data.reset_type,
                from_template=benefit_data.from_template,
                retired=benefit_data.retired,
                notes=benefit_data.notes,
                amount_used=benefit_data.amount_used,
                benefit_type=benefit_data.benefit_type,
                period_start=benefit_data.period_start,
            )
            db.add(benefit)
            benefits_count += 1

        for bonus_data in card_data.bonuses:
            new_event_id = None
            if bonus_data.event_id is not None:
                new_event_id = event_id_map.get(bonus_data.event_id)
            bonus = CardBonus(
                card_id=card.id,
                event_id=new_event_id,
                bonus_source=bonus_data.bonus_source,
                bonus_amount=bonus_data.bonus_amount,
                bonus_credit_amount=bonus_data.bonus_credit_amount,
                bonus_type=bonus_data.bonus_type,
                bonus_earned=bonus_data.bonus_earned,
                bonus_missed=bonus_data.bonus_missed,
                spend_requirement=bonus_data.spend_requirement,
                spend_deadline=bonus_data.spend_deadline,
                spend_reminder_enabled=bonus_data.spend_reminder_enabled,
                spend_reminder_notes=bonus_data.spend_reminder_notes,
                description=bonus_data.description,
            )
            db.add(bonus)
            bonuses_count += 1

        for bc_data in card_data.bonus_categories:
            db.add(CardBonusCategory(
                card_id=card.id,
                category=bc_data.category,
                multiplier=bc_data.multiplier,
                portal_only=bc_data.portal_only,
                cap=bc_data.cap,
                from_template=bc_data.from_template,
            ))
            bonus_categories_count += 1

    return cards_count, events_count, benefits_count, bonuses_count, bonus_categories_count


def import_profiles(
    db: Session,
    data: ExportData,
    mode: str,
    target_profile_id: int | None = None,
    user_id: int | None = None,
) -> ImportResult:
    result = ImportResult()

    if mode == "new":
        name_query = db.query(Profile.name)
        if user_id is not None:
            name_query = name_query.filter(Profile.user_id == user_id)
        existing_names = {p.name.lower() for p in name_query.all()}
        for profile_data in data.profiles:
            name = profile_data.name
            if name.lower() in existing_names:
                suffix = 2
                while f"{name} ({suffix})".lower() in existing_names:
                    suffix += 1
                name = f"{name} ({suffix})"
            existing_names.add(name.lower())

            profile = Profile(name=name, user_id=user_id)
            db.add(profile)
            db.flush()
            result.profiles_imported += 1

            cards, events, benefits, bonuses, bcats = _create_cards_and_events(db, profile, profile_data.cards)
            result.cards_imported += cards
            result.events_imported += events
            result.benefits_imported += benefits
            result.bonuses_imported += bonuses
            result.bonus_categories_imported += bcats

    elif mode == "override":
        if len(data.profiles) != 1:
            raise ValueError("Override mode requires exactly 1 profile in the import file")
        if target_profile_id is None:
            raise ValueError("Override mode requires a target profile")

        profile = db.get(Profile, target_profile_id)
        if not profile:
            raise ValueError("Target profile not found")

        # Delete existing cards (cascade deletes events and benefits)
        for card in list(profile.cards):
            db.delete(card)
        db.flush()

        profile_data = data.profiles[0]
        cards, events, benefits, bonuses, bcats = _create_cards_and_events(db, profile, profile_data.cards)
        result.profiles_imported = 1
        result.cards_imported = cards
        result.events_imported = events
        result.benefits_imported = benefits
        result.bonuses_imported = bonuses
        result.bonus_categories_imported = bcats

    elif mode == "merge":
        if len(data.profiles) != 1:
            raise ValueError("Merge mode requires exactly 1 profile in the import file")
        if target_profile_id is None:
            raise ValueError("Merge mode requires a target profile")

        profile = db.get(Profile, target_profile_id)
        if not profile:
            raise ValueError("Target profile not found")

        # Build set of existing (non-deleted) cards for duplicate detection (case-insensitive)
        existing_cards = db.query(Card).filter(
            Card.profile_id == profile.id, Card.deleted_at == None  # noqa: E711
        ).all()
        existing_keys = {
            (c.card_name.lower(), c.issuer.lower(), c.open_date) for c in existing_cards
        }

        # Filter out duplicates (case-insensitive matching)
        profile_data = data.profiles[0]
        new_cards = []
        for card_data in profile_data.cards:
            key = (card_data.card_name.lower(), card_data.issuer.lower(), card_data.open_date)
            if key in existing_keys:
                result.cards_skipped += 1
            else:
                new_cards.append(card_data)

        cards, events, benefits, bonuses, bcats = _create_cards_and_events(db, profile, new_cards)
        result.profiles_imported = 1
        result.cards_imported = cards
        result.events_imported = events
        result.benefits_imported = benefits
        result.bonuses_imported = bonuses
        result.bonus_categories_imported = bcats

    else:
        raise ValueError(f"Invalid import mode: {mode}")

    # Import settings if present (only known keys)
    _IMPORTABLE_SETTINGS = {"timezone"}
    if data.settings:
        if user_id is not None:
            for key, value in data.settings.items():
                if key not in _IMPORTABLE_SETTINGS:
                    continue
                existing = (
                    db.query(UserSetting)
                    .filter(UserSetting.user_id == user_id, UserSetting.key == key)
                    .first()
                )
                if existing:
                    existing.value = value
                else:
                    db.add(UserSetting(user_id=user_id, key=key, value=value))
        else:
            for key, value in data.settings.items():
                if key not in _IMPORTABLE_SETTINGS:
                    continue
                existing_setting = db.get(Setting, key)
                if existing_setting:
                    existing_setting.value = value
                else:
                    db.add(Setting(key=key, value=value))

    db.commit()
    return result
