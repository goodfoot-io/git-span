/**
 * Tests for src/output.ts — JSON + markdown rendering and anchor formatting.
 */

import { describe, expect, it } from 'vitest';
import { type DiscoveredGroup, formatAnchor, toJson, toMarkdown } from '../src/output.js';

const sample: DiscoveredGroup[] = [
  {
    anchors: [{ path: 'a.ts', startLine: 10, endLine: 20 }, { path: 'b.ts' }],
    score: 0.82,
    signals: [{ signal: 'association-rules', strength: 0.9, commits: ['abcdef1234', 'deadbeef99'] }],
    disqualifiers: [{ disqualifier: 'raw-path-inclusion', strength: 0 }]
  },
  {
    anchors: [{ path: 'c.ts', startLine: 1, endLine: 5 }],
    score: 0.6,
    signals: [{ signal: 'release-tag-delta', strength: 0.7, tags: ['v1.0.0'] }],
    disqualifiers: [{ disqualifier: 'tree-sitter-reference', strength: 1, inconclusive: true }]
  }
];

describe('formatAnchor', () => {
  it('renders a range anchor as path#Lstart-Lend', () => {
    expect(formatAnchor({ path: 'a.ts', startLine: 10, endLine: 20 })).toBe('a.ts#L10-L20');
  });

  it('renders a whole-file anchor as bare path', () => {
    expect(formatAnchor({ path: 'a.ts' })).toBe('a.ts');
  });
});

describe('toJson', () => {
  it('emits anchors in path#Lstart-Lend shape, ranked by descending score', () => {
    const parsed = JSON.parse(toJson(sample));
    expect(parsed.groups[0].score).toBe(0.82);
    expect(parsed.groups[0].anchors).toEqual(['a.ts#L10-L20', 'b.ts']);
    expect(parsed.groups[0].signals[0].signal).toBe('association-rules');
    expect(parsed.groups[0].signals[0].commits).toEqual(['abcdef1234', 'deadbeef99']);
    // Ranked: 0.82 before 0.6.
    expect(parsed.groups.map((g: { score: number }) => g.score)).toEqual([0.82, 0.6]);
  });
});

describe('toMarkdown', () => {
  it('lists each group with score, anchors, signals, and refs', () => {
    const md = toMarkdown(sample);
    expect(md).toContain('# Implicit dependency candidates');
    expect(md).toContain('`a.ts#L10-L20`');
    expect(md).toContain('`b.ts`');
    expect(md).toContain('association-rules');
    expect(md).toContain('Tags: v1.0.0');
    expect(md).toContain('abcdef12'); // short commit
  });

  it('renders an explicit empty-report line for no groups', () => {
    expect(toMarkdown([])).toContain('No candidate groups met the reporting threshold');
  });
});
