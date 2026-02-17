from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card
from app.models.card_benefit import CardBenefit
from app.models.profile import Profile
from app.models.user import User
from app.routers.auth import require_auth
from app.schemas.card_benefit import (
    CardBenefitCreate,
    CardBenefitUpdate,
    BenefitUsageUpdate,
    CardBenefitOut,
    BenefitSummaryItem,
)
from app.services.benefit_service import (
    list_benefits,
    create_benefit,
    update_benefit,
    delete_benefit,
    update_usage,
    populate_from_template,
    list_all_benefits,
)
from app.services.template_loader import get_template

router = APIRouter(
    prefix="/api/cards/{card_id}/benefits",
    tags=["benefits"],
)


def _get_card(card_id: int, user: User, db: Session) -> Card:
    card = (
        db.query(Card)
        .join(Profile)
        .filter(Card.id == card_id, Profile.user_id == user.id, Card.deleted_at == None)  # noqa: E711
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


def _get_benefit(benefit_id: int, card_id: int, db: Session) -> CardBenefit:
    benefit = (
        db.query(CardBenefit)
        .filter(CardBenefit.id == benefit_id, CardBenefit.card_id == card_id)
        .first()
    )
    if not benefit:
        raise HTTPException(status_code=404, detail="Benefit not found")
    return benefit


@router.get("", response_model=list[CardBenefitOut])
def list_benefits_endpoint(card_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    card = _get_card(card_id, user, db)
    return list_benefits(db, card, user_id=user.id)


@router.post("", response_model=CardBenefitOut, status_code=201)
def create_benefit_endpoint(
    card_id: int, data: CardBenefitCreate, user: User = Depends(require_auth), db: Session = Depends(get_db)
):
    card = _get_card(card_id, user, db)
    return create_benefit(db, card, data, user_id=user.id)


@router.put("/{benefit_id}", response_model=CardBenefitOut)
def update_benefit_endpoint(
    card_id: int, benefit_id: int, data: CardBenefitUpdate, user: User = Depends(require_auth), db: Session = Depends(get_db)
):
    card = _get_card(card_id, user, db)
    benefit = _get_benefit(benefit_id, card_id, db)
    return update_benefit(db, benefit, card, data, user_id=user.id)


@router.delete("/{benefit_id}", status_code=204)
def delete_benefit_endpoint(
    card_id: int, benefit_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)
):
    _get_card(card_id, user, db)
    benefit = _get_benefit(benefit_id, card_id, db)
    delete_benefit(db, benefit)


@router.put("/{benefit_id}/usage", response_model=CardBenefitOut)
def update_usage_endpoint(
    card_id: int, benefit_id: int, data: BenefitUsageUpdate, user: User = Depends(require_auth), db: Session = Depends(get_db)
):
    card = _get_card(card_id, user, db)
    benefit = _get_benefit(benefit_id, card_id, db)
    return update_usage(db, benefit, card, data, user_id=user.id)


@router.post("/populate", response_model=list[CardBenefitOut])
def populate_benefits_endpoint(card_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    card = _get_card(card_id, user, db)
    if not card.template_id:
        raise HTTPException(status_code=400, detail="Card has no template")
    template = get_template(card.template_id)
    if not template:
        raise HTTPException(
            status_code=400,
            detail=f"Template '{card.template_id}' not found — it may have been removed",
        )
    if not template.benefits:
        raise HTTPException(status_code=400, detail="Template has no benefits defined")

    has_credits = template.benefits.credits
    has_thresholds = template.benefits.spend_thresholds
    if not has_credits and not has_thresholds:
        raise HTTPException(status_code=400, detail="Template has no credits or thresholds")

    results = []
    if has_credits:
        credits = [c.model_dump() for c in template.benefits.credits]
        results.extend(populate_from_template(db, card, credits, user_id=user.id))
    if has_thresholds:
        thresholds = [
            {
                "name": t.name,
                "amount": t.spend_required,
                "frequency": t.frequency,
                "reset_type": t.reset_type,
                "benefit_type": "spend_threshold",
                "notes": t.description,
            }
            for t in template.benefits.spend_thresholds
        ]
        results.extend(populate_from_template(db, card, thresholds, user_id=user.id))
    return results


# Summary router — bulk benefits across all cards
summary_router = APIRouter(
    prefix="/api/benefits",
    tags=["benefits"],
)


@summary_router.get("", response_model=list[BenefitSummaryItem])
def list_all_benefits_endpoint(
    profile_id: int | None = None,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    return list_all_benefits(db, profile_id, user_id=user.id)
