#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const forbiddenPackages = ['@goodfoot/' + 'claude-code-hooks', '@goodfoot/' + 'codex-hooks'];
const retainedIdentifiers = [
  {
    path: '.claude/settings.json',
    content: '    "claude-code-hooks@goodfoot": true,',
    count: 1
  }
];

/**
 * @param {string} content
 * @param {string} needle
 * @returns {number}
 */
function occurrences(content, needle) {
  let count = 0;
  let offset = 0;
  let match = content.indexOf(needle, offset);
  while (match !== -1) {
    count += 1;
    offset = match + needle.length;
    match = content.indexOf(needle, offset);
  }
  return count;
}

let root;
let trackedPaths;
try {
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const deletedPaths = new Set(
    execFileSync('git', ['ls-files', '--deleted', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  );
  trackedPaths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path && !deletedPaths.has(path));
} catch (error) {
  console.error(`ERROR: cannot enumerate git-tracked files: ${error.message}`);
  process.exit(1);
}

const contents = new Map();
const failures = [];
for (const path of trackedPaths) {
  const absolutePath = resolve(root, path);
  let content;
  try {
    const stat = lstatSync(absolutePath);
    if (stat.isDirectory()) continue; // A tracked gitlink; its repository is a separate scope.
    content = stat.isSymbolicLink() ? readlinkSync(absolutePath) : readFileSync(absolutePath, 'utf8');
  } catch (error) {
    failures.push(`${path}: cannot read tracked content (${error.message})`);
    continue;
  }
  contents.set(path, content);

  for (const packageName of forbiddenPackages) {
    const count = occurrences(content, packageName);
    if (count > 0) failures.push(`${path}: ${count} superseded hook package occurrence(s): ${packageName}`);
  }
}

for (const entry of retainedIdentifiers) {
  const content = contents.get(entry.path);
  const actual = content === undefined ? 0 : occurrences(content, entry.content);
  if (actual !== entry.count) {
    failures.push(
      `${entry.path}: allowlist drift for exact retained content (expected ${entry.count}, found ${actual}): ${entry.content}`
    );
  }
}

if (failures.length > 0) {
  console.error('ERROR: legacy agent-hook migration check failed:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`PASS: ${trackedPaths.length} tracked paths contain no superseded hook packages`);
