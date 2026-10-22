/** Real Git exercises observation, overlapping windows, durable notes and lifecycle retries. */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitReceipt } from '../../src/common/commit-contracts.js';
import { COMMIT_RECEIPT_LIMITS } from '../../src/common/commit-limits.js';
import { executeCommitNotes } from '../../src/common/commit-native-io.js';
import {
  type CommitEnrollmentRequest,
  type CommitRuntimeOptions,
  cleanupCommitInvocations,
  enrollCommitInvocation,
  terminalCommitInvocation
} from '../../src/common/commit-runtime.js';
import { atomicJson, identityKey } from '../../src/common/commit-storage.js';
import { buildWorkspaceGitSpan } from '../real-bundle-helpers.js';

let binary: string;
let scratch: string;
let repo: string;
let options: CommitRuntimeOptions;
let warnings: string[];
const logger = { warn: (message: string) => warnings.push(message) };
function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
}
function makeRepo(path: string, format = 'sha1') {
  mkdirSync(path, { recursive: true });
  git(['init', '-q', `--object-format=${format}`], path);
  git(['config', 'user.name', 'Observation Agent'], path);
  git(['config', 'user.email', 'observation@example.test'], path);
}
function request(command: string, extra: Partial<CommitEnrollmentRequest> = {}): CommitEnrollmentRequest {
  return {
    host: 'claude',
    sessionId: 'session-a',
    toolUseId: 'tool-a',
    cwd: repo,
    toolInput: { command, timeout: 10000 },
    ...extra
  };
}
async function enroll(input: CommitEnrollmentRequest) {
  const result = await enrollCommitInvocation(input, options, logger);
  expect(result.kind).toBe('enrolled');
  expect(result).not.toHaveProperty('updatedInput');
  return result;
}
function shell(input: CommitEnrollmentRequest) {
  return spawnSync('bash', ['-c', input.toolInput.command as string], {
    cwd: input.cwd,
    encoding: 'utf8',
    timeout: 15000
  });
}
function directory(input: CommitEnrollmentRequest) {
  return join(options.stateRoot as string, 'invocations', identityKey(input));
}
function notes(sha?: string, cwd = repo): { notes: { commit_sha: string; document: Record<string, unknown> }[] } {
  return JSON.parse(
    execFileSync(binary, ['notes', 'list', ...(sha ? [sha, '--exact'] : []), '--format', 'json'], {
      cwd,
      encoding: 'utf8'
    })
  );
}
async function terminal(input: CommitEnrollmentRequest, overrides: CommitRuntimeOptions = {}) {
  return terminalCommitInvocation(input, { ...options, ...overrides }, logger);
}
beforeAll(() => {
  binary = buildWorkspaceGitSpan().binary;
}, 600000);
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "commit observation 'quoted' "));
  repo = join(scratch, 'repo');
  makeRepo(repo);
  options = { stateRoot: join(scratch, 'private receipts'), notesExecutable: binary, lockExecutable: binary };
  warnings = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

describe('commit observation without command modification', () => {
  it('uses the PATH notes CLI before the Git executable directory', async () => {
    const pathDirectory = join(scratch, 'selected-path');
    const gitDirectory = join(scratch, 'git-exec');
    mkdirSync(pathDirectory);
    mkdirSync(gitDirectory);
    symlinkSync(binary, join(pathDirectory, 'git-span'));
    writeFileSync(join(gitDirectory, 'git-span'), '#!/bin/sh\nexit 17\n', { mode: 0o755 });
    vi.stubEnv('PATH', `${pathDirectory}${delimiter}${process.env.PATH ?? ''}`);
    vi.stubEnv('GIT_EXEC_PATH', gitDirectory);
    options = { stateRoot: options.stateRoot };

    const input = request('git commit -q --allow-empty -m path-precedence');
    await enroll(input);
    expect(shell(input).status).toBe(0);
    expect(await terminal(input)).toMatchObject({ acknowledged: 1, pending: 0 });
    expect(notes().notes).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it.each(['claude', 'codex'] as const)(
    'records an initial quiet %s commit with frozen identity and idempotent posts',
    async (host) => {
      const input = request('git commit -q --allow-empty -m initial', {
        host,
        transcriptLocator: '/frozen/transcript'
      });
      const original = JSON.stringify(input.toolInput);
      await enroll(input);
      expect(JSON.stringify(input.toolInput)).toBe(original);
      expect(readdirSync(directory(input)).sort()).toEqual([
        'enrollment.json',
        'observations.json',
        'receipts',
        'state.json'
      ]);
      expect(shell(input)).toMatchObject({ status: 0, stdout: '', stderr: '' });
      expect(await terminal(input)).toMatchObject({
        acknowledged: 1,
        pending: 0,
        original: { input: input.toolInput, command: input.toolInput.command }
      });
      expect(notes().notes[0]?.document).toEqual({
        schemaVersion: 1,
        host,
        sessionId: input.sessionId,
        transcriptLocator: '/frozen/transcript'
      });
      expect(await terminal(input)).toMatchObject({ acknowledged: 0, pending: 0 });
      expect(notes().notes).toHaveLength(1);
      expect(warnings).toEqual([]);
    }
  );
  it('records multiple commits and amend before reset despite a failing shell', async () => {
    const input = request(
      'git commit -q --allow-empty -m one; git commit -q --allow-empty -m two; git commit -q --allow-empty --amend -m amended; git reset -q --hard HEAD~1; exit 7'
    );
    await enroll(input);
    expect(shell(input).status).toBe(7);
    expect(await terminal(input)).toMatchObject({ acknowledged: 3, pending: 0 });
    expect(notes().notes).toHaveLength(3);
  });
  it.each(['git commit --dry-run', 'git commit -q -m empty'])(
    'records no commit when %s creates none',
    async (command) => {
      git(['commit', '-q', '--allow-empty', '-m', 'initial']);
      const input = request(command);
      await enroll(input);
      shell(input);
      expect(await terminal(input)).toMatchObject({ acknowledged: 0, pending: 0 });
      expect(notes().notes).toEqual([]);
    }
  );
  it('ignores historical checkout/reset while recording commits through aliases', async () => {
    git(['commit', '-q', '--allow-empty', '-m', 'initial']);
    git(['commit', '-q', '--allow-empty', '-m', 'second']);
    git(['config', 'alias.ci', 'commit']);
    const input = request('git reset -q --hard HEAD~1; git checkout -q -; git ci -q --allow-empty -m alias');
    await enroll(input);
    shell(input);
    expect(await terminal(input)).toMatchObject({ acknowledged: 1 });
  });
  it('attributes ambiguous commits to every overlapping session', async () => {
    const a = request('git commit -q --allow-empty -m one');
    const b = request('git commit -q --allow-empty -m two', {
      host: 'codex',
      sessionId: 'session-b',
      toolUseId: 'tool-b'
    });
    await enroll(a);
    await enroll(b);
    shell(a);
    shell(b);
    expect(await terminal(a)).toMatchObject({ acknowledged: 2 });
    expect(await terminal(b)).toMatchObject({ acknowledged: 2 });
    expect(notes().notes).toHaveLength(4);
    expect(new Set(notes().notes.map((note) => note.document.sessionId))).toEqual(new Set(['session-a', 'session-b']));
  });
  it('includes externally made commits within the observation window', async () => {
    const input = request('printf no-git');
    await enroll(input);
    git(['commit', '-q', '--allow-empty', '-m', 'external']);
    expect(await terminal(input)).toMatchObject({ acknowledged: 1 });
  });
  it('preserves custom reflog action, stdout, stderr and shell exit status', async () => {
    const input = request(
      'GIT_REFLOG_ACTION=custom git commit -q --allow-empty -m custom; printf user-output; printf user-error >&2; exit 7'
    );
    await enroll(input);
    expect(shell(input)).toMatchObject({ status: 7, stdout: 'user-output', stderr: 'user-error' });
    expect(git(['reflog', '-1', '--format=%gs'])).toBe('custom: custom');
    expect(await terminal(input)).toMatchObject({ acknowledged: 1 });
  });
  it.each(['PATH=/usr/bin git', '/usr/bin/git', 'command -p git'])(
    'observes %s without needing interception',
    async (prefix) => {
      const input = request(`${prefix} commit -q --allow-empty -m bypass`);
      await enroll(input);
      expect(shell(input).status).toBe(0);
      expect(await terminal(input)).toMatchObject({ acknowledged: 1 });
      expect(warnings).toEqual([]);
    }
  );
  it('discovers repeated -C and explicit repository options outside the tool cwd', async () => {
    const other = join(scratch, 'other');
    makeRepo(other);
    const input = request(`git -C .. -C other --git-dir=.git --work-tree=. commit -q --allow-empty -m other`);
    await enroll(input);
    expect(shell(input).status).toBe(0);
    expect(await terminal(input)).toMatchObject({ acknowledged: 1 });
    expect(notes(undefined, other).notes).toHaveLength(1);
  });
  it('observes literal cd targets and SHA-256 repositories', async () => {
    const other = join(scratch, 'sha256');
    makeRepo(other, 'sha256');
    const input = request('cd ../sha256 && git commit -q --allow-empty -m sha256');
    await enroll(input);
    expect(shell(input).status).toBe(0);
    expect(await terminal(input)).toMatchObject({ acknowledged: 1 });
    expect(notes(undefined, other).notes[0]?.commit_sha).toHaveLength(64);
  });
  it('keeps linked worktree observation independent and lexical cwd intact', async () => {
    git(['commit', '-q', '--allow-empty', '-m', 'initial']);
    const linked = join(scratch, 'linked');
    git(['worktree', 'add', '-q', '-b', 'linked', linked]);
    const alias = join(scratch, 'alias');
    symlinkSync(linked, alias);
    const input = request('git commit -q --allow-empty -m linked', { cwd: alias });
    await enroll(input);
    expect(shell(input).status).toBe(0);
    expect(await terminal(input)).toMatchObject({ acknowledged: 1, original: { cwd: alias } });
    expect(notes().notes).toHaveLength(1);
  });
  it('preserves active invocations through Stop and expires abandoned observations', async () => {
    const input = request('git commit -q --allow-empty -m later', { host: 'codex' });
    await enroll(input);
    expect(await cleanupCommitInvocations('codex', input.sessionId, options, logger)).toMatchObject({ retired: 0 });
    expect(shell(input).status).toBe(0);
    expect(await terminal(input)).toMatchObject({ acknowledged: 1 });
    const path = join(directory(input), 'state.json');
    const state = JSON.parse(readFileSync(path, 'utf8'));
    atomicJson(path, { ...state, lastActivityMs: Date.now() - COMMIT_RECEIPT_LIMITS.abandonedRetentionMs - 1000 });
    expect(await cleanupCommitInvocations('codex', input.sessionId, options, logger)).toMatchObject({ retired: 1 });
    expect(existsSync(directory(input))).toBe(false);
  });
  it('ignores an unmatched terminal identity and serializes duplicate terminal deliveries', async () => {
    const input = request('git commit -q --allow-empty -m duplicate');
    await enroll(input);
    shell(input);
    expect(await terminal({ ...input, toolUseId: 'unknown' })).toMatchObject({ original: null, acknowledged: 0 });
    const results = await Promise.all([terminal(input), terminal(input)]);
    expect(results.reduce((sum, result) => sum + result.acknowledged, 0)).toBe(1);
    expect(notes().notes).toHaveLength(1);
  });
  it('freezes observations at terminal and retries durable receipts without capturing later commits', async () => {
    const input = request('git commit -q --allow-empty -m retained');
    await enroll(input);
    shell(input);
    const sha = git(['rev-parse', 'HEAD']);
    expect(await terminal(input, { notesExecutable: '/missing-notes' })).toMatchObject({ acknowledged: 0, pending: 1 });
    git(['commit', '-q', '--allow-empty', '-m', 'later']);
    expect(await terminal(input)).toMatchObject({ acknowledged: 1, pending: 0 });
    expect(notes(sha).notes).toHaveLength(1);
    expect(notes(git(['rev-parse', 'HEAD'])).notes).toEqual([]);
  });
  it('retains malformed receipts and refuses corrupt notes storage', async () => {
    const input = request('git commit -q --allow-empty -m malformed');
    await enroll(input);
    shell(input);
    await terminal(input, { notesExecutable: '/missing-notes' });
    const receipts = join(directory(input), 'receipts');
    const path = join(receipts, readdirSync(receipts)[0] as string);
    const receipt = JSON.parse(readFileSync(path, 'utf8')) as CommitReceipt;
    atomicJson(path, { ...receipt, sha: 'abbreviated' });
    expect(await terminal(input)).toMatchObject({ acknowledged: 0, pending: 1 });
    expect(notes().notes).toEqual([]);
    atomicJson(path, receipt);
    execFileSync(binary, ['notes', 'add', receipt.sha, '{}', '--format', 'json'], { cwd: repo });
    writeFileSync(join(repo, '.git', 'span', 'notes.db'), 'corrupt storage');
    expect(await terminal(input)).toMatchObject({ acknowledged: 0, pending: 1 });
  });
  it("locks only the ending session's invocations, not every other session's", async () => {
    for (const other of ['session-b', 'session-c', 'session-d']) {
      const foreign = request('printf foreign', { sessionId: other, toolUseId: `tool-${other}`, cwd: scratch });
      await enroll(foreign);
      await terminal(foreign);
    }
    const own = request('printf own', { cwd: scratch });
    await enroll(own);
    await terminal(own);
    const calls = join(scratch, 'lock-calls');
    const counting = join(scratch, 'counting-lock');
    symlinkSync(binary, join(scratch, 'real-git-span'));
    writeFileSync(
      counting,
      '#!/bin/sh\nd=$(dirname "$0")\necho locked >> "$d/lock-calls"\nexec "$d/real-git-span" "$@"\n',
      {
        mode: 0o700
      }
    );

    expect(
      await cleanupCommitInvocations('claude', own.sessionId, { ...options, lockExecutable: counting }, logger)
    ).toMatchObject({ retired: 1 });
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(warnings).toEqual([]);
  });
  it('still expires another session abandoned state during cleanup', async () => {
    const foreign = request('printf foreign', { sessionId: 'session-b', toolUseId: 'tool-b', cwd: scratch });
    await enroll(foreign);
    await terminal(foreign);
    const state = join(directory(foreign), 'state.json');
    const stored = JSON.parse(readFileSync(state, 'utf8')) as { lastActivityMs: number };
    atomicJson(state, { ...stored, lastActivityMs: Date.now() - COMMIT_RECEIPT_LIMITS.abandonedRetentionMs - 1 });

    expect(await cleanupCommitInvocations('claude', 'session-a', options, logger)).toMatchObject({ retired: 1 });
    expect(existsSync(directory(foreign))).toBe(false);
  });
  it('bounds the notes phase and retries after a stalled CLI', async () => {
    const input = request('git commit -q --allow-empty -m stalled');
    await enroll(input);
    shell(input);
    const stalled = join(scratch, 'stalled');
    writeFileSync(stalled, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n', { mode: 0o700 });
    const started = performance.now();
    expect(await terminal(input, { notesExecutable: stalled })).toMatchObject({ acknowledged: 0, pending: 1 });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(await cleanupCommitInvocations('claude', input.sessionId, options, logger)).toMatchObject({
      acknowledged: 1,
      pending: 0,
      retired: 1
    });
  });
  it.each(['replaced', 'truncated', 'regrown', 'incomplete', 'excessive'])(
    'rejects %s reflog evidence',
    async (kind) => {
      git(['commit', '-q', '--allow-empty', '-m', 'initial']);
      const input = request('git commit -q --allow-empty -m unsafe');
      await enroll(input);
      shell(input);
      const path = join(repo, '.git', 'logs', 'HEAD');
      if (kind === 'replaced') {
        const text = readFileSync(path);
        renameSync(path, `${path}.old`);
        writeFileSync(path, text);
      }
      if (kind === 'truncated') writeFileSync(path, '');
      if (kind === 'regrown') writeFileSync(path, Buffer.alloc(readFileSync(path).length + 128, 120));
      if (kind === 'incomplete') writeFileSync(path, readFileSync(path).subarray(0, -1));
      if (kind === 'excessive')
        writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.alloc(COMMIT_RECEIPT_LIMITS.reflogBytes + 1)]));
      expect(await terminal(input)).toMatchObject({ acknowledged: 0, pending: 0 });
      expect(warnings.some((warning) => warning.includes('commit observation'))).toBe(true);
    }
  );
  it('supports ordinary tools outside a repository without diagnostics', async () => {
    const input = request('printf user-output', { cwd: scratch });
    await enroll(input);
    expect(shell(input).stdout).toBe('user-output');
    expect(await terminal(input)).toMatchObject({ acknowledged: 0 });
    expect(warnings).toEqual([]);
  });
  it('rejects background commands and oversized envelopes without affecting execution', async () => {
    for (const command of ['git commit -m x &', `printf user-output; #${'x'.repeat(1100000)}`]) {
      expect((await enrollCommitInvocation(request(command), options, logger)).kind).not.toBe('enrolled');
    }
    const input = request('printf user-output', {
      toolInput: { command: 'printf user-output', description: 'x'.repeat(1100000) }
    });
    expect((await enrollCommitInvocation(input, options, logger)).kind).not.toBe('enrolled');
    expect(shell(input).stdout).toBe('user-output');
  });
  it('decodes split multibyte notes output correctly', async () => {
    const script = join(scratch, 'unicode-cli');
    const encoded = JSON.stringify({ sessionId: 'session-🐦', transcriptLocator: '/資料/会話' });
    const split = Buffer.from(encoded).indexOf(Buffer.from('🐦')) + 1;
    writeFileSync(
      script,
      `#!${process.execPath}\nconst bytes=Buffer.from(${JSON.stringify(encoded)}); process.stdout.write(bytes.subarray(0,${split})); setTimeout(()=>process.stdout.write(bytes.subarray(${split})),40);\n`,
      { mode: 0o700 }
    );
    const result = await executeCommitNotes(script, { cwd: repo, argv: [], timeoutMs: 1000, maxOutputBytes: 4096 });
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result.stdout).toBe(encoded);
  });
});

describe('windowed receipt store', () => {
  /** Finished entries cloned from a real enrollment; ordering is carried by lastActivityMs. */
  async function seedInvocations(count: number, status: 'retired' | 'acknowledged' | 'active', offset = 0) {
    const template = request('printf seed', { cwd: scratch, toolUseId: `template-${status}-${offset}` });
    await enroll(template);
    await terminal(template);
    const source = directory(template);
    const invocations = join(options.stateRoot as string, 'invocations');
    const names: string[] = [];
    for (let index = 0; index < count; index++) {
      const name = `${status}-${String(offset + index).padStart(5, '0')}`;
      cpSync(source, join(invocations, name), { recursive: true });
      const statePath = join(invocations, name, 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(
        statePath,
        JSON.stringify({
          ...state,
          status,
          observing: status === 'active',
          lastActivityMs: status === 'active' ? Date.now() : offset + index + 1
        })
      );
      names.push(name);
    }
    rmSync(source, { recursive: true });
    return names;
  }
  function invocationNames() {
    return readdirSync(join(options.stateRoot as string, 'invocations'));
  }
  /** Eviction is time-bounded, so a slow host finishes the batch over later enrollments; run them until the store settles. */
  async function settle(limit: number) {
    for (let attempt = 0; attempt < 20 && invocationNames().length > limit; attempt++)
      await enrollCommitInvocation(request(`git commit -q --allow-empty -m settle-${attempt}`), options, logger);
  }

  it('attributes a commit when the retired global ledger reads full', async () => {
    mkdirSync(options.stateRoot as string, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(options.stateRoot as string, 'usage.json'),
      JSON.stringify({ invocations: 655, totalBytes: 67_036_036 }),
      { mode: 0o600 }
    );
    const input = request('git commit -q --allow-empty -m after-ledger-full');
    await enroll(input);
    expect(shell(input).status).toBe(0);
    expect(await terminal(input)).toMatchObject({ acknowledged: 1, pending: 0 });
    expect(notes().notes).toHaveLength(1);
  });

  it('evicts the oldest finished entries in a batch and never the entry being enrolled', async () => {
    const retired = await seedInvocations(400, 'retired');
    const acknowledged = await seedInvocations(300, 'acknowledged', 400);
    const active = await seedInvocations(2, 'active', 700);
    const input = request('git commit -q --allow-empty -m windowed');
    await enroll(input);
    await settle(512);
    const names = invocationNames();
    expect(names.length).toBeLessThanOrEqual(512);
    expect(names.length).toBeGreaterThan(300);
    expect(names).toContain(identityKey(input));
    expect(names.filter((name) => name.startsWith('.'))).toEqual([]);
    for (const name of active) expect(names).toContain(name);
    expect(names).not.toContain(retired[0]);
    expect(names).toContain(acknowledged[acknowledged.length - 1]);
    expect(shell(input).status).toBe(0);
    expect(await terminal(input)).toMatchObject({ acknowledged: 1, pending: 0 });
    expect(notes().notes).toHaveLength(1);
  });

  it('skips a candidate whose lock times out and keeps evicting the rest, logging at info', async () => {
    const retired = await seedInvocations(600, 'retired');
    const claims = join(options.stateRoot as string, 'claims');
    mkdirSync(claims, { recursive: true, mode: 0o700 });
    // A real contender holds the oldest candidate's lock, so the helper reports a timeout by throwing.
    const holder = spawn(
      binary,
      ['__receipt-lock', '--directory', claims, '--key', `invocation-${retired[0]}`, '--wait-ms', '5000'],
      { stdio: ['pipe', 'pipe', 'ignore'] }
    );
    try {
      await new Promise<void>((resolve, reject) => {
        holder.once('error', reject);
        holder.stdout.once('data', () => resolve());
      });
      const infos: string[] = [];
      const input = request('git commit -q --allow-empty -m contended');
      const result = await enrollCommitInvocation(input, options, {
        warn: (message) => warnings.push(message),
        info: (message) => infos.push(message)
      });
      expect(result.kind).toBe('enrolled');
      expect(warnings).toEqual([]);
      expect(infos.some((message) => message.includes('evicted'))).toBe(true);
      const names = invocationNames();
      expect(names).toContain(retired[0]);
      expect(names).not.toContain(retired[1]);
      expect(names.length).toBeLessThan(retired.length);
    } finally {
      holder.stdin.end();
    }
  });

  it('removes the retired global usage ledger during store maintenance', async () => {
    mkdirSync(options.stateRoot as string, { recursive: true, mode: 0o700 });
    const ledger = join(options.stateRoot as string, 'usage.json');
    writeFileSync(ledger, JSON.stringify({ invocations: 655, totalBytes: 67_036_036 }), { mode: 0o600 });
    await enroll(request('printf ok'));
    expect(existsSync(ledger)).toBe(false);
  });

  it('does not scan or evict while the store is within its window', async () => {
    const seeded = await seedInvocations(10, 'retired');
    await enroll(request('printf ok'));
    expect(invocationNames()).toEqual(expect.arrayContaining(seeded));
  });
});
