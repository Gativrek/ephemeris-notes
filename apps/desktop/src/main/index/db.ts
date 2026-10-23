/**
 * The index database (SPECS 6.1). A thin seam over SQLite so the engine can change:
 * Electron 45's built-in `node:sqlite` today (FTS5 included); better-sqlite3 once it
 * ships a binary for this Electron (decision 34).
 */
import { DatabaseSync } from 'node:sqlite';

export type SqlValue = string | number | null | bigint | Uint8Array;
export type Row = Record<string, SqlValue>;

export interface Stmt {
  run(...params: SqlValue[]): { changes: number | bigint };
  get(...params: SqlValue[]): Row | undefined;
  all(...params: SqlValue[]): Row[];
}

export interface Db {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;');
  const cache = new Map<string, Stmt>();
  let depth = 0;
  return {
    exec: (sql) => db.exec(sql),
    prepare(sql) {
      let s = cache.get(sql);
      if (!s) {
        s = db.prepare(sql) as unknown as Stmt;
        cache.set(sql, s);
      }
      return s;
    },
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn();
      depth++;
      db.exec('BEGIN');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
  };
}
