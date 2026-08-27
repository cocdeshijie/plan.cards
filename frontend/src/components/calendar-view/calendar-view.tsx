"use client";

import { useEffect, useMemo, useState } from "react";
import type { Card, Profile } from "@/types";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
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
import { cn, formatCurrency, parseDateStr } from "@/lib/utils";
import { maskLastDigits } from "@/lib/card-number";
import { getAnniversaryForYear } from "@/lib/fee-utils";

interface CalendarViewProps {
  cards: Card[];
  profiles: Profile[];
  onCardClick?: (card: Card) => void;
}

type CalendarEventType = "anniversary" | "spend_deadline" | "annual_fee_due" | "bonus_deadline";

interface CalendarEvent {
  date: Date;
  type: CalendarEventType;
  card: Card;
  label: string;
}

/**
 * One source of truth for a calendar event type's name, pictogram and colour.
 *
 * The legend used to hard-code four swatches carrying only the background half
 * of the chip class, which in dark mode is four near-black squares — the chips
 * are recognised by their bright `dark:text-*-300`. Sharing the whole class and
 * putting the pictogram inside the swatch also teaches the mapping, which is
 * what the phone-sized chips rely on.
 */
const EVENT_META: Record<CalendarEventType, { label: string; icon: string; className: string }> = {
  anniversary: {
    label: "Card Anniversary",
    icon: "🎂",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  },
  spend_deadline: {
    label: "Spend Deadline",
    icon: "💰",
    className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  },
  bonus_deadline: {
    label: "Bonus Deadline",
    icon: "⭐",
    className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  annual_fee_due: {
    label: "Annual Fee Due",
    // Was the jargon "AF" among three pictograms; now every type is a pictogram
    // and the legend spells each one out.
    icon: "💳",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
};

const LEGEND_ORDER: CalendarEventType[] = ["anniversary", "spend_deadline", "bonus_deadline", "annual_fee_due"];

const EVENT_TYPE_PRIORITY: Record<CalendarEventType, number> = {
  spend_deadline: 0,
  bonus_deadline: 1,
  anniversary: 2,
  annual_fee_due: 3,
};

/** Chips shown inline in a day cell before it collapses into "+N more". */
const MAX_CHIPS_PER_DAY = 3;

const MONTH_STORAGE_KEY = "cards-calendar-month";

/** The month to open on: whatever was last viewed, else the current one. */
function restoreMonth(fallback: Date): Date {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(MONTH_STORAGE_KEY);
    const parsed = stored && /^\d{4}-\d{2}$/.test(stored) ? stored.split("-") : null;
    if (parsed) return new Date(Number(parsed[0]), Number(parsed[1]) - 1, 1);
  } catch {
    // Private mode / storage disabled — fall through to today.
  }
  return fallback;
}

export function CalendarView({ cards, profiles, onCardClick }: CalendarViewProps) {
  const today = useToday();
  // Radix unmounts an inactive TabsContent, so every trip through the List or
  // Timeline tab remounts this component. The tab choice is persisted; the
  // month within it has to be too, or browsing to 2019 and glancing at another
  // tab throws the position away.
  const [currentMonth, setCurrentMonth] = useState<Date>(() => restoreMonth(today));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(MONTH_STORAGE_KEY, format(currentMonth, "yyyy-MM"));
    } catch {
      // Ignore: persisting the month is a convenience, not a requirement.
    }
  }, [currentMonth]);

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
        const openYear = openDate.getFullYear();
        const hasFee = card.annual_fee && card.annual_fee > 0;
        // The grid always renders leading days of the previous month and
        // trailing days of the next, so viewing January 2026 shows cells from
        // late December 2025. Covering only [year, year+1] silently dropped
        // anniversaries falling in those leading cells.
        for (const yr of [year - 1, year, year + 1]) {
          // yearRange reaches back five years, so without this the calendar
          // cheerfully drew anniversaries for years the card did not exist —
          // and a "0 year" one on the open date itself.
          if (yr <= openYear) continue;
          const anniversary = getAnniversaryForYear(openDate, yr);
          const years = yr - openYear;
          events.push({
            date: anniversary,
            type: "anniversary",
            card,
            label: hasFee
              ? `${prefix}${card.card_name} ${years}yr anniversary (~${formatCurrency(card.annual_fee)} fee)`
              : `${prefix}${card.card_name} ${years}yr anniversary`,
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
        });
      }
      if (card.annual_fee_date) {
        const afDate = parseDateStr(card.annual_fee_date);
        events.push({
          date: afDate,
          type: "annual_fee_due",
          card,
          // formatCurrency, not string interpolation: the timeline renders the
          // same field as "$1,200" while this read "$1200".
          label: `${prefix}${card.card_name} ${formatCurrency(card.annual_fee ?? 0)} annual fee due`,
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

  const getEventsForDay = (day: Date) =>
    calendarEvents
      .filter((e) => isSameDay(e.date, day))
      .sort((a, b) => EVENT_TYPE_PRIORITY[a.type] - EVENT_TYPE_PRIORITY[b.type]);

  const goToToday = () => setCurrentMonth(today);

  // The detail panel only makes sense for a day the grid is actually showing,
  // so navigating away from the selected day's month hides it with no extra
  // state to reset. One filter over an already-built array; no memo needed.
  const selectedDayEvents =
    selectedDay && days.some((d) => isSameDay(d, selectedDay)) ? getEventsForDay(selectedDay) : [];

  const yearRange = useMemo(() => {
    const currentYear = today.getFullYear();
    const viewedYear = currentMonth.getFullYear();
    // Include the viewed year. The chevrons advance currentMonth without bound,
    // so navigating past currentYear + 2 left the Select with no matching item
    // and Radix rendered an empty trigger — the year label vanished while the
    // grid still showed that year.
    let minYear = Math.min(currentYear - 5, viewedYear);
    for (const card of cards) {
      if (card.open_date) {
        const yr = parseDateStr(card.open_date).getFullYear();
        if (yr < minYear) minYear = yr;
      }
    }
    const maxYear = Math.max(currentYear + 2, viewedYear);
    return Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  }, [cards, today, currentMonth]);

  // 44px below sm, the original 36px at sm+ where a pointer is likely.
  const navButtonClass = "h-11 w-11 shrink-0 sm:h-9 sm:w-9";
  // No focus:ring-0: it beat the primitive's focus:ring-1 under twMerge while
  // focus:outline-none survived, leaving these two with no focus affordance at
  // all. border-transparent keeps the borderless look without removing the box.
  const monthYearTriggerClass =
    "h-auto min-h-[44px] w-auto border-transparent shadow-none px-2 py-1 text-base font-semibold sm:h-8 sm:min-h-0 sm:py-0 sm:text-lg";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="icon"
          className={navButtonClass}
          aria-label="Previous month"
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1 sm:gap-2 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <Select
              value={String(currentMonth.getMonth())}
              onValueChange={(val) => {
                // Anchor on the 1st: setMonth() preserves the day, so from the
                // 31st picking a 30-day month overflowed into the next one.
                setCurrentMonth(new Date(currentMonth.getFullYear(), parseInt(val), 1));
              }}
            >
              <SelectTrigger className={monthYearTriggerClass} aria-label="Calendar month">
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
                setCurrentMonth(new Date(parseInt(val), currentMonth.getMonth(), 1));
              }}
            >
              <SelectTrigger className={monthYearTriggerClass} aria-label="Calendar year">
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
            className="h-auto min-h-[44px] px-3 text-xs sm:h-7 sm:min-h-0 sm:px-2"
            onClick={goToToday}
          >
            Today
          </Button>
        </div>
        <Button
          variant="outline"
          size="icon"
          className={navButtonClass}
          aria-label="Next month"
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
        >
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
            <span className="sm:hidden" aria-hidden="true">{day.short}</span>
            <span className="sr-only sm:hidden">{day.full}</span>
          </div>
        ))}
        {days.map((day) => {
          const dayEvents = getEventsForDay(day);
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, today);
          const isSelected = selectedDay !== null && isSameDay(day, selectedDay);
          const dayKey = format(day, "yyyy-MM-dd");
          const visibleEvents = dayEvents.slice(0, MAX_CHIPS_PER_DAY);
          const overflowCount = dayEvents.length - visibleEvents.length;
          const dayNumberBase =
            "mb-1 flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium";
          // Adjacent-month days stay legible; they are dimmed, not faded out.
          const dayNumberTone = isToday
            ? "bg-primary text-primary-foreground ring-2 ring-primary/20"
            : !isCurrentMonth
              ? "text-muted-foreground/70"
              : dayEvents.length > 0
                ? "text-foreground"
                : "text-muted-foreground";

          return (
            <div
              key={dayKey}
              className={cn(
                // min-h so an empty week does not collapse to ~44px while a
                // Jan-1 fee cluster inflates its neighbour.
                "bg-background p-1 sm:p-2 min-h-[4.5rem] sm:min-h-[6.5rem]",
                // Adjacent-month cells used to take opacity-40 on the WHOLE
                // cell, which made their (real, clickable) chips unreadable.
                // Dim the ground and the date instead, never the chips.
                !isCurrentMonth && "bg-muted/30",
                // Not a translucent tint: the grid's 1px lines come from a
                // `bg-muted` parent showing through the gaps, so bg-primary/5
                // replaced bg-background and let that muted grey through.
                isToday && "ring-1 ring-inset ring-primary/50",
                isSelected && "ring-1 ring-inset ring-ring",
              )}
            >
              {dayEvents.length > 0 ? (
                // Only days that HAVE events become a control, so the month
                // does not add 42 empty tab stops.
                <button
                  type="button"
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                  aria-pressed={isSelected}
                  aria-label={`${format(day, "MMMM d, yyyy")} \u2014 ${dayEvents.length} event${dayEvents.length !== 1 ? "s" : ""}`}
                  className={cn(
                    dayNumberBase,
                    dayNumberTone,
                    "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    !isToday && "hover:bg-muted",
                  )}
                >
                  {format(day, "d")}
                </button>
              ) : (
                <div className={cn(dayNumberBase, dayNumberTone)}>{format(day, "d")}</div>
              )}
              <div className="space-y-0.5">
                {visibleEvents.map((event, i) => {
                  const meta = EVENT_META[event.type];
                  return (
                    <button
                      key={i}
                      type="button"
                      className={cn(
                        "flex w-full min-h-[26px] items-center gap-1 rounded px-1 py-1 text-left text-[11px] leading-snug sm:px-1.5",
                        "hover:brightness-95 dark:hover:brightness-110 transition-all",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                        meta.className,
                      )}
                      title={event.label}
                      aria-label={event.label}
                      onClick={() => onCardClick?.(event.card)}
                    >
                      {/* Below sm the pictogram is the ENTIRE chip, so it is
                          sized up rather than down; at sm+ it sits next to the
                          name and matches its 11px. */}
                      <span aria-hidden="true" className="text-sm leading-none sm:text-[11px]">{meta.icon}</span>
                      {/* Below sm a 7-column grid gives each cell ~30px of text
                          width, which no card name survives. The day button
                          above opens the named list under the grid instead. */}
                      <span className="hidden min-w-0 sm:block sm:truncate">
                        {event.card.card_name}
                        {event.card.last_digits && (
                          <span className="opacity-60"> {maskLastDigits(event.card.last_digits)}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
                {overflowCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    aria-label={`Show all ${dayEvents.length} events on ${format(day, "MMMM d, yyyy")}`}
                    className="flex w-full min-h-[22px] items-center rounded px-1 text-left text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:px-1.5 sm:text-[11px]"
                  >
                    <span className="sm:hidden" aria-hidden="true">+{overflowCount}</span>
                    <span className="hidden sm:inline" aria-hidden="true">+{overflowCount} more</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedDay && selectedDayEvents.length > 0 && (
        <div className="rounded-xl border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{format(selectedDay, "EEEE, MMMM d, yyyy")}</p>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 sm:h-8 sm:w-8"
              aria-label="Close day details"
              onClick={() => setSelectedDay(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <ul className="space-y-1">
            {selectedDayEvents.map((event, i) => {
              const meta = EVENT_META[event.type];
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onCardClick?.(event.card)}
                    className="flex w-full min-h-[44px] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span
                      className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px]", meta.className)}
                      aria-hidden="true"
                    >
                      {meta.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={event.label}>{event.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {LEGEND_ORDER.map((type) => {
          const meta = EVENT_META[type];
          return (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className={cn("inline-flex h-5 w-5 items-center justify-center rounded text-[11px]", meta.className)}
                aria-hidden="true"
              >
                {meta.icon}
              </span>
              {meta.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
