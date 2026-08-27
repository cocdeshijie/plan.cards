"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppStore } from "@/hooks/use-app-store";
import { formatDate, formatCurrency, parseDateStr, toDateStr } from "@/lib/utils";
import { maskLastDigits } from "@/lib/card-number";
import { useToday } from "@/hooks/use-timezone";
import { getNextFeeInfo } from "@/lib/fee-utils";
import { getDismissedAlerts, dismissAlertKey, undismissAlertKey } from "@/lib/api";
import { AlertTriangle, X } from "lucide-react";

interface Alert {
  type: "spend" | "fee" | "upgrade" | "retention";
  cardId: number;
  cardName: string;
  lastDigits?: string | null;
  profileName?: string;
  date: string;
  daysLeft: number;
  bonusAmount?: number | null;
  bonusType?: string | null;
  /** A retention offer that is points *and* a statement credit keeps the credit
   *  here; `bonusAmount` holds the points. See routers/events.py. */
  bonusCredit?: number | null;
  spendRequirement?: number | null;
  /** Distinguishes two bonuses on one card that share a spend deadline. */
  bonusId?: number;
}

// Stable per-occurrence key so a dismissed annual fee reappears next year
// (different date) but stays hidden for the current cycle.
//
// bonusId is part of the key because a card can carry two bonuses sharing one
// spend_deadline; without it both rows had an identical key, so dismissing
// either removed both — and the dismissal is persisted server-side, so it
// survived a reload.
function alertKey(alert: Alert): string {
  const suffix = alert.bonusId != null ? `-${alert.bonusId}` : "";
  return `${alert.type}-${alert.cardId}-${alert.date}${suffix}`;
}

/**
 * How far past due a row stays worth surfacing.
 *
 * Neither window had a lower bound, so a fee from last spring sat at the top of
 * an ascending sort, above tomorrow's. Past this point the fee was paid, the
 * bonus was missed, or the card is gone.
 */
const OVERDUE_FLOOR_DAYS = -60;

/** Bonus types that are dollars rather than a point count — a retention offer
 *  stored as amount 500 / type "credit" was rendering as "500 credit".
 *  Mirrors MONEY_BONUS_TYPES in card-detail/card-detail-content.tsx. */
const MONEY_BONUS_TYPES = new Set([
  "credit",
  "credits",
  "statement credit",
  "cashback",
  "cash back",
  "cash",
  "dollars",
  "usd",
]);

const TYPE_LABEL: Record<Alert["type"], string> = {
  spend: "spend deadline",
  fee: "annual fee",
  upgrade: "upgrade bonus",
  retention: "retention bonus",
};

function formatBonusValue(amount: number, type: string | null | undefined): string {
  const label = (type || "pts").trim();
  return MONEY_BONUS_TYPES.has(label.toLowerCase())
    ? `${formatCurrency(amount)} ${label}`
    : `${amount.toLocaleString()} ${label}`;
}

/** The trailing "earn 60,000 pts" / "annual fee" phrase on a row. */
function alertDetail(alert: Alert): string {
  const value = alert.bonusAmount
    ? formatBonusValue(alert.bonusAmount, alert.bonusType) +
      (alert.bonusCredit ? ` + ${formatCurrency(alert.bonusCredit)} credit` : "")
    : null;
  switch (alert.type) {
    case "spend":
      return value ? `earn ${value}` : "spend deadline";
    case "upgrade":
      return value ? `upgrade: ${value}` : "upgrade bonus";
    case "retention":
      return value ? `retention: ${value}` : "retention bonus";
    default:
      return "annual fee";
  }
}

interface AlertsWidgetProps {
  onCardClick?: (cardId: number) => void;
}

export function AlertsWidget({ onCardClick }: AlertsWidgetProps) {
  const { cards, profiles, selectedProfileId } = useAppStore();
  const now = useToday();

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  /** The alert list is derived synchronously from the store, but the dismissal
   *  set is not — rendering before it lands drew every dismissed row and then
   *  yanked it away, shoving the widget below up. */
  const [dismissLoaded, setDismissLoaded] = useState(false);
  const [dismissFailed, setDismissFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getDismissedAlerts()
      .then((keys) => {
        if (!active) return;
        setDismissed(new Set(keys));
        setDismissLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        // Showing everything is the safe failure, but doing it silently reads
        // as "you never dismissed these".
        setDismissFailed(true);
        setDismissLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const restoreAlert = (key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    undismissAlertKey(key).catch(() => {
      setDismissed((prev) => new Set(prev).add(key));
      toast.error("Failed to restore alert");
    });
  };

  const dismissAlert = (alert: Alert) => {
    const key = alertKey(alert);
    // Optimistic update; revert on failure.
    setDismissed((prev) => new Set(prev).add(key));
    dismissAlertKey(key)
      .then(() => {
        // The dismissal is persisted, so without this one mis-tap hid an annual
        // fee reminder for the whole cycle with no way back.
        toast(`Dismissed ${TYPE_LABEL[alert.type]} for ${alert.cardName}`, {
          action: {
            label: "Undo",
            onClick: () => restoreAlert(key),
          },
          duration: 10000,
        });
      })
      .catch(() => {
        setDismissed((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        toast.error("Failed to dismiss alert");
      });
  };

  const profileMap = useMemo(() => {
    const map: Record<number, string> = {};
    for (const p of profiles) map[p.id] = p.name;
    return map;
  }, [profiles]);

  const { overdue, upcoming } = useMemo(() => {
    const result: Alert[] = [];

    const filtered = selectedProfileId === "all"
      ? cards
      : cards.filter((c) => c.profile_id === parseInt(selectedProfileId));

    for (const card of filtered) {
      if (card.status !== "active") continue;

      const profileName = profileMap[card.profile_id];

      if (card.spend_reminder_enabled && card.spend_deadline && !card.signup_bonus_earned) {
        const deadline = parseDateStr(card.spend_deadline);
        const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 30) {
          result.push({
            type: "spend",
            cardId: card.id,
            cardName: card.card_name,
            lastDigits: card.last_digits,
            profileName,
            date: card.spend_deadline,
            daysLeft,
            bonusAmount: card.signup_bonus_amount,
            bonusType: card.signup_bonus_type,
            spendRequirement: card.spend_requirement,
          });
        }
      }

      // Upgrade/Retention bonus alerts
      for (const bonus of (card.bonuses || [])) {
        if (bonus.spend_reminder_enabled && bonus.spend_deadline && !bonus.bonus_earned && !bonus.bonus_missed) {
          const dl = parseDateStr(bonus.spend_deadline);
          const days = Math.ceil((dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (days <= 30) {
            result.push({
              type: bonus.bonus_source === "retention" ? "retention" : "upgrade",
              cardId: card.id,
              cardName: card.card_name,
              lastDigits: card.last_digits,
              profileName,
              date: bonus.spend_deadline,
              daysLeft: days,
              bonusAmount: bonus.bonus_amount,
              bonusType: bonus.bonus_type,
              bonusCredit: bonus.bonus_credit_amount,
              spendRequirement: bonus.spend_requirement,
              bonusId: bonus.id,
            });
          }
        }
      }

      const feeInfo = getNextFeeInfo(card.open_date, card.annual_fee, card.status, card.annual_fee_date, now);
      if (feeInfo && feeInfo.daysUntil <= 30) {
        result.push({
          type: "fee",
          cardId: card.id,
          cardName: card.card_name,
          lastDigits: card.last_digits,
          profileName,
          date: toDateStr(feeInfo.nextDate),
          daysLeft: feeInfo.daysUntil,
        });
      }
    }

    const visible = result.filter(
      (a) => !dismissed.has(alertKey(a)) && a.daysLeft >= OVERDUE_FLOOR_DAYS,
    );

    return {
      // Overdue first, but most recently due first inside it: a fee that posted
      // three days ago is still actionable, one from seven weeks ago is not.
      overdue: visible.filter((a) => a.daysLeft < 0).sort((a, b) => b.daysLeft - a.daysLeft),
      upcoming: visible.filter((a) => a.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft),
    };
  }, [cards, profileMap, selectedProfileId, now, dismissed]);

  // Only worth labelling the groups once something is actually overdue;
  // otherwise the heading is chrome over a single list.
  const showGroupHeadings = overdue.length > 0;
  const groups = [
    { key: "overdue", label: "Overdue", items: overdue },
    { key: "upcoming", label: "Upcoming", items: upcoming },
  ].filter((g) => g.items.length > 0);

  const renderRow = (alert: Alert, i: number) => {
    const mask = maskLastDigits(alert.lastDigits);
    const detail = alertDetail(alert);
    const nameLabel = `${alert.profileName ? `${alert.profileName} • ` : ""}${alert.cardName}${mask ? ` ${mask}` : ""}`;

    return (
      <div
        key={`${alertKey(alert)}-${i}`}
        className="group flex items-center gap-3 text-sm"
      >
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            alert.daysLeft < 0 ? "bg-red-500" : alert.daysLeft <= 7 ? "bg-orange-500" : "bg-yellow-500"
          }`}
        />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate" title={`${nameLabel} — ${detail}`}>
            <button
              onClick={() => onCardClick?.(alert.cardId)}
              className="hover:underline hover:text-primary transition-colors text-left"
            >
              {alert.profileName && <span className="text-muted-foreground font-normal">{alert.profileName} &bull; </span>}{alert.cardName}{mask && <span className="text-muted-foreground font-normal"> {mask}</span>}
            </button>
            <span className="text-muted-foreground font-normal ml-1.5">{detail}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(alert.date)}
            {" — "}
            {alert.daysLeft < 0
              ? <span className="text-red-600 dark:text-red-400 font-medium">{Math.abs(alert.daysLeft)}d overdue</span>
              : alert.daysLeft === 0
              ? <span className="text-orange-600 dark:text-orange-400 font-medium">Today</span>
              : `${alert.daysLeft}d left`}
          </p>
        </div>
        <button
          onClick={() => dismissAlert(alert)}
          aria-label={`Dismiss ${TYPE_LABEL[alert.type]} alert for ${alert.cardName}`}
          title="Dismiss alert"
          className="shrink-0 inline-flex items-center justify-center rounded-md p-1 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 text-muted-foreground opacity-60 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus:opacity-100 hover:bg-muted hover:text-foreground transition-opacity"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <div className="bg-card rounded-xl border p-5 space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-orange-500" />
        <h2 className="font-semibold">Upcoming Alerts</h2>
      </div>

      {dismissFailed && (
        <p className="text-xs text-danger">
          Couldn&apos;t check which alerts you dismissed — some may have reappeared.
        </p>
      )}

      {!dismissLoaded ? (
        <div className="space-y-2" role="status" aria-label="Loading alerts">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-muted animate-pulse shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
                <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming alerts. You&apos;re all clear!</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.key} className="space-y-2">
              {showGroupHeadings && (
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
              )}
              {group.items.map(renderRow)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
