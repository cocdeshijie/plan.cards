import { parseDateStr } from "@/lib/utils";

export type Proximity = "far" | "soon" | "imminent";

export interface NextFeeInfo {
  nextDate: Date;
  proximity: Proximity;
  label: string;
  daysUntil: number;
}

export function getAnniversaryForYear(openDate: Date, year: number): Date {
  const result = new Date(year, openDate.getMonth(), openDate.getDate());
  // Handle month rollover (e.g., Feb 29 -> Mar 1 in non-leap year)
  if (result.getMonth() !== openDate.getMonth()) {
    return new Date(year, openDate.getMonth() + 1, 0); // last day of intended month
  }
  return result;
}

export function getNextFeeInfo(
  openDate: string | null | undefined,
  annualFee: number | null | undefined,
  status: string,
  annualFeeDate?: string | null,
  today?: Date,
): NextFeeInfo | null {
  if (!annualFee || annualFee <= 0 || status === "closed") {
    return null;
  }

  if (!today) today = new Date();

  let next: Date;
  if (annualFeeDate) {
    // Prefer backend-computed annual_fee_date
    next = parseDateStr(annualFeeDate);
  } else if (openDate) {
    // Fallback: first renewal is open + 13 months, subsequent +12 months
    const open = parseDateStr(openDate);
    const firstRenewal = new Date(open);
    firstRenewal.setMonth(firstRenewal.getMonth() + 13);
    next = new Date(firstRenewal);
    while (next < today) {
      next.setFullYear(next.getFullYear() + 1);
    }
  } else {
    return null;
  }

  const daysUntil = Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  let proximity: Proximity;
  let label: string;

  if (daysUntil <= 14) {
    proximity = "imminent";
    if (daysUntil === 0) label = "around now";
    else if (daysUntil === 1) label = "~tomorrow";
    else label = `~${daysUntil} days`;
  } else if (daysUntil <= 90) {
    proximity = "soon";
    const weeks = Math.round(daysUntil / 7);
    label = `~${weeks} week${weeks !== 1 ? "s" : ""}`;
  } else {
    proximity = "far";
    const months = Math.round(daysUntil / 30);
    label = `~${months} month${months !== 1 ? "s" : ""}`;
  }

  return { nextDate: next, proximity, label, daysUntil };
}
