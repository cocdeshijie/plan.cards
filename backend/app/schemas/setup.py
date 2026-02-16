from pydantic import BaseModel, Field
from typing import Literal


AuthMode = Literal["open", "single_password", "multi_user", "multi_user_oauth"]


class SetupStatusResponse(BaseModel):
    setup_complete: bool
    has_existing_data: bool


class SetupCompleteRequest(BaseModel):
    auth_mode: AuthMode
    admin_username: str | None = Field(default=None, min_length=1, max_length=100)
    admin_password: str | None = Field(default=None, min_length=8, max_length=128)
    admin_email: str | None = Field(default=None, max_length=255)
    admin_display_name: str | None = Field(default=None, max_length=200)
    registration_enabled: bool = True
    # OAuth provider fields (required when auth_mode is multi_user_oauth)
    oauth_provider_name: str | None = Field(default=None, max_length=50)
    oauth_client_id: str | None = Field(default=None, min_length=1)
    oauth_client_secret: str | None = Field(default=None, min_length=1)


class SetupCompleteResponse(BaseModel):
    success: bool
    auth_mode: str
    access_token: str
