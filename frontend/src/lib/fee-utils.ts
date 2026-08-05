import { addMonthsClamped, parseDateStr } from "@/lib/utils";

export type Proximity = "far" | "soon" | "imminent" | "overdue";

export interface NextFeeInfo {
  nextDate: Date;
  proximity: Proximity;
  label: string;
  daysUntil: number;
  /** True when the fee date has passed with no annual_fee_posted event recorded. */
  overdue: boolean;
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
    // Fallback: first renewal is open + 13 months, subsequent +12 months.
    // Use clamped month math so end-of-month dates match the backend.
    const open = parseDateStr(openDate);
    next = addMonthsClamped(open, 13);
    while (next < today) {
      next = addMonthsClamped(next, 12);
    }
  } else {
    return null;
  }

  const daysUntil = Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  let proximity: Proximity;
  let label: string;

  if (daysUntil < 0) {
    // Nothing advances annual_fee_date on a timer — the backend only moves it
    // when a card or event is written. So a fee whose date passed without the
    // user recording an annual_fee_posted event keeps a past date indefinitely,
    // which is the most common state for an untouched card. Without this branch
    // it rendered as a literal "Next fee ~-212 days", in orange.
    const overdueDays = Math.abs(daysUntil);
    proximity = "overdue";
    if (overdueDays === 1) label = "was due yesterday";
    else label = `was due ${overdueDays} days ago`;
    return { nextDate: next, proximity, label, daysUntil, overdue: true };
  }

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

  return { nextDate: next, proximity, label, daysUntil, overdue: false };
}
