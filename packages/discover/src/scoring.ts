/**
 * Evidence scoring — shared by both pipeline scoring passes (pass 1 over
 * signal evidence only, pass 2 after both disqualifiers have run).
 *
 * A group's accumulated evidence is combined into one score by summing
 * per-signal / per-disqualifier contributions **in log-odds form** with
 * hand-tuned log-likelihood-ratio weights, then squashing the total back to a
 * probability in (0, 1) with the logistic function. The weights below are
 * **hand-tuned, not learned** — consistent with the card's non-goals (no
 * training data, no fitted model); they encode a rough ordering of how much
 * each signal/disqualifier should move belief, to be revisited once the
 * prototype's output is validated against real accepted/rejected candidates.
 *
 * Design decision 7 — clamping: each evidence's probability is clamped to
 * `[ε, 1-ε]` before it is converted to log-odds, so no single piece of
 * evidence can drive the aggregate to ±Infinity and silently dominate every
 * other contribution.
 *
 * A subtlety the clamp alone does not solve: a `SignalEvidence.strength` /
 * `DisqualifierEvidence.strength` is an *evidence-confidence* in [0, 1], where
 * 0 means "no evidence" — NOT a posterior probability. Feeding a raw strength
 * straight through `logit` would map strength 0 to −∞ (maximally informative),
 * the exact opposite of the intended "no evidence" meaning — and a
 * disqualifier that finds nothing reports strength 0. So a strength `s` is
 * first mapped onto a claim probability `0.5 + 0.5·s` (0 → 0.5, the neutral /
 * uninformative point; 1 → 1, maximal confidence in the evidence's claim)
 * before clamping and conversion. Signals push the log-odds toward "is a real
 * coupling"; disqualifiers push it away by the same construction.
 */

import type { DisqualifierEvidence, SignalEvidence } from './types.js';

/** Clamp bound for probabilities before log-odds conversion (design decision 7). */
const EPSILON = 0.02;

/**
 * Hand-tuned per-signal log-likelihood-ratio weights, keyed by the evidence
 * label each signal emits.
 *
 * `strengthToLogOdds` maps a strength of 1 to `logit(1 - EPSILON) ≈ 3.89` —
 * so *any* weight above ~0.05 lets a single, isolated, max-strength
 * observation cross a threshold set "just above neutral". A real-repo probe
 * (1072 commits / 658 files, see the card's investigation notes) showed
 * `time-window-co-edit`, `same-author-session`, and `lexical-similarity` each
 * firing tens of thousands of times with typical (median) strengths of
 * 0.49-0.83 — because a repo this size naturally produces huge incidental
 * co-occurrence (busy edit sessions, shared vocabulary, temporal proximity)
 * that has nothing to do with a genuine implicit dependency. At the old
 * weights (0.5-0.7), that typical strength alone cleared `PASS1_THRESHOLD`
 * for ~97% of all merged groups.
 *
 * These signals are split into two tiers reflecting how much one isolated
 * observation should move belief:
 *
 * - **Structural** (`association-rules`, `shared-config-key`): each already
 *   filters for statistical/rarity significance before emitting evidence at
 *   all (`MIN_SUPPORT`/`MIN_CONFIDENCE`/`MIN_COOCCURRENCE_COUNT` in
 *   association-rules.ts; the rare-token filter in shared-config-keys.ts), so
 *   a single strong observation is real, corroborated evidence and deserves
 *   a weight that alone can cross the pass threshold.
 * - **Circumstantial** (`release-tag-delta`, `lexical-similarity`,
 *   `time-window-co-edit`, `same-author-session`): individually common and
 *   noisy at repo scale — proximity or vocabulary overlap alone is
 *   suggestive, not conclusive. Weights are sized so that even a
 *   maximal-strength single observation lands short of `PASS1_THRESHOLD`
 *   (~0.65 alone, see scoring.test.ts), while two or more corroborating
 *   circumstantial signals — or one circumstantial signal alongside a
 *   structural one — combine to clear it.
 */
const SIGNAL_WEIGHTS: Readonly<Record<string, number>> = {
  'association-rules': 1.3,
  'shared-config-key': 0.55,
  'release-tag-delta': 0.35,
  'lexical-similarity': 0.25,
  'time-window-co-edit': 0.15,
  'same-author-session': 0.2
};

/** Weight applied to a signal whose label is not in {@link SIGNAL_WEIGHTS} — treated as circumstantial by default (fail closed). */
const DEFAULT_SIGNAL_WEIGHT = 0.2;

/**
 * Hand-tuned per-disqualifier weights. An explicit reference (a tree-sitter
 * import edge, or a raw path string) is strong evidence a coupling is
 * *explicit*, not the implicit dependency this tool exists to surface, so both
 * carry weight comparable to the strongest positive signals.
 */
const DISQUALIFIER_WEIGHTS: Readonly<Record<string, number>> = {
  'tree-sitter-reference': 1.5,
  'raw-path-inclusion': 1.4
};

const DEFAULT_DISQUALIFIER_WEIGHT = 1.0;

function clampProbability(p: number): number {
  return Math.min(1 - EPSILON, Math.max(EPSILON, p));
}

function logit(p: number): number {
  return Math.log(p / (1 - p));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Maps an evidence-confidence strength (0 = no evidence, 1 = maximal) onto a
 * clamped claim probability in `[ε, 1-ε]`, then to log-odds. Strength 0 maps
 * to `logit(0.5) = 0` — genuinely neutral — rather than −∞.
 */
function strengthToLogOdds(strength: number): number {
  const bounded = Math.min(1, Math.max(0, strength));
  return logit(clampProbability(0.5 + 0.5 * bounded));
}

/**
 * Reduces a group's signal evidence to at most one entry per signal — the
 * strongest — before scoring. Grouping's evidence-union only drops
 * byte-exact duplicates, so a merged group can carry many entries from the
 * same signal (correlated observations of the same underlying pair, not
 * independent evidence); summing every one of them lets score grow with
 * entry *count* rather than coupling *strength*, saturating the score and
 * inverting rank order against fewer-but-stronger candidates.
 */
function strongestPerSignal(signals: readonly SignalEvidence[]): SignalEvidence[] {
  const strongestBySignal = new Map<string, SignalEvidence>();

  for (const evidence of signals) {
    const current = strongestBySignal.get(evidence.signal);
    if (!current || evidence.strength > current.strength) {
      strongestBySignal.set(evidence.signal, evidence);
    }
  }

  return [...strongestBySignal.values()];
}

/**
 * Combines a group's signal evidence (and, in pass 2, its disqualifier
 * evidence) into one score in (0, 1). Inconclusive disqualifiers (design
 * decision 6 — e.g. a tree-sitter parse failure) contribute nothing in either
 * direction.
 */
export function scoreEvidence(
  signals: readonly SignalEvidence[],
  disqualifiers: readonly DisqualifierEvidence[] = []
): number {
  let logOdds = 0;

  for (const evidence of strongestPerSignal(signals)) {
    const weight = SIGNAL_WEIGHTS[evidence.signal] ?? DEFAULT_SIGNAL_WEIGHT;
    logOdds += weight * strengthToLogOdds(evidence.strength);
  }

  for (const evidence of disqualifiers) {
    if (evidence.inconclusive) continue;
    const weight = DISQUALIFIER_WEIGHTS[evidence.disqualifier] ?? DEFAULT_DISQUALIFIER_WEIGHT;
    logOdds -= weight * strengthToLogOdds(evidence.strength);
  }

  return sigmoid(logOdds);
}
