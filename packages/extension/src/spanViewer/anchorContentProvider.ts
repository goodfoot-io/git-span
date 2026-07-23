/**
 * `TextDocumentContentProvider` for the `gitspan-anchor:` scheme used by the
 * Multi-Diff viewer's per-anchor virtual documents.
 *
 * Backed by an in-memory map populated by `spanFileEditorProvider.ts` before
 * each `vscode.changes` call (and again on live refresh); this module never
 * fetches content itself.
 *
 * @summary In-memory `TextDocumentContentProvider` for `gitspan-anchor:` URIs.
 * @module spanViewer/anchorContentProvider
 */

import * as vscode from 'vscode';

/**
 * Serves virtual document content for `gitspan-anchor:` URIs from an
 * in-memory map keyed by `uri.toString()`.
 */
export class AnchorContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();

  /** Fired when a previously-served URI's content has been replaced. */
  readonly onDidChange = this.changeEmitter.event;

  /**
   * Populate (or replace) the content served for `uri`.
   *
   * @param uri - The `gitspan-anchor:` URI to populate.
   * @param text - The content to serve for `uri`.
   * @returns Nothing.
   * @throws Never.
   */
  setContent(uri: vscode.Uri, text: string): void {
    this.contents.set(uri.toString(), text);
  }

  /**
   * Remove the previously-set content for `uri`, if any.
   *
   * @param uri - The `gitspan-anchor:` URI to remove.
   * @returns Nothing.
   * @throws Never.
   */
  delete(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }

  /**
   * VS Code's `TextDocumentContentProvider` contract entry point.
   *
   * @param uri - The `gitspan-anchor:` URI being read.
   * @returns The content previously set via `setContent`, or `''` when none
   *   has been set yet.
   * @throws Never.
   */
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  /**
   * Notify any open editor for `uri` that its content should be re-read.
   *
   * @param uri - The `gitspan-anchor:` URI whose content changed.
   * @returns Nothing.
   * @throws Never.
   */
  refresh(uri: vscode.Uri): void {
    this.changeEmitter.fire(uri);
  }

  /**
   * Dispose the underlying change emitter.
   *
   * @returns Nothing.
   * @throws Never.
   */
  dispose(): void {
    this.changeEmitter.dispose();
  }
}
