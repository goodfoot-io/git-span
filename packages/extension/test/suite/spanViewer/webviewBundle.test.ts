/**
 * Regression reproduction for the span viewer's unbundled TypeScript worker.
 *
 * [main.ts](../../../src/spanViewer/webview/main.ts#L33) imports the full
 * `monaco-editor` package entry, which registers the TypeScript
 * language-service contribution at import time. That contribution installs
 * providers for the `typescript` and `javascript` language ids
 * (getNavigationTree, getSyntacticDiagnostics, provideInlayHints), so a
 * `.ts`/`.tsx`/`.js`/`.jsx` anchor resolves to the `typescript` language id
 * and fires worker round-trips the bundle's `editor.worker.js` cannot answer
 * — every request lands in Monaco's `$fmr` rejection, "Missing
 * requestHandler or method: getNavigationTree".
 *
 * These tests assert the fixed-state bundle property directly: the built
 * webview `main.js` must not carry the TypeScript language-service stack.
 * They read the unminified testing-build output (`{TEST_DIST}/webview/main.js`,
 * computed relative to this compiled file's directory) and fall back to an
 * inline esbuild bundle of the webview entry when no pre-built output exists.
 *
 * Threshold calibration against the unminified testing build (monaco-editor
 * 0.56, unfixed bundle 9,815,896 bytes):
 *
 * - `"typescript"` string instances: unfixed 7 — one editor-core tree-sitter
 *   scope map, two from the TypeScript basic-language definition, four from
 *   the language-service feature. The fixed bundle keeps the first three
 *   (highlighting stays Monarch; the definition still maps `.ts` to the
 *   `typescript` id) and drops the feature, landing at 3 — assert fewer
 *   than 5.
 * - `getNavigationTree`: present once in the unfixed bundle (it is the
 *   method named by the first console rejection), absent once the
 *   language-service contribution is dropped.
 * - bundle size: the editor API floor is ~5.2 MB and the JSON
 *   language-service feature (whose worker the viewer genuinely uses and
 *   keeps) carries the ~2.9 MB LSP client, so a fixed bundle measures
 *   ~6.8–9.7 MB — assert under 9,700,000 bytes. The unfixed full-package
 *   entry violates every bound.
 *
 * @summary Verifies the webview bundle excludes the TypeScript language-service contribution.
 * @module test/suite/spanViewer/webviewBundle.test
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildOptions } from 'esbuild';

/**
 * The exact language id the TypeScript contribution registers; the unminified
 * testing build emits string literals verbatim, so this is a stable marker.
 */
const TYPESCRIPT_LITERAL = '"typescript"';

/**
 * One of the foreign-method names rejected by the editor worker in the
 * reported console errors ("Missing requestHandler or method:
 * getNavigationTree"). Only the TypeScript language-service contribution
 * references it.
 */
const TS_WORKER_METHOD = 'getNavigationTree';

/**
 * Unfixed testing build carries 7 instances of the marker; the fixed bundle
 * keeps at most 3 (editor-core scope map + basic-language definition).
 */
const MAX_TYPESCRIPT_INSTANCES = 5;

/**
 * Unfixed testing build measures 9,815,896 bytes; every measured fixed shape
 * (editor API + Monarch definitions + the JSON feature) is below 9,700,000.
 */
const MAX_BUNDLE_BYTES = 9_700_000;

/**
 * Absolute path of this file: `__filename` in the compiled CJS harness
 * bundle, `import.meta.url` when the suite runs as ESM via tsx. The testing
 * build compiles suites to CJS, where esbuild blanks `import.meta`, so the
 * dual-mode form is required for both runs.
 */
const thisFile = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);

/**
 * Directory of this file: `{TEST_DIST}/test/suite/` in the harness (esbuild
 * compiles each suite into that flattened location), the source
 * `test/suite/spanViewer/` when run directly.
 */
const here = path.dirname(thisFile);

type EsbuildModule = typeof import('esbuild');

/**
 * Locate the webview's bundled `main.js`: the testing-build output
 * `{TEST_DIST}/webview/main.js` when present, otherwise an inline esbuild
 * bundle of the webview entry point.
 *
 * The result is memoized so the inline build (several seconds of bundling
 * Monaco) runs at most once per test process.
 *
 * @returns The bundle's absolute path and full text.
 * @throws Error with a clear message when neither a pre-built bundle nor a
 *   source entry can be found — a broken test setup must fail loudly.
 */
/** Memoized bundle result, so the inline esbuild build runs at most once per test process. */
let cachedBundle: { path: string; text: string } | undefined;

async function loadBundle(): Promise<{ path: string; text: string }> {
  if (cachedBundle) {
    return cachedBundle;
  }
  const distMainJs = path.resolve(here, '..', '..', 'webview', 'main.js');
  if (fs.existsSync(distMainJs)) {
    cachedBundle = { path: distMainJs, text: fs.readFileSync(distMainJs, 'utf8') };
    return cachedBundle;
  }
  const entry = findWebviewEntry();
  if (!entry) {
    throw new Error(
      `No webview bundle at ${distMainJs} and no src/spanViewer/webview/main.ts found when ` +
        `walking up from ${here}. Run the testing build ` +
        '(TEST_DIST_DIR=<dir> node scripts/build/build-testing.js) first.'
    );
  }
  const outfile = path.join(os.tmpdir(), `git-span-webview-bundle-${process.pid}.js`);
  const options: BuildOptions = {
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    loader: { '.ttf': 'file' },
    sourcemap: false,
    minify: false
  };
  const esbuild = createRequire(thisFile)('esbuild') as EsbuildModule;
  await esbuild.build(options);
  cachedBundle = { path: outfile, text: fs.readFileSync(outfile, 'utf8') };
  return cachedBundle;
}

/**
 * Walk up from this file's directory to the extension root that owns
 * `src/spanViewer/webview/main.ts` — the source entry for the inline
 * fallback build.
 *
 * @returns The absolute path to the webview entry, or `undefined` when the
 *   extension root cannot be located from this file's directory.
 */
function findWebviewEntry(): string | undefined {
  for (let dir = here, depth = 0; depth < 8; depth += 1, dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'src', 'spanViewer', 'webview', 'main.ts');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Count non-overlapping occurrences of `needle` in `haystack`.
 *
 * @param haystack - The string to search in.
 * @param needle - The substring to count.
 * @returns The number of non-overlapping occurrences.
 */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let fromIndex = 0;
  for (;;) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index === -1) {
      return count;
    }
    count += 1;
    fromIndex = index + needle.length;
  }
}

describe('webview bundle excludes the TypeScript language contribution', () => {
  it('produces a readable bundle', async function () {
    this.timeout(120_000);
    const bundle = await loadBundle();
    assert.ok(fs.statSync(bundle.path).size > 0, `bundle at ${bundle.path} is empty`);
  });

  it('carries no TypeScript language-service code', async function () {
    this.timeout(120_000);
    const bundle = await loadBundle();
    const instances = countOccurrences(bundle.text, TYPESCRIPT_LITERAL);
    assert.ok(
      instances < MAX_TYPESCRIPT_INSTANCES,
      `expected fewer than ${MAX_TYPESCRIPT_INSTANCES} ${TYPESCRIPT_LITERAL} language-registration ` +
        `literals in ${bundle.path}, found ${instances} — the TypeScript language-service contribution is still bundled`
    );
    assert.ok(
      !bundle.text.includes(TS_WORKER_METHOD),
      `bundle at ${bundle.path} still contains the TypeScript worker method ${TS_WORKER_METHOD}, ` +
        'which the editor worker rejects with "Missing requestHandler or method"'
    );
  });

  it('stays under the size bound the full package entry violates', async function () {
    this.timeout(120_000);
    const bundle = await loadBundle();
    const bytes = fs.statSync(bundle.path).size;
    assert.ok(
      bytes < MAX_BUNDLE_BYTES,
      `webview bundle at ${bundle.path} is ${bytes} bytes; expected under ${MAX_BUNDLE_BYTES} ` +
        '— the full monaco-editor entry still carries language stacks the viewer never uses'
    );
  });
});
