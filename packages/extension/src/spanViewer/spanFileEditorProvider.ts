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
      ? `<h2>Dangling anchors</h2><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
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
    webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'reopenAsText') {
        void vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
      }
    });

    const bytes = await vscode.workspace.fs.readFile(document.uri);
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
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const repoRoot = repository?.rootUri.fsPath ?? workspaceFolder?.uri.fsPath ?? path.dirname(document.uri.fsPath);

    const binaryPath = await resolveGitSpanBinaryOnPath();
    if (binaryPath === null) {
      renderPanel(webviewPanel.webview, 'git-span is not on PATH; cannot load this span’s history.', []);
      return;
    }

    const liveAnchors: LiveAnchor[] = parsed.anchors.map((anchor) => ({ path: anchor.path, range: anchor.range }));

    /**
     * Fetch history, match anchors, publish anchor content, and (on the
     * initial call only) open the Multi-Diff editor. Re-invoked by file
     * watchers on subsequent changes, which only refresh already-published
     * content -- per the spike, re-invoking `vscode.changes` is unnecessary.
     *
     * @param invokeChanges - Whether to call `vscode.changes` after
     *   publishing anchor content (true on initial open, false on
     *   watcher-triggered refreshes).
     * @returns The set of filesystem paths watched for this render (the span
     *   file plus every non-dangling anchor's real file), or `null` when
     *   history could not be loaded.
     * @throws Never -- failures render as a pane rather than propagating.
     */
    const render = async (invokeChanges: boolean): Promise<Set<string> | null> => {
      let history: ReturnType<typeof parseHistoryJson>;
      try {
        const result = await this.runCommand(
          binaryPath,
          ['span', 'history', spanName, '--format', 'json'],
          undefined,
          repoRoot
        );
        if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
          throw new HistoryFormatError(
            `git-span history exited with code ${result.exitCode}: ${result.stderr.trim() || '(no output)'}`
          );
        }
        history = parseHistoryJson(result.stdout);
      } catch (error) {
        renderPanel(
          webviewPanel.webview,
          `Failed to load span history: ${error instanceof Error ? error.message : String(error)}`,
          []
        );
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
        const modifiedText = plan.kind === 'clean' ? plan.content : plan.current;

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

        resources.push([originalUri, modifiedUri, realFileUri]);
      });

      if (resources.length > 0) {
        renderPanel(webviewPanel.webview, `Span "${spanName}" opened in the Multi-Diff editor.`, dangling);
        if (invokeChanges) {
          await vscode.commands.executeCommand('vscode.changes', spanName, resources);
        }
      } else {
        // Every anchor is dangling: keep this placeholder tab visible with
        // its warning rather than opening an empty Multi-Diff editor.
        renderPanel(
          webviewPanel.webview,
          `No anchors in span "${spanName}" could be matched against its history.`,
          dangling
        );
      }

      return watchedPaths;
    };

    const watchedPaths = await render(true);
    if (watchedPaths !== null) {
      for (const watchedPath of watchedPaths) {
        const watcher = vscode.workspace.createFileSystemWatcher(watchedPath);
        const onChange = (): void => {
          void render(false);
        };
        watcher.onDidChange(onChange);
        watcher.onDidCreate(onChange);
        watcher.onDidDelete(onChange);
        document.addDisposable(watcher);
      }
    }
  }
}
