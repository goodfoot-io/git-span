/**
 * Deterministic static-attribution benchmark and correctness scoreboard.
 *
 * The parser cells import the same declarative corpus as Vitest. The bundle
 * cells build and invoke the emitted Claude hooks in real Git repositories,
 * with the workspace git-span binary first on PATH. Timings include process
 * startup, repository work, touch surfacing, and rendered output.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { type LayeredParseResult, parseCommandLayered } from '../src/common/static-attribution.js';
import { STATIC_ATTRIBUTION_CORPUS } from '../test/common/fixtures/static-attribution-corpus.js';
import {
  addLineSpan,
  buildRealHookBundles,
  buildWorkspaceGitSpan,
  commitRepo,
  hookContext,
  invokeRealHook,
  makeRealBundleRepo,
  type RealBundleRepo,
  writeRepoFile
} from '../test/real-bundle-helpers.js';

interface Options {
  parserWarmups: number;
  parserSamples: number;
  bundleWarmups: number;
  bundleSamples: number;
  largeFiles: number;
  output?: string;
}

interface Distribution {
  coldMs: number;
  warmupMs: number[];
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

interface MeasuredCell extends Distribution {
  name: string;
  phase: 'parser' | 'pre' | 'post';
  repository: 'none' | 'small' | 'large';
  candidates: number;
  subprocesses: { hook: number; git: number; gitCommands: string[] };
}

interface CorpusLayerScore {
  expected: number;
  matched: number;
  recall: number;
  expectedRangeLines: number;
  attributedRangeLines: number;
  rangeBreadth: number | null;
}

const PACKAGE_ROOT =
  process.env['AGENT_HOOKS_BENCHMARK_ROOT'] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = 'alpha\nneedle one\nbeta\nneedle two\nomega\n';
const POST_TEXT = 'alpha\npin one\nbeta\npin two\nomega\n';

function positiveInteger(raw: string | undefined, flag: string): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer`);
  return value;
}

function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith('--')) throw new Error(`unexpected argument: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  const known = new Set([
    '--parser-warmups',
    '--parser-samples',
    '--bundle-warmups',
    '--bundle-samples',
    '--large-files',
    '--output'
  ]);
  for (const flag of values.keys()) if (!known.has(flag)) throw new Error(`unknown option: ${flag}`);
  return {
    parserWarmups: positiveInteger(values.get('--parser-warmups') ?? '10', '--parser-warmups'),
    parserSamples: positiveInteger(values.get('--parser-samples') ?? '80', '--parser-samples'),
    bundleWarmups: positiveInteger(values.get('--bundle-warmups') ?? '3', '--bundle-warmups'),
    bundleSamples: positiveInteger(values.get('--bundle-samples') ?? '20', '--bundle-samples'),
    largeFiles: positiveInteger(values.get('--large-files') ?? '1500', '--large-files'),
    ...(values.has('--output') ? { output: resolve(values.get('--output')!) } : {})
  };
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function quantile(samples: readonly number[], percentile: number): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(percentile * ordered.length) - 1)] ?? 0;
}

function time(action: () => void): number {
  const started = performance.now();
  action();
  return rounded(performance.now() - started);
}

function measure(action: () => void, warmups: number, sampleCount: number): Distribution {
  const coldMs = time(action);
  const warmupMs = Array.from({ length: warmups }, () => time(action));
  const samplesMs = Array.from({ length: sampleCount }, () => time(action));
  return {
    coldMs,
    warmupMs,
    samplesMs,
    p50Ms: rounded(quantile(samplesMs, 0.5)),
    p95Ms: rounded(quantile(samplesMs, 0.95)),
    p99Ms: rounded(quantile(samplesMs, 0.99))
  };
}

function fixture(name: string) {
  const found = STATIC_ATTRIBUTION_CORPUS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`static attribution corpus fixture is missing: ${name}`);
  return found;
}

function parseFixture(name: string, cwd = '/benchmark'): LayeredParseResult {
  const item = fixture(name);
  const preState = new Map(item.files.map((file) => [resolve(cwd, file.path), file.content]));
  return parseCommandLayered(item.command, {
    cwd,
    readPreState: (absolutePath) => preState.get(absolutePath) ?? null
  });
}

function canonicalResult(name: string) {
  const item = fixture(name);
  const cwd = '/benchmark';
  const tracked = new Set(item.files.filter((file) => file.tracked).map((file) => file.path));
  const result = parseFixture(name, cwd);
  return {
    result,
    actual: result.resolved
      .filter(({ span }) => tracked.has(relative(cwd, span.absolutePath)))
      .map(({ layer, span }) => ({
        layer,
        operation: span.operation,
        path: relative(cwd, span.absolutePath),
        range:
          span.lineStart === undefined || span.lineEnd === undefined
            ? undefined
            : { start: span.lineStart, end: span.lineEnd }
      })),
    expected: (item.expectedOperations ?? []).flatMap(({ operation, path, ranges }) =>
      (ranges ?? [undefined]).map((range) => ({ layer: item.layer, operation, path, range }))
    )
  };
}

function scoreCorpus(): {
  cases: number;
  layers: Record<string, CorpusLayerScore>;
  totalRecall: number;
  rangeBreadth: number;
} {
  const raw = new Map<string, Omit<CorpusLayerScore, 'recall' | 'rangeBreadth'>>();
  let expectedTotal = 0;
  let matchedTotal = 0;
  for (const item of STATIC_ATTRIBUTION_CORPUS) {
    const { result, actual, expected } = canonicalResult(item.name);
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
      throw new Error(`${item.name}: corpus mismatch\nexpected ${expectedJson}\nactual   ${actualJson}`);
    }
    const reasons = result.unresolved.map(({ reasonCode }) => reasonCode);
    const expectedReasons = item.unresolvedReason === undefined ? [] : [item.unresolvedReason];
    if (JSON.stringify(reasons) !== JSON.stringify(expectedReasons)) {
      throw new Error(`${item.name}: unresolved reasons changed (${reasons.join(', ')})`);
    }
    const requirements = [...new Set(result.preStateRequests.map(({ requirement }) => requirement))];
    const expectedRequirements =
      item.name === 'tracked and untracked pair retains only tracked eligibility'
        ? []
        : (item.preStateRequirements ?? []);
    if (JSON.stringify(requirements) !== JSON.stringify(expectedRequirements)) {
      throw new Error(`${item.name}: pre-state requirements changed (${requirements.join(', ')})`);
    }
    const score = raw.get(item.layer) ?? {
      expected: 0,
      matched: 0,
      expectedRangeLines: 0,
      attributedRangeLines: 0
    };
    score.expected += expected.length;
    score.matched += actual.length;
    for (const operation of expected) {
      if (operation.range !== undefined) score.expectedRangeLines += operation.range.end - operation.range.start + 1;
    }
    for (const operation of actual) {
      if (operation.range !== undefined) score.attributedRangeLines += operation.range.end - operation.range.start + 1;
    }
    raw.set(item.layer, score);
    expectedTotal += expected.length;
    matchedTotal += actual.length;
  }
  const expectedRangeTotal = [...raw.values()].reduce((sum, score) => sum + score.expectedRangeLines, 0);
  const attributedRangeTotal = [...raw.values()].reduce((sum, score) => sum + score.attributedRangeLines, 0);
  const layers = Object.fromEntries(
    [...raw.entries()].map(([layer, score]) => [
      layer,
      {
        ...score,
        recall: score.expected === 0 ? 1 : rounded(score.matched / score.expected),
        rangeBreadth:
          score.expectedRangeLines === 0 ? null : rounded(score.attributedRangeLines / score.expectedRangeLines)
      }
    ])
  );
  return {
    cases: STATIC_ATTRIBUTION_CORPUS.length,
    layers,
    totalRecall: expectedTotal === 0 ? 1 : rounded(matchedTotal / expectedTotal),
    rangeBreadth: expectedRangeTotal === 0 ? 1 : rounded(attributedRangeTotal / expectedRangeTotal)
  };
}

function largeText(): string {
  const lines = Array.from({ length: 20_000 }, (_, index) => `line ${index + 1}`);
  lines[10] = 'needle early';
  lines[19_990] = 'needle late';
  return `${lines.join('\n')}\n`;
}

function parserCells(options: Options): MeasuredCell[] {
  const cwd = '/benchmark';
  const large = largeText();
  const smallPreState = (absolutePath: string) => (absolutePath.endsWith('.txt') ? TEXT : null);
  const largePreState = (absolutePath: string) => (absolutePath.endsWith('.txt') ? large : null);
  const definitions: Array<{ name: string; candidates: number; action: () => void }> = [
    { name: 'fast-rejection', candidates: 0, action: () => void parseCommandLayered('git status --short', { cwd }) },
    {
      name: 'deterministic-shell',
      candidates: 1,
      action: () => void parseFixture('deterministic literal overwrite control', cwd)
    },
    {
      name: 'literal-loop-2',
      candidates: 2,
      action: () => void parseFixture('literal-list loop expands completely', cwd)
    },
    {
      name: 'pattern-sed-small',
      candidates: 2,
      action: () => void parseFixture('pattern sed widens across ambiguous matches', cwd)
    },
    {
      name: 'pattern-perl-zero',
      candidates: 1,
      action: () => void parseFixture('perl zero-pi literal substitution', cwd)
    },
    { name: 'python', candidates: 1, action: () => void parseFixture('python literal replace', cwd) },
    { name: 'node', candidates: 1, action: () => void parseFixture('node literal replace', cwd) },
    {
      name: 'pattern-sed-large-file',
      candidates: 2,
      action: () => void parseCommandLayered("sed -i 's/needle/pin/' src/a.txt", { cwd, readPreState: largePreState })
    },
    {
      name: 'compound-multi-candidate',
      candidates: 4,
      action: () =>
        void parseCommandLayered(
          "sed -i 's/needle/pin/' src/a.txt src/b.txt; perl -pi -e 's/needle/pin/' src/c.txt src/d.txt",
          { cwd, readPreState: smallPreState }
        )
    }
  ];
  return definitions.map((cell) => ({
    name: cell.name,
    phase: 'parser',
    repository: 'none',
    candidates: cell.candidates,
    subprocesses: { hook: 0, git: 0, gitCommands: [] },
    ...measure(cell.action, options.parserWarmups, options.parserSamples)
  }));
}

interface BenchmarkRepo {
  repo: RealBundleRepo;
  size: 'small' | 'large';
  targets: string[];
  spanNames: string[];
}

function seedBenchmarkRepo(pathDir: string, size: 'small' | 'large', fileCount: number): BenchmarkRepo {
  const repo = makeRealBundleRepo(pathDir);
  const targets = Array.from({ length: 4 }, (_, index) => `src/target-${index + 1}.txt`);
  for (const target of targets) writeRepoFile(repo, target, TEXT);
  for (let index = targets.length; index < fileCount; index += 1) {
    writeRepoFile(repo, `corpus/dir-${index % 40}/file-${index}.txt`, `fixture ${index}\n`);
  }
  commitRepo(repo, `seed ${size} benchmark repository`);
  const spanNames = targets.map((_, index) => `benchmark/${size}-${index + 1}`);
  for (let index = 0; index < targets.length; index += 1) {
    addLineSpan(repo, spanNames[index], targets[index], 2, 2, `benchmark dependency ${size} ${index + 1}`);
  }
  commitRepo(repo, `anchor ${size} benchmark repository`);
  return { repo, size, targets, spanNames };
}

function envelope(
  repo: RealBundleRepo,
  sessionId: string,
  toolUseId: string,
  command: string,
  post: boolean
): Record<string, unknown> {
  return {
    session_id: sessionId,
    cwd: repo.root,
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: toolUseId,
    ...(post
      ? {
          tool_response: {
            stdout: '',
            stderr: '',
            exit_code: 0,
            interrupted: false,
            timedOutAfterMs: null,
            rawOutputPath: null
          }
        }
      : {})
  };
}

interface BundleCellDefinition {
  name: string;
  phase: 'pre' | 'post';
  fixture: BenchmarkRepo;
  command: string;
  candidates: number;
  expectedSpans: string[];
}

function writeTargetState(definition: BundleCellDefinition, post: boolean): void {
  const count = definition.candidates === 0 ? 0 : definition.candidates;
  for (const target of definition.fixture.targets.slice(0, count)) {
    writeRepoFile(definition.fixture.repo, target, post ? POST_TEXT : TEXT);
  }
}

function createProcessCountingEnv(repo: RealBundleRepo, gitBinary: string) {
  const root = mkdtempSync(join(tmpdir(), 'static-attribution-process-count-'));
  const bin = join(root, 'bin');
  const log = join(root, 'git.log');
  mkdirSync(bin);
  const wrapper = join(bin, 'git');
  writeFileSync(
    wrapper,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$STATIC_ATTRIBUTION_BENCH_PROCESS_LOG"\nexec ${JSON.stringify(gitBinary)} "$@"\n`,
    'utf8'
  );
  chmodSync(wrapper, 0o755);
  return {
    env: {
      ...repo.env,
      PATH: `${bin}:${repo.env.PATH ?? ''}`,
      STATIC_ATTRIBUTION_BENCH_PROCESS_LOG: log
    },
    log,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

function bundleCells(options: Options): MeasuredCell[] {
  const bundles = buildRealHookBundles();
  const workspaceGitSpan = buildWorkspaceGitSpan();
  const small = seedBenchmarkRepo(workspaceGitSpan.pathDir, 'small', 16);
  const large = seedBenchmarkRepo(workspaceGitSpan.pathDir, 'large', options.largeFiles);
  const pattern = (targets: readonly string[]) => `sed -i 's/needle/pin/' ${targets.join(' ')}`;
  const definitions: BundleCellDefinition[] = [
    {
      name: 'pre-small-fast-rejection',
      phase: 'pre',
      fixture: small,
      command: 'git status --short',
      candidates: 0,
      expectedSpans: []
    },
    {
      name: 'pre-small-pattern',
      phase: 'pre',
      fixture: small,
      command: pattern(small.targets.slice(0, 1)),
      candidates: 1,
      expectedSpans: []
    },
    {
      name: 'pre-large-pattern',
      phase: 'pre',
      fixture: large,
      command: pattern(large.targets.slice(0, 1)),
      candidates: 1,
      expectedSpans: []
    },
    {
      name: 'pre-large-multi-candidate',
      phase: 'pre',
      fixture: large,
      command: pattern(large.targets),
      candidates: 4,
      expectedSpans: []
    },
    {
      name: 'post-small-fast-rejection',
      phase: 'post',
      fixture: small,
      command: 'git status --short',
      candidates: 0,
      expectedSpans: []
    },
    {
      name: 'post-small-pattern',
      phase: 'post',
      fixture: small,
      command: pattern(small.targets.slice(0, 1)),
      candidates: 1,
      expectedSpans: small.spanNames.slice(0, 1)
    },
    {
      name: 'post-large-pattern',
      phase: 'post',
      fixture: large,
      command: pattern(large.targets.slice(0, 1)),
      candidates: 1,
      expectedSpans: large.spanNames.slice(0, 1)
    },
    {
      name: 'post-large-multi-candidate',
      phase: 'post',
      fixture: large,
      command: pattern(large.targets),
      candidates: 4,
      expectedSpans: large.spanNames
    }
  ];
  let invocation = 0;
  const measured: MeasuredCell[] = [];
  try {
    for (const definition of definitions) {
      const hookPath = join(
        bundles.claudeHooksDir,
        definition.phase === 'pre' ? 'static-plan.mjs' : 'post-tool-use.mjs'
      );
      const invoke = (env: NodeJS.ProcessEnv = definition.fixture.repo.env): void => {
        invocation += 1;
        const sessionId = `benchmark-${definition.name}-${invocation}`;
        const toolUseId = `tool-${invocation}`;
        if (definition.phase === 'post' && definition.candidates > 0) {
          writeTargetState(definition, false);
          invokeRealHook(
            join(bundles.claudeHooksDir, 'static-plan.mjs'),
            envelope(definition.fixture.repo, sessionId, toolUseId, definition.command, false),
            env
          );
          writeTargetState(definition, true);
        }
        const result = invokeRealHook(
          hookPath,
          envelope(definition.fixture.repo, sessionId, toolUseId, definition.command, definition.phase === 'post'),
          env
        );
        const context = hookContext(result.output);
        for (const span of definition.expectedSpans) {
          if (!context.includes(span)) throw new Error(`${definition.name}: emitted bundle omitted ${span}`);
        }
        if (definition.expectedSpans.length === 0 && context.length > 0) {
          throw new Error(`${definition.name}: emitted unexpected dependency context`);
        }
      };

      const counter = createProcessCountingEnv(definition.fixture.repo, '/usr/bin/git');
      let gitCommands: string[] = [];
      try {
        writeFileSync(counter.log, '', 'utf8');
        invoke(counter.env);
        const processLog = readFileSync(counter.log, 'utf8').trim();
        gitCommands = processLog.length === 0 ? [] : processLog.split('\n');
        if (definition.phase === 'post' && definition.candidates > 0) {
          const contextCommands = gitCommands.filter((command) => command.startsWith('span context '));
          if (contextCommands.length !== 1) {
            throw new Error(
              `${definition.name}: expected exactly one git span context child, got ${contextCommands.length}`
            );
          }
          const legacy = gitCommands.filter((command) => /^span (?:list|drift|why)\b/.test(command));
          if (legacy.length > 0) {
            throw new Error(`${definition.name}: legacy dependency children remain: ${legacy.join(', ')}`);
          }
        }
      } finally {
        counter.cleanup();
      }
      measured.push({
        name: definition.name,
        phase: definition.phase,
        repository: definition.fixture.size,
        candidates: definition.candidates,
        subprocesses: {
          hook: definition.phase === 'post' && definition.candidates > 0 ? 2 : 1,
          git: gitCommands.length,
          gitCommands
        },
        ...measure(() => invoke(), options.bundleWarmups, options.bundleSamples)
      });
    }
  } finally {
    small.repo.cleanup();
    large.repo.cleanup();
    bundles.cleanup();
  }
  return measured;
}

function gitOutput(args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return 'unknown';
  }
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const report = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    revision: gitOutput(['rev-parse', 'HEAD']),
    dirty: gitOutput(['status', '--short']).length > 0,
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpu: readFileSync('/proc/cpuinfo', 'utf8').match(/^model name\s*:\s*(.+)$/m)?.[1] ?? 'unknown'
    },
    policy: {
      parserWarmups: options.parserWarmups,
      parserSamples: options.parserSamples,
      bundleWarmups: options.bundleWarmups,
      bundleSamples: options.bundleSamples,
      quantiles: 'nearest-rank over measured warm samples',
      cold: 'first natural invocation before warmups; operating-system caches are not forcibly dropped',
      rendering: 'included in every post bundle sample',
      timingBoundary:
        'parser calls are in-process; bundle calls include one-shot Node startup and all hook work; tracked Post cells include their paired Pre plan and count both hook processes',
      largeRepositoryTrackedFiles: options.largeFiles
    },
    correctness: scoreCorpus(),
    parser: parserCells(options),
    bundle: bundleCells(options)
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output !== undefined) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, json, 'utf8');
  }
  process.stdout.write(json);
}

main();
