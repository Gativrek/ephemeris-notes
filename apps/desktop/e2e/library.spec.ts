import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, setPickFolder, tempDir } from './helpers';

test('Create Library writes the skeleton and nothing else', async () => {
  const folder = await tempDir('lib');
  await writeFile(path.join(folder, 'existing.md'), '# Keep me\r\n');
  const ctx = await launch();
  try {
    await expect(ctx.page.getByTestId('first-run')).toBeVisible();
    await setPickFolder(ctx.app, folder);
    await ctx.page.getByRole('button', { name: 'Create Library…' }).click();
    await expect(ctx.page.getByTestId('library-open')).toBeVisible();

    const entries = (await readdir(folder)).sort();
    expect(entries).toEqual([
      '.gitignore',
      '.vaults',
      'Academic',
      'Inbox',
      'Personal',
      'Work',
      'existing.md',
    ]);
    expect(await readdir(path.join(folder, '.vaults'))).toEqual(['library.json']);
    const lib = JSON.parse(await readFile(path.join(folder, '.vaults/library.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(lib.schema).toBe(1);
    expect(lib.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readFile(path.join(folder, 'existing.md'), 'utf8')).toBe('# Keep me\r\n');
  } finally {
    await ctx.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('Open Library on a plain folder offers to create one; the library reopens on launch', async () => {
  const folder = await tempDir('plain');
  const userData = await tempDir('userdata');
  let ctx = await launch({ userData });
  try {
    await setPickFolder(ctx.app, folder);
    await ctx.page.getByRole('button', { name: 'Open Library…' }).click();
    await expect(ctx.page.getByText('is not a library yet.')).toBeVisible();
    await ctx.page.getByRole('button', { name: 'Create Library Here' }).click();
    await expect(ctx.page.getByTestId('library-open')).toBeVisible();
    await ctx.close();

    ctx = await launch({ userData });
    await expect(ctx.page.getByTestId('library-open')).toBeVisible();
  } finally {
    await ctx.close();
    await rm(folder, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
