/**
 * The plugin contract test (SPECS 12.10): installs packages/sample-plugin into the app
 * on a fixture library and asserts every v1 service it exercises.
 */
import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { appRoot, fixtureLibrary, launch, setPickFolder, tempDir, type Launched } from './helpers';

const pluginRoot = path.resolve(appRoot, '../../packages/sample-plugin');
const pluginDist = path.join(pluginRoot, 'dist');

let ctx: Launched;
let lib: string;
const file = (rel: string) => path.join(lib, ...rel.split('/'));
const exists = async (p: string) => (await stat(p).catch(() => null))?.isFile() ?? false;

const NOTE = [
  '# Plugin test',
  '',
  '```sample-reverse file="Notes/Intro.md" mode=x',
  'abc',
  '```',
  '',
  '```sample-throw',
  'boom',
  '```',
  '',
  '```sample-reverse write-during-render',
  'xyz',
  '```',
  '',
  'End of note.',
  '',
].join('\n');

test.beforeAll(() => {
  execFileSync(process.execPath, [path.join(pluginRoot, 'build.mjs')], { stdio: 'ignore' });
});

test.beforeEach(async () => {
  const dir = await tempDir('plugins');
  lib = path.join(dir, 'library');
  await cp(fixtureLibrary, lib, { recursive: true });
  await writeFile(file('Academic/GNSS Study/Notes/Plugin Test.md'), NOTE);
  ctx = await launch();
  await setPickFolder(ctx.app, lib);
  await ctx.page.getByRole('button', { name: 'Open Library…' }).click();
  await expect(ctx.page.getByTestId('chooser')).toBeVisible();
  await ctx.page.keyboard.press('ArrowRight');
  await ctx.page.keyboard.press('Enter');
  await expect(ctx.page.getByTestId('workspace')).toBeVisible();
});

test.afterEach(async () => {
  await ctx.close();
  await rm(path.dirname(lib), { recursive: true, force: true });
});

const settingsLink = (page: Page, name: string) =>
  page.getByTestId('settings').getByRole('navigation').first().getByRole('link', { name, exact: true });

async function installAndEnable(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+,');
  await settingsLink(page, 'Plugins').click();
  await setPickFolder(ctx.app, pluginDist);
  await page.getByRole('button', { name: 'Install from Folder…' }).click();
  await expect(page.getByTestId('settings-plugins')).toContainText('Installed Sample Plugin.');
  await page.getByRole('checkbox', { name: 'Enable Sample Plugin' }).check();
  await expect(page.getByTestId('plugin-sample-plugin')).toContainText('Enabled');
}

async function openPluginNote(page: Page): Promise<void> {
  await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Plugin Test' }).first().click();
  await expect(page.locator('.vx-editor .cm-content')).toBeVisible();
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

test('settings: install, enable, fields, pane, plugin settings and library storage', async () => {
  const { page } = ctx;
  await installAndEnable(page);
  const card = page.getByTestId('plugin-sample-plugin');
  await expect(card).toContainText('Exercises every plugin API v1 service.');
  await expect(card.locator('.sample-plugin-pane')).toHaveText('Sample pane: Hello');

  const greeting = card.getByRole('textbox', { name: 'Greeting' });
  await greeting.fill('Hi');
  await greeting.press('Enter');
  await expect(card.locator('.sample-plugin-pane')).toHaveText('Sample pane: Hi');
  await card.getByRole('checkbox', { name: 'Shout' }).check();
  await expect(card.locator('.sample-plugin-pane')).toHaveText('Sample pane: HI');

  const settingsJson = file('.vaults/plugin-data/sample-plugin/settings.json');
  await expect
    .poll(async () => (await exists(settingsJson)) && JSON.parse(await readFile(settingsJson, 'utf8')))
    .toEqual({
      greeting: 'Hi',
      shout: true,
    });
  const state = JSON.parse(await readFile(file('.vaults/plugin-data/sample-plugin/state.json'), 'utf8'));
  expect(state).toEqual({ loads: 1 });

  // Help: the plugin's page is listed under its name and renders its block live.
  await settingsLink(page, 'Help').click();
  const help = page.getByTestId('settings-help');
  await expect(help).toContainText('Getting started');
  await expect(help).toContainText('Using with Obsidian');
  await help.getByRole('link', { name: 'Sample plugin guide' }).click();
  await expect(page.getByTestId('help-article').locator('.sample-plugin-output')).toHaveText('egap pleh');

  // Disabling removes its pages and settings.
  await settingsLink(page, 'Plugins').click();
  await page.getByRole('checkbox', { name: 'Enable Sample Plugin' }).uncheck();
  await expect(card).toContainText('Disabled');
  await expect(card.locator('.sample-plugin-pane')).toHaveCount(0);
  await settingsLink(page, 'Help').click();
  await expect(help.getByRole('link', { name: 'Sample plugin guide' })).toHaveCount(0);
});

test('blocks: render, args, vault files, error state, write-back with undo, storage and theme', async () => {
  const { page } = ctx;
  await installAndEnable(page);
  await page.keyboard.press('Escape');
  await openPluginNote(page);

  const blocks = page.locator('.vx-plugin-block');
  const first = blocks.filter({ has: page.locator('.sample-plugin-output', { hasText: 'cba' }) });
  await expect(first).toHaveCount(1);
  await expect(first.locator('.sample-plugin-args')).toHaveText(
    JSON.stringify({ positional: [], named: { file: 'Notes/Intro.md', mode: 'x' } }),
  );
  await expect(first.locator('.sample-plugin-note')).toHaveText(
    'Academic/GNSS Study/Notes/Plugin Test.md | Academic/GNSS Study | academic',
  );
  await expect(first.locator('.sample-plugin-file')).toHaveText('file: # Intro');

  // A renderer that throws gets the error state with the source and a Retry button.
  const failed = page.locator('.vx-plugin-block.is-error');
  await expect(failed).toContainText('boom');
  await expect(failed).toContainText('sample-plugin: Sample failure');
  await expect(failed.getByRole('button', { name: 'Retry' })).toBeVisible();

  // updateSource during render is refused and changes nothing.
  const third = blocks.filter({ has: page.locator('.sample-plugin-output', { hasText: 'zyx' }) });
  await expect(third.locator('.sample-plugin-status')).toHaveText('refused');

  // Write-back is one transaction in the editor's history.
  await first.getByRole('button', { name: 'Uppercase' }).click();
  await expect(page.locator('.sample-plugin-output').first()).toHaveText('CBA');
  await expect
    .poll(async () => readFile(file('Academic/GNSS Study/Notes/Plugin Test.md'), 'utf8'))
    .toContain('\nABC\n');
  await page.locator('.vx-editor .cm-line', { hasText: 'End of note.' }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.sample-plugin-output').first()).toHaveText('cba');

  // Vault and library storage.
  await page.locator('.sample-plugin-reverse').first().getByRole('button', { name: 'Save State' }).click();
  await expect(page.locator('.sample-plugin-status').first()).toHaveText(
    'saved Academic/GNSS Study/Notes/Plugin Test.md; loads 1',
  );
  expect(await exists(file('Academic/GNSS Study/.vault/plugin-data/sample-plugin/seen.json'))).toBe(true);

  // Theme token and theme changes.
  const theme = page.locator('.sample-plugin-theme').first();
  await expect(theme).toContainText('theme: light; ink: #');
  await page.keyboard.press('ControlOrMeta+,');
  await settingsLink(page, 'Appearance').click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(theme).toContainText('theme: dark; ink: #');

  // Disable: the blocks fall back to plain code.
  await page.keyboard.press('ControlOrMeta+,');
  await settingsLink(page, 'Plugins').click();
  await page.getByRole('checkbox', { name: 'Enable Sample Plugin' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.locator('.vx-plugin-block')).toHaveCount(0);
  await expect(page.locator('.vx-editor .cm-content')).toContainText('abc');
});

test('commands and overlays: palette, overlay title and dirty state, notify, a failing command', async () => {
  const { page } = ctx;
  await installAndEnable(page);
  await page.keyboard.press('Escape');

  await runCommand(page, 'Sample: Open Overlay');
  const overlay = page.getByTestId('plugin-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Sample overlay');
  await expect(overlay.locator('.sample-plugin-overlay-body')).toContainText('ink: #');
  await overlay.getByRole('button', { name: 'Make Dirty' }).click();
  await expect(overlay).toContainText('Sample overlay (edited)');
  await expect(overlay.getByLabel('Unsaved changes')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);

  await runCommand(page, 'Sample: Notify');
  await expect(
    page.getByRole('status').filter({ hasText: 'Sample Plugin: Hello from the sample plugin' }),
  ).toBeVisible();

  await runCommand(page, 'Sample: Failing Command');
  await expect(
    page.getByRole('status').filter({ hasText: 'Sample: Failing Command failed: Sample command failure' }),
  ).toBeVisible();

  // Core commands are in the palette too, and plugin commands leave with the plugin.
  await page.keyboard.press('ControlOrMeta+p');
  await page.keyboard.type('Insert Link');
  await expect(page.getByTestId('command-palette').locator('.vx-row').first()).toContainText('Insert Link');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+,');
  await settingsLink(page, 'Plugins').click();
  await page.getByRole('checkbox', { name: 'Enable Sample Plugin' }).uncheck();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+p');
  await page.keyboard.type('Sample:');
  await expect(page.getByTestId('command-palette')).toContainText('No matching commands.');
});

test('an enabled plugin loads again on the next start, after the first paint', async () => {
  await ctx.close();
  const userData = await tempDir('plugins-restart');
  const openVault = async () => {
    await expect(ctx.page.getByTestId('chooser')).toBeVisible();
    await ctx.page.getByTestId('vault-card').filter({ hasText: 'GNSS Constellation Study' }).dblclick();
    await expect(ctx.page.getByTestId('workspace')).toBeVisible();
  };
  try {
    ctx = await launch({ userData });
    await setPickFolder(ctx.app, lib);
    await ctx.page.getByRole('button', { name: 'Open Library…' }).click();
    await openVault();
    await installAndEnable(ctx.page);
    await ctx.close();

    ctx = await launch({ userData });
    await openVault();
    await openPluginNote(ctx.page);
    await expect(ctx.page.locator('.sample-plugin-output').first()).toHaveText('cba');
    const state = JSON.parse(await readFile(file('.vaults/plugin-data/sample-plugin/state.json'), 'utf8'));
    expect(state).toEqual({ loads: 2 });
  } finally {
    await ctx.close();
    await rm(userData, { recursive: true, force: true });
    // afterEach closes ctx again; a second close is harmless.
  }
});
