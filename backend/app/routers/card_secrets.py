"""Optional stored card details — the "card vault".

Design notes that matter if you change anything here:

* Plaintext leaves the server only from the explicit reveal endpoint, which is a
  POST. Never accept or return a card number on a path or query parameter:
  uvicorn's access log records full URLs, so `?pan=` would write card numbers to
  disk in plaintext on every request.
* `CardOut` is untouched. Card details are never folded into the card list, so
  they never reach the frontend's cached `cards` array.
* Display fields come from `card_secrets`, never from `Card`. See _masked().
* Ownership is enforced per-endpoint by joining through Profile, matching every
  other router in this app. Nothing enforces it for you.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.card import Card
from app.models.card_secret import CardSecret
from app.models.profile import Profile
from app.models.user import User
from app.rate_limit import limiter
from app.routers.auth import require_auth
from app.schemas.card_secret import CardSecretIn, CardSecretMasked, CardSecretRevealed
from app.services.card_vault_crypto import (
    CIPHERTEXT_VERSION,
    VaultDecryptionError,
    card_binding,
    decrypt_field,
    encrypt_field,
)
from app.utils.card_number import (
    code_label,
    detect_network,
    format_pan,
    last_digits_for,
    mask_pan,
    normalize_network,
)

router = APIRouter(prefix="/api/card-secrets", tags=["card-secrets"])

_TABLE = "card_secrets"


def _owned_card(db: Session, user: User, card_id: int) -> Card:
    """Load a card and verify it belongs to the user via its profile.

    Returns 404 rather than 403 on someone else's card, so the endpoint can't be
    used to enumerate which card ids exist.
    """
    card = (
        db.query(Card)
        .join(Profile)
        .filter(Card.id == card_id, Profile.user_id == user.id, Card.deleted_at == None)  # noqa: E711
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


def _binding(card: Card) -> str:
    """The AAD component that makes a recycled card id fail closed.

    `cards.id` is a plain SQLite rowid alias, so ids of deleted rows get reused.
    Pairing the id with the card's immutable creation timestamp means a new card
    that inherits an old id cannot decrypt the orphaned row it inherited.
    """
    return card_binding(card.created_at)


def _masked(card: Card, secret: CardSecret) -> CardSecretMasked:
    """Build the masked view from the VAULT row, not the card record.

    `card.network` is free text the user can edit and a product change can
    rewrite; deriving the mask from it let an Amex render with Visa grouping and
    the wrong security-code label.
    """
    return CardSecretMasked(
        card_id=card.id,
        network=secret.network,
        last_digits=secret.last_digits,
        masked_pan=mask_pan(secret.network, secret.last_digits, secret.pan_length),
        exp_month=secret.exp_month,
        exp_year=secret.exp_year,
        exp_display=f"{secret.exp_month:02d}/{secret.exp_year % 100:02d}",
        code_label=code_label(secret.network),
        card_status=card.status,
        has_cvv=secret.cvv_encrypted is not None,
        has_holder=secret.holder_encrypted is not None,
        has_billing_zip=secret.billing_zip_encrypted is not None,
        updated_at=secret.updated_at,
    )


@router.get("", response_model=list[CardSecretMasked])
def list_card_secrets(user: User = Depends(require_auth), db: Session = Depends(get_db)):
    """Masked entries for every card of the user's that has details stored."""
    rows = (
        db.query(CardSecret)
        .join(Card, Card.id == CardSecret.card_id)
        .join(Profile, Profile.id == Card.profile_id)
        .options(joinedload(CardSecret.card))
        .filter(Profile.user_id == user.id, Card.deleted_at == None)  # noqa: E711
        .all()
    )
    return [_masked(row.card, row) for row in rows]


@router.put("/{card_id}", response_model=CardSecretMasked)
@limiter.limit("20/minute")
def upsert_card_secret(
    request: Request,
    card_id: int,
    data: CardSecretIn,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    card = _owned_card(db, user, card_id)

    # Resolution order: an explicit override wins, then what the number itself
    # says, and only then the card's free-text label (normalized). Detection
    # beats the label deliberately -- storing an Amex number against a card
    # someone typed "Visa" into used to record four trailing digits instead of
    # five and mask it with the wrong grouping.
    network = data.network or detect_network(data.pan) or normalize_network(card.network)
    last_digits = last_digits_for(data.pan, network)
    binding = _binding(card)

    def enc(value: str | None, column: str) -> bytes | None:
        if not value:
            return None
        return encrypt_field(value, table=_TABLE, column=column, pk=card_id, binding=binding)

    secret = db.get(CardSecret, card_id)
    created = secret is None
    if secret is None:
        secret = CardSecret(card_id=card_id)
        db.add(secret)

    secret.pan_encrypted = encrypt_field(
        data.pan, table=_TABLE, column="pan_encrypted", pk=card_id, binding=binding
    )
    secret.cvv_encrypted = enc(data.cvv, "cvv_encrypted")
    secret.holder_encrypted = enc(data.holder, "holder_encrypted")
    secret.billing_zip_encrypted = enc(data.billing_zip, "billing_zip_encrypted")
    secret.exp_month = data.exp_month
    secret.exp_year = data.exp_year
    secret.network = network
    secret.last_digits = last_digits
    secret.pan_length = len(data.pan)
    secret.version = CIPHERTEXT_VERSION

    # Keep the card's own display fields coherent with what was just stored.
    # last_digits is derived from this number, so a stale value would be
    # actively wrong -- Amex is identified by five digits, everything else by
    # four. The network label is only overwritten when the caller pinned one or
    # the card had none, so a deliberate choice on the card is never clobbered.
    card.last_digits = last_digits
    if data.network or not card.network:
        card.network = network

    try:
        db.commit()
    except IntegrityError:
        # Two concurrent first-writes for the same card both saw no row and both
        # INSERTed. PUT is meant to be idempotent, so re-apply as an update
        # rather than surfacing a UNIQUE constraint failure as a 500.
        if not created:
            raise
        db.rollback()
        card = _owned_card(db, user, card_id)
        binding = _binding(card)
        secret = db.get(CardSecret, card_id)
        if secret is None:
            raise
        secret.pan_encrypted = encrypt_field(
            data.pan, table=_TABLE, column="pan_encrypted", pk=card_id, binding=binding
        )
        secret.cvv_encrypted = enc(data.cvv, "cvv_encrypted")
        secret.holder_encrypted = enc(data.holder, "holder_encrypted")
        secret.billing_zip_encrypted = enc(data.billing_zip, "billing_zip_encrypted")
        secret.exp_month = data.exp_month
        secret.exp_year = data.exp_year
        secret.network = network
        secret.last_digits = last_digits
        secret.pan_length = len(data.pan)
        secret.version = CIPHERTEXT_VERSION
        card.last_digits = last_digits
        if data.network or not card.network:
            card.network = network
        db.commit()

    db.refresh(secret)
    return _masked(card, secret)


@router.post("/{card_id}/reveal", response_model=CardSecretRevealed)
@limiter.limit("60/minute")
def reveal_card_secret(
    request: Request,
    card_id: int,
    response: Response,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Decrypt and return the stored details for one card.

    POST, not GET: the response must never be cached or land in an access log
    alongside a URL that identifies what it contained.
    """
    card = _owned_card(db, user, card_id)
    secret = db.get(CardSecret, card_id)
    if secret is None:
        raise HTTPException(status_code=404, detail="No details stored for this card")

    binding = _binding(card)

    def dec(blob: bytes | None, column: str) -> str | None:
        return decrypt_field(blob, table=_TABLE, column=column, pk=card_id, binding=binding)

    try:
        pan = dec(secret.pan_encrypted, "pan_encrypted")
        cvv = dec(secret.cvv_encrypted, "cvv_encrypted")
        holder = dec(secret.holder_encrypted, "holder_encrypted")
        billing_zip = dec(secret.billing_zip_encrypted, "billing_zip_encrypted")
    except VaultDecryptionError as e:
        raise HTTPException(status_code=400, detail=str(e))

    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"

    assert pan is not None  # pan_encrypted is NOT NULL
    return CardSecretRevealed(
        card_id=card_id,
        network=secret.network,
        pan=format_pan(pan, secret.network),
        pan_digits=pan,
        exp_month=secret.exp_month,
        exp_year=secret.exp_year,
        exp_display=f"{secret.exp_month:02d}/{secret.exp_year % 100:02d}",
        cvv=cvv,
        code_label=code_label(secret.network),
        holder=holder,
        billing_zip=billing_zip,
    )


@router.delete("/{card_id}", status_code=204)
@limiter.limit("20/minute")
def delete_card_secret(
    request: Request,
    card_id: int,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    _owned_card(db, user, card_id)
    secret = db.get(CardSecret, card_id)
    if secret is None:
        raise HTTPException(status_code=404, detail="No details stored for this card")
    db.delete(secret)
    db.commit()
