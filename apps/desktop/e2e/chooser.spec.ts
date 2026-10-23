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
  await expect(page.getByText('1 note elsewhere links to it by path')).toBeVisible();
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

test('pages past five Vaults with arrow keys and page dots', async () => {
  const { page } = ctx;
  await page.evaluate(async () => {
    const vx = (window as unknown as { vx: { vaults: { create(i: unknown): Promise<unknown> } } }).vx;
    for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta'])
      await vx.vaults.create({ name, domain: 'academic' });
  });
  await expect(header()).toHaveText('Academic·6Vaults');
  await expect(page.getByTestId('vault-card')).toHaveCount(5);
  await expect(page.getByRole('button', { name: /^Page \d of 2$/ })).toHaveCount(2);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Page 2 of 2' })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('vault-card')).toHaveCount(1);
  await expect(page.getByTestId('new-vault-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.getByTestId('vault-card')).toHaveCount(5);
});
