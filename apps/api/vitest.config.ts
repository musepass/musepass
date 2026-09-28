import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Tests run against the source so a stale dist can never make them lie.
      '@musename/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
