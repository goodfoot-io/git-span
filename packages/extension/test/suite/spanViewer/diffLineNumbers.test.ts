/**
 * Tests for the per-side gutter line-number renderer of embedded diff editors.
 *
 * The renderer is a pure mapping from a model row to the file line it stands
 * for: row 1 is the extent's first line, and every row after that steps one
 * file line. The interesting cases are the anchor extents that do not start at
 * line 1 -- a block titled `f.txt#L1641-L1996` must read `1641` on its first
 * row -- and the identity case for whole-file anchors, where the renderer must
 * not alter Monaco's numbering.
 *
 * @summary Pins the gutter offset for anchor-extent diff editors.
 * @module test/suite/spanViewer/diffLineNumbers.test
 */

import * as assert from 'node:assert/strict';
import { gutterLineNumbers } from '../../../src/spanViewer/webview/diffLineNumbers.js';

describe('spanViewer/diffLineNumbers', () => {
  describe('gutterLineNumbers', () => {
    it('renders the extent start on the first row', () => {
      const render = gutterLineNumbers(1641);
      assert.equal(render(1), '1641');
    });

    it('steps one file line per model row', () => {
      const render = gutterLineNumbers(1641);
      assert.equal(render(2), '1642');
      assert.equal(render(356), '1996');
    });

    it('is the identity for a whole-file extent starting at line 1', () => {
      const render = gutterLineNumbers(1);
      assert.equal(render(1), '1');
      assert.equal(render(42), '42');
    });

    it('renders rename old sides against their from-address extent', () => {
      // A rename block's old side lives in the from-address's line space, so
      // the renderer must be able to start anywhere, not just at the declared
      // address's start.
      const render = gutterLineNumbers(3);
      assert.equal(render(1), '3');
      assert.equal(render(10), '12');
    });
  });
});
