from pydantic import BaseModel


class TemplateCreditOut(BaseModel):
    name: str
    amount: int
    frequency: str  # monthly|quarterly|semi_annual|annual
    reset_type: str = "calendar"


class TemplateBonusCategoryOut(BaseModel):
    category: str
    multiplier: str
    portal_only: bool = False
    cap: int | None = None


class TemplateSpendThresholdOut(BaseModel):
    name: str
    spend_required: int
    frequency: str  # monthly|quarterly|semi_annual|annual
    reset_type: str = "cardiversary"
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
