/**
 * Library watcher (SPECS 4.9). Emits library-relative events, skipping hidden files
 * and folders (except `.vault/vault.json`, `.vaults/settings.json` and plugin data),
 * temp files, and the echo of the app's own writes (matched by content hash).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { FileEvent } from '@shared/bridge';
import { isTempFile } from './atomic';
import { sha256 } from './encoding';
import type { LibraryRoot } from './paths';

export type WatchEventType = 'created' | 'changed' | 'deleted';
export interface WatchEvent extends FileEvent {
  type: WatchEventType;
}

const OWN_WRITE_TTL_MS = 10_000;

/** Hidden paths that still matter to the app. */
export function isWatchedHidden(rel: string): boolean {
  const segs = rel.split('/');
  if (segs[0] === '.git' || segs[0] === '.obsidian' || segs[0] === '.trash') return false;
  if (segs[0] === '.vaults') {
    return segs.length === 1 || rel === '.vaults/settings.json' || segs[1] === 'plugin-data';
  }
  const i = segs.indexOf('.vault');
  if (i !== -1) {
    // Only `<Domain>/<Vault>/.vault/...` counts; nothing else hidden is watched.
    if (segs.slice(0, i).some((s) => s.startsWith('.'))) return false;
    const rest = segs.slice(i + 1);
    return (
      rest.length === 0 ||
      rest[0] === 'vault.json' ||
      rest[0] === 'plugin-data' ||
      /^cover\./.test(rest[0] ?? '')
    );
  }
  return !segs.some((s) => s.startsWith('.'));
}

export function shouldIgnore(rel: string): boolean {
  if (rel === '') return false;
  const name = rel.split('/').pop() ?? '';
  if (isTempFile(name)) return true;
  return !isWatchedHidden(rel);
}

export class OwnWrites {
  private readonly pending = new Map<string, Array<{ hash: string | null; at: number }>>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Records a write the app is about to make. `hash` null means rename/delete. */
  expect(rel: string, hash: string | null): void {
    const list = this.pending.get(rel) ?? [];
    list.push({ hash, at: this.now() });
    this.pending.set(rel, list);
  }

  /** True (and consumed) when an event for `rel` with this content is our own echo. */
  consume(rel: string, hash: string | null): boolean {
    const list = this.pending.get(rel);
    if (!list) return false;
    const cutoff = this.now() - OWN_WRITE_TTL_MS;
    const live = list.filter((e) => e.at >= cutoff);
    const i = live.findIndex((e) => e.hash === hash || e.hash === null);
    if (i === -1) {
      if (live.length) this.pending.set(rel, live);
      else this.pending.delete(rel);
      return false;
    }
    live.splice(i, 1);
    if (live.length) this.pending.set(rel, live);
    else this.pending.delete(rel);
    return true;
  }
}

export class LibraryWatcher {
  private watcher: FSWatcher | null = null;
  readonly ownWrites = new OwnWrites();

  constructor(
    private readonly root: LibraryRoot,
    private readonly emit: (e: WatchEvent) => void,
  ) {}

  start(): Promise<void> {
    const rootAbs = this.root.root;
    const watcher = watch(rootAbs, {
      ignoreInitial: true,
      followSymlinks: false,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
      ignored: (p: string) => {
        // chokidar passes forward slashes to `ignored` on Windows.
        const rel = this.root.toRelative(path.normalize(p));
        return rel === null || shouldIgnore(rel);
      },
    });
    this.watcher = watcher;
    const handle = (type: WatchEventType, kind: FileEvent['kind']) => (abs: string) => {
      void this.dispatch(type, kind, abs);
    };
    watcher.on('add', handle('created', 'file'));
    watcher.on('change', handle('changed', 'file'));
    watcher.on('unlink', handle('deleted', 'file'));
    watcher.on('addDir', handle('created', 'folder'));
    watcher.on('unlinkDir', handle('deleted', 'folder'));
    return new Promise((resolve) => watcher.once('ready', () => resolve()));
  }

  private async dispatch(type: WatchEventType, kind: FileEvent['kind'], abs: string): Promise<void> {
    const rel = this.root.toRelative(path.normalize(abs));
    if (rel === null || rel === '' || shouldIgnore(rel)) return;
    let hash: string | null = null;
    if (kind === 'file' && type !== 'deleted') {
      try {
        hash = sha256(await readFile(abs));
      } catch {
        return; // Gone again before we could read it; the unlink event follows.
      }
    }
    if (this.ownWrites.consume(rel, hash)) return;
    this.emit({ type, kind, path: rel });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}

export function relFromAbs(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}
