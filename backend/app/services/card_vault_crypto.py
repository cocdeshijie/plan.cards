"""Encrypt card-vault fields: PAN, security code, cardholder name, billing ZIP.

Deliberately separate from services/crypto.py, which protects OAuth client
secrets and tokens with Fernet. Two reasons the card vault does not just reuse
`encrypt_value`:

1. **Fernet has no AAD.** Without additional authenticated data there is nothing
   binding a ciphertext to the row it lives in. Someone with database *write*
   access -- a SQL bug, a careless admin script -- could run

       UPDATE card_secrets SET pan_encrypted = <another row's blob> WHERE card_id = 7

   then open the app and read the decrypted value back through the normal UI.
   Authenticated encryption alone does not stop that: the ciphertext is
   perfectly valid, just attached to the wrong row. Binding
   `table || column || card_id` into the AAD makes the swap fail to decrypt.

2. **Key separation.** An OAuth client secret and a card number should not share
   a key. HKDF with distinct `info` labels gives two independent keys from the
   one file the operator already has to back up.

Fernet also stores a plaintext creation timestamp in every token and is AES-128;
neither is a problem for OAuth secrets, and neither is worth inheriting here.

Key custody, stated plainly: the key lives at /data/.encryption_key next to the
database. A stolen `cards.db` on its own yields ciphertext, and `VACUUM INTO`
backups do not contain the key. Anyone who copies the whole /data volume gets
both. That trade is deliberate -- see the "no vault passphrase" decision -- and
it is why the admin backup UI has to say the key is not included.
"""

import os
import struct
from datetime import datetime, timezone

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.services.crypto import root_key_material

# Bumped only when the wire format changes. Stored as the first byte of every
# blob so a future re-encryption pass can tell old rows from new ones.
CIPHERTEXT_VERSION = 1

_HKDF_INFO = b"plan.cards/card-vault/v1"
_NONCE_LEN = 12

_cached_key: bytes | None = None


class VaultDecryptionError(Exception):
    """A stored card field could not be decrypted or failed authentication."""


def _vault_key() -> bytes:
    global _cached_key
    if _cached_key is None:
        _cached_key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=None,
            info=_HKDF_INFO,
        ).derive(root_key_material())
    return _cached_key


def reset_key_cache() -> None:
    """Drop the cached subkey. Only used by tests."""
    global _cached_key
    _cached_key = None


def card_binding(created_at: datetime | None) -> str:
    """Canonical AAD binding string for a card's creation timestamp.

    Must be normalized, not just `isoformat()`. The column is a naive DateTime,
    but the model's Python default produces an AWARE value — so a row that was
    just created in this session stringifies as "…+00:00" while the same row
    reloaded from SQLite stringifies without the offset. Encrypting against one
    form and decrypting against the other silently fails to authenticate, which
    is exactly what happened to details carried across an override import.
    """
    if created_at is None:
        return ""
    if created_at.tzinfo is not None:
        created_at = created_at.astimezone(timezone.utc).replace(tzinfo=None)
    return created_at.isoformat()


def _aad(table: str, column: str, pk: int, binding: str) -> bytes:
    """Length-prefixed AAD binding a ciphertext to its exact row and column.

    Length prefixes matter: plain concatenation is ambiguous, so
    ("cards", "pan_id") and ("cards_pan", "id") would produce identical AAD and
    a ciphertext could be moved between those two columns undetected.

    `binding` exists because the primary key alone is NOT a stable identity.
    `cards.id` is a plain SQLite rowid alias with no AUTOINCREMENT, so SQLite
    reuses the ids of deleted rows. If a card_secrets row is ever orphaned --
    the cards row removed without the FK cascade firing, which is exactly what
    the sqlite3 CLI does by default since it starts with foreign_keys=OFF, and
    what a migration inside a PRAGMA foreign_keys=OFF block would do -- then a
    NEW card can be created with the recycled id and silently inherit the old
    card's stored number. Across user accounts, that is a disclosure bug.

    Passing the card's immutable created_at makes the recycled row fail to
    authenticate instead: it fails closed, with a decryption error, rather than
    handing someone else's card number to whoever now owns that id.
    """
    out = b""
    for part in (table.encode(), column.encode(), str(pk).encode(), binding.encode()):
        out += struct.pack(">Q", len(part)) + part
    return out


def encrypt_field(plaintext: str, *, table: str, column: str, pk: int, binding: str) -> bytes:
    """Encrypt one field, bound to the row it will be stored in.

    Layout: version byte || 12-byte random nonce || AES-256-GCM ciphertext+tag.

    A random 96-bit nonce is safe far beyond this app's scale: NIST SP 800-38D
    caps random-nonce GCM at 2^32 messages per key, and the collision
    probability at 10^3 writes is around 6e-24.
    """
    nonce = os.urandom(_NONCE_LEN)
    ct = AESGCM(_vault_key()).encrypt(nonce, plaintext.encode(), _aad(table, column, pk, binding))
    return bytes([CIPHERTEXT_VERSION]) + nonce + ct


def decrypt_field(
    blob: bytes | None, *, table: str, column: str, pk: int, binding: str
) -> str | None:
    """Decrypt one field. Returns None for a NULL column.

    Raises VaultDecryptionError rather than InvalidTag so routers can turn it
    into an actionable 400 instead of a 500 -- the realistic cause is a restored
    backup without /data/.encryption_key, and the user needs to be told that
    rather than shown a stack trace.
    """
    if blob is None:
        return None
    if not blob:
        raise VaultDecryptionError("Stored card field is empty.")

    # Version first: a future format may legitimately be shorter, and reporting
    # "truncated or corrupt" for it would send the reader down the wrong path.
    version = blob[0]
    if version != CIPHERTEXT_VERSION:
        raise VaultDecryptionError(
            f"Stored card field uses unsupported format version {version}."
        )
    if len(blob) < 1 + _NONCE_LEN + 16:
        raise VaultDecryptionError("Stored card field is truncated or corrupt.")

    nonce = blob[1 : 1 + _NONCE_LEN]
    ct = blob[1 + _NONCE_LEN :]
    try:
        return AESGCM(_vault_key()).decrypt(nonce, ct, _aad(table, column, pk, binding)).decode()
    except InvalidTag:
        raise VaultDecryptionError(
            "Stored card details could not be decrypted. This usually means "
            "/data/.encryption_key is missing or different -- for example after "
            "restoring a database backup onto a fresh volume. Restore the key "
            "file, or re-enter the card details."
        )
