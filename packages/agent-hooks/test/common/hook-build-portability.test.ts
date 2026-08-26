/**
 * Verifies that the unified compiler emits portable module markers and
 * byte-stable output through both physical and symlinked package paths.
 *
 * These tests build into a scratch directory (never the committed
 * plugins-claude/plugins-codex trees) using the exact same CLI invocations as
 * `build:hooks`/`build:hooks:codex`, so they fail in place inside any
 * worktree that reproduces the underlying symlink layout.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STATIC_PLAN_PRE_MATCHER as CLAUDE_STATIC_PLAN_PRE_MATCHER } from '../../src/claude/static-plan.js';
import { APPLY_PATCH_PLAN_MATCHER } from '../../src/codex/apply-patch-plan.js';
import { STATIC_POST_MATCHER } from '../../src/codex/post-tool-use.js';
import { STATIC_PLAN_PRE_MATCHER as CODEX_STATIC_PLAN_PRE_MATCHER } from '../../src/codex/static-plan.js';
import {
  addLineSpan,
  type BuiltRealHookBundles,
  buildRealHookBundles,
  buildWorkspaceGitSpan,
  commitRepo,
  emittedBundleNames,
  hookContext,
  invokeRealHook,
  makeRealBundleRepo,
  type RealBundleRepo,
  runRealShell,
  WORKSPACE_ROOT,
  writeRepoFile
} from '../real-bundle-helpers.js';
import { STATIC_ATTRIBUTION_CORPUS } from './fixtures/static-attribution-corpus.js';

function nodeModulesComments(generated: string): string[] {
  return [...generated.matchAll(/^\/\/ .*node_modules.*$/gm)].map((match) => match[0]);
}

/** The emitted hooks.json parsed from the built output directory. */
function readHooksJson(outDir: string): {
  hooks: Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]>;
  __generated?: { files: string[] };
} {
  return JSON.parse(readFileSync(join(outDir, 'hooks.json'), 'utf8')) as {
    hooks: Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]>;
    __generated?: { files: string[] };
  };
}

function groupBundle(group: { hooks: { command: string }[] }): string | undefined {
  return group.hooks[0]?.command.match(/([A-Za-z0-9-]+\.mjs)\b/)?.[1];
}

/**
 * The group whose hooks run the named bundle — hooks.json groups may carry a
 * matcher at group level; an unconstrained group has no matcher at all.
 */
function groupFor(
  out: ReturnType<typeof readHooksJson>,
  event: string,
  bundle: string
): { matcher?: string; hooks: { command: string; timeout?: number }[] } | null {
  const groups = out.hooks[event] ?? [];
  for (const group of groups) {
    if (group.hooks.some((h) => h.command.includes(bundle))) return group;
  }
  return null;
}

// Each test runs a real esbuild build through the yarn CLI; under concurrent
// load (e.g. sibling-worktree cargo builds during a full `yarn validate`) that
// exceeds vitest's 5s default, so give the builds real headroom.
const BUILD_TEST_TIMEOUT_MS = 30_000;

const REMOVED_SOURCE_PATHS = [
  'packages/agent-hooks/src/common/snapshot-core.ts',
  'packages/agent-hooks/src/common/snapshot-harness.ts',
  'packages/agent-hooks/src/common/snapshot-store.ts',
  'packages/agent-hooks/src/claude/snapshot.ts',
  'packages/agent-hooks/src/claude/activity-log.ts',
  'packages/agent-hooks/src/codex/snapshot.ts',
  'packages/agent-hooks/src/codex/activity-log.ts',
  'packages/agent-hooks/src/codex/subagent-stop.ts'
] as const;

const LEGACY_RUNTIME_MARKERS = [
  'snapshot-core',
  'snapshot-harness',
  'snapshot-store',
  'snapshot-recordless-note',
  'snapshot-index',
  'activity-log',
  'GIT_SPAN_SNAPSHOT_',
  'git-span.snapshot-',
  'ObservedWriteScope'
] as const;

describe('generated hook bin portability', () => {
  it('has physically removed every legacy source entrypoint and store', () => {
    for (const path of REMOVED_SOURCE_PATHS) expect(existsSync(join(WORKSPACE_ROOT, path)), path).toBe(false);
    const sourceRoot = join(WORKSPACE_ROOT, 'packages/agent-hooks/src');
    const activeSources = allPaths(sourceRoot).filter((path) => path.endsWith('.ts'));
    activeSources.push(join(WORKSPACE_ROOT, 'packages/agent-hooks/package.json'));
    for (const path of activeSources) {
      const content = readFileSync(path, 'utf8');
      for (const marker of LEGACY_RUNTIME_MARKERS) expect(content, `${path} contains ${marker}`).not.toContain(marker);
    }
  });

  it('emits unified package markers and byte-stable output through a symlinked package root', {
    timeout: BUILD_TEST_TIMEOUT_MS
  }, () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-hooks-build-portability-'));
    const linkedPackageRoot = join(root, 'linked-package');
    symlinkSync(join(WORKSPACE_ROOT, 'packages/agent-hooks'), linkedPackageRoot, 'dir');
    try {
      for (const [agent, input, relativeBundle, extraArgs] of [
        ['claude-code', 'src/claude/post-tool-use.ts', 'bin/post-tool-use.mjs', []],
        ['codex', 'src/codex/post-tool-use.ts', 'post-tool-use.mjs', ['--plugin-root']]
      ] as const) {
        const directOut = join(root, `${agent}-direct`);
        const linkedOut = join(root, `${agent}-linked`);
        const args = (outDir: string) => [
          'agent-hooks',
          '--agent',
          agent,
          '-i',
          input,
          '-o',
          join(outDir, 'hooks.json'),
          ...extraArgs
        ];
        execFileSync('yarn', args(directOut), {
          cwd: join(WORKSPACE_ROOT, 'packages/agent-hooks'),
          stdio: 'pipe'
        });
        execFileSync('yarn', args(linkedOut), { cwd: linkedPackageRoot, stdio: 'pipe' });

        const directBundle = readFileSync(join(directOut, relativeBundle), 'utf8');
        const linkedBundle = readFileSync(join(linkedOut, relativeBundle), 'utf8');
        expect(linkedBundle).toBe(directBundle);
        const comments = nodeModulesComments(directBundle);
        expect(comments).toContain('// node_modules/@goodfoot/agent-hooks/dist/core/logger.js');
        expect(comments.some((comment) => comment.includes(`/dist/agents/${agent}/`))).toBe(true);
        expect(comments.every((comment) => comment.startsWith('// node_modules/@goodfoot/agent-hooks/dist/'))).toBe(
          true
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['codex then claude-code', ['codex', 'claude-code']],
    ['claude-code then codex', ['claude-code', 'codex']],
    ['claude-code twice', ['claude-code', 'claude-code']],
    ['codex twice', ['codex', 'codex']]
  ])('rejects duplicate --agent selectors before compiling: %s', (_label, agents) => {
    const outDir = mkdtempSync(join(tmpdir(), 'agent-hooks-duplicate-agent-'));
    try {
      const result = spawnSync(
        process.execPath,
        [
          'scripts/hooks-cli-wrapper.js',
          '--agent',
          agents[0],
          '--agent',
          agents[1],
          '-i',
          'src/claude/session-start.ts',
          '-o',
          join(outDir, 'hooks.json')
        ],
        { cwd: join(WORKSPACE_ROOT, 'packages/agent-hooks'), encoding: 'utf8' }
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Usage: hooks-cli-wrapper.js');
      expect(existsSync(join(outDir, 'hooks.json'))).toBe(false);
      expect(readdirSync(outDir)).toEqual([]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['exact Codex then equals Claude', ['--agent', 'codex', '--agent=claude-code']],
    ['equals Codex then exact Claude', ['--agent=codex', '--agent', 'claude-code']]
  ])('rejects mixed exact and equals-form agent selectors before compiling: %s', (_label, selectors) => {
    const outDir = mkdtempSync(join(tmpdir(), 'agent-hooks-mixed-agent-'));
    try {
      const result = spawnSync(
        process.execPath,
        [
          'scripts/hooks-cli-wrapper.js',
          ...selectors,
          '-i',
          'src/claude/session-start.ts',
          '-o',
          join(outDir, 'hooks.json')
        ],
        { cwd: join(WORKSPACE_ROOT, 'packages/agent-hooks'), encoding: 'utf8' }
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Usage: hooks-cli-wrapper.js');
      expect(existsSync(join(outDir, 'hooks.json'))).toBe(false);
      expect(readdirSync(outDir)).toEqual([]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('emits only the authoritative Codex static planners with their matcher literals', {
    timeout: BUILD_TEST_TIMEOUT_MS
  }, () => {
    // main-213 round-3: the codex-hooks CLI extracts a hook's matcher only
    // from a STRING LITERAL initializer and silently leaves it undefined
    // otherwise. The registration must stay a literal textually identical to
    // the exported constants. Build the production entrypoint set so retained
    // snapshot/activity source cannot accidentally return to the manifest.
    const outDir = mkdtempSync(join(tmpdir(), 'agent-hooks-build-codex-matchers-'));
    try {
      execFileSync(
        'yarn',
        [
          'agent-hooks',
          '--agent',
          'codex',
          '-i',
          'src/codex/{session-start,advisor,static-plan,apply-patch-plan,post-tool-use,stop}.ts',
          '-o',
          join(outDir, 'hooks.json'),
          '--plugin-root'
        ],
        { stdio: 'pipe' }
      );
      const out = readHooksJson(outDir);
      expect(Object.keys(out.hooks)).toEqual(['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']);
      expect(groupFor(out, 'SessionStart', 'session-start.mjs')).not.toBeNull();
      expect(out.hooks['PreToolUse']?.map(groupBundle)).toEqual([
        'advisor.mjs',
        'static-plan.mjs',
        'apply-patch-plan.mjs'
      ]);
      const pre = groupFor(out, 'PreToolUse', 'static-plan.mjs');
      expect(pre, 'PreToolUse static-plan.mjs group must exist').not.toBeNull();
      expect(pre!.matcher, 'PreToolUse static-plan.mjs matcher must equal CODEX_STATIC_PLAN_PRE_MATCHER').toBe(
        CODEX_STATIC_PLAN_PRE_MATCHER
      );
      const applyPatch = groupFor(out, 'PreToolUse', 'apply-patch-plan.mjs');
      expect(applyPatch, 'PreToolUse apply-patch-plan.mjs group must exist').not.toBeNull();
      expect(applyPatch!.matcher).toBe(APPLY_PATCH_PLAN_MATCHER);
      const post = groupFor(out, 'PostToolUse', 'post-tool-use.mjs');
      expect(post, 'PostToolUse post-tool-use.mjs group must exist').not.toBeNull();
      expect(post!.matcher, 'PostToolUse post-tool-use.mjs matcher must equal STATIC_POST_MATCHER').toBe(
        STATIC_POST_MATCHER
      );
      expect(groupFor(out, 'PreToolUse', 'snapshot.mjs')).toBeNull();
      expect(groupFor(out, 'PreToolUse', 'activity-log.mjs')).toBeNull();
      expect(out.hooks['SubagentStop']).toBeUndefined();
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('emits every claude hook constrained to its matcher literal — the matcher is never dropped at build', {
    timeout: BUILD_TEST_TIMEOUT_MS
  }, () => {
    // main-213 round-3: the claude-code-hooks CLI extracts a hook's matcher
    // only from a STRING LITERAL initializer, exactly like the codex CLI —
    // an identifier reference silently emits an unconstrained hook that runs
    // for every tool occurrence. The claude registrations are literals today,
    // but the emitted constraints are load-bearing: a snapshot pre-walk or a
    // post hook on every tool occurrence would be catastrophic. This test
    // rebuilds the full claude bundle set (the same CLI invocation as
    // build:hooks) and pins every matcher, so a future refactor to
    // identifier matchers fails loudly here instead of silently unconstraining
    // the hooks.
    const outDir = mkdtempSync(join(tmpdir(), 'agent-hooks-build-claude-matchers-'));
    try {
      execFileSync(
        'yarn',
        [
          'agent-hooks',
          '--agent',
          'claude-code',
          '-i',
          'src/claude/{session-start,advisor,static-plan,post-tool-use,post-tool-use-failure,session-end}.ts',
          '-o',
          join(outDir, 'hooks.json')
        ],
        { stdio: 'pipe' }
      );
      const out = readHooksJson(outDir);
      expect(Object.keys(out.hooks)).toEqual([
        'SessionStart',
        'PreToolUse',
        'PostToolUse',
        'PostToolUseFailure',
        'SessionEnd'
      ]);
      expect(groupFor(out, 'SessionStart', 'session-start.mjs')).not.toBeNull();
      expect(
        out.hooks['PreToolUse']?.[0]?.hooks.map(({ command }) => command.match(/([A-Za-z0-9-]+\.mjs)\b/)?.[1])
      ).toEqual(['advisor.mjs', 'static-plan.mjs']);
      expect(out.__generated?.files).toEqual([
        'session-start.mjs',
        'advisor.mjs',
        'static-plan.mjs',
        'post-tool-use.mjs',
        'post-tool-use-failure.mjs',
        'session-end.mjs'
      ]);
      const expected: [string, string, string][] = [
        ['PreToolUse', 'static-plan.mjs', CLAUDE_STATIC_PLAN_PRE_MATCHER],
        ['PreToolUse', 'advisor.mjs', 'Bash'],
        ['PostToolUse', 'post-tool-use.mjs', 'Read|Edit|Write|Bash'],
        ['PostToolUseFailure', 'post-tool-use-failure.mjs', 'Bash']
      ];
      for (const [event, bundle, matcher] of expected) {
        const group = groupFor(out, event, bundle);
        expect(group, `${event} ${bundle} group must exist`).not.toBeNull();
        expect(group!.matcher, `${event} ${bundle} matcher must be '${matcher}'`).toBe(matcher);
      }
      expect(groupFor(out, 'PreToolUse', 'snapshot.mjs')).toBeNull();
      expect(groupFor(out, 'PreToolUse', 'activity-log.mjs')).toBeNull();
      // main-359: the wrapper converts registration timeouts from ms to
      // seconds at emit — Claude Code reads the field as seconds ("Seconds
      // before canceling"), so a verbatim 10_000 would register a ~2.8-hour
      // ceiling instead of ~10s. Pin every converted value so a wrapper
      // regression fails loudly here.
      expect(groupFor(out, 'SessionStart', 'session-start.mjs')?.hooks[0]?.timeout).toBe(1);
      for (const [event, bundle] of [
        ['PreToolUse', 'advisor.mjs'],
        ['PreToolUse', 'static-plan.mjs'],
        ['PostToolUse', 'post-tool-use.mjs'],
        ['PostToolUseFailure', 'post-tool-use-failure.mjs'],
        ['SessionEnd', 'session-end.mjs']
      ] as const) {
        expect(groupFor(out, event, bundle)?.hooks[0]?.timeout, `${event} ${bundle} timeout`).toBe(10);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

// The installed-artifact smoke builds the workspace git-span binary under
// the shared cargo target lock, so its wall time includes queueing behind
// the Rust workspaces' own builds when `yarn test` runs seven workspaces in
// parallel — observed legitimate waits exceed 180s, which failed beforeAll
// without any check having run. 600s bounds a runaway build, not the queue.
const INSTALLED_SMOKE_TIMEOUT_MS = 600_000;
const FIVE_LINES = 'alpha\nneedle one\nbeta\nneedle two\nomega\n';

function corpusCommand(name: string): string {
  const fixture = STATIC_ATTRIBUTION_CORPUS.find((entry) => entry.name === name);
  if (fixture === undefined) throw new Error(`missing static attribution corpus fixture: ${name}`);
  return fixture.command;
}

function seedInstalledSmokeRepo(repo: RealBundleRepo): void {
  for (const path of [
    'cases/deterministic.txt',
    'cases/loop-a.txt',
    'cases/loop-b.txt',
    'cases/sed.txt',
    'cases/perl.txt',
    'cases/python.txt',
    'cases/node.txt',
    'cases/tracked.txt',
    'cases/dynamic.txt',
    'cases/generator.txt',
    'cases/later-write.txt',
    'cases/later-read.txt',
    'cases/short-circuit.txt',
    'cases/interrupted.txt',
    'cases/failure.txt'
  ]) {
    writeRepoFile(repo, path, FIVE_LINES);
  }
  writeRepoFile(repo, 'generator.sh', "#!/usr/bin/env bash\nprintf 'generated\\n' > cases/generator.txt\n", true);
  commitRepo(repo, 'seed installed artifact smoke');

  const spans: Array<[string, string, number, number]> = [
    ['smoke/deterministic', 'cases/deterministic.txt', 3, 3],
    ['smoke/loop-a', 'cases/loop-a.txt', 2, 2],
    ['smoke/loop-b', 'cases/loop-b.txt', 2, 2],
    ['smoke/sed-first', 'cases/sed.txt', 2, 2],
    ['smoke/sed-second', 'cases/sed.txt', 4, 4],
    ['smoke/sed-decoy', 'cases/sed.txt', 5, 5],
    ['smoke/perl', 'cases/perl.txt', 2, 4],
    ['smoke/perl-decoy', 'cases/perl.txt', 5, 5],
    ['smoke/python', 'cases/python.txt', 3, 3],
    ['smoke/python-decoy', 'cases/python.txt', 5, 5],
    ['smoke/node', 'cases/node.txt', 3, 3],
    ['smoke/node-decoy', 'cases/node.txt', 5, 5],
    ['smoke/tracked', 'cases/tracked.txt', 1, 5],
    ['smoke/dynamic', 'cases/dynamic.txt', 1, 5],
    ['smoke/generator', 'cases/generator.txt', 1, 5],
    ['smoke/later-write', 'cases/later-write.txt', 1, 5],
    ['smoke/later-read', 'cases/later-read.txt', 4, 4],
    ['smoke/short-circuit', 'cases/short-circuit.txt', 3, 3],
    ['smoke/interrupted', 'cases/interrupted.txt', 3, 3],
    ['smoke/failure', 'cases/failure.txt', 3, 3]
  ];
  for (const [name, path, start, end] of spans) addLineSpan(repo, name, path, start, end);
  commitRepo(repo, 'anchor installed artifact smoke spans');
  execFileSync('git', ['branch', 'topic'], { cwd: repo.root, env: repo.env, stdio: 'pipe' });
}

interface InstalledCommandCase {
  readonly name: string;
  readonly command: string;
  readonly expected: readonly string[];
  readonly excluded?: readonly string[];
  readonly interrupted?: boolean;
}

function installedCommandCases(): readonly InstalledCommandCase[] {
  return [
    {
      name: 'deterministic numeric sed',
      command: corpusCommand('deterministic numeric sed control').replaceAll('src/a.txt', 'cases/deterministic.txt'),
      expected: ['smoke/deterministic']
    },
    {
      name: 'literal loop',
      command: corpusCommand('literal-list loop expands completely')
        .replaceAll('src/a.txt', 'cases/loop-a.txt')
        .replaceAll('src/b.txt', 'cases/loop-b.txt'),
      expected: ['smoke/loop-a', 'smoke/loop-b']
    },
    {
      name: 'ambiguous sed range union',
      command: corpusCommand('pattern sed widens across ambiguous matches').replaceAll('src/a.txt', 'cases/sed.txt'),
      expected: ['smoke/sed-first', 'smoke/sed-second'],
      excluded: ['smoke/sed-decoy']
    },
    {
      name: 'perl bounded substitution',
      command: corpusCommand('perl pi literal substitution').replaceAll('src/a.txt', 'cases/perl.txt'),
      expected: ['smoke/perl'],
      excluded: ['smoke/perl-decoy']
    },
    {
      name: 'python bounded dataflow',
      command: corpusCommand('python literal replace').replaceAll('src/a.txt', 'cases/python.txt'),
      expected: ['smoke/python'],
      excluded: ['smoke/python-decoy']
    },
    {
      name: 'node bounded dataflow',
      command: corpusCommand('node literal replace').replaceAll('src/a.txt', 'cases/node.txt'),
      expected: ['smoke/node'],
      excluded: ['smoke/node-decoy']
    },
    {
      name: 'tracked and untracked pair',
      command: corpusCommand('tracked and untracked pair retains only tracked eligibility')
        .replaceAll('src/a.txt', 'cases/tracked.txt')
        .replaceAll('scratch.txt', 'cases/untracked.txt'),
      expected: ['smoke/tracked']
    },
    {
      name: 'write before a later response-derived read',
      command: "printf '%s\\n' alpha changed beta > cases/later-write.txt",
      expected: ['smoke/later-write']
    },
    {
      name: 'response-derived later read',
      command: 'rg -n \'needle two\' "__REPO__/cases/later-read.txt"',
      expected: ['smoke/later-read']
    },
    {
      name: 'short-circuited write',
      command: "false && sed -i '3s/beta/BETA/' cases/short-circuit.txt",
      expected: []
    },
    {
      name: 'completed substitution before failure',
      command: "sed -i 's/beta/BETA/' cases/failure.txt; false",
      expected: ['smoke/failure']
    },
    {
      name: 'interrupted command',
      command: "sed -i '3s/beta/BETA/' cases/interrupted.txt",
      expected: [],
      interrupted: true
    },
    {
      name: 'dynamic path rejection',
      command: corpusCommand('node computed target is rejected').replaceAll('src/a.txt', 'cases/dynamic.txt'),
      expected: []
    },
    {
      name: 'history operation stays silent',
      command: corpusCommand('history-changing merge stays silent'),
      expected: []
    },
    { name: 'arbitrary generator stays silent', command: './generator.sh', expected: [] }
  ];
}

function hookEnvelope(
  host: 'claude' | 'codex',
  repo: RealBundleRepo,
  sessionId: string,
  toolUseId: string,
  command: string,
  response?: { stdout: string; stderr: string; exitCode: number; interrupted: boolean }
): Record<string, unknown> {
  return {
    session_id: sessionId,
    cwd: repo.root,
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: toolUseId,
    ...(response === undefined
      ? {}
      : {
          tool_response:
            host === 'claude'
              ? {
                  stdout: response.stdout,
                  stderr: response.stderr,
                  exit_code: response.exitCode,
                  interrupted: response.interrupted,
                  timedOutAfterMs: null,
                  rawOutputPath: null
                }
              : {
                  stdout: response.stdout,
                  stderr: response.stderr,
                  exitCode: response.exitCode,
                  interrupted: response.interrupted,
                  timedOutAfterMs: null
                },
          ...(response.interrupted ? { is_interrupt: true } : {})
        })
  };
}

function runInstalledHostMatrix(host: 'claude' | 'codex', hooksDir: string, repo: RealBundleRepo): void {
  const sessionId = `installed-${host}`;
  for (const [index, fixture] of installedCommandCases().entries()) {
    const toolUseId = `tool-${index}`;
    const command = fixture.command.replaceAll('__REPO__', repo.root);
    const runPipeline = (id: string): string => {
      const pre = hookEnvelope(host, repo, id, toolUseId, command);
      invokeRealHook(join(hooksDir, 'static-plan.mjs'), pre, repo.env);
      const shell = runRealShell(repo, command);
      const response = { ...shell, interrupted: fixture.interrupted === true };
      const post = hookEnvelope(host, repo, id, toolUseId, command, response);
      const bundle = host === 'claude' && shell.exitCode !== 0 ? 'post-tool-use-failure.mjs' : 'post-tool-use.mjs';
      return hookContext(invokeRealHook(join(hooksDir, bundle), post, repo.env).output);
    };
    let context = runPipeline(sessionId);
    // Under the root foreach harness a real `git span` child inside the
    // emitted bundles can starve past its production budget and fail its
    // invocation open, which surfaces here as an empty context — on pristine
    // baselines too, so it is harness contention, not bundle breakage.
    // One retried trial with fresh session state (the memo suppresses a
    // repeat emission within one session); only empty on BOTH trials fails.
    if (fixture.expected.length > 0 && context === '') context = runPipeline(`${sessionId}-retry`);
    for (const name of fixture.expected) expect(context, `${host}: ${fixture.name}`).toContain(name);
    for (const name of fixture.excluded ?? []) expect(context, `${host}: ${fixture.name}`).not.toContain(name);
    if (fixture.expected.length === 0) expect(context, `${host}: ${fixture.name}`).toBe('');
  }
}

function runCodexApplyPatchSmoke(hooksDir: string, repo: RealBundleRepo): void {
  writeRepoFile(repo, 'cases/apply-patch.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n');
  commitRepo(repo, 'seed apply patch smoke');
  addLineSpan(repo, 'smoke/apply-target', 'cases/apply-patch.txt', 3, 3);
  addLineSpan(repo, 'smoke/apply-decoy', 'cases/apply-patch.txt', 8, 8);
  commitRepo(repo, 'anchor apply patch smoke spans');

  const command = [
    '*** Begin Patch',
    '*** Update File: cases/apply-patch.txt',
    '@@',
    '-three',
    '+THREE',
    '*** End Patch'
  ].join('\n');
  const envelope = {
    session_id: 'installed-codex-apply',
    cwd: repo.root,
    tool_name: 'apply_patch',
    tool_input: { command },
    tool_use_id: 'apply-1'
  };
  invokeRealHook(join(hooksDir, 'apply-patch-plan.mjs'), envelope, repo.env);
  writeRepoFile(repo, 'cases/apply-patch.txt', 'one\ntwo\nTHREE\nfour\nfive\nsix\nseven\neight\nnine\nten\n');
  const result = invokeRealHook(
    join(hooksDir, 'post-tool-use.mjs'),
    {
      ...envelope,
      tool_response: {
        stdout: 'Success. Updated the following files:\nM cases/apply-patch.txt\n',
        stderr: '',
        exitCode: 0
      }
    },
    repo.env
  );
  const context = hookContext(result.output);
  expect(context).toContain('smoke/apply-target');
  expect(context).not.toContain('smoke/apply-decoy');
}

function allPaths(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      out.push(path);
      if (lstatSync(path).isDirectory()) visit(path);
    }
  };
  visit(root);
  return out;
}

function runtimeServiceSockets(): Set<string> {
  const uid = process.getuid?.();
  if (uid === undefined) return new Set();
  const root = join('/tmp', `git-span-${uid}`, 'context');
  if (!existsSync(root)) return new Set();
  return new Set(allPaths(root).filter((path) => lstatSync(path).isSocket()));
}

function assertNoLegacyRuntimeArtifacts(repo: RealBundleRepo, socketsBefore: Set<string>): void {
  const paths = [...allPaths(repo.home), ...allPaths(repo.root)].map((path) => path.replaceAll('\\', '/'));
  const forbidden = paths.filter((path) =>
    /(?:snapshots|snapshot-recordless-note|activity-log|\.objects(?:\/|$)|\.index$|tombstone|watcher|\.sock$|socket)/i.test(
      path
    )
  );
  expect(forbidden).toEqual([]);
  expect(paths.filter((path) => lstatSync(path).isSocket())).toEqual([]);

  const contextSocket = /\/tmp\/git-span-\d+\/context\/[a-f0-9]{16}\/service\.sock$/;
  const sockets = [...runtimeServiceSockets()].filter((path) => !socketsBefore.has(path));
  expect(sockets.length).toBeGreaterThan(0);
  expect(sockets.every((path) => contextSocket.test(path.replaceAll('\\', '/')))).toBe(true);
}

function assertNoLegacyBundleCode(dir: string): void {
  const files = readdirSync(dir).filter((name) => name.endsWith('.mjs') || name === 'hooks.json');
  for (const name of files) {
    const content = readFileSync(join(dir, name), 'utf8');
    for (const marker of LEGACY_RUNTIME_MARKERS) expect(content, `${name} contains ${marker}`).not.toContain(marker);
  }
}

describe('emitted hook diagnostics', () => {
  let bundles: BuiltRealHookBundles;

  beforeAll(() => {
    bundles = buildRealHookBundles();
  }, BUILD_TEST_TIMEOUT_MS);

  afterAll(() => bundles?.cleanup());

  it.each([
    ['Claude', () => bundles.claudeHooksDir],
    ['Codex', () => bundles.codexHooksDir]
  ])('%s emitted hook writes JSONL diagnostics through AGENT_HOOKS_LOG_FILE', (_host, hooksDir) => {
    const logPath = join(bundles.root, `${String(_host).toLowerCase()}-diagnostics.jsonl`);
    invokeRealHook(
      join(hooksDir(), 'static-plan.mjs'),
      {
        session_id: `logging-${String(_host).toLowerCase()}`,
        cwd: join(bundles.root, 'missing-repository'),
        tool_name: 'Bash',
        tool_input: { command: 'rm file.ts' },
        tool_use_id: 'logging-witness'
      },
      { ...process.env, AGENT_HOOKS_LOG_FILE: logPath }
    );
    const records = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { message?: unknown });
    expect(records.length).toBeGreaterThan(0);
    expect(records.some(({ message }) => typeof message === 'string' && message.length > 0)).toBe(true);
  });
});

describe('mandatory installed-artifact static attribution smoke', () => {
  let bundles: BuiltRealHookBundles;
  let pathDir: string;

  beforeAll(() => {
    bundles = buildRealHookBundles();
    pathDir = buildWorkspaceGitSpan().pathDir;
  }, INSTALLED_SMOKE_TIMEOUT_MS);

  afterAll(() => bundles?.cleanup());

  it('emits only the expected real hook inventory without snapshot or activity entrypoints', {
    timeout: INSTALLED_SMOKE_TIMEOUT_MS
  }, () => {
    expect(emittedBundleNames(bundles.claudeHooksDir)).toEqual([
      'advisor.mjs',
      'post-tool-use-failure.mjs',
      'post-tool-use.mjs',
      'session-end.mjs',
      'session-start.mjs',
      'static-plan.mjs'
    ]);
    expect(emittedBundleNames(bundles.codexHooksDir)).toEqual([
      'advisor.mjs',
      'apply-patch-plan.mjs',
      'post-tool-use.mjs',
      'session-start.mjs',
      'static-plan.mjs',
      'stop.mjs'
    ]);
    for (const names of [emittedBundleNames(bundles.claudeHooksDir), emittedBundleNames(bundles.codexHooksDir)]) {
      expect(names).not.toContain('snapshot.mjs');
      expect(names).not.toContain('activity-log.mjs');
      expect(names).not.toContain('subagent-stop.mjs');
    }
    assertNoLegacyBundleCode(bundles.claudeHooksDir);
    assertNoLegacyBundleCode(bundles.codexHooksDir);
  });

  it('executes the emitted Claude tree against the shared static-intent matrix and workspace git-span', {
    timeout: INSTALLED_SMOKE_TIMEOUT_MS
  }, () => {
    const repo = makeRealBundleRepo(pathDir);
    const socketsBefore = runtimeServiceSockets();
    try {
      seedInstalledSmokeRepo(repo);
      runInstalledHostMatrix('claude', bundles.claudeHooksDir, repo);
      assertNoLegacyRuntimeArtifacts(repo, socketsBefore);
    } finally {
      repo.cleanup();
    }
  });

  it('executes the emitted Codex tree, including hunk-precise apply_patch, without legacy runtime state', {
    timeout: INSTALLED_SMOKE_TIMEOUT_MS
  }, () => {
    const repo = makeRealBundleRepo(pathDir);
    const socketsBefore = runtimeServiceSockets();
    try {
      seedInstalledSmokeRepo(repo);
      runInstalledHostMatrix('codex', bundles.codexHooksDir, repo);
      runCodexApplyPatchSmoke(bundles.codexHooksDir, repo);
      assertNoLegacyRuntimeArtifacts(repo, socketsBefore);
    } finally {
      repo.cleanup();
    }
  });
});
