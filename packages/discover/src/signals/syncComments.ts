/**
 * Detects "keep in sync" style comments in tracked text files and resolves
 * them to the paths or backticked identifiers they name. Ports
 * `sig_sync_comments` from the Python span-recovery prototype.
 *
 * @summary "Keep in sync" comment coupling signal.
 */

import type { PathRef } from '../paths.js';
import { buildPathExtractor } from '../paths.js';
import { escapeRegExp } from '../scan.js';
import type { Candidate, DiscoverConfig, Loc, RepoHistory, RepoScan, Signal } from '../types.js';

const SIGNAL_NAME = 'sync-comments';

/** Phrases that assert "this needs to change together with something else". */
const SYNC_PHRASES = [
  String.raw`keep\b.{0,30}\bin\s+sync`,
  String.raw`kept\s+in\s+sync`,
  String.raw`stays?\s+in\s+sync`,
  String.raw`in\s+sync\s+with`,
  String.raw`must\s+(?:match|mirror|agree|stay|be\s+kept)`,
  String.raw`mirror(?:s|ed)?\s+(?:of|in|the)\b`,
  String.raw`duplicat(?:e|ed|es)\s+(?:of|in|from|at)\b`,
  String.raw`same\s+(?:as|list|shape|value|order)\s+(?:as|in)\b`,
  String.raw`copy\s+of\b`,
  String.raw`copied\s+(?:from|to)\b`,
  String.raw`keep\s+(?:this|these|them|it|aligned)`,
  String.raw`remember\s+to\s+update`,
  String.raw`also\s+update\b`,
  String.raw`update\b.{0,50}\b(?:accordingly|as\s+well|too)\b`,
  String.raw`if\s+you\s+(?:change|rename|move|add|remove|update)\b`,
  String.raw`when\s+(?:changing|updating|adding|renaming)\b`,
  String.raw`source\s+of\s+truth`,
  String.raw`canonical\s+(?:list|definition|source|home)`
] as const;
const SYNC_PHRASE_RE = new RegExp(SYNC_PHRASES.map((phrase) => `(?:${phrase})`).join('|'), 'i');

const CONTEXT_RADIUS = 2;
/** A backticked identifier long enough to plausibly be a real symbol name. */
const BACKTICK_IDENT_RE = /`([A-Za-z_$][A-Za-z0-9_.$-]{4,60})`/g;
const IDENT_STOPWORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'string',
  'number',
  'boolean',
  'default',
  'config',
  'options',
  'version',
  'import',
  'export',
  'package',
  'return',
  'async',
  'await',
  'public',
  'private',
  'readonly',
  'object'
]);
const MIN_IDENT_LEN = 6;
const PATH_TARGET_SCORE = 0.86;
const IDENT_TARGET_SCORE = 0.6;
const MAX_IDENT_MATCHES = 3;
/** Whole-word identifiers are exactly the tokens this pattern matches; others need the regex fallback. */
const WORD_IDENT_RE = /^[A-Za-z0-9_]+$/;
/** Maximal whole-word runs scanned when indexing; identical to the `\b`-bounded notion for word-only idents. */
const WORD_TOKEN_RE = /[A-Za-z0-9_]+/g;
/**
 * Postings kept per indexed token: the first {@link MAX_IDENT_MATCHES} + 2
 * files in scan order always suffice, because a lookup excludes at most one
 * file (the comment's own) before truncating to the match cap, so a
 * cap + 1-entry suffix survives any single exclusion.
 */
const MAX_INDEXED_FILES = MAX_IDENT_MATCHES + 2;

/**
 * Clamp a 1-based line number to the valid `[1, lineCount]` range.
 *
 * @param line - Candidate line number, possibly outside the file's bounds.
 * @param lineCount - Total number of lines in the file.
 * @returns The line number clamped into range.
 */
function clampLine(line: number, lineCount: number): number {
  return Math.min(Math.max(line, 1), lineCount);
}

/**
 * Coupling signal that resolves "keep in sync"-style comments to the file(s)
 * or identifier(s) they reference.
 */
export const syncCommentsSignal: Signal = {
  name: SIGNAL_NAME,

  applies(_scan: RepoScan, _history: RepoHistory, _config: DiscoverConfig): boolean {
    return true;
  },

  run(scan: RepoScan, _history: RepoHistory, _config: DiscoverConfig): Candidate[] {
    const extract = buildPathExtractor(scan);
    const candidates: Candidate[] = [];

    // Pass 1 discovers every sync-comment hit in encounter order but defers
    // all candidate pushes to pass 2, so identifier resolution — served from
    // an index built once between the passes — cannot reorder the output
    // relative to path-target hits discovered earlier or later.
    const wanted = new Set<string>();
    const pendingHits: PendingSyncHit[] = [];

    for (const file of scan.files) {
      const lines = scan.lines.get(file);
      if (!lines || lines.length === 0) continue;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (!SYNC_PHRASE_RE.test(line)) continue;

        const hitLine = i + 1;
        const contextStart = clampLine(hitLine - CONTEXT_RADIUS, lines.length);
        const contextEnd = clampLine(hitLine + CONTEXT_RADIUS, lines.length);
        const contextText = lines.slice(contextStart - 1, contextEnd).join('\n');
        const selfLoc = { path: file, start: contextStart, end: contextEnd };
        const evidence = [`sync:${file}#L${hitLine}`];

        const targets = new Map<string, PathRef>();
        for (const ref of extract(contextText, file)) {
          if (ref.loc.path !== file && !targets.has(ref.loc.path)) {
            targets.set(ref.loc.path, ref);
          }
        }

        const idents = targets.size > 0 ? [] : backtickedIdentifiers(contextText);
        for (const ident of idents) {
          if (WORD_IDENT_RE.test(ident)) wanted.add(ident);
        }

        pendingHits.push({ selfLoc, evidence, targets: [...targets.values()], idents });
      }
    }

    const wordPostings = buildWholeWordIndex(scan, wanted);
    const scannedIdents = new Map<string, IdentHit[]>();

    for (const hit of pendingHits) {
      if (hit.targets.length > 0) {
        candidates.push({
          locs: [hit.selfLoc, ...hit.targets.map((ref) => ref.loc)],
          score: PATH_TARGET_SCORE,
          signal: SIGNAL_NAME,
          evidence: hit.evidence
        });
        continue;
      }

      for (const ident of hit.idents) {
        const hits = resolveIdentHits(scan, wordPostings, scannedIdents, hit.selfLoc.path, ident);
        if (hits.length === 0 || hits.length > MAX_IDENT_MATCHES) continue;

        candidates.push({
          locs: [
            hit.selfLoc,
            ...hits.map((hitFile) => ({ path: hitFile.path, start: hitFile.line, end: hitFile.line }))
          ],
          score: IDENT_TARGET_SCORE,
          signal: SIGNAL_NAME,
          evidence: hit.evidence
        });
      }
    }

    return candidates;
  }
};

/**
 * Collects distinct backticked identifiers of at least {@link MIN_IDENT_LEN}
 * characters from a block of text, in first-seen order.
 *
 * @param text - Text to scan (typically a sync-comment's surrounding context).
 * @returns Distinct qualifying identifiers, in the order they first appear.
 */
function backtickedIdentifiers(text: string): string[] {
  const seen = new Set<string>();
  const identifiers: string[] = [];
  BACKTICK_IDENT_RE.lastIndex = 0;
  let match = BACKTICK_IDENT_RE.exec(text);
  while (match !== null) {
    const ident = match[1] ?? '';
    if (ident.length >= MIN_IDENT_LEN && !IDENT_STOPWORDS.has(ident.toLowerCase()) && !seen.has(ident)) {
      seen.add(ident);
      identifiers.push(ident);
    }
    match = BACKTICK_IDENT_RE.exec(text);
  }
  return identifiers;
}

/** One file where an identifier occurs, and the line of its first occurrence. */
interface IdentHit {
  path: string;
  line: number;
}

/** One discovered sync-comment hit awaiting candidate emission in encounter order. */
interface PendingSyncHit {
  /** The comment's own location: its file plus the context line range. */
  selfLoc: Loc;
  /** Evidence tag naming the comment line. */
  evidence: string[];
  /** Resolved path targets; non-empty means emit at the path-target score. */
  targets: PathRef[];
  /** Backticked identifiers to resolve; empty when path targets won. */
  idents: string[];
}

/**
 * Resolves an identifier's whole-word occurrences to files other than
 * `sourceFile`, preferring the once-per-run word index and falling back to a
 * memoized regex scan for identifiers the index cannot answer exactly (those
 * containing characters outside `[A-Za-z0-9_]`, whose `\b`-bounded semantics
 * differ from maximal-token matching).
 *
 * @param scan - Working-tree snapshot searched by the fallback.
 * @param wordPostings - Token → first-file/line postings built by
 *   {@link buildWholeWordIndex}.
 * @param scannedIdents - Per-run cache of fallback scan results, keyed by
 *   identifier, so repeated identifiers cost no additional corpus pass.
 * @param sourceFile - File to exclude from the results (the comment's own).
 * @param ident - Identifier to search for as a whole word.
 * @returns Matching files in scan order with their first-occurrence line,
 *   capped just past the rejection threshold.
 */
function resolveIdentHits(
  scan: RepoScan,
  wordPostings: ReadonlyMap<string, IdentHit[]>,
  scannedIdents: Map<string, IdentHit[]>,
  sourceFile: string,
  ident: string
): IdentHit[] {
  if (WORD_IDENT_RE.test(ident)) {
    return firstNonSelfFiles(wordPostings.get(ident), sourceFile);
  }
  let matches = scannedIdents.get(ident);
  if (!matches) {
    matches = scanWholeWordMatches(scan, ident);
    scannedIdents.set(ident, matches);
  }
  return firstNonSelfFiles(matches, sourceFile);
}

/**
 * Builds a whole-word posting index for exactly the requested tokens in one
 * pass over the scan's lines, keeping only each token's first occurrence per
 * file and at most {@link MAX_INDEXED_FILES} files overall — enough for any
 * lookup because exclusion removes at most one entry before truncation.
 *
 * @param scan - Working-tree snapshot to index.
 * @param wanted - Tokens worth indexing; every other token is skipped so
 *   memory stays bounded by the identifiers actually referenced.
 * @returns Postings per indexed token, in scan order.
 */
function buildWholeWordIndex(scan: RepoScan, wanted: ReadonlySet<string>): ReadonlyMap<string, IdentHit[]> {
  const postings = new Map<string, IdentHit[]>();
  if (wanted.size === 0) return postings;

  for (const file of scan.files) {
    const lines = scan.lines.get(file);
    if (!lines) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      WORD_TOKEN_RE.lastIndex = 0;
      let match = WORD_TOKEN_RE.exec(line);
      while (match !== null) {
        const token = match[0];
        if (wanted.has(token)) {
          const hits = postings.get(token);
          if (!hits) {
            postings.set(token, [{ path: file, line: i + 1 }]);
          } else if (hits.length < MAX_INDEXED_FILES && hits[hits.length - 1]?.path !== file) {
            hits.push({ path: file, line: i + 1 });
          }
        }
        match = WORD_TOKEN_RE.exec(line);
      }
    }
  }

  return postings;
}

/**
 * Takes a full posting list and returns the entries for files other than
 * `sourceFile`, stopping once more than {@link MAX_IDENT_MATCHES} are found
 * (the identifier is then too common to be useful evidence). Exclusion runs
 * before truncation, matching the per-file skip of a direct corpus scan.
 *
 * @param postings - First-occurrence postings per file, in scan order.
 * @param sourceFile - File to exclude (the comment's own).
 * @returns Matching files capped just past the rejection threshold.
 */
function firstNonSelfFiles(postings: readonly IdentHit[] | undefined, sourceFile: string): IdentHit[] {
  const hits: IdentHit[] = [];
  if (!postings) return hits;
  for (const posting of postings) {
    if (posting.path === sourceFile) continue;
    hits.push(posting);
    if (hits.length > MAX_IDENT_MATCHES) break;
  }
  return hits;
}

/**
 * Scans the corpus for every file whose text contains `ident` as a whole
 * word via a `\b`-bounded regex — the exact pre-index semantics, preserved
 * for identifiers (e.g. containing `-`, `$`, or `.`) whose boundaries the
 * token index cannot reproduce. Stops early once {@link MAX_INDEXED_FILES}
 * matches are known; excluding one requester's file afterwards still leaves
 * enough entries to apply the match cap.
 *
 * The identifier is matched as its literal text: it is escaped before
 * interpolation (the grammar admits `$` and `.`), and bounded by
 * token-boundary lookarounds instead of `\b`, because `$` is not a word
 * character and `\b` therefore cannot bound an identifier edged by `$`.
 *
 * @param scan - Working-tree snapshot to search.
 * @param ident - Identifier to search for as a whole word.
 * @returns Matching files in scan order with their first-occurrence line,
 *   capped just past the rejection threshold.
 */
function scanWholeWordMatches(scan: RepoScan, ident: string): IdentHit[] {
  const wordRe = new RegExp(`(?<![\\w$])${escapeRegExp(ident)}(?![\\w$])`);
  const hits: IdentHit[] = [];
  for (const otherFile of scan.files) {
    const otherLines = scan.lines.get(otherFile);
    if (!otherLines) continue;
    const foundIdx = otherLines.findIndex((candidateLine) => wordRe.test(candidateLine));
    if (foundIdx !== -1) {
      hits.push({ path: otherFile, line: foundIdx + 1 });
    }
    if (hits.length > MAX_INDEXED_FILES - 1) break;
  }
  return hits;
}
