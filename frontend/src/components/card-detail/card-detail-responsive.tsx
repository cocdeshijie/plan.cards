"use client";

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

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="sr-only">
            <DialogTitle>{card.card_name}</DialogTitle>
            <DialogDescription>{card.issuer}</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto scrollbar-thin p-6 flex-1 min-h-0">
            <CardDetailContent card={card} onUpdated={onUpdated} onDeleted={() => { onClose(); onDeleted?.(); }} profileName={profileName} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="sr-only">
          <DrawerTitle>{card.card_name}</DrawerTitle>
          <DrawerDescription>{card.issuer}</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto scrollbar-thin p-6">
          <CardDetailContent card={card} onUpdated={onUpdated} onDeleted={() => { onClose(); onDeleted?.(); }} profileName={profileName} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
