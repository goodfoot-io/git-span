/**
 * Tests for the `gitspan-anchor:` virtual document identity build/parse helpers.
 *
 * @summary Anchor URI tests.
 * @module test/suite/spanViewer/anchorUri.test
 */

import * as assert from 'node:assert';
import { buildAnchorUri, parseAnchorUri } from '../../../src/spanViewer/anchorUri.js';
import type { AnchorUriParams } from '../../../src/spanViewer/types.js';

describe('anchorUri', () => {
  describe('buildAnchorUri', () => {
    it('uses the anchor path (not the span path) as the path component', () => {
      const { path } = buildAnchorUri({
        spanPath: 'web/checkout.tsx',
        anchorPath: 'web/checkout.tsx',
        anchorIndex: 0,
        side: 'original'
      });
      assert.strictEqual(path, 'web/checkout.tsx');
    });

    it("uses the anchor's own real path as the visible path when it differs from the span path", () => {
      const { path } = buildAnchorUri({
        spanPath: 'git-span/history-command',
        anchorPath: 'packages/git-span/src/cli/interior_anchor.rs',
        anchorIndex: 0,
        side: 'original'
      });
      assert.strictEqual(path, 'packages/git-span/src/cli/interior_anchor.rs');
    });

    it('encodes spanPath, anchorPath, anchorIndex, and side into the query string', () => {
      const { query } = buildAnchorUri({
        spanPath: 'git-span/history-command',
        anchorPath: 'packages/git-span/src/cli/interior_anchor.rs',
        anchorIndex: 2,
        side: 'modified'
      });
      const params = new URLSearchParams(query);
      assert.strictEqual(params.get('spanPath'), 'git-span/history-command');
      assert.strictEqual(params.get('anchorPath'), 'packages/git-span/src/cli/interior_anchor.rs');
      assert.strictEqual(params.get('anchorIndex'), '2');
      assert.strictEqual(params.get('side'), 'modified');
    });
  });

  describe('parseAnchorUri', () => {
    it('round-trips build -> parse for the original side', () => {
      const original: AnchorUriParams = {
        spanPath: 'web/checkout.tsx',
        anchorPath: 'web/checkout.tsx',
        anchorIndex: 0,
        side: 'original'
      };
      const { path, query } = buildAnchorUri(original);
      assert.deepStrictEqual(parseAnchorUri(path, query), original);
    });

    it('round-trips build -> parse for the modified side', () => {
      const original: AnchorUriParams = {
        spanPath: 'src/a.ts#L1-L5',
        anchorPath: 'src/a.ts',
        anchorIndex: 3,
        side: 'modified'
      };
      const { path, query } = buildAnchorUri(original);
      assert.deepStrictEqual(parseAnchorUri(path, query), original);
    });

    it('round-trips a spanPath and anchorPath containing spaces and unicode', () => {
      const original: AnchorUriParams = {
        spanPath: 'dir with spaces/héllo.ts',
        anchorPath: 'dir with spaces/other héllo.ts',
        anchorIndex: 1,
        side: 'original'
      };
      const { path, query } = buildAnchorUri(original);
      assert.deepStrictEqual(parseAnchorUri(path, query), original);
    });

    it('parses anchorIndex back into a number, not a string', () => {
      const original: AnchorUriParams = {
        spanPath: 'a.ts',
        anchorPath: 'a.ts',
        anchorIndex: 12,
        side: 'modified'
      };
      const { path, query } = buildAnchorUri(original);
      const parsed = parseAnchorUri(path, query);
      assert.strictEqual(typeof parsed.anchorIndex, 'number');
      assert.strictEqual(parsed.anchorIndex, 12);
    });

    it('round-trips anchorPath for a real span/anchor pairing (git-span history-command)', () => {
      const original: AnchorUriParams = {
        spanPath: 'git-span/history-command',
        anchorPath: 'packages/git-span/src/cli/interior_anchor.rs',
        anchorIndex: 0,
        side: 'modified'
      };
      const { path, query } = buildAnchorUri(original);
      assert.strictEqual(path, 'packages/git-span/src/cli/interior_anchor.rs');
      assert.deepStrictEqual(parseAnchorUri(path, query), original);
    });
  });
});
