/**
 * Tests for the timeline snapshot ladder.
 *
 * The drift seed is the subtle piece: on the drifted branch the ladder must
 * recover the post-newest-commit snapshot from the `current` block's own diff
 * before walking, or every older rung silently shows today's worktree lines.
 * The drifted fixture below places the uncommitted edit **outside every
 * hunk's context window** in the newest commit's diff, so an omitted seed
 * call produces a wrong-but-well-formed pre-image instead of a throw -- the
 * assertions bite on exact text.
 *
 * @summary History snapshot ladder tests.
 * @module test/suite/spanViewer/historySnapshotLadder.test
 */

import * as assert from 'node:assert';
import { buildHistorySnapshotLadder } from '../../../src/spanViewer/historySnapshotLadder.js';
import type { CurrentAnchor, HistoryCommit } from '../../../src/spanViewer/types.js';

const ADDRESS = 'f.txt#L1-L5';

function commit(hash: string, summary: string, anchors: HistoryCommit['anchors']): HistoryCommit {
  return { hash, date: `2026-01-01T00:00:00-04:00`, summary, anchors };
}

describe('historySnapshotLadder', () => {
  describe('buildHistorySnapshotLadder', () => {
    it('walks newest-to-oldest through multiple edits, terminating at the first-add', () => {
      const t0 = 'a\nb\nc\nd\ne\n';
      const t1 = 'a\nb EDITED\nc\nd\ne\n';
      const t2 = 'a\nb EDITED\nc\nd EDITED\ne\n';
      const commits: HistoryCommit[] = [
        commit('c3', 'edit d', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -3,3 +3,3 @@\n c\n-d\n+d EDITED\n e\n'
          }
        ]),
        commit('c2', 'edit b', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+b EDITED\n c\n'
          }
        ]),
        commit('c1', 'add anchor', [{ path: ADDRESS, content: t0 }])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, seedContent: t2 });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 3);
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c3',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit d',
        original: t1,
        modified: t2
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit b',
        original: t0,
        modified: t1
      });
      assert.deepStrictEqual(result.rungs[2], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'add anchor',
        original: '',
        modified: t0
      });
    });

    it('crosses a rename boundary, rebasing each rung against its own tracked address', () => {
      // Pre-rename extent f.txt#L3-L12 (10 lines, file lines 3-12); the live
      // address after the rename is g.txt#L1-L10. Each rung's hunks render at
      // file-absolute coordinates against its own extent start -- f.txt#L3-L12
      // hunks at offset 3, g.txt#L1-L10 hunks at offset 1 -- so a rung that
      // used the live start line would rebase the f.txt hunk to the wrong
      // offset and throw.
      const x0 = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n';
      const x1 = 'a\nb\nc\nd EDITED\ne\nf\ng\nh\ni\nj\n';
      const x2 = 'A\nB\nc\nd EDITED\ne\nf\ng\nh\ni\nj\n';
      const x3 = 'A\nB\nc\nd EDITED\ne\nf\ng EDITED\nh\ni\nj\n';
      const commits: HistoryCommit[] = [
        commit('c3', 'edit g', [
          {
            path: 'g.txt#L1-L10',
            diff: 'diff --git a/g.txt b/g.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/g.txt\n+++ b/g.txt\n@@ -6,3 +6,3 @@\n f\n-g\n+g EDITED\n h\n'
          }
        ]),
        commit('c2', 'rename and edit', [
          {
            path: 'g.txt#L1-L10',
            diff: 'diff --git a/.span/x b/.span/x\nrename from f.txt#L3-L12\nrename to g.txt#L1-L10\nindex rk64:bbbb..rk64:cccc\n--- a/f.txt#L3-L12\n+++ b/g.txt#L1-L10\n@@ -1,2 +1,2 @@\n-a\n-b\n+A\n+B\n'
          }
        ]),
        commit('c1', 'edit d', [
          {
            path: 'f.txt#L3-L12',
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -5,3 +5,3 @@\n c\n-d\n+d EDITED\n e\n'
          }
        ]),
        commit('c0', 'add anchor', [{ path: 'f.txt#L3-L12', content: x0 }])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: 'g.txt#L1-L10', commits, seedContent: x3 });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 4);
      assert.deepStrictEqual(result.rungs[0]?.original, x2);
      assert.deepStrictEqual(result.rungs[0]?.modified, x3);
      assert.deepStrictEqual(
        result.rungs[1]?.original,
        x1,
        'the rename commit reverse-applies onto its own pre-rename content'
      );
      assert.deepStrictEqual(result.rungs[1]?.modified, x2);
      assert.deepStrictEqual(
        result.rungs[2]?.original,
        x0,
        'the f.txt#L3-L12 rung rebases by 2 (its own extent start), not the live address'
      );
      assert.deepStrictEqual(result.rungs[2]?.modified, x1);
      assert.deepStrictEqual(result.rungs[3], {
        hash: 'c0',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'add anchor',
        original: '',
        modified: x0
      });
    });

    it('resolves a full addition from the diff new side and terminates', () => {
      // C1 introduces the anchor with content t0; C2 edits it to t2. The walk
      // renders C2 by reverse-apply, then must terminate at C1's full
      // addition -- whose new side is t0, the pre-C2 state, without ever
      // touching the deliberately unreadable C0 diff below it.
      const t0 = 'a\nb\nc\n';
      const t2 = 'a\nb EDITED\nc\n';
      const commits: HistoryCommit[] = [
        commit('c2', 'edit', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+b EDITED\n c\n'
          }
        ]),
        commit('c1', 'new anchor', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3\nnew anchor\nindex rk64:aaaa..rk64:bbbb\n--- /dev/null\n+++ b/f.txt#L1-L3\n@@ -0,0 +1,3 @@\n+a\n+b\n+c\n'
          }
        ]),
        commit('c0', 'must not be reached', [
          { path: ADDRESS, diff: 'diff --git a/f.txt b/f.txt\n@@ -99,1 +99,2 @@\n a\n+b\n' }
        ])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, seedContent: t2 });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 2, 'the walk terminates at the full addition');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit',
        original: t0,
        modified: t2
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'new anchor',
        original: '',
        modified: t0
      });
    });

    it('resolves a full deletion from the diff old side and terminates', () => {
      const x0 = 'line one\nline two\nline three\n';
      const x1 = 'line one EDITED\nline two\nline three\n';
      const commits: HistoryCommit[] = [
        commit('c2', 'edit', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n-line one\n+line one EDITED\n line two\n line three\n'
          }
        ]),
        commit('c1', 'delete anchor', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3\ndeleted anchor\nindex rk64:bbbb..rk64:aaaa\n--- a/f.txt#L1-L3\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-line one EDITED\n-line two\n-line three\n'
          }
        ])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, seedContent: x1 });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 2);
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit',
        original: x0,
        modified: x1
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'delete anchor',
        original: x1,
        modified: ''
      });
    });

    it('skips rebound-only blocks without breaking the walk', () => {
      // C2 is a pure re-anchor: it changes the declaration's recorded token
      // without touching content, so C3's edit diff runs straight from the
      // first-add's t0 to t2. The rebound-only block contributes no rung and
      // the walk continues through it to the first-add.
      const t0 = 'a\nb\nc\n';
      const t2 = 'a\nb EDITED\nc\n';
      const commits: HistoryCommit[] = [
        commit('c3', 'edit', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+b EDITED\n c\n'
          }
        ]),
        commit('c2', 're-anchor', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3\nrebound anchor\nindex rk64:aaaa..rk64:bbbb\n',
            rebound: { from: 'rk64:aaaa', to: 'rk64:bbbb' }
          }
        ]),
        commit('c1', 'add anchor', [{ path: ADDRESS, content: t0 }])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, seedContent: t2 });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 2, 'the rebound-only block contributes no rung');
      assert.strictEqual(result.rungs[0]?.hash, 'c3');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c3',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit',
        original: t0,
        modified: t2
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'add anchor',
        original: '',
        modified: t0
      });
    });

    it('truncates at a failing rung: newer rungs survive, nothing older is rendered', () => {
      const commits: HistoryCommit[] = [
        commit('c3', 'edit', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+b EDITED\n c\n'
          }
        ]),
        commit('c2', 'bad diff', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -99,1 +99,2 @@\n a\n+b\n'
          }
        ]),
        commit('c1', 'add anchor', [{ path: ADDRESS, content: 'a\nb\nc\n' }])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, seedContent: 'a\nb EDITED\nc\n' });

      assert.strictEqual(result.truncated, true);
      assert.strictEqual(result.rungs.length, 2);
      assert.strictEqual(result.rungs[0]?.hash, 'c3');
      assert.strictEqual('truncatedAt' in result.rungs[0]!, false);
      assert.strictEqual(result.rungs[1]?.hash, 'c2');
      assert.strictEqual(result.rungs[1]?.truncatedAt, true);
      assert.strictEqual(result.rungs[1]?.original, '');
      assert.strictEqual(result.rungs[1]?.modified, '');
    });

    it('seeds the drifted branch by recovering the post-newest-commit snapshot, then walks the full history', () => {
      // Extent f.txt#L1-L10. C1 first-adds 10 lines; C2 edits line 2 with a
      // re-anchor (hunk context covers lines 1-6). The uncommitted worktree
      // edit hits line 9 -- **outside C2's hunk context** -- so the current
      // block's diff (lines 6-10) is the only source that can recover the
      // true seed. Seeding from `current.content` directly would yield a
      // well-formed but wrong pre-image at the C2 rung, which the exact-text
      // assertions below catch.
      const t0 =
        'line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t1 =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const worktree =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine WORKTREE\nline ten\n';

      const commits: HistoryCommit[] = [
        commit('c2', 'edit line two', [
          {
            path: 'f.txt#L1-L10',
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,6 +1,6 @@\n line one\n-line two\n+line two EDITED\n line three\n line four\n line five\n line six\n'
          }
        ]),
        commit('c1', 'add anchor', [{ path: 'f.txt#L1-L10', content: t0 }])
      ];
      const current: CurrentAnchor = {
        path: 'f.txt#L1-L10',
        diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -6,5 +6,5 @@\n line six\n line seven\n line eight\n-line nine\n+line nine WORKTREE\n line ten\n',
        content: worktree,
        sources: ['WORKTREE']
      };

      const result = buildHistorySnapshotLadder({
        liveAddress: 'f.txt#L1-L10',
        commits,
        current,
        seedContent: worktree
      });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 2);
      assert.deepStrictEqual(
        result.rungs[0],
        { hash: 'c2', date: '2026-01-01T00:00:00-04:00', summary: 'edit line two', original: t0, modified: t1 },
        'the C2 rung shows the committed snapshot pair, not worktree-tainted text'
      );
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'add anchor',
        original: '',
        modified: t0
      });
    });

    it('truncates to zero rungs when the drifted seed cannot be recovered', () => {
      const current: CurrentAnchor = {
        path: 'f.txt#L1-L3',
        diff: 'diff --git a/f.txt b/f.txt\nrebound anchor\nindex rk64:aaaa..rk64:bbbb\n',
        content: 'a\nb\nc\n'
      };
      const result = buildHistorySnapshotLadder({
        liveAddress: ADDRESS,
        commits: [commit('c1', 'add anchor', [{ path: ADDRESS, content: 'a\nb\nc\n' }])],
        current,
        seedContent: 'a\nb\nc\n'
      });
      assert.strictEqual(result.truncated, true);
      assert.deepStrictEqual(result.rungs, []);
    });
  });
});
