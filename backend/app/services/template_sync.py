import logging

from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.card_benefit import CardBenefit
from app.models.card_bonus_category import CardBonusCategory
from app.models.profile import Profile
from app.services.template_loader import get_template

logger = logging.getLogger(__name__)


def sync_cards_to_templates(db: Session, user_id: int | None = None) -> dict:
    """Sync active cards to their current template versions.

    `user_id` scopes the sync to one account. Startup and the hot-reload loop
    pass None (sync everything); per-user actions such as import must pass a
    user_id, or one person's import silently rewrites every other account's
    cards on the instance.

    Returns a summary dict with counts of actions taken.
    """
    summary = {
        "cards_synced": 0,
        "cards_initialized": 0,
        "cards_skipped": 0,
        "cards_pinned": 0,
        "benefits_added": 0,
        "benefits_updated": 0,
        "benefits_retired": 0,
        "benefits_preserved": 0,
        "bonus_categories_added": 0,
        "bonus_categories_removed": 0,
    }

    query = db.query(Card).filter(
        Card.template_id.isnot(None),
        Card.status == "active",
        Card.deleted_at.is_(None),  # never mutate soft-deleted cards
    )
    if user_id is not None:
        query = query.join(Profile, Card.profile_id == Profile.id).filter(
            Profile.user_id == user_id
        )
    cards = query.all()

    for card in cards:
        template = get_template(card.template_id)
        if not template:
            summary["cards_skipped"] += 1
            continue
        if not template.version_id:
            summary["cards_skipped"] += 1
            continue
        if card.template_version_pinned:
            # The user deliberately chose an older version of this template.
            summary["cards_pinned"] += 1
            continue

        if not card.template_version_id:
            # First run / migration: tag existing benefits as template-sourced,
            # then sync so the card actually receives the template's benefits.
            # Only tagging would mark the card as reconciled with a state it was
            # never reconciled to, and it would never receive them until
            # maintainers happened to bump the template's version_id.
            _initialize_card(db, card, template, summary)

        if card.template_version_id == template.version_id:
            summary["cards_skipped"] += 1
        else:
            _sync_card(db, card, template, summary)

    db.commit()
    return summary


def _initialize_card(db, card, template, summary):
    """Tag pre-existing benefits/categories as template-sourced.

    Deliberately does NOT set template_version_id: the caller runs _sync_card
    immediately afterwards, which both adds any benefits the card is missing and
    records the version. Marking the version here would declare the card
    reconciled with a template state it never actually received.
    """
    # Map template display names to their stable keys (if declared).
    template_keys: dict[str, str | None] = {}
    if template.benefits and template.benefits.credits:
        for credit in template.benefits.credits:
            template_keys[credit.name] = credit.key
    if template.benefits and template.benefits.spend_thresholds:
        for threshold in template.benefits.spend_thresholds:
            template_keys[threshold.name] = threshold.key

    # Tag existing benefits that match template credits or thresholds
    benefits = db.query(CardBenefit).filter(CardBenefit.card_id == card.id).all()
    for benefit in benefits:
        if benefit.benefit_name in template_keys:
            benefit.from_template = True
            if benefit.template_key is None:
                benefit.template_key = template_keys[benefit.benefit_name]

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


def _find_existing(entry, by_key: dict, by_name: dict):
    """Pair a template entry with an existing CardBenefit.

    Tries the stable key first, then falls back to the display name. The
    fallback is essential, not a nicety: every benefit written before
    `template_key` existed has it NULL, so it is only reachable by name. Without
    the fallback, the first contributor to add `key:` to an already-published
    credit would retire every user's row and start a fresh one at $0 — exactly
    the data loss the key was introduced to prevent, triggered by following the
    documentation.
    """
    key = getattr(entry, "key", None)
    if key:
        found = by_key.get(key)
        if found is not None:
            return found
    return by_name.get(entry.name)


def _apply_template_entry(benefit, *, name, amount, frequency, reset_type, key) -> bool:
    """Update a from_template benefit in place. Returns True if anything changed."""
    changed = False
    if benefit.template_key != key:
        benefit.template_key = key
        # Backfilling identity is bookkeeping, not a user-visible change.
    if benefit.benefit_name != name:
        benefit.benefit_name = name
        changed = True
    if benefit.benefit_amount != amount:
        benefit.benefit_amount = amount
        changed = True
    if benefit.frequency != frequency or benefit.reset_type != reset_type:
        benefit.frequency = frequency
        benefit.reset_type = reset_type
        # period_start is only meaningful relative to the frequency/reset_type
        # that produced it, so re-anchor rather than carrying a stale monthly
        # period into an annual bucket. update_benefit() does the same thing
        # for the identical edit made through the API.
        benefit.period_start = None
        benefit.amount_used = 0
        changed = True
    if benefit.retired:
        benefit.retired = False
        changed = True
    return changed


def _sync_benefit_group(db, card, summary, template_entries, existing, benefit_type):
    """Merge one group (credits or spend thresholds) into the card's benefits.

    `existing` is the list of from_template benefits of this type.
    """
    by_key = {b.template_key: b for b in existing if b.template_key}
    by_name = {b.benefit_name: b for b in existing}
    matched: set[int] = set()

    for entry in template_entries:
        amount = entry.amount if benefit_type == "credit" else entry.spend_required
        benefit = _find_existing(entry, by_key, by_name)

        if benefit is not None:
            matched.add(id(benefit))
            if benefit.user_modified:
                # The user edited this benefit; the template no longer owns it.
                summary["benefits_preserved"] += 1
                continue
            if _apply_template_entry(
                benefit,
                name=entry.name,
                amount=amount,
                frequency=entry.frequency,
                reset_type=entry.reset_type,
                key=entry.key,
            ):
                summary["benefits_updated"] += 1
            continue

        db.add(CardBenefit(
            card_id=card.id,
            benefit_name=entry.name,
            benefit_amount=amount,
            frequency=entry.frequency,
            reset_type=entry.reset_type,
            benefit_type=benefit_type,
            template_key=entry.key,
            from_template=True,
            amount_used=0,
            notes=getattr(entry, "description", None),
            # Left unset so the first read anchors it in the user's timezone.
            period_start=None,
        ))
        summary["benefits_added"] += 1

    for benefit in existing:
        if id(benefit) not in matched and not benefit.retired:
            benefit.retired = True
            summary["benefits_retired"] += 1


def _sync_card(db, card, template, summary):
    """Apply template changes to a card: update AF and merge benefits."""
    # Update annual fee (skip if user manually modified it)
    if template.annual_fee is not None and not card.annual_fee_user_modified:
        card.annual_fee = template.annual_fee

    benefits = db.query(CardBenefit).filter(CardBenefit.card_id == card.id).all()
    credit_benefits = [
        b for b in benefits if b.from_template and b.benefit_type == "credit"
    ]
    threshold_benefits = [
        b for b in benefits if b.from_template and b.benefit_type == "spend_threshold"
    ]

    tb = template.benefits
    _sync_benefit_group(
        db, card, summary,
        (tb.credits if tb and tb.credits else []),
        credit_benefits, "credit",
    )
    _sync_benefit_group(
        db, card, summary,
        (tb.spend_thresholds if tb and tb.spend_thresholds else []),
        threshold_benefits, "spend_threshold",
    )

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
            if cat.user_modified:
                continue
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
        if name in template_cats:
            continue
        if cat.user_modified:
            # A user-renamed category matches no template name by definition;
            # deleting it here would be exactly the loss user_modified prevents.
            continue
        db.delete(cat)
        summary["bonus_categories_removed"] += 1

    card.template_version_id = template.version_id
    summary["cards_synced"] += 1
