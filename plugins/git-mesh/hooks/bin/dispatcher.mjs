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
var SESSION_BASE_DIR = nodePath.join(os.homedir(), ".cache", "git-mesh", "session");
var LOCK_RETRY_INTERVAL_MS = 5;
var LOCK_MAX_RETRIES = 1e3;
var LOCK_STALE_MS = 3e4;
function resolveGitCommonDir(repoRoot) {
  const out = execFileSync("git", ["-C", repoRoot, "rev-parse", "--git-common-dir"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8"
  });
  const trimmed = toPosix(out.trim());
  if (!nodePath.isAbsolute(trimmed)) {
    return toPosix(nodePath.resolve(repoRoot, trimmed));
  }
  return trimmed;
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
function claimDirFor(repoRoot, claimId) {
  return nodePath.join(claimedDir(repoRoot), claimId);
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

// src/agent-prompt.md
var agent_prompt_default = "You are a standalone mesh reconciler agent. Your job is to reconcile meshes for whatever records are waiting in the post-commit queue \u2014 claiming them yourself, reconciling each one, and landing your work directly onto its target branch.\n\n## Queue layout\n\n- Pending records live in: `{{postCommitDir}}` \u2014 one `*.json` file per record, shape `{ anchors: [{path, kind, range?}], created_at, sha, branch }`.\n  - `sha` is the commit whose anchors this record covers.\n  - `branch` is the branch that commit landed on (may be `null` for a detached-HEAD commit \u2014 if so, skip that record and leave it in place; there is no branch to land it on).\n  - `anchors` are mesh anchor specs: `kind` is `read`/`write` (has a `range: {start, end}`, format as `path#L<start>-L<end>`) or `whole-read`/`whole-write`/`create` (format as bare `path`).\n- Your own claim directory is: `{{claimDir}}` \u2014 nothing else touches this directory; anything you move here is yours alone.\n- The repo root is: `{{repoRoot}}`. The mesh directory (relative to any worktree root) is: `{{meshDir}}`.\n\n## Instructions\n\nUse the `git-mesh` skill for all git-mesh command mechanics.\n\n### 1. Enter one worktree for the whole run\n\nCall the `EnterWorktree` tool once, at the start, to create a fresh worktree branched off the repo root's current branch. You do not pass it a specific commit \u2014 it doesn't support one. Reuse this same worktree for every record you process below; don't create a new one per record.\n\nDo not confuse this with the `Agent` tool used for forking in step 8 below \u2014 a fork call is not inert. If you invoke `Agent(subagent_type: \"fork\")` when you meant `EnterWorktree`, it inherits your full context and immediately starts acting on it (potentially redoing your own job in a second worktree). Double-check the tool name before calling either.\n\n### 2. Claim your work\n\nYour claim directory (`{{claimDir}}`) may not exist yet \u2014 create it first: `mkdir -p {{claimDir}}`. Then list the `*.json` files in `{{postCommitDir}}` and move the ones you intend to work on into it (e.g. `mv {{postCommitDir}}/<file>.json {{claimDir}}/`). Claim as many or as few as you have time for \u2014 anything you leave behind stays available for a future run. Once a record is in your claim directory, it's exclusively yours.\n\n### 3. For each record you claimed, in turn\n\nIf two or more claimed records share the same `sha`, you only need to `git checkout <sha>` once before processing all of them \u2014 group your claimed records by `sha` first, and process each group under a single checkout rather than re-checking-out per record. Still treat each record as its own unit of work for the remaining steps below (its own detection, commit, and land) unless their anchors overlap enough that combining them into one commit is clearly simpler.\n\n1. Read the record's JSON to get its `sha`, `branch`, and `anchors`.\n2. In your worktree, `git checkout <sha>` (detached \u2014 it's an arbitrary past commit, not a branch tip) \u2014 skip this if you already checked out this `sha` for a previous record in this group (see above).\n3. **Auto-fix first.** `--fix` only runs in human format (it can't be combined with `--porcelain --batch`), but it does accept explicit paths, so scope it to this record's anchor paths (deduped, ranges dropped): `git mesh stale --fix -- <path-1> <path-2> ...`. This silently re-anchors `Moved` anchors and whitespace-equivalent `Changed` anchors \u2014 cheap, mechanical drift that needs no judgment. Anything left after this is a real finding.\n4. Run detection filtered to this record's anchors: pipe the anchors (one per line, formatted as above) as stdin to `git mesh stale --porcelain --batch` and `git mesh list --porcelain --batch`.\n5. **Find findings that need reconciliation.** Collect three kinds from what step 4 turned up: stale anchors (CHANGED or DELETED after the auto-fix pass), related meshes (anchors already covered by an existing mesh that may need extending or pruning), and uncovered writes (anchor paths with no existing mesh at all). If there are none of any kind, there's nothing to commit or land for this record \u2014 skip straight to deleting it from your claim directory (step 12 below). If the auto-fix pass DID change something even though no further finding remains, continue on to commit and land it (skip steps 6\u20138).\n6. **Build the component graph.** For every file that appears in more than one finding from step 5, run `git mesh tree '<file>' --depth 1` \u2014 its children are the meshes that also anchor that file. Findings connected through a shared file form one component; a finding that shares no file with any other finding in this record is a component of size one. Within a component, findings must be reconciled together since they share context about what the correct line ranges and mesh boundaries are.\n7. **Check whether forking is worthwhile.** If this record's findings are small and simple (e.g. 1\u20132 meshes total, no shared files, no components larger than one), the overhead of a fork isn't justified \u2014 handle it inline yourself using the procedure in step 9, then skip to step 10.\n8. **Fork one subagent per component, all in parallel.** Each fork works in the worktree you already entered \u2014 do not call `EnterWorktree` again inside a fork. Components are disjoint by construction, so forks touch disjoint `.mesh/` files and never conflict with each other. A fork mutates `.mesh/` only; it never commits and never lands (you do that once, after all forks return, in steps 10\u201311). Give each fork:\n   - The mesh names in its component, their current anchors, and their why (if any).\n   - Which anchors are stale (CHANGED/DELETED), which are related-mesh findings, and which are uncovered writes.\n   - The shared file(s) connecting the component, and any healthy (non-stale) meshes that also anchor them, for range context.\n   - The full procedure from step 9 below, to execute for its component only.\n\n   Dispatch each component with a fork:\n\n   ```xml\n   <invoke name=\"Agent\">\n   <parameter name=\"description\">Reconcile <component-label> cluster</parameter>\n   <parameter name=\"subagent_type\">fork</parameter>\n   <parameter name=\"prompt\">\n   Reconcile these findings (component: <component-label> \u2014 connected via <shared-file>). Do not commit, do not land, do not call EnterWorktree.\n\n   ## <mesh-name-1>\n   - Stale: <path>#L<N>-L<M> \u2014 <CHANGED|DELETED>\n   - Why: <current why, or \"none\">\n\n   ## <mesh-name-2>\n   - Related: extend with uncovered write <path>\n   - Why: <current why>\n\n   (Context: these share <shared-file>. Healthy meshes also anchoring it: <list>.)\n\n   Follow step 9 of your instructions (the reconciliation procedure) for these findings only.\n   </parameter>\n   </invoke>\n   ```\n9. **The reconciliation procedure** (run this yourself in step 7's inline case, or hand it to each fork in step 8). For every finding, follow the same discipline: **read before you write, confirm in one sentence, then act** \u2014 never bulk-clear a finding just to make the exit code pass.\n   - **Stale anchors** \u2014 for each: read the current bytes at the anchor location and run `git mesh history <name>` to compare against what's anchored; write a one-sentence confirmation of whether the relationship still holds; stop and leave it for a human if you cannot confirm it. Then classify and act:\n\n     | Finding | Action |\n     |---|---|\n     | Bytes shifted, meaning preserved | `git mesh remove <name> '<path>#L<old>'` then `git mesh add <name> '<path>#L<new>'` |\n     | Content updated, same relationship | `git mesh remove <name> '<path>#L<N>'` then `git mesh add <name> '<path>#L<N>'` (re-hash) |\n     | Content no longer describes the relationship | `git mesh remove <name> '<path>#L<N>'` |\n     | One side of the relationship broke | Fix the code first, then re-anchor both sides in the same commit |\n     | Relationship gone entirely | `git mesh delete <name>` |\n     | Mesh has no why | `git mesh why <name> -m \"<one sentence>\"` |\n\n     If a DELETED anchor's file no longer exists on disk at all: remove just that anchor if the mesh's remaining anchors still describe a valid relationship, or delete the whole mesh if the relationship is gone without it.\n   - **Related meshes** \u2014 extend or prune as appropriate: absorb an uncovered write into one, prune an anchor that no longer holds, or refactor \u2014 whichever fits. Confirm the relationship still holds before extending; don't grow a mesh past what its why actually describes.\n   - **Uncovered writes** \u2014 where two or more form a coherent subsystem, a flow or concern that spans them, create one: `git mesh add <slug> <anchors>` then `git mesh why <slug> -m \"<one sentence>\"`. Leave a lone file that forms no subsystem alone.\n     The why must name the relationship the anchors hold in one sentence that survives a rewrite of either side, in role-words. A good why: \"the validator rejects every field the schema marks required, so the two must list the same keys.\" A bad why restates the slug (\"charge flow\"), describes a change (\"added the charge() call\"), or just lists the filenames \u2014 none of those survive a rewrite or tell the next reader why the sites move together.\n   - When run as a fork: stop at this point once your component's findings are handled. Do not re-run detection, commit, or land \u2014 return control to the top-level agent.\n10. Re-run `git mesh stale --porcelain --batch` filtered to this record's anchors \u2014 confirm none of them appear anymore (ignore anchors that belong to other records; you're only responsible for your own).\n11. Commit your `.mesh/` changes: `git add .mesh/** && git commit -m \"<summary>\"` \u2014 one commit per record, covering the auto-fix pass and every component's reconciliation (whether done inline or by a fork). Never touch source files outside `.mesh/`; only commit once the record's anchored source files are already committed (they always are, since these are post-commit records).\n12. **Land it yourself.** Rebase your `.mesh` commit onto the current tip of `branch`, then fast-forward `branch` to your rebased commit \u2014 e.g. `git rebase <branch>` while on your commit, then `git checkout <branch> && git merge --ff-only <your-commit>`. If the rebase produces conflicts in `.mesh/` files (another agent landed an overlapping change first), resolve them structurally rather than by hand: make sure the referenced source files are conflict-free, run `git mesh stale --fix` to resolve the `.mesh/` conflict markers, then continue the rebase. If the fast-forward fails because `branch` moved again in the meantime, retry once. If it still fails, **do not force it**: leave that record's `.json` file sitting in `{{claimDir}}` \u2014 do not delete it, do not move it \u2014 so it goes back to `{{postCommitDir}}` for a future run to retry.\n13. Once a record is successfully landed (or determined to need no action), delete its file from your claim directory: `rm {{claimDir}}/<file>.json`. Do not move resolved records back to `{{postCommitDir}}`.\n14. Before checking out the next record's SHA, make sure the worktree is clean (nothing uncommitted).\n\n### 4. When you're done\n\nOnce you've processed everything you claimed (or you're running low on time), call `ExitWorktree` with `action: \"remove\"`. There should be nothing left to keep \u2014 successful work has already landed on the real branches, and the worktree itself has nothing further to commit.\n\nWork in the background and do not report unless something needs human intervention.\n";

// src/dispatcher.ts
var LOG_FILE_NAME = "dispatcher.log";
function readStdinWithTimeout(log, timeoutMs) {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve3) => {
    const chunks = [];
    let timer;
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      if (timer) clearTimeout(timer);
    };
    const onData = (chunk) => {
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve3(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = () => {
      cleanup();
      resolve3("");
    };
    timer = setTimeout(() => {
      log.warn("dispatcher: stdin read timed out, continuing with empty data");
      cleanup();
      resolve3("");
    }, timeoutMs);
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}
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
function getChangedPaths(repoRoot, commitSha) {
  const rev = commitSha ?? "HEAD";
  try {
    const out = execFileSync2(
      "git",
      ["-C", repoRoot, "diff-tree", "--no-commit-id", "--name-status", "-r", "--root", "-M", rev],
      {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8"
      }
    );
    const paths = /* @__PURE__ */ new Set();
    for (const line of out.trim().split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split("	");
      if (parts.length < 2) continue;
      const status = parts[0];
      if (!status) continue;
      if (status.startsWith("R")) {
        if (parts[1]) paths.add(parts[1]);
        if (parts[2]) paths.add(parts[2]);
      } else if (parts[1]) {
        paths.add(parts[1]);
      }
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
var CLAIM_STALE_MS = 20 * 60 * 1e3;
function reclaim(log, repoRoot) {
  const cDir = claimedDir(repoRoot);
  let entries;
  try {
    entries = fs2.readdirSync(cDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const dirPath = nodePath2.join(cDir, entry);
    let stat;
    try {
      stat = fs2.statSync(dirPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (Date.now() - stat.mtimeMs <= CLAIM_STALE_MS) continue;
    let files;
    try {
      files = fs2.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
    } catch (err) {
      log.error(`reclaim: could not read claim directory ${entry}: ${err}`);
      continue;
    }
    let recovered = 0;
    for (const file of files) {
      const srcPath = nodePath2.join(dirPath, file);
      const destPath = nodePath2.join(postCommitDir(repoRoot), file);
      try {
        moveRecord(srcPath, destPath);
        recovered++;
      } catch (err) {
        log.error(`reclaim: failed to move ${entry}/${file} back to post-commit/: ${err}`);
      }
    }
    try {
      const remaining = fs2.readdirSync(dirPath);
      if (remaining.length > 0) {
        log.warn(
          `reclaim: claim directory ${entry} still has ${remaining.length} entries after sweep, removing anyway`
        );
      }
      fs2.rmSync(dirPath, { recursive: true, force: true });
      log.info(`reclaim: reclaimed ${recovered} record(s) from abandoned claim directory ${entry}`);
    } catch (err) {
      log.error(`reclaim: failed to remove claim directory ${entry}: ${err}`);
    }
  }
}
function sweepClaimDir(log, repoRoot, claimId) {
  const dirPath = claimDirFor(repoRoot, claimId);
  let files;
  try {
    files = fs2.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  for (const file of files) {
    const srcPath = nodePath2.join(dirPath, file);
    const destPath = nodePath2.join(postCommitDir(repoRoot), file);
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
    fs2.rmSync(dirPath, { recursive: true, force: true });
  } catch (err) {
    log.error(`sweep: failed to remove claim directory ${claimId}: ${err}`);
  }
}
function promote(log, repoRoot, changedPaths, sweepAll, commitSha) {
  const pDir = preCommitDir(repoRoot);
  let files;
  try {
    files = fs2.readdirSync(pDir).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  if (files.length === 0) return;
  const sha = commitSha ?? getHeadSha(repoRoot);
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
      fs2.mkdirSync(postCommitDir(repoRoot), { recursive: true });
      writeJsonFileAtomic(postPath, postRecord);
      fs2.unlinkSync(filePath);
      log.info(`promote: promoted ${file} (${record.anchors.length} anchors, branch=${branch ?? "detached"})`);
    } catch (err) {
      log.error(`promote: failed to promote ${file}: ${err}`);
    }
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
      fs2.mkdirSync(preCommitDir(repoRoot), { recursive: true });
      writeJsonFileAtomic(prePath, preRecord);
      fs2.unlinkSync(filePath);
      log.info(`demote: demoted ${file} (SHA ${record.sha.slice(0, 8)} was rewritten)`);
    } catch (err) {
      log.error(`demote: failed to demote ${file}: ${err}`);
    }
  }
}
function buildAgentPrompt(repoRoot, meshDir, postCommitDirAbs, claimDirAbs) {
  let prompt = agent_prompt_default;
  prompt = prompt.replace(/\{\{repoRoot\}\}/g, repoRoot);
  prompt = prompt.replace(/\{\{meshDir\}\}/g, meshDir);
  prompt = prompt.replace(/\{\{postCommitDir\}\}/g, postCommitDirAbs);
  prompt = prompt.replace(/\{\{claimDir\}\}/g, claimDirAbs);
  return prompt.trimEnd();
}
var AGENT_TIMEOUT_MS = 15 * 60 * 1e3;
var SIGTERM_GRACE_MS = 1e4;
function buildClaudeArgs(repoRoot, meshDir, claimId) {
  const postCommitDirAbs = postCommitDir(repoRoot);
  const claimDirAbs = claimDirFor(repoRoot, claimId);
  const promptText = buildAgentPrompt(repoRoot, meshDir, postCommitDirAbs, claimDirAbs);
  const settings = {
    permissions: {
      deny: [
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
      ]
    },
    disableBundledSkills: true,
    disableWorkflows: true,
    disableRemoteControl: true,
    disableClaudeAiConnectors: true,
    disableArtifact: true
  };
  return ["-p", promptText, "--model", "sonnet", "--effort", "low", "--settings", JSON.stringify(settings)];
}
async function spawnAgent(log, repoRoot, meshDir, claimId, timeoutMs = AGENT_TIMEOUT_MS) {
  const claudeArgs = buildClaudeArgs(repoRoot, meshDir, claimId);
  log.info(`spawn: launching agent (claim ${claimId})`);
  const agentLogPath = nodePath2.resolve(repoRoot, meshDir, `agent-${claimId}.log`);
  let agentLogFd;
  try {
    fs2.mkdirSync(nodePath2.dirname(agentLogPath), { recursive: true });
    agentLogFd = fs2.openSync(agentLogPath, "a");
  } catch (err) {
    log.warn(`spawn: could not open agent log ${agentLogPath}: ${err}`);
    agentLogFd = -1;
  }
  try {
    const child = spawn("claude", claudeArgs, {
      cwd: repoRoot,
      stdio: ["ignore", agentLogFd > 0 ? agentLogFd : "ignore", agentLogFd > 0 ? agentLogFd : "ignore"],
      detached: true
    });
    const timeoutHandle = setTimeout(() => {
      log.warn(`spawn: agent timed out after ${timeoutMs}ms, sending SIGTERM`);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) {
          log.warn("spawn: agent did not exit after SIGTERM, sending SIGKILL");
          child.kill("SIGKILL");
        }
      }, SIGTERM_GRACE_MS).unref();
    }, timeoutMs);
    timeoutHandle.unref();
    const exitCode = await new Promise((resolve3) => {
      const cleanup = () => {
        if (agentLogFd > 0) {
          try {
            fs2.closeSync(agentLogFd);
          } catch (_) {
            void _;
          }
        }
      };
      child.on("exit", (code) => {
        clearTimeout(timeoutHandle);
        cleanup();
        resolve3(code);
      });
      child.on("error", (err) => {
        clearTimeout(timeoutHandle);
        cleanup();
        log.error(`spawn: agent process error: ${err}`);
        resolve3(null);
      });
    });
    if (exitCode === null) {
      log.error("spawn: agent failed to start");
    } else {
      log.info(`spawn: agent exited with code ${exitCode} (log: ${agentLogPath})`);
    }
    return exitCode;
  } catch (err) {
    log.error(`spawn: unexpected error spawning agent: ${err}`);
    if (agentLogFd > 0) {
      try {
        fs2.closeSync(agentLogFd);
      } catch (_) {
        void _;
      }
    }
    return null;
  }
}
var MANUAL_RUN_MARKER_NAME = ".manual-run";
function manualRunMarkerPath(repoRoot, meshDir) {
  return nodePath2.join(nodePath2.resolve(repoRoot, meshDir), MANUAL_RUN_MARKER_NAME);
}
function shellQuoteSingle(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function writeManualDispatchScript(log, repoRoot, meshDir, claimId, now) {
  const claudeArgs = buildClaudeArgs(repoRoot, meshDir, claimId);
  const meshDirAbs = nodePath2.resolve(repoRoot, meshDir);
  const claimDirAbs = claimDirFor(repoRoot, claimId);
  const datetimeStamp = now.toISOString().replace(/[:.]/g, "-");
  const scriptPath = nodePath2.join(meshDirAbs, `manual-hook-dispatch-${datetimeStamp}.sh`);
  const quotedCommand = ["claude", ...claudeArgs].map(shellQuoteSingle).join(" \\\n  ");
  const script = [
    "#!/bin/sh",
    `# git-mesh manual dispatch script -- generated ${now.toISOString()}`,
    "#",
    `# Claim directory: ${claimDirAbs}`,
    `# Mesh directory:  ${meshDirAbs}`,
    "#",
    "# The claim directory above was already reserved for this run and is left",
    "# in place until this script is executed -- running it launches the same",
    "# self-claiming, self-landing reconciler agent the dispatcher would have",
    "# spawned automatically. If left unrun for too long, a future dispatcher",
    "# invocation may reclaim the (still-empty) claim directory as abandoned.",
    "",
    "# Resolve the repo root from this script's own location on disk (it",
    "# lives under the mesh directory, which is always inside the repo)",
    "# rather than hardcoding the path this script happened to be generated",
    "# for -- the script stays runnable even if the repo is moved, cloned",
    "# elsewhere, or renamed.",
    'script_dir=$(cd "$(dirname "$0")" && pwd -P) || exit 1',
    'repo_root=$(cd "$script_dir" && git rev-parse --show-toplevel) || exit 1',
    'cd "$repo_root" || exit 1',
    `exec ${quotedCommand}`,
    ""
  ].join("\n");
  fs2.mkdirSync(meshDirAbs, { recursive: true });
  fs2.writeFileSync(scriptPath, script, "utf8");
  fs2.chmodSync(scriptPath, 493);
  log.info(`manual-run: wrote ${scriptPath} instead of spawning (claim ${claimId})`);
  return scriptPath;
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
  let commitSha;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo-root" && i + 1 < argv.length) {
      repoRoot = argv[++i];
    } else if (arg === "--post-rewrite") {
      postRewrite = true;
    } else if (arg === "--commit-sha" && i + 1 < argv.length) {
      commitSha = argv[++i];
    }
  }
  if (!repoRoot) return null;
  return { repoRoot, postRewrite, commitSha };
}
async function main() {
  const args = parseArgs(process.argv);
  if (!args) {
    process.exit(1);
  }
  const log = createLogger(args.repoRoot);
  log.info("dispatcher: started");
  log.info(`dispatcher: args repoRoot=${args.repoRoot} postRewrite=${args.postRewrite}`);
  try {
    if (args.postRewrite) {
      const stdinData = await readStdinWithTimeout(log, 5e3);
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
    const changedPaths = getChangedPaths(args.repoRoot, args.commitSha);
    log.info(`dispatcher: commit changed ${changedPaths.size} paths`);
    withQueueLock(args.repoRoot, () => {
      reclaim(log, args.repoRoot);
      const sweepAll = shouldSweepAll(args.repoRoot);
      if (sweepAll) log.info("dispatcher: performing full backlog sweep");
      promote(log, args.repoRoot, changedPaths, sweepAll, args.commitSha);
    });
    let pending;
    try {
      pending = fs2.readdirSync(postCommitDir(args.repoRoot)).filter((f) => f.endsWith(".json"));
    } catch {
      pending = [];
    }
    if (pending.length === 0) {
      log.info("dispatcher: nothing to reconcile");
      return;
    }
    const claimId = randomUUID2();
    fs2.mkdirSync(claimDirFor(args.repoRoot, claimId), { recursive: true });
    const meshDir = resolveMeshRoot(args.repoRoot);
    if (fs2.existsSync(manualRunMarkerPath(args.repoRoot, meshDir))) {
      writeManualDispatchScript(log, args.repoRoot, meshDir, claimId, /* @__PURE__ */ new Date());
      log.info("dispatcher: manual-run marker present, skipped automatic spawn");
      return;
    }
    const exitCode = await spawnAgent(log, args.repoRoot, meshDir, claimId);
    sweepClaimDir(log, args.repoRoot, claimId);
    log.info(`dispatcher: finished (agent exit code ${exitCode})`);
  } catch (err) {
    log.error(`dispatcher: unhandled error: ${err}`);
  }
}
var isMainModule = process.argv[1]?.replace(/\\/g, "/").endsWith("dispatcher.mjs") || process.argv[1]?.replace(/\\/g, "/").endsWith("dispatcher.ts");
if (isMainModule) {
  main().catch((err) => {
    console.error("dispatcher: fatal error:", err);
    process.exit(1);
  });
}
export {
  anchorsIntersectChangedPaths,
  areAnchorsClean,
  buildAgentPrompt,
  buildClaudeArgs,
  createLogger,
  getChangedPaths,
  getCurrentBranch,
  getHeadSha,
  getLogFilePath,
  main,
  manualRunMarkerPath,
  parseArgs,
  parsePostRewriteInput,
  postRewriteDemote,
  promote,
  reclaim,
  spawnAgent,
  sweepClaimDir,
  writeManualDispatchScript
};
