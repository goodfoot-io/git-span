/**
 * Plain unit tests for {@linkcode SpanRenderSession}'s lifecycle -- the state
 * extracted from `resolveCustomEditor`: the generation counter, the abort
 * controllers, the trailing-debounce timer, and the filesystem watchers.
 *
 * Everything IO-shaped is injected, so these tests construct real sessions
 * against fakes with no `vscode` import and no `@vscode/test-electron`: the
 * CLI spawn is a never-resolving promise that records each render's
 * `AbortSignal`, and watchers are disposable stubs.
 *
 * @summary Unit tests for the span viewer's render session lifecycle.
 * @module test/suite/spanViewer/spanRenderSession.test
 */

import * as assert from 'node:assert';
import type { ParsedSpanFile } from '../../../src/spanViewer/spanFileGrammar.js';
import {
  type SpanRenderEnvironment,
  SpanRenderSession,
  type SpanRenderWatcher,
  testOnlyWatcherCoalescingStats
} from '../../../src/spanViewer/spanRenderSession.js';
import type { GitSpanCommandResult } from '../../../src/utils/gitSpanBinary.js';

/** A {@linkcode SpanRenderWatcher} stub recording only its own disposal. */
interface FakeWatcher extends SpanRenderWatcher {
  /** Set the first time `dispose()` is called. */
  disposed: boolean;
}

/** One watcher created by the harness, with the glob pattern it was asked for. */
interface CreatedWatcher {
  /** The glob-escaped pattern passed to `createWatcher`. */
  pattern: string;
  /** The stub handed back to the session. */
  watcher: FakeWatcher;
}

/** Everything a test needs to drive and observe one session. */
interface TestHarness {
  /** The session's test-hook key (`testOnlyWatcherCoalescingStats`). */
  readonly uriKey: string;
  /** The session under test. */
  readonly session: SpanRenderSession;
  /** One entry per CLI spawn, in start order. */
  readonly signals: AbortSignal[];
  /**
   * One entry per updatedAt query, in start order -- the signals handed to
   * the injected `readCommittedDate`, i.e. the ones threading through
   * `resolveSpanUpdatedAt`.
   */
  readonly timestampSignals: AbortSignal[];
  /** One entry per `createWatcher` call, in creation order. */
  readonly watchers: CreatedWatcher[];
  /** Messages handed to `showFallback`, in order. */
  readonly fallbackMessages: string[];
  /** Documents handed to `postDocument`, in order. */
  readonly postedDocuments: unknown[];
}

/** Optional overrides for one test's harness. */
interface HarnessOptions {
  /** The span file the fake `readSpanFile` returns; defaults to zero anchors. */
  readonly parsed?: ParsedSpanFile;
  /**
   * When set, each CLI spawn resolves immediately with this result instead of
   * hanging, letting a render reach its build phase.
   */
  readonly commandResult?: GitSpanCommandResult;
}

/** Distinguishes concurrent harnesses' entries in the shared test-hook maps. */
let harnessCounter = 0;

/**
 * Build a watcher stub whose subscriptions are discarded and whose disposal
 * is observable.
 *
 * @returns A fresh fake watcher.
 */
function makeFakeWatcher(): FakeWatcher {
  const handle: FakeWatcher = {
    disposed: false,
    onDidChange: () => undefined,
    onDidCreate: () => undefined,
    onDidDelete: () => undefined,
    dispose: () => {
      handle.disposed = true;
    }
  };
  return handle;
}

/**
 * Create a session wired to fakes: the "CLI" hangs forever until its signal
 * aborts (or resolves immediately with `options.commandResult`), the injected
 * committed-date reader hangs the same way, the span file parses per
 * `options.parsed`, and every sink records its inputs.
 *
 * @param options - Per-test overrides; defaults keep every spawn hanging and
 *   the span file at zero anchors.
 * @returns A fresh session harness backed by recording fakes.
 */
function makeHarness(options: HarnessOptions = {}): TestHarness {
  const signals: AbortSignal[] = [];
  const timestampSignals: AbortSignal[] = [];
  const watchers: CreatedWatcher[] = [];
  const fallbackMessages: string[] = [];
  const postedDocuments: unknown[] = [];
  const uriKey = `file:///test/.span/unit-render-session-${harnessCounter}`;
  const parsed: ParsedSpanFile = options.parsed ?? { anchors: [], why: '' };
  const session = new SpanRenderSession({
    uri: { fsPath: `/test/.span/unit-render-session-${harnessCounter}` },
    uriKey,
    runCommand: (_binaryPath, _args, signal) =>
      new Promise<GitSpanCommandResult>((resolve, reject) => {
        if (signal === undefined) {
          reject(new Error('test harness requires a signal'));
          return;
        }
        signals.push(signal);
        // A real spawn wrapper refuses to start against an already-aborted
        // signal -- an 'abort' listener added after the event fired never
        // delivers.
        if (signal.aborted) {
          reject(new Error('Aborted'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(new Error('Aborted'));
        });
        if (options.commandResult !== undefined) {
          resolve(options.commandResult);
        }
      }),
    readCommittedDate: (_repoRoot, _relativePath, signal) =>
      new Promise<string | null>((_resolve, reject) => {
        if (signal === undefined) {
          reject(new Error('test harness requires a signal'));
          return;
        }
        timestampSignals.push(signal);
        if (signal.aborted) {
          reject(new Error('Aborted'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(new Error('Aborted'));
        });
      }),
    readSpanFile: async () => ({ text: '', parsed }),
    createWatcher: (globPattern) => {
      const watcher = makeFakeWatcher();
      watchers.push({ pattern: globPattern, watcher });
      return watcher;
    },
    showFallback: (message) => {
      fallbackMessages.push(message);
    },
    postDocument: (document) => {
      postedDocuments.push(document);
    },
    debounceMs: 15
  });
  harnessCounter += 1;
  return { uriKey, session, signals, timestampSignals, watchers, fallbackMessages, postedDocuments };
}

/**
 * The environment a configured session needs before it will render.
 *
 * @returns A fixed fake environment.
 */
function makeEnvironment(): SpanRenderEnvironment {
  return { binaryPath: '/test/bin/git-span', spanName: 'unit-render-session', repoRoot: '/test/repo' };
}

/**
 * Let pending microtasks and zero-timeout timers drain so a started render
 * reaches its CLI spawn.
 *
 * @returns Nothing.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

/**
 * Wait real wall-clock time (for debounce windows).
 *
 * @param ms - Milliseconds to wait.
 * @returns Nothing.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Poll until `predicate` holds or a deadline lapses. Reaching the build
 * phase's updatedAt query crosses several real filesystem operations (anchor
 * stat, clean read, mtime fallback), which no fixed microtask drain observes
 * deterministically.
 *
 * @param predicate - The awaited condition.
 * @param what - Human-readable description for the timeout error.
 * @returns Nothing.
 */
async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await sleep(5);
  }
}

/**
 * A schema-v2 history document whose single commit carries a content block at
 * `src/anchor.ts`, so that address matches with lineage and the render's
 * build phase runs -- past the all-dangling shortcut, into the updatedAt
 * resolution under test.
 *
 * @returns The JSON stdout handed back by the fake CLI spawn.
 */
function makeMatchedHistoryStdout(): string {
  return JSON.stringify({
    schema_version: 2,
    span: 'unit-render-session',
    commits: [
      {
        hash: 'a'.repeat(40),
        date: '2026-08-23T00:00:00Z',
        summary: 'add src/anchor.ts',
        anchors: [{ path: 'src/anchor.ts', content: 'export const anchor = 1;\n' }]
      }
    ]
  });
}

/**
 * Options putting a harness on the build-phase path: one live anchor matched
 * by history, and a CLI spawn that resolves so the pass reaches its updatedAt
 * query.
 *
 * @returns Harness options for the cancellation tests.
 */
function makeBuildPhaseOptions(): HarnessOptions {
  return {
    parsed: {
      anchors: [{ path: 'src/anchor.ts', range: null, algorithm: 'sha256', contentHash: 'f'.repeat(64) }],
      why: ''
    },
    commandResult: {
      stdout: makeMatchedHistoryStdout(),
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false
    }
  };
}

describe('SpanRenderSession (unit)', () => {
  const touchedUriKeys: string[] = [];

  afterEach(() => {
    for (const uriKey of touchedUriKeys.splice(0)) {
      testOnlyWatcherCoalescingStats.delete(uriKey);
    }
  });

  it('aborting a superseded render cancels its prior controller and posts nothing', async () => {
    const harness = makeHarness();
    touchedUriKeys.push(harness.uriKey);
    harness.session.configure(makeEnvironment());

    const first = harness.session.start();
    await settle();
    assert.strictEqual(harness.signals.length, 1, 'first render should have reached its CLI spawn');

    const second = harness.session.start();
    await settle();
    assert.strictEqual(harness.signals.length, 2, 'second render should have reached its own CLI spawn');
    assert.strictEqual(harness.signals[0]?.aborted, true, 'superseding a render must abort the prior controller');
    assert.strictEqual(harness.signals[1]?.aborted, false, 'the newest render must stay live');

    assert.strictEqual(await first, null, 'the superseded render must report nothing to watch');
    assert.strictEqual(
      harness.postedDocuments.length + harness.fallbackMessages.length,
      0,
      'a superseded render must neither post a document nor render the fallback pane'
    );

    harness.session.dispose();
    assert.strictEqual(await second, null);
  });

  it("cancels a superseded render's updatedAt git-log spawn at the moment of supersession", async () => {
    const harness = makeHarness(makeBuildPhaseOptions());
    touchedUriKeys.push(harness.uriKey);
    harness.session.configure(makeEnvironment());

    const first = harness.session.start();
    await waitFor(() => harness.timestampSignals.length === 1, 'the first render reaching its updatedAt query');
    assert.strictEqual(
      harness.timestampSignals[0],
      harness.signals[0],
      'the history spawn and the updatedAt query of one pass must ride the same controller'
    );

    const second = harness.session.start();
    await waitFor(() => harness.timestampSignals.length === 2, 'the second render reaching its own updatedAt query');
    assert.strictEqual(
      harness.timestampSignals[0]?.aborted,
      true,
      'supersession must cancel the prior pass in-flight git-log query'
    );
    assert.strictEqual(harness.signals[1]?.aborted, false, 'the newest pass must stay live');
    assert.strictEqual(harness.timestampSignals[1]?.aborted, false, 'the newest pass must stay live');

    assert.strictEqual(await first, null, 'the superseded render must post nothing');
    assert.strictEqual(
      harness.postedDocuments.length + harness.fallbackMessages.length,
      0,
      'a superseded render must neither post a document nor render the fallback pane'
    );

    harness.session.dispose();
    await second;
  });

  it('cancels the updatedAt git-log spawn when the session is disposed mid-build', async () => {
    const harness = makeHarness(makeBuildPhaseOptions());
    touchedUriKeys.push(harness.uriKey);
    harness.session.configure(makeEnvironment());

    const pending = harness.session.start();
    await waitFor(() => harness.timestampSignals.length === 1, 'the render reaching its updatedAt query');
    assert.strictEqual(harness.timestampSignals[0]?.aborted, false);

    harness.session.dispose();

    assert.strictEqual(
      harness.timestampSignals[0]?.aborted,
      true,
      'dispose must cancel the in-flight git-log query -- nothing may outlive the panel'
    );
    assert.strictEqual(await pending, null, 'a disposed pass must post nothing');
    assert.strictEqual(
      harness.postedDocuments.length + harness.fallbackMessages.length,
      0,
      'a disposed render must neither post a document nor render the fallback pane'
    );
  });

  it('increases the generation monotonically across renders', async () => {
    const harness = makeHarness();
    touchedUriKeys.push(harness.uriKey);
    harness.session.configure(makeEnvironment());

    assert.strictEqual(harness.session.generation, 0, 'no render yet');

    const first = harness.session.start();
    await settle();
    const firstGeneration = harness.session.generation;
    assert.strictEqual(firstGeneration, 1);

    const second = harness.session.start();
    await settle();
    const secondGeneration = harness.session.generation;
    assert.ok(secondGeneration > firstGeneration, 'generation must increase across renders');

    const third = harness.session.start();
    assert.ok(
      harness.session.generation > secondGeneration,
      'generation must increase even while earlier renders are still in flight'
    );

    harness.session.dispose();
    assert.strictEqual(await first, null);
    assert.strictEqual(await second, null);
    assert.strictEqual(await third, null);
    assert.strictEqual(harness.session.generation, 3, 'dispose must not move the counter');
  });

  it('dispose aborts live controllers, disposes watchers, and clears the debounce timer', async () => {
    const harness = makeHarness();
    touchedUriKeys.push(harness.uriKey);
    harness.session.configure(makeEnvironment());

    const pending = harness.session.start();
    await settle();
    assert.strictEqual(harness.signals.length, 1);

    harness.session.ensureWatcher('/test/repo/anchor.ts');
    assert.strictEqual(harness.watchers.length, 1, 'watcher should be tracked');
    assert.strictEqual(harness.watchers[0]?.watcher.disposed, false);

    harness.session.scheduleRender();
    const stats = testOnlyWatcherCoalescingStats.get(harness.uriKey);
    assert.ok(stats !== undefined, 'coalescing stats should be recorded under the session key');
    assert.strictEqual(stats.observedEvents, 1);

    harness.session.dispose();

    assert.strictEqual(harness.signals[0]?.aborted, true, 'dispose must abort the live controller');
    assert.strictEqual(await pending, null);
    assert.strictEqual(harness.watchers[0]?.watcher.disposed, true, 'dispose must dispose watchers');

    await sleep(60);
    assert.strictEqual(
      testOnlyWatcherCoalescingStats.get(harness.uriKey)?.debouncedRenders,
      0,
      'dispose must clear the pending debounce timer -- no render may fire into a dead panel'
    );
    assert.strictEqual(harness.signals.length, 1, 'no further spawn may happen after disposal');

    harness.session.dispose();
    assert.strictEqual(harness.watchers[0]?.watcher.disposed, true, 'double dispose must be a no-op');
  });

  it('cancel drops a pending debounced render without disposing the session', async () => {
    const harness = makeHarness();
    touchedUriKeys.push(harness.uriKey);
    harness.session.configure(makeEnvironment());

    harness.session.scheduleRender();
    harness.session.cancel();
    assert.strictEqual(harness.session.disposed, false, 'cancel is not dispose');

    await sleep(60);
    assert.strictEqual(
      testOnlyWatcherCoalescingStats.get(harness.uriKey)?.debouncedRenders,
      0,
      'a cancelled debounce must never start a render'
    );
    assert.strictEqual(harness.signals.length, 0);
  });

  it('coalesces watcher-event bursts into one trailing render that supersedes the open-time render', async () => {
    const harness = makeHarness();
    touchedUriKeys.push(harness.uriKey);
    harness.session.configure(makeEnvironment());

    const openTimeRender = harness.session.start();
    await settle();
    assert.strictEqual(harness.signals.length, 1);

    harness.session.ensureWatcher('/test/repo/anchor.ts');
    harness.session.scheduleRender();
    harness.session.scheduleRender();

    const stats = testOnlyWatcherCoalescingStats.get(harness.uriKey);
    assert.strictEqual(stats?.observedEvents, 2);
    assert.strictEqual(stats?.coalescedEvents, 1, 'the second burst event must be absorbed by the pending timer');

    await sleep(60);
    assert.strictEqual(stats?.debouncedRenders, 1, 'the burst must cost exactly one render');
    assert.strictEqual(harness.signals.length, 2, 'the debounced render must have spawned');
    assert.strictEqual(harness.signals[0]?.aborted, true, 'the debounced render must supersede the open-time one');

    harness.session.dispose();
    assert.strictEqual(await openTimeRender, null);
  });

  it('fails closed: no renders from an unconfigured session, none after disposal', async () => {
    const harness = makeHarness();
    touchedUriKeys.push(harness.uriKey);

    assert.strictEqual(await harness.session.start(), null, 'unconfigured sessions must refuse to render');
    assert.strictEqual(harness.signals.length, 0);
    assert.strictEqual(harness.session.generation, 0, 'refused starts must not consume generations');

    harness.session.configure(makeEnvironment());
    const pending = harness.session.start();
    await settle();
    harness.session.dispose();
    assert.strictEqual(await pending, null);
    assert.strictEqual(await harness.session.start(), null, 'disposed sessions must refuse to render');
    assert.strictEqual(harness.session.generation, 1, 'refused starts must not consume generations');
  });
});
