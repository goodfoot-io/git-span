/**
 * Tests for the client-side `.span/*` on-disk grammar parser/formatter.
 *
 * @summary Span file grammar tests.
 * @module test/suite/spanViewer/spanFileGrammar.test
 */

import * as assert from 'node:assert';
import { formatAnchorAddress, parseSpanFile } from '../../../src/spanViewer/spanFileGrammar.js';

describe('spanFileGrammar', () => {
  describe('parseSpanFile', () => {
    it('parses a single whole-file anchor with why prose', () => {
      const result = parseSpanFile('src/foo.ts sha256:abc123\n\nWhy this matters.');
      assert.ok(result);
      assert.deepStrictEqual(result.anchors, [
        { path: 'src/foo.ts', range: null, algorithm: 'sha256', contentHash: 'abc123' }
      ]);
      assert.strictEqual(result.why, 'Why this matters.');
    });

    it('parses a line-range anchor address', () => {
      const result = parseSpanFile('src/foo.ts#L10-L20 sha256:abc123\n\nWhy.');
      assert.ok(result);
      assert.deepStrictEqual(result.anchors[0]?.range, { start: 10, end: 20 });
    });

    it('parses multiple anchors in file order', () => {
      const result = parseSpanFile('a.ts sha256:aaa\nb.ts#L1-L2 sha256:bbb\n\nWhy.');
      assert.ok(result);
      assert.strictEqual(result.anchors.length, 2);
      assert.strictEqual(result.anchors[0]?.path, 'a.ts');
      assert.strictEqual(result.anchors[1]?.path, 'b.ts');
    });

    it('splits an anchor line on the last space, tolerating spaces in the path', () => {
      const result = parseSpanFile('dir with spaces/file.txt#L1-L5 sha256:abc\n\nWhy.');
      assert.ok(result);
      assert.strictEqual(result.anchors[0]?.path, 'dir with spaces/file.txt');
    });

    it('splits the hash part on the first colon', () => {
      const result = parseSpanFile('a.ts sha256:abc:def\n\nWhy.');
      assert.ok(result);
      assert.strictEqual(result.anchors[0]?.algorithm, 'sha256');
      assert.strictEqual(result.anchors[0]?.contentHash, 'abc:def');
    });

    it('returns null for a bare # without a following L', () => {
      const result = parseSpanFile('file.ts#88 sha256:abc\n\nWhy.');
      assert.strictEqual(result, null);
    });

    it('returns null when #L is missing the -L range separator', () => {
      const result = parseSpanFile('file.ts#L10 sha256:abc\n\nWhy.');
      assert.strictEqual(result, null);
    });

    it('returns null when start line is 0', () => {
      const result = parseSpanFile('file.ts#L0-L5 sha256:abc\n\nWhy.');
      assert.strictEqual(result, null);
    });

    it('returns null when end line is before start line', () => {
      const result = parseSpanFile('file.ts#L10-L5 sha256:abc\n\nWhy.');
      assert.strictEqual(result, null);
    });

    it('returns null when an anchor line has no space (missing hash)', () => {
      const result = parseSpanFile('file.ts\n\nWhy.');
      assert.strictEqual(result, null);
    });

    it('returns null when the hash part has no colon', () => {
      const result = parseSpanFile('file.ts sha256abc\n\nWhy.');
      assert.strictEqual(result, null);
    });

    it('rejects text containing Git conflict markers anywhere', () => {
      const result = parseSpanFile('a.ts sha256:abc\n\n<<<<<<< HEAD\nsome why\n=======\nother\n>>>>>>> branch\n');
      assert.strictEqual(result, null);
    });

    it('does not over-match a longer run of `=` (markdown setext heading) in why prose', () => {
      const result = parseSpanFile('a.ts sha256:abc\n\nHeading\n==========\nMore why text.');
      assert.ok(result);
      assert.match(result.why, /Heading/);
    });

    it('canonicalizes CRLF to LF before parsing', () => {
      const lf = parseSpanFile('a.ts sha256:abc\n\nWhy prose.');
      const crlf = parseSpanFile('a.ts sha256:abc\r\n\r\nWhy prose.');
      assert.deepStrictEqual(crlf, lf);
    });

    it('treats an anchor-block-only file (no blank line) as all anchors, empty why', () => {
      const result = parseSpanFile('a.ts sha256:abc');
      assert.ok(result);
      assert.strictEqual(result.why, '');
      assert.strictEqual(result.anchors.length, 1);
    });

    it('treats a leading-newline file as an empty anchor block with why text', () => {
      const result = parseSpanFile('\nJust why text, no anchors.');
      assert.ok(result);
      assert.strictEqual(result.anchors.length, 0);
      assert.strictEqual(result.why, 'Just why text, no anchors.');
    });

    it('returns null for non-span content with no anchor lines at all', () => {
      const result = parseSpanFile('2026-07-23 12:00:00 some log line\nanother log line\n');
      assert.strictEqual(result, null);
    });
  });

  describe('formatAnchorAddress', () => {
    it('formats a whole-file anchor as a bare path', () => {
      assert.strictEqual(formatAnchorAddress('src/foo.ts', null), 'src/foo.ts');
    });

    it('formats a line-range anchor as path#Lstart-Lend', () => {
      assert.strictEqual(formatAnchorAddress('src/foo.ts', { start: 10, end: 20 }), 'src/foo.ts#L10-L20');
    });
  });
});
