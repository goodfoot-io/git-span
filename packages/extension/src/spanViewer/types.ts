/**
 * Shared pure-logic types for the `.span/**` Multi-Diff viewer.
 *
 * Every type here is consumed by the pure modules under `spanViewer/`
 * (`spanFileGrammar.ts`, `historyClient.ts`, `anchorMatcher.ts`,
 * `patchReconstruction.ts`, `historySnapshotLadder.ts`, `anchorUri.ts`)
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
 * Why a timeline anchor's content could not be extracted at its commit.
 *
 * A status to style, never source to render. `filter-failed` is a
 * `current`-block-only value and must not collapse into `absent`: the two
 * name different repairs (fix the `.gitattributes` filter driver vs.
 * `git span rm` or re-adding).
 */
export type TimelineUnavailableReason = 'absent' | 'range-past-eof' | 'binary';

/**
 * Why a `current` anchor's content could not be extracted.
 *
 * Adds `filter-failed` (the file is there and readable, but the configured
 * filter driver produced nothing) to the timeline set.
 */
export type CurrentUnavailableReason = TimelineUnavailableReason | 'filter-failed';

/**
 * Every reason a `current` anchor's content cannot be shown, including
 * `recorded: 'unrecoverable'`, which names a different failure (a stale or
 * impossible recorded token, not an unreadable file) and so gets its own
 * status card.
 */
export type UnavailableReason = CurrentUnavailableReason | 'unrecoverable';

/** The layer at which an anchor was observed drifted, per `git span stale`. */
export type DriftSource = 'HEAD' | 'INDEX' | 'WORKTREE';

/**
 * The recorded-token transition of a `rebound anchor` block: the token the
 * previous state's declaration recorded at this address and the token this
 * state records.
 */
export interface ReboundTransition {
  from: string;
  to: string;
}

/**
 * One anchor-affecting event recorded against a single commit in
 * `git span history --format json`'s `commits[].anchors[]` array.
 *
 * `path` is the anchor's address *after* the change (for a removal, the last
 * address it held) and is not unique within an entry -- block identity is the
 * pair `(path, block form)`, since a commit that rebinds an address *and*
 * edits it emits two objects at that address.
 *
 * Carries exactly one of `content` (a first-add whose snapshot was
 * extractable) or `diff` (every other case); `unavailable` and `rebound`
 * never co-occur with `content`.
 */
export interface TimelineAnchor {
  path: string;
  /** Full snapshot, present exactly on an extractable first-add. */
  content?: string;
  /** Unified diff with file-absolute coordinates, present exactly when `content` is absent. */
  diff?: string;
  /** Why the anchor's new-side content could not be extracted. */
  unavailable?: TimelineUnavailableReason;
  /** The binding transition, present exactly on a `rebound anchor` object. */
  rebound?: ReboundTransition;
}

/** A single commit entry from `git span history --format json`'s `commits[]`. */
export interface HistoryCommit {
  hash: string;
  date: string;
  summary: string;
  /** The `.span/<name>` declaration diff, present iff that blob changed in this commit. */
  span_diff?: string;
  anchors: TimelineAnchor[];
}

/**
 * A single entry in the `current` block: an anchor whose live worktree state
 * differs from HEAD. Absence from `current.anchors[]` means "unchanged from
 * HEAD," not "no current state."
 *
 * `diff` is always present (degrading to a header-only block when there are
 * no honest hunks); `content` is present exactly when `unavailable` is
 * absent -- never use `content ?? ''` as a fallback, since a genuinely empty
 * extent is contractually the only meaning a blank preview may have.
 */
export interface CurrentAnchor {
  /** The anchor's declared address: the only join key a consumer can match. */
  path: string;
  diff: string;
  /** Full bytes whose hash the header names on the side wearing `path`. */
  content?: string;
  /** Why the bytes could not be extracted; present exactly when `content` is absent. */
  unavailable?: CurrentUnavailableReason;
  /** The resolver's belief that the recorded content now lives at a different address. */
  proposed?: string;
  /** Present, with the single value `"unrecoverable"`, when no snapshot hashes to the recorded token. */
  recorded?: 'unrecoverable';
  /** The layers this anchor drifted at; omitted rather than emitted as `[]`. */
  sources?: DriftSource[];
}

/** The fully-typed, camelCase shape of `git span history --format json`'s stdout. */
export interface HistoryDocument {
  schemaVersion: number;
  span: string;
  /** Present iff `--limit` dropped older qualifying commits. */
  scoped?: boolean;
  commits: HistoryCommit[];
  /** Omitted entirely when the worktree declaration matches HEAD and no anchor is drifted. */
  current?: {
    /** The `.span/<name>` declaration diff between the two compared states. */
    span_diff?: string;
    anchors: CurrentAnchor[];
  };
}

/**
 * The per-anchor render plan produced by matching a live anchor address
 * against a `HistoryDocument`. Drives which two (or fewer) content strings
 * populate a Multi-Diff pane, or which status card replaces it.
 *
 * Derived from field shape plus `current` presence, never from an `event`:
 * `has-history` comes from the lineage walk, and the shape rules come from
 * which of `proposed`/`recorded`/`unavailable`/real hunks a `current` entry
 * carries.
 */
export type AnchorPlan =
  /** Has timeline history and no asserted drift; content is read from the workspace file. */
  | { kind: 'clean' }
  /** Declared and drifted; `historical`/`current` may be null for deleted/new anchors. */
  | { kind: 'drifted'; historical: string | null; current: string | null }
  /** Declared and drifted before any commit touched it (no timeline history). */
  | { kind: 'reconciled'; historical: string | null; current: string | null }
  /** No timeline history and no asserted drift. */
  | { kind: 'dangling' }
  /** The recorded content was found at a different address; identical bytes by construction. */
  | { kind: 'relocated'; content: string; proposed: string; sources?: DriftSource[] }
  /** No content either side -- a header-only status card. */
  | { kind: 'unavailable'; reason: UnavailableReason };

/** Query-string parameters encoded into a `gitspan-anchor:` virtual document URI. */
export interface AnchorUriParams {
  spanPath: string;
  anchorPath: string;
  anchorIndex: number;
  side: 'original' | 'modified';
}
