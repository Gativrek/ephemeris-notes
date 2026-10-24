/**
 * Library watcher (SPECS 4.9). Emits library-relative events, skipping hidden files
 * and folders (except `.vault/vault.json`, `.ephemeris/settings.json` and plugin data),
 * temp files, and the echo of the app's own writes (matched by content hash).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileEvent } from '@shared/bridge';
import { isTempFile } from './atomic';
import { sha256 } from './encoding';
import type { LibraryRoot } from './paths';
import { inProcessBackend, type WatchBackend, type WatchRoots } from './watch-backend';

export type WatchEventType = 'created' | 'changed' | 'deleted';
export interface WatchEvent extends FileEvent {
  type: WatchEventType;
}

const OWN_WRITE_TTL_MS = 10_000;

/** Hidden paths that still matter to the app. */
export function isWatchedHidden(rel: string): boolean {
  const segs = rel.split('/');
  if (segs[0] === '.git' || segs[0] === '.obsidian' || segs[0] === '.trash') return false;
  if (segs[0] === '.ephemeris') {
    return segs.length === 1 || rel === '.ephemeris/settings.json' || segs[1] === 'plugin-data';
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
      /^(cover|banner)\./.test(rest[0] ?? '')
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
  private backend: WatchBackend | null = null;
  readonly ownWrites = new OwnWrites();

  constructor(
    private readonly root: LibraryRoot,
    private readonly emit: (e: WatchEvent) => void,
    /** The app runs chokidar in a worker (watch-worker.ts); tests run it in process. */
    private readonly makeBackend: (roots: WatchRoots) => WatchBackend = (roots) =>
      inProcessBackend(roots, shouldIgnore),
  ) {}

  start(): Promise<void> {
    const backend = this.makeBackend({ root: this.root.root, realRoot: this.root.realRoot });
    this.backend = backend;
    return backend.start((e) => void this.dispatch(e.type, e.kind, e.abs));
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
    const b = this.backend;
    this.backend = null;
    await b?.stop();
  }
}

export function relFromAbs(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}
