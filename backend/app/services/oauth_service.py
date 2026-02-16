"""OAuth token exchange and user creation/linking."""

import secrets
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.oauth_account import OAuthAccount
from app.models.oauth_provider import OAuthProvider as OAuthProviderModel
from app.models.profile import Profile
from app.models.setting import Setting
from app.models.user import User
from app.models.user_setting import UserSetting
from app.services.crypto import decrypt_value, encrypt_value
from app.services.setup_service import get_system_config


class AccountDeactivatedError(Exception):
    pass


class EmailConflictError(Exception):
    pass


def generate_state() -> str:
    return secrets.token_urlsafe(32)


def get_authorization_url(provider: OAuthProviderModel, redirect_uri: str, state: str) -> str:
    """Build the OAuth authorization URL."""
    params = {
        "client_id": provider.client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "response_type": "code",
        "scope": provider.scopes or "",
    }
    query = urlencode({k: v for k, v in params.items() if v})
    return f"{provider.authorization_url}?{query}"


async def exchange_code(
    provider: OAuthProviderModel,
    code: str,
    redirect_uri: str,
) -> dict:
    """Exchange authorization code for tokens and user info."""
    client_secret = decrypt_value(provider.client_secret_encrypted)

    # Exchange code for tokens
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            provider.token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": provider.client_id,
                "client_secret": client_secret,
            },
            headers={"Accept": "application/json"},
        )
        token_resp.raise_for_status()
        token_data = token_resp.json()

    access_token = token_data.get("access_token")
    if not access_token:
        raise ValueError("No access_token in response")

    # Fetch user info
    userinfo_url = provider.userinfo_url
    if not userinfo_url:
        raise ValueError("Provider has no userinfo_url configured")

    async with httpx.AsyncClient() as client:
        userinfo_resp = await client.get(
            userinfo_url,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
        userinfo_resp.raise_for_status()
        userinfo = userinfo_resp.json()

    return {
        "access_token": access_token,
        "refresh_token": token_data.get("refresh_token"),
        "expires_in": token_data.get("expires_in"),
        "userinfo": userinfo,
    }


def extract_user_info(provider_name: str, userinfo: dict) -> dict:
    """Extract standardized user info from provider-specific userinfo response."""
    if provider_name == "github":
        return {
            "provider_user_id": str(userinfo.get("id", "")),
            "email": userinfo.get("email"),
            "name": userinfo.get("name") or userinfo.get("login", ""),
            "username": userinfo.get("login", ""),
        }
    elif provider_name == "discord":
        return {
            "provider_user_id": userinfo.get("id", ""),
            "email": userinfo.get("email"),
            "name": userinfo.get("global_name") or userinfo.get("username", ""),
            "username": userinfo.get("username", ""),
        }
    else:
        # Standard OIDC (Google, Apple, generic)
        return {
            "provider_user_id": userinfo.get("sub", ""),
            "email": userinfo.get("email"),
            "name": userinfo.get("name", ""),
            "username": userinfo.get("email", "").split("@")[0] if userinfo.get("email") else "",
        }


def find_or_create_user(
    db: Session,
    provider_name: str,
    user_info: dict,
    oauth_tokens: dict,
) -> User | None:
    """Find existing user by OAuth account or create new one. Returns None if registration disabled."""
    provider_user_id = user_info["provider_user_id"]
    email = user_info.get("email")

    # Check for existing OAuth link
    existing_account = (
        db.query(OAuthAccount)
        .filter(
            OAuthAccount.provider == provider_name,
            OAuthAccount.provider_user_id == provider_user_id,
        )
        .first()
    )
    if existing_account:
        user = db.get(User, existing_account.user_id)
        if not user or not user.is_active:
            raise AccountDeactivatedError("Your account has been deactivated")
        # Update tokens
        existing_account.access_token = encrypt_value(oauth_tokens["access_token"]) if oauth_tokens.get("access_token") else None
        existing_account.refresh_token = encrypt_value(oauth_tokens["refresh_token"]) if oauth_tokens.get("refresh_token") else None
        user.last_login = datetime.now(timezone.utc)
        db.commit()
        return user

    # No existing OAuth link — check if registration is enabled
    reg_enabled = get_system_config(db, "registration_enabled", "true") == "true"
    if not reg_enabled:
        return None

    # Check email uniqueness before creating
    if email:
        existing_email_user = db.query(User).filter(User.email == email).first()
        if existing_email_user:
            raise EmailConflictError(
                "An account with this email already exists. Contact an administrator to link your accounts."
            )

    # Create new user — first user becomes admin
    is_first_user = db.query(User).first() is None

    username = user_info.get("username") or f"{provider_name}_{provider_user_id}"
    # Ensure unique username
    base_username = username
    suffix = 1
    while db.query(User).filter(User.username == username).first():
        username = f"{base_username}_{suffix}"
        suffix += 1

    user = User(
        username=username,
        display_name=user_info.get("name") or username,
        email=email,
        role="admin" if is_first_user else "user",
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise EmailConflictError(
            "An account with this email already exists. Contact an administrator to link your accounts."
        )

    # First user: adopt orphan profiles and migrate global settings
    if is_first_user:
        db.query(Profile).filter(Profile.user_id.is_(None)).update({"user_id": user.id})
        for s in db.query(Setting).all():
            db.add(UserSetting(user_id=user.id, key=s.key, value=s.value))

    oauth_account = OAuthAccount(
        user_id=user.id,
        provider=provider_name,
        provider_user_id=provider_user_id,
        provider_email=email,
        access_token=encrypt_value(oauth_tokens["access_token"]) if oauth_tokens.get("access_token") else None,
        refresh_token=encrypt_value(oauth_tokens["refresh_token"]) if oauth_tokens.get("refresh_token") else None,
    )
    db.add(oauth_account)
    user.last_login = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user
