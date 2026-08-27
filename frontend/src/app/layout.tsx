import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  // Template so per-segment layouts can name themselves without repeating the
  // product name; every route used to share the bare "plan.cards" title.
  title: {
    default: "plan.cards",
    template: "%s · plan.cards",
  },
  description: "Track your credit card lifecycle",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately no maximumScale / userScalable: pinch-zoom must stay available.
  // Deliberately no viewportFit: "cover" either — nothing in the app reads
  // env(safe-area-inset-*), so opting into the full display would drop the fixed
  // bottom tab bar under the home indicator and push content under the notch in
  // landscape. Add the insets first if this ever changes.
  // Hex rather than hsl(): theme-color is parsed by the browser chrome, and hex
  // is the one notation every implementation accepts. Keyed to --background in
  // globals.css (40 20% 99% / 24 10% 6%).
  // These two are only the no-JS default. The app's real theme is a manual
  // `.dark` class, not prefers-color-scheme, so the boot script below rewrites
  // the `content` of BOTH of these metas to the resolved color and keeps them
  // in sync with the class. Without that, a user who overrides the OS
  // preference in-app gets browser chrome in the opposite theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfdfc" },
    { media: "(prefers-color-scheme: dark)", color: "#110f0e" },
  ],
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
        {/* Seeds the `.dark` class before first paint, then points the
            theme-color metas at the class rather than at the OS preference.
            Next emits both <meta name="theme-color" media="..."> tags ahead of
            this script, so they are already in the DOM: writing the resolved
            color into BOTH means whichever one the browser matches carries the
            right value. The class observer keeps it that way when use-app-store
            toggles the theme; the head observer re-applies it if React's
            hoisted metadata re-renders the metas back to their SSR content.
            Neither observer loops: setAttribute on an existing meta is not a
            childList mutation and the metas are not on <html>. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.documentElement;try{if(localStorage.darkMode==="true"||(!("darkMode"in localStorage)&&matchMedia("(prefers-color-scheme:dark)").matches))d.classList.add("dark")}catch(e){}function s(){var c=d.classList.contains("dark")?"#110f0e":"#fdfdfc",m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",c)}try{s();new MutationObserver(s).observe(d,{attributes:true,attributeFilter:["class"]});new MutationObserver(s).observe(document.head,{childList:true})}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ErrorBoundary>
          <AppShell>{children}</AppShell>
        </ErrorBoundary>
        {/* Wrapper, not sonner's Toaster directly: it syncs the toast theme to
            the app's `.dark` class and carries the offset that clears the fixed
            bottom tab bar. */}
        <Toaster />
      </body>
    </html>
  );
}
