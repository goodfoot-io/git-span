#!/usr/bin/env -S node --enable-source-maps
// ../../node_modules/@goodfoot/codex-hooks/dist/constants.js
var EVENTS_WITH_TEXT_OUTPUT = /* @__PURE__ */ new Set(["SessionStart", "UserPromptSubmit", "SubagentStart"]);

// ../../node_modules/@goodfoot/codex-hooks/dist/hooks.js
function attachMetadata(hookEventName, config, handler) {
  const hook = handler;
  hook.hookEventName = hookEventName;
  hook.timeout = config.timeout;
  hook.statusMessage = config.statusMessage;
  if ("matcher" in config && typeof config.matcher === "string") {
    hook.matcher = config.matcher;
  }
  return hook;
}
function stopHook(config, handler) {
  return attachMetadata("Stop", config, handler);
}

// ../../node_modules/@goodfoot/codex-hooks/dist/logger.js
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
var DEFAULT_LOG_ENV_VAR = "CODEX_HOOKS_LOG_FILE";
var Logger = class {
  handlers = /* @__PURE__ */ new Map();
  fileInitialized = false;
  logFileFd = null;
  logFilePath = null;
  currentHookType;
  currentInput;
  constructor(config = {}) {
    this.logFilePath = config.logFilePath ?? process.env[config.logEnvVar ?? DEFAULT_LOG_ENV_VAR] ?? null;
  }
  setContext(hookType, input) {
    this.currentHookType = hookType;
    this.currentInput = input;
  }
  clearContext() {
    this.currentHookType = void 0;
    this.currentInput = void 0;
  }
  on(level, handler) {
    const existing = this.handlers.get(level) ?? /* @__PURE__ */ new Set();
    existing.add(handler);
    this.handlers.set(level, existing);
    return () => {
      existing.delete(handler);
      if (existing.size === 0) {
        this.handlers.delete(level);
      }
    };
  }
  debug(message, context) {
    this.emit("debug", message, context);
  }
  info(message, context) {
    this.emit("info", message, context);
  }
  warn(message, context) {
    this.emit("warn", message, context);
  }
  error(message, context) {
    this.emit("error", message, context);
  }
  logError(error, message, context) {
    this.emit("error", `${message}: ${error instanceof Error ? error.message : String(error)}`, context);
  }
  close() {
    if (this.logFileFd !== null) {
      closeSync(this.logFileFd);
      this.logFileFd = null;
    }
  }
  emit(level, message, context) {
    const event = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      hookType: this.currentHookType,
      message,
      ...this.currentInput !== void 0 ? { input: this.currentInput } : {},
      ...context !== void 0 ? { context } : {}
    };
    this.writeToFile(event);
    this.handlers.get(level)?.forEach((handler) => {
      handler(event);
    });
  }
  writeToFile(event) {
    if (this.logFilePath === null) {
      return;
    }
    if (!this.fileInitialized) {
      this.fileInitialized = true;
      const logDir = dirname(this.logFilePath);
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      this.logFileFd = openSync(this.logFilePath, "a");
    }
    if (this.logFileFd !== null) {
      writeSync(this.logFileFd, `${JSON.stringify(event)}
`);
    }
  }
};
var logger = new Logger();

// ../../node_modules/@goodfoot/codex-hooks/dist/outputs.js
var EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  BLOCK: 2
};
var BlockError = class extends Error {
  reason;
  constructor(reason) {
    super(reason);
    this.name = "BlockError";
    this.reason = reason;
  }
};
function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0));
}
function buildOutput(type, stdout, stderr) {
  return {
    _type: type,
    stdout: omitUndefined(stdout),
    ...stderr !== void 0 ? { stderr } : {}
  };
}
function userPromptSubmitOutput(options = {}) {
  const hookSpecificOutput = options.additionalContext !== void 0 ? {
    hookEventName: "UserPromptSubmit",
    additionalContext: options.additionalContext
  } : void 0;
  return buildOutput("UserPromptSubmit", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    decision: options.decision,
    reason: options.reason,
    hookSpecificOutput
  });
}
function sessionStartOutput(options = {}) {
  const hookSpecificOutput = options.additionalContext !== void 0 ? {
    hookEventName: "SessionStart",
    additionalContext: options.additionalContext
  } : void 0;
  return buildOutput("SessionStart", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    hookSpecificOutput
  });
}
function subagentStartOutput(options = {}) {
  const hookSpecificOutput = options.additionalContext !== void 0 ? {
    hookEventName: "SubagentStart",
    additionalContext: options.additionalContext
  } : void 0;
  return buildOutput("SubagentStart", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    hookSpecificOutput
  });
}

// ../../node_modules/@goodfoot/codex-hooks/dist/runtime.js
async function readStdin() {
  return new Promise((resolve3, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve3(chunks.join("")));
    process.stdin.on("error", reject);
  });
}
function parseStdinInput(stdinContent) {
  return JSON.parse(stdinContent);
}
function writeStdout(output) {
  process.stdout.write(JSON.stringify(output.stdout));
}
function normalizeStringOutput(hookEventName, result) {
  if (!EVENTS_WITH_TEXT_OUTPUT.has(hookEventName)) {
    throw new Error(`${hookEventName} hooks cannot return plain text`);
  }
  if (hookEventName === "SessionStart") {
    return sessionStartOutput({ additionalContext: result });
  }
  if (hookEventName === "SubagentStart") {
    return subagentStartOutput({ additionalContext: result });
  }
  return userPromptSubmitOutput({ additionalContext: result });
}
function convertToHookOutput(output) {
  return output.stderr !== void 0 ? { stdout: output.stdout, stderr: output.stderr } : { stdout: output.stdout };
}
async function execute(hookFn) {
  try {
    const stdinContent = await readStdin();
    const input = parseStdinInput(stdinContent);
    logger.setContext(hookFn.hookEventName, input);
    const context = { logger };
    const result = await hookFn(input, context);
    let output = { stdout: {} };
    if (typeof result === "string") {
      output = convertToHookOutput(normalizeStringOutput(hookFn.hookEventName, result));
    } else if (result !== void 0) {
      output = convertToHookOutput(result);
    }
    writeStdout(output);
    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    if (error instanceof BlockError) {
      process.stderr.write(`${error.reason}
`);
      process.exit(EXIT_CODES.BLOCK);
    }
    if (error instanceof Error) {
      process.stderr.write(`${error.stack ?? error.message}
`);
    } else {
      process.stderr.write(`${String(error)}
`);
    }
    process.exit(EXIT_CODES.ERROR);
  } finally {
    logger.clearContext();
    logger.close();
  }
}

// src/common/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
function toPosix(p) {
  return p.replace(/\\/g, "/");
}
var PORCELAIN_STATUSES = [
  "FRESH",
  "RESOLVED_PENDING_COMMIT",
  "MOVED",
  "CHANGED",
  "DELETED",
  "CONFLICT",
  "SUBMODULE",
  "LFS_NOT_FETCHED",
  "LFS_NOT_INSTALLED",
  "PROMISOR_MISSING",
  "SPARSE_EXCLUDED",
  "FILTER_FAILED",
  "IO_ERROR"
];
var PORCELAIN_STATUS_SET = new Set(PORCELAIN_STATUSES);
function sanitizeSessionId(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, (ch) => {
    return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  });
}
var SNAPSHOTS_DIR = "snapshots";
var TOMBSTONE_SUFFIX = ".tombstone.json";
var OBJECT_DIR_SUFFIX = ".objects";
var TEMP_INDEX_SUFFIX = ".index";
var RECORD_SUFFIX = ".json";
function createSessionLayout(base) {
  const dir = (sessionId) => nodePath.join(base, sanitizeSessionId(sessionId));
  const snapshotsDir = (sessionId) => nodePath.join(dir(sessionId), SNAPSHOTS_DIR);
  const callFile = (sessionId, toolUseId, suffix) => nodePath.join(snapshotsDir(sessionId), `${sanitizeSessionId(toolUseId)}${suffix}`);
  const isTombstoneName = (name) => name.endsWith(TOMBSTONE_SUFFIX);
  return Object.freeze({
    base,
    trashDir: nodePath.join(nodePath.dirname(base), "session-trash"),
    dir,
    snapshotsDir,
    recordFile: (sessionId, toolUseId) => callFile(sessionId, toolUseId, RECORD_SUFFIX),
    objectDir: (sessionId, toolUseId) => callFile(sessionId, toolUseId, OBJECT_DIR_SUFFIX),
    tempIndexFile: (sessionId, toolUseId) => callFile(sessionId, toolUseId, TEMP_INDEX_SUFFIX),
    tombstoneFile: (sessionId, toolUseId) => callFile(sessionId, toolUseId, TOMBSTONE_SUFFIX),
    memoFile: (sessionId) => nodePath.join(dir(sessionId), "touch-memo.json"),
    recordlessNoteFile: (sessionId) => nodePath.join(dir(sessionId), "snapshot-recordless-note"),
    isTombstoneName,
    isRecordName: (name) => name.endsWith(RECORD_SUFFIX) && !isTombstoneName(name),
    callStem: (name) => {
      for (const suffix of [TOMBSTONE_SUFFIX, RECORD_SUFFIX, OBJECT_DIR_SUFFIX, TEMP_INDEX_SUFFIX]) {
        if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
      }
      return null;
    },
    callFiles: (snapshots, stem) => ({
      record: nodePath.join(snapshots, `${stem}${RECORD_SUFFIX}`),
      tombstone: nodePath.join(snapshots, `${stem}${TOMBSTONE_SUFFIX}`),
      objectDir: nodePath.join(snapshots, `${stem}${OBJECT_DIR_SUFFIX}`),
      tempIndexFile: nodePath.join(snapshots, `${stem}${TEMP_INDEX_SUFFIX}`)
    })
  });
}
var DEFAULT_SESSION_LAYOUT = createSessionLayout(
  nodePath.join(os.homedir(), ".cache", "git-span", "session")
);
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
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

// src/common/snapshot-store.ts
import {
  chmodSync,
  existsSync as existsSync2,
  mkdirSync as mkdirSync4,
  readdirSync as readdirSync2,
  readFileSync,
  renameSync as renameSync2,
  rmSync as rmSync2,
  statSync as statSync2,
  utimesSync as utimesSync2,
  writeFileSync as writeFileSync2
} from "node:fs";
import { basename as basename2, dirname as dirname3, join as join3 } from "node:path";

// src/common/snapshot-core.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync as mkdirSync3, writeFileSync } from "node:fs";
import { isAbsolute as isAbsolute2, join as join2, relative, resolve as resolve2, sep } from "node:path";
var DEFAULT_SNAPSHOT_BUDGETS = {
  preSideMaxWallSeconds: 1,
  maxStorageBytes: 64 * 1024 * 1024,
  maxTouchedFiles: 100,
  postSideWallSeconds: 5,
  recordTtlMs: 24 * 60 * 60 * 1e3,
  unfinishedEntryTtlMs: 15 * 60 * 1e3
};

// src/common/snapshot-store.ts
var SNAPSHOT_INDEX_DIR = "snapshot-index";
var ACTIVITY_LOG_DIR = "activity-log";
function indexDir(repoRoot) {
  return join3(queueRoot(repoRoot), SNAPSHOT_INDEX_DIR);
}
function indexFile(repoRoot, sessionId, toolUseId) {
  return join3(indexDir(repoRoot), `${sanitizeSessionId(sessionId)}__${sanitizeSessionId(toolUseId)}.json`);
}
function activityDir(repoRoot) {
  return join3(queueRoot(repoRoot), ACTIVITY_LOG_DIR);
}
var SWEEP_READ_MARGIN_MS = 5e3;
var TRASH_TTL_MS = 6e4;
var TRASH_MARKER = ".trash-";
function isTrashName(name) {
  return name.startsWith(".") && name.includes(TRASH_MARKER);
}
function trashFile(file) {
  try {
    const trashPath = join3(dirname3(file), `.${basename2(file)}${TRASH_MARKER}${process.pid}-${Date.now().toString(36)}`);
    renameSync2(file, trashPath);
    try {
      const now = Date.now() / 1e3;
      utimesSync2(trashPath, now, now);
    } catch (err) {
      void err;
    }
    return "trashed";
  } catch (err) {
    return err.code === "ENOENT" ? "absent" : "failed";
  }
}
function isRecentlyWritten(file, now) {
  try {
    return statSync2(file).mtimeMs > now - SWEEP_READ_MARGIN_MS;
  } catch {
    return false;
  }
}
function emptyTrash(dir, now) {
  for (const name of listDir(dir)) {
    if (!isTrashName(name)) continue;
    const file = join3(dir, name);
    let mtimeMs;
    try {
      mtimeMs = statSync2(file).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < now - TRASH_TTL_MS) rmSync2(file, { recursive: true, force: true });
  }
}
function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
function recordReviver(key, value) {
  if (key === "mtimeNs" && typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      return value;
    }
  }
  return value;
}
function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function writeJsonAtomic(file, data, replacer) {
  const dir = dirname3(file);
  mkdirSync4(dir, { recursive: true, mode: 448 });
  chmodSync(dir, 448);
  chmodSync(dirname3(dir), 448);
  const tmp = join3(
    dir,
    `.${basename2(file)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`
  );
  try {
    writeFileSync2(tmp, JSON.stringify(data, replacer), { mode: 384 });
    chmodSync(tmp, 384);
    renameSync2(tmp, file);
  } catch (err) {
    rmSync2(tmp, { force: true });
    throw err;
  }
}
function fileSize(file) {
  try {
    return statSync2(file).size;
  } catch {
    return 0;
  }
}
function dirSizeBytes(dir) {
  let total = 0;
  let names;
  try {
    names = readdirSync2(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const entry = join3(dir, name);
    let st;
    try {
      st = statSync2(entry);
    } catch {
      continue;
    }
    total += st.isDirectory() ? dirSizeBytes(entry) : st.size;
  }
  return total;
}
function listDir(dir) {
  try {
    return readdirSync2(dir);
  } catch {
    return [];
  }
}
function readRecordFile(file, logger2) {
  if (!existsSync2(file)) return null;
  const data = readJsonFile(file);
  if (data === null) {
    logger2.warn(`snapshot store: unreadable record file ${file}, treated as absent`);
    return null;
  }
  if (typeof data !== "object" || data === null || data.version !== 2) {
    logger2.warn(`snapshot store: incompatible record version in ${file}, treated as absent`);
    return null;
  }
  return JSON.parse(JSON.stringify(data, bigintReplacer), recordReviver);
}
function readTombstoneFile(file, logger2) {
  const data = readJsonFile(file);
  if (data === null) return null;
  if (typeof data !== "object" || data === null || data.version !== 1) {
    logger2.warn(`snapshot store: incompatible tombstone version in ${file}, treated as absent`);
    return null;
  }
  return data;
}
function readIndexEntries(repoRoot, logger2) {
  const out = [];
  for (const name of listDir(indexDir(repoRoot))) {
    if (!name.endsWith(".json")) continue;
    const data = readJsonFile(join3(indexDir(repoRoot), name));
    if (data === null || typeof data !== "object" || data === null) continue;
    const version = data.version;
    if (version !== void 0 && version !== 1) {
      logger2.warn(`snapshot store: incompatible index version in ${name}, excluded`);
      continue;
    }
    out.push(data);
  }
  return out;
}
function readActivityEntry(file) {
  const data = readJsonFile(file);
  if (data === null || typeof data !== "object" || data === null) return null;
  const version = data.version;
  if (version !== void 0 && version !== 1) return null;
  return data;
}
function createSnapshotStore(logger2, budgets = DEFAULT_SNAPSHOT_BUDGETS, layout = DEFAULT_SESSION_LAYOUT) {
  const recordFile = (sessionId, toolUseId) => layout.recordFile(sessionId, toolUseId);
  const tombstoneFile = (sessionId, toolUseId) => layout.tombstoneFile(sessionId, toolUseId);
  function tombstoneExists(sessionId, toolUseId) {
    try {
      statSync2(tombstoneFile(sessionId, toolUseId));
      return true;
    } catch {
      return false;
    }
  }
  function repoRecordBytes(repoRoot) {
    let total = 0;
    for (const entry of readIndexEntries(repoRoot, logger2)) {
      total += fileSize(recordFile(entry.sessionId, entry.toolUseId));
      total += dirSizeBytes(layout.objectDir(entry.sessionId, entry.toolUseId));
      total += fileSize(layout.tempIndexFile(entry.sessionId, entry.toolUseId));
    }
    return total;
  }
  function writeIndexEntry(repoRoot, entry) {
    writeJsonAtomic(indexFile(repoRoot, entry.sessionId, entry.toolUseId), { ...entry, version: 1 });
  }
  function removeIndexEntry(repoRoot, sessionId, toolUseId) {
    if (trashFile(indexFile(repoRoot, sessionId, toolUseId)) === "failed") {
      logger2.warn(`snapshot store: index entry cleanup failed for ${repoRoot}`);
    }
  }
  function reapForeignRecord(dir, name, parsed) {
    const stem = layout.callStem(name) ?? name;
    const siblings = layout.callFiles(dir, stem);
    trashFile(join3(dir, name));
    trashFile(siblings.tombstone);
    trashFile(siblings.objectDir);
    trashFile(siblings.tempIndexFile);
    const repoRoot = parsed?.repoRoot;
    const sessionId = parsed?.sessionId;
    const toolUseId = parsed?.toolUseId;
    if (typeof repoRoot === "string" && typeof sessionId === "string" && typeof toolUseId === "string") {
      removeIndexEntry(repoRoot, sessionId, toolUseId);
    }
    logger2.info?.("git-span snapshot sweep reaped an incompatible or unreadable record", {
      file: join3(dir, name)
    });
  }
  function writeRecord(record) {
    writeJsonAtomic(recordFile(record.sessionId, record.toolUseId), record, bigintReplacer);
  }
  function reposFromRecords() {
    const repos = /* @__PURE__ */ new Set();
    for (const sessionName of listDir(layout.base)) {
      const dir = layout.snapshotsDir(sessionName);
      for (const name of listDir(dir)) {
        if (!layout.isRecordName(name)) continue;
        const file = join3(dir, name);
        if (isRecentlyWritten(file, Date.now())) continue;
        const rec = readRecordFile(file, logger2);
        if (rec !== null) repos.add(rec.repoRoot);
      }
    }
    return repos;
  }
  function pruneStaleActivity(now, repos) {
    let removed = 0;
    for (const repo of repos) {
      try {
        for (const name of listDir(activityDir(repo))) {
          if (!name.endsWith(".json")) continue;
          const file = join3(activityDir(repo), name);
          if (isRecentlyWritten(file, now)) continue;
          const entry = readActivityEntry(file);
          if (entry === null) continue;
          let mtimeMs;
          try {
            mtimeMs = statSync2(file).mtimeMs;
          } catch {
            continue;
          }
          const ttlMs = entry.finishedAt !== null ? budgets.recordTtlMs : budgets.unfinishedEntryTtlMs;
          if (mtimeMs < now - ttlMs) {
            trashFile(file);
            removed += 1;
          }
        }
      } catch (e) {
        logger2.warn(`snapshot store: activity prune skipped ${repo}: ${String(e)}`);
      }
    }
    return removed;
  }
  function sweepOrphanIndexes(_now, repos) {
    let removed = 0;
    for (const repo of repos) {
      try {
        for (const name of listDir(indexDir(repo))) {
          if (!name.endsWith(".json")) continue;
          const file = join3(indexDir(repo), name);
          if (isRecentlyWritten(file, _now)) continue;
          const data = readJsonFile(file);
          if (data === null || typeof data !== "object" || data === null) continue;
          const version = data.version;
          if (version !== void 0 && version !== 1) continue;
          const entry = data;
          const recFile = recordFile(entry.sessionId, entry.toolUseId);
          if (!isRecentlyWritten(recFile, _now) && readRecordFile(recFile, logger2) === null) {
            trashFile(file);
            removed += 1;
          }
        }
      } catch (e) {
        logger2.warn(`snapshot store: orphan-index sweep skipped ${repo}: ${String(e)}`);
      }
    }
    return removed;
  }
  function runSweep(now, extraRepos) {
    const result = { records: 0, tombstones: 0, activityEntries: 0, indexEntries: 0, foreignRecords: 0 };
    const repos = new Set(extraRepos);
    for (const sessionName of listDir(layout.base)) {
      const dir = layout.snapshotsDir(sessionName);
      const names = listDir(dir);
      for (const name of names) {
        if (!layout.isTombstoneName(name)) continue;
        const file = join3(dir, name);
        if (isRecentlyWritten(file, now)) continue;
        const t = readTombstoneFile(file, logger2);
        if (t === null) continue;
        if (now - t.consumedAt > budgets.recordTtlMs) {
          const siblings = layout.callFiles(dir, layout.callStem(name) ?? name);
          const recordPath = siblings.record;
          const rec = isRecentlyWritten(recordPath, now) ? null : readRecordFile(recordPath, logger2);
          trashFile(recordPath);
          trashFile(file);
          trashFile(siblings.objectDir);
          trashFile(siblings.tempIndexFile);
          if (rec !== null) removeIndexEntry(rec.repoRoot, rec.sessionId, rec.toolUseId);
          result.tombstones += 1;
        }
      }
      for (const name of names) {
        if (!layout.isRecordName(name)) continue;
        const file = join3(dir, name);
        if (isRecentlyWritten(file, now)) continue;
        const data = readJsonFile(file);
        const parsed = data !== null && typeof data === "object" ? data : null;
        if (parsed === null) {
          let mtimeMs;
          try {
            mtimeMs = statSync2(file).mtimeMs;
          } catch {
            continue;
          }
          if (now - mtimeMs > budgets.recordTtlMs) {
            reapForeignRecord(dir, name, parsed);
            result.foreignRecords += 1;
          }
          continue;
        }
        if (parsed.version !== 2) {
          reapForeignRecord(dir, name, parsed);
          result.foreignRecords += 1;
          continue;
        }
        const rec = readRecordFile(file, logger2);
        if (rec === null) continue;
        repos.add(rec.repoRoot);
        if (now - rec.createdAt > budgets.recordTtlMs) {
          trashFile(file);
          trashFile(tombstoneFile(rec.sessionId, rec.toolUseId));
          trashFile(layout.objectDir(rec.sessionId, rec.toolUseId));
          trashFile(layout.tempIndexFile(rec.sessionId, rec.toolUseId));
          removeIndexEntry(rec.repoRoot, rec.sessionId, rec.toolUseId);
          result.records += 1;
        }
      }
      for (const name of names) {
        if (!name.endsWith(".objects") && !name.endsWith(".index")) continue;
        const stem = layout.callStem(name);
        if (stem === null) continue;
        const file = join3(dir, name);
        if (existsSync2(layout.callFiles(dir, stem).record)) continue;
        if (isRecentlyWritten(file, now)) continue;
        let mtimeMs;
        try {
          mtimeMs = statSync2(file).mtimeMs;
        } catch {
          continue;
        }
        if (now - mtimeMs > budgets.recordTtlMs) trashFile(file);
      }
      emptyTrash(dir, now);
    }
    result.activityEntries = pruneStaleActivity(now, repos);
    result.indexEntries = sweepOrphanIndexes(now, repos);
    for (const repo of repos) {
      try {
        emptyTrash(activityDir(repo), now);
        emptyTrash(indexDir(repo), now);
      } catch (e) {
        logger2.warn(`snapshot store: trash pass skipped ${repo}: ${String(e)}`);
      }
    }
    return result;
  }
  return {
    layout,
    write(record) {
      const swept = runSweep(Date.now(), [record.repoRoot]);
      const removed = swept.records + swept.tombstones + swept.activityEntries + swept.indexEntries + swept.foreignRecords;
      if (removed > 0) {
        logger2.info?.("git-span snapshot sweep removed expired state", {
          records: swept.records,
          tombstones: swept.tombstones,
          activityEntries: swept.activityEntries,
          indexEntries: swept.indexEntries,
          foreignRecords: swept.foreignRecords
        });
      }
      const repo = record.repoRoot;
      const json = JSON.stringify(record, bigintReplacer);
      const total = repoRecordBytes(repo) + Buffer.byteLength(json, "utf8");
      if (total > budgets.maxStorageBytes) {
        logger2.warn(
          `snapshot store: refusing to persist ${record.toolUseId}: repo storage ${total} bytes exceeds maxStorageBytes ${budgets.maxStorageBytes}; nothing was dropped`
        );
        return false;
      }
      writeRecord(record);
      writeIndexEntry(repo, {
        sessionId: record.sessionId,
        toolUseId: record.toolUseId,
        createdAt: record.createdAt,
        consumed: false,
        consumedAt: null
      });
      return true;
    },
    find(sessionId, toolUseId) {
      if (tombstoneExists(sessionId, toolUseId)) return "tombstoned";
      return readRecordFile(recordFile(sessionId, toolUseId), logger2);
    },
    consume(sessionId, toolUseId, post) {
      if (tombstoneExists(sessionId, toolUseId)) return null;
      const rec = readRecordFile(recordFile(sessionId, toolUseId), logger2);
      if (rec === null) return null;
      const consumedAt = Date.now();
      if (!this.tombstone(sessionId, toolUseId, consumedAt)) return null;
      const consumed = { ...rec, post, consumed: true, consumedAt };
      writeRecord(consumed);
      const indexData = readJsonFile(indexFile(rec.repoRoot, sessionId, toolUseId));
      if (indexData !== null && typeof indexData === "object") {
        writeIndexEntry(rec.repoRoot, {
          sessionId,
          toolUseId,
          createdAt: indexData.createdAt,
          consumed: true,
          consumedAt
        });
      }
      return consumed;
    },
    tombstone(sessionId, toolUseId, consumedAt) {
      const file = tombstoneFile(sessionId, toolUseId);
      const dir = dirname3(file);
      mkdirSync4(dir, { recursive: true, mode: 448 });
      chmodSync(dir, 448);
      chmodSync(dirname3(dir), 448);
      try {
        writeFileSync2(file, JSON.stringify({ version: 1, toolUseId, consumedAt }), { flag: "wx", mode: 384 });
        return true;
      } catch {
        return false;
      }
    },
    listRepoRecords(repoRoot) {
      return readIndexEntries(repoRoot, logger2);
    },
    sweep(now = Date.now()) {
      return runSweep(now, []);
    },
    removeSession(sessionId, agentId) {
      const dir = layout.snapshotsDir(sessionId);
      const repos = /* @__PURE__ */ new Set();
      let recordsRemoved = 0;
      for (const name of listDir(dir)) {
        if (!layout.isRecordName(name)) continue;
        const data = readJsonFile(join3(dir, name));
        const parsed = data !== null && typeof data === "object" ? data : null;
        if (parsed === null || parsed.version !== 2) {
          if (agentId === void 0) {
            reapForeignRecord(dir, name, parsed);
            recordsRemoved += 1;
          }
          continue;
        }
        const rec = readRecordFile(join3(dir, name), logger2);
        if (rec === null) continue;
        if (agentId !== void 0 && rec.agentId !== agentId) continue;
        repos.add(rec.repoRoot);
        trashFile(join3(dir, name));
        trashFile(tombstoneFile(rec.sessionId, rec.toolUseId));
        trashFile(layout.objectDir(rec.sessionId, rec.toolUseId));
        trashFile(layout.tempIndexFile(rec.sessionId, rec.toolUseId));
        removeIndexEntry(rec.repoRoot, rec.sessionId, rec.toolUseId);
        recordsRemoved += 1;
      }
      for (const repo of reposFromRecords()) repos.add(repo);
      let activityRemoved = 0;
      for (const repo of repos) {
        try {
          for (const name of listDir(activityDir(repo))) {
            if (!name.endsWith(".json")) continue;
            const entry = readActivityEntry(join3(activityDir(repo), name));
            if (entry !== null && entry.sessionId === sessionId && (agentId === void 0 || entry.agentId === agentId)) {
              trashFile(join3(activityDir(repo), name));
              activityRemoved += 1;
            }
          }
        } catch (e) {
          logger2.warn(`snapshot store: activity cleanup skipped ${repo}: ${String(e)}`);
        }
      }
      if (recordsRemoved + activityRemoved > 0) {
        logger2.info?.("git-span session cleanup removed snapshot state", {
          sessionId,
          agentId: agentId ?? null,
          records: recordsRemoved,
          activityEntries: activityRemoved
        });
      }
    }
  };
}

// src/codex/stop.ts
function createHandler(layout = DEFAULT_SESSION_LAYOUT) {
  return async (input, ctx) => {
    try {
      createSnapshotStore(ctx.logger, void 0, layout).removeSession(input.session_id);
      return void 0;
    } catch (err) {
      ctx.logger.warn("git-span stop cleanup failed open on an uncaught error", { err });
      return void 0;
    }
  };
}
var stop_default = stopHook({ timeout: 1e4 }, createHandler());

// src/codex/stop-entry.ts
execute(stop_default);
