"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/hooks/use-app-store";

/** Reactive timezone — re-renders component when timezone changes. */
export function useTimezone(): string | undefined {
  const tz = useAppStore((s) => s.timezone);
  return tz || undefined;
}

/** Reactive "today" — re-renders component when timezone changes and at midnight. */
export function useToday(): Date {
  const tz = useTimezone();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const now = new Date();
    // The date below is derived in `tz`, so the rollover has to be `tz`'s
    // midnight too. Using the browser's meant that with tz=Tokyo on a US
    // machine "today" stayed a day stale for ~16 hours — the Timeline's Today
    // marker, the calendar ring, the "Nd left" counts and every overdue colour.
    const timer = setTimeout(
      () => setTick((t) => t + 1),
      msUntilMidnightIn(tz, now) + 100, // +100ms buffer
    );
    return () => clearTimeout(timer);
  }, [tz, tick]);

  return useMemo(() => {
    // Must be midnight, not "now". Every caller compares this against
    // parseDateStr() values, which are local midnight — returning the current
    // time of day makes `afDate >= today` false for a fee due today (dropped
    // from the timeline all day), `today > deadline` true for a deadline due
    // today (renders a red "Past Due"), and pushes a cardiversary that falls
    // today a full year out.
    if (!tz) {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    // Parse via UTC then construct local Date to avoid browser date-string ambiguity
    const d = new Date(parts + "T00:00:00Z");
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tz, tick]);
}

/**
 * Milliseconds until the next midnight in `tz` (the browser's when unset).
 *
 * Assumes a 24-hour day, so on a DST transition day in `tz` this can be an hour
 * early or an hour late. That self-corrects: an early tick recomputes the same
 * date and re-arms for the remainder, and an hour of staleness once or twice a
 * year is not the bug being fixed here.
 */
function msUntilMidnightIn(tz: string | undefined, now: Date): number {
  const DAY_MS = 86_400_000;
  if (!tz) {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Some ICU builds report midnight as hour 24 with hour12:false.
  const hour = part("hour") % 24;
  const elapsed =
    (hour * 3600 + part("minute") * 60 + part("second")) * 1000 + now.getMilliseconds();
  const remaining = DAY_MS - elapsed;
  // Never schedule a zero/negative timeout: an invalid timezone string throws
  // above, but a clock skew here would otherwise spin the tick counter.
  return remaining > 0 ? remaining : DAY_MS;
}
