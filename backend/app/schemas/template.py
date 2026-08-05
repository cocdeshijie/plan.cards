from typing import Literal

from pydantic import BaseModel

# Closed sets, matching BenefitFrequency / BenefitResetType on the card schemas.
# These were previously bare `str`, which let a community template ship
# `frequency: yearly` — a value the period engine, the CardBenefit update schema
# and the dashboard widget all reject. It loaded fine and then broke export with
# a 500, so the enum is enforced here at the boundary where templates enter.
TemplateFrequency = Literal["monthly", "quarterly", "semi_annual", "annual"]
TemplateResetType = Literal["calendar", "cardiversary"]


class TemplateCreditOut(BaseModel):
    name: str
    amount: int
    frequency: TemplateFrequency
    reset_type: TemplateResetType = "calendar"


class TemplateBonusCategoryOut(BaseModel):
    category: str
    multiplier: str
    portal_only: bool = False
    cap: int | None = None


class TemplateSpendThresholdOut(BaseModel):
    name: str
    spend_required: int
    frequency: TemplateFrequency
    reset_type: TemplateResetType = "cardiversary"
    description: str | None = None


class TemplateBenefitsOut(BaseModel):
    credits: list[TemplateCreditOut] = []
    bonus_categories: list[TemplateBonusCategoryOut] = []
    spend_thresholds: list[TemplateSpendThresholdOut] = []


class CardTemplateOut(BaseModel):
    id: str  # e.g. "chase/sapphire_preferred"
    name: str
    issuer: str
    network: str | None = None
    annual_fee: int | None = None
    currency: str | None = None
    benefits: TemplateBenefitsOut | None = None
    notes: str | None = None
    tags: list[str] | None = None
    has_image: bool = False
    version_id: str | None = None
    images: list[str] = []


class TemplateVersionSummary(BaseModel):
    version_id: str
    name: str
    annual_fee: int | None = None
    is_current: bool = False


class TemplateVersionDetail(BaseModel):
    version_id: str
    name: str
    issuer: str
    network: str | None = None
    annual_fee: int | None = None
    currency: str | None = None
    benefits: TemplateBenefitsOut | None = None
    notes: str | None = None
    tags: list[str] | None = None
    has_image: bool = False
    is_current: bool = False
