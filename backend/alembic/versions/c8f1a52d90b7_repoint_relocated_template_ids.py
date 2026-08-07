"""Repoint template_id for templates that moved between issuer directories

Revision ID: c8f1a52d90b7
Revises: b62f8a03d1e5
Create Date: 2026-08-06

The BJ's card program moved from Comenity to Capital One in February 2023, so
its templates moved from card_templates/comenity/ to card_templates/capitalone/.
A template's id is derived from its PATH ("<issuer>/<slug>"), and cards store
that string in cards.template_id — so moving the directory silently orphans
every card pointing at the old id: the template stops resolving, and the card
loses its name, image, version history and benefit sync.

Renaming a template directory is therefore a DATA migration, not a file move.
Any future relocation needs an entry here too.

Deliberately narrow: only rows whose template_id exactly matches an old id are
touched, so this is a no-op on databases that never had a BJ's card.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c8f1a52d90b7'
down_revision: Union[str, None] = 'b62f8a03d1e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# old template_id -> new template_id
RELOCATIONS = {
    "comenity/bjs_mastercard": "capitalone/bjs_mastercard",
    "comenity/bjs_store": "capitalone/bjs_store",
}


def _repoint(mapping: dict[str, str]) -> None:
    conn = op.get_bind()
    for old, new in mapping.items():
        conn.execute(
            sa.text("UPDATE cards SET template_id = :new WHERE template_id = :old"),
            {"new": new, "old": old},
        )


def upgrade() -> None:
    _repoint(RELOCATIONS)


def downgrade() -> None:
    _repoint({new: old for old, new in RELOCATIONS.items()})
