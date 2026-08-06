import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts'],
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
