export function frequencyLabel(frequency: string): string {
  switch (frequency) {
    case "monthly": return "Monthly";
    case "quarterly": return "Quarterly";
    case "semi_annual": return "Semi-Annual";
    case "annual": return "Annual";
    default: return frequency;
  }
}

export function frequencyShort(frequency: string): string {
  switch (frequency) {
    case "monthly": return "/mo";
    case "quarterly": return "/qtr";
    case "semi_annual": return "/6mo";
    case "annual": return "/yr";
    default: return "";
  }
}

export function resetTypeLabel(resetType: string): string {
  switch (resetType) {
    case "calendar": return "Calendar";
    case "cardiversary": return "Cardiversary";
    default: return resetType;
  }
}

/**
 * Usage as a percentage, never rounded across a threshold that means something.
 *
 * Rounding reported 100 for $14,930 of a $15,000 spend threshold — which flips
 * `isUnlocked`, paints the bar green and leaves the "Mark fully used" button
 * enabled next to a "(100%)" label. At the other end $1 of $1,000 rounded to 0
 * and coloured the bar untouched-grey. So: 100 only when the benefit really is
 * exhausted, anything above that ceiled so a single dollar of overage still
 * reads as over-use, and a partial usage floored but never all the way to 0.
 */
export function usagePercentage(used: number, total: number): number {
  if (total <= 0) return 0;
  const raw = (used / total) * 100;
  if (used >= total) return Math.ceil(raw); // >= 100 by construction
  if (used <= 0) return 0;
  return Math.min(99, Math.max(1, Math.floor(raw)));
}

export function usageColor(percentage: number): string {
  if (percentage > 100) return "bg-amber-500";
  if (percentage >= 100) return "bg-green-500";
  if (percentage >= 75) return "bg-blue-500";
  if (percentage >= 50) return "bg-yellow-500";
  if (percentage >= 25) return "bg-orange-500";
  return "bg-muted-foreground/30";
}
