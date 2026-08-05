"""protect user edits and pinned versions from template sync

Three columns, all guarding against template sync destroying user data:

- card_benefits.template_key: stable identity for a template-sourced benefit.
  Sync previously matched on benefit_name, so a contributor renaming a credit
  upstream read as "removed + added" — the user's year-to-date usage was
  stranded on a retired row while a fresh row started at $0.

- card_benefits.user_modified: set when the user edits a from_template benefit,
  so sync leaves it alone. Card.annual_fee_user_modified already did this for
  the annual fee; benefits had no equivalent and were silently reverted on every
  version bump.

- cards.template_version_pinned: set when the user deliberately picks a
  non-current template version in the Add Card dialog. Sync treated any
  version mismatch as "behind" and force-upgraded the card on the next restart
  or 30s hot-reload tick, so the version picker had no lasting effect.

Revision ID: e7c1f45b9d28
Revises: d5e2a91c7b34
Create Date: 2026-08-05 00:00:00.000000

"""
from contextlib import contextmanager
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7c1f45b9d28'
down_revision: Union[str, None] = 'd5e2a91c7b34'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


@contextmanager
def _fk_enforcement_disabled():
    """Required around any batch rebuild of a PARENT table on SQLite.

    Alembic's batch mode emulates ALTER by rebuilding the table: CREATE tmp,
    INSERT..SELECT, **DROP TABLE original**, RENAME. Since c4d9e1a7b2f0 gave the
    child FKs real ON DELETE CASCADE, that DROP now cascades — rebuilding `cards`
    silently deletes every card_event, card_benefit, card_bonus and
    card_bonus_category belonging to it.

    PRAGMA foreign_keys is a no-op inside a transaction, hence autocommit_block.
    """
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        yield
        return
    with op.get_context().autocommit_block():
        op.execute("PRAGMA foreign_keys=OFF")
    try:
        yield
    finally:
        with op.get_context().autocommit_block():
            op.execute("PRAGMA foreign_keys=ON")


def upgrade() -> None:
    with op.batch_alter_table("card_benefits") as batch_op:
        batch_op.add_column(sa.Column("template_key", sa.String(length=100), nullable=True))
        batch_op.add_column(
            sa.Column("user_modified", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    op.create_index(
        "ix_card_benefits_template_key", "card_benefits", ["template_key"], unique=False
    )

    # `cards` is a parent table — see _fk_enforcement_disabled.
    with _fk_enforcement_disabled():
        with op.batch_alter_table("cards") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "template_version_pinned", sa.Boolean(), nullable=False,
                    server_default=sa.false(),
                )
            )

    # Existing cards on a non-current template version predate the pin flag.
    # Leave them unpinned: the historical behaviour was to upgrade them, and
    # silently pinning every stale card would freeze real template updates.


def downgrade() -> None:
    with _fk_enforcement_disabled():
        with op.batch_alter_table("cards") as batch_op:
            batch_op.drop_column("template_version_pinned")

    op.drop_index("ix_card_benefits_template_key", table_name="card_benefits")
    with op.batch_alter_table("card_benefits") as batch_op:
        batch_op.drop_column("user_modified")
        batch_op.drop_column("template_key")
