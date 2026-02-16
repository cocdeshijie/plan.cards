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

export function usagePercentage(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((used / total) * 100);
}

export function usageColor(percentage: number): string {
  if (percentage > 100) return "bg-amber-500";
  if (percentage >= 100) return "bg-green-500";
  if (percentage >= 75) return "bg-blue-500";
  if (percentage >= 50) return "bg-yellow-500";
  if (percentage >= 25) return "bg-orange-500";
  return "bg-muted-foreground/30";
}
