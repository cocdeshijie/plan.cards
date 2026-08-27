import type { Metadata } from "next";

export const metadata: Metadata = { title: "Card Details" };

export default function CardDetailsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
