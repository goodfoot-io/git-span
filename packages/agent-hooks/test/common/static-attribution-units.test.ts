import { describe, expect, it } from 'vitest';
import { splitTopLevel } from '../../src/common/shell-split.js';
import {
  createPythonContext,
  type LayeredParseOptions,
  type LayeredParseResult,
  type LayeredResolvedMatch,
  parseCompoundStages,
  parseLiteralListLoop,
  resolveNumericSed,
  resolvePatternSubstitution,
  resolvePythonWriteSink,
  type UnresolvedAttribution
} from '../../src/common/static-attribution.js';

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

describe('parseCompoundStages', () => {
  const OPTIONS: LayeredParseOptions = { cwd: '/repo' };

  function resolvedSpan(overrides: Record<string, unknown> = {}): LayeredResolvedMatch {
    return {
      status: 'resolved',
      layer: 'node',
      idiom: 'node-fs',
      span: {
        absolutePath: '/repo/x.txt',
        operation: 'modify',
        simpleCommandIndex: 0,
        ...overrides
      }
    } as unknown as LayeredResolvedMatch;
  }

  function unresolvedMatch(overrides: Partial<UnresolvedAttribution> = {}): UnresolvedAttribution {
    return {
      status: 'unresolved',
      layer: 'node',
      idiom: 'node-fs',
      reasonCode: 'dynamic-path',
      detail: 'd',
      ...overrides
    };
  }

  /** Stub stage recursor returning the same canned child result for every stage. */
  function stubParse(result: Partial<LayeredParseResult>) {
    const calls: { command: string; options: LayeredParseOptions }[] = [];
    const parse = (command: string, options: LayeredParseOptions): LayeredParseResult => {
      calls.push({ command, options });
      return { resolved: [], unresolved: [], preStateRequests: [], ...result };
    };
    return { calls, parse };
  }

  it('declines single-stage, malformed, and shell-only pipeline splits with null', () => {
    expect(
      parseCompoundStages('sed -i s/a/b/ f.txt', splitTopLevel('sed -i s/a/b/ f.txt'), OPTIONS, 32, () => ({
        resolved: [],
        unresolved: [],
        preStateRequests: []
      }))
    ).toBeNull();

    const malformed = {
      stages: [
        { text: 'a1', precededBy: 'start' },
        { text: 'b2', precededBy: 'and' }
      ],
      malformed: 'unclosed-paren'
    };
    expect(
      parseCompoundStages('a1 && b2', malformed as never, OPTIONS, 32, () => ({
        resolved: [],
        unresolved: [],
        preStateRequests: []
      }))
    ).toBeNull();

    expect(
      parseCompoundStages(
        'cat a.txt | grep beta c.txt',
        splitTopLevel('cat a.txt | grep beta c.txt'),
        OPTIONS,
        32,
        () => ({ resolved: [], unresolved: [], preStateRequests: [] })
      )
    ).toBeNull();
  });

  it('rejects a directory-changing compound outright without recursing into any stage', () => {
    const command = 'cd /tmp && sed -i s/beta/BETA/ a.txt';
    const { parse } = stubParse({});
    const result = parseCompoundStages(command, splitTopLevel(command), OPTIONS, 32, parse) as LayeredParseResult;
    expect(result).toEqual({
      resolved: [],
      unresolved: [
        {
          status: 'unresolved',
          layer: 'pattern-substitution',
          idiom: 'compound-command',
          reasonCode: 'dynamic-path',
          detail: 'a directory-changing compound cannot safely resolve substitution targets',
          fileArg: undefined,
          simpleCommandIndex: 0
        }
      ],
      preStateRequests: []
    });
  });

  it('stamps simpleCommandIndex and gating joins from the stage list onto every child candidate', () => {
    const command = 'node write.js && node mix.js || node tail.js';
    const child: Partial<LayeredParseResult> = {
      resolved: [resolvedSpan()],
      unresolved: [unresolvedMatch({ layer: 'shell', idiom: 'shell-read', reasonCode: 'dynamic-path' })],
      preStateRequests: [
        { absolutePath: '/repo/x.txt', operation: 'modify', requirement: 'match-locations', simpleCommandIndex: 99 }
      ]
    };
    const { calls, parse } = stubParse(child);
    const result = parseCompoundStages(command, splitTopLevel(command), OPTIONS, 32, parse) as LayeredParseResult;
    expect(calls.map((call) => call.command)).toEqual(['node write.js', 'node mix.js', 'node tail.js']);
    expect(spanOf(result.resolved[0]).simpleCommandIndex).toBe(0);
    expect(spanOf(result.resolved[1]).simpleCommandIndex).toBe(1);
    expect(spanOf(result.resolved[2]).simpleCommandIndex).toBe(2);
    expect([spanOf(result.resolved[0]).join, spanOf(result.resolved[1]).join, spanOf(result.resolved[2]).join]).toEqual(
      [undefined, '&&', '||']
    );
    expect(result.unresolved.map((match) => match.simpleCommandIndex)).toEqual([0, 1, 2]);
    expect(result.preStateRequests.map((request) => request.simpleCommandIndex)).toEqual([0, 1, 2]);
  });

  it('hands the caller options object unchanged to every stage — no maxCandidates injection on the compound path', () => {
    const command = 'sed -i s/beta/BETA/ a.txt && node write.js';
    const callerOptions: LayeredParseOptions = { cwd: '/repo', maxCandidates: 7 };
    const { calls, parse } = stubParse({});
    parseCompoundStages(command, splitTopLevel(command), callerOptions, 32, parse);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.options).toBe(callerOptions);
  });

  it('reconciles a pipeline in place: layered reads before writes, pipeline refusals before layered refusals', () => {
    const child: Partial<LayeredParseResult> = {
      resolved: [resolvedSpan({ operation: 'read' }), resolvedSpan()],
      unresolved: [unresolvedMatch({ layer: 'node' })]
    };
    const command = 'cat notes.txt | python3 rewrite.py';
    const result = parseCompoundStages(
      command,
      splitTopLevel(command),
      OPTIONS,
      32,
      stubParse(child).parse
    ) as LayeredParseResult;
    expect(result.resolved.map((match) => ({ layer: match.layer, operation: spanOf(match).operation }))).toEqual([
      { layer: 'node', operation: 'read' },
      { layer: 'node', operation: 'read' },
      { layer: 'node', operation: 'modify' },
      { layer: 'node', operation: 'modify' }
    ]);
    expect(result.unresolved.map((match) => match.simpleCommandIndex)).toEqual([0, 1]);

    const shellPipeline = 'cat notes.txt | sed -i s/beta/BETA/ a.txt';
    const shellResult = parseCompoundStages(
      shellPipeline,
      splitTopLevel(shellPipeline),
      OPTIONS,
      32,
      stubParse({ unresolved: [unresolvedMatch({ layer: 'node' })] }).parse
    ) as LayeredParseResult;
    expect(shellResult.unresolved[0].layer).toBe('shell');
    const lastRefusal = shellResult.unresolved[shellResult.unresolved.length - 1];
    expect(lastRefusal.layer).toBe('node');
    expect(lastRefusal.simpleCommandIndex).toBe(1);
  });

  it('rejects over-budget resolution with the compound count noun', () => {
    const command = 'node a.js && node b.js';
    const child: Partial<LayeredParseResult> = { resolved: [resolvedSpan(), resolvedSpan()] };
    const result = parseCompoundStages(
      command,
      splitTopLevel(command),
      OPTIONS,
      3,
      stubParse(child).parse
    ) as LayeredParseResult;
    expect(result.resolved).toEqual([]);
    expect(result.unresolved[0].reasonCode).toBe('candidate-budget-exceeded');
    expect(lastDetail(result.unresolved)).toBe('compound produced 4 candidates; the limit is 3');
    expect(result.preStateRequests).toEqual([]);
  });
});

describe('parseLiteralListLoop', () => {
  const OPTIONS: LayeredParseOptions = { cwd: '/repo' };

  function loopResult(
    variable: string,
    listSource: string,
    body: string,
    parse: (command: string, options: LayeredParseOptions) => LayeredParseResult,
    maxCandidates = 32,
    options: LayeredParseOptions = OPTIONS
  ): LayeredParseResult {
    return parseLiteralListLoop(variable, listSource, body, options, maxCandidates, parse);
  }

  function stubParse(result: Partial<LayeredParseResult>) {
    const calls: { command: string; options: LayeredParseOptions }[] = [];
    const parse = (command: string, options: LayeredParseOptions): LayeredParseResult => {
      calls.push({ command, options });
      return { resolved: [], unresolved: [], preStateRequests: [], ...result };
    };
    return { calls, parse };
  }

  it('declines nested bodies, dynamic lists, globs, substitutions, and untokenizable lists fail-closed', () => {
    const declines: [string, string, string, string][] = [
      ['f', 'a.txt', 'for x in y; do echo $x; done', 'nested loop bodies are not supported'],
      ['f', '$(ls)', 'sed -i s/x/y/ $f', 'loop list uses command substitution'],
      ['f', '*.txt', 'sed -i s/x/y/ $f', 'loop list uses glob expansion'],
      ['f', '${SOURCES}', 'sed -i s/x/y/ $f', 'loop list is not a literal list'],
      ['f', '', 'sed -i s/x/y/ $f', 'loop list cannot be tokenized']
    ];
    for (const [variable, listSource, body, detail] of declines) {
      const result = loopResult(variable, listSource, body, stubParse({}).parse);
      expect(result.resolved).toEqual([]);
      expect(result.unresolved[0].layer).toBe('literal-loop');
      expect(result.unresolved[0].idiom).toBe('literal-list-loop');
      expect(lastDetail(result.unresolved)).toBe(detail);
      expect(result.preStateRequests).toEqual([]);
    }
  });

  it('rejects over-budget binding lists before any expansion', () => {
    const result = loopResult('f', 'a b c d', 'sed -i s/x/y/ $f', stubParse({}).parse, 3);
    expect(lastDetail(result.unresolved)).toBe('literal list has 4 bindings; the limit is 3');
    expect(result.unresolved[0].reasonCode).toBe('candidate-budget-exceeded');
  });

  it('rejects field-splitting expansions and unused variables per binding; dynamic lists decline at list level', () => {
    const dynamicList = loopResult('f', 'a.txt $PWD.txt', 'sed -i s/x/y/ $f', stubParse({}).parse);
    expect(dynamicList.unresolved[0].reasonCode).toBe('dynamic-list');
    expect(lastDetail(dynamicList.unresolved)).toBe('loop list is not a literal list');

    const unsafe = loopResult('f', '"a b.txt"', 'sed -i s/x/y/ $f', stubParse({}).parse);
    expect(unsafe.unresolved[0].reasonCode).toBe('unsupported-dataflow');
    expect(lastDetail(unsafe.unresolved)).toBe('unquoted loop expansion would perform shell field splitting');

    const unused = loopResult('f', 'a.txt', 'sed -i s/x/y/ g.txt', stubParse({}).parse);
    expect(unused.unresolved[0].reasonCode).toBe('unsupported-dataflow');
    expect(lastDetail(unused.unresolved)).toBe('loop variable is not used in an expandable shell context');
  });

  it('rewrites layers to literal-loop, forwards expanded bodies, and refuses all-or-nothing on any refusal', () => {
    const child: Partial<LayeredParseResult> = {
      resolved: [
        {
          status: 'resolved',
          layer: 'shell',
          idiom: 'sed-inplace',
          span: { absolutePath: '/repo/a.txt', operation: 'modify', simpleCommandIndex: 0 }
        }
      ],
      unresolved: []
    };
    const { calls, parse } = stubParse(child);
    const result = loopResult('f', 'one.txt two.txt', 'sed -i s/x/y/ $f', parse);
    expect(calls.map((call) => call.command)).toEqual(["sed -i s/x/y/ 'one.txt'", "sed -i s/x/y/ 'two.txt'"]);
    expect(result.resolved).toHaveLength(2);
    expect(result.resolved.every((match) => match.layer === 'literal-loop')).toBe(true);
    expect(result.unresolved).toEqual([]);

    const mixed = loopResult(
      'f',
      'one.txt two.txt',
      'sed -i s/x/y/ $f',
      (command) =>
        ({
          resolved: [
            {
              status: 'resolved',
              layer: 'shell',
              idiom: 'sed-inplace',
              span: { absolutePath: `/repo/${command}`, operation: 'modify', simpleCommandIndex: 0 }
            }
          ],
          unresolved:
            command.includes('two.txt') && !command.includes('one.txt')
              ? [
                  {
                    status: 'unresolved',
                    layer: 'shell',
                    idiom: 'sed-inplace',
                    reasonCode: 'dynamic-path',
                    detail: 'd'
                  }
                ]
              : [],
          preStateRequests: []
        }) as unknown as LayeredParseResult
    );
    expect(mixed.resolved).toEqual([]);
    expect(mixed.preStateRequests).toEqual([]);
    expect(mixed.unresolved.map((match) => match.layer)).toEqual(['literal-loop']);
  });

  it('back-fills one match-locations request per modified file after the loop, without duplicating threaded ones', () => {
    const parse = (command: string): LayeredParseResult => {
      const firstBinding = command.includes('one');
      return {
        resolved: [
          {
            status: 'resolved',
            layer: 'pattern-substitution',
            idiom: 'substitution',
            span: {
              absolutePath: '/repo/a.txt',
              operation: 'modify',
              simpleCommandIndex: firstBinding ? 0 : 1
            }
          }
        ],
        unresolved: [],
        // Second binding already carries the request its resolved modify earned;
        // the post-loop back-fill must not add a duplicate.
        preStateRequests: firstBinding
          ? []
          : [
              {
                absolutePath: '/repo/a.txt',
                operation: 'modify',
                requirement: 'match-locations',
                simpleCommandIndex: 1
              }
            ]
      } as LayeredParseResult;
    };
    const result = loopResult('f', 'one two', 'sed -i s/x/y/ $f', parse);
    expect(result.preStateRequests).toEqual([
      { absolutePath: '/repo/a.txt', operation: 'modify', requirement: 'match-locations', simpleCommandIndex: 1 }
    ]);
    expect(result.resolved.map((match) => spanOf(match).simpleCommandIndex)).toEqual([0, 1]);
  });

  it('delivers an explicit {...options, maxCandidates} object to every recursion, machine budget winning', () => {
    const callerOptions: LayeredParseOptions = { cwd: '/repo', maxCandidates: 7 };
    const { calls, parse } = stubParse({});
    loopResult('f', 'a b', 'sed -i s/x/y/ $f', parse, 32, callerOptions);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.options).not.toBe(callerOptions);
      expect(call.options).toEqual({ cwd: '/repo', maxCandidates: 32 });
    }
  });

  it('never re-validates maxCandidates inside the machine — entry validation stays in parseCommandLayered', () => {
    expect(() => loopResult('f', 'a.txt', 'sed -i s/x/y/ $f', stubParse({}).parse, 0)).not.toThrow();
  });
});

describe('resolvePythonWriteSink', () => {
  function pythonContext(overrides: Partial<LayeredParseOptions> = {}): ReturnType<typeof createPythonContext> {
    return createPythonContext({ cwd: '/repo', ...overrides });
  }

  function sink(ctx: ReturnType<typeof createPythonContext>, expression: string, path = 'a.txt') {
    return resolvePythonWriteSink(ctx, expression, `/repo/${path}`);
  }

  it('resolves a literal overwrite as create-overwrite with identical written and expected content', () => {
    const ctx = pythonContext();
    expect(sink(ctx, "'alpha\\n'")).toBeUndefined();
    const span = spanOf(ctx.resolved[0]);
    expect(span.operation).toBe('create-overwrite');
    expect(span.written).toBe('alpha\n');
    expect(span.expectedContent).toBe('alpha\n');
  });

  it('requests only match-locations for a newline-preserving named replacement', () => {
    const ctx = pythonContext({
      readPreState: (path) => (path.endsWith('/repo/a.txt') ? 'alpha\nbeta\nbeta\n' : null)
    });
    ctx.texts.set('t', { path: 'a.txt' });
    ctx.replacements.set('r', { source: 't', pattern: 'beta', replacement: 'BETA' });
    expect(sink(ctx, 'r')).toBeUndefined();
    expect(ctx.preStateRequests.map((request) => request.requirement)).toEqual(['match-locations']);
    expect(spanOf(ctx.resolved[0]).expectedContent).toBe('alpha\nBETA\nBETA\n');
  });

  it('derives deleted-text when the replacement changes the newline count — the python-side asymmetry', () => {
    const ctx = pythonContext({
      readPreState: (path) => (path.endsWith('/repo/a.txt') ? 'alpha\nbeta\n' : null)
    });
    ctx.texts.set('t', { path: 'a.txt' });
    expect(sink(ctx, "t.replace('beta', '')")).toBeUndefined();
    expect(ctx.preStateRequests.map((request) => request.requirement)).toEqual(['match-locations', 'deleted-text']);
    expect(ctx.resolved[0].idiom).toBe('python-replace');
  });

  it('rewrites exactly the anchored occurrence via the anchor-slice shape and refuses absent anchors', () => {
    const content = 'alpha\nANCHOR\nomega\n';
    const ctx = pythonContext({ readPreState: (path) => (path.endsWith('/repo/a.txt') ? content : null) });
    ctx.texts.set('t', { path: 'a.txt' });
    ctx.anchors.set('i', { source: 't', literal: 'ANCHOR' });
    expect(sink(ctx, "t[:i] + 'NEWVAL' + t[i+6:]")).toBeUndefined();
    const sliceSpan = spanOf(ctx.resolved[0]);
    expect(ctx.resolved[0].idiom).toBe('python-anchor-slice');
    expect(sliceSpan.expectedContent).toBe('alpha\nNEWVAL\nomega\n');

    const missing = pythonContext({ readPreState: () => 'nothing here\n' });
    missing.texts.set('t', { path: 'a.txt' });
    missing.anchors.set('i', { source: 't', literal: 'ANCHOR' });
    const rejected = sink(missing, "t[:i] + 'NEWVAL' + t[i+6:]");
    expect(rejected).not.toBeNull();
    expect((rejected as LayeredParseResult).unresolved[0].reasonCode).toBe('evidence-mismatch');
  });

  it('joins edited line arrays with LF and emits one modify span per edited index', () => {
    const ctx = pythonContext({
      readPreState: (path) => (path.endsWith('/repo/a.txt') ? 'one\ntwo\nthree\n' : null)
    });
    ctx.lines.set('lines', {
      path: 'a.txt',
      edits: new Map([
        [1, 'TWO'],
        [2, 'THREE']
      ])
    });
    expect(sink(ctx, "'\\n'.join(lines) + '\\n'")).toBeUndefined();
    const spans = ctx.resolved.map((match) => spanOf(match));
    expect(spans.map((span) => span.lineStart)).toEqual([2, 3]);
    for (const span of spans) expect(span.expectedContent).toBe('one\nTWO\nTHREE\n');
    expect(ctx.preStateRequests.map((request) => request.requirement)).toEqual(['deleted-text']);
  });

  it('rejects structured dumps whose load path, format, or keys do not link', () => {
    const ctx = pythonContext({
      readPreState: (path) => (path.endsWith('/repo/a.txt') ? '"name": "old"\n' : null)
    });
    ctx.structured.set('data', { format: 'json', path: 'a.txt', keys: [['name']] });
    expect(sink(ctx, 'json.dumps(data)')).toBeUndefined();
    expect(ctx.resolved).toHaveLength(1);

    const unlinked = pythonContext({ readPreState: () => '"name": "old"\n' });
    unlinked.structured.set('data', { format: 'yaml', path: 'a.txt', keys: [] });
    const rejected = sink(unlinked, 'json.dumps(data)');
    expect(rejected).not.toBeNull();
    expect((rejected as LayeredParseResult).unresolved[0].reasonCode).toBe('unsupported-dataflow');
  });

  it('falls back to the allowlist rejection for write expressions outside every sink', () => {
    const rejected = sink(pythonContext(), "t.replace(x, 'y')");
    expect(rejected).not.toBeNull();
    expect((rejected as LayeredParseResult).unresolved[0].detail).toBe(
      'Python write expression is outside the bounded allowlist'
    );
  });
});
