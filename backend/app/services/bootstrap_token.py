"""Bootstrap token guarding privileged operations in `open` auth mode.

In `open` mode `require_auth` returns the first admin without checking any
credential, so `require_admin` passes for anyone who can reach the port. That is
a defensible default for reading and writing your own card data on a trusted
LAN. It is not defensible for the switch that permanently changes the auth mode:
`_MODE_ORDER` forbids downgrades, so an anonymous caller could lock the owner out
of their own instance with no in-app recovery. The same hole exposed the OAuth
provider configuration (attacker-controlled client_id/secret).

The token is written to the data volume and printed to the container logs on
boot, so the operator — who by definition has host access — can read it while a
network visitor cannot.
"""

import logging
import os
import pathlib
import secrets

logger = logging.getLogger(__name__)

BOOTSTRAP_TOKEN_FILE = pathlib.Path("/data/.admin_token")
BOOTSTRAP_TOKEN_HEADER = "X-Admin-Token"

_cached_token: str | None = None


def get_bootstrap_token() -> str:
    """Return the persisted bootstrap token, generating one on first use."""
    global _cached_token
    if _cached_token is not None:
        return _cached_token

    try:
        if BOOTSTRAP_TOKEN_FILE.exists():
            token = BOOTSTRAP_TOKEN_FILE.read_text().strip()
            if token:
                _cached_token = token
                return token
    except OSError:
        logger.warning("Could not read %s", BOOTSTRAP_TOKEN_FILE)

    token = secrets.token_urlsafe(24)
    try:
        BOOTSTRAP_TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        BOOTSTRAP_TOKEN_FILE.write_text(token)
        os.chmod(BOOTSTRAP_TOKEN_FILE, 0o600)
    except OSError:
        # No writable /data (tests, local dev). The token still works for this
        # process; it just won't survive a restart.
        logger.warning(
            "Could not persist the admin bootstrap token to %s", BOOTSTRAP_TOKEN_FILE
        )

    _cached_token = token
    return token


def log_bootstrap_token() -> None:
    """Print the token on boot so the operator can find it in the logs."""
    logger.warning(
        "Auth mode is 'open' — anyone who can reach this instance has full access "
        "to your card data. Privileged operations (changing the auth mode, "
        "configuring OAuth) additionally require this header:\n"
        "    %s: %s\n"
        "Run the setup wizard to move off 'open' mode.",
        BOOTSTRAP_TOKEN_HEADER,
        get_bootstrap_token(),
    )


def token_matches(supplied: str | None) -> bool:
    if not supplied:
        return False
    return secrets.compare_digest(supplied, get_bootstrap_token())
