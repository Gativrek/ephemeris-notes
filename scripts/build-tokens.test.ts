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

  it('agrees with the design system’s own preview copy', () => {
    // The export lays its file out differently (light block, dark block, then shared
    // values), so compare values: every variable it defines has the same value here.
    const design = readFileSync(resolve(repo, 'design/tokens.css'), 'utf8');
    const blocks = (s: string) =>
      [...s.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
        dark: /data-theme="dark"/.test(m[1]!),
        vars: new Map([...m[2]!.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((v) => [v[1]!, v[2]!.trim()])),
      }));
    const merged = (s: string, dark: boolean) => {
      const out = new Map<string, string>();
      for (const b of blocks(s))
        if (b.dark === dark) for (const [k, v] of b.vars) if (!out.has(k)) out.set(k, v);
      return out;
    };
    for (const dark of [false, true]) {
      const app = merged(css, dark);
      const mismatched = [...merged(design, dark)].filter(([k, v]) => app.get(k) !== v);
      expect(mismatched, dark ? 'dark' : 'light').toEqual([]);
    }
  });

  it('defines every variable bundle.css uses', () => {
    const bundle = readFileSync(resolve(repo, 'design/components/bundle.css'), 'utf8');
    const used = new Set([...bundle.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]!));
    // Set per component by the consumer, not tokens (see the component READMEs), and the
    // two Settings > Editor values the editor sets inline (with fallbacks).
    for (const local of ['domain', 'domain-soft', 'band-mark', 'editor-font-size', 'editor-measure'])
      used.delete(local);
    const defined = new Set([...css.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]!));
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
  });

  it('gives the dark theme only theme-dependent tokens', () => {
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf('[data-theme="light"]'));
    expect(dark).toContain('--surface: #1b1f24;');
    expect(dark).not.toContain('--chooser-ground');
    expect(dark).not.toContain('--space-1');
  });
});
