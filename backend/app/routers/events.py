from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card
from app.models.card_bonus import CardBonus
from app.models.card_event import CardEvent
from app.models.profile import Profile
from app.models.user import User
from app.routers.auth import require_auth
from app.schemas.card_event import CardEventCreate, CardEventOut, CardEventUpdate, EventType

router = APIRouter(prefix="/api", tags=["events"])

# Event types managed by card lifecycle actions (open, close, product change, reopen)
SYSTEM_EVENT_TYPES = {"opened", "closed", "product_change", "reopened"}


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


class RetentionOfferCreate(BaseModel):
    event_date: date
    offer_points: int | None = Field(default=None, gt=0)
    offer_credit: int | None = Field(default=None, gt=0)
    accepted: bool = True
    description: str | None = Field(default=None, max_length=1000)
    spend_requirement: int | None = Field(default=None, gt=0)
    spend_deadline: date | None = None
    spend_reminder_notes: str | None = Field(default=None, max_length=1000)


@router.get("/cards/{card_id}/events", response_model=list[CardEventOut])
def list_card_events(card_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    _verify_card_ownership(db, user, card_id)
    return db.query(CardEvent).filter(CardEvent.card_id == card_id).order_by(CardEvent.event_date.desc()).all()


@router.post("/cards/{card_id}/events", response_model=CardEventOut, status_code=201)
def create_event(card_id: int, data: CardEventCreate, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    _verify_card_ownership(db, user, card_id)
    event = CardEvent(
        card_id=card_id,
        event_type=data.event_type,
        event_date=data.event_date,
        description=data.description,
        metadata_json=data.metadata_json,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.post("/cards/{card_id}/retention-offer", response_model=CardEventOut, status_code=201)
def create_retention_offer(card_id: int, data: RetentionOfferCreate, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    card = _verify_card_ownership(db, user, card_id)

    metadata = {}
    if data.offer_points is not None:
        metadata["offer_points"] = data.offer_points
    if data.offer_credit is not None:
        metadata["offer_credit"] = data.offer_credit
    metadata["accepted"] = data.accepted

    event = CardEvent(
        card_id=card_id,
        event_type="retention_offer",
        event_date=data.event_date,
        description=data.description,
        metadata_json=metadata,
    )
    db.add(event)

    db.flush()  # get event.id

    if data.accepted and (data.spend_requirement or data.offer_points or data.offer_credit):
        bonus_parts = []
        if data.offer_points:
            bonus_parts.append(f"{data.offer_points:,} points")
        if data.offer_credit:
            bonus_parts.append(f"${data.offer_credit} credit")
        offer_desc = " + ".join(bonus_parts) if bonus_parts else "Retention offer"

        bonus = CardBonus(
            card_id=card_id,
            event_id=event.id,
            bonus_source="retention",
            bonus_amount=data.offer_points or data.offer_credit,
            bonus_credit_amount=data.offer_credit if data.offer_points and data.offer_credit else None,
            bonus_type="points" if data.offer_points else ("credit" if data.offer_credit else None),
            spend_requirement=data.spend_requirement,
            spend_deadline=data.spend_deadline,
            spend_reminder_enabled=bool(data.spend_requirement and data.spend_deadline),
            spend_reminder_notes=data.spend_reminder_notes,
            description=f"Retention: {offer_desc} — {card.card_name}",
        )
        db.add(bonus)

    db.commit()
    db.refresh(event)
    return event


@router.put("/events/{event_id}", response_model=CardEventOut)
def update_event(event_id: int, data: CardEventUpdate, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    event = db.get(CardEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    # Verify ownership via card
    _verify_card_ownership(db, user, event.card_id)

    update_data = data.model_dump(exclude_unset=True)

    # Block changes to/from system-managed event types
    if "event_type" in update_data:
        if event.event_type in SYSTEM_EVENT_TYPES:
            raise HTTPException(status_code=400, detail="Cannot modify system-managed event type")
        if update_data["event_type"] in SYSTEM_EVENT_TYPES:
            raise HTTPException(status_code=400, detail="Cannot change event to a system-managed type")

    for field, value in update_data.items():
        setattr(event, field, value)

    # If retention offer changed to declined, delete linked bonuses
    if event.event_type == "retention_offer":
        meta = event.metadata_json if isinstance(event.metadata_json, dict) else {}
        if meta.get("accepted") is False:
            linked = db.query(CardBonus).filter(CardBonus.event_id == event.id).all()
            for b in linked:
                db.delete(b)

    db.commit()
    db.refresh(event)
    return event


@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    event = db.get(CardEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    _verify_card_ownership(db, user, event.card_id)

    # Cascade delete any bonuses linked to this event
    linked = db.query(CardBonus).filter(CardBonus.event_id == event.id).all()
    for b in linked:
        db.delete(b)

    db.delete(event)
    db.commit()


@router.get("/events", response_model=list[CardEventOut])
def list_all_events(
    profile_id: int | None = None,
    event_type: EventType | None = None,
    issuer: str | None = None,
    limit: int = Query(100, le=1000),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    query = db.query(CardEvent).join(Card).join(Profile).filter(Profile.user_id == user.id)
    if profile_id is not None:
        query = query.filter(Card.profile_id == profile_id)
    if event_type is not None:
        query = query.filter(CardEvent.event_type == event_type)
    if issuer is not None:
        query = query.filter(Card.issuer == issuer)
    return query.order_by(CardEvent.event_date.desc()).offset(offset).limit(limit).all()
