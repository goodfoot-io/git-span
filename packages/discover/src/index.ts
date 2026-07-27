/**
 * Public entry point for @cards.management/discover.
 *
 * Exposes the full pipeline (`discover`), its stages (scan, history, merge),
 * every shipped signal, the path extractor, config resolution, and the CLI
 * runner.
 *
 * @summary Package barrel for the discovery pipeline.
 */

export { formatCandidateLine, formatLoc, runCli } from './cli.js';
export { DEFAULT_CONFIG, resolveConfig } from './config.js';
export { defaultGitRunner } from './git.js';
export { loadHistory } from './history.js';
export { mergeCandidates } from './merge.js';
export type { PathRef } from './paths.js';
export { buildPathExtractor } from './paths.js';
export type { DiscoverResult } from './pipeline.js';
export { discover } from './pipeline.js';
export { scanRepo } from './scan.js';
export {
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
export type {
  Candidate,
  ChangeGroup,
  CommitMeta,
  DiscoverConfig,
  GitRunner,
  Loc,
  RepoHistory,
  RepoScan,
  Signal
} from './types.js';
