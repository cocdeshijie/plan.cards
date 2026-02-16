from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

BonusSource = Literal["signup", "upgrade", "retention"]


class CardBonusOut(BaseModel):
    id: int
    card_id: int
    event_id: int | None = None
    bonus_source: str
    bonus_amount: int | None
    bonus_credit_amount: int | None = None
    bonus_type: str | None
    bonus_earned: bool
    bonus_missed: bool = False
    spend_requirement: int | None
    spend_deadline: date | None
    spend_reminder_enabled: bool
    spend_reminder_notes: str | None
    description: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CardBonusCreate(BaseModel):
    bonus_source: BonusSource
    event_id: int | None = None
    bonus_amount: int | None = Field(default=None, gt=0, le=99_999_999)
    bonus_credit_amount: int | None = Field(default=None, gt=0, le=99_999_999)
    bonus_type: str | None = Field(default=None, max_length=100)
    bonus_earned: bool = False
    bonus_missed: bool = False
    spend_requirement: int | None = Field(default=None, gt=0, le=99_999_999)
    spend_deadline: date | None = None
    spend_reminder_enabled: bool = False
    spend_reminder_notes: str | None = Field(default=None, max_length=1000)
    description: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_earned_missed(self) -> "CardBonusCreate":
        if self.bonus_earned and self.bonus_missed:
            raise ValueError("bonus_earned and bonus_missed cannot both be true")
        if self.spend_reminder_enabled and not (self.spend_requirement and self.spend_deadline):
            raise ValueError("spend_reminder_enabled requires both spend_requirement and spend_deadline")
        return self


class CardBonusUpdate(BaseModel):
    bonus_amount: int | None = Field(default=None, gt=0, le=99_999_999)
    bonus_credit_amount: int | None = Field(default=None, gt=0, le=99_999_999)
    bonus_type: str | None = Field(default=None, max_length=100)
    bonus_earned: bool | None = None
    bonus_missed: bool | None = None
    spend_requirement: int | None = Field(default=None, gt=0, le=99_999_999)
    spend_deadline: date | None = None
    spend_reminder_enabled: bool | None = None
    spend_reminder_notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_earned_missed(self) -> "CardBonusUpdate":
        if self.bonus_earned is True and self.bonus_missed is True:
            raise ValueError("bonus_earned and bonus_missed cannot both be true")
        return self
