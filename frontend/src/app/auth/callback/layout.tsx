import type { Metadata } from "next";

// page.tsx is a client component and cannot export metadata itself, so this
// passthrough layout is the only place to name the route. Without it the
// callback screen falls back to the root layout's bare "plan.cards".
export const metadata: Metadata = { title: "Signing in" };

export default function OAuthCallbackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
