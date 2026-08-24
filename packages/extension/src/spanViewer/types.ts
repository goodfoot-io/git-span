/**
 * Shared pure-logic types for the `.span/**` viewer.
 *
 * Every type here is consumed by the pure modules under `spanViewer/`
 * (`spanFileGrammar.ts`, `historyClient.ts`, `anchorMatcher.ts`,
 * `patchReconstruction.ts`, `historySnapshotLadder.ts`) and by their
 * integration-layer callers -- including the webview bundle, which imports
 * the posted-document shapes and the webview-boundary message unions. Both
 * sides of the custom-editor boundary type their traffic from this one
 * module, so renaming or deleting a field on either side breaks both
 * bundles' builds instead of silently dead-ending a message at runtime.
 * Nothing in this file imports `vscode` -- these are plain data shapes plus
 * the small pure guards that narrow untrusted postMessage payloads.
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
 * `git span remove` or re-adding).
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
 * `recorded: 'unrecoverable'`, which names a different failure (a drifted or
 * impossible recorded token, not an unreadable file) and so gets its own
 * status card.
 */
export type UnavailableReason = CurrentUnavailableReason | 'unrecoverable';

/** The layer at which an anchor was observed drifted, per `git span drift`. */
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

/** The base fields every posted anchor card carries. */
export interface PostedAnchorBase {
  /** The live declared address, e.g. `web/checkout.tsx#L10-L12`. */
  address: string;
  /** Repository-relative, slash-separated file path. */
  path: string;
  /** 1-based inclusive line range, or `null` for a whole-file anchor. */
  range: { start: number; end: number } | null;
}

/**
 * One anchor card in the posted document, mirroring the matcher's plan kind
 * plus the provider-side status cards (`changed` for a raced disk read,
 * `dangling` for a mixed span's unmatched anchor).
 */
export type PostedAnchor =
  | (PostedAnchorBase & { kind: 'clean'; content: string })
  | (PostedAnchorBase & {
      kind: 'drifted';
      historical: string | null;
      current: string | null;
      /**
       * The file-absolute first line of each side's line space, so the diff
       * renderer can number the gutters from the file's real coordinates
       * instead of 1. A rename block's historical side lives in the
       * from-address's extent; see {@link AnchorPlan}.
       */
      historicalStartLine: number;
      currentStartLine: number;
    })
  | (PostedAnchorBase & {
      kind: 'reconciled';
      historical: string | null;
      current: string | null;
      historicalStartLine: number;
      currentStartLine: number;
    })
  | (PostedAnchorBase & { kind: 'relocated'; content: string; proposed: string })
  | (PostedAnchorBase & { kind: 'unavailable'; reason: UnavailableReason })
  | (PostedAnchorBase & { kind: 'changed' })
  | (PostedAnchorBase & { kind: 'dangling' });

/**
 * One block inside a history accordion entry: a header-only rebound block,
 * a ladder-resolved content pair, or a status marker where the ladder
 * stopped.
 */
export interface PostedHistoryBlock {
  /** The address (path with optional range) this block concerns. */
  path: string;
  /** Present on a header-only rebound block, which has no diff editor. */
  rebound?: ReboundTransition;
  /**
   * Present on a content block: the ladder-resolved `(original, modified)`
   * pair plus each side's file-absolute first line, so the diff renderer can
   * number each gutter from the real file coordinates instead of from 1.
   */
  pair?: { original: string; modified: string; originalStartLine: number; modifiedStartLine: number };
  /** True on a block whose ladder produced nothing (seed unrecoverable). */
  unavailable?: boolean;
  /** True on the rung where the walk stopped; nothing older is rendered. */
  truncated?: boolean;
}

/** One collapsed-by-default history accordion entry. */
export interface PostedHistoryCommit {
  hash: string;
  date: string;
  summary: string;
  /**
   * The declaration diff pair, resolved by threading the worktree `.span`
   * content backward through `current.span_diff` and each commit's own
   * `span_diff`; `'unavailable'` when that reconstruction failed.
   */
  spanDiff?: { original: string; modified: string } | 'unavailable';
  blocks: PostedHistoryBlock[];
}

/** The uncommitted declaration edit (`current.span_diff`), pre-resolved. */
export interface PostedUncommittedEdit {
  /** The `.span/<name>` declaration file's repo-relative path. */
  path: string;
  original: string;
  modified: string;
}

/**
 * The exact object the provider posts to the webview via `postMessage`.
 *
 * Everything the webview needs is pre-computed here -- the webview has no
 * filesystem access and no CSP allowance to fetch an `asWebviewUri` URL, so
 * content bytes, ladder-resolved history pairs, and the span-diff threading
 * all arrive in this one structured-clone-safe payload.
 */
export interface PostedDocument {
  spanName: string;
  /** Why prose parsed from the `.span` file itself, never from history. */
  why: string;
  /**
   * When the `.span` declaration file was last edited, as an ISO string.
   *
   * Always describes the declaration file and nothing else -- never a commit
   * that only touched anchored code -- so the rendered age never changes
   * subject between renders. Resolved as the committer date of the last commit
   * touching `.span/<name>`, or the file's worktree mtime when the declaration
   * is edited-but-uncommitted or has never been committed at all.
   *
   * Omitted, never faked, when neither source resolves (no git, no stat); the
   * webview renders no "Updated" line at all rather than an invented date.
   */
  updatedAt?: string;
  /** True when any anchor drifted/relocated/unavailable or the declaration has an uncommitted edit. */
  drift: boolean;
  /** Human-readable causes for the Drift pill's tooltip, e.g. `1 anchor drifted`. */
  driftReasons: string[];
  /** One card per live anchor, in file order. */
  anchors: PostedAnchor[];
  /** The uncommitted declaration edit card, when `current.span_diff` exists. */
  uncommittedEdit?: PostedUncommittedEdit | 'unavailable';
  /** Collapsed-by-default history accordion entries. */
  history: PostedHistoryCommit[];
}

/**
 * The Monaco built-in base themes the viewer's theme bridge can target,
 * matched by the webview `<body>`'s `data-vscode-theme` attribute and the
 * {@linkcode MESSAGE_TYPES.themeChanged} postMessage's `kind`. The bridge
 * covers editor chrome from the injected `--vscode-*` variables, but `base`
 * still decides the token palette Monaco falls back to for syntax colors
 * (never bridged -- the accepted tradeoff), so a light/high-contrast-light
 * workbench theme must not resolve to a dark base.
 */
export const MONACO_BASE_THEMES = ['vs', 'vs-dark', 'hc-black', 'hc-light'] as const;

/** A Monaco built-in base theme name. */
export type MonacoBaseTheme = (typeof MONACO_BASE_THEMES)[number];

/**
 * Narrow an unknown value to a {@linkcode MonacoBaseTheme}.
 *
 * @param value - The value to test.
 * @returns Whether `value` is one of the four Monaco base theme names.
 * @throws Never.
 */
export function isMonacoBaseTheme(value: unknown): value is MonacoBaseTheme {
  return typeof value === 'string' && (MONACO_BASE_THEMES as readonly unknown[]).includes(value);
}

/**
 * The message-type discriminators crossing the custom-editor boundary, in
 * one table. The extension host and the Monaco webview bundle import it, and
 * the fallback panel's inline script -- interpolated HTML that cannot import
 * these types -- receives the same values via `JSON.stringify`, so its
 * hardcoded strings can never drift from the unions they must match.
 */
export const MESSAGE_TYPES = {
  document: 'document',
  goToFile: 'goToFile',
  openCommit: 'openCommit',
  ready: 'ready',
  reload: 'reload',
  reopenAsText: 'reopenAsText',
  themeChanged: 'themeChanged'
} as const;

/**
 * One message the webview side posts to the extension host: the Monaco
 * bundle's lifecycle/interaction messages plus the fallback panel's reload
 * handshake. Discriminated by `type`; the host narrows incoming payloads
 * with {@linkcode isWebviewToHostMessage} before switching on it.
 */
export type WebviewToHostMessage =
  /** The Monaco webview's load handshake; the host re-posts its last document. */
  | { type: typeof MESSAGE_TYPES.ready }
  /**
   * The fallback panel's answer to catching a late `'document'` post it
   * cannot render: the host swaps the panel back to the webview template,
   * whose fresh load posts {@linkcode WebviewToHostMessage.ready}.
   */
  | { type: typeof MESSAGE_TYPES.reload }
  /** Open the `.span` file itself in VS Code's default text editor. */
  | { type: typeof MESSAGE_TYPES.reopenAsText }
  /**
   * Open a repository-relative file, optionally selecting its declared
   * 1-based inclusive line range.
   */
  | { type: typeof MESSAGE_TYPES.goToFile; path: string; range: { start: number; end: number } | null }
  /** Open a commit in VS Code's native commit view. */
  | { type: typeof MESSAGE_TYPES.openCommit; hash: string };

/**
 * One message the extension host posts to a webview: either the fully
 * resolved document render or a workbench theme relay. Discriminated by
 * `type`; the webview narrows incoming payloads with
 * {@linkcode isHostToWebviewMessage} before switching on them.
 */
export type HostToWebviewMessage =
  /** Replace the webview DOM with this posted document's render. */
  | { type: typeof MESSAGE_TYPES.document; document: PostedDocument }
  /** The active workbench theme changed; re-bridge Monaco from this base. */
  | { type: typeof MESSAGE_TYPES.themeChanged; kind: MonacoBaseTheme };

/**
 * Whether `value` is a non-null object, the only shape that can carry a
 * message's named fields.
 *
 * @param value - The value to test.
 * @returns Whether `value` can carry named fields.
 * @throws Never.
 */
function isMessageRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether `value` is a well-formed 1-based inclusive line range.
 *
 * @param value - The value to test.
 * @returns Whether `value` carries numeric `start` and `end`.
 * @throws Never.
 */
function isLineRange(value: unknown): value is { start: number; end: number } {
  if (!isMessageRecord(value)) {
    return false;
  }
  return typeof value['start'] === 'number' && typeof value['end'] === 'number';
}

/**
 * Runtime guard narrowing a postMessage payload received by the extension
 * host to a {@linkcode WebviewToHostMessage}. Every payload field a handler
 * reads is validated here, so a malformed post is dropped at the boundary
 * instead of reaching a handler half-typed.
 *
 * @param value - The received message payload.
 * @returns Whether `value` is a well-formed webview-to-host message.
 * @throws Never.
 */
export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (!isMessageRecord(value)) {
    return false;
  }
  switch (value['type']) {
    case MESSAGE_TYPES.ready:
    case MESSAGE_TYPES.reload:
    case MESSAGE_TYPES.reopenAsText:
      return true;
    case MESSAGE_TYPES.goToFile:
      return typeof value['path'] === 'string' && (value['range'] === null || isLineRange(value['range']));
    case MESSAGE_TYPES.openCommit:
      return typeof value['hash'] === 'string';
    default:
      return false;
  }
}

/**
 * Runtime guard narrowing a postMessage payload received by a webview to a
 * {@linkcode HostToWebviewMessage}. The posted document is only checked to
 * be an object here -- its deep shape is guaranteed by construction on the
 * host side ({@linkcode PostedDocument}) -- while every primitive payload
 * field is validated so malformed posts are dropped at the boundary.
 *
 * @param value - The received message payload.
 * @returns Whether `value` is a well-formed host-to-webview message.
 * @throws Never.
 */
export function isHostToWebviewMessage(value: unknown): value is HostToWebviewMessage {
  if (!isMessageRecord(value)) {
    return false;
  }
  switch (value['type']) {
    case MESSAGE_TYPES.document:
      return isMessageRecord(value['document']);
    case MESSAGE_TYPES.themeChanged:
      return isMonacoBaseTheme(value['kind']);
    default:
      return false;
  }
}

/**
 * The per-anchor render plan produced by matching a live anchor address
 * against a `HistoryDocument`. Drives which content strings a card shows, or
 * which status card replaces it.
 *
 * Derived from field shape plus `current` presence, never from an `event`:
 * `has-history` comes from the lineage walk, and the shape rules come from
 * which of `proposed`/`recorded`/`unavailable`/real hunks a `current` entry
 * carries.
 */
export type AnchorPlan =
  /** Has timeline history and no asserted drift; content is read from the workspace file. */
  | { kind: 'clean' }
  /**
   * Declared and drifted; `historical`/`current` may be null for
   * deleted/new anchors. Each side also carries the file-absolute first line
   * of its own line space (a rename's old side lives in the from-address's
   * extent), so the diff renderer can number the gutter from the file's real
   * coordinates.
   */
  | {
      kind: 'drifted';
      historical: string | null;
      current: string | null;
      historicalStartLine: number;
      currentStartLine: number;
    }
  /** Declared and drifted before any commit touched it (no timeline history). */
  | {
      kind: 'reconciled';
      historical: string | null;
      current: string | null;
      historicalStartLine: number;
      currentStartLine: number;
    }
  /** No timeline history and no asserted drift. */
  | { kind: 'dangling' }
  /** The recorded content was found at a different address; identical bytes by construction. */
  | { kind: 'relocated'; content: string; proposed: string; sources?: DriftSource[] }
  /** No content either side -- a header-only status card. */
  | { kind: 'unavailable'; reason: UnavailableReason };
