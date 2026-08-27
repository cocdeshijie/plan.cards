import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cards" };

export default function CardsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
