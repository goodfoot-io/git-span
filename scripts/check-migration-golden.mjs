#!/usr/bin/env node
// Golden-output gate for the migration bundle (card main-386-1).
//
// Assembles a scratch repo holding a ref-backed legacy catalog from committed
// fixtures (scripts/rkyv-upgrade-fixture/), runs the built migration bundle in
// --dry-run mode against it, and compares stdout/stderr byte-for-byte with the
// captured goldens. The goldens were captured from the pre-upgrade bundle, so
// any mismatch after a dependency or code change is a real regression signal.
//
// Usage:
//   node scripts/check-migration-golden.mjs            # compare (exit 1 on diff)
//   node scripts/check-migration-golden.mjs --update   # recapture goldens
//   node scripts/check-migration-golden.mjs --bundle <path>
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(here, '..');
const fixtureDir = join(workspaceRoot, 'scripts', 'rkyv-upgrade-fixture');
const goldenDir = join(fixtureDir, 'golden');
const defaultBundle = join(workspaceRoot, 'scripts', 'dist', 'span-ref-to-tracked-file.cjs');

const args = new Set(process.argv.slice(2));
const update = args.has('--update');
const bundleIdx = process.argv.indexOf('--bundle');
const bundle = bundleIdx > -1 ? process.argv[bundleIdx + 1] : defaultBundle;

/**
 * @param {string} message
 */
function fail(message) {
  console.error(`check-migration-golden: ${message}`);
  process.exit(1);
}

if (!existsSync(bundle)) {
  fail(`migration bundle not found at ${bundle}; run "yarn build:migration" first`);
}
for (const source of ['span-ref-to-tracked-file.mjs', 'build-migration.mjs']) {
  const src = join(workspaceRoot, 'scripts', source);
  if (statSync(src).mtimeMs > statSync(bundle).mtimeMs) {
    fail(`stale bundle suspected (${source} is newer than the bundle); run "yarn build:migration" first`);
  }
}

/**
 * @param {string} cwd
 * @param {string[]} args_
 * @param {{ input?: Buffer | string }} [opts]
 * @returns {string}
 */
const gitIn = (cwd, args_, opts = {}) => execFileSync('git', args_, { cwd, ...opts }).toString();

// 1. Scratch repo with the legacy catalog ref. sha1 keeps the content OIDs
// embedded inside the fixture blobs resolvable regardless of local defaults.
const scratch = mkdtempSync(join(tmpdir(), 'rkyv-golden-scratch-'));
try {
  gitIn(scratch, ['-c', 'init.defaultObjectFormat=sha1', 'init', '-q']);

  // Content blobs: same bytes as at fixture-generation time, so hash-object
  // reproduces exactly the OIDs baked into the catalog blobs.
  const contentDir = join(fixtureDir, 'content');
  /** @type {Record<string, string>} */
  const oids = {};
  for (const file of ['simple-anchor.txt', 'linerange-anchor.txt', 'multi-whole.txt', 'multi-range.txt']) {
    oids[file] = gitIn(scratch, ['hash-object', '-w', '--stdin'], {
      input: readFileSync(join(contentDir, file))
    }).trim();
  }

  // Catalog tree: one .span entry per fixture blob.
  const treeEntries = [];
  for (const name of ['whole-file', 'line-range', 'multi-anchor', 'empty-catalog']) {
    const oid = gitIn(scratch, ['hash-object', '-w', '--stdin'], {
      input: readFileSync(join(fixtureDir, 'blobs', `${name}.bin`))
    }).trim();
    treeEntries.push(`100644 blob ${oid}\t${name}.span`);
  }
  const treeOid = gitIn(scratch, ['mktree'], { input: `${treeEntries.join('\n')}\n` }).trim();
  gitIn(scratch, ['update-ref', 'refs/spans/v1/catalog', treeOid]);

  // Sanity: every OID referenced by the fixtures resolves in the scratch repo.
  for (const [file, oid] of Object.entries(oids)) {
    if (!oids[file] || oid.length !== 40) fail(`bad OID for ${file}: ${oid}`);
  }

  // 2. Run the bundle dry-run over the scratch repo.
  const {
    status,
    stdout: outBuf,
    stderr: errBuf
  } = spawnSync(process.execPath, [bundle, '--dry-run'], {
    cwd: scratch,
    encoding: 'utf8'
  });
  let stdout = outBuf ?? '';
  let stderr = errBuf ?? '';
  if (status !== 0) stderr += `\n[bundle exited with status ${status}]`;

  // 3. Compare (paths are relative by construction; normalize defensively).
  stdout = stdout.split(scratch).join('<SCRATCH>');
  stderr = stderr.split(scratch).join('<SCRATCH>');

  if (update) {
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(join(goldenDir, 'stdout.txt'), stdout);
    writeFileSync(join(goldenDir, 'stderr.txt'), stderr);
    console.log('check-migration-golden: goldens updated');
    process.exit(0);
  }

  let failed = false;
  for (const [label, actual] of [
    ['stdout', stdout],
    ['stderr', stderr]
  ]) {
    const expectedPath = join(goldenDir, `${label}.txt`);
    if (!existsSync(expectedPath))
      fail(`missing golden ${relative(workspaceRoot, expectedPath)}; run with --update after verifying output`);
    const expected = readFileSync(expectedPath, 'utf8');
    if (actual !== expected) {
      failed = true;
      console.error(
        `check-migration-golden: ${label} DIFFERS from golden\n--- expected\n${expected}\n--- actual\n${actual}`
      );
    }
  }
  if (failed) {
    console.error(
      '\nMigration dry-run output changed. If this change is intentional, capture new goldens with --update AND record why in the change description — the goldens are the byte-stability contract.'
    );
    process.exit(1);
  }
  console.log('check-migration-golden: output matches goldens');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
