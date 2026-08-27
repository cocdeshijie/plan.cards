"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Reactive media query that is correct on the FIRST commit.
 *
 * `useState(false)` corrected by a passive effect meant every component mounted
 * after hydration started on the mobile branch: `CardDetailResponsive` remounts
 * on each card click, so desktop users got one frame of the vaul Drawer
 * (overlay + body scale) before it swapped to the Dialog.
 *
 * useSyncExternalStore reads `matchMedia` during render, while still handing the
 * server — and the hydration pass — a stable `false`, so the initial HTML and
 * the first client render agree and there is no hydration mismatch.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
