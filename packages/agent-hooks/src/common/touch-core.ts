/**
 * Harness-agnostic touch-hook core.
 *
 * This module implements the PostToolUse "touch signal" that both the Claude
 * (`Read|Edit|Write`) and Codex (`apply_patch`) adapters drive. It imports
 * nothing from either hook SDK and is typed structurally, per the `common/`
 * layer convention: adapters translate their SDK-specific hook input into a
 * {@link TouchInput}, inject execution/state dependencies, and wrap the returned
 * {@link TouchOutput} in their own output builder.
 *
 * Reused from the shared kernel (not redefined): `isDebt()` +
 * `PorcelainStatus`/`DriftPorcelainRow`/`PorcelainRow`/`parsePorcelain`/
 * `parseDriftPorcelain` (agent-hooks-common.ts), `rangesIntersect` and the
 * repo/span-root path utilities (agent-hooks-common.ts), and the `MemoStore`
 * cadence store (span-surface.ts).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  type DriftPorcelainRow,
  humanStatusLabel,
  isDebt,
  type LineRange,
  type PorcelainRow,
  type PorcelainStatus,
  parsePorcelain,
  rangesIntersect,
  relativeToRepo,
  resolveRepoRoot
} from './agent-hooks-common.js';
import { collapseByPath, type RangeLabel, renderAnchorTree } from './anchor-tree.js';
import type { MemoStore } from './span-surface.js';

// ---------------------------------------------------------------------------
// Post-edit range recovery
// ---------------------------------------------------------------------------

/**
 * Split written content into the lines to locate on disk. A single trailing
 * newline is dropped so `"a\nb\n"` and `"a\nb"` locate identically; an empty
 * (or newline-only) write has no locatable block.
 */
function toNeedleLines(written: string): string[] {
  if (written.length === 0) return [];
  const trimmed = written.endsWith('\n') ? written.slice(0, -1) : written;
  if (trimmed.length === 0) return [];
  return trimmed.split('\n');
}

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
 * - When the block is absent, or appears more than once (context to disambiguate
 *   is not available post-edit), recovery is ambiguous and the result degrades
 *   to `'whole-file'` (the same fallback `locateChunk()` signals with `null`).
 *
 * Never throws: an unlocatable write is a `'whole-file'` answer, not an error.
 */
export function recoverRange(written: string, onDiskContent: string): LineRange | 'whole-file' {
  const needle = toNeedleLines(written);
  if (needle.length === 0) return 'whole-file';

  const haystack = onDiskContent.split('\n');
  const last = haystack.length - needle.length;
  const starts: number[] = [];
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      starts.push(i);
      if (starts.length > 1) break; // duplicated → ambiguous, stop early
    }
  }

  if (starts.length === 1) {
    return { start: starts[0] + 1, end: starts[0] + needle.length };
  }
  return 'whole-file';
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
  /** Stable identity of this host tool invocation, used for repair replay. */
  invocationId?: string;
}

/** A read touch (Claude `Read`, or a read-shaped Codex event). */
export interface TouchReadInput extends TouchInputBase {
  kind: 'read';
  /**
   * 1-based starting line of the read, from the Claude `Read` tool's `offset`
   * input. `undefined` when the read had no `offset` (reads from line 1).
   */
  offset?: number;
  /**
   * Line count of the read, from the Claude `Read` tool's `limit` input.
   * `undefined` when the read had no `limit` — see {@link DEFAULT_READ_LIMIT}
   * for how the range is computed in that case.
   */
  limit?: number;
}

/** A write touch (Claude `Edit`/`Write`, Codex `apply_patch`, or a translated Bash write span). */
export interface TouchWriteInput extends TouchInputBase {
  kind: 'write';
  /**
   * The content just written to `filePath`, fed to {@link recoverRange} to
   * re-anchor the touched region against the healed on-disk file. For a
   * whole-file create this is the entire file body; an empty string means
   * "no locatable block" and the touch is scoped file-wide.
   *
   * An empty string means no locatable block and therefore file-wide scope.
   */
  written: string;
  /**
   * Exact post-edit range when statically known (sed -i numeric addresses,
   * patch hunk unions); bypasses {@link recoverRangeFromDisk} (plan §3
   * step 3).
   */
  range?: LineRange;
  /**
   * The file's expected post-command state; the write path gates on it before
   * invoking any executor (plan §3 step 1). Absent means `'exists'` — the
   * Edit/Write and apply_patch paths' default.
   */
  targetState?: 'exists' | 'absent';
  /**
   * Statically knowable expected post-content, verified before any executor
   * call (plan §3 step 1b). `content` compares the on-disk state after the
   * command ran; `realDelete` is delete-only — the path must also be
   * index-tracked or spanned (probes cached per command).
   */
  postState?: {
    /** `exact`: file bytes equal; `suffix`: file content ends with it; `empty`: zero bytes; `size`: byte count. */
    content?: TouchPostContent;
    /** delete-only: the path must also be index-tracked or spanned (probes cached per command). */
    realDelete?: boolean;
    /** PreToolUse index-membership proof for deletes such as `git rm`. */
    preTrackedDelete?: true;
  };
  /**
   * cp/install destination-vs-source verification (plan §3 step 1b): a
   * still-present source must byte-equal the destination; an absent source
   * applies the absent-source rule (real + absence explained by a later
   * same-path decisivePass — the driver's pass-A hold). Set by the
   * `runBashTouches` driver on paired cp create-overwrite touches; never set
   * by adapters. `install -s`/`--strip` is deliberately never paired —
   * stripped output never equals the source, so install dests gate
   * existence-only.
   */
  sourcePath?: string;
  /**
   * mv/git mv/patch rename source verification (plan §3 step 1c): the
   * destination fires only when its source passed the delete-reality probe —
   * a phantom source means the move failed and a pre-existing destination was
   * never touched. No content comparison (patch renames may change content).
   * Set by the `runBashTouches` driver on paired rename-copy touches.
   */
  renameSourcePath?: string;
}

/** The harness-agnostic touch the core consumes. */
export type TouchInput = TouchReadInput | TouchWriteInput;

/**
 * A statically knowable expected post-content (plan §3 step 1b): `exact` —
 * file bytes equal; `suffix` — file content ends with it; `empty` — zero
 * bytes; `size` — byte count.
 */
export type TouchPostContent = { exact: string } | { suffix: string } | { empty: true } | { size: number };

// ---------------------------------------------------------------------------
// Post-state write gate (plan §3 step 1)
// ---------------------------------------------------------------------------

/**
 * The outcome of {@link evaluateWriteGate}: a decisive pass/fail carries
 * verdict weight (content verified, or absence + delete-reality verified);
 * `'inconclusive'` is everything else — the existence-gated families (sed -i,
 * patch/git apply, formatters, restore/checkout) whose existence pass proves
 * nothing, and probe-inapplicable cases (phantom or untracked-unspanned
 * deletes, directory targets). `'pending'` is the driver's absent-source hold
 * (plan §3 step 2): an absent cp source that passed the reality probe cannot
 * decide its destination until the pass-A explanation map is complete.
 */
export type WriteGateOutcome = 'decisivePass' | 'decisiveFail' | 'inconclusive' | 'pending';

/**
 * Per-command reality probe cache (plan §3 step 1c, round-3): two lazy,
 * batched probes — one `git ls-files --error-unmatch` + `git span list
 * --porcelain` pair for the delete-reality membership, and one `git status
 * --porcelain` batch for the working-tree-vs-index mark — never one
 * subprocess per path, membership from printed rows. The `runBashTouches`
 * driver seeds the delete-reality half with every absent target and
 * cp/install source of the compound and the status half with the
 * later-recreate explanation's candidate paths, and shares the cache into
 * pass B so surviving deletes re-gate without re-probing.
 */
export interface RealityProbeCache {
  /** Distinct absolute paths to probe, in first-seen order. */
  paths: string[];
  /** Lazy: absolute paths confirmed index-tracked or spanned, computed once. */
  realPaths: Set<string> | null;
  /**
   * The later-recreate explanation's probe scope (plan §3 step 2): distinct
   * delete paths a later command of the compound can re-create with a
   * file-producing write, in first-seen order.
   */
  changedCandidates: string[];
  /** Lazy: candidates carrying any tracked status row (index or worktree column), computed once. */
  changedPaths: Set<string> | null;
}

/** Create a per-command probe cache for the given absolute paths. */
export function createRealityProbeCache(
  paths: Iterable<string>,
  changedCandidates: Iterable<string> = []
): RealityProbeCache {
  return {
    paths: [...new Set(paths)],
    realPaths: null,
    changedCandidates: [...new Set(changedCandidates)],
    changedPaths: null
  };
}

/** Whether the path exists on disk (any node kind); `false` on any stat failure. */
export function fileExists(absPath: string): boolean {
  try {
    fs.statSync(absPath);
    return true;
  } catch {
    return false;
  }
}

/** Whether the path is a regular file — a directory target fails the `'exists'` gate. */
function isFileOnDisk(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Verify a statically knowable post-content expectation against the on-disk
 * file (plan §3 step 1b). Any read failure is a mismatch, never an error.
 */
function contentMatches(post: TouchPostContent, filePath: string): boolean {
  try {
    if ('exact' in post) return fs.readFileSync(filePath, 'utf8') === post.exact;
    if ('suffix' in post) {
      // The shell appends the body plus its terminating newline; the heredoc
      // grammar strips exactly that one `\n` from `span.written`
      // (parse-command.ts heredoc body extraction), so a file ending
      // `written\n` is the same appended text as `written` — accept both.
      const content = fs.readFileSync(filePath, 'utf8');
      return content.endsWith(post.suffix) || content.endsWith(`${post.suffix}\n`);
    }
    if ('empty' in post) return fs.statSync(filePath).size === 0;
    return fs.statSync(filePath).size === post.size;
  } catch {
    return false;
  }
}

/**
 * The delete-reality probe (plan §3 step 1c): lazily run the two per-command
 * batches and cache the confirmed-real path set. Membership comes from the
 * printed rows, not the exit code — `git ls-files --error-unmatch` prints
 * every tracked path even when it exits nonzero (any missing path), and
 * `git span list --porcelain` prints nothing for phantom or known-but-
 * unspanned paths (exit 0 with "No spans match the filters"). A plain-`rm`'d
 * tracked file keeps its index entry (ls-files exit 0 — the probe fires);
 * `git rm` removes it (ls-files 128) so only spanned files stay real. A
 * phantom or untracked-unspanned path fails both probes — the delete degrades
 * to `'inconclusive'` and never fires. Fail-safe: an unresolvable repo or a
 * probe failure yields an empty set, never an error.
 */
function realPaths(cache: RealityProbeCache, cwd: string): Set<string> {
  if (cache.realPaths !== null) return cache.realPaths;
  const real = new Set<string>();
  if (cache.paths.length > 0) {
    const repoRoot = resolveRepoRoot(cwd);
    if (repoRoot !== null) {
      const rels = cache.paths.map((p) => relativeToRepo(repoRoot, p));
      const capture = (args: string[]): string | null => {
        try {
          return execFileSync('git', args, {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: DEFAULT_TIMEOUT_MS
          });
        } catch (err) {
          const stdout = (err as { stdout?: string }).stdout;
          return typeof stdout === 'string' ? stdout : null;
        }
      };
      const lsFiles = capture(['ls-files', '--error-unmatch', '--', ...rels]);
      if (lsFiles !== null) {
        for (const line of lsFiles.split('\n')) {
          const rel = line.trim();
          if (rel.length > 0) real.add(join(repoRoot, rel));
        }
      }
      const spanList = capture(['span', 'list', '--porcelain', ...rels]);
      if (spanList !== null) {
        for (const row of parsePorcelain(spanList)) real.add(join(repoRoot, row.path));
      }
    }
  }
  cache.realPaths = real;
  return real;
}

/**
 * The working-tree-vs-index probe (plan §3 step 2, round-3; widened round-4):
 * lazily run one `git status --porcelain -z` batch over the seeded candidates
 * and cache the set carrying any tracked status row — the re-create's mark.
 * The driver consults it before explaining a delete's decisiveFail ("file
 * present, so the delete didn't happen") by a later same-path write; a
 * decisiveFail implies the path EXISTS at compound end, so every row shape
 * below is judged against that reality.
 *
 * Round-3 read only the Y (worktree) column, treating "working tree ==
 * index" as proof the re-create write never ran. That probe state is shared
 * by two realities the rule conflated: (a) the write genuinely never ran —
 * a failed rm short-circuits the `&&` chain, the file still matches HEAD and
 * the index, and NO row exists — and (b) the write ran AND was staged in the
 * same compound (`rm f && patch < d && git add f` → `M ` row, blank Y): the
 * round-4 finding, a verified write left silent. The rule now marks ANY
 * tracked status row: the X (index) column or the Y (worktree) column
 * non-blank. `--untracked-files=no` suppresses `?? ` rows, and `?`/`!` are
 * rejected defensively — an untracked or ignored path carries no index
 * baseline, so it can never count as re-created (fail closed).
 *
 * Per-column reasoning against the delete-span reality (the path is tracked
 * in the index per the delete-reality probe, and exists at compound end):
 * - `M ` / `A ` (index differs from HEAD, worktree matches the index): the
 *   compound staged a write (`git add`; `A ` when the path's baseline was
 *   itself a staged add, so never in HEAD) — case (b), the re-create is
 *   verified real in the index.
 * - `R ` (a staged rename whose destination is the path): same — the index
 *   records the write.
 * - `D ` (index deleted, worktree matches): the file is either absent
 *   (matching the staged delete — no decisiveFail, the axis is never
 *   consulted) or recreated-but-untracked after a `git rm` (hidden by
 *   `--untracked-files=no`, the row persists) — a present file means the
 *   compound wrote it, so it counts.
 * - Y-column rows (` M`, `MM`, ` D`, `AM`...): the round-3 rule unchanged —
 *   the worktree demonstrably differs from the index.
 *
 * Case (a) still yields NO row (the file matches HEAD — the chain
 * short-circuited before anything changed), so the genuine suppression holds.
 * The one residual class (documented in the axis's call site): a PRE-EXISTING
 * uncommitted or staged change on the deleted path masks the discriminator —
 * the status row predates the compound, so a failed rm lets the joined write
 * fire advisory. The staged face is the widening's one cost: round-3's
 * blank-Y rule kept `M `/`A ` rows invisible, so only the worktree-dirty
 * mask fired; the index column now marks both. It only manifests where
 * genuine drift exists against the span baseline, and a harness-supplied
 * non-zero exit code still suppresses the advisory class in pass B — the
 * same bounded harm as the plan's documented "coincidentally passes" join
 * corner. `-z` prints raw, NUL-separated `XY <path>` entries so space- and
 * quote-bearing paths parse unambiguously. Fail-safe: an unresolvable repo
 * or a probe failure yields an empty set, never an error.
 */
function changedOnDisk(cache: RealityProbeCache, cwd: string): Set<string> {
  if (cache.changedPaths !== null) return cache.changedPaths;
  const changed = new Set<string>();
  if (cache.changedCandidates.length > 0) {
    const repoRoot = resolveRepoRoot(cwd);
    if (repoRoot !== null) {
      const rels = cache.changedCandidates.map((p) => relativeToRepo(repoRoot, p));
      try {
        const out = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=no', '--', ...rels], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: DEFAULT_TIMEOUT_MS
        });
        for (const entry of out.split('\0')) {
          if (entry.length < 4) continue; // skip the trailing empty entry and rename-pair path rows
          const indexStatus = entry.charAt(0);
          const worktreeStatus = entry.charAt(1);
          if (indexStatus === ' ' && worktreeStatus === ' ') continue; // no tracked difference → no mark
          if (indexStatus === '?' || indexStatus === '!' || worktreeStatus === '?' || worktreeStatus === '!') {
            continue; // untracked or ignored → no index baseline (fail closed)
          }
          changed.add(join(repoRoot, entry.slice(3)));
        }
      } catch (err) {
        void err; // probe failure → empty set (fail-safe, never an error)
      }
    }
  }
  cache.changedPaths = changed;
  return changed;
}

/**
 * Whether the path carries a tracked status row — its index content, its
 * working-tree content, or both differ from the committed/index baseline
 * (see the probe's per-column reasoning) — the later-recreate explanation's
 * mark. `false` on any probe failure or for any path outside the seeded
 * candidates (fail closed).
 */
export function workingTreeChanged(probeCache: RealityProbeCache, cwd: string, absPath: string): boolean {
  return changedOnDisk(probeCache, cwd).has(absPath);
}

/**
 * The layered post-state gate (plan §3 step 1), evaluated before any executor
 * call, side-effect-free (no memo writes, no executor calls; the probe is
 * read-only and per-command cached):
 *
 * 1. `targetState: 'absent'` → the path must be absent; when it is, the
 *    delete-reality probe decides: index-tracked or spanned → `decisivePass`
 *    (dangling anchors surface), phantom → `'inconclusive'` (nothing to
 *    surface — the miss is harmless, and the delete never fires).
 * 2. `targetState: 'exists'` → the target must be a regular file (a directory
 *    or missing target fails).
 * 3. Content verification where the expected post-content is statically
 *    knowable (`exact`/`suffix`/`empty`/`size`): a mismatch means the write's
 *    effect is absent — no touch.
 * 4. cp destination-vs-source: a still-present source must byte-equal the
 *    destination; an absent source applies the absent-source rule (passed the
 *    reality probe AND its absence explained by a later same-path
 *    `decisivePass` — the driver resolves the `'pending'` hold).
 * 5. rename-copy: the destination fires only when its source passed the
 *    delete-reality probe (a phantom source means the move failed).
 *
 * Everything else — the existence-gated families whose existence pass proves
 * nothing — is `'inconclusive'`.
 */
export function evaluateWriteGate(input: TouchWriteInput, probeCache: RealityProbeCache): WriteGateOutcome {
  if (input.targetState === 'absent') {
    if (fileExists(input.filePath)) return 'decisiveFail';
    if (input.postState?.preTrackedDelete === true) return 'decisivePass';
    return realPaths(probeCache, input.cwd).has(input.filePath) ? 'decisivePass' : 'inconclusive';
  }

  if (!isFileOnDisk(input.filePath)) return 'decisiveFail';

  const content = input.postState?.content;
  if (content !== undefined) {
    return contentMatches(content, input.filePath) ? 'decisivePass' : 'decisiveFail';
  }

  if (input.sourcePath !== undefined) {
    if (fileExists(input.sourcePath)) {
      let src: string;
      let dst: string;
      try {
        src = fs.readFileSync(input.sourcePath, 'utf8');
        dst = fs.readFileSync(input.filePath, 'utf8');
      } catch {
        return 'decisiveFail';
      }
      return src === dst ? 'decisivePass' : 'decisiveFail';
    }
    // Absent source — the absent-source rule (plan §3 step 1b): the dest
    // fires only when the source passed the reality probe (it was a real
    // file) AND its absence is explained by a later same-path decisivePass.
    return realPaths(probeCache, input.cwd).has(input.sourcePath) ? 'pending' : 'decisiveFail';
  }

  if (input.renameSourcePath !== undefined) {
    // No content comparison — patch renames may change content; a phantom
    // source means the move failed and a pre-existing destination was never
    // touched (plan §3 step 1c).
    return realPaths(probeCache, input.cwd).has(input.renameSourcePath) ? 'decisivePass' : 'decisiveFail';
  }

  return 'inconclusive';
}

// ---------------------------------------------------------------------------
// Injected executors
// ---------------------------------------------------------------------------

export type ContextExtent = { kind: 'whole' } | { kind: 'lines'; start: number; end: number };

export interface ContextScope {
  path: string;
  extent: ContextExtent;
}

export interface ContextLocation {
  path: string;
  extent: ContextExtent;
}

export type ContextSource = 'WORKTREE' | 'INDEX' | 'HEAD';
export type ContextUnavailableReason =
  | 'LFS_NOT_FETCHED'
  | 'LFS_NOT_INSTALLED'
  | 'PROMISOR_MISSING'
  | 'SPARSE_EXCLUDED'
  | 'FILTER_FAILED'
  | 'IO_ERROR';
export type ContextStatus =
  | { code: 'FRESH' | 'RESOLVED_PENDING_COMMIT' | 'MOVED' | 'CHANGED' | 'DELETED' | 'CONFLICT' | 'SUBMODULE' }
  | { code: 'CONTENT_UNAVAILABLE'; reason: ContextUnavailableReason; detail: unknown };

export interface ContextAnchor {
  ordinal: number;
  id: string;
  anchored: ContextLocation;
  current: ContextLocation | null;
  status: ContextStatus;
  source: ContextSource | null;
  sources: ContextSource[];
}

export interface ContextOverlap {
  scope: number;
  anchor: { ordinal: number; id: string };
  basis: 'anchored' | 'current';
  location: ContextLocation;
  intersection: ContextExtent;
}

export interface ContextSpan {
  name: string;
  why: string | null;
  overlaps: ContextOverlap[];
  anchors: ContextAnchor[];
}

export interface ContextMutation {
  requested: boolean;
  rewritten: boolean;
  spans_touched: number;
  anchors_updated: number;
  anchors_removed: number;
  identities_collapsed: number;
}

export interface ContextDocument {
  schema_version: 1;
  scopes: ContextScope[];
  mutation: ContextMutation;
  spans: ContextSpan[];
}

export type ContextFailureCategory =
  | 'command_absent'
  | 'timeout'
  | 'nonzero_exit'
  | 'empty_output'
  | 'malformed_json'
  | 'schema_rejected'
  | 'address_limit';

export interface ContextQueryRequest {
  repoRoot: string;
  addresses: string[];
  repair: boolean;
  operationId?: string;
}

export type ContextQueryResult =
  | { ok: true; document: ContextDocument; elapsedMs: number }
  | { ok: false; failure: ContextFailureCategory; elapsedMs: number };

export type TouchContextExecutor = (request: ContextQueryRequest) => Promise<ContextQueryResult>;

/** The injected plural execution surface used by every hook driver. */
export interface TouchExecutors {
  context: TouchContextExecutor;
  forInvocation?: () => TouchExecutors;
}

const MAX_CONTEXT_JSON_BYTES = 16 * 1024 * 1024;
const MAX_CONTEXT_ADDRESSES = 4096;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unsupported fields`);
  }
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function integerField(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function booleanField(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

function arrayField(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function enumField<T extends string>(value: unknown, tokens: readonly T[], label: string): T {
  if (typeof value !== 'string' || !tokens.includes(value as T)) throw new Error(`${label} has an unsupported token`);
  return value as T;
}

function decodeExtent(value: unknown, label: string): ContextExtent {
  const object = record(value, label);
  const kind = enumField(object.kind, ['whole', 'lines'] as const, `${label}.kind`);
  if (kind === 'whole') {
    exactKeys(object, ['kind'], label);
    return { kind };
  }
  exactKeys(object, ['kind', 'start', 'end'], label);
  const start = integerField(object.start, `${label}.start`);
  const end = integerField(object.end, `${label}.end`);
  if (start < 1 || end < start) throw new Error(`${label} has an invalid line range`);
  return { kind, start, end };
}

function decodeLocation(value: unknown, label: string): ContextLocation {
  const object = record(value, label);
  exactKeys(object, ['path', 'extent'], label);
  return { path: stringField(object.path, `${label}.path`), extent: decodeExtent(object.extent, `${label}.extent`) };
}

function decodeStatus(value: unknown, label: string): ContextStatus {
  const object = record(value, label);
  const code = enumField(
    object.code,
    [
      'FRESH',
      'RESOLVED_PENDING_COMMIT',
      'MOVED',
      'CHANGED',
      'DELETED',
      'CONFLICT',
      'SUBMODULE',
      'CONTENT_UNAVAILABLE'
    ] as const,
    `${label}.code`
  );
  if (code !== 'CONTENT_UNAVAILABLE') {
    exactKeys(object, ['code'], label);
    return { code };
  }
  exactKeys(object, ['code', 'reason', 'detail'], label);
  const reason = enumField(
    object.reason,
    [
      'LFS_NOT_FETCHED',
      'LFS_NOT_INSTALLED',
      'PROMISOR_MISSING',
      'SPARSE_EXCLUDED',
      'FILTER_FAILED',
      'IO_ERROR'
    ] as const,
    `${label}.reason`
  );
  return { code, reason, detail: object.detail };
}

function decodeSource(value: unknown, label: string): ContextSource {
  return enumField(value, ['WORKTREE', 'INDEX', 'HEAD'] as const, label);
}

function decodeAnchor(value: unknown, label: string): ContextAnchor {
  const object = record(value, label);
  exactKeys(object, ['ordinal', 'id', 'anchored', 'current', 'status', 'source', 'sources'], label);
  return {
    ordinal: integerField(object.ordinal, `${label}.ordinal`),
    id: stringField(object.id, `${label}.id`),
    anchored: decodeLocation(object.anchored, `${label}.anchored`),
    current: object.current === null ? null : decodeLocation(object.current, `${label}.current`),
    status: decodeStatus(object.status, `${label}.status`),
    source: object.source === null ? null : decodeSource(object.source, `${label}.source`),
    sources: arrayField(object.sources, `${label}.sources`).map((source, index) =>
      decodeSource(source, `${label}.sources[${index}]`)
    )
  };
}

function decodeOverlap(value: unknown, label: string): ContextOverlap {
  const object = record(value, label);
  exactKeys(object, ['scope', 'anchor', 'basis', 'location', 'intersection'], label);
  const anchor = record(object.anchor, `${label}.anchor`);
  exactKeys(anchor, ['ordinal', 'id'], `${label}.anchor`);
  return {
    scope: integerField(object.scope, `${label}.scope`),
    anchor: {
      ordinal: integerField(anchor.ordinal, `${label}.anchor.ordinal`),
      id: stringField(anchor.id, `${label}.anchor.id`)
    },
    basis: enumField(object.basis, ['anchored', 'current'] as const, `${label}.basis`),
    location: decodeLocation(object.location, `${label}.location`),
    intersection: decodeExtent(object.intersection, `${label}.intersection`)
  };
}

/** Decode the complete schema-v1 context document or reject it atomically. */
export function decodeContextDocument(stdout: string): ContextDocument {
  if (Buffer.byteLength(stdout) > MAX_CONTEXT_JSON_BYTES) throw new Error('context document exceeds the size limit');
  const root = record(JSON.parse(stdout) as unknown, 'context document');
  exactKeys(root, ['schema_version', 'scopes', 'mutation', 'spans'], 'context document');
  if (root.schema_version !== 1) throw new Error('unsupported context schema version');
  const scopes = arrayField(root.scopes, 'context document.scopes').map((scope, index): ContextScope => {
    const object = record(scope, `context document.scopes[${index}]`);
    exactKeys(object, ['path', 'extent'], `context document.scopes[${index}]`);
    return {
      path: stringField(object.path, `context document.scopes[${index}].path`),
      extent: decodeExtent(object.extent, `context document.scopes[${index}].extent`)
    };
  });
  const mutationObject = record(root.mutation, 'context document.mutation');
  exactKeys(
    mutationObject,
    ['requested', 'rewritten', 'spans_touched', 'anchors_updated', 'anchors_removed', 'identities_collapsed'],
    'context document.mutation'
  );
  const mutation: ContextMutation = {
    requested: booleanField(mutationObject.requested, 'context document.mutation.requested'),
    rewritten: booleanField(mutationObject.rewritten, 'context document.mutation.rewritten'),
    spans_touched: integerField(mutationObject.spans_touched, 'context document.mutation.spans_touched'),
    anchors_updated: integerField(mutationObject.anchors_updated, 'context document.mutation.anchors_updated'),
    anchors_removed: integerField(mutationObject.anchors_removed, 'context document.mutation.anchors_removed'),
    identities_collapsed: integerField(
      mutationObject.identities_collapsed,
      'context document.mutation.identities_collapsed'
    )
  };
  const spans = arrayField(root.spans, 'context document.spans').map((span, index): ContextSpan => {
    const label = `context document.spans[${index}]`;
    const object = record(span, label);
    exactKeys(object, ['name', 'why', 'overlaps', 'anchors'], label);
    const why = object.why;
    if (why !== null && typeof why !== 'string') throw new Error(`${label}.why must be a string or null`);
    return {
      name: stringField(object.name, `${label}.name`),
      why,
      overlaps: arrayField(object.overlaps, `${label}.overlaps`).map((overlap, overlapIndex) =>
        decodeOverlap(overlap, `${label}.overlaps[${overlapIndex}]`)
      ),
      anchors: arrayField(object.anchors, `${label}.anchors`).map((anchor, anchorIndex) =>
        decodeAnchor(anchor, `${label}.anchors[${anchorIndex}]`)
      )
    };
  });
  for (const [spanIndex, span] of spans.entries()) {
    for (const overlap of span.overlaps) {
      if (overlap.scope >= scopes.length)
        throw new Error(`context document.spans[${spanIndex}] references an unknown scope`);
      const anchor = span.anchors[overlap.anchor.ordinal];
      if (anchor === undefined || anchor.id !== overlap.anchor.id || anchor.ordinal !== overlap.anchor.ordinal) {
        throw new Error(`context document.spans[${spanIndex}] references an unknown anchor`);
      }
    }
  }
  return { schema_version: 1, scopes, mutation, spans };
}

// ---------------------------------------------------------------------------
// Touch output
// ---------------------------------------------------------------------------

/** What the core hands back for the adapter to translate into SDK output. */
export interface TouchOutput {
  /**
   * The merged `<git-span>` block (header, one human-format section per
   * surfaced span, footer) to inject via the harness's `additionalContext`,
   * or `null` when there is nothing worth surfacing this touch.
   */
  additionalContext: string | null;
  /**
   * Whether the working tree was modified by a scoped `--fix` on the write path.
   * Always `false` on the read path (reads never mutate the tree).
   */
  treeModified: boolean;
}

// ---------------------------------------------------------------------------
// Merged-block assembly
// ---------------------------------------------------------------------------

/** The memo key under which a span's render for a given drift status is deduped. */
function driftKey(name: string, status: PorcelainStatus): string {
  // Span names come from tab-delimited porcelain, so they never contain a tab;
  // a tab-joined key can never collide with a bare span name (the surfacing key).
  return `${name}\t${status}`;
}

/** The `path#Lstart-Lend` (or bare-path, whole-file) anchor text for a row. */
function anchorText(row: PorcelainRow): string {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}

function cleanHeader(fileName: string): string {
  return `${fileName} has implicit dependencies:`;
}

function cleanFooter(fileName: string): string {
  return `If you change ${fileName} check the other files to confirm they still work together.`;
}

/**
 * The write path names the edit as the cause; the read path only surfaces
 * pre-existing drift it didn't create, so it names the dependency instead.
 */
function driftHeader(driftedCount: number, kind: TouchInput['kind']): string {
  if (kind === 'write') {
    return driftedCount === 1
      ? 'This edit put an implicit dependency out of date:'
      : 'This edit put implicit dependencies out of date:';
  }
  return driftedCount === 1
    ? 'This file has an implicit dependency out of date:'
    : 'This file has implicit dependencies out of date:';
}

function driftFooter(driftedNames: string[]): string {
  if (driftedNames.length === 1) {
    const name = driftedNames[0];
    return `Restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, swap the old anchor for the new one with \`git span replace\`. Update or retire the why only if its meaning changed. Require \`git span drift ${name}\` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.`;
  }
  return 'For each out-of-date span: restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, swap the old anchor for the new one with `git span replace`. Update or retire the why only if its meaning changed. Require `git span drift <name>` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.';
}

/** The {@link RangeLabel} for a porcelain row — `0-0` is the whole-file anchor. */
function rangeLabel(row: PorcelainRow): RangeLabel {
  if (row.start === 0 && row.end === 0) return { kind: 'whole-file' };
  return { kind: 'range', start: row.start, end: row.end };
}

/**
 * A span's full anchor list, rendered as a shared-prefix tree by
 * {@link renderAnchorTree}, with each anchor that carries genuine drift
 * suffixed by its lowercase status token(s) (` — changed`).
 *
 * A drift row matches an anchor by exact path+range, or by path alone when the
 * span has a single anchor on that path (ranges can disagree after a heal).
 * `soleOnPath` is deliberately computed over the **full flat anchor list**,
 * before any grouping — the tree layout must never be able to change *which*
 * anchors get labeled, only where they sit on the page.
 */
function anchorBullets(anchors: PorcelainRow[], debtRows: DriftPorcelainRow[]): string[] {
  const rows = anchors.map((anchor) => {
    const soleOnPath = anchors.filter((a) => a.path === anchor.path).length === 1;
    const statuses = new Set<PorcelainStatus>();
    for (const row of debtRows) {
      if (row.path !== anchor.path) continue;
      if (soleOnPath || (row.start === anchor.start && row.end === anchor.end)) {
        statuses.add(row.status);
      }
    }
    const sorted = [...statuses].sort();
    const suffix = sorted.length > 0 ? ` — ${sorted.map(humanStatusLabel).join(', ')}` : '';
    return { path: anchor.path, range: rangeLabel(anchor), suffix };
  });
  try {
    return renderAnchorTree(collapseByPath(rows));
  } catch {
    // FAIL-CLOSED, not a `<greenfield>`-forbidden fallback — do not remove it
    // on the theory that a degraded fallback is itself forbidden. An uncaught
    // throw here does not degrade to a flat list: it escapes to
    // `runTouchHook`'s catch, which resolves the whole hook to
    // `additionalContext: null`, so the agent is never told about the drift at
    // all. Catching locally narrows what a rendering defect can cost from "the
    // reminder disappears" to "the reminder looks like it did before the tree".
    // Whether to surface and what shape to surface in are different things, and
    // this catch only ever touches the latter.
    // `rows` is index-aligned with `anchors`, so this reproduces today's flat
    // bullet run byte for byte, suffixes included.
    return anchors.map((anchor, i) => `- ${anchorText(anchor)}${rows[i].suffix}`);
  }
}

/**
 * One human-format span section: `## <name>`, the full anchor list (drifted
 * anchors status-suffixed), and the why sentence when one is recorded.
 *
 * The name header and the why sentence are the same shape `git span list`
 * renders; the anchor list deliberately is not — it renders as a shared-prefix
 * tree ({@link anchorBullets}) where the CLI prints a flat `- path#Lrange`
 * bullet run. The CLI's own text format is untouched; only this hook's
 * re-presentation of it groups.
 */
function renderSpanSection(
  name: string,
  anchors: PorcelainRow[],
  debtRows: DriftPorcelainRow[],
  why: string | null
): string {
  const lines = [`## ${name}`, ...anchorBullets(anchors, debtRows)];
  if (why) lines.push('', why);
  return lines.join('\n');
}

/**
 * Assemble the merged `<git-span>` block: header, one section per surfaced
 * span (separated by `---`), and a single footer after a final `---`.
 */
function buildBlock(sections: string[], header: string, footer: string): string {
  const body = `${header}\n\n${sections.join('\n\n---\n\n')}\n\n---\n\n${footer}`;
  return `\n<git-span>\n${body}\n</git-span>\n`;
}

// ---------------------------------------------------------------------------
// Touch hook entry point
// ---------------------------------------------------------------------------

/**
 * Recover the touched range from the on-disk file for a write. An empty write or
 * an unreadable file (e.g. a delete, or the file was never written) degrades to
 * `'whole-file'`, scoping the touch to every covering span — the fail-open
 * behavior, not an error.
 */
function recoverRangeFromDisk(written: string, filePath: string): LineRange | 'whole-file' {
  if (written.length === 0) return 'whole-file';
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return 'whole-file';
  }
  return recoverRange(written, content);
}

/**
 * The Claude `Read` tool's documented default line count when `offset` is
 * given without `limit` ("By default, it reads up to 2000 lines"). Named so
 * the assumption is visible and easy to update if that default ever changes.
 */
export const DEFAULT_READ_LIMIT = 2000;

/**
 * Compute the touched range for a read from the Claude `Read` tool's
 * `offset`/`limit` inputs. Neither present means a genuine whole-file read —
 * every covering span stays in scope, matching today's behavior. Otherwise
 * the range starts at `offset` (default line 1) and runs for `limit` lines
 * (default {@link DEFAULT_READ_LIMIT}), clamped to the file's actual line
 * count so a short file with a large `offset`/`limit` doesn't overshoot.
 * Clamping requires reading the file; an unreadable file degrades to
 * `'whole-file'` — the same fail-open behavior the write path uses.
 */
function recoverReadRange(
  offset: number | undefined,
  limit: number | undefined,
  filePath: string
): LineRange | 'whole-file' {
  if (offset === undefined && limit === undefined) return 'whole-file';
  const start = offset ?? 1;
  let lineCount: number;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    lineCount = content.length === 0 ? 0 : content.split('\n').length;
  } catch {
    return 'whole-file';
  }
  const end = Math.min(start + (limit ?? DEFAULT_READ_LIMIT) - 1, Math.max(lineCount, start));
  return { start, end };
}

function rangesForInput(input: TouchInput): LineRange[] | 'whole-file' {
  if (input.kind === 'read') {
    const recovered = recoverReadRange(input.offset, input.limit, input.filePath);
    return recovered === 'whole-file' ? 'whole-file' : [recovered];
  }
  if (input.range !== undefined) return [input.range];
  const recovered = recoverRangeFromDisk(input.written, input.filePath);
  return recovered === 'whole-file' ? 'whole-file' : [recovered];
}

function extentIntersects(a: ContextExtent, b: LineRange[] | 'whole-file'): boolean {
  if (b === 'whole-file' || a.kind === 'whole') return true;
  return b.some((range) => rangesIntersect(range, { start: a.start, end: a.end }));
}

function contextStatusToken(status: ContextStatus): PorcelainStatus {
  return status.code === 'CONTENT_UNAVAILABLE' ? status.reason : status.code;
}

function contextAnchorRow(name: string, anchor: ContextAnchor): PorcelainRow {
  const extent = anchor.anchored.extent;
  return {
    name,
    path: anchor.anchored.path,
    start: extent.kind === 'whole' ? 0 : extent.start,
    end: extent.kind === 'whole' ? 0 : extent.end
  };
}

function contextDriftRow(name: string, anchor: ContextAnchor): DriftPorcelainRow {
  return { ...contextAnchorRow(name, anchor), status: contextStatusToken(anchor.status) };
}

function spanTouchesInput(
  span: ContextSpan,
  document: ContextDocument,
  repoPath: string,
  ranges: LineRange[] | 'whole-file'
): boolean {
  return span.overlaps.some((overlap) => {
    const scope = document.scopes[overlap.scope];
    return scope.path === repoPath && extentIntersects(overlap.intersection, ranges);
  });
}

function renderContextTouch(
  input: TouchInput,
  document: ContextDocument,
  repoPath: string,
  ranges: LineRange[] | 'whole-file',
  memo: MemoStore
): string | null {
  const surfaced = memo.getSurfaced(input.sessionId);
  const sections: string[] = [];
  const toRecord: string[] = [];
  const driftedNames: string[] = [];
  for (const span of document.spans) {
    if (!spanTouchesInput(span, document, repoPath, ranges)) continue;
    const anchors = span.anchors.map((anchor) => contextAnchorRow(span.name, anchor));
    const drift = span.anchors
      .filter((anchor) => anchor.status.code !== 'FRESH')
      .map((anchor) => contextDriftRow(span.name, anchor));
    const debtRows = drift.filter((row) => isDebt(row.status));
    if (drift.length > 0 && debtRows.length === 0) continue;
    const debtStatuses = [...new Set(debtRows.map((row) => row.status))].sort();
    const unsurfacedDebt = debtStatuses.filter((status) => !surfaced.has(driftKey(span.name, status)));
    const isNewName = !surfaced.has(span.name);
    if (!isNewName && unsurfacedDebt.length === 0) continue;
    sections.push(renderSpanSection(span.name, anchors, debtRows, span.why));
    if (debtStatuses.length > 0) driftedNames.push(span.name);
    if (isNewName) toRecord.push(span.name);
    for (const status of unsurfacedDebt) toRecord.push(driftKey(span.name, status));
  }
  if (sections.length === 0) return null;
  memo.addSurfaced(input.sessionId, toRecord);
  const fileName = basename(input.filePath);
  const header = driftedNames.length > 0 ? driftHeader(driftedNames.length, input.kind) : cleanHeader(fileName);
  const footer = driftedNames.length > 0 ? driftFooter(driftedNames) : cleanFooter(fileName);
  return buildBlock(sections, header, footer);
}

interface PreparedTouch {
  input: TouchInput;
  index: number;
  repoRoot: string;
  repoPath: string;
  ranges: LineRange[] | 'whole-file';
  partitionKey: string;
}

export interface TouchBatchDiagnostics {
  queryCount: number;
  scopeCount: number;
  selectedResultCount: number;
  elapsedMs: number;
  mutation: 'rewritten' | 'unchanged' | 'unknown';
  failure: ContextFailureCategory | null;
}

export interface TouchBatchOutput {
  outputs: TouchOutput[];
  treeModified: boolean;
  diagnostics: TouchBatchDiagnostics;
}

function normalizedAddressIdentity(touches: readonly PreparedTouch[]): string[] {
  const byPath = new Map<string, LineRange[] | 'whole-file'>();
  for (const touch of touches) {
    const existing = byPath.get(touch.repoPath);
    if (existing === 'whole-file' || touch.ranges === 'whole-file') {
      byPath.set(touch.repoPath, 'whole-file');
    } else {
      byPath.set(touch.repoPath, [...(existing ?? []), ...touch.ranges]);
    }
  }
  const identity: string[] = [];
  for (const path of [...byPath.keys()].sort()) {
    const ranges = byPath.get(path)!;
    if (ranges === 'whole-file') {
      identity.push(path);
      continue;
    }
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: LineRange[] = [];
    for (const range of sorted) {
      const prior = merged.at(-1);
      if (prior !== undefined && range.start <= prior.end) prior.end = Math.max(prior.end, range.end);
      else merged.push({ ...range });
    }
    identity.push(...merged.map((range) => `${path}#L${range.start}-L${range.end}`));
  }
  return identity;
}

function deterministicOperationId(invocationId: string, repoRoot: string, addresses: readonly string[]): string {
  const bytes = createHash('sha256')
    .update(invocationId)
    .update('\0')
    .update(repoRoot)
    .update('\0')
    .update(addresses.join('\0'))
    .digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Query repository/mutation partitions once, then replay logical touches in their original order. */
export async function runTouchHooks(
  inputs: readonly TouchInput[],
  executors: TouchExecutors,
  memo: MemoStore,
  invocationId: string,
  probeCache?: RealityProbeCache
): Promise<TouchBatchOutput> {
  const outputs = inputs.map<TouchOutput>(() => ({ additionalContext: null, treeModified: false }));
  const prepared: PreparedTouch[] = [];
  for (const [index, input] of inputs.entries()) {
    if (input.kind === 'write' && input.targetState !== undefined) {
      const probe = probeCache ?? createRealityProbeCache(input.targetState === 'absent' ? [input.filePath] : []);
      const outcome = evaluateWriteGate(input, probe);
      if (outcome === 'decisiveFail' || (outcome === 'inconclusive' && input.targetState === 'absent')) continue;
    }
    const repoRoot = resolveRepoRoot(dirname(input.filePath));
    if (repoRoot === null) continue;
    prepared.push({
      input,
      index,
      repoRoot,
      repoPath: relativeToRepo(repoRoot, input.filePath),
      ranges: rangesForInput(input),
      partitionKey: `${repoRoot}\0${input.kind === 'write' ? 'repair' : 'read'}`
    });
  }

  const partitions = new Map<string, PreparedTouch[]>();
  for (const touch of prepared) {
    const partition = partitions.get(touch.partitionKey);
    if (partition === undefined) partitions.set(touch.partitionKey, [touch]);
    else partition.push(touch);
  }

  let queryCount = 0;
  let scopeCount = 0;
  let selectedResultCount = 0;
  let elapsedMs = 0;
  let treeModified = false;
  let failure: ContextFailureCategory | null = null;
  let repairFailure = false;
  const documents = new Map<string, ContextDocument>();
  const rewrittenPartitions = new Set<string>();
  for (const [partitionKey, partition] of partitions) {
    const repair = partition[0].input.kind === 'write';
    const addresses = partition.flatMap((touch) =>
      touch.ranges === 'whole-file'
        ? [touch.repoPath]
        : touch.ranges.map((range) => `${touch.repoPath}#L${range.start}-L${range.end}`)
    );
    if (addresses.length > MAX_CONTEXT_ADDRESSES) {
      failure ??= 'address_limit';
      if (repair) repairFailure = true;
      continue;
    }
    queryCount += 1;
    const result = await executors.context({
      repoRoot: partition[0].repoRoot,
      addresses,
      repair,
      ...(repair
        ? {
            operationId: deterministicOperationId(
              invocationId,
              partition[0].repoRoot,
              normalizedAddressIdentity(partition)
            )
          }
        : {})
    });
    elapsedMs += result.elapsedMs;
    if (!result.ok) {
      failure ??= result.failure;
      if (repair) repairFailure = true;
      continue;
    }
    scopeCount += result.document.scopes.length;
    documents.set(partitionKey, result.document);
    if (repair && result.document.mutation.rewritten) {
      treeModified = true;
      rewrittenPartitions.add(partitionKey);
    }
  }
  for (const touch of prepared) {
    const document = documents.get(touch.partitionKey);
    if (document === undefined) continue;
    const singleTouchMutation =
      (partitions.get(touch.partitionKey)?.length ?? 0) === 1 && rewrittenPartitions.has(touch.partitionKey);
    try {
      const additionalContext = renderContextTouch(touch.input, document, touch.repoPath, touch.ranges, memo);
      if (additionalContext !== null) selectedResultCount += 1;
      outputs[touch.index] = { additionalContext, treeModified: singleTouchMutation };
    } catch {
      outputs[touch.index] = { additionalContext: null, treeModified: singleTouchMutation };
    }
  }
  return {
    outputs,
    treeModified,
    diagnostics: {
      queryCount,
      scopeCount,
      selectedResultCount,
      elapsedMs,
      mutation: treeModified ? 'rewritten' : repairFailure ? 'unknown' : 'unchanged',
      failure
    }
  };
}

export async function runTouchHook(
  input: TouchInput,
  executors: TouchExecutors,
  memo: MemoStore,
  probeCache?: RealityProbeCache
): Promise<TouchOutput> {
  const batch = await runTouchHooks([input], executors, memo, input.invocationId ?? input.sessionId, probeCache);
  return batch.outputs[0];
}

// ---------------------------------------------------------------------------
// Default subprocess-backed executors
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The production execution surface: one strict subprocess-backed context
 * query per repository/mutation partition.
 */
export function createDefaultTouchExecutors(timeoutMs: number = DEFAULT_TIMEOUT_MS): TouchExecutors {
  const executors: TouchExecutors = {
    context: async (request) => {
      const started = performance.now();
      const args = ['span', 'context', ...request.addresses, '--format', 'json'];
      if (request.repair) args.push('--fix', '--operation-id', request.operationId!);
      let stdout: string;
      try {
        stdout = execFileSync('git', args, {
          cwd: request.repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
          maxBuffer: MAX_CONTEXT_JSON_BYTES + 1
        });
      } catch (error) {
        const typed = error as { code?: string; signal?: string; killed?: boolean; stderr?: string | Buffer };
        const stderr = typeof typed.stderr === 'string' ? typed.stderr : typed.stderr?.toString('utf8');
        const failure: ContextFailureCategory =
          typed.code === 'ENOENT' || stderr?.includes('is not a git command') === true
            ? 'command_absent'
            : typed.code === 'ETIMEDOUT' || typed.signal === 'SIGTERM' || typed.killed === true
              ? 'timeout'
              : typed.code === 'ENOBUFS'
                ? 'schema_rejected'
                : 'nonzero_exit';
        return { ok: false, failure, elapsedMs: performance.now() - started };
      }
      if (stdout.trim().length === 0) {
        return { ok: false, failure: 'empty_output', elapsedMs: performance.now() - started };
      }
      try {
        JSON.parse(stdout);
      } catch {
        return { ok: false, failure: 'malformed_json', elapsedMs: performance.now() - started };
      }
      try {
        const document = decodeContextDocument(stdout);
        if (document.mutation.requested !== request.repair || (document.mutation.rewritten && !request.repair)) {
          throw new Error('context mutation does not match the requested mode');
        }
        return { ok: true, document, elapsedMs: performance.now() - started };
      } catch {
        return { ok: false, failure: 'schema_rejected', elapsedMs: performance.now() - started };
      }
    },
    forInvocation: () => executors
  };
  return executors;
}
