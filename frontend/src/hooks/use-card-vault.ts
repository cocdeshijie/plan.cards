"use client";

import { create } from "zustand";
import type { CardSecretRevealed } from "@/types";
import { revealCardSecret } from "@/lib/api";

/**
 * Decrypted card details for the current session.
 *
 * This is a store rather than page state on purpose. The whole point of the
 * page is to reveal a number and paste it into a checkout that lives somewhere
 * else — another route, or more often another browser tab. Page-local state is
 * unmounted by a Next.js route change, which would drop what the user just
 * revealed at exactly the moment they went to use it. For the same reason there
 * is deliberately no `visibilitychange` handler hiding values on tab blur.
 *
 * What does clear it: the auto-hide timer, an explicit hide, a 401, and a
 * reload. Nothing is ever written to localStorage or sessionStorage — Firefox
 * persists session storage to sessionstore.js on disk, so "session" storage is
 * not memory-only in the way the name suggests.
 */

const AUTO_HIDE_KEY = "vault-auto-hide-seconds";
const DEFAULT_AUTO_HIDE = 300;

/** Off, plus the range Bitwarden and KeePassXC settled on. */
export const AUTO_HIDE_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 60, label: "1 min" },
  { value: 300, label: "5 min" },
  { value: 900, label: "15 min" },
];

interface CardVaultState {
  revealed: Record<number, CardSecretRevealed>;
  autoHideSeconds: number;
  /** Epoch ms when everything currently revealed will be hidden, or null. */
  expiresAt: number | null;
  loadingIds: number[];

  reveal: (cardId: number) => Promise<void>;
  /** Resolves with how many succeeded and failed, so the caller can report it —
   *  a bulk action that silently does nothing is worse than an error. */
  revealMany: (cardIds: number[]) => Promise<{ revealed: number; failed: number }>;
  hide: (cardId: number) => void;
  hideAll: () => void;
  setAutoHideSeconds: (seconds: number) => void;
  /** Called from a 1s interval on the page; hides everything once expired. */
  checkExpiry: () => void;
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * In-flight reveals, so concurrent callers share one request.
 *
 * Kept outside the store because it is transport bookkeeping, not state
 * anything renders. It matters now that two benefit tiles can ask for the same
 * card in quick succession: skipping the second call would resolve it before
 * the value existed, and firing a second POST would decrypt the same row twice.
 */
const inFlight = new Map<number, Promise<void>>();

function clearTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export const useCardVault = create<CardVaultState>((set, get) => {
  /** Restart the countdown. Any new reveal resets it, so the clock always
   *  measures "time since you last looked", not since the first reveal. */
  function armTimer() {
    clearTimer();
    const { autoHideSeconds } = get();
    if (autoHideSeconds <= 0) {
      set({ expiresAt: null });
      return;
    }
    const expiresAt = Date.now() + autoHideSeconds * 1000;
    set({ expiresAt });
    hideTimer = setTimeout(() => get().hideAll(), autoHideSeconds * 1000);
  }

  return {
    revealed: {},
    autoHideSeconds: DEFAULT_AUTO_HIDE,
    expiresAt: null,
    loadingIds: [],

    reveal: async (cardId) => {
      if (get().revealed[cardId]) return;
      // Return the running request rather than starting a second one — and
      // rather than returning early, which would tell the caller it had
      // succeeded before anything was decrypted.
      const running = inFlight.get(cardId);
      if (running) return running;

      const request = (async () => {
        set((s) => ({ loadingIds: [...s.loadingIds, cardId] }));
        try {
          const data = await revealCardSecret(cardId);
          set((s) => ({ revealed: { ...s.revealed, [cardId]: data } }));
          armTimer();
        } finally {
          set((s) => ({ loadingIds: s.loadingIds.filter((id) => id !== cardId) }));
          inFlight.delete(cardId);
        }
      })();

      inFlight.set(cardId, request);
      return request;
    },

    revealMany: async (cardIds) => {
      // Exclude ids already in flight from a single-row click, or this batch's
      // `finally` would clear their loading state while that request is still
      // running and the row's spinner would stop early.
      const { revealed: already, loadingIds: inFlight } = get();
      const missing = cardIds.filter((id) => !already[id] && !inFlight.includes(id));
      if (!missing.length) return { revealed: 0, failed: 0 };
      set((s) => ({ loadingIds: [...s.loadingIds, ...missing] }));
      try {
        const results = await Promise.all(
          missing.map((id) =>
            revealCardSecret(id).then(
              (data) => [id, data] as const,
              // One failure must not sink the batch — the rest are still useful.
              () => null,
            ),
          ),
        );
        const next: Record<number, CardSecretRevealed> = { ...get().revealed };
        let ok = 0;
        for (const entry of results) {
          if (entry) {
            next[entry[0]] = entry[1];
            ok++;
          }
        }
        set({ revealed: next });
        // Only arm the countdown if something actually became visible; otherwise
        // a total failure leaves a timer ticking towards a no-op hideAll.
        if (ok > 0) armTimer();
        return { revealed: ok, failed: missing.length - ok };
      } finally {
        set((s) => ({ loadingIds: s.loadingIds.filter((id) => !missing.includes(id)) }));
      }
    },

    hide: (cardId) => {
      set((s) => {
        const next = { ...s.revealed };
        delete next[cardId];
        return { revealed: next };
      });
      if (!Object.keys(get().revealed).length) {
        clearTimer();
        set({ expiresAt: null });
      }
    },

    hideAll: () => {
      clearTimer();
      set({ revealed: {}, expiresAt: null });
    },

    setAutoHideSeconds: (seconds) => {
      set({ autoHideSeconds: seconds });
      try {
        localStorage.setItem(AUTO_HIDE_KEY, String(seconds));
      } catch {
        // Private mode or a blocked storage partition — the preference just
        // doesn't persist. Not worth surfacing.
      }
      if (Object.keys(get().revealed).length) armTimer();
      else set({ expiresAt: null });
    },

    checkExpiry: () => {
      const { expiresAt } = get();
      if (expiresAt !== null && Date.now() >= expiresAt) get().hideAll();
    },
  };
});

/** Hydrate the saved preference. Called from the page on mount, so SSR and the
 *  first client render agree on the default. */
export function hydrateAutoHidePreference() {
  try {
    const raw = localStorage.getItem(AUTO_HIDE_KEY);
    if (raw === null) return;
    const parsed = parseInt(raw, 10);
    if (AUTO_HIDE_OPTIONS.some((o) => o.value === parsed)) {
      useCardVault.setState({ autoHideSeconds: parsed });
    }
  } catch {
    // ignore
  }
}

if (typeof window !== "undefined") {
  // A session that ends must not leave plaintext in memory for whoever logs in
  // next on a shared machine.
  window.addEventListener("auth:unauthorized", () => useCardVault.getState().hideAll());
}
