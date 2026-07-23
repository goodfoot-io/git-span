/**
 * Build script for the git-span-discover bin.
 *
 * Bundles src/cli.ts to dist/cli.js with esbuild (following
 * packages/extension's esbuild usage as the closest local pattern), prepends
 * a shebang so the bin executes directly, chmods it executable, and copies
 * the pinned tree-sitter WASM grammars (design decision 3 — web-tree-sitter
 * + tree-sitter-wasms, resolved from node_modules at build time) into
 * dist/grammars/ so the shipped bin parses fully offline rather than
 * resolving them from node_modules at runtime.
 *
 * src/cli.ts does not exist yet as of Stage 0 (it is Stage 2 work) — this
 * script is scaffolded now per the plan's package-scaffolding section so the
 * `build` script/bin wiring is fixed before Stage 1 begins, and simply fails
 * with a clear "entry point not found" error until Stage 2 lands src/cli.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(PACKAGE_ROOT, 'dist');

fs.mkdirSync(DIST, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(PACKAGE_ROOT, 'src/cli.ts')],
  bundle: true,
  outfile: path.join(DIST, 'cli.js'),
  format: 'esm',
  platform: 'node',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
  minify: false
});

fs.chmodSync(path.join(DIST, 'cli.js'), 0o755);

const grammarsOut = path.join(DIST, 'grammars');
fs.mkdirSync(grammarsOut, { recursive: true });

const grammarSourceDir = path.join(PACKAGE_ROOT, 'node_modules/tree-sitter-wasms/out');
for (const name of ['tree-sitter-rust.wasm', 'tree-sitter-typescript.wasm']) {
  fs.copyFileSync(path.join(grammarSourceDir, name), path.join(grammarsOut, name));
}

console.log('[build] Done.');
