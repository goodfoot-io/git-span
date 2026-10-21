/** Execution helpers must preserve shell behavior and fail closed when checkpointing is unavailable. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeExecutionPlan,
  EXECUTION_PLAN_FLAG,
  type ExecutionPlan,
  executionPlanCommand,
  isExecutionPlanCommand
} from '../../src/codex/execution-plan.js';
import {
  type BuiltRealHookBundles,
  buildRealHookBundles,
  buildWorkspaceGitSpan,
  commitRepo,
  invokeRealHook,
  makeRealBundleRepo,
  type RealBundleRepo,
  writeRepoFile
} from '../real-bundle-helpers.js';

let bundles: BuiltRealHookBundles;
let pathDir: string;
const repos: RealBundleRepo[] = [];
beforeAll(() => {
  ({ pathDir } = buildWorkspaceGitSpan());
  bundles = buildRealHookBundles();
}, 600_000);
afterAll(() => {
  for (const repo of repos) repo.cleanup();
  bundles?.cleanup();
});

function fixture(): RealBundleRepo {
  const repo = makeRealBundleRepo(pathDir);
  repos.push(repo);
  writeRepoFile(repo, 'app.txt', 'baseline\n');
  commitRepo(repo, 'baseline');
  return repo;
}

function plan(repo: RealBundleRepo, command: string): ExecutionPlan {
  return {
    version: 1,
    sessionId: 'execution-helper-session',
    toolUseId: 'execution-helper-call',
    toolInput: { command },
    layoutBase: join(repo.home, '.cache', 'git-span', 'session'),
    options: { stateRoot: join(repo.home, '.cache', 'git-span', 'commit-receipts') }
  };
}

function input(repo: RealBundleRepo, command: string) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'execution-helper-session',
    tool_use_id: 'execution-helper-call',
    cwd: repo.root,
    tool_name: 'Bash',
    tool_input: { command }
  };
}

function notes(repo: RealBundleRepo): unknown[] {
  return JSON.parse(
    execFileSync('git', ['span', 'notes', 'list', '--format', 'json'], {
      cwd: repo.root,
      env: repo.env,
      encoding: 'utf8'
    })
  ).notes;
}

describe('Codex execution helper', () => {
  it('preserves stdin and heredocs and records multiple quiet commits only in the execution repository', () => {
    const caller = fixture();
    const target = { ...fixture(), env: caller.env };
    const command = [
      'IFS= read -r value',
      'printf "<%s>\\n" "$value"',
      "cat <<'EOF'",
      'literal `backticks` and $(substitution)',
      'EOF',
      'git commit -q --allow-empty -m first',
      'git commit -q --allow-empty -m second'
    ].join('\n');
    const before = input(caller, command);
    const pre = invokeRealHook(join(bundles.codexHooksDir, 'static-plan.mjs'), before, caller.env);
    const specific = pre.output?.hookSpecificOutput as Record<string, unknown>;
    expect(specific.permissionDecision).toBe('allow');
    const updated = specific.updatedInput as Record<string, unknown>;
    const shell = spawnSync('bash', ['-c', updated.command as string], {
      cwd: target.root,
      env: target.env,
      input: 'untouched stdin\n',
      encoding: 'utf8',
      timeout: 20_000
    });
    expect(shell.error).toBeUndefined();
    expect(shell.status).toBe(0);
    expect(shell.stdout).toBe('<untouched stdin>\nliteral `backticks` and $(substitution)\n');
    expect(shell.stderr).toBe('');
    const post = { ...before, hook_event_name: 'PostToolUse', tool_input: updated, tool_response: shell.stdout };
    invokeRealHook(join(bundles.codexHooksDir, 'post-tool-use.mjs'), post, caller.env);
    expect(notes(target)).toHaveLength(2);
    expect(notes(caller)).toHaveLength(0);
    invokeRealHook(join(bundles.codexHooksDir, 'post-tool-use.mjs'), post, caller.env);
    expect(notes(target)).toHaveLength(2);
  });

  it('keeps the original command running if the helper cannot load and suppresses attribution', () => {
    const caller = fixture();
    const target = { ...fixture(), env: caller.env };
    const log = join(caller.home, 'helper-failure.jsonl');
    caller.env.AGENT_HOOKS_LOG_FILE = log;
    const original = 'git commit -q --allow-empty -m no-helper; printf original; exit 9';
    const command = executionPlanCommand(plan(caller, original), pathToFileURL(join(caller.home, 'missing.mjs')).href);
    expect(command).not.toBeNull();
    const shell = spawnSync('bash', ['-ec', command as string], {
      cwd: target.root,
      env: target.env,
      encoding: 'utf8',
      timeout: 20_000
    });
    expect(shell.error).toBeUndefined();
    expect(shell).toMatchObject({ status: 9, stdout: 'original', stderr: '' });
    const result = invokeRealHook(
      join(bundles.codexHooksDir, 'post-tool-use.mjs'),
      { ...input(caller, command as string), hook_event_name: 'PostToolUse', tool_response: shell.stdout },
      caller.env
    );
    expect(result.output).toEqual({});
    expect(notes(caller)).toHaveLength(0);
    expect(notes(target)).toHaveLength(0);
    expect(readFileSync(log, 'utf8')).toContain('suppressing');
  });

  it('rejects oversized hidden-directory plans before observing the session repository', () => {
    const caller = fixture();
    const log = join(caller.home, 'oversized.jsonl');
    caller.env.AGENT_HOOKS_LOG_FILE = log;
    const before = input(caller, `git commit -q --allow-empty -m oversized; #${'x'.repeat(20_000)}`);
    const pre = invokeRealHook(join(bundles.codexHooksDir, 'static-plan.mjs'), before, caller.env);
    expect(pre.output).toEqual({});
    expect(existsSync(join(caller.home, '.cache', 'git-span', 'commit-receipts', 'invocations'))).toBe(false);
    const post = invokeRealHook(
      join(bundles.codexHooksDir, 'post-tool-use.mjs'),
      { ...before, hook_event_name: 'PostToolUse', tool_response: '' },
      caller.env
    );
    expect(post.output).toEqual({});
    expect(notes(caller)).toHaveLength(0);
    expect(readFileSync(log, 'utf8')).toContain('payload limit');
    expect(readFileSync(log, 'utf8')).toContain('suppressing');
  });

  it('validates helper payloads without treating auxiliary input or paths as shell source', () => {
    const repo = fixture();
    const value = plan(repo, 'printf original');
    const encoded = Buffer.from(JSON.stringify(value)).toString('base64');
    expect(decodeExecutionPlan(encoded)).toEqual(value);
    for (const candidate of ['', 'not base64!', encoded.slice(0, -1), 'a'.repeat(16_385)])
      expect(decodeExecutionPlan(candidate)).toBeNull();
    for (const bad of [
      { ...value, version: 2 },
      { ...value, toolInput: { command: '' } },
      { ...value, options: { notesIO: 'execute me' } }
    ])
      expect(decodeExecutionPlan(Buffer.from(JSON.stringify(bad)).toString('base64'))).toBeNull();
    const description = "'; $(touch unwanted) `touch unwanted`";
    const command = executionPlanCommand(
      { ...value, toolInput: { ...value.toolInput, description } },
      pathToFileURL(join(repo.home, "quotes' $() `ticks`.mjs")).href
    );
    expect(command).not.toBeNull();
    expect(command).toMatch(/\nprintf original$/);
    expect(command?.split('\n')[0]).not.toContain(description);
    expect(command?.split('\n')[0]?.match(/'/g)).toHaveLength(2);
    expect(isExecutionPlanCommand(command as string)).toBe(true);
    expect(executionPlanCommand({ ...value, toolInput: { command: command as string } }, 'file:///unused')).toBeNull();
    const malformed = spawnSync(
      process.execPath,
      [join(bundles.codexHooksDir, 'static-plan.mjs'), EXECUTION_PLAN_FLAG, '!'],
      {
        env: repo.env,
        input: 'not hook JSON and not consumed',
        encoding: 'utf8',
        timeout: 20_000
      }
    );
    expect(malformed.error).toBeUndefined();
    expect(malformed).toMatchObject({ status: 0, stdout: '', stderr: '' });
  });
});
