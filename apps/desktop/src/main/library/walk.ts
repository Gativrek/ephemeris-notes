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
  for (const d of dirents) {
    if (d.name.startsWith('.') || isTempFile(d.name)) continue;
    const rel = relBase === '' ? d.name : `${relBase}/${d.name}`;
    const abs = path.join(dirAbs, d.name);
    if (d.isDirectory()) {
      yield* walkFiles(rootAbs, rel);
    } else if (d.isFile()) {
      try {
        const st = await fs.stat(abs);
        yield { rel, abs, size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        // Vanished while walking.
      }
    }
  }
}

export function isNote(rel: string): boolean {
  return rel.toLowerCase().endsWith('.md');
}
