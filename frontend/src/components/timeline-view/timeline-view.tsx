"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import type { Card, CardEvent, Profile } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAllEvents } from "@/lib/api";
import { formatDate, formatCurrency, parseDateStr } from "@/lib/utils";
import { maskLastDigits } from "@/lib/card-number";
import { useToday } from "@/hooks/use-timezone";
import { getAnniversaryForYear } from "@/lib/fee-utils";
import { Skeleton } from "@/components/ui/skeleton";
import { getEventMeta } from "@/lib/event-icons";
import { CardThumbnail } from "@/components/shared/card-thumbnail";
import { Clock, ChevronUp, ArrowRight, RefreshCw } from "lucide-react";
import { format } from "date-fns";

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

// One format for every date in the view — the date column, the Today divider
// and the sentences inside descriptions (formatDate) all read "MMM d, yyyy".
// The column used to render a 2-digit year next to a 4-digit one in the same row.
const ROW_DATE_FORMAT = "MMM d, yyyy";

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
      // getAnniversaryForYear clamps Feb 29 to Feb 28 in non-leap years; the
      // raw Date constructor rolled it over to March 1.
      let anniv = getAnniversaryForYear(openDate, thisYear);
      if (anniv < today) anniv = getAnniversaryForYear(openDate, thisYear + 1);
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
        Today &middot; {format(today, ROW_DATE_FORMAT)}
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
  const mask = maskLastDigits(item.card.last_digits);
  const nameTitle = `${item.card.card_name}${mask ? ` ${mask}` : ""} \u00b7 ${item.card.issuer}`;

  const renderMetadata = () => {
    if (item.isSynthetic) {
      return (
        <span className="text-xs text-muted-foreground truncate min-w-0" title={item.description}>{item.description}</span>
      );
    }
    const m = item.metadata;
    if (!m) {
      if (item.description) return <span className="text-xs text-muted-foreground truncate min-w-0" title={item.description}>{item.description}</span>;
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
      case "product_change": {
        const toName = (m as Record<string, string>).to_name;
        return (
          <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-0" title={toName ? `Changed to ${toName}` : undefined}>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <span className="truncate min-w-0">{toName}</span>
          </span>
        );
      }
      case "retention_offer": {
        const parts: string[] = [];
        if (m.offer_points) parts.push(`${Number(m.offer_points).toLocaleString()} pts`);
        if (m.offer_credit) parts.push(`$${Number(m.offer_credit)}`);
        const status = m.accepted !== false ? "Accepted" : "Declined";
        const text = `${parts.length > 0 ? `${parts.join(" + ")} \u00b7 ` : ""}${status}`;
        return (
          <span className="text-xs text-muted-foreground truncate min-w-0" title={text}>
            {text}
          </span>
        );
      }
      default:
        if (item.description) return <span className="text-xs text-muted-foreground truncate min-w-0" title={item.description}>{item.description}</span>;
        return null;
    }
  };

  // Rendered twice: on the left of the row at sm+, and on the second line with
  // the metadata below sm. At any one viewport exactly one of the two is
  // `display:none`, so it is never announced twice.
  const badge = (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
      item.isFuture ? "border border-dashed" : ""
    } ${meta.badgeColor}`}>
      {meta.label}
    </span>
  );

  return (
    <div
      className={`group relative flex items-center gap-2.5 py-2 sm:py-1.5 pl-8 pr-2 min-h-[44px] sm:min-h-0 rounded-lg hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors cursor-pointer ${
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

      {/* Badge — left column at sm+ */}
      <span className="hidden sm:inline-flex shrink-0">{badge}</span>

      {/* Below sm the row is two lines: date + name, then badge + metadata.
          Single-line, the fixed-width badge and date left the card name about
          60px and it was the only thing allowed to shrink. */}
      <div className="min-w-0 flex-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5">
        <div className="flex items-center gap-2 min-w-0 sm:flex-1 sm:gap-2.5">
          {/* Date. The backend stamps approximate_date on back-filled fees; the
              row used to require isSynthetic too, which no real event ever is,
              so every approximate date rendered as an exact day. */}
          <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums whitespace-nowrap w-[76px] sm:w-[80px]">
            {item.metadata?.approximate_date
              ? "~" + format(item.date, "MMM yyyy")
              : format(item.date, ROW_DATE_FORMAT)}
          </span>

          {/* Card name + issuer */}
          <span className="text-xs font-medium truncate min-w-0" title={nameTitle}>
            {item.card.card_name}{mask && <span className="font-normal text-muted-foreground"> {mask}</span>}
            <span className="font-normal text-muted-foreground"> &middot; {item.card.issuer}</span>
          </span>
        </div>

        {/* Badge + metadata. Fee amounts, product-change targets and retention
            terms used to be `hidden` below sm with no mobile equivalent. */}
        <div className="flex items-center gap-2 min-w-0 sm:ml-auto sm:shrink-0 sm:max-w-[200px] sm:justify-end">
          <span className="sm:hidden shrink-0">{badge}</span>
          {renderMetadata()}
        </div>
      </div>
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
  const fetchEvents = useCallback(async (newOffset: number, append: boolean, showSkeleton: boolean) => {
    const requestId = ++requestIdRef.current;
    const params: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(newOffset) };
    if (profileId) params.profile_id = profileId.toString();
    if (filterType !== "all" && filterType !== "annual_fee") params.event_type = filterType;
    if (filterIssuer !== "all") params.issuer = filterIssuer;

    if (!append) {
      // showSkeleton is false for the background refetch that fires when the
      // card list changes underneath us — flashing the skeleton on every
      // refresh was worse than leaving the rows in place. A filter change does
      // pass it, so the stale list no longer just sits there.
      if (showSkeleton) setLoading(true);
      setFetchError(false);
    } else {
      setLoadingMore(true);
    }

    try {
      const page = await getAllEvents(params);
      if (requestId !== requestIdRef.current) return;
      // "annual_fee" covers two event types, so the API can't express it and we
      // filter client-side. hasMore/offset MUST still come from the raw page
      // length: deriving them from the filtered array made "4 of 100 matched"
      // look like the end of the list, hiding the Load-earlier button, and
      // advanced the offset by 4 so the next page would overlap.
      let data = page;
      if (filterType === "annual_fee") {
        data = page.filter((e: CardEvent) =>
          e.event_type === "annual_fee_posted" || e.event_type === "annual_fee_refund"
        );
      }
      setHasMore(page.length === PAGE_SIZE);
      if (append) {
        setPastEvents((prev) => [...prev, ...data]);
      } else {
        setPastEvents(data);
      }
      setOffset(newOffset + page.length);
    } catch {
      if (requestId === requestIdRef.current) setFetchError(true);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [profileId, filterType, filterIssuer]);

  // The query the list currently represents. `cards` also retriggers the fetch,
  // but only a real query change should throw away the loaded page and re-aim
  // the scroll position — otherwise every background refresh cleared the list.
  const queryKey = `${profileId ?? "all"}|${filterType}|${filterIssuer}`;
  const lastQueryKeyRef = useRef<string | null>(null);

  // Initial fetch, and a full reset whenever the query changes
  useEffect(() => {
    const queryChanged = lastQueryKeyRef.current !== queryKey;
    lastQueryKeyRef.current = queryKey;
    if (queryChanged) {
      // Both of these used to sit behind a "have we loaded once yet" ref,
      // which is false only on the very first pass: changing the issuer while
      // deep in 2019 left you at an arbitrary offset in a different list.
      hasScrolledToToday.current = false;
      setPastEvents([]);
    }
    setOffset(0);
    setHasMore(true);
    fetchEvents(0, false, queryChanged);
  }, [fetchEvents, cards, queryKey]);

  // Auto-scroll to today after initial load. Scroll OUR container, not via
  // scrollIntoView: that walks every scrollable ancestor and dragged the whole
  // page — tab bar, filters and all — out of view on mobile.
  useEffect(() => {
    if (loading || hasScrolledToToday.current) return;
    const frame = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      const marker = todayRef.current;
      if (!container || !marker) return;
      const containerTop = container.getBoundingClientRect().top;
      const markerTop = marker.getBoundingClientRect().top;
      const delta = (markerTop - containerTop) - (container.clientHeight - marker.offsetHeight) / 2;
      container.scrollTop = Math.max(0, container.scrollTop + delta);
      hasScrolledToToday.current = true;
    });
    return () => cancelAnimationFrame(frame);
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
    const byProfile = !profileId
      ? filteredFutureItems
      : filteredFutureItems.filter((item) => item.card.profile_id === profileId);
    // Synthetic items (anniversaries, upcoming fees, deadlines) carry no event
    // type, so an event-type filter should hide them — selecting "Closed" used
    // to still render every upcoming anniversary below the Today marker and
    // count them in the "N events" badge. The one exception is the annual-fee
    // filter, which does semantically cover the upcoming-fee rows.
    if (filterType === "all") return byProfile;
    if (filterType === "annual_fee") {
      return byProfile.filter((item) => item.type === "annual_fee_upcoming");
    }
    return [];
  }, [filteredFutureItems, profileId, filterType]);

  // Merge past + future. Past events are sorted server-side by date desc and
  // reversed into ascending order; a future-dated real event would otherwise
  // land at the end of pastItems and render ABOVE the Today marker, reversing
  // the month dividers around it.
  const { allItems, todayIndex } = useMemo(() => {
    const past: typeof pastItems = [];
    const future: typeof pastItems = [];
    for (const item of pastItems) {
      (item.date > today ? future : past).push(item);
    }
    future.sort((a, b) => a.date.getTime() - b.date.getTime());
    return {
      allItems: [...past, ...future, ...profileFilteredFutureItems],
      todayIndex: past.length,
    };
  }, [pastItems, profileFilteredFutureItems, today]);

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    fetchEvents(offset, true, false);
  };

  const hasActiveFilters = filterType !== "all" || filterIssuer !== "all";

  // "Annual Fee" filters client-side over a raw page, so an empty result with
  // more pages behind it is normal and must still say so — the old
  // `length === 0 && !hasMore` gate rendered nothing at all.
  const emptyMessage = hasActiveFilters
    ? hasMore
      ? "No events match your filters in this stretch of history. Load earlier events to keep looking."
      : "No events match your filters. Try adjusting them."
    : "No events found. Events will appear here as you track your cards.";

  return (
    // max-h, not h: a fixed height reserved a ~700px box for three events on
    // desktop, and on mobile it ran past the bottom of the viewport and behind
    // the fixed tab bar. The looser clamp has to hold for the whole range where
    // that tab bar exists — bottom-tabs.tsx is `md:hidden`, not `sm:hidden`, so
    // the breakpoint here is md. (Below md the chrome above this box is ~240px
    // and the tab bar eats another 56px.)
    <div className="flex flex-col max-h-[calc(100dvh-19rem)] md:max-h-[calc(100dvh-14rem)]">
      {/* Filters — two-up below sm so they occupy one row, not three */}
      <div className="shrink-0 grid grid-cols-2 gap-2 pb-3 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <Select value={filterType} onValueChange={(v) => { setFilterType(v); }}>
          <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter by event type">
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
          <SelectTrigger
            className="w-full sm:w-[180px]"
            aria-label="Filter by issuer"
            title={filterIssuer === "all" ? "All Issuers" : filterIssuer}
          >
            <SelectValue placeholder="Issuer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Issuers</SelectItem>
            {issuers.map((iss) => (
              <SelectItem key={iss} value={iss}>{iss}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* The count is meaningless mid-fetch: it briefly mixed the old page
            with the new filter's synthetic rows. */}
        <Badge variant="secondary" className="text-xs col-span-2 justify-self-start" aria-live="polite">
          {loading ? "Loading..." : `${allItems.length} event${allItems.length !== 1 ? "s" : ""}`}
        </Badge>
      </div>

      {/* Timeline body — scrollable container */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto">
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            // `relative` is load-bearing: the dot skeleton is absolutely
            // positioned and without it every dot stacked at x=0 of the page.
            <div key={i} className="relative flex items-center gap-2.5 py-1.5 pl-8 pr-2">
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
          <p className="text-sm text-danger">Failed to load events. Please try again.</p>
          <Button variant="outline" size="sm" onClick={() => fetchEvents(0, false, true)} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </div>
      ) : allItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-muted">
            <Clock className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground text-center max-w-xs">{emptyMessage}</p>
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 min-h-[44px] sm:min-h-0"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              <ChevronUp className="h-3.5 w-3.5" />
              {loadingMore ? "Loading..." : "Load earlier events"}
            </Button>
          )}
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
                className="text-xs gap-1 text-muted-foreground min-h-[44px] sm:min-h-0"
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
