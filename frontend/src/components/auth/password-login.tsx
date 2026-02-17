"use client";

import { useState } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreditCard, Loader2 } from "lucide-react";

export function PasswordLogin() {
  const login = useAppStore((s) => s.login);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    setSubmitting(true);
    try {
      setError("");
      await login({ password });
      setPassword("");
    } catch {
      setError("Invalid password");
      setPassword("");
    } finally {
      setSubmitting(false);
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
            <h1 className="text-2xl font-bold tracking-tight">plan.cards</h1>
            <p className="text-sm text-muted-foreground">Enter your password to continue</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
            className="space-y-4"
          >
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="h-11"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full h-11 font-medium" disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Logging in...</> : "Login"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
