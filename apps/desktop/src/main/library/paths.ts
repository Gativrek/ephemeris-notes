/**
 * Library path validation (SPECS 4.8 rule 1). Everything the renderer sends is a
 * library-relative POSIX path; nothing reaches the filesystem without passing here.
 */
import { realpath as realpathCb } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import { fail } from '@shared/result';

const MAX_PATH_LENGTH = 4096;

/** realpath that also resolves Windows junctions and 8.3 short names. */
export const realpathNative = promisify(realpathCb.native);
const caseInsensitiveFs = process.platform === 'win32' || process.platform === 'darwin';

export interface NormalizeOptions {
  /** Accept "" (the library root). */
  allowRoot?: boolean;
  /** Accept segments starting with "." (internal callers only, e.g. `.vault/cover.jpg`). */
  allowHidden?: boolean;
}

/**
 * Normalizes a library-relative path: rejects absolute paths, `..`, NUL bytes and
 * backslashes; drops empty and `.` segments. Returns "" for the root.
 */
export function normalizeLibraryPath(input: unknown, opts: NormalizeOptions = {}): string {
  if (typeof input !== 'string') fail('INVALID_PATH', 'Path must be a string.');
  if (input.length > MAX_PATH_LENGTH) fail('INVALID_PATH', 'Path is too long.');
  if (input.includes('\0')) fail('INVALID_PATH', 'Path contains a NUL byte.');
  if (input.includes('\\')) fail('INVALID_PATH', 'Use "/" as the path separator.');
  if (input.startsWith('/') || /^[A-Za-z]:/.test(input))
    fail('INVALID_PATH', 'Path must be library-relative.');
  const segments: string[] = [];
  for (const seg of input.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') fail('INVALID_PATH', 'Path must not contain "..".');
    if (!opts.allowHidden && seg.startsWith('.')) fail('FORBIDDEN', 'Hidden files are not accessible.');
    segments.push(seg);
  }
  const out = segments.join('/');
  if (out === '' && !opts.allowRoot) fail('INVALID_PATH', 'Path must not be the library root.');
  return out;
}

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

/**
 * Checks a single file or folder name the app is about to create. Names must work on
 * every OS, because libraries sync between machines.
 */
export function validateNewName(name: string): void {
  if (name.length === 0) fail('INVALID_PATH', 'Name must not be empty.');
  if (Buffer.byteLength(name, 'utf8') > 255) fail('INVALID_PATH', 'Name is too long.');
  if (FORBIDDEN_CHARS.test(name))
    fail('RESERVED_NAME', 'Name contains a character that is not allowed: < > : " / \\ | ? *');
  if (/[. ]$/.test(name)) fail('RESERVED_NAME', 'Name must not end with a dot or a space.');
  if (name.startsWith('.')) fail('RESERVED_NAME', 'Name must not start with a dot.');
  if (RESERVED_WINDOWS.test(name)) fail('RESERVED_NAME', `"${name}" is a reserved name on Windows.`);
}

/** Folder-name sanitization for new Vaults (SPECS 8). */
export function sanitizeFolderName(name: string): string {
  let out = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
  out = out.replace(/[. ]+$/, '');
  out = out.replace(/^\.+/, '');
  if (RESERVED_WINDOWS.test(out)) out = `${out}_`;
  if (out.length === 0) out = 'Vault';
  // Keep well under the 255-byte limit so collision suffixes still fit.
  while (Buffer.byteLength(out, 'utf8') > 200) out = out.slice(0, -1);
  return out.replace(/[. ]+$/, '') || 'Vault';
}

function foldCase(p: string): string {
  return caseInsensitiveFs ? p.toLowerCase() : p;
}

export function isInside(root: string, candidate: string): boolean {
  const r = foldCase(root);
  const c = foldCase(candidate);
  if (c === r) return true;
  const withSep = r.endsWith(path.sep) ? r : r + path.sep;
  return c.startsWith(withSep);
}

/** Resolves library-relative paths to absolute ones, refusing anything outside the root. */
export class LibraryRoot {
  private constructor(
    /** The folder as the user chose it. */
    readonly root: string,
    /** The same folder after resolving symlinks, junctions and 8.3 names. */
    readonly realRoot: string,
  ) {}

  static async create(root: string): Promise<LibraryRoot> {
    const abs = path.resolve(root);
    const real = await realpathNative(abs);
    return new LibraryRoot(abs, real);
  }

  /** Absolute path for `rel` (already normalized), without touching the disk. */
  join(rel: string): string {
    return rel === '' ? this.root : path.join(this.root, ...rel.split('/'));
  }

  /**
   * Normalizes and resolves `input`. The nearest existing ancestor (or the target
   * itself) is resolved with realpath and must lie inside the library, so symlinks
   * that point outside are never followed.
   */
  async resolve(input: unknown, opts: NormalizeOptions = {}): Promise<{ rel: string; abs: string }> {
    const rel = normalizeLibraryPath(input, opts);
    const abs = this.join(rel);
    await this.assertContained(abs);
    return { rel, abs };
  }

  async assertContained(abs: string): Promise<void> {
    let probe = abs;
    for (;;) {
      try {
        const real = await realpathNative(probe);
        if (!isInside(this.realRoot, real)) fail('OUTSIDE_LIBRARY', 'Path resolves outside the library.');
        return;
      } catch (err) {
        if ((err as { code?: string }).code !== 'ENOENT') throw err;
        const parent = path.dirname(probe);
        if (parent === probe) fail('OUTSIDE_LIBRARY', 'Path resolves outside the library.');
        probe = parent;
      }
    }
  }

  /** The real path to write to: follows in-library symlinks so they survive a save. */
  async realTarget(abs: string): Promise<string> {
    const real = await realpathNative(abs);
    if (!isInside(this.realRoot, real)) fail('OUTSIDE_LIBRARY', 'Path resolves outside the library.');
    return real;
  }

  /** Library-relative POSIX path for an absolute path inside the root, else null. */
  toRelative(abs: string): string | null {
    for (const base of [this.root, this.realRoot]) {
      if (isInside(base, abs)) {
        const rel = path.relative(base, abs);
        return rel.split(path.sep).join('/');
      }
    }
    return null;
  }
}
