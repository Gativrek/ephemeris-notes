/**
 * Light, dark or system (Settings > Appearance). Dark applies through
 * `data-theme="dark"` on <html> (SPECS 14). The chooser stays light regardless.
 */
import { unwrap, vx } from './vx';

export type ThemeSetting = 'light' | 'dark' | 'system';
export const THEME_KEY = 'appearance.theme';

let current: 'light' | 'dark' = 'light';
const listeners = new Set<(t: 'light' | 'dark') => void>();

export function currentTheme(): 'light' | 'dark' {
  return current;
}

export function onThemeChange(fn: (t: 'light' | 'dark') => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function resolve(setting: unknown): 'light' | 'dark' {
  if (setting === 'dark' || setting === 'light') return setting;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(): () => void {
  let setting: unknown = 'system';
  const apply = () => {
    const next = resolve(setting);
    document.documentElement.dataset.theme = next;
    if (next !== current) {
      current = next;
      for (const fn of listeners) fn(next);
    }
  };
  apply();
  void unwrap(vx().settings.get(THEME_KEY)).then(
    (v) => {
      setting = v ?? 'system';
      apply();
    },
    () => undefined,
  );
  const off = vx().settings.onChanged((key, value) => {
    if (key === THEME_KEY) {
      setting = value ?? 'system';
      apply();
    }
  });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', apply);
  return () => {
    off();
    mq.removeEventListener('change', apply);
  };
}
