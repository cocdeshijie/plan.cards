"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API_BASE, adminLinkOAuth, userLinkOAuth } from "@/lib/api";
import { CreditCard, Loader2 } from "lucide-react";

function OAuthCallbackContent() {
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    // Check for provider errors (e.g. user denied access)
    const errorParam = searchParams.get("error");
    const errorDesc = searchParams.get("error_description");
    if (errorParam) {
      localStorage.removeItem("oauth_provider");
      localStorage.removeItem("oauth_flow_type");
      setError(
        errorParam === "access_denied"
          ? "Access denied. You can try again from the login page."
          : errorDesc || `OAuth error: ${errorParam}`
      );
      return;
    }

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const provider = searchParams.get("provider") || localStorage.getItem("oauth_provider");

    if (!code || !state || !provider) {
      setError("Missing OAuth callback parameters. Please start the sign-in process from the login page.");
      return;
    }

    const redirectUri = `${window.location.origin}/auth/callback?provider=${provider}`;
    const flowType = localStorage.getItem("oauth_flow_type");

    // Clean up localStorage early
    localStorage.removeItem("oauth_flow_type");
    localStorage.removeItem("oauth_provider");

    if (flowType === "admin_link") {
      adminLinkOAuth({ provider_name: provider, code, state, redirect_uri: redirectUri })
        .then(() => {
          window.location.href = "/?oauth_linked=1";
        })
        .catch((e) => {
          setError(e.message);
        });
    } else if (flowType === "user_link") {
      userLinkOAuth({ provider_name: provider, code, state, redirect_uri: redirectUri })
        .then(() => {
          window.location.href = "/?oauth_linked=1";
        })
        .catch((e) => {
          setError(e.message);
        });
    } else {
      // Regular OAuth login flow
      fetch(`${API_BASE}/api/auth/oauth/${provider}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state, redirect_uri: redirectUri }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || "OAuth login failed");
          }
          return res.json();
        })
        .then((data) => {
          localStorage.setItem("token", data.access_token);
          window.location.href = "/";
        })
        .catch((e) => {
          setError(e.message);
        });
    }
  }, [searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-background to-purple-50 dark:from-blue-950/20 dark:via-background dark:to-purple-950/20">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10">
          <CreditCard className="h-8 w-8 text-primary" />
        </div>
        {error ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive max-w-xs mx-auto">{error}</p>
            <a href="/" className="text-sm text-primary hover:underline">Back to login</a>
          </div>
        ) : (
          <div className="flex items-center gap-2 justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Completing sign in...</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <OAuthCallbackContent />
    </Suspense>
  );
}
