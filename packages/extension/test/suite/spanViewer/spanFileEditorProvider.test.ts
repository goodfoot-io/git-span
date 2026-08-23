/**
 * End-to-end test for the `.span/**` custom editor, exercised through the
 * real `gitSpan.spanFileViewer` custom editor registered by the extension's
 * `activate()` -- not a hand-rolled provider instance -- against the fixture
 * `git-span` binary installed on `PATH` by `test/runTest.ts`.
 *
 * `vscode-test-electron` has no CDP hook into a webview's rendered DOM, so the
 * assertions run against `testOnlyLastPostedDocument` -- the exact object the
 * provider posted to the webview -- and `testOnlyRenderOutcomes`.
 *
 * @summary End-to-end test for the `.span/**` custom editor.
 * @module test/suite/spanViewer/spanFileEditorProvider.test
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  testOnlyLastPostedDocument,
  testOnlyRenderOutcomes,
  testOnlyWatcherCoalescingStats
} from '../../../src/spanViewer/spanFileEditorProvider.js';
import type { PostedDocument } from '../../../src/spanViewer/types.js';

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

  /** Content strings shared by the drifted fixture's ladder and the tests. */
  const S1 = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';
  const S2 = 'one\ntwo2\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';
  const S3 = 'one\ntwo2\nthree\nfour\nfive\nsix\nseven\neight drift\nnine\nten\n';

  before(() => {
    fs.mkdirSync(spanDir, { recursive: true });
  });

  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  /**
   * Write a span file, open it in the custom editor, and clear both test
   * hooks for it.
   *
   * @param spanFileName - The span file name under `.span/`.
   * @param content - The span file's content.
   * @returns The opened document's URI.
   * @throws Never.
   */
  async function openSpan(spanFileName: string, content: string): Promise<vscode.Uri> {
    const spanFilePath = path.join(spanDir, spanFileName);
    fs.writeFileSync(spanFilePath, content);
    const uri = vscode.Uri.file(spanFilePath);
    testOnlyRenderOutcomes.delete(uri.toString());
    testOnlyLastPostedDocument.delete(uri.toString());
    await vscode.commands.executeCommand('vscode.openWith', uri, SPAN_FILE_VIEW_TYPE);
    return uri;
  }

  /**
   * Wait for a render outcome to be recorded for `uri` and assert it is a
   * success (vs. the error or all-dangling fallback pane).
   *
   * @param uri - The opened span document's URI.
   * @returns The recorded outcome.
   * @throws Never.
   */
  async function waitForSuccessfulOutcome(uri: vscode.Uri) {
    const rendered = await waitFor(() => testOnlyRenderOutcomes.has(uri.toString()));
    assert.ok(rendered, 'Expected a render outcome to be recorded for the opened span document');
    const outcome = testOnlyRenderOutcomes.get(uri.toString());
    assert.ok(
      outcome?.ok,
      `Expected the span to render successfully (no fallback pane), got: ${JSON.stringify(outcome)}`
    );
    return outcome;
  }

  /**
   * Wait for the posted document to be recorded for `uri` and return it.
   *
   * @param uri - The opened span document's URI.
   * @returns The exact object posted to the webview.
   * @throws Never.
   */
  async function waitForPostedDocument(uri: vscode.Uri): Promise<PostedDocument> {
    const posted = await waitFor(() => testOnlyLastPostedDocument.has(uri.toString()));
    assert.ok(posted, 'Expected the provider to post a document to the webview');
    const document = testOnlyLastPostedDocument.get(uri.toString());
    assert.ok(document !== undefined, 'Expected the posted document to be readable back');
    return document;
  }

  it('renders a valid-looking span file with a successful outcome, not the error fallback', async () => {
    const uri = await openSpan('fixture-span-test', 'README.md rk64:deadbeef\n\nWhy this coupling exists.\n');

    const opened = await waitFor(() => hasOpenCustomEditorTab(SPAN_FILE_VIEW_TYPE));
    assert.ok(opened, 'Expected a gitSpan.spanFileViewer tab to open for a valid-looking span file');

    const outcome = await waitForSuccessfulOutcome(uri);
    assert.strictEqual(outcome.danglingCount, 0, 'Expected no dangling anchors for this fixture span');
    assert.ok(
      !outcome.message.includes('Failed to load span history'),
      `Expected no error message, got: ${outcome.message}`
    );

    const posted = await waitForPostedDocument(uri);
    assert.strictEqual(posted.spanName, 'fixture-span-test');
    assert.strictEqual(posted.why, 'Why this coupling exists.');
    assert.strictEqual(posted.drift, false, 'Expected a clean span to not carry the Drift pill');
    assert.deepStrictEqual(posted.driftReasons, []);

    // The test workspace is not a git repository, so `git log` reports nothing
    // and the resolver falls back to the declaration file's mtime -- the
    // never-committed case. Which of the two sources leads for a *tracked*
    // declaration is pinned by spanTimestamp.test.ts against injected readers.
    assert.ok(posted.updatedAt !== undefined, 'Expected the declaration timestamp to be posted');
    assert.strictEqual(
      posted.updatedAt,
      new Date(fs.statSync(path.join(spanDir, 'fixture-span-test')).mtimeMs).toISOString(),
      'Expected the never-committed declaration to fall back to its worktree mtime'
    );

    assert.strictEqual(posted.anchors.length, 1, 'Expected exactly one anchor card');
    const anchor = posted.anchors[0];
    assert.ok(
      anchor !== undefined && anchor.kind === 'clean',
      `Expected a clean anchor card, got: ${JSON.stringify(anchor)}`
    );
    assert.strictEqual(anchor.path, 'README.md');
    assert.strictEqual(anchor.range, null);
    assert.strictEqual(
      anchor.content,
      '# Test Workspace\n',
      'Expected the whole-file disk content in the clean preview'
    );

    assert.strictEqual(posted.history.length, 1, 'Expected one history accordion entry');
    const firstBlocks = posted.history[0]?.blocks;
    assert.ok(
      firstBlocks !== undefined && firstBlocks[0] !== undefined,
      'Expected the first commit to have a content block'
    );
    assert.deepStrictEqual(firstBlocks[0].pair, {
      original: '',
      modified: 'hello from fixture',
      originalStartLine: 1,
      modifiedStartLine: 1
    });
  });

  it('falls back gracefully for non-span content under .span/', async () => {
    const nonSpanFilePath = path.join(spanDir, 'not-a-span.txt');
    fs.writeFileSync(nonSpanFilePath, 'hello world\n\nsome random prose that is not an anchor line\n');

    const uri = vscode.Uri.file(nonSpanFilePath);
    await vscode.commands.executeCommand('vscode.openWith', uri, SPAN_FILE_VIEW_TYPE);

    const opened = await waitFor(() => hasOpenCustomEditorTab(SPAN_FILE_VIEW_TYPE));
    assert.ok(opened, 'Expected a gitSpan.spanFileViewer tab to open (fallback pane) for non-span content');
  });

  it('delegates a .span/ dotfile to the default text editor instead of showing the error webview', async () => {
    const dotFilePath = path.join(spanDir, '.gitignore');
    fs.writeFileSync(dotFilePath, '*.log\n');
    const uri = vscode.Uri.file(dotFilePath);
    testOnlyRenderOutcomes.delete(uri.toString());
    testOnlyLastPostedDocument.delete(uri.toString());

    await vscode.commands.executeCommand('vscode.openWith', uri, SPAN_FILE_VIEW_TYPE);

    const asText = await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === uri.fsPath);
    assert.ok(asText, 'Expected .span/.gitignore to open in a text editor, not the custom webview');
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.getText(),
      '*.log\n',
      'Expected the text editor to show the dotfile content itself'
    );
  });

  it('posts a drifted anchor with the reverse-applied historical side, and ladder-resolved history pairs', async () => {
    // The worktree file: drifted at line 8, outside the newest commit's hunk.
    fs.writeFileSync(path.join(workspacePath, 'src.ts'), S3);
    const uri = await openSpan('fixture-span-drifted', 'src.ts#L1-L10 rk64:deadbeef\n\nWhy.\n');

    const outcome = await waitForSuccessfulOutcome(uri);
    assert.strictEqual(outcome.danglingCount, 0);

    const posted = await waitForPostedDocument(uri);
    assert.strictEqual(posted.drift, true, 'Expected a drifted span to carry the Drift pill');
    assert.deepStrictEqual(posted.driftReasons, ['1 anchor drifted']);

    assert.strictEqual(posted.anchors.length, 1, 'Expected exactly one anchor card');
    const anchor = posted.anchors[0];
    assert.ok(
      anchor !== undefined && anchor.kind === 'drifted',
      `Expected a drifted anchor card, got: ${JSON.stringify(anchor)}`
    );
    assert.strictEqual(anchor.historical, S2, 'Expected the offset-normalized reverse-apply as the historical side');
    assert.strictEqual(anchor.current, S3, 'Expected the worktree content as the current side');

    assert.strictEqual(posted.history.length, 2, 'Expected both commits in the history accordion');
    const newestBlocks = posted.history[0]?.blocks;
    assert.ok(
      newestBlocks !== undefined && newestBlocks[0] !== undefined,
      'Expected the newest commit to have a content block'
    );
    assert.deepStrictEqual(newestBlocks[0].pair, {
      original: S1,
      modified: S2,
      originalStartLine: 1,
      modifiedStartLine: 1
    });
    const oldestBlocks = posted.history[1]?.blocks;
    assert.ok(
      oldestBlocks !== undefined && oldestBlocks[0] !== undefined,
      'Expected the oldest commit to have a content block'
    );
    assert.deepStrictEqual(oldestBlocks[0].pair, {
      original: '',
      modified: S1,
      originalStartLine: 1,
      modifiedStartLine: 1
    });
  });

  it("posts each side's file-absolute start line alongside history pairs and the anchor card", async () => {
    // The span declares a 10-line extent starting at file line 1641: the
    // gutter must number the history diff rows from 1641 (not 1), and the
    // drifted anchor card's sides must carry the same file-absolute starts
    // so the webview can cross-reference a row against the file on disk.
    fs.writeFileSync(path.join(workspacePath, 'src.ts'), S3);
    const uri = await openSpan('fixture-span-line-numbers', 'src.ts#L1641-L1650 rk64:deadbeef\n\nWhy.\n');

    const outcome = await waitForSuccessfulOutcome(uri);
    assert.strictEqual(outcome.danglingCount, 0);

    const posted = await waitForPostedDocument(uri);
    assert.strictEqual(posted.anchors.length, 1, 'Expected exactly one anchor card');
    const anchor = posted.anchors[0];
    assert.ok(
      anchor !== undefined && anchor.kind === 'drifted',
      `Expected a drifted anchor card, got: ${JSON.stringify(anchor)}`
    );
    assert.strictEqual(anchor.historical, S2, 'Expected the offset-normalized reverse-apply as the historical side');
    assert.strictEqual(anchor.current, S3, 'Expected the worktree content as the current side');
    const anchorCard = anchor as { historicalStartLine?: number; currentStartLine?: number };
    assert.strictEqual(anchorCard.historicalStartLine, 1641, 'Expected the historical side to start at file line 1641');
    assert.strictEqual(anchorCard.currentStartLine, 1641, 'Expected the current side to start at file line 1641');

    assert.strictEqual(posted.history.length, 2, 'Expected both commits in the history accordion');
    const newestBlocks = posted.history[0]?.blocks;
    assert.ok(
      newestBlocks !== undefined && newestBlocks[0] !== undefined,
      'Expected the newest commit to have a content block'
    );
    assert.deepStrictEqual(newestBlocks[0].pair, {
      original: S1,
      modified: S2,
      originalStartLine: 1641,
      modifiedStartLine: 1641
    });
  });

  it('posts both the header-only rebound block and the content block for a rebind-plus-edit commit', async () => {
    const postState = 'one\ntwo changed\nthree\n';
    const preState = 'one\ntwo\nthree\n';
    fs.writeFileSync(path.join(workspacePath, 'src.ts'), postState);
    const uri = await openSpan('fixture-span-rebind-edit', 'src.ts#L1-L3 rk64:deadbeef\n\nWhy.\n');

    await waitForSuccessfulOutcome(uri);
    const posted = await waitForPostedDocument(uri);

    assert.strictEqual(posted.anchors.length, 1, 'Expected exactly one anchor card');
    const anchor = posted.anchors[0];
    assert.ok(
      anchor !== undefined && anchor.kind === 'clean',
      `Expected a clean anchor card, got: ${JSON.stringify(anchor)}`
    );
    assert.strictEqual(anchor.content, postState, 'Expected the disk content in the clean preview');

    assert.strictEqual(posted.history.length, 1, 'Expected one history accordion entry');
    const blocks = posted.history[0]?.blocks;
    assert.ok(
      blocks !== undefined && blocks.length === 2,
      `Expected two blocks at one address, got: ${JSON.stringify(blocks)}`
    );
    assert.strictEqual(blocks[0]?.path, 'src.ts#L1-L3');
    assert.deepStrictEqual(blocks[0]?.rebound, { from: 'rk64:aaaa', to: 'rk64:bbbb' });
    assert.ok(blocks[0]?.pair === undefined, 'Expected the rebound block to be header-only (no diff editor)');
    assert.strictEqual(blocks[1]?.path, 'src.ts#L1-L3');
    assert.deepStrictEqual(blocks[1]?.pair, {
      original: preState,
      modified: postState,
      originalStartLine: 1,
      modifiedStartLine: 1
    });
  });

  it('reads same-file anchors once and concurrently, slicing extents equivalently and failing closed on a bare-CR final line', async () => {
    // Five clean anchors across four files -- two sharing multi.txt -- so the
    // path-deduped read pass backs both multi.txt cards with one trusted
    // read. nl/nonl pin the slice equivalence at the last line with and
    // without a trailing newline; cr.txt ends with a bare '\\r' final split
    // element whose three-line claim must yield the "content changed" card
    // (the pre-fix mapped pop dropped it; a raw-empty-only pop would render).
    fs.writeFileSync(path.join(workspacePath, 'multi.txt'), 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\n');
    fs.writeFileSync(path.join(workspacePath, 'nl.txt'), 'alpha\nbeta\ngamma\n');
    fs.writeFileSync(path.join(workspacePath, 'nonl.txt'), 'alpha\nbeta\ngamma');
    fs.writeFileSync(path.join(workspacePath, 'cr.txt'), 'alpha\nbeta\n\r');
    const declaration = [
      'multi.txt#L1-L2 rk64:aaaaaa01',
      'multi.txt#L5-L6 rk64:bbbbbb02',
      'nl.txt#L1-L3 rk64:cccccc03',
      'nonl.txt#L1-L3 rk64:dddddd04',
      'cr.txt#L1-L3 rk64:eeeeee05',
      '',
      'Why these anchors share files.'
    ].join('\n');
    const uri = await openSpan('fixture-span-multi', declaration);

    await waitForSuccessfulOutcome(uri);
    const posted = await waitForPostedDocument(uri);

    assert.strictEqual(posted.anchors.length, 5, 'Expected one card per declared anchor');
    const [firstShared, secondShared, withNewline, withoutNewline, bareCr] = posted.anchors;
    assert.ok(firstShared?.kind === 'clean', `Expected a clean card, got: ${JSON.stringify(firstShared)}`);
    assert.strictEqual(firstShared.content, 'alpha\nbeta\n');
    assert.ok(secondShared?.kind === 'clean', `Expected a clean card, got: ${JSON.stringify(secondShared)}`);
    assert.strictEqual(
      secondShared.content,
      'epsilon\nzeta\n',
      'Expected the second same-file anchor to slice its own extent from the shared read'
    );
    assert.ok(withNewline?.kind === 'clean', `Expected a clean card, got: ${JSON.stringify(withNewline)}`);
    assert.strictEqual(withNewline.content, 'alpha\nbeta\ngamma\n');
    assert.ok(withoutNewline?.kind === 'clean', `Expected a clean card, got: ${JSON.stringify(withoutNewline)}`);
    assert.strictEqual(
      withoutNewline.content,
      'alpha\nbeta\ngamma\n',
      'Expected a no-trailing-newline source to slice identically to its newline-terminated twin'
    );
    assert.ok(
      bareCr !== undefined && bareCr.kind === 'changed',
      `Expected the bare-CR final line to fail closed to "changed", got: ${JSON.stringify(bareCr)}`
    );

    // The single fixture commit carries every address's content block, so the
    // accordion keeps one entry per address -- including both same-file
    // addresses, whose cleanContents seeds fed the ladder exactly as before.
    assert.strictEqual(posted.history.length, 1, 'Expected one accordion entry for the single fixture commit');
    const blocks = posted.history[0]?.blocks;
    assert.ok(blocks !== undefined, 'Expected history blocks for the fixture commit');
    const firstSharedBlocks = blocks.filter((block) => block.path === 'multi.txt#L1-L2');
    assert.ok(
      firstSharedBlocks[0]?.pair !== undefined,
      `Expected the shared address to keep its content block, got: ${JSON.stringify(firstSharedBlocks)}`
    );
    assert.deepStrictEqual(firstSharedBlocks[0].pair, {
      original: '',
      modified: 'alpha\nbeta\n',
      originalStartLine: 1,
      modifiedStartLine: 1
    });
    assert.ok(
      blocks.some((block) => block.path === 'multi.txt#L5-L6'),
      'Expected the second same-file address to keep its own accordion block'
    );
  });

  it('posts the "content changed" status card when the anchor file is edited between the CLI spawn and the disk read, and still posts the history accordion entry', async () => {
    // The fixture binary appends to race-target.ts during the CLI spawn, so
    // the provider's pre-spawn stat (original size) disagrees with its
    // post-read stat (appended size) -- the read must not be trusted. The
    // race only invalidates the clean preview, never the history ladder (a
    // pure string computation over the certified JSON payload), so the
    // accordion must still show the anchor's per-commit diff.
    fs.writeFileSync(path.join(workspacePath, 'race-target.ts'), 'hello from fixture\n');
    const uri = await openSpan('fixture-span-race', 'race-target.ts rk64:deadbeef\n\nWhy.\n');

    await waitForSuccessfulOutcome(uri);
    const posted = await waitForPostedDocument(uri);

    assert.strictEqual(posted.anchors.length, 1, 'Expected exactly one anchor card');
    const anchor = posted.anchors[0];
    assert.ok(
      anchor !== undefined && anchor.kind === 'changed',
      `Expected the raced read to post a "content changed" status card, got: ${JSON.stringify(anchor)}`
    );
    assert.strictEqual(posted.drift, true, 'Expected a raced read to make the span drift');

    assert.strictEqual(posted.history.length, 1, 'Expected the raced anchor to keep its history accordion entry');
    const blocks = posted.history[0]?.blocks;
    assert.ok(
      blocks !== undefined && blocks[0] !== undefined,
      'Expected a content block for the raced anchor in the history accordion'
    );
    assert.deepStrictEqual(blocks[0].pair, {
      original: '',
      modified: 'hello from fixture',
      originalStartLine: 1,
      modifiedStartLine: 1
    });
  });

  it('renders the all-dangling state as a posted document and re-renders when the anchor file is restored', async () => {
    // missing-file.ts does not exist: the pre-spawn stat's ENOENT must be
    // recorded as the absent-at-snapshot sentinel, not thrown upstream of the
    // all-dangling state.
    const uri = await openSpan('fixture-span-dangling', 'missing-file.ts rk64:deadbeef\n\nWhy.\n');

    const opened = await waitFor(() => hasOpenCustomEditorTab(SPAN_FILE_VIEW_TYPE));
    assert.ok(opened, 'Expected a gitSpan.spanFileViewer tab to open for a dangling span');

    const rendered = await waitFor(() => testOnlyRenderOutcomes.has(uri.toString()));
    assert.ok(rendered, 'Expected a render outcome to be recorded for the dangling span');
    const outcome = testOnlyRenderOutcomes.get(uri.toString());
    assert.ok(
      outcome !== undefined && !outcome.ok,
      `Expected the all-dangling fallback outcome, got: ${JSON.stringify(outcome)}`
    );
    assert.strictEqual(outcome.danglingCount, 1, 'Expected the dangling anchor to be counted');

    // The all-dangling state is a posted document, not a replaced webview:
    // the Monaco webview keeps its 'document' listener so a watcher-triggered
    // render can re-render in place once the underlying condition is fixed.
    const firstPosted = await waitForPostedDocument(uri);
    assert.strictEqual(firstPosted.anchors.length, 1, 'Expected exactly one dangling anchor card');
    const anchor = firstPosted.anchors[0];
    assert.ok(
      anchor !== undefined && anchor.kind === 'dangling',
      `Expected a dangling anchor card, got: ${JSON.stringify(anchor)}`
    );
    assert.deepStrictEqual(firstPosted.history, [], 'Expected no history accordion entries for a dangling span');
    assert.strictEqual(firstPosted.drift, true, 'Expected an all-dangling span to carry the Drift pill');
    assert.deepStrictEqual(firstPosted.driftReasons, ['1 anchor without history']);

    // Restore the anchor file: the watcher re-renders and posts a fresh
    // document into the same, still-listening webview -- never into a dead
    // fallback panel. (This fixture's history has no commits at all, so the
    // anchor stays dangling; the assertion is that the re-render still
    // reaches the webview.)
    fs.writeFileSync(path.join(workspacePath, 'missing-file.ts'), 'recovered content\n');
    const reRendered = await waitFor(() => testOnlyLastPostedDocument.get(uri.toString()) !== firstPosted);
    assert.ok(reRendered, 'Expected the watcher-triggered render to post a fresh document into the webview');
  });

  it('coalesces a burst of anchor-file writes into one trailing re-render showing the final content', async () => {
    // A chunked save fires the watcher once per chunk; without coalescing
    // each event pays a full render pipeline. Six rapid writes must produce
    // at most a couple of debounced renders (the trailing one wins), and the
    // posted document must show the final write's content -- proving no
    // trailing event was dropped by the coalescing.
    const churnPath = path.join(workspacePath, 'churn-target.ts');
    fs.writeFileSync(churnPath, 'burst 0\n');
    const uri = await openSpan('fixture-span-churn', 'churn-target.ts rk64:deadbeef\n\nWhy.\n');
    await waitForSuccessfulOutcome(uri);
    const firstPosted = await waitForPostedDocument(uri);
    assert.strictEqual(firstPosted.anchors[0]?.kind, 'clean', 'Expected the pre-burst anchor to be clean');

    // The stats entry is created on first observed event; the open-time
    // render never touches it, so baseline counters start at zero.
    const baseline = { coalescedEvents: 0, debouncedRenders: 0 };
    const statsBefore = testOnlyWatcherCoalescingStats.get(uri.toString());
    if (statsBefore !== undefined) {
      baseline.coalescedEvents = statsBefore.coalescedEvents;
      baseline.debouncedRenders = statsBefore.debouncedRenders;
    }

    const burstContents = ['burst 1\n', 'burst 2\n', 'burst 3\n', 'burst 4\n', 'burst 5\n', 'burst 6\n'];
    // Spaced, not synchronous: the filesystem layer merges same-instant
    // writes into one change event, which would collapse the burst before
    // the provider ever saw it. ~80ms gaps stay well inside the 300ms
    // debounce window while surfacing as distinct events.
    for (const content of burstContents) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      fs.writeFileSync(churnPath, content);
    }
    const finalContent = burstContents[burstContents.length - 1];

    // Wait for the trailing re-render and assert it carries the final
    // state, not an intermediate chunk.
    const reRendered = await waitFor(() => {
      const document = testOnlyLastPostedDocument.get(uri.toString());
      return (
        document !== undefined &&
        document !== firstPosted &&
        document.anchors[0]?.kind === 'clean' &&
        document.anchors[0]?.content === finalContent
      );
    });
    assert.ok(reRendered, 'Expected a trailing re-render posting the final burst content');

    const statsAfter = testOnlyWatcherCoalescingStats.get(uri.toString());
    assert.ok(statsAfter !== undefined, 'Expected watcher coalescing stats to be recorded for the document');
    const observedDelta = statsAfter.observedEvents - (statsBefore?.observedEvents ?? 0);
    const coalescedDelta = statsAfter.coalescedEvents - baseline.coalescedEvents;
    const rendersDelta = statsAfter.debouncedRenders - baseline.debouncedRenders;
    // VS Code does not guarantee one watcher event per write (it may drop or
    // merge some), so these are bounds, not exact counts. The burst must
    // actually reach the provider as multiple events; most of them are then
    // absorbed by the debounce; and far fewer renders ran than the
    // un-debounced cost of one pipeline per event. The upper bound tolerates
    // late stragglers scheduling one extra trailing render beyond the
    // burst's own.
    assert.ok(observedDelta >= 3, `Expected the burst to surface as several watcher events, got ${observedDelta}`);
    assert.ok(coalescedDelta >= 2, `Expected most burst events to be coalesced, got ${coalescedDelta} coalesced`);
    assert.ok(
      rendersDelta >= 1 && rendersDelta <= 2,
      `Expected at most two debounced renders for the six-write burst, got ${rendersDelta}`
    );
  });

  it('posts the uncommitted declaration edit card from current.span_diff', async () => {
    fs.writeFileSync(path.join(workspacePath, 'src.ts'), 'line one\nline two\nline three\n');
    // current.span_diff's new side is the worktree declaration -- the disk
    // text must carry it for the reverse-apply's post-region check to match.
    const uri = await openSpan(
      'fixture-span-uncommitted',
      'src.ts#L1-L3 rk64:deadbeef\n\nWhy this coupling still exists.\n'
    );

    await waitForSuccessfulOutcome(uri);
    const posted = await waitForPostedDocument(uri);

    assert.strictEqual(posted.anchors.length, 1, 'Expected exactly one anchor card');
    const anchor = posted.anchors[0];
    assert.ok(
      anchor !== undefined && anchor.kind === 'clean',
      `Expected a clean anchor card, got: ${JSON.stringify(anchor)}`
    );
    assert.strictEqual(anchor.content, 'line one\nline two\nline three\n');

    assert.ok(posted.uncommittedEdit !== undefined, 'Expected the uncommitted edit card to be posted');
    assert.ok(
      posted.uncommittedEdit !== 'unavailable',
      'Expected the uncommitted edit to be resolved, not unavailable'
    );
    assert.deepStrictEqual(posted.uncommittedEdit, {
      path: '.span/fixture-span-uncommitted',
      original: 'src.ts#L1-L3 rk64:deadbeef\n\nWhy this coupling exists.\n',
      modified: 'src.ts#L1-L3 rk64:deadbeef\n\nWhy this coupling still exists.\n'
    });
    assert.strictEqual(posted.drift, true, 'Expected an uncommitted declaration edit to make the span drift');
    assert.deepStrictEqual(posted.driftReasons, ['span file edited in the working tree']);

    // The dirty branch leads with the worktree mtime, so the posted timestamp
    // tracks the edit rather than any commit date.
    assert.ok(posted.updatedAt !== undefined, 'Expected the declaration timestamp to be posted');
    assert.strictEqual(
      posted.updatedAt,
      new Date(fs.statSync(path.join(spanDir, 'fixture-span-uncommitted')).mtimeMs).toISOString(),
      'Expected a dirty declaration to report its worktree mtime'
    );
  });

  // The titlebar's edit button posts `reopenAsText`, whose handler runs
  // `vscode.openWith(uri, 'default')`. A `.span` file already has a custom
  // editor bound to it, so this pins the non-obvious half of that call: that
  // `'default'` overrides the custom editor rather than being ignored. It
  // exercises the handler's payload, not its dispatch -- the webview's
  // postMessage channel is not reachable from the extension host.
  it("reopens a span already showing in the custom editor as plain text via the 'default' view type", async () => {
    const uri = await openSpan('fixture-span-test', 'README.md rk64:deadbeef\n\nWhy this coupling exists.\n');
    const opened = await waitFor(() => hasOpenCustomEditorTab(SPAN_FILE_VIEW_TYPE));
    assert.ok(opened, 'Expected the custom editor to claim the span file first');

    await vscode.commands.executeCommand('vscode.openWith', uri, 'default');

    const asText = await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === uri.fsPath);
    assert.ok(asText, "Expected 'default' to open the span file in a real text editor");
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.getText(),
      'README.md rk64:deadbeef\n\nWhy this coupling exists.\n',
      'Expected the text editor to show the span file itself, not a rendered view'
    );
  });
});
