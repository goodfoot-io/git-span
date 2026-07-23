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
    it('maps a well-formed schema_version 1 document into camelCase', () => {
      const stdout = JSON.stringify({
        schema_version: 1,
        span: 'web/checkout.tsx',
        commits: [
          {
            hash: 'abc123',
            date: '2026-01-01',
            summary: 'Add checkout anchor',
            why: 'Because reasons',
            anchors: [{ path: 'web/checkout.tsx#L1-L5', event: 'added', content: 'hello' }]
          }
        ]
      });
      const doc = parseHistoryJson(stdout);
      assert.strictEqual(doc.schemaVersion, 1);
      assert.strictEqual(doc.span, 'web/checkout.tsx');
      assert.strictEqual(doc.commits.length, 1);
      assert.strictEqual(doc.commits[0]?.hash, 'abc123');
      assert.strictEqual(doc.commits[0]?.why, 'Because reasons');
      assert.strictEqual(doc.commits[0]?.anchors[0]?.event, 'added');
      assert.strictEqual(doc.commits[0]?.anchors[0]?.content, 'hello');
      assert.strictEqual(doc.current, undefined);
    });

    it('leaves content undefined for a removed TimelineAnchor', () => {
      const stdout = JSON.stringify({
        schema_version: 1,
        span: 'web/checkout.tsx',
        commits: [
          {
            hash: 'abc123',
            date: '2026-01-01',
            summary: 'Remove anchor',
            anchors: [{ path: 'web/checkout.tsx#L1-L5', event: 'removed' }]
          }
        ]
      });
      const doc = parseHistoryJson(stdout);
      assert.strictEqual(doc.commits[0]?.anchors[0]?.content, undefined);
    });

    it('maps a present current block as {anchors: CurrentAnchor[]}', () => {
      const stdout = JSON.stringify({
        schema_version: 1,
        span: 'web/checkout.tsx',
        commits: [],
        current: {
          anchors: [{ path: 'web/checkout.tsx#L1-L5', status: 'moved', content: 'live content' }]
        }
      });
      const doc = parseHistoryJson(stdout);
      assert.ok(doc.current);
      assert.strictEqual(doc.current.anchors.length, 1);
      assert.strictEqual(doc.current.anchors[0]?.status, 'moved');
      assert.strictEqual(doc.current.anchors[0]?.content, 'live content');
    });

    it('leaves commit.why undefined when the wire object omits it', () => {
      const stdout = JSON.stringify({
        schema_version: 1,
        span: 'web/checkout.tsx',
        commits: [{ hash: 'abc123', date: '2026-01-01', summary: 'No why', anchors: [] }]
      });
      const doc = parseHistoryJson(stdout);
      assert.strictEqual(doc.commits[0]?.why, undefined);
    });

    it('throws HistoryFormatError when schema_version is not 1', () => {
      const stdout = JSON.stringify({ schema_version: 2, span: 'x', commits: [] });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError when schema_version is missing', () => {
      const stdout = JSON.stringify({ span: 'x', commits: [] });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError when commits is missing', () => {
      const stdout = JSON.stringify({ schema_version: 1, span: 'x' });
      assert.throws(() => parseHistoryJson(stdout), HistoryFormatError);
    });

    it('throws HistoryFormatError on unparseable (non-JSON) stdout', () => {
      assert.throws(() => parseHistoryJson('not json at all'), HistoryFormatError);
    });

    it('throws HistoryFormatError on empty stdout', () => {
      assert.throws(() => parseHistoryJson(''), HistoryFormatError);
    });
  });
});
