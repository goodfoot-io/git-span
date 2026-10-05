/** Real executable-boundary acceptance: portable bundled launcher, Git, and the workspace notes CLI. */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commitAssociationKey } from '../../src/common/commit-association.js';
import { type CommitReceipt, createCommitNoteDocument } from '../../src/common/commit-contracts.js';
import { executeCommitNotes } from '../../src/common/commit-native-io.js';
import {
  type CommitEnrollmentRequest,
  type CommitRuntimeOptions,
  cleanupCommitInvocations,
  dispatchCommitShim,
  enrollCommitInvocation,
  terminalCommitInvocation
} from '../../src/common/commit-runtime.js';
import { acquireReceiptClaim, atomicJson, identityKey } from '../../src/common/commit-storage.js';
import { itemAt } from '../helpers.js';
import { buildWorkspaceGitSpan } from '../real-bundle-helpers.js';

const require = createRequire(import.meta.url);
let bundleRoot: string;
let bundle: string;
let notesExecutable: string;
let scratch: string;
let repo: string;
let stateRoot: string;
let options: CommitRuntimeOptions;
let warnings: string[];
const logger = {
  warn: (message: string) => {
    warnings.push(message);
  }
};
function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
}
function makeRepo(path: string, format?: string): void {
  mkdirSync(path, { recursive: true });
  git(['init', '-q', ...(format ? [`--object-format=${format}`] : [])], path);
  git(['config', 'user.name', 'Receipt Agent'], path);
  git(['config', 'user.email', 'receipt@example.test'], path);
}
function request(command: string, extra: Partial<CommitEnrollmentRequest> = {}): CommitEnrollmentRequest {
  return {
    host: 'claude',
    sessionId: 'session-a',
    toolUseId: 'tool-a',
    cwd: repo,
    toolInput: { command, timeout: 10000 },
    bundlePath: bundle,
    ...extra
  };
}
async function enrolled(input: CommitEnrollmentRequest) {
  const result = await enrollCommitInvocation(input, options, logger);
  expect(result.kind).toBe('enrolled');
  if (result.kind !== 'enrolled') throw new Error(result.reason);
  return result;
}
function shell(command: string, cwd = repo) {
  return spawnSync('/bin/bash', ['-c', command], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_SPAN_DISABLE_UPDATE_CHECK: '1' },
    timeout: 15000
  });
}
function directory(input: CommitEnrollmentRequest): string {
  return join(stateRoot, 'invocations', identityKey(input));
}
function receipts(input: CommitEnrollmentRequest): CommitReceipt[] {
  return readdirSync(join(directory(input), 'receipts')).map(
    (name) => JSON.parse(readFileSync(join(directory(input), 'receipts', name), 'utf8')) as CommitReceipt
  );
}
function notes(sha?: string, cwd = repo): { notes: { commit_sha: string; document: unknown }[] } {
  return JSON.parse(
    execFileSync(notesExecutable, ['notes', 'list', ...(sha ? [sha, '--exact'] : []), '--format', 'json'], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_SPAN_DISABLE_UPDATE_CHECK: '1' }
    })
  );
}
async function childResult(
  command: string,
  cwd = repo
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn('/bin/bash', ['-c', command], {
      cwd,
      env: { ...process.env, GIT_SPAN_DISABLE_UPDATE_CHECK: '1' }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolveResult({ status, stdout, stderr }));
  });
}

beforeAll(() => {
  bundleRoot = mkdtempSync(join(tmpdir(), 'commit portable bundle '));
  const source = join(bundleRoot, 'dispatcher.ts');
  bundle = join(bundleRoot, 'dispatcher.mjs');
  const runtime = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/common/commit-runtime.ts');
  const storage = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/common/commit-storage.ts');
  writeFileSync(
    source,
    `import { dispatchCommitShim } from ${JSON.stringify(runtime)}; export { enrollCommitInvocation, terminalCommitInvocation, cleanupCommitInvocations, dispatchCommitShim } from ${JSON.stringify(runtime)}; import { acquireReceiptClaim } from ${JSON.stringify(storage)}; if (process.argv[2] === '--hold-claim') { const claim = await acquireReceiptClaim(process.argv[3], process.argv[4], performance.now()+1000); if (!claim) process.exit(3); process.stdout.write('ready\\n'); setInterval(() => {}, 1000); } else await dispatchCommitShim();`
  );
  execFileSync(process.execPath, [
    require.resolve('esbuild/bin/esbuild'),
    source,
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outfile=${bundle}`,
    '--log-level=error'
  ]);
  rmSync(source);
  notesExecutable = buildWorkspaceGitSpan().binary;
}, 600000);
afterAll(() => {
  rmSync(bundleRoot, { recursive: true, force: true });
});
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "commit receipt 'quoted' "));
  repo = join(scratch, 'repo');
  makeRepo(repo);
  stateRoot = join(scratch, 'private receipts');
  options = { stateRoot, notesExecutable };
  warnings = [];
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('portable real commit receipt recording', () => {
  it('leaves ordinary hook argv harmless', async () => {
    expect(await dispatchCommitShim([])).toBe(false);
  });
  it('captures initial quiet commit with original input, omitted locator, silent recording and duplicate post', async () => {
    const input = request('git commit -q --allow-empty -m initial');
    const result = await enrolled(input);
    expect(result.updatedInput.timeout).toBe(10000);
    expect(shell(result.updatedInput.command as string)).toMatchObject({ status: 0, stdout: '', stderr: '' });
    const sha = git(['rev-parse', 'HEAD']);
    expect(receipts(input)).toMatchObject([{ sha }]);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({
      acknowledged: 1,
      pending: 0,
      original: { input: input.toolInput, command: input.toolInput.command, cwd: repo }
    });
    expect(notes(sha).notes).toEqual([
      { ...notes(sha).notes[0], document: { schemaVersion: 1, host: 'claude', sessionId: 'session-a' } }
    ]);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({
      acknowledged: 0,
      pending: 0,
      original: { input: input.toolInput }
    });
    expect(warnings).toEqual([]);
    const stat = spawnSync('stat', ['-c', '%a', directory(input)], { encoding: 'utf8' });
    expect(stat.stdout.trim()).toBe('700');
  });
  it('freezes two commits and amend before reset and original shell failure', async () => {
    const input = request(
      'git commit -q --allow-empty -m first; git commit -q --allow-empty -m second; git commit -q --allow-empty --amend -m amended; git reset -q --hard HEAD~1; exit 7',
      { transcriptLocator: '/transcripts/origin.jsonl' }
    );
    const result = await enrolled(input);
    expect(shell(result.updatedInput.command as string).status).toBe(7);
    const captured = receipts(input);
    expect(captured).toHaveLength(3);
    expect(new Set(captured.map((receipt) => receipt.sha)).size).toBe(3);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 3, pending: 0 });
    for (const receipt of captured)
      expect(itemAt(notes(receipt.sha).notes, 0).document).toEqual({
        schemaVersion: 1,
        host: 'claude',
        sessionId: 'session-a',
        transcriptLocator: '/transcripts/origin.jsonl'
      });
  });
  it.each([
    'exit 9',
    'git commit -q -m failed',
    'git commit --dry-run',
    "printf '%s\\n' 'commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"
  ])('does not invent creation from %s', async (command) => {
    const input = request(command);
    const result = await enrolled(input);
    shell(result.updatedInput.command as string);
    expect(receipts(input)).toEqual([]);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 0, pending: 0 });
    expect(notes().notes).toEqual([]);
  });
  it('historical reset and checkout plus alias forwarding create no builtin receipt', async () => {
    git(['commit', '-q', '--allow-empty', '-m', 'old']);
    const input = request(
      "git checkout -q HEAD; git reset -q --hard HEAD; git -c alias.ci='commit -q --allow-empty -m alias' ci"
    );
    const result = await enrolled(input);
    expect(shell(result.updatedInput.command as string).status).toBe(0);
    expect(receipts(input)).toEqual([]);
    await terminalCommitInvocation(input, options, logger);
    expect(notes().notes).toEqual([]);
  });
  it('resolves repeated -C and explicit repository/worktree options from the original child cwd', async () => {
    const other = join(scratch, 'other');
    makeRepo(other);
    const input = request(
      `git -C .. -C other --git-dir=.git --work-tree=. -c user.name=Override commit -q --allow-empty -m other`
    );
    const result = await enrolled(input);
    expect(shell(result.updatedInput.command as string).status).toBe(0);
    const captured = itemAt(receipts(input), 0);
    expect(captured.repository.cwd).toBe(other);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 1 });
    expect(notes(captured.sha, other).notes).toHaveLength(1);
    expect(notes().notes).toEqual([]);
  });
  it('records SHA-256 object IDs through the actual CLI', async () => {
    const other = join(scratch, 'sha256');
    makeRepo(other, 'sha256');
    const input = request('git commit -q --allow-empty -m sha256', { host: 'codex', cwd: other });
    const result = await enrolled(input);
    expect(shell(result.updatedInput.command as string, other).status).toBe(0);
    const captured = itemAt(receipts(input), 0);
    expect(captured.sha).toHaveLength(64);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 1 });
    expect(notes(captured.sha, other).notes).toHaveLength(1);
  });
  it('retains completed unavailable-CLI work and retries on cleanup while surviving worktree removal', async () => {
    git(['commit', '-q', '--allow-empty', '-m', 'base']);
    const linked = join(scratch, 'linked');
    git(['worktree', 'add', '-q', '-b', 'linked', linked]);
    const input = request('git commit -q --allow-empty -m linked', { cwd: linked });
    const result = await enrolled(input);
    expect(shell(result.updatedInput.command as string, linked).status).toBe(0);
    const captured = itemAt(receipts(input), 0);
    expect(
      await terminalCommitInvocation(input, { ...options, notesExecutable: '/missing/notes-cli' }, logger)
    ).toMatchObject({ acknowledged: 0, pending: 1, original: { cwd: linked } });
    git(['worktree', 'remove', '--force', linked]);
    expect(await cleanupCommitInvocations('claude', 'session-a', options, logger)).toMatchObject({
      acknowledged: 1,
      pending: 0,
      retired: 1
    });
    expect(notes(captured.sha).notes).toHaveLength(1);
  });
  it('rejects disabled reflogs without changing a successful commit', async () => {
    git(['config', 'core.logAllRefUpdates', 'false']);
    const input = request('git commit -q --allow-empty -m no-log');
    const result = await enrolled(input);
    expect(shell(result.updatedInput.command as string).status).toBe(0);
    expect(receipts(input)).toEqual([]);
    await terminalCommitInvocation(input, options, logger);
    expect(warnings.some((warning) => warning.includes('missing HEAD reflog'))).toBe(true);
  });
  it.each(['git commit -m x &', 'PATH=/usr/bin git commit -m x', '/usr/bin/git commit -m x'])(
    'diagnoses observable unsupported execution %s',
    async (command) => {
      expect(await enrollCommitInvocation(request(command), options, logger)).toMatchObject({ kind: 'unsupported' });
      expect(warnings).toHaveLength(1);
    }
  );
  it('serializes duplicate terminal delivery without duplicate notes', async () => {
    const input = request('git commit -q --allow-empty -m concurrent');
    const result = await enrolled(input);
    shell(result.updatedInput.command as string);
    const results = await Promise.all([
      terminalCommitInvocation(input, options, logger),
      terminalCommitInvocation(input, options, logger)
    ]);
    expect(results.reduce((count, result) => count + result.acknowledged, 0)).toBe(1);
    expect(results.every((result) => result.original !== null)).toBe(true);
    expect(notes().notes).toHaveLength(1);
  });
});

describe('real receipt failures, ownership and lifecycle', () => {
  it('keeps original input and evidence retryable after an add succeeds but acknowledgment is lost', async () => {
    const input = request('git commit -q --allow-empty -m lost-ack');
    const result = await enrolled(input);
    shell(result.updatedInput.command as string);
    let lost = false;
    const faulty = {
      ...options,
      notesIO: {
        execute: async (command: Parameters<typeof executeCommitNotes>[1]) => {
          const outcome = await executeCommitNotes(notesExecutable, command);
          if (command.argv.includes('add') && outcome.exitCode === 0 && !lost) {
            lost = true;
            throw new Error('acknowledgment transport interrupted');
          }
          return outcome;
        }
      }
    };
    expect(await terminalCommitInvocation(input, faulty, logger)).toMatchObject({
      acknowledged: 0,
      pending: 1,
      original: { input: input.toolInput }
    });
    expect(notes().notes).toHaveLength(1);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 1, pending: 0 });
    expect(notes().notes).toHaveLength(1);
  });
  it('reuses the earlier locator without a second association', async () => {
    const input = request('git commit -q --allow-empty -m locator', { transcriptLocator: '/later' });
    const result = await enrolled(input);
    shell(result.updatedInput.command as string);
    const captured = itemAt(receipts(input), 0);
    execFileSync(notesExecutable, ['notes', 'add', captured.sha, '--format', 'json'], {
      cwd: repo,
      input: JSON.stringify({ schemaVersion: 1, host: 'claude', sessionId: 'session-a' })
    });
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 1, pending: 0 });
    expect(notes(captured.sha).notes).toHaveLength(1);
    expect(itemAt(notes(captured.sha).notes, 0).document).not.toHaveProperty('transcriptLocator');
    expect(warnings.some((warning) => warning.includes('conflicting transcript locator'))).toBe(true);
  });
  it('preserves pending state when the CLI storage file is corrupt', async () => {
    const input = request('git commit -q --allow-empty -m corrupt');
    const result = await enrolled(input);
    shell(result.updatedInput.command as string);
    const captured = itemAt(receipts(input), 0);
    execFileSync(notesExecutable, ['notes', 'add', captured.sha, '{}', '--format', 'json'], { cwd: repo });
    writeFileSync(join(captured.repository.commonDirectory, 'span', 'notes.db'), 'corrupt storage');
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 0, pending: 1 });
    expect(receipts(input)).toHaveLength(1);
  });
  it('refuses a malformed receipt independently of a successful commit and restores original input', async () => {
    const input = request('git commit -q --allow-empty -m malformed');
    const result = await enrolled(input);
    shell(result.updatedInput.command as string);
    const path = join(directory(input), 'receipts', itemAt(readdirSync(join(directory(input), 'receipts')), 0));
    atomicJson(path, { ...receipts(input)[0], sha: 'abbreviated' });
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({
      acknowledged: 0,
      pending: 1,
      original: { input: input.toolInput }
    });
    expect(notes().notes).toEqual([]);
  });
  it('limits the entire two-receipt timeout phase to three seconds and retains pending work', async () => {
    const input = request('git commit -q --allow-empty -m one; git commit -q --allow-empty -m two');
    const result = await enrolled(input);
    shell(result.updatedInput.command as string);
    const stall = join(scratch, 'stall-cli');
    writeFileSync(stall, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    chmodSync(stall, 0o700);
    const started = performance.now();
    expect(await terminalCommitInvocation(input, { ...options, notesExecutable: stall }, logger)).toMatchObject({
      acknowledged: 0,
      pending: 2,
      original: { input: input.toolInput }
    });
    expect(performance.now() - started).toBeLessThan(3250);
    expect(receipts(input)).toHaveLength(2);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 2, pending: 0 });
  });
  it('kills only the owned notes process group when a descendant retains inherited pipes', async () => {
    const descendant = join(scratch, 'descendant.pid');
    const script = join(scratch, 'descendant-cli');
    writeFileSync(
      script,
      `#!${process.execPath}\nconst {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); writeFileSync(${JSON.stringify(descendant)},String(child.pid)); setInterval(()=>{},1000);\n`,
      { mode: 0o700 }
    );
    const started = performance.now();
    const result = await executeCommitNotes(script, { cwd: repo, argv: [], timeoutMs: 200, maxOutputBytes: 4096 });
    expect(result.timedOut).toBe(true);
    expect(performance.now() - started).toBeLessThan(700);
    const pid = Number(readFileSync(descendant, 'utf8'));
    await delay(30);
    const stat = `/proc/${pid}/stat`;
    expect(!existsSync(stat) || /\) Z /.test(readFileSync(stat, 'utf8'))).toBe(true);
    expect(process.kill(process.pid, 0)).toBe(true);
  });
  it('recovers a primary claim only after its real owner is killed', async () => {
    const input = request('git commit -q --allow-empty -m dead-owner');
    const result = await enrolled(input);
    shell(result.updatedInput.command as string);
    const captured = itemAt(receipts(input), 0);
    const claimKey = `association-${commitAssociationKey(captured, createCommitNoteDocument(result.enrollment))}`;
    const child = spawn(process.execPath, [bundle, '--hold-claim', stateRoot, claimKey]);
    await new Promise<void>((resolveReady, reject) => {
      child.stdout.once('data', () => resolveReady());
      child.once('error', reject);
      child.once('exit', (status) => {
        if (status !== null) reject(new Error(`owner exited ${status}`));
      });
    });
    child.kill('SIGKILL');
    await new Promise<void>((resolveDead) => {
      child.once('close', () => resolveDead());
    });
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 1, pending: 0 });
  });
  it('refuses a live primary owner until release and an uncertain recovery guard without stealing', async () => {
    const input = request('git commit -q --allow-empty -m live-owner');
    const result = await enrolled(input);
    shell(result.updatedInput.command as string);
    const captured = itemAt(receipts(input), 0);
    const key = `association-${commitAssociationKey(captured, createCommitNoteDocument(result.enrollment))}`;
    const held = await acquireReceiptClaim(stateRoot, key, performance.now() + 1000);
    expect(held).not.toBeNull();
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 0, pending: 1 });
    held?.release();
    const guard = join(stateRoot, 'claims', `${key}.guard`);
    mkdirSync(guard, { mode: 0o700 });
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 0, pending: 1 });
    expect(existsSync(guard)).toBe(true);
    rmSync(guard, { recursive: true });
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 1, pending: 0 });
  });
  it('preserves an actually live yielded Codex lease through Stop then records the original terminal identity', async () => {
    const input = request('git commit -q --allow-empty -m yielded; printf "ready\\n"; read -r done', { host: 'codex' });
    const result = await enrolled(input);
    const child = spawn('/bin/bash', ['-c', result.updatedInput.command as string], { cwd: repo });
    await new Promise<void>((resolveReady, reject) => {
      child.stdout.once('data', () => resolveReady());
      child.once('error', reject);
    });
    expect(await cleanupCommitInvocations('codex', input.sessionId, options, logger)).toEqual({
      acknowledged: 0,
      pending: 0,
      retired: 0
    });
    expect(receipts(input)).toHaveLength(1);
    child.stdin.end('done\n');
    await new Promise<void>((resolveDone) => {
      child.once('close', () => resolveDone());
    });
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 1, pending: 0 });
    await cleanupCommitInvocations('codex', input.sessionId, options, logger);
    expect(
      await enrollCommitInvocation(
        request('git status --porcelain', { host: 'codex', toolUseId: 'next-tool' }),
        options,
        logger
      )
    ).toMatchObject({ kind: 'enrolled' });
  });
  it('expires abandoned missing-terminal state after retention with a diagnostic and never reenrolls a late post', async () => {
    const input = request('git commit -q --allow-empty -m abandoned');
    const result = await enrolled(input);
    shell(result.updatedInput.command as string);
    const statePath = join(directory(input), 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    atomicJson(statePath, { ...state, lastActivityMs: Date.now() - 86400001 });
    expect(await cleanupCommitInvocations('claude', input.sessionId, options, logger)).toMatchObject({ retired: 1 });
    expect(warnings.some((warning) => warning.includes('expired abandoned'))).toBe(true);
    expect(await terminalCommitInvocation(input, options, logger)).toEqual({
      original: null,
      acknowledged: 0,
      pending: 0
    });
    expect(notes().notes).toEqual([]);
  });
  it('records independent simultaneous sessions and linked worktrees with nonce isolation', async () => {
    git(['commit', '-q', '--allow-empty', '-m', 'base']);
    const linked = join(scratch, 'parallel');
    git(['worktree', 'add', '-q', '-b', 'parallel', linked]);
    const a = request('git commit -q --allow-empty -m a');
    const b = request('git commit -q --allow-empty -m b', {
      host: 'codex',
      sessionId: 'session-b',
      toolUseId: 'tool-b',
      cwd: linked
    });
    const [ea, eb] = await Promise.all([enrolled(a), enrolled(b)]);
    const outcomes = await Promise.all([
      childResult(ea.updatedInput.command as string),
      childResult(eb.updatedInput.command as string, linked)
    ]);
    expect(outcomes.every((outcome) => outcome.status === 0)).toBe(true);
    const capturedA = itemAt(receipts(a), 0);
    const capturedB = itemAt(receipts(b), 0);
    expect(capturedA.nonce).not.toBe(capturedB.nonce);
    expect(capturedA.repository.commonDirectory).toBe(capturedB.repository.commonDirectory);
    expect(await terminalCommitInvocation({ ...b, sessionId: 'wrong-session' }, options, logger)).toMatchObject({
      acknowledged: 0,
      original: null
    });
    const drained = await Promise.all([
      terminalCommitInvocation(a, options, logger),
      terminalCommitInvocation(b, options, logger)
    ]);
    expect(drained.every((result) => result.acknowledged === 1)).toBe(true);
    expect(notes().notes).toHaveLength(2);
  });
  it('preserves inherited Git stdio/environment and actual child signal termination', async () => {
    const input = request('git hash-object --stdin');
    await enrolled(input);
    const shim = join(directory(input), 'bin', 'git');
    const streamed = spawnSync(shim, ['hash-object', '--stdin'], {
      cwd: repo,
      input: 'content',
      encoding: 'utf8',
      env: { ...process.env, GIT_REFLOG_ACTION: 'caller-action' }
    });
    expect(streamed.status).toBe(0);
    expect(streamed.stdout.trim()).toBe(
      execFileSync('git', ['hash-object', '--stdin'], { cwd: repo, input: 'content', encoding: 'utf8' }).trim()
    );
    const child = spawn(shim, ['hash-object', '--stdin'], { cwd: repo });
    await delay(100);
    child.kill('SIGTERM');
    const outcome = await new Promise<{ status: number | null; signal: string | null }>((resolveDone) => {
      child.once('close', (status, signal) => resolveDone({ status, signal }));
    });
    expect(outcome).toEqual({ status: null, signal: 'SIGTERM' });
    expect(receipts(input)).toEqual([]);
  });
  it('fails capacity enrollment closed while returning the original command as unavailable', async () => {
    const first = request('git status --porcelain');
    await enrolled(first);
    atomicJson(join(stateRoot, 'usage.json'), { invocations: 4096, totalBytes: 67108864 });
    const input = request('git status --porcelain', { toolUseId: 'overflow' });
    expect(await enrollCommitInvocation(input, options, logger)).toMatchObject({ kind: 'unavailable' });
    expect(existsSync(directory(input))).toBe(false);
    expect(warnings).toHaveLength(1);
  });
});

describe('real Git evidence ambiguity and forwarding', () => {
  it.each([
    ['replacement', 'mv .git/logs/HEAD .git/logs/HEAD.old; : > .git/logs/HEAD'],
    ['malformed append', "printf 'malformed\\n' >> .git/logs/HEAD"],
    ['truncated append', ': > .git/logs/HEAD']
  ])('suppresses %s evidence while preserving the successful Git result', async (_label, action) => {
    git(['commit', '-q', '--allow-empty', '-m', 'before']);
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\n${action}\n`, { mode: 0o700 });
    const input = request('git commit -q --allow-empty -m after');
    const result = await enrolled(input);
    expect(shell(result.updatedInput.command as string).status).toBe(0);
    expect(receipts(input)).toEqual([]);
    await terminalCommitInvocation(input, options, logger);
    expect(notes().notes).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
  it('suppresses native-child movement carrying a second matching nonce', async () => {
    git(['commit', '-q', '--allow-empty', '-m', 'before']);
    writeFileSync(join(repo, '.git', 'hooks', 'post-commit'), '#!/bin/sh\ngit reset --hard HEAD~1 >/dev/null\n', {
      mode: 0o700
    });
    const input = request('git commit -q --allow-empty -m after');
    const result = await enrolled(input);
    expect(shell(result.updatedInput.command as string)).toMatchObject({ status: 0, stdout: '', stderr: '' });
    expect(receipts(input)).toEqual([]);
    await terminalCommitInvocation(input, options, logger);
    expect(warnings.some((warning) => warning.includes('ambiguous nonce'))).toBe(true);
    expect(notes().notes).toEqual([]);
  });
  it('suppresses excessive reflog append bytes with a bounded diagnostic', async () => {
    git(['commit', '-q', '--allow-empty', '-m', 'before']);
    writeFileSync(
      join(repo, '.git', 'hooks', 'post-commit'),
      `#!${process.execPath}\nrequire('node:fs').appendFileSync('.git/logs/HEAD','x'.repeat(1048577));\n`,
      { mode: 0o700 }
    );
    const input = request('git commit -q --allow-empty -m large');
    const result = await enrolled(input);
    expect(shell(result.updatedInput.command as string).status).toBe(0);
    expect(receipts(input)).toEqual([]);
    await terminalCommitInvocation(input, options, logger);
    expect(warnings.some((warning) => warning.includes('exceeds budget'))).toBe(true);
  });
  it('stops receipt publication at the invocation cap without changing successful commit status', async () => {
    const input = request('git commit -q --allow-empty -m cap');
    const result = await enrolled(input);
    const usagePath = join(directory(input), 'usage.json');
    const usage = JSON.parse(readFileSync(usagePath, 'utf8'));
    atomicJson(usagePath, { ...usage, receipts: 256 });
    expect(shell(result.updatedInput.command as string).status).toBe(0);
    expect(receipts(input)).toEqual([]);
    await terminalCommitInvocation(input, options, logger);
    expect(warnings.some((warning) => warning.includes('capacity exceeded'))).toBe(true);
  });
  it('executes the exact original builtin argv once through a real Git adapter and restores caller reflog action', async () => {
    const audit = join(scratch, 'git-audit.jsonl');
    const executableDir = join(scratch, 'original git');
    mkdirSync(executableDir);
    const wrapper = join(executableDir, 'git');
    writeFileSync(
      wrapper,
      `#!${process.execPath}\nconst fs=require('node:fs'); const cp=require('node:child_process'); fs.appendFileSync(${JSON.stringify(audit)},JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),action:process.env.GIT_REFLOG_ACTION})+'\\n'); const result=cp.spawnSync('/usr/bin/git',process.argv.slice(2),{stdio:'inherit',env:process.env}); process.exit(result.status??127);\n`,
      { mode: 0o700 }
    );
    const originalPath = process.env.PATH;
    process.env.PATH = `${executableDir}:${originalPath}`;
    const input = request("git commit -q --allow-empty -m 'exact message'; printf '%s' \"$GIT_REFLOG_ACTION\"");
    let result: Awaited<ReturnType<typeof enrolled>>;
    try {
      result = await enrolled(input);
    } finally {
      process.env.PATH = originalPath;
    }
    const outcome = spawnSync('/bin/bash', ['-c', result.updatedInput.command as string], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GIT_REFLOG_ACTION: 'caller-action' }
    });
    expect(outcome).toMatchObject({ status: 0, stdout: 'caller-action', stderr: '' });
    const calls = readFileSync(audit, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { argv: string[]; cwd: string; action: string });
    const commits = calls.filter((call) => call.argv[0] === 'commit');
    expect(commits).toHaveLength(1);
    expect(itemAt(commits, 0).argv).toEqual(['commit', '-q', '--allow-empty', '-m', 'exact message']);
    expect(itemAt(commits, 0).cwd).toBe(repo);
    expect(itemAt(commits, 0).action).toMatch(/^receipt-[a-f0-9]+$/);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 1 });
  });
  it('allows the user command when actual lease publication fails under errexit without extra stderr', async () => {
    const input = request('printf user-output; exit 7');
    const result = await enrolled(input);
    rmSync(join(directory(input), 'lease'));
    mkdirSync(join(directory(input), 'lease'));
    const outcome = spawnSync('/bin/bash', ['-e', '-c', result.updatedInput.command as string], {
      cwd: repo,
      encoding: 'utf8'
    });
    expect(outcome).toMatchObject({ status: 7, stdout: 'user-output', stderr: '' });
  });
});

describe('bounded notes UTF-8 protocol', () => {
  it('decodes real JSON output split across a multibyte session and locator boundary', async () => {
    const script = join(scratch, 'unicode-cli');
    const value = { sessionId: 'session-🐦', transcriptLocator: '/資料/会話.jsonl' };
    const encoded = JSON.stringify(value);
    const split = Buffer.from(encoded).indexOf(Buffer.from('🐦')) + 1;
    writeFileSync(
      script,
      `#!${process.execPath}\nconst bytes=Buffer.from(${JSON.stringify(encoded)}); process.stdout.write(bytes.subarray(0,${split})); setTimeout(()=>{process.stdout.write(bytes.subarray(${split}));},40);\n`,
      { mode: 0o700 }
    );
    const outcome = await executeCommitNotes(script, { cwd: repo, argv: [], timeoutMs: 1000, maxOutputBytes: 4096 });
    expect(outcome).toMatchObject({ exitCode: 0, timedOut: false, outputExceeded: false });
    expect(JSON.parse(outcome.stdout)).toEqual(value);
    expect(outcome.stdout).not.toContain('�');
  });
});

describe('original lexical cwd restoration', () => {
  it('restores a symlink cwd exactly while keeping the witnessed repository canonical', async () => {
    const lexicalCwd = join(scratch, 'repo alias');
    symlinkSync(repo, lexicalCwd);
    const input = request('git commit -q --allow-empty -m lexical', { cwd: lexicalCwd });
    const result = await enrolled(input);
    expect(result.enrollment.cwd).toBe(lexicalCwd);
    expect(shell(result.updatedInput.command as string, lexicalCwd).status).toBe(0);
    expect(itemAt(receipts(input), 0).repository.cwd).toBe(repo);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({
      acknowledged: 1,
      original: { cwd: lexicalCwd }
    });
  });
});

describe('accepted envelope and executable-search boundaries', () => {
  it.each(['claude', 'codex'] as const)(
    '%s rejects unreadable persisted envelopes before publishing a replacement',
    async (host) => {
      const command = `git commit -q --allow-empty -m oversized; #${'x'.repeat(100000)}`;
      const input = request(command, { host, toolInput: { command, description: 'y'.repeat(900000) } });
      const result = await enrollCommitInvocation(input, options, logger);
      expect(result.kind).toBe('unsupported');
      expect(existsSync(directory(input))).toBe(false);
      expect(warnings.length).toBeGreaterThan(0);
      expect(shell(command).status).toBe(0);
      expect(notes().notes).toEqual([]);
    }
  );
  it.each(
    (['claude', 'codex'] as const).flatMap((host) =>
      [
        'builtin -- command -p git',
        'builtin -- hash -p /usr/bin/git git; git',
        'builtin -- export PATH=/usr/bin; git',
        'builtin builtin command -p git',
        'command builtin command -p git',
        'builtin command env --unset=PATH git',
        'command builtin -- export PATH=/usr/bin; git',
        'builtin command -p git',
        'builtin hash -p /usr/bin/git git; git',
        'builtin export PATH=/usr/bin; git',
        'command -p git',
        'env -u PATH git',
        'env --unset=PATH git',
        '/usr/bin/env -i git',
        'hash -p /usr/bin/git git; git',
        'command env --unset PATH git',
        'exec /usr/bin/env -uPATH git',
        'env -- /usr/bin/env --ignore-environment git',
        'env -iuPATH git'
      ].map((prefix) => ({ host, prefix }))
    )
  )('$host diagnoses visible search mutation $prefix and preserves original execution', async ({ host, prefix }) => {
    const command = `${prefix} commit -q --allow-empty -m bypass`;
    const input = request(command, { host });
    expect(await enrollCommitInvocation(input, options, logger)).toMatchObject({ kind: 'unsupported' });
    expect(existsSync(directory(input))).toBe(false);
    expect(warnings.length).toBeGreaterThan(0);
    expect(shell(command).status).toBe(0);
    expect(notes().notes).toEqual([]);
  });
});

describe('ordinary explicit builtin dispatch', () => {
  it.each(
    (['claude', 'codex'] as const).flatMap((host) =>
      ['builtin -- command -- git', 'command builtin -- command -- git'].map((prefix) => ({ host, prefix }))
    )
  )('$host records supported $prefix and restores the original input without warnings', async ({ host, prefix }) => {
    const command = `${prefix} commit -q --allow-empty -m supported-builtin`;
    const input = request(command, { host });
    const result = await enrolled(input);
    expect(shell(result.updatedInput.command as string).status).toBe(0);
    expect(receipts(input)).toHaveLength(1);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({
      acknowledged: 1,
      original: { input: input.toolInput, command }
    });
    expect(notes().notes).toHaveLength(1);
    expect(warnings).toEqual([]);
  });
});
