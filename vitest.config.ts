import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./apps/desktop/src/shared', import.meta.url)),
    },
  },
  test: {
    include: [
      'apps/*/src/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 20_000,
  },
});
