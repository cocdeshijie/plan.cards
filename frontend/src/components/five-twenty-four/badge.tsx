"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { get524 } from "@/lib/api";
import type { FiveTwentyFourData } from "@/types";
import { formatDate } from "@/lib/utils";

export function FiveTwentyFourBadge({ profileId }: { profileId: number }) {
  const [data, setData] = useState<FiveTwentyFourData | null>(null);

  useEffect(() => {
    get524(profileId).then(setData).catch(() => {});
  }, [profileId]);

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
          {data.dropoff_dates.map((d) => (
            <p key={d.card_id}>
              {d.card_name}: drops off {formatDate(d.dropoff_date)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
