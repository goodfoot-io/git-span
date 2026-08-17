import { describe, expect, it } from 'vitest';
import {
  type AgenticAuditResult,
  type AgenticReport,
  type EvaluationOptions,
  evaluateAgenticReport
} from '~/gate/evaluate';

/**
 * Acceptance checks for the pure Agentic Browsing evaluator, ported from
 * `notes/reference-port-contracts.md`. The calibration case — a `numeric`
 * scoreDisplayMode audit below 1.0 must NOT fail — is the most important
 * test here (the `6a96369` lesson): a healthy-but-fractional CLS score
 * contributes only through the category threshold, never as a binary
 * per-audit failure.
 */

const OPTIONS: EvaluationOptions = {
  threshold: 0.9,
  lighthouseVersion: '13.4.1',
  minimumChromeMajor: 150
};

function audit(id: string, score: number | null, mode: string): AgenticAuditResult {
  return { id, title: id, score, scoreDisplayMode: mode };
}

function report(overrides: Partial<AgenticReport> = {}): AgenticReport {
  return {
    target: 'https://example.com/',
    lighthouseVersion: '13.4.1',
    chromeMajor: 150,
    categoryScore: 1,
    categoryScoreDisplayMode: 'fraction',
    audits: [
      audit('agent-accessibility-tree', 1, 'binary'),
      audit('webmcp-form-coverage', 1, 'binary'),
      audit('webmcp-registered-tools', 1, 'binary'),
      audit('webmcp-schema-validity', 1, 'binary'),
      audit('cumulative-layout-shift', 1, 'numeric'),
      audit('llms-txt', 1, 'binary')
    ],
    ...overrides
  };
}

describe('evaluateAgenticReport', () => {
  it('passes on a healthy report', () => {
    const evaluation = evaluateAgenticReport(report(), OPTIONS);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.failures).toEqual([]);
  });

  it('fails when the Lighthouse version does not match the pin', () => {
    const evaluation = evaluateAgenticReport(report({ lighthouseVersion: '12.0.0' }), OPTIONS);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures).toContain('Lighthouse version 12.0.0 does not match pinned 13.4.1');
  });

  it('fails when Chrome is below the required floor', () => {
    const evaluation = evaluateAgenticReport(report({ chromeMajor: 149 }), OPTIONS);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures).toContain('Chrome 149 is below required Chrome 150');
  });

  it('fails when the category display mode is not fraction', () => {
    const evaluation = evaluateAgenticReport(report({ categoryScoreDisplayMode: 'numeric' }), OPTIONS);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures).toContain('category display mode numeric is not fraction');
  });

  it('fails when the category score is null', () => {
    const evaluation = evaluateAgenticReport(report({ categoryScore: null }), OPTIONS);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures).toContain('category score is unavailable');
  });

  it('fails when the category score is below the threshold', () => {
    const evaluation = evaluateAgenticReport(report({ categoryScore: 0.5 }), OPTIONS);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures).toContain('category score 0.500 is below threshold 0.900');
  });

  it('fails when a required audit ID is missing', () => {
    const withMissing = report();
    withMissing.audits = withMissing.audits.filter((a) => a.id !== 'llms-txt');
    const evaluation = evaluateAgenticReport(withMissing, OPTIONS);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures).toContain('missing audit: llms-txt');
  });

  it('fails when an unexpected extra audit ID is present', () => {
    const withExtra = report();
    withExtra.audits = [...withExtra.audits, audit('unexpected-audit', 1, 'binary')];
    const evaluation = evaluateAgenticReport(withExtra, OPTIONS);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures).toContain('unexpected audit: unexpected-audit');
  });

  it('does not fail a numeric scoreDisplayMode audit scored below 1.0 (calibration case)', () => {
    const withFractionalCls = report();
    withFractionalCls.audits = withFractionalCls.audits.map((a) =>
      a.id === 'cumulative-layout-shift' ? audit('cumulative-layout-shift', 0.42, 'numeric') : a
    );
    const evaluation = evaluateAgenticReport(withFractionalCls, OPTIONS);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.failures).toEqual([]);
  });

  it('fails when a required audit is notApplicable', () => {
    const withNotApplicable = report();
    withNotApplicable.audits = withNotApplicable.audits.map((a) =>
      a.id === 'llms-txt' ? audit('llms-txt', null, 'notApplicable') : a
    );
    const evaluation = evaluateAgenticReport(withNotApplicable, OPTIONS);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures).toContain('llms-txt is unexpectedly not applicable');
  });

  it('labels a low-scoring numeric audit distinctly from a passing binary audit', () => {
    const withFractionalCls = report();
    withFractionalCls.audits = withFractionalCls.audits.map((a) =>
      a.id === 'cumulative-layout-shift' ? audit('cumulative-layout-shift', 0.54, 'numeric') : a
    );
    const evaluation = evaluateAgenticReport(withFractionalCls, OPTIONS);
    expect(evaluation.output).toContain('cumulative-layout-shift — cumulative-layout-shift: SCORED (LOW) (0.540)');
    expect(evaluation.output).not.toContain('cumulative-layout-shift: PASS');
  });

  it('labels a healthy numeric audit as SCORED rather than PASS', () => {
    const evaluation = evaluateAgenticReport(report(), OPTIONS);
    expect(evaluation.output).toContain('cumulative-layout-shift — cumulative-layout-shift: SCORED (1.000)');
    expect(evaluation.output).toContain('llms-txt — llms-txt: PASS (1.000)');
  });

  it('names the dragging numeric audit in the category-score failure', () => {
    const dragged = report({ categoryScore: 0.5 });
    dragged.audits = dragged.audits.map((a) =>
      a.id === 'cumulative-layout-shift' ? audit('cumulative-layout-shift', 0.54, 'numeric') : a
    );
    const evaluation = evaluateAgenticReport(dragged, OPTIONS);
    expect(evaluation.failures).toContain(
      'category score 0.500 is below threshold 0.900 — pulled down by cumulative-layout-shift (0.540)'
    );
  });

  it('does not fail a non-required audit that is notApplicable', () => {
    const withNotApplicable = report();
    withNotApplicable.audits = withNotApplicable.audits.map((a) =>
      a.id === 'webmcp-form-coverage' ? audit('webmcp-form-coverage', null, 'notApplicable') : a
    );
    const evaluation = evaluateAgenticReport(withNotApplicable, OPTIONS);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.failures).toEqual([]);
  });
});
