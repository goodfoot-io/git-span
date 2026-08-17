/**
 * Update-check suppression env contract (main-246): every hook entry point —
 * the ten sources wired by `plugins-claude/git-span/hooks/hooks.json` and
 * `plugins-codex/git-span/hooks/hooks.json` — sets
 * `GIT_SPAN_DISABLE_UPDATE_CHECK=1` at module scope, before any executor can
 * run. The assertion is ordering-sensitive by construction: each entry module
 * is imported (which registers its default export via the hook factory) and
 * the var is checked immediately after — a handler-body set would leave the
 * var unset at that point. The env var is the explicit suppression layer of
 * git-span's fail-closed design; the non-TTY/machine-output structural layer
 * is the backstop, and neither alone is sufficient.
 */

import { describe, expect, it, vi } from 'vitest';

const SUPPRESSION_VAR = 'GIT_SPAN_DISABLE_UPDATE_CHECK';

/** The ten hook entry points wired into the two plugin hook manifests. */
const ENTRY_MODULES = [
  '../../src/claude/advisor.js',
  '../../src/claude/static-plan.js',
  '../../src/claude/post-tool-use.js',
  '../../src/claude/post-tool-use-failure.js',
  '../../src/claude/session-end.js',
  '../../src/codex/advisor.js',
  '../../src/codex/static-plan.js',
  '../../src/codex/apply-patch-plan.js',
  '../../src/codex/post-tool-use.js',
  '../../src/codex/stop.js'
] as const;

describe('update-check suppression env contract', () => {
  it('every hook entry point sets the suppression var at module scope', async () => {
    for (const entry of ENTRY_MODULES) {
      // Reset the module registry and the var before each import: entry
      // files import each other (`codex/static-plan` pulls in
      // `codex/post-tool-use`), so a plain re-import would return a cached
      // module whose scope does not re-run. A fresh registry makes the
      // assertion satisfiable only by that module's own module-scope set.
      vi.resetModules();
      delete process.env[SUPPRESSION_VAR];
      await import(entry);
      expect(process.env[SUPPRESSION_VAR], entry).toBe('1');
    }
  });
});
