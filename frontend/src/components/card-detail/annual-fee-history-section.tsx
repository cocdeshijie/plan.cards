"use client";

import { useState } from "react";
import type { Card, CardEvent } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { updateEvent, deleteEvent, createCardEvent } from "@/lib/api";
import { parseIntStrict, parseDateStr, formatCurrency } from "@/lib/utils";
import { getNextFeeInfo } from "@/lib/fee-utils";
import { useToday } from "@/hooks/use-timezone";
import { toast } from "sonner";
import { format } from "date-fns";
import { DollarSign, Pencil, Check, X, Trash2, Plus, ChevronDown, Loader2 } from "lucide-react";

interface AnnualFeeHistorySectionProps {
  card: Card;
  accentTint: string;
  onUpdated: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onExpand: () => void;
}

// Row actions stay visible wherever hover cannot reveal them: always below sm,
// and at sm and up only on pointers that actually hover. Gating the reveal on
// `sm` alone hid them on an iPad in portrait (768px, no hover), where nothing
// short of blind-tapping brought them back. `sm:group-focus-within` keeps
// keyboard users from landing on an invisible control on the desktop path.
const ROW_ACTION_CLASS =
  "opacity-100 sm:[@media(hover:hover)]:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity inline-flex items-center justify-center rounded p-0.5 hover:bg-muted min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0";

// Collapse/expand headers are a single line of 14px text, which is a ~20px tap
// target. The negative margin gives the padding back to the layout so the header
// row keeps the height it had. Same string as benefits-section.tsx.
const SECTION_HEADER_CLASS =
  "flex items-center gap-2 text-left min-h-[44px] sm:min-h-0 py-2 -my-2";

function extractFee(event: CardEvent, cardAnnualFee: number | null): number {
  // Tier 1: metadata_json.annual_fee
  const meta = event.metadata_json as Record<string, unknown> | null;
  let amount: number | null = null;
  if (meta?.annual_fee != null) {
    amount = Number(meta.annual_fee);
  }
  if (amount === null && event.description) {
    // Tier 2: parse "$NNN" from description
    const match = event.description.match(/\$(\d+(?:,\d{3})*)/);
    if (match) amount = Number(match[1].replace(/,/g, ""));
  }
  if (amount === null) {
    // Tier 3: card's current annual fee. Previously an `else` on the
    // description branch, so any event WITH a description but no "$NNN" in it
    // never reached this fallback and rendered as $0 — e.g. adding an
    // "Annual Fee Posted" event with a note but a blank amount field.
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

export function AnnualFeeHistorySection({ card, accentTint, onUpdated, expanded, onToggleExpand, onExpand }: AnnualFeeHistorySectionProps) {
  const today = useToday();
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [editFeeValue, setEditFeeValue] = useState("");
  const [editDateValue, setEditDateValue] = useState<Date | undefined>();
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);
  // Separate from `saving`, which the add form and the edit row also set —
  // only this drives the armed row's "Deleting..." label.
  const [deleteInFlight, setDeleteInFlight] = useState(false);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addIsRefund, setAddIsRefund] = useState(false);
  const [addFeeValue, setAddFeeValue] = useState("");
  const [addDateValue, setAddDateValue] = useState<Date | undefined>();
  const [addDescription, setAddDescription] = useState("");

  const afEvents = card.events
    .filter((e) => e.event_type === "annual_fee_posted" || e.event_type === "annual_fee_refund")
    .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

  // Every other caller passes useToday() (local midnight in the configured
  // timezone). Omitting it here used wall-clock "now", so on the anniversary
  // itself the fallback loop advanced past a fee due today and this row showed
  // a year later than the tile and dashboard did.
  const nextFeeInfo = getNextFeeInfo(card.open_date, card.annual_fee, card.status, card.annual_fee_date, today);

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

  const resetAddForm = () => {
    setShowAddForm(false);
    setAddIsRefund(false);
    setAddFeeValue("");
    setAddDateValue(undefined);
    setAddDescription("");
  };

  const handleSave = async (event: CardEvent, newFee: number) => {
    // Same re-entrancy guard as handleAdd below: Enter is bound on two inputs
    // in this row and neither is covered by the Check button's disabled prop.
    if (saving) return;
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

  // Enter in either edit field commits the row, so the same validation the
  // Check button runs has to live here too — otherwise a stray decimal made
  // Enter do nothing at all with no explanation.
  const commitEdit = (event: CardEvent) => {
    if (!editFeeValue.trim()) {
      toast.error("Enter a fee amount");
      return;
    }
    const val = parseIntStrict(editFeeValue);
    if (val === null) {
      toast.error("Fee amount must be a whole dollar amount");
      return;
    }
    handleSave(event, val);
  };

  const handleDelete = async (eventId: number) => {
    if (saving) return;
    setSaving(true);
    setDeleteInFlight(true);

    try {
      await deleteEvent(eventId);
      setDeletingEventId(null);
      onUpdated();
      toast.success("Fee event deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete event");
    } finally {
      setSaving(false);
      setDeleteInFlight(false);
    }
  };

  const handleAdd = async () => {
    // `saving` must be checked HERE, not only in the button's disabled prop:
    // pressing Enter twice quickly in the amount field fired this twice and
    // created two identical annual_fee_posted events, which then double-counted
    // in the Total and in the dashboard's lifetime-fee sum.
    if (saving) return;
    const fee = parseIntStrict(addFeeValue);
    if (addFeeValue.trim() && fee === null) {
      toast.error("Fee amount must be a whole dollar amount");
      return;
    }
    // Both of these used to `return` silently while the Check button sat
    // disabled, so Enter (the natural gesture in the autofocused amount field)
    // looked like a dead key. The button is now enabled and both paths explain.
    if (fee === null) {
      toast.error("Enter a fee amount");
      return;
    }
    if (!addDateValue) {
      toast.error("Pick a date for this fee event");
      return;
    }
    setSaving(true);

    try {
      await createCardEvent(card.id, {
        event_type: addIsRefund ? "annual_fee_refund" : "annual_fee_posted",
        event_date: format(addDateValue, "yyyy-MM-dd"),
        description: addDescription || null,
        metadata_json: { annual_fee: fee },
      });
      resetAddForm();
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
        <button onClick={onToggleExpand} aria-expanded={expanded} className={SECTION_HEADER_CLASS}>
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!expanded ? "-rotate-90" : ""}`} />
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-medium text-sm">Annual Fee History</h4>
        </button>
        <div className="flex items-center gap-2">
          {totalFees !== 0 && (
            <Badge variant="secondary" className="text-xs">
              {hasNegatives ? "Net" : "Total"}: {formatCurrency(totalFees)}
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => { onExpand(); setShowAddForm(true); setEditingEventId(null); setDeletingEventId(null); }}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
      </div>

      {expanded && <div className="space-y-1">
        {/* A closed card has no upcoming fee, so a card with an annual fee but no
            posted events yet expanded to an empty box. Say so, like the three
            sibling sections do. */}
        {yearEntries.length === 0 && !nextFeeDate && !showAddForm && (
          <p className="text-sm text-muted-foreground">No annual fee events recorded.</p>
        )}

        {yearEntries.map(({ event, yearLabel, fee }) => {
          const isEditing = editingEventId === event.id;
          return (
            <div key={event.id} className="group flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/40">
              {isEditing ? (
                <div className="flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="w-12 shrink-0 text-xs text-muted-foreground">{yearLabel}</span>
                      {/* DatePicker defaults to w-full h-9; left alone it fought the
                          h-8 amount field beside it and tried to claim the row. */}
                      <DatePicker value={editDateValue} onChange={setEditDateValue} placeholder="Date" className="h-8 w-auto px-2 text-xs" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input
                        className="h-8 w-24 text-sm"
                        type="number"
                        inputMode="numeric"
                        aria-label={`${yearLabel} fee amount`}
                        value={editFeeValue}
                        onChange={(e) => setEditFeeValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(event);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        autoFocus
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
                        disabled={saving}
                        aria-label={`Save the ${yearLabel} fee event`}
                        onClick={() => commitEdit(event)}
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
                        disabled={saving}
                        aria-label={`Cancel editing the ${yearLabel} fee event`}
                        onClick={cancelEdit}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Description (optional)"
                    aria-label={`${yearLabel} fee description`}
                    maxLength={1000}
                    enterKeyHint="done"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(event);
                      if (e.key === "Escape") cancelEdit();
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="w-12 shrink-0 text-xs text-muted-foreground">{yearLabel}</span>
                      <span className="text-muted-foreground">
                        {formatFeeDate(event)}
                      </span>
                    </div>
                    {event.description && (
                      <span className="ml-[60px] text-xs text-muted-foreground/70">{event.description}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className={`text-sm font-medium ${fee < 0 ? "text-green-600 dark:text-green-400" : ""}`}>
                      {formatCurrency(fee)}
                    </span>
                    <button
                      onClick={() => startEdit(event, fee)}
                      className={ROW_ACTION_CLASS}
                      aria-label={`Edit the ${yearLabel} fee event`}
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                    {deletingEventId === event.id ? (
                      <>
                        {/* Stays armed until the request settles so the label can
                            say "Deleting...", the way the sibling sections do; the
                            row itself disappears on success. The accessible name
                            leads with "Delete" so it still contains the visible
                            text (WCAG 2.5.3). */}
                        <button
                          onClick={() => handleDelete(event.id)}
                          className="inline-flex min-h-[44px] items-center px-1 text-[10px] font-medium text-danger hover:underline sm:min-h-0"
                          disabled={saving}
                          aria-label={`Confirm delete the ${yearLabel} fee event`}
                        >
                          {deleteInFlight ? "Deleting..." : "Delete?"}
                        </button>
                        <button
                          onClick={() => setDeletingEventId(null)}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-0.5 hover:bg-muted sm:min-h-0 sm:min-w-0"
                          disabled={saving}
                          aria-label={`Keep the ${yearLabel} fee event`}
                        >
                          <X className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setDeletingEventId(event.id)}
                        className={ROW_ACTION_CLASS}
                        disabled={saving}
                        aria-label={`Delete the ${yearLabel} fee event`}
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-danger" />
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                {/* Two mutually exclusive toggle buttons: without aria-pressed a
                    screen reader announces two plain buttons and never says
                    which of Fee / Refund is currently selected. */}
                <div className="flex items-center bg-muted rounded-md p-0.5 text-xs">
                  <button
                    type="button"
                    aria-pressed={!addIsRefund}
                    className={`px-2 py-0.5 rounded transition-colors ${!addIsRefund ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setAddIsRefund(false)}
                  >
                    Fee
                  </button>
                  <button
                    type="button"
                    aria-pressed={addIsRefund}
                    className={`px-2 py-0.5 rounded transition-colors ${addIsRefund ? "bg-background shadow-sm font-medium text-green-600 dark:text-green-400" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setAddIsRefund(true)}
                  >
                    Refund
                  </button>
                </div>
                <DatePicker value={addDateValue} onChange={setAddDateValue} placeholder="Date" className="h-8 w-auto px-2 text-xs" />
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-8 w-24 text-sm"
                  type="number"
                  inputMode="numeric"
                  placeholder="Amount"
                  aria-label={addIsRefund ? "Refund amount" : "Fee amount"}
                  value={addFeeValue}
                  onChange={(e) => setAddFeeValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                    if (e.key === "Escape") resetAddForm();
                  }}
                  autoFocus
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
                  disabled={saving}
                  aria-label={addIsRefund ? "Add refund event" : "Add fee event"}
                  onClick={handleAdd}
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
                  disabled={saving}
                  aria-label="Cancel adding a fee event"
                  onClick={resetAddForm}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <Input
              className="h-8 text-xs"
              placeholder={addIsRefund ? "Description (e.g., Prorated refund, Retention credit)" : "Description (optional)"}
              aria-label="Description"
              maxLength={1000}
              enterKeyHint="done"
              value={addDescription}
              onChange={(e) => setAddDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") resetAddForm();
              }}
            />
          </div>
        )}

        {/* Upcoming fee row */}
        {nextFeeDate && (
          <>
            <div className="border-t border-dashed border-muted-foreground/20 mx-2" />
            {/* Italic alone marks this row as projected. The old opacity-60 sat on
                top of text-muted-foreground and dropped the line users scan for
                the next fee date to roughly 2.2:1. */}
            <div className="flex items-center justify-between rounded-md px-2 py-1.5 italic">
              <div className="flex items-center gap-3 text-sm">
                <span className="w-12 shrink-0 text-xs text-muted-foreground">Year {nextYearNumber}</span>
                <span className="text-muted-foreground">
                  ~{format(nextFeeDate, "MMM yyyy")}
                </span>
              </div>
              <span className="text-sm font-medium text-muted-foreground">{formatCurrency(card.annual_fee ?? 0)}</span>
            </div>
          </>
        )}
      </div>}
    </div>
  );
}
