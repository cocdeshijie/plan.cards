"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { X, Users, Settings, Shield, Plus, UserCheck, UserX, Key, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
} from "@/lib/api";
import { toast } from "sonner";

interface AdminPanelProps {
  onClose: () => void;
}

export function AdminPanel({ onClose }: AdminPanelProps) {
  const panelRef = useFocusTrap<HTMLDivElement>();
  const [tab, setTab] = useState<"users" | "settings" | "oauth">("settings");
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

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const currentUser = useAppStore((s) => s.currentUser);

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Admin Panel" className="fixed inset-y-0 right-0 w-full max-w-lg bg-card border-l shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Admin Panel
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-6">
          {(config?.auth_mode === "multi_user" || config?.auth_mode === "multi_user_oauth") && (
            <button
              onClick={() => setTab("users")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === "users" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users className="h-4 w-4 inline mr-1.5" />
              Users
            </button>
          )}
          <button
            onClick={() => setTab("settings")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === "settings" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Settings className="h-4 w-4 inline mr-1.5" />
            Settings
          </button>
          {config?.auth_mode === "multi_user_oauth" && (
            <button
              onClick={() => setTab("oauth")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === "oauth" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Key className="h-4 w-4 inline mr-1.5" />
              OAuth
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tab === "users" ? (
            <UsersTab users={users} currentUserId={currentUser?.id ?? null} authMode={config?.auth_mode} onRefresh={loadData} />
          ) : tab === "oauth" ? (
            <OAuthTab providers={oauthProviders} presets={oauthPresets} authMode={config?.auth_mode} onRefresh={loadData} />
          ) : (
            <SettingsTab config={config!} oauthProviders={oauthProviders} oauthPresets={oauthPresets} onRefresh={loadData} />
          )}
        </div>
      </div>
    </div>
  );
}

function UsersTab({ users, currentUserId, authMode, onRefresh }: { users: AdminUser[]; currentUserId: number | null; authMode?: string; onRefresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [confirmTarget, setConfirmTarget] = useState<{ user: AdminUser; action: "deactivate" | "demote" } | null>(null);

  const handleCreate = async () => {
    if (!newUsername || !newPassword) return;
    try {
      await createAdminUser({ username: newUsername, password: newPassword, role: newRole });
      toast.success("User created");
      setShowCreate(false);
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create user");
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

  const handleToggleRole = async (user: AdminUser) => {
    const targetRole = user.role === "admin" ? "user" : "admin";
    if (targetRole === "user") {
      setConfirmTarget({ user, action: "demote" });
      return;
    }
    try {
      await updateAdminUser(user.id, { role: "admin" });
      toast.success(`${user.username} is now admin`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update role");
    }
  };

  const executeConfirm = async () => {
    if (!confirmTarget) return;
    const { user, action } = confirmTarget;
    try {
      if (action === "deactivate") {
        await deactivateAdminUser(user.id);
        toast.success(`${user.username} deactivated`);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{users.length} user{users.length !== 1 ? "s" : ""}</h3>
        {authMode !== "multi_user_oauth" && (
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="h-4 w-4 mr-1" />
            Add User
          </Button>
        )}
      </div>

      {showCreate && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate}>Create</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {users.map((user) => (
          <div
            key={user.id}
            className={`border rounded-lg p-3 flex items-center justify-between ${!user.is_active ? "opacity-50" : ""}`}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{user.username}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  user.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  {user.role}
                </span>
                {!user.is_active && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                    inactive
                  </span>
                )}
              </div>
              {user.display_name && user.display_name !== user.username && (
                <p className="text-xs text-muted-foreground">{user.display_name}</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {user.id === currentUserId ? (
                <span className="text-xs text-muted-foreground px-2">You</span>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleToggleRole(user)}
                    title={user.role === "admin" ? "Demote to user" : "Promote to admin"}
                  >
                    <Shield className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleToggleActive(user)}
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
        title={confirmTarget?.action === "deactivate" ? "Deactivate User" : "Demote Admin"}
        description={
          confirmTarget?.action === "deactivate"
            ? `Deactivate ${confirmTarget.user.username}? They will lose access.`
            : `Demote ${confirmTarget?.user.username} from admin to user?`
        }
        confirmLabel={confirmTarget?.action === "deactivate" ? "Deactivate" : "Demote"}
        variant="destructive"
        onConfirm={executeConfirm}
      />
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
  const [showAdd, setShowAdd] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const configuredNames = new Set(providers.map((p) => p.provider_name));
  const availablePresets = presets.filter((p) => !configuredNames.has(p.name));

  const handleAdd = async () => {
    if (!selectedPreset || !clientId || !clientSecret) return;
    try {
      await saveOAuthProvider({
        provider_name: selectedPreset,
        client_id: clientId,
        client_secret: clientSecret,
        enabled: true,
      });
      toast.success("OAuth provider added");
      setShowAdd(false);
      setSelectedPreset("");
      setClientId("");
      setClientSecret("");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add provider");
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
          <Button size="sm" onClick={() => { setShowAdd(!showAdd); if (!selectedPreset && availablePresets.length) setSelectedPreset(availablePresets[0].name); }}>
            <Plus className="h-4 w-4 mr-1" />
            Add Provider
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={selectedPreset} onValueChange={setSelectedPreset}>
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {availablePresets.map((p) => (
                  <SelectItem key={p.name} value={p.name}>{p.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Client ID</Label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="OAuth client ID" />
          </div>
          <div className="space-y-1.5">
            <Label>Client Secret</Label>
            <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="OAuth client secret" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {providers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No OAuth providers configured</p>
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => (
            <div key={provider.id} className="border rounded-lg p-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Key className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{provider.display_name || provider.provider_name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    provider.enabled ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"
                  }`}>
                    {provider.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Client ID: {provider.client_id.length > 20 ? `${provider.client_id.slice(0, 16)}...` : provider.client_id}</p>
              </div>
              {!(authMode === "multi_user_oauth" && providers.length <= 1) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(provider.provider_name)}
                  title="Remove provider"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Remove OAuth Provider"
        description={`Remove the ${deleteTarget} provider? Users who rely on it will lose access.`}
        confirmLabel="Remove"
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

  const handleToggleRegistration = async () => {
    try {
      await updateAdminConfig({ registration_enabled: !config.registration_enabled });
      toast.success(`Registration ${config.registration_enabled ? "disabled" : "enabled"}`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeTarget, setUpgradeTarget] = useState("");
  const [upgradePassword, setUpgradePassword] = useState("");
  const [showUpgradeConfirm, setShowUpgradeConfirm] = useState(false);

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
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
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
      setShowUpgrade(false);
      setUpgradePassword("");
      await fetchAuthMode();
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upgrade failed");
    }
  };

  const isOAuthTarget = upgradeTarget === "multi_user_oauth";
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
              <Label>Upgrade to</Label>
              <Select value={upgradeTarget} onValueChange={handleTargetChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableUpgrades.map((m) => (
                    <SelectItem key={m} value={m}>{modeLabels[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Password-based upgrade (single_password / multi_user) */}
            {!isOAuthTarget && upgradeTarget !== "open" && (
              <div className="space-y-1.5">
                <Label>{upgradeTarget === "single_password" ? "Shared Password" : "Admin Password"}</Label>
                <Input type="password" value={upgradePassword} onChange={(e) => setUpgradePassword(e.target.value)} />
              </div>
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
                        <div key={p.id} className="flex items-center gap-2 text-sm">
                          <Key className="h-3 w-3 text-green-500" />
                          <span>{p.display_name || p.provider_name}</span>
                          <span className="text-xs text-muted-foreground">({p.client_id.slice(0, 12)}...)</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {availablePresets.length > 0 && (
                    <div className="ml-7 border rounded-lg p-3 space-y-2 bg-background">
                      <select
                        value={selectedPreset}
                        onChange={(e) => setSelectedPreset(e.target.value)}
                        className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                      >
                        {availablePresets.map((p) => (
                          <option key={p.name} value={p.name}>{p.display_name}</option>
                        ))}
                      </select>
                      <Input size={1} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" className="h-8 text-sm" />
                      <Input size={1} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Client Secret" className="h-8 text-sm" />
                      <Button size="sm" onClick={handleAddProvider} disabled={oauthLoading || !clientId || !clientSecret}>
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
                <Button size="sm" onClick={() => setShowUpgradeConfirm(true)} disabled={!hasProvider || !adminLinked}>
                  Upgrade to OAuth
                </Button>
              ) : (
                <Button size="sm" onClick={() => setShowUpgradeConfirm(true)}>Upgrade</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setShowUpgrade(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {/* Registration toggle */}
      {(config.auth_mode === "multi_user" || config.auth_mode === "multi_user_oauth") && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">User Registration</p>
            <p className="text-xs text-muted-foreground">Allow new users to create accounts</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.registration_enabled}
            aria-label="Enable registration"
            onClick={handleToggleRegistration}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config.registration_enabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                config.registration_enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showUpgradeConfirm}
        onOpenChange={setShowUpgradeConfirm}
        title="Upgrade Auth Mode"
        description={`Upgrade to ${modeLabels[upgradeTarget] || upgradeTarget}? This cannot be undone.`}
        confirmLabel="Upgrade"
        variant="destructive"
        onConfirm={() => { setShowUpgradeConfirm(false); handleUpgrade(); }}
      />
    </div>
  );
}
