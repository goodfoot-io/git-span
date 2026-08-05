/**
 * Acceptance checks for bash-touch.ts (card main-212, TDD Phases 2-3).
 *
 * Phase 1 shipped `bashSpanToTouch` (the plan §2 operation→touch table) and
 * `bashResponseInterrupted` functional, and stubbed `runBashTouches` (the
 * plan §3 step 2 per-command verdict driver — only the interrupted gate ran).
 * Phase 2 wrote this contract's acceptance checks against those stubs; Phase
 * 3 (card main-212 step 10) unskipped them one at a time against the real
 * driver.
 *
 * Fixtures run against real temp repos (`makeTempRepo`) so `resolveTouchScope`
 * passes and the driver's gates can read real post-command file state. The
 * post-state checks the plan pins (exact content for literal echo `>` writes,
 * absent-source cp/install resolution) ride on `ResolvedSpan.written` — the
 * driver maps it to the touch's `postState.content.exact` (the touch itself
 * stays whole-file per the F2 lesson: `written: ''`).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';
import { bashSpanToTouch, runBashTouches } from '../../src/common/bash-touch.js';
import type { ResolvedSpan, SpanMatch } from '../../src/common/parse-command.js';
import type { MemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors, TouchFixResult } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';

const SESSION_ID = 'session-bash-touch-test';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** An in-memory MemoStore fake — one Set of surfaced names per session id. */
function createMemoryMemoStore(): MemoStore {
  const bySession = new Map<string, Set<string>>();
  return {
    getSurfaced(sessionId: string): Set<string> {
      return new Set(bySession.get(sessionId) ?? []);
    },
    addSurfaced(sessionId: string, names: string[]): void {
      const existing = bySession.get(sessionId) ?? new Set<string>();
      for (const n of names) existing.add(n);
      bySession.set(sessionId, existing);
    }
  };
}

/**
 * Counting fake executors that also record the paths each executor was called
 * with, so the driver checks can assert exactly which touches fired (and that
 * suppressed spans never reached an executor).
 */
function makeCountingExecutors(): {
  executors: TouchExecutors;
  calls: { fix: number; list: number; drift: number; why: number };
  fixPaths: string[];
  listPaths: string[];
} {
  const calls = { fix: 0, list: 0, drift: 0, why: 0 };
  const fixPaths: string[] = [];
  const listPaths: string[] = [];
  return {
    executors: {
      fix: async (filePath): Promise<TouchFixResult> => {
        calls.fix += 1;
        fixPaths.push(filePath);
        return { modified: false };
      },
      list: async (filePath): Promise<PorcelainRow[]> => {
        calls.list += 1;
        listPaths.push(filePath);
        return [];
      },
      drift: async (): Promise<DriftPorcelainRow[]> => {
        calls.drift += 1;
        return [];
      },
      why: async (): Promise<string | null> => {
        calls.why += 1;
        return null;
      }
    },
    calls,
    fixPaths,
    listPaths
  };
}

// ---------------------------------------------------------------------------
// bashSpanToTouch — the plan §2 operation→touch translation table
// ---------------------------------------------------------------------------

describe('bashSpanToTouch — operation→touch translation (plan §2)', () => {
  let repo: { root: string; cleanup: () => void };

  beforeAll(() => {
    repo = makeTempRepo();
    writeFileSync(join(repo.root, '.gitignore'), 'ignored.ts\n');
    // The `src/app.ts` translation fixture lives one directory below the repo
    // root; `resolveTouchScope` resolves the repo root from the file's parent
    // directory, which must exist (`git -C <dir> rev-parse` fails otherwise).
    mkdirSync(join(repo.root, 'src'));
  });

  afterAll(() => {
    repo.cleanup();
  });

  const appPath = () => join(repo.root, 'src/app.ts');

  function span(overrides: Partial<ResolvedSpan>): ResolvedSpan {
    return { operation: 'create-overwrite', absolutePath: appPath(), simpleCommandIndex: 0, ...overrides };
  }

  it('read → read touch carrying the span range as offset/limit', () => {
    expect(bashSpanToTouch(span({ operation: 'read', lineStart: 3, lineEnd: 7 }), SESSION_ID, repo.root)).toEqual({
      kind: 'read',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      offset: 3,
      limit: 5
    });
  });

  it('create-overwrite → whole-file write touch (written: ""), targetState "exists"', () => {
    expect(bashSpanToTouch(span({ operation: 'create-overwrite' }), SESSION_ID, repo.root)).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: '',
      targetState: 'exists'
    });
  });

  it('rename-copy → whole-file write touch, targetState "exists"', () => {
    expect(bashSpanToTouch(span({ operation: 'rename-copy' }), SESSION_ID, repo.root)).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: '',
      targetState: 'exists'
    });
  });

  it('truncate → whole-file write touch, targetState "exists"', () => {
    expect(bashSpanToTouch(span({ operation: 'truncate' }), SESSION_ID, repo.root)).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: '',
      targetState: 'exists'
    });
  });

  it('append with a written body → write touch threading the body with a suffix post-state', () => {
    expect(bashSpanToTouch(span({ operation: 'append', written: 'x\n' }), SESSION_ID, repo.root)).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: 'x\n',
      targetState: 'exists',
      postState: { content: { suffix: 'x\n' } }
    });
  });

  it('append without a written body → whole-file append touch without post-state', () => {
    expect(bashSpanToTouch(span({ operation: 'append' }), SESSION_ID, repo.root)).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: '',
      targetState: 'exists'
    });
  });

  it('modify with a range → write touch carrying the exact range', () => {
    expect(bashSpanToTouch(span({ operation: 'modify', lineStart: 2, lineEnd: 4 }), SESSION_ID, repo.root)).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: '',
      targetState: 'exists',
      range: { start: 2, end: 4 }
    });
  });

  it('modify without a range → whole-file write touch', () => {
    expect(bashSpanToTouch(span({ operation: 'modify' }), SESSION_ID, repo.root)).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: '',
      targetState: 'exists'
    });
  });

  it('delete → whole-file write touch, targetState "absent", realDelete post-state', () => {
    expect(bashSpanToTouch(span({ operation: 'delete' }), SESSION_ID, repo.root)).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: '',
      targetState: 'absent',
      postState: { realDelete: true }
    });
  });

  it('a span outside the CWD repo resolves to null (fail closed)', () => {
    expect(
      bashSpanToTouch(
        span({ operation: 'create-overwrite', absolutePath: join(repo.root, '..', 'outside.txt') }),
        SESSION_ID,
        repo.root
      )
    ).toBeNull();
  });

  it('a gitignored span resolves to null (fail closed)', () => {
    expect(
      bashSpanToTouch(
        span({ operation: 'create-overwrite', absolutePath: join(repo.root, 'ignored.ts') }),
        SESSION_ID,
        repo.root
      )
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runBashTouches — the plan §3 step 2 per-command verdict driver
// ---------------------------------------------------------------------------

describe('runBashTouches — per-command verdicts, explanations, and the join filter (plan §3 step 2)', () => {
  let repo: { root: string; cleanup: () => void };

  function freshRepo(): string {
    if (repo) repo.cleanup();
    repo = makeTempRepo();
    return repo.root;
  }

  afterEach(() => {
    repo?.cleanup();
  });

  /**
   * Seed post-command file state: write `files` (a `null` content is a
   * placeholder written so it can be tracked), `git add` the tracked ones,
   * then delete the `null`-content ones. Index entries survive `rm` — the
   * delete-reality probe (`git ls-files --error-unmatch`) sees them.
   */
  function seedState(root: string, files: Array<[string, string | null]>, tracked: string[]): void {
    for (const [rel, content] of files) {
      writeFileSync(join(root, rel), content ?? 'placeholder\n');
    }
    if (tracked.length > 0) execFileSync('git', ['add', ...tracked], { cwd: root });
    for (const [rel, content] of files) {
      if (content === null) rmSync(join(root, rel), { force: true });
    }
  }

  function resolved(idiom: 'rm-write' | 'redirect-write' | 'sed-inplace' | 'cp-write', s: ResolvedSpan): SpanMatch {
    return { status: 'resolved', idiom, span: s };
  }

  const deleteOn = (root: string, rel: string, index: number, joinOp?: '&&' | '||'): ResolvedSpan => ({
    operation: 'delete',
    absolutePath: join(root, rel),
    simpleCommandIndex: index,
    ...(joinOp ? { join: joinOp } : {})
  });

  const modifyOn = (root: string, rel: string, index: number, joinOp?: '&&' | '||'): ResolvedSpan => ({
    operation: 'modify',
    absolutePath: join(root, rel),
    simpleCommandIndex: index,
    ...(joinOp ? { join: joinOp } : {})
  });

  const createOn = (
    root: string,
    rel: string,
    index: number,
    joinOp?: '&&' | '||',
    written?: string
  ): ResolvedSpan => ({
    operation: 'create-overwrite',
    absolutePath: join(root, rel),
    simpleCommandIndex: index,
    ...(written !== undefined ? { written } : {}),
    ...(joinOp ? { join: joinOp } : {})
  });

  const readOn = (root: string, rel: string, index: number, joinOp?: '&&' | '||'): ResolvedSpan => ({
    operation: 'read',
    absolutePath: join(root, rel),
    lineStart: 1,
    lineEnd: 2,
    simpleCommandIndex: index,
    ...(joinOp ? { join: joinOp } : {})
  });

  it('rm f && sed -i f with the rm failing (f present): zero executor calls — the join is the only layer that can suppress the existence-gated sed', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'unchanged\n']], ['f.txt']);
    const { executors, calls } = makeCountingExecutors();

    await runBashTouches(
      [resolved('rm-write', deleteOn(root, 'f.txt', 0)), resolved('sed-inplace', modifyOn(root, 'f.txt', 1, '&&'))],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
  });

  it('rm a && sed -i b with the rm succeeding (a tracked+deleted): sed fires; the rm delete also fires', async () => {
    const root = freshRepo();
    seedState(
      root,
      [
        ['a.txt', null],
        ['b.txt', 'x\n']
      ],
      ['a.txt']
    );
    const a = join(root, 'a.txt');
    const b = join(root, 'b.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [resolved('rm-write', deleteOn(root, 'a.txt', 0)), resolved('sed-inplace', modifyOn(root, 'b.txt', 1, '&&'))],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toContain(b);
    expect(fixPaths).toContain(a);
  });

  it('rm x || sed -i y with the rm succeeding: the || join drops the sed entirely', async () => {
    const root = freshRepo();
    seedState(
      root,
      [
        ['x.txt', null],
        ['y.txt', 'a\n']
      ],
      ['x.txt']
    );
    const y = join(root, 'y.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [resolved('rm-write', deleteOn(root, 'x.txt', 0)), resolved('sed-inplace', modifyOn(root, 'y.txt', 1, '||'))],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).not.toContain(y);
  });

  it('rm x || sed -i y with the rm failing (x present): the || join fires the sed', async () => {
    const root = freshRepo();
    seedState(
      root,
      [
        ['x.txt', 'x1\n'],
        ['y.txt', 'a\n']
      ],
      []
    );
    const y = join(root, 'y.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [resolved('rm-write', deleteOn(root, 'x.txt', 0)), resolved('sed-inplace', modifyOn(root, 'y.txt', 1, '||'))],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toEqual([y]);
  });

  it('rm f; sed -i f with the rm failing: `;` never gates — the sed fires', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'a\n']], ['f.txt']);
    const f = join(root, 'f.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [resolved('rm-write', deleteOn(root, 'f.txt', 0)), resolved('sed-inplace', modifyOn(root, 'f.txt', 1))],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toEqual([f]);
  });

  it("rm f && echo x > f with the rm succeeding (echo recreated f): the echo fires exactly once — its later pass explains the rm's fail, so && fails open", async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'x\n']], ['f.txt']);
    const f = join(root, 'f.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [
        resolved('rm-write', deleteOn(root, 'f.txt', 0)),
        // Phase 3: the literal echo body rides on the span so the gate can
        // verify the exact post-content; the touch itself stays whole-file.
        resolved('redirect-write', createOn(root, 'f.txt', 1, '&&', 'x\n'))
      ],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toEqual([f]);
  });

  it("echo a > f && rm f with the rm succeeding (f tracked+deleted): the rm delete fires — its later pass explains the echo's fail", async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', null]], ['f.txt']);
    const f = join(root, 'f.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [
        resolved('redirect-write', createOn(root, 'f.txt', 0, undefined, 'a\n')),
        resolved('rm-write', deleteOn(root, 'f.txt', 1, '&&'))
      ],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toEqual([f]);
  });

  it("echo a > f && echo b > f: only echo-b fires — its later exact pass explains echo-a's fail", async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'b\n']], []);
    const f = join(root, 'f.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [
        resolved('redirect-write', createOn(root, 'f.txt', 0, undefined, 'a\n')),
        resolved('redirect-write', createOn(root, 'f.txt', 1, '&&', 'b\n'))
      ],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toEqual([f]);
  });

  it("cp a b && rm a with the rm succeeding: the dest write on b fires (real source, absence explained by the rm's pass) and the rm delete fires", async () => {
    const root = freshRepo();
    seedState(
      root,
      [
        ['a.txt', null],
        ['b.txt', 'a1\na2\n']
      ],
      ['a.txt']
    );
    const a = join(root, 'a.txt');
    const b = join(root, 'b.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [
        resolved('cp-write', readOn(root, 'a.txt', 0)),
        resolved('cp-write', createOn(root, 'b.txt', 0, undefined)),
        resolved('rm-write', deleteOn(root, 'a.txt', 1, '&&'))
      ],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toEqual([b, a]);
  });

  it('rm a; cp a b with b pre-existing and a untracked: zero executor calls — the phantom source suppresses the dest and the rm delete', async () => {
    // `a` is real on disk but never git-added, so the delete-reality probe
    // reads it as phantom: the rm's delete gate is inconclusive (skipped as
    // harmless), the absent-source rule suppresses the dest, and the read's
    // decisiveFail marks the cp failed.
    const root = freshRepo();
    seedState(
      root,
      [
        ['a.txt', null],
        ['b.txt', 'b1\nb2\n']
      ],
      []
    );
    const { executors, calls } = makeCountingExecutors();

    await runBashTouches(
      [
        resolved('rm-write', deleteOn(root, 'a.txt', 0)),
        resolved('cp-write', readOn(root, 'a.txt', 1)),
        resolved('cp-write', createOn(root, 'b.txt', 1))
      ],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
  });

  it('an interrupted tool response gates the whole command: zero executor calls even for a would-be-passing delete', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', null]], ['f.txt']);
    const { executors, calls } = makeCountingExecutors();

    await runBashTouches(
      [resolved('rm-write', deleteOn(root, 'f.txt', 0))],
      SESSION_ID,
      root,
      { interrupted: true },
      executors,
      createMemoryMemoStore()
    );

    expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
  });
});
