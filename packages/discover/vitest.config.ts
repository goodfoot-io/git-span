/**
 * Configures vitest for the discover package: plain Node environment, tests
 * under `test/**`, compact dot reporter.
 *
 * @summary Vitest configuration for @cards.management/discover.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    reporters: ['dot'],
    // The first test of the first file to run pays the cold ESM transform and
    // import of the full discover module chain. Under the root `yarn test`
    // harness — which runs the workspace suites concurrently with git-span's
    // cargo compile — that import alone has measured >11s under load, blowing
    // vitest's 5s default test timeout as a false failure. 30s keeps the
    // bound meaningful while absorbing harness-load cold-start.
    testTimeout: 30_000
  }
});
