"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { API_BASE, adminLinkOAuth, userLinkOAuth, storeToken } from "@/lib/api";
import { CreditCard, Loader2 } from "lucide-react";

/** How long the exchange may run before we offer a way out of the spinner. */
const SLOW_AFTER_MS = 10_000;

/**
 * The backend answers a stale or replayed OAuth state with one-word internal
 * strings — "Unauthorized", "Forbidden" — and this screen rendered them as its
 * entire content. A single word is not an explanation and names no next step,
 * so anything that isn't a sentence is replaced with one that is.
 */
function friendlyMessage(raw: unknown, fallback: string): string {
  const text = (raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "").trim();
  if (!text) return fallback;
  if (/^(unauthorized|forbidden|not authenticated|invalid token|bad request)\.?$/i.test(text)) {
    return "That sign-in link is no longer valid — it may have already been used or expired. Please start again from the login page.";
  }
  // A bare token or enum ("invalid_grant") is no better than the fallback; a
  // real sentence from the server usually is.
  if (!/\s/.test(text)) return fallback;
  return text;
}

const LOGIN_FALLBACK = "Sign-in couldn't be completed. Please try again from the login page.";
const LINK_FALLBACK = "That account couldn't be linked. Please try again from settings.";

function OAuthCallbackContent() {
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const processedRef = useRef(false);

  // Armed outside the processedRef guard so it survives React's development
  // double-invoke, where the second pass returns early.
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

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
    // Validate the provider slug before interpolating it into API paths / redirect_uri.
    if (!/^[a-z0-9_-]+$/.test(provider)) {
      setError("Invalid OAuth provider. Please start the sign-in process from the login page.");
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
          setError(friendlyMessage(e, LINK_FALLBACK));
        });
    } else if (flowType === "user_link") {
      userLinkOAuth({ provider_name: provider, code, state, redirect_uri: redirectUri })
        .then(() => {
          window.location.href = "/?oauth_linked=1";
        })
        .catch((e) => {
          setError(friendlyMessage(e, LINK_FALLBACK));
        });
    } else {
      // Regular OAuth login flow
      fetch(`${API_BASE}/api/auth/oauth/${provider}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code, state, redirect_uri: redirectUri }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(typeof body.detail === "string" ? body.detail : "");
          }
          return res.json();
        })
        .then((data) => {
          storeToken(data.access_token);
          window.location.href = "/";
        })
        .catch((e) => {
          setError(friendlyMessage(e, LOGIN_FALLBACK));
        });
    }
  }, [searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-background to-purple-50 dark:from-blue-950/20 dark:via-background dark:to-purple-950/20 px-4">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10">
          <CreditCard className="h-8 w-8 text-primary" />
        </div>
        {/* The page's only heading, and the only thing announced on arrival —
            the spinner-to-error swap below is otherwise silent. */}
        <h1 className="sr-only">Completing sign in</h1>
        {error ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-danger max-w-xs mx-auto">{error}</p>
            <Link href="/" className="text-sm text-primary hover:underline">Back to login</Link>
          </div>
        ) : (
          <div role="status" className="space-y-2">
            <div className="flex items-center gap-2 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">Completing sign in...</p>
            </div>
            {/* A request that hangs rather than fails never reaches the error
                branch, and this screen has no other way out. */}
            {slow && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                  This is taking longer than usual.
                </p>
                <Link href="/" className="text-sm text-primary hover:underline">Back to login</Link>
              </div>
            )}
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
