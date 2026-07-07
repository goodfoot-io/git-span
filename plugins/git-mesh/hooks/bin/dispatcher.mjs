// src/dispatcher.ts
import { execFileSync as execFileSync2, spawn } from "node:child_process";
import { randomUUID as randomUUID2 } from "node:crypto";
import * as fs2 from "node:fs";
import * as nodePath2 from "node:path";

// src/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
function toPosix(p) {
  return p.replace(/\\/g, "/");
}
var MESH_ROOT = ".mesh";
function resolveMeshRoot(repoRoot) {
  const envDir = process.env["GIT_MESH_DIR"];
  if (envDir && envDir.trim().length > 0) {
    return toPosix(envDir.trim()).replace(/\/+$/, "");
  }
  try {
    const out = execFileSync("git", ["-C", repoRoot, "config", "git-mesh.dir"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });
    const trimmed = toPosix(out.trim()).replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  } catch (err) {
    void err;
  }
  return MESH_ROOT;
}
function parsePorcelain(stdout) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("	");
    if (parts.length < 3) continue;
    const [name, path, range] = parts;
    const dashIdx = range.indexOf("-");
    if (dashIdx === -1) continue;
    const start = parseInt(range.slice(0, dashIdx), 10);
    const end = parseInt(range.slice(dashIdx + 1), 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    rows.push({ name, path, start, end });
  }
  return rows;
}
var SESSION_BASE_DIR = nodePath.join(os.homedir(), ".cache", "git-mesh", "session");
var LOCK_RETRY_INTERVAL_MS = 5;
var LOCK_MAX_RETRIES = 1e3;
var LOCK_STALE_MS = 3e4;
function formatAnchor(path, kind, range) {
  if ((kind === "read" || kind === "write") && range) {
    return `${path}#L${range.start}-L${range.end}`;
  }
  return path;
}
function resolveGitCommonDir(repoRoot) {
  const out = execFileSync("git", ["-C", repoRoot, "rev-parse", "--git-common-dir"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8"
  });
  return toPosix(out.trim());
}
function queueRoot(repoRoot) {
  return nodePath.join(resolveGitCommonDir(repoRoot), "git-mesh");
}
function preCommitDir(repoRoot) {
  return nodePath.join(queueRoot(repoRoot), "pre-commit");
}
function postCommitDir(repoRoot) {
  return nodePath.join(queueRoot(repoRoot), "post-commit");
}
function claimedDir(repoRoot) {
  return nodePath.join(postCommitDir(repoRoot), "claimed");
}
function acquireQueueLock(lockPath) {
  let attempts = 0;
  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.closeSync(fd);
      return lockPath;
    } catch (err) {
      const e = err;
      if (e.code !== "EEXIST") throw err;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          const sideline = `${lockPath}.stale.${process.pid}.${randomUUID()}`;
          try {
            fs.renameSync(lockPath, sideline);
            try {
              fs.unlinkSync(sideline);
            } catch {
            }
          } catch {
          }
          continue;
        }
      } catch {
        continue;
      }
      if (++attempts >= LOCK_MAX_RETRIES) {
        throw new Error(`withQueueLock: could not acquire lock after ${LOCK_MAX_RETRIES} retries`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_INTERVAL_MS);
    }
  }
}
function withQueueLock(repoRoot, fn) {
  const qRoot = queueRoot(repoRoot);
  const lockPath = nodePath.join(qRoot, ".queue.lock");
  fs.mkdirSync(qRoot, { recursive: true });
  const acquiredPath = acquireQueueLock(lockPath);
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(acquiredPath);
    } catch (e) {
      void e;
    }
  }
}
function readJsonFile(path) {
  const raw = fs.readFileSync(path, "utf8");
  return JSON.parse(raw);
}
function writeJsonFileAtomic(path, data) {
  const tmpPath = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data), "utf8");
    fs.renameSync(tmpPath, path);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
function moveRecord(from, to) {
  fs.renameSync(from, to);
}

// src/dispatcher.ts
var LOG_FILE_NAME = "dispatcher.log";
var CLAIM_PID_SUFFIX = ".pid-";
function getLogFilePath(repoRoot) {
  const meshDir = resolveMeshRoot(repoRoot);
  const absMesh = nodePath2.resolve(repoRoot, meshDir);
  return nodePath2.join(absMesh, LOG_FILE_NAME);
}
function createLogger(repoRoot) {
  const logPath = getLogFilePath(repoRoot);
  fs2.mkdirSync(nodePath2.dirname(logPath), { recursive: true });
  const writeLine = (level, msg) => {
    const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] [${level}] [pid ${process.pid}] ${msg}
`;
    try {
      fs2.appendFileSync(logPath, line, "utf8");
    } catch {
    }
  };
  return {
    info: (msg) => writeLine("INFO", msg),
    warn: (msg) => writeLine("WARN", msg),
    error: (msg) => writeLine("ERROR", msg)
  };
}
function parsePidFromClaimed(filename) {
  const idx = filename.lastIndexOf(CLAIM_PID_SUFFIX);
  if (idx === -1) return null;
  const pidStr = filename.slice(idx + CLAIM_PID_SUFFIX.length);
  const pid = parseInt(pidStr, 10);
  return Number.isFinite(pid) ? pid : null;
}
function stripClaimSuffix(filename) {
  const idx = filename.lastIndexOf(CLAIM_PID_SUFFIX);
  return idx === -1 ? filename : filename.slice(0, idx);
}
function getChangedPaths(repoRoot) {
  try {
    const out = execFileSync2("git", ["-C", repoRoot, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
    const paths = /* @__PURE__ */ new Set();
    for (const line of out.trim().split("\n")) {
      const trimmed = line.trim();
      if (trimmed) paths.add(trimmed);
    }
    return paths;
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function getHeadSha(repoRoot) {
  const out = execFileSync2("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8"
  });
  return out.trim();
}
function getCurrentBranch(repoRoot) {
  try {
    const out = execFileSync2("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
    const branch = out.trim();
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}
function getWorktreeBranches(repoRoot) {
  const map = /* @__PURE__ */ new Map();
  try {
    const out = execFileSync2("git", ["-C", repoRoot, "worktree", "list", "--porcelain"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
    let currentPath = "";
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("worktree ")) {
        currentPath = trimmed.slice("worktree ".length);
      } else if (trimmed.startsWith("branch refs/heads/")) {
        const branch = trimmed.slice("branch refs/heads/".length);
        map.set(branch, currentPath);
      }
    }
  } catch {
  }
  return map;
}
function refExists(repoRoot, branch) {
  try {
    const out = execFileSync2("git", ["-C", repoRoot, "show-ref", "--verify", `refs/heads/${branch}`], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
    return out.trim().split(" ")[0] ?? null;
  } catch {
    return null;
  }
}
function scratchDirAbs(repoRoot) {
  const qRoot = queueRoot(repoRoot);
  return nodePath2.resolve(repoRoot, qRoot, "scratch");
}
function anchorsIntersectChangedPaths(anchors, changedPaths) {
  for (const a of anchors) {
    if (changedPaths.has(a.path)) return true;
  }
  return false;
}
function areAnchorsClean(repoRoot, anchors) {
  for (const a of anchors) {
    try {
      execFileSync2("git", ["-C", repoRoot, "diff", "--quiet", "HEAD", "--", a.path], {
        stdio: ["ignore", "ignore", "pipe"]
      });
    } catch {
      return false;
    }
  }
  return true;
}
function doAnchorsExistAt(repoRoot, sha, anchors) {
  for (const a of anchors) {
    try {
      execFileSync2("git", ["-C", repoRoot, "cat-file", "-e", `${sha}:${a.path}`], {
        stdio: ["ignore", "ignore", "pipe"]
      });
    } catch {
      return false;
    }
  }
  return true;
}
function reclaim(log, repoRoot) {
  const cDir = claimedDir(repoRoot);
  let claimFiles;
  try {
    claimFiles = fs2.readdirSync(cDir).filter((f) => f.includes(CLAIM_PID_SUFFIX));
  } catch {
    return;
  }
  const deadPids = [];
  for (const file of claimFiles) {
    const pid = parsePidFromClaimed(file);
    if (pid === null) continue;
    try {
      process.kill(pid, 0);
    } catch {
      deadPids.push({ file, pid });
    }
  }
  for (const { file, pid } of deadPids) {
    const srcPath = nodePath2.join(cDir, file);
    const originalName = stripClaimSuffix(file);
    const destPath = nodePath2.join(postCommitDir(repoRoot), originalName);
    try {
      moveRecord(srcPath, destPath);
      log.info(`reclaim: returned ${file} to post-commit/ (PID ${pid} dead)`);
    } catch (err) {
      log.error(`reclaim: failed to reclaim ${file}: ${err}`);
    }
  }
  try {
    cleanupOrphanedScratchWorktrees(log, repoRoot, claimFiles);
  } catch (err) {
    log.error(`reclaim: scratch worktree cleanup failed: ${err}`);
  }
}
function cleanupOrphanedScratchWorktrees(log, repoRoot, claimFiles) {
  const worktreeOut = execFileSync2("git", ["-C", repoRoot, "worktree", "list", "--porcelain"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8"
  });
  const scrAbs = scratchDirAbs(repoRoot);
  const liveClaimNames = new Set(claimFiles.map((f) => stripClaimSuffix(f)));
  for (const line of worktreeOut.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("worktree ")) continue;
    const wtPath = trimmed.slice("worktree ".length);
    if (!wtPath.startsWith(scrAbs)) continue;
    const uuid = nodePath2.basename(wtPath);
    const isClaimed = [...liveClaimNames].some((name) => name.startsWith(uuid));
    if (isClaimed) continue;
    try {
      execFileSync2("git", ["-C", repoRoot, "worktree", "remove", "--force", wtPath], {
        stdio: ["ignore", "ignore", "pipe"]
      });
      log.info(`reclaim: removed orphaned scratch worktree ${uuid}`);
    } catch (err) {
      log.error(`reclaim: failed to remove scratch worktree ${uuid}: ${err}`);
    }
  }
  try {
    rmEmptyScratchDirs(scrAbs);
  } catch {
  }
}
function rmEmptyScratchDirs(dir) {
  let entries;
  try {
    entries = fs2.readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const full = nodePath2.join(dir, e);
    let stat;
    try {
      stat = fs2.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      rmEmptyScratchDirs(full);
    }
  }
  try {
    if (fs2.readdirSync(dir).length === 0) {
      fs2.rmdirSync(dir);
    }
  } catch {
  }
}
function promote(log, repoRoot, changedPaths, sweepAll) {
  const pDir = preCommitDir(repoRoot);
  let files;
  try {
    files = fs2.readdirSync(pDir).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  if (files.length === 0) return;
  const sha = getHeadSha(repoRoot);
  const branch = getCurrentBranch(repoRoot);
  for (const file of files) {
    const filePath = nodePath2.join(pDir, file);
    let record;
    try {
      record = readJsonFile(filePath);
    } catch {
      log.warn(`promote: could not parse ${file}, skipping`);
      continue;
    }
    if (!sweepAll && !anchorsIntersectChangedPaths(record.anchors, changedPaths)) {
      continue;
    }
    if (!areAnchorsClean(repoRoot, record.anchors)) {
      continue;
    }
    const postRecord = {
      anchors: record.anchors,
      created_at: record.created_at,
      sha,
      branch
    };
    const postPath = nodePath2.join(postCommitDir(repoRoot), file);
    try {
      writeJsonFileAtomic(postPath, postRecord);
      fs2.unlinkSync(filePath);
      log.info(`promote: promoted ${file} (${record.anchors.length} anchors, branch=${branch ?? "detached"})`);
    } catch (err) {
      log.error(`promote: failed to promote ${file}: ${err}`);
    }
  }
}
function claim(log, repoRoot) {
  const pDir = postCommitDir(repoRoot);
  const cDir = claimedDir(repoRoot);
  fs2.mkdirSync(cDir, { recursive: true });
  let files;
  try {
    files = fs2.readdirSync(pDir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const claimed = [];
  for (const file of files) {
    const srcPath = nodePath2.join(pDir, file);
    const destName = `${file}${CLAIM_PID_SUFFIX}${process.pid}`;
    const destPath = nodePath2.join(cDir, destName);
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
function releaseClaim(log, repoRoot, claimed) {
  try {
    const destPath = nodePath2.join(postCommitDir(repoRoot), claimed.originalName);
    moveRecord(claimed.path, destPath);
    log.info(`release: released ${claimed.originalName} back to post-commit/`);
  } catch (err) {
    log.error(`release: failed to release ${claimed.originalName}: ${err}`);
  }
}
function deleteClaim(log, claimed) {
  try {
    fs2.unlinkSync(claimed.path);
    log.info(`delete: removed claim ${claimed.originalName}`);
  } catch (err) {
    log.warn(`delete: failed to remove claim ${claimed.originalName}: ${err}`);
  }
}
function parsePostRewriteInput(stdin) {
  const map = /* @__PURE__ */ new Map();
  if (!stdin) return map;
  for (const rawLine of stdin.split("\n")) {
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
function postRewriteDemote(log, repoRoot, shaMap) {
  if (shaMap.size === 0) return;
  const pDir = postCommitDir(repoRoot);
  let files;
  try {
    files = fs2.readdirSync(pDir).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  for (const file of files) {
    const filePath = nodePath2.join(pDir, file);
    let record;
    try {
      record = readJsonFile(filePath);
    } catch {
      continue;
    }
    if (!record.sha || !shaMap.has(record.sha)) continue;
    const preRecord = {
      anchors: record.anchors,
      created_at: record.created_at
    };
    const prePath = nodePath2.join(preCommitDir(repoRoot), file);
    try {
      writeJsonFileAtomic(prePath, preRecord);
      fs2.unlinkSync(filePath);
      log.info(`demote: demoted ${file} (SHA ${record.sha.slice(0, 8)} was rewritten)`);
    } catch (err) {
      log.error(`demote: failed to demote ${file}: ${err}`);
    }
  }
}
function resolveBranch(log, repoRoot, record, triggerWorktree) {
  const stampedSha = record.sha;
  const stampedBranch = record.branch;
  if (stampedBranch) {
    const tipSha = refExists(repoRoot, stampedBranch);
    if (tipSha === stampedSha) {
      log.info(`branch-resolve: stamped branch ${stampedBranch} still valid at ${tipSha.slice(0, 8)}`);
      return { branch: stampedBranch, sha: tipSha };
    }
  }
  let containingBranches = [];
  try {
    const out = execFileSync2("git", ["-C", repoRoot, "branch", "--contains", stampedSha], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
    containingBranches = out.trim().split("\n").map((b) => b.replace(/^\*?\s*/, "").trim()).filter(Boolean);
  } catch {
  }
  const worktreeMap = getWorktreeBranches(repoRoot);
  const liveBranches = containingBranches.filter((b) => {
    const wt = worktreeMap.get(b);
    return !wt || wt === triggerWorktree;
  });
  if (liveBranches.length > 0) {
    let resolved;
    if (liveBranches.length === 1) {
      resolved = liveBranches[0];
    } else {
      const triggerBranch = getBranchForWorktree(worktreeMap, triggerWorktree);
      resolved = pickBestBranch(liveBranches, triggerBranch, stampedBranch ?? void 0, repoRoot);
    }
    const tipSha = refExists(repoRoot, resolved);
    if (tipSha) {
      log.info(`branch-resolve: resolved to ${resolved} at ${tipSha.slice(0, 8)}`);
      return { branch: resolved, sha: tipSha };
    }
  }
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
function getBranchForWorktree(worktreeMap, worktreePath) {
  if (!worktreePath) return void 0;
  for (const [branch, wt] of worktreeMap) {
    if (wt === worktreePath) return branch;
  }
  return void 0;
}
function pickBestBranch(candidates, triggerBranch, stampedName, repoRoot) {
  if (triggerBranch && candidates.includes(triggerBranch)) return triggerBranch;
  if (stampedName && candidates.includes(stampedName)) return stampedName;
  if (repoRoot && candidates.length > 1) {
    let best = candidates[0];
    let bestTime = 0;
    for (const branch of candidates) {
      try {
        const out = execFileSync2("git", ["-C", repoRoot, "log", "-1", "--format=%ct", `refs/heads/${branch}`], {
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8"
        });
        const ts = parseInt(out.trim(), 10);
        if (ts > bestTime) {
          bestTime = ts;
          best = branch;
        }
      } catch {
      }
    }
    return best;
  }
  return candidates[0];
}
function createScratchWorktree(log, repoRoot, sha) {
  const uuid = randomUUID2();
  const scrAbs = scratchDirAbs(repoRoot);
  const scratchPath = nodePath2.join(scrAbs, uuid);
  fs2.mkdirSync(scrAbs, { recursive: true });
  try {
    execFileSync2("git", ["-C", repoRoot, "worktree", "add", "--detach", scratchPath, sha], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3e4
    });
    log.info(`scratch: created worktree at ${scratchPath} (SHA ${sha.slice(0, 8)})`);
    return scratchPath;
  } catch (err) {
    log.error(`scratch: failed to create worktree at ${scratchPath}: ${err}`);
    return null;
  }
}
function removeScratchWorktree(log, repoRoot, scratchPath) {
  try {
    execFileSync2("git", ["-C", repoRoot, "worktree", "remove", "--force", scratchPath], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    log.info(`scratch: removed worktree at ${scratchPath}`);
  } catch (err) {
    log.warn(`scratch: git worktree remove failed for ${scratchPath}: ${err}`);
    try {
      fs2.rmSync(scratchPath, { recursive: true, force: true });
    } catch {
    }
  }
}
function runDetection(log, _repoRoot, scratchPath, anchors) {
  const filterLines = anchors.map((a) => formatAnchor(a.path, a.kind, a.range)).join("\n");
  let staleOut;
  let listOut;
  try {
    staleOut = execFileSync2("git", ["-C", scratchPath, "mesh", "stale", "--porcelain", "--batch"], {
      input: filterLines,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 6e4
    });
  } catch (err) {
    log.error(`detection: git mesh stale failed: ${err}`);
    return null;
  }
  try {
    listOut = execFileSync2("git", ["-C", scratchPath, "mesh", "list", "--porcelain", "--batch"], {
      input: filterLines,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 6e4
    });
  } catch (err) {
    log.error(`detection: git mesh list failed: ${err}`);
    return null;
  }
  const staleRows = parsePorcelain(staleOut);
  const listRows = parsePorcelain(listOut);
  const staleNonEmptyLines = staleOut.trim().split("\n").filter(Boolean).length;
  const listNonEmptyLines = listOut.trim().split("\n").filter(Boolean).length;
  if (staleNonEmptyLines > 0 && staleRows.length === 0) {
    log.error("detection: stale porcelain format mismatch (non-empty output produced no rows)");
    return null;
  }
  if (listNonEmptyLines > 0 && listRows.length === 0) {
    log.error("detection: list porcelain format mismatch (non-empty output produced no rows)");
    return null;
  }
  const hasStale = staleRows.length > 0;
  const coveredPaths = new Set(listRows.map((r) => r.path));
  const hasUncovered = anchors.some((a) => {
    return !coveredPaths.has(a.path);
  });
  const actionable = hasStale || hasUncovered;
  log.info(`detection: stale=${staleRows.length} rows, list=${listRows.length} rows, actionable=${actionable}`);
  return { staleOutput: staleOut, listOutput: listOut, staleRows, listRows, actionable };
}
function buildAgentPrompt(scratchPath, detectionResult, anchors) {
  const lines = [
    "You are a standalone mesh reconciler agent. Your job is to reconcile meshes in the scratch worktree.",
    "",
    `The scratch worktree is at: ${scratchPath}`,
    "",
    "## Instructions",
    "",
    "Use the `git-mesh` skill for all git-mesh command mechanics.",
    "All git operations must use the `-C` flag targeting the scratch worktree, e.g. `git -C <scratch-path> mesh stale`.",
    "",
    "## Stale Findings"
  ];
  if (detectionResult.staleRows.length > 0) {
    lines.push("");
    lines.push("The following anchors are stale:");
    for (const row of detectionResult.staleRows) {
      lines.push(`  - ${row.name}: ${row.path}#L${row.start}-L${row.end}`);
    }
  } else {
    lines.push("");
    lines.push("No stale anchors detected.");
  }
  if (detectionResult.listRows.length > 0) {
    lines.push("");
    lines.push("## Related Meshes");
    lines.push("The following meshes are related to the touched anchors:");
    for (const row of detectionResult.listRows) {
      lines.push(`  - ${row.name}: ${row.path}#L${row.start}-L${row.end}`);
    }
  }
  const coveredPaths = new Set(detectionResult.listRows.map((r) => r.path));
  const uncoveredAnchors = anchors.filter((a) => !coveredPaths.has(a.path));
  if (uncoveredAnchors.length > 0) {
    lines.push("");
    lines.push("## Uncovered Writes");
    lines.push("The following touched paths are not covered by any existing mesh:");
    for (const a of uncoveredAnchors) {
      lines.push(`  - ${a.path}${a.range ? `#L${a.range.start}-L${a.range.end}` : ""}`);
    }
  }
  lines.push("");
  lines.push("## Commit Boundary");
  lines.push("- Never touch source files outside .mesh/.");
  lines.push("- Only commit .mesh/ changes \u2014 one commit per session.");
  lines.push("- Only commit once all anchored source files are already committed.");
  lines.push(`- Use: git -C ${scratchPath} add .mesh && git -C ${scratchPath} commit -m "<summary>"`);
  return lines.join("\n");
}
async function spawnAgent(log, repoRoot, scratchPath, meshDir, detectionResult, anchors) {
  const sessionId = randomUUID2();
  const promptText = buildAgentPrompt(scratchPath, detectionResult, anchors);
  const meshDirAbs = nodePath2.resolve(repoRoot, meshDir);
  const settings = {
    allowedTools: [
      "Bash(git mesh *)",
      `Bash(git -C ${scratchPath} add .mesh/**)`,
      `Bash(git -C ${scratchPath} commit *)`,
      `Bash(git -C ${scratchPath} status)`,
      `Bash(git -C ${scratchPath} diff)`,
      `Bash(git -C ${scratchPath} log)`
    ],
    deniedTools: [
      "EnterPlanMode",
      "ExitPlanMode",
      "DesignSync",
      "NotebookEdit",
      "SendMessage",
      "PushNotification",
      "RemoteTrigger",
      "ReportFindings",
      "ScheduleWakeup",
      "AskUserQuestion",
      "CronCreate",
      "CronDelete",
      "CronList"
    ],
    disableBundledSkills: true,
    disableWorkflows: true,
    disableRemoteControl: true,
    disableClaudeAiConnectors: true,
    disableArtifact: true,
    editFileScope: `${meshDirAbs}/**`,
    writeFileScope: `${meshDirAbs}/**`
  };
  const claudeArgs = ["-p", promptText, "--resume", sessionId, "--settings", JSON.stringify(settings)];
  log.info(`spawn: launching agent (session ${sessionId})`);
  try {
    const child = spawn("claude", claudeArgs, {
      cwd: repoRoot,
      stdio: "ignore",
      detached: true
    });
    const exitCode = await new Promise((resolve2) => {
      child.on("exit", (code) => resolve2(code));
      child.on("error", (err) => {
        log.error(`spawn: agent process error: ${err}`);
        resolve2(null);
      });
    });
    if (exitCode === null) {
      log.error("spawn: agent failed to start");
    } else {
      log.info(`spawn: agent exited with code ${exitCode}`);
    }
    return exitCode;
  } catch (err) {
    log.error(`spawn: unexpected error spawning agent: ${err}`);
    return null;
  }
}
var MAX_CAS_ATTEMPTS = 3;
function landCommit(log, repoRoot, scratchPath, targetBranch, expectedOldTip, _claimed) {
  let oldTip = expectedOldTip;
  for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt++) {
    let agentSha;
    try {
      agentSha = execFileSync2("git", ["-C", scratchPath, "rev-parse", "HEAD"], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8"
      }).trim();
    } catch (err) {
      log.error(`land: could not read agent HEAD from scratch worktree: ${err}`);
      return false;
    }
    log.info(
      `land: attempt ${attempt}/${MAX_CAS_ATTEMPTS} \u2014 update-ref ${targetBranch} ${agentSha.slice(0, 8)} (expected old tip ${oldTip.slice(0, 8)})`
    );
    try {
      execFileSync2("git", ["-C", repoRoot, "update-ref", `refs/heads/${targetBranch}`, agentSha, oldTip], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      log.info(`land: CAS succeeded on attempt ${attempt}`);
      return true;
    } catch {
      log.warn(`land: CAS failed on attempt ${attempt}, re-resolving branch`);
    }
    const resolved = resolveBranch(log, repoRoot, { anchors: [], sha: oldTip, branch: targetBranch, created_at: "" });
    if (!resolved) {
      log.error("land: branch no longer reachable after CAS failure \u2014 discarding");
      return false;
    }
    if (resolved.sha === oldTip) {
      log.error("land: CAS failed but branch tip unchanged \u2014 giving up");
      return false;
    }
    try {
      execFileSync2("git", ["-C", scratchPath, "rebase", "--onto", resolved.sha, oldTip], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 3e4
      });
      log.info(`land: rebased onto new tip ${resolved.sha.slice(0, 8)}`);
    } catch (err) {
      log.error(`land: rebase onto new tip failed: ${err}`);
      return false;
    }
    oldTip = resolved.sha;
  }
  log.error(`land: exhausted ${MAX_CAS_ATTEMPTS} attempts`);
  return false;
}
async function processClaimedRecord(log, repoRoot, triggerWorktree, claimed) {
  let record;
  try {
    record = readJsonFile(claimed.path);
  } catch (err) {
    log.error(`process: could not read claimed record ${claimed.originalName}: ${err}`);
    deleteClaim(log, claimed);
    return;
  }
  const resolved = resolveBranch(log, repoRoot, record, triggerWorktree);
  if (!resolved) {
    log.warn(`process: cannot resolve branch for ${claimed.originalName}, deleting`);
    deleteClaim(log, claimed);
    return;
  }
  const scratchPath = createScratchWorktree(log, repoRoot, resolved.sha);
  if (!scratchPath) {
    log.warn(`process: could not create scratch worktree for ${claimed.originalName}, releasing`);
    releaseClaim(log, repoRoot, claimed);
    return;
  }
  const cleanupScratch = () => removeScratchWorktree(log, repoRoot, scratchPath);
  try {
    const detectionResult = runDetection(log, repoRoot, scratchPath, record.anchors);
    if (!detectionResult) {
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
    const meshDir = resolveMeshRoot(repoRoot);
    const exitCode = await spawnAgent(log, repoRoot, scratchPath, meshDir, detectionResult, record.anchors);
    if (exitCode === null || exitCode !== 0) {
      log.warn(`process: agent exited with code ${exitCode}, releasing claim for retry`);
      releaseClaim(log, repoRoot, claimed);
      cleanupScratch();
      return;
    }
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
function sweepCounterPath(repoRoot) {
  return nodePath2.join(queueRoot(repoRoot), ".sweep-counter");
}
var SWEEP_EVERY_N = 10;
function shouldSweepAll(repoRoot) {
  const counterPath = sweepCounterPath(repoRoot);
  let count = 0;
  try {
    const raw = fs2.readFileSync(counterPath, "utf8").trim();
    count = parseInt(raw, 10) || 0;
  } catch {
  }
  const next = count + 1;
  try {
    writeJsonFileAtomic(counterPath, next);
  } catch {
  }
  return next % SWEEP_EVERY_N === 0;
}
function parseArgs(argv) {
  let repoRoot;
  let postRewrite = false;
  let triggerWorktree;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo-root" && i + 1 < argv.length) {
      repoRoot = argv[++i];
    } else if (arg === "--post-rewrite") {
      postRewrite = true;
    } else if (arg === "--trigger-worktree" && i + 1 < argv.length) {
      triggerWorktree = argv[++i];
    }
  }
  if (!repoRoot) return null;
  return { repoRoot, postRewrite, triggerWorktree };
}
function getMainWorktreePath(repoRoot) {
  try {
    const out = execFileSync2("git", ["-C", repoRoot, "worktree", "list", "--porcelain"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("worktree ") && !trimmed.includes("bare")) {
        return trimmed.slice("worktree ".length);
      }
    }
  } catch {
  }
  return repoRoot;
}
async function main() {
  const args = parseArgs(process.argv);
  if (!args) {
    process.exit(1);
  }
  const log = createLogger(args.repoRoot);
  log.info("dispatcher: started");
  log.info(`dispatcher: args repoRoot=${args.repoRoot} postRewrite=${args.postRewrite}`);
  const mainWorktree = getMainWorktreePath(args.repoRoot);
  try {
    if (args.postRewrite) {
      let stdinData = "";
      try {
        stdinData = fs2.readFileSync("/dev/stdin", "utf8");
      } catch {
        log.info("dispatcher: --post-rewrite but stdin unavailable, skipping");
        return;
      }
      const shaMap = parsePostRewriteInput(stdinData);
      if (shaMap.size > 0) {
        log.info(`dispatcher: post-rewrite mapping has ${shaMap.size} entries`);
        withQueueLock(args.repoRoot, () => {
          postRewriteDemote(log, args.repoRoot, shaMap);
        });
      } else {
        log.info("dispatcher: post-rewrite but no valid SHA mapping in stdin");
      }
      log.info("dispatcher: post-rewrite complete");
      return;
    }
    const changedPaths = getChangedPaths(args.repoRoot);
    log.info(`dispatcher: commit changed ${changedPaths.size} paths`);
    const sweepAll = shouldSweepAll(args.repoRoot);
    if (sweepAll) log.info("dispatcher: performing full backlog sweep");
    const claimedRecords = withQueueLock(args.repoRoot, () => {
      reclaim(log, args.repoRoot);
      promote(log, args.repoRoot, changedPaths, sweepAll);
      return claim(log, args.repoRoot);
    });
    log.info(`dispatcher: claimed ${claimedRecords.length} records`);
    for (const claimed of claimedRecords) {
      await processClaimedRecord(log, args.repoRoot, args.triggerWorktree ?? mainWorktree, claimed);
    }
    log.info("dispatcher: finished");
  } catch (err) {
    log.error(`dispatcher: unhandled error: ${err}`);
  }
}
export {
  anchorsIntersectChangedPaths,
  areAnchorsClean,
  buildAgentPrompt,
  claim,
  createLogger,
  createScratchWorktree,
  deleteClaim,
  doAnchorsExistAt,
  getChangedPaths,
  getCurrentBranch,
  getHeadSha,
  getLogFilePath,
  getMainWorktreePath,
  getWorktreeBranches,
  landCommit,
  main,
  parseArgs,
  parsePidFromClaimed,
  parsePostRewriteInput,
  postRewriteDemote,
  processClaimedRecord,
  promote,
  reclaim,
  refExists,
  releaseClaim,
  removeScratchWorktree,
  resolveBranch,
  runDetection,
  scratchDirAbs,
  spawnAgent,
  stripClaimSuffix
};
