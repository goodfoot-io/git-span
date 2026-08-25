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
// The wired validate.sh path always rebuilds first; this guard protects manual
// invocations. Sources AND dependency manifests are watched: a dependency
// swap that leaves the old bundle in place must not pass vacuously just
// because the goldens were captured from exactly those stale bytes.
for (const input of [
  'scripts/span-ref-to-tracked-file.mjs',
  'scripts/build-migration.mjs',
  'package.json',
  'yarn.lock'
]) {
  const src = join(workspaceRoot, input);
  if (statSync(src).mtimeMs > statSync(bundle).mtimeMs) {
    fail(`stale bundle suspected (${input} is newer than the bundle); run "yarn build:migration" first`);
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
/** @type {{ code: number }} */
const outcome = { code: 0 };
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

  // Every anchor-content OID embedded inside the fixture blobs must resolve in
  // the scratch repo — content bytes are hashed to OIDs above, so this fails
  // here with a named diagnostic if fixtures and blobs ever drift apart,
  // instead of as an uncaught cat-file error mid-render inside the bundle.
  for (const name of ['whole-file', 'line-range', 'multi-anchor']) {
    const bytes = readFileSync(join(fixtureDir, 'blobs', `${name}.bin`));
    const embedded = [...new Set(bytes.toString('latin1').match(/[0-9a-f]{40}/g) ?? [])];
    for (const oid of embedded) {
      const check = spawnSync('git', ['-C', scratch, 'cat-file', '-e', oid]);
      if (check.status !== 0) {
        throw new Error(
          `fixture ${name}.bin references content OID ${oid} which the committed content/*.txt bytes do not produce — regenerate the blobs per scripts/rkyv-upgrade-fixture/README.md`
        );
      }
    }
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
  if (status !== 0) {
    stderr += `\n[bundle exited with status ${status}]`;
    throw new Error(
      `migration bundle failed (status ${status}); refusing to ${update ? 'recapture' : 'compare against'} goldens from a broken run\n${stderr}`
    );
  }

  // 3. Compare (paths are relative by construction; normalize defensively).
  stdout = stdout.split(scratch).join('<SCRATCH>');
  stderr = stderr.split(scratch).join('<SCRATCH>');

  if (update) {
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(join(goldenDir, 'stdout.txt'), stdout);
    writeFileSync(join(goldenDir, 'stderr.txt'), stderr);
    console.log('check-migration-golden: goldens updated');
  } else {
    for (const [label, actual] of [
      ['stdout', stdout],
      ['stderr', stderr]
    ]) {
      const expectedPath = join(goldenDir, `${label}.txt`);
      if (!existsSync(expectedPath)) {
        throw new Error(
          `missing golden ${relative(workspaceRoot, expectedPath)}; run with --update after verifying output`
        );
      }
      const expected = readFileSync(expectedPath, 'utf8');
      if (actual !== expected) {
        outcome.code = 1;
        console.error(
          `check-migration-golden: ${label} DIFFERS from golden\n--- expected\n${expected}\n--- actual\n${actual}`
        );
      }
    }
    if (outcome.code !== 0) {
      console.error(
        '\nMigration dry-run output changed. If this change is intentional, capture new goldens with --update AND record why in the change description — the goldens are the byte-stability contract.'
      );
    } else {
      console.log('check-migration-golden: output matches goldens');
    }
  }
} catch (err) {
  console.error(`check-migration-golden: ${/** @type {Error} */ (err).message}`);
  outcome.code = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(outcome.code);
