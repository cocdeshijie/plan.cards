"""Encrypt/decrypt OAuth client secrets at rest using Fernet (derived from SECRET_KEY)."""

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

from app.config import settings

logger = logging.getLogger(__name__)


def _get_fernet_new() -> Fernet:
    """Derive Fernet key using PBKDF2. No caching — avoids race with lifespan secret key update."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"cct-fernet-v1",
        iterations=100_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(settings.secret_key.encode()))
    return Fernet(key)


def _get_fernet_old() -> Fernet:
    """Legacy key derivation (single SHA-256, no salt) for migration."""
    key = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_value(plaintext: str) -> str:
    return _get_fernet_new().encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str) -> str:
    try:
        return _get_fernet_new().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        # Try legacy key for auto-migration
        try:
            plaintext = _get_fernet_old().decrypt(ciphertext.encode()).decode()
            logger.info("Auto-migrated encrypted value from legacy key derivation")
            return plaintext
        except InvalidToken:
            raise
