import logging
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.system_config import SystemConfig
from app.schemas.user import (
    AuthModeResponse,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserBrief,
    UserOut,
)
from app.services.auth_service import (
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.rate_limit import limiter
from app.services.setup_service import get_system_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)


def _get_auth_mode(db: Session) -> str:
    return get_system_config(db, "auth_mode", "open")


def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """Mode-aware auth dependency. Returns the authenticated User."""
    auth_mode = _get_auth_mode(db)

    # Open mode: no auth required — return default user
    if auth_mode == "open":
        user = db.query(User).filter(User.role == "admin").first()
        if not user:
            # Fallback: first active user
            user = db.query(User).filter(User.is_active.is_(True)).first()
        if not user:
            raise HTTPException(status_code=500, detail="No users exist")
        return user

    # All other modes require a token
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_token(credentials.credentials)
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    try:
        user_id = int(sub)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive"
        )

    # Check if password was changed after token was issued
    pwd_ts = payload.get("pwd_ts")
    if user.password_changed_at:
        user_pwd_ts = int(user.password_changed_at.timestamp())
        if pwd_ts is None or pwd_ts < user_pwd_ts:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token invalidated by password change",
            )

    return user


def require_admin(user: User = Depends(require_auth)) -> User:
    """Dependency that requires the authenticated user to be an admin."""
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


@router.get("/mode", response_model=AuthModeResponse)
def get_auth_mode(db: Session = Depends(get_db)):
    """Public endpoint — returns current auth mode and configuration."""
    auth_mode = _get_auth_mode(db)
    registration_enabled = get_system_config(db, "registration_enabled", "true") == "true"

    oauth_providers: list[dict] = []
    if auth_mode == "multi_user_oauth":
        from app.models.oauth_provider import OAuthProvider

        providers = (
            db.query(OAuthProvider).filter(OAuthProvider.enabled.is_(True)).all()
        )
        oauth_providers = [
            {"name": p.provider_name, "display_name": p.display_name}
            for p in providers
        ]

    return AuthModeResponse(
        auth_mode=auth_mode,
        registration_enabled=registration_enabled,
        oauth_providers=oauth_providers,
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(request: Request, data: LoginRequest, db: Session = Depends(get_db)):
    """Mode-aware login endpoint."""
    auth_mode = _get_auth_mode(db)

    if auth_mode == "open":
        # Auto-login as default admin user
        user = db.query(User).filter(User.role == "admin").first()
        if not user:
            user = db.query(User).filter(User.is_active.is_(True)).first()
        if not user:
            raise HTTPException(status_code=500, detail="No users exist")

    elif auth_mode == "single_password":
        if not data.password:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Password required"
            )
        # Check against system config stored hash
        stored_hash = get_system_config(db, "single_password_hash", "")
        if not stored_hash or not verify_password(data.password, stored_hash):
            logger.warning("Failed login attempt (single_password mode)")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password"
            )
        # Single-password mode: log in as admin user
        user = db.query(User).filter(User.role == "admin").first()
        if not user:
            raise HTTPException(status_code=500, detail="No admin user exists")

    elif auth_mode == "multi_user_oauth":
        raise HTTPException(
            status_code=400, detail="Password login is disabled. Use OAuth to sign in."
        )

    elif auth_mode == "multi_user":
        if not data.username or not data.password:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Username and password required",
            )
        user = db.query(User).filter(User.username == data.username).first()
        if not user or not user.password_hash:
            logger.warning("Failed login attempt for user: %s", data.username)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
            )
        if not verify_password(data.password, user.password_hash):
            logger.warning("Failed login attempt for user: %s", data.username)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
            )
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled"
            )
    else:
        raise HTTPException(status_code=500, detail=f"Unknown auth mode: {auth_mode}")

    # Update last_login
    user.last_login = datetime.now(timezone.utc)
    db.commit()

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


@router.post("/register", response_model=TokenResponse)
@limiter.limit("5/minute")
def register(request: Request, data: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new user (multi_user modes only, when registration is enabled)."""
    auth_mode = _get_auth_mode(db)
    if auth_mode != "multi_user":
        raise HTTPException(status_code=400, detail="Registration not available in this auth mode")

    registration_enabled = get_system_config(db, "registration_enabled", "true") == "true"
    if not registration_enabled:
        raise HTTPException(status_code=403, detail="Registration is disabled")

    # Check for existing username
    existing = db.query(User).filter(User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")

    # Check for existing email
    if data.email:
        existing_email = db.query(User).filter(User.email == data.email).first()
        if existing_email:
            raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        username=data.username,
        display_name=data.display_name or data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        role="user",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already taken")
    db.refresh(user)

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


@router.get("/verify")
def verify(user: User = Depends(require_auth)):
    """Verify the current token and return user info."""
    return {
        "status": "ok",
        "user": UserOut.model_validate(user).model_dump(),
    }
