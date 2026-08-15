/**
 * Pure gate logic for the agent-facing artifact inventory: generate the
 * website-owned committed artifacts, check them against fresh generation, and
 * render the inventory table.
 *
 * Contract (Phase 1): the three exported functions below. Generate and check
 * share one code path — check emits into a temporary directory inside this
 * package (never a git-ignored path: the repo's biome.json sets
 * vcs.useIgnoreFile, and an ignored temp file would keep its raw pre-format
 * bytes and false-stale) and byte-compares. Nothing here touches the network.
 *
 * TS-free by design: the CLI wrapper runs under plain node, which cannot
 * load `.ts`.
 */
import { fileURLToPath } from 'node:url';

/** The package root (`packages/website`) — this module lives in `app/lib/artifact-gate/`. */
const packageRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** Emit every website-owned committed artifact into `toDir` (default: their
 * committed locations, so the build regenerates in place). */
export function generateArtifacts({ toDir = packageRoot } = {}) {
  throw new Error('Not Implemented');
}

/**
 * Compare every website-owned committed artifact under `root` against fresh
 * generation from `skillsRoot` (defaults: the committed locations and the
 * normative plugin skill tree). Reports all stale artifacts on stderr,
 * naming each label and fix command, and returns true when any is stale —
 * the caller owns the exit code. A missing committed file is stale, not an
 * error.
 */
export function checkArtifacts({ root = packageRoot, skillsRoot = undefined } = {}) {
  throw new Error('Not Implemented');
}

/** Render the full inventory table for `--inventory`. */
export function renderInventory() {
  throw new Error('Not Implemented');
}
