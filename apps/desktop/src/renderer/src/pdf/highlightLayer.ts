/**
 * PDF highlights on the page (SPECS 10.8.1): from a text selection to Obsidian's
 * selection link (text item indices and offsets), and back to boxes drawn over the page.
 * pdf.js makes one text-layer span per text item of the page's text content (empty items
 * get a span that is never attached), so an item's index is its span's index.
 */
import type { PdfSelection } from '@ephemeris-notes/markdown';

/** The DOM point `offset` characters into `span`'s text (find marks may split it). */
function pointIn(span: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let left = offset;
  let last: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (left <= n.data.length) return { node: n, offset: left };
    left -= n.data.length;
    last = n;
  }
  return last ? { node: last, offset: last.data.length } : { node: span, offset: 0 };
}

/** How many characters of `span` come before the DOM point. */
function offsetIn(span: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(span, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** The part of `range` on one page, as a selection link's numbers; null when none of it is. */
export function selectionOnPage(range: Range, textDivs: HTMLElement[]): PdfSelection | null {
  let first = -1;
  let last = -1;
  textDivs.forEach((d, i) => {
    if (!d.isConnected || !d.textContent || !range.intersectsNode(d)) return;
    if (first < 0) first = i;
    last = i;
  });
  if (first < 0) return null;
  const a = textDivs[first]!;
  const b = textDivs[last]!;
  const bo = a.contains(range.startContainer) ? offsetIn(a, range.startContainer, range.startOffset) : 0;
  const eo = b.contains(range.endContainer)
    ? offsetIn(b, range.endContainer, range.endOffset)
    : b.textContent!.length;
  if (first === last && eo <= bo) return null;
  return [first, bo, last, eo];
}

/** The DOM range of a selection on a page whose text layer is drawn; null when it does not fit. */
export function rangeOf(sel: PdfSelection, textDivs: HTMLElement[]): Range | null {
  const [bi, bo, ei, eo] = sel;
  const a = textDivs[bi];
  const b = textDivs[ei];
  if (!a || !b || bi > ei) return null;
  const r = document.createRange();
  const s = pointIn(a, bo);
  const e = pointIn(b, eo);
  r.setStart(s.node, s.offset);
  r.setEnd(e.node, e.offset);
  return r;
}

/** A box in percent of the page, so it holds at any zoom. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The passage's boxes over `page`: one per span piece, then pieces on the same line that
 * touch merged into one, so a line reads as one mark.
 */
export function boxesOf(range: Range, page: HTMLElement): Box[] {
  const p = page.getBoundingClientRect();
  if (!p.width || !p.height) return [];
  const rects = [...range.getClientRects()]
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({ l: r.left - p.left, t: r.top - p.top, r: r.right - p.left, b: r.bottom - p.top }))
    .sort((x, y) => x.t - y.t || x.l - y.l);
  const merged: typeof rects = [];
  for (const r of rects) {
    const m = merged.find((q) => {
      const overlap = Math.min(q.b, r.b) - Math.max(q.t, r.t);
      return overlap > 0.5 * Math.min(q.b - q.t, r.b - r.t) && r.l <= q.r + 4 && r.r >= q.l - 4;
    });
    if (m) {
      m.l = Math.min(m.l, r.l);
      m.t = Math.min(m.t, r.t);
      m.r = Math.max(m.r, r.r);
      m.b = Math.max(m.b, r.b);
    } else merged.push({ ...r });
  }
  return merged.map((r) => ({
    left: (100 * r.l) / p.width,
    top: (100 * r.t) / p.height,
    width: (100 * (r.r - r.l)) / p.width,
    height: (100 * (r.b - r.t)) / p.height,
  }));
}
