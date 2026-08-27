"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addDays,
  addMonths,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useToday } from "@/hooks/use-timezone";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DatePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
}

const WEEKDAYS = [
  { short: "Su", long: "Sunday" },
  { short: "Mo", long: "Monday" },
  { short: "Tu", long: "Tuesday" },
  { short: "We", long: "Wednesday" },
  { short: "Th", long: "Thursday" },
  { short: "Fr", long: "Friday" },
  { short: "Sa", long: "Saturday" },
];

export function DatePicker({ value, onChange, placeholder = "Pick a date", className }: DatePickerProps) {
  const today = useToday();
  const [open, setOpen] = React.useState(false);
  // One state drives both the visible month and the grid's single tab stop: the
  // calendar always shows the month `focusedDate` falls in. Keeping them apart
  // let them drift, and 42 day buttons each being tabbable made the grid
  // unusable from the keyboard.
  const [focusedDate, setFocusedDate] = React.useState<Date>(() => value || new Date());
  // Only pull DOM focus when the user drove the move from the keyboard —
  // otherwise re-renders would steal focus from whatever Radix put it on.
  const shouldFocusRef = React.useRef(false);
  const rovingRef = React.useRef<HTMLButtonElement | null>(null);

  const viewMonth = focusedDate;

  React.useEffect(() => {
    if (value) setFocusedDate(value);
  }, [value]);

  React.useEffect(() => {
    if (!shouldFocusRef.current) return;
    shouldFocusRef.current = false;
    rovingRef.current?.focus();
  }, [focusedDate]);

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const handleSelect = (day: Date) => {
    setFocusedDate(day);
    onChange(day);
    setOpen(false);
  };

  const moveFocus = (day: Date) => {
    shouldFocusRef.current = true;
    setFocusedDate(day);
  };

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: Date;
    switch (e.key) {
      case "ArrowLeft":
        next = addDays(focusedDate, -1);
        break;
      case "ArrowRight":
        next = addDays(focusedDate, 1);
        break;
      case "ArrowUp":
        next = addDays(focusedDate, -7);
        break;
      case "ArrowDown":
        next = addDays(focusedDate, 7);
        break;
      case "Home":
        next = startOfWeek(focusedDate);
        break;
      case "End":
        next = endOfWeek(focusedDate);
        break;
      case "PageUp":
        next = subMonths(focusedDate, 1);
        break;
      case "PageDown":
        next = addMonths(focusedDate, 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    moveFocus(next);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        // Re-anchor the roving tab stop each time the picker opens.
        if (next) setFocusedDate(value ?? today);
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-9",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarDays className="mr-2 h-4 w-4 shrink-0" />
          {value ? format(value, "MMM d, yyyy") : placeholder}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-auto rounded-xl border bg-popover p-3 shadow-lg"
          sideOffset={4}
          align="start"
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2 gap-1">
            <button
              type="button"
              aria-label={`Previous month, ${format(subMonths(viewMonth, 1), "MMMM yyyy")}`}
              className="h-7 w-7 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setFocusedDate(subMonths(viewMonth, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1">
              <Select
                value={String(viewMonth.getMonth())}
                onValueChange={(val) => {
                  // Anchor on the 1st: setMonth() preserves the day-of-month, so
                  // from Jan 31 picking February produced Feb 31 -> March 2,
                  // making February unreachable from the dropdown entirely.
                  setFocusedDate(new Date(viewMonth.getFullYear(), parseInt(val), 1));
                }}
              >
                <SelectTrigger
                  aria-label="Month"
                  className="h-7 w-auto border-none shadow-none px-2 py-0 text-sm font-medium"
                >
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
                value={String(viewMonth.getFullYear())}
                onValueChange={(val) => {
                  // Anchor on the 1st — from Feb 29 2024, setFullYear(2025)
                  // produced March 1 2025.
                  setFocusedDate(new Date(parseInt(val), viewMonth.getMonth(), 1));
                }}
              >
                <SelectTrigger
                  aria-label="Year"
                  className="h-7 w-auto border-none shadow-none px-2 py-0 text-sm font-medium"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 41 }, (_, i) => {
                    const y = new Date().getFullYear() - 20 + i;
                    return <SelectItem key={y} value={String(y)}>{y}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <button
              type="button"
              aria-label={`Next month, ${format(addMonths(viewMonth, 1), "MMMM yyyy")}`}
              className="h-7 w-7 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setFocusedDate(addMonths(viewMonth, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Day grid — role="grid" with one roving tab stop and arrow-key navigation */}
          <div
            role="grid"
            aria-label={format(viewMonth, "MMMM yyyy")}
            className="space-y-0.5"
            onKeyDown={handleGridKeyDown}
          >
            <div role="row" className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((d) => (
                <div
                  key={d.long}
                  role="columnheader"
                  aria-label={d.long}
                  className="h-8 w-10 sm:w-8 flex items-center justify-center text-xs text-muted-foreground font-medium"
                >
                  <span aria-hidden="true">{d.short}</span>
                </div>
              ))}
            </div>
            {weeks.map((week) => (
              <div key={week[0].toISOString()} role="row" className="grid grid-cols-7 gap-0.5">
                {week.map((day) => {
                  const isSelected = !!value && isSameDay(day, value);
                  const isCurrentMonth = isSameMonth(day, viewMonth);
                  const isToday = isSameDay(day, today);
                  const isRoving = isSameDay(day, focusedDate);

                  return (
                    <div
                      key={day.toISOString()}
                      role="gridcell"
                      aria-selected={isSelected}
                      className="flex items-center justify-center"
                    >
                      <button
                        ref={isRoving ? rovingRef : undefined}
                        type="button"
                        // Full date, not "7" — a screen reader reading 42 bare
                        // numerals gives no way to tell which month or weekday.
                        aria-label={format(day, "EEEE, MMMM d, yyyy")}
                        aria-current={isToday ? "date" : undefined}
                        tabIndex={isRoving ? 0 : -1}
                        onClick={() => handleSelect(day)}
                        className={cn(
                          "h-10 w-10 sm:h-8 sm:w-8 inline-flex items-center justify-center rounded-md text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          // Leading/trailing days stay selectable, so they get a
                          // readable muted colour rather than the old 40% wash
                          // with hover switched off, which read as disabled.
                          !isCurrentMonth && "text-muted-foreground",
                          isToday && !isSelected && "bg-accent font-semibold",
                          isSelected && "bg-primary text-primary-foreground hover:bg-primary/90"
                        )}
                      >
                        <span aria-hidden="true">{format(day, "d")}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Clear button */}
          {value && (
            <div className="mt-2 pt-2 border-t">
              <button
                type="button"
                className="flex items-center gap-1 min-h-[44px] sm:min-h-0 text-xs text-muted-foreground hover:text-foreground rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
              >
                <X className="h-3 w-3" /> Clear
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
