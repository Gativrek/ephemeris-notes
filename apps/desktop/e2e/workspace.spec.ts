import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fixtureLibrary, launch, setPickFolder, tempDir, type Launched } from './helpers';

let ctx: Launched;
let lib: string;
const file = (rel: string) => path.join(lib, ...rel.split('/'));

test.beforeEach(async () => {
  const dir = await tempDir('ws');
  lib = path.join(dir, 'library');
  await cp(fixtureLibrary, lib, { recursive: true });
  ctx = await launch();
  await setPickFolder(ctx.app, lib);
  await ctx.page.getByRole('button', { name: 'Open Library…' }).click();
  await expect(ctx.page.getByTestId('chooser')).toBeVisible();
  // GNSS Constellation Study is the second Academic card.
  await ctx.page.keyboard.press('ArrowRight');
  await ctx.page.keyboard.press('Enter');
  await expect(ctx.page.getByTestId('workspace')).toBeVisible();
});

test.afterEach(async () => {
  await ctx.close();
  await rm(path.dirname(lib), { recursive: true, force: true });
});

const tile = (page: Page, name: string) => page.getByTestId('section-tile').filter({ hasText: name });
const row = (page: Page, name: string) => page.getByTestId('tree').getByRole('treeitem', { name });
const editor = (page: Page) => page.locator('.vx-editor .cm-content');

async function openNote(page: Page, section: string, name: string) {
  await tile(page, section).click();
  await row(page, name).first().click();
  await expect(editor(page)).toBeVisible();
}

async function contextChoice(choice: string) {
  await ctx.app.evaluate((_e, c) => {
    (globalThis as { __vxContextMenuChoice?: string }).__vxContextMenuChoice = c;
  }, choice);
}

test('sidebar: Vault header, section tiles, Unfiled, daily tile and a natural-sorted tree', async () => {
  const { page } = ctx;
  await expect(page.getByTestId('vault-header')).toContainText('GNSS Constellation Study');
  await expect(page.getByTestId('section-tile')).toHaveText([
    /Data/,
    /Encoding/,
    /Notes/,
    /Papers/,
    /Daily/,
    /Unfiled/,
  ]);
  await tile(page, 'Notes').click();
  await expect(row(page, 'Lecture 10')).toBeVisible();
  const names = await page.getByTestId('tree').getByRole('treeitem').allInnerTexts();
  const flat = names.map((n) => n.split('\n')[0]!.trim());
  expect(flat.indexOf('Lecture 2')).toBeLessThan(flat.indexOf('Lecture 10'));
  // Deeper than two levels: flattened under the second level with its path as meta.
  await row(page, 'Deep').click();
  await expect(row(page, 'Third level')).toContainText('Deeper');
  await tile(page, 'Unfiled').click();
  await expect(row(page, 'Loose note')).toBeVisible();
  await tile(page, 'Daily').click();
  await expect(page.getByTestId('tree').locator('.vx-date')).toHaveCount(1);
  await tile(page, 'Papers').click();
  await expect(page.getByTestId('tree').locator('.vx-pdf')).toHaveCount(1);
});

test('live preview renders links, embeds and math; links open on the desk', async () => {
  const { page } = ctx;
  await openNote(page, 'Notes', 'Intro');
  const content = editor(page);
  await expect(content.locator('.vx-cm-link', { hasText: 'Kalman Filter' }).first()).toBeVisible();
  await expect(content.locator('.vx-cm-link--missing', { hasText: 'Missing Note' })).toBeVisible();
  await expect(content.locator('.vx-cm-link--ambiguous')).toHaveCount(1);
  await expect(content.locator('img.vx-embed-img')).toHaveCount(1);
  await expect(content.locator('.vx-link--pdf')).toHaveCount(1);
  // Raw HTML stays text.
  await expect(content).toContainText('<div>Raw HTML stays text.</div>');
  await content.locator('.vx-cm-link', { hasText: 'Kalman Filter' }).first().click();
  await expect(page.getByTestId('desk-card')).toHaveCount(2);
  await expect(page.getByTestId('desk-card').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.vx-math')).not.toHaveCount(0);
  await expect(page.locator('.vx-math__num').first()).toHaveText('(1)');
});

test('autosaves edits 800 ms after the last keystroke, keeping CRLF and BOM', async () => {
  const { page } = ctx;
  await openNote(page, 'Encoding', 'BOM');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('Added line.');
  await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 5000 });
  const bytes = await readFile(file('Academic/GNSS Study/Encoding/BOM.md'));
  expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
  expect(bytes.toString('utf8')).toContain('UTF-8 with BOM and CRLF.\r\nAdded line.');
  expect(bytes.toString('utf8')).not.toMatch(/[^\r]\n/);
});

test('an external change reloads a clean note in place, and conflicts show Keep Mine / Load Theirs', async () => {
  const { page } = ctx;
  await openNote(page, 'Notes', 'Index');
  await writeFile(file('Academic/GNSS Study/Notes/Index.md'), '# GNSS Index\n\nChanged outside.\n');
  await expect(editor(page)).toContainText('Changed outside.');

  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Mine.');
  // Before the autosave fires, another tool writes the file.
  await writeFile(file('Academic/GNSS Study/Notes/Index.md'), '# GNSS Index\n\nTheirs.\n');
  await expect(page.getByTestId('banner-changed')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Keep Mine' }).click();
  await expect(page.getByTestId('banner-changed')).toBeHidden();
  await expect
    .poll(async () => readFile(file('Academic/GNSS Study/Notes/Index.md'), 'utf8'))
    .toContain('Mine.');
});

test('a deleted open note offers Restore', async () => {
  const { page } = ctx;
  await openNote(page, 'Notes', 'Index');
  await rm(file('Academic/GNSS Study/Notes/Index.md'));
  await expect(page.getByTestId('banner-deleted')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect
    .poll(async () => readFile(file('Academic/GNSS Study/Notes/Index.md'), 'utf8').catch(() => ''))
    .toContain('GNSS Index');
});

test("today's daily note uses the Vault's Daily template", async () => {
  const { page } = ctx;
  await page.keyboard.press('ControlOrMeta+Shift+D');
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await expect
    .poll(async () => readFile(file(`Academic/GNSS Study/Daily/${iso}.md`), 'utf8').catch(() => ''))
    .toBe(`# ${iso}\n\nVault: GNSS Constellation Study (Academic)\n`);
  await expect(page.getByTestId('desk-card')).toHaveCount(1);
});

test('new note, inline rename, pin, close and trash', async () => {
  const { page } = ctx;
  await tile(page, 'Notes').click();
  await page.keyboard.press('ControlOrMeta+N');
  const input = page.getByLabel('New name');
  await expect(input).toBeFocused();
  await input.fill('Carrier smoothing');
  await input.press('Enter');
  await expect
    .poll(async () =>
      readFile(file('Academic/GNSS Study/Notes/Carrier smoothing.md'), 'utf8').catch(() => null),
    )
    .toBe('');
  await expect(page.getByTestId('desk-card')).toHaveCount(1);

  await contextChoice('pin');
  await page.getByTestId('desk-card').click({ button: 'right' });
  await expect(page.getByTestId('desk-pinned')).toHaveCount(1);
  await expect(page.getByTestId('desk-card')).toHaveCount(0);

  await row(page, 'Intro').click();
  await expect(page.getByTestId('desk-card')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+W');
  await expect(page.getByTestId('desk-card')).toHaveCount(0);

  await contextChoice('trash');
  await row(page, 'Carrier smoothing').click({ button: 'right' });
  await page.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(row(page, 'Carrier smoothing')).toHaveCount(0);
  await expect(page.getByTestId('desk-pinned')).toHaveCount(0);
  const trashed = await ctx.app.evaluate(
    () => (globalThis as { __vxTest?: { trashed: string[] } }).__vxTest?.trashed,
  );
  expect(trashed?.some((p) => p.endsWith('Carrier smoothing.md'))).toBe(true);
});

test('dropping a file copies it into _attachments and embeds it', async () => {
  const { page } = ctx;
  await openNote(page, 'Notes', 'Lecture 2');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.locator('.vx-editor .cm-content').evaluate((el) => {
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC'),
      (c) => c.charCodeAt(0),
    );
    const dt = new DataTransfer();
    dt.items.add(new File([png], 'diagram.png', { type: 'image/png' }));
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
        clientX: r.left + 10,
        clientY: r.bottom - 5,
      }),
    );
  });
  // diagram.png exists already, so the copy is "diagram 1.png".
  await expect
    .poll(
      async () =>
        (await readFile(file('Academic/GNSS Study/_attachments/diagram 1.png')).catch(() => null))?.length ??
        0,
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () => readFile(file('Academic/GNSS Study/Notes/Lectures/Lecture 2.md'), 'utf8'), {
      timeout: 5000,
    })
    .toContain('![[diagram 1.png]]');
});

test('new note from template and source mode', async () => {
  const { page } = ctx;
  await tile(page, 'Notes').click();
  await contextChoice('template');
  await row(page, 'Lectures').click({ button: 'right' });
  await expect(page.getByTestId('template-picker')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.getByLabel('New name').fill('Week 3');
  await page.getByLabel('New name').press('Enter');
  await expect
    .poll(async () => readFile(file('Academic/GNSS Study/Notes/Lectures/Week 3.md'), 'utf8').catch(() => ''))
    .toMatch(/^# \d{4}-\d{2}-\d{2}\n\nVault: GNSS Constellation Study \(Academic\)\n$/);
  await page.keyboard.press('ControlOrMeta+E');
  await expect(page.locator('.vx-editor.is-source')).toBeVisible();
});

test('wikilink autocomplete inserts the shortest unambiguous link', async () => {
  const { page } = ctx;
  await openNote(page, 'Notes', 'Lecture 10');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' [[Kalm');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Kalman Filter');
  // CodeMirror ignores Enter for 75 ms after the list opens (interactionDelay).
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await expect(editor(page)).toContainText('Kalman Filter');
  await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 5000 });
  expect(await readFile(file('Academic/GNSS Study/Notes/Lectures/Lecture 10.md'), 'utf8')).toContain(
    '[[Kalman Filter]]',
  );
});

test('the command palette runs core commands; Insert Link uses the shortest link', async () => {
  const { page } = ctx;
  await openNote(page, 'Notes', 'Lecture 10');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' see ');
  await page.keyboard.press('ControlOrMeta+p');
  await page.keyboard.type('insert link');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('insert-link')).toBeVisible();
  await page.keyboard.type('Kalman Filter');
  await expect(page.getByTestId('insert-link').locator('.vx-row').first()).toContainText('Kalman Filter');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 5000 });
  expect(await readFile(file('Academic/GNSS Study/Notes/Lectures/Lecture 10.md'), 'utf8')).toContain(
    'see [[Kalman Filter]]',
  );
  await page.keyboard.press('ControlOrMeta+p');
  await page.keyboard.type('toggle outline');
  await page.keyboard.press('Enter');
  await expect(page.locator('.vx-outline-wrap')).toHaveCount(0);
});

test('Settings > Editor applies font size and spell check; Help lists the core pages', async () => {
  const { page } = ctx;
  await openNote(page, 'Notes', 'Lecture 10');
  await page.keyboard.press('ControlOrMeta+,');
  await page.getByTestId('settings').getByRole('link', { name: 'Editor', exact: true }).click();
  const size = page.getByRole('spinbutton', { name: 'Font size' });
  await size.fill('22');
  await size.press('Enter');
  await page.getByRole('checkbox', { name: 'Spell check' }).uncheck();
  await page.getByTestId('settings').getByRole('link', { name: 'Help', exact: true }).click();
  const help = page.getByTestId('settings-help');
  for (const title of [
    'Getting started',
    'Markdown basics',
    'Links and embeds',
    'Math and equation references',
    'Search syntax',
    'Keyboard shortcuts',
    'Inbox contract',
    'Using with Obsidian',
  ])
    await expect(help.getByRole('link', { name: title })).toBeVisible();
  await help.getByRole('link', { name: 'Search syntax' }).click();
  await expect(page.getByTestId('help-article')).toContainText('notes with both words');
  await page.keyboard.press('Escape');
  await expect(page.locator('.vx-editor .cm-scroller')).toHaveCSS('font-size', '22px');
  await expect(editor(page)).toHaveAttribute('spellcheck', 'false');
});
