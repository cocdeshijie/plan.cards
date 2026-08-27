"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Shown in place of confirmLabel while the confirm is in flight. */
  pendingLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  /** May return a Promise — the dialog then owns the busy state until it settles. */
  onConfirm: () => void | Promise<unknown>;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  pendingLabel,
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  // Self-owned busy state so an async onConfirm gets a disabled + spinning
  // dialog without every call site having to thread its own `loading` prop.
  // The explicit `loading` prop still works and simply ORs in.
  const [busy, setBusy] = React.useState(false);
  const pending = loading || busy;

  // A confirm that resolves by unmounting this dialog must not leave `busy` set
  // if the same instance is reopened for another target.
  React.useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  const handleConfirm = async () => {
    if (pending) return;
    let result: void | Promise<unknown>;
    try {
      result = onConfirm();
    } catch {
      return; // synchronous throw — the call site owns the error surface
    }
    if (!result || typeof (result as Promise<unknown>).then !== "function") return;
    setBusy(true);
    try {
      await result;
    } catch {
      // The call site toasts its own failure; we only clear the busy flag.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't let Esc / overlay clicks dismiss mid-flight.
        if (!next && pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            size="sm"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {pending ? pendingLabel ?? confirmLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
