from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ExportEvent(BaseModel):
    original_id: int | None = None
    event_type: Literal["opened", "closed", "product_change", "annual_fee_posted", "annual_fee_refund", "retention_offer", "reopened", "other"]
    event_date: date
    description: str | None = None
    metadata_json: dict | None = None


class ExportBenefit(BaseModel):
    benefit_name: str
    benefit_amount: int = Field(le=99_999_999)
    frequency: Literal["monthly", "quarterly", "semi_annual", "annual"]
    reset_type: Literal["calendar", "cardiversary"] = "calendar"
    from_template: bool = False
    retired: bool = False
    notes: str | None = None
    amount_used: int = 0
    benefit_type: Literal["credit", "spend_threshold"] = "credit"
    period_start: date | None = None


class ExportBonus(BaseModel):
    bonus_source: Literal["signup", "upgrade", "retention"] = "upgrade"
    event_id: int | None = None
    bonus_amount: int | None = Field(default=None, gt=0, le=99_999_999)
    bonus_credit_amount: int | None = Field(default=None, gt=0, le=99_999_999)
    bonus_type: str | None = None
    bonus_earned: bool = False
    bonus_missed: bool = False
    spend_requirement: int | None = Field(default=None, gt=0, le=99_999_999)
    spend_deadline: date | None = None
    spend_reminder_enabled: bool = False
    spend_reminder_notes: str | None = None
    description: str | None = None


class ExportBonusCategory(BaseModel):
    category: str = Field(max_length=200)
    multiplier: str = Field(max_length=50)
    portal_only: bool = False
    cap: int | None = Field(default=None, gt=0, le=99_999_999)
    from_template: bool = False


class ExportCard(BaseModel):
    template_id: str | None = None
    template_version_id: str | None = None
    card_image: str | None = None
    card_name: str = Field(max_length=200)
    last_digits: str | None = None
    issuer: str = Field(max_length=100)
    network: str | None = Field(default=None, max_length=50)
    card_type: Literal["personal", "business"] = "personal"
    status: Literal["active", "closed"] = "active"
    open_date: date | None = None
    close_date: date | None = None
    annual_fee: int | None = None
    annual_fee_date: date | None = None
    credit_limit: int | None = None
    custom_notes: str | None = Field(default=None, max_length=5000)
    custom_tags: list[str] | None = None
    spend_reminder_enabled: bool = False
    spend_requirement: int | None = None
    spend_deadline: date | None = None
    spend_reminder_notes: str | None = Field(default=None, max_length=1000)
    signup_bonus_amount: int | None = None
    signup_bonus_type: str | None = None
    signup_bonus_earned: bool = False
    events: list[ExportEvent] = []
    benefits: list[ExportBenefit] = []
    bonuses: list[ExportBonus] = []
    bonus_categories: list[ExportBonusCategory] = []


class ExportProfile(BaseModel):
    name: str
    cards: list[ExportCard] = Field(default=[], max_length=5000)


class ExportData(BaseModel):
    version: int = 1
    exported_at: datetime
    profiles: list[ExportProfile] = Field(default=[], max_length=100)
    settings: dict[str, str] | None = None

    @field_validator("version")
    @classmethod
    def check_version(cls, v: int) -> int:
        if v != 1:
            raise ValueError(f"Unsupported export version {v}; this app supports version 1")
        return v


class ImportResult(BaseModel):
    profiles_imported: int = 0
    cards_imported: int = 0
    events_imported: int = 0
    benefits_imported: int = 0
    bonuses_imported: int = 0
    bonus_categories_imported: int = 0
    cards_skipped: int = 0
