/**
 * The outline model (SPECS 9.6): built once per note from the live text plus the
 * index's backlinks. Every outline style renders this.
 */
import { analyzeNote } from '@vaults/markdown';

export type OutlineItem =
  | { kind: 'link'; target: string; resolved: string | null; line: number }
  | { kind: 'equation'; number: string | null; label?: string; line: number }
  | { kind: 'code'; lang: string; line: number }
  | { kind: 'block'; lang: string; line: number }
  | { kind: 'embed'; target: string; line: number };

export interface OutlineModel {
  headings: Array<{ level: number; text: string; line: number; items: OutlineItem[] }>;
  backlinks: Array<{ path: string; title: string; line: number; snippet: string }>;
}

export function buildOutline(
  text: string,
  _path: string,
  resolve: (target: string) => string | null,
  backlinks: OutlineModel['backlinks'],
  opts: { isCodeLanguage?: (lang: string) => boolean; numbering?: 'all' | 'labeled' } = {},
): OutlineModel {
  const s = analyzeNote(text, { numbering: opts.numbering ?? 'all' });
  const isCode = opts.isCodeLanguage ?? (() => true);
  const items: Array<OutlineItem & { pos: number }> = [];
  for (const l of s.links) {
    if (l.kind === 'embed') items.push({ kind: 'embed', target: l.target, line: l.line, pos: l.from });
    else
      items.push({
        kind: 'link',
        target: l.target + (l.heading ? `#${l.heading}` : ''),
        resolved: l.target ? resolve(l.target) : null,
        line: l.line,
        pos: l.from,
      });
  }
  for (const e of s.equations)
    items.push({
      kind: 'equation',
      number: e.number,
      ...(e.label ? { label: e.label } : {}),
      line: e.line,
      pos: e.from,
    });
  for (const b of s.blocks)
    items.push({ kind: isCode(b.lang) ? 'code' : 'block', lang: b.lang, line: b.lineStart, pos: b.from });
  items.sort((a, b) => a.pos - b.pos);

  const headings: OutlineModel['headings'] = [];
  // Content before the first heading goes under a synthetic level-0 "Top" entry.
  const firstHeadingPos = s.headings[0]?.from ?? Infinity;
  const top = items.filter((i) => i.pos < firstHeadingPos);
  if (top.length) headings.push({ level: 0, text: 'Top', line: 1, items: top.map(strip) });
  s.headings.forEach((h, idx) => {
    const end = s.headings[idx + 1]?.from ?? Infinity;
    headings.push({
      level: h.level,
      text: h.text,
      line: h.line,
      items: items.filter((i) => i.pos >= h.from && i.pos < end).map(strip),
    });
  });
  return { headings, backlinks };
}

function strip(i: OutlineItem & { pos: number }): OutlineItem {
  const { pos: _pos, ...rest } = i;
  return rest as OutlineItem;
}
