/**
 * Tests for the pure anchor-matching state machine (schema v2).
 *
 * The discriminator is structural, never hash-based: drift is asserted by the
 * current block's own fields (`proposed`, `recorded`, `unavailable`,
 * non-empty `sources`, or real hunks), and membership in history is a lineage
 * walk that follows `rename from <old>` headers.
 *
 * @summary Anchor matcher tests.
 * @module test/suite/spanViewer/anchorMatcher.test
 */

import * as assert from 'node:assert';
import {
  extentStartLineOf,
  matchAllAnchors,
  matchAnchor,
  walkAddressLineage
} from '../../../src/spanViewer/anchorMatcher.js';
import { ReconstructionError } from '../../../src/spanViewer/patchReconstruction.js';
import type { CurrentAnchor, HistoryCommit, HistoryDocument, LiveAnchor } from '../../../src/spanViewer/types.js';

const FIRST_ADD = 'web/checkout.tsx#L1-L5';

function commit(hash: string, summary: string, anchors: HistoryCommit['anchors']): HistoryCommit {
  return { hash, date: '2026-01-01T00:00:00-04:00', summary, anchors };
}

function historyFixture(overrides: Partial<HistoryDocument> = {}): HistoryDocument {
  return {
    schemaVersion: 2,
    span: 'web/checkout.tsx',
    commits: [],
    ...overrides
  };
}

describe('anchorMatcher', () => {
  describe('matchAnchor', () => {
    it('returns clean when the address has history and nothing asserts drift', () => {
      const history = historyFixture({
        commits: [
          commit('c2', 'Modify', [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx b/web/checkout.tsx\n@@ -1,3 +1,3 @@\n hello\n-hi\n+hey\n'
            }
          ]),
          commit('c1', 'Add', [{ path: FIRST_ADD, content: 'hello\nhi\n' }])
        ]
      });
      assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), { kind: 'clean' });
    });

    it('returns clean for a whole-file (rangeless) address', () => {
      const history = historyFixture({
        commits: [commit('c1', 'Add', [{ path: 'web/checkout.tsx', content: 'whole file content' }])]
      });
      assert.deepStrictEqual(matchAnchor('web/checkout.tsx', history), { kind: 'clean' });
    });

    it('treats a current block with no drift signals as absent (identical-hash no-hunk block)', () => {
      const history = historyFixture({
        commits: [commit('c1', 'Add', [{ path: FIRST_ADD, content: 'hello\nhi\n' }])],
        current: {
          anchors: [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\nindex rk64:aaaa..rk64:aaaa\n',
              content: 'hello\nhi\n'
            }
          ]
        }
      });
      assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), { kind: 'clean' });
    });

    it('returns clean, not dangling, when the only history entry is a rebound-only block', () => {
      const history = historyFixture({
        commits: [
          commit('c2', 'Re-anchor', [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\nrebound anchor\nindex rk64:aaaa..rk64:bbbb\n',
              rebound: { from: 'rk64:aaaa', to: 'rk64:bbbb' }
            }
          ]),
          commit('c1', 'Add', [{ path: FIRST_ADD, content: 'hello\nhi\n' }])
        ]
      });
      assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), { kind: 'clean' });
    });

    it('returns drifted for a rebound-only-only lineage when the current block asserts drift', () => {
      const history = historyFixture({
        commits: [
          commit('c2', 'Re-anchor', [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\nrebound anchor\nindex rk64:aaaa..rk64:bbbb\n',
              rebound: { from: 'rk64:aaaa', to: 'rk64:bbbb' }
            }
          ]),
          commit('c1', 'Add', [{ path: FIRST_ADD, content: 'hello\nhi\n' }])
        ],
        current: {
          anchors: [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx b/web/checkout.tsx\n@@ -1,2 +1,2 @@\n hello\n-hi\n+hey\n',
              content: 'hello\nhey\n',
              sources: ['WORKTREE']
            }
          ]
        }
      });
      assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), {
        kind: 'drifted',
        historical: 'hello\nhi\n',
        current: 'hello\nhey\n'
      });
    });

    it('finds history across a rename boundary', () => {
      const history = historyFixture({
        commits: [
          commit('c2', 'Rename', [
            {
              path: 'g.txt#L1-L10',
              diff: 'diff --git a/.span/x b/.span/x\nrename from f.txt#L3-L12\nrename to g.txt#L1-L10\nindex rk64:aaaa..rk64:bbbb\n'
            }
          ]),
          commit('c1', 'Add', [{ path: 'f.txt#L3-L12', content: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n' }])
        ]
      });
      assert.deepStrictEqual(matchAnchor('g.txt#L1-L10', history), { kind: 'clean' });
    });

    it('returns dangling when the address has no history and nothing asserts drift', () => {
      assert.deepStrictEqual(matchAnchor('web/never-seen.tsx', historyFixture()), { kind: 'dangling' });
    });

    it('returns drifted with offset-normalized historical content for ordinary drift', () => {
      // Extent f.txt#L5-L8: the diff renders at file-absolute 5 while the
      // content strings only carry the four extent lines, so the historical
      // side is only recoverable after rebasing by extentStartLine - 1.
      const pre = 'line five\nline six\nline seven\nline eight\n';
      const post = 'line five\nline six EDITED\nline seven\nline eight\n';
      const history = historyFixture({
        commits: [commit('c1', 'Add', [{ path: 'f.txt#L5-L8', content: pre }])],
        current: {
          anchors: [
            {
              path: 'f.txt#L5-L8',
              diff: 'diff --git a/f.txt b/f.txt\n@@ -5,4 +5,4 @@\n line five\n-line six\n+line six EDITED\n line seven\n line eight\n',
              content: post,
              sources: ['WORKTREE']
            }
          ]
        }
      });
      assert.deepStrictEqual(matchAnchor('f.txt#L5-L8', history), {
        kind: 'drifted',
        historical: pre,
        current: post
      });
    });

    it('returns relocated with content, proposed, and sources for a proposed current entry', () => {
      const history = historyFixture({
        commits: [commit('c1', 'Add', [{ path: FIRST_ADD, content: 'hello\nhi\n' }])],
        current: {
          anchors: [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L10-L14\n@@ -1,2 +1,2 @@\n hello\n-hi\n+hey\n',
              content: 'hello\nhey\n',
              proposed: 'web/checkout.tsx#L10-L14',
              sources: ['HEAD', 'WORKTREE']
            }
          ]
        }
      });
      assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), {
        kind: 'relocated',
        content: 'hello\nhey\n',
        proposed: 'web/checkout.tsx#L10-L14',
        sources: ['HEAD', 'WORKTREE']
      });
    });

    it('returns relocated without a sources key when the current entry has none', () => {
      const history = historyFixture({
        commits: [commit('c1', 'Add', [{ path: FIRST_ADD, content: 'hello\nhi\n' }])],
        current: {
          anchors: [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L10-L14\n',
              content: 'hello\nhi\n',
              proposed: 'web/checkout.tsx#L10-L14'
            }
          ]
        }
      });
      assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), {
        kind: 'relocated',
        content: 'hello\nhi\n',
        proposed: 'web/checkout.tsx#L10-L14'
      });
    });

    it('returns drifted with current: null for a deleted anchor (new side /dev/null)', () => {
      const history = historyFixture({
        commits: [commit('c1', 'Add', [{ path: FIRST_ADD, content: 'hello\nhi\n' }])],
        current: {
          anchors: [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\ndeleted anchor\n--- a/web/checkout.tsx#L1-L5\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-hello\n-hi\n',
              content: 'hello\nhi\n'
            }
          ]
        }
      });
      assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), {
        kind: 'drifted',
        historical: 'hello\nhi\n',
        current: null
      });
    });

    it('returns drifted with historical: null for a new anchor (old side /dev/null)', () => {
      const history = historyFixture({
        commits: [],
        current: {
          anchors: [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\nnew anchor\n--- /dev/null\n+++ b/web/checkout.tsx#L1-L5\n@@ -0,0 +1,2 @@\n+hello\n+hi\n',
              content: 'hello\nhi\n'
            }
          ]
        }
      });
      assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), {
        kind: 'drifted',
        historical: null,
        current: 'hello\nhi\n'
      });
    });

    it('returns reconciled when a current-only address asserts drift with real hunks', () => {
      const history = historyFixture({
        commits: [commit('c1', 'Unrelated', [{ path: 'web/other.tsx', content: 'unrelated' }])],
        current: {
          anchors: [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx b/web/checkout.tsx\n@@ -1,2 +1,2 @@\n hello\n-hi\n+hey\n',
              content: 'hello\nhey\n',
              sources: ['HEAD']
            }
          ]
        }
      });
      assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), {
        kind: 'reconciled',
        historical: null,
        current: 'hello\nhey\n'
      });
    });

    it('returns unavailable with the exact reason for every current unavailable value', () => {
      for (const reason of ['absent', 'range-past-eof', 'binary', 'filter-failed'] as const) {
        const history = historyFixture({
          current: {
            anchors: [
              {
                path: FIRST_ADD,
                diff: `diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\ncontent unavailable ${reason}\n`,
                unavailable: reason
              }
            ]
          }
        });
        assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), { kind: 'unavailable', reason });
      }
    });

    it('maps recorded to the unrecoverable unavailable plan', () => {
      const history = historyFixture({
        current: {
          anchors: [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\n',
              content: 'hello\nhi\n',
              recorded: 'unrecoverable'
            }
          ]
        }
      });
      assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), { kind: 'unavailable', reason: 'unrecoverable' });
    });

    it('throws ReconstructionError when drift is asserted but the diff cannot be reverse-applied', () => {
      // A hunk-bearing diff whose post-region contradicts the content -- the
      // pair the CLI certified disagrees, so the reconstruction must fail
      // closed. (A header-only diff is the no-change shape and routes to a
      // drifted plan instead; see the header-only test below.)
      const history = historyFixture({
        commits: [commit('c1', 'Add', [{ path: FIRST_ADD, content: 'hello\nhi\n' }])],
        current: {
          anchors: [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx b/web/checkout.tsx\n@@ -1,2 +1,2 @@\n hello\n-hi\n+hey\n',
              content: 'hello\nhi\n',
              sources: ['WORKTREE']
            }
          ]
        }
      });
      assert.throws(() => matchAnchor(FIRST_ADD, history), ReconstructionError);
    });

    it('classifies an uncommitted in-place re-anchor as drifted, recovering the recorded bytes across the rename', () => {
      // The real `git span history` shape for a re-anchored declaration (the
      // address rewritten in the worktree .span file, the recorded token
      // kept): the current entry at the declared address carries `rename
      // from`/`rename to` headers, the old side's hunk coordinate lives in the
      // FROM address's line space (1) and the new side's in the declared
      // address's (3), and the committed history lives under the FROM address.
      // The lineage must start at `rename from f.txt#L1-L3` or the anchor is
      // misclassified as reconciled with empty history, and the old side must
      // rebase against the from address's extent start or the recovery throws
      // on the negative rebase.
      const currentEntry: CurrentAnchor = {
        path: 'f.txt#L3-L5',
        diff: [
          'diff --git a/f.txt#L1-L3 b/f.txt#L3-L5',
          'similarity index 66%',
          'rename from f.txt#L1-L3',
          'rename to f.txt#L3-L5',
          'drift source worktree, head',
          'index rk64:455e176970060f71..rk64:bb9e92ed860ae671',
          '--- a/f.txt#L1-L3',
          '+++ b/f.txt#L3-L5',
          '@@ -1,3 +3,3 @@',
          ' alpha',
          '-beta',
          '+BETA',
          ' gamma'
        ].join('\n'),
        content: 'alpha\nBETA\ngamma\n',
        sources: ['WORKTREE', 'HEAD']
      };
      const history = historyFixture({
        commits: [commit('c1', 'Add', [{ path: 'f.txt#L1-L3', content: 'alpha\nbeta\ngamma\n' }])],
        current: { anchors: [currentEntry] }
      });

      assert.deepStrictEqual(matchAnchor('f.txt#L3-L5', history), {
        kind: 'drifted',
        historical: 'alpha\nbeta\ngamma\n',
        current: 'alpha\nBETA\ngamma\n'
      });
    });

    it('classifies a re-anchor back to an address with its own committed history as drifted, not throwing', () => {
      // The evaluator-confirmed Arm A shape: the anchor has committed history
      // at its declared address (c1 records at f.txt#L3-L5), a committed
      // re-anchor moves it away (c2, a rename entry at f.txt#L1-L3), and an
      // UNCOMMITTED re-anchor back to f.txt#L3-L5 with content drift produces
      // the current entry: rename headers + hunks + sources, its old side in
      // the FROM address's line space. The lineage must connect through the
      // current entry's `rename from` to the committed chain and back to the
      // declared address's own history, and the old side must rebase against
      // the from address's extent start -- before both fixes this shape threw
      // ReconstructionError on the negative rebase and blanked the whole
      // viewer.
      const currentEntry: CurrentAnchor = {
        path: 'f.txt#L3-L5',
        diff: [
          'diff --git a/f.txt#L1-L3 b/f.txt#L3-L5',
          'similarity index 66%',
          'rename from f.txt#L1-L3',
          'rename to f.txt#L3-L5',
          'drift source worktree, head',
          'index rk64:455e176970060f71..rk64:bb9e92ed860ae671',
          '--- a/f.txt#L1-L3',
          '+++ b/f.txt#L3-L5',
          '@@ -1,3 +3,3 @@',
          ' alpha',
          '-beta',
          '+BETA',
          ' gamma'
        ].join('\n'),
        content: 'alpha\nBETA\ngamma\n',
        sources: ['WORKTREE', 'HEAD']
      };
      const history = historyFixture({
        commits: [
          commit('c2', 'Re-anchor', [
            {
              path: 'f.txt#L1-L3',
              diff: [
                'diff --git a/f.txt#L3-L5 b/f.txt#L1-L3',
                'rename from f.txt#L3-L5',
                'rename to f.txt#L1-L3',
                'index rk64:aaaa..rk64:aaaa'
              ].join('\n')
            }
          ]),
          commit('c1', 'Add', [{ path: 'f.txt#L3-L5', content: 'alpha\nbeta\ngamma\n' }])
        ],
        current: { anchors: [currentEntry] }
      });

      assert.deepStrictEqual(matchAnchor('f.txt#L3-L5', history), {
        kind: 'drifted',
        historical: 'alpha\nbeta\ngamma\n',
        current: 'alpha\nBETA\ngamma\n'
      });
    });

    it('routes a header-only drifted diff to historical = content instead of throwing', () => {
      // A committed-but-unreconciled anchor: the recorded hash is stale while
      // the bytes are byte-identical, so the current diff carries no hunks yet
      // the drift sources are non-empty -- the anchor IS drifted, and with no
      // content change the historical side is the content itself.
      const history = historyFixture({
        commits: [commit('c1', 'Add', [{ path: FIRST_ADD, content: 'hello\nhi\n' }])],
        current: {
          anchors: [
            {
              path: FIRST_ADD,
              diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\nrecorded anchor\nindex rk64:bbbb..rk64:bbbb\n',
              content: 'hello\nhi\n',
              sources: ['WORKTREE']
            }
          ]
        }
      });
      assert.deepStrictEqual(matchAnchor(FIRST_ADD, history), {
        kind: 'drifted',
        historical: 'hello\nhi\n',
        current: 'hello\nhi\n'
      });
    });
  });

  describe('walkAddressLineage', () => {
    it('matches a single rename hop, switching the tracked address for older commits', () => {
      const commits: HistoryCommit[] = [
        commit('c2', 'Rename', [
          {
            path: 'g.txt#L1-L10',
            diff: 'diff --git a/.span/x b/.span/x\nrename from f.txt#L3-L12\nrename to g.txt#L1-L10\nindex rk64:aaaa..rk64:bbbb\n'
          }
        ]),
        commit('c1', 'Add', [{ path: 'f.txt#L3-L12', content: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n' }])
      ];
      const matches = walkAddressLineage(commits, 'g.txt#L1-L10');
      assert.strictEqual(matches.length, 2);
      assert.strictEqual(matches[0]?.commitIndex, 0);
      assert.strictEqual(matches[0]?.address, 'g.txt#L1-L10');
      assert.strictEqual(matches[1]?.commitIndex, 1);
      assert.strictEqual(matches[1]?.address, 'f.txt#L3-L12');
    });

    it('follows a multi-hop rename chain to the origin', () => {
      const commits: HistoryCommit[] = [
        commit('c3', 'Rename again', [
          {
            path: 'h.txt#L1-L5',
            diff: 'diff --git a/.span/x b/.span/x\nrename from g.txt#L1-L5\nrename to h.txt#L1-L5\nindex rk64:aaaa..rk64:bbbb\n'
          }
        ]),
        commit('c2', 'Rename', [
          {
            path: 'g.txt#L1-L5',
            diff: 'diff --git a/.span/x b/.span/x\nrename from f.txt#L1-L5\nrename to g.txt#L1-L5\nindex rk64:aaaa..rk64:bbbb\n'
          }
        ]),
        commit('c1', 'Add', [{ path: 'f.txt#L1-L5', content: 'a\nb\nc\nd\ne\n' }])
      ];
      const matches = walkAddressLineage(commits, 'h.txt#L1-L5');
      assert.strictEqual(matches.length, 3);
      assert.deepStrictEqual(
        matches.map((match) => match.address),
        ['h.txt#L1-L5', 'g.txt#L1-L5', 'f.txt#L1-L5']
      );
    });

    it('prefers the content block over a same-path rebound block at a rebind-plus-edit commit', () => {
      const commits: HistoryCommit[] = [
        commit('c2', 'Re-anchor and edit', [
          {
            path: FIRST_ADD,
            diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\nrebound anchor\nindex rk64:aaaa..rk64:bbbb\n',
            rebound: { from: 'rk64:aaaa', to: 'rk64:bbbb' }
          },
          {
            path: FIRST_ADD,
            diff: 'diff --git a/web/checkout.tsx b/web/checkout.tsx\n@@ -1,2 +1,2 @@\n hello\n-hi\n+hey\n'
          }
        ]),
        commit('c1', 'Add', [{ path: FIRST_ADD, content: 'hello\nhi\n' }])
      ];
      const matches = walkAddressLineage(commits, FIRST_ADD);
      assert.strictEqual(matches.length, 2);
      assert.strictEqual(matches[0]?.anchor.rebound, undefined, 'the content block wins');
      assert.ok(matches[0]?.anchor.diff?.includes('-hi\n+hey'));
    });

    it('starts at the current entry rename-from address when the declared address itself has no timeline', () => {
      // An uncommitted in-place re-anchor: the worktree declaration moved the
      // anchor to f.txt#L3-L5, so no timeline entry wears that address -- the
      // committed history lives under the `rename from` address and the walk
      // must start there.
      const commits: HistoryCommit[] = [
        commit('c1', 'Add', [{ path: 'f.txt#L1-L3', content: 'alpha\nbeta\ngamma\n' }])
      ];
      const currentEntry: CurrentAnchor = {
        path: 'f.txt#L3-L5',
        diff: [
          'diff --git a/f.txt#L1-L3 b/f.txt#L3-L5',
          'rename from f.txt#L1-L3',
          'rename to f.txt#L3-L5',
          'index rk64:455e176970060f71..rk64:bb9e92ed860ae671'
        ].join('\n'),
        content: 'alpha\nBETA\ngamma\n',
        sources: ['WORKTREE', 'HEAD']
      };

      const matches = walkAddressLineage(commits, 'f.txt#L3-L5', currentEntry);
      assert.strictEqual(matches.length, 1, 'the from address connects to the committed history');
      assert.strictEqual(matches[0]?.commitIndex, 0);
      assert.strictEqual(matches[0]?.address, 'f.txt#L1-L3');
      assert.deepStrictEqual(
        walkAddressLineage(commits, 'f.txt#L3-L5'),
        [],
        'without the current entry the declared address is genuinely dangling'
      );
    });

    it('returns no matches for a genuinely dangling address', () => {
      const commits: HistoryCommit[] = [commit('c1', 'Add', [{ path: 'web/other.tsx', content: 'unrelated' }])];
      assert.deepStrictEqual(walkAddressLineage(commits, 'web/never-seen.tsx'), []);
    });
  });

  describe('extentStartLineOf', () => {
    it('parses the declared range start, defaulting to 1 for whole-file addresses', () => {
      assert.strictEqual(extentStartLineOf('web/checkout.tsx#L10-L12'), 10);
      assert.strictEqual(extentStartLineOf('web/checkout.tsx#L1-L1'), 1);
      assert.strictEqual(extentStartLineOf('web/checkout.tsx'), 1);
    });
  });

  describe('matchAllAnchors', () => {
    it('produces one plan per live anchor, in file order', () => {
      const history = historyFixture({
        commits: [
          commit('c1', 'Add both', [
            { path: 'a.ts', content: 'a content' },
            { path: 'b.ts#L1-L2', content: 'b content' }
          ])
        ]
      });
      const liveAnchors: LiveAnchor[] = [
        { path: 'a.ts', range: null },
        { path: 'b.ts', range: { start: 1, end: 2 } }
      ];
      const plans = matchAllAnchors(liveAnchors, history);
      assert.strictEqual(plans.length, 2);
      assert.deepStrictEqual(plans[0], { kind: 'clean' });
      assert.deepStrictEqual(plans[1], { kind: 'clean' });
    });
  });
});
