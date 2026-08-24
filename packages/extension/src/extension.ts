/**
 * VS Code extension entry point for the Git Span CLI.
 *
 * Resolves `git-span` from PATH on demand. No managed install -- the binary
 * must be installed independently (npm, Homebrew, or direct download).
 *
 * @summary VS Code extension entry point for the Git Span CLI.
 */

import * as vscode from 'vscode';
import { SPAN_FILE_VIEW_TYPE, SpanFileEditorProvider } from './spanViewer/spanFileEditorProvider.js';
import {
  describeGitSpanOutputTruncation,
  GitSpanBinaryError,
  getGitSpanBinaryErrorMessage,
  resolveGitSpanBinaryOnPath,
  runGitSpanCommand
} from './utils/gitSpanBinary.js';

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
          throw new Error(
            `${result.stderr.trim() || `git-span --version exited with code ${result.exitCode}.`}${describeGitSpanOutputTruncation(result)}`
          );
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

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(SPAN_FILE_VIEW_TYPE, new SpanFileEditorProvider(), {
      supportsMultipleEditorsPerDocument: false,
      // Keep each span editor's webview content (DOM, scroll position, Monaco
      // instances, open/closed cards) alive while its tab is hidden. Without
      // this the panel is destroyed on hidden and reloaded on return, and the
      // ready/re-post handshake can only recover the document, never the view.
      // The trade is resident memory per open span tab for as long as the tab
      // stays open -- accepted in exchange for no reload flicker and no
      // view-state loss.
      webviewOptions: { retainContextWhenHidden: true }
    })
  );
}

/**
 * Called by VS Code when the extension is deactivated.
 */
export function deactivate(): void {
  // No-op.
}
