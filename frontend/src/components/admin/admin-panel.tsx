"use client";

import { useEffect, useId, useMemo, useRef, useState, useCallback } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { copyToClipboard } from "@/lib/clipboard";
import { X, Users, Settings, Shield, ShieldMinus, ShieldPlus, Plus, UserCheck, UserX, Key, Trash2, Loader2, AlertTriangle, Check, Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OAuthProviderIcon } from "@/components/ui/oauth-icons";
import {
  API_BASE,
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  deactivateAdminUser,
  getAdminConfig,
  updateAdminConfig,
  upgradeAuthMode,
  getOAuthPresets,
  getOAuthProviders,
  saveOAuthProvider,
  deleteOAuthProvider,
  type AdminUser,
  type AdminConfig,
  type OAuthProviderConfig,
  type OAuthPreset,
  downloadDatabaseBackup,
  setAdminToken,
  getAdminToken,
} from "@/lib/api";
import { toast } from "sonner";

interface AdminPanelProps {
  onClose: () => void;
}

type AdminTab = "users" | "settings" | "oauth";

export function AdminPanel({ onClose }: AdminPanelProps) {
  const panelRef = useFocusTrap<HTMLDivElement>();
  const backdropPointerDown = useRef(false);
  const [tab, setTab] = useState<AdminTab>("settings");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [oauthProviders, setOAuthProviders] = useState<OAuthProviderConfig[]>([]);
  const [oauthPresets, setOAuthPresets] = useState<OAuthPreset[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const c = await getAdminConfig();
      setConfig(c);
      const isMultiUser = c.auth_mode === "multi_user" || c.auth_mode === "multi_user_oauth";
      const [u, providers, presets] = await Promise.all([
        isMultiUser ? getAdminUsers() : Promise.resolve([]),
        c.auth_mode === "multi_user_oauth" ? getOAuthProviders() : Promise.resolve([]),
        c.auth_mode === "multi_user_oauth" ? getOAuthPresets() : Promise.resolve([]),
      ]);
      setUsers(u);
      setOAuthProviders(providers);
      setOAuthPresets(presets);
    } catch {
      toast.error("Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const retry = useCallback(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  // Escape key to close.
  //
  // Radix's dismissable layer (every ConfirmDialog and Select in this panel)
  // listens in the CAPTURE phase and calls preventDefault() but never
  // stopPropagation, so this bubble-phase document listener used to fire as
  // well: one Escape closed the Select AND unmounted the panel, taking a
  // half-entered client secret or upgrade password with it. Two guards — the
  // layer's own preventDefault, and any portalled overlay living outside this
  // panel (the same selector useFocusTrap stands down on).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const panel = panelRef.current;
      const nestedLayerOpen = Array.from(
        document.querySelectorAll(
          '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]',
        ),
      ).some((node) => !panel?.contains(node));
      if (nestedLayerOpen) return;
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, panelRef]);

  // Lock body scroll while this full-screen overlay is open, so a touch scroll
  // that runs past the end of the panel doesn't chain into the page behind.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const currentUser = useAppStore((s) => s.currentUser);

  const tabId = useId();
  const tabRefs = useRef<Partial<Record<AdminTab, HTMLButtonElement | null>>>({});

  const visibleTabs = useMemo(() => {
    const mode = config?.auth_mode;
    const list: { id: AdminTab; label: string; Icon: typeof Users }[] = [];
    if (mode === "multi_user" || mode === "multi_user_oauth") {
      list.push({ id: "users", label: "Users", Icon: Users });
    }
    list.push({ id: "settings", label: "Settings", Icon: Settings });
    if (mode === "multi_user_oauth") {
      list.push({ id: "oauth", label: "OAuth", Icon: Key });
    }
    return list;
  }, [config?.auth_mode]);

  // Which tabs a mode exposes is only known once config lands, and the initial
  // state ("settings") was not always the one rendered first — a multi-user
  // instance opened with Users on the left and Settings underlined. Select
  // whatever is leftmost on first load, and afterwards only step in if the tab
  // the user is standing on disappears (an auth-mode upgrade rebuilds the list).
  const initialTabPicked = useRef(false);
  useEffect(() => {
    if (!config) return;
    if (!initialTabPicked.current) {
      initialTabPicked.current = true;
      setTab(visibleTabs[0].id);
      return;
    }
    setTab((current) => (visibleTabs.some((t) => t.id === current) ? current : visibleTabs[0].id));
  }, [config, visibleTabs]);

  // The tab bar only exists once config has landed, so the panel below it only
  // claims role="tabpanel" then too — otherwise the loading and error states
  // point aria-labelledby at a tab element that is not in the document.
  const tabsVisible = !loading && !!config;

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (e.key === "ArrowRight") next = (index + 1) % visibleTabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + visibleTabs.length) % visibleTabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = visibleTabs.length - 1;
    else return;
    e.preventDefault();
    const target = visibleTabs[next];
    setTab(target.id);
    tabRefs.current[target.id]?.focus();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
      // Close only when the gesture BEGAN on the backdrop: a drag-select that
      // started inside the client-secret field and was released past the panel
      // edge reports the backdrop as its click target, and used to throw the
      // whole form away.
      onPointerDown={(e) => {
        backdropPointerDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropPointerDown.current) onClose();
        backdropPointerDown.current = false;
      }}
    >
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Admin Panel" className="fixed inset-y-0 right-0 w-full max-w-lg bg-card border-l shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Admin Panel
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close admin panel"
            className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabs — held back until config lands, so the bar doesn't render with
            Settings selected and then have Users appear to its left. */}
        {tabsVisible && (
        <div role="tablist" aria-label="Admin sections" className="flex border-b px-6">
          {visibleTabs.map(({ id, label, Icon }, index) => (
            <button
              key={id}
              id={`${tabId}-tab-${id}`}
              ref={(node) => { tabRefs.current[id] = node; }}
              role="tab"
              type="button"
              aria-selected={tab === id}
              aria-controls={`${tabId}-panel-${id}`}
              // Roving tabindex: one stop for the whole bar, arrow keys move
              // between tabs — the WAI-ARIA tabs pattern these three loose
              // buttons were only imitating visually.
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              className={`px-4 py-2.5 min-h-[44px] sm:min-h-0 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 inline mr-1.5" />
              {label}
            </button>
          ))}
        </div>
        )}

        {/* Content */}
        <div
          id={tabsVisible ? `${tabId}-panel-${tab}` : undefined}
          role={tabsVisible ? "tabpanel" : undefined}
          aria-labelledby={tabsVisible ? `${tabId}-tab-${tab}` : undefined}
          className="flex-1 overflow-y-auto overscroll-contain p-6"
        >
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !config ? (
            // SettingsTab dereferences config.auth_mode immediately, so the old
            // `config!` turned any failed admin fetch into a TypeError that the
            // ErrorBoundary answered by replacing the entire app.
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">Couldn&apos;t load admin data.</p>
              <Button size="sm" variant="outline" onClick={retry}>Retry</Button>
            </div>
          ) : tab === "users" ? (
            <UsersTab users={users} currentUserId={currentUser?.id ?? null} authMode={config.auth_mode} onRefresh={loadData} />
          ) : tab === "oauth" ? (
            <OAuthTab providers={oauthProviders} presets={oauthPresets} authMode={config.auth_mode} onRefresh={loadData} />
          ) : (
            <SettingsTab config={config} oauthProviders={oauthProviders} oauthPresets={oauthPresets} onRefresh={loadData} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Status chips render Title Case everywhere — "admin"/"inactive" lowercase in
 *  one panel while the rest of the app writes "Active"/"Closed" read as two
 *  different vocabularies for the same idea. */
const ROLE_LABELS: Record<string, string> = { admin: "Admin", user: "User" };

type UserAction = "deactivate" | "demote" | "promote";

function UsersTab({ users, currentUserId, authMode, onRefresh }: { users: AdminUser[]; currentUserId: number | null; authMode?: string; onRefresh: () => void }) {
  const formId = useId();
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [creating, setCreating] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ user: AdminUser; action: UserAction } | null>(null);

  const resetCreateForm = () => {
    // Cancel discards the draft. Leaving it in state meant reopening the form
    // re-displayed a password someone had typed and thought better of.
    setShowCreate(false);
    setNewUsername("");
    setNewPassword("");
    setNewRole("user");
  };

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (creating) return;
    if (!newUsername.trim() || newPassword.length < 8) {
      toast.error("A username and a password of at least 8 characters are required");
      return;
    }
    setCreating(true);
    try {
      await createAdminUser({ username: newUsername.trim(), password: newPassword, role: newRole });
      toast.success("User created");
      resetCreateForm();
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (user: AdminUser) => {
    if (user.is_active) {
      setConfirmTarget({ user, action: "deactivate" });
      return;
    }
    try {
      await updateAdminUser(user.id, { is_active: true });
      toast.success(`${user.username} activated`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update user");
    }
  };

  // Both directions confirm. Promotion used to fire on the first click, and the
  // only thing separating it from demotion was a `title` tooltip touch never
  // shows — so on a phone the two were literally indistinguishable.
  const handleToggleRole = (user: AdminUser) => {
    setConfirmTarget({ user, action: user.role === "admin" ? "demote" : "promote" });
  };

  const executeConfirm = async () => {
    if (!confirmTarget) return;
    const { user, action } = confirmTarget;
    try {
      if (action === "deactivate") {
        await deactivateAdminUser(user.id);
        toast.success(`${user.username} deactivated`);
      } else if (action === "promote") {
        await updateAdminUser(user.id, { role: "admin" });
        toast.success(`${user.username} is now admin`);
      } else {
        await updateAdminUser(user.id, { role: "user" });
        toast.success(`${user.username} is now user`);
      }
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update user");
    }
    setConfirmTarget(null);
  };

  const confirmCopy: Record<UserAction, { title: string; describe: (name: string) => string; label: string; pending: string }> = {
    deactivate: {
      title: "Deactivate User",
      describe: (name) => `Deactivate ${name}? They will lose access.`,
      label: "Deactivate",
      pending: "Deactivating…",
    },
    demote: {
      title: "Demote Admin",
      describe: (name) => `Demote ${name} from admin to user?`,
      label: "Demote",
      pending: "Demoting…",
    },
    promote: {
      title: "Promote to Admin",
      describe: (name) => `Promote ${name} to admin? They will be able to manage every user, the auth mode and OAuth settings.`,
      label: "Promote",
      pending: "Promoting…",
    },
  };
  const copy = confirmCopy[confirmTarget?.action ?? "deactivate"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{users.length} user{users.length !== 1 ? "s" : ""}</h3>
        {authMode !== "multi_user_oauth" && (
          <Button
            size="sm"
            aria-expanded={showCreate}
            onClick={() => (showCreate ? resetCreateForm() : setShowCreate(true))}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add User
          </Button>
        )}
      </div>

      {showCreate && (
        <form className="border rounded-lg p-4 space-y-3 bg-muted/30" onSubmit={handleCreate}>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-username`}>Username</Label>
            <Input
              id={`${formId}-username`}
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              autoComplete="username"
              enterKeyHint="next"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-password`}>Password</Label>
            <Input
              id={`${formId}-password`}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              enterKeyHint="done"
            />
            {newPassword.length > 0 && newPassword.length < 8 && (
              <p className="text-xs text-muted-foreground">Password must be at least 8 characters</p>
            )}
          </div>
          <div className="space-y-1.5">
            {/* Was a raw <select>: no chevron, a different focus ring from every
                other control in the panel, and — with no `color-scheme` anywhere
                in the CSS — a white native option list over a dark panel. */}
            <Label htmlFor={`${formId}-role`}>Role</Label>
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger id={`${formId}-role`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={creating || !newUsername.trim() || newPassword.length < 8}
            >
              {creating ? "Creating…" : "Create"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={resetCreateForm} disabled={creating}>Cancel</Button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {users.map((user) => (
          <div
            key={user.id}
            className={`border rounded-lg p-3 flex items-center justify-between gap-2 ${!user.is_active ? "opacity-50" : ""}`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium truncate" title={user.username}>{user.username}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                  user.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  {ROLE_LABELS[user.role] ?? user.role}
                </span>
                {!user.is_active && (
                  <span className="text-xs px-1.5 py-0.5 rounded shrink-0 bg-destructive/10 text-danger">
                    Inactive
                  </span>
                )}
              </div>
              {user.display_name && user.display_name !== user.username && (
                <p className="text-xs text-muted-foreground truncate" title={user.display_name}>{user.display_name}</p>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-1 shrink-0">
              {user.id === currentUserId ? (
                <span className="text-xs text-muted-foreground px-2">You</span>
              ) : (
                <>
                  {/* Promote and demote were the same Shield glyph, separated
                      only by a `title` — invisible on touch. Distinct icons and
                      an aria-label carry the difference now. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="min-h-[44px] min-w-[44px] sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0"
                    onClick={() => handleToggleRole(user)}
                    aria-label={user.role === "admin" ? `Demote ${user.username} to user` : `Promote ${user.username} to admin`}
                    title={user.role === "admin" ? "Demote to user" : "Promote to admin"}
                  >
                    {user.role === "admin" ? <ShieldMinus className="h-3.5 w-3.5" /> : <ShieldPlus className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="min-h-[44px] min-w-[44px] sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0"
                    onClick={() => handleToggleActive(user)}
                    aria-label={user.is_active ? `Deactivate ${user.username}` : `Activate ${user.username}`}
                    title={user.is_active ? "Deactivate" : "Activate"}
                  >
                    {user.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}
        title={copy.title}
        description={copy.describe(confirmTarget?.user.username ?? "")}
        confirmLabel={copy.label}
        pendingLabel={copy.pending}
        variant={confirmTarget?.action === "promote" ? "default" : "destructive"}
        onConfirm={executeConfirm}
      />
    </div>
  );
}

function RedirectUriDisplay({ provider }: { provider: string }) {
  const [copied, setCopied] = useState(false);
  const redirectUri = typeof window !== "undefined"
    ? `${window.location.origin}/auth/callback?provider=${provider}`
    : "";

  if (!provider || !redirectUri) return null;

  const handleCopy = async () => {
    // Not navigator.clipboard directly: it is undefined outside a secure
    // context, and http://192.168.x.x — the documented way to reach a
    // self-hosted instance — is not one. The bare call threw into nothing, so
    // the click did nothing and said nothing. copyToClipboard falls back to
    // execCommand and reports which path it took.
    const result = await copyToClipboard(redirectUri);
    if (result === "failed") {
      toast.error("Couldn't copy the redirect URI. Select it and copy manually.");
      return;
    }
    if (result === "fallback") {
      toast.success("Redirect URI copied — via the legacy path; the Clipboard API is blocked here");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1.5">
      <Label>Redirect URI</Label>
      <p className="text-xs text-muted-foreground">
        Add this URI to your OAuth provider&apos;s allowed redirect URIs. It must match exactly.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 text-xs bg-muted rounded-md px-3 py-2 break-all select-all">
          {redirectUri}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="min-h-[44px] min-w-[44px] sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0 shrink-0"
          onClick={handleCopy}
          aria-label={copied ? "Redirect URI copied" : "Copy redirect URI"}
          title="Copy redirect URI"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function OAuthTab({
  providers,
  presets,
  authMode,
  onRefresh,
}: {
  providers: OAuthProviderConfig[];
  presets: OAuthPreset[];
  authMode?: string;
  onRefresh: () => void;
}) {
  const formId = useId();
  const [showAdd, setShowAdd] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const configuredNames = new Set(providers.map((p) => p.provider_name));
  const availablePresets = presets.filter((p) => !configuredNames.has(p.name));
  const isLastProvider = authMode === "multi_user_oauth" && providers.length <= 1;

  const providerLabel = (name: string) =>
    providers.find((p) => p.provider_name === name)?.display_name ||
    presets.find((p) => p.name === name)?.display_name ||
    name;

  const resetAddForm = () => {
    // Cancel discards the draft — a client secret left in state came back on
    // screen the next time the form was opened.
    setShowAdd(false);
    setSelectedPreset("");
    setClientId("");
    setClientSecret("");
  };

  const handleAdd = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (adding) return;
    if (!selectedPreset || !clientId.trim() || !clientSecret) {
      toast.error("Pick a provider and fill in both the client ID and secret");
      return;
    }
    setAdding(true);
    try {
      await saveOAuthProvider({
        provider_name: selectedPreset,
        client_id: clientId.trim(),
        client_secret: clientSecret,
        enabled: true,
      });
      toast.success("OAuth provider added");
      resetAddForm();
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add provider");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteOAuthProvider(deleteTarget);
      toast.success("Provider removed");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove provider");
    }
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">OAuth Providers</h3>
        {availablePresets.length > 0 && (
          <Button
            size="sm"
            aria-expanded={showAdd}
            onClick={() => {
              if (showAdd) { resetAddForm(); return; }
              setShowAdd(true);
              if (!selectedPreset) setSelectedPreset(availablePresets[0].name);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Provider
          </Button>
        )}
      </div>

      {showAdd && (
        <form className="border rounded-lg p-4 space-y-3 bg-muted/30" onSubmit={handleAdd}>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-provider`}>Provider</Label>
            <Select value={selectedPreset} onValueChange={setSelectedPreset}>
              <SelectTrigger id={`${formId}-provider`}>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {availablePresets.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    <span className="flex items-center gap-2">
                      <OAuthProviderIcon provider={p.name} className="h-4 w-4" />
                      {p.display_name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-client-id`}>Client ID</Label>
            <Input
              id={`${formId}-client-id`}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="OAuth client ID"
              autoComplete="off"
              enterKeyHint="next"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-client-secret`}>Client Secret</Label>
            <Input
              id={`${formId}-client-secret`}
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="OAuth client secret"
              autoComplete="off"
              enterKeyHint="done"
            />
          </div>
          <RedirectUriDisplay provider={selectedPreset} />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={adding || !selectedPreset || !clientId.trim() || !clientSecret}
            >
              {adding ? "Adding…" : "Add"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={resetAddForm} disabled={adding}>Cancel</Button>
          </div>
        </form>
      )}

      {providers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No OAuth providers configured</p>
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => (
            <div key={provider.id} className="border rounded-lg p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <OAuthProviderIcon provider={provider.provider_name} className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium truncate" title={provider.display_name || provider.provider_name}>{provider.display_name || provider.provider_name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                    provider.enabled ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"
                  }`}>
                    {provider.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                {/* One truncation rule for the client ID, with the full value in
                    the title — this row used to cut at 16 chars and the upgrade
                    wizard at 12, neither recoverable. */}
                <p className="text-xs text-muted-foreground mt-0.5 truncate" title={provider.client_id}>
                  Client ID: {provider.client_id}
                </p>
              </div>
              {/* The button stays put and goes disabled rather than vanishing:
                  losing the only provider in OAuth-only mode locks everyone out,
                  and silently removing the control explained none of that.
                  account-menu.tsx does the same for the last linked account.
                  The reason lives on the WRAPPER as well as the button, because
                  Button's base class carries `disabled:pointer-events-none` — a
                  disabled button is never hit-tested, so its own title tooltip
                  can never appear, which is the one place the explanation was.
                  The button keeps its title so screen readers still get it as
                  the description. */}
              <span
                className="flex shrink-0"
                title={isLastProvider ? "Cannot remove the only sign-in provider" : "Remove provider"}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-[44px] min-w-[44px] sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0 shrink-0 text-danger hover:text-danger"
                  onClick={() => setDeleteTarget(provider.provider_name)}
                  disabled={isLastProvider}
                  aria-label={`Remove ${provider.display_name || provider.provider_name}`}
                  title={isLastProvider ? "Cannot remove the only sign-in provider" : "Remove provider"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Remove OAuth Provider"
        description={`Remove the ${deleteTarget ? providerLabel(deleteTarget) : ""} provider? Users who rely on it will lose access.`}
        confirmLabel="Remove"
        pendingLabel="Removing…"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function SettingsTab({
  config,
  oauthProviders,
  oauthPresets,
  onRefresh,
}: {
  config: AdminConfig;
  oauthProviders: OAuthProviderConfig[];
  oauthPresets: OAuthPreset[];
  onRefresh: () => void;
}) {
  const fetchAuthMode = useAppStore((s) => s.fetchAuthMode);
  const fieldId = useId();

  const [togglingRegistration, setTogglingRegistration] = useState(false);

  const handleToggleRegistration = async () => {
    if (togglingRegistration) return;
    setTogglingRegistration(true);
    try {
      await updateAdminConfig({ registration_enabled: !config.registration_enabled });
      toast.success(`Registration ${config.registration_enabled ? "disabled" : "enabled"}`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setTogglingRegistration(false);
    }
  };

  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeTarget, setUpgradeTarget] = useState("");
  const [upgradePassword, setUpgradePassword] = useState("");
  const [upgradePasswordConfirm, setUpgradePasswordConfirm] = useState("");
  const [showUpgradePassword, setShowUpgradePassword] = useState(false);
  const [showUpgradeConfirm, setShowUpgradeConfirm] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [adminToken, setAdminTokenInput] = useState(() => getAdminToken());

  const handleDownloadBackup = async () => {
    setBackingUp(true);
    try {
      await downloadDatabaseBackup();
      toast.success("Backup downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setBackingUp(false);
    }
  };

  // OAuth wizard state
  const [wizardPresets, setWizardPresets] = useState<OAuthPreset[]>(oauthPresets);
  const [wizardProviders, setWizardProviders] = useState<OAuthProviderConfig[]>(oauthProviders);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [oauthLoading, setOauthLoading] = useState(false);

  const modes = ["open", "single_password", "multi_user", "multi_user_oauth"];
  const currentIndex = modes.indexOf(config.auth_mode);
  const availableUpgrades = modes.slice(currentIndex + 1);

  const modeLabels: Record<string, string> = {
    open: "No Password",
    single_password: "Simple Password",
    multi_user: "Multi-User",
    multi_user_oauth: "OAuth (SSO)",
  };

  // Load OAuth presets/providers when selecting OAuth target
  const handleTargetChange = async (target: string) => {
    setUpgradeTarget(target);
    if (target === "multi_user_oauth" && wizardPresets.length === 0) {
      try {
        const [presets, providers] = await Promise.all([getOAuthPresets(), getOAuthProviders()]);
        setWizardPresets(presets);
        setWizardProviders(providers);
        const configuredNames = new Set(providers.map((p) => p.provider_name));
        const available = presets.filter((p) => !configuredNames.has(p.name));
        if (available.length > 0) setSelectedPreset(available[0].name);
      } catch {
        // Presets endpoint is public, should not fail
      }
    }
  };

  const handleAddProvider = async () => {
    if (!selectedPreset || !clientId || !clientSecret) return;
    setOauthLoading(true);
    try {
      await saveOAuthProvider({
        provider_name: selectedPreset,
        client_id: clientId,
        client_secret: clientSecret,
        enabled: true,
      });
      toast.success("OAuth provider added");
      setClientId("");
      setClientSecret("");
      // Reload providers
      const providers = await getOAuthProviders();
      setWizardProviders(providers);
      const configuredNames = new Set(providers.map((p) => p.provider_name));
      const available = wizardPresets.filter((p) => !configuredNames.has(p.name));
      setSelectedPreset(available.length > 0 ? available[0].name : "");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add provider");
    } finally {
      setOauthLoading(false);
    }
  };

  const handleOAuthConnect = async (providerName: string) => {
    const redirectUri = `${window.location.origin}/auth/callback?provider=${providerName}`;
    localStorage.setItem("oauth_flow_type", "admin_link");
    localStorage.setItem("oauth_provider", providerName);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `${API_BASE}/api/auth/oauth/${providerName}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`,
        { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to start OAuth");
      window.location.href = data.authorization_url;
    } catch (e) {
      localStorage.removeItem("oauth_flow_type");
      toast.error(e instanceof Error ? e.message : "Failed to start OAuth flow");
    }
  };

  const handleUpgrade = async () => {
    try {
      const data: { target_mode: string; admin_password?: string; single_password?: string } = {
        target_mode: upgradeTarget,
      };
      if (upgradeTarget === "single_password") {
        data.single_password = upgradePassword;
      } else if (upgradeTarget === "multi_user") {
        data.admin_password = upgradePassword;
      }
      // multi_user_oauth: no password needed
      const result = await upgradeAuthMode(data);
      toast.success(`Upgraded to ${modeLabels[upgradeTarget]}`);
      if (result.warning) {
        toast.warning(result.warning);
      }
      // Closed here rather than in the ConfirmDialog's onConfirm: the dialog
      // now owns the busy state for as long as this promise is pending, and
      // closing it up front meant the "cannot be undone" click looked like it
      // had done nothing while the request was still in flight.
      setShowUpgradeConfirm(false);
      setShowUpgrade(false);
      setUpgradePassword("");
      setUpgradePasswordConfirm("");
      setShowUpgradePassword(false);
      await fetchAuthMode();
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upgrade failed");
    }
  };

  const cancelUpgrade = () => {
    setShowUpgrade(false);
    setUpgradePassword("");
    setUpgradePasswordConfirm("");
    setShowUpgradePassword(false);
  };

  const isOAuthTarget = upgradeTarget === "multi_user_oauth";
  // An upgrade is irreversible, so the password that will gate every future
  // sign-in gets the same treatment as the setup wizard's: a confirm pair, an
  // 8-character floor, inline messages, and an Upgrade button that stays
  // disabled until both hold.
  const needsPassword = !isOAuthTarget && upgradeTarget !== "open" && upgradeTarget !== "";
  const passwordReady =
    !needsPassword || (upgradePassword.length >= 8 && upgradePassword === upgradePasswordConfirm);
  const hasProvider = wizardProviders.length > 0;
  const adminLinked = config.admin_oauth_linked;
  const configuredNames = new Set(wizardProviders.map((p) => p.provider_name));
  const availablePresets = wizardPresets.filter((p) => !configuredNames.has(p.name));

  return (
    <div className="space-y-6">
      {/* Current auth mode */}
      <div className="space-y-2">
        <h3 className="font-medium">Authentication Mode</h3>
        <p className="text-sm text-muted-foreground">
          Current: <span className="font-medium text-foreground">{modeLabels[config.auth_mode] || config.auth_mode}</span>
        </p>
        {config.auth_mode === "open" && (
          <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <Label htmlFor="admin-token" className="text-xs font-medium">Admin token required</Label>
            <p className="text-xs text-muted-foreground">
              In open mode anyone who can reach this instance is treated as an
              admin, so changing the auth mode or configuring OAuth needs a token
              that proves you have access to the server. Find it in the backend
              container logs on startup:{" "}
              <code className="text-[11px]">docker compose logs backend | grep X-Admin-Token</code>
            </p>
            <Input
              id="admin-token"
              value={adminToken}
              placeholder="Paste the token from your container logs"
              onChange={(e) => { setAdminTokenInput(e.target.value); setAdminToken(e.target.value.trim()); }}
              className="h-8 font-mono text-xs"
            />
          </div>
        )}
        {availableUpgrades.length > 0 && !showUpgrade && (
          <Button size="sm" variant="outline" onClick={() => { setShowUpgrade(true); handleTargetChange(availableUpgrades[0]); }}>
            Upgrade Auth Mode
          </Button>
        )}
        {showUpgrade && (
          <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-md p-2.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Auth mode upgrades are permanent and cannot be reversed.</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-target`}>Upgrade to</Label>
              <Select value={upgradeTarget} onValueChange={handleTargetChange}>
                <SelectTrigger id={`${fieldId}-target`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableUpgrades.map((m) => (
                    <SelectItem key={m} value={m}>{modeLabels[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Password-based upgrade (single_password / multi_user). This is
                the password every future sign-in depends on and the change
                cannot be undone, so it is collected exactly the way the setup
                wizard collects it: confirm pair, 8-character floor, inline
                messages — plus a reveal, because a typo here locks you out. */}
            {needsPassword && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-pw`}>
                    {upgradeTarget === "single_password" ? "Shared Password" : "Admin Password"}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${fieldId}-pw`}
                      type={showUpgradePassword ? "text" : "password"}
                      value={upgradePassword}
                      onChange={(e) => setUpgradePassword(e.target.value)}
                      autoComplete="new-password"
                      enterKeyHint="next"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="min-h-[44px] min-w-[44px] sm:h-9 sm:w-9 sm:min-h-0 sm:min-w-0 shrink-0"
                      onClick={() => setShowUpgradePassword((v) => !v)}
                      aria-label={showUpgradePassword ? "Hide password" : "Show password"}
                      aria-pressed={showUpgradePassword}
                    >
                      {showUpgradePassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  {upgradePassword.length > 0 && upgradePassword.length < 8 && (
                    <p className="text-xs text-muted-foreground">Password must be at least 8 characters</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-pw-confirm`}>Confirm Password</Label>
                  <Input
                    id={`${fieldId}-pw-confirm`}
                    type={showUpgradePassword ? "text" : "password"}
                    value={upgradePasswordConfirm}
                    onChange={(e) => setUpgradePasswordConfirm(e.target.value)}
                    autoComplete="new-password"
                    enterKeyHint="done"
                  />
                  {upgradePasswordConfirm && upgradePassword !== upgradePasswordConfirm && (
                    <p className="text-xs text-danger">Passwords do not match</p>
                  )}
                </div>
              </>
            )}

            {/* OAuth upgrade wizard */}
            {isOAuthTarget && (
              <div className="space-y-4">
                {/* Step 1: Configure provider */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`flex items-center justify-center h-5 w-5 rounded-full text-xs font-bold ${hasProvider ? "bg-green-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"}`}>
                      {hasProvider ? "\u2713" : "1"}
                    </span>
                    <Label className="text-sm font-medium">Configure an OAuth provider</Label>
                  </div>
                  {wizardProviders.length > 0 && (
                    <div className="ml-7 space-y-1">
                      {wizardProviders.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 text-sm min-w-0">
                          <OAuthProviderIcon provider={p.provider_name} className="h-3 w-3 shrink-0" />
                          <span className="truncate">{p.display_name || p.provider_name}</span>
                          {/* Same truncation rule as the OAuth tab's row, and
                              the full id is in the title either way. */}
                          <span className="text-xs text-muted-foreground truncate" title={p.client_id}>({p.client_id})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {availablePresets.length > 0 && (
                    <div className="ml-7 border rounded-lg p-3 space-y-2 bg-background">
                      {/* Was a raw <select> sitting next to the shadcn Select
                          twelve lines above: no chevron, its own focus ring,
                          and a native option list that ignores the dark theme
                          because nothing in the CSS sets `color-scheme`. */}
                      {/* These three are placeholder-labelled in a deliberately
                          compact box, so they carry aria-label rather than a
                          visible <Label> — an sr-only one would still take a
                          space-y slot and push the box open. */}
                      <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                        <SelectTrigger className="h-8" aria-label="Provider">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent>
                          {availablePresets.map((p) => (
                            <SelectItem key={p.name} value={p.name}>
                              <span className="flex items-center gap-2">
                                <OAuthProviderIcon provider={p.name} className="h-4 w-4" />
                                {p.display_name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input size={1} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" aria-label="Client ID" autoComplete="off" className="h-8 text-sm" />
                      <Input size={1} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Client Secret" aria-label="Client Secret" autoComplete="off" className="h-8 text-sm" />
                      <RedirectUriDisplay provider={selectedPreset} />
                      <Button type="button" size="sm" onClick={handleAddProvider} disabled={oauthLoading || !selectedPreset || !clientId.trim() || !clientSecret}>
                        {oauthLoading ? "Adding..." : "Add Provider"}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Step 2: Connect admin account */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`flex items-center justify-center h-5 w-5 rounded-full text-xs font-bold ${adminLinked ? "bg-green-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"}`}>
                      {adminLinked ? "\u2713" : "2"}
                    </span>
                    <Label className="text-sm font-medium">Connect your admin account</Label>
                  </div>
                  {adminLinked ? (
                    <p className="ml-7 text-xs text-green-600 dark:text-green-400">Account linked</p>
                  ) : hasProvider ? (
                    <div className="ml-7 space-y-1.5">
                      <p className="text-xs text-muted-foreground">Sign in with your OAuth provider to link your admin account.</p>
                      {wizardProviders.map((p) => (
                        <Button key={p.id} size="sm" variant="outline" onClick={() => handleOAuthConnect(p.provider_name)}>
                          <OAuthProviderIcon provider={p.provider_name} className="h-3.5 w-3.5 mr-1.5" />
                          Connect with {p.display_name || p.provider_name}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="ml-7 text-xs text-muted-foreground">Configure a provider first</p>
                  )}
                </div>

                {/* Step 3: Complete */}
                <div className="flex items-center gap-2">
                  <span className={`flex items-center justify-center h-5 w-5 rounded-full text-xs font-bold ${hasProvider && adminLinked ? "bg-primary text-white" : "bg-muted-foreground/20 text-muted-foreground"}`}>
                    3
                  </span>
                  <Label className="text-sm font-medium">Complete upgrade</Label>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {isOAuthTarget ? (
                <Button type="button" size="sm" onClick={() => setShowUpgradeConfirm(true)} disabled={!hasProvider || !adminLinked}>
                  Upgrade to OAuth
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={() => setShowUpgradeConfirm(true)} disabled={!passwordReady}>
                  Upgrade
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={cancelUpgrade}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {/* Registration toggle */}
      {(config.auth_mode === "multi_user" || config.auth_mode === "multi_user_oauth") && (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor={`${fieldId}-registration`} className="text-sm font-medium">User Registration</Label>
            <p className="text-xs text-muted-foreground">Allow new users to create accounts</p>
          </div>
          {/* The hand-rolled version painted a bg-white knob on a bg-muted
              track — about 1.1:1 in light mode's OFF state, i.e. a blank pill.
              The shared Switch is token-based and contrasts in both themes. */}
          <Switch
            id={`${fieldId}-registration`}
            checked={config.registration_enabled}
            onCheckedChange={handleToggleRegistration}
            disabled={togglingRegistration}
            className="shrink-0"
          />
        </div>
      )}

      {/* Backup */}
      <div className="space-y-2 pt-2 border-t">
        <h3 className="font-medium">Backup</h3>
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Downloads a complete snapshot of the database — every profile, plus
            users, auth mode and OAuth configuration. Safe to run while the app
            is in use. To restore: stop the stack, replace{" "}
            <code className="text-[11px]">/data/cards.db</code> with this file, start it again.
          </p>
          <Button size="sm" variant="outline" onClick={handleDownloadBackup} disabled={backingUp}>
            {backingUp ? "Preparing…" : "Download backup"}
          </Button>
        </div>
        <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">
              The encryption key is not in this file.
            </span>{" "}
            Stored card details and OAuth client secrets are encrypted with{" "}
            <code className="text-[11px]">/data/.encryption_key</code>, which lives outside the
            database. That keeps a leaked backup unreadable — but it also means restoring onto a
            fresh volume leaves those values undecryptable unless you copy the key file across too.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={showUpgradeConfirm}
        onOpenChange={setShowUpgradeConfirm}
        title="Upgrade Auth Mode"
        description={`Upgrade to ${modeLabels[upgradeTarget] || upgradeTarget}? This cannot be undone.`}
        confirmLabel="Upgrade"
        pendingLabel="Upgrading…"
        variant="destructive"
        // Returned, not fired and forgotten: ConfirmDialog disables both
        // buttons and spins the confirm for as long as the promise is pending,
        // and blocks Esc/overlay dismissal while it runs. handleUpgrade closes
        // this dialog itself once the request has actually landed.
        onConfirm={handleUpgrade}
      />
    </div>
  );
}
