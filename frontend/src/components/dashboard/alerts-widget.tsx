"use client";

import { useMemo } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { formatDate, formatCurrency } from "@/lib/utils";
import { useToday } from "@/hooks/use-timezone";
import { getNextFeeInfo } from "@/lib/fee-utils";
import { AlertTriangle, Clock } from "lucide-react";

interface Alert {
  type: "spend" | "fee" | "upgrade" | "retention";
  cardName: string;
  date: string;
  daysLeft: number;
  bonusAmount?: number | null;
  bonusType?: string | null;
  spendRequirement?: number | null;
}

export function AlertsWidget() {
  const { cards, selectedProfileId } = useAppStore();
  const now = useToday();

  const alerts = useMemo(() => {
    const result: Alert[] = [];

    const filtered = selectedProfileId === "all"
      ? cards
      : cards.filter((c) => c.profile_id === parseInt(selectedProfileId));

    for (const card of filtered) {
      if (card.status !== "active") continue;

      if (card.spend_reminder_enabled && card.spend_deadline && !card.signup_bonus_earned) {
        const deadline = new Date(card.spend_deadline + "T00:00:00");
        const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 30) {
          result.push({
            type: "spend",
            cardName: card.card_name,
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
          const dl = new Date(bonus.spend_deadline + "T00:00:00");
          const days = Math.ceil((dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (days <= 30) {
            result.push({
              type: bonus.bonus_source === "retention" ? "retention" : "upgrade",
              cardName: card.card_name,
              date: bonus.spend_deadline,
              daysLeft: days,
              bonusAmount: bonus.bonus_amount,
              bonusType: bonus.bonus_type,
              spendRequirement: bonus.spend_requirement,
            });
          }
        }
      }

      const feeInfo = getNextFeeInfo(card.open_date, card.annual_fee, card.status, card.annual_fee_date, now);
      if (feeInfo && feeInfo.daysUntil <= 30) {
        result.push({
          type: "fee",
          cardName: card.card_name,
          date: feeInfo.nextDate.toISOString().split("T")[0],
          daysLeft: feeInfo.daysUntil,
        });
      }
    }

    return result.sort((a, b) => a.daysLeft - b.daysLeft);
  }, [cards, selectedProfileId, now]);

  return (
    <div className="bg-card rounded-xl border p-5 space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-orange-500" />
        <h2 className="font-semibold">Upcoming Alerts</h2>
      </div>

      {alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming alerts. You're all clear!</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert, i) => (
            <div
              key={`${alert.type}-${alert.cardName}-${i}`}
              className="flex items-center gap-3 text-sm"
            >
              <div
                className={`w-2 h-2 rounded-full shrink-0 ${
                  alert.daysLeft < 0 ? "bg-red-500" : alert.daysLeft <= 7 ? "bg-orange-500" : "bg-yellow-500"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {alert.cardName}
                  <span className="text-muted-foreground font-normal ml-1.5">
                    {alert.type === "spend"
                      ? alert.bonusAmount
                        ? `earn ${alert.bonusAmount.toLocaleString()} ${alert.bonusType || "pts"}`
                        : "spend deadline"
                      : alert.type === "upgrade"
                      ? alert.bonusAmount
                        ? `upgrade: ${alert.bonusAmount.toLocaleString()} ${alert.bonusType || "pts"}`
                        : "upgrade bonus"
                      : alert.type === "retention"
                      ? alert.bonusAmount
                        ? `retention: ${alert.bonusAmount.toLocaleString()} ${alert.bonusType || "pts"}`
                        : "retention bonus"
                      : "annual fee"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(alert.date)}
                  {" \u2014 "}
                  {alert.daysLeft < 0
                    ? <span className="text-red-500 font-medium">{Math.abs(alert.daysLeft)}d overdue</span>
                    : alert.daysLeft === 0
                    ? <span className="text-orange-500 font-medium">Today</span>
                    : `${alert.daysLeft}d left`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
