import path from 'node:path';
import fumadocsMdx from 'fumadocs-mdx/vite';
import { defineConfig } from 'vitest/config';

// Phase A/B pure-unit tests: the evaluator and code-sample equivalence
// contracts. Neither imports the docs source or app aliases, but the shared
// `fumadocsMdx()` plugin and resolve aliases are mirrored here anyway so this
// config stays a drop-in sibling of [vitest.config.ts](./vitest.config.ts)
// rather than an accidental one-off.
export default defineConfig(async () => ({
  plugins: [...(await fumadocsMdx())],
  resolve: {
    alias: {
      '~': path.resolve(import.meta.dirname, './app'),
      collections: path.resolve(import.meta.dirname, './.source')
    }
  },
  test: {
    include: ['app/gate/evaluate.test.ts', 'app/gate/code-samples.test.ts'],
    // No server, no browser — these are pure functions over fixture data, so
    // no `globalSetup` is wired in here.
    globals: false,
    testTimeout: 30_000
  }
}));
