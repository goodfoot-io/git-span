/**
 * Shared type contract for git-span-discover.
 *
 * Every signal and disqualifier module is a default-exported closure against
 * these types. Fixed once here (Stage 0 of plans/initial.md) so the six
 * remaining Stage-1 signal authors and the Stage-1 tree-sitter disqualifier
 * author never renegotiate shapes mid-flight.
 */

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

/**
 * A file, or a line range within a file, that a signal or disqualifier
 * points at. Whole-file when startLine/endLine are omitted.
 */
export interface Anchor {
  path: string;
  startLine?: number;
  endLine?: number;
}

/** A candidate implicit-coupling group: a set of anchors plus the evidence and score that produced them. */
export interface AnchorGroup {
  anchors: Anchor[];
  evidence: SignalEvidence[];
  score: number;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Evidence contributed by one signal toward a group being a real implicit dependency. */
export interface SignalEvidence {
  signal: string;
  /** Probability-like strength in [0, 1] this evidence assigns to the group, before scoring's clamp (design decision 7). */
  strength: number;
  /** Supporting commit SHAs and/or tag names, for the human-readable evidence trail. */
  commits?: string[];
  tags?: string[];
  detail?: string;
}

/** Evidence contributed by a disqualifier against a group being a real implicit dependency. Scored the same way as SignalEvidence — never a hard pass/fail gate. */
export interface DisqualifierEvidence {
  disqualifier: string;
  /** Probability-like strength in [0, 1] that the group is NOT a real coupling. */
  strength: number;
  detail?: string;
  /**
   * True when the disqualifier could not evaluate the group at all (e.g. a
   * tree-sitter parse failure on an unsupported language, syntax error, or
   * binary file) rather than evaluating it and finding nothing. Contributes
   * zero evidence in either direction (design decision 6) — evidence-neutral,
   * not corroborating and not disqualifying.
   */
  inconclusive?: boolean;
}

// ---------------------------------------------------------------------------
// git.ts data shapes
// ---------------------------------------------------------------------------

/** A contiguous added/modified line range within one file in one commit, from a `--unified=0` diff hunk. */
export interface HunkRange {
  startLine: number;
  endLine: number;
}

/** One file changed by a commit, with the hunk-level ranges touched — not just the fact that the file changed. */
export interface ChangedFile {
  path: string;
  hunks: HunkRange[];
}

/** One commit as seen by src/git.ts's log wrapper. */
export interface Commit {
  sha: string;
  author: string;
  /** ISO 8601 author date. */
  date: string;
  message: string;
  files: ChangedFile[];
}

/** One `git tag`, resolved to the commit it points at. */
export interface Tag {
  name: string;
  sha: string;
  /** ISO 8601 creation date. */
  date: string;
}

// ---------------------------------------------------------------------------
// TF-IDF corpus (design decision 2 — one shared IDF table for
// commit-message-similarity and conceptual-similarity)
// ---------------------------------------------------------------------------

export type TfidfCorpusKind = 'commit-messages' | 'file-identifiers';

/**
 * A document-frequency table plus a vectorizer, built once over the whole
 * corpus and shared by every signal that needs TF-IDF/cosine similarity
 * (design decision 2). Lexical only — explicitly not a semantic/embedding
 * model; see the module-level limitation documented on the Stage-1 signals
 * that consume this (conceptual-similarity, commit-message-similarity).
 */
export interface TfidfCorpus {
  kind: TfidfCorpusKind;
  documentCount: number;
  /** Number of documents (of documentCount) containing each token at least once. */
  documentFrequency: ReadonlyMap<string, number>;
  /** TF-IDF weight vector for an arbitrary token list, scored against this corpus's IDF table. */
  vectorize(tokens: string[]): ReadonlyMap<string, number>;
}

/**
 * Cosine similarity between two TF-IDF vectors, in [0, 1] for non-negative
 * weights. Shared so every TF-IDF-based signal scores pairs identically.
 */
export function cosineSimilarity(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  if (normA === 0 || normB === 0) return 0;

  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const [token, value] of smaller) {
    const other = larger.get(token);
    if (other !== undefined) dot += value * other;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// RepoContext
// ---------------------------------------------------------------------------

export interface RepoContextOptions {
  /** Commits touching more than this many files are excluded from every accessor (design decision 4). */
  maxFilesPerCommit?: number;
}

/**
 * The single shared, memoized read path over a repository's git history and
 * file content. Every signal and disqualifier receives one RepoContext
 * instance and reads through it rather than invoking src/git.ts directly, so
 * the sweep-commit pre-filter (design decision 4) and the `.span/`
 * history-walk exclusion (design decision 5) apply exactly once, upstream of
 * every consumer. Constructed by `createRepoContext` in src/prefilter.ts.
 */
export interface RepoContext {
  readonly repoRoot: string;

  /** All commits reachable from HEAD, pre-filtered and `.span/`-path-excluded, hunk-level. Memoized. */
  commits(): Promise<readonly Commit[]>;

  /** All tags, oldest first. Memoized. Empty on a repo with no tags (design decision 9). */
  tags(): Promise<readonly Tag[]>;

  /**
   * File content at a given revision, or null if the path did not exist at
   * that revision. Never resolves a path under `.span/` — a second,
   * independent guard alongside commits()'s history-walk exclusion (design
   * decision 5).
   */
  fileAt(path: string, rev: string): Promise<string | null>;

  /** The shared TF-IDF corpus for `kind`, built once over the whole (pre-filtered) history. Memoized per kind. */
  tfidfCorpus(kind: TfidfCorpusKind): Promise<TfidfCorpus>;
}

// ---------------------------------------------------------------------------
// Signals / Disqualifiers
// ---------------------------------------------------------------------------

export type Signal = (ctx: RepoContext) => Promise<AnchorGroup[]>;

export type Disqualifier = (group: AnchorGroup, ctx: RepoContext) => Promise<DisqualifierEvidence>;
