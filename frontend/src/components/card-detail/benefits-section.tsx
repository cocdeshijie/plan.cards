"use client";

import { useEffect, useState } from "react";
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
import { parseIntStrict } from "@/lib/utils";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Gift, Plus, Pencil, Trash2, X, RefreshCw, Target, ChevronDown } from "lucide-react";

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
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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

  const handleAdd = async () => {
    if (!addName || !addAmount) return;
    setSubmitting(true);
    setError(null);
    try {
      const parsedAmount = parseIntStrict(addAmount);
      if (!parsedAmount || parsedAmount <= 0) {
        setError("Amount must be a positive number");
        setSubmitting(false);
        return;
      }
      await createCardBenefit(card.id, {
        benefit_name: addName,
        benefit_amount: parsedAmount,
        frequency: addFrequency,
        reset_type: addResetType,
        benefit_type: addBenefitType,
        notes: addNotes || null,
      });
      setShowAddForm(false);
      setAddName("");
      setAddAmount("");
      setAddFrequency("monthly");
      setAddResetType("calendar");
      setAddBenefitType("credit");
      setAddNotes("");
      fetchBenefits();
      toast.success("Benefit added");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add benefit");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (benefitId: number) => {
    setSubmitting(true);
    setError(null);
    try {
      const parsedEditAmount = editAmount ? parseIntStrict(editAmount) : undefined;
      if (editAmount && parsedEditAmount === null) {
        setError("Amount must be a valid number");
        setSubmitting(false);
        return;
      }
      await updateCardBenefit(card.id, benefitId, {
        benefit_name: editName || undefined,
        benefit_amount: parsedEditAmount ?? undefined,
        frequency: editFrequency || undefined,
        reset_type: editResetType || undefined,
        notes: editNotes,
      });
      setEditingId(null);
      fetchBenefits();
      toast.success("Benefit updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update benefit");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (benefitId: number) => {
    setError(null);
    try {
      await deleteCardBenefit(card.id, benefitId);
      fetchBenefits();
      toast.success("Benefit deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete benefit");
    }
  };

  const handleAddUsage = async (benefit: CardBenefit) => {
    const addVal = parseIntStrict(addAmounts[benefit.id] || "0");
    if (!addVal || addVal <= 0) return;
    const newTotal = benefit.amount_used + addVal;
    try {
      await updateBenefitUsage(card.id, benefit.id, { amount_used: newTotal });
      setAddAmounts((prev) => ({ ...prev, [benefit.id]: "" }));
      fetchBenefits();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update usage");
    }
  };

  const handlePopulate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await populateBenefits(card.id);
      fetchBenefits();
      toast.success("Benefits populated from template");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to populate benefits");
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (benefit: CardBenefit) => {
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
        <div className="h-px bg-muted" />
        <button onClick={onToggleExpand} aria-expanded={expanded} className="flex items-center gap-2">
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!expanded ? "-rotate-90" : ""}`} />
          <Gift className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-medium text-sm">Benefits & Credits</h4>
        </button>
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
        <button onClick={onToggleExpand} aria-expanded={expanded} className="flex items-center gap-2">
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!expanded ? "-rotate-90" : ""}`} />
          <Gift className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-medium text-sm">Benefits & Credits</h4>
          {benefits.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {benefits.length}
            </Badge>
          )}
        </button>
        <div className="flex gap-1.5">
          {card.template_id && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => { onExpand(); handlePopulate(); }}>
              <RefreshCw className="h-3 w-3" />
              Populate
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => { onExpand(); setShowAddForm(true); }}>
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 hover:opacity-70"><X className="h-3 w-3" /></button>
        </div>
      )}

      {expanded && <>
      {benefits.length === 0 && !showAddForm && (
        <p className="text-sm text-muted-foreground">No benefits tracked.</p>
      )}

      {benefits.filter(b => b.benefit_type !== "spend_threshold").map((benefit) => {
        const pct = usagePercentage(benefit.amount_used, benefit.benefit_amount);
        const barColor = usageColor(pct);
        const isEditing = editingId === benefit.id;

        if (isEditing) {
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
                <span className="text-[10px] text-muted-foreground">{editNotes.length}/1000</span>
              </div>
              <Button size="sm" className="h-7 text-xs" onClick={() => handleEdit(benefit.id)} disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button>
            </div>
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 flex-wrap">
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
              <div className="flex gap-0.5">
                <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" onClick={() => startEdit(benefit)} aria-label={`Edit ${benefit.benefit_name}`}>
                  <Pencil className="h-3 w-3" />
                </Button>
                {deletingId === benefit.id ? (
                  <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => { handleDelete(benefit.id); setDeletingId(null); }}>
                    Delete?
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0 text-destructive" onClick={() => setDeletingId(benefit.id)} aria-label={`Delete ${benefit.benefit_name}`}>
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
                  ${benefit.amount_used} / ${benefit.benefit_amount}
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

            {/* Quick add usage */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">+$</span>
              <Input
                className="h-7 w-20 text-sm"
                type="number"
                min="0"
                placeholder="0"
                value={addAmounts[benefit.id] || ""}
                onChange={(e) => setAddAmounts((prev) => ({ ...prev, [benefit.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddUsage(benefit);
                }}
              />
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => handleAddUsage(benefit)}>
                Add
              </Button>
            </div>
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
                      placeholder="Optional notes..."
                    />
                  </div>
                  <Button size="sm" className="h-7 text-xs" onClick={() => handleEdit(benefit.id)} disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button>
                </div>
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 flex-wrap">
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
                  <div className="flex gap-0.5">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => startEdit(benefit)} aria-label={`Edit ${benefit.benefit_name}`}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDelete(benefit.id)} aria-label={`Delete ${benefit.benefit_name}`}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
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
                      ${benefit.amount_used.toLocaleString()} / ${benefit.benefit_amount.toLocaleString()} spent
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

                {/* Quick add spending */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">+$</span>
                  <Input
                    className="h-7 w-20 text-sm"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={addAmounts[benefit.id] || ""}
                    onChange={(e) => setAddAmounts((prev) => ({ ...prev, [benefit.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddUsage(benefit);
                    }}
                  />
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => handleAddUsage(benefit)}>
                    Add
                  </Button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Add benefit form */}
      {showAddForm && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="text-sm font-medium">Add Benefit</h5>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowAddForm(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={addBenefitType} onValueChange={setAddBenefitType}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="credit">Credit</SelectItem>
                <SelectItem value="spend_threshold">Spend Threshold</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input className="h-8 text-sm" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder={addBenefitType === "spend_threshold" ? "e.g. Free Night Award" : "e.g. Uber Cash"} maxLength={100} />
            </div>
            <div>
              <Label className="text-xs">{addBenefitType === "spend_threshold" ? "Spend Required ($)" : "Amount ($)"}</Label>
              <Input className="h-8 text-sm" type="number" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} placeholder={addBenefitType === "spend_threshold" ? "15000" : "15"} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Frequency</Label>
              <Select value={addFrequency} onValueChange={setAddFrequency}>
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
              <Select value={addResetType} onValueChange={setAddResetType}>
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
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              maxLength={1000}
              placeholder="Optional notes..."
            />
            <span className="text-[10px] text-muted-foreground">{addNotes.length}/1000</span>
          </div>
          <Button size="sm" className="h-7 text-xs" onClick={handleAdd} disabled={submitting || !addName || !addAmount}>
            {submitting ? "Adding..." : "Add Benefit"}
          </Button>
        </div>
      )}
      </>}
    </div>
  );
}
