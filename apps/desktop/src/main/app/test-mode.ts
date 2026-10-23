/**
 * Test mode (`VX_TEST=1`, unpackaged builds only). Nothing a test does may reach the
 * user's desktop: no browser, no file manager, no OS trash, no visible window.
 * Side effects are recorded on `globalThis.__vxTest` for assertions.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { setExternalOpener } from './security';

export interface TestRecord {
  external: string[];
  revealed: string[];
  trashed: string[];
}

declare global {
  var __vxTest: TestRecord | undefined;
}

export function isTestMode(): boolean {
  return process.env.VX_TEST === '1' && !app.isPackaged;
}

export function installTestMode(userData: string) {
  const record: TestRecord = { external: [], revealed: [], trashed: [] };
  globalThis.__vxTest = record;
  setExternalOpener(async (url) => {
    record.external.push(url);
  });
  const trashDir = path.join(userData, 'test-trash');
  return {
    reveal(abs: string) {
      record.revealed.push(abs);
    },
    async trash(abs: string) {
      await fs.mkdir(trashDir, { recursive: true });
      const dest = path.join(trashDir, `${Date.now()}-${record.trashed.length}-${path.basename(abs)}`);
      await fs.rename(abs, dest);
      record.trashed.push(abs);
    },
  };
}
