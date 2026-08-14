#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const packageRoot = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'static-attribution-benchmark-'));
const output = join(scratch, 'benchmark.mjs');
process.env.AGENT_HOOKS_BENCHMARK_ROOT = packageRoot;

try {
  await build({
    entryPoints: [join(packageRoot, 'scripts', 'static-attribution-benchmark.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: false,
    logLevel: 'warning'
  });
  process.argv = [process.execPath, output, ...process.argv.slice(2)];
  await import(pathToFileURL(output).href);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
