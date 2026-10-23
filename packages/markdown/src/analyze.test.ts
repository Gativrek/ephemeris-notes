import { describe, expect, it } from 'vitest';
import { analyzeNote, noteTitle, numberEquations, splitTarget, stringList } from './analyze';
import { parseInfoString, splitArgs } from './infostring';
import { parseYaml } from './yaml';

const KF = `---
title: Kalman Filter
tags: [estimation, filtering]
aliases: [KF]
---
# Kalman Filter

Intro with [[RTK vs PPP|RTK]] and ![[diagram.png|300]] and #estimation. ^intro

## Gain and update

$$ K = P H^T S^{-1} $$ {#eq:kf-gain}

$$
x = x + K y
$$ {#eq:kf-update}

$$ y = z - Hx \\tag{A} $$

See @eq:kf-gain and @eq:missing. Link [doc](../Other%20Note.md#Part) and [web](https://x.org).

\`\`\`plot file=data/run3.csv kind="line plot"
x: t
\`\`\`
`;

describe('analyzeNote', () => {
  const s = analyzeNote(KF);

  it('reads frontmatter', () => {
    expect(s.frontmatter?.error).toBeNull();
    expect(s.frontmatter?.data).toEqual({
      title: 'Kalman Filter',
      tags: ['estimation', 'filtering'],
      aliases: ['KF'],
    });
  });

  it('lists headings with 1-based lines', () => {
    expect(s.headings.map((h) => [h.level, h.text, h.line])).toEqual([
      [1, 'Kalman Filter', 6],
      [2, 'Gain and update', 10],
    ]);
  });

  it('lists links, embeds and local Markdown links, not web links', () => {
    expect(s.links.map((l) => [l.kind, l.target, l.heading, l.alias, l.width])).toEqual([
      ['wikilink', 'RTK vs PPP', null, 'RTK', null],
      ['embed', 'diagram.png', null, null, 300],
      ['markdown', '../Other Note.md', 'Part', null, null],
    ]);
    expect(s.links[0]).toMatchObject({ line: 8, col: 12 });
  });

  it('lists tags and block IDs', () => {
    expect(s.tags.map((t) => t.tag)).toEqual(['estimation']);
    expect(s.blockIds.map((b) => b.id)).toEqual(['intro']);
  });

  it('numbers equations and keeps \\tag', () => {
    expect(s.equations.map((e) => [e.label, e.number])).toEqual([
      ['eq:kf-gain', '1'],
      ['eq:kf-update', '2'],
      [null, 'A'],
    ]);
    expect(s.equations[1]!.tex).toBe('x = x + K y');
  });

  it('lists cross-references', () => {
    expect(s.references.map((r) => r.label)).toEqual(['eq:kf-gain', 'eq:missing']);
  });

  it('lists fenced blocks with parsed info strings and body ranges', () => {
    expect(s.blocks).toHaveLength(1);
    const b = s.blocks[0]!;
    expect(b.lang).toBe('plot');
    expect(b.info.args).toEqual({ positional: [], named: { file: 'data/run3.csv', kind: 'line plot' } });
    expect(KF.slice(b.bodyFrom, b.bodyTo)).toBe('x: t');
  });

  it('flags duplicate labels on the second occurrence', () => {
    const d = analyzeNote('$$a$$ {#eq:x}\n\n$$b$$ {#eq:x}\n');
    expect(d.duplicateLabels.map((x) => x.line)).toEqual([3]);
  });

  it('numbers labeled equations only in labeled mode', () => {
    const doc = '$$a$$\n\n$$b$$ {#eq:b}\n\n$$c$$\n';
    expect(analyzeNote(doc, { numbering: 'labeled' }).equations.map((e) => e.number)).toEqual([
      null,
      '1',
      null,
    ]);
    expect(analyzeNote(doc).equations.map((e) => e.number)).toEqual(['1', '2', '3']);
  });

  it('reports invalid YAML without failing', () => {
    const bad = analyzeNote('---\ntitle: [unclosed\ntags: : :\n---\n# T\n');
    expect(bad.frontmatter?.data).toBeNull();
    expect(bad.frontmatter?.error).toMatch(/Invalid YAML/);
    expect(bad.headings).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('derives the title', () => {
    expect(noteTitle(analyzeNote('# Heading\n'), 'a/b.md')).toBe('Heading');
    expect(noteTitle(analyzeNote('text'), 'a/My Note.md')).toBe('My Note');
    expect(noteTitle(analyzeNote('---\ntitle: FM\n---\n# H\n'), 'x.md')).toBe('FM');
  });

  it('splits targets', () => {
    expect(splitTarget('N#H')).toEqual({ target: 'N', heading: 'H', block: null, page: null });
    expect(splitTarget('N#^b1')).toEqual({ target: 'N', heading: null, block: 'b1', page: null });
    expect(splitTarget('p.pdf#page=12')).toEqual({ target: 'p.pdf', heading: null, block: null, page: 12 });
  });

  it('numbers equations directly', () => {
    expect(
      numberEquations(
        [
          { label: null, tex: 'a \\notag' },
          { label: null, tex: 'b' },
        ],
        'all',
      ),
    ).toEqual([null, '1']);
  });

  it('reads string lists', () => {
    expect(stringList(['a', 2])).toEqual(['a', '2']);
    expect(stringList('a, b')).toEqual(['a', 'b']);
    expect(stringList(undefined)).toEqual([]);
  });
});

describe('info strings (SPECS 12.5)', () => {
  it('splits language, positional and named args with quotes', () => {
    expect(parseInfoString('Combo gbvsr')).toEqual({
      language: 'combo',
      rest: 'gbvsr',
      args: { positional: ['gbvsr'], named: {} },
    });
    expect(parseInfoString('plot file=data/run3.csv kind=line').args.named).toEqual({
      file: 'data/run3.csv',
      kind: 'line',
    });
    expect(splitArgs('a "b c" "say \\"hi\\"" d=""')).toEqual(['a', 'b c', 'say "hi"', 'd=']);
    expect(parseInfoString('')).toEqual({ language: '', rest: '', args: { positional: [], named: {} } });
  });
});

describe('parseYaml', () => {
  it('converts mappings, sequences and scalars', () => {
    expect(
      parseYaml("a: 1\nb: 2.5\nc: true\nd: null\ne: 'it''s'\nf: \"x\\ny\"\ng: [1, two]\nh:\n  - k\n").value,
    ).toEqual({
      a: 1,
      b: 2.5,
      c: true,
      d: null,
      e: "it's",
      f: 'x\ny',
      g: [1, 'two'],
      h: ['k'],
    });
  });
  it('reads block scalars', () => {
    expect(parseYaml('t: |\n  one\n  two\n').value).toEqual({ t: 'one\ntwo\n' });
    expect(parseYaml('t: >-\n  one\n  two\n').value).toEqual({ t: 'one two' });
  });
});
