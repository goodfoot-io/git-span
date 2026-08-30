/**
 * The single definition of where a plugin's per-platform version manifests
 * live, shared by scripts/check-version-consistency.mjs and
 * .githooks/pre-commit.version-lock.sh.
 *
 * Kept in one module because the checker and the hook must agree about what a
 * plugin's manifest set is: a layout added to one but not the other lets a
 * platform ship a stale version that the other tool certified as consistent.
 * @module
 */

import { join } from 'node:path';

/** @type {Record<string, (name: string) => string>} */
export const platformManifest = {
  'plugins-claude': (name) => join('plugins-claude', name, '.claude-plugin', 'plugin.json'),
  'plugins-codex': (name) => join('plugins-codex', name, '.codex-plugin', 'plugin.json'),
  'plugins-opencode': (name) => join('plugins-opencode', name, 'package.json'),
  'plugins-antigravity': (name) => join('plugins-antigravity', name, 'plugin.json')
};

/** The Claude marketplace manifest every released plugin must be listed in. */
export const marketplacePath = '.claude-plugin/marketplace.json';
