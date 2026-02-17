import asyncio
import logging
import os
import pathlib
import secrets
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import inspect, text

from app.config import settings
from app.rate_limit import limiter
from app.database import Base, engine, SessionLocal
from app.routers import auth, profiles, cards, events, templates, benefits, bonuses, settings as settings_router, setup, users, admin, oauth
from app.services.template_loader import load_templates, reload_if_changed
from app.services.template_sync import sync_cards_to_templates

logger = logging.getLogger(__name__)

SECRET_FILE = pathlib.Path("/data/.secret_key")


def _get_alembic_config() -> AlembicConfig:
    """Build an AlembicConfig pointing at our alembic/ directory."""
    ini_path = pathlib.Path(__file__).resolve().parent.parent / "alembic.ini"
    cfg = AlembicConfig(str(ini_path))
    cfg.set_main_option("script_location", str(ini_path.parent / "alembic"))
    return cfg


def _run_alembic_migrations():
    """Run Alembic migrations. For pre-Alembic databases, run legacy migrations first then stamp."""
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    has_alembic = "alembic_version" in table_names
    has_tables = "cards" in table_names

    if has_tables and not has_alembic:
        # Legacy database: run manual migrations to bring it up to the initial schema,
        # then stamp so Alembic takes over from here.
        _run_legacy_migrations(inspector, table_names)
        cfg = _get_alembic_config()
        # Stamp with the initial schema revision (skip the migration, schema is already there)
        alembic_command.stamp(cfg, "8abde7989620")
        logger.info("Stamped legacy database at initial Alembic revision")
        # Now run remaining migrations (e.g. add deleted_at)
        alembic_command.upgrade(cfg, "head")
    else:
        # Fresh or already-Alembic database
        cfg = _get_alembic_config()
        alembic_command.upgrade(cfg, "head")


def _run_legacy_migrations(inspector, table_names):
    """Run pre-Alembic schema migrations for existing databases."""
    if "cards" in table_names:
        existing = {col["name"] for col in inspector.get_columns("cards")}
        card_migrations = [
            ("spend_reminder_enabled", "BOOLEAN NOT NULL DEFAULT 0"),
            ("spend_requirement", "INTEGER"),
            ("spend_deadline", "DATE"),
            ("spend_reminder_notes", "TEXT"),
            ("template_version_id", "VARCHAR(200)"),
            ("card_image", "VARCHAR(200)"),
            ("last_digits", "VARCHAR(5)"),
            ("signup_bonus_amount", "INTEGER"),
            ("signup_bonus_type", "VARCHAR(100)"),
            ("signup_bonus_earned", "BOOLEAN NOT NULL DEFAULT 0"),
            ("annual_fee_user_modified", "BOOLEAN NOT NULL DEFAULT 0"),
        ]
        with engine.begin() as conn:
            for col_name, col_type in card_migrations:
                if col_name not in existing:
                    conn.execute(text(
                        f"ALTER TABLE cards ADD COLUMN {col_name} {col_type}"
                    ))
                    logger.info(f"Legacy migration: added column cards.{col_name}")

            if "last_four" in existing and "last_digits" not in existing:
                conn.execute(text(
                    "ALTER TABLE cards RENAME COLUMN last_four TO last_digits"
                ))
                logger.info("Legacy migration: renamed cards.last_four → last_digits")

    if "card_benefits" in table_names:
        existing = {col["name"] for col in inspector.get_columns("card_benefits")}
        benefit_migrations = [
            ("from_template", "BOOLEAN NOT NULL DEFAULT 0"),
            ("retired", "BOOLEAN NOT NULL DEFAULT 0"),
            ("notes", "TEXT"),
            ("benefit_type", "VARCHAR(20) NOT NULL DEFAULT 'credit'"),
        ]
        with engine.begin() as conn:
            for col_name, col_type in benefit_migrations:
                if col_name not in existing:
                    conn.execute(text(
                        f"ALTER TABLE card_benefits ADD COLUMN {col_name} {col_type}"
                    ))
                    logger.info(f"Legacy migration: added column card_benefits.{col_name}")

    if "card_bonuses" in table_names:
        existing = {col["name"] for col in inspector.get_columns("card_bonuses")}
        bonus_migrations = [
            ("event_id", "INTEGER"),
            ("bonus_missed", "BOOLEAN NOT NULL DEFAULT 0"),
        ]
        with engine.begin() as conn:
            for col_name, col_type in bonus_migrations:
                if col_name not in existing:
                    conn.execute(text(
                        f"ALTER TABLE card_bonuses ADD COLUMN {col_name} {col_type}"
                    ))
                    logger.info(f"Legacy migration: added column card_bonuses.{col_name}")

    if "signup_bonuses" in table_names:
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE signup_bonuses"))
            logger.info("Legacy migration: dropped table signup_bonuses")

    if "profiles" in table_names:
        existing = {col["name"] for col in inspector.get_columns("profiles")}
        if "user_id" not in existing:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE profiles ADD COLUMN user_id INTEGER"))
                logger.info("Legacy migration: added column profiles.user_id")

    if "users" in table_names:
        existing = {col["name"] for col in inspector.get_columns("users")}
        if "password_changed_at" not in existing:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN password_changed_at DATETIME"))
                logger.info("Legacy migration: added column users.password_changed_at")


async def _template_reload_loop(interval: int) -> None:
    """Background task that periodically checks for template changes and cleans up expired OAuth states."""
    import time as _time
    from app.config import OAUTH_STATE_TTL
    from app.models.oauth_state import OAuthState

    while True:
        await asyncio.sleep(interval)
        try:
            if reload_if_changed():
                db = SessionLocal()
                try:
                    summary = sync_cards_to_templates(db)
                    if summary["cards_synced"] or summary["cards_initialized"]:
                        logger.info(f"Template hot-reload sync: {summary}")
                finally:
                    db.close()
        except Exception:
            logger.exception("Error during template hot-reload")

        # Periodic OAuth state cleanup
        try:
            db = SessionLocal()
            try:
                expired = db.query(OAuthState).filter(OAuthState.created_at < _time.time() - OAUTH_STATE_TTL).delete()
                if expired:
                    db.commit()
            finally:
                db.close()
        except Exception:
            pass  # Non-critical cleanup


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-generate SECRET_KEY if still set to the insecure default
    if settings.secret_key.startswith("change-this"):
        if SECRET_FILE.exists():
            settings.secret_key = SECRET_FILE.read_text().strip()
            logger.info("Loaded SECRET_KEY from /data/.secret_key")
        else:
            settings.secret_key = secrets.token_urlsafe(32)
            try:
                SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
                SECRET_FILE.write_text(settings.secret_key)
                os.chmod(SECRET_FILE, 0o600)
                logger.info("Generated new SECRET_KEY and saved to /data/.secret_key")
            except OSError:
                logger.warning("Could not persist SECRET_KEY to /data/.secret_key — tokens will not survive restarts")

    # Parse ALLOWED_ORIGINS at startup
    raw_origins = settings.allowed_origins.strip()
    if raw_origins == "*" or not raw_origins:
        app.state.valid_origins = None  # unrestricted
    else:
        _valid_origins = []
        for origin in raw_origins.split(","):
            origin = origin.strip()
            if not origin:
                continue
            parsed = urlparse(origin)
            if not parsed.scheme or not parsed.netloc:
                logger.warning("Skipping invalid ALLOWED_ORIGINS entry (missing scheme/host): %s", origin)
                continue
            _valid_origins.append(origin)
        app.state.valid_origins = _valid_origins

    _run_alembic_migrations()
    load_templates()
    db = SessionLocal()
    try:
        # Clean up expired OAuth states on startup
        import time as _time
        from app.config import OAUTH_STATE_TTL
        from app.models.oauth_state import OAuthState
        expired = db.query(OAuthState).filter(OAuthState.created_at < _time.time() - OAUTH_STATE_TTL).delete()
        if expired:
            logger.info("Cleaned up %d expired OAuth states", expired)
            db.commit()

        summary = sync_cards_to_templates(db)
        if summary["cards_synced"] or summary["cards_initialized"]:
            logger.info(f"Template sync: {summary}")
    finally:
        db.close()

    # Start background template reload task
    reload_task = None
    if settings.template_reload_interval > 0:
        reload_task = asyncio.create_task(
            _template_reload_loop(settings.template_reload_interval)
        )
        logger.info(
            "Template hot-reload enabled (interval=%ds)",
            settings.template_reload_interval,
        )

    yield

    if reload_task:
        reload_task.cancel()
        try:
            await reload_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="plan.cards API", version="1.0.0", lifespan=lifespan)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"detail": "Too many requests. Please try again later."})


def _cors_kwargs() -> dict:
    """Build CORSMiddleware origin kwargs based on ALLOWED_ORIGINS setting."""
    raw = settings.allowed_origins.strip()
    if raw == "*" or not raw:
        # Reflect actual request origin (required when allow_credentials=True)
        return {"allow_origin_regex": ".*"}
    origins = []
    for origin in raw.split(","):
        origin = origin.strip()
        if not origin:
            continue
        parsed = urlparse(origin)
        if parsed.scheme and parsed.netloc:
            origins.append(origin)
    return {"allow_origins": origins}


app.add_middleware(
    CORSMiddleware,
    **_cors_kwargs(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(setup.router)
app.include_router(auth.router)
app.include_router(profiles.router)
app.include_router(cards.router)
app.include_router(events.router)
app.include_router(templates.router)
app.include_router(benefits.router)
app.include_router(benefits.summary_router)
app.include_router(bonuses.router)
app.include_router(settings_router.router)
app.include_router(users.router)
app.include_router(admin.router)
app.include_router(oauth.router)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.get("/api/health")
def health():
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
        finally:
            db.close()
    except Exception:
        return JSONResponse(status_code=503, content={"status": "error", "detail": "Database unreachable"})
    return {"status": "ok"}
