"use client";

import { useState } from "react";
import type { Card, CardEvent, CardBonus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Switch } from "@/components/ui/switch";
import { updateEvent, deleteEvent, createRetentionOffer, createBonus, updateBonus, deleteBonus } from "@/lib/api";
import { formatDate, parseIntStrict } from "@/lib/utils";
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

function formatOfferDetails(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (meta.offer_points) parts.push(`${Number(meta.offer_points).toLocaleString()} points`);
  if (meta.offer_credit) parts.push(`$${Number(meta.offer_credit)} credit`);
  return parts.length > 0 ? parts.join(" + ") : "No offer details";
}

function findLinkedBonus(card: Card, eventId: number): CardBonus | undefined {
  return card.bonuses?.find((b) => b.event_id === eventId);
}

export function RetentionHistorySection({ card, accentTint, onUpdated, expanded, onToggleExpand, onExpand }: RetentionHistorySectionProps) {
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
    if (!addDate) return;
    setSaving(true);
    setError(null);
    try {
      await createRetentionOffer(card.id, {
        event_date: format(addDate, "yyyy-MM-dd"),
        offer_points: addPoints ? parseIntStrict(addPoints) : null,
        offer_credit: addCredit ? parseIntStrict(addCredit) : null,
        accepted: addAccepted,
        description: addDescription || null,
        spend_requirement: addHasSpend && addAccepted && addSpendReq ? parseIntStrict(addSpendReq) : null,
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
  };

  const handleSave = async (event: CardEvent) => {
    if (!editDate) return;
    setSaving(true);
    setError(null);
    try {
      const metadata: Record<string, unknown> = { accepted: editAccepted };
      if (editPoints) metadata.offer_points = parseIntStrict(editPoints);
      if (editCredit) metadata.offer_credit = parseIntStrict(editCredit);

      await updateEvent(event.id, {
        event_date: format(editDate, "yyyy-MM-dd"),
        description: editDescription || null,
        metadata_json: metadata,
      });

      // Handle bonus CRUD based on spend fields
      const linkedBonus = findLinkedBonus(card, event.id);

      if (editAccepted && editHasSpend && editSpendReq) {
        const bonusData = {
          spend_requirement: parseIntStrict(editSpendReq),
          spend_deadline: editSpendDeadline ? format(editSpendDeadline, "yyyy-MM-dd") : null,
          spend_reminder_enabled: !!(editSpendReq && editSpendDeadline),
          spend_reminder_notes: editSpendNotes || null,
          bonus_amount: editPoints ? parseIntStrict(editPoints) : (editCredit ? parseIntStrict(editCredit) : null),
          bonus_type: editPoints ? "points" : (editCredit ? "credit" : null),
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
      } else if (linkedBonus) {
        // Spend removed or declined — delete bonus
        await deleteBonus(linkedBonus.id);
      }

      cancelEdit();
      onUpdated();
      toast.success("Retention offer updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update retention offer");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (eventId: number) => {
    setSaving(true);
    setError(null);
    try {
      await deleteEvent(eventId);
      onUpdated();
      toast.success("Retention offer deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete event");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (event: CardEvent) => {
    const meta = (event.metadata_json as Record<string, unknown>) || {};
    const linkedBonus = findLinkedBonus(card, event.id);
    setEditingEventId(event.id);
    setDeletingEventId(null);
    setEditDate(new Date(event.event_date + "T00:00:00"));
    setEditPoints(meta.offer_points ? String(meta.offer_points) : "");
    setEditCredit(meta.offer_credit ? String(meta.offer_credit) : "");
    setEditAccepted(meta.accepted !== false);
    setEditDescription(event.description || "");
    if (linkedBonus) {
      setEditHasSpend(true);
      setEditSpendReq(linkedBonus.spend_requirement ? String(linkedBonus.spend_requirement) : "");
      setEditSpendDeadline(linkedBonus.spend_deadline ? new Date(linkedBonus.spend_deadline + "T00:00:00") : undefined);
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
  };

  return (
    <div className="space-y-3">
      <div className="h-px" style={{ backgroundColor: accentTint }} />
      <div className="flex items-center justify-between">
        <button onClick={onToggleExpand} aria-expanded={expanded} className="flex items-center gap-2">
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!expanded ? "-rotate-90" : ""}`} />
          <Gift className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-medium text-sm">Retention History</h4>
        </button>
        <button
          onClick={() => { onExpand(); setShowAddForm(true); setEditingEventId(null); }}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 hover:opacity-70"><X className="h-3 w-3" /></button>
        </div>
      )}

      {expanded && <>
      {retentionEvents.length === 0 && !showAddForm && (
        <p className="text-xs text-muted-foreground">No retention offers recorded.</p>
      )}

      <div className="space-y-1">
        {retentionEvents.map((event) => {
          const meta = (event.metadata_json as Record<string, unknown>) || {};
          const isEditing = editingEventId === event.id;
          const accepted = meta.accepted !== false;
          const linkedBonus = findLinkedBonus(card, event.id);

          return (
            <div key={event.id} className="group flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/40">
              {isEditing ? (
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Date</Label>
                      <DatePicker value={editDate} onChange={setEditDate} placeholder="Date" />
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <Switch checked={editAccepted} onCheckedChange={setEditAccepted} />
                      <Label className="text-xs font-normal">{editAccepted ? "Accepted" : "Declined"}</Label>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Points</Label>
                      <Input className="h-7 text-sm" type="number" min="1" value={editPoints} onChange={(e) => setEditPoints(e.target.value)} placeholder="e.g. 30000" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Credit ($)</Label>
                      <Input className="h-7 text-sm" type="number" min="1" value={editCredit} onChange={(e) => setEditCredit(e.target.value)} placeholder="e.g. 75" />
                    </div>
                  </div>
                  <Input
                    className="h-7 text-xs"
                    placeholder="Description (optional)"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />

                  {/* Spend requirement section (only for accepted offers) */}
                  {editAccepted && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Switch checked={editHasSpend} onCheckedChange={setEditHasSpend} />
                        <Label className="text-xs font-normal">Spend requirement</Label>
                      </div>
                      {editHasSpend && (
                        <div className="rounded-lg border bg-muted/20 p-2 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Spend ($)</Label>
                              <Input className="h-7 text-sm" type="number" min="1" value={editSpendReq} onChange={(e) => setEditSpendReq(e.target.value)} placeholder="e.g. 3000" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Deadline</Label>
                              <DatePicker value={editSpendDeadline} onChange={setEditSpendDeadline} placeholder="Date" />
                            </div>
                          </div>
                          <Input
                            className="h-7 text-xs"
                            placeholder="Spend notes (optional)"
                            value={editSpendNotes}
                            onChange={(e) => setEditSpendNotes(e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={saving} onClick={() => handleSave(event)}>
                      <Check className="h-3 w-3 mr-1" />{saving ? "Saving..." : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={cancelEdit}>
                      <X className="h-3 w-3 mr-1" />Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground text-xs">{formatDate(event.event_date)}</span>
                      <span className="font-medium text-sm">{formatOfferDetails(meta)}</span>
                      <Badge
                        variant={accepted ? "success" : "secondary"}
                        className="text-[10px]"
                      >
                        {accepted ? "Accepted" : "Declined"}
                      </Badge>
                      {linkedBonus && (
                        <Badge
                          variant={linkedBonus.bonus_earned ? "success" : "outline"}
                          className="text-[10px]"
                        >
                          {linkedBonus.bonus_earned ? "Earned" : "Tracking"}
                        </Badge>
                      )}
                    </div>
                    {event.description && (
                      <span className="text-xs text-muted-foreground/70 ml-0">{event.description}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => startEdit(event)}
                      className="sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                      aria-label="Edit retention offer"
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
                        className="sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                        disabled={saving}
                        aria-label="Delete retention offer"
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

        {/* Add new retention offer form */}
        {showAddForm && (
          <div className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <DatePicker value={addDate} onChange={setAddDate} placeholder="Date" />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch checked={addAccepted} onCheckedChange={setAddAccepted} />
                <Label className="text-xs font-normal">{addAccepted ? "Accepted" : "Declined"}</Label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Points</Label>
                <Input className="h-7 text-sm" type="number" min="1" value={addPoints} onChange={(e) => setAddPoints(e.target.value)} placeholder="e.g. 30000" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Credit ($)</Label>
                <Input className="h-7 text-sm" type="number" min="1" value={addCredit} onChange={(e) => setAddCredit(e.target.value)} placeholder="e.g. 75" />
              </div>
            </div>
            <Input
              className="h-7 text-xs"
              placeholder="Description (optional)"
              value={addDescription}
              onChange={(e) => setAddDescription(e.target.value)}
            />

            {/* Spend requirement section (only for accepted offers) */}
            {addAccepted && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Switch checked={addHasSpend} onCheckedChange={setAddHasSpend} />
                  <Label className="text-xs font-normal">Spend requirement</Label>
                </div>
                {addHasSpend && (
                  <div className="rounded-lg border bg-muted/20 p-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Spend ($)</Label>
                        <Input className="h-7 text-sm" type="number" min="1" value={addSpendReq} onChange={(e) => setAddSpendReq(e.target.value)} placeholder="e.g. 3000" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Deadline</Label>
                        <DatePicker value={addSpendDeadline} onChange={setAddSpendDeadline} placeholder="Date" />
                      </div>
                    </div>
                    <Input
                      className="h-7 text-xs"
                      placeholder="Spend notes (optional)"
                      value={addSpendNotes}
                      onChange={(e) => setAddSpendNotes(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={saving || !addDate} onClick={handleAdd}>
                <Check className="h-3 w-3 mr-1" />{saving ? "Adding..." : "Add"}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={resetAddForm}>
                <X className="h-3 w-3 mr-1" />Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
