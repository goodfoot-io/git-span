import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, type StopInput } from '@goodfoot/agent-hooks/codex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandler as createClaudeHandler } from '../../src/claude/stop.js';
import { createHandler as createCodexHandler } from '../../src/codex/stop.js';
import { resolveGitSpanCommand } from '../../src/common/git-span-command.js';
import { type BuiltRealHookBundles, buildRealHookBundles, invokeRealHook } from '../real-bundle-helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const temp = makeTempLayout();
execFileSync('git', ['init', '-q', temp.parent]);
execFileSync('git', [
  '-C',
  temp.parent,
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  'commit',
  '-q',
  '--allow-empty',
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

describe('session-note review at Stop', () => {
  it('keeps Codex session state while review runs and cleans up on continuation', async () => {
    const handler = createCodexHandler(temp.layout);
    mkdirSync(temp.layout.dir(input.session_id), { recursive: true });
    writeFileSync(temp.layout.memoFile(input.session_id), '{}');

    expect((await handler(input, context))?.stdout.decision).toBe('block');
    expect(existsSync(temp.layout.memoFile(input.session_id))).toBe(true);

    expect(await handler({ ...input, stop_hook_active: true }, context)).toBeUndefined();
    expect(existsSync(temp.layout.dir(input.session_id))).toBe(false);
    expect(await handler({ ...input, stop_hook_active: true }, context)).toBeUndefined();

    expect((await handler({ ...input, turn_id: 'turn-2' }, context))?.stdout.decision).toBe('block');
  });

  it('allows Claude continuations and requests review again on a later ordinary stop', async () => {
    const handler = createClaudeHandler();
    expect((await handler(input, context))?.stdout.decision).toBe('block');
    expect(await handler({ ...input, stop_hook_active: true }, context)).toBeNull();
    expect(await handler({ ...input, stop_hook_active: true }, context)).toBeNull();
    expect((await handler(input, context))?.stdout.decision).toBe('block');
  });
});

describe('emitted Stop protocol', () => {
  let bundles: BuiltRealHookBundles;
  beforeAll(() => {
    bundles = buildRealHookBundles();
  }, 30_000);
  afterAll(() => bundles?.cleanup());

  for (const host of ['claude', 'codex'] as const) {
    it(`${host} emits no review prompt for an empty repository`, () => {
      const empty = makeTempLayout();
      try {
        execFileSync('git', ['init', '-q', empty.parent]);
        const directory = host === 'claude' ? bundles.claudeHooksDir : bundles.codexHooksDir;
        const result = invokeRealHook(
          join(directory, 'stop.mjs'),
          { ...input, cwd: empty.parent },
          { ...process.env, HOME: empty.parent }
        );
        expect(result.stderr).toBe('');
        expect(result.output?.decision).not.toBe('block');
        expect(result.output?.reason).toBeUndefined();
      } finally {
        empty.cleanup();
      }
    });
    it(`${host} emits no review prompt when the only note belongs to another session`, () => {
      const directory = host === 'claude' ? bundles.claudeHooksDir : bundles.codexHooksDir;
      const result = invokeRealHook(
        join(directory, 'stop.mjs'),
        { ...input, session_id: 'other-session' },
        { ...process.env, HOME: temp.parent, XDG_CACHE_HOME: temp.parent }
      );
      expect(result.stderr).toBe('');
      expect(result.output?.decision).not.toBe('block');
      expect(result.output?.reason).toBeUndefined();
    });
    it(`${host} emits a scoped fork prompt and allows continuation without another prompt`, () => {
      const directory = host === 'claude' ? bundles.claudeHooksDir : bundles.codexHooksDir;
      const bundle = join(directory, 'stop.mjs');
      const env = { ...process.env, HOME: temp.parent, XDG_CACHE_HOME: temp.parent };
      const result = invokeRealHook(bundle, { ...input }, env);
      expect(result.stderr).toBe('');
      expect(result.output?.decision).toBe('block');
      expect(result.output?.reason).toContain('forked subagent');
      expect(result.output?.reason).toContain('git-span:review-notes');
      expect(result.output?.reason).toContain(
        'then follow the instructions to document implicit dependencies using `git-span`.'
      );
      expect(result.output?.reason).toContain(JSON.stringify({ host, sessionId: input.session_id, cwd: input.cwd }));

      const continuation = invokeRealHook(bundle, { ...input, stop_hook_active: true }, env);
      expect(continuation.stderr).toBe('');
      expect(continuation.output?.decision).not.toBe('block');
      expect(continuation.output?.reason).toBeUndefined();
    });
  }
});
