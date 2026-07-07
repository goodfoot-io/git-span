/**
 * Detached background dispatcher for the git-mesh post-commit pipeline.
 *
 * Spawned (detached) by the post-commit and post-rewrite git hooks.  Owns the
 * entire pipeline from pre-commit records through promotion, claiming,
 * detection, agent spawn, and atomic CAS landing.
 *
 * Never writes to stdout/stderr of the hook that spawned it — all logging goes
 * to .mesh/dispatcher.log.  Errors are logged, never thrown to the caller.
 *
 * Usage:
 *   node dispatcher.mjs --repo-root <path>
 *   node dispatcher.mjs --repo-root <path> --post-rewrite
 *   node dispatcher.mjs --repo-root <path> --trigger-worktree <path>
 */

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import {
  type AnchorSpec,
  claimedDir,
  formatAnchor,
  moveRecord,
  type PorcelainRow,
  type PostCommitRecord,
  type PreCommitRecord,
  parsePorcelain,
  postCommitDir,
  preCommitDir,
  queueRoot,
  readJsonFile,
  resolveMeshRoot,
  withQueueLock,
  writeJsonFileAtomic
} from './agent-hooks-common.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_FILE_NAME = 'dispatcher.log';
const CLAIM_PID_SUFFIX = '.pid-';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

/**
 * Resolve the absolute log file path for the dispatcher, under the mesh root
 * directory.
 */
export function getLogFilePath(repoRoot: string): string {
  const meshDir = resolveMeshRoot(repoRoot);
  const absMesh = nodePath.resolve(repoRoot, meshDir);
  return nodePath.join(absMesh, LOG_FILE_NAME);
}

/**
 * Open (or create) the log file for append and return a Logger.
 */
export function createLogger(repoRoot: string): Logger {
  const logPath = getLogFilePath(repoRoot);
  // Ensure the mesh directory exists
  fs.mkdirSync(nodePath.dirname(logPath), { recursive: true });

  const writeLine = (level: string, msg: string): void => {
    const line = `[${new Date().toISOString()}] [${level}] [pid ${process.pid}] ${msg}\n`;
    try {
      fs.appendFileSync(logPath, line, 'utf8');
    } catch {
      void 0;
    }
  };

  return {
    info: (msg: string) => writeLine('INFO', msg),
    warn: (msg: string) => writeLine('WARN', msg),
    error: (msg: string) => writeLine('ERROR', msg)
  };
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/** Parse a PID from a claimed filename like `<uuid>.json.pid-12345`. */
export function parsePidFromClaimed(filename: string): number | null {
  const idx = filename.lastIndexOf(CLAIM_PID_SUFFIX);
  if (idx === -1) return null;
  const pidStr = filename.slice(idx + CLAIM_PID_SUFFIX.length);
  const pid = parseInt(pidStr, 10);
  return Number.isFinite(pid) ? pid : null;
}

/** Strip the `.pid-NNNN` suffix from a claimed filename to get the original name. */
export function stripClaimSuffix(filename: string): string {
  const idx = filename.lastIndexOf(CLAIM_PID_SUFFIX);
  return idx === -1 ? filename : filename.slice(0, idx);
}

/**
 * Get the set of file paths changed in the current HEAD commit.
 * Returns absolute or repo-relative POSIX paths (as output by diff-tree).
 */
export function getChangedPaths(repoRoot: string): Set<string> {
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    const paths = new Set<string>();
    for (const line of out.trim().split('\n')) {
      const trimmed = line.trim();
      if (trimmed) paths.add(trimmed);
    }
    return paths;
  } catch {
    return new Set();
  }
}

/** Get the current HEAD SHA. */
export function getHeadSha(repoRoot: string): string {
  const out = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });
  return out.trim();
}

/**
 * Get the current branch name, or null if HEAD is detached.
 */
export function getCurrentBranch(repoRoot: string): string | null {
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    const branch = out.trim();
    return branch === 'HEAD' ? null : branch;
  } catch {
    return null;
  }
}

/**
 * Parse `git worktree list --porcelain` into a Map<branch, worktree-path>.
 * Only entries with an explicit branch ref are included (detached HEAD entries
 * are skipped).
 */
export function getWorktreeBranches(repoRoot: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    let currentPath = '';
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('worktree ')) {
        currentPath = trimmed.slice('worktree '.length);
      } else if (trimmed.startsWith('branch refs/heads/')) {
        const branch = trimmed.slice('branch refs/heads/'.length);
        map.set(branch, currentPath);
      }
    }
  } catch {
    void 0;
  }
  return map;
}

/**
 * Run a `git show-ref --verify` for a branch.  Returns the tip SHA if the
 * branch exists, null otherwise.
 */
export function refExists(repoRoot: string, branch: string): string | null {
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'show-ref', '--verify', `refs/heads/${branch}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    return out.trim().split(' ')[0] ?? null;
  } catch {
    return null;
  }
}

/** Get the absolute path of the scratch directory for this repo. */
export function scratchDirAbs(repoRoot: string): string {
  const qRoot = queueRoot(repoRoot);
  return nodePath.resolve(repoRoot, qRoot, 'scratch');
}

// ---------------------------------------------------------------------------
// Anchor intersection and clean checks
// ---------------------------------------------------------------------------

/**
 * True when any of the record's anchor paths appears in the changed paths set.
 */
export function anchorsIntersectChangedPaths(anchors: AnchorSpec[], changedPaths: Set<string>): boolean {
  for (const a of anchors) {
    if (changedPaths.has(a.path)) return true;
  }
  return false;
}

/**
 * True when every anchor path is committed and not dirty in HEAD.
 * "Clean" means `git diff --quiet HEAD -- <path>` exits 0.
 */
export function areAnchorsClean(repoRoot: string, anchors: AnchorSpec[]): boolean {
  for (const a of anchors) {
    try {
      execFileSync('git', ['-C', repoRoot, 'diff', '--quiet', 'HEAD', '--', a.path], {
        stdio: ['ignore', 'ignore', 'pipe']
      });
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * True when every anchor path exists at a specific commit SHA.
 * Checks via `git cat-file -e <sha>:<path>`.
 */
export function doAnchorsExistAt(repoRoot: string, sha: string, anchors: AnchorSpec[]): boolean {
  for (const a of anchors) {
    try {
      execFileSync('git', ['-C', repoRoot, 'cat-file', '-e', `${sha}:${a.path}`], {
        stdio: ['ignore', 'ignore', 'pipe']
      });
    } catch {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Reclaim (step 5)
// ---------------------------------------------------------------------------

/**
 * Scan `post-commit/claimed/` for files whose encoded PID is dead.
 * Rename them back to `post-commit/`.  Cross-reference scratch worktrees
 * and force-remove any whose owning claim is gone or dead.
 */
export function reclaim(log: Logger, repoRoot: string): void {
  const cDir = claimedDir(repoRoot);
  let claimFiles: string[];
  try {
    claimFiles = fs.readdirSync(cDir).filter((f) => f.includes(CLAIM_PID_SUFFIX));
  } catch {
    return; // No claimed directory yet
  }

  const deadPids: Array<{ file: string; pid: number }> = [];
  for (const file of claimFiles) {
    const pid = parsePidFromClaimed(file);
    if (pid === null) continue;
    try {
      process.kill(pid, 0);
      // PID is alive — skip
    } catch {
      deadPids.push({ file, pid });
    }
  }

  for (const { file, pid } of deadPids) {
    const srcPath = nodePath.join(cDir, file);
    const originalName = stripClaimSuffix(file);
    const destPath = nodePath.join(postCommitDir(repoRoot), originalName);
    try {
      moveRecord(srcPath, destPath);
      log.info(`reclaim: returned ${file} to post-commit/ (PID ${pid} dead)`);
    } catch (err) {
      log.error(`reclaim: failed to reclaim ${file}: ${err}`);
    }
  }

  // Cross-reference scratch worktrees
  try {
    cleanupOrphanedScratchWorktrees(log, repoRoot, claimFiles);
  } catch (err) {
    log.error(`reclaim: scratch worktree cleanup failed: ${err}`);
  }
}

/**
 * Remove scratch worktrees whose owning claim file is not present (or whose
 * PID is dead).  Also removes the scratch worktree path from the filesystem
 * after git worktree removal.
 */
function cleanupOrphanedScratchWorktrees(log: Logger, repoRoot: string, claimFiles: string[]): void {
  const worktreeOut = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });

  const scrAbs = scratchDirAbs(repoRoot);
  const liveClaimNames = new Set(claimFiles.map((f) => stripClaimSuffix(f)));

  for (const line of worktreeOut.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('worktree ')) continue;
    const wtPath = trimmed.slice('worktree '.length);
    // Only care about worktrees under our scratch directory
    if (!wtPath.startsWith(scrAbs)) continue;

    // The scratch dir basename is the UUID; find any claim with a matching
    // original prefix
    const uuid = nodePath.basename(wtPath);
    const isClaimed = [...liveClaimNames].some((name) => name.startsWith(uuid));
    if (isClaimed) continue;

    // Orphaned — force remove
    try {
      execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', wtPath], {
        stdio: ['ignore', 'ignore', 'pipe']
      });
      log.info(`reclaim: removed orphaned scratch worktree ${uuid}`);
    } catch (err) {
      log.error(`reclaim: failed to remove scratch worktree ${uuid}: ${err}`);
    }
  }

  // Also clean up empty scratch directories
  try {
    rmEmptyScratchDirs(scrAbs);
  } catch {
    void 0;
  }
}

/** Recursively remove empty subdirectories under `dir`. */
function rmEmptyScratchDirs(dir: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const full = nodePath.join(dir, e);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      rmEmptyScratchDirs(full);
    }
  }
  // After removing children, check if now empty
  try {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    void 0;
  }
}

// ---------------------------------------------------------------------------
// Promotion (step 3)
// ---------------------------------------------------------------------------

/**
 * Scan `pre-commit/` for records whose anchors intersect the changed paths.
 * Promote clean records to `post-commit/` with SHA and branch stamp.
 */
export function promote(log: Logger, repoRoot: string, changedPaths: Set<string>, sweepAll: boolean): void {
  const pDir = preCommitDir(repoRoot);
  let files: string[];
  try {
    files = fs.readdirSync(pDir).filter((f) => f.endsWith('.json'));
  } catch {
    return; // No pre-commit directory
  }

  if (files.length === 0) return;

  const sha = getHeadSha(repoRoot);
  const branch = getCurrentBranch(repoRoot);

  for (const file of files) {
    const filePath = nodePath.join(pDir, file);
    let record: PreCommitRecord;
    try {
      record = readJsonFile<PreCommitRecord>(filePath);
    } catch {
      log.warn(`promote: could not parse ${file}, skipping`);
      continue;
    }

    // Check intersection
    if (!sweepAll && !anchorsIntersectChangedPaths(record.anchors, changedPaths)) {
      continue;
    }

    // Check cleanliness
    if (!areAnchorsClean(repoRoot, record.anchors)) {
      continue;
    }

    // Stamp and promote
    const postRecord: PostCommitRecord = {
      anchors: record.anchors,
      created_at: record.created_at,
      sha,
      branch
    };

    const postPath = nodePath.join(postCommitDir(repoRoot), file);
    try {
      writeJsonFileAtomic(postPath, postRecord);
      fs.unlinkSync(filePath);
      log.info(`promote: promoted ${file} (${record.anchors.length} anchors, branch=${branch ?? 'detached'})`);
    } catch (err) {
      log.error(`promote: failed to promote ${file}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Claiming (step 4)
// ---------------------------------------------------------------------------

export interface ClaimedFile {
  /** Absolute path to the claimed record file. */
  path: string;
  /** The claiming process PID. */
  pid: number;
  /** The original filename (UUID.json). */
  originalName: string;
}

/**
 * Under the queue lock, scan `post-commit/*.json` and atomically rename each
 * into `post-commit/claimed/<name>.pid-<pid>`.  Returns the list of newly
 * claimed files.
 */
export function claim(log: Logger, repoRoot: string): ClaimedFile[] {
  const pDir = postCommitDir(repoRoot);
  const cDir = claimedDir(repoRoot);
  fs.mkdirSync(cDir, { recursive: true });

  let files: string[];
  try {
    files = fs.readdirSync(pDir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const claimed: ClaimedFile[] = [];
  for (const file of files) {
    const srcPath = nodePath.join(pDir, file);
    const destName = `${file}${CLAIM_PID_SUFFIX}${process.pid}`;
    const destPath = nodePath.join(cDir, destName);
    try {
      moveRecord(srcPath, destPath);
      claimed.push({ path: destPath, pid: process.pid, originalName: file });
      log.info(`claim: claimed ${file}`);
    } catch (err) {
      log.warn(`claim: could not claim ${file} (concurrent claim): ${err}`);
    }
  }
  return claimed;
}

/**
 * Release a claim by moving it back to post-commit/.
 */
export function releaseClaim(log: Logger, repoRoot: string, claimed: ClaimedFile): void {
  try {
    const destPath = nodePath.join(postCommitDir(repoRoot), claimed.originalName);
    moveRecord(claimed.path, destPath);
    log.info(`release: released ${claimed.originalName} back to post-commit/`);
  } catch (err) {
    log.error(`release: failed to release ${claimed.originalName}: ${err}`);
  }
}

/**
 * Delete a claimed record and remove its file.
 */
export function deleteClaim(log: Logger, claimed: ClaimedFile): void {
  try {
    fs.unlinkSync(claimed.path);
    log.info(`delete: removed claim ${claimed.originalName}`);
  } catch (err) {
    log.warn(`delete: failed to remove claim ${claimed.originalName}: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Post-rewrite demotion (step 6)
// ---------------------------------------------------------------------------

/**
 * Parse post-rewrite stdin lines: `<old-sha> <new-sha> [<ref>]`.
 * Returns a Map<old-sha, new-sha>.
 */
export function parsePostRewriteInput(stdin: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!stdin) return map;
  for (const rawLine of stdin.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [oldSha, newSha] = parts;
    if (oldSha.length >= 7 && newSha.length >= 7) {
      map.set(oldSha, newSha);
    }
  }
  return map;
}

/**
 * Scan `post-commit/` for records whose stamped SHA matches an old value in
 * the rewrite map.  Demote those records back to `pre-commit/` (strip SHA and
 * branch fields).  Never touches `claimed/` records.
 */
export function postRewriteDemote(log: Logger, repoRoot: string, shaMap: Map<string, string>): void {
  if (shaMap.size === 0) return;

  const pDir = postCommitDir(repoRoot);
  let files: string[];
  try {
    files = fs.readdirSync(pDir).filter((f) => f.endsWith('.json'));
  } catch {
    return;
  }

  for (const file of files) {
    const filePath = nodePath.join(pDir, file);
    let record: PostCommitRecord;
    try {
      record = readJsonFile<PostCommitRecord>(filePath);
    } catch {
      continue;
    }

    if (!record.sha || !shaMap.has(record.sha)) continue;

    // Demote: strip sha and branch, write back to pre-commit/
    const preRecord: PreCommitRecord = {
      anchors: record.anchors,
      created_at: record.created_at
    };

    const prePath = nodePath.join(preCommitDir(repoRoot), file);
    try {
      writeJsonFileAtomic(prePath, preRecord);
      fs.unlinkSync(filePath);
      log.info(`demote: demoted ${file} (SHA ${record.sha.slice(0, 8)} was rewritten)`);
    } catch (err) {
      log.error(`demote: failed to demote ${file}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Branch resolution (step 7)
// ---------------------------------------------------------------------------

/**
 * Resolve the best target branch for a claimed record.
 *
 * Returns `{ branch, sha }` on success.  If nothing reachable, returns null
 * (caller should delete the record).
 */
export function resolveBranch(
  log: Logger,
  repoRoot: string,
  record: PostCommitRecord,
  triggerWorktree?: string
): { branch: string; sha: string } | null {
  const stampedSha = record.sha;
  const stampedBranch = record.branch;

  // 1. Stamped branch still exists and tip matches stamped SHA
  if (stampedBranch) {
    const tipSha = refExists(repoRoot, stampedBranch);
    if (tipSha === stampedSha) {
      log.info(`branch-resolve: stamped branch ${stampedBranch} still valid at ${tipSha.slice(0, 8)}`);
      return { branch: stampedBranch, sha: tipSha };
    }
  }

  // 2. git branch --contains <sha>
  let containingBranches: string[] = [];
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'branch', '--contains', stampedSha], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    containingBranches = out
      .trim()
      .split('\n')
      .map((b) => b.replace(/^\*?\s*/, '').trim())
      .filter(Boolean);
  } catch {
    void 0;
  }

  // 3. Exclude branches checked out in other worktrees
  const worktreeMap = getWorktreeBranches(repoRoot);
  const liveBranches = containingBranches.filter((b) => {
    const wt = worktreeMap.get(b);
    return !wt || wt === triggerWorktree;
  });

  if (liveBranches.length > 0) {
    // Prefer trigger worktree's branch > stamped name > most recently committed
    let resolved: string;
    if (liveBranches.length === 1) {
      resolved = liveBranches[0];
    } else {
      const triggerBranch = getBranchForWorktree(worktreeMap, triggerWorktree);
      resolved = pickBestBranch(liveBranches, triggerBranch, stampedBranch ?? undefined, repoRoot);
    }

    const tipSha = refExists(repoRoot, resolved);
    if (tipSha) {
      log.info(`branch-resolve: resolved to ${resolved} at ${tipSha.slice(0, 8)}`);
      return { branch: resolved, sha: tipSha };
    }
  }

  // 4. Path-based re-validation fallback
  //   Check all containing branches (even those checked out elsewhere) to see
  //   if the anchor content exists on any branch tip.
  for (const branch of containingBranches) {
    const tipSha = refExists(repoRoot, branch);
    if (!tipSha) continue;
    if (doAnchorsExistAt(repoRoot, tipSha, record.anchors)) {
      log.info(`branch-resolve: path-based fallback found ${branch} at ${tipSha.slice(0, 8)}`);
      return { branch, sha: tipSha };
    }
  }

  log.warn(`branch-resolve: no reachable branch found for stamped SHA ${stampedSha.slice(0, 8)}`);
  return null;
}

/**
 * Get the branch that is checked out at a given worktree path.
 */
function getBranchForWorktree(worktreeMap: Map<string, string>, worktreePath?: string): string | undefined {
  if (!worktreePath) return undefined;
  for (const [branch, wt] of worktreeMap) {
    if (wt === worktreePath) return branch;
  }
  return undefined;
}

/**
 * Pick the best branch from a list of candidates.
 * Preference: triggerBranch > stampedName > most recently committed.
 */
function pickBestBranch(candidates: string[], triggerBranch?: string, stampedName?: string, repoRoot?: string): string {
  // Trigger's branch
  if (triggerBranch && candidates.includes(triggerBranch)) return triggerBranch;

  // Stamped name
  if (stampedName && candidates.includes(stampedName)) return stampedName;

  // Most recently committed — determine by the commit date of each branch tip
  if (repoRoot && candidates.length > 1) {
    let best = candidates[0];
    let bestTime = 0;
    for (const branch of candidates) {
      try {
        const out = execFileSync('git', ['-C', repoRoot, 'log', '-1', '--format=%ct', `refs/heads/${branch}`], {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        });
        const ts = parseInt(out.trim(), 10);
        if (ts > bestTime) {
          bestTime = ts;
          best = branch;
        }
      } catch {
        void 0;
      }
    }
    return best;
  }

  return candidates[0];
}

// ---------------------------------------------------------------------------
// Scratch worktree creation (step 8)
// ---------------------------------------------------------------------------

/**
 * Create a detached scratch worktree at the resolved commit SHA.
 * Returns the scratch worktree path on success, null on failure.
 */
export function createScratchWorktree(log: Logger, repoRoot: string, sha: string): string | null {
  const uuid = randomUUID();
  const scrAbs = scratchDirAbs(repoRoot);
  const scratchPath = nodePath.join(scrAbs, uuid);

  fs.mkdirSync(scrAbs, { recursive: true });

  try {
    execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '--detach', scratchPath, sha], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000
    });
    log.info(`scratch: created worktree at ${scratchPath} (SHA ${sha.slice(0, 8)})`);
    return scratchPath;
  } catch (err) {
    log.error(`scratch: failed to create worktree at ${scratchPath}: ${err}`);
    return null;
  }
}

/**
 * Remove a scratch worktree and its directory on disk.
 */
export function removeScratchWorktree(log: Logger, repoRoot: string, scratchPath: string): void {
  try {
    execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', scratchPath], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    log.info(`scratch: removed worktree at ${scratchPath}`);
  } catch (err) {
    log.warn(`scratch: git worktree remove failed for ${scratchPath}: ${err}`);
    // Also try to remove the directory directly
    try {
      fs.rmSync(scratchPath, { recursive: true, force: true });
    } catch {
      void 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Detection (step 8 continued)
// ---------------------------------------------------------------------------

export interface DetectionResult {
  /** Raw stdout from `git mesh stale --porcelain --batch`. */
  staleOutput: string;
  /** Raw stdout from `git mesh list --porcelain --batch`. */
  listOutput: string;
  /** Parsed stale rows (non-stale anchors do not appear). */
  staleRows: PorcelainRow[];
  /** Parsed list rows. */
  listRows: PorcelainRow[];
  /** True when there is actionable work (stale drift or uncovered writes). */
  actionable: boolean;
}

/**
 * Run `git mesh stale` and `git mesh list` in the scratch worktree against
 * the record's anchors.  Returns null on parse failure (record should stay
 * pending).
 */
export function runDetection(
  log: Logger,
  _repoRoot: string,
  scratchPath: string,
  anchors: AnchorSpec[]
): DetectionResult | null {
  const filterLines = anchors.map((a) => formatAnchor(a.path, a.kind, a.range)).join('\n');

  let staleOut: string;
  let listOut: string;

  try {
    staleOut = execFileSync('git', ['-C', scratchPath, 'mesh', 'stale', '--porcelain', '--batch'], {
      input: filterLines,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 60_000
    });
  } catch (err) {
    log.error(`detection: git mesh stale failed: ${err}`);
    return null;
  }

  try {
    listOut = execFileSync('git', ['-C', scratchPath, 'mesh', 'list', '--porcelain', '--batch'], {
      input: filterLines,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 60_000
    });
  } catch (err) {
    log.error(`detection: git mesh list failed: ${err}`);
    return null;
  }

  // Parse output — a format change that produces no rows from non-empty
  // output is treated as a parse failure (fail-closed).
  const staleRows = parsePorcelain(staleOut);
  const listRows = parsePorcelain(listOut);

  const staleNonEmptyLines = staleOut.trim().split('\n').filter(Boolean).length;
  const listNonEmptyLines = listOut.trim().split('\n').filter(Boolean).length;

  if (staleNonEmptyLines > 0 && staleRows.length === 0) {
    log.error('detection: stale porcelain format mismatch (non-empty output produced no rows)');
    return null;
  }
  if (listNonEmptyLines > 0 && listRows.length === 0) {
    log.error('detection: list porcelain format mismatch (non-empty output produced no rows)');
    return null;
  }

  // Determine if actionable: stale drift exists, or anchor paths have no
  // existing meshes (uncovered writes).
  const hasStale = staleRows.length > 0;

  // Uncovered writes: check which filter lines are NOT covered by any list
  // row's path (within the scratch worktree).
  const coveredPaths = new Set(listRows.map((r) => r.path));
  const hasUncovered = anchors.some((a) => {
    // The path in listRows is repo-relative, matching the anchor path
    return !coveredPaths.has(a.path);
  });

  const actionable = hasStale || hasUncovered;

  log.info(`detection: stale=${staleRows.length} rows, list=${listRows.length} rows, actionable=${actionable}`);

  return { staleOutput: staleOut, listOutput: listOut, staleRows, listRows, actionable };
}

// ---------------------------------------------------------------------------
// Agent spawn (step 9)
// ---------------------------------------------------------------------------

/**
 * Build the prompt text for the standalone reconciler agent.
 */
export function buildAgentPrompt(scratchPath: string, detectionResult: DetectionResult, anchors: AnchorSpec[]): string {
  const lines: string[] = [
    'You are a standalone mesh reconciler agent. Your job is to reconcile meshes in the scratch worktree.',
    '',
    `The scratch worktree is at: ${scratchPath}`,
    '',
    '## Instructions',
    '',
    'Use the `git-mesh` skill for all git-mesh command mechanics.',
    'All git operations must use the `-C` flag targeting the scratch worktree, e.g. `git -C <scratch-path> mesh stale`.',
    '',
    '## Stale Findings'
  ];

  if (detectionResult.staleRows.length > 0) {
    lines.push('');
    lines.push('The following anchors are stale:');
    for (const row of detectionResult.staleRows) {
      lines.push(`  - ${row.name}: ${row.path}#L${row.start}-L${row.end}`);
    }
  } else {
    lines.push('');
    lines.push('No stale anchors detected.');
  }

  if (detectionResult.listRows.length > 0) {
    lines.push('');
    lines.push('## Related Meshes');
    lines.push('The following meshes are related to the touched anchors:');
    for (const row of detectionResult.listRows) {
      lines.push(`  - ${row.name}: ${row.path}#L${row.start}-L${row.end}`);
    }
  }

  // Check for uncovered writes (anchors not covered by any mesh)
  const coveredPaths = new Set(detectionResult.listRows.map((r) => r.path));
  const uncoveredAnchors = anchors.filter((a) => !coveredPaths.has(a.path));
  if (uncoveredAnchors.length > 0) {
    lines.push('');
    lines.push('## Uncovered Writes');
    lines.push('The following touched paths are not covered by any existing mesh:');
    for (const a of uncoveredAnchors) {
      lines.push(`  - ${a.path}${a.range ? `#L${a.range.start}-L${a.range.end}` : ''}`);
    }
  }

  lines.push('');
  lines.push('## Commit Boundary');
  lines.push('- Never touch source files outside .mesh/.');
  lines.push('- Only commit .mesh/ changes — one commit per session.');
  lines.push('- Only commit once all anchored source files are already committed.');
  lines.push(`- Use: git -C ${scratchPath} add .mesh && git -C ${scratchPath} commit -m "<summary>"`);

  return lines.join('\n');
}

/**
 * Spawn the standalone `claude -p` agent, wait for it to complete, and return
 * its exit code (null if spawn failed).
 */
export async function spawnAgent(
  log: Logger,
  repoRoot: string,
  scratchPath: string,
  meshDir: string,
  detectionResult: DetectionResult,
  anchors: AnchorSpec[]
): Promise<number | null> {
  const sessionId = randomUUID();
  const promptText = buildAgentPrompt(scratchPath, detectionResult, anchors);

  // Resolve the absolute mesh directory for Edit/Write scoping
  const meshDirAbs = nodePath.resolve(repoRoot, meshDir);

  const settings = {
    allowedTools: [
      'Bash(git mesh *)',
      `Bash(git -C ${scratchPath} add .mesh/**)`,
      `Bash(git -C ${scratchPath} commit *)`,
      `Bash(git -C ${scratchPath} status)`,
      `Bash(git -C ${scratchPath} diff)`,
      `Bash(git -C ${scratchPath} log)`
    ],
    deniedTools: [
      'EnterPlanMode',
      'ExitPlanMode',
      'DesignSync',
      'NotebookEdit',
      'SendMessage',
      'PushNotification',
      'RemoteTrigger',
      'ReportFindings',
      'ScheduleWakeup',
      'AskUserQuestion',
      'CronCreate',
      'CronDelete',
      'CronList'
    ],
    disableBundledSkills: true,
    disableWorkflows: true,
    disableRemoteControl: true,
    disableClaudeAiConnectors: true,
    disableArtifact: true,
    editFileScope: `${meshDirAbs}/**`,
    writeFileScope: `${meshDirAbs}/**`
  };

  const claudeArgs = ['-p', promptText, '--resume', sessionId, '--settings', JSON.stringify(settings)];

  log.info(`spawn: launching agent (session ${sessionId})`);

  try {
    const child = spawn('claude', claudeArgs, {
      cwd: repoRoot,
      stdio: 'ignore',
      detached: true
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code));
      child.on('error', (err) => {
        log.error(`spawn: agent process error: ${err}`);
        resolve(null);
      });
    });

    if (exitCode === null) {
      log.error('spawn: agent failed to start');
    } else {
      log.info(`spawn: agent exited with code ${exitCode}`);
    }

    return exitCode;
  } catch (err) {
    log.error(`spawn: unexpected error spawning agent: ${err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// CAS landing (step 10)
// ---------------------------------------------------------------------------

/**
 * Land the agent's commit onto the resolved branch via compare-and-swap.
 * Returns true on success, false if the record should be retried or deleted.
 *
 * Bound to MAX_CAS_ATTEMPTS attempts.
 */
const MAX_CAS_ATTEMPTS = 3;

export function landCommit(
  log: Logger,
  repoRoot: string,
  scratchPath: string,
  targetBranch: string,
  expectedOldTip: string,
  _claimed: ClaimedFile
): boolean {
  let oldTip = expectedOldTip;

  for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt++) {
    // Read agent's commit SHA from scratch worktree
    let agentSha: string;
    try {
      agentSha = execFileSync('git', ['-C', scratchPath, 'rev-parse', 'HEAD'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8'
      }).trim();
    } catch (err) {
      log.error(`land: could not read agent HEAD from scratch worktree: ${err}`);
      return false;
    }

    log.info(
      `land: attempt ${attempt}/${MAX_CAS_ATTEMPTS} — update-ref ${targetBranch} ` +
        `${agentSha.slice(0, 8)} (expected old tip ${oldTip.slice(0, 8)})`
    );

    try {
      execFileSync('git', ['-C', repoRoot, 'update-ref', `refs/heads/${targetBranch}`, agentSha, oldTip], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      log.info(`land: CAS succeeded on attempt ${attempt}`);
      return true;
    } catch {
      // CAS failed — branch moved underneath us
      log.warn(`land: CAS failed on attempt ${attempt}, re-resolving branch`);
    }

    // Re-resolve branch to find if there's a new tip
    const resolved = resolveBranch(log, repoRoot, { anchors: [], sha: oldTip, branch: targetBranch, created_at: '' });
    if (!resolved) {
      log.error('land: branch no longer reachable after CAS failure — discarding');
      return false;
    }

    if (resolved.sha === oldTip) {
      // Branch hasn't moved — update-ref should have worked.  Something else
      // is wrong (e.g. permission).  Give up.
      log.error('land: CAS failed but branch tip unchanged — giving up');
      return false;
    }

    // Rebase the agent's single .mesh commit onto the new tip
    try {
      execFileSync('git', ['-C', scratchPath, 'rebase', '--onto', resolved.sha, oldTip], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000
      });
      log.info(`land: rebased onto new tip ${resolved.sha.slice(0, 8)}`);
    } catch (err) {
      log.error(`land: rebase onto new tip failed: ${err}`);
      return false;
    }

    oldTip = resolved.sha;
    // Retry CAS with the rebased commit
  }

  log.error(`land: exhausted ${MAX_CAS_ATTEMPTS} attempts`);
  return false;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Process a single claimed record: resolve branch, create scratch worktree,
 * run detection, spawn agent, and land the result.
 */
export async function processClaimedRecord(
  log: Logger,
  repoRoot: string,
  triggerWorktree: string | undefined,
  claimed: ClaimedFile
): Promise<void> {
  // Read the claimed record
  let record: PostCommitRecord;
  try {
    record = readJsonFile<PostCommitRecord>(claimed.path);
  } catch (err) {
    log.error(`process: could not read claimed record ${claimed.originalName}: ${err}`);
    deleteClaim(log, claimed);
    return;
  }

  // Step 7: Resolve branch
  const resolved = resolveBranch(log, repoRoot, record, triggerWorktree);
  if (!resolved) {
    log.warn(`process: cannot resolve branch for ${claimed.originalName}, deleting`);
    deleteClaim(log, claimed);
    return;
  }

  // Step 8: Create scratch worktree
  const scratchPath = createScratchWorktree(log, repoRoot, resolved.sha);
  if (!scratchPath) {
    log.warn(`process: could not create scratch worktree for ${claimed.originalName}, releasing`);
    releaseClaim(log, repoRoot, claimed);
    return;
  }

  const cleanupScratch = () => removeScratchWorktree(log, repoRoot, scratchPath);

  try {
    // Step 8 continued: Detection
    const detectionResult = runDetection(log, repoRoot, scratchPath, record.anchors);
    if (!detectionResult) {
      // Parse failure — leave pending for retry
      log.warn(`process: detection parse failure for ${claimed.originalName}, releasing`);
      releaseClaim(log, repoRoot, claimed);
      cleanupScratch();
      return;
    }

    if (!detectionResult.actionable) {
      log.info(`process: nothing actionable for ${claimed.originalName}, deleting`);
      deleteClaim(log, claimed);
      cleanupScratch();
      return;
    }

    // Step 9: Spawn agent
    const meshDir = resolveMeshRoot(repoRoot);
    const exitCode = await spawnAgent(log, repoRoot, scratchPath, meshDir, detectionResult, record.anchors);

    if (exitCode === null || exitCode !== 0) {
      log.warn(`process: agent exited with code ${exitCode}, releasing claim for retry`);
      releaseClaim(log, repoRoot, claimed);
      cleanupScratch();
      return;
    }

    // Step 10: CAS landing
    const landed = landCommit(log, repoRoot, scratchPath, resolved.branch, resolved.sha, claimed);
    if (landed) {
      deleteClaim(log, claimed);
      log.info(`process: successfully landed ${claimed.originalName} on ${resolved.branch}`);
    } else {
      log.warn(`process: CAS landing failed for ${claimed.originalName}, releasing`);
      releaseClaim(log, repoRoot, claimed);
    }
  } finally {
    cleanupScratch();
  }
}

/**
 * Sweep counter file path (under queue root).  Used to throttle full-backlog
 * promotion sweeps.
 */
function sweepCounterPath(repoRoot: string): string {
  return nodePath.join(queueRoot(repoRoot), '.sweep-counter');
}

const SWEEP_EVERY_N = 10;

/**
 * Read, increment, and return the sweep counter.  Returns true when the
 * caller should perform a full backlog sweep.
 */
function shouldSweepAll(repoRoot: string): boolean {
  const counterPath = sweepCounterPath(repoRoot);
  let count = 0;
  try {
    const raw = fs.readFileSync(counterPath, 'utf8').trim();
    count = parseInt(raw, 10) || 0;
  } catch {
    void 0;
  }
  const next = count + 1;
  try {
    writeJsonFileAtomic(counterPath, next);
  } catch {
    void 0;
  }
  return next % SWEEP_EVERY_N === 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface DispatcherArgs {
  repoRoot: string;
  postRewrite: boolean;
  triggerWorktree?: string;
}

/**
 * Parse command-line arguments.  No external CLI library — just manual
 * flag scanning.
 */
export function parseArgs(argv: string[]): DispatcherArgs | null {
  let repoRoot: string | undefined;
  let postRewrite = false;
  let triggerWorktree: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo-root' && i + 1 < argv.length) {
      repoRoot = argv[++i];
    } else if (arg === '--post-rewrite') {
      postRewrite = true;
    } else if (arg === '--trigger-worktree' && i + 1 < argv.length) {
      triggerWorktree = argv[++i];
    }
  }

  if (!repoRoot) return null;
  return { repoRoot, postRewrite, triggerWorktree };
}

/**
 * Determine the main/root worktree path for the repository.  The agent's cwd
 * is always set to this path (never a linked worktree that could be removed).
 */
export function getMainWorktreePath(repoRoot: string): string {
  // Use git worktree list --porcelain and return the first non-bare entry
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('worktree ') && !trimmed.includes('bare')) {
        return trimmed.slice('worktree '.length);
      }
    }
  } catch {
    void 0;
  }
  // Fallback: repoRoot itself
  return repoRoot;
}

/**
 * Main entry point for the dispatcher.
 *
 * 1. Parse args and open log
 * 2. (post-rewrite only) Demote matching records
 * 3. Under queue lock: reclaim, promote, claim
 * 4. For each claimed record: process (resolve → detect → spawn → land)
 */
export async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (!args) {
    // Cannot log — no repo root
    process.exit(1);
  }

  const log = createLogger(args.repoRoot);
  log.info('dispatcher: started');
  log.info(`dispatcher: args repoRoot=${args.repoRoot} postRewrite=${args.postRewrite}`);

  const mainWorktree = getMainWorktreePath(args.repoRoot);

  try {
    // -----------------------------------------------------------------------
    // Post-rewrite path (step 6)
    // -----------------------------------------------------------------------
    if (args.postRewrite) {
      let stdinData = '';
      try {
        // fs.readFileSync with fd 0 reads stdin (synchronous)
        stdinData = fs.readFileSync('/dev/stdin', 'utf8');
      } catch {
        // stdin is a TTY or not available — no-op
        log.info('dispatcher: --post-rewrite but stdin unavailable, skipping');
        return;
      }

      const shaMap = parsePostRewriteInput(stdinData);
      if (shaMap.size > 0) {
        log.info(`dispatcher: post-rewrite mapping has ${shaMap.size} entries`);
        withQueueLock(args.repoRoot, () => {
          postRewriteDemote(log, args.repoRoot, shaMap);
        });
      } else {
        log.info('dispatcher: post-rewrite but no valid SHA mapping in stdin');
      }

      log.info('dispatcher: post-rewrite complete');
      return;
    }

    // -----------------------------------------------------------------------
    // Normal pipeline
    // -----------------------------------------------------------------------

    // Determine changed paths in this commit
    const changedPaths = getChangedPaths(args.repoRoot);
    log.info(`dispatcher: commit changed ${changedPaths.size} paths`);

    const sweepAll = shouldSweepAll(args.repoRoot);
    if (sweepAll) log.info('dispatcher: performing full backlog sweep');

    // Step 3+4: Queue operations under lock
    const claimedRecords = withQueueLock(args.repoRoot, () => {
      // Step 5 (reclaim runs before promote)
      reclaim(log, args.repoRoot);
      // Step 3 (promote)
      promote(log, args.repoRoot, changedPaths, sweepAll);
      // Step 4 (claim)
      return claim(log, args.repoRoot);
    });

    log.info(`dispatcher: claimed ${claimedRecords.length} records`);

    // Process each claimed record sequentially
    for (const claimed of claimedRecords) {
      await processClaimedRecord(log, args.repoRoot, args.triggerWorktree ?? mainWorktree, claimed);
    }

    log.info('dispatcher: finished');
  } catch (err) {
    log.error(`dispatcher: unhandled error: ${err}`);
  }
}
