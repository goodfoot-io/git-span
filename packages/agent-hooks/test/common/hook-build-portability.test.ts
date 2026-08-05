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
import { SNAPSHOT_POST_MATCHER } from '../../src/codex/post-tool-use.js';
import { SNAPSHOT_PRE_MATCHER } from '../../src/codex/snapshot.js';

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

  it('emits the codex snapshot hooks with their matcher literals — the matcher is never dropped at build', {
    timeout: BUILD_TEST_TIMEOUT_MS
  }, () => {
    // main-213 round-3: the codex-hooks CLI extracts a hook's matcher only
    // from a STRING LITERAL initializer and silently leaves it undefined
    // otherwise. Both snapshot hooks used to register identifier references,
    // so the emitted hooks.json carried NO matcher and every tool occurrence
    // ran them. The registration must stay a literal textually identical to
    // the exported constants — this test rebuilds the full codex bundle set
    // (the same CLI invocation as build:hooks:codex) and fails loudly if the
    // emitted matcher is missing or diverges from the constants.
    const outDir = mkdtempSync(join(tmpdir(), 'agent-hooks-build-codex-matchers-'));
    try {
      execFileSync(
        'yarn',
        ['codex-hooks', '-i', 'src/codex/**/*.ts', '-o', join(outDir, 'hooks.json'), '--plugin-root'],
        { stdio: 'pipe' }
      );
      const out = readHooksJson(outDir);
      const pre = groupFor(out, 'PreToolUse', 'snapshot.mjs');
      expect(pre, 'PreToolUse snapshot.mjs group must exist').not.toBeNull();
      expect(pre!.matcher, 'PreToolUse snapshot.mjs matcher must equal SNAPSHOT_PRE_MATCHER').toBe(
        SNAPSHOT_PRE_MATCHER
      );
      const post = groupFor(out, 'PostToolUse', 'post-tool-use.mjs');
      expect(post, 'PostToolUse post-tool-use.mjs group must exist').not.toBeNull();
      expect(post!.matcher, 'PostToolUse post-tool-use.mjs matcher must equal SNAPSHOT_POST_MATCHER').toBe(
        SNAPSHOT_POST_MATCHER
      );
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
      execFileSync('yarn', ['claude-code-hooks', '-i', 'src/claude/**/*.ts', '-o', join(outDir, 'hooks.json')], {
        stdio: 'pipe'
      });
      const out = readHooksJson(outDir);
      const expected: [string, string, string][] = [
        ['PreToolUse', 'snapshot.mjs', 'Bash'],
        ['PreToolUse', 'advisor.mjs', 'Bash'],
        ['PreToolUse', 'activity-log.mjs', 'Edit|Write|apply_patch'],
        ['PostToolUse', 'post-tool-use.mjs', 'Read|Edit|Write|Bash'],
        ['PostToolUseFailure', 'post-tool-use-failure.mjs', 'Bash']
      ];
      for (const [event, bundle, matcher] of expected) {
        const group = groupFor(out, event, bundle);
        expect(group, `${event} ${bundle} group must exist`).not.toBeNull();
        expect(group!.matcher, `${event} ${bundle} matcher must be '${matcher}'`).toBe(matcher);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
