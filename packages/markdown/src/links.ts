/**
 * Link resolution (SPECS 5): library-wide and case-insensitive, Obsidian-compatible.
 * Pure: the caller supplies the list of library paths (and optional note aliases).
 */

export const DOMAIN_FOLDERS = ['Academic', 'Work', 'Personal'];

export interface Resolution {
  path: string | null;
  /** All candidates when the link is ambiguous (rule 4), else empty. */
  candidates: string[];
}

const lower = (s: string) => s.toLocaleLowerCase();
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const EXT = /\.[A-Za-z0-9]{1,8}$/;

export function hasExtension(target: string): boolean {
  return EXT.test(baseName(target));
}

/** `Domain/Vault` for paths inside a Vault folder, else null. */
export function vaultRootOf(path: string): string | null {
  const segs = path.split('/');
  return segs.length >= 3 && DOMAIN_FOLDERS.includes(segs[0]!) ? `${segs[0]}/${segs[1]}` : null;
}

export function domainOf(path: string): string | null {
  const first = path.split('/')[0]!;
  return DOMAIN_FOLDERS.includes(first) && path.includes('/') ? first : null;
}

/** Library-relative path normalization: no `./`, no `../` beyond the root. */
function normalize(p: string): string | null {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

export class LinkCatalog {
  private readonly byLowerPath = new Map<string, string[]>();
  private readonly byLowerName = new Map<string, string[]>();
  private readonly byLowerAlias = new Map<string, string[]>();
  private readonly paths: string[];

  constructor(paths: Iterable<string>, aliases?: Map<string, string[]>) {
    this.paths = [...paths];
    for (const p of this.paths) {
      push(this.byLowerPath, lower(p), p);
      push(this.byLowerName, lower(baseName(p)), p);
    }
    if (aliases) {
      for (const [p, list] of aliases) for (const a of list) push(this.byLowerAlias, lower(`${a}.md`), p);
    }
  }

  get size(): number {
    return this.paths.length;
  }

  has(path: string): boolean {
    return this.byLowerPath.has(lower(path));
  }

  /** Candidate spellings of a target: `<target>.md` first, then the exact name. */
  private spellings(target: string): string[] {
    return hasExtension(target) ? [target, `${target}.md`] : [`${target}.md`, target];
  }

  private exactPath(p: string): string[] {
    return this.byLowerPath.get(lower(p)) ?? [];
  }

  private suffixMatches(p: string): string[] {
    const suffix = `/${lower(p)}`;
    return this.paths.filter((x) => lower(x).endsWith(suffix));
  }

  resolve(rawTarget: string, fromPath: string): Resolution {
    const target = rawTarget.trim().replace(/^\/+/, '');
    if (!target) return { path: null, candidates: [] };
    // Rule 2: paths.
    if (target.includes('/')) {
      const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
      const vault = vaultRootOf(fromPath);
      for (const spelling of this.spellings(target)) {
        const rel =
          target.startsWith('./') || target.startsWith('../') ? normalize(`${fromDir}/${spelling}`) : null;
        if (rel !== null) {
          const hit = pick(this.exactPath(rel), spelling, fromPath);
          if (hit) return hit;
        }
        const tries = [normalize(spelling), vault ? normalize(`${vault}/${spelling}`) : null];
        for (const t of tries) {
          if (t === null) continue;
          const hit = pick(this.exactPath(t), spelling, fromPath);
          if (hit) return hit;
        }
      }
      for (const spelling of this.spellings(target)) {
        const n = normalize(spelling);
        if (n === null) continue;
        const hit = pick(this.suffixMatches(n), spelling, fromPath);
        if (hit) return hit;
      }
      return { path: null, candidates: [] };
    }
    // Rule 3: file names, then aliases.
    for (const spelling of this.spellings(target)) {
      const hit = pick(this.byLowerName.get(lower(spelling)) ?? [], spelling, fromPath);
      if (hit) return hit;
    }
    if (!hasExtension(target)) {
      const hit = pick(this.byLowerAlias.get(lower(`${target}.md`)) ?? [], `${target}.md`, fromPath);
      if (hit) return hit;
    }
    return { path: null, candidates: [] };
  }

  /**
   * The link text the app writes (SPECS 5, "Writing links"): the file name alone when it
   * is unique library-wide, otherwise the shortest unique path suffix. `.md` is dropped.
   */
  shortestLink(path: string): string {
    const strip = (s: string) => (/\.md$/i.test(s) ? s.slice(0, -3) : s);
    const segs = path.split('/');
    for (let k = 1; k <= segs.length; k++) {
      const suffix = segs.slice(segs.length - k).join('/');
      const matches =
        k === 1 ? (this.byLowerName.get(lower(suffix)) ?? []) : this.suffixMatchesOrExact(suffix);
      if (matches.length === 1 && matches[0] === path) {
        // A bare stem must not also hit a different file spelled without `.md`.
        const text = strip(suffix);
        const check = k === 1 ? this.resolveName(text) : null;
        if (k > 1 || check === path) return text;
      }
    }
    return strip(path);
  }

  private suffixMatchesOrExact(suffix: string): string[] {
    const exact = this.exactPath(suffix);
    const tail = this.suffixMatches(suffix);
    return [...new Set([...exact, ...tail])];
  }

  private resolveName(text: string): string | null {
    for (const spelling of this.spellings(text)) {
      const list = this.byLowerName.get(lower(spelling)) ?? [];
      if (list.length === 1) return list[0]!;
      if (list.length > 1) return null;
    }
    return null;
  }

  /** All ambiguous names: file names shared by more than one path (Settings > Library). */
  ambiguousNames(): Array<{ name: string; paths: string[] }> {
    const out: Array<{ name: string; paths: string[] }> = [];
    for (const [, list] of this.byLowerName)
      if (list.length > 1) out.push({ name: baseName(list[0]!), paths: [...list].sort() });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Rule 4: prefer exact case, then the same Vault, the same Domain, the shortest path, then alphabetical. */
function pick(candidates: string[], spelling: string, fromPath: string): Resolution | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { path: candidates[0]!, candidates: [] };
  const name = baseName(spelling);
  const exact = candidates.filter((c) => baseName(c) === name || c.endsWith(spelling));
  const pool = exact.length > 0 ? exact : candidates;
  if (pool.length === 1) return { path: pool[0]!, candidates: [] };
  const vault = vaultRootOf(fromPath);
  const domain = domainOf(fromPath);
  const ranked = [...pool].sort((a, b) => {
    const va = vault && vaultRootOf(a) === vault ? 0 : 1;
    const vb = vault && vaultRootOf(b) === vault ? 0 : 1;
    if (va !== vb) return va - vb;
    const da = domain && domainOf(a) === domain ? 0 : 1;
    const db = domain && domainOf(b) === domain ? 0 : 1;
    if (da !== db) return da - db;
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { path: ranked[0]!, candidates: [...candidates].sort() };
}
