from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

BenefitFrequency = Literal["monthly", "quarterly", "semi_annual", "annual"]
BenefitResetType = Literal["calendar", "cardiversary"]
BenefitType = Literal["credit", "spend_threshold"]


class CardBenefitCreate(BaseModel):
    benefit_name: str = Field(min_length=1, max_length=100)
    benefit_amount: int = Field(gt=0, le=99_999_999)
    frequency: BenefitFrequency
    reset_type: BenefitResetType = "calendar"
    benefit_type: BenefitType = "credit"
    notes: str | None = Field(default=None, max_length=1000)


class CardBenefitUpdate(BaseModel):
    benefit_name: str | None = Field(default=None, min_length=1, max_length=100)
    benefit_amount: int | None = Field(default=None, gt=0, le=99_999_999)
    frequency: BenefitFrequency | None = None
    reset_type: BenefitResetType | None = None
    benefit_type: BenefitType | None = None
    notes: str | None = Field(default=None, max_length=1000)


class BenefitUsageUpdate(BaseModel):
    amount_used: int = Field(ge=0, le=99_999_999)


class CardBenefitOut(BaseModel):
    id: int
    card_id: int
    benefit_name: str
    benefit_amount: int
    frequency: str
    reset_type: str
    benefit_type: str = "credit"
    from_template: bool = False
    retired: bool = False
    notes: str | None = None
    amount_used: int
    period_start: date | None
    period_end: date | None = None
    days_until_reset: int | None = None
    reset_label: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class BenefitSummaryItem(CardBenefitOut):
    """Benefit with card/profile context for the dashboard summary."""
    card_name: str
    issuer: str
    last_digits: str | None = None
    template_id: str | None = None
    card_image: str | None = None
    profile_id: int
    profile_name: str
