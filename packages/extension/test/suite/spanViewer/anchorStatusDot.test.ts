/**
 * Tests for the anchor status dot's presence rule and tooltip copy.
 *
 * The presence assertions enumerate every member of `PostedAnchor['kind']`
 * rather than spot-checking, because the rule is "everything except clean" --
 * a narrowing that accidentally spelled itself `kind === 'drifted'` would keep
 * the two obvious cases passing while silently dropping the dot for
 * `relocated`, `unavailable`, `changed`, and `dangling`.
 *
 * @summary Verifies which anchor kinds render a status dot and what it says.
 * @module test/suite/spanViewer/anchorStatusDot.test
 */

import * as assert from 'node:assert/strict';
import type { PostedAnchor } from '../../../src/spanViewer/types.js';
import {
  type DottedAnchorKind,
  hasStatusDot,
  statusDotLabel
} from '../../../src/spanViewer/webview/anchorStatusDot.js';

/**
 * Every kind the posted anchor union carries, listed literally.
 *
 * Typed as the union itself so adding a member to `PostedAnchor` without
 * adding it here is a compile error, not a quietly untested kind.
 */
const ALL_KINDS: readonly PostedAnchor['kind'][] = [
  'clean',
  'drifted',
  'reconciled',
  'relocated',
  'unavailable',
  'changed',
  'dangling'
];

describe('hasStatusDot', () => {
  it('omits the dot for a clean anchor', () => {
    assert.equal(hasStatusDot('clean'), false);
  });

  it('renders the dot for every kind other than clean', () => {
    for (const kind of ALL_KINDS) {
      if (kind === 'clean') {
        continue;
      }
      assert.equal(hasStatusDot(kind), true, `expected ${kind} to wear a status dot`);
    }
  });

  it('covers the whole union, so no kind is left unclassified', () => {
    const dotted = ALL_KINDS.filter((kind) => hasStatusDot(kind));
    assert.equal(dotted.length, ALL_KINDS.length - 1);
    assert.ok(!dotted.includes('clean' as DottedAnchorKind));
  });
});

describe('statusDotLabel', () => {
  it('collapses drifted and reconciled onto the same copy', () => {
    assert.equal(statusDotLabel('drifted'), 'drifted');
    assert.equal(statusDotLabel('reconciled'), 'drifted');
  });

  it('labels the remaining kinds distinctly', () => {
    assert.equal(statusDotLabel('relocated'), 'relocated');
    assert.equal(statusDotLabel('unavailable'), 'unavailable');
    assert.equal(statusDotLabel('changed'), 'content changed while this span was being checked');
    assert.equal(statusDotLabel('dangling'), 'no history');
  });

  it('returns non-empty copy for every dotted kind', () => {
    for (const kind of ALL_KINDS) {
      if (!hasStatusDot(kind)) {
        continue;
      }
      assert.ok(statusDotLabel(kind).length > 0, `expected ${kind} to carry tooltip copy`);
    }
  });
});
