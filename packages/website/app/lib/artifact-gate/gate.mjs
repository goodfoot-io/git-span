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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublication, defaultSkillsRoot, emit } from '../../../scripts/generate-agent-skills.mjs';
import { artifacts } from './inventory.mjs';

/** The package root (`packages/website`) — this module lives in `app/lib/artifact-gate/`. */
const packageRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** The declared inventory entries, indexed by committed path, so the stale
 * report names the label and fix command from the one audit point. */
const inventoryByPath = new Map(artifacts.map((entry) => [entry.path, entry]));

/**
 * The committed artifacts this Node-only gate owns, keyed by their
 * package-relative path, with the renderer that regenerates each. The
 * label and fix command come from the declared inventory entry, never from a
 * copy here — one audit point for the message a stale report names. The
 * Rust-owned committed artifacts (commands.mdx, the published schemas) are
 * deliberately absent: they are generated and gated by gen-schemas, which
 * this module cannot chain.
 */
const websiteOwnedRenderers = new Map([
  [
    'app/lib/agent-skills.generated.ts',
    (toDir, skillsRoot) =>
      emit(buildPublication(skillsRoot), path.join(toDir, 'app/lib/agent-skills.generated.ts'))
  ]
]);

/** Emit every website-owned committed artifact into `toDir` (default: their
 * committed locations, so the build regenerates in place). */
export function generateArtifacts({ toDir = packageRoot, skillsRoot = defaultSkillsRoot } = {}) {
  for (const render of websiteOwnedRenderers.values()) {
    render(toDir, skillsRoot);
  }
}

/**
 * Compare every website-owned committed artifact under `root` against fresh
 * generation from `skillsRoot` (defaults: the committed locations and the
 * normative plugin skill tree). Reports all stale artifacts on stderr,
 * naming each label and fix command, and returns true when any is stale —
 * the caller owns the exit code. A missing committed file is stale, not an
 * error.
 *
 * The fresh bytes are emitted into a temp directory pinned inside `root`:
 * the repo's biome config sets vcs.useIgnoreFile, and a git-ignored temp
 * file would keep its raw pre-format bytes and false-stale. The temp
 * directory is removed in a finally block so a throwing renderer never
 * leaks it.
 */
export function checkArtifacts({ root = packageRoot, skillsRoot = defaultSkillsRoot } = {}) {
  const tempDir = mkdtempSync(path.join(root, '.artifact-check-'));
  try {
    generateArtifacts({ toDir: tempDir, skillsRoot });
    let stale = false;
    for (const artifactPath of websiteOwnedRenderers.keys()) {
      const committed = readCommitted(root, artifactPath);
      const fresh = readCommitted(tempDir, artifactPath);
      if (committed === undefined || fresh === undefined || Buffer.compare(committed, fresh) !== 0) {
        const entry = inventoryByPath.get(artifactPath);
        const label = entry?.label ?? artifactPath;
        const fixCommand = entry?.fixCommand ?? 'yarn workspace @goodfoot/git-span-website generate:artifacts';
        console.error(`ERROR: ${label} is stale; run ${fixCommand}`);
        stale = true;
      }
    }
    return stale;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Read a committed artifact as raw bytes; undefined when absent — a missing
 * file is stale, not a reason to crash the whole check. */
function readCommitted(root, artifactPath) {
  try {
    return readFileSync(path.join(root, artifactPath));
  } catch {
    return undefined;
  }
}

/** Render the full declared inventory as a markdown table for `--inventory`:
 * every entry with its published path, kind, and human-authored source. */
export function renderInventory() {
  const rows = artifacts.map((entry) => `| \`${entry.path}\` | ${entry.kind} | ${entry.source} |`);
  return ['| Artifact | Kind | Source |', '| --- | --- | --- |', ...rows, ''].join('\n');
}
