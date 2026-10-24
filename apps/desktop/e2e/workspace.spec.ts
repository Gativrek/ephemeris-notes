import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

test('Inbox: the rail badge counts captures; Move to… files a note into a section', async () => {
  const { page } = ctx;
  const inboxButton = page.getByRole('button', { name: 'Inbox', exact: true });
  await expect(inboxButton).toContainText('2');
  await inboxButton.click();
  const inbox = page.getByTestId('inbox');
  await expect(inbox.getByRole('listitem')).toHaveText([/reading/, /idea/]);
  await inbox.getByRole('listitem').filter({ hasText: 'reading' }).click();
  await expect(editor(page)).toContainText('Reading list');
  await inbox
    .getByRole('listitem')
    .filter({ hasText: 'idea' })
    .getByRole('button', { name: 'Move to…' })
    .click();
  await expect(page.getByTestId('move-to')).toBeVisible();
  await page.keyboard.type('GNSS Notes');
  await expect(page.getByTestId('move-to').locator('.vx-row').first()).toContainText(
    'GNSS Constellation Study / Notes',
  );
  await page.keyboard.press('Enter');
  await expect(inbox.getByRole('listitem')).toHaveCount(1);
  await expect(inboxButton).toContainText('1');
  expect(await readFile(file('Academic/GNSS Study/Notes/2026-10-20 081500 idea.md'), 'utf8')).toContain(
    'adaptive R',
  );
  await page.getByRole('button', { name: 'Back to the Vault' }).click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
});

test('outline styles: margin track, document map and tabbed inspector render the same note', async () => {
  const { page } = ctx;
  await openNote(page, 'Notes', 'Lecture 10');
  const outline = page.getByTestId('outline');
  if (!(await outline.isVisible())) await page.keyboard.press('ControlOrMeta+Shift+O');
  await expect(outline).toHaveAttribute('data-style', 'annotated');
  const setStyle = async (label: string) => {
    await page.keyboard.press('ControlOrMeta+,');
    await page.getByTestId('settings').getByRole('link', { name: 'Appearance', exact: true }).click();
    await page.getByRole('combobox', { name: 'Outline style' }).selectOption({ label });
    await page.keyboard.press('Escape');
  };
  await setStyle('Margin track');
  await expect(outline).toHaveAttribute('data-style', 'margin');
  const firstHeading = outline.locator('.vx-margin__heading').first();
  await expect(firstHeading).toBeVisible();
  await setStyle('Document map');
  await expect(outline).toHaveAttribute('data-style', 'map');
  await expect(outline.locator('.vx-map__section').first()).toBeVisible();
  await expect(page.getByTestId('map-frame')).toBeVisible();
  await setStyle('Tabbed inspector');
  await expect(outline).toHaveAttribute('data-style', 'inspector');
  await outline.getByRole('tab', { name: 'Info' }).click();
  await expect(outline).toContainText('Lines');
  await expect(outline).toContainText('Academic/GNSS Study/Notes/Lectures/Lecture 10.md');
  await outline.getByRole('tab', { name: 'Links' }).click();
  await expect(outline.getByRole('tabpanel')).toBeVisible();
});

test('Settings > Keyboard: a hotkey runs its command; taken keys are refused', async () => {
  const { page } = ctx;
  await page.keyboard.press('ControlOrMeta+,');
  await page.getByTestId('settings').getByRole('link', { name: 'Keyboard', exact: true }).click();
  const row = page.getByTestId('hotkey-core:open-note');
  await row.getByRole('button', { name: 'Set Shortcut' }).click();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('alert')).toContainText('is already used by Search');
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.getByRole('alert')).toContainText('is already used by the editor');
  await page.keyboard.press('l');
  await expect(page.getByRole('alert')).toContainText('Shortcuts need Ctrl, Cmd or Alt');
  await page.keyboard.press('ControlOrMeta+Shift+J');
  await expect(row).toContainText('+Shift+J');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+J');
  await expect(page.getByTestId('quick-open')).toBeVisible();
});

test('Settings > Library: git auto-commit commits the library when it is a repository', async () => {
  const { page } = ctx;
  await page.keyboard.press('ControlOrMeta+,');
  await page.getByTestId('settings').getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByTestId('settings-library')).toContainText('not a git repository');
  await expect(page.getByRole('checkbox', { name: 'Commit to git automatically' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // A repository with a local identity only; nothing global is touched.
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: lib, encoding: 'utf8', windowsHide: true });
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  await page.keyboard.press('ControlOrMeta+,');
  await page.getByTestId('settings').getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Commit to git automatically' }).check();
  await page.getByRole('button', { name: 'Commit Now' }).click();
  await expect(page.getByTestId('git-status')).toContainText(/Committed \d+ changes/);
  expect(git('log', '--format=%s').trim()).toMatch(/^Ephemeris: auto-commit \d{4}-/);
  await page.getByRole('button', { name: 'Commit Now' }).click();
  await expect(page.getByTestId('git-status')).toContainText('Nothing to commit.');
});

test('sections: New Section, Rename Section and Delete Section', async () => {
  const { page } = ctx;
  const exists = async (rel: string) => (await stat(file(rel)).catch(() => null))?.isDirectory() ?? false;

  // New Section refuses taken, hidden and empty names, then creates and selects the folder.
  await page.getByTestId('new-section').click();
  const dialog = page.getByTestId('section-name');
  const name = dialog.getByRole('textbox', { name: 'Section name' });
  await name.fill('notes');
  await name.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('already has a section with that name');
  await name.fill('_drafts');
  await name.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('cannot start with . or _');
  await name.fill('Projects');
  await name.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(tile(page, 'Projects')).toHaveAttribute('aria-pressed', 'true');
  expect(await exists('Academic/GNSS Study/Projects')).toBe(true);

  // Rename Section from the tile's menu.
  await contextChoice('rename');
  await tile(page, 'Projects').click({ button: 'right' });
  await expect(dialog.getByRole('textbox', { name: 'Section name' })).toHaveValue('Projects');
  await dialog.getByRole('textbox', { name: 'Section name' }).fill('Research');
  await dialog.getByRole('textbox', { name: 'Section name' }).press('Enter');
  await expect(tile(page, 'Research')).toBeVisible();
  await expect(tile(page, 'Projects')).toHaveCount(0);
  expect(await exists('Academic/GNSS Study/Research')).toBe(true);
  expect(await exists('Academic/GNSS Study/Projects')).toBe(false);

  // Delete Section asks first, says how many notes go, and uses the trash.
  await tile(page, 'Research').click();
  await page.keyboard.press('ControlOrMeta+n');
  await expect(page.getByTestId('tree').getByRole('treeitem')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await contextChoice('delete');
  await tile(page, 'Research').click({ button: 'right' });
  const confirm = page.getByRole('alertdialog', { name: 'Delete this section?' });
  await expect(confirm).toContainText('"Research" and its 1 note go to the system trash');
  await confirm.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(tile(page, 'Research')).toHaveCount(0);
  await expect.poll(() => exists('Academic/GNSS Study/Research')).toBe(false);

  // Unfiled (the Vault root) cannot be renamed or deleted.
  await contextChoice('delete');
  await tile(page, 'Unfiled').click({ button: 'right' });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(await exists('Academic/GNSS Study')).toBe(true);
});

test('Unfiled: New Unfiled Note from a tile or the palette, and Move to Unfiled', async () => {
  const { page } = ctx;
  const vault = 'Academic/GNSS Study';
  const isFile = async (rel: string) => (await stat(file(rel)).catch(() => null))?.isFile() ?? false;

  // From a section tile's menu: the note lands at the Vault root, Unfiled is selected.
  await contextChoice('unfiled');
  await tile(page, 'Notes').click({ button: 'right' });
  const input = page.getByLabel('New name');
  await expect(input).toBeFocused();
  await input.fill('Loose idea');
  await input.press('Enter');
  await expect.poll(() => isFile(`${vault}/Loose idea.md`)).toBe(true);
  await expect(tile(page, 'Unfiled')).toHaveAttribute('aria-pressed', 'true');

  // From the command palette.
  await page.keyboard.press('ControlOrMeta+p');
  await page.keyboard.type('New Unfiled Note');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('New name')).toBeFocused();
  await page.getByLabel('New name').fill('Second thought');
  await page.getByLabel('New name').press('Enter');
  await expect.poll(() => isFile(`${vault}/Second thought.md`)).toBe(true);

  // Move to Unfiled from a section; a clash gets a free name.
  await tile(page, 'Notes').click();
  await page.keyboard.press('ControlOrMeta+N');
  await page.getByLabel('New name').fill('Loose idea');
  await page.getByLabel('New name').press('Enter');
  await expect.poll(() => isFile(`${vault}/Notes/Loose idea.md`)).toBe(true);
  await contextChoice('unfiled');
  await row(page, 'Loose idea').first().click({ button: 'right' });
  await expect.poll(() => isFile(`${vault}/Loose idea 2.md`)).toBe(true);
  expect(await isFile(`${vault}/Notes/Loose idea.md`)).toBe(false);
  await expect(
    page.getByRole('status').filter({ hasText: 'Moved "Loose idea 2" to Unfiled.' }),
  ).toBeVisible();

  // Notes already at the root have no Move to Unfiled.
  await tile(page, 'Unfiled').click();
  await contextChoice('unfiled');
  await row(page, 'Second thought').first().click({ button: 'right' });
  const menus = await ctx.app.evaluate(
    () => (globalThis as { __vxContextMenus?: Array<Array<{ id: string }>> }).__vxContextMenus ?? [],
  );
  expect(menus[menus.length - 1]!.some((i) => i.id === 'unfiled')).toBe(false);
});

test('Move to…, section icons and the Vault banner', async () => {
  const { page } = ctx;
  const vault = 'Academic/GNSS Study';
  const vaultJson = async () => JSON.parse(await readFile(file(`${vault}/.vault/vault.json`), 'utf8'));
  const isFile = async (rel: string) => (await stat(file(rel)).catch(() => null))?.isFile() ?? false;

  // Move to…: a note goes into another section of the Vault.
  await tile(page, 'Notes').click();
  await page.keyboard.press('ControlOrMeta+N');
  await page.getByLabel('New name').fill('Wanderer');
  await page.getByLabel('New name').press('Enter');
  await expect.poll(() => isFile(`${vault}/Notes/Wanderer.md`)).toBe(true);
  await contextChoice('moveTo');
  await row(page, 'Wanderer').first().click({ button: 'right' });
  await expect(page.getByTestId('move-to')).toBeVisible();
  await page.keyboard.type('GNSS Papers');
  await expect(page.getByTestId('move-to').locator('.vx-row').first()).toContainText(
    'GNSS Constellation Study / Papers',
  );
  await page.keyboard.press('Enter');
  await expect.poll(() => isFile(`${vault}/Papers/Wanderer.md`)).toBe(true);
  expect(await isFile(`${vault}/Notes/Wanderer.md`)).toBe(false);

  // Change Icon…: stored in vault.json, and kept when the section is renamed.
  await page.getByTestId('new-section').click();
  await page.getByTestId('section-name').getByRole('textbox').fill('Drafts');
  await page.getByTestId('section-name').getByRole('textbox').press('Enter');
  await expect(tile(page, 'Drafts')).toBeVisible();
  await contextChoice('icon');
  await tile(page, 'Drafts').click({ button: 'right' });
  await expect(page.getByTestId('section-icon')).toBeVisible();
  await page.keyboard.type('Gyroscope');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await vaultJson()).sectionIcons).toEqual({ Drafts: 'gyro' });
  await contextChoice('rename');
  await tile(page, 'Drafts').click({ button: 'right' });
  await page.getByTestId('section-name').getByRole('textbox').fill('Sketches');
  await page.getByTestId('section-name').getByRole('textbox').press('Enter');
  await expect(tile(page, 'Sketches')).toBeVisible();
  await expect.poll(async () => (await vaultJson()).sectionIcons).toEqual({ Sketches: 'gyro' });
  // Back to Automatic clears the entry.
  await contextChoice('icon');
  await tile(page, 'Sketches').click({ button: 'right' });
  await page.keyboard.type('Automatic');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await vaultJson()).sectionIcons).toBeUndefined();

  // The banner: chosen from the header's menu, stored as .vault/banner.png.
  const header = page.getByTestId('vault-header');
  await expect(header.locator('.vx-vault-head__cover')).not.toHaveAttribute('data-banner', 'true');
  await contextChoice('banner');
  await header.click({ button: 'right' });
  const dialog = page.getByTestId('banner-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('banner-file').setInputFiles(file(`${vault}/_attachments/diagram.png`));
  await expect(dialog.getByTestId('banner-preview').locator('img')).toBeVisible();
  await dialog.getByRole('slider', { name: 'Zoom' }).fill('150');
  await dialog.getByRole('button', { name: 'Save Banner' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await vaultJson()).banner?.file).toBe('banner.png');
  expect((await vaultJson()).banner.zoom).toBe(1.5);
  expect(await isFile(`${vault}/.vault/banner.png`)).toBe(true);
  await expect(header.locator('.vx-vault-head__cover')).toHaveAttribute('data-banner', 'true');
  await expect(header.locator('.vx-vault-head__cover img')).toBeVisible();
  // Remove Banner: back to the cover.
  await contextChoice('remove');
  await header.click({ button: 'right' });
  await expect.poll(async () => (await vaultJson()).banner).toBeUndefined();
  await expect(header.locator('.vx-vault-head__cover')).not.toHaveAttribute('data-banner', 'true');
});

test('a full Desk scrolls sideways without a scrollbar squeezing its cards', async () => {
  const { page } = ctx;
  await tile(page, 'Encoding').click();
  for (const name of ['BOM', 'CRLF', 'Empty', 'LF', 'Mixed EOL', 'No trailing newline', 'Odd whitespace'])
    await page.getByTestId('tree').getByRole('treeitem', { name, exact: true }).click();
  await expect(page.getByTestId('desk-card')).toHaveCount(7);
  const desk = page.getByTestId('desk');
  await expect(desk).toHaveClass(/is-overflowing/);
  // No scrollbar: the inner height is the whole Desk less its 1px border.
  const gap = await desk.evaluate((el) => (el as HTMLElement).offsetHeight - el.clientHeight);
  expect(gap).toBeLessThanOrEqual(1);
  // Every card keeps its full height inside the Desk.
  const box = (await desk.boundingBox())!;
  for (const c of await page.getByTestId('desk-card').all()) {
    const b = (await c.boundingBox())!;
    expect(b.height).toBe(48);
    expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height);
  }
  // The newest (active) card was scrolled into view.
  const scroll = () => desk.evaluate((el) => el.scrollLeft);
  await expect.poll(scroll).toBeGreaterThan(0);
  // The wheel scrolls it back; a drag scrolls it and activates nothing.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -300);
  await expect.poll(scroll).toBe(0);
  const active = await page.locator('.vx-desk-card[aria-selected="true"]').getAttribute('data-path');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 400, y);
  await page.mouse.down();
  for (let x = 400; x > 100; x -= 50) await page.mouse.move(box.x + x, y);
  await page.mouse.up();
  await expect.poll(scroll).toBeGreaterThan(100);
  await expect(page.locator('.vx-desk-card[aria-selected="true"]')).toHaveAttribute('data-path', active!);
});

test('a long note never squeezes the Desk', async () => {
  const { page } = ctx;
  const long = Array.from({ length: 400 }, (_, i) => `Paragraph ${i + 1} of a long note.\n`).join('\n');
  await writeFile(file('Academic/GNSS Study/Encoding/LF.md'), long);
  await tile(page, 'Encoding').click();
  await page.getByTestId('tree').getByRole('treeitem', { name: 'LF', exact: true }).click();
  await expect(editor(page)).toContainText('Paragraph 1 of');
  const desk = page.getByTestId('desk');
  expect((await desk.boundingBox())!.height).toBe(64);
  expect((await page.getByTestId('desk-card').boundingBox())!.height).toBe(48);
  // The editor scrolls inside the window; the page itself does not grow.
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    await page.evaluate(() => window.innerHeight),
  );
});
