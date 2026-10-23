/** Complete, read-only current context for an immutable inspected commit set. */

import type { GitSpanCommand } from './git-span-command.js';
import type { ContextSpan } from './touch-core.js';

/** Native envelope; commit selection never invents ordinary address scopes. */
export interface CommitInspectionContextDocument {
  schema_version: 1;
  commits: string[];
  spans: ContextSpan[];
}

/** One native request, bounded by the enclosing inspection driver's remaining time. */
export interface CommitInspectionContextRequest {
  repoRoot: string;
  commits: readonly string[];
  /** Native subprocess budget, at most five seconds. */
  timeoutMs: number;
}

export type CommitInspectionContextResult =
  | { ok: true; document: CommitInspectionContextDocument }
  | { ok: false; reason: string };

export type CommitInspectionContextExecutor = (
  request: CommitInspectionContextRequest
) => Promise<CommitInspectionContextResult>;

/** Resolve an argv-only executable; injectable to exercise real child processes. */
export type CommitInspectionCommandResolver = (argv: readonly string[], cwd: string) => GitSpanCommand;

/** Decode the exact native envelope and verify its complete, deduplicated requested commit set. */
export function decodeCommitInspectionContext(
  _stdout: string,
  _requestedCommits: readonly string[]
): CommitInspectionContextDocument {
  throw new Error('Not Implemented');
}

/** Build the bounded native executor without a shell or metadata mutation. */
export function createDefaultCommitInspectionExecutor(
  _resolveCommand?: CommitInspectionCommandResolver
): CommitInspectionContextExecutor {
  throw new Error('Not Implemented');
}

/** Render every current anchor and explanation, or reject a report beyond 64 KiB. */
export function renderCommitInspectionContext(_document: CommitInspectionContextDocument): string | null {
  throw new Error('Not Implemented');
}

/**
 * Query and render atomically; failures return an unavailable notice and safely
 * quoted retrieval command. deadlineMs is the driver's performance.now() deadline,
 * shared with selection; no partial report or empty wrapper is emitted.
 */
export function runCommitInspectionContext(
  _selection: { repoRoot: string; commits: readonly string[] },
  _deadlineMs: number,
  _executor?: CommitInspectionContextExecutor
): Promise<string | null> {
  throw new Error('Not Implemented');
}
