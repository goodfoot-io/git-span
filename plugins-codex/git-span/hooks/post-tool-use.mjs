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
async function readStdin() {
  return new Promise((resolve2, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve2(chunks.join("")));
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
function isAbsolutePosix(p) {
  return p.startsWith("/") || /^[A-Za-z]:\//.test(p);
}
function abspathAgainst(base, target) {
  const t = toPosix(target);
  if (isAbsolutePosix(t)) return t;
  const b = toPosix(base).replace(/\/+$/, "");
  return `${b}/${t}`;
}
function resolveRepoRoot(dir) {
  if (!dir) return null;
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
var SESSION_BASE_DIR = nodePath.join(os.homedir(), ".cache", "git-span", "session");
function sessionDir(sessionId) {
  return nodePath.join(SESSION_BASE_DIR, sanitizeSessionId(sessionId));
}
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
function pruneStaleSessions(now = Date.now(), maxAgeMs = THIRTY_DAYS_MS) {
  let entries;
  try {
    entries = fs.readdirSync(SESSION_BASE_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = nodePath.join(SESSION_BASE_DIR, entry.name);
    try {
      const stat = fs.statSync(dirPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    } catch {
    }
  }
}

// src/common/parse-command.ts
import { resolve as resolvePath } from "node:path";

// src/common/command-resolve.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { readFileSync, statSync as statSync2 } from "node:fs";
function countFileLines(absolutePath) {
  try {
    if (!statSync2(absolutePath).isFile()) return null;
    const content = readFileSync(absolutePath, "utf8");
    if (content.length === 0) return 0;
    const withoutTrailingNewline = content.endsWith("\n") ? content.slice(0, -1) : content;
    return withoutTrailingNewline.split("\n").length;
  } catch {
    return null;
  }
}
function countGitBlobLines(cwd, rev, path) {
  try {
    const out = execFileSync2("git", ["show", `${rev}:${path}`], {
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

// src/common/shell-split.ts
function splitTopLevel(cmd) {
  const parts = [];
  let buf = "";
  let i = 0;
  const n = cmd.length;
  let depth = 0;
  let inSquote = false;
  let inDquote = false;
  let pendingOp = "start";
  const flush = (nextOp) => {
    const s = buf.trim();
    if (s) parts.push({ text: s, precededBy: pendingOp });
    buf = "";
    pendingOp = nextOp;
  };
  const isPendingPipe = () => pendingOp === "|";
  while (i < n) {
    const c = cmd[i];
    if (inSquote) {
      buf += c;
      if (c === "'") inSquote = false;
      i += 1;
      continue;
    }
    if (inDquote) {
      buf += c;
      if (c === "\\" && i + 1 < n) {
        buf += cmd[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inDquote = false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      buf += c + cmd[i + 1];
      i += 2;
      continue;
    }
    if (c === "(") {
      depth += 1;
      buf += c;
      i += 1;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      buf += c;
      i += 1;
      continue;
    }
    if (depth === 0) {
      if (cmd.slice(i, i + 2) === "&&") {
        flush("other");
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === "||") {
        flush("other");
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === "|&") {
        flush("|");
        i += 2;
        continue;
      }
      if (c === ";") {
        flush("other");
        i += 1;
        continue;
      }
      if (c === "|") {
        flush("|");
        i += 1;
        continue;
      }
      if (c === "\n") {
        if (isPendingPipe()) {
          i += 1;
          continue;
        }
        flush("other");
        i += 1;
        continue;
      }
      if (c === "&") {
        flush("other");
        i += 1;
        continue;
      }
    }
    buf += c;
    i += 1;
  }
  flush("other");
  return parts;
}
var LEADING_ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;
function stripLeadingAssignments(simpleCmd) {
  return simpleCmd.replace(LEADING_ASSIGNMENT, "");
}
function splitWords(s) {
  const words = [];
  let cur = "";
  let has = false;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (has) {
        words.push(cur);
        cur = "";
        has = false;
      }
      i += 1;
      continue;
    }
    if (c === "'") {
      has = true;
      i += 1;
      const end = s.indexOf("'", i);
      if (end === -1) return null;
      cur += s.slice(i, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      has = true;
      i += 1;
      while (i < n && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < n && '"\\$`'.includes(s[i + 1])) {
          cur += s[i + 1];
          i += 2;
        } else {
          cur += s[i];
          i += 1;
        }
      }
      if (i >= n) return null;
      i += 1;
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      has = true;
      cur += s[i + 1];
      i += 2;
      continue;
    }
    has = true;
    cur += c;
    i += 1;
  }
  if (has) words.push(cur);
  return words;
}
function argvOf(simpleCmd) {
  return splitWords(stripLeadingAssignments(simpleCmd).trim());
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
function parseHeadTailFlags(rest) {
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
      fromStart = true;
      count = Number.parseInt(a.slice(1), 10);
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
  const { count, disqualified, files } = parseHeadTailFlags(argv.slice(1));
  if (disqualified) return [];
  const realFiles = files.filter((f) => f !== "-");
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
  const { count, fromStart, disqualified, files } = parseHeadTailFlags(argv.slice(1));
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
  if (!sub || sub.subcommand !== "show") return [];
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
  if (!sub || sub.subcommand !== "log") return [];
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
var HEREDOC_OPEN = /\bcat[ \t]+(>{1,2})[ \t]*(\S+)[ \t]*<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))[ \t]*\r?\n/g;
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function extractHeredocWrites(raw) {
  const writes = [];
  let masked = "";
  let cursor = 0;
  HEREDOC_OPEN.lastIndex = 0;
  let openMatch = HEREDOC_OPEN.exec(raw);
  while (openMatch !== null) {
    const [, redirect, target, dash, dq1, dq2, bare] = openMatch;
    const delim = dq1 ?? dq2 ?? bare;
    const bodyStart = openMatch.index + openMatch[0].length;
    if (!delim || bodyStart < cursor) {
      HEREDOC_OPEN.lastIndex = openMatch.index + 1;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    const closeRe = new RegExp(`^${dash ? "\\t*" : ""}${escapeRegExp(delim)}[ \\t]*$`, "m");
    const remainder = raw.slice(bodyStart);
    const closeMatch = closeRe.exec(remainder);
    if (!closeMatch) {
      HEREDOC_OPEN.lastIndex = bodyStart;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    const body = remainder.slice(0, closeMatch.index).replace(/\n$/, "");
    const matchEnd = bodyStart + closeMatch.index + closeMatch[0].length;
    masked += raw.slice(cursor, openMatch.index);
    masked += `__heredoc_${writes.length}__`;
    cursor = matchEnd;
    writes.push({ redirect, target, body });
    HEREDOC_OPEN.lastIndex = matchEnd;
    openMatch = HEREDOC_OPEN.exec(raw);
  }
  masked += raw.slice(cursor);
  return { writes, masked };
}
var LINE_SELECTORS = [matchSed, matchHead, matchTail];
function parseCommandDetailed(command, cwd = process.cwd()) {
  const { writes: heredocWrites, masked } = extractHeredocWrites(command);
  const simpleCommands = splitTopLevel(masked);
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
  const emitCandidate = (c, dirForResolution) => {
    if (looksUnresolvable(c.fileArg)) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: "path contains an unexpanded shell variable or glob"
      });
      return;
    }
    const absolutePath = resolvePath(dirForResolution, c.fileArg);
    const totalLines = c.resolverKind === "fs" ? cachedFsTotalLines(absolutePath) : cachedGitTotalLines(c.dirOverride ?? dirForResolution, c.resolverKind.rev, c.fileArg);
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
      span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath }
    });
  };
  for (let i = 0; i < simpleCommands.length; i++) {
    const simple = simpleCommands[i];
    const heredocRef = simple.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef) {
      lastPlainFileSource = null;
      const w = heredocWrites[Number.parseInt(heredocRef[1], 10)];
      if (looksUnresolvable(w.target)) {
        results.push({
          status: "unresolved",
          idiom: "heredoc-write",
          fileArg: w.target,
          reason: "path contains an unexpanded shell variable or glob"
        });
        continue;
      }
      const absolutePath = resolvePath(currentDir, w.target);
      const bodyLines = w.body.length === 0 ? 0 : w.body.split("\n").length;
      if (bodyLines === 0) {
        if (w.redirect !== ">") continue;
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: { lineStart: 1, lineEnd: 1, absolutePath, body: "", redirect: w.redirect }
        });
        continue;
      }
      const spec = w.redirect === ">" ? { kind: "literal", start: 1, end: bodyLines } : { kind: "appendLines", count: bodyLines };
      const range = resolveSpec(spec, cachedFsTotalLines(absolutePath));
      if (range === null) {
        results.push({
          status: "unresolved",
          idiom: "heredoc-write",
          fileArg: absolutePath,
          reason: "append target: could not read existing file to find its current length"
        });
      } else {
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath, body: w.body, redirect: w.redirect }
        });
      }
      continue;
    }
    const argv = argvOf(simple.text);
    if (!argv || argv.length === 0) {
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
      if (next === void 0 || next.precededBy !== "|") {
        emitCandidate(
          {
            kind: "candidate",
            idiom: argv[0] === "cat" ? "cat-file" : "nl-file",
            fileArg: plainFileArg,
            spec: { kind: "toEof", start: 1 },
            resolverKind: "fs"
          },
          currentDir
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
          emitCandidate(outcome, outcome.dirOverride ?? currentDir);
          if (outcome.idiom === "git-show-rev-path" && !looksUnresolvable(outcome.fileArg)) {
            isPlainSource = true;
            lastPlainFileSource = resolvePath(outcome.dirOverride ?? currentDir, outcome.fileArg);
          }
        }
      }
    }
    if (!matched && simple.precededBy === "|" && lastPlainFileSource) {
      const withFile = [...argv, lastPlainFileSource];
      for (const matcher of LINE_SELECTORS) {
        for (const outcome of matcher(withFile)) {
          if (outcome.kind === "candidate") emitCandidate(outcome, currentDir);
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
  }
  return results;
}

// src/common/span-surface.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import * as fs3 from "node:fs";
import * as nodePath3 from "node:path";

// src/common/span-ignore.ts
import * as fs2 from "node:fs";
import * as nodePath2 from "node:path";
var HOOK_IGNORE_REL = nodePath2.join(".span", ".hookignore");

// src/common/span-surface.ts
function memoFilePath(sessionId) {
  return nodePath3.join(sessionDir(sessionId), "touch-memo.json");
}
function createDiskMemoStore(logger2) {
  return {
    getSurfaced(sessionId) {
      pruneStaleSessions();
      try {
        const raw = fs3.readFileSync(memoFilePath(sessionId), "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.surfaced)) {
          return new Set(parsed.surfaced);
        }
      } catch (err) {
        logger2.warn("memo read failed (treating as empty)", { err });
      }
      return /* @__PURE__ */ new Set();
    },
    addSurfaced(sessionId, names) {
      pruneStaleSessions();
      const existing = this.getSurfaced(sessionId);
      for (const n of names) existing.add(n);
      const memoDir = sessionDir(sessionId);
      const memoPath = memoFilePath(sessionId);
      const tmpPath = `${memoPath}.tmp`;
      try {
        fs3.mkdirSync(memoDir, { recursive: true });
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

// src/common/touch-core.ts
import { execFileSync as execFileSync4 } from "node:child_process";
import * as fs4 from "node:fs";
import { basename as basename2 } from "node:path";

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
function intersects(row, range) {
  if (range === "whole-file") return true;
  if (row.start === 0 && row.end === 0) return true;
  return rangesIntersect(range, { start: row.start, end: row.end });
}
function recoverRangeFromDisk(written, filePath) {
  if (written.length === 0) return "whole-file";
  let content;
  try {
    content = fs4.readFileSync(filePath, "utf8");
  } catch {
    return "whole-file";
  }
  return recoverRange(written, content);
}
var DEFAULT_READ_LIMIT = 2e3;
function recoverReadRange(offset, limit, filePath) {
  if (offset === void 0 && limit === void 0) return "whole-file";
  const start = offset ?? 1;
  let lineCount;
  try {
    const content = fs4.readFileSync(filePath, "utf8");
    lineCount = content.length === 0 ? 0 : content.split("\n").length;
  } catch {
    return "whole-file";
  }
  const end = Math.min(start + (limit ?? DEFAULT_READ_LIMIT) - 1, Math.max(lineCount, start));
  return { start, end };
}
function onTouchedFile(row, filePath) {
  return filePath === row.path || filePath.endsWith(`/${row.path}`);
}
async function computeSurface(input, executors, memo, range) {
  const covering = await executors.list(input.filePath, input.cwd);
  if (covering.length === 0) return null;
  const anchorsByName = /* @__PURE__ */ new Map();
  for (const row of covering) {
    const rows = anchorsByName.get(row.name) ?? [];
    rows.push(row);
    anchorsByName.set(row.name, rows);
  }
  const touchedNames = [...anchorsByName.keys()].filter(
    (name) => (anchorsByName.get(name) ?? []).some((row) => onTouchedFile(row, input.filePath) && intersects(row, range))
  );
  if (touchedNames.length === 0) return null;
  const driftRows = await executors.drift([input.filePath], input.cwd);
  const driftByName = /* @__PURE__ */ new Map();
  for (const row of driftRows) {
    const rows = driftByName.get(row.name) ?? [];
    rows.push(row);
    driftByName.set(row.name, rows);
  }
  const surfaced = memo.getSurfaced(input.sessionId);
  const toRecord = [];
  const sections = [];
  const driftedNames = [];
  for (const name of touchedNames) {
    const spanDrift = driftByName.get(name) ?? [];
    const debtRows = spanDrift.filter((row) => isDebt(row.status));
    if (spanDrift.length > 0 && debtRows.length === 0) continue;
    const debtStatuses = [...new Set(debtRows.map((row) => row.status))].sort();
    const unsurfacedDebt = debtStatuses.filter((status) => !surfaced.has(driftKey(name, status)));
    const isNewName = !surfaced.has(name);
    if (!isNewName && unsurfacedDebt.length === 0) continue;
    const why = await executors.why(name, input.cwd);
    sections.push(renderSpanSection(name, anchorsByName.get(name) ?? [], debtRows, why));
    if (debtStatuses.length > 0) driftedNames.push(name);
    if (isNewName) toRecord.push(name);
    for (const status of unsurfacedDebt) toRecord.push(driftKey(name, status));
  }
  if (sections.length === 0) return null;
  memo.addSurfaced(input.sessionId, toRecord);
  const fileName = basename2(input.filePath);
  const header = driftedNames.length > 0 ? driftHeader(driftedNames.length, input.kind) : cleanHeader(fileName);
  const footer = driftedNames.length > 0 ? driftFooter(driftedNames) : cleanFooter(fileName);
  return buildBlock(sections, header, footer);
}
async function runTouchHook(input, executors, memo) {
  let treeModified = false;
  try {
    let range = "whole-file";
    if (input.kind === "write") {
      const fix = await executors.fix(input.filePath, input.cwd);
      treeModified = fix.modified;
      range = recoverRangeFromDisk(input.written, input.filePath);
    } else {
      range = recoverReadRange(input.offset, input.limit, input.filePath);
    }
    const additionalContext = await computeSurface(input, executors, memo, range);
    return { additionalContext, treeModified };
  } catch {
    return { additionalContext: null, treeModified };
  }
}
var DEFAULT_TIMEOUT_MS = 1e4;
function repoRelArg(filePath, cwd) {
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) return null;
  return { repoRoot, relPath: relativeToRepo(repoRoot, filePath) };
}
function spanStatusSnapshot(repoRoot) {
  const spanRoot = resolveSpanRoot(repoRoot);
  try {
    return execFileSync4("git", ["-C", repoRoot, "status", "--porcelain", "--", spanRoot], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DEFAULT_TIMEOUT_MS
    });
  } catch {
    return "";
  }
}
function createDefaultTouchExecutors(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    fix: async (filePath, cwd) => {
      const resolved = repoRelArg(filePath, cwd);
      if (!resolved) return { modified: false };
      const before = spanStatusSnapshot(resolved.repoRoot);
      try {
        execFileSync4("git", ["span", "drift", resolved.relPath, "--fix"], {
          cwd: resolved.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch {
      }
      const after = spanStatusSnapshot(resolved.repoRoot);
      return { modified: before !== after };
    },
    list: async (filePath, cwd) => {
      const resolved = repoRelArg(filePath, cwd);
      if (!resolved) return [];
      try {
        const out = execFileSync4("git", ["span", "list", "--porcelain", resolved.relPath], {
          cwd: resolved.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
        return parsePorcelain(out);
      } catch {
        return [];
      }
    },
    drift: async (args, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      const runCwd = repoRoot ?? cwd;
      const scoped = repoRoot ? args.map((a) => relativeToRepo(repoRoot, a)) : args;
      let out;
      try {
        out = execFileSync4("git", ["span", "drift", "--format", "porcelain", ...scoped], {
          cwd: runCwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch (err) {
        const captured = err.stdout;
        if (typeof captured === "string") {
          out = captured;
        } else {
          return [];
        }
      }
      return parseDriftPorcelain(out);
    },
    why: async (name, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      try {
        const out = execFileSync4("git", ["span", "why", name], {
          cwd: repoRoot ?? cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
        const text = out.trimEnd();
        if (text.length === 0 || text === `\`${name}\` has no why recorded.`) return null;
        return text;
      } catch {
        return null;
      }
    }
  };
}

// src/codex/apply-patch.ts
import * as fs5 from "node:fs";
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
    return fs5.readFileSync(path, "utf8");
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
function lineIndices(lines, value) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === value) out.push(i);
  }
  return out;
}
function contiguousMatches(haystack, needle) {
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
function locateChunk(preLines, chunk) {
  const block = chunk.oldLines;
  if (block.length === 0) {
    const ctx2 = chunk.changeContext;
    if (ctx2 !== null && ctx2 !== "") {
      const ctxIdxs = lineIndices(preLines, ctx2);
      if (ctxIdxs.length === 1) {
        const line = ctxIdxs[0] + 1;
        return { start: line, end: line };
      }
    }
    return null;
  }
  const starts = contiguousMatches(preLines, block);
  if (starts.length === 1) {
    const s = starts[0];
    return { start: s + 1, end: s + block.length };
  }
  if (starts.length === 0) return null;
  const ctx = chunk.changeContext;
  if (ctx !== null && ctx !== "") {
    for (const c of lineIndices(preLines, ctx)) {
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
      anchors.push({ path: toPosix2(hunk.path), kind: "whole-write" });
      continue;
    }
    const targetPath = toPosix2(hunk.movePath ?? hunk.path);
    if (hunk.movePath !== null) {
      anchors.push({ path: targetPath, kind: "whole-write" });
      continue;
    }
    const content = readPreEditFile(hunk.path);
    const range = content === null ? null : recoverRange2(splitLines(content), hunk.chunks);
    if (range !== null) {
      anchors.push({ path: targetPath, kind: "write", range });
    } else {
      anchors.push({ path: targetPath, kind: "whole-write" });
    }
  }
  return anchors;
}

// src/codex/post-tool-use.ts
var APPLY_PATCH_SUCCESS_PREFIX = "Success. Updated the following files:";
var RESPONSE_TEXT_FIELDS = ["output", "stdout", "content", "text"];
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
          return parsed.cmd;
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
  let i = 0;
  const n = literal.length;
  while (i < n) {
    const c = literal[i];
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i += 1;
      while (i < n) {
        if (literal[i] === "\\" && i + 1 < n) i += 2;
        else if (literal[i] === quote) {
          i += 1;
          break;
        } else i += 1;
      }
      out += literal.slice(start, i);
      continue;
    }
    const key = literal.slice(i).match(/^(\{|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/);
    if (key) {
      out += `${key[1]}"${key[2]}":`;
      i += key[0].length;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
function narrowCodeModeExec(toolInput) {
  if (toolInput !== null && typeof toolInput === "object" && "input" in toolInput) {
    const input = toolInput.input;
    if (typeof input === "string") {
      const match = input.match(/tools\.exec_command\(\s*(\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})\s*\)/);
      if (match) {
        try {
          const parsed = JSON.parse(quoteObjectKeys(match[1]));
          if (parsed !== null && typeof parsed === "object" && typeof parsed.cmd === "string") {
            return { matched: true, cmd: parsed.cmd };
          }
          return { matched: true, cmd: null };
        } catch {
          return { matched: true, cmd: null };
        }
      }
    }
  }
  return { matched: false, cmd: null };
}
function extractResponseText(toolResponse) {
  if (typeof toolResponse === "string") return toolResponse;
  if (toolResponse !== null && typeof toolResponse === "object") {
    const record = toolResponse;
    for (const field of RESPONSE_TEXT_FIELDS) {
      const value = record[field];
      if (typeof value === "string") return value;
    }
  }
  return null;
}
function classifyApplyPatchResponse(toolResponse) {
  const text = extractResponseText(toolResponse);
  if (text === null) return "unknown";
  return text.startsWith(APPLY_PATCH_SUCCESS_PREFIX) ? "success" : "failure";
}
var noRangeRecovery = () => null;
function createHandler(executors = createDefaultTouchExecutors(), memoFactory = createDiskMemoStore) {
  return async (input, ctx) => {
    const tool_name = input.tool_name;
    const cwd = input.cwd ?? "";
    const sessionId = input.session_id;
    const memo = memoFactory(ctx.logger);
    if (tool_name === "Bash" || tool_name === "exec_command" || tool_name === "exec") {
      let command2 = null;
      if (tool_name === "Bash") {
        const raw = input.tool_input?.command;
        command2 = typeof raw === "string" ? raw : null;
      } else {
        command2 = narrowExecCommand(input.tool_input);
      }
      if (command2 === null && tool_name === "exec") {
        const codeMode = narrowCodeModeExec(input.tool_input);
        if (codeMode.matched && codeMode.cmd === null) {
          ctx.logger.warn(
            "Codex code-mode exec envelope matched but its exec_command argument could not be parsed; no shell touch",
            {
              toolInputType: typeof input.tool_input,
              toolInputKeys: input.tool_input !== null && typeof input.tool_input === "object" ? Object.keys(input.tool_input) : void 0
            }
          );
        }
        command2 = codeMode.cmd;
      }
      if (!command2) return void 0;
      const matches = parseCommandDetailed(command2, cwd);
      const blocks2 = [];
      for (const match of matches) {
        if (match.status !== "resolved") continue;
        const span = match.span;
        const absPath = abspathAgainst(cwd, span.absolutePath);
        const scope = resolveTouchScope(cwd, absPath);
        if (!scope) continue;
        let touchInput;
        if (match.idiom === "heredoc-write") {
          const written = span.redirect === ">" ? "" : span.body ?? "";
          touchInput = { kind: "write", sessionId, cwd, filePath: absPath, written };
        } else {
          touchInput = {
            kind: "read",
            sessionId,
            cwd,
            filePath: absPath,
            offset: span.lineStart,
            limit: span.lineEnd - span.lineStart + 1
          };
        }
        const output = await runTouchHook(touchInput, executors, memo);
        if (output.additionalContext) blocks2.push(output.additionalContext);
      }
      if (blocks2.length === 0) return void 0;
      const combined2 = blocks2.join("");
      return postToolUseOutput({ additionalContext: combined2, systemMessage: combined2 });
    }
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return void 0;
    const classification = classifyApplyPatchResponse(input.tool_response);
    if (classification === "failure") return void 0;
    if (classification === "unknown") {
      ctx.logger.warn("Codex apply_patch tool_response shape unrecognized; running touch defensively", {
        toolResponseType: typeof input.tool_response,
        toolResponseKeys: input.tool_response !== null && typeof input.tool_response === "object" ? Object.keys(input.tool_response) : void 0
      });
    }
    const anchors = parseApplyPatch(command, noRangeRecovery);
    const blocks = [];
    for (const anchor of anchors) {
      const absPath = abspathAgainst(cwd, anchor.path);
      const scope = resolveTouchScope(cwd, absPath);
      if (!scope) continue;
      const output = await runTouchHook(
        { kind: "write", sessionId, cwd, filePath: absPath, written: "" },
        executors,
        memo
      );
      if (output.additionalContext) blocks.push(output.additionalContext);
    }
    if (blocks.length === 0) return void 0;
    const combined = blocks.join("");
    return postToolUseOutput({ additionalContext: combined, systemMessage: combined });
  };
}
var post_tool_use_default = postToolUseHook({ matcher: "apply_patch|exec_command|exec|Bash", timeout: 1e4 }, createHandler());

// src/codex/post-tool-use-entry.ts
execute(post_tool_use_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb2RleC9hcHBseS1wYXRjaC50cyIsICJzcmMvY29kZXgvcG9zdC10b29sLXVzZS50cyIsICJzcmMvY29kZXgvcG9zdC10b29sLXVzZS1lbnRyeS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZXhwb3J0IGNvbnN0IFBBQ0tBR0VfTkFNRSA9IFwiQGdvb2Rmb290L2NvZGV4LWhvb2tzXCI7XG5leHBvcnQgY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gNjAwXzAwMDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1NUQVRVU19NRVNTQUdFID0gdW5kZWZpbmVkO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfRVNCVUlMRF9MT0FERVJTID0ge1xuICAgIFwiLm1kXCI6IFwidGV4dFwiLFxufTtcbmV4cG9ydCBjb25zdCBIT09LX0ZBQ1RPUllfVE9fRVZFTlQgPSB7XG4gICAgcHJlVG9vbFVzZUhvb2s6IFwiUHJlVG9vbFVzZVwiLFxuICAgIHBvc3RUb29sVXNlSG9vazogXCJQb3N0VG9vbFVzZVwiLFxuICAgIHBlcm1pc3Npb25SZXF1ZXN0SG9vazogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIHVzZXJQcm9tcHRTdWJtaXRIb29rOiBcIlVzZXJQcm9tcHRTdWJtaXRcIixcbiAgICBzZXNzaW9uU3RhcnRIb29rOiBcIlNlc3Npb25TdGFydFwiLFxuICAgIHN1YmFnZW50U3RhcnRIb29rOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICBzdG9wSG9vazogXCJTdG9wXCIsXG4gICAgc3ViYWdlbnRTdG9wSG9vazogXCJTdWJhZ2VudFN0b3BcIixcbiAgICBwcmVDb21wYWN0SG9vazogXCJQcmVDb21wYWN0XCIsXG4gICAgcG9zdENvbXBhY3RIb29rOiBcIlBvc3RDb21wYWN0XCIsXG59O1xuZXhwb3J0IGNvbnN0IEVWRU5UU19XSVRIX01BVENIRVIgPSBuZXcgU2V0KFtcbiAgICBcIlByZVRvb2xVc2VcIixcbiAgICBcIlBvc3RUb29sVXNlXCIsXG4gICAgXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0b3BcIixcbiAgICBcIlByZUNvbXBhY3RcIixcbiAgICBcIlBvc3RDb21wYWN0XCIsXG5dKTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9URVhUX09VVFBVVCA9IG5ldyBTZXQoW1wiU2Vzc2lvblN0YXJ0XCIsIFwiVXNlclByb21wdFN1Ym1pdFwiLCBcIlN1YmFnZW50U3RhcnRcIl0pO1xuIiwgImZ1bmN0aW9uIGF0dGFjaE1ldGFkYXRhKGhvb2tFdmVudE5hbWUsIGNvbmZpZywgaGFuZGxlcikge1xuICAgIGNvbnN0IGhvb2sgPSBoYW5kbGVyO1xuICAgIGhvb2suaG9va0V2ZW50TmFtZSA9IGhvb2tFdmVudE5hbWU7XG4gICAgaG9vay50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXQ7XG4gICAgaG9vay5zdGF0dXNNZXNzYWdlID0gY29uZmlnLnN0YXR1c01lc3NhZ2U7XG4gICAgaWYgKFwibWF0Y2hlclwiIGluIGNvbmZpZyAmJiB0eXBlb2YgY29uZmlnLm1hdGNoZXIgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaG9vay5tYXRjaGVyID0gY29uZmlnLm1hdGNoZXI7XG4gICAgfVxuICAgIHJldHVybiBob29rO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZVRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdFRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUGVybWlzc2lvblJlcXVlc3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJVc2VyUHJvbXB0U3VibWl0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTZXNzaW9uU3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdWJhZ2VudFN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdG9wXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUHJlQ29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQb3N0Q29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuIiwgImltcG9ydCB7IGNsb3NlU3luYywgZXhpc3RzU3luYywgbWtkaXJTeW5jLCBvcGVuU3luYywgd3JpdGVTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5jb25zdCBERUZBVUxUX0xPR19FTlZfVkFSID0gXCJDT0RFWF9IT09LU19MT0dfRklMRVwiO1xuZXhwb3J0IGNsYXNzIExvZ2dlciB7XG4gICAgaGFuZGxlcnMgPSBuZXcgTWFwKCk7XG4gICAgZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgbG9nRmlsZUZkID0gbnVsbDtcbiAgICBsb2dGaWxlUGF0aCA9IG51bGw7XG4gICAgY3VycmVudEhvb2tUeXBlO1xuICAgIGN1cnJlbnRJbnB1dDtcbiAgICBjb25zdHJ1Y3Rvcihjb25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ0ZpbGVQYXRoID0gY29uZmlnLmxvZ0ZpbGVQYXRoID8/IHByb2Nlc3MuZW52W2NvbmZpZy5sb2dFbnZWYXIgPz8gREVGQVVMVF9MT0dfRU5WX1ZBUl0gPz8gbnVsbDtcbiAgICB9XG4gICAgc2V0Q29udGV4dChob29rVHlwZSwgaW5wdXQpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSBob29rVHlwZTtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSBpbnB1dDtcbiAgICB9XG4gICAgY2xlYXJDb250ZXh0KCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIG9uKGxldmVsLCBoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5oYW5kbGVycy5nZXQobGV2ZWwpID8/IG5ldyBTZXQoKTtcbiAgICAgICAgZXhpc3RpbmcuYWRkKGhhbmRsZXIpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLnNldChsZXZlbCwgZXhpc3RpbmcpO1xuICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgZXhpc3RpbmcuZGVsZXRlKGhhbmRsZXIpO1xuICAgICAgICAgICAgaWYgKGV4aXN0aW5nLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmhhbmRsZXJzLmRlbGV0ZShsZXZlbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxuICAgIGRlYnVnKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZGVidWdcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGluZm8obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJpbmZvXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICB3YXJuKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwid2FyblwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgZXJyb3IobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgbG9nRXJyb3IoZXJyb3IsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgYCR7bWVzc2FnZX06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIGNvbnRleHQpO1xuICAgIH1cbiAgICBjbG9zZSgpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbG9zZVN5bmModGhpcy5sb2dGaWxlRmQpO1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVtaXQobGV2ZWwsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSB7XG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIGxldmVsLFxuICAgICAgICAgICAgaG9va1R5cGU6IHRoaXMuY3VycmVudEhvb2tUeXBlLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIC4uLih0aGlzLmN1cnJlbnRJbnB1dCAhPT0gdW5kZWZpbmVkID8geyBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQgfSA6IHt9KSxcbiAgICAgICAgICAgIC4uLihjb250ZXh0ICE9PSB1bmRlZmluZWQgPyB7IGNvbnRleHQgfSA6IHt9KSxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy53cml0ZVRvRmlsZShldmVudCk7XG4gICAgICAgIHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKT8uZm9yRWFjaCgoaGFuZGxlcikgPT4ge1xuICAgICAgICAgICAgaGFuZGxlcihldmVudCk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICB3cml0ZVRvRmlsZShldmVudCkge1xuICAgICAgICBpZiAodGhpcy5sb2dGaWxlUGF0aCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5maWxlSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IGxvZ0RpciA9IGRpcm5hbWUodGhpcy5sb2dGaWxlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMobG9nRGlyKSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyhsb2dEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBvcGVuU3luYyh0aGlzLmxvZ0ZpbGVQYXRoLCBcImFcIik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB3cml0ZVN5bmModGhpcy5sb2dGaWxlRmQsIGAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5gKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmV4cG9ydCBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKCk7XG4iLCAiZXhwb3J0IGNvbnN0IEVYSVRfQ09ERVMgPSB7XG4gICAgU1VDQ0VTUzogMCxcbiAgICBFUlJPUjogMSxcbiAgICBCTE9DSzogMixcbn07XG5leHBvcnQgY2xhc3MgQmxvY2tFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICByZWFzb247XG4gICAgY29uc3RydWN0b3IocmVhc29uKSB7XG4gICAgICAgIHN1cGVyKHJlYXNvbik7XG4gICAgICAgIHRoaXMubmFtZSA9IFwiQmxvY2tFcnJvclwiO1xuICAgICAgICB0aGlzLnJlYXNvbiA9IHJlYXNvbjtcbiAgICB9XG59XG5mdW5jdGlvbiBvbWl0VW5kZWZpbmVkKHZhbHVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh2YWx1ZSkuZmlsdGVyKChbLCBlbnRyeV0pID0+IGVudHJ5ICE9PSB1bmRlZmluZWQpKTtcbn1cbmZ1bmN0aW9uIGJ1aWxkT3V0cHV0KHR5cGUsIHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgX3R5cGU6IHR5cGUsXG4gICAgICAgIHN0ZG91dDogb21pdFVuZGVmaW5lZChzdGRvdXQpLFxuICAgICAgICAuLi4oc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZGVyciB9IDoge30pLFxuICAgIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmF3T3V0cHV0KHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUmF3XCIsIHN0ZG91dCwgc3RkZXJyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnVwZGF0ZWRJbnB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlByZVRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbixcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24sXG4gICAgICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlTGVnYWN5QmxvY2tPdXRwdXQob3B0aW9ucykge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQb3N0VG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICB1cGRhdGVkTUNQVG9vbE91dHB1dDogb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdFRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KG9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWNpc2lvbiA9IG9taXRVbmRlZmluZWQoe1xuICAgICAgICBiZWhhdmlvcjogb3B0aW9ucy5iZWhhdmlvcixcbiAgICAgICAgbWVzc2FnZTogb3B0aW9ucy5tZXNzYWdlLFxuICAgICAgICBpbnRlcnJ1cHQ6IG9wdGlvbnMuaW50ZXJydXB0LFxuICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB1cGRhdGVkUGVybWlzc2lvbnM6IG9wdGlvbnMudXBkYXRlZFBlcm1pc3Npb25zLFxuICAgIH0pO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IHtcbiAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgICAgICBkZWNpc2lvbixcbiAgICB9O1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJVc2VyUHJvbXB0U3VibWl0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTZXNzaW9uU3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlNlc3Npb25TdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0Q29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG4iLCAiaW1wb3J0IHsgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgfSBmcm9tIFwiLi9jb25zdGFudHMuanNcIjtcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gXCIuL2xvZ2dlci5qc1wiO1xuaW1wb3J0IHsgQmxvY2tFcnJvciwgRVhJVF9DT0RFUywgc2Vzc2lvblN0YXJ0T3V0cHV0LCBzdWJhZ2VudFN0YXJ0T3V0cHV0LCB1c2VyUHJvbXB0U3VibWl0T3V0cHV0LCB9IGZyb20gXCIuL291dHB1dHMuanNcIjtcbmFzeW5jIGZ1bmN0aW9uIHJlYWRTdGRpbigpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCBjaHVua3MgPSBbXTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5zZXRFbmNvZGluZyhcInV0Zi04XCIpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IGNodW5rcy5wdXNoKGNodW5rKSk7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJlbmRcIiwgKCkgPT4gcmVzb2x2ZShjaHVua3Muam9pbihcIlwiKSkpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZXJyb3JcIiwgcmVqZWN0KTtcbiAgICB9KTtcbn1cbmZ1bmN0aW9uIHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpIHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShzdGRpbkNvbnRlbnQpO1xufVxuZnVuY3Rpb24gd3JpdGVTdGRvdXQob3V0cHV0KSB7XG4gICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoSlNPTi5zdHJpbmdpZnkob3V0cHV0LnN0ZG91dCkpO1xufVxuZnVuY3Rpb24gbm9ybWFsaXplU3RyaW5nT3V0cHV0KGhvb2tFdmVudE5hbWUsIHJlc3VsdCkge1xuICAgIGlmICghRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQuaGFzKGhvb2tFdmVudE5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtob29rRXZlbnROYW1lfSBob29rcyBjYW5ub3QgcmV0dXJuIHBsYWluIHRleHRgKTtcbiAgICB9XG4gICAgaWYgKGhvb2tFdmVudE5hbWUgPT09IFwiU2Vzc2lvblN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlN1YmFnZW50U3RhcnRcIikge1xuICAgICAgICByZXR1cm4gc3ViYWdlbnRTdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIHJldHVybiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0VG9Ib29rT3V0cHV0KG91dHB1dCkge1xuICAgIHJldHVybiBvdXRwdXQuc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCwgc3RkZXJyOiBvdXRwdXQuc3RkZXJyIH0gOiB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCB9O1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGUoaG9va0ZuKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RkaW5Db250ZW50ID0gYXdhaXQgcmVhZFN0ZGluKCk7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcGFyc2VTdGRpbklucHV0KHN0ZGluQ29udGVudCk7XG4gICAgICAgIGxvZ2dlci5zZXRDb250ZXh0KGhvb2tGbi5ob29rRXZlbnROYW1lLCBpbnB1dCk7XG4gICAgICAgIGNvbnN0IGNvbnRleHQgPSB7IGxvZ2dlciB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBob29rRm4oaW5wdXQsIGNvbnRleHQpO1xuICAgICAgICBsZXQgb3V0cHV0ID0geyBzdGRvdXQ6IHt9IH07XG4gICAgICAgIGlmICh0eXBlb2YgcmVzdWx0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRm4uaG9va0V2ZW50TmFtZSwgcmVzdWx0KSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG91dHB1dCA9IGNvbnZlcnRUb0hvb2tPdXRwdXQocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgICB3cml0ZVN0ZG91dChvdXRwdXQpO1xuICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5TVUNDRVNTKTtcbiAgICB9XG4gICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJsb2NrRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnJlYXNvbn1cXG5gKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkJMT0NLKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3Iuc3RhY2sgPz8gZXJyb3IubWVzc2FnZX1cXG5gKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke1N0cmluZyhlcnJvcil9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuRVJST1IpO1xuICAgIH1cbiAgICBmaW5hbGx5IHtcbiAgICAgICAgbG9nZ2VyLmNsZWFyQ29udGV4dCgpO1xuICAgICAgICBsb2dnZXIuY2xvc2UoKTtcbiAgICB9XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgaGVscGVycyB1c2VkIGJ5IG11bHRpcGxlIGFnZW50LWhvb2tzIGVudHJ5IHBvaW50cy5cbiAqXG4gKiBFeHRyYWN0ZWQgZnJvbSBwcmUtdG9vbC11c2UudHMgc28gdGhhdCB0aGUgdXBjb21pbmcgU3RvcCBob29rIChhbmQgYW55XG4gKiBmdXR1cmUgaG9va3MpIGNhbiBpbXBvcnQgcGF0aCB1dGlsaXRpZXMsIHJhbmdlIGhlbHBlcnMsIGFuZCB0aGVcbiAqIHNhbml0aXplU2Vzc2lvbklkL2Zvcm1hdEFuY2hvciBmdW5jdGlvbnMgd2l0aG91dCBkZXBlbmRpbmcgb24gdGhlXG4gKiBQcmVUb29sVXNlLXNwZWNpZmljIG1vZHVsZS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGF0aCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG5mdW5jdGlvbiBpc0Fic29sdXRlUG9zaXgocDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBwLnN0YXJ0c1dpdGgoJy8nKSB8fCAvXltBLVphLXpdOlxcLy8udGVzdChwKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFic3BhdGhBZ2FpbnN0KGJhc2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0ID0gdG9Qb3NpeCh0YXJnZXQpO1xuICBpZiAoaXNBYnNvbHV0ZVBvc2l4KHQpKSByZXR1cm4gdDtcbiAgY29uc3QgYiA9IHRvUG9zaXgoYmFzZSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiBgJHtifS8ke3R9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZXBvUm9vdChkaXI6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFkaXIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIGRpciwgJ3Jldi1wYXJzZScsICctLXNob3ctdG9wbGV2ZWwnXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IG91dC50cmltKCk7XG4gICAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRvUG9zaXgodHJpbW1lZCkgOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGlzIGV4Y2x1ZGVkIGJ5IGdpdCdzIGlnbm9yZSBydWxlc1xuICogKC5naXRpZ25vcmUsIC5naXQvaW5mby9leGNsdWRlLCBjb3JlLmV4Y2x1ZGVzRmlsZSkuIFVzZWQgdG8ga2VlcCBpZ25vcmVkXG4gKiBmaWxlcyBcdTIwMTQgYnVpbGQgb3V0cHV0LCBjYWNoZXMsIGxvZ3MgXHUyMDE0IG91dCBvZiB0b3VjaCB0cmFja2luZyBlbnRpcmVseSwgc29cbiAqIHRoZSB0b3VjaCBob29rIG5ldmVyIHJlcG9ydHMgcmVhZHMsIHdyaXRlcywgb3IgdW5jb3ZlcmVkIHdyaXRlcyBvbiB0aGVtLlxuICpcbiAqIGBnaXQgY2hlY2staWdub3JlIC1xIDxwYXRoPmAgZXhpdHMgMCB3aGVuIHRoZSBwYXRoIGlzIGlnbm9yZWQsIDEgd2hlbiBpdCBpc1xuICogbm90LCBhbmQgMTI4IG9uIGVycm9yLiBleGVjRmlsZVN5bmMgdGhyb3dzIG9uIGFueSBub24temVybyBleGl0LCBzbyBhIGNsZWFuXG4gKiByZXR1cm4gbWVhbnMgXCJpZ25vcmVkXCIuIEEgc3RhdHVzLTEgdGhyb3cgaXMgdGhlIGV4cGVjdGVkIFwibm90IGlnbm9yZWRcIlxuICogc2lnbmFsOyBhbnkgb3RoZXIgZmFpbHVyZSBpcyBhbiB1bnJlbGlhYmxlIGFuc3dlciwgc28gd2UgcmVwb3J0IGBmYWxzZWBcbiAqIChkbyBub3QgZHJvcCB0aGUgdG91Y2gpIHJhdGhlciB0aGFuIHNpbGVudGx5IGhpZGluZyBhIHRyYWNrZWQgZmlsZS5cbiAqL1xuLyoqXG4gKiBUaGUgZGVmYXVsdCBzcGFuIHJvb3QgZGlyZWN0b3J5LCByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290LCB1c2VkIHdoZW4gbm9cbiAqIGVudmlyb25tZW50IHZhcmlhYmxlIG9yIGdpdCBjb25maWcgb3ZlcnJpZGVzIHRoZSBsb2NhdGlvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IFNQQU5fUk9PVCA9ICcuc3Bhbic7XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgc3BhbiByb290IGRpcmVjdG9yeSBmb3IgYSBnaXZlbiByZXBvLCBtaXJyb3JpbmcgdGhlIFJ1c3QgQ0xJXG4gKiBwcmVjZWRlbmNlIChtaW51cyB0aGUgLS1zcGFuLWRpciBDTEkgZmxhZywgd2hpY2ggaXMgaW52aXNpYmxlIHRvIGZpbGUtd3JpdGVcbiAqIGhvb2tzKTpcbiAqICAgMS4gR0lUX1NQQU5fRElSIGVudmlyb25tZW50IHZhcmlhYmxlXG4gKiAgIDIuIGBnaXQgY29uZmlnIGdpdC1zcGFuLmRpcmAgaW4gdGhlIHJlcG9cbiAqICAgMy4gRGVmYXVsdDogXCIuc3BhblwiXG4gKlxuICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgUE9TSVgtc3R5bGUgcGF0aCB3aXRoIG5vIHRyYWlsaW5nIHNsYXNoLlxuICogRmFpbC1zYWZlOiBhbnkgcmVzb2x1dGlvbiBlcnJvciBmYWxscyBiYWNrIHRvIFwiLnNwYW5cIiBzbyB0aGUgaG9vayBuZXZlclxuICogY3Jhc2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgZW52RGlyID0gcHJvY2Vzcy5lbnZbJ0dJVF9TUEFOX0RJUiddO1xuICBpZiAoZW52RGlyICYmIGVudkRpci50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB0b1Bvc2l4KGVudkRpci50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjb25maWcnLCAnZ2l0LXNwYW4uZGlyJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA+IDApIHJldHVybiB0cmltbWVkO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjsgLy8gY29uZmlnIGtleSBhYnNlbnQgb3IgZ2l0IGVycm9yIFx1MjAxNCBmYWxsIHRocm91Z2ggdG8gZGVmYXVsdFxuICB9XG4gIHJldHVybiBTUEFOX1JPT1Q7XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGggZmFsbHMgaW5zaWRlIHRoZSBnaXZlbiBzcGFuIHJvb3RcbiAqIGRpcmVjdG9yeS4gQSBwYXRoIGlzIGluc2lkZSB3aGVuIGl0IGVxdWFscyB0aGUgc3BhbiByb290IGV4YWN0bHkgb3IgaXNcbiAqIG5lc3RlZCBiZW5lYXRoIGl0IChpLmUuIHN0YXJ0cyB3aXRoIFwiPHNwYW5Sb290Pi9cIikuIFRoZSBcIi9cIiBib3VuZGFyeSBwcmV2ZW50c1xuICogZmFsc2UgcG9zaXRpdmVzIGZvciBzaWJsaW5ncyBsaWtlIFwiLnNwYW5zL3hcIiBvciBcIi5zcGFuLW5vdGVzL3hcIi5cbiAqXG4gKiBQYXNzIHRoZSByZXN1bHQgb2YgYHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdClgIGFzIGBzcGFuUm9vdGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNwYW5Sb290OiBzdHJpbmcgPSBTUEFOX1JPT1QpOiBib29sZWFuIHtcbiAgY29uc3Qgcm9vdCA9IHNwYW5Sb290LnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gcmVwb1JlbFBhdGggPT09IHJvb3QgfHwgcmVwb1JlbFBhdGguc3RhcnRzV2l0aChgJHtyb290fS9gKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzR2l0SWdub3JlZChyZXBvUm9vdDogc3RyaW5nLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjaGVjay1pZ25vcmUnLCAnLXEnLCAnLS0nLCByZXBvUmVsUGF0aF0sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdpZ25vcmUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByb290ID0gdG9Qb3NpeChyZXBvUm9vdCk7XG4gIGNvbnN0IGFicyA9IHRvUG9zaXgoYWJzUGF0aCk7XG4gIGNvbnN0IHByZWZpeCA9IHJvb3QuZW5kc1dpdGgoJy8nKSA/IHJvb3QgOiBgJHtyb290fS9gO1xuICByZXR1cm4gYWJzLnN0YXJ0c1dpdGgocHJlZml4KSA/IGFicy5zbGljZShwcmVmaXgubGVuZ3RoKSA6IGFicztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbm9uaWNhbGl6ZVBhdGgoYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKGFic1BhdGgpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmlsZSBkb2Vzbid0IGV4aXN0IHlldCAoZS5nLiBXcml0ZSB0byBhIG5ldyBmaWxlKTogY2Fub25pY2FsaXplIHRoZVxuICAgIC8vIGRpcmVjdG9yeSBhbmQgcmVqb2luIHRoZSBiYXNlbmFtZSBzbyBzeW1saW5rcyBpbiB0aGUgcGFyZW50IGFyZSByZXNvbHZlZC5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlyID0gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpKTtcbiAgICAgIHJldHVybiBgJHtkaXJ9LyR7bm9kZVBhdGguYmFzZW5hbWUoYWJzUGF0aCl9YDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBhcmVudCBkb2Vzbid0IGV4aXN0IGVpdGhlcjsgZmFsbCBiYWNrIHRvIHRoZSB1bi1jYW5vbmljYWxpemVkIHBhdGguXG4gICAgICByZXR1cm4gYWJzUGF0aDtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZVBhdGgodG9vbElucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgY3dkOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgZnAgPSB0b29sSW5wdXQuZmlsZV9wYXRoO1xuICBpZiAodHlwZW9mIGZwICE9PSAnc3RyaW5nJyB8fCBmcC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBhYnMgPSBhYnNwYXRoQWdhaW5zdChjd2QsIGZwKTtcbiAgcmV0dXJuIGNhbm9uaWNhbGl6ZVBhdGgoYWJzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lIHJhbmdlIHR5cGVzIGFuZCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBMaW5lUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmdlc0ludGVyc2VjdChhOiBMaW5lUmFuZ2UsIGI6IExpbmVSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5zdGFydCA8PSBiLmVuZCAmJiBhLmVuZCA+PSBiLnN0YXJ0O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvcmNlbGFpbiByb3cgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9yY2VsYWluUm93IHtcbiAgbmFtZTogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMykgY29udGludWU7XG4gICAgY29uc3QgW25hbWUsIHBhdGgsIHJhbmdlXSA9IHBhcnRzO1xuICAgIGNvbnN0IGRhc2hJZHggPSByYW5nZS5pbmRleE9mKCctJyk7XG4gICAgaWYgKGRhc2hJZHggPT09IC0xKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKDAsIGRhc2hJZHgpLCAxMCk7XG4gICAgY29uc3QgZW5kID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoZGFzaElkeCArIDEpLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwgYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgc3RhdHVzIHRva2VuIHZvY2FidWxhcnkgKHRoZVxuICogZ2l0LXNwYW4gQ0xJJ3MgcG9yY2VsYWluIGNvbnRyYWN0KTogYEZSRVNIYC9gTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGBcbiAqIGFyZSBwb3NpdGlvbmFsLW9yLWNsZWFuIGFuZCBuZXZlciBkZWJ0OyBldmVyeSBvdGhlciB0b2tlbiBpcyBzZW1hbnRpYyBkcmlmdFxuICogb3IgYSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb24gYW5kIGlzIGRlYnQuIFNlZSB7QGxpbmsgaXNEZWJ0fSBmb3IgdGhlXG4gKiBzaW5nbGUgc291cmNlIG9mIHRydXRoIG9uIHRoYXQgc3BsaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBQT1JDRUxBSU5fU1RBVFVTRVMgPSBbXG4gICdGUkVTSCcsXG4gICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCcsXG4gICdNT1ZFRCcsXG4gICdDSEFOR0VEJyxcbiAgJ0RFTEVURUQnLFxuICAnQ09ORkxJQ1QnLFxuICAnU1VCTU9EVUxFJyxcbiAgJ0xGU19OT1RfRkVUQ0hFRCcsXG4gICdMRlNfTk9UX0lOU1RBTExFRCcsXG4gICdQUk9NSVNPUl9NSVNTSU5HJyxcbiAgJ1NQQVJTRV9FWENMVURFRCcsXG4gICdGSUxURVJfRkFJTEVEJyxcbiAgJ0lPX0VSUk9SJ1xuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgUG9yY2VsYWluU3RhdHVzID0gKHR5cGVvZiBQT1JDRUxBSU5fU1RBVFVTRVMpW251bWJlcl07XG5cbmNvbnN0IFBPUkNFTEFJTl9TVEFUVVNfU0VUOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChQT1JDRUxBSU5fU1RBVFVTRVMpO1xuXG5mdW5jdGlvbiBwYXJzZVBvcmNlbGFpblN0YXR1cyhyYXc6IHN0cmluZyk6IFBvcmNlbGFpblN0YXR1cyB8IG51bGwge1xuICByZXR1cm4gUE9SQ0VMQUlOX1NUQVRVU19TRVQuaGFzKHJhdykgPyAocmF3IGFzIFBvcmNlbGFpblN0YXR1cykgOiBudWxsO1xufVxuXG4vKiogQSBgcGFyc2VEcmlmdFBvcmNlbGFpbmAgcm93OiBhIHtAbGluayBQb3JjZWxhaW5Sb3d9IHBsdXMgaXRzIHN0YXR1cyB0b2tlbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRHJpZnRQb3JjZWxhaW5Sb3cgZXh0ZW5kcyBQb3JjZWxhaW5Sb3cge1xuICBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cztcbn1cblxuLyoqXG4gKiBUaGUgZGVidCBpbnZhcmlhbnQgKHN5c3RlbS13aWRlOyBjb25zdW1lZCBieSBib3RoIHRoZSBmdXR1cmUgdG91Y2gtY29yZSBhbmRcbiAqIGFkdmlzb3ItY29yZSk6IG9ubHkgc2VtYW50aWMgc3RhdHVzZXMgYXJlIGRlYnQuIGBDSEFOR0VEYCBhbmQgYERFTEVURURgIGFyZVxuICogc2VtYW50aWMgZHJpZnQ7IHRoZSByZW1haW5pbmcgbm9uLUZSRVNIL01PVkVEL1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUIHRva2Vuc1xuICogYXJlIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbnMgYW5kIGFyZSB0cmVhdGVkIGFzIGRlYnQgdG9vICh0aGV5IGJsb2NrIG9uXG4gKiB0aGVpciBvd24gbWVyaXRzIFx1MjAxNCB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXQgYWxsKS4gYEZSRVNIYCxcbiAqIGBNT1ZFRGAsIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0OiBwb3NpdGlvbmFsIGRyaWZ0IHRoZVxuICogQ0xJIGNhbiBoZWFsIChvciBhbHJlYWR5IGhhcykgaXMgaW52aXNpYmxlLCBhbmQgYSBwZW5kaW5nLWNvbW1pdCByZXNvbHV0aW9uXG4gKiBpcyBub3Qgb3V0c3RhbmRpbmcgZGVidC5cbiAqXG4gKiBOb3RlOiB0aGUgcG9yY2VsYWluIHZvY2FidWxhcnkgZG9lcyBub3QgY3VycmVudGx5IGRpc3Rpbmd1aXNoXG4gKiBjb250ZW50LWVxdWl2YWxlbnQgYENIQU5HRURgIChlLmcuIHdoaXRlc3BhY2Utb25seSBkcmlmdCBgLS1maXhgIGNhbiBoZWFsKVxuICogZnJvbSBnZW51aW5lbHkgc2VtYW50aWMgYENIQU5HRURgIFx1MjAxNCB0aGF0IGNsYXNzaWZpY2F0aW9uIGlzIG5vdCBwcmVzZW50IGluXG4gKiBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBvdXRwdXQgdG9kYXkuIFVudGlsIHRoZSBDTEkgZXhwb3NlcyBpdCxcbiAqIGV2ZXJ5IGBDSEFOR0VEYCByb3cgaXMgdHJlYXRlZCBhcyBkZWJ0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNEZWJ0KHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnRlJFU0gnOlxuICAgIGNhc2UgJ01PVkVEJzpcbiAgICBjYXNlICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCc6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogTG93ZXJjYXNlIGh1bWFuIGxhYmVsIGZvciBhIHBvcmNlbGFpbiBzdGF0dXMgdG9rZW4gKGBMRlNfTk9UX0ZFVENIRURgIFx1MjE5MlxuICogYGxmcyBub3QgZmV0Y2hlZGApLiBUaGUgc2luZ2xlIGxhYmVsIG1hcHBpbmcgZm9yIGV2ZXJ5IGh1bWFuLWZvcm1hdCBhbmNob3JcbiAqIHN1ZmZpeCBcdTIwMTQgYm90aCB0aGUgdG91Y2ggaG9vaydzIGJsb2NrIGFuZCB0aGUgYWR2aXNvcidzIG1lc3NhZ2VzIHJlbmRlciB0aHJvdWdoXG4gKiB0aGlzLCBzbyBhIHN0YXR1cyBuZXZlciByZWFkcyBkaWZmZXJlbnRseSBiZXR3ZWVuIHRoZSB0d28uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBodW1hblN0YXR1c0xhYmVsKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN0YXR1cy50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJyAnKTtcbn1cblxuLyoqXG4gKiBUaGUgdGVybWluYWwvZW52aXJvbm1lbnRhbCBzdGF0dXNlczogdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0XG4gKiBhbGwsIHNvIHRoZSByb3cgaXMgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uIFRoZXNlIGFyZVxuICogYENPTkZMSUNUYCAodW5yZXNvbHZlZCBtZXJnZSksIGBTVUJNT0RVTEVgIChhbmNob3IgaW5zaWRlIGEgc3VibW9kdWxlKSxcbiAqIGBMRlNfTk9UX0ZFVENIRURgL2BMRlNfTk9UX0lOU1RBTExFRGAgKEdpdCBMRlMgY29udGVudCB1bmF2YWlsYWJsZSksXG4gKiBgUFJPTUlTT1JfTUlTU0lOR2AgKHBhcnRpYWwtY2xvbmUgb2JqZWN0IG5vdCBmZXRjaGVkKSwgYFNQQVJTRV9FWENMVURFRGBcbiAqIChwYXRoIG91dHNpZGUgdGhlIHNwYXJzZS1jaGVja291dCBjb25lKSwgYEZJTFRFUl9GQUlMRURgIChhIGNsZWFuL3NtdWRnZVxuICogZmlsdGVyIGVycm9yZWQpLCBhbmQgYElPX0VSUk9SYCAodHJhbnNpZW50IHJlYWQgZmFpbHVyZSkuXG4gKlxuICogVGhlc2UgYXJlIGEgc3RyaWN0IHN1YnNldCBvZiB7QGxpbmsgaXNEZWJ0fTogZXZlcnkgZW52aXJvbm1lbnRhbCBzdGF0dXMgaXNcbiAqIGFsc28gZGVidCAoaXQgYmxvY2tzIG9uIGl0cyBvd24gbWVyaXRzIHdoZW4gc3VyZmFjZWQgaW4gYSBzdGF0dXMgcmVwb3J0KSwgYnV0XG4gKiB0aGUgYWR2aXNvciBtdXN0IHRyZWF0IHRoZW0gZGlmZmVyZW50bHkgZnJvbSAqc2VtYW50aWMqIGRyaWZ0IChgQ0hBTkdFRGAsXG4gKiBgREVMRVRFRGApLiBTZW1hbnRpYyBkcmlmdCBpcyBmaXhhYmxlIGJ5IGVkaXRpbmcgYSBzcGFuLCBzbyB0aGUgYWR2aXNvciBmYWlsc1xuICogY2xvc2VkIG9uIGl0OyBhbiBlbnZpcm9ubWVudGFsIGNvbmRpdGlvbiBpcyBub3Qgc29tZXRoaW5nIGEgc3BhbiBlZGl0IGNhblxuICogcmVzb2x2ZSwgc28gdGhlIGFkdmlzb3IgZmFpbHMgT1BFTiBvbiBpdCAoYWxsb3csIGJ1dCBzdXJmYWNlIHRoZSBjb25kaXRpb24pIFx1MjAxNFxuICogcmUtZGVueWluZyBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gaGVyZSB3b3VsZFxuICogY29udHJhZGljdCB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZSByZXN0IG9mIHRoZSBhZHZpc29yIGFscmVhZHkgaG9ub3JzIGZvclxuICogQ0xJLWFic2VudC90aW1lb3V0L3BhcnNlLWZhaWx1cmUgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRW52aXJvbm1lbnRhbFN0YXR1cyhzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0NPTkZMSUNUJzpcbiAgICBjYXNlICdTVUJNT0RVTEUnOlxuICAgIGNhc2UgJ0xGU19OT1RfRkVUQ0hFRCc6XG4gICAgY2FzZSAnTEZTX05PVF9JTlNUQUxMRUQnOlxuICAgIGNhc2UgJ1BST01JU09SX01JU1NJTkcnOlxuICAgIGNhc2UgJ1NQQVJTRV9FWENMVURFRCc6XG4gICAgY2FzZSAnRklMVEVSX0ZBSUxFRCc6XG4gICAgY2FzZSAnSU9fRVJST1InOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqIFJvd3Mgd2hvc2Ugc3RhdHVzIHRva2VuIGlzIG5vdCBpbiB7QGxpbmsgUE9SQ0VMQUlOX1NUQVRVU0VTfSBhcmUgc2tpcHBlZCBcdTIwMTRcbiAqIGFuIHVucmVjb2duaXplZCB0b2tlbiBmcm9tIGEgbmV3ZXIgQ0xJIGlzIHRyZWF0ZWQgdGhlIHNhbWUgYXMgYSBtYWxmb3JtZWRcbiAqIGxpbmUgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlRHJpZnRQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBEcmlmdFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtzdGF0dXNDb2wsICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGF0dXMgPSBwYXJzZVBvcmNlbGFpblN0YXR1cyhzdGF0dXNDb2wpO1xuICAgIGlmICghc3RhdHVzKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCwgc3RhdHVzIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIGJ5IGFsbCBwZXItc2Vzc2lvbiBzdGF0ZTogY3VycmVudGx5IGp1c3QgdGhlIHRvdWNoLWhvb2tcbi8vIHNlc3Npb24gbWVtbyAoc3Bhbi1zdXJmYWNlLnRzJ3MgTWVtb1N0b3JlKS4gRWFjaCBzZXNzaW9uIGdldHMgb25lXG4vLyBzdWJkaXJlY3Rvcnkga2V5ZWQgYnkgaXRzIHNhbml0aXplZCBpZCwgc28gZXZlcnkgd3JpdGVyL3JlYWRlciBmb3IgYSBnaXZlblxuLy8gc2Vzc2lvbiBhZ3JlZXMgb24gaXRzIGxvY2F0aW9uLlxuZXhwb3J0IGNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8qKiBUaGUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHNlc3Npb24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkRpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5jb25zdCBUSElSVFlfREFZU19NUyA9IDMwICogMjQgKiA2MCAqIDYwICogMTAwMDtcblxuLyoqXG4gKiBPcHBvcnR1bmlzdGljYWxseSBwcnVuZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcmllcyB1bmRlclxuICoge0BsaW5rIFNFU1NJT05fQkFTRV9ESVJ9IHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gYG1heEFnZU1zYCAoZGVmYXVsdCAzMFxuICogZGF5cykuIEEgZGlyZWN0b3J5J3MgbXRpbWUgYWR2YW5jZXMgd2hlbmV2ZXIgYW4gZW50cnkgaW5zaWRlIGl0IGlzXG4gKiBjcmVhdGVkL3JlbmFtZWQvcmVtb3ZlZCwgc28gYW4gYWN0aXZlIHNlc3Npb24gKG1lbW8gd3JpdGVzKSBzdGF5cyBmcmVzaDtcbiAqIG9ubHkgZ2VudWluZWx5IGFiYW5kb25lZCBzZXNzaW9ucyBhZ2Ugb3V0LlxuICpcbiAqIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGNhbGxlZCBvcHBvcnR1bmlzdGljYWxseSBmcm9tIGhvb2sgcmVhZC93cml0ZVxuICogcGF0aHMsIG5vdCBhIHNlcGFyYXRlIGNyb24tbGlrZSBtZWNoYW5pc20sIHNvIGEgZmFpbHVyZSBoZXJlIG11c3QgbmV2ZXJcbiAqIGJsb2NrIHRoZSBjYWxsZXIncyBhY3R1YWwgd29yay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBydW5lU3RhbGVTZXNzaW9ucyhub3c6IG51bWJlciA9IERhdGUubm93KCksIG1heEFnZU1zOiBudW1iZXIgPSBUSElSVFlfREFZU19NUyk6IHZvaWQge1xuICBsZXQgZW50cmllczogZnMuRGlyZW50W107XG4gIHRyeSB7XG4gICAgZW50cmllcyA9IGZzLnJlYWRkaXJTeW5jKFNFU1NJT05fQkFTRV9ESVIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuOyAvLyBiYXNlIGRpciBhYnNlbnQgb3IgdW5yZWFkYWJsZSBcdTIwMTQgbm90aGluZyB0byBwcnVuZVxuICB9XG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZGlyUGF0aCA9IG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgZW50cnkubmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhkaXJQYXRoKTtcbiAgICAgIGlmIChub3cgLSBzdGF0Lm10aW1lTXMgPiBtYXhBZ2VNcykge1xuICAgICAgICBmcy5ybVN5bmMoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVmFuaXNoZWQgYmV0d2VlbiByZWFkZGlyIGFuZCBzdGF0LCBvciByZW1vdmFsIGZhaWxlZCBcdTIwMTQgc2tpcCBpdC4gQVxuICAgICAgLy8gYmVzdC1lZmZvcnQgcHJ1bmUgbXVzdCBuZXZlciB0aHJvdyBpbnRvIHRoZSBjYWxsZXIncyBob3QgcGF0aC5cbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgdGhlIGFkdmlzb3IncyBwZXItY2hhbmdlc2V0IHN0YXRlIG1lbW9zIChkaWdlc3Qgb2Ygc29ydGVkXG4gKiBmaW5kaW5ncyArIHVuY292ZXJlZCBwYXRocyksIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpciBzbyBpdCBpcyBzaGFyZWRcbiAqIGFjcm9zcyB3b3JrdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZpc29yTWVtb0RpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ2Fkdmlzb3InKTtcbn1cbiIsICIvKipcbiAqIFN0YXRpYyBjbGFzc2lmaWNhdGlvbiBvZiBhIEJhc2ggdG9vbCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGVcbiAqIHBhdGgocykgKyBsaW5lIHJhbmdlKHMpIGl0IHJlYWRzIG9yIHdyaXRlcywgd2hlcmUgdGhhdCdzIHN0YXRpY2FsbHlcbiAqIGRldGVybWluYWJsZS4gQnVpbHQgZnJvbSBhbiBlbXBpcmljYWwgcGFzcyBvdmVyIH4zMWsgcmVhbCBDbGF1ZGUgQ29kZVxuICogQmFzaCBpbnZvY2F0aW9ucyAoc2VlIGFuYWx5emUtdHJhbnNjcmlwdHMubXRzKSBcdTIwMTQgdGhlIGlkaW9tcyBiZWxvdyBhcmVcbiAqIGV4YWN0bHkgdGhlIG9uZXMgdGhhdCB0dXJuZWQgb3V0IHRvIGJlIGNvbW1vbiBBTkQgcmVsaWFibGUgdGhlcmUuXG4gKlxuICogRGVsaWJlcmF0ZWx5IE5PVCBjb3ZlcmVkIChzZWUgdGhlIHJlc2VhcmNoIHJlcG9ydCk6IGF3ayBOUi10cmlja3MgKHJhcmUsXG4gKiB1bmNvbnN0cmFpbmVkIHN5bnRheCksIGdyZXAgLW4vLUEvLUIvLUMgKHRoZSB3aW5kb3cgaXMgYW5jaG9yZWQgdG8gbWF0Y2hcbiAqIHBvc2l0aW9uLCB3aGljaCBpcyBkYXRhLWRlcGVuZGVudCwgbm90IGluIHRoZSBjb21tYW5kIHRleHQpLCBlbWJlZGRlZFxuICogcHl0aG9uMy9ub2RlIGhlcmVkb2Mgc2NyaXB0cyAoYSBkaWZmZXJlbnQgbGFuZ3VhZ2UncyBBU1QsIG5vdCBhIHNoZWxsXG4gKiBjb25jZXJuKSwgc2VkIC1pIChubyBsaW5lLWFkZHJlc3NlZCB1c2FnZSBvYnNlcnZlZCBcdTIwMTQgYWxsIHBhdHRlcm4tb25seVxuICogc3Vic3RpdHV0aW9ucyB3aXRoIG5vIHN0YXRpYyByYW5nZSksIHBsYWluIGBlY2hvYC9gcHJpbnRmYCByZWRpcmVjdHMgKHJhcmVcbiAqIGFuZCBzZW1hbnRpY2FsbHkgYW1iaWd1b3VzIGluIHRoZSBjb3JwdXMpLlxuICovXG5pbXBvcnQgeyByZXNvbHZlIGFzIHJlc29sdmVQYXRoIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvdW50RmlsZUxpbmVzLCBjb3VudEdpdEJsb2JMaW5lcyB9IGZyb20gJy4vY29tbWFuZC1yZXNvbHZlLmpzJztcbmltcG9ydCB7IGFyZ3ZPZiwgc3BsaXRUb3BMZXZlbCB9IGZyb20gJy4vc2hlbGwtc3BsaXQuanMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVkU3BhbiB7XG4gIGxpbmVTdGFydDogbnVtYmVyO1xuICBsaW5lRW5kOiBudW1iZXI7XG4gIGFic29sdXRlUGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogVGhlIGV4YWN0IGJvZHkgb2YgYSBgaGVyZWRvYy13cml0ZWAgc3BhbiBcdTIwMTQgdGhlIGNvbnRlbnQgdGhlIGhlcmVkb2Mgd3JpdGVzLlxuICAgKiBBYnNlbnQgKHVuZGVmaW5lZCkgZm9yIHJlYWQgaWRpb21zLlxuICAgKi9cbiAgYm9keT86IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBoZXJlZG9jIHJlZGlyZWN0IG9wZXJhdG9yLiBgPmAgbWVhbnMgdGhlIGZpbGUgd2FzIG92ZXJ3cml0dGVuXG4gICAqICh3aG9sZS1maWxlIHNjb3BlIFx1MjAxNCBhbnkgc3BhbiBiZXlvbmQgdGhlIG5ldyBFT0Ygd2FzIGRlbGV0ZWQgYW5kIG11c3RcbiAgICogc3VyZmFjZSk7IGA+PmAgbWVhbnMgdGhlIGJvZHkgd2FzIGFwcGVuZGVkIChuYXJyb3cgdG8gdGhlIGFwcGVuZCByYW5nZSkuXG4gICAqIEFic2VudCAodW5kZWZpbmVkKSBmb3IgcmVhZCBpZGlvbXMuXG4gICAqL1xuICByZWRpcmVjdD86ICc+JyB8ICc+Pic7XG59XG5cbmV4cG9ydCB0eXBlIElkaW9tID1cbiAgfCAnc2VkLW4tcmFuZ2UnXG4gIHwgJ2hlYWQtZmlsZSdcbiAgfCAndGFpbC1maWxlJ1xuICB8ICdjYXQtZmlsZSdcbiAgfCAnbmwtZmlsZSdcbiAgfCAnZ2l0LXNob3ctcmV2LXBhdGgnXG4gIHwgJ2dpdC1sb2ctTCdcbiAgfCAnaGVyZWRvYy13cml0ZSc7XG5cbmV4cG9ydCB0eXBlIFNwYW5NYXRjaCA9XG4gIHwgeyBzdGF0dXM6ICdyZXNvbHZlZCc7IGlkaW9tOiBJZGlvbTsgc3BhbjogUmVzb2x2ZWRTcGFuOyBub3RlPzogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VucmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IGZpbGVBcmc6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lLXJhbmdlIHNwZWNzOiB3aGF0IGEgbWF0Y2hlZCBpZGlvbSBzYXlzIGFib3V0IHRoZSByYW5nZSwgYmVmb3JlIHdlIGtub3dcbi8vIHdoZXRoZXIgcmVzb2x2aW5nIGl0IG5lZWRzIHRvIGNvbnN1bHQgYSByZWFsIGZpbGUvZ2l0IGJsb2IuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudHlwZSBMaW5lUmFuZ2VTcGVjID1cbiAgfCB7IGtpbmQ6ICdsaXRlcmFsJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnOyBlbmQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndG9Fb2YnOyBzdGFydDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICdsYXN0TkxpbmVzJzsgY291bnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnYXBwZW5kTGluZXMnOyBjb3VudDogbnVtYmVyIH07XG5cbmZ1bmN0aW9uIHJlc29sdmVTcGVjKFxuICBzcGVjOiBMaW5lUmFuZ2VTcGVjLFxuICB0b3RhbExpbmVzOiAoKSA9PiBudW1iZXIgfCBudWxsXG4pOiB7IGxpbmVTdGFydDogbnVtYmVyOyBsaW5lRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBzd2l0Y2ggKHNwZWMua2luZCkge1xuICAgIGNhc2UgJ2xpdGVyYWwnOlxuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBzcGVjLmVuZCB9O1xuICAgIGNhc2UgJ3VwcGVyQm91bmRGcm9tU3RhcnQnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogMSwgbGluZUVuZDogdG90YWwgIT09IG51bGwgPyBNYXRoLm1pbihzcGVjLmVuZCwgdG90YWwpIDogc3BlYy5lbmQgfTtcbiAgICB9XG4gICAgY2FzZSAndG9Fb2YnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCB8fCB0b3RhbCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHNwZWMuc3RhcnQsIGxpbmVFbmQ6IE1hdGgubWF4KHNwZWMuc3RhcnQsIHRvdGFsKSB9O1xuICAgIH1cbiAgICBjYXNlICdsYXN0TkxpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBNYXRoLm1heCgxLCB0b3RhbCAtIHNwZWMuY291bnQgKyAxKSwgbGluZUVuZDogdG90YWwgfTtcbiAgICB9XG4gICAgY2FzZSAnYXBwZW5kTGluZXMnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKSA/PyAwO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiB0b3RhbCArIDEsIGxpbmVFbmQ6IHRvdGFsICsgc3BlYy5jb3VudCB9O1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBoYXNTaGVsbEV4cGFuc2lvbihzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9bJGBdLy50ZXN0KHMpO1xufVxuXG5mdW5jdGlvbiBsb29rc1VucmVzb2x2YWJsZShzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGhhc1NoZWxsRXhwYW5zaW9uKHMpIHx8IC9bKj9dLy50ZXN0KHMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIElkaW9tIG1hdGNoZXJzOiBwdXJlIGZ1bmN0aW9ucyBvdmVyIG9uZSBzaW1wbGUgY29tbWFuZCdzIGFyZ3YuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFJhd0NhbmRpZGF0ZSB7XG4gIGtpbmQ6ICdjYW5kaWRhdGUnO1xuICBpZGlvbTogSWRpb207XG4gIGZpbGVBcmc6IHN0cmluZztcbiAgc3BlYzogTGluZVJhbmdlU3BlYztcbiAgcmVzb2x2ZXJLaW5kOiAnZnMnIHwgeyBraW5kOiAnZ2l0JzsgcmV2OiBzdHJpbmcgfTtcbiAgZGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG59XG5pbnRlcmZhY2UgUmF3VW5yZXNvbHZlZCB7XG4gIGtpbmQ6ICd1bnJlc29sdmVkJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHJlYXNvbjogc3RyaW5nO1xufVxudHlwZSBNYXRjaFJlc3VsdCA9IFJhd0NhbmRpZGF0ZSB8IFJhd1VucmVzb2x2ZWQ7XG5cbmNvbnN0IFNFRF9SQU5HRSA9IC9eKFxcZCspKD86LChcXGQrfFxcJCkpP3AkLztcblxuLyoqIFNwbGl0IGEgYHNlZGAgc2NyaXB0IGFyZ3VtZW50IGludG8gaXRzIGA7YC1zZXBhcmF0ZWQgc2VnbWVudHMuICovXG5mdW5jdGlvbiBzZWRTY3JpcHRTZWdtZW50cyhzY3JpcHQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHNjcmlwdC5zcGxpdCgnOycpO1xufVxuXG5mdW5jdGlvbiBtYXRjaFNlZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3NlZCcpIHJldHVybiBbXTtcbiAgY29uc3QgcmVzdCA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmICghcmVzdC5pbmNsdWRlcygnLW4nKSkgcmV0dXJuIFtdO1xuICBsZXQgc2NyaXB0SWR4ID0gLTE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgIGlmIChyZXN0W2ldID09PSAnLW4nKSBjb250aW51ZTtcbiAgICBpZiAoc2VkU2NyaXB0U2VnbWVudHMocmVzdFtpXSkuc29tZSgoc2VnKSA9PiBTRURfUkFOR0UudGVzdChzZWcpKSkge1xuICAgICAgc2NyaXB0SWR4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBpZiAoc2NyaXB0SWR4ID09PSAtMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQ2FuZGlkYXRlcyA9IHJlc3QuZmlsdGVyKChhLCBpKSA9PiBpICE9PSBzY3JpcHRJZHggJiYgYSAhPT0gJy1uJyAmJiAhYS5zdGFydHNXaXRoKCctJykpO1xuICBpZiAoZmlsZUNhbmRpZGF0ZXMubGVuZ3RoICE9PSAxKSByZXR1cm4gW107XG4gIGNvbnN0IGZpbGVBcmcgPSBmaWxlQ2FuZGlkYXRlc1swXTtcbiAgY29uc3QgcmVzdWx0czogTWF0Y2hSZXN1bHRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VkU2NyaXB0U2VnbWVudHMocmVzdFtzY3JpcHRJZHhdKSkge1xuICAgIGNvbnN0IG1hdGNoID0gc2VnbWVudC5tYXRjaChTRURfUkFOR0UpO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gICAgY29uc3QgZW5kVG9rZW4gPSBtYXRjaFsyXTtcbiAgICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID1cbiAgICAgIGVuZFRva2VuID09PSB1bmRlZmluZWRcbiAgICAgICAgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQsIGVuZDogc3RhcnQgfVxuICAgICAgICA6IGVuZFRva2VuID09PSAnJCdcbiAgICAgICAgICA/IHsga2luZDogJ3RvRW9mJywgc3RhcnQgfVxuICAgICAgICAgIDogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IE51bWJlci5wYXJzZUludChlbmRUb2tlbiwgMTApIH07XG4gICAgcmVzdWx0cy5wdXNoKHsga2luZDogJ2NhbmRpZGF0ZScsIGlkaW9tOiAnc2VkLW4tcmFuZ2UnLCBmaWxlQXJnLCBzcGVjLCByZXNvbHZlcktpbmQ6ICdmcycgfSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbmZ1bmN0aW9uIHBhcnNlSGVhZFRhaWxGbGFncyhyZXN0OiBzdHJpbmdbXSk6IHtcbiAgY291bnQ6IG51bWJlciB8IG51bGw7XG4gIGZyb21TdGFydDogYm9vbGVhbjtcbiAgZGlzcXVhbGlmaWVkOiBib29sZWFuO1xuICBmaWxlczogc3RyaW5nW107XG59IHtcbiAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjb3VudDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCBmcm9tU3RhcnQgPSBmYWxzZTtcbiAgbGV0IGRpc3F1YWxpZmllZCA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gcmVzdFtpXTtcbiAgICBpZiAoYSA9PT0gJy1mJyB8fCBhID09PSAnLUYnIHx8IGEgPT09ICctLWZvbGxvdycgfHwgYS5zdGFydHNXaXRoKCctLWZvbGxvdz0nKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy16JyB8fCBhID09PSAnLS16ZXJvLXRlcm1pbmF0ZWQnKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnIHx8IGEgPT09ICctLWJ5dGVzJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14oLWN8LS1ieXRlcz0pLy50ZXN0KGEpKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXEnIHx8IGEgPT09ICctdicgfHwgYSA9PT0gJy0tcXVpZXQnIHx8IGEgPT09ICctLXNpbGVudCcgfHwgYSA9PT0gJy0tdmVyYm9zZScpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLW4nKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFwrP1xcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tbGluZXM9JykpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKCctLWxpbmVzPScubGVuZ3RoKTtcbiAgICAgIGlmICgvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLW5cXCs/XFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKDIpO1xuICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL15cXCtcXGQrJC8udGVzdChhKSkge1xuICAgICAgZnJvbVN0YXJ0ID0gdHJ1ZTtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0nKSB7XG4gICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgZmlsZXMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoSGVhZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2hlYWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIFtdO1xuICBjb25zdCByZWFsRmlsZXMgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyk7XG4gIGlmIChyZWFsRmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IG4gPSBjb3VudCA/PyAxMDtcbiAgcmV0dXJuIHJlYWxGaWxlcy5tYXAoKGZpbGVBcmcpID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScgYXMgY29uc3QsXG4gICAgaWRpb206ICdoZWFkLWZpbGUnIGFzIGNvbnN0LFxuICAgIGZpbGVBcmcsXG4gICAgc3BlYzogeyBraW5kOiAndXBwZXJCb3VuZEZyb21TdGFydCcsIGVuZDogbiB9IGFzIExpbmVSYW5nZVNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hUYWlsKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAndGFpbCcpIHJldHVybiBbXTtcbiAgY29uc3QgeyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPSBmcm9tU3RhcnQgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiBuIH0gOiB7IGtpbmQ6ICdsYXN0TkxpbmVzJywgY291bnQ6IG4gfTtcbiAgcmV0dXJuIHJlYWxGaWxlcy5tYXAoKGZpbGVBcmcpID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScgYXMgY29uc3QsXG4gICAgaWRpb206ICd0YWlsLWZpbGUnIGFzIGNvbnN0LFxuICAgIGZpbGVBcmcsXG4gICAgc3BlYyxcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgYXMgY29uc3RcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBmaW5kR2l0U3ViY29tbWFuZChcbiAgcmVzdDogc3RyaW5nW11cbik6IHsgc3ViSWR4OiBudW1iZXI7IHN1YmNvbW1hbmQ6IHN0cmluZzsgY0Rpcjogc3RyaW5nIHwgbnVsbDsgY0RpclVucmVzb2x2YWJsZTogYm9vbGVhbiB9IHwgbnVsbCB7XG4gIGxldCBjRGlyOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGNEaXJVbnJlc29sdmFibGUgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IHJlc3QubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctQycpIHtcbiAgICAgIGNvbnN0IHYgPSByZXN0W2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgaWYgKGhhc1NoZWxsRXhwYW5zaW9uKHYpKSBjRGlyVW5yZXNvbHZhYmxlID0gdHJ1ZTtcbiAgICAgIGVsc2UgY0RpciA9IHY7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYycpIHtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICByZXR1cm4geyBzdWJJZHg6IGksIHN1YmNvbW1hbmQ6IGEsIGNEaXIsIGNEaXJVbnJlc29sdmFibGUgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuY29uc3QgUkVWX1BBVEggPSAvXihbXlxcczpdKyk6KC4rKSQvO1xuXG5mdW5jdGlvbiBtYXRjaEdpdFNob3coYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ3Nob3cnKSByZXR1cm4gW107XG4gIGNvbnN0IGFmdGVyID0gYXJndlxuICAgIC5zbGljZSgxKVxuICAgIC5zbGljZShzdWIuc3ViSWR4ICsgMSlcbiAgICAuZmlsdGVyKChhKSA9PiAhYS5zdGFydHNXaXRoKCctJykpO1xuICBjb25zdCByZXZQYXRoQXJnID0gYWZ0ZXIuZmluZCgoYSkgPT4gUkVWX1BBVEgudGVzdChhKSk7XG4gIGlmICghcmV2UGF0aEFyZykgcmV0dXJuIFtdO1xuICBjb25zdCBtID0gcmV2UGF0aEFyZy5tYXRjaChSRVZfUEFUSCk7XG4gIGlmICghbSkgcmV0dXJuIFtdO1xuICBjb25zdCBbLCByZXYsIHBhdGhdID0gbTtcbiAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlIHx8IGhhc1NoZWxsRXhwYW5zaW9uKHJldikpIHtcbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICByZWFzb246ICdnaXQgLUMgdGFyZ2V0IG9yIHJldmlzaW9uIGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW1xuICAgIHtcbiAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgICAgcmVzb2x2ZXJLaW5kOiB7IGtpbmQ6ICdnaXQnLCByZXYgfSxcbiAgICAgIGRpck92ZXJyaWRlOiBzdWIuY0RpciA/PyB1bmRlZmluZWRcbiAgICB9XG4gIF07XG59XG5cbmZ1bmN0aW9uIG1hdGNoR2l0TG9nTChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2dpdCcpIHJldHVybiBbXTtcbiAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndi5zbGljZSgxKSk7XG4gIGlmICghc3ViIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnbG9nJykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3Yuc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFmdGVyLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFmdGVyW2ldO1xuICAgIGxldCBzcGVjOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICBpZiAoYSA9PT0gJy1MJykgc3BlYyA9IGFmdGVyW2kgKyAxXSA/PyBudWxsO1xuICAgIGVsc2UgaWYgKGEuc3RhcnRzV2l0aCgnLUwnKSkgc3BlYyA9IGEuc2xpY2UoMik7XG4gICAgaWYgKCFzcGVjKSBjb250aW51ZTtcbiAgICBjb25zdCBtID0gc3BlYy5tYXRjaCgvXihcXGQrKSwoXFxkKyk6KC4rKSQvKTtcbiAgICBpZiAoIW0pIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHMsIGUsIHBhdGhdID0gbTtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdnaXQtbG9nLUwnLFxuICAgICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgICB9XG4gICAgICBdO1xuICAgIH1cbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgaWRpb206ICdnaXQtbG9nLUwnLFxuICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICBzcGVjOiB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IE51bWJlci5wYXJzZUludChzLCAxMCksIGVuZDogTnVtYmVyLnBhcnNlSW50KGUsIDEwKSB9LFxuICAgICAgICByZXNvbHZlcktpbmQ6ICdmcycsXG4gICAgICAgIGRpck92ZXJyaWRlOiBzdWIuY0RpciA/PyB1bmRlZmluZWRcbiAgICAgIH1cbiAgICBdO1xuICB9XG4gIHJldHVybiBbXTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBIZXJlZG9jIHdyaXRlcyAoYGNhdCA+IGZpbGUgPDxFT0YgLi4uIEVPRmApOiBoYW5kbGVkIGFzIGEgZGVkaWNhdGVkIHJhdy10ZXh0XG4vLyBwYXNzIGJlY2F1c2UgdGhlIGJvZHkgY2FuIGl0c2VsZiBjb250YWluICYmLzsvfC9uZXdsaW5lcyB0aGF0IHdvdWxkXG4vLyBvdGhlcndpc2UgY29uZnVzZSBzcGxpdFRvcExldmVsLiBNYXRjaGVkIHNwYW5zIGFyZSBtYXNrZWQgb3V0IG9mIHRoZSBzdHJpbmdcbi8vIChyZXBsYWNlZCB3aXRoIGFuIGluZGV4ZWQgcGxhY2Vob2xkZXIgc2ltcGxlLWNvbW1hbmQpIGJlZm9yZSB0aGUgcmVzdCBvZlxuLy8gdGhlIHBpcGVsaW5lIHJ1bnMsIGFuZCByZS1hc3NvY2lhdGVkIGJ5IGluZGV4IGR1cmluZyB0aGUgbWFpbiB3YWxrIHNvIHRoZVxuLy8gd3JpdGUgaXMgcmVzb2x2ZWQgYWdhaW5zdCB0aGUgY29ycmVjdCBgY2RgLXRyYWNrZWQgZGlyZWN0b3J5LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBIZXJlZG9jV3JpdGUge1xuICByZWRpcmVjdDogJz4nIHwgJz4+JztcbiAgdGFyZ2V0OiBzdHJpbmc7XG4gIGJvZHk6IHN0cmluZztcbn1cblxuY29uc3QgSEVSRURPQ19PUEVOID1cbiAgL1xcYmNhdFsgXFx0XSsoPnsxLDJ9KVsgXFx0XSooXFxTKylbIFxcdF0qPDwoLT8pWyBcXHRdKig/OicoW14nXSopJ3xcIihbXlwiXSopXCJ8KFtBLVphLXpfXVtBLVphLXowLTlfXSopKVsgXFx0XSpcXHI/XFxuL2c7XG5cbmZ1bmN0aW9uIGVzY2FwZVJlZ0V4cChzOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcy5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0SGVyZWRvY1dyaXRlcyhyYXc6IHN0cmluZyk6IHsgd3JpdGVzOiBIZXJlZG9jV3JpdGVbXTsgbWFza2VkOiBzdHJpbmcgfSB7XG4gIGNvbnN0IHdyaXRlczogSGVyZWRvY1dyaXRlW10gPSBbXTtcbiAgbGV0IG1hc2tlZCA9ICcnO1xuICBsZXQgY3Vyc29yID0gMDtcbiAgSEVSRURPQ19PUEVOLmxhc3RJbmRleCA9IDA7XG4gIGxldCBvcGVuTWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGwgPSBIRVJFRE9DX09QRU4uZXhlYyhyYXcpO1xuICB3aGlsZSAob3Blbk1hdGNoICE9PSBudWxsKSB7XG4gICAgY29uc3QgWywgcmVkaXJlY3QsIHRhcmdldCwgZGFzaCwgZHExLCBkcTIsIGJhcmVdID0gb3Blbk1hdGNoO1xuICAgIGNvbnN0IGRlbGltID0gZHExID8/IGRxMiA/PyBiYXJlO1xuICAgIGNvbnN0IGJvZHlTdGFydCA9IG9wZW5NYXRjaC5pbmRleCArIG9wZW5NYXRjaFswXS5sZW5ndGg7XG4gICAgaWYgKCFkZWxpbSB8fCBib2R5U3RhcnQgPCBjdXJzb3IpIHtcbiAgICAgIEhFUkVET0NfT1BFTi5sYXN0SW5kZXggPSBvcGVuTWF0Y2guaW5kZXggKyAxO1xuICAgICAgb3Blbk1hdGNoID0gSEVSRURPQ19PUEVOLmV4ZWMocmF3KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBjbG9zZVJlID0gbmV3IFJlZ0V4cChgXiR7ZGFzaCA/ICdcXFxcdConIDogJyd9JHtlc2NhcGVSZWdFeHAoZGVsaW0pfVsgXFxcXHRdKiRgLCAnbScpO1xuICAgIGNvbnN0IHJlbWFpbmRlciA9IHJhdy5zbGljZShib2R5U3RhcnQpO1xuICAgIGNvbnN0IGNsb3NlTWF0Y2ggPSBjbG9zZVJlLmV4ZWMocmVtYWluZGVyKTtcbiAgICBpZiAoIWNsb3NlTWF0Y2gpIHtcbiAgICAgIEhFUkVET0NfT1BFTi5sYXN0SW5kZXggPSBib2R5U3RhcnQ7XG4gICAgICBvcGVuTWF0Y2ggPSBIRVJFRE9DX09QRU4uZXhlYyhyYXcpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGJvZHkgPSByZW1haW5kZXIuc2xpY2UoMCwgY2xvc2VNYXRjaC5pbmRleCkucmVwbGFjZSgvXFxuJC8sICcnKTtcbiAgICBjb25zdCBtYXRjaEVuZCA9IGJvZHlTdGFydCArIGNsb3NlTWF0Y2guaW5kZXggKyBjbG9zZU1hdGNoWzBdLmxlbmd0aDtcblxuICAgIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yLCBvcGVuTWF0Y2guaW5kZXgpO1xuICAgIG1hc2tlZCArPSBgX19oZXJlZG9jXyR7d3JpdGVzLmxlbmd0aH1fX2A7XG4gICAgY3Vyc29yID0gbWF0Y2hFbmQ7XG4gICAgd3JpdGVzLnB1c2goeyByZWRpcmVjdDogcmVkaXJlY3QgYXMgJz4nIHwgJz4+JywgdGFyZ2V0LCBib2R5IH0pO1xuXG4gICAgSEVSRURPQ19PUEVOLmxhc3RJbmRleCA9IG1hdGNoRW5kO1xuICAgIG9wZW5NYXRjaCA9IEhFUkVET0NfT1BFTi5leGVjKHJhdyk7XG4gIH1cbiAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IpO1xuICByZXR1cm4geyB3cml0ZXMsIG1hc2tlZCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE9yY2hlc3RyYXRvclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IExJTkVfU0VMRUNUT1JTID0gW21hdGNoU2VkLCBtYXRjaEhlYWQsIG1hdGNoVGFpbF07XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kOiBzdHJpbmcsIGN3ZDogc3RyaW5nID0gcHJvY2Vzcy5jd2QoKSk6IFNwYW5NYXRjaFtdIHtcbiAgY29uc3QgeyB3cml0ZXM6IGhlcmVkb2NXcml0ZXMsIG1hc2tlZCB9ID0gZXh0cmFjdEhlcmVkb2NXcml0ZXMoY29tbWFuZCk7XG4gIGNvbnN0IHNpbXBsZUNvbW1hbmRzID0gc3BsaXRUb3BMZXZlbChtYXNrZWQpO1xuXG4gIGNvbnN0IHJlc3VsdHM6IFNwYW5NYXRjaFtdID0gW107XG4gIGNvbnN0IGZzTGluZUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlciB8IG51bGw+KCk7XG4gIGNvbnN0IGdpdExpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuXG4gIGNvbnN0IGNhY2hlZEZzVG90YWxMaW5lcyA9IChhYnNQYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBpZiAoIWZzTGluZUNhY2hlLmhhcyhhYnNQYXRoKSkgZnNMaW5lQ2FjaGUuc2V0KGFic1BhdGgsIGNvdW50RmlsZUxpbmVzKGFic1BhdGgpKTtcbiAgICByZXR1cm4gZnNMaW5lQ2FjaGUuZ2V0KGFic1BhdGgpID8/IG51bGw7XG4gIH07XG4gIGNvbnN0IGNhY2hlZEdpdFRvdGFsTGluZXMgPSAoZ2l0Q3dkOiBzdHJpbmcsIHJldjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBjb25zdCBrZXkgPSBgJHtnaXRDd2R9XHUwMDAwJHtyZXZ9XHUwMDAwJHtwYXRofWA7XG4gICAgaWYgKCFnaXRMaW5lQ2FjaGUuaGFzKGtleSkpIGdpdExpbmVDYWNoZS5zZXQoa2V5LCBjb3VudEdpdEJsb2JMaW5lcyhnaXRDd2QsIHJldiwgcGF0aCkpO1xuICAgIHJldHVybiBnaXRMaW5lQ2FjaGUuZ2V0KGtleSkgPz8gbnVsbDtcbiAgfTtcblxuICBsZXQgY3VycmVudERpciA9IGN3ZDtcbiAgbGV0IGxhc3RQbGFpbkZpbGVTb3VyY2U6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0IGVtaXRDYW5kaWRhdGUgPSAoYzogUmF3Q2FuZGlkYXRlLCBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcpID0+IHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoYy5maWxlQXJnKSkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBjLmZpbGVBcmcsXG4gICAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGRpckZvclJlc29sdXRpb24sIGMuZmlsZUFyZyk7XG4gICAgY29uc3QgdG90YWxMaW5lcyA9XG4gICAgICBjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJ1xuICAgICAgICA/IGNhY2hlZEZzVG90YWxMaW5lcyhhYnNvbHV0ZVBhdGgpXG4gICAgICAgIDogY2FjaGVkR2l0VG90YWxMaW5lcyhjLmRpck92ZXJyaWRlID8/IGRpckZvclJlc29sdXRpb24sIGMucmVzb2x2ZXJLaW5kLnJldiwgYy5maWxlQXJnKTtcbiAgICBjb25zdCByYW5nZSA9IHJlc29sdmVTcGVjKGMuc3BlYywgdG90YWxMaW5lcyk7XG4gICAgaWYgKHJhbmdlID09PSBudWxsKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGFic29sdXRlUGF0aCxcbiAgICAgICAgcmVhc29uOiAnY291bGQgbm90IGRldGVybWluZSBlbmQtb2YtZmlsZSBsaW5lIGNvdW50IChmaWxlIHVucmVhZGFibGUsIGVtcHR5LCBvciBnaXQgcmV2L3BhdGggbm90IGZvdW5kKSdcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICBzcGFuOiB7IGxpbmVTdGFydDogcmFuZ2UubGluZVN0YXJ0LCBsaW5lRW5kOiByYW5nZS5saW5lRW5kLCBhYnNvbHV0ZVBhdGggfVxuICAgIH0pO1xuICB9O1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2ltcGxlQ29tbWFuZHMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBzaW1wbGUgPSBzaW1wbGVDb21tYW5kc1tpXTtcbiAgICBjb25zdCBoZXJlZG9jUmVmID0gc2ltcGxlLnRleHQubWF0Y2goL15fX2hlcmVkb2NfKFxcZCspX18kLyk7XG4gICAgaWYgKGhlcmVkb2NSZWYpIHtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29uc3QgdyA9IGhlcmVkb2NXcml0ZXNbTnVtYmVyLnBhcnNlSW50KGhlcmVkb2NSZWZbMV0sIDEwKV07XG4gICAgICBpZiAobG9va3NVbnJlc29sdmFibGUody50YXJnZXQpKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBmaWxlQXJnOiB3LnRhcmdldCxcbiAgICAgICAgICByZWFzb246ICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYidcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoY3VycmVudERpciwgdy50YXJnZXQpO1xuICAgICAgY29uc3QgYm9keUxpbmVzID0gdy5ib2R5Lmxlbmd0aCA9PT0gMCA/IDAgOiB3LmJvZHkuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgICAgIGlmIChib2R5TGluZXMgPT09IDApIHtcbiAgICAgICAgLy8gYGNhdCA+IGYgPDwnRU9GJ2Agd2l0aCBhbiBlbXB0eSBib2R5IHRydW5jYXRlcyB0aGUgZmlsZSB0byBlbXB0eSBcdTIwMTQgYVxuICAgICAgICAvLyByZWFsIHdyaXRlIHRoYXQgbXVzdCBwcm9kdWNlIGEgdG91Y2ggKHdob2xlLWZpbGUsIHZpYSBgYm9keTogJydgKS5cbiAgICAgICAgLy8gYD4+YCB3aXRoIGFuIGVtcHR5IGJvZHkgYXBwZW5kcyBub3RoaW5nIGFuZCBpcyBhIGdlbnVpbmUgbm8tb3AuXG4gICAgICAgIGlmICh3LnJlZGlyZWN0ICE9PSAnPicpIGNvbnRpbnVlO1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46IHsgbGluZVN0YXJ0OiAxLCBsaW5lRW5kOiAxLCBhYnNvbHV0ZVBhdGgsIGJvZHk6ICcnLCByZWRpcmVjdDogdy5yZWRpcmVjdCB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPVxuICAgICAgICB3LnJlZGlyZWN0ID09PSAnPicgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IDEsIGVuZDogYm9keUxpbmVzIH0gOiB7IGtpbmQ6ICdhcHBlbmRMaW5lcycsIGNvdW50OiBib2R5TGluZXMgfTtcbiAgICAgIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoc3BlYywgY2FjaGVkRnNUb3RhbExpbmVzKGFic29sdXRlUGF0aCkpO1xuICAgICAgaWYgKHJhbmdlID09PSBudWxsKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBmaWxlQXJnOiBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgcmVhc29uOiAnYXBwZW5kIHRhcmdldDogY291bGQgbm90IHJlYWQgZXhpc3RpbmcgZmlsZSB0byBmaW5kIGl0cyBjdXJyZW50IGxlbmd0aCdcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46IHsgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsIGFic29sdXRlUGF0aCwgYm9keTogdy5ib2R5LCByZWRpcmVjdDogdy5yZWRpcmVjdCB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgYXJndiA9IGFyZ3ZPZihzaW1wbGUudGV4dCk7XG4gICAgaWYgKCFhcmd2IHx8IGFyZ3YubGVuZ3RoID09PSAwKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChhcmd2WzBdID09PSAnY2QnKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnN0IHRhcmdldCA9IGFyZ3ZbMV07XG4gICAgICBpZiAodGFyZ2V0ICE9PSB1bmRlZmluZWQgJiYgdGFyZ2V0ICE9PSAnLScgJiYgIWhhc1NoZWxsRXhwYW5zaW9uKHRhcmdldCkpIHtcbiAgICAgICAgY3VycmVudERpciA9IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIHRhcmdldCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBsZXQgaXNQbGFpblNvdXJjZSA9IGZhbHNlO1xuICAgIGxldCBwbGFpbkZpbGVBcmc6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIGlmIChhcmd2WzBdID09PSAnY2F0JyAmJiBhcmd2Lmxlbmd0aCA9PT0gMiAmJiAhYXJndlsxXS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGlzUGxhaW5Tb3VyY2UgPSB0cnVlO1xuICAgICAgcGxhaW5GaWxlQXJnID0gYXJndlsxXTtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBoYXNTaGVsbEV4cGFuc2lvbihhcmd2WzFdKSA/IG51bGwgOiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCBhcmd2WzFdKTtcbiAgICB9IGVsc2UgaWYgKGFyZ3ZbMF0gPT09ICdubCcgJiYgYXJndi5sZW5ndGggPj0gMiAmJiAhYXJndlthcmd2Lmxlbmd0aCAtIDFdLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICBjb25zdCBmID0gYXJndlthcmd2Lmxlbmd0aCAtIDFdO1xuICAgICAgcGxhaW5GaWxlQXJnID0gZjtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBoYXNTaGVsbEV4cGFuc2lvbihmKSA/IG51bGwgOiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCBmKTtcbiAgICB9XG5cbiAgICAvLyBBIGJhcmUgYGNhdCBmaWxlYC9gbmwgZmlsZWAgdGhhdCBpcyBub3QgZmVlZGluZyBhIGRvd25zdHJlYW0gcGlwZSBzdGFnZVxuICAgIC8vIHJlYWRzIHRoZSB3aG9sZSBmaWxlOiBlbWl0IHRoZSBzYW1lIHdob2xlLWZpbGUgc3BhbiBgZ2l0IHNob3cgcmV2OnBhdGhgXG4gICAgLy8gcHJvZHVjZXMuIFdoZW4gYSBwaXBlIGZvbGxvd3MsIHRoZSBkb3duc3RyZWFtIGxpbmUtc2VsZWN0b3IgYWxyZWFkeVxuICAgIC8vIGVtaXRzIHRoZSBwcmVjaXNlIHJhbmdlLCBzbyB0aGUgc291cmNlIHN0YXlzIHNvdXJjZS1vbmx5LlxuICAgIGlmIChwbGFpbkZpbGVBcmcgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IG5leHQgPSBzaW1wbGVDb21tYW5kc1tpICsgMV07XG4gICAgICBpZiAobmV4dCA9PT0gdW5kZWZpbmVkIHx8IG5leHQucHJlY2VkZWRCeSAhPT0gJ3wnKSB7XG4gICAgICAgIGVtaXRDYW5kaWRhdGUoXG4gICAgICAgICAge1xuICAgICAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgICAgICBpZGlvbTogYXJndlswXSA9PT0gJ2NhdCcgPyAnY2F0LWZpbGUnIDogJ25sLWZpbGUnLFxuICAgICAgICAgICAgZmlsZUFyZzogcGxhaW5GaWxlQXJnLFxuICAgICAgICAgICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgICAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBjdXJyZW50RGlyXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgWy4uLkxJTkVfU0VMRUNUT1JTLCBtYXRjaEdpdFNob3csIG1hdGNoR2l0TG9nTF0pIHtcbiAgICAgIGZvciAoY29uc3Qgb3V0Y29tZSBvZiBtYXRjaGVyKGFyZ3YpKSB7XG4gICAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgICAgICBpZiAob3V0Y29tZS5raW5kID09PSAndW5yZXNvbHZlZCcpIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgICBpZGlvbTogb3V0Y29tZS5pZGlvbSxcbiAgICAgICAgICAgIGZpbGVBcmc6IG91dGNvbWUuZmlsZUFyZyxcbiAgICAgICAgICAgIHJlYXNvbjogb3V0Y29tZS5yZWFzb25cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlbWl0Q2FuZGlkYXRlKG91dGNvbWUsIG91dGNvbWUuZGlyT3ZlcnJpZGUgPz8gY3VycmVudERpcik7XG4gICAgICAgICAgLy8gYGdpdCBzaG93IHJldjpwYXRoYCBwcmludHMgdGhlIGJsb2IgdmVyYmF0aW0sIHNvICh1bmxpa2UgYGdpdCBsb2cgLUxgLFxuICAgICAgICAgIC8vIHdoaWNoIHByaW50cyBkaWZmLWZvcm1hdHRlZCBoaXN0b3J5KSBpdCdzIGEgdmFsaWQgb25lLWhvcCBwaXBlIHNvdXJjZVxuICAgICAgICAgIC8vIGZvciBhIGRvd25zdHJlYW0gbGluZS1zZWxlY3Rvciwgc2FtZSBhcyBgY2F0YC9gbmxgLlxuICAgICAgICAgIGlmIChvdXRjb21lLmlkaW9tID09PSAnZ2l0LXNob3ctcmV2LXBhdGgnICYmICFsb29rc1VucmVzb2x2YWJsZShvdXRjb21lLmZpbGVBcmcpKSB7XG4gICAgICAgICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgICAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSByZXNvbHZlUGF0aChvdXRjb21lLmRpck92ZXJyaWRlID8/IGN1cnJlbnREaXIsIG91dGNvbWUuZmlsZUFyZyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFtYXRjaGVkICYmIHNpbXBsZS5wcmVjZWRlZEJ5ID09PSAnfCcgJiYgbGFzdFBsYWluRmlsZVNvdXJjZSkge1xuICAgICAgY29uc3Qgd2l0aEZpbGUgPSBbLi4uYXJndiwgbGFzdFBsYWluRmlsZVNvdXJjZV07XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgTElORV9TRUxFQ1RPUlMpIHtcbiAgICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIod2l0aEZpbGUpKSB7XG4gICAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ2NhbmRpZGF0ZScpIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgY3VycmVudERpcik7XG4gICAgICAgICAgZWxzZVxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgICAgIGlkaW9tOiBvdXRjb21lLmlkaW9tLFxuICAgICAgICAgICAgICBmaWxlQXJnOiBvdXRjb21lLmZpbGVBcmcsXG4gICAgICAgICAgICAgIHJlYXNvbjogb3V0Y29tZS5yZWFzb25cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc1BsYWluU291cmNlKSBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgfVxuXG4gIHJldHVybiByZXN1bHRzO1xufVxuXG4vKiogUGFyc2VzIGEgQmFzaCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGUrbGluZS1yYW5nZSBzcGFucyBpdCBzdGF0aWNhbGx5LCByZWxpYWJseSByZWFkcyBvciB3cml0ZXMuIGBjd2RgIGRlZmF1bHRzIHRvIGBwcm9jZXNzLmN3ZCgpYCBcdTIwMTQgcGFzcyB0aGUgaG9vaydzIG93biBgY3dkYCBmaWVsZCBmb3IgY29ycmVjdCByZXNvbHV0aW9uIG9mIHJlbGF0aXZlIHBhdGhzIGFuZCBgY2RgL2BnaXQgLUNgIHRhcmdldHMsIGFuZCBvZiBgZ2l0IHNob3dgL2BnaXQgbG9nIC1MYCByZXZpc2lvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kKGNvbW1hbmQ6IHN0cmluZywgY3dkOiBzdHJpbmcgPSBwcm9jZXNzLmN3ZCgpKTogUmVzb2x2ZWRTcGFuW10ge1xuICBjb25zdCBkZXRhaWxlZCA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIGN3ZCk7XG4gIGNvbnN0IHNwYW5zOiBSZXNvbHZlZFNwYW5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgZGV0YWlsZWQpIHtcbiAgICBpZiAobS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpIHNwYW5zLnB1c2gobS5zcGFuKTtcbiAgfVxuICByZXR1cm4gc3BhbnM7XG59XG4iLCAiLyoqXG4gKiBUaGUgb25seSBpbXB1cmUgYml0czogY291bnRpbmcgbGluZXMgb2YgYSB3b3JraW5nLXRyZWUgZmlsZSwgYW5kIG9mIGEgZmlsZVxuICogYXMgaXQgZXhpc3RlZCBhdCBhIGdpdmVuIGdpdCByZXZpc2lvbi4gQm90aCByZXR1cm4gbnVsbCBvbiBhbnkgZmFpbHVyZVxuICogKG1pc3NpbmcgZmlsZSwgYmFkIHJldiwgbm90IGEgZ2l0IHJlcG8sIGV0Yy4pIGluc3RlYWQgb2YgdGhyb3dpbmcgXHUyMDE0IGFcbiAqIGNvbW1hbmQgdGhhdCBzdGF0aWNhbGx5IG1hdGNoZWQgYW4gaWRpb20gYnV0IHBvaW50cyBhdCBzb21ldGhpbmcgdGhpc1xuICogbWFjaGluZSBjYW4ndCBjdXJyZW50bHkgcmVzb2x2ZSBpcyBhIG5vcm1hbCwgZXhwZWN0ZWQgb3V0Y29tZSwgbm90IGEgYnVnLlxuICovXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGEgd29ya2luZy10cmVlIGZpbGUsIG9yIG51bGwgaWYgaXQgY2FuJ3QgYmUgcmVhZC4gVHJhaWxpbmcgbmV3bGluZSBkb2VzIG5vdCBjb3VudCBhcyBhbiBleHRyYSBlbXB0eSBsaW5lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgaWYgKCFzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRmlsZSgpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgICBpZiAoY29udGVudC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBjb250ZW50LmVuZHNXaXRoKCdcXG4nKSA/IGNvbnRlbnQuc2xpY2UoMCwgLTEpIDogY29udGVudDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGBwYXRoYCBhcyBpdCBleGlzdHMgYXQgYHJldmAsIHJ1biBmcm9tIGBjd2RgLCBvciBudWxsIGlmIHRoZSByZXYvcGF0aC9yZXBvIGRvZXNuJ3QgcmVzb2x2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEdpdEJsb2JMaW5lcyhjd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzaG93JywgYCR7cmV2fToke3BhdGh9YF0sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIGlmIChvdXQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gb3V0LmVuZHNXaXRoKCdcXG4nKSA/IG91dC5zbGljZSgwLCAtMSkgOiBvdXQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICIvKipcbiAqIEhldXJpc3RpYywgZGVwZW5kZW5jeS1mcmVlIHNoZWxsIHNwbGl0dGluZy4gTm90IGEgZnVsbCBzaGVsbCBwYXJzZXIgXHUyMDE0IGdvb2RcbiAqIGVub3VnaCB0byBsb2NhdGUgc2ltcGxlIGNvbW1hbmRzIChhbmQgdGhlaXIgYXJndikgaW5zaWRlIGEgbGFyZ2VyXG4gKiAmJi98fC87L3wtam9pbmVkIEJhc2ggc3RyaW5nIHdpdGhvdXQgcHVsbGluZyBpbiBhIHJlYWwgYmFzaCBBU1QgcGFyc2VyLlxuICogVmFsaWRhdGVkIGR1cmluZyByZXNlYXJjaCBhZ2FpbnN0IGJhc2hsZXggb24gdGhlIHJlYWwgdHJhbnNjcmlwdCBjb3JwdXM7XG4gKiB0aGlzIHBvcnRzIHRoZSBzYW1lIGFsZ29yaXRobS5cbiAqL1xuXG4vKiogT25lIGBzaW1wbGUgY29tbWFuZGAgZm91bmQgaW4gYSBsYXJnZXIgc2NyaXB0LCBwbHVzIHdoaWNoIG9wZXJhdG9yIHByZWNlZGVkIGl0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTaW1wbGVDb21tYW5kIHtcbiAgdGV4dDogc3RyaW5nO1xuICAvKiogVGhlIG9wZXJhdG9yIGltbWVkaWF0ZWx5IGJlZm9yZSB0aGlzIGNvbW1hbmQgKCd8JyBmb3IgYSBwaXBlbGluZSBzdGFnZSwgb3RoZXJ3aXNlICcmJicvJzsnLydcXG4nL2V0Yy4sIG9yICdzdGFydCcgZm9yIHRoZSBmaXJzdCBjb21tYW5kKS4gKi9cbiAgcHJlY2VkZWRCeTogJ3wnIHwgJ290aGVyJyB8ICdzdGFydCc7XG59XG5cbi8qKiBTcGxpdCBhIGNvbW1hbmQgc3RyaW5nIGludG8gc2ltcGxlLWNvbW1hbmQgc3Vic3RyaW5ncyBhdCB0b3AtbGV2ZWwgJiYsIHx8LCA7LCB8LCB8JiwgYW5kIG5ld2xpbmUgYm91bmRhcmllcy4gUXVvdGVzIGFuZCAkKCkvYGAvKCkgbmVzdGluZyBhcmUgcmVzcGVjdGVkIChub3Qgc3BsaXQgaW5zaWRlKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzcGxpdFRvcExldmVsKGNtZDogc3RyaW5nKTogU2ltcGxlQ29tbWFuZFtdIHtcbiAgY29uc3QgcGFydHM6IFNpbXBsZUNvbW1hbmRbXSA9IFtdO1xuICBsZXQgYnVmID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IGNtZC5sZW5ndGg7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgbGV0IHBlbmRpbmdPcDogU2ltcGxlQ29tbWFuZFsncHJlY2VkZWRCeSddID0gJ3N0YXJ0JztcblxuICBjb25zdCBmbHVzaCA9IChuZXh0T3A6IFNpbXBsZUNvbW1hbmRbJ3ByZWNlZGVkQnknXSkgPT4ge1xuICAgIGNvbnN0IHMgPSBidWYudHJpbSgpO1xuICAgIGlmIChzKSBwYXJ0cy5wdXNoKHsgdGV4dDogcywgcHJlY2VkZWRCeTogcGVuZGluZ09wIH0pO1xuICAgIGJ1ZiA9ICcnO1xuICAgIHBlbmRpbmdPcCA9IG5leHRPcDtcbiAgfTtcblxuICAvKipcbiAgICogV2hldGhlciB0aGUgb3BlcmF0b3IgY3VycmVudGx5IHBlbmRpbmcgaXMgYSBwaXBlIChgfGAvYHwmYCkuIEEgaGVscGVyXG4gICAqIHJhdGhlciB0aGFuIGFuIGlubGluZSBjb21wYXJpc29uOiBUeXBlU2NyaXB0J3MgY29udHJvbC1mbG93IG5hcnJvd2luZ1xuICAgKiBjYW5ub3Qgc2VlIHRoZSBhc3NpZ25tZW50cyBgZmx1c2hgIG1ha2VzIHRvIGBwZW5kaW5nT3BgIGZyb20gaW5zaWRlIGl0c1xuICAgKiBjbG9zdXJlLCBhbmQgd291bGQgb3RoZXJ3aXNlIG5hcnJvdyB0aGUgZGlyZWN0IGNvbXBhcmlzb24gdG8gdGhlXG4gICAqIGluaXRpYWxpemVyIGAnc3RhcnQnYC5cbiAgICovXG4gIGNvbnN0IGlzUGVuZGluZ1BpcGUgPSAoKTogYm9vbGVhbiA9PiBwZW5kaW5nT3AgPT09ICd8JztcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gY21kW2ldO1xuICAgIGlmIChpblNxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gXCInXCIpIGluU3F1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRHF1b3RlKSB7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICAgIGJ1ZiArPSBjbWRbaSArIDFdO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIGluRHF1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBpblNxdW90ZSA9IHRydWU7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGJ1ZiArPSBjICsgY21kW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBkZXB0aCArPSAxO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgZGVwdGggPSBNYXRoLm1heCgwLCBkZXB0aCAtIDEpO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJyYmJykge1xuICAgICAgICBmbHVzaCgnb3RoZXInKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfHwnKSB7XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8JicpIHtcbiAgICAgICAgZmx1c2goJ3wnKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ3wnKSB7XG4gICAgICAgIGZsdXNoKCd8Jyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgICAgLy8gQSBuZXdsaW5lIGltbWVkaWF0ZWx5IGFmdGVyIGEgcGlwZSBvcGVyYXRvciBpcyBhIGxpbmUgY29udGludWF0aW9uXG4gICAgICAgIC8vIChgY2F0IGEudHh0IHxcXG5zZWQgLi4uYCBrZWVwcyB0aGUgcGlwZWxpbmUpLCBub3QgYSBzdGF0ZW1lbnRcbiAgICAgICAgLy8gc2VwYXJhdG9yOiBza2lwcGluZyBpdCBwcmVzZXJ2ZXMgYHByZWNlZGVkQnk6ICd8J2AgZm9yIHRoZSBuZXh0XG4gICAgICAgIC8vIHN0YWdlIGluc3RlYWQgb2YgZGVncmFkaW5nIGl0IHRvICdvdGhlcicuXG4gICAgICAgIGlmIChpc1BlbmRpbmdQaXBlKCkpIHtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBidWYgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgZmx1c2goJ290aGVyJyk7XG4gIHJldHVybiBwYXJ0cztcbn1cblxuY29uc3QgTEVBRElOR19BU1NJR05NRU5UID0gL14oPzpbQS1aYS16X11bQS1aYS16MC05X10qPVxcUypcXHMrKSsvO1xuXG4vKiogU3RyaXAgbGVhZGluZyBGT089YmFyIFZBUj1iYXogZW52LXByZWZpeCBhc3NpZ25tZW50cyBmcm9tIGEgc2ltcGxlIGNvbW1hbmQuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2ltcGxlQ21kLnJlcGxhY2UoTEVBRElOR19BU1NJR05NRU5ULCAnJyk7XG59XG5cbi8qKiBRdW90ZS1hd2FyZSB3aGl0ZXNwYWNlIHRva2VuaXplciwgcm91Z2hseSBtYXRjaGluZyBgc2hsZXguc3BsaXQocywgcG9zaXg9VHJ1ZSlgLiBSZXR1cm5zIG51bGwgb24gdW5iYWxhbmNlZCBxdW90ZXMuICovXG5leHBvcnQgZnVuY3Rpb24gc3BsaXRXb3JkcyhzOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBjb25zdCB3b3Jkczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1ciA9ICcnO1xuICBsZXQgaGFzID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHMubGVuZ3RoO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBzW2ldO1xuICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7XG4gICAgICBpZiAoaGFzKSB7XG4gICAgICAgIHdvcmRzLnB1c2goY3VyKTtcbiAgICAgICAgY3VyID0gJyc7XG4gICAgICAgIGhhcyA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnN0IGVuZCA9IHMuaW5kZXhPZihcIidcIiwgaSk7XG4gICAgICBpZiAoZW5kID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBjdXIgKz0gcy5zbGljZShpLCBlbmQpO1xuICAgICAgaSA9IGVuZCArIDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgc1tpXSAhPT0gJ1wiJykge1xuICAgICAgICBpZiAoc1tpXSA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHNbaSArIDFdKSkge1xuICAgICAgICAgIGN1ciArPSBzW2kgKyAxXTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3VyICs9IHNbaV07XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoaSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGN1ciArPSBzW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBoYXMgPSB0cnVlO1xuICAgIGN1ciArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICBpZiAoaGFzKSB3b3Jkcy5wdXNoKGN1cik7XG4gIHJldHVybiB3b3Jkcztcbn1cblxuLyoqIEJlc3QtZWZmb3J0IGFyZ3YgZm9yIGEgc2ltcGxlIGNvbW1hbmQ6IGxlYWRpbmcgYXNzaWdubWVudHMgc3RyaXBwZWQsIHF1b3RlLWF3YXJlIHNwbGl0LiBSZXR1cm5zIG51bGwgaWYgdGhlIGNvbW1hbmQgZG9lc24ndCB0b2tlbml6ZSBjbGVhbmx5ICh1bmJhbGFuY2VkIHF1b3RlcykuICovXG5leHBvcnQgZnVuY3Rpb24gYXJndk9mKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgcmV0dXJuIHNwbGl0V29yZHMoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kKS50cmltKCkpO1xufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBzcGFuLXN1cmZhY2luZyBjb3JlLlxuICpcbiAqIEdpdmVuIGFuIGFscmVhZHktcmVzb2x2ZWQgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCBhIGxpbmUgcmFuZ2UsIHRoaXMgbW9kdWxlXG4gKiBydW5zIHRoZSBzaGFyZWQgYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW5gIC8gYC5ob29raWdub3JlYCAvIHNlc3Npb24tbWVtbyAvXG4gKiBgZ2l0IHNwYW4gZHJpZnRgIHBpcGVsaW5lIGFuZCBhc3NlbWJsZXMgdGhlIGh1bWFuLXJlYWRhYmxlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gXG4gKiBibG9jayB0aGF0IGJvdGggYWRhcHRlcnMgc3VyZmFjZSBpbmxpbmUgYmVmb3JlIGFuIGVkaXQuIEl0IGltcG9ydHMgbm90aGluZ1xuICogZnJvbSBlaXRoZXIgaG9vayBTREs6IHRoZSBDbGF1ZGUgUHJlVG9vbFVzZSBob29rIGZlZWRzIGl0IGEgcmFuZ2UgZGVyaXZlZCBmcm9tXG4gKiBgZmlsZV9wYXRoYC9gb2Zmc2V0YC9gb2xkX3N0cmluZ2A7IHRoZSBDb2RleCBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgdGhlXG4gKiByYW5nZXMgcmVjb3ZlcmVkIGZyb20gYW4gYGFwcGx5X3BhdGNoYCBlbnZlbG9wZS4gRWFjaCBhZGFwdGVyIHdyYXBzIHRoZVxuICogcmV0dXJuZWQgYmxvY2sgc3RyaW5nIGluIGl0cyBvd24gU0RLIG91dHB1dCBidWlsZGVyLlxuICpcbiAqIFRoZSBleGVjdXRvci9kcmlmdC9tZW1vIGRlcGVuZGVuY2llcyBhcmUgaW5qZWN0ZWQgc28gdGhlIHBpcGVsaW5lIGlzIHRlc3RhYmxlXG4gKiB3aXRoIGZha2VzIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlIHNoYXJlZCBrZXJuZWwuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7XG4gIGlzR2l0SWdub3JlZCxcbiAgaXNJbnNpZGVTcGFuUm9vdCxcbiAgdHlwZSBMaW5lUmFuZ2UsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcHJ1bmVTdGFsZVNlc3Npb25zLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdCxcbiAgc2Vzc2lvbkRpcixcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyB0eXBlIEhvb2tJZ25vcmVMb2FkZXIsIGlzU3BhblN1cHByZXNzZWQgfSBmcm9tICcuL3NwYW4taWdub3JlLmpzJztcblxuLyoqXG4gKiBNaW5pbWFsIGxvZ2dlciBzdXJmYWNlIHRoZSBgY29tbW9uL2AgbGF5ZXIgbG9ncyB0aHJvdWdoOyBib3RoIFNESyBsb2dnZXJzXG4gKiBzYXRpc2Z5IGl0LiBgd2FybmAgaXMgcmVxdWlyZWQgXHUyMDE0IGV2ZXJ5IGV4aXN0aW5nIGNhbGwgc2l0ZSByZXBvcnRzIGEgZmFpbHVyZS5cbiAqIGBpbmZvYCBpcyBvcHRpb25hbCBzbyBhIGZha2UgY2Fycnlpbmcgb25seSBgd2FybmAgc3RpbGwgc2F0aXNmaWVzIHRoZVxuICogaW50ZXJmYWNlOiBpdCBleGlzdHMgZm9yIHRoZSBkaWFnbm9zdGljIGJyZWFkY3J1bWJzIGEgKnN1Y2Nlc3NmdWwqIHJ1biBsZWF2ZXNcbiAqIGJlaGluZCAoYWR2aXNvci1jb3JlJ3MgY2h1cm4tc3VwcHJlc3Npb24gY291bnQpLCB3aGljaCBhcmUgbm90IHdhcm5pbmdzIGFuZFxuICogbXVzdCBub3QgcmVhZCBhcyBmYWlsdXJlcyBpbiB0aGUgaG9vayBsb2cuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29yZUxvZ2dlciB7XG4gIHdhcm4obWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkO1xuICBpbmZvPyhtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3BhbiBleGVjdXRvciBhYnN0cmFjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRXhlY3V0ZXMgYGdpdCBzcGFuIGxpc3RgIHdpdGggZ2l2ZW4gYXJncyBpbiBhIGdpdmVuIGN3ZC5cbiAqIFJldHVybnMgc3Rkb3V0IHN0cmluZy4gVGhyb3dzIG9uIG5vbi16ZXJvIGV4aXQuXG4gKi9cbmV4cG9ydCB0eXBlIFNwYW5FeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRTcGFuRXhlY3V0b3IodGltZW91dE1zID0gMTBfMDAwKTogU3BhbkV4ZWN1dG9yIHtcbiAgcmV0dXJuIChhcmdzLCBjd2QpID0+IHtcbiAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsIC4uLmFyZ3NdLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gIH07XG59XG5cbi8qKlxuICogUnVucyBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluIDxzbHVncz5gIGFuZCByZXR1cm5zIGl0cyBwb3JjZWxhaW4gc3Rkb3V0IFx1MjAxNFxuICogb25lIHJvdyBwZXIgKmRyaWZ0ZWQqIGFuY2hvciBhbW9uZyB0aGUgZ2l2ZW4gc3BhbnMsIGVtcHR5IHdoZW4gYWxsIGFyZSBjbGVhbi5cbiAqIGBnaXQgc3BhbiBkcmlmdGAgZXhpdHMgMCBpbiBwb3JjZWxhaW4gbW9kZSB3aGV0aGVyIG9yIG5vdCBkcmlmdCBleGlzdHMsIGJ1dCB3ZVxuICogc3RpbGwgY2FwdHVyZSBzdGRvdXQgZnJvbSBhIHRocm93biBlcnJvciBzbyBhIGRyaWZ0IHNpZ25hbCBpcyBuZXZlciBsb3N0IHRvIGFcbiAqIG5vbi16ZXJvIGV4aXQuIFRocm93cyBvbmx5IHdoZW4gbm8gc3Rkb3V0IGlzIGF2YWlsYWJsZSAoZ2VudWluZSBmYWlsdXJlKS5cbiAqL1xuZXhwb3J0IHR5cGUgRHJpZnRFeGVjdXRvciA9IChzbHVnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBzdHJpbmc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0RHJpZnRFeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBEcmlmdEV4ZWN1dG9yIHtcbiAgcmV0dXJuIChzbHVncywgY3dkKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zbHVnc10sIHtcbiAgICAgICAgY3dkLFxuICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgIGlmICh0eXBlb2Ygb3V0ID09PSAnc3RyaW5nJykgcmV0dXJuIG91dDtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBtZW1vIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBNZW1vU3RvcmUge1xuICBnZXRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZyk6IFNldDxzdHJpbmc+O1xuICBhZGRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZywgbmFtZXM6IHN0cmluZ1tdKTogdm9pZDtcbn1cblxuLy8gTGl2ZXMgdW5kZXIgdGhlIHNoYXJlZCBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgKGFnZW50LWhvb2tzLWNvbW1vbi50cydzXG4vLyBzZXNzaW9uRGlyKSBcdTIwMTQgcmVsb2NhdGVkIGZyb20gb3MudG1wZGlyKCkvYWdlbnQtaG9va3MtZ2l0LXNwYW4vIHNvXG4vLyBwZXItc2Vzc2lvbiBzdGF0ZSBoYXMgb25lIGhvbWUgYW5kIGlzIGNvdmVyZWQgYnkgcHJ1bmVTdGFsZVNlc3Npb25zJ3Ncbi8vIG9wcG9ydHVuaXN0aWMgPjMwLWRheSBwcnVuaW5nLlxuZnVuY3Rpb24gbWVtb0ZpbGVQYXRoKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oc2Vzc2lvbkRpcihzZXNzaW9uSWQpLCAndG91Y2gtbWVtby5qc29uJyk7XG59XG5cbmV4cG9ydCB0eXBlIE1lbW9Mb2dnZXIgPSBDb3JlTG9nZ2VyO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4ge1xuICAgIGdldFN1cmZhY2VkKHNlc3Npb25JZCkge1xuICAgICAgcHJ1bmVTdGFsZVNlc3Npb25zKCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByYXcgPSBmcy5yZWFkRmlsZVN5bmMobWVtb0ZpbGVQYXRoKHNlc3Npb25JZCksICd1dGY4Jyk7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KSBhcyB7IHN1cmZhY2VkPzogdW5rbm93biB9O1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQuc3VyZmFjZWQpKSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBTZXQocGFyc2VkLnN1cmZhY2VkIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHJlYWQgZmFpbGVkICh0cmVhdGluZyBhcyBlbXB0eSknLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgU2V0KCk7XG4gICAgfSxcbiAgICBhZGRTdXJmYWNlZChzZXNzaW9uSWQsIG5hbWVzKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICAgICAgZm9yIChjb25zdCBuIG9mIG5hbWVzKSBleGlzdGluZy5hZGQobik7XG4gICAgICBjb25zdCBtZW1vRGlyID0gc2Vzc2lvbkRpcihzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgbWVtb1BhdGggPSBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKTtcbiAgICAgIGNvbnN0IHRtcFBhdGggPSBgJHttZW1vUGF0aH0udG1wYDtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZzLm1rZGlyU3luYyhtZW1vRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBKU09OLnN0cmluZ2lmeSh7IHN1cmZhY2VkOiBbLi4uZXhpc3RpbmddIH0pLCAndXRmOCcpO1xuICAgICAgICBmcy5yZW5hbWVTeW5jKHRtcFBhdGgsIG1lbW9QYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyB3cml0ZSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKiBGYWN0b3J5IGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyBhIE1lbW9TdG9yZSBnaXZlbiBhIGxvZ2dlci4gKi9cbmV4cG9ydCB0eXBlIE1lbW9GYWN0b3J5ID0gKGxvZ2dlcjogTWVtb0xvZ2dlcikgPT4gTWVtb1N0b3JlO1xuXG4vKiogRGVmYXVsdCBkaXNrLWJhY2tlZCBtZW1vIGZhY3RvcnkgdXNlZCBpbiBwcm9kdWN0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2tNZW1vRmFjdG9yeShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXIpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIHNjb3BlIHJlc29sdXRpb24gKHJlcG8tc2NvcGluZyArIGdpdGlnbm9yZSArIHNwYW4tcm9vdCBndWFyZHMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBUb3VjaFNjb3BlIHtcbiAgcmVwb1Jvb3Q6IHN0cmluZztcbiAgcmVwb1JlbFBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCb3VuZCBhIHRvdWNoZWQgZmlsZSB0byB0aGUgQ1dEIHJlcG8uIFJlc29sdmUgdGhlIHJlcG8gcm9vdCBvZiB0aGUgY3VycmVudFxuICogd29ya2luZyBkaXJlY3RvcnkgYW5kIHJlcXVpcmUgdGhlIHRvdWNoZWQgZmlsZSB0byByZXNvbHZlIHRvIHRoZSBTQU1FIHJlcG9cbiAqIHJvb3Q7IGRyb3AgZmlsZXMgaW4gYSBkaWZmZXJlbnQgcmVwb3NpdG9yeS93b3JrdHJlZSwgZ2l0aWdub3JlZCBmaWxlcywgYW5kXG4gKiBmaWxlcyB1bmRlciB0aGUgc3BhbiByb290LiBSZXR1cm5zIHRoZSByZXNvbHZlZCBgeyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfWBcbiAqIG9yIG51bGwgd2hlbiB0aGUgdG91Y2ggaXMgb3V0IG9mIHNjb3BlLlxuICpcbiAqIENvbXBhcmluZyByZXNvbHZlZCBgZ2l0IC0tc2hvdy10b3BsZXZlbGAgdG9wbGV2ZWxzIChub3QgcGF0aCBwcmVmaXhlcylcbiAqIGRpc3Rpbmd1aXNoZXMgc2VwYXJhdGUgcmVwb3MgYW5kIHdvcmt0cmVlcyBhbmQgaXMgcm9idXN0IHRvIHN5bWxpbmtzLiBGYWlsXG4gKiBjbG9zZWQ6IGlmIHRoZSBDV0QgcmVwbyBjYW4ndCBiZSByZXNvbHZlZCwgdGhlIHRvdWNoIGlzIGRyb3BwZWQgcmF0aGVyIHRoYW5cbiAqIGZhbGxpbmcgYmFjayB0byB0aGUgZmlsZSdzIG93biByZXBvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IFRvdWNoU2NvcGUgfCBudWxsIHtcbiAgY29uc3QgY3dkUmVwb1Jvb3QgPSBjd2QgPyByZXNvbHZlUmVwb1Jvb3QoY3dkKSA6IG51bGw7XG4gIGlmICghY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFic0RpciA9IHRvUG9zaXgobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSk7XG4gIGNvbnN0IGZpbGVSZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChhYnNEaXIpO1xuICBpZiAoZmlsZVJlcG9Sb290ICE9PSBjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgcmVwb1Jvb3QgPSBjd2RSZXBvUm9vdDtcbiAgY29uc3QgcmVwb1JlbFBhdGggPSByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYWJzUGF0aCk7XG5cbiAgLy8gU2tpcCBnaXRpZ25vcmVkIGZpbGVzIGVudGlyZWx5LiBCdWlsZCBvdXRwdXQsIGNhY2hlcywgYW5kIGxvZ3MgYXJlIG5vdFxuICAvLyBzcGFuLXJlbGV2YW50OiB0aGV5IG11c3QgbmV2ZXIgc3VyZmFjZSBzcGFuIG92ZXJsYXBzLlxuICBpZiAoaXNHaXRJZ25vcmVkKHJlcG9Sb290LCByZXBvUmVsUGF0aCkpIHJldHVybiBudWxsO1xuXG4gIC8vIFNraXAgc3BhbiBkb2N1bWVudHMgZW50aXJlbHkuIEZpbGVzIHVuZGVyIHRoZSByZXNvbHZlZCBzcGFuIHJvb3QgYXJlIG1hbmFnZWRcbiAgLy8gYnkgZ2l0IHNwYW4gaXRzZWxmIGFuZCBhcmUgbm90IGFwcGxpY2F0aW9uIHNvdXJjZXMgdGhhdCBuZWVkIHNwYW4gY292ZXJhZ2UuXG4gIGNvbnN0IHNwYW5Sb290ID0gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KTtcbiAgaWYgKGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGgsIHNwYW5Sb290KSkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHsgcmVwb1Jvb3QsIHJlcG9SZWxQYXRoIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3VyZmFjZSByb3V0aW5lXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEluamVjdGVkIGRlcGVuZGVuY2llcyBmb3Ige0BsaW5rIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zfS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3VyZmFjZURlcHMge1xuICBleGVjdXRvcjogU3BhbkV4ZWN1dG9yO1xuICBkcmlmdEV4ZWN1dG9yOiBEcmlmdEV4ZWN1dG9yO1xuICBtZW1vOiBNZW1vU3RvcmU7XG4gIGxvYWRSdWxlczogSG9va0lnbm9yZUxvYWRlcjtcbiAgbG9nZ2VyOiBDb3JlTG9nZ2VyO1xufVxuXG4vKipcbiAqIEdpdmVuIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCB0aGUgbGluZSByYW5nZSBiZWluZyB0b3VjaGVkIHdpdGhpbiBhblxuICogYWxyZWFkeS1yZXNvbHZlZCByZXBvLCBwcm9kdWNlIHRoZSBgPGdpdC1zcGFuPlx1MjAyNjwvZ2l0LXNwYW4+YCBibG9jayBmb3IgdGhlXG4gKiBzcGFucyBvdmVybGFwcGluZyB0aGF0IHJhbmdlLCBvciBudWxsIHdoZW4gdGhlcmUgaXMgbm90aGluZyB0byBzdXJmYWNlLlxuICpcbiAqIFRoZSBwaXBlbGluZTogYGdpdCBzcGFuIGxpc3QgPHBhdGg+IC0tcG9yY2VsYWluYCBcdTIxOTIga2VlcCBsaW5lLXJhbmdlZCBhbmNob3JzIG9uXG4gKiB0aGUgc2FtZSBmaWxlIHRoYXQgaW50ZXJzZWN0IHRoZSByYW5nZSBhbmQgYXJlIG5vdCBgLmhvb2tpZ25vcmVgLXN1cHByZXNzZWQgXHUyMTkyXG4gKiBkcm9wIHNsdWdzIGFscmVhZHkgc3VyZmFjZWQgdGhpcyBzZXNzaW9uIChtZW1vKSBcdTIxOTIgcmVuZGVyIGBnaXQgc3BhbiBsaXN0XG4gKiA8bmFtZXNcdTIwMjY+YCBcdTIxOTIgYXBwZW5kIGEgYGdpdCBzcGFuIGhpc3RvcnkgPG5hbWU+YCBwb2ludGVyIGZvciBhbnkgYWxyZWFkeS1kcmlmdGVkXG4gKiBzcGFuLiBPbiBzdWNjZXNzIHRoZSBzdXJmYWNlZCBuYW1lcyBhcmUgcmVjb3JkZWQgaW4gdGhlIG1lbW8uIEV4ZWN1dG9yIGFuZFxuICogZHJpZnQtcHJvYmUgZmFpbHVyZXMgYXJlIGxvZ2dlZCBhbmQgZGVncmFkZSB0byBudWxsIC8gdGhlIHBsYWluIGJsb2NrOyB0aGV5XG4gKiBuZXZlciB0aHJvdy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zKFxuICBkZXBzOiBTdXJmYWNlRGVwcyxcbiAgcmVwb1Jvb3Q6IHN0cmluZyxcbiAgcmVwb1JlbFBhdGg6IHN0cmluZyxcbiAgcmFuZ2U6IExpbmVSYW5nZSxcbiAgc2Vzc2lvbklkOiBzdHJpbmdcbik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCB7IGV4ZWN1dG9yLCBkcmlmdEV4ZWN1dG9yLCBtZW1vLCBsb2FkUnVsZXMsIGxvZ2dlciB9ID0gZGVwcztcblxuICAvLyBGaWx0ZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5cbiAgbGV0IHBvcmNlbGFpblN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHBvcmNlbGFpblN0ZG91dCA9IGV4ZWN1dG9yKFsnLS1wb3JjZWxhaW4nLCByZXBvUmVsUGF0aF0sIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBQYXRoLXNjb3BlZCBzdXBwcmVzc2lvbjogYSByZXBvJ3MgLnNwYW4vLmhvb2tpZ25vcmUgY2FuIGhvbGQgYmFjayBzcGFuIHNsdWdcbiAgLy8gcHJlZml4ZXMgZm9yIGFuY2hvcnMgdW5kZXIgZ2l2ZW4gcGF0aHMuIEEgc3VwcHJlc3NlZCBzcGFuIGlzIG5ldmVyIHN1cmZhY2VkLlxuICBjb25zdCBpZ25vcmVSdWxlcyA9IGxvYWRSdWxlcyhyZXBvUm9vdCk7XG5cbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBwYXJzZVBvcmNlbGFpbihwb3JjZWxhaW5TdGRvdXQpO1xuICBjb25zdCBjYW5kaWRhdGVOYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgaWYgKHJvdy5wYXRoICE9PSByZXBvUmVsUGF0aCkgY29udGludWU7XG4gICAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSBjb250aW51ZTsgLy8gd2hvbGUtZmlsZSBhbmNob3JcbiAgICBpZiAoIXJhbmdlc0ludGVyc2VjdChyYW5nZSwgeyBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfSkpIGNvbnRpbnVlO1xuICAgIGlmIChpc1NwYW5TdXBwcmVzc2VkKGlnbm9yZVJ1bGVzLCByb3cucGF0aCwgcm93Lm5hbWUpKSBjb250aW51ZTtcbiAgICBjYW5kaWRhdGVOYW1lcy5hZGQocm93Lm5hbWUpO1xuICB9XG5cbiAgaWYgKGNhbmRpZGF0ZU5hbWVzLnNpemUgPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFN1YnRyYWN0IGFscmVhZHktc3VyZmFjZWQgbmFtZXNcbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gIGNvbnN0IHRvU3VyZmFjZSA9IFsuLi5jYW5kaWRhdGVOYW1lc10uZmlsdGVyKChuKSA9PiAhc3VyZmFjZWQuaGFzKG4pKS5zb3J0KCk7XG4gIGlmICh0b1N1cmZhY2UubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBSZW5kZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8bmFtZTE+IDxuYW1lMj4gLi4uXG4gIGxldCByZW5kZXJTdGRvdXQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICByZW5kZXJTdGRvdXQgPSBleGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgKHJlbmRlcikgZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBPZiB0aGUgc3BhbnMgYmVpbmcgc3VyZmFjZWQsIGZsYWcgYW55IGFscmVhZHkgZHJpZnRlZCBcdTIwMTQgdGhlIHRvdWNoZWQgbGluZXMgaGF2ZVxuICAvLyBkcmlmdGVkIGZyb20gdGhlaXIgYW5jaG9yZWQgc3RhdGUgXHUyMDE0IHdpdGggYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIuXG4gIC8vIERldGVjdGlvbiBpcyBhcy1vZi1ub3cgKHN1cmZhY2luZyBydW5zIGJlZm9yZSB0aGUgZWRpdCBhcHBsaWVzKSwgc28gdGhpc1xuICAvLyBjYXRjaGVzIHByZS1leGlzdGluZyBkcmlmdDsgZHJpZnQgdGhpcyBzZXNzaW9uIGNhdXNlcyBpcyB0aGUgU3RvcCBob29rJ3Mgam9iLlxuICAvLyBGYWlsdXJlIHRvIGNvbXB1dGUgZHJpZnQgaXMgbm9uLWZhdGFsOiBmYWxsIGJhY2sgdG8gdGhlIHBsYWluIGJsb2NrLlxuICBsZXQgZHJpZnRIaW50ID0gJyc7XG4gIHRyeSB7XG4gICAgY29uc3QgZHJpZnROYW1lcyA9IG5ldyBTZXQocGFyc2VEcmlmdFBvcmNlbGFpbihkcmlmdEV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpKS5tYXAoKHIpID0+IHIubmFtZSkpO1xuICAgIGNvbnN0IGRyaWZ0U3VyZmFjZWQgPSB0b1N1cmZhY2UuZmlsdGVyKChuKSA9PiBkcmlmdE5hbWVzLmhhcyhuKSk7XG4gICAgaWYgKGRyaWZ0U3VyZmFjZWQubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbGluZXMgPSBkcmlmdFN1cmZhY2VkLm1hcCgobikgPT4gYCAgZ2l0IHNwYW4gaGlzdG9yeSAke259YCkuam9pbignXFxuJyk7XG4gICAgICBkcmlmdEhpbnQgPSBgXFxuRHJpZnQgXHUyMDE0IHRoZSBsaW5lcyB5b3UncmUgdG91Y2hpbmcgaGF2ZSBkcmlmdGVkIGZyb20gdGhlc2Ugc3BhbnMnIGFuY2hvcmVkIHN0YXRlLiBSZXZpZXcgaG93IGVhY2ggc3Vic3lzdGVtIGV2b2x2ZWQgYmVmb3JlIGNoYW5naW5nIGl0OlxcbiR7bGluZXN9YDtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBkcmlmdCAoaGlzdG9yeSBoaW50KSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgfVxuXG4gIGNvbnN0IHdyYXBwZWQgPSBgXFxuPGdpdC1zcGFuPlxcbiR7cmVuZGVyU3Rkb3V0fSR7ZHJpZnRIaW50fVxcbjwvZ2l0LXNwYW4+XFxuYDtcblxuICAvLyBVcGRhdGUgbWVtb1xuICBtZW1vLmFkZFN1cmZhY2VkKHNlc3Npb25JZCwgdG9TdXJmYWNlKTtcblxuICByZXR1cm4gd3JhcHBlZDtcbn1cbiIsICIvKipcbiAqIFBhdGgtc2NvcGVkIHNwYW4gc3VwcHJlc3Npb24gZm9yIHRoZSBhZ2VudCBob29rcy5cbiAqXG4gKiBTb21lIHNwYW5zIGFyZSBub2lzZSB3aGVuIGJyb3dzaW5nIGNlcnRhaW4gcGFydHMgb2YgdGhlIHRyZWUgXHUyMDE0IHdpa2kgb3JcbiAqIG1hcmtldGluZyBzcGFucyB0aGF0IGFuY2hvciBwcm9zZSwgc3VyZmFjZWQgaW5saW5lIHdoaWxlIHJlYWRpbmcgc291cmNlLFxuICogYWRkIGxpdHRsZS4gVGhpcyBtb2R1bGUgbGV0cyBhIHJlcG8gZGVjbGFyZSwgcGVyIHBhdGgsIHdoaWNoIHNwYW4gc2x1Z1xuICogcHJlZml4ZXMgdG8gaG9sZCBiYWNrLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uaG9va2lnbm9yZWAuIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhXG4gKiBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuLCBhIHNpbmdsZSBydW4gb2Ygd2hpdGVzcGFjZSwgdGhlbiBhXG4gKiBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBzcGFuIHNsdWcgcHJlZml4ZXMgdG8gc3VwcHJlc3MgZm9yIHBhdGhzIHRoZSBwYXR0ZXJuXG4gKiBtYXRjaGVzOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjIHdpa2ksbWFya2V0aW5nXG4gKlxuICogQSBzcGFuIHdob3NlIHNsdWcgYmVnaW5zIHdpdGggYHdpa2lgIG9yIGBtYXJrZXRpbmdgICh0aGUgc2x1ZyBlcXVhbHMgdGhlXG4gKiBwcmVmaXgsIG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgKSBpcyB0aGVuIG5ldmVyIHN1cmZhY2VkIGZvciBhbiBhbmNob3Igd2hvc2UgcGF0aFxuICogc2l0cyB1bmRlciBgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjYCBcdTIwMTQgaXQgaXMgbmV2ZXIgc3VyZmFjZWQgaW4gdGhlIGlubGluZVxuICogYDxnaXQtc3Bhbj5gIGJsb2NrIHRoZSBgUG9zdFRvb2xVc2VgIHRvdWNoIGhvb2sgZW1pdHMuIEl0IGhhcyBubyBlZmZlY3Qgb25cbiAqIHRoZSBgUHJlVG9vbFVzZWAgYWR2aXNvciwgd2hvc2Ugb3duIHVuY292ZXJlZC13cml0ZXMgc3VwcHJlc3Npb24gbGl2ZXMgaW5cbiAqIGAuc3Bhbi8uYWR2aXNvcmlnbm9yZWAgKHNlZSBgYWR2aXNvci1pZ25vcmUudHNgKS5cbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXIgaXMgYSBkZWxpYmVyYXRlIHN1YnNldCBvZiBnaXRpZ25vcmU6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMgKHRoZSBsZWFmIGZpbGUgaXMgbm90XG4gKiAgIGl0c2VsZiB0ZXN0ZWQsIG9ubHkgaXRzIGFuY2VzdG9yIGRpcmVjdG9yaWVzKS5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogU3VwcHJlc3Npb24gaXMgZmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmhvb2tpZ25vcmVgLCBvciBhXG4gKiBtYWxmb3JtZWQgbGluZSwgeWllbGRzIG5vIHJ1bGUgcmF0aGVyIHRoYW4gaGlkaW5nIHNwYW5zIHRoZSBhdXRob3IgZGlkIG5vdFxuICogYXNrIHRvIGhpZGUuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBTcGFuIHNsdWcgcHJlZml4ZXMgc3VwcHJlc3NlZCBmb3IgcGF0aHMgdGhpcyBydWxlIG1hdGNoZXMuICovXG4gIHByZWZpeGVzOiBzdHJpbmdbXTtcbiAgLyoqIFRydWUgd2hlbiBgcmVwb1JlbFBhdGhgIChQT1NJWCwgcmVwby1yZWxhdGl2ZSkgaXMgZ292ZXJuZWQgYnkgdGhpcyBydWxlLiAqL1xuICBtYXRjaGVzOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbjtcbn1cblxuY29uc3QgSE9PS19JR05PUkVfUkVMID0gbm9kZVBhdGguam9pbignLnNwYW4nLCAnLmhvb2tpZ25vcmUnKTtcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIGdpdGlnbm9yZS1zdHlsZSBnbG9iIHNlZ21lbnQgaW50byBhbiBhbmNob3JlZCBSZWdFeHAuIGAqYCBhbmRcbiAqIGA/YCBzdGF5IHdpdGhpbiBhIHBhdGggc2VnbWVudDsgYCoqYCAob3B0aW9uYWxseSBmb2xsb3dlZCBieSBgL2ApIHNwYW5zIHRoZW0uXG4gKi9cbmZ1bmN0aW9uIGdsb2JUb1JlZ0V4cChnbG9iOiBzdHJpbmcpOiBSZWdFeHAge1xuICBsZXQgcmUgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBnbG9iLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IGdsb2JbaV07XG4gICAgaWYgKGMgPT09ICcqJykge1xuICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnKicpIHtcbiAgICAgICAgcmUgKz0gJy4qJztcbiAgICAgICAgaSsrO1xuICAgICAgICAvLyBBYnNvcmIgYSBmb2xsb3dpbmcgc2xhc2ggc28gYCoqL2Zvb2AgZG9lcyBub3QgZGVtYW5kIGEgbGl0ZXJhbCBgL2AuXG4gICAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJy8nKSBpKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZSArPSAnW14vXSonO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYyA9PT0gJz8nKSB7XG4gICAgICByZSArPSAnW14vXSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlICs9IGMucmVwbGFjZSgvWy4rXiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBeJHtyZX0kYCk7XG59XG5cbi8qKiBBbmNlc3RvciBwYXRoIGNoYWluOiBgYS9iL2MudHNgIFx1MjE5MiBgWydhJywgJ2EvYicsICdhL2IvYy50cyddYC4gKi9cbmZ1bmN0aW9uIGFuY2VzdG9yUGF0aHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0LnB1c2gocGFydHMuc2xpY2UoMCwgaSArIDEpLmpvaW4oJy8nKSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDb21waWxlIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuICh0aGlzIG1vZHVsZSdzIGdyYW1tYXIgXHUyMDE0IHNlZSB0aGVcbiAqIG1vZHVsZSBkb2MgY29tbWVudCkgaW50byBhIHBhdGggcHJlZGljYXRlLiBBIHBhdHRlcm4gbWF0Y2hlcyBhIGZpbGUgd2hlbiBpdFxuICogbWF0Y2hlcyB0aGUgZmlsZSdzIHBhdGggb3IgYW55IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBpdCwgc28gYSBkaXJlY3RvcnlcbiAqIHBhdHRlcm4gc3VwcHJlc3NlcyBldmVyeXRoaW5nIGJlbmVhdGggaXQuXG4gKlxuICogRXhwb3J0ZWQgc28gb3RoZXIgcGF0aC1zY29wZWQgaWdub3JlLWZpbGUgY29udmVudGlvbnMgKGUuZy4gYC5hZHZpc29yaWdub3JlYFxuICogaW4gYGFkdmlzb3ItaWdub3JlLnRzYCkgY2FuIHJldXNlIHRoZSBleGFjdCBtYXRjaGluZyBzZW1hbnRpY3MgcmF0aGVyIHRoYW5cbiAqIHJlaW1wbGVtZW50aW5nIHRoZW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21waWxlUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiB7XG4gIGxldCBwYXQgPSBwYXR0ZXJuO1xuICBsZXQgZGlyT25seSA9IGZhbHNlO1xuICBpZiAocGF0LmVuZHNXaXRoKCcvJykpIHtcbiAgICBkaXJPbmx5ID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMCwgLTEpO1xuICB9XG4gIGxldCBhbmNob3JlZCA9IHBhdC5pbmNsdWRlcygnLycpO1xuICBpZiAocGF0LnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGFuY2hvcmVkID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMSk7XG4gIH1cbiAgY29uc3QgcmUgPSBnbG9iVG9SZWdFeHAocGF0KTtcblxuICByZXR1cm4gKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoYW5jaG9yZWQpIHtcbiAgICAgIGNvbnN0IHNlZ3MgPSBhbmNlc3RvclBhdGhzKHJlcG9SZWxQYXRoKTtcbiAgICAgIC8vIEZvciBhIGRpci1vbmx5IHBhdHRlcm4sIG5ldmVyIHRlc3QgdGhlIGxlYWYgZmlsZSBpdHNlbGYuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IHNlZ3Muc2xpY2UoMCwgLTEpIDogc2VncztcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKHMpID0+IHJlLnRlc3QocykpO1xuICAgIH1cbiAgICAvLyBVbmFuY2hvcmVkOiBtYXRjaCBhZ2FpbnN0IGluZGl2aWR1YWwgcGF0aCBjb21wb25lbnRzIGF0IGFueSBkZXB0aC5cbiAgICBjb25zdCBjb21wb25lbnRzID0gcmVwb1JlbFBhdGguc3BsaXQoJy8nKTtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IGNvbXBvbmVudHMuc2xpY2UoMCwgLTEpIDogY29tcG9uZW50cztcbiAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjKSA9PiByZS50ZXN0KGMpKTtcbiAgfTtcbn1cblxuLyoqIFBhcnNlIGAuaG9va2lnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgbWFsZm9ybWVkIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSG9va0lnbm9yZShjb250ZW50OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIWxpbmUgfHwgbGluZS5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIC8vIGA8cGF0dGVybj48d2hpdGVzcGFjZT48cHJlZml4ZXM+YCBcdTIwMTQgcGF0dGVybiBpcyB0aGUgZmlyc3QgdG9rZW4sIHByZWZpeGVzXG4gICAgLy8gdGhlIHNlY29uZC4gQSBsaW5lIHdpdGhvdXQgYm90aCBpcyBtYWxmb3JtZWQgYW5kIHNraXBwZWQuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxcUyspXFxzKyhcXFMrKSQvKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBwYXR0ZXJuLCBwcmVmaXhlc1Jhd10gPSBtYXRjaDtcbiAgICBjb25zdCBwcmVmaXhlcyA9IHByZWZpeGVzUmF3XG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGlmIChwcmVmaXhlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBwcmVmaXhlcywgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHN1cHByZXNzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgb3IgcGFyc2UgZmFpbHVyZVxuICogeWllbGRzIGFuIGVtcHR5IHJ1bGUgc2V0LCBzbyBzcGFucyBzdXJmYWNlIGFzIG5vcm1hbCB3aGVuIG5vIGNvbmZpZyBleGlzdHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSG9va0lnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEhPT0tfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlSG9va0lnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBBIHNsdWcgY2FycmllcyBhIHByZWZpeCB3aGVuIGl0IGVxdWFscyB0aGUgcHJlZml4IG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgLiAqL1xuZnVuY3Rpb24gc2x1Z0hhc1ByZWZpeChzbHVnOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBzbHVnID09PSBwcmVmaXggfHwgc2x1Zy5zdGFydHNXaXRoKGAke3ByZWZpeH0vYCk7XG59XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGEgc3BhbiBgc2x1Z2Agc2hvdWxkIGJlIHN1cHByZXNzZWQgZm9yIGFuIGFuY2hvciBhdCBgcmVwb1JlbFBhdGhgOlxuICogc29tZSBydWxlIG1hdGNoZXMgdGhlIHBhdGggYW5kIGxpc3RzIGEgcHJlZml4IHRoZSBzbHVnIGNhcnJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYW5TdXBwcmVzc2VkKHJ1bGVzOiBJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNsdWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICBpZiAoIXJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpIGNvbnRpbnVlO1xuICAgIGlmIChydWxlLnByZWZpeGVzLnNvbWUoKHApID0+IHNsdWdIYXNQcmVmaXgoc2x1ZywgcCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkSG9va0lnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgSG9va0lnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHRvdWNoLWhvb2sgY29yZS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpbXBsZW1lbnRzIHRoZSBQb3N0VG9vbFVzZSBcInRvdWNoIHNpZ25hbFwiIHRoYXQgYm90aCB0aGUgQ2xhdWRlXG4gKiAoYFJlYWR8RWRpdHxXcml0ZWApIGFuZCBDb2RleCAoYGFwcGx5X3BhdGNoYCkgYWRhcHRlcnMgZHJpdmUuIEl0IGltcG9ydHNcbiAqIG5vdGhpbmcgZnJvbSBlaXRoZXIgaG9vayBTREsgYW5kIGlzIHR5cGVkIHN0cnVjdHVyYWxseSwgcGVyIHRoZSBgY29tbW9uL2BcbiAqIGxheWVyIGNvbnZlbnRpb246IGFkYXB0ZXJzIHRyYW5zbGF0ZSB0aGVpciBTREstc3BlY2lmaWMgaG9vayBpbnB1dCBpbnRvIGFcbiAqIHtAbGluayBUb3VjaElucHV0fSwgaW5qZWN0IGV4ZWN1dGlvbi9zdGF0ZSBkZXBlbmRlbmNpZXMsIGFuZCB3cmFwIHRoZSByZXR1cm5lZFxuICoge0BsaW5rIFRvdWNoT3V0cHV0fSBpbiB0aGVpciBvd24gb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogUmV1c2VkIGZyb20gdGhlIHNoYXJlZCBrZXJuZWwgKG5vdCByZWRlZmluZWQpOiBgaXNEZWJ0KClgICtcbiAqIGBQb3JjZWxhaW5TdGF0dXNgL2BEcmlmdFBvcmNlbGFpblJvd2AvYFBvcmNlbGFpblJvd2AvYHBhcnNlUG9yY2VsYWluYC9cbiAqIGBwYXJzZURyaWZ0UG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYHJhbmdlc0ludGVyc2VjdGAgYW5kIHRoZVxuICogcmVwby9zcGFuLXJvb3QgcGF0aCB1dGlsaXRpZXMgKGFnZW50LWhvb2tzLWNvbW1vbi50cyksIGFuZCB0aGUgYE1lbW9TdG9yZWBcbiAqIGNhZGVuY2Ugc3RvcmUgKHNwYW4tc3VyZmFjZS50cykuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgdHlwZSBEcmlmdFBvcmNlbGFpblJvdyxcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHR5cGUgUG9yY2VsYWluU3RhdHVzLFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcmFuZ2VzSW50ZXJzZWN0LFxuICByZWxhdGl2ZVRvUmVwbyxcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICByZXNvbHZlU3BhblJvb3Rcbn0gZnJvbSAnLi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgY29sbGFwc2VCeVBhdGgsIHR5cGUgUmFuZ2VMYWJlbCwgcmVuZGVyQW5jaG9yVHJlZSB9IGZyb20gJy4vYW5jaG9yLXRyZWUuanMnO1xuaW1wb3J0IHR5cGUgeyBNZW1vU3RvcmUgfSBmcm9tICcuL3NwYW4tc3VyZmFjZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9zdC1lZGl0IHJhbmdlIHJlY292ZXJ5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTcGxpdCB3cml0dGVuIGNvbnRlbnQgaW50byB0aGUgbGluZXMgdG8gbG9jYXRlIG9uIGRpc2suIEEgc2luZ2xlIHRyYWlsaW5nXG4gKiBuZXdsaW5lIGlzIGRyb3BwZWQgc28gYFwiYVxcbmJcXG5cImAgYW5kIGBcImFcXG5iXCJgIGxvY2F0ZSBpZGVudGljYWxseTsgYW4gZW1wdHlcbiAqIChvciBuZXdsaW5lLW9ubHkpIHdyaXRlIGhhcyBubyBsb2NhdGFibGUgYmxvY2suXG4gKi9cbmZ1bmN0aW9uIHRvTmVlZGxlTGluZXMod3JpdHRlbjogc3RyaW5nKTogc3RyaW5nW10ge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgdHJpbW1lZCA9IHdyaXR0ZW4uZW5kc1dpdGgoJ1xcbicpID8gd3JpdHRlbi5zbGljZSgwLCAtMSkgOiB3cml0dGVuO1xuICBpZiAodHJpbW1lZC5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgcmV0dXJuIHRyaW1tZWQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIGxpbmUgcmFuZ2UgdGhhdCB3cml0dGVuIGNvbnRlbnQgbm93IG9jY3VwaWVzIGluIHRoZSBvbi1kaXNrIGZpbGUsXG4gKiBmb3IgYW5jaG9yaW5nIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZnRlciBhbiBlZGl0IGhhcyBhbHJlYWR5IGFwcGxpZWQuXG4gKlxuICogVGhpcyBnZW5lcmFsaXplcyB0aGUgcHJlLWVkaXQgYGxvY2F0ZUNodW5rKClgIHRlY2huaXF1ZSBpblxuICogW2FwcGx5LXBhdGNoLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jb2RleC9hcHBseS1wYXRjaC50cyNMMjUzLUwyODYpXG4gKiAocHJldmlvdXNseSBDb2RleC1vbmx5KSBpbnRvIGEgc2hhcmVkIHBvc3QtZWRpdCBwcmltaXRpdmUgYm90aCBoYXJuZXNzZXMgdXNlOlxuICogc3BsaXQgYHdyaXR0ZW5gIGFuZCBgb25EaXNrQ29udGVudGAgaW50byBsaW5lcyBhbmQgbG9jYXRlIHRoZSB3cml0dGVuIGJsb2NrIGFzXG4gKiBhIGNvbnRpZ3VvdXMgcnVuIGluc2lkZSB0aGUgb24tZGlzayBsaW5lcy5cbiAqXG4gKiAtIEEgc2luZ2xlIGNvbnRpZ3VvdXMgbWF0Y2ggeWllbGRzIGl0cyAxLWJhc2VkIGluY2x1c2l2ZSB7QGxpbmsgTGluZVJhbmdlfS5cbiAqIC0gV2hlbiB0aGUgYmxvY2sgaXMgYWJzZW50LCBvciBhcHBlYXJzIG1vcmUgdGhhbiBvbmNlIChjb250ZXh0IHRvIGRpc2FtYmlndWF0ZVxuICogICBpcyBub3QgYXZhaWxhYmxlIHBvc3QtZWRpdCksIHJlY292ZXJ5IGlzIGFtYmlndW91cyBhbmQgdGhlIHJlc3VsdCBkZWdyYWRlc1xuICogICB0byBgJ3dob2xlLWZpbGUnYCAodGhlIHNhbWUgZmFsbGJhY2sgYGxvY2F0ZUNodW5rKClgIHNpZ25hbHMgd2l0aCBgbnVsbGApLlxuICpcbiAqIE5ldmVyIHRocm93czogYW4gdW5sb2NhdGFibGUgd3JpdGUgaXMgYSBgJ3dob2xlLWZpbGUnYCBhbnN3ZXIsIG5vdCBhbiBlcnJvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY292ZXJSYW5nZSh3cml0dGVuOiBzdHJpbmcsIG9uRGlza0NvbnRlbnQ6IHN0cmluZyk6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGNvbnN0IG5lZWRsZSA9IHRvTmVlZGxlTGluZXMod3JpdHRlbik7XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuXG4gIGNvbnN0IGhheXN0YWNrID0gb25EaXNrQ29udGVudC5zcGxpdCgnXFxuJyk7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBjb25zdCBzdGFydHM6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSB7XG4gICAgICBzdGFydHMucHVzaChpKTtcbiAgICAgIGlmIChzdGFydHMubGVuZ3RoID4gMSkgYnJlYWs7IC8vIGR1cGxpY2F0ZWQgXHUyMTkyIGFtYmlndW91cywgc3RvcCBlYXJseVxuICAgIH1cbiAgfVxuXG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHN0YXJ0c1swXSArIDEsIGVuZDogc3RhcnRzWzBdICsgbmVlZGxlLmxlbmd0aCB9O1xuICB9XG4gIHJldHVybiAnd2hvbGUtZmlsZSc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaW5wdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFdoaWNoIGhhcm5lc3MgZXZlbnQgZmlyZWQsIGFzIHRoZSB0b3VjaCBjb3JlIHNlZXMgaXQuIFRoZSBjb3JlIGJyYW5jaGVzIG9uXG4gKiB0aGlzOiBgd3JpdGVgIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSBhbmQgbWF5IHN1cmZhY2UgYVxuICogbWVyZ2VkIGJsb2NrOyBgcmVhZGAgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZSBhbmQgZmlsdGVycyBwb3NpdGlvbmFsIHN0YXR1c2VzXG4gKiBvdXQgb2Ygd2hhdCBpdCBzdXJmYWNlcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hFdmVudEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnO1xuXG4vKiogRmllbGRzIHNoYXJlZCBieSBldmVyeSB0b3VjaCwgcmVnYXJkbGVzcyBvZiBraW5kLiAqL1xuaW50ZXJmYWNlIFRvdWNoSW5wdXRCYXNlIHtcbiAgLyoqIEhhcm5lc3Mgc2Vzc2lvbiBpZCBcdTIwMTQga2V5cyB0aGUgcGVyLXNlc3Npb24gY2FkZW5jZSB7QGxpbmsgTWVtb1N0b3JlfS4gKi9cbiAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBXb3JraW5nIGRpcmVjdG9yeSB0aGUgdG9vbCByYW4gaW4sIHVzZWQgdG8gYm91bmQgdGhlIHRvdWNoIHRvIHRoZSBDV0QgcmVwb1xuICAgKiB2aWEgYHJlc29sdmVUb3VjaFNjb3BlKClgIGJlZm9yZSBhbnkgc3BhbiBpbnZvY2F0aW9uLlxuICAgKi9cbiAgY3dkOiBzdHJpbmc7XG4gIC8qKiBBYnNvbHV0ZSwgY2Fub25pY2FsaXplZCBwYXRoIG9mIHRoZSB0b3VjaGVkIGZpbGUuICovXG4gIGZpbGVQYXRoOiBzdHJpbmc7XG59XG5cbi8qKiBBIHJlYWQgdG91Y2ggKENsYXVkZSBgUmVhZGAsIG9yIGEgcmVhZC1zaGFwZWQgQ29kZXggZXZlbnQpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaFJlYWRJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3JlYWQnO1xuICAvKipcbiAgICogMS1iYXNlZCBzdGFydGluZyBsaW5lIG9mIHRoZSByZWFkLCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBgb2Zmc2V0YFxuICAgKiBpbnB1dC4gYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYG9mZnNldGAgKHJlYWRzIGZyb20gbGluZSAxKS5cbiAgICovXG4gIG9mZnNldD86IG51bWJlcjtcbiAgLyoqXG4gICAqIExpbmUgY291bnQgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBsaW1pdGAgaW5wdXQuXG4gICAqIGB1bmRlZmluZWRgIHdoZW4gdGhlIHJlYWQgaGFkIG5vIGBsaW1pdGAgXHUyMDE0IHNlZSB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfVxuICAgKiBmb3IgaG93IHRoZSByYW5nZSBpcyBjb21wdXRlZCBpbiB0aGF0IGNhc2UuXG4gICAqL1xuICBsaW1pdD86IG51bWJlcjtcbn1cblxuLyoqIEEgd3JpdGUgdG91Y2ggKENsYXVkZSBgRWRpdGAvYFdyaXRlYCwgQ29kZXggYGFwcGx5X3BhdGNoYCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoV3JpdGVJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3dyaXRlJztcbiAgLyoqXG4gICAqIFRoZSBjb250ZW50IGp1c3Qgd3JpdHRlbiB0byBgZmlsZVBhdGhgLCBmZWQgdG8ge0BsaW5rIHJlY292ZXJSYW5nZX0gdG9cbiAgICogcmUtYW5jaG9yIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZ2FpbnN0IHRoZSBoZWFsZWQgb24tZGlzayBmaWxlLiBGb3IgYVxuICAgKiB3aG9sZS1maWxlIGNyZWF0ZSB0aGlzIGlzIHRoZSBlbnRpcmUgZmlsZSBib2R5OyBhbiBlbXB0eSBzdHJpbmcgbWVhbnNcbiAgICogXCJubyBsb2NhdGFibGUgYmxvY2tcIiBhbmQgdGhlIHRvdWNoIGlzIHNjb3BlZCBmaWxlLXdpZGUuXG4gICAqL1xuICB3cml0dGVuOiBzdHJpbmc7XG59XG5cbi8qKiBUaGUgaGFybmVzcy1hZ25vc3RpYyB0b3VjaCB0aGUgY29yZSBjb25zdW1lcy4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoSW5wdXQgPSBUb3VjaFJlYWRJbnB1dCB8IFRvdWNoV3JpdGVJbnB1dDtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbmplY3RlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3RydWN0dXJlZCByZXN1bHQgb2YgYSBzY29wZWQgYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGAuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoRml4UmVzdWx0IHtcbiAgLyoqXG4gICAqIFdoZXRoZXIgYC0tZml4YCByZS1hbmNob3JlZCBhdCBsZWFzdCBvbmUgc3BhbiBpbiB0aGUgd29ya2luZyB0cmVlLiBEcml2ZXNcbiAgICoge0BsaW5rIFRvdWNoT3V0cHV0LnRyZWVNb2RpZmllZH0gc28gYSBjYWxsZXIvdGVzdCBjYW4gYXNzZXJ0IHRoZSBoZWFsaW5nXG4gICAqIGhhcHBlbmVkIHdpdGhvdXQgZGlmZmluZyB0aGUgdHJlZSBpdHNlbGYuXG4gICAqL1xuICBtb2RpZmllZDogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGAgc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgKHdyaXRlIHBhdGhcbiAqIG9ubHkpLCByZXBvcnRpbmcgd2hldGhlciB0aGUgd29ya2luZyB0cmVlIHdhcyBoZWFsZWQuIEFzeW5jIHNvIHRoZSBldmVudHVhbFxuICogaW1wbGVtZW50YXRpb24gYW5kIGl0cyB0ZXN0cyBjYW4gaW5qZWN0IGEgZmFrZSB3aXRob3V0IGEgcmVhbCBzdWJwcm9jZXNzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEZpeEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFRvdWNoRml4UmVzdWx0PjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gPGZpbGU+YCBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlclxuICogYW5jaG9yIGNvdmVyaW5nIHRoZSBmaWxlLiBTdHJ1Y3R1cmVkIChub3QgcmF3IHN0ZG91dCkgc28gdGhlIG1lcmdlZC1ibG9ja1xuICogY29tcHV0YXRpb24gYW5kIGl0cyB0ZXN0cyBzaGFyZSB0aGUgc2FtZSBzaGFwZS5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hMaXN0RXhlY3V0b3IgPSAoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8UG9yY2VsYWluUm93W10+O1xuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluIDxhcmdzPmAgKHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlIG9yXG4gKiBpdHMgc3BhbnMpIGFuZCByZXR1cm4gaXRzIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyIGRyaWZ0ZWQgYW5jaG9yLCBlbXB0eSB3aGVuXG4gKiBjbGVhbi4gU3RhdHVzIGNsYXNzaWZpY2F0aW9uIGlzIHZpYSBgaXNEZWJ0KClgOyBwb3NpdGlvbmFsIChgTU9WRURgLFxuICogYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCkgcm93cyBhcmUgbmV2ZXIgZGVidC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hEcmlmdEV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxEcmlmdFBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYmFyZSBgZ2l0IHNwYW4gd2h5IDxuYW1lPmAgYW5kIHJldHVybiB0aGUgc3BhbidzIHJlY29yZGVkIHdoeSBzZW50ZW5jZSxcbiAqIG9yIGBudWxsYCB3aGVuIG5vbmUgaXMgcmVjb3JkZWQgb3IgdGhlIHJlYWQgZmFpbHMuIEZlZWRzIHRoZSBodW1hbi1mb3JtYXRcbiAqIHNwYW4gcmVuZGVyOyBpbnZva2VkIG9ubHkgZm9yIHNwYW5zIGFjdHVhbGx5IGJlaW5nIHN1cmZhY2VkIHRoaXMgdG91Y2guXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoV2h5RXhlY3V0b3IgPSAobmFtZTogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxzdHJpbmcgfCBudWxsPjtcblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZXhlY3V0aW9uIHN1cmZhY2UuIEtlcHQgYXMgZm91ciBuYXJyb3cgYXN5bmMgZnVuY3Rpb25zIChyYXRoZXJcbiAqIHRoYW4gYSByYXcgY29tbWFuZCBydW5uZXIpIHNvIHRlc3RzIGluamVjdCBmYWtlcyByZXR1cm5pbmcgc3RydWN0dXJlZCBkYXRhXG4gKiBhbmQgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIGEgc3VicHJvY2VzcyBpdHNlbGYuIFRoZSBgcmVhZGAgcGF0aCBuZXZlciBpbnZva2VzXG4gKiBgZml4YC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEV4ZWN1dG9ycyB7XG4gIGZpeDogVG91Y2hGaXhFeGVjdXRvcjtcbiAgbGlzdDogVG91Y2hMaXN0RXhlY3V0b3I7XG4gIGRyaWZ0OiBUb3VjaERyaWZ0RXhlY3V0b3I7XG4gIHdoeTogVG91Y2hXaHlFeGVjdXRvcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBvdXRwdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hhdCB0aGUgY29yZSBoYW5kcyBiYWNrIGZvciB0aGUgYWRhcHRlciB0byB0cmFuc2xhdGUgaW50byBTREsgb3V0cHV0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaE91dHB1dCB7XG4gIC8qKlxuICAgKiBUaGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayAoaGVhZGVyLCBvbmUgaHVtYW4tZm9ybWF0IHNlY3Rpb24gcGVyXG4gICAqIHN1cmZhY2VkIHNwYW4sIGZvb3RlcikgdG8gaW5qZWN0IHZpYSB0aGUgaGFybmVzcydzIGBhZGRpdGlvbmFsQ29udGV4dGAsXG4gICAqIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzIG5vdGhpbmcgd29ydGggc3VyZmFjaW5nIHRoaXMgdG91Y2guXG4gICAqL1xuICBhZGRpdGlvbmFsQ29udGV4dDogc3RyaW5nIHwgbnVsbDtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgbW9kaWZpZWQgYnkgYSBzY29wZWQgYC0tZml4YCBvbiB0aGUgd3JpdGUgcGF0aC5cbiAgICogQWx3YXlzIGBmYWxzZWAgb24gdGhlIHJlYWQgcGF0aCAocmVhZHMgbmV2ZXIgbXV0YXRlIHRoZSB0cmVlKS5cbiAgICovXG4gIHRyZWVNb2RpZmllZDogYm9vbGVhbjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBNZXJnZWQtYmxvY2sgYXNzZW1ibHlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIG1lbW8ga2V5IHVuZGVyIHdoaWNoIGEgc3BhbidzIHJlbmRlciBmb3IgYSBnaXZlbiBkcmlmdCBzdGF0dXMgaXMgZGVkdXBlZC4gKi9cbmZ1bmN0aW9uIGRyaWZ0S2V5KG5hbWU6IHN0cmluZywgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICAvLyBTcGFuIG5hbWVzIGNvbWUgZnJvbSB0YWItZGVsaW1pdGVkIHBvcmNlbGFpbiwgc28gdGhleSBuZXZlciBjb250YWluIGEgdGFiO1xuICAvLyBhIHRhYi1qb2luZWQga2V5IGNhbiBuZXZlciBjb2xsaWRlIHdpdGggYSBiYXJlIHNwYW4gbmFtZSAodGhlIHN1cmZhY2luZyBrZXkpLlxuICByZXR1cm4gYCR7bmFtZX1cXHQke3N0YXR1c31gO1xufVxuXG4vKiogVGhlIGBwYXRoI0xzdGFydC1MZW5kYCAob3IgYmFyZS1wYXRoLCB3aG9sZS1maWxlKSBhbmNob3IgdGV4dCBmb3IgYSByb3cuICovXG5mdW5jdGlvbiBhbmNob3JUZXh0KHJvdzogUG9yY2VsYWluUm93KTogc3RyaW5nIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4gcm93LnBhdGg7XG4gIHJldHVybiBgJHtyb3cucGF0aH0jTCR7cm93LnN0YXJ0fS1MJHtyb3cuZW5kfWA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuSGVhZGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCR7ZmlsZU5hbWV9IGhhcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXM6YDtcbn1cblxuZnVuY3Rpb24gY2xlYW5Gb290ZXIoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgSWYgeW91IGNoYW5nZSAke2ZpbGVOYW1lfSBjaGVjayB0aGUgb3RoZXIgZmlsZXMgdG8gY29uZmlybSB0aGV5IHN0aWxsIHdvcmsgdG9nZXRoZXIuYDtcbn1cblxuLyoqXG4gKiBUaGUgd3JpdGUgcGF0aCBuYW1lcyB0aGUgZWRpdCBhcyB0aGUgY2F1c2U7IHRoZSByZWFkIHBhdGggb25seSBzdXJmYWNlc1xuICogcHJlLWV4aXN0aW5nIGRyaWZ0IGl0IGRpZG4ndCBjcmVhdGUsIHNvIGl0IG5hbWVzIHRoZSBkZXBlbmRlbmN5IGluc3RlYWQuXG4gKi9cbmZ1bmN0aW9uIGRyaWZ0SGVhZGVyKGRyaWZ0ZWRDb3VudDogbnVtYmVyLCBraW5kOiBUb3VjaElucHV0WydraW5kJ10pOiBzdHJpbmcge1xuICBpZiAoa2luZCA9PT0gJ3dyaXRlJykge1xuICAgIHJldHVybiBkcmlmdGVkQ291bnQgPT09IDFcbiAgICAgID8gJ1RoaXMgZWRpdCBwdXQgYW4gaW1wbGljaXQgZGVwZW5kZW5jeSBvdXQgb2YgZGF0ZTonXG4gICAgICA6ICdUaGlzIGVkaXQgcHV0IGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xuICB9XG4gIHJldHVybiBkcmlmdGVkQ291bnQgPT09IDFcbiAgICA/ICdUaGlzIGZpbGUgaGFzIGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgIDogJ1RoaXMgZmlsZSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzIG91dCBvZiBkYXRlOic7XG59XG5cbmZ1bmN0aW9uIGRyaWZ0Rm9vdGVyKGRyaWZ0ZWROYW1lczogc3RyaW5nW10pOiBzdHJpbmcge1xuICBpZiAoZHJpZnRlZE5hbWVzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IG5hbWUgPSBkcmlmdGVkTmFtZXNbMF07XG4gICAgcmV0dXJuIGBSZXN0b3JlIGFncmVlbWVudCBiZWZvcmUgY29tbWl0dGluZy4gRm9sbG93IGNvbmZpcm1lZCBhdXRob3JpdHkuIFByZXNlcnZlIGFuY2hvciBzaGFwZTsgaWYgYW4gYWRkcmVzcyBjaGFuZ2VkLCBzd2FwIHRoZSBvbGQgYW5jaG9yIGZvciB0aGUgbmV3IG9uZSB3aXRoIFxcYGdpdCBzcGFuIHJlcGxhY2VcXGAuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgXFxgZ2l0IHNwYW4gZHJpZnQgJHtuYW1lfVxcYCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLmA7XG4gIH1cbiAgcmV0dXJuICdGb3IgZWFjaCBvdXQtb2YtZGF0ZSBzcGFuOiByZXN0b3JlIGFncmVlbWVudCBiZWZvcmUgY29tbWl0dGluZy4gRm9sbG93IGNvbmZpcm1lZCBhdXRob3JpdHkuIFByZXNlcnZlIGFuY2hvciBzaGFwZTsgaWYgYW4gYWRkcmVzcyBjaGFuZ2VkLCBzd2FwIHRoZSBvbGQgYW5jaG9yIGZvciB0aGUgbmV3IG9uZSB3aXRoIGBnaXQgc3BhbiByZXBsYWNlYC4gVXBkYXRlIG9yIHJldGlyZSB0aGUgd2h5IG9ubHkgaWYgaXRzIG1lYW5pbmcgY2hhbmdlZC4gUmVxdWlyZSBgZ2l0IHNwYW4gZHJpZnQgPG5hbWU+YCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLic7XG59XG5cbi8qKiBUaGUge0BsaW5rIFJhbmdlTGFiZWx9IGZvciBhIHBvcmNlbGFpbiByb3cgXHUyMDE0IGAwLTBgIGlzIHRoZSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIHJhbmdlTGFiZWwocm93OiBQb3JjZWxhaW5Sb3cpOiBSYW5nZUxhYmVsIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4geyBraW5kOiAnd2hvbGUtZmlsZScgfTtcbiAgcmV0dXJuIHsga2luZDogJ3JhbmdlJywgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH07XG59XG5cbi8qKlxuICogQSBzcGFuJ3MgZnVsbCBhbmNob3IgbGlzdCwgcmVuZGVyZWQgYXMgYSBzaGFyZWQtcHJlZml4IHRyZWUgYnlcbiAqIHtAbGluayByZW5kZXJBbmNob3JUcmVlfSwgd2l0aCBlYWNoIGFuY2hvciB0aGF0IGNhcnJpZXMgZ2VudWluZSBkcmlmdFxuICogc3VmZml4ZWQgYnkgaXRzIGxvd2VyY2FzZSBzdGF0dXMgdG9rZW4ocykgKGAgXHUyMDE0IGNoYW5nZWRgKS5cbiAqXG4gKiBBIGRyaWZ0IHJvdyBtYXRjaGVzIGFuIGFuY2hvciBieSBleGFjdCBwYXRoK3JhbmdlLCBvciBieSBwYXRoIGFsb25lIHdoZW4gdGhlXG4gKiBzcGFuIGhhcyBhIHNpbmdsZSBhbmNob3Igb24gdGhhdCBwYXRoIChyYW5nZXMgY2FuIGRpc2FncmVlIGFmdGVyIGEgaGVhbCkuXG4gKiBgc29sZU9uUGF0aGAgaXMgZGVsaWJlcmF0ZWx5IGNvbXB1dGVkIG92ZXIgdGhlICoqZnVsbCBmbGF0IGFuY2hvciBsaXN0KiosXG4gKiBiZWZvcmUgYW55IGdyb3VwaW5nIFx1MjAxNCB0aGUgdHJlZSBsYXlvdXQgbXVzdCBuZXZlciBiZSBhYmxlIHRvIGNoYW5nZSAqd2hpY2gqXG4gKiBhbmNob3JzIGdldCBsYWJlbGVkLCBvbmx5IHdoZXJlIHRoZXkgc2l0IG9uIHRoZSBwYWdlLlxuICovXG5mdW5jdGlvbiBhbmNob3JCdWxsZXRzKGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLCBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgcm93cyA9IGFuY2hvcnMubWFwKChhbmNob3IpID0+IHtcbiAgICBjb25zdCBzb2xlT25QYXRoID0gYW5jaG9ycy5maWx0ZXIoKGEpID0+IGEucGF0aCA9PT0gYW5jaG9yLnBhdGgpLmxlbmd0aCA9PT0gMTtcbiAgICBjb25zdCBzdGF0dXNlcyA9IG5ldyBTZXQ8UG9yY2VsYWluU3RhdHVzPigpO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIGRlYnRSb3dzKSB7XG4gICAgICBpZiAocm93LnBhdGggIT09IGFuY2hvci5wYXRoKSBjb250aW51ZTtcbiAgICAgIGlmIChzb2xlT25QYXRoIHx8IChyb3cuc3RhcnQgPT09IGFuY2hvci5zdGFydCAmJiByb3cuZW5kID09PSBhbmNob3IuZW5kKSkge1xuICAgICAgICBzdGF0dXNlcy5hZGQocm93LnN0YXR1cyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi5zdGF0dXNlc10uc29ydCgpO1xuICAgIGNvbnN0IHN1ZmZpeCA9IHNvcnRlZC5sZW5ndGggPiAwID8gYCBcdTIwMTQgJHtzb3J0ZWQubWFwKGh1bWFuU3RhdHVzTGFiZWwpLmpvaW4oJywgJyl9YCA6ICcnO1xuICAgIHJldHVybiB7IHBhdGg6IGFuY2hvci5wYXRoLCByYW5nZTogcmFuZ2VMYWJlbChhbmNob3IpLCBzdWZmaXggfTtcbiAgfSk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlbmRlckFuY2hvclRyZWUoY29sbGFwc2VCeVBhdGgocm93cykpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCBkbyBub3QgcmVtb3ZlIGl0XG4gICAgLy8gb24gdGhlIHRoZW9yeSB0aGF0IGEgZGVncmFkZWQgZmFsbGJhY2sgaXMgaXRzZWxmIGZvcmJpZGRlbi4gQW4gdW5jYXVnaHRcbiAgICAvLyB0aHJvdyBoZXJlIGRvZXMgbm90IGRlZ3JhZGUgdG8gYSBmbGF0IGxpc3Q6IGl0IGVzY2FwZXMgdG9cbiAgICAvLyBgcnVuVG91Y2hIb29rYCdzIGNhdGNoLCB3aGljaCByZXNvbHZlcyB0aGUgd2hvbGUgaG9vayB0b1xuICAgIC8vIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAsIHNvIHRoZSBhZ2VudCBpcyBuZXZlciB0b2xkIGFib3V0IHRoZSBkcmlmdCBhdFxuICAgIC8vIGFsbC4gQ2F0Y2hpbmcgbG9jYWxseSBuYXJyb3dzIHdoYXQgYSByZW5kZXJpbmcgZGVmZWN0IGNhbiBjb3N0IGZyb20gXCJ0aGVcbiAgICAvLyByZW1pbmRlciBkaXNhcHBlYXJzXCIgdG8gXCJ0aGUgcmVtaW5kZXIgbG9va3MgbGlrZSBpdCBkaWQgYmVmb3JlIHRoZSB0cmVlXCIuXG4gICAgLy8gV2hldGhlciB0byBzdXJmYWNlIGFuZCB3aGF0IHNoYXBlIHRvIHN1cmZhY2UgaW4gYXJlIGRpZmZlcmVudCB0aGluZ3MsIGFuZFxuICAgIC8vIHRoaXMgY2F0Y2ggb25seSBldmVyIHRvdWNoZXMgdGhlIGxhdHRlci5cbiAgICAvLyBgcm93c2AgaXMgaW5kZXgtYWxpZ25lZCB3aXRoIGBhbmNob3JzYCwgc28gdGhpcyByZXByb2R1Y2VzIHRvZGF5J3MgZmxhdFxuICAgIC8vIGJ1bGxldCBydW4gYnl0ZSBmb3IgYnl0ZSwgc3VmZml4ZXMgaW5jbHVkZWQuXG4gICAgcmV0dXJuIGFuY2hvcnMubWFwKChhbmNob3IsIGkpID0+IGAtICR7YW5jaG9yVGV4dChhbmNob3IpfSR7cm93c1tpXS5zdWZmaXh9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBPbmUgaHVtYW4tZm9ybWF0IHNwYW4gc2VjdGlvbjogYCMjIDxuYW1lPmAsIHRoZSBmdWxsIGFuY2hvciBsaXN0IChkcmlmdGVkXG4gKiBhbmNob3JzIHN0YXR1cy1zdWZmaXhlZCksIGFuZCB0aGUgd2h5IHNlbnRlbmNlIHdoZW4gb25lIGlzIHJlY29yZGVkLlxuICpcbiAqIFRoZSBuYW1lIGhlYWRlciBhbmQgdGhlIHdoeSBzZW50ZW5jZSBhcmUgdGhlIHNhbWUgc2hhcGUgYGdpdCBzcGFuIGxpc3RgXG4gKiByZW5kZXJzOyB0aGUgYW5jaG9yIGxpc3QgZGVsaWJlcmF0ZWx5IGlzIG5vdCBcdTIwMTQgaXQgcmVuZGVycyBhcyBhIHNoYXJlZC1wcmVmaXhcbiAqIHRyZWUgKHtAbGluayBhbmNob3JCdWxsZXRzfSkgd2hlcmUgdGhlIENMSSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHJhbmdlYFxuICogYnVsbGV0IHJ1bi4gVGhlIENMSSdzIG93biB0ZXh0IGZvcm1hdCBpcyB1bnRvdWNoZWQ7IG9ubHkgdGhpcyBob29rJ3NcbiAqIHJlLXByZXNlbnRhdGlvbiBvZiBpdCBncm91cHMuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclNwYW5TZWN0aW9uKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLFxuICBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSxcbiAgd2h5OiBzdHJpbmcgfCBudWxsXG4pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IFtgIyMgJHtuYW1lfWAsIC4uLmFuY2hvckJ1bGxldHMoYW5jaG9ycywgZGVidFJvd3MpXTtcbiAgaWYgKHdoeSkgbGluZXMucHVzaCgnJywgd2h5KTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIEFzc2VtYmxlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrOiBoZWFkZXIsIG9uZSBzZWN0aW9uIHBlciBzdXJmYWNlZFxuICogc3BhbiAoc2VwYXJhdGVkIGJ5IGAtLS1gKSwgYW5kIGEgc2luZ2xlIGZvb3RlciBhZnRlciBhIGZpbmFsIGAtLS1gLlxuICovXG5mdW5jdGlvbiBidWlsZEJsb2NrKHNlY3Rpb25zOiBzdHJpbmdbXSwgaGVhZGVyOiBzdHJpbmcsIGZvb3Rlcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYm9keSA9IGAke2hlYWRlcn1cXG5cXG4ke3NlY3Rpb25zLmpvaW4oJ1xcblxcbi0tLVxcblxcbicpfVxcblxcbi0tLVxcblxcbiR7Zm9vdGVyfWA7XG4gIHJldHVybiBgXFxuPGdpdC1zcGFuPlxcbiR7Ym9keX1cXG48L2dpdC1zcGFuPlxcbmA7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaG9vayBlbnRyeSBwb2ludFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGluIHNjb3BlIGZvciB0aGUgcmVjb3ZlcmVkIHJhbmdlLiAqL1xuZnVuY3Rpb24gaW50ZXJzZWN0cyhyb3c6IFBvcmNlbGFpblJvdywgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyk6IGJvb2xlYW4ge1xuICBpZiAocmFuZ2UgPT09ICd3aG9sZS1maWxlJykgcmV0dXJuIHRydWU7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHRydWU7IC8vIHdob2xlLWZpbGUgYW5jaG9yXG4gIHJldHVybiByYW5nZXNJbnRlcnNlY3QocmFuZ2UsIHsgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH0pO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIHRvdWNoZWQgcmFuZ2UgZnJvbSB0aGUgb24tZGlzayBmaWxlIGZvciBhIHdyaXRlLiBBbiBlbXB0eSB3cml0ZSBvclxuICogYW4gdW5yZWFkYWJsZSBmaWxlIChlLmcuIGEgZGVsZXRlLCBvciB0aGUgZmlsZSB3YXMgbmV2ZXIgd3JpdHRlbikgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgLCBzY29waW5nIHRoZSB0b3VjaCB0byBldmVyeSBjb3ZlcmluZyBzcGFuIFx1MjAxNCB0aGUgZmFpbC1vcGVuXG4gKiBiZWhhdmlvciwgbm90IGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2VGcm9tRGlzayh3cml0dGVuOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcpOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGxldCBjb250ZW50OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICByZXR1cm4gcmVjb3ZlclJhbmdlKHdyaXR0ZW4sIGNvbnRlbnQpO1xufVxuXG4vKipcbiAqIFRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBkb2N1bWVudGVkIGRlZmF1bHQgbGluZSBjb3VudCB3aGVuIGBvZmZzZXRgIGlzXG4gKiBnaXZlbiB3aXRob3V0IGBsaW1pdGAgKFwiQnkgZGVmYXVsdCwgaXQgcmVhZHMgdXAgdG8gMjAwMCBsaW5lc1wiKS4gTmFtZWQgc29cbiAqIHRoZSBhc3N1bXB0aW9uIGlzIHZpc2libGUgYW5kIGVhc3kgdG8gdXBkYXRlIGlmIHRoYXQgZGVmYXVsdCBldmVyIGNoYW5nZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQURfTElNSVQgPSAyMDAwO1xuXG4vKipcbiAqIENvbXB1dGUgdGhlIHRvdWNoZWQgcmFuZ2UgZm9yIGEgcmVhZCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wnc1xuICogYG9mZnNldGAvYGxpbWl0YCBpbnB1dHMuIE5laXRoZXIgcHJlc2VudCBtZWFucyBhIGdlbnVpbmUgd2hvbGUtZmlsZSByZWFkIFx1MjAxNFxuICogZXZlcnkgY292ZXJpbmcgc3BhbiBzdGF5cyBpbiBzY29wZSwgbWF0Y2hpbmcgdG9kYXkncyBiZWhhdmlvci4gT3RoZXJ3aXNlXG4gKiB0aGUgcmFuZ2Ugc3RhcnRzIGF0IGBvZmZzZXRgIChkZWZhdWx0IGxpbmUgMSkgYW5kIHJ1bnMgZm9yIGBsaW1pdGAgbGluZXNcbiAqIChkZWZhdWx0IHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9KSwgY2xhbXBlZCB0byB0aGUgZmlsZSdzIGFjdHVhbCBsaW5lXG4gKiBjb3VudCBzbyBhIHNob3J0IGZpbGUgd2l0aCBhIGxhcmdlIGBvZmZzZXRgL2BsaW1pdGAgZG9lc24ndCBvdmVyc2hvb3QuXG4gKiBDbGFtcGluZyByZXF1aXJlcyByZWFkaW5nIHRoZSBmaWxlOyBhbiB1bnJlYWRhYmxlIGZpbGUgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgIFx1MjAxNCB0aGUgc2FtZSBmYWlsLW9wZW4gYmVoYXZpb3IgdGhlIHdyaXRlIHBhdGggdXNlcy5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJlYWRSYW5nZShcbiAgb2Zmc2V0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGxpbWl0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCAmJiBsaW1pdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBjb25zdCBzdGFydCA9IG9mZnNldCA/PyAxO1xuICBsZXQgbGluZUNvdW50OiBudW1iZXI7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICBsaW5lQ291bnQgPSBjb250ZW50Lmxlbmd0aCA9PT0gMCA/IDAgOiBjb250ZW50LnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyAobGltaXQgPz8gREVGQVVMVF9SRUFEX0xJTUlUKSAtIDEsIE1hdGgubWF4KGxpbmVDb3VudCwgc3RhcnQpKTtcbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgYW4gYW5jaG9yIGluIHRoZSB0b3VjaGVkIGZpbGUgaXRzZWxmLiBgbGlzdFxuICogLS1wb3JjZWxhaW4gPGZpbGU+YCByZXR1cm5zIGV2ZXJ5IGFuY2hvciBvZiBlYWNoIG1hdGNoaW5nIHNwYW4gXHUyMDE0IGNyb3NzLWZpbGVcbiAqIGFuY2hvcnMgaW5jbHVkZWQgXHUyMDE0IGJ1dCBvbmx5IGFuY2hvcnMgaW4gdGhlIHRvdWNoZWQgZmlsZSBwYXJ0aWNpcGF0ZSBpbiB0aGVcbiAqIHJhbmdlLWludGVyc2VjdGlvbiBzY29wZSB0ZXN0LiBSb3cgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmU7IHRoZSB0b3VjaGVkIHBhdGhcbiAqIGlzIGFic29sdXRlLCBzbyBtYXRjaCBvbiBhbiBleGFjdCBvciBgL2Atc2VwYXJhdGVkIHN1ZmZpeC5cbiAqL1xuZnVuY3Rpb24gb25Ub3VjaGVkRmlsZShyb3c6IFBvcmNlbGFpblJvdywgZmlsZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gZmlsZVBhdGggPT09IHJvdy5wYXRoIHx8IGZpbGVQYXRoLmVuZHNXaXRoKGAvJHtyb3cucGF0aH1gKTtcbn1cblxuLyoqXG4gKiBDb21wdXRlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGZvciB0aGUgdG91Y2gsIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzXG4gKiBub3RoaW5nIHdvcnRoIHN1cmZhY2luZy4gU2hhcmVkIGJ5IGJvdGggcGF0aHM7IHRoZSB3cml0ZSBwYXRoIHBhc3NlcyBhXG4gKiByZWNvdmVyZWQgcmFuZ2UgZm9yIHByZWNpc2lvbiwgdGhlIHJlYWQgcGF0aCBzY29wZXMgZmlsZS13aWRlLlxuICpcbiAqIEEgc3BhbiByZW5kZXJzIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiAobmFtZSwgYWxsIGFuY2hvcnMgd2l0aFxuICogZHJpZnRlZCBvbmVzIHN0YXR1cy1zdWZmaXhlZCwgd2h5KSB3aGVuIGl0cyBuYW1lIGhhcyBub3QgYmVlbiBzdXJmYWNlZCB0aGlzXG4gKiBzZXNzaW9uLCBvciB3aGVuIGl0IGNhcnJpZXMgYSBkcmlmdCBzdGF0dXMgbm90IHlldCBzdXJmYWNlZCBmb3IgaXQgXHUyMDE0IHNvIGFcbiAqIHNwYW4gZmlyc3Qgc2VlbiBoZWFsdGh5IHJlLXJlbmRlcnMgaW4gZnVsbCB3aGVuIGRyaWZ0IGxhdGVyIGFwcGVhcnMuIEEgc3BhblxuICogd2hvc2Ugb25seSBkcmlmdCBpcyBwb3NpdGlvbmFsIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgXHUyMDE0IG5ldmVyXG4gKiBgaXNEZWJ0YCkgaXMgZmlsdGVyZWQgb3V0IGVudGlyZWx5OiBwb3NpdGlvbmFsIGRyaWZ0IG5ldmVyIHN1cmZhY2VzLlxuICovXG5hc3luYyBmdW5jdGlvbiBjb21wdXRlU3VyZmFjZShcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJ1xuKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gIGlmIChjb3ZlcmluZy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIEdyb3VwIGV2ZXJ5IGFuY2hvciBieSBzcGFuOyBhIHNwYW4gaXMgaW4gc2NvcGUgd2hlbiBvbmUgb2YgaXRzIGFuY2hvcnMgb25cbiAgLy8gdGhlIHRvdWNoZWQgZmlsZSBpbnRlcnNlY3RzIHRoZSByZWNvdmVyZWQgcmFuZ2UuXG4gIGNvbnN0IGFuY2hvcnNCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGNvdmVyaW5nKSB7XG4gICAgY29uc3Qgcm93cyA9IGFuY2hvcnNCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBhbmNob3JzQnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cbiAgY29uc3QgdG91Y2hlZE5hbWVzID0gWy4uLmFuY2hvcnNCeU5hbWUua2V5cygpXS5maWx0ZXIoKG5hbWUpID0+XG4gICAgKGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdKS5zb21lKChyb3cpID0+IG9uVG91Y2hlZEZpbGUocm93LCBpbnB1dC5maWxlUGF0aCkgJiYgaW50ZXJzZWN0cyhyb3csIHJhbmdlKSlcbiAgKTtcbiAgaWYgKHRvdWNoZWROYW1lcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGRyaWZ0Um93cyA9IGF3YWl0IGV4ZWN1dG9ycy5kcmlmdChbaW5wdXQuZmlsZVBhdGhdLCBpbnB1dC5jd2QpO1xuICBjb25zdCBkcmlmdEJ5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBEcmlmdFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBkcmlmdFJvd3MpIHtcbiAgICBjb25zdCByb3dzID0gZHJpZnRCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBkcmlmdEJ5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG5cbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCk7XG4gIGNvbnN0IHRvUmVjb3JkOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzZWN0aW9uczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgbmFtZSBvZiB0b3VjaGVkTmFtZXMpIHtcbiAgICBjb25zdCBzcGFuRHJpZnQgPSBkcmlmdEJ5TmFtZS5nZXQobmFtZSkgPz8gW107XG4gICAgY29uc3QgZGVidFJvd3MgPSBzcGFuRHJpZnQuZmlsdGVyKChyb3cpID0+IGlzRGVidChyb3cuc3RhdHVzKSk7XG4gICAgaWYgKHNwYW5EcmlmdC5sZW5ndGggPiAwICYmIGRlYnRSb3dzLmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIHBvc2l0aW9uYWwtb25seSBkcmlmdCBuZXZlciBzdXJmYWNlc1xuXG4gICAgY29uc3QgZGVidFN0YXR1c2VzID0gWy4uLm5ldyBTZXQoZGVidFJvd3MubWFwKChyb3cpID0+IHJvdy5zdGF0dXMpKV0uc29ydCgpO1xuICAgIGNvbnN0IHVuc3VyZmFjZWREZWJ0ID0gZGVidFN0YXR1c2VzLmZpbHRlcigoc3RhdHVzKSA9PiAhc3VyZmFjZWQuaGFzKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpKTtcbiAgICBjb25zdCBpc05ld05hbWUgPSAhc3VyZmFjZWQuaGFzKG5hbWUpO1xuICAgIGlmICghaXNOZXdOYW1lICYmIHVuc3VyZmFjZWREZWJ0Lmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIGZ1bGx5IHN1cmZhY2VkIGFscmVhZHlcblxuICAgIGNvbnN0IHdoeSA9IGF3YWl0IGV4ZWN1dG9ycy53aHkobmFtZSwgaW5wdXQuY3dkKTtcbiAgICBzZWN0aW9ucy5wdXNoKHJlbmRlclNwYW5TZWN0aW9uKG5hbWUsIGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdLCBkZWJ0Um93cywgd2h5KSk7XG4gICAgaWYgKGRlYnRTdGF0dXNlcy5sZW5ndGggPiAwKSBkcmlmdGVkTmFtZXMucHVzaChuYW1lKTtcblxuICAgIGlmIChpc05ld05hbWUpIHRvUmVjb3JkLnB1c2gobmFtZSk7XG4gICAgZm9yIChjb25zdCBzdGF0dXMgb2YgdW5zdXJmYWNlZERlYnQpIHRvUmVjb3JkLnB1c2goZHJpZnRLZXkobmFtZSwgc3RhdHVzKSk7XG4gIH1cblxuICBpZiAoc2VjdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgbWVtby5hZGRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQsIHRvUmVjb3JkKTtcbiAgY29uc3QgZmlsZU5hbWUgPSBiYXNlbmFtZShpbnB1dC5maWxlUGF0aCk7XG4gIGNvbnN0IGhlYWRlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRIZWFkZXIoZHJpZnRlZE5hbWVzLmxlbmd0aCwgaW5wdXQua2luZCkgOiBjbGVhbkhlYWRlcihmaWxlTmFtZSk7XG4gIGNvbnN0IGZvb3RlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzKSA6IGNsZWFuRm9vdGVyKGZpbGVOYW1lKTtcbiAgcmV0dXJuIGJ1aWxkQmxvY2soc2VjdGlvbnMsIGhlYWRlciwgZm9vdGVyKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHRvdWNoIGhvb2sgZm9yIGEgc2luZ2xlIHRvb2wgY2FsbCwgYnJhbmNoaW5nIG9uIHtAbGluayBUb3VjaElucHV0LmtpbmR9LlxuICpcbiAqIC0gKipXcml0ZSBwYXRoKio6IHJ1biBgZXhlY3V0b3JzLmZpeGAgKGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgKSBzY29wZWRcbiAqICAgdG8gdGhlIHRvdWNoZWQgZmlsZSB0byBoZWFsIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSwgdGhlblxuICogICBjb21wdXRlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGFnYWluc3QgdGhlIGhlYWxlZCBhbmNob3JzLCByZW5kZXJpbmdcbiAqICAgZWFjaCBzdXJmYWNlZCBzcGFuIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiB3aXRoIGFueSByZW1haW5pbmdcbiAqICAgc2VtYW50aWMgZHJpZnQgc3RhdHVzLXN1ZmZpeGVkIG9uIGl0cyBhbmNob3JzLiBDYWRlbmNlIGlzIGRlZHVwZWQgdGhyb3VnaFxuICogICBgbWVtb2AgcGVyIHNwYW4gbmFtZSBhbmQgcGVyIChzcGFuLCBzdGF0dXMpLlxuICogLSAqKlJlYWQgcGF0aCoqOiBuZXZlciBpbnZva2VzIGBmaXhgIGFuZCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlOyBzdXJmYWNlcyB0aGVcbiAqICAgc3BhbnMgb3ZlcmxhcHBpbmcgdGhlIHJlYWQncyBgb2Zmc2V0YC9gbGltaXRgIHdpbmRvdyAoc2VlXG4gKiAgIHtAbGluayByZWNvdmVyUmVhZFJhbmdlfTsgYSByZWFkIHdpdGggbmVpdGhlciBpcyB3aG9sZS1maWxlLCBtYXRjaGluZ1xuICogICB0b2RheSdzIGJlaGF2aW9yKSB3aXRoIHBvc2l0aW9uYWwgc3RhdHVzZXMgZmlsdGVyZWQgb3V0IHZpYSBgaXNEZWJ0KClgLlxuICpcbiAqIEZhaWxzIG9wZW46IGFueSBleGVjdXRvciByZWplY3Rpb24gb3IgaW50ZXJuYWwgZXJyb3IgeWllbGRzXG4gKiBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgIChubyBzaWduYWwsIGVkaXRpbmcgbmV2ZXIgYmxvY2tlZCkgcmF0aGVyIHRoYW5cbiAqIHRocm93aW5nLiBgdHJlZU1vZGlmaWVkYCByZWZsZWN0cyBhIHN1Y2Nlc3NmdWwgYC0tZml4YCBldmVuIHdoZW4gdGhlXG4gKiBzdWJzZXF1ZW50IHN1cmZhY2UgY29tcHV0YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Ub3VjaEhvb2soXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmVcbik6IFByb21pc2U8VG91Y2hPdXRwdXQ+IHtcbiAgbGV0IHRyZWVNb2RpZmllZCA9IGZhbHNlO1xuICB0cnkge1xuICAgIGxldCByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnID0gJ3dob2xlLWZpbGUnO1xuICAgIGlmIChpbnB1dC5raW5kID09PSAnd3JpdGUnKSB7XG4gICAgICBjb25zdCBmaXggPSBhd2FpdCBleGVjdXRvcnMuZml4KGlucHV0LmZpbGVQYXRoLCBpbnB1dC5jd2QpO1xuICAgICAgdHJlZU1vZGlmaWVkID0gZml4Lm1vZGlmaWVkO1xuICAgICAgcmFuZ2UgPSByZWNvdmVyUmFuZ2VGcm9tRGlzayhpbnB1dC53cml0dGVuLCBpbnB1dC5maWxlUGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gcmVjb3ZlclJlYWRSYW5nZShpbnB1dC5vZmZzZXQsIGlucHV0LmxpbWl0LCBpbnB1dC5maWxlUGF0aCk7XG4gICAgfVxuICAgIGNvbnN0IGFkZGl0aW9uYWxDb250ZXh0ID0gYXdhaXQgY29tcHV0ZVN1cmZhY2UoaW5wdXQsIGV4ZWN1dG9ycywgbWVtbywgcmFuZ2UpO1xuICAgIHJldHVybiB7IGFkZGl0aW9uYWxDb250ZXh0LCB0cmVlTW9kaWZpZWQgfTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmFpbCBvcGVuOiBuZXZlciBsZXQgYSB0b3VjaC1jb3JlIGVycm9yIHByb3BhZ2F0ZSB1cCBhbmQgYmxvY2sgdGhlIHRvb2xcbiAgICAvLyBjYWxsLiBUaGUgdHJlZSBtYXkgYWxyZWFkeSBoYXZlIGJlZW4gaGVhbGVkICh0cmVlTW9kaWZpZWQgcHJlc2VydmVkKS5cbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dDogbnVsbCwgdHJlZU1vZGlmaWVkIH07XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9yc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDEwXzAwMDtcblxuLyoqIFJlc29sdmUgdGhlIHRvdWNoZWQgZmlsZSB0byBhIHBhdGggcmVsYXRpdmUgdG8gaXRzIHJlcG8gcm9vdCwgZm9yIGBnaXQgc3BhbmAuICovXG5mdW5jdGlvbiByZXBvUmVsQXJnKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKTogeyByZXBvUm9vdDogc3RyaW5nOyByZWxQYXRoOiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICBpZiAoIXJlcG9Sb290KSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgcmVwb1Jvb3QsIHJlbFBhdGg6IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBmaWxlUGF0aCkgfTtcbn1cblxuLyoqXG4gKiBBIHNuYXBzaG90IG9mIHRoZSBzcGFuIHJvb3QncyB3b3JraW5nLXRyZWUgc3RhdHVzLCB1c2VkIHRvIGRldGVjdCB3aGV0aGVyIGFcbiAqIGAtLWZpeGAgcmUtYW5jaG9yZWQgYW55dGhpbmcuIENvbXBhcmVkIGJlZm9yZS9hZnRlcjsgYW4gdW5yZXNvbHZhYmxlIHJlcG8gb3JcbiAqIGEgZmFpbGVkIHN0YXR1cyB5aWVsZHMgYSBzdGFibGUgZW1wdHkgc3RyaW5nIChcdTIxOTIgYG1vZGlmaWVkOiBmYWxzZWApLlxuICovXG5mdW5jdGlvbiBzcGFuU3RhdHVzU25hcHNob3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHNwYW5Sb290ID0gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdzdGF0dXMnLCAnLS1wb3JjZWxhaW4nLCAnLS0nLCBzcGFuUm9vdF0sIHtcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IERFRkFVTFRfVElNRU9VVF9NU1xuICAgIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcHJvZHVjdGlvbiBleGVjdXRpb24gc3VyZmFjZTogdGhyZWUgc3VicHJvY2Vzcy1iYWNrZWQgZXhlY3V0b3JzIGZvbGxvd2luZ1xuICogc3Bhbi1zdXJmYWNlLnRzJ3MgYGNyZWF0ZURlZmF1bHQqRXhlY3V0b3JgIHN0eWxlLiBFYWNoIGNhcHR1cmVzIHN0ZG91dCBldmVuIG9uXG4gKiBhIG5vbi16ZXJvIGV4aXQgd2hlcmUgdGhlIENMSSBzdGlsbCBlbWl0cyB1c2VmdWwgb3V0cHV0LCBhbmQgZXZlcnkgZmFpbHVyZVxuICogbW9kZSAoYWJzZW50IGJpbmFyeSwgdGltZW91dCwgcGFyc2UgZmFpbHVyZSkgc3VyZmFjZXMgYXMgYW4gZW1wdHkvY2xlYW4gcmVzdWx0XG4gKiBzbyB7QGxpbmsgcnVuVG91Y2hIb29rfSdzIGZhaWwtb3BlbiBjb250cmFjdCBob2xkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycyh0aW1lb3V0TXM6IG51bWJlciA9IERFRkFVTFRfVElNRU9VVF9NUyk6IFRvdWNoRXhlY3V0b3JzIHtcbiAgcmV0dXJuIHtcbiAgICBmaXg6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4geyBtb2RpZmllZDogZmFsc2UgfTtcbiAgICAgIGNvbnN0IGJlZm9yZSA9IHNwYW5TdGF0dXNTbmFwc2hvdChyZXNvbHZlZC5yZXBvUm9vdCk7XG4gICAgICB0cnkge1xuICAgICAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsIHJlc29sdmVkLnJlbFBhdGgsICctLWZpeCddLCB7XG4gICAgICAgICAgY3dkOiByZXNvbHZlZC5yZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAxIG9uIGRyaWZ0IGV2ZW4gd2hlbiBgLS1maXhgIGhlYWxlZCBzb21ldGhpbmcsXG4gICAgICAgIC8vIGFuZCBub24temVybyBvbiBnZW51aW5lIGZhaWx1cmU7IHRoZSBzbmFwc2hvdCBkaWZmIGlzIHRoZSBzb3VyY2Ugb2ZcbiAgICAgICAgLy8gdHJ1dGggZm9yIHdoZXRoZXIgdGhlIHRyZWUgY2hhbmdlZCwgc28gdGhlIGV4aXQgY29kZSBpcyBpZ25vcmVkIGhlcmUuXG4gICAgICB9XG4gICAgICBjb25zdCBhZnRlciA9IHNwYW5TdGF0dXNTbmFwc2hvdChyZXNvbHZlZC5yZXBvUm9vdCk7XG4gICAgICByZXR1cm4geyBtb2RpZmllZDogYmVmb3JlICE9PSBhZnRlciB9O1xuICAgIH0sXG5cbiAgICBsaXN0OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIFtdO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsICctLXBvcmNlbGFpbicsIHJlc29sdmVkLnJlbFBhdGhdLCB7XG4gICAgICAgICAgY3dkOiByZXNvbHZlZC5yZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBwYXJzZVBvcmNlbGFpbihvdXQpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgZHJpZnQ6IGFzeW5jIChhcmdzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBjb25zdCBydW5Dd2QgPSByZXBvUm9vdCA/PyBjd2Q7XG4gICAgICAvLyBUaGUgY29yZSBwYXNzZXMgYW4gYWJzb2x1dGUgZmlsZSBwYXRoOyBzY29wZSBgZ2l0IHNwYW4gZHJpZnRgIHRvIGl0XG4gICAgICAvLyByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290IHNvIHRoZSBwYXRoIGluZGV4IHJlc29sdmVzIGl0LlxuICAgICAgY29uc3Qgc2NvcGVkID0gcmVwb1Jvb3QgPyBhcmdzLm1hcCgoYSkgPT4gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGEpKSA6IGFyZ3M7XG4gICAgICBsZXQgb3V0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zY29wZWRdLCB7XG4gICAgICAgICAgY3dkOiBydW5Dd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnN0IGNhcHR1cmVkID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgIGlmICh0eXBlb2YgY2FwdHVyZWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgb3V0ID0gY2FwdHVyZWQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcGFyc2VEcmlmdFBvcmNlbGFpbihvdXQpO1xuICAgIH0sXG5cbiAgICB3aHk6IGFzeW5jIChuYW1lLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICd3aHknLCBuYW1lXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QgPz8gY3dkLFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgdGV4dCA9IG91dC50cmltRW5kKCk7XG4gICAgICAgIC8vIEJhcmUgYGdpdCBzcGFuIHdoeWAgcHJpbnRzIHRoaXMgZXhhY3Qgc2VudGluZWwgKGV4aXQgMCkgd2hlbiB0aGVcbiAgICAgICAgLy8gc3BhbiBoYXMgbm8gd2h5IHJlY29yZGVkIFx1MjAxNCB0cmVhdCBpdCBhcyBcIm5vIHdoeVwiLCBub3QgYXMgY29udGVudC5cbiAgICAgICAgaWYgKHRleHQubGVuZ3RoID09PSAwIHx8IHRleHQgPT09IGBcXGAke25hbWV9XFxgIGhhcyBubyB3aHkgcmVjb3JkZWQuYCkgcmV0dXJuIG51bGw7XG4gICAgICAgIHJldHVybiB0ZXh0O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBib3gtZHJhd2luZyB0cmVlIHJlbmRlcmVyIGZvciBhIHNwYW4ncyBhbmNob3IgbGlzdCwgdXNlZCBieSBldmVyeVxuICogY2FsbCBzaXRlIHRoYXQgdG9kYXkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xzdGFydC1MZW5kYCBidWxsZXQgcnVuXG4gKiAoYHRvdWNoLWNvcmUudHNgJ3MgYGFuY2hvckJ1bGxldHNgLCBhbmQgYGFkdmlzb3ItY29yZS50c2Anc1xuICogYGFubm90YXRlQmxvY2tzYC9gZ3JvdXBDb3ZlcmluZ0J5TmFtZWApLiBBbmNob3JzIHRoYXQgc2hhcmUgYSBkaXJlY3RvcnlcbiAqIHByZWZpeCBjb2xsYXBzZSBpbnRvIG9uZSB0cmVlIGluc3RlYWQgb2YgYmVpbmcgcmVjb25zdHJ1Y3RlZCBieSBleWUgZnJvbSBhXG4gKiBmbGF0IGxpc3QgXHUyMDE0IHRoZSBtb3RpdmF0aW5nIGNhc2UgaXMgcGFyaXR5IGFuY2hvcnMgdW5kZXIgcGFyYWxsZWxcbiAqIGBwdWJsaWMvY2xhdWRlLy4uLmAvYHB1YmxpYy9jb2RleC8uLi5gIHRyZWVzLlxuICpcbiAqIFRoaXMgbW9kdWxlIGlzIGEgcHVyZSBwcmVzZW50YXRpb24gdHJhbnNmb3JtOiBpdCBuZXZlciBjb21wdXRlcyBkcmlmdFxuICogc3RhdHVzIG9yIGRlY2lkZXMgd2hpY2ggYW5jaG9ycyBhcmUgc3VyZmFjZWQuIENhbGxlcnMgcHJlY29tcHV0ZSBlYWNoIHJvdydzXG4gKiBgc3VmZml4YCAoZS5nLiBgIFx1MjAxNCBjaGFuZ2VkYCkgZXhhY3RseSBhcyB0aGV5IGRvIHRvZGF5LCBhbmQgb25seSB0aGUgKnNoYXBlKlxuICogb2YgdGhlIHByaW50ZWQgbGlzdCBjaGFuZ2VzLlxuICovXG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIHR5cGVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBIb3cgYSBzaW5nbGUgYW5jaG9yJ3MgbGluZSByYW5nZSBpcyBrbm93bi4gYHJhbmdlYCBhbmQgYHdob2xlLWZpbGVgIGFyZSB0aGVcbiAqIHR3byBzaGFwZXMgZXZlcnkgYW5jaG9yIHRha2VzIHRvZGF5OyBgdHJ1bmNhdGVkYCBpcyBhIGRlZmVuc2l2ZSB0aGlyZCBzaGFwZVxuICogcmVhY2hhYmxlIG9ubHkgZnJvbSByZS1wYXJzaW5nIHRoZSBDTEkncyBmbGF0IGh1bWFuLWZvcm1hdCB0ZXh0IChhIGAjTGBcbiAqIGZyYWdtZW50IHRoYXQgZG9lc24ndCBjbGVhbmx5IG1hdGNoIGAjTHN0YXJ0LUxlbmRgKS5cbiAqXG4gKiBWZXJpZmllZCBpbnZhcmlhbnQ6IHRoZSBzdHJ1Y3R1cmVkLWRhdGEgY2FsbCBzaXRlcyBjYW4gbmV2ZXIgcHJvZHVjZVxuICogYHRydW5jYXRlZGAuIGBwYXJzZVBvcmNlbGFpbmAgKGFnZW50LWhvb2tzLWNvbW1vbi50cykgYGNvbnRpbnVlYHMgcGFzdCBhbnlcbiAqIHJvdyBtaXNzaW5nIGEgdmFsaWQgcmFuZ2UsIHNvIGFuIGluY29tcGxldGUgYFBvcmNlbGFpblJvd2AgY2FuIG5ldmVyIGJlXG4gKiBjb25zdHJ1Y3RlZDsgdGhlIFJ1c3QgQ0xJJ3Mgb3duIHBvcmNlbGFpbiB3cml0ZXIgYWx3YXlzIGVtaXRzIGEgcmFuZ2VcbiAqIGNvbHVtbiAoYDAtMGAgZm9yIHdob2xlLWZpbGUpLiBgdHJ1bmNhdGVkYCBpcyByZWFjaGFibGUgb25seSBmcm9tXG4gKiBgYW5ub3RhdGVCbG9ja3NgJyBmbGF0LXRleHQgcGFyc2luZyBvZiBgYmxvY2tzVGV4dGAgaW4gYSBsYXRlciBwaGFzZS5cbiAqL1xuZXhwb3J0IHR5cGUgUmFuZ2VMYWJlbCA9IHsga2luZDogJ3JhbmdlJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfSB8IHsga2luZDogJ3dob2xlLWZpbGUnIH0gfCB7IGtpbmQ6ICd0cnVuY2F0ZWQnIH07XG5cbi8qKiBPbmUgc3RhY2tlZCByYW5nZSB1bmRlciBhIGBUcmVlQW5jaG9yYCwgd2l0aCBpdHMgcHJlY29tcHV0ZWQgZHJpZnQgc3VmZml4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBSYW5nZUVudHJ5IHtcbiAgcmFuZ2U6IFJhbmdlTGFiZWw7XG4gIC8qKiBQcmVjb21wdXRlZCBgIFx1MjAxNCBjaGFuZ2VkYCAoZXRjLiksIG9yIGAnJ2Agd2hlbiB0aGUgYW5jaG9yIGNhcnJpZXMgbm8gZHJpZnQuICovXG4gIHN1ZmZpeDogc3RyaW5nO1xufVxuXG4vKiogT25lIGRpc3RpbmN0IHBhdGgncyBjb2xsYXBzZWQgYW5jaG9yIGVudHJ5LCByZWFkeSBmb3IgdHJlZSBsYXlvdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRyZWVBbmNob3Ige1xuICAvKiogUmVwby1yZWxhdGl2ZSwgcG9zaXgtc2VwYXJhdGVkIHBhdGguICovXG4gIHBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIFN0YWNrZWQgcmFuZ2VzIG9uIHRoaXMgcGF0aC4gRW1wdHkgbWVhbnMgXCJwYXRoIG9ubHksIG5vIHJhbmdlIGNvbHVtbiBhdFxuICAgKiBhbGxcIiBcdTIwMTQgYSBiYXJlLXBhdGggbGVhZiwgZGlzdGluY3QgZnJvbSBhIHNpbmdsZSBgd2hvbGUtZmlsZWAgZW50cnkgKHdoaWNoXG4gICAqIHJlbmRlcnMgdGhlIHBhdGggdG9vLCBidXQgaXMgYW4gZXhwbGljaXQgcmFuZ2Uta2luZCBjbGFzc2lmaWNhdGlvbikuXG4gICAqL1xuICByYW5nZXM6IFJhbmdlRW50cnlbXTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBjb2xsYXBzZUJ5UGF0aFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ29sbGFwc2Ugcm93cyB0aGF0IG5hbWUgdGhlIHNhbWUgcGF0aCBpbnRvIG9uZSBgVHJlZUFuY2hvcmAgd2l0aCBzdGFja2VkXG4gKiByYW5nZXMsIHByZXNlcnZpbmcgZmlyc3Qtc2VlbiBvcmRlci4gYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXNcbiAqIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXIgZGlzdGluY3QgcGF0aCBcdTIwMTQgdGhpcyBpcyB0aGUgbWFuZGF0b3J5XG4gKiBwcmUtcHJvY2Vzc2luZyBzdGVwIGV2ZXJ5IGNhbGxlciBydW5zIGZpcnN0IHRvIGd1YXJhbnRlZSB0aGF0LlxuICpcbiAqIE1pcnJvcnMgdGhlIG9yZGVyLWFycmF5LXBsdXMtTWFwIGlkaW9tIGFscmVhZHkgdXNlZCBieVxuICogYGRlZHVwZUJ5QW5jaG9yKClgIChhZHZpc29yLWNvcmUudHMpIGZvciB0aGUgc2FtZSByZWFzb246IHRoZSBDTEkgY2FuIGVtaXRcbiAqIG11bHRpcGxlIHJvd3MgZm9yIG9uZSBsb2dpY2FsIHBhdGgsIGFuZCB0aGUgKnBvc2l0aW9uKiBvZiBhIGxhdGVyXG4gKiBzYW1lLXBhdGggcm93IGlzIHN1YnN1bWVkIGludG8gdGhhdCBwYXRoJ3MgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGFwcGVuZGVkXG4gKiBhdCBpdHMgb3duIGxhdGVyIHBvc2l0aW9uLiBDb25jcmV0ZWx5OiBgYS50cyNMMS1MNWAsIGBiLnRzI0wxLUw1YCxcbiAqIGBhLnRzI0w5LUwxMmAgY29sbGFwc2VzIHRvIGBbYS50cyAodHdvIHN0YWNrZWQgcmFuZ2VzKSwgYi50cyAob25lIHJhbmdlKV1gXG4gKiBcdTIwMTQgYGEudHNgIHNpdHMgYXQgcG9zaXRpb24gMCwgaXRzIGZpcnN0IG9jY3VycmVuY2UsIG5vdCBpdHMgbGFzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbGxhcHNlQnlQYXRoKHJvd3M6IHsgcGF0aDogc3RyaW5nOyByYW5nZTogUmFuZ2VMYWJlbDsgc3VmZml4OiBzdHJpbmcgfVtdKTogVHJlZUFuY2hvcltdIHtcbiAgY29uc3Qgb3JkZXI6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGJ5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBUcmVlQW5jaG9yPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgbGV0IGFuY2hvciA9IGJ5UGF0aC5nZXQocm93LnBhdGgpO1xuICAgIGlmICghYW5jaG9yKSB7XG4gICAgICBhbmNob3IgPSB7IHBhdGg6IHJvdy5wYXRoLCByYW5nZXM6IFtdIH07XG4gICAgICBieVBhdGguc2V0KHJvdy5wYXRoLCBhbmNob3IpO1xuICAgICAgb3JkZXIucHVzaChyb3cucGF0aCk7XG4gICAgfVxuICAgIGFuY2hvci5yYW5nZXMucHVzaCh7IHJhbmdlOiByb3cucmFuZ2UsIHN1ZmZpeDogcm93LnN1ZmZpeCB9KTtcbiAgfVxuICByZXR1cm4gb3JkZXIubWFwKChwYXRoKSA9PiBieVBhdGguZ2V0KHBhdGgpIGFzIFRyZWVBbmNob3IpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRyZWUgY29uc3RydWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIExlYWZOb2RlIHtcbiAga2luZDogJ2xlYWYnO1xuICBuYW1lOiBzdHJpbmc7XG4gIGFuY2hvcjogVHJlZUFuY2hvcjtcbn1cblxuaW50ZXJmYWNlIERpck5vZGUge1xuICBraW5kOiAnZGlyJztcbiAgbmFtZTogc3RyaW5nO1xuICBjaGlsZHJlbjogUGF0aFRyZWVOb2RlW107XG59XG5cbnR5cGUgUGF0aFRyZWVOb2RlID0gTGVhZk5vZGUgfCBEaXJOb2RlO1xuXG4vKipcbiAqIFNwbGl0IGEgcGF0aCBpbnRvIGAvYC1zZXBhcmF0ZWQgc2VnbWVudHMsIG9yIGBudWxsYCB3aGVuIGRvaW5nIHNvIHdvdWxkXG4gKiBmZWVkIGFuIGVtcHR5LXN0cmluZyBzZWdtZW50IGludG8gdGhlIHRyaWUgKGEgbGVhZGluZyBgL2AsIGEgdHJhaWxpbmcgYC9gLFxuICogYSBkb3VibGVkIGAvL2AsIG9yIHRoZSBlbXB0eSBzdHJpbmcpLiBgbnVsbGAgc2lnbmFscyB0aGUgY2FsbGVyIHRvIHJlbmRlclxuICogdGhhdCBhbmNob3IncyBmdWxsIHBhdGggc3RyaW5nIGFzIGEgc2luZ2xlLCB1bnNwbGl0LCBhdG9taWMgdG9wLWxldmVsIGxlYWZcbiAqIGluc3RlYWQgb2YgYXR0ZW1wdGluZyB0byBuZXN0IGl0IFx1MjAxNCBhIGtub3duLWVudW1lcmFibGUgY2xhc3Mgb2YgbWFsZm9ybWVkXG4gKiBwYXRocyBnZXRzIGEgcmVhbCBydWxlIGhlcmUgcmF0aGVyIHRoYW4gdGhlIHNwbGl0IHJ1bm5pbmcgYW55d2F5IGFuZFxuICogZmFicmljYXRpbmcgYW4gZW1wdHktbmFtZWQgZGlyZWN0b3J5IG5vZGUuIEEgYmFyZSBmaWxlbmFtZSB3aXRoIG5vIGAvYCBhdFxuICogYWxsIHByb2R1Y2VzIGV4YWN0bHkgb25lIG5vbi1lbXB0eSBzZWdtZW50IGFuZCBpcyBoYW5kbGVkIGJ5IHRoZSBvcmRpbmFyeVxuICogcGF0aCBiZWxvdyAoaXQgYmVjb21lcyBhIHRvcC1sZXZlbCBsZWFmIHdpdGggbm8gZGlyZWN0b3J5IHRvIG5lc3QgdW5kZXIgXHUyMDE0XG4gKiBhbHJlYWR5IGF0b21pYywgbm8gc3BlY2lhbCBjYXNlIG5lZWRlZCkuXG4gKi9cbmZ1bmN0aW9uIHNwbGl0U2VnbWVudHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc2VnbWVudHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGlmIChzZWdtZW50cy5zb21lKChzZWdtZW50KSA9PiBzZWdtZW50Lmxlbmd0aCA9PT0gMCkpIHJldHVybiBudWxsO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbmZ1bmN0aW9uIGZpbmRPckNyZWF0ZURpcihwYXJlbnQ6IERpck5vZGUsIG5hbWU6IHN0cmluZyk6IERpck5vZGUge1xuICBmb3IgKGNvbnN0IGNoaWxkIG9mIHBhcmVudC5jaGlsZHJlbikge1xuICAgIGlmIChjaGlsZC5raW5kID09PSAnZGlyJyAmJiBjaGlsZC5uYW1lID09PSBuYW1lKSByZXR1cm4gY2hpbGQ7XG4gIH1cbiAgY29uc3Qgbm9kZTogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWUsIGNoaWxkcmVuOiBbXSB9O1xuICBwYXJlbnQuY2hpbGRyZW4ucHVzaChub2RlKTtcbiAgcmV0dXJuIG5vZGU7XG59XG5cbi8qKiBJbnNlcnQgb25lIGFuY2hvciBpbnRvIHRoZSB0cmllLCBjcmVhdGluZy9yZXVzaW5nIGRpcmVjdG9yeSBub2RlcyBpbiBhcnJpdmFsIG9yZGVyLiAqL1xuZnVuY3Rpb24gaW5zZXJ0QW5jaG9yKHJvb3Q6IERpck5vZGUsIHNlZ21lbnRzOiBzdHJpbmdbXSwgYW5jaG9yOiBUcmVlQW5jaG9yKTogdm9pZCB7XG4gIGxldCBjdXIgPSByb290O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnRzLmxlbmd0aCAtIDE7IGkrKykge1xuICAgIGN1ciA9IGZpbmRPckNyZWF0ZURpcihjdXIsIHNlZ21lbnRzW2ldKTtcbiAgfVxuICBjdXIuY2hpbGRyZW4ucHVzaCh7IGtpbmQ6ICdsZWFmJywgbmFtZTogc2VnbWVudHNbc2VnbWVudHMubGVuZ3RoIC0gMV0sIGFuY2hvciB9KTtcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgdG9wLWxldmVsIGZvcmVzdCBmcm9tIGEgYFRyZWVBbmNob3JbXWAgYWxyZWFkeSBjb2xsYXBzZWQgYnlcbiAqIGBjb2xsYXBzZUJ5UGF0aGAuIFNpYmxpbmcgb3JkZXIgaXMgbmV2ZXIgcmUtc29ydGVkIFx1MjAxNCBhIHBhdGggZWl0aGVyIG9wZW5zIGFcbiAqIG5ldyBub2RlIGF0IGl0cyBhcnJpdmFsIHBvc2l0aW9uIG9yIGlzIG5lc3RlZCB1bmRlciBhIGRpcmVjdG9yeSBub2RlXG4gKiBjcmVhdGVkL3JldXNlZCBhdCB0aGF0IGRpcmVjdG9yeSdzIG93biBmaXJzdC1vY2N1cnJlbmNlIHBvc2l0aW9uLlxuICovXG5mdW5jdGlvbiBidWlsZEZvcmVzdChhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBQYXRoVHJlZU5vZGVbXSB7XG4gIGNvbnN0IHJvb3Q6IERpck5vZGUgPSB7IGtpbmQ6ICdkaXInLCBuYW1lOiAnJywgY2hpbGRyZW46IFtdIH07XG4gIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcbiAgICBjb25zdCBzZWdtZW50cyA9IHNwbGl0U2VnbWVudHMoYW5jaG9yLnBhdGgpO1xuICAgIGlmIChzZWdtZW50cyA9PT0gbnVsbCkge1xuICAgICAgcm9vdC5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBhbmNob3IucGF0aCwgYW5jaG9yIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGluc2VydEFuY2hvcihyb290LCBzZWdtZW50cywgYW5jaG9yKTtcbiAgfVxuICByZXR1cm4gcm9vdC5jaGlsZHJlbjtcbn1cblxuLyoqIEEgbm9kZSBwYWlyZWQgd2l0aCB0aGUgKHBvc3NpYmx5IGZvbGRlZCkgbmFtZSBpdCBkaXNwbGF5cyBvbiBpdHMgb3duIGxpbmUuICovXG5pbnRlcmZhY2UgRGlzcGxheUl0ZW0ge1xuICBuYW1lOiBzdHJpbmc7XG4gIG5vZGU6IFBhdGhUcmVlTm9kZTtcbn1cblxuLyoqXG4gKiBGb2xkIGEgY2hhaW4gb2Ygc2luZ2xlLWNoaWxkIG5vZGVzIGludG8gb25lIGNvbWJpbmVkIG5hbWVcbiAqIChgcHVibGljL2NsYXVkZS9ydW50aW1lL3NraWxscy9jYXJkYCwgYGRpcnR5L21vZC5yc2AsXG4gKiBgLmRldmNvbnRhaW5lci9Eb2NrZXJmaWxlYCkuIEZvbGRpbmcgY29udGludWVzIHdoaWxlIHRoZSBjdXJyZW50IG5vZGUgaXMgYVxuICogZGlyZWN0b3J5IHdpdGggKipleGFjdGx5IG9uZSBjaGlsZCoqLCByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhhdCBjaGlsZCBpcyBhXG4gKiBkaXJlY3Rvcnkgb3IgYSBsZWFmOiBhIG5vZGUgd2l0aCBvbmUgY2hpbGQgY29udmV5cyBubyBncm91cGluZyBieVxuICogZGVmaW5pdGlvbiwgc28gZm9sZGluZyBpdCBsb3NlcyBubyBzdHJ1Y3R1cmUgd2hpbGUgcmVtb3ZpbmcgYSBsaW5lIHdob3NlXG4gKiBvbmx5IGNvbnRlbnQgaXMgYSBjb25uZWN0b3IuIFN0b3BzIGF0IHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2l0aCAyKyBjaGlsZHJlblxuICogKGV4cGFuZCBmcm9tIHRoZXJlKSBvciBhdCBhIGxlYWYgKHdoaWNoIHRoZW4gcmVuZGVycyB3aXRoIHRoZSBmb2xkZWQgbmFtZSkuXG4gKlxuICogRm9sZGluZyBsb25lICpsZWF2ZXMqIFx1MjAxNCBub3QganVzdCBsb25lIGRpcmVjdG9yaWVzIFx1MjAxNCBpcyB3aGF0IGtlZXBzIHRoZSB0cmVlXG4gKiBubyB0YWxsZXIgdGhhbiB0aGUgZmxhdCBidWxsZXQgbGlzdCBpdCByZXBsYWNlcywgYW5kIHdoYXQgbWFrZXMgYSBzaW5nbGVcbiAqIGFuY2hvciByZW5kZXIgYXMgdGhlIG9uZS1saW5lIHRyZWUgdGhlIHBsYW4gcHJvbWlzZXMgZXZlbiB3aGVuIGl0cyBwYXRoIGhhc1xuICogZGlyZWN0b3JpZXMgaW4gaXQuIEl0IGFsc28ga2VlcHMgdGhlIGRpc2NyaW1pbmF0aW5nIHNlZ21lbnQgb24gdGhlIHNhbWVcbiAqIGxpbmUgYXMgaXRzIHJhbmdlIChgZGlydHkvbW9kLnJzICNMMzkyLUwzOTlgKSBmb3IgYG1vZC5yc2AvYGluZGV4LnRzYFxuICogbGF5b3V0cywgd2hlcmUgdGhlIGZpbGVuYW1lIGFsb25lIGlkZW50aWZpZXMgbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gZm9sZENoYWluKG5vZGU6IFBhdGhUcmVlTm9kZSk6IERpc3BsYXlJdGVtIHtcbiAgbGV0IG5hbWUgPSBub2RlLm5hbWU7XG4gIGxldCBjdXIgPSBub2RlO1xuICB3aGlsZSAoY3VyLmtpbmQgPT09ICdkaXInICYmIGN1ci5jaGlsZHJlbi5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBjaGlsZCA9IGN1ci5jaGlsZHJlblswXTtcbiAgICBuYW1lID0gYCR7bmFtZX0vJHtjaGlsZC5uYW1lfWA7XG4gICAgY3VyID0gY2hpbGQ7XG4gIH1cbiAgcmV0dXJuIHsgbmFtZSwgbm9kZTogY3VyIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVuZGVyaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSYW5rIG9mIGEgc3RhY2tlZCBlbnRyeSdzIHJhbmdlIGtpbmQ6IGB3aG9sZS1maWxlYCBmaXJzdCwgdGhlbiBudW1lcmljXG4gKiBgcmFuZ2VgcywgdGhlbiBgdHJ1bmNhdGVkYC4gQSB3aG9sZS1maWxlIGFuY2hvciBpcyB0aGUgQ0xJJ3MgYDAtMGAgcm93IFx1MjAxNCBpdFxuICogY292ZXJzIHRoZSBlbnRpcmUgZmlsZSwgc28gaXQgc29ydHMgYWhlYWQgb2YgZXZlcnkgbGluZSByYW5nZSBvbiB0aGF0IGZpbGVcbiAqIHRoZSBzYW1lIHdheSBsaW5lIDAgd291bGQuIGB0cnVuY2F0ZWRgIGNhcnJpZXMgbm8gcG9zaXRpb24gYXQgYWxsIGFuZCBzb3J0c1xuICogbGFzdC5cbiAqL1xuZnVuY3Rpb24gcmFuZ2VSYW5rKHJhbmdlOiBSYW5nZUxhYmVsKTogbnVtYmVyIHtcbiAgc3dpdGNoIChyYW5nZS5raW5kKSB7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gMDtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gMTtcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuIDI7XG4gIH1cbn1cblxuLyoqXG4gKiBTdGFja2VkLXJhbmdlIG9yZGVyIGlzIGJ5IGtpbmQgcmFuayB0aGVuIG51bWVyaWMgKGBzdGFydGAgdGhlbiBgZW5kYCksXG4gKiBvdmVycmlkaW5nIGFycml2YWwgb3IgY29kZXBvaW50IG9yZGVyIFx1MjAxNCB0aGUgb25seSBzb3J0aW5nIHRoaXMgbW9kdWxlIGRvZXMsXG4gKiBhbmQgc2NvcGVkIHN0cmljdGx5IHRvIHJhbmdlcyBzdGFja2VkIG9uIG9uZSBwYXRoIChuZXZlciB0byBzaWJsaW5nIHBhdGhzXG4gKiBvciBkaXJlY3Rvcnkgb3JkZXIpLiBFcXVhbC1yYW5rZWQgZW50cmllcyAodHdvIGB0cnVuY2F0ZWRgcywgb3IgdHdvXG4gKiBpZGVudGljYWwgcmFuZ2VzKSBrZWVwIHRoZWlyIG93biByZWxhdGl2ZSBhcnJpdmFsIG9yZGVyLCBzaW5jZSB0aGUgc29ydCBpc1xuICogc3RhYmxlLlxuICovXG5mdW5jdGlvbiBjb21wYXJlUmFuZ2VFbnRyaWVzKGE6IFJhbmdlRW50cnksIGI6IFJhbmdlRW50cnkpOiBudW1iZXIge1xuICBjb25zdCByYW5rID0gcmFuZ2VSYW5rKGEucmFuZ2UpIC0gcmFuZ2VSYW5rKGIucmFuZ2UpO1xuICBpZiAocmFuayAhPT0gMCkgcmV0dXJuIHJhbms7XG4gIGlmIChhLnJhbmdlLmtpbmQgPT09ICdyYW5nZScgJiYgYi5yYW5nZS5raW5kID09PSAncmFuZ2UnKSB7XG4gICAgcmV0dXJuIGEucmFuZ2Uuc3RhcnQgLSBiLnJhbmdlLnN0YXJ0IHx8IGEucmFuZ2UuZW5kIC0gYi5yYW5nZS5lbmQ7XG4gIH1cbiAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogVGhlIHJhbmdlIGNvbHVtbidzIHRleHQsIG9yIGBudWxsYCB3aGVuIHRoZSBlbnRyeSBwcmludHMgYXMgYSBiYXJlIHBhdGhcbiAqIHdpdGggbm8gcmFuZ2UgY29sdW1uIGF0IGFsbC5cbiAqXG4gKiBBIGB3aG9sZS1maWxlYCBlbnRyeSBpcyB0aGUgb25lIGtpbmQgd2hvc2UgcmVuZGVyaW5nIGRlcGVuZHMgb24gY29udGV4dC5cbiAqIEFsb25lIG9uIGl0cyBwYXRoIGl0IHN0YXlzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIgXHUyMDE0IHRoYXQgaXMgd2hhdCB0aGVcbiAqIENMSSdzIG93biBmbGF0IGxpc3QgcHJpbnRzIGZvciBhIHdob2xlLWZpbGUgYW5jaG9yLCBhbmQgYWRkaW5nIGEgbWFya2VyXG4gKiB0aGVyZSB3b3VsZCBhbm5vdGF0ZSB0aGUgb3ZlcndoZWxtaW5nbHkgY29tbW9uIGNhc2UgZm9yIHRoZSBiZW5lZml0IG9mIHRoZVxuICogcmFyZSBvbmUuICpTdGFja2VkKiBiZWhpbmQgb3RoZXIgcmFuZ2VzIG9uIHRoZSBzYW1lIHBhdGggaXQgbXVzdCBjYXJyeSBhblxuICogZXhwbGljaXQgbWFya2VyOiB3aXRob3V0IG9uZSBpdCByZW5kZXJzIGFzIGEgY29udGludWF0aW9uIGxpbmUgaG9sZGluZ1xuICogbm90aGluZyBidXQgaW5kZW50YXRpb24gYW5kIGl0cyBkcmlmdCBzdWZmaXgsIHdoaWNoIGVyYXNlcyB0aGUgYW5jaG9yXG4gKiBvdXRyaWdodCB3aGVuIHRoZSBzdWZmaXggaXMgZW1wdHkgYW5kIFx1MjAxNCB3b3JzZSBcdTIwMTQgaGFuZ3MgaXRzIGAgXHUyMDE0IGNoYW5nZWRgXG4gKiB1bmRlciBhIG5laWdoYm91cmluZyByYW5nZSwgZXhhY3RseSB0aGUgdmlzdWFsIGdyYW1tYXIgdGhhdCBtZWFucyBcImFub3RoZXJcbiAqIHJhbmdlIG9uIHRoaXMgc2FtZSBmaWxlXCIuIFRoZSByZWFkZXIgd291bGQgdGhlbiByZWNvbmNpbGUgdGhlIHJhbmdlIHRoYXRcbiAqIGRpZCBub3QgZHJpZnQuIE9mIHRoZSB0aHJlZSBmaXhlcyBhdmFpbGFibGUgKHByaW50IHRoZSBwYXRoIG9uXG4gKiBjb250aW51YXRpb24gbGluZXMsIHNvcnQgd2hvbGUtZmlsZSB0byBwb3NpdGlvbiAwLCBvciBzcGxpdCBpdCBpbnRvIGl0cyBvd25cbiAqIGxlYWYpLCBhbiBleHBsaWNpdCBtYXJrZXIgaXMgdGhlIG9ubHkgb25lIHRoYXQgbWFrZXMgdGhlIGVudHJ5IGlkZW50aWZpYWJsZVxuICogaW4gKmV2ZXJ5KiBwb3NpdGlvbiByYXRoZXIgdGhhbiBvbmx5IGluIHRoZSBwb3NpdGlvbiB0aGUgc29ydCBoYXBwZW5zIHRvXG4gKiBwdXQgaXQgaW47IHNvcnRpbmcgaXQgZmlyc3QgKHNlZSB7QGxpbmsgcmFuZ2VSYW5rfSkgaXMga2VwdCBhcyB3ZWxsIGJlY2F1c2VcbiAqIFwid2hvbGUgZmlsZSwgdGhlbiBpdHMgcmFuZ2VzIGluIGxpbmUgb3JkZXJcIiBpcyB0aGUgb3JkZXIgYSByZWFkZXIgZXhwZWN0cyxcbiAqIG5vdCBiZWNhdXNlIGlkZW50aWZpYWJpbGl0eSBkZXBlbmRzIG9uIGl0LlxuICovXG5mdW5jdGlvbiBsYWJlbEZvcihyYW5nZTogUmFuZ2VMYWJlbCwgc29sZTogYm9vbGVhbik6IHN0cmluZyB8IG51bGwge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gYCNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gc29sZSA/IG51bGwgOiAnKHdob2xlIGZpbGUpJztcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuICcodHJ1bmNhdGVkIGluIHNvdXJjZSBcdTIwMTQgYW5jaG9yIGluY29tcGxldGUpJztcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbHVtbiBtYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgZ3JhcGhlbWUgc2VnbWVudGVyLCBjb25zdHJ1Y3RlZCBvbiBmaXJzdCB1c2UgYW5kIHRoZW4gY2FjaGVkIFx1MjAxNCBpbmNsdWRpbmdcbiAqIGEgY2FjaGVkIGBudWxsYCB3aGVuIGl0IGNhbm5vdCBiZSBjb25zdHJ1Y3RlZCBhdCBhbGwuXG4gKlxuICogTGF6eSBvbiBwdXJwb3NlLiBgSW50bGAgaXMgbm90IHBhcnQgb2YgdGhlIEphdmFTY3JpcHQgbGFuZ3VhZ2UgY29yZTogYSBOb2RlXG4gKiBidWlsdCBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgd2hhdHNvZXZlciwgYW5kIGBob29rcy5qc29uYFxuICogaW52b2tlcyBhIGJhcmUgYG5vZGVgIG9mZiB0aGUgdXNlcidzIGBQQVRIYCwgc28gYGVuZ2luZXMubm9kZWAgY29uc3RyYWluc1xuICogbm90aGluZyBoZXJlLiBDb25zdHJ1Y3RpbmcgdGhpcyBhdCBtb2R1bGUgc2NvcGUgcHV0IGEgYFJlZmVyZW5jZUVycm9yYCBpblxuICogdGhlIGJ1bmRsZXMnIHRvcC1sZXZlbCBzdGF0ZW1lbnRzLCB3aGVyZSBpdCB0aHJvd3MgYXQgKmltcG9ydCogXHUyMDE0IGJlZm9yZSBhbnlcbiAqIG9mIHRoZSBmYWlsLWNsb3NlZCBgdHJ5L2NhdGNoYCBibG9ja3MgaW4gYHJlbmRlckFuY2hvclJ1bmAsIGByZW5kZXJQYXRoUnVuYFxuICogYW5kIGBhbmNob3JCdWxsZXRzYCBleGlzdCB0byBjYXRjaCBpdC4gVGhlIGhvb2sgcHJvY2VzcyB0aGVuIGRpZWQgd2l0aCBleGl0XG4gKiAxLCB3aGljaCBDbGF1ZGUgQ29kZSB0cmVhdHMgYXMgYSBub24tYmxvY2tpbmcgaG9vayBlcnJvcjogdGhlIGNvbW1pdCBnYXRlXG4gKiBzaWxlbnRseSBhbGxvd2VkIHRoZSBjb21taXQgYW5kIHRoZSBkcmlmdCByZW1pbmRlciBzaWxlbnRseSB2YW5pc2hlZC5cbiAqIEJ1aWxkaW5nIGl0IGluc2lkZSB0aGUgcmVuZGVyIHBhdGggcHV0cyBhbnkgZmFpbHVyZSBiYWNrIGluc2lkZSB0aG9zZVxuICogY2F0Y2hlcy5cbiAqXG4gKiBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCB0aGUgc2FtZSBjYXRlZ29yeSBhc1xuICogdGhlIGxvY2FsIGB0cnkvY2F0Y2hgIGJsb2NrcyBhdCB0aGlzIG1vZHVsZSdzIGNhbGwgc2l0ZXMsIGFuZCBsb2FkLWJlYXJpbmdcbiAqIGZvciB0aGUgc2FtZSByZWFzb24uIE5vdGhpbmcgaW4gdGhlIGNvbHVtbi1hbGlnbm1lbnQgcGF0aCBtYXkgYmUgYWJsZSB0b1xuICogY29zdCB0aGUgY29tbWl0IGdhdGUgb3IgdGhlIGRyaWZ0IHJlbWluZGVyOiBpZiBkaXNwbGF5IHdpZHRoIGNhbm5vdCBiZVxuICogbWVhc3VyZWQsIHRoZSBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGdhdGUgc3RpbGwgaG9sZHM7IG9ubHkgYWxpZ25tZW50IGlzXG4gKiBsb3N0LlxuICovXG5sZXQgY2FjaGVkU2VnbWVudGVyOiB7IHZhbHVlOiBJbnRsLlNlZ21lbnRlciB8IG51bGwgfSB8IHVuZGVmaW5lZDtcblxuZnVuY3Rpb24gZ3JhcGhlbWVTZWdtZW50ZXIoKTogSW50bC5TZWdtZW50ZXIgfCBudWxsIHtcbiAgaWYgKGNhY2hlZFNlZ21lbnRlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG5ldyBJbnRsLlNlZ21lbnRlcignZW4nLCB7IGdyYW51bGFyaXR5OiAnZ3JhcGhlbWUnIH0pIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICBjYWNoZWRTZWdtZW50ZXIgPSB7IHZhbHVlOiBudWxsIH07XG4gICAgfVxuICB9XG4gIHJldHVybiBjYWNoZWRTZWdtZW50ZXIudmFsdWU7XG59XG5cbi8qKlxuICogQ29kZSBwb2ludCByYW5nZXMgcmVuZGVyZWQgdHdvIGNvbHVtbnMgd2lkZTogdGhlIEVhc3QgQXNpYW4gV2lkZSAoVykgYW5kXG4gKiBGdWxsd2lkdGggKEYpIGJsb2NrcyBvZiBVQVggIzExLCBwbHVzIHRoZSBlbW9qaSBibG9ja3MgdGhhdCB0ZXJtaW5hbHMgYW5kXG4gKiBwcm9wb3J0aW9uYWwgYWdlbnQtZmFjaW5nIHJlbmRlcmVycyBib3RoIGdpdmUgZG91YmxlIHdpZHRoLiBFdmVyeXRoaW5nIGVsc2VcbiAqIGNvdW50cyBhcyBvbmUgY29sdW1uLlxuICpcbiAqIFNvcnRlZCBhc2NlbmRpbmcgYW5kIG5vbi1vdmVybGFwcGluZyBcdTIwMTQge0BsaW5rIGlzV2lkZUNvZGVQb2ludH0gc2hvcnQtY2lyY3VpdHNcbiAqIG9uIHRoZSBmaXJzdCByYW5nZSBzdGFydGluZyBwYXN0IHRoZSBjb2RlIHBvaW50LlxuICovXG5jb25zdCBXSURFX1JBTkdFUzogcmVhZG9ubHkgKHJlYWRvbmx5IFtudW1iZXIsIG51bWJlcl0pW10gPSBbXG4gIFsweDExMDAsIDB4MTE1Zl0sXG4gIFsweDIzMjksIDB4MjMyYV0sXG4gIFsweDI2MDAsIDB4MjdiZl0sXG4gIFsweDJlODAsIDB4MzAzZV0sXG4gIFsweDMwNDEsIDB4MzNmZl0sXG4gIFsweDM0MDAsIDB4NGRiZl0sXG4gIFsweDRlMDAsIDB4OWZmZl0sXG4gIFsweGEwMDAsIDB4YTRjZl0sXG4gIFsweGE5NjAsIDB4YTk3Zl0sXG4gIFsweGFjMDAsIDB4ZDdhM10sXG4gIFsweGY5MDAsIDB4ZmFmZl0sXG4gIFsweGZlMTAsIDB4ZmUxOV0sXG4gIFsweGZlMzAsIDB4ZmU2Zl0sXG4gIFsweGZmMDAsIDB4ZmY2MF0sXG4gIFsweGZmZTAsIDB4ZmZlNl0sXG4gIFsweDE3MDAwLCAweDE4YWZmXSxcbiAgWzB4MWYxZTYsIDB4MWYxZmZdLFxuICBbMHgxZjMwMCwgMHgxZjY0Zl0sXG4gIFsweDFmNjgwLCAweDFmNmZmXSxcbiAgWzB4MWY5MDAsIDB4MWY5ZmZdLFxuICBbMHgxZmE3MCwgMHgxZmFmZl0sXG4gIFsweDIwMDAwLCAweDJmZmZkXSxcbiAgWzB4MzAwMDAsIDB4M2ZmZmRdXG5dO1xuXG5mdW5jdGlvbiBpc1dpZGVDb2RlUG9pbnQoY3A6IG51bWJlcik6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IFtsbywgaGldIG9mIFdJREVfUkFOR0VTKSB7XG4gICAgaWYgKGNwIDwgbG8pIHJldHVybiBmYWxzZTtcbiAgICBpZiAoY3AgPD0gaGkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBEaXNwbGF5IHdpZHRoIG9mIGEgbmFtZSBpbiB0ZXJtaW5hbCBjb2x1bW5zIFx1MjAxNCB0aGUgdW5pdCB0aGUgcmFuZ2UgY29sdW1uIGlzXG4gKiBhY3R1YWxseSBhbGlnbmVkIGluLiBNZWFzdXJlZCBvdmVyIGdyYXBoZW1lIGNsdXN0ZXJzIChzbyBhIGRlY29tcG9zZWQgYFx1MDBFOWBcbiAqIG9yIGEgY29tYmluaW5nLW1hcmsgc2VxdWVuY2UgY291bnRzIG9uY2UsIG5vdCBvbmNlIHBlciBjb2RlIHBvaW50KSwgd2l0aFxuICogZWFjaCBjbHVzdGVyIGNvbnRyaWJ1dGluZyB0d28gY29sdW1ucyB3aGVuIGl0cyBiYXNlIGNvZGUgcG9pbnQgaXMgRWFzdFxuICogQXNpYW4gV2lkZS9GdWxsd2lkdGggb3IgZW1vamkgYW5kIG9uZSBvdGhlcndpc2UuXG4gKlxuICogTmVpdGhlciBVVEYtMTYgYC5sZW5ndGhgIG5vciBgQXJyYXkuZnJvbShuYW1lKS5sZW5ndGhgIGlzIHRoaXMgdW5pdDogdGhlXG4gKiBmaXJzdCBvdmVyLWNvdW50cyBhIHN1cnJvZ2F0ZSBwYWlyLCB0aGUgc2Vjb25kIHVuZGVyLWNvdW50cyBhIENKSyBpZGVvZ3JhcGhcbiAqIGFuZCBvdmVyLWNvdW50cyBhIGRlY29tcG9zZWQgYWNjZW50LlxuICpcbiAqIFdoZW4ge0BsaW5rIGdyYXBoZW1lU2VnbWVudGVyfSBpcyB1bmF2YWlsYWJsZSAoYSBOb2RlIGJ1aWx0XG4gKiBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgYXQgYWxsKSwgdGhpcyBkZWdyYWRlcyB0byB0aGUgY3J1ZGVyXG4gKiBwZXItY29kZS1wb2ludCBtZWFzdXJlIHJhdGhlciB0aGFuIHRocm93aW5nLiBUaGF0IG1lYXN1cmUgb3Zlci1jb3VudHMgYVxuICogZGVjb21wb3NlZCBhY2NlbnQgYW5kIGEgcmVnaW9uYWwtaW5kaWNhdG9yIGZsYWcgcGFpciwgc28gYWxpZ25tZW50IGNhbiBiZSBhXG4gKiBjb2x1bW4gb3IgdHdvIG9mZiBcdTIwMTQgd2hpY2ggaXMgdGhlIGVudGlyZSBjb3N0LCBhbmQgaXMgdGhlIGNvcnJlY3QgcHJpY2UgdG9cbiAqIHBheTogdGhlIGFuY2hvciBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGNvbW1pdCBnYXRlIHN0aWxsIGhvbGRzLlxuICovXG5mdW5jdGlvbiBkaXNwbGF5V2lkdGgobmFtZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3Qgc2VnbWVudGVyID0gZ3JhcGhlbWVTZWdtZW50ZXIoKTtcbiAgbGV0IHdpZHRoID0gMDtcbiAgaWYgKHNlZ21lbnRlciA9PT0gbnVsbCkge1xuICAgIGZvciAoY29uc3QgY29kZVBvaW50IG9mIG5hbWUpIHtcbiAgICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChjb2RlUG9pbnQuY29kZVBvaW50QXQoMCkgPz8gMCkgPyAyIDogMTtcbiAgICB9XG4gICAgcmV0dXJuIHdpZHRoO1xuICB9XG4gIGZvciAoY29uc3QgeyBzZWdtZW50IH0gb2Ygc2VnbWVudGVyLnNlZ21lbnQobmFtZSkpIHtcbiAgICB3aWR0aCArPSBpc1dpZGVDb2RlUG9pbnQoc2VnbWVudC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICB9XG4gIHJldHVybiB3aWR0aDtcbn1cblxuLyoqXG4gKiBBbGlnbm1lbnQgY2VpbGluZy4gQSBzaWJsaW5nIGdyb3VwIHdob3NlIHdpZGVzdCByYW5nZS1iZWFyaW5nIG5hbWUgZXhjZWVkc1xuICogdGhpcyB3aWR0aCBkb2VzIG5vdCBhbGlnbiBhdCBhbGwgXHUyMDE0IGV2ZXJ5IG5hbWUgaW4gaXQgdGFrZXMgYSBzaW5nbGUgc3BhY2VcbiAqIGJlZm9yZSBpdHMgcmFuZ2UuIFRoZSBhbHRlcm5hdGl2ZSAocGFkIHRoZSBzaG9ydCBuYW1lcyB0byB0aGUgY2VpbGluZyB3aGlsZVxuICogdGhlIGxvbmcgb25lIHNpdHMgYXQgaXRzIG93biBuYXR1cmFsIGNvbHVtbikgcGF5cyBtb3N0IG9mIHRoZSB3aWR0aCBmb3JcbiAqIGFsaWdubWVudCB0aGF0IGFsaWducyB3aXRoIG5vdGhpbmcsIHdoaWNoIGlzIHN0cmljdGx5IHdvcnNlIHRoYW4gbm90XG4gKiBhbGlnbmluZy4gTmFtZXMgdGhlbXNlbHZlcyBhcmUgbmV2ZXIgdHJ1bmNhdGVkIG9yIGVsaWRlZCBhdCBhbnkgd2lkdGguXG4gKi9cbmNvbnN0IE1BWF9BTElHTl9DT0xVTU4gPSA0ODtcblxuLyoqXG4gKiBUaGUgY29sdW1uIGV2ZXJ5IHJhbmdlLWJlYXJpbmcgbmFtZSBpbiB0aGlzIHNpYmxpbmcgZ3JvdXAgcGFkcyB0bywgb3IgYDBgXG4gKiB3aGVuIHRoZSBncm91cCBmb3Jnb2VzIGFsaWdubWVudCAobm8gcmFuZ2UtYmVhcmluZyBuYW1lcywgb3IgYSBuYW1lIHBhc3RcbiAqIHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSkuIEFsaWdubWVudCBzY29wZSBpcyB0aGUgZ3JvdXAncyBkaXJlY3QgY2hpbGRyZW5cbiAqIG9ubHksIG5ldmVyIHRoZSB3aG9sZSB0cmVlIFx1MjAxNCB3aG9sZS10cmVlIGFsaWdubWVudCB3b3VsZCBsZXQgb25lIGRlZXBseVxuICogbmVzdGVkIGxvbmcgbmFtZSBwYWQgZXZlcnkgdW5yZWxhdGVkIGJyYW5jaC5cbiAqL1xuZnVuY3Rpb24gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zOiBEaXNwbGF5SXRlbVtdKTogbnVtYmVyIHtcbiAgbGV0IG1heCA9IDA7XG4gIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnICYmIHByaW50c1JhbmdlQ29sdW1uKGl0ZW0ubm9kZS5hbmNob3IpKSB7XG4gICAgICBtYXggPSBNYXRoLm1heChtYXgsIGRpc3BsYXlXaWR0aChpdGVtLm5hbWUpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1heCA+IE1BWF9BTElHTl9DT0xVTU4gPyAwIDogbWF4O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhpcyBhbmNob3IgcHJpbnRzIGEgcmFuZ2UgY29sdW1uIGF0IGFsbCBcdTIwMTQgdGhlIGV4YWN0IGNvbmRpdGlvblxuICoge0BsaW5rIGxhYmVsRm9yfSBlbmNvZGVzLCBob2lzdGVkIHNvIHtAbGluayBjb21wdXRlR3JvdXBUYXJnZXR9IG1lYXN1cmVzIHRoZVxuICogc2FtZSBzZXQgb2YgbmFtZXMgaXQgcGFkcy4gQW4gYW5jaG9yIHdpdGggbm8gcmFuZ2VzLCBvciBhICpzb2xlKiB3aG9sZS1maWxlXG4gKiBlbnRyeSAod2hpY2ggcmVuZGVycyBhcyBhIGJhcmUgcGF0aCB3aXRoIHplcm8gbWFya2VyKSwgY29udHJpYnV0ZXMgbm8gcmFuZ2VcbiAqIGNvbHVtbiBhbmQgc28gbXVzdCBub3QgY29udHJpYnV0ZSB0byB0aGUgZ3JvdXAgbWF4IGVpdGhlcjogb3RoZXJ3aXNlIGFcbiAqIHdob2xlLWZpbGUgYW5jaG9yIG9uIGEgcGF0aCBwYXN0IHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSBzaWxlbnRseSBzdXBwcmVzc2VzXG4gKiBhbGlnbm1lbnQgZm9yIGl0cyByYW5nZS1iZWFyaW5nIHNpYmxpbmdzIHdoaWxlIGl0c2VsZiBwcmludGluZyBub3RoaW5nIHRvXG4gKiBhbGlnbi5cbiAqL1xuZnVuY3Rpb24gcHJpbnRzUmFuZ2VDb2x1bW4oYW5jaG9yOiBUcmVlQW5jaG9yKTogYm9vbGVhbiB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiByYW5nZXMuc29tZSgoZW50cnkpID0+IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCByYW5nZXMubGVuZ3RoID09PSAxKSAhPT0gbnVsbCk7XG59XG5cbi8qKiBUaGUgc3BhY2luZyBiZXR3ZWVuIGEgbmFtZSBvZiBgbmFtZVdpZHRoYCBjb2x1bW5zIGFuZCBpdHMgcmFuZ2UgY29sdW1uLiAqL1xuZnVuY3Rpb24gY29tcHV0ZVBhZChuYW1lV2lkdGg6IG51bWJlciwgdGFyZ2V0OiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAobmFtZVdpZHRoID49IHRhcmdldCkgcmV0dXJuICcgJztcbiAgcmV0dXJuICcgJy5yZXBlYXQodGFyZ2V0IC0gbmFtZVdpZHRoICsgMSk7XG59XG5cbi8qKlxuICogUmVuZGVyIG9uZSBsZWFmJ3MgbGluZShzKS4gQW4gZW1wdHkgYHJhbmdlc2AgYXJyYXkgaXMgYSBiYXJlLXBhdGggbGVhZiB3aXRoXG4gKiBubyByYW5nZSBjb2x1bW4gYXQgYWxsIChkaXN0aW5jdCBmcm9tIGEgYHdob2xlLWZpbGVgIGVudHJ5LCB3aGljaCBpcyBhblxuICogZXhwbGljaXQgY2xhc3NpZmljYXRpb24gdGhhdCBhbHNvIHByaW50cyB3aXRoIHplcm8gbWFya2VyIHdoZW4gaXQgc3RhbmRzXG4gKiBhbG9uZSwgYnV0IHRocm91Z2ggdGhlIHJhbmdlcyBwaXBlbGluZSkuIE11bHRpcGxlIHN0YWNrZWQgcmFuZ2VzIHByaW50XG4gKiB1bmRlciBhIGNvbnRpbnVhdGlvbiBwcmVmaXggaW5zdGVhZCBvZiByZXBlYXRpbmcgdGhlIG5hbWU7IGVhY2ggY2FycmllcyBpdHNcbiAqIG93biBzdWZmaXggaW5kZXBlbmRlbnRseSwgYW5kIGVhY2ggY2FycmllcyBhIGxhYmVsIGlkZW50aWZ5aW5nIHdoaWNoIGFuY2hvclxuICogdGhlIHN1ZmZpeCBiZWxvbmdzIHRvLlxuICovXG5mdW5jdGlvbiByZW5kZXJMZWFmTGluZXMoXG4gIG5hbWU6IHN0cmluZyxcbiAgYW5jaG9yOiBUcmVlQW5jaG9yLFxuICBvd25QcmVmaXg6IHN0cmluZyxcbiAgY2hpbGRQcmVmaXg6IHN0cmluZyxcbiAgZ3JvdXBUYXJnZXQ6IG51bWJlclxuKTogc3RyaW5nW10ge1xuICBjb25zdCB7IHJhbmdlcyB9ID0gYW5jaG9yO1xuICBpZiAocmFuZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtgJHtvd25QcmVmaXh9JHtuYW1lfWBdO1xuXG4gIGNvbnN0IHNvcnRlZCA9IFsuLi5yYW5nZXNdLnNvcnQoY29tcGFyZVJhbmdlRW50cmllcyk7XG4gIGNvbnN0IHNvbGUgPSBzb3J0ZWQubGVuZ3RoID09PSAxO1xuICBjb25zdCBuYW1lV2lkdGggPSBkaXNwbGF5V2lkdGgobmFtZSk7XG4gIGNvbnN0IHBhZCA9IGNvbXB1dGVQYWQobmFtZVdpZHRoLCBncm91cFRhcmdldCk7XG4gIGNvbnN0IGJsYW5rID0gJyAnLnJlcGVhdChuYW1lV2lkdGggKyBwYWQubGVuZ3RoKTtcblxuICByZXR1cm4gc29ydGVkLm1hcCgoZW50cnksIGkpID0+IHtcbiAgICBjb25zdCBsYWJlbCA9IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCBzb2xlKTtcbiAgICBpZiAobGFiZWwgPT09IG51bGwpIHJldHVybiBgJHtvd25QcmVmaXh9JHtuYW1lfSR7ZW50cnkuc3VmZml4fWA7XG4gICAgY29uc3QgYmFzZSA9IGkgPT09IDAgPyBgJHtvd25QcmVmaXh9JHtuYW1lfSR7cGFkfWAgOiBgJHtjaGlsZFByZWZpeH0ke2JsYW5rfWA7XG4gICAgcmV0dXJuIGAke2Jhc2V9JHtsYWJlbH0ke2VudHJ5LnN1ZmZpeH1gO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTm9kZXMobm9kZXM6IFBhdGhUcmVlTm9kZVtdLCBwcmVmaXg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGl0ZW1zID0gbm9kZXMubWFwKGZvbGRDaGFpbik7XG4gIGNvbnN0IGdyb3VwVGFyZ2V0ID0gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zKTtcbiAgaXRlbXMuZm9yRWFjaCgoaXRlbSwgaSkgPT4ge1xuICAgIGNvbnN0IGlzTGFzdCA9IGkgPT09IGl0ZW1zLmxlbmd0aCAtIDE7XG4gICAgY29uc3Qgb3duUHJlZml4ID0gYCR7cHJlZml4fSR7aXNMYXN0ID8gJ1x1MjUxNFx1MjUwMCAnIDogJ1x1MjUxQ1x1MjUwMCAnfWA7XG4gICAgY29uc3QgY2hpbGRQcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnICAgJyA6ICdcdTI1MDIgICd9YDtcbiAgICBpZiAoaXRlbS5ub2RlLmtpbmQgPT09ICdsZWFmJykge1xuICAgICAgbGluZXMucHVzaCguLi5yZW5kZXJMZWFmTGluZXMoaXRlbS5uYW1lLCBpdGVtLm5vZGUuYW5jaG9yLCBvd25QcmVmaXgsIGNoaWxkUHJlZml4LCBncm91cFRhcmdldCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaW5lcy5wdXNoKGAke293blByZWZpeH0ke2l0ZW0ubmFtZX0vYCk7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlck5vZGVzKGl0ZW0ubm9kZS5jaGlsZHJlbiwgY2hpbGRQcmVmaXgpKTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gbGluZXM7XG59XG5cbi8qKlxuICogUmVuZGVyIGEgY29sbGFwc2VkIGFuY2hvciBsaXN0IGFzIGEgYm94LWRyYXdpbmcgdHJlZSwgZ3JvdXBlZCBieSBzaGFyZWRcbiAqIHBhdGggcHJlZml4LiBFdmVyeSBhbmNob3IgbGlzdCByZW5kZXJzIGFzIGEgdHJlZSB1bmNvbmRpdGlvbmFsbHkgXHUyMDE0IGEgc2luZ2xlXG4gKiBhbmNob3IgYmVjb21lcyBhIG9uZS1saW5lIHRyZWUgd2hhdGV2ZXIgaXRzIGRlcHRoIChzZWUge0BsaW5rIGZvbGRDaGFpbn0pO1xuICogdGhlcmUgaXMgbm8gZmxhdC1idWxsZXQgcGF0aCBvciBzaXplIGZsb29yIGluIHRoaXMgbW9kdWxlLlxuICpcbiAqIEhlaWdodCBpcyBib3VuZGVkIGJ5IHtAbGluayBmb2xkQ2hhaW59OiBhIGRpcmVjdG9yeSBsaW5lIG9ubHkgZXZlciBhcHBlYXJzXG4gKiB3aGVyZSBpdCBnZW51aW5lbHkgZ3JvdXBzIHR3byBvciBtb3JlIHNpYmxpbmdzLCBzbyB0aGUgdHJlZSBhZGRzIGF0IG1vc3RcbiAqIG9uZSBsaW5lIHBlciByZWFsIGdyb3VwaW5nIGFuZCBuZXZlciBvbmUgcGVyIHBhdGggc2VnbWVudC5cbiAqXG4gKiBUb3RhbCBmb3IgYW55IHdlbGwtZm9ybWVkIGBUcmVlQW5jaG9yW11gOiBkZWdlbmVyYXRlIHBhdGhzIChydWxlIGVuZm9yY2VkXG4gKiBpbiB7QGxpbmsgc3BsaXRTZWdtZW50c30pIGFyZSBub3JtYWxpemVkIHRvIGF0b21pYyBsZWF2ZXMgcmF0aGVyIHRoYW5cbiAqIHRocm93biBvbiwgc28gdGhpcyBmdW5jdGlvbiBuZXZlciBuZWVkcyBhbiBpbnRlcm5hbCB0cnkvY2F0Y2guIENhbGxlcnMgYWRkXG4gKiB0aGVpciBvd24gY2F0Y2ggYXJvdW5kIHRoaXMgY2FsbCBpbiBhIGxhdGVyIHBoYXNlIChmYWlsLW9wZW4gZGlzY2lwbGluZVxuICogbGl2ZXMgYXQgdGhlIGNhbGwgc2l0ZSwgbm90IGhlcmUpLlxuICpcbiAqIGByZW5kZXJBbmNob3JUcmVlYCdzIGNvbnRyYWN0IHJlcXVpcmVzIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXJcbiAqIGRpc3RpbmN0IGBwYXRoYCBcdTIwMTQgcGFzcyBhbmNob3JzIHRocm91Z2gge0BsaW5rIGNvbGxhcHNlQnlQYXRofSBmaXJzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckFuY2hvclRyZWUoYW5jaG9yczogVHJlZUFuY2hvcltdKTogc3RyaW5nW10ge1xuICBjb25zdCBmb3Jlc3QgPSBidWlsZEZvcmVzdChhbmNob3JzKTtcbiAgcmV0dXJuIHJlbmRlck5vZGVzKGZvcmVzdCwgJycpO1xufVxuIiwgIi8qKlxuICogQ29kZXggYGFwcGx5X3BhdGNoYCBlbnZlbG9wZSBwYXJzZXIuXG4gKlxuICogVHVybnMgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGB0b29sX2lucHV0LmNvbW1hbmRgIHBhdGNoIHN0cmluZyBpbnRvIHRoZVxuICogYEFuY2hvclNwZWNbXWAgc2hhcGUgdGhlIHNoYXJlZCB0b3VjaCBjb3JlIGFscmVhZHkgY29uc3VtZXMgXHUyMDE0IHRoZSBvbmVcbiAqIGdlbnVpbmVseSBuZXcgYWxnb3JpdGhtIHRoZSBDb2RleCBhZGFwdGVyIG5lZWRzLiBJdCByZXBsYWNlcyB0aGUgc3RydWN0dXJlZFxuICogYGZpbGVfcGF0aGAvYG9sZF9zdHJpbmdgL2BvZmZzZXRgIHJlYWRpbmcgdGhlIENsYXVkZSBQb3N0VG9vbFVzZSB0b3VjaCBob29rXG4gKiBkb2VzLCBiZWNhdXNlIENvZGV4IGRlbGl2ZXJzIGV2ZXJ5IGVkaXQgYXMgYSBzaW5nbGUgYXBwbHlfcGF0Y2ggZW52ZWxvcGVcbiAqIHJhdGhlciB0aGFuIGEgdHlwZWQgdG9vbCBpbnB1dC5cbiAqXG4gKiBUaGUgbW9kdWxlIGlzIHB1cmU6IGl0IGltcG9ydHMgb25seSB0aGUga2VybmVsIGFuY2hvciB0eXBlcyBhbmQgbmV2ZXIgdG91Y2hlc1xuICogdGhlIENvZGV4IFNESywgc28gaXQgaXMgREktdGVzdGFibGUgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGVcbiAqIHNoYXJlZCBrZXJuZWwuIFJhbmdlIHJlY292ZXJ5IGlzIGJlc3QtZWZmb3J0IFx1MjAxNCB0aGUgYXBwbHlfcGF0Y2ggZm9ybWF0IGNhcnJpZXNcbiAqIGBAQGAgY29udGV4dCBhbmQgYCtgL2AtYC9zcGFjZSBjaGFuZ2UgbGluZXMgYnV0IG5vIGV4cGxpY2l0IGxpbmUgbnVtYmVycywgc28gYVxuICogcmFuZ2UgY2FuIG9ubHkgYmUgcmVjb3ZlcmVkIGJ5IGxvY2F0aW5nIGEgaHVuaydzIHByZS1lZGl0IGJsb2NrIGluIHRoZVxuICogb24tZGlzayBmaWxlLiBUaGF0IGZpbGUgcmVhZCBpcyBpbmplY3RlZCAoYHJlYWRQcmVFZGl0RmlsZWApIHNvIHRoZSBmdW5jdGlvblxuICogc3RheXMgcHVyZSBhbmQgdGVzdGFibGUuIE9uIEFOWSBhbWJpZ3VpdHkgKG5vIHJlYWRlciwgZmlsZSBtaXNzaW5nLCBjb250ZXh0XG4gKiBub3QgZm91bmQsIGZ1enp5L2R1cGxpY2F0ZSBtYXRjaCkgdGhlIHBhcnNlciBkZWdyYWRlcyB0byBhIHdob2xlLWZpbGUgYW5jaG9yXG4gKiByYXRoZXIgdGhhbiB0aHJvd2luZyBcdTIwMTQgd2hvbGUtZmlsZSBhbmNob3JzIGFyZSBmaXJzdC1jbGFzcyBhbmQgdG91Y2ggdHJhY2tpbmdcbiAqIG11c3QgbmV2ZXIgYmUgYmxvY2tlZC5cbiAqXG4gKiBUaGUgZ3JhbW1hciBpcyBjcm9zcy1jaGVja2VkIGFnYWluc3QgQ29kZXgncyBvd24gYXBwbHlfcGF0Y2ggY3JhdGVcbiAqIChjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMve3BhcnNlcixzdHJlYW1pbmdfcGFyc2VyfS5ycykuIFR3byBzdWJ0bGV0aWVzIGFyZVxuICogbWlycm9yZWQgZGVsaWJlcmF0ZWx5OiBodW5rLWhlYWRlciBtYXJrZXJzIGFyZSBvbmx5IHJlY29nbml6ZWQgYXQgdGhlIHN0YXJ0IG9mXG4gKiBhIGxpbmUgd2l0aCBubyBsZWFkaW5nIHdoaXRlc3BhY2Ugd2hpbGUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rIChhIGxlYWRpbmcgc3BhY2VcbiAqIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpLCBhbmQgYSBiYXJlIGVtcHR5IGxpbmUgaW5zaWRlIGFuIFVwZGF0ZVxuICogaHVuayBpcyB0cmVhdGVkIGFzIGFuIGVtcHR5IGNvbnRleHQgbGluZSBwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcgY29udGVudC5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCB0eXBlIHsgQW5jaG9yU3BlYywgTGluZVJhbmdlIH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5cbi8qKlxuICogUmVhZHMgdGhlIHByZS1lZGl0IChvbi1kaXNrLCBiZWZvcmUgdGhlIHBhdGNoIGFwcGxpZXMpIGNvbnRlbnQgb2YgdGhlIGZpbGUgYXRcbiAqIGBwYXRoYCwgb3IgcmV0dXJucyBgbnVsbGAgd2hlbiBpdCBjYW5ub3QgYmUgcmVhZC4gSW5qZWN0ZWQgc28gdGhlIHBhcnNlciBzdGF5c1xuICogcHVyZTsgY2FsbCBzaXRlcyBkZWZhdWx0IHRvIGEgcmVhbCBmaWxlc3lzdGVtIHJlYWQuXG4gKi9cbmV4cG9ydCB0eXBlIFJlYWRQcmVFZGl0RmlsZSA9IChwYXRoOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gR3JhbW1hciBtYXJrZXJzIChtaXJyb3JzIGNvZGV4LXJzL2FwcGx5LXBhdGNoL3NyYy9wYXJzZXIucnMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgRU5EX1BBVENIX01BUktFUiA9ICcqKiogRW5kIFBhdGNoJztcbmNvbnN0IEFERF9GSUxFX01BUktFUiA9ICcqKiogQWRkIEZpbGU6ICc7XG5jb25zdCBERUxFVEVfRklMRV9NQVJLRVIgPSAnKioqIERlbGV0ZSBGaWxlOiAnO1xuY29uc3QgVVBEQVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBVcGRhdGUgRmlsZTogJztcbmNvbnN0IE1PVkVfVE9fTUFSS0VSID0gJyoqKiBNb3ZlIHRvOiAnO1xuY29uc3QgRU9GX01BUktFUiA9ICcqKiogRW5kIG9mIEZpbGUnO1xuY29uc3QgQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAICc7XG5jb25zdCBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIgPSAnQEAnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEludGVybWVkaWF0ZSBodW5rIG1vZGVsXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFVwZGF0ZUNodW5rIHtcbiAgLyoqIE9wdGlvbmFsIGBAQCA8Y29udGV4dD5gIGxpbmUgdXNlZCB0byBkaXNhbWJpZ3VhdGUgdGhlIGJsb2NrJ3MgbG9jYXRpb24uICovXG4gIGNoYW5nZUNvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKiBQcmUtZWRpdCBsaW5lcyB0aGlzIGNodW5rIGNvdmVycyAoY29udGV4dCBgIGAgKyByZW1vdmVkIGAtYCksIGluIG9yZGVyLiAqL1xuICBvbGRMaW5lczogc3RyaW5nW107XG4gIC8qKiBQb3N0LWVkaXQgbGluZXMgKGNvbnRleHQgYCBgICsgYWRkZWQgYCtgKTsgcmV0YWluZWQgZm9yIGNvbXBsZXRlbmVzcy4gKi9cbiAgbmV3TGluZXM6IHN0cmluZ1tdO1xufVxuXG50eXBlIEh1bmsgPVxuICB8IHsga2luZDogJ2FkZCc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAnZGVsZXRlJzsgcGF0aDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6ICd1cGRhdGUnOyBwYXRoOiBzdHJpbmc7IG1vdmVQYXRoOiBzdHJpbmcgfCBudWxsOyBjaHVua3M6IFVwZGF0ZUNodW5rW10gfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHJlYWRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVhbC1maWxlc3lzdGVtIHJlYWRlciB1c2VkIHdoZW4gbm8gcmVhZGVyIGlzIGluamVjdGVkLiBCZXN0LWVmZm9ydDogYW55XG4gKiBmYWlsdXJlIChtaXNzaW5nIGZpbGUsIHBlcm1pc3Npb24gZXJyb3IpIHlpZWxkcyBgbnVsbGAsIHdoaWNoIHRoZSBwYXJzZXJcbiAqIGRlZ3JhZGVzIHRvIGEgd2hvbGUtZmlsZSBhbmNob3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0UmVhZFByZUVkaXRGaWxlKHBhdGg6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICB0cnkge1xuICAgIHJldHVybiBmcy5yZWFkRmlsZVN5bmMocGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRW52ZWxvcGUgc2Nhbm5pbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNjYW4gdGhlIHBhdGNoIHRleHQgaW50byBodW5rcy4gTGVuaWVudCBieSBkZXNpZ246IHVucmVjb2duaXplZCBsaW5lcyBhcmVcbiAqIGlnbm9yZWQgcmF0aGVyIHRoYW4gcmVqZWN0ZWQsIGFuZCBCZWdpbi9FbmQvRW52aXJvbm1lbnQgbGluZXMgYXJlIHNraXBwZWQsIHNvXG4gKiBhIG1hbGZvcm1lZCBlbnZlbG9wZSBkZWdyYWRlcyB0byB3aGF0ZXZlciBodW5rcyBjb3VsZCBiZSByZWNvdmVyZWQgKG9mdGVuXG4gKiBub25lIFx1MjE5MiBgW11gKSBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICovXG5mdW5jdGlvbiBzY2FuSHVua3MoY29tbWFuZDogc3RyaW5nKTogSHVua1tdIHtcbiAgY29uc3QgaHVua3M6IEh1bmtbXSA9IFtdO1xuICAvLyBUaGUgY3VycmVudGx5LW9wZW4gVXBkYXRlIGh1bmssIG9yIG51bGwuIEFkZC9EZWxldGUgaHVua3MgaGF2ZSBubyBib2R5LCBzb1xuICAvLyB0aGV5IGNsb3NlIGltbWVkaWF0ZWx5IGFuZCByZXNldCB0aGlzIHRvIG51bGwuXG4gIGxldCBvcGVuVXBkYXRlOiAoSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSkgfCBudWxsID0gbnVsbDtcblxuICBmb3IgKGNvbnN0IHJhdyBvZiBjb21tYW5kLnNwbGl0KCdcXG4nKSkge1xuICAgIC8vIEhlYWRlciBkZXRlY3Rpb24gaXMgd2hpdGVzcGFjZS1zZW5zaXRpdmUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rOiBDb2RleCB1c2VzXG4gICAgLy8gdHJpbV9lbmQgdGhlcmUgKGxlYWRpbmcgc3BhY2UgZGVtb3RlcyBhIG1hcmtlciB0byBhIGNvbnRleHQgbGluZSkgYW5kIGZ1bGxcbiAgICAvLyB0cmltIGVsc2V3aGVyZS4gTWF0Y2ggdGhhdCBzbyBpbmRlbnRlZCBtYXJrZXJzIGluc2lkZSBhIGh1bmsgc3RheSBjb250ZW50LlxuICAgIGNvbnN0IGhlYWRlckxpbmU6IHN0cmluZyA9IG9wZW5VcGRhdGUgPyByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJykgOiByYXcudHJpbSgpO1xuXG4gICAgaWYgKGhlYWRlckxpbmUgPT09IEVORF9QQVRDSF9NQVJLRVIpIHtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoQUREX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdhZGQnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKEFERF9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChERUxFVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBodW5rcy5wdXNoKHsga2luZDogJ2RlbGV0ZScsIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoREVMRVRFX0ZJTEVfTUFSS0VSLmxlbmd0aCkgfSk7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKFVQREFURV9GSUxFX01BUktFUikpIHtcbiAgICAgIGNvbnN0IGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0gPSB7XG4gICAgICAgIGtpbmQ6ICd1cGRhdGUnLFxuICAgICAgICBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKFVQREFURV9GSUxFX01BUktFUi5sZW5ndGgpLFxuICAgICAgICBtb3ZlUGF0aDogbnVsbCxcbiAgICAgICAgY2h1bmtzOiBbXVxuICAgICAgfTtcbiAgICAgIGh1bmtzLnB1c2goaHVuayk7XG4gICAgICBvcGVuVXBkYXRlID0gaHVuaztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChvcGVuVXBkYXRlKSB7XG4gICAgICBwcm9jZXNzVXBkYXRlTGluZShvcGVuVXBkYXRlLCByYXcpO1xuICAgIH1cbiAgICAvLyBBbnkgb3RoZXIgbGluZSBvdXRzaWRlIGFuIFVwZGF0ZSBodW5rIChCZWdpbiBQYXRjaCwgRW52aXJvbm1lbnQgSUQsIEFkZFxuICAgIC8vIEZpbGUgYCtgIGNvbnRlbnQsIHN0cmF5IHRleHQpIGlzIGlnbm9yZWQuXG4gIH1cblxuICByZXR1cm4gaHVua3M7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZUNodW5rKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pOiBVcGRhdGVDaHVuayB7XG4gIGNvbnN0IGxhc3QgPSBodW5rLmNodW5rc1todW5rLmNodW5rcy5sZW5ndGggLSAxXTtcbiAgaWYgKGxhc3QpIHJldHVybiBsYXN0O1xuICBjb25zdCBjaHVuazogVXBkYXRlQ2h1bmsgPSB7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH07XG4gIGh1bmsuY2h1bmtzLnB1c2goY2h1bmspO1xuICByZXR1cm4gY2h1bms7XG59XG5cbi8qKiBBcHBseSBvbmUgYm9keSBsaW5lIG9mIGFuIFVwZGF0ZSBodW5rIHRvIGl0cyBjaHVuayBsaXN0LiAqL1xuZnVuY3Rpb24gcHJvY2Vzc1VwZGF0ZUxpbmUoaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSwgcmF3OiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgdHJpbW1lZEVuZCA9IHJhdy5yZXBsYWNlKC9bIFxcdFxccl0rJC8sICcnKTtcblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU9GX01BUktFUikgcmV0dXJuOyAvLyBlbmQtb2YtZmlsZSBoaW50OyBub3QgbmVlZGVkIGZvciByYW5nZXNcblxuICAvLyBgKioqIE1vdmUgdG86YCBpcyBvbmx5IG1lYW5pbmdmdWwgYmVmb3JlIGFueSBjaGFuZ2UgY29udGVudC5cbiAgaWYgKGh1bmsuY2h1bmtzLmxlbmd0aCA9PT0gMCAmJiBodW5rLm1vdmVQYXRoID09PSBudWxsICYmIHRyaW1tZWRFbmQuc3RhcnRzV2l0aChNT1ZFX1RPX01BUktFUikpIHtcbiAgICBodW5rLm1vdmVQYXRoID0gdHJpbW1lZEVuZC5zbGljZShNT1ZFX1RPX01BUktFUi5sZW5ndGgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICh0cmltbWVkRW5kID09PSBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogbnVsbCwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0cmltbWVkRW5kLnN0YXJ0c1dpdGgoQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSkge1xuICAgIGh1bmsuY2h1bmtzLnB1c2goeyBjaGFuZ2VDb250ZXh0OiB0cmltbWVkRW5kLnNsaWNlKENIQU5HRV9DT05URVhUX01BUktFUi5sZW5ndGgpLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBIGJhcmUgZW1wdHkgbGluZSBpcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgKHByZXNlbnQgaW4gYm90aCBvbGQgYW5kIG5ldykuXG4gIGlmIChyYXcgPT09ICcnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKCcnKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKCcnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZmlyc3QgPSByYXdbMF07XG4gIGlmIChmaXJzdCA9PT0gJyAnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjb25zdCBjb250ZW50ID0gcmF3LnNsaWNlKDEpO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2goY29udGVudCk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaChjb250ZW50KTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnKycpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnLScpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gVW5yZWNvZ25pemVkIGNvbnRlbnQgbGluZSBcdTIwMTQgaWdub3JlIGxlbmllbnRseSByYXRoZXIgdGhhbiB0aHJvdy5cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSYW5nZSByZWNvdmVyeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTcGxpdCBmaWxlIGNvbnRlbnQgaW50byBsaW5lcyBmb3IgbWF0Y2hpbmcuIEEgdHJhaWxpbmcgbmV3bGluZSB5aWVsZHMgYVxuICogdHJhaWxpbmcgZW1wdHkgZWxlbWVudCwgd2hpY2ggaXMgaGFybWxlc3MgZm9yIHN1Yi1zbGljZSBtYXRjaGluZy4gKi9cbmZ1bmN0aW9uIHNwbGl0TGluZXMoY29udGVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gY29udGVudC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKiBJbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgdmFsdWVgIGFwcGVhcnMgYXMgYSBmdWxsIGxpbmUgaW4gYGxpbmVzYC4gKi9cbmZ1bmN0aW9uIGxpbmVJbmRpY2VzKGxpbmVzOiBzdHJpbmdbXSwgdmFsdWU6IHN0cmluZyk6IG51bWJlcltdIHtcbiAgY29uc3Qgb3V0OiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGxpbmVzW2ldID09PSB2YWx1ZSkgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFN0YXJ0IGluZGljZXMgKDAtYmFzZWQpIGF0IHdoaWNoIGBuZWVkbGVgIG1hdGNoZXMgY29udGlndW91c2x5IGluIGBoYXlzdGFja2AuICovXG5mdW5jdGlvbiBjb250aWd1b3VzTWF0Y2hlcyhoYXlzdGFjazogc3RyaW5nW10sIG5lZWRsZTogc3RyaW5nW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDAgfHwgbmVlZGxlLmxlbmd0aCA+IGhheXN0YWNrLmxlbmd0aCkgcmV0dXJuIG91dDtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSBvdXQucHVzaChpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIExvY2F0ZSBhIHNpbmdsZSBjaHVuaydzIHByZS1lZGl0IGJsb2NrIGluIHRoZSBmaWxlLCByZXR1cm5pbmcgaXRzIDEtYmFzZWRcbiAqIGxpbmUgcmFuZ2Ugb3IgbnVsbCB3aGVuIGl0IGNhbm5vdCBiZSBsb2NhdGVkIHVuYW1iaWd1b3VzbHkuXG4gKlxuICogLSBOb24tZW1wdHkgYmxvY2s6IHJlcXVpcmUgYSB1bmlxdWUgY29udGlndW91cyBtYXRjaCwgb3IgXHUyMDE0IHdoZW4gZHVwbGljYXRlZCBcdTIwMTRcbiAqICAgYSBgQEBgIGNoYW5nZS1jb250ZXh0IGxpbmUgdGhhdCBzZWxlY3RzIHRoZSBvY2N1cnJlbmNlIGFmdGVyIGl0LlxuICogLSBFbXB0eSBibG9jayAocHVyZSBpbnNlcnRpb24pOiBhbmNob3Igb24gYSB1bmlxdWUgY2hhbmdlLWNvbnRleHQgbGluZSBpZiBvbmVcbiAqICAgaXMgZ2l2ZW47IG90aGVyd2lzZSBpdCBpcyB1bmxvY2F0YWJsZS5cbiAqL1xuZnVuY3Rpb24gbG9jYXRlQ2h1bmsocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVuazogVXBkYXRlQ2h1bmspOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgYmxvY2sgPSBjaHVuay5vbGRMaW5lcztcblxuICBpZiAoYmxvY2subGVuZ3RoID09PSAwKSB7XG4gICAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICAgIGNvbnN0IGN0eElkeHMgPSBsaW5lSW5kaWNlcyhwcmVMaW5lcywgY3R4KTtcbiAgICAgIGlmIChjdHhJZHhzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBjb25zdCBsaW5lID0gY3R4SWR4c1swXSArIDE7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiBsaW5lLCBlbmQ6IGxpbmUgfTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBzdGFydHMgPSBjb250aWd1b3VzTWF0Y2hlcyhwcmVMaW5lcywgYmxvY2spO1xuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IHMgPSBzdGFydHNbMF07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHMgKyAxLCBlbmQ6IHMgKyBibG9jay5sZW5ndGggfTtcbiAgfVxuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gRHVwbGljYXRlZCBibG9jazogdXNlIHRoZSBjaGFuZ2UgY29udGV4dCB0byBzZWxlY3QgdGhlIG1hdGNoIGFmdGVyIGl0LlxuICBjb25zdCBjdHggPSBjaHVuay5jaGFuZ2VDb250ZXh0O1xuICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICBmb3IgKGNvbnN0IGMgb2YgbGluZUluZGljZXMocHJlTGluZXMsIGN0eCkpIHtcbiAgICAgIGNvbnN0IGFmdGVyID0gc3RhcnRzLmZpbmQoKHMpID0+IHMgPj0gYyk7XG4gICAgICBpZiAoYWZ0ZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4geyBzdGFydDogYWZ0ZXIgKyAxLCBlbmQ6IGFmdGVyICsgYmxvY2subGVuZ3RoIH07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsOyAvLyBhbWJpZ3VvdXMgXHUyMTkyIGNhbGxlciBkZWdyYWRlcyB0byB3aG9sZS1maWxlXG59XG5cbi8qKlxuICogUmVjb3ZlciBhIHNpbmdsZSBsaW5lIHJhbmdlIHNwYW5uaW5nIGFsbCBvZiBhbiB1cGRhdGUncyBjaHVua3MuIFJldHVybnMgbnVsbFxuICogKFx1MjE5MiB3aG9sZS1maWxlIGZhbGxiYWNrKSBpZiBhbnkgY2h1bmsgY2Fubm90IGJlIGxvY2F0ZWQuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSYW5nZShwcmVMaW5lczogc3RyaW5nW10sIGNodW5rczogVXBkYXRlQ2h1bmtbXSk6IExpbmVSYW5nZSB8IG51bGwge1xuICBsZXQgdW5pb246IExpbmVSYW5nZSB8IG51bGwgPSBudWxsO1xuICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgIGNvbnN0IHIgPSBsb2NhdGVDaHVuayhwcmVMaW5lcywgY2h1bmspO1xuICAgIGlmIChyID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICB1bmlvbiA9IHVuaW9uID09PSBudWxsID8gciA6IHsgc3RhcnQ6IE1hdGgubWluKHVuaW9uLnN0YXJ0LCByLnN0YXJ0KSwgZW5kOiBNYXRoLm1heCh1bmlvbi5lbmQsIHIuZW5kKSB9O1xuICB9XG4gIHJldHVybiB1bmlvbjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgQVBJXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBQYXJzZSBhIENvZGV4IGBhcHBseV9wYXRjaGAgY29tbWFuZCBzdHJpbmcgaW50byBhbiBhbmNob3IgcGVyIHRvdWNoZWQgZmlsZS5cbiAqXG4gKiAtIGAqKiogQWRkIEZpbGU6YCBcdTIxOTIgYGNyZWF0ZWAgKHdob2xlLWZpbGUpXG4gKiAtIGAqKiogRGVsZXRlIEZpbGU6YCBcdTIxOTIgYHdob2xlLXdyaXRlYCAod2hvbGUtZmlsZTsgdGhlIGZpbGUgbm8gbG9uZ2VyIGV4aXN0cylcbiAqIC0gYCoqKiBVcGRhdGUgRmlsZTpgIFx1MjE5MiBgd3JpdGVgIHdpdGggYSByZWNvdmVyZWQgbGluZSByYW5nZSB3aGVuIHRoZSBodW5rJ3NcbiAqICAgcHJlLWVkaXQgYmxvY2sgY2FuIGJlIGxvY2F0ZWQgdmlhIGByZWFkUHJlRWRpdEZpbGVgLCBvdGhlcndpc2UgYHdob2xlLXdyaXRlYC5cbiAqICAgQSByZW5hbWVkIHVwZGF0ZSAoYCoqKiBNb3ZlIHRvOmApIGFuY2hvcnMgdGhlIGRlc3RpbmF0aW9uIHBhdGggYXNcbiAqICAgYHdob2xlLXdyaXRlYCBzaW5jZSBwcmUtZWRpdCBsaW5lIG51bWJlcnMgY2Fubm90IGJlIG1hcHBlZCBhY3Jvc3MgYSByZW5hbWUuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhIG1hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB5aWVsZHMgYFtdYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQXBwbHlQYXRjaChcbiAgY29tbWFuZDogc3RyaW5nLFxuICByZWFkUHJlRWRpdEZpbGU6IFJlYWRQcmVFZGl0RmlsZSA9IGRlZmF1bHRSZWFkUHJlRWRpdEZpbGVcbik6IEFuY2hvclNwZWNbXSB7XG4gIGNvbnN0IGFuY2hvcnM6IEFuY2hvclNwZWNbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgaHVuayBvZiBzY2FuSHVua3MoY29tbWFuZCkpIHtcbiAgICBpZiAoaHVuay5raW5kID09PSAnYWRkJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnY3JlYXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaHVuay5raW5kID09PSAnZGVsZXRlJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlOiBhbmNob3Igb24gdGhlIGRlc3RpbmF0aW9uIHBhdGggKHBvc3QtZWRpdCBsb2NhdGlvbikuXG4gICAgY29uc3QgdGFyZ2V0UGF0aCA9IHRvUG9zaXgoaHVuay5tb3ZlUGF0aCA/PyBodW5rLnBhdGgpO1xuXG4gICAgLy8gQSByZW5hbWUgZGVmZWF0cyBwcmUtZWRpdCBsaW5lIG1hcHBpbmcgXHUyMDE0IGFuY2hvciB3aG9sZS1maWxlIG9uIHRoZSB0YXJnZXQuXG4gICAgaWYgKGh1bmsubW92ZVBhdGggIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBSYW5nZSByZWNvdmVyeSByZWFkcyB0aGUgcHJlLWVkaXQgY29udGVudCBhdCB0aGUgb3JpZ2luYWwgKHByZS1tb3ZlKSBwYXRoLlxuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkUHJlRWRpdEZpbGUoaHVuay5wYXRoKTtcbiAgICBjb25zdCByYW5nZSA9IGNvbnRlbnQgPT09IG51bGwgPyBudWxsIDogcmVjb3ZlclJhbmdlKHNwbGl0TGluZXMoY29udGVudCksIGh1bmsuY2h1bmtzKTtcbiAgICBpZiAocmFuZ2UgIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3cml0ZScsIHJhbmdlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhbmNob3JzO1xufVxuIiwgIi8qKlxuICogQ29kZXggUG9zdFRvb2xVc2UgdG91Y2ggaG9vayBcdTIwMTQgaGVhbCArIHN1cmZhY2UgYWZ0ZXIgYSBjb25maXJtZWQgYGFwcGx5X3BhdGNoYCxcbiAqIG9yIGEgc2hlbGwvZXhlYyBjYWxsIHdob3NlIGNvbW1hbmQgc3RhdGljYWxseSByZXNvbHZlcyB0byBmaWxlK2xpbmUgaWRpb21zLlxuICpcbiAqIFBvc3RUb29sVXNlIGZpcmVzIGFmdGVyIGBhcHBseV9wYXRjaGAgaGFzIHJ1biwgc28gdGhpcyBpcyB0aGUgYWNjdXJhdGUgaG9tZSBmb3JcbiAqIHRoZSB0b3VjaCBzaWduYWw6IHRoZSBmaWxlIGlzIGFscmVhZHkgd3JpdHRlbiwgc28gYSBzY29wZWQgYGdpdCBzcGFuIGRyaWZ0XG4gKiA8ZmlsZT4gLS1maXhgIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgYWdhaW5zdCByZWFsIGJ5dGVzIGFuZCB0aGUgc3VyZmFjZWQgYmxvY2tcbiAqIHJlZmxlY3RzIHRoZSBoZWFsZWQgYW5jaG9ycy4gVGhlIGhhbmRsZXIgbmFycm93cyB0aGUgYGFwcGx5X3BhdGNoYCBlbnZlbG9wZVxuICogKGB0b29sX2lucHV0LmNvbW1hbmRgLCBTREstdHlwZWQgYHVua25vd25gKSBpbnRvIHBlci1maWxlIGFuY2hvcnMgdmlhIHRoZVxuICogc2hhcmVkIFthcHBseS1wYXRjaCBwYXJzZXJdKC4vYXBwbHktcGF0Y2gudHMpLCBhbmQgcmVjb3ZlcnMgc2hlbGwgY29tbWFuZHNcbiAqIGZyb20gZWl0aGVyIENvZGV4IGVudmVsb3BlIChjbGFzc2ljIGBleGVjX2NvbW1hbmRgIEpTT04gYGFyZ3VtZW50c2AsIG9yXG4gKiBjb2RlLW1vZGUgYGV4ZWNgIHdyYXBwaW5nIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCkgdmlhIHRoZSBzaGFyZWRcbiAqIFtjb21tYW5kIHBhcnNlcl0oLi4vY29tbW9uL3BhcnNlLWNvbW1hbmQudHMpOyBlYWNoIHRvdWNoZWQgZmlsZSBpcyBzY29wZWQgdG9cbiAqIHRoZSBDV0QgcmVwbywgYW5kIGRyaXZlcyB0aGUgaGFybmVzcy1hZ25vc3RpYyB7QGxpbmsgcnVuVG91Y2hIb29rfSBjb3JlIFx1MjAxNCB0aGVcbiAqIHNhbWUgY29yZSB0aGUgQ2xhdWRlIGFkYXB0ZXIgdXNlcy5cbiAqXG4gKiBUd28gQ29kZXgtc3BlY2lmaWMgY29uY2VybnMgYXJlIHByZXNlcnZlZCBmcm9tIHRoaXMgZmlsZSdzIGpvdXJuYWxpbmdcbiAqIHByZWRlY2Vzc29yOlxuICpcbiAqIDEuICoqU3VjY2VzcyBjbGFzc2lmaWNhdGlvbi4qKiBUaGUgcGFyc2VkIGVudmVsb3BlIGRlc2NyaWJlcyAqaW50ZW50Kiwgbm90XG4gKiAgICAqb3V0Y29tZSouIENvZGV4IGNvcmUgZmlyZXMgUG9zdFRvb2xVc2Ugb25seSBvbiB0b29sIHN1Y2Nlc3MsIGJ1dCBhcyBhXG4gKiAgICBkdXJhYmlsaXR5IGJlbHQgd2UgY2xhc3NpZnkgYHRvb2xfcmVzcG9uc2VgIHZpYVxuICogICAge0BsaW5rIGNsYXNzaWZ5QXBwbHlQYXRjaFJlc3BvbnNlfTogYSBjb25maXJtZWQgcmVqZWN0aW9uIChgJ2ZhaWx1cmUnYClcbiAqICAgIHN1cHByZXNzZXMgdGhlIHRvdWNoIChubyBwaGFudG9tIGhlYWwvc3VyZmFjZSBvbiBhIHBhdGNoIHRoYXQgbmV2ZXJcbiAqICAgIGFwcGxpZWQpOyBhIHN1Y2Nlc3Mgb3IgYW4gdW5yZWNvZ25pemVkIHNoYXBlIChgJ3Vua25vd24nYCwgd2FybmVkKSBwcm9jZWVkcy5cbiAqIDIuICoqTm8gcG9zdC1lZGl0IHJhbmdlIHJlY292ZXJ5IGZyb20gdGhlIGVudmVsb3BlLioqIFBvc3RUb29sVXNlIHJ1bnMgYWZ0ZXJcbiAqICAgIHRoZSBwYXRjaCByZXdyb3RlIHRoZSBmaWxlLCBzbyB0aGUgaHVuaydzIHByZS1lZGl0IGJsb2NrIG5vIGxvbmdlciBzaXRzXG4gKiAgICB3aGVyZSB0aGUgZWRpdCBoYXBwZW5lZCBhbmQgY291bGQgbWlzLWFuY2hvciBhIGR1cGxpY2F0ZS4gVGhlIHRvdWNoIGlzXG4gKiAgICBzY29wZWQgZmlsZS13aWRlIChgd3JpdHRlbjogJydgIFx1MjE5MiB3aG9sZS1maWxlKSwgd2hpY2ggaXMgZXhhY3RseSB0aGVcbiAqICAgIGJlaGF2aW9yIHtAbGluayBydW5Ub3VjaEhvb2t9IHRha2VzIGZvciBhbiBlbXB0eSB3cml0ZS5cbiAqXG4gKiBUaGUgdGltZW91dCBpcyBtaWxsaXNlY29uZHMgaW4gdGhlIGhhbmRsZXIgY29uZmlnICh0aGUgQ0xJIGVtaXRzIGAxMGAgc2Vjb25kcylcbiAqIFx1MjAxNCBzZWUgdGhlIHRpbWVvdXQtdW5pdHMgc3Bpa2Ugbm90ZTsgdGhlIHNvdXJjZSB2YWx1ZSBtdXN0IHN0YXkgaW4gbXMgc28gdGhlXG4gKiBDb2RleCBidWlsZCdzIHNlY29uZHMgY29udmVyc2lvbiBhdCBlbWl0IHJlbWFpbnMgY29ycmVjdC5cbiAqL1xuXG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFBvc3RUb29sVXNlSW5wdXQsIHBvc3RUb29sVXNlSG9vaywgcG9zdFRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHsgYWJzcGF0aEFnYWluc3QgfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHBhcnNlQ29tbWFuZERldGFpbGVkIH0gZnJvbSAnLi4vY29tbW9uL3BhcnNlLWNvbW1hbmQuanMnO1xuaW1wb3J0IHsgY3JlYXRlRGlza01lbW9TdG9yZSwgdHlwZSBNZW1vRmFjdG9yeSwgcmVzb2x2ZVRvdWNoU2NvcGUgfSBmcm9tICcuLi9jb21tb24vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7XG4gIGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycyxcbiAgcnVuVG91Y2hIb29rLFxuICB0eXBlIFRvdWNoRXhlY3V0b3JzLFxuICB0eXBlIFRvdWNoSW5wdXRcbn0gZnJvbSAnLi4vY29tbW9uL3RvdWNoLWNvcmUuanMnO1xuaW1wb3J0IHsgcGFyc2VBcHBseVBhdGNoIH0gZnJvbSAnLi9hcHBseS1wYXRjaC5qcyc7XG5cbi8qKlxuICogVGhlIHByZWZpeCBhcHBseV9wYXRjaCdzIHN0ZG91dCBjYXJyaWVzIHdoZW4gXHUyMDE0IGFuZCBvbmx5IHdoZW4gXHUyMDE0IHRoZSBwYXRjaFxuICogYXBwbGllZCAoY29kZXgtcnMvYXBwbHktcGF0Y2ggYHByaW50X3N1bW1hcnlgKS4gQ29kZXggc3VyZmFjZXMgdGhhdCBzdGRvdXRcbiAqIHZlcmJhdGltIGFzIHRoZSBQb3N0VG9vbFVzZSBgdG9vbF9yZXNwb25zZWAgKGEgYmFyZSBzdHJpbmcgdG9kYXkpLiBGaXhlZFxuICogYWNyb3NzIEFkZC9Nb2RpZnkvRGVsZXRlOyB0aGUgaGVhZGVyIGlzIGZvbGxvd2VkIGJ5IGBBL00vRCA8cGF0aD5gIGxpbmVzLlxuICovXG5jb25zdCBBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWCA9ICdTdWNjZXNzLiBVcGRhdGVkIHRoZSBmb2xsb3dpbmcgZmlsZXM6JztcblxuLyoqXG4gKiBUaGUgY29tbW9uIGZpZWxkcyBhbiBvYmplY3Qtd3JhcHBlZCB0b29sX3Jlc3BvbnNlIG1pZ2h0IGNhcnJ5IHRoZSB0b29sJ3MgdGV4dFxuICogb3V0cHV0IHVuZGVyLCBpZiBDb2RleCBldmVyIHN0b3BzIHN1cmZhY2luZyBpdCBhcyBhIGJhcmUgc3RyaW5nLiBPcmRlcmVkIGJ5XG4gKiBsaWtlbGlob29kOyB0aGUgZmlyc3QgZmllbGQgd2hvc2UgdmFsdWUgaXMgYSBzdHJpbmcgd2lucy5cbiAqL1xuY29uc3QgUkVTUE9OU0VfVEVYVF9GSUVMRFMgPSBbJ291dHB1dCcsICdzdGRvdXQnLCAnY29udGVudCcsICd0ZXh0J10gYXMgY29uc3Q7XG5cbi8qKiBOYXJyb3cgdGhlIFNESydzIGB1bmtub3duYCB0b29sX2lucHV0IHRvIHRoZSBgYXBwbHlfcGF0Y2hgIGB7IGNvbW1hbmQgfWAgc2hhcGUuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93QXBwbHlQYXRjaENvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2NvbW1hbmQnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGNvbW1hbmQgPSAodG9vbElucHV0IGFzIHsgY29tbWFuZDogdW5rbm93biB9KS5jb21tYW5kO1xuICAgIGlmICh0eXBlb2YgY29tbWFuZCA9PT0gJ3N0cmluZycpIHJldHVybiBjb21tYW5kO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIE5hcnJvdyB0aGUgY2xhc3NpYyBgZXhlY19jb21tYW5kYCBlbnZlbG9wZSAoY2xpX3ZlcnNpb24gXHUyMjY0IDAuMTMwLjApOlxuICogYHRvb2xfaW5wdXQuYXJndW1lbnRzYCBpcyBhIEpTT04gKnN0cmluZyogb2Ygc2hhcGVcbiAqIGB7XCJjbWRcIjogXCIuLi5cIiwgXCJ3b3JrZGlyXCI6IFwiLi4uXCJ9YCBcdTIwMTQgcGFyc2UgaXQgYW5kIHJldHVybiB0aGUgYGNtZGAuIFJldHVybnNcbiAqIGBudWxsYCBmb3IgYW55IG90aGVyIHNoYXBlIChub3QgSlNPTiwgbm8gYGNtZGAgZmllbGQsIG9yIG5vdCB0aGlzIGVudmVsb3BlKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5hcnJvd0V4ZWNDb21tYW5kKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ICE9PSBudWxsICYmIHR5cGVvZiB0b29sSW5wdXQgPT09ICdvYmplY3QnICYmICdhcmd1bWVudHMnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGFyZ3MgPSAodG9vbElucHV0IGFzIHsgYXJndW1lbnRzOiB1bmtub3duIH0pLmFyZ3VtZW50cztcbiAgICBpZiAodHlwZW9mIGFyZ3MgPT09ICdzdHJpbmcnKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGFyZ3MpO1xuICAgICAgICBpZiAocGFyc2VkICE9PSBudWxsICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnICYmIHR5cGVvZiBwYXJzZWQuY21kID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIHJldHVybiBwYXJzZWQuY21kO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIFRoZSByZXN1bHQgb2YgbmFycm93aW5nIHRoZSBjb2RlLW1vZGUgYGV4ZWNgIGVudmVsb3BlLiBgbWF0Y2hlZGAgc2VwYXJhdGVzXG4gKiBcInRoZSBlbnZlbG9wZSB3YXMgYSBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgY2FsbCB3aG9zZSBhcmd1bWVudCBjb3VsZCBub3RcbiAqIGJlIHJlY292ZXJlZFwiIChhIHZhcmlhYmxlL3RlbXBsYXRlLWJ1aWx0IGNvbW1hbmQgXHUyMDE0IHN0YXRpY2FsbHkgdW5yZXNvbHZhYmxlKVxuICogZnJvbSBcInRoZSBlbnZlbG9wZSBpcyBub3QgY29kZS1tb2RlIGV4ZWMgYXQgYWxsXCIsIHNvIHRoZSBoYW5kbGVyIGNhbiB3YXJuIG9uXG4gKiB0aGUgZm9ybWVyIGluc3RlYWQgb2Ygc2lsZW50bHkgY29uZmxhdGluZyBpdCB3aXRoIHRoZSBsYXR0ZXIuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29kZU1vZGVFeGVjTmFycm93IHtcbiAgLyoqIFdoZXRoZXIgYHRvb2xfaW5wdXQuaW5wdXRgIGNvbnRhaW5lZCBhIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCBjYWxsLiAqL1xuICBtYXRjaGVkOiBib29sZWFuO1xuICAvKiogVGhlIHJlY292ZXJlZCBgY21kYCBzdHJpbmcsIG9yIGBudWxsYCB3aGVuIG1hdGNoZWQgYnV0IHVucGFyc2FibGUgLyBhYnNlbnQuICovXG4gIGNtZDogc3RyaW5nIHwgbnVsbDtcbn1cblxuLyoqXG4gKiBRdW90ZSBiYXJlIGlkZW50aWZpZXIga2V5cyBpbiBhIEpTIG9iamVjdCBsaXRlcmFsIHNvIGBKU09OLnBhcnNlYCBjYW4gcmVhZFxuICogaXQuIFJlYWwgY29kZS1tb2RlIGNhbGwgc2l0ZXMgZW1pdCBKUy1zdHlsZSB1bnF1b3RlZCBrZXlzXG4gKiAoYHtjbWQ6XCJzZWQgLW4gJzEsMjQwcCcgL3BhdGhcIiwuLi59YCksIHdoaWNoIGlzIHZhbGlkIEpTIGJ1dCBpbnZhbGlkIEpTT04uXG4gKiBTdHJpbmcgdmFsdWVzIChzaW5nbGUtIG9yIGRvdWJsZS1xdW90ZWQpIGFyZSBjb3BpZWQgdmVyYmF0aW0gXHUyMDE0IGluY2x1ZGluZyBhbnlcbiAqIGAsIGtleTpgLXNoYXBlZCB0ZXh0IGluc2lkZSB0aGVtIFx1MjAxNCBhbmQgYWxyZWFkeS1xdW90ZWQga2V5cyBwYXNzIHRocm91Z2hcbiAqIHVudG91Y2hlZC5cbiAqL1xuZnVuY3Rpb24gcXVvdGVPYmplY3RLZXlzKGxpdGVyYWw6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBvdXQgPSAnJztcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gbGl0ZXJhbC5sZW5ndGg7XG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBsaXRlcmFsW2ldO1xuICAgIGlmIChjID09PSAnXCInIHx8IGMgPT09IFwiJ1wiKSB7XG4gICAgICBjb25zdCBxdW90ZSA9IGM7XG4gICAgICBjb25zdCBzdGFydCA9IGk7XG4gICAgICBpICs9IDE7XG4gICAgICB3aGlsZSAoaSA8IG4pIHtcbiAgICAgICAgaWYgKGxpdGVyYWxbaV0gPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIGkgKz0gMjtcbiAgICAgICAgZWxzZSBpZiAobGl0ZXJhbFtpXSA9PT0gcXVvdGUpIHtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH0gZWxzZSBpICs9IDE7XG4gICAgICB9XG4gICAgICBvdXQgKz0gbGl0ZXJhbC5zbGljZShzdGFydCwgaSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3Qga2V5ID0gbGl0ZXJhbC5zbGljZShpKS5tYXRjaCgvXihcXHt8LClcXHMqKFtBLVphLXpfJF1bQS1aYS16MC05XyRdKilcXHMqOi8pO1xuICAgIGlmIChrZXkpIHtcbiAgICAgIG91dCArPSBgJHtrZXlbMV19XCIke2tleVsyXX1cIjpgO1xuICAgICAgaSArPSBrZXlbMF0ubGVuZ3RoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIG91dCArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIE5hcnJvdyB0aGUgY29kZS1tb2RlIGBleGVjYCBlbnZlbG9wZSAoY2xpX3ZlcnNpb24gXHUyMjY1IDAuMTQ0LjApOlxuICogYHRvb2xfaW5wdXQuaW5wdXRgIGlzIEpTIHNvdXJjZSB0aGF0IGNhbGxzIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCBcdTIwMTRcbiAqIHJlY292ZXIgdGhlIGxpdGVyYWwgb2JqZWN0IGFyZ3VtZW50IHZpYSBiYWxhbmNlZC1icmFjZSBtYXRjaGluZywgcXVvdGUgaXRzXG4gKiB1bnF1b3RlZCBKUyBrZXlzLCBhbmQgcGFyc2UgaXQuIEEgY29tbWFuZCBidWlsdCBmcm9tIHZhcmlhYmxlcyBvciB0ZW1wbGF0ZVxuICogbGl0ZXJhbHMgaXMgc3RhdGljYWxseSB1bnJlc29sdmFibGU6IHRoZSBjYWxsIHN0aWxsICptYXRjaGVkKiBidXQgeWllbGRzXG4gKiBgY21kOiBudWxsYCwgcmVwb3J0ZWQgZGlzdGluY3RseSBmcm9tIGEgbm9uLWNvZGUtbW9kZSBlbnZlbG9wZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5hcnJvd0NvZGVNb2RlRXhlYyh0b29sSW5wdXQ6IHVua25vd24pOiBDb2RlTW9kZUV4ZWNOYXJyb3cge1xuICBpZiAodG9vbElucHV0ICE9PSBudWxsICYmIHR5cGVvZiB0b29sSW5wdXQgPT09ICdvYmplY3QnICYmICdpbnB1dCcgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgaW5wdXQgPSAodG9vbElucHV0IGFzIHsgaW5wdXQ6IHVua25vd24gfSkuaW5wdXQ7XG4gICAgaWYgKHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIE1hdGNoIHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSkgXHUyMDE0IGV4dHJhY3QgdGhlIGxpdGVyYWwgb2JqZWN0IGFyZ3VtZW50XG4gICAgICBjb25zdCBtYXRjaCA9IGlucHV0Lm1hdGNoKC90b29sc1xcLmV4ZWNfY29tbWFuZFxcKFxccyooXFx7KD86W157fV18XFx7KD86W157fV18XFx7W157fV0qXFx9KSpcXH0pKlxcfSlcXHMqXFwpLyk7XG4gICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHF1b3RlT2JqZWN0S2V5cyhtYXRjaFsxXSkpO1xuICAgICAgICAgIGlmIChwYXJzZWQgIT09IG51bGwgJiYgdHlwZW9mIHBhcnNlZCA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHBhcnNlZC5jbWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IHBhcnNlZC5jbWQgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHsgbWF0Y2hlZDogdHJ1ZSwgY21kOiBudWxsIH07XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIG1hdGNoZWQsIGJ1dCB0aGUgbGl0ZXJhbCBkaWQgbm90IHBhcnNlIFx1MjAxNCB0aGUgY2FsbCBpcyBzdGlsbCBhXG4gICAgICAgICAgLy8gY29kZS1tb2RlIGV4ZWMgd2hvc2UgY29tbWFuZCBjYW5ub3QgYmUgcmVjb3ZlcmVkIHN0YXRpY2FsbHkuXG4gICAgICAgICAgcmV0dXJuIHsgbWF0Y2hlZDogdHJ1ZSwgY21kOiBudWxsIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgbWF0Y2hlZDogZmFsc2UsIGNtZDogbnVsbCB9O1xufVxuXG4vKipcbiAqIFRvbGVyYW50bHkgcHVsbCB0aGUgdG9vbCdzIHRleHR1YWwgb3V0cHV0IG91dCBvZiBhIGB0b29sX3Jlc3BvbnNlYCBvZlxuICogdW5jZXJ0YWluIHNoYXBlIChTREstdHlwZWQgYHVua25vd25gKTogYSBiYXJlIHN0cmluZyAodG9kYXkncyBDb2RleCkgaXNcbiAqIHJldHVybmVkIGFzLWlzOyBhbiBvYmplY3QgaXMgcHJvYmVkIGZvciB0aGUgZmlyc3Qge0BsaW5rIFJFU1BPTlNFX1RFWFRfRklFTERTfVxuICogZW50cnkgdGhhdCBob2xkcyBhIHN0cmluZy4gUmV0dXJucyBgbnVsbGAgd2hlbiBubyB0ZXh0IGNhbiBiZSByZWNvdmVyZWRcbiAqICh1bmtub3duIG9iamVjdCBzaGFwZSwgYG51bGxgLCBvciBhIG5vbi1zdHJpbmcvbm9uLW9iamVjdCksIHdoaWNoIHRoZSBjYWxsZXJcbiAqIHRyZWF0cyBhcyBhbiAqdW5yZWNvZ25pemVkKiBcdTIwMTQgbm90ICpmYWlsZWQqIFx1MjAxNCByZXNwb25zZS5cbiAqL1xuZnVuY3Rpb24gZXh0cmFjdFJlc3BvbnNlVGV4dCh0b29sUmVzcG9uc2U6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdzdHJpbmcnKSByZXR1cm4gdG9vbFJlc3BvbnNlO1xuICBpZiAodG9vbFJlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdvYmplY3QnKSB7XG4gICAgY29uc3QgcmVjb3JkID0gdG9vbFJlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGZvciAoY29uc3QgZmllbGQgb2YgUkVTUE9OU0VfVEVYVF9GSUVMRFMpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcmVjb3JkW2ZpZWxkXTtcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIENsYXNzaWZ5IGFuIGBhcHBseV9wYXRjaGAgYHRvb2xfcmVzcG9uc2VgIGZvciB0aGUgdG91Y2ggZ2F0ZTpcbiAqXG4gKiAtIGAnc3VjY2VzcydgIFx1MjAxNCB0ZXh0IHdhcyByZWNvdmVyZWQgYW5kIGNhcnJpZXMge0BsaW5rIEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYfS5cbiAqIC0gYCdmYWlsdXJlJ2AgXHUyMDE0IHRleHQgd2FzIHJlY292ZXJlZCBidXQgbGFja3MgdGhlIGhlYWRlcjogYSBnZW51aW5lIHJlamVjdGlvblxuICogICBvciBlcnJvci4gVGhlIE9OTFkgY2xhc3NpZmljYXRpb24gdGhhdCBzdXBwcmVzc2VzIHRoZSB0b3VjaC5cbiAqIC0gYCd1bmtub3duJ2AgXHUyMDE0IG5vIHRleHQgY291bGQgYmUgcmVjb3ZlcmVkICh1bnJlY29nbml6ZWQgc2hhcGUpLiBXZSBwcm9jZWVkXG4gKiAgIGRlZmVuc2l2ZWx5IGhlcmUgcmF0aGVyIHRoYW4gcmlzayBtaXNzaW5nIGEgcmVhbCBlZGl0J3MgaGVhbC9zdXJmYWNlOyBDb2RleFxuICogICBjb3JlIGZpcmVzIFBvc3RUb29sVXNlIG9ubHkgb24gc3VjY2Vzcywgc28gdGhpcyBjYW5ub3QgaGVhbC9zdXJmYWNlIGEgcGF0Y2hcbiAqICAgdGhhdCBuZXZlciBhcHBsaWVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2UodG9vbFJlc3BvbnNlOiB1bmtub3duKTogJ3N1Y2Nlc3MnIHwgJ2ZhaWx1cmUnIHwgJ3Vua25vd24nIHtcbiAgY29uc3QgdGV4dCA9IGV4dHJhY3RSZXNwb25zZVRleHQodG9vbFJlc3BvbnNlKTtcbiAgaWYgKHRleHQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gIHJldHVybiB0ZXh0LnN0YXJ0c1dpdGgoQVBQTFlfUEFUQ0hfU1VDQ0VTU19QUkVGSVgpID8gJ3N1Y2Nlc3MnIDogJ2ZhaWx1cmUnO1xufVxuXG4vKiogQSByZWFkZXIgdGhhdCBhbHdheXMgZGVjbGluZXMsIGZvcmNpbmcgdGhlIHBhcnNlciB0byB3aG9sZS1maWxlIGFuY2hvcnMuICovXG5jb25zdCBub1JhbmdlUmVjb3ZlcnkgPSAoKTogbnVsbCA9PiBudWxsO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSGFuZGxlcihcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyA9IGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycygpLFxuICBtZW1vRmFjdG9yeTogTWVtb0ZhY3RvcnkgPSBjcmVhdGVEaXNrTWVtb1N0b3JlXG4pIHtcbiAgcmV0dXJuIGFzeW5jIChpbnB1dDogUG9zdFRvb2xVc2VJbnB1dCwgY3R4OiBIb29rQ29udGV4dCkgPT4ge1xuICAgIGNvbnN0IHRvb2xfbmFtZSA9IGlucHV0LnRvb2xfbmFtZTtcbiAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgY29uc3Qgc2Vzc2lvbklkID0gaW5wdXQuc2Vzc2lvbl9pZDtcbiAgICBjb25zdCBtZW1vID0gbWVtb0ZhY3RvcnkoY3R4LmxvZ2dlcik7XG5cbiAgICAvLyBTaGVsbCB0b3VjaDogZXh0cmFjdCB0aGUgY29tbWFuZCBmcm9tIHdoaWNoZXZlciBlbnZlbG9wZSBzaGFwZSB0aGUgaGFybmVzc1xuICAgIC8vIGRlbGl2ZXJzLCBwYXJzZSwgYW5kIHJ1biBlYWNoIHJlc29sdmVkIHNwYW4gdGhyb3VnaCB0aGUgc2hhcmVkIHRvdWNoIGNvcmUuXG4gICAgLy9cbiAgICAvLyAtIGBCYXNoYDogdGhlIGhhcm5lc3MtdW53cmFwcGVkIHNoYXBlIENvZGV4IFx1MjI2NTAuMTQ0IGFjdHVhbGx5IHNlbmRzIFx1MjAxNFxuICAgIC8vICAgYHRvb2xfaW5wdXQuY29tbWFuZGAgaXMgdGhlIHJhdyBzaGVsbCBjb21tYW5kIHN0cmluZyAoc2FtZSBzaGFwZSB0aGVcbiAgICAvLyAgIENsYXVkZSBhZGFwdGVyIGhhbmRsZXMpLlxuICAgIC8vIC0gYGV4ZWNfY29tbWFuZGA6IGNsYXNzaWMgZnVuY3Rpb25fY2FsbCBlbnZlbG9wZSAoY2xpIFx1MjI2NDAuMTMwKSBcdTIwMTRcbiAgICAvLyAgIGB0b29sX2lucHV0LmFyZ3VtZW50c2AgaXMgYSBKU09OIHN0cmluZyB3aXRoIGEgYGNtZGAgZmllbGQuXG4gICAgLy8gLSBgZXhlY2A6IGRpcmVjdCBjb2RlLW1vZGUgZW52ZWxvcGUgKG1heSBzaGlwIGluIGEgZnV0dXJlIENMSSkgXHUyMDE0XG4gICAgLy8gICBgdG9vbF9pbnB1dC5pbnB1dGAgaXMgSlMgc291cmNlIHdyYXBwaW5nIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYC5cbiAgICAvL1xuICAgIC8vIEEgY29tbWFuZCB3aXRoIG5vIHJlY29nbml6ZWQgaWRpb20geWllbGRzIG5vIGJsb2NrcyBhbmQgcmV0dXJucyB1bmRlZmluZWQgXHUyMDE0XG4gICAgLy8gZmFpbC1vcGVuLCBzYW1lIGFzIHRoZSBhcHBseV9wYXRjaCBwYXRoIGJlbG93LlxuICAgIGlmICh0b29sX25hbWUgPT09ICdCYXNoJyB8fCB0b29sX25hbWUgPT09ICdleGVjX2NvbW1hbmQnIHx8IHRvb2xfbmFtZSA9PT0gJ2V4ZWMnKSB7XG4gICAgICBsZXQgY29tbWFuZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICBpZiAodG9vbF9uYW1lID09PSAnQmFzaCcpIHtcbiAgICAgICAgLy8gVGhlIGhhcm5lc3MgYWxyZWFkeSB1bndyYXBwZWQgdGhlIGNvZGUtbW9kZSBlbnZlbG9wZSBcdTIwMTQgdGhlIGNvbW1hbmQgaXNcbiAgICAgICAgLy8gaW4gYHRvb2xfaW5wdXQuY29tbWFuZGAsIGV4YWN0bHkgYXMgdGhlIENsYXVkZSBhZGFwdGVyIHJlY2VpdmVzIGl0LlxuICAgICAgICBjb25zdCByYXcgPSAoaW5wdXQudG9vbF9pbnB1dCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwpPy5jb21tYW5kO1xuICAgICAgICBjb21tYW5kID0gdHlwZW9mIHJhdyA9PT0gJ3N0cmluZycgPyByYXcgOiBudWxsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29tbWFuZCA9IG5hcnJvd0V4ZWNDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgICAgfVxuICAgICAgaWYgKGNvbW1hbmQgPT09IG51bGwgJiYgdG9vbF9uYW1lID09PSAnZXhlYycpIHtcbiAgICAgICAgLy8gQ29kZS1tb2RlIGBleGVjYCB3cmFwcyB0aGUgc2FtZSBjYWxsIGluIEpTIHNvdXJjZS4gQSBtYXRjaGVkIGNhbGxcbiAgICAgICAgLy8gd2hvc2UgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZCAodmFyaWFibGUvdGVtcGxhdGUtYnVpbHQgY29tbWFuZClcbiAgICAgICAgLy8gaXMgYSBkaXN0aW5jdCBvdXRjb21lIGZyb20gXCJub3QgYSBjb2RlLW1vZGUgZW52ZWxvcGUgYXQgYWxsXCI6IHdhcm4gc29cbiAgICAgICAgLy8gdGhlIGJsaW5kIHNwb3QgaXMgdmlzaWJsZSBpbnN0ZWFkIG9mIHNpbGVudGx5IGNvbmZsYXRlZCB3aXRoIG5vIG1hdGNoLlxuICAgICAgICBjb25zdCBjb2RlTW9kZSA9IG5hcnJvd0NvZGVNb2RlRXhlYyhpbnB1dC50b29sX2lucHV0KTtcbiAgICAgICAgaWYgKGNvZGVNb2RlLm1hdGNoZWQgJiYgY29kZU1vZGUuY21kID09PSBudWxsKSB7XG4gICAgICAgICAgY3R4LmxvZ2dlci53YXJuKFxuICAgICAgICAgICAgJ0NvZGV4IGNvZGUtbW9kZSBleGVjIGVudmVsb3BlIG1hdGNoZWQgYnV0IGl0cyBleGVjX2NvbW1hbmQgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZDsgbm8gc2hlbGwgdG91Y2gnLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0b29sSW5wdXRUeXBlOiB0eXBlb2YgaW5wdXQudG9vbF9pbnB1dCxcbiAgICAgICAgICAgICAgdG9vbElucHV0S2V5czpcbiAgICAgICAgICAgICAgICBpbnB1dC50b29sX2lucHV0ICE9PSBudWxsICYmIHR5cGVvZiBpbnB1dC50b29sX2lucHV0ID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX2lucHV0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGNvbW1hbmQgPSBjb2RlTW9kZS5jbWQ7XG4gICAgICB9XG4gICAgICBpZiAoIWNvbW1hbmQpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IG1hdGNoZXMgPSBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kLCBjd2QpO1xuICAgICAgY29uc3QgYmxvY2tzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgZm9yIChjb25zdCBtYXRjaCBvZiBtYXRjaGVzKSB7XG4gICAgICAgIGlmIChtYXRjaC5zdGF0dXMgIT09ICdyZXNvbHZlZCcpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBzcGFuID0gbWF0Y2guc3BhbjtcbiAgICAgICAgY29uc3QgYWJzUGF0aCA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgICAgICBjb25zdCBzY29wZSA9IHJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgYWJzUGF0aCk7XG4gICAgICAgIGlmICghc2NvcGUpIGNvbnRpbnVlO1xuICAgICAgICBsZXQgdG91Y2hJbnB1dDoge1xuICAgICAgICAgIGtpbmQ6ICdyZWFkJyB8ICd3cml0ZSc7XG4gICAgICAgICAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgICAgICAgY3dkOiBzdHJpbmc7XG4gICAgICAgICAgZmlsZVBhdGg6IHN0cmluZztcbiAgICAgICAgICBvZmZzZXQ/OiBudW1iZXI7XG4gICAgICAgICAgbGltaXQ/OiBudW1iZXI7XG4gICAgICAgICAgd3JpdHRlbj86IHN0cmluZztcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKG1hdGNoLmlkaW9tID09PSAnaGVyZWRvYy13cml0ZScpIHtcbiAgICAgICAgICAvLyBgPmAgb3ZlcndyaXRlczogd2hvbGUtZmlsZSBzY29wZSBzbyBkZWxldGVkIHNwYW5zIGJleW9uZCB0aGUgbmV3XG4gICAgICAgICAgLy8gRU9GIGFyZSBzdXJmYWNlZC4gYD4+YCBhcHBlbmRzOiBuYXJyb3cgdG8gdGhlIGFwcGVuZGVkIGxpbmVzLlxuICAgICAgICAgIGNvbnN0IHdyaXR0ZW4gPSBzcGFuLnJlZGlyZWN0ID09PSAnPicgPyAnJyA6IChzcGFuLmJvZHkgPz8gJycpO1xuICAgICAgICAgIHRvdWNoSW5wdXQgPSB7IGtpbmQ6ICd3cml0ZScsIHNlc3Npb25JZCwgY3dkLCBmaWxlUGF0aDogYWJzUGF0aCwgd3JpdHRlbiB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRvdWNoSW5wdXQgPSB7XG4gICAgICAgICAgICBraW5kOiAncmVhZCcsXG4gICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICBjd2QsXG4gICAgICAgICAgICBmaWxlUGF0aDogYWJzUGF0aCxcbiAgICAgICAgICAgIG9mZnNldDogc3Bhbi5saW5lU3RhcnQsXG4gICAgICAgICAgICBsaW1pdDogc3Bhbi5saW5lRW5kIC0gc3Bhbi5saW5lU3RhcnQgKyAxXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2sodG91Y2hJbnB1dCBhcyBUb3VjaElucHV0LCBleGVjdXRvcnMsIG1lbW8pO1xuICAgICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgICAgfVxuICAgICAgaWYgKGJsb2Nrcy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICBjb25zdCBjb21iaW5lZCA9IGJsb2Nrcy5qb2luKCcnKTtcbiAgICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiBjb21iaW5lZCwgc3lzdGVtTWVzc2FnZTogY29tYmluZWQgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgY29tbWFuZCA9IG5hcnJvd0FwcGx5UGF0Y2hDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgIGlmIChjb21tYW5kID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgLy8gU3VwcHJlc3Mgb25seSBhICpjb25maXJtZWQqIG5vbi1zdWNjZXNzLiBBbiB1bnJlY29nbml6ZWQgcmVzcG9uc2Ugc2hhcGVcbiAgICAvLyBwcm9jZWVkcyAod2l0aCBhIHdhcm5pbmcpIHJhdGhlciB0aGFuIHJpc2sgc2tpcHBpbmcgYSByZWFsIGVkaXQncyB0b3VjaC5cbiAgICBjb25zdCBjbGFzc2lmaWNhdGlvbiA9IGNsYXNzaWZ5QXBwbHlQYXRjaFJlc3BvbnNlKGlucHV0LnRvb2xfcmVzcG9uc2UpO1xuICAgIGlmIChjbGFzc2lmaWNhdGlvbiA9PT0gJ2ZhaWx1cmUnKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmIChjbGFzc2lmaWNhdGlvbiA9PT0gJ3Vua25vd24nKSB7XG4gICAgICBjdHgubG9nZ2VyLndhcm4oJ0NvZGV4IGFwcGx5X3BhdGNoIHRvb2xfcmVzcG9uc2Ugc2hhcGUgdW5yZWNvZ25pemVkOyBydW5uaW5nIHRvdWNoIGRlZmVuc2l2ZWx5Jywge1xuICAgICAgICB0b29sUmVzcG9uc2VUeXBlOiB0eXBlb2YgaW5wdXQudG9vbF9yZXNwb25zZSxcbiAgICAgICAgdG9vbFJlc3BvbnNlS2V5czpcbiAgICAgICAgICBpbnB1dC50b29sX3Jlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiBpbnB1dC50b29sX3Jlc3BvbnNlID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX3Jlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIE9uZSBlbnZlbG9wZSBtYXkgdG91Y2ggc2V2ZXJhbCBmaWxlczsgZm9yY2Ugd2hvbGUtZmlsZSBhbmNob3JzIChDb2RleCBuZXZlclxuICAgIC8vIHJlY292ZXJzIGEgcG9zdC1lZGl0IHJhbmdlKSBhbmQgcnVuIHRoZSBzaGFyZWQgdG91Y2ggY29yZSBwZXIgdG91Y2hlZCBmaWxlLlxuICAgIC8vIFRoZSBzaGFyZWQgbWVtbyBkZWR1cGVzIHNwYW4gcmVuZGVycyBhY3Jvc3MgYW5jaG9ycyBhbmQgdGhlIHNlc3Npb24uXG4gICAgY29uc3QgYW5jaG9ycyA9IHBhcnNlQXBwbHlQYXRjaChjb21tYW5kLCBub1JhbmdlUmVjb3ZlcnkpO1xuICAgIGNvbnN0IGJsb2Nrczogc3RyaW5nW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IGFuY2hvciBvZiBhbmNob3JzKSB7XG4gICAgICBjb25zdCBhYnNQYXRoID0gYWJzcGF0aEFnYWluc3QoY3dkLCBhbmNob3IucGF0aCk7XG4gICAgICBjb25zdCBzY29wZSA9IHJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgYWJzUGF0aCk7XG4gICAgICBpZiAoIXNjb3BlKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1blRvdWNoSG9vayhcbiAgICAgICAgeyBraW5kOiAnd3JpdGUnLCBzZXNzaW9uSWQsIGN3ZCwgZmlsZVBhdGg6IGFic1BhdGgsIHdyaXR0ZW46ICcnIH0sXG4gICAgICAgIGV4ZWN1dG9ycyxcbiAgICAgICAgbWVtb1xuICAgICAgKTtcbiAgICAgIGlmIChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIGJsb2Nrcy5wdXNoKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2Nrcy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgcmV0dXJuIHBvc3RUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IGNvbWJpbmVkLCBzeXN0ZW1NZXNzYWdlOiBjb21iaW5lZCB9KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgcG9zdFRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ2FwcGx5X3BhdGNofGV4ZWNfY29tbWFuZHxleGVjfEJhc2gnLCB0aW1lb3V0OiAxMF8wMDAgfSwgY3JlYXRlSGFuZGxlcigpKTtcbiIsICJpbXBvcnQgaG9vayBmcm9tIFwiLi9wb3N0LXRvb2wtdXNlLnRzXCI7XG5pbXBvcnQgeyBleGVjdXRlIH0gZnJvbSBcIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9ydW50aW1lLmpzXCI7XG5leGVjdXRlKGhvb2spO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQTRCTyxJQUFNLDBCQUEwQixvQkFBSSxJQUFJLENBQUMsZ0JBQWdCLG9CQUFvQixlQUFlLENBQUM7OztBQzVCcEcsU0FBUyxlQUFlLGVBQWUsUUFBUSxTQUFTO0FBQ3BELFFBQU0sT0FBTztBQUNiLE9BQUssZ0JBQWdCO0FBQ3JCLE9BQUssVUFBVSxPQUFPO0FBQ3RCLE9BQUssZ0JBQWdCLE9BQU87QUFDNUIsTUFBSSxhQUFhLFVBQVUsT0FBTyxPQUFPLFlBQVksVUFBVTtBQUMzRCxTQUFLLFVBQVUsT0FBTztBQUFBLEVBQzFCO0FBQ0EsU0FBTztBQUNYO0FBSU8sU0FBUyxnQkFBZ0IsUUFBUSxTQUFTO0FBQzdDLFNBQU8sZUFBZSxlQUFlLFFBQVEsT0FBTztBQUN4RDs7O0FDZkEsU0FBUyxXQUFXLFlBQVksV0FBVyxVQUFVLGlCQUFpQjtBQUN0RSxTQUFTLGVBQWU7QUFDeEIsSUFBTSxzQkFBc0I7QUFDckIsSUFBTSxTQUFOLE1BQWE7QUFBQSxFQUNoQixXQUFXLG9CQUFJLElBQUk7QUFBQSxFQUNuQixrQkFBa0I7QUFBQSxFQUNsQixZQUFZO0FBQUEsRUFDWixjQUFjO0FBQUEsRUFDZDtBQUFBLEVBQ0E7QUFBQSxFQUNBLFlBQVksU0FBUyxDQUFDLEdBQUc7QUFDckIsU0FBSyxjQUFjLE9BQU8sZUFBZSxRQUFRLElBQUksT0FBTyxhQUFhLG1CQUFtQixLQUFLO0FBQUEsRUFDckc7QUFBQSxFQUNBLFdBQVcsVUFBVSxPQUFPO0FBQ3hCLFNBQUssa0JBQWtCO0FBQ3ZCLFNBQUssZUFBZTtBQUFBLEVBQ3hCO0FBQUEsRUFDQSxlQUFlO0FBQ1gsU0FBSyxrQkFBa0I7QUFDdkIsU0FBSyxlQUFlO0FBQUEsRUFDeEI7QUFBQSxFQUNBLEdBQUcsT0FBTyxTQUFTO0FBQ2YsVUFBTSxXQUFXLEtBQUssU0FBUyxJQUFJ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QUk3QixVQUFNLGlCQUFpQiwyQkFBMkIsTUFBTSxhQUFhO0FBQ3JFLFFBQUksbUJBQW1CLFVBQVcsUUFBTztBQUN6QyxRQUFJLG1CQUFtQixXQUFXO0FBQ2hDLFVBQUksT0FBTyxLQUFLLGlGQUFpRjtBQUFBLFFBQy9GLGtCQUFrQixPQUFPLE1BQU07QUFBQSxRQUMvQixrQkFDRSxNQUFNLGtCQUFrQixRQUFRLE9BQU8sTUFBTSxrQkFBa0IsV0FDM0QsT0FBTyxLQUFLLE1BQU0sYUFBd0MsSUFDMUQ7QUFBQSxNQUNSLENBQUM7QUFBQSxJQUNIO0FBS0EsVUFBTSxVQUFVLGdCQUFnQixTQUFTLGVBQWU7QUFDeEQsVUFBTSxTQUFtQixDQUFDO0FBQzFCLGVBQVcsVUFBVSxTQUFTO0FBQzVCLFlBQU0sVUFBVSxlQUFlLEtBQUssT0FBTyxJQUFJO0FBQy9DLFlBQU0sUUFBUSxrQkFBa0IsS0FBSyxPQUFPO0FBQzVDLFVBQUksQ0FBQyxNQUFPO0FBQ1osWUFBTSxTQUFTLE1BQU07QUFBQSxRQUNuQixFQUFFLE1BQU0sU0FBUyxXQUFXLEtBQUssVUFBVSxTQUFTLFNBQVMsR0FBRztBQUFBLFFBQ2hFO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFDQSxVQUFJLE9BQU8sa0JBQW1CLFFBQU8sS0FBSyxPQUFPLGlCQUFpQjtBQUFBLElBQ3BFO0FBRUEsUUFBSSxPQUFPLFdBQVcsRUFBRyxRQUFPO0FBQ2hDLFVBQU0sV0FBVyxPQUFPLEtBQUssRUFBRTtBQUMvQixXQUFPLGtCQUFrQixFQUFFLG1CQUFtQixVQUFVLGVBQWUsU0FBUyxDQUFDO0FBQUEsRUFDbkY7QUFDRjtBQUVBLElBQU8sd0JBQVEsZ0JBQWdCLEVBQUUsU0FBUyxzQ0FBc0MsU0FBUyxJQUFPLEdBQUcsY0FBYyxDQUFDOzs7QUNsV2xILFFBQVEscUJBQUk7IiwKICAibmFtZXMiOiBbInJlc29sdmUiLCAiZXhlY0ZpbGVTeW5jIiwgInN0YXRTeW5jIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJsb2dnZXIiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgImJhc2VuYW1lIiwgImJhc2VuYW1lIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJ0b1Bvc2l4IiwgImN0eCIsICJyZWNvdmVyUmFuZ2UiLCAiY29tbWFuZCIsICJibG9ja3MiLCAiY29tYmluZWQiXQp9Cg==
