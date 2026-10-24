import { describe, expect, it } from 'vitest';
import type { FileEntry, VaultInfo } from '@shared/bridge';
import { buildOutline } from './outlineModel';
import {
  buildSections,
  buildTree,
  dailyParts,
  sectionIcon,
  sortEntries,
  visibleTiles,
  type Listing,
} from './tree';

const vault: VaultInfo = {
  path: 'Academic/GNSS Study',
  folder: 'GNSS Study',
  domain: 'academic',
  id: 'x',
  name: 'GNSS',
  created: '',
  order: 1,
  cover: null,
  coverVersion: 0,
  banner: null,
  bannerVersion: 0,
  sectionIcons: {},
  settings: { attachments: '_attachments', templates: '_templates', daily: 'Daily' },
  sectionOrder: null,
  noteCount: 0,
  lastEdited: null,
  broken: false,
};

const f = (path: string, kind: 'file' | 'folder' = 'file'): FileEntry => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  kind,
});

describe('buildSections', () => {
  const files = [
    'Academic/GNSS Study/Notes/a.md',
    'Academic/GNSS Study/Notes/b.md',
    'Academic/GNSS Study/Loose.md',
    'Academic/GNSS Study/Daily/2026-10-20.md',
  ];

  it('orders sections alphabetically, then daily, then Unfiled last', () => {
    const s = buildSections(vault, ['Papers', 'Notes', '_attachments', '.hidden', 'Daily', 'Data'], files);
    expect(s.map((x) => [x.kind, x.name, x.noteCount])).toEqual([
      ['section', 'Data', 0],
      ['section', 'Notes', 2],
      ['section', 'Papers', 0],
      ['daily', 'Daily', 1],
      ['unfiled', 'Unfiled', 1],
    ]);
  });

  it('honours sectionOrder from vault.json', () => {
    const s = buildSections({ ...vault, sectionOrder: ['Papers', 'Data'] }, ['Data', 'Notes', 'Papers'], []);
    expect(s.map((x) => x.name)).toEqual(['Papers', 'Data', 'Notes']);
  });

  it('shows at most six tiles, the sixth becoming More', () => {
    const many = buildSections(vault, ['A', 'B', 'C', 'D', 'E', 'F', 'G'], []);
    expect(visibleTiles(many, false)).toMatchObject({ more: true });
    expect(visibleTiles(many, false).tiles).toHaveLength(5);
    expect(visibleTiles(many, true).tiles).toHaveLength(7);
    expect(visibleTiles(many.slice(0, 6), false)).toMatchObject({ more: false });
  });

  it('picks section icons by name', () => {
    expect(sectionIcon('Papers', 'section')).toBe('papers');
    expect(sectionIcon('GNSS', 'section')).toBe('orbit');
    expect(sectionIcon('Whatever', 'section')).toBe('folder');
    expect(sectionIcon('Daily', 'daily')).toBe('calendar');
    // A chosen icon wins; an unknown name falls back to the automatic one.
    expect(sectionIcon('Whatever', 'section', 'gyro')).toBe('gyro');
    expect(sectionIcon('Papers', 'section', 'not-an-icon')).toBe('papers');
    // An icon the picker no longer offers stays on a section that wears it.
    expect(sectionIcon('Whatever', 'section', 'upload')).toBe('upload');
  });

  it('knows everyday section names, not only one field', () => {
    const cases: Array<[string, string]> = [
      ['Recipes', 'cooking'],
      ['Travel Plans', 'travel'],
      ['Workouts', 'health'],
      ['Budget 2026', 'money'],
      ['Book Notes', 'reading'],
      ['Journal', 'pencil'],
      ['Side Projects Code', 'code'],
      ['Biology', 'science'],
      ['Calculus', 'math'],
      ['Song Ideas', 'idea'],
      ['Guitar', 'music'],
      ['Art History', 'art'],
      ['Photography', 'photo'],
      ['Games', 'games'],
      ['Family', 'people'],
      ['Garden', 'nature'],
      ['Kalman Filtering', 'estimation'],
      // Whole words only: "Smart Home" is not art, "Start Here" not a game.
      ['Smart Home', 'folder'],
      ['Start Here', 'folder'],
    ];
    for (const [name, icon] of cases) expect([name, sectionIcon(name, 'section')]).toEqual([name, icon]);
  });
});

describe('buildTree', () => {
  const root = 'Academic/GNSS Study/Notes';
  const listing: Listing = new Map([
    [
      root,
      [
        f(`${root}/Lectures`, 'folder'),
        f(`${root}/Intro.md`),
        f(`${root}/Index.md`),
        f(`${root}/paper.pdf`),
        f(`${root}/data.csv`),
      ],
    ],
    [
      `${root}/Lectures`,
      [
        f(`${root}/Lectures/Lecture 10.md`),
        f(`${root}/Lectures/Lecture 2.md`),
        f(`${root}/Lectures/Deep`, 'folder'),
      ],
    ],
    [`${root}/Lectures/Deep`, [f(`${root}/Lectures/Deep/x.md`), f(`${root}/Lectures/Deep/Deeper`, 'folder')]],
    [`${root}/Lectures/Deep/Deeper`, [f(`${root}/Lectures/Deep/Deeper/Third.md`)]],
  ]);
  const tree = buildTree(root, listing, { dailyFolder: 'Academic/GNSS Study/Daily' });

  it('sorts folders first, then names naturally', () => {
    expect(tree.map((n) => n.name)).toEqual(['Lectures', 'data.csv', 'Index.md', 'Intro.md', 'paper.pdf']);
    expect(tree[0]!.children.map((n) => n.name)).toEqual(['Deep', 'Lecture 2.md', 'Lecture 10.md']);
  });

  it('types rows: folder, note, PDF, attachment', () => {
    expect(tree.map((n) => n.kind)).toEqual(['folder', 'attachment', 'note', 'note', 'pdf']);
    expect(tree[0]!.count).toBe(4);
  });

  it('flattens content deeper than two levels with its path as meta', () => {
    const deep = tree[0]!.children[0]!;
    expect(deep.children.map((n) => [n.name, n.meta])).toEqual([
      ['x.md', null],
      ['Third.md', 'Deeper'],
    ]);
    expect(deep.children.every((n) => n.children.length === 0)).toBe(true);
  });

  it('marks daily notes in the daily folder', () => {
    const daily = buildTree(
      'Academic/GNSS Study/Daily',
      new Map([
        [
          'Academic/GNSS Study/Daily',
          [f('Academic/GNSS Study/Daily/2026-10-20.md'), f('Academic/GNSS Study/Daily/notes.md')],
        ],
      ]),
      {
        dailyFolder: 'Academic/GNSS Study/Daily',
      },
    );
    expect(daily.map((n) => n.kind)).toEqual(['daily', 'note']);
    expect(dailyParts('2026-10-20.md').day).toBe('20');
  });

  it('sortEntries is natural', () => {
    expect(sortEntries([f('a/x 10'), f('a/x 2'), f('a/Z', 'folder')]).map((e) => e.name)).toEqual([
      'Z',
      'x 2',
      'x 10',
    ]);
  });
});

describe('buildOutline', () => {
  it('groups links, equations and code under headings, with a Top entry', () => {
    const text =
      'Intro [[A]]\n\n# Title\n\n$$x$$ {#eq:a}\n\n## Part\n\n[[Missing]] and ![[img.png]]\n\n```matlab\nx\n```\n';
    const m = buildOutline(text, 'n.md', (t) => (t === 'A' ? 'A.md' : null), []);
    expect(m.headings.map((h) => [h.level, h.text, h.items.map((i) => i.kind)])).toEqual([
      [0, 'Top', ['link']],
      [1, 'Title', ['equation']],
      [2, 'Part', ['link', 'embed', 'code']],
    ]);
    expect(m.headings[0]!.items[0]).toMatchObject({ kind: 'link', target: 'A', resolved: 'A.md' });
    expect(m.headings[2]!.items[0]).toMatchObject({ resolved: null });
  });
});
