"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import type { BenefitSummaryItem } from "@/types";
import { useAppStore } from "@/hooks/use-app-store";
import { getAllBenefits, updateBenefitUsage } from "@/lib/api";
import { toast } from "sonner";
import { frequencyLabel, usagePercentage, usageColor } from "@/lib/benefit-utils";
import { formatCurrency, parseIntStrict } from "@/lib/utils";
import { CardThumbnail } from "@/components/shared/card-thumbnail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Gift, ChevronDown, ChevronRight, Target } from "lucide-react";
import { cn } from "@/lib/utils";

const FREQUENCY_ORDER = ["monthly", "quarterly", "semi_annual", "annual"] as const;

interface CreditsWidgetProps {
  className?: string;
  onCardClick?: (cardId: number) => void;
}

export function CreditsWidget({ className, onCardClick }: CreditsWidgetProps) {
  const { selectedProfileId } = useAppStore();
  const [benefits, setBenefits] = useState<BenefitSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addAmounts, setAddAmounts] = useState<Record<number, string>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem("credits-widget-collapsed");
      if (saved) setCollapsed(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

  const fetchBenefits = useCallback(async () => {
    try {
      const profileId = selectedProfileId !== "all" ? parseInt(selectedProfileId) : undefined;
      const data = await getAllBenefits(profileId);
      setBenefits(data);
    } catch {
      toast.error("Failed to load benefits");
    } finally {
      setLoading(false);
    }
  }, [selectedProfileId]);

  useEffect(() => {
    fetchBenefits();
  }, [fetchBenefits]);

  const groupByFrequency = (items: BenefitSummaryItem[]) => {
    const result: { frequency: string; issuers: { issuer: string; items: BenefitSummaryItem[] }[] }[] = [];
    for (const freq of FREQUENCY_ORDER) {
      const freqBenefits = items.filter((b) => b.frequency === freq);
      if (freqBenefits.length === 0) continue;

      const issuerMap = new Map<string, BenefitSummaryItem[]>();
      for (const b of freqBenefits) {
        const list = issuerMap.get(b.issuer) || [];
        list.push(b);
        issuerMap.set(b.issuer, list);
      }
      const issuers = [...issuerMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([issuer, items]) => ({ issuer, items }));

      result.push({ frequency: freq, issuers });
    }
    return result;
  };

  const { creditGroups, thresholdGroups } = useMemo(() => {
    const creditBenefits = benefits.filter(b => b.benefit_type !== "spend_threshold");
    const thresholdBenefits = benefits.filter(b => b.benefit_type === "spend_threshold");
    return {
      creditGroups: groupByFrequency(creditBenefits),
      thresholdGroups: groupByFrequency(thresholdBenefits),
    };
  }, [benefits]);

  const toggleCollapse = (freq: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(freq)) next.delete(freq);
      else next.add(freq);
      localStorage.setItem("credits-widget-collapsed", JSON.stringify([...next]));
      return next;
    });
  };

  const handleAddUsage = async (benefit: BenefitSummaryItem) => {
    const addVal = parseIntStrict(addAmounts[benefit.id] || "0");
    if (!addVal || addVal <= 0) return;
    const newTotal = benefit.amount_used + addVal;
    try {
      await updateBenefitUsage(benefit.card_id, benefit.id, { amount_used: newTotal });
      setAddAmounts((prev) => ({ ...prev, [benefit.id]: "" }));
      fetchBenefits();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update usage");
    }
  };

  if (loading) {
    return (
      <div className={cn("bg-card rounded-xl border p-5 space-y-4", className)}>
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-purple-500" />
          <h2 className="font-semibold">Credits & Benefits</h2>
        </div>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className={cn("bg-card rounded-xl border p-5 space-y-4", className)}>
      <div className="flex items-center gap-2">
        <Gift className="h-5 w-5 text-purple-500" />
        <h2 className="font-semibold">Credits & Benefits</h2>
        {benefits.length > 0 && (
          <Badge variant="secondary" className="text-xs">{benefits.length}</Badge>
        )}
      </div>

      {creditGroups.length === 0 && thresholdGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active credits to track.</p>
      ) : (
        <div className="space-y-4">
          {creditGroups.map(({ frequency, issuers }) => {
            const isCollapsed = collapsed.has(frequency);
            const freqBenefits = issuers.flatMap((g) => g.items);
            const remaining = freqBenefits.reduce(
              (sum, b) => sum + Math.max(b.benefit_amount - b.amount_used, 0), 0
            );

            return (
              <div key={frequency}>
                {/* Frequency header */}
                <button
                  onClick={() => toggleCollapse(frequency)}
                  className="flex items-center gap-2 w-full text-left py-1 hover:bg-muted/40 rounded-md px-1 -mx-1 transition-colors"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="font-medium text-sm">{frequencyLabel(frequency)} Credits</span>
                  {remaining > 0 && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {formatCurrency(remaining)} remaining
                    </span>
                  )}
                </button>

                {/* Issuer groups */}
                {!isCollapsed && (
                  <div className="mt-2 space-y-3 pl-6">
                    {issuers.map(({ issuer, items }) => (
                      <div key={issuer}>
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">{issuer}</p>
                        <div className="space-y-2">
                          {items.map((benefit) => {
                            const pct = usagePercentage(benefit.amount_used, benefit.benefit_amount);
                            const barColor = usageColor(pct);

                            return (
                              <div key={benefit.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                                {/* Card info + benefit name */}
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => onCardClick?.(benefit.card_id)}
                                    className="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition-opacity"
                                  >
                                    <CardThumbnail
                                      templateId={benefit.template_id}
                                      cardName={benefit.card_name}
                                      cardImage={benefit.card_image}
                                      className="w-10 h-[25px] shrink-0"
                                    />
                                    <div className="min-w-0 text-left">
                                      <p className="text-xs text-muted-foreground truncate">
                                        {benefit.card_name}
                                        {benefit.last_digits && ` ···${benefit.last_digits}`}
                                        {selectedProfileId === "all" && (
                                          <span className="text-muted-foreground/60"> · {benefit.profile_name}</span>
                                        )}
                                      </p>
                                    </div>
                                  </button>
                                  <div className="ml-auto flex items-center gap-2 shrink-0">
                                    <span className="text-sm font-medium">
                                      {benefit.benefit_name}
                                    </span>
                                    <Badge variant="outline" className="text-[10px]">
                                      {formatCurrency(benefit.benefit_amount)}
                                    </Badge>
                                  </div>
                                </div>

                                {/* Progress bar */}
                                <div className="space-y-1">
                                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${barColor}`}
                                      style={{ width: `${Math.min(pct, 100)}%` }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>
                                      ${benefit.amount_used} / ${benefit.benefit_amount}
                                      {pct > 100
                                        ? <span className="ml-1 text-amber-600 dark:text-amber-400 font-medium">(exceeded)</span>
                                        : pct > 0 && <span className="ml-1">({pct}%)</span>}
                                    </span>
                                    {benefit.reset_label && benefit.days_until_reset != null && (
                                      <span>{benefit.reset_label} · {benefit.days_until_reset}d left</span>
                                    )}
                                  </div>
                                </div>

                                {/* Quick add usage */}
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-muted-foreground">+$</span>
                                  <Input
                                    className="h-7 w-20 text-sm"
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={addAmounts[benefit.id] || ""}
                                    onChange={(e) =>
                                      setAddAmounts((prev) => ({ ...prev, [benefit.id]: e.target.value }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleAddUsage(benefit);
                                    }}
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => handleAddUsage(benefit)}
                                  >
                                    Add
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Spend Thresholds section */}
          {thresholdGroups.length > 0 && (
            <>
              <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                <Target className="h-4 w-4 text-blue-500" />
                <span className="font-medium text-sm">Spend Thresholds</span>
                <Badge variant="secondary" className="text-xs">
                  {benefits.filter(b => b.benefit_type === "spend_threshold").length}
                </Badge>
              </div>
              {thresholdGroups.map(({ frequency, issuers }) => {
                const isCollapsed = collapsed.has(`threshold_${frequency}`);
                return (
                  <div key={`threshold_${frequency}`}>
                    <button
                      onClick={() => toggleCollapse(`threshold_${frequency}`)}
                      className="flex items-center gap-2 w-full text-left py-1 hover:bg-muted/40 rounded-md px-1 -mx-1 transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-medium text-sm">{frequencyLabel(frequency)} Thresholds</span>
                    </button>

                    {!isCollapsed && (
                      <div className="mt-2 space-y-3 pl-6">
                        {issuers.map(({ issuer, items }) => (
                          <div key={issuer}>
                            <p className="text-xs font-medium text-muted-foreground mb-1.5">{issuer}</p>
                            <div className="space-y-2">
                              {items.map((benefit) => {
                                const pct = usagePercentage(benefit.amount_used, benefit.benefit_amount);
                                const isUnlocked = pct >= 100;
                                const barColor = isUnlocked ? "bg-green-500" : pct >= 75 ? "bg-blue-500" : pct >= 50 ? "bg-blue-400" : "bg-muted-foreground/30";

                                return (
                                  <div key={benefit.id} className={`rounded-lg border p-3 space-y-2 ${isUnlocked ? "bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-800" : "bg-muted/20"}`}>
                                    <div className="flex items-center gap-3">
                                      <button
                                        onClick={() => onCardClick?.(benefit.card_id)}
                                        className="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition-opacity"
                                      >
                                        <CardThumbnail
                                          templateId={benefit.template_id}
                                          cardName={benefit.card_name}
                                          cardImage={benefit.card_image}
                                          className="w-10 h-[25px] shrink-0"
                                        />
                                        <div className="min-w-0 text-left">
                                          <p className="text-xs text-muted-foreground truncate">
                                            {benefit.card_name}
                                            {benefit.last_digits && ` ···${benefit.last_digits}`}
                                          </p>
                                        </div>
                                      </button>
                                      <div className="ml-auto flex items-center gap-2 shrink-0">
                                        <span className="text-sm font-medium">{benefit.benefit_name}</span>
                                        {isUnlocked && (
                                          <Badge className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800">
                                            Unlocked!
                                          </Badge>
                                        )}
                                      </div>
                                    </div>

                                    <div className="space-y-1">
                                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                                        <div
                                          className={`h-full rounded-full transition-all ${barColor}`}
                                          style={{ width: `${Math.min(pct, 100)}%` }}
                                        />
                                      </div>
                                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                                        <span>
                                          ${benefit.amount_used.toLocaleString()} / ${benefit.benefit_amount.toLocaleString()} spent
                                          {pct > 0 && <span className="ml-1">({pct}%)</span>}
                                        </span>
                                        {benefit.reset_label && benefit.days_until_reset != null && (
                                          <span>{benefit.reset_label} · {benefit.days_until_reset}d left</span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs text-muted-foreground">+$</span>
                                      <Input
                                        className="h-7 w-20 text-sm"
                                        type="number"
                                        min="0"
                                        placeholder="0"
                                        value={addAmounts[benefit.id] || ""}
                                        onChange={(e) =>
                                          setAddAmounts((prev) => ({ ...prev, [benefit.id]: e.target.value }))
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") handleAddUsage(benefit);
                                        }}
                                      />
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => handleAddUsage(benefit)}
                                      >
                                        Add
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
