/**
 * Card number helpers for the details entry form.
 *
 * This mirrors backend/app/utils/card_number.py. The duplication is deliberate
 * and minimal: the form needs to group digits and relabel the security code
 * live as you type, which cannot round-trip to the server on every keystroke.
 * Everything displayed for an already-saved card comes from the API instead, so
 * the backend stays the single source of truth for stored values.
 *
 * No BIN database — the free datasets are unattributed scrapes and the
 * authoritative range files are only distributed to registered acquirers. About
 * forty prefix ranges cover every network a personal card tracker will meet.
 */

export type CardNetwork =
  | "Amex"
  | "Diners"
  | "JCB"
  | "Visa"
  | "Mastercard"
  | "Discover"
  | "UnionPay";

export const KNOWN_NETWORKS: CardNetwork[] = [
  "Visa",
  "Mastercard",
  "Amex",
  "Discover",
  "Diners",
  "JCB",
  "UnionPay",
];

/** Display grouping. Amex is 4-6-5 and Diners 4-6-4; everything else 4-4-4-4.
 *  Diners also issues 16-digit numbers (the Discover co-branded ranges), and
 *  those group 4-4-4-4 like every other 16-digit PAN — see groupsFor. */
const GROUPS: Partial<Record<CardNetwork, number[]>> = {
  Amex: [4, 6, 5],
  Diners: [4, 6, 4],
};
const DEFAULT_GROUPS = [4, 4, 4, 4];

const LENGTHS: Record<CardNetwork, number[]> = {
  Amex: [15],
  Diners: [14, 16],
  JCB: [16, 17, 18, 19],
  Visa: [13, 16, 19],
  Mastercard: [16],
  Discover: [16, 17, 18, 19],
  UnionPay: [16, 17, 18, 19],
};

/**
 * Security code label and length. Amex calls it CID and prints four digits on
 * the FRONT of the card; Discover also says "CID" but means three on the back.
 */
const CODE: Record<CardNetwork, { label: string; length: number }> = {
  Amex: { label: "CID", length: 4 },
  Diners: { label: "CVV", length: 3 },
  JCB: { label: "CAV2", length: 3 },
  Visa: { label: "CVV2", length: 3 },
  Mastercard: { label: "CVC2", length: 3 },
  Discover: { label: "CID", length: 3 },
  UnionPay: { label: "CVN2", length: 3 },
};

export const MIN_PAN_LENGTH = 12;
export const MAX_PAN_LENGTH = 19;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** ISO/IEC 7812-1 Annex B check digit, universal across every live network. */
export function luhnValid(digits: string): boolean {
  if (digits.length < MIN_PAN_LENGTH) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Best-guess network from the leading digits, or null.
 *
 * Order is load-bearing — the most specific prefix must win:
 *   - Discover's co-branded 622126–622925 sits inside UnionPay's `62`.
 *   - Mastercard's 2-series is 2221–2720, not all of 2xxxxx.
 *   - Diners `36`/`38`/`39` and JCB `3528–3589` both start with 3.
 *
 * Always an overridable default, never a verdict: cards are genuinely
 * co-badged, and the person holding one knows better than the prefix does.
 */
export function detectNetwork(digits: string): CardNetwork | null {
  if (!digits) return null;

  const p2 = digits.slice(0, 2);
  const p3 = digits.slice(0, 3);
  const p4 = digits.slice(0, 4);

  if (p2 === "34" || p2 === "37") return "Amex";

  if (["300", "301", "302", "303", "304", "305"].includes(p3) || p4 === "3095") return "Diners";
  if (p2 === "36" || p2 === "38" || p2 === "39") return "Diners";

  if (p2 === "35") {
    if (digits.length < 4) return "JCB";
    const n = parseInt(p4, 10);
    return n >= 3528 && n <= 3589 ? "JCB" : null;
  }

  if (digits[0] === "4") return "Visa";

  if (["51", "52", "53", "54", "55"].includes(p2)) return "Mastercard";

  if (digits[0] === "2") {
    // Compare widest and narrowest completions so a partial prefix still
    // resolves while the user is mid-type.
    const low = parseInt(p4.padEnd(4, "0"), 10);
    const high = parseInt(p4.padEnd(4, "9"), 10);
    return high >= 2221 && low <= 2720 ? "Mastercard" : null;
  }

  if (p3 === "622" && digits.length >= 6) {
    const n = parseInt(digits.slice(0, 6), 10);
    if (n >= 622126 && n <= 622925) return "Discover";
  }
  if (p4 === "6011" || p2 === "65" || ["644", "645", "646", "647", "648", "649"].includes(p3)) {
    return "Discover";
  }

  if (p2 === "62" || p2 === "81") return "UnionPay";

  return null;
}

/**
 * Grouping for a network, narrowed by how many digits there actually are.
 *
 * `digitCount` matters for Diners alone: LENGTHS.Diners accepts 14 and 16, but
 * the 4-6-4 grouping consumes only 14, so a valid 16-digit card rendered
 * "3055 123456 7890 12" with a dangling pair. Sixteen digits are grouped like
 * every other 16-digit PAN. Omitting the argument keeps the 14-digit shape.
 */
export function groupsFor(network: CardNetwork | null, digitCount?: number): number[] {
  if (network === "Diners" && digitCount !== undefined && digitCount > 14) return DEFAULT_GROUPS;
  return (network && GROUPS[network]) || DEFAULT_GROUPS;
}

/** Group digits for display: "3782 822463 10005" for Amex. */
export function formatPan(digits: string, network: CardNetwork | null): string {
  const out: string[] = [];
  let i = 0;
  for (const size of groupsFor(network, digits.length)) {
    if (i >= digits.length) break;
    out.push(digits.slice(i, i + size));
    i += size;
  }
  if (i < digits.length) out.push(digits.slice(i));
  return out.join(" ");
}

/** How many trailing digits identify the card. Amex holders use five. */
export function lastDigitsCount(network: CardNetwork | null): number {
  return network === "Amex" ? 5 : 4;
}

export function maxPanLength(network: CardNetwork | null): number {
  if (!network) return MAX_PAN_LENGTH;
  return Math.max(...LENGTHS[network]);
}

export function validLengths(network: CardNetwork | null): number[] {
  if (!network) return [];
  return LENGTHS[network];
}

export function lengthValid(digits: string, network: CardNetwork | null): boolean {
  if (!network) return digits.length >= MIN_PAN_LENGTH && digits.length <= MAX_PAN_LENGTH;
  return LENGTHS[network].includes(digits.length);
}

export function codeLabel(network: CardNetwork | null): string {
  return network ? CODE[network].label : "CVV";
}

export function codeLength(network: CardNetwork | null): number {
  return network ? CODE[network].length : 3;
}

/** Masked form used before the API has returned one. Trailing group only.
 *  `panLength` disambiguates Diners, which issues both 14- and 16-digit
 *  numbers; without it the 14-digit shape is assumed, as before. */
export function maskPan(
  network: CardNetwork | null,
  lastDigits: string,
  panLength?: number,
): string {
  const groups = groupsFor(network, panLength);
  const masked = groups.slice(0, -1).map((size) => "•".repeat(size));
  return [...masked, lastDigits].join(" ");
}

/**
 * The short "••• 1234" tag shown next to a card name in lists.
 *
 * One helper because the bullet count had drifted to two, three and four across
 * eight views. Returns "" when there are no digits, so it is safe to
 * interpolate unguarded.
 */
export function maskLastDigits(lastDigits: string | null | undefined): string {
  if (!lastDigits) return "";
  return `••• ${lastDigits}`;
}
