/**
 * Where chokidar runs. Its initial scan of a large library is thousands of callbacks;
 * in the main process that stalls window frames for seconds, so the app runs it in a
 * worker thread (`watch-worker.ts`). Tests use the in-process backend.
 */
import path from 'node:path';
import type { Worker } from 'node:worker_threads';
import { watch, type FSWatcher } from 'chokidar';
import { isInside } from './paths';

export type RawWatchType = 'created' | 'changed' | 'deleted';
export interface RawWatchEvent {
  type: RawWatchType;
  kind: 'file' | 'folder';
  abs: string;
}

export interface WatchBackend {
  /** Resolves once the initial scan is done. */
  start(onEvent: (e: RawWatchEvent) => void): Promise<void>;
  stop(): Promise<void>;
}

/** `rootAbs` and its real path, so either spelling of a path maps to library-relative. */
export interface WatchRoots {
  root: string;
  realRoot: string;
}

export function relativeTo(roots: WatchRoots, abs: string): string | null {
  for (const base of [roots.root, roots.realRoot]) {
    if (isInside(base, abs)) return path.relative(base, abs).split(path.sep).join('/');
  }
  return null;
}

/** chokidar with the app's options; `ignore` gets library-relative paths. */
export function startChokidar(
  roots: WatchRoots,
  ignore: (rel: string) => boolean,
  onEvent: (e: RawWatchEvent) => void,
): { watcher: FSWatcher; ready: Promise<void> } {
  const watcher = watch(roots.root, {
    ignoreInitial: true,
    followSymlinks: false,
    atomic: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    ignored: (p: string) => {
      // chokidar passes forward slashes to `ignored` on Windows.
      const rel = relativeTo(roots, path.normalize(p));
      return rel === null || ignore(rel);
    },
  });
  const on = (type: RawWatchType, kind: RawWatchEvent['kind']) => (abs: string) =>
    onEvent({ type, kind, abs });
  watcher.on('add', on('created', 'file'));
  watcher.on('change', on('changed', 'file'));
  watcher.on('unlink', on('deleted', 'file'));
  watcher.on('addDir', on('created', 'folder'));
  watcher.on('unlinkDir', on('deleted', 'folder'));
  return { watcher, ready: new Promise((resolve) => watcher.once('ready', () => resolve())) };
}

export function inProcessBackend(roots: WatchRoots, ignore: (rel: string) => boolean): WatchBackend {
  let w: FSWatcher | null = null;
  return {
    async start(onEvent) {
      const s = startChokidar(roots, ignore, onEvent);
      w = s.watcher;
      await s.ready;
    },
    async stop() {
      await w?.close();
      w = null;
    },
  };
}

/** chokidar in a worker thread; `spawn` starts watch-worker.ts with the roots as workerData. */
export function workerBackend(spawn: () => Worker): WatchBackend {
  let worker: Worker | null = null;
  return {
    start(onEvent) {
      return new Promise((resolve) => {
        const w = spawn();
        worker = w;
        w.on('message', (m: { type: string; event?: RawWatchEvent }) => {
          if (m.type === 'event' && m.event) onEvent(m.event);
          else if (m.type === 'ready') resolve();
        });
        w.on('error', (err) => {
          console.error('[watcher]', err);
          resolve();
        });
        w.once('exit', () => resolve());
      });
    },
    stop() {
      const w = worker;
      worker = null;
      if (!w) return Promise.resolve();
      // Waits for the worker to exit, so Windows has released every directory handle.
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => void w.terminate().finally(resolve), 3000);
        w.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        w.postMessage({ type: 'stop' });
      });
    },
  };
}
