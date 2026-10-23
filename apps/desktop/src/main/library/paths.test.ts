import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VxFailure } from '@shared/result';
import { LibraryRoot, normalizeLibraryPath, sanitizeFolderName, validateNewName } from './paths';

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof VxFailure ? err.code : 'THREW';
  }
};

describe('normalizeLibraryPath', () => {
  it('accepts library-relative POSIX paths and normalizes them', () => {
    expect(normalizeLibraryPath('Academic/GNSS Study/Notes/Intro.md')).toBe(
      'Academic/GNSS Study/Notes/Intro.md',
    );
    expect(normalizeLibraryPath('a//b/./c.md')).toBe('a/b/c.md');
    expect(normalizeLibraryPath('', { allowRoot: true })).toBe('');
  });

  it.each([
    ['../outside.md', 'INVALID_PATH'],
    ['a/../../b', 'INVALID_PATH'],
    ['/etc/passwd', 'INVALID_PATH'],
    ['C:/Windows/win.ini', 'INVALID_PATH'],
    ['c:relative', 'INVALID_PATH'],
    ['a\\b.md', 'INVALID_PATH'],
    ['a\0b', 'INVALID_PATH'],
    ['', 'INVALID_PATH'],
    ['.ephemeris/library.json', 'FORBIDDEN'],
    ['Academic/V/.vault/vault.json', 'FORBIDDEN'],
  ])('rejects %j', (input, expected) => {
    expect(code(() => normalizeLibraryPath(input))).toBe(expected);
  });

  it('rejects non-strings and overlong paths', () => {
    expect(code(() => normalizeLibraryPath(42))).toBe('INVALID_PATH');
    expect(code(() => normalizeLibraryPath('a/'.repeat(3000)))).toBe('INVALID_PATH');
  });

  it('allows hidden segments only when asked', () => {
    expect(normalizeLibraryPath('.ephemeris/settings.json', { allowHidden: true })).toBe(
      '.ephemeris/settings.json',
    );
  });
});

describe('validateNewName', () => {
  it.each(['CON', 'con.md', 'NUL.txt', 'COM1', 'lpt9.md', 'AUX'])('refuses reserved Windows name %j', (n) => {
    expect(code(() => validateNewName(n))).toBe('RESERVED_NAME');
  });
  it.each([
    'a:b.md',
    'what?.md',
    'x*.md',
    'pipe|.md',
    'quote".md',
    'lt<.md',
    'trailing.',
    'trailing ',
    '.hidden',
  ])('refuses %j', (n) => {
    expect(code(() => validateNewName(n))).toBe('RESERVED_NAME');
  });
  it('accepts ordinary names, including Unicode', () => {
    expect(code(() => validateNewName('Navegação inercial.md'))).toBeNull();
    expect(code(() => validateNewName('Lecture 10.md'))).toBeNull();
    expect(code(() => validateNewName('CONSOLE.md'))).toBeNull();
  });
});

describe('sanitizeFolderName', () => {
  it('strips forbidden characters and trailing dots and spaces', () => {
    expect(sanitizeFolderName('GNSS: Study / 2026?')).toBe('GNSS Study  2026');
    expect(sanitizeFolderName('Notes...  ')).toBe('Notes');
    expect(sanitizeFolderName('CON')).toBe('CON_');
    expect(sanitizeFolderName('***')).toBe('Vault');
    expect(sanitizeFolderName('.hidden')).toBe('hidden');
  });
});

describe('LibraryRoot', () => {
  let tmp: string;
  let lib: string;
  let outside: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vx-paths-'));
    lib = path.join(tmp, 'lib');
    outside = path.join(tmp, 'outside');
    await fs.mkdir(path.join(lib, 'Academic'), { recursive: true });
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret.md'), 'secret');
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('resolves paths inside the library, existing or not', async () => {
    const root = await LibraryRoot.create(lib);
    const r = await root.resolve('Academic/New/Note.md');
    expect(r.rel).toBe('Academic/New/Note.md');
    expect(r.abs).toBe(path.join(lib, 'Academic', 'New', 'Note.md'));
  });

  it('refuses links that point outside the library', async () => {
    // Junctions need no privileges on Windows; elsewhere a directory symlink.
    await fs.symlink(
      outside,
      path.join(lib, 'Academic', 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const root = await LibraryRoot.create(lib);
    await expect(root.resolve('Academic/escape/secret.md')).rejects.toMatchObject({
      code: 'OUTSIDE_LIBRARY',
    });
    await expect(root.resolve('Academic/escape/new.md')).rejects.toMatchObject({ code: 'OUTSIDE_LIBRARY' });
  });

  it('follows links that stay inside the library', async () => {
    await fs.mkdir(path.join(lib, 'Work'));
    await fs.writeFile(path.join(lib, 'Work', 'a.md'), 'x');
    await fs.symlink(
      path.join(lib, 'Work'),
      path.join(lib, 'Academic', 'alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const root = await LibraryRoot.create(lib);
    const r = await root.resolve('Academic/alias/a.md');
    expect(await root.realTarget(r.abs)).toBe(await fs.realpath(path.join(lib, 'Work', 'a.md')));
  });

  it('maps absolute paths back to library-relative ones', async () => {
    const root = await LibraryRoot.create(lib);
    expect(root.toRelative(path.join(lib, 'Academic', 'x.md'))).toBe('Academic/x.md');
    expect(root.toRelative(path.join(outside, 'secret.md'))).toBeNull();
  });
});
