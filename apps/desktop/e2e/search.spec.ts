import { cp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { analyzeNote, LinkCatalog, resolvesUniquelyInObsidian } from '@ephemeris-notes/markdown';
import { fixtureLibrary, launch, setPickFolder, tempDir, type Launched } from './helpers';

let ctx: Launched;
let lib: string;
const file = (rel: string) => path.join(lib, ...rel.split('/'));

async function openVault(page: Page, index: number) {
  for (let i = 0; i < index; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('workspace')).toBeVisible();
}

async function indexIdle(page: Page) {
  await expect
    .poll(
      async () =>
        page.evaluate(
          async () =>
            (
              await (
                window as unknown as { vx: { index: { status(): Promise<{ value: { state: string } }> } } }
              ).vx.index.status()
            ).value.state,
        ),
      {
        timeout: 15000,
      },
    )
    .toBe('idle');
}

test.beforeEach(async () => {
  const dir = await tempDir('search');
  lib = path.join(dir, 'library');
  await cp(fixtureLibrary, lib, { recursive: true });
  ctx = await launch();
  await setPickFolder(ctx.app, lib);
  await ctx.page.getByRole('button', { name: 'Open Library…' }).click();
  await expect(ctx.page.getByTestId('chooser')).toBeVisible();
  await indexIdle(ctx.page);
});

test.afterEach(async () => {
  await ctx.close();
  await rm(path.dirname(lib), { recursive: true, force: true });
});

const results = (page: Page) => page.getByTestId('search-result');

test('Ctrl+K searches the Vault, the Domain or All, folding diacritics', async () => {
  const { page } = ctx;
  await openVault(page, 1); // GNSS Constellation Study
  await page.keyboard.press('ControlOrMeta+K');
  await expect(page.getByTestId('search-input')).toBeFocused();
  await page.keyboard.type('index');
  await expect(results(page).first()).toBeVisible();
  const vaultTitles = await page.locator('.vx-result__title').allInnerTexts();
  expect(vaultTitles).toContain('GNSS Index');
  expect(vaultTitles).not.toContain('Specs Index');

  await page.getByRole('group', { name: 'Search scope' }).getByRole('button', { name: 'All' }).click();
  await page.getByTestId('search-input').click();
  await expect(page.locator('.vx-result__title', { hasText: 'Specs Index' })).toBeVisible();

  await page.getByTestId('search-input').fill('navegacao');
  await expect(page.locator('.vx-result__title').first()).toHaveText('Navegação inercial');
  await expect(page.locator('.vx-result__snippet mark').first()).toHaveText(/navegação/i);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('desk-card')).toHaveCount(1);
  await expect(page.getByTestId('search-results')).toHaveCount(0);
});

test('query syntax: phrases, exclusion, tag:, ext:, and Ctrl+Enter keeps the results open', async () => {
  const { page } = ctx;
  await openVault(page, 0); // Knowledge
  await page.getByRole('group', { name: 'Search scope' }).getByRole('button', { name: 'All' }).click();
  const input = page.getByTestId('search-input');
  await input.click();
  await input.fill('"base station"');
  await expect(page.locator('.vx-result__title')).toHaveText(['RTK vs PPP']);
  await input.fill('tag:#estimation');
  await expect(page.locator('.vx-result__title')).toHaveText(['Kalman Filter']);
  await input.fill('ext:pdf');
  await expect(page.locator('.vx-result__title')).toHaveText(['paper.pdf']);
  await input.fill('kalman -rtk');
  await expect(page.locator('.vx-result__title', { hasText: 'RTK vs PPP' })).toHaveCount(0);
  await input.fill('kalman');
  await expect(page.locator('.vx-result__title').first()).toHaveText('Kalman Filter');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('search-results')).toBeVisible();
  await expect(page.getByTestId('desk-card')).toHaveCount(1);
});

test('the outline lists backlinks from the index', async () => {
  const { page } = ctx;
  await openVault(page, 0);
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Kalman Filter' }).click();
  const outline = page.getByTestId('outline');
  // Below 1440px wide (small CI screens) the outline starts collapsed (SPECS 9.1).
  if (!(await outline.isVisible())) await page.keyboard.press('ControlOrMeta+Shift+O');
  await expect(outline.getByText('Linked from')).toBeVisible();
  for (const t of ['Intro', 'Navigation', 'RTK vs PPP', 'Old Obsidian note']) {
    await expect(outline.getByRole('link', { name: `← ${t}`, exact: true })).toBeVisible();
  }
});

test('renaming a note offers to update links, then rewrites them (Obsidian-compatible)', async () => {
  const { page } = ctx;
  await openVault(page, 0);
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Kalman Filter' }).press('F2');
  await page.getByLabel('New name').fill('Kalman Filtering');
  await page.getByLabel('New name').press('Enter');
  const dialog = page.getByTestId('rename-links');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('in 5 notes');
  await dialog.getByRole('button', { name: 'Update Links' }).click();
  await expect
    .poll(async () => readFile(file('Academic/GNSS Study/Notes/Intro.md'), 'utf8'))
    .toContain('[[Kalman Filtering#Gain and update]]');
  expect(await readFile(file('Academic/Knowledge/Concepts/RTK vs PPP.md'), 'utf8')).toContain(
    '[[Kalman Filtering|KF]]',
  );
  expect(await readFile(file('Work/Acme Robotics/Specs/Navigation.md'), 'utf8')).toContain(
    '[[Kalman Filtering]]',
  );
  expect((await stat(file('Academic/Knowledge/Concepts/Kalman Filtering.md'))).isFile()).toBe(true);

  // Every link the app rewrote resolves to the same file under Obsidian's rules.
  const all: string[] = [];
  const walk = async (dir: string, rel = '') => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else all.push(r);
    }
  };
  await walk(lib);
  const cat = new LinkCatalog(all);
  for (const note of [
    'Academic/GNSS Study/Notes/Intro.md',
    'Work/Acme Robotics/Specs/Navigation.md',
    'Academic/Knowledge/Concepts/RTK vs PPP.md',
  ]) {
    for (const l of analyzeNote(await readFile(file(note), 'utf8')).links) {
      if (cat.resolve(l.target, note).path !== 'Academic/Knowledge/Concepts/Kalman Filtering.md') continue;
      expect(resolvesUniquelyInObsidian(l.target, all), `${note}: [[${l.target}]]`).toBe(
        'Academic/Knowledge/Concepts/Kalman Filtering.md',
      );
    }
  }
});

test('Settings > Library finds ambiguous links and makes a Vault from a plain folder', async () => {
  const { page } = ctx;
  await openVault(page, 0);
  await page.keyboard.press('ControlOrMeta+,');
  await page.getByTestId('settings').getByRole('link', { name: 'Library' }).click();
  await expect(page.getByTestId('settings-library')).toBeVisible();
  await page.getByRole('button', { name: 'Find Ambiguous Links' }).click();
  await expect(page.getByTestId('ambiguous-list')).toContainText(
    '[[Index]] in Academic/GNSS Study/Notes/Intro',
  );
  await page.getByRole('button', { name: 'Make Vault' }).click();
  await expect
    .poll(
      async () =>
        (await stat(file('Academic/Old Course/.vault/vault.json')).catch(() => null))?.isFile() ?? false,
    )
    .toBe(true);
  await expect(page.getByTestId('settings-library')).toContainText('Archive');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings')).toHaveCount(0);
});
