import logging
import time

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.oauth_provider import OAuthProvider
from app.models.oauth_state import OAuthState
from app.models.user import User
from app.rate_limit import limiter
from app.routers.auth import require_admin
from app.schemas.user import TokenResponse, UserBrief
from app.services.auth_service import create_access_token, decode_token
from app.services.crypto import encrypt_value
from app.services.oauth_presets import get_preset, list_presets
from app.services.oauth_service import (
    AccountDeactivatedError,
    EmailConflictError,
    generate_state,
    get_authorization_url,
    exchange_code,
    extract_user_info,
    find_or_create_user,
)
from app.services.setup_service import get_system_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/oauth", tags=["oauth"])
_optional_bearer = HTTPBearer(auto_error=False)


def _require_oauth_mode(db: Session = Depends(get_db)):
    """Only allow OAuth flow when auth_mode is multi_user_oauth."""
    auth_mode = get_system_config(db, "auth_mode", "open")
    if auth_mode != "multi_user_oauth":
        raise HTTPException(status_code=400, detail="OAuth login is not enabled")


def _require_oauth_or_admin(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
):
    """Allow if in OAuth mode, or if the caller is an authenticated admin."""
    auth_mode = get_system_config(db, "auth_mode", "open")
    if auth_mode == "multi_user_oauth":
        return
    # Allow admins to use OAuth authorize for setup/linking purposes
    if credentials:
        try:
            payload = decode_token(credentials.credentials)
            sub = payload.get("sub")
            if sub:
                user = db.get(User, int(sub))
                if user and user.role == "admin" and user.is_active:
                    return
        except (jwt.PyJWTError, ValueError):
            pass
    raise HTTPException(status_code=400, detail="OAuth login is not enabled")


from app.config import OAUTH_STATE_TTL as STATE_TTL


class AuthorizeResponse(BaseModel):
    authorization_url: str


class TokenExchangeRequest(BaseModel):
    code: str
    state: str
    redirect_uri: str


class ProviderConfigRequest(BaseModel):
    provider_name: str = Field(max_length=50)
    client_id: str = Field(min_length=1)
    client_secret: str = Field(min_length=1)
    display_name: str | None = None
    enabled: bool = True
    # Override URLs (optional for presets)
    authorization_url: str | None = None
    token_url: str | None = None
    userinfo_url: str | None = None
    issuer_url: str | None = None
    scopes: str | None = None


class ProviderOut(BaseModel):
    id: int
    provider_name: str
    display_name: str | None
    enabled: bool
    client_id: str
    issuer_url: str | None
    scopes: str | None

    model_config = {"from_attributes": True}


@router.get("/presets")
def get_presets():
    """List available OAuth provider presets."""
    return list_presets()


@router.get("/providers", response_model=list[ProviderOut])
def list_providers(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.query(OAuthProvider).order_by(OAuthProvider.provider_name).all()


@router.post("/providers", response_model=ProviderOut, status_code=201)
def create_or_update_provider(
    data: ProviderConfigRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    # Get preset defaults
    preset = get_preset(data.provider_name)

    existing = db.query(OAuthProvider).filter(OAuthProvider.provider_name == data.provider_name).first()
    if existing:
        existing.client_id = data.client_id
        existing.client_secret_encrypted = encrypt_value(data.client_secret)
        existing.enabled = data.enabled
        sent = data.model_fields_set
        if "display_name" in sent:
            existing.display_name = data.display_name
        if "authorization_url" in sent:
            existing.authorization_url = data.authorization_url
        if "token_url" in sent:
            existing.token_url = data.token_url
        if "userinfo_url" in sent:
            existing.userinfo_url = data.userinfo_url
        if "issuer_url" in sent:
            existing.issuer_url = data.issuer_url
        if "scopes" in sent:
            existing.scopes = data.scopes
        db.commit()
        db.refresh(existing)
        return existing

    provider = OAuthProvider(
        provider_name=data.provider_name,
        display_name=data.display_name or (preset["display_name"] if preset else data.provider_name),
        enabled=data.enabled,
        client_id=data.client_id,
        client_secret_encrypted=encrypt_value(data.client_secret),
        authorization_url=data.authorization_url or (preset["authorization_url"] if preset else ""),
        token_url=data.token_url or (preset["token_url"] if preset else ""),
        userinfo_url=data.userinfo_url or (preset.get("userinfo_url", "") if preset else ""),
        issuer_url=data.issuer_url or (preset.get("issuer_url", "") if preset else None),
        scopes=data.scopes or (preset.get("scopes", "") if preset else ""),
    )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider


@router.delete("/providers/{provider_name}", status_code=204)
def delete_provider(
    provider_name: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.models.oauth_account import OAuthAccount

    provider = db.query(OAuthProvider).filter(OAuthProvider.provider_name == provider_name).first()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    # Prevent deleting the last provider in OAuth mode (would lock everyone out)
    auth_mode = get_system_config(db, "auth_mode", "open")
    if auth_mode == "multi_user_oauth":
        provider_count = db.query(OAuthProvider).count()
        if provider_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete the last OAuth provider in OAuth mode",
            )
        # Prevent admin from deleting the provider they're linked to (unless they have others)
        admin_linked = db.query(OAuthAccount).filter(
            OAuthAccount.user_id == admin.id,
            OAuthAccount.provider == provider_name,
        ).first()
        if admin_linked:
            admin_oauth_count = db.query(OAuthAccount).filter(OAuthAccount.user_id == admin.id).count()
            if admin_oauth_count <= 1:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot delete the OAuth provider your account is linked to. Link another provider first.",
                )
    # Also clean up linked accounts for this provider
    db.query(OAuthAccount).filter(OAuthAccount.provider == provider_name).delete()
    db.delete(provider)
    db.commit()


def _validate_redirect_uri(redirect_uri: str) -> None:
    """Validate redirect_uri against ALLOWED_ORIGINS to prevent open redirects."""
    from urllib.parse import urlparse

    from app.config import settings

    parsed = urlparse(redirect_uri)
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid redirect_uri")

    # When ALLOWED_ORIGINS is unrestricted, skip origin check —
    # OAuth providers themselves validate redirect_uri against their config.
    raw = settings.allowed_origins.strip()
    if raw == "*" or not raw:
        return

    redirect_origin = f"{parsed.scheme}://{parsed.netloc}"
    allowed = [o.strip() for o in raw.split(",")]
    if redirect_origin not in allowed:
        raise HTTPException(status_code=400, detail="redirect_uri origin not allowed")


@router.get("/{provider_name}/authorize", response_model=AuthorizeResponse)
def authorize(provider_name: str, redirect_uri: str, db: Session = Depends(get_db), _=Depends(_require_oauth_or_admin)):
    _validate_redirect_uri(redirect_uri)
    provider = (
        db.query(OAuthProvider)
        .filter(OAuthProvider.provider_name == provider_name, OAuthProvider.enabled.is_(True))
        .first()
    )
    if not provider:
        raise HTTPException(status_code=404, detail="OAuth provider not found or disabled")

    state = generate_state()

    now = time.time()
    db.add(OAuthState(state=state, created_at=now))
    # Lazy cleanup: remove states older than STATE_TTL
    db.query(OAuthState).filter(OAuthState.created_at < now - STATE_TTL).delete()
    db.commit()

    url = get_authorization_url(provider, redirect_uri, state)
    return AuthorizeResponse(authorization_url=url)


@router.post("/{provider_name}/token", response_model=TokenResponse)
@limiter.limit("10/minute")
async def token_exchange(
    request: Request,
    provider_name: str,
    data: TokenExchangeRequest,
    db: Session = Depends(get_db),
    _mode=Depends(_require_oauth_mode),
):
    # 1a: Validate redirect_uri in token exchange (not just in /authorize)
    _validate_redirect_uri(data.redirect_uri)

    # 1e: Atomic state consumption — delete first, check rows affected
    now = time.time()
    deleted = (
        db.query(OAuthState)
        .filter(OAuthState.state == data.state, OAuthState.created_at >= now - STATE_TTL)
        .delete()
    )
    db.commit()
    if deleted == 0:
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    provider = (
        db.query(OAuthProvider)
        .filter(OAuthProvider.provider_name == provider_name, OAuthProvider.enabled.is_(True))
        .first()
    )
    if not provider:
        raise HTTPException(status_code=404, detail="OAuth provider not found or disabled")

    try:
        oauth_result = await exchange_code(provider, data.code, data.redirect_uri)
    except Exception as e:
        logger.error(f"OAuth token exchange failed for {provider_name}: {e}")
        raise HTTPException(status_code=400, detail="OAuth token exchange failed. Check provider configuration.")

    user_info = extract_user_info(provider_name, oauth_result["userinfo"])
    try:
        user = find_or_create_user(db, provider_name, user_info, oauth_result)
    except AccountDeactivatedError:
        raise HTTPException(status_code=403, detail="Your account has been deactivated. Contact an administrator.")
    except EmailConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))

    if not user:
        raise HTTPException(status_code=403, detail="Registration is disabled. Contact an administrator to get an account.")

    token = create_access_token(user.id, user.role, user.password_changed_at)
    return TokenResponse(
        access_token=token,
        user=UserBrief(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role,
        ),
    )
