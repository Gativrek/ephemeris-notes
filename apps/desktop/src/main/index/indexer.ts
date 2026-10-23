/**
 * The library index (SPECS 6): notes, links, headings, blocks, tags and equations in
 * SQLite with an FTS5 table, parsed with the same grammar as the editor. Disposable:
 * a schema or library mismatch rebuilds it. Incremental by mtime, size and hash.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  LinkCatalog,
  analyzeNote,
  domainOf,
  noteTitle,
  stringList,
  vaultRootOf,
  type LinkRef,
  type NoteSummary,
  type NumberingMode,
} from '@vaults/markdown';
import type { Backlink, IndexStatus, SearchHit, SearchScope } from '@shared/bridge';
import { decodeText } from '../library/encoding';
import { isTempFile } from '../library/atomic';
import { walkFiles } from '../library/walk';
import type { Db, Row, SqlValue } from './db';
import { fold, parseQuery, snippets, toFtsMatch } from './query';

export const SCHEMA_VERSION = 4;
const MAX_INDEX_BYTES = 8 * 1024 * 1024;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime REAL, size INTEGER, ext TEXT, name TEXT);
CREATE TABLE IF NOT EXISTS notes (path TEXT PRIMARY KEY, vault TEXT, domain TEXT, title TEXT, mtime REAL, hash TEXT, frontmatter_json TEXT, aliases_json TEXT);
CREATE TABLE IF NOT EXISTS links (src TEXT, target_raw TEXT, target_key TEXT, target_resolved TEXT, candidates INTEGER, kind TEXT, heading TEXT, block TEXT, line INTEGER, col INTEGER, context TEXT);
CREATE INDEX IF NOT EXISTS links_src ON links(src);
CREATE INDEX IF NOT EXISTS links_resolved ON links(target_resolved);
CREATE INDEX IF NOT EXISTS links_key ON links(target_key);
CREATE TABLE IF NOT EXISTS headings (path TEXT, level INTEGER, text TEXT, line INTEGER);
CREATE INDEX IF NOT EXISTS headings_path ON headings(path);
CREATE TABLE IF NOT EXISTS blocks (path TEXT, kind TEXT, lang TEXT, line_start INTEGER, line_end INTEGER, label TEXT);
CREATE INDEX IF NOT EXISTS blocks_path ON blocks(path);
CREATE TABLE IF NOT EXISTS tags (path TEXT, tag TEXT);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
CREATE INDEX IF NOT EXISTS tags_path ON tags(path);
CREATE TABLE IF NOT EXISTS equations (path TEXT, number TEXT, label TEXT, line INTEGER);
CREATE INDEX IF NOT EXISTS equations_path ON equations(path);
CREATE TABLE IF NOT EXISTS vaults (path TEXT PRIMARY KEY, name TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2');
`;

const lower = (s: string) => s.toLocaleLowerCase();
const extOf = (p: string) => {
  const name = p.slice(p.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** The key used to find links that a change of file name may affect. */
export function linkKey(target: string): string {
  const base = target.slice(target.lastIndexOf('/') + 1);
  return lower(base.replace(/\.md$/i, ''));
}

function visible(rel: string): boolean {
  return !rel.split('/').some((s) => s.startsWith('.') || isTempFile(s));
}

async function* walk(root: string, rel = ''): AsyncGenerator<{ rel: string; mtime: number; size: number }> {
  for await (const f of walkFiles(root, rel)) yield { rel: f.rel, mtime: f.mtimeMs, size: f.size };
}

export interface IndexOptions {
  numbering?: NumberingMode;
  /** Parses notes elsewhere (a worker pool) during a full sync; in place when absent. */
  analyze?: (text: string, numbering: NumberingMode) => Promise<NoteSummary>;
  onProgress?(status: IndexStatus): void;
}

export class LibraryIndex {
  private catalog = new LinkCatalog([]);
  private status: IndexStatus = { state: 'idle', done: 0, total: 0 };

  constructor(
    private readonly db: Db,
    readonly rootAbs: string,
    private readonly opts: IndexOptions = {},
  ) {}

  /** Creates the schema, or wipes it when the version or the library differs. */
  static prepare(db: Db, libraryId: string): { rebuilt: boolean } {
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);');
    const v = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema');
    const id = db.prepare('SELECT value FROM meta WHERE key = ?').get('library');
    const ok = v?.value === String(SCHEMA_VERSION) && id?.value === libraryId;
    if (!ok) {
      for (const t of [
        'files',
        'notes',
        'links',
        'headings',
        'blocks',
        'tags',
        'equations',
        'vaults',
        'notes_fts',
      ]) {
        db.exec(`DROP TABLE IF EXISTS ${t};`);
      }
    }
    db.exec(SCHEMA);
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema',
      String(SCHEMA_VERSION),
    );
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('library', libraryId);
    return { rebuilt: !ok };
  }

  getStatus(): IndexStatus {
    return this.status;
  }

  private setStatus(s: IndexStatus): void {
    this.status = s;
    this.opts.onProgress?.(s);
  }

  private rebuildCatalog(): void {
    const paths = this.db
      .prepare('SELECT path FROM files')
      .all()
      .map((r) => String(r.path));
    const aliases = new Map<string, string[]>();
    for (const r of this.db
      .prepare('SELECT path, aliases_json FROM notes WHERE aliases_json IS NOT NULL')
      .all()) {
      try {
        const list = JSON.parse(String(r.aliases_json)) as string[];
        if (list.length) aliases.set(String(r.path), list);
      } catch {
        // Ignore malformed rows; they are rewritten on the next index of that note.
      }
    }
    this.catalog = new LinkCatalog(paths, aliases);
  }

  get links(): LinkCatalog {
    return this.catalog;
  }

  private syncing: Promise<{ indexed: number; removed: number }> | null = null;
  private syncAgain = false;

  /**
   * Brings the index in line with the disk: new, changed and deleted files. Never runs
   * twice at once: a request during a sync runs once more after it.
   */
  sync(): Promise<{ indexed: number; removed: number }> {
    if (this.syncing) {
      this.syncAgain = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      try {
        let r = await this.syncOnce();
        while (this.syncAgain) {
          this.syncAgain = false;
          const more = await this.syncOnce();
          r = { indexed: r.indexed + more.indexed, removed: r.removed + more.removed };
        }
        return r;
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  private async syncOnce(): Promise<{ indexed: number; removed: number }> {
    const known = new Map<string, { mtime: number; size: number }>();
    for (const r of this.db.prepare('SELECT path, mtime, size FROM files').all()) {
      known.set(String(r.path), { mtime: Number(r.mtime), size: Number(r.size) });
    }
    const seen = new Set<string>();
    const changed: Array<{ rel: string; mtime: number; size: number }> = [];
    for await (const f of walk(this.rootAbs)) {
      seen.add(f.rel);
      const k = known.get(f.rel);
      if (!k || k.mtime !== f.mtime || k.size !== f.size) changed.push(f);
    }
    const removed = [...known.keys()].filter((p) => !seen.has(p));
    const total = changed.length + removed.length;
    this.setStatus({ state: total ? 'indexing' : 'idle', done: 0, total });
    this.db.transaction(() => {
      for (const p of removed) this.deleteRows(p, true);
    });
    // Vault names, for vault: filters.
    await this.syncVaults();
    let done = removed.length;
    const BATCH = 100;
    // Read and parse one batch while the previous one is written (a pipeline).
    const prepare = async (batch: typeof changed) => {
      const parsed = await Promise.all(batch.map((f) => this.readNote(f.rel, f.mtime, f.size)));
      const analyze = this.opts.analyze;
      if (analyze)
        await Promise.all(
          parsed.map(async (p) => {
            if (p?.note && typeof p.note === 'object')
              p.note.summary = await analyze(p.note.text, this.opts.numbering ?? 'all');
          }),
        );
      return parsed;
    };
    let next = changed.length ? prepare(changed.slice(0, BATCH)) : null;
    for (let i = 0; next; i += BATCH) {
      const parsed = await next;
      const count = Math.min(BATCH, changed.length - i);
      next = i + BATCH < changed.length ? prepare(changed.slice(i + BATCH, i + 2 * BATCH)) : null;
      this.db.transaction(() => {
        for (const p of parsed) if (p) this.writeRows(p);
      });
      done += count;
      this.setStatus({ state: 'indexing', done, total });
      // Let other messages in between batches.
      await new Promise((r) => setImmediate(r));
    }
    this.rebuildCatalog();
    this.db.transaction(() => this.resolveAll());
    this.setStatus({ state: 'idle', done: total, total });
    return { indexed: changed.length, removed: removed.length };
  }

  private async syncVaults(): Promise<void> {
    const rows: Array<[string, string]> = [];
    for (const d of ['Academic', 'Work', 'Personal']) {
      let entries;
      try {
        entries = await fs.readdir(path.join(this.rootAbs, d), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        try {
          const raw = JSON.parse(
            await fs.readFile(path.join(this.rootAbs, d, e.name, '.vault', 'vault.json'), 'utf8'),
          ) as { name?: unknown };
          rows.push([`${d}/${e.name}`, typeof raw.name === 'string' ? raw.name : e.name]);
        } catch {
          // Not a Vault.
        }
      }
    }
    this.db.transaction(() => {
      this.db.exec('DELETE FROM vaults');
      for (const [p, n] of rows) this.db.prepare('INSERT INTO vaults (path, name) VALUES (?, ?)').run(p, n);
    });
  }

  private async readNote(rel: string, mtime: number, size: number) {
    const isNote = rel.toLowerCase().endsWith('.md');
    if (!isNote || size > MAX_INDEX_BYTES) return { rel, mtime, size, note: null };
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(path.join(this.rootAbs, ...rel.split('/')));
    } catch {
      return null;
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    const old = this.db.prepare('SELECT hash FROM notes WHERE path = ?').get(rel);
    if (old && old.hash === hash) return { rel, mtime, size, note: 'unchanged' as const };
    const text = decodeText(bytes).text;
    return {
      rel,
      mtime,
      size,
      note: { text, hash } as { text: string; hash: string; summary?: NoteSummary },
    };
  }

  private deleteRows(rel: string, alsoFile: boolean): void {
    // The FTS row shares the note's rowid: deleting by path would scan the whole table.
    this.db.prepare('DELETE FROM notes_fts WHERE rowid = (SELECT rowid FROM notes WHERE path = ?)').run(rel);
    for (const t of [
      'links WHERE src',
      'headings WHERE path',
      'blocks WHERE path',
      'tags WHERE path',
      'equations WHERE path',
      'notes WHERE path',
    ]) {
      this.db.prepare(`DELETE FROM ${t} = ?`).run(rel);
    }
    if (alsoFile) this.db.prepare('DELETE FROM files WHERE path = ?').run(rel);
  }

  private writeRows(p: NonNullable<Awaited<ReturnType<LibraryIndex['readNote']>>>): void {
    const { rel, mtime, size, note } = p;
    this.db
      .prepare('INSERT OR REPLACE INTO files (path, mtime, size, ext, name) VALUES (?, ?, ?, ?, ?)')
      .run(rel, mtime, size, extOf(rel), rel.slice(rel.lastIndexOf('/') + 1));
    if (note === 'unchanged') {
      this.db.prepare('UPDATE notes SET mtime = ? WHERE path = ?').run(mtime, rel);
      return;
    }
    this.deleteRows(rel, false);
    if (!note) return;
    const s = note.summary ?? analyzeNote(note.text, { numbering: this.opts.numbering ?? 'all' });
    const fm = s.frontmatter?.data ?? null;
    const title = noteTitle(s, rel);
    const aliases = fm ? stringList(fm.aliases) : [];
    this.db
      .prepare(
        'INSERT INTO notes (path, vault, domain, title, mtime, hash, frontmatter_json, aliases_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        rel,
        vaultRootOf(rel),
        domainOf(rel)?.toLowerCase() ?? null,
        title,
        mtime,
        note.hash,
        fm ? JSON.stringify(fm) : null,
        aliases.length ? JSON.stringify(aliases) : null,
      );
    const body = s.frontmatter ? note.text.slice(s.frontmatter.to) : note.text;
    this.db
      .prepare(
        'INSERT INTO notes_fts (rowid, path, title, body) VALUES ((SELECT rowid FROM notes WHERE path = ?), ?, ?, ?)',
      )
      .run(rel, rel, title, body);
    const lines = note.text.split('\n');
    for (const l of s.links) this.insertLink(rel, l, lines[l.line - 1] ?? '');
    for (const h of s.headings)
      this.db
        .prepare('INSERT INTO headings (path, level, text, line) VALUES (?, ?, ?, ?)')
        .run(rel, h.level, h.text, h.line);
    for (const b of s.blocks)
      this.db
        .prepare(
          'INSERT INTO blocks (path, kind, lang, line_start, line_end, label) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(rel, 'fence', b.lang, b.lineStart, b.lineEnd, null);
    const tags = new Set<string>([
      ...s.tags.map((t) => lower(t.tag)),
      ...(fm ? stringList(fm.tags).map((t) => lower(t.replace(/^#/, ''))) : []),
    ]);
    for (const t of tags) this.db.prepare('INSERT INTO tags (path, tag) VALUES (?, ?)').run(rel, t);
    for (const e of s.equations)
      this.db
        .prepare('INSERT INTO equations (path, number, label, line) VALUES (?, ?, ?, ?)')
        .run(rel, e.number, e.label, e.line);
  }

  private insertLink(src: string, l: LinkRef, lineText: string): void {
    const res = l.target ? this.catalog.resolve(l.target, src) : { path: src, candidates: [] };
    this.db
      .prepare(
        'INSERT INTO links (src, target_raw, target_key, target_resolved, candidates, kind, heading, block, line, col, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        src,
        l.target,
        linkKey(l.target),
        res.path,
        res.candidates.length,
        l.kind,
        l.heading,
        l.block,
        l.line,
        l.col,
        lineText.trim().slice(0, 240),
      );
  }

  /** Re-resolves every link (after the file set changed in bulk). */
  private resolveAll(): void {
    const rows = this.db.prepare('SELECT rowid AS id, src, target_raw FROM links').all();
    for (const r of rows) this.updateResolution(r);
  }

  private updateResolution(r: Row): void {
    const target = String(r.target_raw ?? '');
    const res = target
      ? this.catalog.resolve(target, String(r.src))
      : { path: String(r.src), candidates: [] };
    this.db
      .prepare('UPDATE links SET target_resolved = ?, candidates = ? WHERE rowid = ?')
      .run(res.path, res.candidates.length, r.id as SqlValue);
  }

  /** Re-resolves links whose target name matches one of `keys` (a file appeared or went away). */
  private resolveKeys(keys: Set<string>): void {
    for (const k of keys) {
      for (const r of this.db
        .prepare('SELECT rowid AS id, src, target_raw FROM links WHERE target_key = ?')
        .all(k))
        this.updateResolution(r);
    }
  }

  /** Re-reads one path (file or folder) after a change, a creation or a deletion. */
  async refresh(rels: string[]): Promise<void> {
    const keys = new Set<string>();
    const touched: Array<{ rel: string; mtime: number; size: number }> = [];
    const gone: string[] = [];
    for (const rel of rels) {
      if (!visible(rel)) {
        if (/\/\.vault\/vault\.json$/.test(rel)) await this.syncVaults();
        continue;
      }
      const abs = path.join(this.rootAbs, ...rel.split('/'));
      let st;
      try {
        st = await fs.stat(abs);
      } catch {
        st = null;
      }
      if (!st) {
        const under = this.db
          .prepare("SELECT path FROM files WHERE path = ? OR path LIKE ? ESCAPE '\\'")
          .all(rel, `${rel.replace(/[\\%_]/g, '\\$&')}/%`);
        for (const r of under) gone.push(String(r.path));
      } else if (st.isDirectory()) {
        const existing = new Set(
          this.db
            .prepare("SELECT path FROM files WHERE path LIKE ? ESCAPE '\\'")
            .all(`${rel.replace(/[\\%_]/g, '\\$&')}/%`)
            .map((r) => String(r.path)),
        );
        for await (const f of walk(this.rootAbs, rel)) {
          existing.delete(f.rel);
          touched.push(f);
        }
        gone.push(...existing);
      } else {
        touched.push({ rel, mtime: st.mtimeMs, size: st.size });
      }
    }
    const fresh = await Promise.all(touched.map((f) => this.readNote(f.rel, f.mtime, f.size)));
    const before = new Set(
      touched.map((f) => f.rel).filter((p) => this.db.prepare('SELECT 1 FROM files WHERE path = ?').get(p)),
    );
    this.db.transaction(() => {
      for (const p of gone) {
        keys.add(linkKey(p));
        this.deleteRows(p, true);
      }
      for (const f of fresh) {
        if (!f) continue;
        if (!before.has(f.rel)) keys.add(linkKey(f.rel));
        const oldAliases = this.db
          .prepare('SELECT aliases_json FROM notes WHERE path = ?')
          .get(f.rel)?.aliases_json;
        this.writeRows(f);
        const newAliases = this.db
          .prepare('SELECT aliases_json FROM notes WHERE path = ?')
          .get(f.rel)?.aliases_json;
        if (oldAliases !== newAliases) {
          for (const a of [oldAliases, newAliases]) {
            if (typeof a === 'string') for (const x of JSON.parse(a) as string[]) keys.add(lower(x));
          }
        }
      }
    });
    if (keys.size) {
      this.rebuildCatalog();
      this.db.transaction(() => this.resolveKeys(keys));
    }
    // Links in re-indexed notes resolved against the old catalog: resolve them again.
    if (fresh.some((f) => f && f.note && f.note !== 'unchanged')) {
      this.db.transaction(() => {
        for (const f of fresh) {
          if (!f || !f.note || f.note === 'unchanged') continue;
          for (const r of this.db
            .prepare('SELECT rowid AS id, src, target_raw FROM links WHERE src = ?')
            .all(f.rel))
            this.updateResolution(r);
        }
      });
    }
  }

  // ---- Queries ----------------------------------------------------------------

  search(query: string, scope: SearchScope, limit = 50): SearchHit[] {
    const q = parseQuery(query);
    const match = toFtsMatch(q);
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (scope.kind === 'vault') {
      where.push("(n.path = ? OR n.path LIKE ? ESCAPE '\\')");
      params.push(scope.vaultPath, `${scope.vaultPath.replace(/[\\%_]/g, '\\$&')}/%`);
    } else if (scope.kind === 'domain') {
      where.push('n.domain = ?');
      params.push(scope.domain);
    }
    for (const t of q.tags) {
      where.push("n.path IN (SELECT path FROM tags WHERE tag = ? OR tag LIKE ? ESCAPE '\\')");
      params.push(t, `${t.replace(/[\\%_]/g, '\\$&')}/%`);
    }
    for (const p of q.paths) {
      where.push("lower(n.path) LIKE ? ESCAPE '\\'");
      params.push(`%${lower(p).replace(/[\\%_]/g, '\\$&')}%`);
    }
    for (const v of q.vaults) {
      where.push(
        "(lower(n.vault) LIKE ? ESCAPE '\\' OR n.vault IN (SELECT path FROM vaults WHERE lower(name) LIKE ? ESCAPE '\\'))",
      );
      const pat = `%${lower(v).replace(/[\\%_]/g, '\\$&')}%`;
      params.push(pat, pat);
    }
    for (const e of q.excludes) {
      if (!match) {
        where.push('n.path NOT IN (SELECT path FROM notes_fts WHERE notes_fts MATCH ?)');
        params.push(`"${e.replace(/"/g, '""')}"`);
      }
    }
    const hits: SearchHit[] = [];
    const onlyFiles = q.exts.length > 0 && !q.exts.includes('md');
    if (!onlyFiles && (match || where.length)) {
      const sql = match
        ? `SELECT n.path, n.title, n.vault, n.domain, f.body, bm25(notes_fts, 0, 8, 1) AS score FROM notes_fts f JOIN notes n ON n.rowid = f.rowid WHERE notes_fts MATCH ? ${where.length ? `AND ${where.join(' AND ')}` : ''} ORDER BY score LIMIT ?`
        : `SELECT n.path, n.title, n.vault, n.domain, f.body, 0 AS score FROM notes n JOIN notes_fts f ON f.rowid = n.rowid WHERE ${where.join(' AND ')} ORDER BY n.title LIMIT ?`;
      const rows = this.db.prepare(sql).all(...(match ? [match] : []), ...params, limit);
      for (const r of rows) {
        hits.push({
          kind: 'note',
          path: String(r.path),
          title: String(r.title),
          vault: r.vault === null ? null : String(r.vault),
          domain: r.domain === null ? null : (String(r.domain) as SearchHit['domain']),
          snippets: snippets(String(r.body ?? ''), q),
        });
      }
    }
    // Notes whose title holds every word come first; bm25 orders the rest.
    const words = [...q.terms, ...q.phrases].map((w) => fold(w).folded);
    if (words.length) {
      const inTitle = (h: SearchHit) => words.every((w) => fold(h.title).folded.includes(w));
      hits.sort((a, b) => Number(inTitle(b)) - Number(inTitle(a)));
    }
    // Attachments are searchable by file name (SPECS 6.2).
    const nameTerms = [...q.terms, ...q.phrases];
    if ((nameTerms.length || q.exts.length) && hits.length < limit) {
      const fw: string[] = ["ext <> 'md'"];
      const fp: SqlValue[] = [];
      for (const t of nameTerms) {
        fw.push("lower(name) LIKE ? ESCAPE '\\'");
        fp.push(`%${lower(t).replace(/[\\%_]/g, '\\$&')}%`);
      }
      if (q.exts.length) {
        fw.push(`ext IN (${q.exts.map(() => '?').join(',')})`);
        fp.push(...q.exts);
      }
      if (scope.kind === 'vault') {
        fw.push("path LIKE ? ESCAPE '\\'");
        fp.push(`${scope.vaultPath.replace(/[\\%_]/g, '\\$&')}/%`);
      } else if (scope.kind === 'domain') {
        fw.push("path LIKE ? ESCAPE '\\'");
        fp.push(`${scope.domain[0]!.toUpperCase()}${scope.domain.slice(1)}/%`);
      }
      for (const p of q.paths) {
        fw.push("lower(path) LIKE ? ESCAPE '\\'");
        fp.push(`%${lower(p).replace(/[\\%_]/g, '\\$&')}%`);
      }
      const rows = this.db
        .prepare(`SELECT path, name FROM files WHERE ${fw.join(' AND ')} ORDER BY name LIMIT ?`)
        .all(...fp, limit - hits.length);
      for (const r of rows) {
        const p = String(r.path);
        hits.push({
          kind: 'file',
          path: p,
          title: String(r.name),
          vault: vaultRootOf(p),
          domain: (domainOf(p)?.toLowerCase() ?? null) as SearchHit['domain'],
          snippets: [],
        });
      }
    }
    return hits;
  }

  /** Notes linking to `target`, one entry each (the first link's line and context). */
  backlinks(target: string): Backlink[] {
    const seen = new Set<string>();
    const out: Backlink[] = [];
    for (const r of this.db
      .prepare(
        'SELECT l.src, l.line, l.context, n.title FROM links l JOIN notes n ON n.path = l.src WHERE l.target_resolved = ? AND l.src <> ? ORDER BY n.title, l.src, l.line',
      )
      .all(target, target)) {
      const src = String(r.src);
      if (seen.has(src)) continue;
      seen.add(src);
      out.push({ path: src, title: String(r.title), line: Number(r.line), snippet: String(r.context ?? '') });
    }
    return out;
  }

  /** Notes whose links point into `paths` (files or folders), with link counts. */
  linksInto(paths: string[]): Array<{ path: string; links: number }> {
    const counts = new Map<string, number>();
    for (const p of paths) {
      const rows = this.db
        .prepare(
          "SELECT src, COUNT(*) AS n FROM links WHERE target_resolved = ? OR target_resolved LIKE ? ESCAPE '\\' GROUP BY src",
        )
        .all(p, `${p.replace(/[\\%_]/g, '\\$&')}/%`);
      for (const r of rows) counts.set(String(r.src), (counts.get(String(r.src)) ?? 0) + Number(r.n));
    }
    return [...counts].map(([path, links]) => ({ path, links })).sort((a, b) => a.path.localeCompare(b.path));
  }

  ambiguousLinks(): Array<{ src: string; target: string; line: number; candidates: string[] }> {
    return this.db
      .prepare('SELECT src, target_raw, line FROM links WHERE candidates > 1 ORDER BY src, line')
      .all()
      .map((r) => ({
        src: String(r.src),
        target: String(r.target_raw),
        line: Number(r.line),
        candidates: this.catalog.resolve(String(r.target_raw), String(r.src)).candidates,
      }));
  }

  notesIn(scope: SearchScope): Array<{ path: string; title: string }> {
    const rows =
      scope.kind === 'vault'
        ? this.db
            .prepare("SELECT path, title FROM notes WHERE path LIKE ? ESCAPE '\\' ORDER BY path")
            .all(`${scope.vaultPath.replace(/[\\%_]/g, '\\$&')}/%`)
        : scope.kind === 'domain'
          ? this.db.prepare('SELECT path, title FROM notes WHERE domain = ? ORDER BY path').all(scope.domain)
          : this.db.prepare('SELECT path, title FROM notes ORDER BY path').all();
    return rows.map((r) => ({ path: String(r.path), title: String(r.title) }));
  }

  outline(p: string) {
    return {
      headings: this.db
        .prepare('SELECT level, text, line FROM headings WHERE path = ? ORDER BY line')
        .all(p)
        .map((r) => ({ level: Number(r.level), text: String(r.text), line: Number(r.line) })),
      equations: this.db
        .prepare('SELECT number, label, line FROM equations WHERE path = ? ORDER BY line')
        .all(p)
        .map((r) => ({
          number: r.number === null ? null : String(r.number),
          label: r.label === null ? null : String(r.label),
          line: Number(r.line),
        })),
      backlinks: this.backlinks(p),
    };
  }

  aliases(): Array<[string, string[]]> {
    return this.db
      .prepare('SELECT path, aliases_json FROM notes WHERE aliases_json IS NOT NULL')
      .all()
      .map((r) => [String(r.path), JSON.parse(String(r.aliases_json)) as string[]]);
  }

  counts(): { notes: number; files: number; links: number } {
    return {
      notes: Number(this.db.prepare('SELECT COUNT(*) AS n FROM notes').get()?.n ?? 0),
      files: Number(this.db.prepare('SELECT COUNT(*) AS n FROM files').get()?.n ?? 0),
      links: Number(this.db.prepare('SELECT COUNT(*) AS n FROM links').get()?.n ?? 0),
    };
  }
}
