/**
 * Pure-unit coverage for `spanViewer/gitRepository.ts` -- the session-wide
 * memoization of the `vscode.git` initialization outcome, including its
 * negative (timed-out / absent-extension) results, and the fallback-pane
 * message that surfaces the concrete failure reason.
 *
 * Runs under vitest with a hand-rolled `vscode` mock -- no Electron, no
 * extension host. The electron-globbed mocha suite under `test/suite/` never
 * compiles or runs this file (`build-testing.js` globs `test/suite/**`).
 *
 * @summary Unit tests for spanViewer/gitRepository memoization.
 * @module test/unit/gitRepository.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

/**
 * Mirrors the private `GIT_INITIALIZED_TIMEOUT_MS` in the module under test;
 * a mismatch fails the timing assertions below rather than silently passing.
 */
const INIT_TIMEOUT_MS = 5000;

/** Timeout rejection text produced by `waitForInitializedState`; asserted verbatim-in-part. */
const TIMEOUT_REASON = `vscode.git state did not become 'initialized' within ${INIT_TIMEOUT_MS}ms; git extension disabled or failed to initialize`;

type StateListener = (state: 'uninitialized' | 'initialized') => void;

/**
 * The `vscode` surface `gitRepository.ts` touches, plus the seams these
 * tests drive: extension presence, activation counting/failures,
 * initialization-state flipping, and manual firing of `onDidChangeState`.
 *
 * Created inside `vi.hoisted` because the `vi.mock` factory is hoisted above
 * every import and may run before this module's own body executes.
 */
const gitMock = vi.hoisted(() => {
  const control = {
    /** When true, `getExtension` returns undefined: vscode.git absent/disabled. */
    extensionMissing: false,
    /** Mirrors the extension record's `isActive` flag. */
    isActive: false,
    /** Next `activate()` call rejects instead of returning the exports. */
    failNextActivation: false,
    activateCalls: 0,
    api: {
      state: 'uninitialized' as 'uninitialized' | 'initialized',
      repositories: [] as Array<{ rootUri: { fsPath: string } }>,
      onDidChangeState(listener: StateListener) {
        control.stateListeners.push(listener);
        return {
          dispose() {
            const at = control.stateListeners.indexOf(listener);
            if (at !== -1) {
              control.stateListeners.splice(at, 1);
            }
          }
        };
      },
      getRepository(uri: { fsPath: string }) {
        // Real vscode.git resolves by path containment under the repo root,
        // not exact equality.
        return this.repositories.find((repo) => uri.fsPath.startsWith(`${repo.rootUri.fsPath}/`)) ?? null;
      }
    },
    stateListeners: [] as StateListener[],
    fireState(state: 'uninitialized' | 'initialized'): void {
      control.api.state = state;
      for (const listener of [...control.stateListeners]) {
        listener(state);
      }
    },
    reset(): void {
      control.extensionMissing = false;
      control.isActive = false;
      control.failNextActivation = false;
      control.activateCalls = 0;
      control.api.state = 'uninitialized';
      control.api.repositories = [];
      control.stateListeners.length = 0;
    }
  };
  const vscode = {
    extensions: {
      getExtension(): Record<string, unknown> | undefined {
        if (control.extensionMissing) {
          return undefined;
        }
        return {
          get isActive(): boolean {
            return control.isActive;
          },
          exports: { getAPI: () => control.api },
          async activate(): Promise<{ getAPI: () => typeof control.api }> {
            control.activateCalls++;
            if (control.failNextActivation) {
              throw new Error('Cannot activate the git extension');
            }
            control.isActive = true;
            return { getAPI: () => control.api };
          }
        };
      }
    }
  };
  return { control, vscode };
});

vi.mock('vscode', () => gitMock.vscode);

const control = gitMock.control;

/** The span file URI every lookup uses; any path exercises the same logic. */
const spanUri = { fsPath: '/ws/.span/coupling.span' } as unknown as vscode.Uri;

/** The repository vscode.git should report as owning {@linkcode spanUri}. */
const owningRepo = { rootUri: { fsPath: '/ws' } };

/**
 * Fresh module instance per test: the memo under test is module-level state,
 * so every case re-imports after `vi.resetModules()` to start a new session.
 *
 * @returns The freshly-evaluated `gitRepository` module.
 */
async function loadModule() {
  vi.resetModules();
  return await import('../../src/spanViewer/gitRepository.js');
}

/**
 * Settle `promise` against fake-time progress: resolves `true` when the
 * promise settles strictly before `INIT_TIMEOUT_MS - 1` of fake time has
 * elapsed, `false` otherwise. The discriminator between a memoized result
 * (microtask-fast, no timer involved) and a fresh bounded wait (a pending
 * 5s setTimeout).
 *
 * @param promise - The lookup promise to observe.
 * @returns Whether it settled within the sub-timeout window.
 */
async function settlesBeforeTimeout(promise: Promise<unknown>): Promise<boolean> {
  return await Promise.race([
    promise.then(
      () => true,
      () => true
    ),
    vi.advanceTimersByTimeAsync(INIT_TIMEOUT_MS - 1).then(() => false)
  ]);
}

describe('gitRepository session memoization (unit)', () => {
  beforeEach(() => {
    control.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves the owning repository when vscode.git reports one', async () => {
    control.isActive = true;
    control.api.state = 'initialized';
    control.api.repositories.push(owningRepo);
    const sut = await loadModule();

    const first = await sut.getRepositoryForUri(spanUri);
    const second = await sut.getRepositoryForUri(spanUri);

    expect(first).toEqual({ status: 'resolved', repository: owningRepo });
    expect(second).toEqual(first);
  });

  it('activates a dormant vscode.git exactly once across sequential opens', async () => {
    const sut = await loadModule();
    control.fireState('initialized');
    control.api.repositories.push(owningRepo);

    await sut.getRepositoryForUri(spanUri);
    await sut.getRepositoryForUri(spanUri);

    expect(control.activateCalls).toBe(1);
  });

  it('caches the timed-out outcome: the second open resolves fast with the same reason', async () => {
    const sut = await loadModule();

    const first = sut.getRepositoryForUri(spanUri);
    expect(await settlesBeforeTimeout(first)).toBe(false);
    await vi.advanceTimersByTimeAsync(INIT_TIMEOUT_MS);
    const firstOutcome = await first;
    expect(firstOutcome).toEqual({ status: 'unavailable', reason: TIMEOUT_REASON });

    // The timed-out outcome itself was memoized: the second open must settle
    // with zero additional timer progress -- multi-tab session restores do
    // not stack one bounded wait per tab.
    const second = sut.getRepositoryForUri(spanUri);
    expect(await settlesBeforeTimeout(second)).toBe(true);
    expect(await second).toEqual(firstOutcome);
  });

  it('puts concurrent first opens on one shared bounded wait', async () => {
    const sut = await loadModule();

    const first = sut.getRepositoryForUri(spanUri);
    const second = sut.getRepositoryForUri(spanUri);
    await vi.advanceTimersByTimeAsync(INIT_TIMEOUT_MS);

    expect(await first).toEqual(await second);
    expect(await first).toEqual({ status: 'unavailable', reason: TIMEOUT_REASON });
  });

  it('reports and caches a concrete reason when the vscode.git extension is absent', async () => {
    control.extensionMissing = true;
    const sut = await loadModule();

    const first = await sut.getRepositoryForUri(spanUri);
    const second = await sut.getRepositoryForUri(spanUri);

    expect(first.status).toBe('unavailable');
    expect((first as { reason: string }).reason).toContain('not installed or disabled');
    expect(second).toEqual(first);
  });

  it('reports a concrete reason when vscode.git fails to activate, and caches it', async () => {
    control.failNextActivation = true;
    const sut = await loadModule();

    const first = await sut.getRepositoryForUri(spanUri);
    const second = await sut.getRepositoryForUri(spanUri);

    expect((first as { reason: string }).reason).toContain('failed to activate: Cannot activate the git extension');
    expect(second).toEqual(first);
  });

  it('clears the memoized timeout when git initializes later in the session', async () => {
    const sut = await loadModule();

    const first = sut.getRepositoryForUri(spanUri);
    await vi.advanceTimersByTimeAsync(INIT_TIMEOUT_MS);
    expect(await first).toEqual({ status: 'unavailable', reason: TIMEOUT_REASON });

    // Slow-but-enabled git finishes initializing after the timeout expired:
    // the armed one-shot listener fires, invalidating the cached timed-out
    // outcome so subsequent opens resolve normally instead of inheriting the
    // stale failure for the rest of the session.
    control.api.repositories.push(owningRepo);
    control.fireState('initialized');

    const afterLateInit = await sut.getRepositoryForUri(spanUri);
    expect(afterLateInit).toEqual({ status: 'resolved', repository: owningRepo });
  });

  it('names no-repository ownership concretely when git is healthy but unaware of the URI', async () => {
    control.isActive = true;
    control.api.state = 'initialized';
    const sut = await loadModule();

    const resolution = await sut.getRepositoryForUri(spanUri);

    expect(resolution.status).toBe('unavailable');
    expect((resolution as { reason: string }).reason).toContain('no repository owning');
  });

  describe('repositoryResolutionFailureMessage', () => {
    it('embeds the concrete unavailability reason in the fallback text', async () => {
      const sut = await loadModule();

      const message = sut.repositoryResolutionFailureMessage({
        status: 'unavailable',
        reason: TIMEOUT_REASON
      });

      expect(message).toContain('Could not determine the git repository containing this span file');
      expect(message).toContain("did not become 'initialized' within 5000ms");
      expect(message).toContain('cannot load its history.');
    });

    it('stays generic when git integration resolved but no repository was found anywhere', async () => {
      const sut = await loadModule();

      const message = sut.repositoryResolutionFailureMessage({
        status: 'resolved',
        repository: { rootUri: { fsPath: '/elsewhere' } as unknown as vscode.Uri }
      });

      expect(message).toContain('Could not determine the git repository containing this span file');
      expect(message).toContain('cannot load its history.');
      expect(message).not.toContain('repository detection failed');
    });
  });
});
