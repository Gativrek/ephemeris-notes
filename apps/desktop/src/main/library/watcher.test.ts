import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryFs } from './fileio';
import { LibraryRoot } from './paths';
import { LibraryWatcher, OwnWrites, shouldIgnore, type WatchEvent } from './watcher';

describe('shouldIgnore', () => {
  it.each([
    ['Academic/V/Notes/a.md', false],
    ['Academic/V/.vault/vault.json', false],
    ['Academic/V/.vault/cover.jpg', false],
    ['Academic/V/.vault/plugin-data/x/state.json', false],
    ['.vaults/settings.json', false],
    ['.vaults/plugin-data/p/settings.json', false],
    ['.vaults/library.json', true],
    ['.git/HEAD', true],
    ['.obsidian/workspace.json', true],
    ['Academic/V/.hidden.md', true],
    ['Academic/V/Notes/.a.md.vx-tmp-abcdef012345', true],
    ['Academic/V/.vault/other.txt', true],
  ])('%s -> %s', (rel, ignored) => {
    expect(shouldIgnore(rel)).toBe(ignored);
  });
});

describe('OwnWrites', () => {
  it('consumes matching hashes once and expires old entries', () => {
    let now = 0;
    const own = new OwnWrites(() => now);
    own.expect('a.md', 'h1');
    expect(own.consume('a.md', 'h2')).toBe(false);
    expect(own.consume('a.md', 'h1')).toBe(true);
    expect(own.consume('a.md', 'h1')).toBe(false);
    own.expect('b.md', 'h');
    now = 20_000;
    expect(own.consume('b.md', 'h')).toBe(false);
  });
});

describe('LibraryWatcher', () => {
  let tmp: string;
  let watcher: LibraryWatcher;
  let lfs: LibraryFs;
  const events: WatchEvent[] = [];

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-watch-'));
    await fs.mkdir(path.join(tmp, 'Academic', 'V'), { recursive: true });
    events.length = 0;
    const root = await LibraryRoot.create(tmp);
    watcher = new LibraryWatcher(root, (e) => events.push(e));
    lfs = new LibraryFs(root, {
      trash: (abs) => fs.rm(abs, { recursive: true }),
      onOwnWrite: (rel, hash) => watcher.ownWrites.expect(rel, hash),
    });
    await watcher.start();
  });
  afterEach(async () => {
    await watcher.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const settle = () => new Promise((r) => setTimeout(r, 900));

  it('reports external changes and ignores the app’s own writes', async () => {
    await lfs.create('Academic/V/own.md', 'mine\n');
    const r = await lfs.read('Academic/V/own.md');
    await lfs.write('Academic/V/own.md', 'mine, edited\n', r.hash);
    await fs.writeFile(path.join(tmp, 'Academic', 'V', 'external.md'), 'from another tool\n');
    await settle();
    expect(events.filter((e) => e.path === 'Academic/V/own.md')).toEqual([]);
    expect(events).toContainEqual({ type: 'created', kind: 'file', path: 'Academic/V/external.md' });

    await fs.writeFile(path.join(tmp, 'Academic', 'V', 'own.md'), 'changed outside\n');
    await settle();
    expect(events).toContainEqual({ type: 'changed', kind: 'file', path: 'Academic/V/own.md' });

    await fs.rm(path.join(tmp, 'Academic', 'V', 'external.md'));
    await settle();
    expect(events).toContainEqual({ type: 'deleted', kind: 'file', path: 'Academic/V/external.md' });
    expect(events.some((e) => e.path.includes('vx-tmp'))).toBe(false);
  });
});
