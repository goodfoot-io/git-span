/**
 * Drives registered span and anchor watcher callbacks against a controlled
 * clock. Native filesystem delivery has no maximum latency, so debounce
 * timing is checked here while Electron tests check final-state convergence.
 *
 * @summary Deterministic cross-path watcher debounce coverage.
 * @module test/unit/spanRenderSession.watchers.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SpanRenderSession,
  type SpanRenderWatcher,
  testOnlyWatcherCoalescingStats
} from '../../src/spanViewer/spanRenderSession.js';

/** Callback-backed watcher with the same subscription surface as the host. */
class CallbackWatcher implements SpanRenderWatcher {
  private readonly changes: Array<() => void> = [];

  /**
   * Register the listener the production session installs.
   * @param listener - The session callback invoked for a file change.
   */
  onDidChange(listener: () => void): void {
    this.changes.push(listener);
  }

  /**
   * This harness delivers change events only.
   * @param _listener - The unused creation callback.
   */
  onDidCreate(_listener: () => void): void {}

  /**
   * This harness delivers change events only.
   * @param _listener - The unused deletion callback.
   */
  onDidDelete(_listener: () => void): void {}

  /** Deliver one native-style change to every registered listener. */
  emitChange(): void {
    for (const listener of this.changes) listener();
  }

  /** Retire the registered listeners. */
  dispose(): void {
    this.changes.length = 0;
  }
}

const uriKey = 'file:///test/.span/cross-path-debounce';
let session: SpanRenderSession;
let watchers: CallbackWatcher[];

beforeEach(() => {
  vi.useFakeTimers();
  watchers = [];
  session = new SpanRenderSession({
    uri: { fsPath: '/test/.span/cross-path-debounce' },
    uriKey,
    runCommand: async () => {
      throw new Error('An unreadable declaration must not spawn the CLI');
    },
    readSpanFile: async () => null,
    createWatcher: () => {
      const watcher = new CallbackWatcher();
      watchers.push(watcher);
      return watcher;
    },
    showFallback: () => undefined,
    postDocument: () => undefined
  });
  session.configure({ binaryPath: '/test/git-span', spanName: 'cross-path-debounce', repoRoot: '/test' });
  session.ensureWatcher('/test/.span/cross-path-debounce');
  session.ensureWatcher('/test/anchor.ts');
});

afterEach(() => {
  session.dispose();
  testOnlyWatcherCoalescingStats.delete(uriKey);
  vi.useRealTimers();
});

describe('registered watchers share one trailing debounce', () => {
  it('absorbs an anchor event into the span event and waits a full quiet window after the last arrival', async () => {
    expect(watchers).toHaveLength(2);
    watchers[0]?.emitChange();
    await vi.advanceTimersByTimeAsync(299);
    watchers[1]?.emitChange();
    expect(testOnlyWatcherCoalescingStats.get(uriKey)).toEqual({
      observedEvents: 2,
      coalescedEvents: 1,
      debouncedRenders: 0
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(session.generation).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.generation).toBe(1);
    expect(testOnlyWatcherCoalescingStats.get(uriKey)?.debouncedRenders).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(session.generation).toBe(1);
  });

  it('renders each path when its callback arrives after the preceding quiet window', async () => {
    watchers[0]?.emitChange();
    await vi.advanceTimersByTimeAsync(300);
    expect(session.generation).toBe(1);
    watchers[1]?.emitChange();
    await vi.advanceTimersByTimeAsync(300);
    expect(session.generation).toBe(2);
    expect(testOnlyWatcherCoalescingStats.get(uriKey)).toEqual({
      observedEvents: 2,
      coalescedEvents: 0,
      debouncedRenders: 2
    });
  });
});
