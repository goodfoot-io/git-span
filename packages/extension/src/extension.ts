/**
 * VS Code extension entry point for the Git Span CLI.
 *
 * Resolves `git-span` from PATH on demand. No managed install -- the binary
 * must be installed independently (npm, Homebrew, or direct download).
 *
 * @summary VS Code extension entry point for the Git Span CLI.
 */

import * as vscode from 'vscode';
import { AnchorContentProvider } from './spanViewer/anchorContentProvider.js';
import { SPAN_FILE_VIEW_TYPE, SpanFileEditorProvider } from './spanViewer/spanFileEditorProvider.js';
import {
  GitSpanBinaryError,
  getGitSpanBinaryErrorMessage,
  resolveGitSpanBinaryOnPath,
  runGitSpanCommand
} from './utils/gitSpanBinary.js';

/** Scheme served by the `.span/**` Multi-Diff viewer's virtual anchor documents. */
const ANCHOR_URI_SCHEME = 'gitspan-anchor';

const MISSING_GIT_SPAN_MESSAGE =
  'git-span is not on PATH. Install it from https://github.com/goodfoot-io/git-span/releases, or via npm / Homebrew (see installation docs at the repository).';

/**
 * Called by VS Code when the extension is activated.
 *
 * @param context - The VS Code extension context providing subscriptions and URIs.
 */
export function activate(context: vscode.ExtensionContext): void {
  // Drop any PATH entry persisted by a prior extension version that used a
  // managed install. New terminals will inherit the ambient PATH.
  try {
    context.environmentVariableCollection.clear();
  } catch (error) {
    console.error('Git Span: failed to clear environment variable collection:', error);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('gitSpan.showVersion', async () => {
      try {
        const binaryPath = await resolveGitSpanBinaryOnPath();
        if (binaryPath == null) {
          throw new GitSpanBinaryError(MISSING_GIT_SPAN_MESSAGE);
        }
        const result = await runGitSpanCommand(binaryPath, ['--version']);
        if (result.exitCode !== 0) {
          throw new Error(result.stderr.trim() || `git-span --version exited with code ${result.exitCode}.`);
        }
        void vscode.window.showInformationMessage(result.stdout.trim());
      } catch (error) {
        void vscode.window.showErrorMessage(`Git Span: ${getGitSpanBinaryErrorMessage(error)}`);
      }
    }),

    vscode.commands.registerCommand('gitSpan.openTerminal', async () => {
      try {
        const binaryPath = await resolveGitSpanBinaryOnPath();
        if (binaryPath == null) {
          throw new GitSpanBinaryError(MISSING_GIT_SPAN_MESSAGE);
        }
        const terminal = vscode.window.createTerminal({ name: 'Git Span' });
        terminal.show();
        terminal.sendText(`"${binaryPath}" --help`);
      } catch (error) {
        void vscode.window.showErrorMessage(`Git Span: ${getGitSpanBinaryErrorMessage(error)}`);
      }
    })
  );

  const anchorContentProvider = new AnchorContentProvider();
  context.subscriptions.push(
    anchorContentProvider,
    vscode.workspace.registerTextDocumentContentProvider(ANCHOR_URI_SCHEME, anchorContentProvider),
    vscode.window.registerCustomEditorProvider(SPAN_FILE_VIEW_TYPE, new SpanFileEditorProvider(anchorContentProvider), {
      supportsMultipleEditorsPerDocument: false
    })
  );
}

/**
 * Called by VS Code when the extension is deactivated.
 */
export function deactivate(): void {
  // No-op.
}
