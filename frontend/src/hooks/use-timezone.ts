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
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime() + 100; // +100ms buffer
    const timer = setTimeout(() => setTick((t) => t + 1), msUntilMidnight);
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
