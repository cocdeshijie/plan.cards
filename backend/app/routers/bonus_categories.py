from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card
from app.models.card_bonus_category import CardBonusCategory
from app.models.profile import Profile
from app.models.user import User
from app.routers.auth import require_auth
from app.schemas.card_bonus_category import (
    CardBonusCategoryCreate,
    CardBonusCategoryUpdate,
    CardBonusCategoryOut,
)
from app.services.template_loader import get_template

router = APIRouter(prefix="/api/cards/{card_id}/bonus-categories", tags=["bonus-categories"])


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


def _get_category(category_id: int, card_id: int, db: Session) -> CardBonusCategory:
    cat = (
        db.query(CardBonusCategory)
        .filter(CardBonusCategory.id == category_id, CardBonusCategory.card_id == card_id)
        .first()
    )
    if not cat:
        raise HTTPException(status_code=404, detail="Bonus category not found")
    return cat


@router.get("", response_model=list[CardBonusCategoryOut])
def list_bonus_categories(card_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    _get_card(card_id, user, db)
    return db.query(CardBonusCategory).filter(CardBonusCategory.card_id == card_id).all()


@router.post("", response_model=CardBonusCategoryOut, status_code=201)
def create_bonus_category(
    card_id: int, data: CardBonusCategoryCreate, user: User = Depends(require_auth), db: Session = Depends(get_db)
):
    _get_card(card_id, user, db)
    cat = CardBonusCategory(
        card_id=card_id,
        category=data.category,
        multiplier=data.multiplier,
        portal_only=data.portal_only,
        cap=data.cap,
        from_template=False,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/{category_id}", response_model=CardBonusCategoryOut)
def update_bonus_category(
    card_id: int, category_id: int, data: CardBonusCategoryUpdate, user: User = Depends(require_auth), db: Session = Depends(get_db)
):
    _get_card(card_id, user, db)
    cat = _get_category(category_id, card_id, db)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(cat, field, value)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{category_id}", status_code=204)
def delete_bonus_category(
    card_id: int, category_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)
):
    _get_card(card_id, user, db)
    cat = _get_category(category_id, card_id, db)
    db.delete(cat)
    db.commit()


@router.post("/populate", response_model=list[CardBonusCategoryOut])
def populate_bonus_categories(card_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    card = _get_card(card_id, user, db)
    if not card.template_id:
        raise HTTPException(status_code=400, detail="Card has no template")
    template = get_template(card.template_id)
    if not template:
        raise HTTPException(status_code=400, detail=f"Template '{card.template_id}' not found")
    if not template.benefits or not template.benefits.bonus_categories:
        raise HTTPException(status_code=400, detail="Template has no bonus categories")

    existing = {
        c.category
        for c in db.query(CardBonusCategory).filter(CardBonusCategory.card_id == card_id).all()
    }

    created = []
    for tbc in template.benefits.bonus_categories:
        if tbc.category not in existing:
            cat = CardBonusCategory(
                card_id=card_id,
                category=tbc.category,
                multiplier=tbc.multiplier,
                portal_only=tbc.portal_only,
                cap=tbc.cap,
                from_template=True,
            )
            db.add(cat)
            created.append(cat)

    db.commit()
    for c in created:
        db.refresh(c)
    return created
