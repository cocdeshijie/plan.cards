"use client";

import { create } from "zustand";
import { toast } from "sonner";
import type { Card, Profile, AppSettings, AuthMode, UserBrief } from "@/types";
import {
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  verifyAuth,
  getAuthMode,
  getSetupStatus,
  getProfiles,
  getCards,
  getSettings,
  updateSettings,
  SESSION_EXPIRED_MESSAGE,
} from "@/lib/api";

interface AppState {
  // Setup & auth
  setupComplete: boolean | null; // null = loading
  hasExistingData: boolean;
  authMode: AuthMode | null;
  registrationEnabled: boolean;
  oauthProviders: { name: string; display_name: string }[];
  authed: boolean;
  authLoading: boolean;
  currentUser: UserBrief | null;

  // Data
  dataLoading: boolean;
  dataError: string | null;
  profiles: Profile[];
  cards: Card[];
  selectedProfileId: string;
  darkMode: boolean;
  timezone: string;
  serverTimezone: string;

  // Actions
  checkSetup: () => Promise<void>;
  fetchAuthMode: () => Promise<void>;
  checkAuth: () => Promise<void>;
  login: (body: { username?: string; password?: string }) => Promise<void>;
  register: (body: { username: string; password: string; display_name?: string; email?: string }) => Promise<void>;
  logout: () => void;
  setSetupComplete: () => void;
  loadData: () => Promise<void>;
  refresh: () => Promise<void>;
  setSelectedProfileId: (id: string) => void;
  toggleDarkMode: () => void;
  setTimezone: (tz: string) => Promise<void>;
}

/** Bumped on logout so in-flight requests from the old session are discarded. */
let sessionGeneration = 0;

const DARK_MODE_KEY = "darkMode";
const PROFILE_KEY = "selectedProfileId";

/**
 * localStorage does not merely return null when a browser is configured to
 * block site data — touching it throws. checkAuth() read it *before*
 * `set({ authLoading: false })`, and app-shell's boot effect has no .catch, so
 * the app hung on a full-screen spinner forever. The inline boot script in
 * layout.tsx wraps the identical access for this reason.
 */
function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage or an exhausted quota — the preference just doesn't
    // persist across reloads. Never worth breaking the interaction over.
  }
}

function prefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function getInitialDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  const stored = readStored(DARK_MODE_KEY);
  if (stored !== null) return stored === "true";
  return prefersDark();
}

/**
 * Apply only — persisting is deliberately separate.
 *
 * This used to write to localStorage on every boot, which turned a *derived* OS
 * preference into a stored one: getInitialDarkMode then short-circuits forever
 * and the OS is never consulted again. With only a binary toggle and no
 * "System" option, a user who first visited in daylight was pinned to light
 * mode for good. Only an explicit toggle persists now, and the OS listener at
 * the bottom of this file keeps following the system until then.
 */
function applyDarkMode(dark: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", dark);
}

export const useAppStore = create<AppState>((set, get) => ({
  setupComplete: null,
  hasExistingData: false,
  authMode: null,
  registrationEnabled: false,
  oauthProviders: [],
  authed: false,
  authLoading: true,
  currentUser: null,
  dataLoading: true,
  dataError: null,
  profiles: [],
  cards: [],
  selectedProfileId: "all",
  darkMode: false,
  timezone: "",
  serverTimezone: "",

  checkSetup: async () => {
    try {
      const status = await getSetupStatus();
      set({ setupComplete: status.setup_complete, hasExistingData: status.has_existing_data });
    } catch {
      // If setup endpoint fails, assume setup is complete (backward compat)
      set({ setupComplete: true });
    }
  },

  fetchAuthMode: async () => {
    try {
      const mode = await getAuthMode();
      set({
        authMode: mode.auth_mode,
        registrationEnabled: mode.registration_enabled,
        oauthProviders: mode.oauth_providers,
      });
    } catch {
      set({ authMode: "single_password" });
    }
  },

  checkAuth: async () => {
    const dark = getInitialDarkMode();
    applyDarkMode(dark);
    const storedProfile = readStored(PROFILE_KEY) || "all";

    const result = await verifyAuth();
    set({
      authed: result.ok,
      currentUser: result.user || null,
      authLoading: false,
      darkMode: dark,
      selectedProfileId: storedProfile,
    });
  },

  login: async (body) => {
    const data = await apiLogin(body);
    set({ authed: true, currentUser: data.user });
  },

  register: async (body) => {
    const data = await apiRegister(body);
    set({ authed: true, currentUser: data.user });
  },

  logout: () => {
    apiLogout();
    clearSession();
  },

  setSetupComplete: () => {
    set({ setupComplete: true });
  },

  loadData: async () => {
    const generation = sessionGeneration;
    try {
      const [profiles, cards, settingsResult] = await Promise.all([
        getProfiles(),
        getCards(),
        // A failed settings request is NOT an empty settings object. Collapsing
        // the two (`.catch(() => ({}))`) meant any blip wrote `timezone: ""`
        // back into the store, useTimezone mapped that to undefined, and every
        // date silently fell back to browser-local — on every tab-focus
        // refresh, with nothing shown to the user.
        getSettings().then(
          (settings) => ({ ok: true as const, settings }),
          () => ({ ok: false as const, settings: undefined as AppSettings | undefined }),
        ),
      ]);
      const storedProfileId = readStored(PROFILE_KEY);
      let selectedProfileId = get().selectedProfileId;
      if (storedProfileId && storedProfileId !== "all") {
        const exists = profiles.some((p) => p.id.toString() === storedProfileId);
        if (!exists) {
          selectedProfileId = "all";
          writeStored(PROFILE_KEY, "all");
        }
      }
      // The session changed while this request was in flight (logout, or a
      // different user signed in). Drop the result.
      if (generation !== sessionGeneration) return;
      const current = get();
      const updates: Partial<AppState> = {
        selectedProfileId,
        dataLoading: false,
        dataError: null,
      };
      if (settingsResult.ok && settingsResult.settings) {
        updates.timezone = settingsResult.settings.timezone || "";
        updates.serverTimezone = settingsResult.settings.server_timezone || "";
      }
      if (JSON.stringify(profiles) !== JSON.stringify(current.profiles)) {
        updates.profiles = profiles;
      }
      if (JSON.stringify(cards) !== JSON.stringify(current.cards)) {
        updates.cards = cards;
      }
      set(updates);
    } catch (e) {
      if (generation !== sessionGeneration) return;
      // api.ts already turned this into a sentence — including the server's
      // own `detail`, which is the one clue a self-hosting operator has. The
      // old blanket "check your connection" hid a 500 behind a wrong diagnosis.
      const detail = e instanceof Error ? e.message.trim() : "";
      set({
        dataLoading: false,
        dataError: detail || "Failed to load data. Check your connection.",
      });
    }
  },

  refresh: async () => {
    await get().loadData();
  },

  setSelectedProfileId: (id: string) => {
    writeStored(PROFILE_KEY, id);
    set({ selectedProfileId: id });
  },

  toggleDarkMode: () => {
    const next = !get().darkMode;
    applyDarkMode(next);
    // Only an explicit choice is persisted — see applyDarkMode.
    writeStored(DARK_MODE_KEY, String(next));
    set({ darkMode: next });
  },

  setTimezone: async (tz: string) => {
    const prev = get().timezone;
    set({ timezone: tz });
    try {
      await updateSettings({ timezone: tz });
    } catch (e) {
      set({ timezone: prev });
      // Keep the server's reason ("Unknown timezone: ...", a 403, a connection
      // failure) instead of replacing every one of them with the same sentence.
      const detail = e instanceof Error ? e.message.trim() : "";
      throw new Error(detail || "Failed to update timezone");
    }
  },
}));

/**
 * Everything a session teardown must reset, in one place.
 *
 * logout() reset dataLoading/dataError with a comment explaining why; the 401
 * path cleared the same cards and profiles and didn't — so after signing back
 * in, /cards, /summary and /card-details rendered their "no cards yet" empty
 * states for the whole duration of loadData().
 */
function clearSession() {
  // Invalidate any in-flight loadData: without this, a refresh started before
  // logout resolved afterwards and wrote the previous user's profiles and
  // cards straight back into the store.
  sessionGeneration += 1;
  useAppStore.setState({
    authed: false,
    currentUser: null,
    cards: [],
    profiles: [],
    selectedProfileId: "all",
    authMode: null,
    registrationEnabled: false,
    oauthProviders: [],
    // Reset to loading so the next user's shell doesn't render the previous
    // user's (now empty) data as if it were loaded.
    dataLoading: true,
    dataError: null,
  });
  useAppStore.getState().fetchAuthMode();
}

// Sync store when API returns 401 (token revoked/expired)
let _authListenerAttached = false;
if (typeof window !== "undefined" && !_authListenerAttached) {
  _authListenerAttached = true;
  window.addEventListener("auth:unauthorized", (event) => {
    const state = useAppStore.getState();
    if (state.authed) {
      // The shell redirects to the landing page straight after this; without a
      // word the user just watches their edit vanish. Fixed id so a burst of
      // parallel 401s collapses into one toast.
      //
      // preventDefault() is how api.ts learns the expiry has been announced:
      // it then drops the rejection instead of handing SESSION_EXPIRED_MESSAGE
      // to the call site's catch, which toasts `e.message` with no id and would
      // put a second, identical toast on screen (sonner dedupes by id, not by
      // text). Claimed before the toast so an exception in sonner can't leave
      // both sides thinking the other one spoke.
      event.preventDefault();
      toast.error(SESSION_EXPIRED_MESSAGE, { id: "session-expired" });
      clearSession();
    }
  });
}

// Follow the OS colour scheme until the user makes an explicit choice.
let _darkModeListenerAttached = false;
if (typeof window !== "undefined" && !_darkModeListenerAttached && typeof window.matchMedia === "function") {
  _darkModeListenerAttached = true;
  try {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", (e) => {
      // A stored value means the toggle was used; that choice wins.
      if (readStored(DARK_MODE_KEY) !== null) return;
      applyDarkMode(e.matches);
      useAppStore.setState({ darkMode: e.matches });
    });
  } catch {
    // Safari < 14 has no addEventListener on MediaQueryList; the scheme is
    // still read once at boot.
  }
}
