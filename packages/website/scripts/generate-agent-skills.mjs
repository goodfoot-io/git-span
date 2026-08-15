#!/usr/bin/env node

/**
 * Build-time generator for the agent-skills discovery surface: reads the
 * normative Claude plugin skill tree (`plugins-claude/git-span/skills`) and
 * emits `app/lib/agent-skills.generated.ts` — the draft-v0.2.0 index document
 * plus every served skill file, byte-identical to the tree.
 *
 * Chained into the package's `dev` and `build` scripts so deploys and tunnel
 * previews always regenerate; deliberately not in `test`/`typecheck` — the
 * contract suite compares the committed artifact against a fresh
 * `buildPublication` run, so a plugin-tree edit without regeneration fails
 * the suite instead of being silently refreshed.
 *
 * Not Implemented — TDD bootstrap stub.
 */
import { pathToFileURL } from 'node:url';

/**
 * Pure mapping: plugin skill tree → publication object. Imported by the
 * contract suite for the staleness assertion; must never write.
 *
 * @param skillsRoot - Absolute path to the plugin skill tree root.
 */
export function buildPublication(skillsRoot) {
  void skillsRoot;
  throw new Error('Not Implemented');
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  throw new Error('Not Implemented');
}
