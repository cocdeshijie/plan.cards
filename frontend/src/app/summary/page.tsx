"use client";

import { useState } from "react";
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

  if (dataLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AlertsWidget />
        <FiveTwentyFourWidget />
        <PortfolioWidget className="lg:col-span-2" />
        <CreditsWidget className="lg:col-span-2" onCardClick={(id) => setSelectedCardId(id)} />
      </div>

      {selectedCard && (
        <CardDetailResponsive
          card={selectedCard}
          open={!!selectedCard}
          onClose={() => setSelectedCardId(null)}
          onUpdated={() => refresh()}
          onDeleted={() => { setSelectedCardId(null); refresh(); }}
          profileName={profiles.find(p => p.id === selectedCard.profile_id)?.name}
        />
      )}
    </div>
  );
}
