import mimetypes
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.models.card import Card
from app.models.profile import Profile
from app.models.user import User
from app.routers.auth import require_auth
from app.schemas.card import CardCreate, CardUpdate, CardOut, CloseCardRequest, ProductChangeRequest
from app.services.card_service import create_card, update_card, close_card, product_change, reopen_card
from app.services.template_loader import (
    get_template_image_path,
    get_template_image_path_by_filename,
    get_placeholder_image_path,
)

router = APIRouter(prefix="/api/cards", tags=["cards"])


def _verify_card_ownership(db: Session, user: User, card_id: int) -> Card:
    """Load a card and verify it belongs to the user via its profile."""
    card = (
        db.query(Card)
        .join(Profile)
        .filter(Card.id == card_id, Profile.user_id == user.id)
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@router.get("", response_model=list[CardOut])
def list_cards(
    profile_id: int | None = None,
    status: Literal["active", "closed"] | None = None,
    card_type: Literal["personal", "business"] | None = None,
    issuer: str | None = None,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Card)
        .join(Profile)
        .options(selectinload(Card.events), selectinload(Card.bonuses))
        .filter(Profile.user_id == user.id)
    )
    if profile_id is not None:
        query = query.filter(Card.profile_id == profile_id)
    if status is not None:
        query = query.filter(Card.status == status)
    if card_type is not None:
        query = query.filter(Card.card_type == card_type)
    if issuer is not None:
        query = query.filter(Card.issuer == issuer)
    return query.order_by(Card.open_date.desc().nullslast()).all()


@router.post("", response_model=CardOut, status_code=201)
def create_card_endpoint(data: CardCreate, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    # Verify the target profile belongs to the user
    profile = db.get(Profile, data.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")
    card = create_card(db, data, user_id=user.id)
    db.refresh(card, ["events", "bonuses"])
    return card


@router.get("/{card_id}", response_model=CardOut)
def get_card(card_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    card = (
        db.query(Card)
        .join(Profile)
        .options(joinedload(Card.events), joinedload(Card.bonuses))
        .filter(Card.id == card_id, Profile.user_id == user.id)
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@router.put("/{card_id}", response_model=CardOut)
def update_card_endpoint(card_id: int, data: CardUpdate, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    card = _verify_card_ownership(db, user, card_id)
    try:
        card = update_card(db, card, data, user_id=user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.refresh(card, ["events", "bonuses"])
    return card


@router.delete("/{card_id}", status_code=204)
def delete_card(card_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    card = _verify_card_ownership(db, user, card_id)
    db.delete(card)
    db.commit()


@router.post("/{card_id}/close", response_model=CardOut)
def close_card_endpoint(card_id: int, data: CloseCardRequest, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    card = _verify_card_ownership(db, user, card_id)
    try:
        card = close_card(db, card, data.close_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.refresh(card, ["events", "bonuses"])
    return card


@router.post("/{card_id}/reopen", response_model=CardOut)
def reopen_card_endpoint(card_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    card = _verify_card_ownership(db, user, card_id)
    try:
        card = reopen_card(db, card, user_id=user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.refresh(card, ["events", "bonuses"])
    return card


@router.post("/{card_id}/product-change", response_model=CardOut)
def product_change_endpoint(
    card_id: int,
    data: ProductChangeRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    card = _verify_card_ownership(db, user, card_id)
    try:
        card = product_change(
            db, card, data.new_template_id, data.new_card_name, data.change_date,
            data.new_annual_fee, data.new_network, data.sync_benefits,
            new_card_image=data.new_card_image,
            upgrade_bonus_amount=data.upgrade_bonus_amount,
            upgrade_bonus_type=data.upgrade_bonus_type,
            upgrade_spend_requirement=data.upgrade_spend_requirement,
            upgrade_spend_deadline=data.upgrade_spend_deadline,
            upgrade_spend_reminder_notes=data.upgrade_spend_reminder_notes,
            reset_af_anniversary=data.reset_af_anniversary,
            user_id=user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.refresh(card, ["events", "bonuses"])
    return card


@router.get("/{card_id}/image")
def get_card_image(card_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    card = _verify_card_ownership(db, user, card_id)
    if not card.template_id:
        placeholder = get_placeholder_image_path()
        if not placeholder:
            raise HTTPException(status_code=404, detail="No image available")
        return FileResponse(placeholder, media_type="image/png")

    if card.card_image:
        image_path = get_template_image_path_by_filename(card.template_id, card.card_image)
        if image_path:
            media_type = mimetypes.guess_type(str(image_path))[0] or "image/png"
            return FileResponse(image_path, media_type=media_type)

    image_path = get_template_image_path(card.template_id)
    if not image_path:
        raise HTTPException(status_code=404, detail="Image not found")
    media_type = mimetypes.guess_type(str(image_path))[0] or "image/png"
    return FileResponse(image_path, media_type=media_type)
