"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import type { Card, CardBonusCategory } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getCardBonusCategories,
  createCardBonusCategory,
  updateCardBonusCategory,
  deleteCardBonusCategory,
  populateBonusCategories,
} from "@/lib/api";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, Plus, Pencil, Trash2, X, RefreshCw, ChevronDown, Loader2 } from "lucide-react";

// Collapse/expand headers are a single line of 14px text, which is a ~20px tap
// target. The negative margin gives the padding back to the layout so the header
// row keeps the height it had. Same string as benefits-section.tsx.
const SECTION_HEADER_CLASS =
  "flex items-center gap-2 text-left min-h-[44px] sm:min-h-0 py-2 -my-2";

interface BonusCategoriesSectionProps {
  card: Card;
  accentTint: string;
  onUpdated: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onExpand: () => void;
}

export function BonusCategoriesSection({ card, accentTint, onUpdated, expanded, onToggleExpand, onExpand }: BonusCategoriesSectionProps) {
  const [categories, setCategories] = useState<CardBonusCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Add form state
  const [addCategory, setAddCategory] = useState("");
  const [addMultiplier, setAddMultiplier] = useState("");
  const [addPortalOnly, setAddPortalOnly] = useState(false);
  const [addCap, setAddCap] = useState("");

  // Edit form state
  const [editCategory, setEditCategory] = useState("");
  const [editMultiplier, setEditMultiplier] = useState("");
  const [editPortalOnly, setEditPortalOnly] = useState(false);
  const [editCap, setEditCap] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Per-row in-flight guard so one row's delete doesn't freeze the others.
  const [busyId, setBusyId] = useState<number | null>(null);

  // One id namespace per mounted section; the add form and the (single) open
  // edit form get their own prefixes so both can be on screen at once.
  const uid = useId();
  const addId = (field: string) => `${uid}-add-${field}`;
  const editId = (field: string) => `${uid}-edit-${field}`;

  const fetchCategories = async () => {
    try {
      const data = await getCardBonusCategories(card.id);
      setCategories(data);
    } catch {
      toast.error("Failed to load reward categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, [card.id]);

  // Closing the form used to leave the draft — and the error banner, which
  // lives outside the form — sitting there for the next open.
  const resetAddForm = () => {
    setShowAddForm(false);
    setAddCategory("");
    setAddMultiplier("");
    setAddPortalOnly(false);
    setAddCap("");
    setError(null);
  };

  const handleAdd = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting || !addCategory.trim() || !addMultiplier.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createCardBonusCategory(card.id, {
        category: addCategory.trim(),
        multiplier: addMultiplier.trim(),
        portal_only: addPortalOnly,
        cap: addCap ? Number(addCap) : null,
      });
      resetAddForm();
      fetchCategories();
      onUpdated();
      toast.success("Reward category added");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add reward category");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (categoryId: number, e?: FormEvent) => {
    e?.preventDefault();
    if (submitting || !editCategory.trim() || !editMultiplier.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateCardBonusCategory(card.id, categoryId, {
        // Sent unconditionally and trimmed, matching handleAdd above: the guard
        // has already rejected an empty field, so `x || undefined` could only
        // ever drop a value the backend would then read as "unchanged".
        category: editCategory.trim(),
        multiplier: editMultiplier.trim(),
        portal_only: editPortalOnly,
        cap: editCap ? Number(editCap) : null,
      });
      setEditingId(null);
      fetchCategories();
      onUpdated();
      toast.success("Reward category updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update reward category");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (categoryId: number) => {
    // Scoped to this row, matching `disabled={busyId === cat.id}` on the delete
    // controls: a global `busyId !== null` swallowed clicks on every other row
    // while one delete was in flight, with no spinner or toast to explain it.
    if (busyId === categoryId) return;
    setBusyId(categoryId);
    setError(null);
    try {
      await deleteCardBonusCategory(card.id, categoryId);
      setDeletingId(null);
      await fetchCategories();
      onUpdated();
      toast.success("Reward category deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete reward category");
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
      await populateBonusCategories(card.id);
      await fetchCategories();
      onUpdated();
      toast.success("Reward categories populated from template");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to populate reward categories");
    } finally {
      setPopulating(false);
    }
  };

  const startEdit = (cat: CardBonusCategory) => {
    // An armed "Delete?" survived a jump into the edit form and stayed armed
    // behind it, so cancelling the edit dropped you back onto a live delete.
    setDeletingId(null);
    setEditingId(cat.id);
    setEditCategory(cat.category);
    setEditMultiplier(cat.multiplier);
    setEditPortalOnly(cat.portal_only);
    setEditCap(cat.cap != null ? String(cat.cap) : "");
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {/* Same divider colour and same action row as the loaded header, or the
            whole section jumps when the data lands. */}
        <div className="h-px" style={{ backgroundColor: accentTint }} />
        <div className="flex items-center justify-between">
          <button onClick={onToggleExpand} aria-expanded={expanded} className={SECTION_HEADER_CLASS}>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!expanded ? "-rotate-90" : ""}`} />
            <Star className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-medium text-sm">Reward Categories</h4>
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
          <Star className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-medium text-sm">Reward Categories</h4>
          {categories.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {categories.length}
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
      {categories.length === 0 && !showAddForm && (
        <p className="text-sm text-muted-foreground">No reward categories tracked.</p>
      )}

      {/* Add reward category form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="rounded-lg border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="text-sm font-medium">Add Reward Category</h5>
            <Button type="button" size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" onClick={resetAddForm} aria-label="Close add reward category form">
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <Label htmlFor={addId("category")} className="text-xs">Category</Label>
              <Input id={addId("category")} className="h-8 text-sm" value={addCategory} onChange={(e) => setAddCategory(e.target.value)} placeholder="e.g. Dining" maxLength={100} enterKeyHint="next" />
            </div>
            <div className="min-w-0">
              <Label htmlFor={addId("multiplier")} className="text-xs">Multiplier</Label>
              <Input id={addId("multiplier")} className="h-8 text-sm" value={addMultiplier} onChange={(e) => setAddMultiplier(e.target.value)} placeholder="e.g. 3x" maxLength={20} enterKeyHint="next" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Switch id={addId("portal")} checked={addPortalOnly} onCheckedChange={setAddPortalOnly} />
              <Label htmlFor={addId("portal")} className="text-xs font-normal">Portal Only</Label>
            </div>
            <div className="min-w-0">
              <Label htmlFor={addId("cap")} className="text-xs">Cap ($/yr)</Label>
              <Input id={addId("cap")} className="h-8 text-sm" type="number" inputMode="numeric" value={addCap} onChange={(e) => setAddCap(e.target.value)} placeholder="No cap" enterKeyHint="done" />
            </div>
          </div>
          <Button type="submit" size="sm" className="h-7 text-xs" disabled={submitting || !addCategory.trim() || !addMultiplier.trim()}>
            {submitting ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Adding...</> : "Add Category"}
          </Button>
        </form>
      )}

      {categories.map((cat) => {
        const isEditing = editingId === cat.id;

        if (isEditing) {
          return (
            <form key={cat.id} onSubmit={(e) => handleEdit(cat.id, e)} className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h5 className="text-sm font-medium">Edit Reward Category</h5>
                <Button type="button" size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" onClick={() => setEditingId(null)} aria-label={`Cancel editing ${cat.category}`}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0">
                  <Label htmlFor={editId("category")} className="text-xs">Category</Label>
                  <Input id={editId("category")} className="h-8 text-sm" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} maxLength={100} enterKeyHint="next" />
                </div>
                <div className="min-w-0">
                  <Label htmlFor={editId("multiplier")} className="text-xs">Multiplier</Label>
                  <Input id={editId("multiplier")} className="h-8 text-sm" value={editMultiplier} onChange={(e) => setEditMultiplier(e.target.value)} placeholder="e.g. 3x" maxLength={20} enterKeyHint="next" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Switch id={editId("portal")} checked={editPortalOnly} onCheckedChange={setEditPortalOnly} />
                  <Label htmlFor={editId("portal")} className="text-xs font-normal">Portal Only</Label>
                </div>
                <div className="min-w-0">
                  <Label htmlFor={editId("cap")} className="text-xs">Cap ($/yr)</Label>
                  <Input id={editId("cap")} className="h-8 text-sm" type="number" inputMode="numeric" value={editCap} onChange={(e) => setEditCap(e.target.value)} placeholder="No cap" enterKeyHint="done" />
                </div>
              </div>
              <Button type="submit" size="sm" className="h-7 text-xs" disabled={submitting || !editCategory.trim() || !editMultiplier.trim()}>
                {submitting ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Saving...</> : "Save"}
              </Button>
            </form>
          );
        }

        return (
          <div key={cat.id} className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <span className="text-sm font-medium">{cat.category}</span>
                <Badge variant="outline" className="text-xs">{cat.multiplier}</Badge>
                {cat.portal_only && (
                  <Badge variant="secondary" className="text-xs">Portal</Badge>
                )}
                {cat.cap != null && (
                  <span className="text-xs text-muted-foreground">Cap: ${cat.cap.toLocaleString()}/yr</span>
                )}
                {cat.from_template && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium">
                    Template
                  </span>
                )}
              </div>
              <div className="flex gap-0.5 shrink-0">
                <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" onClick={() => startEdit(cat)} aria-label={`Edit ${cat.category}`}>
                  <Pencil className="h-3 w-3" />
                </Button>
                {/* Armed state keeps the arming button's tap target, and carries
                    its own X — there is no outside-click or timeout to disarm it. */}
                {deletingId === cat.id ? (
                  <>
                    <Button size="sm" variant="destructive" className="h-6 min-h-[44px] sm:min-h-0 px-2 text-xs" disabled={busyId === cat.id} onClick={() => handleDelete(cat.id)} aria-label={`Confirm delete ${cat.category}`}>
                      {busyId === cat.id ? "Deleting..." : "Delete?"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" disabled={busyId === cat.id} onClick={() => setDeletingId(null)} aria-label={`Keep ${cat.category}`}>
                      <X className="h-3 w-3" />
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0 text-danger" onClick={() => setDeletingId(cat.id)} aria-label={`Delete ${cat.category}`}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      </>}
    </div>
  );
}
