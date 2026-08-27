"use client";

import { useEffect, useRef, useState } from "react";

const SECTION_KEYS = ["af", "benefits", "retention", "bonuses", "rewards"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

const DEFAULTS: Record<SectionKey, boolean> = {
  af: false,
  benefits: false,
  retention: false,
  bonuses: false,
  rewards: false,
};

function storageKey(cardId: number) {
  return `card-sections-${cardId}`;
}

function readSections(cardId: number): Record<SectionKey, boolean> {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const stored = localStorage.getItem(storageKey(cardId));
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function persistSections(cardId: number, sections: Record<SectionKey, boolean>) {
  try {
    localStorage.setItem(storageKey(cardId), JSON.stringify(sections));
  } catch {
    // Blocked site data or an exhausted quota — the expansion just doesn't
    // persist. This used to run inside the setSections updater, i.e. in the
    // render phase, where the throw escaped to the ErrorBoundary and blanked
    // the whole app.
  }
}

export function useCardSections(cardId: number) {
  // Lazy initialiser, not an effect: reading storage one commit later showed
  // every section collapsed for a frame, then jolted open on card open.
  const [sections, setSections] = useState<Record<SectionKey, boolean>>(() => readSections(cardId));

  // Mirrors `sections` for the handlers below. The old code read the latest
  // value via a `setSections(prev => …)` updater; that is where the unguarded
  // write lived, so the write moved out — and the ref keeps two calls in the
  // same tick from clobbering each other the way plain closed-over state would.
  const latest = useRef(sections);

  // Only re-read when the hook is reused for a *different* card without
  // remounting; the initialiser already covered the first one.
  const loadedCardId = useRef(cardId);
  useEffect(() => {
    if (loadedCardId.current === cardId) return;
    loadedCardId.current = cardId;
    const next = readSections(cardId);
    latest.current = next;
    setSections(next);
  }, [cardId]);

  const apply = (next: Record<SectionKey, boolean>) => {
    latest.current = next;
    setSections(next);
    persistSections(cardId, next);
  };

  const toggle = (key: SectionKey) => {
    apply({ ...latest.current, [key]: !latest.current[key] });
  };

  const expand = (key: SectionKey) => {
    if (latest.current[key]) return;
    apply({ ...latest.current, [key]: true });
  };

  const isExpanded = (key: SectionKey) => !!sections[key];

  return { isExpanded, toggle, expand };
}
