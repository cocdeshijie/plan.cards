"use client";

import { useState } from "react";
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
  const [imgError, setImgError] = useState(false);

  if (imgError) return null;

  const src = templateId
    ? (cardImage
      ? getTemplateImageVariantUrl(templateId, cardImage)
      : getTemplateImageUrl(templateId))
    : PLACEHOLDER_IMAGE_URL;

  return (
    <img
      src={src}
      alt={cardName}
      className={cn("w-12 h-[30px] object-cover rounded-sm", className)}
      style={accentColor ? { boxShadow: `0 0 0 1.5px ${accentColor}` } : undefined}
      onError={(e) => {
        const target = e.currentTarget;
        if (target.src !== PLACEHOLDER_IMAGE_URL) {
          target.src = PLACEHOLDER_IMAGE_URL;
        } else {
          setImgError(true);
        }
      }}
    />
  );
}
