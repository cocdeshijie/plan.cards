from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:////data/cards.db"
    secret_key: str = "change-this-secret-key-in-production"
    card_templates_dir: str = "/card_templates"
    access_token_expire_minutes: int = 1440  # 24 hours
    allowed_origins: str = "http://localhost:3000"
    template_reload_interval: int = 30  # seconds, 0 to disable

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()

# OAuth state time-to-live in seconds (used for state creation, validation, and cleanup)
OAUTH_STATE_TTL = 600
