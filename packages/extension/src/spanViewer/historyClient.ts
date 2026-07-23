/**
 * Pure JSON-to-typed-document mapping for `git span history --format json`
 * stdout. Does not invoke the CLI -- spawning `git-span history` is
 * integration-layer work reusing `runGitSpanCommand`, added in a later group.
 *
 * @summary Validates and maps `git span history --format json` stdout.
 * @module spanViewer/historyClient
 */

import type { CurrentAnchor, HistoryCommit, HistoryDocument, TimelineAnchor } from './types.js';

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

function mapTimelineAnchor(raw: unknown, context: string): TimelineAnchor {
  if (!isRecord(raw)) {
    throw new HistoryFormatError(`${context}: expected an anchor object`);
  }
  const path = raw['path'];
  const event = raw['event'];
  if (typeof path !== 'string') {
    throw new HistoryFormatError(`${context}: missing or invalid "path"`);
  }
  if (event !== 'added' && event !== 'modified' && event !== 'removed') {
    throw new HistoryFormatError(`${context}: missing or invalid "event"`);
  }
  const content = raw['content'];
  if (content !== undefined && typeof content !== 'string') {
    throw new HistoryFormatError(`${context}: "content" must be a string when present`);
  }
  return content === undefined ? { path, event } : { path, event, content };
}

function mapHistoryCommit(raw: unknown, index: number): HistoryCommit {
  if (!isRecord(raw)) {
    throw new HistoryFormatError(`commits[${index}]: expected a commit object`);
  }
  const hash = raw['hash'];
  const date = raw['date'];
  const summary = raw['summary'];
  const why = raw['why'];
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
  if (why !== undefined && typeof why !== 'string') {
    throw new HistoryFormatError(`commits[${index}]: "why" must be a string when present`);
  }
  if (!Array.isArray(anchors)) {
    throw new HistoryFormatError(`commits[${index}]: missing or invalid "anchors"`);
  }
  const mappedAnchors = anchors.map((anchor, anchorIndex) =>
    mapTimelineAnchor(anchor, `commits[${index}].anchors[${anchorIndex}]`)
  );
  return why === undefined
    ? { hash, date, summary, anchors: mappedAnchors }
    : { hash, date, summary, why, anchors: mappedAnchors };
}

function mapCurrentAnchor(raw: unknown, index: number): CurrentAnchor {
  if (!isRecord(raw)) {
    throw new HistoryFormatError(`current.anchors[${index}]: expected an anchor object`);
  }
  const path = raw['path'];
  const status = raw['status'];
  const content = raw['content'];
  if (typeof path !== 'string') {
    throw new HistoryFormatError(`current.anchors[${index}]: missing or invalid "path"`);
  }
  if (typeof status !== 'string') {
    throw new HistoryFormatError(`current.anchors[${index}]: missing or invalid "status"`);
  }
  if (typeof content !== 'string') {
    throw new HistoryFormatError(`current.anchors[${index}]: missing or invalid "content"`);
  }
  return { path, status, content };
}

/**
 * Parse and validate `git span history --format json` stdout into a typed
 * `HistoryDocument`.
 *
 * @param stdout - Raw CLI stdout.
 * @returns The mapped, camelCase history document.
 * @throws {HistoryFormatError} When `stdout` is not parseable JSON, when
 *   `schema_version !== 1`, or when required keys are missing.
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
  if (schemaVersion !== 1) {
    throw new HistoryFormatError(`unsupported schema_version: ${JSON.stringify(schemaVersion)}`);
  }

  const span = parsed['span'];
  if (typeof span !== 'string') {
    throw new HistoryFormatError('missing or invalid "span"');
  }

  const commits = parsed['commits'];
  if (!Array.isArray(commits)) {
    throw new HistoryFormatError('missing or invalid "commits"');
  }
  const mappedCommits = commits.map((commit, index) => mapHistoryCommit(commit, index));

  const current = parsed['current'];
  if (current === undefined) {
    return { schemaVersion, span, commits: mappedCommits };
  }
  if (!isRecord(current)) {
    throw new HistoryFormatError('"current" must be an object when present');
  }
  const currentAnchors = current['anchors'];
  if (!Array.isArray(currentAnchors)) {
    throw new HistoryFormatError('"current.anchors" must be an array');
  }
  return {
    schemaVersion,
    span,
    commits: mappedCommits,
    current: { anchors: currentAnchors.map((anchor, index) => mapCurrentAnchor(anchor, index)) }
  };
}
