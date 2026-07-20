/**
 * Path exclusion list for the gate's uncovered-writes check.
 *
 * `evaluateGate` in {@link file://./gate-core.ts} already excludes `.span/**`
 * paths from its uncovered-writes computation unconditionally (span repairs
 * ride the same commit and must never self-trigger the gate). This module
 * adds a second, user-declared exclusion source on top of that: a repo owner
 * can list additional paths the uncovered-writes check should never flag —
 * generated output, vendored code, anything that will never get a span.
 *
 * Config lives at `<repoRoot>/.span/.gateignore`. Unlike
 * {@link file://./span-ignore.ts}'s `.span/.hookignore` — which the `git-span`
 * Rust CLI auto-creates with canonical content — `.gateignore` is
 * **user-owned**: nothing creates or populates it, so its absence is the
 * normal, unconfigured state, not a broken one.
 *
 * Each non-comment line is a single gitignore-style path pattern (no trailing
 * prefix list — a `.gateignore` line either excludes a path from the
 * uncovered-writes check or it doesn't, unlike `.hookignore`'s per-span-slug
 * suppression):
 *
 *   packages/agent-hooks/generated/**
 *
 * Pattern grammar is identical to `.hookignore`'s (see that module's doc
 * comment for the full grammar) and reuses its compiled matcher via
 * {@link compilePattern} rather than reimplementing path matching:
 *
 * - Blank lines and lines beginning with `#` are skipped.
 * - A trailing `/` restricts the pattern to directories.
 * - A pattern containing a slash is anchored to the repo root; a pattern with
 *   no slash matches a single path component at any depth.
 * - `*` and `?` match within one path segment; `**` matches across segments.
 * - Negation (`!`) is not supported.
 *
 * Fail-open: a missing or unreadable `.gateignore`, or a malformed line,
 * yields no additional exclusion — the uncovered-writes check simply falls
 * back to the `.span/**`-only exclusion it already applies.
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { compilePattern } from './span-ignore.js';

export interface GateIgnoreRule {
  /** The raw gitignore-style pattern, retained for diagnostics. */
  pattern: string;
  /** True when `repoRelPath` (POSIX, repo-relative) is excluded by this rule. */
  matches: (repoRelPath: string) => boolean;
}

const GATE_IGNORE_REL = nodePath.join('.span', '.gateignore');

/** Parse `.gateignore` text into rules, skipping comments and blank lines. */
export function parseGateIgnore(content: string): GateIgnoreRule[] {
  const rules: GateIgnoreRule[] = [];
  for (const rawLine of content.split('\n')) {
    const pattern = rawLine.trim();
    if (!pattern || pattern.startsWith('#')) continue;
    rules.push({ pattern, matches: compilePattern(pattern) });
  }
  return rules;
}

/**
 * Load the exclusion rules for a repo. Fail-open: any read failure yields an
 * empty rule set, so an absent/unreadable `.gateignore` excludes nothing
 * beyond the gate's unconditional `.span/**` exclusion.
 */
export function loadGateIgnore(repoRoot: string): GateIgnoreRule[] {
  try {
    const content = fs.readFileSync(nodePath.join(repoRoot, GATE_IGNORE_REL), 'utf8');
    return parseGateIgnore(content);
  } catch {
    return [];
  }
}

/** True when some rule in `rules` matches `repoRelPath`. */
export function isGateIgnored(rules: GateIgnoreRule[], repoRelPath: string): boolean {
  return rules.some((rule) => rule.matches(repoRelPath));
}

/** Signature for injecting a rule loader (production default: {@link loadGateIgnore}). */
export type GateIgnoreLoader = (repoRoot: string) => GateIgnoreRule[];
