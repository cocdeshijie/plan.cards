"""Card number validation and network detection from the IIN prefix.

No BIN database. Every freely available dataset is a scrape of unstated
provenance -- the most-cited one has been archived since 2020 and carries no PAN
length field -- while the networks distribute authoritative range files only to
registered acquirers under contract. Around forty hardcoded prefix ranges cover
every network a personal card tracker will meet, and they change on a timescale
of years.

Ranges reconciled across Braintree's credit-card-type, Stripe's production BIN
table, and Discover's own IIN compliance table.
"""

# Display grouping per network. Amex is 4-6-5 and Diners 4-6-4; everything else
# is 4-4-4-4. Getting Amex wrong is the most visible "this app doesn't know
# cards" tell there is, and Amex holders identify their card by five digits.
NETWORK_GROUPS: dict[str, tuple[int, ...]] = {
    "Amex": (4, 6, 5),
    "Diners": (4, 6, 4),
}
_DEFAULT_GROUPS = (4, 4, 4, 4)

# How many trailing digits identify a card to its holder.
NETWORK_LAST_DIGITS: dict[str, int] = {"Amex": 5}
_DEFAULT_LAST_DIGITS = 4

# Valid total lengths.
NETWORK_LENGTHS: dict[str, tuple[int, ...]] = {
    "Amex": (15,),
    "Diners": (14, 16),
    "JCB": (16, 17, 18, 19),
    "Visa": (13, 16, 19),
    "Mastercard": (16,),
    "Discover": (16, 17, 18, 19),
    "UnionPay": (16, 17, 18, 19),
}

# Security code: label and digit count. Amex calls it CID and prints 4 digits on
# the FRONT; Discover also says "CID" but means 3 digits on the back.
NETWORK_CODE: dict[str, tuple[str, int]] = {
    "Amex": ("CID", 4),
    "Diners": ("CVV", 3),
    "JCB": ("CAV2", 3),
    "Visa": ("CVV2", 3),
    "Mastercard": ("CVC2", 3),
    "Discover": ("CID", 3),
    "UnionPay": ("CVN2", 3),
}

KNOWN_NETWORKS = tuple(NETWORK_LENGTHS.keys())

MIN_PAN_LENGTH = 12
MAX_PAN_LENGTH = 19


def digits_only(value: str) -> str:
    """ASCII 0-9 only.

    Deliberately not `str.isdigit()`, which is True for superscripts (²³),
    circled digits (①) and every non-Latin decimal set (٤٢). Those would pass
    `luhn_valid` — it subtracts 48 from the code point without a range check —
    and then blow up in `int()` inside detect_network, or be stored verbatim as
    a "card number" the frontend could never match (its own digit filter is
    ASCII `\\D`).
    """
    return "".join(ch for ch in value if "0" <= ch <= "9")


# Free-text spellings seen on real cards and in the card templates, mapped to
# the canonical names this module uses. `Card.network` is an unconstrained
# String(50) editable from a free-text field, so it cannot be trusted to match.
_NETWORK_ALIASES = {
    "amex": "Amex",
    "american express": "Amex",
    "americanexpress": "Amex",
    "visa": "Visa",
    "mastercard": "Mastercard",
    "master card": "Mastercard",
    "mc": "Mastercard",
    "discover": "Discover",
    "diners": "Diners",
    "diners club": "Diners",
    "dinersclub": "Diners",
    "jcb": "JCB",
    "unionpay": "UnionPay",
    "union pay": "UnionPay",
    "china unionpay": "UnionPay",
}


def normalize_network(value: str | None) -> str | None:
    """Map a free-text network label onto a canonical name, or None."""
    if not value:
        return None
    return _NETWORK_ALIASES.get(value.strip().lower())


def luhn_valid(digits: str) -> bool:
    """ISO/IEC 7812-1 Annex B check digit. Universal across every live network.

    The only documented exception is Diners Club enRoute, defunct since 1992.
    """
    if len(digits) < MIN_PAN_LENGTH:
        return False
    total = 0
    double = False
    for ch in reversed(digits):
        n = ord(ch) - 48
        if double:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        double = not double
    return total % 10 == 0


def detect_network(digits: str) -> str | None:
    """Best-guess network from the leading digits, or None.

    Order is load-bearing -- longest/most specific prefix must win:
      * Discover's co-branded 622126-622925 sits inside UnionPay's `62`.
      * Mastercard's 2-series is 2221-2720, not all of 2xxxxx.
      * Diners `36`/`38`/`39` and JCB `3528-3589` both start with 3.

    Callers must treat this as an overridable default, never a verdict. Cards are
    genuinely co-badged (JCB and UnionPay both issue Discover-network cards in
    the US), and the person holding the card knows better than the prefix does.
    """
    if not digits:
        return None

    if digits[:2] in ("34", "37"):
        return "Amex"

    if digits[:3] in ("300", "301", "302", "303", "304", "305") or digits[:4] == "3095":
        return "Diners"
    if digits[:2] in ("36", "38", "39"):
        return "Diners"

    if digits[:2] == "35":
        if len(digits) < 4:
            return "JCB"
        if 3528 <= int(digits[:4]) <= 3589:
            return "JCB"
        return None

    if digits[0] == "4":
        return "Visa"

    if digits[:2] in ("51", "52", "53", "54", "55"):
        return "Mastercard"

    if digits[0] == "2":
        # Compare on the widest and narrowest completion so a partial prefix
        # still resolves while the user is mid-type.
        low = int(digits[:4].ljust(4, "0"))
        high = int(digits[:4].ljust(4, "9"))
        if high >= 2221 and low <= 2720:
            return "Mastercard"
        return None

    if digits[:3] == "622" and len(digits) >= 6 and 622126 <= int(digits[:6]) <= 622925:
        return "Discover"
    if digits[:4] == "6011" or digits[:2] == "65" or digits[:3] in ("644", "645", "646", "647", "648", "649"):
        return "Discover"

    if digits[:2] in ("62", "81"):
        return "UnionPay"

    return None


def groups_for(network: str | None, length: int | None = None) -> tuple[int, ...]:
    """Grouping for a network, adjusted for the actual number length.

    Diners is 4-6-4 at 14 digits but 4-4-4-4 at 16 — the 16-digit US/Canada
    range is the one Stripe's own test PAN uses, and applying 4-6-4 to it left
    an orphan trailing pair. Anything longer than its groups sum to (a 19-digit
    Visa or UnionPay) falls back to even fours.
    """
    groups = NETWORK_GROUPS.get(network or "", _DEFAULT_GROUPS)
    if length is None or sum(groups) == length:
        return groups
    # Fours from the left with the remainder last: 19 -> 4-4-4-4-3, 13 -> 4-4-4-1.
    # Padding a fixed (4,4,4,4) with a leftover chunk instead produced a
    # 16-position layout with a stray tail hanging off the end.
    full, rest = divmod(length, 4)
    out = (4,) * full
    return out + (rest,) if rest else out


def last_digits_count(network: str | None) -> int:
    return NETWORK_LAST_DIGITS.get(network or "", _DEFAULT_LAST_DIGITS)


def format_pan(digits: str, network: str | None) -> str:
    """Group digits for display: '3782 822463 10005' for Amex."""
    out: list[str] = []
    i = 0
    for size in groups_for(network, len(digits)):
        if i >= len(digits):
            break
        out.append(digits[i : i + size])
        i += size
    if i < len(digits):
        out.append(digits[i:])
    return " ".join(out)


def mask_pan(network: str | None, last_digits: str, pan_length: int | None) -> str:
    """Masked display form sized to the real number.

    A fixed 16-position mask was wrong for a 15-digit Amex, a 14-digit Diners
    and a 19-digit Visa alike — it either invented digits the card doesn't have
    or hid ones it does. Only the trailing group is ever shown: the check digit
    lives inside it, so revealing a BIN as well would narrow a 16-digit card to
    roughly a thousand Luhn-valid candidates.
    """
    total = pan_length or (sum(groups_for(network)) or 16)
    hidden = max(total - len(last_digits), 0)
    groups = groups_for(network, total)

    out: list[str] = []
    i = 0
    for size in groups:
        if i >= total:
            break
        chunk = "".join("•" if i + n < hidden else last_digits[i + n - hidden] for n in range(min(size, total - i)))
        out.append(chunk)
        i += size
    if i < total:
        out.append("".join("•" if n < hidden else last_digits[n - hidden] for n in range(i, total)))
    return " ".join(out)


def last_digits_for(digits: str, network: str | None) -> str:
    return digits[-last_digits_count(network) :]


def valid_length(digits: str, network: str | None) -> bool:
    """Length check against the detected network, permissive when unknown."""
    lengths = NETWORK_LENGTHS.get(network or "")
    if lengths is None:
        return MIN_PAN_LENGTH <= len(digits) <= MAX_PAN_LENGTH
    return len(digits) in lengths


def code_length(network: str | None) -> int:
    return NETWORK_CODE.get(network or "", ("CVV", 3))[1]


def code_label(network: str | None) -> str:
    return NETWORK_CODE.get(network or "", ("CVV", 3))[0]
