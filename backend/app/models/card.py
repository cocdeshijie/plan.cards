from datetime import date, datetime, timezone

from sqlalchemy import String, Integer, Date, DateTime, ForeignKey, JSON, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id"), index=True)
    template_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    template_version_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    card_image: Mapped[str | None] = mapped_column(String(200), nullable=True)
    card_name: Mapped[str] = mapped_column(String(200))
    last_digits: Mapped[str | None] = mapped_column(String(5), nullable=True)
    issuer: Mapped[str] = mapped_column(String(100))
    network: Mapped[str | None] = mapped_column(String(50), nullable=True)
    card_type: Mapped[str] = mapped_column(String(20), default="personal")  # personal | business
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # active | closed
    open_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    close_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    annual_fee: Mapped[int | None] = mapped_column(Integer, nullable=True)
    annual_fee_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    annual_fee_user_modified: Mapped[bool] = mapped_column(Boolean, default=False)
    credit_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    custom_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    custom_tags: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Spend reminder fields
    spend_reminder_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    spend_requirement: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spend_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    spend_reminder_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Signup bonus fields
    signup_bonus_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    signup_bonus_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    signup_bonus_earned: Mapped[bool] = mapped_column(Boolean, default=False)

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    profile: Mapped["Profile"] = relationship(back_populates="cards")  # noqa: F821
    events: Mapped[list["CardEvent"]] = relationship(back_populates="card", cascade="all, delete-orphan")  # noqa: F821
    benefits: Mapped[list["CardBenefit"]] = relationship(back_populates="card", cascade="all, delete-orphan")  # noqa: F821
    bonuses: Mapped[list["CardBonus"]] = relationship(back_populates="card", cascade="all, delete-orphan")  # noqa: F821
    bonus_categories: Mapped[list["CardBonusCategory"]] = relationship(back_populates="card", cascade="all, delete-orphan")  # noqa: F821
