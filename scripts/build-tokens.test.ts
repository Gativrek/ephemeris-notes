import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OUTPUT, generate } from './build-tokens';

const repo = resolve(import.meta.dirname, '..');

describe('pnpm tokens', () => {
  const css = generate();

  it('matches the committed tokens.css', () => {
    expect(readFileSync(OUTPUT, 'utf8')).toBe(css);
  });

  it('matches the design system’s own preview copy', () => {
    const design = readFileSync(resolve(repo, 'design/tokens.css'), 'utf8');
    const body = (s: string) => s.slice(s.indexOf(':root {'));
    expect(body(css)).toBe(body(design));
  });

  it('defines every variable bundle.css uses', () => {
    const bundle = readFileSync(resolve(repo, 'design/components/bundle.css'), 'utf8');
    const used = new Set([...bundle.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]!));
    // Set per component by the consumer, not tokens (see the component READMEs).
    for (const local of ['domain', 'domain-soft', 'band-mark']) used.delete(local);
    const defined = new Set([...css.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]!));
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
  });

  it('gives the dark theme only theme-dependent tokens', () => {
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
    expect(dark).toContain('--surface: #1b1f24;');
    expect(dark).not.toContain('--chooser-ground');
    expect(dark).not.toContain('--space-1');
  });
});
