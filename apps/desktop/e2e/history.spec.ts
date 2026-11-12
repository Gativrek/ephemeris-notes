/** The Git timeline (SPECS 4.12): a note's history on the desk, comparisons, and restore. */
import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fixtureLibrary, launch, setPickFolder, tempDir, type Launched } from './helpers';

let hasGit = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
} catch {
  hasGit = false;
}

const NOTES = 'Academic/GNSS Study/Notes';
const V1 = '# Log\n\nalpha\nbeta\ngamma\n';
const V2 = '# Log\n\nalpha\nBETA changed\ngamma\ndelta\n';
const V4 = '# Log\n\nalpha\nBETA changed\ngamma\ndelta\nepsilon\n';

let ctx: Launched;
let lib: string;
const file = (rel: string) => path.join(lib, ...rel.split('/'));
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: lib, encoding: 'utf8', windowsHide: true }).trim();

async function openLibrary(withRepo: boolean): Promise<void> {
  const dir = await tempDir('history');
  lib = path.join(dir, 'library');
  await cp(fixtureLibrary, lib, { recursive: true });
  await writeFile(file(`${NOTES}/Log.md`), V1);
  if (withRepo) {
    git('init', '--quiet');
    // Repository-local settings only; nothing global is touched.
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.autocrlf', 'false');
    git('add', '--all');
    git('commit', '--quiet', '-m', 'Start the log');
    await writeFile(file(`${NOTES}/Log.md`), V2);
    git('commit', '--quiet', '-am', 'Change beta, add delta');
    git('mv', `${NOTES}/Log.md`, `${NOTES}/Journal.md`);
    git('commit', '--quiet', '-m', 'Rename the log');
    await writeFile(file(`${NOTES}/Journal.md`), V4);
    git('commit', '--quiet', '-am', 'Add epsilon');
  }
  ctx = await launch();
  await setPickFolder(ctx.app, lib);
  await ctx.page.getByRole('button', { name: 'Open Library…' }).click();
  await expect(ctx.page.getByTestId('chooser')).toBeVisible();
  await ctx.page.getByTestId('vault-card').filter({ hasText: 'GNSS Constellation Study' }).dblclick();
  await expect(ctx.page.getByTestId('workspace')).toBeVisible();
}

test.afterEach(async () => {
  await ctx?.close();
  if (lib) await rm(path.dirname(lib), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

async function openNote(page: Page, name: string): Promise<void> {
  await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
  await page.getByTestId('tree').getByRole('treeitem', { name, exact: true }).click();
  await expect(page.getByTestId('desk-card').filter({ hasText: name })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await page.keyboard.type(title);
  await expect(palette.locator('.vx-row').first()).toContainText(title);
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
}

const lines = (page: Page, kind: 'insert' | 'delete') =>
  page.getByTestId('history-diff').locator(`.vx-history__line[data-kind="${kind}"] .vx-history__text`);

test.describe(() => {
  test.skip(!hasGit, 'needs git');

  test('a note’s versions across a rename, compared two ways, and an undoable restore that leaves git alone', async () => {
    await openLibrary(true);
    const { page } = ctx;
    await openNote(page, 'Journal');
    await runCommand(page, 'Show Note History');
    await expect(page.getByTestId('desk-card').filter({ hasText: 'History: Journal' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The status bar shows the note's folders, not pieces of the item's id.
    await expect(page.getByRole('contentinfo')).toContainText('Notes');
    await expect(page.getByRole('contentinfo')).not.toContainText('S Study');
    const versions = page.getByTestId('history-version');
    await expect(versions.locator('.vx-history__subject')).toHaveText([
      'Add epsilon',
      'Rename the log',
      'Change beta, add delta',
      'Start the log',
    ]);
    await expect(versions.nth(0).locator('.vx-history__counts')).toHaveText('+1 −0');
    // The newest version is the note now.
    await expect(page.locator('.vx-history__note')).toHaveText('This version is the same as the note now.');

    // The first version, compared with now: what restoring it would change.
    await versions.nth(3).click();
    await expect(page.locator('.vx-history__legend')).toHaveText(
      '− only in the note now · + only in this version',
    );
    await expect(lines(page, 'delete')).toHaveText(['BETA changed', 'delta', 'epsilon']);
    await expect(lines(page, 'insert')).toHaveText(['beta']);

    // The version before the rename, by its own changes; its path then was Log.md.
    await versions.nth(2).click();
    await page.getByRole('button', { name: 'Changes in this version' }).click();
    await expect(lines(page, 'delete')).toHaveText(['beta']);
    await expect(lines(page, 'insert')).toHaveText(['BETA changed', 'delta']);
    await expect(page.locator('.vx-history__line[data-kind="insert"] .vx-history__word').first()).toHaveText(
      'BETA changed',
    );

    // Restore the first version: asked first, then written; git is not touched.
    await versions.nth(3).click();
    await page.getByRole('button', { name: 'Restore This Version' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Restore This Version' }).click();
    await expect(page.locator('.vx-history__note[role="status"]')).toContainText('Restored the version of');
    await expect.poll(() => readFile(file(`${NOTES}/Journal.md`), 'utf8')).toBe(V1);
    expect(git('log', '--format=%s').split('\n')).toHaveLength(4);
    // Only the note changed; git quotes paths with spaces.
    expect(git('status', '--porcelain')).toBe(`M "${NOTES}/Journal.md"`);
    // The history now has the change waiting to be committed.
    await expect(versions.first().locator('.vx-history__when')).toHaveText('Not committed yet');

    // Ctrl+Z in the note undoes the restore.
    await page
      .getByTestId('desk-card')
      .filter({ hasText: /^Journal/ })
      .click();
    await page.locator('.vx-editor .cm-content').click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => readFile(file(`${NOTES}/Journal.md`), 'utf8'), { timeout: 10_000 }).toBe(V4);
  });

  test('the history follows a rename in the app, and says when the library is not a repository', async () => {
    await openLibrary(false);
    const { page } = ctx;
    await openNote(page, 'Log');
    await runCommand(page, 'Show Note History');
    await expect(page.getByTestId('history-unavailable')).toContainText('not a git repository');
    // Renaming the note renames its history item with it.
    await page.getByTestId('tree').getByRole('treeitem', { name: 'Log', exact: true }).press('F2');
    await page.getByLabel('New name').fill('Diary');
    await page.getByLabel('New name').press('Enter');
    const dialog = page.getByTestId('rename-links');
    if (await dialog.isVisible().catch(() => false))
      await dialog.getByRole('button', { name: 'Update Links' }).click();
    await expect(page.getByTestId('desk-card').filter({ hasText: 'History: Diary' })).toHaveCount(1);
    await expect(page.getByTestId('desk-card').filter({ hasText: 'History: Log' })).toHaveCount(0);
  });
});
