from datetime import date
from typing import Literal

from pydantic import BaseModel

# Availability of the underlying product, so a card that no longer exists stops
# being offered for NEW cards without becoming untrackable for the people who
# still hold one. Before this, the only place to record "this program is dead"
# was free-text `notes:`, which nothing could act on — a Pier 1 card whose
# accounts were force-closed in 2020 still read as openly available six years
# later.
#
#   active                    — offered to new applicants
#   closed_to_new_applicants  — existing cardholders unaffected, no new approvals
#   discontinued              — the program itself has ended
#
# Deliberately NOT a reason to drop the template: existing cards reference it by
# template_id and need it to resolve for their name, image and benefit history.
TemplateStatus = Literal["active", "closed_to_new_applicants", "discontinued"]

# Closed sets, matching BenefitFrequency / BenefitResetType on the card schemas.
# These were previously bare `str`, which let a community template ship
# `frequency: yearly` — a value the period engine, the CardBenefit update schema
# and the dashboard widget all reject. It loaded fine and then broke export with
# a 500, so the enum is enforced here at the boundary where templates enter.
TemplateFrequency = Literal["monthly", "quarterly", "semi_annual", "annual"]
TemplateResetType = Literal["calendar", "cardiversary"]


class TemplateCreditOut(BaseModel):
    # Optional stable identifier. When present, template sync matches user
    # benefits on this instead of the display name, so renaming a credit
    # upstream preserves every user's tracked usage.
    key: str | None = None
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
    key: str | None = None
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
    status: TemplateStatus = "active"
    # When the status took effect. Omitted where a program's end date is known
    # only vaguely — an absent date means "we know it changed, not when".
    status_date: date | None = None


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
