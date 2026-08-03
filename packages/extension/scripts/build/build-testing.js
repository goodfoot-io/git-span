/**
 * Testing build script for the Git Span extension.
 *
 * Invoked by test/runTest.ts with TEST_DIST_DIR set to a unique temp path.
 * VS Code loads the extension from TEST_DIST_DIR as its root, using the
 * package.json written here (main: "./bundle.cjs").
 */

import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

const require = createRequire(import.meta.url);
const EXTENSION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = process.env['TEST_DIST_DIR'];

// Resolved through Node's module lookup so hoisted installs are found.
const CODICONS_DIR = path.dirname(require.resolve('@vscode/codicons/package.json'));

if (!OUT_DIR) {
  console.error('[build-testing] TEST_DIST_DIR env var is required.');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// Write extension manifest. main points at bundle.cjs in the same directory.
const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf-8'));
pkg.main = './bundle.cjs';
fs.writeFileSync(path.join(OUT_DIR, 'package.json'), JSON.stringify(pkg, null, 2));

// Extension host — runs in Node.js inside VS Code.
await esbuild.build({
  entryPoints: [path.join(EXTENSION_ROOT, 'src/extension.ts')],
  bundle: true,
  outfile: path.join(OUT_DIR, 'bundle.cjs'),
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  external: ['vscode'],
  sourcemap: true
});

// Webview — browser/ESM bundle loaded by the custom editor's HTML template.
// The full `monaco-editor` package entry bundles its own codicon CSS, which
// url()-references its own .ttf directly; esbuild's browser build has no
// default loader for font files, so `.ttf` must be mapped to the `file`
// loader. The emitted CSS and content-hashed font land inside WEBVIEW_DIST —
// the webview-resource tree served via asWebviewUri.
const WEBVIEW_DIST = path.join(OUT_DIR, 'webview');
fs.mkdirSync(WEBVIEW_DIST, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(EXTENSION_ROOT, 'src/spanViewer/webview/main.ts')],
  bundle: true,
  outfile: path.join(WEBVIEW_DIST, 'main.js'),
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  loader: { '.ttf': 'file' },
  sourcemap: true
});

// Monaco workers — bundled from the ESM sources into standalone classic
// scripts. The shipped min/vs workers are AMD define() shims that cannot run
// in a bare worker context, and the ESM sources are ES modules; bundling to
// IIFE makes each worker self-contained for the fetch-and-Blob-wrap
// construction in src/spanViewer/webview/main.ts. The entry points are bare
// specifiers resolved through monaco-editor's own exports map (Node blocks
// resolving the package's package.json directly) from the extension root.
await esbuild.build({
  entryPoints: ['monaco-editor/editor/editor.worker'],
  bundle: true,
  outfile: path.join(WEBVIEW_DIST, 'editor.worker.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  absWorkingDir: EXTENSION_ROOT,
  sourcemap: true
});
await esbuild.build({
  entryPoints: ['monaco-editor/language/json/json.worker'],
  bundle: true,
  outfile: path.join(WEBVIEW_DIST, 'json.worker.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  absWorkingDir: EXTENSION_ROOT,
  sourcemap: true
});

// Codicon assets for the extension's own chrome (distinct from Monaco's
// transitively-imported codicon, which the webview pass above emits).
fs.copyFileSync(path.join(CODICONS_DIR, 'dist/codicon.css'), path.join(WEBVIEW_DIST, 'codicon.css'));
fs.copyFileSync(path.join(CODICONS_DIR, 'dist/codicon.ttf'), path.join(WEBVIEW_DIST, 'codicon.ttf'));

// Test suite — Mocha runner entry point.
const testSuiteOut = path.join(OUT_DIR, 'test', 'suite');
fs.mkdirSync(testSuiteOut, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(EXTENSION_ROOT, 'test/suite/index.ts')],
  bundle: true,
  outfile: path.join(testSuiteOut, 'index.cjs'),
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  external: ['vscode', 'mocha'],
  sourcemap: true
});

// Individual test suites.
// `empty-import-meta` is silenced: webviewBundle.test.ts deliberately reads
// `__filename` in this CJS build and falls back to `import.meta.url` only when
// the suite runs as ESM via tsx, so the blanked `import.meta` is never used.
const testFiles = await glob('test/suite/**/*.test.ts', { cwd: EXTENSION_ROOT });
for (const rel of testFiles) {
  const baseName = path.basename(rel, '.ts') + '.cjs';
  await esbuild.build({
    entryPoints: [path.join(EXTENSION_ROOT, rel)],
    bundle: true,
    outfile: path.join(testSuiteOut, baseName),
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    external: ['vscode', 'mocha'],
    sourcemap: true,
    logOverride: { 'empty-import-meta': 'silent' }
  });
}

console.log('[build-testing] Done. Output:', OUT_DIR);
