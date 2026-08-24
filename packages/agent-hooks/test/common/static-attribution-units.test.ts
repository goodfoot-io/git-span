import { describe, expect, it } from 'vitest';
import { resolveNumericSed, resolvePatternSubstitution } from '../../src/common/static-attribution.js';

type SpanView = { span: Record<string, unknown> };
function spanOf(match: unknown): Record<string, unknown> {
  return (match as SpanView).span;
}
function numericMatch(script: string): RegExpMatchArray {
  return script.match(/^(\d+)(?:,(\d+))?s\W/) as RegExpMatchArray;
}

/** A PatternCommand-shaped literal; the interface itself is module-private. */
function patternCommand(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    kind: 'sed',
    script: 's/beta/BETA/',
    files: ['a.txt'],
    simpleCommandIndex: 0,
    ...overrides
  };
}

const OPTIONS = {
  cwd: '/repo',
  readPreState: (path: string) => (path.endsWith('missing.txt') ? null : 'alpha\nbeta\nbeta\nomega\n')
};

function lastDetail(unresolved: readonly { detail?: string }[]): string {
  return unresolved[unresolved.length - 1]?.detail ?? '';
}

describe('resolvePatternSubstitution', () => {
  it('resolves one modify range per literal occurrence and requests match-locations', () => {
    const result = resolvePatternSubstitution(patternCommand({ files: ['a.txt'] }) as never, OPTIONS, '/repo', 32);
    expect(result.unresolved).toEqual([]);
    expect(result.resolved).toHaveLength(2);
    const span = spanOf(result.resolved[0]);
    expect(span.operation).toBe('modify');
    expect(span.absolutePath).toBe('/repo/a.txt');
    expect([span.lineStart, span.lineEnd]).toEqual([2, 2]);
    expect([spanOf(result.resolved[1]).lineStart, spanOf(result.resolved[1]).lineEnd]).toEqual([3, 3]);
    expect(span.expectedContent).toBe('alpha\nBETA\nBETA\nomega\n');
    expect(result.preStateRequests).toEqual([
      { absolutePath: '/repo/a.txt', operation: 'modify', requirement: 'match-locations', simpleCommandIndex: 0 }
    ]);
  });

  it('emits a create-overwrite span for a backup suffix', () => {
    const result = resolvePatternSubstitution(patternCommand({ backupSuffix: '.bak' }) as never, OPTIONS, '/repo', 32);
    const spans = result.resolved.map((match) => spanOf(match));
    expect(spans).toHaveLength(3);
    expect(spans[2].operation).toBe('create-overwrite');
    expect(spans[2].absolutePath).toBe('/repo/a.txt.bak');
  });

  it('adds a deleted-text requirement for perl-zero', () => {
    const result = resolvePatternSubstitution(patternCommand({ kind: 'perl-zero' }) as never, OPTIONS, '/repo', 32);
    expect(result.preStateRequests.map((request) => request.requirement)).toEqual(['match-locations', 'deleted-text']);
    const spans = result.resolved.map((match) => spanOf(match));
    expect([spans[0].lineStart, spans[0].lineEnd]).toEqual([2, 2]);
  });

  it('collapses perl ranges to first-through-last and keeps perl-zero non-global to the first', () => {
    const perl = resolvePatternSubstitution(patternCommand({ kind: 'perl' }) as never, OPTIONS, '/repo', 32);
    const perlSpan = spanOf(perl.resolved[0]);
    expect([perlSpan.lineStart, perlSpan.lineEnd]).toEqual([2, 3]);

    const zero = resolvePatternSubstitution(patternCommand({ kind: 'perl-zero' }) as never, OPTIONS, '/repo', 32);
    expect(zero.resolved).toHaveLength(1);
  });

  it('restricts substitution to lines matched by a literal sed address', () => {
    const result = resolvePatternSubstitution(
      patternCommand({ script: '/beta/s/beta/BETA/' }) as never,
      OPTIONS,
      '/repo',
      32
    );
    const spans = result.resolved.map((match) => spanOf(match));
    expect(spans).toHaveLength(2);
    expect([spans[0].lineStart, spans[0].lineEnd]).toEqual([2, 2]);
    expect([spans[1].lineStart, spans[1].lineEnd]).toEqual([3, 3]);
  });

  it('rejects a sed script whose leading address is not a literal', () => {
    const result = resolvePatternSubstitution(
      patternCommand({ script: '//s/beta/BETA/' }) as never,
      OPTIONS,
      '/repo',
      32
    );
    expect(result.resolved).toEqual([]);
    expect(result.unresolved[0].reasonCode).toBe('unsupported-expression');
    expect(lastDetail(result.unresolved)).toBe('sed address is not a literal pattern');
    expect(result.preStateRequests).toEqual([]);
  });

  it('rejects newline-count-changing substitutions', () => {
    const result = resolvePatternSubstitution(
      patternCommand({ script: 's/beta/BETA\\nX/' }) as never,
      OPTIONS,
      '/repo',
      32
    );
    expect(result.unresolved[0].reasonCode).toBe('unsupported-expression');
    expect(lastDetail(result.unresolved)).toBe('only literal line-count-preserving substitutions are supported');
  });

  it('rejects a command with no literal file operand', () => {
    const result = resolvePatternSubstitution(patternCommand({ files: [] }) as never, OPTIONS, '/repo', 32);
    expect(result.unresolved[0].reasonCode).toBe('unsupported-syntax');
    expect(lastDetail(result.unresolved)).toBe('in-place substitution has no literal file operand');
  });

  it('reports dynamic file operands and keeps scanning the remaining files', () => {
    const result = resolvePatternSubstitution(
      patternCommand({ files: ['$DYN.txt', 'a.txt'] }) as never,
      OPTIONS,
      '/repo',
      32
    );
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reasonCode).toBe('dynamic-path');
    expect(result.unresolved[0].fileArg).toBe('$DYN.txt');
  });

  it('reports missing pre-state and binary content per file without resolving them', () => {
    const missing = resolvePatternSubstitution(
      patternCommand({ files: ['missing.txt'] }) as never,
      { cwd: '/repo' },
      '/repo',
      32
    );
    expect(missing.unresolved[0].reasonCode).toBe('missing-pre-state');

    const nul = resolvePatternSubstitution(
      patternCommand() as never,
      { cwd: '/repo', readPreState: () => 'alpha\nbe\0ta\n' },
      '/repo',
      32
    );
    expect(nul.unresolved[0].reasonCode).toBe('binary-content');
  });

  it('keeps accumulated preStateRequests when any file resolves unsuccessfully, unlike the numeric tail', () => {
    const result = resolvePatternSubstitution(
      patternCommand({ files: ['$DYN.txt', 'a.txt'] }) as never,
      OPTIONS,
      '/repo',
      32
    );
    expect(result.unresolved).toHaveLength(1);
    expect(result.preStateRequests).toHaveLength(1);
    expect(result.preStateRequests[0].requirement).toBe('match-locations');
  });

  it('rejects over-budget resolution with the substitution count noun', () => {
    const result = resolvePatternSubstitution(patternCommand({ files: ['a.txt'] }) as never, OPTIONS, '/repo', 1);
    expect(result.resolved).toEqual([]);
    expect(result.unresolved[0].reasonCode).toBe('candidate-budget-exceeded');
    expect(lastDetail(result.unresolved)).toBe('substitution produced 2 candidates; the limit is 1');
    expect(result.preStateRequests).toEqual([]);
  });
});

describe('resolveNumericSed', () => {
  const OPTIONS = {
    cwd: '/repo',
    readPreState: (path: string) => (path.endsWith('missing.txt') ? null : 'alpha\nbeta\ngamma\ndelta\n')
  };

  it('resolves one modify span over the addressed range with expected post-state content', () => {
    const result = resolveNumericSed(
      patternCommand({ script: '2,3s/gamma/GAMMA/' }) as never,
      numericMatch('2,3s/gamma/GAMMA/'),
      OPTIONS,
      '/repo',
      32
    );
    expect(result.unresolved).toEqual([]);
    expect(result.resolved).toHaveLength(1);
    const span = spanOf(result.resolved[0]);
    expect(span.operation).toBe('modify');
    expect(span.absolutePath).toBe('/repo/a.txt');
    expect([span.lineStart, span.lineEnd]).toEqual([2, 3]);
    expect(span.expectedContent).toBe('alpha\nbeta\nGAMMA\ndelta\n');
    expect(result.preStateRequests).toEqual([
      { absolutePath: '/repo/a.txt', operation: 'modify', requirement: 'match-locations', simpleCommandIndex: 0 }
    ]);
  });

  it('rejects a command with no file operand before reading any pre-state', () => {
    const result = resolveNumericSed(
      patternCommand({ files: [] }) as never,
      numericMatch('3s/beta/BETA/'),
      OPTIONS,
      '/repo',
      32
    );
    expect(result.resolved).toEqual([]);
    expect(result.unresolved[0].reasonCode).toBe('unsupported-syntax');
    expect(lastDetail(result.unresolved)).toBe('numeric in-place substitution has no file operand');
    expect(result.unresolved[0].layer).toBe('shell');
  });

  it('rejects a non-literal substitution expression for post-state verification', () => {
    const result = resolveNumericSed(
      patternCommand({ script: '3s/[a+]/x/' }) as never,
      numericMatch('3s/[a+]/x/'),
      OPTIONS,
      '/repo',
      32
    );
    expect(result.resolved).toEqual([]);
    expect(result.unresolved[0].reasonCode).toBe('unsupported-expression');
    expect(lastDetail(result.unresolved)).toBe(
      'numeric substitutions require a literal pattern and replacement for post-state verification'
    );
  });

  it('resolves without expected content — and without a match-locations request — when pre-state is unreadable or binary', () => {
    for (const options of [
      { cwd: '/repo', readPreState: () => null },
      { cwd: '/repo', readPreState: () => 'a\0b\n' }
    ]) {
      const result = resolveNumericSed(
        patternCommand({ script: '3s/beta/BETA/' }) as never,
        numericMatch('3s/beta/BETA/'),
        options,
        '/repo',
        32
      );
      expect(result.unresolved).toEqual([]);
      const span = spanOf(result.resolved[0]);
      expect(span.expectedContent).toBeUndefined();
      expect(result.preStateRequests).toEqual([]);
    }
  });

  it('emits a create-overwrite backup span per file', () => {
    const result = resolveNumericSed(
      patternCommand({ script: '3s/beta/BETA/', files: ['a.txt', 'missing.txt'], backupSuffix: '.bak' }) as never,
      numericMatch('3s/beta/BETA/'),
      OPTIONS,
      '/repo',
      32
    );
    const spans = result.resolved.map((match) => spanOf(match));
    expect(spans.filter((span) => span.operation === 'create-overwrite').map((span) => span.absolutePath)).toEqual([
      '/repo/a.txt.bak',
      '/repo/missing.txt.bak'
    ]);
  });

  it('reports dynamic operands on the shell layer and empties preStateRequests when unresolved remain', () => {
    const result = resolveNumericSed(
      patternCommand({ script: '3s/beta/BETA/', files: ['$DYN.txt', 'a.txt'] }) as never,
      numericMatch('3s/beta/BETA/'),
      OPTIONS,
      '/repo',
      32
    );
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].layer).toBe('shell');
    expect(result.unresolved[0].idiom).toBe('sed-inplace');
    expect(result.unresolved[0].fileArg).toBe('$DYN.txt');
    expect(result.preStateRequests).toEqual([]);
  });

  it('rejects over-budget resolution with the numeric-substitution count noun', () => {
    const result = resolveNumericSed(
      patternCommand({ script: '3s/beta/BETA/', files: ['a.txt'] }) as never,
      numericMatch('3s/beta/BETA/'),
      OPTIONS,
      '/repo',
      0
    );
    expect(result.resolved).toEqual([]);
    expect(lastDetail(result.unresolved)).toBe('numeric substitution produced 1 candidates; the limit is 0');
  });
});
