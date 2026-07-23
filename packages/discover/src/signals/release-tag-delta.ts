/**
 * Release-tag delta co-occurrence signal.
 *
 * File sets that co-occur across consecutive `git tag` intervals — catching
 * slower coupling than time-window's 6-hour window can see (plans/initial.md,
 * "Release-tag delta co-occurrence"). For each pair of consecutive tags
 * (ordered oldest to newest, per `RepoContext.tags()`), computes the set of
 * files changed in that interval via `git diff --name-only tagA..tagB`
 * (`diffNameOnly` in src/git.ts). Two files that repeatedly land in the same
 * tag-interval diff together are reported as a candidate anchor group, scored
 * by how many of the intervals they co-occurred in.
 *
 * Anchors are whole-file: a tag-interval diff only tells us a file changed
 * somewhere between two tags, not which lines within it, so there is no
 * hunk-level range to anchor to (unlike time-window's per-hunk anchors).
 *
 * Design decision 9 (plans/initial.md): this is the signal a tagless repo
 * hits directly. `RepoContext.tags()` returns `[]` on a repo with no tags, and
 * fewer than two tags means there are zero consecutive-tag intervals to
 * compare — this signal returns `[]` in that case rather than throwing.
 */

import { diffNameOnly } from '../git.js';
import { isSpanPath } from '../prefilter.js';
import type { AnchorGroup, RepoContext, Signal, SignalEvidence, Tag } from '../types.js';

/** Evidence label for this signal's output. */
const EVIDENCE_LABEL = 'release-tag-delta';

/**
 * A pair must co-occur in at least this many tag intervals to be reported —
 * "co-occur across consecutive tag intervals" is inherently plural; a single
 * shared interval is just two files that happened to change in one release,
 * not a repeating pattern.
 */
const MIN_CO_OCCURRENCES = 2;

interface TagInterval {
  fromTag: Tag;
  toTag: Tag;
  /** Distinct, `.span/`-excluded file paths changed between fromTag and toTag. */
  files: string[];
}

/** The changed-file set for each consecutive pair of tags, oldest to newest. */
async function buildIntervals(repoRoot: string, orderedTags: readonly Tag[]): Promise<TagInterval[]> {
  const intervals: TagInterval[] = [];
  for (let i = 0; i + 1 < orderedTags.length; i++) {
    const fromTag = orderedTags[i];
    const toTag = orderedTags[i + 1];
    const changed = await diffNameOnly(repoRoot, fromTag.sha, toTag.sha);
    const files = [...new Set(changed.filter((path) => !isSpanPath(path)))].sort();
    intervals.push({ fromTag, toTag, files });
  }
  return intervals;
}

interface PairCoOccurrence {
  pathA: string;
  pathB: string;
  count: number;
  tagNames: Set<string>;
}

const releaseTagDeltaSignal: Signal = async (ctx: RepoContext): Promise<AnchorGroup[]> => {
  const orderedTags = await ctx.tags();
  // Design decision 9: zero or one tags means zero intervals to compare.
  if (orderedTags.length < 2) return [];

  const intervals = await buildIntervals(ctx.repoRoot, orderedTags);
  const totalIntervals = intervals.length;
  if (totalIntervals === 0) return [];

  const pairs = new Map<string, PairCoOccurrence>();
  for (const interval of intervals) {
    const { files } = interval;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = `${files[i]}\0${files[j]}`;
        let entry = pairs.get(key);
        if (!entry) {
          entry = { pathA: files[i], pathB: files[j], count: 0, tagNames: new Set() };
          pairs.set(key, entry);
        }
        entry.count += 1;
        entry.tagNames.add(interval.toTag.name);
      }
    }
  }

  const groups: AnchorGroup[] = [];
  for (const entry of pairs.values()) {
    if (entry.count < MIN_CO_OCCURRENCES) continue;

    // Clamp defensively (design decision 7) — count/totalIntervals is already
    // bounded in [0, 1] since count never exceeds totalIntervals, but scoring
    // wants a hard guarantee no signal can hand it an out-of-range value.
    const strength = Math.min(1, Math.max(0, entry.count / totalIntervals));
    if (!Number.isFinite(strength) || strength <= 0) continue;

    const evidence: SignalEvidence = {
      signal: EVIDENCE_LABEL,
      strength,
      tags: [...entry.tagNames].sort(),
      detail: `${entry.pathA} and ${entry.pathB} co-changed across ${entry.count} of ${totalIntervals} consecutive tag intervals`
    };

    groups.push({
      anchors: [{ path: entry.pathA }, { path: entry.pathB }],
      evidence: [evidence],
      score: strength
    });
  }

  return groups;
};

export default releaseTagDeltaSignal;
