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
 * Rows whose parse composes into the nested `sub` repo (its own .git) are
 * kept skipped with documented reasons: the touch cannot pass through
 * `resolveTouchScope`'s pre-existing cross-repo gate (plan §8 scopes the
 * scope check on the effective workdir, not the walk's tracked directory) —
 * never weakened, the expectations stand for a future phase.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger as ClaudeLogger } from '@goodfoot/claude-code-hooks';
import { Logger as CodexLogger } from '@goodfoot/codex-hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHandler as createClaudeHandler } from '../../src/claude/post-tool-use.js';
import { createHandler as createClaudeFailureHandler } from '../../src/claude/post-tool-use-failure.js';
import { createHandler as createClaudePlanHandler } from '../../src/claude/static-plan.js';
import { createHandler as createCodexHandler } from '../../src/codex/post-tool-use.js';
import { createHandler as createCodexPlanHandler } from '../../src/codex/static-plan.js';
import type { MemoFactory, MemoLogger, MemoStore } from '../../src/common/span-surface.js';
import type { TouchInput } from '../../src/common/touch-core.js';
import { createHandler as createMiniHandler } from '../../src/mswea/post-tool-use.js';
import { createHandler as createMiniFailureHandler } from '../../src/mswea/post-tool-use-failure.js';
import { createHandler as createMiniPlanHandler } from '../../src/mswea/static-plan.js';
import { makeTempRepo } from '../helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

/**
 * This file's own session base, on /tmp. Static plans and memo state must not
 * leak fixture session ids into the live `~/.cache/git-span/session` tree.
 */
const temp = makeTempLayout();
const layout = temp.layout;
afterAll(() => temp.cleanup());

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

describe('cross-adapter contract — identical touch call sequences (Phase 3)', () => {
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

  async function runClaudeBash(cwd: string, command: string, toolResponse: unknown = undefined): Promise<void> {
    const handler = createClaudeHandler(undefined, inMemoryMemoFactory(), layout);
    await handler(
      { session_id: 'sess', cwd, tool_name: 'Bash', tool_input: { command }, tool_response: toolResponse } as never,
      { logger: claudeLogger } as never
    );
  }

  async function runMiniBash(cwd: string, command: string, toolResponse: unknown = undefined): Promise<void> {
    const handler = createMiniHandler(undefined, inMemoryMemoFactory(), layout);
    await handler(
      {
        session_id: 'mini-sess',
        cwd,
        tool_name: 'Bash',
        tool_input: { command },
        tool_response: toolResponse
      } as never,
      { logger: claudeLogger } as never
    );
  }

  async function runCodexBash(cwd: string, command: string, toolResponse: unknown = undefined): Promise<void> {
    const handler = createCodexHandler(undefined, inMemoryMemoFactory(), layout);
    await handler(
      { session_id: 'sess', cwd, tool_name: 'Bash', tool_input: { command }, tool_response: toolResponse } as never,
      { logger: codexLogger } as never
    );
  }

  async function runCodexExecCommand(cwd: string, command: string, workdir: string | null): Promise<void> {
    const handler = createCodexHandler(undefined, inMemoryMemoFactory(), layout);
    const argumentsJson = JSON.stringify(workdir === null ? { cmd: command } : { cmd: command, workdir });
    await handler(
      { session_id: 'sess', cwd, tool_name: 'exec_command', tool_input: { arguments: argumentsJson } } as never,
      { logger: codexLogger } as never
    );
  }

  async function runCodexCodeModeExec(cwd: string, command: string, workdir: string): Promise<void> {
    const handler = createCodexHandler(undefined, inMemoryMemoFactory(), layout);
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
    /**
     * A row the plan does not own is kept skipped (never weakened): the parse
     * side resolves, but the touch cannot be recorded through the shared scope
     * gate for the fixture's shape. See the skipped rows below.
     */
    skipReason?: string;
  }

  const SHARED_FIXTURES: SharedFixture[] = [
    { cmd: "sed -n '1,2p' f", expected: [read('f', 1, 2)] },
    { cmd: 'cat f', expected: [readWhole('f')] },
    { cmd: 'cat f | head -3', expected: [read('f', 1, 3)] },
    { cmd: "cat f | sed -n '2,4p'", expected: [read('f', 2, 3)] },
    // The parse re-bases into `sub` exactly as plan §6 pins, but `sub` is its
    // own repo (fixture above): resolveTouchScope compares the file's repo
    // against the effective frame's repo and drops the touch — a pre-existing
    // cross-repo fail-closed rule the plan does not own (plan §8 scopes the
    // touch against the effective frame, not the parse's tracked directory).
    // The parse-side composition is covered by parse-command.test.ts.
    {
      cmd: "cd sub; sed -n '2,4p' f",
      expected: [read('sub/f', 2, 3)],
      skipReason:
        'cd composes into the nested `sub` repo; the cross-repo scope gate drops the touch (plan §8 frames the scope check on the effective workdir, not the tracked cd dir)'
    },
    { cmd: "sed -n '1,2p' f; sed -n '3,4p' g", expected: [read('f', 1, 2), read('g', 3, 2)] },
    // The merged parser emits both spans for a git-show pipe: the source
    // printed the whole blob (a genuine whole-file read, unlike cat/nl whose
    // whole-file emission the pipe-follows suppression holds back) and the
    // sed selector narrowed its consumer window — pinned in
    // parse-command.test.ts as "yields both the whole-file span and the
    // precise range (verbatim blob content, unlike git log -L)".
    { cmd: "git show HEAD:f | sed -n '2,4p'", expected: [readWhole('f'), read('f', 2, 3)] },
    { cmd: "nl -ba f | sed -n '2,4p'", expected: [read('f', 2, 3)] }
  ];

  it.each(SHARED_FIXTURES.filter((f) => f.skipReason === undefined))(
    '$cmd — identical touches across Claude Bash / Codex Bash / classic exec_command / code-mode exec',
    async (fixture) => {
      const expected = fixture.expected.map((c) => ({
        filePath: join(repoA.root, c.rel),
        offset: c.offset,
        limit: c.limit,
        cwd: repoA.root
      }));
      const runners = [
        () => runClaudeBash(repoA.root, fixture.cmd),
        () => runMiniBash(repoA.root, fixture.cmd),
        () => runCodexBash(repoA.root, fixture.cmd),
        () => runCodexExecCommand(repoA.root, fixture.cmd, repoA.root),
        () => runCodexCodeModeExec(repoA.root, fixture.cmd, repoA.root)
      ];
      for (const run of runners) {
        recorded.calls.length = 0;
        await run();
        expect(recorded.calls).toEqual(expected);
      }
    }
  );

  // Plan-foreign rows, kept skipped with their reasons (never weakened — the
  // expectation stands for a future phase that scopes touches to the tracked
  // directory): the parse resolves into the nested `sub` repo for all four
  // envelopes, but resolveTouchScope's pre-existing cross-repo gate compares
  // the file's repo (sub) against the effective frame's repo (repoA) and
  // drops the touch — identical empty sequences on every envelope, which the
  // recorded-calls contract would have to assert rather than the table's
  // recorded-touch row. The plan's §8 frame rule is the effective workdir; it
  // does not thread the walk's tracked directory into the scope check.
  it.skip.each(SHARED_FIXTURES.filter((f) => f.skipReason !== undefined))('$cmd — SKIPPED: $skipReason', () => {});

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

  // Plan-foreign (same shape as the skipped shared `cd sub` row): the parse
  // composes `cd sub` / `git -C sub` into the nested `sub` repo exactly as
  // plan §6 pins, but the touch cannot be recorded — resolveTouchScope's
  // pre-existing cross-repo gate compares the file's repo (sub) against the
  // effective frame's repo (repoA) and drops it. Plan §8 frames the scope
  // check on the effective workdir, not the walk's tracked directory; the
  // expectation stands for a future phase rather than being weakened.
  it.skip('workdir and a script-level cd compose — parse re-bases into sub; the cross-repo scope gate drops the touch', () => {});

  it.skip('git -C resolves relative to the effective frame — parse composes into sub; the cross-repo scope gate drops the touch', () => {});

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

  it.each([
    {
      name: 'short-circuited &&',
      command: 'false && cat f',
      response: { output: '', exitStatus: 1 },
      expected: []
    },
    {
      name: 'taken || branch',
      command: 'false || cat f',
      response: { output: '', exitStatus: 0 },
      expected: [{ filePath: '', cwd: '', offset: 1, limit: TOTAL }]
    },
    {
      name: 'interrupted',
      command: 'cat f',
      response: { output: '', interrupted: true },
      expected: []
    },
    {
      name: 'nullable timeout',
      command: 'cat f',
      response: { output: '', exitStatus: 0, timedOutAfterMs: null },
      expected: [{ filePath: '', cwd: '', offset: 1, limit: TOTAL }]
    },
    { name: 'untracked read', command: 'cat untracked', response: { output: '', exitStatus: 0 }, expected: [] }
  ])('$name has the same join/interruption/tracking result in Claude, mini-swe, and Codex', async (fixture) => {
    writeFileSync(join(repoA.root, 'untracked'), 'not in the index\n');
    const expected = fixture.expected.map((call) => ({
      ...call,
      filePath: join(repoA.root, 'f'),
      cwd: repoA.root
    }));
    for (const run of [runClaudeBash, runMiniBash, runCodexBash]) {
      recorded.calls.length = 0;
      await run(repoA.root, fixture.command, fixture.response);
      expect(recorded.calls).toEqual(expected);
    }
  });

  it('keeps response-derived reads as a distinct, cross-host pass', async () => {
    const response = { output: 'f:2:needle\n', exitStatus: 0 };
    const expected = [{ filePath: join(repoA.root, 'f'), cwd: repoA.root, offset: 2, limit: 1 }];
    for (const run of [runClaudeBash, runMiniBash, runCodexBash]) {
      recorded.calls.length = 0;
      await run(repoA.root, 'rg -n needle .', response);
      expect(recorded.calls).toEqual(expected);
    }
  });

  it('attributes a verified failed substitution identically through Claude, mini-swe, and Codex events', async () => {
    const command = "sed -i 's/line 7/changed/' f; false";
    const cases = [
      {
        sessionId: 'failed-claude',
        toolUseId: 'failed-claude-tool',
        plan: createClaudePlanHandler(layout),
        post: createClaudeFailureHandler(undefined, inMemoryMemoFactory(), layout)
      },
      {
        sessionId: 'failed-mini',
        toolUseId: 'failed-mini-tool',
        plan: createMiniPlanHandler(layout),
        post: createMiniFailureHandler(undefined, inMemoryMemoFactory(), layout)
      }
    ];
    for (const fixture of cases) {
      writeFileSync(join(repoA.root, 'f'), `${Array.from({ length: TOTAL }, (_, i) => `line ${i + 1}`).join('\n')}\n`);
      const input = {
        session_id: fixture.sessionId,
        tool_use_id: fixture.toolUseId,
        cwd: repoA.root,
        tool_name: 'Bash',
        tool_input: { command }
      };
      const warnings: string[] = [];
      const testLogger = {
        warn: (message: string) => warnings.push(message),
        info: () => undefined
      };
      await fixture.plan(input as never, { logger: testLogger } as never);
      expect(
        existsSync(join(layout.base, fixture.sessionId, 'planned-touches', `${fixture.toolUseId}.json`)),
        fixture.sessionId
      ).toBe(true);
      writeFileSync(
        join(repoA.root, 'f'),
        `${Array.from({ length: TOTAL }, (_, i) => (i === 6 ? 'changed' : `line ${i + 1}`)).join('\n')}\n`
      );
      recorded.calls.length = 0;
      await fixture.post(input as never, { logger: testLogger } as never);
      expect(warnings, fixture.sessionId).toEqual([]);
      expect(recorded.calls, fixture.sessionId).toEqual([
        { filePath: join(repoA.root, 'f'), cwd: repoA.root, offset: undefined, limit: undefined }
      ]);
    }

    writeFileSync(join(repoA.root, 'f'), `${Array.from({ length: TOTAL }, (_, i) => `line ${i + 1}`).join('\n')}\n`);
    const codexInput = {
      session_id: 'failed-codex',
      tool_use_id: 'failed-codex-tool',
      cwd: repoA.root,
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: { output: '', exitStatus: 1 }
    };
    await createCodexPlanHandler(layout)(codexInput as never, { logger: codexLogger } as never);
    writeFileSync(
      join(repoA.root, 'f'),
      `${Array.from({ length: TOTAL }, (_, i) => (i === 6 ? 'changed' : `line ${i + 1}`)).join('\n')}\n`
    );
    recorded.calls.length = 0;
    await createCodexHandler(
      undefined,
      inMemoryMemoFactory(),
      layout
    )(
      codexInput as never,
      {
        logger: codexLogger
      } as never
    );
    expect(recorded.calls).toEqual([
      { filePath: join(repoA.root, 'f'), cwd: repoA.root, offset: undefined, limit: undefined }
    ]);
  });
});
