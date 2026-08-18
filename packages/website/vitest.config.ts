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
    alias: [
      { find: '~', replacement: path.resolve(import.meta.dirname, './app') },
      { find: 'collections', replacement: path.resolve(import.meta.dirname, './.source') },
      // The worker imports the server build through this virtual module at
      // module scope; no build emits it under vitest, so resolve it to a stub
      // that exists only for import resolution (see app/test/__stubs__).
      {
        find: 'virtual:react-router/server-build',
        replacement: path.resolve(import.meta.dirname, './app/test/__stubs__/server-build.ts')
      },
      // root.tsx preloads the font faces through vite's asset pipeline (`?url`
      // imports of fontsource package files, see app/root.tsx FONT_PRELOADS).
      // Under jsdom, vitest transforms assets and then denies the resolved
      // file: node_modules is a symlink farm whose realpaths (the hoisted
      // store) fall outside server.fs.allow. The URLs only feed the `links`
      // export no test reads, so the imports resolve to a stub (see
      // app/test/__stubs__/font-url.ts).
      {
        find: /^@fontsource(-variable)?\/[^/]+\/files\/[^/]+\.woff2\?url$/,
        replacement: path.resolve(import.meta.dirname, './app/test/__stubs__/font-url.ts')
      }
    ]
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
