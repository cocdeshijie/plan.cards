"use client";

import * as React from "react";
import { Toaster as SonnerToaster } from "sonner";

/**
 * sonner's own theme resolution reads `prefers-color-scheme`, but this app's dark
 * mode is a manual `.dark` class on <html> (seeded by the boot script in
 * layout.tsx, toggled by use-app-store). A user who overrides the OS preference
 * would otherwise get toasts in the opposite theme — a white toast on a
 * 6%-lightness page. Track the class instead; it is the one source of truth both
 * writers agree on.
 *
 * Initial state is "light" on both server and client so hydration matches; the
 * effect corrects it before any toast can be triggered.
 */
export function Toaster() {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <SonnerToaster
      richColors
      closeButton
      theme={theme}
      position="bottom-right"
      // Clears the 56px fixed bottom tab bar (bottom-tabs.tsx). sonner only
      // applies mobileOffset below its hardcoded 600px breakpoint; globals.css
      // covers the 600-767px band where the tab bar is still visible.
      mobileOffset={{ bottom: "72px", left: "16px", right: "16px" }}
    />
  );
}
