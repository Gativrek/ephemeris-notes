/**
 * The index worker (SPECS 6.1): owns the SQLite connection, builds the index without
 * blocking the main process, and answers queries. Writes run one at a time.
 */
import fs from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import type { NumberingMode } from '@vaults/markdown';
import { openDb, type Db } from './db';
import { LibraryIndex } from './indexer';
import { planRename, type RenamePlanItem } from './rename';
import os from 'node:os';
import { ParsePool } from './parse-pool';
import createParseWorker from './parse-worker?nodeWorker';

export type { RenamePlanItem };

const inside = (p: string, root: string) => p === root || p.startsWith(`${root}/`);

export interface WorkerInit {
  dbPath: string;
  rootAbs: string;
  libraryId: string;
  numbering: NumberingMode;
}

export type WorkerCall = { type: 'call'; id: number; method: string; args: unknown[] };
export type WorkerMessage =
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; message: string }
  | { type: 'status'; status: ReturnType<LibraryIndex['getStatus']> }
  | { type: 'changed' };

const port = parentPort;
if (!port) throw new Error('index worker started outside a worker thread');
const init = workerData as WorkerInit;
const post = (m: WorkerMessage) => port.postMessage(m);

let db: Db;
let index: LibraryIndex;
// Parsing dominates a full build: spread it over a few threads (leaving cores for the UI).
const pool = new ParsePool(
  () => createParseWorker({}),
  Math.max(1, Math.min(3, os.availableParallelism() - 2)),
);

function open(): void {
  db = openDb(init.dbPath);
  LibraryIndex.prepare(db, init.libraryId);
  index = new LibraryIndex(db, init.rootAbs, {
    numbering: init.numbering,
    analyze: (text, numbering) => pool.analyze(text, numbering),
    onProgress: (status) => post({ type: 'status', status }),
  });
}

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

const methods: Record<string, (...args: never[]) => unknown> = {
  status: () => index.getStatus(),
  search: (q: string, scope: Parameters<LibraryIndex['search']>[1]) => index.search(q, scope),
  backlinks: (p: string) => index.backlinks(p),
  resolve: (link: string, from: string) => index.links.resolve(link, from),
  outline: (p: string) => index.outline(p),
  notesIn: (scope: Parameters<LibraryIndex['notesIn']>[0]) => index.notesIn(scope),
  ambiguous: () => index.ambiguousLinks(),
  linkImpact: (paths: string[]) => ({
    notes: index.linksInto(paths).filter((n) => !paths.some((p) => inside(n.path, p))),
  }),
  aliases: () => index.aliases(),
  counts: () => index.counts(),
  refresh: (rels: string[]) =>
    serial(async () => {
      await index.refresh(rels);
      post({ type: 'changed' });
    }),
  sync: () =>
    serial(async () => {
      const r = await index.sync();
      if (r.indexed || r.removed) post({ type: 'changed' });
      return r;
    }),
  rebuild: () =>
    serial(async () => {
      db.close();
      await fs.rm(init.dbPath, { force: true });
      await fs.rm(`${init.dbPath}-wal`, { force: true });
      await fs.rm(`${init.dbPath}-shm`, { force: true });
      open();
      await index.sync();
      post({ type: 'changed' });
      return null;
    }),
  planRename: (from: string, to: string) =>
    serial(async () => {
      await index.sync();
      const paths = db
        .prepare('SELECT path FROM files')
        .all()
        .map((r) => String(r.path));
      return planRename(index, paths, from, to);
    }),
  close: () => serial(async () => db.close()),
};

port.on('message', (m: WorkerCall) => {
  if (m.type !== 'call') return;
  const fn = methods[m.method];
  if (!fn) {
    post({ type: 'result', id: m.id, ok: false, message: `Unknown index method ${m.method}` });
    return;
  }
  Promise.resolve()
    .then(() => (fn as (...a: unknown[]) => unknown)(...m.args))
    .then(
      (value) => post({ type: 'result', id: m.id, ok: true, value }),
      (err: unknown) =>
        post({
          type: 'result',
          id: m.id,
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        }),
    );
});

open();
void methods.sync!();
