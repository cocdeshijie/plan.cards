"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import type { BenefitSummaryItem, CardSecretMasked } from "@/types";
import { useAppStore } from "@/hooks/use-app-store";
import { hydrateAutoHidePreference, useCardVault } from "@/hooks/use-card-vault";
import {
  getAllBenefits,
  updateBenefitUsage,
  updateCardBenefit,
  deleteCardBenefit,
  getCardSecrets,
} from "@/lib/api";
import { toast } from "sonner";
import { frequencyLabel, usagePercentage, usageColor } from "@/lib/benefit-utils";
import { formatCurrency, parseIntStrict } from "@/lib/utils";
import { CardThumbnail } from "@/components/shared/card-thumbnail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardSecretDialog } from "@/components/card-details/card-secret-dialog";
import { VaultPanel, VaultTrigger, type PanelState } from "./benefit-card-vault";
import { Gift, ChevronDown, ChevronRight, Target, Pencil, Trash2, X, Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

const FREQUENCY_ORDER = ["monthly", "quarterly", "semi_annual", "annual"] as const;

interface CreditsWidgetProps {
  className?: string;
  onCardClick?: (cardId: number) => void;
}

export function CreditsWidget({ className, onCardClick }: CreditsWidgetProps) {
  const { selectedProfileId, cards, authMode } = useAppStore();
  const { revealed, expiresAt, reveal, hide, checkExpiry } = useCardVault();
  const [benefits, setBenefits] = useState<BenefitSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addAmounts, setAddAmounts] = useState<Record<number, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editFrequency, setEditFrequency] = useState("");
  const [editResetType, setEditResetType] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingUsageId, setEditingUsageId] = useState<number | null>(null);
  const [editUsageAmount, setEditUsageAmount] = useState("");
  /** null while the vault list is still loading, so the trigger can hold its slot. */
  const [secrets, setSecrets] = useState<CardSecretMasked[] | null>(null);
  /** Which benefit tiles are expanded, keyed by benefit id — never by card id. */
  const [panels, setPanels] = useState<Map<number, PanelState>>(() => new Map());
  const [addDetailsFor, setAddDetailsFor] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

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

  // A card closed or deleted from anywhere else drops out of `list_all_benefits`,
  // which filters to active cards — but this widget only re-fetched on a profile
  // switch, so its credits stayed on screen until a reload. Skip the first run:
  // the effect above already covers mount.
  const cardsSettled = useRef(false);
  useEffect(() => {
    if (!cardsSettled.current) {
      cardsSettled.current = true;
      return;
    }
    fetchBenefits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  const loadSecrets = useCallback(async () => {
    try {
      setSecrets(await getCardSecrets());
    } catch {
      // This widget's job is credits. A vault that won't load means no triggers,
      // not an error the user has to dismiss to read their benefits.
      setSecrets([]);
    }
  }, []);

  useEffect(() => {
    hydrateAutoHidePreference();
    loadSecrets();
  }, [loadSecrets]);

  const groupByFrequency = (items: BenefitSummaryItem[]) => {
    const result: { frequency: string; creditTypes: { benefitName: string; items: BenefitSummaryItem[] }[] }[] = [];
    for (const freq of FREQUENCY_ORDER) {
      const freqBenefits = items.filter((b) => b.frequency === freq);
      if (freqBenefits.length === 0) continue;

      const nameMap = new Map<string, BenefitSummaryItem[]>();
      for (const b of freqBenefits) {
        const list = nameMap.get(b.benefit_name) || [];
        list.push(b);
        nameMap.set(b.benefit_name, list);
      }
      const creditTypes = [...nameMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([benefitName, items]) => ({
          benefitName,
          items: items.sort((a, b) =>
            (a.profile_name || "").localeCompare(b.profile_name || "") ||
            a.card_name.localeCompare(b.card_name)
          ),
        }));

      result.push({ frequency: freq, creditTypes });
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

  const benefitById = useMemo(() => {
    const m = new Map<number, BenefitSummaryItem>();
    for (const b of benefits) m.set(b.id, b);
    return m;
  }, [benefits]);

  const secretByCard = useMemo(() => {
    const m = new Map<number, CardSecretMasked>();
    for (const s of secrets ?? []) m.set(s.card_id, s);
    return m;
  }, [secrets]);

  /** Nothing stored on any card: the feature stays invisible entirely. */
  const vaultInUse = (secrets?.length ?? 0) > 0;

  /** Distinct cards currently shown by a panel in THIS widget. */
  const openCardIds = useMemo(() => {
    const ids = new Set<number>();
    for (const [benefitId, state] of panels) {
      if (state.status !== "ready") continue;
      const b = benefitById.get(benefitId);
      if (b) ids.add(b.card_id);
    }
    return ids;
  }, [panels, benefitById]);

  /**
   * Close panels the widget no longer has any business showing.
   *
   * Plaintext is cleared from outside this component in four ways — the
   * auto-hide timer, "Hide all" on the Card details page, a 401, and saving or
   * deleting in CardSecretDialog. A panel left open past any of those would
   * render against a value that is gone. Only "ready" panels are pruned: a
   * panel showing "no details stored" or an error was never backed by the
   * store in the first place.
   */
  useEffect(() => {
    setPanels((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [benefitId, state] of prev) {
        const benefit = benefitById.get(benefitId);
        // The benefit itself is gone — profile switch, deletion, card closed.
        if (!benefit) {
          next.delete(benefitId);
          changed = true;
          continue;
        }
        if (state.status === "ready" && !revealed[benefit.card_id]) {
          next.delete(benefitId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [revealed, benefitById]);

  // Drives the countdown label only; the store owns expiry and hides itself.
  useEffect(() => {
    if (expiresAt === null || openCardIds.size === 0) return;
    setNow(Date.now());
    const t = setInterval(() => {
      setNow(Date.now());
      checkExpiry();
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, openCardIds.size, checkExpiry]);

  const secondsLeft = expiresAt === null ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const timerLabel = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  const openPanel = (benefit: BenefitSummaryItem) => {
    setPanels((prev) => new Map(prev).set(benefit.id, { status: "loading" }));
    reveal(benefit.card_id)
      .then(() => setPanels((prev) => new Map(prev).set(benefit.id, { status: "ready" })))
      .catch((e) =>
        setPanels((prev) =>
          new Map(prev).set(benefit.id, {
            status: "error",
            message: e instanceof Error ? e.message : "Could not reveal details",
          }),
        ),
      );
  };

  const closePanel = (benefitId: number, refocus = false) => {
    const benefit = benefitById.get(benefitId);
    const next = new Map(panels);
    next.delete(benefitId);
    setPanels(next);
    if (benefit) {
      // Drop the plaintext once nothing in this widget is still showing the
      // card. Another tile on the same card keeps it alive.
      const stillShown = [...next].some(
        ([id, st]) => st.status === "ready" && benefitById.get(id)?.card_id === benefit.card_id,
      );
      if (!stillShown && revealed[benefit.card_id]) hide(benefit.card_id);
    }
    if (refocus) {
      document
        .querySelector<HTMLButtonElement>(`[data-vault-trigger="${benefitId}"]`)
        ?.focus();
    }
  };

  const closeAllPanels = () => {
    setPanels(new Map());
    openCardIds.forEach((cardId) => hide(cardId));
  };

  const togglePanel = (benefit: BenefitSummaryItem) => {
    if (panels.has(benefit.id)) {
      closePanel(benefit.id);
      return;
    }
    if (!secretByCard.has(benefit.card_id)) {
      setPanels((prev) => new Map(prev).set(benefit.id, { status: "empty" }));
      return;
    }
    // Already decrypted by another tile, or by the Card details page.
    if (revealed[benefit.card_id]) {
      setPanels((prev) => new Map(prev).set(benefit.id, { status: "ready" }));
      return;
    }
    openPanel(benefit);
  };

  const renderVaultTrigger = (benefit: BenefitSummaryItem) => {
    // Hold the slot while the vault list is in flight so the amount badge
    // doesn't jump sideways when it lands.
    if (secrets === null) return <span className="h-6 w-6 shrink-0" aria-hidden />;
    if (!vaultInUse) return null;
    const state = panels.get(benefit.id);
    const secret = secretByCard.get(benefit.card_id);
    return (
      <VaultTrigger
        benefitId={benefit.id}
        stored={!!secret}
        open={!!state}
        loading={state?.status === "loading"}
        cardName={benefit.card_name}
        codeLabel={secret?.code_label}
        onClick={() => togglePanel(benefit)}
      />
    );
  };

  const renderVaultPanel = (benefit: BenefitSummaryItem) => {
    const state = panels.get(benefit.id);
    if (!state) return null;
    return (
      <VaultPanel
        state={state}
        secret={secretByCard.get(benefit.card_id) ?? null}
        data={revealed[benefit.card_id]}
        cardName={benefit.card_name}
        authOpen={authMode === "open"}
        onClose={() => closePanel(benefit.id, true)}
        onRetry={() => openPanel(benefit)}
        onAddDetails={() => setAddDetailsFor(benefit.card_id)}
      />
    );
  };

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
    const raw = addAmounts[benefit.id] || "";
    if (!raw.trim()) return;
    const addVal = parseIntStrict(raw);
    // Silent early-return on "12.50" made the Add button look dead. The sibling
    // handleSetUsage already toasts on the same failure.
    if (addVal === null) {
      toast.error("Enter a whole dollar amount");
      return;
    }
    if (addVal <= 0) return;
    const newTotal = benefit.amount_used + addVal;
    try {
      await updateBenefitUsage(benefit.card_id, benefit.id, { amount_used: newTotal });
      setAddAmounts((prev) => ({ ...prev, [benefit.id]: "" }));
      fetchBenefits();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update usage");
    }
  };

  const startEdit = (benefit: BenefitSummaryItem) => {
    // The edit form replaces the whole tile, so a panel underneath it would
    // just reappear on cancel. You switched task; close it.
    if (panels.has(benefit.id)) closePanel(benefit.id);
    setEditingId(benefit.id);
    setEditName(benefit.benefit_name);
    setEditAmount(benefit.benefit_amount.toString());
    setEditFrequency(benefit.frequency);
    setEditResetType(benefit.reset_type);
    setEditNotes(benefit.notes || "");
    setDeletingId(null);
  };

  const handleEdit = async (benefitId: number, cardId: number) => {
    setSubmitting(true);
    try {
      const parsedAmount = editAmount ? parseIntStrict(editAmount) : undefined;
      if (editAmount && parsedAmount === null) {
        toast.error("Amount must be a valid number");
        setSubmitting(false);
        return;
      }
      await updateCardBenefit(cardId, benefitId, {
        benefit_name: editName || undefined,
        benefit_amount: parsedAmount ?? undefined,
        frequency: editFrequency || undefined,
        reset_type: editResetType || undefined,
        notes: editNotes,
      });
      setEditingId(null);
      fetchBenefits();
      toast.success("Benefit updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update benefit");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (benefitId: number, cardId: number) => {
    try {
      await deleteCardBenefit(cardId, benefitId);
      setDeletingId(null);
      fetchBenefits();
      toast.success("Benefit deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete benefit");
    }
  };

  const handleAutoComplete = async (benefit: BenefitSummaryItem) => {
    try {
      await updateBenefitUsage(benefit.card_id, benefit.id, { amount_used: benefit.benefit_amount });
      fetchBenefits();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update usage");
    }
  };

  const handleSetUsage = async (benefit: BenefitSummaryItem) => {
    const val = parseIntStrict(editUsageAmount);
    if (val === null || val < 0) {
      toast.error("Amount must be a non-negative number");
      return;
    }
    try {
      await updateBenefitUsage(benefit.card_id, benefit.id, { amount_used: val });
      setEditingUsageId(null);
      setEditUsageAmount("");
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
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-8 w-8 rounded bg-muted animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
                <div className="h-2.5 w-20 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-3 w-16 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
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
        {openCardIds.size > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <Lock className="h-3 w-3" />
              <span className="tabular-nums">
                {openCardIds.size} card{openCardIds.size === 1 ? "" : "s"} revealed
                {/* Auto-hide can be switched off entirely, and "0:00" would be a lie. */}
                {expiresAt !== null && ` · ${timerLabel}`}
              </span>
            </span>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={closeAllPanels}>
              Hide all
            </Button>
          </div>
        )}
      </div>

      {creditGroups.length === 0 && thresholdGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active credits to track.</p>
      ) : (
        <div className="space-y-4">
          {creditGroups.map(({ frequency, creditTypes }) => {
            const isCollapsed = collapsed.has(frequency);
            const freqBenefits = creditTypes.flatMap((g) => g.items);
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

                {/* Benefit name groups — 2-col grid on desktop */}
                {!isCollapsed && (
                  <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2 pl-6">
                    {creditTypes.map(({ benefitName, items }) => {
                      const hasEditingItem = items.some(b => editingId === b.id);
                      const isMulti = items.length > 1;
                      return (
                        <div
                          key={benefitName}
                          className={cn(
                            "border border-dashed rounded-lg p-3 space-y-2",
                            (isMulti || hasEditingItem) && "lg:col-span-2"
                          )}
                        >
                          <p className="text-xs font-semibold text-muted-foreground">{benefitName}</p>
                          <div className={cn(isMulti && !hasEditingItem && "grid grid-cols-1 lg:grid-cols-2 gap-2 items-start")}>
                            {items.map((benefit) => {
                              const pct = usagePercentage(benefit.amount_used, benefit.benefit_amount);
                              const barColor = usageColor(pct);

                              if (editingId === benefit.id) {
                                return (
                                  <div key={benefit.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <h5 className="text-sm font-medium">Edit Benefit</h5>
                                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingId(null)}>
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <Label className="text-xs">Name</Label>
                                        <Input className="h-8 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={100} />
                                      </div>
                                      <div>
                                        <Label className="text-xs">Amount ($)</Label>
                                        <Input className="h-8 text-sm" type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <Label className="text-xs">Frequency</Label>
                                        <Select value={editFrequency} onValueChange={setEditFrequency}>
                                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="monthly">Monthly</SelectItem>
                                            <SelectItem value="quarterly">Quarterly</SelectItem>
                                            <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                                            <SelectItem value="annual">Annual</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div>
                                        <Label className="text-xs">Reset Type</Label>
                                        <Select value={editResetType} onValueChange={setEditResetType}>
                                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="calendar">Calendar</SelectItem>
                                            <SelectItem value="cardiversary">Cardiversary</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>
                                    <div>
                                      <Label className="text-xs">Notes</Label>
                                      <textarea
                                        className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
                                        value={editNotes}
                                        onChange={(e) => setEditNotes(e.target.value)}
                                        maxLength={1000}
                                        placeholder="Optional notes..."
                                      />
                                    </div>
                                    <Button size="sm" className="h-7 text-xs" onClick={() => handleEdit(benefit.id, benefit.card_id)} disabled={submitting}>
                                      {submitting ? "Saving..." : "Save"}
                                    </Button>
                                  </div>
                                );
                              }

                              return (
                                <div key={benefit.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                                  {/* Card info + actions */}
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => onCardClick?.(benefit.card_id)}
                                      className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
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
                                    <div className="ml-auto flex items-center gap-1 shrink-0">
                                      <Badge variant="outline" className="text-[10px]">
                                        {formatCurrency(benefit.benefit_amount)}
                                      </Badge>
                                      {renderVaultTrigger(benefit)}
                                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => startEdit(benefit)}>
                                        <Pencil className="h-3 w-3" />
                                      </Button>
                                      {deletingId === benefit.id ? (
                                        <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => handleDelete(benefit.id, benefit.card_id)}>
                                          Delete?
                                        </Button>
                                      ) : (
                                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => setDeletingId(benefit.id)}>
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      )}
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
                                      {editingUsageId === benefit.id ? (
                                        <form
                                          className="flex items-center gap-1"
                                          onSubmit={(e) => { e.preventDefault(); handleSetUsage(benefit); }}
                                        >
                                          <span>$</span>
                                          <Input
                                            className="h-5 w-16 text-xs px-1"
                                            type="number"
                                            min="0"
                                            autoFocus
                                            value={editUsageAmount}
                                            onChange={(e) => setEditUsageAmount(e.target.value)}
                                            onBlur={() => { setEditingUsageId(null); setEditUsageAmount(""); }}
                                            onKeyDown={(e) => { if (e.key === "Escape") { setEditingUsageId(null); setEditUsageAmount(""); } }}
                                          />
                                          <span>/ ${benefit.benefit_amount}</span>
                                        </form>
                                      ) : (
                                        <button
                                          className="group/usage inline-flex items-center gap-0.5 hover:underline cursor-pointer"
                                          onClick={() => { setEditingUsageId(benefit.id); setEditUsageAmount(benefit.amount_used.toString()); }}
                                          title="Click to edit usage"
                                        >
                                          ${benefit.amount_used} / ${benefit.benefit_amount}
                                          {pct > 100
                                            ? <span className="ml-1 text-amber-600 dark:text-amber-400 font-medium">(exceeded)</span>
                                            : pct > 0 && <span className="ml-1">({pct}%)</span>}
                                          <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/usage:opacity-60 transition-opacity" />
                                        </button>
                                      )}
                                      {benefit.reset_label && benefit.days_until_reset != null && (
                                        <span>{benefit.reset_label} · {benefit.days_until_reset}d left</span>
                                      )}
                                    </div>
                                  </div>

                                  {benefit.notes && (
                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{benefit.notes}</p>
                                  )}

                                  {/* Stored card details, above the usage box on purpose: paste the
                                      number elsewhere, come back, and log the spend without scrolling. */}
                                  {renderVaultPanel(benefit)}

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
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 w-7 p-0"
                                      title="Mark as fully used"
                                      disabled={benefit.amount_used >= benefit.benefit_amount}
                                      onClick={() => handleAutoComplete(benefit)}
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
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
              {thresholdGroups.map(({ frequency, creditTypes }) => {
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
                      <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2 pl-6">
                        {creditTypes.map(({ benefitName, items }) => {
                          const hasEditingItem = items.some(b => editingId === b.id);
                          const isMulti = items.length > 1;
                          return (
                            <div
                              key={benefitName}
                              className={cn(
                                "border border-dashed rounded-lg p-3 space-y-2",
                                (isMulti || hasEditingItem) && "lg:col-span-2"
                              )}
                            >
                              <p className="text-xs font-semibold text-muted-foreground">{benefitName}</p>
                              <div className={cn(isMulti && !hasEditingItem && "grid grid-cols-1 lg:grid-cols-2 gap-2 items-start")}>
                                {items.map((benefit) => {
                                  const pct = usagePercentage(benefit.amount_used, benefit.benefit_amount);
                                  const isUnlocked = pct >= 100;
                                  const barColor = isUnlocked ? "bg-green-500" : pct >= 75 ? "bg-blue-500" : pct >= 50 ? "bg-blue-400" : "bg-muted-foreground/30";

                                  if (editingId === benefit.id) {
                                    return (
                                      <div key={benefit.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                                        <div className="flex items-center justify-between">
                                          <h5 className="text-sm font-medium">Edit Threshold</h5>
                                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingId(null)}>
                                            <X className="h-3 w-3" />
                                          </Button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <Label className="text-xs">Name</Label>
                                            <Input className="h-8 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={100} />
                                          </div>
                                          <div>
                                            <Label className="text-xs">Spend Required ($)</Label>
                                            <Input className="h-8 text-sm" type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <Label className="text-xs">Frequency</Label>
                                            <Select value={editFrequency} onValueChange={setEditFrequency}>
                                              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="monthly">Monthly</SelectItem>
                                                <SelectItem value="quarterly">Quarterly</SelectItem>
                                                <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                                                <SelectItem value="annual">Annual</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                          <div>
                                            <Label className="text-xs">Reset Type</Label>
                                            <Select value={editResetType} onValueChange={setEditResetType}>
                                              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="calendar">Calendar</SelectItem>
                                                <SelectItem value="cardiversary">Cardiversary</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                        </div>
                                        <div>
                                          <Label className="text-xs">Notes</Label>
                                          <textarea
                                            className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
                                            value={editNotes}
                                            onChange={(e) => setEditNotes(e.target.value)}
                                            maxLength={1000}
                                            placeholder="Optional notes..."
                                          />
                                        </div>
                                        <Button size="sm" className="h-7 text-xs" onClick={() => handleEdit(benefit.id, benefit.card_id)} disabled={submitting}>
                                          {submitting ? "Saving..." : "Save"}
                                        </Button>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div key={benefit.id} className={`rounded-lg border p-3 space-y-2 ${isUnlocked ? "bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-800" : "bg-muted/20"}`}>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => onCardClick?.(benefit.card_id)}
                                          className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
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
                                        <div className="ml-auto flex items-center gap-1 shrink-0">
                                          {isUnlocked && (
                                            <Badge className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800">
                                              Unlocked!
                                            </Badge>
                                          )}
                                          {renderVaultTrigger(benefit)}
                                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => startEdit(benefit)}>
                                            <Pencil className="h-3 w-3" />
                                          </Button>
                                          {deletingId === benefit.id ? (
                                            <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => handleDelete(benefit.id, benefit.card_id)}>
                                              Delete?
                                            </Button>
                                          ) : (
                                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => setDeletingId(benefit.id)}>
                                              <Trash2 className="h-3 w-3" />
                                            </Button>
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
                                          {editingUsageId === benefit.id ? (
                                            <form
                                              className="flex items-center gap-1"
                                              onSubmit={(e) => { e.preventDefault(); handleSetUsage(benefit); }}
                                            >
                                              <span>$</span>
                                              <Input
                                                className="h-5 w-16 text-xs px-1"
                                                type="number"
                                                min="0"
                                                autoFocus
                                                value={editUsageAmount}
                                                onChange={(e) => setEditUsageAmount(e.target.value)}
                                                onBlur={() => { setEditingUsageId(null); setEditUsageAmount(""); }}
                                                onKeyDown={(e) => { if (e.key === "Escape") { setEditingUsageId(null); setEditUsageAmount(""); } }}
                                              />
                                              <span>/ ${benefit.benefit_amount.toLocaleString()} spent</span>
                                            </form>
                                          ) : (
                                            <button
                                              className="group/usage inline-flex items-center gap-0.5 hover:underline cursor-pointer"
                                              onClick={() => { setEditingUsageId(benefit.id); setEditUsageAmount(benefit.amount_used.toString()); }}
                                              title="Click to edit usage"
                                            >
                                              ${benefit.amount_used.toLocaleString()} / ${benefit.benefit_amount.toLocaleString()} spent
                                              {pct > 0 && <span className="ml-1">({pct}%)</span>}
                                              <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/usage:opacity-60 transition-opacity" />
                                            </button>
                                          )}
                                          {benefit.reset_label && benefit.days_until_reset != null && (
                                            <span>{benefit.reset_label} · {benefit.days_until_reset}d left</span>
                                          )}
                                        </div>
                                      </div>

                                      {benefit.notes && (
                                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{benefit.notes}</p>
                                      )}

                                      {renderVaultPanel(benefit)}

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
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-7 w-7 p-0"
                                          title="Mark as fully used"
                                          disabled={benefit.amount_used >= benefit.benefit_amount}
                                          onClick={() => handleAutoComplete(benefit)}
                                        >
                                          <Check className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Opened from a tile whose card has nothing stored. `existing` stays
          null, so the dialog never tries to reveal a row that isn't there. */}
      <CardSecretDialog
        open={addDetailsFor !== null}
        onClose={() => setAddDetailsFor(null)}
        onSaved={() => {
          const cardId = addDetailsFor;
          loadSecrets();
          useAppStore.getState().refresh();
          // The tile that sent you here is still showing "no details stored".
          if (cardId !== null) {
            setPanels((prev) => {
              const next = new Map(prev);
              for (const [id, st] of prev) {
                if (st.status === "empty" && benefitById.get(id)?.card_id === cardId) next.delete(id);
              }
              return next;
            });
          }
        }}
        cards={cards}
        cardId={addDetailsFor}
        lockCard
      />
    </div>
  );
}
