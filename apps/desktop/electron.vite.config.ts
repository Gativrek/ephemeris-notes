import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve(here, 'src/shared') } },
  },
  preload: {
    resolve: { alias: { '@shared': resolve(here, 'src/shared') } },
    build: {
      // Sandboxed preloads cannot be ES modules: emit one self-contained CommonJS file.
      rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve(here, 'src/shared'),
        '@design': resolve(repoRoot, 'design'),
      },
    },
    server: { fs: { allow: [repoRoot] } },
    plugins: [react()],
  },
});
