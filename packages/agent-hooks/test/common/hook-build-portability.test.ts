/**
 * Reproduces main-164: `build:hooks`/`build:hooks:codex` bundles
 * `@goodfoot/claude-code-hooks`/`@goodfoot/codex-hooks` from `node_modules`
 * via esbuild. Whenever that package resolves through a symlink into a
 * differently-nested shared install -- true of every Cards worktree, whose
 * own `node_modules` symlinks back to the main workspace's install -- esbuild
 * dereferences the symlink to its realpath before computing the `//`
 * module-boundary comment it writes above each bundled module, anchoring the
 * comment to that realpath's absolute location with a worktree-depth-
 * dependent number of `../` segments instead of the short, portable relative
 * form committed under plugins-claude/plugins-codex.
 *
 * These tests build into a scratch directory (never the committed
 * plugins-claude/plugins-codex trees) using the exact same CLI invocations as
 * `build:hooks`/`build:hooks:codex`, so they fail in place inside any
 * worktree that reproduces the underlying symlink layout.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATIC_PLAN_PRE_MATCHER as CLAUDE_STATIC_PLAN_PRE_MATCHER } from '../../src/claude/static-plan.js';
import { APPLY_PATCH_PLAN_MATCHER } from '../../src/codex/apply-patch-plan.js';
import { STATIC_POST_MATCHER } from '../../src/codex/post-tool-use.js';
import { STATIC_PLAN_PRE_MATCHER as CODEX_STATIC_PLAN_PRE_MATCHER } from '../../src/codex/static-plan.js';

function nodeModulesComments(generated: string): string[] {
  return [...generated.matchAll(/^\/\/ .*node_modules.*$/gm)].map((match) => match[0]);
}

/** The emitted hooks.json parsed from the built output directory. */
function readHooksJson(outDir: string): {
  hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
} {
  return JSON.parse(readFileSync(join(outDir, 'hooks.json'), 'utf8')) as {
    hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  };
}

/**
 * The group whose hooks run the named bundle — hooks.json groups may carry a
 * matcher at group level; an unconstrained group has no matcher at all.
 */
function groupFor(out: ReturnType<typeof readHooksJson>, event: string, bundle: string): { matcher?: string } | null {
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

describe('generated hook bin portability', () => {
  it('anchors claude-code-hooks node_modules imports to the short, worktree-independent relative form', {
    timeout: BUILD_TEST_TIMEOUT_MS
  }, () => {
    const outDir = mkdtempSync(join(tmpdir(), 'agent-hooks-build-claude-'));
    try {
      execFileSync(
        'yarn',
        ['claude-code-hooks', '-i', 'src/claude/post-tool-use.ts', '-o', join(outDir, 'hooks.json')],
        { stdio: 'pipe' }
      );
      const generated = readFileSync(join(outDir, 'bin', 'post-tool-use.mjs'), 'utf8');
      const comments = nodeModulesComments(generated);
      expect(comments.length).toBeGreaterThan(0);
      for (const comment of comments) {
        expect(comment).toMatch(/^\/\/ \.\.\/\.\.\/node_modules\/@goodfoot\/claude-code-hooks\/dist\/.+\.js$/);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('anchors codex-hooks node_modules imports to the short, worktree-independent relative form', {
    timeout: BUILD_TEST_TIMEOUT_MS
  }, () => {
    const outDir = mkdtempSync(join(tmpdir(), 'agent-hooks-build-codex-'));
    try {
      execFileSync(
        'yarn',
        ['codex-hooks', '-i', 'src/codex/post-tool-use.ts', '-o', join(outDir, 'hooks.json'), '--plugin-root'],
        { stdio: 'pipe' }
      );
      const generated = readFileSync(join(outDir, 'post-tool-use.mjs'), 'utf8');
      const comments = nodeModulesComments(generated);
      expect(comments.length).toBeGreaterThan(0);
      for (const comment of comments) {
        expect(comment).toMatch(/^\/\/ \.\.\/\.\.\/node_modules\/@goodfoot\/codex-hooks\/dist\/.+\.js$/);
      }
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
          'codex-hooks',
          '-i',
          'src/codex/{advisor,static-plan,apply-patch-plan,post-tool-use,stop,subagent-stop}.ts',
          '-o',
          join(outDir, 'hooks.json'),
          '--plugin-root'
        ],
        { stdio: 'pipe' }
      );
      const out = readHooksJson(outDir);
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
          'claude-code-hooks',
          '-i',
          'src/claude/{advisor,static-plan,post-tool-use,post-tool-use-failure,session-end}.ts',
          '-o',
          join(outDir, 'hooks.json')
        ],
        { stdio: 'pipe' }
      );
      const out = readHooksJson(outDir);
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
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('builds mini-swe with the inherited static planner and no snapshot entrypoint', {
    timeout: BUILD_TEST_TIMEOUT_MS
  }, () => {
    const outDir = mkdtempSync(join(tmpdir(), 'agent-hooks-build-mswea-matchers-'));
    try {
      execFileSync(
        'yarn',
        [
          'claude-code-hooks',
          '-i',
          'src/mswea/{advisor,static-plan,post-tool-use,post-tool-use-failure,session-end}.ts',
          '-o',
          join(outDir, 'hooks.json')
        ],
        { stdio: 'pipe' }
      );
      const out = readHooksJson(outDir);
      expect(groupFor(out, 'PreToolUse', 'static-plan.mjs')?.matcher).toBe('Bash');
      expect(groupFor(out, 'PostToolUse', 'post-tool-use.mjs')?.matcher).toBe('Read|Edit|Write|Bash');
      expect(groupFor(out, 'PostToolUseFailure', 'post-tool-use-failure.mjs')?.matcher).toBe('Bash');
      expect(groupFor(out, 'PreToolUse', 'snapshot.mjs')).toBeNull();
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
