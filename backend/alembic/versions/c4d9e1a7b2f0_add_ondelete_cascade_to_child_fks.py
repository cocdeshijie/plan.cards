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


def _table_exists(bind, name: str) -> bool:
    return bool(
        bind.exec_driver_sql(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).first()
    )


def _prepare_sqlite() -> None:
    """Make this migration safe to (re)run on a populated SQLite DB.

    1. Batch table-rebuilds drop a parent table while children still reference it;
       with PRAGMA foreign_keys=ON the DROP fails. Disable enforcement for this
       connection. PRAGMA foreign_keys is a no-op inside a transaction, so it
       runs in an autocommit block. `_restore_sqlite()` turns it back on.
    2. An earlier failed run can leave `_alembic_tmp_*` tables behind (SQLite DDL
       here is non-transactional), which makes the next run fail with "table
       already exists".

       Recovering these correctly matters: batch mode goes CREATE _alembic_tmp_x
       -> INSERT..SELECT -> DROP TABLE x -> RENAME. If the process died between
       the DROP and the RENAME, the temp table holds the ONLY copy of the rows.
       So drop a leftover only when the real table is still there; otherwise
       rename it back into place.
    """
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        return
    with op.get_context().autocommit_block():
        op.execute("PRAGMA foreign_keys=OFF")
        for table, _column, _ref_table in _CASCADE_FKS:
            tmp = f"_alembic_tmp_{table}"
            if not _table_exists(bind, tmp):
                continue
            if _table_exists(bind, table):
                # Real table survived — the temp copy is redundant.
                op.execute(f"DROP TABLE {tmp}")
            else:
                # Crash between DROP and RENAME: the temp table is the only copy.
                op.execute(f"ALTER TABLE {tmp} RENAME TO {table}")


def _restore_sqlite() -> None:
    """Re-enable FK enforcement disabled by _prepare_sqlite."""
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        return
    with op.get_context().autocommit_block():
        op.execute("PRAGMA foreign_keys=ON")


def _rebuild_fks(ondelete: str | None) -> None:
    for table, column, ref_table in _CASCADE_FKS:
        fk_name = f"fk_{table}_{column}_{ref_table}"
        with op.batch_alter_table(table, naming_convention=_NAMING) as batch_op:
            batch_op.drop_constraint(fk_name, type_="foreignkey")
            batch_op.create_foreign_key(
                fk_name, ref_table, [column], ["id"], ondelete=ondelete
            )


def upgrade() -> None:
    _prepare_sqlite()
    try:
        _rebuild_fks("CASCADE")
    finally:
        _restore_sqlite()


def downgrade() -> None:
    _prepare_sqlite()
    try:
        _rebuild_fks(None)
    finally:
        _restore_sqlite()
