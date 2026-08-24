import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MemoStore } from '../../src/common/span-surface.js';
import {
  createDefaultTouchExecutors,
  createRealityProbeCache,
  runTouchHook,
  runTouchHooks,
  type TouchInput
} from '../../src/common/touch-core.js';
import {
  buildWorkspaceGitSpan,
  commitRepo,
  makeRealBundleRepo,
  type RealBundleRepo,
  writeRepoFile
} from '../real-bundle-helpers.js';

/**
 * The batched context query collapses one dependency subprocess per touched
 * file into one per repository/mutation partition. These tests run the real `git span`
 * binary rather than a fake, because the property under test is a property of
 * the CLI's scoping: `git span list <path>` and `git span drift <path>` both
 * return every anchor of every span *covering* that path, including anchors on
 * other files, so the per-file view is reconstructed by span coverage rather
 * than by filtering on path.
 */

const SESSION = 'batch-context-session';

/** An in-memory MemoStore — one Set of surfaced keys per session id. */
function createMemoStore(): MemoStore {
  const bySession = new Map<string, Set<string>>();
  return {
    getSurfaced(sessionId: string): Set<string> {
      return new Set(bySession.get(sessionId) ?? []);
    },
    addSurfaced(sessionId: string, names: string[]): void {
      const existing = bySession.get(sessionId) ?? new Set<string>();
      for (const name of names) existing.add(name);
      bySession.set(sessionId, existing);
    }
  };
}

function git(repo: RealBundleRepo, ...args: string[]): string {
  try {
    return execFileSync('git', ['span', ...args], {
      cwd: repo.root,
      encoding: 'utf8',
      env: repo.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    return (err as { stdout?: string }).stdout ?? '';
  }
}

function writeTouch(repo: RealBundleRepo, rel: string, written: string): TouchInput {
  return {
    kind: 'write',
    sessionId: SESSION,
    cwd: repo.root,
    filePath: `${repo.root}/${rel}`,
    invocationId: `${SESSION}:${rel}`,
    written
  };
}

/** Surfaced-span names, in order, parsed out of a rendered `<git-span>` block. */
function surfacedNames(block: string | null): string[] {
  if (block === null) return [];
  return [...block.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
}

/** Every `path#Lstart-Lend` anchor address a rendered block mentions. */
function anchorAddresses(block: string | null): string[] {
  if (block === null) return [];
  // The renderer prints `path #Lstart-Lend` with a space; normalize to the
  // canonical address form so assertions read as addresses, not as layout.
  return [...block.matchAll(/([\w./-]+)\s*(#L\d+-L\d+)/g)].map((m) => `${m[1]}${m[2]}`);
}

/**
 * Run `fn` with the fixture repo's environment installed process-wide.
 *
 * The executors under test spawn `git span` through `execFileSync` without an
 * explicit `env`, so they inherit `process.env` — and the workspace binary
 * lives only on {@link RealBundleRepo.env}'s PATH. Without this the spawns
 * fail, `runTouchHook` fails open to `null`, and every assertion here compares
 * one empty block against another and passes while proving nothing.
 */
async function withRepoEnv<T>(repo: RealBundleRepo, fn: () => Promise<T>): Promise<T> {
  const saved = { PATH: process.env['PATH'], HOME: process.env['HOME'] };
  process.env['PATH'] = repo.env['PATH'];
  process.env['HOME'] = repo.env['HOME'];
  try {
    return await fn();
  } finally {
    process.env['PATH'] = saved.PATH;
    process.env['HOME'] = saved.HOME;
  }
}

/** Run a batch of touches through the singleton compatibility path. */
async function runPerFile(repo: RealBundleRepo, touches: TouchInput[]): Promise<(string | null)[]> {
  return withRepoEnv(repo, async () => {
    const executors =
      createDefaultTouchExecutors(SUBPROCESS_TIMEOUT_MS).forInvocation?.() ??
      createDefaultTouchExecutors(SUBPROCESS_TIMEOUT_MS);
    const memo = createMemoStore();
    const probe = createRealityProbeCache([]);
    const out: (string | null)[] = [];
    for (const touch of touches) {
      out.push((await runTouchHook(touch, executors, memo, probe)).additionalContext);
    }
    return out;
  });
}

/** Run the same batch through the plural context-query path. */
async function runBatched(repo: RealBundleRepo, touches: TouchInput[]): Promise<(string | null)[]> {
  return withRepoEnv(repo, async () => {
    const base = createDefaultTouchExecutors(SUBPROCESS_TIMEOUT_MS);
    const executors = base.forInvocation?.() ?? base;
    const memo = createMemoStore();
    const probe = createRealityProbeCache([]);
    const batch = await runTouchHooks(touches, executors, memo, SESSION, probe);
    return batch.outputs.map((output) => output.additionalContext);
  });
}

/**
 * These run the real workspace binary, so the first call pays a cargo build
 * that under `yarn validate` contends with git-span's own compile for the
 * shared target lock. Following the installed-artifact smoke convention, the
 * build is hoisted into `beforeAll` and every case carries the same generous
 * bound, so harness load cannot turn a passing check into a timeout.
 */
const INSTALLED_SMOKE_TIMEOUT_MS = 600_000;

/**
 * Subprocess budget handed to the real `git span` children. The production
 * default (2s) is tuned for interactive hook latency; under the root
 * `yarn test` foreach harness seven workspaces run in parallel and a cold
 * CLI invocation can legitimately exceed it, which fails the executor open
 * to null on one side of a batched-vs-per-file comparison and flakes the
 * parity property red. The property under test is independent of the exact
 * budget, so both paths get the same generous one.
 */
const SUBPROCESS_TIMEOUT_MS = 30_000;

let PATH_DIR: string;

function seedRepo(): RealBundleRepo {
  const repo = makeRealBundleRepo(PATH_DIR);
  for (const f of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
    writeRepoFile(repo, f, 'alpha\nTARGET\nomega\n');
  }
  commitRepo(repo, 'seed');
  return repo;
}

describe('batched touch context', () => {
  beforeAll(() => {
    PATH_DIR = buildWorkspaceGitSpan().pathDir;
  }, INSTALLED_SMOKE_TIMEOUT_MS);

  it('reports one settled post-heal anchor set across every block in a report', {
    timeout: INSTALLED_SMOKE_TIMEOUT_MS
  }, async () => {
    // One span covers two touched files and the *later* file carries
    // positional drift — the shape where a report could disagree with itself
    // about where the same content lives. Pinned here: every block reports one
    // settled post-heal anchor set. The sibling case below shows the per-file
    // path agrees, because `drift <path> --fix` heals the whole covering span
    // rather than one file's anchors.
    const repo = seedRepo();
    git(repo, 'add', 'cross', 'a.txt#L2-L2');
    git(repo, 'add', 'cross', 'b.txt#L2-L2');
    git(repo, 'why', 'cross', 'a.txt and b.txt move together.');
    commitRepo(repo, 'spans');

    // a.txt changes semantically, so it surfaces a block of its own — a
    // no-op write surfaces nothing and would make this unobservable. b.txt
    // takes *positional* drift only: its anchor slides from L2 to L4.
    writeRepoFile(repo, 'a.txt', 'alpha\nCHANGED-A\nomega\n');
    writeRepoFile(repo, 'b.txt', 'pad1\npad2\nalpha\nTARGET\nomega\n');
    const touches = [
      writeTouch(repo, 'a.txt', 'alpha\nCHANGED-A\nomega\n'),
      writeTouch(repo, 'b.txt', 'pad1\npad2\nalpha\nTARGET\nomega\n')
    ];

    const batched = await runBatched(repo, touches);
    const bAnchors = anchorAddresses(batched[0]).filter((a) => a.startsWith('b.txt'));

    // The whole point: a.txt's block already reports b.txt healed at L4.
    expect(bAnchors).toContain('b.txt#L4-L4');
    expect(bAnchors).not.toContain('b.txt#L2-L2');
  });

  it('renders anchor addresses identical to the per-file path on that same shape', {
    timeout: INSTALLED_SMOKE_TIMEOUT_MS
  }, async () => {
    // The counterpart to the pinning test, and a correction to the premise the
    // batch was authorized under. The feared divergence — a.txt's block
    // reporting b.txt at its pre-heal line — does not occur on the per-file
    // path either, because `git span drift <path> --fix` heals every span
    // *covering* that path, anchors on other files included. So fix(a.txt)
    // already settles b.txt's anchor before surface(a.txt) reads it, and both
    // paths render L4. Batching is anchor-address preserving on this shape;
    // this test fails the moment that stops being true in either direction.
    const repo = seedRepo();
    git(repo, 'add', 'cross', 'a.txt#L2-L2');
    git(repo, 'add', 'cross', 'b.txt#L2-L2');
    git(repo, 'why', 'cross', 'a.txt and b.txt move together.');
    commitRepo(repo, 'spans');

    writeRepoFile(repo, 'a.txt', 'alpha\nCHANGED-A\nomega\n');
    writeRepoFile(repo, 'b.txt', 'pad1\npad2\nalpha\nTARGET\nomega\n');
    const touches = [
      writeTouch(repo, 'a.txt', 'alpha\nCHANGED-A\nomega\n'),
      writeTouch(repo, 'b.txt', 'pad1\npad2\nalpha\nTARGET\nomega\n')
    ];

    const perFile = await runPerFile(repo, touches);

    const repo2 = seedRepo();
    git(repo2, 'add', 'cross', 'a.txt#L2-L2');
    git(repo2, 'add', 'cross', 'b.txt#L2-L2');
    git(repo2, 'why', 'cross', 'a.txt and b.txt move together.');
    commitRepo(repo2, 'spans');
    writeRepoFile(repo2, 'a.txt', 'alpha\nCHANGED-A\nomega\n');
    writeRepoFile(repo2, 'b.txt', 'pad1\npad2\nalpha\nTARGET\nomega\n');
    const batched = await runBatched(repo2, [
      writeTouch(repo2, 'a.txt', 'alpha\nCHANGED-A\nomega\n'),
      writeTouch(repo2, 'b.txt', 'pad1\npad2\nalpha\nTARGET\nomega\n')
    ]);

    expect(batched.map(anchorAddresses)).toEqual(perFile.map(anchorAddresses));
  });

  it('surfaces the same span set as the per-file path across coverage shapes', {
    timeout: INSTALLED_SMOKE_TIMEOUT_MS
  }, async () => {
    // Shapes in one repo: `cross` spans two touched files; `multi` gives
    // a.txt a second covering span (one file under multiple spans, with
    // overlapping anchors on the same file); `solo` covers a single file;
    // d.txt is covered by no span at all (the early-return/short-circuit
    // case, where computeSurfaceParts returns before ever calling drift).
    const repo = seedRepo();
    git(repo, 'add', 'cross', 'a.txt#L2-L2');
    git(repo, 'add', 'cross', 'b.txt#L2-L2');
    git(repo, 'why', 'cross', 'a.txt and b.txt move together.');
    git(repo, 'add', 'multi', 'a.txt#L2-L3');
    git(repo, 'why', 'multi', 'a.txt carries a second overlapping coupling.');
    git(repo, 'add', 'solo', 'c.txt#L2-L2');
    git(repo, 'why', 'solo', 'c.txt stands alone.');
    commitRepo(repo, 'spans');

    // Semantic drift on a.txt and b.txt; c.txt and d.txt untouched content.
    writeRepoFile(repo, 'a.txt', 'alpha\nCHANGED-A\nomega\n');
    writeRepoFile(repo, 'b.txt', 'alpha\nCHANGED-B\nomega\n');
    const touches = [
      writeTouch(repo, 'a.txt', 'alpha\nCHANGED-A\nomega\n'),
      writeTouch(repo, 'b.txt', 'alpha\nCHANGED-B\nomega\n'),
      writeTouch(repo, 'c.txt', 'alpha\nTARGET\nomega\n'),
      writeTouch(repo, 'd.txt', 'alpha\nTARGET\nomega\n')
    ];

    const perFile = (await runPerFile(repo, touches)).map(surfacedNames);
    const batched = (await runBatched(repo, touches)).map(surfacedNames);

    // The set of spans surfaced per file is the invariant the change must not
    // move; only the anchor line numbers rendered inside them may.
    expect(batched).toEqual(perFile);
    // Guard against the assertion passing vacuously.
    expect(perFile.flat().length).toBeGreaterThan(0);
    // d.txt is covered by no span and surfaces nothing on either path.
    expect(perFile[3]).toEqual([]);
    expect(batched[3]).toEqual([]);
  });

  it('reconstructs a file covered by several spans without dropping or leaking one', {
    timeout: INSTALLED_SMOKE_TIMEOUT_MS
  }, async () => {
    const repo = seedRepo();
    git(repo, 'add', 'first', 'a.txt#L1-L2');
    git(repo, 'why', 'first', 'a.txt opening lines are coupled.');
    git(repo, 'add', 'second', 'a.txt#L2-L3');
    git(repo, 'why', 'second', 'a.txt closing lines are coupled.');
    git(repo, 'add', 'elsewhere', 'c.txt#L2-L2');
    git(repo, 'why', 'elsewhere', 'c.txt is unrelated to a.txt.');
    commitRepo(repo, 'spans');

    writeRepoFile(repo, 'a.txt', 'alpha\nCHANGED-A\nomega\n');
    const touches = [
      writeTouch(repo, 'a.txt', 'alpha\nCHANGED-A\nomega\n'),
      writeTouch(repo, 'c.txt', 'alpha\nTARGET\nomega\n')
    ];

    const perFile = (await runPerFile(repo, touches)).map(surfacedNames);
    const batched = (await runBatched(repo, touches)).map(surfacedNames);

    expect(batched).toEqual(perFile);
    // Both overlapping spans on a.txt surface, and the unrelated span does not
    // leak into a.txt's block from the shared batched result.
    expect(batched[0].sort()).toEqual(['first', 'second']);
    expect(batched[0]).not.toContain('elsewhere');
  });

  it('leaves a single-touch invocation on the per-file path', { timeout: INSTALLED_SMOKE_TIMEOUT_MS }, async () => {
    // Nothing to batch, so the plural path must not fire a subprocess whose result
    // would differ from what the per-file call would have produced.
    const repo = seedRepo();
    git(repo, 'add', 'solo', 'a.txt#L2-L2');
    git(repo, 'why', 'solo', 'a.txt stands alone.');
    commitRepo(repo, 'spans');
    writeRepoFile(repo, 'a.txt', 'alpha\nCHANGED-A\nomega\n');

    const touches = [writeTouch(repo, 'a.txt', 'alpha\nCHANGED-A\nomega\n')];
    expect((await runBatched(repo, touches)).map(surfacedNames)).toEqual(
      (await runPerFile(repo, touches)).map(surfacedNames)
    );
  });
});
