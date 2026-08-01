/**
 * Contract test for `parseHistoryJson` against the **real** `git-span`
 * binary at test-run time -- not a frozen capture, so the extension's parser
 * fails the moment the CLI's schema changes (the direction main-194's
 * mismatch ran).
 *
 * Each scenario builds a scratch git repo in a temp dir (real `git init`, a
 * real file, real `git-span add`/edit/commit calls -- never fixture JSON),
 * runs the real `git span history <name> --format json` via
 * `runGitSpanCommand`, and feeds the live stdout to `parseHistoryJson`.
 *
 * Assertions are structural, not literal, on fields whose values are
 * run-to-run stable (`schema_version === 2`, exact `content`/`path` values
 * the fixture repo's own file contents determine), and by shape on the
 * fields that vary every run (`hash` matches `/^[0-9a-f]{40}$/`, `date` is a
 * valid ISO-8601 timestamp) -- literal-equality assertions on hash/date
 * would flake on every run.
 *
 * @summary Live-binary contract test for the schema v2 history parser.
 * @module test/suite/spanViewer/historyClient.contract.test
 */

import * as assert from 'node:assert';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseHistoryJson } from '../../../src/spanViewer/historyClient.js';
import { runGitSpanCommand } from '../../../src/utils/gitSpanBinary.js';

/** The fixture shim `test/runTest.ts` installs on PATH; never the real CLI. */
const FIXTURE_SIGNATURE = '9.9.9-test';
const HASH_SHAPE = /^[0-9a-f]{40}$/;
const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/;
const RKW64_SHAPE = /^rk64:[0-9a-f]{16}$/;

/**
 * Resolve the real `git-span` binary on PATH, skipping the test-runner
 * fixture shim (which answers `--version` with `git-span 9.9.9-test`).
 *
 * @returns Absolute path to the first non-fixture `git-span` executable.
 * @throws Error when no real binary is found.
 */
function resolveRealGitSpan(): string {
  const envPath = process.env['PATH'] ?? '';
  const directories = envPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const directory of directories) {
    const candidate = path.join(directory, 'git-span');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      continue;
    }
    const probe = cp.spawnSync(candidate, ['--version'], { encoding: 'utf-8' });
    if (probe.status === 0 && probe.stdout.includes(FIXTURE_SIGNATURE)) {
      continue;
    }
    return candidate;
  }
  throw new Error(
    'Could not resolve a real git-span binary on PATH; the contract test requires the CLI to be installed'
  );
}

/**
 * Run `git-span <args>` in `cwd`, failing the test on a non-zero exit.
 *
 * @param binary - Absolute path to the real `git-span` binary.
 * @param cwd - The scratch repo the command runs in.
 * @param args - Command arguments (including the subcommand).
 * @returns The command's stdout.
 */
async function runGitSpan(binary: string, cwd: string, args: string[]): Promise<string> {
  const result = await runGitSpanCommand(binary, args, undefined, cwd);
  assert.strictEqual(
    result.exitCode,
    0,
    `git span ${args.join(' ')} failed (exit ${result.exitCode}): ${result.stderr}`
  );
  return result.stdout;
}

/**
 * Run `git <args>` in `cwd`, failing the test on a non-zero exit.
 *
 * @param cwd - The scratch repo the command runs in.
 * @param args - Git arguments (including the subcommand).
 */
function runGit(cwd: string, args: string[]): void {
  const result = cp.spawnSync('git', args, { cwd, encoding: 'utf-8' });
  assert.strictEqual(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

const scratchDirs: string[] = [];

/**
 * Create a scratch git repo with a seed commit and a committed span
 * declaration at `f.txt#L1-L3` over the given three-line content.
 *
 * @param content - The three lines `f.txt` starts with.
 * @returns The scratch repo directory.
 */
function makeRepoWithSpan(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-contract-'));
  scratchDirs.push(dir);
  runGit(dir, ['init', '-q']);
  runGit(dir, ['config', 'user.email', 'contract-test@example.com']);
  runGit(dir, ['config', 'user.name', 'Contract Test']);
  fs.writeFileSync(path.join(dir, 'f.txt'), content);
  runGit(dir, ['add', 'f.txt']);
  runGit(dir, ['commit', '-qm', 'seed']);
  return dir;
}

function assertShapeOfCommit(commit: { hash: string; date: string }): void {
  assert.match(commit.hash, HASH_SHAPE, 'commit hash must be a full 40-hex git object id');
  assert.match(commit.date, ISO_DATE_SHAPE, 'commit date must be a full ISO-8601 timestamp with offset');
  assert.ok(!Number.isNaN(Date.parse(commit.date)), 'commit date must parse as a real date');
}

describe('historyClient contract (live git-span binary)', function () {
  this.timeout(30000);

  after(() => {
    for (const dir of scratchDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    scratchDirs.length = 0;
  });

  it('maps a first-add history entry: content block, no diff, no current block', async () => {
    const binary = resolveRealGitSpan();
    const dir = makeRepoWithSpan('line one\nline two\nline three\n');
    await runGitSpan(binary, dir, ['add', 'test-span', 'f.txt#L1-L3']);
    runGit(dir, ['add', '.span']);
    runGit(dir, ['commit', '-qm', 'add span']);

    const stdout = await runGitSpan(binary, dir, ['history', 'test-span', '--format', 'json']);
    const doc = parseHistoryJson(stdout);

    assert.strictEqual(doc.schemaVersion, 2);
    assert.strictEqual(doc.span, 'test-span');
    assert.strictEqual(doc.current, undefined);
    assert.strictEqual(doc.commits.length, 1);

    const commit = doc.commits[0];
    assert.ok(commit);
    assertShapeOfCommit(commit);
    assert.strictEqual(commit.summary, 'add span');
    assert.strictEqual(commit.anchors.length, 1);

    const anchor = commit.anchors[0];
    assert.ok(anchor);
    assert.strictEqual(anchor.path, 'f.txt#L1-L3');
    assert.strictEqual(anchor.content, 'line one\nline two\nline three\n');
    assert.strictEqual('diff' in anchor, false, 'a first-add carries content, never diff');
  });

  it('maps an ordinary content edit: diff block in the timeline plus a drifted current block', async () => {
    const binary = resolveRealGitSpan();
    const dir = makeRepoWithSpan('line one\nline two\nline three\n');
    await runGitSpan(binary, dir, ['add', 'test-span', 'f.txt#L1-L3']);
    runGit(dir, ['add', '.span']);
    runGit(dir, ['commit', '-qm', 'add span']);

    fs.writeFileSync(path.join(dir, 'f.txt'), 'line one EDITED\nline two\nline three\n');
    runGit(dir, ['add', 'f.txt']);
    runGit(dir, ['commit', '-qm', 'edit content']);

    const stdout = await runGitSpan(binary, dir, ['history', 'test-span', '--format', 'json']);
    const doc = parseHistoryJson(stdout);

    assert.strictEqual(doc.schemaVersion, 2);
    assert.strictEqual(doc.commits.length, 2, 'add commit plus edit commit, newest-first');

    const editCommit = doc.commits[0];
    assert.ok(editCommit);
    assertShapeOfCommit(editCommit);
    assert.strictEqual(editCommit.summary, 'edit content');
    const editAnchor = editCommit.anchors[0];
    assert.ok(editAnchor);
    assert.strictEqual(editAnchor.path, 'f.txt#L1-L3');
    assert.ok(
      editAnchor.diff?.includes('@@ -1,3 +1,3 @@'),
      'edit diff carries real hunks at file-absolute coordinates'
    );
    assert.ok(editAnchor.diff?.includes('-line one\n+line one EDITED'), 'edit diff names the changed line');
    assert.strictEqual('content' in editAnchor, false, 'a non-first-add timeline anchor carries diff, never content');

    const addCommit = doc.commits[1];
    assert.ok(addCommit);
    assertShapeOfCommit(addCommit);
    assert.strictEqual(addCommit.anchors[0]?.content, 'line one\nline two\nline three\n');

    const currentEntry = doc.current?.anchors[0];
    assert.ok(currentEntry, 'a committed edit without re-anchor drifts at HEAD, so a current block must exist');
    assert.strictEqual(currentEntry.path, 'f.txt#L1-L3');
    assert.strictEqual(currentEntry.content, 'line one EDITED\nline two\nline three\n');
    assert.ok(currentEntry.diff.includes('@@ -1,3 +1,3 @@'), 'current diff carries real hunks');
    assert.deepStrictEqual(currentEntry.sources, ['HEAD']);
    assert.strictEqual('unavailable' in currentEntry, false);
    assert.strictEqual('recorded' in currentEntry, false);
  });

  it('maps a rebind-plus-edit commit as two anchors at one path, identified by (path, block form)', async () => {
    const binary = resolveRealGitSpan();
    const dir = makeRepoWithSpan('line one\nline two\nline three\n');
    await runGitSpan(binary, dir, ['add', 'test-span', 'f.txt#L1-L3']);
    runGit(dir, ['add', '.span']);
    runGit(dir, ['commit', '-qm', 'add span']);

    fs.writeFileSync(path.join(dir, 'f.txt'), 'line one EDITED\nline two\nline three\n');
    runGit(dir, ['add', 'f.txt']);
    runGit(dir, ['commit', '-qm', 'edit content']);

    // Re-anchor (the declaration's recorded token changes) in the same
    // commit as a content edit: the commit must emit a rebound block and a
    // content block at the same path.
    fs.writeFileSync(path.join(dir, 'f.txt'), 'line one EDITED\nline two CHANGED\nline three\n');
    await runGitSpan(binary, dir, ['add', 'test-span', 'f.txt#L1-L3']);
    runGit(dir, ['add', 'f.txt', '.span']);
    runGit(dir, ['commit', '-qm', 're-anchor and edit']);

    const stdout = await runGitSpan(binary, dir, ['history', 'test-span', '--format', 'json']);
    const doc = parseHistoryJson(stdout);

    assert.strictEqual(doc.schemaVersion, 2);
    assert.strictEqual(doc.commits.length, 3, 're-anchor commit, edit commit, add commit -- newest-first');

    const rebindCommit = doc.commits[0];
    assert.ok(rebindCommit);
    assertShapeOfCommit(rebindCommit);
    assert.strictEqual(rebindCommit.summary, 're-anchor and edit');
    assert.strictEqual(rebindCommit.anchors.length, 2, 'rebind plus edit emits two objects at one path');

    const [reboundBlock, contentBlock] = rebindCommit.anchors;
    assert.ok(reboundBlock && contentBlock);
    assert.strictEqual(reboundBlock.path, 'f.txt#L1-L3');
    assert.strictEqual(contentBlock.path, 'f.txt#L1-L3');
    assert.ok(reboundBlock.rebound, 'the rebound block carries the structured rebound transition');
    assert.match(reboundBlock.rebound.from, RKW64_SHAPE);
    assert.match(reboundBlock.rebound.to, RKW64_SHAPE);
    assert.notStrictEqual(reboundBlock.rebound.from, reboundBlock.rebound.to);
    assert.ok(reboundBlock.diff?.includes('rebound anchor'), 'the rebound block is header-only, naming the transition');
    assert.strictEqual('rebound' in contentBlock, false, 'the content block is identified by the absence of rebound');
    assert.ok(contentBlock.diff?.includes('-line two\n+line two CHANGED'), 'the content block carries the real edit');
    assert.strictEqual('content' in contentBlock, false);

    const editCommit = doc.commits[1];
    assert.ok(editCommit);
    assert.ok(editCommit.anchors[0]?.diff?.includes('-line one\n+line one EDITED'));
    assert.strictEqual(doc.commits[2]?.anchors[0]?.content, 'line one\nline two\nline three\n');
    assert.strictEqual(doc.current, undefined, 're-anchored and committed: nothing drifted, no current block');
  });

  it('emits an empty current block with a same-token span_diff move for a byte-identical uncommitted re-anchor', async () => {
    // The CLI's `stale --fix` flow: record f.txt#L1-L3, insert a line above
    // (the extent's bytes unchanged, so the anchor is byte-identical), run
    // `stale --fix`. The resolver classifies the re-anchor as non-reportable,
    // so `current.anchors` is EMPTY and `current.span_diff` -- the
    // declaration's same-token address rewrite -- is the only trace of the
    // move. The extension's matching layer reads exactly this signal.
    const binary = resolveRealGitSpan();
    const dir = makeRepoWithSpan('alpha\nbeta\ngamma\n');
    await runGitSpan(binary, dir, ['add', 'test-span', 'f.txt#L1-L3']);
    runGit(dir, ['add', '.span']);
    runGit(dir, ['commit', '-qm', 'add span']);

    fs.writeFileSync(path.join(dir, 'f.txt'), 'INSERTED\nalpha\nbeta\ngamma\n');
    await runGitSpan(binary, dir, ['stale', '--fix']);

    const stdout = await runGitSpan(binary, dir, ['history', 'test-span', '--format', 'json']);
    const doc = parseHistoryJson(stdout);

    assert.strictEqual(doc.schemaVersion, 2);
    assert.ok(doc.current, 'the uncommitted declaration edit must surface a current block');
    assert.deepStrictEqual(
      doc.current.anchors,
      [],
      'a byte-identical re-anchor is non-reportable: no anchor entry is emitted'
    );
    const spanDiff = doc.current.span_diff;
    assert.ok(spanDiff, 'the declaration diff must be carried in the current block');
    const moveFrom = /^-f\.txt#L1-L3 (rk64:[0-9a-f]{16})$/m.exec(spanDiff)?.[1];
    const moveTo = /^\+f\.txt#L2-L4 (rk64:[0-9a-f]{16})$/m.exec(spanDiff)?.[1];
    assert.ok(moveFrom && moveTo, 'span_diff must rewrite the anchor line from L1-L3 to L2-L4');
    assert.strictEqual(moveTo, moveFrom, 'a re-anchor keeps the recorded token, so both lines share it');
    assert.strictEqual(doc.commits[0]?.anchors[0]?.content, 'alpha\nbeta\ngamma\n');
  });

  it('emits a content block plus full deletion without rename headers for a committed stale-fix re-anchor', async () => {
    // The routine flow: record f.txt#L1-L3 with a/b/c, insert two lines above
    // and commit the edit, then run `stale --fix` and commit the fix. The fix
    // commit's moved bytes equal the recorded token's, so the re-anchor keeps
    // the token -- but the deleted extent's bytes differ from the recorded
    // ones, so the CLI renders the move as a CONTENT block at the new address
    // plus a FULL DELETION at the old one, with NO rename headers anywhere,
    // and the commit's own span_diff carries the same-token address move. The
    // extension's matching layer crosses exactly this delete+add pair.
    const binary = resolveRealGitSpan();
    const dir = makeRepoWithSpan('a\nb\nc\n');
    await runGitSpan(binary, dir, ['add', 'test-span', 'f.txt#L1-L3']);
    runGit(dir, ['add', '.span']);
    runGit(dir, ['commit', '-qm', 'add span']);

    fs.writeFileSync(path.join(dir, 'f.txt'), 'x\ny\na\nb\nc\n');
    runGit(dir, ['add', 'f.txt']);
    runGit(dir, ['commit', '-qm', 'edit content']);
    await runGitSpan(binary, dir, ['stale', '--fix']);
    runGit(dir, ['add', '.span']);
    runGit(dir, ['commit', '-qm', 'stale fix']);

    const stdout = await runGitSpan(binary, dir, ['history', 'test-span', '--format', 'json']);
    const doc = parseHistoryJson(stdout);

    assert.strictEqual(doc.schemaVersion, 2);
    assert.strictEqual(doc.commits.length, 3, 'add, edit, stale-fix -- newest-first');
    assert.strictEqual(doc.current, undefined, 'the fix is committed: nothing drifted');

    const fixCommit = doc.commits[0];
    assert.ok(fixCommit);
    assertShapeOfCommit(fixCommit);
    assert.strictEqual(fixCommit.summary, 'stale fix');
    assert.strictEqual(
      fixCommit.anchors.length,
      2,
      'the committed re-anchor renders as a content block plus a deletion'
    );
    assert.strictEqual(
      fixCommit.anchors.some((anchor) => anchor.diff?.includes('rename from')),
      false,
      'the differing-target re-anchor carries no rename headers'
    );

    const reanchoredBlock = fixCommit.anchors.find((anchor) => anchor.path === 'f.txt#L3-L5');
    assert.ok(reanchoredBlock, 'the content block lands at the new address');
    assert.strictEqual(reanchoredBlock.content, 'a\nb\nc\n', 'the block content is the moved address bytes');
    const deletedBlock = fixCommit.anchors.find((anchor) => anchor.path === 'f.txt#L1-L3');
    assert.ok(deletedBlock, 'the full deletion lands at the old address');
    assert.ok(deletedBlock.diff?.includes('deleted anchor'));
    assert.ok(deletedBlock.diff?.includes('@@ -1,3 +0,0 @@\n-x\n-y\n-a'), 'the deletion names the pre-commit bytes');

    const spanDiff = fixCommit.span_diff;
    assert.ok(spanDiff, 'the commit must carry its own declaration diff');
    const moveFrom = /^-f\.txt#L1-L3 (rk64:[0-9a-f]{16})$/m.exec(spanDiff)?.[1];
    const moveTo = /^\+f\.txt#L3-L5 (rk64:[0-9a-f]{16})$/m.exec(spanDiff)?.[1];
    assert.ok(moveFrom && moveTo, 'span_diff must rewrite the anchor line from L1-L3 to L3-L5');
    assert.strictEqual(moveTo, moveFrom, 'the kept-token move shares the token across both lines');
  });
});
