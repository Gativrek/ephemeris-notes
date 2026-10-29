/**
 * Every shortcut and its keys (SPECS 11.3, 11.4): the defaults, and the user's
 * overrides from Settings > Keyboard (`keyboard.bindings`). App shortcuts are handled
 * by the window; editor shortcuts by the note editor's keymap. One key belongs to at
 * most one command. Keys use the normalized `Mod-Alt-Shift-<key>` form of hotkeys.ts.
 */
import { HOTKEYS_KEY } from './hotkeys';
import { useSettings } from './settings';

export type Scope = 'app' | 'editor';

export interface ShortcutDef {
  id: string;
  scope: Scope;
  defaults: string[];
}

/** The built-in shortcuts, in the order Settings and Help list them. */
export const SHORTCUTS: ShortcutDef[] = [
  { id: 'core:switch-vault', scope: 'app', defaults: ['Mod-o'] },
  { id: 'core:search', scope: 'app', defaults: ['Mod-k'] },
  { id: 'core:palette', scope: 'app', defaults: ['Mod-p'] },
  { id: 'core:new-note', scope: 'app', defaults: ['Mod-n'] },
  { id: 'core:toggle-source', scope: 'app', defaults: ['Mod-e'] },
  { id: 'core:close-item', scope: 'app', defaults: ['Mod-w'] },
  { id: 'core:toggle-sidebar', scope: 'app', defaults: ['Mod-\\'] },
  { id: 'core:toggle-outline', scope: 'app', defaults: ['Mod-Shift-o'] },
  { id: 'core:daily', scope: 'app', defaults: ['Mod-Shift-d'] },
  { id: 'core:settings', scope: 'app', defaults: ['Mod-,'] },
  { id: 'editor:bold', scope: 'editor', defaults: ['Mod-b'] },
  { id: 'editor:italic', scope: 'editor', defaults: ['Mod-i'] },
  { id: 'core:insert-code-block', scope: 'editor', defaults: ['Mod-Shift-c'] },
  { id: 'editor:task', scope: 'editor', defaults: ['Mod-Shift-x'] },
  { id: 'editor:undo', scope: 'editor', defaults: ['Mod-z'] },
  { id: 'editor:redo', scope: 'editor', defaults: ['Mod-y', 'Mod-Shift-z'] },
  { id: 'editor:find', scope: 'editor', defaults: ['Mod-f'] },
  { id: 'editor:select-next', scope: 'editor', defaults: ['Mod-d'] },
  { id: 'editor:matching-bracket', scope: 'editor', defaults: ['Mod-Shift-\\'] },
  { id: 'editor:indent', scope: 'editor', defaults: ['Tab', 'Mod-]'] },
  { id: 'editor:outdent', scope: 'editor', defaults: ['Shift-Tab', 'Mod-['] },
];

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/**
 * Keys no command can take: clipboard and select-all, which the browser and the editor
 * handle themselves. The editor's remaining keys (arrows, Home, Enter…) come from its
 * keymap at check time.
 */
export const RESERVED = ['Mod-c', 'Mod-v', 'Mod-x', 'Mod-a', 'Mod-Shift-v'];

/** Stored overrides: a command's keys, `[]` for none. Older settings stored one key as a string. */
export type Overrides = Record<string, string[] | string>;

export const scopeOf = (id: string): Scope => BY_ID.get(id)?.scope ?? 'app';
export const defaultsOf = (id: string): string[] => BY_ID.get(id)?.defaults ?? [];

/** A command's keys now: its override if there is one, else its defaults. */
export function keysOf(id: string, overrides: Overrides): string[] {
  const o = overrides[id];
  if (o === undefined) return defaultsOf(id);
  return typeof o === 'string' ? [o] : o;
}

export const isOverridden = (id: string, overrides: Overrides) => overrides[id] !== undefined;

/** Every key in use, with the command that has it. A key claimed twice goes to the override. */
export function keyOwners(overrides: Overrides, extraIds: string[] = []): Map<string, string> {
  const owners = new Map<string, string>();
  const ids = [...new Set([...SHORTCUTS.map((s) => s.id), ...Object.keys(overrides), ...extraIds])];
  // Defaults first, so a user's key wins over a default that still names it.
  const order = [
    ...ids.filter((id) => !isOverridden(id, overrides)),
    ...ids.filter((id) => isOverridden(id, overrides)),
  ];
  for (const id of order) for (const k of keysOf(id, overrides)) owners.set(k, id);
  return owners;
}

/** The command a pressed key runs, or undefined. */
export function commandFor(key: string, overrides: Overrides): string | undefined {
  return keyOwners(overrides).get(key);
}

/**
 * Gives `key` to `id`, taking it from whichever command had it (that command keeps its
 * other keys). Returns the new overrides; a command back on exactly its defaults loses
 * its override.
 */
export function assignKey(overrides: Overrides, id: string, key: string): Overrides {
  const next: Overrides = { ...overrides };
  const from = keyOwners(overrides).get(key);
  if (from && from !== id) next[from] = keysOf(from, overrides).filter((k) => k !== key);
  next[id] = [key];
  return tidy(next);
}

export function removeKeys(overrides: Overrides, id: string): Overrides {
  return tidy({ ...overrides, [id]: [] });
}

/** Back to the defaults; a default key another command now has stays with that command. */
export function resetKeys(overrides: Overrides, id: string): Overrides {
  const { [id]: _gone, ...rest } = overrides;
  const owners = keyOwners(rest);
  const free = defaultsOf(id).filter((k) => owners.get(k) === id || !owners.has(k));
  return tidy(free.length === defaultsOf(id).length ? rest : { ...rest, [id]: free });
}

function tidy(o: Overrides): Overrides {
  const out: Overrides = {};
  for (const [id, v] of Object.entries(o)) {
    const keys = typeof v === 'string' ? [v] : v;
    const d = defaultsOf(id);
    const same = BY_ID.has(id) && keys.length === d.length && keys.every((k, i) => k === d[i]);
    if (!same && (BY_ID.has(id) || keys.length)) out[id] = keys;
  }
  return out;
}

/** The overrides in settings now. */
export const currentOverrides = (): Overrides => useSettings.getState().get<Overrides>(HOTKEYS_KEY) ?? {};
