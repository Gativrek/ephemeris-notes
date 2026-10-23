/**
 * Library-scoped file operations behind `vx.fs` (SPECS 3.4, 4.8). Every method takes
 * library-relative paths and validates them; nothing here writes unless asked to.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry, TextFile, WriteResult } from '@shared/bridge';
import { fail } from '@shared/result';
import { atomicCreate, atomicWrite, isTempFile, type AtomicHooks } from './atomic';
import { decodeText, encodeText, sha256 } from './encoding';
import { LibraryRoot, isInside, realpathNative, validateNewName, type NormalizeOptions } from './paths';

const MAX_TEXT_BYTES = 64 * 1024 * 1024;
const MAX_BINARY_BYTES = 512 * 1024 * 1024;

export interface FsDeps {
  /** Moves a file or folder to the OS trash (`shell.trashItem` in the app). */
  trash(absPath: string): Promise<void>;
  /** Told about every write the app makes, so the watcher can ignore its echo. */
  onOwnWrite?(rel: string, hash: string | null): void;
  atomicHooks?: AtomicHooks;
}

export class LibraryFs {
  constructor(
    readonly root: LibraryRoot,
    private readonly deps: FsDeps,
  ) {}

  private resolve(input: unknown, opts?: NormalizeOptions) {
    return this.root.resolve(input, opts);
  }

  private async entryFor(rel: string, abs: string): Promise<FileEntry> {
    const st = await fs.stat(abs);
    const name = rel === '' ? path.basename(this.root.root) : (rel.split('/').pop() ?? rel);
    return st.isDirectory()
      ? { path: rel, name, kind: 'folder', mtime: st.mtimeMs }
      : { path: rel, name, kind: 'file', size: st.size, mtime: st.mtimeMs };
  }

  async read(input: unknown, opts?: NormalizeOptions): Promise<TextFile> {
    const { rel, abs } = await this.resolve(input, opts);
    const st = await fs.stat(abs);
    if (st.isDirectory()) fail('INVALID_ARGUMENT', 'Path is a folder.');
    if (st.size > MAX_TEXT_BYTES) fail('INVALID_ARGUMENT', 'File is too large to open as text.');
    const bytes = await fs.readFile(abs);
    const decoded = decodeText(bytes);
    return { path: rel, ...decoded, hash: sha256(bytes), mtime: st.mtimeMs, size: st.size };
  }

  async readBinary(input: unknown, opts?: NormalizeOptions): Promise<Uint8Array> {
    const { abs } = await this.resolve(input, opts);
    const st = await fs.stat(abs);
    if (st.isDirectory()) fail('INVALID_ARGUMENT', 'Path is a folder.');
    if (st.size > MAX_BINARY_BYTES) fail('INVALID_ARGUMENT', 'File is too large.');
    return new Uint8Array(await fs.readFile(abs));
  }

  /**
   * Saves `text` (LF) over an existing file. Refused when the bytes on disk no longer
   * hash to `expectedHash` (rule 6) or are not UTF-8 (rule 5). Line endings and BOM
   * are taken from the current file (rule 4). Identical bytes are not rewritten.
   */
  async write(
    input: unknown,
    text: unknown,
    expectedHash: unknown,
    opts?: NormalizeOptions,
  ): Promise<WriteResult> {
    if (typeof text !== 'string') fail('INVALID_ARGUMENT', 'Text must be a string.');
    if (typeof expectedHash !== 'string' || !/^[0-9a-f]{64}$/.test(expectedHash)) {
      fail('INVALID_ARGUMENT', 'expectedHash must be the hash returned by read.');
    }
    const { rel, abs } = await this.resolve(input, opts);
    let target: string;
    try {
      target = await this.root.realTarget(abs);
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') fail('NOT_FOUND', 'The file no longer exists.');
      throw err;
    }
    const current = await fs.readFile(target);
    const currentHash = sha256(current);
    if (currentHash !== expectedHash) {
      fail('CONFLICT', 'The file changed on disk.', { hash: currentHash });
    }
    const decoded = decodeText(current);
    if (decoded.readOnly) fail('NOT_UTF8', 'The file is not valid UTF-8 and cannot be saved.');
    const next = encodeText(text, decoded.eol, decoded.bom);
    // Unchanged text is never rewritten, even when re-encoding would differ (mixed EOL).
    if (next.equals(current) || decoded.text === text.replace(/\r\n/g, '\n')) {
      const st = await fs.stat(target);
      return { path: rel, hash: currentHash, mtime: st.mtimeMs };
    }
    const hash = sha256(next);
    this.deps.onOwnWrite?.(rel, hash);
    await atomicWrite(target, next, this.deps.atomicHooks);
    const st = await fs.stat(target);
    return { path: rel, hash, mtime: st.mtimeMs };
  }

  /** Writes bytes to an internal file (metadata, plugin data), creating or replacing it. */
  async writeBytes(input: unknown, data: Uint8Array, opts?: NormalizeOptions): Promise<WriteResult> {
    const { rel, abs } = await this.resolve(input, opts);
    let target = abs;
    try {
      target = await this.root.realTarget(abs);
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
      await fs.mkdir(path.dirname(abs), { recursive: true });
    }
    const hash = sha256(data);
    this.deps.onOwnWrite?.(rel, hash);
    await atomicWrite(target, data, this.deps.atomicHooks);
    const st = await fs.stat(target);
    return { path: rel, hash, mtime: st.mtimeMs };
  }

  /** Creates a new UTF-8, LF file. Never replaces anything. The parent must exist. */
  async create(input: unknown, text: unknown, opts?: NormalizeOptions): Promise<WriteResult> {
    if (typeof text !== 'string') fail('INVALID_ARGUMENT', 'Text must be a string.');
    const { rel, abs } = await this.resolve(input, opts);
    validateNewName(path.basename(abs));
    await this.assertFolder(path.dirname(abs));
    const bytes = encodeText(text, 'lf', false);
    const hash = sha256(bytes);
    this.deps.onOwnWrite?.(rel, hash);
    try {
      await atomicCreate(abs, bytes);
    } catch (err) {
      if ((err as { code?: string }).code === 'EEXIST')
        fail('EXISTS', 'A file with that name already exists.');
      throw err;
    }
    const st = await fs.stat(abs);
    return { path: rel, hash, mtime: st.mtimeMs };
  }

  /** Creates a file from raw bytes (attachments, covers). Never replaces anything. */
  async createBytes(input: unknown, data: Uint8Array, opts?: NormalizeOptions): Promise<WriteResult> {
    const { rel, abs } = await this.resolve(input, opts);
    validateNewName(path.basename(abs));
    await this.assertFolder(path.dirname(abs));
    const hash = sha256(data);
    this.deps.onOwnWrite?.(rel, hash);
    try {
      await atomicCreate(abs, data);
    } catch (err) {
      if ((err as { code?: string }).code === 'EEXIST')
        fail('EXISTS', 'A file with that name already exists.');
      throw err;
    }
    const st = await fs.stat(abs);
    return { path: rel, hash, mtime: st.mtimeMs };
  }

  private async assertFolder(absDir: string): Promise<void> {
    try {
      const st = await fs.stat(absDir);
      if (!st.isDirectory()) fail('INVALID_ARGUMENT', 'Parent is not a folder.');
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT')
        fail('NOT_FOUND', 'The parent folder does not exist.');
      throw err;
    }
  }

  /** Renames or moves a file or folder. Refuses to replace anything at `to`. */
  async rename(fromInput: unknown, toInput: unknown, opts?: NormalizeOptions): Promise<{ path: string }> {
    const from = await this.resolve(fromInput, opts);
    const to = await this.resolve(toInput, opts);
    validateNewName(path.basename(to.abs));
    await fs.stat(from.abs);
    await this.assertFolder(path.dirname(to.abs));
    if (to.abs === from.abs) return { path: to.rel };
    try {
      await fs.lstat(to.abs);
      // On case-insensitive filesystems "a.md" -> "A.md" finds the same file.
      const [a, b] = await Promise.all([realpathNative(from.abs), realpathNative(to.abs)]);
      if (a !== b) fail('EXISTS', 'Something with that name already exists.');
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
    }
    if (to.abs.length > from.abs.length && isInside(from.abs, to.abs)) {
      fail('INVALID_ARGUMENT', 'A folder cannot be moved into itself.');
    }
    this.deps.onOwnWrite?.(from.rel, null);
    this.deps.onOwnWrite?.(to.rel, null);
    await fs.rename(from.abs, to.abs);
    return { path: to.rel };
  }

  /** Moves to the OS trash (rule 7). The library root itself cannot be trashed. */
  async trash(input: unknown, opts?: NormalizeOptions): Promise<void> {
    const { rel, abs } = await this.resolve(input, opts);
    await fs.lstat(abs);
    this.deps.onOwnWrite?.(rel, null);
    await this.deps.trash(abs);
  }

  /** Creates a folder and any missing parents. Each new name is validated. */
  async mkdir(input: unknown, opts?: NormalizeOptions): Promise<{ path: string }> {
    const { rel, abs } = await this.resolve(input, opts);
    const segments = rel.split('/');
    let probe = this.root.root;
    for (const seg of segments) {
      probe = path.join(probe, seg);
      try {
        const st = await fs.stat(probe);
        if (!st.isDirectory()) fail('EXISTS', 'A file with that name already exists.');
      } catch (err) {
        if ((err as { code?: string }).code !== 'ENOENT') throw err;
        validateNewName(seg);
      }
    }
    await fs.mkdir(abs, { recursive: true });
    return { path: rel };
  }

  /** Lists a folder. Hidden entries, temp files and links leaving the library are skipped. */
  async list(input: unknown, opts?: NormalizeOptions): Promise<FileEntry[]> {
    const { rel, abs } = await this.resolve(input, { allowRoot: true, ...opts });
    const dirents = await fs.readdir(abs, { withFileTypes: true });
    const out: FileEntry[] = [];
    await Promise.all(
      dirents.map(async (d) => {
        if (d.name.startsWith('.') && !opts?.allowHidden) return;
        if (isTempFile(d.name)) return;
        const childRel = rel === '' ? d.name : `${rel}/${d.name}`;
        const childAbs = path.join(abs, d.name);
        try {
          if (d.isSymbolicLink()) await this.root.realTarget(childAbs);
          out.push(await this.entryFor(childRel, childAbs));
        } catch {
          // Broken links and links leaving the library are not listed.
        }
      }),
    );
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return out;
  }

  async stat(input: unknown, opts?: NormalizeOptions): Promise<FileEntry> {
    const { rel, abs } = await this.resolve(input, { allowRoot: true, ...opts });
    return this.entryFor(rel, abs);
  }

  async exists(input: unknown, opts?: NormalizeOptions): Promise<boolean> {
    try {
      await this.stat(input, opts);
      return true;
    } catch {
      return false;
    }
  }
}
