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
import { createRequire } from 'node:module';
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

// Resolve each grammar through Node's module resolution rather than a
// hardcoded package-local node_modules path: in this Yarn workspace the
// `tree-sitter-wasms` dependency is hoisted to the workspace root, so a fixed
// `packages/discover/node_modules/...` path does not exist. This mirrors how
// src/disqualifiers/tree-sitter-reference.ts resolves the same grammars at
// runtime (`require.resolve('tree-sitter-wasms/out/...')`).
const require = createRequire(import.meta.url);
for (const name of ['tree-sitter-rust.wasm', 'tree-sitter-typescript.wasm']) {
  fs.copyFileSync(require.resolve(`tree-sitter-wasms/out/${name}`), path.join(grammarsOut, name));
}

// web-tree-sitter's own runtime core (`tree-sitter.wasm`, distinct from the
// grammar `.wasm` files above) is loaded by `Parser.init()` from a path
// relative to the loading module. In the bundle that module is `dist/cli.js`,
// so the runtime wasm must sit next to it at `dist/tree-sitter.wasm`; in
// node_modules web-tree-sitter finds it on its own, which is why the test suite
// needs no copy step.
fs.copyFileSync(require.resolve('web-tree-sitter/tree-sitter.wasm'), path.join(DIST, 'tree-sitter.wasm'));

console.log('[build] Done.');
