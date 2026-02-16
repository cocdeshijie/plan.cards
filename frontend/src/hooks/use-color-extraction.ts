"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, string>();
const FALLBACK = "hsl(var(--muted))";

export function useColorExtraction(imageUrl: string | null): string {
  const [color, setColor] = useState<string>(
    imageUrl && cache.has(imageUrl) ? cache.get(imageUrl)! : FALLBACK
  );

  useEffect(() => {
    if (!imageUrl) {
      setColor(FALLBACK);
      return;
    }

    if (cache.has(imageUrl)) {
      setColor(cache.get(imageUrl)!);
      return;
    }

    let cancelled = false;

    async function extract() {
      let fac: InstanceType<typeof import("fast-average-color").FastAverageColor> | null = null;
      try {
        const { FastAverageColor } = await import("fast-average-color");
        fac = new FastAverageColor();
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = imageUrl!;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
        });
        const result = fac.getColor(img);
        const rgb = result.value;
        const extracted = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        cache.set(imageUrl!, extracted);
        if (!cancelled) setColor(extracted);
      } catch {
        if (!cancelled) setColor(FALLBACK);
      } finally {
        fac?.destroy();
      }
    }

    extract();
    return () => { cancelled = true; };
  }, [imageUrl]);

  return color;
}
