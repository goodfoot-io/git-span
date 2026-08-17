import path from 'node:path';
import fumadocsMdx from 'fumadocs-mdx/vite';
import { defineConfig } from 'vitest/config';

// Phase E's HTTP-level protocol suite, run against the real built Worker
// booted by [globalSetup.ts](./app/gate/globalSetup.ts). Deterministic and
// local, but not hermetic in the `yarn test` sense — kept on its own budget
// and out of the default suite via `vitest.config.ts`'s `exclude`.
export default defineConfig(async () => ({
  plugins: [...(await fumadocsMdx())],
  resolve: {
    alias: {
      '~': path.resolve(import.meta.dirname, './app'),
      collections: path.resolve(import.meta.dirname, './.source')
    }
  },
  test: {
    include: ['app/gate/protocol/**/*.test.ts'],
    globals: false,
    globalSetup: ['./app/gate/globalSetup.ts'],
    // One booted Worker is shared by every file in this suite; running files
    // and cases serially (rather than vitest's default parallel workers)
    // keeps requests against that single server deterministic.
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 90_000
  }
}));
