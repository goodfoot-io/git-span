/**
 * Tests for the diff editors' side-by-side/inline layout options.
 *
 * These are drift guards, not behaviour tests: the switching itself is Monaco's,
 * and the only thing this package owns is the configuration that enables it. The
 * risk being guarded is silent -- a Monaco upgrade changing a default, or an
 * edit dropping one of the three options, would change how every diff on the
 * page renders with nothing failing. So the values are pinned against VS Code's
 * `diffEditorDefaultOptions`, and the one invariant that is genuinely
 * load-bearing is asserted rather than assumed.
 *
 * @summary Pins the responsive diff-layout options and their consistency.
 * @module test/suite/spanViewer/diffLayout.test
 */

import * as assert from 'node:assert/strict';
import {
  RESPONSIVE_DIFF_LAYOUT_OPTIONS,
  SIDE_BY_SIDE_INLINE_BREAKPOINT
} from '../../../src/spanViewer/webview/diffLayout.js';

describe('spanViewer/diffLayout', () => {
  describe('SIDE_BY_SIDE_INLINE_BREAKPOINT', () => {
    it("matches VS Code's renderSideBySideInlineBreakpoint default", () => {
      assert.equal(SIDE_BY_SIDE_INLINE_BREAKPOINT, 900);
    });
  });

  describe('RESPONSIVE_DIFF_LAYOUT_OPTIONS', () => {
    it("matches VS Code's diffEditorDefaultOptions", () => {
      assert.deepEqual(RESPONSIVE_DIFF_LAYOUT_OPTIONS, {
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: true,
        renderSideBySideInlineBreakpoint: 900
      });
    });

    it('never reintroduces the always-inline hardcoding it replaced', () => {
      assert.notEqual(RESPONSIVE_DIFF_LAYOUT_OPTIONS.renderSideBySide, false);
    });

    it('keeps the inline fallback paired with side-by-side, since Monaco ignores it otherwise', () => {
      // `useInlineViewWhenSpaceIsLimited` is only read while `renderSideBySide`
      // is true. Setting it alone is inert, and the failure mode is a squeezed
      // two-column diff in a narrow panel rather than an error.
      if (RESPONSIVE_DIFF_LAYOUT_OPTIONS.useInlineViewWhenSpaceIsLimited) {
        assert.equal(RESPONSIVE_DIFF_LAYOUT_OPTIONS.renderSideBySide, true);
      }
    });

    it('carries a breakpoint whenever the inline fallback is enabled', () => {
      // Without a breakpoint Monaco compares the width against `undefined`,
      // which is never satisfied, so the fallback would silently never fire.
      if (RESPONSIVE_DIFF_LAYOUT_OPTIONS.useInlineViewWhenSpaceIsLimited) {
        assert.equal(typeof RESPONSIVE_DIFF_LAYOUT_OPTIONS.renderSideBySideInlineBreakpoint, 'number');
        assert.ok(RESPONSIVE_DIFF_LAYOUT_OPTIONS.renderSideBySideInlineBreakpoint > 0);
      }
    });
  });
});
