import json
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

EventType = Literal[
    "opened", "closed", "product_change",
    "annual_fee_posted", "annual_fee_refund", "retention_offer", "reopened", "other",
]


class CardEventCreate(BaseModel):
    event_type: EventType
    event_date: date
    description: str | None = Field(default=None, max_length=1000)
    metadata_json: dict | None = None

    @field_validator("metadata_json")
    @classmethod
    def validate_metadata_size(cls, v: dict | None) -> dict | None:
        if v is not None:
            if len(json.dumps(v)) > 10000:
                raise ValueError("metadata_json must be under 10000 characters when serialized")
        return v


class CardEventUpdate(BaseModel):
    event_type: EventType | None = None
    event_date: date | None = None
    description: str | None = Field(default=None, max_length=1000)
    metadata_json: dict | None = None

    @field_validator("metadata_json")
    @classmethod
    def validate_metadata_size(cls, v: dict | None) -> dict | None:
        if v is not None:
            if len(json.dumps(v)) > 10000:
                raise ValueError("metadata_json must be under 10000 characters when serialized")
        return v


class CardEventOut(BaseModel):
    id: int
    card_id: int
    event_type: str
    event_date: date
    description: str | None
    metadata_json: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}
