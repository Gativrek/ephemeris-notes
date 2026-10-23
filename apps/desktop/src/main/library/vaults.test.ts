import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryFs } from './fileio';
import { LibraryRoot } from './paths';
import { VaultStore, coverExtension } from './vaults';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/library');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let tmp: string;
let lib: string;
let store: VaultStore;
const trashed: string[] = [];

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-vaults-'));
  lib = path.join(tmp, 'library');
  await fs.cp(fixture, lib, { recursive: true });
  trashed.length = 0;
  const lfs = new LibraryFs(await LibraryRoot.create(lib), {
    trash: async (abs) => {
      trashed.push(path.relative(lib, abs).split(path.sep).join('/'));
      await fs.rm(abs, { recursive: true });
    },
  });
  store = new VaultStore(lfs);
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const readJson = async (rel: string) =>
  JSON.parse(await fs.readFile(path.join(lib, ...rel.split('/')), 'utf8')) as Record<string, unknown>;

describe('discovery', () => {
  it('finds Vaults by .vault/vault.json, ordered by order then name', async () => {
    const vaults = await store.list();
    expect(vaults.map((v) => [v.domain, v.name])).toEqual([
      ['work', 'Acme Robotics'],
      ['academic', 'Knowledge'],
      ['academic', 'GNSS Constellation Study'],
    ]);
    const gnss = vaults.find((v) => v.folder === 'GNSS Study')!;
    expect(gnss.path).toBe('Academic/GNSS Study');
    expect(gnss.cover).toEqual({ file: 'cover.png', focus: { x: 0.5, y: 0.35 }, zoom: 1 });
    expect(gnss.noteCount).toBeGreaterThan(10);
    expect(gnss.lastEdited).toBeGreaterThan(0);
  });

  it('lists Domain folders that are not Vaults', async () => {
    expect(await store.nonVaultFolders()).toEqual([{ path: 'Academic/Old Course', domain: 'academic' }]);
  });

  it('shows a Vault with broken JSON without rewriting it', async () => {
    const file = path.join(lib, 'Work', 'Acme Robotics', '.vault', 'vault.json');
    await fs.writeFile(file, '{ not json');
    const v = await store.get('Work/Acme Robotics');
    expect(v).toMatchObject({ broken: true, name: 'Acme Robotics' });
    await expect(store.update('Work/Acme Robotics', { name: 'X' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(await fs.readFile(file, 'utf8')).toBe('{ not json');
  });
});

describe('create', () => {
  it('sanitizes the folder name, adds _attachments and vault.json', async () => {
    const v = await store.create({ name: 'Control: Theory / 2026?', domain: 'personal' });
    expect(v.path).toBe('Personal/Control Theory  2026');
    expect(v.name).toBe('Control: Theory / 2026?');
    expect(
      (await fs.stat(path.join(lib, 'Personal', 'Control Theory  2026', '_attachments'))).isDirectory(),
    ).toBe(true);
    const raw = await readJson('Personal/Control Theory  2026/.vault/vault.json');
    expect(raw).toMatchObject({ schema: 1, name: 'Control: Theory / 2026?', order: 1 });
    expect(raw.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('appends " 2" when the folder exists, and refuses duplicate names in a Domain', async () => {
    const v = await store.create({ name: 'Old Course', domain: 'academic' });
    expect(v.path).toBe('Academic/Old Course 2');
    await expect(store.create({ name: 'knowledge', domain: 'academic' })).rejects.toMatchObject({
      code: 'EXISTS',
    });
    await expect(store.create({ name: 'Knowledge', domain: 'work' })).resolves.toMatchObject({
      domain: 'work',
    });
  });

  it('validates the name length', async () => {
    await expect(store.create({ name: '   ', domain: 'work' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(store.create({ name: 'x'.repeat(61), domain: 'work' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('copies the cover into .vault/cover.<ext>', async () => {
    const v = await store.create({
      name: 'With Cover',
      domain: 'work',
      cover: {
        bytes: PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length),
        focus: { x: 0.2, y: 0.8 },
        zoom: 1.5,
      },
    });
    expect(v.cover).toEqual({ file: 'cover.png', focus: { x: 0.2, y: 0.8 }, zoom: 1.5 });
    expect((await fs.readFile(path.join(lib, 'Work', 'With Cover', '.vault', 'cover.png'))).equals(PNG)).toBe(
      true,
    );
  });
});

describe('update, move, remove', () => {
  it('keeps unknown keys when editing', async () => {
    await store.update('Work/Acme Robotics', { name: 'Acme Robotics Ltd' });
    const raw = await readJson('Work/Acme Robotics/.vault/vault.json');
    expect(raw.name).toBe('Acme Robotics Ltd');
    expect(raw['x-custom']).toEqual({ keep: 'unknown keys survive writes' });
    expect(raw.id).toBe('0a1b2c3d-0000-4000-8000-000000000003');
  });

  it('changes focus and zoom without a new image', async () => {
    const v = await store.update('Academic/GNSS Study', {
      name: 'GNSS Constellation Study',
      cover: { focus: { x: 0.1, y: 0.9 }, zoom: 2 },
    });
    expect(v.cover).toEqual({ file: 'cover.png', focus: { x: 0.1, y: 0.9 }, zoom: 2 });
  });

  it('reports move impact and moves the folder to the other Domain', async () => {
    const impact = await store.moveImpact('Academic/Knowledge');
    expect(impact.notes).toBe(5);
    expect(impact.linkingNotes).toEqual(['Work/Acme Robotics/Specs/Navigation.md']);
    const moved = await store.move('Academic/Knowledge', 'personal');
    expect(moved.path).toBe('Personal/Knowledge');
    expect(moved.domain).toBe('personal');
  });

  it('deletes only with the exact name typed, to the trash', async () => {
    await expect(store.remove('Work/Acme Robotics', 'acme')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await store.remove('Work/Acme Robotics', 'Acme Robotics');
    expect(trashed).toEqual(['Work/Acme Robotics']);
  });

  it('makes a Vault from a plain Domain folder', async () => {
    const v = await store.makeVault('Academic/Old Course');
    expect(v.name).toBe('Old Course');
    expect(await store.nonVaultFolders()).toEqual([]);
  });
});

describe('coverExtension', () => {
  it('trusts bytes, not names', () => {
    expect(coverExtension(PNG)).toBe('png');
    expect(coverExtension(Buffer.from('ffd8ffe0', 'hex'))).toBe('jpg');
    expect(coverExtension(Buffer.from('52494646000000005745425056503820', 'hex'))).toBe('webp');
    expect(() => coverExtension(Buffer.from('GIF89a'))).toThrow();
  });
});
