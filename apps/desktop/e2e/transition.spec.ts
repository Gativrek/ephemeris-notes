/** The cover flight between the chooser and the workspace (SPECS 7). */
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fixtureLibrary, launch, setPickFolder, tempDir, type Launched } from './helpers';

let ctx: Launched;
let lib: string;

test.beforeEach(async () => {
  const dir = await tempDir('transition');
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

const card = (page: Page) => page.getByTestId('vault-card').filter({ hasText: 'GNSS Constellation Study' });
const flights = (page: Page) => page.locator('.vx-flight');
const coverShown = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).visibility);

test('opening a Vault flies its cover to the header, and the workspace takes clicks at once', async () => {
  const { page } = ctx;
  await card(page).dblclick();
  // The workspace is there at once and usable under the flight.
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(flights(page)).toHaveCount(1);
  await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
  await expect(page.getByTestId('section-tile').filter({ hasText: 'Notes' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // It lands: the copies go, the header shows its own cover, one chooser at most.
  await expect(flights(page)).toHaveCount(0, { timeout: 2000 });
  await expect(page.locator('.vx-wash')).toHaveCount(0);
  expect(await coverShown(page, '[data-testid="vault-header"] .vx-vault-head__cover')).toBe('visible');
  await expect(page.getByTestId('chooser')).toHaveCount(0);

  // Back to the chooser: the header flies to its card.
  await page.keyboard.press('ControlOrMeta+o');
  await expect(page.getByTestId('chooser')).toBeVisible();
  await expect(flights(page)).toHaveCount(1);
  await expect(flights(page)).toHaveCount(0, { timeout: 2000 });
  expect(await coverShown(page, '.vx-card-slot.is-selected .vx-card__cover')).toBe('visible');
  await expect(page.getByTestId('workspace')).toHaveCount(0);
});

test('with reduced motion nothing flies; the screens only fade', async () => {
  const { page } = ctx;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let flew = false;
  await page.exposeFunction('__sawFlight', () => (flew = true));
  await page.evaluate(() => {
    new MutationObserver(() => {
      if (document.querySelector('.vx-flight, .vx-wash'))
        (window as unknown as { __sawFlight(): void }).__sawFlight();
    }).observe(document.body, { childList: true, subtree: true });
  });
  await card(page).dblclick();
  await expect(page.getByTestId('workspace')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+o');
  await expect(page.getByTestId('chooser')).toBeVisible();
  await page.waitForTimeout(600);
  expect(flew).toBe(false);
});
