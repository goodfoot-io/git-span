/**
 * Shared pure-logic types for the `.span/**` Multi-Diff viewer.
 *
 * Every type here is consumed by the pure modules under `spanViewer/`
 * (`spanFileGrammar.ts`, `historyClient.ts`, `anchorMatcher.ts`, `anchorUri.ts`)
 * and by their integration-layer callers in a later group. Nothing in this
 * file imports `vscode` -- these are plain data shapes.
 *
 * @summary Shared types for the span viewer's pure logic layer.
 * @module spanViewer/types
 */

/**
 * A single anchor as read live off a `.span/*` file's own header address --
 * before any matching against history has happened.
 */
export interface LiveAnchor {
  path: string;
  range: { start: number; end: number } | null;
}

/**
 * One anchor-affecting event recorded against a single commit in
 * `git span history --format json`'s `commits[].anchors[]` array.
 *
 * `content` is present for `added`/`modified` events and omitted (key absent)
 * for `removed` events.
 */
export interface TimelineAnchor {
  path: string;
  event: 'added' | 'modified' | 'removed';
  content?: string;
}

/** A single commit entry from `git span history --format json`'s `commits[]`. */
export interface HistoryCommit {
  hash: string;
  date: string;
  summary: string;
  why?: string;
  anchors: TimelineAnchor[];
}

/**
 * A single entry in the `current` block: an anchor whose live worktree state
 * differs from HEAD. Absence from `current.anchors[]` means "unchanged from
 * HEAD," not "no current state."
 *
 * `content` is omitted (key absent) when the CLI has no readable current
 * content to report -- e.g. `status` is `"removed in the working tree"`, or
 * the anchor's resolved location could not be read.
 */
export interface CurrentAnchor {
  path: string;
  status: string;
  content?: string;
}

/** The fully-typed, camelCase shape of `git span history --format json`'s stdout. */
export interface HistoryDocument {
  schemaVersion: number;
  span: string;
  commits: HistoryCommit[];
  current?: {
    anchors: CurrentAnchor[];
  };
}

/**
 * The per-anchor render plan produced by matching a live anchor address
 * against a `HistoryDocument`. Drives which two (or fewer) content strings
 * populate a Multi-Diff pane.
 */
export type AnchorPlan =
  | { kind: 'clean'; content: string }
  | { kind: 'drifted'; historical: string | null; current: string | null }
  | { kind: 'reconciled'; historical: string | null; current: string | null }
  | { kind: 'dangling' };

/** Query-string parameters encoded into a `gitspan-anchor:` virtual document URI. */
export interface AnchorUriParams {
  spanPath: string;
  anchorPath: string;
  anchorIndex: number;
  side: 'original' | 'modified';
}
