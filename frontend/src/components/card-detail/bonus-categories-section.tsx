"use client";

import { useEffect, useState } from "react";
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
import { Star, Plus, Pencil, Trash2, X, RefreshCw, ChevronDown } from "lucide-react";

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
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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

  const handleAdd = async () => {
    if (!addCategory || !addMultiplier) return;
    setSubmitting(true);
    setError(null);
    try {
      await createCardBonusCategory(card.id, {
        category: addCategory,
        multiplier: addMultiplier,
        portal_only: addPortalOnly,
        cap: addCap ? Number(addCap) : null,
      });
      setShowAddForm(false);
      setAddCategory("");
      setAddMultiplier("");
      setAddPortalOnly(false);
      setAddCap("");
      fetchCategories();
      onUpdated();
      toast.success("Reward category added");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add reward category");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (categoryId: number) => {
    setSubmitting(true);
    setError(null);
    try {
      await updateCardBonusCategory(card.id, categoryId, {
        category: editCategory || undefined,
        multiplier: editMultiplier || undefined,
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
    setError(null);
    try {
      await deleteCardBonusCategory(card.id, categoryId);
      fetchCategories();
      onUpdated();
      toast.success("Reward category deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete reward category");
    }
  };

  const handlePopulate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await populateBonusCategories(card.id);
      fetchCategories();
      onUpdated();
      toast.success("Reward categories populated from template");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to populate reward categories");
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (cat: CardBonusCategory) => {
    setEditingId(cat.id);
    setEditCategory(cat.category);
    setEditMultiplier(cat.multiplier);
    setEditPortalOnly(cat.portal_only);
    setEditCap(cat.cap != null ? String(cat.cap) : "");
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-px bg-muted" />
        <button onClick={onToggleExpand} aria-expanded={expanded} className="flex items-center gap-2">
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!expanded ? "-rotate-90" : ""}`} />
          <Star className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-medium text-sm">Reward Categories</h4>
        </button>
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
        <button onClick={onToggleExpand} aria-expanded={expanded} className="flex items-center gap-2">
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${!expanded ? "-rotate-90" : ""}`} />
          <Star className="h-4 w-4 text-muted-foreground" />
          <h4 className="font-medium text-sm">Reward Categories</h4>
          {categories.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {categories.length}
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
      {categories.length === 0 && !showAddForm && (
        <p className="text-sm text-muted-foreground">No reward categories tracked.</p>
      )}

      {/* Add reward category form */}
      {showAddForm && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="text-sm font-medium">Add Reward Category</h5>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowAddForm(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Category</Label>
              <Input className="h-8 text-sm" value={addCategory} onChange={(e) => setAddCategory(e.target.value)} placeholder="e.g. Dining" maxLength={100} />
            </div>
            <div>
              <Label className="text-xs">Multiplier</Label>
              <Input className="h-8 text-sm" value={addMultiplier} onChange={(e) => setAddMultiplier(e.target.value)} placeholder="e.g. 3x" maxLength={20} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <Switch checked={addPortalOnly} onCheckedChange={setAddPortalOnly} />
              <Label className="text-xs font-normal">Portal Only</Label>
            </div>
            <div>
              <Label className="text-xs">Cap ($/yr)</Label>
              <Input className="h-8 text-sm" type="number" value={addCap} onChange={(e) => setAddCap(e.target.value)} placeholder="No cap" />
            </div>
          </div>
          <Button size="sm" className="h-7 text-xs" onClick={handleAdd} disabled={submitting || !addCategory || !addMultiplier}>
            {submitting ? "Adding..." : "Add Category"}
          </Button>
        </div>
      )}

      {categories.map((cat) => {
        const isEditing = editingId === cat.id;

        if (isEditing) {
          return (
            <div key={cat.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h5 className="text-sm font-medium">Edit Reward Category</h5>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingId(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Category</Label>
                  <Input className="h-8 text-sm" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} maxLength={100} />
                </div>
                <div>
                  <Label className="text-xs">Multiplier</Label>
                  <Input className="h-8 text-sm" value={editMultiplier} onChange={(e) => setEditMultiplier(e.target.value)} placeholder="e.g. 3x" maxLength={20} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2">
                  <Switch checked={editPortalOnly} onCheckedChange={setEditPortalOnly} />
                  <Label className="text-xs font-normal">Portal Only</Label>
                </div>
                <div>
                  <Label className="text-xs">Cap ($/yr)</Label>
                  <Input className="h-8 text-sm" type="number" value={editCap} onChange={(e) => setEditCap(e.target.value)} placeholder="No cap" />
                </div>
              </div>
              <Button size="sm" className="h-7 text-xs" onClick={() => handleEdit(cat.id)} disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button>
            </div>
          );
        }

        return (
          <div key={cat.id} className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 flex-wrap">
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
              <div className="flex gap-0.5">
                <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0" onClick={() => startEdit(cat)} aria-label={`Edit ${cat.category}`}>
                  <Pencil className="h-3 w-3" />
                </Button>
                {deletingId === cat.id ? (
                  <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => { handleDelete(cat.id); setDeletingId(null); }}>
                    Delete?
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="h-6 w-6 sm:h-6 sm:w-6 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-0 text-destructive" onClick={() => setDeletingId(cat.id)} aria-label={`Delete ${cat.category}`}>
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
