import type {
  Profile,
  Card,
  CardCreate,
  CardEvent,
  CardEventCreate,
  CardEventUpdate,
  CardTemplate,
  CardBenefit,
  CardBenefitCreate,
  CardBenefitUpdate,
  BenefitUsageUpdate,
  BenefitSummaryItem,
  FiveTwentyFourData,
  CardBonus,
  ExportData,
  ImportResult,
  TemplateVersionSummary,
  AppSettings,
  SetupStatus,
  SetupCompleteRequest,
  SetupCompleteResponse,
  AuthModeResponse,
  TokenResponse,
  UserBrief,
} from "@/types";

export const API_BASE =
  (typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__ENV &&
    ((window as unknown as Record<string, unknown>).__ENV as Record<string, string>).API_BASE) ||
  process.env.NEXT_PUBLIC_API_URL ||
  "";

export const getTemplateImageUrl = (templateId: string) =>
  `${API_BASE}/api/templates/${templateId}/image`;

export const PLACEHOLDER_IMAGE_URL = `${API_BASE}/api/templates/placeholder-image`;

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
    throw new Error("Unauthorized");
  }
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Forbidden");
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `API error: ${res.status}`);
  }
  return res.json().catch(() => undefined as T);
}

// Setup
export const getSetupStatus = () => apiFetch<SetupStatus>("/api/setup/status");
export const completeSetup = async (data: SetupCompleteRequest): Promise<SetupCompleteResponse> => {
  const resp = await apiFetch<SetupCompleteResponse>("/api/setup/complete", {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (resp.access_token) localStorage.setItem("token", resp.access_token);
  return resp;
};

// Auth
export const getAuthMode = () => apiFetch<AuthModeResponse>("/api/auth/mode");

export async function login(body: { username?: string; password?: string } = {}): Promise<TokenResponse> {
  const data = await apiFetch<TokenResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
  localStorage.setItem("token", data.access_token);
  return data;
}

export async function register(body: {
  username: string;
  password: string;
  display_name?: string;
  email?: string;
}): Promise<TokenResponse> {
  const data = await apiFetch<TokenResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
  localStorage.setItem("token", data.access_token);
  return data;
}

export function logout() {
  localStorage.removeItem("token");
}

export async function verifyAuth(): Promise<{ ok: boolean; user?: UserBrief }> {
  try {
    const data = await apiFetch<{ status: string; user: UserBrief }>("/api/auth/verify");
    return { ok: true, user: data.user };
  } catch {
    return { ok: false };
  }
}

// Profiles
export const getProfiles = () => apiFetch<Profile[]>("/api/profiles");
export const createProfile = (name: string) =>
  apiFetch<Profile>("/api/profiles", { method: "POST", body: JSON.stringify({ name }) });
export const deleteProfile = (id: number) =>
  apiFetch<void>(`/api/profiles/${id}`, { method: "DELETE" });
export const get524 = (profileId: number) =>
  apiFetch<FiveTwentyFourData>(`/api/profiles/${profileId}/524`);

// Cards
export const getCards = (params?: Record<string, string>) => {
  const query = params ? "?" + new URLSearchParams(params).toString() : "";
  return apiFetch<Card[]>(`/api/cards${query}`);
};
export const getCard = (id: number) => apiFetch<Card>(`/api/cards/${id}`);
export const createCard = (data: CardCreate) =>
  apiFetch<Card>("/api/cards", { method: "POST", body: JSON.stringify(data) });
export const updateCard = (id: number, data: Partial<CardCreate>) =>
  apiFetch<Card>(`/api/cards/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteCard = (id: number) =>
  apiFetch<void>(`/api/cards/${id}`, { method: "DELETE" });
export const restoreCard = (id: number) =>
  apiFetch<Card>(`/api/cards/${id}/restore`, { method: "POST" });
export const closeCard = (id: number, closeDate: string) =>
  apiFetch<Card>(`/api/cards/${id}/close`, {
    method: "POST",
    body: JSON.stringify({ close_date: closeDate }),
  });
export const reopenCard = (id: number) =>
  apiFetch<Card>(`/api/cards/${id}/reopen`, { method: "POST" });

export interface ProductChangeOptions {
  new_template_id?: string | null;
  new_card_name: string;
  change_date: string;
  new_annual_fee?: number;
  new_network?: string;
  new_card_image?: string | null;
  sync_benefits?: boolean;
  upgrade_bonus_amount?: number;
  upgrade_bonus_type?: string;
  upgrade_spend_requirement?: number;
  upgrade_spend_deadline?: string;
  upgrade_spend_reminder_notes?: string;
  reset_af_anniversary?: boolean;
}

export const productChange = (id: number, data: ProductChangeOptions) =>
  apiFetch<Card>(`/api/cards/${id}/product-change`, {
    method: "POST",
    body: JSON.stringify(data),
  });

// Events
export const getCardEvents = (cardId: number) =>
  apiFetch<CardEvent[]>(`/api/cards/${cardId}/events`);
export const createCardEvent = (cardId: number, data: CardEventCreate) =>
  apiFetch<CardEvent>(`/api/cards/${cardId}/events`, {
    method: "POST",
    body: JSON.stringify(data),
  });
export const getAllEvents = (params?: Record<string, string>) => {
  const query = params ? "?" + new URLSearchParams(params).toString() : "";
  return apiFetch<CardEvent[]>(`/api/events${query}`);
};
export const updateEvent = (id: number, data: CardEventUpdate) =>
  apiFetch<CardEvent>(`/api/events/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteEvent = (id: number) =>
  apiFetch<void>(`/api/events/${id}`, { method: "DELETE" });

// Retention Offers
export const createRetentionOffer = (cardId: number, data: {
  event_date: string;
  offer_points?: number | null;
  offer_credit?: number | null;
  accepted: boolean;
  description?: string | null;
  spend_requirement?: number | null;
  spend_deadline?: string | null;
  spend_reminder_notes?: string | null;
}) => apiFetch<CardEvent>(`/api/cards/${cardId}/retention-offer`, {
  method: "POST",
  body: JSON.stringify(data),
});

// Bonuses
export const createBonus = (cardId: number, data: Record<string, unknown>) =>
  apiFetch<CardBonus>(`/api/cards/${cardId}/bonuses`, { method: "POST", body: JSON.stringify(data) });
export const updateBonus = (id: number, data: Record<string, unknown>) =>
  apiFetch<CardBonus>(`/api/bonuses/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteBonus = (id: number) =>
  apiFetch<void>(`/api/bonuses/${id}`, { method: "DELETE" });

// Export/Import
export const exportProfiles = (profileId?: number) => {
  const query = profileId ? `?profile_id=${profileId}` : "";
  return apiFetch<ExportData>(`/api/profiles/export${query}`);
};
export const importProfiles = (data: ExportData, mode: string, targetProfileId?: number) => {
  const params = new URLSearchParams({ mode });
  if (targetProfileId !== undefined) params.set("target_profile_id", String(targetProfileId));
  return apiFetch<ImportResult>(`/api/profiles/import?${params}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
};

// Benefits
export const getCardBenefits = (cardId: number) =>
  apiFetch<CardBenefit[]>(`/api/cards/${cardId}/benefits`);
export const createCardBenefit = (cardId: number, data: CardBenefitCreate) =>
  apiFetch<CardBenefit>(`/api/cards/${cardId}/benefits`, {
    method: "POST",
    body: JSON.stringify(data),
  });
export const updateCardBenefit = (cardId: number, benefitId: number, data: CardBenefitUpdate) =>
  apiFetch<CardBenefit>(`/api/cards/${cardId}/benefits/${benefitId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
export const deleteCardBenefit = (cardId: number, benefitId: number) =>
  apiFetch<void>(`/api/cards/${cardId}/benefits/${benefitId}`, { method: "DELETE" });
export const updateBenefitUsage = (cardId: number, benefitId: number, data: BenefitUsageUpdate) =>
  apiFetch<CardBenefit>(`/api/cards/${cardId}/benefits/${benefitId}/usage`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
export const populateBenefits = (cardId: number) =>
  apiFetch<CardBenefit[]>(`/api/cards/${cardId}/benefits/populate`, { method: "POST" });
export const getAllBenefits = (profileId?: number) =>
  apiFetch<BenefitSummaryItem[]>(`/api/benefits${profileId ? `?profile_id=${profileId}` : ""}`);

// Templates
export const getTemplates = (issuer?: string) => {
  const query = issuer ? `?issuer=${encodeURIComponent(issuer)}` : "";
  return apiFetch<CardTemplate[]>(`/api/templates${query}`);
};
export const getTemplate = (issuer: string, cardName: string) =>
  apiFetch<CardTemplate>(`/api/templates/${issuer}/${cardName}`);
export const getTemplateImageVariantUrl = (templateId: string, filename: string) =>
  `${API_BASE}/api/templates/${templateId}/image/${filename}`;
export const getCardImageUrl = (cardId: number) =>
  `${API_BASE}/api/cards/${cardId}/image`;
export const getTemplateVersions = (issuer: string, cardName: string) =>
  apiFetch<TemplateVersionSummary[]>(`/api/templates/${issuer}/${cardName}/versions`);

// Settings
export const getSettings = () => apiFetch<AppSettings>("/api/settings");
export const updateSettings = (data: Partial<AppSettings>) =>
  apiFetch<AppSettings>("/api/settings", { method: "PUT", body: JSON.stringify(data) });

// User account
export const getCurrentUser = () => apiFetch<UserBrief>("/api/users/me");
export const updateCurrentUser = (data: { display_name?: string; email?: string }) =>
  apiFetch<UserBrief>("/api/users/me", { method: "PUT", body: JSON.stringify(data) });
export const changePassword = (data: { current_password: string; new_password: string }) =>
  apiFetch<{ status: string; access_token: string }>("/api/users/me/password", { method: "PUT", body: JSON.stringify(data) });

// Admin
export interface AdminUser {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
}
export interface AdminConfig {
  auth_mode: string;
  registration_enabled: boolean;
  admin_oauth_linked: boolean;
}
export const getAdminUsers = () => apiFetch<AdminUser[]>("/api/admin/users");
export const createAdminUser = (data: { username: string; password: string; display_name?: string; email?: string; role?: string }) =>
  apiFetch<AdminUser>("/api/admin/users", { method: "POST", body: JSON.stringify(data) });
export const updateAdminUser = (id: number, data: { display_name?: string; email?: string; role?: string; is_active?: boolean }) =>
  apiFetch<AdminUser>(`/api/admin/users/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deactivateAdminUser = (id: number) =>
  apiFetch<void>(`/api/admin/users/${id}`, { method: "DELETE" });
export const getAdminConfig = () => apiFetch<AdminConfig>("/api/admin/config");
export const updateAdminConfig = (data: { registration_enabled?: boolean }) =>
  apiFetch<AdminConfig>("/api/admin/config", { method: "PUT", body: JSON.stringify(data) });
export const upgradeAuthMode = (data: { target_mode: string; admin_password?: string; single_password?: string }) =>
  apiFetch<{ status: string; auth_mode: string; warning?: string }>("/api/admin/auth/upgrade", { method: "POST", body: JSON.stringify(data) });

// OAuth admin
export interface OAuthProviderConfig {
  id: number;
  provider_name: string;
  display_name: string | null;
  enabled: boolean;
  client_id: string;
  issuer_url: string | null;
  scopes: string | null;
}
export interface OAuthPreset {
  name: string;
  display_name: string;
}
export const getOAuthPresets = () => apiFetch<OAuthPreset[]>("/api/auth/oauth/presets");
export const getOAuthProviders = () => apiFetch<OAuthProviderConfig[]>("/api/auth/oauth/providers");
export const saveOAuthProvider = (data: {
  provider_name: string;
  client_id: string;
  client_secret: string;
  display_name?: string;
  enabled?: boolean;
}) => apiFetch<OAuthProviderConfig>("/api/auth/oauth/providers", { method: "POST", body: JSON.stringify(data) });
export const deleteOAuthProvider = (name: string) =>
  apiFetch<void>(`/api/auth/oauth/providers/${name}`, { method: "DELETE" });

// Admin OAuth account linking
export const adminLinkOAuth = (data: { provider_name: string; code: string; state: string; redirect_uri: string }) =>
  apiFetch<{ status: string; provider: string }>("/api/admin/oauth/link", { method: "POST", body: JSON.stringify(data) });

// User OAuth account linking
export interface UserOAuthAccount {
  provider: string;
  provider_email: string | null;
}
export const getUserOAuthAccounts = () =>
  apiFetch<UserOAuthAccount[]>("/api/users/me/oauth-accounts");
export const userLinkOAuth = (data: { provider_name: string; code: string; state: string; redirect_uri: string }) =>
  apiFetch<{ status: string; provider: string }>("/api/users/me/oauth/link", { method: "POST", body: JSON.stringify(data) });
export const userUnlinkOAuth = (provider: string) =>
  apiFetch<void>(`/api/users/me/oauth/${provider}`, { method: "DELETE" });
