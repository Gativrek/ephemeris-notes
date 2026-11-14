/**
 * Other notes' equations, for cross-note references (SPECS 10.4.1): `[[Note#eq:label]]`
 * and `![[Note#eq:label]]`. Read from the note's text (the open editor's when it is open),
 * numbered as that note numbers them, and kept until the index says notes changed. A miss
 * starts a load and answers null; listeners redraw when it lands.
 */
import { analyzeNote, noteTitle, type NumberingMode } from '@ephemeris-notes/markdown';
import type { RefFormat } from './equations';

export interface NoteEquation {
  label: string;
  tex: string;
  number: string | null;
  line: number;
}

export interface NoteEquations {
  title: string;
  /** Labeled equations, the first use of each label only (as the note resolves them). */
  equations: NoteEquation[];
}

/** `eq:label` from a link's `#…` part, or null when it is not an equation reference. */
export const equationLabel = (heading: string | null | undefined): string | null =>
  heading && /^eq:[A-Za-z0-9_:-]+$/.test(heading.trim()) ? heading.trim() : null;

const cache = new Map<string, NoteEquations>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

/** Called when a load lands or the cache is cleared, so editors redraw their references. */
export function onEquationsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const notify = () => {
  for (const cb of listeners) cb();
};

/** Forget everything (the index reported changed notes). */
export function clearNoteEquations(): void {
  if (!cache.size) return;
  cache.clear();
  notify();
}

export function summarize(path: string, text: string, numbering: NumberingMode): NoteEquations {
  const s = analyzeNote(text, { numbering });
  const seen = new Set<string>();
  const equations: NoteEquation[] = [];
  for (const e of s.equations) {
    if (!e.label || seen.has(e.label)) continue;
    seen.add(e.label);
    equations.push({ label: e.label, tex: e.tex, number: e.number, line: e.line });
  }
  return { title: noteTitle(s, path), equations };
}

/** A note's equations if known; otherwise null, and they are fetched. */
export function noteEquations(
  path: string,
  load: (path: string) => Promise<string | null>,
  numbering: NumberingMode,
): NoteEquations | null {
  const hit = cache.get(path);
  if (hit) return hit;
  if (!loading.has(path)) {
    const p = load(path)
      .then((text) => {
        cache.set(path, summarize(path, text ?? '', numbering));
        notify();
      })
      .catch(() => undefined)
      .finally(() => loading.delete(path));
    loading.set(path, p);
  }
  return null;
}

/** The text a reference shows: "Kalman Filter, Eq. (3)", with "?" for an unknown label. */
export function referenceText(title: string, number: string | null | undefined, format: RefFormat): string {
  const n = number ?? '?';
  const ref = format === 'paren' ? `(${n})` : format === 'word' ? `Equation ${n}` : `Eq. (${n})`;
  return `${title}, ${ref}`;
}
