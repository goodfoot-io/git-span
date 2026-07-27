/**
 * Near-duplicate region ("clone") coupling signal.
 *
 * Files that contain a long, near-identical block of lines are prone to
 * silent drift: someone fixes a bug or changes a behavior in one copy and
 * forgets the other. This signal finds such regions using winnowing over
 * line-shingle hashes — a standard MOSS/plagiarism-detection technique — so
 * it runs close to O(total text) rather than comparing file contents
 * pairwise.
 *
 * @summary Detects near-duplicate line ranges shared across file pairs.
 */

import type { Candidate, DiscoverConfig, Loc, RepoHistory, RepoScan, Signal } from '../types.js';

const SIGNAL_NAME = 'clones';
const MIN_RAW_LINES = 30;
const SHINGLE_SIZE = 5;
const WINNOW_WINDOW = 4;
const MAX_FILES_PER_HASH = 5;
const MIN_SHARED_FINGERPRINTS = 8;
const MIN_COVERAGE_RATIO = 0.15;
const MAX_RUN_GAP = 10;
const MAX_RUNS_PER_FILE = 2;
const RUN_END_PADDING = 4;
const MAX_PAIRS = 120;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit hash of a string, returned as an unsigned integer.
 *
 * @param input - Text to hash.
 * @returns 32-bit unsigned hash value.
 */
function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

interface NormalizedLine {
  readonly text: string;
  readonly originalLine: number;
}

function isPureCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function normalizeLines(rawLines: readonly string[]): NormalizedLine[] {
  const out: NormalizedLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = (rawLines[i] ?? '').trim();
    if (trimmed.length === 0 || isPureCommentLine(trimmed)) continue;
    out.push({ text: trimmed.replace(/\s+/g, ' '), originalLine: i + 1 });
  }
  return out;
}

interface Shingle {
  readonly hash: number;
  readonly position: number;
}

function buildShingles(normalized: readonly NormalizedLine[]): Shingle[] {
  const shingles: Shingle[] = [];
  for (let i = 0; i + SHINGLE_SIZE <= normalized.length; i++) {
    const first = normalized[i];
    if (first === undefined) continue;
    let text = '';
    for (let k = 0; k < SHINGLE_SIZE; k++) {
      if (k > 0) text += '\n';
      text += normalized[i + k]?.text ?? '';
    }
    shingles.push({ hash: fnv1a32(text), position: first.originalLine });
  }
  return shingles;
}

interface Fingerprint {
  readonly hash: number;
  readonly position: number;
}

/**
 * Winnows a shingle sequence: within every sliding window of
 * {@link WINNOW_WINDOW} consecutive shingles, keeps the rightmost minimal
 * hash, and drops re-selections of the same shingle instance so consecutive
 * windows do not emit duplicate fingerprints.
 *
 * @param shingles - Shingle sequence for one file, in position order.
 * @returns The file's fingerprints (hash + originating position).
 */
function winnow(shingles: readonly Shingle[]): Fingerprint[] {
  const fingerprints: Fingerprint[] = [];
  let lastSelectedIndex = -1;
  for (let i = 0; i + WINNOW_WINDOW <= shingles.length; i++) {
    let minIndex = i;
    for (let j = i + 1; j < i + WINNOW_WINDOW; j++) {
      const candidate = shingles[j];
      const best = shingles[minIndex];
      if (candidate !== undefined && best !== undefined && candidate.hash <= best.hash) {
        minIndex = j;
      }
    }
    if (minIndex !== lastSelectedIndex) {
      const chosen = shingles[minIndex];
      if (chosen !== undefined) {
        fingerprints.push({ hash: chosen.hash, position: chosen.position });
        lastSelectedIndex = minIndex;
      }
    }
  }
  return fingerprints;
}

function fingerprintsForFile(rawLines: readonly string[]): Fingerprint[] {
  return winnow(buildShingles(normalizeLines(rawLines)));
}

/** hash -> distinct files it appears in; `null` once pruned as boilerplate (> MAX_FILES_PER_HASH files). */
type HashPostings = Map<number, string[] | null>;

function recordHashPosting(postings: HashPostings, hash: number, path: string): void {
  const slot = postings.get(hash);
  if (slot === null) return;
  if (slot === undefined) {
    postings.set(hash, [path]);
    return;
  }
  if (slot.includes(path)) return;
  if (slot.length >= MAX_FILES_PER_HASH) {
    postings.set(hash, null);
    return;
  }
  slot.push(path);
}

interface PairAccumulator {
  readonly a: string;
  readonly b: string;
  readonly sharedHashes: Set<number>;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

interface Run {
  start: number;
  end: number;
}

function mergeRuns(positions: readonly number[]): Run[] {
  const sorted = [...positions].sort((x, y) => x - y);
  const runs: Run[] = [];
  for (const pos of sorted) {
    const last = runs.at(-1);
    if (last && pos - last.end <= MAX_RUN_GAP) {
      last.end = pos;
    } else {
      runs.push({ start: pos, end: pos });
    }
  }
  return runs;
}

function runsToLocs(path: string, positions: readonly number[], lineCount: number): Loc[] {
  const runs = mergeRuns(positions);
  runs.sort((x, y) => y.end - y.start - (x.end - x.start));
  const kept = runs.slice(0, MAX_RUNS_PER_FILE);
  kept.sort((x, y) => x.start - y.start);
  return kept.map((run) => ({ path, start: run.start, end: Math.min(lineCount, run.end + RUN_END_PADDING) }));
}

/**
 * Signal that pairs files sharing a near-duplicate region of lines.
 */
export const clonesSignal: Signal = {
  name: SIGNAL_NAME,

  applies(): boolean {
    return true;
  },

  run(scan: RepoScan, _history: RepoHistory, _config: DiscoverConfig): Candidate[] {
    const fingerprintsByFile = new Map<string, Fingerprint[]>();
    const postings: HashPostings = new Map();

    for (const path of scan.files) {
      if (path.endsWith('.md') || path.endsWith('.mdx')) continue;
      const rawLines = scan.lines.get(path);
      if (rawLines === undefined || rawLines.length < MIN_RAW_LINES) continue;
      const fingerprints = fingerprintsForFile(rawLines);
      if (fingerprints.length === 0) continue;
      fingerprintsByFile.set(path, fingerprints);
      for (const fp of fingerprints) {
        recordHashPosting(postings, fp.hash, path);
      }
    }

    const pairs = new Map<string, PairAccumulator>();
    for (const [hash, files] of postings) {
      if (files === null || files.length < 2) continue;
      const sorted = [...files].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i];
          const b = sorted[j];
          if (a === undefined || b === undefined) continue;
          const key = pairKey(a, b);
          const existing = pairs.get(key);
          if (existing) {
            existing.sharedHashes.add(hash);
          } else {
            pairs.set(key, { a, b, sharedHashes: new Set([hash]) });
          }
        }
      }
    }

    const candidates: Candidate[] = [];
    for (const pair of pairs.values()) {
      const fpA = fingerprintsByFile.get(pair.a);
      const fpB = fingerprintsByFile.get(pair.b);
      if (fpA === undefined || fpB === undefined) continue;
      const shared = pair.sharedHashes.size;
      const smallerTotal = Math.min(fpA.length, fpB.length);
      if (shared < MIN_SHARED_FINGERPRINTS || shared < MIN_COVERAGE_RATIO * smallerTotal) continue;

      const linesA = scan.lines.get(pair.a) ?? [];
      const linesB = scan.lines.get(pair.b) ?? [];
      const positionsA = fpA.filter((fp) => pair.sharedHashes.has(fp.hash)).map((fp) => fp.position);
      const positionsB = fpB.filter((fp) => pair.sharedHashes.has(fp.hash)).map((fp) => fp.position);

      const coverage = smallerTotal === 0 ? 0 : Math.min(1, shared / smallerTotal);
      candidates.push({
        locs: [...runsToLocs(pair.a, positionsA, linesA.length), ...runsToLocs(pair.b, positionsB, linesB.length)],
        score: 0.55 + 0.25 * coverage,
        signal: SIGNAL_NAME,
        evidence: [`clone:${shared}/${smallerTotal}`]
      });
    }

    candidates.sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      const xa = x.locs[0]?.path ?? '';
      const xb = x.locs[1]?.path ?? '';
      const ya = y.locs[0]?.path ?? '';
      const yb = y.locs[1]?.path ?? '';
      return xa === ya ? xb.localeCompare(yb) : xa.localeCompare(ya);
    });

    return candidates.slice(0, MAX_PAIRS);
  }
};
