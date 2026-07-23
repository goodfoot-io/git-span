/**
 * Tests for src/scoring.ts — the shared log-odds evidence combiner.
 */

import { describe, expect, it } from 'vitest';
import { scoreEvidence } from '../src/scoring.js';
import type { DisqualifierEvidence, SignalEvidence } from '../src/types.js';

function signal(name: string, strength: number): SignalEvidence {
  return { signal: name, strength };
}

describe('scoreEvidence', () => {
  it('returns a probability in (0, 1)', () => {
    const score = scoreEvidence([signal('association-rules', 0.9)]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('scores no evidence at the 0.5 neutral point', () => {
    expect(scoreEvidence([])).toBeCloseTo(0.5, 10);
  });

  it('is monotonic — stronger / more positive signals raise the score', () => {
    const weak = scoreEvidence([signal('association-rules', 0.4)]);
    const strong = scoreEvidence([signal('association-rules', 0.95)]);
    expect(strong).toBeGreaterThan(weak);

    const one = scoreEvidence([signal('association-rules', 0.8)]);
    const two = scoreEvidence([signal('association-rules', 0.8), signal('time-window-co-edit', 0.8)]);
    expect(two).toBeGreaterThan(one);
  });

  it('never returns ±Infinity or NaN even at strength exactly 0 and exactly 1 (design decision 7 clamp)', () => {
    const atOne = scoreEvidence([signal('association-rules', 1)]);
    const atZero = scoreEvidence([signal('association-rules', 0)]);
    expect(Number.isFinite(atOne)).toBe(true);
    expect(Number.isFinite(atZero)).toBe(true);
    expect(atOne).toBeLessThan(1);
    expect(atZero).toBeGreaterThan(0);
  });

  it('lowers the score when a disqualifier fires', () => {
    const signals = [signal('association-rules', 0.9)];
    const withoutDisqualifier = scoreEvidence(signals);
    const withDisqualifier = scoreEvidence(signals, [{ disqualifier: 'tree-sitter-reference', strength: 0.9 }]);
    expect(withDisqualifier).toBeLessThan(withoutDisqualifier);
  });

  it('treats a no-match (strength 0) disqualifier as neutral, not a boost', () => {
    const signals = [signal('association-rules', 0.9)];
    const base = scoreEvidence(signals);
    const withNoMatch = scoreEvidence(signals, [{ disqualifier: 'raw-path-inclusion', strength: 0 }]);
    expect(withNoMatch).toBeCloseTo(base, 10);
  });

  it('ignores an inconclusive disqualifier entirely (design decision 6)', () => {
    const signals = [signal('association-rules', 0.9)];
    const base = scoreEvidence(signals);
    const inconclusive: DisqualifierEvidence = {
      disqualifier: 'tree-sitter-reference',
      strength: 1,
      inconclusive: true
    };
    expect(scoreEvidence(signals, [inconclusive])).toBeCloseTo(base, 10);
  });
});
