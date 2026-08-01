/**
 * Tests for reverse-applying the CLI's certified anchor diffs.
 *
 * Every hunk coordinate here is **file-absolute** (as the CLI renders them),
 * so `extentStartLine` decides how far each hunk rebases before it is applied
 * against the extent-only content string.
 *
 * @summary Patch reconstruction unit tests.
 * @module test/suite/spanViewer/patchReconstruction.test
 */

import * as assert from 'node:assert';
import {
  applyDiffForward,
  extractHunkSide,
  isFullAddition,
  isFullDeletion,
  ReconstructionError,
  reconstructOriginal
} from '../../../src/spanViewer/patchReconstruction.js';

describe('patchReconstruction', () => {
  describe('reconstructOriginal', () => {
    it('reverse-applies a single hunk at a non-1 extent start line', () => {
      // Extent covers file lines 5-8, so the hunk renders at file-absolute
      // 5 while the content string only carries the four extent lines.
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -5,4 +5,4 @@',
        ' line five',
        '-line six',
        '+line six EDITED',
        ' line seven',
        ' line eight'
      ].join('\n');
      const preImage = reconstructOriginal(diff, 'line five\nline six EDITED\nline seven\nline eight\n', 5);
      assert.strictEqual(preImage, 'line five\nline six\nline seven\nline eight\n');
    });

    it('reverse-applies a single hunk at extent start line 1', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' alpha',
        '-beta',
        '+beta EDITED',
        ' gamma'
      ].join('\n');
      const preImage = reconstructOriginal(diff, 'alpha\nbeta EDITED\ngamma\n', 1);
      assert.strictEqual(preImage, 'alpha\nbeta\ngamma\n');
    });

    it('reverse-applies multiple hunks in one diff', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,5 +1,5 @@',
        ' line 1',
        ' line 2',
        '-line 3',
        '+line 3 EDITED',
        ' line 4',
        ' line 5',
        '@@ -6,5 +6,5 @@',
        ' line 6',
        ' line 7',
        '-line 8',
        '+line 8 EDITED',
        ' line 9',
        ' line 10'
      ].join('\n');
      const postImage =
        'line 1\nline 2\nline 3 EDITED\nline 4\nline 5\nline 6\nline 7\nline 8 EDITED\nline 9\nline 10\n';
      const preImage = reconstructOriginal(diff, postImage, 1);
      assert.strictEqual(preImage, 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\n');
    });

    it('honors "\\ No newline at end of file" markers on both sides', () => {
      // Both the pre-image and the post-image lack a trailing newline, so the
      // CLI marks the final body line of both sides.
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,2 +1,2 @@',
        ' alpha',
        '-beta',
        '\\ No newline at end of file',
        '+beta EDITED',
        '\\ No newline at end of file'
      ].join('\n');
      const preImage = reconstructOriginal(diff, 'alpha\nbeta EDITED', 1);
      assert.strictEqual(preImage, 'alpha\nbeta');
    });

    it('keeps a trailing newline when only the old side is marked no-newline', () => {
      // Only the pre-image lacks a trailing newline: the marker follows the
      // '-' line, and the post-image keeps its own trailing newline.
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,2 +1,2 @@',
        ' alpha',
        '-beta',
        '\\ No newline at end of file',
        '+beta EDITED'
      ].join('\n');
      const preImage = reconstructOriginal(diff, 'alpha\nbeta EDITED\n', 1);
      assert.strictEqual(preImage, 'alpha\nbeta');
    });

    it('throws ReconstructionError when a rebased hunk range does not fit the post-image', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -13,1 +13,1 @@',
        ' alpha',
        '-beta',
        '+beta EDITED'
      ].join('\n');
      // Extent starts at file line 10; the hunk rebases to new start 4, past
      // the 3-line post-image's end -- must throw, never pass through.
      assert.throws(() => reconstructOriginal(diff, 'alpha\nbeta\ngamma\n', 10), ReconstructionError);
    });

    it('throws ReconstructionError when the post-image does not match the diff at the expected offset', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' alpha',
        '-beta',
        '+beta EDITED',
        ' gamma'
      ].join('\n');
      // 'X' is not the diff's third post line -- the diff is not this text's
      // diff, so the recovery must fail loudly.
      assert.throws(() => reconstructOriginal(diff, 'alpha\nbeta\nX\n', 1), ReconstructionError);
    });

    it('throws ReconstructionError on a header-only diff (no hunks)', () => {
      const headerOnly = [
        'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3',
        'rebound anchor',
        'index rk64:aaaa..rk64:bbbb'
      ].join('\n');
      assert.throws(() => reconstructOriginal(headerOnly, 'alpha\nbeta\ngamma\n', 1), ReconstructionError);
    });

    it('returns "" for a hunk-level full addition (@@ -0,0 +N,M @@)', () => {
      // The new-file diff every span's adding commit carries: the old side is
      // /dev/null at the hunk level, so there is no old content to
      // reconstruct -- the pre-image is empty, not an error.
      const diff = [
        'diff --git a/.span/x b/.span/x',
        'new file mode 100644',
        'index 0000000..aaaaaaa',
        '--- /dev/null',
        '+++ b/.span/x',
        '@@ -0,0 +1,3 @@',
        '+alpha',
        '+beta',
        '+gamma'
      ].join('\n');
      assert.strictEqual(reconstructOriginal(diff, 'alpha\nbeta\ngamma\n', 1), '');
    });

    it('returns the deleted bytes for a hunk-level full deletion (@@ -N,M +0,0 @@)', () => {
      // The removed-span-file diff a deleting commit carries: the new side is
      // /dev/null at the hunk level, so the post-image is empty -- but the
      // pre-image is the deleted content, which the diff's own old side
      // carries verbatim. Returning '' would lose those bytes.
      const diff = [
        'diff --git a/.span/x b/.span/x',
        'deleted file mode 100644',
        'index aaaaaaa..0000000',
        '--- a/.span/x',
        '+++ /dev/null',
        '@@ -1,3 +0,0 @@',
        '-alpha',
        '-beta',
        '-gamma'
      ].join('\n');
      assert.strictEqual(reconstructOriginal(diff, '', 1), 'alpha\nbeta\ngamma\n');
    });

    it('rebases old and new hunk sides against their own extent start lines', () => {
      // A rename-and-edit block: the old side's hunks render in the old
      // address's line space (f.txt#L1-L10, file-absolute 1) and the new
      // side's in the new address's (g.txt#L6-L15, file-absolute 6). A single
      // rebase by the new address's start would push the old side below
      // line 1 and throw; each side must rebase against its own address.
      const diff = [
        'diff --git a/.span/x b/.span/x',
        'rename from f.txt#L1-L10',
        'rename to g.txt#L6-L15',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt#L1-L10',
        '+++ b/g.txt#L6-L15',
        '@@ -1,2 +6,2 @@',
        '-a',
        '-b',
        '+A',
        '+B'
      ].join('\n');
      const preImage = reconstructOriginal(diff, 'A\nB\nc\nd\ne\nf\ng\nh\ni\nj\n', 6, 1);
      assert.strictEqual(preImage, 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n');
    });
  });

  describe('applyDiffForward', () => {
    it('applies a single hunk forward at a non-1 extent start line', () => {
      // The inverse of reconstructOriginal: validate the pre-region against
      // the pre-image (here the extent's own text at file-absolute 5) and
      // splice in the '+' lines.
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -5,4 +5,4 @@',
        ' line five',
        '-line six',
        '+line six EDITED',
        ' line seven',
        ' line eight'
      ].join('\n');
      const postImage = applyDiffForward(diff, 'line five\nline six\nline seven\nline eight\n', 5);
      assert.strictEqual(postImage, 'line five\nline six EDITED\nline seven\nline eight\n');
    });

    it('applies multiple hunks forward in one diff', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,5 +1,5 @@',
        ' line 1',
        ' line 2',
        '-line 3',
        '+line 3 EDITED',
        ' line 4',
        ' line 5',
        '@@ -6,5 +6,5 @@',
        ' line 6',
        ' line 7',
        '-line 8',
        '+line 8 EDITED',
        ' line 9',
        ' line 10'
      ].join('\n');
      const preImage = 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\n';
      const postImage = applyDiffForward(diff, preImage, 1);
      assert.strictEqual(
        postImage,
        'line 1\nline 2\nline 3 EDITED\nline 4\nline 5\nline 6\nline 7\nline 8 EDITED\nline 9\nline 10\n'
      );
    });

    it('throws ReconstructionError when the pre-image does not match the diff at the expected offset', () => {
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,3 @@',
        ' alpha',
        '-beta',
        '+beta EDITED',
        ' gamma'
      ].join('\n');
      // 'beta X' is not the diff's second pre line -- the diff is not this
      // text's diff, so the forward apply must fail loudly, never pass
      // through.
      assert.throws(() => applyDiffForward(diff, 'alpha\nbeta X\ngamma\n', 1), ReconstructionError);
    });

    it('honors "\\ No newline at end of file" markers on both sides', () => {
      // Both the pre-image and the post-image lack a trailing newline, so the
      // CLI marks the final body line of both sides.
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,2 +1,2 @@',
        ' alpha',
        '-beta',
        '\\ No newline at end of file',
        '+beta EDITED',
        '\\ No newline at end of file'
      ].join('\n');
      const postImage = applyDiffForward(diff, 'alpha\nbeta', 1);
      assert.strictEqual(postImage, 'alpha\nbeta EDITED');
    });

    it('accepts a marked "+" that replaces a newline-terminated final line', () => {
      // The marker on a '+' line speaks about the post side, which is the
      // output: pre `beta\n` may legitimately become `beta EDITED` without a
      // trailing newline. Only pre-side markers are validated against the
      // pre-image's own termination.
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,2 +1,2 @@',
        ' alpha',
        '-beta',
        '+beta EDITED',
        '\\ No newline at end of file'
      ].join('\n');
      const postImage = applyDiffForward(diff, 'alpha\nbeta\n', 1);
      assert.strictEqual(postImage, 'alpha\nbeta EDITED');
    });

    it('throws when a marked "-" contradicts the pre-image ending with a newline', () => {
      // A marker on the '-' line claims the pre-image's final line lacks a
      // trailing newline; a pre-image that ends with one is not this diff's
      // pre-image, so the apply must fail closed.
      const diff = [
        'diff --git a/f.txt b/f.txt',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,2 +1,2 @@',
        ' alpha',
        '-beta',
        '\\ No newline at end of file',
        '+beta EDITED'
      ].join('\n');
      assert.throws(() => applyDiffForward(diff, 'alpha\nbeta\n', 1), ReconstructionError);
    });

    it('returns the added bytes for a hunk-level full addition (@@ -0,0 +N,M @@)', () => {
      const diff = [
        'diff --git a/.span/x b/.span/x',
        'new file mode 100644',
        'index 0000000..aaaaaaa',
        '--- /dev/null',
        '+++ b/.span/x',
        '@@ -0,0 +1,3 @@',
        '+alpha',
        '+beta',
        '+gamma'
      ].join('\n');
      assert.strictEqual(applyDiffForward(diff, '', 1), 'alpha\nbeta\ngamma\n');
    });

    it('returns "" for a hunk-level full deletion (@@ -N,M +0,0 @@)', () => {
      const diff = [
        'diff --git a/.span/x b/.span/x',
        'deleted file mode 100644',
        'index aaaaaaa..0000000',
        '--- a/.span/x',
        '+++ /dev/null',
        '@@ -1,3 +0,0 @@',
        '-alpha',
        '-beta',
        '-gamma'
      ].join('\n');
      assert.strictEqual(applyDiffForward(diff, 'alpha\nbeta\ngamma\n', 1), '');
    });

    it('rebases old and new hunk sides against their own extent start lines', () => {
      // The rename-and-edit shape of the ladder's reverse walk, applied
      // forward: the old side's hunks live in f.txt#L1-L10's line space
      // (file-absolute 1) and the new side's in g.txt#L6-L15's (file-absolute
      // 6), so each side rebases against its own address's start.
      const diff = [
        'diff --git a/.span/x b/.span/x',
        'rename from f.txt#L1-L10',
        'rename to g.txt#L6-L15',
        'index rk64:aaaa..rk64:bbbb',
        '--- a/f.txt#L1-L10',
        '+++ b/g.txt#L6-L15',
        '@@ -1,2 +6,2 @@',
        '-a',
        '-b',
        '+A',
        '+B'
      ].join('\n');
      const postImage = applyDiffForward(diff, 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n', 6, 1);
      assert.strictEqual(postImage, 'A\nB\nc\nd\ne\nf\ng\nh\ni\nj\n');
    });
  });

  describe('full addition / deletion detection', () => {
    it('detects a full addition (old side /dev/null)', () => {
      const diff = [
        'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3',
        'new anchor',
        'index rk64:aaaa..rk64:bbbb',
        '--- /dev/null',
        '+++ b/f.txt#L1-L3',
        '@@ -0,0 +1,3 @@',
        '+line one',
        '+line two',
        '+line three'
      ].join('\n');
      assert.strictEqual(isFullAddition(diff), true);
      assert.strictEqual(isFullDeletion(diff), false);
    });

    it('detects a full deletion (new side /dev/null)', () => {
      const diff = [
        'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3',
        'deleted anchor',
        'index rk64:bbbb..rk64:aaaa',
        '--- a/f.txt#L1-L3',
        '+++ /dev/null',
        '@@ -1,3 +0,0 @@',
        '-line one',
        '-line two',
        '-line three'
      ].join('\n');
      assert.strictEqual(isFullDeletion(diff), true);
      assert.strictEqual(isFullAddition(diff), false);
    });
  });

  describe('extractHunkSide', () => {
    it('extracts the new side of a full addition', () => {
      const diff = [
        'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3',
        'new anchor',
        'index rk64:aaaa..rk64:bbbb',
        '--- /dev/null',
        '+++ b/f.txt#L1-L3',
        '@@ -0,0 +1,3 @@',
        '+line one',
        '+line two',
        '+line three'
      ].join('\n');
      assert.strictEqual(extractHunkSide(diff, 'new'), 'line one\nline two\nline three\n');
      assert.strictEqual(extractHunkSide(diff, 'old'), '');
    });

    it('extracts the old side of a full deletion', () => {
      const diff = [
        'diff --git a/f.txt#L1-L3 b/f.txt#L1-L3',
        'deleted anchor',
        'index rk64:bbbb..rk64:aaaa',
        '--- a/f.txt#L1-L3',
        '+++ /dev/null',
        '@@ -1,3 +0,0 @@',
        '-line one',
        '-line two',
        '-line three'
      ].join('\n');
      assert.strictEqual(extractHunkSide(diff, 'old'), 'line one\nline two\nline three\n');
      assert.strictEqual(extractHunkSide(diff, 'new'), '');
    });
  });
});
