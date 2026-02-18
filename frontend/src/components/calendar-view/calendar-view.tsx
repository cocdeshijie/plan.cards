"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import type { Card, Profile } from "@/types";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToday } from "@/hooks/use-timezone";
import { parseDateStr } from "@/lib/utils";

interface CalendarViewProps {
  cards: Card[];
  profiles: Profile[];
  onCardClick?: (card: Card) => void;
}

interface CalendarEvent {
  date: Date;
  type: "anniversary" | "spend_deadline" | "annual_fee_due" | "bonus_deadline";
  card: Card;
  label: string;
  shortLabel: string;
}

const MAX_VISIBLE_EVENTS = 2;

export function CalendarView({ cards, profiles, onCardClick }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const expandedRef = useRef<HTMLDivElement>(null);

  const profileMap = useMemo(() => {
    const map: Record<number, string> = {};
    for (const p of profiles) map[p.id] = p.name;
    return map;
  }, [profiles]);

  const calendarEvents = useMemo(() => {
    const events: CalendarEvent[] = [];
    const year = currentMonth.getFullYear();

    for (const card of cards) {
      const profileName = profileMap[card.profile_id];
      const prefix = profileName ? `${profileName} \u2022 ` : "";

      if (card.open_date && card.status === "active") {
        const openDate = parseDateStr(card.open_date);
        const hasFee = card.annual_fee && card.annual_fee > 0;
        // Generate for both viewYear and viewYear+1 to handle month boundary views
        for (const yr of [year, year + 1]) {
          const anniversary = new Date(yr, openDate.getMonth(), openDate.getDate());
          events.push({
            date: anniversary,
            type: "anniversary",
            card,
            label: hasFee
              ? `${prefix}${card.card_name} anniversary (~$${card.annual_fee} fee)`
              : `${prefix}${card.card_name} anniversary`,
            shortLabel: "\ud83c\udf82",
          });
        }
      }
      if (card.spend_reminder_enabled && card.spend_deadline && !card.signup_bonus_earned) {
        const deadline = parseDateStr(card.spend_deadline);
        events.push({
          date: deadline,
          type: "spend_deadline",
          card,
          label: `${prefix}${card.card_name} spend deadline`,
          shortLabel: "\ud83d\udcb0",
        });
      }
      if (card.annual_fee_date) {
        const afDate = parseDateStr(card.annual_fee_date);
        events.push({
          date: afDate,
          type: "annual_fee_due",
          card,
          label: `${prefix}${card.card_name} $${card.annual_fee ?? 0} annual fee due`,
          shortLabel: "AF",
        });
      }
      // Upgrade/retention bonus spend deadlines
      for (const bonus of card.bonuses ?? []) {
        if (bonus.spend_reminder_enabled && bonus.spend_deadline && !bonus.bonus_earned) {
          const dl = parseDateStr(bonus.spend_deadline);
          const label = bonus.bonus_source === "retention" ? "Retention" : "Upgrade";
          events.push({
            date: dl,
            type: "bonus_deadline",
            card,
            label: `${prefix}${card.card_name} ${label} spend deadline`,
            shortLabel: "\u2b50",
          });
        }
      }
    }
    return events;
  }, [cards, currentMonth, profileMap]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const eventTypePriority: Record<string, number> = {
    spend_deadline: 0,
    bonus_deadline: 1,
    anniversary: 2,
    annual_fee_due: 3,
  };

  const getEventsForDay = (day: Date) =>
    calendarEvents
      .filter((e) => isSameDay(e.date, day))
      .sort((a, b) => (eventTypePriority[a.type] ?? 9) - (eventTypePriority[b.type] ?? 9));

  const eventColors: Record<string, string> = {
    anniversary: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    spend_deadline: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    annual_fee_due: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    bonus_deadline: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  };

  // Close expanded panel when clicking outside
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (expandedRef.current && !expandedRef.current.contains(e.target as Node)) {
      setExpandedDay(null);
    }
  }, []);

  useEffect(() => {
    if (expandedDay) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [expandedDay, handleClickOutside]);

  const today = useToday();
  const goToToday = () => setCurrentMonth(today);

  const yearRange = useMemo(() => {
    const currentYear = today.getFullYear();
    let minYear = currentYear - 5;
    for (const card of cards) {
      if (card.open_date) {
        const yr = parseDateStr(card.open_date).getFullYear();
        if (yr < minYear) minYear = yr;
      }
    }
    const maxYear = currentYear + 2;
    return Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  }, [cards, today]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Select
              value={String(currentMonth.getMonth())}
              onValueChange={(val) => {
                const newMonth = new Date(currentMonth);
                newMonth.setMonth(parseInt(val));
                setCurrentMonth(newMonth);
              }}
            >
              <SelectTrigger className="h-8 w-auto border-none shadow-none px-2 py-0 text-lg font-semibold focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {format(new Date(2024, i), "MMMM")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(currentMonth.getFullYear())}
              onValueChange={(val) => {
                const newMonth = new Date(currentMonth);
                newMonth.setFullYear(parseInt(val));
                setCurrentMonth(newMonth);
              }}
            >
              <SelectTrigger className="h-8 w-auto border-none shadow-none px-2 py-0 text-lg font-semibold focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearRange.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={goToToday}
          >
            Today
          </Button>
        </div>
        <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-muted rounded-xl overflow-hidden">
        {[
          { full: "Sun", short: "S" },
          { full: "Mon", short: "M" },
          { full: "Tue", short: "T" },
          { full: "Wed", short: "W" },
          { full: "Thu", short: "T" },
          { full: "Fri", short: "F" },
          { full: "Sat", short: "S" },
        ].map((day) => (
          <div key={day.full} className="bg-muted/50 p-1.5 sm:p-2 text-center text-xs font-medium text-muted-foreground">
            <span className="hidden sm:inline">{day.full}</span>
            <span className="sm:hidden">{day.short}</span>
          </div>
        ))}
        {days.map((day, dayIndex) => {
          const dayEvents = getEventsForDay(day);
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, today);
          const dayKey = day.toISOString();
          const colIndex = dayIndex % 7;
          const hasOverflow = dayEvents.length > MAX_VISIBLE_EVENTS;
          const visibleEvents = dayEvents.slice(0, MAX_VISIBLE_EVENTS);
          const overflowCount = dayEvents.length - MAX_VISIBLE_EVENTS;

          return (
            <div
              key={dayKey}
              className={`relative bg-background p-1 sm:p-2 min-h-[72px] sm:min-h-[100px] ${
                !isCurrentMonth ? "opacity-40" : ""
              } ${isToday ? "bg-primary/5" : ""}`}
            >
              <div
                className={`text-xs font-medium mb-1.5 ${
                  isToday
                    ? "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center ring-2 ring-primary/20"
                    : "text-muted-foreground"
                }`}
              >
                {format(day, "d")}
              </div>
              <div className="space-y-0.5">
                {visibleEvents.map((event, i) => (
                  <button
                    key={i}
                    className={`block w-full text-left text-xs leading-snug px-1 sm:px-1.5 py-0.5 sm:py-1 rounded truncate hover:brightness-95 dark:hover:brightness-110 transition-all ${eventColors[event.type]}`}
                    title={event.label}
                    aria-label={event.label}
                    onClick={() => onCardClick?.(event.card)}
                  >
                    {event.shortLabel}<span className="hidden sm:inline"> {event.card.card_name}{event.card.last_digits && <span className="opacity-60"> ••• {event.card.last_digits}</span>}</span>
                  </button>
                ))}
                {hasOverflow && (
                  <button
                    className="w-full text-left text-xs leading-snug px-1.5 py-0.5 rounded text-muted-foreground hover:bg-muted transition-colors"
                    onClick={() => setExpandedDay(expandedDay === dayKey ? null : dayKey)}
                  >
                    +{overflowCount} more
                  </button>
                )}
              </div>

              {/* Overflow panel — desktop: absolute dropdown, mobile: rendered below grid */}
              {expandedDay === dayKey && (
                <div
                  ref={expandedRef}
                  className={`hidden sm:block absolute z-20 top-full mt-1 w-52 bg-popover border rounded-lg shadow-lg p-2 space-y-1 ${
                    colIndex >= 5 ? "right-0" : "left-0"
                  }`}
                >
                  <p className="text-xs font-medium text-muted-foreground px-1 mb-1">
                    {format(day, "MMM d")} — {dayEvents.length} events
                  </p>
                  {dayEvents.map((event, i) => (
                    <button
                      key={i}
                      className={`block w-full text-left text-xs leading-snug px-1.5 py-1 rounded truncate hover:brightness-95 dark:hover:brightness-110 transition-all ${eventColors[event.type]}`}
                      title={event.label}
                      aria-label={event.label}
                      onClick={() => {
                        setExpandedDay(null);
                        onCardClick?.(event.card);
                      }}
                    >
                      {event.shortLabel} {event.card.card_name}{event.card.last_digits && <span className="opacity-60"> ••• {event.card.last_digits}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile expanded day bottom sheet */}
      {expandedDay && (
        <div className="sm:hidden fixed inset-x-0 bottom-14 z-30 bg-popover border-t rounded-t-xl shadow-lg p-3 space-y-1 animate-in slide-in-from-bottom max-h-[60vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-muted-foreground px-1">
              {(() => {
                const day = days.find((d) => d.toISOString() === expandedDay);
                if (!day) return "";
                const evts = getEventsForDay(day);
                return `${format(day, "MMM d")} — ${evts.length} events`;
              })()}
            </p>
            <button onClick={() => setExpandedDay(null)} className="text-xs text-muted-foreground hover:text-foreground px-1">
              Close
            </button>
          </div>
          {(() => {
            const day = days.find((d) => d.toISOString() === expandedDay);
            if (!day) return null;
            return getEventsForDay(day).map((event, i) => (
              <button
                key={i}
                className={`block w-full text-left text-sm leading-snug px-2 py-1.5 rounded truncate hover:brightness-95 dark:hover:brightness-110 transition-all ${eventColors[event.type]}`}
                title={event.label}
                aria-label={event.label}
                onClick={() => {
                  setExpandedDay(null);
                  onCardClick?.(event.card);
                }}
              >
                {event.shortLabel} {event.card.card_name}{event.card.last_digits && <span className="opacity-60"> ••• {event.card.last_digits}</span>}
              </button>
            ));
          })()}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-blue-100 dark:bg-blue-900/30" />
          Card Anniversary
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-purple-100 dark:bg-purple-900/30" />
          Spend Deadline
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-green-100 dark:bg-green-900/30" />
          Bonus Deadline
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-amber-100 dark:bg-amber-900/30" />
          Annual Fee Due
        </div>
      </div>
    </div>
  );
}
