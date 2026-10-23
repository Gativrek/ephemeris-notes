/**
 * The watcher worker: chokidar off the main thread. Posts `ready` after the initial
 * scan and one message per event; closes and exits on `stop`.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { startChokidar, type RawWatchEvent, type WatchRoots } from './watch-backend';
import { shouldIgnore } from './watcher';

export type WatchWorkerMessage =
  { type: 'ready' } | { type: 'event'; event: RawWatchEvent } | { type: 'stopped' };

const port = parentPort;
if (port) {
  const roots = workerData as WatchRoots;
  const { watcher, ready } = startChokidar(roots, shouldIgnore, (event) =>
    port.postMessage({ type: 'event', event } satisfies WatchWorkerMessage),
  );
  void ready.then(() => port.postMessage({ type: 'ready' } satisfies WatchWorkerMessage));
  port.on('message', (m: { type: string }) => {
    if (m.type !== 'stop') return;
    void watcher.close().finally(() => {
      port.postMessage({ type: 'stopped' } satisfies WatchWorkerMessage);
      port.close();
    });
  });
}
