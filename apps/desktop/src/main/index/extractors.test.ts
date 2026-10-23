import { describe, expect, it } from 'vitest';
import { analyzeNote } from '@ephemeris-notes/markdown';
import { compileExtractor, extract } from './extractors';

const run = (spec: unknown, text: string) => extract(compileExtractor('p', spec), text, analyzeNote(text));

describe('plugin extractors', () => {
  it('extracts regex keys and values outside code, math and frontmatter', () => {
    const text = [
      '---',
      'title: "[@fake]"',
      '---',
      'See [@groves2013, p. 45] and [@kaplan].',
      '',
      '```',
      '[@incode]',
      '```',
      '',
      '$$',
      'x [@inmath]',
      '$$',
      'Last [@b].',
    ].join('\n');
    const r = run(
      {
        id: 'cite',
        version: 1,
        kind: 'regex',
        pattern: '\\[@([\\w-]+)(?:, ([^\\]]+))?\\]',
        key: 1,
        value: 2,
      },
      text,
    );
    expect(r).toEqual([
      { line: 4, key: 'groves2013', value: 'p. 45' },
      { line: 4, key: 'kaplan', value: null },
      { line: 13, key: 'b', value: null },
    ]);
  });

  it('honours where.frontmatter and named groups', () => {
    const card = 'What is a Kalman gain :: the weight on the innovation';
    const spec = {
      id: 'cards',
      version: 1,
      kind: 'regex',
      pattern: '^(?<front>.+?) :: (?<back>.+)$',
      key: 'front',
      value: 'back',
      where: { frontmatter: { flashcards: true } },
    };
    expect(run(spec, `${card}\n`)).toEqual([]);
    expect(run(spec, `---\nflashcards: true\n---\n${card}\n`)).toEqual([
      { line: 4, key: 'What is a Kalman gain', value: 'the weight on the innovation' },
    ]);
  });

  it('extracts fences and frontmatter fields', () => {
    const text = '---\ntags: [a, b]\n---\n```plot file=x.csv\n1,2\n```\n';
    expect(run({ id: 'f', version: 1, kind: 'fence', language: 'plot' }, text)).toEqual([
      { line: 4, key: 'file=x.csv', value: '1,2' },
    ]);
    expect(run({ id: 't', version: 1, kind: 'frontmatter', field: 'tags' }, text)).toEqual([
      { line: 1, key: 'a', value: null },
      { line: 1, key: 'b', value: null },
    ]);
  });

  it('refuses bad specs with a reason', () => {
    expect(() => compileExtractor('p', { id: 'x', version: 1, kind: 'regex', pattern: '(', key: 1 })).toThrow(
      /does not compile/,
    );
    expect(() => compileExtractor('p', { id: 'X!', version: 1, kind: 'fence', language: 'a' })).toThrow(/id/);
    expect(() =>
      compileExtractor('p', { id: 'x', version: 1, kind: 'regex', pattern: 'a'.repeat(513), key: 0 }),
    ).toThrow(/512/);
    expect(() => compileExtractor('p', { id: 'x', version: 1, kind: 'nope' })).toThrow(/kind/);
  });
});
