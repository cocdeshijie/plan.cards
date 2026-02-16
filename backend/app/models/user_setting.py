from sqlalchemy import String, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserSetting(Base):
    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    key: Mapped[str] = mapped_column(String(100))
    value: Mapped[str] = mapped_column(Text)

    user: Mapped["User"] = relationship(back_populates="user_settings")  # noqa: F821

    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_user_setting"),
    )
