/**
 * Which plugin the user last acted in (SPECS 12.11.5): `notes.edit` needs a click or
 * key press in that plugin's own UI (anything inside `[data-plugin="<id>"]`: blocks,
 * inline widgets, views, overlays, settings panes) or one of its commands, in the last
 * few seconds. A click elsewhere in the app does not count.
 */
const WINDOW_MS = 5000;

let last: { owner: string | null; at: number } = { owner: null, at: 0 };
let wired = false;

function record(e: Event): void {
  if (!e.isTrusted) return;
  const target = e.target instanceof Element ? e.target : null;
  const owner = target?.closest<HTMLElement>('[data-plugin]')?.dataset.plugin ?? null;
  last = { owner, at: Date.now() };
}

export function wireActivity(): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('pointerdown', record, true);
  window.addEventListener('keydown', record, true);
}

/** A plugin command was run by the user (palette or hotkey). */
export function noteCommandRun(owner: string): void {
  last = { owner, at: Date.now() };
}

export function recentlyActedIn(owner: string): boolean {
  return last.owner === owner && Date.now() - last.at < WINDOW_MS;
}
