"use client";

import { useEffect, useState } from "react";
import type { Card } from "@/types";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatCurrency, parseDateStr } from "@/lib/utils";
import { maskLastDigits } from "@/lib/card-number";
import { useToday } from "@/hooks/use-timezone";
import { getNextFeeInfo } from "@/lib/fee-utils";
import { getTemplateImageUrl, getTemplateImageVariantUrl, PLACEHOLDER_IMAGE_URL } from "@/lib/api";
import { useColorExtraction } from "@/hooks/use-color-extraction";
import { Clock, CalendarClock, Lock } from "lucide-react";

interface CardShowcaseTileProps {
  card: Card;
  onClick: () => void;
  profileName?: string;
  /**
   * Whether stored card details exist for this card. `undefined` means not
   * known yet (still loading, or the request failed) — the indicator is hidden
   * rather than claiming "none stored", which would be a confident lie.
   */
  hasDetails?: boolean;
}

/** Status and card type are stored lowercase ("active", "personal") but every
 *  other surface — the filter dropdown two rows up included — capitalises. */
function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Bonus types that are dollars rather than a point count. A retention offer
 *  stored as amount 500 / type "credit" rendered as "500 credit". Mirrors the
 *  table in card-detail-content.tsx, which formats the same values one screen
 *  away; keep the two in step. */
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

function formatBonusValue(amount: number | null | undefined, type: string | null | undefined): string {
  const label = (type || "points").trim();
  if (amount == null) return label;
  return MONEY_BONUS_TYPES.has(label.toLowerCase())
    ? `${formatCurrency(amount)} ${label}`
    : `${amount.toLocaleString()} ${label}`;
}

export function CardShowcaseTile({ card, onClick, profileName, hasDetails }: CardShowcaseTileProps) {
  // Two flags rather than one, and `src` is never mutated: API_BASE is "" on the
  // default same-origin deployment, so PLACEHOLDER_IMAGE_URL is a relative path
  // while `img.src` reads back absolute. The old
  // `target.src !== PLACEHOLDER_IMAGE_URL` guard was therefore always true, so a
  // placeholder that itself fails re-requested forever on every visible tile and
  // the give-up branch never ran.
  const [usePlaceholder, setUsePlaceholder] = useState(false);
  const [imgError, setImgError] = useState(false);
  const today = useToday();

  useEffect(() => {
    setUsePlaceholder(false);
    setImgError(false);
  }, [card.template_id, card.card_image, card.id]);

  const imageUrl = card.template_id
    ? (card.card_image
      ? getTemplateImageVariantUrl(card.template_id, card.card_image)
      : getTemplateImageUrl(card.template_id))
    : null;
  const accentColor = useColorExtraction(imgError ? null : imageUrl);
  const displaySrc = imgError || usePlaceholder || !imageUrl ? PLACEHOLDER_IMAGE_URL : imageUrl;

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
  const digits = maskLastDigits(card.last_digits);

  return (
    // Not role="button": that swallowed the <h3> (no heading in the outline) and
    // made the accessible name the tile's entire text, sr-only string included.
    // The heading now holds a real button — clicks anywhere still open the card
    // because the button's own click bubbles to this handler, and Enter/Space on
    // it do the same natively.
    <div
      onClick={onClick}
      className="group relative flex flex-col bg-card rounded-xl border border-border shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background"
      style={!hasFallback ? {
        borderColor: `color-mix(in srgb, ${accentColor} 25%, transparent)`,
        boxShadow: `0 2px 12px color-mix(in srgb, ${accentColor} 10%, transparent)`,
      } : undefined}
    >
      {/* Hero Card Image */}
      <div className="relative aspect-[1.586/1] overflow-hidden bg-muted">
        {/* crossOrigin matches useColorExtraction's own `new Image()`: without
            it the two requests are separate cache entries and a 40-card grid
            fetched 80 images. lazy/async keep the off-screen rows cheap. */}
        <img
          src={displaySrc}
          alt={card.card_name}
          loading="lazy"
          decoding="async"
          crossOrigin="anonymous"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={() => {
            if (!usePlaceholder && displaySrc !== PLACEHOLDER_IMAGE_URL) {
              setUsePlaceholder(true);
            } else {
              setImgError(true);
            }
          }}
        />
        <Badge
          variant={card.status === "active" ? "success" : "secondary"}
          className="absolute top-2 right-2 text-[10px]"
        >
          {titleCase(card.status)}
        </Badge>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2 flex-1">
        <div>
          {/* The digits sit outside the truncating span: they are the only thing
              telling a P1 Gold from a P2 Gold, and they were the first thing the
              ellipsis ate. */}
          <h3 className="font-semibold text-sm leading-tight">
            <button
              type="button"
              className="flex w-full items-baseline gap-1 text-left focus-visible:outline-none"
            >
              <span className="truncate min-w-0" title={card.card_name}>{card.card_name}</span>
              {digits && (
                <span className="shrink-0 text-muted-foreground font-normal">{digits}</span>
              )}
            </button>
          </h3>
          <p className="text-xs text-muted-foreground truncate" title={profileName ? `${card.issuer} · ${profileName}` : card.issuer}>
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
          {/* A fixed slot with two states rather than an icon that only appears
              when set — absence alone would be ambiguous between "nothing
              stored" and "this build has no such feature". */}
          {hasDetails !== undefined && (
            <span
              className={`ml-auto self-center ${hasDetails ? "text-muted-foreground" : "text-muted-foreground/25"}`}
              title={hasDetails ? "Card details stored" : "No card details stored"}
            >
              <Lock className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">
                {hasDetails ? "Card details stored" : "No card details stored"}
              </span>
            </span>
          )}
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
            nextFeeInfo.proximity === "overdue"
              ? "text-red-600 dark:text-red-400"
              : nextFeeInfo.proximity === "imminent"
              ? "text-orange-600 dark:text-orange-400"
              : nextFeeInfo.proximity === "soon"
              ? "text-yellow-600 dark:text-yellow-400"
              : "text-muted-foreground";
          return (
            <div className={`flex items-center gap-1.5 text-xs ${colorClass}`}>
              <CalendarClock className="h-3 w-3 shrink-0" />
              <span>{nextFeeInfo.overdue ? `Fee ${nextFeeInfo.label}` : `Next fee ${nextFeeInfo.label}`}</span>
            </div>
          );
        })()}

        {/* Spend Reminder */}
        {card.spend_reminder_enabled && card.spend_deadline && !card.signup_bonus_earned && (() => {
          const days = daysUntilDeadline();
          // The countdown is the whole point of the chip, so it never truncates:
          // the description shrinks and the days stay pinned to the right.
          const countdown =
            days === null ? null : days < 0 ? `(${Math.abs(days)}d overdue)` : `(${days}d left)`;
          const description = `${
            card.signup_bonus_amount
              ? `Earn ${formatBonusValue(card.signup_bonus_amount, card.signup_bonus_type)} — `
              : ""
          }${
            card.spend_requirement ? formatCurrency(card.spend_requirement) : "Spend"
          } by ${formatDate(card.spend_deadline)}`;
          return (
            <div className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 ${
              isDeadlinePassed()
                ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                : isDeadlineApproaching()
                ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300"
                : "bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300"
            }`}>
              <Clock className="h-3 w-3 shrink-0" />
              <span className="truncate min-w-0" title={countdown ? `${description} ${countdown}` : description}>
                {description}
              </span>
              {countdown && <span className="shrink-0 tabular-nums">{countdown}</span>}
            </div>
          );
        })()}

        {/* Upgrade/Retention bonus reminders */}
        {card.bonuses?.filter((b) => b.spend_reminder_enabled && !b.bonus_earned && !b.bonus_missed && b.spend_deadline).map((bonus) => {
          const dl = parseDateStr(bonus.spend_deadline!);
          const days = Math.ceil((dl.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          const past = days < 0;
          const approaching = days <= 30 && days >= 0;
          const label = bonus.bonus_source === "retention" ? "Retention" : "Upgrade";
          const countdown = past ? `(${Math.abs(days)}d overdue)` : `(${days}d left)`;
          const description = `${
            bonus.bonus_amount
              ? `${label}: ${formatBonusValue(bonus.bonus_amount, bonus.bonus_type)}${
                  bonus.bonus_credit_amount != null
                    ? ` + ${formatCurrency(bonus.bonus_credit_amount)} credit`
                    : ""
                } — `
              : `${label} — `
          }${
            bonus.spend_requirement ? formatCurrency(bonus.spend_requirement) : "Spend"
          } by ${formatDate(bonus.spend_deadline)}`;
          return (
            <div key={bonus.id} className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 ${
              past
                ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                : approaching
                ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300"
                : "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
            }`}>
              <Clock className="h-3 w-3 shrink-0" />
              <span className="truncate min-w-0" title={`${description} ${countdown}`}>
                {description}
              </span>
              <span className="shrink-0 tabular-nums">{countdown}</span>
            </div>
          );
        })}

      </div>

      {/* Accent bottom bar — always occupies its 4px so the tile doesn't grow
          (and the grid row re-flow) the moment colour extraction resolves. */}
      <div
        className="h-1 shrink-0"
        style={!hasFallback ? { background: `linear-gradient(to right, ${accentColor}, transparent)` } : undefined}
      />
    </div>
  );
}
