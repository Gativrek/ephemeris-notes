/**
 * The outline model (SPECS 9.6): built once per note from the live text plus the
 * index's backlinks. Every outline style renders this.
 */
import { analyzeNote } from '@ephemeris-notes/markdown';

export type OutlineItem =
  | { kind: 'link'; target: string; resolved: string | null; line: number }
  | { kind: 'equation'; number: string | null; label?: string; line: number }
  /** `title` is the block's `title="…"` info-string argument (SPECS 9.6, 12.5). */
  | { kind: 'code'; lang: string; title?: string; line: number }
  | { kind: 'block'; lang: string; title?: string; line: number }
  | { kind: 'embed'; target: string; line: number }
  /** A plugin's entry (SPECS 12.11.3). */
  | { kind: 'plugin'; plugin: string; label: string; glyph?: string; line: number; onClick?: () => void };

export interface OutlineModel {
  headings: Array<{ level: number; text: string; line: number; items: OutlineItem[] }>;
  backlinks: Array<{ path: string; title: string; line: number; snippet: string }>;
  /** Line count of the note (margin track and document map positions). */
  lines: number;
  /** Frontmatter properties, or null (tabbed inspector, Info). */
  properties: Record<string, unknown> | null;
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
  for (const b of s.blocks) {
    const title = b.info.args.named.title?.trim();
    items.push({
      kind: isCode(b.lang) ? 'code' : 'block',
      lang: b.lang,
      ...(title ? { title } : {}),
      line: b.lineStart,
      pos: b.from,
    });
  }
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
  const lines = text.length ? text.split('\n').length : 1;
  return { headings, backlinks, lines, properties: s.frontmatter?.data ?? null };
}

/** A code or plugin block's label: its title, else its language. */
export function blockLabel(it: { lang: string; title?: string }): string {
  return it.title ?? (it.lang || 'code');
}

/** Places plugin entries under the heading that contains each one's line. */
export function addContributions(model: OutlineModel, entries: OutlineItem[]): OutlineModel {
  if (!entries.length) return model;
  const headings = model.headings.map((h) => ({ ...h, items: [...h.items] }));
  for (const e of entries) {
    let target = -1;
    headings.forEach((h, i) => {
      if (h.line <= e.line) target = i;
    });
    if (target < 0) {
      if (headings[0]?.level !== 0) headings.unshift({ level: 0, text: 'Top', line: 1, items: [] });
      target = 0;
    }
    headings[target]!.items.push(e);
  }
  for (const h of headings) h.items.sort((a, b) => a.line - b.line);
  return { ...model, headings };
}

function strip(i: OutlineItem & { pos: number }): OutlineItem {
  const { pos: _pos, ...rest } = i;
  return rest as OutlineItem;
}
