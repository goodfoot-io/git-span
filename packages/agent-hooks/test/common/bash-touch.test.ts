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
import { filterTrackedEligibility } from '../../src/common/static-attribution.js';
import type { TouchExecutors } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';
import { contextExecutors } from '../touch-context-fake.js';

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
    executors: contextExecutors({
      fix: async (filePath) => {
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
    }),
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

  it('truncate with a static size → the size post-state gate (`-s 0` → empty)', () => {
    expect(bashSpanToTouch(span({ operation: 'truncate', size: 0 }), SESSION_ID, repo.root)).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: '',
      targetState: 'exists',
      postState: { content: { empty: true } }
    });
    expect(bashSpanToTouch(span({ operation: 'truncate', size: 3 }), SESSION_ID, repo.root)).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: '',
      targetState: 'exists',
      postState: { content: { size: 3 } }
    });
  });

  it('create-overwrite with a literal body → the exact post-content gate', () => {
    expect(bashSpanToTouch(span({ operation: 'create-overwrite', written: 'x\n' }), SESSION_ID, repo.root)).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: '',
      targetState: 'exists',
      postState: { content: { exact: 'x\n' } }
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

  it('range-scoped modify carries decisive exact post-state evidence', () => {
    expect(
      bashSpanToTouch(
        span({ operation: 'modify', lineStart: 2, lineEnd: 2, expectedContent: 'before\nafter\n' }),
        SESSION_ID,
        repo.root
      )
    ).toEqual({
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: repo.root,
      filePath: appPath(),
      written: '',
      targetState: 'exists',
      range: { start: 2, end: 2 },
      postState: { content: { exact: 'before\nafter\n' } }
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

describe('batched tracked eligibility contract (bootstrap)', () => {
  it('queries each repository once and preserves eligible producer payloads', () => {
    const repo = makeTempRepo();
    const root = repo.root;
    writeFileSync(join(root, 'tracked.txt'), 'x\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
    writeFileSync(join(root, 'untracked.txt'), 'x\n');
    const calls: Array<{ repoRoot: string; paths: readonly string[] }> = [];

    const result = filterTrackedEligibility(
      [
        { absolutePath: join(root, 'tracked.txt'), value: { producer: 'bash' as const } },
        { absolutePath: join(root, 'untracked.txt'), value: { producer: 'response-read' as const } }
      ],
      {
        cwd: root,
        queryTrackedFiles: (repoRoot, paths) => {
          calls.push({ repoRoot, paths });
          return new Set(['tracked.txt']);
        }
      }
    );

    expect(calls).toEqual([{ repoRoot: root, paths: ['tracked.txt', 'untracked.txt'] }]);
    expect(result.ignoreQueryCount).toBe(1);
    expect(result.trackedQueryCount).toBe(1);
    expect(result.eligible.map(({ value }) => value.producer)).toEqual(['bash']);
    expect(result.dropped.map(({ reason }) => reason)).toEqual(['untracked-path']);
    repo.cleanup();
  });

  it('drops out-of-scope paths before tracked membership without querying their repositories', () => {
    const repo = makeTempRepo();
    const root = repo.root;
    const result = filterTrackedEligibility([{ absolutePath: '/tmp/outside.txt', value: 'structured-write' }], {
      cwd: root,
      queryTrackedFiles: () => {
        throw new Error('out-of-scope candidates must not reach git');
      }
    });

    expect(result.eligible).toEqual([]);
    expect(result.dropped.map(({ reason }) => reason)).toEqual(['outside-repository']);
    expect(result.ignoreQueryCount).toBe(0);
    expect(result.trackedQueryCount).toBe(0);
    repo.cleanup();
  });

  it('uses one real index query for tracked and untracked candidates', () => {
    const repo = makeTempRepo();
    const root = repo.root;
    writeFileSync(join(root, 'tracked.txt'), 'tracked\n');
    writeFileSync(join(root, 'untracked.txt'), 'untracked\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root });

    const result = filterTrackedEligibility(
      [
        { absolutePath: join(root, 'tracked.txt'), value: 'tracked' },
        { absolutePath: join(root, 'untracked.txt'), value: 'untracked' }
      ],
      { cwd: root }
    );

    expect(result.eligible.map(({ value }) => value)).toEqual(['tracked']);
    expect(result.dropped.map(({ reason }) => reason)).toEqual(['untracked-path']);
    expect(result.ignoreQueryCount).toBe(1);
    expect(result.trackedQueryCount).toBe(1);
    repo.cleanup();
  });

  it('classifies ignored and span metadata paths before the index query', () => {
    const repo = makeTempRepo();
    const root = repo.root;
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
    writeFileSync(join(root, 'ignored.txt'), 'ignored\n');
    mkdirSync(join(root, '.span'), { recursive: true });
    writeFileSync(join(root, '.span', 'intent.md'), 'intent\n');
    const calls: string[][] = [];

    const result = filterTrackedEligibility(
      [
        { absolutePath: join(root, 'ignored.txt'), value: 'ignored' },
        { absolutePath: join(root, '.span', 'intent.md'), value: 'span' }
      ],
      {
        cwd: root,
        queryTrackedFiles: (_repoRoot, paths) => {
          calls.push([...paths]);
          return new Set();
        }
      }
    );

    expect(result.eligible).toEqual([]);
    expect(result.dropped.map(({ reason }) => reason)).toEqual(['ignored-path', 'span-metadata-path']);
    expect(calls).toEqual([]);
    expect(result.ignoreQueryCount).toBe(1);
    expect(result.trackedQueryCount).toBe(0);
    repo.cleanup();
  });

  it('excludes an ignored path even when it is already tracked', () => {
    const repo = makeTempRepo();
    const root = repo.root;
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
    writeFileSync(join(root, 'ignored.txt'), 'tracked but ignored\n');
    execFileSync('git', ['add', '-f', 'ignored.txt'], { cwd: root });
    const trackedQueries: string[][] = [];

    const result = filterTrackedEligibility([{ absolutePath: join(root, 'ignored.txt'), value: 'ignored' }], {
      cwd: root,
      queryTrackedFiles: (_repoRoot, paths) => {
        trackedQueries.push([...paths]);
        return new Set(paths);
      }
    });

    expect(result.eligible).toEqual([]);
    expect(result.dropped.map(({ reason }) => reason)).toEqual(['ignored-path']);
    expect(result.errors).toEqual([]);
    expect(result.ignoreQueryCount).toBe(1);
    expect(result.trackedQueryCount).toBe(0);
    expect(trackedQueries).toEqual([]);
    repo.cleanup();
  });

  it('fails closed with a typed error when the ignore query fails operationally', () => {
    const repo = makeTempRepo();
    const root = repo.root;
    writeFileSync(join(root, 'tracked.txt'), 'tracked\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
    const trackedQueries: string[][] = [];

    const result = filterTrackedEligibility([{ absolutePath: join(root, 'tracked.txt'), value: 'tracked' }], {
      cwd: root,
      queryIgnoredFiles: () => {
        throw new Error('check-ignore unavailable');
      },
      queryTrackedFiles: (_repoRoot, paths) => {
        trackedQueries.push([...paths]);
        return new Set(paths);
      }
    });

    expect(result.eligible).toEqual([]);
    expect(result.dropped.map(({ reason }) => reason)).toEqual(['eligibility-query-failed']);
    expect(result.errors).toEqual([
      { kind: 'ignored-files-query-failed', repoRoot: root, message: 'check-ignore unavailable' }
    ]);
    expect(result.ignoreQueryCount).toBe(1);
    expect(result.trackedQueryCount).toBe(0);
    expect(trackedQueries).toEqual([]);
    repo.cleanup();
  });

  it('deduplicates membership pathspecs without deduplicating producer payloads', () => {
    const repo = makeTempRepo();
    const root = repo.root;
    writeFileSync(join(root, 'tracked.txt'), 'tracked\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
    const calls: string[][] = [];

    const result = filterTrackedEligibility(
      [
        { absolutePath: join(root, 'tracked.txt'), value: 'bash' },
        { absolutePath: join(root, 'tracked.txt'), value: 'structured-edit' }
      ],
      {
        cwd: root,
        queryTrackedFiles: (_repoRoot, paths) => {
          calls.push([...paths]);
          return new Set(['tracked.txt']);
        }
      }
    );

    expect(calls).toEqual([['tracked.txt']]);
    expect(result.eligible.map(({ value }) => value)).toEqual(['bash', 'structured-edit']);
    repo.cleanup();
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

  /**
   * Seed a tracked path whose working-tree content differs from the index —
   * the post-command state a real `rm f && patch -p0 < new.diff` compound
   * leaves behind (the index still holds the pre-command content). The
   * later-recreate explanation's working-tree-vs-index probe reads exactly
   * this mark.
   */
  function seedDirty(root: string, rel: string, indexContent: string, onDiskContent: string): void {
    writeFileSync(join(root, rel), indexContent);
    execFileSync('git', ['add', rel], { cwd: root });
    writeFileSync(join(root, rel), onDiskContent);
  }

  /**
   * Commit the seeded working tree — the baseline a genuinely clean file
   * needs. The round-4 widened probe reads the INDEX column too, so a file
   * that is merely `git add`ed (never committed) now carries a status row;
   * only a file matching HEAD yields no row.
   */
  function commitSeed(root: string, msg = 'seed'): void {
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', msg], {
      cwd: root,
      stdio: 'ignore'
    });
  }

  /**
   * Seed a tracked path whose INDEX differs from HEAD while the working tree
   * matches the index — the post-command state a `rm f && patch -p0 < d &&
   * git add f` compound leaves behind (the re-created content is staged).
   * This is the probe state the round-3 Y-column rule conflated with a failed
   * rm: byte-identical worktree-vs-index, distinguished only by the index
   * column.
   */
  function seedStaged(root: string, rel: string, baselineContent: string, stagedContent: string): void {
    writeFileSync(join(root, rel), baselineContent);
    execFileSync('git', ['add', rel], { cwd: root });
    commitSeed(root);
    writeFileSync(join(root, rel), stagedContent);
    execFileSync('git', ['add', rel], { cwd: root });
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

  it('rm f && <existence-gated create> re-creating f (working tree differs from the index): the create fires — its file-producing span plus the re-create mark explain the delete-gate fail, so && fails open', async () => {
    // The round-3 miss shape, gate-level: `rm a.txt && patch -p0 < new.diff`
    // ends with a.txt present because the patch re-created it, not because
    // the rm failed — but the patch's existence gate is inconclusive (no
    // body), so the decisivePass explanation above cannot see it. The
    // later-recreate explanation can: a later same-path file-producing write
    // whose own gate did not fail, on a file that demonstrably differs from
    // the index. The delete touch itself stays explained-suppressed (as in
    // the echo case above); the create fires.
    const root = freshRepo();
    seedDirty(root, 'f.txt', 'old\n', 'new\n');
    const f = join(root, 'f.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [resolved('rm-write', deleteOn(root, 'f.txt', 0)), resolved('sed-inplace', createOn(root, 'f.txt', 1, '&&'))],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toEqual([f]);
  });

  it('rm f && <existence-gated create> with the rm failing (f matches the index): zero executor calls — a clean file is no re-create, so the delete-gate fail stands and && still suppresses', async () => {
    // The discriminator pin: the same compound shape with the file still
    // matching the index means the chain short-circuited before the create
    // ran (the rm failed). The end-state presence is the rm's failure, not
    // the create's doing — the joined command stays suppressed. The seed
    // COMMITS the file: the widened round-4 probe reads the index column, so
    // a bare `git add` (an `A ` row) would now be a re-create mark — only a
    // file matching HEAD produces no status row, the genuine (a) reality.
    const root = freshRepo();
    seedState(root, [['f.txt', 'unchanged\n']], ['f.txt']);
    commitSeed(root);
    const { executors, calls } = makeCountingExecutors();

    await runBashTouches(
      [resolved('rm-write', deleteOn(root, 'f.txt', 0)), resolved('sed-inplace', createOn(root, 'f.txt', 1, '&&'))],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
  });

  it('rm f && <existence-gated create> with the re-create staged (index differs from HEAD, worktree matches): the create fires — an index-column row is the round-4 re-create mark', async () => {
    // The round-4 miss shape, gate-level: `rm a.txt && patch -p0 < new.diff
    // && git add a.txt` ends with a.txt present AND staged. The probe's `M `
    // row (X=M, Y blank) is the same "worktree == index" state the failed-rm
    // discriminator above was built around — only the INDEX column separates
    // the verified write from the short-circuited chain, so the round-3
    // Y-column rule was blind to it. Any tracked status row is now the
    // re-create mark; the delete's fail is explained and && fails open. The
    // delete touch stays explained-suppressed (the verdict is 'unknown', so
    // pass B drops it); the create fires.
    const root = freshRepo();
    seedStaged(root, 'f.txt', 'old\n', 'new\n');
    const f = join(root, 'f.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [resolved('rm-write', deleteOn(root, 'f.txt', 0)), resolved('sed-inplace', createOn(root, 'f.txt', 1, '&&'))],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toEqual([f]);
  });

  it('rm f && sed -i f with the rm failing (f dirty): zero executor calls — a modify never re-creates, so no later write can explain the delete-gate fail', async () => {
    // The file-producing restriction: sed -i cannot create a missing file,
    // so even on a dirty path the rm's fail stands and the join suppresses.
    const root = freshRepo();
    seedDirty(root, 'f.txt', 'old\n', 'unchanged\n');
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

  it('a harness-supplied non-zero exit code suppresses the existence-gated advisory touch', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'unchanged\n']], ['f.txt']);
    const { executors, calls } = makeCountingExecutors();

    await runBashTouches(
      [resolved('sed-inplace', modifyOn(root, 'f.txt', 0))],
      SESSION_ID,
      root,
      { exit_code: 1 },
      executors,
      createMemoryMemoStore()
    );

    expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
  });

  it('a harness-supplied zero exit code proceeds: the advisory touch fires', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'unchanged\n']], ['f.txt']);
    const f = join(root, 'f.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [resolved('sed-inplace', modifyOn(root, 'f.txt', 0))],
      SESSION_ID,
      root,
      { exit_code: 0 },
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toEqual([f]);
  });

  it('an absent exit code proceeds exactly as today: the advisory touch fires', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'unchanged\n']], ['f.txt']);
    const f = join(root, 'f.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [resolved('sed-inplace', modifyOn(root, 'f.txt', 0))],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toEqual([f]);
  });

  it('a non-zero exit code never suppresses a content-verified decisive pass (a real write)', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'x\n']], ['f.txt']);
    const f = join(root, 'f.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [resolved('redirect-write', createOn(root, 'f.txt', 0, undefined, 'x\n'))],
      SESSION_ID,
      root,
      { exit_code: 1 },
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toEqual([f]);
  });

  it('a span-less failed guard (false) skips the &&-joined write even with content coincidence', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'x\n']], ['f.txt']);
    const { executors, calls } = makeCountingExecutors();

    await runBashTouches(
      [
        { status: 'builtin-guard', simpleCommandIndex: 0, join: undefined, exitStatus: 1 },
        resolved('redirect-write', createOn(root, 'f.txt', 1, '&&', 'x\n'))
      ],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
  });

  it('a span-less succeeded guard (true) skips the ||-joined write even with content coincidence', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'x\n']], ['f.txt']);
    const { executors, calls } = makeCountingExecutors();

    await runBashTouches(
      [
        { status: 'builtin-guard', simpleCommandIndex: 0, join: undefined, exitStatus: 0 },
        resolved('redirect-write', createOn(root, 'f.txt', 1, '||', 'x\n'))
      ],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
  });

  it('true && write fires: a succeeded guard does not suppress the joined write', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'x\n']], ['f.txt']);
    const f = join(root, 'f.txt');
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      [
        { status: 'builtin-guard', simpleCommandIndex: 0, join: undefined, exitStatus: 0 },
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

  it('chained guards: false && true && write skips all the way down', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'x\n']], ['f.txt']);
    const { executors, calls } = makeCountingExecutors();

    await runBashTouches(
      [
        { status: 'builtin-guard', simpleCommandIndex: 0, join: undefined, exitStatus: 1 },
        { status: 'builtin-guard', simpleCommandIndex: 1, join: '&&', exitStatus: 0 },
        resolved('redirect-write', createOn(root, 'f.txt', 2, '&&', 'x\n'))
      ],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
  });

  it('executes every candidate when a simple command produces exactly 32 touches', async () => {
    const root = freshRepo();
    const files = Array.from({ length: 32 }, (_, index) => [`f-${index}.txt`, 'x\n'] as [string, string]);
    seedState(
      root,
      files,
      files.map(([path]) => path)
    );
    const { executors, fixPaths } = makeCountingExecutors();

    await runBashTouches(
      files.map(([path]) => resolved('redirect-write', createOn(root, path, 0, undefined, 'x\n'))),
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(fixPaths).toHaveLength(32);
  });

  it.each([33, 65])('rejects all %i candidates before any executor runs', async (count) => {
    const root = freshRepo();
    const files = Array.from({ length: count }, (_, index) => [`f-${index}.txt`, 'x\n'] as [string, string]);
    seedState(
      root,
      files,
      files.map(([path]) => path)
    );
    const { executors, calls } = makeCountingExecutors();
    const warnings: string[] = [];

    await runBashTouches(
      files.map(([path]) => resolved('redirect-write', createOn(root, path, 0, undefined, 'x\n'))),
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore(),
      (warning) => warnings.push(warning)
    );

    expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('candidate budget exceeded');
  });

  it('guard-only input: no spans, no touches, nothing fires', async () => {
    const root = freshRepo();
    seedState(root, [['f.txt', 'x\n']], ['f.txt']);
    const { executors, calls } = makeCountingExecutors();

    await runBashTouches(
      [{ status: 'builtin-guard', simpleCommandIndex: 0, join: undefined, exitStatus: 1 }],
      SESSION_ID,
      root,
      {},
      executors,
      createMemoryMemoStore()
    );

    expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
  });
});
