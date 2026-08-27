import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useAppStore } from "@/hooks/use-app-store";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Get the user's configured timezone (IANA string) or undefined for browser default. */
export function getTimezone(): string | undefined {
  const tz = useAppStore.getState().timezone;
  return tz || undefined;
}

/** Get "today" as a Date in the user's configured timezone. */
export function getToday(): Date {
  const tz = getTimezone();
  if (!tz) return new Date();
  // Parse the current date in the target timezone
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  // Parse via UTC then construct local Date to avoid browser date-string ambiguity
  const d = new Date(parts + "T00:00:00Z");
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Parse a date-only string (e.g. "2024-01-15") into a Date at local midnight.
 *
 * We parse via UTC first to avoid browser date-string ambiguity, then construct
 * a local Date with the same year/month/day. This keeps dates aligned with
 * date-fns calendar functions (isSameDay, startOfMonth, etc.) which use local time.
 */
export function parseDateStr(dateStr: string): Date {
  const d = new Date(dateStr + "T00:00:00Z");
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Format a local Date as a "YYYY-MM-DD" string (inverse of parseDateStr).
 * Uses local getters so it never round-trips through UTC (which would shift the
 * day for users west of UTC). */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add whole months to a date, clamping day-overflow to the last day of the
 * intended month (e.g. Jan 31 + 1mo -> Feb 28/29), matching the backend's
 * dateutil.relativedelta semantics. */
export function addMonthsClamped(d: Date, months: number): Date {
  const targetMonth = d.getMonth() + months;
  const result = new Date(d.getFullYear(), targetMonth, d.getDate());
  const intendedMonth = ((targetMonth % 12) + 12) % 12;
  if (result.getMonth() !== intendedMonth) {
    // Day overflowed into the next month — snap to the last day of the target.
    return new Date(result.getFullYear(), result.getMonth(), 0);
  }
  return result;
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  // Locale is pinned for the same reason formatDate pins it twelve lines above:
  // on a de-DE browser `toLocaleString()` renders 1199 as "1.199", which next to
  // a "$" reads as one dollar and change. The sign goes before the symbol —
  // "$-550" is not how a negative amount is written, and two components had
  // already reimplemented this helper privately just to get that right.
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toLocaleString("en-US")}`;
}

export function parseIntStrict(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (isNaN(num) || !Number.isInteger(num)) return null;
  return num;
}

/**
 * Parse a whole-dollar money field, distinguishing "cleared" from "invalid".
 *
 * `parseIntStrict` returns null for both an empty field and a non-integer like
 * "550.5" — and "550.5" is truthy — so treating that null as "the user cleared
 * the field" silently wiped the annual fee (and with it annual_fee_date) while
 * toasting "Card updated". Money is tracked in whole dollars; a parse failure is
 * a validation error, never a clear.
 *
 * Thousands separators, a currency symbol and stray spaces are stripped because
 * people paste "$4,000" — `Number("4,000")` is NaN, which was the same silent
 * wipe by another route.
 *
 * Returns null ONLY for a genuinely empty field; throws for anything
 * unparseable, so the caller's catch can toast the reason.
 */
export function parseMoneyField(raw: string, label: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null; // explicitly cleared
  const normalized = trimmed.replace(/[$,\s]/g, "");
  const num = Number(normalized);
  if (!normalized || !Number.isInteger(num)) {
    throw new Error(`${label} must be a whole dollar amount`);
  }
  return num;
}
