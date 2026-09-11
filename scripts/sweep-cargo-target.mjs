#!/usr/bin/env node
// Sweep stale compilation-unit artifacts out of a shared, multi-worktree
// cargo target root (see packages/git-span/scripts/cargo-build-system.md).
//
// The root is shared across every worktree on the machine; cargo fingerprints
// embed each building worktree's absolute path, so a crate built from N
// worktrees over time leaves N sets of hash-suffixed `deps/`, `.fingerprint/`,
// `incremental/`, and build-script `build/` entries. Cargo never reclaims the
// entries a worktree stops touching (there is no whole-root wipe short of a
// toolchain/lockfile change — see cleanup-stale-target.sh), so this is the
// dominant, unbounded growth source in any container that shares one cargo
// target root across many short-lived worktrees.
//
// This script deletes only individual compilation-unit artifacts whose mtime
// is older than --max-age-days, inside cargo's own well-known artifact
// directories (deps/, .fingerprint/, incremental/, build/) found anywhere
// under the root. It never touches anything else (lockfiles, stamps, tripwire
// logs, benchmark history), and it prunes directories that become empty as a
// result — which is what reclaims an entire abandoned worktree's target tree
// (e.g. main-301) once every artifact inside has aged out.
//
// Usage:
//   node scripts/sweep-cargo-target.mjs [--root <path>] [--max-age-days N] [--apply] [--json]
//
// Safety: dry run is the default. Nothing is deleted unless --apply is passed.

import { promises as fs } from "node:fs";
import path from "node:path";

const ARTIFACT_DIR_NAMES = new Set(["deps", ".fingerprint", "incremental", "build"]);
// Profile root dirs also hold the final linked binaries/examples directly
// (cargo hardlinks these from deps/), one fresh copy per worktree that has
// ever built here — these must be swept too, not just their deps/ subdirs.
const PROFILE_DIR_NAMES = new Set(["debug", "release"]);

function parseArgs(argv) {
  const opts = {
    root: process.env.GIT_SPAN_CARGO_TARGET_ROOT || "/var/cache/git-span/cargo-target",
    maxAgeDays: 14,
    apply: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") opts.root = argv[++i];
    else if (arg === "--max-age-days") opts.maxAgeDays = Number(argv[++i]);
    else if (arg === "--apply") opts.apply = true;
    else if (arg === "--dry-run") opts.apply = false;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: sweep-cargo-target.mjs [--root <path>] [--max-age-days N] [--apply] [--json]\n" +
          "  Default is a dry run (reports what would be removed). Pass --apply to actually delete.",
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (!Number.isFinite(opts.maxAgeDays) || opts.maxAgeDays < 0) {
    console.error(`--max-age-days must be a non-negative number, got: ${opts.maxAgeDays}`);
    process.exit(1);
  }
  return opts;
}

async function dirSize(dirPath) {
  let total = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) {
      const st = await fs.stat(full).catch(() => null);
      if (st) total += st.size;
    }
  }
  return total;
}

async function newestMtimeMs(fsPath, isDir) {
  if (!isDir) {
    const st = await fs.stat(fsPath);
    return st.mtimeMs;
  }
  let newest = 0;
  const entries = await fs.readdir(fsPath, { withFileTypes: true });
  if (entries.length === 0) {
    const st = await fs.stat(fsPath);
    return st.mtimeMs;
  }
  for (const entry of entries) {
    const full = path.join(fsPath, entry.name);
    const st = await fs.lstat(full).catch(() => null);
    if (!st) continue;
    const m = st.isDirectory() ? await newestMtimeMs(full, true) : st.mtimeMs;
    if (m > newest) newest = m;
  }
  return newest;
}

// Find candidate compilation-unit entries: the direct children of any
// directory named deps/, .fingerprint/, incremental/, or build/, wherever
// those occur under root. Each candidate is judged independently by its own
// newest-mtime, so a worktree that is still being built keeps its live units
// even inside an otherwise-old target tree.
async function findCandidates(root) {
  const candidates = [];

  async function walk(dirPath) {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dirPath, entry.name);
      // "build" is ambiguous: cargo's own build-script output dir always
      // sits directly inside a profile dir (target/debug/build/<pkg-hash>),
      // but repos are free to use "build" as an unrelated grouping folder
      // above the profile dirs (e.g. <crate>/build/{debug,release}/...).
      // Only treat it as an artifact dir in the former case — otherwise walk
      // into it normally so its debug/release children get inspected.
      const isBuildScriptDir = entry.name === "build" && PROFILE_DIR_NAMES.has(path.basename(dirPath));
      const isArtifactDir = entry.name !== "build" ? ARTIFACT_DIR_NAMES.has(entry.name) : isBuildScriptDir;
      if (isArtifactDir) {
        let children;
        try {
          children = await fs.readdir(full, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const child of children) {
          candidates.push(path.join(full, child.name));
        }
        // Don't descend further into artifact dirs — their contents are
        // already captured as candidates above.
        continue;
      }
      if (PROFILE_DIR_NAMES.has(entry.name)) {
        let siblings;
        try {
          siblings = await fs.readdir(full, { withFileTypes: true });
        } catch {
          siblings = [];
        }
        for (const sibling of siblings) {
          if (sibling.isFile()) candidates.push(path.join(full, sibling.name));
        }
      }
      await walk(full);
    }
  }

  await walk(root);
  return candidates;
}

async function removeEmptyDirsUnder(root) {
  const removed = [];

  async function walk(dirPath) {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return false;
    }
    let allRemoved = true;
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        allRemoved = false;
        continue;
      }
      const full = path.join(dirPath, entry.name);
      const childEmptied = await walk(full);
      if (!childEmptied) allRemoved = false;
    }
    if (dirPath === root) return allRemoved;
    const remaining = await fs.readdir(dirPath);
    if (remaining.length === 0) {
      await fs.rmdir(dirPath);
      removed.push(dirPath);
      return true;
    }
    return false;
  }

  await walk(root);
  return removed;
}

function humanSize(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)}${units[i]}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cutoffMs = Date.now() - opts.maxAgeDays * 24 * 60 * 60 * 1000;

  let rootStat;
  try {
    rootStat = await fs.stat(opts.root);
  } catch {
    console.error(`Root does not exist or is not accessible: ${opts.root}`);
    process.exit(1);
  }
  if (!rootStat.isDirectory()) {
    console.error(`Root is not a directory: ${opts.root}`);
    process.exit(1);
  }

  const candidates = await findCandidates(opts.root);

  let staleCount = 0;
  let staleBytes = 0;
  let freshCount = 0;
  const staleEntries = [];

  for (const candidatePath of candidates) {
    const lst = await fs.lstat(candidatePath).catch(() => null);
    if (!lst) continue;
    if (lst.isSymbolicLink()) continue; // never follow/delete symlinks blindly
    const isDir = lst.isDirectory();
    const mtimeMs = isDir ? await newestMtimeMs(candidatePath, true) : lst.mtimeMs;
    if (mtimeMs >= cutoffMs) {
      freshCount++;
      continue;
    }
    const size = isDir ? await dirSize(candidatePath) : lst.size;
    staleCount++;
    staleBytes += size;
    staleEntries.push({
      path: path.relative(opts.root, candidatePath),
      size,
      ageDays: Math.floor((Date.now() - mtimeMs) / (24 * 60 * 60 * 1000)),
    });
  }

  staleEntries.sort((a, b) => b.size - a.size);

  if (opts.apply) {
    for (const entry of staleEntries) {
      const full = path.join(opts.root, entry.path);
      await fs.rm(full, { recursive: true, force: true });
    }
  }

  const removedEmptyDirs = opts.apply ? await removeEmptyDirsUnder(opts.root) : [];

  const result = {
    root: opts.root,
    maxAgeDays: opts.maxAgeDays,
    mode: opts.apply ? "apply" : "dry-run",
    candidatesScanned: candidates.length,
    freshCount,
    staleCount,
    staleBytes,
    staleHuman: humanSize(staleBytes),
    emptyDirsRemoved: removedEmptyDirs.length,
    topEntries: staleEntries.slice(0, 20).map((e) => ({ ...e, sizeHuman: humanSize(e.size) })),
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Root: ${result.root}`);
  console.log(`Mode: ${result.mode}${opts.apply ? "" : " (pass --apply to actually delete)"}`);
  console.log(`Age cutoff: ${opts.maxAgeDays} days`);
  console.log(`Scanned ${result.candidatesScanned} compilation-unit artifacts (${result.freshCount} fresh, ${result.staleCount} stale)`);
  console.log(`Stale bytes: ${result.staleHuman} (${result.staleBytes} bytes)`);
  if (opts.apply) console.log(`Empty directories pruned: ${result.emptyDirsRemoved}`);
  if (result.topEntries.length > 0) {
    console.log("\nLargest stale entries:");
    for (const e of result.topEntries) {
      console.log(`  ${e.sizeHuman.padStart(8)}  ${e.ageDays}d old  ${e.path}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
