/**
 * `vx.app`: read-only app resources. Only pdf.js CMaps and standard fonts, by plain
 * file name, from the folders the build ships (no paths, nothing writable).
 */
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fail } from '@shared/result';
import { handle, oneOf, str } from './ipc';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(bcmap|pfb|ttf)$/;

export function registerAppHandlers(rendererDir: string): void {
  const sub = { cmap: 'cmaps', font: 'standard_fonts' } as const;
  // Packaged and built: next to the renderer. Dev server: from node_modules.
  let devRoot: string | null = null;
  try {
    devRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  } catch {
    devRoot = null;
  }
  handle('app', 'pdfData', async (_e, kind, name) => {
    const k = oneOf(kind, 'kind', ['cmap', 'font'] as const);
    const n = str(name, 'name', 100);
    if (!NAME.test(n)) fail('INVALID_ARGUMENT', 'Unknown resource.');
    for (const base of [
      path.join(rendererDir, 'pdfjs', sub[k]),
      devRoot ? path.join(devRoot, sub[k]) : null,
    ]) {
      if (!base) continue;
      try {
        return new Uint8Array(await fs.readFile(path.join(base, n)));
      } catch {
        // Try the next location.
      }
    }
    fail('NOT_FOUND', 'Resource not found.');
  });
}
