"use client";

import { useState } from "react";
import type { Card } from "@/types";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CardDetailContent } from "./card-detail-content";

interface CardDetailResponsiveProps {
  card: Card;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted?: () => void;
  profileName?: string;
}

export function CardDetailResponsive({ card, open, onClose, onUpdated, onDeleted, profileName }: CardDetailResponsiveProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // The Edit Card form guards its own X and Cancel with a Discard prompt, but
  // the dialog/drawer around it used to close unconditionally — Esc, an overlay
  // click or a drag-down threw away a fully typed form. CardDetailContent
  // reports dirtiness up so the big exits can ask the same question.
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  // Esc and outside-pointer dismissal are preventable on both surfaces: vaul
  // forwards both handlers to the Radix dialog underneath it.
  const guardDismiss = (e: Event) => {
    if (!dirty) return;
    e.preventDefault();
    setConfirmDiscard(true);
  };

  const discardConfirm = (
    <ConfirmDialog
      open={confirmDiscard}
      onOpenChange={setConfirmDiscard}
      title="Discard Changes"
      description="This card has unsaved changes in the Edit Card form. Discard them?"
      confirmLabel="Discard"
      variant="destructive"
      onConfirm={() => { setConfirmDiscard(false); setDirty(false); onClose(); }}
    />
  );

  const body = (
    <CardDetailContent
      card={card}
      onUpdated={onUpdated}
      onDeleted={() => { setDirty(false); onClose(); onDeleted?.(); }}
      profileName={profileName}
      onDirtyChange={setDirty}
    />
  );

  if (isDesktop) {
    return (
      <>
        <Dialog open={open} onOpenChange={(v) => { if (!v) requestClose(); }}>
          <DialogContent
            className="max-w-2xl max-h-[90vh] overflow-hidden p-0 flex flex-col"
            onEscapeKeyDown={guardDismiss}
            onPointerDownOutside={guardDismiss}
          >
            <DialogHeader className="sr-only">
              <DialogTitle>{card.card_name}</DialogTitle>
              <DialogDescription>{card.issuer}</DialogDescription>
            </DialogHeader>
            <div className="overflow-y-auto scrollbar-thin p-6 flex-1 min-h-0">
              {body}
            </div>
          </DialogContent>
        </Dialog>
        {discardConfirm}
      </>
    );
  }

  return (
    <>
      {/* dismissible={false} while dirty is the only lever vaul gives for the
          drag-down: it stops the gesture outright rather than letting the sheet
          animate away with the form inside it. Esc and a tap on the scrim still
          reach the handlers above, which is where the Discard prompt comes
          from; the form's own X and Cancel are unaffected either way. */}
      <Drawer open={open} dismissible={!dirty} onOpenChange={(v) => { if (!v) requestClose(); }}>
        <DrawerContent
          className="max-h-[85vh]"
          onEscapeKeyDown={guardDismiss}
          onPointerDownOutside={guardDismiss}
        >
          <DrawerHeader className="sr-only">
            <DrawerTitle>{card.card_name}</DrawerTitle>
            <DrawerDescription>{card.issuer}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto scrollbar-thin p-6">
            {body}
          </div>
        </DrawerContent>
      </Drawer>
      {discardConfirm}
    </>
  );
}
