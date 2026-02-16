from datetime import date, datetime, timezone

from sqlalchemy import String, Integer, Date, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CardBonus(Base):
    __tablename__ = "card_bonuses"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"), index=True)
    bonus_source: Mapped[str] = mapped_column(String(20))  # "upgrade" | "retention"
    event_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("card_events.id", ondelete="SET NULL"), nullable=True
    )
    bonus_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bonus_credit_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bonus_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bonus_earned: Mapped[bool] = mapped_column(Boolean, default=False)
    bonus_missed: Mapped[bool] = mapped_column(Boolean, default=False)
    spend_requirement: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spend_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    spend_reminder_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    spend_reminder_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    card: Mapped["Card"] = relationship(back_populates="bonuses")  # noqa: F821
