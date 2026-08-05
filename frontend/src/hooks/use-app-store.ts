"use client";

import { create } from "zustand";
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

function getInitialDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem("darkMode");
  if (stored !== null) return stored === "true";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyDarkMode(dark: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem("darkMode", String(dark));
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
    const storedProfile = typeof window !== "undefined" ? localStorage.getItem("selectedProfileId") || "all" : "all";

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
    // Invalidate any in-flight loadData: without this, a refresh started before
    // logout resolved afterwards and wrote the previous user's profiles and
    // cards straight back into the store.
    sessionGeneration += 1;
    set({
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
    get().fetchAuthMode();
  },

  setSetupComplete: () => {
    set({ setupComplete: true });
  },

  loadData: async () => {
    const generation = sessionGeneration;
    try {
      const [profiles, cards, settings] = await Promise.all([
        getProfiles(),
        getCards(),
        getSettings().catch((): AppSettings => ({})),
      ]);
      const storedProfileId = typeof window !== "undefined" ? localStorage.getItem("selectedProfileId") : null;
      let selectedProfileId = get().selectedProfileId;
      if (storedProfileId && storedProfileId !== "all") {
        const exists = profiles.some((p) => p.id.toString() === storedProfileId);
        if (!exists) {
          selectedProfileId = "all";
          if (typeof window !== "undefined") localStorage.setItem("selectedProfileId", "all");
        }
      }
      // The session changed while this request was in flight (logout, or a
      // different user signed in). Drop the result.
      if (generation !== sessionGeneration) return;
      const current = get();
      const updates: Partial<AppState> = {
        timezone: settings.timezone || "",
        serverTimezone: settings.server_timezone || "",
        selectedProfileId,
        dataLoading: false,
        dataError: null,
      };
      if (JSON.stringify(profiles) !== JSON.stringify(current.profiles)) {
        updates.profiles = profiles;
      }
      if (JSON.stringify(cards) !== JSON.stringify(current.cards)) {
        updates.cards = cards;
      }
      set(updates);
    } catch {
      if (generation !== sessionGeneration) return;
      set({ dataLoading: false, dataError: "Failed to load data. Check your connection." });
    }
  },

  refresh: async () => {
    await get().loadData();
  },

  setSelectedProfileId: (id: string) => {
    if (typeof window !== "undefined") localStorage.setItem("selectedProfileId", id);
    set({ selectedProfileId: id });
  },

  toggleDarkMode: () => {
    const next = !get().darkMode;
    applyDarkMode(next);
    set({ darkMode: next });
  },

  setTimezone: async (tz: string) => {
    const prev = get().timezone;
    set({ timezone: tz });
    try {
      await updateSettings({ timezone: tz });
    } catch {
      set({ timezone: prev });
      throw new Error("Failed to update timezone");
    }
  },
}));

// Sync store when API returns 401 (token revoked/expired)
let _authListenerAttached = false;
if (typeof window !== "undefined" && !_authListenerAttached) {
  _authListenerAttached = true;
  window.addEventListener("auth:unauthorized", () => {
    const state = useAppStore.getState();
    if (state.authed) {
      // Same reasoning as logout(): discard anything already in flight.
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
      });
      useAppStore.getState().fetchAuthMode();
    }
  });
}
