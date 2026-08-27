"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { get524 } from "@/lib/api";
import type { FiveTwentyFourData } from "@/types";
import { formatDate } from "@/lib/utils";
import { maskLastDigits } from "@/lib/card-number";
import { Shield } from "lucide-react";

interface ProfileRow {
  profileId: number;
  profileName: string;
  data: FiveTwentyFourData;
}

interface FiveTwentyFourWidgetProps {
  onCardClick?: (cardId: number) => void;
}

export function FiveTwentyFourWidget({ onCardClick }: FiveTwentyFourWidgetProps) {
  const { cards, profiles, selectedProfileId } = useAppStore();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  /** Profiles whose fetch rejected. Tracked separately from `rows` because the
   *  per-profile catch returns null and the nulls are filtered out — so an
   *  outage used to arrive here as an empty list and get reported as
   *  "Create a profile first." */
  const [failedCount, setFailedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  /** Guards against a slower earlier fetch landing on top of a newer one. */
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const targetProfiles =
        selectedProfileId === "all"
          ? profiles
          : profiles.filter((p) => p.id === parseInt(selectedProfileId));

      const results = await Promise.all(
        targetProfiles.map(async (p) => {
          try {
            const data = await get524(p.id);
            return { profileId: p.id, profileName: p.name, data };
          } catch {
            return null;
          }
        })
      );
      if (reqRef.current !== req) return;
      setRows(results.filter((r): r is ProfileRow => r !== null));
      setFailedCount(results.filter((r) => r === null).length);
      hasLoadedRef.current = true;
    } finally {
      if (reqRef.current === req) setLoading(false);
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (profiles.length > 0) {
      load();
    } else {
      setRows([]);
      setFailedCount(0);
      setLoading(false);
    }
  }, [load, profiles.length]);

  // 5/24 counts personal cards opened in the last 24 months, so opening,
  // deleting or re-dating one changes the answer — but the effect above only
  // re-runs when `profiles` changes identity, which a card edit never does, so
  // the headline number stayed stale until a hard reload. Skip the first run:
  // the effect above already covers mount.
  const cardsSettled = useRef(false);
  useEffect(() => {
    if (!cardsSettled.current) {
      cardsSettled.current = true;
      return;
    }
    if (profiles.length > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  const variant = (status: string) =>
    status === "green" ? "success" : status === "yellow" ? "warning" : "destructive";

  /** Profiles we actually asked about, whether or not the answer arrived. */
  const targetCount = rows.length + failedCount;

  return (
    <div className="bg-card rounded-xl border p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-blue-500" />
        <h2 className="font-semibold">Chase 5/24</h2>
      </div>

      {loading ? (
        // Shaped like one loaded profile row — a name, its count badge and two
        // drop-off lines. The old placeholder drew a 64px circle that appears
        // nowhere in the loaded widget, so the panel collapsed on arrival.
        <div className="space-y-2" role="status" aria-label="Loading Chase 5/24 status">
          <div className="flex items-center gap-2">
            <div className="h-4 w-24 rounded bg-muted animate-pulse" />
            <div className="h-5 w-12 rounded-full bg-muted animate-pulse" />
          </div>
          <div className="space-y-1 pl-1">
            <div className="h-3 w-48 rounded bg-muted animate-pulse" />
            <div className="h-3 w-40 rounded bg-muted animate-pulse" />
          </div>
        </div>
      ) : rows.length === 0 && failedCount > 0 ? (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="text-sm text-danger">Couldn&apos;t load Chase 5/24 status.</p>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => {
              // Clearing the ref puts the skeleton back, so an explicit retry
              // shows something happening. Background refetches still don't.
              hasLoadedRef.current = false;
              load();
            }}
          >
            Try again
          </Button>
        </div>
      ) : targetCount === 0 ? (
        <p className="text-sm text-muted-foreground">No profiles to show. Create a profile first.</p>
      ) : (
        <div className="space-y-4">
          {failedCount > 0 && (
            <p className="text-xs text-danger">
              {failedCount} profile{failedCount === 1 ? "" : "s"} couldn&apos;t be loaded.
            </p>
          )}
          {rows.map((row) => (
            <div key={row.profileId} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{row.profileName}</span>
                <Badge variant={variant(row.data.status)} className="text-xs">
                  {row.data.count}/24
                </Badge>
              </div>
              {row.data.dropoff_dates.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-0.5 pl-1">
                  {row.data.dropoff_dates.map((d) => {
                    const mask = maskLastDigits(d.last_digits);
                    return (
                      <p key={d.card_id}>
                        <button
                          onClick={() => onCardClick?.(d.card_id)}
                          className="hover:underline hover:text-primary transition-colors text-left"
                        >
                          {d.card_name}{mask && <span className="opacity-60"> {mask}</span>}
                        </button>: drops off {formatDate(d.dropoff_date)}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
