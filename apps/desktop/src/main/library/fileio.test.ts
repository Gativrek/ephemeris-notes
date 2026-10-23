import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from './encoding';
import { LibraryFs } from './fileio';
import { LibraryRoot } from './paths';

let tmp: string;
let lfs: LibraryFs;
const trashed: string[] = [];
const ownWrites: Array<[string, string | null]> = [];

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-fileio-'));
  await fs.mkdir(path.join(tmp, 'Academic', 'V', 'Notes'), { recursive: true });
  trashed.length = 0;
  ownWrites.length = 0;
  lfs = new LibraryFs(await LibraryRoot.create(tmp), {
    trash: async (abs) => {
      trashed.push(abs);
      await fs.rm(abs, { recursive: true });
    },
    onOwnWrite: (rel, hash) => ownWrites.push([rel, hash]),
  });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const file = (rel: string) => path.join(tmp, ...rel.split('/'));

describe('read', () => {
  it('returns LF text, the raw-bytes hash and encoding facts', async () => {
    const raw = Buffer.from('﻿# T\r\nbody\r\n', 'utf8');
    await fs.writeFile(file('Academic/V/Notes/a.md'), raw);
    const r = await lfs.read('Academic/V/Notes/a.md');
    expect(r.text).toBe('# T\nbody\n');
    expect(r.hash).toBe(sha256(raw));
    expect(r).toMatchObject({ eol: 'crlf', bom: true, mixedEol: false, readOnly: false, finalNewline: true });
  });

  it('refuses folders and missing files', async () => {
    await expect(lfs.read('Academic/V')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(lfs.read('Academic/V/nope.md')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('write', () => {
  it('writes edits with the file’s own line endings and BOM', async () => {
    const raw = Buffer.from('﻿a\r\nb\r\n', 'utf8');
    await fs.writeFile(file('Academic/V/Notes/a.md'), raw);
    const r = await lfs.read('Academic/V/Notes/a.md');
    const w = await lfs.write('Academic/V/Notes/a.md', 'a\nb\nc\n', r.hash);
    const now = await fs.readFile(file('Academic/V/Notes/a.md'));
    expect(now.equals(Buffer.from('﻿a\r\nb\r\nc\r\n', 'utf8'))).toBe(true);
    expect(w.hash).toBe(sha256(now));
    expect(ownWrites).toContainEqual(['Academic/V/Notes/a.md', w.hash]);
  });

  it('does not touch the file when the bytes would be identical', async () => {
    await fs.writeFile(file('Academic/V/Notes/a.md'), 'x\r\n');
    const past = new Date('2020-01-01T00:00:00Z');
    await fs.utimes(file('Academic/V/Notes/a.md'), past, past);
    const r = await lfs.read('Academic/V/Notes/a.md');
    await lfs.write('Academic/V/Notes/a.md', r.text, r.hash);
    expect((await fs.stat(file('Academic/V/Notes/a.md'))).mtime.getTime()).toBe(past.getTime());
    expect(ownWrites).toEqual([]);
  });

  it('refuses a stale hash with CONFLICT and the current hash', async () => {
    await fs.writeFile(file('Academic/V/Notes/a.md'), 'v1\n');
    const r = await lfs.read('Academic/V/Notes/a.md');
    await fs.writeFile(file('Academic/V/Notes/a.md'), 'v2 from elsewhere\n');
    await expect(lfs.write('Academic/V/Notes/a.md', 'mine\n', r.hash)).rejects.toMatchObject({
      code: 'CONFLICT',
      detail: { hash: sha256(Buffer.from('v2 from elsewhere\n')) },
    });
    expect(await fs.readFile(file('Academic/V/Notes/a.md'), 'utf8')).toBe('v2 from elsewhere\n');
  });

  it('never saves a file that is not UTF-8', async () => {
    await fs.writeFile(file('Academic/V/Notes/l.md'), Buffer.from('Caf\xe9\n', 'latin1'));
    const r = await lfs.read('Academic/V/Notes/l.md');
    expect(r.readOnly).toBe(true);
    await expect(lfs.write('Academic/V/Notes/l.md', 'Cafe\n', r.hash)).rejects.toMatchObject({
      code: 'NOT_UTF8',
    });
  });

  it('requires a well-formed hash and refuses missing files', async () => {
    await expect(lfs.write('Academic/V/Notes/a.md', 'x', 'nope')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(lfs.write('Academic/V/Notes/a.md', 'x', '0'.repeat(64))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('writes through an in-library symlink to its target', async () => {
    await fs.writeFile(file('Academic/V/Notes/real.md'), 'r\n');
    const linkDir = file('Academic/V/Link');
    await fs.symlink(file('Academic/V/Notes'), linkDir, process.platform === 'win32' ? 'junction' : 'dir');
    const r = await lfs.read('Academic/V/Link/real.md');
    await lfs.write('Academic/V/Link/real.md', 'r2\n', r.hash);
    expect(await fs.readFile(file('Academic/V/Notes/real.md'), 'utf8')).toBe('r2\n');
    expect((await fs.lstat(linkDir)).isSymbolicLink()).toBe(true);
  });
});

describe('create', () => {
  it('creates new LF files and never replaces existing ones', async () => {
    const w = await lfs.create('Academic/V/Notes/new.md', '# New\n');
    expect(await fs.readFile(file('Academic/V/Notes/new.md'), 'utf8')).toBe('# New\n');
    expect(w.hash).toBe(sha256(Buffer.from('# New\n')));
    await expect(lfs.create('Academic/V/Notes/new.md', 'other')).rejects.toMatchObject({ code: 'EXISTS' });
    expect(await fs.readFile(file('Academic/V/Notes/new.md'), 'utf8')).toBe('# New\n');
  });

  it('validates the name and requires the parent folder', async () => {
    await expect(lfs.create('Academic/V/Notes/CON.md', '')).rejects.toMatchObject({ code: 'RESERVED_NAME' });
    await expect(lfs.create('Academic/V/Missing/x.md', '')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('leaves no temp files behind', async () => {
    await lfs.create('Academic/V/Notes/new.md', 'x');
    expect(await fs.readdir(file('Academic/V/Notes'))).toEqual(['new.md']);
  });
});

describe('rename, mkdir, trash, list', () => {
  it('renames, refusing to overwrite', async () => {
    await fs.writeFile(file('Academic/V/Notes/a.md'), 'a');
    await fs.writeFile(file('Academic/V/Notes/b.md'), 'b');
    await expect(lfs.rename('Academic/V/Notes/a.md', 'Academic/V/Notes/b.md')).rejects.toMatchObject({
      code: 'EXISTS',
    });
    await lfs.rename('Academic/V/Notes/a.md', 'Academic/V/c.md');
    expect(await fs.readFile(file('Academic/V/c.md'), 'utf8')).toBe('a');
  });

  it('allows a case-only rename', async () => {
    await fs.writeFile(file('Academic/V/Notes/case.md'), 'x');
    await lfs.rename('Academic/V/Notes/case.md', 'Academic/V/Notes/Case.md');
    expect(await fs.readdir(file('Academic/V/Notes'))).toContain('Case.md');
  });

  it('refuses moving a folder into itself', async () => {
    await expect(lfs.rename('Academic/V/Notes', 'Academic/V/Notes/Inner')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('creates folders, validating every new segment', async () => {
    await lfs.mkdir('Academic/V/A/B');
    expect((await fs.stat(file('Academic/V/A/B'))).isDirectory()).toBe(true);
    await expect(lfs.mkdir('Academic/V/A/aux')).rejects.toMatchObject({ code: 'RESERVED_NAME' });
  });

  it('trashes through the injected trash, never deleting itself', async () => {
    await fs.writeFile(file('Academic/V/Notes/t.md'), 't');
    await lfs.trash('Academic/V/Notes/t.md');
    expect(trashed).toEqual([file('Academic/V/Notes/t.md')]);
    await expect(lfs.trash('')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('lists without hidden entries or temp files', async () => {
    await fs.writeFile(file('Academic/V/Notes/a.md'), 'a');
    await fs.writeFile(file('Academic/V/Notes/.hidden.md'), 'h');
    await fs.writeFile(file('Academic/V/Notes/.a.md.vx-tmp-123456'), 't');
    await fs.mkdir(file('Academic/V/Notes/Sub'));
    const entries = await lfs.list('Academic/V/Notes');
    expect(entries.map((e) => [e.name, e.kind])).toEqual([
      ['Sub', 'folder'],
      ['a.md', 'file'],
    ]);
  });
});
