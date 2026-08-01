/**
 * Production build script for the Git Span extension.
 *
 * Invoked via the `vscode:prepublish` lifecycle hook before `vsce package`.
 * Outputs into dist/ relative to the extension root so package.json's
 * `"main": "./dist/bundle.cjs"` resolves correctly.
 */

import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const EXTENSION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(EXTENSION_ROOT, 'dist');
const WEBVIEW_DIST = path.join(DIST, 'webview');

// Resolved through Node's module lookup so hoisted installs are found.
const CODICONS_DIR = path.dirname(require.resolve('@vscode/codicons/package.json'));

fs.mkdirSync(WEBVIEW_DIST, { recursive: true });

// Extension host — runs in Node.js inside VS Code.
await esbuild.build({
  entryPoints: [path.join(EXTENSION_ROOT, 'src/extension.ts')],
  bundle: true,
  outfile: path.join(DIST, 'bundle.cjs'),
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  external: ['vscode'],
  sourcemap: true,
  minify: true
});

// Webview — browser/ESM bundle loaded by the custom editor's HTML template.
// The full `monaco-editor` package entry bundles its own codicon CSS, which
// url()-references its own .ttf directly; esbuild's browser build has no
// default loader for font files, so `.ttf` must be mapped to the `file`
// loader. The emitted CSS and content-hashed font land inside WEBVIEW_DIST —
// the webview-resource tree served via asWebviewUri.
await esbuild.build({
  entryPoints: [path.join(EXTENSION_ROOT, 'src/spanViewer/webview/main.ts')],
  bundle: true,
  outfile: path.join(WEBVIEW_DIST, 'main.js'),
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  loader: { '.ttf': 'file' },
  sourcemap: true,
  minify: true
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
  sourcemap: true,
  minify: true
});
await esbuild.build({
  entryPoints: ['monaco-editor/language/json/json.worker'],
  bundle: true,
  outfile: path.join(WEBVIEW_DIST, 'json.worker.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  absWorkingDir: EXTENSION_ROOT,
  sourcemap: true,
  minify: true
});

// Codicon assets for the extension's own chrome (distinct from Monaco's
// transitively-imported codicon, which the webview pass above emits).
fs.copyFileSync(path.join(CODICONS_DIR, 'dist/codicon.css'), path.join(WEBVIEW_DIST, 'codicon.css'));
fs.copyFileSync(path.join(CODICONS_DIR, 'dist/codicon.ttf'), path.join(WEBVIEW_DIST, 'codicon.ttf'));

console.log('[build-production] Done.');
