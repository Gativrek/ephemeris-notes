/**
 * Declarative plugin extractors (SPECS 12.11.2). Plugins describe what to pull out of
 * notes as plain data (regex, fence or frontmatter); the index worker applies it. No
 * plugin code runs here: this worker has Node.
 */
import type { NoteSummary } from '@vaults/markdown';

export type ExtractorKind =
  | {
      kind: 'regex';
      pattern: string;
      flags?: '' | 'i' | 'u' | 'iu';
      key: number | string;
      value?: number | string;
    }
  | { kind: 'fence'; language: string }
  | { kind: 'frontmatter'; field: string };

export type ExtractorSpecInput = {
  id: string;
  version: number;
  where?: { frontmatter?: Record<string, string | number | boolean>; outsideCode?: boolean };
} & ExtractorKind;

export interface Extractor {
  plugin: string;
  spec: ExtractorSpecInput;
  re: RegExp | null;
}

export interface ExtractedRecord {
  line: number;
  key: string;
  value: string | null;
}

export const LIMITS = { pattern: 512, perNote: 1000, key: 512, value: 64 * 1024 } as const;
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** Validates and compiles a spec; throws a readable reason. */
export function compileExtractor(plugin: string, raw: unknown): Extractor {
  if (!raw || typeof raw !== 'object') throw new Error('An extractor spec must be an object.');
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !ID.test(s.id))
    throw new Error('Extractor id must match ^[a-z0-9][a-z0-9-]{0,47}$.');
  if (typeof s.version !== 'number' || !Number.isInteger(s.version) || s.version < 0)
    throw new Error('Extractor version must be a whole number.');
  const where = s.where as ExtractorSpecInput['where'] | undefined;
  if (where !== undefined && (typeof where !== 'object' || where === null))
    throw new Error('"where" must be an object.');
  if (where?.frontmatter !== undefined) {
    if (typeof where.frontmatter !== 'object' || where.frontmatter === null)
      throw new Error('"where.frontmatter" must be an object.');
    for (const v of Object.values(where.frontmatter))
      if (!['string', 'number', 'boolean'].includes(typeof v))
        throw new Error('"where.frontmatter" values must be strings, numbers or booleans.');
  }
  const base = { id: s.id, version: s.version, ...(where ? { where } : {}) };
  if (s.kind === 'regex') {
    if (typeof s.pattern !== 'string' || !s.pattern) throw new Error('A regex extractor needs a pattern.');
    if (s.pattern.length > LIMITS.pattern)
      throw new Error(`Patterns are limited to ${LIMITS.pattern} characters.`);
    const flags = s.flags ?? '';
    if (!['', 'i', 'u', 'iu'].includes(flags as string))
      throw new Error('flags must be "", "i", "u" or "iu".');
    const key = s.key;
    if (typeof key !== 'number' && typeof key !== 'string')
      throw new Error('"key" must name a capture group.');
    if (s.value !== undefined && typeof s.value !== 'number' && typeof s.value !== 'string')
      throw new Error('"value" must name a capture group.');
    let re: RegExp;
    try {
      re = new RegExp(s.pattern, `${flags as string}gm`);
    } catch (err) {
      throw new Error(`The pattern does not compile: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
    const spec: ExtractorSpecInput = {
      ...base,
      kind: 'regex',
      pattern: s.pattern,
      flags: flags as '' | 'i' | 'u' | 'iu',
      key,
      ...(s.value !== undefined ? { value: s.value as number | string } : {}),
    };
    return { plugin, spec, re };
  }
  if (s.kind === 'fence') {
    if (typeof s.language !== 'string' || !s.language) throw new Error('A fence extractor needs a language.');
    return { plugin, spec: { ...base, kind: 'fence', language: s.language.toLowerCase() }, re: null };
  }
  if (s.kind === 'frontmatter') {
    if (typeof s.field !== 'string' || !s.field) throw new Error('A frontmatter extractor needs a field.');
    return { plugin, spec: { ...base, kind: 'frontmatter', field: s.field }, re: null };
  }
  throw new Error('kind must be "regex", "fence" or "frontmatter".');
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}
function lineOf(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function group(m: RegExpExecArray, g: number | string): string | undefined {
  return typeof g === 'number' ? m[g] : m.groups?.[g];
}

function scalar(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** The records one extractor yields for one note. */
export function extract(ex: Extractor, text: string, summary: NoteSummary): ExtractedRecord[] {
  const spec = ex.spec;
  const fm = summary.frontmatter?.data ?? null;
  if (spec.where?.frontmatter) {
    for (const [k, v] of Object.entries(spec.where.frontmatter)) if (!fm || fm[k] !== v) return [];
  }
  const out: ExtractedRecord[] = [];
  if (spec.kind === 'frontmatter') {
    const v = fm?.[spec.field];
    if (v === undefined) return [];
    for (const item of Array.isArray(v) ? v : [v]) {
      const key = scalar(item);
      if (key !== null && out.length < LIMITS.perNote)
        out.push({ line: 1, key: clip(key, LIMITS.key), value: null });
    }
    return out;
  }
  if (spec.kind === 'fence') {
    for (const b of summary.blocks) {
      if (b.lang !== spec.language || out.length >= LIMITS.perNote) continue;
      out.push({
        line: b.lineStart,
        key: clip(b.info.rest.trim(), LIMITS.key),
        value: clip(text.slice(b.bodyFrom, b.bodyTo), LIMITS.value),
      });
    }
    return out;
  }
  // Regex: skip matches that start inside frontmatter, code or display math.
  const re = ex.re!;
  const skip: Array<[number, number]> = [];
  if (spec.where?.outsideCode !== false) {
    if (summary.frontmatter) skip.push([summary.frontmatter.from, summary.frontmatter.to]);
    for (const b of summary.blocks) skip.push([b.from, b.to]);
    for (const e of summary.equations) skip.push([e.from, e.to]);
  }
  const starts = lineStarts(text);
  re.lastIndex = 0;
  for (let m = re.exec(text); m && out.length < LIMITS.perNote; m = re.exec(text)) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    if (skip.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
    const key = group(m, spec.key);
    if (key === undefined || key === '') continue;
    const value = spec.value !== undefined ? (group(m, spec.value) ?? null) : null;
    out.push({
      line: lineOf(starts, m.index),
      key: clip(key, LIMITS.key),
      value: value === null ? null : clip(value, LIMITS.value),
    });
  }
  return out;
}
