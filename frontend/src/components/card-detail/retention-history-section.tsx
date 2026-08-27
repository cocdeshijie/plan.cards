"use client";

import { useId, useState } from "react";
import type { Card, CardEvent, CardBonus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Switch } from "@/components/ui/switch";
import { updateEvent, deleteEvent, createRetentionOffer, createBonus, updateBonus, deleteBonus } from "@/lib/api";
import { formatCurrency, formatDate, parseIntStrict, parseDateStr } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { Gift, Pencil, Check, X, Trash2, Plus, ChevronDown } from "lucide-react";

interface RetentionHistorySectionProps {
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

/**
 * Parse a whole-number offer field, distinguishing "cleared" from "invalid".
 *
 * `parseIntStrict` returns null for BOTH an empty field and a non-integer like
 * "30000.5", and every caller here treated that null as "no value" — so a
 * stray decimal saved the offer with its amount silently gone, leaving the row
 * reading "No offer details". Empty still means cleared; anything unparseable
 * throws so the caller's catch surfaces the reason in the error banner.
 */
function parseOfferField(raw: string, label: string): number | null {
  if (!raw.trim()) return null; // explicitly cleared
  const num = parseIntStrict(raw);
  if (num === null) throw new Error(`${label} must be a whole number`);
  return num;
}

function formatOfferDetails(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  // Locale pinned to match formatCurrency: on a de-DE browser the two halves of
  // this string would otherwise group digits differently in the same sentence.
  if (meta.offer_points) parts.push(`${Number(meta.offer_points).toLocaleString("en-US")} points`);
  if (meta.offer_credit) parts.push(`${formatCurrency(Number(meta.offer_credit))} credit`);
  return parts.length > 0 ? parts.join(" + ") : "No offer details";
}

function findLinkedBonus(card: Card, eventId: number): CardBonus | undefined {
  return card.bonuses?.find((b) => b.event_id === eventId);
}

/** Human-readable summary of what a linked bonus is tracking, for the confirm copy. */
function describeBonus(bonus: CardBonus): string {
  const bits: string[] = [];
  if (bonus.spend_requirement) bits.push(`${formatCurrency(bonus.spend_requirement)} of spend`);
  if (bonus.spend_deadline) bits.push(`due ${formatDate(bonus.spend_deadline)}`);
  return bits.length > 0 ? ` (${bits.join(", ")})` : "";
}

export function RetentionHistorySection({ card, accentTint, onUpdated, expanded, onToggleExpand, onExpand }: RetentionHistorySectionProps) {
  // One id prefix per form. Radix's Label creates no implicit association and
  // neither form wraps its controls, so without these every field announced
  // unlabelled and clicking a label focused nothing.
  const addId = useId();
  const editId = useId();

  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState<Date | undefined>();
  const [editPoints, setEditPoints] = useState("");
  const [editCredit, setEditCredit] = useState("");
  const [editAccepted, setEditAccepted] = useState(true);
  const [editDescription, setEditDescription] = useState("");
  const [editHasSpend, setEditHasSpend] = useState(false);
  const [editSpendReq, setEditSpendReq] = useState("");
  const [editSpendDeadline, setEditSpendDeadline] = useState<Date | undefined>();
  const [editSpendNotes, setEditSpendNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);
  // Separate from `saving`, which the add and edit forms also set — only
  // this drives the armed row's "Deleting..." label.
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  // Set when saving an edit would destroy the offer's linked bonus, so the
  // deletion goes through an explicit confirm instead of happening silently.
  const [pendingBonusDelete, setPendingBonusDelete] = useState<{ event: CardEvent; bonus: CardBonus } | null>(null);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDate, setAddDate] = useState<Date | undefined>();
  const [addPoints, setAddPoints] = useState("");
  const [addCredit, setAddCredit] = useState("");
  const [addAccepted, setAddAccepted] = useState(true);
  const [addDescription, setAddDescription] = useState("");
  const [addSpendReq, setAddSpendReq] = useState("");
  const [addSpendDeadline, setAddSpendDeadline] = useState<Date | undefined>();
  const [addSpendNotes, setAddSpendNotes] = useState("");
  const [addHasSpend, setAddHasSpend] = useState(false);

  const retentionEvents = card.events
    .filter((e) => e.event_type === "retention_offer")
    .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime());

  const handleAdd = async () => {
    if (saving) return;
    if (!addDate) {
      setError("Pick a date for this offer.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const points = parseOfferField(addPoints, "Points");
      const credit = parseOfferField(addCredit, "Credit");
      const spendReq = addHasSpend && addAccepted ? parseOfferField(addSpendReq, "Spend") : null;

      await createRetentionOffer(card.id, {
        event_date: format(addDate, "yyyy-MM-dd"),
        offer_points: points,
        offer_credit: credit,
        accepted: addAccepted,
        description: addDescription || null,
        spend_requirement: spendReq,
        spend_deadline: addHasSpend && addAccepted && addSpendDeadline ? format(addSpendDeadline, "yyyy-MM-dd") : null,
        spend_reminder_notes: addHasSpend && addAccepted && addSpendNotes ? addSpendNotes : null,
      });
      resetAddForm();
      onUpdated();
      toast.success("Retention offer added");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add retention offer");
    } finally {
      setSaving(false);
    }
  };

  const resetAddForm = () => {
    setShowAddForm(false);
    setAddDate(undefined);
    setAddPoints("");
    setAddCredit("");
    setAddAccepted(true);
    setAddDescription("");
    setAddSpendReq("");
    setAddSpendDeadline(undefined);
    setAddSpendNotes("");
    setAddHasSpend(false);
    // The banner is rendered outside the form, so closing the form used to
    // leave a stale failure sitting above an empty section.
    setError(null);
  };

  /**
   * Commit an edit. `allowBonusDelete` is only ever true on the far side of the
   * confirm dialog — see handleSave.
   */
  const performSave = async (event: CardEvent, allowBonusDelete: boolean) => {
    if (saving) return;
    if (!editDate) {
      setError("Pick a date for this offer.");
      return;
    }
    setSaving(true);
    setError(null);
    // The event write commits before the bonus writes. If a later step fails we
    // still have to refresh, or the user is looking at stale data under a
    // message that reads as "nothing saved".
    let eventSaved = false;
    try {
      // Parse everything up front so an unparseable field aborts before the
      // first write instead of half-applying.
      const points = parseOfferField(editPoints, "Points");
      const credit = parseOfferField(editCredit, "Credit");
      // Only parsed when the spend section is actually in play — otherwise a
      // stale value left behind by toggling the section off would abort a save
      // over a field the user can no longer see. Matches handleAdd.
      const spendReq = editAccepted && editHasSpend ? parseOfferField(editSpendReq, "Spend") : null;

      const metadata: Record<string, unknown> = { accepted: editAccepted };
      if (points !== null) metadata.offer_points = points;
      if (credit !== null) metadata.offer_credit = credit;

      await updateEvent(event.id, {
        event_date: format(editDate, "yyyy-MM-dd"),
        description: editDescription || null,
        metadata_json: metadata,
      });
      eventSaved = true;

      // Handle bonus CRUD based on spend fields
      const linkedBonus = findLinkedBonus(card, event.id);

      if (editAccepted && editHasSpend && spendReq !== null) {
        const bonusData = {
          spend_requirement: spendReq,
          spend_deadline: editSpendDeadline ? format(editSpendDeadline, "yyyy-MM-dd") : null,
          spend_reminder_enabled: !!editSpendDeadline,
          spend_reminder_notes: editSpendNotes || null,
          // Mirrors the backend's own retention path: an offer carrying both
          // points and a credit keeps the credit in bonus_credit_amount rather
          // than having it dropped by a `points || credit` fallback.
          bonus_amount: points ?? credit,
          bonus_credit_amount: points !== null && credit !== null ? credit : null,
          bonus_type: points !== null ? "points" : (credit !== null ? "credit" : null),
        };
        if (linkedBonus) {
          await updateBonus(linkedBonus.id, bonusData);
        } else {
          await createBonus(card.id, {
            ...bonusData,
            bonus_source: "retention",
            event_id: event.id,
            description: `Retention: ${formatOfferDetails(metadata)} — ${card.card_name}`,
          });
        }
      } else if (linkedBonus && allowBonusDelete) {
        // Spend removed or declined — confirmed by the user in handleSave.
        await deleteBonus(linkedBonus.id);
      }

      cancelEdit();
      onUpdated();
      toast.success("Retention offer updated");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to update retention offer";
      setError(eventSaved ? `Offer saved, but its spend tracker did not: ${message}` : message);
      if (eventSaved) onUpdated();
    } finally {
      setSaving(false);
    }
  };

  const handleSave = (event: CardEvent) => {
    if (saving) return;
    // Checked here as well as in performSave so a missing date is reported
    // before the confirm below, not after the user has agreed to it.
    if (!editDate) {
      setError("Pick a date for this offer.");
      return;
    }
    const linkedBonus = findLinkedBonus(card, event.id);
    const keepsBonus = editAccepted && editHasSpend && !!editSpendReq.trim();
    if (linkedBonus && !keepsBonus) {
      // Clearing Spend ($), switching the spend section off, or flipping
      // Accepted to Declined used to delete the linked bonus outright — its
      // deadline and reminder with it — behind a green "Retention offer
      // updated". Every other destructive action in this section is two-step;
      // this one now is too.
      setPendingBonusDelete({ event, bonus: linkedBonus });
      return;
    }
    void performSave(event, false);
  };

  const handleDelete = async (eventId: number) => {
    if (saving) return;
    setSaving(true);
    setDeleteInFlight(true);
    setError(null);
    try {
      await deleteEvent(eventId);
      setDeletingEventId(null);
      onUpdated();
      toast.success("Retention offer deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete event");
    } finally {
      setSaving(false);
      setDeleteInFlight(false);
    }
  };

  const startEdit = (event: CardEvent) => {
    const meta = (event.metadata_json as Record<string, unknown>) || {};
    const linkedBonus = findLinkedBonus(card, event.id);
    setEditingEventId(event.id);
    setDeletingEventId(null);
    setEditDate(parseDateStr(event.event_date));
    setEditPoints(meta.offer_points ? String(meta.offer_points) : "");
    setEditCredit(meta.offer_credit ? String(meta.offer_credit) : "");
    setEditAccepted(meta.accepted !== false);
    setEditDescription(event.description || "");
    if (linkedBonus) {
      setEditHasSpend(true);
      setEditSpendReq(linkedBonus.spend_requirement ? String(linkedBonus.spend_requirement) : "");
      setEditSpendDeadline(linkedBonus.spend_deadline ? parseDateStr(linkedBonus.spend_deadline) : undefined);
      setEditSpendNotes(linkedBonus.spend_reminder_notes || "");
    } else {
      setEditHasSpend(false);
      setEditSpendReq("");
      setEditSpendDeadline(undefined);
      setEditSpendNotes("");
    }
  };

  const cancelEdit = () => {
    setEditingEventId(null);
    setEditDate(undefined);
    setEditPoints("");
    setEditCredit("");
    setEditAccepted(true);
    setEditDescription("");
    setEditHasSpend(false);
    setEditSpendReq("");
    setEditSpendDeadline(undefined);
    setEditSpendNotes("");
    setError(null);
  };

  return (
    <div className="space-y-3">
      <div className="h-px" style={{ backgroundColor: accentTint }} />
      <div className="flex items-center justify-between">
        <button onClick={onToggleExpand} aria-expanded={expanded} className={SECTION_HEADER_CLASS}>
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!expanded ? "-rotate-90" : ""}`} />
          <Gift className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-medium text-sm">Retention History</h4>
        </button>
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

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-2 text-xs text-danger flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 hover:opacity-70" aria-label="Dismiss error"><X className="h-3 w-3" /></button>
        </div>
      )}

      {expanded && <>
      {retentionEvents.length === 0 && !showAddForm && (
        <p className="text-sm text-muted-foreground">No retention offers recorded.</p>
      )}

      <div className="space-y-1">
        {/* Add new retention offer form */}
        {showAddForm && (
          <div className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {/* DatePicker takes no id, so the label names the group instead of
                  pointing at a control that cannot carry the association. */}
              <div className="space-y-1" role="group" aria-labelledby={`${addId}-date-label`}>
                <Label id={`${addId}-date-label`} className="text-xs">Date</Label>
                <DatePicker value={addDate} onChange={setAddDate} placeholder="Date" />
              </div>
              <div className="flex items-center gap-2 pt-5">
                {/* The text beside this switch is its STATE, not its name, so the
                    Switch carries an aria-label and this stays a plain <span> —
                    a <Label> here would be a caption bound to no control. */}
                <Switch checked={addAccepted} onCheckedChange={setAddAccepted} aria-label="Offer accepted" />
                <span className="text-xs font-normal leading-snug">{addAccepted ? "Accepted" : "Declined"}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor={`${addId}-points`} className="text-xs">Points</Label>
                <Input id={`${addId}-points`} className="h-7 text-sm" type="number" inputMode="numeric" min="1" value={addPoints} onChange={(e) => setAddPoints(e.target.value)} placeholder="e.g. 30000" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${addId}-credit`} className="text-xs">Credit ($)</Label>
                <Input id={`${addId}-credit`} className="h-7 text-sm" type="number" inputMode="numeric" min="1" value={addCredit} onChange={(e) => setAddCredit(e.target.value)} placeholder="e.g. 75" />
              </div>
            </div>
            <Input
              id={`${addId}-description`}
              className="h-7 text-xs"
              placeholder="Description (optional)"
              aria-label="Description"
              maxLength={1000}
              enterKeyHint="done"
              value={addDescription}
              onChange={(e) => setAddDescription(e.target.value)}
            />

            {/* Spend requirement section (only for accepted offers) */}
            {addAccepted && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Switch id={`${addId}-hasspend`} checked={addHasSpend} onCheckedChange={setAddHasSpend} />
                  <Label htmlFor={`${addId}-hasspend`} className="text-xs font-normal">Spend requirement</Label>
                </div>
                {addHasSpend && (
                  <div className="rounded-lg border bg-muted/20 p-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`${addId}-spend`} className="text-xs">Spend ($)</Label>
                        <Input id={`${addId}-spend`} className="h-7 text-sm" type="number" inputMode="numeric" min="1" value={addSpendReq} onChange={(e) => setAddSpendReq(e.target.value)} placeholder="e.g. 3000" />
                      </div>
                      <div className="space-y-1" role="group" aria-labelledby={`${addId}-deadline-label`}>
                        <Label id={`${addId}-deadline-label`} className="text-xs">Deadline</Label>
                        <DatePicker value={addSpendDeadline} onChange={setAddSpendDeadline} placeholder="Deadline" />
                      </div>
                    </div>
                    <Input
                      id={`${addId}-spendnotes`}
                      className="h-7 text-xs"
                      placeholder="Spend notes (optional)"
                      aria-label="Spend notes"
                      maxLength={1000}
                      enterKeyHint="done"
                      value={addSpendNotes}
                      onChange={(e) => setAddSpendNotes(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving || !addDate} onClick={handleAdd}>
                <Check className="h-3 w-3 mr-1" />{saving ? "Adding..." : "Add"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={resetAddForm}>
                <X className="h-3 w-3 mr-1" />Cancel
              </Button>
            </div>
          </div>
        )}

        {retentionEvents.map((event) => {
          const meta = (event.metadata_json as Record<string, unknown>) || {};
          const isEditing = editingEventId === event.id;
          const accepted = meta.accepted !== false;
          const linkedBonus = findLinkedBonus(card, event.id);
          const offerLabel = `${formatDate(event.event_date)} retention offer`;

          return (
            <div key={event.id} className="group flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/40">
              {isEditing ? (
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1" role="group" aria-labelledby={`${editId}-date-label`}>
                      <Label id={`${editId}-date-label`} className="text-xs">Date</Label>
                      <DatePicker value={editDate} onChange={setEditDate} placeholder="Date" />
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      {/* State, not a name — see the add form above. */}
                      <Switch checked={editAccepted} onCheckedChange={setEditAccepted} aria-label="Offer accepted" />
                      <span className="text-xs font-normal leading-snug">{editAccepted ? "Accepted" : "Declined"}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`${editId}-points`} className="text-xs">Points</Label>
                      <Input id={`${editId}-points`} className="h-7 text-sm" type="number" inputMode="numeric" min="1" value={editPoints} onChange={(e) => setEditPoints(e.target.value)} placeholder="e.g. 30000" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${editId}-credit`} className="text-xs">Credit ($)</Label>
                      <Input id={`${editId}-credit`} className="h-7 text-sm" type="number" inputMode="numeric" min="1" value={editCredit} onChange={(e) => setEditCredit(e.target.value)} placeholder="e.g. 75" />
                    </div>
                  </div>
                  <Input
                    id={`${editId}-description`}
                    className="h-7 text-xs"
                    placeholder="Description (optional)"
                    aria-label="Description"
                    maxLength={1000}
                    enterKeyHint="done"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />

                  {/* Spend requirement section (only for accepted offers) */}
                  {editAccepted && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Switch id={`${editId}-hasspend`} checked={editHasSpend} onCheckedChange={setEditHasSpend} />
                        <Label htmlFor={`${editId}-hasspend`} className="text-xs font-normal">Spend requirement</Label>
                      </div>
                      {editHasSpend && (
                        <div className="rounded-lg border bg-muted/20 p-2 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label htmlFor={`${editId}-spend`} className="text-xs">Spend ($)</Label>
                              <Input id={`${editId}-spend`} className="h-7 text-sm" type="number" inputMode="numeric" min="1" value={editSpendReq} onChange={(e) => setEditSpendReq(e.target.value)} placeholder="e.g. 3000" />
                            </div>
                            <div className="space-y-1" role="group" aria-labelledby={`${editId}-deadline-label`}>
                              <Label id={`${editId}-deadline-label`} className="text-xs">Deadline</Label>
                              <DatePicker value={editSpendDeadline} onChange={setEditSpendDeadline} placeholder="Deadline" />
                            </div>
                          </div>
                          <Input
                            id={`${editId}-spendnotes`}
                            className="h-7 text-xs"
                            placeholder="Spend notes (optional)"
                            aria-label="Spend notes"
                            maxLength={1000}
                            enterKeyHint="done"
                            value={editSpendNotes}
                            onChange={(e) => setEditSpendNotes(e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={() => handleSave(event)}>
                      <Check className="h-3 w-3 mr-1" />{saving ? "Saving..." : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={cancelEdit}>
                      <X className="h-3 w-3 mr-1" />Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {/* Wraps: below sm the date, the offer summary and two badges
                        do not fit on one line in the drawer, and without this the
                        date itself was breaking across three lines. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="text-muted-foreground text-xs">{formatDate(event.event_date)}</span>
                      <span className="font-medium text-sm">{formatOfferDetails(meta)}</span>
                      <Badge
                        variant={accepted ? "success" : "secondary"}
                        className="shrink-0 text-[10px]"
                      >
                        {accepted ? "Accepted" : "Declined"}
                      </Badge>
                      {linkedBonus && (
                        <Badge
                          variant={linkedBonus.bonus_earned ? "success" : "outline"}
                          className="shrink-0 text-[10px]"
                        >
                          {linkedBonus.bonus_earned ? "Earned" : "Tracking"}
                        </Badge>
                      )}
                    </div>
                    {event.description && (
                      <span className="text-xs text-muted-foreground/70 ml-0">{event.description}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => startEdit(event)}
                      className={ROW_ACTION_CLASS}
                      aria-label={`Edit the ${offerLabel}`}
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
                          aria-label={`Confirm delete the ${offerLabel}`}
                        >
                          {deleteInFlight ? "Deleting..." : "Delete?"}
                        </button>
                        <button
                          onClick={() => setDeletingEventId(null)}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-0.5 hover:bg-muted sm:min-h-0 sm:min-w-0"
                          disabled={saving}
                          aria-label={`Keep the ${offerLabel}`}
                        >
                          <X className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setDeletingEventId(event.id)}
                        className={ROW_ACTION_CLASS}
                        disabled={saving}
                        aria-label={`Delete the ${offerLabel}`}
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

      </div>
      </>}

      <ConfirmDialog
        open={pendingBonusDelete !== null}
        onOpenChange={(next) => { if (!next) setPendingBonusDelete(null); }}
        title="Remove the spend tracker?"
        description={
          pendingBonusDelete
            ? `Saving without a spend requirement deletes this offer's spend tracker${describeBonus(pendingBonusDelete.bonus)}, along with its deadline and reminder. The retention offer itself is kept.`
            : ""
        }
        variant="destructive"
        confirmLabel="Save and remove"
        pendingLabel="Saving..."
        onConfirm={async () => {
          const target = pendingBonusDelete;
          if (!target) return;
          try {
            await performSave(target.event, true);
          } finally {
            setPendingBonusDelete(null);
          }
        }}
      />
    </div>
  );
}
