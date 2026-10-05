/** Real deployed bundles, Git commits and notes CLI exercise the host receipt boundary. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@goodfoot/agent-hooks/codex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandler as createPost } from '../../src/codex/post-tool-use.js';
import { createHandler as createPre } from '../../src/codex/static-plan.js';
import { createSessionLayout } from '../../src/common/agent-hooks-common.js';
import type { CommitReceipt } from '../../src/common/commit-contracts.js';
import { type CommitInvocationState, transitionCommitInvocation } from '../../src/common/commit-lifecycle.js';
import { terminalCommitInvocation } from '../../src/common/commit-runtime.js';
import { itemAt, present } from '../helpers.js';
import {
  addLineSpan,
  type BuiltRealHookBundles,
  buildRealHookBundles,
  buildWorkspaceGitSpan,
  commitRepo,
  hookContext,
  invokeRealHook,
  makeRealBundleRepo,
  type RealBundleRepo,
  runRealShell,
  writeRepoFile
} from '../real-bundle-helpers.js';

let bundles: BuiltRealHookBundles;
let binary: string;
let pathDir: string;
let previousPath: string | undefined;
let hooks: string;
const repos: RealBundleRepo[] = [];
beforeAll(() => {
  ({ binary, pathDir } = buildWorkspaceGitSpan());
  bundles = buildRealHookBundles();
  hooks = bundles.codexHooksDir;
  previousPath = process.env.PATH;
  process.env.PATH = `${pathDir}:${previousPath ?? ''}`;
}, 600_000);
afterAll(() => {
  process.env.PATH = previousPath;
  for (const repo of repos) repo.cleanup();
  bundles?.cleanup();
});
function fixture(): RealBundleRepo {
  const repo = makeRealBundleRepo(pathDir);
  repos.push(repo);
  writeRepoFile(repo, 'app.ts', 'alpha\nbeta\ngamma\n');
  commitRepo(repo, 'initial');
  addLineSpan(
    repo,
    'example/receipt-context',
    'app.ts',
    1,
    3,
    'Original source context survives receipt instrumentation.'
  );
  return repo;
}
function envelope(repo: RealBundleRepo, id: string, command: string): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'receipt-session',
    tool_use_id: id,
    transcript_path: '/frozen/transcript.jsonl',
    cwd: repo.root,
    tool_name: 'Bash',
    tool_input: { command, timeout: 20_000, description: 'preserve auxiliary fields' },
    permission_mode: 'default',
    model: 'fixture',
    turn_id: 'turn-1'
  };
}
function prepare(repo: RealBundleRepo, input: Record<string, unknown>) {
  const result = invokeRealHook(join(hooks, 'static-plan.mjs'), input, repo.env);
  const specific = result.output?.hookSpecificOutput as Record<string, unknown>;
  expect(specific).toBeDefined();
  expect(specific.permissionDecision).toBe('allow');
  const updated = specific.updatedInput as Record<string, unknown>;
  expect(updated.command).not.toBe((input.tool_input as Record<string, unknown>).command);
  expect(updated).toMatchObject({ timeout: 20_000, description: 'preserve auxiliary fields' });
  return updated;
}
function notes(repo: RealBundleRepo) {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.root, env: repo.env, encoding: 'utf8' }).trim();
  const output = JSON.parse(
    execFileSync(binary, ['notes', 'list', sha, '--exact', '--format', 'json'], {
      cwd: repo.root,
      env: repo.env,
      encoding: 'utf8'
    })
  );
  return output.notes as { document: Record<string, unknown> }[];
}
function post(
  repo: RealBundleRepo,
  input: Record<string, unknown>,
  updated: Record<string, unknown>,
  response: unknown
) {
  return invokeRealHook(
    join(hooks, 'post-tool-use.mjs'),
    {
      ...input,
      hook_event_name: 'PostToolUse',
      tool_input: updated,
      tool_response: response
    },
    repo.env
  );
}
function layoutFor(repo: RealBundleRepo) {
  return createSessionLayout(join(repo.home, '.cache', 'git-span', 'session'));
}
function stateRoot(repo: RealBundleRepo) {
  return join(repo.home, '.cache', 'git-span', 'commit-receipts');
}

describe('codex deployed commit adapters', () => {
  it('records a successful quiet commit and preserves original context and frozen identity', async () => {
    const repo = fixture();
    const input = envelope(repo, 'success', 'git commit -q --allow-empty -m attributed; cat app.ts');
    const updated = prepare(repo, input);
    const shell = runRealShell(repo, updated.command as string);
    expect(shell.exitCode).toBe(0);
    const result = post(repo, input, updated, shell.stdout);
    expect(hookContext(result.output)).toContain('example/receipt-context');
    expect(notes(repo)).toEqual([
      {
        ...notes(repo)[0],
        document: {
          schemaVersion: 1,
          host: 'codex',
          sessionId: 'receipt-session',
          transcriptLocator: '/frozen/transcript.jsonl'
        }
      }
    ]);
    const restored = await terminalCommitInvocation(
      { host: 'codex', sessionId: 'receipt-session', toolUseId: 'success' },
      { stateRoot: stateRoot(repo), notesExecutable: binary }
    );
    expect(restored.original).toEqual({
      input: input.tool_input,
      command: (input.tool_input as Record<string, unknown>).command,
      cwd: repo.root
    });
    expect(hookContext(post(repo, input, updated, shell.stdout).output)).toBe('');
    expect(notes(repo)).toHaveLength(1);
  });
  it('drains a created commit despite shell exit one', () => {
    const repo = fixture();
    const input = envelope(repo, 'exit-one', 'git commit -q --allow-empty -m failure; cat app.ts; false');
    const updated = prepare(repo, input);
    const shell = runRealShell(repo, updated.command as string);
    expect(shell.exitCode).toBe(1);
    post(repo, input, updated, { stdout: shell.stdout, stderr: shell.stderr, exit_code: 1 });
    expect(notes(repo)).toHaveLength(1);
  });
  it('omits unavailable locator and declines missing invocation metadata', async () => {
    const repo = fixture();
    const input = envelope(repo, 'no-locator', 'git commit -q --allow-empty -m no-locator');
    input.transcript_path = null;
    const updated = prepare(repo, input);
    const shell = runRealShell(repo, updated.command as string);
    post(repo, input, updated, shell.stdout);
    expect(notes(repo)[0]?.document).toEqual({ schemaVersion: 1, host: 'codex', sessionId: 'receipt-session' });
    const handler = createPre(layoutFor(repo), { notesExecutable: binary }, join(hooks, 'static-plan.mjs'));
    for (const field of ['session_id', 'tool_use_id']) {
      const missing = { ...input, [field]: undefined };
      expect(await handler(missing as never, { logger: new Logger() } as never)).toBe(undefined);
    }
  });
  it('retains active yielded execution through cleanup and permits a later session turn', async () => {
    const repo = fixture();
    const input = envelope(repo, 'active', 'read -r ready; git commit -q --allow-empty -m after-yield');
    const updated = prepare(repo, input);
    const child = spawn('bash', ['-c', updated.command as string], {
      cwd: repo.root,
      env: repo.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const finished = new Promise<number | null>((resolve, reject) => {
      child.on('exit', resolve);
      child.on('error', reject);
    });
    try {
      invokeRealHook(join(hooks, 'stop.mjs'), { ...input, hook_event_name: 'Stop' }, repo.env);
      const dirs = readdirSync(join(stateRoot(repo), 'invocations'));
      expect(dirs).toHaveLength(1);
      expect(
        JSON.parse(readFileSync(join(stateRoot(repo), 'invocations', itemAt(dirs, 0), 'state.json'), 'utf8')).status
      ).toBe('active');
      child.stdin.end('continue\n');
      expect(await finished).toBe(0);
      post(repo, input, updated, '');
      expect(notes(repo)).toHaveLength(1);
      invokeRealHook(join(hooks, 'stop.mjs'), { ...input, hook_event_name: 'Stop' }, repo.env);
      const later = envelope(repo, 'later-turn', 'git commit -q --allow-empty -m later');
      const laterUpdated = prepare(repo, later);
      const shell = runRealShell(repo, laterUpdated.command as string);
      post(repo, later, laterUpdated, shell.stdout);
      expect(notes(repo)).toHaveLength(1);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });
  it('delivers existing context after a bounded stalled notes phase, then retries independently of consumed touches', async () => {
    const repo = fixture();
    const input = envelope(repo, 'stalled', 'git commit -q --allow-empty -m stalled; cat app.ts');
    const updated = prepare(repo, input);
    const shell = runRealShell(repo, updated.command as string);
    const stalled = join(repo.home, 'stalled-notes');
    writeFileSync(stalled, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n', { mode: 0o700 });
    const handler = createPost(undefined, undefined, layoutFor(repo), { notesExecutable: stalled });
    const started = performance.now();
    const result = await handler(
      { ...input, hook_event_name: 'PostToolUse', tool_input: updated, tool_response: shell.stdout } as never,
      { logger: new Logger() } as never
    );
    expect(performance.now() - started).toBeLessThan(7000);
    expect(hookContext((result as unknown as { stdout: Record<string, unknown> }).stdout)).toContain(
      'example/receipt-context'
    );
    expect(notes(repo)).toHaveLength(0);
    const recovered = createPost(undefined, undefined, layoutFor(repo), { notesExecutable: binary });
    expect(
      await recovered(
        {
          ...input,
          hook_event_name: 'PostToolUse',
          tool_input: { command: 'printf replacement' },
          cwd: '/missing',
          tool_response: shell.stdout
        } as never,
        { logger: new Logger() } as never
      )
    ).toBe(undefined);
    expect(notes(repo)).toHaveLength(1);
  });
  it('emits fifteen-second post hooks and unchanged cleanup budget', () => {
    const manifest = JSON.parse(readFileSync(join(hooks, 'hooks.json'), 'utf8'));
    expect(manifest.hooks.PostToolUse[0].hooks[0].timeout).toBe(15);
    expect(manifest.hooks.Stop[0].hooks[0].timeout).toBe(10);

    expect(existsSync(join(hooks, 'static-plan.mjs'))).toBe(true);
  });
});

/** Delay consumption to exercise the deployed SDK's pipe backpressure boundary. */
async function delayedPre(repo: RealBundleRepo, input: Record<string, unknown>) {
  const consumer = `import subprocess, sys, time
payload=sys.stdin.buffer.read()
child=subprocess.Popen([sys.argv[1], sys.argv[2]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
child.stdin.write(payload)
child.stdin.close()
time.sleep(0.25)
if child.poll() is not None:
 sys.stderr.write('backpressure child exited before consumption\\n')
sys.stdout.buffer.write(child.stdout.read())
sys.stderr.buffer.write(child.stderr.read())
sys.exit(child.wait())
`;
  const child = spawn('python3', ['-c', consumer, process.execPath, join(hooks, 'static-plan.mjs')], {
    env: repo.env,
    stdio: 'pipe'
  });
  child.stdout.pause();
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
  child.stdin.end(JSON.stringify(input));
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(child.exitCode).toBeNull();
  child.stdout.resume();
  try {
    expect(await finished).toBe(0);
    expect(stderr).toBe('');
    return JSON.parse(stdout) as Record<string, unknown>;
  } finally {
    clearTimeout(deadline);
  }
}

describe('emitted receipt envelope and executable-search controls', () => {
  it.each([
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
    'hash -p /usr/bin/git git; git'
  ])('diagnoses %s without replacing successful original execution', (prefix) => {
    const repo = fixture();
    const log = join(repo.home, 'receipt-warning.jsonl');
    repo.env.AGENT_HOOKS_LOG_FILE = log;
    const command = `${prefix} commit -q --allow-empty -m bypass`;
    const input = envelope(repo, 'search-control', command);
    const pre = invokeRealHook(join(hooks, 'static-plan.mjs'), input, repo.env);
    expect(
      (present(pre.output, 'the static-plan hook output').hookSpecificOutput as Record<string, unknown>)?.updatedInput
    ).toBeUndefined();
    expect(runRealShell(repo, command).exitCode).toBe(0);
    post(repo, input, input.tool_input as Record<string, unknown>, { exit_code: 0 });
    expect(notes(repo)).toEqual([]);
    expect(readFileSync(log, 'utf8')).toContain('git-span commit receipts: observable');
  });
  it.each([false, true])('roundtrips a 100KB command with delayed consumer=%s', async (delayed) => {
    const repo = fixture();
    const command = `git commit -q --allow-empty -m large-command; #${'x'.repeat(100_000)}`;
    const input = envelope(repo, 'large-command', command);
    const output = delayed
      ? await delayedPre(repo, input)
      : invokeRealHook(join(hooks, 'static-plan.mjs'), input, repo.env).output;
    const updated = (present(output, 'the static-plan hook output').hookSpecificOutput as Record<string, unknown>)
      .updatedInput as Record<string, unknown>;
    expect(updated.command).toContain(command);
    expect(runRealShell(repo, updated.command as string).exitCode).toBe(0);
    post(repo, input, updated, { exit_code: 0 });
    expect(notes(repo)).toHaveLength(1);
  });
  it('rejects a 100KB command plus 900KB description before persistence and preserves execution', () => {
    const repo = fixture();
    const log = join(repo.home, 'receipt-warning.jsonl');
    repo.env.AGENT_HOOKS_LOG_FILE = log;
    const command = `git commit -q --allow-empty -m oversized; #${'x'.repeat(100_000)}`;
    const input = envelope(repo, 'oversized', command);
    input.tool_input = { command, description: 'y'.repeat(900_000) };
    const result = invokeRealHook(join(hooks, 'static-plan.mjs'), input, repo.env);
    expect((result.output?.hookSpecificOutput as Record<string, unknown>)?.updatedInput).toBeUndefined();
    expect(readdirSync(join(stateRoot(repo), 'invocations'))).toEqual([]);
    expect(readFileSync(log, 'utf8')).toContain('serialized receipt envelope');
    expect(runRealShell(repo, command).exitCode).toBe(0);
    post(repo, input, input.tool_input as Record<string, unknown>, { exit_code: 0 });
    expect(notes(repo)).toEqual([]);
  });
  it('accepts the exact maximum lifecycle envelope, publishes a receipt and restores; one byte over stays original', async () => {
    const repo = fixture();
    const command = 'git commit -q --allow-empty -m boundary';
    const sizing = envelope(repo, 'sizing0', command);
    sizing.tool_input = { command, description: '' };
    invokeRealHook(join(hooks, 'static-plan.mjs'), sizing, repo.env);
    const invocations = join(stateRoot(repo), 'invocations');
    const first = itemAt(readdirSync(invocations), 0);
    const state = JSON.parse(readFileSync(join(invocations, first, 'state.json'), 'utf8'));
    const maximumState = {
      ...state,
      status: 'acknowledged',
      liveLease: false,
      lastActivityMs: Number.MAX_SAFE_INTEGER,
      pendingNonces: Array.from({ length: 256 }, () => 'x'.repeat(256))
    };
    const padding = 1_048_576 - Buffer.byteLength(JSON.stringify(maximumState));
    const boundary = envelope(repo, 'boundry', command);
    boundary.tool_input = { command, description: 'x'.repeat(padding) };
    const pre = invokeRealHook(join(hooks, 'static-plan.mjs'), boundary, repo.env);
    const updated = (present(pre.output, 'the static-plan hook output').hookSpecificOutput as Record<string, unknown>)
      .updatedInput as Record<string, unknown>;
    expect(updated.description).toBe('x'.repeat(padding));
    const directory = readdirSync(invocations)
      .map((key) => join(invocations, key))
      .find((dir) => JSON.parse(readFileSync(join(dir, 'enrollment.json'), 'utf8')).toolUseId === 'boundry');
    if (directory === undefined) throw new Error('no invocation directory enrolled the boundary tool use');
    for (const file of ['enrollment.json', 'state.json', 'shim.json']) {
      const bytes = readFileSync(join(directory, file));
      expect(bytes.length).toBeLessThanOrEqual(1_048_576);
      expect(JSON.parse(bytes.toString())).toBeDefined();
    }
    expect(runRealShell(repo, updated.command as string).exitCode).toBe(0);
    expect(readdirSync(join(directory, 'receipts'))).toHaveLength(1);
    const receipt = JSON.parse(
      readFileSync(join(directory, 'receipts', itemAt(readdirSync(join(directory, 'receipts')), 0)), 'utf8')
    ) as CommitReceipt;
    let growing = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')) as CommitInvocationState;
    growing = { ...growing, pendingNonces: [] };
    for (let index = 0; index < 256; index++) {
      const next = transitionCommitInvocation(growing, {
        kind: 'receipt',
        receipt: { ...receipt, nonce: `${'x'.repeat(253)}${String(index).padStart(3, '0')}` },
        nowMs: Number.MAX_SAFE_INTEGER
      });
      expect(next.ok).toBe(true);
      if (next.ok) growing = next.value;
    }
    expect(growing.pendingNonces).toHaveLength(256);
    expect(Buffer.byteLength(JSON.stringify(growing))).toBeLessThanOrEqual(1_048_576);
    const completed = transitionCommitInvocation(growing, {
      kind: 'terminal',
      identity: growing.enrollment,
      nowMs: Number.MAX_SAFE_INTEGER
    });
    expect(completed.ok).toBe(true);
    if (completed.ok) growing = completed.value;
    expect(growing.status).toBe('completed');
    expect(Buffer.byteLength(JSON.stringify(growing))).toBeLessThanOrEqual(1_048_576);
    for (const nonce of growing.pendingNonces) {
      const next = transitionCommitInvocation(growing, { kind: 'acknowledge', nonce, nowMs: Number.MAX_SAFE_INTEGER });
      expect(next.ok).toBe(true);
      if (next.ok) growing = next.value;
    }
    expect(growing.status).toBe('acknowledged');
    const retired = transitionCommitInvocation(growing, {
      kind: 'cleanup',
      host: growing.enrollment.host,
      nowMs: Number.MAX_SAFE_INTEGER
    });
    expect(retired.ok).toBe(true);
    if (retired.ok) {
      expect(retired.value.status).toBe('retired');
      expect(Buffer.byteLength(JSON.stringify(retired.value))).toBeLessThanOrEqual(1_048_576);
    }

    post(repo, boundary, updated, { exit_code: 0 });
    expect(notes(repo)).toHaveLength(1);
    const restored = await terminalCommitInvocation(
      { host: 'codex', sessionId: 'receipt-session', toolUseId: 'boundry' },
      { stateRoot: stateRoot(repo) }
    );
    expect(restored.original?.input).toEqual(boundary.tool_input);
    const log = join(repo.home, 'overflow-warning.jsonl');
    repo.env.AGENT_HOOKS_LOG_FILE = log;
    const overflow = envelope(repo, 'overflo', command);
    overflow.tool_input = { command, description: 'x'.repeat(padding + 1) };
    const result = invokeRealHook(join(hooks, 'static-plan.mjs'), overflow, repo.env);
    expect((result.output?.hookSpecificOutput as Record<string, unknown>)?.updatedInput).toBeUndefined();
    expect(readdirSync(invocations)).toHaveLength(2);
    expect(readFileSync(log, 'utf8')).toContain('serialized receipt envelope');
    expect(runRealShell(repo, command).exitCode).toBe(0);
    expect(notes(repo)).toEqual([]);
  });
});

describe('supported emitted explicit builtin dispatch', () => {
  it.each(['builtin -- command -- git', 'command builtin -- command -- git'])(
    'records ordinary %s without receipt diagnostics',
    (prefix) => {
      const repo = fixture();
      const log = join(repo.home, 'supported-builtin.jsonl');
      repo.env.AGENT_HOOKS_LOG_FILE = log;
      const command = `${prefix} commit -q --allow-empty -m supported-builtin`;
      const input = envelope(repo, 'supported-builtin', command);
      const updated = prepare(repo, input);
      expect(runRealShell(repo, updated.command as string).exitCode).toBe(0);
      post(repo, input, updated, { exit_code: 0 });
      expect(notes(repo)).toHaveLength(1);
      expect(readFileSync(log, 'utf8')).not.toContain('git-span commit receipts:');
    }
  );
});
