#!/usr/bin/env node
//
// ensure-worktree-local-generated.mjs — keep generated artifacts inside the checkout that
// produced them.
//
// Card worktrees are provisioned by symlinking *every* gitignored path from the primary
// checkout into the new worktree, plus every entry of the primary checkout's `node_modules`
// through a second, separate code path. The provisioner lives in the Cards VS Code
// extension, not in this repository, so it cannot be fixed here; its `.worktreeinclude`
// escape hatch does not help either, because it copies matching files *after* the symlinks
// exist, so each copy traverses the link and lands back on its own source file.
//
// Sharing a gitignored path across checkouts is safe exactly when its contents are keyed by
// content rather than by the checkout that produced them. That predicate is the whole design:
//
//   SHARED, deliberately   .yarn/cache, .yarn/global, .yarn/shared-global (content-addressed),
//                          packages/extension/.vscode-test (VS Code downloads keyed by
//                          version), the historical *.vsix release artifacts (immutable, keyed
//                          by version), and packages/git-span/target-cache (superseded by the
//                          locked shared cargo root — see packages/git-span/CLAUDE.md).
//
//   REPAIRED, below        Everything derived from a checkout's own sources. One worktree's
//                          copy is not interchangeable with another's, so sharing it is not a
//                          cache, it is a correctness bug.
//
// Two failure directions, both observed:
//
//   Reads   packages/website/.source holds fumadocs-mdx output whose generated
//           `import.meta.glob` carries a relative base (`./../content/docs`) that Vite
//           resolves against the *real* path of the file. Through a symlink that base lands
//           in the other checkout, so the site builds that checkout's documentation — with no
//           error and no warning.
//
//   Writes  tsconfig.tsbuildinfo is an incremental manifest. Shared, `tsc` can conclude a file
//           is unchanged based on the *other* checkout's state and skip work, so a green
//           typecheck stops meaning that this checkout typechecks. Writing through the link
//           mutates the other checkout in the bargain.
//
// This runs ahead of anything that reads or writes these paths and converts an escaping
// symlink into a real, local directory or a clean slate for a file. Only the link is removed;
// whatever it pointed at is left untouched. It is a no-op in the primary checkout, where these
// paths are already real, and a no-op on a second run. Any error it cannot attribute to an
// absent path is fatal, so a build never proceeds against a path it failed to repair.
//
// Usage: ensure-worktree-local-generated.mjs <scope>... | --all
//   where <scope> is a key of GENERATED_PATHS below (a repo-relative directory).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Platform package scopes are discovered at runtime rather than hardcoded: .gitignore ignores
// every `npm/git-span-*/bin` path, present and future, and hardcoding just the host platform
// left the other targets free to pack the primary checkout's binary from a worktree (main-324).
const platformPackageScopes = fs
  .readdirSync(path.join(repoRoot, 'npm'), { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory() && dirent.name.startsWith('git-span-'))
  .map((dirent) => `npm/${dirent.name}`)
  .sort();

// Repo-relative scope -> the generated paths that scope owns, relative to the scope.
// Each entry is gitignored, which is what exposes it to the provisioner. Entries are listed
// whether or not they exist right now: a path absent from the primary checkout today gets
// linked as soon as somebody creates it there.
/** @type {Record<string, string[]>} */
const GENERATED_PATHS = {
  'packages/website': [
    '.source',
    '.react-router',
    '.wrangler',
    'dist',
    'build',
    'node_modules/.vite',
    'node_modules/.vite-temp'
  ],
  'packages/discover': ['build', 'tsconfig.tsbuildinfo', 'node_modules/.vite', 'node_modules/.vite-temp'],
  'packages/extension': ['dist', 'out', 'tsconfig.tsbuildinfo', 'node_modules/.vite', 'node_modules/.vite-temp'],
  // src/minisweagent_gitspan/hooks/ holds the hook bundles built from
  // packages/agent-hooks sources (`yarn build:hooks:mswea`) — they ship inside
  // the Python package so the wheel is self-contained; .venv is the package's
  // uv-managed Python environment. Both are checkout-derived, not
  // content-addressed caches.
  'packages/mini-swe-agent': ['src/minisweagent_gitspan/hooks', '.venv'],
  scripts: ['dist'],
  ...Object.fromEntries(platformPackageScopes.map((scope) => [scope, ['bin']]))
};

// Paths whose basename says "directory" get recreated as one so the producing tool finds the
// slot it expects; everything else is left absent for the tool to write fresh.
const FILE_SUFFIXES = ['.tsbuildinfo'];

/**
 * @param {string} relativePath
 * @returns {boolean}
 */
const isFileArtifact = (relativePath) => FILE_SUFFIXES.some((suffix) => relativePath.endsWith(suffix));

const usage = () => {
  const scopes = Object.keys(GENERATED_PATHS).sort().join('\n  ');
  process.stderr.write(`usage: ensure-worktree-local-generated.mjs <scope>... | --all\n\nscopes:\n  ${scopes}\n`);
};

const args = process.argv.slice(2);
if (args.length === 0) {
  usage();
  process.exit(1);
}

const scopes = args.includes('--all') ? Object.keys(GENERATED_PATHS) : args;

const unknown = scopes.filter((scope) => !Object.hasOwn(GENERATED_PATHS, scope));
if (unknown.length > 0) {
  process.stderr.write(`ensure-worktree-local-generated: unknown scope(s): ${unknown.join(', ')}\n`);
  usage();
  process.exit(1);
}

// Platform bin repair is never skippable: the local-materialization invariant spans every
// platform target, so it is enforced on every invocation, not just --all or explicit scopes.
const visited = [...new Set([...scopes, ...platformPackageScopes])];

/**
 * True when `candidate` is `root` itself or lives underneath it.
 *
 * @param {string} root
 * @param {string} candidate
 * @returns {boolean}
 */
const isInside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const repaired = [];

for (const scope of visited) {
  const scopeRoot = path.join(repoRoot, scope);

  for (const relativePath of GENERATED_PATHS[scope]) {
    const linkPath = path.join(scopeRoot, relativePath);

    let stats;
    try {
      stats = fs.lstatSync(linkPath);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      // Absent platform bin dirs are still materialized: the regression guard below demands
      // every gitignored platform bin path exist as a local directory, so an unbuilt platform
      // gets an empty local slot instead of relying on absence to mean safety.
      if (platformPackageScopes.includes(scope)) {
        fs.mkdirSync(linkPath, { recursive: true });
      }
      continue;
    }

    if (!stats.isSymbolicLink()) continue;

    const target = path.resolve(scopeRoot, path.dirname(relativePath), fs.readlinkSync(linkPath));
    if (isInside(scopeRoot, target)) continue;

    fs.unlinkSync(linkPath);
    if (!isFileArtifact(relativePath)) {
      fs.mkdirSync(linkPath, { recursive: true });
    }
    repaired.push(`${scope}/${relativePath} (was -> ${target})`);
  }
}

if (repaired.length > 0) {
  process.stderr.write(
    `ensure-worktree-local-generated: replaced ${String(repaired.length)} cross-checkout symlink(s) with worktree-local paths:\n${repaired
      .map((entry) => `  ${entry}\n`)
      .join('')}`
  );
}

// Regression guard for the repair pass (main-324): every gitignored npm platform bin path must
// be materialized inside this checkout — a real directory, or a symlink resolving back inside
// it. Checked across all discovered platform scopes regardless of which scopes were requested,
// so a future platform cannot regress into sharing the primary checkout's binary.
const unmaterialized = [];
for (const scope of platformPackageScopes) {
  const scopeRoot = path.join(repoRoot, scope);
  const linkPath = path.join(scopeRoot, 'bin');

  let stats;
  try {
    stats = fs.lstatSync(linkPath);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    unmaterialized.push(`${scope}/bin (missing)`);
    continue;
  }

  if (!stats.isSymbolicLink()) continue;

  const target = path.resolve(scopeRoot, fs.readlinkSync(linkPath));
  if (isInside(scopeRoot, target)) continue;

  unmaterialized.push(`${scope}/bin (still -> ${target})`);
}

if (unmaterialized.length > 0) {
  process.stderr.write(
    `ensure-worktree-local-generated: gitignored npm platform bin path(s) not materialized in this checkout:\n${unmaterialized
      .map((entry) => `  ${entry}\n`)
      .join('')}`
  );
  process.exit(1);
}
