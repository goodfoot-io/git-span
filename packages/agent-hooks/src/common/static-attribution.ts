/**
 * Public contracts for the layered static-intent attribution pipeline.
 *
 * This module is intentionally a TDD bootstrap: the exported functions have
 * their final consumer-facing signatures but do not implement behavior yet.
 * Later phases replace each `Not Implemented` sentinel as its skipped
 * acceptance checks are enabled.
 */

import type { LineRange } from './agent-hooks-common.js';
import type { Operation, ParseOptions, ResolvedSpan } from './parse-command.js';

/** Stable machine-readable classifications for candidates the parser refuses. */
export const UNRESOLVED_REASON_CODES = [
  'dynamic-path',
  'dynamic-list',
  'glob-path',
  'command-substitution',
  'candidate-budget-exceeded',
  'unsupported-expression',
  'unsupported-syntax',
  'unsupported-dataflow',
  'unsupported-encoding',
  'binary-content',
  'missing-pre-state',
  'unreadable-pre-state',
  'evidence-mismatch',
  'history-operation',
  'generator-operation',
  'outside-repository',
  'ignored-path',
  'span-metadata-path',
  'untracked-path'
] as const;

export type UnresolvedReasonCode = (typeof UNRESOLVED_REASON_CODES)[number];

/** The bounded recognizer layer that produced or rejected a candidate. */
export type AttributionLayer = 'shell' | 'literal-loop' | 'pattern-substitution' | 'python' | 'node';

/** A resolved operation with the recognizer identity retained for diagnostics. */
export interface LayeredResolvedMatch {
  readonly status: 'resolved';
  readonly layer: AttributionLayer;
  readonly idiom: string;
  readonly span: ResolvedSpan;
}

/** A fail-closed candidate. `detail` is for logs; callers branch only on `reasonCode`. */
export interface UnresolvedAttribution {
  readonly status: 'unresolved';
  readonly layer: AttributionLayer;
  readonly idiom: string;
  readonly reasonCode: UnresolvedReasonCode;
  readonly fileArg?: string;
  readonly simpleCommandIndex?: number;
  readonly detail?: string;
}

/** Why post-tool attribution needs a small piece of pre-command state. */
export type PreStateRequirement = 'match-locations' | 'deleted-text' | 'pre-command-eof' | 'pre-tracked';

/** A candidate whose precision or eligibility must be captured before execution. */
export interface PreStateRequest {
  readonly absolutePath: string;
  readonly operation: Operation;
  readonly requirement: PreStateRequirement;
  readonly simpleCommandIndex: number;
}

/** One complete parse, including explicit refusals and pre-state needs. */
export interface LayeredParseResult {
  readonly resolved: readonly LayeredResolvedMatch[];
  readonly unresolved: readonly UnresolvedAttribution[];
  readonly preStateRequests: readonly PreStateRequest[];
}

export interface LayeredParseOptions extends ParseOptions {
  /** Safety budget applied before expansion; exceeding it rejects the whole bounded set. */
  readonly maxCandidates?: number;
  /** Ephemeral pre-command text lookup. File bodies are never persisted in a plan. */
  readonly readPreState?: (absolutePath: string) => string | null;
}

/** Parse explicit authoring intent through deterministic and bounded recognizers. */
export function parseCommandLayered(_command: string, _options: LayeredParseOptions = {}): LayeredParseResult {
  throw new Error('Not Implemented');
}

/** Aggregate counters emitted once per tool invocation and never sent to the model. */
export interface AttributionDiagnostics {
  readonly resolvedReads: number;
  readonly resolvedWrites: number;
  readonly unresolvedByIdiom: Readonly<Record<string, number>>;
  readonly unresolvedByReason: Readonly<Partial<Record<UnresolvedReasonCode, number>>>;
  readonly scopeDrops: number;
  readonly trackedDrops: number;
  readonly executionGateDrops: number;
  readonly parserLatencyMs: number;
  readonly touchLatencyMs: number;
  readonly subprocessCount: number;
  readonly dependencyContextSurfaced: boolean;
}

/** Create the zero-valued diagnostic accumulator for one invocation. */
export function createAttributionDiagnostics(): AttributionDiagnostics {
  throw new Error('Not Implemented');
}

/** Bounded evidence sufficient to verify a planned range without retaining a file body. */
export type PreStateEvidence =
  | {
      readonly kind: 'literal-occurrences';
      readonly literal: string;
      readonly ranges: readonly LineRange[];
      readonly expectedCount: number;
    }
  | {
      readonly kind: 'anchor';
      readonly literal: string;
      readonly line: number;
    }
  | {
      readonly kind: 'eof';
      readonly line: number;
      readonly byteLength: number;
    }
  | {
      readonly kind: 'content-digest';
      readonly algorithm: 'sha256';
      readonly digest: string;
      readonly range: LineRange;
    }
  | {
      readonly kind: 'tracked';
      readonly tracked: true;
    };

/** A single tracked repository-relative operation retained across a tool call. */
export interface PlannedTouch {
  readonly repoRelativePath: string;
  readonly operation: Operation;
  readonly ranges: readonly LineRange[];
  readonly simpleCommandIndex: number;
  readonly evidence?: PreStateEvidence;
}

/** Content-minimal, versioned record keyed by session and tool-use id. */
export interface PlannedTouchRecord {
  readonly version: 1;
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly repoRoot: string;
  readonly createdAtMs: number;
  readonly touches: readonly PlannedTouch[];
}

/** Hard limits checked before a record is written; over-budget writes fail closed. */
export interface PlannedTouchBudgets {
  readonly maxTouchesPerRecord: number;
  readonly maxRangesPerTouch: number;
  readonly maxEvidenceBytes: number;
  readonly maxRecordBytes: number;
}

export interface PlannedTouchStore {
  /** Atomically replace the record for its session/tool-use key. */
  put(record: PlannedTouchRecord): void;
  /** Atomically consume the record; repeated consumption returns null. */
  consume(sessionId: string, toolUseId: string): PlannedTouchRecord | null;
  /** Idempotently discard any pending record for failure or interruption cleanup. */
  discard(sessionId: string, toolUseId: string): void;
}

/** Create the bounded disk-backed planned-touch store rooted at `baseDir`. */
export function createPlannedTouchStore(_baseDir: string, _budgets: PlannedTouchBudgets): PlannedTouchStore {
  throw new Error('Not Implemented');
}

/** A path candidate supplied by any command-, response-, or structured-tool producer. */
export interface TrackedEligibilityCandidate<T> {
  readonly absolutePath: string;
  readonly value: T;
}

export type TrackedEligibilityDropReason =
  | 'outside-repository'
  | 'ignored-path'
  | 'span-metadata-path'
  | 'untracked-path';

export interface TrackedEligibilityDrop<T> {
  readonly candidate: TrackedEligibilityCandidate<T>;
  readonly reason: TrackedEligibilityDropReason;
}

export interface TrackedEligibilityResult<T> {
  readonly eligible: readonly TrackedEligibilityCandidate<T>[];
  readonly dropped: readonly TrackedEligibilityDrop<T>[];
  /** Number of `git ls-files` calls; at most one per resolved repository. */
  readonly subprocessCount: number;
}

/** Executes one NUL-delimited tracked-membership query for a repository. */
export type TrackedFilesQuery = (repoRoot: string, repoRelativePaths: readonly string[]) => ReadonlySet<string>;

export interface TrackedEligibilityOptions {
  readonly cwd: string;
  readonly queryTrackedFiles: TrackedFilesQuery;
}

/** Filter all candidates in repository batches, preserving their original payloads and order. */
export function filterTrackedEligibility<T>(
  _candidates: readonly TrackedEligibilityCandidate<T>[],
  _options: TrackedEligibilityOptions
): TrackedEligibilityResult<T> {
  throw new Error('Not Implemented');
}
