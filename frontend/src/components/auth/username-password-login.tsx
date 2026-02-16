"use client";

import { useState } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreditCard, Loader2 } from "lucide-react";
import { RegisterPage } from "./register-page";

export function UsernamePasswordLogin() {
  const { login, registrationEnabled } = useAppStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showRegister, setShowRegister] = useState(false);

  if (showRegister) {
    return <RegisterPage onBack={() => setShowRegister(false)} />;
  }

  const handleLogin = async () => {
    setSubmitting(true);
    try {
      setError("");
      await login({ username, password });
    } catch {
      setError("Invalid credentials");
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
            <h1 className="text-2xl font-bold tracking-tight">CreditCardTracker</h1>
            <p className="text-sm text-muted-foreground">Sign in to your account</p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-11"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full h-11 font-medium" disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Signing in...</> : "Sign In"}
            </Button>
          </form>

          {registrationEnabled && (
            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <button
                onClick={() => setShowRegister(true)}
                className="text-primary hover:underline font-medium"
              >
                Register
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
