"use client";

import { useEffect, useState, useMemo, useCallback, useRef, useId } from "react";
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
import { maskLastDigits } from "@/lib/card-number";
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

/**
 * The notes field is a bare <textarea> (no primitive exists for one), so it
 * carries the Input primitive's chrome by hand: same border token, shadow,
 * placeholder colour and focus ring, and the same text-base-below-md that keeps
 * iOS from zooming on focus. Without it the focus indicator changed style
 * halfway down the form.
 */
const NOTES_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm shadow-sm min-h-[60px] resize-y transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const COLLAPSED_KEY = "credits-widget-collapsed";
/** Remembers whether the vault held anything last time — see renderVaultTrigger. */
const VAULT_IN_USE_KEY = "credits-widget-vault-in-use";

interface CreditsWidgetProps {
  className?: string;
  onCardClick?: (cardId: number) => void;
}

export function CreditsWidget({ className, onCardClick }: CreditsWidgetProps) {
  const { selectedProfileId, cards, authMode } = useAppStore();
  const { revealed, expiresAt, reveal, hide, checkExpiry } = useCardVault();
  /** One edit form is open at a time, so one set of field ids is enough. */
  const uid = useId();
  const [benefits, setBenefits] = useState<BenefitSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  /** Set only when the list on screen is empty because a load failed. */
  const [loadError, setLoadError] = useState<string | null>(null);
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
  /** Benefit whose usage is being written — +$, the inline editor and "fully
   *  used" all post an absolute total, so they share one in-flight guard. */
  const [usageSubmittingId, setUsageSubmittingId] = useState<number | null>(null);
  /** Benefit whose delete is in flight, so "Delete?" can't fire twice. */
  const [deleteSubmittingId, setDeleteSubmittingId] = useState<number | null>(null);
  const [editingUsageId, setEditingUsageId] = useState<number | null>(null);
  const [editUsageAmount, setEditUsageAmount] = useState("");
  /** Set by Escape/Cancel so the field's own blur can't commit after it. */
  const skipUsageBlur = useRef(false);
  /** null while the vault list is still loading, so the trigger can hold its slot. */
  const [secrets, setSecrets] = useState<CardSecretMasked[] | null>(null);
  /** Did this browser see a non-empty vault last time? Decides whether the
   *  trigger slot is worth reserving while the list is in flight. */
  const [vaultLikely, setVaultLikely] = useState(false);
  /** Which benefit tiles are expanded, keyed by benefit id — never by card id. */
  const [panels, setPanels] = useState<Map<number, PanelState>>(() => new Map());
  const [addDetailsFor, setAddDetailsFor] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      if (saved) setCollapsed(new Set(JSON.parse(saved)));
      setVaultLikely(localStorage.getItem(VAULT_IN_USE_KEY) === "1");
    } catch {}
  }, []);

  const fetchBenefits = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const profileId = selectedProfileId !== "all" ? parseInt(selectedProfileId) : undefined;
      const data = await getAllBenefits(profileId);
      setBenefits(data);
      setLoadError(null);
    } catch (e) {
      // A refetch failure keeps whatever is already on screen; only a first
      // load has nothing to show, and rendering "No active credits to track."
      // there states as fact something we never learned.
      const message = e instanceof Error ? e.message : "Failed to load benefits";
      setLoadError(message);
      toast.error("Failed to load benefits");
    } finally {
      setLoading(false);
    }
  }, [selectedProfileId]);

  // Mount and every profile switch. `showLoading` blanks the list on the way:
  // owner labels only render in "all" mode, so the previous profile's cards
  // would otherwise sit under the new profile's header with live controls.
  useEffect(() => {
    fetchBenefits(true);
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
      const rows = await getCardSecrets();
      setSecrets(rows);
      setVaultLikely(rows.length > 0);
      try {
        localStorage.setItem(VAULT_IN_USE_KEY, rows.length > 0 ? "1" : "0");
      } catch {}
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

  /** The card line in full — the tile truncates it, so it is also the `title`. */
  const cardLabel = (b: BenefitSummaryItem) =>
    [
      b.card_name,
      maskLastDigits(b.last_digits),
      selectedProfileId === "all" && b.profile_name ? `· ${b.profile_name}` : "",
    ]
      .filter(Boolean)
      .join(" ");

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
    // doesn't jump sideways when it lands — but only for people who had
    // something stored last time. Reserving it unconditionally guaranteed the
    // jump it exists to prevent for everyone who never uses the vault.
    if (secrets === null) return vaultLikely ? <span className="h-6 w-6 shrink-0" aria-hidden /> : null;
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
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const handleAddUsage = async (benefit: BenefitSummaryItem) => {
    if (usageSubmittingId === benefit.id) return;
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
    // An absolute total computed from a closed-over benefit: without the
    // in-flight guard above, a double-tap posted the same total twice and one
    // of the two additions vanished. The await on the refetch keeps the button
    // disabled until `amount_used` is fresh again.
    const newTotal = benefit.amount_used + addVal;
    setUsageSubmittingId(benefit.id);
    try {
      await updateBenefitUsage(benefit.card_id, benefit.id, { amount_used: newTotal });
      setAddAmounts((prev) => ({ ...prev, [benefit.id]: "" }));
      await fetchBenefits();
      toast.success(`Added ${formatCurrency(addVal)} to ${benefit.benefit_name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update usage");
    } finally {
      // Only release our own tile: writes to two different benefits can now
      // overlap, and an unconditional clear would re-enable the other tile's
      // still-in-flight button.
      setUsageSubmittingId((cur) => (cur === benefit.id ? null : cur));
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

  /**
   * Leave the edit form and put focus back on the pencil that opened it — the
   * form replaces the whole tile, so that trigger is unmounted while it is up
   * and focus would otherwise land on <body>. The pencil only exists again
   * after the tile re-renders, hence the frame's delay.
   */
  const closeEdit = (benefitId: number) => {
    setEditingId(null);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-benefit-edit-trigger="${benefitId}"]`)
        ?.focus();
    });
  };

  const handleEdit = async (benefitId: number, cardId: number) => {
    if (submitting) return;
    const name = editName.trim();
    // `x || undefined` dropped the key from the JSON entirely, so clearing Name
    // or Amount was a no-op that still toasted "Benefit updated" — while
    // `notes` in the same object literal did clear. Both are required; the Save
    // button is disabled on an empty one, and this guards the Enter path.
    if (!name) {
      toast.error("Name can't be empty");
      return;
    }
    const parsedAmount = parseIntStrict(editAmount);
    if (parsedAmount === null) {
      toast.error("Enter a whole dollar amount");
      return;
    }
    setSubmitting(true);
    try {
      await updateCardBenefit(cardId, benefitId, {
        benefit_name: name,
        benefit_amount: parsedAmount,
        frequency: editFrequency || undefined,
        reset_type: editResetType || undefined,
        notes: editNotes,
      });
      closeEdit(benefitId);
      fetchBenefits();
      toast.success("Benefit updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update benefit");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (benefitId: number, cardId: number) => {
    // Per-tile, not a global `!== null`: confirming a delete on one tile while
    // another is still in flight is a different row's click, and swallowing it
    // is the same dead-button bug in a new place.
    if (deleteSubmittingId === benefitId) return;
    setDeleteSubmittingId(benefitId);
    try {
      await deleteCardBenefit(cardId, benefitId);
      setDeletingId(null);
      await fetchBenefits();
      toast.success("Benefit deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete benefit");
    } finally {
      setDeleteSubmittingId((cur) => (cur === benefitId ? null : cur));
    }
  };

  const handleAutoComplete = async (benefit: BenefitSummaryItem) => {
    if (usageSubmittingId === benefit.id) return;
    setUsageSubmittingId(benefit.id);
    try {
      await updateBenefitUsage(benefit.card_id, benefit.id, { amount_used: benefit.benefit_amount });
      await fetchBenefits();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update usage");
    } finally {
      // Only release our own tile: writes to two different benefits can now
      // overlap, and an unconditional clear would re-enable the other tile's
      // still-in-flight button.
      setUsageSubmittingId((cur) => (cur === benefit.id ? null : cur));
    }
  };

  const startUsageEdit = (benefit: BenefitSummaryItem) => {
    skipUsageBlur.current = false;
    setEditingUsageId(benefit.id);
    setEditUsageAmount(benefit.amount_used.toString());
  };

  const cancelUsageEdit = () => {
    skipUsageBlur.current = true;
    setEditingUsageId(null);
    setEditUsageAmount("");
  };

  const handleSetUsage = async (benefit: BenefitSummaryItem) => {
    if (usageSubmittingId === benefit.id) return;
    const val = parseIntStrict(editUsageAmount);
    if (val === null) {
      toast.error("Enter a whole dollar amount");
      return;
    }
    if (val < 0) {
      toast.error("Amount used can't be negative");
      return;
    }
    setUsageSubmittingId(benefit.id);
    try {
      await updateBenefitUsage(benefit.card_id, benefit.id, { amount_used: val });
      setEditingUsageId(null);
      setEditUsageAmount("");
      await fetchBenefits();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update usage");
    } finally {
      // Only release our own tile: writes to two different benefits can now
      // overlap, and an unconditional clear would re-enable the other tile's
      // still-in-flight button.
      setUsageSubmittingId((cur) => (cur === benefit.id ? null : cur));
    }
  };

  /**
   * The inline usage field commits on blur instead of discarding: it is
   * `type="number"`, so a mobile keypad has no Return key to commit with, and
   * clicking Save blurs it first. A click that lands inside the form (Save,
   * Cancel) is not the end of the edit, and an untouched value just closes.
   */
  const handleUsageBlur = (
    e: React.FocusEvent<HTMLFormElement>,
    benefit: BenefitSummaryItem,
  ) => {
    if (skipUsageBlur.current) {
      skipUsageBlur.current = false;
      return;
    }
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (editUsageAmount.trim() === benefit.amount_used.toString()) {
      setEditingUsageId(null);
      setEditUsageAmount("");
      return;
    }
    handleSetUsage(benefit);
  };

  if (loading) {
    return (
      <div className={cn("bg-card rounded-xl border p-3 sm:p-5 space-y-4", className)}>
        <div className="flex flex-wrap items-center gap-2">
          <Gift className="h-5 w-5 text-purple-500" />
          <h2 className="font-semibold">Credits & Benefits</h2>
        </div>
        {/* Tile-shaped rather than three flat rows: this widget is the last
            thing to settle on the dashboard, and a 60px placeholder for an
            800px section moved everything under it when the data landed. */}
        <div className="space-y-4" aria-hidden>
          {[1, 2].map((group) => (
            <div key={group} className="space-y-2">
              <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:pl-6">
                {[1, 2].map((i) => (
                  <div key={i} className="rounded-lg border border-dashed p-2 sm:p-3 space-y-2">
                    <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                    <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-[25px] w-10 shrink-0 rounded bg-muted animate-pulse" />
                        <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                        <div className="ml-auto h-4 w-12 shrink-0 rounded-full bg-muted animate-pulse" />
                      </div>
                      <div className="h-2 rounded-full bg-muted animate-pulse" />
                      <div className="flex items-center justify-between gap-2">
                        <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                        <div className="h-3 w-16 rounded bg-muted animate-pulse" />
                      </div>
                      <div className="h-7 w-32 rounded-md bg-muted animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <span role="status" className="sr-only">Loading credits and benefits…</span>
      </div>
    );
  }

  return (
    <div className={cn("bg-card rounded-xl border p-3 sm:p-5 space-y-4", className)}>
      {/* Wraps: with the "N cards revealed · 4:59" chip present the heading and
          the chip do not fit one line on a phone. */}
      <div className="flex flex-wrap items-center gap-2">
        <Gift className="h-5 w-5 text-purple-500" />
        <h2 className="font-semibold">Credits & Benefits</h2>
        {benefits.length > 0 && (
          <Badge variant="secondary" className="text-xs">{benefits.length}</Badge>
        )}
        {openCardIds.size > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
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

      {loadError && benefits.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="text-sm text-danger">{loadError}</p>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => fetchBenefits(true)}>
            Try again
          </Button>
        </div>
      ) : creditGroups.length === 0 && thresholdGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active credits to track.</p>
      ) : (
        <div className="space-y-4">
          {creditGroups.map(({ frequency, creditTypes }) => {
            const isCollapsed = collapsed.has(frequency);
            const freqBenefits = creditTypes.flatMap((g) => g.items);
            const remaining = freqBenefits.reduce(
              (sum, b) => sum + Math.max(b.benefit_amount - b.amount_used, 0), 0
            );

            const sectionId = `${uid}-credits-${frequency}`;

            return (
              <div key={frequency}>
                {/* Frequency header. The collapsed set is persisted, so a user
                    can land here with a section already hidden — aria-expanded
                    is the only thing that says so. */}
                <h3>
                  <button
                    onClick={() => toggleCollapse(frequency)}
                    aria-expanded={!isCollapsed}
                    aria-controls={sectionId}
                    className="flex items-center gap-2 w-full text-left py-1 min-h-[44px] sm:min-h-0 hover:bg-muted/40 rounded-md px-1 -mx-1 transition-colors"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-medium text-sm">{frequencyLabel(frequency)} Credits</span>
                    {remaining > 0 && (
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">
                        {formatCurrency(remaining)} remaining
                      </span>
                    )}
                  </button>
                </h3>

                {/* Benefit name groups — 2-col grid on desktop */}
                {!isCollapsed && (
                  <div id={sectionId} className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2 sm:pl-6">
                    {creditTypes.map(({ benefitName, items }) => {
                      const hasEditingItem = items.some(b => editingId === b.id);
                      const isMulti = items.length > 1;
                      return (
                        <div
                          key={benefitName}
                          className={cn(
                            "border border-dashed rounded-lg p-2 sm:p-3 space-y-2 min-w-0",
                            (isMulti || hasEditingItem) && "lg:col-span-2"
                          )}
                        >
                          <p className="text-xs font-semibold text-muted-foreground break-words">{benefitName}</p>
                          <div className={cn(isMulti && !hasEditingItem && "grid grid-cols-1 lg:grid-cols-2 gap-2 items-start")}>
                            {items.map((benefit) => {
                              const pct = usagePercentage(benefit.amount_used, benefit.benefit_amount);
                              const barColor = usageColor(pct);

                              if (editingId === benefit.id) {
                                return (
                                  <form
                                    key={benefit.id}
                                    className="rounded-lg border bg-muted/20 p-3 space-y-2"
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      handleEdit(benefit.id, benefit.card_id);
                                    }}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <h4 className="text-sm font-medium">Edit Benefit</h4>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0"
                                        onClick={() => closeEdit(benefit.id)}
                                        aria-label={`Cancel editing ${benefit.benefit_name}`}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <Label htmlFor={`${uid}-name`} className="text-xs">Name</Label>
                                        <Input id={`${uid}-name`} className="h-8 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={100} autoFocus enterKeyHint="done" />
                                      </div>
                                      <div>
                                        <Label htmlFor={`${uid}-amount`} className="text-xs">Amount ($)</Label>
                                        <Input id={`${uid}-amount`} className="h-8 text-sm" type="number" inputMode="numeric" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <Label htmlFor={`${uid}-frequency`} className="text-xs">Frequency</Label>
                                        <Select value={editFrequency} onValueChange={setEditFrequency}>
                                          <SelectTrigger id={`${uid}-frequency`} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="monthly">Monthly</SelectItem>
                                            <SelectItem value="quarterly">Quarterly</SelectItem>
                                            <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                                            <SelectItem value="annual">Annual</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div>
                                        <Label htmlFor={`${uid}-reset-type`} className="text-xs">Reset Type</Label>
                                        <Select value={editResetType} onValueChange={setEditResetType}>
                                          <SelectTrigger id={`${uid}-reset-type`} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="calendar">Calendar</SelectItem>
                                            <SelectItem value="cardiversary">Cardiversary</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>
                                    <div>
                                      <Label htmlFor={`${uid}-notes`} className="text-xs">Notes</Label>
                                      <textarea
                                        id={`${uid}-notes`}
                                        className={NOTES_CLASS}
                                        value={editNotes}
                                        onChange={(e) => setEditNotes(e.target.value)}
                                        maxLength={1000}
                                        placeholder="Optional notes..."
                                      />
                                    </div>
                                    <Button type="submit" size="sm" className="h-7 text-xs min-h-[44px] sm:min-h-0" disabled={submitting || !editName.trim() || !editAmount.trim()}>
                                      {submitting ? "Saving..." : "Save"}
                                    </Button>
                                  </form>
                                );
                              }

                              return (
                                <div key={benefit.id} className="rounded-lg border bg-muted/20 p-3 space-y-2 min-w-0">
                                  {/* Card info + actions. Wraps rather than
                                      shrinking: four controls plus the amount
                                      left the card name ~50px on a phone. */}
                                  <div className="flex flex-wrap items-center gap-2">
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
                                        <p className="text-xs text-muted-foreground truncate" title={cardLabel(benefit)}>
                                          {benefit.card_name}
                                          {benefit.last_digits && ` ${maskLastDigits(benefit.last_digits)}`}
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
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0"
                                        data-benefit-edit-trigger={benefit.id}
                                        onClick={() => startEdit(benefit)}
                                        aria-label={`Edit ${benefit.benefit_name}`}
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </Button>
                                      {deletingId === benefit.id ? (
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          className="h-6 px-2 text-xs min-h-[44px] sm:min-h-0"
                                          disabled={deleteSubmittingId === benefit.id}
                                          onClick={() => handleDelete(benefit.id, benefit.card_id)}
                                          aria-label={`Confirm delete ${benefit.benefit_name}`}
                                        >
                                          {deleteSubmittingId === benefit.id ? "Deleting..." : "Delete?"}
                                        </Button>
                                      ) : (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-6 w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0 text-danger"
                                          onClick={() => setDeletingId(benefit.id)}
                                          aria-label={`Delete ${benefit.benefit_name}`}
                                        >
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
                                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                      {editingUsageId === benefit.id ? (
                                        <form
                                          className="flex items-center gap-1"
                                          onSubmit={(e) => { e.preventDefault(); handleSetUsage(benefit); }}
                                          onBlur={(e) => handleUsageBlur(e, benefit)}
                                        >
                                          <span aria-hidden>$</span>
                                          <Input
                                            className="h-9 w-20 px-2 sm:h-7"
                                            type="number"
                                            inputMode="numeric"
                                            min="0"
                                            autoFocus
                                            aria-label={`Amount used for ${benefit.benefit_name}`}
                                            value={editUsageAmount}
                                            onChange={(e) => setEditUsageAmount(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Escape") cancelUsageEdit(); }}
                                          />
                                          <span className="whitespace-nowrap">/ {formatCurrency(benefit.benefit_amount)}</span>
                                          <Button
                                            type="submit"
                                            size="sm"
                                            variant="ghost"
                                            className="h-9 w-9 sm:h-6 sm:w-6 p-0 shrink-0"
                                            disabled={usageSubmittingId === benefit.id}
                                            aria-label={`Save amount used for ${benefit.benefit_name}`}
                                          >
                                            <Check className="h-3.5 w-3.5" />
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="h-9 w-9 sm:h-6 sm:w-6 p-0 shrink-0"
                                            // pointerdown lands before the field's
                                            // focusout, so Safari — which doesn't focus
                                            // a button on click — can't turn Cancel into
                                            // a commit.
                                            onPointerDown={() => { skipUsageBlur.current = true; }}
                                            onClick={cancelUsageEdit}
                                            aria-label="Cancel editing amount used"
                                          >
                                            <X className="h-3.5 w-3.5" />
                                          </Button>
                                        </form>
                                      ) : (
                                        <button
                                          // Dotted underline and a resting pencil below sm: hover was
                                          // the only thing that said this figure is editable, and
                                          // touch has no hover.
                                          className="group/usage inline-flex items-center gap-0.5 py-2 -my-2 sm:py-0 sm:my-0 underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 hover:decoration-solid cursor-pointer"
                                          onClick={() => startUsageEdit(benefit)}
                                          title={`Edit amount used for ${benefit.benefit_name}`}
                                        >
                                          {formatCurrency(benefit.amount_used)} / {formatCurrency(benefit.benefit_amount)}
                                          {pct > 100
                                            ? <span className="ml-1 text-amber-600 dark:text-amber-400 font-medium">(over limit)</span>
                                            : pct > 0 && <span className="ml-1">({pct}%)</span>}
                                          <Pencil className="h-2.5 w-2.5 opacity-60 sm:opacity-0 sm:group-hover/usage:opacity-60 sm:group-focus/usage:opacity-60 transition-opacity" />
                                        </button>
                                      )}
                                      {benefit.reset_label && benefit.days_until_reset != null && (
                                        <span>{benefit.reset_label} · {benefit.days_until_reset}d left</span>
                                      )}
                                    </div>
                                  </div>

                                  {benefit.notes && (
                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{benefit.notes}</p>
                                  )}

                                  {/* Stored card details, above the usage box on purpose: paste the
                                      number elsewhere, come back, and log the spend without scrolling. */}
                                  {renderVaultPanel(benefit)}

                                  {/* Quick add usage. A real <form>: the field is
                                      type="number", so the mobile keypad has no
                                      Return key and Add is the only way to commit. */}
                                  <form
                                    className="flex items-center gap-1.5"
                                    onSubmit={(e) => { e.preventDefault(); handleAddUsage(benefit); }}
                                  >
                                    <span className="text-xs text-muted-foreground" aria-hidden>+$</span>
                                    <Input
                                      className="h-9 w-20 text-sm sm:h-7"
                                      type="number"
                                      inputMode="numeric"
                                      min="0"
                                      placeholder="0"
                                      aria-label={`Add to amount used for ${benefit.benefit_name}`}
                                      value={addAmounts[benefit.id] || ""}
                                      onChange={(e) =>
                                        setAddAmounts((prev) => ({ ...prev, [benefit.id]: e.target.value }))
                                      }
                                    />
                                    <Button
                                      type="submit"
                                      size="sm"
                                      variant="outline"
                                      className="h-9 px-2 text-xs sm:h-7"
                                      disabled={usageSubmittingId === benefit.id}
                                    >
                                      {usageSubmittingId === benefit.id ? "Adding..." : "Add"}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-9 w-9 p-0 sm:h-7 sm:w-7"
                                      title="Mark as fully used"
                                      aria-label={`Mark ${benefit.benefit_name} as fully used`}
                                      disabled={
                                        usageSubmittingId === benefit.id ||
                                        benefit.amount_used >= benefit.benefit_amount
                                      }
                                      onClick={() => handleAutoComplete(benefit)}
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                    </Button>
                                  </form>
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
              <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t">
                <Target className="h-4 w-4 text-blue-500" />
                <h3 className="font-medium text-sm">Spend Thresholds</h3>
                <Badge variant="secondary" className="text-xs">
                  {benefits.filter(b => b.benefit_type === "spend_threshold").length}
                </Badge>
              </div>
              {thresholdGroups.map(({ frequency, creditTypes }) => {
                const isCollapsed = collapsed.has(`threshold_${frequency}`);
                const sectionId = `${uid}-thresholds-${frequency}`;
                return (
                  <div key={`threshold_${frequency}`}>
                    {/* Collapsed state is persisted here too — see the credits
                        header above for why aria-expanded matters. */}
                    <h4>
                      <button
                        onClick={() => toggleCollapse(`threshold_${frequency}`)}
                        aria-expanded={!isCollapsed}
                        aria-controls={sectionId}
                        className="flex items-center gap-2 w-full text-left py-1 min-h-[44px] sm:min-h-0 hover:bg-muted/40 rounded-md px-1 -mx-1 transition-colors"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-medium text-sm">{frequencyLabel(frequency)} Thresholds</span>
                      </button>
                    </h4>

                    {!isCollapsed && (
                      <div id={sectionId} className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2 sm:pl-6">
                        {creditTypes.map(({ benefitName, items }) => {
                          const hasEditingItem = items.some(b => editingId === b.id);
                          const isMulti = items.length > 1;
                          return (
                            <div
                              key={benefitName}
                              className={cn(
                                "border border-dashed rounded-lg p-2 sm:p-3 space-y-2 min-w-0",
                                (isMulti || hasEditingItem) && "lg:col-span-2"
                              )}
                            >
                              <p className="text-xs font-semibold text-muted-foreground break-words">{benefitName}</p>
                              <div className={cn(isMulti && !hasEditingItem && "grid grid-cols-1 lg:grid-cols-2 gap-2 items-start")}>
                                {items.map((benefit) => {
                                  const pct = usagePercentage(benefit.amount_used, benefit.benefit_amount);
                                  const isUnlocked = pct >= 100;
                                  const barColor = isUnlocked ? "bg-green-500" : pct >= 75 ? "bg-blue-500" : pct >= 50 ? "bg-blue-400" : "bg-muted-foreground/30";

                                  if (editingId === benefit.id) {
                                    return (
                                      <form
                                        key={benefit.id}
                                        className="rounded-lg border bg-muted/20 p-3 space-y-2"
                                        onSubmit={(e) => {
                                          e.preventDefault();
                                          handleEdit(benefit.id, benefit.card_id);
                                        }}
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <h5 className="text-sm font-medium">Edit Threshold</h5>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0"
                                            onClick={() => closeEdit(benefit.id)}
                                            aria-label={`Cancel editing ${benefit.benefit_name}`}
                                          >
                                            <X className="h-3 w-3" />
                                          </Button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <Label htmlFor={`${uid}-name`} className="text-xs">Name</Label>
                                            <Input id={`${uid}-name`} className="h-8 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={100} autoFocus enterKeyHint="done" />
                                          </div>
                                          <div>
                                            <Label htmlFor={`${uid}-amount`} className="text-xs">Spend Required ($)</Label>
                                            <Input id={`${uid}-amount`} className="h-8 text-sm" type="number" inputMode="numeric" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <Label htmlFor={`${uid}-frequency`} className="text-xs">Frequency</Label>
                                            <Select value={editFrequency} onValueChange={setEditFrequency}>
                                              <SelectTrigger id={`${uid}-frequency`} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="monthly">Monthly</SelectItem>
                                                <SelectItem value="quarterly">Quarterly</SelectItem>
                                                <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                                                <SelectItem value="annual">Annual</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                          <div>
                                            <Label htmlFor={`${uid}-reset-type`} className="text-xs">Reset Type</Label>
                                            <Select value={editResetType} onValueChange={setEditResetType}>
                                              <SelectTrigger id={`${uid}-reset-type`} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="calendar">Calendar</SelectItem>
                                                <SelectItem value="cardiversary">Cardiversary</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                        </div>
                                        <div>
                                          <Label htmlFor={`${uid}-notes`} className="text-xs">Notes</Label>
                                          <textarea
                                            id={`${uid}-notes`}
                                            className={NOTES_CLASS}
                                            value={editNotes}
                                            onChange={(e) => setEditNotes(e.target.value)}
                                            maxLength={1000}
                                            placeholder="Optional notes..."
                                          />
                                        </div>
                                        <Button type="submit" size="sm" className="h-7 text-xs min-h-[44px] sm:min-h-0" disabled={submitting || !editName.trim() || !editAmount.trim()}>
                                          {submitting ? "Saving..." : "Save"}
                                        </Button>
                                      </form>
                                    );
                                  }

                                  return (
                                    <div key={benefit.id} className={`rounded-lg border p-3 space-y-2 min-w-0 ${isUnlocked ? "bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-800" : "bg-muted/20"}`}>
                                      {/* Wraps rather than shrinking — see the credits tile above. */}
                                      <div className="flex flex-wrap items-center gap-2">
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
                                            <p className="text-xs text-muted-foreground truncate" title={cardLabel(benefit)}>
                                              {benefit.card_name}
                                              {benefit.last_digits && ` ${maskLastDigits(benefit.last_digits)}`}
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
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0"
                                            data-benefit-edit-trigger={benefit.id}
                                            onClick={() => startEdit(benefit)}
                                            aria-label={`Edit ${benefit.benefit_name}`}
                                          >
                                            <Pencil className="h-3 w-3" />
                                          </Button>
                                          {deletingId === benefit.id ? (
                                            <Button
                                              size="sm"
                                              variant="destructive"
                                              className="h-6 px-2 text-xs min-h-[44px] sm:min-h-0"
                                              disabled={deleteSubmittingId === benefit.id}
                                              onClick={() => handleDelete(benefit.id, benefit.card_id)}
                                              aria-label={`Confirm delete ${benefit.benefit_name}`}
                                            >
                                              {deleteSubmittingId === benefit.id ? "Deleting..." : "Delete?"}
                                            </Button>
                                          ) : (
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              className="h-6 w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0 text-danger"
                                              onClick={() => setDeletingId(benefit.id)}
                                              aria-label={`Delete ${benefit.benefit_name}`}
                                            >
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
                                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                          {editingUsageId === benefit.id ? (
                                            <form
                                              className="flex items-center gap-1"
                                              onSubmit={(e) => { e.preventDefault(); handleSetUsage(benefit); }}
                                              onBlur={(e) => handleUsageBlur(e, benefit)}
                                            >
                                              <span aria-hidden>$</span>
                                              <Input
                                                className="h-9 w-20 px-2 sm:h-7"
                                                type="number"
                                                inputMode="numeric"
                                                min="0"
                                                autoFocus
                                                aria-label={`Amount spent towards ${benefit.benefit_name}`}
                                                value={editUsageAmount}
                                                onChange={(e) => setEditUsageAmount(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Escape") cancelUsageEdit(); }}
                                              />
                                              <span className="whitespace-nowrap">/ {formatCurrency(benefit.benefit_amount)} spent</span>
                                              <Button
                                                type="submit"
                                                size="sm"
                                                variant="ghost"
                                                className="h-9 w-9 sm:h-6 sm:w-6 p-0 shrink-0"
                                                disabled={usageSubmittingId === benefit.id}
                                                aria-label={`Save amount spent towards ${benefit.benefit_name}`}
                                              >
                                                <Check className="h-3.5 w-3.5" />
                                              </Button>
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="h-9 w-9 sm:h-6 sm:w-6 p-0 shrink-0"
                                                // See the credits tile above.
                                                onPointerDown={() => { skipUsageBlur.current = true; }}
                                                onClick={cancelUsageEdit}
                                                aria-label="Cancel editing amount spent"
                                              >
                                                <X className="h-3.5 w-3.5" />
                                              </Button>
                                            </form>
                                          ) : (
                                            <button
                                              // Dotted underline and a resting pencil below sm — see
                                              // the credits tile above.
                                              className="group/usage inline-flex items-center gap-0.5 py-2 -my-2 sm:py-0 sm:my-0 underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 hover:decoration-solid cursor-pointer"
                                              onClick={() => startUsageEdit(benefit)}
                                              title={`Edit amount spent towards ${benefit.benefit_name}`}
                                            >
                                              {formatCurrency(benefit.amount_used)} / {formatCurrency(benefit.benefit_amount)} spent
                                              {pct > 0 && <span className="ml-1">({pct}%)</span>}
                                              <Pencil className="h-2.5 w-2.5 opacity-60 sm:opacity-0 sm:group-hover/usage:opacity-60 sm:group-focus/usage:opacity-60 transition-opacity" />
                                            </button>
                                          )}
                                          {benefit.reset_label && benefit.days_until_reset != null && (
                                            <span>{benefit.reset_label} · {benefit.days_until_reset}d left</span>
                                          )}
                                        </div>
                                      </div>

                                      {benefit.notes && (
                                        <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{benefit.notes}</p>
                                      )}

                                      {renderVaultPanel(benefit)}

                                      {/* Quick add spend — a real <form>, see the credits tile above. */}
                                      <form
                                        className="flex items-center gap-1.5"
                                        onSubmit={(e) => { e.preventDefault(); handleAddUsage(benefit); }}
                                      >
                                        <span className="text-xs text-muted-foreground" aria-hidden>+$</span>
                                        <Input
                                          className="h-9 w-20 text-sm sm:h-7"
                                          type="number"
                                          inputMode="numeric"
                                          min="0"
                                          placeholder="0"
                                          aria-label={`Add to amount spent towards ${benefit.benefit_name}`}
                                          value={addAmounts[benefit.id] || ""}
                                          onChange={(e) =>
                                            setAddAmounts((prev) => ({ ...prev, [benefit.id]: e.target.value }))
                                          }
                                        />
                                        <Button
                                          type="submit"
                                          size="sm"
                                          variant="outline"
                                          className="h-9 px-2 text-xs sm:h-7"
                                          disabled={usageSubmittingId === benefit.id}
                                        >
                                          {usageSubmittingId === benefit.id ? "Adding..." : "Add"}
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="h-9 w-9 p-0 sm:h-7 sm:w-7"
                                          title="Mark as fully met"
                                          aria-label={`Mark ${benefit.benefit_name} as fully met`}
                                          disabled={
                                            usageSubmittingId === benefit.id ||
                                            benefit.amount_used >= benefit.benefit_amount
                                          }
                                          onClick={() => handleAutoComplete(benefit)}
                                        >
                                          <Check className="h-3.5 w-3.5" />
                                        </Button>
                                      </form>
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
