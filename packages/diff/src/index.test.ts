import { describe, expect, it } from 'vitest';
import { countChanges, diffLines, diffWords, rows, splitLines } from './index';

const join = (...l: string[]) => l.join('\n') + '\n';

describe('diffLines', () => {
  it('finds added, removed and kept lines', () => {
    const ops = diffLines(join('a', 'b', 'c', 'd'), join('a', 'c', 'x', 'd'));
    expect(ops).toEqual([
      { type: 'equal', lines: ['a'] },
      { type: 'delete', lines: ['b'] },
      { type: 'equal', lines: ['c'] },
      { type: 'insert', lines: ['x'] },
      { type: 'equal', lines: ['d'] },
    ]);
    expect(countChanges(ops)).toEqual({ added: 1, removed: 1 });
  });
  it('treats CRLF and LF alike, and a final line end as no line', () => {
    expect(diffLines('a\r\nb\r\n', 'a\nb\n')).toEqual([{ type: 'equal', lines: ['a', 'b'] }]);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual(['']);
  });
  it('handles empty sides', () => {
    expect(diffLines('', join('x'))).toEqual([
      { type: 'delete', lines: [''] },
      { type: 'insert', lines: ['x'] },
    ]);
    expect(countChanges(diffLines(join('a', 'b'), join('a', 'b', 'c', 'd')))).toEqual({
      added: 2,
      removed: 0,
    });
  });
  it('gives up past the edit cap without running away, reporting a whole replacement', () => {
    const a = Array.from({ length: 6000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 6000 }, (_, i) => `b${i}`).join('\n');
    const t = Date.now();
    const ops = diffLines(a, b);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(countChanges(ops)).toEqual({ added: 6000, removed: 6000 });
  });
  it('is minimal on a long note with a few changes', () => {
    const base = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
    const changed = [...base];
    changed[100] = 'edited';
    changed.splice(15000, 1);
    changed.push('new end');
    expect(countChanges(diffLines(base.join('\n'), changed.join('\n')))).toEqual({ added: 2, removed: 2 });
  });
});

describe('diffWords', () => {
  it('marks the changed words of a line pair', () => {
    const w = diffWords('The gain weighs the prediction.', 'The Kalman gain weighs the measurement.');
    expect(w.old.filter((p) => p.changed).map((p) => p.text)).toEqual(['prediction']);
    expect(w.new.filter((p) => p.changed).map((p) => p.text)).toEqual(['Kalman ', 'measurement']);
    expect(w.old.map((p) => p.text).join('')).toBe('The gain weighs the prediction.');
  });
});

describe('rows', () => {
  it('keeps three lines of context and folds the rest, pairing changed lines', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const b = [...a];
    b[10] = 'l10 changed';
    const r = rows(diffLines(a.join('\n'), b.join('\n')));
    expect(r[0]).toEqual({ kind: 'fold', count: 7, oldLine: 1, newLine: 1 });
    expect(r.slice(1, 4).map((x) => x.kind)).toEqual(['equal', 'equal', 'equal']);
    const del = r[4]!;
    const ins = r[5]!;
    expect(del).toMatchObject({ kind: 'delete', text: 'l10', oldLine: 11 });
    expect(ins).toMatchObject({ kind: 'insert', text: 'l10 changed', newLine: 11 });
    expect(ins.kind === 'insert' && ins.words?.filter((w) => w.changed).map((w) => w.text)).toEqual([
      ' changed',
    ]);
    expect(r.at(-1)).toEqual({ kind: 'fold', count: 6, oldLine: 15, newLine: 15 });
  });
  it('does not fold a short run between changes', () => {
    const r = rows(
      diffLines(join('a', '1', '2', '3', '4', '5', '6', 'b'), join('A', '1', '2', '3', '4', '5', '6', 'B')),
    );
    expect(r.some((x) => x.kind === 'fold')).toBe(false);
  });
});
