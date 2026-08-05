from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:////data/cards.db"
    secret_key: str = "change-this-secret-key-in-production"
    card_templates_dir: str = "/card_templates"
    access_token_expire_minutes: int = 1440  # 24 hours
    # Empty by default: the frontend proxies /api/* same-origin, so the browser
    # never issues a cross-origin request and no CORS headers are needed. The
    # previous "*" default reflected ANY origin back with allow_credentials=True,
    # which disables the browser's same-origin protection entirely — and in
    # `open` mode the API needs no credentials at all, so any web page the user
    # visited could read their whole card database. Set this only if you point a
    # browser directly at the backend (NEXT_PUBLIC_API_URL).
    allowed_origins: str = ""
    template_reload_interval: int = 30  # seconds, 0 to disable

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()

# OAuth state time-to-live in seconds (used for state creation, validation, and cleanup)
OAUTH_STATE_TTL = 600
