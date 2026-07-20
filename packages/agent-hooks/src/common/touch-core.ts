/**
 * Harness-agnostic touch-hook core (contract + stubs).
 *
 * This module declares the shape of the PostToolUse "touch signal" that both
 * the Claude (`Read|Edit|Write`) and Codex (`apply_patch`) adapters will drive.
 * It imports nothing from either hook SDK and is typed structurally, per the
 * `common/` layer convention: adapters translate their SDK-specific hook input
 * into a {@link TouchInput}, inject execution/state dependencies, and wrap the
 * returned {@link TouchOutput} in their own output builder.
 *
 * Phase 2.1 declares only the contract — both exported functions are
 * not-implemented stubs. The healing/surfacing logic lands in Phase 2.3 and its
 * skipped checks in Phase 2.2. Reused from the shared kernel (do not redefine):
 * `resolveTouchScope()`/`rangesIntersect` (span-surface.ts scoping and overlap),
 * `isDebt()` + the `PorcelainStatus`/`StalePorcelainRow` vocabulary
 * (agent-hooks-common.ts, extended in Phase 1), and the `MemoStore` cadence
 * store (span-surface.ts, relocated in Phase 1).
 */

import type { LineRange, PorcelainRow, StalePorcelainRow } from './agent-hooks-common.js';
import type { MemoStore } from './span-surface.js';

/** The sentinel thrown by every Phase 2.1 stub until Phase 2.3 fills it in. */
const NOT_IMPLEMENTED = 'Not Implemented';

// ---------------------------------------------------------------------------
// Post-edit range recovery
// ---------------------------------------------------------------------------

/**
 * Recover the line range that written content now occupies in the on-disk file,
 * for anchoring the touched region after an edit has already applied.
 *
 * This generalizes the pre-edit `locateChunk()` technique in
 * [apply-patch.ts](./packages/agent-hooks/src/codex/apply-patch.ts#L253-L286)
 * (previously Codex-only) into a shared post-edit primitive both harnesses use:
 * split `written` and `onDiskContent` into lines and locate the written block as
 * a contiguous run inside the on-disk lines.
 *
 * - A single contiguous match yields its 1-based inclusive {@link LineRange}.
 * - When the block is absent, or appears more than once and its surrounding
 *   context cannot disambiguate which occurrence is the edit, recovery is
 *   ambiguous and the result degrades to `'whole-file'` (the same fallback
 *   `locateChunk()` signals with `null`).
 *
 * Never throws: an unlocatable write is a `'whole-file'` answer, not an error.
 */
export function recoverRange(written: string, onDiskContent: string): LineRange | 'whole-file' {
  void written;
  void onDiskContent;
  throw new Error(NOT_IMPLEMENTED);
}

// ---------------------------------------------------------------------------
// Touch input
// ---------------------------------------------------------------------------

/**
 * Which harness event fired, as the touch core sees it. The core branches on
 * this: `write` heals positional drift in the working tree and may surface a
 * merged block; `read` never mutates the tree and filters positional statuses
 * out of what it surfaces.
 */
export type TouchEventKind = 'read' | 'write';

/** Fields shared by every touch, regardless of kind. */
interface TouchInputBase {
  /** Harness session id — keys the per-session cadence {@link MemoStore}. */
  sessionId: string;
  /**
   * Working directory the tool ran in, used to bound the touch to the CWD repo
   * via `resolveTouchScope()` before any span invocation.
   */
  cwd: string;
  /** Absolute, canonicalized path of the touched file. */
  filePath: string;
}

/** A read touch (Claude `Read`, or a read-shaped Codex event). */
export interface TouchReadInput extends TouchInputBase {
  kind: 'read';
}

/** A write touch (Claude `Edit`/`Write`, Codex `apply_patch`). */
export interface TouchWriteInput extends TouchInputBase {
  kind: 'write';
  /**
   * The content just written to `filePath`, fed to {@link recoverRange} to
   * re-anchor the touched region against the healed on-disk file. For a
   * whole-file create this is the entire file body.
   */
  written: string;
}

/** The harness-agnostic touch the core consumes. */
export type TouchInput = TouchReadInput | TouchWriteInput;

// ---------------------------------------------------------------------------
// Injected executors
// ---------------------------------------------------------------------------

/** Structured result of a scoped `git span stale <file> --fix`. */
export interface TouchFixResult {
  /**
   * Whether `--fix` re-anchored at least one span in the working tree. Drives
   * {@link TouchOutput.treeModified} so a caller/test can assert the healing
   * happened without diffing the tree itself.
   */
  modified: boolean;
}

/**
 * Run `git span stale <file> --fix` scoped to the touched file (write path
 * only), reporting whether the working tree was healed. Async so the eventual
 * implementation and its tests can inject a fake without a real subprocess.
 */
export type TouchFixExecutor = (filePath: string, cwd: string) => Promise<TouchFixResult>;

/**
 * Run `git span list --porcelain <file>` and return its parsed rows — one per
 * anchor covering the file. Structured (not raw stdout) so the merged-block
 * computation and its tests share the same shape.
 */
export type TouchListExecutor = (filePath: string, cwd: string) => Promise<PorcelainRow[]>;

/**
 * Run `git span stale --format porcelain <args>` (scoped to the touched file or
 * its spans) and return its parsed rows — one per drifted anchor, empty when
 * clean. Status classification is via `isDebt()`; positional (`MOVED`,
 * `RESOLVED_PENDING_COMMIT`) rows are never debt.
 */
export type TouchStaleExecutor = (args: string[], cwd: string) => Promise<StalePorcelainRow[]>;

/**
 * The injected execution surface. Kept as three narrow async functions (rather
 * than a raw command runner) so tests inject fakes returning structured data
 * and the core never spawns a subprocess itself. The `read` path never invokes
 * `fix`.
 */
export interface TouchExecutors {
  fix: TouchFixExecutor;
  list: TouchListExecutor;
  stale: TouchStaleExecutor;
}

// ---------------------------------------------------------------------------
// Touch output
// ---------------------------------------------------------------------------

/** What the core hands back for the adapter to translate into SDK output. */
export interface TouchOutput {
  /**
   * The merged `<git-span>` block (span render + any folded semantic directive
   * line) to inject via the harness's `additionalContext`, or `null` when there
   * is nothing worth surfacing this touch.
   */
  additionalContext: string | null;
  /**
   * Whether the working tree was modified by a scoped `--fix` on the write path.
   * Always `false` on the read path (reads never mutate the tree).
   */
  treeModified: boolean;
}

// ---------------------------------------------------------------------------
// Touch hook entry point
// ---------------------------------------------------------------------------

/**
 * Run the touch hook for a single tool call, branching on {@link TouchInput.kind}.
 *
 * - **Write path**: run `executors.fix` (`git span stale <file> --fix`) scoped
 *   to the touched file to heal positional drift in the working tree, then
 *   compute the merged `<git-span>` block against the healed anchors via
 *   `executors.list`/`executors.stale`, folding any remaining semantic residue
 *   into one directive line in the same block. Cadence is deduped through
 *   `memo` (surfacing once per span per session; directive once per span per
 *   status).
 * - **Read path**: never invokes `fix` and never mutates the tree; surfaces the
 *   overlapping spans with positional statuses filtered out via `isDebt()`.
 *
 * Async because the executors are. Returns a Promise for the assembled
 * {@link TouchOutput}. The eventual implementation fails open (absent
 * CLI/`.span/`, timeout, non-zero exit → no signal, logged, editing never
 * blocked); the contract surfaces that as `additionalContext: null`.
 */
export async function runTouchHook(
  input: TouchInput,
  executors: TouchExecutors,
  memo: MemoStore
): Promise<TouchOutput> {
  void input;
  void executors;
  void memo;
  throw new Error(NOT_IMPLEMENTED);
}
