/**
 * Pipeline assembly: scan the working tree, load history, run every
 * applicable signal, and merge the results into the final ranked list.
 *
 * @summary End-to-end discovery pipeline over a git repository.
 */

import { defaultGitRunner } from './git.js';
import { loadHistory } from './history.js';
import { mergeCandidates } from './merge.js';
import { scanRepo } from './scan.js';
import {
  clonesSignal,
  cochangeSignal,
  commitMessagesSignal,
  docReferencesSignal,
  implTestSignal,
  manifestWiringSignal,
  pathLiteralsSignal,
  sharedLiteralsSignal,
  syncCommentsSignal
} from './signals/index.js';
import type { Candidate, DiscoverConfig, GitRunner, RepoHistory, RepoScan, Signal } from './types.js';

/** Every shipped signal, in deterministic execution order. */
const SIGNALS: readonly Signal[] = [
  clonesSignal,
  cochangeSignal,
  commitMessagesSignal,
  docReferencesSignal,
  implTestSignal,
  manifestWiringSignal,
  pathLiteralsSignal,
  sharedLiteralsSignal,
  syncCommentsSignal
];

/**
 * Everything one discovery run produces.
 */
export interface DiscoverResult {
  /** Working-tree snapshot the signals ran over. */
  scan: RepoScan;
  /** History snapshot the signals ran over. */
  history: RepoHistory;
  /** Final merged, ranked candidates (best first). */
  candidates: Candidate[];
}

/**
 * Run the full discovery pipeline against a repository.
 *
 * @param root - Absolute path to the repository root.
 * @param config - Resolved discovery options (see `resolveConfig`).
 * @param git - Git command runner; defaults to {@link defaultGitRunner}.
 * @returns The scan, history, and final ranked candidates.
 */
export function discover(root: string, config: DiscoverConfig, git: GitRunner = defaultGitRunner): DiscoverResult {
  const scan = scanRepo(root, config, git);
  const history = loadHistory(root, scan, config, git);
  const raw: Candidate[] = [];
  for (const signal of SIGNALS) {
    if (signal.applies(scan, history, config)) {
      raw.push(...signal.run(scan, history, config));
    }
  }
  return { scan, history, candidates: mergeCandidates(raw, config) };
}
