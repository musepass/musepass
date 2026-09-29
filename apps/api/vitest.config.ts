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
    // PGlite runs a real Postgres in WebAssembly, which is CPU heavy. Running
    // these files in parallel with each other, and alongside the other packages
    // in the monorepo, made the slower ones time out. Serial costs a few
    // seconds and removes a flaky failure.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
  },
});
