/**
 * `CustomReadonlyEditorProvider` for `.span/**` files -- the integration seam
 * that wires the pure `spanViewer` modules (`spanFileGrammar.ts`,
 * `historyClient.ts`, `anchorMatcher.ts`, `historySnapshotLadder.ts`) around
 * VS Code's custom-editor lifecycle: parse the span file, fetch
 * `git span history --format json`, match anchors against it, read clean
 * anchor content from disk, and `postMessage` the fully-resolved
 * `PostedDocument` to the Monaco webview.
 *
 * The per-document render lifecycle -- generation counter, abort controllers,
 * debounce timer, watchers -- lives in `spanRenderSession.ts`, a pure module
 * this provider constructs per document and feeds injected IO (`vscode`
 * workspace reads, CLI spawning, watcher creation, webview posting).
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

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveGitSpanBinaryOnPath, runGitSpanCommand } from '../utils/gitSpanBinary.js';
import { getRepositoryForUri, repositoryResolutionFailureMessage } from './gitRepository.js';
import { type ParsedSpanFile, parseSpanFile } from './spanFileGrammar.js';
import {
  type RunGitSpanCommandFn,
  SpanRenderSession,
  testOnlyLastPostedDocument,
  testOnlyRenderOutcomes,
  testOnlyWatcherCoalescingStats
} from './spanRenderSession.js';
import { type HostToWebviewMessage, isWebviewToHostMessage, MESSAGE_TYPES, type MonacoBaseTheme } from './types.js';

/** The `viewType` this provider is registered under in `package.json`'s `customEditors`. */
export const SPAN_FILE_VIEW_TYPE = 'gitSpan.spanFileViewer';

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
 * Build a cryptographically random nonce for the webviews'
 * Content-Security-Policy. `crypto.randomBytes` (CSPRNG) per VS Code's
 * webview guidance; nonces drawn from predictable PRNGs defeat the
 * allowlist a nonce-based `script-src` is meant to provide.
 *
 * @returns A fresh 16-byte nonce, base64-encoded.
 * @throws Never.
 */
function makeNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * The single construction site for both HTML surfaces' Content-Security-Policy
 * header content, so the panel and the Monaco webview cannot drift apart on
 * security policy.
 *
 * Both surfaces share the covenant: nothing by default (`default-src 'none'`),
 * inline styles for VS Code's injected theming variables, and scripts only via
 * the per-render {@linkcode makeNonce} value. A surface that additionally
 * loads resources from the webview origin passes its `vscode.Webview`, which
 * contributes `style-src`/`font-src`/`connect-src`/`img-src` allowances plus
 * Blob-backed worker construction for the Monaco bundle. Passing `null`
 * yields the fallback panel's minimal policy -- it renders only inline script
 * and styles and fetches nothing.
 *
 * @param nonce - The per-render nonce scoping `script-src`.
 * @param webview - The resource-loading webview whose origin may be fetched
 *   from, or `null` for the resource-free fallback panel.
 * @returns The CSP directive list for the `Content-Security-Policy` meta tag.
 * @throws Never.
 */
function buildCsp(nonce: string, webview: vscode.Webview | null): string {
  const origin = webview === null ? null : webview.cspSource;
  const directives = [
    "default-src 'none'",
    origin === null ? "style-src 'unsafe-inline'" : `style-src 'unsafe-inline' ${origin}`,
    `script-src 'nonce-${nonce}'`
  ];
  if (origin !== null) {
    directives.push(`font-src 'self' ${origin}`, 'worker-src blob:', `connect-src ${origin}`, `img-src ${origin}`);
  }
  return `${directives.join('; ')};`;
}

/**
 * Test-only handle on {@linkcode buildCsp}: exists purely so unit tests can
 * pin both surfaces' policies byte-for-byte without rendering a webview.
 *
 * @param nonce - The per-render nonce scoping `script-src`.
 * @param webview - The resource-loading webview whose origin may be fetched
 *   from, or `null` for the resource-free fallback panel.
 * @returns The CSP directive list for the `Content-Security-Policy` meta tag.
 * @throws Never.
 */
export const testOnlyBuildCsp: (nonce: string, webview: vscode.Webview | null) => string = buildCsp;

/**
 * Test-only handle on {@linkcode makeNonce}: exists purely so unit tests can
 * assert the nonce source's randomness without rendering a webview.
 *
 * @returns A fresh 16-byte nonce, base64-encoded.
 * @throws Never.
 */
export const testOnlyMakeNonce: () => string = makeNonce;

/**
 * Map a VS Code theme kind to the closest Monaco built-in base theme.
 *
 * @param kind - The active `vscode.ColorThemeKind`.
 * @returns The Monaco base theme name.
 * @throws Never.
 */
function monacoThemeKind(kind: vscode.ColorThemeKind): MonacoBaseTheme {
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
<meta http-equiv="Content-Security-Policy" content="${buildCsp(nonce, null)}">
</head>
<body>
  <p>${escapeHtml(message)}</p>
  ${warningsHtml}
  <button id="reopen-as-text">Reopen as Text</button>
  <script nonce="${nonce}">
    // Interpolated from the shared MESSAGE_TYPES table: the panel cannot
    // import the message unions, so the constants come to it verbatim.
    const MESSAGE_TYPES = ${JSON.stringify(MESSAGE_TYPES)};
    const vscode = acquireVsCodeApi();
    document.getElementById('reopen-as-text').addEventListener('click', () => {
      vscode.postMessage({ type: MESSAGE_TYPES.reopenAsText });
    });
    // A 'document' message reaching this panel means a render succeeded after
    // this error panel was shown -- swap back to the Monaco webview, which
    // renders the document it is re-posted on 'ready'. Without this listener
    // the panel would be dead to watcher-triggered re-renders, leaving the
    // tab stuck on the error until the user reopens it.
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message !== null && typeof message === 'object' && message.type === MESSAGE_TYPES.document) {
        vscode.postMessage({ type: MESSAGE_TYPES.reload });
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
function renderWebviewHtml(webview: vscode.Webview, themeKind: MonacoBaseTheme): string {
  const nonce = makeNonce();
  const mainJsUri = webview.asWebviewUri(vscode.Uri.file(path.join(WEBVIEW_DIR, 'main.js')));
  const mainCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(WEBVIEW_DIR, 'main.css')));
  return `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="${buildCsp(nonce, webview)}">
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
 * Every render pass -- the initial open and each watcher-triggered
 * re-render -- re-reads the span file through this, so anchors are matched
 * and `span_diff`s reconstructed against the current text, never an
 * open-time snapshot. The viewer is read-only, so the user's drift-fix
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
 *
 * Per-document render state (generation counter, abort controllers, debounce
 * timer, filesystem watchers) is owned by the document's
 * `SpanRenderSession`; this provider resolves the environment, wires the
 * webview, and delegates.
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
   * Resolve the custom editor: set up the webview, resolve the document's
   * environment (span name, repository root, CLI binary), then hand the
   * render lifecycle to the document's `SpanRenderSession` -- an immediate
   * first pass plus watchers that re-render on later changes.
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
    // Every host-to-webview post goes through this typed channel: the
    // compiler rejects any payload that is not a `HostToWebviewMessage`.
    const postToWebview = (message: HostToWebviewMessage): void => {
      void webviewPanel.webview.postMessage(message);
    };
    // The webview cannot observe workbench theme changes itself -- VS Code
    // only re-injects the `--vscode-*` variables -- so every change is relayed
    // and the webview re-bridges its Monaco theme. Disposed with the document.
    document.addDisposable(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        postToWebview({ type: MESSAGE_TYPES.themeChanged, kind: monacoThemeKind(theme.kind) });
      })
    );

    // From here on the session owns everything lifecycle-shaped: the
    // generation counter, the in-flight abort controllers, the debounce
    // timer coalescing watcher bursts, and the per-path watchers. This
    // function only resolves the environment, wires the webview, and drives
    // the session.
    const session = new SpanRenderSession({
      uri: document.uri,
      uriKey: document.uri.toString(),
      runCommand: this.runCommand,
      readSpanFile: (fsPath) => readSpanFile(vscode.Uri.file(fsPath)),
      createWatcher: (globPattern) => vscode.workspace.createFileSystemWatcher(globPattern),
      showFallback: (message) => {
        renderPanel(webviewPanel.webview, message, []);
      },
      postDocument: (posted) => {
        postToWebview({ type: MESSAGE_TYPES.document, document: posted });
      }
    });
    document.addDisposable(
      webviewPanel.onDidDispose(() => {
        session.dispose();
      })
    );

    // Mirror `is_span_name_segment()` in `packages/git-span/src/span_file_reader.rs`: dot-prefixed
    // names are config artifacts (.gitignore, .gitattributes, .hookignore, .advisorignore);
    // *.EDITMSG files are editor scratch; *.log files are dispatcher runtime diagnostics. None of
    // these will ever parse as a span — delegate to the default text editor without a parse attempt.
    const fileName = path.basename(document.uri.fsPath);
    if (fileName.startsWith('.') || fileName.endsWith('.EDITMSG') || fileName.endsWith('.log')) {
      void vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
      return;
    }

    const opened = await readSpanFile(document.uri);
    if (session.disposed) {
      return;
    }
    if (opened === null) {
      renderPanel(webviewPanel.webview, 'This file is not a recognized .span anchor file.', []);
      return;
    }
    // Only the anchor list for the initial watcher registration is taken from
    // this open-time parse; every render pass re-reads and re-parses the file
    // through `readSpanFile` inside the session.
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

    const resolution = await getRepositoryForUri(document.uri);
    if (session.disposed) {
      return;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    let repoRoot =
      resolution.status === 'resolved' ? resolution.repository.rootUri.fsPath : (workspaceFolder?.uri.fsPath ?? null);
    if (repoRoot === null) {
      // Neither vscode.git nor a workspace folder can place this span file in
      // a repository (e.g. the workspace does not contain the repo): walk up
      // from the span file's own directory to find a git repository root.
      repoRoot = await findRepoRootUpward(path.dirname(document.uri.fsPath));
    }
    if (session.disposed) {
      return;
    }
    if (repoRoot === null) {
      renderPanel(webviewPanel.webview, repositoryResolutionFailureMessage(resolution), []);
      return;
    }

    const binaryPath = await resolveGitSpanBinaryOnPath();
    if (session.disposed) {
      return;
    }
    if (binaryPath === null) {
      renderPanel(webviewPanel.webview, 'git-span is not on PATH; cannot load this span’s history.', []);
      return;
    }

    session.configure({ binaryPath, spanName, repoRoot });

    webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (!isWebviewToHostMessage(message)) {
        return;
      }
      switch (message.type) {
        case MESSAGE_TYPES.ready:
          if (session.lastPosted !== null) {
            postToWebview({ type: MESSAGE_TYPES.document, document: session.lastPosted });
          }
          return;
        case MESSAGE_TYPES.reload:
          // The error/fallback panel caught a 'document' post but cannot render
          // Monaco: swap back to the webview template. The fresh webview posts
          // 'ready' on load and the host re-posts `lastPosted` -- the document
          // the panel was handed.
          webviewPanel.webview.html = renderWebviewHtml(
            webviewPanel.webview,
            monacoThemeKind(vscode.window.activeColorTheme.kind)
          );
          return;
        case MESSAGE_TYPES.reopenAsText:
          void vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
          return;
        case MESSAGE_TYPES.goToFile: {
          const fileUri = vscode.Uri.file(path.join(repoRoot, message.path));
          if (message.range !== null) {
            const selection = new vscode.Range(message.range.start - 1, 0, message.range.end - 1, 0);
            void vscode.window.showTextDocument(fileUri, { selection, preview: true });
          } else {
            void vscode.window.showTextDocument(fileUri, { preview: true });
          }
          return;
        }
        case MESSAGE_TYPES.openCommit: {
          // VS Code's native commit navigation: the git extension's `git:`
          // scheme URI, resolved from the repository's root path.
          const uri = vscode.Uri.from({
            scheme: 'git',
            path: document.uri.fsPath,
            query: JSON.stringify({ path: document.uri.fsPath, ref: message.hash })
          });
          void vscode.commands.executeCommand('vscode.open', uri);
          return;
        }
      }
    });

    document.addDisposable(
      new vscode.Disposable(() => {
        // Document teardown must dispose the session (cancelling any pending
        // debounced re-render -- the timer would otherwise fire into a closed
        // panel) and drop this document's per-document test hooks alongside
        // the other per-document counters.
        session.dispose();
        testOnlyRenderOutcomes.delete(document.uri.toString());
        testOnlyLastPostedDocument.delete(document.uri.toString());
        testOnlyWatcherCoalescingStats.delete(document.uri.toString());
      })
    );

    await session.start();
    if (session.disposed) {
      return;
    }
    // Register watchers for the span file and every anchor's real file
    // regardless of the initial render's outcome: a failed first render
    // (history load error, anchor matching error) returns without registering
    // anything, leaving the error panel dead to recovery -- with watchers in
    // place, fixing the underlying condition re-triggers the render, and the
    // panel's 'reload' handshake swaps back to the Monaco webview when the
    // next render posts a document.
    session.ensureWatcher(document.uri.fsPath);
    for (const anchor of parsed.anchors) {
      session.ensureWatcher(path.join(repoRoot, anchor.path));
    }
  }
}
