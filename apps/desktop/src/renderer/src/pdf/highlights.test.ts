import { describe, expect, it } from 'vitest';
import {
  appendChange,
  cleanQuote,
  highlightBlock,
  highlightRange,
  highlightsNotePath,
  newHighlightsNote,
  quoteOf,
} from './highlights';

const items = [
  { str: 'Carrier-phase measurements are ambigu-', hasEOL: true },
  { str: 'ous by an integer', hasEOL: false },
  { str: ' number of cycles.', hasEOL: true },
  { str: '', hasEOL: false },
  { str: 'Next paragraph.', hasEOL: false },
];

describe('quotes', () => {
  it('takes the passage between the offsets, joining hyphenated lines', () => {
    expect(quoteOf(items, [0, 0, 2, 18])).toBe(
      'Carrier-phase measurements are ambiguous by an integer number of cycles.',
    );
    expect(quoteOf(items, [0, 14, 0, 26])).toBe('measurements');
    expect(quoteOf(items, [1, 7, 4, 4])).toBe('an integer number of cycles. Next');
  });

  it('refuses a selection that does not fit the page', () => {
    expect(quoteOf(items, [2, 0, 9, 1])).toBeNull();
    expect(quoteOf(items, [3, 0, 1, 1])).toBeNull();
    expect(quoteOf(items, [3, 0, 3, 0])).toBeNull();
  });

  it('cleans whitespace and broken words', () => {
    expect(cleanQuote('  informa- tion\n\tsystems ')).toBe('information systems');
    // A hyphen before a capital (a name, a compound) stays.
    expect(cleanQuote('Runge- Kutta')).toBe('Runge- Kutta');
  });
});

describe('the highlights note', () => {
  it('writes a highlight as a quote and its link', () => {
    expect(highlightBlock('A passage.', 'paper.pdf', 3, [4, 0, 6, 12])).toBe(
      '> A passage.\n> — [[paper.pdf#page=3&selection=4,0,6,12|p. 3]]\n',
    );
  });

  it('sits beside the PDF and starts with its name', () => {
    expect(highlightsNotePath('Academic/GNSS/Papers/paper.pdf')).toBe(
      'Academic/GNSS/Papers/paper highlights.md',
    );
    expect(highlightsNotePath('paper.PDF')).toBe('paper highlights.md');
    expect(newHighlightsNote('A/paper.pdf', 'paper.pdf')).toBe(
      '---\npdf: "[[paper.pdf]]"\n---\n\n# paper highlights\n\n',
    );
  });

  it('appends after one blank line', () => {
    expect(appendChange('', 'X\n')).toEqual({ from: 0, insert: 'X\n' });
    expect(appendChange('# p\n\n', 'X\n')).toEqual({ from: 5, insert: 'X\n' });
    expect(appendChange('# p\n', 'X\n')).toEqual({ from: 4, insert: '\nX\n' });
    expect(appendChange('# p', 'X\n')).toEqual({ from: 3, insert: '\n\nX\n' });
  });

  it('finds the lines a highlight takes, and only for highlights written as such', () => {
    const text = [
      '# paper',
      '',
      '> First.',
      '> — [[paper.pdf#page=1&selection=0,0,0,6|p. 1]]',
      '',
      '> Second, on',
      '> two lines.',
      '> — [[paper.pdf#page=2&selection=1,0,2,9|p. 2]]',
      '',
      'See [[paper.pdf#page=3&selection=0,0,0,1]].',
      '',
    ].join('\n');
    const cut = (line: number) => {
      const r = highlightRange(text, line);
      return r && text.slice(0, r.from) + text.slice(r.to);
    };
    expect(cut(4)).toBe(
      [
        '# paper',
        '',
        '> Second, on',
        '> two lines.',
        '> — [[paper.pdf#page=2&selection=1,0,2,9|p. 2]]',
        '',
        'See [[paper.pdf#page=3&selection=0,0,0,1]].',
        '',
      ].join('\n'),
    );
    expect(cut(8)).toBe(
      [
        '# paper',
        '',
        '> First.',
        '> — [[paper.pdf#page=1&selection=0,0,0,6|p. 1]]',
        '',
        'See [[paper.pdf#page=3&selection=0,0,0,1]].',
        '',
      ].join('\n'),
    );
    expect(highlightRange(text, 10)).toBeNull();
    expect(highlightRange(text, 3)).toBeNull();
  });
});
