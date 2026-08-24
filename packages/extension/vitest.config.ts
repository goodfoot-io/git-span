/**
 * Configures vitest for the git-span extension's pure-unit tests under
 * `test/unit/` -- Node environment, mocked `vscode`, no Electron. The
 * Electron-driven mocha suite lives separately under `test/suite/` and is
 * deliberately NOT included here: those tests only run inside a real
 * extension host via `yarn test`.
 *
 * @summary Vitest configuration for the git-span extension unit suite.
 * @module vitest.config
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    globals: false,
    reporters: ['dot'],
    testTimeout: 30_000
  }
});
