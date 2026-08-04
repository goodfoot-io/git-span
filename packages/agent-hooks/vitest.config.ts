import { defineConfig } from 'vitest/config';

function mdPlugin() {
  return {
    name: 'md-loader',
    transform(code: string, id: string) {
      if (id.endsWith('.md')) {
        return `export default ${JSON.stringify(code)};`;
      }
    }
  };
}

export default defineConfig({
  plugins: [mdPlugin()],
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    // The first test of the first file to run pays the cold ESM transform and
    // import of the full advisor-core module chain. Under the root `yarn
    // validate` harness — which runs the workspace suites concurrently with
    // git-span's cargo compile — that import alone has measured >11s, blowing
    // vitest's 5s default test timeout as a false failure. 30s keeps the
    // bound meaningful while absorbing harness-load cold-start.
    testTimeout: 30_000
  }
});
