import zoneinfo
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.models.user_setting import UserSetting

# ZoneInfo raises ValueError -- not KeyError/ZoneInfoNotFoundError -- for keys
# like "", "/etc/localtime" or "../x". Omitting it meant a bad stored timezone
# (settable with no validation at all through profile import) produced a
# permanent 500 on every date-aware endpoint.
_TZ_ERRORS = (KeyError, ValueError, zoneinfo.ZoneInfoNotFoundError)


def resolve_timezone(name: str | None) -> zoneinfo.ZoneInfo | None:
    """Return the ZoneInfo for `name`, or None if it is not a usable zone."""
    if not name:
        return None
    try:
        return zoneinfo.ZoneInfo(name)
    except _TZ_ERRORS:
        return None


def get_today(db: Session, user_id: int | None = None) -> date:
    """Get today's date in the configured timezone for a user."""
    if user_id is not None:
        tz_setting = (
            db.query(UserSetting)
            .filter(UserSetting.user_id == user_id, UserSetting.key == "timezone")
            .first()
        )
        if tz_setting:
            tz = resolve_timezone(tz_setting.value)
            if tz is not None:
                return datetime.now(tz).date()

    # Fallback: check global Setting table for backward compatibility
    from app.models.setting import Setting
    global_tz = db.get(Setting, "timezone")
    if global_tz:
        tz = resolve_timezone(global_tz.value)
        if tz is not None:
            return datetime.now(tz).date()

    return date.today()
