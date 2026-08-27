import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, onWheel, ...props }, ref) => {
    // A focused number input swallows wheel events and steps its own value, so
    // scrolling a dialog past one silently edits data. Blur instead and let the
    // scroll fall through to the page.
    const handleWheel = React.useCallback(
      (e: React.WheelEvent<HTMLInputElement>) => {
        onWheel?.(e);
        if (type === "number" && e.currentTarget === document.activeElement) {
          e.currentTarget.blur();
        }
      },
      [onWheel, type]
    );

    return (
      <input
        type={type}
        className={cn(
          // 16px below md: anything smaller makes iOS Safari zoom the page on
          // focus, and it never zooms back out on blur. The guard lives on a
          // `max-md:` key rather than a `text-base md:text-sm` pair because
          // tailwind-merge resolves conflicts per (modifier, group): a call
          // site's `text-xs` only replaces the unprefixed size, so a `md:`
          // variant in the base list would survive and win on desktop. This
          // way the unprefixed `text-sm` stays fully overridable — `text-xs`
          // call sites keep 12px on desktop — while every input still renders
          // at 16px on mobile.
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm max-md:text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        onWheel={handleWheel}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
