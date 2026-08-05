/**
 * Cross-adapter contract (plan §9): the same shell command produces the same
 * `runTouchHook` call sequence — filePath, offset, limit, and the cwd each
 * touch was resolved against — through the Claude Bash adapter and every Codex
 * envelope (Bash, classic `exec_command` with `workdir`, code-mode `exec` with
 * `workdir`).
 *
 * `runTouchHook` is mocked to record its calls; the adapters otherwise run
 * their real narrowing and scope logic. The shared fixture table drives all
 * four envelopes from one hook cwd and asserts identical recorded sequences.
 * The workdir fixtures then pin the effective-frame rules: a classic
 * `workdir` wins over hook cwd; a relative `workdir` absolutizes against the
 * envelope's own `input.cwd`; `workdir` + `cd` compose; `git -C` resolves
 * against the effective frame; a template-literal `workdir` (containing `$`)
 * is unresolvable and falls back to hook cwd; and a `workdir` naming a second
 * temp repo scopes the touch to that repo (classic and code-mode).
 *
 * The whole suite stays skipped until Phase 3 threads the effective frame
 * through the codex handler.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger as ClaudeLogger } from '@goodfoot/claude-code-hooks';
import { Logger as CodexLogger } from '@goodfoot/codex-hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHandler as createClaudeHandler } from '../../src/claude/post-tool-use.js';
import { createHandler as createCodexHandler } from '../../src/codex/post-tool-use.js';
import type { MemoFactory, MemoLogger, MemoStore } from '../../src/common/span-surface.js';
import type { TouchInput } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';

/** One recorded `runTouchHook` invocation, as the contract compares it. */
interface RecordedTouch {
  filePath: string;
  cwd: string;
  offset?: number;
  limit?: number;
}

const { recorded } = vi.hoisted(() => ({ recorded: { calls: [] as RecordedTouch[] } }));

vi.mock('../../src/common/touch-core.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/common/touch-core.js')>();
  return {
    ...actual,
    runTouchHook: vi.fn(async (input: TouchInput) => {
      recorded.calls.push({
        filePath: input.filePath,
        cwd: input.cwd,
        offset: 'offset' in input ? input.offset : undefined,
        limit: 'limit' in input ? input.limit : undefined
      });
      return { additionalContext: null, treeModified: false };
    })
  };
});

function inMemoryMemoFactory(): MemoFactory {
  const store = new Map<string, Set<string>>();
  return (_logger: MemoLogger): MemoStore => ({
    getSurfaced: (sid) => new Set(store.get(sid) ?? []),
    addSurfaced: (sid, names) => {
      const s = store.get(sid) ?? new Set<string>();
      for (const n of names) s.add(n);
      store.set(sid, s);
    }
  });
}

describe.skip('cross-adapter contract — identical touch call sequences (Phase 3)', () => {
  const TOTAL = 20;
  let repoA: { root: string; cleanup: () => void };
  let repoB: { root: string; cleanup: () => void };
  const claudeLogger = new ClaudeLogger();
  const codexLogger = new CodexLogger();

  function initGitRepo(root: string): void {
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  }

  function commitAll(root: string, ...files: string[]): void {
    execFileSync('git', ['add', ...files], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: root });
  }

  beforeAll(() => {
    const body = `${Array.from({ length: TOTAL }, (_, i) => `line ${i + 1}`).join('\n')}\n`;
    repoA = makeTempRepo();
    initGitRepo(repoA.root);
    writeFileSync(join(repoA.root, 'f'), body);
    writeFileSync(join(repoA.root, 'g'), body);
    commitAll(repoA.root, 'f', 'g');
    // sub is a nested git repo of its own inside repoA (own .git, own committed f)
    mkdirSync(join(repoA.root, 'sub'));
    execFileSync('git', ['init', '-q', join(repoA.root, 'sub')], { stdio: 'ignore' });
    initGitRepo(join(repoA.root, 'sub'));
    writeFileSync(join(repoA.root, 'sub', 'f'), body);
    commitAll(join(repoA.root, 'sub'), 'f');
    repoB = makeTempRepo();
    initGitRepo(repoB.root);
    writeFileSync(join(repoB.root, 'f'), body);
    commitAll(repoB.root, 'f');
  });

  afterAll(() => {
    repoA.cleanup();
    repoB.cleanup();
  });

  async function runClaudeBash(cwd: string, command: string): Promise<void> {
    const handler = createClaudeHandler(undefined, inMemoryMemoFactory());
    await handler(
      { session_id: 'sess', cwd, tool_name: 'Bash', tool_input: { command } } as never,
      { logger: claudeLogger } as never
    );
  }

  async function runCodexBash(cwd: string, command: string): Promise<void> {
    const handler = createCodexHandler(undefined, inMemoryMemoFactory());
    await handler(
      { session_id: 'sess', cwd, tool_name: 'Bash', tool_input: { command } } as never,
      { logger: codexLogger } as never
    );
  }

  async function runCodexExecCommand(cwd: string, command: string, workdir: string | null): Promise<void> {
    const handler = createCodexHandler(undefined, inMemoryMemoFactory());
    const argumentsJson = JSON.stringify(workdir === null ? { cmd: command } : { cmd: command, workdir });
    await handler(
      { session_id: 'sess', cwd, tool_name: 'exec_command', tool_input: { arguments: argumentsJson } } as never,
      { logger: codexLogger } as never
    );
  }

  async function runCodexCodeModeExec(cwd: string, command: string, workdir: string): Promise<void> {
    const handler = createCodexHandler(undefined, inMemoryMemoFactory());
    const input = `const r = await tools.exec_command({cmd:"${command}", shell:"bash", workdir:"${workdir}"});\ntext(JSON.stringify(r));`;
    await handler(
      { session_id: 'sess', cwd, tool_name: 'exec', tool_input: { input } } as never,
      { logger: codexLogger } as never
    );
  }

  /** One expected touch, relative to a base dir (absolutized inside each test). */
  interface ExpectedCall {
    rel: string;
    offset: number;
    limit: number;
  }
  const read = (rel: string, offset: number, limit: number): ExpectedCall => ({ rel, offset, limit });
  const readWhole = (rel: string): ExpectedCall => ({ rel, offset: 1, limit: TOTAL });

  interface SharedFixture {
    cmd: string;
    expected: ExpectedCall[];
  }

  const SHARED_FIXTURES: SharedFixture[] = [
    { cmd: "sed -n '1,2p' f", expected: [read('f', 1, 2)] },
    { cmd: 'cat f', expected: [readWhole('f')] },
    { cmd: 'cat f | head -3', expected: [read('f', 1, 3)] },
    { cmd: "cat f | sed -n '2,4p'", expected: [read('f', 2, 3)] },
    { cmd: "cd sub; sed -n '2,4p' f", expected: [read('sub/f', 2, 3)] },
    { cmd: "sed -n '1,2p' f; sed -n '3,4p' g", expected: [read('f', 1, 2), read('g', 3, 2)] },
    { cmd: "git show HEAD:f | sed -n '2,4p'", expected: [read('f', 2, 3)] },
    { cmd: "nl -ba f | sed -n '2,4p'", expected: [read('f', 2, 3)] }
  ];

  it.each(
    SHARED_FIXTURES
  )('$cmd — identical touches across Claude Bash / Codex Bash / classic exec_command / code-mode exec', async (fixture) => {
    const expected = fixture.expected.map((c) => ({
      filePath: join(repoA.root, c.rel),
      offset: c.offset,
      limit: c.limit,
      cwd: repoA.root
    }));
    const runners = [
      () => runClaudeBash(repoA.root, fixture.cmd),
      () => runCodexBash(repoA.root, fixture.cmd),
      () => runCodexExecCommand(repoA.root, fixture.cmd, repoA.root),
      () => runCodexCodeModeExec(repoA.root, fixture.cmd, repoA.root)
    ];
    for (const run of runners) {
      recorded.calls.length = 0;
      await run();
      expect(recorded.calls).toEqual(expected);
    }
  });

  it('classic workdir wins over hook cwd — touches scope to the workdir repo', async () => {
    const expected = [{ filePath: join(repoB.root, 'f'), offset: 1, limit: 2, cwd: repoB.root }];
    recorded.calls.length = 0;
    await runCodexExecCommand(repoA.root, "sed -n '1,2p' f", repoB.root);
    expect(recorded.calls).toEqual(expected);
  });

  it("a relative workdir absolutizes against the envelope's own input.cwd", async () => {
    const expected = [{ filePath: join(repoA.root, 'sub', 'f'), offset: 1, limit: 2, cwd: join(repoA.root, 'sub') }];
    recorded.calls.length = 0;
    await runCodexExecCommand(repoA.root, "sed -n '1,2p' f", 'sub');
    expect(recorded.calls).toEqual(expected);
  });

  it('workdir and a script-level cd compose', async () => {
    const expected = [{ filePath: join(repoA.root, 'sub', 'f'), offset: 2, limit: 3, cwd: repoA.root }];
    recorded.calls.length = 0;
    await runCodexExecCommand(repoA.root, "cd sub; sed -n '2,4p' f", repoA.root);
    expect(recorded.calls).toEqual(expected);
  });

  it('git -C resolves relative to the effective frame', async () => {
    const expected = [{ filePath: join(repoA.root, 'sub', 'f'), offset: 2, limit: 3, cwd: repoA.root }];
    recorded.calls.length = 0;
    await runCodexExecCommand(repoA.root, "git -C sub show HEAD:f | sed -n '2,4p'", repoA.root);
    expect(recorded.calls).toEqual(expected);
  });

  it('a template-literal workdir is unresolvable — falls back to hook cwd', async () => {
    const expected = [{ filePath: join(repoA.root, 'f'), offset: 1, limit: 2, cwd: repoA.root }];
    recorded.calls.length = 0;
    await runCodexCodeModeExec(repoA.root, "sed -n '1,2p' f", '${repoA.root}');
    expect(recorded.calls).toEqual(expected);
  });

  it('a workdir in a second temp repo scopes the touch to that repo — classic', async () => {
    const expected = [{ filePath: join(repoA.root, 'f'), offset: 2, limit: 3, cwd: repoA.root }];
    recorded.calls.length = 0;
    await runCodexExecCommand(repoB.root, "sed -n '2,4p' f", repoA.root);
    expect(recorded.calls).toEqual(expected);
  });

  it('a workdir in a second temp repo scopes the touch to that repo — code-mode', async () => {
    const expected = [{ filePath: join(repoA.root, 'f'), offset: 2, limit: 3, cwd: repoA.root }];
    recorded.calls.length = 0;
    await runCodexCodeModeExec(repoB.root, "sed -n '2,4p' f", repoA.root);
    expect(recorded.calls).toEqual(expected);
  });
});
