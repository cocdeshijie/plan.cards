export function Logo({ className }: { className?: string }) {
  return (
    <img src="/logo.png" alt="plan.cards" className={className} draggable={false} />
  );
}
