"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { Badge } from "@/components/ui/badge";
import { get524 } from "@/lib/api";
import type { FiveTwentyFourData } from "@/types";
import { formatDate } from "@/lib/utils";
import { Shield } from "lucide-react";

interface ProfileRow {
  profileId: number;
  profileName: string;
  data: FiveTwentyFourData;
}

export function FiveTwentyFourWidget() {
  const { profiles, selectedProfileId } = useAppStore();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
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
        setRows(results.filter((r): r is ProfileRow => r !== null));
      } finally {
        setLoading(false);
      }
    }
    if (profiles.length > 0) load();
    else setLoading(false);
  }, [profiles, selectedProfileId]);

  const variant = (status: string) =>
    status === "green" ? "success" : status === "yellow" ? "warning" : "destructive";

  return (
    <div className="bg-card rounded-xl border p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-blue-500" />
        <h2 className="font-semibold">Chase 5/24</h2>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No profiles to show. Create a profile first.</p>
      ) : (
        <div className="space-y-4">
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
                  {row.data.dropoff_dates.map((d) => (
                    <p key={d.card_id}>
                      {d.card_name}: drops off {formatDate(d.dropoff_date)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
