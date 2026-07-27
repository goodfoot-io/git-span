/**
 * Merge layer: combines per-signal candidates that name the same file set,
 * damps doc-only hyperlink clusters, drops weak subset/superset duplicates,
 * and produces the final ranked list.
 *
 * @summary Candidate merging, damping, dedup, and ranking.
 */

import type { Candidate, DiscoverConfig, Loc } from './types.js';

/** Discount applied to each additional same-set piece of evidence. */
const ATTENUATION = 0.55;
/** Damper for doc-only groups without commit/sync backing. */
const DOC_ONLY_DAMPER = 0.78;
/** Hard ceiling on merged confidence. */
const MAX_MERGED_SCORE = 0.98;
/** Maximum evidence tags carried by a merged candidate. */
const MAX_EVIDENCE = 5;
/** A subset/superset survives only at ≥ this ratio of the stronger score. */
const SUBSET_KEEP_RATIO = 0.75;
/** Signals whose backing exempts a doc-only group from damping. */
const DOC_BACKED_SIGNALS = new Set(['commit-messages', 'sync-comments']);

/**
 * Copy a Loc without carrying `undefined`-valued range properties.
 *
 * @param loc - Location to copy.
 * @returns A fresh Loc.
 */
function cloneLoc(loc: Loc): Loc {
  const out: Loc = { path: loc.path };
  if (loc.start !== undefined) {
    out.start = loc.start;
  }
  if (loc.end !== undefined) {
    out.end = loc.end;
  }
  return out;
}

/**
 * Whether `path` equals or lives under one of the excluded prefixes.
 *
 * @param path - Repository-relative path.
 * @param exclude - Normalized exclude prefixes.
 * @returns True when excluded.
 */
function isExcluded(path: string, exclude: readonly string[]): boolean {
  return exclude.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Whether every member of `a` is in `b`.
 *
 * @param a - Candidate subset.
 * @param b - Candidate superset.
 * @returns True when `a` ⊆ `b`.
 */
function isSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size > b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
}

/**
 * Merge raw signal candidates into a ranked, deduplicated final list.
 *
 * Same-set candidates combine via attenuated noisy-or (correlated evidence
 * contributes at a discounted rate); doc-only groups without commit-message
 * or sync-comment backing are damped; weak strict subsets/supersets of a
 * stronger group are dropped; the result is filtered by `config.minScore`
 * and capped at `config.maxCandidates`.
 *
 * Fails closed: a candidate naming a path under `config.exclude` is a signal
 * bug and throws.
 *
 * @param candidates - Raw candidates from every signal.
 * @param config - Discovery options (exclude prefixes, score floor, cap).
 * @returns Ranked merged candidates, best first.
 * @throws Error when any candidate names a path under `config.exclude`.
 */
export function mergeCandidates(candidates: readonly Candidate[], config: DiscoverConfig): Candidate[] {
  const bySet = new Map<string, { paths: string[]; members: Candidate[] }>();
  for (const candidate of candidates) {
    for (const loc of candidate.locs) {
      if (isExcluded(loc.path, config.exclude)) {
        throw new Error(`signal "${candidate.signal}" produced an excluded path: ${loc.path}`);
      }
    }
    const paths = [...new Set(candidate.locs.map((loc) => loc.path))].sort();
    if (paths.length < 2) {
      continue;
    }
    const key = paths.join('\u0000');
    const entry = bySet.get(key);
    if (entry) {
      entry.members.push(candidate);
    } else {
      bySet.set(key, { paths, members: [candidate] });
    }
  }

  const pathsOf = new Map<Candidate, string[]>();
  const merged: Candidate[] = [];
  for (const { paths, members } of bySet.values()) {
    members.sort((a, b) => b.score - a.score || a.signal.localeCompare(b.signal));
    let score = 0;
    for (const [i, member] of members.entries()) {
      score = 1 - (1 - score) * (1 - member.score * ATTENUATION ** i);
    }
    score = Math.min(MAX_MERGED_SCORE, score);

    const evidence: string[] = [];
    collect: for (const member of members) {
      for (const tag of member.evidence) {
        if (evidence.length >= MAX_EVIDENCE) {
          break collect;
        }
        if (!evidence.includes(tag)) {
          evidence.push(tag);
        }
      }
    }

    const signals = [...new Set(members.map((member) => member.signal))].sort();
    const docOnly = paths.every((path) => path.endsWith('.md') || path.endsWith('.mdx'));
    if (docOnly && !signals.some((name) => DOC_BACKED_SIGNALS.has(name))) {
      score *= DOC_ONLY_DAMPER;
    }

    const best = members[0];
    if (best === undefined) {
      continue;
    }
    const out: Candidate = { locs: best.locs.map(cloneLoc), score, signal: signals.join('+'), evidence };
    pathsOf.set(out, paths);
    merged.push(out);
  }

  merged.sort(
    (a, b) => b.score - a.score || (pathsOf.get(a) ?? []).join('|').localeCompare((pathsOf.get(b) ?? []).join('|'))
  );

  const kept: Candidate[] = [];
  for (const candidate of merged) {
    const candidateSet = new Set(pathsOf.get(candidate) ?? []);
    let drop = false;
    for (const stronger of kept) {
      const strongerSet = new Set(pathsOf.get(stronger) ?? []);
      const related = isSubset(candidateSet, strongerSet) || isSubset(strongerSet, candidateSet);
      if (related && candidate.score < SUBSET_KEEP_RATIO * stronger.score) {
        drop = true;
        break;
      }
    }
    if (!drop) {
      kept.push(candidate);
    }
  }

  return kept.filter((candidate) => candidate.score >= config.minScore).slice(0, config.maxCandidates);
}
