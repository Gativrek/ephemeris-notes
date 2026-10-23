import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const appVersion = (JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')) as { version: string })
  .version;

/**
 * pdf.js loads its JPEG 2000 and JBIG2 decoders with `import()` from `wasmUrl`. We ship
 * the JavaScript fallbacks (no WebAssembly, so the CSP needs no `wasm-unsafe-eval`)
 * under `pdfjs/` with their original names.
 */
function pdfjsDecoders(): Plugin {
  const root = resolve(here, 'node_modules/pdfjs-dist');
  const dir = join(root, 'wasm');
  const files = ['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js'];
  return {
    name: 'vx-pdfjs-decoders',
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (req, res, next) => {
        const f = (req.url ?? '').replace(/^\//, '').split('?')[0] ?? '';
        if (!files.includes(f)) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(join(dir, f)));
      });
    },
    generateBundle() {
      for (const f of files)
        this.emitFile({ type: 'asset', fileName: `pdfjs/${f}`, source: readFileSync(join(dir, f)) });
      // CMaps and standard fonts are read by main for the renderer (no fetch under the CSP).
      for (const sub of ['cmaps', 'standard_fonts']) {
        for (const f of readdirSync(join(root, sub))) {
          if (/\.(bcmap|pfb|ttf)$/.test(f))
            this.emitFile({
              type: 'asset',
              fileName: `pdfjs/${sub}/${f}`,
              source: readFileSync(join(root, sub, f)),
            });
        }
      }
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve(here, 'src/shared') } },
    // The workspace package ships TypeScript sources: bundle it instead of requiring it.
    build: { externalizeDeps: { exclude: ['@vaults/markdown', '@vaults/plugin-api'] } },
  },
  preload: {
    resolve: { alias: { '@shared': resolve(here, 'src/shared') } },
    build: {
      // Sandboxed preloads cannot be ES modules: emit one self-contained CommonJS file.
      rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    resolve: {
      alias: {
        '@shared': resolve(here, 'src/shared'),
        '@design': resolve(repoRoot, 'design'),
      },
    },
    server: { fs: { allow: [repoRoot] } },
    plugins: [react(), pdfjsDecoders()],
  },
});
