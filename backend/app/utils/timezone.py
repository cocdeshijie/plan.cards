import zoneinfo
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.models.user_setting import UserSetting


def get_today(db: Session, user_id: int | None = None) -> date:
    """Get today's date in the configured timezone for a user."""
    if user_id is not None:
        tz_setting = (
            db.query(UserSetting)
            .filter(UserSetting.user_id == user_id, UserSetting.key == "timezone")
            .first()
        )
        if tz_setting:
            try:
                tz = zoneinfo.ZoneInfo(tz_setting.value)
                return datetime.now(tz).date()
            except (KeyError, zoneinfo.ZoneInfoNotFoundError):
                pass

    # Fallback: check global Setting table for backward compatibility
    from app.models.setting import Setting
    global_tz = db.get(Setting, "timezone")
    if global_tz:
        try:
            tz = zoneinfo.ZoneInfo(global_tz.value)
            return datetime.now(tz).date()
        except (KeyError, zoneinfo.ZoneInfoNotFoundError):
            pass

    return date.today()
