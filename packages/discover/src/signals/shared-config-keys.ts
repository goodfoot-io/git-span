/**
 * Shared config/feature-flag key signal.
 *
 * Card description: "identifier tokens that reappear across two files'
 * historical diffs". Extracts identifier-like tokens (SCREAMING_SNAKE_CASE,
 * camelCase, kebab-case) from the added/modified lines of each file's
 * historical diff hunks, across the pre-filtered commit history
 * (`RepoContext.commits()`), and flags file pairs that share a *rare*
 * token — one that doesn't also show up all over the rest of the repo — as
 * candidate anchors.
 *
 * Line content, not just line ranges: `RepoContext.commits()` gives hunk-level
 * *ranges* (design decision 1's fixed `src/git.ts` contract), not diff text
 * directly. To get the actual added/modified text this signal reads
 * `RepoContext.fileAt(path, commit.sha)` — the file's content as it stood
 * right after that commit — and slices out exactly the hunk's line range.
 * Since `git.ts`'s hunk parser only records hunks with `newLines > 0` (i.e.
 * skips deletion-only hunks — see its comment), every hunk this signal visits
 * has real post-image text to read; a pure-removal edit simply contributes no
 * hunk and no tokens, which undercounts removed-only-key edits but never
 * throws or fabricates content.
 *
 * Rarity threshold (specificity): a token that appears in more than
 * `MAX_FILES_FOR_RARE_TOKEN` distinct files across history is treated as
 * generic noise (e.g. `isEnabled`, `defaultValue`) rather than a specific
 * config/flag key, and is excluded from candidate generation entirely — this
 * is the "not common across many files" requirement from the card
 * description. Tokens are also required to reach `MIN_TOKEN_LENGTH`
 * characters and to not be in `STOPWORDS`, filtering short/common
 * near-matches (`onError`, `useMemo`) that would otherwise pass the casing
 * regexes but carry no config-key specificity.
 */

import type { AnchorGroup, RepoContext, Signal, SignalEvidence } from '../types.js';

/** Evidence label for this signal's output. */
const EVIDENCE_LABEL = 'shared-config-key';

/**
 * A token shared by more files than this is treated as generic/common vocabulary,
 * not a specific config/feature-flag key — excluded from candidate generation.
 * Two files sharing a token that *no other* file in history also touches is the
 * strongest case; this threshold gives a little slack (e.g. a key shared by a
 * small cluster of 3-4 related files) without admitting repo-wide boilerplate.
 */
const MAX_FILES_FOR_RARE_TOKEN = 4;

/** Tokens shorter than this are excluded — short identifiers are rarely specific config/flag names. */
const MIN_TOKEN_LENGTH = 6;

/** Common identifiers that pass the casing regexes but carry no config-key specificity. */
const STOPWORDS = new Set([
  'function',
  'constructor',
  'undefined',
  'toString',
  'valueOf',
  'default',
  'export',
  'import',
  'return',
  'exports',
  'require',
  'private',
  'public',
  'static',
  'async',
  'await',
  'class',
  'interface',
  'extends',
  'implements',
  'package',
  'version',
  'license',
  'description',
  'useState',
  'useEffect',
  'useMemo',
  'useCallback',
  'onClick',
  'onChange',
  'onError'
]);

/** SCREAMING_SNAKE_CASE: at least one underscore-separated uppercase segment. */
const SCREAMING_SNAKE_PATTERN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** camelCase: a lowercase-starting identifier with at least one internal uppercase transition. */
const CAMEL_CASE_PATTERN = /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/g;

/** kebab-case: lowercase segments joined by hyphens, at least two segments. */
const KEBAB_CASE_PATTERN = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g;

/** Extracts every identifier-like token from a line of text, deduplicated. */
function extractTokens(line: string): string[] {
  const found = new Set<string>();
  for (const pattern of [SCREAMING_SNAKE_PATTERN, CAMEL_CASE_PATTERN, KEBAB_CASE_PATTERN]) {
    for (const match of line.matchAll(pattern)) {
      const token = match[0];
      if (token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token)) {
        found.add(token);
      }
    }
  }
  return [...found];
}

/** Per-token bookkeeping: which files it appeared in, and which commits contributed it in each file. */
interface TokenOccurrence {
  filesToCommits: Map<string, Set<string>>;
}

/**
 * Walks every hunk of every changed file across (pre-filtered, `.span/`-excluded)
 * history, reading the hunk's actual post-image text via `fileAt`, and records
 * which files each extracted token appeared in and via which commits.
 */
async function collectTokenOccurrences(ctx: RepoContext): Promise<Map<string, TokenOccurrence>> {
  const occurrences = new Map<string, TokenOccurrence>();
  const fileContentCache = new Map<string, string | null>();

  const commits = await ctx.commits();
  for (const commit of commits) {
    for (const file of commit.files) {
      if (file.hunks.length === 0) continue;

      const cacheKey = `${commit.sha}:${file.path}`;
      let content = fileContentCache.get(cacheKey);
      if (content === undefined) {
        content = await ctx.fileAt(file.path, commit.sha);
        fileContentCache.set(cacheKey, content);
      }
      if (content === null) continue;

      const lines = content.split('\n');
      for (const hunk of file.hunks) {
        const slice = lines.slice(Math.max(0, hunk.startLine - 1), hunk.endLine);
        for (const rawLine of slice) {
          for (const token of extractTokens(rawLine)) {
            let occurrence = occurrences.get(token);
            if (!occurrence) {
              occurrence = { filesToCommits: new Map() };
              occurrences.set(token, occurrence);
            }
            let commitSet = occurrence.filesToCommits.get(file.path);
            if (!commitSet) {
              commitSet = new Set();
              occurrence.filesToCommits.set(file.path, commitSet);
            }
            commitSet.add(commit.sha);
          }
        }
      }
    }
  }

  return occurrences;
}

/** Deterministic ordering for a two-file pair key, independent of visit order. */
function pairKey(pathA: string, pathB: string): string {
  return pathA < pathB ? `${pathA} ${pathB}` : `${pathB} ${pathA}`;
}

interface PairAccumulator {
  pathA: string;
  pathB: string;
  tokens: string[];
  commits: Set<string>;
}

const sharedConfigKeysSignal: Signal = async (ctx: RepoContext): Promise<AnchorGroup[]> => {
  const occurrences = await collectTokenOccurrences(ctx);

  const pairs = new Map<string, PairAccumulator>();

  for (const [token, occurrence] of occurrences) {
    const files = [...occurrence.filesToCommits.keys()];
    // Specificity filter: a token touching many files is generic noise, not a
    // specific shared config/flag key (design rationale in module comment).
    if (files.length < 2 || files.length > MAX_FILES_FOR_RARE_TOKEN) continue;

    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const pathA = files[i];
        const pathB = files[j];
        const key = pairKey(pathA, pathB);
        let accumulator = pairs.get(key);
        if (!accumulator) {
          accumulator = { pathA, pathB, tokens: [], commits: new Set() };
          pairs.set(key, accumulator);
        }
        accumulator.tokens.push(token);
        for (const sha of occurrence.filesToCommits.get(pathA) ?? []) accumulator.commits.add(sha);
        for (const sha of occurrence.filesToCommits.get(pathB) ?? []) accumulator.commits.add(sha);
      }
    }
  }

  const groups: AnchorGroup[] = [];
  for (const { pathA, pathB, tokens, commits } of pairs.values()) {
    // Noisy-OR across shared tokens: each additional independently-corroborating
    // shared token raises confidence, but the combined strength still saturates
    // below 1 rather than growing unbounded (scoring's clamp, design decision 7,
    // is a second independent safety net on top of this).
    const perTokenWeight = 0.5;
    const strength = 1 - (1 - perTokenWeight) ** tokens.length;

    const evidence: SignalEvidence = {
      signal: EVIDENCE_LABEL,
      strength,
      commits: [...commits].sort(),
      detail: `Shared identifier token(s) across historical diffs: ${tokens.sort().join(', ')}`
    };

    groups.push({
      anchors: [{ path: pathA }, { path: pathB }],
      evidence: [evidence],
      score: strength
    });
  }

  return groups;
};

export default sharedConfigKeysSignal;
