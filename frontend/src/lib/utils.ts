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
  return new Date(parts + "T00:00:00");
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

export function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return "—";
  return `$${amount.toLocaleString()}`;
}

export function parseIntStrict(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (isNaN(num) || !Number.isInteger(num)) return null;
  return num;
}
