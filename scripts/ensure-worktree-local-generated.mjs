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

// Repo-relative scope -> the generated paths that scope owns, relative to the scope.
// Each entry is gitignored, which is what exposes it to the provisioner. Entries are listed
// whether or not they exist right now: a path absent from the primary checkout today gets
// linked as soon as somebody creates it there.
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
  'packages/discover': [
    'build',
    'tsconfig.tsbuildinfo',
    'node_modules/.vite',
    'node_modules/.vite-temp'
  ],
  'packages/extension': [
    'dist',
    'out',
    'tsconfig.tsbuildinfo',
    'node_modules/.vite',
    'node_modules/.vite-temp'
  ],
  scripts: ['dist'],
  'npm/git-span-linux-arm64': ['bin']
};

// Paths whose basename says "directory" get recreated as one so the producing tool finds the
// slot it expects; everything else is left absent for the tool to write fresh.
const FILE_SUFFIXES = ['.tsbuildinfo'];

const isFileArtifact = (relativePath) =>
  FILE_SUFFIXES.some((suffix) => relativePath.endsWith(suffix));

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

/** True when `candidate` is `root` itself or lives underneath it. */
const isInside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const repaired = [];

for (const scope of scopes) {
  const scopeRoot = path.join(repoRoot, scope);

  for (const relativePath of GENERATED_PATHS[scope]) {
    const linkPath = path.join(scopeRoot, relativePath);

    let stats;
    try {
      stats = fs.lstatSync(linkPath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
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
