import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@goodfoot/agent-hooks';
import { describe, expect, it } from 'vitest';
import { createHandler as antigravityDrain } from '../../src/antigravity/post-invocation.js';
import { createHandler as antigravityPost } from '../../src/antigravity/post-tool-use.js';
import { stashToolCall } from '../../src/antigravity/stash.js';
import { createHandler as antigravityStop } from '../../src/antigravity/stop.js';
import { createHandler as claudePost } from '../../src/claude/post-tool-use.js';
import { createHandler as codexPost } from '../../src/codex/post-tool-use.js';
import { createHandler as codexPre } from '../../src/codex/static-plan.js';
import { createDefaultPlannedTouchStore, planBashTouches } from '../../src/common/bash-attribution.js';
import { FIRST_WRITE_GUIDANCE } from '../../src/common/first-write-guidance.js';
import { createAfterHandler } from '../../src/opencode/post-tool-use.js';
import { makeTempRepo } from '../helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';
import { contextExecutors } from '../touch-context-fake.js';

const logger = new Logger();
const ctx = { logger };
const emptyExecutors = () =>
  contextExecutors({
    fix: async () => ({ modified: false }),
    list: async () => [],
    drift: async () => [],
    why: async () => null
  });
function fixture() {
  const repo = makeTempRepo();
  const temp = makeTempLayout();
  writeFileSync(join(repo.root, 'seed.ts'), 'seed\n');
  execFileSync('git', ['add', '.'], { cwd: repo.root });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'seed'], {
    cwd: repo.root
  });
  return {
    repo,
    layout: temp.layout,
    cleanup: () => {
      repo.cleanup();
      temp.cleanup();
    }
  };
}
function context(result: unknown): string {
  const value = result as
    | {
        stdout?: {
          hookSpecificOutput?: { additionalContext?: string };
          additionalContext?: string;
          systemMessage?: string;
          message?: string;
          injectSteps?: { ephemeralMessage?: string }[];
        };
      }
    | null
    | undefined;
  return (
    value?.stdout?.hookSpecificOutput?.additionalContext ??
    value?.stdout?.additionalContext ??
    value?.stdout?.systemMessage ??
    value?.stdout?.message ??
    value?.stdout?.injectSteps?.[0]?.ephemeralMessage ??
    ''
  );
}

describe('native first-write host delivery', () => {
  for (const host of ['claude', 'codex', 'opencode', 'antigravity'] as const) {
    it(`${host}: reads/failures/skipped writes do not claim; a successful shell write delivers once across handlers and sessions`, async () => {
      const f = fixture();
      let sequence = 0;
      const executors = emptyExecutors();
      const completed = new Map<string, { stdout: string; status: number | null }>();
      const run = async (command: string, sessionId = 's', reusedId?: string, replay = false) => {
        const toolUseId = reusedId ?? String(++sequence);
        const base = {
          session_id: sessionId,
          cwd: f.repo.root,
          tool_use_id: toolUseId,
          transcript_path: '/tmp/transcript',
          tool_name: 'exec_command',
          tool_input: { cmd: command, workdir: f.repo.root }
        };
        if (!replay) {
          planBashTouches(command, f.repo.root, sessionId, toolUseId, logger, createDefaultPlannedTouchStore(f.layout));
          if (host === 'codex')
            await codexPre(f.layout)({ ...base, hook_event_name: 'PreToolUse' } as never, ctx as never);
        }
        const identity = `${sessionId}:${toolUseId}`;
        const response = replay
          ? completed.get(identity)
          : spawnSync('bash', ['-c', command], { cwd: f.repo.root, encoding: 'utf8' });
        if (response === undefined) throw new Error('no completed event available for replay');
        completed.set(identity, response);
        const toolResponse = { stdout: response.stdout, exit_code: response.status, interrupted: false };
        if (host === 'claude')
          return context(
            await claudePost(
              executors,
              undefined,
              f.layout
            )(
              { ...base, tool_name: 'Bash', tool_input: { command }, tool_response: toolResponse } as never,
              ctx as never
            )
          );
        if (host === 'codex')
          return context(
            await codexPost(
              executors,
              undefined,
              f.layout
            )({ ...base, tool_response: toolResponse } as never, ctx as never)
          );
        if (host === 'opencode') {
          const output = { output: response.stdout, metadata: { exit: response.status } };
          await createAfterHandler({
            directory: f.repo.root,
            layout: f.layout,
            executors,
            logger,
            takePatchPlan: () => null,
            peekShellCwd: () => null,
            forgetCall: () => undefined
          })({ sessionID: sessionId, callID: toolUseId, tool: 'bash', args: { command } }, output);
          return output.output.slice(response.stdout.length);
        }
        if (!replay)
          stashToolCall(f.layout, sessionId, Number(toolUseId), {
            name: 'run_command',
            args: { CommandLine: command, Cwd: f.repo.root }
          });
        await antigravityPost(
          executors,
          undefined,
          f.layout
        )(
          {
            conversationId: sessionId,
            stepIdx: Number(toolUseId),
            workspacePaths: [f.repo.root],
            ...(response.status === 0 ? {} : { error: 'command failed' })
          } as never,
          ctx as never
        );
        const result = await antigravityDrain(f.layout)({ conversationId: sessionId } as never, ctx as never);
        await antigravityStop(f.layout)({ conversationId: sessionId } as never, ctx as never);
        return context(result);
      };
      try {
        expect(await run('cat seed.ts')).not.toContain(FIRST_WRITE_GUIDANCE);
        expect(await run('false && printf blocked > new.ts')).not.toContain(FIRST_WRITE_GUIDANCE);
        expect(await run('false && printf seed > seed.ts || true')).not.toContain(FIRST_WRITE_GUIDANCE);
        const firstWrite = await run('printf value > new.ts; printf extra > second.ts', 's', '100');
        expect(firstWrite.split(FIRST_WRITE_GUIDANCE)).toHaveLength(2);
        expect(await run('printf value > new.ts; printf extra > second.ts', 's', '100', true)).not.toContain(
          FIRST_WRITE_GUIDANCE
        );
        expect(await run('printf next > next.ts')).not.toContain(FIRST_WRITE_GUIDANCE);
        expect(await run('printf other > other.ts', 'other')).toContain(FIRST_WRITE_GUIDANCE);
        writeFileSync(join(f.repo.root, 'untracked.txt'), 'before\n');
        expect(await run("false && sed -i 's/before/after/' untracked.txt || true", 'sed')).not.toContain(
          FIRST_WRITE_GUIDANCE
        );
        expect(await run("sed -i 's/before/after/' untracked.txt", 'sed')).toContain(FIRST_WRITE_GUIDANCE);
        writeFileSync(join(f.repo.root, 'untracked.txt'), 'before\n');
        expect(
          await run(
            `python3 -c "from pathlib import Path; p=Path('untracked.txt'); s=p.read_text(); p.write_text(s.replace('before','after'))"`,
            'python'
          )
        ).toContain(FIRST_WRITE_GUIDANCE);
        for (const operation of ['rm', 'mv'] as const) {
          const source = `${operation}-source.txt`;
          const destination = `${operation}-destination.txt`;
          const command = operation === 'rm' ? `rm ${source}` : `mv ${source} ${destination}`;
          const session = `${operation}-untracked`;
          // A pre-existing destination must not make a missing source look successful.
          if (operation === 'mv') writeFileSync(join(f.repo.root, destination), 'old target\n');
          expect(await run(command, session)).not.toContain(FIRST_WRITE_GUIDANCE);
          expect(await run(`${command} || true`, session)).not.toContain(FIRST_WRITE_GUIDANCE);
          writeFileSync(join(f.repo.root, source), 'untracked source\n');
          expect(await run(`false && ${command} || true`, session)).not.toContain(FIRST_WRITE_GUIDANCE);
          const id = operation === 'rm' ? '200' : '300';
          expect(await run(command, session, id)).toContain(FIRST_WRITE_GUIDANCE);
          expect(await run(command, session, id, true)).not.toContain(FIRST_WRITE_GUIDANCE);
          writeFileSync(join(f.repo.root, source), 'another session source\n');
          expect(await run(command, `${session}-independent`)).toContain(FIRST_WRITE_GUIDANCE);
        }
      } finally {
        f.cleanup();
      }
    });
  }

  it('Claude: an empty new structured file is sufficient and error envelopes do not claim', async () => {
    const f = fixture();
    try {
      const path = join(f.repo.root, 'empty.ts');
      writeFileSync(path, '');
      const event = {
        session_id: 'structured',
        cwd: f.repo.root,
        tool_use_id: 'write',
        tool_name: 'Write',
        tool_input: { file_path: path, content: '' },
        tool_response: {}
      };
      const handler = () => claudePost(emptyExecutors(), undefined, f.layout);
      expect(context(await handler()({ ...event, tool_response: { is_error: true } } as never, ctx as never))).toBe('');
      expect(context(await handler()(event as never, ctx as never))).toBe(FIRST_WRITE_GUIDANCE);
      expect(context(await handler()(event as never, ctx as never))).toBe('');
    } finally {
      f.cleanup();
    }
  });

  it('Codex: patches qualify without spans, and failed patch output does not consume the claim', async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.repo.root, 'new.ts'), 'value\n');
      const event = {
        session_id: 'patch',
        cwd: f.repo.root,
        tool_use_id: 'failed',
        tool_name: 'apply_patch',
        tool_input: { command: '*** Begin Patch\n*** Add File: new.ts\n+value\n*** End Patch' },
        tool_response: 'Error applying patch'
      };
      expect(context(await codexPost(emptyExecutors(), undefined, f.layout)(event as never, ctx as never))).toBe('');
      const success = {
        ...event,
        tool_use_id: 'success',
        tool_response: 'Success. Updated the following files:\nA new.ts'
      };
      expect(context(await codexPost(emptyExecutors(), undefined, f.layout)(success as never, ctx as never))).toBe(
        FIRST_WRITE_GUIDANCE
      );
      expect(context(await codexPost(emptyExecutors(), undefined, f.layout)(success as never, ctx as never))).toBe('');
      rmSync(join(f.repo.root, 'seed.ts'));
      expect(
        context(
          await codexPost(
            emptyExecutors(),
            undefined,
            f.layout
          )(
            {
              ...success,
              session_id: 'delete',
              tool_use_id: 'delete',
              tool_input: { command: '*** Begin Patch\n*** Delete File: seed.ts\n*** End Patch' }
            } as never,
            ctx as never
          )
        )
      ).toBe(FIRST_WRITE_GUIDANCE);
    } finally {
      f.cleanup();
    }
  });

  it('Codex: yielded commands qualify only at the successful terminal poll using their original identity', async () => {
    const f = fixture();
    const base = {
      session_id: 'polled',
      cwd: f.repo.root,
      tool_use_id: 'original',
      tool_name: 'exec_command',
      tool_input: { cmd: 'printf value > polled.ts', workdir: f.repo.root }
    };
    try {
      await codexPre(f.layout)(base as never, ctx as never);
      expect(
        context(
          await codexPost(
            emptyExecutors(),
            undefined,
            f.layout
          )({ ...base, tool_response: { session_id: 432, output: '' } } as never, ctx as never)
        )
      ).toBe('');
      const poll = { ...base, tool_use_id: 'poll', tool_name: 'write_stdin', tool_input: { session_id: 432 } };
      expect(
        context(
          await codexPost(
            emptyExecutors(),
            undefined,
            f.layout
          )({ ...poll, tool_response: { session_id: 432, output: '' } } as never, ctx as never)
        )
      ).toBe('');
      writeFileSync(join(f.repo.root, 'polled.ts'), 'value');
      expect(
        context(
          await codexPost(
            emptyExecutors(),
            undefined,
            f.layout
          )({ ...poll, tool_response: { exit_code: 0, output: '' } } as never, ctx as never)
        )
      ).toBe(FIRST_WRITE_GUIDANCE);
      expect(
        context(
          await codexPost(
            emptyExecutors(),
            undefined,
            f.layout
          )({ ...poll, tool_response: { exit_code: 0, output: '' } } as never, ctx as never)
        )
      ).toBe('');
    } finally {
      f.cleanup();
    }
  });
});

describe('write guidance remains independent from context failures', () => {
  for (const host of ['claude', 'codex', 'opencode', 'antigravity'] as const) {
    it(`${host}: a throwing context query cannot consume and hide the shell reminder`, async () => {
      const f = fixture();
      let queries = 0;
      const executors = {
        context: async () => {
          queries++;
          throw new Error('context unavailable');
        }
      };
      const command = 'printf changed > seed.ts';
      writeFileSync(join(f.repo.root, 'seed.ts'), 'changed');
      try {
        const base = {
          session_id: 'throwing',
          cwd: f.repo.root,
          tool_use_id: 'write',
          tool_input: { command, workdir: f.repo.root },
          tool_name: 'Bash',
          tool_response: { stdout: '', exit_code: 0 }
        };
        let output: string;
        if (host === 'claude')
          output = context(await claudePost(executors, undefined, f.layout)(base as never, ctx as never));
        else if (host === 'codex')
          output = context(await codexPost(executors, undefined, f.layout)(base as never, ctx as never));
        else if (host === 'opencode') {
          const result = { output: '', metadata: { exit: 0 } };
          await createAfterHandler({
            directory: f.repo.root,
            layout: f.layout,
            executors,
            logger,
            takePatchPlan: () => null,
            peekShellCwd: () => null,
            forgetCall: () => undefined
          })({ sessionID: 'throwing', callID: 'write', tool: 'bash', args: { command } }, result);
          output = result.output;
        } else {
          stashToolCall(f.layout, 'throwing', 1, {
            name: 'run_command',
            args: { CommandLine: command, Cwd: f.repo.root }
          });
          await antigravityPost(
            executors,
            undefined,
            f.layout
          )({ conversationId: 'throwing', stepIdx: 1, workspacePaths: [f.repo.root] } as never, ctx as never);
          output = context(await antigravityDrain(f.layout)({ conversationId: 'throwing' } as never, ctx as never));
        }
        expect(queries).toBe(1);
        expect(output).toContain(FIRST_WRITE_GUIDANCE);
      } finally {
        f.cleanup();
      }
    });
  }

  it.each(['claude', 'opencode'] as const)(
    '%s structured writes still deliver when a context query throws',
    async (host) => {
      const f = fixture();
      let queries = 0;
      const executors = {
        context: async () => {
          queries++;
          throw new Error('context unavailable');
        }
      };
      try {
        writeFileSync(join(f.repo.root, 'seed.ts'), 'changed');
        let output: string;
        if (host === 'claude')
          output = context(
            await claudePost(
              executors,
              undefined,
              f.layout
            )(
              {
                session_id: 'structured-throw',
                tool_use_id: 'write',
                cwd: f.repo.root,
                tool_name: 'Write',
                tool_input: { file_path: join(f.repo.root, 'seed.ts'), content: 'changed' },
                tool_response: {}
              } as never,
              ctx as never
            )
          );
        else {
          const result = { output: 'native result' };
          await createAfterHandler({
            directory: f.repo.root,
            layout: f.layout,
            executors,
            logger,
            takePatchPlan: () => null,
            peekShellCwd: () => null,
            forgetCall: () => undefined
          })(
            {
              sessionID: 'structured-throw',
              callID: 'write',
              tool: 'write',
              args: { filePath: 'seed.ts', content: 'changed' }
            },
            result
          );
          output = result.output;
          expect(output.startsWith('native result')).toBe(true);
        }
        expect(queries).toBe(1);
        expect(output).toContain(FIRST_WRITE_GUIDANCE);
      } finally {
        f.cleanup();
      }
    }
  );

  it.each([
    "sed -i 's/before/after/' untracked.txt",
    `python3 -c "from pathlib import Path; p=Path('untracked.txt'); s=p.read_text(); p.write_text(s.replace('before','after'))"`
  ])('retains scoped untracked pre-state evidence without sending it to context: %s', async (command) => {
    const f = fixture();
    let queries = 0;
    try {
      writeFileSync(join(f.repo.root, 'untracked.txt'), 'before\n');
      const store = createDefaultPlannedTouchStore(f.layout);
      planBashTouches(command, f.repo.root, 'observation', 'write', logger, store);
      execFileSync('bash', ['-c', command], { cwd: f.repo.root });
      const { runLayeredBashTouches } = await import('../../src/common/bash-attribution.js');
      const { createDiskMemoStore } = await import('../../src/common/span-surface.js');
      const { firstWriteGuidance } = await import('../../src/common/first-write-guidance.js');
      const memo = createDiskMemoStore(logger, f.layout);
      const output = await runLayeredBashTouches(
        command,
        f.repo.root,
        'observation',
        'write',
        { exit_code: 0 },
        {
          context: async () => {
            queries++;
            throw new Error('untracked context must not run');
          }
        },
        memo,
        logger,
        store,
        { successful: true, onWrite: () => firstWriteGuidance('observation', memo, true) }
      );
      expect(output).toEqual([FIRST_WRITE_GUIDANCE]);
      expect(queries).toBe(0);
    } finally {
      f.cleanup();
    }
  });
});

describe('untracked source removal evidence', () => {
  it.each(['rm new.txt', 'mv new.txt moved.txt'])(
    'observes a successful first %s without querying spans',
    async (command) => {
      const f = fixture();
      let queries = 0;
      try {
        writeFileSync(join(f.repo.root, 'new.txt'), 'new\n');
        const store = createDefaultPlannedTouchStore(f.layout);
        planBashTouches(command, f.repo.root, 'removal', 'write', logger, store);
        execFileSync('bash', ['-c', command], { cwd: f.repo.root });
        const { runLayeredBashTouches } = await import('../../src/common/bash-attribution.js');
        const { createDiskMemoStore } = await import('../../src/common/span-surface.js');
        const { firstWriteGuidance } = await import('../../src/common/first-write-guidance.js');
        const memo = createDiskMemoStore(logger, f.layout);
        const output = await runLayeredBashTouches(
          command,
          f.repo.root,
          'removal',
          'write',
          { exit_code: 0 },
          {
            context: async () => {
              queries++;
              throw new Error('untracked context must not run');
            }
          },
          memo,
          logger,
          store,
          { successful: true, onWrite: () => firstWriteGuidance('removal', memo, true) }
        );
        expect(output).toEqual([FIRST_WRITE_GUIDANCE]);
        expect(queries).toBe(0);
      } finally {
        f.cleanup();
      }
    }
  );
});
