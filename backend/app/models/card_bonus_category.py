from datetime import datetime, timezone

from sqlalchemy import String, Integer, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CardBonusCategory(Base):
    __tablename__ = "card_bonus_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(200))
    multiplier: Mapped[str] = mapped_column(String(50))
    portal_only: Mapped[bool] = mapped_column(Boolean, default=False)
    cap: Mapped[int | None] = mapped_column(Integer, nullable=True)
    from_template: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set when the user edits a from_template category, so sync leaves it alone.
    # Mirrors CardBenefit.user_modified. Clearing from_template instead would
    # hide the row from sync's from_template query and make it re-add the
    # template's version as a SECOND row (there is no unique constraint here).
    user_modified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    card: Mapped["Card"] = relationship(back_populates="bonus_categories")  # noqa: F821
