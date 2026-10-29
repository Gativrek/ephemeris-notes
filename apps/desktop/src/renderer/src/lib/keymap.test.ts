import { describe, expect, it } from 'vitest';
import { fillShortcuts } from '../help/shortcuts';
import { assignKey, commandFor, keysOf, removeKeys, resetKeys, type Overrides } from './keymap';

describe('the keymap', () => {
  it('uses the defaults until a command is changed', () => {
    expect(keysOf('core:search', {})).toEqual(['Mod-k']);
    expect(keysOf('editor:redo', {})).toEqual(['Mod-y', 'Mod-Shift-z']);
    expect(commandFor('Mod-k', {})).toBe('core:search');
    expect(commandFor('Mod-Shift-c', {})).toBe('core:insert-code-block');
    expect(commandFor('Mod-j', {})).toBeUndefined();
  });

  it('reads the older one-key form of a plugin hotkey', () => {
    const o: Overrides = { 'sample-plugin:open': 'Mod-Shift-j' };
    expect(keysOf('sample-plugin:open', o)).toEqual(['Mod-Shift-j']);
    expect(commandFor('Mod-Shift-j', o)).toBe('sample-plugin:open');
  });

  it('moves a key: the command that had it keeps its other keys', () => {
    const o = assignKey({}, 'core:open-note', 'Mod-k');
    expect(commandFor('Mod-k', o)).toBe('core:open-note');
    expect(keysOf('core:search', o)).toEqual([]);
    const r = assignKey({}, 'core:insert-code-block', 'Mod-y');
    expect(keysOf('editor:redo', r)).toEqual(['Mod-Shift-z']);
    expect(keysOf('core:insert-code-block', r)).toEqual(['Mod-y']);
  });

  it('removes and resets, and drops overrides that match the defaults', () => {
    const none = removeKeys({}, 'editor:bold');
    expect(keysOf('editor:bold', none)).toEqual([]);
    expect(commandFor('Mod-b', none)).toBeUndefined();
    expect(resetKeys(none, 'editor:bold')).toEqual({});
    expect(assignKey({}, 'core:search', 'Mod-k')).toEqual({});
  });

  it('resets without taking back a default key another command now has', () => {
    let o = assignKey({}, 'core:search', 'Mod-j');
    o = assignKey(o, 'core:open-note', 'Mod-k');
    o = resetKeys(o, 'core:search');
    expect(keysOf('core:search', o)).toEqual([]);
    expect(commandFor('Mod-k', o)).toBe('core:open-note');
  });
});

describe('the shortcuts help page', () => {
  it('lists the keys as set now', () => {
    const o = assignKey(removeKeys({}, 'editor:bold'), 'core:open-note', 'Mod-Shift-j');
    const md = fillShortcuts('{{shortcuts:app}}\n\n{{shortcuts:editor}}', o, (id) => id, false);
    expect(md).toContain('| core:search | `Ctrl+K` |');
    expect(md).toContain('| core:open-note | `Ctrl+Shift+J` |');
    expect(md).toContain('| editor:bold | None |');
    expect(md).toContain('| editor:redo | `Ctrl+Y` or `Ctrl+Shift+Z` |');
    expect(fillShortcuts('{{shortcuts:app}}', {}, (id) => id, true)).toContain('| core:search | `Cmd+K` |');
  });
});
