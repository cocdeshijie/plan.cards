from datetime import date, datetime, timezone

from sqlalchemy import String, Text, Integer, Date, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CardBenefit(Base):
    __tablename__ = "card_benefits"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"), index=True)
    benefit_name: Mapped[str] = mapped_column(String(200))
    benefit_amount: Mapped[int] = mapped_column(Integer)
    frequency: Mapped[str] = mapped_column(String(20))  # monthly|quarterly|semi_annual|annual
    reset_type: Mapped[str] = mapped_column(String(20), default="calendar")  # calendar|cardiversary
    from_template: Mapped[bool] = mapped_column(Boolean, default=False)
    retired: Mapped[bool] = mapped_column(Boolean, default=False)
    amount_used: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    benefit_type: Mapped[str] = mapped_column(String(20), default="credit")  # credit | spend_threshold
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    card: Mapped["Card"] = relationship(back_populates="benefits")  # noqa: F821
