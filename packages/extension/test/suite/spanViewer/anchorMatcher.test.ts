/**
 * Tests for the pure anchor-matching state machine.
 *
 * @summary Anchor matcher tests.
 * @module test/suite/spanViewer/anchorMatcher.test
 */

import * as assert from 'node:assert';
import { matchAllAnchors, matchAnchor } from '../../../src/spanViewer/anchorMatcher.js';
import type { HistoryDocument, LiveAnchor } from '../../../src/spanViewer/types.js';

function historyFixture(overrides: Partial<HistoryDocument> = {}): HistoryDocument {
  return {
    schemaVersion: 1,
    span: 'web/checkout.tsx',
    commits: [],
    ...overrides
  };
}

describe('anchorMatcher', () => {
  describe('matchAnchor', () => {
    it('returns clean with the most recent added/modified content when no drift', () => {
      const history = historyFixture({
        commits: [
          {
            hash: 'c2',
            date: '2026-02-01',
            summary: 'Modify',
            anchors: [{ path: 'web/checkout.tsx#L1-L5', event: 'modified', content: 'newer content' }]
          },
          {
            hash: 'c1',
            date: '2026-01-01',
            summary: 'Add',
            anchors: [{ path: 'web/checkout.tsx#L1-L5', event: 'added', content: 'older content' }]
          }
        ]
      });
      const plan = matchAnchor('web/checkout.tsx#L1-L5', history);
      assert.deepStrictEqual(plan, { kind: 'clean', content: 'newer content' });
    });

    it('returns clean for a whole-file (rangeless) address', () => {
      const history = historyFixture({
        commits: [
          {
            hash: 'c1',
            date: '2026-01-01',
            summary: 'Add',
            anchors: [{ path: 'web/checkout.tsx', event: 'added', content: 'whole file content' }]
          }
        ]
      });
      const plan = matchAnchor('web/checkout.tsx', history);
      assert.deepStrictEqual(plan, { kind: 'clean', content: 'whole file content' });
    });

    it('returns drifted when a clean-matching address also appears in current.anchors[]', () => {
      const history = historyFixture({
        commits: [
          {
            hash: 'c1',
            date: '2026-01-01',
            summary: 'Add',
            anchors: [{ path: 'web/checkout.tsx#L1-L5', event: 'added', content: 'historical content' }]
          }
        ],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', status: 'edited', content: 'live content' }]
        }
      });
      const plan = matchAnchor('web/checkout.tsx#L1-L5', history);
      assert.deepStrictEqual(plan, { kind: 'drifted', historical: 'historical content', current: 'live content' });
    });

    it('returns reconciled (historical: null) for an uncommitted address rewrite present only in current', () => {
      const history = historyFixture({
        commits: [
          {
            hash: 'c1',
            date: '2026-01-01',
            summary: 'Unrelated',
            anchors: [{ path: 'web/other.tsx', event: 'added', content: 'unrelated' }]
          }
        ],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L9', status: 'reconciled', content: 'live content' }]
        }
      });
      const plan = matchAnchor('web/checkout.tsx#L1-L9', history);
      assert.deepStrictEqual(plan, { kind: 'reconciled', historical: null, current: 'live content' });
    });

    it('returns reconciled (historical: null) for a brand-new never-committed anchor', () => {
      const history = historyFixture({
        commits: [],
        current: {
          anchors: [{ path: 'web/new-file.tsx#L1-L3', status: 'new', content: 'brand new content' }]
        }
      });
      const plan = matchAnchor('web/new-file.tsx#L1-L3', history);
      assert.deepStrictEqual(plan, { kind: 'reconciled', historical: null, current: 'brand new content' });
    });

    it('returns drifted with current: null when the current entry has no content (removed in the working tree)', () => {
      const history = historyFixture({
        commits: [
          {
            hash: 'c1',
            date: '2026-01-01',
            summary: 'Add',
            anchors: [{ path: 'web/checkout.tsx#L1-L5', event: 'added', content: 'historical content' }]
          }
        ],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', status: 'removed in the working tree' }]
        }
      });
      const plan = matchAnchor('web/checkout.tsx#L1-L5', history);
      assert.deepStrictEqual(plan, { kind: 'drifted', historical: 'historical content', current: null });
    });

    it('returns reconciled with current: null when the current entry has no content (removed in the working tree)', () => {
      const history = historyFixture({
        commits: [],
        current: {
          anchors: [{ path: 'web/new-file.tsx#L1-L3', status: 'removed in the working tree' }]
        }
      });
      const plan = matchAnchor('web/new-file.tsx#L1-L3', history);
      assert.deepStrictEqual(plan, { kind: 'reconciled', historical: null, current: null });
    });

    it('returns dangling when the most recent event at the address is removed and no current entry exists', () => {
      const history = historyFixture({
        commits: [
          {
            hash: 'c1',
            date: '2026-01-01',
            summary: 'Remove',
            anchors: [{ path: 'web/checkout.tsx#L1-L5', event: 'removed' }]
          }
        ]
      });
      const plan = matchAnchor('web/checkout.tsx#L1-L5', history);
      assert.deepStrictEqual(plan, { kind: 'dangling' });
    });

    it('returns dangling when nothing matches anywhere', () => {
      const history = historyFixture();
      const plan = matchAnchor('web/never-seen.tsx', history);
      assert.deepStrictEqual(plan, { kind: 'dangling' });
    });
  });

  describe('matchAllAnchors', () => {
    it('produces one plan per live anchor, in file order', () => {
      const history = historyFixture({
        commits: [
          {
            hash: 'c1',
            date: '2026-01-01',
            summary: 'Add both',
            anchors: [
              { path: 'a.ts', event: 'added', content: 'a content' },
              { path: 'b.ts#L1-L2', event: 'added', content: 'b content' }
            ]
          }
        ]
      });
      const liveAnchors: LiveAnchor[] = [
        { path: 'a.ts', range: null },
        { path: 'b.ts', range: { start: 1, end: 2 } }
      ];
      const plans = matchAllAnchors(liveAnchors, history);
      assert.strictEqual(plans.length, 2);
      assert.deepStrictEqual(plans[0], { kind: 'clean', content: 'a content' });
      assert.deepStrictEqual(plans[1], { kind: 'clean', content: 'b content' });
    });
  });
});
