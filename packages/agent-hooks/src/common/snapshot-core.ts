/**
 * Harness-agnostic snapshot core (Phase 1 — contract and stubs).
 *
 * This module declares the snapshot-attribution contract for card main-213:
 * when a `Bash` tool call's writes are invisible to static command parsing —
 * formatters, generators, embedded Python/Node/Ruby/Perl scripts, project
 * tools — a per-tool pre/post file snapshot correlated by (session_id,
 * tool_use_id) attributes the writes the call actually produced. The core is
 * pure logic: command classification, line/file hashing, Myers diff over
 * line-hash arrays, hunk→post-range mapping, rename pairing, pre/post
 * comparison, and the concurrency ambiguity rules. No I/O; I/O is injected
 * (the stat/read functions the walkers pass in). It imports nothing from
 * either hook SDK and is typed structurally, per the `common/` layer
 * convention.
 *
 * Every function whose result depends on real logic is a `Not Implemented`
 * stub in this phase; Phase 2 writes skipped checks against these signatures
 * and Phase 3 implements them. The two line-hash budget caps (per-file 4000,
 * per-record 200,000) with the coarse-file fallback are contract decisions —
 * baked into {@link DEFAULT_SNAPSHOT_BUDGETS} exactly as the plan states —
 * as are the touched-files cap (100) and the post-side wall budget (5 s),
 * which together are the PostToolUse timeout detection.
 *
 * Reused from the shared kernel (not redefined): `LineRange` (1-based
 * inclusive line ranges) from agent-hooks-common.ts.
 */

import type { LineRange } from './agent-hooks-common.js';

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/**
 * The snapshot budgets in force for one tool call's pre walk, the post
 * comparison, and the store. Env-var / git-config precedence (mirroring
 * resolveSpanRoot) is resolved before the core sees a budgets value; these
 * are the shipped defaults, per the plan.
 */
export interface SnapshotBudgets {
  /** Tier-2 walk: max files captured per record (default 5000). */
  maxFiles: number;
  /** Per-file byte cap; larger files are excluded, never recorded coarse (default 1 MiB). */
  maxBytesPerFile: number;
  /** Sum of file bytes across one record's pre walk (default 64 MiB). */
  maxTotalBytes: number;
  /** Line-hash cap per file; over it the file is recorded coarse — byte hash only (default 4000). */
  maxLineHashesPerFile: number;
  /**
   * Line-hash cap per record; after it (in deterministic walk order) every
   * remaining file is recorded coarse with a gap diagnostic (default 200,000).
   * Together with the per-file cap this bounds a record's worst-case serialized
   * size so the global storage cap holds several full records.
   */
  maxLineHashesPerRecord: number;
  /** Pre-side max wall seconds for the whole snapshot walk (default 1). */
  preSideMaxWallSeconds: number;
  /**
   * Max storage across all records in the repo. Exhaustion refuses new
   * snapshot writes with a diagnostic — never drop-oldest, because deleting
   * records would silently destroy the ambiguity evidence the concurrency
   * rules depend on (default 64 MiB).
   */
  maxStorageBytes: number;
  /**
   * Touched-files cap per tool call: changed-path count is capped by it;
   * beyond it, coverage-gap diagnostics and no touches (default 100). This cap
   * IS the PostToolUse timeout detection.
   */
  maxTouchedFiles: number;
  /**
   * Post-side wall budget in seconds, checked per scope before any diff/touch
   * work: on exhaustion the comparison stops adding scopes and records a
   * diagnostic naming exactly which paths were attributed and which were not
   * (default 5). This budget IS the PostToolUse timeout detection.
   */
  postSideWallSeconds: number;
  /** Snapshot-record TTL, the crash-recovery backstop (default 24 h). */
  recordTtlMs: number;
  /** Unfinished activity-entry TTL, pruned by the sweep (default 15 min). */
  unfinishedEntryTtlMs: number;
}

/** The shipped budget defaults, exactly as the plan states them. */
export const DEFAULT_SNAPSHOT_BUDGETS: SnapshotBudgets = {
  maxFiles: 5000,
  maxBytesPerFile: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxLineHashesPerFile: 4000,
  maxLineHashesPerRecord: 200_000,
  preSideMaxWallSeconds: 1,
  maxStorageBytes: 64 * 1024 * 1024,
  maxTouchedFiles: 100,
  postSideWallSeconds: 5,
  recordTtlMs: 24 * 60 * 60 * 1000,
  unfinishedEntryTtlMs: 15 * 60 * 1000
};

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

/** The snapshot's tier: explicit targets only, or the repo-wide eligible walk. */
export type SnapshotTier = 'explicit' | 'repo';

/**
 * One file's pre (or post) state in a snapshot record: identity, byte hash +
 * size, and an ordered line-hash array. Line bytes are hashed **including the
 * terminator**, so a missing final newline and CRLF round-trips are
 * distinguishable. `mtimeNs` (BigInt) is the post-side cheap filter: a path
 * whose (size, mtimeNs) both match its pre entry is skipped without a
 * re-read — gated on a non-zero sub-second part, because on second-granularity
 * clocks a same-second write does not advance mtime. `capturedAt` is the
 * instant the pre walk read this file, on the same clock as the record's
 * `createdAt` and the activity log's `finishedAt` — the per-path baseline the
 * interleaved-edit check compares against.
 */
export interface SnapshotFile {
  /** SHA-256 hex of the file bytes. */
  hash: string;
  /** Byte size of the file at capture. */
  size: number;
  /** mtime in nanoseconds (BigInt) at capture. */
  mtimeNs: bigint;
  /** The instant the walk read this file (same clock as createdAt). */
  capturedAt: number;
  /**
   * Ordered line hashes (line bytes hashed including the terminator). Absent
   * when `coarse` — the per-file line cap or the per-record line budget cut
   * in, and the file compares by byte hash only (whole-file scope on change,
   * with a `coarse-scope` diagnostic; range precision is budgeted away,
   * visibly, never claimed).
   */
  lines?: string[];
  /** True when no line hashes were recorded (byte-hash-only comparison). */
  coarse?: boolean;
}

/**
 * One JSON record per tool call, written to
 * `~/.cache/git-span/session/<session>/snapshots/<sanitized-tool_use_id>.json`
 * with 0600 permissions (dirs 0700). `files` holds the pre-state per
 * repo-relative path. Consumption writes `post` (the same per-file shape, for
 * paths that changed), sets `consumed: true`, and stamps `consumedAt` — the
 * ambiguity table's window-overlap rows read it — and the record is then
 * retained until TTL/session-end because later calls' ambiguity checks need
 * its pre/post per-path state. A `version` mismatch on read fails closed
 * (discard + diagnostic).
 */
export interface SnapshotRecord {
  /** Record format version. A mismatch on read fails closed. */
  version: 1;
  sessionId: string;
  toolUseId: string;
  /** Subagent agent id, recorded by the PreToolUse adapters when present. */
  agentId?: string;
  /** Absolute repo root the snapshot was taken in. */
  repoRoot: string;
  /** The instant the record was written (same clock as capturedAt/finishedAt). */
  createdAt: number;
  /** Whether a PostToolUse has consumed this record. */
  consumed: boolean;
  /** Stamped at consumption; null while the record is live. */
  consumedAt: number | null;
  tier: SnapshotTier;
  /**
   * Coverage-gap diagnostics (budget cuts, refusals, comparison stops). The
   * comparison never describes partial coverage as complete; a sibling record
   * carrying gaps is treated as covering every in-scope path for the
   * ambiguity check, because its coverage is unknowable.
   */
  gaps: string[];
  /** Pre-state per repo-relative path. */
  files: Record<string, SnapshotFile>;
  /** Post-state per changed path, written at consumption. */
  post?: Record<string, SnapshotFile>;
}

// ---------------------------------------------------------------------------
// Command classification
// ---------------------------------------------------------------------------

/** The classifier's per-simple-command verdict — the plan's three buckets. */
export type CommandWriteClass = 'read-only' | 'covered-write' | 'opaque';

/**
 * The classifier's decision for the whole command: whether a snapshot record
 * must exist for the Post side to compare against, and why.
 *
 * - `no-snapshot` / `read-only`: no write-capable command — nothing can write.
 * - `no-snapshot` / `statically-covered`: every write is statically covered
 *   and provably expansion-free — exact ranges are already available and
 *   nothing can be missed (the fast-path exception).
 * - `snapshot`: at least one opaque command, alone or mixed with covered
 *   writes — the pre walk must capture the state the Post side compares.
 */
export type SnapshotDecision =
  | { kind: 'no-snapshot'; reason: 'read-only' }
  | { kind: 'no-snapshot'; reason: 'statically-covered' }
  | { kind: 'snapshot'; reason: 'opaque' }
  | { kind: 'snapshot'; reason: 'mixed' };

/**
 * The classifier's plan for a command: the decision plus the tier-1 targets —
 * the parser's resolved paths plus literal redirect targets, the paths the
 * pre walk must capture within budget before any repo-wide tier-2 walk.
 * Empty when the decision is `no-snapshot`.
 */
export interface SnapshotPlan {
  decision: SnapshotDecision;
  /** Absolute tier-1 target paths (parser-resolved + literal redirect targets). */
  tier1Targets: string[];
}

/**
 * Classify a Bash command into a {@link SnapshotPlan}. The SAME classifier
 * runs in both the Pre and Post hooks, so both sides always agree on whether
 * a snapshot should exist; the Post side warns when it concludes a snapshot
 * should have existed but the record is absent.
 *
 * Classification rules (per the plan): tilde, background (`&`), and
 * parser-unresolved globbed/variable targets are opaque; the read-only set is
 * flag- and wrapper-aware (output-targeting flags like `sort -o` disqualify,
 * argument-executing wrappers like `env`/`xargs` are opaque, git write
 * subcommands are never read-only, and git read subcommands are read-only
 * only while no exec channel — GIT_EXTERNAL_DIFF / GIT_PAGER / diff.external /
 * diff.<driver>.textconv|command in env, config, or command text — is open,
 * with `--no-ext-diff`/`--no-textconv` disarming); a covered write is gated
 * on the command being provably expansion-free (single-quoted heredoc
 * delimiters only; `>`/`>>` to a literal path with no unquoted
 * `$`/backtick/command substitution); anything else is opaque.
 */
export function classifyCommandForSnapshot(_command: string, _cwd: string): SnapshotPlan {
  throw new Error('Not Implemented');
}

// ---------------------------------------------------------------------------
// File hashing
// ---------------------------------------------------------------------------

/** The stat fields the snapshot needs from a file (the (size, mtimeNs) pair is the post-side cheap filter). */
export interface FileStat {
  /** Byte size of the file. */
  size: number;
  /** mtime in nanoseconds (BigInt) at capture. */
  mtimeNs: bigint;
}

/** Injected file stat: null when the file is absent or unstat-able. */
export type StatFile = (absPath: string) => FileStat | null;

/** Injected byte read: null when the file is absent or unreadable. */
export type ReadFile = (absPath: string) => Buffer | null;

/** The inputs {@link hashFile} needs; the caller owns the path and clock. */
export interface HashFileInput {
  /** Absolute path of the file to hash. */
  absPath: string;
  /** The clock instant to stamp as the entry's `capturedAt`. */
  now: number;
  /** The budgets in force (per-file byte cap; per-file line cap). */
  budgets: SnapshotBudgets;
  /**
   * Line-hash budget remaining for the record (deterministic walk order): 0
   * forces a coarse entry regardless of the per-file cap.
   */
  remainingLineBudget: number;
  /** Injected stat: null when the file is absent or unstat-able. */
  stat: StatFile;
  /** Injected byte read: null when the file is absent or unreadable. */
  read: ReadFile;
}

/**
 * Hash one file into a snapshot entry — byte hash, size, mtimeNs, and ordered
 * line hashes — or null when the file cannot be read. A file over the
 * per-file line cap (or with no line budget remaining) is recorded coarse
 * (byte hash, size, mtimeNs; no line hashes). A file over the per-file byte
 * cap is excluded (null).
 */
export function hashFile(_input: HashFileInput): SnapshotFile | null {
  throw new Error('Not Implemented');
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * One change region between the pre and post line-hash sequences (the Myers
 * diff's output, O(ND) over the hash arrays). Coordinates are 1-based and
 * inclusive; a hunk with `preLines === 0` is a pure insertion, one with
 * `postLines === 0` is a pure deletion.
 */
export interface DiffHunk {
  /** 1-based first line in the pre sequence; 0 for a pure insertion. */
  preStart: number;
  /** Number of pre lines the hunk covers; 0 for a pure insertion. */
  preLines: number;
  /** 1-based first line in the post sequence; 0 for a pure deletion. */
  postStart: number;
  /** Number of post lines the hunk produces; 0 for a pure deletion. */
  postLines: number;
}

/** The post-state ranges a snapshot comparison observes for one path. */
export interface ObservedWriteRanges {
  /** Post-state 1-based inclusive ranges of inserted/modified lines. */
  changed: LineRange[];
  /** Create / delete / rename / truncation / delete-only hunks — whole-file scope. */
  wholeFile: boolean;
}

/**
 * Myers diff over the pre/post line-hash arrays. Pure function, O(ND).
 */
export function diffLineHashes(_pre: string[], _post: string[]): DiffHunk[] {
  throw new Error('Not Implemented');
}

/**
 * Map diff hunks to post-state ranges: inserted/modified lines become exact
 * post-state ranges; any delete-only hunk (no reliable post-state coordinate
 * for deleted lines) forces whole-file scope.
 */
export function hunksToPostRanges(_hunks: DiffHunk[]): ObservedWriteRanges {
  throw new Error('Not Implemented');
}

// ---------------------------------------------------------------------------
// Rename pairing
// ---------------------------------------------------------------------------

/** A delete+create pair resolved into a rename (identical byte hashes, unique match). */
export interface RenamePair {
  /** Repo-relative pre path. */
  from: string;
  /** Repo-relative post path. */
  to: string;
}

/**
 * Pair rename candidates: pre-absent paths with post-present paths of
 * identical byte hash. Only unique hash matches pair; content ties are left
 * as delete+create.
 */
export function pairRenames(
  _pre: ReadonlyMap<string, SnapshotFile>,
  _post: ReadonlyMap<string, SnapshotFile>
): RenamePair[] {
  throw new Error('Not Implemented');
}

// ---------------------------------------------------------------------------
// Pre/post comparison
// ---------------------------------------------------------------------------

/**
 * What the comparison concluded about one path. `changed` carries the exact
 * post-state ranges; `created`/`deleted`/`rename` are whole-file by nature.
 */
export type PathAttribution =
  | { kind: 'unchanged' }
  | { kind: 'changed'; observed: ObservedWriteRanges }
  | { kind: 'created' }
  | { kind: 'deleted' }
  | { kind: 'rename'; from: string };

/** The inputs {@link compareSnapshot} needs; I/O is injected. */
export interface CompareSnapshotInput {
  /** The pre record written at PreToolUse (files, coverage gaps, identity). */
  record: SnapshotRecord;
  /** The post walk's per-path state, keyed by repo-relative path. */
  post: ReadonlyMap<string, SnapshotFile>;
  /** The post walk's coverage gaps (a path-coverage gap disqualifies delete candidates). */
  postGaps: string[];
  /** The budgets in force (post-side wall budget; touched-files cap). */
  budgets: SnapshotBudgets;
  /** Injected stat: null when a path is absent. */
  stat: StatFile;
  /** Injected byte read: null when a path is absent/unreadable. */
  read: ReadFile;
  /** The current clock instant, for the post-side wall budget. */
  now: number;
}

/** The comparison's outcome: per-path attributions plus coverage diagnostics. */
export interface CompareSnapshotResult {
  /**
   * Attribution per path, keyed by repo-relative path. Unchanged paths are
   * omitted; every path outside the pre/post coverage intersection is
   * dropped with a diagnostic, never attributed.
   */
  attributions: Map<string, PathAttribution>;
  /**
   * Diagnostics: dropped paths and their reasons (coverage-intersection
   * gaps, interleaved-tool verdicts live in the ambiguity pass), `coarse-scope`
   * notes, zero-hunk collision notes, and budget-stop notes naming exactly
   * which paths were attributed and which were not.
   */
  gaps: string[];
}

/**
 * Compare the pre record against the post walk. For each pre-recorded path:
 * absent → delete candidate; (size, mtimeNs) both matching its pre entry
 * (with a non-zero sub-second mtimeNs part — second-granularity clocks are
 * never trusted to prove non-change) → unchanged, no re-read; else re-read
 * and byte-hash: equal → unchanged (chmod/mtime-only noise), differing →
 * changed. Post-only paths are create candidates only when the pre record
 * reports no path-coverage gap (a coarse pre entry still records the file, so
 * it does not disqualify); pre-only paths are delete candidates only when the
 * post walk's coverage is complete. Rename candidates pair pre-absent /
 * post-present paths with identical byte hashes. Changed files diff over
 * their line-hash arrays (line-hash collision → zero hunks → whole-file +
 * diagnostic, so a hash collision can never silently shrink attribution);
 * changed coarse files degrade to whole-file scope with a `coarse-scope`
 * diagnostic. The post-side wall budget is checked per scope before any
 * diff/touch work; on exhaustion the comparison stops adding scopes and
 * records a diagnostic. The changed-path count is capped by
 * `budgets.maxTouchedFiles`; beyond it, coverage-gap diagnostics and no
 * touches.
 */
export function compareSnapshot(_input: CompareSnapshotInput): CompareSnapshotResult {
  throw new Error('Not Implemented');
}

// ---------------------------------------------------------------------------
// Concurrency ambiguity rules
// ---------------------------------------------------------------------------

/**
 * A sibling record's per-path state for the ambiguity check — the minimal
 * view the table reads: record identity, consumption, and its pre/post state
 * for the path in question.
 */
export interface SiblingSnapshot {
  sessionId: string;
  toolUseId: string;
  /** The instant its pre walk wrote the record. */
  createdAt: number;
  consumed: boolean;
  /** Its consumption instant; null while live. */
  consumedAt: number | null;
  /**
   * True when the sibling record carries a path-coverage gap: its coverage is
   * unknowable, so overlap must be assumed — a gapped unconsumed sibling
   * makes every changed path ambiguous.
   */
  coverageGap: boolean;
  /** Its pre-state for the path, or null when its coverage excluded the path. */
  pre: SnapshotFile | null;
  /** Its post-state for the path, or null when it consumed without changing it. */
  post: SnapshotFile | null;
}

/**
 * The table's verdict for one changed path against one sibling, top-down;
 * the first matching row decides (see the plan's ambiguity table). Any
 * ambiguous sibling makes the path ambiguous — the path is dropped whole,
 * before any diff or range work.
 */
export type AmbiguityVerdict = { ambiguous: false } | { ambiguous: true; reason: string; siblingToolUseId: string };

/**
 * The concurrency ambiguity check for one changed path P (my pre ≠ now):
 * inspect the siblings covering P, ordered by createdAt (ties broken by
 * toolUseId — fully deterministic, so every consumer of an entangled path
 * evaluates the same sibling set in the same order and reaches the same
 * verdict), and read the table top-down per sibling:
 *
 * - unconsumed (before or after mine) → ambiguous — its write window has not
 *   provably ended, regardless of pre order or pre equality.
 * - consumed, created after mine: post(P) ≠ pre(P) → ambiguous; post(P) =
 *   pre(P) → not ambiguous.
 * - consumed, created before mine: pre(P) = post(P) → not ambiguous (it never
 *   changed P); post(P) = my pre(P) → not ambiguous (its write provably
 *   landed before my baseline); pre(P) ≠ post(P) and consumedAt ≤ my
 *   createdAt → not ambiguous (its whole window ended before my baseline);
 *   pre(P) ≠ post(P) and consumedAt > my createdAt → ambiguous (it changed P
 *   in a window that extends past my baseline).
 *
 * A gapped unconsumed sibling covers every path (coverageGap), closing the
 * "truncated sibling becomes invisible" hole.
 */
export function applyAmbiguityRules(
  _mine: SnapshotRecord,
  _siblings: SiblingSnapshot[],
  _path: string
): AmbiguityVerdict {
  throw new Error('Not Implemented');
}
