import { cp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fixtureLibrary, launch, setPickFolder, tempDir, type Launched } from './helpers';

let ctx: Launched;
let lib: string;

test.beforeEach(async () => {
  const dir = await tempDir('chooser');
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

const header = () => ctx.page.getByTestId('panel-header');
const band = () => ctx.page.getByTestId('domain-band');
const json = async (rel: string) =>
  JSON.parse(await readFile(path.join(lib, ...rel.split('/')), 'utf8')) as Record<string, unknown>;

test('shows Domains, Vault counts, the band and the empty state; [ and ] switch Domains', async () => {
  const { page } = ctx;
  await expect(header()).toHaveText('Academic·2Vaults');
  await expect(band()).toHaveText('Academic');
  await expect(page.getByTestId('vault-card')).toHaveCount(2);
  await expect(page.getByTestId('new-vault-card')).toHaveCount(1);
  await expect(page.getByTestId('chooser-stat')).toContainText('notes in this Domain');

  await page.keyboard.press(']');
  await expect(header()).toHaveText('Work·1Vault');
  await expect(band()).toHaveText('Work');
  await page.keyboard.press(']');
  await expect(header()).toHaveText('Personal·No Vaults yet');
  await expect(page.getByTestId('vault-card')).toHaveCount(0);
  await page.keyboard.press(']');
  await expect(band()).toHaveText('Academic');
  await page.keyboard.press('[');
  await expect(band()).toHaveText('Personal');
  await expect(page.getByRole('button', { name: 'Academic' })).toHaveAttribute('aria-pressed', 'false');
});

test('creates a Vault with a cover using only the keyboard after choosing the file', async () => {
  const { page } = ctx;
  await page.keyboard.press('[');
  await expect(band()).toHaveText('Personal');
  await page.keyboard.press('Enter'); // The New Vault card is the only, selected card.
  const dialog = page.getByRole('dialog', { name: 'New Vault' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Vault Name')).toBeFocused();
  await page.keyboard.type('Control Theory');
  await page.getByTestId('cover-file').setInputFiles(path.join(lib, 'Academic/GNSS Study/.vault/cover.png'));
  await expect(page.getByTestId('focus-picker')).toBeFocused();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Zoom')).toBeFocused();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('zoom-value')).toHaveText('120%');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  await expect(header()).toHaveText('Personal·1Vault');
  const raw = await json('Personal/Control Theory/.vault/vault.json');
  expect(raw).toMatchObject({ schema: 1, name: 'Control Theory', settings: { attachments: '_attachments' } });
  const cover = raw.cover as { file: string; focus: { x: number; y: number }; zoom: number };
  expect(cover.file).toBe('cover.png');
  expect(cover.focus.x).toBeCloseTo(0.6, 5);
  expect(cover.focus.y).toBeCloseTo(0.4, 5);
  expect(cover.zoom).toBeCloseTo(1.2, 5);
  expect((await stat(path.join(lib, 'Personal/Control Theory/.vault/cover.png'))).size).toBeGreaterThan(0);
  expect((await stat(path.join(lib, 'Personal/Control Theory/_attachments'))).isDirectory()).toBe(true);
});

test('edits a Vault with E, keeping unknown keys', async () => {
  const { page } = ctx;
  await page.keyboard.press(']');
  await expect(band()).toHaveText('Work');
  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'Edit Vault' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Vault Name')).toHaveValue('Acme Robotics');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Acme Navigation');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('vault-card').first()).toContainText('Acme Navigation');
  const raw = await json('Work/Acme Robotics/.vault/vault.json');
  expect(raw.name).toBe('Acme Navigation');
  expect(raw['x-custom']).toEqual({ keep: 'unknown keys survive writes' });
});

test('validates names: required, at most 60 characters, unique in the Domain', async () => {
  const { page } = ctx;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'New Vault' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Give the Vault a name.');
  await page.keyboard.type('knowledge');
  await expect(page.getByRole('alert')).toHaveText('A Vault with this name already exists in this Domain.');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('x'.repeat(61));
  await expect(page.getByRole('alert')).toHaveText('Use at most 60 characters.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('moves a Vault to another Domain after confirming, and deletes one with the typed name', async () => {
  const { page } = ctx;
  // Knowledge is first in Academic.
  await page.keyboard.press('e');
  await page.getByRole('dialog').getByRole('button', { name: 'Personal' }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Move this Vault to Personal?')).toBeVisible();
  await expect(page.getByText('1 note elsewhere links to it by path; those links are updated')).toBeVisible();
  await page.getByRole('button', { name: 'Move Vault' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(band()).toHaveText('Personal');
  expect(await readdir(path.join(lib, 'Personal'))).toContain('Knowledge');

  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Delete Vault…' }).click();
  const confirm = page.getByRole('button', { name: 'Delete Vault', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Vault name', { exact: true }).fill('Knowledge');
  await confirm.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(header()).toHaveText('Personal·No Vaults yet');
  const trashed = await ctx.app.evaluate(
    () => (globalThis as { __vxTest?: { trashed: string[] } }).__vxTest?.trashed,
  );
  expect(trashed?.some((p) => p.endsWith(path.join('Personal', 'Knowledge')))).toBe(true);
});

test('Enter opens the workspace; Ctrl+O returns to the chooser; Escape goes back', async () => {
  const { page } = ctx;
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('workspace')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+o');
  await expect(page.getByTestId('chooser')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workspace')).toBeVisible();
});

test('the card strip scrolls past five Vaults: keys, drag and wheel; a drag opens nothing', async () => {
  const { page } = ctx;
  await page.evaluate(async () => {
    const vx = (window as unknown as { vx: { vaults: { create(i: unknown): Promise<unknown> } } }).vx;
    for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
      await vx.vaults.create({ name, domain: 'academic' });
  });
  await expect(header()).toHaveText('Academic·7Vaults');
  // Every card is on the strip; it overflows, so the indicator shows.
  await expect(page.getByTestId('vault-card')).toHaveCount(7);
  await expect(page.getByTestId('new-vault-card')).toHaveCount(1);
  await expect(page.getByTestId('strip-indicator')).toBeVisible();
  const strip = page.getByTestId('card-strip');
  const scroll = () => strip.evaluate((el) => el.scrollLeft);
  expect(await scroll()).toBe(0);

  // The keyboard keeps the selection in view.
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(scroll).toBeGreaterThan(0);
  const box = await strip.boundingBox();
  await expect
    .poll(async () => {
      const last = await page.getByTestId('new-vault-card').boundingBox();
      return last!.x + last!.width <= box!.x + box!.width + 1;
    })
    .toBe(true);
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
  await expect.poll(scroll).toBe(0);

  // Drag to scroll: the strip moves and settles on a card; nothing opens.
  const y = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width - 200, y);
  await page.mouse.down();
  for (let x = box!.width - 200; x > 300; x -= 60) await page.mouse.move(box!.x + x, y);
  await page.mouse.up();
  await expect.poll(scroll).toBeGreaterThan(200);
  await page.waitForTimeout(600);
  expect((await scroll()) % 344).toBeLessThan(2);
  await expect(page.getByTestId('chooser')).toBeVisible();

  // The wheel scrolls it back.
  await page.mouse.move(box!.x + box!.width / 2, y);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -300);
  await expect.poll(scroll).toBe(0);
});

test('Arrange (R): arrow keys move a Vault, Enter saves the order to vault.json, Esc cancels', async () => {
  const { page } = ctx;
  const names = () => page.getByTestId('vault-card').locator('.vx-card__name').allInnerTexts();
  await expect.poll(names).toEqual(['Knowledge', 'GNSS Constellation Study']);

  // Esc cancels.
  await page.keyboard.press('r');
  await expect(header()).toContainText('Arranging');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(header()).toHaveText('Academic·2Vaults');
  await expect.poll(names).toEqual(['Knowledge', 'GNSS Constellation Study']);

  // Enter keeps the new order, shown at once and written to each vault.json.
  await page.keyboard.press('r');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(header()).toHaveText('Academic·2Vaults');
  await expect.poll(names).toEqual(['GNSS Constellation Study', 'Knowledge']);
  await expect.poll(async () => (await json('Academic/Knowledge/.vault/vault.json')).order).toBe(2);
  expect((await json('Academic/GNSS Study/.vault/vault.json')).order).toBe(1);
  // The moved Vault stays selected.
  await expect(page.locator('.vx-card-slot.is-selected .vx-card__name')).toHaveText('Knowledge');
});

test('Arrange: drag a card to a new place with the mouse', async () => {
  const { page } = ctx;
  const names = () => page.getByTestId('vault-card').locator('.vx-card__name').allInnerTexts();
  await page.keyboard.press('R');
  const cards = page.getByTestId('vault-card');
  const a = (await cards.nth(0).boundingBox())!;
  const b = (await cards.nth(1).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 10, a.y + a.height / 2);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(names).toEqual(['GNSS Constellation Study', 'Knowledge']);
  await expect.poll(async () => (await json('Academic/Knowledge/.vault/vault.json')).order).toBe(2);
  // Not arranging any more: a click selects and opens as before.
  await expect(header()).toHaveText('Academic·2Vaults');
});
