from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OAuthProvider(Base):
    __tablename__ = "oauth_providers"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_name: Mapped[str] = mapped_column(String(50), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    client_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    issuer_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    authorization_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    token_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    userinfo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    scopes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
