import { expect, test } from '@playwright/test';
import { launch, type Launched } from './helpers';

/** SPECS 3.2, verbatim. Packaged builds and tests must use exactly this policy. */
const SPEC_CSP =
  "default-src 'self'; script-src 'self' vx-plugin:; style-src 'self' 'unsafe-inline' vx-plugin:; " +
  "img-src 'self' vx-asset: data: blob:; media-src vx-asset:; font-src 'self'; connect-src 'none'; " +
  "object-src 'none'; frame-src 'none'";

let ctx: Launched;
test.beforeAll(async () => {
  ctx = await launch();
});
test.afterAll(async () => {
  await ctx.close();
});

test('renderer runs isolated, sandboxed and without Node', async () => {
  const prefs = await ctx.app.evaluate(({ BrowserWindow }) => {
    // Missing from the typings, but present: the preferences the page was created with.
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
      getLastWebPreferences(): Electron.WebPreferences | null;
    };
    const p = wc.getLastWebPreferences();
    return {
      contextIsolation: p?.contextIsolation,
      sandbox: p?.sandbox,
      nodeIntegration: p?.nodeIntegration,
      webSecurity: p?.webSecurity,
      allowRunningInsecureContent: p?.allowRunningInsecureContent,
      webviewTag: p?.webviewTag,
    };
  });
  expect(prefs).toEqual({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  });
  const globals = await ctx.page.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    module: typeof (globalThis as { module?: unknown }).module,
  }));
  expect(globals).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined' });
});

test('the page is served from vx-app with the exact CSP header', async () => {
  expect(ctx.page.url()).toBe('vx-app://app/index.html');
  const header = await ctx.app.evaluate(async ({ net }) => {
    const res = await net.fetch('vx-app://app/index.html');
    return res.headers.get('content-security-policy');
  });
  expect(header).toBe(SPEC_CSP);
  // No dev-only relaxation reaches a test run.
  expect(header).not.toContain('unsafe-eval');
  expect(header).not.toContain("script-src 'self' 'unsafe-inline'");
  const enforced = await ctx.page.evaluate(async () => {
    const s = document.createElement('script');
    s.textContent = 'window.__vxInline = 1';
    document.head.appendChild(s);
    await new Promise((r) => setTimeout(r, 100));
    let fn = 'allowed';
    try {
      new Function('return 1')();
    } catch {
      fn = 'blocked';
    }
    let net = 'allowed';
    try {
      await fetch('vx-app://app/index.html');
    } catch {
      net = 'blocked';
    }
    return { inline: (window as { __vxInline?: number }).__vxInline ?? 'blocked', fn, net };
  });
  expect(enforced).toEqual({ inline: 'blocked', fn: 'blocked', net: 'blocked' });
});

test('the bridge is one frozen object', async () => {
  const info = await ctx.page.evaluate(() => {
    const vx = (window as unknown as { vx: Record<string, unknown> }).vx;
    return {
      frozen: Object.isFrozen(vx) && Object.isFrozen(vx.fs),
      namespaces: Object.keys(vx).sort(),
    };
  });
  expect(info.frozen).toBe(true);
  expect(info.namespaces).toEqual([
    'events',
    'fs',
    'index',
    'library',
    'notes',
    'settings',
    'shell',
    'ui',
    'vaults',
    'window',
  ]);
});

test('navigation and new windows are refused', async () => {
  await ctx.page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await ctx.page.waitForTimeout(300);
  expect(ctx.page.url()).toBe('vx-app://app/index.html');
  const opened = await ctx.page.evaluate(() => window.open('https://example.com/') === null);
  expect(opened).toBe(true);
  const windows = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  expect(windows).toBe(1);
});

test('external links open only for http(s)', async () => {
  // Test mode records external opens instead of starting the system browser.
  const results = await ctx.page.evaluate(async () => {
    const vx = (window as unknown as { vx: { shell: { openExternal(u: string): Promise<{ ok: boolean }> } } })
      .vx;
    const a = await vx.shell.openExternal('file:///etc/passwd');
    const b = await vx.shell.openExternal('javascript:alert(1)');
    const c = await vx.shell.openExternal('https://example.com/');
    return [a.ok, b.ok, c.ok];
  });
  expect(results).toEqual([false, false, true]);
  const calls = await ctx.app.evaluate(
    () => (globalThis as { __vxTest?: { external: string[] } }).__vxTest?.external,
  );
  expect(calls).toEqual(['https://example.com/']);
});

test('bridge arguments are validated in main', async () => {
  const results = await ctx.page.evaluate(async () => {
    const vx = (
      window as unknown as {
        vx: { fs: Record<string, (...a: unknown[]) => Promise<{ ok: boolean; error?: { code: string } }>> };
      }
    ).vx;
    return Promise.all([vx.fs.read!('../etc/passwd'), vx.fs.read!(42), vx.fs.list!('')]);
  });
  // No library is open yet, so even valid calls fail cleanly; nothing throws across the bridge.
  for (const r of results) expect(r.ok).toBe(false);
});
