/** PDF highlights (SPECS 10.8.1): links to passages, drawn over the pages, kept in a note. */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fixtureLibrary, launch, setPickFolder, tempDir, type Launched } from './helpers';

let ctx: Launched;
let lib: string;

const VAULT = 'Academic/GNSS Study';
const NOTE_PATH = `${VAULT}/Papers/carrier highlights.md`;

/** A small PDF: one page per list of lines, in Helvetica, each line its own text item. */
function makePdf(pages: string[][]): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, i) => {
    const content = `BT /F1 16 Tf 72 720 Td ${lines.map((l, k) => `${k ? '0 -24 Td ' : ''}(${esc(l)}) Tj`).join(' ')} ET`;
    objs[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test.beforeEach(async () => {
  const dir = await tempDir('pdfhl');
  lib = path.join(dir, 'library');
  await cp(fixtureLibrary, lib, { recursive: true });
  await writeFile(
    path.join(lib, VAULT, 'Papers', 'carrier.pdf'),
    makePdf([
      [
        'Carrier-phase measurements are ambigu-',
        'ous by an integer number of cycles.',
        'Cycle slips break them.',
      ],
      ['Second page: integer ambiguity resolution.', 'LAMBDA decorrelates the search space.'],
    ]),
  );
  await mkdir(path.join(lib, VAULT, 'Notes'), { recursive: true });
  // As Obsidian writes a link to a selection.
  await writeFile(
    path.join(lib, VAULT, 'Notes', 'Reading.md'),
    '# Reading\n\nFrom Obsidian: [[carrier.pdf#page=2&selection=0,0,0,6|second page]]\n',
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
const pageEl = (page: Page, n: number) => page.locator(`.vx-pdf-container .page[data-page-number="${n}"]`);

/** Selects text on a page from one text item's offset to another's, as a mouse would. */
async function select(page: Page, n: number, from: [number, number], to: [number, number]) {
  await expect(pageEl(page, n).locator('.textLayer span:not(.markedContent)').first()).toBeVisible();
  await page.evaluate(
    ([n, from, to]) => {
      const spans = [
        ...document.querySelectorAll<HTMLElement>(
          `.vx-pdf-container .page[data-page-number="${n}"] .textLayer span:not(.markedContent)`,
        ),
      ].filter((s) => s.textContent);
      const r = document.createRange();
      r.setStart(spans[from[0]]!.firstChild!, from[1]);
      r.setEnd(spans[to[0]]!.firstChild!, to[1]);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      const c = document.querySelector<HTMLElement>('.vx-pdf-container')!;
      c.focus();
      c.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    [n, from, to] as const,
  );
}

test('a selection becomes a highlight in the PDF highlights note, drawn, listed and removable', async () => {
  const { page, app } = ctx;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); // GNSS Constellation Study
  await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Reading' }).click();

  // An Obsidian selection link opens its page and flashes the passage, then stays drawn.
  await editor(page).locator('.vx-link--pdf').click();
  await expect(page.getByTestId('pdf-viewer')).toBeVisible();
  await expect(page.getByTestId('pdf-page')).toHaveValue('2');
  await expect(pageEl(page, 2).locator('.vx-pdf-hl.is-flash').first()).toBeAttached();
  await expect(pageEl(page, 2).locator('.vx-pdf-hl:not(.is-flash)')).toHaveCount(1);

  // Select across a hyphenated line break on page 1, and press H.
  await page.getByTestId('pdf-page').fill('1');
  await page.getByTestId('pdf-page').press('Enter');
  await select(page, 1, [0, 14], [1, 17]);
  await expect(page.getByTestId('pdf-selection-bar')).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.getByTestId('pdf-notice')).toContainText('Added to carrier highlights');
  await expect(page.getByTestId('pdf-selection-bar')).toHaveCount(0);
  const note = path.join(lib, ...NOTE_PATH.split('/'));
  await expect
    .poll(() => readFile(note, 'utf8').catch(() => ''))
    .toMatch(
      /^---\npdf: "\[\[carrier\.pdf\]\]"\n---\n\n# carrier highlights\n\n> measurements are ambiguous by an integer\n> — \[\[carrier\.pdf#page=1&selection=0,14,\d+,17\|p\. 1\]\]\n$/,
    );
  await expect(pageEl(page, 1).locator('.vx-pdf-hl:not(.is-flash)').first()).toBeVisible();

  // Hover names the note.
  const mark = (await pageEl(page, 1).locator('.vx-pdf-hl').first().boundingBox())!;
  await page.mouse.move(mark.x + mark.width / 2, mark.y + mark.height / 2);
  await expect(page.getByTestId('pdf-highlight-tip')).toHaveText('carrier highlights');

  // Copy Quote puts the same two lines on the clipboard and writes nothing.
  await select(page, 1, [0, 0], [0, 13]);
  await page.getByTestId('pdf-selection-bar').getByRole('button', { name: 'Copy Quote' }).click();
  await expect(page.getByTestId('pdf-notice')).toContainText('Copied 1 highlight');
  // Windows' clipboard hands text back with CRLF line endings.
  const clip = (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n');
  expect(clip).toBe('> Carrier-phase\n> — [[carrier.pdf#page=1&selection=0,0,0,13|p. 1]]\n');

  // The list: both highlights in page order, with the PDF's own text.
  await page.getByTestId('pdf-viewer').getByRole('button', { name: 'Highlights' }).click();
  const items = page.getByTestId('pdf-highlight-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('measurements are ambiguous by an integer');
  await expect(items.nth(0)).toContainText('p. 1 · carrier highlights');
  await expect(items.nth(1)).toContainText('Second');
  await expect(items.nth(1)).toContainText('p. 2 · Reading');

  // Only highlights in the highlights note can be removed from the list.
  await app.evaluate(() => {
    (globalThis as { __vxContextMenuChoice?: string }).__vxContextMenuChoice = 'remove';
  });
  await items.nth(1).click({ button: 'right' });
  await expect(items).toHaveCount(2);
  await app.evaluate(() => {
    (globalThis as { __vxContextMenuChoice?: string }).__vxContextMenuChoice = 'remove';
  });
  await items.nth(0).click({ button: 'right' });
  await expect(items).toHaveCount(1);
  await expect
    .poll(() => readFile(note, 'utf8'))
    .toBe('---\npdf: "[[carrier.pdf]]"\n---\n\n# carrier highlights\n\n');
  await expect(pageEl(page, 1).locator('.vx-pdf-hl')).toHaveCount(0);

  // Clicking a drawn highlight opens its note.
  await pageEl(page, 2).locator('.vx-pdf-hl').first().scrollIntoViewIfNeeded();
  const obs = (await pageEl(page, 2).locator('.vx-pdf-hl').first().boundingBox())!;
  await page.mouse.click(obs.x + obs.width / 2, obs.y + obs.height / 2);
  await expect(editor(page)).toContainText('From Obsidian');

  // The removal was one edit in the note's own history: Ctrl+Z there brings it back.
  await page.getByTestId('section-tile').filter({ hasText: 'Papers' }).click();
  await page.getByTestId('tree').getByRole('treeitem', { name: 'carrier highlights' }).click();
  await expect(editor(page)).toContainText('carrier highlights');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => readFile(note, 'utf8')).toContain('> measurements are ambiguous by an integer');

  if (process.env.SHOTS) {
    await page.getByTestId('desk-card').filter({ hasText: 'carrier' }).first().click();
    await expect(pageEl(page, 1).locator('.vx-pdf-hl').first()).toBeVisible();
    await page
      .getByTestId('pdf-viewer')
      .screenshot({ path: path.join(process.env.SHOTS, 'pdf-highlights.png') });
  }
});
