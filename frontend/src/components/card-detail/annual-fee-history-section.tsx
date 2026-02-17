"use client";

import { useState } from "react";
import type { Card, CardEvent } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { updateEvent, deleteEvent, createCardEvent } from "@/lib/api";
import { parseIntStrict, parseDateStr } from "@/lib/utils";
import { getNextFeeInfo } from "@/lib/fee-utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { DollarSign, Pencil, Check, X, Trash2, Plus, ChevronDown } from "lucide-react";

interface AnnualFeeHistorySectionProps {
  card: Card;
  accentTint: string;
  onUpdated: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onExpand: () => void;
}

function extractFee(event: CardEvent, cardAnnualFee: number | null): number {
  // Tier 1: metadata_json.annual_fee
  const meta = event.metadata_json as Record<string, unknown> | null;
  let amount = 0;
  if (meta?.annual_fee != null) {
    amount = Number(meta.annual_fee);
  } else if (event.description) {
    // Tier 2: parse "$NNN" from description
    const match = event.description.match(/\$(\d+(?:,\d{3})*)/);
    if (match) amount = Number(match[1].replace(/,/g, ""));
  } else {
    // Tier 3: card's current annual fee
    amount = cardAnnualFee ?? 0;
  }
  // Refund events store positive amounts but are treated as negative
  if (event.event_type === "annual_fee_refund") return -Math.abs(amount);
  return amount;
}

function isApproximate(event: CardEvent): boolean {
  const meta = event.metadata_json as Record<string, unknown> | null;
  return !!meta?.approximate_date;
}

function formatFeeDate(event: CardEvent): string {
  const d = parseDateStr(event.event_date);
  if (isApproximate(event)) {
    return "~" + format(d, "MMM yyyy");
  }
  return format(d, "MMM d, yyyy");
}

function formatFeeAmount(amount: number): string {
  if (amount < 0) return `-$${Math.abs(amount).toLocaleString()}`;
  return `$${amount.toLocaleString()}`;
}

export function AnnualFeeHistorySection({ card, accentTint, onUpdated, expanded, onToggleExpand, onExpand }: AnnualFeeHistorySectionProps) {
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [editFeeValue, setEditFeeValue] = useState("");
  const [editDateValue, setEditDateValue] = useState<Date | undefined>();
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addIsRefund, setAddIsRefund] = useState(false);
  const [addFeeValue, setAddFeeValue] = useState("");
  const [addDateValue, setAddDateValue] = useState<Date | undefined>();
  const [addDescription, setAddDescription] = useState("");

  const afEvents = card.events
    .filter((e) => e.event_type === "annual_fee_posted" || e.event_type === "annual_fee_refund")
    .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

  const nextFeeInfo = getNextFeeInfo(card.open_date, card.annual_fee, card.status, card.annual_fee_date);

  const openYear = card.open_date
    ? parseDateStr(card.open_date).getFullYear()
    : null;

  const yearEntries = afEvents.map((event, i) => ({
    event,
    yearLabel: event.event_type === "annual_fee_refund"
      ? "Refund"
      : openYear != null
        ? `Year ${parseDateStr(event.event_date).getFullYear() - openYear + 1}`
        : `Year ${i + 1}`,
    fee: extractFee(event, card.annual_fee),
    date: event.event_date,
  }));

  const totalFees = yearEntries.reduce((sum, e) => sum + e.fee, 0);
  const hasNegatives = yearEntries.some((e) => e.fee < 0);

  // Show section if there are AF events, an upcoming fee, or the card has a positive AF
  if (afEvents.length === 0 && !nextFeeInfo && (!card.annual_fee || card.annual_fee <= 0)) return null;

  const nextFeeDate = nextFeeInfo?.nextDate ?? null;

  const handleSave = async (event: CardEvent, newFee: number) => {
    setSaving(true);

    try {
      const existingMeta = (event.metadata_json as Record<string, unknown>) || {};
      const { approximate_date: _, ...cleanMeta } = existingMeta;
      const updates: Record<string, unknown> = {
        metadata_json: { ...cleanMeta, annual_fee: newFee },
      };
      if (editDateValue) {
        updates.event_date = format(editDateValue, "yyyy-MM-dd");
      }
      if (editDescription !== (event.description || "")) {
        updates.description = editDescription || null;
      }
      await updateEvent(event.id, updates);
      setEditingEventId(null);
      setEditFeeValue("");
      setEditDateValue(undefined);
      setEditDescription("");
      onUpdated();
      toast.success("Fee event updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update fee");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (eventId: number) => {
    setSaving(true);

    try {
      await deleteEvent(eventId);
      onUpdated();
      toast.success("Fee event deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete event");
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    const fee = parseIntStrict(addFeeValue);
    if (fee === null || !addDateValue) return;
    setSaving(true);

    try {
      await createCardEvent(card.id, {
        event_type: addIsRefund ? "annual_fee_refund" : "annual_fee_posted",
        event_date: format(addDateValue, "yyyy-MM-dd"),
        description: addDescription || null,
        metadata_json: { annual_fee: fee },
      });
      setShowAddForm(false);
      setAddIsRefund(false);
      setAddFeeValue("");
      setAddDateValue(undefined);
      setAddDescription("");
      onUpdated();
      toast.success("Fee event added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add event");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (event: CardEvent, currentFee: number) => {
    setEditingEventId(event.id);
    setDeletingEventId(null);
    setEditFeeValue(String(Math.abs(currentFee)));
    setEditDateValue(parseDateStr(event.event_date));
    setEditDescription(event.description || "");
  };

  const cancelEdit = () => {
    setEditingEventId(null);
    setEditFeeValue("");
    setEditDateValue(undefined);
    setEditDescription("");
  };

  const feeOnlyEntries = yearEntries.filter((e) => e.event.event_type !== "annual_fee_refund");
  const nextYearNumber = (openYear != null && nextFeeDate)
    ? nextFeeDate.getFullYear() - openYear + 1
    : feeOnlyEntries.length + 1;

  return (
    <div className="space-y-3">
      <div className="h-px" style={{ backgroundColor: accentTint }} />
      <div className="flex items-center justify-between">
        <button onClick={onToggleExpand} aria-expanded={expanded} className="flex items-center gap-2">
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!expanded ? "-rotate-90" : ""}`} />
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-medium text-sm">Annual Fee History</h4>
        </button>
        <div className="flex items-center gap-2">
          {totalFees !== 0 && (
            <Badge variant="secondary" className="text-xs">
              {hasNegatives ? "Net" : "Total"}: {formatFeeAmount(totalFees)}
            </Badge>
          )}
          <button
            onClick={() => { onExpand(); setShowAddForm(true); setEditingEventId(null); }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>
      </div>

      {expanded && <div className="space-y-1">
        {yearEntries.map(({ event, yearLabel, fee }) => {
          const isEditing = editingEventId === event.id;
          return (
            <div key={event.id} className="group flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/40">
              {isEditing ? (
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground w-12">{yearLabel}</span>
                      <DatePicker value={editDateValue} onChange={setEditDateValue} placeholder="Date" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input
                        className="h-7 w-20 text-sm"
                        type="number"
                        value={editFeeValue}
                        onChange={(e) => setEditFeeValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const val = parseIntStrict(editFeeValue);
                            if (val !== null) handleSave(event, val);
                          }
                          if (e.key === "Escape") cancelEdit();
                        }}
                        autoFocus
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        disabled={saving}
                        onClick={() => {
                          const val = parseIntStrict(editFeeValue);
                          if (val !== null) handleSave(event, val);
                        }}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={cancelEdit}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <Input
                    className="h-7 text-xs"
                    placeholder="Description (optional)"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = parseIntStrict(editFeeValue);
                        if (val !== null) handleSave(event, val);
                      }
                      if (e.key === "Escape") cancelEdit();
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-xs text-muted-foreground w-12">{yearLabel}</span>
                      <span className="text-muted-foreground">
                        {formatFeeDate(event)}
                      </span>
                    </div>
                    {event.description && (
                      <span className="text-xs text-muted-foreground/70 ml-[60px]">{event.description}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-medium ${fee < 0 ? "text-green-600 dark:text-green-400" : ""}`}>
                      {formatFeeAmount(fee)}
                    </span>
                    <button
                      onClick={() => startEdit(event, fee)}
                      className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                      aria-label="Edit fee event"
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                    {deletingEventId === event.id ? (
                      <>
                        <button
                          onClick={() => { handleDelete(event.id); setDeletingEventId(null); }}
                          className="text-[10px] text-destructive font-medium px-1 hover:underline"
                          disabled={saving}
                        >
                          Delete?
                        </button>
                        <button
                          onClick={() => setDeletingEventId(null)}
                          className="p-0.5 rounded hover:bg-muted"
                        >
                          <X className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setDeletingEventId(event.id)}
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                        disabled={saving}
                        aria-label="Delete fee event"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Add new AF event form */}
        {showAddForm && (
          <div className="rounded-md border border-dashed border-muted-foreground/30 px-2 py-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <div className="flex items-center bg-muted rounded-md p-0.5 text-xs">
                  <button
                    className={`px-2 py-0.5 rounded transition-colors ${!addIsRefund ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setAddIsRefund(false)}
                  >
                    Fee
                  </button>
                  <button
                    className={`px-2 py-0.5 rounded transition-colors ${addIsRefund ? "bg-background shadow-sm font-medium text-green-600 dark:text-green-400" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setAddIsRefund(true)}
                  >
                    Refund
                  </button>
                </div>
                <DatePicker value={addDateValue} onChange={setAddDateValue} placeholder="Date" />
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-7 w-20 text-sm"
                  type="number"
                  placeholder="Amount"
                  value={addFeeValue}
                  onChange={(e) => setAddFeeValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                    if (e.key === "Escape") { setShowAddForm(false); setAddIsRefund(false); setAddFeeValue(""); setAddDateValue(undefined); setAddDescription(""); }
                  }}
                  autoFocus
                />
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={saving || !addDateValue || !addFeeValue} onClick={handleAdd}>
                  <Check className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setShowAddForm(false); setAddIsRefund(false); setAddFeeValue(""); setAddDateValue(undefined); setAddDescription(""); }}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <Input
              className="h-7 text-xs"
              placeholder={addIsRefund ? "Description (e.g., Prorated refund, Retention credit)" : "Description (optional)"}
              value={addDescription}
              onChange={(e) => setAddDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") { setShowAddForm(false); setAddIsRefund(false); setAddFeeValue(""); setAddDateValue(undefined); setAddDescription(""); }
              }}
            />
          </div>
        )}

        {/* Upcoming fee row */}
        {nextFeeDate && (
          <>
            <div className="border-t border-dashed border-muted-foreground/20 mx-2" />
            <div className="flex items-center justify-between rounded-md px-2 py-1.5 opacity-60 italic">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-xs text-muted-foreground w-12">Year {nextYearNumber}</span>
                <span className="text-muted-foreground">
                  ~{format(nextFeeDate, "MMM yyyy")}
                </span>
              </div>
              <span className="text-sm font-medium">{formatFeeAmount(card.annual_fee ?? 0)}</span>
            </div>
          </>
        )}
      </div>}
    </div>
  );
}
