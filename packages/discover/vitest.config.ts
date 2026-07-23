import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    // Fixture repos are real git checkouts built at test time (see
    // test/fixtures/build-fixture-repos.ts) — give history-walking tests
    // enough headroom rather than racing the default timeout.
    testTimeout: 15000
  }
});
