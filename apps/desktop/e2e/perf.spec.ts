/**
 * SPECS 16 performance budgets on a generated 5,000-note library. Opt-in, because it
 * takes minutes: set VX_PERF=1. Results go to test-results/perf.json and the console;
 * PROGRESS records them.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makePerfLibrary, PERF_NOTES, type PerfLibrary } from '../test/make-perf-library';
import { appRoot, launch, setPickFolder, tempDir, type Launched } from './helpers';

test.skip(!process.env.VX_PERF, 'Set VX_PERF=1 to measure the SPECS 16 budgets.');
test.setTimeout(15 * 60_000);

let dir: string;
let lib: PerfLibrary;

test.beforeAll(async () => {
  test.setTimeout(10 * 60_000);
  dir = await tempDir('perf');
  lib = await makePerfLibrary(path.join(dir, 'library'));
});

test.afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN;
};
const round = (n: number) => Math.round(n * 10) / 10;

async function indexStatus(page: Page) {
  return page.evaluate(async () => {
    const r = await (
      window as unknown as {
        vx: {
          index: {
            status(): Promise<{ ok: boolean; value?: { state: string; done: number; total: number } }>;
          };
        };
      }
    ).vx.index.status();
    return r.ok ? r.value! : null;
  });
}

async function openVault(page: Page) {
  await expect(page.getByTestId('chooser')).toBeVisible();
  await page.getByTestId('vault-card').filter({ hasText: lib.vaultName }).dblclick();
  await expect(page.getByTestId('workspace')).toBeVisible();
}

test('SPECS 16 budgets on a 5,000-note library', async () => {
  const userData = await tempDir('perf-userdata');
  const results: Record<string, number> = {};
  let ctx: Launched | null = null;
  try {
    // ---- First run: open the library and build the index from nothing. -------------
    ctx = await launch({ userData });
    let page = ctx.page;
    await setPickFolder(ctx.app, lib.root);
    // Frame gaps while indexing show whether the UI stays responsive.
    await page.evaluate(() => {
      const w = window as unknown as { __gaps: number[]; __gapRun: boolean };
      w.__gaps = [];
      w.__gapRun = true;
      let last = performance.now();
      const tick = (t: number) => {
        w.__gaps.push(t - last);
        last = t;
        if (w.__gapRun) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    let seenFull = false;
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Open Library…' }).click();
    await expect(page.getByTestId('chooser')).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(
        async () => {
          const s = await indexStatus(page);
          // Idle after a pass that covered the whole library (later syncs report only changes).
          if (s && s.total >= PERF_NOTES) seenFull = true;
          return s && seenFull && s.state === 'idle' ? PERF_NOTES : 0;
        },
        { timeout: 300_000, intervals: [100] },
      )
      .toBeGreaterThanOrEqual(PERF_NOTES);
    results.fullIndexMs = Date.now() - t0;
    const gaps = await page.evaluate(() => {
      const w = window as unknown as { __gaps: number[]; __gapRun: boolean };
      w.__gapRun = false;
      return w.__gaps;
    });
    results.indexingFrameGapP95Ms = round(pct(gaps, 95));
    results.indexingFrameGapMaxMs = round(Math.max(...gaps));

    // Open the long note, so the next start restores it on the desk.
    await openVault(page);
    await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
    await page.getByTestId('tree').getByRole('treeitem', { name: 'Long note' }).first().click();
    const content = page.locator('.vx-editor .cm-content');
    await expect(content).toContainText('Long note');

    // ---- Keystroke to paint in a 5,000-line note. --------------------------------------
    await page.locator('.vx-editor .cm-line').nth(3).click();
    await page.evaluate(() => {
      const w = window as unknown as { __keys: Array<{ input: number; frame: number; total: number }> };
      w.__keys = [];
      window.addEventListener(
        'keydown',
        () => {
          const t0 = performance.now();
          let frameStart = 0;
          // Registered before the editor's measure callback, so it runs first in the frame.
          requestAnimationFrame(() => (frameStart = performance.now()));
          // The window sees `input` after the editor; this microtask runs after its DOM flush.
          window.addEventListener(
            'input',
            () =>
              queueMicrotask(() => {
                const inputEnd = performance.now();
                // Registered after the editor's measure, so it runs last in the same frame.
                requestAnimationFrame(() => {
                  const frameEnd = performance.now();
                  w.__keys.push({ input: inputEnd - t0, frame: frameEnd - frameStart, total: frameEnd - t0 });
                });
              }),
            { once: true },
          );
        },
        true,
      );
    });
    for (let i = 0; i < 120; i++) {
      await page.keyboard.type('a');
      await page.waitForTimeout(20);
    }
    const keys = await page.evaluate(
      () => (window as unknown as { __keys: Array<{ input: number; frame: number; total: number }> }).__keys,
    );
    // Work per keystroke: input handling plus the editor's frame work, without idle waits for vsync.
    const work = keys.map((k) => k.input + k.frame);
    results.keystrokeWorkP95Ms = round(pct(work, 95));
    results.keystrokeWorkP50Ms = round(pct(work, 50));
    results.keystrokeToPaintP95Ms = round(
      pct(
        keys.map((k) => k.total),
        95,
      ),
    );

    // ---- Incremental reindex after save. ----------------------------------------------
    const word = 'zqxperfmarker';
    await page.keyboard.type(` ${word}`);
    await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 10_000 });
    results.reindexAfterSaveMs = round(
      await page.evaluate(async (w) => {
        const vx = (
          window as unknown as {
            vx: {
              index: { search(q: string, s: { kind: 'all' }): Promise<{ ok: boolean; value?: unknown[] }> };
            };
          }
        ).vx;
        const t = performance.now();
        for (;;) {
          const r = await vx.index.search(w, { kind: 'all' });
          if (r.ok && (r.value?.length ?? 0) > 0) return performance.now() - t;
          if (performance.now() - t > 5000) return Infinity;
          await new Promise((res) => setTimeout(res, 5));
        }
      }, word),
    );

    // ---- Search, first results. ---------------------------------------------------------
    const searchTimes = await page.evaluate(async () => {
      const vx = (
        window as unknown as { vx: { index: { search(q: string, s: { kind: 'all' }): Promise<unknown> } } }
      ).vx;
      const queries = [
        'kalman',
        'satellite orbit',
        '"carrier phase"',
        'navegacao',
        'filter -noise',
        'tag:#topic7',
        'bode',
        'ruído medição',
        'Note 4321',
        'controller',
      ];
      const out: number[] = [];
      for (const q of queries) {
        const t = performance.now();
        await vx.index.search(q, { kind: 'all' });
        out.push(performance.now() - t);
      }
      return out;
    });
    results.searchP50Ms = round(pct(searchTimes, 50));
    results.searchMaxMs = round(Math.max(...searchTimes));

    // ---- Switch desk items. ------------------------------------------------------------
    await page.getByTestId('tree').getByRole('treeitem', { name: 'Note 0' }).first().click();
    await expect(content).toContainText('Note 0');
    const switches: number[] = [];
    for (let i = 0; i < 6; i++) {
      const target = i % 2 === 0 ? 'Long note' : 'Note 0';
      switches.push(
        await page.evaluate(async (name) => {
          const card = [...document.querySelectorAll<HTMLElement>('[data-testid="desk-card"]')].find((c) =>
            (c.textContent ?? '').includes(name),
          );
          if (!card) return Infinity;
          const t = performance.now();
          card.click();
          for (;;) {
            await new Promise((r) => requestAnimationFrame(r));
            const h = document.querySelector('.vx-editor .cm-content')?.textContent ?? '';
            if (h.includes(name === 'Long note' ? 'Long note' : 'Note 0')) return performance.now() - t;
            if (performance.now() - t > 5000) return Infinity;
          }
        }, target),
      );
    }
    results.deskSwitchP50Ms = round(pct(switches, 50));
    results.deskSwitchMaxMs = round(Math.max(...switches));
    await ctx.close();
    ctx = null;

    // ---- Cold start to the chooser, then open a Vault to an editable note. ------------------
    const starts: number[] = [];
    const rendererStarts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      ctx = await launch({ userData });
      page = ctx.page;
      await expect(page.getByTestId('chooser')).toBeVisible({ timeout: 30_000 });
      starts.push(Date.now() - t);
      // From the main process start to the chooser's first render (a performance mark).
      const mainStart = await ctx.app.evaluate(() => Date.now() - process.uptime() * 1000);
      const chooserAt = await page.evaluate(
        () => performance.timeOrigin + (performance.getEntriesByName('vx-chooser')[0]?.startTime ?? NaN),
      );
      rendererStarts.push(chooserAt - mainStart);
      if (i < 2) await ctx.close();
    }
    results.coldStartWallMedianMs = round(pct(starts, 50));
    results.coldStartMedianMs = round(pct(rendererStarts, 50));
    // Measured in the page: double-click the card, wait for the note's editor to paint.
    results.openVaultToEditableMs = round(
      await page.evaluate(async (name) => {
        const card = [...document.querySelectorAll<HTMLElement>('[data-testid="vault-card"]')].find((c) =>
          (c.textContent ?? '').includes(name),
        );
        if (!card) return Infinity;
        performance.clearMarks('vx-note-shown');
        const t = performance.now();
        (card.querySelector('button') ?? card).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        for (;;) {
          await new Promise((r) => requestAnimationFrame(r));
          const content = document.querySelector('.vx-editor .cm-content');
          if (
            performance.getEntriesByName('vx-note-shown').length &&
            content?.getAttribute('contenteditable') === 'true'
          )
            return performance.now() - t;
          if (performance.now() - t > 10_000) return Infinity;
        }
      }, lib.vaultName),
    );
    await ctx?.close();
  } finally {
    console.log('PERF', JSON.stringify(results, null, 2));
    await mkdir(path.join(appRoot, 'test-results'), { recursive: true });
    await writeFile(path.join(appRoot, 'test-results/perf.json'), JSON.stringify(results, null, 2));
    await ctx?.close().catch(() => undefined);
    await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(
      () => undefined,
    );
  }

  expect.soft(results.coldStartMedianMs, 'cold start').toBeLessThan(1500);
  expect.soft(results.openVaultToEditableMs, 'open a Vault').toBeLessThan(500);
  expect.soft(results.fullIndexMs, 'full index').toBeLessThan(20_000);
  expect.soft(results.reindexAfterSaveMs, 'incremental reindex').toBeLessThan(150);
  expect.soft(results.searchMaxMs, 'search').toBeLessThan(120);
  expect.soft(results.keystrokeWorkP95Ms, 'keystroke').toBeLessThan(16);
  expect.soft(results.deskSwitchMaxMs, 'desk switch').toBeLessThan(100);
});
