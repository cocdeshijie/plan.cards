"""add ON DELETE CASCADE to child foreign keys

Gives the database the same delete semantics the ORM relationships already use
(cascade="all, delete-orphan"), so deleting a user/profile/card cleans up its
children even via a bulk/Core delete that bypasses the ORM. The initial schema
created these FKs without an ondelete action.

Revision ID: c4d9e1a7b2f0
Revises: 0fe120ef4019
Create Date: 2026-06-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c4d9e1a7b2f0'
down_revision: Union[str, None] = '0fe120ef4019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (table, local_column, referred_table)
_CASCADE_FKS = [
    ("profiles", "user_id", "users"),
    ("cards", "profile_id", "profiles"),
    ("card_events", "card_id", "cards"),
    ("card_benefits", "card_id", "cards"),
    ("card_bonuses", "card_id", "cards"),
    ("card_bonus_categories", "card_id", "cards"),
    ("oauth_accounts", "user_id", "users"),
    ("user_settings", "user_id", "users"),
]

# Naming convention lets Alembic address the otherwise-unnamed SQLite FKs so they
# can be dropped and recreated inside batch mode.
_NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}


def _rebuild_fks(ondelete: str | None) -> None:
    for table, column, ref_table in _CASCADE_FKS:
        fk_name = f"fk_{table}_{column}_{ref_table}"
        with op.batch_alter_table(table, naming_convention=_NAMING) as batch_op:
            batch_op.drop_constraint(fk_name, type_="foreignkey")
            batch_op.create_foreign_key(
                fk_name, ref_table, [column], ["id"], ondelete=ondelete
            )


def upgrade() -> None:
    _rebuild_fks("CASCADE")


def downgrade() -> None:
    _rebuild_fks(None)
