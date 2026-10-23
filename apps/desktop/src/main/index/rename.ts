/**
 * Planning link updates for a rename or move (SPECS 5): for each note whose links point
 * into `from`, its new text with those targets rewritten to the shortest unambiguous
 * link after the rename (Markdown links become relative paths). Nothing is written.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { LinkCatalog, relativePath, rewriteLinks } from '@vaults/markdown';
import { decodeText, sha256 } from '../library/encoding';
import type { LibraryIndex } from './indexer';

export interface RenamePlanItem {
  oldPath: string;
  newPath: string;
  /** Hash of the bytes the plan was made from; the write is refused if they changed. */
  hash: string;
  text: string;
  links: number;
}

export const remap = (p: string, from: string, to: string): string =>
  p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p;
const inside = (p: string, root: string) => p === root || p.startsWith(`${root}/`);

export async function planRename(
  index: LibraryIndex,
  paths: string[],
  from: string,
  to: string,
): Promise<RenamePlanItem[]> {
  const before = index.links;
  const after = new LinkCatalog(
    paths.map((p) => remap(p, from, to)),
    new Map(index.aliases().map(([p, a]) => [remap(p, from, to), a] as [string, string[]])),
  );
  const plan: RenamePlanItem[] = [];
  for (const { path: src } of index.linksInto([from])) {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(path.join(index.rootAbs, ...src.split('/')));
    } catch {
      continue;
    }
    const decoded = decodeText(bytes);
    if (decoded.readOnly) continue;
    const newSrc = remap(src, from, to);
    const r = rewriteLinks(decoded.text, (link) => {
      if (!link.target) return null;
      const old = before.resolve(link.target, src).path;
      if (!old || !inside(old, from)) return null;
      const target = remap(old, from, to);
      return link.kind === 'markdown' ? relativePath(newSrc, target) : after.shortestLink(target);
    });
    if (r.changed > 0)
      plan.push({ oldPath: src, newPath: newSrc, hash: sha256(bytes), text: r.text, links: r.changed });
  }
  return plan;
}
