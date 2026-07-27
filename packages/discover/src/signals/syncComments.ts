/**
 * Detects "keep in sync" style comments in tracked text files and resolves
 * them to the paths or backticked identifiers they name. Ports
 * `sig_sync_comments` from the Python span-recovery prototype.
 *
 * @summary "Keep in sync" comment coupling signal.
 */

import type { PathRef } from '../paths.js';
import { buildPathExtractor } from '../paths.js';
import type { Candidate, DiscoverConfig, RepoHistory, RepoScan, Signal } from '../types.js';

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

        if (targets.size > 0) {
          candidates.push({
            locs: [selfLoc, ...[...targets.values()].map((ref) => ref.loc)],
            score: PATH_TARGET_SCORE,
            signal: SIGNAL_NAME,
            evidence
          });
          continue;
        }

        for (const ident of backtickedIdentifiers(contextText)) {
          const hits = findWholeWordHits(scan, file, ident);
          if (hits.length === 0 || hits.length > MAX_IDENT_MATCHES) continue;

          candidates.push({
            locs: [selfLoc, ...hits.map((hit) => ({ path: hit.path, start: hit.line, end: hit.line }))],
            score: IDENT_TARGET_SCORE,
            signal: SIGNAL_NAME,
            evidence
          });
        }
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

/**
 * Finds files (other than `sourceFile`) whose text contains `ident` as a
 * whole word, stopping early once more than {@link MAX_IDENT_MATCHES} are
 * found (the identifier is then too common to be useful evidence).
 *
 * @param scan - Working-tree snapshot to search.
 * @param sourceFile - File to exclude from the search (the comment's own file).
 * @param ident - Identifier to search for as a whole word.
 * @returns Matching files with their first-occurrence line, capped just past
 *   the rejection threshold.
 */
function findWholeWordHits(scan: RepoScan, sourceFile: string, ident: string): IdentHit[] {
  const wordRe = new RegExp(`\\b${ident}\\b`);
  const hits: IdentHit[] = [];
  for (const otherFile of scan.files) {
    if (otherFile === sourceFile) continue;
    const otherLines = scan.lines.get(otherFile);
    if (!otherLines) continue;
    const foundIdx = otherLines.findIndex((candidateLine) => wordRe.test(candidateLine));
    if (foundIdx !== -1) {
      hits.push({ path: otherFile, line: foundIdx + 1 });
    }
    if (hits.length > MAX_IDENT_MATCHES) break;
  }
  return hits;
}
