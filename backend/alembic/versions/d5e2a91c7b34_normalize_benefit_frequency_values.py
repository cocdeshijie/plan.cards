"""normalize invalid card_benefits.frequency values

`TemplateCreditOut.frequency` used to be an unvalidated `str`, so community
templates shipping `frequency: yearly` (27 credits across 8 files) were written
verbatim into `card_benefits.frequency`. That value is rejected by
`BenefitFrequency` on the update schema, by the export schema (profile export
500s), and by the dashboard's frequency ordering (those credits render nowhere).

The templates are fixed, but rows already written to users' databases are not,
and template sync only rewrites a card when the template's version_id changes.
Normalize them here.

`annual` is the correct target: the period engine's fallbacks
(`_calendar_period`'s else branch and `_FREQUENCY_DELTA.get(..., years=1)`)
already treated these as annual, so no period boundary moves.

Revision ID: d5e2a91c7b34
Revises: c4d9e1a7b2f0
Create Date: 2026-08-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5e2a91c7b34'
down_revision: Union[str, None] = 'c4d9e1a7b2f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


VALID_FREQUENCIES = ("monthly", "quarterly", "semi_annual", "annual")
VALID_RESET_TYPES = ("calendar", "cardiversary")


def upgrade() -> None:
    bind = op.get_bind()

    # Any out-of-enum frequency behaved as annual, so annual is a lossless target.
    result = bind.execute(
        sa.text(
            "UPDATE card_benefits SET frequency = 'annual' "
            "WHERE frequency NOT IN :valid"
        ).bindparams(sa.bindparam("valid", VALID_FREQUENCIES, expanding=True))
    )
    if result.rowcount:
        print(f"Normalized {result.rowcount} card_benefits.frequency value(s) to 'annual'")

    result = bind.execute(
        sa.text(
            "UPDATE card_benefits SET reset_type = 'calendar' "
            "WHERE reset_type NOT IN :valid"
        ).bindparams(sa.bindparam("valid", VALID_RESET_TYPES, expanding=True))
    )
    if result.rowcount:
        print(f"Normalized {result.rowcount} card_benefits.reset_type value(s) to 'calendar'")


def downgrade() -> None:
    # The original values were invalid; there is nothing meaningful to restore.
    pass
