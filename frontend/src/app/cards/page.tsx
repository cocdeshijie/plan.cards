"use client";

import { useState, useMemo, useEffect } from "react";
import type { Card } from "@/types";
import { useAppStore } from "@/hooks/use-app-store";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CardShowcaseTile } from "@/components/cards/card-showcase-tile";
import { CardFilters, type SortField, type SortDir } from "@/components/cards/card-filters";
import { CardDetailResponsive } from "@/components/card-detail/card-detail-responsive";
import { AddCardDialog } from "@/components/card-table/add-card-dialog";
import { CalendarView } from "@/components/calendar-view/calendar-view";
import { TimelineView } from "@/components/timeline-view/timeline-view";
import { FiveTwentyFourBadge } from "@/components/five-twenty-four/badge";
import { CardGridSkeleton } from "@/components/cards/card-grid-skeleton";
import { Plus, Wallet, FilterX } from "lucide-react";

function sortCards(cards: Card[], field: SortField, dir: SortDir): Card[] {
  const sorted = [...cards].sort((a, b) => {
    switch (field) {
      case "name":
        return a.card_name.localeCompare(b.card_name);
      case "issuer":
        return a.issuer.localeCompare(b.issuer);
      case "open_date": {
        const da = a.open_date || "";
        const db = b.open_date || "";
        return da.localeCompare(db);
      }
      case "annual_fee":
        return (a.annual_fee ?? 0) - (b.annual_fee ?? 0);
      default:
        return 0;
    }
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

export default function CardsPage() {
  const { cards, profiles, selectedProfileId, refresh, dataLoading } = useAppStore();

  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [showAddCard, setShowAddCard] = useState(false);

  // Filters (persisted in localStorage, hydrated in useEffect to avoid SSR mismatch)
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [issuerFilter, setIssuerFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("open_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [activeTab, setActiveTab] = useState("list");

  useEffect(() => {
    setStatusFilter(localStorage.getItem("cards-filter-status") || "all");
    setTypeFilter(localStorage.getItem("cards-filter-type") || "all");
    setIssuerFilter(localStorage.getItem("cards-filter-issuer") || "all");
    setSortField((localStorage.getItem("cards-sort-field") as SortField) || "open_date");
    setSortDir((localStorage.getItem("cards-sort-dir") as SortDir) || "desc");
    setActiveTab(localStorage.getItem("cards-active-tab") || "list");
  }, []);

  const handleStatusChange = (v: string) => { setStatusFilter(v); localStorage.setItem("cards-filter-status", v); };
  const handleTypeChange = (v: string) => { setTypeFilter(v); localStorage.setItem("cards-filter-type", v); };
  const handleIssuerChange = (v: string) => { setIssuerFilter(v); localStorage.setItem("cards-filter-issuer", v); };
  const handleSortFieldChange = (v: SortField) => { setSortField(v); localStorage.setItem("cards-sort-field", v); };
  const handleSortDirToggle = () => {
    setSortDir((d) => {
      const next = d === "asc" ? "desc" : "asc";
      localStorage.setItem("cards-sort-dir", next);
      return next;
    });
  };

  const filteredCards = useMemo(() => {
    const filtered = cards.filter((card) => {
      if (selectedProfileId !== "all" && card.profile_id !== parseInt(selectedProfileId)) return false;
      if (statusFilter !== "all" && card.status !== statusFilter) return false;
      if (typeFilter !== "all" && card.card_type !== typeFilter) return false;
      if (issuerFilter !== "all" && card.issuer !== issuerFilter) return false;
      return true;
    });
    return sortCards(filtered, sortField, sortDir);
  }, [cards, selectedProfileId, statusFilter, typeFilter, issuerFilter, sortField, sortDir]);

  const issuers = useMemo(() => [...new Set(cards.map((c) => c.issuer))].sort(), [cards]);

  // Derive selectedCard from cards array so it auto-updates on refresh
  const selectedCard = selectedCardId !== null ? cards.find((c) => c.id === selectedCardId) ?? null : null;

  if (dataLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div />
          <Button disabled><Plus className="h-4 w-4 mr-1" /> Add Card</Button>
        </div>
        <CardGridSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 5/24 + Add Card */}
      <div className="flex items-start justify-between">
        <div>
          {selectedProfileId !== "all" && (
            <FiveTwentyFourBadge profileId={parseInt(selectedProfileId)} />
          )}
        </div>
        <Button onClick={() => setShowAddCard(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Card
        </Button>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => { setActiveTab(value); localStorage.setItem("cards-active-tab", value); }}
      >
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <CardFilters
            statusFilter={statusFilter}
            onStatusChange={handleStatusChange}
            typeFilter={typeFilter}
            onTypeChange={handleTypeChange}
            issuerFilter={issuerFilter}
            onIssuerChange={handleIssuerChange}
            issuers={issuers}
            sortField={sortField}
            onSortFieldChange={handleSortFieldChange}
            sortDir={sortDir}
            onSortDirToggle={handleSortDirToggle}
            count={filteredCards.length}
          />

          {filteredCards.length === 0 ? (
            (() => {
              const hasFilters = statusFilter !== "all" || typeFilter !== "all" || issuerFilter !== "all";
              return (
                <div className="flex flex-col items-center justify-center py-16 space-y-4">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted">
                    {hasFilters ? <FilterX className="h-8 w-8 text-muted-foreground" /> : <Wallet className="h-8 w-8 text-muted-foreground" />}
                  </div>
                  <div className="text-center space-y-1">
                    <p className="font-medium">{hasFilters ? "No matching cards" : "No cards yet"}</p>
                    <p className="text-sm text-muted-foreground">{hasFilters ? "Try adjusting your filters" : "Add your first card to start tracking"}</p>
                  </div>
                  {hasFilters ? (
                    <Button variant="outline" onClick={() => { handleStatusChange("all"); handleTypeChange("all"); handleIssuerChange("all"); }}>
                      Clear Filters
                    </Button>
                  ) : (
                    <Button onClick={() => setShowAddCard(true)}>
                      <Plus className="h-4 w-4 mr-1" /> Add Card
                    </Button>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCards.map((card) => (
                <CardShowcaseTile
                  key={card.id}
                  card={card}
                  onClick={() => setSelectedCardId(card.id)}
                  profileName={selectedProfileId === "all" ? profiles.find(p => p.id === card.profile_id)?.name : undefined}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="calendar">
          <CalendarView
            cards={filteredCards}
            profiles={profiles}
            onCardClick={(card) => setSelectedCardId(card.id)}
          />
        </TabsContent>

        <TabsContent value="timeline">
          <TimelineView
            cards={cards}
            profiles={profiles}
            profileId={selectedProfileId !== "all" ? parseInt(selectedProfileId) : undefined}
            onCardClick={(card) => setSelectedCardId(card.id)}
          />
        </TabsContent>
      </Tabs>

      {/* Card Detail */}
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

      {/* Add Card Dialog */}
      <AddCardDialog
        profiles={profiles}
        open={showAddCard}
        onClose={() => setShowAddCard(false)}
        onCreated={() => refresh()}
        defaultProfileId={selectedProfileId !== "all" ? parseInt(selectedProfileId) : undefined}
      />
    </div>
  );
}
