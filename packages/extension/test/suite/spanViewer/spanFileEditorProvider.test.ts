/**
 * End-to-end test for the `.span/**` custom Multi-Diff viewer, exercised
 * through the real `gitSpan.spanFileViewer` custom editor registered by the
 * extension's `activate()` -- not a hand-rolled provider instance -- against
 * the fixture `git-span` binary installed on `PATH` by `test/runTest.ts`.
 *
 * @summary End-to-end test for the `.span/**` custom editor.
 * @module test/suite/spanViewer/spanFileEditorProvider.test
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { testOnlyRenderOutcomes } from '../../../src/spanViewer/spanFileEditorProvider.js';

const SPAN_FILE_VIEW_TYPE = 'gitSpan.spanFileViewer';

/**
 * Poll `predicate` until it returns `true` or `timeoutMs` elapses.
 *
 * @param predicate - Condition to poll.
 * @param timeoutMs - Maximum time to wait.
 * @returns Resolves with `true` once `predicate` passes, or `false` on timeout.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

/**
 * True when a tab for `viewType` is open in any tab group.
 *
 * @param viewType - The custom editor `viewType` to look for.
 * @returns Whether a matching tab is currently open.
 */
function hasOpenCustomEditorTab(viewType: string): boolean {
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === viewType)
  );
}

describe('spanFileEditorProvider (end-to-end)', () => {
  const workspacePath = process.env['TEST_WORKSPACE_PATH'];
  if (workspacePath === undefined) {
    throw new Error('TEST_WORKSPACE_PATH must be set by the test runner.');
  }
  const spanDir = path.join(workspacePath, '.span');

  before(() => {
    fs.mkdirSync(spanDir, { recursive: true });
  });

  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('opens a valid-looking span file with a real Multi-Diff editor, not the error fallback', async () => {
    const spanFilePath = path.join(spanDir, 'fixture-span-test');
    fs.writeFileSync(spanFilePath, 'README.md rk64:deadbeef\n\nWhy this coupling exists.\n');

    const uri = vscode.Uri.file(spanFilePath);
    testOnlyRenderOutcomes.delete(uri.toString());
    await vscode.commands.executeCommand('vscode.openWith', uri, SPAN_FILE_VIEW_TYPE);

    const opened = await waitFor(() => hasOpenCustomEditorTab(SPAN_FILE_VIEW_TYPE));
    assert.ok(opened, 'Expected a gitSpan.spanFileViewer tab to open for a valid-looking span file');

    const rendered = await waitFor(() => testOnlyRenderOutcomes.has(uri.toString()));
    assert.ok(rendered, 'Expected a render outcome to be recorded for the opened span document');

    const outcome = testOnlyRenderOutcomes.get(uri.toString());
    assert.ok(
      outcome?.ok,
      `Expected the Multi-Diff editor to open successfully (no "Failed to load span history" fallback), got: ${JSON.stringify(outcome)}`
    );
    assert.strictEqual(outcome.resourceCount, 1, 'Expected exactly one anchor pane to be opened');
    assert.strictEqual(outcome.danglingCount, 0, 'Expected no dangling anchors for this fixture span');
    assert.ok(
      !outcome.message.includes('Failed to load span history'),
      `Expected no error message, got: ${outcome.message}`
    );
  });

  it('does not steal editor focus on a content-only refresh triggered by the watched anchor file', async () => {
    const spanFilePath = path.join(spanDir, 'fixture-span-test');
    fs.writeFileSync(spanFilePath, 'README.md rk64:deadbeef\n\nWhy this coupling exists.\n');
    const readmePath = path.join(workspacePath, 'README.md');

    const uri = vscode.Uri.file(spanFilePath);
    testOnlyRenderOutcomes.delete(uri.toString());
    await vscode.commands.executeCommand('vscode.openWith', uri, SPAN_FILE_VIEW_TYPE);
    const opened = await waitFor(() => hasOpenCustomEditorTab(SPAN_FILE_VIEW_TYPE));
    assert.ok(opened, 'Expected a gitSpan.spanFileViewer tab to open for a valid-looking span file');
    await waitFor(() => testOnlyRenderOutcomes.has(uri.toString()));

    const otherFilePath = path.join(workspacePath, 'focus-steal-other.txt');
    fs.writeFileSync(otherFilePath, 'unrelated content\n');
    const otherUri = vscode.Uri.file(otherFilePath);
    const otherDoc = await vscode.workspace.openTextDocument(otherUri);
    await vscode.window.showTextDocument(otherDoc);
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.toString(),
      otherUri.toString(),
      'Expected the unrelated file to be focused before triggering the refresh'
    );

    // Content-only change to the anchor's real file: the watched file changes,
    // but the anchor set (and thus the vscode.changes resource set) does not.
    // Re-invoking vscode.changes on every render steals focus even when the
    // resource set is unchanged -- confirmed by a targeted spike -- so a
    // correct implementation must skip the re-invocation here.
    fs.writeFileSync(readmePath, '# Test Workspace (touched)\n');
    await new Promise((resolve) => setTimeout(resolve, 2500));

    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.toString(),
      otherUri.toString(),
      'Expected focus to remain on the unrelated file after a content-only span refresh'
    );
  });

  it('falls back gracefully for non-span content under .span/', async () => {
    const nonSpanFilePath = path.join(spanDir, 'not-a-span.txt');
    fs.writeFileSync(nonSpanFilePath, 'hello world\n\nsome random prose that is not an anchor line\n');

    const uri = vscode.Uri.file(nonSpanFilePath);
    await vscode.commands.executeCommand('vscode.openWith', uri, SPAN_FILE_VIEW_TYPE);

    const opened = await waitFor(() => hasOpenCustomEditorTab(SPAN_FILE_VIEW_TYPE));
    assert.ok(opened, 'Expected a gitSpan.spanFileViewer tab to open (fallback pane) for non-span content');
  });
});
