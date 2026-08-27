"use client";

import type { Profile } from "@/types";
import { deleteProfile } from "@/lib/api";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface DeleteProfileDialogProps {
  profile: Profile;
  cardCount: number;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteProfileDialog({
  profile,
  cardCount,
  open,
  onClose,
  onDeleted,
}: DeleteProfileDialogProps) {
  const handleDelete = async () => {
    try {
      await deleteProfile(profile.id);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete profile");
    }
  };

  // ConfirmDialog rather than a hand-rolled Dialog on purpose: it refuses Esc
  // and overlay clicks while the confirm is in flight. Dismissing mid-delete
  // routed to onClose instead of onDeleted, which left selectedProfileId
  // pointing at a profile the server had already removed and skipped the
  // refresh — every subsequent request then scoped to a dead id.
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Delete Profile"
      description={
        cardCount > 0
          ? `This will permanently delete "${profile.name}" and all ${cardCount} card${cardCount !== 1 ? "s" : ""} with their events.`
          : `Delete the profile "${profile.name}"?`
      }
      confirmLabel="Delete"
      pendingLabel="Deleting…"
      variant="destructive"
      onConfirm={handleDelete}
    />
  );
}
