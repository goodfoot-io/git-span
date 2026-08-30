#!/usr/bin/env node

// Assert every plugin carries one version across all four platform manifests
// (plugins-claude/<name>/.claude-plugin/plugin.json,
// plugins-codex/<name>/.codex-plugin/plugin.json,
// plugins-opencode/<name>/package.json,
// plugins-antigravity/<name>/plugin.json) and its Claude marketplace entry.
// A plugin with any platform manifest must carry all four AND a marketplace
// entry — a missing manifest or entry would silently ship that surface a
// stale version.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { marketplacePath, platformManifest } from './plugin-manifests.mjs';

/** @type {string} */
let root;
try {
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
} catch (error) {
  console.error(`ERROR: cannot resolve repository root: ${error.message}`);
  process.exit(1);
}

/**
 * @param {string} path
 * @returns {any}
 */
function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

/** @type {string[]} */
const failures = [];
/** @type {Set<string>} */
const pluginNames = new Set();
for (const dir of Object.keys(platformManifest)) {
  const absolute = resolve(root, dir);
  if (!existsSync(absolute)) continue;
  for (const name of readdirSync(absolute)) {
    if (statSync(join(absolute, name)).isDirectory()) pluginNames.add(name);
  }
}

/** @type {Map<string, string>} */
const marketplaceVersions = new Map();
if (existsSync(resolve(root, marketplacePath))) {
  for (const plugin of readJson(marketplacePath).plugins ?? []) {
    if (plugin && typeof plugin.name === 'string' && typeof plugin.version === 'string') {
      marketplaceVersions.set(plugin.name, plugin.version);
    }
  }
}

let checkedPlugins = 0;
for (const name of [...pluginNames].sort()) {
  const manifestPaths = Object.values(platformManifest).map((manifestPath) => manifestPath(name));
  const present = manifestPaths.filter((path) => existsSync(resolve(root, path)));
  if (present.length === 0) continue; // A bare directory with no manifest anywhere is not a plugin manifest set.
  for (const path of manifestPaths.filter((path) => !present.includes(path))) {
    failures.push(
      `${name}: missing platform manifest ${path} — a plugin with any platform manifest must carry all four`
    );
  }

  /** @type {[string, string][]} */
  const versions = [];
  for (const path of present) {
    const version = readJson(path).version;
    if (typeof version === 'string') {
      versions.push([path, version]);
    } else {
      failures.push(`${name}: ${path} carries no version string`);
    }
  }
  const marketplaceVersion = marketplaceVersions.get(name);
  if (marketplaceVersion === undefined) {
    failures.push(
      `${name}: missing marketplace entry in ${marketplacePath} — ` +
        'a plugin with any platform manifest must carry a marketplace entry'
    );
  } else {
    versions.push([`${marketplacePath} plugins entry "${name}"`, marketplaceVersion]);
  }
  if (new Set(versions.map(([, version]) => version)).size > 1) {
    failures.push(`${name}: versions disagree: ${versions.map(([path, version]) => `${path}=${version}`).join(', ')}`);
  }
  checkedPlugins += 1;
}

if (failures.length > 0) {
  console.error('ERROR: plugin version consistency check failed:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`PASS: ${checkedPlugins} plugin(s) carry one version across all platform manifests and the marketplace`);
