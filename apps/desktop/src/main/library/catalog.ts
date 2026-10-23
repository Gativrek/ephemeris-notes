/**
 * The file catalog: every visible file in the library with its size and mtime, kept up
 * to date from the watcher and from the app's own operations. The renderer resolves
 * links against it (SPECS 5); the M3 index builds on it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CatalogEntry } from '@shared/bridge';
import { isTempFile } from './atomic';
import { isNote, walkFiles } from './walk';

export class FileCatalog {
  private readonly files = new Map<string, CatalogEntry>();
  private ready: Promise<void> | null = null;
  private version = 0;

  constructor(private readonly rootAbs: string) {}

  /** Walks the library once. Safe to call repeatedly. */
  build(): Promise<void> {
    this.ready ??= (async () => {
      for await (const f of walkFiles(this.rootAbs))
        this.files.set(f.rel, { path: f.rel, size: f.size, mtime: f.mtimeMs });
      this.version++;
    })();
    return this.ready;
  }

  /** Note count and newest note mtime under `rel` (Vault cards), without touching the disk. */
  async statsUnder(rel: string): Promise<{ noteCount: number; lastEdited: number | null }> {
    await this.build();
    const prefix = `${rel}/`;
    let noteCount = 0;
    let lastEdited: number | null = null;
    for (const f of this.files.values()) {
      if (!f.path.startsWith(prefix) || !isNote(f.path)) continue;
      noteCount++;
      if (lastEdited === null || f.mtime > lastEdited) lastEdited = f.mtime;
    }
    return { noteCount, lastEdited };
  }

  /** Walks again and replaces the list; true when anything differed. */
  async rescan(): Promise<boolean> {
    await this.build();
    const next = new Map<string, CatalogEntry>();
    for await (const f of walkFiles(this.rootAbs))
      next.set(f.rel, { path: f.rel, size: f.size, mtime: f.mtimeMs });
    let differs = next.size !== this.files.size;
    for (const [k, v] of next) {
      if (differs) break;
      const old = this.files.get(k);
      differs = !old || old.size !== v.size || old.mtime !== v.mtime;
    }
    if (!differs) return false;
    this.files.clear();
    for (const [k, v] of next) this.files.set(k, v);
    this.version++;
    return true;
  }

  async list(): Promise<{ version: number; files: CatalogEntry[] }> {
    await this.build();
    return { version: this.version, files: [...this.files.values()] };
  }

  get(rel: string): CatalogEntry | undefined {
    return this.files.get(rel);
  }

  get changeVersion(): number {
    return this.version;
  }

  private static visible(rel: string): boolean {
    return !rel.split('/').some((s) => s.startsWith('.') || isTempFile(s));
  }

  /** Re-reads `rel` from disk: adds, updates or removes it (and, for folders, its content). */
  async refresh(rel: string): Promise<void> {
    await this.build();
    if (!FileCatalog.visible(rel)) return;
    const abs = path.join(this.rootAbs, ...rel.split('/'));
    let st;
    try {
      st = await fs.stat(abs);
    } catch {
      st = null;
    }
    const prefix = `${rel}/`;
    if (!st) {
      this.files.delete(rel);
      for (const k of [...this.files.keys()]) if (k.startsWith(prefix)) this.files.delete(k);
    } else if (st.isDirectory()) {
      for (const k of [...this.files.keys()]) if (k.startsWith(prefix)) this.files.delete(k);
      for await (const f of walkFiles(this.rootAbs, rel))
        this.files.set(f.rel, { path: f.rel, size: f.size, mtime: f.mtimeMs });
    } else {
      const existed = this.files.has(rel);
      this.files.set(rel, { path: rel, size: st.size, mtime: st.mtimeMs });
      // A content change keeps the file list as it was: the version stays.
      if (existed) return;
    }
    this.version++;
  }
}
