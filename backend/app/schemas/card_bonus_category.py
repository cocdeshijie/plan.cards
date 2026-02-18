from datetime import datetime

from pydantic import BaseModel, Field


class CardBonusCategoryCreate(BaseModel):
    category: str = Field(min_length=1, max_length=200)
    multiplier: str = Field(min_length=1, max_length=50)
    portal_only: bool = False
    cap: int | None = Field(default=None, gt=0, le=99_999_999)


class CardBonusCategoryUpdate(BaseModel):
    category: str | None = Field(default=None, min_length=1, max_length=200)
    multiplier: str | None = Field(default=None, min_length=1, max_length=50)
    portal_only: bool | None = None
    cap: int | None = Field(default=None, gt=0, le=99_999_999)


class CardBonusCategoryOut(BaseModel):
    id: int
    card_id: int
    category: str
    multiplier: str
    portal_only: bool
    cap: int | None
    from_template: bool
    created_at: datetime

    model_config = {"from_attributes": True}
