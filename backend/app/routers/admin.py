import logging
import os
import shutil
import tempfile
import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.oauth_account import OAuthAccount
from app.models.oauth_provider import OAuthProvider
from app.models.user import User
from app.rate_limit import limiter
from app.routers.auth import require_admin, require_privileged
from app.schemas.user import UserOut
from app.services.auth_service import hash_password
from app.services.crypto import encrypt_value
from app.services.setup_service import get_system_config, set_system_config
from app.services.template_loader import load_templates, get_all_templates
from app.services.template_sync import sync_cards_to_templates

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_multi_user_mode(db: Session = Depends(get_db)):
    """Only allow user management in multi_user or multi_user_oauth modes."""
    auth_mode = get_system_config(db, "auth_mode", "open")
    if auth_mode not in ("multi_user", "multi_user_oauth"):
        raise HTTPException(
            status_code=400,
            detail="User management is only available in multi-user modes",
        )


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=255)
    role: Literal["admin", "user"] = "user"


class UpdateUserRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=255)
    role: Literal["admin", "user"] | None = None
    is_active: bool | None = None


class SetUserPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class SystemConfigUpdate(BaseModel):
    registration_enabled: bool | None = None


class AuthUpgradeRequest(BaseModel):
    target_mode: str
    admin_password: str | None = Field(default=None, min_length=8, max_length=128)
    single_password: str | None = Field(default=None, min_length=8, max_length=128)


@router.get("/users", response_model=list[UserOut])
def list_users(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    _mode=Depends(_require_multi_user_mode),
):
    return db.query(User).order_by(User.created_at).all()


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    data: CreateUserRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    _mode=Depends(_require_multi_user_mode),
):
    auth_mode = get_system_config(db, "auth_mode", "open")
    if auth_mode == "multi_user_oauth":
        raise HTTPException(
            status_code=400,
            detail="Cannot create password-based users in OAuth mode. Users register via OAuth.",
        )
    existing = db.query(User).filter(func.lower(User.username) == data.username.strip().lower()).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")
    if data.email:
        existing_email = db.query(User).filter(func.lower(User.email) == data.email.strip().lower()).first()
        if existing_email:
            raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        username=data.username,
        display_name=data.display_name or data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already taken")
    db.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    data: UpdateUserRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    _mode=Depends(_require_multi_user_mode),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # DELETE /users/{id} already refuses self-targeting; this endpoint performs
    # the same state changes and must enforce the same invariant. Otherwise an
    # admin can demote or deactivate themselves and require_auth rejects their
    # own token on the very next request.
    if user.id == admin.id:
        if data.role is not None and data.role != user.role:
            raise HTTPException(status_code=400, detail="Cannot change your own role")
        if data.is_active is not None and not data.is_active:
            raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    if data.display_name is not None:
        user.display_name = data.display_name
    if data.email is not None:
        if data.email:
            existing = db.query(User).filter(func.lower(User.email) == data.email.strip().lower(), User.id != user.id).first()
            if existing:
                raise HTTPException(status_code=409, detail="Email already registered")
        user.email = data.email or None
    # Captured before any mutation: assigning user.role first would make the
    # deactivation guard below read the already-demoted role, so
    # {"role": "user", "is_active": false} slipped past the last-admin check.
    was_admin = user.role == "admin"
    if data.role is not None:
        # Prevent removing the last admin
        if was_admin and data.role == "user":
            admin_count = db.query(User).filter(User.role == "admin", User.is_active.is_(True)).count()
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot remove the last admin")
        user.role = data.role
    if data.is_active is not None:
        # Prevent deactivating the last admin
        if was_admin and not data.is_active:
            admin_count = db.query(User).filter(User.role == "admin", User.is_active.is_(True)).count()
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot deactivate the last admin")
        user.is_active = data.is_active
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
def deactivate_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    _mode=Depends(_require_multi_user_mode),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    if user.role == "admin":
        admin_count = db.query(User).filter(User.role == "admin", User.is_active.is_(True)).count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot deactivate the last admin")
    user.is_active = False
    db.commit()


@router.put("/users/{user_id}/password")
def admin_set_user_password(
    user_id: int,
    data: SetUserPasswordRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    _mode=Depends(_require_multi_user_mode),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(data.password)
    user.password_changed_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "ok"}


@router.get("/config")
def get_config(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    admin_oauth_linked = (
        db.query(OAuthAccount).filter(OAuthAccount.user_id == admin.id).first() is not None
    )
    return {
        "auth_mode": get_system_config(db, "auth_mode", "open"),
        "registration_enabled": get_system_config(db, "registration_enabled", "true") == "true",
        "admin_oauth_linked": admin_oauth_linked,
    }


@router.put("/config")
def update_config(
    data: SystemConfigUpdate,
    admin: User = Depends(require_privileged),
    db: Session = Depends(get_db),
):
    if data.registration_enabled is not None:
        set_system_config(db, "registration_enabled", str(data.registration_enabled).lower())
    db.commit()
    return get_config(admin, db)


# Auth mode upgrade ordering
_MODE_ORDER = ["open", "single_password", "multi_user", "multi_user_oauth"]


@router.post("/auth/upgrade")
def upgrade_auth_mode(
    data: AuthUpgradeRequest,
    admin: User = Depends(require_privileged),
    db: Session = Depends(get_db),
):
    current = get_system_config(db, "auth_mode", "open")
    target = data.target_mode
    if target not in _MODE_ORDER:
        raise HTTPException(status_code=400, detail=f"Invalid target mode: {target}")
    if _MODE_ORDER.index(target) <= _MODE_ORDER.index(current):
        raise HTTPException(status_code=400, detail="Can only upgrade to a higher auth mode")

    # Validate requirements based on target mode
    if target == "single_password":
        if not data.single_password:
            raise HTTPException(status_code=400, detail="Password required for single_password mode")
        set_system_config(db, "single_password_hash", hash_password(data.single_password))

    passwordless_count = 0
    if target == "multi_user":
        # Ensure admin has a password
        if not admin.password_hash:
            if not data.admin_password:
                raise HTTPException(status_code=400, detail="Admin password required for multi_user mode")
            admin.password_hash = hash_password(data.admin_password)
        # Count users without passwords who won't be able to log in
        passwordless_count = (
            db.query(User)
            .filter(User.id != admin.id, User.password_hash.is_(None), User.is_active.is_(True))
            .count()
        )

    no_oauth_count = 0
    if target == "multi_user_oauth":
        # Require at least one OAuth provider configured
        provider_count = db.query(OAuthProvider).filter(OAuthProvider.enabled.is_(True)).count()
        if provider_count == 0:
            raise HTTPException(status_code=400, detail="Configure at least one OAuth provider before upgrading")
        # Require admin to have linked an OAuth account
        admin_link = db.query(OAuthAccount).filter(OAuthAccount.user_id == admin.id).first()
        if not admin_link:
            raise HTTPException(status_code=400, detail="Link your admin account to an OAuth provider before upgrading")
        # Count users without OAuth links who will be locked out
        from sqlalchemy import func, select
        users_with_oauth = select(OAuthAccount.user_id).distinct()
        no_oauth_count = (
            db.query(func.count(User.id))
            .filter(User.id != admin.id, User.is_active.is_(True), User.id.notin_(users_with_oauth))
            .scalar()
        )

    # Revoke every token minted under the looser mode. In `open` mode
    # POST /api/auth/login hands any anonymous caller a 24h admin JWT; without
    # this, that token keeps full admin access for the rest of its lifetime
    # AFTER the operator has locked the instance down. require_auth's pwd_ts
    # check is skipped entirely while password_changed_at is NULL.
    now = datetime.now(timezone.utc)
    db.query(User).update({User.password_changed_at: now}, synchronize_session=False)

    set_system_config(db, "auth_mode", target)
    db.commit()

    result: dict = {"status": "ok", "auth_mode": target}
    warnings: list[str] = []
    if passwordless_count > 0:
        warnings.append(
            f"{passwordless_count} user(s) have no password and will not be able to log in. "
            "Use the admin panel to set passwords for these users."
        )
    if no_oauth_count > 0:
        warnings.append(
            f"{no_oauth_count} user(s) have no linked OAuth account. "
            "They can still link their account from the account menu while their current session is active."
        )
    if warnings:
        result["warning"] = " ".join(warnings)
    return result


# ── Admin OAuth account linking ─────────────────────────────────────

class AdminOAuthLinkRequest(BaseModel):
    provider_name: str
    code: str
    state: str
    redirect_uri: str


@router.post("/oauth/link")
async def admin_link_oauth(
    request: Request,
    response: Response,
    data: AdminOAuthLinkRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Link the admin's account to an OAuth provider (for OAuth mode setup)."""
    from app.routers.oauth import _validate_redirect_uri, consume_state
    from app.services.oauth_service import exchange_code, extract_user_info, MissingSubjectError
    from app.services.crypto import DecryptionError

    # Validate redirect_uri against ALLOWED_ORIGINS
    _validate_redirect_uri(data.redirect_uri)

    # Atomic, browser-bound, provider-scoped state consumption.
    consume_state(db, request, response, data.state, data.provider_name)

    # Get the provider config
    provider = (
        db.query(OAuthProvider)
        .filter(OAuthProvider.provider_name == data.provider_name, OAuthProvider.enabled.is_(True))
        .first()
    )
    if not provider:
        raise HTTPException(status_code=404, detail="OAuth provider not found or not enabled")

    # Exchange code for tokens
    try:
        tokens = await exchange_code(provider, data.code, data.redirect_uri)
    except DecryptionError as e:
        # The stored client secret can't be read — almost always a rotated
        # SECRET_KEY. Say so, instead of blaming "provider configuration".
        logger.error(f"Admin OAuth link client secret unreadable: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Admin OAuth link token exchange failed: {e}")
        raise HTTPException(status_code=400, detail="OAuth token exchange failed. Check provider configuration.")

    try:
        user_info = extract_user_info(data.provider_name, tokens["userinfo"])
    except MissingSubjectError as e:
        logger.error("OAuth identity missing for %s: %s", data.provider_name, e)
        raise HTTPException(status_code=400, detail=str(e))
    provider_user_id = str(user_info["provider_user_id"])

    # Check if this OAuth account is already linked to another user
    existing_link = (
        db.query(OAuthAccount)
        .filter(
            OAuthAccount.provider == data.provider_name,
            OAuthAccount.provider_user_id == provider_user_id,
        )
        .first()
    )
    if existing_link and existing_link.user_id != admin.id:
        raise HTTPException(status_code=409, detail="This OAuth account is linked to a different user")

    enc_access = encrypt_value(tokens["access_token"]) if tokens.get("access_token") else None
    enc_refresh = encrypt_value(tokens["refresh_token"]) if tokens.get("refresh_token") else None

    if existing_link:
        # Update tokens
        existing_link.access_token = enc_access
        existing_link.refresh_token = enc_refresh
        existing_link.provider_email = user_info.get("email")
    else:
        # Create new link
        oauth_account = OAuthAccount(
            user_id=admin.id,
            provider=data.provider_name,
            provider_user_id=provider_user_id,
            provider_email=user_info.get("email"),
            access_token=enc_access,
            refresh_token=enc_refresh,
        )
        db.add(oauth_account)

    db.commit()
    return {"status": "ok", "provider": data.provider_name}


# ── Template reload ─────────────────────────────────────────────────


@router.post("/reload-templates")
def reload_templates(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Force reload all card templates from disk and sync active cards."""
    load_templates()
    templates_loaded = len(get_all_templates())
    summary = sync_cards_to_templates(db)
    return {
        "status": "ok",
        "templates_loaded": templates_loaded,
        "sync": summary,
    }


# ── Database backup ─────────────────────────────────────────────────


@router.get("/backup")
@limiter.limit("5/minute")
def download_backup(
    request: Request,
    admin: User = Depends(require_privileged),
    db: Session = Depends(get_db),
):
    """Stream a consistent snapshot of the SQLite database.

    Gated by require_privileged, not require_admin. In `open` mode require_auth
    hands back the first admin without checking any credential, so require_admin
    gates nothing — this endpoint was downloadable with no credential at all,
    yielding password hashes and encrypted OAuth secrets. Once card details are
    stored it also yields those. require_privileged additionally demands the
    bootstrap token from the container logs when the mode is `open`.

    Note the backup does NOT contain /data/.encryption_key, so restoring it onto
    a fresh volume produces card details and OAuth secrets that cannot be
    decrypted. That is the right default for a file that leaves the server, but
    it has to be said out loud wherever the download is offered.

    Uses `VACUUM INTO`, which produces a valid single-file copy of a LIVE
    database. That matters because the app runs in WAL mode: the obvious backup
    a self-hoster reaches for --
        docker cp backend:/data/cards.db ./backup.db
    -- silently captures a file missing every commit still sitting in
    cards.db-wal, and the copy looks fine until you restore it.

    Unlike the JSON profile export this covers everything: users, auth mode,
    OAuth provider config, and all profiles.
    """
    # Back up the database this session is actually bound to, not a
    # module-level engine that may point somewhere else.
    bind = db.get_bind()
    if bind.dialect.name != "sqlite":
        raise HTTPException(
            status_code=400, detail="Database backup is only supported for SQLite"
        )

    tmp_dir = tempfile.mkdtemp(prefix="cct-backup-")
    # Server-generated path; no user input reaches this statement (SQLite has no
    # bind-parameter form for VACUUM INTO).
    tmp_path = os.path.join(tmp_dir, "cards.db")
    try:
        # VACUUM cannot run inside a transaction.
        with bind.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.exec_driver_sql(f"VACUUM INTO '{tmp_path}'")
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        logger.exception("Database backup failed")
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    def _cleanup() -> None:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return FileResponse(
        tmp_path,
        media_type="application/octet-stream",
        filename=f"plan-cards-{stamp}.db",
        background=BackgroundTask(_cleanup),
    )
