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
 * Wait for the `vscode.git` API to report `state === 'initialized'`.
 *
 * Covers the session-restore race where a span editor can resolve before
 * repository discovery completes. Bounded by {@linkcode GIT_INITIALIZED_TIMEOUT_MS}:
 * VS Code documents that a git-disabled (or failing-to-initialize) extension
 * never leaves `'uninitialized'`, so an unbounded wait would hang the caller.
 * The rejection surfaces through {@linkcode getRepositoryForUri} as `null`,
 * letting the provider's `findRepoRootUpward` fallback take over.
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
 * Resolve the `vscode.git` repository that owns `uri`.
 *
 * @param uri - URI of the file to resolve a repository for.
 * @returns The owning repository, or `null` when `vscode.git` is absent,
 *   disabled, fails to activate, or reports no repository for `uri`.
 * @throws Never -- all failures are swallowed and reported as `null`.
 */
export async function getRepositoryForUri(uri: vscode.Uri): Promise<GitRepository | null> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (extension === undefined) {
    return null;
  }

  try {
    const exports = extension.isActive ? extension.exports : await extension.activate();
    const api = exports.getAPI(1);
    await waitForInitializedState(api);
    return api.getRepository(uri);
  } catch (error) {
    console.error('Git Span: failed to resolve vscode.git repository:', error);
    return null;
  }
}
