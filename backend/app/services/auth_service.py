from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Request, Response

from app.config import settings

ALGORITHM = "HS256"

# HttpOnly cookie holding the JWT. Set alongside the response-body token so that
# same-origin browser clients never need to keep the token in JS-readable storage
# (XSS can't exfiltrate an HttpOnly cookie). Cross-origin clients fall back to the
# Authorization: Bearer header.
AUTH_COOKIE_NAME = "cct_token"


def _request_is_secure(request: Request | None) -> bool:
    """True if the external request is HTTPS (directly or via a TLS-terminating
    proxy). Secure cookies are skipped on plain-HTTP deployments so auth keeps
    working over a LAN without TLS."""
    if request is None:
        return False
    if request.url.scheme == "https":
        return True
    return request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"


def set_auth_cookie(response: Response, token: str, request: Request | None = None) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        secure=_request_is_secure(request),
        samesite="lax",
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: int, role: str, password_changed_at: datetime | None = None) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict = {"sub": str(user_id), "role": role, "exp": expire, "iat": now}
    if password_changed_at:
        payload["pwd_ts"] = int(password_changed_at.timestamp())
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token. Raises jwt.PyJWTError on failure."""
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
