#!/usr/bin/env node
/**
 * opencode-git-span installer — materializes the plugin's skills and expert
 * agent into OpenCode's filesystem directories (npm plugins cannot contribute
 * them directly).
 *
 * Usage:
 *   opencode-git-span install [--global]
 *   opencode-git-span --help
 *
 * Default target is `.opencode/` under the current working directory;
 * `--global` targets `.opencode/` under the user's home directory. Existing
 * files are overwritten, so re-running after an upgrade is safe.
 */

import { cpSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `opencode-git-span — install git-span skills and the expert agent for OpenCode

Usage:
  npx opencode-git-span install [--global]

Options:
  --global   Install into <homedir>/.opencode/ instead of <cwd>/.opencode/
  -h, --help Show this help

Copies:
  skills/*            -> <target>/skills/<name>/
  agents/expert.md    -> <target>/agents/expert.md`;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let global = false;
  let command = undefined;
  for (const arg of argv) {
    if (arg === '--global') {
      global = true;
    } else if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === 'install' && command === undefined) {
      command = 'install';
    } else {
      fail(`unexpected argument "${arg}"\n\n${USAGE}`);
    }
  }
  return { command, global };
}

/** Every regular file under `dir`, as paths relative to it. */
function listFiles(dir) {
  const entries = readdirSync(dir);
  entries.sort();
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      for (const nested of listFiles(fullPath)) files.push(join(entry, nested));
    } else {
      files.push(entry);
    }
  }
  return files;
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { command, global } = parseArgs(process.argv.slice(2));

if (command !== 'install') {
  fail(`missing required "install" command\n\n${USAGE}`);
}

const target = global ? resolve(homedir(), '.opencode') : resolve(process.cwd(), '.opencode');

const skillsSource = join(packageRoot, 'skills');
const agentSource = join(packageRoot, 'agents', 'expert.md');

let skillNames;
try {
  skillNames = readdirSync(skillsSource).filter((name) => statSync(join(skillsSource, name)).isDirectory());
} catch {
  fail(`skills tree not found at ${skillsSource} — the package installation looks broken`);
}
skillNames.sort();

if (!skillNames.length) {
  fail(`no skills found under ${skillsSource} — the package installation looks broken`);
}

let agentStat;
try {
  agentStat = statSync(agentSource);
} catch {
  fail(`expert agent not found at ${agentSource} — the package installation looks broken`);
}
if (!agentStat.isFile()) {
  fail(`expert agent path is not a file: ${agentSource}`);
}

for (const name of skillNames) {
  const source = join(skillsSource, name);
  const destination = join(target, 'skills', name);
  try {
    cpSync(source, destination, { recursive: true });
  } catch (err) {
    fail(`failed to copy ${source} -> ${destination}: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const relPath of listFiles(source)) {
    console.log(`installed ${join(destination, relPath)}`);
  }
}

const agentDestination = join(target, 'agents', 'expert.md');
try {
  cpSync(agentSource, agentDestination);
} catch (err) {
  fail(`failed to copy ${agentSource} -> ${agentDestination}: ${err instanceof Error ? err.message : String(err)}`);
}
console.log(`installed ${agentDestination}`);

console.log(
  `opencode-git-span: ${skillNames.length} skill${skillNames.length === 1 ? '' : 's'} + expert agent installed into ${relative(process.cwd(), target) || target}`
);
