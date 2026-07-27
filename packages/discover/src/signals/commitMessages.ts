/**
 * Detects couplings asserted by commit messages: when a commit's message
 * names a handful of repository paths, the author is telling us those files
 * changed for one reason. Ports `sig_commit_message_paths` from the Python
 * span-recovery prototype; confidence scales with how well this repository's
 * commit messages tend to name real paths ({@link RepoHistory.messageQuality}).
 *
 * @summary Commit-message path-group coupling signal.
 */

import { buildPathExtractor } from '../paths.js';
import type { Candidate, DiscoverConfig, RepoHistory, RepoScan, Signal } from '../types.js';

const SIGNAL_NAME = 'commit-messages';
const MIN_HISTORY_COMMITS = 20;
const MIN_MESSAGE_QUALITY = 0.05;
const MIN_PATHS = 2;
const MAX_PATHS = 5;
const BASE_SCORE = 0.58;
const PER_EXTRA_PATH_PENALTY = 0.03;
const RANGED_BONUS = 0.1;
const MIN_RANGED_REFS = 2;
const CORROBORATION_BONUS = 0.05;
const QUALITY_SCALE_FLOOR = 0.55;
const QUALITY_SCALE_SPAN = 0.45;
const QUALITY_SCALE_REFERENCE = 0.35;
const MAX_SCORE = 0.85;
const EVIDENCE_SHA_LEN = 7;

/**
 * Coupling signal that groups the repository paths named together in a
 * single non-release commit message.
 */
export const commitMessagesSignal: Signal = {
  name: SIGNAL_NAME,

  applies(_scan: RepoScan, history: RepoHistory, config: DiscoverConfig): boolean {
    return (
      config.useCommitMessages &&
      history.commits.length >= MIN_HISTORY_COMMITS &&
      history.messageQuality >= MIN_MESSAGE_QUALITY
    );
  },

  run(scan: RepoScan, history: RepoHistory, _config: DiscoverConfig): Candidate[] {
    const extract = buildPathExtractor(scan);
    const qualityScale =
      QUALITY_SCALE_FLOOR + QUALITY_SCALE_SPAN * Math.min(1, history.messageQuality / QUALITY_SCALE_REFERENCE);

    const candidates: Candidate[] = [];
    for (const commit of history.commits) {
      if (commit.isRelease) continue;
      const message = history.messages.get(commit.sha);
      if (message === undefined) continue;

      const refs = extract(message);
      const distinctPaths = new Set(refs.map((ref) => ref.loc.path));
      if (distinctPaths.size < MIN_PATHS || distinctPaths.size > MAX_PATHS) continue;

      let score = BASE_SCORE - PER_EXTRA_PATH_PENALTY * (distinctPaths.size - MIN_PATHS);
      const rangedCount = refs.filter((ref) => ref.loc.start !== undefined).length;
      if (rangedCount >= MIN_RANGED_REFS) score += RANGED_BONUS;

      const commitFiles = new Set(commit.files);
      const corroborated = [...distinctPaths].every((path) => commitFiles.has(path));
      if (corroborated) score += CORROBORATION_BONUS;

      score *= qualityScale;

      candidates.push({
        locs: refs.map((ref) => ref.loc),
        score: Math.min(MAX_SCORE, score),
        signal: SIGNAL_NAME,
        evidence: [`msg:${commit.sha.slice(0, EVIDENCE_SHA_LEN)}`]
      });
    }
    return candidates;
  }
};
