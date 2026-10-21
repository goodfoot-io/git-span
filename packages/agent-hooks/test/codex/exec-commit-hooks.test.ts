/** Native Codex shell envelopes must create notes through the emitted hook boundary. */
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type BuiltRealHookBundles,
  buildRealHookBundles,
  buildWorkspaceGitSpan,
  commitRepo,
  invokeRealHook,
  makeRealBundleRepo,
  type RealBundleRepo,
  runRealShell,
  writeRepoFile
} from '../real-bundle-helpers.js';

let bundles: BuiltRealHookBundles;
let binary: string;
let pathDir: string;
const repos: RealBundleRepo[] = [];

beforeAll(() => {
  ({ binary, pathDir } = buildWorkspaceGitSpan());
  bundles = buildRealHookBundles();
}, 600_000);

afterAll(() => {
  for (const repo of repos) repo.cleanup();
  bundles?.cleanup();
});

function fixture(): RealBundleRepo {
  const repo = makeRealBundleRepo(pathDir);
  repos.push(repo);
  writeRepoFile(repo, 'app.ts', 'export const value = 1;\n');
  commitRepo(repo, 'initial');
  return repo;
}

function envelope(repo: RealBundleRepo, tool: string, input: unknown, id = 'native-exec') {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'native-exec-session',
    tool_use_id: id,
    transcript_path: '/frozen/native-exec.jsonl',
    cwd: repo.root,
    tool_name: tool,
    tool_input: input
  };
}

function notes(repo: RealBundleRepo): { document: Record<string, unknown> }[] {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo.root,
    env: repo.env,
    encoding: 'utf8'
  }).trim();
  return JSON.parse(
    execFileSync(binary, ['notes', 'list', sha, '--exact', '--format', 'json'], {
      cwd: repo.root,
      env: repo.env,
      encoding: 'utf8'
    })
  ).notes;
}

function prepare(repo: RealBundleRepo, input: Record<string, unknown>) {
  const result = invokeRealHook(join(bundles.codexHooksDir, 'static-plan.mjs'), input, repo.env);
  expect((result.output?.hookSpecificOutput as Record<string, unknown>)?.updatedInput).toBeUndefined();
}

function post(repo: RealBundleRepo, input: Record<string, unknown>, response: unknown) {
  invokeRealHook(
    join(bundles.codexHooksDir, 'post-tool-use.mjs'),
    { ...input, hook_event_name: 'PostToolUse', tool_response: response },
    repo.env
  );
}

describe('Codex native exec commit note creation', () => {
  it.each(['canonical', 'direct', 'arguments', 'code-mode'] as const)(
    'records exactly one note for %s execution in the command workdir',
    (form) => {
      const caller = fixture();
      const target = fixture();
      // Both repositories share this session's HOME, as real workdir overrides do.
      const execution = { ...target, env: caller.env };
      const command = 'git commit -q --allow-empty -m native-exec';
      const args = { cmd: command, workdir: target.root };
      const input = envelope(
        caller,
        form === 'canonical' ? 'Bash' : form === 'code-mode' ? 'exec' : 'exec_command',
        form === 'canonical'
          ? { command, workdir: target.root }
          : form === 'direct'
            ? args
            : form === 'arguments'
              ? { arguments: JSON.stringify(args) }
              : { input: `const result = await tools.exec_command(${JSON.stringify(args)}); text(result);` }
      );
      if (form === 'canonical') input.cwd = target.root;
      prepare(caller, input);
      const shell = runRealShell(execution, command);
      expect(shell.exitCode).toBe(0);
      const response = { output: shell.stdout, exit_code: shell.exitCode };
      post(caller, input, response);
      expect(notes(execution)).toEqual([
        expect.objectContaining({
          document: {
            schemaVersion: 1,
            host: 'codex',
            sessionId: 'native-exec-session',
            transcriptLocator: '/frozen/native-exec.jsonl'
          }
        })
      ]);
      expect(notes(caller)).toHaveLength(0);
      post(caller, input, response);
      expect(notes(execution)).toHaveLength(1);
    }
  );

  it('observes every literal command workdir in a code-mode batch using frozen contexts', () => {
    const caller = fixture();
    const targets = [fixture(), fixture()];
    const command = 'git commit -q --allow-empty -m batch-exec';
    const code = targets
      .map((target) => `await tools.exec_command(${JSON.stringify({ cmd: command, workdir: target.root })});`)
      .join('\n');
    const input = envelope(caller, 'exec', { input: code });
    prepare(caller, input);
    for (const target of targets) expect(runRealShell({ ...target, env: caller.env }, command).exitCode).toBe(0);
    post(
      caller,
      { ...input, cwd: '/unavailable', tool_input: { input: 'throw new Error("changed input")' } },
      { output: '', exit_code: 0 }
    );
    for (const target of targets) expect(notes({ ...target, env: caller.env })).toHaveLength(1);
    expect(notes(caller)).toHaveLength(0);
  });

  it('supports the canonical Bash terminal delivered only after a yielded process completes', async () => {
    const repo = fixture();
    const command = 'read -r ready; git commit -q --allow-empty -m canonical-yield';
    const input = envelope(repo, 'Bash', { command, workdir: repo.root });
    prepare(repo, input);
    const child = spawn('bash', ['-c', command], { cwd: repo.root, env: repo.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const finished = new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    try {
      // The maintained host does not dispatch a terminal PostToolUse while write_stdin is still polling.
      expect(notes(repo)).toHaveLength(0);
      invokeRealHook(
        join(bundles.codexHooksDir, 'stop.mjs'),
        { ...input, hook_event_name: 'Stop', stop_hook_active: true },
        repo.env
      );
      child.stdin.end('continue\n');
      expect(await finished).toBe(0);
      post(repo, input, '');
      expect(notes(repo)).toHaveLength(1);
      post(repo, input, '');
      expect(notes(repo)).toHaveLength(1);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });

  it('retains yielded exec attribution until write_stdin reports process completion', async () => {
    const repo = fixture();
    const command = 'read -r ready; git commit -q --allow-empty -m after-native-yield';
    const input = envelope(repo, 'exec_command', { cmd: command, workdir: repo.root, yield_time_ms: 1000 });
    prepare(repo, input);
    const child = spawn('bash', ['-c', command], {
      cwd: repo.root,
      env: repo.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const finished = new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    try {
      post(repo, input, { output: '', session_id: 731, wall_time_seconds: 1 });
      expect(notes(repo)).toHaveLength(0);
      const unknownPoll = envelope(repo, 'write_stdin', { session_id: 731, chars: '' }, 'unknown-poll');
      post(repo, unknownPoll, { output: 'still waiting' });
      expect(notes(repo)).toHaveLength(0);
      child.stdin.end('continue\n');
      expect(await finished).toBe(0);
      const completion = envelope(repo, 'write_stdin', { session_id: 731, chars: '' }, 'native-poll');
      post(repo, completion, { output: '', exit_code: 0, wall_time_seconds: 0.1 });
      expect(notes(repo)).toHaveLength(1);
      post(repo, completion, { output: '', exit_code: 0, wall_time_seconds: 0.1 });
      expect(notes(repo)).toHaveLength(1);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });
});
