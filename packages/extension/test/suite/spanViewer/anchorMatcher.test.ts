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
  declarationRenameFrom,
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
        current: 'hello\nhey\n',
        historicalStartLine: 1,
        currentStartLine: 1
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
        current: post,
        historicalStartLine: 5,
        currentStartLine: 5
      });
    });

    it("returns drifted with each side's file-absolute start line", () => {
      // Extent f.txt#L1641-L1644: the drift diff renders at file-absolute
      // 1641, and the gutter must number both sides from 1641, not from 1.
      // The expected plan carries the start lines explicitly, so a plan that
      // drops them fails the deep-equal on key mismatch.
      const pre = 'line 1641\nline 1642\nline 1643\nline 1644\n';
      const post = 'line 1641\nline 1642 EDITED\nline 1643\nline 1644\n';
      const history = historyFixture({
        commits: [commit('c1', 'Add', [{ path: 'f.txt#L1641-L1644', content: pre }])],
        current: {
          anchors: [
            {
              path: 'f.txt#L1641-L1644',
              diff: 'diff --git a/f.txt b/f.txt\n@@ -1641,4 +1641,4 @@\n line 1641\n-line 1642\n+line 1642 EDITED\n line 1643\n line 1644\n',
              content: post,
              sources: ['WORKTREE']
            }
          ]
        }
      });
      assert.deepStrictEqual(matchAnchor('f.txt#L1641-L1644', history), {
        kind: 'drifted',
        historical: pre,
        current: post,
        historicalStartLine: 1641,
        currentStartLine: 1641
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
        current: null,
        historicalStartLine: 1,
        currentStartLine: 1
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
        current: 'hello\nhi\n',
        historicalStartLine: 1,
        currentStartLine: 1
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
        current: 'hello\nhey\n',
        historicalStartLine: 1,
        currentStartLine: 1
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
        current: 'alpha\nBETA\ngamma\n',
        historicalStartLine: 1,
        currentStartLine: 3
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
        current: 'alpha\nBETA\ngamma\n',
        historicalStartLine: 1,
        currentStartLine: 3
      });
    });

    it("numbers a drifted rename card's sides against their own addresses", () => {
      // The current entry re-anchors f.txt#L1-L3 to f.txt#L3-L5 with drift:
      // the old side (historical) lives in the FROM address's line space
      // (start 1), the new side (current) in the declared address's (start
      // 3) -- one shared start line would number the historical rows 2
      // short of the file.
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
        current: 'alpha\nBETA\ngamma\n',
        historicalStartLine: 1,
        currentStartLine: 3
      });
    });

    it('routes a header-only drifted diff to historical = content instead of throwing', () => {
      // A committed-but-unreconciled anchor: the recorded hash is drifted while
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
        current: 'hello\nhi\n',
        historicalStartLine: 1,
        currentStartLine: 1
      });
    });

    it('classifies a byte-identical uncommitted re-anchor as clean, not dangling, when the current block carries no anchors', () => {
      // The REAL `git span history` shape for the CLI's documented re-anchor
      // flow: record f.txt#L1-L3, insert a line above, run `drift --fix`. The
      // re-anchor is byte-identical (the recorded token preserved, the
      // content unchanged), so the resolver classifies it as non-reportable
      // and `current.anchors` is EMPTY -- `current.span_diff` is the only
      // trace of the move, as a same-token address rewrite of the declaration
      // line. Without the span_diff the walk finds no timeline entry wearing
      // f.txt#L2-L4 and the anchor is misclassified `dangling` -- while the
      // CLI itself certifies "0 drift" and the recording lives in history.
      const history = historyFixture({
        commits: [commit('c2', 'record anchor', [{ path: 'f.txt#L1-L3', content: 'alpha\nbeta\ngamma\n' }])],
        current: {
          anchors: [],
          span_diff: [
            'diff --git a/.span/demo b/.span/demo',
            'index c817b57..ebf85ae 100644',
            '--- a/.span/demo',
            '+++ b/.span/demo',
            '@@ -1,2 +1,2 @@',
            '-f.txt#L1-L3 rk64:455e176970060f71',
            '+f.txt#L2-L4 rk64:455e176970060f71',
            ' '
          ].join('\n')
        }
      });
      assert.deepStrictEqual(matchAnchor('f.txt#L2-L4', history), { kind: 'clean' });
    });

    it('classifies the committed delete+add re-anchor (kept token, different target bytes) as relocated with the old recording in lineage', () => {
      // The REAL `git span history` shape for a committed re-anchor that keeps
      // the recorded token while the target address's bytes differ: the commit
      // emits a content block at the new address (its content is the
      // ADDRESS's file bytes, not the recorded token's) plus a full deletion
      // at the old address -- no rename headers anywhere -- and the resolver
      // finds the recorded bytes at the old address, so the current entry is a
      // relocation. The declaration move is the commit's own span_diff.
      const history = historyFixture({
        commits: [
          commit('c3', 'c3-reanchor-keep-token', [
            { path: 'f.txt#L1-L3', content: 'alpha\nbeta\ngamma\n' },
            {
              path: 'f.txt#L3-L5',
              diff: [
                'diff --git a/f.txt#L3-L5 b/dev/null',
                'deleted anchor',
                'index rk64:e0c06c534424c68e..0000000000000000',
                '--- a/f.txt#L3-L5',
                '+++ /dev/null',
                '@@ -3,3 +0,0 @@',
                '-gamma',
                '-delta',
                '-epsilon'
              ].join('\n')
            }
          ]).valueOf() as HistoryCommit & { span_diff: string },
          commit('c2', 'c2-record', [{ path: 'f.txt#L3-L5', content: 'gamma\ndelta\nepsilon\n' }])
        ],
        current: {
          anchors: [
            {
              path: 'f.txt#L1-L3',
              diff: [
                'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3',
                'proposed anchor f.txt#L3-L5',
                'drift source head',
                'index rk64:e0c06c534424c68e..rk64:e0c06c534424c68e'
              ].join('\n'),
              content: 'alpha\nbeta\ngamma\n',
              proposed: 'f.txt#L3-L5',
              sources: ['HEAD']
            }
          ]
        }
      });
      // The span_diff on the committed re-anchor (here set after construction,
      // since the local commit() helper does not carry one) is what connects
      // the new address to the old recording.
      const reanchor = history.commits[0];
      assert.ok(reanchor !== undefined);
      (reanchor as { span_diff?: string }).span_diff = [
        'diff --git a/.span/demo b/.span/demo',
        'index 45dc756..a9b3db2 100644',
        '--- a/.span/demo',
        '+++ b/.span/demo',
        '@@ -1,2 +1,2 @@',
        '-f.txt#L3-L5 rk64:e0c06c534424c68e',
        '+f.txt#L1-L3 rk64:e0c06c534424c68e',
        ' '
      ].join('\n');
      assert.deepStrictEqual(matchAnchor('f.txt#L1-L3', history), {
        kind: 'relocated',
        content: 'alpha\nbeta\ngamma\n',
        proposed: 'f.txt#L3-L5',
        sources: ['HEAD']
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

    it('starts at the current span_diff from-address when the current block carries no anchors', () => {
      // The byte-identical uncommitted re-anchor (the CLI's `drift --fix`
      // output before the fix is committed): the declaration moved the
      // recorded token from f.txt#L1-L3 to f.txt#L2-L4 with no content
      // change, so the resolver classifies the move as non-reportable and
      // `current.anchors` is empty. `current.span_diff` -- the same-token
      // address rewrite of the declaration line -- is the only trace that the
      // committed history lives under the OLD address.
      const commits: HistoryCommit[] = [
        commit('c1', 'record anchor', [{ path: 'f.txt#L1-L3', content: 'alpha\nbeta\ngamma\n' }])
      ];
      const currentSpanDiff = [
        'diff --git a/.span/demo b/.span/demo',
        'index c817b57..ebf85ae 100644',
        '--- a/.span/demo',
        '+++ b/.span/demo',
        '@@ -1,2 +1,2 @@',
        '-f.txt#L1-L3 rk64:455e176970060f71',
        '+f.txt#L2-L4 rk64:455e176970060f71',
        ' '
      ].join('\n');

      const matches = walkAddressLineage(commits, 'f.txt#L2-L4', undefined, currentSpanDiff);
      assert.strictEqual(matches.length, 1, 'the span_diff from-address connects to the committed history');
      assert.strictEqual(matches[0]?.commitIndex, 0);
      assert.strictEqual(matches[0]?.address, 'f.txt#L1-L3');
      assert.deepStrictEqual(
        walkAddressLineage(commits, 'f.txt#L2-L4'),
        [],
        'without the span_diff the declared address is genuinely dangling'
      );
    });

    it('crosses a committed delete+add re-anchor via the commit span_diff instead of terminating at the content block', () => {
      // The REAL routine shape for a committed re-anchor (record f.txt#L1-L3,
      // insert two lines above, run `drift --fix`, commit the fix): the fix
      // commit carries a CONTENT block at the new address (its content is the
      // moved address's file bytes) plus a full deletion at the old address --
      // no rename headers anywhere -- and its own span_diff carries the
      // same-token address move. The content block is a re-anchor destination,
      // not the origin, so the walk must cross into the old address's lineage
      // or the intermediate edit and the recording rungs are silently dropped.
      const commits: HistoryCommit[] = [
        {
          hash: 'c4',
          date: '2026-01-01T00:00:00-04:00',
          summary: 'c4-drift-fix',
          anchors: [
            { path: 'f.txt#L3-L5', content: 'a\nb\nc\n' },
            {
              path: 'f.txt#L1-L3',
              diff: [
                'diff --git a/f.txt#L1-L3 b/dev/null',
                'deleted anchor',
                'index rk64:fe623ff0f6be667f..0000000000000000',
                '--- a/f.txt#L1-L3',
                '+++ /dev/null',
                '@@ -1,3 +0,0 @@',
                '-x',
                '-y',
                '-a'
              ].join('\n')
            }
          ],
          span_diff: [
            'diff --git a/.span/demo b/.span/demo',
            'index c15d20c..e930320 100644',
            '--- a/.span/demo',
            '+++ b/.span/demo',
            '@@ -1,2 +1,2 @@',
            '-f.txt#L1-L3 rk64:9e8ea13137a80ccb',
            '+f.txt#L3-L5 rk64:9e8ea13137a80ccb',
            ' '
          ].join('\n')
        },
        commit('c3', 'c3-modify', [
          {
            path: 'f.txt#L1-L3',
            diff: [
              'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3',
              'index rk64:9e8ea13137a80ccb..rk64:fe623ff0f6be667f',
              '--- a/f.txt#L1-L3',
              '+++ b/f.txt#L1-L3',
              '@@ -1,3 +1,3 @@',
              '+x',
              '+y',
              ' a',
              '-b',
              '-c'
            ].join('\n')
          }
        ]),
        commit('c2', 'c2-record', [{ path: 'f.txt#L1-L3', content: 'a\nb\nc\n' }])
      ];
      const matches = walkAddressLineage(commits, 'f.txt#L3-L5');
      assert.strictEqual(matches.length, 3);
      assert.strictEqual(
        matches[0]?.crossedFrom,
        'f.txt#L1-L3',
        'the content block is crossed, not treated as the origin'
      );
      assert.deepStrictEqual(
        matches.map((match) => match.address),
        ['f.txt#L3-L5', 'f.txt#L1-L3', 'f.txt#L1-L3']
      );
      assert.strictEqual(matches[1]?.commitIndex, 1);
      assert.strictEqual(matches[2]?.commitIndex, 2);
      assert.strictEqual(matches[2]?.anchor.content, 'a\nb\nc\n');
    });

    it('treats a first-add content block as the origin when the commit declares no same-token move', () => {
      // Guard against over-crossing: a delete+add pair in one commit whose
      // declaration lines carry DIFFERENT tokens (the old anchor was dropped
      // and a genuinely new recording added at another address) is not a
      // re-anchor, so the content block still terminates the walk.
      const commits: HistoryCommit[] = [
        {
          hash: 'c2',
          date: '2026-01-01T00:00:00-04:00',
          summary: 'c2-unrelated',
          anchors: [
            { path: 'f.txt#L3-L5', content: 'a\nb\nc\n' },
            {
              path: 'f.txt#L1-L3',
              diff: [
                'diff --git a/f.txt#L1-L3 b/dev/null',
                'deleted anchor',
                'index rk64:fe623ff0f6be667f..0000000000000000',
                '--- a/f.txt#L1-L3',
                '+++ /dev/null',
                '@@ -1,3 +0,0 @@',
                '-x',
                '-y',
                '-a'
              ].join('\n')
            }
          ],
          span_diff: [
            'diff --git a/.span/demo b/.span/demo',
            'index c15d20c..e930320 100644',
            '--- a/.span/demo',
            '+++ b/.span/demo',
            '@@ -1,2 +1,2 @@',
            '-f.txt#L1-L3 rk64:fe623ff0f6be667f',
            '+f.txt#L3-L5 rk64:9e8ea13137a80ccb',
            ' '
          ].join('\n')
        },
        commit('c1', 'c1-record', [{ path: 'f.txt#L1-L3', content: 'a\nb\nc\n' }])
      ];
      const matches = walkAddressLineage(commits, 'f.txt#L3-L5');
      assert.strictEqual(matches.length, 1, 'a different-token move does not cross the delete+add pair');
      assert.strictEqual(matches[0]?.crossedFrom, undefined);
      assert.strictEqual(matches[0]?.anchor.content, 'a\nb\nc\n');
    });
  });

  describe('declarationRenameFrom', () => {
    it('returns the from-address for a same-token declaration move onto the live address', () => {
      const spanDiff = [
        'diff --git a/.span/demo b/.span/demo',
        'index c817b57..ebf85ae 100644',
        '--- a/.span/demo',
        '+++ b/.span/demo',
        '@@ -1,2 +1,2 @@',
        '-f.txt#L1-L3 rk64:455e176970060f71',
        '+f.txt#L2-L4 rk64:455e176970060f71',
        ' '
      ].join('\n');
      assert.strictEqual(declarationRenameFrom(spanDiff, 'f.txt#L2-L4'), 'f.txt#L1-L3');
    });

    it('returns undefined when no added anchor line lands on the live address', () => {
      const spanDiff = [
        'diff --git a/.span/demo b/.span/demo',
        'index c817b57..ebf85ae 100644',
        '--- a/.span/demo',
        '+++ b/.span/demo',
        '@@ -1,2 +1,2 @@',
        '-f.txt#L1-L3 rk64:455e176970060f71',
        '+f.txt#L2-L4 rk64:455e176970060f71',
        ' '
      ].join('\n');
      assert.strictEqual(declarationRenameFrom(spanDiff, 'f.txt#L9-L11'), undefined);
    });

    it('returns undefined for an in-place token rewrite (rebound) at the live address', () => {
      const spanDiff = [
        'diff --git a/.span/demo b/.span/demo',
        'index c817b57..ebf85ae 100644',
        '--- a/.span/demo',
        '+++ b/.span/demo',
        '@@ -1,2 +1,2 @@',
        '-f.txt#L1-L3 rk64:455e176970060f71',
        '+f.txt#L1-L3 rk64:bb9e92ed860ae671',
        ' '
      ].join('\n');
      assert.strictEqual(declarationRenameFrom(spanDiff, 'f.txt#L1-L3'), undefined);
    });

    it('returns undefined for a move carrying a different token (unrelated add and remove)', () => {
      const spanDiff = [
        'diff --git a/.span/demo b/.span/demo',
        'index c817b57..ebf85ae 100644',
        '--- a/.span/demo',
        '+++ b/.span/demo',
        '@@ -1,2 +1,2 @@',
        '-f.txt#L1-L3 rk64:455e176970060f71',
        '+f.txt#L2-L4 rk64:bb9e92ed860ae671',
        ' '
      ].join('\n');
      assert.strictEqual(declarationRenameFrom(spanDiff, 'f.txt#L2-L4'), undefined);
    });

    it('ignores the --- a/ and +++ b/ header lines and non-anchor context', () => {
      const spanDiff = [
        'diff --git a/.span/demo b/.span/demo',
        'index c817b57..ebf85ae 100644',
        '--- a/.span/demo',
        '+++ b/.span/demo',
        '@@ -1,2 +1,2 @@',
        '-f.txt#L1-L3 rk64:455e176970060f71',
        '+f.txt#L2-L4 rk64:455e176970060f71',
        ' ',
        '\\ No newline at end of file'
      ].join('\n');
      assert.strictEqual(declarationRenameFrom(spanDiff, 'f.txt#L2-L4'), 'f.txt#L1-L3');
    });

    it('returns undefined when the span diff carries no hunks at all', () => {
      const spanDiff = ['diff --git a/.span/demo b/.span/demo', 'index c817b57..ebf85ae 100644'].join('\n');
      assert.strictEqual(declarationRenameFrom(spanDiff, 'f.txt#L2-L4'), undefined);
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
