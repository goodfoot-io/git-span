/**
 * `CustomReadonlyEditorProvider` for `.span/**` files -- the integration seam
 * that wires the pure `spanViewer` modules (`spanFileGrammar.ts`,
 * `historyClient.ts`, `anchorMatcher.ts`, `historySnapshotLadder.ts`) around
 * VS Code's custom-editor lifecycle: parse the span file, fetch
 * `git span history --format json`, match anchors against it, read clean
 * anchor content from disk, and `postMessage` the fully-resolved
 * `PostedDocument` to the Monaco webview.
 *
 * The webview has no filesystem access and no CSP allowance to fetch anchor
 * content, so every content byte, ladder-resolved history pair, and the
 * span-diff threading are pre-computed here and shipped in one
 * structured-clone-safe postMessage. The loading/error fallback HTML panel is
 * the only fallback surface, reached when spawning `git span history` fails,
 * the span cannot be parsed, or the repository/binary is unavailable; an
 * all-dangling span renders in the webview's own DOM as dangling anchor cards,
 * never by replacing the webview HTML (which would kill the 'document'
 * listener the watcher-triggered re-renders depend on).
 *
 * This is deliberately the *only* module that imports both `vscode` and the
 * pure `spanViewer` logic -- every other file in this directory is either
 * pure (no `vscode` import) or `vscode`-only glue with no pure-logic import.
 *
 * @summary Wires the span viewer's pure logic into a read-only custom editor.
 * @module spanViewer/spanFileEditorProvider
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { type GitSpanCommandResult, resolveGitSpanBinaryOnPath, runGitSpanCommand } from '../utils/gitSpanBinary.js';
import { type LineageMatch, matchAllAnchors, walkAddressLineage } from './anchorMatcher.js';
import { getRepositoryForUri } from './gitRepository.js';
import { HistoryFormatError, parseHistoryJson } from './historyClient.js';
import { buildHistorySnapshotLadder, type LadderRung } from './historySnapshotLadder.js';
import { reconstructOriginal } from './patchReconstruction.js';
import { formatAnchorAddress, type ParsedSpanFile, parseSpanFile } from './spanFileGrammar.js';
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

/** The `viewType` this provider is registered under in `package.json`'s `customEditors`. */
export const SPAN_FILE_VIEW_TYPE = 'gitSpan.spanFileViewer';

/**
 * The outcome of a single `render()` pass, keyed by span document URI in
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
 * Signature of {@linkcode runGitSpanCommand}, injectable so tests can
 * substitute a fake CLI response without touching the real process-spawning
 * wrapper or the real `git-span` binary on `PATH`.
 */
export type RunGitSpanCommandFn = (
  binaryPath: string,
  args: string[],
  signal?: AbortSignal,
  cwd?: string
) => Promise<GitSpanCommandResult>;

/**
 * The `CustomDocument` model for an open `.span/*` file. Owns the disposables
 * (file watchers) created while its editor is open; disposed by VS Code when
 * the last editor for this document closes.
 */
class SpanCustomDocument implements vscode.CustomDocument {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(readonly uri: vscode.Uri) {}

  /**
   * Register a disposable to be torn down when this document closes.
   *
   * @param disposable - The disposable to own.
   * @returns Nothing.
   * @throws Never.
   */
  addDisposable(disposable: vscode.Disposable): void {
    this.disposables.push(disposable);
  }

  /**
   * Dispose every disposable registered via {@linkcode addDisposable}.
   *
   * @returns Nothing.
   * @throws Never.
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }
}

/**
 * Escape text for safe inclusion in the fallback/error/warning webview HTML.
 *
 * @param value - Raw text to escape.
 * @returns HTML-escaped text.
 * @throws Never.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Build a random nonce for the webview's Content-Security-Policy.
 *
 * @returns A random 32-character nonce string.
 * @throws Never.
 */
function makeNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return nonce;
}

/**
 * The Monaco built-in base themes the theme bridge can target, matched by the
 * webview `<body>`'s `data-vscode-theme` attribute and the `themeChanged`
 * postMessage's `kind`. The bridge covers editor chrome from the injected
 * `--vscode-*` variables, but `base` still decides the token palette Monaco
 * falls back to for syntax colors (never bridged -- the plan's accepted
 * tradeoff), so a light/high-contrast-light workbench theme must not resolve
 * to a dark base.
 */
type MonacoThemeKind = 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';

/**
 * Map a VS Code theme kind to the closest Monaco built-in base theme.
 *
 * @param kind - The active `vscode.ColorThemeKind`.
 * @returns The Monaco base theme name.
 * @throws Never.
 */
function monacoThemeKind(kind: vscode.ColorThemeKind): MonacoThemeKind {
  switch (kind) {
    case vscode.ColorThemeKind.Dark:
      return 'vs-dark';
    case vscode.ColorThemeKind.HighContrast:
      return 'hc-black';
    case vscode.ColorThemeKind.HighContrastLight:
      return 'hc-light';
    default:
      return 'vs';
  }
}

/**
 * Render the info/fallback/error pane shown in this custom editor's own
 * webview panel -- the tab for the `.span/*` file itself. This is the only
 * fallback surface: the loaded document renders through the Monaco webview
 * template, never through this panel.
 *
 * The panel cannot render a posted document (no Monaco bundle), so it must
 * not lose one: its script listens for `'document'` messages and relays a
 * `'reload'` message back to the host, which swaps the webview back to the
 * Monaco template -- the fresh webview posts `'ready'` on load and the host
 * re-posts `lastPosted`. This keeps the error state recoverable: a later
 * watcher-triggered render that succeeds posts its document into the panel,
 * which hands it to the Monaco webview to render. The panel deliberately does
 * not post `'ready'` itself -- the host would answer by re-posting a stale
 * `lastPosted`, bouncing it straight back here into a reload loop.
 *
 * Always offers "Reopen as Text," per the card's requirement that a span's
 * own prose remain one action away from editing even when the span rendered
 * successfully.
 *
 * @param webview - The webview to render into.
 * @param message - The primary message to display.
 * @param warnings - Dangling anchor addresses to list, if any.
 * @returns Nothing.
 * @throws Never.
 */
function renderPanel(webview: vscode.Webview, message: string, warnings: string[]): void {
  const nonce = makeNonce();
  const warningsHtml =
    warnings.length > 0
      ? `<h2>${warnings.length} anchor(s) omitted from the diff</h2><p>git-span's history could not account for the following anchor(s) -- they may reference content this span's history has no record of. They are not shown in the span viewer.</p><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
      : '';
  webview.html = `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
</head>
<body>
  <p>${escapeHtml(message)}</p>
  ${warningsHtml}
  <button id="reopen-as-text">Reopen as Text</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('reopen-as-text').addEventListener('click', () => {
      vscode.postMessage({ type: 'reopenAsText' });
    });
    // A 'document' message reaching this panel means a render succeeded after
    // this error panel was shown -- swap back to the Monaco webview, which
    // renders the document it is re-posted on 'ready'. Without this listener
    // the panel would be dead to watcher-triggered re-renders, leaving the
    // tab stuck on the error until the user reopens it.
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message !== null && typeof message === 'object' && message.type === 'document') {
        vscode.postMessage({ type: 'reload' });
      }
    });
  </script>
</body>
</html>`;
}

/**
 * The webview-resource directory holding the Monaco bundle and its workers,
 * derived from this bundle's own location: the production build emits the
 * webview assets at `dist/webview` (next to `dist/bundle.cjs`), while the
 * testing build emits them at `OUT_DIR/webview` (next to `OUT_DIR/bundle.cjs`)
 * -- `__dirname` resolves in both CJS layouts. (Inside the per-test esbuild
 * bundles the path points at a nonexistent sibling, which is harmless: the
 * posted-document assertions never touch the webview's resources.)
 */
const WEBVIEW_DIR = path.join(__dirname, 'webview');

/**
 * Build the Monaco webview template: CSP covering the bundle's nonce-scoped
 * script, Monaco's injected inline styles, the codicon fonts (served both
 * from the webview-resource origin and from `'self'`, since esbuild's
 * file-loader emits Monaco's font alongside the bundle), the worker scripts'
 * fetch (`connect-src`) and the Blob-wrapped worker construction
 * (`worker-src blob:`), and `img-src` for webview-referenced assets.
 *
 * The webview's content arrives exclusively via `postMessage` -- the template
 * itself only loads this bundle and its CSS. The `<body>` carries the active
 * theme's Monaco base on `data-vscode-theme` so the webview can bridge its
 * theme at load; later changes arrive as `themeChanged` messages.
 *
 * @param webview - The webview to build the template for.
 * @param themeKind - The active workbench theme's Monaco base theme.
 * @returns The HTML document string.
 * @throws Never.
 */
function renderWebviewHtml(webview: vscode.Webview, themeKind: MonacoThemeKind): string {
  const nonce = makeNonce();
  const mainJsUri = webview.asWebviewUri(vscode.Uri.file(path.join(WEBVIEW_DIR, 'main.js')));
  const mainCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(WEBVIEW_DIR, 'main.css')));
  return `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src 'self' ${webview.cspSource}; worker-src blob:; connect-src ${webview.cspSource}; img-src ${webview.cspSource};">
<link rel="stylesheet" href="${mainCssUri}">
</head>
<body data-vscode-theme="${themeKind}">
  <div id="app"><div class="loading">Loading span history…</div></div>
  <script nonce="${nonce}" type="module" src="${mainJsUri}"></script>
</body>
</html>`;
}

/**
 * Find the nearest ancestor directory literally named `.span` in `filePath`
 * and derive the span name (the path relative to that directory, slash
 * separated) from it.
 *
 * Only the literal `.span` default is handled -- `GIT_SPAN_DIR`/`git config
 * git-span.dir` remap support is explicitly out of scope for this card.
 *
 * @param filePath - Absolute filesystem path of the opened document.
 * @returns The derived span name, or `null` when no `.span` ancestor exists.
 * @throws Never.
 */
function resolveSpanName(filePath: string): string | null {
  const segments = filePath.split(path.sep);
  let spanRootIndex = -1;
  for (let i = segments.length - 2; i >= 0; i--) {
    if (segments[i] === '.span') {
      spanRootIndex = i;
      break;
    }
  }
  if (spanRootIndex === -1) {
    return null;
  }
  const nameSegments = segments.slice(spanRootIndex + 1);
  if (nameSegments.length === 0) {
    return null;
  }
  return nameSegments.join('/');
}

/**
 * Whether `dir` contains a `.git` entry -- a directory in a plain checkout, a
 * file in a worktree or submodule.
 *
 * @param dir - The directory to check.
 * @returns Whether a `.git` entry exists there.
 * @throws Never.
 */
async function hasGitEntry(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the nearest ancestor directory of `startDir` that contains a `.git`
 * entry, i.e. the repository root, or `null` when no ancestor does.
 *
 * @param startDir - The directory to walk up from.
 * @returns The repository root path, or `null` when none is found.
 * @throws Never.
 */
async function findRepoRootUpward(startDir: string): Promise<string | null> {
  let current = startDir;
  for (;;) {
    if (await hasGitEntry(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Read and parse a `.span` file's current on-disk text.
 *
 * Every `render()` pass -- the initial open and each watcher-triggered
 * re-render -- re-reads the span file through this, so anchors are matched
 * and `span_diff`s reconstructed against the current text, never an
 * open-time snapshot. The viewer is read-only, so the user's stale-fix
 * workflow is "Reopen as Text" -- a separate tab for the same file -- and a
 * save while the viewer is open is common; the watcher on the span file
 * itself fires after each save, and the re-render must parse the saved
 * text, not the open-time one.
 *
 * @param uri - The span document's URI.
 * @returns The raw text and parsed file, or `null` when the text does not
 *   parse as a span file.
 * @throws When the file cannot be read (e.g. it was deleted while open).
 */
async function readSpanFile(uri: vscode.Uri): Promise<{ text: string; parsed: ParsedSpanFile } | null> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder('utf-8').decode(bytes);
  const parsed = parseSpanFile(text);
  if (parsed === null) {
    return null;
  }
  return { text, parsed };
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
 * `(mtimeMs, size)` pair -- means the provider's read raced the CLI's own
 * read, so the read cannot be trusted to back a "clean" verdict.
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
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length < range.end) {
    // The CLI certified this anchor clean, so its own read had at least
    // `range.end` lines; fewer here means the file changed in the gap.
    return null;
  }
  return lines
    .slice(range.start - 1, range.end)
    .map((line) => `${line}\n`)
    .join('');
}

/**
 * Read one `clean`-plan anchor's extent from disk and verify the read did not
 * race the CLI's own read: `fs.stat` immediately after the read must equal
 * the pre-spawn stat. A read failure, a stat mismatch, or a file shorter
 * than the declared extent all return `null` (the "content changed" card) --
 * never a fabricated empty preview, since an empty result must mean
 * "genuinely empty extent".
 *
 * @param anchor - The live anchor to read.
 * @param preSpawnStats - The pre-spawn stat map, keyed by filesystem path.
 * @param repoRoot - The repository root the anchor's path resolves against.
 * @returns The sliced extent, or `null` when the read cannot be trusted.
 * @throws Never.
 */
async function readCleanContent(
  anchor: LiveAnchor,
  preSpawnStats: Map<string, PreSpawnStat>,
  repoRoot: string
): Promise<string | null> {
  const fsPath = path.join(repoRoot, anchor.path);
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
  return sliceLineRange(raw, anchor.range);
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
    // `walkAddressLineage`).
    const matches = walkAddressLineage(history.commits, address, current);
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
    const ladder = buildHistorySnapshotLadder({ liveAddress: address, commits: history.commits, current, seedContent });
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
            ? { path: match.address, pair: { original: rung.original, modified: rung.modified } }
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
 * `N anchor(s)` / `N anchors` noun-phrase helper for stale-reason copy.
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
 * Read-only viewer for `.span/**` files.
 *
 * On open, parses the document as a span file, runs `git span history
 * --format json` for it, matches every anchor's live address against that
 * history, reads clean-anchor content from disk, and posts the fully-resolved
 * `PostedDocument` to the Monaco webview. Every render pass -- the initial
 * open and each watcher-triggered re-render -- re-reads and re-parses the
 * span file from disk first, so a save in a "Reopen as Text" tab never
 * leaves the viewer matching anchors or reconstructing diffs against the
 * open-time snapshot. Dangling anchors render as
 * header-only cards in the posted document; when every anchor is dangling,
 * the posted document renders all-dangling status cards in the webview's own
 * DOM, keeping its 'document' listener alive for watcher-triggered
 * re-renders. Non-span content and any failure along the way falls back to
 * the error webview panel with an explanatory message and a "Reopen as Text"
 * escape hatch.
 */
export class SpanFileEditorProvider implements vscode.CustomReadonlyEditorProvider<SpanCustomDocument> {
  constructor(private readonly runCommand: RunGitSpanCommandFn = runGitSpanCommand) {}

  /**
   * Create the `CustomDocument` model for a given resource.
   *
   * @param uri - URI of the `.span/*` file being opened.
   * @returns The custom document model.
   * @throws Never.
   */
  openCustomDocument(uri: vscode.Uri): SpanCustomDocument {
    return new SpanCustomDocument(uri);
  }

  /**
   * Resolve the custom editor: parse, fetch history, match anchors, read
   * clean content from disk, and post the resulting `PostedDocument` to the
   * Monaco webview (or render an explanatory fallback pane).
   *
   * @param document - The custom document model for the file being opened.
   * @param webviewPanel - The webview panel backing this editor's own tab.
   * @returns Resolves once the initial render has completed.
   * @throws Never -- all failures render as a pane rather than propagating.
   */
  async resolveCustomEditor(document: SpanCustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(WEBVIEW_DIR),
        vscode.Uri.file(path.join(path.dirname(path.dirname(WEBVIEW_DIR)), 'node_modules'))
      ]
    };
    webviewPanel.webview.html = renderWebviewHtml(
      webviewPanel.webview,
      monacoThemeKind(vscode.window.activeColorTheme.kind)
    );
    // The webview cannot observe workbench theme changes itself -- VS Code
    // only re-injects the `--vscode-*` variables -- so every change is relayed
    // and the webview re-bridges its Monaco theme. Disposed with the document.
    document.addDisposable(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        webviewPanel.webview.postMessage({ type: 'themeChanged', kind: monacoThemeKind(theme.kind) });
      })
    );

    let disposed = false;
    let inFlightController: AbortController | null = null;
    /**
     * Monotonic render generation: incremented at the start of every
     * `render()` call, so a superseded render (a newer one already started)
     * can detect it is stale and skip posting -- only the most recently
     * initiated render's result may reach the webview.
     */
    let renderGeneration = 0;
    /** The last successfully-built document, re-posted when the webview signals ready. */
    let lastPosted: PostedDocument | null = null;
    document.addDisposable(
      webviewPanel.onDidDispose(() => {
        disposed = true;
        inFlightController?.abort();
      })
    );

    const opened = await readSpanFile(document.uri);
    if (disposed) {
      return;
    }
    if (opened === null) {
      renderPanel(webviewPanel.webview, 'This file is not a recognized .span anchor file.', []);
      return;
    }
    // Only the anchor list for the initial watcher registration is taken from
    // this open-time parse; every render pass re-reads and re-parses the file
    // through `readSpanFile` itself.
    const parsed = opened.parsed;

    const spanName = resolveSpanName(document.uri.fsPath);
    if (spanName === null) {
      renderPanel(
        webviewPanel.webview,
        'Could not determine this file’s span name (no ".span" ancestor directory found).',
        []
      );
      return;
    }

    const repository = await getRepositoryForUri(document.uri);
    if (disposed) {
      return;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    let repoRoot = repository?.rootUri.fsPath ?? workspaceFolder?.uri.fsPath ?? null;
    if (repoRoot === null) {
      // Neither vscode.git nor a workspace folder can place this span file in
      // a repository (e.g. the workspace does not contain the repo): walk up
      // from the span file's own directory to find a git repository root.
      repoRoot = await findRepoRootUpward(path.dirname(document.uri.fsPath));
    }
    if (disposed) {
      return;
    }
    if (repoRoot === null) {
      renderPanel(
        webviewPanel.webview,
        'Could not determine the git repository containing this span file (no ".git" directory found above it); cannot load its history.',
        []
      );
      return;
    }

    const binaryPath = await resolveGitSpanBinaryOnPath();
    if (disposed) {
      return;
    }
    if (binaryPath === null) {
      renderPanel(webviewPanel.webview, 'git-span is not on PATH; cannot load this span’s history.', []);
      return;
    }

    /** Filesystem paths already watched, so re-renders only add watchers for newly-seen paths. */
    const watchers = new Map<string, vscode.Disposable>();

    webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (typeof message !== 'object' || message === null) {
        return;
      }
      const received = message as { type?: unknown };
      if (received.type === 'ready') {
        if (lastPosted !== null) {
          webviewPanel.webview.postMessage({ type: 'document', document: lastPosted });
        }
        return;
      }
      if (received.type === 'reload') {
        // The error/fallback panel caught a 'document' post but cannot render
        // Monaco: swap back to the webview template. The fresh webview posts
        // 'ready' on load and the host re-posts `lastPosted` -- the document
        // the panel was handed.
        webviewPanel.webview.html = renderWebviewHtml(
          webviewPanel.webview,
          monacoThemeKind(vscode.window.activeColorTheme.kind)
        );
        return;
      }
      if (received.type === 'reopenAsText') {
        void vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
        return;
      }
      if (received.type === 'goToFile') {
        const goTo = received as { path?: unknown; range?: unknown };
        if (typeof goTo.path !== 'string') {
          return;
        }
        const fileUri = vscode.Uri.file(path.join(repoRoot, goTo.path));
        const range = goTo.range as { start?: unknown; end?: unknown } | null;
        if (range !== null && typeof range.start === 'number' && typeof range.end === 'number') {
          const selection = new vscode.Range(range.start - 1, 0, range.end - 1, 0);
          void vscode.window.showTextDocument(fileUri, { selection, preview: true });
        } else {
          void vscode.window.showTextDocument(fileUri, { preview: true });
        }
        return;
      }
      if (received.type === 'openCommit') {
        const open = received as { hash?: unknown };
        if (typeof open.hash !== 'string') {
          return;
        }
        // VS Code's native commit navigation: the git extension's `git:`
        // scheme URI, resolved from the repository's root path.
        const uri = vscode.Uri.from({
          scheme: 'git',
          path: document.uri.fsPath,
          query: JSON.stringify({ path: document.uri.fsPath, ref: open.hash })
        });
        void vscode.commands.executeCommand('vscode.open', uri);
      }
    });

    /**
     * Fetch history, match anchors, read clean content, and post the
     * resulting `PostedDocument` (or render an explanatory fallback).
     * Re-invoked by file watchers on subsequent changes.
     *
     * Every invocation first re-reads and re-parses the span file from disk,
     * so a watcher-triggered re-render (e.g. the user saved an edit in a
     * "Reopen as Text" tab) matches anchors and reconstructs `span_diff`s
     * against the current text -- never the open-time snapshot, which would
     * post stale addresses and degrade every diff card to 'unavailable'.
     *
     * @returns The set of filesystem paths watched for this render (the span
     *   file plus every anchor's real file, dangling or not), or `null` when
     *   history could not be loaded, the tab was disposed, or a newer render
     *   superseded this one before it could post.
     * @throws Never -- failures render as a pane rather than propagating.
     */
    const render = async (): Promise<Set<string> | null> => {
      const generation = ++renderGeneration;
      const controller = new AbortController();
      inFlightController = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);

      // Re-read the span file before anything else -- the CLI spawn included
      // -- so the fresh parse feeds the pre-spawn stat map, the anchor
      // matching, and the diff reconstruction.
      let fresh: { text: string; parsed: ParsedSpanFile } | null;
      try {
        fresh = await readSpanFile(document.uri);
      } catch (error) {
        if (disposed || generation !== renderGeneration) {
          return null;
        }
        const message = `Failed to re-read the span file: ${error instanceof Error ? error.message : String(error)}`;
        renderPanel(webviewPanel.webview, message, []);
        testOnlyRenderOutcomes.set(document.uri.toString(), { ok: false, danglingCount: 0, message });
        return null;
      }
      if (disposed || generation !== renderGeneration) {
        return null;
      }
      if (fresh === null) {
        const message = 'This file is not a recognized .span anchor file.';
        renderPanel(webviewPanel.webview, message, []);
        testOnlyRenderOutcomes.set(document.uri.toString(), { ok: false, danglingCount: 0, message });
        return null;
      }
      const { text: currentText, parsed: currentParsed } = fresh;
      const liveAnchors: LiveAnchor[] = currentParsed.anchors.map((anchor) => ({
        path: anchor.path,
        range: anchor.range
      }));

      // Stat every distinct anchor path at the CLI-spawn instant, via
      // Promise.allSettled so one ENOENT (a dangling anchor's missing file)
      // never throws upstream of `git span history` being consulted -- a
      // rejection is recorded as the absent-at-snapshot sentinel instead.
      const statPaths = [...new Set(currentParsed.anchors.map((anchor) => path.join(repoRoot, anchor.path)))];
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

      let history: HistoryDocument;
      try {
        const result = await this.runCommand(
          binaryPath,
          ['history', spanName, '--format', 'json'],
          controller.signal,
          repoRoot
        );
        if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
          throw new HistoryFormatError(
            `git-span history exited with code ${result.exitCode}: ${result.stderr.trim() || '(no output)'}`
          );
        }
        history = parseHistoryJson(result.stdout);
      } catch (error) {
        if (disposed || generation !== renderGeneration) {
          return null;
        }
        const message = `Failed to load span history: ${error instanceof Error ? error.message : String(error)}`;
        renderPanel(webviewPanel.webview, message, []);
        testOnlyRenderOutcomes.set(document.uri.toString(), { ok: false, danglingCount: 0, message });
        return null;
      } finally {
        clearTimeout(timeout);
        if (inFlightController === controller) {
          inFlightController = null;
        }
      }

      if (disposed) {
        return null;
      }

      let plans: AnchorPlan[];
      try {
        plans = matchAllAnchors(liveAnchors, history);
      } catch (error) {
        if (disposed || generation !== renderGeneration) {
          return null;
        }
        const message = `Failed to load span history: ${error instanceof Error ? error.message : String(error)}`;
        renderPanel(webviewPanel.webview, message, []);
        testOnlyRenderOutcomes.set(document.uri.toString(), { ok: false, danglingCount: 0, message });
        return null;
      }

      // Every anchor's real file is watched -- dangling ones included, so a
      // later create/restore of a missing file re-triggers the render and the
      // anchor re-resolves as clean/drifted. The watcher is disposed with the
      // document, so watching a path that never materializes is harmless.
      const watchedPaths = new Set<string>([document.uri.fsPath]);
      plans.forEach((_plan, index) => {
        const anchor = currentParsed.anchors[index];
        if (anchor === undefined) {
          return;
        }
        watchedPaths.add(path.join(repoRoot, anchor.path));
      });

      const danglingCount = plans.filter((plan) => plan.kind === 'dangling').length;

      if (danglingCount === currentParsed.anchors.length) {
        // Every anchor is dangling: post an all-dangling document so the
        // Monaco webview renders the fallback state in its own DOM. Never
        // replace the webview HTML here -- the webview's 'document' listener
        // must stay alive so a later watcher-triggered render (the anchor's
        // file restored, history grown to cover it) re-renders in place
        // instead of posting into a dead panel.
        if (generation !== renderGeneration) {
          return null;
        }
        const danglingAnchors: PostedAnchor[] = [];
        plans.forEach((plan, index) => {
          const anchor = currentParsed.anchors[index];
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
        const message = `No anchors in span "${spanName}" could be matched against its history.`;
        const documentToPost: PostedDocument = {
          spanName,
          why: currentParsed.why,
          stale: true,
          staleReasons: [`${countLabel(danglingCount, 'anchor')} without history`],
          anchors: danglingAnchors,
          history: []
        };
        lastPosted = documentToPost;
        webviewPanel.webview.postMessage({ type: 'document', document: documentToPost });
        testOnlyLastPostedDocument.set(document.uri.toString(), documentToPost);
        testOnlyRenderOutcomes.set(document.uri.toString(), {
          ok: false,
          danglingCount,
          message
        });
        return watchedPaths;
      }

      try {
        const documentToPost = await this.buildPostedDocument({
          liveAnchors,
          plans,
          history,
          spanName,
          text: currentText,
          why: currentParsed.why,
          preSpawnStats,
          repoRoot
        });
        if (disposed || generation !== renderGeneration) {
          return null;
        }
        lastPosted = documentToPost;
        webviewPanel.webview.postMessage({ type: 'document', document: documentToPost });
        testOnlyLastPostedDocument.set(document.uri.toString(), documentToPost);
        const danglingNote = danglingCount > 0 ? ` ${danglingCount} anchor(s) could not be matched -- see below.` : '';
        const message = `Span "${spanName}" loaded successfully.${danglingNote}`;
        testOnlyRenderOutcomes.set(document.uri.toString(), {
          ok: true,
          danglingCount,
          message
        });
      } catch (error) {
        if (disposed || generation !== renderGeneration) {
          return null;
        }
        const message = `Failed to render span history: ${error instanceof Error ? error.message : String(error)}`;
        renderPanel(webviewPanel.webview, message, []);
        testOnlyRenderOutcomes.set(document.uri.toString(), { ok: false, danglingCount: 0, message });
      }

      return watchedPaths;
    };

    /**
     * Add a filesystem watcher for `watchedPath` if one isn't already
     * tracked, wiring it to trigger `render` and registering its disposal
     * with `document`.
     *
     * @param watchedPath - The filesystem path to watch.
     * @returns Nothing.
     * @throws Never.
     */
    const ensureWatcher = (watchedPath: string): void => {
      if (watchers.has(watchedPath)) {
        return;
      }
      const watcher = vscode.workspace.createFileSystemWatcher(watchedPath);
      const onChange = (): void => {
        void render().then((renderedPaths) => {
          if (renderedPaths !== null) {
            for (const renderedPath of renderedPaths) {
              ensureWatcher(renderedPath);
            }
          }
        });
      };
      watcher.onDidChange(onChange);
      watcher.onDidCreate(onChange);
      watcher.onDidDelete(onChange);
      watchers.set(watchedPath, watcher);
      document.addDisposable(watcher);
    };

    document.addDisposable(
      new vscode.Disposable(() => {
        testOnlyRenderOutcomes.delete(document.uri.toString());
        testOnlyLastPostedDocument.delete(document.uri.toString());
      })
    );

    await render();
    if (disposed) {
      return;
    }
    // Register watchers for the span file and every anchor's real file
    // regardless of the initial render's outcome: a failed first render
    // (history load error, anchor matching error) returned without registering
    // anything, leaving the error panel dead to recovery -- with watchers in
    // place, fixing the underlying condition re-triggers the render, and the
    // panel's 'reload' handshake swaps back to the Monaco webview when the
    // next render posts a document.
    ensureWatcher(document.uri.fsPath);
    for (const anchor of parsed.anchors) {
      ensureWatcher(path.join(repoRoot, anchor.path));
    }
  }

  /**
   * Assemble the `PostedDocument` from the parsed span file, the anchor
   * plans, and the history document: one card per anchor (clean content read
   * from disk with the pre/post-stat race check), the uncommitted declaration
   * edit, per-commit history blocks, and the Stale pill's reasons.
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
  private async buildPostedDocument(options: {
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
        case 'clean': {
          const content = await readCleanContent(anchor, preSpawnStats, repoRoot);
          if (content === null) {
            changed++;
            anchors.push({ ...base, kind: 'changed' });
          } else {
            cleanContents.set(address, content);
            anchors.push({ ...base, kind: 'clean', content });
          }
          break;
        }
        case 'drifted':
        case 'reconciled':
          drifted++;
          anchors.push({ ...base, kind: plan.kind, historical: plan.historical, current: plan.current });
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

    let uncommittedEdit: PostedUncommittedEdit | 'unavailable' | undefined;
    if (history.current?.span_diff !== undefined) {
      try {
        const original = reconstructOriginal(history.current.span_diff, text, 1);
        uncommittedEdit = { path: `.span/${spanName}`, original, modified: text };
      } catch {
        uncommittedEdit = 'unavailable';
      }
    }

    const ladderInfos = resolveLadders(history, liveAnchors, plans, cleanContents);
    const postedHistory = buildPostedHistory(history, text, ladderInfos);

    const staleReasons: string[] = [];
    if (drifted > 0) {
      staleReasons.push(`${countLabel(drifted, 'anchor')} drifted`);
    }
    if (relocated > 0) {
      staleReasons.push(`${countLabel(relocated, 'anchor')} relocated`);
    }
    if (unavailable > 0) {
      staleReasons.push(`${countLabel(unavailable, 'anchor')} unavailable`);
    }
    if (changed > 0) {
      staleReasons.push(`${countLabel(changed, 'anchor')} changed while this span was being checked`);
    }
    if (dangling > 0) {
      staleReasons.push(`${countLabel(dangling, 'anchor')} without history`);
    }
    if (uncommittedEdit !== undefined) {
      staleReasons.push('span file edited in the working tree');
    }

    const posted: PostedDocument = {
      spanName,
      why,
      stale: staleReasons.length > 0,
      staleReasons,
      anchors,
      history: postedHistory
    };
    if (uncommittedEdit !== undefined) {
      posted.uncommittedEdit = uncommittedEdit;
    }
    return posted;
  }
}
