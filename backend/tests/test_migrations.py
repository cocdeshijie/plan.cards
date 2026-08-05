"""Migration tests.

These run Alembic against throwaway SQLite files in a **subprocess**, because
`alembic/env.py` imports the application engine at module scope — the DB URL has
to be set in the environment before `app.database` is ever imported. Running the
real startup path (rather than `Base.metadata.create_all`) is the whole point:
it is the only code path that touches real user data, and two migration
crash-loops have already shipped from it.
"""
import os
import sqlite3
import subprocess
import sys
import textwrap

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Revision immediately before the ON DELETE CASCADE batch rebuild.
PRE_CASCADE_REVISION = "0fe120ef4019"


def _alembic_config() -> Config:
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    return cfg


def _run(*blocks: str, db_path: str) -> str:
    """Run the given code blocks in a subprocess with DATABASE_URL pointed at
    db_path. Each block is dedented independently so they compose cleanly."""
    code = "\n".join(textwrap.dedent(b).strip("\n") for b in blocks)
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{db_path}",
        "RATE_LIMIT_ENABLED": "false",
        "CARD_TEMPLATES_DIR": os.path.join(os.path.dirname(BACKEND_DIR), "card_templates"),
    }
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.fail(
            f"subprocess failed (exit {result.returncode}):\n"
            f"--- code ---\n{code}\n"
            f"--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}"
        )
    return result.stdout.strip()


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "cards.db")


# Reusable code blocks for the subprocess.

MIGRATE = """
from app.main import _run_alembic_migrations
_run_alembic_migrations()
"""

CONNECT = """
from app.database import SessionLocal
from sqlalchemy import text
db = SessionLocal()
"""

# created_at / status / role are Python-side defaults, so raw SQL must supply them.
SEED = """
db.execute(text(
    "INSERT INTO users (username, role, is_active, created_at) "
    "VALUES ('u1', 'admin', 1, '2024-01-01 00:00:00')"
))
db.execute(text(
    "INSERT INTO profiles (user_id, name, created_at) "
    "VALUES (1, 'Primary', '2024-01-01 00:00:00')"
))
db.execute(text(
    "INSERT INTO cards (profile_id, card_name, issuer, card_type, status, open_date, "
    "annual_fee_user_modified, spend_reminder_enabled, signup_bonus_earned, created_at, updated_at) "
    "VALUES (1, 'Test Card', 'Chase', 'personal', 'active', '2024-01-01', "
    "0, 0, 0, '2024-01-01 00:00:00', '2024-01-01 00:00:00')"
))
db.execute(text(
    "INSERT INTO card_events (card_id, event_type, event_date, created_at) "
    "VALUES (1, 'opened', '2024-01-01', '2024-01-01 00:00:00')"
))
db.commit()
"""


# ── Chain integrity ────────────────────────────────────────────────────────


def test_single_head():
    """A branched chain silently skips migrations on upgrade."""
    heads = ScriptDirectory.from_config(_alembic_config()).get_heads()
    assert len(heads) == 1, f"expected exactly one head, got {heads}"


def test_revision_chain_is_linear():
    script = ScriptDirectory.from_config(_alembic_config())
    down_revisions = [r.down_revision for r in script.walk_revisions()]
    assert len(down_revisions) == len(set(down_revisions)), (
        "two migrations share a down_revision — the chain has branched"
    )


# ── Fresh install ──────────────────────────────────────────────────────────


def test_fresh_upgrade_leaves_foreign_keys_enabled(db_path):
    """Regression: the cascade migration runs `PRAGMA foreign_keys=OFF` on the
    app's own pooled connection. If it is not restored, that connection goes
    back into the pool with enforcement disabled and the `connect` listener
    never fires again — so ON DELETE CASCADE is a silent no-op for the whole
    process, on precisely the boot that applies the migration.
    """
    out = _run(
        MIGRATE,
        CONNECT,
        """
        print("foreign_keys=%s" % db.execute(text("PRAGMA foreign_keys")).scalar())
        try:
            db.execute(text(
                "INSERT INTO card_events (card_id, event_type, event_date) "
                "VALUES (999999, 'opened', '2026-01-01')"
            ))
            db.commit()
            print("orphan_rejected=False")
        except Exception:
            db.rollback()
            print("orphan_rejected=True")
        """,
        db_path=db_path,
    )
    assert "foreign_keys=1" in out, f"FK enforcement off after migrate:\n{out}"
    assert "orphan_rejected=True" in out, f"orphan FK row accepted:\n{out}"


def test_no_model_drift(db_path):
    """An alembic-migrated DB must match the models exactly, or a fresh
    container and an upgraded one end up with different schemas."""
    out = _run(
        MIGRATE,
        """
        from alembic.autogenerate import compare_metadata
        from alembic.migration import MigrationContext
        from app.database import Base, engine
        import app.models  # noqa: F401

        with engine.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
        print("DIFF:", diff)
        """,
        db_path=db_path,
    )
    assert "DIFF: []" in out, f"models and migrations have drifted:\n{out}"


# ── Populated database ─────────────────────────────────────────────────────


def test_cascade_migration_preserves_data(db_path):
    """Upgrading a populated DB through the batch table-rebuild must not lose rows."""
    out = _run(
        f"""
        from alembic import command
        from app.main import _get_alembic_config
        cfg = _get_alembic_config()
        command.upgrade(cfg, "{PRE_CASCADE_REVISION}")
        """,
        CONNECT,
        SEED,
        """
        command.upgrade(cfg, "head")
        for table in ("users", "profiles", "cards", "card_events"):
            n = db.execute(text("SELECT COUNT(*) FROM " + table)).scalar()
            print("%s=%s" % (table, n))
        print("card=", db.execute(text("SELECT card_name, issuer FROM cards")).first())
        """,
        db_path=db_path,
    )
    for table in ("users", "profiles", "cards", "card_events"):
        assert f"{table}=1" in out, f"{table} lost rows through the migration:\n{out}"
    assert "Test Card" in out and "Chase" in out


def test_cascade_actually_deletes_children(db_path):
    """The migration exists to make ON DELETE CASCADE real at the DB level."""
    out = _run(
        MIGRATE,
        CONNECT,
        SEED,
        """
        db.execute(text("DELETE FROM profiles WHERE id = 1"))
        db.commit()
        print("cards=%s" % db.execute(text("SELECT COUNT(*) FROM cards")).scalar())
        print("events=%s" % db.execute(text("SELECT COUNT(*) FROM card_events")).scalar())
        """,
        db_path=db_path,
    )
    assert "cards=0" in out, f"cascade did not delete cards:\n{out}"
    assert "events=0" in out, f"cascade did not delete card_events:\n{out}"


def test_leftover_alembic_tmp_does_not_destroy_data(db_path):
    """Regression: if the container died between `DROP TABLE profiles` and the
    rename, `_alembic_tmp_profiles` holds the ONLY copy of the rows. Dropping it
    unconditionally deletes user data *and* still leaves the migration failing,
    so `restart: unless-stopped` crash-loops over an already-empty database.
    """
    _run(
        f"""
        from alembic import command
        from app.main import _get_alembic_config
        command.upgrade(_get_alembic_config(), "{PRE_CASCADE_REVISION}")
        """,
        CONNECT,
        SEED,
        db_path=db_path,
    )

    # Simulate a crash mid batch-rebuild of `profiles`: batch mode creates the
    # temp table with the FULL DDL (constraints included), copies rows, drops the
    # original, then renames. Reproduce that faithfully and die before the rename.
    conn = sqlite3.connect(db_path)
    ddl = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='profiles'"
    ).fetchone()[0]
    tmp_ddl = ddl.replace("profiles", "_alembic_tmp_profiles", 1)
    conn.execute("PRAGMA foreign_keys=OFF")
    conn.execute(tmp_ddl)
    conn.execute("INSERT INTO _alembic_tmp_profiles SELECT * FROM profiles")
    conn.execute("DROP TABLE profiles")
    conn.commit()
    conn.close()

    out = _run(
        MIGRATE,
        CONNECT,
        """
        print("profiles=%s" % db.execute(text("SELECT COUNT(*) FROM profiles")).scalar())
        print("name=%s" % db.execute(text("SELECT name FROM profiles")).scalar())
        """,
        db_path=db_path,
    )
    assert "profiles=1" in out, f"profile rows destroyed by tmp-table cleanup:\n{out}"
    assert "name=Primary" in out


# ── Pre-Alembic (legacy) databases ─────────────────────────────────────────


def test_legacy_last_four_rename(db_path):
    """Regression: `_run_legacy_migrations` snapshots the column set once, then
    adds `last_digits` AND re-tests that stale snapshot for the rename — so it
    renames onto a column that now exists, SQLite raises `duplicate column
    name`, and the app can never start again.
    """
    # Build the schema as of the initial release, then strip Alembic's marker —
    # that is exactly what a pre-Alembic database looks like on first upgrade.
    _run(
        """
        from alembic import command
        from app.main import _get_alembic_config
        command.upgrade(_get_alembic_config(), "8abde7989620")
        """,
        db_path=db_path,
    )

    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        ALTER TABLE cards RENAME COLUMN last_digits TO last_four;
        DROP TABLE alembic_version;
        """
    )
    conn.execute(
        "INSERT INTO users (username, role, is_active, created_at) "
        "VALUES ('u1', 'admin', 1, '2024-01-01 00:00:00')"
    )
    conn.execute(
        "INSERT INTO profiles (user_id, name, created_at) "
        "VALUES (1, 'Primary', '2024-01-01 00:00:00')"
    )
    conn.execute(
        "INSERT INTO cards (profile_id, card_name, issuer, card_type, status, last_four, "
        "annual_fee_user_modified, spend_reminder_enabled, signup_bonus_earned, created_at, updated_at) "
        "VALUES (1, 'Legacy Card', 'Amex', 'personal', 'active', '1234', "
        "0, 0, 0, '2024-01-01 00:00:00', '2024-01-01 00:00:00')"
    )
    conn.commit()
    conn.close()

    out = _run(
        MIGRATE,
        CONNECT,
        """
        print("last_digits=%s" % db.execute(text("SELECT last_digits FROM cards")).scalar())
        """,
        db_path=db_path,
    )
    assert "last_digits=1234" in out, f"legacy last_four data was not migrated:\n{out}"


def test_newer_database_reports_actionable_error(db_path):
    """Rolling the image back with a newer DB must fail with an explanation,
    not an opaque `Can't locate revision` crash-loop."""
    _run(MIGRATE, db_path=db_path)

    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE alembic_version SET version_num = 'ffffffffffff'")
    conn.commit()
    conn.close()

    out = _run(
        """
        import logging
        logging.basicConfig(level=logging.ERROR)
        from app.main import _run_alembic_migrations
        try:
            _run_alembic_migrations()
            print("RESULT: no error raised")
        except Exception as e:
            print("RESULT:", type(e).__name__, e)
        """,
        db_path=db_path,
    )
    assert "newer version" in out.lower(), (
        "expected an actionable 'database was created by a newer version' message, got:\n" + out
    )


def test_migrations_do_not_silence_application_logging(db_path):
    """Regression: alembic's env.py called `fileConfig(...)` without
    `disable_existing_loggers=False`, whose default is True. Migrations run
    inside application startup, so every already-created `app.*` logger was
    switched OFF for the life of the process — silencing template load errors,
    OAuth failures, and the open-mode bootstrap token an operator has to read
    out of the container logs to use the app at all.
    """
    out = _run(
        """
        import logging
        logging.basicConfig(level=logging.INFO)
        probe = logging.getLogger("app.services.bootstrap_token")
        assert not probe.disabled, "probe logger already disabled before migrating"
        """,
        MIGRATE,
        """
        print("disabled_after_migrate=%s" % probe.disabled)
        """,
        db_path=db_path,
    )
    assert "disabled_after_migrate=False" in out, (
        "application loggers were disabled by the migration run:\n" + out
    )
