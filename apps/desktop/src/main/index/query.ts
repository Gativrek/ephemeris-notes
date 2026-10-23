/**
 * Search query syntax (SPECS 6.2): plain words (AND), "exact phrase", -word,
 * tag:#name, path:fragment, vault:name, ext:pdf. Translated to FTS5 with escaping;
 * user text is never passed through as raw FTS5.
 */

export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  excludes: string[];
  tags: string[];
  paths: string[];
  vaults: string[];
  exts: string[];
}

export function tokenize(input: string): string[] {
  const out: string[] = [];
  const re = /(-?)(?:(\w+):)?("([^"]*)"?|\S+)/g;
  for (let m = re.exec(input); m; m = re.exec(input)) out.push(m[0]);
  return out;
}

export function parseQuery(input: string): ParsedQuery {
  const q: ParsedQuery = { terms: [], phrases: [], excludes: [], tags: [], paths: [], vaults: [], exts: [] };
  for (const raw of tokenize(input.trim())) {
    let token = raw;
    const negate = token.startsWith('-') && token.length > 1;
    if (negate) token = token.slice(1);
    const field = /^(tag|path|vault|ext):(.*)$/i.exec(token);
    const unquote = (s: string) =>
      s.startsWith('"') ? s.slice(1, s.endsWith('"') && s.length > 1 ? -1 : undefined) : s;
    if (field) {
      const value = unquote(field[2]!).trim();
      if (!value) continue;
      const key = field[1]!.toLowerCase();
      if (key === 'tag') q.tags.push(value.replace(/^#/, '').toLowerCase());
      else if (key === 'path') q.paths.push(value);
      else if (key === 'vault') q.vaults.push(value);
      else q.exts.push(value.replace(/^\./, '').toLowerCase());
      continue;
    }
    if (token.startsWith('"')) {
      const phrase = unquote(token).trim();
      if (phrase) (negate ? q.excludes : q.phrases).push(phrase);
      continue;
    }
    const word = token.replace(/^[*^]+|[*]+$/g, '');
    if (!word) continue;
    (negate ? q.excludes : q.terms).push(word);
  }
  return q;
}

/** An FTS5 string literal: double quotes doubled. */
export function ftsString(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * The MATCH expression, or null when the query has no positive text (filters only, or
 * only exclusions). The last plain word matches as a prefix, for search-as-you-type.
 */
export function toFtsMatch(q: ParsedQuery): string | null {
  const parts: string[] = [];
  q.terms.forEach((t, i) => parts.push(i === q.terms.length - 1 ? `${ftsString(t)}*` : ftsString(t)));
  for (const p of q.phrases) parts.push(ftsString(p));
  if (!parts.length) return null;
  let expr = parts.join(' AND ');
  for (const e of q.excludes) expr = `(${expr}) NOT ${ftsString(e)}`;
  return expr;
}

/** Folds case and diacritics, keeping a map back to the original offsets. */
export function fold(text: string): { folded: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // ASCII needs no normalization: the common case, and the fast one.
    if (c < 128) {
      out.push(c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : text[i]!);
      map.push(i);
      continue;
    }
    const base = text[i]!.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < base.length; k++) {
      out.push(base[k]!);
      map.push(i);
    }
  }
  map.push(text.length);
  return { folded: out.join(''), map };
}

export interface SnippetPart {
  text: string;
  hit: boolean;
}

/** Up to `max` windows of `body` around matches of the query words, with the matches marked. */
export function snippets(body: string, q: ParsedQuery, max = 2, radius = 60): SnippetPart[][] {
  const needles = [...q.terms, ...q.phrases].map((n) => fold(n).folded).filter(Boolean);
  if (!needles.length) return [];
  const words = new Set(q.terms.map((w) => fold(w).folded));
  const { folded, map } = fold(body);
  const hits: Array<[number, number]> = [];
  for (const n of needles) {
    for (let i = folded.indexOf(n); i >= 0 && hits.length < 200; i = folded.indexOf(n, i + n.length)) {
      // Plain words match at word starts (prefix search), phrases anywhere.
      if (i > 0 && /[\p{L}\p{N}]/u.test(folded[i - 1]!) && words.has(n)) continue;
      hits.push([map[i]!, map[i + n.length]!]);
    }
  }
  hits.sort((a, b) => a[0] - b[0]);
  const out: SnippetPart[][] = [];
  let lastEnd = -1;
  for (const [from] of hits) {
    if (out.length >= max) break;
    if (from < lastEnd) continue;
    let start = Math.max(0, from - radius);
    let end = Math.min(body.length, from + radius * 2);
    // Cut at whitespace for clean edges.
    while (start > 0 && start > from - radius - 20 && !/\s/.test(body[start - 1]!)) start--;
    while (end < body.length && end < from + radius * 2 + 20 && !/\s/.test(body[end]!)) end++;
    const window = body.slice(start, end).replace(/\s+/g, ' ');
    const parts: SnippetPart[] = [];
    const inWindow = hits
      .filter(([a, b]) => a >= start && b <= end)
      .map(([a, b]) => [a - start, b - start] as const);
    let pos = 0;
    const raw = body.slice(start, end);
    for (const [a, b] of inWindow) {
      if (a < pos) continue;
      if (a > pos) parts.push({ text: raw.slice(pos, a).replace(/\s+/g, ' '), hit: false });
      parts.push({ text: raw.slice(a, b), hit: true });
      pos = b;
    }
    if (pos < raw.length) parts.push({ text: raw.slice(pos).replace(/\s+/g, ' '), hit: false });
    // Link brackets and heading marks are noise in a snippet.
    for (const part of parts)
      if (!part.hit) part.text = part.text.replace(/!?\[\[|\]\]/g, '').replace(/(^|\s)#{1,6}(?=\s)/g, '$1');
    if (start > 0) parts.unshift({ text: '…', hit: false });
    if (end < body.length) parts.push({ text: '…', hit: false });
    void window;
    out.push(parts);
    lastEnd = end;
  }
  return out;
}
