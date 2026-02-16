"use client";

import { useState } from "react";
import type { Profile } from "@/types";
import { deleteProfile } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteProfile(profile.id);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete profile");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete Profile</DialogTitle>
          <DialogDescription>
            {cardCount > 0
              ? `This will permanently delete "${profile.name}" and all ${cardCount} card${cardCount !== 1 ? "s" : ""} with their events.`
              : `Delete the profile "${profile.name}"?`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
