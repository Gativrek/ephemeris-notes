/**
 * Library identity, creation and opening (SPECS 4.1, 4.2, 4.10).
 * Opening reads only. Creating writes `.ephemeris/library.json`, the Domain folders,
 * `Inbox/` and `.gitignore`, and touches nothing else.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Domain, LibraryInfo } from '@shared/bridge';
import { fail } from '@shared/result';
import { atomicCreate, atomicWrite } from './atomic';
import { decodeText, encodeText, stripBom } from './encoding';

export const LIBRARY_DIR = '.ephemeris';
export const LIBRARY_FILE = 'library.json';
export const INBOX_DIR = 'Inbox';

/** Fixed Domain folder names on disk (never renamed by the app). */
export const DOMAIN_FOLDERS: Record<Domain, string> = {
  academic: 'Academic',
  work: 'Work',
  personal: 'Personal',
};
export const DOMAINS: Domain[] = ['academic', 'work', 'personal'];

export const GITIGNORE_LINES = ['.ephemeris/*.tmp', '**/.*.vx-tmp-*', '.obsidian/workspace*.json', '.trash/'];

export interface LibraryFile {
  schema: 1;
  id: string;
  created: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function libraryFilePath(root: string): string {
  return path.join(root, LIBRARY_DIR, LIBRARY_FILE);
}

async function isFolder(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Reads and validates `.ephemeris/library.json`. Returns null if the folder is not a library. */
export async function readLibrary(root: string): Promise<LibraryInfo | null> {
  let raw: string;
  try {
    raw = await fs.readFile(libraryFilePath(root), 'utf8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return null;
    throw err;
  }
  let data: unknown;
  try {
    data = JSON.parse(stripBom(raw));
  } catch {
    fail('NOT_A_LIBRARY', 'library.json is not valid JSON.');
  }
  const d = data as Partial<LibraryFile> | null;
  if (!d || typeof d !== 'object') fail('NOT_A_LIBRARY', 'library.json is not an object.');
  if (d.schema !== 1) fail('NOT_A_LIBRARY', `Unsupported library schema ${String(d.schema)}.`);
  if (typeof d.id !== 'string' || !UUID.test(d.id)) fail('NOT_A_LIBRARY', 'library.json has no valid id.');
  return {
    root: path.resolve(root),
    id: d.id,
    created: typeof d.created === 'string' ? d.created : '',
    name: path.basename(path.resolve(root)),
  };
}

/**
 * Turns an existing folder into a library. Existing files are left alone; an existing
 * `.gitignore` is appended to (missing lines only), never replaced.
 */
export async function createLibrary(root: string, now: Date = new Date()): Promise<LibraryInfo> {
  const abs = path.resolve(root);
  if (!(await isFolder(abs))) fail('NOT_FOUND', 'The folder does not exist.');
  if (await readLibrary(abs).catch(() => true)) fail('ALREADY_LIBRARY', 'This folder is already a library.');

  const file: LibraryFile = { schema: 1, id: randomUUID(), created: now.toISOString() };
  await fs.mkdir(path.join(abs, LIBRARY_DIR), { recursive: true });
  await atomicCreate(libraryFilePath(abs), Buffer.from(JSON.stringify(file, null, 2) + '\n', 'utf8'));

  for (const folder of [...Object.values(DOMAIN_FOLDERS), INBOX_DIR]) {
    await fs.mkdir(path.join(abs, folder), { recursive: true });
  }
  await ensureGitignore(abs);

  const info = await readLibrary(abs);
  if (!info) fail('IO', 'The library file could not be read back.');
  return info;
}

export async function ensureGitignore(root: string): Promise<void> {
  const file = path.join(root, '.gitignore');
  let current: Buffer | null = null;
  try {
    current = await fs.readFile(file);
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
  if (current === null) {
    await atomicCreate(file, encodeText(GITIGNORE_LINES.join('\n') + '\n', 'lf', false));
    return;
  }
  const decoded = decodeText(current);
  if (decoded.readOnly) return; // Not ours to repair.
  const present = new Set(decoded.text.split('\n').map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !present.has(l));
  if (missing.length === 0) return;
  const prefix = decoded.text.length > 0 && !decoded.finalNewline ? '\n' : '';
  const next = decoded.text + prefix + missing.join('\n') + '\n';
  await atomicWrite(file, encodeText(next, decoded.eol, decoded.bom));
}
