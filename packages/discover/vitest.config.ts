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
    reporters: ['dot']
  }
});
