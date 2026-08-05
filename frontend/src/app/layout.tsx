import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "plan.cards",
  description: "Track your credit card lifecycle",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runtime config for non-localhost Docker deployments. This MUST be a
            blocking script: it defines window.__ENV, which the API layer reads
            to resolve the backend URL. Deferring it would let the first fetch
            run against the wrong origin. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/__env.js" />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.darkMode==="true"||(!("darkMode"in localStorage)&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ErrorBoundary>
          <AppShell>{children}</AppShell>
        </ErrorBoundary>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
