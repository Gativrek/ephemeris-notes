/**
 * Rewriting link targets for rename and move with link updates (SPECS 5). Only the
 * target part of each link changes: `#heading`, `#^block`, `|alias`, the `!` of embeds
 * and the surrounding text stay byte for byte.
 */
import { analyzeNote, type LinkRef } from './analyze';

export interface Rewrite {
  link: LinkRef;
  /** New target text (without `#…` and `|…`), or null to leave the link alone. */
  next: string | null;
}

/** Applies `fn` to every link; returns the new text and how many links changed. */
export function rewriteLinks(
  text: string,
  fn: (link: LinkRef) => string | null,
): { text: string; changed: number } {
  const summary = analyzeNote(text);
  const edits: Array<{ from: number; to: number; insert: string }> = [];
  for (const link of summary.links) {
    const next = fn(link);
    if (next === null) continue;
    const raw = text.slice(link.from, link.to);
    if (link.kind === 'wikilink' || link.kind === 'embed') {
      if (raw.startsWith('![') && raw.includes('](')) {
        // A Markdown image counts as an embed too.
        const open = raw.indexOf('](');
        const close = raw.lastIndexOf(')');
        const href = raw.slice(open + 2, close);
        const frag = href.includes('#') ? href.slice(href.indexOf('#')) : '';
        edits.push({
          from: link.from + open + 2,
          to: link.from + close,
          insert: encodeHref(next, href) + frag,
        });
        continue;
      }
      const start = raw.indexOf('[[') + 2;
      let end = raw.length - 2;
      const pipe = raw.search(/\\?\|/);
      if (pipe > start) end = pipe;
      const hash = raw.slice(start, end).indexOf('#');
      if (hash >= 0) end = start + hash;
      if (raw.slice(start, end) === next) continue;
      edits.push({ from: link.from + start, to: link.from + end, insert: next });
    } else {
      const open = raw.lastIndexOf('](');
      const close = raw.lastIndexOf(')');
      if (open < 0 || close < open) continue;
      const hrefFull = raw.slice(open + 2, close);
      const title = /\s+("[^"]*"|'[^']*'|\([^)]*\))\s*$/.exec(hrefFull);
      const href = title ? hrefFull.slice(0, title.index) : hrefFull;
      const angle = href.startsWith('<') && href.endsWith('>');
      const bare = angle ? href.slice(1, -1) : href;
      const frag = bare.includes('#') ? bare.slice(bare.indexOf('#')) : '';
      const encoded = angle ? next : encodeHref(next, bare);
      const replacement =
        (angle ? `<${encoded}${frag}>` : `${encoded}${frag}`) + (title ? hrefFull.slice(title.index) : '');
      if (replacement === hrefFull) continue;
      edits.push({ from: link.from + open + 2, to: link.from + close, insert: replacement });
    }
  }
  if (!edits.length) return { text, changed: 0 };
  edits.sort((a, b) => b.from - a.from);
  let out = text;
  for (const e of edits) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return { text: out, changed: edits.length };
}

/** Keeps the href's encoding style: `%20` if the old one used it. */
function encodeHref(path: string, old: string): string {
  return /%[0-9A-Fa-f]{2}/.test(old) || !/\s/.test(old) ? encodeURI(path).replace(/#/g, '%23') : path;
}

/** Relative path from a note's folder to a target, POSIX style. */
export function relativePath(fromNote: string, target: string): string {
  const from = fromNote.split('/').slice(0, -1);
  const to = target.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.length - i;
  return [...Array(up).fill('..'), ...to.slice(i)].join('/') || to[to.length - 1]!;
}

/**
 * Obsidian's resolution rules for a link the app wrote (SPECS 17 compatibility check):
 * the link must match exactly one file, by unique file name or unique path suffix.
 */
export function resolvesUniquelyInObsidian(link: string, paths: string[]): string | null {
  const target =
    link.includes('.') && /\.[A-Za-z0-9]{1,8}$/.test(link.slice(link.lastIndexOf('/') + 1))
      ? link
      : `${link}.md`;
  const lower = target.toLowerCase();
  const hits = target.includes('/')
    ? paths.filter((p) => p.toLowerCase() === lower || p.toLowerCase().endsWith(`/${lower}`))
    : paths.filter((p) => p.slice(p.lastIndexOf('/') + 1).toLowerCase() === lower);
  return hits.length === 1 ? hits[0]! : null;
}
