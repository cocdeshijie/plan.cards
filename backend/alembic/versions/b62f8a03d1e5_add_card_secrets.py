"""add card_secrets table for the optional card vault

Stores full card number, security code, cardholder name and billing postcode
for cards the user chooses to record them against. All four are AES-256-GCM
ciphertext with AAD binding each value to (table, column, card_id); the key is
HKDF-derived from the existing /data/.encryption_key. See
app/services/card_vault_crypto.py.

A NEW CHILD TABLE, not columns on `cards`, and that is deliberate on two counts:

  * `CardOut` is a hand-written allowlist of fields. Keeping these values off the
    `Card` model means no future edit to that schema can accidentally serialize
    them into the card list.
  * Adding columns to `cards` would mean a batch_alter_table rebuild of a PARENT
    table. Since c4d9e1a7b2f0 gave the child FKs real ON DELETE CASCADE, that
    rebuild's DROP TABLE cascade-deletes every card_event, card_benefit,
    card_bonus and card_bonus_category — which is why e7c1f45b9d28 needed an
    FK-disable guard. A plain create_table on a leaf table needs no such guard,
    and nothing references card_secrets.

Expiry month and year stay plaintext: they are cardholder data rather than
sensitive authentication data, and they want to be queryable for expiry
reminders.

Revision ID: b62f8a03d1e5
Revises: a91d4e6f2c07
Create Date: 2026-08-06 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b62f8a03d1e5'
down_revision: Union[str, None] = 'a91d4e6f2c07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "card_secrets",
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("pan_encrypted", sa.LargeBinary(), nullable=False),
        sa.Column("cvv_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("holder_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("billing_zip_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("exp_month", sa.Integer(), nullable=False),
        sa.Column("exp_year", sa.Integer(), nullable=False),
        # Derived from the PAN at write time rather than read from `cards`,
        # so a card rename, a free-text network edit or a product change
        # cannot desync the masked display from the number actually stored.
        sa.Column("network", sa.String(length=20), nullable=True),
        sa.Column("last_digits", sa.String(length=5), nullable=False),
        sa.Column("pan_length", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        # NOT NULL to match the model, which fills both from Python defaults.
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("card_id"),
    )


def downgrade() -> None:
    op.drop_table("card_secrets")
