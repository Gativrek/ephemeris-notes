/**
 * Sidebar model (SPECS 9.4): sections, the Unfiled pseudo-tile, the daily tile, and
 * the tree for one section. Pure functions over library paths so they can be tested.
 */
import type { FileEntry, VaultInfo } from '@shared/bridge';

export const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export type SectionKind = 'section' | 'unfiled' | 'daily';

export interface Section {
  kind: SectionKind;
  /** Folder path (the Vault root for Unfiled). */
  path: string;
  name: string;
  noteCount: number;
}

export const UNFILED = 'Unfiled';
export const MAX_TILES = 6;

/** Sections in display order: user order if stored, else alphabetical; daily, then Unfiled, last. */
export function buildSections(vault: VaultInfo, topFolders: string[], files: string[]): Section[] {
  const prefix = `${vault.path}/`;
  const counts = new Map<string, number>();
  let rootNotes = 0;
  for (const f of files) {
    if (!f.startsWith(prefix) || !f.toLowerCase().endsWith('.md')) continue;
    const rest = f.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash < 0) rootNotes++;
    else counts.set(rest.slice(0, slash), (counts.get(rest.slice(0, slash)) ?? 0) + 1);
  }
  const daily = vault.settings.daily;
  const regular = topFolders.filter((n) => !n.startsWith('.') && !n.startsWith('_') && n !== daily);
  const order = vault.sectionOrder;
  regular.sort((a, b) => {
    if (order) {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
    }
    return collator.compare(a, b);
  });
  const out: Section[] = regular.map((name) => ({
    kind: 'section',
    path: `${vault.path}/${name}`,
    name,
    noteCount: counts.get(name) ?? 0,
  }));
  if (topFolders.includes(daily))
    out.push({
      kind: 'daily',
      path: `${vault.path}/${daily}`,
      name: daily,
      noteCount: counts.get(daily) ?? 0,
    });
  if (rootNotes > 0) out.push({ kind: 'unfiled', path: vault.path, name: UNFILED, noteCount: rootNotes });
  return out;
}

/** Tiles shown: at most six; past six, the sixth becomes More (SPECS 9.4). */
export function visibleTiles(sections: Section[], expanded: boolean): { tiles: Section[]; more: boolean } {
  if (expanded || sections.length <= MAX_TILES) return { tiles: sections, more: false };
  return { tiles: sections.slice(0, MAX_TILES - 1), more: true };
}

/** Keyword defaults for section icons (Icon README); anything else gets the folder. */
export function sectionIcon(name: string, kind: SectionKind): string {
  if (kind === 'daily') return 'calendar';
  if (kind === 'unfiled') return 'note';
  const n = name.toLowerCase();
  if (/paper|pdf|reading|literature/.test(n)) return 'papers';
  if (/gnss|gps|orbit|satellite/.test(n)) return 'orbit';
  if (/estimat|kalman|filter|statistic|probab/.test(n)) return 'estimation';
  if (/inertial|imu|gyro/.test(n)) return 'gyro';
  if (/inbox/.test(n)) return 'inbox';
  return 'folder';
}

export type RowKind = 'folder' | 'note' | 'pdf' | 'daily' | 'attachment';

export interface TreeNode {
  path: string;
  name: string;
  kind: RowKind;
  /** Visual depth inside the section: 0 or 1 (TreeRow: two visible levels). */
  depth: number;
  /** For rows flattened from deeper folders: the rest of the folder path (SPECS 9.4). */
  meta: string | null;
  children: TreeNode[];
  /** Notes below a folder, for the right-aligned count. */
  count: number;
}

const DAILY_NAME = /^\d{4}-\d{2}-\d{2}\.md$/;

export function rowKind(entry: FileEntry, dailyFolder: string | null): RowKind {
  if (entry.kind === 'folder') return 'folder';
  const lower = entry.name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.md')) {
    if (dailyFolder && entry.path.startsWith(`${dailyFolder}/`) && DAILY_NAME.test(entry.name))
      return 'daily';
    return 'note';
  }
  return 'attachment';
}

export function sortEntries<T extends { kind: string; name: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const fa = a.kind === 'folder' ? 0 : 1;
    const fb = b.kind === 'folder' ? 0 : 1;
    return fa - fb || collator.compare(a.name, b.name);
  });
}

/** A folder listing, recursively: `entries[path]` lists the children of `path`. */
export type Listing = Map<string, FileEntry[]>;

/**
 * The tree of one section. Levels one and two render as folders and rows; anything
 * deeper is listed flat under its second-level folder, with the remaining folder path
 * as the row's meta (owner decision, SPECS 9.4).
 */
export function buildTree(
  root: string,
  listing: Listing,
  opts: { dailyFolder: string | null; rootFilesOnly?: boolean },
): TreeNode[] {
  const countNotes = (path: string): number => {
    let n = 0;
    for (const e of listing.get(path) ?? []) {
      if (e.kind === 'folder') n += countNotes(e.path);
      else if (e.name.toLowerCase().endsWith('.md')) n++;
    }
    return n;
  };
  const flatten = (folder: string, base: string): TreeNode[] => {
    const out: TreeNode[] = [];
    const walk = (path: string) => {
      for (const e of sortEntries(listing.get(path) ?? [])) {
        if (e.kind === 'folder') walk(e.path);
        else {
          const rel = path.slice(base.length + 1);
          out.push({
            path: e.path,
            name: e.name,
            kind: rowKind(e, opts.dailyFolder),
            depth: 1,
            meta: rel.split('/').join(' / '),
            children: [],
            count: 0,
          });
        }
      }
    };
    for (const e of sortEntries(listing.get(folder) ?? [])) if (e.kind === 'folder') walk(e.path);
    return out;
  };
  const level = (path: string, depth: number): TreeNode[] => {
    const nodes: TreeNode[] = [];
    for (const e of sortEntries(listing.get(path) ?? [])) {
      if (opts.rootFilesOnly && e.kind === 'folder') continue;
      if (e.kind === 'folder') {
        const children = depth === 0 ? level(e.path, 1) : [];
        if (depth === 1) {
          // Second-level folder: its own files, then everything deeper, flattened.
          const own = sortEntries(listing.get(e.path) ?? []).filter((x) => x.kind !== 'folder');
          children.push(
            ...own.map((x) => ({
              path: x.path,
              name: x.name,
              kind: rowKind(x, opts.dailyFolder),
              depth: 2,
              meta: null,
              children: [],
              count: 0,
            })),
            ...flatten(e.path, e.path).map((x) => ({ ...x, depth: 2 })),
          );
        }
        nodes.push({
          path: e.path,
          name: e.name,
          kind: 'folder',
          depth,
          meta: null,
          children,
          count: countNotes(e.path),
        });
      } else {
        nodes.push({
          path: e.path,
          name: e.name,
          kind: rowKind(e, opts.dailyFolder),
          depth,
          meta: null,
          children: [],
          count: 0,
        });
      }
    }
    return nodes;
  };
  return level(root, 0);
}

export function displayName(name: string): string {
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

let dateLocale = 'en-US';
/** Settings > General > Date language. */
export function setDateLocale(locale: string): void {
  try {
    dateLocale = Intl.DateTimeFormat.supportedLocalesOf([locale]).length ? locale : 'en-US';
  } catch {
    dateLocale = 'en-US';
  }
}

/** Weekday for a daily-note row ("Mon"), from its YYYY-MM-DD name. */
export function dailyParts(name: string): { day: string; weekday: string; iso: string } {
  const iso = name.slice(0, 10);
  const d = new Date(`${iso}T12:00:00`);
  return {
    day: String(d.getDate()),
    weekday: d.toLocaleDateString(dateLocale, { weekday: 'long', month: 'short', day: 'numeric' }),
    iso,
  };
}
