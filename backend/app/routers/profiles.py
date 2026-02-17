from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.profile import Profile
from app.models.user import User
from app.routers.auth import require_auth
from app.schemas.export_import import ExportData, ImportResult
from app.schemas.profile import ProfileCreate, ProfileUpdate, ProfileOut
from app.services.export_import import export_profiles, import_profiles
from app.services.five_twenty_four import get_524_details
from app.services.template_sync import sync_cards_to_templates

MAX_IMPORT_SIZE = 50 * 1024 * 1024  # 50MB

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


@router.get("", response_model=list[ProfileOut])
def list_profiles(user: User = Depends(require_auth), db: Session = Depends(get_db)):
    return db.query(Profile).filter(Profile.user_id == user.id).order_by(Profile.name).all()


@router.post("", response_model=ProfileOut, status_code=201)
def create_profile(data: ProfileCreate, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    existing = (
        db.query(Profile)
        .filter(Profile.user_id == user.id, Profile.name.ilike(data.name))
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Profile name already exists")
    profile = Profile(name=data.name, user_id=user.id)
    db.add(profile)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Profile name already exists")
    db.refresh(profile)
    return profile


@router.get("/export", response_model=ExportData)
def export_profiles_endpoint(
    profile_id: int | None = Query(None),
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    if profile_id is not None:
        profile = db.get(Profile, profile_id)
        if not profile or profile.user_id != user.id:
            raise HTTPException(status_code=404, detail="Profile not found")
    return export_profiles(db, profile_id, user_id=user.id)


@router.post("/import", response_model=ImportResult)
async def import_profiles_endpoint(
    request: Request,
    data: ExportData,
    mode: Literal["new", "override", "merge"] = Query("new"),
    target_profile_id: int | None = Query(None),
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    # Check Content-Length header as a fast reject
    content_length = request.headers.get("content-length")
    try:
        if content_length and int(content_length) > MAX_IMPORT_SIZE:
            raise HTTPException(status_code=413, detail="Import file too large (max 50MB)")
    except ValueError:
        pass
    if mode in ("override", "merge") and target_profile_id is None:
        raise HTTPException(status_code=400, detail=f"{mode} mode requires target_profile_id")
    if target_profile_id is not None:
        profile = db.get(Profile, target_profile_id)
        if not profile or profile.user_id != user.id:
            raise HTTPException(status_code=404, detail="Target profile not found")
    try:
        result = import_profiles(db, data, mode, target_profile_id, user_id=user.id)
        sync_cards_to_templates(db)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{profile_id}", response_model=ProfileOut)
def get_profile(profile_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


@router.put("/{profile_id}", response_model=ProfileOut)
def update_profile(profile_id: int, data: ProfileUpdate, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")
    existing = (
        db.query(Profile)
        .filter(Profile.user_id == user.id, Profile.name.ilike(data.name), Profile.id != profile_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Profile name already exists")
    profile.name = data.name
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/{profile_id}", status_code=204)
def delete_profile(profile_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")
    db.delete(profile)
    db.commit()


@router.get("/{profile_id}/524")
def get_five_twenty_four(profile_id: int, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")
    return get_524_details(db, profile_id, user.id)
