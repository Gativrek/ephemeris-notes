/**
 * Smoke test of the packaged Windows app (release/win-unpacked/Ephemeris.exe). Opt-in:
 * run `pnpm --filter @ephemeris-notes/desktop dist` first, then set VX_PACKAGED=1. A packaged
 * build has no test hooks, so the library is the "last library" in a fresh user-data
 * folder, and the window is a real one.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { appRoot, fixtureLibrary, tempDir } from './helpers';

test.skip(!process.env.VX_PACKAGED, 'Set VX_PACKAGED=1 after building the installer (pnpm dist).');

test('the packaged app opens a library, edits a note, indexes, watches and renders PDFs', async () => {
  test.setTimeout(180_000);
  const dir = await tempDir('packaged');
  const lib = path.join(dir, 'library');
  const userData = path.join(dir, 'userdata');
  await cp(fixtureLibrary, lib, { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(userData, 'state.json'), JSON.stringify({ lastLibrary: lib }));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('VX_')) env[k] = v;
  const app = await electron.launch({
    executablePath: path.join(appRoot, 'release/win-unpacked/Ephemeris.exe'),
    env: { ...env, VX_USER_DATA: userData },
  });
  try {
    const page = await app.firstWindow();
    expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true);
    // The production CSP, from the app protocol.
    expect(page.url()).toMatch(/^vx-app:\/\/app\//);

    await expect(page.getByTestId('chooser')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('vault-card').filter({ hasText: 'GNSS Constellation Study' }).dblclick();
    await expect(page.getByTestId('workspace')).toBeVisible();

    // Editing and saving go through the bundled main process.
    await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
    await page.getByTestId('tree').getByRole('treeitem', { name: 'Index' }).first().click();
    const editor = page.locator('.vx-editor .cm-content');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Packaged edit.');
    const note = path.join(lib, 'Academic/GNSS Study/Notes/Index.md');
    await expect.poll(async () => readFile(note, 'utf8'), { timeout: 10_000 }).toContain('Packaged edit.');

    // The index worker and its parse workers run from the package.
    const hits = await page.evaluate(async () => {
      const vx = (
        window as unknown as {
          vx: {
            index: { search(q: string, s: { kind: 'all' }): Promise<{ ok: boolean; value?: unknown[] }> };
          };
        }
      ).vx;
      for (let i = 0; i < 50; i++) {
        const r = await vx.index.search('kalman', { kind: 'all' });
        if (r.ok && (r.value?.length ?? 0) > 0) return r.value!.length;
        await new Promise((res) => setTimeout(res, 200));
      }
      return 0;
    });
    expect(hits).toBeGreaterThan(0);

    // The watcher worker sees a change made outside the app.
    await writeFile(note, '# GNSS Index\n\nChanged outside.\n');
    await expect(editor).toContainText('Changed outside.', { timeout: 10_000 });

    // pdf.js and its fallback decoders load from the package.
    await page.getByTestId('section-tile').filter({ hasText: 'Papers' }).click();
    await page.getByTestId('tree').getByRole('treeitem').filter({ hasText: 'PDF' }).first().click();
    await expect(page.locator('.vx-pdf-view canvas').first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => undefined);
  }
});
