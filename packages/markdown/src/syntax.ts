/**
 * Lezer Markdown extensions for the dialect in SPECS 4.7, shared by the editor and the
 * index (GOALS decision 7): frontmatter, wikilinks and embeds, `$` and `$$` math,
 * equation labels and cross-references, tags and block IDs. GFM comes from Lezer.
 */
import {
  GFM,
  parser as baseParser,
  type BlockContext,
  type InlineContext,
  type Line,
  type MarkdownConfig,
} from '@lezer/markdown';
import { tags as t } from '@lezer/highlight';

const ch = (s: string) => s.charCodeAt(0);
const DOLLAR = ch('$');
const BACKSLASH = ch('\\');
const BRACKET_OPEN = ch('[');
const BRACKET_CLOSE = ch(']');
const BANG = ch('!');
const HASH = ch('#');
const AT = ch('@');
const CARET = ch('^');
const PIPE = ch('|');
const NEWLINE = 10;

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === -1;
const isDigit = (c: number) => c >= 48 && c <= 57;
const LABEL_CHAR = /[A-Za-z0-9_:-]/;
const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;
const BLOCK_ID_CHAR = /[A-Za-z0-9-]/;

// ---- Frontmatter -----------------------------------------------------------

interface InputLike {
  length: number;
  read(from: number, to: number): string;
}

/** YAML between `---` lines at the very start of the file. Needs a closing line. */
const Frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true },
    { name: 'FrontmatterMark', style: t.processingInstruction },
    { name: 'FrontmatterContent', style: t.meta },
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx: BlockContext, line: Line) {
        if (cx.lineStart !== 0 || line.text.replace(/\s+$/, '') !== '---') return false;
        // Look ahead for the closing line before committing (an unclosed `---` is a rule).
        const input = (cx as unknown as { input?: InputLike }).input;
        if (input) {
          const rest = input.read(line.text.length, Math.min(input.length, 1_000_000));
          if (!/\n(---|\.\.\.)[ \t]*(\r?\n|$)/.test(rest)) return false;
        }
        const children = [cx.elt('FrontmatterMark', 0, 3)];
        const contentStart = line.text.length + 1;
        let contentEnd = contentStart;
        while (cx.nextLine()) {
          const text = line.text.replace(/\s+$/, '');
          if (text === '---' || text === '...') {
            if (cx.lineStart > contentStart)
              children.push(cx.elt('FrontmatterContent', contentStart, contentEnd));
            children.push(cx.elt('FrontmatterMark', cx.lineStart, cx.lineStart + 3));
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt('Frontmatter', 0, end, children));
            return true;
          }
          contentEnd = cx.lineStart + line.text.length;
        }
        // Reached the end without a closing line (no lookahead available): treat it all as frontmatter.
        if (contentEnd > contentStart) children.push(cx.elt('FrontmatterContent', contentStart, contentEnd));
        cx.addElement(cx.elt('Frontmatter', 0, contentEnd, children));
        return true;
      },
    },
  ],
};

// ---- Wikilinks and embeds ---------------------------------------------------

function parseWiki(cx: InlineContext, start: number, embed: boolean): number {
  const open = start + (embed ? 1 : 0);
  if (cx.char(open) !== BRACKET_OPEN || cx.char(open + 1) !== BRACKET_OPEN) return -1;
  const from = open + 2;
  let pipe = -1;
  for (let pos = from; pos < cx.end; pos++) {
    const c = cx.char(pos);
    if (c === NEWLINE) return -1;
    if (c === BRACKET_OPEN && cx.char(pos + 1) === BRACKET_OPEN) return -1;
    if (c === PIPE && pipe < 0) {
      // `\|` inside tables is the alias separator too (Obsidian).
      pipe = cx.char(pos - 1) === BACKSLASH ? pos - 1 : pos;
    }
    if (c === BRACKET_CLOSE && cx.char(pos + 1) === BRACKET_CLOSE) {
      if (pos === from) return -1;
      const targetEnd = pipe >= 0 ? pipe : pos;
      const children = [];
      if (embed) children.push(cx.elt('EmbedMark', start, start + 1));
      children.push(cx.elt('WikiLinkMark', open, open + 2));
      if (targetEnd > from) children.push(cx.elt('WikiLinkTarget', from, targetEnd));
      if (pipe >= 0) {
        const aliasFrom = cx.char(pipe) === BACKSLASH ? pipe + 2 : pipe + 1;
        children.push(cx.elt('WikiLinkPipe', pipe, aliasFrom));
        if (pos > aliasFrom) children.push(cx.elt('WikiLinkAlias', aliasFrom, pos));
      }
      children.push(cx.elt('WikiLinkMark', pos, pos + 2));
      return cx.addElement(cx.elt(embed ? 'Embed' : 'WikiLink', start, pos + 2, children));
    }
  }
  return -1;
}

const WikiLinks: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: t.link },
    { name: 'Embed', style: t.link },
    { name: 'EmbedMark', style: t.processingInstruction },
    { name: 'WikiLinkMark', style: t.processingInstruction },
    { name: 'WikiLinkTarget', style: t.link },
    { name: 'WikiLinkPipe', style: t.processingInstruction },
    { name: 'WikiLinkAlias', style: t.link },
  ],
  parseInline: [
    {
      name: 'WikiLink',
      before: 'Link',
      parse(cx, next, pos) {
        if (next === BRACKET_OPEN) return parseWiki(cx, pos, false);
        if (next === BANG && cx.char(pos + 1) === BRACKET_OPEN) return parseWiki(cx, pos, true);
        return -1;
      },
    },
  ],
};

// ---- Math -----------------------------------------------------------------

/** `{#eq:label}` after a closing `$$`: returns [from, to, labelFrom, labelTo] or null. */
export function matchEquationLabel(text: string, at: number): [number, number, number, number] | null {
  const m = /^[ \t]*\{#((?:eq):[A-Za-z0-9_:-]+)\}[ \t]*$/.exec(text.slice(at));
  if (!m) return null;
  const from = at + text.slice(at).indexOf('{');
  return [from, from + m[1]!.length + 3, from + 2, from + 2 + m[1]!.length];
}

/** Position just after the closing `$$` on this line at or after `from`, or -1. */
function findClosingDollars(text: string, from: number): number {
  for (let i = from; i < text.length - 1; i++) {
    if (text.charCodeAt(i) === BACKSLASH) {
      i++;
      continue;
    }
    if (text.charCodeAt(i) === DOLLAR && text.charCodeAt(i + 1) === DOLLAR) return i;
  }
  return -1;
}

const MathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'MathBlock', block: true },
    { name: 'InlineMath' },
    { name: 'MathMark', style: t.processingInstruction },
    { name: 'MathContent', style: t.special(t.string) },
    { name: 'EquationLabel', style: t.labelName },
  ],
  parseBlock: [
    {
      name: 'MathBlock',
      before: 'FencedCode',
      parse(cx, line) {
        if (line.indent >= 4) return false;
        const start = line.pos;
        if (line.text.charCodeAt(start) !== DOLLAR || line.text.charCodeAt(start + 1) !== DOLLAR)
          return false;
        const blockFrom = cx.lineStart + start;
        const children = [cx.elt('MathMark', blockFrom, blockFrom + 2)];
        const finish = (lineText: string, lineStart: number, closeAt: number) => {
          const contentEnd = lineStart + closeAt;
          if (contentEnd > contentFrom) children.push(cx.elt('MathContent', contentFrom, contentEnd));
          children.push(cx.elt('MathMark', lineStart + closeAt, lineStart + closeAt + 2));
          let end = lineStart + closeAt + 2;
          const label = matchEquationLabel(lineText, closeAt + 2);
          if (label) {
            children.push(cx.elt('EquationLabel', lineStart + label[0], lineStart + label[1]));
            end = lineStart + label[1];
          }
          return end;
        };
        const contentFrom = blockFrom + 2;
        // Single line: `$$ x $$` (optionally labeled). Anything else after the
        // closing marks makes it a paragraph with inline math instead.
        const sameLine = findClosingDollars(line.text, start + 2);
        if (sameLine >= 0) {
          const after = line.text.slice(sameLine + 2);
          if (after.trim() !== '' && !matchEquationLabel(line.text, sameLine + 2)) return false;
          const end = finish(line.text, cx.lineStart, sameLine);
          cx.nextLine();
          cx.addElement(cx.elt('MathBlock', blockFrom, end, children));
          return true;
        }
        if (line.text.slice(start + 2).includes('$')) return false;
        // Multi-line: runs to the first line containing `$$`.
        let lastEnd = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          const close = findClosingDollars(line.text, 0);
          if (close >= 0) {
            const end = finish(line.text, cx.lineStart, close);
            cx.nextLine();
            cx.addElement(cx.elt('MathBlock', blockFrom, end, children));
            return true;
          }
          if (line.text.trim() !== '') lastEnd = cx.lineStart + line.text.length;
        }
        // Unclosed: the rest of the document is math (as Obsidian renders it).
        if (lastEnd > contentFrom) children.push(cx.elt('MathContent', contentFrom, lastEnd));
        cx.addElement(cx.elt('MathBlock', blockFrom, lastEnd, children));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1;
        if (cx.char(pos - 1) === BACKSLASH) return -1;
        const double = cx.char(pos + 1) === DOLLAR;
        const open = double ? 2 : 1;
        const first = cx.char(pos + open);
        if (isSpace(first) || first === DOLLAR) return -1;
        for (let i = pos + open; i < cx.end; i++) {
          const c = cx.char(i);
          if (c === NEWLINE && !double) return -1;
          if (c === BACKSLASH) {
            i++;
            continue;
          }
          if (c !== DOLLAR) continue;
          // A `$` after whitespace would open new math: this one never closed (`$5 and $10`).
          if (!double && isSpace(cx.char(i - 1)) && !isSpace(cx.char(i + 1))) return -1;
          if (double) {
            if (cx.char(i + 1) !== DOLLAR) continue;
            return cx.addElement(
              cx.elt('InlineMath', pos, i + 2, [
                cx.elt('MathMark', pos, pos + 2),
                cx.elt('MathContent', pos + 2, i),
                cx.elt('MathMark', i, i + 2),
              ]),
            );
          }
          // A closing `$` is not preceded by space and not followed by a digit (`$5 and $10`).
          if (isSpace(cx.char(i - 1)) || isDigit(cx.char(i + 1))) continue;
          return cx.addElement(
            cx.elt('InlineMath', pos, i + 1, [
              cx.elt('MathMark', pos, pos + 1),
              cx.elt('MathContent', pos + 1, i),
              cx.elt('MathMark', i, i + 1),
            ]),
          );
        }
        return -1;
      },
    },
  ],
};

// ---- Cross-references, tags, block IDs --------------------------------------

/** `@eq:label` (and the reserved `@fig:` / `@tbl:`) at a word boundary. */
const CrossRefs: MarkdownConfig = {
  defineNodes: [
    { name: 'CrossRef', style: t.link },
    { name: 'CrossRefMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'CrossRef',
      parse(cx, next, pos) {
        if (next !== AT) return -1;
        const before = pos === cx.offset ? -1 : cx.char(pos - 1);
        if (!(before === -1 || isSpace(before) || before === ch('(') || before === BRACKET_OPEN)) return -1;
        const m = /^@(eq|fig|tbl):([A-Za-z0-9_:-]+)/.exec(cx.slice(pos, Math.min(cx.end, pos + 200)));
        if (!m) return -1;
        let end = pos + m[0].length;
        // A trailing colon or hyphen is punctuation, not part of the label.
        while (end > pos + m[1]!.length + 2 && /[:-]/.test(String.fromCharCode(cx.char(end - 1)))) end--;
        return cx.addElement(cx.elt('CrossRef', pos, end, [cx.elt('CrossRefMark', pos, pos + 1)]));
      },
    },
  ],
};

const Tags: MarkdownConfig = {
  defineNodes: [{ name: 'Tag', style: t.labelName }],
  parseInline: [
    {
      name: 'Tag',
      parse(cx, next, pos) {
        if (next !== HASH) return -1;
        const before = pos === cx.offset ? -1 : cx.char(pos - 1);
        if (!(before === -1 || isSpace(before))) return -1;
        let end = pos + 1;
        while (end < cx.end && TAG_CHAR.test(String.fromCharCode(cx.char(end)))) end++;
        const body = cx.slice(pos + 1, end);
        // Needs one non-digit; a trailing slash is not part of the tag.
        const trimmed = body.replace(/\/+$/, '');
        if (trimmed.length === 0 || /^[0-9/]+$/.test(trimmed)) return -1;
        return cx.addElement(cx.elt('Tag', pos, pos + 1 + trimmed.length));
      },
    },
  ],
};

const BlockIds: MarkdownConfig = {
  defineNodes: [{ name: 'BlockId', style: t.labelName }],
  parseInline: [
    {
      name: 'BlockId',
      parse(cx, next, pos) {
        if (next !== CARET || pos === cx.offset || !isSpace(cx.char(pos - 1))) return -1;
        let end = pos + 1;
        while (end < cx.end && BLOCK_ID_CHAR.test(String.fromCharCode(cx.char(end)))) end++;
        if (end === pos + 1) return -1;
        // Only at the end of a line.
        let after = end;
        while (after < cx.end && (cx.char(after) === 32 || cx.char(after) === 9)) after++;
        if (after < cx.end && cx.char(after) !== NEWLINE && cx.char(after) !== 13) return -1;
        return cx.addElement(cx.elt('BlockId', pos, end));
      },
    },
  ],
};

/** Every extension, in the order the editor and the index use them. */
export const vaultsMarkdown = [GFM, Frontmatter, MathSyntax, WikiLinks, CrossRefs, Tags, BlockIds];

/** The configured parser for plain (non-editor) use, e.g. in the index. */
export const markdownParser = baseParser.configure(vaultsMarkdown);

export const LABEL_PATTERN = LABEL_CHAR;
