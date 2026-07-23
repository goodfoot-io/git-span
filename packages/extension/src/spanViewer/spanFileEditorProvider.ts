/**
 * `CustomReadonlyEditorProvider` for `.span/**` files -- the integration seam
 * that wires the pure `spanViewer` modules (`spanFileGrammar.ts`,
 * `historyClient.ts`, `anchorMatcher.ts`, `anchorUri.ts`) around VS Code's
 * `vscode.changes` Multi-Diff editor.
 *
 * This is deliberately the *only* module that imports both `vscode` and the
 * pure `spanViewer` logic -- every other file in this directory is either
 * pure (no `vscode` import) or `vscode`-only glue with no pure-logic import.
 *
 * @summary Wires the span viewer's pure logic into a read-only custom editor.
 * @module spanViewer/spanFileEditorProvider
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { type GitSpanCommandResult, resolveGitSpanBinaryOnPath, runGitSpanCommand } from '../utils/gitSpanBinary.js';
import type { AnchorContentProvider } from './anchorContentProvider.js';
import { matchAllAnchors } from './anchorMatcher.js';
import { buildAnchorUri } from './anchorUri.js';
import { getRepositoryForUri } from './gitRepository.js';
import { HistoryFormatError, parseHistoryJson } from './historyClient.js';
import { parseSpanFile } from './spanFileGrammar.js';
import type { AnchorPlan, LiveAnchor } from './types.js';

/** The `viewType` this provider is registered under in `package.json`'s `customEditors`. */
export const SPAN_FILE_VIEW_TYPE = 'gitSpan.spanFileViewer';

/** The scheme this provider's virtual anchor documents are served under. */
const ANCHOR_URI_SCHEME = 'gitspan-anchor';

/**
 * The outcome of a single `render()` pass, keyed by span document URI in
 * {@linkcode testOnlyRenderOutcomes}. Exists purely so end-to-end tests can
 * assert a real Multi-Diff open happened (as opposed to the error-fallback
 * pane, which also satisfies "a `gitSpan.spanFileViewer` tab is open") --
 * the installed `@types/vscode` has no `TabInputTextMultiDiff`-equivalent
 * type to assert against directly.
 */
export interface SpanRenderOutcome {
  /** True when the Multi-Diff editor was opened with at least one pane. */
  readonly ok: boolean;
  /** Number of `vscode.changes` resource tuples opened. */
  readonly resourceCount: number;
  /** Number of anchors omitted from the diff as dangling. */
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
 * Render the info/fallback/error pane shown in this custom editor's own
 * webview panel -- the tab for the `.span/*` file itself, distinct from any
 * Multi-Diff editor opened alongside it via `vscode.changes`.
 *
 * Always offers "Reopen as Text," per the card's requirement that a span's
 * own prose remain one action away from editing even when the diff view
 * rendered successfully.
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
      ? `<h2>${warnings.length} anchor(s) omitted from the diff</h2><p>git-span's history could not account for the following anchor(s) -- they may reference content this span's history has no record of. They are not shown in the Multi-Diff editor.</p><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
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
  </script>
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
 * Read-only Multi-Diff viewer for `.span/**` files.
 *
 * On open, parses the document as a span file, runs `git span history
 * --format json` for it, matches every anchor's live address against that
 * history, and opens one `vscode.changes` Multi-Diff editor pane per
 * non-dangling anchor. Dangling anchors are omitted from the diff and listed
 * in this custom editor's own webview panel instead. Non-span content and
 * any failure along the way falls back to the same webview panel with an
 * explanatory message and a "Reopen as Text" escape hatch.
 */
export class SpanFileEditorProvider implements vscode.CustomReadonlyEditorProvider<SpanCustomDocument> {
  constructor(
    private readonly contentProvider: AnchorContentProvider,
    private readonly runCommand: RunGitSpanCommandFn = runGitSpanCommand
  ) {}

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
   * Resolve the custom editor: parse, fetch history, match anchors, and open
   * the Multi-Diff editor (or an explanatory fallback pane) for `document`.
   *
   * @param document - The custom document model for the file being opened.
   * @param webviewPanel - The webview panel backing this editor's own tab.
   * @returns Resolves once the initial render (and any `vscode.changes`
   *   invocation) has completed.
   * @throws Never -- all failures render as a pane rather than propagating.
   */
  async resolveCustomEditor(document: SpanCustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };
    renderPanel(webviewPanel.webview, 'Loading span history…', []);

    let disposed = false;
    let inFlightController: AbortController | null = null;
    document.addDisposable(
      webviewPanel.onDidDispose(() => {
        disposed = true;
        inFlightController?.abort();
      })
    );

    webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'reopenAsText') {
        void vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
      }
    });

    const bytes = await vscode.workspace.fs.readFile(document.uri);
    if (disposed) {
      return;
    }
    const text = new TextDecoder('utf-8').decode(bytes);

    const parsed = parseSpanFile(text);
    if (parsed === null) {
      renderPanel(webviewPanel.webview, 'This file is not a recognized .span anchor file.', []);
      return;
    }

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
    const repoRoot = repository?.rootUri.fsPath ?? workspaceFolder?.uri.fsPath ?? path.dirname(document.uri.fsPath);

    const binaryPath = await resolveGitSpanBinaryOnPath();
    if (disposed) {
      return;
    }
    if (binaryPath === null) {
      renderPanel(webviewPanel.webview, 'git-span is not on PATH; cannot load this span’s history.', []);
      return;
    }

    const liveAnchors: LiveAnchor[] = parsed.anchors.map((anchor) => ({ path: anchor.path, range: anchor.range }));

    /** URIs ever published to `this.contentProvider` for this document, pruned on dispose. */
    const publishedAnchorUris = new Set<string>();
    /** Filesystem paths already watched, so re-renders only add watchers for newly-seen paths. */
    const watchers = new Map<string, vscode.Disposable>();

    /**
     * Fetch history, match anchors, publish anchor content, and open (or
     * re-open) the Multi-Diff editor with the current resource set.
     * Re-invoked by file watchers on subsequent changes -- `vscode.changes`
     * is safe to re-invoke on every render since VS Code dedupes identical
     * repeat calls, which keeps newly-added/removed anchors' panes in sync.
     *
     * @returns The set of filesystem paths watched for this render (the span
     *   file plus every non-dangling anchor's real file), or `null` when
     *   history could not be loaded or the tab was disposed before this
     *   render could complete.
     * @throws Never -- failures render as a pane rather than propagating.
     */
    const render = async (): Promise<Set<string> | null> => {
      const controller = new AbortController();
      inFlightController = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);

      let history: ReturnType<typeof parseHistoryJson>;
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
        if (disposed) {
          return null;
        }
        const message = `Failed to load span history: ${error instanceof Error ? error.message : String(error)}`;
        renderPanel(webviewPanel.webview, message, []);
        testOnlyRenderOutcomes.set(document.uri.toString(), { ok: false, resourceCount: 0, danglingCount: 0, message });
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

      const plans: AnchorPlan[] = matchAllAnchors(liveAnchors, history);
      const watchedPaths = new Set<string>([document.uri.fsPath]);
      const resources: [vscode.Uri, vscode.Uri, vscode.Uri][] = [];
      const dangling: string[] = [];

      plans.forEach((plan, index) => {
        const anchor = parsed.anchors[index];
        if (anchor === undefined) {
          return;
        }
        if (plan.kind === 'dangling') {
          dangling.push(
            anchor.range === null ? anchor.path : `${anchor.path}#L${anchor.range.start}-L${anchor.range.end}`
          );
          return;
        }

        const realFileUri = vscode.Uri.file(path.join(repoRoot, anchor.path));
        watchedPaths.add(realFileUri.fsPath);

        const originalText = plan.kind === 'clean' ? plan.content : (plan.historical ?? '');
        const modifiedText = plan.kind === 'clean' ? plan.content : (plan.current ?? '');

        const originalBuilt = buildAnchorUri({
          spanPath: spanName,
          anchorPath: anchor.path,
          anchorIndex: index,
          side: 'original'
        });
        const modifiedBuilt = buildAnchorUri({
          spanPath: spanName,
          anchorPath: anchor.path,
          anchorIndex: index,
          side: 'modified'
        });
        const originalUri = vscode.Uri.from({
          scheme: ANCHOR_URI_SCHEME,
          path: originalBuilt.path,
          query: originalBuilt.query
        });
        const modifiedUri = vscode.Uri.from({
          scheme: ANCHOR_URI_SCHEME,
          path: modifiedBuilt.path,
          query: modifiedBuilt.query
        });

        this.contentProvider.setContent(originalUri, originalText);
        this.contentProvider.setContent(modifiedUri, modifiedText);
        this.contentProvider.refresh(originalUri);
        this.contentProvider.refresh(modifiedUri);
        publishedAnchorUris.add(originalUri.toString());
        publishedAnchorUris.add(modifiedUri.toString());

        resources.push([originalUri, modifiedUri, realFileUri]);
      });

      if (disposed) {
        return null;
      }

      if (resources.length > 0) {
        const danglingNote =
          dangling.length > 0 ? ` ${dangling.length} anchor(s) could not be matched -- see below.` : '';
        const message = `Span "${spanName}" opened in the Multi-Diff editor.${danglingNote}`;
        renderPanel(webviewPanel.webview, message, dangling);
        await vscode.commands.executeCommand('vscode.changes', spanName, resources);
        testOnlyRenderOutcomes.set(document.uri.toString(), {
          ok: true,
          resourceCount: resources.length,
          danglingCount: dangling.length,
          message
        });
      } else {
        // Every anchor is dangling: keep this placeholder tab visible with
        // its warning rather than opening an empty Multi-Diff editor.
        const message = `No anchors in span "${spanName}" could be matched against its history.`;
        renderPanel(webviewPanel.webview, message, dangling);
        testOnlyRenderOutcomes.set(document.uri.toString(), {
          ok: false,
          resourceCount: 0,
          danglingCount: dangling.length,
          message
        });
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
        for (const uri of publishedAnchorUris) {
          this.contentProvider.delete(vscode.Uri.parse(uri));
        }
        testOnlyRenderOutcomes.delete(document.uri.toString());
      })
    );

    const watchedPaths = await render();
    if (watchedPaths !== null) {
      for (const watchedPath of watchedPaths) {
        ensureWatcher(watchedPath);
      }
    }
  }
}
