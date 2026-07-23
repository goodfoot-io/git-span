/**
 * Rename/move tracking — resolves each surviving group's anchors to their
 * current path and line range at HEAD.
 *
 * A signal anchors a candidate against the historical state it observed it in.
 * Before a group is reported, every anchor is carried forward to HEAD:
 *
 *   - **Path.** The net rename/copy between the group's reference revision and
 *     HEAD is read once via `git diff -M --name-status` (which collapses a
 *     multi-step `A → B → C` chain to a single `A → C` row), so a file that
 *     moved is reported under its current name.
 *   - **Line range.** For range anchors, the range is *carried forward through
 *     the rename chain* — re-diffing the anchor's file at the reference
 *     revision against its (possibly renamed) file at HEAD and shifting the
 *     range by the intervening insertions/deletions (à la
 *     `packages/git-span/src/resolver/walker.rs`'s `follow_moves`), so a group
 *     anchored at `foo.ts#L10-L20` that had lines inserted upstream still
 *     points at the semantically equivalent range at HEAD rather than the
 *     stale original line numbers.
 *
 * A group whose files were all deleted and never replaced (no anchor resolves
 * to a path that still exists at HEAD), or that resolves to fewer than 2
 * surviving anchors (a lone anchor is a leftover file, not a coupling), is
 * dropped from the output. Distinct input groups that resolve to the exact
 * same anchor set are merged into one output entry (evidence unioned) rather
 * than reported as separate rows.
 *
 * The reference revision is per-*anchor*, not per-group: a group's anchors can
 * legitimately have been observed at different commits (e.g. a
 * `time-window-co-edit`/`same-author-session` pairing cites one commit per
 * side of the pair, each corresponding to a different anchor), so diffing
 * every anchor against one shared "newest cited ref" can pick a base that is
 * too new for an anchor whose real origin commit is older, shifting its
 * carried-forward range incorrectly. For each anchor, the reference revision
 * is the newest cited commit/tag *that actually touched that anchor's path*
 * (checked against `RepoContext.commits()`'s per-commit file list) among the
 * group's evidence; when no evidence entry is attributable to the anchor at
 * all (e.g. after grouping merges evidence from multiple signal emissions and
 * attribution becomes ambiguous), it falls back to the group-wide newest
 * cited ref, same as before this per-anchor split existed. Both are looked up
 * against `RepoContext.commits()` / `.tags()` (both already `.span/`-excluded
 * and sweep-filtered), never by a fresh git call, so no new `.span/` access
 * path is introduced here.
 */

import { diffNameStatus, type NameStatusEntry } from './git.js';
import type { Anchor, AnchorGroup, RepoContext, SignalEvidence } from './types.js';

// ---------------------------------------------------------------------------
// Line-range carrying (LCS diff → hunk shifts → range remap)
// ---------------------------------------------------------------------------

/** One diff hunk: `oldCount` lines starting at `oldStart` become `newCount` lines starting at `newStart` (1-based). */
interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/** Cap on `oldLines.length * newLines.length` before the O(n·m) LCS is skipped as too expensive. */
const LCS_CELL_BUDGET = 4_000_000;

/**
 * Groups a line-level LCS edit script into hunks. Returns null (caller keeps
 * the original range) when the inputs are large enough that the O(n·m) DP would
 * be prohibitive — a prototype-appropriate guard, since scoped candidate groups
 * are few even on a large repo.
 */
function diffHunks(oldLines: string[], newLines: string[]): Hunk[] | null {
  const n = oldLines.length;
  const m = newLines.length;
  if (n * m > LCS_CELL_BUDGET) return null;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && oldLines[i] === newLines[j]) {
      i++;
      j++;
      continue;
    }
    // Start of a divergent region: consume deletes/inserts until lines realign.
    const oldStart = i;
    const newStart = j;
    while (i < n || j < m) {
      if (i < n && j < m && oldLines[i] === newLines[j]) break;
      if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) {
        i++;
      } else {
        j++;
      }
    }
    hunks.push({
      oldStart: oldStart + 1,
      oldCount: i - oldStart,
      newStart: newStart + 1,
      newCount: j - newStart
    });
  }
  return hunks;
}

/**
 * Shifts an inclusive `[start, end]` range through a list of hunks. Insertions
 * above the range push it down, deletions above pull it up, and edits that
 * straddle the range widen/clamp it to the changed region — the same
 * bookkeeping as walker.rs's `apply_hunks_to_range`.
 */
function applyHunksToRange(hunks: Hunk[], start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  for (const { oldStart, oldCount, newCount } of hunks) {
    const delta = newCount - oldCount;
    if (oldCount === 0) {
      // Pure insertion at `oldStart` (in old coordinates).
      if (oldStart < s) {
        s += delta;
        e += delta;
      } else if (oldStart <= e) {
        e += delta;
      }
      continue;
    }
    const oldLast = oldStart + oldCount - 1;
    if (oldLast < s) {
      s += delta;
      e += delta;
    } else if (oldStart > e) {
      // Entirely below the range — no effect.
    } else {
      const newLast = newCount === 0 ? oldStart : oldStart + newCount - 1;
      s = Math.max(1, Math.min(s, oldStart));
      e = Math.max(newLast, e + delta);
    }
  }
  s = Math.max(1, s);
  e = Math.max(s, e);
  return [s, e];
}

function toLines(content: string): string[] {
  // Split on newlines, dropping a single trailing empty element so a file
  // ending in "\n" is not counted as having an extra blank last line.
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

interface RenameInfo {
  /** old path → current path at HEAD (rename/copy target). */
  renamed: Map<string, string>;
  /** paths deleted with no rename target. */
  deleted: Set<string>;
}

/**
 * A rename resolver bound to one repository. Memoizes the evidence-SHA/tag
 * timestamp lookup and the per-reference-revision name-status diff so a whole
 * batch of groups sharing a reference revision pays for the diff once.
 */
export interface RenameResolver {
  resolve(group: AnchorGroup): Promise<AnchorGroup | null>;
}

export async function createRenameResolver(ctx: RepoContext): Promise<RenameResolver> {
  const time = new Map<string, number>();
  /** sha -> paths that commit's hunks touch, so a cited commit can be checked for whether it actually pertains to a given anchor. */
  const commitPaths = new Map<string, Set<string>>();
  for (const commit of await ctx.commits()) {
    const t = Date.parse(commit.date);
    if (Number.isFinite(t)) time.set(commit.sha, t);
    commitPaths.set(commit.sha, new Set(commit.files.map((f) => f.path)));
  }
  /** tag name -> sha, so a cited tag can be resolved to the commit it points at for the same path check. */
  const tagSha = new Map<string, string>();
  for (const tag of await ctx.tags()) {
    const t = Date.parse(tag.date);
    if (Number.isFinite(t)) time.set(tag.sha, t);
    tagSha.set(tag.name, tag.sha);
  }

  const renameCache = new Map<string, RenameInfo>();

  async function renameInfoFor(refRev: string): Promise<RenameInfo> {
    const cached = renameCache.get(refRev);
    if (cached) return cached;
    const renamed = new Map<string, string>();
    const deleted = new Set<string>();
    // A bad/ungraftable reference revision (e.g. a shallow clone whose ref is
    // outside the grafted history) yields no rename info: fall back to an empty
    // entry list so every path is treated as unchanged rather than throwing.
    let entries: NameStatusEntry[];
    try {
      entries = await diffNameStatus(ctx.repoRoot, refRev, 'HEAD');
    } catch (err) {
      entries = [];
      void err;
    }
    for (const entry of entries) {
      if ((entry.status === 'R' || entry.status === 'C') && entry.oldPath) {
        renamed.set(entry.oldPath, entry.path);
      } else if (entry.status === 'D') {
        deleted.add(entry.path);
      }
    }
    const info: RenameInfo = { renamed, deleted };
    renameCache.set(refRev, info);
    return info;
  }

  /** Newest evidence SHA/tag the group cites that we have a timestamp for, else 'HEAD'. */
  function referenceRevision(group: AnchorGroup): string {
    let best: string | null = null;
    let bestTime = Number.NEGATIVE_INFINITY;
    for (const evidence of group.evidence) {
      for (const ref of [...(evidence.commits ?? []), ...(evidence.tags ?? [])]) {
        const t = time.get(ref);
        if (t !== undefined && t > bestTime) {
          bestTime = t;
          best = ref;
        }
      }
    }
    return best ?? 'HEAD';
  }

  /**
   * Newest evidence SHA/tag that actually touched `anchor.path`, per
   * `commitPaths`/`tagSha`, else the group-wide `referenceRevision` fallback
   * documented in the module header (evidence attribution is ambiguous, or no
   * cited ref touches this anchor's path at all — e.g. a whole-file anchor
   * whose evidence only cites commits for its paired anchor).
   */
  function anchorReferenceRevision(anchor: Anchor, group: AnchorGroup): string {
    let best: string | null = null;
    let bestTime = Number.NEGATIVE_INFINITY;
    for (const evidence of group.evidence) {
      for (const sha of evidence.commits ?? []) {
        if (!commitPaths.get(sha)?.has(anchor.path)) continue;
        const t = time.get(sha);
        if (t !== undefined && t > bestTime) {
          bestTime = t;
          best = sha;
        }
      }
      for (const name of evidence.tags ?? []) {
        const sha = tagSha.get(name);
        if (sha === undefined || !commitPaths.get(sha)?.has(anchor.path)) continue;
        const t = time.get(sha);
        if (t !== undefined && t > bestTime) {
          bestTime = t;
          best = name;
        }
      }
    }
    return best ?? referenceRevision(group);
  }

  async function resolveAnchor(anchor: Anchor, refRev: string, info: RenameInfo): Promise<Anchor | null> {
    const currentPath = info.renamed.get(anchor.path);
    if (currentPath === undefined && info.deleted.has(anchor.path)) return null;
    const resolvedPath = currentPath ?? anchor.path;

    const headContent = await ctx.fileAt(resolvedPath, 'HEAD');
    if (headContent === null) return null; // deleted and never replaced

    if (anchor.startLine === undefined || anchor.endLine === undefined) {
      return { path: resolvedPath };
    }

    const oldContent = await ctx.fileAt(anchor.path, refRev);
    if (oldContent === null) {
      // Can't reconstruct the pre-image; keep the range but clamp to the file.
      const lineCount = toLines(headContent).length;
      const start = Math.max(1, Math.min(anchor.startLine, Math.max(1, lineCount)));
      const end = Math.max(start, Math.min(anchor.endLine, Math.max(1, lineCount)));
      return { path: resolvedPath, startLine: start, endLine: end };
    }

    const hunks = diffHunks(toLines(oldContent), toLines(headContent));
    let [start, end] = hunks
      ? applyHunksToRange(hunks, anchor.startLine, anchor.endLine)
      : [anchor.startLine, anchor.endLine];
    const lineCount = Math.max(1, toLines(headContent).length);
    start = Math.max(1, Math.min(start, lineCount));
    end = Math.max(start, Math.min(end, lineCount));
    return { path: resolvedPath, startLine: start, endLine: end };
  }

  return {
    async resolve(group: AnchorGroup): Promise<AnchorGroup | null> {
      const resolved: Anchor[] = [];
      for (const anchor of group.anchors) {
        const refRev = anchorReferenceRevision(anchor, group);
        const info = await renameInfoFor(refRev);
        const next = await resolveAnchor(anchor, refRev, info);
        if (next) resolved.push(next);
      }
      // A resolved group needs at least 2 surviving anchors to still describe
      // a *coupling*: a lone survivor (its partner(s) deleted and never
      // replaced) is just a leftover file, not a relationship between two
      // things, so it is dropped rather than reported.
      if (resolved.length < 2) return null;
      return { anchors: resolved, evidence: group.evidence, score: group.score };
    }
  };
}

function anchorSetKey(anchors: readonly Anchor[]): string {
  return [...anchors]
    .map((a) => `${a.path}:${a.startLine ?? ''}:${a.endLine ?? ''}`)
    .sort()
    .join('|');
}

function evidenceKey(evidence: SignalEvidence): string {
  return JSON.stringify([
    evidence.signal,
    evidence.strength,
    evidence.commits ?? [],
    evidence.tags ?? [],
    evidence.detail ?? ''
  ]);
}

/** Unions evidence arrays, dropping only exact duplicates, then sorts deterministically — mirrors grouping.ts's unionEvidence. */
function mergeEvidence(groups: readonly AnchorGroup[]): SignalEvidence[] {
  const seen = new Map<string, SignalEvidence>();
  for (const group of groups) {
    for (const evidence of group.evidence) {
      const key = evidenceKey(evidence);
      if (!seen.has(key)) seen.set(key, evidence);
    }
  }
  return [...seen.values()].sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b)));
}

/** One resolved group paired with an arbitrary per-group payload the caller wants carried through dedup (e.g. cli.ts's disqualifier results). */
export interface ResolvedWithPayload<T> {
  group: AnchorGroup;
  payload: T;
}

/**
 * Buckets already-HEAD-resolved groups by canonical anchor-set key and merges
 * any bucket with more than one member into a single entry: anchors from the
 * bucket's first member, evidence unioned across the bucket (mirrors
 * grouping.ts's unionEvidence), score as the bucket max, and payload merged
 * via the caller-supplied `mergePayloads` (e.g. cli.ts unions disqualifier
 * results the same way evidence is unioned). Order-preserving on each key's
 * first occurrence. This is the shared dedup step both
 * {@link resolveGroupsToHead} and cli.ts's `discover()` run through, so
 * production and tests exercise the identical logic rather than cli.ts
 * re-implementing it inline.
 */
export function dedupeResolvedByAnchorSet<T>(
  items: readonly ResolvedWithPayload<T>[],
  mergePayloads: (payloads: readonly T[]) => T
): ResolvedWithPayload<T>[] {
  const byAnchorSet = new Map<string, ResolvedWithPayload<T>[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = anchorSetKey(item.group.anchors);
    const bucket = byAnchorSet.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      byAnchorSet.set(key, [item]);
      order.push(key);
    }
  }

  const out: ResolvedWithPayload<T>[] = [];
  for (const key of order) {
    const bucket = byAnchorSet.get(key)!;
    if (bucket.length === 1) {
      out.push(bucket[0]);
      continue;
    }
    out.push({
      group: {
        anchors: bucket[0].group.anchors,
        evidence: mergeEvidence(bucket.map((item) => item.group)),
        score: Math.max(...bucket.map((item) => item.group.score))
      },
      payload: mergePayloads(bucket.map((item) => item.payload))
    });
  }
  return out;
}

/**
 * Resolves every group's anchors to HEAD, dropping groups whose files were all
 * deleted and never replaced (or that resolve to a single surviving anchor —
 * a lone anchor is a leftover file, not a coupling). Distinct input groups
 * that resolve to the exact same anchor set at HEAD (e.g. two originally
 * distinct pairs that each lost a different, now-deleted partner and share
 * the one surviving anchor) are merged into a single output entry, unioning
 * their evidence, rather than appearing as separate ranked report rows for
 * what is now the identical coupling. Convenience wrapper over
 * {@link createRenameResolver} and {@link dedupeResolvedByAnchorSet} (payload
 * is unused here — cli.ts's `discover()` is the caller that threads a real
 * payload, per-group disqualifier results, through the same dedup step).
 */
export async function resolveGroupsToHead(groups: readonly AnchorGroup[], ctx: RepoContext): Promise<AnchorGroup[]> {
  const resolver = await createRenameResolver(ctx);
  const resolved: ResolvedWithPayload<null>[] = [];
  for (const group of groups) {
    const next = await resolver.resolve(group);
    if (next) resolved.push({ group: next, payload: null });
  }
  return dedupeResolvedByAnchorSet(resolved, () => null).map((item) => item.group);
}
