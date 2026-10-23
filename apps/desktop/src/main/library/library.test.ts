import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GITIGNORE_LINES, createLibrary, readLibrary } from './library';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-library-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('createLibrary', () => {
  it('creates library.json, the Domains, Inbox and .gitignore only', async () => {
    const info = await createLibrary(tmp, new Date('2026-10-23T00:00:00Z'));
    expect((await fs.readdir(tmp)).sort()).toEqual([
      '.gitignore',
      '.vaults',
      'Academic',
      'Inbox',
      'Personal',
      'Work',
    ]);
    const lib = JSON.parse(await fs.readFile(path.join(tmp, '.vaults/library.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(lib).toEqual({ schema: 1, id: info.id, created: '2026-10-23T00:00:00.000Z' });
    expect(await fs.readFile(path.join(tmp, '.gitignore'), 'utf8')).toBe(GITIGNORE_LINES.join('\n') + '\n');
  });

  it('leaves existing content alone and appends to an existing .gitignore', async () => {
    await fs.mkdir(path.join(tmp, 'Academic'));
    await fs.writeFile(path.join(tmp, 'Academic', 'keep.md'), 'keep');
    await fs.writeFile(path.join(tmp, '.gitignore'), 'node_modules/\r\n.trash/');
    await createLibrary(tmp);
    expect(await fs.readFile(path.join(tmp, 'Academic', 'keep.md'), 'utf8')).toBe('keep');
    expect(await fs.readFile(path.join(tmp, '.gitignore'), 'utf8')).toBe(
      'node_modules/\r\n.trash/\r\n.vaults/*.tmp\r\n**/.*.vx-tmp-*\r\n.obsidian/workspace*.json\r\n',
    );
  });

  it('refuses a folder that already is a library', async () => {
    await createLibrary(tmp);
    await expect(createLibrary(tmp)).rejects.toMatchObject({ code: 'ALREADY_LIBRARY' });
  });
});

describe('readLibrary', () => {
  it('returns null for a plain folder and reads without writing', async () => {
    expect(await readLibrary(tmp)).toBeNull();
    expect(await fs.readdir(tmp)).toEqual([]);
  });

  it('validates schema and id', async () => {
    await fs.mkdir(path.join(tmp, '.vaults'));
    await fs.writeFile(path.join(tmp, '.vaults/library.json'), '{"schema":2,"id":"x"}');
    await expect(readLibrary(tmp)).rejects.toMatchObject({ code: 'NOT_A_LIBRARY' });
    await fs.writeFile(path.join(tmp, '.vaults/library.json'), 'not json');
    await expect(readLibrary(tmp)).rejects.toMatchObject({ code: 'NOT_A_LIBRARY' });
  });
});
