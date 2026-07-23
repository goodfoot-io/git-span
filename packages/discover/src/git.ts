/**
 * The single `execFile`-based git subprocess wrapper (design decision 1) —
 * every signal/disqualifier reads history and file content through
 * src/prefilter.ts's RepoContext, which in turn reads only through this
 * module. No git library (gix/isomorphic-git) is used; this is the one
 * seam a test can fake.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChangedFile, Commit, Tag } from './types.js';

const execFile = promisify(execFileCb);

// `git log -p` over full history can produce a large amount of output on a
// real-world repo — fail loudly on truncation rather than silently losing
// commits by leaving Node's default (much smaller) maxBuffer in place.
const MAX_BUFFER = 256 * 1024 * 1024;

// Record/field separators for `git log --format=`. NUL (\x00) can't be used
// here — Node's execFile rejects any argv entry containing a null byte — so
// this uses ASCII RS (\x1e) and US (\x1f), which are just as unlikely to
// collide with real commit message content.
const RECORD_SEP = '\x1e';
const FIELD_SEP = '\x1f';

/**
 * True when a git failure message indicates the target path is not a git
 * repository at all (missing directory, or a directory with no `.git`) —
 * as opposed to a git error inside a real repo (bad rev, permission denied,
 * etc). The CLI uses this to print a short, clean message instead of the raw
 * internal command line (finding 2).
 */
export function isNotAGitRepoError(message: string): boolean {
  return /not a git repository|cannot change to .*: No such file or directory/.test(message);
}

/**
 * True when a git failure message indicates the repo has zero reachable
 * commits (a fresh `git init` with nothing committed yet) — the degenerate
 * case `log()` degrades to an empty array for, per design decision 9, rather
 * than throwing.
 */
function isNoCommitsYetError(message: string): boolean {
  return /does not have any commits yet/.test(message);
}

async function runGit(repoRoot: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFile('git', ['-C', repoRoot, ...args], {
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8'
    });
    return stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${args.join(' ')} failed in ${repoRoot}: ${message}`);
  }
}

const DIFF_HEADER = /^diff --git a\/.* b\/(.*)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function parseDiffFiles(diffText: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | null = null;

  for (const line of diffText.split('\n')) {
    const diffMatch = DIFF_HEADER.exec(line);
    if (diffMatch) {
      current = { path: diffMatch[1], hunks: [] };
      files.push(current);
      continue;
    }
    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch && current) {
      const newStart = Number(hunkMatch[1]);
      // A `@@ -a,b +c,d @@` header omits `,d` when the hunk adds exactly one
      // line — git's own convention, not an edge case we're inventing.
      const newLines = hunkMatch[2] !== undefined ? Number(hunkMatch[2]) : 1;
      // newLines === 0 means a deletion-only hunk at this position: no added
      // or modified lines exist to anchor on, so it contributes no range.
      if (newLines > 0) {
        current.hunks.push({ startLine: newStart, endLine: newStart + newLines - 1 });
      }
    }
  }

  return files;
}

function parseCommitRecord(record: string): Commit {
  const firstSep = record.indexOf(FIELD_SEP);
  const secondSep = record.indexOf(FIELD_SEP, firstSep + 1);
  const thirdSep = record.indexOf(FIELD_SEP, secondSep + 1);
  const fourthSep = record.indexOf(FIELD_SEP, thirdSep + 1);

  const sha = record.slice(0, firstSep);
  const author = record.slice(firstSep + 1, secondSep);
  const date = record.slice(secondSep + 1, thirdSep);
  const message = record.slice(thirdSep + 1, fourthSep).trim();
  const diffText = record.slice(fourthSep + 1);

  return { sha, author, date, message, files: parseDiffFiles(diffText) };
}

/**
 * Full commit history reachable from HEAD, hunk-level. Uses `--unified=0` so
 * each hunk header (`@@ -a,b +c,d @@`) reduces to exactly the added/modified
 * line range rather than a whole-file diff — the time-window signal anchors
 * to that range, not the file (Stage 0 contract decision).
 */
export async function log(repoRoot: string): Promise<Commit[]> {
  const format = `${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%B${FIELD_SEP}`;
  let stdout: string;
  try {
    stdout = await runGit(repoRoot, ['log', '--unified=0', `--format=${format}`, '-p', '--no-color']);
  } catch (err) {
    // A repo with zero reachable commits (a fresh `git init`, nothing
    // committed yet) is a degenerate-but-valid input, not an error (design
    // decision 9) — degrade to an empty history rather than propagating the
    // rejection through every signal's `Promise.all`.
    const message = err instanceof Error ? err.message : String(err);
    if (isNoCommitsYetError(message)) return [];
    throw err;
  }
  // stdout starts with RECORD_SEP (the format string's leading byte), so the
  // first split chunk is always empty — drop it.
  return stdout.split(RECORD_SEP).slice(1).map(parseCommitRecord);
}

/** File paths changed by a single commit (no hunk detail) — the `show --name-only` half of the wrapper's fixed API. */
export async function showNameOnly(repoRoot: string, sha: string): Promise<string[]> {
  const stdout = await runGit(repoRoot, ['show', '--name-only', '--format=', sha]);
  return stdout.split('\n').filter((line) => line.length > 0);
}

/** All tags, oldest-created first, resolved to their commit SHA and date. Empty array on a repo with no tags. */
export async function tags(repoRoot: string): Promise<Tag[]> {
  const format = `%(refname:short)${FIELD_SEP}%(objectname)${FIELD_SEP}%(creatordate:iso-strict)`;
  const stdout = await runGit(repoRoot, ['tag', '--sort=creatordate', `--format=${format}`]);
  return stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, sha, date] = line.split(FIELD_SEP);
      return { name, sha, date };
    });
}

/** Paths that differ between two revisions — used by release-tag-delta to diff consecutive tags. */
export async function diffNameOnly(repoRoot: string, fromRev: string, toRev: string): Promise<string[]> {
  const stdout = await runGit(repoRoot, ['diff', '--name-only', fromRev, toRev]);
  return stdout.split('\n').filter((line) => line.length > 0);
}

/** One `git diff --name-status -M` row: a change to a path, with the pre-rename path when it moved/was copied. */
export interface NameStatusEntry {
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  path: string;
  /** The source path for a rename (`R`) or copy (`C`); undefined otherwise. */
  oldPath?: string;
}

/**
 * Net name-status changes between two revisions with rename/copy detection
 * (`-M`). A multi-step rename chain (`A → B → C`) across `fromRev..toRev`
 * collapses to a single `R` row (`A → C`), which is exactly what
 * rename-tracking needs to carry an anchor forward to HEAD in one hop. Added
 * for Stage 2 (rename-tracking) — the one genuinely missing git primitive; all
 * other reads compose the existing wrappers.
 */
export async function diffNameStatus(repoRoot: string, fromRev: string, toRev: string): Promise<NameStatusEntry[]> {
  const stdout = await runGit(repoRoot, ['diff', '-M', '--name-status', fromRev, toRev]);
  const entries: NameStatusEntry[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    const kind = parts[0].charAt(0) as NameStatusEntry['status'];
    if ((kind === 'R' || kind === 'C') && parts.length >= 3) {
      entries.push({ status: kind, oldPath: parts[1], path: parts[2] });
    } else if (parts.length >= 2) {
      entries.push({ status: kind, path: parts[1] });
    }
  }
  return entries;
}

const MISSING_PATH_PATTERN = /does not exist|exists on disk, but not in/;

/** File content at a given revision, or null if the path did not exist at that revision (deleted, not-yet-created, or renamed away). */
export async function fileContentAt(repoRoot: string, rev: string, path: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['-C', repoRoot, 'show', `${rev}:${path}`], {
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8'
    });
    return stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // git show exits non-zero both for "path does not exist at rev" (an
    // expected, legitimate null result) and for genuine errors (bad rev,
    // permission denied) — only swallow the former.
    if (MISSING_PATH_PATTERN.test(message)) return null;
    throw new Error(`git show ${rev}:${path} failed in ${repoRoot}: ${message}`);
  }
}
