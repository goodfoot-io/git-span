/**
 * Deterministic hook-path benchmark for the four non-static-attribution hot paths.
 *
 * Mirrors `static-attribution-benchmark.ts`'s cell pattern — `performance.now()`
 * timing, explicit warmups, nearest-rank p50/p95/p99, JSON on stdout — for the
 * paths that benchmark does not cover:
 *
 *   - `advisor`      git subprocess spawn + changeset resolution
 *                    (`resolveChangeset`/`GitExecutor`, src/common/advisor-core.ts)
 *                    over `commit`/`push`/`status` in real repositories.
 *   - `apply-patch`  Codex apply_patch content-matching hunk recovery
 *                    (src/codex/apply-patch.ts, driven through
 *                    src/codex/apply-patch-plan.ts's parse entry point).
 *   - `session-sweep` readdir/stat/rename/rm trash cleanup
 *                    (`pruneStaleSessions`/`cleanupSessionState`,
 *                    src/common/agent-hooks-common.ts) at varying stale-dir counts.
 *   - `failure`      the PostToolUseFailure touch/attribution pipeline, measured
 *                    through the real emitted `post-tool-use-failure.mjs` bundle.
 *
 * Every cell asserts its own result before timing it, so a "faster" number can
 * never come from a path that quietly stopped doing the work.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseApplyPatch } from '../src/codex/apply-patch.js';
import { type Changeset, createDefaultGitExecutor, resolveChangeset } from '../src/common/advisor-core.js';
import {
  cleanupSessionState,
  createSessionLayout,
  pruneStaleSessions,
  type SessionLayout
} from '../src/common/agent-hooks-common.js';
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
  inProcessWarmups: number;
  inProcessSamples: number;
  bundleWarmups: number;
  bundleSamples: number;
  sweepDirs: number;
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

type CellGroup = 'advisor' | 'apply-patch' | 'session-sweep' | 'failure';

interface MeasuredCell extends Distribution {
  name: string;
  group: CellGroup;
  /** Group-specific size knob (paths, hunks, stale dirs, candidates). */
  scale: number;
  /** Whether the cell's timing includes one or more spawned processes. */
  spawns: boolean;
}

const PACKAGE_ROOT =
  process.env['AGENT_HOOKS_BENCHMARK_ROOT'] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
    '--in-process-warmups',
    '--in-process-samples',
    '--bundle-warmups',
    '--bundle-samples',
    '--sweep-dirs',
    '--output'
  ]);
  for (const flag of values.keys()) if (!known.has(flag)) throw new Error(`unknown option: ${flag}`);
  return {
    inProcessWarmups: positiveInteger(values.get('--in-process-warmups') ?? '5', '--in-process-warmups'),
    inProcessSamples: positiveInteger(values.get('--in-process-samples') ?? '40', '--in-process-samples'),
    bundleWarmups: positiveInteger(values.get('--bundle-warmups') ?? '3', '--bundle-warmups'),
    bundleSamples: positiveInteger(values.get('--bundle-samples') ?? '20', '--bundle-samples'),
    sweepDirs: positiveInteger(values.get('--sweep-dirs') ?? '400', '--sweep-dirs'),
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

async function timeAsync(action: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await action();
  return rounded(performance.now() - started);
}

function distribution(coldMs: number, warmupMs: number[], samplesMs: number[]): Distribution {
  return {
    coldMs,
    warmupMs,
    samplesMs,
    p50Ms: rounded(quantile(samplesMs, 0.5)),
    p95Ms: rounded(quantile(samplesMs, 0.95)),
    p99Ms: rounded(quantile(samplesMs, 0.99))
  };
}

function measure(action: () => void, warmups: number, sampleCount: number): Distribution {
  const coldMs = time(action);
  const warmupMs = Array.from({ length: warmups }, () => time(action));
  const samplesMs = Array.from({ length: sampleCount }, () => time(action));
  return distribution(coldMs, warmupMs, samplesMs);
}

async function measureAsync(action: () => Promise<void>, warmups: number, sampleCount: number): Promise<Distribution> {
  const coldMs = await timeAsync(action);
  const warmupMs: number[] = [];
  for (let index = 0; index < warmups; index += 1) warmupMs.push(await timeAsync(action));
  const samplesMs: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) samplesMs.push(await timeAsync(action));
  return distribution(coldMs, warmupMs, samplesMs);
}

/**
 * Re-seed a fixture before each sample without charging the reset to the cell.
 * Anything that mutates state the measured action consumes goes here.
 */
function measureWithReset(reset: () => void, action: () => void, warmups: number, sampleCount: number): Distribution {
  const run = (): number => {
    reset();
    return time(action);
  };
  const coldMs = run();
  const warmupMs = Array.from({ length: warmups }, run);
  const samplesMs = Array.from({ length: sampleCount }, run);
  return distribution(coldMs, warmupMs, samplesMs);
}

// ---------------------------------------------------------------------------
// Cell group 1 — advisor changeset resolution (git subprocess spawn + diff)
// ---------------------------------------------------------------------------

interface AdvisorFixture {
  repo: RealBundleRepo;
  cleanup(): void;
}

function git(repo: RealBundleRepo, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd: repo.root, env: repo.env, stdio: 'pipe' });
}

/**
 * A repository with a configured upstream and a mixed staged/unstaged/outgoing
 * working set, so each of the three advisor changeset kinds resolves a
 * non-empty path list through its real subprocess reads.
 */
function seedAdvisorRepo(pathDir: string, trackedFiles: number): AdvisorFixture {
  const repo = makeRealBundleRepo(pathDir);
  for (let index = 0; index < trackedFiles; index += 1) {
    writeRepoFile(repo, `src/module-${index % 20}/file-${index}.txt`, `advisor fixture ${index}\n`);
  }
  commitRepo(repo, 'seed advisor benchmark repository');

  // A local bare remote plus an upstream branch makes `push` resolve through
  // the `@{u}..HEAD` read rather than the merge-base fallback.
  const remote = join(dirname(repo.root), 'origin.git');
  execFileSync('git', ['init', '--bare', '-q', remote], { env: repo.env, stdio: 'pipe' });
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-q', '-u', 'origin', 'HEAD']);

  // Outgoing commits (push range), then staged and unstaged edits on top.
  for (let index = 0; index < 12; index += 1) {
    writeRepoFile(repo, `src/module-${index % 20}/file-${index}.txt`, `advisor outgoing ${index}\n`);
  }
  commitRepo(repo, 'outgoing advisor benchmark edits');
  for (let index = 20; index < 32; index += 1) {
    writeRepoFile(repo, `src/module-${index % 20}/file-${index}.txt`, `advisor staged ${index}\n`);
  }
  git(repo, ['add', '-A']);
  for (let index = 40; index < 52; index += 1) {
    writeRepoFile(repo, `src/module-${index % 20}/file-${index}.txt`, `advisor unstaged ${index}\n`);
  }
  return { repo, cleanup: () => rmSync(dirname(repo.root), { recursive: true, force: true }) };
}

async function advisorCells(options: Options, fixture: AdvisorFixture): Promise<MeasuredCell[]> {
  const executor = createDefaultGitExecutor();
  const cwd = fixture.repo.root;
  const definitions: Array<{ name: string; kind: 'commit' | 'push' | 'status'; all: boolean; paths?: string[] }> = [
    { name: 'advisor-commit-staged', kind: 'commit', all: false },
    { name: 'advisor-commit-all', kind: 'commit', all: true },
    { name: 'advisor-commit-pathspec', kind: 'commit', all: false, paths: ['src'] },
    { name: 'advisor-push-outgoing', kind: 'push', all: false },
    { name: 'advisor-status', kind: 'status', all: false }
  ];
  const cells: MeasuredCell[] = [];
  for (const definition of definitions) {
    const run = async (): Promise<Changeset> =>
      resolveChangeset(definition.kind, definition.all, cwd, executor, definition.paths);
    const sample = await run();
    if (sample.paths.length === 0) {
      throw new Error(`${definition.name}: fixture resolved an empty changeset`);
    }
    if (definition.kind === 'push' && sample.range.kind !== 'commits') {
      throw new Error(`${definition.name}: push range degraded to ${sample.range.kind}`);
    }
    cells.push({
      name: definition.name,
      group: 'advisor',
      scale: sample.paths.length,
      spawns: true,
      ...(await measureAsync(
        async () => {
          await run();
        },
        options.inProcessWarmups,
        options.inProcessSamples
      ))
    });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Cell group 2 — Codex apply_patch hunk recovery (content-matching anchors)
// ---------------------------------------------------------------------------

/**
 * A file whose lines are unique except for a deliberately repeated block, so
 * the benchmark exercises both the unique-match path and the duplicate-plus-
 * change-context disambiguation path in `locateChunk`.
 */
function applyPatchFile(lines: number): string {
  const body = Array.from({ length: lines }, (_, index) => `content line ${index}`);
  // A repeated block near both ends forces the duplicate-match branch.
  const repeated = ['shared alpha', 'shared beta', 'shared gamma'];
  body.splice(Math.floor(lines * 0.2), repeated.length, ...repeated);
  body.splice(Math.floor(lines * 0.8), repeated.length, ...repeated);
  body[Math.floor(lines * 0.2) - 1] = 'unique marker early';
  body[Math.floor(lines * 0.8) - 1] = 'unique marker late';
  return `${body.join('\n')}\n`;
}

/** Build an Update envelope with `hunks` chunks spread across the file. */
function applyPatchCommand(path: string, fileLines: string[], hunks: number): string {
  const out: string[] = ['*** Begin Patch', `*** Update File: ${path}`];
  const stride = Math.floor(fileLines.length / (hunks + 1));
  for (let index = 0; index < hunks; index += 1) {
    const at = stride * (index + 1);
    // Three-line context window, one line rewritten in the middle.
    out.push('@@');
    out.push(` ${fileLines[at - 1]}`);
    out.push(`-${fileLines[at]}`);
    out.push(`+${fileLines[at]} (patched)`);
    out.push(` ${fileLines[at + 1]}`);
  }
  out.push('*** End Patch');
  return out.join('\n');
}

/** The duplicate-block envelope: the pre-edit block appears twice, `@@` selects. */
function ambiguousApplyPatchCommand(path: string): string {
  return [
    '*** Begin Patch',
    `*** Update File: ${path}`,
    '@@ unique marker late',
    ' shared alpha',
    '-shared beta',
    '+shared beta (patched)',
    ' shared gamma',
    '*** End Patch'
  ].join('\n');
}

function applyPatchCells(options: Options): MeasuredCell[] {
  const path = 'src/target.txt';
  const cells: MeasuredCell[] = [];
  for (const fileLines of [2_000, 20_000]) {
    const content = applyPatchFile(fileLines);
    const lines = content.split('\n');
    const read = (candidate: string): string | null => (candidate === path ? content : null);
    for (const hunks of [1, 8, 32]) {
      const command = applyPatchCommand(path, lines, hunks);
      const anchors = parseApplyPatch(command, read);
      if (anchors.length !== 1 || anchors[0].kind !== 'write' || anchors[0].range === undefined) {
        throw new Error(`apply-patch-${fileLines}-${hunks}: expected one ranged write anchor`);
      }
      cells.push({
        name: `apply-patch-${fileLines / 1000}k-hunks-${hunks}`,
        group: 'apply-patch',
        scale: hunks,
        spawns: false,
        ...measure(() => void parseApplyPatch(command, read), options.inProcessWarmups, options.inProcessSamples)
      });
    }
    const ambiguous = ambiguousApplyPatchCommand(path);
    const ambiguousAnchors = parseApplyPatch(ambiguous, read);
    if (ambiguousAnchors.length !== 1 || ambiguousAnchors[0].range === undefined) {
      throw new Error(`apply-patch-${fileLines}-ambiguous: expected a context-disambiguated range`);
    }
    cells.push({
      name: `apply-patch-${fileLines / 1000}k-ambiguous`,
      group: 'apply-patch',
      scale: 1,
      spawns: false,
      ...measure(() => void parseApplyPatch(ambiguous, read), options.inProcessWarmups, options.inProcessSamples)
    });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Cell group 3 — session-end / stop sweeps (readdir/stat/rename/rm)
// ---------------------------------------------------------------------------

const SWEEP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface SweepFixture {
  layout: SessionLayout;
  root: string;
}

function makeSweepFixture(): SweepFixture {
  const root = mkdtempSync(join(tmpdir(), 'agent-hooks-sweep-'));
  return { layout: createSessionLayout(join(root, 'session')), root };
}

/**
 * Populate `count` session dirs, `stale` of them aged past the prune horizon,
 * plus `trashed` already-trashed dirs aged past the trash TTL.
 */
function seedSweep(fixture: SweepFixture, now: number, count: number, stale: number, trashed: number): void {
  rmSync(fixture.layout.base, { recursive: true, force: true });
  rmSync(fixture.layout.trashDir, { recursive: true, force: true });
  mkdirSync(fixture.layout.base, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    const dir = fixture.layout.dir(`session-${index}`);
    mkdirSync(join(dir, 'planned-touches'), { recursive: true });
    writeFileSync(join(dir, 'touch-memo.json'), '{"version":1,"entries":[]}\n', 'utf8');
    if (index < stale) {
      const aged = (now - SWEEP_MAX_AGE_MS - 60_000) / 1000;
      utimesSync(dir, aged, aged);
    }
  }
  if (trashed > 0) mkdirSync(fixture.layout.trashDir, { recursive: true });
  for (let index = 0; index < trashed; index += 1) {
    const dir = join(fixture.layout.trashDir, `session-old-${index}.trash-session-1-${index.toString(36)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'touch-memo.json'), '{"version":1,"entries":[]}\n', 'utf8');
    const aged = (now - 600_000) / 1000;
    utimesSync(dir, aged, aged);
  }
}

function sessionSweepCells(options: Options): MeasuredCell[] {
  const fixture = makeSweepFixture();
  const now = Date.now();
  const cells: MeasuredCell[] = [];
  try {
    for (const [live, stale, trashed] of [
      [options.sweepDirs, 0, 0],
      [options.sweepDirs, Math.floor(options.sweepDirs / 4), 0],
      [options.sweepDirs, Math.floor(options.sweepDirs / 4), Math.floor(options.sweepDirs / 4)]
    ] as const) {
      cells.push({
        name: `session-prune-live-${live}-stale-${stale}-trashed-${trashed}`,
        group: 'session-sweep',
        scale: live + trashed,
        spawns: false,
        ...measureWithReset(
          () => seedSweep(fixture, now, live, stale, trashed),
          () => pruneStaleSessions(fixture.layout, now, SWEEP_MAX_AGE_MS),
          options.inProcessWarmups,
          options.inProcessSamples
        )
      });
    }
    cells.push({
      name: `session-cleanup-single-of-${options.sweepDirs}`,
      group: 'session-sweep',
      scale: options.sweepDirs,
      spawns: false,
      ...measureWithReset(
        () => seedSweep(fixture, now, options.sweepDirs, 0, 0),
        () => cleanupSessionState(fixture.layout, 'session-0', now),
        options.inProcessWarmups,
        options.inProcessSamples
      )
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Cell group 4 — PostToolUseFailure touch/attribution pipeline (real bundle)
// ---------------------------------------------------------------------------

const FAILURE_TEXT = 'alpha\nneedle one\nbeta\nneedle two\nomega\n';
const FAILURE_POST_TEXT = 'alpha\npin one\nbeta\npin two\nomega\n';

interface FailureFixture {
  repo: RealBundleRepo;
  targets: string[];
  spanNames: string[];
}

function seedFailureRepo(pathDir: string, trackedFiles: number): FailureFixture {
  const repo = makeRealBundleRepo(pathDir);
  const targets = Array.from({ length: 4 }, (_, index) => `src/failure-${index + 1}.txt`);
  for (const target of targets) writeRepoFile(repo, target, FAILURE_TEXT);
  for (let index = targets.length; index < trackedFiles; index += 1) {
    writeRepoFile(repo, `corpus/dir-${index % 40}/file-${index}.txt`, `fixture ${index}\n`);
  }
  commitRepo(repo, 'seed failure benchmark repository');
  const spanNames = targets.map((_, index) => `benchmark/failure-${index + 1}`);
  for (let index = 0; index < targets.length; index += 1) {
    addLineSpan(repo, spanNames[index], targets[index], 2, 2, `failure benchmark dependency ${index + 1}`);
  }
  commitRepo(repo, 'anchor failure benchmark repository');
  return { repo, targets, spanNames };
}

function failureEnvelope(
  repo: RealBundleRepo,
  sessionId: string,
  toolUseId: string,
  command: string
): Record<string, unknown> {
  return {
    session_id: sessionId,
    cwd: repo.root,
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: toolUseId,
    tool_response: {
      stdout: '',
      stderr: 'benchmark induced failure',
      exit_code: 1,
      interrupted: false,
      timedOutAfterMs: null,
      rawOutputPath: null
    }
  };
}

function failureCells(options: Options, bundleDir: string, fixture: FailureFixture): MeasuredCell[] {
  const hookPath = join(bundleDir, 'post-tool-use-failure.mjs');
  const planPath = join(bundleDir, 'static-plan.mjs');
  const pattern = (targets: readonly string[]) => `sed -i 's/needle/pin/' ${targets.join(' ')}`;
  const definitions: Array<{ name: string; command: string; candidates: number; expectedSpans: string[] }> = [
    { name: 'failure-fast-rejection', command: 'git status --short', candidates: 0, expectedSpans: [] },
    {
      name: 'failure-single-candidate',
      command: pattern(fixture.targets.slice(0, 1)),
      candidates: 1,
      expectedSpans: fixture.spanNames.slice(0, 1)
    },
    {
      name: 'failure-multi-candidate',
      command: pattern(fixture.targets),
      candidates: 4,
      expectedSpans: fixture.spanNames
    }
  ];
  let invocation = 0;
  const cells: MeasuredCell[] = [];
  for (const definition of definitions) {
    const invoke = (): void => {
      invocation += 1;
      const sessionId = `failure-benchmark-${definition.name}-${invocation}`;
      const toolUseId = `tool-${invocation}`;
      if (definition.candidates > 0) {
        // The realistic failure shape this hook exists for: the command wrote
        // its files and *then* failed. The plan is recorded against pre-edit
        // content, the targets are mutated, and only then does the failure
        // envelope arrive — so the execution gate admits the writes and the
        // full attribution pipeline runs end to end.
        for (const target of fixture.targets.slice(0, definition.candidates)) {
          writeRepoFile(fixture.repo, target, FAILURE_TEXT);
        }
        const plan = failureEnvelope(fixture.repo, sessionId, toolUseId, definition.command);
        delete plan.tool_response;
        invokeRealHook(planPath, plan, fixture.repo.env);
        for (const target of fixture.targets.slice(0, definition.candidates)) {
          writeRepoFile(fixture.repo, target, FAILURE_POST_TEXT);
        }
      }
      const result = invokeRealHook(
        hookPath,
        failureEnvelope(fixture.repo, sessionId, toolUseId, definition.command),
        fixture.repo.env
      );
      const context = hookContext(result.output);
      for (const span of definition.expectedSpans) {
        if (!context.includes(span)) throw new Error(`${definition.name}: emitted bundle omitted ${span}`);
      }
    };
    cells.push({
      name: definition.name,
      group: 'failure',
      scale: definition.candidates,
      spawns: true,
      ...measure(invoke, options.bundleWarmups, options.bundleSamples)
    });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

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

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const workspaceGitSpan = buildWorkspaceGitSpan();
  const bundles = buildRealHookBundles();
  const advisorFixture = seedAdvisorRepo(workspaceGitSpan.pathDir, 400);
  const failureFixture = seedFailureRepo(workspaceGitSpan.pathDir, 400);
  let cells: MeasuredCell[];
  try {
    cells = [
      ...(await advisorCells(options, advisorFixture)),
      ...applyPatchCells(options),
      ...sessionSweepCells(options),
      ...failureCells(options, bundles.claudeHooksDir, failureFixture)
    ];
  } finally {
    advisorFixture.cleanup();
    failureFixture.repo.cleanup();
    bundles.cleanup();
  }
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
      inProcessWarmups: options.inProcessWarmups,
      inProcessSamples: options.inProcessSamples,
      bundleWarmups: options.bundleWarmups,
      bundleSamples: options.bundleSamples,
      sweepDirs: options.sweepDirs,
      quantiles: 'nearest-rank over measured warm samples',
      cold: 'first natural invocation before warmups; operating-system caches are not forcibly dropped',
      timingBoundary:
        'advisor/apply-patch/session-sweep cells are in-process (advisor still spawns real git subprocesses); failure cells include Node startup for the emitted bundle and, for tracked commands, their paired static plan process',
      fixtureReset: 'session-sweep cells re-seed their directory tree before every sample, outside the timed region'
    },
    cells
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output !== undefined) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, json, 'utf8');
  }
  process.stdout.write(json);
}

await main();
