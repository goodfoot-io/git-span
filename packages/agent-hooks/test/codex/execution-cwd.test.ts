/** Stock Codex omits exec_command.workdir from canonical Bash hook inputs. */
import { execFileSync } from 'node:child_process';
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

function notes(repo: RealBundleRepo): unknown[] {
  return JSON.parse(
    execFileSync(binary, ['notes', 'list', '--format', 'json'], {
      cwd: repo.root,
      env: repo.env,
      encoding: 'utf8'
    })
  ).notes;
}

describe('Codex hidden execution workdir', () => {
  it('checkpoints the real repository before a quiet commit and preserves shell output and status', () => {
    const caller = fixture();
    const target = fixture();
    const execution = { ...target, env: caller.env };
    const command = [
      "printf 'export const value = 2;\\n' > app.ts",
      'git add app.ts',
      'git commit -qm hidden-workdir',
      "printf 'command stdout\\n'",
      "printf 'command stderr\\n' >&2",
      'exit 7'
    ].join('\n');
    const input = {
      hook_event_name: 'PreToolUse',
      session_id: 'hidden-workdir-session',
      tool_use_id: 'hidden-workdir-call',
      transcript_path: join(caller.home, 'session.jsonl'),
      cwd: caller.root,
      tool_name: 'Bash',
      // This is the stock host's canonical payload: no actual execution workdir.
      tool_input: { command }
    };
    const pre = invokeRealHook(join(bundles.codexHooksDir, 'static-plan.mjs'), input, caller.env);
    const specific = pre.output?.hookSpecificOutput as Record<string, unknown> | undefined;
    const updated = specific?.updatedInput as Record<string, unknown> | undefined;
    const actualInput = updated ?? input.tool_input;
    expect(typeof actualInput.command).toBe('string');
    const shell = runRealShell(execution, actualInput.command as string);
    expect(shell).toEqual({
      stdout: 'command stdout\n',
      stderr: 'command stderr\n',
      exitCode: 7
    });
    invokeRealHook(
      join(bundles.codexHooksDir, 'post-tool-use.mjs'),
      {
        ...input,
        hook_event_name: 'PostToolUse',
        tool_input: actualInput,
        tool_response: { output: shell.stdout, stderr: shell.stderr, exit_code: shell.exitCode }
      },
      caller.env
    );
    expect(notes(execution)).toHaveLength(1);
    expect(notes(caller)).toHaveLength(0);
  });
});
