from datetime import date, datetime, timezone

from sqlalchemy import String, Date, DateTime, ForeignKey, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CardEvent(Base):
    __tablename__ = "card_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(50))  # opened | closed | product_change | annual_fee_posted | annual_fee_refund | retention_offer | reopened | other
    event_date: Mapped[date] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    card: Mapped["Card"] = relationship(back_populates="events")  # noqa: F821
