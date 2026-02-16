from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card
from app.models.card_bonus import CardBonus
from app.models.card_event import CardEvent
from app.models.profile import Profile
from app.models.user import User
from app.routers.auth import require_auth
from app.schemas.card_bonus import CardBonusCreate, CardBonusOut, CardBonusUpdate

router = APIRouter(prefix="/api", tags=["bonuses"])


def _verify_card_ownership(db: Session, user: User, card_id: int) -> Card:
    card = (
        db.query(Card)
        .join(Profile)
        .filter(Card.id == card_id, Profile.user_id == user.id)
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@router.post("/cards/{card_id}/bonuses", response_model=CardBonusOut, status_code=201)
def create_bonus(card_id: int, data: CardBonusCreate, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    _verify_card_ownership(db, user, card_id)
    if data.event_id is not None:
        event = db.get(CardEvent, data.event_id)
        if not event or event.card_id != card_id:
            raise HTTPException(status_code=400, detail="event_id does not belong to this card")
    bonus = CardBonus(card_id=card_id, **data.model_dump())
    db.add(bonus)
    db.commit()
    db.refresh(bonus)
    return bonus


@router.put("/bonuses/{bonus_id}", response_model=CardBonusOut)
def update_bonus(bonus_id: int, data: CardBonusUpdate, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    bonus = db.get(CardBonus, bonus_id)
    if not bonus:
        raise HTTPException(status_code=404, detail="Bonus not found")
    # Verify ownership via card
    _verify_card_ownership(db, user, bonus.card_id)
    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(bonus, field, value)
    # Enforce mutual exclusivity: earned and missed can't both be true
    if update_fields.get("bonus_earned"):
        bonus.bonus_missed = False
    elif update_fields.get("bonus_missed"):
        bonus.bonus_earned = False
    db.commit()
    db.refresh(bonus)
    return bonus


@router.delete("/bonuses/{bonus_id}", status_code=204)
def delete_bonus(bonus_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    bonus = db.get(CardBonus, bonus_id)
    if not bonus:
        raise HTTPException(status_code=404, detail="Bonus not found")
    _verify_card_ownership(db, user, bonus.card_id)
    db.delete(bonus)
    db.commit()
