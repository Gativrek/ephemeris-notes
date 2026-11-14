/**
 * PDF highlights (SPECS 10.8.1), the parts without a page: the quoted text of a passage,
 * the two lines a highlight is written as, the PDF's highlights note, and the range a
 * highlight takes in it. A highlight is a link `[[paper.pdf#page=3&selection=4,0,6,12]]`;
 * the PDF itself is never modified.
 */
import { pdfFragment, type PdfSelection } from '@ephemeris-notes/markdown';

/** A text item of a page's text content, as pdf.js gives it (marked-content items left out). */
export interface TextItem {
  str: string;
  hasEOL: boolean;
}

/** Whitespace collapsed, and words broken across lines joined: "informa- tion" → "information". */
export const cleanQuote = (text: string): string =>
  text
    .replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();

/** The passage's text, or null when the selection does not fit the page's text. */
export function quoteOf(items: TextItem[], sel: PdfSelection): string | null {
  const [bi, bo, ei, eo] = sel;
  if (bi > ei || ei >= items.length) return null;
  let out = '';
  for (let i = bi; i <= ei; i++) {
    const it = items[i]!;
    let s =
      i === bi && i === ei
        ? it.str.slice(bo, eo)
        : i === bi
          ? it.str.slice(bo)
          : i === ei
            ? it.str.slice(0, eo)
            : it.str;
    // A line's end: a word broken by a hyphen joins the next line's start; else a space.
    if (i < ei && it.hasEOL) s = /\p{L}-$/u.test(s) ? s.slice(0, -1) : `${s} `;
    out += s;
  }
  const q = cleanQuote(out);
  return q || null;
}

/** The two lines of a highlight: the quote, and the link that marks it in the PDF. */
export function highlightBlock(quote: string, pdfLink: string, page: number, sel: PdfSelection): string {
  return `> ${quote}\n> — [[${pdfLink}#${pdfFragment(page, sel)}|p. ${page}]]\n`;
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.pdf$/i, '');
const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');

/** "Folder/paper.pdf" → "Folder/paper highlights.md". */
export const highlightsNotePath = (pdfPath: string): string =>
  `${folderOf(pdfPath)}${baseName(pdfPath)} highlights.md`;

/** A new highlights note, before its first highlight. */
export const newHighlightsNote = (pdfPath: string, pdfLink: string): string =>
  `---\npdf: "[[${pdfLink}]]"\n---\n\n# ${baseName(pdfPath)} highlights\n\n`;

/** Where to append `block` to `text`: at the end, after one blank line. */
export function appendChange(text: string, block: string): { from: number; insert: string } {
  const gap = text === '' || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return { from: text.length, insert: gap + block };
}

const LINK_LINE = /^>\s*—\s*\[\[[^\]]*#page=\d+&selection=\d+,\d+,\d+,\d+[^\]]*\]\]\s*$/;

/**
 * The characters a highlight takes in its note, when it is written as a highlight is
 * (quote lines, then the link line `> — [[…]]`), with one blank line after it; null otherwise.
 */
export function highlightRange(text: string, linkLine: number): { from: number; to: number } | null {
  const lines = text.split('\n');
  const i = linkLine - 1;
  if (i < 1 || i >= lines.length || !LINK_LINE.test(lines[i]!)) return null;
  let start = i;
  while (start > 0 && lines[start - 1]!.startsWith('>') && !LINK_LINE.test(lines[start - 1]!)) start--;
  if (start === i) return null;
  let end = i + 1;
  if (end < lines.length && lines[end] === '' && end + 1 < lines.length) end++;
  const offset = (n: number) => lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
  return { from: offset(start), to: Math.min(text.length, offset(end)) };
}
