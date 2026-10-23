/**
 * The open library: its root, file operations and watcher. One library is open at a
 * time (SPECS 2). Events go to every window through `broadcast`.
 */
import { stat } from 'node:fs/promises';
import type { LibraryInfo, PushEvent } from '@shared/bridge';
import { fail } from '@shared/result';
import { LibraryFs, type FsDeps } from '../library/fileio';
import { readLibrary } from '../library/library';
import { LibraryRoot } from '../library/paths';
import { LibraryWatcher, type WatchEvent } from '../library/watcher';

export interface LibrarySession {
  info: LibraryInfo;
  root: LibraryRoot;
  fs: LibraryFs;
  watcher: LibraryWatcher;
}

export type Broadcast = (event: PushEvent) => void;
export type WatchListener = (e: WatchEvent) => void;

export class SessionManager {
  private session: LibrarySession | null = null;
  private readonly watchListeners = new Set<WatchListener>();
  private readonly openListeners = new Set<(s: LibrarySession | null) => void | Promise<void>>();

  constructor(
    private readonly broadcast: Broadcast,
    private readonly trash: FsDeps['trash'],
  ) {}

  get current(): LibrarySession | null {
    return this.session;
  }

  require(): LibrarySession {
    if (!this.session) fail('NO_LIBRARY', 'No library is open.');
    return this.session;
  }

  /** Main-process listeners for raw watcher events (index, Vault cache). */
  onWatch(fn: WatchListener): () => void {
    this.watchListeners.add(fn);
    return () => this.watchListeners.delete(fn);
  }

  onOpenChanged(fn: (s: LibrarySession | null) => void | Promise<void>): () => void {
    this.openListeners.add(fn);
    return () => this.openListeners.delete(fn);
  }

  async open(folder: string): Promise<LibraryInfo> {
    const info = await readLibrary(folder);
    if (!info) fail('NOT_A_LIBRARY', 'This folder is not a library.');
    await this.close(false);
    const root = await LibraryRoot.create(folder);
    let watcher: LibraryWatcher | null = null;
    const fs = new LibraryFs(root, {
      trash: this.trash,
      onOwnWrite: (rel, hash) => watcher?.ownWrites.expect(rel, hash),
      // Windows refuses to move a folder while the watcher holds handles inside it,
      // and chokidar's unwatch does not release them: restart the watcher instead.
      aroundMove: async (fromAbs, _toAbs, fn) => {
        if (process.platform !== 'win32' || !watcher) return fn();
        const isDir = await stat(fromAbs).then(
          (s) => s.isDirectory(),
          () => false,
        );
        if (!isDir) return fn();
        await watcher.stop();
        try {
          return await fn();
        } finally {
          await watcher.start();
        }
      },
    });
    watcher = new LibraryWatcher(root, (e) => {
      for (const fn of this.watchListeners) fn(e);
      this.broadcast({ type: `file.${e.type}`, payload: { path: e.path, kind: e.kind } });
    });
    await watcher.start();
    this.session = { info, root, fs, watcher };
    for (const fn of this.openListeners) await fn(this.session);
    this.broadcast({ type: 'library.changed', payload: info });
    return info;
  }

  async close(notify = true): Promise<void> {
    const s = this.session;
    this.session = null;
    if (s) {
      await s.watcher.stop();
      for (const fn of this.openListeners) await fn(null);
    }
    if (notify) this.broadcast({ type: 'library.changed', payload: null });
  }
}
