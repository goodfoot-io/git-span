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

    it('reports the file-absolute start line of an in-place edit rung', () => {
      // A block whose header reads `f.txt#L1641-L1650` renders a pair whose
      // rows are the extent's own lines; the gutter must number them from
      // 1641, or a reader cannot cross-reference a row against the file
      // without doing the arithmetic. The expected objects carry the start
      // lines explicitly, so a pair that drops them (numbering from 1) fails
      // the deep-equal on key mismatch.
      const deep = 'f.txt#L1641-L1650';
      const t0 = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';
      const t1 = 'one\ntwo EDITED\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';
      const commits: HistoryCommit[] = [
        commit('c2', 'edit two', [
          {
            path: deep,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1641,3 +1641,3 @@\n one\n-two\n+two EDITED\n three\n'
          }
        ]),
        commit('c1', 'add anchor', [{ path: deep, content: t0 }])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: deep, commits, seedContent: t1 });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 2);
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit two',
        original: t0,
        modified: t1,
        originalStartLine: 1641,
        modifiedStartLine: 1641
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'add anchor',
        original: '',
        modified: t0,
        originalStartLine: 1641,
        modifiedStartLine: 1641
      });
    });

    it("numbers a rename-and-edit rung against each side's own address", () => {
      // The rename commit's old side lives in f.txt#L3-L12's line space and
      // its new side in g.txt#L1-L10's: one shared start line would number
      // the old side's rows 2 short of the file. Each side must carry its
      // own extent start (3 and 1).
      const x0 = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n';
      const x1 = 'a\nb\nc\nd EDITED\ne\nf\ng\nh\ni\nj\n';
      const x2 = 'A\nB\nc\nd EDITED\ne\nf\ng\nh\ni\nj\n';
      const commits: HistoryCommit[] = [
        commit('c2', 'rename and edit', [
          {
            path: 'g.txt#L1-L10',
            diff: 'diff --git a/.span/x b/.span/x\nrename from f.txt#L3-L12\nrename to g.txt#L1-L10\nindex rk64:bbbb..rk64:cccc\n--- a/f.txt#L3-L12\n+++ b/g.txt#L1-L10\n@@ -3,2 +1,2 @@\n-a\n-b\n+A\n+B\n'
          }
        ]),
        commit('c0', 'add anchor', [{ path: 'f.txt#L3-L12', content: x0 }])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: 'g.txt#L1-L10', commits, seedContent: x2 });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 2);
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'rename and edit',
        original: x1,
        modified: x2,
        originalStartLine: 3,
        modifiedStartLine: 1
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c0',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'add anchor',
        original: '',
        modified: x0,
        originalStartLine: 3,
        modifiedStartLine: 3
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
            // The old side's hunks render at f.txt's own first line (3), the
            // new side's at g.txt's (1) -- the CLI's real-file coordinates.
            diff: 'diff --git a/.span/x b/.span/x\nrename from f.txt#L3-L12\nrename to g.txt#L1-L10\nindex rk64:bbbb..rk64:cccc\n--- a/f.txt#L3-L12\n+++ b/g.txt#L1-L10\n@@ -3,2 +1,2 @@\n-a\n-b\n+A\n+B\n'
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

    it('resolves a full addition from the diff new side and continues the walk past it', () => {
      // C1 introduces the anchor with content t0; C2 edits it to t2. The walk
      // renders C2 by reverse-apply, then resolves C1's full addition from its
      // own new side (t0, the pre-C2 state) -- and because a full addition is
      // only the lineage origin when nothing older matched, the walk continues
      // into C0's deliberately unreadable diff below and fails closed there
      // instead of terminating at the addition.
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
        commit('c0', 'unreadable older edit', [
          { path: ADDRESS, diff: 'diff --git a/f.txt b/f.txt\n@@ -99,1 +99,2 @@\n a\n+b\n' }
        ])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, seedContent: t2 });

      assert.strictEqual(result.truncated, true);
      assert.strictEqual(result.rungs.length, 3, 'the walk continues past the full addition into the older lineage');
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
      assert.strictEqual(result.rungs[2]?.hash, 'c0');
      assert.strictEqual(result.rungs[2]?.truncatedAt, true);
      assert.strictEqual(result.rungs[2]?.original, '');
      assert.strictEqual(result.rungs[2]?.modified, '');
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
      // A header-only current diff now proves the bytes did not change and
      // seeds directly, so the unrecoverable shape is an in-place diff whose
      // post-region contradicts the content -- the pair the CLI certified
      // disagrees, and the recovery must fail closed.
      const current: CurrentAnchor = {
        path: 'f.txt#L1-L3',
        diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n x\n-y\n+z\n',
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

    it('walks multiple committed edits after the recording, resolving every hop from a worktree-drift seed', () => {
      // Recorded at c1; c2 edits line two; c3 edits line seven; the worktree
      // drifts on line nine after c3. The seed must be c3's post-image
      // (recovered from the current block's own diff), not the worktree text
      // and not c2's state -- only then do both hops reverse-apply cleanly.
      const t0 =
        'line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t1 =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t2 =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven EDITED\nline eight\nline nine\nline ten\n';
      const worktree =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven EDITED\nline eight\nline nine WORKTREE\nline ten\n';
      const commits: HistoryCommit[] = [
        commit('c3', 'edit line seven', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -6,3 +6,3 @@\n line six\n-line seven\n+line seven EDITED\n line eight\n'
          }
        ]),
        commit('c2', 'edit line two', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line two EDITED\n line three\n'
          }
        ]),
        commit('c1', 'add anchor', [{ path: ADDRESS, content: t0 }])
      ];
      const current: CurrentAnchor = {
        path: ADDRESS,
        diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -6,5 +6,5 @@\n line six\n line seven EDITED\n line eight\n-line nine\n+line nine WORKTREE\n line ten\n',
        content: worktree,
        sources: ['WORKTREE']
      };

      const result = buildHistorySnapshotLadder({
        liveAddress: ADDRESS,
        commits,
        current,
        seedContent: worktree
      });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 3, 'every hop resolves, nothing truncates');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c3',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit line seven',
        original: t1,
        modified: t2
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit line two',
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

    it('threads a drifted declaration seed forward: records once, edits at c2 and c3 without re-anchoring, and still renders every rung', () => {
      // Recorded at c1 (the declaration's recorded token hashes t0); c2 edits
      // line two and c3 edits line seven WITHOUT re-anchoring -- the CLI's
      // own default `drift --fix` posture -- so the recorded state stays t0
      // while the timeline moves on to t2. The current block's old side is
      // therefore the c1-era recorded bytes (t0), not the post-newest-commit
      // state: seeding straight from it makes c3's reverse-apply fail its
      // post-image match and truncate at rung zero. The ladder must thread
      // the recorded state forward through c2's and c3's diffs to recover t2,
      // then walk back through all three rungs.
      const t0 =
        'line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t1 =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t2 =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven EDITED\nline eight\nline nine\nline ten\n';
      const worktree =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven EDITED\nline eight\nline nine WORKTREE\nline ten\n';
      const commits: HistoryCommit[] = [
        commit('c3', 'edit line seven', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -6,3 +6,3 @@\n line six\n-line seven\n+line seven EDITED\n line eight\n'
          }
        ]),
        commit('c2', 'edit line two', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line two EDITED\n line three\n'
          }
        ]),
        commit('c1', 'record anchor', [{ path: ADDRESS, content: t0 }])
      ];
      const current: CurrentAnchor = {
        path: ADDRESS,
        // The old side is the RECORDED snapshot (t0, from c1), not the
        // post-newest-commit state -- the drifted-declaration shape. The diff
        // covers every difference between t0 and the worktree (lines two,
        // seven, and nine), exactly as the CLI renders recorded-vs-live.
        diff: [
          'diff --git a/f.txt b/f.txt',
          'index rk64:aaaa..rk64:bbbb',
          '--- a/f.txt',
          '+++ b/f.txt',
          '@@ -1,10 +1,10 @@',
          ' line one',
          '-line two',
          '+line two EDITED',
          ' line three',
          ' line four',
          ' line five',
          ' line six',
          '-line seven',
          '+line seven EDITED',
          ' line eight',
          '-line nine',
          '+line nine WORKTREE',
          ' line ten'
        ].join('\n'),
        content: worktree,
        sources: ['WORKTREE']
      };

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, current, seedContent: worktree });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 3, 'all three rungs render despite the drifted declaration');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c3',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit line seven',
        original: t1,
        modified: t2
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit line two',
        original: t0,
        modified: t1
      });
      assert.deepStrictEqual(result.rungs[2], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'record anchor',
        original: '',
        modified: t0
      });
    });

    it('threads a drifted declaration recorded mid-history: the pre-recording diff is skipped, newer ones chain', () => {
      // Recorded at c2 (re-anchored there: the recorded token hashes t1),
      // then c3 edits line seven without re-anchoring. The current block's
      // old side is the c2-era recorded bytes (t1). Threading from t1 must
      // skip c2's own diff -- its pre-region is t0, the pre-recording state,
      // so the running text already is that commit's post-state -- and chain
      // c3's diff to recover t2, then walk back through all three rungs.
      const t0 =
        'line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t1 =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t2 =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven EDITED\nline eight\nline nine\nline ten\n';
      const worktree =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven EDITED\nline eight\nline nine WORKTREE\nline ten\n';
      const commits: HistoryCommit[] = [
        commit('c3', 'edit line seven', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -6,3 +6,3 @@\n line six\n-line seven\n+line seven EDITED\n line eight\n'
          }
        ]),
        commit('c2', 'edit line two', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line two EDITED\n line three\n'
          }
        ]),
        commit('c1', 'add anchor', [{ path: ADDRESS, content: t0 }])
      ];
      const current: CurrentAnchor = {
        path: ADDRESS,
        // The old side is t1: the recorded snapshot from the c2 re-anchor.
        // The diff covers every difference between t1 and the worktree
        // (lines seven and nine).
        diff: [
          'diff --git a/f.txt b/f.txt',
          'index rk64:aaaa..rk64:bbbb',
          '--- a/f.txt',
          '+++ b/f.txt',
          '@@ -6,5 +6,5 @@',
          ' line six',
          '-line seven',
          '+line seven EDITED',
          ' line eight',
          '-line nine',
          '+line nine WORKTREE',
          ' line ten'
        ].join('\n'),
        content: worktree,
        sources: ['WORKTREE']
      };

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, current, seedContent: worktree });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 3, 'the walk threads past the pre-recording diff to every rung');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c3',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit line seven',
        original: t1,
        modified: t2
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit line two',
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

    it('seeds the drifted branch from the recorded bytes when the current diff is a full deletion', () => {
      // The anchor was deleted from the worktree declaration (a re-anchor
      // split), so the current diff's new side is /dev/null and `content`
      // carries the recorded bytes -- the post-newest-commit state the walk
      // seeds from, no reconstruction needed.
      const t0 = 'line one\nline two\nline three\n';
      const t1 = 'line one\nline two EDITED\nline three\n';
      const commits: HistoryCommit[] = [
        commit('c2', 'edit', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line two EDITED\n line three\n'
          }
        ]),
        commit('c1', 'add anchor', [{ path: ADDRESS, content: t0 }])
      ];
      const current: CurrentAnchor = {
        path: ADDRESS,
        diff: 'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3\ndeleted anchor\nindex rk64:bbbb..rk64:aaaa\n--- a/f.txt#L1-L3\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-line one\n-line two EDITED\n-line three\n',
        content: t1
      };

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, current, seedContent: '' });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 2);
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit',
        original: t0,
        modified: t1
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'add anchor',
        original: '',
        modified: t0
      });
    });

    it('seeds the drifted branch from unchanged content when the current diff is a header-only relocation', () => {
      // A relocation is a pure move: identical bytes at a new address, so the
      // current diff carries the `proposed anchor` header and no hunks -- the
      // content could not have changed, and is the seed.
      const t0 = 'line one\nline two\nline three\n';
      const t1 = 'line one\nline two EDITED\nline three\n';
      const commits: HistoryCommit[] = [
        commit('c2', 'edit', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line two EDITED\n line three\n'
          }
        ]),
        commit('c1', 'add anchor', [{ path: ADDRESS, content: t0 }])
      ];
      const current: CurrentAnchor = {
        path: ADDRESS,
        diff: 'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3\nproposed anchor f.txt#L4-L6\nindex rk64:aaaa..rk64:bbbb\n',
        content: t1,
        proposed: 'f.txt#L4-L6'
      };

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, current, seedContent: '' });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 2);
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit',
        original: t0,
        modified: t1
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'add anchor',
        original: '',
        modified: t0
      });
    });

    it('walks the timeline when the current anchor is a full deletion with no readable content', () => {
      // The anchor's live bytes are gone (worktree deletion), so there is no
      // post-image to seed from -- but the timeline's deletion commit
      // resolves its old side directly from its own diff, and the walk
      // continues through it to the record rung below instead of silently
      // dropping it.
      const t0 = 'line one\nline two\nline three\n';
      const commits: HistoryCommit[] = [
        commit('c2', 'delete anchor', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3\ndeleted anchor\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt#L1-L3\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-line one\n-line two\n-line three\n'
          }
        ]),
        commit('c1', 'add anchor', [{ path: ADDRESS, content: t0 }])
      ];
      const current: CurrentAnchor = {
        path: ADDRESS,
        diff: 'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3\ndeleted anchor\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt#L1-L3\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-line one\n-line two\n-line three\n',
        unavailable: 'absent'
      };

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, current, seedContent: '' });

      assert.strictEqual(result.truncated, false);
      assert.deepStrictEqual(result.rungs, [
        {
          hash: 'c2',
          date: '2026-01-01T00:00:00-04:00',
          summary: 'delete anchor',
          original: t0,
          modified: ''
        },
        {
          hash: 'c1',
          date: '2026-01-01T00:00:00-04:00',
          summary: 'add anchor',
          original: '',
          modified: t0
        }
      ]);
    });

    it('threads a drifted deleted-anchor seed forward: records once, edits at c2 and c3, then the worktree deletes the file, and still renders every rung', () => {
      // Recorded at c1 (the recorded token hashes t0); c2 edits line two and
      // c3 edits line seven WITHOUT re-anchoring; then the anchored file is
      // deleted from the worktree, so the current block carries no readable
      // content and its full-deletion diff's old side is the c1-era recorded
      // bytes (t0), not the post-newest-commit state. Seeding straight from
      // those bytes makes c3's reverse-apply fail its post-image match and
      // truncate; the ladder must thread the recorded bytes forward through
      // c2's and c3's diffs to recover t2, then walk back through all three
      // rungs.
      const t0 =
        'line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t1 =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t2 =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven EDITED\nline eight\nline nine\nline ten\n';
      const commits: HistoryCommit[] = [
        commit('c3', 'edit line seven', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -6,3 +6,3 @@\n line six\n-line seven\n+line seven EDITED\n line eight\n'
          }
        ]),
        commit('c2', 'edit line two', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line two EDITED\n line three\n'
          }
        ]),
        commit('c1', 'record anchor', [{ path: ADDRESS, content: t0 }])
      ];
      const current: CurrentAnchor = {
        path: ADDRESS,
        // The old side is the RECORDED snapshot (t0, from c1), not the
        // post-newest-commit state -- the drifted-declaration-then-worktree-
        // deletion shape: the recorded token still hashes t0 while the
        // timeline moved on to t2.
        diff: [
          'diff --git a/f.txt#L1-L10 b/f.txt#L1-L10',
          'deleted anchor',
          'index rk64:aaaa..rk64:bbbb',
          '--- a/f.txt#L1-L10',
          '+++ /dev/null',
          '@@ -1,10 +0,0 @@',
          '-line one',
          '-line two',
          '-line three',
          '-line four',
          '-line five',
          '-line six',
          '-line seven',
          '-line eight',
          '-line nine',
          '-line ten'
        ].join('\n'),
        unavailable: 'absent'
      };

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, current, seedContent: '' });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(
        result.rungs.length,
        3,
        'all three rungs render despite the drifted deleted-anchor declaration'
      );
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c3',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit line seven',
        original: t1,
        modified: t2
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit line two',
        original: t0,
        modified: t1
      });
      assert.deepStrictEqual(result.rungs[2], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'record anchor',
        original: '',
        modified: t0
      });
    });

    it('threads a drifted declaration forward through a committed delete-then-re-add: every rung renders', () => {
      // Recorded at c1 (the recorded token hashes t0); the anchored file is
      // committed-deleted at c2 and re-created at c3, then edited at c4
      // WITHOUT re-anchoring, and the worktree drifts on top. The recorded
      // bytes are the c1-era t0, and the newest edit rung's post-image is the
      // re-created content -- so the forward threading must advance THROUGH
      // the `/dev/null`-sided rungs (the deletion empties the running state,
      // the re-add fills it with the diff's own new side) or the c4 rung's
      // post-image match fails against the c1-era bytes and everything
      // truncates at rung zero.
      const t0 =
        'line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t1 =
        'line one\nline two\nline three\nline four\nline five\nline six\nline seven EDITED\nline eight\nline nine\nline ten\n';
      const worktree =
        'line one\nline two\nline three\nline four\nline five\nline six\nline seven EDITED\nline eight\nline nine WORKTREE\nline ten\n';
      const commits: HistoryCommit[] = [
        commit('c4', 'edit line seven', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:cccc..rk64:dddd\n--- a/f.txt\n+++ b/f.txt\n@@ -6,3 +6,3 @@\n line six\n-line seven\n+line seven EDITED\n line eight\n'
          }
        ]),
        commit('c3', 're-add anchor', [
          {
            path: ADDRESS,
            diff: [
              'diff --git a/f.txt#L1-L10 b/f.txt#L1-L10',
              'new anchor',
              'index rk64:bbbb..rk64:cccc',
              '--- /dev/null',
              '+++ b/f.txt#L1-L10',
              '@@ -0,0 +1,10 @@',
              '+line one',
              '+line two',
              '+line three',
              '+line four',
              '+line five',
              '+line six',
              '+line seven',
              '+line eight',
              '+line nine',
              '+line ten'
            ].join('\n')
          }
        ]),
        commit('c2', 'delete anchor', [
          {
            path: ADDRESS,
            diff: [
              'diff --git a/f.txt#L1-L10 b/f.txt#L1-L10',
              'deleted anchor',
              'index rk64:aaaa..rk64:bbbb',
              '--- a/f.txt#L1-L10',
              '+++ /dev/null',
              '@@ -1,10 +0,0 @@',
              '-line one',
              '-line two',
              '-line three',
              '-line four',
              '-line five',
              '-line six',
              '-line seven',
              '-line eight',
              '-line nine',
              '-line ten'
            ].join('\n')
          }
        ]),
        commit('c1', 'record anchor', [{ path: ADDRESS, content: t0 }])
      ];
      const current: CurrentAnchor = {
        path: ADDRESS,
        // The old side is the RECORDED snapshot (t0, from c1) -- the drift-
        // declaration shape: the recorded token still hashes t0 while the
        // timeline moved through delete, re-add, and edit to t1.
        diff: [
          'diff --git a/f.txt b/f.txt',
          'index rk64:aaaa..rk64:dddd',
          '--- a/f.txt',
          '+++ b/f.txt',
          '@@ -6,5 +6,5 @@',
          ' line six',
          '-line seven',
          '+line seven EDITED',
          ' line eight',
          '-line nine',
          '+line nine WORKTREE',
          ' line ten'
        ].join('\n'),
        content: worktree,
        sources: ['WORKTREE']
      };

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, current, seedContent: worktree });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 4, 'the delete and re-add rungs render, nothing truncates');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c4',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit line seven',
        original: t0,
        modified: t1
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c3',
        date: '2026-01-01T00:00:00-04:00',
        summary: 're-add anchor',
        original: '',
        modified: t0
      });
      assert.deepStrictEqual(result.rungs[2], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'delete anchor',
        original: t0,
        modified: ''
      });
      assert.deepStrictEqual(result.rungs[3], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'record anchor',
        original: '',
        modified: t0
      });
    });

    it('threads the clean seed forward when the worktree reverted to the recorded bytes, older than the newest commit', () => {
      // Committed-but-unreconciled: recorded at c1, edited and committed at c2
      // without re-anchoring, worktree reverted to the recorded bytes -- the
      // CLI's `resolved, pending commit` classification, so `current` is
      // absent and the disk-read clean content equals the recorded token,
      // OLDER than the newest commit. Seeding straight from those bytes makes
      // c2's reverse-apply fail its post-image match and truncate at rung
      // zero; the ladder must thread the seed forward through c2's diff to
      // recover t1, then walk back through both rungs.
      const t0 =
        'line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t1 =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const commits: HistoryCommit[] = [
        commit('c2', 'edit line two', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line two EDITED\n line three\n'
          }
        ]),
        commit('c1', 'record anchor', [{ path: ADDRESS, content: t0 }])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, seedContent: t0 });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 2, 'the c2 edit and c1 record rungs both render');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit line two',
        original: t0,
        modified: t1
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'record anchor',
        original: '',
        modified: t0
      });
    });

    it('threads a drifted header-only seed forward: recorded once, edited at c2, then re-anchored to identical bytes', () => {
      // A header-only current diff (here a pure rename: identical bytes at a
      // new address) proves the worktree bytes equal the recorded bytes -- but
      // those are the c1-era bytes, OLDER than the c2 edit, when the
      // declaration is drifted. The header-only branch must thread the recorded
      // bytes forward through c2's diff just like the drifted branch, or the
      // c2 rung's post-image match fails and the ladder truncates at rung
      // zero.
      const t0 =
        'line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const t1 =
        'line one\nline two EDITED\nline three\nline four\nline five\nline six\nline seven\nline eight\nline nine\nline ten\n';
      const commits: HistoryCommit[] = [
        commit('c2', 'edit line two', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line two EDITED\n line three\n'
          }
        ]),
        commit('c1', 'record anchor', [{ path: ADDRESS, content: t0 }])
      ];
      const current: CurrentAnchor = {
        path: 'f.txt#L30-L39',
        // The re-anchored address wears the c1-era recorded bytes; the diff
        // carries the rename headers and no hunks because the content never
        // changed -- the committed-but-unreconciled shape whose worktree bytes
        // are the recorded token.
        diff: [
          'diff --git a/f.txt#L1-L5 b/f.txt#L30-L39',
          'rename from f.txt#L1-L5',
          'rename to f.txt#L30-L39',
          'index rk64:aaaa..rk64:aaaa'
        ].join('\n'),
        content: t0,
        sources: ['HEAD']
      };

      const result = buildHistorySnapshotLadder({ liveAddress: 'f.txt#L30-L39', commits, current, seedContent: '' });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 2, 'both rungs render despite the drifted header-only seed');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit line two',
        original: t0,
        modified: t1
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'record anchor',
        original: '',
        modified: t0
      });
    });

    it('seeds a re-anchored drifted anchor from the recorded bytes and walks its rename-from lineage', () => {
      // The real `git span history` shape for an uncommitted in-place re-anchor
      // (address rewritten in the .span file, recorded token kept): the
      // current entry at the declared address carries `rename from/to`
      // headers, the old side's hunk coordinate in the FROM address's line
      // space (1) and the new side's in the declared address's (3), and the
      // committed history lives under the FROM address. The lineage must start
      // at `rename from f.txt#L1-L3` or it is invisible, and the seed recovery
      // must rebase the old side against the from address's extent start or it
      // throws on the negative rebase.
      const commits: HistoryCommit[] = [
        commit('c1', 'record anchor', [{ path: 'f.txt#L1-L3', content: 'alpha\nbeta\ngamma\n' }])
      ];
      const current: CurrentAnchor = {
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

      const result = buildHistorySnapshotLadder({ liveAddress: 'f.txt#L3-L5', commits, current, seedContent: '' });

      assert.strictEqual(result.truncated, false);
      assert.deepStrictEqual(result.rungs, [
        {
          hash: 'c1',
          date: '2026-01-01T00:00:00-04:00',
          summary: 'record anchor',
          original: '',
          modified: 'alpha\nbeta\ngamma\n'
        }
      ]);
    });

    it('walks a re-anchor back to an address with its own committed history, seeding from the recorded bytes', () => {
      // The evaluator-confirmed Arm A shape: committed history at the declared
      // address (c1 records at f.txt#L3-L5), a committed re-anchor moves the
      // anchor away (c2, a header-only rename entry at f.txt#L1-L3), and an
      // UNCOMMITTED re-anchor back to f.txt#L3-L5 with content drift makes the
      // current entry a rename with hunks. The lineage must start at the
      // current entry's `rename from` address, follow the committed chain back
      // across the c2 rename boundary to the declared address's own record
      // rung, and the seed recovery must rebase each hunk side against its own
      // address's extent start.
      const current: CurrentAnchor = {
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
      const commits: HistoryCommit[] = [
        commit('c2', 're-anchor', [
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
        commit('c1', 'record anchor', [{ path: 'f.txt#L3-L5', content: 'alpha\nbeta\ngamma\n' }])
      ];

      const result = buildHistorySnapshotLadder({
        liveAddress: 'f.txt#L3-L5',
        commits,
        current,
        seedContent: ''
      });

      assert.strictEqual(result.truncated, false);
      assert.deepStrictEqual(result.rungs, [
        {
          hash: 'c2',
          date: '2026-01-01T00:00:00-04:00',
          summary: 're-anchor',
          original: 'alpha\nbeta\ngamma\n',
          modified: 'alpha\nbeta\ngamma\n'
        },
        {
          hash: 'c1',
          date: '2026-01-01T00:00:00-04:00',
          summary: 'record anchor',
          original: '',
          modified: 'alpha\nbeta\ngamma\n'
        }
      ]);
    });

    it('renders every rung across a committed delete-then-re-add at the same address', () => {
      // A full addition is only the lineage origin when nothing older
      // matched; a committed delete (c2) then re-add (c3) at the same address
      // produces a mid-lineage addition, and the deletion rung below resolves
      // from its own diff's old side and the record rung from its content --
      // so the walk must continue through the addition and deletion instead
      // of terminating and silently dropping the older commits.
      const t0 = 'line one\nline two\nline three\n';
      const commits: HistoryCommit[] = [
        commit('c3', 're-add anchor', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3\nnew anchor\nindex rk64:bbbb..rk64:cccc\n--- /dev/null\n+++ b/f.txt#L1-L3\n@@ -0,0 +1,3 @@\n+line one\n+line two\n+line three\n'
          }
        ]),
        commit('c2', 'delete anchor', [
          {
            path: ADDRESS,
            diff: 'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3\ndeleted anchor\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt#L1-L3\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-line one\n-line two\n-line three\n'
          }
        ]),
        commit('c1', 'record anchor', [{ path: ADDRESS, content: t0 }])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: ADDRESS, commits, seedContent: t0 });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 3, 'the deletion and record commits are not silently dropped');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c3',
        date: '2026-01-01T00:00:00-04:00',
        summary: 're-add anchor',
        original: '',
        modified: t0
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'delete anchor',
        original: t0,
        modified: ''
      });
      assert.deepStrictEqual(result.rungs[2], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'record anchor',
        original: '',
        modified: t0
      });
    });

    it('fails the pure-rename rung closed when the raced-clean seed is empty', () => {
      // A clean anchor whose disk read raced the CLI passes an empty ladder
      // seed. The edit rungs of that shape already fail closed with a
      // truncatedAt marker; the pure-rename rung must do the same instead of
      // rendering a silent empty pair.
      const commits: HistoryCommit[] = [
        commit('c2', 'rename', [
          {
            path: 'g.txt#L1-L3',
            diff: 'diff --git a/.span/x b/.span/x\nrename from f.txt#L1-L3\nrename to g.txt#L1-L3\nindex rk64:aaaa..rk64:bbbb\n'
          }
        ]),
        commit('c1', 'add anchor', [{ path: 'f.txt#L1-L3', content: 'a\nb\nc\n' }])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: 'g.txt#L1-L3', commits, seedContent: '' });

      assert.strictEqual(result.truncated, true);
      assert.strictEqual(result.rungs.length, 1, 'the rename rung fails closed instead of rendering an empty pair');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'rename',
        original: '',
        modified: '',
        truncatedAt: true
      });
    });

    it('renders a pure rename rung with unchanged content and continues the walk past it', () => {
      // C2 re-anchors the block to a new address without touching its bytes:
      // the diff carries rename headers and no hunks, so the rung is
      // original = modified = running and the walk continues onto the old
      // address's older history instead of truncating.
      const t0 = 'a\nb\nc\n';
      const t1 = 'a\nb EDITED\nc\n';
      const commits: HistoryCommit[] = [
        commit('c3', 'edit', [
          {
            path: 'g.txt#L1-L3',
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+b EDITED\n c\n'
          }
        ]),
        commit('c2', 'rename', [
          {
            path: 'g.txt#L1-L3',
            diff: 'diff --git a/.span/x b/.span/x\nrename from f.txt#L1-L3\nrename to g.txt#L1-L3\nindex rk64:aaaa..rk64:bbbb\n'
          }
        ]),
        commit('c1', 'add anchor', [{ path: 'f.txt#L1-L3', content: t0 }])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: 'g.txt#L1-L3', commits, seedContent: t1 });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 3, 'the walk crosses the rename boundary instead of truncating');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c3',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'edit',
        original: t0,
        modified: t1
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'rename',
        original: t0,
        modified: t0
      });
      assert.deepStrictEqual(result.rungs[2], {
        hash: 'c1',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'add anchor',
        original: '',
        modified: t0
      });
    });

    it("rebases a rename-and-edit rung's old side against the old address's extent start", () => {
      // Rename from f.txt#L1-L10 (extent start 1) to g.txt#L6-L15 (extent
      // start 6) with a two-line edit at the head of the extent: the old
      // side's hunks render in f.txt's line space (file-absolute 1) and the
      // new side's in g.txt's (file-absolute 6). Rebasing both sides by the
      // new address's start would push the old side below line 1 and throw;
      // each side must rebase against its own address.
      const x0 = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n';
      const x1 = 'a\nb\nc\nd EDITED\ne\nf\ng\nh\ni\nj\n';
      const x2 = 'A\nB\nc\nd EDITED\ne\nf\ng\nh\ni\nj\n';
      const x3 = 'A\nB\nc\nd EDITED\ne\nf\ng EDITED\nh\ni\nj\n';
      const commits: HistoryCommit[] = [
        commit('c3', 'edit g', [
          {
            path: 'g.txt#L6-L15',
            // Extent-relative line 7 = g.txt file-absolute 12; the hunk's
            // context starts one line earlier, at file-absolute 11.
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -11,3 +11,3 @@\n f\n-g\n+g EDITED\n h\n'
          }
        ]),
        commit('c2', 'rename and edit', [
          {
            path: 'g.txt#L6-L15',
            diff: 'diff --git a/.span/x b/.span/x\nrename from f.txt#L1-L10\nrename to g.txt#L6-L15\nindex rk64:bbbb..rk64:cccc\n--- a/f.txt#L1-L10\n+++ b/g.txt#L6-L15\n@@ -1,2 +6,2 @@\n-a\n-b\n+A\n+B\n'
          }
        ]),
        commit('c1', 'edit d', [
          {
            path: 'f.txt#L1-L10',
            diff: 'diff --git a/f.txt b/f.txt\nindex rk64:aaaa..rk64:bbbb\n--- a/f.txt\n+++ b/f.txt\n@@ -3,3 +3,3 @@\n c\n-d\n+d EDITED\n e\n'
          }
        ]),
        commit('c0', 'add anchor', [{ path: 'f.txt#L1-L10', content: x0 }])
      ];

      const result = buildHistorySnapshotLadder({ liveAddress: 'g.txt#L6-L15', commits, seedContent: x3 });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 4);
      assert.deepStrictEqual(result.rungs[0]?.original, x2);
      assert.deepStrictEqual(result.rungs[0]?.modified, x3);
      assert.deepStrictEqual(
        result.rungs[1]?.original,
        x1,
        'the rename commit reverse-applies its old side against the old address'
      );
      assert.deepStrictEqual(result.rungs[1]?.modified, x2);
      assert.deepStrictEqual(result.rungs[2]?.original, x0);
      assert.deepStrictEqual(result.rungs[2]?.modified, x1);
      assert.deepStrictEqual(result.rungs[3], {
        hash: 'c0',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'add anchor',
        original: '',
        modified: x0
      });
    });

    it('renders the recording rung for a byte-identical uncommitted re-anchor, walking the span_diff from-address', () => {
      // The REAL `git span history` shape for the CLI's `drift --fix` output
      // before the fix is committed: record f.txt#L1-L3, insert a line above,
      // run `drift --fix`. The re-anchor is byte-identical, so the resolver
      // reports nothing under `current.anchors` (the provider finds no entry
      // and passes no `current`) and `current.span_diff`'s same-token address
      // move is the only trace that the committed history lives under the OLD
      // address -- the walk must start there or the recording rung is dropped
      // and the anchor is left dangling.
      const t0 = 'alpha\nbeta\ngamma\n';
      const commits: HistoryCommit[] = [commit('c2', 'record anchor', [{ path: 'f.txt#L1-L3', content: t0 }])];
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

      const result = buildHistorySnapshotLadder({
        liveAddress: 'f.txt#L2-L4',
        commits,
        currentSpanDiff,
        seedContent: t0
      });

      assert.strictEqual(result.truncated, false);
      assert.deepStrictEqual(result.rungs, [
        {
          hash: 'c2',
          date: '2026-01-01T00:00:00-04:00',
          summary: 'record anchor',
          original: '',
          modified: t0
        }
      ]);
    });

    it('crosses a committed re-anchor destination rung and renders the true origin below', () => {
      // The REAL routine shape for a committed re-anchor (record f.txt#L1-L3
      // with a/b/c at c2, commit an edit at c3, run `drift --fix` and commit
      // the fix at c4): the fix commit carries a CONTENT block at the new
      // address (its content is the moved address's file bytes, a/b/c) plus a
      // full deletion at the old address (the pre-fix bytes x/y/a) -- no
      // rename headers anywhere -- and its own span_diff carries the
      // same-token address move. Without the crossing the walk terminates at
      // the content block as a false "first-add" origin and the c3 edit and c2
      // record rungs are silently dropped; with it, the destination rung
      // renders the delete+add pair and the walk continues to the real
      // recording.
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

      const result = buildHistorySnapshotLadder({ liveAddress: 'f.txt#L3-L5', commits, seedContent: 'a\nb\nc\n' });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.rungs.length, 3, 'the destination rung is crossed, the edit and record rungs render');
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c4',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'c4-drift-fix',
        original: 'x\ny\na\n',
        modified: 'a\nb\nc\n'
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c3',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'c3-modify',
        original: 'a\nb\nc\n',
        modified: 'x\ny\na\n'
      });
      assert.deepStrictEqual(result.rungs[2], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'c2-record',
        original: '',
        modified: 'a\nb\nc\n'
      });
    });

    it('crosses a committed re-anchor destination rung from a drifted seed, rendering the delete+add pair and the true origin', () => {
      // The real drifted variant of the committed re-anchor (a kept-token
      // move whose target bytes differ from the recorded ones): the fix
      // commit carries a content block at the new address plus a full
      // deletion at the old, the current entry at the new address is a
      // relocation (`proposed` names the old address), and the seed comes
      // from the current entry's own bytes -- the destination rung must
      // still render the delete+add pair (old side = the deletion block's
      // bytes, new side = the content block's) and the walk must reach the
      // actual recording at the old address.
      const commits: HistoryCommit[] = [
        {
          hash: 'c3',
          date: '2026-01-01T00:00:00-04:00',
          summary: 'c3-reanchor-keep-token',
          anchors: [
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
          ],
          span_diff: [
            'diff --git a/.span/demo b/.span/demo',
            'index 45dc756..a9b3db2 100644',
            '--- a/.span/demo',
            '+++ b/.span/demo',
            '@@ -1,2 +1,2 @@',
            '-f.txt#L3-L5 rk64:e0c06c534424c68e',
            '+f.txt#L1-L3 rk64:e0c06c534424c68e',
            ' '
          ].join('\n')
        },
        commit('c2', 'c2-record', [{ path: 'f.txt#L3-L5', content: 'gamma\ndelta\nepsilon\n' }])
      ];
      const current: CurrentAnchor = {
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
      };

      const result = buildHistorySnapshotLadder({ liveAddress: 'f.txt#L1-L3', commits, current, seedContent: '' });

      assert.strictEqual(result.truncated, false);
      assert.strictEqual(
        result.rungs.length,
        2,
        'the destination rung renders the delete+add pair, the record rung follows'
      );
      assert.deepStrictEqual(result.rungs[0], {
        hash: 'c3',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'c3-reanchor-keep-token',
        original: 'gamma\ndelta\nepsilon\n',
        modified: 'alpha\nbeta\ngamma\n'
      });
      assert.deepStrictEqual(result.rungs[1], {
        hash: 'c2',
        date: '2026-01-01T00:00:00-04:00',
        summary: 'c2-record',
        original: '',
        modified: 'gamma\ndelta\nepsilon\n'
      });
    });
  });
});
