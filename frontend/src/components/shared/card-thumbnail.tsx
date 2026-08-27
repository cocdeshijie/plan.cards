"use client";

import { useEffect, useState } from "react";
import { getTemplateImageUrl, getTemplateImageVariantUrl, PLACEHOLDER_IMAGE_URL } from "@/lib/api";
import { cn } from "@/lib/utils";

interface CardThumbnailProps {
  templateId: string | null;
  cardName: string;
  cardImage?: string | null;
  accentColor?: string;
  className?: string;
}

export function CardThumbnail({ templateId, cardName, cardImage, accentColor, className }: CardThumbnailProps) {
  const primarySrc = templateId
    ? (cardImage
      ? getTemplateImageVariantUrl(templateId, cardImage)
      : getTemplateImageUrl(templateId))
    : PLACEHOLDER_IMAGE_URL;

  // The fallback is tracked in state and `src` is never mutated. API_BASE is ""
  // on the default same-origin deployment, so PLACEHOLDER_IMAGE_URL is a
  // relative path while `img.src` reads back absolute — the old
  // `target.src !== PLACEHOLDER_IMAGE_URL` guard was therefore always true, so a
  // placeholder that itself fails re-requested forever and the give-up branch
  // was unreachable.
  const [usePlaceholder, setUsePlaceholder] = useState(false);
  const [failed, setFailed] = useState(false);

  // A product change swaps the artwork; without this a single earlier failure
  // hid the thumbnail for the rest of the session.
  useEffect(() => {
    setUsePlaceholder(false);
    setFailed(false);
  }, [primarySrc]);

  if (failed) return null;

  return (
    <img
      src={usePlaceholder ? PLACEHOLDER_IMAGE_URL : primarySrc}
      alt={cardName}
      className={cn("w-12 h-[30px] object-cover rounded-sm", className)}
      style={accentColor ? { boxShadow: `0 0 0 1.5px ${accentColor}` } : undefined}
      onError={() => {
        if (!usePlaceholder && primarySrc !== PLACEHOLDER_IMAGE_URL) {
          setUsePlaceholder(true);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}
