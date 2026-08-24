#!/usr/bin/env node

// Bundle scripts/span-ref-to-tracked-file.mjs into a single self-contained
// CommonJS file. rkyv-js is not published to npm; a Yarn patch points its
// manifest entrypoints at the TypeScript sources it ships (card main-386),
// so the bare specifier resolves normally and esbuild compiles those sources
// while inlining them. The resulting bundle runs on the three testing
// installations with only Node + git, no node_modules.
//
//   node scripts/build-migration.mjs            # build only
//   node scripts/build-migration.mjs --run ...  # build, then run with args

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const outfile = join(here, 'dist', 'span-ref-to-tracked-file.cjs');

await build({
  entryPoints: [join(here, 'span-ref-to-tracked-file.mjs')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Node builtins stay external; everything else (rkyv-js src) is inlined.
  packages: 'bundle',
  logLevel: 'info'
});

console.log(`built ${outfile.replace(`${repoRoot}/`, '')}`);

const runIdx = process.argv.indexOf('--run');
if (runIdx !== -1) {
  const args = process.argv.slice(runIdx + 1);
  const res = spawnSync(process.execPath, [outfile, ...args], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
