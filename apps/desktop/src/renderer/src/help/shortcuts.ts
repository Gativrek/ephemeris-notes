/**
 * The Keyboard shortcuts help page shows the keys as set now: its `{{shortcuts:app}}`
 * and `{{shortcuts:editor}}` placeholders become tables from lib/keymap.ts, and a fixed
 * key written `{{key:Mod-c}}` reads as this platform's (Ctrl+C, or Cmd+C on macOS).
 */
import { displayKey } from '../lib/hotkeys';
import { keysOf, SHORTCUTS, type Overrides } from '../lib/keymap';

/** One table per scope. App rows include every other command with a key set (plugins too). */
export function fillShortcuts(
  markdown: string,
  overrides: Overrides,
  titleOf: (id: string) => string,
  mac: boolean,
): string {
  const keys = (id: string) => {
    const k = keysOf(id, overrides);
    return k.length ? k.map((x) => `\`${displayKey(x, mac)}\``).join(' or ') : 'None';
  };
  const table = (ids: string[]) =>
    ['| Action | Shortcut |', '|---|---|', ...ids.map((id) => `| ${titleOf(id)} | ${keys(id)} |`)].join('\n');
  const builtIn = new Set(SHORTCUTS.map((s) => s.id));
  const extra = Object.keys(overrides).filter((id) => !builtIn.has(id) && keysOf(id, overrides).length);
  const app = [...SHORTCUTS.filter((s) => s.scope === 'app').map((s) => s.id), ...extra];
  const editor = SHORTCUTS.filter((s) => s.scope === 'editor').map((s) => s.id);
  return markdown
    .replace('{{shortcuts:app}}', table(app))
    .replace('{{shortcuts:editor}}', table(editor))
    .replace(/\{\{key:([^}]+)\}\}/g, (_m, key: string) => displayKey(key, mac));
}
