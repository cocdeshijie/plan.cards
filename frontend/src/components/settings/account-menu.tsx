"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { X, Key, Link2, Unlink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OAuthProviderIcon } from "@/components/ui/oauth-icons";
import {
  API_BASE,
  storeToken,
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
  const backdropPointerDown = useRef(false);
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
  const [oauthError, setOauthError] = useState(false);
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
      setOauthError(false);
    } catch {
      // Not silent any more: in OAuth-only mode this is the section that shows
      // the account you sign in with, so swallowing the failure rendered a
      // confident "No OAuth providers available." over a working linked
      // account — and hid the Unlink control with no way to retry.
      setOauthError(true);
    } finally {
      setLoadingOAuth(false);
    }
  }, [isOAuthMode]);

  useEffect(() => {
    loadOAuthData();
  }, [loadOAuthData]);

  // Escape key to close.
  //
  // Radix's dismissable layer (the Unlink ConfirmDialog) listens in the CAPTURE
  // phase and calls preventDefault() but never stopPropagation, so this
  // bubble-phase document listener used to fire too: one Escape dismissed the
  // dialog AND tore down the whole panel, discarding a half-typed password.
  // Two guards — the layer's own preventDefault, and any portalled overlay
  // living outside this panel (same selector useFocusTrap stands down on).
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

  // Lock body scroll while this full-screen overlay is open. Without it a touch
  // scroll that reaches the end of the panel chains straight through to the
  // page behind, which then sits at a different offset when the panel closes.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const handleSaveProfile = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      // Send the string even when it is empty. `displayName || undefined` drops
      // the key from the JSON body, the backend's `if display_name is not None`
      // then skips the assignment, and the getCurrentUser() refresh below wrote
      // the OLD name straight back — so clearing the field did nothing while
      // still toasting "Profile updated".
      await updateCurrentUser({ display_name: displayName.trim() });
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

  const handleChangePassword = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (changingPassword) return;
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setChangingPassword(true);
    try {
      const result = await changePassword({ current_password: currentPassword, new_password: newPassword });
      if (result.access_token) {
        storeToken(result.access_token);
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
        { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} }
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
      toast.success(`${providerLabel(unlinkTarget)} account unlinked`);
      await loadOAuthData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to unlink account");
    } finally {
      setUnlinking(null);
      setUnlinkTarget(null);
    }
  };

  const linkedProviders = new Set(oauthAccounts.map((a) => a.provider));
  const linkableProviders = oauthProviders.filter((p) => !linkedProviders.has(p.provider_name));

  /** One name per provider everywhere in this panel. The row used to CSS-
   *  capitalize the slug ("Github"), the Link button used `display_name`
   *  ("GitHub") and the confirm dialog + toast used the raw slug ("github") —
   *  three spellings of one thing inside a single screen. */
  const providerLabel = (name: string) =>
    oauthProviders.find((p) => p.provider_name === name)?.display_name ||
    name.charAt(0).toUpperCase() + name.slice(1);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
      // Close only when the gesture BEGAN on the backdrop. A drag-select that
      // started inside a password field and was released past the panel edge
      // reports the backdrop as its click target, and used to throw the form
      // away. `e.target === e.currentTarget` additionally keeps a click inside
      // a portalled ConfirmDialog — which bubbles the React tree, not the DOM
      // one — from reaching this handler at all.
      onPointerDown={(e) => {
        backdropPointerDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropPointerDown.current) onClose();
        backdropPointerDown.current = false;
      }}
    >
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
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close account settings"
            className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-6">
          {/* Profile info */}
          <form className="space-y-3" onSubmit={handleSaveProfile}>
            <h3 className="font-medium text-sm">Profile</h3>
            <div className="text-sm text-muted-foreground">
              Username:{" "}
              <span className="text-foreground font-medium" title={currentUser?.username}>
                {currentUser?.username}
              </span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="display-name">Display Name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                enterKeyHint="done"
                autoComplete="nickname"
              />
            </div>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving...</> : "Save"}
            </Button>
          </form>

          {/* Change password (hidden in OAuth-only mode) */}
          {!isOAuthMode && (
            <>
              <div className="h-px bg-border" />
              <form className="space-y-3" onSubmit={handleChangePassword}>
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
                  {newPassword.length > 0 && newPassword.length < 8 && (
                    <p className="text-xs text-muted-foreground">Password must be at least 8 characters</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-pw">Confirm New Password</Label>
                  <Input
                    id="confirm-pw"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    enterKeyHint="done"
                  />
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-xs text-danger">Passwords do not match</p>
                  )}
                </div>
                {/* Confirm is part of the disabled test, not just the inline
                    hint: the hint is gated on Confirm being non-empty, so
                    submitting with it blank used to skip every bit of inline
                    feedback and report the mismatch in a corner toast. */}
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    changingPassword ||
                    !currentPassword ||
                    newPassword.length < 8 ||
                    !confirmPassword ||
                    newPassword !== confirmPassword
                  }
                >
                  {changingPassword ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Changing...</> : "Change Password"}
                </Button>
              </form>
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
                ) : oauthError && oauthAccounts.length === 0 && oauthProviders.length === 0 ? (
                  // Only when there is nothing to fall back on. A failed
                  // *refresh* keeps the list already on screen rather than
                  // replacing a working panel with an error.
                  <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                    <p className="text-sm text-muted-foreground">
                      Couldn&apos;t load your linked accounts.
                    </p>
                    <Button size="sm" variant="outline" onClick={() => loadOAuthData()}>
                      Retry
                    </Button>
                  </div>
                ) : (
                  <>
                    {oauthAccounts.length > 0 && (
                      <div className="space-y-2">
                        {oauthAccounts.map((account) => (
                          <div
                            key={account.provider}
                            className="flex items-center justify-between gap-2 border rounded-lg p-3"
                          >
                            <div className="min-w-0">
                              {/* No CSS `capitalize` on the raw slug — it renders
                                  "Github". providerLabel() is the one spelling
                                  used by the row, the toast and the confirm. */}
                              <div className="flex items-center gap-1.5 text-sm font-medium">
                                <OAuthProviderIcon provider={account.provider} className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate" title={providerLabel(account.provider)}>
                                  {providerLabel(account.provider)}
                                </span>
                              </div>
                              {account.provider_email && (
                                <div className="text-xs text-muted-foreground truncate" title={account.provider_email}>
                                  {account.provider_email}
                                </div>
                              )}
                            </div>
                            {/* The reason sits on the wrapper as well as the
                                button: Button's base class carries
                                `disabled:pointer-events-none`, so the disabled
                                "only login method" state is never hit-tested and
                                its own title tooltip can never show. The button
                                keeps its title for the screen-reader
                                description. */}
                            <span
                              className="flex shrink-0"
                              title={oauthAccounts.length <= 1 ? "Cannot unlink your only login method" : "Unlink account"}
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0"
                                onClick={() => setUnlinkTarget(account.provider)}
                                disabled={unlinking === account.provider || oauthAccounts.length <= 1}
                                aria-label={`Unlink ${providerLabel(account.provider)}`}
                                title={oauthAccounts.length <= 1 ? "Cannot unlink your only login method" : "Unlink account"}
                              >
                                {unlinking === account.provider ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <><Unlink className="h-3.5 w-3.5 mr-1" />Unlink</>
                                )}
                              </Button>
                            </span>
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
                            <OAuthProviderIcon provider={provider.provider_name} className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                            Link {providerLabel(provider.provider_name)}
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

        {/* Inside the panel, not next to it: ConfirmDialog portals to <body>,
            but React synthetic events still bubble the REACT tree — so as a
            child of the backdrop every click inside the dialog also hit the
            backdrop's onClick and closed the whole Account panel. Rendering it
            in the panel's stopPropagation subtree is what admin-panel.tsx
            already does. */}
        <ConfirmDialog
          open={!!unlinkTarget}
          onOpenChange={(open) => { if (!open) setUnlinkTarget(null); }}
          title="Unlink Account"
          description={`Unlink your ${unlinkTarget ? providerLabel(unlinkTarget) : ""} account?`}
          confirmLabel="Unlink"
          pendingLabel="Unlinking…"
          variant="destructive"
          onConfirm={handleUnlinkOAuth}
        />
      </div>
    </div>
  );
}
