from datetime import datetime

from pydantic import BaseModel, Field


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str | None
    email: str | None
    role: str
    is_active: bool
    created_at: datetime
    last_login: datetime | None

    model_config = {"from_attributes": True}


class UserBrief(BaseModel):
    id: int
    username: str
    display_name: str | None
    role: str

    model_config = {"from_attributes": True}


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=255)


class LoginRequest(BaseModel):
    username: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserBrief


class AuthModeResponse(BaseModel):
    auth_mode: str
    registration_enabled: bool
    oauth_providers: list[dict] = []
