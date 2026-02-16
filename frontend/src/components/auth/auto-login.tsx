"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2, RefreshCw } from "lucide-react";

export function AutoLogin() {
  const login = useAppStore((s) => s.login);
  const [error, setError] = useState("");

  const attempt = () => {
    setError("");
    login({}).catch(() => setError("Auto-login failed. The server may be unreachable."));
  };

  useEffect(() => {
    attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-background to-purple-50 dark:from-blue-950/20 dark:via-background dark:to-purple-950/20">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10">
          <CreditCard className="h-8 w-8 text-primary" />
        </div>
        {error ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={attempt}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Signing in...</p>
          </div>
        )}
      </div>
    </div>
  );
}
