import logging
import time
import zoneinfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.oauth_account import OAuthAccount
from app.models.oauth_provider import OAuthProvider
from app.models.user import User
from app.models.user_setting import UserSetting
from app.routers.auth import require_auth
from app.schemas.user import UserOut
from app.rate_limit import limiter
from app.services.auth_service import hash_password, verify_password
from app.services.crypto import encrypt_value
from app.services.oauth_service import exchange_code, extract_user_info
from app.services.setup_service import get_system_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/users", tags=["users"])


class UpdateProfileRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=255)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


@router.get("/me", response_model=UserOut)
def get_current_user(user: User = Depends(require_auth)):
    return user


@router.put("/me", response_model=UserOut)
def update_current_user(
    data: UpdateProfileRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    if data.display_name is not None:
        user.display_name = data.display_name
    if data.email is not None:
        if data.email:
            existing = db.query(User).filter(User.email == data.email, User.id != user.id).first()
            if existing:
                raise HTTPException(status_code=409, detail="Email already registered")
        user.email = data.email or None
    db.commit()
    db.refresh(user)
    return user


@router.put("/me/password")
@limiter.limit("5/minute")
def change_password(
    request: Request,
    data: ChangePasswordRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    from datetime import datetime, timezone
    from app.services.auth_service import create_access_token

    if not user.password_hash:
        raise HTTPException(status_code=400, detail="No password set (OAuth-only account)")
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    user.password_hash = hash_password(data.new_password)
    user.password_changed_at = datetime.now(timezone.utc)
    db.commit()
    # Return a new token so the current session stays valid
    token = create_access_token(user.id, user.role, user.password_changed_at)
    return {"status": "ok", "access_token": token}


@router.get("/me/settings")
def get_user_settings(user: User = Depends(require_auth), db: Session = Depends(get_db)):
    settings = db.query(UserSetting).filter(UserSetting.user_id == user.id).all()
    return {s.key: s.value for s in settings}


ALLOWED_SETTING_KEYS = {"timezone", "theme"}


@router.put("/me/settings")
def update_user_settings(
    data: dict,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    invalid_keys = set(data.keys()) - ALLOWED_SETTING_KEYS
    if invalid_keys:
        raise HTTPException(status_code=400, detail=f"Unknown settings: {', '.join(sorted(invalid_keys))}")
    for key, value in data.items():
        if value is not None and len(str(value)) > 200:
            raise HTTPException(status_code=400, detail=f"Setting value for '{key}' too long (max 200 chars)")
        if key == "timezone" and value is not None and value != "":
            try:
                zoneinfo.ZoneInfo(str(value))
            except (KeyError, zoneinfo.ZoneInfoNotFoundError):
                raise HTTPException(status_code=400, detail="Invalid timezone")
        existing = (
            db.query(UserSetting)
            .filter(UserSetting.user_id == user.id, UserSetting.key == key)
            .first()
        )
        if value is None:
            if existing:
                db.delete(existing)
        elif existing:
            existing.value = str(value)
        else:
            db.add(UserSetting(user_id=user.id, key=key, value=str(value)))
    db.commit()
    return get_user_settings(user, db)


# ── OAuth account linking ──────────────────────────────────────────


class OAuthLinkRequest(BaseModel):
    provider_name: str
    code: str
    state: str
    redirect_uri: str


@router.get("/me/oauth-accounts")
def list_oauth_accounts(user: User = Depends(require_auth), db: Session = Depends(get_db)):
    """List the current user's linked OAuth accounts."""
    accounts = db.query(OAuthAccount).filter(OAuthAccount.user_id == user.id).all()
    return [
        {"provider": a.provider, "provider_email": a.provider_email}
        for a in accounts
    ]


@router.post("/me/oauth/link")
async def user_link_oauth(
    data: OAuthLinkRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Link the current user's account to an OAuth provider."""
    from app.models.oauth_state import OAuthState

    # Validate state
    oauth_state = db.query(OAuthState).filter(OAuthState.state == data.state).first()
    if not oauth_state or (time.time() - oauth_state.created_at) > 600:
        if oauth_state:
            db.delete(oauth_state)
            db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")
    db.delete(oauth_state)
    db.commit()

    provider = (
        db.query(OAuthProvider)
        .filter(OAuthProvider.provider_name == data.provider_name, OAuthProvider.enabled.is_(True))
        .first()
    )
    if not provider:
        raise HTTPException(status_code=404, detail="OAuth provider not found or not enabled")

    try:
        tokens = await exchange_code(provider, data.code, data.redirect_uri)
    except Exception as e:
        logger.error(f"User OAuth link token exchange failed: {e}")
        raise HTTPException(status_code=400, detail="OAuth token exchange failed. Check provider configuration.")

    user_info = extract_user_info(data.provider_name, tokens["userinfo"])
    provider_user_id = str(user_info["provider_user_id"])

    # Check if this OAuth identity is already linked to another user
    existing_link = (
        db.query(OAuthAccount)
        .filter(OAuthAccount.provider == data.provider_name, OAuthAccount.provider_user_id == provider_user_id)
        .first()
    )
    if existing_link and existing_link.user_id != user.id:
        raise HTTPException(status_code=409, detail="This OAuth account is linked to a different user")

    enc_access = encrypt_value(tokens["access_token"]) if tokens.get("access_token") else None
    enc_refresh = encrypt_value(tokens["refresh_token"]) if tokens.get("refresh_token") else None

    if existing_link:
        existing_link.access_token = enc_access
        existing_link.refresh_token = enc_refresh
        existing_link.provider_email = user_info.get("email")
    else:
        oauth_account = OAuthAccount(
            user_id=user.id,
            provider=data.provider_name,
            provider_user_id=provider_user_id,
            provider_email=user_info.get("email"),
            access_token=enc_access,
            refresh_token=enc_refresh,
        )
        db.add(oauth_account)

    db.commit()
    return {"status": "ok", "provider": data.provider_name}


@router.delete("/me/oauth/{provider_name}")
def user_unlink_oauth(
    provider_name: str,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Unlink an OAuth account from the current user."""
    account = (
        db.query(OAuthAccount)
        .filter(OAuthAccount.user_id == user.id, OAuthAccount.provider == provider_name)
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="OAuth account not found")

    # Don't allow unlinking the last OAuth account if it would lock the user out.
    # In OAuth mode, password login is disabled so password_hash doesn't help.
    auth_mode = get_system_config(db, "auth_mode", "open")
    if auth_mode == "multi_user_oauth" or not user.password_hash:
        oauth_count = db.query(OAuthAccount).filter(OAuthAccount.user_id == user.id).count()
        if oauth_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot unlink your only OAuth account",
            )

    db.delete(account)
    db.commit()
    return {"status": "ok"}
