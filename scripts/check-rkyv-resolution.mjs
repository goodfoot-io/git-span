#!/usr/bin/env node

// Resolution gate for the rkyv-js dependency (card main-386, npm channel per
// card main-386-1). The old GitHub-snapshot pin once forced a repo-local
// esbuild alias plus a TypeScript paths mapping in every consumer; it now
// resolves from npm through its own manifest, and this gate proves standard
// resolution keeps working: Node resolves every declared export target to an
// existing file, tsc binds the bare specifier in a consumer program with zero
// paths entries, and none of the old workarounds creep back into the repo.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const require = createRequire(import.meta.url);

/** @type {string[]} */
const failures = [];

/**
 * @param {string} name
 * @param {() => void} fn
 */
function check(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
    console.log(`FAIL - ${name}`);
  }
}

/**
 * @param {string} specifier
 * @returns {string}
 */
function assertResolvesToExistingFile(specifier) {
  const resolved = fileURLToPath(import.meta.resolve(specifier));
  if (!existsSync(resolved)) {
    throw new Error(`${specifier} resolved to missing file: ${resolved}`);
  }
  return resolved;
}

check('node resolution: bare specifier maps to an existing file', () => {
  const entry = assertResolvesToExistingFile('rkyv-js');
  console.log(`       ${entry.replace(`${repoRoot}/`, '')}`);
});

check('node resolution: every declared export target exists', () => {
  const manifest = require('rkyv-js/package.json');
  for (const [key, target] of Object.entries(manifest.exports)) {
    if (key === './package.json') continue;
    if (typeof target !== 'string') {
      throw new Error(`export "${key}" uses an unhandled shape: ${JSON.stringify(target)}`);
    }
    assertResolvesToExistingFile(key === '.' ? 'rkyv-js' : `rkyv-js/${key.slice(2)}`);
  }
});

check('tsc resolution: bare specifier binds in a fresh consumer program', () => {
  const res = spawnSync('yarn', ['tsc', '--noEmit', '-p', join(here, 'rkyv-resolution', 'tsconfig.json')], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (res.status !== 0) {
    throw new Error(`fixture typecheck failed:\n${res.stdout}${res.stderr}`);
  }
});

check('no repo-local workarounds for rkyv-js remain', () => {
  for (const config of ['tsconfig.json', 'tsconfig.scripts.json']) {
    const text = readConfig(join(repoRoot, config));
    if (/"paths"\s*:\s*\{[^{}]*rkyv-js/.test(text)) {
      throw new Error(`${config} still maps rkyv-js through a paths entry`);
    }
  }
  const buildScript = readConfig(join(repoRoot, 'scripts', 'build-migration.mjs'));
  if (/alias\s*:|require\.resolve\(['"]rkyv-js/.test(buildScript)) {
    throw new Error('scripts/build-migration.mjs still carries the esbuild alias workaround');
  }

  /**
   * @param {string} path
   * @returns {string}
   */
  function readConfig(path) {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  }
});

if (failures.length > 0) {
  console.error(`\nrkyv-js resolution gate FAILED (${failures.length} check(s)):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('\nrkyv-js resolves cleanly through its own package exports.');
