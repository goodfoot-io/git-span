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
    testTimeout: 30_000,
    // The snapshot store's write-time sweep reads every record in the shared
    // session base (~/.cache/git-span/session, on virtiofs), and its writes
    // are tmp+rename — a rename-over of the old inode. On this fs, Node
    // aborts (uv_fs_close assertion) when a readFileSync lands on a file a
    // concurrent process is renaming over or unlinking, so two test files
    // exercising the store in parallel forks crash one another. The store-
    // bearing files (snapshot-store, both snapshot-lifecycle suites) must run
    // one at a time; fileParallelism: false serializes all files, which also
    // removes the cross-file maintenance races (orphan-index and activity
    // prunes) between them.
    fileParallelism: false
  }
});
