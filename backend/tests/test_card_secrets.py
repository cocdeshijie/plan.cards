"""Tests for the optional card-details vault.

Card numbers used here are the publicly documented payment-network test values
(4242…, 3782…, 5555…, 6011…). They are Luhn-valid by design and belong to no
real account.
"""

import pytest

from app.models.card import Card
from app.models.card_secret import CardSecret
from app.services.card_vault_crypto import (
    VaultDecryptionError,
    decrypt_field,
    encrypt_field,
)

VISA = "4242424242424242"
AMEX = "378282246310005"
MC = "5555555555554444"
DISCOVER = "6011111111111117"


# ── helpers ────────────────────────────────────────────────────────────

_profile_seq = iter(range(1, 10_000))


def _make_card(client, headers, name="Sapphire Reserve", issuer="Chase", network=None, profile_id=None):
    if profile_id is None:
        # Unique per call — profile names are unique per user, so reusing one
        # name made the second card in a test silently fail to be created.
        r = client.post("/api/profiles", json={"name": f"P{next(_profile_seq)}"}, headers=headers)
        assert r.status_code in (200, 201), r.text
        profile_id = r.json()["id"]
    payload = {
        "profile_id": profile_id,
        "card_name": name,
        "issuer": issuer,
        "open_date": "2024-01-01",
    }
    if network:
        payload["network"] = network
    r = client.post("/api/cards", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _secret_payload(**over):
    base = {
        "pan": VISA,
        "exp_month": 8,
        "exp_year": 2029,
        "cvv": "829",
        "holder": "ALEX RIVERA",
        "billing_zip": "94110",
    }
    base.update(over)
    return base


# ── round trip ─────────────────────────────────────────────────────────

def test_upsert_and_reveal_round_trip(client, auth_headers):
    card = _make_card(client, auth_headers)

    r = client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)
    assert r.status_code == 200, r.text
    masked = r.json()
    assert masked["last_digits"] == "4242"
    assert masked["masked_pan"] == "•••• •••• •••• 4242"
    assert masked["exp_display"] == "08/29"
    assert masked["has_cvv"] is True
    assert masked["has_holder"] is True
    assert masked["has_billing_zip"] is True
    # The masked view must never carry the full number.
    assert VISA not in r.text

    r = client.post(f"/api/card-secrets/{card['id']}/reveal", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pan_digits"] == VISA
    assert body["pan"] == "4242 4242 4242 4242"
    assert body["cvv"] == "829"
    assert body["holder"] == "ALEX RIVERA"
    assert body["billing_zip"] == "94110"
    assert body["exp_display"] == "08/29"
    assert r.headers["cache-control"] == "no-store"


def test_pan_accepts_spaces_and_stores_digits(client, auth_headers):
    card = _make_card(client, auth_headers)
    client.put(
        f"/api/card-secrets/{card['id']}",
        json=_secret_payload(pan="4242 4242 4242 4242"),
        headers=auth_headers,
    )
    body = client.post(f"/api/card-secrets/{card['id']}/reveal", headers=auth_headers).json()
    assert body["pan_digits"] == VISA


def test_upsert_replaces_existing(client, auth_headers):
    card = _make_card(client, auth_headers)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)
    r = client.put(
        f"/api/card-secrets/{card['id']}",
        json=_secret_payload(pan=MC, cvv="512", holder="NEW NAME"),
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = client.post(f"/api/card-secrets/{card['id']}/reveal", headers=auth_headers).json()
    assert body["pan_digits"] == MC
    assert body["holder"] == "NEW NAME"

    # Still exactly one row, not two.
    listing = client.get("/api/card-secrets", headers=auth_headers).json()
    assert len(listing) == 1


def test_optional_fields_may_be_omitted(client, auth_headers):
    card = _make_card(client, auth_headers)
    r = client.put(
        f"/api/card-secrets/{card['id']}",
        json={"pan": VISA, "exp_month": 8, "exp_year": 2029},
        headers=auth_headers,
    )
    assert r.status_code == 200
    masked = r.json()
    assert masked["has_cvv"] is False
    assert masked["has_holder"] is False
    body = client.post(f"/api/card-secrets/{card['id']}/reveal", headers=auth_headers).json()
    assert body["cvv"] is None
    assert body["holder"] is None


# ── Amex: five trailing digits, four-digit CID ─────────────────────────

def test_amex_uses_five_last_digits_and_four_digit_code(client, auth_headers):
    card = _make_card(client, auth_headers, name="Platinum", issuer="Amex")
    r = client.put(
        f"/api/card-secrets/{card['id']}",
        json=_secret_payload(pan=AMEX, cvv="1005"),
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    masked = r.json()
    assert masked["network"] == "Amex"
    assert masked["last_digits"] == "10005"
    assert masked["masked_pan"] == "•••• •••••• 10005"
    assert masked["code_label"] == "CID"

    body = client.post(f"/api/card-secrets/{card['id']}/reveal", headers=auth_headers).json()
    assert body["pan"] == "3782 822463 10005"
    assert body["pan_digits"] == AMEX
    assert body["cvv"] == "1005"


def test_network_detected_when_card_has_none(client, auth_headers):
    card = _make_card(client, auth_headers, issuer="Discover")
    assert card["network"] is None
    client.put(
        f"/api/card-secrets/{card['id']}",
        json=_secret_payload(pan=DISCOVER, cvv="204"),
        headers=auth_headers,
    )
    updated = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert updated["network"] == "Discover"
    assert updated["last_digits"] == "1117"


def test_explicit_network_overrides_detection(client, auth_headers):
    """Co-badged cards are real; the holder's answer beats the prefix."""
    card = _make_card(client, auth_headers, issuer="Discover")
    client.put(
        f"/api/card-secrets/{card['id']}",
        json=_secret_payload(pan=DISCOVER, cvv="204", network="JCB"),
        headers=auth_headers,
    )
    updated = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert updated["network"] == "JCB"


def test_existing_card_network_is_not_clobbered(client, auth_headers):
    card = _make_card(client, auth_headers, issuer="Chase", network="Visa")
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)
    updated = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert updated["network"] == "Visa"


# ── validation, and never echoing the rejected number ──────────────────

def test_luhn_failure_rejected(client, auth_headers):
    card = _make_card(client, auth_headers)
    bad = "4242424242424243"
    r = client.put(
        f"/api/card-secrets/{card['id']}", json=_secret_payload(pan=bad), headers=auth_headers
    )
    assert r.status_code == 422
    assert "check digit" in r.text


def test_rejected_pan_is_not_echoed_back(client, auth_headers):
    """A 422 must not reflect the card number into the response body.

    FastAPI's default handler includes the offending `input`, which the frontend
    flattens into an error toast. app/main.py strips it for every endpoint.
    """
    card = _make_card(client, auth_headers)
    bad = "4242424242424243"
    r = client.put(
        f"/api/card-secrets/{card['id']}", json=_secret_payload(pan=bad), headers=auth_headers
    )
    assert r.status_code == 422
    assert bad not in r.text
    for err in r.json()["detail"]:
        assert "input" not in err
        assert "ctx" not in err


@pytest.mark.parametrize(
    "payload,expect",
    [
        ({"pan": "123"}, "digits"),
        ({"exp_month": 13}, "month"),
        ({"exp_year": 1999}, "year"),
        ({"cvv": "12"}, "3 or 4"),
        ({"billing_zip": "!!!"}, "letters, digits"),
        ({"network": "Nope"}, "Network must be"),
    ],
)
def test_field_validation(client, auth_headers, payload, expect):
    card = _make_card(client, auth_headers)
    r = client.put(
        f"/api/card-secrets/{card['id']}", json=_secret_payload(**payload), headers=auth_headers
    )
    assert r.status_code == 422, r.text
    assert expect in r.text


def test_two_digit_year_normalized(client, auth_headers):
    card = _make_card(client, auth_headers)
    r = client.put(
        f"/api/card-secrets/{card['id']}", json=_secret_payload(exp_year=29), headers=auth_headers
    )
    assert r.status_code == 200
    assert r.json()["exp_year"] == 2029


def test_length_must_match_pinned_network(client, auth_headers):
    card = _make_card(client, auth_headers)
    r = client.put(
        f"/api/card-secrets/{card['id']}",
        json=_secret_payload(pan=VISA, network="Amex"),
        headers=auth_headers,
    )
    assert r.status_code == 422
    assert "does not match the selected network" in r.text


# ── leak surfaces ──────────────────────────────────────────────────────

def test_card_endpoints_never_expose_secrets(client, auth_headers):
    card = _make_card(client, auth_headers)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)

    listing = client.get("/api/cards", headers=auth_headers)
    assert VISA not in listing.text
    assert "829" not in listing.json()[0].get("custom_notes", "") if listing.json()[0].get("custom_notes") else True
    assert "pan" not in listing.json()[0]
    assert "secret" not in listing.json()[0]

    detail = client.get(f"/api/cards/{card['id']}", headers=auth_headers)
    assert VISA not in detail.text
    assert "pan_encrypted" not in detail.text


def test_profile_export_excludes_secrets(client, auth_headers):
    """Export is designed to be moved between instances and lands in a
    Downloads folder. Card details must not ride along."""
    card = _make_card(client, auth_headers)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)

    r = client.get("/api/profiles/export", headers=auth_headers)
    assert r.status_code == 200
    assert VISA not in r.text
    assert "94110" not in r.text
    assert "ALEX RIVERA" not in r.text
    assert "829" not in r.text


def test_soft_deleted_card_secret_hidden_from_list(client, auth_headers):
    card = _make_card(client, auth_headers)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)
    assert len(client.get("/api/card-secrets", headers=auth_headers).json()) == 1

    client.delete(f"/api/cards/{card['id']}", headers=auth_headers)
    assert client.get("/api/card-secrets", headers=auth_headers).json() == []

    # Soft delete is reversible, so the details come back with the card rather
    # than being destroyed by an undoable operation.
    client.post(f"/api/cards/{card['id']}/restore", headers=auth_headers)
    assert len(client.get("/api/card-secrets", headers=auth_headers).json()) == 1


def test_hard_deleting_the_card_cascades(client, auth_headers, db_session):
    card = _make_card(client, auth_headers)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)

    row = db_session.get(Card, card["id"])
    db_session.delete(row)
    db_session.commit()
    assert db_session.get(CardSecret, card["id"]) is None


# ── ownership ──────────────────────────────────────────────────────────

def _two_users(client):
    client.post("/api/setup/complete", json={
        "auth_mode": "multi_user", "admin_username": "admin", "admin_password": "adminpass",
    })
    a = client.post("/api/auth/register", json={"username": "user_a", "password": "password_a1"}).json()
    b = client.post("/api/auth/register", json={"username": "user_b", "password": "password_b1"}).json()
    return (
        {"Authorization": f"Bearer {a['access_token']}"},
        {"Authorization": f"Bearer {b['access_token']}"},
    )


def test_other_user_cannot_touch_secrets(client):
    headers_a, headers_b = _two_users(client)
    card = _make_card(client, headers_a)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=headers_a)

    assert client.post(f"/api/card-secrets/{card['id']}/reveal", headers=headers_b).status_code == 404
    assert client.put(
        f"/api/card-secrets/{card['id']}", json=_secret_payload(pan=MC), headers=headers_b
    ).status_code == 404
    assert client.delete(f"/api/card-secrets/{card['id']}", headers=headers_b).status_code == 404
    assert client.get("/api/card-secrets", headers=headers_b).json() == []

    # A's data is untouched.
    body = client.post(f"/api/card-secrets/{card['id']}/reveal", headers=headers_a).json()
    assert body["pan_digits"] == VISA


def test_reveal_missing_secret_is_404(client, auth_headers):
    card = _make_card(client, auth_headers)
    assert client.post(f"/api/card-secrets/{card['id']}/reveal", headers=auth_headers).status_code == 404


def test_delete_secret(client, auth_headers):
    card = _make_card(client, auth_headers)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)
    assert client.delete(f"/api/card-secrets/{card['id']}", headers=auth_headers).status_code == 204
    assert client.get("/api/card-secrets", headers=auth_headers).json() == []
    # The card itself survives.
    assert client.get(f"/api/cards/{card['id']}", headers=auth_headers).status_code == 200


# ── display stays true to the stored number ────────────────────────────

def test_mask_survives_card_network_and_last_digits_edits(client, auth_headers):
    """The vault must describe the number it stored, not the card's labels.

    card.network and card.last_digits are free text the user edits inline and a
    product change rewrites. Deriving the mask from them let an Amex render as
    '•••• •••• •••• 10005' — 4-4-4-4 grouping over a five-digit tail — and
    report CVV2 for a stored 4-digit CID.
    """
    card = _make_card(client, auth_headers, name="Platinum", issuer="Amex")
    client.put(
        f"/api/card-secrets/{card['id']}",
        json=_secret_payload(pan=AMEX, cvv="1005"),
        headers=auth_headers,
    )
    client.put(
        f"/api/cards/{card['id']}",
        json={"card_name": "Platinum", "issuer": "Amex", "network": "Visa", "last_digits": "9999"},
        headers=auth_headers,
    )

    entry = client.get("/api/card-secrets", headers=auth_headers).json()[0]
    assert entry["network"] == "Amex"
    assert entry["last_digits"] == "10005"
    assert entry["masked_pan"] == "•••• •••••• 10005"
    assert entry["code_label"] == "CID"

    body = client.post(f"/api/card-secrets/{card['id']}/reveal", headers=auth_headers).json()
    assert body["pan"] == "3782 822463 10005"


def test_detection_beats_the_cards_free_text_label(client, auth_headers):
    """Default UI path: the dialog sends network=null unless the user overrides.

    Storing a real Amex against a card whose template said Visa used to record
    four trailing digits instead of five and label the 4-digit CID as CVV2.
    """
    card = _make_card(client, auth_headers, issuer="Chase", network="Visa")
    r = client.put(
        f"/api/card-secrets/{card['id']}",
        json=_secret_payload(pan=AMEX, cvv="1005", network=None),
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["network"] == "Amex"
    assert r.json()["last_digits"] == "10005"
    assert r.json()["code_label"] == "CID"


def test_product_change_does_not_corrupt_the_mask(client, auth_headers):
    card = _make_card(client, auth_headers, name="Platinum", issuer="Amex")
    client.put(
        f"/api/card-secrets/{card['id']}",
        json=_secret_payload(pan=AMEX, cvv="1005"),
        headers=auth_headers,
    )
    r = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={"new_card_name": "Green", "new_network": "Visa", "change_date": "2026-01-01"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    entry = client.get("/api/card-secrets", headers=auth_headers).json()[0]
    assert entry["masked_pan"] == "•••• •••••• 10005"
    assert entry["code_label"] == "CID"


def test_mask_is_sized_to_the_real_number(client, auth_headers):
    """A fixed 16-position mask invented digits a 15-digit card doesn't have."""
    amex = _make_card(client, auth_headers, name="Plat", issuer="Amex")
    client.put(f"/api/card-secrets/{amex['id']}", json=_secret_payload(pan=AMEX, cvv="1005"), headers=auth_headers)
    diners = _make_card(client, auth_headers, name="DC", issuer="Diners")
    client.put(f"/api/card-secrets/{diners['id']}", json=_secret_payload(pan="3056930009020004"), headers=auth_headers)

    by_id = {e["card_id"]: e for e in client.get("/api/card-secrets", headers=auth_headers).json()}
    amex_mask = by_id[amex["id"]]["masked_pan"]
    diners_mask = by_id[diners["id"]]["masked_pan"]
    assert len(amex_mask.replace(" ", "")) == 15
    # 16-digit Diners groups 4-4-4-4, not the 14-digit 4-6-4.
    assert len(diners_mask.replace(" ", "")) == 16
    assert diners_mask == "•••• •••• •••• 0004"


def test_closed_card_status_is_surfaced(client, auth_headers):
    """A cancelled card must be visibly dead — pasting a dead number into a
    checkout is the obvious failure mode otherwise."""
    card = _make_card(client, auth_headers)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)
    assert client.get("/api/card-secrets", headers=auth_headers).json()[0]["card_status"] == "active"

    client.post(f"/api/cards/{card['id']}/close", json={"close_date": "2026-06-01"}, headers=auth_headers)
    assert client.get("/api/card-secrets", headers=auth_headers).json()[0]["card_status"] == "closed"


# ── unicode digits ─────────────────────────────────────────────────────

@pytest.mark.parametrize("pan", ["٤٢٤٢٤٢٤٢٤٢٤٢٤٢٤٨", "４２４２４２４２４２４２４２４２", "2²00000000000006", "35²0000000000008"])
def test_non_ascii_digits_rejected(client, auth_headers, pan):
    """str.isdigit() is True for superscripts and every non-Latin decimal set.

    Those used to reach luhn_valid (which subtracts 48 without a range check)
    and then int() inside detect_network — a 500 whose exception text carried
    the submitted BIN into the server log.
    """
    card = _make_card(client, auth_headers)
    r = client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(pan=pan), headers=auth_headers)
    assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"


# ── export / import ────────────────────────────────────────────────────

def test_override_import_preserves_stored_details(client, auth_headers):
    """Override recreates cards. The secrets are not in the export file, so
    destroying them here would be permanent and unrecoverable."""
    card = _make_card(client, auth_headers)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)
    profile_id = client.get("/api/cards", headers=auth_headers).json()[0]["profile_id"]

    export = client.get("/api/profiles/export", headers=auth_headers).json()
    r = client.post(
        f"/api/profiles/import?mode=override&target_profile_id={profile_id}",
        json=export,
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["card_secrets_preserved"] == 1

    listing = client.get("/api/card-secrets", headers=auth_headers).json()
    assert len(listing) == 1
    new_id = listing[0]["card_id"]
    body = client.post(f"/api/card-secrets/{new_id}/reveal", headers=auth_headers).json()
    assert body["pan_digits"] == VISA
    assert body["cvv"] == "829"
    assert body["holder"] == "ALEX RIVERA"


# ── crypto ─────────────────────────────────────────────────────────────

BIND = "2026-01-01T00:00:00+00:00"


def _enc(value="4242424242424242", column="pan_encrypted", pk=1, binding=BIND):
    return encrypt_field(value, table="card_secrets", column=column, pk=pk, binding=binding)


def _dec(blob, column="pan_encrypted", pk=1, binding=BIND):
    return decrypt_field(blob, table="card_secrets", column=column, pk=pk, binding=binding)


def test_ciphertext_is_not_plaintext(client, auth_headers, db_session):
    card = _make_card(client, auth_headers)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)

    row = db_session.get(CardSecret, card["id"])
    assert VISA.encode() not in row.pan_encrypted
    assert b"829" not in row.cvv_encrypted
    assert b"ALEX RIVERA" not in row.holder_encrypted
    assert row.version == 1
    assert row.pan_length == 16


def test_encryption_is_randomized():
    assert _enc() != _enc()


def test_aad_binds_ciphertext_to_its_row():
    blob = _enc()
    assert _dec(blob) == "4242424242424242"
    with pytest.raises(VaultDecryptionError):
        _dec(blob, pk=2)


def test_aad_binds_ciphertext_to_its_column():
    blob = _enc("829", column="cvv_encrypted")
    with pytest.raises(VaultDecryptionError):
        _dec(blob, column="pan_encrypted")


def test_aad_binds_to_card_identity_not_just_the_id():
    """`cards.id` is a rowid alias, so SQLite reuses the ids of deleted rows.

    A card_secrets row orphaned by a delete that skipped the FK cascade could
    otherwise be inherited by whoever next got that id — across user accounts.
    Binding the card's immutable created_at makes it fail closed instead.
    """
    blob = _enc()
    with pytest.raises(VaultDecryptionError):
        _dec(blob, binding="2026-06-06T12:00:00+00:00")


def test_recycled_card_id_cannot_read_the_orphaned_row(client, auth_headers, db_session):
    card = _make_card(client, auth_headers)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)

    # Orphan the row the way the sqlite3 CLI would (it starts foreign_keys=OFF),
    # then hand the id to a different card.
    from sqlalchemy import text as _text

    db_session.execute(_text("PRAGMA foreign_keys=OFF"))
    db_session.execute(_text("DELETE FROM cards WHERE id = :i"), {"i": card["id"]})
    db_session.commit()
    db_session.execute(_text("PRAGMA foreign_keys=ON"))

    fresh = _make_card(client, auth_headers, name="Someone Else's Card")
    assert fresh["id"] == card["id"], "expected SQLite to recycle the rowid"

    r = client.post(f"/api/card-secrets/{fresh['id']}/reveal", headers=auth_headers)
    assert r.status_code == 400
    assert VISA not in r.text


def test_tampered_ciphertext_is_rejected():
    blob = bytearray(_enc())
    blob[-1] ^= 0x01
    with pytest.raises(VaultDecryptionError):
        _dec(bytes(blob))


def test_unsupported_version_reported_before_truncation():
    blob = bytearray(_enc())
    blob[0] = 2
    with pytest.raises(VaultDecryptionError, match="unsupported format version"):
        _dec(bytes(blob))
    with pytest.raises(VaultDecryptionError, match="unsupported format version"):
        _dec(bytes([2, 3, 4]))


def test_decrypt_none_returns_none():
    assert _dec(None, column="cvv_encrypted") is None


def test_undecryptable_row_surfaces_as_400(client, auth_headers, db_session):
    """The realistic cause is a backup restored without /data/.encryption_key.
    The user needs an actionable message, not a 500."""
    card = _make_card(client, auth_headers)
    client.put(f"/api/card-secrets/{card['id']}", json=_secret_payload(), headers=auth_headers)

    row = db_session.get(CardSecret, card["id"])
    row.pan_encrypted = _enc(pk=card["id"] + 999)
    db_session.commit()

    r = client.post(f"/api/card-secrets/{card['id']}/reveal", headers=auth_headers)
    assert r.status_code == 400
    assert "encryption_key" in r.text


def test_vault_key_differs_from_oauth_key():
    """HKDF separation: the card vault must not share the OAuth secret key."""
    from app.services.card_vault_crypto import _vault_key
    from app.services.crypto import root_key_material

    assert _vault_key() != root_key_material()
    assert len(_vault_key()) == 32
