/**
 * Settings (SPECS 11.1). Per-machine settings live in user data. Keys starting with
 * `library.` are library-scope (math macros and the like) and live in
 * `.vaults/settings.json`, so they sync with the notes.
 */
import type { PushEvent } from '@shared/bridge';
import { fail } from '@shared/result';
import type { JsonStore } from './json-store';
import type { LibrarySession } from './session';

const KEY = /^[a-z][a-zA-Z0-9_.-]{0,127}$/;
export const LIBRARY_SETTINGS_FILE = '.vaults/settings.json';

export function validateKey(key: unknown): string {
  if (typeof key !== 'string' || !KEY.test(key)) fail('INVALID_ARGUMENT', 'Invalid settings key.');
  return key;
}

export class Settings {
  private library: Record<string, unknown> = {};
  private session: LibrarySession | null = null;

  constructor(
    private readonly machine: JsonStore<Record<string, unknown>>,
    private readonly broadcast: (e: PushEvent) => void,
  ) {}

  async attach(session: LibrarySession | null): Promise<void> {
    this.session = session;
    this.library = {};
    if (session) await this.reloadLibrary();
  }

  async reloadLibrary(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const before = this.library;
    try {
      const file = await s.fs.read(LIBRARY_SETTINGS_FILE, { allowHidden: true });
      const parsed: unknown = JSON.parse(file.text);
      this.library =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      this.library = {};
    }
    for (const key of new Set([...Object.keys(before), ...Object.keys(this.library)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(this.library[key])) {
        this.broadcast({
          type: 'settings.changed',
          payload: { key: `library.${key}`, value: this.library[key] },
        });
      }
    }
  }

  get(key: string): unknown {
    if (key.startsWith('library.')) return this.library[key.slice('library.'.length)] ?? null;
    return this.machine.get(key) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    if (key.startsWith('library.')) {
      const s = this.session;
      if (!s) fail('NO_LIBRARY', 'Library settings need an open library.');
      const next = { ...this.library };
      if (value === null || value === undefined) delete next[key.slice(8)];
      else next[key.slice(8)] = value;
      this.library = next;
      await s.fs.writeBytes(
        LIBRARY_SETTINGS_FILE,
        Buffer.from(JSON.stringify(next, null, 2) + '\n', 'utf8'),
        {
          allowHidden: true,
        },
      );
    } else {
      this.machine.set(key, value);
    }
    this.broadcast({ type: 'settings.changed', payload: { key, value } });
  }
}
