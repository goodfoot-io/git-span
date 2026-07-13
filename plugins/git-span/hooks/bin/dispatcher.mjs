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
var SPAN_ROOT = ".span";
function resolveSpanRoot(repoRoot) {
  const envDir = process.env["GIT_SPAN_DIR"];
  if (envDir && envDir.trim().length > 0) {
    return toPosix(envDir.trim()).replace(/\/+$/, "");
  }
  try {
    const out = execFileSync("git", ["-C", repoRoot, "config", "git-span.dir"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });
    const trimmed = toPosix(out.trim()).replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  } catch (err) {
    void err;
  }
  return SPAN_ROOT;
}
var SESSION_BASE_DIR = nodePath.join(os.homedir(), ".cache", "git-span", "session");
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
  return nodePath.join(resolveGitCommonDir(repoRoot), "git-span");
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
var agent_prompt_default = "You are a standalone span reconciler agent. Records in the post-commit queue name recently committed files whose spans may need attention. Claim records, reconcile the spans their files point at, land the result on each record's branch, and exit.\n\n## Queue\n\n- Pending records: `{{postCommitDir}}/*.json`, shape `{anchors: [{path, kind, range?}], created_at, sha, branch}`.\n  - `sha` is the commit that landed the writes; `branch` is the branch it landed on.\n  - `range` is the union of lines a session touched, not the commit's diff \u2014 treat ranges as hints for where to look; the paths are what matter.\n- Your claim directory: `{{claimDir}}`. `mkdir -p` it, then `mv` records there to claim them; a claimed record is exclusively yours. Anything left behind stays available for future runs.\n- Repo root: `{{repoRoot}}`. Span directory: `{{spanDir}}`.\n\n## Command mechanics\n\nLoad the `git-span` skill for judgment (whether a coupling deserves a span, why-writing, drift decisions); where the skill's standalone-reconciler section and this prompt disagree, this prompt wins. Mechanics you will need here:\n\n- Extract record fields with `jq -r` (hand-copying a 40-hex sha invites typos). Put path lists in a bash array (`paths=(a b c)`, then `\"${paths[@]}\"`) \u2014 a plain string variable, even unquoted, is passed as one argument and `git span` will report the whole thing as a single not-found path.\n- `git span list <path>... --oneline` \u2014 which spans anchor these paths. \"No spans match the filters.\" = none.\n- `git span stale --format porcelain -- <path>...` \u2014 drift findings. Takes paths only, no `#L` ranges. Silent exit 0 = clean.\n- `git span stale --fix -- <path>...` \u2014 auto-repairs moved and whitespace-only drift (human format only). Exits non-zero whenever findings survive, even after a successful repair \u2014 judge `--fix` and `history` by their output, not their exit codes.\n- `git span <name>` \u2014 one span's anchors, why, and config. `git span history <name>` \u2014 how it evolved. Bare `git span` prints help, not a listing.\n- `git span add <name> '<path>#L<start>-L<end>'...`, `remove`, `delete`, `why <name> -m \"...\"`. Quote anchors \u2014 `#` is a shell comment. `add` over an existing extent re-anchors it; a moved extent needs `remove` old + `add` new. Anchors hash against HEAD.\n- Commit only `.span/` paths: `git add .span && git commit -m \"...\"`. Never `git add .`/`-a`/`--amend`/`reset`, never modify files outside `.span/`, and ignore hook suggestions unrelated to that mandate (e.g. card binding).\n\n## Procedure\n\n1. Read the pending records before claiming anything: group them by `branch` and claim (via `mv`) one or more whole branch groups you have time for.\n2. Call `EnterWorktree` once and reuse the worktree for the whole run.\n3. Work each claimed group **at its branch tip**, not at any record's `sha` \u2014 the tip has the current `.span` tree (detection at an old sha misses spans landed since, so you'd re-create coverage that already exists), and anchors added at the tip are fresh where they land. Per group:\n   1. Drop any record whose `sha` is not an ancestor of the branch (`git merge-base --is-ancestor <sha> <branch>`) \u2014 leave its file in `{{claimDir}}` untouched and continue without it.\n   2. `git checkout --detach <branch>` (tree must be clean from the previous group first).\n   3. Dedupe the group's anchor paths. Drop any path that `git log --all --follow` shows was never tracked at any commit (a misrecorded filename, not a delete/rename) \u2014 it has nothing for `git span` to check. Then: `git span stale --fix -- <paths>`, `git span stale --format porcelain -- <paths>`, `git span list <paths> --oneline`.\n   4. Classify the results: **stale anchors** (CHANGED/DELETED surviving `--fix`), **related spans** (an existing span anchors one of the paths \u2014 may need extending or pruning), **uncovered writes** (paths no span anchors). Attribute findings back to records: a record none of whose paths produced a finding (and that `--fix` didn't touch) is done \u2014 delete its file from `{{claimDir}}` now. If that empties the group, move on with no commit.\n   5. Reconcile the remaining findings in parallel forks. You own all shared git state: `git checkout`, `git add`, `git commit`, rebase, and fast-forward happen only in this top-level agent, never in a fork. Forks run only `git span` reconciliation commands, which each touch a single `.span/<name>` file, so disjoint batches cannot collide.\n      1. Choose a provisional slug now for each uncovered write you judge likely to need a span (partitioning needs the name; the fork makes the final should-this-be-a-span call).\n      2. Partition findings into batches: group by span name (each provisional slug is its own group), then merge groups sharing an anchor path, until every batch is disjoint from every other in both span names and anchor paths. Target 2\u20134 findings per batch, at most 4 forks; with more batches than that, merge the smallest. A single batch \u2014 skip forking and reconcile it yourself.\n      3. Dispatch all forks in one message via `Agent` with `subagent_type: \"fork\"`. Each fork inherits this conversation; its prompt needs only: its batch (span names, paths, porcelain lines), the worktree path, and the mandate \u2014 apply the Reconciliation rules using `git span add/remove/delete/why` only; never run `git checkout`, `git add`, or `git commit`; if a finding turns out to implicate a span name or anchor path outside the batch, leave it untouched and report the conflict back; end with a per-finding verdict: resolved, leave-for-human (with the one-sentence reason), or out-of-batch conflict.\n      4. After every fork returns, resolve reported out-of-batch conflicts yourself, sequentially. For each leave-for-human verdict, leave the record file(s) whose paths produced that finding in `{{claimDir}}`; the group's other records still proceed to commit.\n      5. Re-run `git span stale --format porcelain -- <paths>` across the whole group's paths (never trust a fork's partial view) and confirm they are clean apart from findings deliberately left for a human.\n   6. Commit the group's `.span/` changes: `git add .span && git commit -m \"<summary>\"`. Ignore any hook-printed drift warnings for spans outside your claimed paths (e.g. wiki spans) \u2014 not your scope.\n   7. Land the commit on `<branch>`:\n      1. If `<branch>` moved while you worked, `git rebase <branch>`. On a `.span/` conflict: confirm the anchored source files are conflict-free, run `git span stale --fix`, continue the rebase, and re-check staleness after.\n      2. Fast-forward the branch: `git checkout <branch> && git merge --ff-only <commit>`. When checkout is refused because the branch is checked out at the repo root, run `git -C {{repoRoot}} merge --ff-only <commit>` instead.\n      3. If the fast-forward fails, redo step 7 once; if it fails again, leave the group's remaining record files in `{{claimDir}}` and do not force anything.\n   8. Delete the group's remaining record files from `{{claimDir}}`.\n4. When done, call `ExitWorktree` with `action: \"remove\"`. If it refuses to remove (the worktree ends detached, so it may), first confirm your commit is on the branch (`git merge-base --is-ancestor <commit> <branch>`), then re-invoke with `discard_changes: true`.\n\n## Reconciliation\n\nThese rules bind whoever works a finding \u2014 a fork for its batch, or the coordinator for a single batch or an out-of-batch conflict. The discipline for every finding: read the actual bytes on **both** sides of a relationship before confirming or writing anything. An import or filename match proves coupling exists somewhere; it does not verify the specific claim a why makes about the other side's current logic. If you cannot point at lines on both sides that make the sentence true, you have not confirmed it. Never clear a finding just to make the exit code pass.\n\n**Stale anchors** \u2014 read the current bytes at the anchor and `git span history <name>`; state in one sentence whether the recorded relationship still holds, then:\n\n| Finding | Action |\n|---|---|\n| Bytes shifted, meaning intact | `git span remove <name> '<path>#L<old>'` then `add` the new extent |\n| Content changed, relationship holds | `git span add <name> '<path>#L<same>'` (re-anchors) |\n| Anchored content no longer expresses the relationship | `git span remove <name> '<path>#L<N>'` |\n| Relationship gone entirely | `git span delete <name>` |\n| Anchored file deleted | Drop that anchor if the rest still holds; delete the span if not |\n| Span has no why | `git span why <name> -m \"<one sentence>\"` |\n\nIf the two sides now contradict each other, or you cannot confirm the relationship either way, the finding is leave-for-human: the coordinator leaves that record's file in `{{claimDir}}` (a fork reports the verdict; it does not touch `{{claimDir}}`). You never edit source files.\n\n**Related spans** \u2014 extend with a written path or prune an anchor only when the span's why truthfully covers the result; don't grow a span past what its why describes.\n\n**Uncovered writes** \u2014 before running `git span add`, check whether a type, schema, import, or test already enforces the coupling (the skill's \"Should this be a span?\" section is the gate); only create a span once that check comes up empty. A source file and its own test, or files already joined by an import, need no span. Most uncovered writes correctly produce nothing \u2014 needing no span is the normal outcome, not a failure. When you do create one: `git span add <slug> <anchors>` plus a why \u2014 one present-tense sentence in role words naming the relationship, still true after either side is rewritten.\n\nWork in the background and do not report unless something needs human intervention.\n";

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
  const spanDir = resolveSpanRoot(repoRoot);
  const absSpan = nodePath2.resolve(repoRoot, spanDir);
  return nodePath2.join(absSpan, LOG_FILE_NAME);
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
  if (branch === null) {
    log.info(`promote: HEAD is detached, skipping promotion of ${files.length} record(s)`);
    return;
  }
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
      log.info(`promote: promoted ${file} (${record.anchors.length} anchors, branch=${branch})`);
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
function buildAgentPrompt(repoRoot, spanDir, postCommitDirAbs, claimDirAbs) {
  let prompt = agent_prompt_default;
  prompt = prompt.replace(/\{\{repoRoot\}\}/g, repoRoot);
  prompt = prompt.replace(/\{\{spanDir\}\}/g, spanDir);
  prompt = prompt.replace(/\{\{postCommitDir\}\}/g, postCommitDirAbs);
  prompt = prompt.replace(/\{\{claimDir\}\}/g, claimDirAbs);
  return prompt.trimEnd();
}
var AGENT_TIMEOUT_MS = 15 * 60 * 1e3;
var SIGTERM_GRACE_MS = 1e4;
function buildClaudeArgs(repoRoot, spanDir, claimId) {
  const postCommitDirAbs = postCommitDir(repoRoot);
  const claimDirAbs = claimDirFor(repoRoot, claimId);
  const promptText = buildAgentPrompt(repoRoot, spanDir, postCommitDirAbs, claimDirAbs);
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
async function spawnAgent(log, repoRoot, spanDir, claimId, timeoutMs = AGENT_TIMEOUT_MS) {
  const claudeArgs = buildClaudeArgs(repoRoot, spanDir, claimId);
  log.info(`spawn: launching agent (claim ${claimId})`);
  const agentLogPath = nodePath2.resolve(repoRoot, spanDir, `agent-${claimId}.log`);
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
function manualRunMarkerPath(repoRoot, spanDir) {
  return nodePath2.join(nodePath2.resolve(repoRoot, spanDir), MANUAL_RUN_MARKER_NAME);
}
function shellQuoteSingle(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function writeManualDispatchScript(log, repoRoot, spanDir, claimId, now) {
  const claudeArgs = buildClaudeArgs(repoRoot, spanDir, claimId);
  const spanDirAbs = nodePath2.resolve(repoRoot, spanDir);
  const claimDirAbs = claimDirFor(repoRoot, claimId);
  const datetimeStamp = now.toISOString().replace(/[:.]/g, "-");
  const scriptPath = nodePath2.join(spanDirAbs, `manual-hook-dispatch-${datetimeStamp}.sh`);
  const quotedCommand = ["claude", ...claudeArgs].map(shellQuoteSingle).join(" \\\n  ");
  const script = [
    "#!/bin/sh",
    `# git-span manual dispatch script -- generated ${now.toISOString()}`,
    "#",
    `# Claim directory: ${claimDirAbs}`,
    `# Span directory:  ${spanDirAbs}`,
    "#",
    "# The claim directory above was already reserved for this run and is left",
    "# in place until this script is executed -- running it launches the same",
    "# self-claiming, self-landing reconciler agent the dispatcher would have",
    "# spawned automatically. If left unrun for too long, a future dispatcher",
    "# invocation may reclaim the (still-empty) claim directory as abandoned.",
    "",
    "# Resolve the repo root from this script's own location on disk (it",
    "# lives under the span directory, which is always inside the repo)",
    "# rather than hardcoding the path this script happened to be generated",
    "# for -- the script stays runnable even if the repo is moved, cloned",
    "# elsewhere, or renamed.",
    'script_dir=$(cd "$(dirname "$0")" && pwd -P) || exit 1',
    'repo_root=$(cd "$script_dir" && git rev-parse --show-toplevel) || exit 1',
    'cd "$repo_root" || exit 1',
    `exec ${quotedCommand}`,
    ""
  ].join("\n");
  fs2.mkdirSync(spanDirAbs, { recursive: true });
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
    const spanDir = resolveSpanRoot(args.repoRoot);
    if (fs2.existsSync(manualRunMarkerPath(args.repoRoot, spanDir))) {
      writeManualDispatchScript(log, args.repoRoot, spanDir, claimId, /* @__PURE__ */ new Date());
      log.info("dispatcher: manual-run marker present, skipped automatic spawn");
      return;
    }
    const exitCode = await spawnAgent(log, args.repoRoot, spanDir, claimId);
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
