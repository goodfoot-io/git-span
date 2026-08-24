#!/usr/bin/env -S node --enable-source-maps
// src/codex/static-plan.ts
import { resolve as resolvePath4 } from "node:path";

// ../../node_modules/@goodfoot/codex-hooks/dist/constants.js
var EVENTS_WITH_TEXT_OUTPUT = /* @__PURE__ */ new Set(["SessionStart", "UserPromptSubmit", "SubagentStart"]);

// ../../node_modules/@goodfoot/codex-hooks/dist/hooks.js
function attachMetadata(hookEventName, config, handler) {
  const hook = handler;
  hook.hookEventName = hookEventName;
  hook.timeout = config.timeout;
  hook.statusMessage = config.statusMessage;
  hook.unexpectedError = config.unexpectedError;
  hook.onUnexpectedError = config.onUnexpectedError;
  if ("matcher" in config && typeof config.matcher === "string") {
    hook.matcher = config.matcher;
  }
  return hook;
}
function preToolUseHook(config, handler) {
  return attachMetadata("PreToolUse", config, handler);
}
function postToolUseHook(config, handler) {
  return attachMetadata("PostToolUse", config, handler);
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
function preToolUseOutput(options = {}) {
  const hasSpecific = options.additionalContext !== void 0 || options.permissionDecision !== void 0 || options.permissionDecisionReason !== void 0 || options.updatedInput !== void 0;
  const hookSpecificOutput = hasSpecific ? omitUndefined({
    hookEventName: "PreToolUse",
    additionalContext: options.additionalContext,
    permissionDecision: options.permissionDecision,
    permissionDecisionReason: options.permissionDecisionReason,
    updatedInput: options.updatedInput
  }) : void 0;
  return buildOutput("PreToolUse", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    decision: options.decision,
    reason: options.reason,
    hookSpecificOutput
  });
}
function postToolUseOutput(options = {}) {
  const hasSpecific = options.additionalContext !== void 0 || options.updatedMCPToolOutput !== void 0;
  const hookSpecificOutput = hasSpecific ? omitUndefined({
    hookEventName: "PostToolUse",
    additionalContext: options.additionalContext,
    updatedMCPToolOutput: options.updatedMCPToolOutput
  }) : void 0;
  return buildOutput("PostToolUse", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    decision: options.decision,
    reason: options.reason,
    hookSpecificOutput
  });
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
var EMPTY_OUTPUT = { stdout: {} };
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
function serializeStdout(output) {
  return JSON.stringify(output.stdout);
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
function writeStderr(error) {
  if (error instanceof Error) {
    process.stderr.write(`${error.stack ?? error.message}
`);
  } else {
    process.stderr.write(`${String(error)}
`);
  }
}
function reportUnexpectedError(onUnexpectedError, error, phase) {
  try {
    onUnexpectedError?.(error, phase);
  } catch {
  }
  try {
    logger.logError(error, `Unexpected error in ${phase} phase (fail-open)`, { phase });
  } catch {
  }
}
function cleanup(policy, onUnexpectedError) {
  try {
    logger.clearContext();
    logger.close();
  } catch (error) {
    if (policy !== "continue") {
      throw error;
    }
    reportUnexpectedError(onUnexpectedError, error, "cleanup");
  }
}
async function execute(hookFn) {
  const policy = hookFn.unexpectedError ?? "error";
  const onUnexpectedError = hookFn.onUnexpectedError;
  let phase = "read";
  let output;
  try {
    const stdinContent = await readStdin();
    phase = "parse";
    const input = parseStdinInput(stdinContent);
    logger.setContext(hookFn.hookEventName, input);
    const context = { logger };
    phase = "handler";
    const result = await hookFn(input, context);
    phase = "serialize";
    if (typeof result === "string") {
      output = convertToHookOutput(normalizeStringOutput(hookFn.hookEventName, result));
    } else if (result !== void 0) {
      output = convertToHookOutput(result);
    } else {
      output = EMPTY_OUTPUT;
    }
    serializeStdout(output);
  } catch (error) {
    if (error instanceof BlockError) {
      cleanup(policy, onUnexpectedError);
      process.stderr.write(`${error.reason}
`);
      process.exit(EXIT_CODES.BLOCK);
    }
    if (policy !== "continue") {
      cleanup(policy, onUnexpectedError);
      writeStderr(error);
      process.exit(EXIT_CODES.ERROR);
    }
    reportUnexpectedError(onUnexpectedError, error, phase);
    output = EMPTY_OUTPUT;
  }
  phase = "write";
  try {
    process.stdout.write(serializeStdout(output));
  } catch (error) {
    if (policy !== "continue") {
      cleanup(policy, onUnexpectedError);
      writeStderr(error);
      process.exit(EXIT_CODES.ERROR);
    }
    reportUnexpectedError(onUnexpectedError, error, "write");
  }
  cleanup(policy, onUnexpectedError);
  process.exit(EXIT_CODES.SUCCESS);
}

// src/common/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
function toPosix(p) {
  return p.replace(/\\/g, "/");
}
function isAbsolutePosix(p) {
  return p.startsWith("/") || /^[A-Za-z]:\//.test(p);
}
function abspathAgainst(base, target) {
  const t = toPosix(target);
  if (isAbsolutePosix(t)) return t;
  const b = toPosix(base).replace(/\/+$/, "");
  return `${b}/${t}`;
}
var repoRootCache = /* @__PURE__ */ new Map();
function resolveRepoRoot(dir) {
  if (!dir) return null;
  const cached = repoRootCache.get(dir);
  if (cached !== void 0) return cached;
  const resolved = resolveRepoRootUncached(dir);
  repoRootCache.set(dir, resolved);
  return resolved;
}
function resolveRepoRootUncached(dir) {
  try {
    let current = fs.realpathSync.native(dir);
    for (; ; ) {
      if (fs.existsSync(nodePath.join(current, ".git"))) return toPosix(current);
      const parent = nodePath.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
  }
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? toPosix(trimmed) : null;
  } catch {
    return null;
  }
}
var SPAN_ROOT = ".span";
var spanRootCache = /* @__PURE__ */ new Map();
function resolveSpanRoot(repoRoot) {
  const cached = spanRootCache.get(repoRoot);
  if (cached !== void 0) return cached;
  const resolved = resolveSpanRootUncached(repoRoot);
  spanRootCache.set(repoRoot, resolved);
  return resolved;
}
function resolveSpanRootUncached(repoRoot) {
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
function isInsideSpanRoot(repoRelPath, spanRoot = SPAN_ROOT) {
  const root = spanRoot.replace(/\/+$/, "");
  return repoRelPath === root || repoRelPath.startsWith(`${root}/`);
}
function isGitIgnored(repoRoot, repoRelPath) {
  try {
    execFileSync("git", ["-C", repoRoot, "check-ignore", "-q", "--", repoRelPath], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch (err) {
    void err;
    return false;
  }
}
function relativeToRepo(repoRoot, absPath) {
  const root = toPosix(repoRoot);
  const abs = toPosix(absPath);
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
}
function canonicalizePath(absPath) {
  try {
    return toPosix(fs.realpathSync.native(absPath));
  } catch {
    try {
      const dir = toPosix(fs.realpathSync.native(nodePath.dirname(absPath)));
      return `${dir}/${nodePath.basename(absPath)}`;
    } catch {
      return absPath;
    }
  }
}
function resolveFrame(workdir, directory) {
  if (workdir === void 0 || workdir.length === 0 || /[$`]/.test(workdir)) return directory;
  return nodePath.resolve(directory, workdir);
}
function rangesIntersect(a, b) {
  return a.start <= b.end && a.end >= b.start;
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
function parsePorcelainStatus(raw) {
  return PORCELAIN_STATUS_SET.has(raw) ? raw : null;
}
function isDebt(status) {
  switch (status) {
    case "FRESH":
    case "MOVED":
    case "RESOLVED_PENDING_COMMIT":
      return false;
    default:
      return true;
  }
}
function humanStatusLabel(status) {
  return status.toLowerCase().replace(/_/g, " ");
}
function isEnvironmentalStatus(status) {
  switch (status) {
    case "CONFLICT":
    case "SUBMODULE":
    case "LFS_NOT_FETCHED":
    case "LFS_NOT_INSTALLED":
    case "PROMISOR_MISSING":
    case "SPARSE_EXCLUDED":
    case "FILTER_FAILED":
    case "IO_ERROR":
      return true;
    default:
      return false;
  }
}
function parseDriftPorcelain(stdout) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("	");
    if (parts.length < 6) continue;
    const [statusCol, , name, path, startCol, endCol] = parts;
    const status = parsePorcelainStatus(statusCol);
    if (!status) continue;
    const start = startCol === "(whole)" ? 0 : parseInt(startCol, 10);
    const end = endCol === "-" ? 0 : parseInt(endCol, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    rows.push({ name, path, start, end, status });
  }
  return rows;
}
function sanitizeSessionId(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, (ch) => {
    return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  });
}
function createSessionLayout(base) {
  const dir = (sessionId) => nodePath.join(base, sanitizeSessionId(sessionId));
  const plannedTouchesDir = (sessionId) => nodePath.join(dir(sessionId), "planned-touches");
  const plannedTouchFile = (sessionId, toolUseId, suffix) => nodePath.join(plannedTouchesDir(sessionId), `${sanitizeSessionId(toolUseId)}${suffix}`);
  return Object.freeze({
    base,
    trashDir: nodePath.join(nodePath.dirname(base), "session-trash"),
    dir,
    memoFile: (sessionId) => nodePath.join(dir(sessionId), "touch-memo.json"),
    plannedTouchesDir,
    plannedTouchRecordFile: (sessionId, toolUseId) => plannedTouchFile(sessionId, toolUseId, ".json"),
    plannedTouchConsumedFile: (sessionId, toolUseId) => plannedTouchFile(sessionId, toolUseId, ".consumed")
  });
}
var DEFAULT_SESSION_LAYOUT = createSessionLayout(
  nodePath.join(os.homedir(), ".cache", "git-span", "session")
);
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
var SESSION_TRASH_TTL_MS = 6e4;
var SESSION_TRASH_MARKER = ".trash-session-";
function pruneStaleSessions(layout, now = Date.now(), maxAgeMs = THIRTY_DAYS_MS) {
  try {
    for (const entry of fs.readdirSync(layout.trashDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.includes(SESSION_TRASH_MARKER)) continue;
      const trashPath = nodePath.join(layout.trashDir, entry.name);
      try {
        const stat = fs.statSync(trashPath);
        if (now - stat.mtimeMs > SESSION_TRASH_TTL_MS) {
          fs.rmSync(trashPath, { recursive: true, force: true });
        }
      } catch (err) {
        void err;
      }
    }
  } catch (err) {
    void err;
  }
  let entries;
  try {
    entries = fs.readdirSync(layout.base, { withFileTypes: true });
  } catch {
    return;
  }
  let trashDirReady = false;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = nodePath.join(layout.base, entry.name);
    try {
      const stat = fs.statSync(dirPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        if (!trashDirReady) {
          fs.mkdirSync(layout.trashDir, { recursive: true, mode: 448 });
          trashDirReady = true;
        }
        const trashPath = nodePath.join(
          layout.trashDir,
          `${entry.name}${SESSION_TRASH_MARKER}${process.pid}-${Date.now().toString(36)}`
        );
        fs.renameSync(dirPath, trashPath);
        fs.utimesSync(trashPath, now / 1e3, now / 1e3);
      }
    } catch (err) {
      void err;
    }
  }
}
var PRUNE_THROTTLE_WINDOW_MS = SESSION_TRASH_TTL_MS;
var lastOpportunisticPruneAt = Number.NEGATIVE_INFINITY;
function pruneStaleSessionsThrottled(layout, now = Date.now()) {
  if (now - lastOpportunisticPruneAt < PRUNE_THROTTLE_WINDOW_MS) return;
  lastOpportunisticPruneAt = now;
  pruneStaleSessions(layout, now);
}
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
function advisorMemoDir(repoRoot) {
  return nodePath.join(queueRoot(repoRoot), "advisor");
}
function indentBlockBody(text) {
  return text.split("\n").map((line) => line.length > 0 ? `  ${line}` : line).join("\n");
}

// src/common/bash-attribution.ts
import { createHash as createHash2 } from "node:crypto";
import * as fs6 from "node:fs";
import * as nodePath5 from "node:path";

// src/common/span-surface.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import * as fs3 from "node:fs";
import * as nodePath3 from "node:path";

// src/common/span-ignore.ts
import * as fs2 from "node:fs";
import * as nodePath2 from "node:path";
var HOOK_IGNORE_REL = nodePath2.join(".span", ".hookignore");
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}
function ancestorPaths(path) {
  const parts = path.split("/");
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(parts.slice(0, i + 1).join("/"));
  }
  return out;
}
function compilePattern(pattern) {
  let pat = pattern;
  let dirOnly = false;
  if (pat.endsWith("/")) {
    dirOnly = true;
    pat = pat.slice(0, -1);
  }
  let anchored = pat.includes("/");
  if (pat.startsWith("/")) {
    anchored = true;
    pat = pat.slice(1);
  }
  const re = globToRegExp(pat);
  return (repoRelPath) => {
    if (anchored) {
      const segs = ancestorPaths(repoRelPath);
      const candidates2 = dirOnly ? segs.slice(0, -1) : segs;
      return candidates2.some((s) => re.test(s));
    }
    const components = repoRelPath.split("/");
    const candidates = dirOnly ? components.slice(0, -1) : components;
    return candidates.some((c) => re.test(c));
  };
}

// src/common/span-surface.ts
function createDiskMemoStore(logger2, layout) {
  return {
    getSurfaced(sessionId) {
      pruneStaleSessionsThrottled(layout);
      try {
        const raw = fs3.readFileSync(layout.memoFile(sessionId), "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.surfaced)) {
          return new Set(parsed.surfaced);
        }
      } catch (err) {
        logger2.warn("memo read failed (treating as empty)", { err });
      }
      return /* @__PURE__ */ new Set();
    },
    addSurfaced(sessionId, names, known) {
      const existing = new Set(known);
      for (const n of names) existing.add(n);
      const memoDir = layout.dir(sessionId);
      const memoPath = layout.memoFile(sessionId);
      const tmpPath = `${memoPath}.tmp`;
      try {
        fs3.mkdirSync(memoDir, { recursive: true, mode: 448 });
        fs3.writeFileSync(tmpPath, JSON.stringify({ surfaced: [...existing] }), "utf8");
        fs3.renameSync(tmpPath, memoPath);
      } catch (err) {
        logger2.warn("memo write failed", { err });
      }
    }
  };
}
function resolveTouchScope(cwd, absPath) {
  const cwdRepoRoot = cwd ? resolveRepoRoot(cwd) : null;
  if (!cwdRepoRoot) return null;
  const absDir = toPosix(nodePath3.dirname(absPath));
  const fileRepoRoot = resolveRepoRoot(absDir);
  if (fileRepoRoot !== cwdRepoRoot) return null;
  const repoRoot = cwdRepoRoot;
  const repoRelPath = relativeToRepo(repoRoot, absPath);
  if (isGitIgnored(repoRoot, repoRelPath)) return null;
  const spanRoot = resolveSpanRoot(repoRoot);
  if (isInsideSpanRoot(repoRelPath, spanRoot)) return null;
  return { repoRoot, repoRelPath };
}

// src/common/static-attribution.ts
import { execFileSync as execFileSync4 } from "node:child_process";
import * as fs4 from "node:fs";
import * as nodePath4 from "node:path";

// src/common/parse-command.ts
import { readFileSync as readFileSync4, statSync as statSync3 } from "node:fs";
import { basename as basename2, isAbsolute as isAbsolute2, join as joinPath, resolve as resolvePath } from "node:path";

// src/common/command-resolve.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import { readFileSync as readFileSync3, statSync as statSync2 } from "node:fs";
function countFileLines(absolutePath) {
  try {
    if (!statSync2(absolutePath).isFile()) return null;
    const content = readFileSync3(absolutePath, "utf8");
    if (content.length === 0) return 0;
    const withoutTrailingNewline = content.endsWith("\n") ? content.slice(0, -1) : content;
    return withoutTrailingNewline.split("\n").length;
  } catch {
    return null;
  }
}
function countGitBlobLines(cwd, rev, path) {
  try {
    const out = execFileSync3("git", ["show", `${rev}:${path}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (out.length === 0) return 0;
    const withoutTrailingNewline = out.endsWith("\n") ? out.slice(0, -1) : out;
    return withoutTrailingNewline.split("\n").length;
  } catch {
    return null;
  }
}

// src/common/shell-split-machines.ts
function createScan(cmd) {
  return {
    cmd,
    n: cmd.length,
    i: 0,
    buf: "",
    parts: [],
    pendingOp: "start",
    listStart: 0,
    inSquote: false,
    inDquote: false,
    braceDepth: 0,
    depth: 0,
    levels: [[]],
    afterKeyword: false,
    functionSeen: false,
    nameSeen: false,
    caseRegion: null,
    heredocs: [],
    inBody: false,
    bufHeredoc: false
  };
}
var WORD_END = /[\s;&|()<>]/;
var COMMAND_OPENER_WORDS = /* @__PURE__ */ new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "time", "{", "("]);
var DANGLING_REDIRECT_WORD = /^(?:>|>>|&>|&>>|>\||<|<>|<<|<<-|<<<|>&|\d+(?:>|>>|>\||<|<>|<<|<<-|<<<|>&|<&))$/;
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function lastWord(buf) {
  return buf.trimEnd().match(/\S+$/)?.[0] ?? "";
}
function bufferEndsInDanglingRedirect(buf) {
  return DANGLING_REDIRECT_WORD.test(lastWord(buf));
}
function wordStart(buf) {
  return buf === "" || /\s$/.test(buf);
}
function commandPosition(buf) {
  return buf.trim() === "" || /\n$/.test(buf) || /[;&|()]$/.test(buf.trimEnd()) || COMMAND_OPENER_WORDS.has(lastWord(buf));
}
function fnNameShapeIsPending(buf) {
  return /^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(lastWord(buf)) || lastWord(buf) === "()";
}
function startsRedirectAt(s) {
  const c = s.cmd[s.i];
  if (c === ">" || c === "<") return true;
  if (c === "&") return s.cmd[s.i + 1] === ">";
  if (c >= "0" && c <= "9") {
    let j = s.i;
    while (j < s.n && s.cmd[j] >= "0" && s.cmd[j] <= "9") j += 1;
    return s.cmd[j] === ">" || s.cmd[j] === "<";
  }
  return false;
}
function unconsumedPipeOp(s) {
  return (s.pendingOp === "pipe" || s.pendingOp === "and" || s.pendingOp === "or") && s.buf.trim() === "";
}
function appendStage(s, nextOp) {
  const text = s.buf.trim();
  if (text) {
    if (s.pendingOp === "pipe" && (text === "!" || /^!\s/.test(text))) {
      rejectList(s, "pipe-bang");
      return;
    }
    s.parts.push({ text, precededBy: s.pendingOp, ...s.bufHeredoc ? { heredoc: true } : {} });
  }
  s.buf = "";
  s.bufHeredoc = false;
  s.pendingOp = nextOp;
}
function rejectList(s, v) {
  s.malformed = v;
  s.parts.length = s.listStart;
  s.i = s.n;
}
function stepQuote(s) {
  const c = s.cmd[s.i];
  if (s.inSquote) {
    s.buf += c;
    if (c === "'") s.inSquote = false;
    s.i += 1;
    return true;
  }
  if (s.inDquote) {
    s.buf += c;
    if (c === "\\" && s.i + 1 < s.n) {
      s.buf += s.cmd[s.i + 1];
      s.i += 2;
      return true;
    }
    if (c === '"') s.inDquote = false;
    s.i += 1;
    return true;
  }
  if (c === "'") {
    s.inSquote = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === '"') {
    s.inDquote = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === "\\" && s.i + 1 < s.n) {
    s.buf += c + s.cmd[s.i + 1];
    s.i += 2;
    return true;
  }
  return false;
}
function stepBraceContent(s) {
  if (s.braceDepth === 0) return false;
  const c = s.cmd[s.i];
  if (c === "}") s.braceDepth -= 1;
  s.buf += c;
  s.i += 1;
  return true;
}
function stepHeredocBody(s) {
  if (!s.inBody) return false;
  const lineEnd = s.cmd.indexOf("\n", s.i);
  const line = lineEnd === -1 ? s.cmd.slice(s.i) : s.cmd.slice(s.i, lineEnd);
  if (s.heredocs[0].close.test(line)) {
    s.heredocs.shift();
    if (s.heredocs.length === 0) s.inBody = false;
  }
  if (insideOpenRegion(s)) {
    s.buf += line;
    if (lineEnd !== -1) s.buf += "\n";
  }
  s.i = lineEnd === -1 ? s.n : lineEnd + 1;
  return true;
}
function stepHeredocDelimiterNewline(s) {
  if (s.cmd[s.i] !== "\n" || s.heredocs.length === 0) return false;
  if (insideOpenRegion(s)) {
    s.buf += "\n";
    s.inBody = true;
    s.i += 1;
    return true;
  }
  if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, "dangling-operator");
    return true;
  }
  appendStage(s, "newline");
  s.inBody = true;
  s.i += 1;
  return true;
}
function stepHereString(s) {
  if (s.depth !== 0) return false;
  const { i } = s;
  if (s.cmd[i] !== "<" || s.cmd[i + 1] !== "<" || s.cmd[i + 2] !== "<") return false;
  if (s.cmd[i + 3] === "<" || s.cmd[i - 1] === "<") return false;
  s.buf += "<<<";
  s.i += 3;
  return true;
}
function stepHeredocOpen(s) {
  if (s.depth !== 0) return false;
  const { i } = s;
  if (s.cmd[i] !== "<" || s.cmd[i + 1] !== "<" || s.cmd[i + 2] === "<") return false;
  const scanned = scanHeredocDelimiter(s);
  if (scanned.delim === "") return false;
  s.heredocs.push({
    close: new RegExp(`^${scanned.allowTabs ? "	*" : ""}${escapeRegExp(scanned.delim)}[ \\t]*$`)
  });
  s.bufHeredoc = true;
  if (insideOpenRegion(s)) {
    s.buf += s.cmd.slice(i, scanned.next);
  }
  s.i = scanned.next;
  return true;
}
function scanHeredocDelimiter(s) {
  let j = s.i + 2;
  let allowTabs = false;
  if (s.cmd[j] === "-") {
    allowTabs = true;
    j += 1;
  }
  while (s.cmd[j] === " " || s.cmd[j] === "	") j += 1;
  if (s.cmd[j] === "'" || s.cmd[j] === '"') {
    const q = s.cmd.indexOf(s.cmd[j], j + 1);
    if (q === -1) return { delim: s.cmd.slice(j + 1), allowTabs, next: s.n };
    return { delim: s.cmd.slice(j + 1, q), allowTabs, next: q + 1 };
  }
  const delimStart = j;
  while (j < s.n && !WORD_END.test(s.cmd[j])) j += 1;
  return { delim: s.cmd.slice(delimStart, j), allowTabs, next: j };
}
function insideOpenRegion(s) {
  return s.levels[s.levels.length - 1].length > 0 || s.caseRegion !== null;
}
function stepCaseRegion(s) {
  const r = s.caseRegion;
  if (r?.localDepth !== 0) return false;
  if (stepCasePunct(s, r)) return true;
  return stepCaseWord(s, r);
}
function stepCasePunct(s, r) {
  const c = s.cmd[s.i];
  const termLen = caseTerminatorLength(s);
  if (termLen > 0) {
    r.pos = "pattern-start";
    s.buf += s.cmd.slice(s.i, s.i + termLen);
    s.i += termLen;
    return true;
  }
  if (c === ";") {
    r.pos = "command";
    r.cmdEmpty = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (caseBareAmpersand(s)) {
    r.pos = "command";
    r.cmdEmpty = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === "\n") {
    if (r.pos === "pattern") {
      rejectList(s, "unclosed-case");
      return true;
    }
    if (r.pos === "command") r.cmdEmpty = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === "#" && wordStart(s.buf)) {
    while (s.i < s.n && s.cmd[s.i] !== "\n") s.i += 1;
    return true;
  }
  return false;
}
function caseTerminatorLength(s) {
  const three = s.cmd.slice(s.i, s.i + 3);
  if (three === ";;&") return 3;
  const two = s.cmd.slice(s.i, s.i + 2);
  return two === ";;" || two === ";&" ? 2 : 0;
}
function caseBareAmpersand(s) {
  if (s.cmd[s.i] !== "&") return false;
  return s.cmd[s.i + 1] !== ">" && s.cmd[s.i + 1] !== "&" && !bufferEndsInRedirectChar(s.buf);
}
function stepCaseWord(s, r) {
  const c = s.cmd[s.i];
  if (!wordStart(s.buf) || WORD_END.test(c)) return false;
  let j = s.i;
  while (j < s.n && !WORD_END.test(s.cmd[j])) j += 1;
  const w = s.cmd.slice(s.i, j);
  if (w === "esac" && (r.pos === "pattern-start" || r.pos === "command" && r.cmdEmpty)) {
    s.caseRegion = null;
    s.afterKeyword = false;
  } else if (w === "in" && r.pos === "subject") {
    r.pos = "pattern-start";
  } else if (r.pos === "pattern-start") {
    r.pos = "pattern";
  } else if (r.pos === "command") {
    r.cmdEmpty = false;
  }
  s.buf += w;
  s.i = j;
  return true;
}
function bufferEndsInRedirectChar(buf) {
  const last = buf[buf.length - 1];
  return last === ">" || last === "<";
}
function stepParen(s) {
  const c = s.cmd[s.i];
  if (c !== "(" && c !== ")") return false;
  if (c === "(") {
    if (s.caseRegion) {
      s.caseRegion.localDepth += 1;
    } else {
      markEnclosingBraceBody(s);
      s.depth += 1;
      s.levels.push([]);
    }
    s.afterKeyword = false;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (s.caseRegion) {
    if (s.caseRegion.localDepth === 0) {
      s.caseRegion.pos = "command";
      s.caseRegion.cmdEmpty = true;
    } else {
      s.caseRegion.localDepth -= 1;
    }
  } else {
    if (s.depth === 0) {
      rejectList(s, "unbalanced-paren");
      return true;
    }
    if (s.levels[s.levels.length - 1].length > 0) {
      rejectList(s, "unclosed-construct");
      return true;
    }
    s.depth -= 1;
    s.levels.pop();
  }
  s.buf += c;
  s.i += 1;
  return true;
}
function stepConstructWord(s) {
  if (!startsConstructWord(s)) return false;
  let j = s.i;
  while (j < s.n && !WORD_END.test(s.cmd[j])) j += 1;
  const w = s.cmd.slice(s.i, j);
  const top = topFrame(s.levels);
  const atCommand = commandPosition(s.buf);
  if (forSelectSeparator(w, top)) {
  } else if (opensBraceGroup(s, w, atCommand)) {
    openBraceGroup(s);
  } else if (w === "}" && atCommand) {
    closeBraceGroup(s);
  } else if (atCommand) {
    if (!applyCommandKeyword(s, w)) ordinaryConstructWord(s);
  } else {
    ordinaryArgumentWord(s);
  }
  s.buf += w;
  s.i = j;
  return true;
}
function forSelectSeparator(w, top) {
  return w === "in" && top !== void 0 && (top.kind === "for" || top.kind === "select");
}
function opensBraceGroup(s, w, atCommand) {
  return w === "{" && (atCommand || fnNameShapeIsPending(s.buf) || s.functionSeen && s.nameSeen);
}
function startsConstructWord(s) {
  if (s.caseRegion) return false;
  const c = s.cmd[s.i];
  if (WORD_END.test(c)) return false;
  if (!wordStart(s.buf) && !/[()]$/.test(s.buf)) return false;
  return !(c === "$" && s.cmd[s.i + 1] === "{");
}
function pushConstruct(s, kind) {
  markEnclosingBraceBody(s);
  s.levels[s.levels.length - 1].push({ kind, body: false });
  s.afterKeyword = true;
}
function requireTopOf(s, kinds, requireBody) {
  const t = topFrame(s.levels);
  if (t === void 0 || !kinds.includes(t.kind) || requireBody && !t.body) {
    rejectList(s, "unclosed-construct");
    return null;
  }
  return t;
}
function closeConstruct(s, kinds) {
  if (requireTopOf(s, kinds, true) === null) return;
  s.levels[s.levels.length - 1].pop();
  s.afterKeyword = false;
}
function openBraceGroup(s) {
  if (s.functionSeen && s.nameSeen) {
    s.functionSeen = false;
    s.nameSeen = false;
  }
  pushConstruct(s, "brace");
}
function closeBraceGroup(s) {
  const t = topFrame(s.levels);
  if (s.afterKeyword || t === void 0 || t.kind !== "brace" || !t.body) {
    rejectList(s, "unclosed-construct");
    return;
  }
  s.levels[s.levels.length - 1].pop();
  s.afterKeyword = false;
}
function requireIfBranch(s) {
  if (requireTopOf(s, ["if"], true) !== null) s.afterKeyword = true;
}
var CONSTRUCT_KEYWORDS = /* @__PURE__ */ new Map([
  [
    "case",
    (s) => {
      s.caseRegion = { pos: "subject", cmdEmpty: false, localDepth: 0 };
      s.afterKeyword = false;
    }
  ],
  [
    "function",
    (s) => {
      s.functionSeen = true;
      s.nameSeen = false;
      s.afterKeyword = false;
    }
  ],
  ["if", (s) => pushConstruct(s, "if")],
  ["while", (s) => pushConstruct(s, "loop")],
  ["until", (s) => pushConstruct(s, "loop")],
  ["for", (s) => pushConstruct(s, "for")],
  ["select", (s) => pushConstruct(s, "select")],
  [
    "do",
    (s) => {
      const t = requireTopOf(s, ["for", "loop", "select"], false);
      if (t !== null) {
        t.body = true;
        s.afterKeyword = true;
      }
    }
  ],
  [
    "then",
    (s) => {
      const t = requireTopOf(s, ["if"], false);
      if (t !== null) {
        t.body = true;
        s.afterKeyword = true;
      }
    }
  ],
  ["else", (s) => requireIfBranch(s)],
  ["elif", (s) => requireIfBranch(s)],
  // `in` only validates the for/select frame — it arms nothing and starts no body.
  ["in", (s) => void requireTopOf(s, ["for", "select"], false)],
  ["fi", (s) => closeConstruct(s, ["if"])],
  ["done", (s) => closeConstruct(s, ["for", "loop", "select"])],
  // No open region — a stray esac is a parse error.
  ["esac", (s) => rejectList(s, "unclosed-construct")]
]);
function applyCommandKeyword(s, w) {
  const kw = CONSTRUCT_KEYWORDS.get(w);
  if (kw === void 0) return false;
  kw(s);
  return true;
}
function topFrame(levels) {
  const lv = levels[levels.length - 1];
  return lv.length > 0 ? lv[lv.length - 1] : void 0;
}
function markEnclosingBraceBody(s) {
  const t = topFrame(s.levels);
  if (t?.kind === "brace") t.body = true;
}
function ordinaryConstructWord(s) {
  s.afterKeyword = false;
  markEnclosingBraceBody(s);
  advanceFunctionNameHandoff(s);
}
function ordinaryArgumentWord(s) {
  s.afterKeyword = false;
  advanceFunctionNameHandoff(s);
}
function advanceFunctionNameHandoff(s) {
  if (!s.functionSeen) return;
  if (s.nameSeen) {
    s.functionSeen = false;
    s.nameSeen = false;
  } else {
    s.nameSeen = true;
  }
}
function rejectEmptyConstructList(s) {
  const c = s.cmd[s.i];
  if (s.caseRegion === null && s.levels[s.levels.length - 1].length > 0 && (c === ";" || c === "&") && s.afterKeyword) {
    rejectList(s, "unclosed-construct");
    return true;
  }
  return false;
}
function skipTopLevelComment(s) {
  if (s.cmd[s.i] !== "#" || s.depth !== 0 || !wordStart(s.buf)) return false;
  while (s.i < s.n && s.cmd[s.i] !== "\n") s.i += 1;
  return true;
}
function stepRedirectToken(s) {
  if (s.depth !== 0) return false;
  const c = s.cmd[s.i];
  if (wordStart(s.buf) && bufferEndsInDanglingRedirect(s.buf) && startsRedirectAt(s)) {
    rejectList(s, "dangling-operator");
    return true;
  }
  if (c === "$" && s.cmd[s.i + 1] === "{") {
    s.braceDepth += 1;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (stepHereString(s)) return true;
  return stepHeredocOpen(s);
}
function stepBoundaryOperator(s) {
  if (s.depth !== 0) return false;
  if (s.caseRegion !== null) return false;
  if (s.levels[s.levels.length - 1].length > 0) return false;
  const c = s.cmd[s.i];
  const twoOp = TWO_CHAR_BOUNDARY_OPS.get(s.cmd.slice(s.i, s.i + 2));
  if (twoOp !== void 0) {
    flushBoundaryOrReject(s, twoOp);
    s.i += 2;
    return true;
  }
  if (c === ";") {
    flushBoundaryOrReject(s, "semicolon");
    s.i += 1;
    return true;
  }
  if (c === "|") {
    flushBoundaryOrReject(s, "pipe");
    s.i += 1;
    return true;
  }
  if (c === "\n") return stepNewlineBoundary(s);
  if (c === "&") {
    if (ampersandIsRedirectText(s)) {
      s.buf += c;
      s.i += 1;
      return true;
    }
    flushBoundaryOrReject(s, "background");
    s.i += 1;
    return true;
  }
  return false;
}
var TWO_CHAR_BOUNDARY_OPS = /* @__PURE__ */ new Map([
  ["&&", "and"],
  ["||", "or"],
  ["|&", "pipe"]
]);
function stepNewlineBoundary(s) {
  if (unconsumedPipeOp(s)) {
    s.i += 1;
    return true;
  }
  if (bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, "dangling-operator");
    return true;
  }
  appendStage(s, "newline");
  s.listStart = s.parts.length;
  s.i += 1;
  return true;
}
function flushBoundaryOrReject(s, nextOp) {
  if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, "dangling-operator");
    return;
  }
  appendStage(s, nextOp);
}
function ampersandIsRedirectText(s) {
  if (s.cmd[s.i + 1] === ">") return true;
  if (s.buf[s.buf.length - 1] === "<") return true;
  const trimmed = s.buf.trimEnd();
  if (!trimmed.endsWith(">")) return false;
  const before = trimmed.length >= 2 ? trimmed[trimmed.length - 2] : "";
  return trimmed.length === 1 || /\s|\d/.test(before);
}
function finishScan(s) {
  if (s.malformed) return { stages: s.parts, malformed: s.malformed };
  if (s.inSquote || s.inDquote) {
    rejectList(s, "unclosed-quote");
  } else if (s.braceDepth > 0) {
    rejectList(s, "unclosed-brace");
  } else if (s.caseRegion !== null) {
    rejectList(s, "unclosed-case");
  } else if (s.depth > 0) {
    rejectList(s, "unbalanced-paren");
  } else if (s.levels[s.levels.length - 1].length > 0) {
    rejectList(s, "unclosed-construct");
  } else if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, "dangling-operator");
  } else if (s.inBody || s.heredocs.length > 0) {
    appendStage(s, "newline");
    s.malformed = "unterminated-heredoc";
  } else {
    appendStage(s, "newline");
  }
  return { stages: s.parts, malformed: s.malformed };
}

// src/common/shell-split.ts
function splitTopLevel(cmd) {
  const s = createScan(cmd);
  while (s.i < s.n) {
    if (stepQuote(s)) continue;
    if (stepBraceContent(s)) continue;
    if (stepHeredocBody(s)) continue;
    if (stepHeredocDelimiterNewline(s)) continue;
    if (skipTopLevelComment(s)) continue;
    if (stepCaseRegion(s)) continue;
    if (stepParen(s)) continue;
    if (stepConstructWord(s)) continue;
    if (rejectEmptyConstructList(s)) continue;
    if (stepRedirectToken(s)) continue;
    if (stepBoundaryOperator(s)) continue;
    s.buf += s.cmd[s.i];
    s.i += 1;
  }
  return finishScan(s);
}
var LEADING_ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;
function stripLeadingAssignments(simpleCmd) {
  return simpleCmd.replace(LEADING_ASSIGNMENT, "");
}
function tokenize(s) {
  const tokens = [];
  let buf = "";
  let quoted = false;
  let i = 0;
  const n = s.length;
  const flushWord = () => {
    if (buf.length === 0) return;
    tokens.push({ text: buf, quoted, isRedirect: false });
    buf = "";
    quoted = false;
  };
  const appendQuotedContent = (out, start) => {
    const quote = s[start];
    let j = start + 1;
    while (j < n) {
      const c = s[j];
      if (quote === "'") {
        if (c === "'") return { out, next: j + 1 };
        out += c;
        j += 1;
        continue;
      }
      if (c === "\\" && j + 1 < n && '"\\$`'.includes(s[j + 1])) {
        out += s[j + 1];
        j += 2;
        continue;
      }
      if (c === '"') return { out, next: j + 1 };
      out += c;
      j += 1;
    }
    return null;
  };
  const appendAttachedTarget = (out, start) => {
    let j = start;
    while (j < n) {
      const c = s[j];
      if (/\s/.test(c) || c === "<" || c === ">") return { out, next: j };
      if (c === "'" || c === '"') {
        const section = appendQuotedContent("", j);
        if (section === null) return null;
        out += s.slice(j, section.next);
        j = section.next;
        continue;
      }
      if (c === "\\" && j + 1 < n) {
        out += c + s[j + 1];
        j += 2;
        continue;
      }
      out += c;
      j += 1;
    }
    return { out, next: j };
  };
  const emitRedirect = (operator, attachedStart) => {
    const attached = appendAttachedTarget("", attachedStart);
    if (attached === null) return false;
    tokens.push({ text: buf + operator + attached.out, quoted: false, isRedirect: true });
    buf = "";
    quoted = false;
    i = attached.next;
    return true;
  };
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      flushWord();
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      quoted = true;
      const section = appendQuotedContent(buf, i);
      if (section === null) return null;
      buf = section.out;
      i = section.next;
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      quoted = true;
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "<" || c === ">") {
      if (buf !== "" && !/^\d+$/.test(buf)) flushWord();
      let operator;
      if (c === "<") {
        if (s.slice(i, i + 3) === "<<<") operator = "<<<";
        else if (s.slice(i, i + 3) === "<<-") operator = "<<-";
        else if (s.slice(i, i + 2) === "<<") operator = "<<";
        else operator = "<";
      } else {
        operator = s.slice(i, i + 2) === ">>" ? ">>" : ">";
      }
      if (!emitRedirect(operator, i + operator.length)) return null;
      continue;
    }
    if (c === "&") {
      if (s[i + 1] === ">") {
        flushWord();
        const operator = s.slice(i, i + 3) === "&>>" ? "&>>" : "&>";
        if (!emitRedirect(operator, i + operator.length)) return null;
        continue;
      }
      buf += c;
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  flushWord();
  return tokens;
}
function redirectAttachedTarget(text) {
  const match = text.match(/^(\d*)(<<<|<<-|&>>|<<|>>|&>|>&|<|>)(.*)$/);
  if (match === null) return null;
  const [, , , rest] = match;
  return rest.length > 0 ? rest : null;
}
function argvOf(simpleCmd) {
  const tokens = tokenize(stripLeadingAssignments(simpleCmd).trim());
  if (tokens === null) return null;
  const argv = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.isRedirect) {
      argv.push(token.text);
      continue;
    }
    if (redirectAttachedTarget(token.text) === null) i += 1;
  }
  return argv;
}
function hasUnquotedRedirect(simpleCmd) {
  let inSquote = false;
  let inDquote = false;
  for (let i = 0; i < simpleCmd.length; i++) {
    const c = simpleCmd[i];
    if (inSquote) {
      if (c === "'") inSquote = false;
      continue;
    }
    if (inDquote) {
      if (c === "\\" && i + 1 < simpleCmd.length && '"\\$`'.includes(simpleCmd[i + 1])) {
        i += 1;
      } else if (c === '"') {
        inDquote = false;
      }
      continue;
    }
    if (c === "'") {
      inSquote = true;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      continue;
    }
    if (c === "\\" && i + 1 < simpleCmd.length) {
      i += 1;
      continue;
    }
    if (c === "<") return true;
  }
  return false;
}

// src/common/unified-diff.ts
var HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
function stripPathComponents(p, n) {
  let s = p;
  for (let i = 0; i < n; i++) {
    const slash = s.indexOf("/");
    if (slash === -1) return s;
    s = s.slice(slash + 1);
  }
  return s;
}
function stripLevelFor(raw, strip) {
  return strip === "auto" ? raw.startsWith("a/") || raw.startsWith("b/") ? 1 : 0 : strip;
}
function headerPathText(raw) {
  const tab = raw.indexOf("	");
  return tab === -1 ? raw : raw.slice(0, tab);
}
function parseUnifiedDiffRange(patchText, strip) {
  const results = [];
  let sawBlock = false;
  let current = null;
  let pendingKind = null;
  let renameFrom = null;
  let renameTo = null;
  let binary = false;
  const stripped = (raw) => {
    const text = headerPathText(raw);
    if (text === "/dev/null") return text;
    return stripPathComponents(text, stripLevelFor(text, strip));
  };
  const finish = () => {
    if (current !== null) {
      if (current.kind === "new") results.push({ path: current.path, operation: "create-overwrite" });
      else if (current.kind === "deleted") results.push({ path: current.path, operation: "delete" });
      else if (binary) results.push({ path: current.path, operation: "modify" });
      else if (current.hunks.length === 0) {
      } else if (current.countChanging) results.push({ path: current.path, operation: "modify" });
      else {
        const start = Math.min(...current.hunks.map((h) => h.start));
        const end = Math.max(...current.hunks.map((h) => h.end));
        results.push({ path: current.path, operation: "modify", lineStart: start, lineEnd: end });
      }
      current = null;
    }
    if (renameFrom !== null) results.push({ path: renameFrom, operation: "delete" });
    if (renameTo !== null) results.push({ path: renameTo, operation: "rename-copy" });
    renameFrom = null;
    renameTo = null;
    binary = false;
  };
  for (const rawLine of patchText.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("--- ")) {
      sawBlock = true;
      if (current !== null) finish();
      current = {
        path: stripped(line.slice(4)),
        kind: pendingKind ?? "modify",
        hunks: [],
        countChanging: false
      };
      pendingKind = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      sawBlock = true;
      const path = stripped(line.slice(4));
      if (current === null) current = { path, kind: pendingKind ?? "modify", hunks: [], countChanging: false };
      else if (path === "/dev/null") current.kind = "deleted";
      else if (current.path === "/dev/null") {
        current.path = path;
        current.kind = "new";
      }
      pendingKind = null;
      continue;
    }
    if (line.startsWith("new file mode")) {
      pendingKind = "new";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      pendingKind = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      sawBlock = true;
      if (current !== null) finish();
      renameFrom = stripped(line.slice("rename from ".length));
      continue;
    }
    if (line.startsWith("rename to ")) {
      sawBlock = true;
      renameTo = stripped(line.slice("rename to ".length));
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      sawBlock = true;
      binary = true;
      continue;
    }
    const hunk = line.match(HUNK_HEADER);
    if (hunk) {
      sawBlock = true;
      const preStart = Number.parseInt(hunk[1], 10);
      const preCount = hunk[2] === void 0 ? 1 : Number.parseInt(hunk[2], 10);
      const postCount = hunk[4] === void 0 ? 1 : Number.parseInt(hunk[4], 10);
      if (current === null) return null;
      if (preCount !== postCount) current.countChanging = true;
      if (preCount > 0) current.hunks.push({ start: preStart, end: preStart + preCount - 1 });
    }
  }
  finish();
  return sawBlock ? results : null;
}

// src/common/parse-command.ts
function resolveSpec(spec, totalLines) {
  switch (spec.kind) {
    case "literal":
      return { lineStart: spec.start, lineEnd: spec.end };
    case "upperBoundFromStart": {
      const total = totalLines();
      return { lineStart: 1, lineEnd: total !== null ? Math.min(spec.end, total) : spec.end };
    }
    case "toEof": {
      const total = totalLines();
      if (total === null || total === 0) return null;
      return { lineStart: spec.start, lineEnd: Math.max(spec.start, total) };
    }
    case "lastNLines": {
      const total = totalLines();
      if (total === null || total === 0) return null;
      return { lineStart: Math.max(1, total - spec.count + 1), lineEnd: total };
    }
    case "appendLines": {
      const total = totalLines() ?? 0;
      return { lineStart: total + 1, lineEnd: total + spec.count };
    }
  }
}
function hasShellExpansion(s) {
  return /[$`]/.test(s);
}
function looksUnresolvable(s) {
  return hasShellExpansion(s) || /[*?]/.test(s);
}
var SED_RANGE = /^(\d+)(?:,(\d+|\$))?p$/;
function sedScriptSegments(script) {
  return script.split(";");
}
function matchSed(argv) {
  if (argv[0] !== "sed") return [];
  const rest = argv.slice(1);
  if (!rest.includes("-n")) return [];
  let scriptIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "-n") continue;
    if (sedScriptSegments(rest[i]).some((seg) => SED_RANGE.test(seg))) {
      scriptIdx = i;
      break;
    }
  }
  if (scriptIdx === -1) return [];
  const fileCandidates = rest.filter((a, i) => i !== scriptIdx && a !== "-n" && !a.startsWith("-"));
  if (fileCandidates.length !== 1) return [];
  const fileArg = fileCandidates[0];
  const results = [];
  for (const segment of sedScriptSegments(rest[scriptIdx])) {
    const match = segment.match(SED_RANGE);
    if (!match) continue;
    const start = Number.parseInt(match[1], 10);
    const endToken = match[2];
    const spec = endToken === void 0 ? { kind: "literal", start, end: start } : endToken === "$" ? { kind: "toEof", start } : { kind: "literal", start, end: Number.parseInt(endToken, 10) };
    results.push({ kind: "candidate", idiom: "sed-n-range", fileArg, spec, resolverKind: "fs" });
  }
  return results;
}
function parseHeadTailFlags(rest, barePlusIsCount) {
  const files = [];
  let count = null;
  let fromStart = false;
  let disqualified = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "-f" || a === "-F" || a === "--follow" || a.startsWith("--follow=")) {
      disqualified = true;
      continue;
    }
    if (a === "-z" || a === "--zero-terminated") {
      disqualified = true;
      continue;
    }
    if (a === "-c" || a === "--bytes") {
      disqualified = true;
      i += 1;
      continue;
    }
    if (/^(-c|--bytes=)/.test(a)) {
      disqualified = true;
      continue;
    }
    if (a === "-q" || a === "-v" || a === "--quiet" || a === "--silent" || a === "--verbose") continue;
    if (a === "-n") {
      const v = rest[i + 1];
      if (v !== void 0 && /^\+?\d+$/.test(v)) {
        fromStart = v.startsWith("+");
        count = Number.parseInt(v.replace("+", ""), 10);
        i += 1;
      }
      continue;
    }
    if (a.startsWith("--lines=")) {
      const v = a.slice("--lines=".length);
      if (/^\+?\d+$/.test(v)) {
        fromStart = v.startsWith("+");
        count = Number.parseInt(v.replace("+", ""), 10);
      }
      continue;
    }
    if (/^-n\+?\d+$/.test(a)) {
      const v = a.slice(2);
      fromStart = v.startsWith("+");
      count = Number.parseInt(v.replace("+", ""), 10);
      continue;
    }
    if (/^\+\d+$/.test(a)) {
      if (barePlusIsCount) {
        fromStart = true;
        count = Number.parseInt(a.slice(1), 10);
      } else {
        files.push(a);
      }
      continue;
    }
    if (/^-\d+$/.test(a)) {
      count = Number.parseInt(a.slice(1), 10);
      continue;
    }
    if (a === "-") {
      files.push(a);
      continue;
    }
    if (a.startsWith("-")) continue;
    files.push(a);
  }
  return { count, fromStart, disqualified, files };
}
function matchHead(argv) {
  if (argv[0] !== "head") return [];
  const { count, disqualified, files } = parseHeadTailFlags(argv.slice(1), false);
  if (disqualified) return [];
  const realFiles = files.filter((f) => f !== "-" && !/^\+\d+$/.test(f));
  if (realFiles.length === 0) return [];
  const n = count ?? 10;
  return realFiles.map((fileArg) => ({
    kind: "candidate",
    idiom: "head-file",
    fileArg,
    spec: { kind: "upperBoundFromStart", end: n },
    resolverKind: "fs"
  }));
}
function matchTail(argv) {
  if (argv[0] !== "tail") return [];
  const { count, fromStart, disqualified, files } = parseHeadTailFlags(argv.slice(1), true);
  if (disqualified) return [];
  const realFiles = files.filter((f) => f !== "-");
  if (realFiles.length === 0) return [];
  const n = count ?? 10;
  const spec = fromStart ? { kind: "toEof", start: n } : { kind: "lastNLines", count: n };
  return realFiles.map((fileArg) => ({
    kind: "candidate",
    idiom: "tail-file",
    fileArg,
    spec,
    resolverKind: "fs"
  }));
}
function findGitSubcommand(rest) {
  let cDir = null;
  let cDirUnresolvable = false;
  let i = 0;
  while (i < rest.length) {
    const a = rest[i];
    if (a === "-C") {
      const v = rest[i + 1];
      if (v === void 0) return null;
      if (hasShellExpansion(v)) cDirUnresolvable = true;
      else cDir = v;
      i += 2;
      continue;
    }
    if (a === "-c") {
      i += 2;
      continue;
    }
    if (a.startsWith("-")) {
      i += 1;
      continue;
    }
    return { subIdx: i, subcommand: a, cDir, cDirUnresolvable };
  }
  return null;
}
var REV_PATH = /^([^\s:]+):(.+)$/;
function matchGitShow(argv) {
  if (argv[0] !== "git") return [];
  const sub = findGitSubcommand(argv.slice(1));
  if (sub?.subcommand !== "show") return [];
  const after = argv.slice(1).slice(sub.subIdx + 1).filter((a) => !a.startsWith("-"));
  const revPathArg = after.find((a) => REV_PATH.test(a));
  if (!revPathArg) return [];
  const m = revPathArg.match(REV_PATH);
  if (!m) return [];
  const [, rev, path] = m;
  if (sub.cDirUnresolvable || hasShellExpansion(rev)) {
    return [
      {
        kind: "unresolved",
        idiom: "git-show-rev-path",
        fileArg: path,
        reason: "git -C target or revision contains an unresolved shell variable"
      }
    ];
  }
  return [
    {
      kind: "candidate",
      idiom: "git-show-rev-path",
      fileArg: path,
      spec: { kind: "toEof", start: 1 },
      resolverKind: { kind: "git", rev },
      dirOverride: sub.cDir ?? void 0
    }
  ];
}
function matchGitLogL(argv) {
  if (argv[0] !== "git") return [];
  const sub = findGitSubcommand(argv.slice(1));
  if (sub?.subcommand !== "log") return [];
  const after = argv.slice(1).slice(sub.subIdx + 1);
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    let spec = null;
    if (a === "-L") spec = after[i + 1] ?? null;
    else if (a.startsWith("-L")) spec = a.slice(2);
    if (!spec) continue;
    const m = spec.match(/^(\d+),(\d+):(.+)$/);
    if (!m) continue;
    const [, s, e, path] = m;
    if (sub.cDirUnresolvable) {
      return [
        {
          kind: "unresolved",
          idiom: "git-log-L",
          fileArg: path,
          reason: "git -C target contains an unresolved shell variable"
        }
      ];
    }
    return [
      {
        kind: "candidate",
        idiom: "git-log-L",
        fileArg: path,
        spec: { kind: "literal", start: Number.parseInt(s, 10), end: Number.parseInt(e, 10) },
        resolverKind: "fs",
        dirOverride: sub.cDir ?? void 0
      }
    ];
  }
  return [];
}
var BARE_DELIM = /^[A-Za-z_][A-Za-z0-9_]*$/;
function findHeredocOpener(raw, from) {
  const n = raw.length;
  let inSquote = false;
  let inDquote = false;
  let depth = 0;
  let cmdStart = from;
  let pendingPipe = false;
  let i = from;
  const readDelimWord = (start) => {
    let d = "";
    let sawQuote = false;
    let k = start;
    while (k < n && !/\s/.test(raw[k]) && raw[k] !== "<" && raw[k] !== ">") {
      const c = raw[k];
      if (c === "'" || c === '"') {
        const quote = c;
        let m = k + 1;
        while (m < n && raw[m] !== quote) {
          d += raw[m];
          m += 1;
        }
        if (m >= n) return null;
        sawQuote = true;
        k = m + 1;
        continue;
      }
      if (c === "\\" && k + 1 < n) {
        d += raw[k + 1];
        sawQuote = true;
        k += 2;
        continue;
      }
      d += c;
      k += 1;
    }
    return { delim: d, sawQuote, next: k };
  };
  while (i < n) {
    const c = raw[i];
    if (inSquote) {
      if (c === "'") inSquote = false;
      i += 1;
      continue;
    }
    if (inDquote) {
      if (c === "\\" && i + 1 < n) {
        i += 2;
        continue;
      }
      if (c === '"') inDquote = false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      i += 1;
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      i += 2;
      continue;
    }
    if (c === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (depth > 0) {
      i += 1;
      continue;
    }
    if (raw.startsWith("&&", i) || raw.startsWith("||", i)) {
      cmdStart = i + 2;
      pendingPipe = false;
      i += 2;
      continue;
    }
    if (raw.startsWith("|&", i)) {
      cmdStart = i + 1;
      pendingPipe = true;
      i += 2;
      continue;
    }
    if (c === ";") {
      cmdStart = i + 1;
      pendingPipe = false;
      i += 1;
      continue;
    }
    if (c === "|") {
      cmdStart = i + 1;
      pendingPipe = true;
      i += 1;
      continue;
    }
    if (c === "\n") {
      if (!pendingPipe) cmdStart = i + 1;
      i += 1;
      continue;
    }
    if (c === "&") {
      const trimmed = raw.slice(cmdStart, i).trimEnd();
      const dupRedirect = trimmed.endsWith(">") && (trimmed.length === 1 || /\s|\d/.test(trimmed[trimmed.length - 2] ?? ""));
      if (raw[i + 1] === ">" || dupRedirect) {
        i += 1;
        continue;
      }
      cmdStart = i + 1;
      pendingPipe = false;
      i += 1;
      continue;
    }
    if (c === "<" && raw[i + 1] === "<") {
      if (raw[i + 2] === "<") {
        i += 3;
        continue;
      }
      let j = i - 1;
      while (j >= from && /\d/.test(raw[j])) j -= 1;
      const ioNumber = j < i - 1 && (j < from || /\s|[;|&(]/.test(raw[j]));
      if (ioNumber) {
        i += 2;
        continue;
      }
      const tabStrip = raw[i + 2] === "-";
      const opLen = tabStrip ? 3 : 2;
      const lineEnd = raw.indexOf("\n", i);
      const openerLineEnd = lineEnd === -1 ? n : lineEnd;
      const attached = readDelimWord(i + opLen);
      let delim = attached === null ? "" : attached.delim;
      let sawQuote = attached === null ? false : attached.sawQuote;
      if (delim === "" && attached !== null) {
        let k = attached.next;
        while (k < openerLineEnd && /\s/.test(raw[k])) k += 1;
        const word = readDelimWord(k);
        if (word === null) delim = "";
        else {
          delim = word.delim;
          sawQuote = word.sawQuote;
        }
      }
      if (delim === "" || !sawQuote && !BARE_DELIM.test(delim)) {
        i += opLen;
        continue;
      }
      return { cmdStart, openerLineEnd, delim, tabStrip, quotedDelim: sawQuote };
    }
    i += 1;
  }
  return null;
}
function heredocCloser(raw, open) {
  const n = raw.length;
  const bodyStart = open.openerLineEnd < n ? open.openerLineEnd + 1 : n;
  let linePos = bodyStart;
  while (linePos < n) {
    const nl = raw.indexOf("\n", linePos);
    const lineEnd = nl === -1 ? n : nl;
    const candidate = open.tabStrip ? raw.slice(linePos, lineEnd).replace(/^\t+/, "") : raw.slice(linePos, lineEnd);
    if (candidate === open.delim || candidate.startsWith(open.delim) && /^[ \t]*$/.test(candidate.slice(open.delim.length))) {
      return { lineStart: linePos, lineEnd };
    }
    if (nl === -1) return null;
    linePos = nl + 1;
  }
  return null;
}
function extractHeredocWrites(raw) {
  const writes = [];
  let masked = "";
  let cursor = 0;
  for (; ; ) {
    const open = findHeredocOpener(raw, cursor);
    if (open === null) break;
    const close = heredocCloser(raw, open);
    if (close === null) {
      cursor = open.openerLineEnd < raw.length ? open.openerLineEnd + 1 : raw.length;
      continue;
    }
    const bodyStart = open.openerLineEnd < raw.length ? open.openerLineEnd + 1 : raw.length;
    let body = raw.slice(bodyStart, close.lineStart).replace(/\n$/, "");
    if (open.tabStrip) body = body.replace(/^\t+/gm, "");
    masked += raw.slice(cursor, open.cmdStart);
    masked += `__heredoc_${writes.length}__`;
    writes.push({ opener: raw.slice(open.cmdStart, open.openerLineEnd), body, quotedDelim: open.quotedDelim });
    cursor = close.lineEnd;
  }
  masked += raw.slice(cursor);
  return { writes, masked };
}
var REDIRECT_TOKEN = /^(\d*)(<<<|<<-|&>>|<<|>>|&>|>&|<|>)(.*)$/;
function classifyRedirectToken(text) {
  const m = text.match(REDIRECT_TOKEN);
  if (m === null) return null;
  const [, fdText, op, target] = m;
  return {
    fd: fdText === "" ? null : Number.parseInt(fdText, 10),
    op,
    target: target === "" ? null : target
  };
}
function isContentRedirect(r) {
  if (r.op === ">" || r.op === ">>") {
    if (r.fd !== null && r.fd !== 1) return false;
    if (r.target?.startsWith("&")) return false;
    return true;
  }
  return r.op === "&>" || r.op === "&>>";
}
function analyzeTokens(tokens) {
  const argv = [];
  const redirects = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.isRedirect) {
      argv.push(token.text);
      continue;
    }
    const info = classifyRedirectToken(token.text);
    if (info === null) {
      argv.push(token.text);
      continue;
    }
    if (info.target === null) {
      const next = tokens[i + 1];
      if (next !== void 0 && !next.isRedirect) {
        redirects.push({ ...info, target: next.text });
        i += 1;
        continue;
      }
    }
    redirects.push(info);
  }
  return { argv, redirects };
}
function literalContent(argv) {
  const host = argv[0];
  if (host !== "echo" && host !== "printf") return void 0;
  const args = argv.slice(1);
  if (args.length === 0) return void 0;
  for (const a of args) {
    if (a.startsWith("-") || hasShellExpansion(a) || /[*?]/.test(a)) return void 0;
  }
  if (host === "printf") {
    if (args.length !== 1) return void 0;
    const fmt = args[0];
    if (fmt.includes("%") || fmt.includes("\\")) return void 0;
    return fmt;
  }
  return `${args.join(" ")}
`;
}
function resolveTarget(results, idiom, target, currentDir) {
  if (looksUnresolvable(target)) {
    results.push({
      status: "unresolved",
      idiom,
      fileArg: target,
      reason: "path contains an unexpanded shell variable or glob"
    });
    return null;
  }
  return resolvePath(currentDir, target);
}
function teeOperandParts(argv) {
  let append = false;
  let afterDashDash = false;
  const operands = [];
  for (const a of argv.slice(1)) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (a === "-a" || a === "--append") {
      append = true;
      continue;
    }
    if (a.startsWith("-")) return null;
    operands.push(a);
  }
  return { append, operands };
}
function matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join9, results) {
  const parts = teeOperandParts(argv);
  if (parts === null) return;
  for (const operand of parts.operands) {
    const absolutePath = resolveTarget(results, "redirect-write", operand, currentDir);
    if (absolutePath === null) continue;
    results.push({
      status: "resolved",
      idiom: "redirect-write",
      span: !parts.append ? {
        operation: "create-overwrite",
        absolutePath,
        simpleCommandIndex,
        join: join9,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      } : {
        operation: "append",
        absolutePath,
        simpleCommandIndex,
        join: join9,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      }
    });
  }
}
function matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, simpleCommandIndex, join9, results) {
  const contentRedirects = redirects.filter(isContentRedirect);
  const host = argv[0];
  if (contentRedirects.length === 0) {
    if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join9, results);
    return;
  }
  if (host === void 0 || host === ":" || host === "exec") {
    for (const r of contentRedirects) {
      if (r.op === ">>" || r.op === "&>>" || r.target === null) continue;
      const absolutePath = resolveTarget(results, "truncate-write", r.target, currentDir);
      if (absolutePath === null) continue;
      results.push({
        status: "resolved",
        idiom: "truncate-write",
        span: { operation: "truncate", absolutePath, simpleCommandIndex, join: join9 }
      });
    }
    return;
  }
  if (host !== "echo" && host !== "printf" && host !== "tee") return;
  const singlePlainAppend = contentRedirects.length === 1 && contentRedirects[0].op === ">>";
  const singlePlainOverwrite = contentRedirects.length === 1 && contentRedirects[0].op === ">";
  const threadedAppend = singlePlainAppend && host !== "tee" ? literalContent(argv) : void 0;
  const threadedOverwrite = singlePlainOverwrite && host !== "tee" ? literalContent(argv) : void 0;
  for (const r of contentRedirects) {
    if (r.target === null) continue;
    const absolutePath = resolveTarget(results, "redirect-write", r.target, currentDir);
    if (absolutePath === null) continue;
    if (r.op === ">>" || r.op === "&>>") {
      results.push({
        status: "resolved",
        idiom: "redirect-write",
        span: {
          operation: "append",
          absolutePath,
          simpleCommandIndex,
          join: join9,
          ...threadedAppend !== void 0 ? { written: threadedAppend } : {}
        }
      });
    } else {
      results.push({
        status: "resolved",
        idiom: "redirect-write",
        span: {
          operation: "create-overwrite",
          absolutePath,
          simpleCommandIndex,
          join: join9,
          ...threadedOverwrite !== void 0 ? { written: threadedOverwrite } : {}
        }
      });
    }
  }
  if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join9, results);
}
var FOREIGN_WRAPPERS = /* @__PURE__ */ new Set(["sudo", "xargs", "nohup", "time", "nice", "doas"]);
var ASSIGNMENT_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*=/;
function stripTransparentWrapper(argv) {
  const unwrapped = argv[0] === "command" || argv[0] === "env" ? argv.slice(1) : argv;
  let i = 0;
  while (i < unwrapped.length && ASSIGNMENT_TOKEN.test(unwrapped[i])) i += 1;
  return i > 0 ? unwrapped.slice(i) : unwrapped;
}
function pushUnresolved(results, idiom, fileArg, reason) {
  results.push({ status: "unresolved", idiom, fileArg, reason });
}
function isExistingDirectory(absolutePath) {
  try {
    return statSync3(absolutePath).isDirectory();
  } catch {
    return false;
  }
}
var CP_SPEC = {
  idiom: "cp-write",
  noValue: /* @__PURE__ */ new Set(["-r", "-R", "-p", "-f", "-v", "-i", "-u", "-a", "-d", "-L", "-P"]),
  noClobber: /* @__PURE__ */ new Set(["-n", "--no-clobber"]),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory"]),
  excluded: /* @__PURE__ */ new Set(["-b", "--backup"]),
  sourceOperation: "read",
  destOperation: "create-overwrite"
};
var INSTALL_SPEC = {
  idiom: "install-write",
  noValue: /* @__PURE__ */ new Set(["-D", "-s", "-v"]),
  noClobber: /* @__PURE__ */ new Set(),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory", "-m", "-o", "-g"]),
  excluded: /* @__PURE__ */ new Set(["-d"]),
  sourceOperation: "read",
  destOperation: "create-overwrite"
};
var MV_SPEC = {
  idiom: "mv-write",
  // `mv -n` stays in noValue, not noClobber: an mv skip leaves the source in
  // place, and the delete's own absence gate then fails the touch — the
  // no-clobber blind spot is cp's byte-compare, not mv's.
  noValue: /* @__PURE__ */ new Set(["-f", "-i", "-n", "-v", "-u"]),
  noClobber: /* @__PURE__ */ new Set(),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory"]),
  excluded: /* @__PURE__ */ new Set(),
  sourceOperation: "delete",
  destOperation: "rename-copy"
};
var GIT_MV_SPEC = {
  idiom: "mv-write",
  noValue: /* @__PURE__ */ new Set(["-f", "-k", "-v"]),
  noClobber: /* @__PURE__ */ new Set(),
  valueTaking: /* @__PURE__ */ new Set(),
  // `git mv -n`/`--dry-run` is a trial run that moves nothing (the same
  // read-only class as `patch --dry-run`, plan §5.7) — fail closed.
  excluded: /* @__PURE__ */ new Set(["-n", "--dry-run"]),
  sourceOperation: "delete",
  destOperation: "rename-copy"
};
function copyMoveParts(args, spec) {
  const operands = [];
  let targetDir = null;
  let i = 0;
  let afterDashDash = false;
  while (i < args.length) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      i += 1;
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      i += 1;
      continue;
    }
    if (a === "-t" || a === "--target-directory") {
      const v = args[i + 1];
      if (v === void 0) return null;
      targetDir = v;
      i += 2;
      continue;
    }
    if (a.startsWith("--target-directory=")) {
      targetDir = a.slice("--target-directory=".length);
      i += 1;
      continue;
    }
    if (spec.excluded.has(a)) return null;
    if (spec.valueTaking.has(a)) {
      if (args[i + 1] === void 0) return null;
      i += 2;
      continue;
    }
    if (spec.noValue.has(a) || spec.noClobber.has(a)) {
      i += 1;
      continue;
    }
    if (a.startsWith("-")) {
      i += 1;
      continue;
    }
    operands.push(a);
    i += 1;
  }
  return { operands, targetDir };
}
function emitSourceSpan(results, spec, absolutePath, simpleCommandIndex, join9) {
  if (spec.sourceOperation === "delete") {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: "delete", absolutePath, simpleCommandIndex, join: join9 }
    });
    return;
  }
  const range = resolveSpec({ kind: "toEof", start: 1 }, () => countFileLines(absolutePath));
  results.push({
    status: "resolved",
    idiom: spec.idiom,
    span: range === null ? { operation: "read", absolutePath, simpleCommandIndex, join: join9 } : {
      operation: "read",
      lineStart: range.lineStart,
      lineEnd: range.lineEnd,
      absolutePath,
      simpleCommandIndex,
      join: join9
    }
  });
}
function matchCopyMoveFamily(argv, dirForResolution, simpleCommandIndex, join9, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  let spec = null;
  let args = [];
  let dir = dirForResolution;
  if (command === "cp" || command === "install" || command === "mv") {
    spec = command === "cp" ? CP_SPEC : command === "install" ? INSTALL_SPEC : MV_SPEC;
    args = rest.slice(1);
  } else if (command === "git") {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub !== null && sub.subcommand === "mv") {
      if (sub.cDirUnresolvable) {
        pushUnresolved(results, "mv-write", "mv", "git -C target contains an unresolved shell variable");
        return;
      }
      spec = GIT_MV_SPEC;
      args = rest.slice(1).slice(sub.subIdx + 1);
      dir = sub.cDir ?? dirForResolution;
    }
  } else if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    const wrappedSpec = wrapped === "cp" ? CP_SPEC : wrapped === "install" ? INSTALL_SPEC : wrapped === "mv" ? MV_SPEC : null;
    if (wrappedSpec !== null) {
      pushUnresolved(results, wrappedSpec.idiom, wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
    return;
  }
  if (spec === null) return;
  const parts = copyMoveParts(args, spec);
  if (parts === null || parts.operands.length === 0) return;
  const sourcePaths = [];
  for (const source of parts.operands.slice(0, parts.targetDir === null ? -1 : void 0)) {
    if (source.endsWith("/")) return;
    const absolutePath = resolveTarget(results, spec.idiom, source, dir);
    if (absolutePath === null) return;
    if (isExistingDirectory(absolutePath)) return;
    sourcePaths.push(absolutePath);
  }
  if (sourcePaths.length === 0) return;
  let destPaths;
  if (parts.targetDir !== null) {
    if (looksUnresolvable(parts.targetDir)) {
      pushUnresolved(results, spec.idiom, parts.targetDir, "path contains an unexpanded shell variable or glob");
      return;
    }
    if (!parts.targetDir.endsWith("/") && !isExistingDirectory(resolvePath(dir, parts.targetDir))) {
      pushUnresolved(results, spec.idiom, parts.targetDir, "the -t target is not an existing directory");
      return;
    }
    const targetAbs = resolvePath(dir, parts.targetDir);
    destPaths = sourcePaths.map((p) => joinPath(targetAbs, basename2(p)));
  } else {
    const dest = parts.operands[parts.operands.length - 1];
    if (looksUnresolvable(dest)) {
      pushUnresolved(results, spec.idiom, dest, "path contains an unexpanded shell variable or glob");
      return;
    }
    const destAbs = resolvePath(dir, dest);
    const destIsDir = dest.endsWith("/") || isExistingDirectory(destAbs);
    if (sourcePaths.length > 1 && !destIsDir) {
      pushUnresolved(results, spec.idiom, dest, "a multi-source copy/move needs a directory destination");
      return;
    }
    destPaths = destIsDir ? sourcePaths.map((p) => joinPath(destAbs, basename2(p))) : [destAbs];
  }
  for (let k = 0; k < sourcePaths.length; k++) {
    emitSourceSpan(results, spec, sourcePaths[k], simpleCommandIndex, join9);
  }
  for (let k = 0; k < sourcePaths.length; k++) {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: spec.destOperation, absolutePath: destPaths[k], simpleCommandIndex, join: join9 }
    });
  }
}
var RM_NO_VALUE = /* @__PURE__ */ new Set(["-f", "-i", "-v"]);
var RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d"]);
var GIT_RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d", "-n", "--dry-run"]);
function matchRmOperands(args, excluded, excludeCached, dir, simpleCommandIndex, join9, results) {
  let afterDashDash = false;
  const operands = [];
  for (const a of args) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (excluded.has(a) || excludeCached && a === "--cached") return;
    if (RM_NO_VALUE.has(a)) continue;
    if (a.startsWith("-")) continue;
    operands.push(a);
  }
  for (const operand of operands) {
    if (looksUnresolvable(operand)) {
      pushUnresolved(results, "rm-write", operand, "path contains an unexpanded shell variable or glob");
      continue;
    }
    if (operand.endsWith("/") || isExistingDirectory(resolvePath(dir, operand))) continue;
    results.push({
      status: "resolved",
      idiom: "rm-write",
      span: { operation: "delete", absolutePath: resolvePath(dir, operand), simpleCommandIndex, join: join9 }
    });
  }
}
function evaluateStaticSize(value) {
  if (value === void 0) return void 0;
  const m = value.match(/^(\d+)([KMG])?$/);
  if (m === null) return void 0;
  const base = Number.parseInt(m[1], 10);
  const mult = m[2] === "K" ? 1024 : m[2] === "M" ? 1024 ** 2 : m[2] === "G" ? 1024 ** 3 : 1;
  return base * mult;
}
function matchTruncateOperands(args, dir, simpleCommandIndex, join9, results) {
  let sawSizeFlag = false;
  let afterDashDash = false;
  let staticSize;
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push({ path: a, size: staticSize });
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (a === "-s") {
      sawSizeFlag = true;
      staticSize = evaluateStaticSize(args[i + 1]);
      i += 1;
      continue;
    }
    if (a === "-r") {
      sawSizeFlag = true;
      staticSize = void 0;
      i += 1;
      continue;
    }
    if (a === "-c") continue;
    if (a.startsWith("-")) continue;
    operands.push({ path: a, size: staticSize });
  }
  if (!sawSizeFlag) return;
  for (const operand of operands) {
    if (looksUnresolvable(operand.path)) {
      pushUnresolved(results, "truncate-command", operand.path, "path contains an unexpanded shell variable or glob");
      continue;
    }
    if (operand.path.endsWith("/") || isExistingDirectory(resolvePath(dir, operand.path))) continue;
    results.push({
      status: "resolved",
      idiom: "truncate-command",
      span: {
        operation: "truncate",
        absolutePath: resolvePath(dir, operand.path),
        simpleCommandIndex,
        join: join9,
        ...operand.size !== void 0 ? { size: operand.size } : {}
      }
    });
  }
}
function matchRmTruncate(argv, dirForResolution, simpleCommandIndex, join9, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "rm") {
    matchRmOperands(rest.slice(1), RM_EXCLUDED, false, dirForResolution, simpleCommandIndex, join9, results);
    return;
  }
  if (command === "truncate") {
    matchTruncateOperands(rest.slice(1), dirForResolution, simpleCommandIndex, join9, results);
    return;
  }
  if (command === "git") {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub !== null && sub.subcommand === "rm") {
      if (sub.cDirUnresolvable) {
        pushUnresolved(results, "rm-write", "rm", "git -C target contains an unresolved shell variable");
        return;
      }
      matchRmOperands(
        rest.slice(1).slice(sub.subIdx + 1),
        GIT_RM_EXCLUDED,
        true,
        sub.cDir ?? dirForResolution,
        simpleCommandIndex,
        join9,
        results
      );
    }
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === "rm" || wrapped === "truncate") {
      pushUnresolved(
        results,
        wrapped === "rm" ? "rm-write" : "truncate-command",
        wrapped,
        `the ${command} wrapper obscures the ${wrapped} argv`
      );
    }
  }
}
function heredocBodyIsLiteral(body) {
  if (body.includes("$") || body.includes("`")) return false;
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") continue;
    const next = body[i + 1];
    if (next === void 0 || next === "$" || next === "`" || next === "\\" || next === "\n") return false;
    i += 1;
  }
  return true;
}
function classifyHeredocOpener(opener, body, quotedDelim, currentDir, simpleCommandIndex, join9, results) {
  const bodyLiteral = quotedDelim || heredocBodyIsLiteral(body);
  const tokens = tokenize(stripLeadingAssignments(opener).trim());
  if (tokens === null) return;
  const { argv, redirects } = analyzeTokens(tokens);
  const host = argv[0];
  const contentRedirects = redirects.filter(isContentRedirect);
  const singlePlainAppend = contentRedirects.length === 1 && contentRedirects[0].op === ">>";
  const singlePlainOverwrite = contentRedirects.length === 1 && contentRedirects[0].op === ">";
  const emitContentRedirects = () => {
    for (const r of contentRedirects) {
      if (r.target === null) continue;
      const absolutePath = resolveTarget(results, "heredoc-write", r.target, currentDir);
      if (absolutePath === null) continue;
      if (r.op === ">>" || r.op === "&>>") {
        if (body.length === 0) continue;
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: {
            operation: "append",
            absolutePath,
            simpleCommandIndex,
            join: join9,
            ...singlePlainAppend && r.op === ">>" && bodyLiteral ? { written: body } : {}
          }
        });
      } else {
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join9 } : {
            operation: "create-overwrite",
            absolutePath,
            simpleCommandIndex,
            join: join9,
            // The exact gate compares full file bytes, so the trailing
            // `\n` the extraction stripped comes back on the overwrite.
            ...singlePlainOverwrite && bodyLiteral ? { written: `${body}
` } : {}
          }
        });
      }
    }
  };
  if (host === "cat") {
    emitContentRedirects();
    return;
  }
  if (host === "tee") {
    const parts = teeOperandParts(argv);
    if (parts !== null) {
      for (const operand of parts.operands) {
        const absolutePath = resolveTarget(results, "heredoc-write", operand, currentDir);
        if (absolutePath === null) continue;
        if (parts.append) {
          if (body.length === 0) continue;
          results.push({
            status: "resolved",
            idiom: "heredoc-write",
            span: {
              operation: "append",
              absolutePath,
              simpleCommandIndex,
              join: join9,
              ...contentRedirects.length === 0 && bodyLiteral ? { written: body } : {}
            }
          });
        } else {
          results.push({
            status: "resolved",
            idiom: "heredoc-write",
            span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join9 } : {
              operation: "create-overwrite",
              absolutePath,
              simpleCommandIndex,
              join: join9,
              // Same restored-`\n` exact body as the redirect branch; a
              // tee operand with a content redirect present keeps the
              // redirect's threading only (mirror of the append branch).
              ...contentRedirects.length === 0 && bodyLiteral ? { written: `${body}
` } : {}
            }
          });
        }
      }
    }
    emitContentRedirects();
    return;
  }
  if (host === "patch" || host === "git") {
    classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join9, results);
    return;
  }
}
var NUMERIC_SUBSTITUTION = /^(\d+)(?:,(\d+))?[sy]/;
var UNRESTRICTED_SUBSTITUTION = /^[sy]/;
function matchSedInplace(argv, dirForResolution, simpleCommandIndex, join9, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "sed") {
    matchSedInplaceArgs(rest.slice(1), dirForResolution, simpleCommandIndex, join9, results);
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === "sed") {
      pushUnresolved(results, "sed-inplace", wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
  }
}
var SED_SCRIPT_SHAPE = /^(?:[A-Za-z]|\d|\/|\\|\$|~)/;
function matchSedInplaceArgs(args, dir, simpleCommandIndex, join9, results) {
  let suffix = null;
  let sawInplace = false;
  let i = 0;
  const eScripts = [];
  const positionals = [];
  const files = [];
  let afterDashDash = false;
  while (i < args.length) {
    const a = args[i];
    if (afterDashDash) {
      positionals.push(a);
      i += 1;
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      i += 1;
      continue;
    }
    if (a === "-n") {
      i += 1;
      continue;
    }
    if (a === "-e") {
      const v = args[i + 1];
      if (v === void 0) {
        pushUnresolved(results, "sed-inplace", a, "the -e flag is left valueless");
        return;
      }
      eScripts.push(v);
      i += 2;
      continue;
    }
    if (a === "-i") {
      sawInplace = true;
      const w = args[i + 1];
      if (w === void 0) {
        i += 1;
        continue;
      }
      if (w.startsWith("-")) {
        i += 1;
        continue;
      }
      const restAfter = args.slice(i + 2);
      if (restAfter.length >= 2 && !SED_SCRIPT_SHAPE.test(w)) {
        suffix = w;
        i += 2;
        continue;
      }
      if (restAfter.length === 0) {
        files.push(w);
        i += 2;
        continue;
      }
      positionals.push(w, restAfter[0]);
      i += 3;
      continue;
    }
    if (a.startsWith("-i") && a.length > 2) {
      sawInplace = true;
      suffix = a.slice(2);
      i += 1;
      continue;
    }
    if (a.startsWith("-")) {
      i += 1;
      continue;
    }
    positionals.push(a);
    i += 1;
  }
  if (!sawInplace) return;
  const scriptArg = eScripts.length === 0 ? positionals[0] ?? null : null;
  if (scriptArg !== null) files.push(...positionals.slice(1));
  else files.push(...positionals);
  const segments = [];
  if (scriptArg !== null) segments.push(...scriptArg.split(";"));
  for (const s of eScripts) segments.push(...s.split(";"));
  if (segments.length === 0) {
    pushUnresolved(results, "sed-inplace", files[0] ?? "sed", "no script (absent or empty script argument)");
    return;
  }
  let allNumeric = true;
  let allSubstitution = true;
  let minStart = Infinity;
  let maxEnd = 0;
  for (const segment of segments) {
    const m = segment.match(NUMERIC_SUBSTITUTION);
    if (m === null) {
      allNumeric = false;
      if (!UNRESTRICTED_SUBSTITUTION.test(segment)) allSubstitution = false;
      continue;
    }
    const s = Number.parseInt(m[1], 10);
    const e = m[2] === void 0 ? s : Number.parseInt(m[2], 10);
    minStart = Math.min(minStart, s);
    maxEnd = Math.max(maxEnd, e);
  }
  for (const f of files) {
    if (looksUnresolvable(f)) {
      pushUnresolved(results, "sed-inplace", f, "path contains an unexpanded shell variable or glob");
      continue;
    }
    const absolutePath = resolvePath(dir, f);
    if (allNumeric || allSubstitution) {
      const total = countFileLines(absolutePath);
      if (total === null) {
        pushUnresolved(
          results,
          "sed-inplace",
          absolutePath,
          "could not determine end-of-file line count (file unreadable, empty, or missing)"
        );
        continue;
      }
      const start = allNumeric ? minStart : 1;
      const end = allNumeric ? Math.min(maxEnd, total) : total;
      if (start > end) continue;
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "modify", lineStart: start, lineEnd: end, absolutePath, simpleCommandIndex, join: join9 }
      });
    } else {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "modify", absolutePath, simpleCommandIndex, join: join9 }
      });
    }
    if (suffix !== null && suffix !== "") {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "create-overwrite", absolutePath: `${absolutePath}${suffix}`, simpleCommandIndex, join: join9 }
      });
    }
  }
}
function patchApplyParts(args, isGitApply) {
  let strip = isGitApply ? 1 : "auto";
  let readOnly = false;
  let cachedOnly = false;
  let directory = false;
  const operands = [];
  let afterDashDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (isGitApply) {
      if (a === "--check" || a === "--stat" || a === "--numstat" || a === "--summary") {
        readOnly = true;
        continue;
      }
      if (a === "--cached") {
        cachedOnly = true;
        continue;
      }
      if (a === "--index" || a === "-R" || a === "--reverse" || a === "--unsafe-paths" || a === "--reject") continue;
      if (a === "--directory") {
        directory = true;
        continue;
      }
      if (a.startsWith("--directory=")) {
        directory = true;
        continue;
      }
      if (a === "-p") {
        const v = args[i + 1];
        if (v !== void 0 && /^\d+$/.test(v)) {
          strip = Number.parseInt(v, 10);
          i += 1;
        }
        continue;
      }
      if (/^-p\d+$/.test(a)) {
        strip = Number.parseInt(a.slice(2), 10);
        continue;
      }
      if (a.startsWith("-")) continue;
      operands.push(a);
      continue;
    }
    if (a === "--dry-run") {
      readOnly = true;
      continue;
    }
    if (a === "-N" || a === "--forward") continue;
    if (a === "-p") {
      const v = args[i + 1];
      if (v !== void 0 && /^\d+$/.test(v)) {
        strip = Number.parseInt(v, 10);
        i += 1;
      }
      continue;
    }
    if (/^-p\d+$/.test(a)) {
      strip = Number.parseInt(a.slice(2), 10);
      continue;
    }
    if (a.startsWith("-")) continue;
    operands.push(a);
  }
  return { strip, readOnly, cachedOnly, directory, operands };
}
function readPatchFile(absolutePath) {
  try {
    return readFileSync4(absolutePath, "utf8");
  } catch {
    return null;
  }
}
function emitPatchTargets(args, isGitApply, host, targetDir, shellDir, redirects, simpleCommandIndex, join9, results) {
  const parts = patchApplyParts(args, isGitApply);
  if (parts.readOnly || parts.cachedOnly) return;
  if (parts.directory) {
    pushUnresolved(results, "patch-write", "--directory", "--directory rewrites patch paths");
    return;
  }
  let patchText = null;
  let source = null;
  if (isGitApply) {
    const operand = parts.operands.find((o) => o !== "-");
    if (operand !== void 0) {
      if (looksUnresolvable(operand)) {
        pushUnresolved(results, "patch-write", operand, "path contains an unexpanded shell variable or glob");
        return;
      }
      source = resolvePath(targetDir, operand);
      patchText = readPatchFile(source);
      if (patchText === null) {
        pushUnresolved(results, "patch-write", source, "patch file unreadable or missing");
        return;
      }
    }
  }
  if (patchText === null) {
    const stdin = redirects.find((r) => r.op === "<");
    if (stdin !== void 0 && stdin.target !== null) {
      if (looksUnresolvable(stdin.target)) {
        pushUnresolved(results, "patch-write", stdin.target, "path contains an unexpanded shell variable or glob");
        return;
      }
      source = resolvePath(shellDir, stdin.target);
      patchText = readPatchFile(source);
      if (patchText === null) {
        pushUnresolved(results, "patch-write", source, "patch text unreadable or missing");
        return;
      }
    }
  }
  if (patchText === null) {
    pushUnresolved(results, "patch-write", host, "no statically known patch text source (stdin is dynamic)");
    return;
  }
  const targets = parseUnifiedDiffRange(patchText, parts.strip);
  if (targets === null) {
    pushUnresolved(results, "patch-write", source ?? host, "malformed or empty patch text");
    return;
  }
  for (const t of targets) {
    const absolutePath = resolveTarget(results, "patch-write", t.path, targetDir);
    if (absolutePath === null) continue;
    results.push({
      status: "resolved",
      idiom: "patch-write",
      span: {
        operation: t.operation,
        absolutePath,
        simpleCommandIndex,
        join: join9,
        ...t.lineStart !== void 0 ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {}
      }
    });
  }
}
function matchPatchApply(argv, redirects, dirForResolution, simpleCommandIndex, join9, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "patch") {
    emitPatchTargets(
      rest.slice(1),
      false,
      "patch",
      dirForResolution,
      dirForResolution,
      redirects,
      simpleCommandIndex,
      join9,
      results
    );
    return;
  }
  if (command === "git") {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || sub.subcommand !== "apply") return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(results, "patch-write", "apply", "git -C target contains an unresolved shell variable");
      return;
    }
    emitPatchTargets(
      rest.slice(1).slice(sub.subIdx + 1),
      true,
      "apply",
      sub.cDir ?? dirForResolution,
      dirForResolution,
      redirects,
      simpleCommandIndex,
      join9,
      results
    );
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === "patch" || wrapped === "apply") {
      pushUnresolved(results, "patch-write", wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
  }
}
function classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join9, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  let isGitApply = false;
  let args;
  let dir = currentDir;
  if (command === "patch") {
    args = rest.slice(1);
  } else if (command === "git") {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || sub.subcommand !== "apply") return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(results, "patch-write", "apply", "git -C target contains an unresolved shell variable");
      return;
    }
    isGitApply = true;
    args = rest.slice(1).slice(sub.subIdx + 1);
    dir = sub.cDir ?? currentDir;
  } else {
    return;
  }
  const parts = patchApplyParts(args, isGitApply);
  if (parts.readOnly || parts.cachedOnly) return;
  if (parts.directory) {
    pushUnresolved(results, "patch-write", "--directory", "--directory rewrites patch paths");
    return;
  }
  const targets = parseUnifiedDiffRange(body, parts.strip);
  if (targets === null) {
    pushUnresolved(results, "patch-write", "heredoc", "malformed or empty patch text");
    return;
  }
  for (const t of targets) {
    const absolutePath = resolveTarget(results, "patch-write", t.path, dir);
    if (absolutePath === null) continue;
    results.push({
      status: "resolved",
      idiom: "patch-write",
      span: {
        operation: t.operation,
        absolutePath,
        simpleCommandIndex,
        join: join9,
        ...t.lineStart !== void 0 ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {}
      }
    });
  }
}
var FORMATTER_TABLE = [
  {
    command: "prettier",
    writeForms: [["--write"], ["-w"]],
    readOnlyForms: [["--check"], ["--list-different"], ["--debug-check"]]
  },
  { command: "eslint", writeForms: [["--fix"]], readOnlyForms: [["--fix-dry-run"]] },
  {
    command: "biome",
    writeForms: [
      ["check", "--write"],
      ["check", "--fix"],
      ["format", "--write"]
    ],
    readOnlyForms: []
  },
  { command: "gofmt", writeForms: [["-w"]], readOnlyForms: [["-l"]] },
  { command: "goimports", writeForms: [["-w"]], readOnlyForms: [] },
  { command: "clang-format", writeForms: [["-i"]], readOnlyForms: [["--dry-run"]] },
  { command: "shfmt", writeForms: [["-w"]], readOnlyForms: [["-d"]] },
  { command: "yapf", writeForms: [["-i"]], readOnlyForms: [["--diff"]] },
  { command: "autopep8", writeForms: [["-i"]], readOnlyForms: [["-d"], ["--diff"]] },
  { command: "black", writeForms: [[]], readOnlyForms: [["--check"], ["--diff"]] },
  { command: "isort", writeForms: [[]], readOnlyForms: [["--check-only"], ["--diff"]] },
  {
    command: "ruff",
    writeForms: [["format"], ["check", "--fix"]],
    readOnlyForms: [
      ["check", "--no-fix"],
      ["format", "--check"]
    ]
  },
  { command: "deno", writeForms: [["fmt"]], readOnlyForms: [["fmt", "--check"]] },
  { command: "dprint", writeForms: [["fmt"]], readOnlyForms: [["check"]] },
  { command: "rustfmt", writeForms: [[]], readOnlyForms: [["--check"], ["--emit", "stdout"]] },
  {
    command: "terraform",
    writeForms: [["fmt"]],
    readOnlyForms: [
      ["fmt", "-check"],
      ["fmt", "-diff"]
    ]
  }
];
var RUNNER_NO_ARG_FLAGS = /* @__PURE__ */ new Set(["-y", "--yes", "--no-install"]);
function stripPackageRunner(argv) {
  const runner = argv[0];
  let rest = argv.slice(1);
  if (runner === "npx" || runner === "yarn" || runner === "bunx") {
  } else if (runner === "pnpm") {
    if (rest[0] !== "exec" && rest[0] !== "dlx") return "not-runner";
    rest = rest.slice(1);
  } else if (runner === "npm") {
    if (rest[0] !== "exec") return "not-runner";
    rest = rest.slice(1);
  } else {
    return "not-runner";
  }
  while (RUNNER_NO_ARG_FLAGS.has(rest[0])) rest = rest.slice(1);
  if (runner === "npm" && rest[0] === "--") rest = rest.slice(1);
  if (rest.length === 0) return "not-runner";
  const wrapped = rest[0];
  if (wrapped.startsWith("-") || wrapped.startsWith(".") || /\s/.test(wrapped)) return { kind: "obscured" };
  return { kind: "stripped", stripped: rest };
}
function matchFormatter(argv, dirForResolution, simpleCommandIndex, join9, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  let words = rest;
  const strip = stripPackageRunner(rest);
  if (strip === "not-runner") {
  } else if (strip.kind === "obscured") {
    pushUnresolved(results, "formatter-write", rest[0], `the ${rest[0]} wrapper obscures the wrapped argv`);
    return;
  } else {
    words = strip.stripped;
  }
  if (FOREIGN_WRAPPERS.has(words[0])) {
    const wrapped = words[1];
    if (wrapped !== void 0 && FORMATTER_TABLE.some((r) => r.command === wrapped)) {
      pushUnresolved(results, "formatter-write", wrapped, `the ${words[0]} wrapper obscures the ${wrapped} argv`);
    }
    return;
  }
  const row = FORMATTER_TABLE.find((r) => r.command === words[0]);
  if (row === void 0) return;
  const args = words.slice(1);
  const formPresent = (form) => {
    const first = form[0];
    if (first !== void 0 && !first.startsWith("-") && args[0] !== first) return false;
    return form.every((token) => args.includes(token));
  };
  if (row.readOnlyForms.some(formPresent)) return;
  if (!row.writeForms.some(formPresent)) return;
  const subcommandWords = /* @__PURE__ */ new Set();
  for (const form of row.writeForms) {
    for (const token of form) {
      if (!token.startsWith("-")) subcommandWords.add(token);
    }
  }
  const afterSubcommand = subcommandWords.has(args[0]) ? args.slice(1) : args;
  let afterDashDash = false;
  const operands = [];
  for (const a of afterSubcommand) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (a.startsWith("-")) continue;
    operands.push(a);
  }
  if (operands.length === 0) return;
  for (const operand of operands) {
    if (looksUnresolvable(operand)) {
      pushUnresolved(results, "formatter-write", operand, "path contains an unexpanded shell variable or glob");
      return;
    }
    if (operand.endsWith("/") || isExistingDirectory(resolvePath(dirForResolution, operand))) return;
  }
  for (const operand of operands) {
    results.push({
      status: "resolved",
      idiom: "formatter-write",
      span: { operation: "modify", absolutePath: resolvePath(dirForResolution, operand), simpleCommandIndex, join: join9 }
    });
  }
}
var RESTORE_NO_VALUE = /* @__PURE__ */ new Set(["-q", "-f", "-u"]);
function emitRestoreCheckoutPathspec(results, idiom, operand, dir, simpleCommandIndex, join9) {
  if (looksUnresolvable(operand)) {
    pushUnresolved(results, idiom, operand, "path contains an unexpanded shell variable or glob");
    return;
  }
  const absolutePath = resolvePath(dir, operand);
  if (operand === "." || operand === ".." || operand.endsWith("/") || isExistingDirectory(absolutePath)) {
    pushUnresolved(
      results,
      idiom,
      operand,
      "directory-shaped pathspec rewrites arbitrary files beneath it \u2014 not attributable to a file write"
    );
    return;
  }
  results.push({
    status: "resolved",
    idiom,
    span: { operation: "create-overwrite", absolutePath, simpleCommandIndex, join: join9 }
  });
}
function matchRestoreOperands(args, dir, simpleCommandIndex, join9, results) {
  let staged = false;
  let worktree = false;
  let afterDashDash = false;
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (a === "-p" || a === "--patch") {
      pushUnresolved(
        results,
        "git-restore-write",
        a,
        "interactive patch mode applies user-chosen hunks \u2014 no static span"
      );
      return;
    }
    if (a === "-s" || a === "--source") {
      i += 1;
      continue;
    }
    if (a.startsWith("--source=")) continue;
    if (a === "-m" || a === "--merge") return;
    if (a === "--staged") {
      staged = true;
      continue;
    }
    if (a === "-W" || a === "--worktree") {
      worktree = true;
      continue;
    }
    if (RESTORE_NO_VALUE.has(a)) continue;
    if (a.startsWith("-")) continue;
    operands.push(a);
  }
  if (staged && !worktree) return;
  for (const operand of operands) {
    emitRestoreCheckoutPathspec(results, "git-restore-write", operand, dir, simpleCommandIndex, join9);
  }
}
function matchCheckoutOperands(args, dir, simpleCommandIndex, join9, results) {
  let afterDashDash = false;
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (a === "-p" || a === "--patch") {
      pushUnresolved(
        results,
        "git-checkout-write",
        a,
        "interactive patch mode applies user-chosen hunks \u2014 no static span"
      );
      return;
    }
    if (a === "-b" || a === "-B" || a === "--orphan") {
      i += 1;
      continue;
    }
    if (a === "-f" || a === "-q" || a === "-m" || a === "-t") continue;
    if (a.startsWith("-")) continue;
  }
  for (const operand of operands) {
    emitRestoreCheckoutPathspec(results, "git-checkout-write", operand, dir, simpleCommandIndex, join9);
  }
}
function matchGitRestoreCheckout(argv, dirForResolution, simpleCommandIndex, join9, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "git") {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || sub.subcommand !== "restore" && sub.subcommand !== "checkout") return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(
        results,
        sub.subcommand === "restore" ? "git-restore-write" : "git-checkout-write",
        sub.subcommand,
        "git -C target contains an unresolved shell variable"
      );
      return;
    }
    const dir = sub.cDir ?? dirForResolution;
    const args = rest.slice(1).slice(sub.subIdx + 1);
    if (sub.subcommand === "restore") matchRestoreOperands(args, dir, simpleCommandIndex, join9, results);
    else matchCheckoutOperands(args, dir, simpleCommandIndex, join9, results);
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === "restore" || wrapped === "checkout") {
      pushUnresolved(
        results,
        wrapped === "restore" ? "git-restore-write" : "git-checkout-write",
        wrapped,
        `the ${command} wrapper obscures the ${wrapped} argv`
      );
    }
  }
}
var LINE_SELECTORS = [matchSed, matchHead, matchTail];
var BUILTIN_GUARD_STATUS = /* @__PURE__ */ new Map([
  ["false", 1],
  ["true", 0],
  [":", 0]
]);
function parseCommandDetailed(command, opts = {}) {
  const cwd = typeof opts === "string" ? opts : opts.cwd ?? process.cwd();
  const { writes: heredocWrites, masked } = extractHeredocWrites(command);
  const { stages: simpleCommands, malformed } = splitTopLevel(masked);
  void malformed;
  const results = [];
  const fsLineCache = /* @__PURE__ */ new Map();
  const gitLineCache = /* @__PURE__ */ new Map();
  const cachedFsTotalLines = (absPath) => () => {
    if (!fsLineCache.has(absPath)) fsLineCache.set(absPath, countFileLines(absPath));
    return fsLineCache.get(absPath) ?? null;
  };
  const cachedGitTotalLines = (gitCwd, rev, path) => () => {
    const key = `${gitCwd}\0${rev}\0${path}`;
    if (!gitLineCache.has(key)) gitLineCache.set(key, countGitBlobLines(gitCwd, rev, path));
    return gitLineCache.get(key) ?? null;
  };
  let currentDir = cwd;
  let lastPlainFileSource = null;
  let pipeEchoContent = null;
  const joinOf = (simple) => {
    if (simple.precededBy === "and") return "&&";
    if (simple.precededBy === "or") return "||";
    return void 0;
  };
  const gitDirOf = (c, frame) => {
    if (c.dirOverride === void 0) return frame.certain ? frame.dir : void 0;
    if (isAbsolute2(c.dirOverride)) return c.dirOverride;
    return frame.certain ? resolvePath(frame.dir, c.dirOverride) : void 0;
  };
  const emitCandidate = (c, frame, simpleCommandIndex, join9) => {
    if (looksUnresolvable(c.fileArg)) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: "path contains an unexpanded shell variable or glob"
      });
      return;
    }
    if (c.resolverKind === "fs") {
      if (!frame.certain && !isAbsolute2(c.fileArg)) {
        results.push({
          status: "unresolved",
          idiom: c.idiom,
          fileArg: c.fileArg,
          reason: "the working directory is uncertain \u2014 the relative path cannot be resolved"
        });
        return;
      }
    } else if (gitDirOf(c, frame) === void 0) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: "the git -C target cannot be resolved against the tracked directory"
      });
      return;
    }
    const resolutionDir = c.resolverKind === "fs" ? c.dirOverride === void 0 ? frame.dir : isAbsolute2(c.dirOverride) ? c.dirOverride : resolvePath(frame.dir, c.dirOverride) : gitDirOf(c, frame);
    const absolutePath = resolvePath(resolutionDir, c.fileArg);
    const totalLines = c.resolverKind === "fs" ? cachedFsTotalLines(absolutePath) : cachedGitTotalLines(resolutionDir, c.resolverKind.rev, c.fileArg);
    const range = resolveSpec(c.spec, totalLines);
    if (range === null) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: absolutePath,
        reason: "could not determine end-of-file line count (file unreadable, empty, or git rev/path not found)"
      });
      return;
    }
    results.push({
      status: "resolved",
      idiom: c.idiom,
      span: {
        operation: "read",
        lineStart: range.lineStart,
        lineEnd: range.lineEnd,
        absolutePath,
        simpleCommandIndex,
        join: join9
      }
    });
  };
  const matchReads = (simple, argv, i) => {
    let isPlainSource = false;
    let plainFileArg = null;
    if (argv[0] === "cat" && argv.length === 2 && !argv[1].startsWith("-")) {
      isPlainSource = true;
      plainFileArg = argv[1];
      lastPlainFileSource = hasShellExpansion(argv[1]) ? null : resolvePath(currentDir, argv[1]);
    } else if (argv[0] === "nl" && argv.length >= 2 && !argv[argv.length - 1].startsWith("-")) {
      isPlainSource = true;
      const f = argv[argv.length - 1];
      plainFileArg = f;
      lastPlainFileSource = hasShellExpansion(f) ? null : resolvePath(currentDir, f);
    }
    if (plainFileArg !== null) {
      const next = simpleCommands[i + 1];
      if (next === void 0 || next.precededBy !== "pipe") {
        emitCandidate(
          {
            kind: "candidate",
            idiom: argv[0] === "cat" ? "cat-file" : "nl-file",
            fileArg: plainFileArg,
            spec: { kind: "toEof", start: 1 },
            resolverKind: "fs"
          },
          { dir: currentDir, certain: true },
          i,
          joinOf(simple)
        );
      }
    }
    let matched = false;
    for (const matcher of [...LINE_SELECTORS, matchGitShow, matchGitLogL]) {
      for (const outcome of matcher(argv)) {
        matched = true;
        if (outcome.kind === "unresolved") {
          results.push({
            status: "unresolved",
            idiom: outcome.idiom,
            fileArg: outcome.fileArg,
            reason: outcome.reason
          });
        } else {
          emitCandidate(outcome, { dir: currentDir, certain: true }, i, joinOf(simple));
          if (outcome.idiom === "git-show-rev-path" && !looksUnresolvable(outcome.fileArg)) {
            isPlainSource = true;
            lastPlainFileSource = resolvePath(outcome.dirOverride ?? currentDir, outcome.fileArg);
          }
        }
      }
    }
    if (!matched && simple.precededBy === "pipe" && lastPlainFileSource) {
      const withFile = [...argv, lastPlainFileSource];
      for (const matcher of LINE_SELECTORS) {
        for (const outcome of matcher(withFile)) {
          if (outcome.kind === "candidate")
            emitCandidate(outcome, { dir: currentDir, certain: true }, i, joinOf(simple));
          else
            results.push({
              status: "unresolved",
              idiom: outcome.idiom,
              fileArg: outcome.fileArg,
              reason: outcome.reason
            });
        }
      }
    }
    if (!isPlainSource) lastPlainFileSource = null;
  };
  for (let i = 0; i < simpleCommands.length; i++) {
    const simple = simpleCommands[i];
    if (simple.precededBy !== "pipe") pipeEchoContent = null;
    const heredocRef = simple.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef) {
      const w = heredocWrites[Number.parseInt(heredocRef[1], 10)];
      const tokens2 = tokenize(stripLeadingAssignments(w.opener).trim());
      if (tokens2 === null) {
        lastPlainFileSource = null;
        continue;
      }
      const openerArgv = analyzeTokens(tokens2).argv;
      matchReads(simple, openerArgv, i);
      classifyHeredocOpener(w.opener, w.body, w.quotedDelim, currentDir, i, joinOf(simple), results);
      pipeEchoContent = literalContent(openerArgv) ?? null;
      continue;
    }
    const tokens = tokenize(stripLeadingAssignments(simple.text).trim());
    if (tokens === null) {
      lastPlainFileSource = null;
      continue;
    }
    const { argv, redirects } = analyzeTokens(tokens);
    if (argv.length === 0) {
      matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
      lastPlainFileSource = null;
      continue;
    }
    if (argv[0] === "cd") {
      lastPlainFileSource = null;
      const target = argv[1];
      if (target !== void 0 && target !== "-" && !hasShellExpansion(target)) {
        currentDir = resolvePath(currentDir, target);
      }
      continue;
    }
    const before = results.length;
    matchReads(simple, argv, i);
    matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
    matchCopyMoveFamily(argv, currentDir, i, joinOf(simple), results);
    matchRmTruncate(argv, currentDir, i, joinOf(simple), results);
    matchSedInplace(argv, currentDir, i, joinOf(simple), results);
    matchPatchApply(argv, redirects, currentDir, i, joinOf(simple), results);
    matchFormatter(argv, currentDir, i, joinOf(simple), results);
    matchGitRestoreCheckout(argv, currentDir, i, joinOf(simple), results);
    if (results.length === before) {
      const status = BUILTIN_GUARD_STATUS.get(argv[0]);
      if (status !== void 0) {
        results.push({
          status: "builtin-guard",
          simpleCommandIndex: i,
          join: joinOf(simple),
          exitStatus: status
        });
      }
    }
    pipeEchoContent = literalContent(argv) ?? null;
  }
  return results;
}

// src/common/static-attribution.ts
var DEFAULT_MAX_ATTRIBUTION_CANDIDATES = 32;
var SHELL_EXPANSION = /(?:\$|`)/;
var GLOB_META = /[*?[\]]/;
var REGEX_META = /[.^$*+?()[\]{}|]/;
var STATIC_INTENT_COMMANDS = /* @__PURE__ */ new Set([
  ":",
  "autopep8",
  "biome",
  "black",
  "bunx",
  "cat",
  "cd",
  "clang-format",
  "command",
  "cp",
  "deno",
  "doas",
  "dprint",
  "echo",
  "env",
  "eslint",
  "false",
  "git",
  "gofmt",
  "goimports",
  "head",
  "install",
  "isort",
  "make",
  "mv",
  "nice",
  "nl",
  "node",
  "nohup",
  "npm",
  "npx",
  "patch",
  "perl",
  "pnpm",
  "prettier",
  "printf",
  "rm",
  "ruff",
  "rustfmt",
  "sed",
  "shfmt",
  "sudo",
  "tail",
  "tee",
  "terraform",
  "time",
  "truncate",
  "true",
  "xargs",
  "yapf",
  "yarn"
]);
var SHELL_INTENT_SYNTAX = /[<>|;&\n(){}$`]/;
var STATICALLY_SILENT_GIT_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "add",
  "branch",
  "commit",
  "config",
  "diff",
  "fetch",
  "ls-files",
  "pull",
  "push",
  "remote",
  "rev-parse",
  "status",
  "tag",
  "worktree"
]);
function canCarryStaticIntent(command) {
  const trimmed = command.trimStart();
  if (trimmed.length === 0) return false;
  if (SHELL_INTENT_SYNTAX.test(trimmed)) return true;
  const firstWord = trimmed.match(/^[^\s]+/)?.[0] ?? "";
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(firstWord)) return true;
  if (/^python(?:3(?:\.\d+)?)?$/.test(firstWord)) return true;
  if (firstWord === "git") {
    const subcommand = trimmed.slice(firstWord.length).trimStart().match(/^[^\s]+/)?.[0] ?? "";
    if (STATICALLY_SILENT_GIT_SUBCOMMANDS.has(subcommand)) return false;
  }
  return STATIC_INTENT_COMMANDS.has(firstWord);
}
function unresolved(layer, idiom, reasonCode, detail, fileArg, simpleCommandIndex = 0) {
  return { status: "unresolved", layer, idiom, reasonCode, detail, fileArg, simpleCommandIndex };
}
function classifyDynamicWord(word) {
  if (word.includes("$(") || word.includes("`")) return "command-substitution";
  if (SHELL_EXPANSION.test(word)) return "dynamic-path";
  if (GLOB_META.test(word)) return "glob-path";
  return null;
}
function decodeLiteralField(raw, delimiter, replacement) {
  let value = "";
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === "\\") {
      const next = raw[index + 1];
      if (next === void 0) return null;
      if (next === "n") value += "\n";
      else if (next === delimiter || next === "\\" || !replacement && REGEX_META.test(next)) value += next;
      else return null;
      index += 1;
      continue;
    }
    if (!replacement && REGEX_META.test(character) || replacement && character === "&") return null;
    value += character;
  }
  return value;
}
function readDelimitedField(source, start, delimiter) {
  let raw = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      const next = source[index + 1];
      if (next === void 0) return null;
      raw += `${character}${next}`;
      index += 1;
      continue;
    }
    if (character === delimiter) return { raw, next: index + 1 };
    raw += character;
  }
  return null;
}
function parseLiteralSubstitution(script) {
  if (script.length < 4 || script[0] !== "s") return null;
  const delimiter = script[1];
  if (/\w|\s/.test(delimiter)) return null;
  const patternField = readDelimitedField(script, 2, delimiter);
  if (patternField === null) return null;
  const replacementField = readDelimitedField(script, patternField.next, delimiter);
  if (replacementField === null) return null;
  const flags = script.slice(replacementField.next);
  if (flags !== "" && flags !== "g") return null;
  const pattern = decodeLiteralField(patternField.raw, delimiter, false);
  const replacement = decodeLiteralField(replacementField.raw, delimiter, true);
  if (pattern === null || pattern.length === 0 || replacement === null) return null;
  return { pattern, replacement, global: flags === "g" };
}
function literalOccurrenceRanges(content, literal) {
  if (literal.length === 0) return [];
  const ranges = [];
  let cursor = 0;
  let scannedTo = 0;
  let currentLine = 1;
  while (cursor <= content.length - literal.length) {
    const offset = content.indexOf(literal, cursor);
    if (offset < 0) break;
    for (let index = scannedTo; index < offset; index += 1) {
      if (content.charCodeAt(index) === 10) currentLine += 1;
    }
    const embeddedNewlines = literal.match(/\n/g)?.length ?? 0;
    const range = { start: currentLine, end: currentLine + embeddedNewlines };
    const previous = ranges[ranges.length - 1];
    if (previous === void 0 || previous.start !== range.start || previous.end !== range.end) ranges.push(range);
    cursor = offset + Math.max(1, literal.length);
    scannedTo = offset;
  }
  return ranges;
}
function replaceLiteral(source, pattern, replacement, global) {
  if (global) return source.split(pattern).join(replacement);
  const offset = source.indexOf(pattern);
  if (offset < 0) return source;
  return `${source.slice(0, offset)}${replacement}${source.slice(offset + pattern.length)}`;
}
function expectedSubstitutionContent(content, substitution, kind, addressLiteral) {
  if (kind === "perl-zero") {
    return replaceLiteral(content, substitution.pattern, substitution.replacement, substitution.global);
  }
  return content.split(/(?<=\n)/).map((line) => {
    if (addressLiteral !== null && !line.includes(addressLiteral)) return line;
    return replaceLiteral(line, substitution.pattern, substitution.replacement, substitution.global);
  }).join("");
}
function parsePatternCommand(command) {
  const argv = argvOf(command.trim());
  if (argv === null || argv.length < 2) return null;
  if (argv[0] === "sed") {
    let inplace2 = false;
    let backupSuffix;
    let script2 = null;
    const files2 = [];
    for (let index = 1; index < argv.length; index += 1) {
      const argument = argv[index];
      if (argument === "-i") {
        inplace2 = true;
        continue;
      }
      if (argument.startsWith("-i")) {
        inplace2 = true;
        backupSuffix = argument.slice(2);
        continue;
      }
      if (argument === "-e") {
        script2 = argv[index + 1] ?? null;
        index += 1;
        continue;
      }
      if (argument.startsWith("-"))
        return inplace2 ? { kind: "sed", script: "", files: [], backupSuffix, simpleCommandIndex: 0 } : null;
      if (script2 === null) script2 = argument;
      else files2.push(argument);
    }
    return inplace2 && script2 !== null ? { kind: "sed", script: script2, files: files2, backupSuffix, simpleCommandIndex: 0 } : null;
  }
  if (argv[0] !== "perl") return null;
  let inplace = false;
  let zero = false;
  let script = null;
  const files = [];
  let unsupportedOption = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-e") {
      script = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      const attachedScript = argument.match(/^-e(.+)$/)?.[1];
      if (attachedScript !== void 0) {
        script = attachedScript;
        continue;
      }
      if (argument === "-pi") inplace = true;
      else if (argument === "-0pi") {
        inplace = true;
        zero = true;
      } else {
        if (argument.includes("p") && argument.includes("i")) inplace = true;
        unsupportedOption = true;
      }
      continue;
    }
    files.push(argument);
  }
  if (unsupportedOption && inplace)
    return { kind: zero ? "perl-zero" : "perl", script: "", files: [], simpleCommandIndex: 0 };
  return inplace && script !== null ? { kind: zero ? "perl-zero" : "perl", script, files, simpleCommandIndex: 0 } : null;
}
function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
function expandLiteralLoopVariable(body, variable, binding) {
  let command = "";
  let quote = null;
  let replacements = 0;
  let unsafeUnquoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "\\" && quote !== "'") {
      command += character;
      if (index + 1 < body.length) command += body[++index];
      continue;
    }
    if (character === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'";
      command += character;
      continue;
    }
    if (character === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"';
      command += character;
      continue;
    }
    if (character !== "$" || quote === "'") {
      command += character;
      continue;
    }
    const braced = body.startsWith(`\${${variable}}`, index);
    const plain = body.startsWith(`$${variable}`, index);
    const suffix = body[index + variable.length + 1];
    if (!braced && (!plain || suffix !== void 0 && /[A-Za-z0-9_]/.test(suffix))) {
      command += character;
      continue;
    }
    const length = braced ? variable.length + 3 : variable.length + 1;
    if (quote === null && /\s/.test(binding)) unsafeUnquoted = true;
    command += quote === '"' ? binding.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$") : shellQuote(binding);
    replacements += 1;
    index += length - 1;
  }
  return { command, replacements, unsafeUnquoted };
}
function stableReason(match) {
  if (match.fileArg.includes("$(") || match.fileArg.includes("`")) return "command-substitution";
  if (SHELL_EXPANSION.test(match.fileArg)) return "dynamic-path";
  if (GLOB_META.test(match.fileArg)) return "glob-path";
  if (match.reason.includes("working directory")) return "dynamic-path";
  return "unsupported-expression";
}
var PYTHON_INTERPRETER = /^(?:python|python3(?:\.\d+)?)$/;
var PYTHON_STRING_SOURCE = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`;
var PYTHON_NAME_SOURCE = `[A-Za-z_][A-Za-z0-9_]*`;
var compiledPatternCache = /* @__PURE__ */ new Map();
function compileOnce(source, flags) {
  const key = `${flags ?? ""}\0${source}`;
  let pattern = compiledPatternCache.get(key);
  if (pattern === void 0) {
    pattern = new RegExp(source, flags);
    compiledPatternCache.set(key, pattern);
  }
  return pattern;
}
var PYTHON_PATH_LITERAL_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(?:Path|pathlib\\.Path)\\((${PYTHON_STRING_SOURCE})\\)$`
);
var PYTHON_STRING_BINDING_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_STRING_SOURCE})$`);
var PYTHON_NAME_ALIAS_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})$`);
var PYTHON_TEXT_READ_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.read_text\\(([^)]*)\\)$`
);
var PYTHON_REPLACE_BINDING_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.replace\\((${PYTHON_STRING_SOURCE})\\s*,\\s*(${PYTHON_STRING_SOURCE})(?:\\s*,\\s*(\\d+))?\\)$`
);
var PYTHON_COUNT_ASSERT_PATTERN = new RegExp(
  `^assert\\s+(${PYTHON_NAME_SOURCE})\\.count\\((${PYTHON_STRING_SOURCE})\\)\\s*==\\s*(\\d+)$`
);
var PYTHON_INDEX_ANCHOR_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.index\\((${PYTHON_STRING_SOURCE})\\)$`
);
var PYTHON_LINE_ARRAY_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.read_text\\(\\)\\.splitlines\\(\\)$`
);
var PYTHON_LINE_EDIT_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\[(\\d+)\\]\\s*=\\s*(${PYTHON_STRING_SOURCE})$`);
var PYTHON_STRUCTURED_LOAD_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(json|tomllib|yaml)\\.(?:loads|safe_load)\\((${PYTHON_NAME_SOURCE})\\.read_text\\(\\)\\)$`
);
var PYTHON_STRUCTURED_ASSIGN_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})((?:\\[${PYTHON_STRING_SOURCE}\\])+?)\\s*=\\s*(?:True|False|None|-?\\d+(?:\\.\\d+)?|${PYTHON_STRING_SOURCE})$`
);
var PYTHON_STRUCTURED_KEY_SCAN_PATTERN = new RegExp(`\\[(${PYTHON_STRING_SOURCE})\\]`, "g");
var PYTHON_APPEND_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\.open\\((${PYTHON_STRING_SOURCE})\\)\\.write\\((${PYTHON_STRING_SOURCE})\\)$`
);
var PYTHON_WRITE_TARGET_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\.write_text\\((.+)\\)$`);
var PYTHON_DIRECT_REPLACE_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\.replace\\((${PYTHON_STRING_SOURCE})\\s*,\\s*(${PYTHON_STRING_SOURCE})(?:\\s*,\\s*(\\d+))?\\)$`
);
var PYTHON_ANCHOR_SLICE_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\[:(${PYTHON_NAME_SOURCE})\\]\\s*\\+\\s*(${PYTHON_STRING_SOURCE})\\s*\\+\\s*\\1\\[\\2\\s*\\+\\s*(\\d+):\\]$`
);
var PYTHON_LINE_JOIN_PATTERN = new RegExp(
  `^(${PYTHON_STRING_SOURCE})\\.join\\((${PYTHON_NAME_SOURCE})\\)(?:\\s*\\+\\s*(${PYTHON_STRING_SOURCE}))?$`
);
function decodePythonString(raw) {
  if (raw.length < 2 || raw[0] !== "'" && raw[0] !== '"' || raw.at(-1) !== raw[0]) return null;
  let value = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      if (character === raw[0]) return null;
      value += character;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped === void 0 || index + 1 >= raw.length - 1) return null;
    if (escaped === "n") value += "\n";
    else if (escaped === "r") value += "\r";
    else if (escaped === "t") value += "	";
    else if (escaped === "\\" || escaped === "'" || escaped === '"') value += escaped;
    else return null;
    index += 1;
  }
  return value;
}
function extractPythonProgram(command) {
  const trimmed = command.trim();
  const interpreter = trimmed.match(/^(python(?:3(?:\.\d+)?)?)\b/)?.[1];
  if (interpreter === void 0 || !PYTHON_INTERPRETER.test(interpreter)) return null;
  if (trimmed.includes("<<")) {
    const heredoc = trimmed.match(
      /^(?:python|python3(?:\.\d+)?)\s+-\s+<<(['"])([A-Za-z_][A-Za-z0-9_]*)\1[ \t]*\r?\n([\s\S]*?)\r?\n\2[ \t]*$/
    );
    if (heredoc === null) {
      return {
        reason: "unsupported-syntax",
        detail: "Python heredocs require a quoted literal delimiter and a complete body"
      };
    }
    return { program: heredoc[3] };
  }
  const argv = argvOf(trimmed);
  if (argv === null || argv[0] !== interpreter || argv[1] !== "-c" || argv[2] === void 0) {
    return {
      reason: "unsupported-syntax",
      detail: "only literal Python -c programs and quoted heredocs are supported"
    };
  }
  if (argv[2].includes("$(") || argv[2].includes("`") || /^\$\{?[A-Za-z_]/.test(argv[2])) {
    return { reason: "unsupported-syntax", detail: "the Python program is shell-derived rather than literal" };
  }
  return { program: argv[2] };
}
function splitPythonStatements(program) {
  const statements = [];
  let statement = "";
  let quote = null;
  let escaped = false;
  let depth = 0;
  let comment = false;
  for (const character of program) {
    if (comment) {
      if (character === "\n") {
        comment = false;
        if (depth === 0 && statement.trim() !== "") {
          statements.push(statement.trim());
          statement = "";
        }
      }
      continue;
    }
    if (quote !== null) {
      statement += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      statement += character;
      continue;
    }
    if (character === "#") {
      comment = true;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if ((character === "\n" || character === ";") && depth === 0) {
      if (statement.trim() !== "") statements.push(statement.trim());
      statement = "";
      continue;
    }
    statement += character;
  }
  if (quote !== null || escaped || depth !== 0) return null;
  if (statement.trim() !== "") statements.push(statement.trim());
  return statements;
}
function pythonLineAtOffset(content, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (content.charCodeAt(index) === 10) line += 1;
  return line;
}
function countLiteralOccurrences(content, literal) {
  if (literal.length === 0) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= content.length - literal.length) {
    const offset = content.indexOf(literal, cursor);
    if (offset < 0) break;
    count += 1;
    cursor = offset + literal.length;
  }
  return count;
}
function structuredKeyRanges(content, format, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = format === "json" ? compileOnce(`^[ \\t]*["']${escaped}["'][ \\t]*:`, "m") : format === "toml" ? compileOnce(`^[ \\t]*(?:["']${escaped}["']|${escaped})[ \\t]*=`, "m") : compileOnce(`^[ \\t]*(?:["']${escaped}["']|${escaped})[ \\t]*:`, "m");
  const ranges = [];
  let offset = 0;
  for (const line of content.split(/(?<=\n)/)) {
    if (pattern.test(line)) {
      const number = pythonLineAtOffset(content, offset);
      ranges.push({ start: number, end: number });
    }
    offset += line.length;
  }
  return ranges;
}
function parsePythonAttribution(command, options) {
  const extracted = extractPythonProgram(command);
  if (extracted === null) return null;
  const reject = (reasonCode, detail, fileArg, preStateRequests2 = []) => ({
    resolved: [],
    unresolved: [unresolved("python", "python-edit", reasonCode, detail, fileArg)],
    preStateRequests: preStateRequests2
  });
  if (extracted.program === void 0) {
    return reject(extracted.reason ?? "unsupported-syntax", extracted.detail ?? "unsupported Python invocation");
  }
  const statements = splitPythonStatements(extracted.program);
  if (statements === null || statements.length === 0) {
    return reject("unsupported-syntax", "the Python program is incomplete or cannot be tokenized");
  }
  if (statements.length > 64)
    return reject("candidate-budget-exceeded", "the Python program exceeds the statement budget");
  const cwd = options.cwd ?? process.cwd();
  const paths = /* @__PURE__ */ new Map();
  const texts = /* @__PURE__ */ new Map();
  const replacements = /* @__PURE__ */ new Map();
  const anchors = /* @__PURE__ */ new Map();
  const lines = /* @__PURE__ */ new Map();
  const structured = /* @__PURE__ */ new Map();
  const countAssertions = /* @__PURE__ */ new Map();
  const resolved = [];
  const preStateRequests = [];
  const request = (absolutePath, operation, requirement) => {
    if (!preStateRequests.some(
      (entry) => entry.absolutePath === absolutePath && entry.operation === operation && entry.requirement === requirement
    )) {
      preStateRequests.push({ absolutePath, operation, requirement, simpleCommandIndex: 0 });
    }
  };
  const readPreState = (absolutePath, requirements) => {
    for (const requirement of requirements) request(absolutePath, "modify", requirement);
    const content = options.readPreState?.(absolutePath) ?? null;
    if (content === null)
      return reject(
        "missing-pre-state",
        "Python range recovery requires pre-command text",
        absolutePath,
        preStateRequests
      );
    if (content.includes("\0"))
      return reject(
        "binary-content",
        "Python range recovery does not accept binary content",
        absolutePath,
        preStateRequests
      );
    return content;
  };
  const emitReplace = (absolutePath, transformation) => {
    const read = texts.get(transformation.source);
    if (read === void 0 || nodePath4.resolve(cwd, read.path) !== absolutePath) {
      return reject("unsupported-dataflow", "Python read and write paths are not provably identical", absolutePath);
    }
    const requirements = ["match-locations"];
    if (transformation.replacement.length === 0 || (transformation.pattern.match(/\n/g)?.length ?? 0) !== (transformation.replacement.match(/\n/g)?.length ?? 0)) {
      requirements.push("deleted-text");
    }
    const content = readPreState(absolutePath, requirements);
    if (typeof content !== "string") return content;
    const assertion = countAssertions.get(`${transformation.source}\0${transformation.pattern}`);
    const occurrences = countLiteralOccurrences(content, transformation.pattern);
    if (assertion !== void 0 && occurrences !== assertion) {
      return reject(
        "evidence-mismatch",
        "Python count assertion does not match pre-state",
        absolutePath,
        preStateRequests
      );
    }
    const count = transformation.count ?? occurrences;
    const ranges = literalOccurrenceRanges(content, transformation.pattern).slice(0, count);
    if (ranges.length === 0) {
      return reject(
        "evidence-mismatch",
        "Python replacement literal is absent from pre-state",
        absolutePath,
        preStateRequests
      );
    }
    let expected = content;
    if (transformation.count === void 0)
      expected = content.split(transformation.pattern).join(transformation.replacement);
    else {
      for (let index = 0; index < Math.min(transformation.count, occurrences); index += 1) {
        expected = replaceLiteral(expected, transformation.pattern, transformation.replacement, false);
      }
    }
    for (const range of ranges) {
      resolved.push({
        status: "resolved",
        layer: "python",
        idiom: "python-replace",
        span: {
          operation: "modify",
          absolutePath,
          lineStart: range.start,
          lineEnd: range.end,
          expectedContent: expected,
          simpleCommandIndex: 0
        }
      });
    }
    return null;
  };
  for (const statement of statements) {
    if (/^(?:from\s+pathlib\s+import\s+Path|import\s+(?:pathlib|json|tomllib|tomli_w|toml|yaml|sys)(?:\s*,\s*(?:pathlib|json|tomllib|tomli_w|toml|yaml|sys))*)$/.test(
      statement
    )) {
      continue;
    }
    if (/^(?:for|while|if|def|class|with|try)\b/.test(statement)) {
      return reject("unsupported-dataflow", "control flow is outside the bounded Python recognizer");
    }
    let match = statement.match(PYTHON_PATH_LITERAL_PATTERN);
    if (match !== null) {
      const path = decodePythonString(match[2]);
      if (path === null) return reject("unsupported-syntax", "Python path literal uses an unsupported escape");
      paths.set(match[1], { path, depth: 0 });
      continue;
    }
    match = statement.match(PYTHON_STRING_BINDING_PATTERN);
    if (match !== null) {
      const path = decodePythonString(match[2]);
      if (path === null) return reject("unsupported-syntax", "Python string literal uses an unsupported escape");
      paths.set(match[1], { path, depth: 0 });
      continue;
    }
    match = statement.match(PYTHON_NAME_ALIAS_PATTERN);
    if (match !== null) {
      const source = paths.get(match[2]);
      if (source === void 0 || source.depth !== 0) {
        return reject("unsupported-dataflow", "Python path aliases are limited to one literal hop");
      }
      paths.set(match[1], { path: source.path, depth: 1 });
      continue;
    }
    match = statement.match(PYTHON_TEXT_READ_PATTERN);
    if (match !== null) {
      const binding = paths.get(match[2]);
      if (binding === void 0) return reject("dynamic-path", "Python read target is not a literal path binding");
      if (match[3].trim() !== "" && !/^encoding\s*=\s*['"]utf-?8['"]$/.test(match[3].trim())) {
        return reject("unsupported-encoding", "only default or UTF-8 Python text reads are supported", binding.path);
      }
      texts.set(match[1], { path: binding.path });
      continue;
    }
    match = statement.match(PYTHON_REPLACE_BINDING_PATTERN);
    if (match !== null) {
      if (!texts.has(match[2]))
        return reject("unsupported-dataflow", "Python replace source is not a direct text read");
      const pattern = decodePythonString(match[3]);
      const replacement = decodePythonString(match[4]);
      const count = match[5] === void 0 ? void 0 : Number.parseInt(match[5], 10);
      if (pattern === null || pattern.length === 0 || replacement === null || count === 0) {
        return reject("unsupported-expression", "Python replace requires non-empty literal input and a positive count");
      }
      replacements.set(match[1], { source: match[2], pattern, replacement, count });
      continue;
    }
    match = statement.match(PYTHON_COUNT_ASSERT_PATTERN);
    if (match !== null) {
      const literal = decodePythonString(match[2]);
      if (literal === null || literal.length === 0 || !texts.has(match[1])) {
        return reject("unsupported-dataflow", "Python count assertion is not tied to a direct text read");
      }
      countAssertions.set(`${match[1]}\0${literal}`, Number.parseInt(match[3], 10));
      continue;
    }
    match = statement.match(PYTHON_INDEX_ANCHOR_PATTERN);
    if (match !== null) {
      const literal = decodePythonString(match[3]);
      if (literal === null || literal.length === 0 || !texts.has(match[2])) {
        return reject("unsupported-dataflow", "Python index anchor is not tied to a direct text read");
      }
      anchors.set(match[1], { source: match[2], literal });
      continue;
    }
    match = statement.match(PYTHON_LINE_ARRAY_PATTERN);
    if (match !== null) {
      const binding = paths.get(match[2]);
      if (binding === void 0) return reject("dynamic-path", "Python line-array target is not literal");
      lines.set(match[1], { path: binding.path, edits: /* @__PURE__ */ new Map() });
      continue;
    }
    match = statement.match(PYTHON_LINE_EDIT_PATTERN);
    if (match !== null) {
      const array = lines.get(match[1]);
      const value = decodePythonString(match[3]);
      if (array === void 0 || value === null)
        return reject("unsupported-dataflow", "line edit is not a bounded literal array edit");
      array.edits.set(Number.parseInt(match[2], 10), value);
      continue;
    }
    match = statement.match(PYTHON_STRUCTURED_LOAD_PATTERN);
    if (match !== null) {
      const binding = paths.get(match[3]);
      if (binding === void 0) return reject("dynamic-path", "structured Python load target is not literal");
      const format = match[2] === "tomllib" ? "toml" : match[2];
      structured.set(match[1], { format, path: binding.path, keys: [] });
      continue;
    }
    match = statement.match(PYTHON_STRUCTURED_ASSIGN_PATTERN);
    if (match !== null && structured.has(match[1])) {
      const keys = [...match[2].matchAll(PYTHON_STRUCTURED_KEY_SCAN_PATTERN)].map((key) => decodePythonString(key[1]));
      if (keys.length === 0 || keys.some((key) => key === null)) {
        return reject("unsupported-expression", "structured Python mutation requires literal string keys");
      }
      structured.get(match[1]).keys.push(keys);
      continue;
    }
    match = statement.match(PYTHON_APPEND_PATTERN);
    if (match !== null) {
      const binding = paths.get(match[1]);
      const mode = decodePythonString(match[2]);
      const written = decodePythonString(match[3]);
      if (binding === void 0) return reject("dynamic-path", "Python append target is not literal");
      if (mode !== "a" || written === null)
        return reject("unsupported-expression", "only literal text append mode is supported");
      const absolutePath = nodePath4.resolve(cwd, binding.path);
      request(absolutePath, "append", "pre-command-eof");
      const content = options.readPreState?.(absolutePath) ?? null;
      if (content === null)
        return reject(
          "missing-pre-state",
          "Python append range requires pre-command text",
          absolutePath,
          preStateRequests
        );
      if (content.includes("\0"))
        return reject("binary-content", "Python append does not accept binary content", absolutePath, preStateRequests);
      const line = pythonLineAtOffset(content, content.length);
      resolved.push({
        status: "resolved",
        layer: "python",
        idiom: "python-append",
        span: {
          operation: "append",
          absolutePath,
          lineStart: line,
          lineEnd: line,
          written,
          expectedContent: `${content}${written}`,
          simpleCommandIndex: 0
        }
      });
      continue;
    }
    match = statement.match(PYTHON_WRITE_TARGET_PATTERN);
    if (match !== null) {
      const binding = paths.get(match[1]);
      if (binding === void 0) return reject("dynamic-path", "Python write target is not literal");
      const absolutePath = nodePath4.resolve(cwd, binding.path);
      const expression = match[2].trim();
      const literal = decodePythonString(expression);
      if (literal !== null) {
        resolved.push({
          status: "resolved",
          layer: "python",
          idiom: "python-write",
          span: {
            operation: "create-overwrite",
            absolutePath,
            written: literal,
            expectedContent: literal,
            simpleCommandIndex: 0
          }
        });
        continue;
      }
      const directReplace = expression.match(PYTHON_DIRECT_REPLACE_PATTERN);
      const replacement = directReplace === null ? replacements.get(expression) : {
        source: directReplace[1],
        pattern: decodePythonString(directReplace[2]) ?? "",
        replacement: decodePythonString(directReplace[3]) ?? "",
        count: directReplace[4] === void 0 ? void 0 : Number.parseInt(directReplace[4], 10)
      };
      if (replacement !== void 0) {
        const rejected = emitReplace(absolutePath, replacement);
        if (rejected !== null) return rejected;
        continue;
      }
      const slice = expression.match(PYTHON_ANCHOR_SLICE_PATTERN);
      if (slice !== null) {
        const anchor = anchors.get(slice[2]);
        const read = texts.get(slice[1]);
        const replacementText = decodePythonString(slice[3]);
        if (anchor === void 0 || read === void 0 || anchor.source !== slice[1] || replacementText === null || Number.parseInt(slice[4], 10) !== anchor.literal.length || nodePath4.resolve(cwd, read.path) !== absolutePath) {
          return reject(
            "unsupported-dataflow",
            "Python slice reconstruction is not tied to one literal anchor",
            absolutePath
          );
        }
        const content = readPreState(absolutePath, ["match-locations", "deleted-text"]);
        if (typeof content !== "string") return content;
        const offset = content.indexOf(anchor.literal);
        if (offset < 0)
          return reject(
            "evidence-mismatch",
            "Python slice anchor is absent from pre-state",
            absolutePath,
            preStateRequests
          );
        const range = literalOccurrenceRanges(content, anchor.literal)[0];
        resolved.push({
          status: "resolved",
          layer: "python",
          idiom: "python-anchor-slice",
          span: {
            operation: "modify",
            absolutePath,
            lineStart: range.start,
            lineEnd: range.end,
            expectedContent: `${content.slice(0, offset)}${replacementText}${content.slice(offset + anchor.literal.length)}`,
            simpleCommandIndex: 0
          }
        });
        continue;
      }
      const lineJoin = expression.match(PYTHON_LINE_JOIN_PATTERN);
      if (lineJoin !== null) {
        const delimiter = decodePythonString(lineJoin[1]);
        const array = lines.get(lineJoin[2]);
        const suffix = lineJoin[3] === void 0 ? "" : decodePythonString(lineJoin[3]);
        if (delimiter !== "\n" || array === void 0 || suffix === null || suffix !== "" && suffix !== "\n") {
          return reject("unsupported-expression", "line-array writes require a literal newline join", absolutePath);
        }
        if (nodePath4.resolve(cwd, array.path) !== absolutePath || array.edits.size === 0) {
          return reject(
            "unsupported-dataflow",
            "line-array read and write paths are not provably identical",
            absolutePath
          );
        }
        const content = readPreState(absolutePath, ["deleted-text"]);
        if (typeof content !== "string") return content;
        if (content.includes("\r"))
          return reject("unsupported-encoding", "line-array edits require LF text", absolutePath, preStateRequests);
        const sourceLines = content.split("\n");
        if (sourceLines.at(-1) === "") sourceLines.pop();
        for (const [index, value] of array.edits) {
          if (index >= sourceLines.length)
            return reject("evidence-mismatch", "line-array index is outside pre-state", absolutePath, preStateRequests);
          sourceLines[index] = value;
        }
        const expectedContent = `${sourceLines.join("\n")}${suffix}`;
        for (const index of array.edits.keys()) {
          resolved.push({
            status: "resolved",
            layer: "python",
            idiom: "python-line-array",
            span: {
              operation: "modify",
              absolutePath,
              lineStart: index + 1,
              lineEnd: index + 1,
              expectedContent,
              simpleCommandIndex: 0
            }
          });
        }
        continue;
      }
      const structuredSink = expression.match(
        /^(json|tomli_w|toml|yaml)\.(dumps|safe_dump)\(([A-Za-z_][A-Za-z0-9_]*)\)$/
      );
      if (structuredSink !== null) {
        const value = structured.get(structuredSink[3]);
        const sinkFormat = structuredSink[1] === "json" ? "json" : structuredSink[1] === "yaml" ? "yaml" : "toml";
        if (value === void 0 || value.format !== sinkFormat || nodePath4.resolve(cwd, value.path) !== absolutePath || value.keys.length === 0) {
          return reject(
            "unsupported-dataflow",
            "structured read, literal-key mutation, and write are not linked",
            absolutePath
          );
        }
        const content = readPreState(absolutePath, ["match-locations"]);
        if (typeof content !== "string") return content;
        for (const keyPath of value.keys) {
          const key = keyPath.at(-1);
          const ranges = structuredKeyRanges(content, value.format, key);
          if (ranges.length !== 1) {
            return reject(
              "unsupported-expression",
              "structured literal key is absent or ambiguous in pre-state",
              absolutePath,
              preStateRequests
            );
          }
          resolved.push({
            status: "resolved",
            layer: "python",
            idiom: `python-${value.format}`,
            span: {
              operation: "modify",
              absolutePath,
              lineStart: ranges[0].start,
              lineEnd: ranges[0].end,
              simpleCommandIndex: 0
            }
          });
        }
        continue;
      }
      return reject("unsupported-dataflow", "Python write expression is outside the bounded allowlist", absolutePath);
    }
    if (/sys\.argv|os\.(?:environ|getenv)|input\s*\(/.test(statement)) {
      return reject("dynamic-path", "Python target depends on runtime input");
    }
    return reject(
      /(?:\.write|open\s*\(|Path\s*\()/.test(statement) ? "unsupported-dataflow" : "unsupported-syntax",
      "Python statement is outside the bounded lexical/dataflow allowlist"
    );
  }
  if (resolved.length === 0) return reject("unsupported-dataflow", "Python program has no supported authoring sink");
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_ATTRIBUTION_CANDIDATES;
  if (resolved.length > maxCandidates) {
    return reject(
      "candidate-budget-exceeded",
      `Python program produced ${resolved.length} candidates; the limit is ${maxCandidates}`
    );
  }
  return { resolved, unresolved: [], preStateRequests };
}
var NODE_STRING_SOURCE = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`;
var NODE_NAME_SOURCE = `[A-Za-z_$][A-Za-z0-9_$]*`;
var NODE_FS_MEMBER_PATTERN = new RegExp(`^(${NODE_NAME_SOURCE})\\.(readFileSync|writeFileSync|appendFileSync)$`);
var NODE_REQUIRE_FS_PATTERN = new RegExp(
  `^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*require\\((['"])(?:node:)?fs\\2\\)$`
);
var NODE_STRING_DECL_PATTERN = new RegExp(
  `^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*(${NODE_STRING_SOURCE})$`
);
var NODE_NAME_ALIAS_PATTERN = new RegExp(
  `^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*(${NODE_NAME_SOURCE})$`
);
var NODE_GENERIC_DECL_PATTERN = new RegExp(`^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*(.+)$`);
var NODE_REPLACE_CALL_PATTERN = new RegExp(
  `^(${NODE_NAME_SOURCE})\\.(replace|replaceAll)\\((${NODE_STRING_SOURCE})\\s*,\\s*(${NODE_STRING_SOURCE})\\)$`
);
var NODE_JSON_PARSE_PATTERN = new RegExp(`^JSON\\.parse\\((${NODE_NAME_SOURCE})\\)$`);
var NODE_STRUCTURED_ASSIGN_PATTERN = new RegExp(
  `^(${NODE_NAME_SOURCE})((?:(?:\\.${NODE_NAME_SOURCE})|(?:\\[${NODE_STRING_SOURCE}\\]))+)\\s*=\\s*(.+)$`
);
var NODE_KEY_SEGMENT_SCAN_PATTERN = new RegExp(`\\.(${NODE_NAME_SOURCE})|\\[(${NODE_STRING_SOURCE})\\]`, "g");
var NODE_COUNT_GUARD_PATTERN = new RegExp(
  `^if\\s*\\(\\s*(${NODE_NAME_SOURCE})\\.split\\((${NODE_STRING_SOURCE})\\)\\.length\\s*-\\s*1\\s*!==?\\s*(\\d+)\\s*\\)\\s*throw\\b.+$`
);
function decodeNodeString(raw) {
  if (raw.length < 2 || raw[0] !== "'" && raw[0] !== '"' || raw.at(-1) !== raw[0]) return null;
  let value = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      if (character === raw[0] || character === "\n" || character === "\r") return null;
      value += character;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped === void 0 || index + 1 >= raw.length - 1) return null;
    if (escaped === "n") value += "\n";
    else if (escaped === "r") value += "\r";
    else if (escaped === "t") value += "	";
    else if (escaped === "b") value += "\b";
    else if (escaped === "f") value += "\f";
    else if (escaped === "v") value += "\v";
    else if (escaped === "0") value += "\0";
    else if (escaped === "\\" || escaped === "'" || escaped === '"') value += escaped;
    else return null;
    index += 1;
  }
  return value;
}
function extractNodeProgram(command) {
  const trimmed = command.trim();
  if (!/^node\b/.test(trimmed)) return null;
  if (trimmed.includes("<<")) {
    const heredoc = trimmed.match(
      /^node(?:\s+-)?\s+<<(['"])([A-Za-z_][A-Za-z0-9_]*)\1[ \t]*\r?\n([\s\S]*?)\r?\n\2[ \t]*$/
    );
    if (heredoc === null) {
      return {
        reason: "unsupported-syntax",
        detail: "Node heredocs require a quoted literal delimiter and a complete body"
      };
    }
    return { program: heredoc[3] };
  }
  const argv = argvOf(trimmed);
  if (argv === null) {
    return /^node\s+-e(?:\s|$)/.test(trimmed) ? { reason: "unsupported-syntax", detail: "the literal Node -e program cannot be tokenized" } : null;
  }
  if (argv[0] !== "node" || argv[1] !== "-e") return null;
  if (argv[2] === void 0) return { reason: "unsupported-syntax", detail: "Node -e requires a literal program" };
  if (argv[2].includes("$(") || argv[2].includes("`") || /^\$\{?[A-Za-z_]/.test(argv[2])) {
    return { reason: "unsupported-syntax", detail: "the Node program is shell-derived rather than literal" };
  }
  return { program: argv[2] };
}
function splitNodeStatements(program) {
  if (program.includes("`")) return null;
  const statements = [];
  let statement = "";
  let quote = null;
  let escaped = false;
  let depth = 0;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < program.length; index += 1) {
    const character = program[index];
    const next = program[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        if (depth === 0 && statement.trim() !== "") {
          statements.push(statement.trim());
          statement = "";
        }
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      statement += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      statement += character;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if ((character === ";" || character === "\n") && depth === 0) {
      if (statement.trim() !== "") statements.push(statement.trim());
      statement = "";
      continue;
    }
    statement += character;
  }
  if (quote !== null || escaped || depth !== 0 || blockComment) return null;
  if (statement.trim() !== "") statements.push(statement.trim());
  return statements;
}
function splitNodeArguments(source) {
  const arguments_ = [];
  let argument = "";
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (const character of source) {
    if (quote !== null) {
      argument += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      argument += character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (character === "," && depth === 0) {
      arguments_.push(argument.trim());
      argument = "";
      continue;
    }
    argument += character;
  }
  if (quote !== null || escaped || depth !== 0) return null;
  if (argument.trim() !== "" || arguments_.length > 0) arguments_.push(argument.trim());
  return arguments_;
}
function parseNodeAttribution(command, options) {
  const extracted = extractNodeProgram(command);
  if (extracted === null) return null;
  const reject = (reasonCode, detail, fileArg, preStateRequests2 = []) => ({
    resolved: [],
    unresolved: [unresolved("node", "node-edit", reasonCode, detail, fileArg)],
    preStateRequests: preStateRequests2
  });
  if (extracted.program === void 0) {
    return reject(extracted.reason ?? "unsupported-syntax", extracted.detail ?? "unsupported Node invocation");
  }
  if (/\b(?:process\.(?:argv|env)|require\s*\(\s*[^'"]|import\s*\()/.test(extracted.program)) {
    return reject("dynamic-path", "Node target depends on runtime input or a computed import");
  }
  const statements = splitNodeStatements(extracted.program);
  if (statements === null || statements.length === 0) {
    return reject("unsupported-syntax", "the Node program is incomplete or cannot be tokenized");
  }
  if (statements.length > 64)
    return reject("candidate-budget-exceeded", "the Node program exceeds the statement budget");
  const cwd = options.cwd ?? process.cwd();
  const fsNamespaces = /* @__PURE__ */ new Set();
  const fsFunctions = /* @__PURE__ */ new Map();
  const paths = /* @__PURE__ */ new Map();
  const texts = /* @__PURE__ */ new Map();
  const replacements = /* @__PURE__ */ new Map();
  const structured = /* @__PURE__ */ new Map();
  const countAssertions = /* @__PURE__ */ new Map();
  const resolved = [];
  const preStateRequests = [];
  const request = (absolutePath, operation, requirement) => {
    if (!preStateRequests.some(
      (entry) => entry.absolutePath === absolutePath && entry.operation === operation && entry.requirement === requirement
    )) {
      preStateRequests.push({ absolutePath, operation, requirement, simpleCommandIndex: 0 });
    }
  };
  const readPreState = (absolutePath, operation, requirements) => {
    for (const requirement of requirements) request(absolutePath, operation, requirement);
    const content = options.readPreState?.(absolutePath) ?? null;
    if (content === null)
      return reject(
        "missing-pre-state",
        "Node range recovery requires pre-command text",
        absolutePath,
        preStateRequests
      );
    if (content.includes("\0"))
      return reject(
        "binary-content",
        "Node range recovery does not accept binary content",
        absolutePath,
        preStateRequests
      );
    return content;
  };
  const resolvePathExpression = (expression) => {
    const literal = decodeNodeString(expression.trim());
    if (literal !== null) return { path: literal, depth: 0 };
    return paths.get(expression.trim()) ?? null;
  };
  const fsMethod = (callee) => {
    const bare = fsFunctions.get(callee);
    if (bare !== void 0) return bare;
    const member = callee.match(NODE_FS_MEMBER_PATTERN);
    if (member !== null && fsNamespaces.has(member[1])) {
      return member[2];
    }
    const required = callee.match(/^require\((['"])(?:node:)?fs\1\)\.(readFileSync|writeFileSync|appendFileSync)$/);
    return required?.[2] ?? null;
  };
  const parseCall = (expression) => {
    const call = expression.trim().match(/^(require\((['"])(?:node:)?fs\2\)\.(?:readFileSync|writeFileSync|appendFileSync))\(([\s\S]*)\)$/) ?? expression.trim().match(/^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)\(([\s\S]*)\)$/);
    if (call === null) return null;
    const method = fsMethod(call[1].trim());
    if (method === null) return null;
    const args = splitNodeArguments(call.length === 4 ? call[3] : call[2]);
    return args === null ? null : { method, args };
  };
  const emitReplacement = (absolutePath, replacement) => {
    const read = texts.get(replacement.source);
    if (read === void 0 || nodePath4.resolve(cwd, read.path) !== absolutePath) {
      return reject(
        "unsupported-dataflow",
        "Node replacement read and write paths are not provably identical",
        absolutePath
      );
    }
    const content = readPreState(absolutePath, "modify", ["match-locations"]);
    if (typeof content !== "string") return content;
    const occurrences = countLiteralOccurrences(content, replacement.pattern);
    const assertion = countAssertions.get(`${replacement.source}\0${replacement.pattern}`);
    if (assertion !== void 0 && occurrences !== assertion) {
      return reject(
        "evidence-mismatch",
        "Node count assertion does not match pre-state",
        absolutePath,
        preStateRequests
      );
    }
    const ranges = literalOccurrenceRanges(content, replacement.pattern);
    if (ranges.length === 0) {
      return reject(
        "evidence-mismatch",
        "Node replacement literal is absent from pre-state",
        absolutePath,
        preStateRequests
      );
    }
    const affected = replacement.global ? ranges : ranges.slice(0, 1);
    const expectedContent = replaceLiteral(content, replacement.pattern, replacement.replacement, replacement.global);
    for (const range of affected) {
      resolved.push({
        status: "resolved",
        layer: "node",
        idiom: "node-replace",
        span: {
          operation: "modify",
          absolutePath,
          lineStart: range.start,
          lineEnd: range.end,
          expectedContent,
          simpleCommandIndex: 0
        }
      });
    }
    return null;
  };
  for (const statement of statements) {
    if (/^['"]use strict['"]$/.test(statement)) continue;
    if (/^(?:for|while|do|switch|function|class|async|await|try|with|import)\b/.test(statement)) {
      return reject(
        "unsupported-dataflow",
        "control flow, asynchronous code, and imports are outside the Node recognizer"
      );
    }
    let match = statement.match(NODE_REQUIRE_FS_PATTERN);
    if (match !== null) {
      fsNamespaces.add(match[1]);
      continue;
    }
    match = statement.match(/^const\s+\{([^}]+)\}\s*=\s*require\((['"])(?:node:)?fs\2\)$/);
    if (match !== null) {
      for (const entry of match[1].split(",")) {
        const binding = entry.trim().match(/^(readFileSync|writeFileSync|appendFileSync)(?:\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*))?$/);
        if (binding === null)
          return reject("unsupported-syntax", "Node fs destructuring contains an unsupported binding");
        fsFunctions.set(binding[2] ?? binding[1], binding[1]);
      }
      continue;
    }
    match = statement.match(NODE_STRING_DECL_PATTERN);
    if (match !== null) {
      const path = decodeNodeString(match[2]);
      if (path === null) return reject("unsupported-syntax", "Node string literal uses an unsupported escape");
      paths.set(match[1], { path, depth: 0 });
      continue;
    }
    match = statement.match(NODE_NAME_ALIAS_PATTERN);
    if (match !== null) {
      const source = paths.get(match[2]);
      if (source === void 0 || source.depth !== 0) {
        return reject("unsupported-dataflow", "Node path aliases are limited to one literal hop");
      }
      paths.set(match[1], { path: source.path, depth: 1 });
      continue;
    }
    match = statement.match(NODE_GENERIC_DECL_PATTERN);
    if (match !== null) {
      const name = match[1];
      const expression = match[2].trim();
      const call2 = parseCall(expression);
      if (call2?.method === "readFileSync") {
        const binding = call2.args[0] === void 0 ? null : resolvePathExpression(call2.args[0]);
        if (binding === null) return reject("dynamic-path", "Node read target is not a literal path binding");
        const encoding = call2.args[1] === void 0 ? null : decodeNodeString(call2.args[1]);
        if (encoding !== "utf8" && encoding !== "utf-8") {
          return reject("unsupported-encoding", "Node text reads require an explicit UTF-8 encoding", binding.path);
        }
        if (call2.args.length !== 2)
          return reject("unsupported-syntax", "Node readFileSync call has unsupported arguments");
        texts.set(name, { path: binding.path });
        continue;
      }
      const replacement = expression.match(NODE_REPLACE_CALL_PATTERN);
      if (replacement !== null) {
        if (!texts.has(replacement[1]))
          return reject("unsupported-dataflow", "Node replace source is not a direct text read");
        const pattern = decodeNodeString(replacement[3]);
        const replacementText = decodeNodeString(replacement[4]);
        if (pattern === null || pattern.length === 0 || replacementText === null || replacementText.includes("$")) {
          return reject("unsupported-expression", "Node replace requires non-empty literal input");
        }
        replacements.set(name, {
          source: replacement[1],
          pattern,
          replacement: replacementText,
          global: replacement[2] === "replaceAll"
        });
        continue;
      }
      const parsedJson = expression.match(NODE_JSON_PARSE_PATTERN);
      if (parsedJson !== null) {
        const text = texts.get(parsedJson[1]);
        if (text === void 0) return reject("unsupported-dataflow", "JSON.parse source is not a direct text read");
        structured.set(name, { path: text.path, keys: [] });
        continue;
      }
      const directJson = expression.match(/^JSON\.parse\((.+)\)$/);
      if (directJson !== null) {
        const read = parseCall(directJson[1]);
        if (read?.method !== "readFileSync" || read.args[0] === void 0) {
          return reject("unsupported-dataflow", "JSON.parse source is not a direct Node text read");
        }
        const binding = resolvePathExpression(read.args[0]);
        const encoding = read.args[1] === void 0 ? null : decodeNodeString(read.args[1]);
        if (binding === null) return reject("dynamic-path", "Node JSON target is not a literal path binding");
        if (encoding !== "utf8" && encoding !== "utf-8") {
          return reject("unsupported-encoding", "Node JSON reads require an explicit UTF-8 encoding", binding.path);
        }
        structured.set(name, { path: binding.path, keys: [] });
        continue;
      }
      return reject("unsupported-dataflow", "Node variable initializer is outside the bounded allowlist");
    }
    match = statement.match(NODE_STRUCTURED_ASSIGN_PATTERN);
    if (match !== null && structured.has(match[1])) {
      const keySegments = [...match[2].matchAll(NODE_KEY_SEGMENT_SCAN_PATTERN)];
      const keys = keySegments.map((segment) => segment[1] ?? decodeNodeString(segment[2]));
      if (keys.length === 0 || keys.some((key) => key === null)) {
        return reject("unsupported-expression", "structured Node mutation requires literal property keys");
      }
      if (!/^(?:true|false|null|-?\d+(?:\.\d+)?|(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"))$/.test(match[3].trim())) {
        return reject("unsupported-expression", "structured Node mutation requires a literal value");
      }
      structured.get(match[1]).keys.push(keys);
      continue;
    }
    match = statement.match(NODE_COUNT_GUARD_PATTERN);
    if (match !== null) {
      const literal = decodeNodeString(match[2]);
      if (literal === null || literal.length === 0 || !texts.has(match[1])) {
        return reject("unsupported-dataflow", "Node count guard is not tied to a direct text read");
      }
      countAssertions.set(`${match[1]}\0${literal}`, Number.parseInt(match[3], 10));
      continue;
    }
    const call = parseCall(statement);
    if (call?.method === "appendFileSync") {
      const binding = call.args[0] === void 0 ? null : resolvePathExpression(call.args[0]);
      if (binding === null) return reject("dynamic-path", "Node append target is not a literal path binding");
      const written = call.args[1] === void 0 ? null : decodeNodeString(call.args[1]);
      const encoding = call.args[2] === void 0 ? "utf8" : decodeNodeString(call.args[2]);
      if (written === null)
        return reject("unsupported-expression", "Node append content must be literal", binding.path);
      if (encoding !== "utf8" && encoding !== "utf-8") {
        return reject("unsupported-encoding", "Node append requires default or UTF-8 encoding", binding.path);
      }
      if (call.args.length < 2 || call.args.length > 3)
        return reject("unsupported-syntax", "Node appendFileSync call has unsupported arguments", binding.path);
      const absolutePath = nodePath4.resolve(cwd, binding.path);
      const content = readPreState(absolutePath, "append", ["pre-command-eof"]);
      if (typeof content !== "string") return content;
      const line = pythonLineAtOffset(content, content.length);
      resolved.push({
        status: "resolved",
        layer: "node",
        idiom: "node-append",
        span: {
          operation: "append",
          absolutePath,
          lineStart: line,
          lineEnd: line,
          written,
          expectedContent: `${content}${written}`,
          simpleCommandIndex: 0
        }
      });
      continue;
    }
    if (call?.method === "writeFileSync") {
      const binding = call.args[0] === void 0 ? null : resolvePathExpression(call.args[0]);
      if (binding === null) return reject("dynamic-path", "Node write target is not a literal path binding");
      if (call.args.length < 2 || call.args.length > 3)
        return reject("unsupported-syntax", "Node writeFileSync call has unsupported arguments", binding.path);
      const encoding = call.args[2] === void 0 ? "utf8" : decodeNodeString(call.args[2]);
      if (encoding !== "utf8" && encoding !== "utf-8") {
        return reject("unsupported-encoding", "Node write requires default or UTF-8 encoding", binding.path);
      }
      const absolutePath = nodePath4.resolve(cwd, binding.path);
      const expression = call.args[1];
      const literal = decodeNodeString(expression);
      if (literal !== null) {
        resolved.push({
          status: "resolved",
          layer: "node",
          idiom: "node-write",
          span: {
            operation: "create-overwrite",
            absolutePath,
            written: literal,
            expectedContent: literal,
            simpleCommandIndex: 0
          }
        });
        continue;
      }
      const directReplacement = expression.match(NODE_REPLACE_CALL_PATTERN);
      const replacement = directReplacement === null ? replacements.get(expression) : {
        source: directReplacement[1],
        pattern: decodeNodeString(directReplacement[3]) ?? "",
        replacement: decodeNodeString(directReplacement[4]) ?? "",
        global: directReplacement[2] === "replaceAll"
      };
      if (replacement !== void 0) {
        if (replacement.pattern.length === 0 || replacement.replacement.includes("$")) {
          return reject("unsupported-expression", "Node replace requires non-empty literal input", absolutePath);
        }
        const rejected = emitReplacement(absolutePath, replacement);
        if (rejected !== null) return rejected;
        continue;
      }
      const serialized = expression.match(/^JSON\.stringify\(([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*null\s*,\s*\d+)?\)$/);
      if (serialized !== null) {
        const value = structured.get(serialized[1]);
        if (value === void 0 || nodePath4.resolve(cwd, value.path) !== absolutePath || value.keys.length === 0) {
          return reject(
            "unsupported-dataflow",
            "JSON read, literal-key mutation, and write are not linked",
            absolutePath
          );
        }
        const content = readPreState(absolutePath, "modify", ["match-locations"]);
        if (typeof content !== "string") return content;
        for (const keyPath of value.keys) {
          const key = keyPath.at(-1);
          const ranges = structuredKeyRanges(content, "json", key);
          if (ranges.length !== 1) {
            return reject(
              "unsupported-expression",
              "structured literal key is absent or ambiguous in pre-state",
              absolutePath,
              preStateRequests
            );
          }
          resolved.push({
            status: "resolved",
            layer: "node",
            idiom: "node-json",
            span: {
              operation: "modify",
              absolutePath,
              lineStart: ranges[0].start,
              lineEnd: ranges[0].end,
              simpleCommandIndex: 0
            }
          });
        }
        continue;
      }
      return reject("unsupported-dataflow", "Node write expression is outside the bounded allowlist", absolutePath);
    }
    if (/\b(?:readFile|writeFile|appendFile)\s*\(/.test(statement) || /\bPromise\b|\.then\s*\(/.test(statement)) {
      return reject("unsupported-dataflow", "asynchronous Node filesystem APIs are outside the bounded recognizer");
    }
    return reject(
      /(?:writeFile|appendFile|readFile|require\s*\()/.test(statement) ? "unsupported-dataflow" : "unsupported-syntax",
      "Node statement is outside the bounded lexical/dataflow allowlist"
    );
  }
  if (resolved.length === 0) return reject("unsupported-dataflow", "Node program has no supported authoring sink");
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_ATTRIBUTION_CANDIDATES;
  if (resolved.length > maxCandidates) {
    return reject(
      "candidate-budget-exceeded",
      `Node program produced ${resolved.length} candidates; the limit is ${maxCandidates}`
    );
  }
  return { resolved, unresolved: [], preStateRequests };
}
function parseCommandLayered(command, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_ATTRIBUTION_CANDIDATES;
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error("maxCandidates must be a positive safe integer");
  }
  if (!canCarryStaticIntent(command)) return { resolved: [], unresolved: [], preStateRequests: [] };
  const trimmed = command.trimStart();
  if (/^python(?:3(?:\.\d+)?)?\b/.test(trimmed)) {
    const python = parsePythonAttribution(command, options);
    if (python !== null) return python;
  }
  if (/^node\b/.test(trimmed)) {
    const node = parseNodeAttribution(command, options);
    if (node !== null) return node;
  }
  const loop = command.trim().match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]*?)\s*;\s*do\s+([\s\S]*?)\s*;\s*done\s*$/);
  if (loop !== null) {
    const [, variable, listSource, body] = loop;
    if (body.includes("for ") || body.includes("while ") || body.includes("until ")) {
      return {
        resolved: [],
        unresolved: [
          unresolved("literal-loop", "literal-list-loop", "unsupported-syntax", "nested loop bodies are not supported")
        ],
        preStateRequests: []
      };
    }
    if (listSource.includes("$(") || listSource.includes("`")) {
      return {
        resolved: [],
        unresolved: [
          unresolved("literal-loop", "literal-list-loop", "command-substitution", "loop list uses command substitution")
        ],
        preStateRequests: []
      };
    }
    if (GLOB_META.test(listSource)) {
      return {
        resolved: [],
        unresolved: [unresolved("literal-loop", "literal-list-loop", "glob-path", "loop list uses glob expansion")],
        preStateRequests: []
      };
    }
    if (SHELL_EXPANSION.test(listSource)) {
      return {
        resolved: [],
        unresolved: [
          unresolved("literal-loop", "literal-list-loop", "dynamic-list", "loop list is not a literal list")
        ],
        preStateRequests: []
      };
    }
    const bindings = argvOf(listSource);
    if (bindings === null || bindings.length === 0) {
      return {
        resolved: [],
        unresolved: [
          unresolved("literal-loop", "literal-list-loop", "unsupported-syntax", "loop list cannot be tokenized")
        ],
        preStateRequests: []
      };
    }
    if (bindings.length > maxCandidates) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            "literal-loop",
            "literal-list-loop",
            "candidate-budget-exceeded",
            `literal list has ${bindings.length} bindings; the limit is ${maxCandidates}`
          )
        ],
        preStateRequests: []
      };
    }
    const resolved2 = [];
    const unresolvedMatches2 = [];
    const preStateRequests = [];
    for (const binding of bindings) {
      const dynamic = classifyDynamicWord(binding);
      if (dynamic !== null) {
        return {
          resolved: [],
          unresolved: [
            unresolved("literal-loop", "literal-list-loop", dynamic, "loop binding is not literal", binding)
          ],
          preStateRequests: []
        };
      }
      const expanded = expandLiteralLoopVariable(body, variable, binding);
      if (expanded.unsafeUnquoted) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              "literal-loop",
              "literal-list-loop",
              "unsupported-dataflow",
              "unquoted loop expansion would perform shell field splitting"
            )
          ],
          preStateRequests: []
        };
      }
      if (expanded.replacements === 0) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              "literal-loop",
              "literal-list-loop",
              "unsupported-dataflow",
              "loop variable is not used in an expandable shell context"
            )
          ],
          preStateRequests: []
        };
      }
      const result = parseCommandLayered(expanded.command, { ...options, maxCandidates });
      resolved2.push(...result.resolved.map((match) => ({ ...match, layer: "literal-loop" })));
      unresolvedMatches2.push(...result.unresolved.map((match) => ({ ...match, layer: "literal-loop" })));
      preStateRequests.push(...result.preStateRequests);
    }
    if (unresolvedMatches2.length > 0) return { resolved: [], unresolved: unresolvedMatches2, preStateRequests: [] };
    if (resolved2.length > maxCandidates) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            "literal-loop",
            "literal-list-loop",
            "candidate-budget-exceeded",
            `literal expansion produced ${resolved2.length} candidates; the limit is ${maxCandidates}`
          )
        ],
        preStateRequests: []
      };
    }
    for (const match of resolved2) {
      if (match.span.operation !== "modify") continue;
      if (preStateRequests.some((request) => request.absolutePath === match.span.absolutePath)) continue;
      preStateRequests.push({
        absolutePath: match.span.absolutePath,
        operation: match.span.operation,
        requirement: "match-locations",
        simpleCommandIndex: match.span.simpleCommandIndex
      });
    }
    return { resolved: resolved2, unresolved: [], preStateRequests };
  }
  const split = splitTopLevel(command);
  const hasPipeline = split.stages.some((stage) => stage.precededBy === "pipe");
  const hasLayeredPipelineStage = split.stages.some((stage) => {
    const stageText = stage.text.trimStart();
    return /^(?:python(?:3(?:\.\d+)?)?|node|for)\b/.test(stageText) || parsePatternCommand(stage.text) !== null;
  });
  if (split.malformed === void 0 && split.stages.length > 1 && (!hasPipeline || hasLayeredPipelineStage)) {
    if (split.stages.some((stage) => argvOf(stage.text)?.[0] === "cd")) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            "pattern-substitution",
            "compound-command",
            "dynamic-path",
            "a directory-changing compound cannot safely resolve substitution targets"
          )
        ],
        preStateRequests: []
      };
    }
    const resolved2 = [];
    const unresolvedMatches2 = [];
    const preStateRequests = [];
    for (let index = 0; index < split.stages.length; index += 1) {
      const stage = split.stages[index];
      const child = parseCommandLayered(stage.text, options);
      const join9 = stage.precededBy === "and" ? "&&" : stage.precededBy === "or" ? "||" : void 0;
      resolved2.push(
        ...child.resolved.map((match) => ({
          ...match,
          span: { ...match.span, simpleCommandIndex: index, join: join9 }
        }))
      );
      unresolvedMatches2.push(...child.unresolved.map((match) => ({ ...match, simpleCommandIndex: index })));
      preStateRequests.push(...child.preStateRequests.map((request) => ({ ...request, simpleCommandIndex: index })));
    }
    if (hasPipeline) {
      const pipelineDetailed = parseCommandDetailed(command, options);
      const pipelineReads = pipelineDetailed.flatMap(
        (match) => match.status === "resolved" && match.span.operation === "read" ? [{ status: "resolved", layer: "shell", idiom: match.idiom, span: match.span }] : []
      );
      const pipelineUnresolved = pipelineDetailed.flatMap(
        (match) => match.status === "unresolved" ? [unresolved("shell", match.idiom, stableReason(match), match.reason, match.fileArg)] : []
      );
      const layeredReads = resolved2.filter(({ layer, span }) => layer !== "shell" && span.operation === "read");
      const writes = resolved2.filter(({ span }) => span.operation !== "read");
      resolved2.splice(0, resolved2.length, ...pipelineReads, ...layeredReads, ...writes);
      const layeredUnresolved = unresolvedMatches2.filter(({ layer }) => layer !== "shell");
      unresolvedMatches2.splice(0, unresolvedMatches2.length, ...pipelineUnresolved, ...layeredUnresolved);
    }
    if (resolved2.length > maxCandidates) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            "shell",
            "compound-command",
            "candidate-budget-exceeded",
            `compound produced ${resolved2.length} candidates; the limit is ${maxCandidates}`
          )
        ],
        preStateRequests: []
      };
    }
    return { resolved: resolved2, unresolved: unresolvedMatches2, preStateRequests };
  }
  const patternCommand = split.malformed === void 0 && split.stages.length === 1 ? parsePatternCommand(split.stages[0].text) : null;
  if (patternCommand !== null) {
    const numericMatch = patternCommand.kind === "sed" ? patternCommand.script.match(/^(\d+)(?:,(\d+))?s\W/) : null;
    const numericSed = numericMatch !== null;
    if (numericMatch !== null) {
      if (patternCommand.files.length === 0) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              "shell",
              "sed-inplace",
              "unsupported-syntax",
              "numeric in-place substitution has no file operand"
            )
          ],
          preStateRequests: []
        };
      }
      const start = Number.parseInt(numericMatch[1], 10);
      const end = Number.parseInt(numericMatch[2] ?? numericMatch[1], 10);
      const substitution = parseLiteralSubstitution(patternCommand.script.slice(numericMatch[0].indexOf("s")));
      if (substitution === null) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              "pattern-substitution",
              "sed-inplace",
              "unsupported-expression",
              "numeric substitutions require a literal pattern and replacement for post-state verification"
            )
          ],
          preStateRequests: []
        };
      }
      const resolved2 = [];
      const unresolvedMatches2 = [];
      const preStateRequests = [];
      for (const file of patternCommand.files) {
        const reason = classifyDynamicWord(file);
        if (reason !== null) {
          unresolvedMatches2.push(unresolved("shell", "sed-inplace", reason, "target path is dynamic", file));
          continue;
        }
        const absolutePath = nodePath4.resolve(cwd, file);
        const content = options.readPreState?.(absolutePath) ?? null;
        const expectedContent = content === null || content.includes("\0") ? void 0 : content.split(/(?<=\n)/).map(
          (line, index) => index + 1 >= start && index + 1 <= end ? replaceLiteral(line, substitution.pattern, substitution.replacement, substitution.global) : line
        ).join("");
        resolved2.push({
          status: "resolved",
          layer: "shell",
          idiom: "sed-inplace",
          span: {
            operation: "modify",
            absolutePath,
            lineStart: start,
            lineEnd: end,
            expectedContent,
            simpleCommandIndex: patternCommand.simpleCommandIndex
          }
        });
        if (expectedContent !== void 0) {
          preStateRequests.push({
            absolutePath,
            operation: "modify",
            requirement: "match-locations",
            simpleCommandIndex: patternCommand.simpleCommandIndex
          });
        }
        if (patternCommand.backupSuffix !== void 0 && patternCommand.backupSuffix !== "") {
          resolved2.push({
            status: "resolved",
            layer: "shell",
            idiom: "sed-inplace",
            span: {
              operation: "create-overwrite",
              absolutePath: `${nodePath4.resolve(cwd, file)}${patternCommand.backupSuffix}`,
              simpleCommandIndex: patternCommand.simpleCommandIndex
            }
          });
        }
      }
      if (unresolvedMatches2.length > 0) return { resolved: [], unresolved: unresolvedMatches2, preStateRequests: [] };
      if (resolved2.length > maxCandidates) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              "shell",
              "sed-inplace",
              "candidate-budget-exceeded",
              `numeric substitution produced ${resolved2.length} candidates; the limit is ${maxCandidates}`
            )
          ],
          preStateRequests: []
        };
      }
      return { resolved: resolved2, unresolved: [], preStateRequests };
    }
    if (!numericSed) {
      let addressLiteral = null;
      let substitutionSource = patternCommand.script;
      if (patternCommand.kind === "sed" && substitutionSource.startsWith("/")) {
        const address = readDelimitedField(substitutionSource, 1, "/");
        if (address === null) substitutionSource = "";
        else {
          addressLiteral = decodeLiteralField(address.raw, "/", false);
          if (addressLiteral === "") addressLiteral = null;
          substitutionSource = substitutionSource.slice(address.next);
        }
      }
      const substitution = parseLiteralSubstitution(substitutionSource);
      const patternNewlines = substitution?.pattern.match(/\n/g)?.length ?? 0;
      const replacementNewlines = substitution?.replacement.match(/\n/g)?.length ?? 0;
      if (substitution === null || patternNewlines !== replacementNewlines || patternCommand.kind !== "perl-zero" && patternNewlines > 0) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              "pattern-substitution",
              patternCommand.kind === "sed" ? "sed-inplace" : "perl-inplace",
              "unsupported-expression",
              "only literal line-count-preserving substitutions are supported"
            )
          ],
          preStateRequests: []
        };
      }
      if (patternCommand.files.length === 0) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              "pattern-substitution",
              patternCommand.kind === "sed" ? "sed-inplace" : "perl-inplace",
              "unsupported-syntax",
              "in-place substitution has no literal file operand"
            )
          ],
          preStateRequests: []
        };
      }
      if (addressLiteral === null && patternCommand.kind === "sed" && patternCommand.script.startsWith("/")) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              "pattern-substitution",
              "sed-inplace",
              "unsupported-expression",
              "sed address is not a literal pattern"
            )
          ],
          preStateRequests: []
        };
      }
      const resolved2 = [];
      const unresolvedMatches2 = [];
      const preStateRequests = [];
      for (const file of patternCommand.files) {
        const reason = classifyDynamicWord(file);
        if (reason !== null) {
          unresolvedMatches2.push(
            unresolved(
              "pattern-substitution",
              patternCommand.kind === "sed" ? "sed-inplace" : "perl-inplace",
              reason,
              "target path is dynamic",
              file
            )
          );
          continue;
        }
        const absolutePath = nodePath4.resolve(cwd, file);
        preStateRequests.push({
          absolutePath,
          operation: "modify",
          requirement: "match-locations",
          simpleCommandIndex: patternCommand.simpleCommandIndex
        });
        if (patternCommand.kind === "perl-zero") {
          preStateRequests.push({
            absolutePath,
            operation: "modify",
            requirement: "deleted-text",
            simpleCommandIndex: patternCommand.simpleCommandIndex
          });
        }
        const content = options.readPreState?.(absolutePath) ?? null;
        if (content === null) {
          unresolvedMatches2.push(
            unresolved(
              "pattern-substitution",
              patternCommand.kind === "sed" ? "sed-inplace" : "perl-inplace",
              "missing-pre-state",
              "literal substitution range requires pre-command text",
              absolutePath
            )
          );
          continue;
        }
        if (content.includes("\0")) {
          unresolvedMatches2.push(
            unresolved(
              "pattern-substitution",
              patternCommand.kind === "sed" ? "sed-inplace" : "perl-inplace",
              "binary-content",
              "substitution range recovery does not accept NUL-delimited content",
              absolutePath
            )
          );
          continue;
        }
        let ranges = literalOccurrenceRanges(content, substitution.pattern);
        if (addressLiteral !== null) {
          const addressedLines = new Set(literalOccurrenceRanges(content, addressLiteral).map(({ start }) => start));
          ranges = ranges.filter(({ start, end }) => start === end && addressedLines.has(start));
        }
        if (patternCommand.kind === "perl" && ranges.length > 1) {
          ranges = [{ start: ranges[0].start, end: ranges[ranges.length - 1].end }];
        } else if (patternCommand.kind === "perl-zero" && !substitution.global) {
          ranges = ranges.slice(0, 1);
        }
        const expectedContent = expectedSubstitutionContent(content, substitution, patternCommand.kind, addressLiteral);
        for (const range of ranges) {
          resolved2.push({
            status: "resolved",
            layer: "pattern-substitution",
            idiom: patternCommand.kind === "sed" ? "sed-inplace" : "perl-inplace",
            span: {
              operation: "modify",
              absolutePath,
              lineStart: range.start,
              lineEnd: range.end,
              expectedContent,
              simpleCommandIndex: patternCommand.simpleCommandIndex
            }
          });
        }
        if (patternCommand.backupSuffix !== void 0 && patternCommand.backupSuffix !== "") {
          resolved2.push({
            status: "resolved",
            layer: "pattern-substitution",
            idiom: "sed-inplace",
            span: {
              operation: "create-overwrite",
              absolutePath: `${absolutePath}${patternCommand.backupSuffix}`,
              simpleCommandIndex: patternCommand.simpleCommandIndex
            }
          });
        }
      }
      if (unresolvedMatches2.length > 0) return { resolved: [], unresolved: unresolvedMatches2, preStateRequests };
      if (resolved2.length > maxCandidates) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              "pattern-substitution",
              patternCommand.kind === "sed" ? "sed-inplace" : "perl-inplace",
              "candidate-budget-exceeded",
              `substitution produced ${resolved2.length} candidates; the limit is ${maxCandidates}`
            )
          ],
          preStateRequests: []
        };
      }
      return { resolved: resolved2, unresolved: [], preStateRequests };
    }
  }
  const argv = argvOf(command.trim());
  if (argv !== null) {
    if (argv[0] === "git" && ["rebase", "merge", "cherry-pick", "reset"].includes(argv[1] ?? "")) {
      return {
        resolved: [],
        unresolved: [
          unresolved("shell", "history-operation", "history-operation", "history-changing commands have no file intent")
        ],
        preStateRequests: []
      };
    }
    if (["yarn", "npm", "pnpm", "make"].includes(argv[0]) && /(?:generate|build|install)/.test(argv.slice(1).join(" "))) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            "shell",
            "generator-operation",
            "generator-operation",
            "generators have no bounded static output set"
          )
        ],
        preStateRequests: []
      };
    }
  }
  const detailed = parseCommandDetailed(command, options);
  const resolved = detailed.flatMap(
    (match) => match.status === "resolved" ? [{ status: "resolved", layer: "shell", idiom: match.idiom, span: match.span }] : []
  );
  const unresolvedMatches = detailed.flatMap(
    (match) => match.status === "unresolved" ? [unresolved("shell", match.idiom, stableReason(match), match.reason, match.fileArg)] : []
  );
  if (resolved.length > maxCandidates) {
    return {
      resolved: [],
      unresolved: [
        unresolved(
          "shell",
          "deterministic-shell",
          "candidate-budget-exceeded",
          `command produced ${resolved.length} candidates; the limit is ${maxCandidates}`
        )
      ],
      preStateRequests: []
    };
  }
  return { resolved, unresolved: unresolvedMatches, preStateRequests: [] };
}
var DEFAULT_PLANNED_TOUCH_BUDGETS = Object.freeze({
  maxTouchesPerRecord: DEFAULT_MAX_ATTRIBUTION_CANDIDATES,
  maxRangesPerTouch: DEFAULT_MAX_ATTRIBUTION_CANDIDATES,
  maxEvidenceBytes: 16 * 1024,
  maxRecordBytes: 64 * 1024
});
function createPlannedTouchStore(layout, budgets) {
  validateBudgets(budgets);
  if (layout.base.length === 0) throw new Error("planned-touch base directory must not be empty");
  const recordPaths = (sessionId, toolUseId) => {
    if (sessionId.length === 0 || toolUseId.length === 0) {
      throw new Error("planned-touch session and tool-use ids must not be empty");
    }
    return {
      dir: layout.plannedTouchesDir(sessionId),
      record: layout.plannedTouchRecordFile(sessionId, toolUseId),
      consumed: layout.plannedTouchConsumedFile(sessionId, toolUseId)
    };
  };
  const makeRestrictiveDir = (dir) => {
    fs4.mkdirSync(dir, { recursive: true, mode: 448 });
    fs4.chmodSync(layout.base, 448);
    fs4.chmodSync(nodePath4.dirname(dir), 448);
    fs4.chmodSync(dir, 448);
  };
  const claim = (consumed) => {
    try {
      fs4.writeFileSync(consumed, "", { encoding: "utf8", flag: "wx", mode: 384 });
      return true;
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    }
  };
  const take = (sessionId, toolUseId) => {
    pruneStaleSessionsThrottled(layout);
    const paths = recordPaths(sessionId, toolUseId);
    makeRestrictiveDir(paths.dir);
    if (!claim(paths.consumed)) return { status: "consumed" };
    let raw;
    try {
      raw = fs4.readFileSync(paths.record, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { status: "missing" };
      throw error;
    } finally {
      fs4.rmSync(paths.record, { force: true });
    }
    try {
      const record2 = normalizePlannedTouchRecord(JSON.parse(raw), budgets);
      return { status: "record", record: record2 };
    } catch {
      return { status: "missing" };
    }
  };
  return {
    put(record2) {
      pruneStaleSessionsThrottled(layout);
      const normalized = normalizePlannedTouchRecord(record2, budgets);
      const paths = recordPaths(normalized.sessionId, normalized.toolUseId);
      makeRestrictiveDir(paths.dir);
      if (fs4.existsSync(paths.consumed)) {
        throw new Error("planned-touch record has already been consumed or discarded");
      }
      const encoded = JSON.stringify(normalized);
      const tmp = nodePath4.join(
        paths.dir,
        `.${nodePath4.basename(paths.record)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`
      );
      try {
        fs4.writeFileSync(tmp, encoded, { encoding: "utf8", mode: 384 });
        fs4.chmodSync(tmp, 384);
        fs4.renameSync(tmp, paths.record);
      } catch (error) {
        fs4.rmSync(tmp, { force: true });
        throw error;
      }
    },
    consume(sessionId, toolUseId) {
      const result = take(sessionId, toolUseId);
      return result.status === "record" ? result.record : null;
    },
    take,
    discard(sessionId, toolUseId) {
      pruneStaleSessionsThrottled(layout);
      const paths = recordPaths(sessionId, toolUseId);
      makeRestrictiveDir(paths.dir);
      claim(paths.consumed);
      fs4.rmSync(paths.record, { force: true });
    }
  };
}
var OPERATIONS = /* @__PURE__ */ new Set([
  "read",
  "create-overwrite",
  "append",
  "modify",
  "rename-copy",
  "truncate",
  "delete"
]);
function validateBudgets(budgets) {
  for (const [name, value] of [
    ["maxTouchesPerRecord", budgets.maxTouchesPerRecord],
    ["maxRangesPerTouch", budgets.maxRangesPerTouch],
    ["maxEvidenceBytes", budgets.maxEvidenceBytes],
    ["maxRecordBytes", budgets.maxRecordBytes]
  ]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`planned-touch ${name} must be a non-negative integer`);
  }
}
function validRange(value) {
  if (typeof value !== "object" || value === null) return false;
  const range = value;
  return Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.start >= 1 && range.end >= range.start;
}
function normalizeEvidence(value) {
  if (value === void 0) return void 0;
  switch (value.kind) {
    case "literal-occurrences":
      if (typeof value.literal !== "string" || !Array.isArray(value.ranges) || !value.ranges.every(validRange) || !Number.isSafeInteger(value.expectedCount) || value.expectedCount < 0) {
        throw new Error("invalid literal-occurrences evidence");
      }
      return {
        kind: value.kind,
        literal: value.literal,
        ranges: value.ranges.map(({ start, end }) => ({ start, end })),
        expectedCount: value.expectedCount
      };
    case "anchor":
      if (typeof value.literal !== "string" || !Number.isSafeInteger(value.line) || value.line < 1) {
        throw new Error("invalid anchor evidence");
      }
      return { kind: value.kind, literal: value.literal, line: value.line };
    case "eof":
      if (!Number.isSafeInteger(value.line) || value.line < 0 || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0) {
        throw new Error("invalid eof evidence");
      }
      return { kind: value.kind, line: value.line, byteLength: value.byteLength };
    case "content-digest":
      if (value.algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(value.digest) || !validRange(value.range)) {
        throw new Error("invalid content-digest evidence");
      }
      return {
        kind: value.kind,
        algorithm: value.algorithm,
        digest: value.digest,
        range: { start: value.range.start, end: value.range.end }
      };
    case "tracked":
      if (value.tracked !== true) throw new Error("invalid tracked evidence");
      return { kind: value.kind, tracked: true };
    default:
      throw new Error("invalid planned-touch evidence kind");
  }
}
function normalizePlannedTouchRecord(record2, budgets) {
  if (typeof record2 !== "object" || record2 === null || record2.version !== 1 || typeof record2.sessionId !== "string" || record2.sessionId.length === 0 || typeof record2.toolUseId !== "string" || record2.toolUseId.length === 0 || typeof record2.repoRoot !== "string" || record2.repoRoot.length === 0 || !Number.isFinite(record2.createdAtMs) || record2.createdAtMs < 0 || !Array.isArray(record2.touches)) {
    throw new Error("invalid planned-touch record");
  }
  const repoRoot = toPosix(record2.repoRoot);
  if (!nodePath4.isAbsolute(record2.repoRoot) && !/^[A-Za-z]:\//.test(repoRoot)) {
    throw new Error("planned-touch repository root must be absolute");
  }
  if (record2.touches.length > budgets.maxTouchesPerRecord) {
    throw new Error("planned-touch record exceeds touch budget");
  }
  let evidenceBytes = 0;
  const touches = record2.touches.map((touch) => {
    if (typeof touch !== "object" || touch === null) throw new Error("invalid planned touch");
    const repoRelativePath = toPosix(touch.repoRelativePath);
    if (repoRelativePath.length === 0 || repoRelativePath.startsWith("/") || /^[A-Za-z]:\//.test(repoRelativePath) || repoRelativePath.split("/").some((part) => part === "..")) {
      throw new Error("planned-touch path must be repository-relative");
    }
    if (!OPERATIONS.has(touch.operation)) throw new Error("invalid planned-touch operation");
    if (!Array.isArray(touch.ranges) || touch.ranges.length > budgets.maxRangesPerTouch) {
      throw new Error("planned touch exceeds range budget");
    }
    if (!touch.ranges.every(validRange)) throw new Error("invalid planned-touch range");
    if (!Number.isSafeInteger(touch.simpleCommandIndex) || touch.simpleCommandIndex < 0) {
      throw new Error("invalid planned-touch command index");
    }
    const evidence = normalizeEvidence(touch.evidence);
    if (evidence !== void 0) evidenceBytes += Buffer.byteLength(JSON.stringify(evidence));
    return {
      repoRelativePath,
      operation: touch.operation,
      ranges: touch.ranges.map((range) => ({ start: range.start, end: range.end })),
      simpleCommandIndex: touch.simpleCommandIndex,
      ...evidence === void 0 ? {} : { evidence }
    };
  });
  if (evidenceBytes > budgets.maxEvidenceBytes) throw new Error("planned-touch record exceeds evidence budget");
  const normalized = {
    version: 1,
    sessionId: record2.sessionId,
    toolUseId: record2.toolUseId,
    repoRoot,
    createdAtMs: record2.createdAtMs,
    touches
  };
  if (Buffer.byteLength(JSON.stringify(normalized)) > budgets.maxRecordBytes) {
    throw new Error("planned-touch record exceeds byte budget");
  }
  return normalized;
}
var queryTrackedFiles = (repoRoot, repoRelativePaths) => {
  if (repoRelativePaths.length === 0) return /* @__PURE__ */ new Set();
  const stdout = execFileSync4("git", ["-C", repoRoot, "ls-files", "-z", "--cached", "--", ...repoRelativePaths], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  return new Set(
    stdout.split("\0").filter((path) => path.length > 0).map(toPosix)
  );
};
var queryIgnoredFiles = (repoRoot, repoRelativePaths) => {
  if (repoRelativePaths.length === 0) return /* @__PURE__ */ new Set();
  const input = `${repoRelativePaths.join("\0")}\0`;
  let stdout;
  try {
    stdout = execFileSync4("git", ["-C", repoRoot, "check-ignore", "--no-index", "-z", "--stdin"], {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"]
    });
  } catch (error) {
    const failure = error;
    if (failure.status !== 1) throw error;
    stdout = typeof failure.stdout === "string" ? failure.stdout : "";
  }
  return new Set(
    stdout.split("\0").filter((path) => path.length > 0).map(toPosix)
  );
};
function filterTrackedEligibility(candidates, options) {
  const eligible = [];
  const dropped = [];
  const errors = [];
  if (candidates.length === 0) return { eligible, dropped, errors, ignoreQueryCount: 0, trackedQueryCount: 0 };
  const cwdRepoRoot = resolveRepoRoot(options.cwd);
  if (cwdRepoRoot === null) {
    return {
      eligible,
      dropped: candidates.map((candidate) => ({ candidate, reason: "outside-repository" })),
      errors,
      ignoreQueryCount: 0,
      trackedQueryCount: 0
    };
  }
  const inScope = [];
  const spanRoot = resolveSpanRoot(cwdRepoRoot);
  for (const candidate of candidates) {
    const canonicalPath = canonicalizePath(candidate.absolutePath);
    const relativePath = nodePath4.relative(cwdRepoRoot, canonicalPath);
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${nodePath4.sep}`) || nodePath4.isAbsolute(relativePath)) {
      dropped.push({ candidate, reason: "outside-repository" });
      continue;
    }
    const repoRelativePath = toPosix(relativePath);
    if (isInsideSpanRoot(repoRelativePath, spanRoot)) {
      dropped.push({ candidate, reason: "span-metadata-path" });
      continue;
    }
    inScope.push({ candidate, repoRoot: cwdRepoRoot, repoRelativePath });
  }
  const ignoreQuery = options.queryIgnoredFiles ?? queryIgnoredFiles;
  let ignoreQueryCount = 0;
  let ignored;
  try {
    const ignorePaths = [...new Set(inScope.map(({ repoRelativePath }) => repoRelativePath))];
    if (ignorePaths.length > 0) ignoreQueryCount += 1;
    ignored = ignoreQuery(cwdRepoRoot, ignorePaths);
  } catch (error) {
    errors.push({
      kind: "ignored-files-query-failed",
      repoRoot: cwdRepoRoot,
      message: error instanceof Error ? error.message : String(error)
    });
    dropped.push(...inScope.map(({ candidate }) => ({ candidate, reason: "eligibility-query-failed" })));
    const candidateOrder2 = new Map(candidates.map((candidate, index) => [candidate, index]));
    dropped.sort(
      (left, right) => (candidateOrder2.get(left.candidate) ?? 0) - (candidateOrder2.get(right.candidate) ?? 0)
    );
    return { eligible, dropped, errors, ignoreQueryCount, trackedQueryCount: 0 };
  }
  const normalizedIgnored = new Set([...ignored].map(toPosix));
  const eligibleForMembership = inScope.filter(({ candidate, repoRelativePath }) => {
    if (!normalizedIgnored.has(repoRelativePath)) return true;
    dropped.push({ candidate, reason: "ignored-path" });
    return false;
  });
  const byRepo = /* @__PURE__ */ new Map();
  for (const scoped of eligibleForMembership) {
    const group = byRepo.get(scoped.repoRoot) ?? [];
    group.push(scoped);
    byRepo.set(scoped.repoRoot, group);
  }
  let trackedQueryCount = 0;
  const query = options.queryTrackedFiles ?? queryTrackedFiles;
  for (const [repoRoot, group] of byRepo) {
    const paths = [...new Set(group.map(({ repoRelativePath }) => repoRelativePath))];
    let tracked;
    trackedQueryCount += 1;
    try {
      tracked = query(repoRoot, paths);
    } catch (error) {
      errors.push({
        kind: "tracked-files-query-failed",
        repoRoot,
        message: error instanceof Error ? error.message : String(error)
      });
      dropped.push(...group.map(({ candidate }) => ({ candidate, reason: "eligibility-query-failed" })));
      continue;
    }
    const normalizedTracked = new Set([...tracked].map(toPosix));
    for (const scoped of group) {
      if (normalizedTracked.has(scoped.repoRelativePath)) eligible.push(scoped.candidate);
      else dropped.push({ candidate: scoped.candidate, reason: "untracked-path" });
    }
  }
  const candidateOrder = new Map(candidates.map((candidate, index) => [candidate, index]));
  eligible.sort((left, right) => (candidateOrder.get(left) ?? 0) - (candidateOrder.get(right) ?? 0));
  dropped.sort((left, right) => (candidateOrder.get(left.candidate) ?? 0) - (candidateOrder.get(right.candidate) ?? 0));
  return { eligible, dropped, errors, ignoreQueryCount, trackedQueryCount };
}

// src/common/touch-core.ts
import { execFileSync as execFileSync5 } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs5 from "node:fs";
import { basename as basename4, dirname as dirname5, join as join4 } from "node:path";

// src/common/anchor-tree.ts
function collapseByPath(rows) {
  const order = [];
  const byPath = /* @__PURE__ */ new Map();
  for (const row of rows) {
    let anchor = byPath.get(row.path);
    if (!anchor) {
      anchor = { path: row.path, ranges: [] };
      byPath.set(row.path, anchor);
      order.push(row.path);
    }
    anchor.ranges.push({ range: row.range, suffix: row.suffix });
  }
  return order.map((path) => byPath.get(path));
}
function splitSegments(path) {
  if (path.length === 0) return null;
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0)) return null;
  return segments;
}
function findOrCreateDir(parent, name) {
  for (const child of parent.children) {
    if (child.kind === "dir" && child.name === name) return child;
  }
  const node = { kind: "dir", name, children: [] };
  parent.children.push(node);
  return node;
}
function insertAnchor(root, segments, anchor) {
  let cur = root;
  for (let i = 0; i < segments.length - 1; i++) {
    cur = findOrCreateDir(cur, segments[i]);
  }
  cur.children.push({ kind: "leaf", name: segments[segments.length - 1], anchor });
}
function buildForest(anchors) {
  const root = { kind: "dir", name: "", children: [] };
  for (const anchor of anchors) {
    const segments = splitSegments(anchor.path);
    if (segments === null) {
      root.children.push({ kind: "leaf", name: anchor.path, anchor });
      continue;
    }
    insertAnchor(root, segments, anchor);
  }
  return root.children;
}
function foldChain(node) {
  let name = node.name;
  let cur = node;
  while (cur.kind === "dir" && cur.children.length === 1) {
    const child = cur.children[0];
    name = `${name}/${child.name}`;
    cur = child;
  }
  return { name, node: cur };
}
function rangeRank(range) {
  switch (range.kind) {
    case "whole-file":
      return 0;
    case "range":
      return 1;
    case "truncated":
      return 2;
  }
}
function compareRangeEntries(a, b) {
  const rank = rangeRank(a.range) - rangeRank(b.range);
  if (rank !== 0) return rank;
  if (a.range.kind === "range" && b.range.kind === "range") {
    return a.range.start - b.range.start || a.range.end - b.range.end;
  }
  return 0;
}
function labelFor(range, sole) {
  switch (range.kind) {
    case "range":
      return `#L${range.start}-L${range.end}`;
    case "whole-file":
      return sole ? null : "(whole file)";
    case "truncated":
      return "(truncated in source \u2014 anchor incomplete)";
  }
}
var cachedSegmenter;
function graphemeSegmenter() {
  if (cachedSegmenter === void 0) {
    try {
      cachedSegmenter = { value: new Intl.Segmenter("en", { granularity: "grapheme" }) };
    } catch {
      cachedSegmenter = { value: null };
    }
  }
  return cachedSegmenter.value;
}
var WIDE_RANGES = [
  [4352, 4447],
  [9001, 9002],
  [9728, 10175],
  [11904, 12350],
  [12353, 13311],
  [13312, 19903],
  [19968, 40959],
  [40960, 42191],
  [43360, 43391],
  [44032, 55203],
  [63744, 64255],
  [65040, 65049],
  [65072, 65135],
  [65280, 65376],
  [65504, 65510],
  [94208, 101119],
  [127462, 127487],
  [127744, 128591],
  [128640, 128767],
  [129280, 129535],
  [129648, 129791],
  [131072, 196605],
  [196608, 262141]
];
function isWideCodePoint(cp) {
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}
function displayWidth(name) {
  const segmenter = graphemeSegmenter();
  let width = 0;
  if (segmenter === null) {
    for (const codePoint of name) {
      width += isWideCodePoint(codePoint.codePointAt(0) ?? 0) ? 2 : 1;
    }
    return width;
  }
  for (const { segment } of segmenter.segment(name)) {
    width += isWideCodePoint(segment.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}
var MAX_ALIGN_COLUMN = 48;
function computeGroupTarget(items) {
  let max = 0;
  for (const item of items) {
    if (item.node.kind === "leaf" && printsRangeColumn(item.node.anchor)) {
      max = Math.max(max, displayWidth(item.name));
    }
  }
  return max > MAX_ALIGN_COLUMN ? 0 : max;
}
function printsRangeColumn(anchor) {
  const { ranges } = anchor;
  if (ranges.length === 0) return false;
  return ranges.some((entry) => labelFor(entry.range, ranges.length === 1) !== null);
}
function computePad(nameWidth, target) {
  if (nameWidth >= target) return " ";
  return " ".repeat(target - nameWidth + 1);
}
function renderLeafLines(name, anchor, ownPrefix, childPrefix, groupTarget) {
  const { ranges } = anchor;
  if (ranges.length === 0) return [`${ownPrefix}${name}`];
  const sorted = [...ranges].sort(compareRangeEntries);
  const sole = sorted.length === 1;
  const nameWidth = displayWidth(name);
  const pad = computePad(nameWidth, groupTarget);
  const blank = " ".repeat(nameWidth + pad.length);
  return sorted.map((entry, i) => {
    const label = labelFor(entry.range, sole);
    if (label === null) return `${ownPrefix}${name}${entry.suffix}`;
    const base = i === 0 ? `${ownPrefix}${name}${pad}` : `${childPrefix}${blank}`;
    return `${base}${label}${entry.suffix}`;
  });
}
function renderNodes(nodes, prefix) {
  const lines = [];
  const items = nodes.map(foldChain);
  const groupTarget = computeGroupTarget(items);
  items.forEach((item, i) => {
    const isLast = i === items.length - 1;
    const ownPrefix = `${prefix}${isLast ? "\u2514\u2500 " : "\u251C\u2500 "}`;
    const childPrefix = `${prefix}${isLast ? "   " : "\u2502  "}`;
    if (item.node.kind === "leaf") {
      lines.push(...renderLeafLines(item.name, item.node.anchor, ownPrefix, childPrefix, groupTarget));
    } else {
      lines.push(`${ownPrefix}${item.name}/`);
      lines.push(...renderNodes(item.node.children, childPrefix));
    }
  });
  return lines;
}
function renderAnchorTree(anchors) {
  const forest = buildForest(anchors);
  return renderNodes(forest, "");
}

// src/common/touch-core.ts
function toNeedleLines(written) {
  if (written.length === 0) return [];
  const trimmed = written.endsWith("\n") ? written.slice(0, -1) : written;
  if (trimmed.length === 0) return [];
  return trimmed.split("\n");
}
function recoverRange(written, onDiskContent) {
  const needle = toNeedleLines(written);
  if (needle.length === 0) return "whole-file";
  const haystack = onDiskContent.split("\n");
  const last = haystack.length - needle.length;
  const starts = [];
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      starts.push(i);
      if (starts.length > 1) break;
    }
  }
  if (starts.length === 1) {
    return { start: starts[0] + 1, end: starts[0] + needle.length };
  }
  return "whole-file";
}
function createRealityProbeCache(paths, changedCandidates = []) {
  return {
    paths: [...new Set(paths)],
    realPaths: null,
    changedCandidates: [...new Set(changedCandidates)],
    changedPaths: null
  };
}
function fileExists(absPath) {
  try {
    fs5.statSync(absPath);
    return true;
  } catch {
    return false;
  }
}
function isFileOnDisk(absPath) {
  try {
    return fs5.statSync(absPath).isFile();
  } catch {
    return false;
  }
}
function contentMatches(post, filePath) {
  try {
    if ("exact" in post) return fs5.readFileSync(filePath, "utf8") === post.exact;
    if ("suffix" in post) {
      const content = fs5.readFileSync(filePath, "utf8");
      return content.endsWith(post.suffix) || content.endsWith(`${post.suffix}
`);
    }
    if ("empty" in post) return fs5.statSync(filePath).size === 0;
    return fs5.statSync(filePath).size === post.size;
  } catch {
    return false;
  }
}
function realPaths(cache, cwd) {
  if (cache.realPaths !== null) return cache.realPaths;
  const real = /* @__PURE__ */ new Set();
  if (cache.paths.length > 0) {
    const repoRoot = resolveRepoRoot(cwd);
    if (repoRoot !== null) {
      const rels = cache.paths.map((p) => relativeToRepo(repoRoot, p));
      const capture = (args) => {
        try {
          return execFileSync5("git", args, {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: DEFAULT_TIMEOUT_MS
          });
        } catch (err) {
          const stdout = err.stdout;
          return typeof stdout === "string" ? stdout : null;
        }
      };
      const lsFiles = capture(["ls-files", "--error-unmatch", "--", ...rels]);
      if (lsFiles !== null) {
        for (const line of lsFiles.split("\n")) {
          const rel = line.trim();
          if (rel.length > 0) real.add(join4(repoRoot, rel));
        }
      }
      const spanList = capture(["span", "list", "--porcelain", ...rels]);
      if (spanList !== null) {
        for (const row of parsePorcelain(spanList)) real.add(join4(repoRoot, row.path));
      }
    }
  }
  cache.realPaths = real;
  return real;
}
function changedOnDisk(cache, cwd) {
  if (cache.changedPaths !== null) return cache.changedPaths;
  const changed = /* @__PURE__ */ new Set();
  if (cache.changedCandidates.length > 0) {
    const repoRoot = resolveRepoRoot(cwd);
    if (repoRoot !== null) {
      const rels = cache.changedCandidates.map((p) => relativeToRepo(repoRoot, p));
      try {
        const out = execFileSync5("git", ["status", "--porcelain", "-z", "--untracked-files=no", "--", ...rels], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: DEFAULT_TIMEOUT_MS
        });
        for (const entry of out.split("\0")) {
          if (entry.length < 4) continue;
          const indexStatus = entry.charAt(0);
          const worktreeStatus = entry.charAt(1);
          if (indexStatus === " " && worktreeStatus === " ") continue;
          if (indexStatus === "?" || indexStatus === "!" || worktreeStatus === "?" || worktreeStatus === "!") {
            continue;
          }
          changed.add(join4(repoRoot, entry.slice(3)));
        }
      } catch (err) {
        void err;
      }
    }
  }
  cache.changedPaths = changed;
  return changed;
}
function workingTreeChanged(probeCache, cwd, absPath) {
  return changedOnDisk(probeCache, cwd).has(absPath);
}
function evaluateWriteGate(input, probeCache) {
  if (input.targetState === "absent") {
    if (fileExists(input.filePath)) return "decisiveFail";
    if (input.postState?.preTrackedDelete === true) return "decisivePass";
    return realPaths(probeCache, input.cwd).has(input.filePath) ? "decisivePass" : "inconclusive";
  }
  if (!isFileOnDisk(input.filePath)) return "decisiveFail";
  const content = input.postState?.content;
  if (content !== void 0) {
    return contentMatches(content, input.filePath) ? "decisivePass" : "decisiveFail";
  }
  if (input.sourcePath !== void 0) {
    if (fileExists(input.sourcePath)) {
      let src;
      let dst;
      try {
        src = fs5.readFileSync(input.sourcePath, "utf8");
        dst = fs5.readFileSync(input.filePath, "utf8");
      } catch {
        return "decisiveFail";
      }
      return src === dst ? "decisivePass" : "decisiveFail";
    }
    return realPaths(probeCache, input.cwd).has(input.sourcePath) ? "pending" : "decisiveFail";
  }
  if (input.renameSourcePath !== void 0) {
    return realPaths(probeCache, input.cwd).has(input.renameSourcePath) ? "decisivePass" : "decisiveFail";
  }
  return "inconclusive";
}
var MAX_CONTEXT_JSON_BYTES = 16 * 1024 * 1024;
var MAX_CONTEXT_ADDRESSES = 4096;
function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}
function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unsupported fields`);
  }
}
function stringField(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function integerField(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}
function booleanField(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}
function arrayField(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function enumField(value, tokens, label) {
  if (typeof value !== "string" || !tokens.includes(value)) throw new Error(`${label} has an unsupported token`);
  return value;
}
function decodeExtent(value, label) {
  const object = record(value, label);
  const kind = enumField(object.kind, ["whole", "lines"], `${label}.kind`);
  if (kind === "whole") {
    exactKeys(object, ["kind"], label);
    return { kind };
  }
  exactKeys(object, ["kind", "start", "end"], label);
  const start = integerField(object.start, `${label}.start`);
  const end = integerField(object.end, `${label}.end`);
  if (start < 1 || end < start) throw new Error(`${label} has an invalid line range`);
  return { kind, start, end };
}
function decodeLocation(value, label) {
  const object = record(value, label);
  exactKeys(object, ["path", "extent"], label);
  return { path: stringField(object.path, `${label}.path`), extent: decodeExtent(object.extent, `${label}.extent`) };
}
function decodeStatus(value, label) {
  const object = record(value, label);
  const code = enumField(
    object.code,
    [
      "FRESH",
      "RESOLVED_PENDING_COMMIT",
      "MOVED",
      "CHANGED",
      "DELETED",
      "CONFLICT",
      "SUBMODULE",
      "CONTENT_UNAVAILABLE"
    ],
    `${label}.code`
  );
  if (code !== "CONTENT_UNAVAILABLE") {
    exactKeys(object, ["code"], label);
    return { code };
  }
  exactKeys(object, ["code", "reason", "detail"], label);
  const reason = enumField(
    object.reason,
    [
      "LFS_NOT_FETCHED",
      "LFS_NOT_INSTALLED",
      "PROMISOR_MISSING",
      "SPARSE_EXCLUDED",
      "FILTER_FAILED",
      "IO_ERROR"
    ],
    `${label}.reason`
  );
  return { code, reason, detail: object.detail };
}
function decodeSource(value, label) {
  return enumField(value, ["WORKTREE", "INDEX", "HEAD"], label);
}
function decodeAnchor(value, label) {
  const object = record(value, label);
  exactKeys(object, ["ordinal", "id", "anchored", "current", "status", "source", "sources"], label);
  return {
    ordinal: integerField(object.ordinal, `${label}.ordinal`),
    id: stringField(object.id, `${label}.id`),
    anchored: decodeLocation(object.anchored, `${label}.anchored`),
    current: object.current === null ? null : decodeLocation(object.current, `${label}.current`),
    status: decodeStatus(object.status, `${label}.status`),
    source: object.source === null ? null : decodeSource(object.source, `${label}.source`),
    sources: arrayField(object.sources, `${label}.sources`).map(
      (source, index) => decodeSource(source, `${label}.sources[${index}]`)
    )
  };
}
function decodeOverlap(value, label) {
  const object = record(value, label);
  exactKeys(object, ["scope", "anchor", "basis", "location", "intersection"], label);
  const anchor = record(object.anchor, `${label}.anchor`);
  exactKeys(anchor, ["ordinal", "id"], `${label}.anchor`);
  return {
    scope: integerField(object.scope, `${label}.scope`),
    anchor: {
      ordinal: integerField(anchor.ordinal, `${label}.anchor.ordinal`),
      id: stringField(anchor.id, `${label}.anchor.id`)
    },
    basis: enumField(object.basis, ["anchored", "current"], `${label}.basis`),
    location: decodeLocation(object.location, `${label}.location`),
    intersection: decodeExtent(object.intersection, `${label}.intersection`)
  };
}
function sameExtent(left, right) {
  return left.kind === "whole" && right.kind === "whole" || left.kind === "lines" && right.kind === "lines" && left.start === right.start && left.end === right.end;
}
function sameLocation(left, right) {
  return left.path === right.path && sameExtent(left.extent, right.extent);
}
function intersectExtents(left, right) {
  if (left.kind === "whole") return right;
  if (right.kind === "whole") return left;
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return start <= end ? { kind: "lines", start, end } : null;
}
function decodeContextDocument(stdout) {
  if (Buffer.byteLength(stdout) > MAX_CONTEXT_JSON_BYTES) throw new Error("context document exceeds the size limit");
  const root = record(JSON.parse(stdout), "context document");
  exactKeys(root, ["schema_version", "scopes", "mutation", "spans"], "context document");
  if (root.schema_version !== 1) throw new Error("unsupported context schema version");
  const scopes = arrayField(root.scopes, "context document.scopes").map((scope, index) => {
    const object = record(scope, `context document.scopes[${index}]`);
    exactKeys(object, ["path", "extent"], `context document.scopes[${index}]`);
    return {
      path: stringField(object.path, `context document.scopes[${index}].path`),
      extent: decodeExtent(object.extent, `context document.scopes[${index}].extent`)
    };
  });
  const mutationObject = record(root.mutation, "context document.mutation");
  exactKeys(
    mutationObject,
    ["requested", "rewritten", "spans_touched", "anchors_updated", "anchors_removed", "identities_collapsed"],
    "context document.mutation"
  );
  const mutation = {
    requested: booleanField(mutationObject.requested, "context document.mutation.requested"),
    rewritten: booleanField(mutationObject.rewritten, "context document.mutation.rewritten"),
    spans_touched: integerField(mutationObject.spans_touched, "context document.mutation.spans_touched"),
    anchors_updated: integerField(mutationObject.anchors_updated, "context document.mutation.anchors_updated"),
    anchors_removed: integerField(mutationObject.anchors_removed, "context document.mutation.anchors_removed"),
    identities_collapsed: integerField(
      mutationObject.identities_collapsed,
      "context document.mutation.identities_collapsed"
    )
  };
  const spans = arrayField(root.spans, "context document.spans").map((span, index) => {
    const label = `context document.spans[${index}]`;
    const object = record(span, label);
    exactKeys(object, ["name", "why", "overlaps", "anchors"], label);
    const why = object.why;
    if (why !== null && typeof why !== "string") throw new Error(`${label}.why must be a string or null`);
    return {
      name: stringField(object.name, `${label}.name`),
      why,
      overlaps: arrayField(object.overlaps, `${label}.overlaps`).map(
        (overlap, overlapIndex) => decodeOverlap(overlap, `${label}.overlaps[${overlapIndex}]`)
      ),
      anchors: arrayField(object.anchors, `${label}.anchors`).map(
        (anchor, anchorIndex) => decodeAnchor(anchor, `${label}.anchors[${anchorIndex}]`)
      )
    };
  });
  for (const [spanIndex, span] of spans.entries()) {
    for (const [overlapIndex, overlap] of span.overlaps.entries()) {
      const label = `context document.spans[${spanIndex}].overlaps[${overlapIndex}]`;
      if (overlap.scope >= scopes.length)
        throw new Error(`context document.spans[${spanIndex}] references an unknown scope`);
      const anchor = span.anchors[overlap.anchor.ordinal];
      if (anchor === void 0 || anchor.id !== overlap.anchor.id || anchor.ordinal !== overlap.anchor.ordinal) {
        throw new Error(`context document.spans[${spanIndex}] references an unknown anchor`);
      }
      const basisLocation = overlap.basis === "anchored" ? anchor.anchored : anchor.current;
      if (basisLocation === null)
        throw new Error(`${label} uses current basis for an anchor without a current location`);
      if (!sameLocation(overlap.location, basisLocation)) {
        throw new Error(`${label}.location does not equal its referenced ${overlap.basis} location`);
      }
      const scope = scopes[overlap.scope];
      if (scope.path !== overlap.location.path) throw new Error(`${label} crosses scope and location paths`);
      const expectedIntersection = intersectExtents(scope.extent, overlap.location.extent);
      if (expectedIntersection === null || !sameExtent(expectedIntersection, overlap.intersection))
        throw new Error(`${label}.intersection is not the exact scope/location intersection`);
    }
  }
  return { schema_version: 1, scopes, mutation, spans };
}
function driftKey(name, status) {
  return `${name}	${status}`;
}
function anchorText(row) {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}
function cleanHeader(fileName) {
  return `${fileName} has implicit dependencies:`;
}
function cleanFooter(fileName) {
  return `If you change ${fileName} check the other files to confirm they still work together.`;
}
function driftHeader(driftedCount, kind) {
  if (kind === "write") {
    return driftedCount === 1 ? "This edit put an implicit dependency out of date:" : "This edit put implicit dependencies out of date:";
  }
  return driftedCount === 1 ? "This file has an implicit dependency out of date:" : "This file has implicit dependencies out of date:";
}
function driftFooter(driftedNames) {
  if (driftedNames.length === 1) {
    const name = driftedNames[0];
    return `Restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, swap the old anchor for the new one with \`git span replace\`. Update or retire the why only if its meaning changed. Require \`git span drift ${name}\` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.`;
  }
  return "For each out-of-date span: restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, swap the old anchor for the new one with `git span replace`. Update or retire the why only if its meaning changed. Require `git span drift <name>` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.";
}
function rangeLabel(row) {
  if (row.start === 0 && row.end === 0) return { kind: "whole-file" };
  return { kind: "range", start: row.start, end: row.end };
}
function anchorBullets(anchors, debtRows) {
  const rows = anchors.map((anchor) => {
    const soleOnPath = anchors.filter((a) => a.path === anchor.path).length === 1;
    const statuses = /* @__PURE__ */ new Set();
    for (const row of debtRows) {
      if (row.path !== anchor.path) continue;
      if (soleOnPath || row.start === anchor.start && row.end === anchor.end) {
        statuses.add(row.status);
      }
    }
    const sorted = [...statuses].sort();
    const suffix = sorted.length > 0 ? ` \u2014 ${sorted.map(humanStatusLabel).join(", ")}` : "";
    return { path: anchor.path, range: rangeLabel(anchor), suffix };
  });
  try {
    return renderAnchorTree(collapseByPath(rows));
  } catch {
    return anchors.map((anchor, i) => `- ${anchorText(anchor)}${rows[i].suffix}`);
  }
}
function renderSpanSection(name, anchors, debtRows, why) {
  const lines = [`## ${name}`, ...anchorBullets(anchors, debtRows)];
  if (why) lines.push("", why);
  return lines.join("\n");
}
function buildBlock(sections, header, footer) {
  const body = `${header}

${sections.join("\n\n---\n\n")}

---

${footer}`;
  return `
<git-span>
${body}
</git-span>
`;
}
function recoverRangeFromDisk(written, filePath) {
  if (written.length === 0) return "whole-file";
  let content;
  try {
    content = fs5.readFileSync(filePath, "utf8");
  } catch {
    return "whole-file";
  }
  return recoverRange(written, content);
}
var DEFAULT_READ_LIMIT = 2e3;
function recoverReadRange(offset, limit, filePath) {
  if (offset === void 0 && limit === void 0) return "whole-file";
  const start = offset ?? 1;
  let lineCount2;
  try {
    const content = fs5.readFileSync(filePath, "utf8");
    lineCount2 = content.length === 0 ? 0 : content.split("\n").length;
  } catch {
    return "whole-file";
  }
  const end = Math.min(start + (limit ?? DEFAULT_READ_LIMIT) - 1, Math.max(lineCount2, start));
  return { start, end };
}
function rangesForInput(input) {
  if (input.kind === "read") {
    const recovered2 = recoverReadRange(input.offset, input.limit, input.filePath);
    return recovered2 === "whole-file" ? "whole-file" : [recovered2];
  }
  if (input.range !== void 0) return [input.range];
  const recovered = recoverRangeFromDisk(input.written, input.filePath);
  return recovered === "whole-file" ? "whole-file" : [recovered];
}
function extentIntersects(a, b) {
  if (b === "whole-file" || a.kind === "whole") return true;
  return b.some((range) => rangesIntersect(range, { start: a.start, end: a.end }));
}
function contextStatusToken(status) {
  return status.code === "CONTENT_UNAVAILABLE" ? status.reason : status.code;
}
function contextAnchorRow(name, anchor) {
  const extent = anchor.anchored.extent;
  return {
    name,
    path: anchor.anchored.path,
    start: extent.kind === "whole" ? 0 : extent.start,
    end: extent.kind === "whole" ? 0 : extent.end
  };
}
function contextDriftRow(name, anchor) {
  return { ...contextAnchorRow(name, anchor), status: contextStatusToken(anchor.status) };
}
function spanTouchesInput(span, document, repoPath, ranges) {
  return span.overlaps.some((overlap) => {
    const scope = document.scopes[overlap.scope];
    return scope.path === repoPath && extentIntersects(overlap.intersection, ranges);
  });
}
function renderContextTouch(input, document, repoPath, ranges, memo) {
  const surfaced = memo.getSurfaced(input.sessionId);
  const sections = [];
  const toRecord = [];
  const driftedNames = [];
  for (const span of document.spans) {
    if (!spanTouchesInput(span, document, repoPath, ranges)) continue;
    const anchors = span.anchors.map((anchor) => contextAnchorRow(span.name, anchor));
    const drift = span.anchors.filter((anchor) => anchor.status.code !== "FRESH").map((anchor) => contextDriftRow(span.name, anchor));
    const debtRows = drift.filter((row) => isDebt(row.status));
    if (drift.length > 0 && debtRows.length === 0) continue;
    const debtStatuses = [...new Set(debtRows.map((row) => row.status))].sort();
    const unsurfacedDebt = debtStatuses.filter((status) => !surfaced.has(driftKey(span.name, status)));
    const isNewName = !surfaced.has(span.name);
    if (!isNewName && unsurfacedDebt.length === 0) continue;
    sections.push(renderSpanSection(span.name, anchors, debtRows, span.why));
    if (debtStatuses.length > 0) driftedNames.push(span.name);
    if (isNewName) toRecord.push(span.name);
    for (const status of unsurfacedDebt) toRecord.push(driftKey(span.name, status));
  }
  if (sections.length === 0) return null;
  memo.addSurfaced(input.sessionId, toRecord, surfaced);
  const fileName = basename4(input.filePath);
  const header = driftedNames.length > 0 ? driftHeader(driftedNames.length, input.kind) : cleanHeader(fileName);
  const footer = driftedNames.length > 0 ? driftFooter(driftedNames) : cleanFooter(fileName);
  return buildBlock(sections, header, footer);
}
function normalizedAddressIdentity(touches) {
  const byPath = /* @__PURE__ */ new Map();
  for (const touch of touches) {
    const existing = byPath.get(touch.repoPath);
    if (existing === "whole-file" || touch.ranges === "whole-file") {
      byPath.set(touch.repoPath, "whole-file");
    } else {
      byPath.set(touch.repoPath, [...existing ?? [], ...touch.ranges]);
    }
  }
  const identity = [];
  for (const path of [...byPath.keys()].sort()) {
    const ranges = byPath.get(path);
    if (ranges === "whole-file") {
      identity.push(path);
      continue;
    }
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const range of sorted) {
      const prior = merged.at(-1);
      if (prior !== void 0 && range.start <= prior.end) prior.end = Math.max(prior.end, range.end);
      else merged.push({ ...range });
    }
    identity.push(...merged.map((range) => `${path}#L${range.start}-L${range.end}`));
  }
  return identity;
}
function deterministicOperationId(invocationId, repoRoot, addresses) {
  const bytes = createHash("sha256").update(invocationId).update("\0").update(repoRoot).update("\0").update(addresses.join("\0")).digest();
  bytes[6] = bytes[6] & 15 | 80;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function runTouchHooks(inputs, executors, memo, invocationId, probeCache, logger2) {
  const outputs = inputs.map(() => ({ additionalContext: null, treeModified: false }));
  const prepared = [];
  for (const [index, input] of inputs.entries()) {
    if (input.kind === "write" && input.targetState !== void 0) {
      const probe = probeCache ?? createRealityProbeCache(input.targetState === "absent" ? [input.filePath] : []);
      const outcome = evaluateWriteGate(input, probe);
      if (outcome === "decisiveFail" || outcome === "inconclusive" && input.targetState === "absent") continue;
    }
    const repoRoot = resolveRepoRoot(dirname5(input.filePath));
    if (repoRoot === null) continue;
    prepared.push({
      input,
      index,
      repoRoot,
      repoPath: relativeToRepo(repoRoot, input.filePath),
      ranges: rangesForInput(input),
      partitionKey: `${repoRoot}\0${input.kind === "write" ? "repair" : "read"}`
    });
  }
  const partitions = /* @__PURE__ */ new Map();
  for (const touch of prepared) {
    const partition = partitions.get(touch.partitionKey);
    if (partition === void 0) partitions.set(touch.partitionKey, [touch]);
    else partition.push(touch);
  }
  let queryCount = 0;
  let scopeCount = 0;
  let selectedResultCount = 0;
  let elapsedMs = 0;
  let treeModified = false;
  let failure = null;
  let repairFailure = false;
  const documents = /* @__PURE__ */ new Map();
  const rewrittenPartitions = /* @__PURE__ */ new Set();
  for (const [partitionKey, partition] of partitions) {
    const repair = partition[0].input.kind === "write";
    const addresses = partition.flatMap(
      (touch) => touch.ranges === "whole-file" ? [touch.repoPath] : touch.ranges.map((range) => `${touch.repoPath}#L${range.start}-L${range.end}`)
    );
    if (addresses.length > MAX_CONTEXT_ADDRESSES) {
      failure ??= "address_limit";
      if (repair) repairFailure = true;
      continue;
    }
    if (repair && invocationId === null) {
      failure ??= "missing_invocation_identity";
      repairFailure = true;
      continue;
    }
    queryCount += 1;
    const result = await executors.context({
      repoRoot: partition[0].repoRoot,
      addresses,
      repair,
      ...repair ? {
        operationId: deterministicOperationId(
          invocationId,
          partition[0].repoRoot,
          normalizedAddressIdentity(partition)
        )
      } : {}
    });
    elapsedMs += result.elapsedMs;
    if (!result.ok) {
      failure ??= result.failure;
      if (repair) repairFailure = true;
      continue;
    }
    scopeCount += result.document.scopes.length;
    selectedResultCount += result.document.spans.length;
    documents.set(partitionKey, result.document);
    if (repair && result.document.mutation.rewritten) {
      treeModified = true;
      rewrittenPartitions.add(partitionKey);
    }
  }
  for (const touch of prepared) {
    const document = documents.get(touch.partitionKey);
    if (document === void 0) continue;
    const singleTouchMutation = (partitions.get(touch.partitionKey)?.length ?? 0) === 1 && rewrittenPartitions.has(touch.partitionKey);
    try {
      const additionalContext = renderContextTouch(touch.input, document, touch.repoPath, touch.ranges, memo);
      outputs[touch.index] = { additionalContext, treeModified: singleTouchMutation };
    } catch (err) {
      logger2?.warn("git-span touch render failed open on an unexpected error", {
        filePath: touch.input.filePath,
        err
      });
      outputs[touch.index] = { additionalContext: null, treeModified: singleTouchMutation };
    }
  }
  return {
    outputs,
    treeModified,
    diagnostics: {
      queryCount,
      scopeCount,
      selectedResultCount,
      elapsedMs,
      mutation: treeModified ? "rewritten" : repairFailure ? "unknown" : "unchanged",
      failure
    }
  };
}
var DEFAULT_TIMEOUT_MS = 2e3;
var HOOK_CONTEXT_LOCK_WAIT_SECS = "1";
function createDefaultTouchExecutors(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const executors = {
    context: async (request) => {
      const started = performance.now();
      const args = ["span", "context", ...request.addresses, "--format", "json"];
      if (request.repair) args.push("--fix", "--operation-id", request.operationId);
      let stdout;
      try {
        stdout = execFileSync5("git", args, {
          cwd: request.repoRoot,
          env: { ...process.env, GIT_SPAN_LOCK_WAIT_SECS: HOOK_CONTEXT_LOCK_WAIT_SECS },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs,
          maxBuffer: MAX_CONTEXT_JSON_BYTES + 1
        });
      } catch (error) {
        const typed = error;
        const stderr = typeof typed.stderr === "string" ? typed.stderr : typed.stderr?.toString("utf8");
        const failure = typed.code === "ENOENT" || stderr?.includes("is not a git command") === true ? "command_absent" : typed.code === "ETIMEDOUT" || typed.signal === "SIGTERM" || typed.killed === true ? "timeout" : typed.code === "ENOBUFS" ? "schema_rejected" : "nonzero_exit";
        return { ok: false, failure, elapsedMs: performance.now() - started };
      }
      if (stdout.trim().length === 0) {
        return { ok: false, failure: "empty_output", elapsedMs: performance.now() - started };
      }
      try {
        const document = decodeContextDocument(stdout);
        if (document.mutation.requested !== request.repair || document.mutation.rewritten && !request.repair) {
          throw new Error("context mutation does not match the requested mode");
        }
        return { ok: true, document, elapsedMs: performance.now() - started };
      } catch (error) {
        return {
          ok: false,
          failure: error instanceof SyntaxError ? "malformed_json" : "schema_rejected",
          elapsedMs: performance.now() - started
        };
      }
    },
    forInvocation: () => executors
  };
  return executors;
}

// src/common/bash-touch.ts
function bashSpanToTouch(span, sessionId, cwd, scopeAlreadyResolved = false) {
  if (!scopeAlreadyResolved && !resolveTouchScope(cwd, span.absolutePath)) return null;
  switch (span.operation) {
    case "read":
      return {
        kind: "read",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        offset: span.lineStart,
        limit: span.lineStart !== void 0 && span.lineEnd !== void 0 ? span.lineEnd - span.lineStart + 1 : void 0
      };
    case "create-overwrite":
    case "rename-copy":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        postState: span.written !== void 0 ? { content: { exact: span.written } } : void 0
      };
    case "truncate":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        postState: span.size === 0 ? { content: { empty: true } } : span.size !== void 0 ? { content: { size: span.size } } : void 0
      };
    case "append":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: span.written ?? "",
        range: span.lineStart !== void 0 ? { start: span.lineStart, end: span.lineEnd ?? span.lineStart } : void 0,
        targetState: "exists",
        postState: span.expectedContent !== void 0 ? { content: { exact: span.expectedContent } } : span.written !== void 0 ? { content: { suffix: span.written } } : void 0
      };
    case "modify":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        range: span.lineStart !== void 0 ? { start: span.lineStart, end: span.lineEnd ?? span.lineStart } : void 0,
        postState: span.expectedContent !== void 0 ? { content: { exact: span.expectedContent } } : void 0
      };
    case "delete":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "absent",
        postState: {
          realDelete: true,
          ...span.preTrackedDelete === true ? { preTrackedDelete: true } : {}
        }
      };
  }
}
function bashResponseInterrupted(toolResponse) {
  if (toolResponse !== null && typeof toolResponse === "object") {
    const record2 = toolResponse;
    const timedOutAfterMs = record2.timedOutAfterMs;
    return record2.interrupted === true || record2.is_interrupt === true || typeof timedOutAfterMs === "number" && Number.isFinite(timedOutAfterMs) && timedOutAfterMs >= 0;
  }
  return false;
}
function bashResponseExitCode(toolResponse) {
  if (toolResponse !== null && typeof toolResponse === "object") {
    const record2 = toolResponse;
    for (const field of ["exit_code", "exitCode", "exitStatus"]) {
      const code = record2[field];
      if (typeof code === "number" && Number.isInteger(code)) return code;
    }
  }
  return void 0;
}
var FILE_PRODUCING_OPS = /* @__PURE__ */ new Set(["create-overwrite", "rename-copy", "truncate", "append"]);
function evalSpanGate(match, touch, probeCache) {
  if (touch === null) return "inconclusive";
  if (touch.kind === "read") {
    if ((match.idiom === "cp-write" || match.idiom === "install-write") && match.span.operation === "read") {
      return fileExists(match.span.absolutePath) ? "inconclusive" : "decisiveFail";
    }
    return "inconclusive";
  }
  return evaluateWriteGate(touch, probeCache);
}
function joinOfCommand(idx, groups, guardByIndex) {
  const spans = groups.get(idx);
  if (spans !== void 0) {
    for (const m of spans) {
      if (m.span.join !== void 0) return m.span.join;
    }
    return void 0;
  }
  return guardByIndex.get(idx)?.join;
}
async function runBashTouches(matches, sessionId, cwd, toolResponse, executors, memo, warn = console.warn, scopeAlreadyResolved = false, reportDiagnostics = () => void 0, invocationId = null) {
  const resolved = matches.filter((m) => m.status === "resolved");
  if (bashResponseInterrupted(toolResponse)) {
    reportDiagnostics({ executionGateDrops: resolved.length });
    return [];
  }
  const exitCode = bashResponseExitCode(toolResponse);
  const guards = matches.filter((m) => m.status === "builtin-guard");
  if (resolved.length === 0) {
    reportDiagnostics({ executionGateDrops: 0 });
    return [];
  }
  if (resolved.length > DEFAULT_MAX_ATTRIBUTION_CANDIDATES) {
    warn(
      `Bash candidate budget exceeded: ${resolved.length} candidates (limit ${DEFAULT_MAX_ATTRIBUTION_CANDIDATES}); rejecting the complete touch set`
    );
    reportDiagnostics({ executionGateDrops: resolved.length });
    return [];
  }
  const probePaths = [];
  const fileProducingByPath = /* @__PURE__ */ new Map();
  for (const m of resolved) {
    if (m.span.operation === "delete") probePaths.push(m.span.absolutePath);
    else if ((m.idiom === "cp-write" || m.idiom === "install-write") && m.span.operation === "read") {
      probePaths.push(m.span.absolutePath);
    } else if (FILE_PRODUCING_OPS.has(m.span.operation)) {
      const list = fileProducingByPath.get(m.span.absolutePath);
      if (list !== void 0) list.push(m.span.simpleCommandIndex);
      else fileProducingByPath.set(m.span.absolutePath, [m.span.simpleCommandIndex]);
    }
  }
  const recreateProbePaths = [];
  for (const m of resolved) {
    if (m.span.operation !== "delete") continue;
    const later = (fileProducingByPath.get(m.span.absolutePath) ?? []).some((i) => i > m.span.simpleCommandIndex);
    if (later) recreateProbePaths.push(m.span.absolutePath);
  }
  const probeCache = createRealityProbeCache(probePaths, recreateProbePaths);
  const groups = /* @__PURE__ */ new Map();
  const guardByIndex = /* @__PURE__ */ new Map();
  const commandOrder = [];
  for (const m of resolved) {
    const idx = m.span.simpleCommandIndex;
    const list = groups.get(idx);
    if (list !== void 0) {
      list.push(m);
    } else {
      groups.set(idx, [m]);
      commandOrder.push(idx);
    }
  }
  for (const g of guards) {
    if (groups.has(g.simpleCommandIndex) || guardByIndex.has(g.simpleCommandIndex)) continue;
    guardByIndex.set(g.simpleCommandIndex, g);
    commandOrder.push(g.simpleCommandIndex);
  }
  commandOrder.sort((a, b) => a - b);
  const evals = /* @__PURE__ */ new Map();
  for (const idx of commandOrder) {
    const spans = groups.get(idx);
    if (spans === void 0) continue;
    const readPaths = spans.filter((m) => (m.idiom === "cp-write" || m.idiom === "install-write") && m.span.operation === "read").map((m) => m.span.absolutePath);
    const deletePaths = spans.filter((m) => m.span.operation === "delete").map((m) => m.span.absolutePath);
    let readCursor = 0;
    let deleteCursor = 0;
    const list = [];
    for (const m of spans) {
      const touch = bashSpanToTouch(m.span, sessionId, cwd, scopeAlreadyResolved);
      const entry = {
        match: m,
        touch,
        outcome: "inconclusive",
        explained: false,
        commandIndex: idx,
        path: m.span.absolutePath,
        sourceKey: null
      };
      if (touch !== null && touch.kind === "write") {
        if (m.span.operation === "create-overwrite" && (m.idiom === "cp-write" || m.idiom === "install-write")) {
          const source = readPaths[readCursor];
          if (source !== void 0) {
            readCursor += 1;
            if (m.idiom === "cp-write") {
              touch.sourcePath = source;
              entry.sourceKey = source;
            }
          }
        } else if (m.span.operation === "rename-copy") {
          const source = deletePaths[deleteCursor];
          if (source !== void 0) {
            deleteCursor += 1;
            touch.renameSourcePath = source;
          }
        }
      }
      entry.outcome = evalSpanGate(m, touch, probeCache);
      list.push(entry);
    }
    evals.set(idx, list);
  }
  const passByPath = /* @__PURE__ */ new Map();
  for (const idx of commandOrder) {
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
      if (e.outcome === "decisivePass") {
        const prev = passByPath.get(e.path);
        if (prev === void 0 || idx > prev) passByPath.set(e.path, idx);
      }
    }
  }
  for (const idx of commandOrder) {
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
      if (e.outcome === "pending") {
        const passIdx = e.sourceKey !== null ? passByPath.get(e.sourceKey) : void 0;
        e.outcome = passIdx !== void 0 && passIdx > e.commandIndex ? "decisivePass" : "decisiveFail";
      } else if (e.outcome === "decisiveFail") {
        const passIdx = passByPath.get(e.path);
        if (passIdx !== void 0 && passIdx > e.commandIndex) e.explained = true;
      }
    }
  }
  const recreateByPath = /* @__PURE__ */ new Map();
  for (const idx of commandOrder) {
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
      if (e.outcome === "decisiveFail") continue;
      if (e.touch === null || e.touch.kind !== "write" || e.touch.targetState !== "exists") continue;
      if (!FILE_PRODUCING_OPS.has(e.match.span.operation)) continue;
      const prev = recreateByPath.get(e.path);
      if (prev === void 0 || idx > prev) recreateByPath.set(e.path, idx);
    }
  }
  if (recreateByPath.size > 0) {
    for (const idx of commandOrder) {
      const list = evals.get(idx);
      if (list === void 0) continue;
      for (const e of list) {
        if (e.outcome !== "decisiveFail" || e.explained) continue;
        if (e.touch === null || e.touch.kind !== "write" || e.touch.targetState !== "absent") continue;
        const recreateIdx = recreateByPath.get(e.path);
        if (recreateIdx !== void 0 && recreateIdx > e.commandIndex && workingTreeChanged(probeCache, cwd, e.path)) {
          e.explained = true;
        }
      }
    }
  }
  const computed = /* @__PURE__ */ new Map();
  for (const idx of commandOrder) {
    const list = evals.get(idx);
    if (list === void 0) {
      const guard = guardByIndex.get(idx);
      computed.set(idx, guard !== void 0 ? guard.exitStatus === 0 ? "succeeded" : "failed" : "unknown");
      continue;
    }
    let failed = false;
    let passed = false;
    for (const e of list) {
      if (e.outcome === "decisiveFail" && !e.explained) failed = true;
      if (e.outcome === "decisivePass") passed = true;
    }
    computed.set(idx, failed ? "failed" : passed ? "succeeded" : "unknown");
  }
  const effective = /* @__PURE__ */ new Map();
  const skipped = /* @__PURE__ */ new Set();
  let prevIndex = null;
  for (const idx of commandOrder) {
    const join9 = joinOfCommand(idx, groups, guardByIndex);
    const prevVerdict = prevIndex !== null ? effective.get(prevIndex) : void 0;
    if (prevVerdict !== void 0 && join9 !== void 0) {
      if (join9 === "&&" && prevVerdict === "failed" || join9 === "||" && prevVerdict === "succeeded") {
        effective.set(idx, join9 === "&&" ? "failed" : "succeeded");
        skipped.add(idx);
        prevIndex = idx;
        continue;
      }
    }
    effective.set(idx, computed.get(idx));
    prevIndex = idx;
  }
  const touches = [];
  const invocationExecutors = executors.forInvocation?.() ?? executors;
  for (const idx of commandOrder) {
    if (skipped.has(idx)) continue;
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
      if (e.touch === null || e.explained) continue;
      if (e.outcome === "decisiveFail") continue;
      if (e.outcome === "inconclusive" && e.touch.kind === "write" && e.touch.targetState === "absent") continue;
      if (e.outcome === "inconclusive" && e.touch.kind === "write" && exitCode !== void 0 && exitCode !== 0)
        continue;
      touches.push(e.touch);
    }
  }
  const batch = await runTouchHooks(touches, invocationExecutors, memo, invocationId, probeCache, { warn });
  const blocks = batch.outputs.flatMap(
    (output) => output.additionalContext === null ? [] : [output.additionalContext]
  );
  reportDiagnostics({ executionGateDrops: resolved.length - touches.length, ...batch.diagnostics });
  return blocks;
}

// src/common/parse-response.ts
import { existsSync as existsSync4, statSync as statSync5 } from "node:fs";
import { dirname as dirname6, join as join5, resolve as resolvePath2, sep as sep2 } from "node:path";
var MAX_RESPONSE_SPANS = 50;
var SEARCH_BINS = /* @__PURE__ */ new Set(["rg", "grep", "egrep", "fgrep"]);
var VALUE_SHORT_FLAGS = /* @__PURE__ */ new Set(["A", "B", "C", "e", "f", "m", "g", "t", "T"]);
var VALUE_LONG_FLAGS = /* @__PURE__ */ new Set([
  "after-context",
  "before-context",
  "context",
  "max-count",
  "regexp",
  "file",
  "glob",
  "iglob",
  "type",
  "type-not",
  "include",
  "exclude",
  "exclude-dir",
  "exclude-from"
]);
function hasShellExpansion2(s) {
  return /[$`]/.test(s);
}
function isPathspecMagic(p) {
  return /^:[/!^.(]/.test(p);
}
function analyzeSearchArgv(argv, start) {
  const positionals = [];
  let contextFlags = false;
  let numbered = false;
  let withFilename = false;
  let patternFromFlag = false;
  let stdinRedirect = false;
  let i = start;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("<")) {
      stdinRedirect = true;
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (name === "after-context" || name === "before-context" || name === "context") contextFlags = true;
      if (name === "line-number") numbered = true;
      if (name === "with-filename") withFilename = true;
      if (name === "regexp" || name === "file") patternFromFlag = true;
      if (eq === -1 && VALUE_LONG_FLAGS.has(name)) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (a.startsWith("-") && a !== "-" && a.length > 1) {
      let consumesNext = false;
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === "A" || c === "B" || c === "C") contextFlags = true;
        if (c === "n") numbered = true;
        if (c === "H") withFilename = true;
        if (c === "e" || c === "f") patternFromFlag = true;
        if (VALUE_SHORT_FLAGS.has(c)) {
          consumesNext = j === a.length - 1;
          break;
        }
      }
      i += consumesNext ? 2 : 1;
      continue;
    }
    positionals.push(a);
    i += 1;
  }
  const firstPositional = patternFromFlag ? 0 : 1;
  const pathArgs = positionals.length > firstPositional ? positionals.slice(firstPositional).filter((p) => !isPathspecMagic(p)) : [];
  const pathspecMagic = positionals.length > firstPositional && positionals.slice(firstPositional).some((p) => isPathspecMagic(p));
  return { pathArgs, contextFlags, numbered, withFilename, pathspecMagic, stdinRedirect };
}
function findGitSubcommand2(argv) {
  let dir = null;
  let dirUnresolvable = false;
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "-C") {
      const v = argv[i + 1];
      if (v === void 0) return null;
      if (hasShellExpansion2(v)) dirUnresolvable = true;
      else dir = v;
      i += 2;
      continue;
    }
    if (a === "-c") {
      i += 2;
      continue;
    }
    if (a.startsWith("-")) {
      i += 1;
      continue;
    }
    return { dir, dirUnresolvable, subcommand: a, start: i + 1 };
  }
  return null;
}
function hasDiffPatchFlag(argv, start) {
  for (let i = start; i < argv.length; i++) {
    if (argv[i] === "-p" || argv[i] === "--patch") return true;
  }
  return false;
}
function hasRevPathArg(argv, start) {
  const valueFlags = /* @__PURE__ */ new Set(["--format", "--pretty", "--output", "--word-diff-regex"]);
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") return false;
    if (a.startsWith("-") && a !== "-") {
      if (!a.includes("=") && valueFlags.has(a)) i += 1;
      continue;
    }
    if (a.includes(":")) return true;
  }
  return false;
}
function hasFlag(argv, start, flag) {
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") return false;
    if (a === flag) return true;
  }
  return false;
}
function hasDiffRevPathArg(argv, start, cwd) {
  const valueFlags = /* @__PURE__ */ new Set([
    "--output",
    "--src-prefix",
    "--dst-prefix",
    "-L",
    "-S",
    "-G",
    "--grep",
    "--author",
    "--committer",
    "--since",
    "--until",
    "--before",
    "--after"
  ]);
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") return false;
    if (a.startsWith("-") && a !== "-") {
      if (!a.includes("=") && valueFlags.has(a)) i += 1;
      continue;
    }
    if (a.includes(":") && !existsSync4(resolvePath2(cwd, a))) return true;
  }
  return false;
}
function diffRelativeBase(argv, start, effectiveDir, repoRoot) {
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") return null;
    if (a === "--relative") return { base: effectiveDir, root: effectiveDir };
    if (a.startsWith("--relative=")) {
      const value = a.slice("--relative=".length);
      if (repoRoot === null || hasShellExpansion2(value) || value === "") return "unresolvable";
      const base = resolvePath2(repoRoot, value);
      return { base, root: base };
    }
  }
  return null;
}
var VERBATIM_PASS_BINS = /* @__PURE__ */ new Set(["head", "tail", "wc", "sort", "uniq", "cut"]);
function isRenumberingFilter(argv) {
  const bin = argv[0];
  if (bin === "nl") return true;
  if (bin === "sed") return !isVerbatimSedStage(argv);
  if (bin === "awk") return !isVerbatimAwkStage(argv);
  if (bin === "perl") return !isVerbatimPerlStage(argv);
  if (bin === "tr") return !isVerbatimTrStage(argv);
  if (bin === "cat") {
    if (argv.some((a) => a === "--number" || a.startsWith("-") && !a.startsWith("--") && a.includes("n")))
      return true;
    return hasFileOperand(argv);
  }
  if (SEARCH_BINS.has(bin)) {
    if (argv.some((a) => a === "--line-number" || a.startsWith("-") && !a.startsWith("--") && a.includes("n")))
      return true;
    return hasGrepFileOperand(argv);
  }
  if (VERBATIM_PASS_BINS.has(bin)) return hasFileOperand(argv);
  return true;
}
function hasFileOperand(argv) {
  let afterTerminator = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      afterTerminator = true;
      continue;
    }
    if (a === "-") continue;
    if (afterTerminator || !a.startsWith("-")) return true;
  }
  return false;
}
function hasGrepFileOperand(argv) {
  let patternFromFlag = false;
  let seenPattern = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      for (let j = i + 1; j < argv.length; j++) {
        if (!patternFromFlag && !seenPattern) seenPattern = true;
        else return true;
      }
      return false;
    }
    if (a === "-e" || a === "-f" || a === "--regexp" || a === "--file") {
      patternFromFlag = true;
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      if (a.startsWith("--")) {
        if (a.startsWith("--regexp=") || a.startsWith("--file=")) patternFromFlag = true;
      } else if (a.length > 2 && (a[1] === "e" || a[1] === "f")) {
        patternFromFlag = true;
      }
      continue;
    }
    if (!patternFromFlag && !seenPattern) seenPattern = true;
    else return true;
  }
  return false;
}
function isVerbatimSedScript(script, suppressAutoPrint) {
  if (suppressAutoPrint) {
    return /^\d+p$/.test(script) || /^\d+,\d+p$/.test(script) || /^\d+,\$p$/.test(script);
  }
  return /^\d+q$/.test(script) || /^\d+d$/.test(script);
}
function isVerbatimSedStage(argv) {
  let script = null;
  let suppressAutoPrint = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-n") {
      suppressAutoPrint = true;
      continue;
    }
    if (a.startsWith("-") && a !== "-") return false;
    if (script !== null) return false;
    script = a;
  }
  return script !== null && isVerbatimSedScript(script, suppressAutoPrint);
}
function isVerbatimAwkStage(argv) {
  if (argv.length !== 2) return false;
  const program = argv[1];
  return /^NR\s*(<=|>=|==|!=|<|>)\s*\d+$/.test(program) || /^NR\s*%\s*\d+\s*(==|!=)\s*\d+$/.test(program);
}
function verbatimPerlScript(argv) {
  if (argv.length === 3 && argv[1] === "-ne") return argv[2];
  if (argv.length === 4 && argv[1] === "-n" && argv[2] === "-e") return argv[3];
  return null;
}
function isVerbatimPerlStage(argv) {
  const script = verbatimPerlScript(argv);
  if (script === null) return false;
  return /^\s*print\s+(?:if|unless)\s+\$\.\s*(<=|>=|==|!=|<|>)\s*\d+\s*;?\s*$/.test(script);
}
function isVerbatimTrStage(argv) {
  if (argv.length !== 3 || argv[1] !== "-d") return false;
  const set = argv[2];
  return !/[0-9:]/.test(set) && !set.includes("\\n");
}
function completeLines(stdout) {
  const lines = stdout.split("\n");
  lines.pop();
  return lines;
}
function recordsAreOneFile(stdout) {
  const lines = completeLines(stdout);
  if (lines.length === 0) return false;
  return lines.every((line) => line === "" || line === "--" || parseOneFileRecord(line) !== null);
}
function detectLayout(stdout, info, oneFileEligible) {
  if (stdout.includes("\0")) return "null-separated";
  const lines = completeLines(stdout);
  const first = lines.find((line) => line !== "");
  if (first === void 0) return null;
  if (/^\d+[-:]/.test(first)) {
    if (oneFileEligible && recordsAreOneFile(stdout)) return "one-file";
  }
  if (/^[^:]+:\d+/.test(first)) return info.contextFlags ? "context" : "recursive";
  if (info.contextFlags && lines.some((line) => line !== "" && /^[^:]+:\d+/.test(line))) return "context";
  if (/^[^-:]+-\d+-/.test(first)) return info.contextFlags ? "context" : null;
  if (info.numbered && /^[^:]+$/.test(first)) return "heading";
  return null;
}
function parseRecord(line, sep4) {
  const first = line.indexOf(sep4);
  if (first === -1) return null;
  const second = line.indexOf(sep4, first + 1);
  if (second === -1) return null;
  const path = line.slice(0, first);
  const lineToken = line.slice(first + 1, second);
  const text = line.slice(second + 1);
  if (path === "" || path.includes(":")) return null;
  if (!/^\d+$/.test(lineToken)) return null;
  const lineNumber = Number.parseInt(lineToken, 10);
  if (lineNumber <= 0) return null;
  return { path, line: lineNumber, text };
}
function parseOneFileRecord(line) {
  const m = /^(\d+)([:-])/.exec(line);
  if (m === null) return null;
  const lineNumber = Number.parseInt(m[1], 10);
  if (lineNumber <= 0) return null;
  return { line: lineNumber, text: line.slice(m[0].length) };
}
function parseContextRecord(line, knownPaths) {
  for (const path of knownPaths) {
    if (!line.startsWith(`${path}-`)) continue;
    const tail = line.slice(path.length + 1);
    const m = /^(\d+)-/.exec(tail);
    if (m === null) continue;
    const lineNumber = Number.parseInt(m[1], 10);
    if (lineNumber <= 0) continue;
    return { path, line: lineNumber, text: tail.slice(m[0].length) };
  }
  return null;
}
function lineCount(text) {
  if (text === "") return 0;
  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutTrailingNewline.split("\n").length;
}
function decodeSearchLayout(layout, stdout, singleFileArg) {
  const records = [];
  switch (layout) {
    case "recursive":
      for (const line of completeLines(stdout)) {
        const rec = parseRecord(line, ":");
        if (rec !== null) records.push(rec);
      }
      break;
    case "context": {
      const lines = completeLines(stdout);
      const known = /* @__PURE__ */ new Set();
      for (const line of lines) {
        if (line === "--") continue;
        const rec = parseRecord(line, ":");
        if (rec !== null) known.add(rec.path);
      }
      const knownSorted = [...known].sort((a, b) => b.length - a.length);
      for (const line of lines) {
        if (line === "--") continue;
        const rec = parseRecord(line, ":") ?? parseContextRecord(line, knownSorted) ?? parseRecord(line, "-");
        if (rec !== null) records.push(rec);
      }
      break;
    }
    case "heading":
      {
        let current = null;
        for (const line of completeLines(stdout)) {
          if (line === "") continue;
          const rec = parseOneFileRecord(line);
          if (rec === null) {
            current = line;
          } else if (current !== null) {
            records.push({ path: current, line: rec.line, text: rec.text });
          }
        }
      }
      break;
    case "one-file":
      if (singleFileArg !== null) {
        for (const line of completeLines(stdout)) {
          const rec = parseOneFileRecord(line);
          if (rec !== null) records.push({ path: singleFileArg, line: rec.line, text: rec.text });
        }
      }
      break;
    case "null-separated":
      {
        const parts = stdout.split("\0");
        if (!stdout.endsWith("\0")) parts.pop();
        for (const part of parts) {
          if (part === "") continue;
          const rec = parseRecord(part, ":");
          if (rec === null || rec.line !== 1) continue;
          records.push({ path: rec.path, line: null, text: rec.text });
        }
      }
      break;
  }
  return records;
}
function insideRoot(abs, roots) {
  for (const root of roots) {
    if (abs === root || abs.startsWith(root + sep2)) return true;
  }
  return false;
}
function isFile(abs) {
  try {
    return statSync5(abs).isFile();
  } catch {
    return false;
  }
}
function findGitRoot(startDir) {
  let dir = startDir;
  for (; ; ) {
    if (existsSync4(join5(dir, ".git"))) return dir;
    const parent = dirname6(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function capSpans(spans) {
  if (spans.length <= MAX_RESPONSE_SPANS) return spans;
  const ordered = [...spans].sort(
    (a, b) => a.absolutePath.localeCompare(b.absolutePath) || a.lineStart - b.lineStart || a.lineEnd - b.lineEnd
  );
  return ordered.slice(0, MAX_RESPONSE_SPANS);
}
function coalesce(lines) {
  if (lines.length === 0) return [];
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];
  for (const n of sorted.slice(1)) {
    if (n <= end + 1) {
      if (n > end) end = n;
    } else {
      ranges.push([start, end]);
      start = n;
      end = n;
    }
  }
  ranges.push([start, end]);
  return ranges;
}
function spansFor(perFile, baseDir, roots) {
  const spans = [];
  for (const [path, lines] of perFile) {
    const abs = resolvePath2(baseDir, path);
    if (!insideRoot(abs, roots)) continue;
    for (const [lineStart, lineEnd] of coalesce([...lines])) {
      spans.push({ lineStart, lineEnd, absolutePath: abs });
    }
  }
  return spans;
}
var HUNK_HEADER2 = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
function stripDiffPrefix(p) {
  return p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p;
}
function parseDiffHeader(line) {
  if (line.startsWith("diff --cc ") || line.startsWith("diff --combined ")) return { kind: "combined" };
  if (!line.startsWith("diff --git ")) return null;
  const tokens = line.slice("diff --git ".length).trim().split(/\s+/);
  if (tokens.length !== 2 || tokens[0].startsWith('"') || tokens[1].startsWith('"')) return { kind: "unparseable" };
  return { kind: "file", oldPath: stripDiffPrefix(tokens[0]), newPath: stripDiffPrefix(tokens[1]) };
}
function parseDiffSide(line, marker) {
  if (!line.startsWith(`${marker} `)) return null;
  const p = line.slice(marker.length + 1);
  if (p.startsWith('"')) return { kind: "unparseable" };
  return { kind: "side", path: p === "/dev/null" ? null : stripDiffPrefix(p) };
}
function decodeUnifiedDiff(stdout) {
  const perFile = /* @__PURE__ */ new Map();
  let current = null;
  for (const line of completeLines(stdout)) {
    const header = parseDiffHeader(line);
    if (header !== null) {
      current = {
        oldPath: header.kind === "file" ? header.oldPath : null,
        newPath: header.kind === "file" ? header.newPath : null,
        rename: false,
        binary: false,
        combined: header.kind === "combined",
        submodule: false,
        unusable: header.kind === "unparseable",
        sawHunk: false
      };
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("Binary files ")) {
      current.binary = true;
      continue;
    }
    const isBodyLine = line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line.startsWith("\\");
    if (!isBodyLine && line.includes("mode 160000")) {
      current.submodule = true;
      continue;
    }
    if (line.includes("Subproject commit")) {
      current.submodule = true;
      continue;
    }
    if (line.startsWith("rename from ") || line.startsWith("rename to ") || line.startsWith("copy from ") || line.startsWith("copy to ")) {
      current.rename = true;
      continue;
    }
    if (!current.sawHunk) {
      const oldSide = parseDiffSide(line, "---");
      if (oldSide !== null) {
        if (oldSide.kind === "unparseable") current.unusable = true;
        else current.oldPath = oldSide.path;
        continue;
      }
      const newSide = parseDiffSide(line, "+++");
      if (newSide !== null) {
        if (newSide.kind === "unparseable") current.unusable = true;
        else current.newPath = newSide.path;
        continue;
      }
    }
    const hunk = HUNK_HEADER2.exec(line);
    if (hunk !== null) {
      current.sawHunk = true;
      emitHunkRange(perFile, current, hunk);
    }
  }
  return perFile;
}
function emitHunkRange(perFile, record2, hunk) {
  if (record2.binary || record2.combined || record2.submodule || record2.unusable) return;
  const oldStart = Number.parseInt(hunk[1], 10);
  const oldCount = hunk[2] === void 0 ? 1 : Number.parseInt(hunk[2], 10);
  const newStart = Number.parseInt(hunk[3], 10);
  const newCount = hunk[4] === void 0 ? 1 : Number.parseInt(hunk[4], 10);
  if (record2.rename) {
    if (record2.newPath !== null) addLines(perFile, record2.newPath, newStart, newCount);
    return;
  }
  if (record2.oldPath !== null) addLines(perFile, record2.oldPath, oldStart, oldCount);
  if (record2.newPath !== null) addLines(perFile, record2.newPath, newStart, newCount);
}
function addLines(perFile, path, start, count) {
  if (start < 1 || count <= 0) return;
  let lines = perFile.get(path);
  if (lines === void 0) {
    lines = /* @__PURE__ */ new Set();
    perFile.set(path, lines);
  }
  for (let n = start; n < start + count; n++) lines.add(n);
}
function matchBlameRange(argv, start) {
  let spec = null;
  let specIdx = -1;
  const positionals = [];
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      for (let j = i + 1; j < argv.length; j++) positionals.push({ arg: argv[j], idx: j });
      break;
    }
    if (a === "-L") {
      spec = argv[i + 1] ?? null;
      specIdx = i;
      i += 1;
      continue;
    }
    if (a.startsWith("-L")) {
      spec = a.slice(2);
      specIdx = i;
      continue;
    }
    if (a.startsWith("-")) continue;
    positionals.push({ arg: a, idx: i });
  }
  if (spec === null) return null;
  const m = /^(\d+),(\d+)$/.exec(spec);
  if (m === null) return null;
  const files = positionals.filter((p) => p.idx > specIdx);
  if (files.length !== 1) return null;
  return {
    lineStart: Number.parseInt(m[1], 10),
    lineEnd: Number.parseInt(m[2], 10),
    fileArg: files[0].arg
  };
}
function parseResponse(input) {
  const { command, cwd, stdout } = input;
  let currentDir = cwd;
  let gated = null;
  let gatedPrecededBy = "start";
  let gatedRedirect = false;
  let gatedHeredoc = false;
  const split = splitTopLevel(command);
  if (split.malformed !== void 0) return [];
  const parts = split.stages;
  for (let i = 0; i < parts.length; i++) {
    const simple = parts[i];
    const argv = argvOf(simple.text);
    if (argv === null || argv.length === 0) continue;
    if (argv[0] === "cd") {
      if (gated === null) {
        const target = argv[1];
        if (target !== void 0 && target !== "-" && !hasShellExpansion2(target)) {
          currentDir = resolvePath2(currentDir, target);
        }
      }
      continue;
    }
    if (gated !== null) continue;
    if (SEARCH_BINS.has(argv[0])) {
      gated = { kind: "search", argv, start: 1, dir: null, dirUnresolvable: false };
    } else if (argv[0] === "git") {
      const sub = findGitSubcommand2(argv);
      if (sub !== null) {
        const base2 = { argv, start: sub.start, dir: sub.dir, dirUnresolvable: sub.dirUnresolvable };
        if (sub.subcommand === "grep") gated = { kind: "search", ...base2 };
        else if (sub.subcommand === "show" && !hasRevPathArg(argv, sub.start)) gated = { kind: "diff", ...base2 };
        else if (sub.subcommand === "diff") gated = { kind: "diff", ...base2 };
        else if (sub.subcommand === "log" && hasDiffPatchFlag(argv, sub.start)) gated = { kind: "diff", ...base2 };
        else if (sub.subcommand === "blame") gated = { kind: "blame", ...base2 };
      }
    }
    if (gated === null) continue;
    gatedPrecededBy = simple.precededBy;
    gatedRedirect = hasUnquotedRedirect(simple.text);
    gatedHeredoc = simple.heredoc ?? false;
    for (let j = 0; j < parts.length; j++) {
      if (j === i) continue;
      if (j < i) {
        let consumed = true;
        for (let k = j + 1; k <= i && consumed; k++) {
          if (parts[k].precededBy !== "pipe") consumed = false;
        }
        if (consumed) continue;
      }
      const siblingText = parts[j].text;
      const siblingArgv = argvOf(siblingText);
      if (siblingArgv === null || siblingArgv.length === 0 || siblingArgv[0] === "cd") continue;
      if (hasUnquotedRedirect(siblingText)) return [];
      if (parts[j].heredoc) return [];
      if (isRenumberingFilter(siblingArgv)) return [];
    }
  }
  if (gated === null || gated.dirUnresolvable) return [];
  const effectiveDir = gated.dir !== null ? resolvePath2(currentDir, gated.dir) : currentDir;
  if (gated.kind === "blame") {
    const m = matchBlameRange(gated.argv, gated.start);
    if (m === null || hasShellExpansion2(m.fileArg) || /[*?]/.test(m.fileArg)) return [];
    return [{ lineStart: m.lineStart, lineEnd: m.lineEnd, absolutePath: resolvePath2(effectiveDir, m.fileArg) }];
  }
  if (stdout.includes("\x1B")) return [];
  if (input.truncated) return [];
  if (gated.kind === "diff") {
    if (hasDiffRevPathArg(gated.argv, gated.start, effectiveDir)) return [];
    const repoRoot = findGitRoot(effectiveDir);
    if (repoRoot === null) return [];
    const relative3 = diffRelativeBase(gated.argv, gated.start, effectiveDir, repoRoot);
    if (relative3 === "unresolvable") return [];
    const base2 = relative3 !== null ? relative3.base : repoRoot;
    const roots2 = relative3 !== null ? [relative3.root] : [repoRoot];
    return capSpans(spansFor(decodeUnifiedDiff(stdout), base2, roots2));
  }
  const info = analyzeSearchArgv(gated.argv, gated.start);
  const stdinFed = gated.kind === "search" && gated.argv[0] !== "git" && info.pathArgs.length === 0 && (gatedPrecededBy === "pipe" || info.stdinRedirect || gatedRedirect || gatedHeredoc);
  if (stdinFed) return [];
  const isGitGrep = gated.kind === "search" && gated.argv[0] === "git";
  const fullName = isGitGrep && hasFlag(gated.argv, gated.start, "--full-name");
  const magic = isGitGrep && info.pathspecMagic;
  const worktreeRoot = magic || fullName ? findGitRoot(effectiveDir) : null;
  if ((magic || fullName) && worktreeRoot === null) return [];
  const base = fullName && worktreeRoot !== null ? worktreeRoot : effectiveDir;
  const roots = magic && worktreeRoot !== null ? [worktreeRoot] : info.pathArgs.length > 0 ? info.pathArgs.map((p) => resolvePath2(effectiveDir, p)) : [effectiveDir];
  const singleFileArg = info.pathArgs.length === 1 ? info.pathArgs[0] : null;
  const oneFileEligible = info.numbered && !info.withFilename && singleFileArg !== null && isFile(resolvePath2(effectiveDir, singleFileArg));
  const layout = detectLayout(stdout, info, oneFileEligible);
  const perFile = /* @__PURE__ */ new Map();
  if (layout !== null) {
    for (const rec of decodeSearchLayout(layout, stdout, singleFileArg)) {
      if (layout === "recursive" && !isFile(resolvePath2(base, rec.path))) continue;
      if (rec.line === null) {
        const total = lineCount(rec.text);
        let lines = perFile.get(rec.path);
        if (lines === void 0) {
          lines = /* @__PURE__ */ new Set();
          perFile.set(rec.path, lines);
        }
        for (let n = 1; n <= total; n++) lines.add(n);
      } else {
        let lines = perFile.get(rec.path);
        if (lines === void 0) {
          lines = /* @__PURE__ */ new Set();
          perFile.set(rec.path, lines);
        }
        lines.add(rec.line);
      }
    }
  }
  const spans = spansFor(perFile, base, roots);
  if (perFile.size === 0 && !info.numbered && stdout !== "" && stdout.endsWith("\n") && singleFileArg !== null) {
    const abs = resolvePath2(effectiveDir, singleFileArg);
    const total = countFileLines(abs);
    if (total !== null && total > 0) {
      spans.push({ lineStart: 1, lineEnd: total, absolutePath: abs });
    }
  }
  return capSpans(spans);
}

// src/common/bash-attribution.ts
var RESPONSE_TEXT_FIELDS = ["output", "stdout", "content", "text"];
function finiteTimeout(record2) {
  const value = record2.timedOutAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function integerExitStatus(record2) {
  for (const field of ["exit_code", "exitCode", "exitStatus"]) {
    const value = record2[field];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return void 0;
}
function normalizeBashResponse(toolResponse) {
  if (typeof toolResponse === "string") return { stdout: toolResponse };
  if (Array.isArray(toolResponse)) {
    const text = [];
    for (const block of toolResponse) {
      if (block !== null && typeof block === "object") {
        const value = block.text;
        if (typeof value === "string") text.push(value);
      }
    }
    return { stdout: text.join("") };
  }
  if (toolResponse === null || typeof toolResponse !== "object") return null;
  const record2 = toolResponse;
  for (const field of RESPONSE_TEXT_FIELDS) {
    const value = record2[field];
    if (typeof value !== "string") continue;
    const interrupted = record2.interrupted === true || record2.is_interrupt === true || finiteTimeout(record2);
    const rawOutputPath = record2.rawOutputPath;
    return {
      stdout: value,
      stderr: typeof record2.stderr === "string" ? record2.stderr : void 0,
      exitStatus: integerExitStatus(record2),
      truncated: typeof rawOutputPath === "string" && rawOutputPath.length > 0 || rawOutputPath === true || interrupted,
      interrupted
    };
  }
  return null;
}
function createDefaultPlannedTouchStore(layout) {
  return createPlannedTouchStore(layout, DEFAULT_PLANNED_TOUCH_BUDGETS);
}
function readText(path) {
  try {
    return fs6.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
function unionRange(ranges) {
  return ranges.reduce(
    (union, range) => ({ start: Math.min(union.start, range.start), end: Math.max(union.end, range.end) }),
    { start: ranges[0]?.start ?? 1, end: ranges[0]?.end ?? 1 }
  );
}
function planEvidence(matches, requirements) {
  if (matches.some(({ span }) => span.operation === "delete")) return { kind: "tracked", tracked: true };
  const expectedContent = matches.find(({ span }) => span.expectedContent !== void 0)?.span.expectedContent;
  const ranges = matches.flatMap(
    ({ span }) => span.lineStart === void 0 ? [] : [{ start: span.lineStart, end: span.lineEnd ?? span.lineStart }]
  );
  if (expectedContent !== void 0) {
    return {
      kind: "content-digest",
      algorithm: "sha256",
      digest: createHash2("sha256").update(expectedContent).digest("hex"),
      range: unionRange(ranges)
    };
  }
  if (requirements.has("pre-command-eof")) {
    const content = readText(matches[0].span.absolutePath);
    if (content !== null) {
      return {
        kind: "eof",
        line: content.length === 0 ? 0 : content.split("\n").length,
        byteLength: Buffer.byteLength(content)
      };
    }
  }
  return void 0;
}
function planGroupKey(span) {
  return `${span.absolutePath}\0${span.operation}\0${span.simpleCommandIndex}`;
}
function countBy(values) {
  return values.reduce(
    (counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    },
    {}
  );
}
function planBashTouches(command, cwd, sessionId, toolUseId, logger2, store) {
  const started = performance.now();
  const parsed = parseCommandLayered(command, { cwd, readPreState: readText });
  const requested = /* @__PURE__ */ new Map();
  for (const request of parsed.preStateRequests) {
    const key = `${request.absolutePath}\0${request.operation}\0${request.simpleCommandIndex}`;
    const requirements = requested.get(key) ?? /* @__PURE__ */ new Set();
    requirements.add(request.requirement);
    requested.set(key, requirements);
  }
  const candidates = parsed.resolved.filter(
    ({ span }) => span.operation === "delete" || requested.has(planGroupKey(span))
  );
  const tracked = filterTrackedEligibility(
    candidates.map((value) => ({ absolutePath: value.span.absolutePath, value })),
    { cwd }
  );
  if (tracked.eligible.length === 0) {
    logger2.info?.("git-span static attribution pre-plan", {
      resolved: parsed.resolved.length,
      unresolved: parsed.unresolved.length,
      unresolvedByIdiom: countBy(parsed.unresolved.map(({ idiom }) => idiom)),
      unresolvedByReason: countBy(parsed.unresolved.map(({ reasonCode }) => reasonCode)),
      planned: 0,
      trackedDrops: tracked.dropped.length,
      executionGateDrops: 0,
      parserLatencyMs: performance.now() - started,
      ignoreQueryCount: tracked.ignoreQueryCount,
      trackedQueryCount: tracked.trackedQueryCount,
      eligibilityErrors: tracked.errors
    });
    return;
  }
  const repoRoot = resolveRepoRoot(cwd);
  if (repoRoot === null) return;
  const groups = /* @__PURE__ */ new Map();
  for (const { value } of tracked.eligible) {
    const key = planGroupKey(value.span);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  const touches = [];
  for (const [key, matches] of groups) {
    const span = matches[0].span;
    const requirements = requested.get(key) ?? /* @__PURE__ */ new Set();
    const evidence = planEvidence(matches, requirements);
    touches.push({
      repoRelativePath: toPosix(relativeToRepo(repoRoot, span.absolutePath)),
      operation: span.operation,
      ranges: matches.flatMap(
        ({ span: item }) => item.lineStart === void 0 ? [] : [{ start: item.lineStart, end: item.lineEnd ?? item.lineStart }]
      ),
      simpleCommandIndex: span.simpleCommandIndex,
      ...evidence === void 0 ? {} : { evidence }
    });
  }
  store.put({ version: 1, sessionId, toolUseId, repoRoot, createdAtMs: Date.now(), touches });
  logger2.info?.("git-span static attribution pre-plan", {
    resolved: parsed.resolved.length,
    unresolved: parsed.unresolved.length,
    unresolvedReasons: parsed.unresolved.map(({ reasonCode }) => reasonCode),
    unresolvedByIdiom: countBy(parsed.unresolved.map(({ idiom }) => idiom)),
    unresolvedByReason: countBy(parsed.unresolved.map(({ reasonCode }) => reasonCode)),
    planned: touches.length,
    trackedDrops: tracked.dropped.length,
    executionGateDrops: 0,
    parserLatencyMs: performance.now() - started,
    ignoreQueryCount: tracked.ignoreQueryCount,
    trackedQueryCount: tracked.trackedQueryCount,
    eligibilityErrors: tracked.errors
  });
}
function plannedSpans(record2, cwd, logger2) {
  if (record2 === null) return [];
  const relativeCwd = nodePath5.relative(record2.repoRoot, cwd);
  const cwdInsidePlannedRepo = relativeCwd === "" || relativeCwd !== ".." && !relativeCwd.startsWith(`..${nodePath5.sep}`) && !nodePath5.isAbsolute(relativeCwd);
  if (!cwdInsidePlannedRepo) {
    logger2.warn("git-span static attribution ignored an incompatible planned-touch record", {
      plannedRepoRoot: record2.repoRoot,
      currentCwd: cwd
    });
    return [];
  }
  const matches = [];
  for (const touch of record2.touches) {
    const absolutePath = nodePath5.join(record2.repoRoot, touch.repoRelativePath);
    let expectedContent;
    if (touch.evidence?.kind === "content-digest") {
      const content = readText(absolutePath);
      const digest = content === null ? null : createHash2("sha256").update(content).digest("hex");
      if (digest !== touch.evidence.digest) {
        logger2.warn("git-span static attribution discarded unverifiable planned evidence", {
          path: touch.repoRelativePath,
          reasonCode: "evidence-mismatch"
        });
        continue;
      }
      expectedContent = content ?? void 0;
    }
    const ranges = touch.ranges.length === 0 ? [void 0] : touch.ranges;
    for (const range of ranges) {
      matches.push({
        status: "resolved",
        idiom: "planned-static",
        span: {
          operation: touch.operation,
          absolutePath,
          lineStart: range?.start,
          lineEnd: range?.end,
          expectedContent,
          ...touch.operation === "delete" && touch.evidence?.kind === "tracked" ? { preTrackedDelete: true } : {},
          simpleCommandIndex: touch.simpleCommandIndex
        }
      });
    }
  }
  return matches;
}
function matchKey(match) {
  const span = match.span;
  return [span.absolutePath, span.operation, span.simpleCommandIndex, span.lineStart ?? "", span.lineEnd ?? ""].join(
    "\0"
  );
}
function filterPostTracked(matches, responseSpans, cwd, preTrackedPaths, preTrackedDeletes) {
  const guards = matches.filter(
    (match) => match.status === "builtin-guard"
  );
  const resolved = matches.filter(
    (match) => match.status === "resolved"
  );
  const candidates = [
    ...resolved.map((match) => ({ source: "command", match })),
    ...responseSpans.map((span) => ({ source: "response", span }))
  ];
  const preEligibleCommands = resolved.filter((match) => preTrackedPaths.has(match.span.absolutePath));
  const preEligibleSet = new Set(preEligibleCommands);
  const postCandidates = candidates.filter((value) => value.source === "response" || !preEligibleSet.has(value.match));
  const filtered = filterTrackedEligibility(
    postCandidates.map((value) => ({
      absolutePath: value.source === "command" ? value.match.span.absolutePath : value.span.absolutePath,
      value
    })),
    { cwd }
  );
  const eligibleCommands = new Set(
    filtered.eligible.flatMap(({ value }) => value.source === "command" ? [value.match] : [])
  );
  for (const match of preEligibleCommands) eligibleCommands.add(match);
  const eligibleResponses = filtered.eligible.flatMap(({ value }) => value.source === "response" ? [value.span] : []);
  for (const match of resolved) {
    if (match.span.operation === "delete" && preTrackedDeletes.has(match.span.absolutePath))
      eligibleCommands.add(match);
  }
  const kept = resolved.filter((match) => eligibleCommands.has(match));
  return {
    matches: [...kept, ...guards],
    responseSpans: eligibleResponses,
    trackedDrops: filtered.dropped.filter(({ reason }) => reason === "untracked-path").length,
    scopeDrops: filtered.dropped.filter(
      ({ reason }) => ["outside-repository", "ignored-path", "span-metadata-path"].includes(reason)
    ).length,
    ignoreQueryCount: filtered.ignoreQueryCount,
    trackedQueryCount: filtered.trackedQueryCount,
    eligibilityErrors: filtered.errors
  };
}
async function runResponseReadTouches(spans, cwd, sessionId, executors, memo, invocationId, logger2) {
  const touches = spans.map(
    (span) => ({
      kind: "read",
      sessionId,
      cwd,
      filePath: span.absolutePath,
      offset: span.lineStart,
      limit: span.lineEnd - span.lineStart + 1
    })
  );
  const batch = await runTouchHooks(touches, executors, memo, invocationId, void 0, logger2);
  return {
    blocks: batch.outputs.flatMap((output) => output.additionalContext === null ? [] : [output.additionalContext]),
    diagnostics: batch.diagnostics
  };
}
async function runLayeredBashTouches(command, cwd, sessionId, toolUseId, toolResponse, executors, memo, logger2, store) {
  const parserStarted = performance.now();
  const claimed = toolUseId === void 0 ? { status: "missing" } : store.take(sessionId, toolUseId);
  if (claimed.status === "consumed") return [];
  const record2 = claimed.status === "record" ? claimed.record : null;
  const planned = plannedSpans(record2, cwd, logger2);
  const parsed = parseCommandLayered(command, { cwd, readPreState: readText });
  const preStateKeys = new Set(parsed.preStateRequests.map((request) => planGroupKey(request)));
  const ordinary = parsed.resolved.filter(({ span }) => !preStateKeys.has(planGroupKey(span))).map(({ idiom, span }) => ({ status: "resolved", idiom, span }));
  const detailed = /&&|\|\|/.test(command) ? parseCommandDetailed(command, { cwd }) : [];
  const joinByIndex = new Map([
    ...parsed.resolved.flatMap(
      ({ span }) => span.join === void 0 ? [] : [[span.simpleCommandIndex, span.join]]
    ),
    ...detailed.flatMap(
      (match) => match.status === "resolved" && match.span.join !== void 0 ? [[match.span.simpleCommandIndex, match.span.join]] : []
    )
  ]);
  for (const match of planned) {
    if (match.status === "resolved") match.span.join = joinByIndex.get(match.span.simpleCommandIndex);
  }
  const guards = detailed.filter(
    (match) => match.status === "builtin-guard"
  );
  const seen = new Set(planned.filter((match) => match.status === "resolved").map(matchKey));
  const combined = [
    ...planned,
    ...ordinary.filter((match) => {
      const key = matchKey(match);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    ...guards
  ];
  const preTrackedDeletes = new Set(
    (record2?.touches ?? []).filter(({ operation, evidence }) => operation === "delete" && evidence?.kind === "tracked").map(({ repoRelativePath }) => nodePath5.join(record2.repoRoot, repoRelativePath))
  );
  const preTrackedPaths = new Set(
    (record2?.touches ?? []).map(({ repoRelativePath }) => nodePath5.join(record2.repoRoot, repoRelativePath))
  );
  const response = bashResponseInterrupted(toolResponse) ? null : normalizeBashResponse(toolResponse);
  const responseSpans = response === null ? [] : parseResponse({ command, cwd, ...response });
  const filtered = filterPostTracked(combined, responseSpans, cwd, preTrackedPaths, preTrackedDeletes);
  const parserLatencyMs = performance.now() - parserStarted;
  const touchStarted = performance.now();
  let executionGateDrops = 0;
  let commandDiagnostics = {};
  const invocationId = toolUseId === void 0 ? null : `${sessionId}:${toolUseId}`;
  const commandBlocks = await runBashTouches(
    filtered.matches,
    sessionId,
    cwd,
    toolResponse,
    executors,
    memo,
    (message) => logger2.warn(message),
    true,
    (diagnostics) => {
      executionGateDrops = diagnostics.executionGateDrops;
      commandDiagnostics = diagnostics;
    },
    invocationId
  );
  const responseBatch = await runResponseReadTouches(
    filtered.responseSpans,
    cwd,
    sessionId,
    executors,
    memo,
    `${sessionId}:${toolUseId ?? createHash2("sha256").update(command).digest("hex")}:response`,
    logger2
  );
  const blocks = [...commandBlocks, ...responseBatch.blocks];
  logger2.info?.("git-span static attribution post", {
    resolvedReads: filtered.matches.filter((match) => match.status === "resolved" && match.span.operation === "read").length,
    resolvedWrites: filtered.matches.filter((match) => match.status === "resolved" && match.span.operation !== "read").length,
    unresolvedByIdiom: countBy(parsed.unresolved.map(({ idiom }) => idiom)),
    unresolvedByReason: countBy(parsed.unresolved.map(({ reasonCode }) => reasonCode)),
    scopeDrops: filtered.scopeDrops,
    trackedDrops: filtered.trackedDrops,
    executionGateDrops,
    parserLatencyMs,
    touchLatencyMs: performance.now() - touchStarted,
    ignoreQueryCount: filtered.ignoreQueryCount,
    trackedQueryCount: filtered.trackedQueryCount,
    eligibilityErrors: filtered.eligibilityErrors,
    contextQueryCount: (commandDiagnostics.queryCount ?? 0) + responseBatch.diagnostics.queryCount,
    contextScopeCount: (commandDiagnostics.scopeCount ?? 0) + responseBatch.diagnostics.scopeCount,
    contextSelectedResultCount: (commandDiagnostics.selectedResultCount ?? 0) + responseBatch.diagnostics.selectedResultCount,
    contextElapsedMs: (commandDiagnostics.elapsedMs ?? 0) + responseBatch.diagnostics.elapsedMs,
    contextMutation: commandDiagnostics.mutation ?? "unchanged",
    contextFailure: commandDiagnostics.failure ?? responseBatch.diagnostics.failure,
    dependencyContextSurfaced: blocks.length > 0
  });
  return blocks;
}

// src/common/update-check-env.ts
function disableUpdateCheck() {
  process.env.GIT_SPAN_DISABLE_UPDATE_CHECK = "1";
}

// src/common/advisor-core.ts
import { execFile } from "node:child_process";
import { createHash as createHash3 } from "node:crypto";
import * as fs8 from "node:fs";
import * as nodePath7 from "node:path";
import { promisify } from "node:util";

// src/common/advisor-ignore.ts
import * as fs7 from "node:fs";
import * as nodePath6 from "node:path";
var ADVISOR_IGNORE_REL = nodePath6.join(".span", ".advisorignore");
function parseAdvisorIgnore(content) {
  const rules = [];
  for (const rawLine of content.split("\n")) {
    const pattern = rawLine.trim();
    if (!pattern || pattern.startsWith("#")) continue;
    rules.push({ pattern, matches: compilePattern(pattern) });
  }
  return rules;
}
function loadAdvisorIgnore(repoRoot) {
  try {
    const content = fs7.readFileSync(nodePath6.join(repoRoot, ADVISOR_IGNORE_REL), "utf8");
    return parseAdvisorIgnore(content);
  } catch {
    return [];
  }
}
function isAdvisorIgnored(rules, repoRelPath) {
  return rules.some((rule) => rule.matches(repoRelPath));
}

// src/common/mechanical-change.ts
function parseUnifiedDiff(text) {
  const files = [];
  let current = null;
  let hunk = null;
  const flushHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flushHunk();
      if (current) files.push(current);
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      const path = m ? m[2] : line.slice(11);
      current = { path, hunks: [], binary: false, structural: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.binary = true;
      continue;
    }
    if (line.startsWith("new file mode") || line.startsWith("deleted file mode") || line.startsWith("rename from") || line.startsWith("rename to") || line.startsWith("old mode") || line.startsWith("new mode")) {
      current.structural = true;
      continue;
    }
    if (line.startsWith("index ")) continue;
    if (line.startsWith("@@")) {
      flushHunk();
      hunk = { removed: [], added: [] };
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("-")) hunk.removed.push(line.slice(1));
    else if (line.startsWith("+")) hunk.added.push(line.slice(1));
  }
  flushHunk();
  if (current) files.push(current);
  return files;
}
var NOISE_BASENAMES = /* @__PURE__ */ new Set([
  "yarn.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "go.sum",
  "composer.lock",
  "Gemfile.lock",
  "flake.lock",
  ".DS_Store"
]);
var NOISE_SUFFIXES = [
  ".tsbuildinfo",
  ".min.js",
  ".min.css",
  ".js.map",
  ".mjs.map",
  ".cjs.map",
  ".css.map",
  ".d.ts.map"
];
var NOISE_SEGMENTS = /* @__PURE__ */ new Set(["node_modules", "__pycache__"]);
function isNeverSpannedPath(repoRelPath) {
  const parts = repoRelPath.split("/");
  const base = parts[parts.length - 1] ?? "";
  if (NOISE_BASENAMES.has(base)) return true;
  if (NOISE_SUFFIXES.some((s) => repoRelPath.endsWith(s))) return true;
  if (parts.some((p) => NOISE_SEGMENTS.has(p))) return true;
  return false;
}
var SEMVER_RE = /\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b(?!\.\d)/g;
var HEXISH_RE = /\b[0-9a-f]{32,}\b|\bsha(?:256|512)-[A-Za-z0-9+/=]{20,}\b|\b[0-9a-f]{7,40}\/[0-9a-f]{7,40}\b/g;
var CHECKSUM_FIELD_RE = /\b(checksum|integrity|resolution|hash|digest|sha\d*)\b/i;
var DOTTED_QUAD_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
var VERSION_CONTEXT_RES = [
  /version/i,
  /(?<![=!<>+\-*/&|])[:=](?!=)\s*["'`]?v?\d+\.\d+\.\d+/,
  /^\s*v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\s*$/,
  /^\.[A-Za-z]{1,3}\s/
];
var MANIFEST_BASENAMES = /* @__PURE__ */ new Set([
  "package.json",
  "Cargo.toml",
  "marketplace.json",
  "plugin.json",
  "pyproject.toml",
  "composer.json",
  "go.mod"
]);
var TIMESTAMP_FIELD_RE = /\b(timestamps?|generated|generated_?at|built|built_?at|build_?time|date|datetime|time|created_?at|updated_?at|modified|last_?modified|expires|expires_?at|expiry|epoch|mtime|ctime|iat|exp|nbf)(?:Ms|MS|_ms)?\b/i;
var TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{10,13}\b/g;
function normalize(line, re) {
  return line.replace(re, " ");
}
function isVersionContext(line) {
  return VERSION_CONTEXT_RES.some((re) => re.test(line));
}
function isManifestPath(repoRelPath) {
  const parts = repoRelPath.split("/");
  return MANIFEST_BASENAMES.has(parts[parts.length - 1] ?? "");
}
function pairIsMechanical(removed, added, manifestPath) {
  if (removed === added) return false;
  if (!DOTTED_QUAD_RE.test(removed) && !DOTTED_QUAD_RE.test(added) && (manifestPath || isVersionContext(removed)) && normalize(removed, SEMVER_RE) === normalize(added, SEMVER_RE)) {
    return true;
  }
  if (CHECKSUM_FIELD_RE.test(removed) && normalize(removed, HEXISH_RE) === normalize(added, HEXISH_RE)) {
    return true;
  }
  if (TIMESTAMP_FIELD_RE.test(removed) && normalize(removed, TIMESTAMP_RE) === normalize(added, TIMESTAMP_RE)) {
    return true;
  }
  return false;
}
function isMechanicalDiff(file) {
  if (file.binary) return { mechanical: false, reason: "binary file" };
  if (file.structural) return { mechanical: false, reason: "structural change (rename/add/delete)" };
  if (file.hunks.length === 0) return { mechanical: false, reason: "no hunks" };
  const manifestPath = isManifestPath(file.path);
  for (let h = 0; h < file.hunks.length; h++) {
    const hunk = file.hunks[h];
    if (hunk.removed.length !== hunk.added.length || hunk.removed.length === 0) {
      return { mechanical: false, reason: `hunk ${h + 1}: unbalanced removed/added counts` };
    }
    for (let i = 0; i < hunk.removed.length; i++) {
      if (!pairIsMechanical(hunk.removed[i], hunk.added[i], manifestPath)) {
        return { mechanical: false, reason: `hunk ${h + 1}: no rule matched` };
      }
    }
  }
  return { mechanical: true };
}
var CLASSIFIABLE_BASENAMES = /* @__PURE__ */ new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "Cargo.toml",
  "Cargo.lock",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "plugin.json",
  "marketplace.json",
  "pyproject.toml",
  "composer.json",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "Pipfile.lock",
  "flake.lock",
  "go.mod",
  "go.sum"
]);
var MAN_PAGE_RE = /\.[1-9]$/;
function isClassifiablePath(repoRelPath) {
  const parts = repoRelPath.split("/");
  const base = parts[parts.length - 1] ?? "";
  if (CLASSIFIABLE_BASENAMES.has(base)) return true;
  if (base === "Dockerfile" || base.startsWith("Dockerfile.")) return true;
  return MAN_PAGE_RE.test(base);
}
function classifyMechanical(file) {
  if (isNeverSpannedPath(file.path)) return { mechanical: true };
  if (!isClassifiablePath(file.path)) {
    return { mechanical: false, reason: "not a manifest-shaped path: the classifier does not apply" };
  }
  return isMechanicalDiff(file);
}

// src/common/advisor-core.ts
var AdvisorScanError = class extends Error {
  detail;
  constructor(detail) {
    super(`git span drift could not complete its scan: ${detail}`);
    this.name = "AdvisorScanError";
    this.detail = detail;
  }
};
var AdvisorIncompatibleCliError = class extends Error {
  detail;
  installedVersion;
  constructor(detail, installedVersion) {
    super(`the installed git-span binary does not support this command: ${detail}`);
    this.name = "AdvisorIncompatibleCliError";
    this.detail = detail;
    this.installedVersion = installedVersion;
  }
};
var AdvisorDeadlineError = class extends Error {
  budgetMs;
  constructor(budgetMs) {
    super(`advisor evaluation exceeded its ${budgetMs} ms budget`);
    this.name = "AdvisorDeadlineError";
    this.budgetMs = budgetMs;
  }
};
function parseGitCommand(command) {
  for (const segment of splitSegments2(command)) {
    const inv = matchGitInvocation(tokenize2(segment));
    if (!inv) continue;
    if (inv.subcommand === "commit") {
      const dashDash = inv.args.indexOf("--");
      const paths = dashDash >= 0 ? inv.args.slice(dashDash + 1).filter((p) => p.length > 0) : [];
      return paths.length > 0 ? { kind: "commit", paths } : { kind: "commit" };
    }
    if (inv.subcommand === "push") {
      return { kind: "push" };
    }
    if (inv.subcommand === "status") {
      return { kind: "status" };
    }
  }
  return { kind: "none" };
}
var COMMIT_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-m",
  "--message",
  "-F",
  "--file",
  "-C",
  "--reuse-message",
  "-c",
  "--reedit-message",
  "--author",
  "--date",
  "-t",
  "--template",
  "--fixup",
  "--squash",
  "--trailer",
  "--cleanup",
  "--gpg-sign"
]);
function commitStagesAll(command) {
  for (const segment of splitSegments2(command)) {
    const inv = matchGitInvocation(tokenize2(segment));
    if (inv?.subcommand !== "commit") continue;
    const dashDash = inv.args.indexOf("--");
    const flagArgs = dashDash >= 0 ? inv.args.slice(0, dashDash) : inv.args;
    for (let i = 0; i < flagArgs.length; i++) {
      const arg = flagArgs[i];
      if (arg === "--all") return true;
      if (COMMIT_VALUE_OPTIONS.has(arg)) {
        i++;
        continue;
      }
      if (!arg.startsWith("--") && /^-[A-Za-z]*a[A-Za-z]*$/.test(arg)) return true;
    }
    return false;
  }
  return false;
}
var TWO_CHAR_OPERATORS = /* @__PURE__ */ new Set(["&&", "||"]);
var ONE_CHAR_SEPARATORS = /* @__PURE__ */ new Set([";", "|", "\n", "&", "(", ")"]);
function splitSegments2(command) {
  const segments = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (TWO_CHAR_OPERATORS.has(command.slice(i, i + 2))) {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (ONE_CHAR_SEPARATORS.has(ch)) {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}
function tokenize2(segment) {
  const tokens = [];
  let current = "";
  let has = false;
  let quote = null;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      has = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === " " || ch === "	") {
      if (has) {
        tokens.push(current);
        current = "";
        has = false;
      }
      continue;
    }
    current += ch;
    has = true;
  }
  if (has) tokens.push(current);
  return tokens;
}
var GIT_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--exec-path",
  "--attr-source",
  "--config-env"
]);
function matchGitInvocation(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (i >= tokens.length || tokens[i] !== "git") return null;
  i++;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "--") return null;
    if (!t.startsWith("-")) break;
    i += GIT_VALUE_OPTIONS.has(t) ? 2 : 1;
  }
  if (i >= tokens.length) return null;
  return { subcommand: tokens[i], args: tokens.slice(i + 1) };
}
async function resolveChangesetUnfiltered(kind, all, cwd, git, paths) {
  if (kind === "push") {
    const { paths: outgoing, base } = await git.outgoingPaths(cwd);
    return { paths: outgoing, range: base === null ? { kind: "unresolvable" } : { kind: "commits", base } };
  }
  if (kind === "status") {
    const [staged2, tracked2] = await Promise.all([git.stagedPaths(cwd), git.trackedModifiedPaths(cwd)]);
    return { paths: mergeUniquePaths(staged2, tracked2), range: { kind: "worktree" } };
  }
  if (paths && paths.length > 0) {
    return { paths: await git.pathspecPaths(paths, cwd), range: { kind: "worktree" } };
  }
  const staged = await git.stagedPaths(cwd);
  if (!all) return { paths: staged, range: { kind: "staged" } };
  const tracked = await git.trackedModifiedPaths(cwd);
  return { paths: mergeUniquePaths(staged, tracked), range: { kind: "worktree" } };
}
async function resolveChangeset(kind, all, cwd, git, paths) {
  const changeset = await resolveChangesetUnfiltered(kind, all, cwd, git, paths);
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot || changeset.paths.length === 0) return changeset;
  return { ...changeset, paths: changeset.paths.filter((p) => fs8.existsSync(nodePath7.join(repoRoot, p))) };
}
function mergeUniquePaths(...groups) {
  const seen = /* @__PURE__ */ new Set();
  const merged = [];
  for (const group of groups) {
    for (const path of group) {
      if (seen.has(path)) continue;
      seen.add(path);
      merged.push(path);
    }
  }
  return merged;
}
var GIT_SPAN_SKILL_REF = "git-span";
var SKILL_REF_TOKEN_START = "{{skill-ref:";
var SKILL_REF_TOKEN_END = "}}";
function skillRefToken(ref) {
  return `${SKILL_REF_TOKEN_START}${ref}${SKILL_REF_TOKEN_END}`;
}
async function evaluateAdvisor(paths, cwd, executors, memoState, mode = "may-hold", churn, harness = "generic", deadlineMs = EVALUATION_DEADLINE_MS, logger2) {
  if (paths.length === 0) return { decision: "allow", kind: "silent" };
  const controller = new AbortController();
  const { signal } = controller;
  let timer;
  try {
    const evaluation = (async () => {
      try {
        if (mode === "may-hold") {
          await executors.fix(paths, cwd, signal);
        }
        const driftRows = await executors.drift(paths, cwd, signal);
        const debtRows = driftRows.filter((row) => isDebt(row.status));
        const semantic = debtRows.filter((row) => !isEnvironmentalStatus(row.status));
        const environmental = debtRows.filter((row) => isEnvironmentalStatus(row.status));
        if (mode === "report-only") {
          if (semantic.length > 0) {
            memoState.record(`seen-${advisorStateDigest(semantic, [])}`);
            const newSemantic = filterNewReportItems(semantic, memoState, semanticReportIdentity);
            if (newSemantic.length === 0) return { decision: "allow", kind: "silent" };
            return {
              decision: "allow",
              kind: "semantic-drift-report",
              findings: newSemantic,
              ...renderDriftReason(
                newSemantic,
                await fetchSpanBlocks(executors, newSemantic, cwd, signal),
                "report-only",
                harness
              )
            };
          }
          if (environmental.length > 0) {
            return {
              decision: "allow",
              kind: "environmental",
              conditions: environmental,
              reason: renderEnvironmentalReason(
                environmental,
                await fetchSpanBlocks(executors, environmental, cwd, signal)
              )
            };
          }
          const { uncovered: uncovered2, covering: covering2 } = await computeUncoveredPaths(paths, cwd, executors, churn, signal);
          if (uncovered2.length === 0) return { decision: "allow", kind: "silent" };
          memoState.record(`seen-${advisorStateDigest([], uncovered2)}`);
          const newUncovered = filterNewReportItems(uncovered2, memoState, uncoveredReportIdentity);
          if (newUncovered.length === 0) return { decision: "allow", kind: "silent" };
          return {
            decision: "allow",
            kind: "uncovered-writes-report",
            uncovered: newUncovered,
            ...renderUncoveredReason(
              newUncovered,
              covering2,
              await fetchSpanBlocks(executors, covering2, cwd, signal),
              "report-only",
              harness
            )
          };
        }
        let semanticAlreadyPresented = false;
        if (semantic.length > 0) {
          const semanticDigest = advisorStateDigest(semantic, []);
          if (memoState.has(semanticDigest)) {
            semanticAlreadyPresented = true;
          } else if (memoState.has(`seen-${semanticDigest}`)) {
            memoState.record(semanticDigest);
            semanticAlreadyPresented = true;
          } else {
            if (!memoState.record(semanticDigest)) return { decision: "allow", kind: "silent" };
            memoState.record(`seen-${semanticDigest}`);
            return {
              decision: "hold",
              kind: "semantic-drift",
              findings: semantic,
              ...renderDriftReason(
                semantic,
                await fetchSpanBlocks(executors, semantic, cwd, signal),
                "may-hold",
                harness
              )
            };
          }
        }
        if (environmental.length > 0) {
          return {
            decision: "allow",
            kind: "environmental",
            conditions: environmental,
            reason: renderEnvironmentalReason(
              environmental,
              await fetchSpanBlocks(executors, environmental, cwd, signal)
            )
          };
        }
        const { uncovered, covering } = await computeUncoveredPaths(paths, cwd, executors, churn, signal);
        if (uncovered.length === 0) {
          return semanticAlreadyPresented ? { decision: "allow", kind: "already-presented" } : { decision: "allow", kind: "silent" };
        }
        const digest = advisorStateDigest([], uncovered);
        if (memoState.has(digest)) return { decision: "allow", kind: "already-presented" };
        if (memoState.has(`seen-${digest}`)) {
          memoState.record(digest);
          return { decision: "allow", kind: "already-presented" };
        }
        if (!memoState.record(digest)) return { decision: "allow", kind: "silent" };
        memoState.record(`seen-${digest}`);
        return {
          decision: "hold",
          kind: "uncovered-writes",
          uncovered,
          ...renderUncoveredReason(
            uncovered,
            covering,
            await fetchSpanBlocks(executors, covering, cwd, signal),
            "may-hold",
            harness
          )
        };
      } catch (err) {
        if (controller.signal.aborted) throw new AdvisorDeadlineError(deadlineMs);
        if (err instanceof AdvisorIncompatibleCliError) {
          return {
            decision: "allow",
            kind: "scan-failed",
            cause: "incompatible-cli",
            reason: renderIncompatibleCliReason(err)
          };
        }
        if (err instanceof AdvisorScanError) {
          return {
            decision: "allow",
            kind: "scan-failed",
            cause: "aborted",
            reason: renderScanFailedReason(err.detail)
          };
        }
        logger2?.warn("git-span advisor evaluation failed open on an unexpected error", { err });
        return { decision: "allow", kind: "silent" };
      }
    })();
    const expiry = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AdvisorDeadlineError(deadlineMs));
      }, deadlineMs);
    });
    return await Promise.race([evaluation, expiry]);
  } catch (err) {
    if (err instanceof AdvisorDeadlineError) {
      return {
        decision: "allow",
        kind: "scan-failed",
        cause: "deadline-exceeded",
        reason: renderDeadlineExceededReason(err.budgetMs)
      };
    }
    throw err;
  } finally {
    if (timer !== void 0) clearTimeout(timer);
    controller.abort();
  }
}
async function computeUncoveredPaths(paths, cwd, executors, churn, signal) {
  if (paths.length < 2) return { uncovered: [], covering: [] };
  const changeset = new Set(paths);
  const covering = (await executors.list(paths, cwd, signal)).filter((row) => changeset.has(row.path));
  const covered = new Set(covering.map((row) => row.path));
  const repoRoot = resolveRepoRoot(cwd);
  const advisorIgnoreRules = repoRoot ? loadAdvisorIgnore(repoRoot) : [];
  const spanRoot = repoRoot === null ? SPAN_ROOT : resolveSpanRoot(repoRoot);
  let uncovered = paths.filter(
    (path) => !covered.has(path) && !isInsideSpanRoot(path, spanRoot) && !isAdvisorIgnored(advisorIgnoreRules, path)
  );
  if (churn && uncovered.length > 0) {
    const before = uncovered.length;
    uncovered = uncovered.filter((path) => !isNeverSpannedPath(path));
    const suppressedByPath = before - uncovered.length;
    const needsContent = uncovered.filter(isClassifiablePath);
    const byPath = /* @__PURE__ */ new Map();
    let readOutcome = needsContent.length > 0 ? "clean" : "skipped";
    if (needsContent.length > 0) {
      try {
        for (const file of await churn.git.changedHunks(needsContent, churn.range, cwd, signal)) {
          byPath.set(file.path, file);
        }
      } catch {
        readOutcome = "failed";
      }
      const missing = needsContent.filter((path) => !byPath.has(path));
      if (missing.length > 0) {
        if (readOutcome === "clean") readOutcome = "per-file-fallback";
        for (const path of missing) {
          try {
            for (const file of await churn.git.changedHunks([path], churn.range, cwd, signal)) {
              byPath.set(file.path, file);
            }
          } catch {
            readOutcome = "failed";
          }
        }
      }
      uncovered = uncovered.filter((path) => {
        const file = byPath.get(path);
        if (!file) return true;
        return !classifyMechanical(file).mechanical;
      });
    }
    churn.logger?.info?.("git-span advisor churn suppression", {
      candidates: before,
      suppressedByPath,
      suppressedByContent: before - suppressedByPath - uncovered.length,
      reported: uncovered.length,
      read: readOutcome
    });
  }
  return { uncovered, covering };
}
function anchorText2(row) {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}
function advisorStateDigest(findings, uncovered) {
  const findingKeys = findings.map((row) => `${row.status}	${row.name}	${row.path}	${row.start}	${row.end}`).sort();
  const payload = JSON.stringify({ findings: findingKeys, uncovered: [...uncovered].sort() });
  return createHash3("sha256").update(payload).digest("hex");
}
function reportItemKey(identity) {
  return `report-${createHash3("sha256").update(identity).digest("hex")}`;
}
function semanticReportIdentity(row) {
  return JSON.stringify({ kind: "semantic", path: row.path, name: row.name });
}
function uncoveredReportIdentity(path) {
  return JSON.stringify({ kind: "uncovered", path });
}
function filterNewReportItems(items, memoState, identityOf) {
  const unseen = /* @__PURE__ */ new Set();
  for (const item of items) {
    const identity = identityOf(item);
    if (!memoState.has(reportItemKey(identity))) unseen.add(identity);
  }
  for (const identity of unseen) memoState.record(reportItemKey(identity));
  return items.filter((item) => unseen.has(identityOf(item)));
}
async function fetchSpanBlocks(executors, rows, cwd, signal) {
  const names = [...new Set(rows.map((row) => row.name))].sort();
  if (names.length === 0) return "";
  try {
    return await executors.listBlocks(names, cwd, signal);
  } catch {
    return "";
  }
}
function extractWhy(blocksText, name) {
  const trimmed = blocksText.trim();
  if (trimmed.length === 0) return "";
  for (const block of trimmed.split("\n\n---\n\n")) {
    const lines = block.split("\n");
    if (lines[0] !== `## ${name}`) continue;
    let i = 1;
    while (i < lines.length && (lines[i].startsWith("- ") || lines[i] === "*Span has no anchors*")) i++;
    if (lines[i] === "") i++;
    return lines.slice(i).join("\n").trim();
  }
  return "";
}
function dedupeByAnchor(rows) {
  const order = [];
  const byAddr = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const addr = anchorText2(row);
    let statuses = byAddr.get(addr);
    if (!statuses) {
      statuses = /* @__PURE__ */ new Set();
      byAddr.set(addr, statuses);
      order.push(addr);
    }
    statuses.add(row.status);
  }
  return order.map((addr) => ({ addr, statuses: [...byAddr.get(addr) ?? []].sort() }));
}
function rangeLabel2(row) {
  if (row.start === 0 && row.end === 0) return { kind: "whole-file" };
  return { kind: "range", start: row.start, end: row.end };
}
var BULLET_RANGE = /^(.+)#L(\d+)-L(\d+)$/;
function parseAnchorAddr(addr, suffix) {
  const matched = BULLET_RANGE.exec(addr);
  if (matched) {
    return { path: matched[1], range: { kind: "range", start: Number(matched[2]), end: Number(matched[3]) }, suffix };
  }
  const fragment = addr.indexOf("#L");
  if (fragment === -1) return { path: addr, range: { kind: "whole-file" }, suffix };
  return { path: addr.slice(0, fragment), range: { kind: "truncated" }, suffix };
}
function renderAnchorRun(rows, flat) {
  try {
    return renderAnchorTree(collapseByPath(rows));
  } catch {
    return flat;
  }
}
function annotateBulletRun(bulletLines, pending) {
  const addrs = bulletLines.map((line) => line.slice(2));
  const paths = addrs.map((addr) => addr.split("#")[0]);
  const claimed = addrs.map(() => []);
  const used = /* @__PURE__ */ new Set();
  const claim = (index, matches) => {
    for (const row of pending) {
      if (used.has(row) || !matches(row)) continue;
      claimed[index].push(row);
      used.add(row);
    }
  };
  for (const [i, addr] of addrs.entries()) {
    claim(i, (row) => anchorText2(row) === addr);
  }
  for (const [i, addr] of addrs.entries()) {
    if (paths.filter((path) => path === paths[i]).length !== 1) continue;
    claim(i, (row) => addr === row.path || addr.startsWith(`${row.path}#`));
  }
  const entries = addrs.map((addr, i) => {
    const rows = claimed[i];
    if (rows.length === 0) return { addr, suffix: "" };
    const statuses = [...new Set(rows.map((row) => row.status))].sort();
    return { addr, suffix: ` \u2014 ${statuses.map(humanStatusLabel).join(", ")}` };
  });
  for (const { addr, statuses } of dedupeByAnchor(pending.filter((row) => !used.has(row)))) {
    entries.push({ addr, suffix: ` \u2014 ${statuses.map(humanStatusLabel).join(", ")}` });
  }
  return entries;
}
function annotateBlocks(blocksText, rows) {
  const remaining = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const group = remaining.get(row.name);
    if (group) group.push(row);
    else remaining.set(row.name, [row]);
  }
  const out = [];
  let pending = [];
  let bullets = [];
  let inBullets = false;
  let runRows = [];
  let runFlat = [];
  const collect = (addr, suffix) => {
    runFlat.push(`- ${addr}${suffix}`);
    runRows.push(parseAnchorAddr(addr, suffix));
  };
  const closeBullets = () => {
    for (const { addr, suffix } of annotateBulletRun(bullets, pending)) {
      collect(addr, suffix);
    }
    if (runRows.length > 0) out.push(...renderAnchorRun(runRows, runFlat));
    bullets = [];
    pending = [];
    runRows = [];
    runFlat = [];
    inBullets = false;
  };
  const trimmed = blocksText.trim();
  if (trimmed.length > 0) {
    for (const line of trimmed.split("\n")) {
      const header = /^## (.+)$/.exec(line);
      if (header) {
        closeBullets();
        out.push(line);
        pending = remaining.get(header[1]) ?? [];
        remaining.delete(header[1]);
        inBullets = true;
        continue;
      }
      if (inBullets && line.startsWith("- ")) {
        bullets.push(line);
        continue;
      }
      if (inBullets) closeBullets();
      out.push(line);
    }
    closeBullets();
  }
  for (const [name, group] of remaining) {
    if (out.length > 0) out.push("", "---", "");
    out.push(`## ${name}`);
    const rows2 = [];
    const flat = [];
    for (const { addr, statuses } of dedupeByAnchor(group)) {
      const suffix = ` \u2014 ${statuses.map(humanStatusLabel).join(", ")}`;
      flat.push(`- ${addr}${suffix}`);
      rows2.push(parseAnchorAddr(addr, suffix));
    }
    out.push(...renderAnchorRun(rows2, flat));
  }
  return out.join("\n");
}
function renderDriftReason(findings, blocksText, mode = "may-hold", harness = "generic") {
  const names = [...new Set(findings.map((row) => row.name))];
  const subject = names.length === 1 ? "an implicit dependency" : "implicit dependencies";
  const name = names.length === 1 ? names[0] : "<name>";
  const action = `preserve anchor shape; if an address changed, swap the old anchor for the new one with \`git span replace\`; update or retire the why only if its meaning changed; require \`git span drift ${name}\` to report zero`;
  const inline = harness === "generic" || harness === "mswea";
  const lead = inline ? "Bring the coupled files back into agreement (follow confirmed authority)" : harness === "claude" ? "Dispatch a forked subagent to bring the coupled files back into agreement (follow confirmed authority)" : harness === "codex" ? 'Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`, to bring the coupled files back into agreement (follow confirmed authority)' : "Dispatch a subagent with the `task` tool to bring the coupled files back into agreement (follow confirmed authority)";
  const skillLine = harness === "opencode" ? "Load the `reconcile` skill via the skill tool in the subagent." : "Load the `git-span:reconcile` skill in the fork.";
  const tail = inline ? mode === "may-hold" ? `then reconcile: ${action}. Retry the command; the hold will not fire again for the same debt state. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.` : `then reconcile: ${action}. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.` : mode === "may-hold" ? `\u2014 ${action}. Then retry. ${skillLine} The hold will not fire again for the same debt state. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.` : `\u2014 ${action}. ${skillLine} Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.`;
  const closing = `${lead}${inline ? "," : ""} ${tail}`;
  return {
    reason: [
      `This change leaves ${subject} out of date:`,
      "",
      annotateBlocks(blocksText, findings),
      "",
      "---",
      "",
      closing
    ].join("\n")
  };
}
function wrapGitSpanContext(text) {
  if (text.includes("<git-span>")) return text;
  return `<git-span>
${text}
</git-span>`;
}
function renderEnvironmentalReason(conditions, blocksText) {
  return [
    "Could not check these implicit dependencies (unfetched LFS, sparse checkout, or similar) \u2014 not blocking:",
    "",
    annotateBlocks(blocksText, conditions),
    "",
    "---",
    "",
    "Fix the checkout/fetch issue if these dependencies need verifying."
  ].join("\n");
}
function renderDeadlineExceededReason(budgetMs) {
  return [
    `The implicit-dependency check exceeded its ${budgetMs} ms time budget, so this change was NOT verified:`,
    "<git-span-error>",
    indentBlockBody("a git or git-span subprocess did not finish in time; the scan was abandoned mid-flight"),
    "</git-span-error>",
    "",
    "The command proceeds anyway. Run `git span drift --format porcelain` manually if verification matters for this change."
  ].join("\n");
}
function renderScanFailedReason(detail) {
  return [
    "The implicit-dependency check could not run, so this change was NOT verified:",
    "<git-span-error>",
    indentBlockBody(detail),
    "</git-span-error>",
    "",
    "The command proceeds anyway. Fix the scan error if verification matters for this change."
  ].join("\n");
}
function renderIncompatibleCliReason(err) {
  const installed = err.installedVersion;
  const lagging = installed !== null && !isOlderThan(installed, REQUIRED_GIT_SPAN_VERSION) ? (
    // Binary is at or past what this plugin was built against, yet it
    // rejected the command — the plugin is the stale artifact.
    "the git-span plugin is older than the binary and is still issuing a retired command"
  ) : "the git-span binary is older than the plugin and does not know this command yet";
  return [
    "The implicit-dependency check could not run, so this change was NOT verified.",
    "",
    `The installed git-span binary reports ${installed ?? "no readable version"}; this plugin`,
    `expects ${REQUIRED_GIT_SPAN_VERSION} or compatible. They install through separate channels, so`,
    `they can drift apart \u2014 here, ${lagging}.`,
    "",
    "Bring them back in line, then retry:",
    "",
    "    npm install -g git-span@latest    # upgrade the binary",
    "    # and update the git-span plugin from the marketplace",
    "",
    "The command proceeds anyway. Nothing is wrong with this repository \u2014 but until",
    "the two are aligned, span drift is not being checked and spans are not being",
    "auto-reanchored on edit.",
    "",
    "<git-span-error>",
    indentBlockBody(`git-span reported: ${err.detail}`),
    "</git-span-error>"
  ].join("\n");
}
var RELATED_SPANS_CAP = 8;
function dirParts(path) {
  const parts = path.split("/");
  parts.pop();
  return parts;
}
function pathProximity(a, b) {
  const x = dirParts(a);
  const y = dirParts(b);
  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared++;
  const deepest = Math.max(x.length, y.length);
  if (deepest === 0) return 0;
  return shared / deepest;
}
function groupCoveringByName(covering, uncovered) {
  const byName = /* @__PURE__ */ new Map();
  for (const row of covering) {
    const group = byName.get(row.name) ?? { anchors: /* @__PURE__ */ new Map(), paths: /* @__PURE__ */ new Set() };
    const addr = anchorText2(row);
    if (!group.anchors.has(addr)) group.anchors.set(addr, row);
    group.paths.add(row.path);
    byName.set(row.name, group);
  }
  return [...byName.entries()].map(([name, group]) => {
    let proximity = 0;
    for (const path of group.paths) {
      for (const target of uncovered) proximity = Math.max(proximity, pathProximity(path, target));
    }
    return {
      name,
      // The determinism tie-break this section has always had, preserved
      // exactly: codepoint order over the anchor's `path#Lstart-Lend`
      // address, matching the plain `[...set].sort()` this replaced. The
      // tree renderer never re-sorts sibling paths, so it lays out whatever
      // order arrives here — which is why this sort must stay.
      anchors: [...group.anchors.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => row),
      coOccurrence: group.paths.size,
      proximity
    };
  }).sort(
    (a, b) => b.coOccurrence - a.coOccurrence || b.proximity - a.proximity || // Codepoint order, matching the plain `.sort()` this key replaced —
    // `localeCompare` would make the tie-break locale-dependent, and the
    // whole point of this key is that it is not.
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  ).map(({ name, anchors }) => ({ name, anchors }));
}
function renderRelatedSpansSection(covering, uncovered, coveringBlocksText) {
  if (covering.length === 0) return [];
  const lines = [
    "",
    "---",
    "",
    "Other files in this change already belong to spans \u2014 an uncovered file above might belong with one of these instead of a new one:"
  ];
  const groups = groupCoveringByName(covering, uncovered);
  for (const { name, anchors } of groups.slice(0, RELATED_SPANS_CAP)) {
    const rows = anchors.map((anchor) => ({ path: anchor.path, range: rangeLabel2(anchor), suffix: "" }));
    lines.push(
      "",
      `## ${name}`,
      ...renderAnchorRun(
        rows,
        anchors.map((anchor) => `- ${anchorText2(anchor)}`)
      )
    );
    const why = extractWhy(coveringBlocksText, name);
    if (why.length > 0) lines.push("", why);
  }
  const hidden = groups.length - RELATED_SPANS_CAP;
  if (hidden > 0) {
    lines.push(
      "",
      hidden === 1 ? (
        // The hidden spans cover *covered* paths, which this message never
        // names — so a `<path>` placeholder would leave the reader with
        // nothing to substitute. Bare `git span list` needs no argument and
        // is guaranteed to include them.
        "1 more span covers files in this change and is not shown \u2014 `git span list` lists every span in the repository."
      ) : `${hidden} more spans cover files in this change and are not shown \u2014 \`git span list\` lists every span in the repository.`
    );
  }
  return lines;
}
function renderUncoveredReason(uncovered, covering, coveringBlocksText, mode = "may-hold", harness = "generic") {
  const lines = uncovered.map((path) => `- ${path}`);
  const subject = uncovered.length === 1 ? "this file carries" : "these files carry";
  const inline = harness === "generic" || harness === "mswea";
  const actionLine = inline ? `Determine if ${subject} implicit dependencies, then use \`git span\` to document them:` : harness === "claude" ? `Dispatch a forked subagent to determine if ${subject} implicit dependencies and to then use \`git span\` to document them:` : harness === "codex" ? `Spawn a forked subagent with \`spawn_agent\`, setting \`fork_turns: "all"\`, to determine if ${subject} implicit dependencies and to then use \`git span\` to document them:` : `Dispatch a subagent with the \`task\` tool to determine if ${subject} implicit dependencies and to then use \`git span\` to document them:`;
  const body = [
    "<git-span>",
    ...lines,
    "",
    actionLine,
    "",
    "`git span add <name> <anchor> [<anchor>] ...`  \u2014 an anchor is a path or a `path#Lstart-Lend` range",
    '`git span why <name> "<why>"`',
    "",
    'The "<why>" is one or two complete present-tense clauses stating the relationship and any decisive nonlocal authority, invariant, permitted difference, lifecycle state, evidence gate, or focused conditional verification. Labels are optional but must introduce complete clauses. Omit generic work orders and CLI procedure.'
  ];
  body.push(...renderRelatedSpansSection(covering, uncovered, coveringBlocksText));
  if (mode === "may-hold") {
    body.push("", "If none exist, retry the command to proceed (one-time check).");
  }
  if (harness === "mswea") {
    body.push("", skillRefToken(GIT_SPAN_SKILL_REF), "</git-span>");
    return { reason: body.join("\n"), skillRef: GIT_SPAN_SKILL_REF };
  }
  body.push(
    "",
    harness === "generic" ? "Load the `git-span:git-span` skill for guidance." : harness === "opencode" ? "Load the `git-span` skill via the skill tool in the subagent." : "Load the `git-span:git-span` skill in the fork.",
    "</git-span>"
  );
  return { reason: body.join("\n") };
}
var DEFAULT_TIMEOUT_MS2 = 1e4;
var EVALUATION_DEADLINE_MS = 8e3;
var execFileAsync = promisify(execFile);
var MAX_STDOUT_BYTES = 64 * 1024 * 1024;
var GIT_READ_OPTS = ["-c", "core.quotepath=false"];
var GIT_DIFF_SHAPE_OPTS = ["--no-ext-diff", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"];
function buildHunkReadArgs(repoRoot, range, paths) {
  const rangeArgs = range.kind === "staged" ? ["--cached"] : range.kind === "worktree" ? ["HEAD"] : [`${range.base}..HEAD`];
  return ["-C", repoRoot, ...GIT_READ_OPTS, "diff", "-U0", ...GIT_DIFF_SHAPE_OPTS, ...rangeArgs, "--", ...paths];
}
async function gitText(args, cwd, timeoutMs, signal) {
  const outcome = await trySpawnGit(args, cwd, timeoutMs, signal);
  return outcome.ok ? outcome.stdout : "";
}
async function gitLines(args, cwd, timeoutMs, signal) {
  const outcome = await trySpawnGit(args, cwd, timeoutMs, signal);
  return outcome.ok ? splitPosixLines(outcome.stdout) : [];
}
async function gitLinesOrNull(args, cwd, timeoutMs, signal) {
  const outcome = await trySpawnGit(args, cwd, timeoutMs, signal);
  return outcome.ok ? splitPosixLines(outcome.stdout) : null;
}
function splitPosixLines(out) {
  return out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map(toPosix);
}
async function trySpawnGit(args, cwd, timeoutMs, signal) {
  if (signal?.aborted) return { ok: false, stdout: "", stderr: "" };
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_STDOUT_BYTES,
      timeout: timeoutMs,
      signal
    });
    return { ok: true, stdout };
  } catch (err) {
    const streams = err;
    return {
      ok: false,
      stdout: typeof streams.stdout === "string" ? streams.stdout : "",
      stderr: typeof streams.stderr === "string" ? streams.stderr : ""
    };
  }
}
function createDefaultGitExecutor(timeoutMs = DEFAULT_TIMEOUT_MS2) {
  return {
    stagedPaths: async (cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(
        ["-C", repoRoot, ...GIT_READ_OPTS, "diff", "--cached", "--name-only"],
        repoRoot,
        timeoutMs,
        signal
      );
    },
    trackedModifiedPaths: async (cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(["-C", repoRoot, ...GIT_READ_OPTS, "diff", "--name-only"], repoRoot, timeoutMs, signal);
    },
    outgoingPaths: async (cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return { paths: [], base: null };
      const upstream = await gitLinesOrNull(
        ["-C", repoRoot, ...GIT_READ_OPTS, "diff", "--name-only", "@{u}..HEAD"],
        repoRoot,
        timeoutMs,
        signal
      );
      if (upstream !== null) return { paths: upstream, base: "@{u}" };
      const base = (await gitLines(["-C", repoRoot, "merge-base", "HEAD", "origin/HEAD"], repoRoot, timeoutMs, signal))[0];
      if (!base) return { paths: [], base: null };
      return {
        paths: await gitLines(
          ["-C", repoRoot, ...GIT_READ_OPTS, "diff", "--name-only", `${base}..HEAD`],
          repoRoot,
          timeoutMs,
          signal
        ),
        base
      };
    },
    pathspecPaths: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      return gitLines(
        ["-C", repoRoot, ...GIT_READ_OPTS, "diff", "HEAD", "--name-only", "--", ...paths],
        repoRoot,
        timeoutMs,
        signal
      );
    },
    changedHunks: async (paths, range, cwd, signal) => {
      if (range.kind === "unresolvable" || paths.length === 0) return [];
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      const text = await gitText(buildHunkReadArgs(repoRoot, range, paths), repoRoot, timeoutMs, signal);
      if (text.trim().length === 0) return [];
      try {
        return parseUnifiedDiff(text);
      } catch {
        return [];
      }
    }
  };
}
var REQUIRED_GIT_SPAN_VERSION = "1.0.142";
function isArgumentParseFailure(stderr) {
  if (!/^\s*(usage|Usage):/m.test(stderr)) return false;
  return /error:\s+(unexpected argument|unrecognized subcommand|invalid subcommand|unknown (?:argument|subcommand)|the subcommand .* wasn't recognized|unexpected value)/i.test(
    stderr
  );
}
function parseSemverTriple(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function isOlderThan(version, floor) {
  const a = parseSemverTriple(version);
  const b = parseSemverTriple(floor);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}
async function probeGitSpanVersion(repoRoot, timeoutMs, signal) {
  const outcome = await trySpawnGit(["span", "--version"], repoRoot, timeoutMs, signal);
  if (!outcome.ok) return null;
  const triple = parseSemverTriple(outcome.stdout);
  return triple ? triple.join(".") : null;
}
async function classifyCliFailure(detail, repoRoot, timeoutMs, signal) {
  if (!isArgumentParseFailure(detail)) return new AdvisorScanError(detail);
  return new AdvisorIncompatibleCliError(detail, await probeGitSpanVersion(repoRoot, timeoutMs, signal));
}
function createDefaultAdvisorExecutors(timeoutMs = DEFAULT_TIMEOUT_MS2) {
  return {
    fix: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return;
      const outcome = await trySpawnGit(["span", "drift", ...paths, "--fix"], repoRoot, timeoutMs, signal);
      if (outcome.ok) return;
      const stderrText = outcome.stderr.trim();
      if (stderrText.length > 0) {
        const classified = await classifyCliFailure(stderrText, repoRoot, timeoutMs, signal);
        if (classified instanceof AdvisorIncompatibleCliError) throw classified;
      }
    },
    drift: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      const outcome = await trySpawnGit(
        ["span", "drift", "--format", "porcelain", ...paths],
        repoRoot,
        timeoutMs,
        signal
      );
      if (!outcome.ok && outcome.stdout.trim().length === 0 && outcome.stderr.trim().length > 0) {
        throw await classifyCliFailure(outcome.stderr.trim(), repoRoot, timeoutMs, signal);
      }
      return parseDriftPorcelain(outcome.stdout);
    },
    list: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      const outcome = await trySpawnGit(["span", "list", "--porcelain", ...paths], repoRoot, timeoutMs, signal);
      if (!outcome.ok && outcome.stdout.trim().length === 0 && outcome.stderr.trim().length > 0) {
        throw new AdvisorScanError(outcome.stderr.trim());
      }
      return parsePorcelain(outcome.stdout);
    },
    listBlocks: async (names, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || names.length === 0) return "";
      const outcome = await trySpawnGit(["span", "list", ...names], repoRoot, timeoutMs, signal);
      return outcome.ok ? outcome.stdout : "";
    }
  };
}
function createDiskAdvisorMemoState(cwd) {
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) {
    return { has: () => false, record: () => false };
  }
  const dir = advisorMemoDir(repoRoot);
  return {
    has: (digest) => {
      try {
        return fs8.existsSync(nodePath7.join(dir, digest));
      } catch {
        return false;
      }
    },
    record: (digest) => {
      try {
        fs8.mkdirSync(dir, { recursive: true });
        fs8.writeFileSync(nodePath7.join(dir, digest), "");
        return true;
      } catch {
        return false;
      }
    }
  };
}

// src/codex/advisor.ts
var CODEX_ADVISOR_HARD_DENY = true;
function extractShellCommand(toolInput) {
  if (toolInput === null || typeof toolInput !== "object" || !("command" in toolInput)) return null;
  const command = toolInput.command;
  if (typeof command === "string") return command.length > 0 ? command : null;
  if (Array.isArray(command)) {
    const parts = command.filter((p) => typeof p === "string");
    if (parts.length === 0) return null;
    const flagIdx = parts.findIndex((p) => p === "-c" || p === "-lc" || p === "-ic");
    if (flagIdx >= 0 && parts[flagIdx + 1] !== void 0) return parts[flagIdx + 1];
    return parts.join(" ");
  }
  return null;
}
function createHandler(git = createDefaultGitExecutor(), executors = createDefaultAdvisorExecutors(), memoFactory = createDiskAdvisorMemoState, hardDeny = CODEX_ADVISOR_HARD_DENY) {
  return async (input, ctx) => {
    try {
      ctx.logger.info("git-span advisor observed shell tool", { tool_name: input.tool_name });
      const command = extractShellCommand(input.tool_input);
      if (command === null) return void 0;
      const parsed = parseGitCommand(command);
      if (parsed.kind === "none") return void 0;
      const cwd = input.cwd ?? "";
      const all = parsed.kind === "commit" ? commitStagesAll(command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);
      const mode = parsed.kind === "status" ? "report-only" : "may-hold";
      const result = await evaluateAdvisor(
        changeset.paths,
        cwd,
        executors,
        memoFactory(cwd),
        mode,
        {
          git,
          range: changeset.range,
          // The hook logger is the only place a suppressed file leaves a trace —
          // the agent-facing output of a suppression is nothing at all.
          logger: ctx.logger
        },
        "codex",
        void 0,
        // Core defects (non-advisor-error throws) warn here instead of vanishing
        // into evaluateAdvisor's fail-open catch.
        ctx.logger
      );
      if (result.decision !== "hold") {
        if (result.kind === "environmental" || result.kind === "scan-failed") {
          ctx.logger.warn("git-span advisor allowed with an unresolved condition", { reason: result.reason });
          return preToolUseOutput({ additionalContext: wrapGitSpanContext(result.reason) });
        }
        if (result.kind === "semantic-drift-report" || result.kind === "uncovered-writes-report") {
          return preToolUseOutput({ additionalContext: wrapGitSpanContext(result.reason) });
        }
        return void 0;
      }
      if (hardDeny) {
        return preToolUseOutput({
          permissionDecision: "deny",
          permissionDecisionReason: result.reason
        });
      }
      const warning = `Could not block this command \u2014 the issue below still needs resolving:
${result.reason}`;
      return preToolUseOutput({ additionalContext: wrapGitSpanContext(warning) });
    } catch (err) {
      ctx.logger.warn("git-span advisor failed open on an uncaught error", { err });
      return void 0;
    }
  };
}
disableUpdateCheck();
var advisor_default = preToolUseHook({ matcher: "Bash|shell|exec|local_shell", timeout: 1e4 }, createHandler());

// src/codex/post-tool-use.ts
import { resolve as resolvePath3 } from "node:path";

// src/codex/apply-patch.ts
import * as fs9 from "node:fs";
var END_PATCH_MARKER = "*** End Patch";
var ADD_FILE_MARKER = "*** Add File: ";
var DELETE_FILE_MARKER = "*** Delete File: ";
var UPDATE_FILE_MARKER = "*** Update File: ";
var MOVE_TO_MARKER = "*** Move to: ";
var EOF_MARKER = "*** End of File";
var CHANGE_CONTEXT_MARKER = "@@ ";
var EMPTY_CHANGE_CONTEXT_MARKER = "@@";
function defaultReadPreEditFile(path) {
  try {
    return fs9.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
function toPosix2(p) {
  return p.replace(/\\/g, "/");
}
function scanHunks(command) {
  const hunks = [];
  let openUpdate = null;
  for (const raw of command.split("\n")) {
    const headerLine = openUpdate ? raw.replace(/[ \t\r]+$/, "") : raw.trim();
    if (headerLine === END_PATCH_MARKER) {
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(ADD_FILE_MARKER)) {
      hunks.push({ kind: "add", path: headerLine.slice(ADD_FILE_MARKER.length) });
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(DELETE_FILE_MARKER)) {
      hunks.push({ kind: "delete", path: headerLine.slice(DELETE_FILE_MARKER.length) });
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(UPDATE_FILE_MARKER)) {
      const hunk = {
        kind: "update",
        path: headerLine.slice(UPDATE_FILE_MARKER.length),
        movePath: null,
        chunks: []
      };
      hunks.push(hunk);
      openUpdate = hunk;
      continue;
    }
    if (openUpdate) {
      processUpdateLine(openUpdate, raw);
    }
  }
  return hunks;
}
function ensureChunk(hunk) {
  const last = hunk.chunks[hunk.chunks.length - 1];
  if (last) return last;
  const chunk = { changeContext: null, oldLines: [], newLines: [] };
  hunk.chunks.push(chunk);
  return chunk;
}
function processUpdateLine(hunk, raw) {
  const trimmedEnd = raw.replace(/[ \t\r]+$/, "");
  if (trimmedEnd === EOF_MARKER) return;
  if (hunk.chunks.length === 0 && hunk.movePath === null && trimmedEnd.startsWith(MOVE_TO_MARKER)) {
    hunk.movePath = trimmedEnd.slice(MOVE_TO_MARKER.length);
    return;
  }
  if (trimmedEnd === EMPTY_CHANGE_CONTEXT_MARKER) {
    hunk.chunks.push({ changeContext: null, oldLines: [], newLines: [] });
    return;
  }
  if (trimmedEnd.startsWith(CHANGE_CONTEXT_MARKER)) {
    hunk.chunks.push({ changeContext: trimmedEnd.slice(CHANGE_CONTEXT_MARKER.length), oldLines: [], newLines: [] });
    return;
  }
  if (raw === "") {
    const chunk = ensureChunk(hunk);
    chunk.oldLines.push("");
    chunk.newLines.push("");
    return;
  }
  const first = raw[0];
  if (first === " ") {
    const chunk = ensureChunk(hunk);
    const content = raw.slice(1);
    chunk.oldLines.push(content);
    chunk.newLines.push(content);
    return;
  }
  if (first === "+") {
    const chunk = ensureChunk(hunk);
    chunk.newLines.push(raw.slice(1));
    return;
  }
  if (first === "-") {
    const chunk = ensureChunk(hunk);
    chunk.oldLines.push(raw.slice(1));
    return;
  }
}
function splitLines(content) {
  return content.split("\n");
}
function scanLineIndices(lines, value) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === value) out.push(i);
  }
  return out;
}
function scanContiguousMatches(haystack, needle) {
  const out = [];
  if (needle.length === 0 || needle.length > haystack.length) return out;
  const last = haystack.length - needle.length;
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}
function buildLineOccurrences(lines) {
  const occurrences = /* @__PURE__ */ new Map();
  for (let i = 0; i < lines.length; i++) {
    const seen = occurrences.get(lines[i]);
    if (seen === void 0) occurrences.set(lines[i], i);
    else if (typeof seen === "number") occurrences.set(lines[i], [seen, i]);
    else seen.push(i);
  }
  return occurrences;
}
function occurrencesOf(occurrences, value) {
  const seen = occurrences.get(value);
  if (seen === void 0) return [];
  return typeof seen === "number" ? [seen] : seen;
}
function indexedContiguousMatches(haystack, needle, occurrences) {
  const out = [];
  if (needle.length === 0 || needle.length > haystack.length) return out;
  const last = haystack.length - needle.length;
  for (const start of occurrencesOf(occurrences, needle[0])) {
    if (start > last) break;
    let ok = true;
    for (let j = 1; j < needle.length; j++) {
      if (haystack[start + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(start);
  }
  return out;
}
function preEditLines(lines, chunkCount) {
  if (chunkCount <= 1) {
    return {
      lineIndices: (value) => scanLineIndices(lines, value),
      contiguousMatches: (needle) => scanContiguousMatches(lines, needle)
    };
  }
  const occurrences = buildLineOccurrences(lines);
  return {
    lineIndices: (value) => occurrencesOf(occurrences, value),
    contiguousMatches: (needle) => indexedContiguousMatches(lines, needle, occurrences)
  };
}
function locateChunk(preLines, chunk) {
  const block = chunk.oldLines;
  if (block.length === 0) {
    const ctx2 = chunk.changeContext;
    if (ctx2 !== null && ctx2 !== "") {
      const ctxIdxs = preLines.lineIndices(ctx2);
      if (ctxIdxs.length === 1) {
        const line = ctxIdxs[0] + 1;
        return { start: line, end: line };
      }
    }
    return null;
  }
  const starts = preLines.contiguousMatches(block);
  if (starts.length === 1) {
    const s = starts[0];
    return { start: s + 1, end: s + block.length };
  }
  if (starts.length === 0) return null;
  const ctx = chunk.changeContext;
  if (ctx !== null && ctx !== "") {
    for (const c of preLines.lineIndices(ctx)) {
      const after = starts.find((s) => s >= c);
      if (after !== void 0) {
        return { start: after + 1, end: after + block.length };
      }
    }
  }
  return null;
}
function recoverRange2(preLines, chunks) {
  let union = null;
  for (const chunk of chunks) {
    const r = locateChunk(preLines, chunk);
    if (r === null) return null;
    union = union === null ? r : { start: Math.min(union.start, r.start), end: Math.max(union.end, r.end) };
  }
  return union;
}
function parseApplyPatch(command, readPreEditFile = defaultReadPreEditFile) {
  const anchors = [];
  for (const hunk of scanHunks(command)) {
    if (hunk.kind === "add") {
      anchors.push({ path: toPosix2(hunk.path), kind: "create" });
      continue;
    }
    if (hunk.kind === "delete") {
      anchors.push({ path: toPosix2(hunk.path), kind: "whole-write", absent: true });
      continue;
    }
    const targetPath = toPosix2(hunk.movePath ?? hunk.path);
    if (hunk.movePath !== null) {
      anchors.push({ path: targetPath, kind: "whole-write" });
      continue;
    }
    const content = readPreEditFile(hunk.path);
    const pre = content === null ? null : preEditLines(splitLines(content), hunk.chunks.length);
    const range = pre === null ? null : recoverRange2(pre, hunk.chunks);
    if (range !== null) {
      anchors.push({ path: targetPath, kind: "write", range });
    } else {
      anchors.push({ path: targetPath, kind: "whole-write" });
    }
  }
  return anchors;
}

// src/common/apply-patch-touch.ts
var noRangeRecovery = () => null;
async function runApplyPatchTouches(patchText, cwd, sessionId, planned, executors, memo, invocationId, logger2) {
  const plannedPaths = new Set(planned.map(({ absolutePath }) => absolutePath));
  const fallback = parseApplyPatch(patchText, noRangeRecovery).map(
    (anchor) => ({
      absolutePath: abspathAgainst(cwd, anchor.path),
      operation: anchor.absent ? "delete" : anchor.kind === "create" ? "create-overwrite" : "modify",
      ranges: anchor.range === void 0 ? [] : [anchor.range],
      preTrackedDelete: false
    })
  ).filter(({ absolutePath }) => !plannedPaths.has(absolutePath));
  const candidates = [...planned, ...fallback];
  const tracked = filterTrackedEligibility(
    candidates.map((value) => ({ absolutePath: value.absolutePath, value })),
    { cwd }
  );
  const eligible = new Set(tracked.eligible.map(({ value }) => value));
  for (const candidate of candidates) if (candidate.preTrackedDelete) eligible.add(candidate);
  const touches = [];
  for (const candidate of candidates) {
    if (!eligible.has(candidate)) continue;
    const ranges = candidate.ranges.length === 0 ? [void 0] : candidate.ranges;
    for (const range of ranges) {
      touches.push({
        kind: "write",
        sessionId,
        cwd,
        filePath: candidate.absolutePath,
        ...invocationId === null ? {} : { invocationId },
        written: "",
        range,
        targetState: candidate.operation === "delete" ? "absent" : "exists",
        ...candidate.operation === "delete" ? { postState: { realDelete: true } } : {}
      });
    }
  }
  const batch = await runTouchHooks(touches, executors, memo, invocationId, void 0, logger2);
  return batch.outputs.flatMap((output) => output.additionalContext === null ? [] : [output.additionalContext]);
}

// src/codex/post-tool-use.ts
var APPLY_PATCH_SUCCESS_PREFIX = "Success. Updated the following files:";
function narrowApplyPatchCommand(toolInput) {
  if (toolInput !== null && typeof toolInput === "object" && "command" in toolInput) {
    const command = toolInput.command;
    if (typeof command === "string") return command;
  }
  return null;
}
function narrowExecCommand(toolInput) {
  if (toolInput !== null && typeof toolInput === "object" && "arguments" in toolInput) {
    const args = toolInput.arguments;
    if (typeof args === "string") {
      try {
        const parsed = JSON.parse(args);
        if (parsed !== null && typeof parsed === "object" && typeof parsed.cmd === "string") {
          return { cmd: parsed.cmd, workdir: typeof parsed.workdir === "string" ? parsed.workdir : null };
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}
function quoteObjectKeys(literal) {
  let out = "";
  let index = 0;
  while (index < literal.length) {
    const character = literal[index];
    if (character === '"' || character === "'") {
      const quote = character;
      const start = index;
      index += 1;
      while (index < literal.length) {
        if (literal[index] === "\\" && index + 1 < literal.length) index += 2;
        else if (literal[index] === quote) {
          index += 1;
          break;
        } else index += 1;
      }
      out += literal.slice(start, index);
      continue;
    }
    const key = literal.slice(index).match(/^(\{|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/);
    if (key !== null) {
      out += `${key[1]}"${key[2]}":`;
      index += key[0].length;
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}
function narrowCodeModeExec(toolInput) {
  if (toolInput !== null && typeof toolInput === "object" && "input" in toolInput) {
    const input = toolInput.input;
    if (typeof input === "string") {
      const match = input.match(/tools\.exec_command\(\s*(\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})\s*\)/);
      if (match !== null) {
        try {
          const parsed = JSON.parse(quoteObjectKeys(match[1]));
          if (parsed !== null && typeof parsed === "object" && typeof parsed.cmd === "string") {
            return {
              matched: true,
              cmd: parsed.cmd,
              workdir: typeof parsed.workdir === "string" ? parsed.workdir : null
            };
          }
        } catch {
          return { matched: true, cmd: null, workdir: null };
        }
        return { matched: true, cmd: null, workdir: null };
      }
    }
  }
  return { matched: false, cmd: null, workdir: null };
}
function classifyApplyPatchResponse(toolResponse) {
  if (Array.isArray(toolResponse)) return "unknown";
  const normalized = normalizeBashResponse(toolResponse);
  if (normalized === null) return "unknown";
  return normalized.stdout.startsWith(APPLY_PATCH_SUCCESS_PREFIX) ? "success" : "failure";
}
function plannedPatchCandidates(record2, cwd) {
  const repoRoot = resolveRepoRoot(cwd);
  if (record2 === null || repoRoot === null || toPosix(record2.repoRoot) !== toPosix(repoRoot)) return [];
  return record2.touches.map((touch) => ({
    absolutePath: resolvePath3(record2.repoRoot, touch.repoRelativePath),
    operation: touch.operation === "delete" ? "delete" : touch.operation === "create-overwrite" ? "create-overwrite" : "modify",
    ranges: touch.ranges,
    preTrackedDelete: touch.operation === "delete" && touch.evidence?.kind === "tracked"
  }));
}
function createHandler2(executors = createDefaultTouchExecutors(), memoFactory = createDiskMemoStore, layout = DEFAULT_SESSION_LAYOUT) {
  return async (input, ctx) => {
    const cwd = input.cwd ?? "";
    const sessionId = input.session_id;
    const memo = memoFactory(ctx.logger, layout);
    if (["Bash", "shell", "local_shell", "exec_command", "exec"].includes(input.tool_name)) {
      let command2 = extractShellCommand(input.tool_input);
      let workdir = null;
      if (command2 === null) {
        const classic = narrowExecCommand(input.tool_input);
        command2 = classic?.cmd ?? null;
        workdir = classic?.workdir ?? null;
      }
      if (command2 === null && input.tool_name === "exec") {
        const codeMode = narrowCodeModeExec(input.tool_input);
        if (codeMode.matched && codeMode.cmd === null) {
          ctx.logger.warn("Codex code-mode exec envelope matched but its command is not statically recoverable");
        }
        command2 = codeMode.cmd;
        workdir = codeMode.workdir;
      }
      if (command2 === null || command2.length === 0) return void 0;
      const effectiveCwd = resolveFrame(workdir ?? void 0, cwd);
      const blocks2 = await runLayeredBashTouches(
        command2,
        effectiveCwd,
        sessionId,
        input.tool_use_id,
        input.tool_response,
        executors,
        memo,
        ctx.logger,
        createDefaultPlannedTouchStore(layout)
      );
      if (blocks2.length === 0) return void 0;
      return postToolUseOutput({ additionalContext: blocks2.join("") });
    }
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return void 0;
    const store = createDefaultPlannedTouchStore(layout);
    const planned = input.tool_use_id === void 0 ? { status: "missing" } : store.take(sessionId, input.tool_use_id);
    if (planned.status === "consumed") return void 0;
    const record2 = planned.status === "record" ? planned.record : null;
    const classification = classifyApplyPatchResponse(input.tool_response);
    if (classification === "failure") return void 0;
    if (classification === "unknown") {
      ctx.logger.warn("Codex apply_patch tool_response shape unrecognized; suppressing attribution");
      return void 0;
    }
    const blocks = await runApplyPatchTouches(
      command,
      cwd,
      sessionId,
      plannedPatchCandidates(record2, cwd),
      executors,
      memo,
      input.tool_use_id === void 0 ? null : `${sessionId}:${input.tool_use_id}`,
      ctx.logger
    );
    if (blocks.length === 0) return void 0;
    return postToolUseOutput({ additionalContext: blocks.join("") });
  };
}
disableUpdateCheck();
var post_tool_use_default = postToolUseHook(
  { matcher: "apply_patch|exec_command|exec|shell|local_shell|Bash", timeout: 1e4 },
  createHandler2()
);

// src/codex/static-plan.ts
function narrowShellPlanInput(toolInput) {
  const direct = extractShellCommand(toolInput);
  if (direct !== null) return { command: direct, workdir: null };
  const classic = narrowExecCommand(toolInput);
  if (classic !== null) return { command: classic.cmd, workdir: classic.workdir };
  const codeMode = narrowCodeModeExec(toolInput);
  return codeMode.cmd === null ? null : { command: codeMode.cmd, workdir: codeMode.workdir };
}
function createHandler3(layout = DEFAULT_SESSION_LAYOUT) {
  return async (input, ctx) => {
    try {
      if (!input.session_id || !input.tool_use_id) return void 0;
      const narrowed = narrowShellPlanInput(input.tool_input);
      if (narrowed === null) return void 0;
      const cwd = input.cwd ?? "";
      const effectiveCwd = narrowed.workdir !== null && !/[`$]/.test(narrowed.workdir) ? resolvePath4(cwd, narrowed.workdir) : cwd;
      planBashTouches(
        narrowed.command,
        effectiveCwd,
        input.session_id,
        input.tool_use_id,
        ctx.logger,
        createDefaultPlannedTouchStore(layout)
      );
      return void 0;
    } catch (err) {
      ctx.logger.warn("git-span static Bash pre-plan failed closed for attribution", { err });
      return void 0;
    }
  };
}
disableUpdateCheck();
var static_plan_default = preToolUseHook(
  { matcher: "Bash|shell|exec|local_shell|exec_command", timeout: 1e4 },
  createHandler3()
);

// src/codex/static-plan-entry.ts
execute(static_plan_default);
