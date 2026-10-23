/**
 * One pass over a note's syntax tree, producing everything the index and the outline
 * need: frontmatter, headings, links and embeds, tags, block IDs, equations (with
 * numbering), cross-references and fenced blocks. Lines are 1-based.
 */
import type { Tree } from '@lezer/common';
import { parseInfoString, type InfoString } from './infostring';
import { markdownParser } from './syntax';
import { parseYaml, type YamlValue } from './yaml';

export interface Frontmatter {
  from: number;
  to: number;
  /** YAML source between the fences. */
  raw: string;
  data: { [key: string]: YamlValue } | null;
  error: string | null;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
  from: number;
  to: number;
}

export interface LinkRef {
  kind: 'wikilink' | 'embed' | 'markdown';
  /** The raw target as written, without `#…` and `|alias`. */
  target: string;
  heading: string | null;
  block: string | null;
  /** From `#page=N` on PDF links. */
  page: number | null;
  alias: string | null;
  /** Embed width from `|300`. */
  width: number | null;
  line: number;
  col: number;
  from: number;
  to: number;
}

export interface Equation {
  label: string | null;
  tex: string;
  /** Displayed number ("3", or the \tag text), or null when unnumbered. */
  number: string | null;
  line: number;
  from: number;
  to: number;
}

export interface CrossRef {
  kind: 'eq' | 'fig' | 'tbl';
  label: string;
  line: number;
  from: number;
  to: number;
}

export interface FencedBlock {
  lang: string;
  info: InfoString;
  /** Lines of the opening and closing fences. */
  lineStart: number;
  lineEnd: number;
  from: number;
  to: number;
  /** The body between the fences (excluding the fence lines). */
  bodyFrom: number;
  bodyTo: number;
}

export interface NoteSummary {
  frontmatter: Frontmatter | null;
  headings: Heading[];
  links: LinkRef[];
  tags: Array<{ tag: string; line: number; from: number }>;
  blockIds: Array<{ id: string; line: number; from: number }>;
  equations: Equation[];
  references: CrossRef[];
  blocks: FencedBlock[];
  /** Duplicate equation labels (the second and later occurrences). */
  duplicateLabels: Array<{ label: string; from: number; line: number }>;
}

export type NumberingMode = 'all' | 'labeled';

class LineIndex {
  private readonly starts: number[] = [0];
  constructor(text: string) {
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) this.starts.push(i + 1);
  }
  /** 1-based line containing `pos`. */
  line(pos: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
  col(pos: number): number {
    return pos - this.starts[this.line(pos) - 1]! + 1;
  }
}

/** Splits `Target#Heading`, `Target#^block`, `file.pdf#page=3`. */
export function splitTarget(raw: string): {
  target: string;
  heading: string | null;
  block: string | null;
  page: number | null;
} {
  const hash = raw.indexOf('#');
  if (hash < 0) return { target: raw.trim(), heading: null, block: null, page: null };
  const target = raw.slice(0, hash).trim();
  const frag = raw.slice(hash + 1);
  if (frag.startsWith('^')) return { target, heading: null, block: frag.slice(1).trim(), page: null };
  const page = /^page=(\d+)$/.exec(frag.trim());
  if (page) return { target, heading: null, block: null, page: Number(page[1]) };
  return { target, heading: frag.trim() || null, block: null, page: null };
}

const TAG_RE = /\\tag\*?\{([^}]*)\}/;

/** Numbers display equations per note (SPECS 10.3). `\tag{…}` overrides and does not count. */
export function numberEquations(
  eqs: Array<Pick<Equation, 'label' | 'tex'>>,
  mode: NumberingMode,
): Array<string | null> {
  let n = 0;
  return eqs.map((e) => {
    const tag = TAG_RE.exec(e.tex);
    if (tag) return tag[1]!.trim();
    if (/\\notag\b|\\nonumber\b/.test(e.tex)) return null;
    if (mode === 'labeled' && !e.label) return null;
    n++;
    return String(n);
  });
}

/** Plain text of a heading line, without the marks. */
function headingText(text: string, from: number, to: number): string {
  return text
    .slice(from, to)
    .replace(/^#{1,6}[ \t]*/, '')
    .replace(/[ \t]+#+[ \t]*$/, '')
    .replace(/\n[=-]+[ \t]*$/, '')
    .trim();
}

export function parseTree(text: string): Tree {
  return markdownParser.parse(text);
}

export function analyzeNote(
  text: string,
  opts: { numbering?: NumberingMode; tree?: Tree } = {},
): NoteSummary {
  const tree = opts.tree ?? parseTree(text);
  const lines = new LineIndex(text);
  const out: NoteSummary = {
    frontmatter: null,
    headings: [],
    links: [],
    tags: [],
    blockIds: [],
    equations: [],
    references: [],
    blocks: [],
    duplicateLabels: [],
  };
  const rawEquations: Array<Omit<Equation, 'number'>> = [];

  tree.iterate({
    enter(node) {
      const name = node.name;
      if (name === 'Frontmatter') {
        const content = node.node.getChild('FrontmatterContent');
        const raw = content ? text.slice(content.from, content.to) : '';
        const parsed = parseYaml(raw);
        const data =
          parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
            ? parsed.value
            : null;
        out.frontmatter = {
          from: node.from,
          to: node.to,
          raw,
          data: parsed.error ? null : (data ?? {}),
          error: parsed.error ?? (parsed.value !== null && !data ? 'Frontmatter is not a mapping.' : null),
        };
        return false;
      }
      if (/^(ATX|Setext)Heading[1-6]$/.test(name)) {
        out.headings.push({
          level: Number(name.slice(-1)),
          text: headingText(text, node.from, node.to),
          line: lines.line(node.from),
          from: node.from,
          to: node.to,
        });
        return true;
      }
      if (name === 'WikiLink' || name === 'Embed') {
        const n = node.node;
        const t = n.getChild('WikiLinkTarget');
        const a = n.getChild('WikiLinkAlias');
        const parts = splitTarget(t ? text.slice(t.from, t.to) : '');
        const alias = a ? text.slice(a.from, a.to) : null;
        const width =
          name === 'Embed' && alias && /^\d+(x\d+)?$/.test(alias.trim())
            ? Number(alias.trim().split('x')[0])
            : null;
        out.links.push({
          kind: name === 'Embed' ? 'embed' : 'wikilink',
          ...parts,
          alias: width !== null ? null : alias,
          width,
          line: lines.line(node.from),
          col: lines.col(node.from),
          from: node.from,
          to: node.to,
        });
        return false;
      }
      if (name === 'Link' || name === 'Image') {
        const url = node.node.getChild('URL');
        if (url) {
          const href = text.slice(url.from, url.to).replace(/^<|>$/g, '');
          if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
            let decoded = href;
            try {
              decoded = decodeURI(href);
            } catch {
              // Keep the raw href.
            }
            const parts = splitTarget(decoded);
            out.links.push({
              kind: name === 'Image' ? 'embed' : 'markdown',
              ...parts,
              alias: null,
              width: null,
              line: lines.line(node.from),
              col: lines.col(node.from),
              from: node.from,
              to: node.to,
            });
          }
        }
        return true;
      }
      if (name === 'Tag') {
        out.tags.push({
          tag: text.slice(node.from + 1, node.to),
          line: lines.line(node.from),
          from: node.from,
        });
        return false;
      }
      if (name === 'BlockId') {
        out.blockIds.push({
          id: text.slice(node.from + 1, node.to),
          line: lines.line(node.from),
          from: node.from,
        });
        return false;
      }
      if (name === 'CrossRef') {
        const m = /^@(eq|fig|tbl):(.+)$/.exec(text.slice(node.from, node.to));
        if (m) {
          out.references.push({
            kind: m[1] as CrossRef['kind'],
            label: `${m[1]}:${m[2]}`,
            line: lines.line(node.from),
            from: node.from,
            to: node.to,
          });
        }
        return false;
      }
      if (name === 'MathBlock') {
        const n = node.node;
        const c = n.getChild('MathContent');
        const l = n.getChild('EquationLabel');
        rawEquations.push({
          label: l ? text.slice(l.from + 2, l.to - 1) : null,
          tex: c ? text.slice(c.from, c.to).trim() : '',
          line: lines.line(node.from),
          from: node.from,
          to: node.to,
        });
        return false;
      }
      if (name === 'FencedCode') {
        const n = node.node;
        const info = n.getChild('CodeInfo');
        const parsed = parseInfoString(info ? text.slice(info.from, info.to) : '');
        const marks = n.getChildren('CodeMark');
        const open = marks[0];
        const close = marks.length > 1 ? marks[marks.length - 1] : null;
        const openLineEnd = text.indexOf('\n', open ? open.to : node.from);
        const bodyFrom = openLineEnd < 0 || openLineEnd >= node.to ? node.to : openLineEnd + 1;
        let bodyTo = close ? close.from : node.to;
        // The body ends before the closing fence's line.
        if (close) {
          const lineStart = text.lastIndexOf('\n', close.from - 1);
          bodyTo = Math.max(bodyFrom, lineStart < 0 ? bodyFrom : lineStart);
        }
        out.blocks.push({
          lang: parsed.language,
          info: parsed,
          lineStart: lines.line(node.from),
          lineEnd: lines.line(Math.max(node.from, node.to - 1)),
          from: node.from,
          to: node.to,
          bodyFrom,
          bodyTo,
        });
        return false;
      }
      if (name === 'InlineCode' || name === 'CodeBlock' || name === 'HTMLBlock' || name === 'CommentBlock')
        return false;
      return true;
    },
  });

  const numbers = numberEquations(rawEquations, opts.numbering ?? 'all');
  const seen = new Set<string>();
  rawEquations.forEach((e, i) => {
    out.equations.push({ ...e, number: numbers[i] ?? null });
    if (e.label) {
      if (seen.has(e.label)) out.duplicateLabels.push({ label: e.label, from: e.from, line: e.line });
      seen.add(e.label);
    }
  });
  return out;
}

/** The note title: frontmatter `title`, else the first H1, else the file name. */
export function noteTitle(summary: Pick<NoteSummary, 'frontmatter' | 'headings'>, path: string): string {
  const fm = summary.frontmatter?.data?.title;
  if (typeof fm === 'string' && fm.trim()) return fm.trim();
  const h1 = summary.headings.find((h) => h.level === 1);
  if (h1 && h1.text) return h1.text;
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '');
}

/** Frontmatter `tags` and `aliases` as string lists (either a list or a comma string). */
export function stringList(v: YamlValue | undefined): string[] {
  if (Array.isArray(v))
    return v.filter((x): x is string | number => typeof x === 'string' || typeof x === 'number').map(String);
  if (typeof v === 'string')
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}
