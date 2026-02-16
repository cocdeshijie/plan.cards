import zoneinfo
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.setting import Setting
from app.models.user import User
from app.models.user_setting import UserSetting
from app.routers.auth import require_auth
from app.schemas.settings import SettingsUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _upsert_setting(db: Session, user_id: int, key: str, value: str) -> None:
    setting = (
        db.query(UserSetting)
        .filter(UserSetting.user_id == user_id, UserSetting.key == key)
        .first()
    )
    if setting:
        setting.value = value
    else:
        db.add(UserSetting(user_id=user_id, key=key, value=value))


def _delete_setting(db: Session, user_id: int, key: str) -> None:
    setting = (
        db.query(UserSetting)
        .filter(UserSetting.user_id == user_id, UserSetting.key == key)
        .first()
    )
    if setting:
        db.delete(setting)


def _get_server_timezone(db: Session) -> str:
    """Get the effective server timezone: global setting or system local timezone."""
    global_tz = db.get(Setting, "timezone")
    if global_tz and global_tz.value:
        return global_tz.value
    local_tz = datetime.now(timezone.utc).astimezone().tzinfo
    tz_name = str(local_tz)
    # Python may return 'UTC+HH:MM' style; try to get IANA name
    if hasattr(local_tz, "key"):
        tz_name = local_tz.key
    return tz_name


@router.get("")
def get_settings(user: User = Depends(require_auth), db: Session = Depends(get_db)):
    settings = db.query(UserSetting).filter(UserSetting.user_id == user.id).all()
    result = {s.key: s.value for s in settings}
    result["server_timezone"] = _get_server_timezone(db)
    return result


@router.put("")
def update_settings(data: SettingsUpdate, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    if data.timezone is not None:
        if data.timezone == "":
            _delete_setting(db, user.id, "timezone")
        else:
            try:
                zoneinfo.ZoneInfo(data.timezone)
            except (KeyError, zoneinfo.ZoneInfoNotFoundError):
                raise HTTPException(status_code=400, detail="Invalid timezone")
            _upsert_setting(db, user.id, "timezone", data.timezone)
    db.commit()
    return get_settings(user, db)
