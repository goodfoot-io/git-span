/**
 * Soft-dependency lookup of the built-in `vscode.git` extension's API, used
 * only to resolve which repository (and repository root) owns a given
 * `.span/*` file's URI. Never used for content -- `historyClient.ts` and the
 * `git-span` CLI remain the sole source of anchor content.
 *
 * `vscode.git` is not declared in this extension's `extensionDependencies` --
 * a workspace with Git disabled (or the built-in extension unavailable) loses
 * only this repository-resolution step, never throwing.
 *
 * The expensive part of a resolution is waiting out {@linkcode waitForInitializedState}'s
 * bounded wait, and its outcome cannot meaningfully differ between two opens
 * of a custom editor in the same extension-host session: multi-tab session
 * restores resolve concurrently against one shared, module-level promise
 * instead of serially paying the full timeout each. Timed-out and
 * failed-activation outcomes are memoized too -- a second open must never
 * re-pay the wait -- with one deliberate exception: after a timeout, a
 * one-shot `onDidChangeState` listener stays armed so that a genuinely slow
 * (but enabled) `vscode.git` that reaches `'initialized'` later in the
 * session clears the memo and lets the next open resolve normally. The
 * git-disabled case never fires that event, so its unavailability stays
 * cached for the session, which is exactly the restore-storm shape this
 * module exists to absorb.
 *
 * @summary Soft-dependency lookup of the `vscode.git` extension's API.
 * @module spanViewer/gitRepository
 */

import * as vscode from 'vscode';

/** The minimal surface of a `vscode.git` `Repository` this module relies on. */
export interface GitRepository {
  readonly rootUri: vscode.Uri;
}

/**
 * Minimal ambient typing for the `vscode.git` extension's exported API
 * surface (`getAPI(1)`). Not published in `@types/vscode` -- typed locally
 * to the exact shape this module reads.
 */
interface GitApiV1 {
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  readonly repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtensionExports {
  getAPI(version: 1): GitApiV1;
}

/** How long {@linkcode waitForInitializedState} waits for `vscode.git` to report `'initialized'` before giving up. */
const GIT_INITIALIZED_TIMEOUT_MS = 5000;

/**
 * Outcome of resolving the `vscode.git` API itself -- the session-stable,
 * memoized half of {@linkcode getRepositoryForUri}'s work. Per-URI lookups
 * (`api.getRepository`) stay uncached so repository discovery that completes
 * after initialization is still observed on later opens.
 */
type GitApiOutcome =
  | { readonly kind: 'ready'; readonly api: GitApiV1 }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * Why `vscode.git` could not answer for a URI, for fallback panes and logs.
 *
 * This is a rendered explanation, not a stable error code -- it names the
 * concrete cause (extension absent/disabled, activation failure, or the
 * bounded wait expiring with the API still `'uninitialized'`).
 */
export type RepositoryResolution =
  | { readonly status: 'resolved'; readonly repository: GitRepository }
  | { readonly status: 'unavailable'; readonly reason: string };

/**
 * Session-wide memo of the `vscode.git` initialization outcome. `undefined`
 * until the first custom-editor open resolves it; every subsequent open in
 * the same extension-host session awaits this settled promise instead of
 * re-running activation and the bounded initialization wait.
 */
let initializationOutcome: Promise<GitApiOutcome> | undefined;

/**
 * Wait for the `vscode.git` API to report `state === 'initialized'`.
 *
 * Covers the session-restore race where a span editor can resolve before
 * repository discovery completes. Bounded by {@linkcode GIT_INITIALIZED_TIMEOUT_MS}:
 * VS Code documents that a git-disabled (or failing-to-initialize) extension
 * never leaves `'uninitialized'`, so an unbounded wait would hang the caller.
 * The rejection surfaces through {@linkcode getRepositoryForUri} as an
 * `'unavailable'` resolution, letting the provider's `findRepoRootUpward`
 * fallback take over.
 *
 * @param api - The activated `vscode.git` API.
 * @returns Resolves once `api.state` is `'initialized'`.
 * @throws A timeout error when `api.state` is still `'uninitialized'` after
 *   {@linkcode GIT_INITIALIZED_TIMEOUT_MS}; the event subscription is disposed
 *   before rejecting.
 */
function waitForInitializedState(api: GitApiV1): Promise<void> {
  if (api.state === 'initialized') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const subscription = api.onDidChangeState((state) => {
      if (state === 'initialized') {
        clearTimeout(timeout);
        subscription.dispose();
        resolve();
      }
    });
    timeout = setTimeout(() => {
      subscription.dispose();
      reject(
        new Error(
          `vscode.git state did not become 'initialized' within ${GIT_INITIALIZED_TIMEOUT_MS}ms; git extension disabled or failed to initialize`
        )
      );
    }, GIT_INITIALIZED_TIMEOUT_MS);
  });
}

/**
 * After a timed-out initialization wait, arm a one-shot listener that clears
 * the memoized outcome if `vscode.git` reaches `'initialized'` later in the
 * session. The bounded wait rejects while the API is still `'uninitialized'`,
 * which its contract treats as fatal only for the git-disabled case; a slow
 * but enabled extension can still initialize afterwards, and callers opening
 * tabs then deserve a real resolution rather than the cached timeout. The
 * subscription lives until that event fires (or the host dies); the
 * git-disabled case -- the common shape -- never fires it and keeps paying
 * nothing after the first open.
 *
 * @param api - The activated but uninitialized `vscode.git` API.
 * @returns Nothing.
 */
function armLateInitializationReset(api: GitApiV1): void {
  const subscription = api.onDidChangeState((state) => {
    if (state !== 'initialized') {
      return;
    }
    subscription.dispose();
    initializationOutcome = undefined;
  });
}

/**
 * Extract a human-readable message from an unknown thrown value, for reason
 * strings surfaced in fallback panes.
 *
 * @param error - Whatever was caught.
 * @returns The error's own message, or its string form.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve the `vscode.git` API once per session: locate the extension,
 * activate it, and wait out the bounded initialization. Terminal outcomes
 * (extension absent, activation failure) and the timed-out outcome are all
 * memoized by the caller via {@linkcode initializationOutcome}; the timed-out
 * outcome additionally arms {@linkcode armLateInitializationReset}.
 *
 * @returns The ready API, or an unavailable outcome carrying a concrete,
 *   user-renderable reason.
 */
async function resolveGitApi(): Promise<GitApiOutcome> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (extension === undefined) {
    return {
      kind: 'unavailable',
      reason: 'the built-in Git extension (vscode.git) is not installed or disabled'
    };
  }

  let api: GitApiV1;
  try {
    const exports = extension.isActive ? extension.exports : await extension.activate();
    api = exports.getAPI(1);
  } catch (error) {
    console.error('Git Span: failed to activate vscode.git:', error);
    return {
      kind: 'unavailable',
      reason: `the built-in Git extension (vscode.git) failed to activate: ${errorMessage(error)}`
    };
  }

  try {
    await waitForInitializedState(api);
  } catch (error) {
    console.error('Git Span: vscode.git did not finish initializing:', error);
    armLateInitializationReset(api);
    return { kind: 'unavailable', reason: errorMessage(error) };
  }

  return { kind: 'ready', api };
}

/**
 * Return the memoized {@linkcode resolveGitApi} promise, starting it on the
 * first call of the session. Concurrent first opens (a multi-tab session
 * restore) share this single in-flight promise instead of stacking one
 * bounded wait per tab.
 *
 * @returns The session-wide initialization outcome promise.
 */
function resolveGitApiOnce(): Promise<GitApiOutcome> {
  initializationOutcome ??= resolveGitApi();
  return initializationOutcome;
}

/**
 * Resolve the `vscode.git` repository that owns `uri`.
 *
 * The session-stable half (extension presence, activation, initialization)
 * runs once per extension-host session and is memoized including its negative
 * outcomes, so second and subsequent opens resolve without re-paying the
 * bounded initialization wait. The per-URI lookup stays uncached: repository
 * discovery can complete shortly after initialization, and later opens must
 * observe repositories that appeared.
 *
 * @param uri - URI of the file to resolve a repository for.
 * @returns The owning repository, or an `'unavailable'` outcome whose
 *   `reason` names the concrete failure when `vscode.git` is absent,
 *   disabled, fails to activate, times out waiting to initialize, or reports
 *   no repository for `uri`.
 * @throws Never -- all failures are swallowed into `'unavailable'` resolutions.
 */
export async function getRepositoryForUri(uri: vscode.Uri): Promise<RepositoryResolution> {
  const outcome = await resolveGitApiOnce();
  if (outcome.kind === 'unavailable') {
    return { status: 'unavailable', reason: outcome.reason };
  }
  const repository = outcome.api.getRepository(uri);
  if (repository === null) {
    return { status: 'unavailable', reason: `vscode.git reports no repository owning ${uri.fsPath}` };
  }
  return { status: 'resolved', repository };
}

/**
 * Compose the exact fallback-pane text rendered when neither `vscode.git`,
 * the workspace folder, nor an upward `.git` walk can place a span file in a
 * repository. When git integration itself was the reason, the pane names it
 * concretely instead of showing a generic error -- the whole point of
 * {@linkcode RepositoryResolution}'s `reason`.
 *
 * @param resolution - The outcome returned by {@linkcode getRepositoryForUri}.
 * @returns The full fallback message for the span viewer's error panel.
 */
export function repositoryResolutionFailureMessage(resolution: RepositoryResolution): string {
  const base = 'Could not determine the git repository containing this span file (no ".git" directory found above it)';
  if (resolution.status === 'resolved') {
    return `${base}; cannot load its history.`;
  }
  return `${base}, and repository detection failed: ${resolution.reason}; cannot load its history.`;
}
