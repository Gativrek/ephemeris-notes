import { describe, expect, it } from 'vitest';
import { checkBinding, displayKey, eventKey, normalizeKey } from './hotkeys';

const ev = (
  key: string,
  mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('hotkeys', () => {
  it('normalizes CodeMirror key names', () => {
    expect(normalizeKey('Shift-Mod-z', false)).toBe('Mod-Shift-z');
    expect(normalizeKey('Mod-Z', false)).toBe('Mod-z');
    expect(normalizeKey('Ctrl-Space', false)).toBe('Mod- ');
    expect(normalizeKey('Ctrl-Space', true)).toBe('Ctrl- ');
    expect(normalizeKey('Mod--', false)).toBe('Mod--');
    expect(normalizeKey('Alt-ArrowUp', false)).toBe('Alt-ArrowUp');
    expect(normalizeKey('Shift-Mod-\\', true)).toBe('Mod-Shift-\\');
  });

  it('reads keydown events', () => {
    expect(eventKey(ev('L', { ctrlKey: true, shiftKey: true }), false)).toBe('Mod-Shift-l');
    expect(eventKey(ev('l', { metaKey: true }), true)).toBe('Mod-l');
    expect(eventKey(ev('F5'), false)).toBe('F5');
    expect(eventKey(ev('Control', { ctrlKey: true }), false)).toBeNull();
  });

  it('displays keys for the platform', () => {
    expect(displayKey('Mod-Shift-l', false)).toBe('Ctrl+Shift+L');
    expect(displayKey('Mod-Shift-l', true)).toBe('Cmd+Shift+L');
    expect(displayKey('Mod--', false)).toBe('Ctrl+-');
    expect(displayKey('Mod- ', false)).toBe('Ctrl+Space');
  });

  it('refuses plain typing keys and taken keys', () => {
    const taken = new Map([['Mod-k', 'Search']]);
    expect(checkBinding('l', taken)).toEqual({ ok: false, reason: 'modifier' });
    expect(checkBinding('Shift-l', taken)).toEqual({ ok: false, reason: 'modifier' });
    expect(checkBinding('Mod-k', taken)).toEqual({ ok: false, reason: 'taken', by: 'Search' });
    expect(checkBinding('Mod-Shift-l', taken)).toEqual({ ok: true });
    expect(checkBinding('F6', taken)).toEqual({ ok: true });
  });
});
