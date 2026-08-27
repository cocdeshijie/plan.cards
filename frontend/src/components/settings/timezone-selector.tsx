"use client";

import { toast } from "sonner";
import { useAppStore } from "@/hooks/use-app-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Globe } from "lucide-react";

const TIMEZONE_OPTIONS = [
  // US & Canada
  { label: "Eastern (ET)", value: "America/New_York" },
  { label: "Central (CT)", value: "America/Chicago" },
  { label: "Mountain (MT)", value: "America/Denver" },
  { label: "Pacific (PT)", value: "America/Los_Angeles" },
  { label: "Alaska (AKT)", value: "America/Anchorage" },
  { label: "Hawaii (HT)", value: "Pacific/Honolulu" },
  // Americas
  { label: "São Paulo (BRT)", value: "America/Sao_Paulo" },
  // Europe & Africa
  { label: "UTC", value: "UTC" },
  { label: "London (GMT/BST)", value: "Europe/London" },
  { label: "Paris (CET)", value: "Europe/Paris" },
  { label: "Berlin (CET)", value: "Europe/Berlin" },
  { label: "Moscow (MSK)", value: "Europe/Moscow" },
  // Middle East
  { label: "Dubai (GST)", value: "Asia/Dubai" },
  // South Asia
  { label: "India (IST)", value: "Asia/Kolkata" },
  // Southeast Asia
  { label: "Bangkok (ICT)", value: "Asia/Bangkok" },
  { label: "Jakarta (WIB)", value: "Asia/Jakarta" },
  { label: "Singapore (SGT)", value: "Asia/Singapore" },
  // East Asia
  { label: "Hong Kong (HKT)", value: "Asia/Hong_Kong" },
  { label: "Beijing (CST)", value: "Asia/Shanghai" },
  { label: "Seoul (KST)", value: "Asia/Seoul" },
  { label: "Tokyo (JST)", value: "Asia/Tokyo" },
  // Oceania
  { label: "Sydney (AEST)", value: "Australia/Sydney" },
  { label: "Auckland (NZST)", value: "Pacific/Auckland" },
];

export function TimezoneSelector() {
  const { timezone, serverTimezone, setTimezone } = useAppStore();

  const serverLabel = serverTimezone
    ? `Server Default (${serverTimezone})`
    : "Server Default";

  // The trigger is a fixed 180px in a crowded toolbar, so the selected label is
  // clipped rather than allowed to overflow into the chevron — which means the
  // full string has to stay recoverable somewhere. `server_timezone` is always
  // populated, so the clipped case is the *default* state, not an edge case.
  const currentLabel = timezone
    ? TIMEZONE_OPTIONS.find((tz) => tz.value === timezone)?.label ?? timezone
    : serverLabel;

  const handleChange = (value: string) => {
    // setTimezone rolls back optimistically and re-throws so the caller can
    // report it. Fire-and-forget produced an uncaught rejection, the dropdown
    // silently snapping back, and no message at all.
    setTimezone(value === "default" ? "" : value).catch((e) => {
      toast.error(e instanceof Error ? e.message : "Failed to update timezone");
    });
  };

  return (
    <Select value={timezone || "default"} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px] max-w-full h-9" aria-label="Timezone" title={currentLabel}>
        {/* SelectTrigger's own `[&>span]:line-clamp-1 [&>span]:min-w-0` only
            reaches DIRECT span children, and this wrapper div sits between it
            and SelectValue — so the clamp has to be re-declared here, plus
            min-w-0 on the wrapper itself so it can shrink below its content. */}
        <div className="flex min-w-0 items-center gap-1.5 [&>span]:min-w-0 [&>span]:truncate">
          <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <SelectValue placeholder="Timezone" />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">{serverLabel}</SelectItem>
        {TIMEZONE_OPTIONS.map((tz) => (
          <SelectItem key={tz.value} value={tz.value}>
            {tz.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
