"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Home, Globe, Lock, Users, Shield, KeyRound, ChevronRight, ChevronLeft, Check, Loader2, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OAuthProviderIcon } from "@/components/ui/oauth-icons";
import { copyToClipboard } from "@/lib/clipboard";
import { completeSetup, getOAuthPresets, API_BASE, type OAuthPreset } from "@/lib/api";
import { useAppStore } from "@/hooks/use-app-store";
import type { AuthMode } from "@/types";

type HostingMode = "home" | "public";

/** Mirrors the backend's `min_length=8` on the setup password. */
const MIN_PASSWORD_LENGTH = 8;

interface WizardState {
  hostingMode: HostingMode | null;
  authMode: AuthMode | null;
  adminUsername: string;
  adminPassword: string;
  confirmPassword: string;
  adminEmail: string;
  registrationEnabled: boolean;
  oauthPreset: string;
  oauthClientId: string;
  oauthClientSecret: string;
}

export function OnboardingWizard() {
  const { hasExistingData, setSetupComplete } = useAppStore();
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<WizardState>({
    hostingMode: null,
    authMode: null,
    adminUsername: "",
    adminPassword: "",
    confirmPassword: "",
    adminEmail: "",
    registrationEnabled: true,
    oauthPreset: "",
    oauthClientId: "",
    oauthClientSecret: "",
  });
  const [oauthPresets, setOauthPresets] = useState<OAuthPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetsError, setPresetsError] = useState("");

  /**
   * This used to swallow the failure. A dropped request left the Provider
   * select with zero options, no message and no retry — and validateConfig()
   * needs a preset, so "Complete & Connect OAuth" stayed disabled forever on
   * the last step of first-run setup, with nothing on screen explaining why.
   */
  const loadPresets = useCallback(() => {
    setPresetsLoading(true);
    setPresetsError("");
    getOAuthPresets()
      .then((presets) => {
        setOauthPresets(presets);
        // Functional update: this runs outside the effect's dep list, so the
        // captured state.oauthPreset would be stale.
        setState((s) => (s.oauthPreset || presets.length === 0 ? s : { ...s, oauthPreset: presets[0].name }));
      })
      .catch((e) => {
        setPresetsError(e instanceof Error ? e.message : "Couldn't load the OAuth provider list.");
      })
      .finally(() => setPresetsLoading(false));
  }, []);

  useEffect(() => {
    if (state.authMode === "multi_user_oauth" && oauthPresets.length === 0 && !presetsLoading) {
      loadPresets();
    }
  }, [state.authMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (partial: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...partial }));
    setError("");
  };

  const totalSteps = 4; // welcome, hosting, auth mode, config
  const progress = ((step + 1) / totalSteps) * 100;

  const canGoNext = () => {
    switch (step) {
      case 0: return true; // welcome
      case 1: return state.hostingMode !== null;
      case 2: return state.authMode !== null;
      case 3: return validateConfig();
      default: return false;
    }
  };

  const validateConfig = () => {
    if (state.authMode === "open") return true;
    if (state.authMode === "single_password") {
      return state.adminPassword.length >= MIN_PASSWORD_LENGTH && state.adminPassword === state.confirmPassword;
    }
    if (state.authMode === "multi_user") {
      return (
        state.adminUsername.length > 0 &&
        state.adminPassword.length >= MIN_PASSWORD_LENGTH &&
        state.adminPassword === state.confirmPassword
      );
    }
    if (state.authMode === "multi_user_oauth") {
      return !!state.oauthPreset && !!state.oauthClientId && !!state.oauthClientSecret;
    }
    return false;
  };

  /**
   * Enter inside a ConfigStep field goes through the same gate as the button:
   * the final step's inputs are the last thing a user touches before setup is
   * written, and Enter used to do nothing at all.
   */
  const submitIfReady = () => {
    if (submitting || !canGoNext()) return;
    void handleSubmit();
  };

  const handleSubmit = async () => {
    if (!state.authMode) return;

    if (state.authMode !== "open" && state.authMode !== "multi_user_oauth" &&
        state.adminPassword !== state.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    setError("");

    const isOAuthFlow = state.authMode === "multi_user_oauth";

    try {
      if (isOAuthFlow) {
        // OAuth flow: backend creates provider + sets config, no user created
        await completeSetup({
          auth_mode: "multi_user_oauth",
          oauth_provider_name: state.oauthPreset,
          oauth_client_id: state.oauthClientId,
          oauth_client_secret: state.oauthClientSecret,
          registration_enabled: state.registrationEnabled,
        });

        // Redirect to OAuth — no token needed (multi_user_oauth mode allows anyone)
        const providerName = state.oauthPreset;
        const redirectUri = `${window.location.origin}/auth/callback?provider=${providerName}`;
        localStorage.setItem("oauth_provider", providerName);

        const res = await fetch(
          `${API_BASE}/api/auth/oauth/${providerName}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Failed to start OAuth flow");

        window.location.href = data.authorization_url;
      } else {
        // Non-OAuth flow
        await completeSetup({
          auth_mode: state.authMode,
          admin_username: state.authMode === "multi_user" ? state.adminUsername : undefined,
          admin_password: state.authMode !== "open" ? state.adminPassword : undefined,
          admin_email: state.adminEmail || undefined,
          registration_enabled: state.registrationEnabled,
        });
        setSetupComplete();
        window.location.reload();
      }
    } catch (e) {
      localStorage.removeItem("oauth_provider");
      setError(e instanceof Error ? e.message : "Setup failed");
      // If OAuth setup succeeded but redirect failed, reload to show login page
      if (isOAuthFlow) {
        setSetupComplete();
        setTimeout(() => window.location.reload(), 3000);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-background to-purple-50 dark:from-blue-950/20 dark:via-background dark:to-purple-950/20 p-4">
      <div className="w-full max-w-lg">
        <div className="bg-card rounded-2xl shadow-lg border overflow-hidden">
          {/* Progress bar */}
          <div className="h-1 bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="p-8">
            {step === 0 && <WelcomeStep hasExistingData={hasExistingData} />}
            {step === 1 && <HostingStep value={state.hostingMode} onChange={(m) => update({ hostingMode: m, authMode: null })} />}
            {step === 2 && <AuthModeStep hostingMode={state.hostingMode!} value={state.authMode} onChange={(m) => update({ authMode: m })} />}
            {step === 3 && (
              <ConfigStep
                state={state}
                onChange={update}
                error={error}
                oauthPresets={oauthPresets}
                presetsLoading={presetsLoading}
                presetsError={presetsError}
                onRetryPresets={loadPresets}
                onSubmit={submitIfReady}
              />
            )}

            {/* Navigation */}
            <div className="flex justify-between mt-8">
              <Button
                variant="ghost"
                onClick={() => setStep((s) => s - 1)}
                disabled={step === 0}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              {step < totalSteps - 1 ? (
                <Button onClick={() => setStep((s) => s + 1)} disabled={!canGoNext()}>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={!canGoNext() || submitting}>
                  {/* A success checkmark next to "Setting up..." claimed the
                      setup had already finished. */}
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Setting up...</>
                  ) : (
                    <>
                      {state.authMode === "multi_user_oauth"
                        ? "Complete & Connect OAuth"
                        : "Complete Setup"}
                      <Check className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WelcomeStep({ hasExistingData }: { hasExistingData: boolean }) {
  return (
    <div className="text-center space-y-4">
      <Logo className="h-20 w-20 mx-auto" />
      <h1 className="text-2xl font-bold tracking-tight">Welcome to plan.cards</h1>
      <p className="text-muted-foreground">
        {hasExistingData
          ? "We detected existing data. Let's set up authentication to secure your instance."
          : "Let's get your instance set up. This will only take a moment."}
      </p>
    </div>
  );
}

function HostingStep({ value, onChange }: { value: HostingMode | null; onChange: (m: HostingMode) => void }) {
  return (
    <div className="space-y-4">
      <div className="text-center space-y-2">
        <h1 className="text-xl font-semibold">How will you host this?</h1>
        <p className="text-sm text-muted-foreground">This helps us recommend the right security settings</p>
      </div>
      <div className="grid gap-3">
        <OptionCard
          selected={value === "home"}
          onClick={() => onChange("home")}
          icon={<Home className="h-5 w-5" />}
          title="Home / Local Network"
          description="Running on your home server, NAS, or local machine"
        />
        <OptionCard
          selected={value === "public"}
          onClick={() => onChange("public")}
          icon={<Globe className="h-5 w-5" />}
          title="Public / Cloud"
          description="Accessible from the internet (VPS, cloud hosting, etc.)"
        />
      </div>
    </div>
  );
}

function AuthModeStep({
  hostingMode,
  value,
  onChange,
}: {
  hostingMode: HostingMode;
  value: AuthMode | null;
  onChange: (m: AuthMode) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="text-center space-y-2">
        <h1 className="text-xl font-semibold">Choose authentication</h1>
        <p className="text-sm text-muted-foreground">You can always upgrade later — including OAuth/SSO</p>
      </div>
      <div className="grid gap-3">
        {hostingMode === "home" && (
          <OptionCard
            selected={value === "open"}
            onClick={() => onChange("open")}
            icon={<Shield className="h-5 w-5" />}
            title="No Password"
            description="Quick access — best for trusted home networks"
          />
        )}
        <OptionCard
          selected={value === "single_password"}
          onClick={() => onChange("single_password")}
          icon={<Lock className="h-5 w-5" />}
          title="Simple Password"
          description="Single shared password to access the app"
        />
        <OptionCard
          selected={value === "multi_user"}
          onClick={() => onChange("multi_user")}
          icon={<Users className="h-5 w-5" />}
          title="Multi-User"
          description="Individual accounts with username & password"
        />
        <OptionCard
          selected={value === "multi_user_oauth"}
          onClick={() => onChange("multi_user_oauth")}
          icon={<KeyRound className="h-5 w-5" />}
          title="Multi-User with OAuth"
          description="Individual accounts with SSO (Google, GitHub, etc.)"
        />
        {hostingMode === "public" && value === "single_password" && (
          <p className="text-xs text-amber-600 dark:text-amber-400 px-1">
            For public instances, Multi-User with individual accounts is recommended.
          </p>
        )}
      </div>
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
    // self-hosted instance during setup — is not one. The bare call threw into
    // nothing, so the click did nothing and said nothing. copyToClipboard
    // falls back to execCommand and reports which path it took.
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
      {/* Not a <Label>: there is no form control to point it at, and a <label>
          for nothing is a label a screen reader can never resolve. */}
      <p className="text-sm font-medium leading-snug">Redirect URI</p>
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
      {/* The icon swap is the only visual feedback; this is the spoken half. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Redirect URI copied to clipboard" : ""}
      </span>
    </div>
  );
}

function ConfigStep({
  state,
  onChange,
  error,
  oauthPresets = [],
  presetsLoading = false,
  presetsError = "",
  onRetryPresets,
  onSubmit,
}: {
  state: WizardState;
  onChange: (partial: Partial<WizardState>) => void;
  error: string;
  oauthPresets?: OAuthPreset[];
  presetsLoading?: boolean;
  presetsError?: string;
  onRetryPresets?: () => void;
  onSubmit: () => void;
}) {
  // Per-instance ids: Radix's Label makes no implicit association, so a Label
  // without htmlFor focuses nothing on click and its field announces unlabelled.
  const uid = useId();
  const presetId = `${uid}-oauth-preset`;
  const clientIdId = `${uid}-oauth-client-id`;
  const clientSecretId = `${uid}-oauth-client-secret`;
  const usernameId = `${uid}-username`;
  const passwordId = `${uid}-password`;
  const passwordHintId = `${uid}-password-hint`;
  const confirmId = `${uid}-confirm-password`;
  const confirmHintId = `${uid}-confirm-hint`;
  const emailId = `${uid}-email`;
  const registrationId = `${uid}-registration`;
  const registrationHintId = `${uid}-registration-hint`;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  if (state.authMode === "open") {
    return (
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-500/10">
          <Check className="h-8 w-8 text-green-500" />
        </div>
        <h1 className="text-xl font-semibold">Ready to go!</h1>
        <p className="text-sm text-muted-foreground">
          No password needed. A default account will be created for you.
          You can add authentication later in settings, including OAuth/SSO.
        </p>
      </div>
    );
  }

  if (state.authMode === "multi_user_oauth") {
    return (
      <div className="space-y-4">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold">Configure OAuth Provider</h1>
          <p className="text-sm text-muted-foreground">
            The first person to sign in will become the admin
          </p>
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-3">
          {presetsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading providers...
            </div>
          ) : presetsError ? (
            <div className="space-y-2 rounded-lg border border-input p-3">
              <p role="alert" className="text-sm text-danger">{presetsError}</p>
              <p className="text-xs text-muted-foreground">
                Setup can&apos;t continue without the provider list.
              </p>
              {onRetryPresets && (
                <Button type="button" variant="outline" size="sm" onClick={onRetryPresets}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Retry
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={presetId}>Provider</Label>
                <Select value={state.oauthPreset} onValueChange={(v) => onChange({ oauthPreset: v })}>
                  <SelectTrigger id={presetId}>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {oauthPresets.map((p) => (
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
              <RedirectUriDisplay provider={state.oauthPreset} />
              <div className="space-y-1.5">
                <Label htmlFor={clientIdId}>Client ID</Label>
                {/* autoCapitalize/autoCorrect off: these are byte-exact
                    credentials, and iOS turns "abc123…" into "Abc123…" — a
                    mangling that only surfaces later, at the redirect, after
                    setup has already been written. */}
                <Input
                  id={clientIdId}
                  value={state.oauthClientId}
                  onChange={(e) => onChange({ oauthClientId: e.target.value })}
                  placeholder="Your OAuth client ID"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={clientSecretId}>Client Secret</Label>
                <Input
                  id={clientSecretId}
                  type="password"
                  value={state.oauthClientSecret}
                  onChange={(e) => onChange({ oauthClientSecret: e.target.value })}
                  placeholder="Your OAuth client secret"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                />
              </div>
            </>
          )}

          {/* The shared Switch, not a hand-rolled one: the local copy painted a
              white knob on a bg-muted track, ~1.1:1 in light mode, so its OFF
              state read as a blank pill. */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="min-w-0">
              <Label htmlFor={registrationId}>Allow registration</Label>
              <p id={registrationHintId} className="text-xs text-muted-foreground">Let others create accounts via OAuth</p>
            </div>
            <Switch
              id={registrationId}
              checked={state.registrationEnabled}
              onCheckedChange={(checked) => onChange({ registrationEnabled: checked })}
              aria-describedby={registrationHintId}
              className="shrink-0"
            />
          </div>

          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            After setup, you&apos;ll sign in with {state.oauthPreset ? oauthPresets.find(p => p.name === state.oauthPreset)?.display_name || state.oauthPreset : "your provider"} to create your admin account.
          </p>

          {/* Enter in any field above runs the same submit as the nav button;
              the wizard has no submit control of its own inside the form. */}
          <button type="submit" hidden>Complete setup</button>
        </form>

        {error && <p role="alert" className="text-sm text-danger text-center">{error}</p>}
      </div>
    );
  }

  const needsUsername = state.authMode === "multi_user";

  return (
    <div className="space-y-4">
      <div className="text-center space-y-2">
        <h1 className="text-xl font-semibold">
          {needsUsername ? "Create admin account" : "Set password"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {needsUsername
            ? "This will be the administrator account"
            : "This password protects access to your instance"}
        </p>
      </div>

      <form onSubmit={handleFormSubmit} className="space-y-3">
        {needsUsername && (
          <div className="space-y-1.5">
            <Label htmlFor={usernameId}>Username</Label>
            {/* autoCapitalize off: iOS capitalises the first letter of an empty
                field, and this one becomes the admin login name for good. */}
            <Input
              id={usernameId}
              value={state.adminUsername}
              onChange={(e) => onChange({ adminUsername: e.target.value })}
              placeholder="admin"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={passwordId}>Password</Label>
          <Input
            id={passwordId}
            type="password"
            value={state.adminPassword}
            onChange={(e) => onChange({ adminPassword: e.target.value })}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            aria-describedby={passwordHintId}
            enterKeyHint="next"
          />
          <p id={passwordHintId} className="text-xs text-muted-foreground">
            {state.adminPassword.length > 0 && state.adminPassword.length < MIN_PASSWORD_LENGTH
              ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
              : `At least ${MIN_PASSWORD_LENGTH} characters`}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={confirmId}>Confirm Password</Label>
          <Input
            id={confirmId}
            type="password"
            value={state.confirmPassword}
            onChange={(e) => onChange({ confirmPassword: e.target.value })}
            autoComplete="new-password"
            aria-describedby={state.confirmPassword && state.adminPassword !== state.confirmPassword ? confirmHintId : undefined}
            enterKeyHint={needsUsername ? "next" : "done"}
          />
          {state.confirmPassword && state.adminPassword !== state.confirmPassword && (
            <p id={confirmHintId} className="text-xs text-danger">Passwords do not match</p>
          )}
        </div>

        {needsUsername && (
          <div className="space-y-1.5">
            <Label htmlFor={emailId}>Email (optional)</Label>
            <Input
              id={emailId}
              type="email"
              value={state.adminEmail}
              onChange={(e) => onChange({ adminEmail: e.target.value })}
              placeholder="admin@example.com"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              enterKeyHint="done"
            />
          </div>
        )}

        {needsUsername && (
          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="min-w-0">
              <Label htmlFor={registrationId}>Allow registration</Label>
              <p id={registrationHintId} className="text-xs text-muted-foreground">Let others create accounts</p>
            </div>
            <Switch
              id={registrationId}
              checked={state.registrationEnabled}
              onCheckedChange={(checked) => onChange({ registrationEnabled: checked })}
              aria-describedby={registrationHintId}
              className="shrink-0"
            />
          </div>
        )}

        {state.authMode === "single_password" && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 mt-2">
            You can upgrade to multi-user accounts with OAuth/SSO later from settings.
          </p>
        )}
        {state.authMode === "multi_user" && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 mt-2">
            OAuth/SSO (Google, GitHub, etc.) can be enabled from the admin panel after setup.
          </p>
        )}

        {/* Enter in any field above runs the same submit as the nav button;
            the wizard has no submit control of its own inside the form. */}
        <button type="submit" hidden>Complete setup</button>
      </form>

      {error && <p role="alert" className="text-sm text-danger text-center">{error}</p>}
    </div>
  );
}

function OptionCard({
  selected,
  onClick,
  icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      // aria-pressed, matching the card-details filter chips: the border/tint
      // was the only signal, and this is the one irreversible choice in setup.
      aria-pressed={selected}
      onClick={onClick}
      className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
        selected
          ? "border-primary bg-primary/5"
          : "border-transparent bg-muted/50 hover:bg-muted"
      }`}
    >
      <div className={`mt-0.5 ${selected ? "text-primary" : "text-muted-foreground"}`}>
        {icon}
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
