"use client";

import { useMemo, useState } from "react";
import { ChevronRight, DollarSign } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, parseDateStr } from "@/lib/utils";
import type { Card, Profile } from "@/types";

interface CardFeeBreakdown {
  cardId: number;
  cardName: string;
  issuer: string;
  lastDigits: string | null;
  cardType: "personal" | "business";
  profileName: string;
  net: number;
  posted: number;
  refunded: number;
}

interface YearBreakdown {
  year: number;
  total: number;
  personal: number;
  business: number;
  cards: CardFeeBreakdown[];
}

function computeYearBreakdowns(
  cards: Card[],
  profilesById: Map<number, Profile>,
): YearBreakdown[] {
  const byYear = new Map<number, Map<number, CardFeeBreakdown>>();

  for (const card of cards) {
    for (const ev of card.events) {
      if (ev.event_type !== "annual_fee_posted" && ev.event_type !== "annual_fee_refund") continue;
      const raw = (ev.metadata_json as Record<string, unknown> | null)?.annual_fee;
      if (raw == null) continue;
      const fee = Number(raw);
      if (isNaN(fee)) continue;

      const year = parseDateStr(ev.event_date).getFullYear();
      const signed = ev.event_type === "annual_fee_refund" ? -Math.abs(fee) : fee;

      let yearMap = byYear.get(year);
      if (!yearMap) {
        yearMap = new Map();
        byYear.set(year, yearMap);
      }
      let entry = yearMap.get(card.id);
      if (!entry) {
        entry = {
          cardId: card.id,
          cardName: card.card_name,
          issuer: card.issuer,
          lastDigits: card.last_digits,
          cardType: card.card_type,
          profileName: profilesById.get(card.profile_id)?.name ?? "",
          net: 0,
          posted: 0,
          refunded: 0,
        };
        yearMap.set(card.id, entry);
      }
      entry.net += signed;
      if (ev.event_type === "annual_fee_posted") entry.posted += fee;
      else entry.refunded += Math.abs(fee);
    }
  }

  const result: YearBreakdown[] = [];
  for (const [year, map] of byYear) {
    let total = 0;
    let personal = 0;
    let business = 0;
    const cardsArr: CardFeeBreakdown[] = [];
    for (const entry of map.values()) {
      total += entry.net;
      if (entry.cardType === "business") business += entry.net;
      else personal += entry.net;
      cardsArr.push(entry);
    }
    cardsArr.sort((a, b) => b.net - a.net || a.cardName.localeCompare(b.cardName));
    result.push({ year, total, personal, business, cards: cardsArr });
  }
  result.sort((a, b) => b.year - a.year);
  return result;
}

function fmt(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString()}`;
}

export function PastFeesDialog({
  open,
  onOpenChange,
  cards,
  profiles,
  selectedProfileId,
  onCardClick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cards: Card[];
  profiles: Profile[];
  selectedProfileId: string;
  onCardClick?: (cardId: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { years, grandTotal, scopeLabel, showProfileOnRow } = useMemo(() => {
    const profilesById = new Map(profiles.map((p) => [p.id, p]));
    const filtered =
      selectedProfileId === "all"
        ? cards
        : cards.filter((c) => c.profile_id === parseInt(selectedProfileId));
    const ys = computeYearBreakdowns(filtered, profilesById);
    const grand = ys.reduce((s, y) => s + y.total, 0);

    let label = "All profiles";
    if (selectedProfileId !== "all") {
      const p = profilesById.get(parseInt(selectedProfileId));
      label = p?.name ?? "Selected profile";
    }
    const profileIds = new Set(filtered.map((c) => c.profile_id));
    return {
      years: ys,
      grandTotal: grand,
      scopeLabel: label,
      showProfileOnRow: selectedProfileId === "all" && profileIds.size > 1,
    };
  }, [cards, profiles, selectedProfileId]);

  const toggle = (year: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-4 border-b space-y-1.5">
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-orange-500" />
            Past Annual Fees
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex items-center justify-between text-sm">
              <span className="truncate pr-4">{scopeLabel}</span>
              <span className="text-foreground font-semibold tabular-nums shrink-0">
                Lifetime {fmt(grandTotal)}
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 p-3">
          {years.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-16">
              No annual fees recorded{selectedProfileId !== "all" ? " for this profile" : ""} yet.
            </div>
          ) : (
            <div className="space-y-1.5">
              {years.map((y) => (
                <YearRow
                  key={y.year}
                  year={y}
                  expanded={expanded.has(y.year)}
                  onToggle={() => toggle(y.year)}
                  showProfile={showProfileOnRow}
                  onCardClick={onCardClick}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function YearRow({
  year,
  expanded,
  onToggle,
  showProfile,
  onCardClick,
}: {
  year: YearBreakdown;
  expanded: boolean;
  onToggle: () => void;
  showProfile: boolean;
  onCardClick?: (cardId: number) => void;
}) {
  const hasPersonal = year.personal !== 0;
  const hasBusiness = year.business !== 0;

  return (
    <div className="rounded-lg border bg-card/40 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/60 transition-colors text-left"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform shrink-0",
            expanded && "rotate-90",
          )}
        />
        <div className="flex-1 min-w-0 flex items-baseline gap-3 flex-wrap">
          <span className="font-semibold text-base tabular-nums">{year.year}</span>
          <span className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            {hasPersonal && (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Personal <span className="tabular-nums">{fmt(year.personal)}</span>
              </span>
            )}
            {hasBusiness && (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                Business <span className="tabular-nums">{fmt(year.business)}</span>
              </span>
            )}
          </span>
        </div>
        <span className="font-semibold tabular-nums shrink-0">{fmt(year.total)}</span>
      </button>
      {expanded && (
        <div className="border-t divide-y">
          {year.cards.map((c) => {
            const clickable = !!onCardClick;
            const inner = (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-medium">{c.cardName}</span>
                    {c.lastDigits && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        ··{c.lastDigits}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap mt-0.5">
                    <span>{c.issuer}</span>
                    <span className="text-muted-foreground/50">·</span>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-medium",
                        c.cardType === "business"
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          : "bg-green-500/10 text-green-600 dark:text-green-400",
                      )}
                    >
                      {c.cardType === "business" ? "Business" : "Personal"}
                    </span>
                    {showProfile && c.profileName && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span>{c.profileName}</span>
                      </>
                    )}
                    {c.refunded > 0 && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span className="text-orange-600 dark:text-orange-400">
                          refund −${c.refunded.toLocaleString()}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <span
                  className={cn(
                    "tabular-nums text-sm font-semibold shrink-0 mt-0.5",
                    c.net < 0 && "text-green-600 dark:text-green-500",
                    c.net === 0 && "text-muted-foreground",
                  )}
                >
                  {fmt(c.net)}
                </span>
              </>
            );
            return clickable ? (
              <button
                key={c.cardId}
                type="button"
                onClick={() => onCardClick!(c.cardId)}
                className="w-full flex items-start gap-3 px-4 py-2.5 text-sm hover:bg-accent/60 transition-colors text-left"
              >
                {inner}
              </button>
            ) : (
              <div key={c.cardId} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
