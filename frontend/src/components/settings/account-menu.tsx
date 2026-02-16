"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { X, Key, Link2, Unlink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  API_BASE,
  getCurrentUser,
  updateCurrentUser,
  changePassword,
  getUserOAuthAccounts,
  userUnlinkOAuth,
  getOAuthProviders,
  type UserOAuthAccount,
  type OAuthProviderConfig,
} from "@/lib/api";
import { toast } from "sonner";

interface AccountMenuProps {
  onClose: () => void;
}

export function AccountMenu({ onClose }: AccountMenuProps) {
  const panelRef = useFocusTrap<HTMLDivElement>();
  const authMode = useAppStore((s) => s.authMode);
  const currentUser = useAppStore((s) => s.currentUser);

  const [displayName, setDisplayName] = useState(currentUser?.display_name || "");
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [oauthAccounts, setOauthAccounts] = useState<UserOAuthAccount[]>([]);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderConfig[]>([]);
  const [loadingOAuth, setLoadingOAuth] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);

  const isOAuthMode = authMode === "multi_user_oauth";

  const loadOAuthData = useCallback(async () => {
    if (!isOAuthMode) return;
    setLoadingOAuth(true);
    try {
      const [accounts, providers] = await Promise.all([
        getUserOAuthAccounts(),
        getOAuthProviders(),
      ]);
      setOauthAccounts(accounts);
      setOauthProviders(providers);
    } catch {
      // Silent — non-critical
    } finally {
      setLoadingOAuth(false);
    }
  }, [isOAuthMode]);

  useEffect(() => {
    loadOAuthData();
  }, [loadOAuthData]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await updateCurrentUser({ display_name: displayName || undefined });
      toast.success("Profile updated");
      // Refresh user data in store
      const updated = await getCurrentUser();
      useAppStore.setState({ currentUser: updated });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setChangingPassword(true);
    try {
      const result = await changePassword({ current_password: currentPassword, new_password: newPassword });
      if (result.access_token) {
        localStorage.setItem("token", result.access_token);
      }
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleLinkOAuth = async (providerName: string) => {
    const redirectUri = `${window.location.origin}/auth/callback?provider=${providerName}`;
    localStorage.setItem("oauth_flow_type", "user_link");
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
      localStorage.removeItem("oauth_provider");
      toast.error(e instanceof Error ? e.message : "Failed to start OAuth flow");
    }
  };

  const [unlinkTarget, setUnlinkTarget] = useState<string | null>(null);

  const handleUnlinkOAuth = async () => {
    if (!unlinkTarget) return;
    setUnlinking(unlinkTarget);
    try {
      await userUnlinkOAuth(unlinkTarget);
      toast.success(`${unlinkTarget} account unlinked`);
      loadOAuthData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to unlink account");
    } finally {
      setUnlinking(null);
      setUnlinkTarget(null);
    }
  };

  const linkedProviders = new Set(oauthAccounts.map((a) => a.provider));
  const linkableProviders = oauthProviders.filter((p) => !linkedProviders.has(p.provider_name));

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Account settings"
        className="fixed inset-y-0 right-0 w-full max-w-md bg-card border-l shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Account</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Profile info */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm">Profile</h3>
            <div className="text-sm text-muted-foreground">
              Username: <span className="text-foreground font-medium">{currentUser?.username}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="display-name">Display Name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
              />
            </div>
            <Button size="sm" onClick={handleSaveProfile} disabled={saving}>
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving...</> : "Save"}
            </Button>
          </div>

          {/* Change password (hidden in OAuth-only mode) */}
          {!isOAuthMode && (
            <>
              <div className="h-px bg-border" />
              <div className="space-y-3">
                <h3 className="font-medium text-sm">Change Password</h3>
                <div className="space-y-1.5">
                  <Label htmlFor="current-pw">Current Password</Label>
                  <Input
                    id="current-pw"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-pw">New Password</Label>
                  <Input
                    id="new-pw"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-pw">Confirm New Password</Label>
                  <Input
                    id="confirm-pw"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-xs text-destructive">Passwords do not match</p>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={handleChangePassword}
                  disabled={changingPassword || !currentPassword || !newPassword}
                >
                  {changingPassword ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Changing...</> : "Change Password"}
                </Button>
              </div>
            </>
          )}

          {/* OAuth linked accounts */}
          {isOAuthMode && (
            <>
              <div className="h-px bg-border" />
              <div className="space-y-3">
                <h3 className="font-medium text-sm flex items-center gap-1.5">
                  <Key className="h-4 w-4" />
                  Linked Accounts
                </h3>
                {loadingOAuth ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading...
                  </div>
                ) : (
                  <>
                    {oauthAccounts.length > 0 && (
                      <div className="space-y-2">
                        {oauthAccounts.map((account) => (
                          <div
                            key={account.provider}
                            className="flex items-center justify-between border rounded-lg p-3"
                          >
                            <div>
                              <div className="text-sm font-medium capitalize">{account.provider}</div>
                              {account.provider_email && (
                                <div className="text-xs text-muted-foreground">{account.provider_email}</div>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setUnlinkTarget(account.provider)}
                              disabled={unlinking === account.provider || oauthAccounts.length <= 1}
                              title={oauthAccounts.length <= 1 ? "Cannot unlink your only login method" : "Unlink account"}
                            >
                              {unlinking === account.provider ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <><Unlink className="h-3.5 w-3.5 mr-1" />Unlink</>
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {linkableProviders.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Link additional accounts:</p>
                        {linkableProviders.map((provider) => (
                          <Button
                            key={provider.provider_name}
                            variant="outline"
                            size="sm"
                            className="w-full justify-start"
                            onClick={() => handleLinkOAuth(provider.provider_name)}
                          >
                            <Link2 className="h-3.5 w-3.5 mr-1.5" />
                            Link {provider.display_name || provider.provider_name}
                          </Button>
                        ))}
                      </div>
                    )}

                    {oauthAccounts.length === 0 && linkableProviders.length === 0 && (
                      <p className="text-sm text-muted-foreground">No OAuth providers available.</p>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!unlinkTarget}
        onOpenChange={(open) => { if (!open) setUnlinkTarget(null); }}
        title="Unlink Account"
        description={`Unlink your ${unlinkTarget} account?`}
        confirmLabel="Unlink"
        variant="destructive"
        onConfirm={handleUnlinkOAuth}
      />
    </div>
  );
}
