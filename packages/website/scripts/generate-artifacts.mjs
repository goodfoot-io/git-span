#!/usr/bin/env node

/**
 * The umbrella generation entry point for every agent-facing artifact the
 * website owns: default mode regenerates the committed artifacts in place
 * (what `dev` and `build` chain), `--check` compares them against fresh
 * generation and exits non-zero when any is stale, and `--inventory` prints
 * the declared artifact table with each entry's source.
 *
 * Rust-owned artifacts (commands.mdx, the published schemas) are not emitted
 * here — the Node-only website build cannot chain cargo — they are generated
 * by `yarn workspace git-span build:schemas` and gated by `gen-schemas
 * --check` in the same validate chain. The inventory in
 * `app/lib/artifact-gate/inventory.mjs` records that delegation.
 */
import { checkArtifacts, generateArtifacts, renderInventory } from '../app/lib/artifact-gate/gate.mjs';

const mode = process.argv[2];

if (mode === '--check') {
  const stale = checkArtifacts();
  process.exit(stale ? 1 : 0);
} else if (mode === '--inventory') {
  process.stdout.write(renderInventory());
} else if (mode === undefined) {
  generateArtifacts();
} else {
  console.error(`ERROR: unknown mode '${mode}' (expected --check or --inventory, or no argument to generate)`);
  process.exit(2);
}
