/**
 * Conceptual/semantic similarity signal.
 *
 * Design decision 2 (plans/initial.md): this is TF-IDF + cosine similarity
 * over tokenized identifiers/comments/docstrings of each file's content at
 * HEAD — NOT an embedding model. This is a deliberate, documented scope
 * acceptance, not an oversight: a local embedding model (`@xenova/transformers`
 * + an ONNX sentence/code model) was considered and rejected because a
 * suitable model is ~50-100MB and either fetches from Hugging Face's hub on
 * first run (breaking the offline guarantee this package otherwise holds) or
 * bloats the shipped bin by two orders of magnitude.
 *
 * Because this is lexical, not semantic, it has a real and known blind spot:
 * two files that are conceptually about the same thing but use different
 * vocabulary score near zero. For example, a file built around `retry`/
 * `backoff` identifiers and a file built around `reattempt`/`delay`
 * identifiers describe the same behavior but share almost no tokens, so
 * their cosine similarity lands close to 0 even though a human (or an
 * embedding model) would call them related. Callers must not read a low
 * score here as "these files are unrelated" — only as "these files don't
 * share vocabulary." This is why the evidence this signal emits is labeled
 * `lexical-similarity`, never `semantic-similarity`: the report must never
 * imply a capability this tool doesn't have.
 *
 * Uses the shared `RepoContext.tfidfCorpus('file-identifiers')` IDF table
 * (design decision 1's rationale: one shared table between this signal and
 * commit-message-similarity avoids two subtly divergent tokenizations/IDF
 * tables) rather than building a local one. File content is read exclusively
 * through `RepoContext.fileAt(path, 'HEAD')`, never direct fs access, so the
 * `.span/` exclusion guard (design decision 5) always applies.
 */

import type { AnchorGroup, RepoContext, Signal, SignalEvidence } from '../types.js';
import { cosineSimilarity } from '../types.js';

/** Evidence label for this signal's output — lexical, never "semantic" (design decision 2). */
const EVIDENCE_LABEL = 'lexical-similarity';

/** Minimum cosine similarity for a file pair to be reported as an AnchorGroup. */
const SIMILARITY_THRESHOLD = 0.3;

const WORD_PATTERN = /[A-Za-z]+/g;

/** Splits `camelCase`/`PascalCase`/`snake_case`/`kebab-case` identifiers into their constituent words. */
function splitIdentifierWords(word: string): string[] {
  return word
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .filter((part) => part.length > 0);
}

/**
 * Tokenizes a file's raw content (identifiers, comments, docstrings alike —
 * this signal makes no attempt to distinguish code from prose, matching the
 * tokenization the shared `file-identifiers` corpus was built with).
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

/** Every distinct file path touched anywhere in the (pre-filtered, `.span/`-excluded) history. */
async function collectFilePaths(ctx: RepoContext): Promise<string[]> {
  const commits = await ctx.commits();
  const paths = new Set<string>();
  for (const commit of commits) {
    for (const file of commit.files) paths.add(file.path);
  }
  return [...paths];
}

const conceptualSimilaritySignal: Signal = async (ctx: RepoContext): Promise<AnchorGroup[]> => {
  const paths = await collectFilePaths(ctx);
  if (paths.length < 2) return [];

  const corpus = await ctx.tfidfCorpus('file-identifiers');

  const vectors = new Map<string, ReadonlyMap<string, number>>();
  for (const path of paths) {
    const content = await ctx.fileAt(path, 'HEAD');
    if (content === null) continue;
    const tokens = tokenize(content);
    if (tokens.length === 0) continue;
    vectors.set(path, corpus.vectorize(tokens));
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

      const evidence: SignalEvidence = {
        signal: EVIDENCE_LABEL,
        strength,
        detail: `TF-IDF cosine similarity of ${similarity.toFixed(3)} between ${pathA} and ${pathB}`
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

export default conceptualSimilaritySignal;
