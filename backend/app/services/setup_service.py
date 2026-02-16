from sqlalchemy.orm import Session

from app.models.oauth_provider import OAuthProvider
from app.models.profile import Profile
from app.models.setting import Setting
from app.models.system_config import SystemConfig
from app.models.user import User
from app.models.user_setting import UserSetting
from app.schemas.setup import SetupCompleteRequest
from app.services.auth_service import hash_password, create_access_token
from app.services.crypto import encrypt_value
from app.services.oauth_presets import get_preset


def is_setup_complete(db: Session) -> bool:
    row = db.get(SystemConfig, "setup_complete")
    return row is not None and row.value == "true"


def has_existing_data(db: Session) -> bool:
    return db.query(Profile).first() is not None


def get_system_config(db: Session, key: str, default: str = "") -> str:
    row = db.get(SystemConfig, key)
    return row.value if row else default


def set_system_config(db: Session, key: str, value: str) -> None:
    row = db.get(SystemConfig, key)
    if row:
        row.value = value
    else:
        db.add(SystemConfig(key=key, value=value))


def complete_setup(db: Session, data: SetupCompleteRequest) -> tuple[User | None, str]:
    """Run initial setup. Returns (user, access_token). For multi_user_oauth, returns (None, "")."""
    if is_setup_complete(db):
        raise ValueError("Setup already completed")

    # Validate required fields per mode
    if data.auth_mode == "single_password":
        if not data.admin_password:
            raise ValueError("Password required for single_password mode")
    elif data.auth_mode == "multi_user":
        if not data.admin_username:
            raise ValueError("Username required for multi_user mode")
        if not data.admin_password:
            raise ValueError("Password required for multi_user mode")
    elif data.auth_mode == "multi_user_oauth":
        if not data.oauth_provider_name or not data.oauth_client_id or not data.oauth_client_secret:
            raise ValueError("OAuth provider name, client ID, and client secret are required")

    # Store system config
    set_system_config(db, "auth_mode", data.auth_mode)
    set_system_config(db, "setup_complete", "true")
    set_system_config(db, "registration_enabled", str(data.registration_enabled).lower())

    if data.auth_mode == "multi_user_oauth":
        # Create OAuth provider — no user created; first OAuth login becomes admin
        preset = get_preset(data.oauth_provider_name)
        provider = OAuthProvider(
            provider_name=data.oauth_provider_name,
            display_name=preset["display_name"] if preset else data.oauth_provider_name,
            enabled=True,
            client_id=data.oauth_client_id,
            client_secret_encrypted=encrypt_value(data.oauth_client_secret),
            authorization_url=preset["authorization_url"] if preset else "",
            token_url=preset["token_url"] if preset else "",
            userinfo_url=preset.get("userinfo_url", "") if preset else "",
            issuer_url=preset.get("issuer_url") if preset else None,
            scopes=preset.get("scopes", "") if preset else "",
        )
        db.add(provider)
        db.commit()
        return None, ""

    # Create the user for non-OAuth modes
    username = data.admin_username or "admin"
    password_hash = hash_password(data.admin_password) if data.admin_password else None

    user = User(
        username=username,
        display_name=data.admin_display_name or username,
        email=data.admin_email,
        password_hash=password_hash,
        role="admin",
    )
    db.add(user)
    db.flush()  # get user.id

    # Assign all existing profiles to this user
    db.query(Profile).filter(Profile.user_id.is_(None)).update({"user_id": user.id})

    # Migrate existing global settings → user_settings
    global_settings = db.query(Setting).all()
    for s in global_settings:
        db.add(UserSetting(user_id=user.id, key=s.key, value=s.value))

    # For single_password mode, store the password hash in system_config
    if data.auth_mode == "single_password" and password_hash:
        set_system_config(db, "single_password_hash", password_hash)

    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.role)
    return user, token
