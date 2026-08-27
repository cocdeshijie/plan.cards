"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, CreditCard, Lock } from "lucide-react";

// Labels must match TopNav's navLinks and each route's own h1 verbatim — the
// same page called "Details" here and "Card details" on desktop reads as two
// different destinations.
const tabs = [
  { href: "/summary", label: "Summary", icon: LayoutDashboard },
  { href: "/cards", label: "Cards", icon: CreditCard },
  { href: "/card-details", label: "Card details", icon: Lock },
];

export function BottomTabs() {
  const pathname = usePathname();

  return (
    // pb-[env(...)] is a no-op until the viewport opts into `viewport-fit=cover`,
    // but it is what keeps the bar clear of the home indicator if it ever does.
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur border-t pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-stretch justify-around h-14">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs transition-colors ${
                active ? "text-primary font-semibold" : "text-muted-foreground font-medium"
              }`}
            >
              {/* Colour alone carried the active state, and text-primary vs
                  text-muted-foreground is a weak signal at 12px. The rule plus
                  the weight change give it two more. */}
              {active && (
                <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary" />
              )}
              <tab.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="max-w-full truncate">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
