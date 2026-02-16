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

export function DatePicker({ value, onChange, placeholder = "Pick a date", className }: DatePickerProps) {
  const today = useToday();
  const [open, setOpen] = React.useState(false);
  const [viewMonth, setViewMonth] = React.useState(() => value || new Date());

  React.useEffect(() => {
    if (value) setViewMonth(value);
  }, [value]);

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const handleSelect = (day: Date) => {
    onChange(day);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-9",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarDays className="mr-2 h-4 w-4" />
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
          <div className="flex items-center justify-between mb-2">
            <button
              className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent"
              onClick={() => setViewMonth(subMonths(viewMonth, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1">
              <Select
                value={String(viewMonth.getMonth())}
                onValueChange={(val) => {
                  const newMonth = new Date(viewMonth);
                  newMonth.setMonth(parseInt(val));
                  setViewMonth(newMonth);
                }}
              >
                <SelectTrigger className="h-7 w-auto border-none shadow-none px-2 py-0 text-sm font-medium focus:ring-0">
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
                  const newMonth = new Date(viewMonth);
                  newMonth.setFullYear(parseInt(val));
                  setViewMonth(newMonth);
                }}
              >
                <SelectTrigger className="h-7 w-auto border-none shadow-none px-2 py-0 text-sm font-medium focus:ring-0">
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
              className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent"
              onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-0">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <div key={d} className="h-8 w-8 flex items-center justify-center text-xs text-muted-foreground font-medium">
                {d}
              </div>
            ))}
            {days.map((day) => {
              const isSelected = value && isSameDay(day, value);
              const isCurrentMonth = isSameMonth(day, viewMonth);
              const isToday = isSameDay(day, today);

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => handleSelect(day)}
                  className={cn(
                    "h-8 w-8 inline-flex items-center justify-center rounded-md text-sm transition-colors",
                    !isCurrentMonth && "text-muted-foreground/40",
                    isCurrentMonth && "hover:bg-accent",
                    isToday && !isSelected && "bg-accent font-semibold",
                    isSelected && "bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>

          {/* Clear button */}
          {value && (
            <div className="mt-2 pt-2 border-t">
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
