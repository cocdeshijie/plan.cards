from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.card_event import CardEventOut
from app.schemas.card_bonus import CardBonusOut

CardType = Literal["personal", "business"]
CardStatus = Literal["active", "closed"]


class CardCreate(BaseModel):
    profile_id: int
    template_id: str | None = None
    card_name: str = Field(min_length=1, max_length=200)
    last_digits: str | None = None
    issuer: str = Field(min_length=1, max_length=100)
    card_image: str | None = None
    network: str | None = Field(default=None, max_length=50)
    card_type: CardType = "personal"
    status: CardStatus = "active"
    open_date: date | None = None
    close_date: date | None = None
    annual_fee: int | None = Field(default=None, ge=0)
    annual_fee_date: date | None = None
    credit_limit: int | None = Field(default=None, gt=0)
    custom_notes: str | None = Field(default=None, max_length=5000)
    custom_tags: list[str] | None = None
    spend_reminder_enabled: bool = False
    spend_requirement: int | None = Field(default=None, gt=0)
    spend_deadline: date | None = None
    spend_reminder_notes: str | None = Field(default=None, max_length=1000)
    signup_bonus_amount: int | None = Field(default=None, gt=0)
    signup_bonus_type: str | None = Field(default=None, max_length=50)
    signup_bonus_earned: bool = False
    template_version_id: str | None = None

    @field_validator("last_digits")
    @classmethod
    def validate_last_digits(cls, v: str | None) -> str | None:
        if v is not None and v != "":
            import re
            if not re.match(r"^\d{4,5}$", v):
                raise ValueError("last_digits must be 4 or 5 digits")
        return v or None

    @field_validator("custom_tags")
    @classmethod
    def validate_custom_tags(cls, v: list[str] | None) -> list[str] | None:
        if v is not None:
            if len(v) > 20:
                raise ValueError("Maximum 20 tags allowed")
            cleaned = []
            for tag in v:
                tag = tag.strip()
                if not tag:
                    continue
                if len(tag) > 50:
                    raise ValueError("Each tag must be 50 characters or less")
                cleaned.append(tag)
            return cleaned or None
        return v

    @model_validator(mode="after")
    def validate_dates(self) -> "CardCreate":
        if self.close_date and self.open_date and self.close_date < self.open_date:
            raise ValueError("close_date cannot be before open_date")
        if self.spend_deadline and not self.spend_requirement:
            raise ValueError("spend_deadline requires spend_requirement")
        return self


class CardUpdate(BaseModel):
    template_id: str | None = None
    card_name: str | None = Field(default=None, min_length=1, max_length=200)
    last_digits: str | None = None
    card_image: str | None = None
    issuer: str | None = Field(default=None, min_length=1, max_length=100)
    network: str | None = Field(default=None, max_length=50)
    card_type: CardType | None = None
    open_date: date | None = None
    close_date: date | None = None
    annual_fee: int | None = Field(default=None, ge=0)
    annual_fee_date: date | None = None
    credit_limit: int | None = Field(default=None, gt=0)
    custom_notes: str | None = Field(default=None, max_length=5000)
    custom_tags: list[str] | None = None
    spend_reminder_enabled: bool | None = None
    spend_requirement: int | None = Field(default=None, gt=0)
    spend_deadline: date | None = None
    spend_reminder_notes: str | None = Field(default=None, max_length=1000)
    signup_bonus_amount: int | None = Field(default=None, gt=0)
    signup_bonus_type: str | None = Field(default=None, max_length=50)
    signup_bonus_earned: bool | None = None

    @field_validator("last_digits")
    @classmethod
    def validate_last_digits(cls, v: str | None) -> str | None:
        if v is not None and v != "":
            import re
            if not re.match(r"^\d{4,5}$", v):
                raise ValueError("last_digits must be 4 or 5 digits")
        return v or None

    @field_validator("custom_tags")
    @classmethod
    def validate_custom_tags(cls, v: list[str] | None) -> list[str] | None:
        if v is not None:
            if len(v) > 20:
                raise ValueError("Maximum 20 tags allowed")
            cleaned = []
            for tag in v:
                tag = tag.strip()
                if not tag:
                    continue
                if len(tag) > 50:
                    raise ValueError("Each tag must be 50 characters or less")
                cleaned.append(tag)
            return cleaned or None
        return v

    @model_validator(mode="after")
    def validate_dates(self) -> "CardUpdate":
        if self.close_date and self.open_date and self.close_date < self.open_date:
            raise ValueError("close_date cannot be before open_date")
        if self.spend_deadline and not self.spend_requirement:
            raise ValueError("spend_deadline requires spend_requirement")
        return self


class CloseCardRequest(BaseModel):
    close_date: date


class ProductChangeRequest(BaseModel):
    new_template_id: str | None = None
    new_card_name: str = Field(min_length=1, max_length=200)
    change_date: date
    new_annual_fee: int | None = Field(default=None, ge=0)
    new_network: str | None = Field(default=None, max_length=50)
    new_card_image: str | None = None
    sync_benefits: bool = False
    upgrade_bonus_amount: int | None = Field(default=None, gt=0, le=99_999_999)
    upgrade_bonus_type: str | None = None
    upgrade_spend_requirement: int | None = None
    upgrade_spend_deadline: date | None = None
    upgrade_spend_reminder_notes: str | None = None
    reset_af_anniversary: bool = True


class CardOut(BaseModel):
    id: int
    profile_id: int
    template_id: str | None
    template_version_id: str | None = None
    card_image: str | None = None
    card_name: str
    last_digits: str | None
    issuer: str
    network: str | None
    card_type: str
    status: str
    open_date: date | None
    close_date: date | None
    annual_fee: int | None
    annual_fee_date: date | None
    credit_limit: int | None
    custom_notes: str | None
    custom_tags: list[str] | None
    spend_reminder_enabled: bool
    spend_requirement: int | None
    spend_deadline: date | None
    spend_reminder_notes: str | None
    signup_bonus_amount: int | None
    signup_bonus_type: str | None
    signup_bonus_earned: bool
    created_at: datetime
    updated_at: datetime
    events: list[CardEventOut] = []
    bonuses: list[CardBonusOut] = []

    model_config = {"from_attributes": True}
