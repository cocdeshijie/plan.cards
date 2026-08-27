"use client";

import { useRef, useState } from "react";
import type { Card } from "@/types";
import { useAppStore } from "@/hooks/use-app-store";
import { AlertsWidget } from "@/components/dashboard/alerts-widget";
import { FiveTwentyFourWidget } from "@/components/dashboard/five-twenty-four-widget";
import { PortfolioWidget } from "@/components/dashboard/portfolio-widget";
import { CreditsWidget } from "@/components/dashboard/credits-widget";
import { CardDetailResponsive } from "@/components/card-detail/card-detail-responsive";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";

export default function SummaryPage() {
  const { cards, profiles, refresh, dataLoading } = useAppStore();
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);

  const selectedCard = selectedCardId !== null ? cards.find((c) => c.id === selectedCardId) ?? null : null;

  // Radix's data-[state=closed] transitions and vaul's slide-down both need the
  // sheet to stay mounted for the length of the exit animation. Gating the
  // render on `selectedCard` tore it out in the same tick as the close, so it
  // never animated out. Keep the last card around purely as the thing the
  // closing sheet renders; Radix still unmounts its own content afterwards.
  const lastCardRef = useRef<Card | null>(null);
  if (selectedCard) lastCardRef.current = selectedCard;
  const sheetCard = selectedCard ?? lastCardRef.current;

  if (dataLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Summary</h1>
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* "Summary" everywhere: both nav entries (top-nav.tsx, bottom-tabs.tsx)
          and the route's own metadata title use it. */}
      <h1 className="text-2xl font-bold">Summary</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AlertsWidget onCardClick={(id) => setSelectedCardId(id)} />
        <FiveTwentyFourWidget onCardClick={(id) => setSelectedCardId(id)} />
        <PortfolioWidget className="lg:col-span-2" onCardClick={(id) => setSelectedCardId(id)} />
        <CreditsWidget className="lg:col-span-2" onCardClick={(id) => setSelectedCardId(id)} />
      </div>

      {sheetCard && (
        <CardDetailResponsive
          card={sheetCard}
          open={selectedCard !== null}
          onClose={() => setSelectedCardId(null)}
          onUpdated={() => refresh()}
          onDeleted={() => { setSelectedCardId(null); refresh(); }}
          profileName={profiles.find((p) => p.id === sheetCard.profile_id)?.name}
        />
      )}
    </div>
  );
}
