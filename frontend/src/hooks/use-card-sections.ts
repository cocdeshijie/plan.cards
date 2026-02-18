"use client";

import { useEffect, useState } from "react";

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

export function useCardSections(cardId: number) {
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({ ...DEFAULTS });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(storageKey(cardId));
      setSections(stored ? { ...DEFAULTS, ...JSON.parse(stored) } : { ...DEFAULTS });
    } catch {
      setSections({ ...DEFAULTS });
    }
  }, [cardId]);

  const toggle = (key: SectionKey) => {
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(storageKey(cardId), JSON.stringify(next));
      return next;
    });
  };

  const expand = (key: SectionKey) => {
    setSections((prev) => {
      if (prev[key]) return prev;
      const next = { ...prev, [key]: true };
      localStorage.setItem(storageKey(cardId), JSON.stringify(next));
      return next;
    });
  };

  const isExpanded = (key: SectionKey) => !!sections[key];

  return { isExpanded, toggle, expand };
}
