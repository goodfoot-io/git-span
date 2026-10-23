/** Actual host adapters deliver a common complete report through their supported channels. */
import { Logger } from '@goodfoot/agent-hooks';
import { describe, expect, it } from 'vitest';
import { createHandler as antigravityDrain } from '../../src/antigravity/post-invocation.js';
import antigravityEntry, { createHandler as antigravityHandler } from '../../src/antigravity/post-tool-use.js';
import { stashToolCall } from '../../src/antigravity/stash.js';
import claudeEntry, { createHandler as claudeHandler } from '../../src/claude/post-tool-use.js';
import claudeFailureEntry, { createHandler as claudeFailureHandler } from '../../src/claude/post-tool-use-failure.js';
import codexEntry, { createHandler as codexHandler } from '../../src/codex/post-tool-use.js';
import { createDiskMemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors } from '../../src/common/touch-core.js';
import { createAfterHandler as opencodeHandler } from '../../src/opencode/post-tool-use.js';
import { makeTempRepo } from '../helpers.js';
import { pendingContextDocument } from '../pending-context-helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

function executors(): TouchExecutors {
  return {
    context: async () => {
      throw new Error('ordinary touch must not duplicate pending report');
    },
    pendingContext: async () => ({ ok: true, document: pendingContextDocument() })
  };
}

const logger = new Logger();
const block = expect.stringContaining('Keep the complete explanation.');

describe('pending report host delivery', () => {
  it('gives each subprocess post hook room for bounded native collection', () => {
    for (const entry of [claudeEntry, claudeFailureEntry, codexEntry, antigravityEntry])
      expect(entry.timeout).toBe(40_000);
  });

  it.each([false, true])(
    'delivers Claude context for successful inspection and diff exit1 failure event (%s)',
    async (failure) => {
      const temp = makeTempLayout();
      const repo = makeTempRepo();
      try {
        const handler = (failure ? claudeFailureHandler : claudeHandler)(executors(), createDiskMemoStore, temp.layout);
        const result = await handler(
          {
            hook_event_name: failure ? 'PostToolUseFailure' : 'PostToolUse',
            session_id: 'pending-claude',
            tool_use_id: 'call',
            cwd: repo.root,
            tool_name: 'Bash',
            tool_input: { command: 'git diff --exit-code' },
            tool_response: { exit_code: failure ? 1 : 0, output: '' }
          } as never,
          { logger } as never
        );
        expect(result).toMatchObject({ stdout: { hookSpecificOutput: { additionalContext: block } } });
      } finally {
        temp.cleanup();
        repo.cleanup();
      }
    }
  );

  it('delivers Codex shell inspection context in its additional-context channel', async () => {
    const temp = makeTempLayout();
    const repo = makeTempRepo();
    try {
      const result = await codexHandler(
        executors(),
        createDiskMemoStore,
        temp.layout
      )(
        {
          hook_event_name: 'PostToolUse',
          session_id: 'pending-codex',
          tool_use_id: 'call',
          cwd: repo.root,
          tool_name: 'exec_command',
          tool_input: { cmd: 'git status --short', workdir: repo.root },
          tool_response: { exit_code: 0, output: '' }
        } as never,
        { logger } as never
      );
      expect(result).toMatchObject({ stdout: { hookSpecificOutput: { additionalContext: block } } });
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });

  it('appends OpenCode bash inspection context to the real output envelope', async () => {
    const temp = makeTempLayout();
    const repo = makeTempRepo();
    try {
      const handler = opencodeHandler({
        directory: repo.root,
        layout: temp.layout,
        executors: executors(),
        logger,
        takePatchPlan: () => null,
        peekShellCwd: () => repo.root,
        forgetCall: () => {}
      });
      const output = { output: 'original status', metadata: { exit: 0 } };
      await handler(
        { tool: 'bash', sessionID: 'pending-opencode', callID: 'call', args: { command: 'git status --porcelain' } },
        output
      );
      expect(output.output).toContain('original status');
      expect(output.output).toContain('Keep the complete explanation.');
      expect(output.output.match(/<git-span>/g)).toHaveLength(1);
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });

  it.each([false, true])('drains Antigravity success-only pending reports (%s failure)', async (failure) => {
    const temp = makeTempLayout();
    const repo = makeTempRepo();
    try {
      stashToolCall(temp.layout, 'pending-antigravity', 1, {
        name: 'run_command',
        args: { CommandLine: 'git diff', Cwd: repo.root }
      });
      await antigravityHandler(
        executors(),
        createDiskMemoStore,
        temp.layout
      )(
        {
          conversationId: 'pending-antigravity',
          stepIdx: 1,
          workspacePaths: [repo.root],
          ...(failure ? { error: 'command failed' } : {})
        } as never,
        { logger } as never
      );
      const result = await antigravityDrain(temp.layout)(
        { conversationId: 'pending-antigravity' } as never,
        { logger } as never
      );
      if (failure) expect(result).toBeUndefined();
      else expect(result).toMatchObject({ stdout: { injectSteps: [{ ephemeralMessage: block }] } });
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });
});
