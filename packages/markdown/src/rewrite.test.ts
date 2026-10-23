import { describe, expect, it } from 'vitest';
import { LinkCatalog } from './links';
import { relativePath, resolvesUniquelyInObsidian, rewriteLinks } from './rewrite';

describe('rewriteLinks', () => {
  it('changes only the target part of wikilinks and embeds', () => {
    const text = 'See [[Old]], [[Old#Part|shown]], ![[Old#^b1]] and [[Other]].\n| t | [[Old\\|alias]] |\n';
    const r = rewriteLinks(text, (l) => (l.target === 'Old' ? 'New' : null));
    expect(r.changed).toBe(4);
    expect(r.text).toBe(
      'See [[New]], [[New#Part|shown]], ![[New#^b1]] and [[Other]].\n| t | [[New\\|alias]] |\n',
    );
  });

  it('rewrites Markdown links, keeping fragments, titles and %20 encoding', () => {
    const text = '[a](Old%20Note.md#Sec "Title") and [b](<Old Note.md>)\n';
    const r = rewriteLinks(text, (l) => (l.target === 'Old Note.md' ? 'Dir/New Note.md' : null));
    expect(r.text).toBe('[a](Dir/New%20Note.md#Sec "Title") and [b](<Dir/New Note.md>)\n');
  });

  it('leaves text untouched when nothing changes, byte for byte', () => {
    const text = '---\ntitle: x\n---\n[[A]] \r\n';
    expect(rewriteLinks(text, () => null)).toEqual({ text, changed: 0 });
    expect(rewriteLinks(text, (l) => l.target).changed).toBe(0);
  });

  it('ignores links inside code', () => {
    const text = '`[[Old]]`\n\n```\n[[Old]]\n```\n[[Old]]\n';
    expect(rewriteLinks(text, (l) => (l.target === 'Old' ? 'New' : null)).text).toBe(
      '`[[Old]]`\n\n```\n[[Old]]\n```\n[[New]]\n',
    );
  });
});

describe('relativePath', () => {
  it('walks up and down', () => {
    expect(relativePath('A/B/n.md', 'A/C/t.md')).toBe('../C/t.md');
    expect(relativePath('A/n.md', 'A/t.md')).toBe('t.md');
    expect(relativePath('n.md', 'A/t.md')).toBe('A/t.md');
  });
});

describe('Obsidian compatibility (SPECS 17)', () => {
  const paths = [
    'A/K/Index.md',
    'A/G/Index.md',
    'W/S/Index.md',
    'A/K/Kalman Filter.md',
    'A/G/paper.pdf',
    'X/v1.2 notes.md',
  ];
  const cat = new LinkCatalog(paths);
  it('every link the app writes resolves to exactly the same file under Obsidian rules', () => {
    for (const p of paths) {
      const link = cat.shortestLink(p);
      expect(resolvesUniquelyInObsidian(link, paths), link).toBe(p);
    }
  });
});
