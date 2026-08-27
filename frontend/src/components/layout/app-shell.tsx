"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAppStore } from "@/hooks/use-app-store";
import { TopNav } from "./top-nav";
import { MobileTopBar } from "./mobile-top-bar";
import { BottomTabs } from "./bottom-tabs";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { AppFooter } from "@/components/ui/app-footer";

/**
 * Boot, auth-check and pre-redirect all used to render a bare centred spinner:
 * nothing announced to a screen reader, and nothing at all to read for anyone
 * staring at a slow first paint. Each state now says which one it is inside a
 * live region.
 */
function FullPageStatus({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center min-h-screen gap-3"
    >
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    setupComplete,
    authed,
    authLoading,
    dataLoading,
    dataError,
    checkSetup,
    fetchAuthMode,
    checkAuth,
    loadData,
    refresh,
  } = useAppStore();
  const pathname = usePathname();
  const router = useRouter();
  const lastRefreshRef = useRef(Date.now());
  const bootRef = useRef(false);
  // True once data has rendered successfully at least once this session. It
  // is what separates a cold-load failure (worth a full-screen takeover) from
  // a background refresh that failed (worth a toast) — see the effect below.
  const loadedOnceRef = useRef(false);

  // Boot sequence: setup status -> auth mode -> check auth
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    (async () => {
      await checkSetup();
    })();
  }, [checkSetup]);

  // Once we know setup is complete, fetch auth mode and check auth
  useEffect(() => {
    if (setupComplete === true) {
      // The .catch is load-bearing: authLoading is only cleared at the end of
      // checkAuth(), so anything that throws on the way there (a browser
      // configured to block site data makes merely touching localStorage
      // throw) left the app on the full-screen spinner forever with no way
      // out. Failing closed lands the visitor on the landing page instead.
      fetchAuthMode()
        .then(() => checkAuth())
        .catch(() => useAppStore.setState({ authLoading: false }));
    }
  }, [setupComplete, fetchAuthMode, checkAuth]);

  // Load data once authenticated
  useEffect(() => {
    if (authed) {
      loadData();
      lastRefreshRef.current = Date.now();
    }
  }, [authed, loadData]);

  // Auto-refresh data when tab becomes visible (debounced to 30s)
  useEffect(() => {
    if (!authed) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefreshRef.current > 30_000) {
        lastRefreshRef.current = Date.now();
        refresh();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [authed, refresh]);

  // Track whether the current session has ever painted real data.
  useEffect(() => {
    if (!authed) {
      loadedOnceRef.current = false;
    } else if (!dataLoading && !dataError) {
      loadedOnceRef.current = true;
    }
  }, [authed, dataLoading, dataError]);

  // A failed *background* refresh must not replace the running app with a
  // full-screen error. That takeover unmounts the nav, the tabs, the page and
  // any dialog the user had open, and offers no way to navigate or log out —
  // for what is usually a momentary blip on tab-focus. Once data has rendered
  // once, report the failure over the last-good screen and leave it standing.
  useEffect(() => {
    if (!dataError || !loadedOnceRef.current) return;
    toast.error(dataError, { id: "data-refresh-failed" });
    useAppStore.setState({ dataError: null });
  }, [dataError]);

  // Handle oauth_linked=1 query param
  useEffect(() => {
    if (authed && typeof window !== "undefined" && window.location.search.includes("oauth_linked=1")) {
      toast.success("OAuth account linked successfully");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [authed]);

  // Send unauthenticated visitors on a protected route back to the landing page.
  // This is an effect, not a render-body call: navigating during render warns
  // ("Cannot update a component while rendering a different component") and
  // re-fires on every re-render until the navigation commits. It must exist —
  // without it, logging out while on /cards (or a session expiring, or a direct
  // deep link) leaves the user on a spinner with no way back.
  //
  // The session-expiry case is already announced: use-app-store's
  // auth:unauthorized listener toasts once with the id "session-expired". Do
  // not add a second toast here — it would double up on every 401.
  useEffect(() => {
    if (authLoading || setupComplete !== true || authed) return;
    if (pathname === "/" || pathname === "/auth/callback") return;
    router.replace("/");
  }, [authLoading, setupComplete, authed, pathname, router]);

  // Loading state
  if (setupComplete === null) {
    return <FullPageStatus label="Starting plan.cards…" />;
  }

  // Onboarding wizard
  if (!setupComplete) {
    return <OnboardingWizard />;
  }

  // Auth loading
  if (authLoading) {
    return <FullPageStatus label="Checking your session…" />;
  }

  // Public pages: landing page and OAuth callback always render their children
  const isPublicPage = pathname === "/" || pathname === "/auth/callback";

  if (!authed) {
    if (isPublicPage) {
      return <>{children}</>;
    }
    // Redirect handled in the effect above: calling router.replace() during
    // render warns ("Cannot update a component while rendering a different
    // component") and re-fires on every re-render until the navigation commits.
    return <FullPageStatus label="Taking you to the sign-in page…" />;
  }

  // Authenticated user on landing page — let them stay (landing page shows "Go
  // to Dashboard" button). Both nav bars point their logo at /summary, so this
  // is only reachable by typing "/" or following an external link.
  if (pathname === "/") {
    return <>{children}</>;
  }

  if (dataError && !loadedOnceRef.current) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4 text-center">
        <AlertTriangle className="h-8 w-8 text-danger" />
        <p className="text-sm text-muted-foreground">{dataError}</p>
        <Button variant="outline" size="sm" onClick={() => { useAppStore.setState({ dataLoading: true, dataError: null }); loadData(); }}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    // The extra 60px at md and up keeps the desktop page taller than the viewport
    // so the sticky header never gains and loses its scrollbar as routes
    // change. Mobile used to ask for 200vh for the same reason, which bought a
    // whole blank screen of dead scroll under every page — and the footer that
    // was meant to fill it is `hidden md:block`.
    <div className="flex flex-col min-h-screen md:min-h-[calc(100vh+60px)]">
      <MobileTopBar />
      <TopNav />
      <main className="flex-1 container mx-auto px-4 py-6 pb-20 md:pb-6 animate-fade-in">
        {children}
      </main>
      <div className="hidden md:block">
        <AppFooter />
      </div>
      <BottomTabs />
    </div>
  );
}
