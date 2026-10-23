import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, type StopInput } from '@goodfoot/agent-hooks/codex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandler as createClaudeHandler } from '../../src/claude/stop.js';
import { createHandler as createCodexHandler } from '../../src/codex/stop.js';
import { FIRST_WRITE_GUIDANCE } from '../../src/common/first-write-guidance.js';
import { resolveGitSpanCommand } from '../../src/common/git-span-command.js';
import {
  type BuiltRealHookBundles,
  buildRealHookBundles,
  hookContext,
  invokeRealHook
} from '../real-bundle-helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const temp = makeTempLayout();
execFileSync('git', ['init', '-q', temp.parent]);
writeFileSync(join(temp.parent, 'source.ts'), 'export const value = 1;\n');
execFileSync('git', ['-C', temp.parent, 'add', 'source.ts']);
execFileSync('git', [
  '-C',
  temp.parent,
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  'commit',
  '-q',
  '-m',
  'fixture'
]);
const command = resolveGitSpanCommand(['notes', 'add', 'HEAD', '--format', 'json'], temp.parent);
execFileSync(command.executable, command.argv, {
  cwd: temp.parent,
  input: JSON.stringify({ kind: 'git-span/uncovered-commit', schema_version: 1, session_id: 'review-session' })
});
const context = { logger: new Logger() };
const input: StopInput = {
  hook_event_name: 'Stop',
  cwd: temp.parent,
  session_id: 'review-session',
  transcript_path: null,
  model: 'test',
  permission_mode: 'default',
  last_assistant_message: null,
  stop_hook_active: false,
  turn_id: 'turn-1'
};
afterAll(() => temp.cleanup());

describe('completion without automatic review', () => {
  it('cleans Codex state immediately even when the repository has session notes', async () => {
    const handler = createCodexHandler(temp.layout);
    mkdirSync(temp.layout.dir(input.session_id), { recursive: true });
    writeFileSync(temp.layout.memoFile(input.session_id), '{}');
    expect(await handler(input, context)).toBeUndefined();
    expect(existsSync(temp.layout.dir(input.session_id))).toBe(false);
    expect(await handler({ ...input, stop_hook_active: true }, context)).toBeUndefined();
  });
  it('allows Claude completion and repeated continuations with existing notes', async () => {
    const handler = createClaudeHandler();
    expect(await handler(input, context)).toBeNull();
    expect(await handler({ ...input, stop_hook_active: true }, context)).toBeNull();
    expect(await handler(input, context)).toBeNull();
  });
});

describe('emitted Stop protocol', () => {
  let bundles: BuiltRealHookBundles;
  beforeAll(() => {
    bundles = buildRealHookBundles();
  }, 30_000);
  afterAll(() => bundles?.cleanup());
  for (const host of ['claude', 'codex'] as const) {
    it(`${host} emitted post-tool bundles deliver exact guidance once across subprocesses`, () => {
      const directory = host === 'claude' ? bundles.claudeHooksDir : bundles.codexHooksDir;
      const filename = `bundle-${host}.ts`;
      const path = join(temp.parent, filename);
      writeFileSync(path, 'value\n');
      const event = {
        ...input,
        hook_event_name: 'PostToolUse',
        session_id: `bundle-${host}`,
        tool_use_id: 'write',
        tool_name: host === 'claude' ? 'Write' : 'apply_patch',
        tool_input:
          host === 'claude'
            ? { file_path: path, content: 'value\n' }
            : { command: `*** Begin Patch\n*** Add File: ${filename}\n+value\n*** End Patch` },
        tool_response: host === 'claude' ? {} : `Success. Updated the following files:\nA ${filename}`
      };
      const env = { ...process.env, HOME: temp.parent, XDG_CACHE_HOME: temp.parent };
      const run = (sessionId = event.session_id) => {
        const result = invokeRealHook(join(directory, 'post-tool-use.mjs'), { ...event, session_id: sessionId }, env);
        expect(result.stderr).toBe('');
        return hookContext(result.output);
      };
      expect(run()).toBe(FIRST_WRITE_GUIDANCE);
      expect(run()).toBe('');
      expect(run(`other-bundle-${host}`)).toBe(FIRST_WRITE_GUIDANCE);
    });

    it(`${host} never emits a forked review prompt even with matching notes`, () => {
      const directory = host === 'claude' ? bundles.claudeHooksDir : bundles.codexHooksDir;
      for (const active of [false, true, false]) {
        const result = invokeRealHook(
          join(directory, 'stop.mjs'),
          { ...input, stop_hook_active: active },
          { ...process.env, HOME: temp.parent, XDG_CACHE_HOME: temp.parent }
        );
        expect(result.stderr).toBe('');
        expect(result.output?.decision).not.toBe('block');
        expect(result.output?.reason).toBeUndefined();
        expect(JSON.stringify(result.output)).not.toContain('review-notes');
      }
    });
  }
});
