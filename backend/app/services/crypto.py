"""Encrypt/decrypt OAuth client secrets at rest using Fernet.

The encryption key is persisted at /data/.encryption_key, SEPARATE from
SECRET_KEY. Deriving it from SECRET_KEY meant that changing SECRET_KEY -- which
.env.example's `change-this-secret-key-in-production` default and a startup
ERROR log both push operators to do, and which is a two-second edit in a
platform's env UI -- silently made every stored OAuth client secret
undecryptable. Rotating SECRET_KEY should log everyone out (expected); it should
not brick OAuth with an InvalidToken raised mid-callback, after the user has
already been redirected to their provider and back.
"""

import base64
import hashlib
import logging
import os
import pathlib

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

from app.config import settings

logger = logging.getLogger(__name__)

ENCRYPTION_KEY_FILE = pathlib.Path("/data/.encryption_key")

_cached_key: bytes | None = None


class DecryptionError(Exception):
    """A stored secret could not be decrypted with the current key."""


def _load_or_create_key() -> bytes:
    """Read the persisted Fernet key, generating one on first use."""
    global _cached_key
    if _cached_key is not None:
        return _cached_key

    try:
        if ENCRYPTION_KEY_FILE.exists():
            _cached_key = ENCRYPTION_KEY_FILE.read_text().strip().encode()
            return _cached_key
    except OSError:
        logger.warning("Could not read %s", ENCRYPTION_KEY_FILE)

    key = Fernet.generate_key()
    try:
        ENCRYPTION_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        ENCRYPTION_KEY_FILE.write_text(key.decode())
        os.chmod(ENCRYPTION_KEY_FILE, 0o600)
        logger.info("Generated new encryption key at %s", ENCRYPTION_KEY_FILE)
    except OSError:
        # No writable /data (tests, local dev). Fall back to deriving from
        # SECRET_KEY so encryption still works within the process.
        logger.warning(
            "Could not persist encryption key to %s — falling back to a "
            "SECRET_KEY-derived key for this process",
            ENCRYPTION_KEY_FILE,
        )
        return _derive_from_secret_key()

    _cached_key = key
    return _cached_key


def _derive_from_secret_key() -> bytes:
    """Legacy derivation: PBKDF2 over SECRET_KEY. Still read for migration."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"cct-fernet-v1",
        iterations=100_000,
    )
    return base64.urlsafe_b64encode(kdf.derive(settings.secret_key.encode()))


def _get_fernet_new() -> Fernet:
    return Fernet(_load_or_create_key())


def _get_fernet_pbkdf2() -> Fernet:
    """Previous key derivation (PBKDF2 over SECRET_KEY), for migration."""
    return Fernet(_derive_from_secret_key())


def _get_fernet_old() -> Fernet:
    """Oldest key derivation (single SHA-256, no salt), for migration."""
    key = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_value(plaintext: str) -> str:
    return _get_fernet_new().encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str) -> str:
    """Decrypt, trying older key derivations so existing secrets keep working.

    Raises DecryptionError (not InvalidToken) when nothing works, so callers can
    surface an actionable "re-enter this secret" message instead of a 500.
    """
    for fernet, label in (
        (_get_fernet_new(), "current"),
        (_get_fernet_pbkdf2(), "SECRET_KEY-derived (PBKDF2)"),
        (_get_fernet_old(), "SECRET_KEY-derived (legacy SHA-256)"),
    ):
        try:
            plaintext = fernet.decrypt(ciphertext.encode()).decode()
        except InvalidToken:
            continue
        if label != "current":
            logger.info("Decrypted stored secret using the %s key", label)
        return plaintext

    raise DecryptionError(
        "Stored secret could not be decrypted. This usually means SECRET_KEY "
        "changed before the value was migrated to /data/.encryption_key — "
        "re-enter the affected OAuth provider's client secret."
    )
