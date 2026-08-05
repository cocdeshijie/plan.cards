from logging.config import fileConfig

from sqlalchemy import create_engine, event, pool

from alembic import context

from app.config import settings
from app.database import Base

# Import all models so Base.metadata is populated
import app.models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # Required for SQLite ALTER TABLE
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode on a dedicated, disposable engine.

    Deliberately NOT the application engine. Migrations mutate connection-level
    state — the SQLite batch rebuilds need `PRAGMA foreign_keys=OFF` — and a
    connection borrowed from the app's pool carries that state back into the
    pool when the migration finishes. SQLAlchemy's "connect" listener only fires
    on a real DBAPI connect, never on pool checkout, so nothing would restore
    it: the app would then serve requests with foreign key enforcement silently
    disabled for the rest of the process. A throwaway engine keeps that blast
    radius inside the migration.
    """
    connectable = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False},
        poolclass=pool.NullPool,
    )

    # Set via a connect listener rather than on the live connection: issuing any
    # statement on the connection first would implicitly open a transaction, and
    # context.begin_transaction() would then become a no-op — which breaks the
    # autocommit_block() that the SQLite batch migrations rely on.
    @event.listens_for(connectable, "connect")
    def _set_busy_timeout(dbapi_connection, connection_record):
        if connectable.dialect.name != "sqlite":
            return
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    try:
        with connectable.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                render_as_batch=True,  # Required for SQLite ALTER TABLE
            )

            with context.begin_transaction():
                context.run_migrations()
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
