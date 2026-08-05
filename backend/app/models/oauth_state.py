from sqlalchemy import String, Float
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OAuthState(Base):
    __tablename__ = "oauth_states"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[float] = mapped_column(Float)
    # SHA-256 of a nonce held in an HttpOnly cookie by the browser that started
    # the flow. `state` alone defends against nothing here: /authorize is
    # unauthenticated in OAuth mode, so anyone can mint a valid state, complete
    # the provider flow with their OWN account, and hand the resulting
    # ?code=&state= URL to a victim — whose browser then gets signed into the
    # attacker's account (login CSRF), or, if the victim had a link flow
    # pending, permanently binds the attacker's identity to the victim's
    # account. Binding to a cookie ties a state to one user agent.
    browser_nonce_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Recorded so a state minted for one provider/flow can't be replayed at
    # another endpoint.
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
