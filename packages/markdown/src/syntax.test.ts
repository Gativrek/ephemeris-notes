import { describe, expect, it } from 'vitest';
import { markdownParser } from './syntax';

/** Nodes of the given names with their text, in document order. */
function nodes(text: string, names: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  markdownParser.parse(text).iterate({
    enter(n) {
      if (names.includes(n.name)) out.push([n.name, text.slice(n.from, n.to)]);
    },
  });
  return out;
}

describe('frontmatter', () => {
  it('parses YAML between --- lines at the start', () => {
    const doc = '---\ntitle: X\ntags: [a]\n---\n# Body\n';
    expect(nodes(doc, ['Frontmatter', 'FrontmatterContent'])).toEqual([
      ['Frontmatter', '---\ntitle: X\ntags: [a]\n---'],
      ['FrontmatterContent', 'title: X\ntags: [a]'],
    ]);
    expect(nodes(doc, ['ATXHeading1'])).toEqual([['ATXHeading1', '# Body']]);
  });

  it('accepts ... as the closing line and empty frontmatter', () => {
    expect(nodes('---\na: 1\n...\n', ['Frontmatter'])).toHaveLength(1);
    expect(nodes('---\n---\ntext', ['Frontmatter'])).toEqual([['Frontmatter', '---\n---']]);
  });

  it('is only frontmatter at the very start and when closed', () => {
    expect(nodes('text\n\n---\na: 1\n---\n', ['Frontmatter'])).toEqual([]);
    expect(nodes('---\nnot closed\n', ['Frontmatter'])).toEqual([]);
    expect(nodes('---\nnot closed\n', ['HorizontalRule'])).toHaveLength(1);
  });
});

describe('wikilinks and embeds', () => {
  it.each([
    ['[[Target]]', 'Target', null],
    ['[[Target|alias]]', 'Target', 'alias'],
    ['[[Target#Heading]]', 'Target#Heading', null],
    ['[[Target#^blockid]]', 'Target#^blockid', null],
    ['[[paper.pdf#page=3]]', 'paper.pdf#page=3', null],
    ['[[Folder/Note name|Shown]]', 'Folder/Note name', 'Shown'],
  ])('%s', (src, target, alias) => {
    const found = nodes(`see ${src} here`, ['WikiLink', 'WikiLinkTarget', 'WikiLinkAlias']);
    expect(found[0]).toEqual(['WikiLink', src]);
    expect(found[1]).toEqual(['WikiLinkTarget', target]);
    if (alias) expect(found[2]).toEqual(['WikiLinkAlias', alias]);
    else expect(found).toHaveLength(2);
  });

  it.each(['![[file.png]]', '![[Note]]', '![[paper.pdf#page=3]]', '![[image.png|300]]'])(
    'embed %s',
    (src) => {
      expect(nodes(`x ${src}`, ['Embed'])).toEqual([['Embed', src]]);
    },
  );

  it('supports the escaped pipe inside tables', () => {
    const doc = '| a | b |\n|---|---|\n| [[Note\\|Alias]] | 2 |\n';
    expect(nodes(doc, ['WikiLinkTarget', 'WikiLinkAlias'])).toEqual([
      ['WikiLinkTarget', 'Note'],
      ['WikiLinkAlias', 'Alias'],
    ]);
  });

  it('rejects empty, unclosed and multi-line links', () => {
    expect(nodes('[[]] and [[open', ['WikiLink'])).toEqual([]);
    expect(nodes('[[a\nb]]', ['WikiLink'])).toEqual([]);
  });

  it('leaves Markdown links alone', () => {
    expect(nodes('[text](Note.md)', ['Link'])).toEqual([['Link', '[text](Note.md)']]);
    expect(nodes('[text](Note.md)', ['WikiLink'])).toEqual([]);
  });
});

describe('inline math', () => {
  it.each([
    ['$x$', '$x$'],
    ['$z = Hx + v$', '$z = Hx + v$'],
    ['a $x^2$, b', '$x^2$'],
    ['$$\\int f$$ inline display', '$$\\int f$$'],
    ['$a\\$b$', '$a\\$b$'],
    // A $ after whitespace cannot close: only the later, real math is found.
    ['Costs $5 and $10 are not math. Inline: $z = Hx + v$.', '$z = Hx + v$'],
  ])('%j is math', (src, math) => {
    expect(nodes(src, ['InlineMath'])).toEqual([['InlineMath', math]]);
  });

  it.each([
    ['$5 and $10', 'the closing $ is followed by a digit'],
    ['$ x$', 'opening $ followed by space'],
    ['$x $', 'closing $ preceded by space'],
    ['\\$x$', 'escaped opening $'],
    ['$x\ny$', 'single $ math does not cross lines'],
    ['costs $5', 'no closing $'],
  ])('%j is not math (%s)', (src) => {
    expect(nodes(src, ['InlineMath'])).toEqual([]);
  });

  it('is not parsed inside inline code', () => {
    expect(nodes('`$x$`', ['InlineMath'])).toEqual([]);
  });
});

describe('display math', () => {
  it('parses single-line and multi-line blocks', () => {
    expect(nodes('$$ a = b $$\n', ['MathBlock', 'MathContent'])).toEqual([
      ['MathBlock', '$$ a = b $$'],
      ['MathContent', ' a = b '],
    ]);
    const multi = '$$\nx = 1\ny = 2\n$$\nafter';
    expect(nodes(multi, ['MathBlock'])).toEqual([['MathBlock', '$$\nx = 1\ny = 2\n$$']]);
    expect(nodes(multi, ['Paragraph'])).toEqual([['Paragraph', 'after']]);
  });

  it('reads the label on the closing line', () => {
    expect(nodes('$$ K = PH^T $$ {#eq:kf-gain}\n', ['MathBlock', 'EquationLabel'])).toEqual([
      ['MathBlock', '$$ K = PH^T $$ {#eq:kf-gain}'],
      ['EquationLabel', '{#eq:kf-gain}'],
    ]);
    expect(nodes('$$\nx\n$$ {#eq:x_1:a-b}\n', ['EquationLabel'])).toEqual([
      ['EquationLabel', '{#eq:x_1:a-b}'],
    ]);
  });

  it('treats text after the closing $$ as a paragraph with inline math', () => {
    expect(nodes('$$a$$ and more text', ['MathBlock'])).toEqual([]);
    expect(nodes('$$a$$ and more text', ['InlineMath'])).toEqual([['InlineMath', '$$a$$']]);
  });

  it('runs to the end when unclosed', () => {
    expect(nodes('$$\nx = 1\n', ['MathBlock'])).toEqual([['MathBlock', '$$\nx = 1']]);
  });
});

describe('cross-references, tags and block IDs', () => {
  it('finds @eq:label at word boundaries only', () => {
    expect(nodes('See @eq:kf-gain, (@eq:a) and [@eq:b].', ['CrossRef'])).toEqual([
      ['CrossRef', '@eq:kf-gain'],
      ['CrossRef', '@eq:a'],
      ['CrossRef', '@eq:b'],
    ]);
    expect(nodes('mail me@eq:x', ['CrossRef'])).toEqual([]);
    expect(nodes('@fig:plot and @tbl:t1', ['CrossRef'])).toHaveLength(2);
    expect(nodes('[@groves2013] stays text', ['CrossRef'])).toEqual([]);
  });

  it('finds tags, nested tags, and not headings, numbers or anchors', () => {
    expect(nodes('#estimation and #planning/sampling, #2026 x', ['Tag'])).toEqual([
      ['Tag', '#estimation'],
      ['Tag', '#planning/sampling'],
    ]);
    expect(nodes('# Heading', ['Tag'])).toEqual([]);
    expect(nodes('see http://x.org/#frag', ['Tag'])).toEqual([]);
    expect(nodes('#navegação', ['Tag'])).toEqual([['Tag', '#navegação']]);
  });

  it('finds block IDs only at the end of a line', () => {
    expect(nodes('A paragraph. ^kf-summary\nnext', ['BlockId'])).toEqual([['BlockId', '^kf-summary']]);
    expect(nodes('x^2 and ^ mid text', ['BlockId'])).toEqual([]);
    expect(nodes('a ^id more', ['BlockId'])).toEqual([]);
  });
});

describe('GFM and CommonMark', () => {
  it('parses tables, task lists, strikethrough and autolinks', () => {
    const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] todo\n- [x] done\n\n~~gone~~ https://example.com\n';
    const found = nodes(doc, ['Table', 'Task', 'Strikethrough', 'URL']).map(([n]) => n);
    expect(found).toEqual(['Table', 'Task', 'Task', 'Strikethrough', 'URL']);
  });

  it('keeps fenced code opaque', () => {
    const doc = '```matlab kf_update.m\nK = [[x]] $y$ #tag\n```\n';
    expect(nodes(doc, ['FencedCode', 'CodeInfo'])).toEqual([
      ['FencedCode', '```matlab kf_update.m\nK = [[x]] $y$ #tag\n```'],
      ['CodeInfo', 'matlab kf_update.m'],
    ]);
    expect(nodes(doc, ['WikiLink', 'InlineMath', 'Tag'])).toEqual([]);
  });

  it('parses raw HTML as HTML nodes (rendered as text by the app)', () => {
    expect(nodes('<div>x</div>\n', ['HTMLBlock'])).toHaveLength(1);
  });
});

describe('Pandoc citations in brackets', () => {
  it('are citations, not shortcut links', () => {
    expect(nodes('See [@groves2013, p. 45] and [see @a; -@b].', ['Citation', 'Link'])).toEqual([
      ['Citation', '[@groves2013, p. 45]'],
      ['Citation', '[see @a; -@b]'],
    ]);
  });

  it('leave links, wikilinks, cross-references and e-mail text alone', () => {
    expect(
      nodes('[see @a](https://x.org) [@a][ref] [[Note]] [@eq:energy] [mail me@x.org]', ['Citation']),
    ).toEqual([]);
    expect(nodes('[see @a](https://x.org)', ['Link'])).toEqual([['Link', '[see @a](https://x.org)']]);
    expect(nodes('[@eq:energy]', ['CrossRef'])).toEqual([['CrossRef', '@eq:energy']]);
  });
});
