/**
 * Per-document render session for the `.span/**` viewer: the lifecycle owner
 * extracted from `resolveCustomEditor` in `spanFileEditorProvider.ts`.
 *
 * A {@linkcode SpanRenderSession} owns the four pieces of render state that
 * used to live in ~10 closure variables -- the monotonic generation counter,
 * the in-flight abort controllers, the trailing-debounce timer coalescing
 * watcher bursts, and the per-path filesystem watchers -- behind a small
 * surface (`start()`/`cancel()`/`dispose()`, plus the watcher-event entry
 * point). Superseding a render aborts the prior controller instead of
 * dropping it on the floor, so a stale spawn can no longer run to completion
 * unnoticed; dispose aborts everything outstanding.
 *
 * One full render pass is split into pure steps -- load (`loadSpanHistory`),
 * match (`matchAnchors`), build (`buildPostedDocument`) -- each returning its
 * result for the thin posting layer at the end of `start()`, which applies
 * the disposed/superseded guards and hands outcomes to injected sinks. The
 * module is deliberately pure: it imports no `vscode`, and every side effect
 * (reading the span file, spawning the CLI, creating watchers, posting to
 * the webview) arrives as an injected function, so session lifecycle is
 * unit-testable without launching VS Code.
 *
 * @summary Per-document render lifecycle for the `.span/**` viewer.
 * @module spanViewer/spanRenderSession
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { GitSpanCommandResult } from '../utils/gitSpanBinary.js';
import { type LineageMatch, matchAllAnchors, walkAddressLineage } from './anchorMatcher.js';
import { escapeGlobPattern } from './globEscape.js';
import { HistoryFormatError, parseHistoryJson } from './historyClient.js';
import { buildHistorySnapshotLadder, type LadderRung } from './historySnapshotLadder.js';
import { reconstructOriginal } from './patchReconstruction.js';
import { formatAnchorAddress, type ParsedSpanFile } from './spanFileGrammar.js';
import { resolveSpanUpdatedAt } from './spanTimestamp.js';
import type {
  AnchorPlan,
  HistoryDocument,
  LiveAnchor,
  PostedAnchor,
  PostedDocument,
  PostedHistoryBlock,
  PostedHistoryCommit,
  PostedUncommittedEdit
} from './types.js';

/**
 * Quiet window, in milliseconds, coalescing watcher-event bursts into one
 * trailing re-render. A save written in chunks or a build touching many
 * anchors' files fires the filesystem watcher once per event; without
 * coalescing each event pays a full render pipeline (span-file read, anchor
 * stats, `git span history` spawn). Every event reschedules this timer, so
 * exactly one render runs after the storm passes -- reading the final on-disk
 * state. The initial open-time render never waits on it.
 */
const WATCHER_RENDER_DEBOUNCE_MS = 300;

/**
 * Wall-clock budget, in milliseconds, for one render pass's load phase (the
 * span-file read, the pre-spawn anchor stats, and the `git span history`
 * spawn): when it elapses the phase's abort controller fires so a hung CLI
 * cannot pin a render open indefinitely.
 */
const SPAN_RENDER_TIMEOUT_MS = 10000;

/**
 * The outcome of a single render pass, keyed by span document URI in
 * {@linkcode testOnlyRenderOutcomes}. Exists purely so end-to-end tests can
 * assert the render's outcome (as opposed to only that a
 * `gitSpan.spanFileViewer` tab is open) -- the installed `@types/vscode` has
 * no typed handle on the rendered panel to assert against directly.
 */
export interface SpanRenderOutcome {
  /** True when history loaded and at least one anchor matched (vs. the error or all-dangling fallback pane). */
  readonly ok: boolean;
  /** Number of anchors that could not be matched against history as dangling. */
  readonly danglingCount: number;
  /** The message rendered into this document's own webview panel. */
  readonly message: string;
}

/**
 * Key under which {@linkcode testOnlyRenderOutcomes}'s backing `Map` is
 * stashed on `globalThis`. Each test file and the extension itself are
 * bundled as separate esbuild outputs (see `scripts/build/build-testing.js`),
 * so a plain module-scoped `Map` would not be shared between the running
 * extension's bundle and a test file's own bundle even though both execute
 * in the same extension-host process -- `globalThis` is the one thing they
 * actually share.
 */
const TEST_ONLY_RENDER_OUTCOMES_GLOBAL_KEY = '__gitSpanSpanViewerTestOnlyRenderOutcomes__';

/**
 * Test-only hook recording the most recent {@linkcode SpanRenderOutcome} for
 * each open span document, keyed by `uri.toString()`. Not read by any
 * production code path.
 */
export const testOnlyRenderOutcomes: Map<string, SpanRenderOutcome> = ((): Map<string, SpanRenderOutcome> => {
  const globalRecord = globalThis as unknown as Record<string, Map<string, SpanRenderOutcome> | undefined>;
  const existing = globalRecord[TEST_ONLY_RENDER_OUTCOMES_GLOBAL_KEY];
  if (existing !== undefined) {
    return existing;
  }
  const created = new Map<string, SpanRenderOutcome>();
  globalRecord[TEST_ONLY_RENDER_OUTCOMES_GLOBAL_KEY] = created;
  return created;
})();

/**
 * Key under which {@linkcode testOnlyLastPostedDocument}'s backing `Map` is
 * stashed on `globalThis`, for the same per-bundle sharing reason as
 * {@linkcode TEST_ONLY_RENDER_OUTCOMES_GLOBAL_KEY}.
 */
const TEST_ONLY_LAST_POSTED_DOCUMENT_GLOBAL_KEY = '__gitSpanSpanViewerTestOnlyLastPostedDocument__';

/**
 * Test-only hook recording the exact object most recently posted to each open
 * span document's webview, keyed by `uri.toString()`. `vscode-test-electron`
 * has no CDP hook into a webview's rendered DOM, so this is the only way the
 * end-to-end tests can assert anchor count, per-anchor drift kind, history
 * entry count, and the raced-read status card. Not read by any production
 * code path.
 */
export const testOnlyLastPostedDocument: Map<string, PostedDocument> = ((): Map<string, PostedDocument> => {
  const globalRecord = globalThis as unknown as Record<string, Map<string, PostedDocument> | undefined>;
  const existing = globalRecord[TEST_ONLY_LAST_POSTED_DOCUMENT_GLOBAL_KEY];
  if (existing !== undefined) {
    return existing;
  }
  const created = new Map<string, PostedDocument>();
  globalRecord[TEST_ONLY_LAST_POSTED_DOCUMENT_GLOBAL_KEY] = created;
  return created;
})();

/**
 * Per-document watcher-coalescing counters. Fields are mutated in place by
 * the session's debounce; the map is the test's read side.
 */
export interface SpanWatcherCoalescingStats {
  /** Watcher events observed for this document, coalesced or not. */
  observedEvents: number;
  /** Events absorbed because a debounced render was already scheduled within the quiet window. */
  coalescedEvents: number;
  /** Renders actually started by the debounce timer (excludes the immediate open-time render). */
  debouncedRenders: number;
}

/**
 * Key under which {@linkcode testOnlyWatcherCoalescingStats}'s backing `Map`
 * is stashed on `globalThis`, for the same per-bundle sharing reason as
 * {@linkcode TEST_ONLY_RENDER_OUTCOMES_GLOBAL_KEY}.
 */
const TEST_ONLY_WATCHER_COALESCING_STATS_GLOBAL_KEY = '__gitSpanSpanViewerTestOnlyWatcherCoalescingStats__';

/**
 * Test-only hook counting watcher events and how many renders the debounce
 * actually started for each open span document, keyed by `uri.toString()`.
 * Redundant-render behavior is otherwise invisible: every pipeline runs
 * off-screen and only its posted result (or its suppression by the
 * generation guard) can be observed. Not read by any production code path.
 */
export const testOnlyWatcherCoalescingStats: Map<string, SpanWatcherCoalescingStats> = ((): Map<
  string,
  SpanWatcherCoalescingStats
> => {
  const globalRecord = globalThis as unknown as Record<string, Map<string, SpanWatcherCoalescingStats> | undefined>;
  const existing = globalRecord[TEST_ONLY_WATCHER_COALESCING_STATS_GLOBAL_KEY];
  if (existing !== undefined) {
    return existing;
  }
  const created = new Map<string, SpanWatcherCoalescingStats>();
  globalRecord[TEST_ONLY_WATCHER_COALESCING_STATS_GLOBAL_KEY] = created;
  return created;
})();

/**
 * Signature of `runGitSpanCommand`, injectable so tests can substitute a fake
 * CLI response without touching the real process-spawning wrapper or the real
 * `git-span` binary on `PATH`.
 */
export type RunGitSpanCommandFn = (
  binaryPath: string,
  args: string[],
  signal?: AbortSignal,
  cwd?: string
) => Promise<GitSpanCommandResult>;

/**
 * Structural stand-in for a document URI: the session reads only `fsPath`,
 * and `vscode.Uri` satisfies this shape, keeping the module free of any
 * `vscode` import.
 */
export interface SpanFileUri {
  /** Absolute filesystem path of the document. */
  readonly fsPath: string;
}

/**
 * Read and parse a `.span` file's current on-disk text, returning `null` when
 * the text does not parse as a span file. Injectable so the session stays
 * decoupled from `vscode.workspace.fs`; the provider adapts the absolute path
 * to its `vscode.Uri`.
 */
export type ReadSpanFileFn = (fsPath: string) => Promise<{ text: string; parsed: ParsedSpanFile } | null>;

/**
 * Structural watcher surface the session needs, satisfied by
 * `vscode.FileSystemWatcher`: change/create/delete subscriptions plus
 * disposal. Injectable so watcher creation never touches `vscode` here.
 */
export interface SpanRenderWatcher {
  /**
   * Subscribe to file-change events.
   *
   * @param listener - Invoked when the watched file changes.
   * @returns An implementation-specific subscription handle the session ignores.
   */
  onDidChange(listener: () => void): unknown;
  /**
   * Subscribe to file-creation events.
   *
   * @param listener - Invoked when the watched file is created.
   * @returns An implementation-specific subscription handle the session ignores.
   */
  onDidCreate(listener: () => void): unknown;
  /**
   * Subscribe to file-deletion events.
   *
   * @param listener - Invoked when the watched file is deleted.
   * @returns An implementation-specific subscription handle the session ignores.
   */
  onDidDelete(listener: () => void): unknown;
  /** Release the underlying watcher. Must be safe to call once. */
  dispose(): void;
}

/**
 * Create a filesystem watcher for an already glob-escaped pattern.
 * Injectable; the provider binds `vscode.workspace.createFileSystemWatcher`.
 */
export type CreateWatcherFn = (globPattern: string) => SpanRenderWatcher;

/**
 * Render the error/fallback pane for this document (the provider's
 * `renderPanel` binding). Receives the primary message; warnings are always
 * empty from the session.
 */
export type ShowFallbackFn = (message: string) => void;

/** Post a fully-resolved document to the webview (the thin poster's sink). */
export type PostDocumentFn = (document: PostedDocument) => void;

/**
 * Construction-time dependencies and sinks for one document's render session.
 * Everything here is either data or an injected function; nothing imports
 * `vscode`, so sessions are constructible in plain unit tests.
 */
export interface SpanRenderSessionOptions {
  /** The opened span document's URI (only `fsPath` is read). */
  readonly uri: SpanFileUri;
  /** Stable key for the per-document test hooks (`uri.toString()` in production). */
  readonly uriKey: string;
  /** Spawns `git-span` commands; substituted with fakes in tests. */
  readonly runCommand: RunGitSpanCommandFn;
  /** Reads and parses the span file from disk. */
  readonly readSpanFile: ReadSpanFileFn;
  /** Creates a watcher for an already glob-escaped pattern. */
  readonly createWatcher: CreateWatcherFn;
  /** Renders the error/fallback pane. */
  readonly showFallback: ShowFallbackFn;
  /** Posts a resolved document to the webview. */
  readonly postDocument: PostDocumentFn;
  /** Debounce quiet window override (tests); defaults to {@linkcode WATCHER_RENDER_DEBOUNCE_MS}. */
  readonly debounceMs?: number;
}

/**
 * Everything the preamble resolves before the first render may start:
 * without all three there is nothing to spawn against, and `start()`
 * fails closed to `null`.
 */
export interface SpanRenderEnvironment {
  /** Resolved `git-span` binary path. */
  readonly binaryPath: string;
  /** The span's name (the `.span` file's path below the `.span` directory). */
  readonly spanName: string;
  /** The repository root anchor paths resolve against. */
  readonly repoRoot: string;
}

/**
 * A file's stat at the CLI-spawn instant: either its `(mtimeMs, size)` pair,
 * or the **absent-at-snapshot** sentinel recorded when the pre-spawn stat
 * rejected (most often ENOENT on a dangling anchor's file). The sentinel
 * compares equal to a later stat also finding the file absent, and unequal to
 * one finding it present -- so absent-then-present and present-then-absent
 * both read as the same "content changed since this was checked" mismatch.
 */
type PreSpawnStat = { kind: 'present'; mtimeMs: number; size: number } | { kind: 'absent' };

/**
 * Whether the file's state at the post-read instant equals its state at the
 * CLI-spawn instant. Any difference -- absent either direction, or a changed
 * `(mtimeMs, size)` pair -- means the read raced the CLI's own read, so the
 * read cannot be trusted to back a "clean" verdict.
 *
 * @param pre - The pre-spawn stat or absent-at-snapshot sentinel.
 * @param post - The post-read stat, or `null` when that stat rejected.
 * @returns Whether the two instants agree.
 * @throws Never.
 */
function statsEqual(pre: PreSpawnStat | undefined, post: { mtimeMs: number; size: number } | null): boolean {
  if (pre === undefined) {
    return false;
  }
  if (pre.kind === 'absent') {
    return post === null;
  }
  if (post === null) {
    return false;
  }
  return pre.mtimeMs === post.mtimeMs && pre.size === post.size;
}

/**
 * Slice a file's raw text to an anchor's declared 1-indexed inclusive range,
 * mirroring the CLI's own `slice_line_range` semantics exactly: split on
 * `'\n'`, strip a trailing `'\r'` from each line (Rust `str::lines()`), drop
 * the final empty element produced by a trailing newline, and emit each
 * sliced line terminated by `'\n'` -- so a non-empty result always ends with
 * `'\n'`, agreeing with what the CLI would hash.
 *
 * @param text - The file's raw text, as read from disk.
 * @param range - The declared range, or `null` for a whole-file anchor (raw
 *   text as-is).
 * @returns The sliced extent, or `null` when the file has fewer lines than
 *   the declared range end -- which means the file changed since the CLI's
 *   read, so the caller must render the "content changed" status card, never
 *   a fabricated empty preview.
 * @throws Never.
 */
function sliceLineRange(text: string, range: { start: number; end: number } | null): string | null {
  if (range === null) {
    return text;
  }
  const lines = text.split('\n');
  // Mirror Rust `str::lines()`: the final element is dropped when it is empty
  // after `\r`-stripping, which includes a bare `'\r'`. Counting without
  // mapping keeps the guard O(1) over large files; only the sliced extent is
  // mapped below.
  let lineCount = lines.length;
  if (lineCount > 0) {
    const last = lines[lineCount - 1];
    if (last === '' || last === '\r') {
      lineCount -= 1;
    }
  }
  if (lineCount < range.end) {
    // The CLI certified this anchor clean, so its own read had at least
    // `range.end` lines; fewer here means the file changed in the gap.
    return null;
  }
  return lines
    .slice(range.start - 1, range.end)
    .map((line) => `${line.replace(/\r$/, '')}\n`)
    .join('');
}

/**
 * Read one anchor file from disk and verify the read did not race the CLI's
 * own read: `fs.stat` immediately after the read must equal the pre-spawn
 * stat. A read failure or a stat mismatch returns `null` (the "content
 * changed" card) -- never a fabricated preview. Per-path, so several anchors
 * on one file share a single trusted read.
 *
 * @param fsPath - The absolute filesystem path to read.
 * @param preSpawnStats - The pre-spawn stat map, keyed by filesystem path.
 * @returns The raw file text, or `null` when the read cannot be trusted.
 * @throws Never.
 */
async function readCleanRaw(fsPath: string, preSpawnStats: Map<string, PreSpawnStat>): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(fsPath, 'utf-8');
  } catch {
    return null;
  }
  const postStatResults = await Promise.allSettled([fs.stat(fsPath)]);
  const postStat = postStatResults[0]?.status === 'fulfilled' ? postStatResults[0].value : null;
  if (!statsEqual(preSpawnStats.get(fsPath), postStat)) {
    return null;
  }
  return raw;
}

/**
 * Read every distinct path's content once and concurrently, then slice each
 * clean anchor's extent from its path's trusted raw text. Replaces the
 * per-anchor sequential full-file reads: N anchors on one file cost one
 * read, and paths resolve independently of each other. A path whose read
 * cannot be trusted yields `null` for every anchor on it -- exactly what the
 * per-anchor loop produced -- so both consumers (the posted card's content
 * and the ladder seed map) see unchanged values.
 *
 * @param entries - One entry per clean-plan anchor, in posted order.
 * @param preSpawnStats - The pre-spawn stat map, keyed by filesystem path.
 * @param repoRoot - The repository root the anchor paths resolve against.
 * @returns Per-entry sliced content, index-aligned with `entries`.
 * @throws Never.
 */
async function readCleanContents(
  entries: readonly { anchor: LiveAnchor }[],
  preSpawnStats: Map<string, PreSpawnStat>,
  repoRoot: string
): Promise<(string | null)[]> {
  const byFsPath = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const fsPath = path.join(repoRoot, entry.anchor.path);
    const indices = byFsPath.get(fsPath);
    if (indices === undefined) {
      byFsPath.set(fsPath, [index]);
    } else {
      indices.push(index);
    }
  });
  const rawByIndex: (string | null)[] = new Array(entries.length);
  await Promise.allSettled(
    [...byFsPath.entries()].map(async ([fsPath, indices]) => {
      const raw = await readCleanRaw(fsPath, preSpawnStats);
      for (const index of indices) {
        rawByIndex[index] = raw;
      }
    })
  );
  return entries.map((entry, index) => {
    const raw = rawByIndex[index];
    if (raw === null || raw === undefined) {
      return null;
    }
    return sliceLineRange(raw, entry.anchor.range);
  });
}

/**
 * Thread the worktree `.span` text backward through `current.span_diff` and
 * each commit's own `span_diff`, recovering the `(original, modified)` pair
 * every commit with a declaration change renders. The new side of a
 * `span_diff` is always the commit's own version (worktree for
 * `current.span_diff`, the commit's blob for a timeline `span_diff`), and the
 * thread runs along the first-parent chain -- commits without a `span_diff`
 * preserve the declaration, so `running` stays valid across them. A
 * reconstruction failure leaves the failing commit and every older one
 * `'unavailable'`: without the failing commit's original side, nothing older
 * can be confirmed (fail-closed, never a fabricated pair).
 *
 * @param history - The parsed history document.
 * @param worktreeSpanText - The `.span` file's current disk text, re-read on
 *   every render pass.
 * @returns Per-commit-hash resolved pairs, or `'unavailable'`.
 * @throws Never.
 */
function threadSpanDiffs(
  history: HistoryDocument,
  worktreeSpanText: string
): Map<string, { original: string; modified: string } | 'unavailable'> {
  const result = new Map<string, { original: string; modified: string } | 'unavailable'>();
  let running = worktreeSpanText;
  if (history.current?.span_diff !== undefined) {
    try {
      running = reconstructOriginal(history.current.span_diff, worktreeSpanText, 1);
    } catch {
      for (const commit of history.commits) {
        if (commit.span_diff !== undefined) {
          result.set(commit.hash, 'unavailable');
        }
      }
      return result;
    }
  }
  for (let index = 0; index < history.commits.length; index++) {
    const commit = history.commits[index];
    if (commit?.span_diff === undefined) {
      continue;
    }
    try {
      const original = reconstructOriginal(commit.span_diff, running, 1);
      result.set(commit.hash, { original, modified: running });
      running = original;
    } catch {
      result.set(commit.hash, 'unavailable');
      for (let older = index + 1; older < history.commits.length; older++) {
        const olderCommit = history.commits[older];
        if (olderCommit?.span_diff !== undefined) {
          result.set(olderCommit.hash, 'unavailable');
        }
      }
      break;
    }
  }
  return result;
}

/** The ladder resolution for one anchor address. */
interface LadderInfo {
  /** The tracked address, matching `walkAddressLineage`'s per-commit addresses. */
  address: string;
  /** The lineage matches for this address, newest first. */
  matches: LineageMatch[];
  /** Ladder rungs by commit hash. */
  rungsByHash: Map<string, LadderRung>;
  /** True when the ladder produced nothing (seed recovery failed at rung zero). */
  seedFailed: boolean;
}

/**
 * Resolve one anchor address's history ladder once per address (the ladder
 * threads backward, so walking it per commit would redo every older hop).
 * Skipped entirely for `dangling` anchors (no lineage).
 *
 * @param history - The parsed history document.
 * @param liveAnchors - The live anchors, in file order.
 * @param plans - One plan per live anchor.
 * @param cleanContents - Sliced disk content per `clean`-plan address; a
 *   clean anchor whose disk read raced the CLI is absent here and passes an
 *   empty ladder seed instead.
 * @returns One entry per address with resolvable history.
 * @throws Never -- the ladder itself is fail-closed to `seedFailed`.
 */
function resolveLadders(
  history: HistoryDocument,
  liveAnchors: LiveAnchor[],
  plans: AnchorPlan[],
  cleanContents: Map<string, string>
): LadderInfo[] {
  const ladderInfos: LadderInfo[] = [];
  liveAnchors.forEach((anchor, index) => {
    const plan = plans[index];
    if (plan === undefined) {
      return;
    }
    if (plan.kind === 'dangling') {
      return;
    }
    const address = formatAnchorAddress(anchor.path, anchor.range);
    const current = history.current?.anchors.find((entry) => entry.path === address);
    // An uncommitted re-anchor makes `current` itself a rename; the committed
    // history lives under its `rename from` address, so the walk must start
    // there or the accordion blocks and the ladder rungs would diverge (see
    // `walkAddressLineage`). A byte-identical re-anchor (the CLI's
    // `drift --fix` output) emits NO current entry at all -- `current.span_diff`
    // is the only trace of the move, so it feeds the walk the same way a
    // rename header does.
    const currentSpanDiff = history.current?.span_diff;
    const matches = walkAddressLineage(history.commits, address, current, currentSpanDiff);
    let seedContent: string;
    if (plan.kind === 'clean') {
      // A clean anchor whose disk read raced the CLI has no `cleanContents`
      // entry: the race only invalidates the clean preview, never the history
      // walk -- a pure string computation over the certified JSON payload --
      // so the ladder is still computed and the accordion keeps its entries.
      // With no trustworthy disk-read seed it passes an empty one; the ladder
      // handles the missing-seed case on the not-drifted branch itself.
      seedContent = cleanContents.get(address) ?? '';
    } else {
      seedContent = '';
    }
    const ladder = buildHistorySnapshotLadder({
      liveAddress: address,
      commits: history.commits,
      current,
      currentSpanDiff,
      seedContent
    });
    ladderInfos.push({
      address,
      matches,
      rungsByHash: new Map(ladder.rungs.map((rung) => [rung.hash, rung])),
      seedFailed: ladder.rungs.length === 0 && ladder.truncated
    });
  });
  return ladderInfos;
}

/**
 * Build the history accordion's per-commit entries: each commit's resolved
 * `span_diff` pair plus one block per anchor address the commit touches,
 * respecting `(path, block form)` identity -- a rebind-plus-edit commit
 * renders both the header-only rebound block and the content block for the
 * same path.
 *
 * @param history - The parsed history document.
 * @param worktreeSpanText - The `.span` file's disk text.
 * @param ladderInfos - Per-address ladder resolutions.
 * @returns The history entries, newest first.
 * @throws Never.
 */
function buildPostedHistory(
  history: HistoryDocument,
  worktreeSpanText: string,
  ladderInfos: LadderInfo[]
): PostedHistoryCommit[] {
  const spanDiffs = threadSpanDiffs(history, worktreeSpanText);
  const posted: PostedHistoryCommit[] = [];

  for (let commitIndex = 0; commitIndex < history.commits.length; commitIndex++) {
    const commit = history.commits[commitIndex];
    if (commit === undefined) {
      continue;
    }
    const blocks: PostedHistoryBlock[] = [];
    for (const info of ladderInfos) {
      const match = info.matches.find((candidate) => candidate.commitIndex === commitIndex);
      if (match === undefined) {
        continue;
      }
      // The rebound sibling at the same (path, block form), when this commit
      // both rebinds the address and edits it.
      const reboundEntry = commit.anchors.find((entry) => entry.path === match.address && entry.rebound !== undefined);
      if (reboundEntry?.rebound !== undefined) {
        blocks.push({
          path: match.address,
          rebound: { from: reboundEntry.rebound.from, to: reboundEntry.rebound.to }
        });
      }
      if (match.anchor.rebound !== undefined) {
        // Rebound-only match: the header-only block above is the whole story.
        continue;
      }
      const rung = info.rungsByHash.get(commit.hash);
      if (rung !== undefined) {
        blocks.push(
          rung.truncatedAt === undefined
            ? {
                path: match.address,
                pair: {
                  original: rung.original,
                  modified: rung.modified,
                  originalStartLine: rung.originalStartLine,
                  modifiedStartLine: rung.modifiedStartLine
                }
              }
            : { path: match.address, unavailable: true, truncated: true }
        );
      } else if (info.seedFailed) {
        // Seed failure is rung zero: one "history unavailable" card at the
        // newest commit that touches this address, nothing older.
        blocks.push({ path: match.address, unavailable: true, truncated: true });
        info.seedFailed = false;
      }
    }
    const entry: PostedHistoryCommit = {
      hash: commit.hash,
      date: commit.date,
      summary: commit.summary,
      blocks
    };
    const spanDiff = spanDiffs.get(commit.hash);
    if (spanDiff !== undefined) {
      entry.spanDiff = spanDiff;
    }
    posted.push(entry);
  }
  return posted;
}

/**
 * `N anchor(s)` / `N anchors` noun-phrase helper for drift-reason copy.
 *
 * @param count - The number of affected anchors.
 * @param noun - The singular noun to pluralize.
 * @returns The `count`-prefixed, correctly pluralized noun phrase.
 * @throws Never.
 */
function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Inputs to one render pass's load phase. Bundles the configured environment
 * with the injected IO functions so the phase stays a pure data-in/data-out
 * step.
 */
interface SpanLoadInputs {
  /** Absolute filesystem path of the span document. */
  readonly uriFsPath: string;
  /** Resolved `git-span` binary path. */
  readonly binaryPath: string;
  /** The span's name. */
  readonly spanName: string;
  /** The repository root anchor paths resolve against. */
  readonly repoRoot: string;
  /** Reads and parses the span file from disk. */
  readonly readSpanFile: ReadSpanFileFn;
  /** Spawns `git-span` commands. */
  readonly runCommand: RunGitSpanCommandFn;
}

/**
 * The load phase's outcome: either everything later phases need, or the
 * user-facing message for the fallback pane. Superseded/disposed handling is
 * deliberately not a case here -- the orchestrator applies those guards
 * uniformly to whichever outcome arrived.
 */
type SpanLoadOutcome =
  | { kind: 'error'; message: string }
  | {
      kind: 'loaded';
      /** The `.span` file's current disk text. */
      text: string;
      /** The fresh parse of that text. */
      parsed: ParsedSpanFile;
      /** Live anchors derived from the fresh parse, in file order. */
      liveAnchors: LiveAnchor[];
      /** Pre-spawn stat map, keyed by filesystem path. */
      preSpawnStats: Map<string, PreSpawnStat>;
      /** The parsed history document. */
      history: HistoryDocument;
    };

/**
 * Load phase: re-read the span file from disk, stat every distinct anchor
 * path at the CLI-spawn instant, then fetch and parse `git span history
 * --format json`. Every failure becomes an `'error'` outcome carrying the
 * exact message the fallback pane would have rendered -- never a throw.
 *
 * Every pass re-reads the span file before anything else -- the CLI spawn
 * included -- so the fresh parse feeds the pre-spawn stat map, the anchor
 * matching, and the diff reconstruction.
 *
 * @param inputs - The environment and injected IO for this pass.
 * @param signal - Abort signal firing on timeout, supersession, or disposal.
 * @returns The loaded inputs for later phases, or the fallback-pane message.
 * @throws Never -- failures are returned as `'error'` outcomes.
 */
async function loadSpanHistory(inputs: SpanLoadInputs, signal: AbortSignal): Promise<SpanLoadOutcome> {
  let fresh: { text: string; parsed: ParsedSpanFile } | null;
  try {
    fresh = await inputs.readSpanFile(inputs.uriFsPath);
  } catch (error) {
    return {
      kind: 'error',
      message: `Failed to re-read the span file: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (fresh === null) {
    return { kind: 'error', message: 'This file is not a recognized .span anchor file.' };
  }
  const { text, parsed } = fresh;
  const liveAnchors: LiveAnchor[] = parsed.anchors.map((anchor) => ({
    path: anchor.path,
    range: anchor.range
  }));

  // Stat every distinct anchor path at the CLI-spawn instant, via
  // Promise.allSettled so one ENOENT (a dangling anchor's missing file)
  // never throws upstream of `git span history` being consulted -- a
  // rejection is recorded as the absent-at-snapshot sentinel instead.
  const statPaths = [...new Set(parsed.anchors.map((anchor) => path.join(inputs.repoRoot, anchor.path)))];
  const statResults = await Promise.allSettled(statPaths.map((statPath) => fs.stat(statPath)));
  const preSpawnStats = new Map<string, PreSpawnStat>();
  statPaths.forEach((statPath, index) => {
    const result = statResults[index];
    preSpawnStats.set(
      statPath,
      result?.status === 'fulfilled'
        ? { kind: 'present', mtimeMs: result.value.mtimeMs, size: result.value.size }
        : { kind: 'absent' }
    );
  });

  try {
    const result = await inputs.runCommand(
      inputs.binaryPath,
      ['history', inputs.spanName, '--format', 'json'],
      signal,
      inputs.repoRoot
    );
    if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
      throw new HistoryFormatError(
        `git-span history exited with code ${result.exitCode}: ${result.stderr.trim() || '(no output)'}`
      );
    }
    return { kind: 'loaded', text, parsed, liveAnchors, preSpawnStats, history: parseHistoryJson(result.stdout) };
  } catch (error) {
    return {
      kind: 'error',
      message: `Failed to load span history: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Match phase: match every live anchor's address against the loaded history.
 * A throw here means malformed/unexpected history shape -- the orchestrator
 * surfaces it under the same "failed to load" copy the CLI failure uses.
 *
 * @param liveAnchors - The live anchors, in file order.
 * @param history - The parsed history document.
 * @returns One plan per live anchor.
 * @throws When anchor matching fails.
 */
function matchAnchors(liveAnchors: LiveAnchor[], history: HistoryDocument): AnchorPlan[] {
  return matchAllAnchors(liveAnchors, history);
}

/**
 * Compute the set of filesystem paths one successful render covers: the span
 * file itself plus every anchor's real file, dangling ones included, so a
 * later create/restore of a missing file re-triggers the render and the
 * anchor re-resolves as clean/drifted.
 *
 * @param uriFsPath - The span document's absolute path.
 * @param anchors - The fresh parse's anchors, in file order.
 * @param repoRoot - The repository root anchor paths resolve against.
 * @returns The watched paths for this render.
 * @throws Never.
 */
function computeWatchedPaths(uriFsPath: string, anchors: ParsedSpanFile['anchors'], repoRoot: string): Set<string> {
  const watchedPaths = new Set<string>([uriFsPath]);
  anchors.forEach((anchor) => {
    watchedPaths.add(path.join(repoRoot, anchor.path));
  });
  return watchedPaths;
}

/**
 * Build the all-dangling fallback document: every anchor unmatched against
 * history, rendered by the Monaco webview as dangling anchor cards in its own
 * DOM (never by replacing the webview HTML, which would kill the 'document'
 * listener the watcher-triggered re-renders depend on).
 *
 * @param parsed - The fresh span-file parse.
 * @param plans - One plan per anchor, all expected dangling.
 * @param spanName - The span's name, as shown in the fallback document's copy.
 * @returns The all-dangling document to post in place of a rendered diff.
 * @throws Never.
 */
function buildAllDanglingDocument(parsed: ParsedSpanFile, plans: AnchorPlan[], spanName: string): PostedDocument {
  const danglingAnchors: PostedAnchor[] = [];
  plans.forEach((plan, index) => {
    const anchor = parsed.anchors[index];
    if (anchor === undefined || plan.kind !== 'dangling') {
      return;
    }
    danglingAnchors.push({
      address: formatAnchorAddress(anchor.path, anchor.range),
      path: anchor.path,
      range: anchor.range,
      kind: 'dangling'
    });
  });
  const danglingCount = plans.filter((plan) => plan.kind === 'dangling').length;
  return {
    spanName,
    why: parsed.why,
    drift: true,
    driftReasons: [`${countLabel(danglingCount, 'anchor')} without history`],
    anchors: danglingAnchors,
    history: []
  };
}

/**
 * Build phase: assemble the `PostedDocument` from the parsed span file, the
 * anchor plans, and the history document -- one card per anchor (clean
 * content read from disk with the pre/post-stat race check), the uncommitted
 * declaration edit, the declaration's last-edited timestamp, per-commit
 * history blocks, and the Drift pill's reasons.
 *
 * @param options - Everything the build needs.
 * @param options.liveAnchors - The live anchors, in file order.
 * @param options.plans - One plan per live anchor.
 * @param options.history - The parsed history document.
 * @param options.spanName - The span's name (the `.span` file's basename).
 * @param options.text - The `.span` file's current disk text, re-read on
 *   every render pass.
 * @param options.why - The span's why prose, as parsed from the file.
 * @param options.preSpawnStats - The pre-spawn stat map, keyed by path.
 * @param options.repoRoot - The repository root anchor paths resolve against.
 * @returns The document to post to the webview.
 * @throws Never -- every failure path yields a status card or
 *   `'unavailable'` marker, never a fabricated preview.
 */
async function buildPostedDocument(options: {
  liveAnchors: LiveAnchor[];
  plans: AnchorPlan[];
  history: HistoryDocument;
  spanName: string;
  text: string;
  why: string;
  preSpawnStats: Map<string, PreSpawnStat>;
  repoRoot: string;
}): Promise<PostedDocument> {
  const { liveAnchors, plans, history, spanName, text, why, preSpawnStats, repoRoot } = options;

  const anchors: PostedAnchor[] = [];
  const cleanContents = new Map<string, string>();
  let drifted = 0;
  let relocated = 0;
  let unavailable = 0;
  let changed = 0;
  let dangling = 0;

  // Clean-plan content resolves in one concurrent, path-deduped pass: every
  // anchor on a file shares that file's single trusted read (see
  // readCleanContents), and the sliced extents land in both consumers --
  // the posted card's content and the ladder-seed map below -- exactly as
  // the per-anchor sequential loop produced them.
  const cleanEntries: {
    slot: number;
    anchor: LiveAnchor;
    address: string;
    base: { address: string; path: string; range: { start: number; end: number } | null };
  }[] = [];

  for (let index = 0; index < liveAnchors.length; index++) {
    const anchor = liveAnchors[index];
    const plan = plans[index];
    if (anchor === undefined || plan === undefined) {
      continue;
    }
    const address = formatAnchorAddress(anchor.path, anchor.range);
    const base = { address, path: anchor.path, range: anchor.range };
    switch (plan.kind) {
      case 'dangling':
        dangling++;
        anchors.push({ ...base, kind: 'dangling' });
        break;
      case 'clean':
        cleanEntries.push({ slot: anchors.length, anchor, address, base });
        anchors.push({ ...base, kind: 'clean', content: '' });
        break;
      case 'drifted':
      case 'reconciled':
        drifted++;
        anchors.push({
          ...base,
          kind: plan.kind,
          historical: plan.historical,
          current: plan.current,
          historicalStartLine: plan.historicalStartLine,
          currentStartLine: plan.currentStartLine
        });
        break;
      case 'relocated':
        relocated++;
        anchors.push({ ...base, kind: 'relocated', content: plan.content, proposed: plan.proposed });
        break;
      case 'unavailable':
        unavailable++;
        anchors.push({ ...base, kind: 'unavailable', reason: plan.reason });
        break;
    }
  }

  const cleanResults = await readCleanContents(
    cleanEntries.map(({ anchor }) => ({ anchor })),
    preSpawnStats,
    repoRoot
  );
  cleanEntries.forEach((entry, i) => {
    const content = cleanResults[i];
    if (content === null || content === undefined) {
      changed++;
      anchors[entry.slot] = { ...entry.base, kind: 'changed' };
    } else {
      cleanContents.set(entry.address, content);
      const posted = anchors[entry.slot];
      if (posted !== undefined && posted.kind === 'clean') {
        posted.content = content;
      }
    }
  });

  const spanRelativePath = `.span/${spanName}`;

  let uncommittedEdit: PostedUncommittedEdit | 'unavailable' | undefined;
  if (history.current?.span_diff !== undefined) {
    try {
      const original = reconstructOriginal(history.current.span_diff, text, 1);
      uncommittedEdit = { path: spanRelativePath, original, modified: text };
    } catch {
      uncommittedEdit = 'unavailable';
    }
  }

  // `current.span_diff` -- the same signal the card above is built from --
  // is exactly "the worktree declaration differs from HEAD", so the
  // committed date is drifted by construction whenever the card is present.
  const updatedAt = await resolveSpanUpdatedAt({
    repoRoot,
    relativePath: spanRelativePath,
    dirty: uncommittedEdit !== undefined
  });

  const ladderInfos = resolveLadders(history, liveAnchors, plans, cleanContents);
  const postedHistory = buildPostedHistory(history, text, ladderInfos);

  const driftReasons: string[] = [];
  if (drifted > 0) {
    driftReasons.push(`${countLabel(drifted, 'anchor')} drifted`);
  }
  if (relocated > 0) {
    driftReasons.push(`${countLabel(relocated, 'anchor')} relocated`);
  }
  if (unavailable > 0) {
    driftReasons.push(`${countLabel(unavailable, 'anchor')} unavailable`);
  }
  if (changed > 0) {
    driftReasons.push(`${countLabel(changed, 'anchor')} changed while this span was being checked`);
  }
  if (dangling > 0) {
    driftReasons.push(`${countLabel(dangling, 'anchor')} without history`);
  }
  if (uncommittedEdit !== undefined) {
    driftReasons.push('span file edited in the working tree');
  }

  const posted: PostedDocument = {
    spanName,
    why,
    drift: driftReasons.length > 0,
    driftReasons,
    anchors,
    history: postedHistory
  };
  if (updatedAt !== undefined) {
    posted.updatedAt = updatedAt;
  }
  if (uncommittedEdit !== undefined) {
    posted.uncommittedEdit = uncommittedEdit;
  }
  return posted;
}

/**
 * One open span document's render lifecycle: the generation counter, the
 * in-flight abort controllers, the trailing-debounce timer, and the
 * filesystem watchers, owned outright instead of living in
 * `resolveCustomEditor` closure variables.
 *
 * Lifecycle rules, each enforced structurally:
 *
 * - **Supersession**: starting a render aborts every still-live prior
 *   controller, so a superseded spawn stops paying for work whose result can
 *   never be posted; only the most recently initiated render may reach the
 *   webview (generation guard).
 * - **Debounce**: watcher events land in `scheduleRender()`, which coalesces
 *   bursts into one trailing render after the quiet window; teardown cancels
 *   the pending timer so no render ever fires into a dead panel.
 * - **Disposal**: `dispose()` is idempotent and fail-closed -- marks the
 *   session dead, cancels the timer, aborts every live controller, and
 *   disposes every watcher.
 *
 * All IO is injected via {@linkcode SpanRenderSessionOptions}; nothing here
 * touches `vscode`, so the lifecycle is unit-testable in plain Node.
 */
export class SpanRenderSession {
  /** Injected dependencies and sinks, fixed at construction. */
  private readonly options: SpanRenderSessionOptions;
  /** Effective debounce quiet window in milliseconds. */
  private readonly debounceMs: number;
  /** Environment resolved by the provider's preamble; `null` until configured. */
  private environment: SpanRenderEnvironment | null = null;
  /** Whether this session has been torn down; every entry point checks it. */
  private tornDown = false;
  /**
   * Monotonic render generation: incremented at the start of every `start()`
   * call, so a superseded render (a newer one already started) can detect it
   * is drifted and skip posting -- only the most recently initiated render's
   * result may reach the webview.
   */
  private renderGeneration = 0;
  /** The last successfully-built document, re-posted when the webview signals ready. */
  private lastPostedDocument: PostedDocument | null = null;
  /** Pending trailing-debounce timer for watcher-triggered re-renders, or `null` when idle. */
  private watcherRenderTimer: ReturnType<typeof setTimeout> | null = null;
  /** Controllers of renders whose load phase has not settled yet. */
  private readonly liveControllers = new Set<AbortController>();
  /** Filesystem paths already watched, so re-renders only add watchers for newly-seen paths. */
  private readonly watchers = new Map<string, SpanRenderWatcher>();

  /**
   * Create a session for one open span document.
   *
   * @param options - Injected dependencies and sinks; see
   *   {@linkcode SpanRenderSessionOptions}.
   * @returns Nothing.
   * @throws Never.
   */
  constructor(options: SpanRenderSessionOptions) {
    this.options = options;
    this.debounceMs = options.debounceMs ?? WATCHER_RENDER_DEBOUNCE_MS;
  }

  /**
   * Install the preamble-resolved environment (binary path, span name,
   * repository root) without which `start()` refuses to render.
   *
   * @param environment - The resolved environment.
   * @returns Nothing.
   * @throws Never.
   */
  configure(environment: SpanRenderEnvironment): void {
    this.environment = environment;
  }

  /**
   * Whether this session has been disposed; disposed sessions render nothing.
   *
   * @returns `true` once {@linkcode dispose} has run, `false` before it.
   */
  get disposed(): boolean {
    return this.tornDown;
  }

  /**
   * The last successfully-built document, for the webview's 'ready' handshake.
   *
   * @returns The most recent document posted by a winning render, or `null`
   *   before the first success.
   */
  get lastPosted(): PostedDocument | null {
    return this.lastPostedDocument;
  }

  /**
   * The current render generation, strictly increasing across `start()` calls
   * so tests can assert monotonicity and supersession ordering.
   *
   * @returns The number of renders started so far (refused starts excluded).
   */
  get generation(): number {
    return this.renderGeneration;
  }

  /**
   * Run one render pass: load (re-read the span file, stat anchors, fetch and
   * parse history), match, build, and -- if this pass is neither disposed nor
   * superseded -- post the resulting `PostedDocument` (or render the
   * explanatory fallback). Re-invoked by file watchers via
   * {@linkcode scheduleRender}.
   *
   * Every invocation first re-reads and re-parses the span file from disk,
   * so a watcher-triggered re-render (e.g. the user saved an edit in a
   * "Reopen as Text" tab) matches anchors and reconstructs `span_diff`s
   * against the current text -- never the open-time snapshot, which would
   * post drifted addresses and degrade every diff card to 'unavailable'.
   *
   * Starting a pass aborts any still-live prior controller: a superseded
   * render's spawn is cancelled rather than left running toward a result
   * only the newer pass could post.
   *
   * @returns The set of filesystem paths this render covered (the span file
   *   plus every anchor's real file, dangling or not), or `null` when the
   *   session is disposed or unconfigured, history could not be loaded, or a
   *   newer render superseded this one before it could post. Callers
   *   register watchers for returned paths via {@linkcode ensureWatcher}.
   * @throws Never -- failures render as a pane rather than propagating.
   */
  async start(): Promise<Set<string> | null> {
    const environment = this.environment;
    if (this.tornDown || environment === null) {
      return null;
    }
    for (const liveController of this.liveControllers) {
      liveController.abort();
    }
    this.renderGeneration += 1;
    const generation = this.renderGeneration;
    const controller = new AbortController();
    this.liveControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), SPAN_RENDER_TIMEOUT_MS);

    let loaded: SpanLoadOutcome;
    try {
      loaded = await loadSpanHistory(
        {
          uriFsPath: this.options.uri.fsPath,
          binaryPath: environment.binaryPath,
          spanName: environment.spanName,
          repoRoot: environment.repoRoot,
          readSpanFile: this.options.readSpanFile,
          runCommand: this.options.runCommand
        },
        controller.signal
      );
    } finally {
      clearTimeout(timeout);
      this.liveControllers.delete(controller);
    }

    if (loaded.kind === 'error') {
      if (this.tornDown || generation !== this.renderGeneration) {
        return null;
      }
      this.options.showFallback(loaded.message);
      testOnlyRenderOutcomes.set(this.options.uriKey, { ok: false, danglingCount: 0, message: loaded.message });
      return null;
    }

    if (this.tornDown) {
      return null;
    }

    let plans: AnchorPlan[];
    try {
      plans = matchAnchors(loaded.liveAnchors, loaded.history);
    } catch (error) {
      if (this.tornDown || generation !== this.renderGeneration) {
        return null;
      }
      const message = `Failed to load span history: ${error instanceof Error ? error.message : String(error)}`;
      this.options.showFallback(message);
      testOnlyRenderOutcomes.set(this.options.uriKey, { ok: false, danglingCount: 0, message });
      return null;
    }

    const watchedPaths = computeWatchedPaths(this.options.uri.fsPath, loaded.parsed.anchors, environment.repoRoot);

    const danglingCount = plans.filter((plan) => plan.kind === 'dangling').length;

    if (danglingCount === loaded.parsed.anchors.length) {
      // Every anchor is dangling: post an all-dangling document so the
      // Monaco webview renders the fallback state in its own DOM. Never
      // replace the webview HTML here -- the webview's 'document' listener
      // must stay alive so a later watcher-triggered render (the anchor's
      // file restored, history grown to cover it) re-renders in place
      // instead of posting into a dead panel.
      if (generation !== this.renderGeneration) {
        return null;
      }
      const documentToPost = buildAllDanglingDocument(loaded.parsed, plans, environment.spanName);
      this.lastPostedDocument = documentToPost;
      this.options.postDocument(documentToPost);
      testOnlyLastPostedDocument.set(this.options.uriKey, documentToPost);
      const message = `No anchors in span "${environment.spanName}" could be matched against its history.`;
      testOnlyRenderOutcomes.set(this.options.uriKey, {
        ok: false,
        danglingCount,
        message
      });
      return watchedPaths;
    }

    try {
      const documentToPost = await buildPostedDocument({
        liveAnchors: loaded.liveAnchors,
        plans,
        history: loaded.history,
        spanName: environment.spanName,
        text: loaded.text,
        why: loaded.parsed.why,
        preSpawnStats: loaded.preSpawnStats,
        repoRoot: environment.repoRoot
      });
      if (this.tornDown || generation !== this.renderGeneration) {
        return null;
      }
      this.lastPostedDocument = documentToPost;
      this.options.postDocument(documentToPost);
      testOnlyLastPostedDocument.set(this.options.uriKey, documentToPost);
      const danglingNote = danglingCount > 0 ? ` ${danglingCount} anchor(s) could not be matched -- see below.` : '';
      const message = `Span "${environment.spanName}" loaded successfully.${danglingNote}`;
      testOnlyRenderOutcomes.set(this.options.uriKey, {
        ok: true,
        danglingCount,
        message
      });
    } catch (error) {
      if (this.tornDown || generation !== this.renderGeneration) {
        return null;
      }
      const message = `Failed to render span history: ${error instanceof Error ? error.message : String(error)}`;
      this.options.showFallback(message);
      testOnlyRenderOutcomes.set(this.options.uriKey, { ok: false, danglingCount: 0, message });
    }

    return watchedPaths;
  }

  /**
   * Coalesce a watcher event into the trailing-debounce timer: every event
   * reschedules the quiet window, so a burst of events -- a chunked save, a
   * build touching many anchors' files -- costs one render pipeline after
   * the burst settles instead of one per event. The final state always
   * renders because `start()` re-reads the span file and anchor content
   * from disk when the timer fires.
   *
   * @returns Nothing.
   * @throws Never.
   */
  scheduleRender(): void {
    let stats = testOnlyWatcherCoalescingStats.get(this.options.uriKey);
    if (stats === undefined) {
      stats = { observedEvents: 0, coalescedEvents: 0, debouncedRenders: 0 };
      testOnlyWatcherCoalescingStats.set(this.options.uriKey, stats);
    }
    stats.observedEvents++;
    if (this.watcherRenderTimer !== null) {
      clearTimeout(this.watcherRenderTimer);
      stats.coalescedEvents++;
    }
    this.watcherRenderTimer = setTimeout(() => {
      this.watcherRenderTimer = null;
      if (this.tornDown) {
        // Fail-closed against teardown paths that ran without cancelling
        // the timer: never render into a dead panel.
        return;
      }
      stats.debouncedRenders++;
      this.startAndWatch();
    }, this.debounceMs);
  }

  /**
   * Add a filesystem watcher for `watchedPath` if one isn't already tracked,
   * wiring it to schedule a debounced re-render. Watchers are owned here and
   * disposed by {@linkcode dispose}; the provider no longer registers them
   * anywhere else.
   *
   * `watchedPath` is a literal filesystem path, but
   * `createFileSystemWatcher` reads its argument as a GlobPattern, so it is
   * glob-escaped first -- otherwise an anchored path like
   * `src/[generated]/api.ts` parses as a character class and the watcher
   * silently never fires. Watchers stay keyed by the raw path so repeated
   * renders dedupe against the unescaped form.
   *
   * @param watchedPath - The literal filesystem path to watch.
   * @returns Nothing.
   * @throws Never.
   */
  ensureWatcher(watchedPath: string): void {
    if (this.tornDown || this.watchers.has(watchedPath)) {
      return;
    }
    const watcher = this.options.createWatcher(escapeGlobPattern(watchedPath));
    watcher.onDidChange(() => {
      this.scheduleRender();
    });
    watcher.onDidCreate(() => {
      this.scheduleRender();
    });
    watcher.onDidDelete(() => {
      this.scheduleRender();
    });
    this.watchers.set(watchedPath, watcher);
  }

  /**
   * Cancel any pending debounced re-render so teardown never renders into a
   * dead panel. Does not dispose the session.
   *
   * @returns Nothing.
   * @throws Never.
   */
  cancel(): void {
    if (this.watcherRenderTimer !== null) {
      clearTimeout(this.watcherRenderTimer);
      this.watcherRenderTimer = null;
    }
  }

  /**
   * Tear down the whole session, idempotently: mark it dead (every entry
   * point thereafter fails closed), cancel the pending debounce timer, abort
   * every still-live render controller, and dispose every watcher.
   *
   * @returns Nothing.
   * @throws Never.
   */
  dispose(): void {
    if (this.tornDown) {
      return;
    }
    this.tornDown = true;
    this.cancel();
    for (const controller of this.liveControllers) {
      controller.abort();
    }
    this.liveControllers.clear();
    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }
    this.watchers.clear();
  }

  /**
   * Run one render pass and register watchers for every path it reports,
   * so a render that discovers newly-referenced anchor files starts
   * watching them. Called only from the debounce timer callback in
   * {@linkcode scheduleRender}; the open-time render awaits `start()`
   * directly and registers its initial watchers in the provider.
   *
   * @returns Nothing.
   * @throws Never.
   */
  private startAndWatch(): void {
    void this.start().then((renderedPaths) => {
      if (renderedPaths !== null) {
        for (const renderedPath of renderedPaths) {
          this.ensureWatcher(renderedPath);
        }
      }
    });
  }
}
