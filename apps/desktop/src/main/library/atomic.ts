/**
 * Atomic writes (SPECS 4.8 rule 2): write a temp file next to the target, fsync,
 * then rename over it. A crash at any point leaves either the old or the new bytes.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRY_DELAYS_MS = [10, 20, 40, 80, 120, 200, 300, 500];

export const TEMP_MARKER = '.vx-tmp-';

export function isTempFile(name: string): boolean {
  return name.startsWith('.') && name.includes(TEMP_MARKER);
}

export interface AtomicHooks {
  /** Test seam: runs after the temp file is durable and before the rename. */
  beforeRename?(tempPath: string): Promise<void> | void;
}

function tempPathFor(target: string): string {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}${TEMP_MARKER}${randomBytes(6).toString('hex')}`,
  );
}

async function writeDurable(file: string, data: Uint8Array, mode?: number): Promise<void> {
  const fh = await fs.open(file, 'wx', mode);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

async function syncDir(dir: string): Promise<void> {
  // Windows cannot open a directory for fsync; NTFS journals the rename itself.
  if (isWindows) return;
  try {
    const fh = await fs.open(dir, 'r');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    // Some filesystems refuse directory fsync. The data itself is already durable.
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      // Antivirus scanners and the search indexer briefly lock files on Windows.
      const delay = RETRY_DELAYS_MS[attempt];
      if (!isWindows || !RETRY_CODES.has(code) || delay === undefined) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/** Replaces `target` (which may or may not exist) with `data`, atomically. */
export async function atomicWrite(target: string, data: Uint8Array, hooks: AtomicHooks = {}): Promise<void> {
  let mode: number | undefined;
  try {
    mode = (await fs.stat(target)).mode & 0o7777;
  } catch {
    mode = undefined;
  }
  const temp = tempPathFor(target);
  try {
    await writeDurable(temp, data, mode);
    await hooks.beforeRename?.(temp);
    await renameWithRetry(temp, target);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
  await syncDir(path.dirname(target));
}

/**
 * Creates `target` with `data` without ever replacing an existing file. Uses a hard
 * link from a durable temp file (atomic no-clobber); falls back to an exclusive open
 * on filesystems without hard links.
 */
export async function atomicCreate(target: string, data: Uint8Array): Promise<void> {
  const temp = tempPathFor(target);
  await writeDurable(temp, data);
  try {
    await fs.link(temp, target);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'EEXIST') throw err;
    await writeDurable(target, data);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
  await syncDir(path.dirname(target));
}
