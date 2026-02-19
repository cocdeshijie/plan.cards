"use client";

import { useMemo } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { CreditCard, DollarSign, CalendarDays, Building2, TrendingUp } from "lucide-react";
import { cn, parseDateStr } from "@/lib/utils";
import { getNextFeeInfo } from "@/lib/fee-utils";
import { useToday } from "@/hooks/use-timezone";

export function PortfolioWidget({ className }: { className?: string }) {
  const { cards, selectedProfileId } = useAppStore();
  const today = useToday();

  const stats = useMemo(() => {
    const filtered = selectedProfileId === "all"
      ? cards
      : cards.filter((c) => c.profile_id === parseInt(selectedProfileId));

    const active = filtered.filter((c) => c.status === "active");
    const closed = filtered.filter((c) => c.status === "closed");

    // Lifetime fees: all cards (active + closed)
    const lifetimeFees = filtered.reduce((sum, card) => {
      const cardNet = card.events
        .filter((e) => e.event_type === "annual_fee_posted" || e.event_type === "annual_fee_refund")
        .reduce((s, e) => {
          const fee = (e.metadata_json as Record<string, unknown> | null)?.annual_fee;
          if (fee == null) return s;
          const feeNum = Number(fee);
          if (isNaN(feeNum)) return s;
          return s + (e.event_type === "annual_fee_refund" ? -Math.abs(feeNum) : feeNum);
        }, 0);
      return sum + cardNet;
    }, 0);

    // This year's estimated fees
    const currentYear = today.getFullYear();
    let thisYearFees = 0;

    // 1. Sum fees already posted/refunded this year (all cards)
    const cardsWithThisYearPosted = new Set<number>();
    for (const card of filtered) {
      for (const e of card.events) {
        if (e.event_type !== "annual_fee_posted" && e.event_type !== "annual_fee_refund") continue;
        const eventDate = parseDateStr(e.event_date);
        if (eventDate.getFullYear() !== currentYear) continue;
        const fee = (e.metadata_json as Record<string, unknown> | null)?.annual_fee;
        if (fee == null) continue;
        const feeNum = Number(fee);
        if (isNaN(feeNum)) continue;
        thisYearFees += e.event_type === "annual_fee_refund" ? -Math.abs(feeNum) : feeNum;
        if (e.event_type === "annual_fee_posted") cardsWithThisYearPosted.add(card.id);
      }
    }

    // 2. Add projected fees for active cards whose next fee date is this year but haven't posted yet
    for (const card of active) {
      if (cardsWithThisYearPosted.has(card.id)) continue;
      if (!card.annual_fee || card.annual_fee <= 0) continue;
      const feeInfo = getNextFeeInfo(card.open_date, card.annual_fee, card.status, card.annual_fee_date, today);
      if (feeInfo && feeInfo.nextDate.getFullYear() === currentYear) {
        thisYearFees += card.annual_fee;
      }
    }

    const byIssuer: Record<string, number> = {};
    for (const card of active) {
      byIssuer[card.issuer] = (byIssuer[card.issuer] || 0) + 1;
    }
    const issuerBreakdown = Object.entries(byIssuer)
      .sort((a, b) => b[1] - a[1]);

    return { active: active.length, closed: closed.length, lifetimeFees, thisYearFees, issuerBreakdown };
  }, [cards, selectedProfileId, today]);

  const statCards = [
    { label: "Active Cards", value: stats.active, icon: CreditCard, color: "text-green-500" },
    { label: "Closed Cards", value: stats.closed, icon: TrendingUp, color: "text-muted-foreground" },
    { label: `${today.getFullYear()} Estimated Fees`, value: `$${stats.thisYearFees.toLocaleString()}`, icon: CalendarDays, color: "text-blue-500" },
    { label: "Lifetime Annual Fees", value: `$${stats.lifetimeFees.toLocaleString()}`, icon: DollarSign, color: "text-orange-500" },
  ];

  return (
    <div className={cn("bg-card rounded-xl border p-5 space-y-4", className)}>
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-purple-500" />
        <h2 className="font-semibold">Portfolio Overview</h2>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="text-center space-y-1">
            <s.icon className={`h-5 w-5 mx-auto ${s.color}`} />
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {stats.issuerBreakdown.length > 0 && (
        <div className="space-y-2 pt-2 border-t">
          <p className="text-xs font-medium text-muted-foreground">Active Cards by Issuer</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {stats.issuerBreakdown.map(([issuer, count]) => (
              <div key={issuer} className="flex items-center justify-between">
                <span className="truncate">{issuer}</span>
                <span className="font-medium ml-2">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
