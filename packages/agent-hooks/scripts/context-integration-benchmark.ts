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
  command: (scaledPaths: readonly string[]) => string;
  legacyDependencyProcesses: (scaledCount: number) => number;
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
const BASELINE = 'implement/main-245/baseline';
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
    samples: positiveInteger(values.get('--samples') ?? '7', '--samples'),
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
  git(repo, ['checkout', '-q', '--', '.'], env);
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
  return { elapsedMs, context: hookContext(result.output), mutation: git(repo, ['diff', '--', '.span'], env) };
}

function measureArm(hooksDir: string, repo: RealBundleRepo, command: string, benchmarkOptions: Options): ArmResult {
  const counter = countingEnvironment(repo);
  try {
    for (let index = 0; index < benchmarkOptions.warmups; index += 1) {
      const state = prepare(hooksDir, repo, command, counter.env);
      invokePost(hooksDir, repo, command, state, counter.env);
    }
    const samplesMs: number[] = [];
    let context = '';
    let mutation = '';
    for (let index = 0; index < benchmarkOptions.samples; index += 1) {
      const state = prepare(hooksDir, repo, command, counter.env);
      const measured = invokePost(hooksDir, repo, command, state, counter.env);
      samplesMs.push(measured.elapsedMs);
      context = measured.context;
      mutation = measured.mutation;
    }
    writeFileSync(counter.log, '', 'utf8');
    const countedState = prepare(hooksDir, repo, command, counter.env);
    writeFileSync(counter.log, '', 'utf8');
    invokePost(hooksDir, repo, command, countedState, counter.env);
    const text = readFileSync(counter.log, 'utf8').trim();
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
  } finally {
    counter.cleanup();
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
    command: () => `cat > a.txt <<'EOF'\ninserted\n${TEXT}EOF`,
    legacyDependencyProcesses: () => 3
  },
  {
    name: 'semantic-drift',
    command: () => "sed -i '2s/anchor-one/ANCHOR-ONE/' a.txt",
    legacyDependencyProcesses: () => 4
  },
  {
    name: 'no-overlap',
    command: () => "sed -i '10s/tail/TAIL/' a.txt",
    legacyDependencyProcesses: () => 2
  },
  {
    name: 'multi-span',
    command: () => "sed -i '2,4s/anchor/ANCHOR/' a.txt",
    legacyDependencyProcesses: () => 5
  },
  {
    name: 'multi-path',
    command: () => "sed -i '2s/anchor-one/ANCHOR-ONE/' a.txt b.txt",
    legacyDependencyProcesses: () => 8
  },
  {
    name: 'scaled-repair',
    scaled: true,
    command: (scaled) => `sed -i '2s/anchor-one/ANCHOR-ONE/' ${scaled.join(' ')}`,
    legacyDependencyProcesses: (scaledCount) => scaledCount * 4
  }
];

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
        const legacyCommand = fixture.command(legacyScaled);
        const integratedCommand = fixture.command(integratedScaled);
        const legacy = measureArm(baseline.hooksDir, legacyRepo, legacyCommand, benchmarkOptions);
        const integrated = measureArm(current.claudeHooksDir, integratedRepo, integratedCommand, benchmarkOptions);
        if (legacy.context !== integrated.context) {
          throw new Error(
            `${fixture.name}: stdout/context differs between arms\nlegacy=${JSON.stringify(legacy.context)}\nintegrated=${JSON.stringify(integrated.context)}`
          );
        }
        if (legacy.mutation !== integrated.mutation)
          throw new Error(`${fixture.name}: span mutation differs between arms`);
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
    const thresholds = { scaledP50: 0.5, scaledP95: 0.4 };
    if (scaled.improvement.p50 < thresholds.scaledP50 || scaled.improvement.p95 < thresholds.scaledP95) {
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
        'Each arm receives the same warmup count. Integrated measurements reuse its repository service across events, matching production watched-generation reuse.',
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
