"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import type { Card, CardEvent, Profile } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAllEvents } from "@/lib/api";
import { formatDate, formatCurrency, parseDateStr } from "@/lib/utils";
import { useToday } from "@/hooks/use-timezone";
import { Skeleton } from "@/components/ui/skeleton";
import { getEventMeta } from "@/lib/event-icons";
import { CardThumbnail } from "@/components/shared/card-thumbnail";
import { Clock, ChevronUp, ArrowRight, Minus } from "lucide-react";
import { format, isSameMonth, isSameYear } from "date-fns";

interface TimelineViewProps {
  cards: Card[];
  profiles: Profile[];
  profileId?: number;
  onCardClick?: (card: Card) => void;
}

interface TimelineItem {
  id: string;
  date: Date;
  type: string;
  card: Card;
  isFuture: boolean;
  isSynthetic: boolean;
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

const PAGE_SIZE = 100;

function synthesizeFutureEvents(cards: Card[], profileMap: Record<number, string>, today: Date): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const card of cards) {
    if (card.status !== "active") continue;
    const profileName = profileMap[card.profile_id];
    const prefix = profileName ? `${profileName} \u2022 ` : "";

    // Next AF date
    if (card.annual_fee_date && card.annual_fee && card.annual_fee > 0) {
      const afDate = parseDateStr(card.annual_fee_date);
      if (afDate >= today) {
        items.push({
          id: `af-${card.id}`,
          date: afDate,
          type: "annual_fee_upcoming",
          card,
          isFuture: true,
          isSynthetic: true,
          label: `${prefix}${card.card_name}`,
          description: `~${formatCurrency(card.annual_fee)} annual fee`,
        });
      }
    }

    // Spend deadline
    if (card.spend_reminder_enabled && card.spend_deadline && !card.signup_bonus_earned) {
      const deadline = parseDateStr(card.spend_deadline);
      if (deadline >= today) {
        items.push({
          id: `spend-${card.id}`,
          date: deadline,
          type: "spend_deadline",
          card,
          isFuture: true,
          isSynthetic: true,
          label: `${prefix}${card.card_name}`,
          description: card.spend_requirement
            ? `Spend ${formatCurrency(card.spend_requirement)} by ${formatDate(card.spend_deadline)}`
            : "Spend deadline",
        });
      }
    }

    // Bonus deadlines
    for (const bonus of card.bonuses ?? []) {
      if (bonus.spend_reminder_enabled && bonus.spend_deadline && !bonus.bonus_earned) {
        const dl = parseDateStr(bonus.spend_deadline);
        if (dl >= today) {
          const sourceLabel = bonus.bonus_source === "retention" ? "Retention" : "Upgrade";
          items.push({
            id: `bonus-${bonus.id}`,
            date: dl,
            type: "bonus_deadline",
            card,
            isFuture: true,
            isSynthetic: true,
            label: `${prefix}${card.card_name}`,
            description: bonus.spend_requirement
              ? `${sourceLabel}: spend ${formatCurrency(bonus.spend_requirement)} by ${formatDate(bonus.spend_deadline)}`
              : `${sourceLabel} bonus deadline`,
          });
        }
      }
    }

    // Next anniversary
    if (card.open_date) {
      const openDate = parseDateStr(card.open_date);
      const thisYear = today.getFullYear();
      let anniv = new Date(thisYear, openDate.getMonth(), openDate.getDate());
      if (anniv < today) anniv = new Date(thisYear + 1, openDate.getMonth(), openDate.getDate());
      const years = anniv.getFullYear() - openDate.getFullYear();
      items.push({
        id: `anniv-${card.id}`,
        date: anniv,
        type: "anniversary",
        card,
        isFuture: true,
        isSynthetic: true,
        label: `${prefix}${card.card_name}`,
        description: `${years}yr anniversary`,
      });
    }
  }

  return items.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function realEventToItem(event: CardEvent, card: Card, profileMap: Record<number, string>): TimelineItem {
  const profileName = profileMap[card.profile_id];
  const prefix = profileName ? `${profileName} \u2022 ` : "";
  const meta = getEventMeta(event.event_type);
  return {
    id: `evt-${event.id}`,
    date: parseDateStr(event.event_date),
    type: event.event_type,
    card,
    isFuture: false,
    isSynthetic: false,
    label: `${prefix}${card.card_name}`,
    description: event.description ?? undefined,
    metadata: event.metadata_json ?? undefined,
  };
}

function MonthDivider({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {format(date, "MMMM yyyy")}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function TodayMarker({ today }: { today: Date }) {
  return (
    <div className="flex items-center gap-2 py-3 my-1">
      <div className="h-0.5 flex-1 bg-primary/60" />
      <span className="text-xs font-semibold text-primary px-2 py-0.5 rounded-full bg-primary/10">
        Today &middot; {format(today, "MMM d, yyyy")}
      </span>
      <div className="h-0.5 flex-1 bg-primary/60" />
    </div>
  );
}

function CompactEventRow({
  item,
  onCardClick,
}: {
  item: TimelineItem;
  onCardClick?: (card: Card) => void;
}) {
  const meta = getEventMeta(item.type);
  const Icon = meta.icon;

  const renderMetadata = () => {
    if (item.isSynthetic) {
      return (
        <span className="text-xs text-muted-foreground truncate">{item.description}</span>
      );
    }
    const m = item.metadata;
    if (!m) {
      if (item.description) return <span className="text-xs text-muted-foreground truncate">{item.description}</span>;
      return null;
    }
    switch (item.type) {
      case "annual_fee_posted":
        return m.annual_fee != null ? (
          <span className="text-xs font-medium">{formatCurrency(m.annual_fee as number)}</span>
        ) : null;
      case "annual_fee_refund":
        return m.annual_fee != null ? (
          <span className="text-xs font-medium text-green-600 dark:text-green-400">
            -{formatCurrency(m.annual_fee as number)}
          </span>
        ) : null;
      case "product_change":
        return (
          <span className="text-xs text-muted-foreground flex items-center gap-1 truncate">
            <ArrowRight className="h-3 w-3 shrink-0" />
            {(m as Record<string, string>).to_name}
          </span>
        );
      case "retention_offer": {
        const parts: string[] = [];
        if (m.offer_points) parts.push(`${Number(m.offer_points).toLocaleString()} pts`);
        if (m.offer_credit) parts.push(`$${Number(m.offer_credit)}`);
        const status = m.accepted !== false ? "Accepted" : "Declined";
        return (
          <span className="text-xs text-muted-foreground truncate">
            {parts.length > 0 ? `${parts.join(" + ")} \u00b7 ` : ""}{status}
          </span>
        );
      }
      default:
        if (item.description) return <span className="text-xs text-muted-foreground truncate">{item.description}</span>;
        return null;
    }
  };

  return (
    <div
      className={`group relative flex items-center gap-2.5 py-1.5 pl-8 pr-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer ${
        item.isFuture ? "opacity-55" : ""
      }`}
      onClick={() => onCardClick?.(item.card)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCardClick?.(item.card); } }}
    >
      {/* Timeline dot */}
      <div
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-background ${
          item.isFuture ? "border-2 border-dashed" : ""
        } ${meta.colorClass}`}
        style={item.isFuture ? { background: "transparent", borderColor: "currentColor" } : undefined}
      >
        <Icon className={`h-2.5 w-2.5 ${item.isFuture ? "" : "text-white"}`} />
      </div>

      {/* Card thumbnail */}
      <CardThumbnail
        templateId={item.card.template_id}
        cardName={item.card.card_name}
        cardImage={item.card.card_image}
        className="w-8 h-5 shrink-0"
      />

      {/* Badge */}
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
        item.isFuture ? "border border-dashed" : ""
      } ${meta.badgeColor}`}>
        {meta.label}
      </span>

      {/* Date */}
      <span className="text-[11px] text-muted-foreground shrink-0 w-[72px]">
        {item.isSynthetic && item.metadata?.approximate_date
          ? "~" + format(item.date, "MMM yyyy")
          : format(item.date, "MMM d, yy")}
      </span>

      {/* Card name + issuer */}
      <span className="text-xs font-medium truncate shrink min-w-0">
        {item.card.card_name}{item.card.last_digits && <span className="font-normal text-muted-foreground"> ••• {item.card.last_digits}</span>}
        <span className="font-normal text-muted-foreground"> &middot; {item.card.issuer}</span>
      </span>

      {/* Metadata (right-aligned) */}
      <span className="ml-auto shrink-0 max-w-[200px] text-right hidden sm:flex items-center">
        {renderMetadata()}
      </span>
    </div>
  );
}

export function TimelineView({ cards, profiles, profileId, onCardClick }: TimelineViewProps) {
  const today = useToday();
  const [pastEvents, setPastEvents] = useState<CardEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterIssuer, setFilterIssuer] = useState<string>("all");
  const requestIdRef = useRef(0);
  const todayRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasScrolledToToday = useRef(false);

  const profileMap = useMemo(() => {
    const map: Record<number, string> = {};
    for (const p of profiles) map[p.id] = p.name;
    return map;
  }, [profiles]);

  const cardMap = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const issuers = useMemo(() => [...new Set(cards.map((c) => c.issuer))].sort(), [cards]);

  // Fetch past events
  const fetchEvents = useCallback(async (newOffset: number, append: boolean) => {
    const requestId = ++requestIdRef.current;
    const params: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(newOffset) };
    if (profileId) params.profile_id = profileId.toString();
    if (filterType !== "all" && filterType !== "annual_fee") params.event_type = filterType;
    if (filterIssuer !== "all") params.issuer = filterIssuer;

    if (!append) {
      setLoading(true);
      setFetchError(false);
    } else {
      setLoadingMore(true);
    }

    try {
      let data = await getAllEvents(params);
      if (requestId !== requestIdRef.current) return;
      if (filterType === "annual_fee") {
        data = data.filter((e: CardEvent) =>
          e.event_type === "annual_fee_posted" || e.event_type === "annual_fee_refund"
        );
      }
      setHasMore(data.length === PAGE_SIZE);
      if (append) {
        setPastEvents((prev) => [...prev, ...data]);
      } else {
        setPastEvents(data);
      }
      setOffset(newOffset + data.length);
    } catch {
      if (requestId === requestIdRef.current) setFetchError(true);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [profileId, filterType, filterIssuer]);

  // Initial fetch
  useEffect(() => {
    hasScrolledToToday.current = false;
    setOffset(0);
    setHasMore(true);
    setPastEvents([]);
    fetchEvents(0, false);
  }, [fetchEvents, cards]);

  // Auto-scroll to today after initial load
  useEffect(() => {
    if (!loading && !hasScrolledToToday.current && todayRef.current) {
      requestAnimationFrame(() => {
        todayRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
        hasScrolledToToday.current = true;
      });
    }
  }, [loading]);

  // Build the unified timeline
  const futureItems = useMemo(
    () => synthesizeFutureEvents(cards, profileMap, today),
    [cards, profileMap, today]
  );

  // Convert past API events into TimelineItems (reversed to chronological asc)
  const pastItems = useMemo(() => {
    const items: TimelineItem[] = [];
    for (const event of pastEvents) {
      const card = cardMap.get(event.card_id);
      if (!card) continue;
      items.push(realEventToItem(event, card, profileMap));
    }
    // API returns DESC, reverse to ASC
    items.reverse();
    return items;
  }, [pastEvents, cardMap, profileMap]);

  // Filter future items by issuer if active
  const filteredFutureItems = useMemo(() => {
    if (filterIssuer === "all") return futureItems;
    return futureItems.filter((item) => item.card.issuer === filterIssuer);
  }, [futureItems, filterIssuer]);

  // Filter future items by profile if active
  const profileFilteredFutureItems = useMemo(() => {
    if (!profileId) return filteredFutureItems;
    return filteredFutureItems.filter((item) => item.card.profile_id === profileId);
  }, [filteredFutureItems, profileId]);

  // Merge past + future
  const allItems = useMemo(() => [...pastItems, ...profileFilteredFutureItems], [pastItems, profileFilteredFutureItems]);

  // Find today boundary index (first future item)
  const todayIndex = pastItems.length;

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    fetchEvents(offset, true);
  };

  const hasActiveFilters = filterType !== "all" || filterIssuer !== "all";

  return (
    <div className="flex flex-col h-[calc(100dvh-14rem)]">
      {/* Filters */}
      <div className="shrink-0 flex items-center gap-3 flex-wrap pb-3">
        <Select value={filterType} onValueChange={(v) => { setFilterType(v); }}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Events</SelectItem>
            <SelectItem value="opened">Opened</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="product_change">Product Change</SelectItem>
            <SelectItem value="annual_fee">Annual Fee</SelectItem>
            <SelectItem value="retention_offer">Retention</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterIssuer} onValueChange={(v) => { setFilterIssuer(v); }}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Issuer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Issuers</SelectItem>
            {issuers.map((iss) => (
              <SelectItem key={iss} value={iss}>{iss}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">
          {allItems.length} event{allItems.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Timeline body — scrollable container */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto">
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-2.5 py-1.5 pl-8 pr-2">
              <Skeleton className="absolute left-0 w-5 h-5 rounded-full" />
              <Skeleton className="w-8 h-5 rounded-sm" />
              <Skeleton className="h-4 w-16 rounded" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : fetchError ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <p className="text-sm text-destructive">Failed to load events. Please try again.</p>
        </div>
      ) : allItems.length === 0 && !hasMore ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-muted">
            <Clock className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {hasActiveFilters
              ? "No events match your filters. Try adjusting them."
              : "No events found. Events will appear here as you track your cards."}
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[10px] top-0 bottom-0 w-px bg-border" />

          {/* Load more sentinel */}
          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center pb-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1 text-muted-foreground"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                <ChevronUp className="h-3 w-3" />
                {loadingMore ? "Loading..." : "Load earlier events"}
              </Button>
            </div>
          )}

          {/* Events */}
          {(() => {
            const elements: React.ReactNode[] = [];
            let lastMonth: string | null = null;

            for (let i = 0; i < allItems.length; i++) {
              const item = allItems[i];
              const monthKey = format(item.date, "yyyy-MM");

              // Insert today marker at boundary
              if (i === todayIndex) {
                elements.push(<div key="today" ref={todayRef}><TodayMarker today={today} /></div>);
              }

              // Month divider
              if (monthKey !== lastMonth) {
                lastMonth = monthKey;
                elements.push(<MonthDivider key={`month-${monthKey}`} date={item.date} />);
              }

              elements.push(
                <CompactEventRow
                  key={item.id}
                  item={item}
                  onCardClick={onCardClick}
                />
              );
            }

            // If no future items, still show today marker at the end
            if (todayIndex >= allItems.length) {
              elements.push(<div key="today" ref={todayRef}><TodayMarker today={today} /></div>);
            }

            return elements;
          })()}
        </div>
      )}
      </div>
    </div>
  );
}
