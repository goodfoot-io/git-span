/**
 * Detached background dispatcher for the git-mesh post-commit pipeline.
 *
 * Spawned (detached) by the post-commit and post-rewrite git hooks. Owns
 * promotion of pre-commit records to post-commit once their anchors are
 * clean, reclaiming claim directories abandoned by a dispatcher that died
 * before it could sweep them, and spawning a single self-claiming,
 * self-landing reconciler agent per invocation. The agent claims records
 * from post-commit/ itself (into its own claimed/<claim-id>/ directory),
 * enters its own worktree, reconciles each record it claimed, and lands its
 * work via rebase + fast-forward merge -- the dispatcher never touches
 * branches or worktrees directly. For a record with multiple independent
 * findings, the agent may fan work out to fork subagents (one per
 * file-connected component, sharing its worktree) before committing and
 * landing the record itself.
 *
 * If .mesh/.manual-run is present, automatic spawning is suspended: the
 * dispatcher still reserves a real claim directory but writes the exact
 * agent invocation to .mesh/manual-hook-dispatch-<datetime>.sh instead of
 * launching it, leaving the claim directory in place for a human to run the
 * script later. The marker is not consumed -- remove it to resume automatic
 * dispatch.
 *
 * Never writes to stdout/stderr of the hook that spawned it -- all logging
 * goes to .mesh/dispatcher.log. Errors are logged, never thrown to the
 * caller.
 *
 * Usage:
 *   node dispatcher.mjs --repo-root <path>
 *   node dispatcher.mjs --repo-root <path> --post-rewrite
 *   node dispatcher.mjs --repo-root <path> --commit-sha <sha>
 */

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import {
  type AnchorSpec,
  claimDirFor,
  claimedDir,
  moveRecord,
  type PostCommitRecord,
  type PreCommitRecord,
  postCommitDir,
  preCommitDir,
  queueRoot,
  readJsonFile,
  resolveMeshRoot,
  withQueueLock,
  writeJsonFileAtomic
} from './agent-hooks-common.js';
import PROMPT_TEMPLATE from './agent-prompt.md';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_FILE_NAME = 'dispatcher.log';

/**
 * Read all of stdin as a string with a timeout. If stdin is a TTY, empty
 * pipe, or the timeout fires, returns `''` so the caller can distinguish
 * "nothing was sent" from an error.
 */
function readStdinWithTimeout(log: Logger, timeoutMs: number): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('');

  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      if (timer) clearTimeout(timer);
    };

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
    };

    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };

    const onError = () => {
      cleanup();
      resolve(''); // Treat errors as EOF
    };

    timer = setTimeout(() => {
      log.warn('dispatcher: stdin read timed out, continuing with empty data');
      cleanup();
      resolve('');
    }, timeoutMs);

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    process.stdin.resume();
  });
}

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

/**
 * Get the set of file paths changed in the given commit (or HEAD if not
 * specified). Includes --root to handle the initial commit.
 * Uses --name-status with rename detection so that for renamed files **_both_**
 * the old and new paths are included in the returned set -- a mesh anchored to
 * the old (pre-rename) path is not silently dropped from the pipeline.
 */
export function getChangedPaths(repoRoot: string, commitSha?: string): Set<string> {
  const rev = commitSha ?? 'HEAD';
  try {
    const out = execFileSync(
      'git',
      ['-C', repoRoot, 'diff-tree', '--no-commit-id', '--name-status', '-r', '--root', '-M', rev],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8'
      }
    );
    const paths = new Set<string>();
    for (const line of out.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // --name-status format: <status>\t<path>  or  R<score>\t<old-path>\t<new-path>
      const parts = trimmed.split('\t');
      if (parts.length < 2) continue;
      const status = parts[0];
      if (!status) continue;
      if (status.startsWith('R')) {
        // Rename: include both old and new names
        if (parts[1]) paths.add(parts[1]);
        if (parts[2]) paths.add(parts[2]);
      } else if (parts[1]) {
        paths.add(parts[1]);
      }
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

// ---------------------------------------------------------------------------
// Reclaim: recover claim directories abandoned by a dead dispatcher
// ---------------------------------------------------------------------------

/**
 * A claim directory older than this is considered abandoned -- its owning
 * dispatcher process died before it could sweep the directory itself.
 * Comfortably above AGENT_TIMEOUT_MS (15 min) + SIGTERM_GRACE_MS (10 s), so a
 * still-running agent's claim directory is never mistaken for abandoned.
 */
const CLAIM_STALE_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Scan `post-commit/claimed/*` for claim directories whose mtime indicates
 * they were abandoned (no live dispatcher is going to sweep them). Move every
 * record inside back to `post-commit/` and remove the directory.
 *
 * This only covers a dispatcher process that died before reaching its own
 * `sweepClaimDir` call (e.g. killed, crashed, OOM). A dispatcher that runs to
 * completion always sweeps its own claim directory in `main()` -- this
 * function exists purely to recover from the case where that never happened.
 */
export function reclaim(log: Logger, repoRoot: string): void {
  const cDir = claimedDir(repoRoot);
  let entries: string[];
  try {
    entries = fs.readdirSync(cDir);
  } catch {
    return; // No claimed directory yet
  }

  for (const entry of entries) {
    const dirPath = nodePath.join(cDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(dirPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (Date.now() - stat.mtimeMs <= CLAIM_STALE_MS) continue;

    // Abandoned claim directory -- return its records to post-commit/.
    let files: string[];
    try {
      files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
    } catch (err) {
      log.error(`reclaim: could not read claim directory ${entry}: ${err}`);
      continue;
    }

    let recovered = 0;
    for (const file of files) {
      const srcPath = nodePath.join(dirPath, file);
      const destPath = nodePath.join(postCommitDir(repoRoot), file);
      try {
        moveRecord(srcPath, destPath);
        recovered++;
      } catch (err) {
        log.error(`reclaim: failed to move ${entry}/${file} back to post-commit/: ${err}`);
      }
    }

    try {
      const remaining = fs.readdirSync(dirPath);
      if (remaining.length > 0) {
        log.warn(
          `reclaim: claim directory ${entry} still has ${remaining.length} entries after sweep, removing anyway`
        );
      }
      fs.rmSync(dirPath, { recursive: true, force: true });
      log.info(`reclaim: reclaimed ${recovered} record(s) from abandoned claim directory ${entry}`);
    } catch (err) {
      log.error(`reclaim: failed to remove claim directory ${entry}: ${err}`);
    }
  }
}

/**
 * Sweep a claim directory after its agent has exited (success, failure, or
 * timeout -- called unconditionally). Anything still present was not fully
 * resolved by the agent; move it back to `post-commit/` for a future
 * dispatcher run to retry, then remove the now-empty directory.
 */
export function sweepClaimDir(log: Logger, repoRoot: string, claimId: string): void {
  const dirPath = claimDirFor(repoRoot, claimId);
  let files: string[];
  try {
    files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
  } catch {
    return; // Nothing to sweep (directory never created, or already gone)
  }

  for (const file of files) {
    const srcPath = nodePath.join(dirPath, file);
    const destPath = nodePath.join(postCommitDir(repoRoot), file);
    try {
      moveRecord(srcPath, destPath);
      log.warn(`sweep: returned unresolved record ${file} from claim ${claimId} to post-commit/`);
    } catch (err) {
      log.error(`sweep: failed to move ${claimId}/${file} back to post-commit/: ${err}`);
    }
  }

  if (files.length === 0) {
    log.info(`sweep: claim ${claimId} clean, nothing to return`);
  }

  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (err) {
    log.error(`sweep: failed to remove claim directory ${claimId}: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

/**
 * Scan `pre-commit/` for records whose anchors intersect the changed paths.
 * Promote clean records to `post-commit/` with SHA and branch stamp.
 * When `commitSha` is provided it is used instead of reading HEAD (avoids a
 * race where another commit lands before the background process runs).
 *
 * Skips promotion entirely when HEAD is detached: a record stamped with no
 * branch can never be landed by the reconciler, and detached-HEAD commits are
 * routinely the reconciler's own worktree commits triggering this hook.
 * Unpromoted records stay in `pre-commit/` until an on-branch commit (or a
 * periodic full sweep) promotes them with a real branch.
 */
export function promote(
  log: Logger,
  repoRoot: string,
  changedPaths: Set<string>,
  sweepAll: boolean,
  commitSha?: string
): void {
  const pDir = preCommitDir(repoRoot);
  let files: string[];
  try {
    files = fs.readdirSync(pDir).filter((f) => f.endsWith('.json'));
  } catch {
    return; // No pre-commit directory
  }

  if (files.length === 0) return;

  const sha = commitSha ?? getHeadSha(repoRoot);
  const branch = getCurrentBranch(repoRoot);
  if (branch === null) {
    log.info(`promote: HEAD is detached, skipping promotion of ${files.length} record(s)`);
    return;
  }

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
      fs.mkdirSync(postCommitDir(repoRoot), { recursive: true });
      writeJsonFileAtomic(postPath, postRecord);
      fs.unlinkSync(filePath);
      log.info(`promote: promoted ${file} (${record.anchors.length} anchors, branch=${branch})`);
    } catch (err) {
      log.error(`promote: failed to promote ${file}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Post-rewrite demotion
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
 * the rewrite map. Demote those records back to `pre-commit/` (strip SHA and
 * branch fields). Never touches `claimed/` records.
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
      fs.mkdirSync(preCommitDir(repoRoot), { recursive: true });
      writeJsonFileAtomic(prePath, preRecord);
      fs.unlinkSync(filePath);
      log.info(`demote: demoted ${file} (SHA ${record.sha.slice(0, 8)} was rewritten)`);
    } catch (err) {
      log.error(`demote: failed to demote ${file}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Agent prompt
// ---------------------------------------------------------------------------

/**
 * Build the prompt text for the standalone reconciler agent. The agent
 * claims its own work from `postCommitDir`, self-lands via rebase + FF
 * merge, and manages its own worktree -- so the prompt only needs to tell it
 * where things are, not what is stale (the agent runs its own detection per
 * record it claims).
 */
export function buildAgentPrompt(
  repoRoot: string,
  meshDir: string,
  postCommitDirAbs: string,
  claimDirAbs: string
): string {
  let prompt = PROMPT_TEMPLATE;
  prompt = prompt.replace(/\{\{repoRoot\}\}/g, repoRoot);
  prompt = prompt.replace(/\{\{meshDir\}\}/g, meshDir);
  prompt = prompt.replace(/\{\{postCommitDir\}\}/g, postCommitDirAbs);
  prompt = prompt.replace(/\{\{claimDir\}\}/g, claimDirAbs);
  return prompt.trimEnd();
}

// ---------------------------------------------------------------------------
// Agent spawn
// ---------------------------------------------------------------------------

const AGENT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes default
const SIGTERM_GRACE_MS = 10_000; // 10 seconds between SIGTERM and SIGKILL

/**
 * Build the exact `claude` CLI arguments used to launch the standalone
 * reconciler agent for a given claim. Shared by `spawnAgent` (which runs
 * this for real) and `writeManualDispatchScript` (which dumps it to a shell
 * script instead) so the two can never drift apart.
 */
export function buildClaudeArgs(repoRoot: string, meshDir: string, claimId: string, headless = true): string[] {
  const postCommitDirAbs = postCommitDir(repoRoot);
  const claimDirAbs = claimDirFor(repoRoot, claimId);
  const promptText = buildAgentPrompt(repoRoot, meshDir, postCommitDirAbs, claimDirAbs);

  // No allow list: every tool is permitted except what's explicitly denied
  // below. The prompt itself is what constrains the agent to git-mesh
  // mechanics, worktree/fork orchestration, and its own claim directory.
  const settings = {
    permissions: {
      deny: [
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
      ]
    },
    disableBundledSkills: true,
    disableWorkflows: true,
    disableRemoteControl: true,
    disableClaudeAiConnectors: true,
    disableArtifact: true
  };

  const args = [promptText, '--model', 'sonnet', '--effort', 'low', '--settings', JSON.stringify(settings)];

  // In headless mode (automatic dispatch), prepend -p so claude runs in
  // print/headless mode with no visible turn-by-turn output. In foreground
  // mode (manual dispatch), omit -p so the prompt becomes the opening
  // interactive turn and the developer watches the agent work.
  if (headless) {
    args.unshift('-p');
  }

  return args;
}

/**
 * Spawn the standalone `claude -p` reconciler agent, wait for it to complete,
 * and return its exit code (null if spawn failed).
 *
 * The agent is self-claiming and self-landing: it claims records from
 * `post-commit/` into `claimDirFor(repoRoot, claimId)` itself, enters its own
 * worktree via the EnterWorktree tool, reconciles each record it claimed, and
 * lands its work via rebase + fast-forward merge. Every invocation starts a
 * fresh session -- `claimId` only names the claim directory (created by the
 * caller before this is invoked), it is never passed to `claude`.
 *
 * If the agent does not complete within `timeoutMs`, SIGTERM is sent followed
 * by SIGKILL after `SIGTERM_GRACE_MS`.
 */
export async function spawnAgent(
  log: Logger,
  repoRoot: string,
  meshDir: string,
  claimId: string,
  timeoutMs: number = AGENT_TIMEOUT_MS
): Promise<number | null> {
  const claudeArgs = buildClaudeArgs(repoRoot, meshDir, claimId);

  log.info(`spawn: launching agent (claim ${claimId})`);

  // Pipe agent stdout/stderr to .mesh/agent-<claimId>.log so the user can
  // inspect what the reconciler did (or why it failed).
  const agentLogPath = nodePath.resolve(repoRoot, meshDir, `agent-${claimId}.log`);
  let agentLogFd: number;
  try {
    fs.mkdirSync(nodePath.dirname(agentLogPath), { recursive: true });
    agentLogFd = fs.openSync(agentLogPath, 'a');
  } catch (err) {
    log.warn(`spawn: could not open agent log ${agentLogPath}: ${err}`);
    agentLogFd = -1;
  }

  try {
    const child = spawn('claude', claudeArgs, {
      cwd: repoRoot,
      stdio: ['ignore', agentLogFd > 0 ? agentLogFd : 'ignore', agentLogFd > 0 ? agentLogFd : 'ignore'],
      detached: true
    });

    // Timeout: SIGTERM then SIGKILL after grace period
    const timeoutHandle = setTimeout(() => {
      log.warn(`spawn: agent timed out after ${timeoutMs}ms, sending SIGTERM`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) {
          log.warn('spawn: agent did not exit after SIGTERM, sending SIGKILL');
          child.kill('SIGKILL');
        }
      }, SIGTERM_GRACE_MS).unref();
    }, timeoutMs);
    timeoutHandle.unref();

    const exitCode = await new Promise<number | null>((resolve) => {
      const cleanup = () => {
        if (agentLogFd > 0) {
          try {
            fs.closeSync(agentLogFd);
          } catch (_) {
            void _;
          }
        }
      };
      child.on('exit', (code) => {
        clearTimeout(timeoutHandle);
        cleanup();
        resolve(code);
      });
      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        cleanup();
        log.error(`spawn: agent process error: ${err}`);
        resolve(null);
      });
    });

    if (exitCode === null) {
      log.error('spawn: agent failed to start');
    } else {
      log.info(`spawn: agent exited with code ${exitCode} (log: ${agentLogPath})`);
    }

    return exitCode;
  } catch (err) {
    log.error(`spawn: unexpected error spawning agent: ${err}`);
    if (agentLogFd > 0) {
      try {
        fs.closeSync(agentLogFd);
      } catch (_) {
        void _;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Manual dispatch
// ---------------------------------------------------------------------------

const MANUAL_RUN_MARKER_NAME = '.manual-run';

/**
 * Path to the manual-run marker file. Its presence suspends automatic
 * spawning: instead of launching the reconciler agent, the dispatcher writes
 * a runnable shell script and leaves the claim directory in place for a
 * human to invoke later. The marker is NOT consumed -- it stays in effect
 * for every subsequent invocation until a human removes it.
 */
export function manualRunMarkerPath(repoRoot: string, meshDir: string): string {
  return nodePath.join(nodePath.resolve(repoRoot, meshDir), MANUAL_RUN_MARKER_NAME);
}

/**
 * Single-quote a string for safe embedding in a POSIX `sh` command line:
 * wraps in `'...'`, escaping any embedded `'` as `'\''`.
 */
function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * In place of spawning the reconciler agent, write the exact `claude`
 * invocation that would have been run to a standalone, executable shell
 * script under the mesh directory. The claim directory has already been
 * created by the caller and is left untouched (not swept) -- running the
 * generated script later launches the agent against that same claim,
 * picking up exactly where the dispatcher left off.
 *
 * Returns the absolute path of the script written.
 */
export function writeManualDispatchScript(
  log: Logger,
  repoRoot: string,
  meshDir: string,
  claimId: string,
  now: Date
): string {
  // Build args for foreground (interactive) mode -- no -p flag, so the
  // reconciler prompt becomes the opening interactive turn and the developer
  // watches the agent work turn by turn instead of a silent batch run.
  const claudeArgs = buildClaudeArgs(repoRoot, meshDir, claimId, false);
  const meshDirAbs = nodePath.resolve(repoRoot, meshDir);
  const claimDirAbs = claimDirFor(repoRoot, claimId);
  const postCommitDirAbs = postCommitDir(repoRoot);

  const datetimeStamp = now.toISOString().replace(/[:.]/g, '-');
  const scriptPath = nodePath.join(meshDirAbs, `manual-hook-dispatch-${datetimeStamp}.sh`);

  const quotedCommand = ['claude', ...claudeArgs].map(shellQuoteSingle).join(' \\\n  ');
  const quotedPostCommitDir = shellQuoteSingle(postCommitDirAbs);
  const script = [
    '#!/bin/sh',
    `# git-mesh manual dispatch script -- generated ${now.toISOString()}`,
    '#',
    `# Claim directory: ${claimDirAbs}`,
    '#',
    '# The claim directory above was already reserved for this run and is left',
    '# in place until this script is executed -- running it launches the same',
    '# self-claiming, self-landing reconciler agent the dispatcher would have',
    '# spawned automatically. If left unrun for too long, a future dispatcher',
    '# invocation may reclaim the (still-empty) claim directory as abandoned.',
    '',
    "# Resolve the repo root from this script's own location on disk (it",
    '# lives under the mesh directory, which is always inside the repo)',
    '# rather than hardcoding the path this script happened to be generated',
    '# for -- the script stays runnable even if the repo is moved, cloned',
    '# elsewhere, or renamed.',
    'script_dir=$(cd "$(dirname "$0")" && pwd -P) || exit 1',
    'repo_root=$(cd "$script_dir" && git rev-parse --show-toplevel) || exit 1',
    'cd "$repo_root" || exit 1',
    '',
    '# ------------------------------------------------------------------',
    '# Scan the post-commit queue for live numbers at run time',
    '# ------------------------------------------------------------------',
    `post_commit_dir=${quotedPostCommitDir}`,
    'if ls "$post_commit_dir"/*.json >/dev/null 2>&1; then',
    `  pending_count=$(jq -s 'length' "$post_commit_dir"/*.json 2>/dev/null)`,
    `  branch_count=$(jq -r '.branch' "$post_commit_dir"/*.json 2>/dev/null | sort -u | wc -l)`,
    'else',
    '  pending_count=0',
    '  branch_count=0',
    'fi',
    '',
    '# ------------------------------------------------------------------',
    '# Pre-flight confirmation',
    '# ------------------------------------------------------------------',
    'echo "git-mesh reconciler is about to process $pending_count pending post-commit record(s) across $branch_count branch(es)."',
    'echo ""',
    'echo "The reconciler will:"',
    'echo "  - Check existing mesh coverage for drift"',
    'echo "  - Add, update, or remove coverage as needed"',
    'echo "  - Write a short rationale for any new coverage"',
    'echo "  - Commit and land the result on each branch"',
    'echo ""',
    'printf "Proceed? [y/N] "',
    'read -r reply',
    'case "$reply" in',
    '  [yY]|[yY][eE][sS])',
    '    ;;',
    '  *)',
    '    echo "Aborted. The claim is still reserved for a later attempt."',
    '    exit 1',
    '    ;;',
    'esac',
    '',
    'echo "Launching reconciler..."',
    `exec ${quotedCommand}`,
    ''
  ].join('\n');

  fs.mkdirSync(meshDirAbs, { recursive: true });
  fs.writeFileSync(scriptPath, script, 'utf8');
  fs.chmodSync(scriptPath, 0o755);
  log.info(`manual-run: wrote ${scriptPath} instead of spawning (claim ${claimId})`);
  return scriptPath;
}

// ---------------------------------------------------------------------------
// Sweep counter (throttles full-backlog promotion sweeps)
// ---------------------------------------------------------------------------

function sweepCounterPath(repoRoot: string): string {
  return nodePath.join(queueRoot(repoRoot), '.sweep-counter');
}

const SWEEP_EVERY_N = 10;

/**
 * Read, increment, and return the sweep counter. Returns true when the
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
  commitSha?: string;
}

/**
 * Parse command-line arguments. No external CLI library -- just manual
 * flag scanning.
 */
export function parseArgs(argv: string[]): DispatcherArgs | null {
  let repoRoot: string | undefined;
  let postRewrite = false;
  let commitSha: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo-root' && i + 1 < argv.length) {
      repoRoot = argv[++i];
    } else if (arg === '--post-rewrite') {
      postRewrite = true;
    } else if (arg === '--commit-sha' && i + 1 < argv.length) {
      commitSha = argv[++i];
    }
  }

  if (!repoRoot) return null;
  return { repoRoot, postRewrite, commitSha };
}

/**
 * Main entry point for the dispatcher.
 *
 * 1. Parse args and open log
 * 2. (post-rewrite only) Demote matching records
 * 3. Under queue lock: reclaim abandoned claim directories, promote
 * 4. If any post-commit records are pending, spawn one self-claiming,
 *    self-landing reconciler agent and sweep its claim directory afterward
 */
export async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (!args) {
    // Cannot log -- no repo root
    process.exit(1);
  }

  const log = createLogger(args.repoRoot);
  log.info('dispatcher: started');
  log.info(`dispatcher: args repoRoot=${args.repoRoot} postRewrite=${args.postRewrite}`);

  try {
    // -----------------------------------------------------------------------
    // Post-rewrite path
    // -----------------------------------------------------------------------
    if (args.postRewrite) {
      const stdinData = await readStdinWithTimeout(log, 5_000);
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
    const changedPaths = getChangedPaths(args.repoRoot, args.commitSha);
    log.info(`dispatcher: commit changed ${changedPaths.size} paths`);

    // Queue operations under lock: reclaim abandoned claim directories, then
    // promote clean pre-commit records into post-commit/.
    withQueueLock(args.repoRoot, () => {
      reclaim(log, args.repoRoot);
      const sweepAll = shouldSweepAll(args.repoRoot);
      if (sweepAll) log.info('dispatcher: performing full backlog sweep');
      promote(log, args.repoRoot, changedPaths, sweepAll, args.commitSha);
    });

    let pending: string[];
    try {
      pending = fs.readdirSync(postCommitDir(args.repoRoot)).filter((f) => f.endsWith('.json'));
    } catch {
      pending = [];
    }
    if (pending.length === 0) {
      log.info('dispatcher: nothing to reconcile');
      return;
    }

    const claimId = randomUUID();
    fs.mkdirSync(claimDirFor(args.repoRoot, claimId), { recursive: true });
    const meshDir = resolveMeshRoot(args.repoRoot);

    if (fs.existsSync(manualRunMarkerPath(args.repoRoot, meshDir))) {
      // Manual-run mode: the claim directory above is real and stays put --
      // it is intentionally NOT swept here, since the generated script is
      // meant to be run later against that exact claim.
      writeManualDispatchScript(log, args.repoRoot, meshDir, claimId, new Date());
      log.info('dispatcher: manual-run marker present, skipped automatic spawn');
      return;
    }

    const exitCode = await spawnAgent(log, args.repoRoot, meshDir, claimId);
    sweepClaimDir(log, args.repoRoot, claimId);

    log.info(`dispatcher: finished (agent exit code ${exitCode})`);
  } catch (err) {
    log.error(`dispatcher: unhandled error: ${err}`);
  }
}

// Top-level entry point: invoke main() only when this module is the entry
// point, not when imported by tests or other modules.
const isMainModule =
  process.argv[1]?.replace(/\\/g, '/').endsWith('dispatcher.mjs') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('dispatcher.ts');
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error('dispatcher: fatal error:', err);
    process.exit(1);
  });
}
