from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CardSecret(Base):
    """Optional stored card details, one row per card.

    A separate child table rather than columns on `cards`, for two concrete
    reasons:

    1. `CardOut` is a hand-written allowlist -- it enumerates the fields it
       returns, and that is the only thing standing between the card record and
       over-serialization. Keeping secrets out of the `Card` model means no
       future edit to `CardOut` can accidentally expose them.
    2. Adding columns to `cards` means a SQLite batch rebuild of a PARENT table.
       Since the child FKs gained real ON DELETE CASCADE, that rebuild
       cascade-deletes every event, benefit, bonus and bonus category unless
       wrapped in an FK-disable guard. A new child table needs a plain
       create_table and no guard at all.

    Expiry stays plaintext. It is cardholder data rather than sensitive
    authentication data, and it wants to be queryable for expiry reminders.
    """

    __tablename__ = "card_secrets"

    card_id: Mapped[int] = mapped_column(
        ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True
    )

    # AES-256-GCM, AAD-bound to (table, column, card_id). See
    # services/card_vault_crypto.py.
    pan_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    cvv_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    holder_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    billing_zip_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    exp_month: Mapped[int] = mapped_column(Integer, nullable=False)
    exp_year: Mapped[int] = mapped_column(Integer, nullable=False)

    # Derived from the PAN at write time, NOT read from Card.
    #
    # Card.network is an unconstrained String(50) that the user edits from a
    # free-text box ("e.g. Visa, Mastercard") and that a product change
    # rewrites. Deriving the mask, grouping, trailing-digit count and security
    # code label from it meant any of those edits could make the vault lie:
    # an Amex whose card was relabelled Visa rendered as
    # "•••• •••• •••• 10005" — 4-4-4-4 grouping over a five-digit tail — and
    # reported CVV2 for a stored 4-digit CID. Storing what the number actually
    # is makes the display immune to anything that happens to the card record.
    network: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_digits: Mapped[str] = mapped_column(String(5), nullable=False)
    # So the mask can be sized to the real number. A fixed 16-position mask
    # invented digits a 15-digit Amex doesn't have and hid ones a 19-digit Visa
    # does. Not sensitive: the length is already implied by the network.
    pan_length: Mapped[int] = mapped_column(Integer, nullable=False)

    # Ciphertext format version, so a later re-encryption pass can tell old rows
    # from new ones without guessing.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    card: Mapped["Card"] = relationship(back_populates="secret")  # noqa: F821
