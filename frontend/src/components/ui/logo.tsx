// alt defaults to "" because every call site sits next to a "plan.cards"
// wordmark — announcing the image too made the home link read "plan.cards
// plan.cards". Pass alt explicitly wherever the logo stands alone.
export function Logo({ className, alt = "" }: { className?: string; alt?: string }) {
  return (
    <img src="/logo.png" alt={alt} className={className} draggable={false} />
  );
}
