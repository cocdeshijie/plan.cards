"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import type { Card, CardBenefit } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getCardBenefits,
  createCardBenefit,
  updateCardBenefit,
  deleteCardBenefit,
  updateBenefitUsage,
  populateBenefits,
} from "@/lib/api";
import {
  frequencyLabel,
  frequencyShort,
  resetTypeLabel,
  usagePercentage,
  usageColor,
} from "@/lib/benefit-utils";
import { formatCurrency, parseIntStrict } from "@/lib/utils";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Gift, Plus, Pencil, Trash2, X, RefreshCw, Target, ChevronDown, Check, Loader2 } from "lucide-react";

// The Notes fields are plain <textarea>s (there is no Textarea primitive), so
// they carry the Input primitive's classes by hand — including text-base below
// md, without which iOS Safari zooms the page on focus and never zooms back.
const TEXTAREA_CLASS =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-base md:text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[60px] resize-y";

// Collapse/expand headers are a single line of 14px text, which is a ~20px tap
// target. The negative margin gives the padding back to the layout so the header
// row keeps the height it had.
const SECTION_HEADER_CLASS =
  "flex items-center gap-2 text-left min-h-[44px] sm:min-h-0 py-2 -my-2";

interface BenefitsSectionProps {
  card: Card;
  accentTint: string;
  onUpdated: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onExpand: () => void;
}

export function BenefitsSection({ card, accentTint, onUpdated, expanded, onToggleExpand, onExpand }: BenefitsSectionProps) {
  const [benefits, setBenefits] = useState<CardBenefit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addAmounts, setAddAmounts] = useState<Record<number, string>>({});

  // Add form state
  const [addName, setAddName] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addFrequency, setAddFrequency] = useState("monthly");
  const [addResetType, setAddResetType] = useState("calendar");
  const [addBenefitType, setAddBenefitType] = useState("credit");
  const [addNotes, setAddNotes] = useState("");

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editFrequency, setEditFrequency] = useState("");
  const [editResetType, setEditResetType] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Per-row in-flight guard: the usage, auto-complete and delete controls all
  // live inside a row, so a single boolean would freeze every other row too.
  const [busyId, setBusyId] = useState<number | null>(null);

  // One id namespace per mounted section; the add form and the (single) open
  // edit form get their own prefixes so both can be on screen at once.
  const uid = useId();
  const addId = (field: string) => `${uid}-add-${field}`;
  const editId = (field: string) => `${uid}-edit-${field}`;

  const fetchBenefits = async () => {
    try {
      const data = await getCardBenefits(card.id);
      setBenefits(data);
    } catch {
      toast.error("Failed to load benefits");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBenefits();
  }, [card.id]);

  // Closing the form used to leave the draft — and the error banner, which
  // lives outside the form — sitting there for the next open.
  const resetAddForm = () => {
    setShowAddForm(false);
    setAddName("");
    setAddAmount("");
    setAddFrequency("monthly");
    setAddResetType("calendar");
    setAddBenefitType("credit");
    setAddNotes("");
    setError(null);
  };

  const handleAdd = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting || !addName.trim() || !addAmount.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const parsedAmount = parseIntStrict(addAmount);
      if (!parsedAmount || parsedAmount <= 0) {
        setError("Amount must be a positive whole dollar amount");
        setSubmitting(false);
        return;
      }
      await createCardBenefit(card.id, {
        benefit_name: addName.trim(),
        benefit_amount: parsedAmount,
        frequency: addFrequency,
        reset_type: addResetType,
        benefit_type: addBenefitType,
        notes: addNotes || null,
      });
      resetAddForm();
      await fetchBenefits();
      onUpdated();
      toast.success("Benefit added");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add benefit");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (benefitId: number, e?: FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    // Name and Amount are required, and `x || undefined` used to drop an empty
    // one from the PATCH body — the backend then saw "unchanged" and we toasted
    // "Benefit updated" over an edit that never happened.
    if (!editName.trim()) {
      setError("Name is required");
      return;
    }
    if (!editAmount.trim()) {
      setError("Amount is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const parsedEditAmount = parseIntStrict(editAmount);
      if (parsedEditAmount === null || parsedEditAmount <= 0) {
        setError("Amount must be a positive whole dollar amount");
        setSubmitting(false);
        return;
      }
      await updateCardBenefit(card.id, benefitId, {
        benefit_name: editName.trim(),
        benefit_amount: parsedEditAmount,
        frequency: editFrequency || undefined,
        reset_type: editResetType || undefined,
        notes: editNotes,
      });
      setEditingId(null);
      await fetchBenefits();
      onUpdated();
      toast.success("Benefit updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update benefit");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (benefitId: number) => {
    // Scoped to this row, matching `disabled={busyId === benefit.id}` on the
    // controls: a global `busyId !== null` swallowed clicks on every other row
    // while one request was in flight, with no spinner or toast to explain it.
    if (busyId === benefitId) return;
    setBusyId(benefitId);
    setError(null);
    try {
      await deleteCardBenefit(card.id, benefitId);
      setDeletingId(null);
      await fetchBenefits();
      onUpdated();
      toast.success("Benefit deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete benefit");
    } finally {
      setBusyId(null);
    }
  };

  const handleAddUsage = async (benefit: CardBenefit) => {
    if (busyId === benefit.id) return;
    const raw = addAmounts[benefit.id] || "";
    if (!raw.trim()) return;
    const addVal = parseIntStrict(raw);
    // Silent early-return on "12.50" made the Add button look dead, exactly as
    // it did on the dashboard twin (credits-widget.tsx handleAddUsage).
    if (addVal === null) {
      toast.error("Enter a whole dollar amount");
      return;
    }
    if (addVal <= 0) return;
    const newTotal = benefit.amount_used + addVal;
    setBusyId(benefit.id);
    try {
      await updateBenefitUsage(card.id, benefit.id, { amount_used: newTotal });
      setAddAmounts((prev) => ({ ...prev, [benefit.id]: "" }));
      await fetchBenefits();
      onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update usage");
    } finally {
      setBusyId(null);
    }
  };

  const handleAutoComplete = async (benefit: CardBenefit) => {
    if (busyId === benefit.id) return;
    setBusyId(benefit.id);
    try {
      await updateBenefitUsage(card.id, benefit.id, { amount_used: benefit.benefit_amount });
      await fetchBenefits();
      onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update usage");
    } finally {
      setBusyId(null);
    }
  };

  // Its own flag rather than `submitting`, which the add/edit forms already own —
  // sharing it made the header button read "Populating..." during an unrelated save.
  const handlePopulate = async () => {
    if (populating) return;
    setPopulating(true);
    setError(null);
    try {
      await populateBenefits(card.id);
      await fetchBenefits();
      onUpdated();
      toast.success("Benefits populated from template");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to populate benefits");
    } finally {
      setPopulating(false);
    }
  };

  const startEdit = (benefit: CardBenefit) => {
    // An armed "Delete?" survived a jump into the edit form and stayed armed
    // behind it, so cancelling the edit dropped you back onto a live delete.
    setDeletingId(null);
    setEditingId(benefit.id);
    setEditName(benefit.benefit_name);
    setEditAmount(benefit.benefit_amount.toString());
    setEditFrequency(benefit.frequency);
    setEditResetType(benefit.reset_type);
    setEditNotes(benefit.notes || "");
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {/* Same divider colour and same action row as the loaded header, or the
            whole section jumps ~8px sideways-and-down when the data lands. */}
        <div className="h-px" style={{ backgroundColor: accentTint }} />
        <div className="flex items-center justify-between">
          <button onClick={onToggleExpand} aria-expanded={expanded} className={SECTION_HEADER_CLASS}>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!expanded ? "-rotate-90" : ""}`} />
            <Gift className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-medium text-sm">Benefits & Credits</h4>
          </button>
          <div className="flex gap-1.5 shrink-0">
            {card.template_id && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" disabled>
                <RefreshCw className="h-3 w-3" />
                Populate
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" disabled>
              <Plus className="h-3 w-3" />
              Add
            </Button>
          </div>
        </div>
        {expanded && [1, 2].map((i) => (
          <div key={i} className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <div className="flex justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-px" style={{ backgroundColor: accentTint }} />
      <div className="flex items-center justify-between">
        <button onClick={onToggleExpand} aria-expanded={expanded} className={SECTION_HEADER_CLASS}>
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!expanded ? "-rotate-90" : ""}`} />
          <Gift className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-medium text-sm">Benefits & Credits</h4>
          {benefits.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {benefits.length}
            </Badge>
          )}
        </button>
        <div className="flex gap-1.5 shrink-0">
          {card.template_id && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => { onExpand(); handlePopulate(); }} disabled={populating}>
              {populating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {populating ? "Populating..." : "Populate"}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => { onExpand(); setShowAddForm(true); }} disabled={populating}>
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-2 text-xs text-danger flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 p-2.5 -m-1.5 hover:opacity-70" aria-label="Dismiss error"><X className="h-3 w-3" /></button>
        </div>
      )}

      {expanded && <>
      {benefits.length === 0 && !showAddForm && (
        <p className="text-sm text-muted-foreground">No benefits tracked.</p>
      )}

      {/* Add benefit form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="rounded-lg border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="text-sm font-medium">Add Benefit</h5>
            <Button type="button" size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" onClick={resetAddForm} aria-label="Close add benefit form">
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div>
            <Label htmlFor={addId("type")} className="text-xs">Type</Label>
            <Select value={addBenefitType} onValueChange={setAddBenefitType}>
              <SelectTrigger id={addId("type")} className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="credit">Credit</SelectItem>
                <SelectItem value="spend_threshold">Spend Threshold</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <Label htmlFor={addId("name")} className="text-xs">Name</Label>
              <Input id={addId("name")} className="h-8 text-sm" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder={addBenefitType === "spend_threshold" ? "e.g. Free Night Award" : "e.g. Uber Cash"} maxLength={100} enterKeyHint="next" />
            </div>
            <div className="min-w-0">
              <Label htmlFor={addId("amount")} className="text-xs">{addBenefitType === "spend_threshold" ? "Spend Required ($)" : "Amount ($)"}</Label>
              <Input id={addId("amount")} className="h-8 text-sm" type="number" inputMode="numeric" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} placeholder={addBenefitType === "spend_threshold" ? "15000" : "15"} enterKeyHint="done" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <Label htmlFor={addId("frequency")} className="text-xs">Frequency</Label>
              <Select value={addFrequency} onValueChange={setAddFrequency}>
                <SelectTrigger id={addId("frequency")} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor={addId("reset")} className="text-xs">Reset Type</Label>
              <Select value={addResetType} onValueChange={setAddResetType}>
                <SelectTrigger id={addId("reset")} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="calendar">Calendar</SelectItem>
                  <SelectItem value="cardiversary">Cardiversary</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor={addId("notes")} className="text-xs">Notes</Label>
            <textarea
              id={addId("notes")}
              className={TEXTAREA_CLASS}
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              maxLength={1000}
              placeholder="Optional notes..."
            />
            <span className="text-[10px] text-muted-foreground">{addNotes.length}/1000</span>
          </div>
          <Button type="submit" size="sm" className="h-7 text-xs" disabled={submitting || !addName.trim() || !addAmount.trim()}>
            {submitting ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Adding...</> : "Add Benefit"}
          </Button>
        </form>
      )}

      {benefits.filter(b => b.benefit_type !== "spend_threshold").map((benefit) => {
        const pct = usagePercentage(benefit.amount_used, benefit.benefit_amount);
        const barColor = usageColor(pct);
        const isEditing = editingId === benefit.id;

        if (isEditing) {
          return (
            <form key={benefit.id} onSubmit={(e) => handleEdit(benefit.id, e)} className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h5 className="text-sm font-medium">Edit Benefit</h5>
                <Button type="button" size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" onClick={() => setEditingId(null)} aria-label={`Cancel editing ${benefit.benefit_name}`}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0">
                  <Label htmlFor={editId("name")} className="text-xs">Name</Label>
                  <Input id={editId("name")} className="h-8 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={100} enterKeyHint="next" />
                </div>
                <div className="min-w-0">
                  <Label htmlFor={editId("amount")} className="text-xs">Amount ($)</Label>
                  <Input id={editId("amount")} className="h-8 text-sm" type="number" inputMode="numeric" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} enterKeyHint="done" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0">
                  <Label htmlFor={editId("frequency")} className="text-xs">Frequency</Label>
                  <Select value={editFrequency} onValueChange={setEditFrequency}>
                    <SelectTrigger id={editId("frequency")} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <Label htmlFor={editId("reset")} className="text-xs">Reset Type</Label>
                  <Select value={editResetType} onValueChange={setEditResetType}>
                    <SelectTrigger id={editId("reset")} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="calendar">Calendar</SelectItem>
                      <SelectItem value="cardiversary">Cardiversary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor={editId("notes")} className="text-xs">Notes</Label>
                <textarea
                  id={editId("notes")}
                  className={TEXTAREA_CLASS}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  maxLength={1000}
                  placeholder="Optional notes..."
                />
                <span className="text-[10px] text-muted-foreground">{editNotes.length}/1000</span>
              </div>
              <Button type="submit" size="sm" className="h-7 text-xs" disabled={submitting || !editName.trim() || !editAmount.trim()}>
                {submitting ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Saving...</> : "Save"}
              </Button>
            </form>
          );
        }

        return (
          <div
            key={benefit.id}
            className={`rounded-lg border p-3 space-y-2 ${
              benefit.retired
                ? "opacity-60 border-dashed border-amber-400/50 bg-amber-50/30 dark:bg-amber-950/10"
                : "bg-muted/20"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <span className="text-sm font-medium">{benefit.benefit_name}</span>
                {benefit.retired && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                    Retired
                  </span>
                )}
                {benefit.from_template && !benefit.retired && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium">
                    Template
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {frequencyLabel(benefit.frequency)} &middot; {resetTypeLabel(benefit.reset_type)}
                </span>
              </div>
              <div className="flex gap-0.5 shrink-0">
                <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" title="Mark as fully used" disabled={busyId === benefit.id || benefit.amount_used >= benefit.benefit_amount} onClick={() => handleAutoComplete(benefit)} aria-label={`Mark ${benefit.benefit_name} as fully used`}>
                  {busyId === benefit.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" onClick={() => startEdit(benefit)} aria-label={`Edit ${benefit.benefit_name}`}>
                  <Pencil className="h-3 w-3" />
                </Button>
                {/* Armed state keeps the arming button's tap target, and carries
                    its own X — there is no outside-click or timeout to disarm it. */}
                {deletingId === benefit.id ? (
                  <>
                    <Button size="sm" variant="destructive" className="h-6 min-h-[44px] sm:min-h-0 px-2 text-xs" disabled={busyId === benefit.id} onClick={() => handleDelete(benefit.id)} aria-label={`Confirm delete ${benefit.benefit_name}`}>
                      {busyId === benefit.id ? "Deleting..." : "Delete?"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" disabled={busyId === benefit.id} onClick={() => setDeletingId(null)} aria-label={`Keep ${benefit.benefit_name}`}>
                      <X className="h-3 w-3" />
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0 text-danger" onClick={() => setDeletingId(benefit.id)} aria-label={`Delete ${benefit.benefit_name}`}>
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
                <span className={pct > 100 ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
                  {formatCurrency(benefit.amount_used)} / {formatCurrency(benefit.benefit_amount)}
                  {/* Same wording as the dashboard twin (credits-widget.tsx) —
                      the two screens named one state two different ways. */}
                  {pct > 100 && " (over limit)"}
                  {pct > 0 && pct <= 100 && <span className="ml-1">({pct}%)</span>}
                </span>
                {benefit.reset_label && benefit.days_until_reset != null && (
                  <span>{benefit.reset_label} &middot; {benefit.days_until_reset}d left</span>
                )}
              </div>
            </div>

            {/* Notes display */}
            {benefit.notes && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{benefit.notes}</p>
            )}

            {/* Quick add usage — a real form so Enter submits it on mobile too */}
            <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); handleAddUsage(benefit); }}>
              <span className="text-xs text-muted-foreground" aria-hidden="true">+$</span>
              <Input
                className="h-7 w-20 text-sm"
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="0"
                enterKeyHint="done"
                aria-label={`Dollars to add to ${benefit.benefit_name}`}
                value={addAmounts[benefit.id] || ""}
                onChange={(e) => setAddAmounts((prev) => ({ ...prev, [benefit.id]: e.target.value }))}
              />
              <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyId === benefit.id} aria-label={`Add usage to ${benefit.benefit_name}`}>
                {busyId === benefit.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
              </Button>
            </form>
          </div>
        );
      })}

      {/* Spend Thresholds subsection */}
      {benefits.some(b => b.benefit_type === "spend_threshold") && (
        <>
          <div className="flex items-center gap-2 mt-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <h5 className="text-sm font-medium text-muted-foreground">Spend Thresholds</h5>
          </div>
          {benefits.filter(b => b.benefit_type === "spend_threshold").map((benefit) => {
            const pct = usagePercentage(benefit.amount_used, benefit.benefit_amount);
            const isUnlocked = pct >= 100;
            const barColor = isUnlocked ? "bg-green-500" : pct >= 75 ? "bg-blue-500" : pct >= 50 ? "bg-blue-400" : "bg-muted-foreground/30";
            const isEditing = editingId === benefit.id;

            if (isEditing) {
              return (
                <form key={benefit.id} onSubmit={(e) => handleEdit(benefit.id, e)} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h5 className="text-sm font-medium">Edit Threshold</h5>
                    <Button type="button" size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" onClick={() => setEditingId(null)} aria-label={`Cancel editing ${benefit.benefit_name}`}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <Label htmlFor={editId("name")} className="text-xs">Name</Label>
                      <Input id={editId("name")} className="h-8 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={100} enterKeyHint="next" />
                    </div>
                    <div className="min-w-0">
                      <Label htmlFor={editId("amount")} className="text-xs">Spend Required ($)</Label>
                      <Input id={editId("amount")} className="h-8 text-sm" type="number" inputMode="numeric" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} enterKeyHint="done" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <Label htmlFor={editId("frequency")} className="text-xs">Frequency</Label>
                      <Select value={editFrequency} onValueChange={setEditFrequency}>
                        <SelectTrigger id={editId("frequency")} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="quarterly">Quarterly</SelectItem>
                          <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                          <SelectItem value="annual">Annual</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0">
                      <Label htmlFor={editId("reset")} className="text-xs">Reset Type</Label>
                      <Select value={editResetType} onValueChange={setEditResetType}>
                        <SelectTrigger id={editId("reset")} className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="calendar">Calendar</SelectItem>
                          <SelectItem value="cardiversary">Cardiversary</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor={editId("notes")} className="text-xs">Notes</Label>
                    {/* maxLength and the counter match the other three copies of
                        this field; without them an over-length note 422s. */}
                    <textarea
                      id={editId("notes")}
                      className={TEXTAREA_CLASS}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      maxLength={1000}
                      placeholder="Optional notes..."
                    />
                    <span className="text-[10px] text-muted-foreground">{editNotes.length}/1000</span>
                  </div>
                  <Button type="submit" size="sm" className="h-7 text-xs" disabled={submitting || !editName.trim() || !editAmount.trim()}>
                    {submitting ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Saving...</> : "Save"}
                  </Button>
                </form>
              );
            }

            return (
              <div
                key={benefit.id}
                className={`rounded-lg border p-3 space-y-2 ${
                  benefit.retired
                    ? "opacity-60 border-dashed border-amber-400/50 bg-amber-50/30 dark:bg-amber-950/10"
                    : isUnlocked
                    ? "bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                    : "bg-muted/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <span className="text-sm font-medium">{benefit.benefit_name}</span>
                    {isUnlocked && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-medium">
                        Unlocked!
                      </span>
                    )}
                    {benefit.retired && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                        Retired
                      </span>
                    )}
                    {benefit.from_template && !benefit.retired && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium">
                        Template
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {frequencyLabel(benefit.frequency)} &middot; {resetTypeLabel(benefit.reset_type)}
                    </span>
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" title="Mark as fully used" disabled={busyId === benefit.id || benefit.amount_used >= benefit.benefit_amount} onClick={() => handleAutoComplete(benefit)} aria-label={`Mark ${benefit.benefit_name} as fully used`}>
                      {busyId === benefit.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" onClick={() => startEdit(benefit)} aria-label={`Edit ${benefit.benefit_name}`}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {/* Two-step, matching the credits list above: a single
                        click here used to permanently delete the threshold and
                        its accumulated amount_used, and the control sits at the
                        same coordinates as the guarded one. The X disarms it —
                        nothing else does. */}
                    {deletingId === benefit.id ? (
                      <>
                        <Button size="sm" variant="destructive" className="h-6 min-h-[44px] sm:min-h-0 px-2 text-xs" disabled={busyId === benefit.id} onClick={() => handleDelete(benefit.id)} aria-label={`Confirm delete ${benefit.benefit_name}`}>
                          {busyId === benefit.id ? "Deleting..." : "Delete?"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" disabled={busyId === benefit.id} onClick={() => setDeletingId(null)} aria-label={`Keep ${benefit.benefit_name}`}>
                          <X className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0 text-danger" onClick={() => setDeletingId(benefit.id)} aria-label={`Delete ${benefit.benefit_name}`}>
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
                    <span>
                      {formatCurrency(benefit.amount_used)} / {formatCurrency(benefit.benefit_amount)} spent
                      {pct > 0 && <span className="ml-1">({pct}%)</span>}
                    </span>
                    {benefit.reset_label && benefit.days_until_reset != null && (
                      <span>{benefit.reset_label} &middot; {benefit.days_until_reset}d left</span>
                    )}
                  </div>
                </div>

                {/* Notes display */}
                {benefit.notes && (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">{benefit.notes}</p>
                )}

                {/* Quick add spending — a real form so Enter submits it on mobile too */}
                <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); handleAddUsage(benefit); }}>
                  <span className="text-xs text-muted-foreground" aria-hidden="true">+$</span>
                  <Input
                    className="h-7 w-20 text-sm"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    placeholder="0"
                    enterKeyHint="done"
                    aria-label={`Dollars to add to ${benefit.benefit_name}`}
                    value={addAmounts[benefit.id] || ""}
                    onChange={(e) => setAddAmounts((prev) => ({ ...prev, [benefit.id]: e.target.value }))}
                  />
                  <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyId === benefit.id} aria-label={`Add spending to ${benefit.benefit_name}`}>
                    {busyId === benefit.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
                  </Button>
                </form>
              </div>
            );
          })}
        </>
      )}

      </>}
    </div>
  );
}
