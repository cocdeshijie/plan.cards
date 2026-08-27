"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/hooks/use-app-store";
import { get524 } from "@/lib/api";
import type { FiveTwentyFourData } from "@/types";
import { formatDate } from "@/lib/utils";
import { maskLastDigits } from "@/lib/card-number";

export function FiveTwentyFourBadge({ profileId }: { profileId: number }) {
  const { cards } = useAppStore();
  const [data, setData] = useState<FiveTwentyFourData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** Guards against a slow response for a profile the user has already left. */
  const reqRef = useRef(0);

  const load = useCallback(
    async (showLoading: boolean) => {
      const req = ++reqRef.current;
      if (showLoading) setLoading(true);
      try {
        const next = await get524(profileId);
        if (reqRef.current !== req) return;
        setData(next);
        setFailed(false);
      } catch {
        if (reqRef.current !== req) return;
        setFailed(true);
      } finally {
        if (reqRef.current === req) setLoading(false);
      }
    },
    [profileId],
  );

  // Mount and every profile switch. The previous profile's count is dropped on
  // the way out — it belongs to a different person, so holding it under the new
  // header would be worse than a skeleton.
  useEffect(() => {
    setData(null);
    setFailed(false);
    load(true);
  }, [load]);

  // The count is server-side math over this profile's cards, so adding, closing
  // or deleting one invalidates it — and this badge only refetched on a profile
  // switch, so the headline number stayed stale until a reload. Skip the first
  // run: the effect above already covers mount.
  const cardsSettled = useRef(false);
  useEffect(() => {
    if (!cardsSettled.current) {
      cardsSettled.current = true;
      return;
    }
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  // Hold the badge's slot rather than rendering nothing: this sits in the
  // /cards header above the whole grid, so appearing late shoved the page down
  // mid-interaction.
  if (loading && !data) {
    return (
      <div className="flex items-center gap-2" role="status" aria-label="Loading Chase 5/24 status">
        <div className="h-8 w-16 rounded-full bg-muted animate-pulse" />
        <span className="text-sm text-muted-foreground">Chase 5/24 Status</span>
      </div>
    );
  }

  // A failed fetch used to be indistinguishable from "no data" — the badge just
  // never appeared.
  if (failed && !data) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed p-3">
        <p className="text-sm text-danger">Couldn&apos;t load Chase 5/24 status.</p>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => load(true)}>
          Try again
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const variant = data.status === "green" ? "success" : data.status === "yellow" ? "warning" : "destructive";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant={variant} className="text-base px-3 py-1">
          {data.count}/24
        </Badge>
        <span className="text-sm text-muted-foreground">Chase 5/24 Status</span>
      </div>
      {data.dropoff_dates.length > 0 && (
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-medium">Drop-off dates:</p>
          {data.dropoff_dates.map((d) => {
            // Two "Chase Freedom Unlimited" rows are otherwise indistinguishable,
            // which is exactly the situation 5/24 tracking puts people in.
            const mask = maskLastDigits(d.last_digits);
            return (
              <p key={d.card_id}>
                {d.card_name}
                {mask && <span className="opacity-60"> {mask}</span>}: drops off {formatDate(d.dropoff_date)}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
