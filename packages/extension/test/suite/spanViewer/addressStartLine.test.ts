/**
 * Tests for the extent-start parser behind the relocated anchor's gutter.
 *
 * A relocated anchor renders the block at its `proposed` address, so its
 * gutter offset can only come from parsing that address. The interesting
 * cases are a real range, a single-line range, a whole-file address with no
 * fragment at all, and a path whose own text contains digits that must not be
 * mistaken for a range.
 *
 * @summary Pins the address-to-start-line parse for relocated anchor gutters.
 * @module test/suite/spanViewer/addressStartLine.test
 */

import * as assert from 'node:assert/strict';
import { addressStartLine } from '../../../src/spanViewer/webview/addressStartLine.js';

describe('spanViewer/addressStartLine', () => {
  describe('addressStartLine', () => {
    it('reads the start of a multi-line range', () => {
      assert.equal(addressStartLine('packages/agent-hooks/src/claude/post-tool-use.ts#L209-L217'), 209);
    });

    it('reads the start of a single-line range', () => {
      assert.equal(addressStartLine('src.txt#L6-L6'), 6);
    });

    it('is 1 for a whole-file address carrying no range', () => {
      // Monaco already numbers from 1, so the whole-file case needs no
      // special handling at the call site.
      assert.equal(addressStartLine('src/index.ts'), 1);
    });

    it('ignores digits in the path itself', () => {
      assert.equal(addressStartLine('src/v2/step3.ts#L42-L44'), 42);
      assert.equal(addressStartLine('src/v2/step3.ts'), 1);
    });
  });
});
