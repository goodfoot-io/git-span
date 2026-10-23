/** Real-Git selection through each supported host's actual response channel. */

import { execFileSync } from 'node:child_process';
import { Logger as ClaudeLogger } from '@goodfoot/agent-hooks/claude-code';
import { Logger as CodexLogger } from '@goodfoot/agent-hooks/codex';
import { describe, expect, it } from 'vitest';
import { createHandler as claudeHandler } from '../../src/claude/post-tool-use.js';
import { createHandler as codexHandler } from '../../src/codex/post-tool-use.js';
import { createDefaultPlannedTouchStore, runLayeredBashTouches } from '../../src/common/bash-attribution.js';
import { createDefaultCommitInspectionExecutor } from '../../src/common/commit-inspection-context.js';
import type { MemoFactory } from '../../src/common/span-surface.js';
import type { TouchExecutors } from '../../src/common/touch-core.js';
import { createAfterHandler } from '../../src/opencode/post-tool-use.js';
import { commitRepo, makeRealBundleRepo, writeRepoFile } from '../real-bundle-helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

function fixture() {
  const repo = makeRealBundleRepo('');
  const temp = makeTempLayout();
  writeRepoFile(repo, 'main.ts', 'before\n');
  commitRepo(repo, 'Initial');
  writeRepoFile(repo, 'main.ts', 'after\n');
  commitRepo(repo, 'Selected change');
  const oid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.root, env: repo.env, encoding: 'utf8' }).trim();
  let nativeCalls = 0;
  let ordinaryCalls = 0;
  const executor = createDefaultCommitInspectionExecutor((argv) => {
    nativeCalls++;
    const span = {
      name: 'related',
      evidence_revision: 'c'.repeat(64),
      why: 'Full explanation. Second sentence.',
      overlaps: [],
      anchors: [
        {
          ordinal: 0,
          id: 'main',
          anchored: { path: 'main.ts', extent: { kind: 'lines', start: 1, end: 1 } },
          current: { path: 'main.ts', extent: { kind: 'lines', start: 1, end: 1 } },
          status: { code: 'CHANGED' },
          source: 'HEAD',
          sources: ['HEAD']
        }
      ]
    };
    return {
      executable: process.execPath,
      argv: [
        '-e',
        `process.stdout.write(JSON.stringify({schema_version:1,commits:process.argv.slice(2),spans:[${JSON.stringify(span)}]}))`,
        '--',
        ...argv
      ]
    };
  });
  const touch: TouchExecutors = {
    context: async () => {
      ordinaryCalls++;
      return {
        ok: true,
        elapsedMs: 0,
        document: {
          schema_version: 2,
          scopes: [],
          mutation: {
            requested: false,
            rewritten: false,
            spans_touched: 0,
            anchors_updated: 0,
            anchors_removed: 0,
            identities_collapsed: 0
          },
          spans: []
        }
      };
    }
  };
  const memoFactory: MemoFactory = () => ({ getSurfaced: () => new Set(), addSurfaced: () => undefined });
  const logger = { warn: () => undefined };
  return {
    repo,
    temp,
    oid,
    executor,
    touch,
    memoFactory,
    logger,
    counts: () => ({ nativeCalls, ordinaryCalls }),
    run: (command: string, response: unknown = { output: '', exit_code: 0 }) =>
      runLayeredBashTouches(
        command,
        repo.root,
        'inspection',
        undefined,
        response,
        touch,
        memoFactory(logger, temp.layout),
        logger,
        createDefaultPlannedTouchStore(temp.layout),
        { successful: true, executor }
      ),
    cleanup: () => {
      repo.cleanup();
      temp.cleanup();
    }
  };
}

function context(output: unknown): string {
  if (output === null || typeof output !== 'object') return '';
  const object = output as { stdout?: { systemMessage?: string } };
  return object.stdout?.systemMessage ?? '';
}

describe('shared complete commit inspection delivery', () => {
  it('selects plain, one-line, patch, and truncated output independently and repeats complete reports', async () => {
    const f = fixture();
    try {
      for (const command of [
        'git show',
        'git show --stat HEAD',
        'git log -n1',
        'git log --oneline -n1',
        'git log -p -n1'
      ]) {
        const blocks = await f.run(command, {
          output: 'host preview only',
          exit_code: 0,
          rawOutputPath: '/tmp/full.out'
        });
        expect(blocks).toHaveLength(1);
        expect(blocks.join('')).toContain('## related');
        expect(blocks.join('')).toContain('Second sentence.');
      }
      expect(f.counts()).toEqual({ nativeCalls: 5, ordinaryCalls: 0 });
    } finally {
      f.cleanup();
    }
  });

  it('preserves raw blob ordinary reads and still delivers detailed context after ordinary exposure', async () => {
    const f = fixture();
    try {
      await f.run('git show HEAD:main.ts', { stdout: 'after\n', exit_code: 0 });
      expect(f.counts().nativeCalls).toBe(0);
      expect(f.counts().ordinaryCalls).toBeGreaterThan(0);
      expect((await f.run('git show HEAD')).join('')).toContain('## related');
    } finally {
      f.cleanup();
    }
  });

  it('does not publish partial ordinary patch context for recognized unsupported or failed commit resolution', async () => {
    const f = fixture();
    try {
      const patch = 'diff --git a/main.ts b/main.ts\n--- a/main.ts\n+++ b/main.ts\n@@ -1 +1 @@\n-before\n+after\n';
      for (const command of ['git show --unknown HEAD', 'git log --oneline -n1 | cat', 'git show nonexistent']) {
        const blocks = await f.run(command, { stdout: patch, exit_code: 0 });
        expect(blocks.join('')).toMatch(/unavailable/i);
        expect(blocks.join('')).not.toContain('<git-span>');
      }
      expect(f.counts()).toEqual({ nativeCalls: 0, ordinaryCalls: 0 });
    } finally {
      f.cleanup();
    }
  });

  it('preserves unrelated ordinary command reads in an unsupported mixed commit inspection', async () => {
    const f = fixture();
    try {
      const output = await f.run('cat main.ts && git log -p -n1 | cat');
      expect(output.join('')).toMatch(/unavailable/i);
      expect(f.counts().nativeCalls).toBe(0);
      expect(f.counts().ordinaryCalls).toBe(1);
    } finally {
      f.cleanup();
    }
  });

  it('emits no report for an empty native Git selection and skips interrupted execution', async () => {
    const f = fixture();
    try {
      expect(await f.run('git log --grep=missing -n1')).toEqual([]);
      expect(await f.run('git show', { stdout: '', exit_code: 0, interrupted: true })).toEqual([]);
      expect(f.counts().nativeCalls).toBe(0);
    } finally {
      f.cleanup();
    }
  });
});

describe('supported host completion evidence', () => {
  it('Claude successful PostToolUse stdout envelope delivers without requiring an absent exit code', async () => {
    const f = fixture();
    try {
      const handler = claudeHandler(f.touch, f.memoFactory, f.temp.layout, {}, f.executor);
      const output = await handler(
        {
          session_id: 'claude',
          cwd: f.repo.root,
          tool_name: 'Bash',
          tool_input: { command: 'git log --oneline -n1' },
          tool_response: { stdout: 'preview', stderr: '', interrupted: false, rawOutputPath: '/tmp/full.out' }
        } as never,
        { logger: new ClaudeLogger() }
      );
      expect(context(output)).toContain('## related');
      expect(f.counts()).toEqual({ nativeCalls: 1, ordinaryCalls: 0 });
    } finally {
      f.cleanup();
    }
  });

  it('Codex synchronous exec_command structured exit zero delivers; failures, running calls and unknown completion do not', async () => {
    const f = fixture();
    try {
      const handler = codexHandler(f.touch, f.memoFactory, f.temp.layout, {}, f.executor);
      const input = {
        session_id: 'codex',
        cwd: f.repo.root,
        tool_name: 'exec_command',
        tool_input: { cmd: 'git log --oneline -n1', workdir: f.repo.root }
      };
      const output = await handler({ ...input, tool_response: { output: 'preview', exit_code: 0 } } as never, {
        logger: new CodexLogger()
      });
      expect(context(output)).toContain('## related');
      for (const tool_response of [{ output: '', exit_code: 1 }, { output: '', session_id: 100 }, 'unknown result']) {
        expect(
          context(await handler({ ...input, tool_response } as never, { logger: new CodexLogger() }))
        ).not.toContain('## related');
      }
      expect(f.counts().nativeCalls).toBe(1);
    } finally {
      f.cleanup();
    }
  });

  it('excludes Codex background calls and asynchronous polling completion', async () => {
    const f = fixture();
    try {
      const handler = codexHandler(f.touch, f.memoFactory, f.temp.layout, {}, f.executor);
      const background = await handler(
        {
          session_id: 'codex',
          cwd: f.repo.root,
          tool_name: 'exec_command',
          tool_input: { cmd: 'git show HEAD', workdir: f.repo.root, run_in_background: true },
          tool_response: { output: '', exit_code: 0 }
        } as never,
        { logger: new CodexLogger() }
      );
      const polled = await handler(
        {
          session_id: 'codex',
          cwd: f.repo.root,
          tool_name: 'write_stdin',
          tool_input: { session_id: 100 },
          tool_response: { output: '', exit_code: 0 }
        } as never,
        { logger: new CodexLogger() }
      );
      expect(context(background)).not.toContain('## related');
      expect(context(polled)).not.toContain('## related');
      expect(f.counts().nativeCalls).toBe(0);
    } finally {
      f.cleanup();
    }
  });

  it('OpenCode appends the complete report to output after mapped numeric success', async () => {
    const f = fixture();
    try {
      const handler = createAfterHandler({
        directory: f.repo.root,
        layout: f.temp.layout,
        executors: f.touch,
        memoFactory: f.memoFactory,
        inspectionExecutor: f.executor,
        takePatchPlan: () => null,
        peekShellCwd: () => f.repo.root,
        forgetCall: () => undefined
      });
      const output = { output: 'host preview', metadata: { exit: 0, output: 'preview', outputPath: '/tmp/full.out' } };
      await handler({ tool: 'bash', sessionID: 'open', callID: 'one', args: { command: 'git show HEAD' } }, output);
      expect(output.output).toContain('host preview');
      expect(output.output).toContain('## related');
      expect(f.counts()).toEqual({ nativeCalls: 1, ordinaryCalls: 0 });
    } finally {
      f.cleanup();
    }
  });
});
