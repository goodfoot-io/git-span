/**
 * Report rendering — emits the surviving, HEAD-resolved candidate groups as
 * machine-readable JSON and a human-readable markdown summary.
 *
 * Each rendered group carries its final score, which signals and disqualifiers
 * contributed, and the supporting commit/tag references from the evidence
 * trail. Anchors are rendered in `path#Lstart-Lend` shape, or bare `path` for
 * whole-file anchors.
 */

import type { Anchor, DisqualifierEvidence, SignalEvidence } from './types.js';

/**
 * A candidate group ready for output: HEAD-resolved anchors, the final pass-2
 * score, and the full signal + disqualifier evidence behind it.
 */
export interface DiscoveredGroup {
  anchors: Anchor[];
  score: number;
  signals: SignalEvidence[];
  disqualifiers: DisqualifierEvidence[];
}

/** Renders an anchor as `path#Lstart-Lend`, or bare `path` when it is whole-file. */
export function formatAnchor(anchor: Anchor): string {
  if (anchor.startLine === undefined || anchor.endLine === undefined) return anchor.path;
  return `${anchor.path}#L${anchor.startLine}-L${anchor.endLine}`;
}

interface JsonEvidence {
  signal: string;
  strength: number;
  commits?: string[];
  tags?: string[];
  detail?: string;
}

interface JsonDisqualifier {
  disqualifier: string;
  strength: number;
  inconclusive?: boolean;
  detail?: string;
}

interface JsonGroup {
  score: number;
  anchors: string[];
  signals: JsonEvidence[];
  disqualifiers: JsonDisqualifier[];
}

function toJsonGroup(group: DiscoveredGroup): JsonGroup {
  return {
    score: group.score,
    anchors: group.anchors.map(formatAnchor),
    signals: group.signals.map((e) => ({
      signal: e.signal,
      strength: e.strength,
      ...(e.commits && e.commits.length > 0 ? { commits: e.commits } : {}),
      ...(e.tags && e.tags.length > 0 ? { tags: e.tags } : {}),
      ...(e.detail ? { detail: e.detail } : {})
    })),
    disqualifiers: group.disqualifiers.map((d) => ({
      disqualifier: d.disqualifier,
      strength: d.strength,
      ...(d.inconclusive ? { inconclusive: true } : {}),
      ...(d.detail ? { detail: d.detail } : {})
    }))
  };
}

/** Serializes the report as pretty-printed JSON, groups ranked by descending score. */
export function toJson(groups: readonly DiscoveredGroup[]): string {
  const ranked = [...groups].sort((a, b) => b.score - a.score);
  return JSON.stringify({ groups: ranked.map(toJsonGroup) }, null, 2);
}

function uniqueRefs(groups: DiscoveredGroup): { commits: string[]; tags: string[] } {
  const commits = new Set<string>();
  const tags = new Set<string>();
  for (const e of groups.signals) {
    for (const c of e.commits ?? []) commits.add(c);
    for (const t of e.tags ?? []) tags.add(t);
  }
  return { commits: [...commits].sort(), tags: [...tags].sort() };
}

/** Renders a human-readable markdown summary, groups ranked by descending score. */
export function toMarkdown(groups: readonly DiscoveredGroup[]): string {
  const ranked = [...groups].sort((a, b) => b.score - a.score);
  const lines: string[] = ['# Implicit dependency candidates', ''];

  if (ranked.length === 0) {
    lines.push('_No candidate groups met the reporting threshold._', '');
    return lines.join('\n');
  }

  lines.push(`${ranked.length} candidate group${ranked.length === 1 ? '' : 's'} found.`, '');

  ranked.forEach((group, index) => {
    lines.push(`## ${index + 1}. score ${group.score.toFixed(3)}`, '');
    lines.push('Anchors:');
    for (const anchor of group.anchors) lines.push(`- \`${formatAnchor(anchor)}\``);
    lines.push('');

    const signalLabels = [...new Set(group.signals.map((e) => e.signal))].sort();
    lines.push(`Signals: ${signalLabels.length > 0 ? signalLabels.join(', ') : '(none)'}`);

    // `strength` is a probability the group is NOT a real coupling (types.ts) — disqualifiers
    // that found nothing still report a nonzero floor (design decision 7, see
    // raw-path-inclusion.ts), so ">0.5" (more likely disqualifying than not) is the correct
    // "did this actually fire" test, not ">0".
    const activeDisqualifiers = group.disqualifiers.filter((d) => !d.inconclusive && d.strength > 0.5);
    if (activeDisqualifiers.length > 0) {
      lines.push(`Disqualifiers: ${[...new Set(activeDisqualifiers.map((d) => d.disqualifier))].sort().join(', ')}`);
    }
    const inconclusive = group.disqualifiers.filter((d) => d.inconclusive);
    if (inconclusive.length > 0) {
      lines.push(
        `Inconclusive disqualifiers: ${[...new Set(inconclusive.map((d) => d.disqualifier))].sort().join(', ')}`
      );
    }

    const { commits, tags } = uniqueRefs(group);
    if (commits.length > 0) lines.push(`Commits: ${commits.map((c) => c.slice(0, 8)).join(', ')}`);
    if (tags.length > 0) lines.push(`Tags: ${tags.join(', ')}`);
    lines.push('');
  });

  return lines.join('\n');
}
