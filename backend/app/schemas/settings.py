from pydantic import BaseModel, Field


class SettingsUpdate(BaseModel):
    timezone: str | None = Field(default=None, max_length=100)
