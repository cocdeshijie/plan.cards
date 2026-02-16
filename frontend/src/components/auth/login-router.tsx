"use client";

import { useAppStore } from "@/hooks/use-app-store";
import { PasswordLogin } from "./password-login";
import { UsernamePasswordLogin } from "./username-password-login";
import { OAuthLogin } from "./oauth-login";
import { AutoLogin } from "./auto-login";
import { Loader2 } from "lucide-react";

export function LoginRouter() {
  const authMode = useAppStore((s) => s.authMode);

  if (!authMode) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  switch (authMode) {
    case "open":
      return <AutoLogin />;
    case "single_password":
      return <PasswordLogin />;
    case "multi_user":
      return <UsernamePasswordLogin />;
    case "multi_user_oauth":
      return <OAuthLogin />;
    default:
      return <PasswordLogin />;
  }
}
