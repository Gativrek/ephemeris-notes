/**
 * Recursive listing of library content for counts and indexing. Skips hidden entries,
 * temp files and symlinks (never followed while walking).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { isTempFile } from './atomic';

export interface WalkEntry {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

export async function* walkFiles(rootAbs: string, relBase = ''): AsyncGenerator<WalkEntry> {
  const dirAbs = relBase === '' ? rootAbs : path.join(rootAbs, ...relBase.split('/'));
  let dirents;
  try {
    dirents = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  const files: Array<{ rel: string; abs: string }> = [];
  const dirs: string[] = [];
  for (const d of dirents) {
    if (d.name.startsWith('.') || isTempFile(d.name)) continue;
    const rel = relBase === '' ? d.name : `${relBase}/${d.name}`;
    if (d.isDirectory()) dirs.push(rel);
    else if (d.isFile()) files.push({ rel, abs: path.join(dirAbs, d.name) });
  }
  // Stat a directory's files a batch at a time: one by one is seconds on a large library.
  for (let i = 0; i < files.length; i += STAT_BATCH) {
    const batch = files.slice(i, i + STAT_BATCH);
    const stats = await Promise.all(batch.map((f) => fs.stat(f.abs).catch(() => null)));
    for (let k = 0; k < batch.length; k++) {
      const st = stats[k];
      // A missing stat: vanished while walking.
      if (st) yield { rel: batch[k]!.rel, abs: batch[k]!.abs, size: st.size, mtimeMs: st.mtimeMs };
    }
  }
  for (const rel of dirs) yield* walkFiles(rootAbs, rel);
}

const STAT_BATCH = 32;

export function isNote(rel: string): boolean {
  return rel.toLowerCase().endsWith('.md');
}
