"use client";

import { useEffect, useState } from "react";
import type { Card } from "@/types";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatCurrency, parseDateStr } from "@/lib/utils";
import { useToday } from "@/hooks/use-timezone";
import { getNextFeeInfo } from "@/lib/fee-utils";
import { getTemplateImageUrl, getTemplateImageVariantUrl, PLACEHOLDER_IMAGE_URL } from "@/lib/api";
import { useColorExtraction } from "@/hooks/use-color-extraction";
import { Clock, CalendarClock } from "lucide-react";

interface CardShowcaseTileProps {
  card: Card;
  onClick: () => void;
  profileName?: string;
}

export function CardShowcaseTile({ card, onClick, profileName }: CardShowcaseTileProps) {
  const [imgError, setImgError] = useState(false);
  const today = useToday();

  useEffect(() => {
    setImgError(false);
  }, [card.template_id, card.card_image, card.id]);

  const imageUrl = card.template_id
    ? (card.card_image
      ? getTemplateImageVariantUrl(card.template_id, card.card_image)
      : getTemplateImageUrl(card.template_id))
    : null;
  const accentColor = useColorExtraction(imgError ? null : imageUrl);

  const daysUntilDeadline = () => {
    if (!card.spend_deadline) return null;
    const deadline = parseDateStr(card.spend_deadline);
    return Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  const isDeadlinePassed = () => {
    if (!card.spend_reminder_enabled || !card.spend_deadline) return false;
    return today > parseDateStr(card.spend_deadline);
  };

  const isDeadlineApproaching = () => {
    if (!card.spend_reminder_enabled || !card.spend_deadline) return false;
    const days = daysUntilDeadline();
    return days !== null && days <= 30 && days >= 0;
  };

  const hasFallback = accentColor.startsWith("hsl");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="group flex flex-col bg-card rounded-xl border border-border shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none"
      style={!hasFallback ? {
        borderColor: `color-mix(in srgb, ${accentColor} 25%, transparent)`,
        boxShadow: `0 2px 12px color-mix(in srgb, ${accentColor} 10%, transparent)`,
      } : undefined}
    >
      {/* Hero Card Image */}
      <div className="relative aspect-[1.586/1] overflow-hidden bg-muted">
        <img
          src={imgError ? PLACEHOLDER_IMAGE_URL : (imageUrl || PLACEHOLDER_IMAGE_URL)}
          alt={card.card_name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={(e) => {
            const target = e.currentTarget;
            if (!imgError && target.src !== PLACEHOLDER_IMAGE_URL) {
              target.src = PLACEHOLDER_IMAGE_URL;
            } else {
              setImgError(true);
            }
          }}
        />
        <Badge
          variant={card.status === "active" ? "success" : "secondary"}
          className="absolute top-2 right-2 text-[10px]"
        >
          {card.status}
        </Badge>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2 flex-1">
        <div>
          <h3 className="font-semibold text-sm leading-tight truncate">
            {card.card_name}
            {card.last_digits && <span className="text-muted-foreground font-normal"> ••• {card.last_digits}</span>}
          </h3>
          <p className="text-xs text-muted-foreground">
            {card.issuer}
            {profileName && <span className="text-muted-foreground/60"> · {profileName}</span>}
          </p>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {card.network && (
            <Badge variant="outline" className="text-[10px]">{card.network}</Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            {card.card_type === "personal" ? "Personal" : "Business"}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div>
            <span className="text-muted-foreground">Opened</span>
            <p className="font-medium">{formatDate(card.open_date)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Annual Fee</span>
            <p className="font-medium">{formatCurrency(card.annual_fee)}</p>
          </div>
        </div>

        {/* Next Fee */}
        {(() => {
          const nextFeeInfo = getNextFeeInfo(card.open_date, card.annual_fee, card.status, card.annual_fee_date, today);
          if (!nextFeeInfo) return null;
          const colorClass =
            nextFeeInfo.proximity === "imminent"
              ? "text-orange-600 dark:text-orange-400"
              : nextFeeInfo.proximity === "soon"
              ? "text-yellow-600 dark:text-yellow-400"
              : "text-muted-foreground";
          return (
            <div className={`flex items-center gap-1.5 text-xs ${colorClass}`}>
              <CalendarClock className="h-3 w-3 shrink-0" />
              <span>Next fee {nextFeeInfo.label}</span>
            </div>
          );
        })()}

        {/* Spend Reminder */}
        {card.spend_reminder_enabled && card.spend_deadline && !card.signup_bonus_earned && (
          <div className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 ${
            isDeadlinePassed()
              ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
              : isDeadlineApproaching()
              ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300"
              : "bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300"
          }`}>
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {card.signup_bonus_amount
                ? `Earn ${card.signup_bonus_amount.toLocaleString()} ${card.signup_bonus_type || "pts"} — `
                : ""}
              {card.spend_requirement ? `$${card.spend_requirement.toLocaleString()}` : "Spend"} by {formatDate(card.spend_deadline)}
              {(() => {
                const days = daysUntilDeadline();
                if (days === null) return null;
                if (days < 0) return <> ({Math.abs(days)}d overdue)</>;
                return <> ({days}d left)</>;
              })()}
            </span>
          </div>
        )}

        {/* Upgrade/Retention bonus reminders */}
        {card.bonuses?.filter((b) => b.spend_reminder_enabled && !b.bonus_earned && !b.bonus_missed && b.spend_deadline).map((bonus) => {
          const dl = parseDateStr(bonus.spend_deadline!);
          const days = Math.ceil((dl.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          const past = days < 0;
          const approaching = days <= 30 && days >= 0;
          const label = bonus.bonus_source === "retention" ? "Retention" : "Upgrade";
          return (
            <div key={bonus.id} className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 ${
              past
                ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                : approaching
                ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300"
                : "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
            }`}>
              <Clock className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {bonus.bonus_amount
                  ? `${label}: ${bonus.bonus_amount.toLocaleString()} ${bonus.bonus_type || "pts"} — `
                  : `${label} — `}
                {bonus.spend_requirement ? `$${bonus.spend_requirement.toLocaleString()}` : "Spend"} by {formatDate(bonus.spend_deadline)}
                {days < 0 ? <> ({Math.abs(days)}d overdue)</> : <> ({days}d left)</>}
              </span>
            </div>
          );
        })}

      </div>

      {/* Accent bottom bar */}
      {!hasFallback && (
        <div
          className="h-1"
          style={{ background: `linear-gradient(to right, ${accentColor}, transparent)` }}
        />
      )}
    </div>
  );
}
