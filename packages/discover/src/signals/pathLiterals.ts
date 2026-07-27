/**
 * Detects code that embeds a repository path as a literal outside of module
 * resolution (import/require lines) — shell scripts, CI workflows, and hooks
 * that hard-code paths to other files. Ports `sig_code_path_literals` from
 * the Python span-recovery prototype.
 *
 * @summary Embedded path-literal coupling signal.
 */

import { buildPathExtractor } from '../paths.js';
import type { Candidate, DiscoverConfig, Loc, RepoHistory, RepoScan, Signal } from '../types.js';

const SIGNAL_NAME = 'path-literals';
/** An import line, a re-export-`from` line, a `require(...)` call, or a multi-line import's closing `} from`. */
const MODULE_LINE_RE = /^\s*(?:import\b|export\b.*\bfrom\b|.*\brequire\s*\(|\}\s*from\b)/;
const GLUE_SCORE = 0.58;
const OTHER_SCORE = 0.48;
const GROUP_BONUS = 0.05;
const GROUP_MIN_TARGETS = 2;
const GROUP_MAX_TARGETS = 4;
const GROUP_WINDOW_LINES = 10;
const MAX_CANDIDATES = 250;

/**
 * Extracts the final path segment of a repository-relative POSIX path.
 *
 * @param path - Repository-relative path.
 * @returns Everything after the last `/`, or the whole path when there is none.
 */
function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Checks whether a path has `segment` as one of its `/`-delimited components.
 *
 * @param path - Repository-relative path.
 * @param segment - Path segment to look for.
 * @returns True when `segment` appears anywhere in the path.
 */
function hasSegment(path: string, segment: string): boolean {
  return path.split('/').includes(segment);
}

/**
 * Classifies a referencing file as shell/CI/build "glue" — the kind of file
 * whose embedded paths are wiring rather than incidental mentions, scored
 * higher than ordinary application code.
 *
 * @param path - Repository-relative path of the referencing file.
 * @returns True when the file is glue (shell script, Dockerfile, Makefile,
 *   Justfile, a scripts-directory `.mjs`/`.cjs`, a `.github/` workflow, or a
 *   git-hooks file).
 */
function isGlueFile(path: string): boolean {
  if (path.endsWith('.sh') || path.endsWith('.bash') || path.endsWith('.zsh')) return true;
  const base = basename(path);
  if (base.startsWith('Dockerfile') || base === 'Makefile' || base === 'Justfile') return true;
  if ((path.endsWith('.mjs') || path.endsWith('.cjs')) && hasSegment(path, 'scripts')) return true;
  if ((path.endsWith('.yml') || path.endsWith('.yaml')) && path.startsWith('.github/')) return true;
  if (path.startsWith('.githooks/') || path.startsWith('hooks/')) return true;
  return false;
}

/** One distinct target a referencing file embeds, with the line of its first mention. */
interface FileTarget {
  loc: Loc;
  line: number;
}

/** A qualifying cluster of 2-4 distinct targets embedded within a 10-line window. */
interface GroupWindow {
  targets: readonly FileTarget[];
  startLine: number;
}

/**
 * Finds the earliest 10-line window containing between
 * {@link GROUP_MIN_TARGETS} and {@link GROUP_MAX_TARGETS} of a file's
 * distinct embedded-path targets, if any such window exists.
 *
 * @param targets - Distinct targets embedded in one referencing file.
 * @returns The qualifying window (targets plus its start line), or undefined.
 */
function findGroupedWindow(targets: readonly FileTarget[]): GroupWindow | undefined {
  const sorted = [...targets].sort((a, b) => a.line - b.line);
  for (const anchor of sorted) {
    const windowStart = anchor.line;
    const windowEnd = windowStart + GROUP_WINDOW_LINES - 1;
    const group = sorted.filter((t) => t.line >= windowStart && t.line <= windowEnd);
    if (group.length >= GROUP_MIN_TARGETS && group.length <= GROUP_MAX_TARGETS) {
      return { targets: group, startLine: windowStart };
    }
  }
  return undefined;
}

/**
 * Orders candidates by descending score, then ascending referencing-file path.
 *
 * @param a - First candidate.
 * @param b - Second candidate.
 * @returns Standard comparator ordering.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (b.score !== a.score) return b.score - a.score;
  const pathA = a.locs[0]?.path ?? '';
  const pathB = b.locs[0]?.path ?? '';
  return pathA < pathB ? -1 : pathA > pathB ? 1 : 0;
}

/**
 * Coupling signal that pairs a file with repository paths it embeds as
 * string literals (outside import/require statements).
 */
export const pathLiteralsSignal: Signal = {
  name: SIGNAL_NAME,

  applies(_scan: RepoScan, _history: RepoHistory, _config: DiscoverConfig): boolean {
    return true;
  },

  run(scan: RepoScan, _history: RepoHistory, _config: DiscoverConfig): Candidate[] {
    const extract = buildPathExtractor(scan);
    const candidates: Candidate[] = [];

    for (const file of scan.files) {
      if (file.endsWith('.md') || file.endsWith('.mdx')) continue;
      if (basename(file) === 'package.json') continue;
      const content = scan.text.get(file);
      if (content === undefined) continue;
      const lines = scan.lines.get(file) ?? [];

      const targets = new Map<string, FileTarget>();
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (MODULE_LINE_RE.test(line)) continue;
        const lineNo = i + 1;
        for (const ref of extract(line, file)) {
          if (ref.loc.path === file) continue;
          if (!targets.has(ref.loc.path)) {
            targets.set(ref.loc.path, { loc: ref.loc, line: lineNo });
          }
        }
      }
      if (targets.size === 0) continue;

      const glue = isGlueFile(file);
      const kindScore = glue ? GLUE_SCORE : OTHER_SCORE;

      for (const target of targets.values()) {
        candidates.push({
          locs: [{ path: file, start: target.line, end: target.line }, target.loc],
          score: kindScore,
          signal: SIGNAL_NAME,
          evidence: [`pathlit:${file}#L${target.line}`]
        });
      }

      if (glue) {
        const window = findGroupedWindow([...targets.values()]);
        if (window) {
          candidates.push({
            locs: [{ path: file }, ...window.targets.map((t) => t.loc)],
            score: kindScore + GROUP_BONUS,
            signal: SIGNAL_NAME,
            evidence: [`pathlit:${file}#L${window.startLine}`]
          });
        }
      }
    }

    candidates.sort(compareCandidates);
    return candidates.slice(0, MAX_CANDIDATES);
  }
};
