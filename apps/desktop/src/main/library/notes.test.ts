import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileCatalog } from './catalog';
import { LibraryFs } from './fileio';
import { addAttachment, createNote, dailyNote, expandTemplate, safeFileName } from './notes';
import { LibraryRoot } from './paths';
import { VaultStore } from './vaults';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/library');
let tmp: string;
let lib: string;
let lfs: LibraryFs;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-notes-'));
  lib = path.join(tmp, 'library');
  await fs.cp(fixture, lib, { recursive: true });
  lfs = new LibraryFs(await LibraryRoot.create(lib), { trash: (abs) => fs.rm(abs, { recursive: true }) });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const gnss = async () => (await new VaultStore(lfs).get('Academic/GNSS Study'))!;
const NOW = new Date(2026, 9, 23, 7, 5);

describe('templates', () => {
  it('expands the five variables and nothing else', () => {
    expect(
      expandTemplate('{{title}} {{ date }} {{time}} {{vault}} {{domain}} {{other}}', {
        title: 'T',
        date: 'D',
        time: 'H',
        vault: 'V',
        domain: 'Do',
      }),
    ).toBe('T D H V Do {{other}}');
  });

  it('creates notes from a template with unique names', async () => {
    const v = await gnss();
    const a = await createNote(
      lfs,
      v,
      'Academic/GNSS Study/Notes',
      'Week 1',
      'Academic/GNSS Study/_templates/Daily.md',
      NOW,
    );
    const b = await createNote(lfs, v, 'Academic/GNSS Study/Notes', 'Week 1', null, NOW);
    expect(a).toBe('Academic/GNSS Study/Notes/Week 1.md');
    expect(b).toBe('Academic/GNSS Study/Notes/Week 1 1.md');
    expect(await fs.readFile(path.join(lib, a), 'utf8')).toBe(
      '# 2026-10-23\n\nVault: GNSS Constellation Study (Academic)\n',
    );
    await expect(
      createNote(lfs, v, 'Academic/GNSS Study/Notes', 'x', 'Work/Acme Robotics/Specs/Index.md', NOW),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('daily notes', () => {
  it('creates YYYY-MM-DD.md from _templates/Daily.md once, then reuses it', async () => {
    const v = await gnss();
    const first = await dailyNote(lfs, v, NOW);
    expect(first).toEqual({ path: 'Academic/GNSS Study/Daily/2026-10-23.md', created: true });
    const again = await dailyNote(lfs, v, NOW);
    expect(again.created).toBe(false);
  });

  it('falls back to a heading without a template, creating the folder', async () => {
    const v = await new VaultStore(lfs).get('Work/Acme Robotics');
    const r = await dailyNote(lfs, v!, NOW);
    expect(await fs.readFile(path.join(lib, r.path), 'utf8')).toBe('# 2026-10-23\n');
  });
});

describe('attachments', () => {
  it('copies into the attachment folder with collision-safe names', async () => {
    const v = await gnss();
    const p = await addAttachment(lfs, v, 'diagram.png', new Uint8Array([1, 2, 3]));
    expect(p).toBe('Academic/GNSS Study/_attachments/diagram 1.png');
    expect(await addAttachment(lfs, v, 'diagram.png', new Uint8Array([4]))).toBe(
      'Academic/GNSS Study/_attachments/diagram 2.png',
    );
  });

  it('makes names safe for every OS', () => {
    expect(safeFileName('a:b?.png')).toBe('a b .png');
    expect(safeFileName('CON.png')).toBe('Attachment.png');
    expect(safeFileName('...')).toBe('Attachment');
  });
});

describe('FileCatalog', () => {
  it('lists visible files and follows refreshes', async () => {
    const cat = new FileCatalog(lib);
    const { files } = await cat.list();
    const paths = files.map((f) => f.path);
    expect(paths).toContain('Academic/Knowledge/Concepts/Kalman Filter.md');
    expect(paths.some((p) => p.includes('/.'))).toBe(false);
    await fs.writeFile(path.join(lib, 'Inbox', 'new.md'), 'x');
    await cat.refresh('Inbox/new.md');
    expect((await cat.list()).files.map((f) => f.path)).toContain('Inbox/new.md');
    await fs.rm(path.join(lib, 'Academic', 'Knowledge'), { recursive: true });
    await cat.refresh('Academic/Knowledge');
    expect((await cat.list()).files.some((f) => f.path.startsWith('Academic/Knowledge/'))).toBe(false);
  });
});
