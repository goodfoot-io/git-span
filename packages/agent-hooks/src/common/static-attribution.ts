/**
 * Public contracts for the layered static-intent attribution pipeline.
 *
 * Recognizers land incrementally, but the shared diagnostics, tracked-file
 * eligibility, and bounded pre-tool plan store are usable by every producer.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import {
  isGitIgnored,
  isInsideSpanRoot,
  type LineRange,
  relativeToRepo,
  resolveRepoRoot,
  resolveSpanRoot,
  sanitizeSessionId,
  toPosix
} from './agent-hooks-common.js';
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
  return {
    resolvedReads: 0,
    resolvedWrites: 0,
    unresolvedByIdiom: {},
    unresolvedByReason: {},
    scopeDrops: 0,
    trackedDrops: 0,
    executionGateDrops: 0,
    parserLatencyMs: 0,
    touchLatencyMs: 0,
    subprocessCount: 0,
    dependencyContextSurfaced: false
  };
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
export function createPlannedTouchStore(baseDir: string, budgets: PlannedTouchBudgets): PlannedTouchStore {
  validateBudgets(budgets);
  if (baseDir.length === 0) throw new Error('planned-touch base directory must not be empty');

  const recordPaths = (sessionId: string, toolUseId: string): { dir: string; record: string; consumed: string } => {
    if (sessionId.length === 0 || toolUseId.length === 0) {
      throw new Error('planned-touch session and tool-use ids must not be empty');
    }
    const dir = nodePath.join(baseDir, sanitizeSessionId(sessionId), 'planned-touches');
    const stem = sanitizeSessionId(toolUseId);
    return {
      dir,
      record: nodePath.join(dir, `${stem}.json`),
      consumed: nodePath.join(dir, `${stem}.consumed`)
    };
  };

  const makeRestrictiveDir = (dir: string): void => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(baseDir, 0o700);
    fs.chmodSync(nodePath.dirname(dir), 0o700);
    fs.chmodSync(dir, 0o700);
  };

  const claim = (consumed: string): boolean => {
    try {
      fs.writeFileSync(consumed, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  };

  return {
    put(record) {
      const normalized = normalizePlannedTouchRecord(record, budgets);
      const paths = recordPaths(normalized.sessionId, normalized.toolUseId);
      makeRestrictiveDir(paths.dir);
      if (fs.existsSync(paths.consumed)) {
        throw new Error('planned-touch record has already been consumed or discarded');
      }

      const encoded = JSON.stringify(normalized);
      const tmp = nodePath.join(
        paths.dir,
        `.${nodePath.basename(paths.record)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`
      );
      try {
        fs.writeFileSync(tmp, encoded, { encoding: 'utf8', mode: 0o600 });
        fs.chmodSync(tmp, 0o600);
        fs.renameSync(tmp, paths.record);
      } catch (error) {
        fs.rmSync(tmp, { force: true });
        throw error;
      }
    },
    consume(sessionId, toolUseId) {
      const paths = recordPaths(sessionId, toolUseId);
      makeRestrictiveDir(paths.dir);
      if (!claim(paths.consumed)) return null;

      let raw: string;
      try {
        raw = fs.readFileSync(paths.record, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      } finally {
        fs.rmSync(paths.record, { force: true });
      }

      try {
        return normalizePlannedTouchRecord(JSON.parse(raw) as PlannedTouchRecord, budgets);
      } catch {
        return null;
      }
    },
    discard(sessionId, toolUseId) {
      const paths = recordPaths(sessionId, toolUseId);
      makeRestrictiveDir(paths.dir);
      claim(paths.consumed);
      fs.rmSync(paths.record, { force: true });
    }
  };
}

const OPERATIONS: ReadonlySet<Operation> = new Set([
  'read',
  'create-overwrite',
  'append',
  'modify',
  'rename-copy',
  'truncate',
  'delete'
]);

function validateBudgets(budgets: PlannedTouchBudgets): void {
  for (const [name, value] of [
    ['maxTouchesPerRecord', budgets.maxTouchesPerRecord],
    ['maxRangesPerTouch', budgets.maxRangesPerTouch],
    ['maxEvidenceBytes', budgets.maxEvidenceBytes],
    ['maxRecordBytes', budgets.maxRecordBytes]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`planned-touch ${name} must be a non-negative integer`);
  }
}

function validRange(value: unknown): value is LineRange {
  if (typeof value !== 'object' || value === null) return false;
  const range = value as Partial<LineRange>;
  return (
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) &&
    (range.start as number) >= 1 &&
    (range.end as number) >= (range.start as number)
  );
}

function normalizeEvidence(value: PreStateEvidence | undefined): PreStateEvidence | undefined {
  if (value === undefined) return undefined;
  switch (value.kind) {
    case 'literal-occurrences':
      if (
        typeof value.literal !== 'string' ||
        !Array.isArray(value.ranges) ||
        !value.ranges.every(validRange) ||
        !Number.isSafeInteger(value.expectedCount) ||
        value.expectedCount < 0
      ) {
        throw new Error('invalid literal-occurrences evidence');
      }
      return {
        kind: value.kind,
        literal: value.literal,
        ranges: value.ranges.map(({ start, end }) => ({ start, end })),
        expectedCount: value.expectedCount
      };
    case 'anchor':
      if (typeof value.literal !== 'string' || !Number.isSafeInteger(value.line) || value.line < 1) {
        throw new Error('invalid anchor evidence');
      }
      return { kind: value.kind, literal: value.literal, line: value.line };
    case 'eof':
      if (
        !Number.isSafeInteger(value.line) ||
        value.line < 0 ||
        !Number.isSafeInteger(value.byteLength) ||
        value.byteLength < 0
      ) {
        throw new Error('invalid eof evidence');
      }
      return { kind: value.kind, line: value.line, byteLength: value.byteLength };
    case 'content-digest':
      if (value.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(value.digest) || !validRange(value.range)) {
        throw new Error('invalid content-digest evidence');
      }
      return {
        kind: value.kind,
        algorithm: value.algorithm,
        digest: value.digest,
        range: { start: value.range.start, end: value.range.end }
      };
    case 'tracked':
      if (value.tracked !== true) throw new Error('invalid tracked evidence');
      return { kind: value.kind, tracked: true };
    default:
      throw new Error('invalid planned-touch evidence kind');
  }
}

function normalizePlannedTouchRecord(record: PlannedTouchRecord, budgets: PlannedTouchBudgets): PlannedTouchRecord {
  if (
    typeof record !== 'object' ||
    record === null ||
    record.version !== 1 ||
    typeof record.sessionId !== 'string' ||
    record.sessionId.length === 0 ||
    typeof record.toolUseId !== 'string' ||
    record.toolUseId.length === 0 ||
    typeof record.repoRoot !== 'string' ||
    record.repoRoot.length === 0 ||
    !Number.isFinite(record.createdAtMs) ||
    record.createdAtMs < 0 ||
    !Array.isArray(record.touches)
  ) {
    throw new Error('invalid planned-touch record');
  }
  const repoRoot = toPosix(record.repoRoot);
  if (!nodePath.isAbsolute(record.repoRoot) && !/^[A-Za-z]:\//.test(repoRoot)) {
    throw new Error('planned-touch repository root must be absolute');
  }
  if (record.touches.length > budgets.maxTouchesPerRecord) {
    throw new Error('planned-touch record exceeds touch budget');
  }

  let evidenceBytes = 0;
  const touches = record.touches.map((touch): PlannedTouch => {
    if (typeof touch !== 'object' || touch === null) throw new Error('invalid planned touch');
    const repoRelativePath = toPosix(touch.repoRelativePath);
    if (
      repoRelativePath.length === 0 ||
      repoRelativePath.startsWith('/') ||
      /^[A-Za-z]:\//.test(repoRelativePath) ||
      repoRelativePath.split('/').some((part) => part === '..')
    ) {
      throw new Error('planned-touch path must be repository-relative');
    }
    if (!OPERATIONS.has(touch.operation)) throw new Error('invalid planned-touch operation');
    if (!Array.isArray(touch.ranges) || touch.ranges.length > budgets.maxRangesPerTouch) {
      throw new Error('planned touch exceeds range budget');
    }
    if (!touch.ranges.every(validRange)) throw new Error('invalid planned-touch range');
    if (!Number.isSafeInteger(touch.simpleCommandIndex) || touch.simpleCommandIndex < 0) {
      throw new Error('invalid planned-touch command index');
    }
    const evidence = normalizeEvidence(touch.evidence);
    if (evidence !== undefined) evidenceBytes += Buffer.byteLength(JSON.stringify(evidence));
    return {
      repoRelativePath,
      operation: touch.operation,
      ranges: touch.ranges.map((range: LineRange) => ({ start: range.start, end: range.end })),
      simpleCommandIndex: touch.simpleCommandIndex,
      ...(evidence === undefined ? {} : { evidence })
    };
  });
  if (evidenceBytes > budgets.maxEvidenceBytes) throw new Error('planned-touch record exceeds evidence budget');

  const normalized: PlannedTouchRecord = {
    version: 1,
    sessionId: record.sessionId,
    toolUseId: record.toolUseId,
    repoRoot,
    createdAtMs: record.createdAtMs,
    touches
  };
  if (Buffer.byteLength(JSON.stringify(normalized)) > budgets.maxRecordBytes) {
    throw new Error('planned-touch record exceeds byte budget');
  }
  return normalized;
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
  readonly queryTrackedFiles?: TrackedFilesQuery;
}

/** Query the index without consulting the working tree or untracked files. */
export const queryTrackedFiles: TrackedFilesQuery = (repoRoot, repoRelativePaths) => {
  if (repoRelativePaths.length === 0) return new Set();
  const stdout = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z', '--cached', '--', ...repoRelativePaths], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return new Set(
    stdout
      .split('\0')
      .filter((path) => path.length > 0)
      .map(toPosix)
  );
};

/** Filter all candidates in repository batches, preserving their original payloads and order. */
export function filterTrackedEligibility<T>(
  candidates: readonly TrackedEligibilityCandidate<T>[],
  options: TrackedEligibilityOptions
): TrackedEligibilityResult<T> {
  const eligible: TrackedEligibilityCandidate<T>[] = [];
  const dropped: TrackedEligibilityDrop<T>[] = [];
  const cwdRepoRoot = resolveRepoRoot(options.cwd);
  if (cwdRepoRoot === null) {
    return {
      eligible,
      dropped: candidates.map((candidate) => ({ candidate, reason: 'outside-repository' })),
      subprocessCount: 0
    };
  }

  const repoByDirectory = new Map<string, string | null>();
  const inScope: Array<{ candidate: TrackedEligibilityCandidate<T>; repoRoot: string; repoRelativePath: string }> = [];
  const spanRoot = resolveSpanRoot(cwdRepoRoot);
  for (const candidate of candidates) {
    const directory = toPosix(nodePath.dirname(candidate.absolutePath));
    let fileRepoRoot = repoByDirectory.get(directory);
    if (fileRepoRoot === undefined) {
      fileRepoRoot = resolveRepoRoot(directory);
      repoByDirectory.set(directory, fileRepoRoot);
    }
    if (fileRepoRoot !== cwdRepoRoot) {
      dropped.push({ candidate, reason: 'outside-repository' });
      continue;
    }
    const repoRelativePath = relativeToRepo(cwdRepoRoot, candidate.absolutePath);
    if (isGitIgnored(cwdRepoRoot, repoRelativePath)) {
      dropped.push({ candidate, reason: 'ignored-path' });
      continue;
    }
    if (isInsideSpanRoot(repoRelativePath, spanRoot)) {
      dropped.push({ candidate, reason: 'span-metadata-path' });
      continue;
    }
    inScope.push({ candidate, repoRoot: cwdRepoRoot, repoRelativePath });
  }

  const byRepo = new Map<string, typeof inScope>();
  for (const scoped of inScope) {
    const group = byRepo.get(scoped.repoRoot) ?? [];
    group.push(scoped);
    byRepo.set(scoped.repoRoot, group);
  }

  let subprocessCount = 0;
  const query = options.queryTrackedFiles ?? queryTrackedFiles;
  for (const [repoRoot, group] of byRepo) {
    const paths = [...new Set(group.map(({ repoRelativePath }) => repoRelativePath))];
    let tracked: ReadonlySet<string>;
    subprocessCount += 1;
    try {
      tracked = query(repoRoot, paths);
    } catch {
      tracked = new Set();
    }
    const normalizedTracked = new Set([...tracked].map(toPosix));
    for (const scoped of group) {
      if (normalizedTracked.has(scoped.repoRelativePath)) eligible.push(scoped.candidate);
      else dropped.push({ candidate: scoped.candidate, reason: 'untracked-path' });
    }
  }

  const candidateOrder = new Map(candidates.map((candidate, index) => [candidate, index]));
  eligible.sort((left, right) => (candidateOrder.get(left) ?? 0) - (candidateOrder.get(right) ?? 0));
  dropped.sort((left, right) => (candidateOrder.get(left.candidate) ?? 0) - (candidateOrder.get(right.candidate) ?? 0));
  return { eligible, dropped, subprocessCount };
}
