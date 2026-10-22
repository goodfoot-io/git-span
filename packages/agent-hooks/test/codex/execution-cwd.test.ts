/** Stock Codex omits exec_command.workdir from canonical Bash hook inputs. */
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
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
  it.each([
    'direct-default',
    'direct-absolute',
    'direct-relative',
    'code-mode-default',
    'code-mode-absolute',
    'code-mode-relative'
  ])('recovers %s workdir without rewriting the command and retains it for post', (mode) => {
    const caller = fixture();
    const target = mode.endsWith('default') ? caller : fixture();
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
    writeFileSync(
      input.transcript_path,
      `${[
        { type: 'session_meta', payload: { id: input.session_id } },
        {
          type: 'response_item',
          payload: {
            type: 'function_call',
            call_id: input.tool_use_id,
            name: 'exec_command',
            arguments: JSON.stringify({
              cmd: command,
              ...(mode.endsWith('default')
                ? {}
                : {
                    workdir: mode.endsWith('absolute') ? target.root : relative(caller.root, target.root)
                  })
            })
          }
        }
      ]
        .map((row) => JSON.stringify(row))
        .join('\n')}\n`
    );
    if (mode.startsWith('code-mode')) {
      const workdir = mode.endsWith('default')
        ? undefined
        : mode.endsWith('absolute')
          ? target.root
          : relative(caller.root, target.root);
      input.tool_use_id = 'exec-child';
      writeFileSync(
        input.transcript_path,
        `${[
          { type: 'session_meta', payload: { id: input.session_id } },
          {
            type: 'response_item',
            payload: {
              type: 'custom_tool_call',
              name: 'exec',
              call_id: 'outer',
              input: `text(await tools.exec_command(${JSON.stringify({ cmd: command, workdir })}));`
            }
          }
        ]
          .map((row) => JSON.stringify(row))
          .join('\n')}\n`
      );
    }
    const pre = invokeRealHook(join(bundles.codexHooksDir, 'static-plan.mjs'), input, caller.env);
    expect(pre.output?.hookSpecificOutput).toBeUndefined();
    const actualInput = input.tool_input;
    expect(actualInput.command).toBe(command);
    // Post must use the enrollment's directory, even after the transcript is gone.
    rmSync(input.transcript_path);
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
    if (!mode.endsWith('default')) expect(notes(caller)).toHaveLength(0);
  });
});
