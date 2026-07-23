/**
 * Shared pre-filter and RepoContext construction (design decision 4 — the
 * pre-filter is a RepoContext construction step, not per-signal logic).
 *
 * Two independent guarantees live here:
 *  - Sweep commits (more than `maxFilesPerCommit` files) are excluded from
 *    every signal's input once, upstream, rather than each signal separately
 *    filtering them.
 *  - `.span/` is never surfaced to a signal: `commits()` strips `.span/`
 *    paths out of the history walk (design decision 5's primary guard), and
 *    `fileAt()` independently refuses to resolve a `.span/` path even if
 *    asked directly (the belt-and-suspenders guard).
 */

import * as git from './git.js';
import type { Commit, RepoContext, RepoContextOptions, Tag, TfidfCorpus, TfidfCorpusKind } from './types.js';

const DEFAULT_MAX_FILES_PER_COMMIT = 50;
const SPAN_DIR_PREFIX = '.span/';

/**
 * True when a commit touches more files than the configurable sweep-commit
 * threshold and should be excluded from every signal's input (design
 * decision 4) — refactor/config-bump/formatting commits are the dominant
 * false-positive source for co-change signals.
 */
export function isSweepCommit(commit: Commit, maxFilesPerCommit: number): boolean {
  return commit.files.length > maxFilesPerCommit;
}

/** True for `.span/` itself or any path under it — never surfaced to a signal (design decision 5). */
export function isSpanPath(path: string): boolean {
  return path === '.span' || path.startsWith(SPAN_DIR_PREFIX);
}

function stripSpanFiles(commit: Commit): Commit {
  const files = commit.files.filter((file) => !isSpanPath(file.path));
  return files.length === commit.files.length ? commit : { ...commit, files };
}

// ---------------------------------------------------------------------------
// Tokenization for the shared TF-IDF corpus (design decision 2)
// ---------------------------------------------------------------------------

const WORD_PATTERN = /[A-Za-z]+/g;

/** Splits `camelCase`/`PascalCase`/`snake_case`/`kebab-case` identifiers into their constituent words. */
function splitIdentifierWords(word: string): string[] {
  return word
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .filter((part) => part.length > 0);
}

function tokenize(text: string): string[] {
  const words = text.match(WORD_PATTERN) ?? [];
  const tokens: string[] = [];
  for (const word of words) {
    for (const part of splitIdentifierWords(word)) {
      const lower = part.toLowerCase();
      if (lower.length > 1) tokens.push(lower);
    }
  }
  return tokens;
}

/**
 * Builds a TF-IDF corpus over a set of already-tokenized documents. Smoothed
 * IDF (`log((1+N)/(1+df)) + 1`) avoids both division-by-zero for
 * every-document tokens and unbounded weight for singleton tokens.
 */
function buildTfidfCorpus(kind: TfidfCorpusKind, documents: string[][]): TfidfCorpus {
  const documentFrequency = new Map<string, number>();
  for (const doc of documents) {
    for (const token of new Set(doc)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const documentCount = documents.length;

  function idf(token: string): number {
    const df = documentFrequency.get(token) ?? 0;
    return Math.log((1 + documentCount) / (1 + df)) + 1;
  }

  return {
    kind,
    documentCount,
    documentFrequency,
    vectorize(tokens: string[]): ReadonlyMap<string, number> {
      const termFrequency = new Map<string, number>();
      for (const token of tokens) {
        termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
      }
      const vector = new Map<string, number>();
      for (const [token, tf] of termFrequency) {
        vector.set(token, tf * idf(token));
      }
      return vector;
    }
  };
}

// ---------------------------------------------------------------------------
// RepoContext construction
// ---------------------------------------------------------------------------

export function createRepoContext(repoRoot: string, options: RepoContextOptions = {}): RepoContext {
  const maxFilesPerCommit = options.maxFilesPerCommit ?? DEFAULT_MAX_FILES_PER_COMMIT;

  let commitsPromise: Promise<Commit[]> | null = null;
  let tagsPromise: Promise<Tag[]> | null = null;
  const tfidfPromises = new Map<TfidfCorpusKind, Promise<TfidfCorpus>>();

  async function commits(): Promise<Commit[]> {
    if (!commitsPromise) {
      commitsPromise = git
        .log(repoRoot)
        .then((raw) => raw.filter((commit) => !isSweepCommit(commit, maxFilesPerCommit)).map(stripSpanFiles));
    }
    return commitsPromise;
  }

  async function tags(): Promise<Tag[]> {
    if (!tagsPromise) tagsPromise = git.tags(repoRoot);
    return tagsPromise;
  }

  async function fileAt(path: string, rev: string): Promise<string | null> {
    if (isSpanPath(path)) return null;
    return git.fileContentAt(repoRoot, rev, path);
  }

  async function buildCorpus(kind: TfidfCorpusKind): Promise<TfidfCorpus> {
    const history = await commits();
    if (kind === 'commit-messages') {
      return buildTfidfCorpus(
        kind,
        history.map((commit) => tokenize(commit.message))
      );
    }

    const paths = new Set<string>();
    for (const commit of history) {
      for (const file of commit.files) paths.add(file.path);
    }
    const documents: string[][] = [];
    for (const path of paths) {
      const content = await fileAt(path, 'HEAD');
      if (content !== null) documents.push(tokenize(content));
    }
    return buildTfidfCorpus(kind, documents);
  }

  function tfidfCorpus(kind: TfidfCorpusKind): Promise<TfidfCorpus> {
    let promise = tfidfPromises.get(kind);
    if (!promise) {
      promise = buildCorpus(kind);
      tfidfPromises.set(kind, promise);
    }
    return promise;
  }

  return { repoRoot, commits, tags, fileAt, tfidfCorpus };
}
