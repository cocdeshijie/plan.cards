"""Preset OAuth/OIDC provider configurations."""

PRESETS: dict[str, dict] = {
    "google": {
        "display_name": "Google",
        "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "issuer_url": "https://accounts.google.com",
        "scopes": "openid email profile",
    },
    "github": {
        "display_name": "GitHub",
        "authorization_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "userinfo_url": "https://api.github.com/user",
        "scopes": "read:user user:email",
    },
    "discord": {
        "display_name": "Discord",
        "authorization_url": "https://discord.com/api/oauth2/authorize",
        "token_url": "https://discord.com/api/oauth2/token",
        "userinfo_url": "https://discord.com/api/users/@me",
        "scopes": "identify email",
    },
    "facebook": {
        "display_name": "Facebook",
        "authorization_url": "https://www.facebook.com/v18.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v18.0/oauth/access_token",
        "userinfo_url": "https://graph.facebook.com/me?fields=id,name,email",
        "scopes": "email public_profile",
    },
}


def get_preset(provider_name: str) -> dict | None:
    return PRESETS.get(provider_name)


def list_presets() -> list[dict]:
    return [{"name": k, **v} for k, v in PRESETS.items()]
