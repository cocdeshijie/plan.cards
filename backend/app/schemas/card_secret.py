from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator

from app.utils.card_number import (
    KNOWN_NETWORKS,
    MAX_PAN_LENGTH,
    MIN_PAN_LENGTH,
    digits_only,
    luhn_valid,
    valid_length,
)

# Every validator below returns a FIXED message and never interpolates the value
# it rejected. FastAPI's 422 body would otherwise carry the offending input
# straight back to the client, where the frontend surfaces it in an error toast
# — so a mistyped card number would be echoed into the UI and any log that
# captures response bodies. app/main.py additionally strips `input`/`ctx` from
# every validation error as a backstop.


class CardSecretIn(BaseModel):
    """Card details on the way in. Plaintext here and nowhere else."""

    pan: str
    exp_month: int
    exp_year: int
    cvv: str | None = None
    holder: str | None = None
    billing_zip: str | None = None
    # Optional override. Cards are genuinely co-badged, so the holder's answer
    # beats prefix detection.
    network: str | None = None

    @field_validator("pan")
    @classmethod
    def validate_pan(cls, v: str) -> str:
        digits = digits_only(v)
        if not digits:
            raise ValueError("Card number is required.")
        if not (MIN_PAN_LENGTH <= len(digits) <= MAX_PAN_LENGTH):
            raise ValueError(
                f"Card number must be between {MIN_PAN_LENGTH} and {MAX_PAN_LENGTH} digits."
            )
        if not luhn_valid(digits):
            raise ValueError("Card number failed its check digit — likely a typo.")
        return digits

    @field_validator("cvv")
    @classmethod
    def validate_cvv(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        digits = digits_only(v)
        if len(digits) not in (3, 4):
            raise ValueError("Security code must be 3 or 4 digits.")
        return digits

    @field_validator("exp_month")
    @classmethod
    def validate_month(cls, v: int) -> int:
        if not 1 <= v <= 12:
            raise ValueError("Expiry month must be between 1 and 12.")
        return v

    @field_validator("exp_year")
    @classmethod
    def validate_year(cls, v: int) -> int:
        # Accept a two-digit year and normalize, since that is what is printed
        # on the card and what people type.
        if 0 <= v <= 99:
            v = 2000 + v
        if not 2000 <= v <= 2099:
            raise ValueError("Expiry year must be between 2000 and 2099.")
        return v

    @field_validator("holder")
    @classmethod
    def validate_holder(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) > 100:
            raise ValueError("Cardholder name must be 100 characters or fewer.")
        return v

    @field_validator("billing_zip")
    @classmethod
    def validate_zip(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) > 16:
            raise ValueError("Billing postcode must be 16 characters or fewer.")
        if not all(ch.isalnum() or ch in " -" for ch in v):
            raise ValueError("Billing postcode may contain only letters, digits, spaces and hyphens.")
        return v

    @field_validator("network")
    @classmethod
    def validate_network(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        if v not in KNOWN_NETWORKS:
            raise ValueError(f"Network must be one of: {', '.join(KNOWN_NETWORKS)}.")
        return v

    @model_validator(mode="after")
    def check_length_against_network(self) -> "CardSecretIn":
        # Only enforced when the caller pinned a network; detection alone is a
        # hint and should not block saving an unusual card.
        if self.network and not valid_length(self.pan, self.network):
            raise ValueError("Card number length does not match the selected network.")
        return self


class CardSecretMasked(BaseModel):
    """What the vault list returns. No plaintext beyond the trailing digits."""

    card_id: int
    network: str | None
    last_digits: str
    masked_pan: str
    exp_month: int
    exp_year: int
    exp_display: str
    code_label: str
    # Surfaced so a closed card is visibly dead in the vault. Without it a
    # cancelled card is indistinguishable from a live one, and the obvious
    # failure is pasting a dead number into a checkout.
    card_status: str
    has_cvv: bool
    has_holder: bool
    has_billing_zip: bool
    updated_at: datetime


class CardSecretRevealed(BaseModel):
    """Full plaintext. Returned only from the explicit reveal endpoint."""

    card_id: int
    network: str | None
    pan: str
    """Grouped for display: '3782 822463 10005'."""
    pan_digits: str
    """Bare digits, for copying. Checkout fields commonly apply their own input
    mask or cap at maxlength=16, where pasted spaces get truncated or rejected."""
    exp_month: int
    exp_year: int
    exp_display: str
    cvv: str | None
    code_label: str
    holder: str | None
    billing_zip: str | None
