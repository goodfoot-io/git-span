import path from 'node:path';
import fumadocsMdx from 'fumadocs-mdx/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  // The docs source imports content through `?collection=docs`-quoted globs
  // that only [fumadocsMdx()](./vite.config.ts) teaches Vite how to load;
  // vitest reads only this file, so the plugin must be loaded here too.
  plugins: [...(await fumadocsMdx())],
  // Component tests import their siblings, and app code resolves the `~` and
  // `collections` aliases through vite.config.ts — vitest reads only this file,
  // so both aliases must be mirrored here for colocated tests to resolve at all.
  resolve: {
    alias: {
      '~': path.resolve(import.meta.dirname, './app'),
      collections: path.resolve(import.meta.dirname, './.source'),
      // The worker imports the server build through this virtual module at
      // module scope; no build emits it under vitest, so resolve it to a stub
      // that exists only for import resolution (see app/test/__stubs__).
      'virtual:react-router/server-build': path.resolve(import.meta.dirname, './app/test/__stubs__/server-build.ts')
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
    // Only the two gate suites that boot a real Worker (and, for the agentic
    // leg, a real browser) are excluded, so the hermetic default suite never
    // spawns a server. The gate's pure-unit contracts — evaluate.test.ts and
    // code-samples.test.ts — belong here: excluding the whole directory left
    // them running under no command at all.
    exclude: ['app/gate/protocol/**', 'app/gate/gate.agentic.test.ts'],
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
}));
