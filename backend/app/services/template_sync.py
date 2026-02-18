import logging

from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.card_benefit import CardBenefit
from app.models.card_bonus_category import CardBonusCategory
from app.services.template_loader import get_template
from app.utils.period_utils import get_current_period

logger = logging.getLogger(__name__)


def sync_cards_to_templates(db: Session) -> dict:
    """Sync active cards to their current template versions.

    Returns a summary dict with counts of actions taken.
    """
    summary = {
        "cards_synced": 0,
        "cards_initialized": 0,
        "cards_skipped": 0,
        "benefits_added": 0,
        "benefits_updated": 0,
        "benefits_retired": 0,
        "bonus_categories_added": 0,
        "bonus_categories_removed": 0,
    }

    cards = (
        db.query(Card)
        .filter(Card.template_id.isnot(None), Card.status == "active")
        .all()
    )

    for card in cards:
        template = get_template(card.template_id)
        if not template:
            summary["cards_skipped"] += 1
            continue
        if not template.version_id:
            summary["cards_skipped"] += 1
            continue

        if not card.template_version_id:
            # First run / migration: initialize version, tag existing benefits
            _initialize_card(db, card, template, summary)
        elif card.template_version_id == template.version_id:
            summary["cards_skipped"] += 1
        else:
            _sync_card(db, card, template, summary)

    db.commit()
    return summary


def _initialize_card(db, card, template, summary):
    """Set version_id and mark matching benefits as from_template."""
    card.template_version_id = template.version_id

    # Build set of template credit and threshold names
    template_credit_names = set()
    if template.benefits and template.benefits.credits:
        for credit in template.benefits.credits:
            template_credit_names.add(credit.name)

    template_threshold_names = set()
    if template.benefits and template.benefits.spend_thresholds:
        for threshold in template.benefits.spend_thresholds:
            template_threshold_names.add(threshold.name)

    # Tag existing benefits that match template credits or thresholds
    benefits = db.query(CardBenefit).filter(CardBenefit.card_id == card.id).all()
    for benefit in benefits:
        if benefit.benefit_name in template_credit_names or benefit.benefit_name in template_threshold_names:
            benefit.from_template = True

    # Tag existing bonus categories that match template categories
    template_cat_names = set()
    if template.benefits and template.benefits.bonus_categories:
        for bc in template.benefits.bonus_categories:
            template_cat_names.add(bc.category)
    existing_cats = db.query(CardBonusCategory).filter(CardBonusCategory.card_id == card.id).all()
    for cat in existing_cats:
        if cat.category in template_cat_names:
            cat.from_template = True

    summary["cards_initialized"] += 1


def _sync_card(db, card, template, summary):
    """Apply template changes to a card: update AF and merge benefits."""
    # Update annual fee (skip if user manually modified it)
    if template.annual_fee is not None and not card.annual_fee_user_modified:
        card.annual_fee = template.annual_fee

    # Get template credits
    template_credits = {}
    if template.benefits and template.benefits.credits:
        for credit in template.benefits.credits:
            template_credits[credit.name] = credit

    # Get existing from_template benefits, separated by type
    benefits = db.query(CardBenefit).filter(CardBenefit.card_id == card.id).all()
    credit_benefits = {b.benefit_name: b for b in benefits if b.from_template and b.benefit_type == "credit"}
    threshold_benefits = {b.benefit_name: b for b in benefits if b.from_template and b.benefit_type == "spend_threshold"}

    # Sync credits: update existing, add new, retire removed
    matched_credit_names = set()

    for name, credit in template_credits.items():
        matched_credit_names.add(name)
        if name in credit_benefits:
            benefit = credit_benefits[name]
            changed = False
            if benefit.benefit_amount != credit.amount:
                benefit.benefit_amount = credit.amount
                changed = True
            if benefit.frequency != credit.frequency:
                benefit.frequency = credit.frequency
                changed = True
            if benefit.reset_type != credit.reset_type:
                benefit.reset_type = credit.reset_type
                changed = True
            if benefit.retired:
                benefit.retired = False
                changed = True
            if changed:
                summary["benefits_updated"] += 1
        else:
            period_start, _ = get_current_period(
                credit.frequency, credit.reset_type, card.open_date
            )
            new_benefit = CardBenefit(
                card_id=card.id,
                benefit_name=credit.name,
                benefit_amount=credit.amount,
                frequency=credit.frequency,
                reset_type=credit.reset_type,
                from_template=True,
                amount_used=0,
                period_start=period_start,
            )
            db.add(new_benefit)
            summary["benefits_added"] += 1

    for name, benefit in credit_benefits.items():
        if name not in matched_credit_names and not benefit.retired:
            benefit.retired = True
            summary["benefits_retired"] += 1

    # Sync spend thresholds
    template_thresholds = {}
    if template.benefits and template.benefits.spend_thresholds:
        for threshold in template.benefits.spend_thresholds:
            template_thresholds[threshold.name] = threshold

    matched_threshold_names = set()

    for name, threshold in template_thresholds.items():
        matched_threshold_names.add(name)
        if name in threshold_benefits:
            benefit = threshold_benefits[name]
            changed = False
            if benefit.benefit_amount != threshold.spend_required:
                benefit.benefit_amount = threshold.spend_required
                changed = True
            if benefit.frequency != threshold.frequency:
                benefit.frequency = threshold.frequency
                changed = True
            if benefit.reset_type != threshold.reset_type:
                benefit.reset_type = threshold.reset_type
                changed = True
            if benefit.retired:
                benefit.retired = False
                changed = True
            if changed:
                summary["benefits_updated"] += 1
        else:
            period_start, _ = get_current_period(
                threshold.frequency, threshold.reset_type, card.open_date
            )
            new_benefit = CardBenefit(
                card_id=card.id,
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
            db.add(new_benefit)
            summary["benefits_added"] += 1

    for name, benefit in threshold_benefits.items():
        if name not in matched_threshold_names and not benefit.retired:
            benefit.retired = True
            summary["benefits_retired"] += 1

    # Sync bonus categories: add new, remove deleted from_template ones
    template_cats = {}
    if template.benefits and template.benefits.bonus_categories:
        for bc in template.benefits.bonus_categories:
            template_cats[bc.category] = bc

    existing_cats = db.query(CardBonusCategory).filter(
        CardBonusCategory.card_id == card.id, CardBonusCategory.from_template == True
    ).all()
    existing_cat_map = {c.category: c for c in existing_cats}

    for name, tbc in template_cats.items():
        if name in existing_cat_map:
            cat = existing_cat_map[name]
            if cat.multiplier != tbc.multiplier or cat.portal_only != tbc.portal_only or cat.cap != tbc.cap:
                cat.multiplier = tbc.multiplier
                cat.portal_only = tbc.portal_only
                cat.cap = tbc.cap
        else:
            db.add(CardBonusCategory(
                card_id=card.id,
                category=tbc.category,
                multiplier=tbc.multiplier,
                portal_only=tbc.portal_only,
                cap=tbc.cap,
                from_template=True,
            ))
            summary["bonus_categories_added"] += 1

    for name, cat in existing_cat_map.items():
        if name not in template_cats:
            db.delete(cat)
            summary["bonus_categories_removed"] += 1

    card.template_version_id = template.version_id
    summary["cards_synced"] += 1
