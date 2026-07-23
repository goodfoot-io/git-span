/**
 * `git-span-discover` entrypoint — runs the full implicit-dependency mining
 * pipeline against a target repository and prints a ranked report.
 *
 * Pipeline (plans/initial.md's mermaid diagram):
 *
 *   all 7 signals (parallel, via RepoContext)
 *     → grouping (union-find fuzzy merge)
 *     → scoring pass 1 + threshold
 *     → both disqualifiers against survivors (parallel)
 *     → scoring pass 2 + threshold
 *     → rename-tracking to HEAD
 *     → JSON + markdown output
 *
 * `.span/` is never read or written: all history/content access goes through
 * `RepoContext` (src/prefilter.ts), which excludes `.span/` at both the
 * history-walk and content-read seams (design decisions 5). The CLI adds no
 * separate `.span/` access path of its own.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as disqualifiers from './disqualifiers/index.js';
import { isNotAGitRepoError } from './git.js';
import { mergeAnchorGroups } from './grouping.js';
import { type DiscoveredGroup, toJson, toMarkdown } from './output.js';
import { createRepoContext } from './prefilter.js';
import { createRenameResolver } from './rename-tracking.js';
import { scoreEvidence } from './scoring.js';
import * as signals from './signals/index.js';
import type { Disqualifier, RepoContext, Signal } from './types.js';

/**
 * Emits a stage-boundary breadcrumb to stderr — cheap visibility for long
 * runs (finding 3). No percentage/ETA tracking, just "still making progress"
 * markers at the pipeline stages already present below.
 */
function reportProgress(message: string): void {
  process.stderr.write(`git-span-discover: ${message}\n`);
}

/**
 * Pass-1 threshold: a cheap prune over signal-only scores before the more
 * expensive disqualifiers run.
 *
 * `0.55` (just above the 0.5 neutral point) turned out to be far too
 * permissive at real-repo scale: with the old `scoring.ts` weights, a single
 * circumstantial signal (`time-window-co-edit`, `same-author-session`,
 * `lexical-similarity`) at its typical real-repo strength cleared it alone,
 * so ~97% of the 118k merged groups from a 658-file/1072-commit monorepo
 * probe advanced to the disqualifier stage.
 *
 * `scoring.ts`'s `SIGNAL_WEIGHTS` were recalibrated (see its comment) so that
 * even a *maximal-strength* single circumstantial signal caps out well short
 * of 1.0. `0.94` is derived, not fitted: it is (just above) the score all
 * four circumstantial signals (`time-window-co-edit`, `same-author-session`,
 * `lexical-similarity`, `release-tag-delta`) reach *together* when each is
 * near its own strong-tail (~p90) strength in the probe corpus — i.e. the
 * point at which a group needs either full corroboration across every weak
 * signal this pipeline has, or at least one structural signal
 * (`association-rules`/`shared-config-key`, which already gate on
 * statistical/rarity significance before emitting at all) to advance. Rerunning
 * the same monorepo probe post-recalibration: 118,288 merged groups, of which
 * 375 (0.32%) clear `0.94` pre-disqualifier — down from 114,481 (97%) at the
 * old threshold/weights.
 */
const PASS1_THRESHOLD = 0.94;

/**
 * Pass-2 threshold: the final reporting cut, after disqualifiers may have
 * pulled a score down. Kept below `PASS1_THRESHOLD` by roughly the same
 * log-odds gap as the pre-recalibration pair (`logit(0.55) - logit(0.5) ≈
 * 0.2`), so a group that cleared pass 1 isn't dropped by pass 2 purely
 * because its disqualifier evidence is weakly-inconclusive rather than a
 * genuine explicit reference — but a disqualifier that actually fires (an
 * explicit tree-sitter or raw-path reference) still has enough weight
 * (1.4-1.5, see `DISQUALIFIER_WEIGHTS`) to drop a group below it.
 */
const PASS2_THRESHOLD = 0.9;

const ALL_SIGNALS: Signal[] = Object.values(signals);
const ALL_DISQUALIFIERS: Disqualifier[] = Object.values(disqualifiers);

/**
 * Runs the full pipeline against `repoRoot` and returns the surviving,
 * HEAD-resolved candidate groups. Exposed (rather than only `main`) so the
 * integration test can drive the whole pipeline in-process.
 */
export async function discover(
  repoRoot: string,
  ctx: RepoContext = createRepoContext(repoRoot)
): Promise<DiscoveredGroup[]> {
  reportProgress('walking commit history and running signals');
  const signalResults = await Promise.all(ALL_SIGNALS.map((signal) => signal(ctx)));

  reportProgress('grouping candidates');
  const merged = mergeAnchorGroups(signalResults.flat());

  // Pass 1 — signal evidence only.
  reportProgress('scoring (pass 1)');
  const survivors = merged.filter((group) => {
    group.score = scoreEvidence(group.evidence);
    return group.score >= PASS1_THRESHOLD;
  });

  // Disqualifiers against pass-1 survivors.
  reportProgress('running disqualifiers');
  const withDisqualifiers = await Promise.all(
    survivors.map(async (group) => ({
      group,
      disqualifiers: await Promise.all(ALL_DISQUALIFIERS.map((disqualifier) => disqualifier(group, ctx)))
    }))
  );

  // Pass 2 — signal + disqualifier evidence.
  reportProgress('scoring (pass 2)');
  const passed = withDisqualifiers.filter(({ group, disqualifiers: dq }) => {
    group.score = scoreEvidence(group.evidence, dq);
    return group.score >= PASS2_THRESHOLD;
  });

  // Rename-tracking to HEAD, dropping groups whose files were all deleted.
  reportProgress('resolving renames to HEAD');
  const resolver = await createRenameResolver(ctx);
  const discovered: DiscoveredGroup[] = [];
  for (const { group, disqualifiers: dq } of passed) {
    const resolved = await resolver.resolve(group);
    if (!resolved) continue;
    discovered.push({
      anchors: resolved.anchors,
      score: resolved.score,
      signals: resolved.evidence,
      disqualifiers: dq
    });
  }

  discovered.sort((a, b) => b.score - a.score);
  return discovered;
}

interface CliOptions {
  repoRoot: string;
  format: 'markdown' | 'json';
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { repoRoot: process.cwd(), format: 'markdown', help: false };
  let repoSet = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.format = 'json';
    else if (arg === '--markdown' || arg === '--md') options.format = 'markdown';
    else if (!arg.startsWith('-') && !repoSet) {
      options.repoRoot = path.resolve(arg);
      repoSet = true;
    }
  }
  return options;
}

const HELP = `git-span-discover — mine implicit file/line-range couplings from local git history.

Usage:
  git-span-discover [repo] [--json | --markdown]

Arguments:
  repo            Path to the target git repository (default: current directory).

Options:
  --json          Emit machine-readable JSON instead of the markdown summary.
  --markdown      Emit the human-readable markdown summary (default).
  -h, --help      Show this help.

Reads only local git history and file content; never reads or writes .span/.`;

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  let groups: DiscoveredGroup[];
  try {
    groups = await discover(options.repoRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isNotAGitRepoError(message)) {
      process.stderr.write(`git-span-discover: not a git repository: ${options.repoRoot}\n`);
      return 1;
    }
    throw err;
  }

  reportProgress('rendering report');
  const rendered = options.format === 'json' ? toJson(groups) : toMarkdown(groups);
  process.stdout.write(`${rendered}\n`);
  return 0;
}

/**
 * Only auto-run the pipeline when this module is the process entrypoint (the
 * built bin), not when it is imported — e.g. by the integration test, which
 * drives {@link discover} directly and must not trigger a full run against the
 * test process's cwd on import.
 */
const invokedPath = process.argv[1];
const isEntrypoint = invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`git-span-discover: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
