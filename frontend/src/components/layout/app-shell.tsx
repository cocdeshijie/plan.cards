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

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    setupComplete,
    authed,
    authLoading,
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
      fetchAuthMode().then(() => checkAuth());
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

  // Handle oauth_linked=1 query param
  useEffect(() => {
    if (authed && typeof window !== "undefined" && window.location.search.includes("oauth_linked=1")) {
      toast.success("OAuth account linked successfully");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [authed]);

  // Loading state
  if (setupComplete === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Onboarding wizard
  if (!setupComplete) {
    return <OnboardingWizard />;
  }

  // Auth loading
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Public pages: landing page and OAuth callback always render their children
  const isPublicPage = pathname === "/" || pathname === "/auth/callback";

  if (!authed) {
    if (isPublicPage) {
      return <>{children}</>;
    }
    // Redirect protected pages to landing
    router.replace("/");
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Authenticated user on landing page — let them stay (landing page shows "Go to Dashboard" button)
  if (pathname === "/") {
    return <>{children}</>;
  }

  if (dataError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{dataError}</p>
        <Button variant="outline" size="sm" onClick={() => { useAppStore.setState({ dataLoading: true, dataError: null }); loadData(); }}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <MobileTopBar />
      <TopNav />
      <main className="container mx-auto px-4 py-6 pb-20 md:pb-6 animate-fade-in">
        {children}
      </main>
      <BottomTabs />
    </div>
  );
}
