/**
 * Tests for `git span history --format json` stdout validation and mapping.
 *
 * @summary History client tests.
 * @module test/suite/spanViewer/historyClient.test
 */

import * as assert from 'node:assert';
import { HistoryFormatError, parseHistoryJson } from '../../../src/spanViewer/historyClient.js';

describe('historyClient', () => {
  describe('parseHistoryJson', () => {
    it('maps a well-formed schema_version 2 document into camelCase', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [
          {
            hash: 'abc123',
            date: '2026-01-01T00:00:00-04:00',
            summary: 'Add checkout anchor',
            anchors: [{ path: 'web/checkout.tsx#L1-L5', content: 'hello' }]
          }
        ]
      });
      const doc = parseHistoryJson(stdout);
      assert.strictEqual(doc.schemaVersion, 2);
      assert.strictEqual(doc.span, 'web/checkout.tsx');
      assert.strictEqual(doc.commits.length, 1);
      assert.strictEqual(doc.commits[0]?.hash, 'abc123');
      assert.strictEqual(doc.commits[0]?.summary, 'Add checkout anchor');
      assert.strictEqual(doc.commits[0]?.anchors[0]?.path, 'web/checkout.tsx#L1-L5');
      assert.strictEqual(doc.commits[0]?.anchors[0]?.content, 'hello');
      assert.strictEqual('event' in doc.commits[0]!.anchors[0]!, false);
      assert.strictEqual('why' in doc.commits[0]!, false);
      assert.strictEqual(doc.current, undefined);
    });

    it('leaves content undefined for a diff-bearing TimelineAnchor (no event, no removal status)', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [
          {
            hash: 'abc123',
            date: '2026-01-01T00:00:00-04:00',
            summary: 'Edit anchor content',
            anchors: [
              {
                path: 'web/checkout.tsx#L1-L5',
                diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\n@@ -1,3 +1,3 @@\n hello\n-hi\n+hey\n'
              }
            ]
          }
        ]
      });
      const doc = parseHistoryJson(stdout);
      assert.strictEqual(doc.commits[0]?.anchors[0]?.content, undefined);
      assert.strictEqual('content' in doc.commits[0]!.anchors[0]!, false);
      assert.strictEqual('event' in doc.commits[0]!.anchors[0]!, false);
    });

    it('maps a timeline anchor with unavailable and a rebound block with from/to', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [
          {
            hash: 'abc123',
            date: '2026-01-01T00:00:00-04:00',
            summary: 'Rebind and lose an anchor',
            anchors: [
              {
                path: 'web/checkout.tsx#L1-L5',
                diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\nrebound anchor\nindex rk64:aaaa..rk64:bbbb\n',
                rebound: { from: 'rk64:aaaa', to: 'rk64:bbbb' }
              },
              {
                path: 'web/checkout.tsx#L7-L9',
                diff: 'diff --git a/web/checkout.tsx#L7-L9 b/web/checkout.tsx#L7-L9\ncontent unavailable absent\n',
                unavailable: 'absent'
              }
            ]
          }
        ]
      });
      const doc = parseHistoryJson(stdout);
      const first = doc.commits[0]?.anchors[0];
      const second = doc.commits[0]?.anchors[1];
      assert.strictEqual(first?.rebound?.from, 'rk64:aaaa');
      assert.strictEqual(first?.rebound?.to, 'rk64:bbbb');
      assert.strictEqual(first?.unavailable, undefined);
      assert.strictEqual(second?.unavailable, 'absent');
      assert.strictEqual(second?.rebound, undefined);
    });

    it('maps a present current block as {anchors: CurrentAnchor[]} with diff always present', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          span_diff: 'diff --git a/.span/web/checkout.tsx b/.span/web/checkout.tsx\n@@ -1 +1 @@\n',
          anchors: [
            {
              path: 'web/checkout.tsx#L1-L5',
              diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\n@@ -1,3 +1,3 @@\n',
              content: 'live content',
              sources: ['WORKTREE']
            }
          ]
        }
      });
      const doc = parseHistoryJson(stdout);
      assert.ok(doc.current);
      assert.strictEqual(
        doc.current.span_diff,
        'diff --git a/.span/web/checkout.tsx b/.span/web/checkout.tsx\n@@ -1 +1 @@\n'
      );
      assert.strictEqual(doc.current.anchors.length, 1);
      assert.strictEqual(doc.current.anchors[0]?.path, 'web/checkout.tsx#L1-L5');
      assert.strictEqual(doc.current.anchors[0]?.content, 'live content');
      assert.deepStrictEqual(doc.current.anchors[0]?.sources, ['WORKTREE']);
    });

    it('parses a current.anchors[] entry with no content key when unavailable is present', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          anchors: [
            {
              path: 'web/checkout.tsx#L1-L5',
              diff: 'diff --git a/web/checkout.tsx#L1-L5 b/web/checkout.tsx#L1-L5\ncontent unavailable binary\n',
              unavailable: 'binary'
            }
          ]
        }
      });
      const doc = parseHistoryJson(stdout);
      assert.ok(doc.current);
      assert.strictEqual(doc.current.anchors[0]?.unavailable, 'binary');
      assert.strictEqual(doc.current.anchors[0]?.content, undefined);
      assert.strictEqual('content' in doc.current.anchors[0]!, false);
    });

    it('maps scoped and commit-level span_diff when present', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        scoped: true,
        span: 'web/checkout.tsx',
        commits: [
          {
            hash: 'abc123',
            date: '2026-01-01T00:00:00-04:00',
            summary: 'Re-hash anchors',
            span_diff: 'diff --git a/.span/web/checkout.tsx b/.span/web/checkout.tsx\n@@ -1,7 +1,7 @@\n',
            anchors: []
          }
        ]
      });
      const doc = parseHistoryJson(stdout);
      assert.strictEqual(doc.scoped, true);
      assert.ok(doc.commits[0]?.span_diff?.startsWith('diff --git a/.span/web/checkout.tsx'));
    });

    it('throws HistoryFormatError when a current.anchors[] "content" is present but not a string', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', diff: 'd', content: 42 }]
        }
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError when a timeline anchor carries both content and diff', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [
          {
            hash: 'abc123',
            date: '2026-01-01T00:00:00-04:00',
            summary: 'Bad anchor',
            anchors: [{ path: 'web/checkout.tsx#L1-L5', content: 'hello', diff: 'diff --git a b\n@@ -1 +1 @@\n' }]
          }
        ]
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError when a timeline anchor carries neither content nor diff', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [
          {
            hash: 'abc123',
            date: '2026-01-01T00:00:00-04:00',
            summary: 'Bad anchor',
            anchors: [{ path: 'web/checkout.tsx#L1-L5' }]
          }
        ]
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError when timeline unavailable co-occurs with content', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [
          {
            hash: 'abc123',
            date: '2026-01-01T00:00:00-04:00',
            summary: 'Bad anchor',
            anchors: [{ path: 'web/checkout.tsx#L1-L5', content: 'hello', unavailable: 'absent' }]
          }
        ]
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError for an unknown timeline unavailable value', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [
          {
            hash: 'abc123',
            date: '2026-01-01T00:00:00-04:00',
            summary: 'Bad anchor',
            anchors: [{ path: 'web/checkout.tsx#L1-L5', diff: 'd', unavailable: 'filter-failed' }]
          }
        ]
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError for a malformed rebound block', () => {
      for (const rebound of [{ from: 'rk64:aaaa' }, { to: 'rk64:bbbb' }, { from: 42, to: 'rk64:bbbb' }, 'nope']) {
        const stdout = JSON.stringify({
          schema_version: 2,
          span: 'web/checkout.tsx',
          commits: [
            {
              hash: 'abc123',
              date: '2026-01-01T00:00:00-04:00',
              summary: 'Bad anchor',
              anchors: [{ path: 'web/checkout.tsx#L1-L5', diff: 'd', rebound }]
            }
          ]
        });
        assert.throws(() => parseHistoryJson(stdout), HistoryFormatError, JSON.stringify(rebound));
      }
    });

    it('throws HistoryFormatError when a current.anchors[] entry lacks diff', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', content: 'hello' }]
        }
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError when a current anchor carries both content and unavailable', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', diff: 'd', content: 'hello', unavailable: 'absent' }]
        }
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError when a current anchor carries neither content nor unavailable', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', diff: 'd' }]
        }
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError for an unknown current unavailable value', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', diff: 'd', unavailable: 'nope' }]
        }
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError for a recorded value other than "unrecoverable"', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', diff: 'd', content: 'hello', recorded: 'recoverable' }]
        }
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError for an empty sources array (never emitted as [])', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', diff: 'd', content: 'hello', sources: [] }]
        }
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError for an unknown sources entry', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', diff: 'd', content: 'hello', sources: ['HEAD', 'NOPE'] }]
        }
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError when sources is not an array', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', diff: 'd', content: 'hello', sources: 'WORKTREE' }]
        }
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError for a non-boolean scoped', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        scoped: 'yes',
        span: 'web/checkout.tsx',
        commits: []
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError for a non-string span_diff', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [{ hash: 'abc123', date: '2026-01-01T00:00:00-04:00', summary: 'x', span_diff: 42, anchors: [] }]
      });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('never maps a per-commit why', () => {
      const stdout = JSON.stringify({
        schema_version: 2,
        span: 'web/checkout.tsx',
        commits: [
          { hash: 'abc123', date: '2026-01-01T00:00:00-04:00', summary: 'No why', why: 'drift v1 key', anchors: [] }
        ]
      });
      const doc = parseHistoryJson(stdout);
      assert.strictEqual('why' in doc.commits[0]!, false);
    });

    it('throws HistoryFormatError when schema_version is 1 (no v1 fallback)', () => {
      const stdout = JSON.stringify({ schema_version: 1, span: 'x', commits: [] });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError when schema_version is missing', () => {
      const stdout = JSON.stringify({ span: 'x', commits: [] });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError when commits is missing or not an array', () => {
      for (const commits of [undefined, 'nope', {}]) {
        const stdout = JSON.stringify({ schema_version: 2, span: 'x', commits });
        assert.throws(() => parseHistoryJson(stdout), HistoryFormatError, JSON.stringify(commits));
      }
    });

    it('throws HistoryFormatError on unparseable (non-JSON) stdout', () => {
      assert.throws(() => parseHistoryJson('not json at all'), HistoryFormatError);
    });

    it('throws HistoryFormatError on empty stdout', () => {
      assert.throws(() => parseHistoryJson(''), HistoryFormatError);
    });
  });
});
