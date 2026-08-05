"""add user_modified to card_bonus_categories

Mirrors card_benefits.user_modified. Editing a template-sourced bonus category
had to mark it somehow so sync stops overwriting it; clearing `from_template`
seemed natural but is wrong — sync's reconciliation query filters on
`from_template == True`, so a cleared row becomes invisible and sync re-adds the
template's version as a SECOND row (there is no unique constraint on
card_bonus_categories). Keeping from_template True and flagging user_modified
lets sync see the row and skip it.

Revision ID: a91d4e6f2c07
Revises: f3b8c02d6a51
Create Date: 2026-08-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a91d4e6f2c07'
down_revision: Union[str, None] = 'f3b8c02d6a51'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # card_bonus_categories is a leaf table (nothing references it), so the
    # batch rebuild cannot cascade-delete children the way a parent-table
    # rebuild would. No FK-disable guard needed here.
    with op.batch_alter_table("card_bonus_categories") as batch_op:
        batch_op.add_column(
            sa.Column("user_modified", sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    with op.batch_alter_table("card_bonus_categories") as batch_op:
        batch_op.drop_column("user_modified")
