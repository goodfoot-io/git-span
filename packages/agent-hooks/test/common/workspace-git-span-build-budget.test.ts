/**
 * Guards the second acceptance clause of main-390-1: a test-lifecycle build
 * that cannot fit its budget must fail with a diagnosis naming shared-cache
 * cross-workspace fingerprint invalidation, never die as a bare timeout.
 *
 * The installed-artifact smoke builds the workspace git-span binary inside a
 * vitest `beforeAll` whose hook budget bounds runaway builds. When a sibling
 * card worktree built into the shared cargo volume last, every local unit is
 * fingerprint-dirty (`RerunIfChangedOutputPathsChanged` names the sibling's
 * absolute paths) and the build pays a full local-graph rebuild before the
 * bundles and fixtures even start. A bare abort there looks like the card's
 * fault; the helper must convert an over-budget build into an error that
 * names the cache state, the measured elapsed time, and the remediation.
 *
 * The injected `command` is a long-running no-op: it makes the kill
 * deterministic on every machine while keeping the gate hermetic — no real
 * cargo is spawned, so nothing relinks the shared `debug/git-span` underneath
 * concurrently-running portability suites, and the orphan left by the kill is
 * a harmless sleep instead of a build.
 */
import { describe, expect, it } from 'vitest';
import { buildWorkspaceGitSpan } from '../real-bundle-helpers.js';

describe('workspace git-span build budget watchdog', () => {
  it('diagnoses shared-cache fingerprint invalidation instead of aborting silently when over budget', () => {
    let caught: unknown;
    try {
      buildWorkspaceGitSpan({ budgetMs: 1, command: ['sleep', '30'] });
    } catch (error) {
      caught = error;
    }
    const message = caught instanceof Error ? caught.message : `no diagnostic thrown (${String(caught)})`;
    expect(caught instanceof Error, `over-budget build must throw a diagnostic, got: ${message}`).toBe(true);
    expect(message).toMatch(/fingerprint|invalidat/i);
    expect(message).toMatch(/tripwire|cleanup-stale|GIT_SPAN_CARGO_TARGET_ROOT/i);
    expect(message).toMatch(/\d+(\.\d+)?s/);
  });
});
