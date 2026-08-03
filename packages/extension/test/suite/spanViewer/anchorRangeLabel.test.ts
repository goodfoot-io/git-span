/**
 * Tests for the anchor header's line-range suffix.
 *
 * The null-versus-string distinction is the contract that matters: the caller
 * branches on it to decide whether to append an element at all, so a change
 * that returned `''` for a whole-file anchor would silently reintroduce an
 * empty span occupying a flex gap in the summary row.
 *
 * @summary Anchor line-range label tests.
 * @module test/suite/spanViewer/anchorRangeLabel.test
 */

import * as assert from 'node:assert';
import { anchorRangeLabel } from '../../../src/spanViewer/webview/anchorRangeLabel.js';

describe('anchorRangeLabel', () => {
  it('renders nothing for a whole-file anchor', () => {
    // Null rather than '' -- the caller omits the element entirely, and an
    // empty string would read as "render an empty suffix".
    assert.strictEqual(anchorRangeLabel(null), null);
  });

  it('renders a multi-line range as L<start>-L<end>', () => {
    assert.strictEqual(anchorRangeLabel({ start: 4, end: 100 }), 'L4-L100');
  });

  it('collapses a single-line range to L<start>', () => {
    assert.strictEqual(anchorRangeLabel({ start: 4, end: 4 }), 'L4');
  });

  it('collapses a single-line range at the first line of the file', () => {
    // 1 is the lowest start the span-file grammar admits, so this is the
    // bottom boundary of the 1-based inclusive contract.
    assert.strictEqual(anchorRangeLabel({ start: 1, end: 1 }), 'L1');
  });

  it('renders the shortest possible multi-line range', () => {
    // Adjacent lines are the boundary between the collapsed and expanded
    // forms: one line above start === end.
    assert.strictEqual(anchorRangeLabel({ start: 1, end: 2 }), 'L1-L2');
  });

  it('renders a range starting at the first line of the file', () => {
    assert.strictEqual(anchorRangeLabel({ start: 1, end: 100 }), 'L1-L100');
  });

  it('does not pad, group, or abbreviate large line numbers', () => {
    // The label has to match what the user reads in the .span file and in the
    // editor's gutter, so no thousands separators and no truncation.
    assert.strictEqual(anchorRangeLabel({ start: 1000, end: 24000 }), 'L1000-L24000');
  });
});
