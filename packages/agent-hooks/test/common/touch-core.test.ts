/**
 * Skipped acceptance checks for touch-core.ts (Phase 2.2 of the TDD bootstrap
 * described in plans/initial.md's Phase 2). Phase 2.1 declared `recoverRange`
 * and `runTouchHook` as not-implemented stubs; this file writes the contract's
 * acceptance checks against those stubs so the eventual Phase 2.3
 * implementation has a fixed target. Every case here is marked `.skip` — none
 * are expected to run (the stubs throw `Not Implemented`); Phase 2.3 unskips
 * them one by one while implementing minimally against each.
 *
 * Fakes are constructed against the real exported types from touch-core.ts
 * (`TouchInput`, `TouchExecutors`, `TouchFixResult`, `PorcelainRow`,
 * `DriftPorcelainRow`, `MemoStore`) rather than loosened/`any`-typed shapes —
 * that fidelity is the payoff of the bootstrap: an awkward fake here is a
 * contract-ergonomics finding, not something to work around.
 *
 * The trailing describes are card main-212's Phase 2 additions: the
 * `targetState`/`postState` gate contract (plan §3 step 1), the exact-range
 * bypass, delete-path surfacing, the delete-reality probe batching, and the
 * absent-source resolution for cp/install dests (plan §3 step 2 — driven
 * through `runBashTouches`). Phase 3 unskipped them all; the gate fixtures run
 * against a real temp repo (the write gate's statSync is the only real fs
 * touch — the executors stay mocked).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';
import { runBashTouches } from '../../src/common/bash-touch.js';
import type { ResolvedSpan, SpanMatch } from '../../src/common/parse-command.js';
import type { MemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors, TouchFixResult, TouchReadInput, TouchWriteInput } from '../../src/common/touch-core.js';
import { fixOutputModified, recoverRange, runTouchHook } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';

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

// The write gate (plan §3 step 1) verifies the target exists on disk, so the
// write-path fixtures run against a real temp repo with `src/app.ts` seeded
// (the executors stay mocked — the gate's statSync is the only real fs touch).
let REPO_ROOT = '/repo';
const SESSION_ID = 'session-touch-core-test';
const WHY = 'Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.';

function writeInput(overrides: Partial<TouchWriteInput> = {}): TouchWriteInput {
  return {
    kind: 'write',
    sessionId: SESSION_ID,
    cwd: REPO_ROOT,
    filePath: `${REPO_ROOT}/src/app.ts`,
    written: 'export const app = 1;\n',
    ...overrides
  };
}

function readInput(overrides: Partial<TouchReadInput> = {}): TouchReadInput {
  return {
    kind: 'read',
    sessionId: SESSION_ID,
    cwd: REPO_ROOT,
    filePath: `${REPO_ROOT}/src/app.ts`,
    ...overrides
  };
}

/** A porcelain row for a span covering the touched file. */
function porcelainRow(overrides: Partial<PorcelainRow> = {}): PorcelainRow {
  return { name: 'billing/checkout-request-flow', path: 'src/app.ts', start: 1, end: 10, ...overrides };
}

/** A drifted porcelain row (drift row) for a span covering the touched file. */
function driftRow(overrides: Partial<DriftPorcelainRow> = {}): DriftPorcelainRow {
  return {
    name: 'billing/checkout-request-flow',
    path: 'src/app.ts',
    start: 1,
    end: 10,
    status: 'CHANGED',
    ...overrides
  };
}

/**
 * Counting fake executors that also record the paths each executor was called
 * with — the driver checks assert exactly which touches fired (and that
 * suppressed spans never reached an executor).
 */
function countingExecutors(): {
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

describe('touch-core (Phase 2.2 — skipped acceptance checks)', () => {
  let repo: { root: string; cleanup: () => void };

  beforeAll(() => {
    repo = makeTempRepo();
    mkdirSync(join(repo.root, 'src'));
    writeFileSync(join(repo.root, 'src/app.ts'), 'export const app = 1;\n');
    REPO_ROOT = repo.root;
  });

  afterAll(() => {
    repo.cleanup();
  });

  describe('drift fix summary', () => {
    it('reports only summaries that prove span state was rewritten', () => {
      expect(fixOutputModified('Reconciled 1 span, 1 anchor (1 updated, 0 removed).\n')).toBe(true);
      expect(
        fixOutputModified(
          'Reconciled 1 span, 0 anchors (0 updated, 0 removed); collapsed 1 duplicate identity (1 record dropped).\n'
        )
      ).toBe(true);
      expect(fixOutputModified('Updated 0 anchors (0 updated, 0 removed); 1 anchor remains drifted.\n')).toBe(false);
      expect(fixOutputModified('fatal: not a git repository\n')).toBe(false);
    });
  });

  describe('runTouchHook — write path', () => {
    it('heals insertion-only (positional) drift in the tree but surfaces no alert', async () => {
      const memo = createMemoryMemoStore();
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: true }),
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        // Only positional statuses remain after the fix healed the tree —
        // MOVED/RESOLVED_PENDING_COMMIT never constitute debt (isDebt()).
        drift: async (): Promise<DriftPorcelainRow[]> => [
          driftRow({ status: 'MOVED' }),
          driftRow({ name: 'other/span', status: 'RESOLVED_PENDING_COMMIT' })
        ],
        why: async (): Promise<string | null> => WHY
      };

      const output = await runTouchHook(writeInput(), executors, memo);

      expect(output.treeModified).toBe(true);
      expect(output.additionalContext).toBeNull();
    });

    it('surfaces the full human-format span render for semantic drift exactly once per span per status in a session', async () => {
      const memo = createMemoryMemoStore();
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: false }),
        list: async (): Promise<PorcelainRow[]> => [
          porcelainRow(),
          porcelainRow({ path: 'api/charge.ts', start: 30, end: 76 })
        ],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
        why: async (): Promise<string | null> => WHY
      };
      const input = writeInput();

      const first = await runTouchHook(input, executors, memo);
      expect(first.additionalContext).not.toBeNull();
      const block = first.additionalContext ?? '';
      // Drift header + full span section: name heading, every declared anchor
      // grouped under its directory branch (the drifted one
      // lowercase-status-suffixed, the clean cross-file one bare), the why
      // sentence, and the drift footer after a final `---`.
      expect(block).toContain('This edit put an implicit dependency out of date:');
      expect(block).toContain('## billing/checkout-request-flow');
      expect(block).toContain('├─ src/app.ts    #L1-L10 — changed');
      expect(block).toContain('└─ api/charge.ts #L30-L76\n');
      expect(block).not.toContain('#L30-L76 —');
      // The flat bullet run this section used to render is gone entirely.
      expect(block).not.toContain('- src/app.ts#L1-L10');
      expect(block).toContain(WHY);
      expect(block).toContain('\n\n---\n\n');
      expect(block).toContain('Restore agreement before committing');
      expect(block).toContain('Preserve anchor shape');
      expect(block).toContain('swap the old anchor for the new one with `git span replace`');
      expect(block).toContain('`git span drift billing/checkout-request-flow` to report zero');
      expect(block).toContain('Follow confirmed authority');
      expect(block).toContain('Conform a side only when confirmed authority or a satisfied gate decides it');

      // Same span, same status, same session (same MemoStore instance) — the
      // render must not repeat.
      const second = await runTouchHook(input, executors, memo);
      expect(second.additionalContext).toBeNull();
    });

    it('re-renders the full span when drift appears after the span already surfaced healthy', async () => {
      const memo = createMemoryMemoStore();
      let drifted = false;
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: false }),
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => (drifted ? [driftRow({ status: 'CHANGED' })] : []),
        why: async (): Promise<string | null> => WHY
      };
      const input = writeInput();

      // First touch: clean — the span surfaces once with the clean header/footer.
      const first = await runTouchHook(input, executors, memo);
      const cleanBlock = first.additionalContext ?? '';
      expect(cleanBlock).toContain('app.ts has implicit dependencies:');
      expect(cleanBlock).toContain('## billing/checkout-request-flow');
      expect(cleanBlock).toContain(WHY);
      expect(cleanBlock).toContain('If you change app.ts check the other files to confirm they still work together.');
      expect(cleanBlock).not.toContain('— changed');

      // Clean again: nothing new to say.
      const second = await runTouchHook(input, executors, memo);
      expect(second.additionalContext).toBeNull();

      // Drift appears later in the session: the full span re-renders (anchors
      // and why included) — never a bare directive without paths.
      drifted = true;
      const third = await runTouchHook(input, executors, memo);
      const driftBlock = third.additionalContext ?? '';
      expect(driftBlock).toContain('This edit put an implicit dependency out of date:');
      expect(driftBlock).toContain('└─ src/app.ts #L1-L10 — changed');
      expect(driftBlock).toContain(WHY);

      // Same (span, status) pair again: deduped.
      const fourth = await runTouchHook(input, executors, memo);
      expect(fourth.additionalContext).toBeNull();
    });
  });

  describe('runTouchHook — read path', () => {
    it('never invokes the fix executor and never reports the tree as modified', async () => {
      const memo = createMemoryMemoStore();
      let fixCalls = 0;
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => {
          fixCalls += 1;
          return { modified: true };
        },
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
        why: async (): Promise<string | null> => WHY
      };

      const output = await runTouchHook(readInput(), executors, memo);

      expect(fixCalls).toBe(0);
      expect(output.treeModified).toBe(false);
    });

    it('names the dependency, not the read, when a read surfaces pre-existing genuine drift', async () => {
      const memo = createMemoryMemoStore();
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: false }),
        list: async (): Promise<PorcelainRow[]> => [
          porcelainRow(),
          porcelainRow({ path: 'api/charge.ts', start: 30, end: 76 })
        ],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
        why: async (): Promise<string | null> => WHY
      };

      const output = await runTouchHook(readInput(), executors, memo);

      // A read never edited anything — only a write's header may say "This
      // edit put ... out of date"; a read names the dependency instead.
      expect(output.additionalContext).toContain('This file has an implicit dependency out of date:');
      expect(output.additionalContext).not.toContain('This edit put');
    });

    it('filters positional statuses out of the read-path hint, surfacing nothing when drift is positional-only', async () => {
      const memo = createMemoryMemoStore();
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: false }),
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [
          driftRow({ status: 'MOVED' }),
          driftRow({ name: 'other/span', status: 'RESOLVED_PENDING_COMMIT' })
        ],
        why: async (): Promise<string | null> => WHY
      };

      const output = await runTouchHook(readInput(), executors, memo);

      expect(output.additionalContext).toBeNull();
      expect(output.treeModified).toBe(false);
    });

    describe('range-precise scoping', () => {
      let repo: { root: string; cleanup: () => void };

      afterEach(() => {
        repo?.cleanup();
      });

      /** A file with `lineCount` numbered lines, for range-precision fixtures. */
      function writeNumberedFile(lineCount: number): string {
        repo = makeTempRepo();
        const filePath = join(repo.root, 'mod.rs');
        const lines = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`);
        writeFileSync(filePath, lines.join('\n'));
        return filePath;
      }

      it('does not surface a span whose anchor sits outside the read offset/limit window', async () => {
        // Reproduces the git-span/history-command false positive: reading
        // mod.rs#L39-98 must not surface a span anchored at mod.rs#L371-387.
        const filePath = writeNumberedFile(500);
        const memo = createMemoryMemoStore();
        const executors: TouchExecutors = {
          fix: async (): Promise<TouchFixResult> => ({ modified: false }),
          list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'mod.rs', start: 371, end: 387 })],
          drift: async (): Promise<DriftPorcelainRow[]> => [],
          why: async (): Promise<string | null> => WHY
        };

        const output = await runTouchHook(readInput({ filePath, offset: 39, limit: 60 }), executors, memo);

        expect(output.additionalContext).toBeNull();
      });

      it('surfaces a span whose anchor intersects the read offset/limit window', async () => {
        const filePath = writeNumberedFile(500);
        const memo = createMemoryMemoStore();
        const executors: TouchExecutors = {
          fix: async (): Promise<TouchFixResult> => ({ modified: false }),
          list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'mod.rs', start: 39, end: 189 })],
          drift: async (): Promise<DriftPorcelainRow[]> => [],
          why: async (): Promise<string | null> => WHY
        };

        const output = await runTouchHook(readInput({ filePath, offset: 39, limit: 60 }), executors, memo);

        expect(output.additionalContext).not.toBeNull();
        expect(output.additionalContext).toContain('## billing/checkout-request-flow');
      });

      it('uses the default 2000-line window when offset is given without limit', async () => {
        const filePath = writeNumberedFile(2500);
        const memo = createMemoryMemoStore();
        const executors: TouchExecutors = {
          fix: async (): Promise<TouchFixResult> => ({ modified: false }),
          // Just past a 2000-line window starting at offset 1 — must not surface.
          list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'mod.rs', start: 2001, end: 2010 })],
          drift: async (): Promise<DriftPorcelainRow[]> => [],
          why: async (): Promise<string | null> => WHY
        };

        const output = await runTouchHook(readInput({ filePath, offset: 1 }), executors, memo);

        expect(output.additionalContext).toBeNull();
      });

      it('stays whole-file (surfaces every covering span) when neither offset nor limit is given', async () => {
        const filePath = writeNumberedFile(500);
        const memo = createMemoryMemoStore();
        const executors: TouchExecutors = {
          fix: async (): Promise<TouchFixResult> => ({ modified: false }),
          list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'mod.rs', start: 371, end: 387 })],
          drift: async (): Promise<DriftPorcelainRow[]> => [],
          why: async (): Promise<string | null> => WHY
        };

        const output = await runTouchHook(readInput({ filePath }), executors, memo);

        expect(output.additionalContext).not.toBeNull();
        expect(output.additionalContext).toContain('## billing/checkout-request-flow');
      });
    });
  });

  describe('runTouchHook — fail-open behavior', () => {
    it('returns a null/unmodified output rather than throwing when an executor rejects (CLI/.span absent)', async () => {
      const memo = createMemoryMemoStore();
      // A rejected promise is how an injected executor expresses the CLI's
      // non-zero-exit / absent-binary contract (see
      // notes/cli-and-harness-contracts.md's exit-code table) — the executor
      // wraps a real subprocess call in production, so a thrown/rejected
      // failure is the natural fake for "the CLI could not run".
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => {
          throw new Error('spawn git ENOENT');
        },
        list: async (): Promise<PorcelainRow[]> => {
          throw new Error('spawn git ENOENT');
        },
        drift: async (): Promise<DriftPorcelainRow[]> => {
          throw new Error('spawn git ENOENT');
        },
        why: async (): Promise<string | null> => {
          throw new Error('spawn git ENOENT');
        }
      };

      const output = await runTouchHook(writeInput(), executors, memo);

      expect(output.additionalContext).toBeNull();
      expect(output.treeModified).toBe(false);
    });

    /**
     * The touch hook's mirror of the advisor's fail-closed case. An uncaught
     * throw from the tree renderer would escape to `runTouchHook`'s catch,
     * which resolves the whole hook to `additionalContext: null` — the agent
     * would never hear about the drift at all. The local catch keeps the
     * reminder, just flat.
     */
    it('still returns a flat-bullet reminder, not null, when the tree renderer throws', async () => {
      vi.resetModules();
      vi.doMock('../../src/common/anchor-tree.js', async (importOriginal) => ({
        ...(await importOriginal<typeof import('../../src/common/anchor-tree.js')>()),
        renderAnchorTree: (): string[] => {
          throw new Error('injected tree-renderer defect');
        }
      }));
      try {
        const { runTouchHook: run } = await import('../../src/common/touch-core.js');
        const memo = createMemoryMemoStore();
        const executors: TouchExecutors = {
          fix: async (): Promise<TouchFixResult> => ({ modified: false }),
          list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
          drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
          why: async (): Promise<string | null> => WHY
        };

        const output = await run(writeInput(), executors, memo);

        expect(output.additionalContext).not.toBeNull();
        expect(output.additionalContext).toContain('- src/app.ts#L1-L10 — changed');
        expect(output.additionalContext).not.toContain('└─');
      } finally {
        vi.doUnmock('../../src/common/anchor-tree.js');
        vi.resetModules();
      }
    });
  });

  describe('recoverRange', () => {
    it("degrades to 'whole-file' when the written block is absent from onDiskContent", () => {
      const written = 'const totally = "missing";\n';
      const onDiskContent = ['line one', 'line two', 'line three'].join('\n');

      expect(recoverRange(written, onDiskContent)).toBe('whole-file');
    });

    it("degrades to 'whole-file' when the written block is duplicated and cannot be disambiguated", () => {
      const written = 'duplicate\n';
      const onDiskContent = ['duplicate', 'middle', 'duplicate', 'tail'].join('\n');

      expect(recoverRange(written, onDiskContent)).toBe('whole-file');
    });

    it('recovers the correct 1-based inclusive LineRange for an unambiguous written block', () => {
      const written = ['beta', 'gamma'].join('\n');
      const onDiskContent = ['alpha', 'beta', 'gamma', 'delta'].join('\n');

      expect(recoverRange(written, onDiskContent)).toEqual({ start: 2, end: 3 });
    });
  });

  // =========================================================================
  // Card main-212 Phase 2 — post-state write gates (plan §3 step 1)
  // =========================================================================

  describe('runTouchHook — post-state gates (plan §3 step 1)', () => {
    let repo: { root: string; cleanup: () => void };

    afterEach(() => {
      repo?.cleanup();
    });

    it("the 'exists' gate passes when the target is a real file: fix runs", async () => {
      repo = makeTempRepo();
      const filePath = join(repo.root, 'app.ts');
      writeFileSync(filePath, 'export const app = 1;\n');
      const memo = createMemoryMemoStore();
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: false }),
        // The row's path must match the touched file's repo-relative path
        // (`app.ts`, not the helper default `src/app.ts`) or the onTouchedFile
        // filter drops it.
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'app.ts' })],
        drift: async (): Promise<DriftPorcelainRow[]> => [],
        why: async (): Promise<string | null> => WHY
      };

      const output = await runTouchHook(
        writeInput({ cwd: repo.root, filePath, targetState: 'exists' }),
        executors,
        memo
      );

      expect(output.additionalContext).not.toBeNull();
      expect(output.additionalContext).toContain('## billing/checkout-request-flow');
    });

    it("the 'exists' gate fails closed when the target is missing: zero executor calls", async () => {
      repo = makeTempRepo();
      const filePath = join(repo.root, 'never-created.txt');
      const memo = createMemoryMemoStore();
      let fixCalls = 0;
      let listCalls = 0;
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => {
          fixCalls += 1;
          return { modified: false };
        },
        list: async (): Promise<PorcelainRow[]> => {
          listCalls += 1;
          return [];
        },
        drift: async (): Promise<DriftPorcelainRow[]> => [],
        why: async (): Promise<string | null> => null
      };

      const output = await runTouchHook(
        writeInput({ cwd: repo.root, filePath, targetState: 'exists' }),
        executors,
        memo
      );

      expect(fixCalls).toBe(0);
      expect(listCalls).toBe(0);
      expect(output.additionalContext).toBeNull();
    });

    it("the 'exists' gate fails closed when the target is a directory", async () => {
      repo = makeTempRepo();
      const dirPath = join(repo.root, 'a-dir');
      mkdirSync(dirPath);
      const memo = createMemoryMemoStore();
      let fixCalls = 0;
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => {
          fixCalls += 1;
          return { modified: false };
        },
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => [],
        why: async (): Promise<string | null> => null
      };

      const output = await runTouchHook(
        writeInput({ cwd: repo.root, filePath: dirPath, targetState: 'exists' }),
        executors,
        memo
      );

      expect(fixCalls).toBe(0);
      expect(output.additionalContext).toBeNull();
    });

    it("the 'absent' gate passes for a real (index-tracked, deleted) target: fix runs", async () => {
      repo = makeTempRepo();
      const filePath = join(repo.root, 'gone.ts');
      writeFileSync(filePath, 'a\nb\n');
      execFileSync('git', ['add', 'gone.ts'], { cwd: repo.root });
      rmSync(filePath);
      const memo = createMemoryMemoStore();
      let fixCalls = 0;
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => {
          fixCalls += 1;
          return { modified: false };
        },
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'gone.ts' })],
        drift: async (): Promise<DriftPorcelainRow[]> => [],
        why: async (): Promise<string | null> => WHY
      };

      const output = await runTouchHook(
        writeInput({ cwd: repo.root, filePath, targetState: 'absent', postState: { realDelete: true }, written: '' }),
        executors,
        memo
      );

      expect(fixCalls).toBe(1);
      expect(output.additionalContext).toContain('## billing/checkout-request-flow');
    });

    it("the 'absent' gate fails closed when the target was never real (phantom): zero executor calls", async () => {
      repo = makeTempRepo();
      const filePath = join(repo.root, 'phantom.txt');
      const memo = createMemoryMemoStore();
      let fixCalls = 0;
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => {
          fixCalls += 1;
          return { modified: false };
        },
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => [],
        why: async (): Promise<string | null> => null
      };

      const output = await runTouchHook(
        writeInput({ cwd: repo.root, filePath, targetState: 'absent', postState: { realDelete: true }, written: '' }),
        executors,
        memo
      );

      expect(fixCalls).toBe(0);
      expect(output.additionalContext).toBeNull();
    });
  });

  describe('runTouchHook — exact-range bypass and delete-path surfacing', () => {
    let repo: { root: string; cleanup: () => void };

    afterEach(() => {
      repo?.cleanup();
    });

    it('a statically known input.range bypasses recoverRangeFromDisk', async () => {
      // The written block is absent from the on-disk file (so disk recovery
      // would degrade to whole-file); the given range {1,1} excludes the only
      // covering anchor {5,5} — honoring the range surfaces nothing, while
      // whole-file recovery would surface the span.
      repo = makeTempRepo();
      const filePath = join(repo.root, 'mod.rs');
      writeFileSync(filePath, Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'));
      const memo = createMemoryMemoStore();
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: false }),
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'mod.rs', start: 5, end: 5 })],
        drift: async (): Promise<DriftPorcelainRow[]> => [],
        why: async (): Promise<string | null> => null
      };

      const output = await runTouchHook(
        writeInput({ cwd: repo.root, filePath, written: 'NOT ON DISK\n', range: { start: 1, end: 1 } }),
        executors,
        memo
      );

      expect(output.additionalContext).toBeNull();
    });

    it('input.range scopes the surface to intersecting anchors', async () => {
      repo = makeTempRepo();
      const filePath = join(repo.root, 'mod.rs');
      writeFileSync(filePath, Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'));
      const memo = createMemoryMemoStore();
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: false }),
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'mod.rs', start: 2, end: 2 })],
        drift: async (): Promise<DriftPorcelainRow[]> => [],
        why: async (): Promise<string | null> => WHY
      };

      const output = await runTouchHook(
        writeInput({ cwd: repo.root, filePath, written: 'NOT ON DISK\n', range: { start: 1, end: 3 } }),
        executors,
        memo
      );

      expect(output.additionalContext).not.toBeNull();
      expect(output.additionalContext).toContain('## billing/checkout-request-flow');
    });

    it('a delete touch surfaces the deleted file through the write path (porcelain on a deleted file)', async () => {
      repo = makeTempRepo();
      const filePath = join(repo.root, 'gone.ts');
      writeFileSync(filePath, 'a\nb\n');
      execFileSync('git', ['add', 'gone.ts'], { cwd: repo.root });
      rmSync(filePath);
      const memo = createMemoryMemoStore();
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: false }),
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'gone.ts' })],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ path: 'gone.ts', status: 'DELETED' })],
        why: async (): Promise<string | null> => WHY
      };

      const output = await runTouchHook(
        writeInput({ cwd: repo.root, filePath, targetState: 'absent', postState: { realDelete: true }, written: '' }),
        executors,
        memo
      );

      expect(output.additionalContext).not.toBeNull();
      expect(output.additionalContext).toContain('## billing/checkout-request-flow');
    });
  });

  // =========================================================================
  // Card main-212 Phase 2 — driver-level: delete-reality probe batching and
  // the absent-source resolution for cp/install dests. These run through
  // `runBashTouches` because the probe cache is per-command driver machinery
  // (plan §3 step 1c, step 2).
  // =========================================================================

  describe('delete-reality probe batching (plan §3 step 1c)', () => {
    it('a 10-path rm records exactly two probe invocations; repeated targets fold into the same batch', async () => {
      vi.resetModules();
      const gitCalls: string[][] = [];
      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:child_process')>();
        return {
          ...actual,
          execFileSync: (...args: Parameters<typeof actual.execFileSync>): ReturnType<typeof actual.execFileSync> => {
            const [file, cmdArgs] = args;
            if (file === 'git' && Array.isArray(cmdArgs)) gitCalls.push(cmdArgs);
            return actual.execFileSync(...args);
          }
        };
      });
      try {
        const { runBashTouches: run } = await import('../../src/common/bash-touch.js');
        const repo = makeTempRepo();
        const root = repo.root;
        const paths = Array.from({ length: 10 }, (_, i) => `del-${i}.txt`);
        for (const rel of paths) writeFileSync(join(root, rel), 'x\n');
        execFileSync('git', ['add', ...paths], { cwd: root });
        for (const rel of paths) rmSync(join(root, rel));
        // 13 spans (10 paths + 3 repeats): the per-command probe cache folds
        // the repeats into the same single ls-files and span-list batches.
        const matches: SpanMatch[] = [...paths, 'del-0.txt', 'del-3.txt', 'del-7.txt'].map((rel) => ({
          status: 'resolved' as const,
          idiom: 'rm-write' as const,
          span: { operation: 'delete' as const, absolutePath: join(root, rel), simpleCommandIndex: 0 }
        }));
        const executors: TouchExecutors = {
          fix: async (): Promise<TouchFixResult> => ({ modified: false }),
          list: async (): Promise<PorcelainRow[]> => [],
          drift: async (): Promise<DriftPorcelainRow[]> => [],
          why: async (): Promise<string | null> => null
        };

        await run(matches, SESSION_ID, root, {}, executors, createMemoryMemoStore());

        const lsFiles = gitCalls.filter((c) => c[0] === 'ls-files');
        const spanLists = gitCalls.filter((c) => c[0] === 'span' && c.includes('list'));
        expect(lsFiles).toHaveLength(1);
        expect(spanLists).toHaveLength(1);
        // The single ls-files batch carries every distinct path.
        expect(lsFiles[0]).toContain('--');
        for (const rel of paths) expect(lsFiles[0]).toContain(rel);
        repo.cleanup();
      } finally {
        vi.doUnmock('node:child_process');
        vi.resetModules();
      }
    });
  });

  describe('absent-source resolution for cp/install dests (plan §3 step 2)', () => {
    let repo: { root: string; cleanup: () => void };

    afterEach(() => {
      repo?.cleanup();
    });

    function resolved(idiom: 'cp-write' | 'rm-write', s: ResolvedSpan): SpanMatch {
      return { status: 'resolved', idiom, span: s };
    }

    it('cp missing existing: a phantom source suppresses the dest — zero executor calls', async () => {
      repo = makeTempRepo();
      const root = repo.root;
      const missing = join(root, 'missing.txt');
      const existing = join(root, 'existing.txt');
      writeFileSync(existing, 'kept\n');
      const { executors, calls } = countingExecutors();

      await runBashTouches(
        [
          resolved('cp-write', {
            operation: 'read',
            absolutePath: missing,
            lineStart: 1,
            lineEnd: 2,
            simpleCommandIndex: 0
          }),
          resolved('cp-write', { operation: 'create-overwrite', absolutePath: existing, simpleCommandIndex: 0 })
        ],
        SESSION_ID,
        root,
        {},
        executors,
        createMemoryMemoStore()
      );

      expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
    });

    it('cp a b && rm a: a real source whose absence the later rm pass explains — the dest fires', async () => {
      repo = makeTempRepo();
      const root = repo.root;
      const a = join(root, 'a.txt');
      const b = join(root, 'b.txt');
      writeFileSync(a, 'a1\na2\n');
      writeFileSync(b, 'a1\na2\n');
      execFileSync('git', ['add', 'a.txt'], { cwd: root });
      rmSync(a);
      const { executors, fixPaths } = countingExecutors();

      await runBashTouches(
        [
          resolved('cp-write', { operation: 'read', absolutePath: a, lineStart: 1, lineEnd: 2, simpleCommandIndex: 0 }),
          resolved('cp-write', { operation: 'create-overwrite', absolutePath: b, simpleCommandIndex: 0 }),
          resolved('rm-write', { operation: 'delete', absolutePath: a, simpleCommandIndex: 1, join: '&&' })
        ],
        SESSION_ID,
        root,
        {},
        executors,
        createMemoryMemoStore()
      );

      expect(fixPaths).toEqual([b, a]);
    });

    it('rm a; cp a b with b pre-existing: a real source whose absence nothing explains — the dest is suppressed (the rm delete still fires)', async () => {
      repo = makeTempRepo();
      const root = repo.root;
      const a = join(root, 'a.txt');
      const b = join(root, 'b.txt');
      writeFileSync(a, 'a1\na2\n');
      writeFileSync(b, 'b1\nb2\n');
      execFileSync('git', ['add', 'a.txt'], { cwd: root });
      rmSync(a);
      const { executors, fixPaths } = countingExecutors();

      await runBashTouches(
        [
          resolved('rm-write', { operation: 'delete', absolutePath: a, simpleCommandIndex: 0 }),
          resolved('cp-write', { operation: 'read', absolutePath: a, lineStart: 1, lineEnd: 2, simpleCommandIndex: 1 }),
          resolved('cp-write', { operation: 'create-overwrite', absolutePath: b, simpleCommandIndex: 1 })
        ],
        SESSION_ID,
        root,
        {},
        executors,
        createMemoryMemoStore()
      );

      expect(fixPaths).toEqual([a]);
    });
  });
});
