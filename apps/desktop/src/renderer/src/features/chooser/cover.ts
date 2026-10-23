/**
 * Cover placement (VaultCard README): scale the image to cover the 286 × 556 window at
 * zoom 1, multiply by zoom, centre the focus point, clamp to the image edges.
 */
import { useEffect, useState } from 'react';
import type { VaultCover } from '@shared/bridge';

export const COVER_WINDOW = { width: 286, height: 556 };
export const PLACEHOLDERS = ['vx-cover-contour', 'vx-cover-dawn', 'vx-cover-blueprint'] as const;

export interface Placement {
  width: number;
  height: number;
  x: number;
  y: number;
}

export function placeCover(
  natural: { width: number; height: number },
  focus: { x: number; y: number },
  zoom: number,
  win: { width: number; height: number } = COVER_WINDOW,
): Placement {
  const base = Math.max(win.width / natural.width, win.height / natural.height);
  const s = base * zoom;
  const width = natural.width * s;
  const height = natural.height * s;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const x = clamp(win.width / 2 - focus.x * width, win.width - width, 0);
  const y = clamp(win.height / 2 - focus.y * height, win.height - height, 0);
  return { width, height, x, y };
}

/** Deterministic neutral placeholder for a Vault without a cover (SPECS 4.3). */
export function placeholderFor(id: string): (typeof PLACEHOLDERS)[number] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PLACEHOLDERS[(h >>> 0) % PLACEHOLDERS.length]!;
}

/** Placeholder gradients are drawn for an 834 × 556 frame, centred. */
export const PLACEHOLDER_STYLE = { backgroundSize: '834px 556px', backgroundPosition: '-274px 0' };

const sizes = new Map<string, { width: number; height: number }>();

/** Natural size of an image URL, cached. */
export function useImageSize(url: string | null): { width: number; height: number } | null {
  const [size, setSize] = useState(() => (url ? (sizes.get(url) ?? null) : null));
  useEffect(() => {
    if (!url) {
      setSize(null);
      return;
    }
    const cached = sizes.get(url);
    if (cached) {
      setSize(cached);
      return;
    }
    let live = true;
    const img = new Image();
    img.onload = () => {
      const s = { width: img.naturalWidth || 1, height: img.naturalHeight || 1 };
      sizes.set(url, s);
      if (live) setSize(s);
    };
    img.onerror = () => live && setSize(null);
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return size;
}

export function coverStyle(
  url: string,
  natural: { width: number; height: number },
  cover: Pick<VaultCover, 'focus' | 'zoom'>,
) {
  const p = placeCover(natural, cover.focus, cover.zoom);
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${p.width}px ${p.height}px`,
    backgroundPosition: `${p.x}px ${p.y}px`,
  };
}
