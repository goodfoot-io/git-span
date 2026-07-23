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

  it('opens a valid-looking span file with no thrown exception', async () => {
    const spanFilePath = path.join(spanDir, 'fixture-span-test');
    fs.writeFileSync(spanFilePath, 'README.md rk64:deadbeef\n\nWhy this coupling exists.\n');

    const uri = vscode.Uri.file(spanFilePath);
    await vscode.commands.executeCommand('vscode.openWith', uri, SPAN_FILE_VIEW_TYPE);

    const opened = await waitFor(() => hasOpenCustomEditorTab(SPAN_FILE_VIEW_TYPE));
    assert.ok(opened, 'Expected a gitSpan.spanFileViewer tab to open for a valid-looking span file');
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
