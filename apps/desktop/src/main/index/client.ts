/**
 * Main-process side of the index: starts the worker for the open library, forwards
 * calls, batches file changes, and turns worker events into push events.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Worker } from 'node:worker_threads';
import type { IndexStatus, PushEvent } from '@shared/bridge';
import { fail } from '@shared/result';
import type { WorkerCall, WorkerInit, WorkerMessage, RenamePlanItem } from './worker';

export type WorkerFactory = (init: WorkerInit) => Worker;

export class IndexClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private status: IndexStatus = { state: 'idle', done: 0, total: 0 };
  private touched = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly create: WorkerFactory,
    private readonly broadcast: (e: PushEvent) => void,
  ) {}

  get current(): IndexStatus {
    return this.status;
  }

  async start(opts: {
    userData: string;
    libraryId: string;
    rootAbs: string;
    numbering: 'all' | 'labeled';
  }): Promise<void> {
    await this.stop();
    const dir = path.join(opts.userData, 'index');
    await fs.mkdir(dir, { recursive: true });
    const worker = this.create({
      dbPath: path.join(dir, `${opts.libraryId}.sqlite`),
      rootAbs: opts.rootAbs,
      libraryId: opts.libraryId,
      numbering: opts.numbering,
    });
    this.worker = worker;
    this.status = { state: 'starting', done: 0, total: 0 };
    worker.on('message', (m: WorkerMessage) => {
      if (m.type === 'result') {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.ok) p.resolve(m.value);
        else p.reject(new Error(m.message));
      } else if (m.type === 'status') {
        this.status = m.status;
        this.broadcast({ type: 'index.status', payload: m.status });
      } else if (m.type === 'changed') {
        this.broadcast({ type: 'index.changed', payload: null });
      } else if (m.type === 'records') {
        this.broadcast({ type: 'index.records', payload: m.plugins });
      }
    });
    worker.on('error', (err) => {
      this.status = { state: 'error', done: 0, total: 0, message: err.message };
      this.broadcast({ type: 'index.status', payload: this.status });
      console.error('[index] worker failed', err);
    });
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null;
      for (const [, p] of this.pending) p.reject(new Error('The index stopped.'));
      this.pending.clear();
    });
  }

  async stop(): Promise<void> {
    const w = this.worker;
    if (!w) return;
    this.worker = null;
    if (this.timer) clearTimeout(this.timer);
    this.touched.clear();
    try {
      await Promise.race([this.callOn(w, 'close', []), new Promise((r) => setTimeout(r, 2000))]);
    } catch {
      // Closing anyway.
    }
    await w.terminate();
  }

  private callOn(w: Worker, method: string, args: unknown[]): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ type: 'call', id, method, args } satisfies WorkerCall);
    });
  }

  call<T>(method: string, ...args: unknown[]): Promise<T> {
    const w = this.worker;
    if (!w) fail('NO_LIBRARY', 'The index is not running.');
    return this.callOn(w, method, args) as Promise<T>;
  }

  /** Paths changed on disk (watcher or the app's own writes); refreshed in a batch. */
  touch(rels: string[]): void {
    if (!this.worker) return;
    for (const r of rels) this.touched.add(r);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const batch = [...this.touched];
      this.touched.clear();
      this.timer = null;
      void this.call('refresh', batch).catch((err: unknown) => console.error('[index] refresh failed', err));
    }, 30);
  }

  /** Waits for queued refreshes to finish (before a rename plan, in tests). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      const batch = [...this.touched];
      this.touched.clear();
      if (batch.length) await this.call('refresh', batch);
    }
  }

  async planRename(from: string, to: string): Promise<RenamePlanItem[]> {
    await this.flush();
    return this.call<RenamePlanItem[]>('planRename', from, to);
  }
}
