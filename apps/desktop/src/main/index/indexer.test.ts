import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LinkCatalog, analyzeNote, resolvesUniquelyInObsidian } from '@ephemeris-notes/markdown';
import { openDb, type Db } from './db';
import { LibraryIndex } from './indexer';
import { parseQuery, snippets, toFtsMatch } from './query';
import { planRename } from './rename';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/library');
const LIB_ID = '3f2b8c1e-4d5a-4e6f-9a7b-1c2d3e4f5a6b';

let tmp: string;
let lib: string;
let db: Db;
let index: LibraryIndex;
const file = (rel: string) => path.join(lib, ...rel.split('/'));

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-index-'));
  lib = path.join(tmp, 'library');
  await fs.cp(fixture, lib, { recursive: true });
  db = openDb(path.join(tmp, 'index.sqlite'));
  LibraryIndex.prepare(db, LIB_ID);
  index = new LibraryIndex(db, lib);
  await index.sync();
});
afterEach(async () => {
  db.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const titles = (q: string, scope: Parameters<LibraryIndex['search']>[1] = { kind: 'all' }) =>
  index.search(q, scope).map((h) => h.title);

describe('query translation', () => {
  it('parses words, phrases, exclusions and filters', () => {
    expect(
      parseQuery('kalman "measurement update" -gnss tag:#est path:Notes vault:"GNSS Study" ext:.pdf'),
    ).toEqual({
      terms: ['kalman'],
      phrases: ['measurement update'],
      excludes: ['gnss'],
      tags: ['est'],
      paths: ['Notes'],
      vaults: ['GNSS Study'],
      exts: ['pdf'],
    });
  });

  it('escapes user text and never passes raw FTS5 through', () => {
    expect(toFtsMatch(parseQuery('a OR b'))).toBe('"a" AND "OR" AND "b"*');
    expect(toFtsMatch(parseQuery('a"b'))).toBe('"a""b"*');
    expect(toFtsMatch(parseQuery('col:x NEAR(a b)'))).toBe('"col:x" AND "NEAR(a" AND "b)"*');
    expect(toFtsMatch(parseQuery('-only'))).toBeNull();
  });

  it('marks matches in up to two snippets, folding diacritics', () => {
    const s = snippets('A navegação inercial. Later, more navegacao here.', parseQuery('navegacao'));
    expect(s.length).toBeGreaterThanOrEqual(1);
    expect(s[0]!.filter((p) => p.hit).map((p) => p.text)).toContain('navegação');
  });
});

describe('search (SPECS 6.2)', () => {
  it('finds notes by words, case and diacritics folded', () => {
    expect(titles('kalman')).toContain('Kalman Filter');
    expect(titles('navegacao')).toContain('Navegação inercial');
    expect(titles('NAVEGAÇÃO')).toContain('Navegação inercial');
  });

  it('ANDs words, matches phrases, excludes words', () => {
    expect(titles('measurement update')).toEqual(['Kalman Filter']);
    expect(titles('"base station"')).toEqual(['RTK vs PPP']);
    expect(titles('kalman -rtk')).not.toContain('RTK vs PPP');
  });

  it('filters by tag (nested too), path, vault and extension', () => {
    expect(titles('tag:#estimation')).toEqual(['Kalman Filter']);
    expect(titles('tag:planning')).toEqual(['RRT']);
    expect(titles('index path:Specs')).toEqual(expect.arrayContaining(['Specs Index']));
    expect(titles('index path:Specs').every((t) => ['Specs Index', 'Navigation'].includes(t))).toBe(true);
    expect(titles('index vault:acme')).toEqual(expect.arrayContaining(['Specs Index', 'Navigation']));
    expect(titles('index vault:"GNSS Constellation"')).toEqual(expect.arrayContaining(['GNSS Index']));
    expect(index.search('ext:pdf', { kind: 'all' }).map((h) => [h.kind, h.title])).toEqual([
      ['file', 'paper.pdf'],
    ]);
    expect(
      index.search('diagram', { kind: 'all' }).some((h) => h.kind === 'file' && h.title === 'diagram.png'),
    ).toBe(true);
  });

  it('respects Vault, Domain and All scopes', () => {
    expect(titles('index', { kind: 'vault', vaultPath: 'Academic/GNSS Study' }).sort()).toEqual([
      'GNSS Index',
      'Intro',
    ]);
    expect(titles('index', { kind: 'domain', domain: 'work' }).sort()).toEqual(['Navigation', 'Specs Index']);
    expect(titles('index').filter((t) => t.endsWith('Index')).length).toBe(3);
  });

  it('returns highlighted snippets', () => {
    const hit = index.search('innovation', { kind: 'all' })[0]!;
    expect(hit.snippets[0]!.some((p) => p.hit && p.text.toLowerCase() === 'innovation')).toBe(true);
  });
});

describe('links and backlinks (SPECS 5)', () => {
  it('lists backlinks with line and context', () => {
    const b = index.backlinks('Academic/Knowledge/Concepts/Kalman Filter.md');
    // One entry per linking note.
    expect(b.map((x) => x.path).sort()).toEqual([
      'Academic/GNSS Study/Notes/Intro.md',
      'Academic/Knowledge/Concepts/Index.md',
      'Academic/Knowledge/Concepts/RTK vs PPP.md',
      'Archive/Old Obsidian note.md',
      'Work/Acme Robotics/Specs/Navigation.md',
    ]);
    expect(b.find((x) => x.path.endsWith('Intro.md'))!.snippet).toContain('Start with the [[Kalman Filter]]');
  });

  it('reports ambiguous links', () => {
    const amb = index.ambiguousLinks();
    expect(amb.some((a) => a.src === 'Academic/GNSS Study/Notes/Intro.md' && a.target === 'Index')).toBe(
      true,
    );
  });

  it('resolves frontmatter aliases', () => {
    expect(index.links.resolve('KF', 'x.md').path).toBe('Academic/Knowledge/Concepts/Kalman Filter.md');
  });

  it('gives the link graph of a scope, as backlinks see it (SPECS 12.13.1)', () => {
    const kalman = 'Academic/Knowledge/Concepts/Kalman Filter.md';
    const all = index.linkGraph({ kind: 'all' });
    expect(
      all.links
        .filter((l) => l.to === kalman)
        .map((l) => l.from)
        .sort(),
    ).toEqual(
      index
        .backlinks(kalman)
        .map((b) => b.path)
        .sort(),
    );
    // One row per pair, no links to self.
    const pairs = all.links.map((l) => `${l.from} > ${l.to}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(all.links.every((l) => l.from !== l.to && l.count >= 1)).toBe(true);
    expect(all.notes.length).toBe(index.notesIn({ kind: 'all' }).length);

    const vault = index.linkGraph({ kind: 'vault', vaultPath: 'Academic/GNSS Study' });
    expect(vault.notes.every((n) => n.path.startsWith('Academic/GNSS Study/'))).toBe(true);
    expect(vault.links.every((l) => l.from.startsWith('Academic/GNSS Study/'))).toBe(true);
    // Links leave the scope: Intro links to the Kalman Filter concept note in Knowledge.
    expect(vault.links).toContainEqual({
      from: 'Academic/GNSS Study/Notes/Intro.md',
      to: kalman,
      count: expect.any(Number),
    });
    expect(
      index.linkGraph({ kind: 'domain', domain: 'work' }).links.every((l) => l.from.startsWith('Work/')),
    ).toBe(true);
  });

  it('updates incrementally: new, changed and deleted notes, and links that start resolving', async () => {
    expect(index.backlinks('Academic/GNSS Study/Notes/Missing Note.md')).toEqual([]);
    await fs.writeFile(
      file('Academic/GNSS Study/Notes/Missing Note.md'),
      '# Missing Note\n\nNow it exists: carrier phase.\n',
    );
    await index.refresh(['Academic/GNSS Study/Notes/Missing Note.md']);
    expect(index.backlinks('Academic/GNSS Study/Notes/Missing Note.md').map((b) => b.path)).toEqual([
      'Academic/GNSS Study/Notes/Intro.md',
    ]);
    expect(titles('carrier')).toContain('Missing Note');
    await fs.rm(file('Academic/GNSS Study/Notes/Missing Note.md'));
    await index.refresh(['Academic/GNSS Study/Notes/Missing Note.md']);
    expect(titles('carrier')).not.toContain('Missing Note');
    await fs.rm(file('Academic/Knowledge'), { recursive: true });
    await index.refresh(['Academic/Knowledge']);
    expect(titles('kalman')).not.toContain('Kalman Filter');
    expect(index.backlinks('Academic/Knowledge/Concepts/Kalman Filter.md')).toEqual([]);
  });

  it('lists links to passages of a PDF, and only those (SPECS 10.8.1)', async () => {
    const pdf = 'Academic/GNSS Study/Papers/paper.pdf';
    const note = 'Academic/GNSS Study/Notes/Reading.md';
    await fs.writeFile(
      file(note),
      [
        '# Reading',
        '',
        '> A passage.',
        '> — [[paper.pdf#page=2&selection=0,3,0,9|p. 2]]',
        'Same passage, PDF++ style: [[paper.pdf#page=2&selection=0,3,0,9&color=yellow]]',
        'A page only: [[paper.pdf#page=3]], the file: [[paper.pdf]]',
        '',
      ].join('\n'),
    );
    await index.refresh([note]);
    expect(index.pdfHighlights(pdf)).toEqual([
      { path: note, title: 'Reading', line: 4, col: 5, page: 2, selection: [0, 3, 0, 9] },
      { path: note, title: 'Reading', line: 5, col: 28, page: 2, selection: [0, 3, 0, 9] },
    ]);
    expect(index.backlinks(pdf).map((b) => b.path)).toContain(note);
  });

  it('a second sync with nothing changed does nothing', async () => {
    expect(await index.sync()).toEqual({ indexed: 0, removed: 0 });
  });

  it('rebuilds when the schema or library changes', () => {
    expect(LibraryIndex.prepare(db, LIB_ID).rebuilt).toBe(false);
    expect(LibraryIndex.prepare(db, '00000000-0000-4000-8000-000000000000').rebuilt).toBe(true);
  });
});

describe('rename planning', () => {
  const allPaths = () =>
    db
      .prepare('SELECT path FROM files')
      .all()
      .map((r) => String(r.path));

  it('rewrites links into a renamed note to the new shortest link', async () => {
    const plan = await planRename(
      index,
      allPaths(),
      'Academic/Knowledge/Concepts/Kalman Filter.md',
      'Academic/Knowledge/Concepts/Kalman Filtering.md',
    );
    const intro = plan.find((p) => p.newPath === 'Academic/GNSS Study/Notes/Intro.md')!;
    expect(intro.text).toContain('Start with the [[Kalman Filtering]]');
    expect(intro.text).toContain('[[Kalman Filtering#Gain and update]]');
    expect(intro.text).toContain('[[Kalman Filtering#^kf-summary]]');
    const rtk = plan.find((p) => p.newPath.endsWith('RTK vs PPP.md'))!;
    expect(rtk.text).toContain('[[Kalman Filtering|KF]]');
    const nav = plan.find((p) => p.newPath.endsWith('Navigation.md'))!;
    expect(nav.text).toContain('[[Kalman Filtering]]');
    // Untouched notes are not in the plan.
    expect(plan.some((p) => p.newPath.endsWith('Lecture 2.md'))).toBe(false);
  });

  it('follows a folder move, including notes inside it', async () => {
    const plan = await planRename(index, allPaths(), 'Academic/Knowledge', 'Personal/Knowledge');
    const inside = plan.find((p) => p.oldPath === 'Academic/Knowledge/Concepts/RTK vs PPP.md');
    // Links by unique name keep working, so they are left as they are.
    expect(inside).toBeUndefined();
    const nav = plan.find((p) => p.newPath.endsWith('Navigation.md'))!;
    expect(nav.text).toContain('[[Kalman Filter]]');
    expect(nav.text).not.toContain('Academic/Knowledge');
  });
});

describe('Obsidian compatibility (SPECS 17)', () => {
  it('every link written for a fixture file resolves to it under Obsidian rules', () => {
    const paths = db
      .prepare('SELECT path FROM files')
      .all()
      .map((r) => String(r.path));
    const cat = new LinkCatalog(paths);
    for (const p of paths) {
      const link = cat.shortestLink(p);
      expect(resolvesUniquelyInObsidian(link, paths), `${p} as [[${link}]]`).toBe(p);
    }
    void analyzeNote;
  });
});

describe('plugin extractors in the index (SPECS 12.11.2)', () => {
  const spec = { id: 'tags', version: 1, kind: 'regex', pattern: '^sample-tag:: (?<tag>\\S+)', key: 'tag' };
  const note = 'Academic/GNSS Study/Notes/Tags.md';

  it('extracts on registration, follows edits, keeps records when disabled', async () => {
    await fs.writeFile(file(note), 'sample-tag:: alpha\nsample-tag:: beta\n');
    await index.sync();
    const changed: string[][] = [];
    const idx = new LibraryIndex(db, lib, { onRecords: (p) => changed.push(p) });
    await idx.sync();
    await idx.registerExtractor('sample', spec);
    idx.flushRecordChanges();
    expect(changed).toEqual([['sample']]);
    expect(idx.queryRecords('sample', { extractor: 'tags' }).map((r) => `${r.key}@${r.line}`)).toEqual([
      'alpha@1',
      'beta@2',
    ]);
    expect(idx.queryRecords('sample', { extractor: 'tags', keyPrefix: 'be' })).toHaveLength(1);
    expect(
      idx.queryRecords('sample', {
        extractor: 'tags',
        scope: { kind: 'vault', vaultPath: 'Work/Acme Robotics' },
      }),
    ).toHaveLength(0);

    await fs.writeFile(file(note), 'sample-tag:: gamma\n');
    await idx.refresh([note]);
    expect(idx.queryRecords('sample', { extractor: 'tags' }).map((r) => r.key)).toEqual(['gamma']);

    // Same version again: nothing is re-extracted; disabling keeps the records.
    await idx.registerExtractor('sample', spec);
    idx.unregisterExtractor('sample', 'tags');
    expect(idx.queryRecords('sample', { extractor: 'tags' }).map((r) => r.key)).toEqual(['gamma']);
  });

  it('refuses a spec that does not compile', async () => {
    await expect(index.registerExtractor('sample', { ...spec, pattern: '(' })).rejects.toThrow(/compile/);
  });
});
