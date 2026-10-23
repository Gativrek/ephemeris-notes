import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fixtureLibrary, launch, setPickFolder, tempDir, type Launched } from './helpers';

let ctx: Launched;
let lib: string;

test.beforeEach(async () => {
  const dir = await tempDir('mathpdf');
  lib = path.join(dir, 'library');
  await cp(fixtureLibrary, lib, { recursive: true });
  ctx = await launch();
  await setPickFolder(ctx.app, lib);
  await ctx.page.getByRole('button', { name: 'Open Library…' }).click();
  await expect(ctx.page.getByTestId('chooser')).toBeVisible();
});

test.afterEach(async () => {
  await ctx.close();
  await rm(path.dirname(lib), { recursive: true, force: true });
});

const editor = (page: Page) => page.locator('.vx-editor .cm-content');

async function openKalman(page: Page) {
  await page.keyboard.press('Enter'); // Knowledge
  await expect(page.getByTestId('workspace')).toBeVisible();
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Kalman Filter' }).click();
  await expect(editor(page)).toContainText('Gain and update');
}

async function setSetting(page: Page, key: string, value: unknown) {
  await page.evaluate(
    async ([k, v]) =>
      (
        window as unknown as { vx: { settings: { set(k: unknown, v: unknown): Promise<unknown> } } }
      ).vx.settings.set(k, v),
    [key, value] as const,
  );
}

test('equation references render with their numbers, follow the format and numbering settings', async () => {
  const { page } = ctx;
  await openKalman(page);
  const refs = editor(page).locator('.vx-eqref');
  await expect(refs).toHaveText(['Eq. (3)', 'Eq. (4)']);
  await expect(page.locator('.vx-math__num')).toHaveText(['(1)', '(2)', '(3)', '(4)']);

  await setSetting(page, 'math.referenceFormat', 'word');
  await expect(refs).toHaveText(['Equation 3', 'Equation 4']);
  await setSetting(page, 'math.numbering', 'labeled');
  // Labeled only: kf-predict (1), the unlabeled P update has no number, kf-gain (2), kf-update (3).
  await expect(refs).toHaveText(['Equation 2', 'Equation 3']);
  await expect(page.locator('.vx-math__num')).toHaveText(['(1)', '(2)', '(3)']);
});

test('clicking a reference scrolls to the equation and flashes it; unknown labels show Eq. (?)', async () => {
  const { page } = ctx;
  await openKalman(page);
  await editor(page).locator('.vx-eqref').first().click();
  await expect(page.locator('.vx-math.is-flash')).toHaveCount(1);
  await expect(page.locator('.vx-math.is-flash')).toHaveAttribute('data-label', 'eq:kf-gain');

  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n\nSee @eq:nope.');
  await page.keyboard.press('ControlOrMeta+Home');
  await expect(editor(page).locator('.vx-eqref.vx-cm-link--missing')).toHaveText('Eq. (?)');
});

test('@eq: autocomplete lists the note labels; a duplicate label warns', async () => {
  const { page } = ctx;
  await openKalman(page);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n\nSee @eq:kf');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('kf-gain');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('kf-update');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('$$ y = 1 $$ {#eq:kf-gain}');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Duplicate label eq:kf-gain')).toBeVisible();
});

test('PDFs open on the desk with pages, find, thumbnails, page links and embeds', async () => {
  const { page } = ctx;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); // GNSS Constellation Study
  await expect(page.getByTestId('workspace')).toBeVisible();
  await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Intro' }).click();
  // [[paper.pdf#page=2]] opens the viewer at page 2.
  await editor(page).locator('.vx-link--pdf').click();
  const viewer = page.getByTestId('pdf-viewer');
  await expect(viewer).toBeVisible();
  await expect(page.getByTestId('pdf-pages')).toHaveText('/ 3');
  await expect(page.getByTestId('pdf-page')).toHaveValue('2');
  await expect(viewer.locator('.textLayer').first()).toBeVisible();

  await viewer.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('pdf-page')).toHaveValue('3');
  await viewer.getByLabel('Find in document').fill('budget');
  await viewer.getByLabel('Find in document').press('Enter');
  await expect(viewer.getByText('1 of 1')).toBeVisible();
  await viewer.getByRole('button', { name: 'Thumbnails' }).click();
  await expect(viewer.locator('.vx-pdf-thumb')).toHaveCount(3);
  await expect(viewer.locator('.vx-pdf-thumb canvas')).toHaveCount(3);

  // An embedded page renders as an image with a link.
  await page.getByTestId('desk-card').first().click();
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('![[paper.pdf#page=3]]');
  await page.keyboard.press('ControlOrMeta+Home');
  await expect(page.locator('.vx-pdf-embed canvas')).toHaveCount(1);
});
