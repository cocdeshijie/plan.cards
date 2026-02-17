"use client";

import { useState, useEffect } from "react";
import { Home, Globe, Lock, Users, Shield, KeyRound, ChevronRight, ChevronLeft, Check, Loader2, Copy } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { completeSetup, getOAuthPresets, API_BASE, type OAuthPreset } from "@/lib/api";
import { useAppStore } from "@/hooks/use-app-store";
import type { AuthMode } from "@/types";

type HostingMode = "home" | "public";

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

  useEffect(() => {
    if (state.authMode === "multi_user_oauth" && oauthPresets.length === 0 && !presetsLoading) {
      setPresetsLoading(true);
      getOAuthPresets()
        .then((presets) => {
          setOauthPresets(presets);
          if (presets.length > 0 && !state.oauthPreset) {
            setState((s) => ({ ...s, oauthPreset: presets[0].name }));
          }
        })
        .catch(() => {})
        .finally(() => setPresetsLoading(false));
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
      return state.adminPassword.length >= 8 && state.adminPassword === state.confirmPassword;
    }
    if (state.authMode === "multi_user") {
      return (
        state.adminUsername.length > 0 &&
        state.adminPassword.length >= 8 &&
        state.adminPassword === state.confirmPassword
      );
    }
    if (state.authMode === "multi_user_oauth") {
      return !!state.oauthPreset && !!state.oauthClientId && !!state.oauthClientSecret;
    }
    return false;
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
                  {submitting
                    ? "Setting up..."
                    : state.authMode === "multi_user_oauth"
                    ? "Complete & Connect OAuth"
                    : "Complete Setup"}
                  <Check className="h-4 w-4 ml-1" />
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
        <h2 className="text-xl font-semibold">How will you host this?</h2>
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
        <h2 className="text-xl font-semibold">Choose authentication</h2>
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
    await navigator.clipboard.writeText(redirectUri);
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
        <code className="flex-1 text-xs bg-muted rounded-md px-3 py-2 break-all select-all">
          {redirectUri}
        </code>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleCopy}>
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function ConfigStep({
  state,
  onChange,
  error,
  oauthPresets = [],
  presetsLoading = false,
}: {
  state: WizardState;
  onChange: (partial: Partial<WizardState>) => void;
  error: string;
  oauthPresets?: OAuthPreset[];
  presetsLoading?: boolean;
}) {
  if (state.authMode === "open") {
    return (
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-500/10">
          <Check className="h-8 w-8 text-green-500" />
        </div>
        <h2 className="text-xl font-semibold">Ready to go!</h2>
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
          <h2 className="text-xl font-semibold">Configure OAuth Provider</h2>
          <p className="text-sm text-muted-foreground">
            The first person to sign in will become the admin
          </p>
        </div>

        <div className="space-y-3">
          {presetsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading providers...
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="oauth-preset">Provider</Label>
                <Select value={state.oauthPreset} onValueChange={(v) => onChange({ oauthPreset: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {oauthPresets.map((p) => (
                      <SelectItem key={p.name} value={p.name}>{p.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <RedirectUriDisplay provider={state.oauthPreset} />
              <div className="space-y-1.5">
                <Label htmlFor="oauth-client-id">Client ID</Label>
                <Input
                  id="oauth-client-id"
                  value={state.oauthClientId}
                  onChange={(e) => onChange({ oauthClientId: e.target.value })}
                  placeholder="Your OAuth client ID"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="oauth-client-secret">Client Secret</Label>
                <Input
                  id="oauth-client-secret"
                  type="password"
                  value={state.oauthClientSecret}
                  onChange={(e) => onChange({ oauthClientSecret: e.target.value })}
                  placeholder="Your OAuth client secret"
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-sm font-medium">Allow registration</p>
              <p className="text-xs text-muted-foreground">Let others create accounts via OAuth</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.registrationEnabled}
              aria-label="Enable user registration"
              onClick={() => onChange({ registrationEnabled: !state.registrationEnabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                state.registrationEnabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  state.registrationEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            After setup, you'll sign in with {state.oauthPreset ? oauthPresets.find(p => p.name === state.oauthPreset)?.display_name || state.oauthPreset : "your provider"} to create your admin account.
          </p>
        </div>

        {error && <p className="text-sm text-destructive text-center">{error}</p>}
      </div>
    );
  }

  const needsUsername = state.authMode === "multi_user";

  return (
    <div className="space-y-4">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">
          {needsUsername ? "Create admin account" : "Set password"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {needsUsername
            ? "This will be the administrator account"
            : "This password protects access to your instance"}
        </p>
      </div>

      <div className="space-y-3">
        {needsUsername && (
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={state.adminUsername}
              onChange={(e) => onChange({ adminUsername: e.target.value })}
              placeholder="admin"
              autoComplete="username"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={state.adminPassword}
            onChange={(e) => onChange({ adminPassword: e.target.value })}
            autoComplete="new-password"
          />
          {state.adminPassword.length > 0 && state.adminPassword.length < 8 && (
            <p className="text-xs text-muted-foreground">Password must be at least 8 characters</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm Password</Label>
          <Input
            id="confirm-password"
            type="password"
            value={state.confirmPassword}
            onChange={(e) => onChange({ confirmPassword: e.target.value })}
            autoComplete="new-password"
          />
          {state.confirmPassword && state.adminPassword !== state.confirmPassword && (
            <p className="text-xs text-destructive">Passwords do not match</p>
          )}
        </div>

        {needsUsername && (
          <div className="space-y-1.5">
            <Label htmlFor="email">Email (optional)</Label>
            <Input
              id="email"
              type="email"
              value={state.adminEmail}
              onChange={(e) => onChange({ adminEmail: e.target.value })}
              placeholder="admin@example.com"
            />
          </div>
        )}

        {needsUsername && (
          <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-sm font-medium">Allow registration</p>
              <p className="text-xs text-muted-foreground">Let others create accounts</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.registrationEnabled}
              aria-label="Enable user registration"
              onClick={() => onChange({ registrationEnabled: !state.registrationEnabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                state.registrationEnabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  state.registrationEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
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
      </div>

      {error && <p className="text-sm text-destructive text-center">{error}</p>}
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
