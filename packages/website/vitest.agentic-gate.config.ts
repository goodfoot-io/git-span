import path from 'node:path';
import fumadocsMdx from 'fumadocs-mdx/vite';
import { defineConfig } from 'vitest/config';

// Phase F's live Lighthouse gate: one test, `runAgenticGate()`, against every
// target page over the real built Worker booted by
// [globalSetup.ts](./app/gate/globalSetup.ts). A full Lighthouse pass per
// target is slow, hence the 600s budget — well above the hermetic and
// protocol suites' timeouts.
export default defineConfig(async () => ({
  plugins: [...(await fumadocsMdx())],
  resolve: {
    alias: {
      '~': path.resolve(import.meta.dirname, './app'),
      collections: path.resolve(import.meta.dirname, './.source')
    }
  },
  test: {
    include: ['app/gate/gate.agentic.test.ts'],
    globals: false,
    globalSetup: ['./app/gate/globalSetup.ts'],
    maxWorkers: 1,
    testTimeout: 600_000
  }
}));
