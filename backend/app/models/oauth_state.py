from sqlalchemy import String, Float
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OAuthState(Base):
    __tablename__ = "oauth_states"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[float] = mapped_column(Float)
