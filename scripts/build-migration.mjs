#!/usr/bin/env node
// Bundle scripts/mesh-ref-to-tracked-file.mjs into a single self-contained
// CommonJS file. rkyv-js is not published to npm and ships TypeScript sources
// with no built `dist/`, so esbuild compiles its `src/` and inlines it. The
// resulting bundle runs on the three testing installations with only Node +
// git, no node_modules.
//
//   node scripts/build-migration.mjs            # build only
//   node scripts/build-migration.mjs --run ...  # build, then run with args

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const outfile = join(here, 'dist', 'mesh-ref-to-tracked-file.cjs');

// rkyv-js's package "exports" only map to a non-existent dist/. Resolve its
// package root from its package.json and alias the bare specifier to src/.
const require = createRequire(import.meta.url);
const rkyvPkgRoot = dirname(require.resolve('rkyv-js/package.json'));

await build({
  entryPoints: [join(here, 'mesh-ref-to-tracked-file.mjs')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  alias: { 'rkyv-js': join(rkyvPkgRoot, 'src', 'index.ts') },
  // Node builtins stay external; everything else (rkyv-js src) is inlined.
  packages: 'bundle',
  logLevel: 'info',
});

console.log(`built ${outfile.replace(repoRoot + '/', '')}`);

const runIdx = process.argv.indexOf('--run');
if (runIdx !== -1) {
  const args = process.argv.slice(runIdx + 1);
  const res = spawnSync(process.execPath, [outfile, ...args], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
