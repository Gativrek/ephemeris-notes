/**
 * User hotkeys for commands (SPECS 11.3, Settings > Keyboard). Keys use CodeMirror's
 * notation normalized to `Mod-Alt-Shift-<key>` (Mod is Ctrl, or Cmd on macOS). A
 * binding is refused when it shadows a core shortcut, a key the editor installs, or
 * another command's hotkey.
 */

export const HOTKEYS_KEY = 'keyboard.bindings';

/** The core shortcuts of SPECS 11.4, by command id. */
export const CORE_SHORTCUTS: Record<string, string> = {
  'core:switch-vault': 'Mod-o',
  'core:search': 'Mod-k',
  'core:palette': 'Mod-p',
  'core:new-note': 'Mod-n',
  'core:toggle-source': 'Mod-e',
  'core:close-item': 'Mod-w',
  'core:toggle-sidebar': 'Mod-\\',
  'core:toggle-outline': 'Mod-Shift-o',
  'core:daily': 'Mod-Shift-d',
  'core:settings': 'Mod-,',
};

const MODS = ['Mod', 'Alt', 'Shift'] as const;

/** Normalizes a CodeMirror key name (`Shift-Mod-z`, `Ctrl-Space`, `Mod--`). */
export function normalizeKey(name: string, isMac: boolean): string {
  const parts = name.split(/-(?!$)/);
  let key = parts.pop() ?? '';
  const mods = new Set<string>();
  for (const p of parts) {
    if (/^(cmd|meta|m)$/i.test(p)) mods.add(isMac ? 'Mod' : 'Meta');
    else if (/^(ctrl|control|c)$/i.test(p)) mods.add(isMac ? 'Ctrl' : 'Mod');
    else if (/^mod$/i.test(p)) mods.add('Mod');
    else if (/^(alt|a)$/i.test(p)) mods.add('Alt');
    else if (/^(shift|s)$/i.test(p)) mods.add('Shift');
  }
  if (key === 'Space') key = ' ';
  if (key.length === 1) key = key.toLowerCase();
  const ordered = [
    ...MODS.filter((m) => mods.has(m)),
    ...[...mods].filter((m) => !MODS.includes(m as never)),
  ];
  return [...ordered, key].join('-');
}

/** The key a keydown event means, or null for a lone modifier. */
export function eventKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  isMac: boolean,
): string | null {
  if (['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'CapsLock'].includes(e.key)) return null;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (isMac && e.ctrlKey) parts.push('Ctrl');
  if (!isMac && e.metaKey) parts.push('Meta');
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join('-');
}

/** "Ctrl+Shift+L" (or "Cmd+Shift+L" on macOS). */
export function displayKey(key: string, isMac: boolean): string {
  const parts = key.split(/-(?!$)/);
  return parts
    .map((p, i) => {
      if (i < parts.length - 1) return p === 'Mod' ? (isMac ? 'Cmd' : 'Ctrl') : p;
      if (p === ' ') return 'Space';
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join('+');
}

export type BindingCheck = { ok: true } | { ok: false; reason: 'modifier' | 'taken'; by?: string };

/**
 * A hotkey needs Mod or Alt (or is a function key), so typing is never captured, and
 * must not be taken. `taken` maps each normalized key to who uses it.
 */
export function checkBinding(key: string, taken: Map<string, string>): BindingCheck {
  const parts = key.split(/-(?!$)/);
  const last = parts[parts.length - 1] ?? '';
  const hasMod = parts.slice(0, -1).some((p) => p === 'Mod' || p === 'Alt');
  if (!hasMod && !/^F([1-9]|1[0-9]|2[0-4])$/.test(last)) return { ok: false, reason: 'modifier' };
  const by = taken.get(key);
  return by === undefined ? { ok: true } : { ok: false, reason: 'taken', by };
}

/** True while Settings > Keyboard records a key, so global shortcuts stand aside. */
export const recording = { active: false };

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
}
