import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Component tests import their siblings, and app code resolves the `~` alias
  // through vite.config.ts — vitest reads only this file, so the alias must be
  // mirrored here for colocated tests to resolve at all.
  resolve: {
    alias: {
      '~': path.resolve(import.meta.dirname, './app')
    }
  },
  test: {
    // jsdom for the whole package. Scoping the DOM per file via
    // @vitest-environment annotations would leave the default node environment
    // as a silent trap for component tests — a quieter replay of the same
    // fail-open include gap this suite's harness check guards against. The
    // engine tests are pure logic and pay only jsdom's setup cost.
    environment: 'jsdom',
    // `.tsx` tests colocated with components were silently never collected;
    // the include glob must cover both extensions.
    include: ['app/**/*.test.ts', 'app/**/*.test.tsx'],
    globals: false,
    // The first test of the first file to run pays the cold ESM transform and
    // import of the full website module chain. Under the root `yarn test`
    // harness — which runs the workspace suites concurrently with git-span's
    // cargo compile — that cold-start stretches: sibling packages measured
    // ~4.7s CPU (discover) and >11s (agent-hooks) against vitest's 5s default
    // test timeout, and a heavier load window erases the margin. 30s keeps
    // the bound meaningful while absorbing harness-load cold-start.
    testTimeout: 30_000
  }
});
