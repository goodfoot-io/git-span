/**
 * Commit-message textual similarity signal.
 *
 * Design decision 2 (plans/initial.md): this is TF-IDF + cosine similarity
 * over the tokenized commit messages of every commit that touches a file —
 * NOT an embedding model. This is a deliberate, documented scope acceptance,
 * not an oversight: a local embedding model (`@xenova/transformers` + an
 * ONNX sentence model) was considered and rejected because a suitable model
 * is ~50-100MB and either fetches from Hugging Face's hub on first run
 * (breaking the offline guarantee this package otherwise holds) or bloats
 * the shipped bin by two orders of magnitude.
 *
 * Because this is lexical, not semantic, it has a real and known blind spot:
 * two files whose commit messages describe the same kind of change in
 * different words score near zero. For example, a file whose commits are
 * consistently messaged "retry with backoff" and a file whose commits are
 * consistently messaged "reattempt after delay" describe the same behavior
 * but share almost no tokens, so their cosine similarity lands close to 0
 * even though a human (or an embedding model) would call the changes
 * related. Callers must not read a low score here as "these files are
 * unrelated" — only as "the commit messages touching these files don't
 * share vocabulary." This is why the evidence this signal emits is labeled
 * `lexical-similarity`, never `semantic-similarity`: the report must never
 * imply a capability this tool doesn't have.
 *
 * Uses the shared `RepoContext.tfidfCorpus('commit-messages')` IDF table
 * (design decision 1's rationale: one shared table between this signal and
 * conceptual-similarity avoids two subtly divergent tokenizations/IDF
 * tables) rather than building a local one. Commit history is read
 * exclusively through `RepoContext.commits()`, so the sweep-commit
 * pre-filter (design decision 4) and the `.span/` exclusion guard (design
 * decision 5) always apply.
 */

import type { AnchorGroup, RepoContext, Signal, SignalEvidence } from '../types.js';
import { cosineSimilarity } from '../types.js';

/** Evidence label for this signal's output — lexical, never "semantic" (design decision 2). */
const EVIDENCE_LABEL = 'lexical-similarity';

/** Minimum cosine similarity for a file pair to be reported as an AnchorGroup. */
const SIMILARITY_THRESHOLD = 0.4;

/**
 * Minimum number of documents (commits) in the shared corpus for TF-IDF to
 * be meaningful. With a single-commit corpus every IDF weight is identical
 * (`log(2/2)+1 = 1` for any token present at all), so any two files touched
 * by that one commit trivially vectorize to a cosine similarity of 1 — not
 * genuine lexical evidence, just an artifact of there being nothing to
 * differentiate against. Below this floor the signal abstains entirely.
 */
const MIN_CORPUS_DOCUMENTS = 2;

const WORD_PATTERN = /[A-Za-z]+/g;

/** Splits `camelCase`/`PascalCase`/`snake_case`/`kebab-case` identifiers into their constituent words. */
function splitIdentifierWords(word: string): string[] {
  return word
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .filter((part) => part.length > 0);
}

/**
 * Tokenizes free-text commit message content, matching the tokenization the
 * shared `commit-messages` corpus was built with (src/prefilter.ts).
 */
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

interface FileCommitHistory {
  /** SHAs of every commit (post pre-filter/`.span/`-exclusion) that touched this file. */
  shas: string[];
  /** Tokens from every commit message touching this file, aggregated. */
  tokens: string[];
}

/** Groups commit messages by the files each commit touched. */
async function collectFileCommitHistories(ctx: RepoContext): Promise<Map<string, FileCommitHistory>> {
  const commits = await ctx.commits();
  const histories = new Map<string, FileCommitHistory>();

  for (const commit of commits) {
    const messageTokens = tokenize(commit.message);
    for (const file of commit.files) {
      let history = histories.get(file.path);
      if (!history) {
        history = { shas: [], tokens: [] };
        histories.set(file.path, history);
      }
      history.shas.push(commit.sha);
      history.tokens.push(...messageTokens);
    }
  }

  return histories;
}

const commitMessageSimilaritySignal: Signal = async (ctx: RepoContext): Promise<AnchorGroup[]> => {
  const histories = await collectFileCommitHistories(ctx);
  if (histories.size < 2) return [];

  const corpus = await ctx.tfidfCorpus('commit-messages');
  if (corpus.documentCount < MIN_CORPUS_DOCUMENTS) return [];

  const vectors = new Map<string, ReadonlyMap<string, number>>();
  for (const [path, history] of histories) {
    if (history.tokens.length === 0) continue;
    vectors.set(path, corpus.vectorize(history.tokens));
  }

  const withVectors = [...vectors.keys()];
  const groups: AnchorGroup[] = [];

  for (let i = 0; i < withVectors.length; i++) {
    for (let j = i + 1; j < withVectors.length; j++) {
      const pathA = withVectors[i];
      const pathB = withVectors[j];
      const vectorA = vectors.get(pathA);
      const vectorB = vectors.get(pathB);
      if (!vectorA || !vectorB) continue;

      const similarity = cosineSimilarity(vectorA, vectorB);
      if (!Number.isFinite(similarity) || similarity < SIMILARITY_THRESHOLD) continue;

      // Clamp defensively — cosineSimilarity is bounded in [0, 1] for
      // non-negative TF-IDF weights, but scoring (design decision 7) still
      // wants a hard guarantee no signal can hand it an out-of-range value.
      const strength = Math.min(1, Math.max(0, similarity));

      const historyA = histories.get(pathA);
      const historyB = histories.get(pathB);
      const commits = [...new Set([...(historyA?.shas ?? []), ...(historyB?.shas ?? [])])];

      const evidence: SignalEvidence = {
        signal: EVIDENCE_LABEL,
        strength,
        commits,
        detail: `TF-IDF cosine similarity of ${similarity.toFixed(3)} between commit messages touching ${pathA} and ${pathB}`
      };

      groups.push({
        anchors: [{ path: pathA }, { path: pathB }],
        evidence: [evidence],
        score: strength
      });
    }
  }

  return groups;
};

export default commitMessageSimilaritySignal;
