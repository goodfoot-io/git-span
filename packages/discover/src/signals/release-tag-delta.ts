/**
 * Release-tag delta co-occurrence signal.
 *
 * File sets that co-occur across consecutive `git tag` intervals — catching
 * slower coupling than time-window's 6-hour window can see (plans/initial.md,
 * "Release-tag delta co-occurrence"). For each pair of consecutive tags
 * (ordered oldest to newest, per `RepoContext.tags()`), computes the set of
 * files changed in that interval from `RepoContext.commits()` — already
 * sweep-commit-filtered and `.span/`-excluded (design decisions 4 and 5) —
 * restricted to the commits whose author date falls in `(fromTag.date,
 * toTag.date]`, rather than a raw `git diff --name-only tagA..tagB`. A raw
 * tree diff can't distinguish "these files co-occurred because of a repeating
 * pattern" from "these files were both touched by one large sweep/refactor
 * commit between the two tags" — exactly the false-positive source the
 * sweep-commit pre-filter exists to remove everywhere else in the pipeline.
 * Reading through `ctx.commits()` means that filter applies here too, instead
 * of this signal duplicating it.
 *
 * Two files that repeatedly land in the same tag-interval file set together
 * are reported as a candidate anchor group, scored by how many of the
 * intervals they co-occurred in.
 *
 * Anchors are whole-file: a tag-interval only tells us a file changed
 * somewhere between two tags, not which lines within it, so there is no
 * hunk-level range to anchor to (unlike time-window's per-hunk anchors).
 *
 * Design decision 9 (plans/initial.md): this is the signal a tagless repo
 * hits directly. `RepoContext.tags()` returns `[]` on a repo with no tags, and
 * fewer than two tags means there are zero consecutive-tag intervals to
 * compare — this signal returns `[]` in that case rather than throwing.
 */

import type { AnchorGroup, Commit, RepoContext, Signal, SignalEvidence, Tag } from '../types.js';

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

/**
 * Commits from the already-filtered `ctx.commits()` history that fall in the
 * range `(fromTag, toTag]` — the pre-filtered stand-in for `git diff
 * fromTag..toTag`'s raw tree comparison. `commits()` lists history newest
 * first (git log's default order), so with `toTag` newer than `fromTag`,
 * that range is the slice from `toTag`'s commit up to (excluding) `fromTag`'s
 * commit. Either tag's commit missing from `commits()` (e.g. excluded as a
 * sweep commit itself) yields no commits for the interval rather than
 * guessing a range.
 */
function commitsInInterval(commits: readonly Commit[], fromTag: Tag, toTag: Tag): Commit[] {
  const fromIndex = commits.findIndex((commit) => commit.sha === fromTag.sha);
  const toIndex = commits.findIndex((commit) => commit.sha === toTag.sha);
  if (fromIndex === -1 || toIndex === -1 || toIndex > fromIndex) return [];
  return commits.slice(toIndex, fromIndex);
}

/** The changed-file set for each consecutive pair of tags, oldest to newest. */
function buildIntervals(commits: readonly Commit[], orderedTags: readonly Tag[]): TagInterval[] {
  const intervals: TagInterval[] = [];
  for (let i = 0; i + 1 < orderedTags.length; i++) {
    const fromTag = orderedTags[i];
    const toTag = orderedTags[i + 1];
    const files = new Set<string>();
    for (const commit of commitsInInterval(commits, fromTag, toTag)) {
      for (const file of commit.files) files.add(file.path);
    }
    intervals.push({ fromTag, toTag, files: [...files].sort() });
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

  const commits = await ctx.commits();
  const intervals = buildIntervals(commits, orderedTags);
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
