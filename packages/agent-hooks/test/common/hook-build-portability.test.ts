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

function nodeModulesComments(generated: string): string[] {
  return [...generated.matchAll(/^\/\/ .*node_modules.*$/gm)].map((match) => match[0]);
}

describe('generated hook bin portability', () => {
  it('anchors claude-code-hooks node_modules imports to the short, worktree-independent relative form', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'agent-hooks-build-claude-'));
    try {
      execFileSync(
        'yarn',
        ['claude-code-hooks', '-i', 'src/claude/pre-tool-use.ts', '-o', join(outDir, 'hooks.json')],
        { stdio: 'pipe' }
      );
      const generated = readFileSync(join(outDir, 'bin', 'pre-tool-use.mjs'), 'utf8');
      const comments = nodeModulesComments(generated);
      expect(comments.length).toBeGreaterThan(0);
      for (const comment of comments) {
        expect(comment).toMatch(/^\/\/ \.\.\/\.\.\/node_modules\/@goodfoot\/claude-code-hooks\/dist\/.+\.js$/);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('anchors codex-hooks node_modules imports to the short, worktree-independent relative form', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'agent-hooks-build-codex-'));
    try {
      execFileSync(
        'yarn',
        ['codex-hooks', '-i', 'src/codex/pre-tool-use.ts', '-o', join(outDir, 'hooks.json'), '--plugin-root'],
        { stdio: 'pipe' }
      );
      const generated = readFileSync(join(outDir, 'pre-tool-use.mjs'), 'utf8');
      const comments = nodeModulesComments(generated);
      expect(comments.length).toBeGreaterThan(0);
      for (const comment of comments) {
        expect(comment).toMatch(/^\/\/ \.\.\/\.\.\/node_modules\/@goodfoot\/codex-hooks\/dist\/.+\.js$/);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
