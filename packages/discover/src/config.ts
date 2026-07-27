/**
 * Default discovery configuration and fail-closed override resolution.
 *
 * `DiscoverConfig` tunes every downstream stage of the pipeline (scan
 * excludes, candidate caps, score thresholds). This module owns the single
 * source of truth for defaults and is the only place partial user input is
 * validated before the rest of the pipeline trusts it as well-formed.
 *
 * @summary Default DiscoverConfig and validated merging of user overrides.
 */

import type { DiscoverConfig } from './types.js';

/**
 * Default discovery configuration used wherever overrides are not supplied.
 */
export const DEFAULT_CONFIG: DiscoverConfig = {
  exclude: [],
  maxCandidates: 300,
  minScore: 0.5,
  useCommitMessages: true,
  maxFileBytes: 524288
};

/**
 * Normalize a single exclude entry: strip a leading `./` and any trailing
 * `/`, then reject it if that leaves an absolute path, a `..` segment, or an
 * empty string.
 *
 * @param raw - Exclude entry as supplied by the caller, before normalization.
 * @returns The normalized, repository-relative path prefix.
 * @throws {Error} If `raw` is absolute, contains a `..` segment, or is empty
 *   after normalization.
 */
function normalizeExclude(raw: string): string {
  if (raw.startsWith('/')) {
    throw new Error(`discover: exclude entries must be repository-relative, got absolute path '${raw}'`);
  }
  const withoutLeadingDot = raw.startsWith('./') ? raw.slice(2) : raw;
  const normalized = withoutLeadingDot.replace(/\/+$/, '');
  if (normalized === '' || normalized.split('/').includes('..')) {
    throw new Error(`discover: invalid exclude entry '${raw}'`);
  }
  return normalized;
}

/**
 * Merge partial overrides over {@link DEFAULT_CONFIG}, normalizing exclude
 * entries and rejecting malformed input.
 *
 * @param overrides - Partial configuration values to override the defaults.
 * @returns Fully resolved, validated configuration.
 * @throws {Error} If an exclude entry is absolute, contains `..`, or is
 *   empty after normalization, or if `maxCandidates`, `minScore`, or
 *   `maxFileBytes` are out of range.
 */
export function resolveConfig(overrides?: Partial<DiscoverConfig>): DiscoverConfig {
  const merged: DiscoverConfig = { ...DEFAULT_CONFIG, ...overrides };

  if (!Number.isInteger(merged.maxCandidates) || merged.maxCandidates < 1) {
    throw new Error(`discover: maxCandidates must be an integer >= 1, got ${merged.maxCandidates}`);
  }
  if (merged.minScore < 0 || merged.minScore > 1) {
    throw new Error(`discover: minScore must be within [0, 1], got ${merged.minScore}`);
  }
  if (merged.maxFileBytes < 1) {
    throw new Error(`discover: maxFileBytes must be >= 1, got ${merged.maxFileBytes}`);
  }

  return { ...merged, exclude: merged.exclude.map(normalizeExclude) };
}
