import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.user_setting import UserSetting
from app.routers.auth import require_auth

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

# Dismissed alert keys are stored per-user as a JSON array in user_settings.
_SETTING_KEY = "dismissed_alerts"
# Each alert key is per-occurrence (type-cardId-date), so the list only grows
# as time passes; cap it so it can never become unbounded.
_MAX_KEYS = 1000


class DismissRequest(BaseModel):
    alert_key: str = Field(min_length=1, max_length=200)


def _get_row(db: Session, user_id: int) -> UserSetting | None:
    return (
        db.query(UserSetting)
        .filter(UserSetting.user_id == user_id, UserSetting.key == _SETTING_KEY)
        .first()
    )


def _load(row: UserSetting | None) -> list[str]:
    if not row or not row.value:
        return []
    try:
        data = json.loads(row.value)
    except (ValueError, TypeError):
        return []
    if isinstance(data, list):
        return [str(x) for x in data]
    return []


@router.get("/dismissed", response_model=list[str])
def get_dismissed(user: User = Depends(require_auth), db: Session = Depends(get_db)):
    return _load(_get_row(db, user.id))


@router.post("/dismissed", response_model=list[str])
def add_dismissed(
    data: DismissRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    row = _get_row(db, user.id)
    keys = _load(row)
    if data.alert_key not in keys:
        keys.append(data.alert_key)
        if len(keys) > _MAX_KEYS:
            keys = keys[-_MAX_KEYS:]
        value = json.dumps(keys)
        if row:
            row.value = value
        else:
            db.add(UserSetting(user_id=user.id, key=_SETTING_KEY, value=value))
        db.commit()
    return keys


@router.delete("/dismissed", response_model=list[str])
def remove_dismissed(
    data: DismissRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    row = _get_row(db, user.id)
    keys = _load(row)
    if data.alert_key in keys:
        keys = [k for k in keys if k != data.alert_key]
        if row:
            row.value = json.dumps(keys)
            db.commit()
    return keys
