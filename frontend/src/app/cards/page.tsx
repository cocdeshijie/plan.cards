"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { Card } from "@/types";
import { useAppStore } from "@/hooks/use-app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CardShowcaseTile } from "@/components/cards/card-showcase-tile";
import { CardFilters, type SortField, type SortDir } from "@/components/cards/card-filters";
import { CardDetailResponsive } from "@/components/card-detail/card-detail-responsive";
import { AddCardDialog } from "@/components/card-table/add-card-dialog";
import { CalendarView } from "@/components/calendar-view/calendar-view";
import { TimelineView } from "@/components/timeline-view/timeline-view";
import { FiveTwentyFourBadge } from "@/components/five-twenty-four/badge";
import { CardGridSkeleton } from "@/components/cards/card-grid-skeleton";
import { Plus, Wallet, FilterX, Search, X } from "lucide-react";
import { getCardSecrets } from "@/lib/api";

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

  // Which cards have stored details, for the tile indicator. Kept null until it
  // loads (and on failure) so the tiles show nothing rather than asserting
  // "none stored". One masked-list request; no plaintext is involved.
  const [detailCardIds, setDetailCardIds] = useState<Set<number> | null>(null);
  const loadDetailIds = useCallback(async () => {
    try {
      const all = await getCardSecrets();
      setDetailCardIds(new Set(all.map((s) => s.card_id)));
    } catch {
      setDetailCardIds(null);
    }
  }, []);
  useEffect(() => {
    loadDetailIds();
  }, [loadDetailIds]);
  const [showAddCard, setShowAddCard] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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

  // Scoped by the header's profile selector only. The Calendar tab renders from
  // this, not from filteredCards: search and CardFilters live inside the List
  // tab, and both they and the active tab persist, so you could land on a
  // silently filtered Calendar with no control anywhere in sight.
  const profileCards = useMemo(
    () => selectedProfileId === "all"
      ? cards
      : cards.filter((c) => c.profile_id === parseInt(selectedProfileId)),
    [cards, selectedProfileId],
  );

  const filteredCards = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    const filtered = profileCards.filter((card) => {
      if (statusFilter !== "all" && card.status !== statusFilter) return false;
      if (typeFilter !== "all" && card.card_type !== typeFilter) return false;
      if (issuerFilter !== "all" && card.issuer !== issuerFilter) return false;
      if (q) {
        const tokens = q.split(/\s+/).filter(Boolean);
        const searchable = [
          card.card_name,
          card.issuer,
          card.custom_notes,
          ...(card.custom_tags || []),
        ].filter(Boolean).join(" ").toLowerCase();
        const digits = card.last_digits || "";
        for (const token of tokens) {
          if (/^\d{4,5}$/.test(token)) {
            if (!digits.includes(token)) return false;
          } else {
            if (!searchable.includes(token)) return false;
          }
        }
      }
      return true;
    });
    return sortCards(filtered, sortField, sortDir);
  }, [profileCards, statusFilter, typeFilter, issuerFilter, sortField, sortDir, debouncedSearch]);

  const issuers = useMemo(() => {
    // Only the issuers reachable in the current profile — offering P1's issuers
    // while viewing P2 just guarantees an empty grid.
    const set = new Set(profileCards.map((c) => c.issuer));
    // A persisted filter can name an issuer whose last card was closed out of
    // this profile, deleted or renamed. Radix paints a blank trigger for a value
    // with no matching item, so keep the stale one listed: visible, and
    // clearable from the same dropdown.
    if (issuerFilter !== "all") set.add(issuerFilter);
    return [...set].sort();
  }, [profileCards, issuerFilter]);

  // Derive selectedCard from cards array so it auto-updates on refresh
  const selectedCard = selectedCardId !== null ? cards.find((c) => c.id === selectedCardId) ?? null : null;

  if (dataLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Cards</h1>
        <div className="flex items-start justify-between">
          <div />
          <Button disabled><Plus className="h-4 w-4 mr-1" /> Add Card</Button>
        </div>
        {/* Shaped like the loaded page: tab bar, search box and the filter row.
            Without them the grid rendered ~148px high and every tile jumped once
            the data landed — a tap aimed at the first card hit the filters. */}
        <div>
          <Skeleton className="h-[52px] w-[232px] rounded-lg sm:h-9" />
          <div className="mt-2 space-y-4">
            <Skeleton className="h-9 w-full" />
            <div className="flex gap-3 flex-wrap items-center">
              <Skeleton className="h-9 w-[130px]" />
              <Skeleton className="h-9 w-[130px]" />
              <Skeleton className="h-9 w-[130px] sm:w-[180px]" />
              <Skeleton className="h-9 w-[130px]" />
              <Skeleton className="h-11 w-11 sm:h-9 sm:w-9" />
              <Skeleton className="h-6 w-20" />
            </div>
            <CardGridSkeleton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Cards</h1>

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
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
            />
            <Input
              ref={searchRef}
              type="search"
              placeholder="Search cards..."
              aria-label="Search cards"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
              autoComplete="off"
              enterKeyHint="search"
            />
            {/* The only reset used to be the empty-state button, which needs zero
                results before it appears — no way back from a typo. */}
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-0 top-1/2 -translate-y-1/2 h-9 w-9 grid place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
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
              const hasSearch = debouncedSearch.trim().length > 0;
              // The reset button clears the search AND all three filters, so it
              // has to say so — "Clear Search" was hiding the fact that three
              // dropdowns were about to move too.
              const resetLabel = hasSearch && hasFilters
                ? "Clear Search & Filters"
                : hasSearch
                ? "Clear Search"
                : "Clear Filters";
              return (
                <div className="flex flex-col items-center justify-center py-16 space-y-4">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted">
                    {hasFilters || hasSearch ? <FilterX className="h-8 w-8 text-muted-foreground" /> : <Wallet className="h-8 w-8 text-muted-foreground" />}
                  </div>
                  <div className="text-center space-y-1">
                    <p className="font-medium">
                      {hasSearch ? `No results for "${debouncedSearch}"` : hasFilters ? "No matching cards" : "No cards yet"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {hasSearch && hasFilters
                        ? "Filters are active too — try a different term or clear them"
                        : hasSearch
                        ? "Try a different search term"
                        : hasFilters
                        ? "Try adjusting your filters"
                        : "Add your first card to start tracking"}
                    </p>
                  </div>
                  {hasFilters || hasSearch ? (
                    <Button variant="outline" onClick={() => { handleStatusChange("all"); handleTypeChange("all"); handleIssuerChange("all"); setSearchQuery(""); }}>
                      {resetLabel}
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
                  hasDetails={detailCardIds ? detailCardIds.has(card.id) : undefined}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="calendar">
          <CalendarView
            cards={profileCards}
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
          onUpdated={() => { refresh(); loadDetailIds(); }}
          onDeleted={() => { setSelectedCardId(null); refresh(); loadDetailIds(); }}
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
