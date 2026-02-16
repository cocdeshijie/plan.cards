"use client";

import { useState } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/api";

export function OAuthLogin() {
  const { oauthProviders } = useAppStore();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const handleOAuth = async (providerName: string) => {
    setLoading(providerName);
    setError("");
    const redirectUri = `${window.location.origin}/auth/callback?provider=${providerName}`;
    localStorage.setItem("oauth_provider", providerName);
    try {
      const res = await fetch(
        `${API_BASE}/api/auth/oauth/${providerName}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to start OAuth");
      window.location.href = data.authorization_url;
    } catch (e) {
      setLoading(null);
      setError(e instanceof Error ? e.message : "Failed to start OAuth flow");
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-background to-purple-50 dark:from-blue-950/20 dark:via-background dark:to-purple-950/20">
      <div className="w-full max-w-sm">
        <div className="bg-card rounded-2xl shadow-lg border p-8 space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
              <CreditCard className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">CreditCardTracker</h1>
            <p className="text-sm text-muted-foreground">Sign in with your account</p>
          </div>

          <div className="space-y-2">
            {oauthProviders.map((provider) => (
              <Button
                key={provider.name}
                variant="outline"
                className="w-full h-11"
                onClick={() => handleOAuth(provider.name)}
                disabled={loading !== null}
              >
                {loading === provider.name ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Redirecting...</>
                ) : (
                  `Continue with ${provider.display_name}`
                )}
              </Button>
            ))}
          </div>

          {error && <p className="text-sm text-destructive text-center">{error}</p>}

          {oauthProviders.length === 0 && (
            <p className="text-sm text-muted-foreground text-center">
              No OAuth providers configured. Contact the administrator.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
