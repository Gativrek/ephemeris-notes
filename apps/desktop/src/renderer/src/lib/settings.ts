/**
 * Renderer view of settings (SPECS 11.1). Values load once and follow changes made
 * anywhere (Settings panel, another window, a synced `.vaults/settings.json`).
 */
import { create } from 'zustand';
import { unwrap, vx } from './vx';

export const SETTING_DEFAULTS: Record<string, unknown> = {
  'appearance.theme': 'system',
  'appearance.outlineStyle': 'annotated',
  'general.reopenLastVault': false,
  'general.dateLanguage': 'en-US',
  'editor.fontSize': 18,
  'editor.lineWidth': 700,
  'editor.autosaveMs': 800,
  'editor.spellcheck': true,
  'math.numbering': 'all',
  'math.referenceFormat': 'eq',
  'library.math.macros': {},
};

interface SettingsState {
  values: Record<string, unknown>;
  loaded: boolean;
  get<T>(key: string): T;
  set(key: string, value: unknown): Promise<void>;
  load(): Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  values: { ...SETTING_DEFAULTS },
  loaded: false,
  get<T>(key: string): T {
    const v = get().values[key];
    return (v === undefined || v === null ? SETTING_DEFAULTS[key] : v) as T;
  },
  async set(key, value) {
    set((s) => ({ values: { ...s.values, [key]: value } }));
    await unwrap(vx().settings.set(key, value));
  },
  async load() {
    const entries = await Promise.all(
      Object.keys(SETTING_DEFAULTS).map(
        async (k) => [k, await unwrap(vx().settings.get(k)).catch(() => null)] as const,
      ),
    );
    const values: Record<string, unknown> = { ...SETTING_DEFAULTS };
    for (const [k, v] of entries) if (v !== null && v !== undefined) values[k] = v;
    set({ values, loaded: true });
  },
}));

let wired = false;
export function wireSettings(): () => void {
  if (wired) return () => undefined;
  wired = true;
  void useSettings.getState().load();
  const off = vx().settings.onChanged((key, value) => {
    useSettings.setState((s) => ({ values: { ...s.values, [key]: value ?? SETTING_DEFAULTS[key] } }));
  });
  const offLib = vx().library.onChanged(() => void useSettings.getState().load());
  return () => {
    wired = false;
    off();
    offLib();
  };
}
