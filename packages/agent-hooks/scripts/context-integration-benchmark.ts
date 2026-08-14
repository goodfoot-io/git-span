/** Acceptance benchmark for legacy per-touch children versus batched context. */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  addLineSpan,
  buildRealHookBundles,
  commitRepo,
  hookContext,
  invokeRealHook,
  makeRealBundleRepo,
  type RealBundleRepo,
  writeRepoFile
} from '../test/real-bundle-helpers.js';

interface Options {
  warmups: number;
  samples: number;
  scaledPaths: number;
  output?: string;
}

interface Fixture {
  name: string;
  scaled?: boolean;
  command: (scaledPaths: readonly string[], iteration: number) => string;
  legacyDependencyProcesses: (scaledCount: number) => number;
}

interface LatencyCeiling {
  p50Ms: number;
  p95Ms: number;
}

interface Distribution {
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
}

interface ArmResult extends Distribution {
  context: string;
  mutation: string;
  dependencyProcesses: number;
  totalGitProcesses: number;
  commands: string[];
}

const PACKAGE_ROOT =
  process.env['AGENT_HOOKS_BENCHMARK_ROOT'] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ROOT = resolve(PACKAGE_ROOT, '../..');
// The last pre-integration revision is an ancestor of main, so the benchmark remains
// reproducible after the temporary implementation checkpoint tag is removed.
const BASELINE = 'ee50e7397836117df405a76b9f661322f803d3db';
const TEXT = `${['alpha', 'anchor-one', 'middle', 'anchor-two', 'spare', 'six', 'seven', 'eight', 'nine', 'tail'].join('\n')}\n`;

function buildAcceptanceGitSpan(): { binary: string; pathDir: string } {
  const targetRoot = process.env['GIT_SPAN_CARGO_TARGET_ROOT'] ?? '/var/cache/git-span/cargo-target';
  const targetDir = join(targetRoot, 'git-span', 'build');
  const packageRoot = join(WORKSPACE_ROOT, 'packages', 'git-span');
  execFileSync(
    'bash',
    [
      'scripts/with-target-lock.sh',
      'shared',
      'env',
      `CARGO_TARGET_DIR=${targetDir}`,
      'cargo',
      'build',
      '--quiet',
      '--release',
      '--locked',
      '--bin',
      'git-span'
    ],
    { cwd: packageRoot, stdio: 'pipe' }
  );
  const pathDir = join(targetDir, 'release');
  const binary = join(pathDir, process.platform === 'win32' ? 'git-span.exe' : 'git-span');
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
  if (!version.startsWith('git-span ')) throw new Error(`release git-span emitted an invalid version: ${version}`);
  return { binary, pathDir };
}

function positiveInteger(raw: string | undefined, flag: string): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer`);
  return value;
}

function options(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined)
      throw new Error(`invalid benchmark option near ${flag ?? '<end>'}`);
    values.set(flag, value);
  }
  const known = new Set(['--warmups', '--samples', '--scaled-paths', '--output']);
  for (const flag of values.keys()) if (!known.has(flag)) throw new Error(`unknown option: ${flag}`);
  return {
    warmups: positiveInteger(values.get('--warmups') ?? '2', '--warmups'),
    samples: positiveInteger(values.get('--samples') ?? '20', '--samples'),
    scaledPaths: positiveInteger(values.get('--scaled-paths') ?? '32', '--scaled-paths'),
    ...(values.has('--output') ? { output: resolve(values.get('--output')!) } : {})
  };
}

function quantile(samples: readonly number[], percentile: number): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(percentile * ordered.length) - 1)] ?? 0;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function distribution(samplesMs: number[]): Distribution {
  return { samplesMs, p50Ms: rounded(quantile(samplesMs, 0.5)), p95Ms: rounded(quantile(samplesMs, 0.95)) };
}

function git(repo: RealBundleRepo, args: readonly string[], env: NodeJS.ProcessEnv = repo.env): string {
  return execFileSync('git', [...args], {
    cwd: repo.root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function baselineBundles(): { hooksDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'context-benchmark-baseline-'));
  const hooksDir = join(root, 'bin');
  mkdirSync(hooksDir);
  for (const name of ['static-plan.mjs', 'post-tool-use.mjs']) {
    const content = execFileSync('git', ['show', `${BASELINE}:plugins-claude/git-span/hooks/bin/${name}`], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8'
    });
    writeFileSync(join(hooksDir, name), content, 'utf8');
  }
  return { hooksDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function countingEnvironment(repo: RealBundleRepo): { env: NodeJS.ProcessEnv; log: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'context-benchmark-processes-'));
  const bin = join(root, 'bin');
  const log = join(root, 'git.log');
  mkdirSync(bin);
  const wrapper = join(bin, 'git');
  writeFileSync(
    wrapper,
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CONTEXT_BENCHMARK_PROCESS_LOG"\nexec /usr/bin/git "$@"\n',
    'utf8'
  );
  chmodSync(wrapper, 0o755);
  writeFileSync(log, '', 'utf8');
  return {
    env: { ...repo.env, PATH: `${bin}:${repo.env.PATH ?? ''}`, CONTEXT_BENCHMARK_PROCESS_LOG: log },
    log,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

function seed(repo: RealBundleRepo, scaledCount: number): string[] {
  writeRepoFile(repo, 'a.txt', TEXT);
  writeRepoFile(repo, 'b.txt', TEXT);
  const scaled = Array.from({ length: scaledCount }, (_, index) => `scaled-${index + 1}.txt`);
  for (const path of scaled) writeRepoFile(repo, path, TEXT);
  commitRepo(repo, 'seed context acceptance benchmark');
  addLineSpan(repo, 'bench/a-one', 'a.txt', 2, 2, '');
  addLineSpan(repo, 'bench/a-two', 'a.txt', 4, 4, '');
  addLineSpan(repo, 'bench/b-one', 'b.txt', 2, 2, '');
  for (const [index, path] of scaled.entries()) {
    addLineSpan(repo, `bench/scaled-${index + 1}`, path, 2, 2, '');
  }
  commitRepo(repo, 'anchor context acceptance benchmark');
  return scaled;
}

function envelope(repo: RealBundleRepo, sessionId: string, toolUseId: string, command: string, response?: string) {
  return {
    session_id: sessionId,
    cwd: repo.root,
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: toolUseId,
    ...(response === undefined
      ? {}
      : {
          tool_response: {
            stdout: response,
            stderr: '',
            exit_code: 0,
            interrupted: false,
            timedOutAfterMs: null,
            rawOutputPath: null
          }
        })
  };
}

let invocation = 0;
function prepare(
  hooksDir: string,
  repo: RealBundleRepo,
  command: string,
  env: NodeJS.ProcessEnv
): { sessionId: string; toolUseId: string; stdout: string } {
  invocation += 1;
  const sessionId = `context-benchmark-${invocation}`;
  const toolUseId = `tool-${invocation}`;
  invokeRealHook(join(hooksDir, 'static-plan.mjs'), envelope(repo, sessionId, toolUseId, command), env);
  const shell = execFileSync('bash', ['-c', command], {
    cwd: repo.root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { sessionId, toolUseId, stdout: shell };
}

function invokePost(
  hooksDir: string,
  repo: RealBundleRepo,
  command: string,
  prepared: ReturnType<typeof prepare>,
  env: NodeJS.ProcessEnv
): { elapsedMs: number; context: string; mutation: string } {
  const started = performance.now();
  const result = invokeRealHook(
    join(hooksDir, 'post-tool-use.mjs'),
    envelope(repo, prepared.sessionId, prepared.toolUseId, command, prepared.stdout),
    env
  );
  const elapsedMs = rounded(performance.now() - started);
  return {
    elapsedMs,
    context: hookContext(result.output),
    mutation: git(repo, ['diff', '--', '.span'], env)
  };
}

function countedArm(
  hooksDir: string,
  repo: RealBundleRepo,
  command: string,
  env: NodeJS.ProcessEnv,
  log: string,
  samplesMs: number[],
  context: string,
  mutation: string
): ArmResult {
  writeFileSync(log, '', 'utf8');
  const state = prepare(hooksDir, repo, command, env);
  writeFileSync(log, '', 'utf8');
  invokePost(hooksDir, repo, command, state, env);
  const text = readFileSync(log, 'utf8').trim();
  const commands = text.length === 0 ? [] : text.split('\n');
  const dependencyCommands = commands.filter((value) => /^span (?:context|list|drift|why)\b/.test(value));
  return {
    context,
    mutation,
    dependencyProcesses: dependencyCommands.length,
    totalGitProcesses: commands.length,
    commands,
    ...distribution(samplesMs)
  };
}

function measurePair(
  legacyHooksDir: string,
  integratedHooksDir: string,
  legacyRepo: RealBundleRepo,
  integratedRepo: RealBundleRepo,
  legacyCommand: (iteration: number) => string,
  integratedCommand: (iteration: number) => string,
  benchmarkOptions: Options
): { legacy: ArmResult; integrated: ArmResult } {
  const legacyCounter = countingEnvironment(legacyRepo);
  const integratedCounter = countingEnvironment(integratedRepo);
  try {
    for (let index = 0; index < benchmarkOptions.warmups; index += 1) {
      const legacyValue = legacyCommand(index);
      const integratedValue = integratedCommand(index);
      const legacyState = prepare(legacyHooksDir, legacyRepo, legacyValue, legacyCounter.env);
      invokePost(legacyHooksDir, legacyRepo, legacyValue, legacyState, legacyCounter.env);
      const integratedState = prepare(integratedHooksDir, integratedRepo, integratedValue, integratedCounter.env);
      invokePost(integratedHooksDir, integratedRepo, integratedValue, integratedState, integratedCounter.env);
    }
    const legacySamples: number[] = [];
    const integratedSamples: number[] = [];
    let legacyContext = '';
    let integratedContext = '';
    let legacyMutation = '';
    let integratedMutation = '';
    for (let index = 0; index < benchmarkOptions.samples; index += 1) {
      const measureLegacy = (): void => {
        const command = legacyCommand(benchmarkOptions.warmups + index);
        const state = prepare(legacyHooksDir, legacyRepo, command, legacyCounter.env);
        const measured = invokePost(legacyHooksDir, legacyRepo, command, state, legacyCounter.env);
        legacySamples.push(measured.elapsedMs);
        legacyContext = measured.context;
        legacyMutation = measured.mutation;
      };
      const measureIntegrated = (): void => {
        const command = integratedCommand(benchmarkOptions.warmups + index);
        const state = prepare(integratedHooksDir, integratedRepo, command, integratedCounter.env);
        const measured = invokePost(integratedHooksDir, integratedRepo, command, state, integratedCounter.env);
        integratedSamples.push(measured.elapsedMs);
        integratedContext = measured.context;
        integratedMutation = measured.mutation;
      };
      if (index % 2 === 0) {
        measureLegacy();
        measureIntegrated();
      } else {
        measureIntegrated();
        measureLegacy();
      }
      if (legacyContext !== integratedContext) {
        throw new Error(
          `sample ${index + 1}: stdout/context differs between arms\nlegacy=${JSON.stringify(legacyContext)}\nintegrated=${JSON.stringify(integratedContext)}`
        );
      }
      if (legacyMutation !== integratedMutation) {
        throw new Error(
          `sample ${index + 1}: span mutation differs between arms\nlegacy=${JSON.stringify(legacyMutation)}\nintegrated=${JSON.stringify(integratedMutation)}`
        );
      }
    }
    return {
      legacy: countedArm(
        legacyHooksDir,
        legacyRepo,
        legacyCommand(benchmarkOptions.warmups + benchmarkOptions.samples),
        legacyCounter.env,
        legacyCounter.log,
        legacySamples,
        legacyContext,
        legacyMutation
      ),
      integrated: countedArm(
        integratedHooksDir,
        integratedRepo,
        integratedCommand(benchmarkOptions.warmups + benchmarkOptions.samples),
        integratedCounter.env,
        integratedCounter.log,
        integratedSamples,
        integratedContext,
        integratedMutation
      )
    };
  } finally {
    legacyCounter.cleanup();
    integratedCounter.cleanup();
  }
}

const FIXTURES: Fixture[] = [
  {
    name: 'clean',
    command: () => "sed -i '2s/anchor-one/anchor-one/' a.txt",
    legacyDependencyProcesses: () => 4
  },
  {
    name: 'moved',
    command: (_scaled, iteration) => `cat > a.txt <<'EOF'\n${'inserted\n'.repeat(iteration + 1)}${TEXT}EOF`,
    legacyDependencyProcesses: () => 3
  },
  {
    name: 'semantic-drift',
    command: (_scaled, iteration) =>
      iteration === 0
        ? "sed -i '2s/anchor-one/ANCHOR-ONE/' a.txt"
        : iteration % 2 === 1
          ? "sed -i '2s/ANCHOR-ONE/ANCHOR-TWO/' a.txt"
          : "sed -i '2s/ANCHOR-TWO/ANCHOR-ONE/' a.txt",
    legacyDependencyProcesses: () => 4
  },
  {
    name: 'no-overlap',
    command: (_scaled, iteration) =>
      iteration === 0
        ? "sed -i '10s/tail/TAIL-ONE/' a.txt"
        : iteration % 2 === 1
          ? "sed -i '10s/TAIL-ONE/TAIL-TWO/' a.txt"
          : "sed -i '10s/TAIL-TWO/TAIL-ONE/' a.txt",
    legacyDependencyProcesses: () => 2
  },
  {
    name: 'multi-span',
    command: (_scaled, iteration) =>
      iteration === 0
        ? "sed -i '2,4s/anchor/ANCHOR/' a.txt"
        : iteration % 2 === 1
          ? "sed -i '2,4s/ANCHOR/ANCH0R/' a.txt"
          : "sed -i '2,4s/ANCH0R/ANCHOR/' a.txt",
    legacyDependencyProcesses: () => 5
  },
  {
    name: 'multi-path',
    command: (_scaled, iteration) =>
      iteration === 0
        ? "sed -i '2s/anchor-one/ANCHOR-ONE/' a.txt b.txt"
        : iteration % 2 === 1
          ? "sed -i '2s/ANCHOR-ONE/ANCHOR-TWO/' a.txt b.txt"
          : "sed -i '2s/ANCHOR-TWO/ANCHOR-ONE/' a.txt b.txt",
    legacyDependencyProcesses: () => 8
  },
  {
    name: 'scaled-repair',
    scaled: true,
    command: (scaled, iteration) => {
      const replacement =
        iteration === 0
          ? 'anchor-one/ANCHOR-ONE'
          : iteration % 2 === 1
            ? 'ANCHOR-ONE/ANCHOR-TWO'
            : 'ANCHOR-TWO/ANCHOR-ONE';
      return `sed -i '2s/${replacement}/' ${scaled.join(' ')}`;
    },
    legacyDependencyProcesses: (scaledCount) => scaledCount * 4
  }
];

const LATENCY_CEILINGS: Record<string, LatencyCeiling> = {
  clean: { p50Ms: 250, p95Ms: 500 },
  moved: { p50Ms: 250, p95Ms: 500 },
  'semantic-drift': { p50Ms: 250, p95Ms: 500 },
  'no-overlap': { p50Ms: 250, p95Ms: 500 },
  'multi-span': { p50Ms: 250, p95Ms: 500 },
  'multi-path': { p50Ms: 250, p95Ms: 500 }
};

function main(): void {
  const benchmarkOptions = options(process.argv.slice(2));
  const current = buildRealHookBundles();
  const baseline = baselineBundles();
  const binary = buildAcceptanceGitSpan();
  try {
    const rows = FIXTURES.map((fixture) => {
      const legacyRepo = makeRealBundleRepo(binary.pathDir);
      const integratedRepo = makeRealBundleRepo(binary.pathDir);
      try {
        const scaledCount = fixture.scaled === true ? benchmarkOptions.scaledPaths : 0;
        const legacyScaled = seed(legacyRepo, scaledCount);
        const integratedScaled = seed(integratedRepo, scaledCount);
        const legacyCommand = (iteration: number) => fixture.command(legacyScaled, iteration);
        const integratedCommand = (iteration: number) => fixture.command(integratedScaled, iteration);
        const { legacy, integrated } = measurePair(
          baseline.hooksDir,
          current.claudeHooksDir,
          legacyRepo,
          integratedRepo,
          legacyCommand,
          integratedCommand,
          benchmarkOptions
        );
        if (legacy.context !== integrated.context) {
          throw new Error(
            `${fixture.name}: stdout/context differs between arms\nlegacy=${JSON.stringify(legacy.context)}\nintegrated=${JSON.stringify(integrated.context)}`
          );
        }
        if (legacy.mutation !== integrated.mutation) {
          throw new Error(
            `${fixture.name}: span mutation differs between arms\nlegacy=${JSON.stringify(legacy.mutation)}\nintegrated=${JSON.stringify(integrated.mutation)}`
          );
        }
        const expectedLegacy = fixture.legacyDependencyProcesses(scaledCount);
        if (legacy.dependencyProcesses !== expectedLegacy) {
          throw new Error(
            `${fixture.name}: expected ${expectedLegacy} legacy dependency children, got ${legacy.dependencyProcesses}`
          );
        }
        if (
          integrated.dependencyProcesses !== 1 ||
          !integrated.commands.some((value) => value.startsWith('span context '))
        ) {
          throw new Error(`${fixture.name}: integrated arm did not use exactly one context child`);
        }
        return {
          fixture: fixture.name,
          legacy,
          integrated,
          improvement: {
            p50: rounded(1 - integrated.p50Ms / legacy.p50Ms),
            p95: rounded(1 - integrated.p95Ms / legacy.p95Ms)
          }
        };
      } finally {
        legacyRepo.cleanup();
        integratedRepo.cleanup();
      }
    });
    const scaled = rows.find(({ fixture }) => fixture === 'scaled-repair')!;
    const thresholds = {
      latencyCeilings: LATENCY_CEILINGS,
      scaledImprovement: { p50: 0.5, p95: 0.4 }
    };
    for (const row of rows) {
      const ceiling = LATENCY_CEILINGS[row.fixture];
      if (ceiling !== undefined && (row.integrated.p50Ms > ceiling.p50Ms || row.integrated.p95Ms > ceiling.p95Ms)) {
        throw new Error(
          `${row.fixture}: integrated latency exceeded its p50/p95 ceiling: actual=${row.integrated.p50Ms}/${row.integrated.p95Ms}ms, ceiling=${ceiling.p50Ms}/${ceiling.p95Ms}ms`
        );
      }
    }
    if (
      scaled.improvement.p50 < thresholds.scaledImprovement.p50 ||
      scaled.improvement.p95 < thresholds.scaledImprovement.p95
    ) {
      throw new Error(
        `scaled repair improvement missed thresholds: legacy p50/p95=${scaled.legacy.p50Ms}/${scaled.legacy.p95Ms}ms, integrated p50/p95=${scaled.integrated.p50Ms}/${scaled.integrated.p95Ms}ms, improvement p50/p95=${scaled.improvement.p50}/${scaled.improvement.p95}`
      );
    }
    const report = {
      schemaVersion: 1,
      baseline: BASELINE,
      measurementBoundary:
        'PostToolUse process only; fixture reset, PreToolUse planning, and shell mutation are outside timing. Both arms use the same release-profile workspace git-span binary and process-count wrapper.',
      binaryProfile:
        'Release. Debug-profile context repair repeatedly hashes configured filter executables without optimization and is not representative of the shipped CLI latency.',
      serviceWarmup:
        'Each arm receives the same warmup count. Samples alternate arm order so transient host load cannot systematically favor one arm, and fixtures advance through equivalent edits rather than rewinding repository state. Integrated measurements therefore reuse one repository service across events, matching production watched-generation reuse.',
      acceptancePolicy:
        "Every non-scaled cell must keep integrated p50 below 250ms, the card's approximately 244ms pre-integration single-event baseline, and p95 below a 500ms bounded tail. The scaled cell must materially improve p50/p95 by 50%/40%. Negative percentage improvements remain visible for every cell and are never rewritten as passes.",
      policy: { ...benchmarkOptions, thresholds },
      rows
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (benchmarkOptions.output !== undefined) {
      mkdirSync(dirname(benchmarkOptions.output), { recursive: true });
      writeFileSync(benchmarkOptions.output, json, 'utf8');
    }
    process.stdout.write(json);
  } finally {
    baseline.cleanup();
    current.cleanup();
  }
}

main();
