import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, type StopInput } from '@goodfoot/agent-hooks/codex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHandler as createClaudeHandler } from '../../src/claude/stop.js';
import { createHandler as createCodexHandler } from '../../src/codex/stop.js';
import { resolveGitSpanCommand } from '../../src/common/git-span-command.js';
import { hasReviewNotes } from '../../src/common/review-lookup.js';
import { type BuiltRealHookBundles, buildRealHookBundles, invokeRealHook } from '../real-bundle-helpers.js';
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

  it('allows Claude continuations and suppresses unchanged notes on a later ordinary stop', async () => {
    const handler = createClaudeHandler(undefined, temp.layout);
    expect((await handler(input, context))?.stdout.decision).toBe('block');
    expect(await handler({ ...input, stop_hook_active: true }, context)).toBeNull();
    expect(await handler({ ...input, stop_hook_active: true }, context)).toBeNull();
    expect(await handler(input, context)).toBeNull();
  });
});

describe('Claude stop checkpoint failures', () => {
  it('does not consume notes on lookup failure', async () => {
    const isolated = makeTempLayout();
    try {
      const check = vi
        .fn()
        .mockResolvedValueOnce({ kind: 'failure', reason: 'lookup timeout' })
        .mockImplementation(hasReviewNotes);
      const handler = createClaudeHandler(check, isolated.layout);
      expect((await handler(input, context))?.stdout.systemMessage).toContain('lookup timeout');
      expect((await handler(input, context))?.stdout.decision).toBe('block');
      expect(await handler(input, context)).toBeNull();
    } finally {
      isolated.cleanup();
    }
  });

  it('reports corrupt checkpoint state without silently consuming notes', async () => {
    const isolated = makeTempLayout();
    const checkpoint = join(isolated.layout.dir(input.session_id), 'review-notes-stop.json');
    try {
      mkdirSync(isolated.layout.dir(input.session_id), { recursive: true });
      writeFileSync(checkpoint, '{broken');
      const handler = createClaudeHandler(undefined, isolated.layout);
      expect((await handler(input, context))?.stdout.systemMessage).toContain('could not read commit notes');
      rmSync(checkpoint);
      expect((await handler(input, context))?.stdout.decision).toBe('block');
      expect(await handler(input, context)).toBeNull();
    } finally {
      isolated.cleanup();
    }
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
    it(`${host} emits a fork prompt and allows continuation without another prompt`, () => {
      const directory = host === 'claude' ? bundles.claudeHooksDir : bundles.codexHooksDir;
      const bundle = join(directory, 'stop.mjs');
      const env = { ...process.env, HOME: temp.parent, XDG_CACHE_HOME: temp.parent };
      const result = invokeRealHook(bundle, { ...input }, env);
      expect(result.stderr).toBe('');
      expect(result.output?.decision).toBe('block');
      expect(result.output?.reason).toContain('forked subagent');
      expect(result.output?.reason).toContain('git-span:review-notes');
      expect(result.output?.reason).toContain(
        'Extend existing spans where applicable; create new spans where coverage is missing'
      );
      expect(result.output?.reason).toContain('remove only successfully processed notes');
      expect(result.output?.reason).toContain('Summarize spans created or updated');
      expect(result.output?.reason).not.toContain('Review changed behavior');
      expect(result.output?.reason).not.toContain('material findings');
      expect(result.output?.reason).not.toContain('review complete');
      expect(result.output?.reason).not.toContain('Review scope');

      const continuation = invokeRealHook(bundle, { ...input, stop_hook_active: true }, env);
      expect(continuation.stderr).toBe('');
      expect(continuation.output?.decision).not.toBe('block');
      expect(continuation.output?.reason).toBeUndefined();

      const nextStop = invokeRealHook(bundle, { ...input }, env);
      expect(nextStop.stderr).toBe('');
      expect(nextStop.output?.decision).toBe(host === 'claude' ? undefined : 'block');
    });
  }
});
