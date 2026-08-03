/**
 * Tests for the rendered-height rule deciding a card's initial open state.
 *
 * The rule is the only place the "cards never scroll, so tall ones start
 * closed" policy is expressed, and it is exercised here rather than through
 * the webview because the webview has no DOM in the extension host.
 *
 * @summary Boundary and degenerate-input tests for `shouldCollapse`.
 * @module test/suite/spanViewer/collapseRule.test
 */

import * as assert from 'node:assert/strict';
import { COLLAPSE_THRESHOLD_LINES, LINE_HEIGHT, shouldCollapse } from '../../../src/spanViewer/webview/collapseRule.js';

/** The exact rendered height at which a card is still allowed to stay open. */
const BOUNDARY = COLLAPSE_THRESHOLD_LINES * LINE_HEIGHT;

describe('spanViewer/collapseRule', () => {
  describe('constants', () => {
    it('threshold is ten lines of Monaco default line height', () => {
      assert.equal(COLLAPSE_THRESHOLD_LINES, 10);
      assert.equal(LINE_HEIGHT, 18);
      assert.equal(BOUNDARY, 180);
    });
  });

  describe('shouldCollapse', () => {
    it('stays open exactly at the threshold', () => {
      assert.equal(shouldCollapse(BOUNDARY), false);
    });

    it('stays open just below the threshold', () => {
      assert.equal(shouldCollapse(BOUNDARY - 1), false);
    });

    it('collapses just above the threshold', () => {
      assert.equal(shouldCollapse(BOUNDARY + 1), true);
    });

    it('collapses an eleven-line body', () => {
      assert.equal(shouldCollapse(11 * LINE_HEIGHT), true);
    });

    it('stays open for a zero-height body', () => {
      assert.equal(shouldCollapse(0), false);
    });

    it('stays open for a one-line body', () => {
      assert.equal(shouldCollapse(LINE_HEIGHT), false);
    });

    it('collapses an absurdly tall body', () => {
      assert.equal(shouldCollapse(Number.MAX_SAFE_INTEGER), true);
    });

    it('collapses at a fractional height above the threshold', () => {
      assert.equal(shouldCollapse(BOUNDARY + 0.5), true);
    });

    // An unmeasurable body starts open: a stray extra click is recoverable,
    // whereas silently hiding content leaves no signal that it exists.
    it('stays open when the height could not be measured', () => {
      assert.equal(shouldCollapse(Number.NaN), false);
      assert.equal(shouldCollapse(Number.POSITIVE_INFINITY), false);
      assert.equal(shouldCollapse(-1), false);
    });

    it('honours an overridden line height', () => {
      // 10 lines at 24px is 240px: 239 fits, 241 does not.
      assert.equal(shouldCollapse(239, 24), false);
      assert.equal(shouldCollapse(241, 24), true);
    });

    it('honours an overridden line budget', () => {
      assert.equal(shouldCollapse(20 * LINE_HEIGHT, LINE_HEIGHT, 20), false);
      assert.equal(shouldCollapse(21 * LINE_HEIGHT, LINE_HEIGHT, 20), true);
    });
  });
});
