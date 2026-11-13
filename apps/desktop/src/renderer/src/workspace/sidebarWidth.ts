/**
 * The sidebar's width (SPECS 9.4): dragged on its right edge or set with the keyboard,
 * between 240 and 600 px and always leaving the note 420 px; per machine and library.
 */
import { create } from 'zustand';
import { unwrap, vx } from '../lib/vx';

export const SIDEBAR = { default: 304, min: 240, max: 600, step: 16 } as const;
/** The rail and the narrowest note the sidebar leaves room for. */
const RAIL = 56;
const MAIN_MIN = 420;
const KEY = 'sidebar.width';

/** The widest the sidebar may be in a window this wide. */
export function maxWidth(windowWidth: number): number {
  return Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, windowWidth - RAIL - MAIN_MIN));
}

export function clampWidth(width: number, windowWidth: number): number {
  if (!Number.isFinite(width)) return SIDEBAR.default;
  return Math.round(Math.min(maxWidth(windowWidth), Math.max(SIDEBAR.min, width)));
}

interface SidebarWidth {
  /** As chosen; drawn clamped to the window. */
  width: number;
  load(): Promise<void>;
  /** Sets the width, saving it shortly after the last change. */
  set(width: number): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useSidebarWidth = create<SidebarWidth>((set) => ({
  width: SIDEBAR.default,
  async load() {
    const saved = await unwrap(vx().ui.get(KEY)).catch(() => null);
    if (typeof saved === 'number') set({ width: clampWidth(saved, Infinity) });
  },
  set(width) {
    const next = clampWidth(width, window.innerWidth);
    set({ width: next });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void vx().ui.set(KEY, next), 300);
  },
}));
