/**
 * Pure JSON-to-typed-document mapping for `git span history --format json`
 * stdout. Does not invoke the CLI -- spawning `git-span history` is
 * integration-layer work reusing `runGitSpanCommand`, added in a later group.
 *
 * Validates schema v2 (`schema_version: 2`) with no v1 fallback: every field
 * is checked per key, and the cross-field presence rules the v2 contract
 * states are enforced here so downstream consumers can rely on them without
 * re-checking (a timeline anchor carries exactly one of `content`/`diff`; a
 * `current` anchor carries `content` exactly when `unavailable` is absent).
 *
 * @summary Validates and maps `git span history --format json` stdout.
 * @module spanViewer/historyClient
 */

import type {
  CurrentAnchor,
  CurrentUnavailableReason,
  DriftSource,
  HistoryCommit,
  HistoryDocument,
  ReboundTransition,
  TimelineAnchor,
  TimelineUnavailableReason
} from './types.js';

/** Thrown when history stdout is not valid JSON or does not match the expected schema. */
export class HistoryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryFormatError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TIMELINE_UNAVAILABLE_REASONS: readonly TimelineUnavailableReason[] = ['absent', 'range-past-eof', 'binary'];
const CURRENT_UNAVAILABLE_REASONS: readonly CurrentUnavailableReason[] = [
  ...TIMELINE_UNAVAILABLE_REASONS,
  'filter-failed'
];
const DRIFT_SOURCES: readonly DriftSource[] = ['HEAD', 'INDEX', 'WORKTREE'];

function readRebound(raw: Record<string, unknown>, context: string): ReboundTransition | undefined {
  const rebound = raw['rebound'];
  if (rebound === undefined) {
    return undefined;
  }
  if (!isRecord(rebound)) {
    throw new HistoryFormatError(`${context}: "rebound" must be an object when present`);
  }
  const from = rebound['from'];
  const to = rebound['to'];
  if (typeof from !== 'string') {
    throw new HistoryFormatError(`${context}: "rebound" is missing or has an invalid "from"`);
  }
  if (typeof to !== 'string') {
    throw new HistoryFormatError(`${context}: "rebound" is missing or has an invalid "to"`);
  }
  return { from, to };
}

function mapTimelineAnchor(raw: unknown, context: string): TimelineAnchor {
  if (!isRecord(raw)) {
    throw new HistoryFormatError(`${context}: expected an anchor object`);
  }
  const path = raw['path'];
  if (typeof path !== 'string') {
    throw new HistoryFormatError(`${context}: missing or invalid "path"`);
  }

  const content = raw['content'];
  if (content !== undefined && typeof content !== 'string') {
    throw new HistoryFormatError(`${context}: "content" must be a string when present`);
  }
  const diff = raw['diff'];
  if (diff !== undefined && typeof diff !== 'string') {
    throw new HistoryFormatError(`${context}: "diff" must be a string when present`);
  }
  const hasContent = content !== undefined;
  const hasDiff = diff !== undefined;
  if (hasContent === hasDiff) {
    throw new HistoryFormatError(
      `${context}: exactly one of "content" or "diff" must be present (got ${hasContent ? 'both' : 'neither'})`
    );
  }

  const unavailable = raw['unavailable'];
  if (unavailable !== undefined) {
    if (!TIMELINE_UNAVAILABLE_REASONS.includes(unavailable as TimelineUnavailableReason)) {
      throw new HistoryFormatError(
        `${context}: invalid "unavailable" value ${JSON.stringify(unavailable)} (timeline allows ` +
          `${TIMELINE_UNAVAILABLE_REASONS.map((value) => JSON.stringify(value)).join(', ')})`
      );
    }
    if (hasContent) {
      throw new HistoryFormatError(`${context}: "unavailable" never co-occurs with "content"`);
    }
  }
  const rebound = readRebound(raw, context);
  if (rebound !== undefined && hasContent) {
    throw new HistoryFormatError(`${context}: "rebound" never co-occurs with "content"`);
  }

  const anchor: TimelineAnchor = { path };
  if (hasContent) {
    anchor.content = content;
  }
  if (hasDiff) {
    anchor.diff = diff;
  }
  if (unavailable !== undefined) {
    anchor.unavailable = unavailable as TimelineUnavailableReason;
  }
  if (rebound !== undefined) {
    anchor.rebound = rebound;
  }
  return anchor;
}

function mapHistoryCommit(raw: unknown, index: number): HistoryCommit {
  if (!isRecord(raw)) {
    throw new HistoryFormatError(`commits[${index}]: expected a commit object`);
  }
  const hash = raw['hash'];
  const date = raw['date'];
  const summary = raw['summary'];
  const spanDiff = raw['span_diff'];
  const anchors = raw['anchors'];
  if (typeof hash !== 'string') {
    throw new HistoryFormatError(`commits[${index}]: missing or invalid "hash"`);
  }
  if (typeof date !== 'string') {
    throw new HistoryFormatError(`commits[${index}]: missing or invalid "date"`);
  }
  if (typeof summary !== 'string') {
    throw new HistoryFormatError(`commits[${index}]: missing or invalid "summary"`);
  }
  if (spanDiff !== undefined && typeof spanDiff !== 'string') {
    throw new HistoryFormatError(`commits[${index}]: "span_diff" must be a string when present`);
  }
  if (!Array.isArray(anchors)) {
    throw new HistoryFormatError(`commits[${index}]: missing or invalid "anchors"`);
  }
  const mappedAnchors = anchors.map((anchor, anchorIndex) =>
    mapTimelineAnchor(anchor, `commits[${index}].anchors[${anchorIndex}]`)
  );
  const commit: HistoryCommit = { hash, date, summary, anchors: mappedAnchors };
  if (spanDiff !== undefined) {
    commit.span_diff = spanDiff;
  }
  return commit;
}

function mapCurrentAnchor(raw: unknown, index: number): CurrentAnchor {
  if (!isRecord(raw)) {
    throw new HistoryFormatError(`current.anchors[${index}]: expected an anchor object`);
  }
  const path = raw['path'];
  const diff = raw['diff'];
  if (typeof path !== 'string') {
    throw new HistoryFormatError(`current.anchors[${index}]: missing or invalid "path"`);
  }
  if (typeof diff !== 'string') {
    throw new HistoryFormatError(`current.anchors[${index}]: missing or invalid "diff"`);
  }

  const content = raw['content'];
  if (content !== undefined && typeof content !== 'string') {
    throw new HistoryFormatError(`current.anchors[${index}]: "content" must be a string when present`);
  }
  const unavailable = raw['unavailable'];
  if (unavailable !== undefined) {
    if (!CURRENT_UNAVAILABLE_REASONS.includes(unavailable as CurrentUnavailableReason)) {
      throw new HistoryFormatError(
        `current.anchors[${index}]: invalid "unavailable" value ${JSON.stringify(unavailable)} (current allows ` +
          `${CURRENT_UNAVAILABLE_REASONS.map((value) => JSON.stringify(value)).join(', ')})`
      );
    }
  }
  const hasContent = content !== undefined;
  const hasUnavailable = unavailable !== undefined;
  if (hasContent === hasUnavailable) {
    throw new HistoryFormatError(
      `current.anchors[${index}]: exactly one of "content" or "unavailable" must be present ` +
        `(got ${hasContent ? 'both' : 'neither'})`
    );
  }

  const proposed = raw['proposed'];
  if (proposed !== undefined && typeof proposed !== 'string') {
    throw new HistoryFormatError(`current.anchors[${index}]: "proposed" must be a string when present`);
  }
  const recorded = raw['recorded'];
  if (recorded !== undefined && recorded !== 'unrecoverable') {
    throw new HistoryFormatError(
      `current.anchors[${index}]: invalid "recorded" value ${JSON.stringify(recorded)} (only "unrecoverable" is valid)`
    );
  }
  const sources = raw['sources'];
  if (sources !== undefined) {
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new HistoryFormatError(
        `current.anchors[${index}]: "sources" must be a non-empty array when present (never emitted as [])`
      );
    }
    for (const source of sources) {
      if (!DRIFT_SOURCES.includes(source as DriftSource)) {
        throw new HistoryFormatError(
          `current.anchors[${index}]: invalid "sources" entry ${JSON.stringify(source)} ` +
            `(${DRIFT_SOURCES.map((value) => JSON.stringify(value)).join(', ')})`
        );
      }
    }
  }

  const anchor: CurrentAnchor = { path, diff };
  if (hasContent) {
    anchor.content = content;
  }
  if (hasUnavailable) {
    anchor.unavailable = unavailable as CurrentUnavailableReason;
  }
  if (proposed !== undefined) {
    anchor.proposed = proposed;
  }
  if (recorded !== undefined) {
    anchor.recorded = recorded;
  }
  if (sources !== undefined) {
    anchor.sources = sources as DriftSource[];
  }
  return anchor;
}

/**
 * Parse and validate `git span history --format json` stdout into a typed
 * `HistoryDocument`.
 *
 * @param stdout - Raw CLI stdout.
 * @returns The mapped, camelCase history document.
 * @throws {HistoryFormatError} When `stdout` is not parseable JSON, when
 *   `schema_version !== 2`, or when required keys are missing or a cross-field
 *   presence rule is violated.
 */
export function parseHistoryJson(stdout: string): HistoryDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new HistoryFormatError(
      `history stdout is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!isRecord(parsed)) {
    throw new HistoryFormatError('history document must be a JSON object');
  }

  const schemaVersion = parsed['schema_version'];
  if (schemaVersion !== 2) {
    throw new HistoryFormatError(`unsupported schema_version: ${JSON.stringify(schemaVersion)} (expected 2)`);
  }

  const span = parsed['span'];
  if (typeof span !== 'string') {
    throw new HistoryFormatError('missing or invalid "span"');
  }

  const scoped = parsed['scoped'];
  if (scoped !== undefined && typeof scoped !== 'boolean') {
    throw new HistoryFormatError('"scoped" must be a boolean when present');
  }

  const commits = parsed['commits'];
  if (!Array.isArray(commits)) {
    throw new HistoryFormatError('missing or invalid "commits"');
  }
  const mappedCommits = commits.map((commit, index) => mapHistoryCommit(commit, index));

  const document: HistoryDocument = { schemaVersion, span, commits: mappedCommits };
  if (scoped !== undefined) {
    document.scoped = scoped;
  }

  const current = parsed['current'];
  if (current === undefined) {
    return document;
  }
  if (!isRecord(current)) {
    throw new HistoryFormatError('"current" must be an object when present');
  }
  const currentSpanDiff = current['span_diff'];
  if (currentSpanDiff !== undefined && typeof currentSpanDiff !== 'string') {
    throw new HistoryFormatError('"current.span_diff" must be a string when present');
  }
  const currentAnchors = current['anchors'];
  if (!Array.isArray(currentAnchors)) {
    throw new HistoryFormatError('"current.anchors" must be an array');
  }
  const mappedCurrent: HistoryDocument['current'] = {
    anchors: currentAnchors.map((anchor, index) => mapCurrentAnchor(anchor, index))
  };
  if (currentSpanDiff !== undefined) {
    mappedCurrent.span_diff = currentSpanDiff;
  }
  document.current = mappedCurrent;
  return document;
}
