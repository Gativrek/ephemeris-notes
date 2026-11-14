/** Cross-note equation references (SPECS 10.4.1): [[Note#eq:label]] and ![[Note#eq:label]]. */
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fixtureLibrary, launch, setPickFolder, tempDir, type Launched } from './helpers';

let ctx: Launched;
let lib: string;

const CONCEPTS = 'Academic/Knowledge/Concepts';
const file = (rel: string) => path.join(lib, ...rel.split('/'));

test.beforeEach(async () => {
  const dir = await tempDir('eqrefs');
  lib = path.join(dir, 'library');
  await cp(fixtureLibrary, lib, { recursive: true });
  await writeFile(
    file(`${CONCEPTS}/Derivation.md`),
    [
      '# Derivation',
      '',
      'The gain is [[Kalman Filter#eq:kf-gain]], not [[Kalman Filter#eq:nope]].',
      '',
      '![[Kalman Filter#eq:kf-update]]',
      '',
      'Also written [[Kalman Filter#eq:kf-gain|the gain]].',
      '',
    ].join('\n'),
  );
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
const ref = (page: Page, text: string) => editor(page).locator('.vx-cm-link', { hasText: text });

test("references and embeds show the other note's numbers, follow its edits, and click through", async () => {
  const { page } = ctx;
  await page.keyboard.press('Enter'); // Knowledge
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Derivation' }).click();

  // "Kalman Filter, Eq. (3)": the fixture numbers kf-predict 1, an unlabeled one 2, kf-gain 3, kf-update 4.
  await expect(ref(page, 'Kalman Filter, Eq. (3)')).toBeVisible();
  await expect(ref(page, 'Kalman Filter, Eq. (?)')).toHaveClass(/vx-cm-link--missing/);
  await expect(ref(page, 'the gain')).toBeVisible();
  const embed = editor(page).locator('.vx-embed--eq');
  await expect(embed.locator('.vx-math__num')).toHaveText('(4)');
  await expect(embed.locator('.vx-embed__bar')).toHaveText('Kalman Filter');
  await expect(embed.locator('.katex')).toBeVisible();

  // Hover shows the equation with its number.
  await ref(page, 'Kalman Filter, Eq. (3)').hover();
  await expect(page.locator('.vx-preview-card--eq .vx-math__num')).toHaveText('(3)');
  await page.mouse.move(0, 0);

  // A new labeled equation at the top of Kalman Filter renumbers both.
  const kalman = `${CONCEPTS}/Kalman Filter.md`;
  const text = await readFile(file(kalman), 'utf8');
  // (A replacer function: in a replacement string `$$` means one `$`.)
  await writeFile(
    file(kalman),
    text.replace('\n\n', () => '\n\n$$ a = b $$ {#eq:first}\n\n'),
  );
  await expect(ref(page, 'Kalman Filter, Eq. (4)')).toBeVisible();
  await expect(embed.locator('.vx-math__num')).toHaveText('(5)');

  // Completion after [[Note#eq: lists only that note's equations.
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('See [[Kalman Filter#eq:kf-up');
  const options = page.locator('.cm-tooltip-autocomplete li');
  await expect(options.first()).toContainText('eq:kf-update');
  await expect(options.filter({ hasText: 'Gain and update' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(editor(page)).toContainText('See [[Kalman Filter#eq:kf-update]]');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');

  // Click: opens the note and flashes the equation.
  await ref(page, 'Kalman Filter, Eq. (4)').click();
  await expect(editor(page)).toContainText('Gain and update');
  await expect(editor(page).locator('.vx-math.is-flash')).toHaveCount(1);
  await expect(editor(page).locator('.vx-math.is-flash .vx-math__num')).toHaveText('(4)');

  // Renaming the note through the app keeps the references working.
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Kalman Filter' }).press('F2');
  await page.getByLabel('New name').fill('Kalman');
  await page.getByLabel('New name').press('Enter');
  await page.getByTestId('rename-links').getByRole('button', { name: 'Update Links' }).click();
  await expect
    .poll(() => readFile(file(`${CONCEPTS}/Derivation.md`), 'utf8'))
    .toContain('[[Kalman#eq:kf-gain]]');
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Derivation' }).click();
  await expect(ref(page, 'Kalman Filter, Eq. (4)').first()).toBeVisible();
  await expect(editor(page).locator('.vx-embed--eq .vx-math__num')).toHaveText('(5)');

  if (process.env.SHOTS)
    await page.locator('.vx-editor').screenshot({ path: path.join(process.env.SHOTS, 'eq-refs.png') });
});
