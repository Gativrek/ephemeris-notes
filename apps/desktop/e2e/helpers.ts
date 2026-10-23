import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = path.resolve(here, '..');
export const fixtureLibrary = path.join(appRoot, 'test/fixtures/library');

export interface Launched {
  app: ElectronApplication;
  page: Page;
  userData: string;
  close(): Promise<void>;
}

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `vx-e2e-${prefix}-`));
}

/** Launches the built app with its own user-data folder. */
export async function launch(
  opts: { userData?: string; env?: Record<string, string> } = {},
): Promise<Launched> {
  const userData = opts.userData ?? (await tempDir('userdata'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RENDERER_URL') env[k] = v;
  const app = await electron.launch({
    args: [path.join(appRoot, 'out/main/index.js')],
    cwd: appRoot,
    env: { ...env, VX_TEST: '1', VX_USER_DATA: userData, ...opts.env },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return {
    app,
    page,
    userData,
    async close() {
      await app.close();
      if (!opts.userData) await rm(userData, { recursive: true, force: true });
    },
  };
}

/** Makes the next folder dialogs return `folder` without showing anything. */
export async function setPickFolder(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate((_electron, f) => {
    (globalThis as { __vxPickFolder?: string }).__vxPickFolder = f;
  }, folder);
}
