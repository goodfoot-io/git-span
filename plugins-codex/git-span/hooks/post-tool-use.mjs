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
function parseStalePorcelain(stdout) {
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
      if (bodyLines === 0) continue;
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
          span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath }
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
    return `Restore agreement across the anchors before committing \u2014 docs follow deliberately committed code \u2014 then refresh: \`git span add ${name} <path#Lstart-Lend>\` / \`git span why ${name} "..."\` \u2014 and check the other anchors for knock-on changes. If the fix needs a code change or the coupling no longer holds, tell the user instead.`;
  }
  return 'For each out-of-date span above: restore agreement across the anchors before committing \u2014 docs follow deliberately committed code \u2014 then refresh: `git span add <name> <path#Lstart-Lend>` / `git span why <name> "..."` \u2014 and check the other anchors for knock-on changes. If a fix needs a code change or a coupling no longer holds, tell the user instead.';
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
  const staleRows = await executors.stale([input.filePath], input.cwd);
  const staleByName = /* @__PURE__ */ new Map();
  for (const row of staleRows) {
    const rows = staleByName.get(row.name) ?? [];
    rows.push(row);
    staleByName.set(row.name, rows);
  }
  const surfaced = memo.getSurfaced(input.sessionId);
  const toRecord = [];
  const sections = [];
  const driftedNames = [];
  for (const name of touchedNames) {
    const spanStale = staleByName.get(name) ?? [];
    const debtRows = spanStale.filter((row) => isDebt(row.status));
    if (spanStale.length > 0 && debtRows.length === 0) continue;
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
        execFileSync4("git", ["span", "stale", resolved.relPath, "--fix"], {
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
    stale: async (args, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      const runCwd = repoRoot ?? cwd;
      const scoped = repoRoot ? args.map((a) => relativeToRepo(repoRoot, a)) : args;
      let out;
      try {
        out = execFileSync4("git", ["span", "stale", "--format", "porcelain", ...scoped], {
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
      return parseStalePorcelain(out);
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
function narrowCodeModeExec(toolInput) {
  if (toolInput !== null && typeof toolInput === "object" && "input" in toolInput) {
    const input = toolInput.input;
    if (typeof input !== "string") return null;
    const match = input.match(/tools\.exec_command\(\s*(\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})\s*\)/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed !== null && typeof parsed === "object" && typeof parsed.cmd === "string") {
        return parsed.cmd;
      }
    } catch {
      return null;
    }
  }
  return null;
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
    ctx.logger.info("git-span post-tool-use observed tool", {
      tool_name: input.tool_name,
      tool_input_type: typeof input.tool_input,
      tool_input_keys: input.tool_input !== null && typeof input.tool_input === "object" ? Object.keys(input.tool_input) : void 0
    });
    const tool_name = input.tool_name;
    const cwd = input.cwd ?? "";
    const sessionId = input.session_id;
    const memo = memoFactory(ctx.logger);
    if (tool_name === "exec_command" || tool_name === "exec") {
      const command2 = narrowExecCommand(input.tool_input) ?? narrowCodeModeExec(input.tool_input);
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
          touchInput = { kind: "write", sessionId, cwd, filePath: absPath, written: "" };
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
var post_tool_use_default = postToolUseHook({ matcher: "apply_patch|exec_command|exec", timeout: 1e4 }, createHandler());

// src/codex/post-tool-use-entry.ts
execute(post_tool_use_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb2RleC9hcHBseS1wYXRjaC50cyIsICJzcmMvY29kZXgvcG9zdC10b29sLXVzZS50cyIsICJzcmMvY29kZXgvcG9zdC10b29sLXVzZS1lbnRyeS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZXhwb3J0IGNvbnN0IFBBQ0tBR0VfTkFNRSA9IFwiQGdvb2Rmb290L2NvZGV4LWhvb2tzXCI7XG5leHBvcnQgY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gNjAwXzAwMDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1NUQVRVU19NRVNTQUdFID0gdW5kZWZpbmVkO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfRVNCVUlMRF9MT0FERVJTID0ge1xuICAgIFwiLm1kXCI6IFwidGV4dFwiLFxufTtcbmV4cG9ydCBjb25zdCBIT09LX0ZBQ1RPUllfVE9fRVZFTlQgPSB7XG4gICAgcHJlVG9vbFVzZUhvb2s6IFwiUHJlVG9vbFVzZVwiLFxuICAgIHBvc3RUb29sVXNlSG9vazogXCJQb3N0VG9vbFVzZVwiLFxuICAgIHBlcm1pc3Npb25SZXF1ZXN0SG9vazogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIHVzZXJQcm9tcHRTdWJtaXRIb29rOiBcIlVzZXJQcm9tcHRTdWJtaXRcIixcbiAgICBzZXNzaW9uU3RhcnRIb29rOiBcIlNlc3Npb25TdGFydFwiLFxuICAgIHN1YmFnZW50U3RhcnRIb29rOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICBzdG9wSG9vazogXCJTdG9wXCIsXG4gICAgc3ViYWdlbnRTdG9wSG9vazogXCJTdWJhZ2VudFN0b3BcIixcbiAgICBwcmVDb21wYWN0SG9vazogXCJQcmVDb21wYWN0XCIsXG4gICAgcG9zdENvbXBhY3RIb29rOiBcIlBvc3RDb21wYWN0XCIsXG59O1xuZXhwb3J0IGNvbnN0IEVWRU5UU19XSVRIX01BVENIRVIgPSBuZXcgU2V0KFtcbiAgICBcIlByZVRvb2xVc2VcIixcbiAgICBcIlBvc3RUb29sVXNlXCIsXG4gICAgXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0b3BcIixcbiAgICBcIlByZUNvbXBhY3RcIixcbiAgICBcIlBvc3RDb21wYWN0XCIsXG5dKTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9URVhUX09VVFBVVCA9IG5ldyBTZXQoW1wiU2Vzc2lvblN0YXJ0XCIsIFwiVXNlclByb21wdFN1Ym1pdFwiLCBcIlN1YmFnZW50U3RhcnRcIl0pO1xuIiwgImZ1bmN0aW9uIGF0dGFjaE1ldGFkYXRhKGhvb2tFdmVudE5hbWUsIGNvbmZpZywgaGFuZGxlcikge1xuICAgIGNvbnN0IGhvb2sgPSBoYW5kbGVyO1xuICAgIGhvb2suaG9va0V2ZW50TmFtZSA9IGhvb2tFdmVudE5hbWU7XG4gICAgaG9vay50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXQ7XG4gICAgaG9vay5zdGF0dXNNZXNzYWdlID0gY29uZmlnLnN0YXR1c01lc3NhZ2U7XG4gICAgaWYgKFwibWF0Y2hlclwiIGluIGNvbmZpZyAmJiB0eXBlb2YgY29uZmlnLm1hdGNoZXIgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaG9vay5tYXRjaGVyID0gY29uZmlnLm1hdGNoZXI7XG4gICAgfVxuICAgIHJldHVybiBob29rO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZVRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdFRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUGVybWlzc2lvblJlcXVlc3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJVc2VyUHJvbXB0U3VibWl0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTZXNzaW9uU3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdWJhZ2VudFN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdG9wXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUHJlQ29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQb3N0Q29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuIiwgImltcG9ydCB7IGNsb3NlU3luYywgZXhpc3RzU3luYywgbWtkaXJTeW5jLCBvcGVuU3luYywgd3JpdGVTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5jb25zdCBERUZBVUxUX0xPR19FTlZfVkFSID0gXCJDT0RFWF9IT09LU19MT0dfRklMRVwiO1xuZXhwb3J0IGNsYXNzIExvZ2dlciB7XG4gICAgaGFuZGxlcnMgPSBuZXcgTWFwKCk7XG4gICAgZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgbG9nRmlsZUZkID0gbnVsbDtcbiAgICBsb2dGaWxlUGF0aCA9IG51bGw7XG4gICAgY3VycmVudEhvb2tUeXBlO1xuICAgIGN1cnJlbnRJbnB1dDtcbiAgICBjb25zdHJ1Y3Rvcihjb25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ0ZpbGVQYXRoID0gY29uZmlnLmxvZ0ZpbGVQYXRoID8/IHByb2Nlc3MuZW52W2NvbmZpZy5sb2dFbnZWYXIgPz8gREVGQVVMVF9MT0dfRU5WX1ZBUl0gPz8gbnVsbDtcbiAgICB9XG4gICAgc2V0Q29udGV4dChob29rVHlwZSwgaW5wdXQpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSBob29rVHlwZTtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSBpbnB1dDtcbiAgICB9XG4gICAgY2xlYXJDb250ZXh0KCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIG9uKGxldmVsLCBoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5oYW5kbGVycy5nZXQobGV2ZWwpID8/IG5ldyBTZXQoKTtcbiAgICAgICAgZXhpc3RpbmcuYWRkKGhhbmRsZXIpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLnNldChsZXZlbCwgZXhpc3RpbmcpO1xuICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgZXhpc3RpbmcuZGVsZXRlKGhhbmRsZXIpO1xuICAgICAgICAgICAgaWYgKGV4aXN0aW5nLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmhhbmRsZXJzLmRlbGV0ZShsZXZlbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxuICAgIGRlYnVnKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZGVidWdcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGluZm8obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJpbmZvXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICB3YXJuKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwid2FyblwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgZXJyb3IobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgbG9nRXJyb3IoZXJyb3IsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgYCR7bWVzc2FnZX06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIGNvbnRleHQpO1xuICAgIH1cbiAgICBjbG9zZSgpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbG9zZVN5bmModGhpcy5sb2dGaWxlRmQpO1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVtaXQobGV2ZWwsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSB7XG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIGxldmVsLFxuICAgICAgICAgICAgaG9va1R5cGU6IHRoaXMuY3VycmVudEhvb2tUeXBlLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIC4uLih0aGlzLmN1cnJlbnRJbnB1dCAhPT0gdW5kZWZpbmVkID8geyBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQgfSA6IHt9KSxcbiAgICAgICAgICAgIC4uLihjb250ZXh0ICE9PSB1bmRlZmluZWQgPyB7IGNvbnRleHQgfSA6IHt9KSxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy53cml0ZVRvRmlsZShldmVudCk7XG4gICAgICAgIHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKT8uZm9yRWFjaCgoaGFuZGxlcikgPT4ge1xuICAgICAgICAgICAgaGFuZGxlcihldmVudCk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICB3cml0ZVRvRmlsZShldmVudCkge1xuICAgICAgICBpZiAodGhpcy5sb2dGaWxlUGF0aCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5maWxlSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IGxvZ0RpciA9IGRpcm5hbWUodGhpcy5sb2dGaWxlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMobG9nRGlyKSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyhsb2dEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBvcGVuU3luYyh0aGlzLmxvZ0ZpbGVQYXRoLCBcImFcIik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB3cml0ZVN5bmModGhpcy5sb2dGaWxlRmQsIGAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5gKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmV4cG9ydCBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKCk7XG4iLCAiZXhwb3J0IGNvbnN0IEVYSVRfQ09ERVMgPSB7XG4gICAgU1VDQ0VTUzogMCxcbiAgICBFUlJPUjogMSxcbiAgICBCTE9DSzogMixcbn07XG5leHBvcnQgY2xhc3MgQmxvY2tFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICByZWFzb247XG4gICAgY29uc3RydWN0b3IocmVhc29uKSB7XG4gICAgICAgIHN1cGVyKHJlYXNvbik7XG4gICAgICAgIHRoaXMubmFtZSA9IFwiQmxvY2tFcnJvclwiO1xuICAgICAgICB0aGlzLnJlYXNvbiA9IHJlYXNvbjtcbiAgICB9XG59XG5mdW5jdGlvbiBvbWl0VW5kZWZpbmVkKHZhbHVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh2YWx1ZSkuZmlsdGVyKChbLCBlbnRyeV0pID0+IGVudHJ5ICE9PSB1bmRlZmluZWQpKTtcbn1cbmZ1bmN0aW9uIGJ1aWxkT3V0cHV0KHR5cGUsIHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgX3R5cGU6IHR5cGUsXG4gICAgICAgIHN0ZG91dDogb21pdFVuZGVmaW5lZChzdGRvdXQpLFxuICAgICAgICAuLi4oc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZGVyciB9IDoge30pLFxuICAgIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmF3T3V0cHV0KHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUmF3XCIsIHN0ZG91dCwgc3RkZXJyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnVwZGF0ZWRJbnB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlByZVRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbixcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24sXG4gICAgICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlTGVnYWN5QmxvY2tPdXRwdXQob3B0aW9ucykge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQb3N0VG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICB1cGRhdGVkTUNQVG9vbE91dHB1dDogb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdFRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KG9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWNpc2lvbiA9IG9taXRVbmRlZmluZWQoe1xuICAgICAgICBiZWhhdmlvcjogb3B0aW9ucy5iZWhhdmlvcixcbiAgICAgICAgbWVzc2FnZTogb3B0aW9ucy5tZXNzYWdlLFxuICAgICAgICBpbnRlcnJ1cHQ6IG9wdGlvbnMuaW50ZXJydXB0LFxuICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB1cGRhdGVkUGVybWlzc2lvbnM6IG9wdGlvbnMudXBkYXRlZFBlcm1pc3Npb25zLFxuICAgIH0pO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IHtcbiAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgICAgICBkZWNpc2lvbixcbiAgICB9O1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJVc2VyUHJvbXB0U3VibWl0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTZXNzaW9uU3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlNlc3Npb25TdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0Q29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG4iLCAiaW1wb3J0IHsgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgfSBmcm9tIFwiLi9jb25zdGFudHMuanNcIjtcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gXCIuL2xvZ2dlci5qc1wiO1xuaW1wb3J0IHsgQmxvY2tFcnJvciwgRVhJVF9DT0RFUywgc2Vzc2lvblN0YXJ0T3V0cHV0LCBzdWJhZ2VudFN0YXJ0T3V0cHV0LCB1c2VyUHJvbXB0U3VibWl0T3V0cHV0LCB9IGZyb20gXCIuL291dHB1dHMuanNcIjtcbmFzeW5jIGZ1bmN0aW9uIHJlYWRTdGRpbigpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCBjaHVua3MgPSBbXTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5zZXRFbmNvZGluZyhcInV0Zi04XCIpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IGNodW5rcy5wdXNoKGNodW5rKSk7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJlbmRcIiwgKCkgPT4gcmVzb2x2ZShjaHVua3Muam9pbihcIlwiKSkpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZXJyb3JcIiwgcmVqZWN0KTtcbiAgICB9KTtcbn1cbmZ1bmN0aW9uIHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpIHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShzdGRpbkNvbnRlbnQpO1xufVxuZnVuY3Rpb24gd3JpdGVTdGRvdXQob3V0cHV0KSB7XG4gICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoSlNPTi5zdHJpbmdpZnkob3V0cHV0LnN0ZG91dCkpO1xufVxuZnVuY3Rpb24gbm9ybWFsaXplU3RyaW5nT3V0cHV0KGhvb2tFdmVudE5hbWUsIHJlc3VsdCkge1xuICAgIGlmICghRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQuaGFzKGhvb2tFdmVudE5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtob29rRXZlbnROYW1lfSBob29rcyBjYW5ub3QgcmV0dXJuIHBsYWluIHRleHRgKTtcbiAgICB9XG4gICAgaWYgKGhvb2tFdmVudE5hbWUgPT09IFwiU2Vzc2lvblN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlN1YmFnZW50U3RhcnRcIikge1xuICAgICAgICByZXR1cm4gc3ViYWdlbnRTdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIHJldHVybiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0VG9Ib29rT3V0cHV0KG91dHB1dCkge1xuICAgIHJldHVybiBvdXRwdXQuc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCwgc3RkZXJyOiBvdXRwdXQuc3RkZXJyIH0gOiB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCB9O1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGUoaG9va0ZuKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RkaW5Db250ZW50ID0gYXdhaXQgcmVhZFN0ZGluKCk7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcGFyc2VTdGRpbklucHV0KHN0ZGluQ29udGVudCk7XG4gICAgICAgIGxvZ2dlci5zZXRDb250ZXh0KGhvb2tGbi5ob29rRXZlbnROYW1lLCBpbnB1dCk7XG4gICAgICAgIGNvbnN0IGNvbnRleHQgPSB7IGxvZ2dlciB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBob29rRm4oaW5wdXQsIGNvbnRleHQpO1xuICAgICAgICBsZXQgb3V0cHV0ID0geyBzdGRvdXQ6IHt9IH07XG4gICAgICAgIGlmICh0eXBlb2YgcmVzdWx0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRm4uaG9va0V2ZW50TmFtZSwgcmVzdWx0KSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG91dHB1dCA9IGNvbnZlcnRUb0hvb2tPdXRwdXQocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgICB3cml0ZVN0ZG91dChvdXRwdXQpO1xuICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5TVUNDRVNTKTtcbiAgICB9XG4gICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJsb2NrRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnJlYXNvbn1cXG5gKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkJMT0NLKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3Iuc3RhY2sgPz8gZXJyb3IubWVzc2FnZX1cXG5gKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke1N0cmluZyhlcnJvcil9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuRVJST1IpO1xuICAgIH1cbiAgICBmaW5hbGx5IHtcbiAgICAgICAgbG9nZ2VyLmNsZWFyQ29udGV4dCgpO1xuICAgICAgICBsb2dnZXIuY2xvc2UoKTtcbiAgICB9XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgaGVscGVycyB1c2VkIGJ5IG11bHRpcGxlIGFnZW50LWhvb2tzIGVudHJ5IHBvaW50cy5cbiAqXG4gKiBFeHRyYWN0ZWQgZnJvbSBwcmUtdG9vbC11c2UudHMgc28gdGhhdCB0aGUgdXBjb21pbmcgU3RvcCBob29rIChhbmQgYW55XG4gKiBmdXR1cmUgaG9va3MpIGNhbiBpbXBvcnQgcGF0aCB1dGlsaXRpZXMsIHJhbmdlIGhlbHBlcnMsIGFuZCB0aGVcbiAqIHNhbml0aXplU2Vzc2lvbklkL2Zvcm1hdEFuY2hvciBmdW5jdGlvbnMgd2l0aG91dCBkZXBlbmRpbmcgb24gdGhlXG4gKiBQcmVUb29sVXNlLXNwZWNpZmljIG1vZHVsZS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGF0aCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG5mdW5jdGlvbiBpc0Fic29sdXRlUG9zaXgocDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBwLnN0YXJ0c1dpdGgoJy8nKSB8fCAvXltBLVphLXpdOlxcLy8udGVzdChwKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFic3BhdGhBZ2FpbnN0KGJhc2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0ID0gdG9Qb3NpeCh0YXJnZXQpO1xuICBpZiAoaXNBYnNvbHV0ZVBvc2l4KHQpKSByZXR1cm4gdDtcbiAgY29uc3QgYiA9IHRvUG9zaXgoYmFzZSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiBgJHtifS8ke3R9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZXBvUm9vdChkaXI6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFkaXIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIGRpciwgJ3Jldi1wYXJzZScsICctLXNob3ctdG9wbGV2ZWwnXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IG91dC50cmltKCk7XG4gICAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRvUG9zaXgodHJpbW1lZCkgOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGlzIGV4Y2x1ZGVkIGJ5IGdpdCdzIGlnbm9yZSBydWxlc1xuICogKC5naXRpZ25vcmUsIC5naXQvaW5mby9leGNsdWRlLCBjb3JlLmV4Y2x1ZGVzRmlsZSkuIFVzZWQgdG8ga2VlcCBpZ25vcmVkXG4gKiBmaWxlcyBcdTIwMTQgYnVpbGQgb3V0cHV0LCBjYWNoZXMsIGxvZ3MgXHUyMDE0IG91dCBvZiB0b3VjaCB0cmFja2luZyBlbnRpcmVseSwgc29cbiAqIHRoZSB0b3VjaCBob29rIG5ldmVyIHJlcG9ydHMgcmVhZHMsIHdyaXRlcywgb3IgdW5jb3ZlcmVkIHdyaXRlcyBvbiB0aGVtLlxuICpcbiAqIGBnaXQgY2hlY2staWdub3JlIC1xIDxwYXRoPmAgZXhpdHMgMCB3aGVuIHRoZSBwYXRoIGlzIGlnbm9yZWQsIDEgd2hlbiBpdCBpc1xuICogbm90LCBhbmQgMTI4IG9uIGVycm9yLiBleGVjRmlsZVN5bmMgdGhyb3dzIG9uIGFueSBub24temVybyBleGl0LCBzbyBhIGNsZWFuXG4gKiByZXR1cm4gbWVhbnMgXCJpZ25vcmVkXCIuIEEgc3RhdHVzLTEgdGhyb3cgaXMgdGhlIGV4cGVjdGVkIFwibm90IGlnbm9yZWRcIlxuICogc2lnbmFsOyBhbnkgb3RoZXIgZmFpbHVyZSBpcyBhbiB1bnJlbGlhYmxlIGFuc3dlciwgc28gd2UgcmVwb3J0IGBmYWxzZWBcbiAqIChkbyBub3QgZHJvcCB0aGUgdG91Y2gpIHJhdGhlciB0aGFuIHNpbGVudGx5IGhpZGluZyBhIHRyYWNrZWQgZmlsZS5cbiAqL1xuLyoqXG4gKiBUaGUgZGVmYXVsdCBzcGFuIHJvb3QgZGlyZWN0b3J5LCByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290LCB1c2VkIHdoZW4gbm9cbiAqIGVudmlyb25tZW50IHZhcmlhYmxlIG9yIGdpdCBjb25maWcgb3ZlcnJpZGVzIHRoZSBsb2NhdGlvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IFNQQU5fUk9PVCA9ICcuc3Bhbic7XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgc3BhbiByb290IGRpcmVjdG9yeSBmb3IgYSBnaXZlbiByZXBvLCBtaXJyb3JpbmcgdGhlIFJ1c3QgQ0xJXG4gKiBwcmVjZWRlbmNlIChtaW51cyB0aGUgLS1zcGFuLWRpciBDTEkgZmxhZywgd2hpY2ggaXMgaW52aXNpYmxlIHRvIGZpbGUtd3JpdGVcbiAqIGhvb2tzKTpcbiAqICAgMS4gR0lUX1NQQU5fRElSIGVudmlyb25tZW50IHZhcmlhYmxlXG4gKiAgIDIuIGBnaXQgY29uZmlnIGdpdC1zcGFuLmRpcmAgaW4gdGhlIHJlcG9cbiAqICAgMy4gRGVmYXVsdDogXCIuc3BhblwiXG4gKlxuICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgUE9TSVgtc3R5bGUgcGF0aCB3aXRoIG5vIHRyYWlsaW5nIHNsYXNoLlxuICogRmFpbC1zYWZlOiBhbnkgcmVzb2x1dGlvbiBlcnJvciBmYWxscyBiYWNrIHRvIFwiLnNwYW5cIiBzbyB0aGUgaG9vayBuZXZlclxuICogY3Jhc2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgZW52RGlyID0gcHJvY2Vzcy5lbnZbJ0dJVF9TUEFOX0RJUiddO1xuICBpZiAoZW52RGlyICYmIGVudkRpci50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB0b1Bvc2l4KGVudkRpci50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjb25maWcnLCAnZ2l0LXNwYW4uZGlyJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA+IDApIHJldHVybiB0cmltbWVkO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjsgLy8gY29uZmlnIGtleSBhYnNlbnQgb3IgZ2l0IGVycm9yIFx1MjAxNCBmYWxsIHRocm91Z2ggdG8gZGVmYXVsdFxuICB9XG4gIHJldHVybiBTUEFOX1JPT1Q7XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGggZmFsbHMgaW5zaWRlIHRoZSBnaXZlbiBzcGFuIHJvb3RcbiAqIGRpcmVjdG9yeS4gQSBwYXRoIGlzIGluc2lkZSB3aGVuIGl0IGVxdWFscyB0aGUgc3BhbiByb290IGV4YWN0bHkgb3IgaXNcbiAqIG5lc3RlZCBiZW5lYXRoIGl0IChpLmUuIHN0YXJ0cyB3aXRoIFwiPHNwYW5Sb290Pi9cIikuIFRoZSBcIi9cIiBib3VuZGFyeSBwcmV2ZW50c1xuICogZmFsc2UgcG9zaXRpdmVzIGZvciBzaWJsaW5ncyBsaWtlIFwiLnNwYW5zL3hcIiBvciBcIi5zcGFuLW5vdGVzL3hcIi5cbiAqXG4gKiBQYXNzIHRoZSByZXN1bHQgb2YgYHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdClgIGFzIGBzcGFuUm9vdGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNwYW5Sb290OiBzdHJpbmcgPSBTUEFOX1JPT1QpOiBib29sZWFuIHtcbiAgY29uc3Qgcm9vdCA9IHNwYW5Sb290LnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gcmVwb1JlbFBhdGggPT09IHJvb3QgfHwgcmVwb1JlbFBhdGguc3RhcnRzV2l0aChgJHtyb290fS9gKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzR2l0SWdub3JlZChyZXBvUm9vdDogc3RyaW5nLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjaGVjay1pZ25vcmUnLCAnLXEnLCAnLS0nLCByZXBvUmVsUGF0aF0sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdpZ25vcmUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByb290ID0gdG9Qb3NpeChyZXBvUm9vdCk7XG4gIGNvbnN0IGFicyA9IHRvUG9zaXgoYWJzUGF0aCk7XG4gIGNvbnN0IHByZWZpeCA9IHJvb3QuZW5kc1dpdGgoJy8nKSA/IHJvb3QgOiBgJHtyb290fS9gO1xuICByZXR1cm4gYWJzLnN0YXJ0c1dpdGgocHJlZml4KSA/IGFicy5zbGljZShwcmVmaXgubGVuZ3RoKSA6IGFicztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbm9uaWNhbGl6ZVBhdGgoYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKGFic1BhdGgpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmlsZSBkb2Vzbid0IGV4aXN0IHlldCAoZS5nLiBXcml0ZSB0byBhIG5ldyBmaWxlKTogY2Fub25pY2FsaXplIHRoZVxuICAgIC8vIGRpcmVjdG9yeSBhbmQgcmVqb2luIHRoZSBiYXNlbmFtZSBzbyBzeW1saW5rcyBpbiB0aGUgcGFyZW50IGFyZSByZXNvbHZlZC5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlyID0gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpKTtcbiAgICAgIHJldHVybiBgJHtkaXJ9LyR7bm9kZVBhdGguYmFzZW5hbWUoYWJzUGF0aCl9YDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBhcmVudCBkb2Vzbid0IGV4aXN0IGVpdGhlcjsgZmFsbCBiYWNrIHRvIHRoZSB1bi1jYW5vbmljYWxpemVkIHBhdGguXG4gICAgICByZXR1cm4gYWJzUGF0aDtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZVBhdGgodG9vbElucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgY3dkOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgZnAgPSB0b29sSW5wdXQuZmlsZV9wYXRoO1xuICBpZiAodHlwZW9mIGZwICE9PSAnc3RyaW5nJyB8fCBmcC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBhYnMgPSBhYnNwYXRoQWdhaW5zdChjd2QsIGZwKTtcbiAgcmV0dXJuIGNhbm9uaWNhbGl6ZVBhdGgoYWJzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lIHJhbmdlIHR5cGVzIGFuZCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBMaW5lUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmdlc0ludGVyc2VjdChhOiBMaW5lUmFuZ2UsIGI6IExpbmVSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5zdGFydCA8PSBiLmVuZCAmJiBhLmVuZCA+PSBiLnN0YXJ0O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvcmNlbGFpbiByb3cgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9yY2VsYWluUm93IHtcbiAgbmFtZTogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMykgY29udGludWU7XG4gICAgY29uc3QgW25hbWUsIHBhdGgsIHJhbmdlXSA9IHBhcnRzO1xuICAgIGNvbnN0IGRhc2hJZHggPSByYW5nZS5pbmRleE9mKCctJyk7XG4gICAgaWYgKGRhc2hJZHggPT09IC0xKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKDAsIGRhc2hJZHgpLCAxMCk7XG4gICAgY29uc3QgZW5kID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoZGFzaElkeCArIDEpLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwgYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgc3RhdHVzIHRva2VuIHZvY2FidWxhcnkgKHRoZVxuICogZ2l0LXNwYW4gQ0xJJ3MgcG9yY2VsYWluIGNvbnRyYWN0KTogYEZSRVNIYC9gTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGBcbiAqIGFyZSBwb3NpdGlvbmFsLW9yLWNsZWFuIGFuZCBuZXZlciBkZWJ0OyBldmVyeSBvdGhlciB0b2tlbiBpcyBzZW1hbnRpYyBkcmlmdFxuICogb3IgYSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb24gYW5kIGlzIGRlYnQuIFNlZSB7QGxpbmsgaXNEZWJ0fSBmb3IgdGhlXG4gKiBzaW5nbGUgc291cmNlIG9mIHRydXRoIG9uIHRoYXQgc3BsaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBQT1JDRUxBSU5fU1RBVFVTRVMgPSBbXG4gICdGUkVTSCcsXG4gICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCcsXG4gICdNT1ZFRCcsXG4gICdDSEFOR0VEJyxcbiAgJ0RFTEVURUQnLFxuICAnQ09ORkxJQ1QnLFxuICAnU1VCTU9EVUxFJyxcbiAgJ0xGU19OT1RfRkVUQ0hFRCcsXG4gICdMRlNfTk9UX0lOU1RBTExFRCcsXG4gICdQUk9NSVNPUl9NSVNTSU5HJyxcbiAgJ1NQQVJTRV9FWENMVURFRCcsXG4gICdGSUxURVJfRkFJTEVEJyxcbiAgJ0lPX0VSUk9SJ1xuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgUG9yY2VsYWluU3RhdHVzID0gKHR5cGVvZiBQT1JDRUxBSU5fU1RBVFVTRVMpW251bWJlcl07XG5cbmNvbnN0IFBPUkNFTEFJTl9TVEFUVVNfU0VUOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChQT1JDRUxBSU5fU1RBVFVTRVMpO1xuXG5mdW5jdGlvbiBwYXJzZVBvcmNlbGFpblN0YXR1cyhyYXc6IHN0cmluZyk6IFBvcmNlbGFpblN0YXR1cyB8IG51bGwge1xuICByZXR1cm4gUE9SQ0VMQUlOX1NUQVRVU19TRVQuaGFzKHJhdykgPyAocmF3IGFzIFBvcmNlbGFpblN0YXR1cykgOiBudWxsO1xufVxuXG4vKiogQSBgcGFyc2VTdGFsZVBvcmNlbGFpbmAgcm93OiBhIHtAbGluayBQb3JjZWxhaW5Sb3d9IHBsdXMgaXRzIHN0YXR1cyB0b2tlbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhbGVQb3JjZWxhaW5Sb3cgZXh0ZW5kcyBQb3JjZWxhaW5Sb3cge1xuICBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cztcbn1cblxuLyoqXG4gKiBUaGUgZGVidCBpbnZhcmlhbnQgKHN5c3RlbS13aWRlOyBjb25zdW1lZCBieSBib3RoIHRoZSBmdXR1cmUgdG91Y2gtY29yZSBhbmRcbiAqIGFkdmlzb3ItY29yZSk6IG9ubHkgc2VtYW50aWMgc3RhdHVzZXMgYXJlIGRlYnQuIGBDSEFOR0VEYCBhbmQgYERFTEVURURgIGFyZVxuICogc2VtYW50aWMgZHJpZnQ7IHRoZSByZW1haW5pbmcgbm9uLUZSRVNIL01PVkVEL1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUIHRva2Vuc1xuICogYXJlIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbnMgYW5kIGFyZSB0cmVhdGVkIGFzIGRlYnQgdG9vICh0aGV5IGJsb2NrIG9uXG4gKiB0aGVpciBvd24gbWVyaXRzIFx1MjAxNCB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXQgYWxsKS4gYEZSRVNIYCxcbiAqIGBNT1ZFRGAsIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0OiBwb3NpdGlvbmFsIGRyaWZ0IHRoZVxuICogQ0xJIGNhbiBoZWFsIChvciBhbHJlYWR5IGhhcykgaXMgaW52aXNpYmxlLCBhbmQgYSBwZW5kaW5nLWNvbW1pdCByZXNvbHV0aW9uXG4gKiBpcyBub3Qgb3V0c3RhbmRpbmcgZGVidC5cbiAqXG4gKiBOb3RlOiB0aGUgcG9yY2VsYWluIHZvY2FidWxhcnkgZG9lcyBub3QgY3VycmVudGx5IGRpc3Rpbmd1aXNoXG4gKiBjb250ZW50LWVxdWl2YWxlbnQgYENIQU5HRURgIChlLmcuIHdoaXRlc3BhY2Utb25seSBkcmlmdCBgLS1maXhgIGNhbiBoZWFsKVxuICogZnJvbSBnZW51aW5lbHkgc2VtYW50aWMgYENIQU5HRURgIFx1MjAxNCB0aGF0IGNsYXNzaWZpY2F0aW9uIGlzIG5vdCBwcmVzZW50IGluXG4gKiBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBvdXRwdXQgdG9kYXkuIFVudGlsIHRoZSBDTEkgZXhwb3NlcyBpdCxcbiAqIGV2ZXJ5IGBDSEFOR0VEYCByb3cgaXMgdHJlYXRlZCBhcyBkZWJ0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNEZWJ0KHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnRlJFU0gnOlxuICAgIGNhc2UgJ01PVkVEJzpcbiAgICBjYXNlICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCc6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogTG93ZXJjYXNlIGh1bWFuIGxhYmVsIGZvciBhIHBvcmNlbGFpbiBzdGF0dXMgdG9rZW4gKGBMRlNfTk9UX0ZFVENIRURgIFx1MjE5MlxuICogYGxmcyBub3QgZmV0Y2hlZGApLiBUaGUgc2luZ2xlIGxhYmVsIG1hcHBpbmcgZm9yIGV2ZXJ5IGh1bWFuLWZvcm1hdCBhbmNob3JcbiAqIHN1ZmZpeCBcdTIwMTQgYm90aCB0aGUgdG91Y2ggaG9vaydzIGJsb2NrIGFuZCB0aGUgYWR2aXNvcidzIG1lc3NhZ2VzIHJlbmRlciB0aHJvdWdoXG4gKiB0aGlzLCBzbyBhIHN0YXR1cyBuZXZlciByZWFkcyBkaWZmZXJlbnRseSBiZXR3ZWVuIHRoZSB0d28uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBodW1hblN0YXR1c0xhYmVsKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN0YXR1cy50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJyAnKTtcbn1cblxuLyoqXG4gKiBUaGUgdGVybWluYWwvZW52aXJvbm1lbnRhbCBzdGF0dXNlczogdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0XG4gKiBhbGwsIHNvIHRoZSByb3cgaXMgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uIFRoZXNlIGFyZVxuICogYENPTkZMSUNUYCAodW5yZXNvbHZlZCBtZXJnZSksIGBTVUJNT0RVTEVgIChhbmNob3IgaW5zaWRlIGEgc3VibW9kdWxlKSxcbiAqIGBMRlNfTk9UX0ZFVENIRURgL2BMRlNfTk9UX0lOU1RBTExFRGAgKEdpdCBMRlMgY29udGVudCB1bmF2YWlsYWJsZSksXG4gKiBgUFJPTUlTT1JfTUlTU0lOR2AgKHBhcnRpYWwtY2xvbmUgb2JqZWN0IG5vdCBmZXRjaGVkKSwgYFNQQVJTRV9FWENMVURFRGBcbiAqIChwYXRoIG91dHNpZGUgdGhlIHNwYXJzZS1jaGVja291dCBjb25lKSwgYEZJTFRFUl9GQUlMRURgIChhIGNsZWFuL3NtdWRnZVxuICogZmlsdGVyIGVycm9yZWQpLCBhbmQgYElPX0VSUk9SYCAodHJhbnNpZW50IHJlYWQgZmFpbHVyZSkuXG4gKlxuICogVGhlc2UgYXJlIGEgc3RyaWN0IHN1YnNldCBvZiB7QGxpbmsgaXNEZWJ0fTogZXZlcnkgZW52aXJvbm1lbnRhbCBzdGF0dXMgaXNcbiAqIGFsc28gZGVidCAoaXQgYmxvY2tzIG9uIGl0cyBvd24gbWVyaXRzIHdoZW4gc3VyZmFjZWQgaW4gYSBzdGF0dXMgcmVwb3J0KSwgYnV0XG4gKiB0aGUgYWR2aXNvciBtdXN0IHRyZWF0IHRoZW0gZGlmZmVyZW50bHkgZnJvbSAqc2VtYW50aWMqIGRyaWZ0IChgQ0hBTkdFRGAsXG4gKiBgREVMRVRFRGApLiBTZW1hbnRpYyBkcmlmdCBpcyBmaXhhYmxlIGJ5IGVkaXRpbmcgYSBzcGFuLCBzbyB0aGUgYWR2aXNvciBmYWlsc1xuICogY2xvc2VkIG9uIGl0OyBhbiBlbnZpcm9ubWVudGFsIGNvbmRpdGlvbiBpcyBub3Qgc29tZXRoaW5nIGEgc3BhbiBlZGl0IGNhblxuICogcmVzb2x2ZSwgc28gdGhlIGFkdmlzb3IgZmFpbHMgT1BFTiBvbiBpdCAoYWxsb3csIGJ1dCBzdXJmYWNlIHRoZSBjb25kaXRpb24pIFx1MjAxNFxuICogcmUtZGVueWluZyBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gaGVyZSB3b3VsZFxuICogY29udHJhZGljdCB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZSByZXN0IG9mIHRoZSBhZHZpc29yIGFscmVhZHkgaG9ub3JzIGZvclxuICogQ0xJLWFic2VudC90aW1lb3V0L3BhcnNlLWZhaWx1cmUgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRW52aXJvbm1lbnRhbFN0YXR1cyhzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0NPTkZMSUNUJzpcbiAgICBjYXNlICdTVUJNT0RVTEUnOlxuICAgIGNhc2UgJ0xGU19OT1RfRkVUQ0hFRCc6XG4gICAgY2FzZSAnTEZTX05PVF9JTlNUQUxMRUQnOlxuICAgIGNhc2UgJ1BST01JU09SX01JU1NJTkcnOlxuICAgIGNhc2UgJ1NQQVJTRV9FWENMVURFRCc6XG4gICAgY2FzZSAnRklMVEVSX0ZBSUxFRCc6XG4gICAgY2FzZSAnSU9fRVJST1InOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqIFJvd3Mgd2hvc2Ugc3RhdHVzIHRva2VuIGlzIG5vdCBpbiB7QGxpbmsgUE9SQ0VMQUlOX1NUQVRVU0VTfSBhcmUgc2tpcHBlZCBcdTIwMTRcbiAqIGFuIHVucmVjb2duaXplZCB0b2tlbiBmcm9tIGEgbmV3ZXIgQ0xJIGlzIHRyZWF0ZWQgdGhlIHNhbWUgYXMgYSBtYWxmb3JtZWRcbiAqIGxpbmUgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3RhbGVQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBTdGFsZVBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtzdGF0dXNDb2wsICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGF0dXMgPSBwYXJzZVBvcmNlbGFpblN0YXR1cyhzdGF0dXNDb2wpO1xuICAgIGlmICghc3RhdHVzKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCwgc3RhdHVzIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIGJ5IGFsbCBwZXItc2Vzc2lvbiBzdGF0ZTogY3VycmVudGx5IGp1c3QgdGhlIHRvdWNoLWhvb2tcbi8vIHNlc3Npb24gbWVtbyAoc3Bhbi1zdXJmYWNlLnRzJ3MgTWVtb1N0b3JlKS4gRWFjaCBzZXNzaW9uIGdldHMgb25lXG4vLyBzdWJkaXJlY3Rvcnkga2V5ZWQgYnkgaXRzIHNhbml0aXplZCBpZCwgc28gZXZlcnkgd3JpdGVyL3JlYWRlciBmb3IgYSBnaXZlblxuLy8gc2Vzc2lvbiBhZ3JlZXMgb24gaXRzIGxvY2F0aW9uLlxuZXhwb3J0IGNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8qKiBUaGUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHNlc3Npb24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkRpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5jb25zdCBUSElSVFlfREFZU19NUyA9IDMwICogMjQgKiA2MCAqIDYwICogMTAwMDtcblxuLyoqXG4gKiBPcHBvcnR1bmlzdGljYWxseSBwcnVuZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcmllcyB1bmRlclxuICoge0BsaW5rIFNFU1NJT05fQkFTRV9ESVJ9IHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gYG1heEFnZU1zYCAoZGVmYXVsdCAzMFxuICogZGF5cykuIEEgZGlyZWN0b3J5J3MgbXRpbWUgYWR2YW5jZXMgd2hlbmV2ZXIgYW4gZW50cnkgaW5zaWRlIGl0IGlzXG4gKiBjcmVhdGVkL3JlbmFtZWQvcmVtb3ZlZCwgc28gYW4gYWN0aXZlIHNlc3Npb24gKG1lbW8gd3JpdGVzKSBzdGF5cyBmcmVzaDtcbiAqIG9ubHkgZ2VudWluZWx5IGFiYW5kb25lZCBzZXNzaW9ucyBhZ2Ugb3V0LlxuICpcbiAqIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGNhbGxlZCBvcHBvcnR1bmlzdGljYWxseSBmcm9tIGhvb2sgcmVhZC93cml0ZVxuICogcGF0aHMsIG5vdCBhIHNlcGFyYXRlIGNyb24tbGlrZSBtZWNoYW5pc20sIHNvIGEgZmFpbHVyZSBoZXJlIG11c3QgbmV2ZXJcbiAqIGJsb2NrIHRoZSBjYWxsZXIncyBhY3R1YWwgd29yay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBydW5lU3RhbGVTZXNzaW9ucyhub3c6IG51bWJlciA9IERhdGUubm93KCksIG1heEFnZU1zOiBudW1iZXIgPSBUSElSVFlfREFZU19NUyk6IHZvaWQge1xuICBsZXQgZW50cmllczogZnMuRGlyZW50W107XG4gIHRyeSB7XG4gICAgZW50cmllcyA9IGZzLnJlYWRkaXJTeW5jKFNFU1NJT05fQkFTRV9ESVIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuOyAvLyBiYXNlIGRpciBhYnNlbnQgb3IgdW5yZWFkYWJsZSBcdTIwMTQgbm90aGluZyB0byBwcnVuZVxuICB9XG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZGlyUGF0aCA9IG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgZW50cnkubmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhkaXJQYXRoKTtcbiAgICAgIGlmIChub3cgLSBzdGF0Lm10aW1lTXMgPiBtYXhBZ2VNcykge1xuICAgICAgICBmcy5ybVN5bmMoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVmFuaXNoZWQgYmV0d2VlbiByZWFkZGlyIGFuZCBzdGF0LCBvciByZW1vdmFsIGZhaWxlZCBcdTIwMTQgc2tpcCBpdC4gQVxuICAgICAgLy8gYmVzdC1lZmZvcnQgcHJ1bmUgbXVzdCBuZXZlciB0aHJvdyBpbnRvIHRoZSBjYWxsZXIncyBob3QgcGF0aC5cbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgdGhlIGFkdmlzb3IncyBwZXItY2hhbmdlc2V0IHN0YXRlIG1lbW9zIChkaWdlc3Qgb2Ygc29ydGVkXG4gKiBmaW5kaW5ncyArIHVuY292ZXJlZCBwYXRocyksIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpciBzbyBpdCBpcyBzaGFyZWRcbiAqIGFjcm9zcyB3b3JrdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZpc29yTWVtb0RpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ2Fkdmlzb3InKTtcbn1cbiIsICIvKipcbiAqIFN0YXRpYyBjbGFzc2lmaWNhdGlvbiBvZiBhIEJhc2ggdG9vbCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGVcbiAqIHBhdGgocykgKyBsaW5lIHJhbmdlKHMpIGl0IHJlYWRzIG9yIHdyaXRlcywgd2hlcmUgdGhhdCdzIHN0YXRpY2FsbHlcbiAqIGRldGVybWluYWJsZS4gQnVpbHQgZnJvbSBhbiBlbXBpcmljYWwgcGFzcyBvdmVyIH4zMWsgcmVhbCBDbGF1ZGUgQ29kZVxuICogQmFzaCBpbnZvY2F0aW9ucyAoc2VlIGFuYWx5emUtdHJhbnNjcmlwdHMubXRzKSBcdTIwMTQgdGhlIGlkaW9tcyBiZWxvdyBhcmVcbiAqIGV4YWN0bHkgdGhlIG9uZXMgdGhhdCB0dXJuZWQgb3V0IHRvIGJlIGNvbW1vbiBBTkQgcmVsaWFibGUgdGhlcmUuXG4gKlxuICogRGVsaWJlcmF0ZWx5IE5PVCBjb3ZlcmVkIChzZWUgdGhlIHJlc2VhcmNoIHJlcG9ydCk6IGF3ayBOUi10cmlja3MgKHJhcmUsXG4gKiB1bmNvbnN0cmFpbmVkIHN5bnRheCksIGdyZXAgLW4vLUEvLUIvLUMgKHRoZSB3aW5kb3cgaXMgYW5jaG9yZWQgdG8gbWF0Y2hcbiAqIHBvc2l0aW9uLCB3aGljaCBpcyBkYXRhLWRlcGVuZGVudCwgbm90IGluIHRoZSBjb21tYW5kIHRleHQpLCBlbWJlZGRlZFxuICogcHl0aG9uMy9ub2RlIGhlcmVkb2Mgc2NyaXB0cyAoYSBkaWZmZXJlbnQgbGFuZ3VhZ2UncyBBU1QsIG5vdCBhIHNoZWxsXG4gKiBjb25jZXJuKSwgc2VkIC1pIChubyBsaW5lLWFkZHJlc3NlZCB1c2FnZSBvYnNlcnZlZCBcdTIwMTQgYWxsIHBhdHRlcm4tb25seVxuICogc3Vic3RpdHV0aW9ucyB3aXRoIG5vIHN0YXRpYyByYW5nZSksIHBsYWluIGBlY2hvYC9gcHJpbnRmYCByZWRpcmVjdHMgKHJhcmVcbiAqIGFuZCBzZW1hbnRpY2FsbHkgYW1iaWd1b3VzIGluIHRoZSBjb3JwdXMpLlxuICovXG5pbXBvcnQgeyByZXNvbHZlIGFzIHJlc29sdmVQYXRoIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvdW50RmlsZUxpbmVzLCBjb3VudEdpdEJsb2JMaW5lcyB9IGZyb20gJy4vY29tbWFuZC1yZXNvbHZlLmpzJztcbmltcG9ydCB7IGFyZ3ZPZiwgc3BsaXRUb3BMZXZlbCB9IGZyb20gJy4vc2hlbGwtc3BsaXQuanMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVkU3BhbiB7XG4gIGxpbmVTdGFydDogbnVtYmVyO1xuICBsaW5lRW5kOiBudW1iZXI7XG4gIGFic29sdXRlUGF0aDogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBJZGlvbSA9XG4gIHwgJ3NlZC1uLXJhbmdlJ1xuICB8ICdoZWFkLWZpbGUnXG4gIHwgJ3RhaWwtZmlsZSdcbiAgfCAnY2F0LWZpbGUnXG4gIHwgJ25sLWZpbGUnXG4gIHwgJ2dpdC1zaG93LXJldi1wYXRoJ1xuICB8ICdnaXQtbG9nLUwnXG4gIHwgJ2hlcmVkb2Mtd3JpdGUnO1xuXG5leHBvcnQgdHlwZSBTcGFuTWF0Y2ggPVxuICB8IHsgc3RhdHVzOiAncmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IHNwYW46IFJlc29sdmVkU3Bhbjsgbm90ZT86IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bnJlc29sdmVkJzsgaWRpb206IElkaW9tOyBmaWxlQXJnOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZS1yYW5nZSBzcGVjczogd2hhdCBhIG1hdGNoZWQgaWRpb20gc2F5cyBhYm91dCB0aGUgcmFuZ2UsIGJlZm9yZSB3ZSBrbm93XG4vLyB3aGV0aGVyIHJlc29sdmluZyBpdCBuZWVkcyB0byBjb25zdWx0IGEgcmVhbCBmaWxlL2dpdCBibG9iLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgTGluZVJhbmdlU3BlYyA9XG4gIHwgeyBraW5kOiAnbGl0ZXJhbCc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JzsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3RvRW9mJzsgc3RhcnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnbGFzdE5MaW5lcyc7IGNvdW50OiBudW1iZXIgfVxuICB8IHsga2luZDogJ2FwcGVuZExpbmVzJzsgY291bnQ6IG51bWJlciB9O1xuXG5mdW5jdGlvbiByZXNvbHZlU3BlYyhcbiAgc3BlYzogTGluZVJhbmdlU3BlYyxcbiAgdG90YWxMaW5lczogKCkgPT4gbnVtYmVyIHwgbnVsbFxuKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgc3dpdGNoIChzcGVjLmtpbmQpIHtcbiAgICBjYXNlICdsaXRlcmFsJzpcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogc3BlYy5zdGFydCwgbGluZUVuZDogc3BlYy5lbmQgfTtcbiAgICBjYXNlICd1cHBlckJvdW5kRnJvbVN0YXJ0Jzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IHRvdGFsICE9PSBudWxsID8gTWF0aC5taW4oc3BlYy5lbmQsIHRvdGFsKSA6IHNwZWMuZW5kIH07XG4gICAgfVxuICAgIGNhc2UgJ3RvRW9mJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBNYXRoLm1heChzcGVjLnN0YXJ0LCB0b3RhbCkgfTtcbiAgICB9XG4gICAgY2FzZSAnbGFzdE5MaW5lcyc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsIHx8IHRvdGFsID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogTWF0aC5tYXgoMSwgdG90YWwgLSBzcGVjLmNvdW50ICsgMSksIGxpbmVFbmQ6IHRvdGFsIH07XG4gICAgfVxuICAgIGNhc2UgJ2FwcGVuZExpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCkgPz8gMDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogdG90YWwgKyAxLCBsaW5lRW5kOiB0b3RhbCArIHNwZWMuY291bnQgfTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gaGFzU2hlbGxFeHBhbnNpb24oczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvWyRgXS8udGVzdChzKTtcbn1cblxuZnVuY3Rpb24gbG9va3NVbnJlc29sdmFibGUoczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBoYXNTaGVsbEV4cGFuc2lvbihzKSB8fCAvWyo/XS8udGVzdChzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJZGlvbSBtYXRjaGVyczogcHVyZSBmdW5jdGlvbnMgb3ZlciBvbmUgc2ltcGxlIGNvbW1hbmQncyBhcmd2LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBSYXdDYW5kaWRhdGUge1xuICBraW5kOiAnY2FuZGlkYXRlJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHNwZWM6IExpbmVSYW5nZVNwZWM7XG4gIHJlc29sdmVyS2luZDogJ2ZzJyB8IHsga2luZDogJ2dpdCc7IHJldjogc3RyaW5nIH07XG4gIGRpck92ZXJyaWRlPzogc3RyaW5nO1xufVxuaW50ZXJmYWNlIFJhd1VucmVzb2x2ZWQge1xuICBraW5kOiAndW5yZXNvbHZlZCc7XG4gIGlkaW9tOiBJZGlvbTtcbiAgZmlsZUFyZzogc3RyaW5nO1xuICByZWFzb246IHN0cmluZztcbn1cbnR5cGUgTWF0Y2hSZXN1bHQgPSBSYXdDYW5kaWRhdGUgfCBSYXdVbnJlc29sdmVkO1xuXG5jb25zdCBTRURfUkFOR0UgPSAvXihcXGQrKSg/OiwoXFxkK3xcXCQpKT9wJC87XG5cbi8qKiBTcGxpdCBhIGBzZWRgIHNjcmlwdCBhcmd1bWVudCBpbnRvIGl0cyBgO2Atc2VwYXJhdGVkIHNlZ21lbnRzLiAqL1xuZnVuY3Rpb24gc2VkU2NyaXB0U2VnbWVudHMoc2NyaXB0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBzY3JpcHQuc3BsaXQoJzsnKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hTZWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdzZWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAoIXJlc3QuaW5jbHVkZXMoJy1uJykpIHJldHVybiBbXTtcbiAgbGV0IHNjcmlwdElkeCA9IC0xO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAocmVzdFtpXSA9PT0gJy1uJykgY29udGludWU7XG4gICAgaWYgKHNlZFNjcmlwdFNlZ21lbnRzKHJlc3RbaV0pLnNvbWUoKHNlZykgPT4gU0VEX1JBTkdFLnRlc3Qoc2VnKSkpIHtcbiAgICAgIHNjcmlwdElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKHNjcmlwdElkeCA9PT0gLTEpIHJldHVybiBbXTtcbiAgY29uc3QgZmlsZUNhbmRpZGF0ZXMgPSByZXN0LmZpbHRlcigoYSwgaSkgPT4gaSAhPT0gc2NyaXB0SWR4ICYmIGEgIT09ICctbicgJiYgIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgaWYgKGZpbGVDYW5kaWRhdGVzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQXJnID0gZmlsZUNhbmRpZGF0ZXNbMF07XG4gIGNvbnN0IHJlc3VsdHM6IE1hdGNoUmVzdWx0W10gPSBbXTtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZFNjcmlwdFNlZ21lbnRzKHJlc3Rbc2NyaXB0SWR4XSkpIHtcbiAgICBjb25zdCBtYXRjaCA9IHNlZ21lbnQubWF0Y2goU0VEX1JBTkdFKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtYXRjaFsxXSwgMTApO1xuICAgIGNvbnN0IGVuZFRva2VuID0gbWF0Y2hbMl07XG4gICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9XG4gICAgICBlbmRUb2tlbiA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IHN0YXJ0IH1cbiAgICAgICAgOiBlbmRUb2tlbiA9PT0gJyQnXG4gICAgICAgICAgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0IH1cbiAgICAgICAgICA6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydCwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZW5kVG9rZW4sIDEwKSB9O1xuICAgIHJlc3VsdHMucHVzaCh7IGtpbmQ6ICdjYW5kaWRhdGUnLCBpZGlvbTogJ3NlZC1uLXJhbmdlJywgZmlsZUFyZywgc3BlYywgcmVzb2x2ZXJLaW5kOiAnZnMnIH0pO1xuICB9XG4gIHJldHVybiByZXN1bHRzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUhlYWRUYWlsRmxhZ3MocmVzdDogc3RyaW5nW10pOiB7XG4gIGNvdW50OiBudW1iZXIgfCBudWxsO1xuICBmcm9tU3RhcnQ6IGJvb2xlYW47XG4gIGRpc3F1YWxpZmllZDogYm9vbGVhbjtcbiAgZmlsZXM6IHN0cmluZ1tdO1xufSB7XG4gIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY291bnQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBsZXQgZnJvbVN0YXJ0ID0gZmFsc2U7XG4gIGxldCBkaXNxdWFsaWZpZWQgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctZicgfHwgYSA9PT0gJy1GJyB8fCBhID09PSAnLS1mb2xsb3cnIHx8IGEuc3RhcnRzV2l0aCgnLS1mb2xsb3c9JykpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICcteicgfHwgYSA9PT0gJy0temVyby10ZXJtaW5hdGVkJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJyB8fCBhID09PSAnLS1ieXRlcycpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eKC1jfC0tYnl0ZXM9KS8udGVzdChhKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1xJyB8fCBhID09PSAnLXYnIHx8IGEgPT09ICctLXF1aWV0JyB8fCBhID09PSAnLS1zaWxlbnQnIHx8IGEgPT09ICctLXZlcmJvc2UnKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLWxpbmVzPScpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgnLS1saW5lcz0nLmxlbmd0aCk7XG4gICAgICBpZiAoL15cXCs/XFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1uXFwrP1xcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgyKTtcbiAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eXFwrXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGZyb21TdGFydCA9IHRydWU7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLVxcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctJykge1xuICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgIGZpbGVzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaEhlYWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdoZWFkJykgcmV0dXJuIFtdO1xuICBjb25zdCB7IGNvdW50LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAnaGVhZC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWM6IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnLCBlbmQ6IG4gfSBhcyBMaW5lUmFuZ2VTcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoVGFpbChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3RhaWwnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoZGlzcXVhbGlmaWVkKSByZXR1cm4gW107XG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID0gZnJvbVN0YXJ0ID8geyBraW5kOiAndG9Fb2YnLCBzdGFydDogbiB9IDogeyBraW5kOiAnbGFzdE5MaW5lcycsIGNvdW50OiBuIH07XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAndGFpbC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gZmluZEdpdFN1YmNvbW1hbmQoXG4gIHJlc3Q6IHN0cmluZ1tdXG4pOiB7IHN1YklkeDogbnVtYmVyOyBzdWJjb21tYW5kOiBzdHJpbmc7IGNEaXI6IHN0cmluZyB8IG51bGw7IGNEaXJVbnJlc29sdmFibGU6IGJvb2xlYW4gfSB8IG51bGwge1xuICBsZXQgY0Rpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBjRGlyVW5yZXNvbHZhYmxlID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCByZXN0Lmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSByZXN0W2ldO1xuICAgIGlmIChhID09PSAnLUMnKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGlmIChoYXNTaGVsbEV4cGFuc2lvbih2KSkgY0RpclVucmVzb2x2YWJsZSA9IHRydWU7XG4gICAgICBlbHNlIGNEaXIgPSB2O1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSB7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcmV0dXJuIHsgc3ViSWR4OiBpLCBzdWJjb21tYW5kOiBhLCBjRGlyLCBjRGlyVW5yZXNvbHZhYmxlIH07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmNvbnN0IFJFVl9QQVRIID0gL14oW15cXHM6XSspOiguKykkLztcblxuZnVuY3Rpb24gbWF0Y2hHaXRTaG93KGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdzaG93JykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3ZcbiAgICAuc2xpY2UoMSlcbiAgICAuc2xpY2Uoc3ViLnN1YklkeCArIDEpXG4gICAgLmZpbHRlcigoYSkgPT4gIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgY29uc3QgcmV2UGF0aEFyZyA9IGFmdGVyLmZpbmQoKGEpID0+IFJFVl9QQVRILnRlc3QoYSkpO1xuICBpZiAoIXJldlBhdGhBcmcpIHJldHVybiBbXTtcbiAgY29uc3QgbSA9IHJldlBhdGhBcmcubWF0Y2goUkVWX1BBVEgpO1xuICBpZiAoIW0pIHJldHVybiBbXTtcbiAgY29uc3QgWywgcmV2LCBwYXRoXSA9IG07XG4gIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSB8fCBoYXNTaGVsbEV4cGFuc2lvbihyZXYpKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBvciByZXZpc2lvbiBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtcbiAgICB7XG4gICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgIHNwZWM6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSxcbiAgICAgIHJlc29sdmVyS2luZDogeyBraW5kOiAnZ2l0JywgcmV2IH0sXG4gICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgfVxuICBdO1xufVxuXG5mdW5jdGlvbiBtYXRjaEdpdExvZ0woYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2xvZycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhZnRlci5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhZnRlcltpXTtcbiAgICBsZXQgc3BlYzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGEgPT09ICctTCcpIHNwZWMgPSBhZnRlcltpICsgMV0gPz8gbnVsbDtcbiAgICBlbHNlIGlmIChhLnN0YXJ0c1dpdGgoJy1MJykpIHNwZWMgPSBhLnNsaWNlKDIpO1xuICAgIGlmICghc3BlYykgY29udGludWU7XG4gICAgY29uc3QgbSA9IHNwZWMubWF0Y2goL14oXFxkKyksKFxcZCspOiguKykkLyk7XG4gICAgaWYgKCFtKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBzLCBlLCBwYXRoXSA9IG07XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICB7XG4gICAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgICAgfVxuICAgICAgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgc3BlYzogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0OiBOdW1iZXIucGFyc2VJbnQocywgMTApLCBlbmQ6IE51bWJlci5wYXJzZUludChlLCAxMCkgfSxcbiAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnLFxuICAgICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW107XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVyZWRvYyB3cml0ZXMgKGBjYXQgPiBmaWxlIDw8RU9GIC4uLiBFT0ZgKTogaGFuZGxlZCBhcyBhIGRlZGljYXRlZCByYXctdGV4dFxuLy8gcGFzcyBiZWNhdXNlIHRoZSBib2R5IGNhbiBpdHNlbGYgY29udGFpbiAmJi87L3wvbmV3bGluZXMgdGhhdCB3b3VsZFxuLy8gb3RoZXJ3aXNlIGNvbmZ1c2Ugc3BsaXRUb3BMZXZlbC4gTWF0Y2hlZCBzcGFucyBhcmUgbWFza2VkIG91dCBvZiB0aGUgc3RyaW5nXG4vLyAocmVwbGFjZWQgd2l0aCBhbiBpbmRleGVkIHBsYWNlaG9sZGVyIHNpbXBsZS1jb21tYW5kKSBiZWZvcmUgdGhlIHJlc3Qgb2Zcbi8vIHRoZSBwaXBlbGluZSBydW5zLCBhbmQgcmUtYXNzb2NpYXRlZCBieSBpbmRleCBkdXJpbmcgdGhlIG1haW4gd2FsayBzbyB0aGVcbi8vIHdyaXRlIGlzIHJlc29sdmVkIGFnYWluc3QgdGhlIGNvcnJlY3QgYGNkYC10cmFja2VkIGRpcmVjdG9yeS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgSGVyZWRvY1dyaXRlIHtcbiAgcmVkaXJlY3Q6ICc+JyB8ICc+Pic7XG4gIHRhcmdldDogc3RyaW5nO1xuICBib2R5OiBzdHJpbmc7XG59XG5cbmNvbnN0IEhFUkVET0NfT1BFTiA9XG4gIC9cXGJjYXRbIFxcdF0rKD57MSwyfSlbIFxcdF0qKFxcUyspWyBcXHRdKjw8KC0/KVsgXFx0XSooPzonKFteJ10qKSd8XCIoW15cIl0qKVwifChbQS1aYS16X11bQS1aYS16MC05X10qKSlbIFxcdF0qXFxyP1xcbi9nO1xuXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHMucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdEhlcmVkb2NXcml0ZXMocmF3OiBzdHJpbmcpOiB7IHdyaXRlczogSGVyZWRvY1dyaXRlW107IG1hc2tlZDogc3RyaW5nIH0ge1xuICBjb25zdCB3cml0ZXM6IEhlcmVkb2NXcml0ZVtdID0gW107XG4gIGxldCBtYXNrZWQgPSAnJztcbiAgbGV0IGN1cnNvciA9IDA7XG4gIEhFUkVET0NfT1BFTi5sYXN0SW5kZXggPSAwO1xuICBsZXQgb3Blbk1hdGNoOiBSZWdFeHBFeGVjQXJyYXkgfCBudWxsID0gSEVSRURPQ19PUEVOLmV4ZWMocmF3KTtcbiAgd2hpbGUgKG9wZW5NYXRjaCAhPT0gbnVsbCkge1xuICAgIGNvbnN0IFssIHJlZGlyZWN0LCB0YXJnZXQsIGRhc2gsIGRxMSwgZHEyLCBiYXJlXSA9IG9wZW5NYXRjaDtcbiAgICBjb25zdCBkZWxpbSA9IGRxMSA/PyBkcTIgPz8gYmFyZTtcbiAgICBjb25zdCBib2R5U3RhcnQgPSBvcGVuTWF0Y2guaW5kZXggKyBvcGVuTWF0Y2hbMF0ubGVuZ3RoO1xuICAgIGlmICghZGVsaW0gfHwgYm9keVN0YXJ0IDwgY3Vyc29yKSB7XG4gICAgICBIRVJFRE9DX09QRU4ubGFzdEluZGV4ID0gb3Blbk1hdGNoLmluZGV4ICsgMTtcbiAgICAgIG9wZW5NYXRjaCA9IEhFUkVET0NfT1BFTi5leGVjKHJhdyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgY2xvc2VSZSA9IG5ldyBSZWdFeHAoYF4ke2Rhc2ggPyAnXFxcXHQqJyA6ICcnfSR7ZXNjYXBlUmVnRXhwKGRlbGltKX1bIFxcXFx0XSokYCwgJ20nKTtcbiAgICBjb25zdCByZW1haW5kZXIgPSByYXcuc2xpY2UoYm9keVN0YXJ0KTtcbiAgICBjb25zdCBjbG9zZU1hdGNoID0gY2xvc2VSZS5leGVjKHJlbWFpbmRlcik7XG4gICAgaWYgKCFjbG9zZU1hdGNoKSB7XG4gICAgICBIRVJFRE9DX09QRU4ubGFzdEluZGV4ID0gYm9keVN0YXJ0O1xuICAgICAgb3Blbk1hdGNoID0gSEVSRURPQ19PUEVOLmV4ZWMocmF3KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBib2R5ID0gcmVtYWluZGVyLnNsaWNlKDAsIGNsb3NlTWF0Y2guaW5kZXgpLnJlcGxhY2UoL1xcbiQvLCAnJyk7XG4gICAgY29uc3QgbWF0Y2hFbmQgPSBib2R5U3RhcnQgKyBjbG9zZU1hdGNoLmluZGV4ICsgY2xvc2VNYXRjaFswXS5sZW5ndGg7XG5cbiAgICBtYXNrZWQgKz0gcmF3LnNsaWNlKGN1cnNvciwgb3Blbk1hdGNoLmluZGV4KTtcbiAgICBtYXNrZWQgKz0gYF9faGVyZWRvY18ke3dyaXRlcy5sZW5ndGh9X19gO1xuICAgIGN1cnNvciA9IG1hdGNoRW5kO1xuICAgIHdyaXRlcy5wdXNoKHsgcmVkaXJlY3Q6IHJlZGlyZWN0IGFzICc+JyB8ICc+PicsIHRhcmdldCwgYm9keSB9KTtcblxuICAgIEhFUkVET0NfT1BFTi5sYXN0SW5kZXggPSBtYXRjaEVuZDtcbiAgICBvcGVuTWF0Y2ggPSBIRVJFRE9DX09QRU4uZXhlYyhyYXcpO1xuICB9XG4gIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yKTtcbiAgcmV0dXJuIHsgd3JpdGVzLCBtYXNrZWQgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcmNoZXN0cmF0b3Jcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBMSU5FX1NFTEVDVE9SUyA9IFttYXRjaFNlZCwgbWF0Y2hIZWFkLCBtYXRjaFRhaWxdO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZDogc3RyaW5nLCBjd2Q6IHN0cmluZyA9IHByb2Nlc3MuY3dkKCkpOiBTcGFuTWF0Y2hbXSB7XG4gIGNvbnN0IHsgd3JpdGVzOiBoZXJlZG9jV3JpdGVzLCBtYXNrZWQgfSA9IGV4dHJhY3RIZXJlZG9jV3JpdGVzKGNvbW1hbmQpO1xuICBjb25zdCBzaW1wbGVDb21tYW5kcyA9IHNwbGl0VG9wTGV2ZWwobWFza2VkKTtcblxuICBjb25zdCByZXN1bHRzOiBTcGFuTWF0Y2hbXSA9IFtdO1xuICBjb25zdCBmc0xpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuICBjb25zdCBnaXRMaW5lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyIHwgbnVsbD4oKTtcblxuICBjb25zdCBjYWNoZWRGc1RvdGFsTGluZXMgPSAoYWJzUGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgaWYgKCFmc0xpbmVDYWNoZS5oYXMoYWJzUGF0aCkpIGZzTGluZUNhY2hlLnNldChhYnNQYXRoLCBjb3VudEZpbGVMaW5lcyhhYnNQYXRoKSk7XG4gICAgcmV0dXJuIGZzTGluZUNhY2hlLmdldChhYnNQYXRoKSA/PyBudWxsO1xuICB9O1xuICBjb25zdCBjYWNoZWRHaXRUb3RhbExpbmVzID0gKGdpdEN3ZDogc3RyaW5nLCByZXY6IHN0cmluZywgcGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gYCR7Z2l0Q3dkfVx1MDAwMCR7cmV2fVx1MDAwMCR7cGF0aH1gO1xuICAgIGlmICghZ2l0TGluZUNhY2hlLmhhcyhrZXkpKSBnaXRMaW5lQ2FjaGUuc2V0KGtleSwgY291bnRHaXRCbG9iTGluZXMoZ2l0Q3dkLCByZXYsIHBhdGgpKTtcbiAgICByZXR1cm4gZ2l0TGluZUNhY2hlLmdldChrZXkpID8/IG51bGw7XG4gIH07XG5cbiAgbGV0IGN1cnJlbnREaXIgPSBjd2Q7XG4gIGxldCBsYXN0UGxhaW5GaWxlU291cmNlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICBjb25zdCBlbWl0Q2FuZGlkYXRlID0gKGM6IFJhd0NhbmRpZGF0ZSwgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nKSA9PiB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGMuZmlsZUFyZykpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYy5maWxlQXJnLFxuICAgICAgICByZWFzb246ICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYidcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChkaXJGb3JSZXNvbHV0aW9uLCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHRvdGFsTGluZXMgPVxuICAgICAgYy5yZXNvbHZlcktpbmQgPT09ICdmcydcbiAgICAgICAgPyBjYWNoZWRGc1RvdGFsTGluZXMoYWJzb2x1dGVQYXRoKVxuICAgICAgICA6IGNhY2hlZEdpdFRvdGFsTGluZXMoYy5kaXJPdmVycmlkZSA/PyBkaXJGb3JSZXNvbHV0aW9uLCBjLnJlc29sdmVyS2luZC5yZXYsIGMuZmlsZUFyZyk7XG4gICAgY29uc3QgcmFuZ2UgPSByZXNvbHZlU3BlYyhjLnNwZWMsIHRvdGFsTGluZXMpO1xuICAgIGlmIChyYW5nZSA9PT0gbnVsbCkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHJlYXNvbjogJ2NvdWxkIG5vdCBkZXRlcm1pbmUgZW5kLW9mLWZpbGUgbGluZSBjb3VudCAoZmlsZSB1bnJlYWRhYmxlLCBlbXB0eSwgb3IgZ2l0IHJldi9wYXRoIG5vdCBmb3VuZCknXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgc3BhbjogeyBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCwgbGluZUVuZDogcmFuZ2UubGluZUVuZCwgYWJzb2x1dGVQYXRoIH1cbiAgICB9KTtcbiAgfTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IHNpbXBsZUNvbW1hbmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3Qgc2ltcGxlID0gc2ltcGxlQ29tbWFuZHNbaV07XG4gICAgY29uc3QgaGVyZWRvY1JlZiA9IHNpbXBsZS50ZXh0Lm1hdGNoKC9eX19oZXJlZG9jXyhcXGQrKV9fJC8pO1xuICAgIGlmIChoZXJlZG9jUmVmKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnN0IHcgPSBoZXJlZG9jV3JpdGVzW051bWJlci5wYXJzZUludChoZXJlZG9jUmVmWzFdLCAxMCldO1xuICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHcudGFyZ2V0KSkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgZmlsZUFyZzogdy50YXJnZXQsXG4gICAgICAgICAgcmVhc29uOiAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InXG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIHcudGFyZ2V0KTtcbiAgICAgIGNvbnN0IGJvZHlMaW5lcyA9IHcuYm9keS5sZW5ndGggPT09IDAgPyAwIDogdy5ib2R5LnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gICAgICBpZiAoYm9keUxpbmVzID09PSAwKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPVxuICAgICAgICB3LnJlZGlyZWN0ID09PSAnPicgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IDEsIGVuZDogYm9keUxpbmVzIH0gOiB7IGtpbmQ6ICdhcHBlbmRMaW5lcycsIGNvdW50OiBib2R5TGluZXMgfTtcbiAgICAgIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoc3BlYywgY2FjaGVkRnNUb3RhbExpbmVzKGFic29sdXRlUGF0aCkpO1xuICAgICAgaWYgKHJhbmdlID09PSBudWxsKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBmaWxlQXJnOiBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgcmVhc29uOiAnYXBwZW5kIHRhcmdldDogY291bGQgbm90IHJlYWQgZXhpc3RpbmcgZmlsZSB0byBmaW5kIGl0cyBjdXJyZW50IGxlbmd0aCdcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46IHsgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsIGFic29sdXRlUGF0aCB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgYXJndiA9IGFyZ3ZPZihzaW1wbGUudGV4dCk7XG4gICAgaWYgKCFhcmd2IHx8IGFyZ3YubGVuZ3RoID09PSAwKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChhcmd2WzBdID09PSAnY2QnKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnN0IHRhcmdldCA9IGFyZ3ZbMV07XG4gICAgICBpZiAodGFyZ2V0ICE9PSB1bmRlZmluZWQgJiYgdGFyZ2V0ICE9PSAnLScgJiYgIWhhc1NoZWxsRXhwYW5zaW9uKHRhcmdldCkpIHtcbiAgICAgICAgY3VycmVudERpciA9IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIHRhcmdldCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBsZXQgaXNQbGFpblNvdXJjZSA9IGZhbHNlO1xuICAgIGxldCBwbGFpbkZpbGVBcmc6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIGlmIChhcmd2WzBdID09PSAnY2F0JyAmJiBhcmd2Lmxlbmd0aCA9PT0gMiAmJiAhYXJndlsxXS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGlzUGxhaW5Tb3VyY2UgPSB0cnVlO1xuICAgICAgcGxhaW5GaWxlQXJnID0gYXJndlsxXTtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBoYXNTaGVsbEV4cGFuc2lvbihhcmd2WzFdKSA/IG51bGwgOiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCBhcmd2WzFdKTtcbiAgICB9IGVsc2UgaWYgKGFyZ3ZbMF0gPT09ICdubCcgJiYgYXJndi5sZW5ndGggPj0gMiAmJiAhYXJndlthcmd2Lmxlbmd0aCAtIDFdLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICBjb25zdCBmID0gYXJndlthcmd2Lmxlbmd0aCAtIDFdO1xuICAgICAgcGxhaW5GaWxlQXJnID0gZjtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBoYXNTaGVsbEV4cGFuc2lvbihmKSA/IG51bGwgOiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCBmKTtcbiAgICB9XG5cbiAgICAvLyBBIGJhcmUgYGNhdCBmaWxlYC9gbmwgZmlsZWAgdGhhdCBpcyBub3QgZmVlZGluZyBhIGRvd25zdHJlYW0gcGlwZSBzdGFnZVxuICAgIC8vIHJlYWRzIHRoZSB3aG9sZSBmaWxlOiBlbWl0IHRoZSBzYW1lIHdob2xlLWZpbGUgc3BhbiBgZ2l0IHNob3cgcmV2OnBhdGhgXG4gICAgLy8gcHJvZHVjZXMuIFdoZW4gYSBwaXBlIGZvbGxvd3MsIHRoZSBkb3duc3RyZWFtIGxpbmUtc2VsZWN0b3IgYWxyZWFkeVxuICAgIC8vIGVtaXRzIHRoZSBwcmVjaXNlIHJhbmdlLCBzbyB0aGUgc291cmNlIHN0YXlzIHNvdXJjZS1vbmx5LlxuICAgIGlmIChwbGFpbkZpbGVBcmcgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IG5leHQgPSBzaW1wbGVDb21tYW5kc1tpICsgMV07XG4gICAgICBpZiAobmV4dCA9PT0gdW5kZWZpbmVkIHx8IG5leHQucHJlY2VkZWRCeSAhPT0gJ3wnKSB7XG4gICAgICAgIGVtaXRDYW5kaWRhdGUoXG4gICAgICAgICAge1xuICAgICAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgICAgICBpZGlvbTogYXJndlswXSA9PT0gJ2NhdCcgPyAnY2F0LWZpbGUnIDogJ25sLWZpbGUnLFxuICAgICAgICAgICAgZmlsZUFyZzogcGxhaW5GaWxlQXJnLFxuICAgICAgICAgICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgICAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBjdXJyZW50RGlyXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgWy4uLkxJTkVfU0VMRUNUT1JTLCBtYXRjaEdpdFNob3csIG1hdGNoR2l0TG9nTF0pIHtcbiAgICAgIGZvciAoY29uc3Qgb3V0Y29tZSBvZiBtYXRjaGVyKGFyZ3YpKSB7XG4gICAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgICAgICBpZiAob3V0Y29tZS5raW5kID09PSAndW5yZXNvbHZlZCcpIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgICBpZGlvbTogb3V0Y29tZS5pZGlvbSxcbiAgICAgICAgICAgIGZpbGVBcmc6IG91dGNvbWUuZmlsZUFyZyxcbiAgICAgICAgICAgIHJlYXNvbjogb3V0Y29tZS5yZWFzb25cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlbWl0Q2FuZGlkYXRlKG91dGNvbWUsIG91dGNvbWUuZGlyT3ZlcnJpZGUgPz8gY3VycmVudERpcik7XG4gICAgICAgICAgLy8gYGdpdCBzaG93IHJldjpwYXRoYCBwcmludHMgdGhlIGJsb2IgdmVyYmF0aW0sIHNvICh1bmxpa2UgYGdpdCBsb2cgLUxgLFxuICAgICAgICAgIC8vIHdoaWNoIHByaW50cyBkaWZmLWZvcm1hdHRlZCBoaXN0b3J5KSBpdCdzIGEgdmFsaWQgb25lLWhvcCBwaXBlIHNvdXJjZVxuICAgICAgICAgIC8vIGZvciBhIGRvd25zdHJlYW0gbGluZS1zZWxlY3Rvciwgc2FtZSBhcyBgY2F0YC9gbmxgLlxuICAgICAgICAgIGlmIChvdXRjb21lLmlkaW9tID09PSAnZ2l0LXNob3ctcmV2LXBhdGgnICYmICFsb29rc1VucmVzb2x2YWJsZShvdXRjb21lLmZpbGVBcmcpKSB7XG4gICAgICAgICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgICAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSByZXNvbHZlUGF0aChvdXRjb21lLmRpck92ZXJyaWRlID8/IGN1cnJlbnREaXIsIG91dGNvbWUuZmlsZUFyZyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFtYXRjaGVkICYmIHNpbXBsZS5wcmVjZWRlZEJ5ID09PSAnfCcgJiYgbGFzdFBsYWluRmlsZVNvdXJjZSkge1xuICAgICAgY29uc3Qgd2l0aEZpbGUgPSBbLi4uYXJndiwgbGFzdFBsYWluRmlsZVNvdXJjZV07XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgTElORV9TRUxFQ1RPUlMpIHtcbiAgICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIod2l0aEZpbGUpKSB7XG4gICAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ2NhbmRpZGF0ZScpIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgY3VycmVudERpcik7XG4gICAgICAgICAgZWxzZVxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgICAgIGlkaW9tOiBvdXRjb21lLmlkaW9tLFxuICAgICAgICAgICAgICBmaWxlQXJnOiBvdXRjb21lLmZpbGVBcmcsXG4gICAgICAgICAgICAgIHJlYXNvbjogb3V0Y29tZS5yZWFzb25cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc1BsYWluU291cmNlKSBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgfVxuXG4gIHJldHVybiByZXN1bHRzO1xufVxuXG4vKiogUGFyc2VzIGEgQmFzaCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGUrbGluZS1yYW5nZSBzcGFucyBpdCBzdGF0aWNhbGx5LCByZWxpYWJseSByZWFkcyBvciB3cml0ZXMuIGBjd2RgIGRlZmF1bHRzIHRvIGBwcm9jZXNzLmN3ZCgpYCBcdTIwMTQgcGFzcyB0aGUgaG9vaydzIG93biBgY3dkYCBmaWVsZCBmb3IgY29ycmVjdCByZXNvbHV0aW9uIG9mIHJlbGF0aXZlIHBhdGhzIGFuZCBgY2RgL2BnaXQgLUNgIHRhcmdldHMsIGFuZCBvZiBgZ2l0IHNob3dgL2BnaXQgbG9nIC1MYCByZXZpc2lvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kKGNvbW1hbmQ6IHN0cmluZywgY3dkOiBzdHJpbmcgPSBwcm9jZXNzLmN3ZCgpKTogUmVzb2x2ZWRTcGFuW10ge1xuICBjb25zdCBkZXRhaWxlZCA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIGN3ZCk7XG4gIGNvbnN0IHNwYW5zOiBSZXNvbHZlZFNwYW5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgZGV0YWlsZWQpIHtcbiAgICBpZiAobS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpIHNwYW5zLnB1c2gobS5zcGFuKTtcbiAgfVxuICByZXR1cm4gc3BhbnM7XG59XG4iLCAiLyoqXG4gKiBUaGUgb25seSBpbXB1cmUgYml0czogY291bnRpbmcgbGluZXMgb2YgYSB3b3JraW5nLXRyZWUgZmlsZSwgYW5kIG9mIGEgZmlsZVxuICogYXMgaXQgZXhpc3RlZCBhdCBhIGdpdmVuIGdpdCByZXZpc2lvbi4gQm90aCByZXR1cm4gbnVsbCBvbiBhbnkgZmFpbHVyZVxuICogKG1pc3NpbmcgZmlsZSwgYmFkIHJldiwgbm90IGEgZ2l0IHJlcG8sIGV0Yy4pIGluc3RlYWQgb2YgdGhyb3dpbmcgXHUyMDE0IGFcbiAqIGNvbW1hbmQgdGhhdCBzdGF0aWNhbGx5IG1hdGNoZWQgYW4gaWRpb20gYnV0IHBvaW50cyBhdCBzb21ldGhpbmcgdGhpc1xuICogbWFjaGluZSBjYW4ndCBjdXJyZW50bHkgcmVzb2x2ZSBpcyBhIG5vcm1hbCwgZXhwZWN0ZWQgb3V0Y29tZSwgbm90IGEgYnVnLlxuICovXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGEgd29ya2luZy10cmVlIGZpbGUsIG9yIG51bGwgaWYgaXQgY2FuJ3QgYmUgcmVhZC4gVHJhaWxpbmcgbmV3bGluZSBkb2VzIG5vdCBjb3VudCBhcyBhbiBleHRyYSBlbXB0eSBsaW5lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgaWYgKCFzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRmlsZSgpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgICBpZiAoY29udGVudC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBjb250ZW50LmVuZHNXaXRoKCdcXG4nKSA/IGNvbnRlbnQuc2xpY2UoMCwgLTEpIDogY29udGVudDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGBwYXRoYCBhcyBpdCBleGlzdHMgYXQgYHJldmAsIHJ1biBmcm9tIGBjd2RgLCBvciBudWxsIGlmIHRoZSByZXYvcGF0aC9yZXBvIGRvZXNuJ3QgcmVzb2x2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEdpdEJsb2JMaW5lcyhjd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzaG93JywgYCR7cmV2fToke3BhdGh9YF0sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIGlmIChvdXQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gb3V0LmVuZHNXaXRoKCdcXG4nKSA/IG91dC5zbGljZSgwLCAtMSkgOiBvdXQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICIvKipcbiAqIEhldXJpc3RpYywgZGVwZW5kZW5jeS1mcmVlIHNoZWxsIHNwbGl0dGluZy4gTm90IGEgZnVsbCBzaGVsbCBwYXJzZXIgXHUyMDE0IGdvb2RcbiAqIGVub3VnaCB0byBsb2NhdGUgc2ltcGxlIGNvbW1hbmRzIChhbmQgdGhlaXIgYXJndikgaW5zaWRlIGEgbGFyZ2VyXG4gKiAmJi98fC87L3wtam9pbmVkIEJhc2ggc3RyaW5nIHdpdGhvdXQgcHVsbGluZyBpbiBhIHJlYWwgYmFzaCBBU1QgcGFyc2VyLlxuICogVmFsaWRhdGVkIGR1cmluZyByZXNlYXJjaCBhZ2FpbnN0IGJhc2hsZXggb24gdGhlIHJlYWwgdHJhbnNjcmlwdCBjb3JwdXM7XG4gKiB0aGlzIHBvcnRzIHRoZSBzYW1lIGFsZ29yaXRobS5cbiAqL1xuXG4vKiogT25lIGBzaW1wbGUgY29tbWFuZGAgZm91bmQgaW4gYSBsYXJnZXIgc2NyaXB0LCBwbHVzIHdoaWNoIG9wZXJhdG9yIHByZWNlZGVkIGl0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTaW1wbGVDb21tYW5kIHtcbiAgdGV4dDogc3RyaW5nO1xuICAvKiogVGhlIG9wZXJhdG9yIGltbWVkaWF0ZWx5IGJlZm9yZSB0aGlzIGNvbW1hbmQgKCd8JyBmb3IgYSBwaXBlbGluZSBzdGFnZSwgb3RoZXJ3aXNlICcmJicvJzsnLydcXG4nL2V0Yy4sIG9yICdzdGFydCcgZm9yIHRoZSBmaXJzdCBjb21tYW5kKS4gKi9cbiAgcHJlY2VkZWRCeTogJ3wnIHwgJ290aGVyJyB8ICdzdGFydCc7XG59XG5cbi8qKiBTcGxpdCBhIGNvbW1hbmQgc3RyaW5nIGludG8gc2ltcGxlLWNvbW1hbmQgc3Vic3RyaW5ncyBhdCB0b3AtbGV2ZWwgJiYsIHx8LCA7LCB8LCB8JiwgYW5kIG5ld2xpbmUgYm91bmRhcmllcy4gUXVvdGVzIGFuZCAkKCkvYGAvKCkgbmVzdGluZyBhcmUgcmVzcGVjdGVkIChub3Qgc3BsaXQgaW5zaWRlKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzcGxpdFRvcExldmVsKGNtZDogc3RyaW5nKTogU2ltcGxlQ29tbWFuZFtdIHtcbiAgY29uc3QgcGFydHM6IFNpbXBsZUNvbW1hbmRbXSA9IFtdO1xuICBsZXQgYnVmID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IGNtZC5sZW5ndGg7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgbGV0IHBlbmRpbmdPcDogU2ltcGxlQ29tbWFuZFsncHJlY2VkZWRCeSddID0gJ3N0YXJ0JztcblxuICBjb25zdCBmbHVzaCA9IChuZXh0T3A6IFNpbXBsZUNvbW1hbmRbJ3ByZWNlZGVkQnknXSkgPT4ge1xuICAgIGNvbnN0IHMgPSBidWYudHJpbSgpO1xuICAgIGlmIChzKSBwYXJ0cy5wdXNoKHsgdGV4dDogcywgcHJlY2VkZWRCeTogcGVuZGluZ09wIH0pO1xuICAgIGJ1ZiA9ICcnO1xuICAgIHBlbmRpbmdPcCA9IG5leHRPcDtcbiAgfTtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gY21kW2ldO1xuICAgIGlmIChpblNxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gXCInXCIpIGluU3F1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRHF1b3RlKSB7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICAgIGJ1ZiArPSBjbWRbaSArIDFdO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIGluRHF1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBpblNxdW90ZSA9IHRydWU7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGJ1ZiArPSBjICsgY21kW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBkZXB0aCArPSAxO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgZGVwdGggPSBNYXRoLm1heCgwLCBkZXB0aCAtIDEpO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJyYmJykge1xuICAgICAgICBmbHVzaCgnb3RoZXInKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfHwnKSB7XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8JicpIHtcbiAgICAgICAgZmx1c2goJ3wnKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ3wnKSB7XG4gICAgICAgIGZsdXNoKCd8Jyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBidWYgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgZmx1c2goJ290aGVyJyk7XG4gIHJldHVybiBwYXJ0cztcbn1cblxuY29uc3QgTEVBRElOR19BU1NJR05NRU5UID0gL14oPzpbQS1aYS16X11bQS1aYS16MC05X10qPVxcUypcXHMrKSsvO1xuXG4vKiogU3RyaXAgbGVhZGluZyBGT089YmFyIFZBUj1iYXogZW52LXByZWZpeCBhc3NpZ25tZW50cyBmcm9tIGEgc2ltcGxlIGNvbW1hbmQuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2ltcGxlQ21kLnJlcGxhY2UoTEVBRElOR19BU1NJR05NRU5ULCAnJyk7XG59XG5cbi8qKiBRdW90ZS1hd2FyZSB3aGl0ZXNwYWNlIHRva2VuaXplciwgcm91Z2hseSBtYXRjaGluZyBgc2hsZXguc3BsaXQocywgcG9zaXg9VHJ1ZSlgLiBSZXR1cm5zIG51bGwgb24gdW5iYWxhbmNlZCBxdW90ZXMuICovXG5leHBvcnQgZnVuY3Rpb24gc3BsaXRXb3JkcyhzOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBjb25zdCB3b3Jkczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1ciA9ICcnO1xuICBsZXQgaGFzID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHMubGVuZ3RoO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBzW2ldO1xuICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7XG4gICAgICBpZiAoaGFzKSB7XG4gICAgICAgIHdvcmRzLnB1c2goY3VyKTtcbiAgICAgICAgY3VyID0gJyc7XG4gICAgICAgIGhhcyA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnN0IGVuZCA9IHMuaW5kZXhPZihcIidcIiwgaSk7XG4gICAgICBpZiAoZW5kID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBjdXIgKz0gcy5zbGljZShpLCBlbmQpO1xuICAgICAgaSA9IGVuZCArIDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgc1tpXSAhPT0gJ1wiJykge1xuICAgICAgICBpZiAoc1tpXSA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHNbaSArIDFdKSkge1xuICAgICAgICAgIGN1ciArPSBzW2kgKyAxXTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3VyICs9IHNbaV07XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoaSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGN1ciArPSBzW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBoYXMgPSB0cnVlO1xuICAgIGN1ciArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICBpZiAoaGFzKSB3b3Jkcy5wdXNoKGN1cik7XG4gIHJldHVybiB3b3Jkcztcbn1cblxuLyoqIEJlc3QtZWZmb3J0IGFyZ3YgZm9yIGEgc2ltcGxlIGNvbW1hbmQ6IGxlYWRpbmcgYXNzaWdubWVudHMgc3RyaXBwZWQsIHF1b3RlLWF3YXJlIHNwbGl0LiBSZXR1cm5zIG51bGwgaWYgdGhlIGNvbW1hbmQgZG9lc24ndCB0b2tlbml6ZSBjbGVhbmx5ICh1bmJhbGFuY2VkIHF1b3RlcykuICovXG5leHBvcnQgZnVuY3Rpb24gYXJndk9mKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgcmV0dXJuIHNwbGl0V29yZHMoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kKS50cmltKCkpO1xufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBzcGFuLXN1cmZhY2luZyBjb3JlLlxuICpcbiAqIEdpdmVuIGFuIGFscmVhZHktcmVzb2x2ZWQgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCBhIGxpbmUgcmFuZ2UsIHRoaXMgbW9kdWxlXG4gKiBydW5zIHRoZSBzaGFyZWQgYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW5gIC8gYC5ob29raWdub3JlYCAvIHNlc3Npb24tbWVtbyAvXG4gKiBgZ2l0IHNwYW4gc3RhbGVgIHBpcGVsaW5lIGFuZCBhc3NlbWJsZXMgdGhlIGh1bWFuLXJlYWRhYmxlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gXG4gKiBibG9jayB0aGF0IGJvdGggYWRhcHRlcnMgc3VyZmFjZSBpbmxpbmUgYmVmb3JlIGFuIGVkaXQuIEl0IGltcG9ydHMgbm90aGluZ1xuICogZnJvbSBlaXRoZXIgaG9vayBTREs6IHRoZSBDbGF1ZGUgUHJlVG9vbFVzZSBob29rIGZlZWRzIGl0IGEgcmFuZ2UgZGVyaXZlZCBmcm9tXG4gKiBgZmlsZV9wYXRoYC9gb2Zmc2V0YC9gb2xkX3N0cmluZ2A7IHRoZSBDb2RleCBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgdGhlXG4gKiByYW5nZXMgcmVjb3ZlcmVkIGZyb20gYW4gYGFwcGx5X3BhdGNoYCBlbnZlbG9wZS4gRWFjaCBhZGFwdGVyIHdyYXBzIHRoZVxuICogcmV0dXJuZWQgYmxvY2sgc3RyaW5nIGluIGl0cyBvd24gU0RLIG91dHB1dCBidWlsZGVyLlxuICpcbiAqIFRoZSBleGVjdXRvci9zdGFsZS9tZW1vIGRlcGVuZGVuY2llcyBhcmUgaW5qZWN0ZWQgc28gdGhlIHBpcGVsaW5lIGlzIHRlc3RhYmxlXG4gKiB3aXRoIGZha2VzIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlIHNoYXJlZCBrZXJuZWwuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7XG4gIGlzR2l0SWdub3JlZCxcbiAgaXNJbnNpZGVTcGFuUm9vdCxcbiAgdHlwZSBMaW5lUmFuZ2UsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcGFyc2VTdGFsZVBvcmNlbGFpbixcbiAgcHJ1bmVTdGFsZVNlc3Npb25zLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdCxcbiAgc2Vzc2lvbkRpcixcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyB0eXBlIEhvb2tJZ25vcmVMb2FkZXIsIGlzU3BhblN1cHByZXNzZWQgfSBmcm9tICcuL3NwYW4taWdub3JlLmpzJztcblxuLyoqXG4gKiBNaW5pbWFsIGxvZ2dlciBzdXJmYWNlIHRoZSBgY29tbW9uL2AgbGF5ZXIgbG9ncyB0aHJvdWdoOyBib3RoIFNESyBsb2dnZXJzXG4gKiBzYXRpc2Z5IGl0LiBgd2FybmAgaXMgcmVxdWlyZWQgXHUyMDE0IGV2ZXJ5IGV4aXN0aW5nIGNhbGwgc2l0ZSByZXBvcnRzIGEgZmFpbHVyZS5cbiAqIGBpbmZvYCBpcyBvcHRpb25hbCBzbyBhIGZha2UgY2Fycnlpbmcgb25seSBgd2FybmAgc3RpbGwgc2F0aXNmaWVzIHRoZVxuICogaW50ZXJmYWNlOiBpdCBleGlzdHMgZm9yIHRoZSBkaWFnbm9zdGljIGJyZWFkY3J1bWJzIGEgKnN1Y2Nlc3NmdWwqIHJ1biBsZWF2ZXNcbiAqIGJlaGluZCAoYWR2aXNvci1jb3JlJ3MgY2h1cm4tc3VwcHJlc3Npb24gY291bnQpLCB3aGljaCBhcmUgbm90IHdhcm5pbmdzIGFuZFxuICogbXVzdCBub3QgcmVhZCBhcyBmYWlsdXJlcyBpbiB0aGUgaG9vayBsb2cuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29yZUxvZ2dlciB7XG4gIHdhcm4obWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkO1xuICBpbmZvPyhtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3BhbiBleGVjdXRvciBhYnN0cmFjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRXhlY3V0ZXMgYGdpdCBzcGFuIGxpc3RgIHdpdGggZ2l2ZW4gYXJncyBpbiBhIGdpdmVuIGN3ZC5cbiAqIFJldHVybnMgc3Rkb3V0IHN0cmluZy4gVGhyb3dzIG9uIG5vbi16ZXJvIGV4aXQuXG4gKi9cbmV4cG9ydCB0eXBlIFNwYW5FeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRTcGFuRXhlY3V0b3IodGltZW91dE1zID0gMTBfMDAwKTogU3BhbkV4ZWN1dG9yIHtcbiAgcmV0dXJuIChhcmdzLCBjd2QpID0+IHtcbiAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsIC4uLmFyZ3NdLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gIH07XG59XG5cbi8qKlxuICogUnVucyBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluIDxzbHVncz5gIGFuZCByZXR1cm5zIGl0cyBwb3JjZWxhaW4gc3Rkb3V0IFx1MjAxNFxuICogb25lIHJvdyBwZXIgKmRyaWZ0ZWQqIGFuY2hvciBhbW9uZyB0aGUgZ2l2ZW4gc3BhbnMsIGVtcHR5IHdoZW4gYWxsIGFyZSBjbGVhbi5cbiAqIGBnaXQgc3BhbiBzdGFsZWAgZXhpdHMgMCBpbiBwb3JjZWxhaW4gbW9kZSB3aGV0aGVyIG9yIG5vdCBkcmlmdCBleGlzdHMsIGJ1dCB3ZVxuICogc3RpbGwgY2FwdHVyZSBzdGRvdXQgZnJvbSBhIHRocm93biBlcnJvciBzbyBhIGRyaWZ0IHNpZ25hbCBpcyBuZXZlciBsb3N0IHRvIGFcbiAqIG5vbi16ZXJvIGV4aXQuIFRocm93cyBvbmx5IHdoZW4gbm8gc3Rkb3V0IGlzIGF2YWlsYWJsZSAoZ2VudWluZSBmYWlsdXJlKS5cbiAqL1xuZXhwb3J0IHR5cGUgU3RhbGVFeGVjdXRvciA9IChzbHVnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBzdHJpbmc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0U3RhbGVFeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBTdGFsZUV4ZWN1dG9yIHtcbiAgcmV0dXJuIChzbHVncywgY3dkKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdzdGFsZScsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zbHVnc10sIHtcbiAgICAgICAgY3dkLFxuICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgIGlmICh0eXBlb2Ygb3V0ID09PSAnc3RyaW5nJykgcmV0dXJuIG91dDtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBtZW1vIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBNZW1vU3RvcmUge1xuICBnZXRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZyk6IFNldDxzdHJpbmc+O1xuICBhZGRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZywgbmFtZXM6IHN0cmluZ1tdKTogdm9pZDtcbn1cblxuLy8gTGl2ZXMgdW5kZXIgdGhlIHNoYXJlZCBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgKGFnZW50LWhvb2tzLWNvbW1vbi50cydzXG4vLyBzZXNzaW9uRGlyKSBcdTIwMTQgcmVsb2NhdGVkIGZyb20gb3MudG1wZGlyKCkvYWdlbnQtaG9va3MtZ2l0LXNwYW4vIHNvXG4vLyBwZXItc2Vzc2lvbiBzdGF0ZSBoYXMgb25lIGhvbWUgYW5kIGlzIGNvdmVyZWQgYnkgcHJ1bmVTdGFsZVNlc3Npb25zJ3Ncbi8vIG9wcG9ydHVuaXN0aWMgPjMwLWRheSBwcnVuaW5nLlxuZnVuY3Rpb24gbWVtb0ZpbGVQYXRoKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oc2Vzc2lvbkRpcihzZXNzaW9uSWQpLCAndG91Y2gtbWVtby5qc29uJyk7XG59XG5cbmV4cG9ydCB0eXBlIE1lbW9Mb2dnZXIgPSBDb3JlTG9nZ2VyO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4ge1xuICAgIGdldFN1cmZhY2VkKHNlc3Npb25JZCkge1xuICAgICAgcHJ1bmVTdGFsZVNlc3Npb25zKCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByYXcgPSBmcy5yZWFkRmlsZVN5bmMobWVtb0ZpbGVQYXRoKHNlc3Npb25JZCksICd1dGY4Jyk7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KSBhcyB7IHN1cmZhY2VkPzogdW5rbm93biB9O1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQuc3VyZmFjZWQpKSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBTZXQocGFyc2VkLnN1cmZhY2VkIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHJlYWQgZmFpbGVkICh0cmVhdGluZyBhcyBlbXB0eSknLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgU2V0KCk7XG4gICAgfSxcbiAgICBhZGRTdXJmYWNlZChzZXNzaW9uSWQsIG5hbWVzKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICAgICAgZm9yIChjb25zdCBuIG9mIG5hbWVzKSBleGlzdGluZy5hZGQobik7XG4gICAgICBjb25zdCBtZW1vRGlyID0gc2Vzc2lvbkRpcihzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgbWVtb1BhdGggPSBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKTtcbiAgICAgIGNvbnN0IHRtcFBhdGggPSBgJHttZW1vUGF0aH0udG1wYDtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZzLm1rZGlyU3luYyhtZW1vRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBKU09OLnN0cmluZ2lmeSh7IHN1cmZhY2VkOiBbLi4uZXhpc3RpbmddIH0pLCAndXRmOCcpO1xuICAgICAgICBmcy5yZW5hbWVTeW5jKHRtcFBhdGgsIG1lbW9QYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyB3cml0ZSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKiBGYWN0b3J5IGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyBhIE1lbW9TdG9yZSBnaXZlbiBhIGxvZ2dlci4gKi9cbmV4cG9ydCB0eXBlIE1lbW9GYWN0b3J5ID0gKGxvZ2dlcjogTWVtb0xvZ2dlcikgPT4gTWVtb1N0b3JlO1xuXG4vKiogRGVmYXVsdCBkaXNrLWJhY2tlZCBtZW1vIGZhY3RvcnkgdXNlZCBpbiBwcm9kdWN0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2tNZW1vRmFjdG9yeShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXIpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIHNjb3BlIHJlc29sdXRpb24gKHJlcG8tc2NvcGluZyArIGdpdGlnbm9yZSArIHNwYW4tcm9vdCBndWFyZHMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBUb3VjaFNjb3BlIHtcbiAgcmVwb1Jvb3Q6IHN0cmluZztcbiAgcmVwb1JlbFBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCb3VuZCBhIHRvdWNoZWQgZmlsZSB0byB0aGUgQ1dEIHJlcG8uIFJlc29sdmUgdGhlIHJlcG8gcm9vdCBvZiB0aGUgY3VycmVudFxuICogd29ya2luZyBkaXJlY3RvcnkgYW5kIHJlcXVpcmUgdGhlIHRvdWNoZWQgZmlsZSB0byByZXNvbHZlIHRvIHRoZSBTQU1FIHJlcG9cbiAqIHJvb3Q7IGRyb3AgZmlsZXMgaW4gYSBkaWZmZXJlbnQgcmVwb3NpdG9yeS93b3JrdHJlZSwgZ2l0aWdub3JlZCBmaWxlcywgYW5kXG4gKiBmaWxlcyB1bmRlciB0aGUgc3BhbiByb290LiBSZXR1cm5zIHRoZSByZXNvbHZlZCBgeyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfWBcbiAqIG9yIG51bGwgd2hlbiB0aGUgdG91Y2ggaXMgb3V0IG9mIHNjb3BlLlxuICpcbiAqIENvbXBhcmluZyByZXNvbHZlZCBgZ2l0IC0tc2hvdy10b3BsZXZlbGAgdG9wbGV2ZWxzIChub3QgcGF0aCBwcmVmaXhlcylcbiAqIGRpc3Rpbmd1aXNoZXMgc2VwYXJhdGUgcmVwb3MgYW5kIHdvcmt0cmVlcyBhbmQgaXMgcm9idXN0IHRvIHN5bWxpbmtzLiBGYWlsXG4gKiBjbG9zZWQ6IGlmIHRoZSBDV0QgcmVwbyBjYW4ndCBiZSByZXNvbHZlZCwgdGhlIHRvdWNoIGlzIGRyb3BwZWQgcmF0aGVyIHRoYW5cbiAqIGZhbGxpbmcgYmFjayB0byB0aGUgZmlsZSdzIG93biByZXBvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IFRvdWNoU2NvcGUgfCBudWxsIHtcbiAgY29uc3QgY3dkUmVwb1Jvb3QgPSBjd2QgPyByZXNvbHZlUmVwb1Jvb3QoY3dkKSA6IG51bGw7XG4gIGlmICghY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFic0RpciA9IHRvUG9zaXgobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSk7XG4gIGNvbnN0IGZpbGVSZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChhYnNEaXIpO1xuICBpZiAoZmlsZVJlcG9Sb290ICE9PSBjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgcmVwb1Jvb3QgPSBjd2RSZXBvUm9vdDtcbiAgY29uc3QgcmVwb1JlbFBhdGggPSByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYWJzUGF0aCk7XG5cbiAgLy8gU2tpcCBnaXRpZ25vcmVkIGZpbGVzIGVudGlyZWx5LiBCdWlsZCBvdXRwdXQsIGNhY2hlcywgYW5kIGxvZ3MgYXJlIG5vdFxuICAvLyBzcGFuLXJlbGV2YW50OiB0aGV5IG11c3QgbmV2ZXIgc3VyZmFjZSBzcGFuIG92ZXJsYXBzLlxuICBpZiAoaXNHaXRJZ25vcmVkKHJlcG9Sb290LCByZXBvUmVsUGF0aCkpIHJldHVybiBudWxsO1xuXG4gIC8vIFNraXAgc3BhbiBkb2N1bWVudHMgZW50aXJlbHkuIEZpbGVzIHVuZGVyIHRoZSByZXNvbHZlZCBzcGFuIHJvb3QgYXJlIG1hbmFnZWRcbiAgLy8gYnkgZ2l0IHNwYW4gaXRzZWxmIGFuZCBhcmUgbm90IGFwcGxpY2F0aW9uIHNvdXJjZXMgdGhhdCBuZWVkIHNwYW4gY292ZXJhZ2UuXG4gIGNvbnN0IHNwYW5Sb290ID0gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KTtcbiAgaWYgKGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGgsIHNwYW5Sb290KSkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHsgcmVwb1Jvb3QsIHJlcG9SZWxQYXRoIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3VyZmFjZSByb3V0aW5lXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEluamVjdGVkIGRlcGVuZGVuY2llcyBmb3Ige0BsaW5rIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zfS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3VyZmFjZURlcHMge1xuICBleGVjdXRvcjogU3BhbkV4ZWN1dG9yO1xuICBzdGFsZUV4ZWN1dG9yOiBTdGFsZUV4ZWN1dG9yO1xuICBtZW1vOiBNZW1vU3RvcmU7XG4gIGxvYWRSdWxlczogSG9va0lnbm9yZUxvYWRlcjtcbiAgbG9nZ2VyOiBDb3JlTG9nZ2VyO1xufVxuXG4vKipcbiAqIEdpdmVuIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCB0aGUgbGluZSByYW5nZSBiZWluZyB0b3VjaGVkIHdpdGhpbiBhblxuICogYWxyZWFkeS1yZXNvbHZlZCByZXBvLCBwcm9kdWNlIHRoZSBgPGdpdC1zcGFuPlx1MjAyNjwvZ2l0LXNwYW4+YCBibG9jayBmb3IgdGhlXG4gKiBzcGFucyBvdmVybGFwcGluZyB0aGF0IHJhbmdlLCBvciBudWxsIHdoZW4gdGhlcmUgaXMgbm90aGluZyB0byBzdXJmYWNlLlxuICpcbiAqIFRoZSBwaXBlbGluZTogYGdpdCBzcGFuIGxpc3QgPHBhdGg+IC0tcG9yY2VsYWluYCBcdTIxOTIga2VlcCBsaW5lLXJhbmdlZCBhbmNob3JzIG9uXG4gKiB0aGUgc2FtZSBmaWxlIHRoYXQgaW50ZXJzZWN0IHRoZSByYW5nZSBhbmQgYXJlIG5vdCBgLmhvb2tpZ25vcmVgLXN1cHByZXNzZWQgXHUyMTkyXG4gKiBkcm9wIHNsdWdzIGFscmVhZHkgc3VyZmFjZWQgdGhpcyBzZXNzaW9uIChtZW1vKSBcdTIxOTIgcmVuZGVyIGBnaXQgc3BhbiBsaXN0XG4gKiA8bmFtZXNcdTIwMjY+YCBcdTIxOTIgYXBwZW5kIGEgYGdpdCBzcGFuIGhpc3RvcnkgPG5hbWU+YCBwb2ludGVyIGZvciBhbnkgYWxyZWFkeS1zdGFsZVxuICogc3Bhbi4gT24gc3VjY2VzcyB0aGUgc3VyZmFjZWQgbmFtZXMgYXJlIHJlY29yZGVkIGluIHRoZSBtZW1vLiBFeGVjdXRvciBhbmRcbiAqIHN0YWxlLXByb2JlIGZhaWx1cmVzIGFyZSBsb2dnZWQgYW5kIGRlZ3JhZGUgdG8gbnVsbCAvIHRoZSBwbGFpbiBibG9jazsgdGhleVxuICogbmV2ZXIgdGhyb3cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdXJmYWNlT3ZlcmxhcHBpbmdTcGFucyhcbiAgZGVwczogU3VyZmFjZURlcHMsXG4gIHJlcG9Sb290OiBzdHJpbmcsXG4gIHJlcG9SZWxQYXRoOiBzdHJpbmcsXG4gIHJhbmdlOiBMaW5lUmFuZ2UsXG4gIHNlc3Npb25JZDogc3RyaW5nXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgeyBleGVjdXRvciwgc3RhbGVFeGVjdXRvciwgbWVtbywgbG9hZFJ1bGVzLCBsb2dnZXIgfSA9IGRlcHM7XG5cbiAgLy8gRmlsdGVyIHBhc3M6IGdpdCBzcGFuIGxpc3QgPHBhdGg+IC0tcG9yY2VsYWluXG4gIGxldCBwb3JjZWxhaW5TdGRvdXQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICBwb3JjZWxhaW5TdGRvdXQgPSBleGVjdXRvcihbJy0tcG9yY2VsYWluJywgcmVwb1JlbFBhdGhdLCByZXBvUm9vdCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gUGF0aC1zY29wZWQgc3VwcHJlc3Npb246IGEgcmVwbydzIC5zcGFuLy5ob29raWdub3JlIGNhbiBob2xkIGJhY2sgc3BhbiBzbHVnXG4gIC8vIHByZWZpeGVzIGZvciBhbmNob3JzIHVuZGVyIGdpdmVuIHBhdGhzLiBBIHN1cHByZXNzZWQgc3BhbiBpcyBuZXZlciBzdXJmYWNlZC5cbiAgY29uc3QgaWdub3JlUnVsZXMgPSBsb2FkUnVsZXMocmVwb1Jvb3QpO1xuXG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gcGFyc2VQb3JjZWxhaW4ocG9yY2VsYWluU3Rkb3V0KTtcbiAgY29uc3QgY2FuZGlkYXRlTmFtZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGlmIChyb3cucGF0aCAhPT0gcmVwb1JlbFBhdGgpIGNvbnRpbnVlO1xuICAgIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgY29udGludWU7IC8vIHdob2xlLWZpbGUgYW5jaG9yXG4gICAgaWYgKCFyYW5nZXNJbnRlcnNlY3QocmFuZ2UsIHsgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH0pKSBjb250aW51ZTtcbiAgICBpZiAoaXNTcGFuU3VwcHJlc3NlZChpZ25vcmVSdWxlcywgcm93LnBhdGgsIHJvdy5uYW1lKSkgY29udGludWU7XG4gICAgY2FuZGlkYXRlTmFtZXMuYWRkKHJvdy5uYW1lKTtcbiAgfVxuXG4gIGlmIChjYW5kaWRhdGVOYW1lcy5zaXplID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBTdWJ0cmFjdCBhbHJlYWR5LXN1cmZhY2VkIG5hbWVzXG4gIGNvbnN0IHN1cmZhY2VkID0gbWVtby5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICBjb25zdCB0b1N1cmZhY2UgPSBbLi4uY2FuZGlkYXRlTmFtZXNdLmZpbHRlcigobikgPT4gIXN1cmZhY2VkLmhhcyhuKSkuc29ydCgpO1xuICBpZiAodG9TdXJmYWNlLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gUmVuZGVyIHBhc3M6IGdpdCBzcGFuIGxpc3QgPG5hbWUxPiA8bmFtZTI+IC4uLlxuICBsZXQgcmVuZGVyU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcmVuZGVyU3Rkb3V0ID0gZXhlY3V0b3IodG9TdXJmYWNlLCByZXBvUm9vdCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBsaXN0IChyZW5kZXIpIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gT2YgdGhlIHNwYW5zIGJlaW5nIHN1cmZhY2VkLCBmbGFnIGFueSBhbHJlYWR5IHN0YWxlIFx1MjAxNCB0aGUgdG91Y2hlZCBsaW5lcyBoYXZlXG4gIC8vIGRyaWZ0ZWQgZnJvbSB0aGVpciBhbmNob3JlZCBzdGF0ZSBcdTIwMTQgd2l0aCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlci5cbiAgLy8gRGV0ZWN0aW9uIGlzIGFzLW9mLW5vdyAoc3VyZmFjaW5nIHJ1bnMgYmVmb3JlIHRoZSBlZGl0IGFwcGxpZXMpLCBzbyB0aGlzXG4gIC8vIGNhdGNoZXMgcHJlLWV4aXN0aW5nIGRyaWZ0OyBkcmlmdCB0aGlzIHNlc3Npb24gY2F1c2VzIGlzIHRoZSBTdG9wIGhvb2sncyBqb2IuXG4gIC8vIEZhaWx1cmUgdG8gY29tcHV0ZSBzdGFsZW5lc3MgaXMgbm9uLWZhdGFsOiBmYWxsIGJhY2sgdG8gdGhlIHBsYWluIGJsb2NrLlxuICBsZXQgc3RhbGVIaW50ID0gJyc7XG4gIHRyeSB7XG4gICAgY29uc3Qgc3RhbGVOYW1lcyA9IG5ldyBTZXQocGFyc2VTdGFsZVBvcmNlbGFpbihzdGFsZUV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpKS5tYXAoKHIpID0+IHIubmFtZSkpO1xuICAgIGNvbnN0IHN0YWxlU3VyZmFjZWQgPSB0b1N1cmZhY2UuZmlsdGVyKChuKSA9PiBzdGFsZU5hbWVzLmhhcyhuKSk7XG4gICAgaWYgKHN0YWxlU3VyZmFjZWQubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbGluZXMgPSBzdGFsZVN1cmZhY2VkLm1hcCgobikgPT4gYCAgZ2l0IHNwYW4gaGlzdG9yeSAke259YCkuam9pbignXFxuJyk7XG4gICAgICBzdGFsZUhpbnQgPSBgXFxuU3RhbGUgXHUyMDE0IHRoZSBsaW5lcyB5b3UncmUgdG91Y2hpbmcgaGF2ZSBkcmlmdGVkIGZyb20gdGhlc2Ugc3BhbnMnIGFuY2hvcmVkIHN0YXRlLiBSZXZpZXcgaG93IGVhY2ggc3Vic3lzdGVtIGV2b2x2ZWQgYmVmb3JlIGNoYW5naW5nIGl0OlxcbiR7bGluZXN9YDtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBzdGFsZSAoaGlzdG9yeSBoaW50KSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgfVxuXG4gIGNvbnN0IHdyYXBwZWQgPSBgXFxuPGdpdC1zcGFuPlxcbiR7cmVuZGVyU3Rkb3V0fSR7c3RhbGVIaW50fVxcbjwvZ2l0LXNwYW4+XFxuYDtcblxuICAvLyBVcGRhdGUgbWVtb1xuICBtZW1vLmFkZFN1cmZhY2VkKHNlc3Npb25JZCwgdG9TdXJmYWNlKTtcblxuICByZXR1cm4gd3JhcHBlZDtcbn1cbiIsICIvKipcbiAqIFBhdGgtc2NvcGVkIHNwYW4gc3VwcHJlc3Npb24gZm9yIHRoZSBhZ2VudCBob29rcy5cbiAqXG4gKiBTb21lIHNwYW5zIGFyZSBub2lzZSB3aGVuIGJyb3dzaW5nIGNlcnRhaW4gcGFydHMgb2YgdGhlIHRyZWUgXHUyMDE0IHdpa2kgb3JcbiAqIG1hcmtldGluZyBzcGFucyB0aGF0IGFuY2hvciBwcm9zZSwgc3VyZmFjZWQgaW5saW5lIHdoaWxlIHJlYWRpbmcgc291cmNlLFxuICogYWRkIGxpdHRsZS4gVGhpcyBtb2R1bGUgbGV0cyBhIHJlcG8gZGVjbGFyZSwgcGVyIHBhdGgsIHdoaWNoIHNwYW4gc2x1Z1xuICogcHJlZml4ZXMgdG8gaG9sZCBiYWNrLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uaG9va2lnbm9yZWAuIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhXG4gKiBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuLCBhIHNpbmdsZSBydW4gb2Ygd2hpdGVzcGFjZSwgdGhlbiBhXG4gKiBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBzcGFuIHNsdWcgcHJlZml4ZXMgdG8gc3VwcHJlc3MgZm9yIHBhdGhzIHRoZSBwYXR0ZXJuXG4gKiBtYXRjaGVzOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjIHdpa2ksbWFya2V0aW5nXG4gKlxuICogQSBzcGFuIHdob3NlIHNsdWcgYmVnaW5zIHdpdGggYHdpa2lgIG9yIGBtYXJrZXRpbmdgICh0aGUgc2x1ZyBlcXVhbHMgdGhlXG4gKiBwcmVmaXgsIG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgKSBpcyB0aGVuIG5ldmVyIHN1cmZhY2VkIGZvciBhbiBhbmNob3Igd2hvc2UgcGF0aFxuICogc2l0cyB1bmRlciBgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjYCBcdTIwMTQgaXQgaXMgbmV2ZXIgc3VyZmFjZWQgaW4gdGhlIGlubGluZVxuICogYDxnaXQtc3Bhbj5gIGJsb2NrIHRoZSBgUG9zdFRvb2xVc2VgIHRvdWNoIGhvb2sgZW1pdHMuIEl0IGhhcyBubyBlZmZlY3Qgb25cbiAqIHRoZSBgUHJlVG9vbFVzZWAgYWR2aXNvciwgd2hvc2Ugb3duIHVuY292ZXJlZC13cml0ZXMgc3VwcHJlc3Npb24gbGl2ZXMgaW5cbiAqIGAuc3Bhbi8uYWR2aXNvcmlnbm9yZWAgKHNlZSBgYWR2aXNvci1pZ25vcmUudHNgKS5cbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXIgaXMgYSBkZWxpYmVyYXRlIHN1YnNldCBvZiBnaXRpZ25vcmU6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMgKHRoZSBsZWFmIGZpbGUgaXMgbm90XG4gKiAgIGl0c2VsZiB0ZXN0ZWQsIG9ubHkgaXRzIGFuY2VzdG9yIGRpcmVjdG9yaWVzKS5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogU3VwcHJlc3Npb24gaXMgZmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmhvb2tpZ25vcmVgLCBvciBhXG4gKiBtYWxmb3JtZWQgbGluZSwgeWllbGRzIG5vIHJ1bGUgcmF0aGVyIHRoYW4gaGlkaW5nIHNwYW5zIHRoZSBhdXRob3IgZGlkIG5vdFxuICogYXNrIHRvIGhpZGUuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBTcGFuIHNsdWcgcHJlZml4ZXMgc3VwcHJlc3NlZCBmb3IgcGF0aHMgdGhpcyBydWxlIG1hdGNoZXMuICovXG4gIHByZWZpeGVzOiBzdHJpbmdbXTtcbiAgLyoqIFRydWUgd2hlbiBgcmVwb1JlbFBhdGhgIChQT1NJWCwgcmVwby1yZWxhdGl2ZSkgaXMgZ292ZXJuZWQgYnkgdGhpcyBydWxlLiAqL1xuICBtYXRjaGVzOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbjtcbn1cblxuY29uc3QgSE9PS19JR05PUkVfUkVMID0gbm9kZVBhdGguam9pbignLnNwYW4nLCAnLmhvb2tpZ25vcmUnKTtcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIGdpdGlnbm9yZS1zdHlsZSBnbG9iIHNlZ21lbnQgaW50byBhbiBhbmNob3JlZCBSZWdFeHAuIGAqYCBhbmRcbiAqIGA/YCBzdGF5IHdpdGhpbiBhIHBhdGggc2VnbWVudDsgYCoqYCAob3B0aW9uYWxseSBmb2xsb3dlZCBieSBgL2ApIHNwYW5zIHRoZW0uXG4gKi9cbmZ1bmN0aW9uIGdsb2JUb1JlZ0V4cChnbG9iOiBzdHJpbmcpOiBSZWdFeHAge1xuICBsZXQgcmUgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBnbG9iLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IGdsb2JbaV07XG4gICAgaWYgKGMgPT09ICcqJykge1xuICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnKicpIHtcbiAgICAgICAgcmUgKz0gJy4qJztcbiAgICAgICAgaSsrO1xuICAgICAgICAvLyBBYnNvcmIgYSBmb2xsb3dpbmcgc2xhc2ggc28gYCoqL2Zvb2AgZG9lcyBub3QgZGVtYW5kIGEgbGl0ZXJhbCBgL2AuXG4gICAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJy8nKSBpKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZSArPSAnW14vXSonO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYyA9PT0gJz8nKSB7XG4gICAgICByZSArPSAnW14vXSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlICs9IGMucmVwbGFjZSgvWy4rXiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBeJHtyZX0kYCk7XG59XG5cbi8qKiBBbmNlc3RvciBwYXRoIGNoYWluOiBgYS9iL2MudHNgIFx1MjE5MiBgWydhJywgJ2EvYicsICdhL2IvYy50cyddYC4gKi9cbmZ1bmN0aW9uIGFuY2VzdG9yUGF0aHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0LnB1c2gocGFydHMuc2xpY2UoMCwgaSArIDEpLmpvaW4oJy8nKSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDb21waWxlIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuICh0aGlzIG1vZHVsZSdzIGdyYW1tYXIgXHUyMDE0IHNlZSB0aGVcbiAqIG1vZHVsZSBkb2MgY29tbWVudCkgaW50byBhIHBhdGggcHJlZGljYXRlLiBBIHBhdHRlcm4gbWF0Y2hlcyBhIGZpbGUgd2hlbiBpdFxuICogbWF0Y2hlcyB0aGUgZmlsZSdzIHBhdGggb3IgYW55IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBpdCwgc28gYSBkaXJlY3RvcnlcbiAqIHBhdHRlcm4gc3VwcHJlc3NlcyBldmVyeXRoaW5nIGJlbmVhdGggaXQuXG4gKlxuICogRXhwb3J0ZWQgc28gb3RoZXIgcGF0aC1zY29wZWQgaWdub3JlLWZpbGUgY29udmVudGlvbnMgKGUuZy4gYC5hZHZpc29yaWdub3JlYFxuICogaW4gYGFkdmlzb3ItaWdub3JlLnRzYCkgY2FuIHJldXNlIHRoZSBleGFjdCBtYXRjaGluZyBzZW1hbnRpY3MgcmF0aGVyIHRoYW5cbiAqIHJlaW1wbGVtZW50aW5nIHRoZW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21waWxlUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiB7XG4gIGxldCBwYXQgPSBwYXR0ZXJuO1xuICBsZXQgZGlyT25seSA9IGZhbHNlO1xuICBpZiAocGF0LmVuZHNXaXRoKCcvJykpIHtcbiAgICBkaXJPbmx5ID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMCwgLTEpO1xuICB9XG4gIGxldCBhbmNob3JlZCA9IHBhdC5pbmNsdWRlcygnLycpO1xuICBpZiAocGF0LnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGFuY2hvcmVkID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMSk7XG4gIH1cbiAgY29uc3QgcmUgPSBnbG9iVG9SZWdFeHAocGF0KTtcblxuICByZXR1cm4gKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoYW5jaG9yZWQpIHtcbiAgICAgIGNvbnN0IHNlZ3MgPSBhbmNlc3RvclBhdGhzKHJlcG9SZWxQYXRoKTtcbiAgICAgIC8vIEZvciBhIGRpci1vbmx5IHBhdHRlcm4sIG5ldmVyIHRlc3QgdGhlIGxlYWYgZmlsZSBpdHNlbGYuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IHNlZ3Muc2xpY2UoMCwgLTEpIDogc2VncztcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKHMpID0+IHJlLnRlc3QocykpO1xuICAgIH1cbiAgICAvLyBVbmFuY2hvcmVkOiBtYXRjaCBhZ2FpbnN0IGluZGl2aWR1YWwgcGF0aCBjb21wb25lbnRzIGF0IGFueSBkZXB0aC5cbiAgICBjb25zdCBjb21wb25lbnRzID0gcmVwb1JlbFBhdGguc3BsaXQoJy8nKTtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IGNvbXBvbmVudHMuc2xpY2UoMCwgLTEpIDogY29tcG9uZW50cztcbiAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjKSA9PiByZS50ZXN0KGMpKTtcbiAgfTtcbn1cblxuLyoqIFBhcnNlIGAuaG9va2lnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgbWFsZm9ybWVkIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSG9va0lnbm9yZShjb250ZW50OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIWxpbmUgfHwgbGluZS5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIC8vIGA8cGF0dGVybj48d2hpdGVzcGFjZT48cHJlZml4ZXM+YCBcdTIwMTQgcGF0dGVybiBpcyB0aGUgZmlyc3QgdG9rZW4sIHByZWZpeGVzXG4gICAgLy8gdGhlIHNlY29uZC4gQSBsaW5lIHdpdGhvdXQgYm90aCBpcyBtYWxmb3JtZWQgYW5kIHNraXBwZWQuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxcUyspXFxzKyhcXFMrKSQvKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBwYXR0ZXJuLCBwcmVmaXhlc1Jhd10gPSBtYXRjaDtcbiAgICBjb25zdCBwcmVmaXhlcyA9IHByZWZpeGVzUmF3XG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGlmIChwcmVmaXhlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBwcmVmaXhlcywgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHN1cHByZXNzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgb3IgcGFyc2UgZmFpbHVyZVxuICogeWllbGRzIGFuIGVtcHR5IHJ1bGUgc2V0LCBzbyBzcGFucyBzdXJmYWNlIGFzIG5vcm1hbCB3aGVuIG5vIGNvbmZpZyBleGlzdHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSG9va0lnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEhPT0tfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlSG9va0lnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBBIHNsdWcgY2FycmllcyBhIHByZWZpeCB3aGVuIGl0IGVxdWFscyB0aGUgcHJlZml4IG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgLiAqL1xuZnVuY3Rpb24gc2x1Z0hhc1ByZWZpeChzbHVnOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBzbHVnID09PSBwcmVmaXggfHwgc2x1Zy5zdGFydHNXaXRoKGAke3ByZWZpeH0vYCk7XG59XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGEgc3BhbiBgc2x1Z2Agc2hvdWxkIGJlIHN1cHByZXNzZWQgZm9yIGFuIGFuY2hvciBhdCBgcmVwb1JlbFBhdGhgOlxuICogc29tZSBydWxlIG1hdGNoZXMgdGhlIHBhdGggYW5kIGxpc3RzIGEgcHJlZml4IHRoZSBzbHVnIGNhcnJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYW5TdXBwcmVzc2VkKHJ1bGVzOiBJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNsdWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICBpZiAoIXJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpIGNvbnRpbnVlO1xuICAgIGlmIChydWxlLnByZWZpeGVzLnNvbWUoKHApID0+IHNsdWdIYXNQcmVmaXgoc2x1ZywgcCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkSG9va0lnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgSG9va0lnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHRvdWNoLWhvb2sgY29yZS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpbXBsZW1lbnRzIHRoZSBQb3N0VG9vbFVzZSBcInRvdWNoIHNpZ25hbFwiIHRoYXQgYm90aCB0aGUgQ2xhdWRlXG4gKiAoYFJlYWR8RWRpdHxXcml0ZWApIGFuZCBDb2RleCAoYGFwcGx5X3BhdGNoYCkgYWRhcHRlcnMgZHJpdmUuIEl0IGltcG9ydHNcbiAqIG5vdGhpbmcgZnJvbSBlaXRoZXIgaG9vayBTREsgYW5kIGlzIHR5cGVkIHN0cnVjdHVyYWxseSwgcGVyIHRoZSBgY29tbW9uL2BcbiAqIGxheWVyIGNvbnZlbnRpb246IGFkYXB0ZXJzIHRyYW5zbGF0ZSB0aGVpciBTREstc3BlY2lmaWMgaG9vayBpbnB1dCBpbnRvIGFcbiAqIHtAbGluayBUb3VjaElucHV0fSwgaW5qZWN0IGV4ZWN1dGlvbi9zdGF0ZSBkZXBlbmRlbmNpZXMsIGFuZCB3cmFwIHRoZSByZXR1cm5lZFxuICoge0BsaW5rIFRvdWNoT3V0cHV0fSBpbiB0aGVpciBvd24gb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogUmV1c2VkIGZyb20gdGhlIHNoYXJlZCBrZXJuZWwgKG5vdCByZWRlZmluZWQpOiBgaXNEZWJ0KClgICtcbiAqIGBQb3JjZWxhaW5TdGF0dXNgL2BTdGFsZVBvcmNlbGFpblJvd2AvYFBvcmNlbGFpblJvd2AvYHBhcnNlUG9yY2VsYWluYC9cbiAqIGBwYXJzZVN0YWxlUG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYHJhbmdlc0ludGVyc2VjdGAgYW5kIHRoZVxuICogcmVwby9zcGFuLXJvb3QgcGF0aCB1dGlsaXRpZXMgKGFnZW50LWhvb2tzLWNvbW1vbi50cyksIGFuZCB0aGUgYE1lbW9TdG9yZWBcbiAqIGNhZGVuY2Ugc3RvcmUgKHNwYW4tc3VyZmFjZS50cykuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHR5cGUgUG9yY2VsYWluU3RhdHVzLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcGFyc2VTdGFsZVBvcmNlbGFpbixcbiAgcmFuZ2VzSW50ZXJzZWN0LFxuICByZWxhdGl2ZVRvUmVwbyxcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICByZXNvbHZlU3BhblJvb3QsXG4gIHR5cGUgU3RhbGVQb3JjZWxhaW5Sb3dcbn0gZnJvbSAnLi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgY29sbGFwc2VCeVBhdGgsIHR5cGUgUmFuZ2VMYWJlbCwgcmVuZGVyQW5jaG9yVHJlZSB9IGZyb20gJy4vYW5jaG9yLXRyZWUuanMnO1xuaW1wb3J0IHR5cGUgeyBNZW1vU3RvcmUgfSBmcm9tICcuL3NwYW4tc3VyZmFjZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9zdC1lZGl0IHJhbmdlIHJlY292ZXJ5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTcGxpdCB3cml0dGVuIGNvbnRlbnQgaW50byB0aGUgbGluZXMgdG8gbG9jYXRlIG9uIGRpc2suIEEgc2luZ2xlIHRyYWlsaW5nXG4gKiBuZXdsaW5lIGlzIGRyb3BwZWQgc28gYFwiYVxcbmJcXG5cImAgYW5kIGBcImFcXG5iXCJgIGxvY2F0ZSBpZGVudGljYWxseTsgYW4gZW1wdHlcbiAqIChvciBuZXdsaW5lLW9ubHkpIHdyaXRlIGhhcyBubyBsb2NhdGFibGUgYmxvY2suXG4gKi9cbmZ1bmN0aW9uIHRvTmVlZGxlTGluZXMod3JpdHRlbjogc3RyaW5nKTogc3RyaW5nW10ge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgdHJpbW1lZCA9IHdyaXR0ZW4uZW5kc1dpdGgoJ1xcbicpID8gd3JpdHRlbi5zbGljZSgwLCAtMSkgOiB3cml0dGVuO1xuICBpZiAodHJpbW1lZC5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgcmV0dXJuIHRyaW1tZWQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIGxpbmUgcmFuZ2UgdGhhdCB3cml0dGVuIGNvbnRlbnQgbm93IG9jY3VwaWVzIGluIHRoZSBvbi1kaXNrIGZpbGUsXG4gKiBmb3IgYW5jaG9yaW5nIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZnRlciBhbiBlZGl0IGhhcyBhbHJlYWR5IGFwcGxpZWQuXG4gKlxuICogVGhpcyBnZW5lcmFsaXplcyB0aGUgcHJlLWVkaXQgYGxvY2F0ZUNodW5rKClgIHRlY2huaXF1ZSBpblxuICogW2FwcGx5LXBhdGNoLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jb2RleC9hcHBseS1wYXRjaC50cyNMMjUzLUwyODYpXG4gKiAocHJldmlvdXNseSBDb2RleC1vbmx5KSBpbnRvIGEgc2hhcmVkIHBvc3QtZWRpdCBwcmltaXRpdmUgYm90aCBoYXJuZXNzZXMgdXNlOlxuICogc3BsaXQgYHdyaXR0ZW5gIGFuZCBgb25EaXNrQ29udGVudGAgaW50byBsaW5lcyBhbmQgbG9jYXRlIHRoZSB3cml0dGVuIGJsb2NrIGFzXG4gKiBhIGNvbnRpZ3VvdXMgcnVuIGluc2lkZSB0aGUgb24tZGlzayBsaW5lcy5cbiAqXG4gKiAtIEEgc2luZ2xlIGNvbnRpZ3VvdXMgbWF0Y2ggeWllbGRzIGl0cyAxLWJhc2VkIGluY2x1c2l2ZSB7QGxpbmsgTGluZVJhbmdlfS5cbiAqIC0gV2hlbiB0aGUgYmxvY2sgaXMgYWJzZW50LCBvciBhcHBlYXJzIG1vcmUgdGhhbiBvbmNlIChjb250ZXh0IHRvIGRpc2FtYmlndWF0ZVxuICogICBpcyBub3QgYXZhaWxhYmxlIHBvc3QtZWRpdCksIHJlY292ZXJ5IGlzIGFtYmlndW91cyBhbmQgdGhlIHJlc3VsdCBkZWdyYWRlc1xuICogICB0byBgJ3dob2xlLWZpbGUnYCAodGhlIHNhbWUgZmFsbGJhY2sgYGxvY2F0ZUNodW5rKClgIHNpZ25hbHMgd2l0aCBgbnVsbGApLlxuICpcbiAqIE5ldmVyIHRocm93czogYW4gdW5sb2NhdGFibGUgd3JpdGUgaXMgYSBgJ3dob2xlLWZpbGUnYCBhbnN3ZXIsIG5vdCBhbiBlcnJvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY292ZXJSYW5nZSh3cml0dGVuOiBzdHJpbmcsIG9uRGlza0NvbnRlbnQ6IHN0cmluZyk6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGNvbnN0IG5lZWRsZSA9IHRvTmVlZGxlTGluZXMod3JpdHRlbik7XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuXG4gIGNvbnN0IGhheXN0YWNrID0gb25EaXNrQ29udGVudC5zcGxpdCgnXFxuJyk7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBjb25zdCBzdGFydHM6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSB7XG4gICAgICBzdGFydHMucHVzaChpKTtcbiAgICAgIGlmIChzdGFydHMubGVuZ3RoID4gMSkgYnJlYWs7IC8vIGR1cGxpY2F0ZWQgXHUyMTkyIGFtYmlndW91cywgc3RvcCBlYXJseVxuICAgIH1cbiAgfVxuXG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHN0YXJ0c1swXSArIDEsIGVuZDogc3RhcnRzWzBdICsgbmVlZGxlLmxlbmd0aCB9O1xuICB9XG4gIHJldHVybiAnd2hvbGUtZmlsZSc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaW5wdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFdoaWNoIGhhcm5lc3MgZXZlbnQgZmlyZWQsIGFzIHRoZSB0b3VjaCBjb3JlIHNlZXMgaXQuIFRoZSBjb3JlIGJyYW5jaGVzIG9uXG4gKiB0aGlzOiBgd3JpdGVgIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSBhbmQgbWF5IHN1cmZhY2UgYVxuICogbWVyZ2VkIGJsb2NrOyBgcmVhZGAgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZSBhbmQgZmlsdGVycyBwb3NpdGlvbmFsIHN0YXR1c2VzXG4gKiBvdXQgb2Ygd2hhdCBpdCBzdXJmYWNlcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hFdmVudEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnO1xuXG4vKiogRmllbGRzIHNoYXJlZCBieSBldmVyeSB0b3VjaCwgcmVnYXJkbGVzcyBvZiBraW5kLiAqL1xuaW50ZXJmYWNlIFRvdWNoSW5wdXRCYXNlIHtcbiAgLyoqIEhhcm5lc3Mgc2Vzc2lvbiBpZCBcdTIwMTQga2V5cyB0aGUgcGVyLXNlc3Npb24gY2FkZW5jZSB7QGxpbmsgTWVtb1N0b3JlfS4gKi9cbiAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBXb3JraW5nIGRpcmVjdG9yeSB0aGUgdG9vbCByYW4gaW4sIHVzZWQgdG8gYm91bmQgdGhlIHRvdWNoIHRvIHRoZSBDV0QgcmVwb1xuICAgKiB2aWEgYHJlc29sdmVUb3VjaFNjb3BlKClgIGJlZm9yZSBhbnkgc3BhbiBpbnZvY2F0aW9uLlxuICAgKi9cbiAgY3dkOiBzdHJpbmc7XG4gIC8qKiBBYnNvbHV0ZSwgY2Fub25pY2FsaXplZCBwYXRoIG9mIHRoZSB0b3VjaGVkIGZpbGUuICovXG4gIGZpbGVQYXRoOiBzdHJpbmc7XG59XG5cbi8qKiBBIHJlYWQgdG91Y2ggKENsYXVkZSBgUmVhZGAsIG9yIGEgcmVhZC1zaGFwZWQgQ29kZXggZXZlbnQpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaFJlYWRJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3JlYWQnO1xuICAvKipcbiAgICogMS1iYXNlZCBzdGFydGluZyBsaW5lIG9mIHRoZSByZWFkLCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBgb2Zmc2V0YFxuICAgKiBpbnB1dC4gYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYG9mZnNldGAgKHJlYWRzIGZyb20gbGluZSAxKS5cbiAgICovXG4gIG9mZnNldD86IG51bWJlcjtcbiAgLyoqXG4gICAqIExpbmUgY291bnQgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBsaW1pdGAgaW5wdXQuXG4gICAqIGB1bmRlZmluZWRgIHdoZW4gdGhlIHJlYWQgaGFkIG5vIGBsaW1pdGAgXHUyMDE0IHNlZSB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfVxuICAgKiBmb3IgaG93IHRoZSByYW5nZSBpcyBjb21wdXRlZCBpbiB0aGF0IGNhc2UuXG4gICAqL1xuICBsaW1pdD86IG51bWJlcjtcbn1cblxuLyoqIEEgd3JpdGUgdG91Y2ggKENsYXVkZSBgRWRpdGAvYFdyaXRlYCwgQ29kZXggYGFwcGx5X3BhdGNoYCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoV3JpdGVJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3dyaXRlJztcbiAgLyoqXG4gICAqIFRoZSBjb250ZW50IGp1c3Qgd3JpdHRlbiB0byBgZmlsZVBhdGhgLCBmZWQgdG8ge0BsaW5rIHJlY292ZXJSYW5nZX0gdG9cbiAgICogcmUtYW5jaG9yIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZ2FpbnN0IHRoZSBoZWFsZWQgb24tZGlzayBmaWxlLiBGb3IgYVxuICAgKiB3aG9sZS1maWxlIGNyZWF0ZSB0aGlzIGlzIHRoZSBlbnRpcmUgZmlsZSBib2R5OyBhbiBlbXB0eSBzdHJpbmcgbWVhbnNcbiAgICogXCJubyBsb2NhdGFibGUgYmxvY2tcIiBhbmQgdGhlIHRvdWNoIGlzIHNjb3BlZCBmaWxlLXdpZGUuXG4gICAqL1xuICB3cml0dGVuOiBzdHJpbmc7XG59XG5cbi8qKiBUaGUgaGFybmVzcy1hZ25vc3RpYyB0b3VjaCB0aGUgY29yZSBjb25zdW1lcy4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoSW5wdXQgPSBUb3VjaFJlYWRJbnB1dCB8IFRvdWNoV3JpdGVJbnB1dDtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbmplY3RlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3RydWN0dXJlZCByZXN1bHQgb2YgYSBzY29wZWQgYGdpdCBzcGFuIHN0YWxlIDxmaWxlPiAtLWZpeGAuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoRml4UmVzdWx0IHtcbiAgLyoqXG4gICAqIFdoZXRoZXIgYC0tZml4YCByZS1hbmNob3JlZCBhdCBsZWFzdCBvbmUgc3BhbiBpbiB0aGUgd29ya2luZyB0cmVlLiBEcml2ZXNcbiAgICoge0BsaW5rIFRvdWNoT3V0cHV0LnRyZWVNb2RpZmllZH0gc28gYSBjYWxsZXIvdGVzdCBjYW4gYXNzZXJ0IHRoZSBoZWFsaW5nXG4gICAqIGhhcHBlbmVkIHdpdGhvdXQgZGlmZmluZyB0aGUgdHJlZSBpdHNlbGYuXG4gICAqL1xuICBtb2RpZmllZDogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIHN0YWxlIDxmaWxlPiAtLWZpeGAgc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgKHdyaXRlIHBhdGhcbiAqIG9ubHkpLCByZXBvcnRpbmcgd2hldGhlciB0aGUgd29ya2luZyB0cmVlIHdhcyBoZWFsZWQuIEFzeW5jIHNvIHRoZSBldmVudHVhbFxuICogaW1wbGVtZW50YXRpb24gYW5kIGl0cyB0ZXN0cyBjYW4gaW5qZWN0IGEgZmFrZSB3aXRob3V0IGEgcmVhbCBzdWJwcm9jZXNzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEZpeEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFRvdWNoRml4UmVzdWx0PjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gPGZpbGU+YCBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlclxuICogYW5jaG9yIGNvdmVyaW5nIHRoZSBmaWxlLiBTdHJ1Y3R1cmVkIChub3QgcmF3IHN0ZG91dCkgc28gdGhlIG1lcmdlZC1ibG9ja1xuICogY29tcHV0YXRpb24gYW5kIGl0cyB0ZXN0cyBzaGFyZSB0aGUgc2FtZSBzaGFwZS5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hMaXN0RXhlY3V0b3IgPSAoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8UG9yY2VsYWluUm93W10+O1xuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluIDxhcmdzPmAgKHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlIG9yXG4gKiBpdHMgc3BhbnMpIGFuZCByZXR1cm4gaXRzIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyIGRyaWZ0ZWQgYW5jaG9yLCBlbXB0eSB3aGVuXG4gKiBjbGVhbi4gU3RhdHVzIGNsYXNzaWZpY2F0aW9uIGlzIHZpYSBgaXNEZWJ0KClgOyBwb3NpdGlvbmFsIChgTU9WRURgLFxuICogYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCkgcm93cyBhcmUgbmV2ZXIgZGVidC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hTdGFsZUV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxTdGFsZVBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYmFyZSBgZ2l0IHNwYW4gd2h5IDxuYW1lPmAgYW5kIHJldHVybiB0aGUgc3BhbidzIHJlY29yZGVkIHdoeSBzZW50ZW5jZSxcbiAqIG9yIGBudWxsYCB3aGVuIG5vbmUgaXMgcmVjb3JkZWQgb3IgdGhlIHJlYWQgZmFpbHMuIEZlZWRzIHRoZSBodW1hbi1mb3JtYXRcbiAqIHNwYW4gcmVuZGVyOyBpbnZva2VkIG9ubHkgZm9yIHNwYW5zIGFjdHVhbGx5IGJlaW5nIHN1cmZhY2VkIHRoaXMgdG91Y2guXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoV2h5RXhlY3V0b3IgPSAobmFtZTogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxzdHJpbmcgfCBudWxsPjtcblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZXhlY3V0aW9uIHN1cmZhY2UuIEtlcHQgYXMgZm91ciBuYXJyb3cgYXN5bmMgZnVuY3Rpb25zIChyYXRoZXJcbiAqIHRoYW4gYSByYXcgY29tbWFuZCBydW5uZXIpIHNvIHRlc3RzIGluamVjdCBmYWtlcyByZXR1cm5pbmcgc3RydWN0dXJlZCBkYXRhXG4gKiBhbmQgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIGEgc3VicHJvY2VzcyBpdHNlbGYuIFRoZSBgcmVhZGAgcGF0aCBuZXZlciBpbnZva2VzXG4gKiBgZml4YC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEV4ZWN1dG9ycyB7XG4gIGZpeDogVG91Y2hGaXhFeGVjdXRvcjtcbiAgbGlzdDogVG91Y2hMaXN0RXhlY3V0b3I7XG4gIHN0YWxlOiBUb3VjaFN0YWxlRXhlY3V0b3I7XG4gIHdoeTogVG91Y2hXaHlFeGVjdXRvcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBvdXRwdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hhdCB0aGUgY29yZSBoYW5kcyBiYWNrIGZvciB0aGUgYWRhcHRlciB0byB0cmFuc2xhdGUgaW50byBTREsgb3V0cHV0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaE91dHB1dCB7XG4gIC8qKlxuICAgKiBUaGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayAoaGVhZGVyLCBvbmUgaHVtYW4tZm9ybWF0IHNlY3Rpb24gcGVyXG4gICAqIHN1cmZhY2VkIHNwYW4sIGZvb3RlcikgdG8gaW5qZWN0IHZpYSB0aGUgaGFybmVzcydzIGBhZGRpdGlvbmFsQ29udGV4dGAsXG4gICAqIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzIG5vdGhpbmcgd29ydGggc3VyZmFjaW5nIHRoaXMgdG91Y2guXG4gICAqL1xuICBhZGRpdGlvbmFsQ29udGV4dDogc3RyaW5nIHwgbnVsbDtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgbW9kaWZpZWQgYnkgYSBzY29wZWQgYC0tZml4YCBvbiB0aGUgd3JpdGUgcGF0aC5cbiAgICogQWx3YXlzIGBmYWxzZWAgb24gdGhlIHJlYWQgcGF0aCAocmVhZHMgbmV2ZXIgbXV0YXRlIHRoZSB0cmVlKS5cbiAgICovXG4gIHRyZWVNb2RpZmllZDogYm9vbGVhbjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBNZXJnZWQtYmxvY2sgYXNzZW1ibHlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIG1lbW8ga2V5IHVuZGVyIHdoaWNoIGEgc3BhbidzIHJlbmRlciBmb3IgYSBnaXZlbiBkcmlmdCBzdGF0dXMgaXMgZGVkdXBlZC4gKi9cbmZ1bmN0aW9uIGRyaWZ0S2V5KG5hbWU6IHN0cmluZywgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICAvLyBTcGFuIG5hbWVzIGNvbWUgZnJvbSB0YWItZGVsaW1pdGVkIHBvcmNlbGFpbiwgc28gdGhleSBuZXZlciBjb250YWluIGEgdGFiO1xuICAvLyBhIHRhYi1qb2luZWQga2V5IGNhbiBuZXZlciBjb2xsaWRlIHdpdGggYSBiYXJlIHNwYW4gbmFtZSAodGhlIHN1cmZhY2luZyBrZXkpLlxuICByZXR1cm4gYCR7bmFtZX1cXHQke3N0YXR1c31gO1xufVxuXG4vKiogVGhlIGBwYXRoI0xzdGFydC1MZW5kYCAob3IgYmFyZS1wYXRoLCB3aG9sZS1maWxlKSBhbmNob3IgdGV4dCBmb3IgYSByb3cuICovXG5mdW5jdGlvbiBhbmNob3JUZXh0KHJvdzogUG9yY2VsYWluUm93KTogc3RyaW5nIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4gcm93LnBhdGg7XG4gIHJldHVybiBgJHtyb3cucGF0aH0jTCR7cm93LnN0YXJ0fS1MJHtyb3cuZW5kfWA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuSGVhZGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCR7ZmlsZU5hbWV9IGhhcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXM6YDtcbn1cblxuZnVuY3Rpb24gY2xlYW5Gb290ZXIoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgSWYgeW91IGNoYW5nZSAke2ZpbGVOYW1lfSBjaGVjayB0aGUgb3RoZXIgZmlsZXMgdG8gY29uZmlybSB0aGV5IHN0aWxsIHdvcmsgdG9nZXRoZXIuYDtcbn1cblxuLyoqXG4gKiBUaGUgd3JpdGUgcGF0aCBuYW1lcyB0aGUgZWRpdCBhcyB0aGUgY2F1c2U7IHRoZSByZWFkIHBhdGggb25seSBzdXJmYWNlc1xuICogcHJlLWV4aXN0aW5nIGRyaWZ0IGl0IGRpZG4ndCBjcmVhdGUsIHNvIGl0IG5hbWVzIHRoZSBkZXBlbmRlbmN5IGluc3RlYWQuXG4gKi9cbmZ1bmN0aW9uIGRyaWZ0SGVhZGVyKGRyaWZ0ZWRDb3VudDogbnVtYmVyLCBraW5kOiBUb3VjaElucHV0WydraW5kJ10pOiBzdHJpbmcge1xuICBpZiAoa2luZCA9PT0gJ3dyaXRlJykge1xuICAgIHJldHVybiBkcmlmdGVkQ291bnQgPT09IDFcbiAgICAgID8gJ1RoaXMgZWRpdCBwdXQgYW4gaW1wbGljaXQgZGVwZW5kZW5jeSBvdXQgb2YgZGF0ZTonXG4gICAgICA6ICdUaGlzIGVkaXQgcHV0IGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xuICB9XG4gIHJldHVybiBkcmlmdGVkQ291bnQgPT09IDFcbiAgICA/ICdUaGlzIGZpbGUgaGFzIGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgIDogJ1RoaXMgZmlsZSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzIG91dCBvZiBkYXRlOic7XG59XG5cbmZ1bmN0aW9uIGRyaWZ0Rm9vdGVyKGRyaWZ0ZWROYW1lczogc3RyaW5nW10pOiBzdHJpbmcge1xuICBpZiAoZHJpZnRlZE5hbWVzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IG5hbWUgPSBkcmlmdGVkTmFtZXNbMF07XG4gICAgcmV0dXJuIGBSZXN0b3JlIGFncmVlbWVudCBhY3Jvc3MgdGhlIGFuY2hvcnMgYmVmb3JlIGNvbW1pdHRpbmcgXHUyMDE0IGRvY3MgZm9sbG93IGRlbGliZXJhdGVseSBjb21taXR0ZWQgY29kZSBcdTIwMTQgdGhlbiByZWZyZXNoOiBcXGBnaXQgc3BhbiBhZGQgJHtuYW1lfSA8cGF0aCNMc3RhcnQtTGVuZD5cXGAgLyBcXGBnaXQgc3BhbiB3aHkgJHtuYW1lfSBcIi4uLlwiXFxgIFx1MjAxNCBhbmQgY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMgZm9yIGtub2NrLW9uIGNoYW5nZXMuIElmIHRoZSBmaXggbmVlZHMgYSBjb2RlIGNoYW5nZSBvciB0aGUgY291cGxpbmcgbm8gbG9uZ2VyIGhvbGRzLCB0ZWxsIHRoZSB1c2VyIGluc3RlYWQuYDtcbiAgfVxuICByZXR1cm4gJ0ZvciBlYWNoIG91dC1vZi1kYXRlIHNwYW4gYWJvdmU6IHJlc3RvcmUgYWdyZWVtZW50IGFjcm9zcyB0aGUgYW5jaG9ycyBiZWZvcmUgY29tbWl0dGluZyBcdTIwMTQgZG9jcyBmb2xsb3cgZGVsaWJlcmF0ZWx5IGNvbW1pdHRlZCBjb2RlIFx1MjAxNCB0aGVuIHJlZnJlc2g6IGBnaXQgc3BhbiBhZGQgPG5hbWU+IDxwYXRoI0xzdGFydC1MZW5kPmAgLyBgZ2l0IHNwYW4gd2h5IDxuYW1lPiBcIi4uLlwiYCBcdTIwMTQgYW5kIGNoZWNrIHRoZSBvdGhlciBhbmNob3JzIGZvciBrbm9jay1vbiBjaGFuZ2VzLiBJZiBhIGZpeCBuZWVkcyBhIGNvZGUgY2hhbmdlIG9yIGEgY291cGxpbmcgbm8gbG9uZ2VyIGhvbGRzLCB0ZWxsIHRoZSB1c2VyIGluc3RlYWQuJztcbn1cblxuLyoqIFRoZSB7QGxpbmsgUmFuZ2VMYWJlbH0gZm9yIGEgcG9yY2VsYWluIHJvdyBcdTIwMTQgYDAtMGAgaXMgdGhlIHdob2xlLWZpbGUgYW5jaG9yLiAqL1xuZnVuY3Rpb24gcmFuZ2VMYWJlbChyb3c6IFBvcmNlbGFpblJvdyk6IFJhbmdlTGFiZWwge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiB7IGtpbmQ6ICd3aG9sZS1maWxlJyB9O1xuICByZXR1cm4geyBraW5kOiAncmFuZ2UnLCBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfTtcbn1cblxuLyoqXG4gKiBBIHNwYW4ncyBmdWxsIGFuY2hvciBsaXN0LCByZW5kZXJlZCBhcyBhIHNoYXJlZC1wcmVmaXggdHJlZSBieVxuICoge0BsaW5rIHJlbmRlckFuY2hvclRyZWV9LCB3aXRoIGVhY2ggYW5jaG9yIHRoYXQgY2FycmllcyBnZW51aW5lIGRyaWZ0XG4gKiBzdWZmaXhlZCBieSBpdHMgbG93ZXJjYXNlIHN0YXR1cyB0b2tlbihzKSAoYCBcdTIwMTQgY2hhbmdlZGApLlxuICpcbiAqIEEgZHJpZnQgcm93IG1hdGNoZXMgYW4gYW5jaG9yIGJ5IGV4YWN0IHBhdGgrcmFuZ2UsIG9yIGJ5IHBhdGggYWxvbmUgd2hlbiB0aGVcbiAqIHNwYW4gaGFzIGEgc2luZ2xlIGFuY2hvciBvbiB0aGF0IHBhdGggKHJhbmdlcyBjYW4gZGlzYWdyZWUgYWZ0ZXIgYSBoZWFsKS5cbiAqIGBzb2xlT25QYXRoYCBpcyBkZWxpYmVyYXRlbHkgY29tcHV0ZWQgb3ZlciB0aGUgKipmdWxsIGZsYXQgYW5jaG9yIGxpc3QqKixcbiAqIGJlZm9yZSBhbnkgZ3JvdXBpbmcgXHUyMDE0IHRoZSB0cmVlIGxheW91dCBtdXN0IG5ldmVyIGJlIGFibGUgdG8gY2hhbmdlICp3aGljaCpcbiAqIGFuY2hvcnMgZ2V0IGxhYmVsZWQsIG9ubHkgd2hlcmUgdGhleSBzaXQgb24gdGhlIHBhZ2UuXG4gKi9cbmZ1bmN0aW9uIGFuY2hvckJ1bGxldHMoYW5jaG9yczogUG9yY2VsYWluUm93W10sIGRlYnRSb3dzOiBTdGFsZVBvcmNlbGFpblJvd1tdKTogc3RyaW5nW10ge1xuICBjb25zdCByb3dzID0gYW5jaG9ycy5tYXAoKGFuY2hvcikgPT4ge1xuICAgIGNvbnN0IHNvbGVPblBhdGggPSBhbmNob3JzLmZpbHRlcigoYSkgPT4gYS5wYXRoID09PSBhbmNob3IucGF0aCkubGVuZ3RoID09PSAxO1xuICAgIGNvbnN0IHN0YXR1c2VzID0gbmV3IFNldDxQb3JjZWxhaW5TdGF0dXM+KCk7XG4gICAgZm9yIChjb25zdCByb3cgb2YgZGVidFJvd3MpIHtcbiAgICAgIGlmIChyb3cucGF0aCAhPT0gYW5jaG9yLnBhdGgpIGNvbnRpbnVlO1xuICAgICAgaWYgKHNvbGVPblBhdGggfHwgKHJvdy5zdGFydCA9PT0gYW5jaG9yLnN0YXJ0ICYmIHJvdy5lbmQgPT09IGFuY2hvci5lbmQpKSB7XG4gICAgICAgIHN0YXR1c2VzLmFkZChyb3cuc3RhdHVzKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3Qgc29ydGVkID0gWy4uLnN0YXR1c2VzXS5zb3J0KCk7XG4gICAgY29uc3Qgc3VmZml4ID0gc29ydGVkLmxlbmd0aCA+IDAgPyBgIFx1MjAxNCAke3NvcnRlZC5tYXAoaHVtYW5TdGF0dXNMYWJlbCkuam9pbignLCAnKX1gIDogJyc7XG4gICAgcmV0dXJuIHsgcGF0aDogYW5jaG9yLnBhdGgsIHJhbmdlOiByYW5nZUxhYmVsKGFuY2hvciksIHN1ZmZpeCB9O1xuICB9KTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gcmVuZGVyQW5jaG9yVHJlZShjb2xsYXBzZUJ5UGF0aChyb3dzKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IGRvIG5vdCByZW1vdmUgaXRcbiAgICAvLyBvbiB0aGUgdGhlb3J5IHRoYXQgYSBkZWdyYWRlZCBmYWxsYmFjayBpcyBpdHNlbGYgZm9yYmlkZGVuLiBBbiB1bmNhdWdodFxuICAgIC8vIHRocm93IGhlcmUgZG9lcyBub3QgZGVncmFkZSB0byBhIGZsYXQgbGlzdDogaXQgZXNjYXBlcyB0b1xuICAgIC8vIGBydW5Ub3VjaEhvb2tgJ3MgY2F0Y2gsIHdoaWNoIHJlc29sdmVzIHRoZSB3aG9sZSBob29rIHRvXG4gICAgLy8gYGFkZGl0aW9uYWxDb250ZXh0OiBudWxsYCwgc28gdGhlIGFnZW50IGlzIG5ldmVyIHRvbGQgYWJvdXQgdGhlIGRyaWZ0IGF0XG4gICAgLy8gYWxsLiBDYXRjaGluZyBsb2NhbGx5IG5hcnJvd3Mgd2hhdCBhIHJlbmRlcmluZyBkZWZlY3QgY2FuIGNvc3QgZnJvbSBcInRoZVxuICAgIC8vIHJlbWluZGVyIGRpc2FwcGVhcnNcIiB0byBcInRoZSByZW1pbmRlciBsb29rcyBsaWtlIGl0IGRpZCBiZWZvcmUgdGhlIHRyZWVcIi5cbiAgICAvLyBXaGV0aGVyIHRvIHN1cmZhY2UgYW5kIHdoYXQgc2hhcGUgdG8gc3VyZmFjZSBpbiBhcmUgZGlmZmVyZW50IHRoaW5ncywgYW5kXG4gICAgLy8gdGhpcyBjYXRjaCBvbmx5IGV2ZXIgdG91Y2hlcyB0aGUgbGF0dGVyLlxuICAgIC8vIGByb3dzYCBpcyBpbmRleC1hbGlnbmVkIHdpdGggYGFuY2hvcnNgLCBzbyB0aGlzIHJlcHJvZHVjZXMgdG9kYXkncyBmbGF0XG4gICAgLy8gYnVsbGV0IHJ1biBieXRlIGZvciBieXRlLCBzdWZmaXhlcyBpbmNsdWRlZC5cbiAgICByZXR1cm4gYW5jaG9ycy5tYXAoKGFuY2hvciwgaSkgPT4gYC0gJHthbmNob3JUZXh0KGFuY2hvcil9JHtyb3dzW2ldLnN1ZmZpeH1gKTtcbiAgfVxufVxuXG4vKipcbiAqIE9uZSBodW1hbi1mb3JtYXQgc3BhbiBzZWN0aW9uOiBgIyMgPG5hbWU+YCwgdGhlIGZ1bGwgYW5jaG9yIGxpc3QgKGRyaWZ0ZWRcbiAqIGFuY2hvcnMgc3RhdHVzLXN1ZmZpeGVkKSwgYW5kIHRoZSB3aHkgc2VudGVuY2Ugd2hlbiBvbmUgaXMgcmVjb3JkZWQuXG4gKlxuICogVGhlIG5hbWUgaGVhZGVyIGFuZCB0aGUgd2h5IHNlbnRlbmNlIGFyZSB0aGUgc2FtZSBzaGFwZSBgZ2l0IHNwYW4gbGlzdGBcbiAqIHJlbmRlcnM7IHRoZSBhbmNob3IgbGlzdCBkZWxpYmVyYXRlbHkgaXMgbm90IFx1MjAxNCBpdCByZW5kZXJzIGFzIGEgc2hhcmVkLXByZWZpeFxuICogdHJlZSAoe0BsaW5rIGFuY2hvckJ1bGxldHN9KSB3aGVyZSB0aGUgQ0xJIHByaW50cyBhIGZsYXQgYC0gcGF0aCNMcmFuZ2VgXG4gKiBidWxsZXQgcnVuLiBUaGUgQ0xJJ3Mgb3duIHRleHQgZm9ybWF0IGlzIHVudG91Y2hlZDsgb25seSB0aGlzIGhvb2snc1xuICogcmUtcHJlc2VudGF0aW9uIG9mIGl0IGdyb3Vwcy5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyU3BhblNlY3Rpb24oXG4gIG5hbWU6IHN0cmluZyxcbiAgYW5jaG9yczogUG9yY2VsYWluUm93W10sXG4gIGRlYnRSb3dzOiBTdGFsZVBvcmNlbGFpblJvd1tdLFxuICB3aHk6IHN0cmluZyB8IG51bGxcbik6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gW2AjIyAke25hbWV9YCwgLi4uYW5jaG9yQnVsbGV0cyhhbmNob3JzLCBkZWJ0Um93cyldO1xuICBpZiAod2h5KSBsaW5lcy5wdXNoKCcnLCB3aHkpO1xuICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogQXNzZW1ibGUgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2s6IGhlYWRlciwgb25lIHNlY3Rpb24gcGVyIHN1cmZhY2VkXG4gKiBzcGFuIChzZXBhcmF0ZWQgYnkgYC0tLWApLCBhbmQgYSBzaW5nbGUgZm9vdGVyIGFmdGVyIGEgZmluYWwgYC0tLWAuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkQmxvY2soc2VjdGlvbnM6IHN0cmluZ1tdLCBoZWFkZXI6IHN0cmluZywgZm9vdGVyOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBib2R5ID0gYCR7aGVhZGVyfVxcblxcbiR7c2VjdGlvbnMuam9pbignXFxuXFxuLS0tXFxuXFxuJyl9XFxuXFxuLS0tXFxuXFxuJHtmb290ZXJ9YDtcbiAgcmV0dXJuIGBcXG48Z2l0LXNwYW4+XFxuJHtib2R5fVxcbjwvZ2l0LXNwYW4+XFxuYDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBob29rIGVudHJ5IHBvaW50XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgaW4gc2NvcGUgZm9yIHRoZSByZWNvdmVyZWQgcmFuZ2UuICovXG5mdW5jdGlvbiBpbnRlcnNlY3RzKHJvdzogUG9yY2VsYWluUm93LCByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnKTogYm9vbGVhbiB7XG4gIGlmIChyYW5nZSA9PT0gJ3dob2xlLWZpbGUnKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4gdHJ1ZTsgLy8gd2hvbGUtZmlsZSBhbmNob3JcbiAgcmV0dXJuIHJhbmdlc0ludGVyc2VjdChyYW5nZSwgeyBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfSk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgdG91Y2hlZCByYW5nZSBmcm9tIHRoZSBvbi1kaXNrIGZpbGUgZm9yIGEgd3JpdGUuIEFuIGVtcHR5IHdyaXRlIG9yXG4gKiBhbiB1bnJlYWRhYmxlIGZpbGUgKGUuZy4gYSBkZWxldGUsIG9yIHRoZSBmaWxlIHdhcyBuZXZlciB3cml0dGVuKSBkZWdyYWRlcyB0b1xuICogYCd3aG9sZS1maWxlJ2AsIHNjb3BpbmcgdGhlIHRvdWNoIHRvIGV2ZXJ5IGNvdmVyaW5nIHNwYW4gXHUyMDE0IHRoZSBmYWlsLW9wZW5cbiAqIGJlaGF2aW9yLCBub3QgYW4gZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSYW5nZUZyb21EaXNrKHdyaXR0ZW46IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZyk6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgbGV0IGNvbnRlbnQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICB9XG4gIHJldHVybiByZWNvdmVyUmFuZ2Uod3JpdHRlbiwgY29udGVudCk7XG59XG5cbi8qKlxuICogVGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGRvY3VtZW50ZWQgZGVmYXVsdCBsaW5lIGNvdW50IHdoZW4gYG9mZnNldGAgaXNcbiAqIGdpdmVuIHdpdGhvdXQgYGxpbWl0YCAoXCJCeSBkZWZhdWx0LCBpdCByZWFkcyB1cCB0byAyMDAwIGxpbmVzXCIpLiBOYW1lZCBzb1xuICogdGhlIGFzc3VtcHRpb24gaXMgdmlzaWJsZSBhbmQgZWFzeSB0byB1cGRhdGUgaWYgdGhhdCBkZWZhdWx0IGV2ZXIgY2hhbmdlcy5cbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVBRF9MSU1JVCA9IDIwMDA7XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgdG91Y2hlZCByYW5nZSBmb3IgYSByZWFkIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzXG4gKiBgb2Zmc2V0YC9gbGltaXRgIGlucHV0cy4gTmVpdGhlciBwcmVzZW50IG1lYW5zIGEgZ2VudWluZSB3aG9sZS1maWxlIHJlYWQgXHUyMDE0XG4gKiBldmVyeSBjb3ZlcmluZyBzcGFuIHN0YXlzIGluIHNjb3BlLCBtYXRjaGluZyB0b2RheSdzIGJlaGF2aW9yLiBPdGhlcndpc2VcbiAqIHRoZSByYW5nZSBzdGFydHMgYXQgYG9mZnNldGAgKGRlZmF1bHQgbGluZSAxKSBhbmQgcnVucyBmb3IgYGxpbWl0YCBsaW5lc1xuICogKGRlZmF1bHQge0BsaW5rIERFRkFVTFRfUkVBRF9MSU1JVH0pLCBjbGFtcGVkIHRvIHRoZSBmaWxlJ3MgYWN0dWFsIGxpbmVcbiAqIGNvdW50IHNvIGEgc2hvcnQgZmlsZSB3aXRoIGEgbGFyZ2UgYG9mZnNldGAvYGxpbWl0YCBkb2Vzbid0IG92ZXJzaG9vdC5cbiAqIENsYW1waW5nIHJlcXVpcmVzIHJlYWRpbmcgdGhlIGZpbGU7IGFuIHVucmVhZGFibGUgZmlsZSBkZWdyYWRlcyB0b1xuICogYCd3aG9sZS1maWxlJ2AgXHUyMDE0IHRoZSBzYW1lIGZhaWwtb3BlbiBiZWhhdmlvciB0aGUgd3JpdGUgcGF0aCB1c2VzLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmVhZFJhbmdlKFxuICBvZmZzZXQ6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgbGltaXQ6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgZmlsZVBhdGg6IHN0cmluZ1xuKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkICYmIGxpbWl0ID09PSB1bmRlZmluZWQpIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGNvbnN0IHN0YXJ0ID0gb2Zmc2V0ID8/IDE7XG4gIGxldCBsaW5lQ291bnQ6IG51bWJlcjtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpO1xuICAgIGxpbmVDb3VudCA9IGNvbnRlbnQubGVuZ3RoID09PSAwID8gMCA6IGNvbnRlbnQuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICBjb25zdCBlbmQgPSBNYXRoLm1pbihzdGFydCArIChsaW1pdCA/PyBERUZBVUxUX1JFQURfTElNSVQpIC0gMSwgTWF0aC5tYXgobGluZUNvdW50LCBzdGFydCkpO1xuICByZXR1cm4geyBzdGFydCwgZW5kIH07XG59XG5cbi8qKlxuICogV2hldGhlciBhIGNvdmVyaW5nIHJvdyBpcyBhbiBhbmNob3IgaW4gdGhlIHRvdWNoZWQgZmlsZSBpdHNlbGYuIGBsaXN0XG4gKiAtLXBvcmNlbGFpbiA8ZmlsZT5gIHJldHVybnMgZXZlcnkgYW5jaG9yIG9mIGVhY2ggbWF0Y2hpbmcgc3BhbiBcdTIwMTQgY3Jvc3MtZmlsZVxuICogYW5jaG9ycyBpbmNsdWRlZCBcdTIwMTQgYnV0IG9ubHkgYW5jaG9ycyBpbiB0aGUgdG91Y2hlZCBmaWxlIHBhcnRpY2lwYXRlIGluIHRoZVxuICogcmFuZ2UtaW50ZXJzZWN0aW9uIHNjb3BlIHRlc3QuIFJvdyBwYXRocyBhcmUgcmVwby1yZWxhdGl2ZTsgdGhlIHRvdWNoZWQgcGF0aFxuICogaXMgYWJzb2x1dGUsIHNvIG1hdGNoIG9uIGFuIGV4YWN0IG9yIGAvYC1zZXBhcmF0ZWQgc3VmZml4LlxuICovXG5mdW5jdGlvbiBvblRvdWNoZWRGaWxlKHJvdzogUG9yY2VsYWluUm93LCBmaWxlUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBmaWxlUGF0aCA9PT0gcm93LnBhdGggfHwgZmlsZVBhdGguZW5kc1dpdGgoYC8ke3Jvdy5wYXRofWApO1xufVxuXG4vKipcbiAqIENvbXB1dGUgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgZm9yIHRoZSB0b3VjaCwgb3IgYG51bGxgIHdoZW4gdGhlcmUgaXNcbiAqIG5vdGhpbmcgd29ydGggc3VyZmFjaW5nLiBTaGFyZWQgYnkgYm90aCBwYXRoczsgdGhlIHdyaXRlIHBhdGggcGFzc2VzIGFcbiAqIHJlY292ZXJlZCByYW5nZSBmb3IgcHJlY2lzaW9uLCB0aGUgcmVhZCBwYXRoIHNjb3BlcyBmaWxlLXdpZGUuXG4gKlxuICogQSBzcGFuIHJlbmRlcnMgYXMgYSBmdWxsIGh1bWFuLWZvcm1hdCBzZWN0aW9uIChuYW1lLCBhbGwgYW5jaG9ycyB3aXRoXG4gKiBkcmlmdGVkIG9uZXMgc3RhdHVzLXN1ZmZpeGVkLCB3aHkpIHdoZW4gaXRzIG5hbWUgaGFzIG5vdCBiZWVuIHN1cmZhY2VkIHRoaXNcbiAqIHNlc3Npb24sIG9yIHdoZW4gaXQgY2FycmllcyBhIGRyaWZ0IHN0YXR1cyBub3QgeWV0IHN1cmZhY2VkIGZvciBpdCBcdTIwMTQgc28gYVxuICogc3BhbiBmaXJzdCBzZWVuIGhlYWx0aHkgcmUtcmVuZGVycyBpbiBmdWxsIHdoZW4gZHJpZnQgbGF0ZXIgYXBwZWFycy4gQSBzcGFuXG4gKiB3aG9zZSBvbmx5IGRyaWZ0IGlzIHBvc2l0aW9uYWwgKGBNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBcdTIwMTQgbmV2ZXJcbiAqIGBpc0RlYnRgKSBpcyBmaWx0ZXJlZCBvdXQgZW50aXJlbHk6IHBvc2l0aW9uYWwgZHJpZnQgbmV2ZXIgc3VyZmFjZXMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNvbXB1dGVTdXJmYWNlKFxuICBpbnB1dDogVG91Y2hJbnB1dCxcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlLFxuICByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnXG4pOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgY29uc3QgY292ZXJpbmcgPSBhd2FpdCBleGVjdXRvcnMubGlzdChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgaWYgKGNvdmVyaW5nLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gR3JvdXAgZXZlcnkgYW5jaG9yIGJ5IHNwYW47IGEgc3BhbiBpcyBpbiBzY29wZSB3aGVuIG9uZSBvZiBpdHMgYW5jaG9ycyBvblxuICAvLyB0aGUgdG91Y2hlZCBmaWxlIGludGVyc2VjdHMgdGhlIHJlY292ZXJlZCByYW5nZS5cbiAgY29uc3QgYW5jaG9yc0J5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2YgY292ZXJpbmcpIHtcbiAgICBjb25zdCByb3dzID0gYW5jaG9yc0J5TmFtZS5nZXQocm93Lm5hbWUpID8/IFtdO1xuICAgIHJvd3MucHVzaChyb3cpO1xuICAgIGFuY2hvcnNCeU5hbWUuc2V0KHJvdy5uYW1lLCByb3dzKTtcbiAgfVxuICBjb25zdCB0b3VjaGVkTmFtZXMgPSBbLi4uYW5jaG9yc0J5TmFtZS5rZXlzKCldLmZpbHRlcigobmFtZSkgPT5cbiAgICAoYW5jaG9yc0J5TmFtZS5nZXQobmFtZSkgPz8gW10pLnNvbWUoKHJvdykgPT4gb25Ub3VjaGVkRmlsZShyb3csIGlucHV0LmZpbGVQYXRoKSAmJiBpbnRlcnNlY3RzKHJvdywgcmFuZ2UpKVxuICApO1xuICBpZiAodG91Y2hlZE5hbWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3Qgc3RhbGVSb3dzID0gYXdhaXQgZXhlY3V0b3JzLnN0YWxlKFtpbnB1dC5maWxlUGF0aF0sIGlucHV0LmN3ZCk7XG4gIGNvbnN0IHN0YWxlQnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIFN0YWxlUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHN0YWxlUm93cykge1xuICAgIGNvbnN0IHJvd3MgPSBzdGFsZUJ5TmFtZS5nZXQocm93Lm5hbWUpID8/IFtdO1xuICAgIHJvd3MucHVzaChyb3cpO1xuICAgIHN0YWxlQnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cblxuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoaW5wdXQuc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9SZWNvcmQ6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHNlY3Rpb25zOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBkcmlmdGVkTmFtZXM6IHN0cmluZ1tdID0gW107XG5cbiAgZm9yIChjb25zdCBuYW1lIG9mIHRvdWNoZWROYW1lcykge1xuICAgIGNvbnN0IHNwYW5TdGFsZSA9IHN0YWxlQnlOYW1lLmdldChuYW1lKSA/PyBbXTtcbiAgICBjb25zdCBkZWJ0Um93cyA9IHNwYW5TdGFsZS5maWx0ZXIoKHJvdykgPT4gaXNEZWJ0KHJvdy5zdGF0dXMpKTtcbiAgICBpZiAoc3BhblN0YWxlLmxlbmd0aCA+IDAgJiYgZGVidFJvd3MubGVuZ3RoID09PSAwKSBjb250aW51ZTsgLy8gcG9zaXRpb25hbC1vbmx5IGRyaWZ0IG5ldmVyIHN1cmZhY2VzXG5cbiAgICBjb25zdCBkZWJ0U3RhdHVzZXMgPSBbLi4ubmV3IFNldChkZWJ0Um93cy5tYXAoKHJvdykgPT4gcm93LnN0YXR1cykpXS5zb3J0KCk7XG4gICAgY29uc3QgdW5zdXJmYWNlZERlYnQgPSBkZWJ0U3RhdHVzZXMuZmlsdGVyKChzdGF0dXMpID0+ICFzdXJmYWNlZC5oYXMoZHJpZnRLZXkobmFtZSwgc3RhdHVzKSkpO1xuICAgIGNvbnN0IGlzTmV3TmFtZSA9ICFzdXJmYWNlZC5oYXMobmFtZSk7XG4gICAgaWYgKCFpc05ld05hbWUgJiYgdW5zdXJmYWNlZERlYnQubGVuZ3RoID09PSAwKSBjb250aW51ZTsgLy8gZnVsbHkgc3VyZmFjZWQgYWxyZWFkeVxuXG4gICAgY29uc3Qgd2h5ID0gYXdhaXQgZXhlY3V0b3JzLndoeShuYW1lLCBpbnB1dC5jd2QpO1xuICAgIHNlY3Rpb25zLnB1c2gocmVuZGVyU3BhblNlY3Rpb24obmFtZSwgYW5jaG9yc0J5TmFtZS5nZXQobmFtZSkgPz8gW10sIGRlYnRSb3dzLCB3aHkpKTtcbiAgICBpZiAoZGVidFN0YXR1c2VzLmxlbmd0aCA+IDApIGRyaWZ0ZWROYW1lcy5wdXNoKG5hbWUpO1xuXG4gICAgaWYgKGlzTmV3TmFtZSkgdG9SZWNvcmQucHVzaChuYW1lKTtcbiAgICBmb3IgKGNvbnN0IHN0YXR1cyBvZiB1bnN1cmZhY2VkRGVidCkgdG9SZWNvcmQucHVzaChkcmlmdEtleShuYW1lLCBzdGF0dXMpKTtcbiAgfVxuXG4gIGlmIChzZWN0aW9ucy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBtZW1vLmFkZFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCwgdG9SZWNvcmQpO1xuICBjb25zdCBmaWxlTmFtZSA9IGJhc2VuYW1lKGlucHV0LmZpbGVQYXRoKTtcbiAgY29uc3QgaGVhZGVyID0gZHJpZnRlZE5hbWVzLmxlbmd0aCA+IDAgPyBkcmlmdEhlYWRlcihkcmlmdGVkTmFtZXMubGVuZ3RoLCBpbnB1dC5raW5kKSA6IGNsZWFuSGVhZGVyKGZpbGVOYW1lKTtcbiAgY29uc3QgZm9vdGVyID0gZHJpZnRlZE5hbWVzLmxlbmd0aCA+IDAgPyBkcmlmdEZvb3RlcihkcmlmdGVkTmFtZXMpIDogY2xlYW5Gb290ZXIoZmlsZU5hbWUpO1xuICByZXR1cm4gYnVpbGRCbG9jayhzZWN0aW9ucywgaGVhZGVyLCBmb290ZXIpO1xufVxuXG4vKipcbiAqIFJ1biB0aGUgdG91Y2ggaG9vayBmb3IgYSBzaW5nbGUgdG9vbCBjYWxsLCBicmFuY2hpbmcgb24ge0BsaW5rIFRvdWNoSW5wdXQua2luZH0uXG4gKlxuICogLSAqKldyaXRlIHBhdGgqKjogcnVuIGBleGVjdXRvcnMuZml4YCAoYGdpdCBzcGFuIHN0YWxlIDxmaWxlPiAtLWZpeGApIHNjb3BlZFxuICogICB0byB0aGUgdG91Y2hlZCBmaWxlIHRvIGhlYWwgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlLCB0aGVuXG4gKiAgIGNvbXB1dGUgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgYWdhaW5zdCB0aGUgaGVhbGVkIGFuY2hvcnMsIHJlbmRlcmluZ1xuICogICBlYWNoIHN1cmZhY2VkIHNwYW4gYXMgYSBmdWxsIGh1bWFuLWZvcm1hdCBzZWN0aW9uIHdpdGggYW55IHJlbWFpbmluZ1xuICogICBzZW1hbnRpYyBkcmlmdCBzdGF0dXMtc3VmZml4ZWQgb24gaXRzIGFuY2hvcnMuIENhZGVuY2UgaXMgZGVkdXBlZCB0aHJvdWdoXG4gKiAgIGBtZW1vYCBwZXIgc3BhbiBuYW1lIGFuZCBwZXIgKHNwYW4sIHN0YXR1cykuXG4gKiAtICoqUmVhZCBwYXRoKio6IG5ldmVyIGludm9rZXMgYGZpeGAgYW5kIG5ldmVyIG11dGF0ZXMgdGhlIHRyZWU7IHN1cmZhY2VzIHRoZVxuICogICBzcGFucyBvdmVybGFwcGluZyB0aGUgcmVhZCdzIGBvZmZzZXRgL2BsaW1pdGAgd2luZG93IChzZWVcbiAqICAge0BsaW5rIHJlY292ZXJSZWFkUmFuZ2V9OyBhIHJlYWQgd2l0aCBuZWl0aGVyIGlzIHdob2xlLWZpbGUsIG1hdGNoaW5nXG4gKiAgIHRvZGF5J3MgYmVoYXZpb3IpIHdpdGggcG9zaXRpb25hbCBzdGF0dXNlcyBmaWx0ZXJlZCBvdXQgdmlhIGBpc0RlYnQoKWAuXG4gKlxuICogRmFpbHMgb3BlbjogYW55IGV4ZWN1dG9yIHJlamVjdGlvbiBvciBpbnRlcm5hbCBlcnJvciB5aWVsZHNcbiAqIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAgKG5vIHNpZ25hbCwgZWRpdGluZyBuZXZlciBibG9ja2VkKSByYXRoZXIgdGhhblxuICogdGhyb3dpbmcuIGB0cmVlTW9kaWZpZWRgIHJlZmxlY3RzIGEgc3VjY2Vzc2Z1bCBgLS1maXhgIGV2ZW4gd2hlbiB0aGVcbiAqIHN1YnNlcXVlbnQgc3VyZmFjZSBjb21wdXRhdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRvdWNoSG9vayhcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZVxuKTogUHJvbWlzZTxUb3VjaE91dHB1dD4ge1xuICBsZXQgdHJlZU1vZGlmaWVkID0gZmFsc2U7XG4gIHRyeSB7XG4gICAgbGV0IHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScgPSAnd2hvbGUtZmlsZSc7XG4gICAgaWYgKGlucHV0LmtpbmQgPT09ICd3cml0ZScpIHtcbiAgICAgIGNvbnN0IGZpeCA9IGF3YWl0IGV4ZWN1dG9ycy5maXgoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gICAgICB0cmVlTW9kaWZpZWQgPSBmaXgubW9kaWZpZWQ7XG4gICAgICByYW5nZSA9IHJlY292ZXJSYW5nZUZyb21EaXNrKGlucHV0LndyaXR0ZW4sIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSByZWNvdmVyUmVhZFJhbmdlKGlucHV0Lm9mZnNldCwgaW5wdXQubGltaXQsIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9XG4gICAgY29uc3QgYWRkaXRpb25hbENvbnRleHQgPSBhd2FpdCBjb21wdXRlU3VyZmFjZShpbnB1dCwgZXhlY3V0b3JzLCBtZW1vLCByYW5nZSk7XG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQsIHRyZWVNb2RpZmllZCB9O1xuICB9IGNhdGNoIHtcbiAgICAvLyBGYWlsIG9wZW46IG5ldmVyIGxldCBhIHRvdWNoLWNvcmUgZXJyb3IgcHJvcGFnYXRlIHVwIGFuZCBibG9jayB0aGUgdG9vbFxuICAgIC8vIGNhbGwuIFRoZSB0cmVlIG1heSBhbHJlYWR5IGhhdmUgYmVlbiBoZWFsZWQgKHRyZWVNb2RpZmllZCBwcmVzZXJ2ZWQpLlxuICAgIHJldHVybiB7IGFkZGl0aW9uYWxDb250ZXh0OiBudWxsLCB0cmVlTW9kaWZpZWQgfTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgc3VicHJvY2Vzcy1iYWNrZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gMTBfMDAwO1xuXG4vKiogUmVzb2x2ZSB0aGUgdG91Y2hlZCBmaWxlIHRvIGEgcGF0aCByZWxhdGl2ZSB0byBpdHMgcmVwbyByb290LCBmb3IgYGdpdCBzcGFuYC4gKi9cbmZ1bmN0aW9uIHJlcG9SZWxBcmcoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpOiB7IHJlcG9Sb290OiBzdHJpbmc7IHJlbFBhdGg6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGlmICghcmVwb1Jvb3QpIHJldHVybiBudWxsO1xuICByZXR1cm4geyByZXBvUm9vdCwgcmVsUGF0aDogcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGZpbGVQYXRoKSB9O1xufVxuXG4vKipcbiAqIEEgc25hcHNob3Qgb2YgdGhlIHNwYW4gcm9vdCdzIHdvcmtpbmctdHJlZSBzdGF0dXMsIHVzZWQgdG8gZGV0ZWN0IHdoZXRoZXIgYVxuICogYC0tZml4YCByZS1hbmNob3JlZCBhbnl0aGluZy4gQ29tcGFyZWQgYmVmb3JlL2FmdGVyOyBhbiB1bnJlc29sdmFibGUgcmVwbyBvclxuICogYSBmYWlsZWQgc3RhdHVzIHlpZWxkcyBhIHN0YWJsZSBlbXB0eSBzdHJpbmcgKFx1MjE5MiBgbW9kaWZpZWQ6IGZhbHNlYCkuXG4gKi9cbmZ1bmN0aW9uIHNwYW5TdGF0dXNTbmFwc2hvdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICB0cnkge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3N0YXR1cycsICctLXBvcmNlbGFpbicsICctLScsIHNwYW5Sb290XSwge1xuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgdGltZW91dDogREVGQVVMVF9USU1FT1VUX01TXG4gICAgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBwcm9kdWN0aW9uIGV4ZWN1dGlvbiBzdXJmYWNlOiB0aHJlZSBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnMgZm9sbG93aW5nXG4gKiBzcGFuLXN1cmZhY2UudHMncyBgY3JlYXRlRGVmYXVsdCpFeGVjdXRvcmAgc3R5bGUuIEVhY2ggY2FwdHVyZXMgc3Rkb3V0IGV2ZW4gb25cbiAqIGEgbm9uLXplcm8gZXhpdCB3aGVyZSB0aGUgQ0xJIHN0aWxsIGVtaXRzIHVzZWZ1bCBvdXRwdXQsIGFuZCBldmVyeSBmYWlsdXJlXG4gKiBtb2RlIChhYnNlbnQgYmluYXJ5LCB0aW1lb3V0LCBwYXJzZSBmYWlsdXJlKSBzdXJmYWNlcyBhcyBhbiBlbXB0eS9jbGVhbiByZXN1bHRcbiAqIHNvIHtAbGluayBydW5Ub3VjaEhvb2t9J3MgZmFpbC1vcGVuIGNvbnRyYWN0IGhvbGRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzKHRpbWVvdXRNczogbnVtYmVyID0gREVGQVVMVF9USU1FT1VUX01TKTogVG91Y2hFeGVjdXRvcnMge1xuICByZXR1cm4ge1xuICAgIGZpeDogYXN5bmMgKGZpbGVQYXRoLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVwb1JlbEFyZyhmaWxlUGF0aCwgY3dkKTtcbiAgICAgIGlmICghcmVzb2x2ZWQpIHJldHVybiB7IG1vZGlmaWVkOiBmYWxzZSB9O1xuICAgICAgY29uc3QgYmVmb3JlID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgcmVzb2x2ZWQucmVsUGF0aCwgJy0tZml4J10sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBgZ2l0IHNwYW4gc3RhbGVgIGV4aXRzIDEgb24gZHJpZnQgZXZlbiB3aGVuIGAtLWZpeGAgaGVhbGVkIHNvbWV0aGluZyxcbiAgICAgICAgLy8gYW5kIG5vbi16ZXJvIG9uIGdlbnVpbmUgZmFpbHVyZTsgdGhlIHNuYXBzaG90IGRpZmYgaXMgdGhlIHNvdXJjZSBvZlxuICAgICAgICAvLyB0cnV0aCBmb3Igd2hldGhlciB0aGUgdHJlZSBjaGFuZ2VkLCBzbyB0aGUgZXhpdCBjb2RlIGlzIGlnbm9yZWQgaGVyZS5cbiAgICAgIH1cbiAgICAgIGNvbnN0IGFmdGVyID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHJldHVybiB7IG1vZGlmaWVkOiBiZWZvcmUgIT09IGFmdGVyIH07XG4gICAgfSxcblxuICAgIGxpc3Q6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4gW107XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgcmVzb2x2ZWQucmVsUGF0aF0sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBzdGFsZTogYXN5bmMgKGFyZ3MsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGNvbnN0IHJ1bkN3ZCA9IHJlcG9Sb290ID8/IGN3ZDtcbiAgICAgIC8vIFRoZSBjb3JlIHBhc3NlcyBhbiBhYnNvbHV0ZSBmaWxlIHBhdGg7IHNjb3BlIGBnaXQgc3BhbiBzdGFsZWAgdG8gaXRcbiAgICAgIC8vIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3Qgc28gdGhlIHBhdGggaW5kZXggcmVzb2x2ZXMgaXQuXG4gICAgICBjb25zdCBzY29wZWQgPSByZXBvUm9vdCA/IGFyZ3MubWFwKChhKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYSkpIDogYXJncztcbiAgICAgIGxldCBvdXQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNjb3BlZF0sIHtcbiAgICAgICAgICBjd2Q6IHJ1bkN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgaWYgKHR5cGVvZiBjYXB0dXJlZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICBvdXQgPSBjYXB0dXJlZDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZVN0YWxlUG9yY2VsYWluKG91dCk7XG4gICAgfSxcblxuICAgIHdoeTogYXN5bmMgKG5hbWUsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3doeScsIG5hbWVdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCA/PyBjd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB0ZXh0ID0gb3V0LnRyaW1FbmQoKTtcbiAgICAgICAgLy8gQmFyZSBgZ2l0IHNwYW4gd2h5YCBwcmludHMgdGhpcyBleGFjdCBzZW50aW5lbCAoZXhpdCAwKSB3aGVuIHRoZVxuICAgICAgICAvLyBzcGFuIGhhcyBubyB3aHkgcmVjb3JkZWQgXHUyMDE0IHRyZWF0IGl0IGFzIFwibm8gd2h5XCIsIG5vdCBhcyBjb250ZW50LlxuICAgICAgICBpZiAodGV4dC5sZW5ndGggPT09IDAgfHwgdGV4dCA9PT0gYFxcYCR7bmFtZX1cXGAgaGFzIG5vIHdoeSByZWNvcmRlZC5gKSByZXR1cm4gbnVsbDtcbiAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGJveC1kcmF3aW5nIHRyZWUgcmVuZGVyZXIgZm9yIGEgc3BhbidzIGFuY2hvciBsaXN0LCB1c2VkIGJ5IGV2ZXJ5XG4gKiBjYWxsIHNpdGUgdGhhdCB0b2RheSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHN0YXJ0LUxlbmRgIGJ1bGxldCBydW5cbiAqIChgdG91Y2gtY29yZS50c2AncyBgYW5jaG9yQnVsbGV0c2AsIGFuZCBgYWR2aXNvci1jb3JlLnRzYCdzXG4gKiBgYW5ub3RhdGVCbG9ja3NgL2Bncm91cENvdmVyaW5nQnlOYW1lYCkuIEFuY2hvcnMgdGhhdCBzaGFyZSBhIGRpcmVjdG9yeVxuICogcHJlZml4IGNvbGxhcHNlIGludG8gb25lIHRyZWUgaW5zdGVhZCBvZiBiZWluZyByZWNvbnN0cnVjdGVkIGJ5IGV5ZSBmcm9tIGFcbiAqIGZsYXQgbGlzdCBcdTIwMTQgdGhlIG1vdGl2YXRpbmcgY2FzZSBpcyBwYXJpdHkgYW5jaG9ycyB1bmRlciBwYXJhbGxlbFxuICogYHB1YmxpYy9jbGF1ZGUvLi4uYC9gcHVibGljL2NvZGV4Ly4uLmAgdHJlZXMuXG4gKlxuICogVGhpcyBtb2R1bGUgaXMgYSBwdXJlIHByZXNlbnRhdGlvbiB0cmFuc2Zvcm06IGl0IG5ldmVyIGNvbXB1dGVzIGRyaWZ0XG4gKiBzdGF0dXMgb3IgZGVjaWRlcyB3aGljaCBhbmNob3JzIGFyZSBzdXJmYWNlZC4gQ2FsbGVycyBwcmVjb21wdXRlIGVhY2ggcm93J3NcbiAqIGBzdWZmaXhgIChlLmcuIGAgXHUyMDE0IGNoYW5nZWRgKSBleGFjdGx5IGFzIHRoZXkgZG8gdG9kYXksIGFuZCBvbmx5IHRoZSAqc2hhcGUqXG4gKiBvZiB0aGUgcHJpbnRlZCBsaXN0IGNoYW5nZXMuXG4gKi9cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgdHlwZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEhvdyBhIHNpbmdsZSBhbmNob3IncyBsaW5lIHJhbmdlIGlzIGtub3duLiBgcmFuZ2VgIGFuZCBgd2hvbGUtZmlsZWAgYXJlIHRoZVxuICogdHdvIHNoYXBlcyBldmVyeSBhbmNob3IgdGFrZXMgdG9kYXk7IGB0cnVuY2F0ZWRgIGlzIGEgZGVmZW5zaXZlIHRoaXJkIHNoYXBlXG4gKiByZWFjaGFibGUgb25seSBmcm9tIHJlLXBhcnNpbmcgdGhlIENMSSdzIGZsYXQgaHVtYW4tZm9ybWF0IHRleHQgKGEgYCNMYFxuICogZnJhZ21lbnQgdGhhdCBkb2Vzbid0IGNsZWFubHkgbWF0Y2ggYCNMc3RhcnQtTGVuZGApLlxuICpcbiAqIFZlcmlmaWVkIGludmFyaWFudDogdGhlIHN0cnVjdHVyZWQtZGF0YSBjYWxsIHNpdGVzIGNhbiBuZXZlciBwcm9kdWNlXG4gKiBgdHJ1bmNhdGVkYC4gYHBhcnNlUG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSBgY29udGludWVgcyBwYXN0IGFueVxuICogcm93IG1pc3NpbmcgYSB2YWxpZCByYW5nZSwgc28gYW4gaW5jb21wbGV0ZSBgUG9yY2VsYWluUm93YCBjYW4gbmV2ZXIgYmVcbiAqIGNvbnN0cnVjdGVkOyB0aGUgUnVzdCBDTEkncyBvd24gcG9yY2VsYWluIHdyaXRlciBhbHdheXMgZW1pdHMgYSByYW5nZVxuICogY29sdW1uIChgMC0wYCBmb3Igd2hvbGUtZmlsZSkuIGB0cnVuY2F0ZWRgIGlzIHJlYWNoYWJsZSBvbmx5IGZyb21cbiAqIGBhbm5vdGF0ZUJsb2Nrc2AnIGZsYXQtdGV4dCBwYXJzaW5nIG9mIGBibG9ja3NUZXh0YCBpbiBhIGxhdGVyIHBoYXNlLlxuICovXG5leHBvcnQgdHlwZSBSYW5nZUxhYmVsID0geyBraW5kOiAncmFuZ2UnOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgeyBraW5kOiAnd2hvbGUtZmlsZScgfSB8IHsga2luZDogJ3RydW5jYXRlZCcgfTtcblxuLyoqIE9uZSBzdGFja2VkIHJhbmdlIHVuZGVyIGEgYFRyZWVBbmNob3JgLCB3aXRoIGl0cyBwcmVjb21wdXRlZCBkcmlmdCBzdWZmaXguICovXG5leHBvcnQgaW50ZXJmYWNlIFJhbmdlRW50cnkge1xuICByYW5nZTogUmFuZ2VMYWJlbDtcbiAgLyoqIFByZWNvbXB1dGVkIGAgXHUyMDE0IGNoYW5nZWRgIChldGMuKSwgb3IgYCcnYCB3aGVuIHRoZSBhbmNob3IgY2FycmllcyBubyBkcmlmdC4gKi9cbiAgc3VmZml4OiBzdHJpbmc7XG59XG5cbi8qKiBPbmUgZGlzdGluY3QgcGF0aCdzIGNvbGxhcHNlZCBhbmNob3IgZW50cnksIHJlYWR5IGZvciB0cmVlIGxheW91dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVHJlZUFuY2hvciB7XG4gIC8qKiBSZXBvLXJlbGF0aXZlLCBwb3NpeC1zZXBhcmF0ZWQgcGF0aC4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogU3RhY2tlZCByYW5nZXMgb24gdGhpcyBwYXRoLiBFbXB0eSBtZWFucyBcInBhdGggb25seSwgbm8gcmFuZ2UgY29sdW1uIGF0XG4gICAqIGFsbFwiIFx1MjAxNCBhIGJhcmUtcGF0aCBsZWFmLCBkaXN0aW5jdCBmcm9tIGEgc2luZ2xlIGB3aG9sZS1maWxlYCBlbnRyeSAod2hpY2hcbiAgICogcmVuZGVycyB0aGUgcGF0aCB0b28sIGJ1dCBpcyBhbiBleHBsaWNpdCByYW5nZS1raW5kIGNsYXNzaWZpY2F0aW9uKS5cbiAgICovXG4gIHJhbmdlczogUmFuZ2VFbnRyeVtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGNvbGxhcHNlQnlQYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDb2xsYXBzZSByb3dzIHRoYXQgbmFtZSB0aGUgc2FtZSBwYXRoIGludG8gb25lIGBUcmVlQW5jaG9yYCB3aXRoIHN0YWNrZWRcbiAqIHJhbmdlcywgcHJlc2VydmluZyBmaXJzdC1zZWVuIG9yZGVyLiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlc1xuICogYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlciBkaXN0aW5jdCBwYXRoIFx1MjAxNCB0aGlzIGlzIHRoZSBtYW5kYXRvcnlcbiAqIHByZS1wcm9jZXNzaW5nIHN0ZXAgZXZlcnkgY2FsbGVyIHJ1bnMgZmlyc3QgdG8gZ3VhcmFudGVlIHRoYXQuXG4gKlxuICogTWlycm9ycyB0aGUgb3JkZXItYXJyYXktcGx1cy1NYXAgaWRpb20gYWxyZWFkeSB1c2VkIGJ5XG4gKiBgZGVkdXBlQnlBbmNob3IoKWAgKGFkdmlzb3ItY29yZS50cykgZm9yIHRoZSBzYW1lIHJlYXNvbjogdGhlIENMSSBjYW4gZW1pdFxuICogbXVsdGlwbGUgcm93cyBmb3Igb25lIGxvZ2ljYWwgcGF0aCwgYW5kIHRoZSAqcG9zaXRpb24qIG9mIGEgbGF0ZXJcbiAqIHNhbWUtcGF0aCByb3cgaXMgc3Vic3VtZWQgaW50byB0aGF0IHBhdGgncyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgYXBwZW5kZWRcbiAqIGF0IGl0cyBvd24gbGF0ZXIgcG9zaXRpb24uIENvbmNyZXRlbHk6IGBhLnRzI0wxLUw1YCwgYGIudHMjTDEtTDVgLFxuICogYGEudHMjTDktTDEyYCBjb2xsYXBzZXMgdG8gYFthLnRzICh0d28gc3RhY2tlZCByYW5nZXMpLCBiLnRzIChvbmUgcmFuZ2UpXWBcbiAqIFx1MjAxNCBgYS50c2Agc2l0cyBhdCBwb3NpdGlvbiAwLCBpdHMgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGl0cyBsYXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29sbGFwc2VCeVBhdGgocm93czogeyBwYXRoOiBzdHJpbmc7IHJhbmdlOiBSYW5nZUxhYmVsOyBzdWZmaXg6IHN0cmluZyB9W10pOiBUcmVlQW5jaG9yW10ge1xuICBjb25zdCBvcmRlcjogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgYnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIFRyZWVBbmNob3I+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBsZXQgYW5jaG9yID0gYnlQYXRoLmdldChyb3cucGF0aCk7XG4gICAgaWYgKCFhbmNob3IpIHtcbiAgICAgIGFuY2hvciA9IHsgcGF0aDogcm93LnBhdGgsIHJhbmdlczogW10gfTtcbiAgICAgIGJ5UGF0aC5zZXQocm93LnBhdGgsIGFuY2hvcik7XG4gICAgICBvcmRlci5wdXNoKHJvdy5wYXRoKTtcbiAgICB9XG4gICAgYW5jaG9yLnJhbmdlcy5wdXNoKHsgcmFuZ2U6IHJvdy5yYW5nZSwgc3VmZml4OiByb3cuc3VmZml4IH0pO1xuICB9XG4gIHJldHVybiBvcmRlci5tYXAoKHBhdGgpID0+IGJ5UGF0aC5nZXQocGF0aCkgYXMgVHJlZUFuY2hvcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVHJlZSBjb25zdHJ1Y3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgTGVhZk5vZGUge1xuICBraW5kOiAnbGVhZic7XG4gIG5hbWU6IHN0cmluZztcbiAgYW5jaG9yOiBUcmVlQW5jaG9yO1xufVxuXG5pbnRlcmZhY2UgRGlyTm9kZSB7XG4gIGtpbmQ6ICdkaXInO1xuICBuYW1lOiBzdHJpbmc7XG4gIGNoaWxkcmVuOiBQYXRoVHJlZU5vZGVbXTtcbn1cblxudHlwZSBQYXRoVHJlZU5vZGUgPSBMZWFmTm9kZSB8IERpck5vZGU7XG5cbi8qKlxuICogU3BsaXQgYSBwYXRoIGludG8gYC9gLXNlcGFyYXRlZCBzZWdtZW50cywgb3IgYG51bGxgIHdoZW4gZG9pbmcgc28gd291bGRcbiAqIGZlZWQgYW4gZW1wdHktc3RyaW5nIHNlZ21lbnQgaW50byB0aGUgdHJpZSAoYSBsZWFkaW5nIGAvYCwgYSB0cmFpbGluZyBgL2AsXG4gKiBhIGRvdWJsZWQgYC8vYCwgb3IgdGhlIGVtcHR5IHN0cmluZykuIGBudWxsYCBzaWduYWxzIHRoZSBjYWxsZXIgdG8gcmVuZGVyXG4gKiB0aGF0IGFuY2hvcidzIGZ1bGwgcGF0aCBzdHJpbmcgYXMgYSBzaW5nbGUsIHVuc3BsaXQsIGF0b21pYyB0b3AtbGV2ZWwgbGVhZlxuICogaW5zdGVhZCBvZiBhdHRlbXB0aW5nIHRvIG5lc3QgaXQgXHUyMDE0IGEga25vd24tZW51bWVyYWJsZSBjbGFzcyBvZiBtYWxmb3JtZWRcbiAqIHBhdGhzIGdldHMgYSByZWFsIHJ1bGUgaGVyZSByYXRoZXIgdGhhbiB0aGUgc3BsaXQgcnVubmluZyBhbnl3YXkgYW5kXG4gKiBmYWJyaWNhdGluZyBhbiBlbXB0eS1uYW1lZCBkaXJlY3Rvcnkgbm9kZS4gQSBiYXJlIGZpbGVuYW1lIHdpdGggbm8gYC9gIGF0XG4gKiBhbGwgcHJvZHVjZXMgZXhhY3RseSBvbmUgbm9uLWVtcHR5IHNlZ21lbnQgYW5kIGlzIGhhbmRsZWQgYnkgdGhlIG9yZGluYXJ5XG4gKiBwYXRoIGJlbG93IChpdCBiZWNvbWVzIGEgdG9wLWxldmVsIGxlYWYgd2l0aCBubyBkaXJlY3RvcnkgdG8gbmVzdCB1bmRlciBcdTIwMTRcbiAqIGFscmVhZHkgYXRvbWljLCBubyBzcGVjaWFsIGNhc2UgbmVlZGVkKS5cbiAqL1xuZnVuY3Rpb24gc3BsaXRTZWdtZW50cyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBzZWdtZW50cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IHNlZ21lbnQubGVuZ3RoID09PSAwKSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBzZWdtZW50cztcbn1cblxuZnVuY3Rpb24gZmluZE9yQ3JlYXRlRGlyKHBhcmVudDogRGlyTm9kZSwgbmFtZTogc3RyaW5nKTogRGlyTm9kZSB7XG4gIGZvciAoY29uc3QgY2hpbGQgb2YgcGFyZW50LmNoaWxkcmVuKSB7XG4gICAgaWYgKGNoaWxkLmtpbmQgPT09ICdkaXInICYmIGNoaWxkLm5hbWUgPT09IG5hbWUpIHJldHVybiBjaGlsZDtcbiAgfVxuICBjb25zdCBub2RlOiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZSwgY2hpbGRyZW46IFtdIH07XG4gIHBhcmVudC5jaGlsZHJlbi5wdXNoKG5vZGUpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuLyoqIEluc2VydCBvbmUgYW5jaG9yIGludG8gdGhlIHRyaWUsIGNyZWF0aW5nL3JldXNpbmcgZGlyZWN0b3J5IG5vZGVzIGluIGFycml2YWwgb3JkZXIuICovXG5mdW5jdGlvbiBpbnNlcnRBbmNob3Iocm9vdDogRGlyTm9kZSwgc2VnbWVudHM6IHN0cmluZ1tdLCBhbmNob3I6IFRyZWVBbmNob3IpOiB2b2lkIHtcbiAgbGV0IGN1ciA9IHJvb3Q7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgY3VyID0gZmluZE9yQ3JlYXRlRGlyKGN1ciwgc2VnbWVudHNbaV0pO1xuICB9XG4gIGN1ci5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXSwgYW5jaG9yIH0pO1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSB0b3AtbGV2ZWwgZm9yZXN0IGZyb20gYSBgVHJlZUFuY2hvcltdYCBhbHJlYWR5IGNvbGxhcHNlZCBieVxuICogYGNvbGxhcHNlQnlQYXRoYC4gU2libGluZyBvcmRlciBpcyBuZXZlciByZS1zb3J0ZWQgXHUyMDE0IGEgcGF0aCBlaXRoZXIgb3BlbnMgYVxuICogbmV3IG5vZGUgYXQgaXRzIGFycml2YWwgcG9zaXRpb24gb3IgaXMgbmVzdGVkIHVuZGVyIGEgZGlyZWN0b3J5IG5vZGVcbiAqIGNyZWF0ZWQvcmV1c2VkIGF0IHRoYXQgZGlyZWN0b3J5J3Mgb3duIGZpcnN0LW9jY3VycmVuY2UgcG9zaXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRm9yZXN0KGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IFBhdGhUcmVlTm9kZVtdIHtcbiAgY29uc3Qgcm9vdDogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWU6ICcnLCBjaGlsZHJlbjogW10gfTtcbiAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgIGNvbnN0IHNlZ21lbnRzID0gc3BsaXRTZWdtZW50cyhhbmNob3IucGF0aCk7XG4gICAgaWYgKHNlZ21lbnRzID09PSBudWxsKSB7XG4gICAgICByb290LmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IGFuY2hvci5wYXRoLCBhbmNob3IgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaW5zZXJ0QW5jaG9yKHJvb3QsIHNlZ21lbnRzLCBhbmNob3IpO1xuICB9XG4gIHJldHVybiByb290LmNoaWxkcmVuO1xufVxuXG4vKiogQSBub2RlIHBhaXJlZCB3aXRoIHRoZSAocG9zc2libHkgZm9sZGVkKSBuYW1lIGl0IGRpc3BsYXlzIG9uIGl0cyBvd24gbGluZS4gKi9cbmludGVyZmFjZSBEaXNwbGF5SXRlbSB7XG4gIG5hbWU6IHN0cmluZztcbiAgbm9kZTogUGF0aFRyZWVOb2RlO1xufVxuXG4vKipcbiAqIEZvbGQgYSBjaGFpbiBvZiBzaW5nbGUtY2hpbGQgbm9kZXMgaW50byBvbmUgY29tYmluZWQgbmFtZVxuICogKGBwdWJsaWMvY2xhdWRlL3J1bnRpbWUvc2tpbGxzL2NhcmRgLCBgZGlydHkvbW9kLnJzYCxcbiAqIGAuZGV2Y29udGFpbmVyL0RvY2tlcmZpbGVgKS4gRm9sZGluZyBjb250aW51ZXMgd2hpbGUgdGhlIGN1cnJlbnQgbm9kZSBpcyBhXG4gKiBkaXJlY3Rvcnkgd2l0aCAqKmV4YWN0bHkgb25lIGNoaWxkKiosIHJlZ2FyZGxlc3Mgb2Ygd2hldGhlciB0aGF0IGNoaWxkIGlzIGFcbiAqIGRpcmVjdG9yeSBvciBhIGxlYWY6IGEgbm9kZSB3aXRoIG9uZSBjaGlsZCBjb252ZXlzIG5vIGdyb3VwaW5nIGJ5XG4gKiBkZWZpbml0aW9uLCBzbyBmb2xkaW5nIGl0IGxvc2VzIG5vIHN0cnVjdHVyZSB3aGlsZSByZW1vdmluZyBhIGxpbmUgd2hvc2VcbiAqIG9ubHkgY29udGVudCBpcyBhIGNvbm5lY3Rvci4gU3RvcHMgYXQgdGhlIGZpcnN0IGRpcmVjdG9yeSB3aXRoIDIrIGNoaWxkcmVuXG4gKiAoZXhwYW5kIGZyb20gdGhlcmUpIG9yIGF0IGEgbGVhZiAod2hpY2ggdGhlbiByZW5kZXJzIHdpdGggdGhlIGZvbGRlZCBuYW1lKS5cbiAqXG4gKiBGb2xkaW5nIGxvbmUgKmxlYXZlcyogXHUyMDE0IG5vdCBqdXN0IGxvbmUgZGlyZWN0b3JpZXMgXHUyMDE0IGlzIHdoYXQga2VlcHMgdGhlIHRyZWVcbiAqIG5vIHRhbGxlciB0aGFuIHRoZSBmbGF0IGJ1bGxldCBsaXN0IGl0IHJlcGxhY2VzLCBhbmQgd2hhdCBtYWtlcyBhIHNpbmdsZVxuICogYW5jaG9yIHJlbmRlciBhcyB0aGUgb25lLWxpbmUgdHJlZSB0aGUgcGxhbiBwcm9taXNlcyBldmVuIHdoZW4gaXRzIHBhdGggaGFzXG4gKiBkaXJlY3RvcmllcyBpbiBpdC4gSXQgYWxzbyBrZWVwcyB0aGUgZGlzY3JpbWluYXRpbmcgc2VnbWVudCBvbiB0aGUgc2FtZVxuICogbGluZSBhcyBpdHMgcmFuZ2UgKGBkaXJ0eS9tb2QucnMgI0wzOTItTDM5OWApIGZvciBgbW9kLnJzYC9gaW5kZXgudHNgXG4gKiBsYXlvdXRzLCB3aGVyZSB0aGUgZmlsZW5hbWUgYWxvbmUgaWRlbnRpZmllcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBmb2xkQ2hhaW4obm9kZTogUGF0aFRyZWVOb2RlKTogRGlzcGxheUl0ZW0ge1xuICBsZXQgbmFtZSA9IG5vZGUubmFtZTtcbiAgbGV0IGN1ciA9IG5vZGU7XG4gIHdoaWxlIChjdXIua2luZCA9PT0gJ2RpcicgJiYgY3VyLmNoaWxkcmVuLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IGNoaWxkID0gY3VyLmNoaWxkcmVuWzBdO1xuICAgIG5hbWUgPSBgJHtuYW1lfS8ke2NoaWxkLm5hbWV9YDtcbiAgICBjdXIgPSBjaGlsZDtcbiAgfVxuICByZXR1cm4geyBuYW1lLCBub2RlOiBjdXIgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJhbmsgb2YgYSBzdGFja2VkIGVudHJ5J3MgcmFuZ2Uga2luZDogYHdob2xlLWZpbGVgIGZpcnN0LCB0aGVuIG51bWVyaWNcbiAqIGByYW5nZWBzLCB0aGVuIGB0cnVuY2F0ZWRgLiBBIHdob2xlLWZpbGUgYW5jaG9yIGlzIHRoZSBDTEkncyBgMC0wYCByb3cgXHUyMDE0IGl0XG4gKiBjb3ZlcnMgdGhlIGVudGlyZSBmaWxlLCBzbyBpdCBzb3J0cyBhaGVhZCBvZiBldmVyeSBsaW5lIHJhbmdlIG9uIHRoYXQgZmlsZVxuICogdGhlIHNhbWUgd2F5IGxpbmUgMCB3b3VsZC4gYHRydW5jYXRlZGAgY2FycmllcyBubyBwb3NpdGlvbiBhdCBhbGwgYW5kIHNvcnRzXG4gKiBsYXN0LlxuICovXG5mdW5jdGlvbiByYW5nZVJhbmsocmFuZ2U6IFJhbmdlTGFiZWwpOiBudW1iZXIge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiAwO1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiAxO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gMjtcbiAgfVxufVxuXG4vKipcbiAqIFN0YWNrZWQtcmFuZ2Ugb3JkZXIgaXMgYnkga2luZCByYW5rIHRoZW4gbnVtZXJpYyAoYHN0YXJ0YCB0aGVuIGBlbmRgKSxcbiAqIG92ZXJyaWRpbmcgYXJyaXZhbCBvciBjb2RlcG9pbnQgb3JkZXIgXHUyMDE0IHRoZSBvbmx5IHNvcnRpbmcgdGhpcyBtb2R1bGUgZG9lcyxcbiAqIGFuZCBzY29wZWQgc3RyaWN0bHkgdG8gcmFuZ2VzIHN0YWNrZWQgb24gb25lIHBhdGggKG5ldmVyIHRvIHNpYmxpbmcgcGF0aHNcbiAqIG9yIGRpcmVjdG9yeSBvcmRlcikuIEVxdWFsLXJhbmtlZCBlbnRyaWVzICh0d28gYHRydW5jYXRlZGBzLCBvciB0d29cbiAqIGlkZW50aWNhbCByYW5nZXMpIGtlZXAgdGhlaXIgb3duIHJlbGF0aXZlIGFycml2YWwgb3JkZXIsIHNpbmNlIHRoZSBzb3J0IGlzXG4gKiBzdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGNvbXBhcmVSYW5nZUVudHJpZXMoYTogUmFuZ2VFbnRyeSwgYjogUmFuZ2VFbnRyeSk6IG51bWJlciB7XG4gIGNvbnN0IHJhbmsgPSByYW5nZVJhbmsoYS5yYW5nZSkgLSByYW5nZVJhbmsoYi5yYW5nZSk7XG4gIGlmIChyYW5rICE9PSAwKSByZXR1cm4gcmFuaztcbiAgaWYgKGEucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJyAmJiBiLnJhbmdlLmtpbmQgPT09ICdyYW5nZScpIHtcbiAgICByZXR1cm4gYS5yYW5nZS5zdGFydCAtIGIucmFuZ2Uuc3RhcnQgfHwgYS5yYW5nZS5lbmQgLSBiLnJhbmdlLmVuZDtcbiAgfVxuICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBUaGUgcmFuZ2UgY29sdW1uJ3MgdGV4dCwgb3IgYG51bGxgIHdoZW4gdGhlIGVudHJ5IHByaW50cyBhcyBhIGJhcmUgcGF0aFxuICogd2l0aCBubyByYW5nZSBjb2x1bW4gYXQgYWxsLlxuICpcbiAqIEEgYHdob2xlLWZpbGVgIGVudHJ5IGlzIHRoZSBvbmUga2luZCB3aG9zZSByZW5kZXJpbmcgZGVwZW5kcyBvbiBjb250ZXh0LlxuICogQWxvbmUgb24gaXRzIHBhdGggaXQgc3RheXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciBcdTIwMTQgdGhhdCBpcyB3aGF0IHRoZVxuICogQ0xJJ3Mgb3duIGZsYXQgbGlzdCBwcmludHMgZm9yIGEgd2hvbGUtZmlsZSBhbmNob3IsIGFuZCBhZGRpbmcgYSBtYXJrZXJcbiAqIHRoZXJlIHdvdWxkIGFubm90YXRlIHRoZSBvdmVyd2hlbG1pbmdseSBjb21tb24gY2FzZSBmb3IgdGhlIGJlbmVmaXQgb2YgdGhlXG4gKiByYXJlIG9uZS4gKlN0YWNrZWQqIGJlaGluZCBvdGhlciByYW5nZXMgb24gdGhlIHNhbWUgcGF0aCBpdCBtdXN0IGNhcnJ5IGFuXG4gKiBleHBsaWNpdCBtYXJrZXI6IHdpdGhvdXQgb25lIGl0IHJlbmRlcnMgYXMgYSBjb250aW51YXRpb24gbGluZSBob2xkaW5nXG4gKiBub3RoaW5nIGJ1dCBpbmRlbnRhdGlvbiBhbmQgaXRzIGRyaWZ0IHN1ZmZpeCwgd2hpY2ggZXJhc2VzIHRoZSBhbmNob3JcbiAqIG91dHJpZ2h0IHdoZW4gdGhlIHN1ZmZpeCBpcyBlbXB0eSBhbmQgXHUyMDE0IHdvcnNlIFx1MjAxNCBoYW5ncyBpdHMgYCBcdTIwMTQgY2hhbmdlZGBcbiAqIHVuZGVyIGEgbmVpZ2hib3VyaW5nIHJhbmdlLCBleGFjdGx5IHRoZSB2aXN1YWwgZ3JhbW1hciB0aGF0IG1lYW5zIFwiYW5vdGhlclxuICogcmFuZ2Ugb24gdGhpcyBzYW1lIGZpbGVcIi4gVGhlIHJlYWRlciB3b3VsZCB0aGVuIHJlY29uY2lsZSB0aGUgcmFuZ2UgdGhhdFxuICogZGlkIG5vdCBkcmlmdC4gT2YgdGhlIHRocmVlIGZpeGVzIGF2YWlsYWJsZSAocHJpbnQgdGhlIHBhdGggb25cbiAqIGNvbnRpbnVhdGlvbiBsaW5lcywgc29ydCB3aG9sZS1maWxlIHRvIHBvc2l0aW9uIDAsIG9yIHNwbGl0IGl0IGludG8gaXRzIG93blxuICogbGVhZiksIGFuIGV4cGxpY2l0IG1hcmtlciBpcyB0aGUgb25seSBvbmUgdGhhdCBtYWtlcyB0aGUgZW50cnkgaWRlbnRpZmlhYmxlXG4gKiBpbiAqZXZlcnkqIHBvc2l0aW9uIHJhdGhlciB0aGFuIG9ubHkgaW4gdGhlIHBvc2l0aW9uIHRoZSBzb3J0IGhhcHBlbnMgdG9cbiAqIHB1dCBpdCBpbjsgc29ydGluZyBpdCBmaXJzdCAoc2VlIHtAbGluayByYW5nZVJhbmt9KSBpcyBrZXB0IGFzIHdlbGwgYmVjYXVzZVxuICogXCJ3aG9sZSBmaWxlLCB0aGVuIGl0cyByYW5nZXMgaW4gbGluZSBvcmRlclwiIGlzIHRoZSBvcmRlciBhIHJlYWRlciBleHBlY3RzLFxuICogbm90IGJlY2F1c2UgaWRlbnRpZmlhYmlsaXR5IGRlcGVuZHMgb24gaXQuXG4gKi9cbmZ1bmN0aW9uIGxhYmVsRm9yKHJhbmdlOiBSYW5nZUxhYmVsLCBzb2xlOiBib29sZWFuKTogc3RyaW5nIHwgbnVsbCB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiBgI0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiBzb2xlID8gbnVsbCA6ICcod2hvbGUgZmlsZSknO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gJyh0cnVuY2F0ZWQgaW4gc291cmNlIFx1MjAxNCBhbmNob3IgaW5jb21wbGV0ZSknO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29sdW1uIG1hdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBncmFwaGVtZSBzZWdtZW50ZXIsIGNvbnN0cnVjdGVkIG9uIGZpcnN0IHVzZSBhbmQgdGhlbiBjYWNoZWQgXHUyMDE0IGluY2x1ZGluZ1xuICogYSBjYWNoZWQgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIGNvbnN0cnVjdGVkIGF0IGFsbC5cbiAqXG4gKiBMYXp5IG9uIHB1cnBvc2UuIGBJbnRsYCBpcyBub3QgcGFydCBvZiB0aGUgSmF2YVNjcmlwdCBsYW5ndWFnZSBjb3JlOiBhIE5vZGVcbiAqIGJ1aWx0IGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCB3aGF0c29ldmVyLCBhbmQgYGhvb2tzLmpzb25gXG4gKiBpbnZva2VzIGEgYmFyZSBgbm9kZWAgb2ZmIHRoZSB1c2VyJ3MgYFBBVEhgLCBzbyBgZW5naW5lcy5ub2RlYCBjb25zdHJhaW5zXG4gKiBub3RoaW5nIGhlcmUuIENvbnN0cnVjdGluZyB0aGlzIGF0IG1vZHVsZSBzY29wZSBwdXQgYSBgUmVmZXJlbmNlRXJyb3JgIGluXG4gKiB0aGUgYnVuZGxlcycgdG9wLWxldmVsIHN0YXRlbWVudHMsIHdoZXJlIGl0IHRocm93cyBhdCAqaW1wb3J0KiBcdTIwMTQgYmVmb3JlIGFueVxuICogb2YgdGhlIGZhaWwtY2xvc2VkIGB0cnkvY2F0Y2hgIGJsb2NrcyBpbiBgcmVuZGVyQW5jaG9yUnVuYCwgYHJlbmRlclBhdGhSdW5gXG4gKiBhbmQgYGFuY2hvckJ1bGxldHNgIGV4aXN0IHRvIGNhdGNoIGl0LiBUaGUgaG9vayBwcm9jZXNzIHRoZW4gZGllZCB3aXRoIGV4aXRcbiAqIDEsIHdoaWNoIENsYXVkZSBDb2RlIHRyZWF0cyBhcyBhIG5vbi1ibG9ja2luZyBob29rIGVycm9yOiB0aGUgY29tbWl0IGdhdGVcbiAqIHNpbGVudGx5IGFsbG93ZWQgdGhlIGNvbW1pdCBhbmQgdGhlIGRyaWZ0IHJlbWluZGVyIHNpbGVudGx5IHZhbmlzaGVkLlxuICogQnVpbGRpbmcgaXQgaW5zaWRlIHRoZSByZW5kZXIgcGF0aCBwdXRzIGFueSBmYWlsdXJlIGJhY2sgaW5zaWRlIHRob3NlXG4gKiBjYXRjaGVzLlxuICpcbiAqIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IHRoZSBzYW1lIGNhdGVnb3J5IGFzXG4gKiB0aGUgbG9jYWwgYHRyeS9jYXRjaGAgYmxvY2tzIGF0IHRoaXMgbW9kdWxlJ3MgY2FsbCBzaXRlcywgYW5kIGxvYWQtYmVhcmluZ1xuICogZm9yIHRoZSBzYW1lIHJlYXNvbi4gTm90aGluZyBpbiB0aGUgY29sdW1uLWFsaWdubWVudCBwYXRoIG1heSBiZSBhYmxlIHRvXG4gKiBjb3N0IHRoZSBjb21taXQgZ2F0ZSBvciB0aGUgZHJpZnQgcmVtaW5kZXI6IGlmIGRpc3BsYXkgd2lkdGggY2Fubm90IGJlXG4gKiBtZWFzdXJlZCwgdGhlIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgZ2F0ZSBzdGlsbCBob2xkczsgb25seSBhbGlnbm1lbnQgaXNcbiAqIGxvc3QuXG4gKi9cbmxldCBjYWNoZWRTZWdtZW50ZXI6IHsgdmFsdWU6IEludGwuU2VnbWVudGVyIHwgbnVsbCB9IHwgdW5kZWZpbmVkO1xuXG5mdW5jdGlvbiBncmFwaGVtZVNlZ21lbnRlcigpOiBJbnRsLlNlZ21lbnRlciB8IG51bGwge1xuICBpZiAoY2FjaGVkU2VnbWVudGVyID09PSB1bmRlZmluZWQpIHtcbiAgICB0cnkge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbmV3IEludGwuU2VnbWVudGVyKCdlbicsIHsgZ3JhbnVsYXJpdHk6ICdncmFwaGVtZScgfSkgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG51bGwgfTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNhY2hlZFNlZ21lbnRlci52YWx1ZTtcbn1cblxuLyoqXG4gKiBDb2RlIHBvaW50IHJhbmdlcyByZW5kZXJlZCB0d28gY29sdW1ucyB3aWRlOiB0aGUgRWFzdCBBc2lhbiBXaWRlIChXKSBhbmRcbiAqIEZ1bGx3aWR0aCAoRikgYmxvY2tzIG9mIFVBWCAjMTEsIHBsdXMgdGhlIGVtb2ppIGJsb2NrcyB0aGF0IHRlcm1pbmFscyBhbmRcbiAqIHByb3BvcnRpb25hbCBhZ2VudC1mYWNpbmcgcmVuZGVyZXJzIGJvdGggZ2l2ZSBkb3VibGUgd2lkdGguIEV2ZXJ5dGhpbmcgZWxzZVxuICogY291bnRzIGFzIG9uZSBjb2x1bW4uXG4gKlxuICogU29ydGVkIGFzY2VuZGluZyBhbmQgbm9uLW92ZXJsYXBwaW5nIFx1MjAxNCB7QGxpbmsgaXNXaWRlQ29kZVBvaW50fSBzaG9ydC1jaXJjdWl0c1xuICogb24gdGhlIGZpcnN0IHJhbmdlIHN0YXJ0aW5nIHBhc3QgdGhlIGNvZGUgcG9pbnQuXG4gKi9cbmNvbnN0IFdJREVfUkFOR0VTOiByZWFkb25seSAocmVhZG9ubHkgW251bWJlciwgbnVtYmVyXSlbXSA9IFtcbiAgWzB4MTEwMCwgMHgxMTVmXSxcbiAgWzB4MjMyOSwgMHgyMzJhXSxcbiAgWzB4MjYwMCwgMHgyN2JmXSxcbiAgWzB4MmU4MCwgMHgzMDNlXSxcbiAgWzB4MzA0MSwgMHgzM2ZmXSxcbiAgWzB4MzQwMCwgMHg0ZGJmXSxcbiAgWzB4NGUwMCwgMHg5ZmZmXSxcbiAgWzB4YTAwMCwgMHhhNGNmXSxcbiAgWzB4YTk2MCwgMHhhOTdmXSxcbiAgWzB4YWMwMCwgMHhkN2EzXSxcbiAgWzB4ZjkwMCwgMHhmYWZmXSxcbiAgWzB4ZmUxMCwgMHhmZTE5XSxcbiAgWzB4ZmUzMCwgMHhmZTZmXSxcbiAgWzB4ZmYwMCwgMHhmZjYwXSxcbiAgWzB4ZmZlMCwgMHhmZmU2XSxcbiAgWzB4MTcwMDAsIDB4MThhZmZdLFxuICBbMHgxZjFlNiwgMHgxZjFmZl0sXG4gIFsweDFmMzAwLCAweDFmNjRmXSxcbiAgWzB4MWY2ODAsIDB4MWY2ZmZdLFxuICBbMHgxZjkwMCwgMHgxZjlmZl0sXG4gIFsweDFmYTcwLCAweDFmYWZmXSxcbiAgWzB4MjAwMDAsIDB4MmZmZmRdLFxuICBbMHgzMDAwMCwgMHgzZmZmZF1cbl07XG5cbmZ1bmN0aW9uIGlzV2lkZUNvZGVQb2ludChjcDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgW2xvLCBoaV0gb2YgV0lERV9SQU5HRVMpIHtcbiAgICBpZiAoY3AgPCBsbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChjcCA8PSBoaSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIERpc3BsYXkgd2lkdGggb2YgYSBuYW1lIGluIHRlcm1pbmFsIGNvbHVtbnMgXHUyMDE0IHRoZSB1bml0IHRoZSByYW5nZSBjb2x1bW4gaXNcbiAqIGFjdHVhbGx5IGFsaWduZWQgaW4uIE1lYXN1cmVkIG92ZXIgZ3JhcGhlbWUgY2x1c3RlcnMgKHNvIGEgZGVjb21wb3NlZCBgXHUwMEU5YFxuICogb3IgYSBjb21iaW5pbmctbWFyayBzZXF1ZW5jZSBjb3VudHMgb25jZSwgbm90IG9uY2UgcGVyIGNvZGUgcG9pbnQpLCB3aXRoXG4gKiBlYWNoIGNsdXN0ZXIgY29udHJpYnV0aW5nIHR3byBjb2x1bW5zIHdoZW4gaXRzIGJhc2UgY29kZSBwb2ludCBpcyBFYXN0XG4gKiBBc2lhbiBXaWRlL0Z1bGx3aWR0aCBvciBlbW9qaSBhbmQgb25lIG90aGVyd2lzZS5cbiAqXG4gKiBOZWl0aGVyIFVURi0xNiBgLmxlbmd0aGAgbm9yIGBBcnJheS5mcm9tKG5hbWUpLmxlbmd0aGAgaXMgdGhpcyB1bml0OiB0aGVcbiAqIGZpcnN0IG92ZXItY291bnRzIGEgc3Vycm9nYXRlIHBhaXIsIHRoZSBzZWNvbmQgdW5kZXItY291bnRzIGEgQ0pLIGlkZW9ncmFwaFxuICogYW5kIG92ZXItY291bnRzIGEgZGVjb21wb3NlZCBhY2NlbnQuXG4gKlxuICogV2hlbiB7QGxpbmsgZ3JhcGhlbWVTZWdtZW50ZXJ9IGlzIHVuYXZhaWxhYmxlIChhIE5vZGUgYnVpbHRcbiAqIGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCBhdCBhbGwpLCB0aGlzIGRlZ3JhZGVzIHRvIHRoZSBjcnVkZXJcbiAqIHBlci1jb2RlLXBvaW50IG1lYXN1cmUgcmF0aGVyIHRoYW4gdGhyb3dpbmcuIFRoYXQgbWVhc3VyZSBvdmVyLWNvdW50cyBhXG4gKiBkZWNvbXBvc2VkIGFjY2VudCBhbmQgYSByZWdpb25hbC1pbmRpY2F0b3IgZmxhZyBwYWlyLCBzbyBhbGlnbm1lbnQgY2FuIGJlIGFcbiAqIGNvbHVtbiBvciB0d28gb2ZmIFx1MjAxNCB3aGljaCBpcyB0aGUgZW50aXJlIGNvc3QsIGFuZCBpcyB0aGUgY29ycmVjdCBwcmljZSB0b1xuICogcGF5OiB0aGUgYW5jaG9yIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgY29tbWl0IGdhdGUgc3RpbGwgaG9sZHMuXG4gKi9cbmZ1bmN0aW9uIGRpc3BsYXlXaWR0aChuYW1lOiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCBzZWdtZW50ZXIgPSBncmFwaGVtZVNlZ21lbnRlcigpO1xuICBsZXQgd2lkdGggPSAwO1xuICBpZiAoc2VnbWVudGVyID09PSBudWxsKSB7XG4gICAgZm9yIChjb25zdCBjb2RlUG9pbnQgb2YgbmFtZSkge1xuICAgICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KGNvZGVQb2ludC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICAgIH1cbiAgICByZXR1cm4gd2lkdGg7XG4gIH1cbiAgZm9yIChjb25zdCB7IHNlZ21lbnQgfSBvZiBzZWdtZW50ZXIuc2VnbWVudChuYW1lKSkge1xuICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChzZWdtZW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gIH1cbiAgcmV0dXJuIHdpZHRoO1xufVxuXG4vKipcbiAqIEFsaWdubWVudCBjZWlsaW5nLiBBIHNpYmxpbmcgZ3JvdXAgd2hvc2Ugd2lkZXN0IHJhbmdlLWJlYXJpbmcgbmFtZSBleGNlZWRzXG4gKiB0aGlzIHdpZHRoIGRvZXMgbm90IGFsaWduIGF0IGFsbCBcdTIwMTQgZXZlcnkgbmFtZSBpbiBpdCB0YWtlcyBhIHNpbmdsZSBzcGFjZVxuICogYmVmb3JlIGl0cyByYW5nZS4gVGhlIGFsdGVybmF0aXZlIChwYWQgdGhlIHNob3J0IG5hbWVzIHRvIHRoZSBjZWlsaW5nIHdoaWxlXG4gKiB0aGUgbG9uZyBvbmUgc2l0cyBhdCBpdHMgb3duIG5hdHVyYWwgY29sdW1uKSBwYXlzIG1vc3Qgb2YgdGhlIHdpZHRoIGZvclxuICogYWxpZ25tZW50IHRoYXQgYWxpZ25zIHdpdGggbm90aGluZywgd2hpY2ggaXMgc3RyaWN0bHkgd29yc2UgdGhhbiBub3RcbiAqIGFsaWduaW5nLiBOYW1lcyB0aGVtc2VsdmVzIGFyZSBuZXZlciB0cnVuY2F0ZWQgb3IgZWxpZGVkIGF0IGFueSB3aWR0aC5cbiAqL1xuY29uc3QgTUFYX0FMSUdOX0NPTFVNTiA9IDQ4O1xuXG4vKipcbiAqIFRoZSBjb2x1bW4gZXZlcnkgcmFuZ2UtYmVhcmluZyBuYW1lIGluIHRoaXMgc2libGluZyBncm91cCBwYWRzIHRvLCBvciBgMGBcbiAqIHdoZW4gdGhlIGdyb3VwIGZvcmdvZXMgYWxpZ25tZW50IChubyByYW5nZS1iZWFyaW5nIG5hbWVzLCBvciBhIG5hbWUgcGFzdFxuICoge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59KS4gQWxpZ25tZW50IHNjb3BlIGlzIHRoZSBncm91cCdzIGRpcmVjdCBjaGlsZHJlblxuICogb25seSwgbmV2ZXIgdGhlIHdob2xlIHRyZWUgXHUyMDE0IHdob2xlLXRyZWUgYWxpZ25tZW50IHdvdWxkIGxldCBvbmUgZGVlcGx5XG4gKiBuZXN0ZWQgbG9uZyBuYW1lIHBhZCBldmVyeSB1bnJlbGF0ZWQgYnJhbmNoLlxuICovXG5mdW5jdGlvbiBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXM6IERpc3BsYXlJdGVtW10pOiBudW1iZXIge1xuICBsZXQgbWF4ID0gMDtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicgJiYgcHJpbnRzUmFuZ2VDb2x1bW4oaXRlbS5ub2RlLmFuY2hvcikpIHtcbiAgICAgIG1heCA9IE1hdGgubWF4KG1heCwgZGlzcGxheVdpZHRoKGl0ZW0ubmFtZSkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWF4ID4gTUFYX0FMSUdOX0NPTFVNTiA/IDAgOiBtYXg7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGlzIGFuY2hvciBwcmludHMgYSByYW5nZSBjb2x1bW4gYXQgYWxsIFx1MjAxNCB0aGUgZXhhY3QgY29uZGl0aW9uXG4gKiB7QGxpbmsgbGFiZWxGb3J9IGVuY29kZXMsIGhvaXN0ZWQgc28ge0BsaW5rIGNvbXB1dGVHcm91cFRhcmdldH0gbWVhc3VyZXMgdGhlXG4gKiBzYW1lIHNldCBvZiBuYW1lcyBpdCBwYWRzLiBBbiBhbmNob3Igd2l0aCBubyByYW5nZXMsIG9yIGEgKnNvbGUqIHdob2xlLWZpbGVcbiAqIGVudHJ5ICh3aGljaCByZW5kZXJzIGFzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIpLCBjb250cmlidXRlcyBubyByYW5nZVxuICogY29sdW1uIGFuZCBzbyBtdXN0IG5vdCBjb250cmlidXRlIHRvIHRoZSBncm91cCBtYXggZWl0aGVyOiBvdGhlcndpc2UgYVxuICogd2hvbGUtZmlsZSBhbmNob3Igb24gYSBwYXRoIHBhc3Qge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59IHNpbGVudGx5IHN1cHByZXNzZXNcbiAqIGFsaWdubWVudCBmb3IgaXRzIHJhbmdlLWJlYXJpbmcgc2libGluZ3Mgd2hpbGUgaXRzZWxmIHByaW50aW5nIG5vdGhpbmcgdG9cbiAqIGFsaWduLlxuICovXG5mdW5jdGlvbiBwcmludHNSYW5nZUNvbHVtbihhbmNob3I6IFRyZWVBbmNob3IpOiBib29sZWFuIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHJhbmdlcy5zb21lKChlbnRyeSkgPT4gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHJhbmdlcy5sZW5ndGggPT09IDEpICE9PSBudWxsKTtcbn1cblxuLyoqIFRoZSBzcGFjaW5nIGJldHdlZW4gYSBuYW1lIG9mIGBuYW1lV2lkdGhgIGNvbHVtbnMgYW5kIGl0cyByYW5nZSBjb2x1bW4uICovXG5mdW5jdGlvbiBjb21wdXRlUGFkKG5hbWVXaWR0aDogbnVtYmVyLCB0YXJnZXQ6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmIChuYW1lV2lkdGggPj0gdGFyZ2V0KSByZXR1cm4gJyAnO1xuICByZXR1cm4gJyAnLnJlcGVhdCh0YXJnZXQgLSBuYW1lV2lkdGggKyAxKTtcbn1cblxuLyoqXG4gKiBSZW5kZXIgb25lIGxlYWYncyBsaW5lKHMpLiBBbiBlbXB0eSBgcmFuZ2VzYCBhcnJheSBpcyBhIGJhcmUtcGF0aCBsZWFmIHdpdGhcbiAqIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwgKGRpc3RpbmN0IGZyb20gYSBgd2hvbGUtZmlsZWAgZW50cnksIHdoaWNoIGlzIGFuXG4gKiBleHBsaWNpdCBjbGFzc2lmaWNhdGlvbiB0aGF0IGFsc28gcHJpbnRzIHdpdGggemVybyBtYXJrZXIgd2hlbiBpdCBzdGFuZHNcbiAqIGFsb25lLCBidXQgdGhyb3VnaCB0aGUgcmFuZ2VzIHBpcGVsaW5lKS4gTXVsdGlwbGUgc3RhY2tlZCByYW5nZXMgcHJpbnRcbiAqIHVuZGVyIGEgY29udGludWF0aW9uIHByZWZpeCBpbnN0ZWFkIG9mIHJlcGVhdGluZyB0aGUgbmFtZTsgZWFjaCBjYXJyaWVzIGl0c1xuICogb3duIHN1ZmZpeCBpbmRlcGVuZGVudGx5LCBhbmQgZWFjaCBjYXJyaWVzIGEgbGFiZWwgaWRlbnRpZnlpbmcgd2hpY2ggYW5jaG9yXG4gKiB0aGUgc3VmZml4IGJlbG9uZ3MgdG8uXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckxlYWZMaW5lcyhcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3I6IFRyZWVBbmNob3IsXG4gIG93blByZWZpeDogc3RyaW5nLFxuICBjaGlsZFByZWZpeDogc3RyaW5nLFxuICBncm91cFRhcmdldDogbnVtYmVyXG4pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW2Ake293blByZWZpeH0ke25hbWV9YF07XG5cbiAgY29uc3Qgc29ydGVkID0gWy4uLnJhbmdlc10uc29ydChjb21wYXJlUmFuZ2VFbnRyaWVzKTtcbiAgY29uc3Qgc29sZSA9IHNvcnRlZC5sZW5ndGggPT09IDE7XG4gIGNvbnN0IG5hbWVXaWR0aCA9IGRpc3BsYXlXaWR0aChuYW1lKTtcbiAgY29uc3QgcGFkID0gY29tcHV0ZVBhZChuYW1lV2lkdGgsIGdyb3VwVGFyZ2V0KTtcbiAgY29uc3QgYmxhbmsgPSAnICcucmVwZWF0KG5hbWVXaWR0aCArIHBhZC5sZW5ndGgpO1xuXG4gIHJldHVybiBzb3J0ZWQubWFwKChlbnRyeSwgaSkgPT4ge1xuICAgIGNvbnN0IGxhYmVsID0gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHNvbGUpO1xuICAgIGlmIChsYWJlbCA9PT0gbnVsbCkgcmV0dXJuIGAke293blByZWZpeH0ke25hbWV9JHtlbnRyeS5zdWZmaXh9YDtcbiAgICBjb25zdCBiYXNlID0gaSA9PT0gMCA/IGAke293blByZWZpeH0ke25hbWV9JHtwYWR9YCA6IGAke2NoaWxkUHJlZml4fSR7Ymxhbmt9YDtcbiAgICByZXR1cm4gYCR7YmFzZX0ke2xhYmVsfSR7ZW50cnkuc3VmZml4fWA7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJOb2Rlcyhub2RlczogUGF0aFRyZWVOb2RlW10sIHByZWZpeDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgaXRlbXMgPSBub2Rlcy5tYXAoZm9sZENoYWluKTtcbiAgY29uc3QgZ3JvdXBUYXJnZXQgPSBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXMpO1xuICBpdGVtcy5mb3JFYWNoKChpdGVtLCBpKSA9PiB7XG4gICAgY29uc3QgaXNMYXN0ID0gaSA9PT0gaXRlbXMubGVuZ3RoIC0gMTtcbiAgICBjb25zdCBvd25QcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnXHUyNTE0XHUyNTAwICcgOiAnXHUyNTFDXHUyNTAwICd9YDtcbiAgICBjb25zdCBjaGlsZFByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICcgICAnIDogJ1x1MjUwMiAgJ31gO1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnKSB7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlckxlYWZMaW5lcyhpdGVtLm5hbWUsIGl0ZW0ubm9kZS5hbmNob3IsIG93blByZWZpeCwgY2hpbGRQcmVmaXgsIGdyb3VwVGFyZ2V0KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpbmVzLnB1c2goYCR7b3duUHJlZml4fSR7aXRlbS5uYW1lfS9gKTtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTm9kZXMoaXRlbS5ub2RlLmNoaWxkcmVuLCBjaGlsZFByZWZpeCkpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsaW5lcztcbn1cblxuLyoqXG4gKiBSZW5kZXIgYSBjb2xsYXBzZWQgYW5jaG9yIGxpc3QgYXMgYSBib3gtZHJhd2luZyB0cmVlLCBncm91cGVkIGJ5IHNoYXJlZFxuICogcGF0aCBwcmVmaXguIEV2ZXJ5IGFuY2hvciBsaXN0IHJlbmRlcnMgYXMgYSB0cmVlIHVuY29uZGl0aW9uYWxseSBcdTIwMTQgYSBzaW5nbGVcbiAqIGFuY2hvciBiZWNvbWVzIGEgb25lLWxpbmUgdHJlZSB3aGF0ZXZlciBpdHMgZGVwdGggKHNlZSB7QGxpbmsgZm9sZENoYWlufSk7XG4gKiB0aGVyZSBpcyBubyBmbGF0LWJ1bGxldCBwYXRoIG9yIHNpemUgZmxvb3IgaW4gdGhpcyBtb2R1bGUuXG4gKlxuICogSGVpZ2h0IGlzIGJvdW5kZWQgYnkge0BsaW5rIGZvbGRDaGFpbn06IGEgZGlyZWN0b3J5IGxpbmUgb25seSBldmVyIGFwcGVhcnNcbiAqIHdoZXJlIGl0IGdlbnVpbmVseSBncm91cHMgdHdvIG9yIG1vcmUgc2libGluZ3MsIHNvIHRoZSB0cmVlIGFkZHMgYXQgbW9zdFxuICogb25lIGxpbmUgcGVyIHJlYWwgZ3JvdXBpbmcgYW5kIG5ldmVyIG9uZSBwZXIgcGF0aCBzZWdtZW50LlxuICpcbiAqIFRvdGFsIGZvciBhbnkgd2VsbC1mb3JtZWQgYFRyZWVBbmNob3JbXWA6IGRlZ2VuZXJhdGUgcGF0aHMgKHJ1bGUgZW5mb3JjZWRcbiAqIGluIHtAbGluayBzcGxpdFNlZ21lbnRzfSkgYXJlIG5vcm1hbGl6ZWQgdG8gYXRvbWljIGxlYXZlcyByYXRoZXIgdGhhblxuICogdGhyb3duIG9uLCBzbyB0aGlzIGZ1bmN0aW9uIG5ldmVyIG5lZWRzIGFuIGludGVybmFsIHRyeS9jYXRjaC4gQ2FsbGVycyBhZGRcbiAqIHRoZWlyIG93biBjYXRjaCBhcm91bmQgdGhpcyBjYWxsIGluIGEgbGF0ZXIgcGhhc2UgKGZhaWwtb3BlbiBkaXNjaXBsaW5lXG4gKiBsaXZlcyBhdCB0aGUgY2FsbCBzaXRlLCBub3QgaGVyZSkuXG4gKlxuICogYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXMgYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlclxuICogZGlzdGluY3QgYHBhdGhgIFx1MjAxNCBwYXNzIGFuY2hvcnMgdGhyb3VnaCB7QGxpbmsgY29sbGFwc2VCeVBhdGh9IGZpcnN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQW5jaG9yVHJlZShhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGZvcmVzdCA9IGJ1aWxkRm9yZXN0KGFuY2hvcnMpO1xuICByZXR1cm4gcmVuZGVyTm9kZXMoZm9yZXN0LCAnJyk7XG59XG4iLCAiLyoqXG4gKiBDb2RleCBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlIHBhcnNlci5cbiAqXG4gKiBUdXJucyBhIENvZGV4IGBhcHBseV9wYXRjaGAgYHRvb2xfaW5wdXQuY29tbWFuZGAgcGF0Y2ggc3RyaW5nIGludG8gdGhlXG4gKiBgQW5jaG9yU3BlY1tdYCBzaGFwZSB0aGUgc2hhcmVkIHRvdWNoIGNvcmUgYWxyZWFkeSBjb25zdW1lcyBcdTIwMTQgdGhlIG9uZVxuICogZ2VudWluZWx5IG5ldyBhbGdvcml0aG0gdGhlIENvZGV4IGFkYXB0ZXIgbmVlZHMuIEl0IHJlcGxhY2VzIHRoZSBzdHJ1Y3R1cmVkXG4gKiBgZmlsZV9wYXRoYC9gb2xkX3N0cmluZ2AvYG9mZnNldGAgcmVhZGluZyB0aGUgQ2xhdWRlIFBvc3RUb29sVXNlIHRvdWNoIGhvb2tcbiAqIGRvZXMsIGJlY2F1c2UgQ29kZXggZGVsaXZlcnMgZXZlcnkgZWRpdCBhcyBhIHNpbmdsZSBhcHBseV9wYXRjaCBlbnZlbG9wZVxuICogcmF0aGVyIHRoYW4gYSB0eXBlZCB0b29sIGlucHV0LlxuICpcbiAqIFRoZSBtb2R1bGUgaXMgcHVyZTogaXQgaW1wb3J0cyBvbmx5IHRoZSBrZXJuZWwgYW5jaG9yIHR5cGVzIGFuZCBuZXZlciB0b3VjaGVzXG4gKiB0aGUgQ29kZXggU0RLLCBzbyBpdCBpcyBESS10ZXN0YWJsZSBleGFjdGx5IGxpa2UgdGhlIHBvcmNlbGFpbiBwYXJzZXJzIGluIHRoZVxuICogc2hhcmVkIGtlcm5lbC4gUmFuZ2UgcmVjb3ZlcnkgaXMgYmVzdC1lZmZvcnQgXHUyMDE0IHRoZSBhcHBseV9wYXRjaCBmb3JtYXQgY2Fycmllc1xuICogYEBAYCBjb250ZXh0IGFuZCBgK2AvYC1gL3NwYWNlIGNoYW5nZSBsaW5lcyBidXQgbm8gZXhwbGljaXQgbGluZSBudW1iZXJzLCBzbyBhXG4gKiByYW5nZSBjYW4gb25seSBiZSByZWNvdmVyZWQgYnkgbG9jYXRpbmcgYSBodW5rJ3MgcHJlLWVkaXQgYmxvY2sgaW4gdGhlXG4gKiBvbi1kaXNrIGZpbGUuIFRoYXQgZmlsZSByZWFkIGlzIGluamVjdGVkIChgcmVhZFByZUVkaXRGaWxlYCkgc28gdGhlIGZ1bmN0aW9uXG4gKiBzdGF5cyBwdXJlIGFuZCB0ZXN0YWJsZS4gT24gQU5ZIGFtYmlndWl0eSAobm8gcmVhZGVyLCBmaWxlIG1pc3NpbmcsIGNvbnRleHRcbiAqIG5vdCBmb3VuZCwgZnV6enkvZHVwbGljYXRlIG1hdGNoKSB0aGUgcGFyc2VyIGRlZ3JhZGVzIHRvIGEgd2hvbGUtZmlsZSBhbmNob3JcbiAqIHJhdGhlciB0aGFuIHRocm93aW5nIFx1MjAxNCB3aG9sZS1maWxlIGFuY2hvcnMgYXJlIGZpcnN0LWNsYXNzIGFuZCB0b3VjaCB0cmFja2luZ1xuICogbXVzdCBuZXZlciBiZSBibG9ja2VkLlxuICpcbiAqIFRoZSBncmFtbWFyIGlzIGNyb3NzLWNoZWNrZWQgYWdhaW5zdCBDb2RleCdzIG93biBhcHBseV9wYXRjaCBjcmF0ZVxuICogKGNvZGV4LXJzL2FwcGx5LXBhdGNoL3NyYy97cGFyc2VyLHN0cmVhbWluZ19wYXJzZXJ9LnJzKS4gVHdvIHN1YnRsZXRpZXMgYXJlXG4gKiBtaXJyb3JlZCBkZWxpYmVyYXRlbHk6IGh1bmstaGVhZGVyIG1hcmtlcnMgYXJlIG9ubHkgcmVjb2duaXplZCBhdCB0aGUgc3RhcnQgb2ZcbiAqIGEgbGluZSB3aXRoIG5vIGxlYWRpbmcgd2hpdGVzcGFjZSB3aGlsZSBpbnNpZGUgYW4gVXBkYXRlIGh1bmsgKGEgbGVhZGluZyBzcGFjZVxuICogZGVtb3RlcyBhIG1hcmtlciB0byBhIGNvbnRleHQgbGluZSksIGFuZCBhIGJhcmUgZW1wdHkgbGluZSBpbnNpZGUgYW4gVXBkYXRlXG4gKiBodW5rIGlzIHRyZWF0ZWQgYXMgYW4gZW1wdHkgY29udGV4dCBsaW5lIHByZXNlbnQgaW4gYm90aCBvbGQgYW5kIG5ldyBjb250ZW50LlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHR5cGUgeyBBbmNob3JTcGVjLCBMaW5lUmFuZ2UgfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcblxuLyoqXG4gKiBSZWFkcyB0aGUgcHJlLWVkaXQgKG9uLWRpc2ssIGJlZm9yZSB0aGUgcGF0Y2ggYXBwbGllcykgY29udGVudCBvZiB0aGUgZmlsZSBhdFxuICogYHBhdGhgLCBvciByZXR1cm5zIGBudWxsYCB3aGVuIGl0IGNhbm5vdCBiZSByZWFkLiBJbmplY3RlZCBzbyB0aGUgcGFyc2VyIHN0YXlzXG4gKiBwdXJlOyBjYWxsIHNpdGVzIGRlZmF1bHQgdG8gYSByZWFsIGZpbGVzeXN0ZW0gcmVhZC5cbiAqL1xuZXhwb3J0IHR5cGUgUmVhZFByZUVkaXRGaWxlID0gKHBhdGg6IHN0cmluZykgPT4gc3RyaW5nIHwgbnVsbDtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBHcmFtbWFyIG1hcmtlcnMgKG1pcnJvcnMgY29kZXgtcnMvYXBwbHktcGF0Y2gvc3JjL3BhcnNlci5ycylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBFTkRfUEFUQ0hfTUFSS0VSID0gJyoqKiBFbmQgUGF0Y2gnO1xuY29uc3QgQUREX0ZJTEVfTUFSS0VSID0gJyoqKiBBZGQgRmlsZTogJztcbmNvbnN0IERFTEVURV9GSUxFX01BUktFUiA9ICcqKiogRGVsZXRlIEZpbGU6ICc7XG5jb25zdCBVUERBVEVfRklMRV9NQVJLRVIgPSAnKioqIFVwZGF0ZSBGaWxlOiAnO1xuY29uc3QgTU9WRV9UT19NQVJLRVIgPSAnKioqIE1vdmUgdG86ICc7XG5jb25zdCBFT0ZfTUFSS0VSID0gJyoqKiBFbmQgb2YgRmlsZSc7XG5jb25zdCBDSEFOR0VfQ09OVEVYVF9NQVJLRVIgPSAnQEAgJztcbmNvbnN0IEVNUFRZX0NIQU5HRV9DT05URVhUX01BUktFUiA9ICdAQCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSW50ZXJtZWRpYXRlIGh1bmsgbW9kZWxcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgVXBkYXRlQ2h1bmsge1xuICAvKiogT3B0aW9uYWwgYEBAIDxjb250ZXh0PmAgbGluZSB1c2VkIHRvIGRpc2FtYmlndWF0ZSB0aGUgYmxvY2sncyBsb2NhdGlvbi4gKi9cbiAgY2hhbmdlQ29udGV4dDogc3RyaW5nIHwgbnVsbDtcbiAgLyoqIFByZS1lZGl0IGxpbmVzIHRoaXMgY2h1bmsgY292ZXJzIChjb250ZXh0IGAgYCArIHJlbW92ZWQgYC1gKSwgaW4gb3JkZXIuICovXG4gIG9sZExpbmVzOiBzdHJpbmdbXTtcbiAgLyoqIFBvc3QtZWRpdCBsaW5lcyAoY29udGV4dCBgIGAgKyBhZGRlZCBgK2ApOyByZXRhaW5lZCBmb3IgY29tcGxldGVuZXNzLiAqL1xuICBuZXdMaW5lczogc3RyaW5nW107XG59XG5cbnR5cGUgSHVuayA9XG4gIHwgeyBraW5kOiAnYWRkJzsgcGF0aDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6ICdkZWxldGUnOyBwYXRoOiBzdHJpbmcgfVxuICB8IHsga2luZDogJ3VwZGF0ZSc7IHBhdGg6IHN0cmluZzsgbW92ZVBhdGg6IHN0cmluZyB8IG51bGw7IGNodW5rczogVXBkYXRlQ2h1bmtbXSB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgcmVhZGVyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZWFsLWZpbGVzeXN0ZW0gcmVhZGVyIHVzZWQgd2hlbiBubyByZWFkZXIgaXMgaW5qZWN0ZWQuIEJlc3QtZWZmb3J0OiBhbnlcbiAqIGZhaWx1cmUgKG1pc3NpbmcgZmlsZSwgcGVybWlzc2lvbiBlcnJvcikgeWllbGRzIGBudWxsYCwgd2hpY2ggdGhlIHBhcnNlclxuICogZGVncmFkZXMgdG8gYSB3aG9sZS1maWxlIGFuY2hvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRSZWFkUHJlRWRpdEZpbGUocGF0aDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGZzLnJlYWRGaWxlU3luYyhwYXRoLCAndXRmOCcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFbnZlbG9wZSBzY2FubmluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogU2NhbiB0aGUgcGF0Y2ggdGV4dCBpbnRvIGh1bmtzLiBMZW5pZW50IGJ5IGRlc2lnbjogdW5yZWNvZ25pemVkIGxpbmVzIGFyZVxuICogaWdub3JlZCByYXRoZXIgdGhhbiByZWplY3RlZCwgYW5kIEJlZ2luL0VuZC9FbnZpcm9ubWVudCBsaW5lcyBhcmUgc2tpcHBlZCwgc29cbiAqIGEgbWFsZm9ybWVkIGVudmVsb3BlIGRlZ3JhZGVzIHRvIHdoYXRldmVyIGh1bmtzIGNvdWxkIGJlIHJlY292ZXJlZCAob2Z0ZW5cbiAqIG5vbmUgXHUyMTkyIGBbXWApIGluc3RlYWQgb2YgdGhyb3dpbmcuXG4gKi9cbmZ1bmN0aW9uIHNjYW5IdW5rcyhjb21tYW5kOiBzdHJpbmcpOiBIdW5rW10ge1xuICBjb25zdCBodW5rczogSHVua1tdID0gW107XG4gIC8vIFRoZSBjdXJyZW50bHktb3BlbiBVcGRhdGUgaHVuaywgb3IgbnVsbC4gQWRkL0RlbGV0ZSBodW5rcyBoYXZlIG5vIGJvZHksIHNvXG4gIC8vIHRoZXkgY2xvc2UgaW1tZWRpYXRlbHkgYW5kIHJlc2V0IHRoaXMgdG8gbnVsbC5cbiAgbGV0IG9wZW5VcGRhdGU6IChIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9KSB8IG51bGwgPSBudWxsO1xuXG4gIGZvciAoY29uc3QgcmF3IG9mIGNvbW1hbmQuc3BsaXQoJ1xcbicpKSB7XG4gICAgLy8gSGVhZGVyIGRldGVjdGlvbiBpcyB3aGl0ZXNwYWNlLXNlbnNpdGl2ZSBpbnNpZGUgYW4gVXBkYXRlIGh1bms6IENvZGV4IHVzZXNcbiAgICAvLyB0cmltX2VuZCB0aGVyZSAobGVhZGluZyBzcGFjZSBkZW1vdGVzIGEgbWFya2VyIHRvIGEgY29udGV4dCBsaW5lKSBhbmQgZnVsbFxuICAgIC8vIHRyaW0gZWxzZXdoZXJlLiBNYXRjaCB0aGF0IHNvIGluZGVudGVkIG1hcmtlcnMgaW5zaWRlIGEgaHVuayBzdGF5IGNvbnRlbnQuXG4gICAgY29uc3QgaGVhZGVyTGluZTogc3RyaW5nID0gb3BlblVwZGF0ZSA/IHJhdy5yZXBsYWNlKC9bIFxcdFxccl0rJC8sICcnKSA6IHJhdy50cmltKCk7XG5cbiAgICBpZiAoaGVhZGVyTGluZSA9PT0gRU5EX1BBVENIX01BUktFUikge1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChBRERfRklMRV9NQVJLRVIpKSB7XG4gICAgICBodW5rcy5wdXNoKHsga2luZDogJ2FkZCcsIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoQUREX0ZJTEVfTUFSS0VSLmxlbmd0aCkgfSk7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKERFTEVURV9GSUxFX01BUktFUikpIHtcbiAgICAgIGh1bmtzLnB1c2goeyBraW5kOiAnZGVsZXRlJywgcGF0aDogaGVhZGVyTGluZS5zbGljZShERUxFVEVfRklMRV9NQVJLRVIubGVuZ3RoKSB9KTtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoVVBEQVRFX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgY29uc3QgaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSA9IHtcbiAgICAgICAga2luZDogJ3VwZGF0ZScsXG4gICAgICAgIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoVVBEQVRFX0ZJTEVfTUFSS0VSLmxlbmd0aCksXG4gICAgICAgIG1vdmVQYXRoOiBudWxsLFxuICAgICAgICBjaHVua3M6IFtdXG4gICAgICB9O1xuICAgICAgaHVua3MucHVzaChodW5rKTtcbiAgICAgIG9wZW5VcGRhdGUgPSBodW5rO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKG9wZW5VcGRhdGUpIHtcbiAgICAgIHByb2Nlc3NVcGRhdGVMaW5lKG9wZW5VcGRhdGUsIHJhdyk7XG4gICAgfVxuICAgIC8vIEFueSBvdGhlciBsaW5lIG91dHNpZGUgYW4gVXBkYXRlIGh1bmsgKEJlZ2luIFBhdGNoLCBFbnZpcm9ubWVudCBJRCwgQWRkXG4gICAgLy8gRmlsZSBgK2AgY29udGVudCwgc3RyYXkgdGV4dCkgaXMgaWdub3JlZC5cbiAgfVxuXG4gIHJldHVybiBodW5rcztcbn1cblxuZnVuY3Rpb24gZW5zdXJlQ2h1bmsoaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSk6IFVwZGF0ZUNodW5rIHtcbiAgY29uc3QgbGFzdCA9IGh1bmsuY2h1bmtzW2h1bmsuY2h1bmtzLmxlbmd0aCAtIDFdO1xuICBpZiAobGFzdCkgcmV0dXJuIGxhc3Q7XG4gIGNvbnN0IGNodW5rOiBVcGRhdGVDaHVuayA9IHsgY2hhbmdlQ29udGV4dDogbnVsbCwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfTtcbiAgaHVuay5jaHVua3MucHVzaChjaHVuayk7XG4gIHJldHVybiBjaHVuaztcbn1cblxuLyoqIEFwcGx5IG9uZSBib2R5IGxpbmUgb2YgYW4gVXBkYXRlIGh1bmsgdG8gaXRzIGNodW5rIGxpc3QuICovXG5mdW5jdGlvbiBwcm9jZXNzVXBkYXRlTGluZShodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9LCByYXc6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCB0cmltbWVkRW5kID0gcmF3LnJlcGxhY2UoL1sgXFx0XFxyXSskLywgJycpO1xuXG4gIGlmICh0cmltbWVkRW5kID09PSBFT0ZfTUFSS0VSKSByZXR1cm47IC8vIGVuZC1vZi1maWxlIGhpbnQ7IG5vdCBuZWVkZWQgZm9yIHJhbmdlc1xuXG4gIC8vIGAqKiogTW92ZSB0bzpgIGlzIG9ubHkgbWVhbmluZ2Z1bCBiZWZvcmUgYW55IGNoYW5nZSBjb250ZW50LlxuICBpZiAoaHVuay5jaHVua3MubGVuZ3RoID09PSAwICYmIGh1bmsubW92ZVBhdGggPT09IG51bGwgJiYgdHJpbW1lZEVuZC5zdGFydHNXaXRoKE1PVkVfVE9fTUFSS0VSKSkge1xuICAgIGh1bmsubW92ZVBhdGggPSB0cmltbWVkRW5kLnNsaWNlKE1PVkVfVE9fTUFSS0VSLmxlbmd0aCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKHRyaW1tZWRFbmQgPT09IEVNUFRZX0NIQU5HRV9DT05URVhUX01BUktFUikge1xuICAgIGh1bmsuY2h1bmtzLnB1c2goeyBjaGFuZ2VDb250ZXh0OiBudWxsLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9KTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHRyaW1tZWRFbmQuc3RhcnRzV2l0aChDSEFOR0VfQ09OVEVYVF9NQVJLRVIpKSB7XG4gICAgaHVuay5jaHVua3MucHVzaCh7IGNoYW5nZUNvbnRleHQ6IHRyaW1tZWRFbmQuc2xpY2UoQ0hBTkdFX0NPTlRFWFRfTUFSS0VSLmxlbmd0aCksIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH0pO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEEgYmFyZSBlbXB0eSBsaW5lIGlzIGFuIGVtcHR5IGNvbnRleHQgbGluZSAocHJlc2VudCBpbiBib3RoIG9sZCBhbmQgbmV3KS5cbiAgaWYgKHJhdyA9PT0gJycpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2goJycpO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2goJycpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBmaXJzdCA9IHJhd1swXTtcbiAgaWYgKGZpcnN0ID09PSAnICcpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNvbnN0IGNvbnRlbnQgPSByYXcuc2xpY2UoMSk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaChjb250ZW50KTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKGNvbnRlbnQpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoZmlyc3QgPT09ICcrJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaChyYXcuc2xpY2UoMSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoZmlyc3QgPT09ICctJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaChyYXcuc2xpY2UoMSkpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBVbnJlY29nbml6ZWQgY29udGVudCBsaW5lIFx1MjAxNCBpZ25vcmUgbGVuaWVudGx5IHJhdGhlciB0aGFuIHRocm93LlxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJhbmdlIHJlY292ZXJ5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFNwbGl0IGZpbGUgY29udGVudCBpbnRvIGxpbmVzIGZvciBtYXRjaGluZy4gQSB0cmFpbGluZyBuZXdsaW5lIHlpZWxkcyBhXG4gKiB0cmFpbGluZyBlbXB0eSBlbGVtZW50LCB3aGljaCBpcyBoYXJtbGVzcyBmb3Igc3ViLXNsaWNlIG1hdGNoaW5nLiAqL1xuZnVuY3Rpb24gc3BsaXRMaW5lcyhjb250ZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBjb250ZW50LnNwbGl0KCdcXG4nKTtcbn1cblxuLyoqIEluZGljZXMgKDAtYmFzZWQpIGF0IHdoaWNoIGB2YWx1ZWAgYXBwZWFycyBhcyBhIGZ1bGwgbGluZSBpbiBgbGluZXNgLiAqL1xuZnVuY3Rpb24gbGluZUluZGljZXMobGluZXM6IHN0cmluZ1tdLCB2YWx1ZTogc3RyaW5nKTogbnVtYmVyW10ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAobGluZXNbaV0gPT09IHZhbHVlKSBvdXQucHVzaChpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKiogU3RhcnQgaW5kaWNlcyAoMC1iYXNlZCkgYXQgd2hpY2ggYG5lZWRsZWAgbWF0Y2hlcyBjb250aWd1b3VzbHkgaW4gYGhheXN0YWNrYC4gKi9cbmZ1bmN0aW9uIGNvbnRpZ3VvdXNNYXRjaGVzKGhheXN0YWNrOiBzdHJpbmdbXSwgbmVlZGxlOiBzdHJpbmdbXSk6IG51bWJlcltdIHtcbiAgY29uc3Qgb3V0OiBudW1iZXJbXSA9IFtdO1xuICBpZiAobmVlZGxlLmxlbmd0aCA9PT0gMCB8fCBuZWVkbGUubGVuZ3RoID4gaGF5c3RhY2subGVuZ3RoKSByZXR1cm4gb3V0O1xuICBjb25zdCBsYXN0ID0gaGF5c3RhY2subGVuZ3RoIC0gbmVlZGxlLmxlbmd0aDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbGFzdDsgaSsrKSB7XG4gICAgbGV0IG9rID0gdHJ1ZTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IG5lZWRsZS5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGhheXN0YWNrW2kgKyBqXSAhPT0gbmVlZGxlW2pdKSB7XG4gICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob2spIG91dC5wdXNoKGkpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogTG9jYXRlIGEgc2luZ2xlIGNodW5rJ3MgcHJlLWVkaXQgYmxvY2sgaW4gdGhlIGZpbGUsIHJldHVybmluZyBpdHMgMS1iYXNlZFxuICogbGluZSByYW5nZSBvciBudWxsIHdoZW4gaXQgY2Fubm90IGJlIGxvY2F0ZWQgdW5hbWJpZ3VvdXNseS5cbiAqXG4gKiAtIE5vbi1lbXB0eSBibG9jazogcmVxdWlyZSBhIHVuaXF1ZSBjb250aWd1b3VzIG1hdGNoLCBvciBcdTIwMTQgd2hlbiBkdXBsaWNhdGVkIFx1MjAxNFxuICogICBhIGBAQGAgY2hhbmdlLWNvbnRleHQgbGluZSB0aGF0IHNlbGVjdHMgdGhlIG9jY3VycmVuY2UgYWZ0ZXIgaXQuXG4gKiAtIEVtcHR5IGJsb2NrIChwdXJlIGluc2VydGlvbik6IGFuY2hvciBvbiBhIHVuaXF1ZSBjaGFuZ2UtY29udGV4dCBsaW5lIGlmIG9uZVxuICogICBpcyBnaXZlbjsgb3RoZXJ3aXNlIGl0IGlzIHVubG9jYXRhYmxlLlxuICovXG5mdW5jdGlvbiBsb2NhdGVDaHVuayhwcmVMaW5lczogc3RyaW5nW10sIGNodW5rOiBVcGRhdGVDaHVuayk6IExpbmVSYW5nZSB8IG51bGwge1xuICBjb25zdCBibG9jayA9IGNodW5rLm9sZExpbmVzO1xuXG4gIGlmIChibG9jay5sZW5ndGggPT09IDApIHtcbiAgICBjb25zdCBjdHggPSBjaHVuay5jaGFuZ2VDb250ZXh0O1xuICAgIGlmIChjdHggIT09IG51bGwgJiYgY3R4ICE9PSAnJykge1xuICAgICAgY29uc3QgY3R4SWR4cyA9IGxpbmVJbmRpY2VzKHByZUxpbmVzLCBjdHgpO1xuICAgICAgaWYgKGN0eElkeHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBjdHhJZHhzWzBdICsgMTtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IGxpbmUsIGVuZDogbGluZSB9O1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHN0YXJ0cyA9IGNvbnRpZ3VvdXNNYXRjaGVzKHByZUxpbmVzLCBibG9jayk7XG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgcyA9IHN0YXJ0c1swXTtcbiAgICByZXR1cm4geyBzdGFydDogcyArIDEsIGVuZDogcyArIGJsb2NrLmxlbmd0aCB9O1xuICB9XG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBEdXBsaWNhdGVkIGJsb2NrOiB1c2UgdGhlIGNoYW5nZSBjb250ZXh0IHRvIHNlbGVjdCB0aGUgbWF0Y2ggYWZ0ZXIgaXQuXG4gIGNvbnN0IGN0eCA9IGNodW5rLmNoYW5nZUNvbnRleHQ7XG4gIGlmIChjdHggIT09IG51bGwgJiYgY3R4ICE9PSAnJykge1xuICAgIGZvciAoY29uc3QgYyBvZiBsaW5lSW5kaWNlcyhwcmVMaW5lcywgY3R4KSkge1xuICAgICAgY29uc3QgYWZ0ZXIgPSBzdGFydHMuZmluZCgocykgPT4gcyA+PSBjKTtcbiAgICAgIGlmIChhZnRlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiBhZnRlciArIDEsIGVuZDogYWZ0ZXIgKyBibG9jay5sZW5ndGggfTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7IC8vIGFtYmlndW91cyBcdTIxOTIgY2FsbGVyIGRlZ3JhZGVzIHRvIHdob2xlLWZpbGVcbn1cblxuLyoqXG4gKiBSZWNvdmVyIGEgc2luZ2xlIGxpbmUgcmFuZ2Ugc3Bhbm5pbmcgYWxsIG9mIGFuIHVwZGF0ZSdzIGNodW5rcy4gUmV0dXJucyBudWxsXG4gKiAoXHUyMTkyIHdob2xlLWZpbGUgZmFsbGJhY2spIGlmIGFueSBjaHVuayBjYW5ub3QgYmUgbG9jYXRlZC5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJhbmdlKHByZUxpbmVzOiBzdHJpbmdbXSwgY2h1bmtzOiBVcGRhdGVDaHVua1tdKTogTGluZVJhbmdlIHwgbnVsbCB7XG4gIGxldCB1bmlvbjogTGluZVJhbmdlIHwgbnVsbCA9IG51bGw7XG4gIGZvciAoY29uc3QgY2h1bmsgb2YgY2h1bmtzKSB7XG4gICAgY29uc3QgciA9IGxvY2F0ZUNodW5rKHByZUxpbmVzLCBjaHVuayk7XG4gICAgaWYgKHIgPT09IG51bGwpIHJldHVybiBudWxsO1xuICAgIHVuaW9uID0gdW5pb24gPT09IG51bGwgPyByIDogeyBzdGFydDogTWF0aC5taW4odW5pb24uc3RhcnQsIHIuc3RhcnQpLCBlbmQ6IE1hdGgubWF4KHVuaW9uLmVuZCwgci5lbmQpIH07XG4gIH1cbiAgcmV0dXJuIHVuaW9uO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFB1YmxpYyBBUElcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFBhcnNlIGEgQ29kZXggYGFwcGx5X3BhdGNoYCBjb21tYW5kIHN0cmluZyBpbnRvIGFuIGFuY2hvciBwZXIgdG91Y2hlZCBmaWxlLlxuICpcbiAqIC0gYCoqKiBBZGQgRmlsZTpgIFx1MjE5MiBgY3JlYXRlYCAod2hvbGUtZmlsZSlcbiAqIC0gYCoqKiBEZWxldGUgRmlsZTpgIFx1MjE5MiBgd2hvbGUtd3JpdGVgICh3aG9sZS1maWxlOyB0aGUgZmlsZSBubyBsb25nZXIgZXhpc3RzKVxuICogLSBgKioqIFVwZGF0ZSBGaWxlOmAgXHUyMTkyIGB3cml0ZWAgd2l0aCBhIHJlY292ZXJlZCBsaW5lIHJhbmdlIHdoZW4gdGhlIGh1bmsnc1xuICogICBwcmUtZWRpdCBibG9jayBjYW4gYmUgbG9jYXRlZCB2aWEgYHJlYWRQcmVFZGl0RmlsZWAsIG90aGVyd2lzZSBgd2hvbGUtd3JpdGVgLlxuICogICBBIHJlbmFtZWQgdXBkYXRlIChgKioqIE1vdmUgdG86YCkgYW5jaG9ycyB0aGUgZGVzdGluYXRpb24gcGF0aCBhc1xuICogICBgd2hvbGUtd3JpdGVgIHNpbmNlIHByZS1lZGl0IGxpbmUgbnVtYmVycyBjYW5ub3QgYmUgbWFwcGVkIGFjcm9zcyBhIHJlbmFtZS5cbiAqXG4gKiBOZXZlciB0aHJvd3M6IGEgbWFsZm9ybWVkIG9yIGVtcHR5IHBhdGNoIHlpZWxkcyBgW11gLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VBcHBseVBhdGNoKFxuICBjb21tYW5kOiBzdHJpbmcsXG4gIHJlYWRQcmVFZGl0RmlsZTogUmVhZFByZUVkaXRGaWxlID0gZGVmYXVsdFJlYWRQcmVFZGl0RmlsZVxuKTogQW5jaG9yU3BlY1tdIHtcbiAgY29uc3QgYW5jaG9yczogQW5jaG9yU3BlY1tdID0gW107XG5cbiAgZm9yIChjb25zdCBodW5rIG9mIHNjYW5IdW5rcyhjb21tYW5kKSkge1xuICAgIGlmIChodW5rLmtpbmQgPT09ICdhZGQnKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0b1Bvc2l4KGh1bmsucGF0aCksIGtpbmQ6ICdjcmVhdGUnIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChodW5rLmtpbmQgPT09ICdkZWxldGUnKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0b1Bvc2l4KGh1bmsucGF0aCksIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGU6IGFuY2hvciBvbiB0aGUgZGVzdGluYXRpb24gcGF0aCAocG9zdC1lZGl0IGxvY2F0aW9uKS5cbiAgICBjb25zdCB0YXJnZXRQYXRoID0gdG9Qb3NpeChodW5rLm1vdmVQYXRoID8/IGh1bmsucGF0aCk7XG5cbiAgICAvLyBBIHJlbmFtZSBkZWZlYXRzIHByZS1lZGl0IGxpbmUgbWFwcGluZyBcdTIwMTQgYW5jaG9yIHdob2xlLWZpbGUgb24gdGhlIHRhcmdldC5cbiAgICBpZiAoaHVuay5tb3ZlUGF0aCAhPT0gbnVsbCkge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dob2xlLXdyaXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFJhbmdlIHJlY292ZXJ5IHJlYWRzIHRoZSBwcmUtZWRpdCBjb250ZW50IGF0IHRoZSBvcmlnaW5hbCAocHJlLW1vdmUpIHBhdGguXG4gICAgY29uc3QgY29udGVudCA9IHJlYWRQcmVFZGl0RmlsZShodW5rLnBhdGgpO1xuICAgIGNvbnN0IHJhbmdlID0gY29udGVudCA9PT0gbnVsbCA/IG51bGwgOiByZWNvdmVyUmFuZ2Uoc3BsaXRMaW5lcyhjb250ZW50KSwgaHVuay5jaHVua3MpO1xuICAgIGlmIChyYW5nZSAhPT0gbnVsbCkge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dyaXRlJywgcmFuZ2UgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGFuY2hvcnM7XG59XG4iLCAiLyoqXG4gKiBDb2RleCBQb3N0VG9vbFVzZSB0b3VjaCBob29rIFx1MjAxNCBoZWFsICsgc3VyZmFjZSBhZnRlciBhIGNvbmZpcm1lZCBgYXBwbHlfcGF0Y2hgLFxuICogb3IgYSBzaGVsbC9leGVjIGNhbGwgd2hvc2UgY29tbWFuZCBzdGF0aWNhbGx5IHJlc29sdmVzIHRvIGZpbGUrbGluZSBpZGlvbXMuXG4gKlxuICogUG9zdFRvb2xVc2UgZmlyZXMgYWZ0ZXIgYGFwcGx5X3BhdGNoYCBoYXMgcnVuLCBzbyB0aGlzIGlzIHRoZSBhY2N1cmF0ZSBob21lIGZvclxuICogdGhlIHRvdWNoIHNpZ25hbDogdGhlIGZpbGUgaXMgYWxyZWFkeSB3cml0dGVuLCBzbyBhIHNjb3BlZCBgZ2l0IHNwYW4gc3RhbGVcbiAqIDxmaWxlPiAtLWZpeGAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBhZ2FpbnN0IHJlYWwgYnl0ZXMgYW5kIHRoZSBzdXJmYWNlZCBibG9ja1xuICogcmVmbGVjdHMgdGhlIGhlYWxlZCBhbmNob3JzLiBUaGUgaGFuZGxlciBuYXJyb3dzIHRoZSBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlXG4gKiAoYHRvb2xfaW5wdXQuY29tbWFuZGAsIFNESy10eXBlZCBgdW5rbm93bmApIGludG8gcGVyLWZpbGUgYW5jaG9ycyB2aWEgdGhlXG4gKiBzaGFyZWQgW2FwcGx5LXBhdGNoIHBhcnNlcl0oLi9hcHBseS1wYXRjaC50cyksIGFuZCByZWNvdmVycyBzaGVsbCBjb21tYW5kc1xuICogZnJvbSBlaXRoZXIgQ29kZXggZW52ZWxvcGUgKGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgSlNPTiBgYXJndW1lbnRzYCwgb3JcbiAqIGNvZGUtbW9kZSBgZXhlY2Agd3JhcHBpbmcgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgKSB2aWEgdGhlIHNoYXJlZFxuICogW2NvbW1hbmQgcGFyc2VyXSguLi9jb21tb24vcGFyc2UtY29tbWFuZC50cyk7IGVhY2ggdG91Y2hlZCBmaWxlIGlzIHNjb3BlZCB0b1xuICogdGhlIENXRCByZXBvLCBhbmQgZHJpdmVzIHRoZSBoYXJuZXNzLWFnbm9zdGljIHtAbGluayBydW5Ub3VjaEhvb2t9IGNvcmUgXHUyMDE0IHRoZVxuICogc2FtZSBjb3JlIHRoZSBDbGF1ZGUgYWRhcHRlciB1c2VzLlxuICpcbiAqIFR3byBDb2RleC1zcGVjaWZpYyBjb25jZXJucyBhcmUgcHJlc2VydmVkIGZyb20gdGhpcyBmaWxlJ3Mgam91cm5hbGluZ1xuICogcHJlZGVjZXNzb3I6XG4gKlxuICogMS4gKipTdWNjZXNzIGNsYXNzaWZpY2F0aW9uLioqIFRoZSBwYXJzZWQgZW52ZWxvcGUgZGVzY3JpYmVzICppbnRlbnQqLCBub3RcbiAqICAgICpvdXRjb21lKi4gQ29kZXggY29yZSBmaXJlcyBQb3N0VG9vbFVzZSBvbmx5IG9uIHRvb2wgc3VjY2VzcywgYnV0IGFzIGFcbiAqICAgIGR1cmFiaWxpdHkgYmVsdCB3ZSBjbGFzc2lmeSBgdG9vbF9yZXNwb25zZWAgdmlhXG4gKiAgICB7QGxpbmsgY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2V9OiBhIGNvbmZpcm1lZCByZWplY3Rpb24gKGAnZmFpbHVyZSdgKVxuICogICAgc3VwcHJlc3NlcyB0aGUgdG91Y2ggKG5vIHBoYW50b20gaGVhbC9zdXJmYWNlIG9uIGEgcGF0Y2ggdGhhdCBuZXZlclxuICogICAgYXBwbGllZCk7IGEgc3VjY2VzcyBvciBhbiB1bnJlY29nbml6ZWQgc2hhcGUgKGAndW5rbm93bidgLCB3YXJuZWQpIHByb2NlZWRzLlxuICogMi4gKipObyBwb3N0LWVkaXQgcmFuZ2UgcmVjb3ZlcnkgZnJvbSB0aGUgZW52ZWxvcGUuKiogUG9zdFRvb2xVc2UgcnVucyBhZnRlclxuICogICAgdGhlIHBhdGNoIHJld3JvdGUgdGhlIGZpbGUsIHNvIHRoZSBodW5rJ3MgcHJlLWVkaXQgYmxvY2sgbm8gbG9uZ2VyIHNpdHNcbiAqICAgIHdoZXJlIHRoZSBlZGl0IGhhcHBlbmVkIGFuZCBjb3VsZCBtaXMtYW5jaG9yIGEgZHVwbGljYXRlLiBUaGUgdG91Y2ggaXNcbiAqICAgIHNjb3BlZCBmaWxlLXdpZGUgKGB3cml0dGVuOiAnJ2AgXHUyMTkyIHdob2xlLWZpbGUpLCB3aGljaCBpcyBleGFjdGx5IHRoZVxuICogICAgYmVoYXZpb3Ige0BsaW5rIHJ1blRvdWNoSG9va30gdGFrZXMgZm9yIGFuIGVtcHR5IHdyaXRlLlxuICpcbiAqIFRoZSB0aW1lb3V0IGlzIG1pbGxpc2Vjb25kcyBpbiB0aGUgaGFuZGxlciBjb25maWcgKHRoZSBDTEkgZW1pdHMgYDEwYCBzZWNvbmRzKVxuICogXHUyMDE0IHNlZSB0aGUgdGltZW91dC11bml0cyBzcGlrZSBub3RlOyB0aGUgc291cmNlIHZhbHVlIG11c3Qgc3RheSBpbiBtcyBzbyB0aGVcbiAqIENvZGV4IGJ1aWxkJ3Mgc2Vjb25kcyBjb252ZXJzaW9uIGF0IGVtaXQgcmVtYWlucyBjb3JyZWN0LlxuICovXG5cbmltcG9ydCB7IHR5cGUgSG9va0NvbnRleHQsIHR5cGUgUG9zdFRvb2xVc2VJbnB1dCwgcG9zdFRvb2xVc2VIb29rLCBwb3N0VG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jb2RleC1ob29rcyc7XG5pbXBvcnQgeyBhYnNwYXRoQWdhaW5zdCB9IGZyb20gJy4uL2NvbW1vbi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgcGFyc2VDb21tYW5kRGV0YWlsZWQgfSBmcm9tICcuLi9jb21tb24vcGFyc2UtY29tbWFuZC5qcyc7XG5pbXBvcnQgeyBjcmVhdGVEaXNrTWVtb1N0b3JlLCB0eXBlIE1lbW9GYWN0b3J5LCByZXNvbHZlVG91Y2hTY29wZSB9IGZyb20gJy4uL2NvbW1vbi9zcGFuLXN1cmZhY2UuanMnO1xuaW1wb3J0IHtcbiAgY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzLFxuICBydW5Ub3VjaEhvb2ssXG4gIHR5cGUgVG91Y2hFeGVjdXRvcnMsXG4gIHR5cGUgVG91Y2hJbnB1dFxufSBmcm9tICcuLi9jb21tb24vdG91Y2gtY29yZS5qcyc7XG5pbXBvcnQgeyBwYXJzZUFwcGx5UGF0Y2ggfSBmcm9tICcuL2FwcGx5LXBhdGNoLmpzJztcblxuLyoqXG4gKiBUaGUgcHJlZml4IGFwcGx5X3BhdGNoJ3Mgc3Rkb3V0IGNhcnJpZXMgd2hlbiBcdTIwMTQgYW5kIG9ubHkgd2hlbiBcdTIwMTQgdGhlIHBhdGNoXG4gKiBhcHBsaWVkIChjb2RleC1ycy9hcHBseS1wYXRjaCBgcHJpbnRfc3VtbWFyeWApLiBDb2RleCBzdXJmYWNlcyB0aGF0IHN0ZG91dFxuICogdmVyYmF0aW0gYXMgdGhlIFBvc3RUb29sVXNlIGB0b29sX3Jlc3BvbnNlYCAoYSBiYXJlIHN0cmluZyB0b2RheSkuIEZpeGVkXG4gKiBhY3Jvc3MgQWRkL01vZGlmeS9EZWxldGU7IHRoZSBoZWFkZXIgaXMgZm9sbG93ZWQgYnkgYEEvTS9EIDxwYXRoPmAgbGluZXMuXG4gKi9cbmNvbnN0IEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYID0gJ1N1Y2Nlc3MuIFVwZGF0ZWQgdGhlIGZvbGxvd2luZyBmaWxlczonO1xuXG4vKipcbiAqIFRoZSBjb21tb24gZmllbGRzIGFuIG9iamVjdC13cmFwcGVkIHRvb2xfcmVzcG9uc2UgbWlnaHQgY2FycnkgdGhlIHRvb2wncyB0ZXh0XG4gKiBvdXRwdXQgdW5kZXIsIGlmIENvZGV4IGV2ZXIgc3RvcHMgc3VyZmFjaW5nIGl0IGFzIGEgYmFyZSBzdHJpbmcuIE9yZGVyZWQgYnlcbiAqIGxpa2VsaWhvb2Q7IHRoZSBmaXJzdCBmaWVsZCB3aG9zZSB2YWx1ZSBpcyBhIHN0cmluZyB3aW5zLlxuICovXG5jb25zdCBSRVNQT05TRV9URVhUX0ZJRUxEUyA9IFsnb3V0cHV0JywgJ3N0ZG91dCcsICdjb250ZW50JywgJ3RleHQnXSBhcyBjb25zdDtcblxuLyoqIE5hcnJvdyB0aGUgU0RLJ3MgYHVua25vd25gIHRvb2xfaW5wdXQgdG8gdGhlIGBhcHBseV9wYXRjaGAgYHsgY29tbWFuZCB9YCBzaGFwZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnY29tbWFuZCcgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgY29tbWFuZCA9ICh0b29sSW5wdXQgYXMgeyBjb21tYW5kOiB1bmtub3duIH0pLmNvbW1hbmQ7XG4gICAgaWYgKHR5cGVvZiBjb21tYW5kID09PSAnc3RyaW5nJykgcmV0dXJuIGNvbW1hbmQ7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogTmFycm93IHRoZSBjbGFzc2ljIGBleGVjX2NvbW1hbmRgIGVudmVsb3BlIChjbGlfdmVyc2lvbiBcdTIyNjQgMC4xMzAuMCk6XG4gKiBgdG9vbF9pbnB1dC5hcmd1bWVudHNgIGlzIGEgSlNPTiAqc3RyaW5nKiBvZiBzaGFwZVxuICogYHtcImNtZFwiOiBcIi4uLlwiLCBcIndvcmtkaXJcIjogXCIuLi5cIn1gIFx1MjAxNCBwYXJzZSBpdCBhbmQgcmV0dXJuIHRoZSBgY21kYC4gUmV0dXJuc1xuICogYG51bGxgIGZvciBhbnkgb3RoZXIgc2hhcGUgKG5vdCBKU09OLCBubyBgY21kYCBmaWVsZCwgb3Igbm90IHRoaXMgZW52ZWxvcGUpLlxuICovXG5mdW5jdGlvbiBuYXJyb3dFeGVjQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnYXJndW1lbnRzJyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBhcmdzID0gKHRvb2xJbnB1dCBhcyB7IGFyZ3VtZW50czogdW5rbm93biB9KS5hcmd1bWVudHM7XG4gICAgaWYgKHR5cGVvZiBhcmdzID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShhcmdzKTtcbiAgICAgICAgaWYgKHBhcnNlZCAhPT0gbnVsbCAmJiB0eXBlb2YgcGFyc2VkID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgcGFyc2VkLmNtZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICByZXR1cm4gcGFyc2VkLmNtZDtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBOYXJyb3cgdGhlIGNvZGUtbW9kZSBgZXhlY2AgZW52ZWxvcGUgKGNsaV92ZXJzaW9uIFx1MjI2NSAwLjE0NC4wKTpcbiAqIGB0b29sX2lucHV0LmlucHV0YCBpcyBKUyBzb3VyY2UgdGhhdCBjYWxscyBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgXHUyMDE0XG4gKiByZWNvdmVyIHRoZSBsaXRlcmFsIEpTT04tb2JqZWN0IGFyZ3VtZW50IHZpYSBiYWxhbmNlZC1icmFjZSBtYXRjaGluZy4gQVxuICogY29tbWFuZCBidWlsdCBmcm9tIHZhcmlhYmxlcyBvciB0ZW1wbGF0ZSBsaXRlcmFscyBpcyBzdGF0aWNhbGx5IHVucmVzb2x2YWJsZVxuICogYW5kIGNvcnJlY3RseSBvdXQgb2Ygc2NvcGUgXHUyMDE0IGBudWxsYC5cbiAqL1xuZnVuY3Rpb24gbmFycm93Q29kZU1vZGVFeGVjKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ICE9PSBudWxsICYmIHR5cGVvZiB0b29sSW5wdXQgPT09ICdvYmplY3QnICYmICdpbnB1dCcgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgaW5wdXQgPSAodG9vbElucHV0IGFzIHsgaW5wdXQ6IHVua25vd24gfSkuaW5wdXQ7XG4gICAgaWYgKHR5cGVvZiBpbnB1dCAhPT0gJ3N0cmluZycpIHJldHVybiBudWxsO1xuICAgIC8vIE1hdGNoIHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSkgXHUyMDE0IGV4dHJhY3QgdGhlIEpTT04gbGl0ZXJhbCBhcmd1bWVudFxuICAgIGNvbnN0IG1hdGNoID0gaW5wdXQubWF0Y2goL3Rvb2xzXFwuZXhlY19jb21tYW5kXFwoXFxzKihcXHsoPzpbXnt9XXxcXHsoPzpbXnt9XXxcXHtbXnt9XSpcXH0pKlxcfSkqXFx9KVxccypcXCkvKTtcbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShtYXRjaFsxXSk7XG4gICAgICBpZiAocGFyc2VkICE9PSBudWxsICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnICYmIHR5cGVvZiBwYXJzZWQuY21kID09PSAnc3RyaW5nJykge1xuICAgICAgICByZXR1cm4gcGFyc2VkLmNtZDtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBUb2xlcmFudGx5IHB1bGwgdGhlIHRvb2wncyB0ZXh0dWFsIG91dHB1dCBvdXQgb2YgYSBgdG9vbF9yZXNwb25zZWAgb2ZcbiAqIHVuY2VydGFpbiBzaGFwZSAoU0RLLXR5cGVkIGB1bmtub3duYCk6IGEgYmFyZSBzdHJpbmcgKHRvZGF5J3MgQ29kZXgpIGlzXG4gKiByZXR1cm5lZCBhcy1pczsgYW4gb2JqZWN0IGlzIHByb2JlZCBmb3IgdGhlIGZpcnN0IHtAbGluayBSRVNQT05TRV9URVhUX0ZJRUxEU31cbiAqIGVudHJ5IHRoYXQgaG9sZHMgYSBzdHJpbmcuIFJldHVybnMgYG51bGxgIHdoZW4gbm8gdGV4dCBjYW4gYmUgcmVjb3ZlcmVkXG4gKiAodW5rbm93biBvYmplY3Qgc2hhcGUsIGBudWxsYCwgb3IgYSBub24tc3RyaW5nL25vbi1vYmplY3QpLCB3aGljaCB0aGUgY2FsbGVyXG4gKiB0cmVhdHMgYXMgYW4gKnVucmVjb2duaXplZCogXHUyMDE0IG5vdCAqZmFpbGVkKiBcdTIwMTQgcmVzcG9uc2UuXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RSZXNwb25zZVRleHQodG9vbFJlc3BvbnNlOiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnc3RyaW5nJykgcmV0dXJuIHRvb2xSZXNwb25zZTtcbiAgaWYgKHRvb2xSZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnb2JqZWN0Jykge1xuICAgIGNvbnN0IHJlY29yZCA9IHRvb2xSZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBmb3IgKGNvbnN0IGZpZWxkIG9mIFJFU1BPTlNFX1RFWFRfRklFTERTKSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHJlY29yZFtmaWVsZF07XG4gICAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBDbGFzc2lmeSBhbiBgYXBwbHlfcGF0Y2hgIGB0b29sX3Jlc3BvbnNlYCBmb3IgdGhlIHRvdWNoIGdhdGU6XG4gKlxuICogLSBgJ3N1Y2Nlc3MnYCBcdTIwMTQgdGV4dCB3YXMgcmVjb3ZlcmVkIGFuZCBjYXJyaWVzIHtAbGluayBBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWH0uXG4gKiAtIGAnZmFpbHVyZSdgIFx1MjAxNCB0ZXh0IHdhcyByZWNvdmVyZWQgYnV0IGxhY2tzIHRoZSBoZWFkZXI6IGEgZ2VudWluZSByZWplY3Rpb25cbiAqICAgb3IgZXJyb3IuIFRoZSBPTkxZIGNsYXNzaWZpY2F0aW9uIHRoYXQgc3VwcHJlc3NlcyB0aGUgdG91Y2guXG4gKiAtIGAndW5rbm93bidgIFx1MjAxNCBubyB0ZXh0IGNvdWxkIGJlIHJlY292ZXJlZCAodW5yZWNvZ25pemVkIHNoYXBlKS4gV2UgcHJvY2VlZFxuICogICBkZWZlbnNpdmVseSBoZXJlIHJhdGhlciB0aGFuIHJpc2sgbWlzc2luZyBhIHJlYWwgZWRpdCdzIGhlYWwvc3VyZmFjZTsgQ29kZXhcbiAqICAgY29yZSBmaXJlcyBQb3N0VG9vbFVzZSBvbmx5IG9uIHN1Y2Nlc3MsIHNvIHRoaXMgY2Fubm90IGhlYWwvc3VyZmFjZSBhIHBhdGNoXG4gKiAgIHRoYXQgbmV2ZXIgYXBwbGllZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsYXNzaWZ5QXBwbHlQYXRjaFJlc3BvbnNlKHRvb2xSZXNwb25zZTogdW5rbm93bik6ICdzdWNjZXNzJyB8ICdmYWlsdXJlJyB8ICd1bmtub3duJyB7XG4gIGNvbnN0IHRleHQgPSBleHRyYWN0UmVzcG9uc2VUZXh0KHRvb2xSZXNwb25zZSk7XG4gIGlmICh0ZXh0ID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICByZXR1cm4gdGV4dC5zdGFydHNXaXRoKEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYKSA/ICdzdWNjZXNzJyA6ICdmYWlsdXJlJztcbn1cblxuLyoqIEEgcmVhZGVyIHRoYXQgYWx3YXlzIGRlY2xpbmVzLCBmb3JjaW5nIHRoZSBwYXJzZXIgdG8gd2hvbGUtZmlsZSBhbmNob3JzLiAqL1xuY29uc3Qgbm9SYW5nZVJlY292ZXJ5ID0gKCk6IG51bGwgPT4gbnVsbDtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMgPSBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMoKSxcbiAgbWVtb0ZhY3Rvcnk6IE1lbW9GYWN0b3J5ID0gY3JlYXRlRGlza01lbW9TdG9yZVxuKSB7XG4gIHJldHVybiBhc3luYyAoaW5wdXQ6IFBvc3RUb29sVXNlSW5wdXQsIGN0eDogSG9va0NvbnRleHQpID0+IHtcbiAgICAvLyBEaWFnbm9zdGljIGNhcHR1cmUgZm9yIHRoZSBjb2RlLW1vZGUgYXBwbHlfcGF0Y2ggYmxpbmQtc3BvdCBjaGVjayAoY2FyZFxuICAgIC8vIG5vbi1nb2FsOiByZXBvcnQsIGRvbid0IGZpeCk6IGEgY29kZS1tb2RlIGFwcGx5X3BhdGNoIGlzIHdyYXBwZWQgaW5zaWRlIGFcbiAgICAvLyBjdXN0b21fdG9vbF9jYWxsIFwiZXhlY1wiIGJvZHkgYXMgdG9vbHMuYXBwbHlfcGF0Y2goLi4uKSwgc28gdGhlIGhvb2sgbG9nXG4gICAgLy8gc2hvd3Mgd2hldGhlciBpdCBhcnJpdmVzIGhlcmUgYXMgdG9vbF9uYW1lICdhcHBseV9wYXRjaCcgKGNsZWFuIFx1MjAxNCB0aGVcbiAgICAvLyBhZGFwdGVyIGJlbG93IHdvcmtzKSBvciB0b29sX25hbWUgJ2V4ZWMnICh3cmFwcGVkIFx1MjAxNCB0aGUgYWRhcHRlciBpcyBibGluZCkuXG4gICAgY3R4LmxvZ2dlci5pbmZvKCdnaXQtc3BhbiBwb3N0LXRvb2wtdXNlIG9ic2VydmVkIHRvb2wnLCB7XG4gICAgICB0b29sX25hbWU6IGlucHV0LnRvb2xfbmFtZSxcbiAgICAgIHRvb2xfaW5wdXRfdHlwZTogdHlwZW9mIGlucHV0LnRvb2xfaW5wdXQsXG4gICAgICB0b29sX2lucHV0X2tleXM6XG4gICAgICAgIGlucHV0LnRvb2xfaW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIGlucHV0LnRvb2xfaW5wdXQgPT09ICdvYmplY3QnXG4gICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX2lucHV0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgfSk7XG5cbiAgICBjb25zdCB0b29sX25hbWUgPSBpbnB1dC50b29sX25hbWU7XG4gICAgY29uc3QgY3dkID0gaW5wdXQuY3dkID8/ICcnO1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IGlucHV0LnNlc3Npb25faWQ7XG4gICAgY29uc3QgbWVtbyA9IG1lbW9GYWN0b3J5KGN0eC5sb2dnZXIpO1xuXG4gICAgLy8gU2hlbGwgdG91Y2g6IGV4dHJhY3QgdGhlIGNvbW1hbmQgZnJvbSBlaXRoZXIgZW52ZWxvcGUgc2hhcGUsIHBhcnNlLCBhbmRcbiAgICAvLyBydW4gZWFjaCByZXNvbHZlZCBzcGFuIHRocm91Z2ggdGhlIHNoYXJlZCB0b3VjaCBjb3JlIFx1MjAxNCBzYW1lIHBhdHRlcm4gYXNcbiAgICAvLyBhcHBseV9wYXRjaCBidXQgZHJpdmVuIGJ5IHRoZSBzdGF0aWMgY29tbWFuZCBwYXJzZXIgaW5zdGVhZCBvZiB0aGUgcGF0Y2hcbiAgICAvLyBwYXJzZXIuIEEgY29tbWFuZCB3aXRoIG5vIHJlY29nbml6ZWQgaWRpb20geWllbGRzIG5vIGJsb2NrcyBhbmQgcmV0dXJuc1xuICAgIC8vIHVuZGVmaW5lZCBcdTIwMTQgZmFpbC1vcGVuLCBzYW1lIGFzIHRoZSBhcHBseV9wYXRjaCBwYXRoIGJlbG93LlxuICAgIGlmICh0b29sX25hbWUgPT09ICdleGVjX2NvbW1hbmQnIHx8IHRvb2xfbmFtZSA9PT0gJ2V4ZWMnKSB7XG4gICAgICBjb25zdCBjb21tYW5kID0gbmFycm93RXhlY0NvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCkgPz8gbmFycm93Q29kZU1vZGVFeGVjKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgICAgaWYgKCFjb21tYW5kKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBtYXRjaGVzID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgY3dkKTtcbiAgICAgIGNvbnN0IGJsb2Nrczogc3RyaW5nW10gPSBbXTtcbiAgICAgIGZvciAoY29uc3QgbWF0Y2ggb2YgbWF0Y2hlcykge1xuICAgICAgICBpZiAobWF0Y2guc3RhdHVzICE9PSAncmVzb2x2ZWQnKSBjb250aW51ZTtcbiAgICAgICAgY29uc3Qgc3BhbiA9IG1hdGNoLnNwYW47XG4gICAgICAgIGNvbnN0IGFic1BhdGggPSBhYnNwYXRoQWdhaW5zdChjd2QsIHNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICAgICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgICAgICBpZiAoIXNjb3BlKSBjb250aW51ZTtcbiAgICAgICAgbGV0IHRvdWNoSW5wdXQ6IHtcbiAgICAgICAgICBraW5kOiAncmVhZCcgfCAnd3JpdGUnO1xuICAgICAgICAgIHNlc3Npb25JZDogc3RyaW5nO1xuICAgICAgICAgIGN3ZDogc3RyaW5nO1xuICAgICAgICAgIGZpbGVQYXRoOiBzdHJpbmc7XG4gICAgICAgICAgb2Zmc2V0PzogbnVtYmVyO1xuICAgICAgICAgIGxpbWl0PzogbnVtYmVyO1xuICAgICAgICAgIHdyaXR0ZW4/OiBzdHJpbmc7XG4gICAgICAgIH07XG4gICAgICAgIGlmIChtYXRjaC5pZGlvbSA9PT0gJ2hlcmVkb2Mtd3JpdGUnKSB7XG4gICAgICAgICAgdG91Y2hJbnB1dCA9IHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2QsIGZpbGVQYXRoOiBhYnNQYXRoLCB3cml0dGVuOiAnJyB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRvdWNoSW5wdXQgPSB7XG4gICAgICAgICAgICBraW5kOiAncmVhZCcsXG4gICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICBjd2QsXG4gICAgICAgICAgICBmaWxlUGF0aDogYWJzUGF0aCxcbiAgICAgICAgICAgIG9mZnNldDogc3Bhbi5saW5lU3RhcnQsXG4gICAgICAgICAgICBsaW1pdDogc3Bhbi5saW5lRW5kIC0gc3Bhbi5saW5lU3RhcnQgKyAxXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2sodG91Y2hJbnB1dCBhcyBUb3VjaElucHV0LCBleGVjdXRvcnMsIG1lbW8pO1xuICAgICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgICAgfVxuICAgICAgaWYgKGJsb2Nrcy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICBjb25zdCBjb21iaW5lZCA9IGJsb2Nrcy5qb2luKCcnKTtcbiAgICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiBjb21iaW5lZCwgc3lzdGVtTWVzc2FnZTogY29tYmluZWQgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgY29tbWFuZCA9IG5hcnJvd0FwcGx5UGF0Y2hDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgIGlmIChjb21tYW5kID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgLy8gU3VwcHJlc3Mgb25seSBhICpjb25maXJtZWQqIG5vbi1zdWNjZXNzLiBBbiB1bnJlY29nbml6ZWQgcmVzcG9uc2Ugc2hhcGVcbiAgICAvLyBwcm9jZWVkcyAod2l0aCBhIHdhcm5pbmcpIHJhdGhlciB0aGFuIHJpc2sgc2tpcHBpbmcgYSByZWFsIGVkaXQncyB0b3VjaC5cbiAgICBjb25zdCBjbGFzc2lmaWNhdGlvbiA9IGNsYXNzaWZ5QXBwbHlQYXRjaFJlc3BvbnNlKGlucHV0LnRvb2xfcmVzcG9uc2UpO1xuICAgIGlmIChjbGFzc2lmaWNhdGlvbiA9PT0gJ2ZhaWx1cmUnKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmIChjbGFzc2lmaWNhdGlvbiA9PT0gJ3Vua25vd24nKSB7XG4gICAgICBjdHgubG9nZ2VyLndhcm4oJ0NvZGV4IGFwcGx5X3BhdGNoIHRvb2xfcmVzcG9uc2Ugc2hhcGUgdW5yZWNvZ25pemVkOyBydW5uaW5nIHRvdWNoIGRlZmVuc2l2ZWx5Jywge1xuICAgICAgICB0b29sUmVzcG9uc2VUeXBlOiB0eXBlb2YgaW5wdXQudG9vbF9yZXNwb25zZSxcbiAgICAgICAgdG9vbFJlc3BvbnNlS2V5czpcbiAgICAgICAgICBpbnB1dC50b29sX3Jlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiBpbnB1dC50b29sX3Jlc3BvbnNlID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX3Jlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIE9uZSBlbnZlbG9wZSBtYXkgdG91Y2ggc2V2ZXJhbCBmaWxlczsgZm9yY2Ugd2hvbGUtZmlsZSBhbmNob3JzIChDb2RleCBuZXZlclxuICAgIC8vIHJlY292ZXJzIGEgcG9zdC1lZGl0IHJhbmdlKSBhbmQgcnVuIHRoZSBzaGFyZWQgdG91Y2ggY29yZSBwZXIgdG91Y2hlZCBmaWxlLlxuICAgIC8vIFRoZSBzaGFyZWQgbWVtbyBkZWR1cGVzIHNwYW4gcmVuZGVycyBhY3Jvc3MgYW5jaG9ycyBhbmQgdGhlIHNlc3Npb24uXG4gICAgY29uc3QgYW5jaG9ycyA9IHBhcnNlQXBwbHlQYXRjaChjb21tYW5kLCBub1JhbmdlUmVjb3ZlcnkpO1xuICAgIGNvbnN0IGJsb2Nrczogc3RyaW5nW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IGFuY2hvciBvZiBhbmNob3JzKSB7XG4gICAgICBjb25zdCBhYnNQYXRoID0gYWJzcGF0aEFnYWluc3QoY3dkLCBhbmNob3IucGF0aCk7XG4gICAgICBjb25zdCBzY29wZSA9IHJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgYWJzUGF0aCk7XG4gICAgICBpZiAoIXNjb3BlKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1blRvdWNoSG9vayhcbiAgICAgICAgeyBraW5kOiAnd3JpdGUnLCBzZXNzaW9uSWQsIGN3ZCwgZmlsZVBhdGg6IGFic1BhdGgsIHdyaXR0ZW46ICcnIH0sXG4gICAgICAgIGV4ZWN1dG9ycyxcbiAgICAgICAgbWVtb1xuICAgICAgKTtcbiAgICAgIGlmIChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIGJsb2Nrcy5wdXNoKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2Nrcy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgcmV0dXJuIHBvc3RUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IGNvbWJpbmVkLCBzeXN0ZW1NZXNzYWdlOiBjb21iaW5lZCB9KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgcG9zdFRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ2FwcGx5X3BhdGNofGV4ZWNfY29tbWFuZHxleGVjJywgdGltZW91dDogMTBfMDAwIH0sIGNyZWF0ZUhhbmRsZXIoKSk7XG4iLCAiaW1wb3J0IGhvb2sgZnJvbSBcIi4vcG9zdC10b29sLXVzZS50c1wiO1xuaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gXCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qc1wiO1xuZXhlY3V0ZShob29rKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUE0Qk8sSUFBTSwwQkFBMEIsb0JBQUksSUFBSSxDQUFDLGdCQUFnQixvQkFBb0IsZUFBZSxDQUFDOzs7QUM1QnBHLFNBQVMsZUFBZSxlQUFlLFFBQVEsU0FBUztBQUNwRCxRQUFNLE9BQU87QUFDYixPQUFLLGdCQUFnQjtBQUNyQixPQUFLLFVBQVUsT0FBTztBQUN0QixPQUFLLGdCQUFnQixPQUFPO0FBQzVCLE1BQUksYUFBYSxVQUFVLE9BQU8sT0FBTyxZQUFZLFVBQVU7QUFDM0QsU0FBSyxVQUFVLE9BQU87QUFBQSxFQUMxQjtBQUNBLFNBQU87QUFDWDtBQUlPLFNBQVMsZ0JBQWdCLFFBQVEsU0FBUztBQUM3QyxTQUFPLGVBQWUsZUFBZSxRQUFRLE9BQU87QUFDeEQ7OztBQ2ZBLFNBQVMsV0FBVyxZQUFZLFdBQVcsVUFBVSxpQkFBaUI7QUFDdEUsU0FBUyxlQUFlO0FBQ3hCLElBQU0sc0JBQXNCO0FBQ3JCLElBQU0sU0FBTixNQUFhO0FBQUEsRUFDaEIsV0FBVyxvQkFBSSxJQUFJO0FBQUEsRUFDbkIsa0JBQWtCO0FBQUEsRUFDbEIsWUFBWTtBQUFBLEVBQ1osY0FBYztBQUFBLEVBQ2Q7QUFBQSxFQUNBO0FBQUEsRUFDQSxZQUFZLFNBQVMsQ0FBQyxHQUFHO0FBQ3JCLFNBQUssY0FBYyxPQUFPLGVBQWUsUUFBUSxJQUFJLE9BQU8sYUFBYSxtQkFBbUIsS0FBSztBQUFBLEVBQ3JHO0FBQUEsRUFDQSxXQUFXLFVBQVUsT0FBTztBQUN4QixTQUFLLGtCQUFrQjtBQUN2QixTQUFLLGVBQWU7QUFBQSxFQUN4QjtBQUFBLEVBQ0EsZUFBZTtBQUNYLFNBQUssa0JBQWtCO0FBQ3ZCLFNBQUssZUFBZTtBQUFBLEVBQ3hCO0FBQUEsRUFDQSxHQUFHLE9BQU8sU0FBUztBQUNmLFVBQU0sV0FBVyxLQUFLLFNBQVMsSUFBSSxLQUFLLEtBQUssb0JBQUksSUFBSTtBQUNyRCxhQUFTLElBQUksT0FBTztBQUNwQixTQUFLLFNBQVMsSUFBSSxPQUFPLFFBQVE7QUFDakMsV0FBTyxNQUFNO0FBQ1QsZUFBUyxPQUFPLE9BQU87QUFDdkIsVUFBSSxTQUFTLFNBQVMsR0FBRztBQUNyQixhQUFLLFNBQVMsT0FBTyxLQUFLO0FBQUEsTUFDOUI7QUFBQSxJQUNKO0FBQUEsRUFDSjtBQUFBLEVBQ0EsTUFBTSxTQUFTLFNBQVM7QUFDcEIsU0FBSyxLQUFLLFNBQVMsU0FBUyxPQUFPO0FBQUEsRUFDdkM7QUFBQSxFQUNBLEtBQUssU0FBUyxTQUFTO0FBQ25CLFNBQUssS0FBSyxRQUFRLFNBQVMsT0FBTztBQUFBLEVBQ3RDO0FBQUEsRUFDQSxLQUFLLFNBQVMsU0FBUztBQUNuQixTQUFLLEtBQUssUUFBUSxTQUFTLE9BQU87QUFBQSxFQUN0QztBQUFBLEVBQ0EsTUFBTSxTQUFTLFNBQVM7QUFDcEIsU0FBSyxLQUFLLFNBQVMsU0FBUyxPQUFPO0FBQUEsRUFDdkM7QUFBQSxFQUNBLFNBQVMsT0FBTyxTQUFTLFNBQVM7QUFDOUIsU0FBSyxLQUFLLFNBQVMsR0FBRyxPQUFPLEtBQUssaUJBQWlCLFFBQVEsTUFBTSxVQUFVLE9BQU8sS0FBSyxDQUFDLElBQUksT0FBTztBQUFBLEVBQ3ZHO0FBQUEsRUFDQSxRQUFRO0FBQ0osUUFBSSxLQUFLLGNBQWMsTUFBTTtBQUN6QixnQkFBVSxLQUFLLFNBQVM7QUFDeEIsV0FBSyxZQUFZO0FBQUEsSUFDckI7QUFBQSxFQUNKO0FBQUEsRUFDQSxLQUFLLE9BQU8sU0FBUyxTQUFTO0FBQzFCLFVBQU0sUUFBUTtBQUFBLE1BQ1YsWUFBVyxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLE1BQ2xDO0FBQUEsTUFDQSxVQUFVLEtBQUs7QUFBQSxNQUNmO0FBQUEsTUFDQSxHQUFJLEtBQUssaUJBQWlCLFNBQVksRUFBRSxPQUFPLEtBQUssYUFBYSxJQUFJLENBQUM7QUFBQSxNQUN0RSxHQUFJLFlBQVksU0FBWSxFQUFFLFFBQVEsSUFBSSxDQUFDO0FBQUEsSUFDL0M7QUFDQSxTQUFLLFlBQVksS0FBSztBQUN0QixTQUFLLFNBQVMsSUFBSSxLQUFLLEdBQUcsUUFBUSxDQUFDLFlBQVk7QUFDM0MsY0FBUSxLQUFLO0FBQUEsSUFDakIsQ0FBQztBQUFBLEVBQ0w7QUFBQSxFQUNBLFlBQVksT0FBTztBQUNmLFFBQUksS0FBSyxnQkFBZ0IsTUFBTTtBQUMzQjtBQUFBLElBQ0o7QUFDQSxRQUFJLENBQUMsS0FBSyxpQkFBaUI7QUFDdkIsV0FBSyxrQkFBa0I7QUFDdkIsWUFBTSxTQUFTLFFBQVEsS0FBSyxXQUFXO0FBQ3ZDLFVBQUksQ0FBQyxXQUFXLE1BQU0sR0FBRztBQUNyQixrQkFBVSxRQUFRLEVBQUUsV0FBVyxLQUFLLENBQUM7QUFBQSxNQUN6QztBQUNBLFdBQUssWUFBWSxTQUFTLEtBQUssYUFBYSxHQUFHO0FBQUEsSUFDbkQ7QUFDQSxRQUFJLEtBQUssY0FBYyxNQUFNO0FBQ3pCLGdCQUFVLEtBQUssV0FBVyxHQUFHLEtBQUssVUFBVSxLQUFLLENBQUM7QUFBQSxDQUFJO0FBQUEsSUFDMUQ7QUFBQSxFQUNKO0FBQ0o7QUFDTyxJQUFNLFNBQVMsSUFBSSxPQUFPOzs7QUNwRjFCLElBQU0sYUFBYTtBQUFBLEVBQ3RCLFNBQVM7QUFBQSxFQUNULE9BQU87QUFBQSxFQUNQLE9BQU87QUFDWDtBQUNPLElBQU0sYUFBTixjQUF5QixNQUFNO0FBQUEsRUFDbEM7QUFBQSxFQUNBLFlBQVksUUFBUTtBQUNoQixVQUFNLE1BQU07QUFDWixTQUFLLE9BQU87QUFDWixTQUFLLFNBQVM7QUFBQSxFQUNsQjtBQUNKO0FBQ0EsU0FBUyxjQUFjLE9BQU87QUFDMUIsU0FBTyxPQUFPLFlBQVksT0FBTyxRQUFRLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxFQUFFLEtBQUssTUFBTSxVQUFVLE1BQVMsQ0FBQztBQUM5RjtBQUNBLFNBQVMsWUFBWSxNQUFNLFFBQVEsUUFBUTtBQUN2QyxTQUFPO0FBQUEsSUFDSCxPQUFPO0FBQUEsSUFDUCxRQUFRLGNBQWMsTUFBTTtBQUFBLElBQzVCLEdBQUksV0FBVyxTQUFZLEVBQUUsT0FBTyxJQUFJLENBQUM7QUFBQSxFQUM3QztBQUNKO0FBbUNPLFNBQVMsa0JBQWtCLFVBQVUsQ0FBQyxHQUFHO0FBQzVDLFFBQU0sY0FBYyxRQUFRLHNCQUFzQixVQUFhLFFBQVEseUJBQXlCO0FBQ2hHLFFBQU0scUJBQXFCLGNBQ3JCLGNBQWM7QUFBQSxJQUNaLGVBQWU7QUFBQSxJQUNmLG1CQUFtQixRQUFRO0FBQUEsSUFDM0Isc0JBQXNCLFFBQVE7QUFBQSxFQUNsQyxDQUFDLElBQ0M7QUFDTixTQUFPLFlBQVksZUFBZTtBQUFBLElBQzlCLFVBQVUsUUFBUTtBQUFBLElBQ2xCLFlBQVksUUFBUTtBQUFBLElBQ3BCLGdCQUFnQixRQUFRO0FBQUEsSUFDeEIsZUFBZSxRQUFRO0FBQUEsSUFDdkIsVUFBVSxRQUFRO0FBQUEsSUFDbEIsUUFBUSxRQUFRO0FBQUEsSUFDaEI7QUFBQSxFQUNKLENBQUM7QUFDTDtBQXFCTyxTQUFTLHVCQUF1QixVQUFVLENBQUMsR0FBRztBQUNqRCxRQUFNLHFCQUFxQixRQUFRLHNCQUFzQixTQUNuRDtBQUFBLElBQ0UsZUFBZTtBQUFBLElBQ2YsbUJBQW1CLFFBQVE7QUFBQSxFQUMvQixJQUNFO0FBQ04sU0FBTyxZQUFZLG9CQUFvQjtBQUFBLElBQ25DLFVBQVUsUUFBUTtBQUFBLElBQ2xCLFlBQVksUUFBUTtBQUFBLElBQ3BCLGdCQUFnQixRQUFRO0FBQUEsSUFDeEIsZUFBZSxRQUFRO0FBQUEsSUFDdkIsVUFBVSxRQUFRO0FBQUEsSUFDbEIsUUFBUSxRQUFRO0FBQUEsSUFDaEI7QUFBQSxFQUNKLENBQUM7QUFDTDtBQUNPLFNBQVMsbUJBQW1CLFVBQVUsQ0FBQyxHQUFHO0FBQzdDLFFBQU0scUJBQXFCLFFBQVEsc0JBQXNCLFNBQ25EO0FBQUEsSUFDRSxlQUFlO0FBQUEsSUFDZixtQkFBbUIsUUFBUTtBQUFBLEVBQy9CLElBQ0U7QUFDTixTQUFPLFlBQVksZ0JBQWdCO0FBQUEsSUFDL0IsVUFBVSxRQUFRO0FBQUEsSUFDbEIsWUFBWSxRQUFRO0FBQUEsSUFDcEIsZ0JBQWdCLFFBQVE7QUFBQSxJQUN4QixlQUFlLFFBQVE7QUFBQSxJQUN2QjtBQUFBLEVBQ0osQ0FBQztBQUNMO0FBQ08sU0FBUyxvQkFBb0IsVUFBVSxDQUFDLEdBQUc7QUFDOUMsUUFBTSxxQkFBcUIsUUFBUSxzQkFBc0IsU0FDbkQ7QUFBQSxJQUNFLGVBQWU7QUFBQSxJQUNmLG1CQUFtQixRQUFRO0FBQUEsRUFDL0IsSUFDRTtBQUNOLFNBQU8sWUFBWSxpQkFBaUI7QUFBQSxJQUNoQyxVQUFVLFFBQVE7QUFBQSxJQUNsQixZQUFZLFFBQVE7QUFBQSxJQUNwQixnQkFBZ0IsUUFBUTtBQUFBLElBQ3hCLGVBQWUsUUFBUTtBQUFBLElBQ3ZCO0FBQUEsRUFDSixDQUFDO0FBQ0w7OztBQzNJQSxlQUFlLFlBQVk7QUFDdkIsU0FBTyxJQUFJLFFBQVEsQ0FBQ0EsVUFBUyxXQUFXO0FBQ3BDLFVBQU0sU0FBUyxDQUFDO0FBQ2hCLFlBQVEsTUFBTSxZQUFZLE9BQU87QUFDakMsWUFBUSxNQUFNLEdBQUcsUUFBUSxDQUFDLFVBQVUsT0FBTyxLQUFLLEtBQUssQ0FBQztBQUN0RCxZQUFRLE1BQU0sR0FBRyxPQUFPLE1BQU1BLFNBQVEsT0FBTyxLQUFLLEVBQUUsQ0FBQyxDQUFDO0FBQ3RELFlBQVEsTUFBTSxHQUFHLFNBQVMsTUFBTTtBQUFBLEVBQ3BDLENBQUM7QUFDTDtBQUNBLFNBQVMsZ0JBQWdCLGNBQWM7QUFDbkMsU0FBTyxLQUFLLE1BQU0sWUFBWTtBQUNsQztBQUNBLFNBQVMsWUFBWSxRQUFRO0FBQ3pCLFVBQVEsT0FBTyxNQUFNLEtBQUssVUFBVSxPQUFPLE1BQU0sQ0FBQztBQUN0RDtBQUNBLFNBQVMsc0JBQXNCLGVBQWUsUUFBUTtBQUNsRCxNQUFJLENBQUMsd0JBQXdCLElBQUksYUFBYSxHQUFHO0FBQzdDLFVBQU0sSUFBSSxNQUFNLEdBQUcsYUFBYSxpQ0FBaUM7QUFBQSxFQUNyRTtBQUNBLE1BQUksa0JBQWtCLGdCQUFnQjtBQUNsQyxXQUFPLG1CQUFtQixFQUFFLG1CQUFtQixPQUFPLENBQUM7QUFBQSxFQUMzRDtBQUNBLE1BQUksa0JBQWtCLGlCQUFpQjtBQUNuQyxXQUFPLG9CQUFvQixFQUFFLG1CQUFtQixPQUFPLENBQUM7QUFBQSxFQUM1RDtBQUNBLFNBQU8sdUJBQXVCLEVBQUUsbUJBQW1CLE9BQU8sQ0FBQztBQUMvRDtBQUNPLFNBQVMsb0JBQW9CLFFBQVE7QUFDeEMsU0FBTyxPQUFPLFdBQVcsU0FBWSxFQUFFLFFBQVEsT0FBTyxRQUFRLFFBQVEsT0FBTyxPQUFPLElBQUksRUFBRSxRQUFRLE9BQU8sT0FBTztBQUNwSDtBQUNBLGVBQXNCLFFBQVEsUUFBUTtBQUNsQyxNQUFJO0FBQ0EsVUFBTSxlQUFlLE1BQU0sVUFBVTtBQUNyQyxVQUFNLFFBQVEsZ0JBQWdCLFlBQVk7QUFDMUMsV0FBTyxXQUFXLE9BQU8sZUFBZSxLQUFLO0FBQzdDLFVBQU0sVUFBVSxFQUFFLE9BQU87QUFDekIsVUFBTSxTQUFTLE1BQU0sT0FBTyxPQUFPLE9BQU87QUFDMUMsUUFBSSxTQUFTLEVBQUUsUUFBUSxDQUFDLEVBQUU7QUFDMUIsUUFBSSxPQUFPLFdBQVcsVUFBVTtBQUM1QixlQUFTLG9CQUFvQixzQkFBc0IsT0FBTyxlQUFlLE1BQU0sQ0FBQztBQUFBLElBQ3BGLFdBQ1MsV0FBVyxRQUFXO0FBQzNCLGVBQVMsb0JBQW9CLE1BQU07QUFBQSxJQUN2QztBQUNBLGdCQUFZLE1BQU07QUFDbEIsWUFBUSxLQUFLLFdBQVcsT0FBTztBQUFBLEVBQ25DLFNBQ08sT0FBTztBQUNWLFFBQUksaUJBQWlCLFlBQVk7QUFDN0IsY0FBUSxPQUFPLE1BQU0sR0FBRyxNQUFNLE1BQU07QUFBQSxDQUFJO0FBQ3hDLGNBQVEsS0FBSyxXQUFXLEtBQUs7QUFBQSxJQUNqQztBQUNBLFFBQUksaUJBQWlCLE9BQU87QUFDeEIsY0FBUSxPQUFPLE1BQU0sR0FBRyxNQUFNLFNBQVMsTUFBTSxPQUFPO0FBQUEsQ0FBSTtBQUFBLElBQzVELE9BQ0s7QUFDRCxjQUFRLE9BQU8sTUFBTSxHQUFHLE9BQU8sS0FBSyxDQUFDO0FBQUEsQ0FBSTtBQUFBLElBQzdDO0FBQ0EsWUFBUSxLQUFLLFdBQVcsS0FBSztBQUFBLEVBQ2pDLFVBQ0E7QUFDSSxXQUFPLGFBQWE7QUFDcEIsV0FBTyxNQUFNO0FBQUEsRUFDakI7QUFDSjs7O0FDMURBLFNBQVMsb0JBQW9CO0FBQzdCLFlBQVksUUFBUTtBQUNwQixZQUFZLFFBQVE7QUFDcEIsWUFBWSxjQUFjO0FBTW5CLFNBQVMsUUFBUSxHQUFtQjtBQUN6QyxTQUFPLEVBQUUsUUFBUSxPQUFPLEdBQUc7QUFDN0I7QUFFQSxTQUFTLGdCQUFnQixHQUFvQjtBQUMzQyxTQUFPLEVBQUUsV0FBVyxHQUFHLEtBQUssZUFBZSxLQUFLLENBQUM7QUFDbkQ7QUFFTyxTQUFTLGVBQWUsTUFBYyxRQUF3QjtBQUNuRSxRQUFNLElBQUksUUFBUSxNQUFNO0FBQ3hCLE1BQUksZ0JBQWdCLENBQUMsRUFBRyxRQUFPO0FBQy9CLFFBQU0sSUFBSSxRQUFRLElBQUksRUFBRSxRQUFRLFFBQVEsRUFBRTtBQUMxQyxTQUFPLEdBQUcsQ0FBQyxJQUFJLENBQUM7QUFDbEI7QUFFTyxTQUFTLGdCQUFnQixLQUErQztBQUM3RSxNQUFJLENBQUMsSUFBSyxRQUFPO0FBQ2pCLE1BQUk7QUFDRixVQUFNLE1BQU0sYUFBYSxPQUFPLENBQUMsTUFBTSxLQUFLLGFBQWEsaUJBQWlCLEdBQUc7QUFBQSxNQUMzRSxPQUFPLENBQUMsVUFBVSxRQUFRLFFBQVE7QUFBQSxNQUNsQyxVQUFVO0FBQUEsSUFDWixDQUFDO0FBQ0QsVUFBTSxVQUFVLElBQUksS0FBSztBQUN6QixXQUFPLFFBQVEsU0FBUyxJQUFJLFFBQVEsT0FBTyxJQUFJO0FBQUEsRUFDakQsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFrQk8sSUFBTSxZQUFZO0FBY2xCLFNBQVMsZ0JBQWdCLFVBQTBCO0FBQ3hELFFBQU0sU0FBUyxRQUFRLElBQUksY0FBYztBQUN6QyxNQUFJLFVBQVUsT0FBTyxLQUFLLEVBQUUsU0FBUyxHQUFHO0FBQ3RDLFdBQU8sUUFBUSxPQUFPLEtBQUssQ0FBQyxFQUFFLFFBQVEsUUFBUSxFQUFFO0FBQUEsRUFDbEQ7QUFDQSxNQUFJO0FBQ0YsVUFBTSxNQUFNLGFBQWEsT0FBTyxDQUFDLE1BQU0sVUFBVSxVQUFVLGNBQWMsR0FBRztBQUFBLE1BQzFFLE9BQU8sQ0FBQyxVQUFVLFFBQVEsUUFBUTtBQUFBLE1BQ2xDLFVBQVU7QUFBQSxJQUNaLENBQUM7QUFDRCxVQUFNLFVBQVUsUUFBUSxJQUFJLEtBQUssQ0FBQyxFQUFFLFFBQVEsUUFBUSxFQUFFO0FBQ3RELFFBQUksUUFBUSxTQUFTLEVBQUcsUUFBTztBQUFBLEVBQ2pDLFNBQVMsS0FBSztBQUNaLFNBQUs7QUFBQSxFQUNQO0FBQ0EsU0FBTztBQUNUO0FBVU8sU0FBUyxpQkFBaUIsYUFBcUIsV0FBbUIsV0FBb0I7QUFDM0YsUUFBTSxPQUFPLFNBQVMsUUFBUSxRQUFRLEVBQUU7QUFDeEMsU0FBTyxnQkFBZ0IsUUFBUSxZQUFZLFdBQVcsR0FBRyxJQUFJLEdBQUc7QUFDbEU7QUFFTyxTQUFTLGFBQWEsVUFBa0IsYUFBOEI7QUFDM0UsTUFBSTtBQUNGLGlCQUFhLE9BQU8sQ0FBQyxNQUFNLFVBQVUsZ0JBQWdCLE1BQU0sTUFBTSxXQUFXLEdBQUc7QUFBQSxNQUM3RSxPQUFPLENBQUMsVUFBVSxVQUFVLFFBQVE7QUFBQSxJQUN0QyxDQUFDO0FBQ0QsV0FBTztBQUFBLEVBQ1QsU0FBUyxLQUFLO0FBQ1osU0FBSztBQUNMLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFFTyxTQUFTLGVBQWUsVUFBa0IsU0FBeUI7QUFDeEUsUUFBTSxPQUFPLFFBQVEsUUFBUTtBQUM3QixRQUFNLE1BQU0sUUFBUSxPQUFPO0FBQzNCLFFBQU0sU0FBUyxLQUFLLFNBQVMsR0FBRyxJQUFJLE9BQU8sR0FBRyxJQUFJO0FBQ2xELFNBQU8sSUFBSSxXQUFXLE1BQU0sSUFBSSxJQUFJLE1BQU0sT0FBTyxNQUFNLElBQUk7QUFDN0Q7QUFrQ08sU0FBUyxnQkFBZ0IsR0FBYyxHQUF1QjtBQUNuRSxTQUFPLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUU7QUFDeEM7QUFhTyxTQUFTLGVBQWUsUUFBZ0M7QUFDN0QsUUFBTSxPQUF1QixDQUFDO0FBQzlCLGFBQVcsUUFBUSxPQUFPLE1BQU0sSUFBSSxHQUFHO0FBQ3JDLFVBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsUUFBSSxDQUFDLFFBQVM7QUFDZCxVQUFNLFFBQVEsUUFBUSxNQUFNLEdBQUk7QUFDaEMsUUFBSSxNQUFNLFNBQVMsRUFBRztBQUN0QixVQUFNLENBQUMsTUFBTSxNQUFNLEtBQUssSUFBSTtBQUM1QixVQUFNLFVBQVUsTUFBTSxRQUFRLEdBQUc7QUFDakMsUUFBSSxZQUFZLEdBQUk7QUFDcEIsVUFBTSxRQUFRLFNBQVMsTUFBTSxNQUFNLEdBQUcsT0FBTyxHQUFHLEVBQUU7QUFDbEQsVUFBTSxNQUFNLFNBQVMsTUFBTSxNQUFNLFVBQVUsQ0FBQyxHQUFHLEVBQUU7QUFDakQsUUFBSSxPQUFPLE1BQU0sS0FBSyxLQUFLLE9BQU8sTUFBTSxHQUFHLEVBQUc7QUFDOUMsU0FBSyxLQUFLLEVBQUUsTUFBTSxNQUFNLE9BQU8sSUFBSSxDQUFDO0FBQUEsRUFDdEM7QUFDQSxTQUFPO0FBQ1Q7QUFTTyxJQUFNLHFCQUFxQjtBQUFBLEVBQ2hDO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQ0Y7QUFJQSxJQUFNLHVCQUE0QyxJQUFJLElBQUksa0JBQWtCO0FBRTVFLFNBQVMscUJBQXFCLEtBQXFDO0FBQ2pFLFNBQU8scUJBQXFCLElBQUksR0FBRyxJQUFLLE1BQTBCO0FBQ3BFO0FBdUJPLFNBQVMsT0FBTyxRQUFrQztBQUN2RCxVQUFRLFFBQVE7QUFBQSxJQUNkLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFDSCxhQUFPO0FBQUEsSUFDVDtBQUNFLGFBQU87QUFBQSxFQUNYO0FBQ0Y7QUFRTyxTQUFTLGlCQUFpQixRQUFpQztBQUNoRSxTQUFPLE9BQU8sWUFBWSxFQUFFLFFBQVEsTUFBTSxHQUFHO0FBQy9DO0FBOENPLFNBQVMsb0JBQW9CLFFBQXFDO0FBQ3ZFLFFBQU0sT0FBNEIsQ0FBQztBQUNuQyxhQUFXLFFBQVEsT0FBTyxNQUFNLElBQUksR0FBRztBQUNyQyxVQUFNLFVBQVUsS0FBSyxLQUFLO0FBQzFCLFFBQUksQ0FBQyxXQUFXLFFBQVEsV0FBVyxHQUFHLEVBQUc7QUFDekMsVUFBTSxRQUFRLFFBQVEsTUFBTSxHQUFJO0FBQ2hDLFFBQUksTUFBTSxTQUFTLEVBQUc7QUFDdEIsVUFBTSxDQUFDLFdBQVcsRUFBRSxNQUFNLE1BQU0sVUFBVSxNQUFNLElBQUk7QUFDcEQsVUFBTSxTQUFTLHFCQUFxQixTQUFTO0FBQzdDLFFBQUksQ0FBQyxPQUFRO0FBQ2IsVUFBTSxRQUFRLGFBQWEsWUFBWSxJQUFJLFNBQVMsVUFBVSxFQUFFO0FBQ2hFLFVBQU0sTUFBTSxXQUFXLE1BQU0sSUFBSSxTQUFTLFFBQVEsRUFBRTtBQUNwRCxRQUFJLE9BQU8sTUFBTSxLQUFLLEtBQUssT0FBTyxNQUFNLEdBQUcsRUFBRztBQUM5QyxTQUFLLEtBQUssRUFBRSxNQUFNLE1BQU0sT0FBTyxLQUFLLE9BQU8sQ0FBQztBQUFBLEVBQzlDO0FBQ0EsU0FBTztBQUNUO0FBVU8sU0FBUyxrQkFBa0IsV0FBMkI7QUFDM0QsU0FBTyxVQUFVLFFBQVEsb0JBQW9CLENBQUMsT0FBTztBQUNuRCxXQUFPLElBQUksR0FBRyxXQUFXLENBQUMsRUFBRSxTQUFTLEVBQUUsRUFBRSxZQUFZLEVBQUUsU0FBUyxHQUFHLEdBQUcsQ0FBQztBQUFBLEVBQ3pFLENBQUM7QUFDSDtBQVVPLElBQU0sbUJBQTRCLGNBQVEsV0FBUSxHQUFHLFVBQVUsWUFBWSxTQUFTO0FBR3BGLFNBQVMsV0FBVyxXQUEyQjtBQUNwRCxTQUFnQixjQUFLLGtCQUFrQixrQkFBa0IsU0FBUyxDQUFDO0FBQ3JFO0FBRUEsSUFBTSxpQkFBaUIsS0FBSyxLQUFLLEtBQUssS0FBSztBQWFwQyxTQUFTLG1CQUFtQixNQUFjLEtBQUssSUFBSSxHQUFHLFdBQW1CLGdCQUFzQjtBQUNwRyxNQUFJO0FBQ0osTUFBSTtBQUNGLGNBQWEsZUFBWSxrQkFBa0IsRUFBRSxlQUFlLEtBQUssQ0FBQztBQUFBLEVBQ3BFLFFBQVE7QUFDTjtBQUFBLEVBQ0Y7QUFDQSxhQUFXLFNBQVMsU0FBUztBQUMzQixRQUFJLENBQUMsTUFBTSxZQUFZLEVBQUc7QUFDMUIsVUFBTSxVQUFtQixjQUFLLGtCQUFrQixNQUFNLElBQUk7QUFDMUQsUUFBSTtBQUNGLFlBQU0sT0FBVSxZQUFTLE9BQU87QUFDaEMsVUFBSSxNQUFNLEtBQUssVUFBVSxVQUFVO0FBQ2pDLFFBQUcsVUFBTyxTQUFTLEVBQUUsV0FBVyxNQUFNLE9BQU8sS0FBSyxDQUFDO0FBQUEsTUFDckQ7QUFBQSxJQUNGLFFBQVE7QUFBQSxJQUdSO0FBQUEsRUFDRjtBQUNGOzs7QUN0WEEsU0FBUyxXQUFXLG1CQUFtQjs7O0FDUnZDLFNBQVMsZ0JBQUFDLHFCQUFvQjtBQUM3QixTQUFTLGNBQWMsWUFBQUMsaUJBQWdCO0FBR2hDLFNBQVMsZUFBZSxjQUFxQztBQUNsRSxNQUFJO0FBQ0YsUUFBSSxDQUFDQSxVQUFTLFlBQVksRUFBRSxPQUFPLEVBQUcsUUFBTztBQUM3QyxVQUFNLFVBQVUsYUFBYSxjQUFjLE1BQU07QUFDakQsUUFBSSxRQUFRLFdBQVcsRUFBRyxRQUFPO0FBQ2pDLFVBQU0seUJBQXlCLFFBQVEsU0FBUyxJQUFJLElBQUksUUFBUSxNQUFNLEdBQUcsRUFBRSxJQUFJO0FBQy9FLFdBQU8sdUJBQXVCLE1BQU0sSUFBSSxFQUFFO0FBQUEsRUFDNUMsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFHTyxTQUFTLGtCQUFrQixLQUFhLEtBQWEsTUFBNkI7QUFDdkYsTUFBSTtBQUNGLFVBQU0sTUFBTUQsY0FBYSxPQUFPLENBQUMsUUFBUSxHQUFHLEdBQUcsSUFBSSxJQUFJLEVBQUUsR0FBRztBQUFBLE1BQzFEO0FBQUEsTUFDQSxVQUFVO0FBQUEsTUFDVixPQUFPLENBQUMsVUFBVSxRQUFRLFFBQVE7QUFBQSxJQUNwQyxDQUFDO0FBQ0QsUUFBSSxJQUFJLFdBQVcsRUFBRyxRQUFPO0FBQzdCLFVBQU0seUJBQXlCLElBQUksU0FBUyxJQUFJLElBQUksSUFBSSxNQUFNLEdBQUcsRUFBRSxJQUFJO0FBQ3ZFLFdBQU8sdUJBQXVCLE1BQU0sSUFBSSxFQUFFO0FBQUEsRUFDNUMsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7OztBQ3JCTyxTQUFTLGNBQWMsS0FBOEI7QUFDMUQsUUFBTSxRQUF5QixDQUFDO0FBQ2hDLE1BQUksTUFBTTtBQUNWLE1BQUksSUFBSTtBQUNSLFFBQU0sSUFBSSxJQUFJO0FBQ2QsTUFBSSxRQUFRO0FBQ1osTUFBSSxXQUFXO0FBQ2YsTUFBSSxXQUFXO0FBQ2YsTUFBSSxZQUF5QztBQUU3QyxRQUFNLFFBQVEsQ0FBQyxXQUF3QztBQUNyRCxVQUFNLElBQUksSUFBSSxLQUFLO0FBQ25CLFFBQUksRUFBRyxPQUFNLEtBQUssRUFBRSxNQUFNLEdBQUcsWUFBWSxVQUFVLENBQUM7QUFDcEQsVUFBTTtBQUNOLGdCQUFZO0FBQUEsRUFDZDtBQUVBLFNBQU8sSUFBSSxHQUFHO0FBQ1osVUFBTSxJQUFJLElBQUksQ0FBQztBQUNmLFFBQUksVUFBVTtBQUNaLGFBQU87QUFDUCxVQUFJLE1BQU0sSUFBSyxZQUFXO0FBQzFCLFdBQUs7QUFDTDtBQUFBLElBQ0Y7QUFDQSxRQUFJLFVBQVU7QUFDWixhQUFPO0FBQ1AsVUFBSSxNQUFNLFFBQVEsSUFBSSxJQUFJLEdBQUc7QUFDM0IsZUFBTyxJQUFJLElBQUksQ0FBQztBQUNoQixhQUFLO0FBQ0w7QUFBQSxNQUNGO0FBQ0EsVUFBSSxNQUFNLElBQUssWUFBVztBQUMxQixXQUFLO0FBQ0w7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLEtBQUs7QUFDYixpQkFBVztBQUNYLGFBQU87QUFDUCxXQUFLO0FBQ0w7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLEtBQUs7QUFDYixpQkFBVztBQUNYLGFBQU87QUFDUCxXQUFLO0FBQ0w7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLFFBQVEsSUFBSSxJQUFJLEdBQUc7QUFDM0IsYUFBTyxJQUFJLElBQUksSUFBSSxDQUFDO0FBQ3BCLFdBQUs7QUFDTDtBQUFBLElBQ0Y7QUFDQSxRQUFJLE1BQU0sS0FBSztBQUNiLGVBQVM7QUFDVCxhQUFPO0FBQ1AsV0FBSztBQUNMO0FBQUEsSUFDRjtBQUNBLFFBQUksTUFBTSxLQUFLO0FBQ2IsY0FBUSxLQUFLLElBQUksR0FBRyxRQUFRLENBQUM7QUFDN0IsYUFBTztBQUNQLFdBQUs7QUFDTDtBQUFBLElBQ0Y7QUFDQSxRQUFJLFVBQVUsR0FBRztBQUNmLFVBQUksSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sTUFBTTtBQUNoQyxjQUFNLE9BQU87QUFDYixhQUFLO0FBQ0w7QUFBQSxNQUNGO0FBQ0EsVUFBSSxJQUFJLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxNQUFNO0FBQ2hDLGNBQU0sT0FBTztBQUNiLGFBQUs7QUFDTDtBQUFBLE1BQ0Y7QUFDQSxVQUFJLElBQUksTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLE1BQU07QUFDaEMsY0FBTSxHQUFHO0FBQ1QsYUFBSztBQUNMO0FBQUEsTUFDRjtBQUNBLFVBQUksTUFBTSxLQUFLO0FBQ2IsY0FBTSxPQUFPO0FBQ2IsYUFBSztBQUNMO0FBQUEsTUFDRjtBQUNBLFVBQUksTUFBTSxLQUFLO0FBQ2IsY0FBTSxHQUFHO0FBQ1QsYUFBSztBQUNMO0FBQUEsTUFDRjtBQUNBLFVBQUksTUFBTSxNQUFNO0FBQ2QsY0FBTSxPQUFPO0FBQ2IsYUFBSztBQUNMO0FBQUEsTUFDRjtBQUNBLFVBQUksTUFBTSxLQUFLO0FBQ2IsY0FBTSxPQUFPO0FBQ2IsYUFBSztBQUNMO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFDQSxXQUFPO0FBQ1AsU0FBSztBQUFBLEVBQ1A7QUFDQSxRQUFNLE9BQU87QUFDYixTQUFPO0FBQ1Q7QUFFQSxJQUFNLHFCQUFxQjtBQUdwQixTQUFTLHdCQUF3QixXQUEyQjtBQUNqRSxTQUFPLFVBQVUsUUFBUSxvQkFBb0IsRUFBRTtBQUNqRDtBQUdPLFNBQVMsV0FBVyxHQUE0QjtBQUNyRCxRQUFNLFFBQWtCLENBQUM7QUFDekIsTUFBSSxNQUFNO0FBQ1YsTUFBSSxNQUFNO0FBQ1YsTUFBSSxJQUFJO0FBQ1IsUUFBTSxJQUFJLEVBQUU7QUFFWixTQUFPLElBQUksR0FBRztBQUNaLFVBQU0sSUFBSSxFQUFFLENBQUM7QUFDYixRQUFJLEtBQUssS0FBSyxDQUFDLEdBQUc7QUFDaEIsVUFBSSxLQUFLO0FBQ1AsY0FBTSxLQUFLLEdBQUc7QUFDZCxjQUFNO0FBQ04sY0FBTTtBQUFBLE1BQ1I7QUFDQSxXQUFLO0FBQ0w7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLEtBQUs7QUFDYixZQUFNO0FBQ04sV0FBSztBQUNMLFlBQU0sTUFBTSxFQUFFLFFBQVEsS0FBSyxDQUFDO0FBQzVCLFVBQUksUUFBUSxHQUFJLFFBQU87QUFDdkIsYUFBTyxFQUFFLE1BQU0sR0FBRyxHQUFHO0FBQ3JCLFVBQUksTUFBTTtBQUNWO0FBQUEsSUFDRjtBQUNBLFFBQUksTUFBTSxLQUFLO0FBQ2IsWUFBTTtBQUNOLFdBQUs7QUFDTCxhQUFPLElBQUksS0FBSyxFQUFFLENBQUMsTUFBTSxLQUFLO0FBQzVCLFlBQUksRUFBRSxDQUFDLE1BQU0sUUFBUSxJQUFJLElBQUksS0FBSyxRQUFRLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQyxHQUFHO0FBQzVELGlCQUFPLEVBQUUsSUFBSSxDQUFDO0FBQ2QsZUFBSztBQUFBLFFBQ1AsT0FBTztBQUNMLGlCQUFPLEVBQUUsQ0FBQztBQUNWLGVBQUs7QUFBQSxRQUNQO0FBQUEsTUFDRjtBQUNBLFVBQUksS0FBSyxFQUFHLFFBQU87QUFDbkIsV0FBSztBQUNMO0FBQUEsSUFDRjtBQUNBLFFBQUksTUFBTSxRQUFRLElBQUksSUFBSSxHQUFHO0FBQzNCLFlBQU07QUFDTixhQUFPLEVBQUUsSUFBSSxDQUFDO0FBQ2QsV0FBSztBQUNMO0FBQUEsSUFDRjtBQUNBLFVBQU07QUFDTixXQUFPO0FBQ1AsU0FBSztBQUFBLEVBQ1A7QUFDQSxNQUFJLElBQUssT0FBTSxLQUFLLEdBQUc7QUFDdkIsU0FBTztBQUNUO0FBR08sU0FBUyxPQUFPLFdBQW9DO0FBQ3pELFNBQU8sV0FBVyx3QkFBd0IsU0FBUyxFQUFFLEtBQUssQ0FBQztBQUM3RDs7O0FGOUlBLFNBQVMsWUFDUCxNQUNBLFlBQytDO0FBQy9DLFVBQVEsS0FBSyxNQUFNO0FBQUEsSUFDakIsS0FBSztBQUNILGFBQU8sRUFBRSxXQUFXLEtBQUssT0FBTyxTQUFTLEtBQUssSUFBSTtBQUFBLElBQ3BELEtBQUssdUJBQXVCO0FBQzFCLFlBQU0sUUFBUSxXQUFXO0FBQ3pCLGFBQU8sRUFBRSxXQUFXLEdBQUcsU0FBUyxVQUFVLE9BQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxLQUFLLElBQUksS0FBSyxJQUFJO0FBQUEsSUFDeEY7QUFBQSxJQUNBLEtBQUssU0FBUztBQUNaLFlBQU0sUUFBUSxXQUFXO0FBQ3pCLFVBQUksVUFBVSxRQUFRLFVBQVUsRUFBRyxRQUFPO0FBQzFDLGFBQU8sRUFBRSxXQUFXLEtBQUssT0FBTyxTQUFTLEtBQUssSUFBSSxLQUFLLE9BQU8sS0FBSyxFQUFFO0FBQUEsSUFDdkU7QUFBQSxJQUNBLEtBQUssY0FBYztBQUNqQixZQUFNLFFBQVEsV0FBVztBQUN6QixVQUFJLFVBQVUsUUFBUSxVQUFVLEVBQUcsUUFBTztBQUMxQyxhQUFPLEVBQUUsV0FBVyxLQUFLLElBQUksR0FBRyxRQUFRLEtBQUssUUFBUSxDQUFDLEdBQUcsU0FBUyxNQUFNO0FBQUEsSUFDMUU7QUFBQSxJQUNBLEtBQUssZUFBZTtBQUNsQixZQUFNLFFBQVEsV0FBVyxLQUFLO0FBQzlCLGFBQU8sRUFBRSxXQUFXLFFBQVEsR0FBRyxTQUFTLFFBQVEsS0FBSyxNQUFNO0FBQUEsSUFDN0Q7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxTQUFTLGtCQUFrQixHQUFvQjtBQUM3QyxTQUFPLE9BQU8sS0FBSyxDQUFDO0FBQ3RCO0FBRUEsU0FBUyxrQkFBa0IsR0FBb0I7QUFDN0MsU0FBTyxrQkFBa0IsQ0FBQyxLQUFLLE9BQU8sS0FBSyxDQUFDO0FBQzlDO0FBc0JBLElBQU0sWUFBWTtBQUdsQixTQUFTLGtCQUFrQixRQUEwQjtBQUNuRCxTQUFPLE9BQU8sTUFBTSxHQUFHO0FBQ3pCO0FBRUEsU0FBUyxTQUFTLE1BQStCO0FBQy9DLE1BQUksS0FBSyxDQUFDLE1BQU0sTUFBTyxRQUFPLENBQUM7QUFDL0IsUUFBTSxPQUFPLEtBQUssTUFBTSxDQUFDO0FBQ3pCLE1BQUksQ0FBQyxLQUFLLFNBQVMsSUFBSSxFQUFHLFFBQU8sQ0FBQztBQUNsQyxNQUFJLFlBQVk7QUFDaEIsV0FBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLFFBQVEsS0FBSztBQUNwQyxRQUFJLEtBQUssQ0FBQyxNQUFNLEtBQU07QUFDdEIsUUFBSSxrQkFBa0IsS0FBSyxDQUFDLENBQUMsRUFBRSxLQUFLLENBQUMsUUFBUSxVQUFVLEtBQUssR0FBRyxDQUFDLEdBQUc7QUFDakUsa0JBQVk7QUFDWjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0EsTUFBSSxjQUFjLEdBQUksUUFBTyxDQUFDO0FBQzlCLFFBQU0saUJBQWlCLEtBQUssT0FBTyxDQUFDLEdBQUcsTUFBTSxNQUFNLGFBQWEsTUFBTSxRQUFRLENBQUMsRUFBRSxXQUFXLEdBQUcsQ0FBQztBQUNoRyxNQUFJLGVBQWUsV0FBVyxFQUFHLFFBQU8sQ0FBQztBQUN6QyxRQUFNLFVBQVUsZUFBZSxDQUFDO0FBQ2hDLFFBQU0sVUFBeUIsQ0FBQztBQUNoQyxhQUFXLFdBQVcsa0JBQWtCLEtBQUssU0FBUyxDQUFDLEdBQUc7QUFDeEQsVUFBTSxRQUFRLFFBQVEsTUFBTSxTQUFTO0FBQ3JDLFFBQUksQ0FBQyxNQUFPO0FBQ1osVUFBTSxRQUFRLE9BQU8sU0FBUyxNQUFNLENBQUMsR0FBRyxFQUFFO0FBQzFDLFVBQU0sV0FBVyxNQUFNLENBQUM7QUFDeEIsVUFBTSxPQUNKLGFBQWEsU0FDVCxFQUFFLE1BQU0sV0FBVyxPQUFPLEtBQUssTUFBTSxJQUNyQyxhQUFhLE1BQ1gsRUFBRSxNQUFNLFNBQVMsTUFBTSxJQUN2QixFQUFFLE1BQU0sV0FBVyxPQUFPLEtBQUssT0FBTyxTQUFTLFVBQVUsRUFBRSxFQUFFO0FBQ3JFLFlBQVEsS0FBSyxFQUFFLE1BQU0sYUFBYSxPQUFPLGVBQWUsU0FBUyxNQUFNLGNBQWMsS0FBSyxDQUFDO0FBQUEsRUFDN0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLG1CQUFtQixNQUsxQjtBQUNBLFFBQU0sUUFBa0IsQ0FBQztBQUN6QixNQUFJLFFBQXVCO0FBQzNCLE1BQUksWUFBWTtBQUNoQixNQUFJLGVBQWU7QUFDbkIsV0FBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLFFBQVEsS0FBSztBQUNwQyxVQUFNLElBQUksS0FBSyxDQUFDO0FBQ2hCLFFBQUksTUFBTSxRQUFRLE1BQU0sUUFBUSxNQUFNLGNBQWMsRUFBRSxXQUFXLFdBQVcsR0FBRztBQUM3RSxxQkFBZTtBQUNmO0FBQUEsSUFDRjtBQUNBLFFBQUksTUFBTSxRQUFRLE1BQU0scUJBQXFCO0FBQzNDLHFCQUFlO0FBQ2Y7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLFFBQVEsTUFBTSxXQUFXO0FBQ2pDLHFCQUFlO0FBQ2YsV0FBSztBQUNMO0FBQUEsSUFDRjtBQUNBLFFBQUksaUJBQWlCLEtBQUssQ0FBQyxHQUFHO0FBQzVCLHFCQUFlO0FBQ2Y7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLFFBQVEsTUFBTSxRQUFRLE1BQU0sYUFBYSxNQUFNLGNBQWMsTUFBTSxZQUFhO0FBQzFGLFFBQUksTUFBTSxNQUFNO0FBQ2QsWUFBTSxJQUFJLEtBQUssSUFBSSxDQUFDO0FBQ3BCLFVBQUksTUFBTSxVQUFhLFdBQVcsS0FBSyxDQUFDLEdBQUc7QUFDekMsb0JBQVksRUFBRSxXQUFXLEdBQUc7QUFDNUIsZ0JBQVEsT0FBTyxTQUFTLEVBQUUsUUFBUSxLQUFLLEVBQUUsR0FBRyxFQUFFO0FBQzlDLGFBQUs7QUFBQSxNQUNQO0FBQ0E7QUFBQSxJQUNGO0FBQ0EsUUFBSSxFQUFFLFdBQVcsVUFBVSxHQUFHO0FBQzVCLFlBQU0sSUFBSSxFQUFFLE1BQU0sV0FBVyxNQUFNO0FBQ25DLFVBQUksV0FBVyxLQUFLLENBQUMsR0FBRztBQUN0QixvQkFBWSxFQUFFLFdBQVcsR0FBRztBQUM1QixnQkFBUSxPQUFPLFNBQVMsRUFBRSxRQUFRLEtBQUssRUFBRSxHQUFHLEVBQUU7QUFBQSxNQUNoRDtBQUNBO0FBQUEsSUFDRjtBQUNBLFFBQUksYUFBYSxLQUFLLENBQUMsR0FBRztBQUN4QixZQUFNLElBQUksRUFBRSxNQUFNLENBQUM7QUFDbkIsa0JBQVksRUFBRSxXQUFXLEdBQUc7QUFDNUIsY0FBUSxPQUFPLFNBQVMsRUFBRSxRQUFRLEtBQUssRUFBRSxHQUFHLEVBQUU7QUFDOUM7QUFBQSxJQUNGO0FBQ0EsUUFBSSxVQUFVLEtBQUssQ0FBQyxHQUFHO0FBQ3JCLGtCQUFZO0FBQ1osY0FBUSxPQUFPLFNBQVMsRUFBRSxNQUFNLENBQUMsR0FBRyxFQUFFO0FBQ3RDO0FBQUEsSUFDRjtBQUNBLFFBQUksU0FBUyxLQUFLLENBQUMsR0FBRztBQUNwQixjQUFRLE9BQU8sU0FBUyxFQUFFLE1BQU0sQ0FBQyxHQUFHLEVBQUU7QUFDdEM7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLEtBQUs7QUFDYixZQUFNLEtBQUssQ0FBQztBQUNaO0FBQUEsSUFDRjtBQUNBLFFBQUksRUFBRSxXQUFXLEdBQUcsRUFBRztBQUN2QixVQUFNLEtBQUssQ0FBQztBQUFBLEVBQ2Q7QUFDQSxTQUFPLEVBQUUsT0FBTyxXQUFXLGNBQWMsTUFBTTtBQUNqRDtBQUVBLFNBQVMsVUFBVSxNQUErQjtBQUNoRCxNQUFJLEtBQUssQ0FBQyxNQUFNLE9BQVEsUUFBTyxDQUFDO0FBQ2hDLFFBQU0sRUFBRSxPQUFPLGNBQWMsTUFBTSxJQUFJLG1CQUFtQixLQUFLLE1BQU0sQ0FBQyxDQUFDO0FBQ3ZFLE1BQUksYUFBYyxRQUFPLENBQUM7QUFDMUIsUUFBTSxZQUFZLE1BQU0sT0FBTyxDQUFDLE1BQU0sTUFBTSxHQUFHO0FBQy9DLE1BQUksVUFBVSxXQUFXLEVBQUcsUUFBTyxDQUFDO0FBQ3BDLFFBQU0sSUFBSSxTQUFTO0FBQ25CLFNBQU8sVUFBVSxJQUFJLENBQUMsYUFBYTtBQUFBLElBQ2pDLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxJQUNQO0FBQUEsSUFDQSxNQUFNLEVBQUUsTUFBTSx1QkFBdUIsS0FBSyxFQUFFO0FBQUEsSUFDNUMsY0FBYztBQUFBLEVBQ2hCLEVBQUU7QUFDSjtBQUVBLFNBQVMsVUFBVSxNQUErQjtBQUNoRCxNQUFJLEtBQUssQ0FBQyxNQUFNLE9BQVEsUUFBTyxDQUFDO0FBQ2hDLFFBQU0sRUFBRSxPQUFPLFdBQVcsY0FBYyxNQUFNLElBQUksbUJBQW1CLEtBQUssTUFBTSxDQUFDLENBQUM7QUFDbEYsTUFBSSxhQUFjLFFBQU8sQ0FBQztBQUMxQixRQUFNLFlBQVksTUFBTSxPQUFPLENBQUMsTUFBTSxNQUFNLEdBQUc7QUFDL0MsTUFBSSxVQUFVLFdBQVcsRUFBRyxRQUFPLENBQUM7QUFDcEMsUUFBTSxJQUFJLFNBQVM7QUFDbkIsUUFBTSxPQUFzQixZQUFZLEVBQUUsTUFBTSxTQUFTLE9BQU8sRUFBRSxJQUFJLEVBQUUsTUFBTSxjQUFjLE9BQU8sRUFBRTtBQUNyRyxTQUFPLFVBQVUsSUFBSSxDQUFDLGFBQWE7QUFBQSxJQUNqQyxNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsSUFDUDtBQUFBLElBQ0E7QUFBQSxJQUNBLGNBQWM7QUFBQSxFQUNoQixFQUFFO0FBQ0o7QUFFQSxTQUFTLGtCQUNQLE1BQytGO0FBQy9GLE1BQUksT0FBc0I7QUFDMUIsTUFBSSxtQkFBbUI7QUFDdkIsTUFBSSxJQUFJO0FBQ1IsU0FBTyxJQUFJLEtBQUssUUFBUTtBQUN0QixVQUFNLElBQUksS0FBSyxDQUFDO0FBQ2hCLFFBQUksTUFBTSxNQUFNO0FBQ2QsWUFBTSxJQUFJLEtBQUssSUFBSSxDQUFDO0FBQ3BCLFVBQUksTUFBTSxPQUFXLFFBQU87QUFDNUIsVUFBSSxrQkFBa0IsQ0FBQyxFQUFHLG9CQUFtQjtBQUFBLFVBQ3hDLFFBQU87QUFDWixXQUFLO0FBQ0w7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLE1BQU07QUFDZCxXQUFLO0FBQ0w7QUFBQSxJQUNGO0FBQ0EsUUFBSSxFQUFFLFdBQVcsR0FBRyxHQUFHO0FBQ3JCLFdBQUs7QUFDTDtBQUFBLElBQ0Y7QUFDQSxXQUFPLEVBQUUsUUFBUSxHQUFHLFlBQVksR0FBRyxNQUFNLGlCQUFpQjtBQUFBLEVBQzVEO0FBQ0EsU0FBTztBQUNUO0FBRUEsSUFBTSxXQUFXO0FBRWpCLFNBQVMsYUFBYSxNQUErQjtBQUNuRCxNQUFJLEtBQUssQ0FBQyxNQUFNLE1BQU8sUUFBTyxDQUFDO0FBQy9CLFFBQU0sTUFBTSxrQkFBa0IsS0FBSyxNQUFNLENBQUMsQ0FBQztBQUMzQyxNQUFJLENBQUMsT0FBTyxJQUFJLGVBQWUsT0FBUSxRQUFPLENBQUM7QUFDL0MsUUFBTSxRQUFRLEtBQ1gsTUFBTSxDQUFDLEVBQ1AsTUFBTSxJQUFJLFNBQVMsQ0FBQyxFQUNwQixPQUFPLENBQUMsTUFBTSxDQUFDLEVBQUUsV0FBVyxHQUFHLENBQUM7QUFDbkMsUUFBTSxhQUFhLE1BQU0sS0FBSyxDQUFDLE1BQU0sU0FBUyxLQUFLLENBQUMsQ0FBQztBQUNyRCxNQUFJLENBQUMsV0FBWSxRQUFPLENBQUM7QUFDekIsUUFBTSxJQUFJLFdBQVcsTUFBTSxRQUFRO0FBQ25DLE1BQUksQ0FBQyxFQUFHLFFBQU8sQ0FBQztBQUNoQixRQUFNLENBQUMsRUFBRSxLQUFLLElBQUksSUFBSTtBQUN0QixNQUFJLElBQUksb0JBQW9CLGtCQUFrQixHQUFHLEdBQUc7QUFDbEQsV0FBTztBQUFBLE1BQ0w7QUFBQSxRQUNFLE1BQU07QUFBQSxRQUNOLE9BQU87QUFBQSxRQUNQLFNBQVM7QUFBQSxRQUNULFFBQVE7QUFBQSxNQUNWO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQUEsSUFDTDtBQUFBLE1BQ0UsTUFBTTtBQUFBLE1BQ04sT0FBTztBQUFBLE1BQ1AsU0FBUztBQUFBLE1BQ1QsTUFBTSxFQUFFLE1BQU0sU0FBUyxPQUFPLEVBQUU7QUFBQSxNQUNoQyxjQUFjLEVBQUUsTUFBTSxPQUFPLElBQUk7QUFBQSxNQUNqQyxhQUFhLElBQUksUUFBUTtBQUFBLElBQzNCO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxhQUFhLE1BQStCO0FBQ25ELE1BQUksS0FBSyxDQUFDLE1BQU0sTUFBTyxRQUFPLENBQUM7QUFDL0IsUUFBTSxNQUFNLGtCQUFrQixLQUFLLE1BQU0sQ0FBQyxDQUFDO0FBQzNDLE1BQUksQ0FBQyxPQUFPLElBQUksZUFBZSxNQUFPLFFBQU8sQ0FBQztBQUM5QyxRQUFNLFFBQVEsS0FBSyxNQUFNLENBQUMsRUFBRSxNQUFNLElBQUksU0FBUyxDQUFDO0FBQ2hELFdBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUs7QUFDckMsVUFBTSxJQUFJLE1BQU0sQ0FBQztBQUNqQixRQUFJLE9BQXNCO0FBQzFCLFFBQUksTUFBTSxLQUFNLFFBQU8sTUFBTSxJQUFJLENBQUMsS0FBSztBQUFBLGFBQzlCLEVBQUUsV0FBVyxJQUFJLEVBQUcsUUFBTyxFQUFFLE1BQU0sQ0FBQztBQUM3QyxRQUFJLENBQUMsS0FBTTtBQUNYLFVBQU0sSUFBSSxLQUFLLE1BQU0sb0JBQW9CO0FBQ3pDLFFBQUksQ0FBQyxFQUFHO0FBQ1IsVUFBTSxDQUFDLEVBQUUsR0FBRyxHQUFHLElBQUksSUFBSTtBQUN2QixRQUFJLElBQUksa0JBQWtCO0FBQ3hCLGFBQU87QUFBQSxRQUNMO0FBQUEsVUFDRSxNQUFNO0FBQUEsVUFDTixPQUFPO0FBQUEsVUFDUCxTQUFTO0FBQUEsVUFDVCxRQUFRO0FBQUEsUUFDVjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsV0FBTztBQUFBLE1BQ0w7QUFBQSxRQUNFLE1BQU07QUFBQSxRQUNOLE9BQU87QUFBQSxRQUNQLFNBQVM7QUFBQSxRQUNULE1BQU0sRUFBRSxNQUFNLFdBQVcsT0FBTyxPQUFPLFNBQVMsR0FBRyxFQUFFLEdBQUcsS0FBSyxPQUFPLFNBQVMsR0FBRyxFQUFFLEVBQUU7QUFBQSxRQUNwRixjQUFjO0FBQUEsUUFDZCxhQUFhLElBQUksUUFBUTtBQUFBLE1BQzNCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDQSxTQUFPLENBQUM7QUFDVjtBQWlCQSxJQUFNLGVBQ0o7QUFFRixTQUFTLGFBQWEsR0FBbUI7QUFDdkMsU0FBTyxFQUFFLFFBQVEsdUJBQXVCLE1BQU07QUFDaEQ7QUFFQSxTQUFTLHFCQUFxQixLQUF5RDtBQUNyRixRQUFNLFNBQXlCLENBQUM7QUFDaEMsTUFBSSxTQUFTO0FBQ2IsTUFBSSxTQUFTO0FBQ2IsZUFBYSxZQUFZO0FBQ3pCLE1BQUksWUFBb0MsYUFBYSxLQUFLLEdBQUc7QUFDN0QsU0FBTyxjQUFjLE1BQU07QUFDekIsVUFBTSxDQUFDLEVBQUUsVUFBVSxRQUFRLE1BQU0sS0FBSyxLQUFLLElBQUksSUFBSTtBQUNuRCxVQUFNLFFBQVEsT0FBTyxPQUFPO0FBQzVCLFVBQU0sWUFBWSxVQUFVLFFBQVEsVUFBVSxDQUFDLEVBQUU7QUFDakQsUUFBSSxDQUFDLFNBQVMsWUFBWSxRQUFRO0FBQ2hDLG1CQUFhLFlBQVksVUFBVSxRQUFRO0FBQzNDLGtCQUFZLGFBQWEsS0FBSyxHQUFHO0FBQ2pDO0FBQUEsSUFDRjtBQUNBLFVBQU0sVUFBVSxJQUFJLE9BQU8sSUFBSSxPQUFPLFNBQVMsRUFBRSxHQUFHLGFBQWEsS0FBSyxDQUFDLFlBQVksR0FBRztBQUN0RixVQUFNLFlBQVksSUFBSSxNQUFNLFNBQVM7QUFDckMsVUFBTSxhQUFhLFFBQVEsS0FBSyxTQUFTO0FBQ3pDLFFBQUksQ0FBQyxZQUFZO0FBQ2YsbUJBQWEsWUFBWTtBQUN6QixrQkFBWSxhQUFhLEtBQUssR0FBRztBQUNqQztBQUFBLElBQ0Y7QUFDQSxVQUFNLE9BQU8sVUFBVSxNQUFNLEdBQUcsV0FBVyxLQUFLLEVBQUUsUUFBUSxPQUFPLEVBQUU7QUFDbkUsVUFBTSxXQUFXLFlBQVksV0FBVyxRQUFRLFdBQVcsQ0FBQyxFQUFFO0FBRTlELGNBQVUsSUFBSSxNQUFNLFFBQVEsVUFBVSxLQUFLO0FBQzNDLGNBQVUsYUFBYSxPQUFPLE1BQU07QUFDcEMsYUFBUztBQUNULFdBQU8sS0FBSyxFQUFFLFVBQWtDLFFBQVEsS0FBSyxDQUFDO0FBRTlELGlCQUFhLFlBQVk7QUFDekIsZ0JBQVksYUFBYSxLQUFLLEdBQUc7QUFBQSxFQUNuQztBQUNBLFlBQVUsSUFBSSxNQUFNLE1BQU07QUFDMUIsU0FBTyxFQUFFLFFBQVEsT0FBTztBQUMxQjtBQU1BLElBQU0saUJBQWlCLENBQUMsVUFBVSxXQUFXLFNBQVM7QUFFL0MsU0FBUyxxQkFBcUIsU0FBaUIsTUFBYyxRQUFRLElBQUksR0FBZ0I7QUFDOUYsUUFBTSxFQUFFLFFBQVEsZUFBZSxPQUFPLElBQUkscUJBQXFCLE9BQU87QUFDdEUsUUFBTSxpQkFBaUIsY0FBYyxNQUFNO0FBRTNDLFFBQU0sVUFBdUIsQ0FBQztBQUM5QixRQUFNLGNBQWMsb0JBQUksSUFBMkI7QUFDbkQsUUFBTSxlQUFlLG9CQUFJLElBQTJCO0FBRXBELFFBQU0scUJBQXFCLENBQUMsWUFBb0IsTUFBTTtBQUNwRCxRQUFJLENBQUMsWUFBWSxJQUFJLE9BQU8sRUFBRyxhQUFZLElBQUksU0FBUyxlQUFlLE9BQU8sQ0FBQztBQUMvRSxXQUFPLFlBQVksSUFBSSxPQUFPLEtBQUs7QUFBQSxFQUNyQztBQUNBLFFBQU0sc0JBQXNCLENBQUMsUUFBZ0IsS0FBYSxTQUFpQixNQUFNO0FBQy9FLFVBQU0sTUFBTSxHQUFHLE1BQU0sS0FBSSxHQUFHLEtBQUksSUFBSTtBQUNwQyxRQUFJLENBQUMsYUFBYSxJQUFJLEdBQUcsRUFBRyxjQUFhLElBQUksS0FBSyxrQkFBa0IsUUFBUSxLQUFLLElBQUksQ0FBQztBQUN0RixXQUFPLGFBQWEsSUFBSSxHQUFHLEtBQUs7QUFBQSxFQUNsQztBQUVBLE1BQUksYUFBYTtBQUNqQixNQUFJLHNCQUFxQztBQUV6QyxRQUFNLGdCQUFnQixDQUFDLEdBQWlCLHFCQUE2QjtBQUNuRSxRQUFJLGtCQUFrQixFQUFFLE9BQU8sR0FBRztBQUNoQyxjQUFRLEtBQUs7QUFBQSxRQUNYLFFBQVE7QUFBQSxRQUNSLE9BQU8sRUFBRTtBQUFBLFFBQ1QsU0FBUyxFQUFFO0FBQUEsUUFDWCxRQUFRO0FBQUEsTUFDVixDQUFDO0FBQ0Q7QUFBQSxJQUNGO0FBQ0EsVUFBTSxlQUFlLFlBQVksa0JBQWtCLEVBQUUsT0FBTztBQUM1RCxVQUFNLGFBQ0osRUFBRSxpQkFBaUIsT0FDZixtQkFBbUIsWUFBWSxJQUMvQixvQkFBb0IsRUFBRSxlQUFlLGtCQUFrQixFQUFFLGFBQWEsS0FBSyxFQUFFLE9BQU87QUFDMUYsVUFBTSxRQUFRLFlBQVksRUFBRSxNQUFNLFVBQVU7QUFDNUMsUUFBSSxVQUFVLE1BQU07QUFDbEIsY0FBUSxLQUFLO0FBQUEsUUFDWCxRQUFRO0FBQUEsUUFDUixPQUFPLEVBQUU7QUFBQSxRQUNULFNBQVM7QUFBQSxRQUNULFFBQVE7QUFBQSxNQUNWLENBQUM7QUFDRDtBQUFBLElBQ0Y7QUFDQSxZQUFRLEtBQUs7QUFBQSxNQUNYLFFBQVE7QUFBQSxNQUNSLE9BQU8sRUFBRTtBQUFBLE1BQ1QsTUFBTSxFQUFFLFdBQVcsTUFBTSxXQUFXLFNBQVMsTUFBTSxTQUFTLGFBQWE7QUFBQSxJQUMzRSxDQUFDO0FBQUEsRUFDSDtBQUVBLFdBQVMsSUFBSSxHQUFHLElBQUksZUFBZSxRQUFRLEtBQUs7QUFDOUMsVUFBTSxTQUFTLGVBQWUsQ0FBQztBQUMvQixVQUFNLGFBQWEsT0FBTyxLQUFLLE1BQU0scUJBQXFCO0FBQzFELFFBQUksWUFBWTtBQUNkLDRCQUFzQjtBQUN0QixZQUFNLElBQUksY0FBYyxPQUFPLFNBQVMsV0FBVyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBQzFELFVBQUksa0JBQWtCLEVBQUUsTUFBTSxHQUFHO0FBQy9CLGdCQUFRLEtBQUs7QUFBQSxVQUNYLFFBQVE7QUFBQSxVQUNSLE9BQU87QUFBQSxVQUNQLFNBQVMsRUFBRTtBQUFBLFVBQ1gsUUFBUTtBQUFBLFFBQ1YsQ0FBQztBQUNEO0FBQUEsTUFDRjtBQUNBLFlBQU0sZUFBZSxZQUFZLFlBQVksRUFBRSxNQUFNO0FBQ3JELFlBQU0sWUFBWSxFQUFFLEtBQUssV0FBVyxJQUFJLElBQUksRUFBRSxLQUFLLE1BQU0sSUFBSSxFQUFFO0FBQy9ELFVBQUksY0FBYyxFQUFHO0FBQ3JCLFlBQU0sT0FDSixFQUFFLGFBQWEsTUFBTSxFQUFFLE1BQU0sV0FBVyxPQUFPLEdBQUcsS0FBSyxVQUFVLElBQUksRUFBRSxNQUFNLGVBQWUsT0FBTyxVQUFVO0FBQy9HLFlBQU0sUUFBUSxZQUFZLE1BQU0sbUJBQW1CLFlBQVksQ0FBQztBQUNoRSxVQUFJLFVBQVUsTUFBTTtBQUNsQixnQkFBUSxLQUFLO0FBQUEsVUFDWCxRQUFRO0FBQUEsVUFDUixPQUFPO0FBQUEsVUFDUCxTQUFTO0FBQUEsVUFDVCxRQUFRO0FBQUEsUUFDVixDQUFDO0FBQUEsTUFDSCxPQUFPO0FBQ0wsZ0JBQVEsS0FBSztBQUFBLFVBQ1gsUUFBUTtBQUFBLFVBQ1IsT0FBTztBQUFBLFVBQ1AsTUFBTSxFQUFFLFdBQVcsTUFBTSxXQUFXLFNBQVMsTUFBTSxTQUFTLGFBQWE7QUFBQSxRQUMzRSxDQUFDO0FBQUEsTUFDSDtBQUNBO0FBQUEsSUFDRjtBQUVBLFVBQU0sT0FBTyxPQUFPLE9BQU8sSUFBSTtBQUMvQixRQUFJLENBQUMsUUFBUSxLQUFLLFdBQVcsR0FBRztBQUM5Qiw0QkFBc0I7QUFDdEI7QUFBQSxJQUNGO0FBRUEsUUFBSSxLQUFLLENBQUMsTUFBTSxNQUFNO0FBQ3BCLDRCQUFzQjtBQUN0QixZQUFNLFNBQVMsS0FBSyxDQUFDO0FBQ3JCLFVBQUksV0FBVyxVQUFhLFdBQVcsT0FBTyxDQUFDLGtCQUFrQixNQUFNLEdBQUc7QUFDeEUscUJBQWEsWUFBWSxZQUFZLE1BQU07QUFBQSxNQUM3QztBQUNBO0FBQUEsSUFDRjtBQUVBLFFBQUksZ0JBQWdCO0FBQ3BCLFFBQUksZUFBOEI7QUFDbEMsUUFBSSxLQUFLLENBQUMsTUFBTSxTQUFTLEtBQUssV0FBVyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUUsV0FBVyxHQUFHLEdBQUc7QUFDdEUsc0JBQWdCO0FBQ2hCLHFCQUFlLEtBQUssQ0FBQztBQUNyQiw0QkFBc0Isa0JBQWtCLEtBQUssQ0FBQyxDQUFDLElBQUksT0FBTyxZQUFZLFlBQVksS0FBSyxDQUFDLENBQUM7QUFBQSxJQUMzRixXQUFXLEtBQUssQ0FBQyxNQUFNLFFBQVEsS0FBSyxVQUFVLEtBQUssQ0FBQyxLQUFLLEtBQUssU0FBUyxDQUFDLEVBQUUsV0FBVyxHQUFHLEdBQUc7QUFDekYsc0JBQWdCO0FBQ2hCLFlBQU0sSUFBSSxLQUFLLEtBQUssU0FBUyxDQUFDO0FBQzlCLHFCQUFlO0FBQ2YsNEJBQXNCLGtCQUFrQixDQUFDLElBQUksT0FBTyxZQUFZLFlBQVksQ0FBQztBQUFBLElBQy9FO0FBTUEsUUFBSSxpQkFBaUIsTUFBTTtBQUN6QixZQUFNLE9BQU8sZUFBZSxJQUFJLENBQUM7QUFDakMsVUFBSSxTQUFTLFVBQWEsS0FBSyxlQUFlLEtBQUs7QUFDakQ7QUFBQSxVQUNFO0FBQUEsWUFDRSxNQUFNO0FBQUEsWUFDTixPQUFPLEtBQUssQ0FBQyxNQUFNLFFBQVEsYUFBYTtBQUFBLFlBQ3hDLFNBQVM7QUFBQSxZQUNULE1BQU0sRUFBRSxNQUFNLFNBQVMsT0FBTyxFQUFFO0FBQUEsWUFDaEMsY0FBYztBQUFBLFVBQ2hCO0FBQUEsVUFDQTtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUVBLFFBQUksVUFBVTtBQUNkLGVBQVcsV0FBVyxDQUFDLEdBQUcsZ0JBQWdCLGNBQWMsWUFBWSxHQUFHO0FBQ3JFLGlCQUFXLFdBQVcsUUFBUSxJQUFJLEdBQUc7QUFDbkMsa0JBQVU7QUFDVixZQUFJLFFBQVEsU0FBUyxjQUFjO0FBQ2pDLGtCQUFRLEtBQUs7QUFBQSxZQUNYLFFBQVE7QUFBQSxZQUNSLE9BQU8sUUFBUTtBQUFBLFlBQ2YsU0FBUyxRQUFRO0FBQUEsWUFDakIsUUFBUSxRQUFRO0FBQUEsVUFDbEIsQ0FBQztBQUFBLFFBQ0gsT0FBTztBQUNMLHdCQUFjLFNBQVMsUUFBUSxlQUFlLFVBQVU7QUFJeEQsY0FBSSxRQUFRLFVBQVUsdUJBQXVCLENBQUMsa0JBQWtCLFFBQVEsT0FBTyxHQUFHO0FBQ2hGLDRCQUFnQjtBQUNoQixrQ0FBc0IsWUFBWSxRQUFRLGVBQWUsWUFBWSxRQUFRLE9BQU87QUFBQSxVQUN0RjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUVBLFFBQUksQ0FBQyxXQUFXLE9BQU8sZUFBZSxPQUFPLHFCQUFxQjtBQUNoRSxZQUFNLFdBQVcsQ0FBQyxHQUFHLE1BQU0sbUJBQW1CO0FBQzlDLGlCQUFXLFdBQVcsZ0JBQWdCO0FBQ3BDLG1CQUFXLFdBQVcsUUFBUSxRQUFRLEdBQUc7QUFDdkMsY0FBSSxRQUFRLFNBQVMsWUFBYSxlQUFjLFNBQVMsVUFBVTtBQUFBO0FBRWpFLG9CQUFRLEtBQUs7QUFBQSxjQUNYLFFBQVE7QUFBQSxjQUNSLE9BQU8sUUFBUTtBQUFBLGNBQ2YsU0FBUyxRQUFRO0FBQUEsY0FDakIsUUFBUSxRQUFRO0FBQUEsWUFDbEIsQ0FBQztBQUFBLFFBQ0w7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUVBLFFBQUksQ0FBQyxjQUFlLHVCQUFzQjtBQUFBLEVBQzVDO0FBRUEsU0FBTztBQUNUOzs7QUc3a0JBLFNBQVMsZ0JBQUFFLHFCQUFvQjtBQUM3QixZQUFZQyxTQUFRO0FBQ3BCLFlBQVlDLGVBQWM7OztBQ21CMUIsWUFBWUMsU0FBUTtBQUNwQixZQUFZQyxlQUFjO0FBVzFCLElBQU0sa0JBQTJCLGVBQUssU0FBUyxhQUFhOzs7QUQ0RDVELFNBQVMsYUFBYSxXQUEyQjtBQUMvQyxTQUFnQixlQUFLLFdBQVcsU0FBUyxHQUFHLGlCQUFpQjtBQUMvRDtBQUlPLFNBQVMsb0JBQW9CQyxTQUErQjtBQUNqRSxTQUFPO0FBQUEsSUFDTCxZQUFZLFdBQVc7QUFDckIseUJBQW1CO0FBQ25CLFVBQUk7QUFDRixjQUFNLE1BQVMsaUJBQWEsYUFBYSxTQUFTLEdBQUcsTUFBTTtBQUMzRCxjQUFNLFNBQVMsS0FBSyxNQUFNLEdBQUc7QUFDN0IsWUFBSSxNQUFNLFFBQVEsT0FBTyxRQUFRLEdBQUc7QUFDbEMsaUJBQU8sSUFBSSxJQUFJLE9BQU8sUUFBb0I7QUFBQSxRQUM1QztBQUFBLE1BQ0YsU0FBUyxLQUFLO0FBQ1osUUFBQUEsUUFBTyxLQUFLLHdDQUF3QyxFQUFFLElBQUksQ0FBQztBQUFBLE1BQzdEO0FBQ0EsYUFBTyxvQkFBSSxJQUFJO0FBQUEsSUFDakI7QUFBQSxJQUNBLFlBQVksV0FBVyxPQUFPO0FBQzVCLHlCQUFtQjtBQUNuQixZQUFNLFdBQVcsS0FBSyxZQUFZLFNBQVM7QUFDM0MsaUJBQVcsS0FBSyxNQUFPLFVBQVMsSUFBSSxDQUFDO0FBQ3JDLFlBQU0sVUFBVSxXQUFXLFNBQVM7QUFDcEMsWUFBTSxXQUFXLGFBQWEsU0FBUztBQUN2QyxZQUFNLFVBQVUsR0FBRyxRQUFRO0FBQzNCLFVBQUk7QUFDRixRQUFHLGNBQVUsU0FBUyxFQUFFLFdBQVcsS0FBSyxDQUFDO0FBQ3pDLFFBQUcsa0JBQWMsU0FBUyxLQUFLLFVBQVUsRUFBRSxVQUFVLENBQUMsR0FBRyxRQUFRLEVBQUUsQ0FBQyxHQUFHLE1BQU07QUFDN0UsUUFBRyxlQUFXLFNBQVMsUUFBUTtBQUFBLE1BQ2pDLFNBQVMsS0FBSztBQUNaLFFBQUFBLFFBQU8sS0FBSyxxQkFBcUIsRUFBRSxJQUFJLENBQUM7QUFBQSxNQUMxQztBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0Y7QUErQk8sU0FBUyxrQkFBa0IsS0FBYSxTQUFvQztBQUNqRixRQUFNLGNBQWMsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJO0FBQ2pELE1BQUksQ0FBQyxZQUFhLFFBQU87QUFFekIsUUFBTSxTQUFTLFFBQWlCLGtCQUFRLE9BQU8sQ0FBQztBQUNoRCxRQUFNLGVBQWUsZ0JBQWdCLE1BQU07QUFDM0MsTUFBSSxpQkFBaUIsWUFBYSxRQUFPO0FBRXpDLFFBQU0sV0FBVztBQUNqQixRQUFNLGNBQWMsZUFBZSxVQUFVLE9BQU87QUFJcEQsTUFBSSxhQUFhLFVBQVUsV0FBVyxFQUFHLFFBQU87QUFJaEQsUUFBTSxXQUFXLGdCQUFnQixRQUFRO0FBQ3pDLE1BQUksaUJBQWlCLGFBQWEsUUFBUSxFQUFHLFFBQU87QUFFcEQsU0FBTyxFQUFFLFVBQVUsWUFBWTtBQUNqQzs7O0FFckxBLFNBQVMsZ0JBQUFDLHFCQUFvQjtBQUM3QixZQUFZQyxTQUFRO0FBQ3BCLFNBQVMsWUFBQUMsaUJBQWdCOzs7QUNvRGxCLFNBQVMsZUFBZSxNQUEyRTtBQUN4RyxRQUFNLFFBQWtCLENBQUM7QUFDekIsUUFBTSxTQUFTLG9CQUFJLElBQXdCO0FBQzNDLGFBQVcsT0FBTyxNQUFNO0FBQ3RCLFFBQUksU0FBUyxPQUFPLElBQUksSUFBSSxJQUFJO0FBQ2hDLFFBQUksQ0FBQyxRQUFRO0FBQ1gsZUFBUyxFQUFFLE1BQU0sSUFBSSxNQUFNLFFBQVEsQ0FBQyxFQUFFO0FBQ3RDLGFBQU8sSUFBSSxJQUFJLE1BQU0sTUFBTTtBQUMzQixZQUFNLEtBQUssSUFBSSxJQUFJO0FBQUEsSUFDckI7QUFDQSxXQUFPLE9BQU8sS0FBSyxFQUFFLE9BQU8sSUFBSSxPQUFPLFFBQVEsSUFBSSxPQUFPLENBQUM7QUFBQSxFQUM3RDtBQUNBLFNBQU8sTUFBTSxJQUFJLENBQUMsU0FBUyxPQUFPLElBQUksSUFBSSxDQUFlO0FBQzNEO0FBZ0NBLFNBQVMsY0FBYyxNQUErQjtBQUNwRCxNQUFJLEtBQUssV0FBVyxFQUFHLFFBQU87QUFDOUIsUUFBTSxXQUFXLEtBQUssTUFBTSxHQUFHO0FBQy9CLE1BQUksU0FBUyxLQUFLLENBQUMsWUFBWSxRQUFRLFdBQVcsQ0FBQyxFQUFHLFFBQU87QUFDN0QsU0FBTztBQUNUO0FBRUEsU0FBUyxnQkFBZ0IsUUFBaUIsTUFBdUI7QUFDL0QsYUFBVyxTQUFTLE9BQU8sVUFBVTtBQUNuQyxRQUFJLE1BQU0sU0FBUyxTQUFTLE1BQU0sU0FBUyxLQUFNLFFBQU87QUFBQSxFQUMxRDtBQUNBLFFBQU0sT0FBZ0IsRUFBRSxNQUFNLE9BQU8sTUFBTSxVQUFVLENBQUMsRUFBRTtBQUN4RCxTQUFPLFNBQVMsS0FBSyxJQUFJO0FBQ3pCLFNBQU87QUFDVDtBQUdBLFNBQVMsYUFBYSxNQUFlLFVBQW9CLFFBQTBCO0FBQ2pGLE1BQUksTUFBTTtBQUNWLFdBQVMsSUFBSSxHQUFHLElBQUksU0FBUyxTQUFTLEdBQUcsS0FBSztBQUM1QyxVQUFNLGdCQUFnQixLQUFLLFNBQVMsQ0FBQyxDQUFDO0FBQUEsRUFDeEM7QUFDQSxNQUFJLFNBQVMsS0FBSyxFQUFFLE1BQU0sUUFBUSxNQUFNLFNBQVMsU0FBUyxTQUFTLENBQUMsR0FBRyxPQUFPLENBQUM7QUFDakY7QUFRQSxTQUFTLFlBQVksU0FBdUM7QUFDMUQsUUFBTSxPQUFnQixFQUFFLE1BQU0sT0FBTyxNQUFNLElBQUksVUFBVSxDQUFDLEVBQUU7QUFDNUQsYUFBVyxVQUFVLFNBQVM7QUFDNUIsVUFBTSxXQUFXLGNBQWMsT0FBTyxJQUFJO0FBQzFDLFFBQUksYUFBYSxNQUFNO0FBQ3JCLFdBQUssU0FBUyxLQUFLLEVBQUUsTUFBTSxRQUFRLE1BQU0sT0FBTyxNQUFNLE9BQU8sQ0FBQztBQUM5RDtBQUFBLElBQ0Y7QUFDQSxpQkFBYSxNQUFNLFVBQVUsTUFBTTtBQUFBLEVBQ3JDO0FBQ0EsU0FBTyxLQUFLO0FBQ2Q7QUF5QkEsU0FBUyxVQUFVLE1BQWlDO0FBQ2xELE1BQUksT0FBTyxLQUFLO0FBQ2hCLE1BQUksTUFBTTtBQUNWLFNBQU8sSUFBSSxTQUFTLFNBQVMsSUFBSSxTQUFTLFdBQVcsR0FBRztBQUN0RCxVQUFNLFFBQVEsSUFBSSxTQUFTLENBQUM7QUFDNUIsV0FBTyxHQUFHLElBQUksSUFBSSxNQUFNLElBQUk7QUFDNUIsVUFBTTtBQUFBLEVBQ1I7QUFDQSxTQUFPLEVBQUUsTUFBTSxNQUFNLElBQUk7QUFDM0I7QUFhQSxTQUFTLFVBQVUsT0FBMkI7QUFDNUMsVUFBUSxNQUFNLE1BQU07QUFBQSxJQUNsQixLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1QsS0FBSztBQUNILGFBQU87QUFBQSxJQUNULEtBQUs7QUFDSCxhQUFPO0FBQUEsRUFDWDtBQUNGO0FBVUEsU0FBUyxvQkFBb0IsR0FBZSxHQUF1QjtBQUNqRSxRQUFNLE9BQU8sVUFBVSxFQUFFLEtBQUssSUFBSSxVQUFVLEVBQUUsS0FBSztBQUNuRCxNQUFJLFNBQVMsRUFBRyxRQUFPO0FBQ3ZCLE1BQUksRUFBRSxNQUFNLFNBQVMsV0FBVyxFQUFFLE1BQU0sU0FBUyxTQUFTO0FBQ3hELFdBQU8sRUFBRSxNQUFNLFFBQVEsRUFBRSxNQUFNLFNBQVMsRUFBRSxNQUFNLE1BQU0sRUFBRSxNQUFNO0FBQUEsRUFDaEU7QUFDQSxTQUFPO0FBQ1Q7QUF3QkEsU0FBUyxTQUFTLE9BQW1CLE1BQThCO0FBQ2pFLFVBQVEsTUFBTSxNQUFNO0FBQUEsSUFDbEIsS0FBSztBQUNILGFBQU8sS0FBSyxNQUFNLEtBQUssS0FBSyxNQUFNLEdBQUc7QUFBQSxJQUN2QyxLQUFLO0FBQ0gsYUFBTyxPQUFPLE9BQU87QUFBQSxJQUN2QixLQUFLO0FBQ0gsYUFBTztBQUFBLEVBQ1g7QUFDRjtBQTZCQSxJQUFJO0FBRUosU0FBUyxvQkFBMkM7QUFDbEQsTUFBSSxvQkFBb0IsUUFBVztBQUNqQyxRQUFJO0FBQ0Ysd0JBQWtCLEVBQUUsT0FBTyxJQUFJLEtBQUssVUFBVSxNQUFNLEVBQUUsYUFBYSxXQUFXLENBQUMsRUFBRTtBQUFBLElBQ25GLFFBQVE7QUFDTix3QkFBa0IsRUFBRSxPQUFPLEtBQUs7QUFBQSxJQUNsQztBQUFBLEVBQ0Y7QUFDQSxTQUFPLGdCQUFnQjtBQUN6QjtBQVdBLElBQU0sY0FBc0Q7QUFBQSxFQUMxRCxDQUFDLE1BQVEsSUFBTTtBQUFBLEVBQ2YsQ0FBQyxNQUFRLElBQU07QUFBQSxFQUNmLENBQUMsTUFBUSxLQUFNO0FBQUEsRUFDZixDQUFDLE9BQVEsS0FBTTtBQUFBLEVBQ2YsQ0FBQyxPQUFRLEtBQU07QUFBQSxFQUNmLENBQUMsT0FBUSxLQUFNO0FBQUEsRUFDZixDQUFDLE9BQVEsS0FBTTtBQUFBLEVBQ2YsQ0FBQyxPQUFRLEtBQU07QUFBQSxFQUNmLENBQUMsT0FBUSxLQUFNO0FBQUEsRUFDZixDQUFDLE9BQVEsS0FBTTtBQUFBLEVBQ2YsQ0FBQyxPQUFRLEtBQU07QUFBQSxFQUNmLENBQUMsT0FBUSxLQUFNO0FBQUEsRUFDZixDQUFDLE9BQVEsS0FBTTtBQUFBLEVBQ2YsQ0FBQyxPQUFRLEtBQU07QUFBQSxFQUNmLENBQUMsT0FBUSxLQUFNO0FBQUEsRUFDZixDQUFDLE9BQVMsTUFBTztBQUFBLEVBQ2pCLENBQUMsUUFBUyxNQUFPO0FBQUEsRUFDakIsQ0FBQyxRQUFTLE1BQU87QUFBQSxFQUNqQixDQUFDLFFBQVMsTUFBTztBQUFBLEVBQ2pCLENBQUMsUUFBUyxNQUFPO0FBQUEsRUFDakIsQ0FBQyxRQUFTLE1BQU87QUFBQSxFQUNqQixDQUFDLFFBQVMsTUFBTztBQUFBLEVBQ2pCLENBQUMsUUFBUyxNQUFPO0FBQ25CO0FBRUEsU0FBUyxnQkFBZ0IsSUFBcUI7QUFDNUMsYUFBVyxDQUFDLElBQUksRUFBRSxLQUFLLGFBQWE7QUFDbEMsUUFBSSxLQUFLLEdBQUksUUFBTztBQUNwQixRQUFJLE1BQU0sR0FBSSxRQUFPO0FBQUEsRUFDdkI7QUFDQSxTQUFPO0FBQ1Q7QUFvQkEsU0FBUyxhQUFhLE1BQXNCO0FBQzFDLFFBQU0sWUFBWSxrQkFBa0I7QUFDcEMsTUFBSSxRQUFRO0FBQ1osTUFBSSxjQUFjLE1BQU07QUFDdEIsZUFBVyxhQUFhLE1BQU07QUFDNUIsZUFBUyxnQkFBZ0IsVUFBVSxZQUFZLENBQUMsS0FBSyxDQUFDLElBQUksSUFBSTtBQUFBLElBQ2hFO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFDQSxhQUFXLEVBQUUsUUFBUSxLQUFLLFVBQVUsUUFBUSxJQUFJLEdBQUc7QUFDakQsYUFBUyxnQkFBZ0IsUUFBUSxZQUFZLENBQUMsS0FBSyxDQUFDLElBQUksSUFBSTtBQUFBLEVBQzlEO0FBQ0EsU0FBTztBQUNUO0FBVUEsSUFBTSxtQkFBbUI7QUFTekIsU0FBUyxtQkFBbUIsT0FBOEI7QUFDeEQsTUFBSSxNQUFNO0FBQ1YsYUFBVyxRQUFRLE9BQU87QUFDeEIsUUFBSSxLQUFLLEtBQUssU0FBUyxVQUFVLGtCQUFrQixLQUFLLEtBQUssTUFBTSxHQUFHO0FBQ3BFLFlBQU0sS0FBSyxJQUFJLEtBQUssYUFBYSxLQUFLLElBQUksQ0FBQztBQUFBLElBQzdDO0FBQUEsRUFDRjtBQUNBLFNBQU8sTUFBTSxtQkFBbUIsSUFBSTtBQUN0QztBQVlBLFNBQVMsa0JBQWtCLFFBQTZCO0FBQ3RELFFBQU0sRUFBRSxPQUFPLElBQUk7QUFDbkIsTUFBSSxPQUFPLFdBQVcsRUFBRyxRQUFPO0FBQ2hDLFNBQU8sT0FBTyxLQUFLLENBQUMsVUFBVSxTQUFTLE1BQU0sT0FBTyxPQUFPLFdBQVcsQ0FBQyxNQUFNLElBQUk7QUFDbkY7QUFHQSxTQUFTLFdBQVcsV0FBbUIsUUFBd0I7QUFDN0QsTUFBSSxhQUFhLE9BQVEsUUFBTztBQUNoQyxTQUFPLElBQUksT0FBTyxTQUFTLFlBQVksQ0FBQztBQUMxQztBQVdBLFNBQVMsZ0JBQ1AsTUFDQSxRQUNBLFdBQ0EsYUFDQSxhQUNVO0FBQ1YsUUFBTSxFQUFFLE9BQU8sSUFBSTtBQUNuQixNQUFJLE9BQU8sV0FBVyxFQUFHLFFBQU8sQ0FBQyxHQUFHLFNBQVMsR0FBRyxJQUFJLEVBQUU7QUFFdEQsUUFBTSxTQUFTLENBQUMsR0FBRyxNQUFNLEVBQUUsS0FBSyxtQkFBbUI7QUFDbkQsUUFBTSxPQUFPLE9BQU8sV0FBVztBQUMvQixRQUFNLFlBQVksYUFBYSxJQUFJO0FBQ25DLFFBQU0sTUFBTSxXQUFXLFdBQVcsV0FBVztBQUM3QyxRQUFNLFFBQVEsSUFBSSxPQUFPLFlBQVksSUFBSSxNQUFNO0FBRS9DLFNBQU8sT0FBTyxJQUFJLENBQUMsT0FBTyxNQUFNO0FBQzlCLFVBQU0sUUFBUSxTQUFTLE1BQU0sT0FBTyxJQUFJO0FBQ3hDLFFBQUksVUFBVSxLQUFNLFFBQU8sR0FBRyxTQUFTLEdBQUcsSUFBSSxHQUFHLE1BQU0sTUFBTTtBQUM3RCxVQUFNLE9BQU8sTUFBTSxJQUFJLEdBQUcsU0FBUyxHQUFHLElBQUksR0FBRyxHQUFHLEtBQUssR0FBRyxXQUFXLEdBQUcsS0FBSztBQUMzRSxXQUFPLEdBQUcsSUFBSSxHQUFHLEtBQUssR0FBRyxNQUFNLE1BQU07QUFBQSxFQUN2QyxDQUFDO0FBQ0g7QUFFQSxTQUFTLFlBQVksT0FBdUIsUUFBMEI7QUFDcEUsUUFBTSxRQUFrQixDQUFDO0FBQ3pCLFFBQU0sUUFBUSxNQUFNLElBQUksU0FBUztBQUNqQyxRQUFNLGNBQWMsbUJBQW1CLEtBQUs7QUFDNUMsUUFBTSxRQUFRLENBQUMsTUFBTSxNQUFNO0FBQ3pCLFVBQU0sU0FBUyxNQUFNLE1BQU0sU0FBUztBQUNwQyxVQUFNLFlBQVksR0FBRyxNQUFNLEdBQUcsU0FBUyxrQkFBUSxlQUFLO0FBQ3BELFVBQU0sY0FBYyxHQUFHLE1BQU0sR0FBRyxTQUFTLFFBQVEsVUFBSztBQUN0RCxRQUFJLEtBQUssS0FBSyxTQUFTLFFBQVE7QUFDN0IsWUFBTSxLQUFLLEdBQUcsZ0JBQWdCLEtBQUssTUFBTSxLQUFLLEtBQUssUUFBUSxXQUFXLGFBQWEsV0FBVyxDQUFDO0FBQUEsSUFDakcsT0FBTztBQUNMLFlBQU0sS0FBSyxHQUFHLFNBQVMsR0FBRyxLQUFLLElBQUksR0FBRztBQUN0QyxZQUFNLEtBQUssR0FBRyxZQUFZLEtBQUssS0FBSyxVQUFVLFdBQVcsQ0FBQztBQUFBLElBQzVEO0FBQUEsRUFDRixDQUFDO0FBQ0QsU0FBTztBQUNUO0FBcUJPLFNBQVMsaUJBQWlCLFNBQWlDO0FBQ2hFLFFBQU0sU0FBUyxZQUFZLE9BQU87QUFDbEMsU0FBTyxZQUFZLFFBQVEsRUFBRTtBQUMvQjs7O0FEMWNBLFNBQVMsY0FBYyxTQUEyQjtBQUNoRCxNQUFJLFFBQVEsV0FBVyxFQUFHLFFBQU8sQ0FBQztBQUNsQyxRQUFNLFVBQVUsUUFBUSxTQUFTLElBQUksSUFBSSxRQUFRLE1BQU0sR0FBRyxFQUFFLElBQUk7QUFDaEUsTUFBSSxRQUFRLFdBQVcsRUFBRyxRQUFPLENBQUM7QUFDbEMsU0FBTyxRQUFRLE1BQU0sSUFBSTtBQUMzQjtBQW1CTyxTQUFTLGFBQWEsU0FBaUIsZUFBaUQ7QUFDN0YsUUFBTSxTQUFTLGNBQWMsT0FBTztBQUNwQyxNQUFJLE9BQU8sV0FBVyxFQUFHLFFBQU87QUFFaEMsUUFBTSxXQUFXLGNBQWMsTUFBTSxJQUFJO0FBQ3pDLFFBQU0sT0FBTyxTQUFTLFNBQVMsT0FBTztBQUN0QyxRQUFNLFNBQW1CLENBQUM7QUFDMUIsV0FBUyxJQUFJLEdBQUcsS0FBSyxNQUFNLEtBQUs7QUFDOUIsUUFBSSxLQUFLO0FBQ1QsYUFBUyxJQUFJLEdBQUcsSUFBSSxPQUFPLFFBQVEsS0FBSztBQUN0QyxVQUFJLFNBQVMsSUFBSSxDQUFDLE1BQU0sT0FBTyxDQUFDLEdBQUc7QUFDakMsYUFBSztBQUNMO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFDQSxRQUFJLElBQUk7QUFDTixhQUFPLEtBQUssQ0FBQztBQUNiLFVBQUksT0FBTyxTQUFTLEVBQUc7QUFBQSxJQUN6QjtBQUFBLEVBQ0Y7QUFFQSxNQUFJLE9BQU8sV0FBVyxHQUFHO0FBQ3ZCLFdBQU8sRUFBRSxPQUFPLE9BQU8sQ0FBQyxJQUFJLEdBQUcsS0FBSyxPQUFPLENBQUMsSUFBSSxPQUFPLE9BQU87QUFBQSxFQUNoRTtBQUNBLFNBQU87QUFDVDtBQTBJQSxTQUFTLFNBQVMsTUFBYyxRQUFpQztBQUcvRCxTQUFPLEdBQUcsSUFBSSxJQUFLLE1BQU07QUFDM0I7QUFHQSxTQUFTLFdBQVcsS0FBMkI7QUFDN0MsTUFBSSxJQUFJLFVBQVUsS0FBSyxJQUFJLFFBQVEsRUFBRyxRQUFPLElBQUk7QUFDakQsU0FBTyxHQUFHLElBQUksSUFBSSxLQUFLLElBQUksS0FBSyxLQUFLLElBQUksR0FBRztBQUM5QztBQUVBLFNBQVMsWUFBWSxVQUEwQjtBQUM3QyxTQUFPLEdBQUcsUUFBUTtBQUNwQjtBQUVBLFNBQVMsWUFBWSxVQUEwQjtBQUM3QyxTQUFPLGlCQUFpQixRQUFRO0FBQ2xDO0FBTUEsU0FBUyxZQUFZLGNBQXNCLE1BQWtDO0FBQzNFLE1BQUksU0FBUyxTQUFTO0FBQ3BCLFdBQU8saUJBQWlCLElBQ3BCLHNEQUNBO0FBQUEsRUFDTjtBQUNBLFNBQU8saUJBQWlCLElBQ3BCLHNEQUNBO0FBQ047QUFFQSxTQUFTLFlBQVksY0FBZ0M7QUFDbkQsTUFBSSxhQUFhLFdBQVcsR0FBRztBQUM3QixVQUFNLE9BQU8sYUFBYSxDQUFDO0FBQzNCLFdBQU8sNklBQW1JLElBQUksMENBQTBDLElBQUk7QUFBQSxFQUM5TDtBQUNBLFNBQU87QUFDVDtBQUdBLFNBQVMsV0FBVyxLQUErQjtBQUNqRCxNQUFJLElBQUksVUFBVSxLQUFLLElBQUksUUFBUSxFQUFHLFFBQU8sRUFBRSxNQUFNLGFBQWE7QUFDbEUsU0FBTyxFQUFFLE1BQU0sU0FBUyxPQUFPLElBQUksT0FBTyxLQUFLLElBQUksSUFBSTtBQUN6RDtBQWFBLFNBQVMsY0FBYyxTQUF5QixVQUF5QztBQUN2RixRQUFNLE9BQU8sUUFBUSxJQUFJLENBQUMsV0FBVztBQUNuQyxVQUFNLGFBQWEsUUFBUSxPQUFPLENBQUMsTUFBTSxFQUFFLFNBQVMsT0FBTyxJQUFJLEVBQUUsV0FBVztBQUM1RSxVQUFNLFdBQVcsb0JBQUksSUFBcUI7QUFDMUMsZUFBVyxPQUFPLFVBQVU7QUFDMUIsVUFBSSxJQUFJLFNBQVMsT0FBTyxLQUFNO0FBQzlCLFVBQUksY0FBZSxJQUFJLFVBQVUsT0FBTyxTQUFTLElBQUksUUFBUSxPQUFPLEtBQU07QUFDeEUsaUJBQVMsSUFBSSxJQUFJLE1BQU07QUFBQSxNQUN6QjtBQUFBLElBQ0Y7QUFDQSxVQUFNLFNBQVMsQ0FBQyxHQUFHLFFBQVEsRUFBRSxLQUFLO0FBQ2xDLFVBQU0sU0FBUyxPQUFPLFNBQVMsSUFBSSxXQUFNLE9BQU8sSUFBSSxnQkFBZ0IsRUFBRSxLQUFLLElBQUksQ0FBQyxLQUFLO0FBQ3JGLFdBQU8sRUFBRSxNQUFNLE9BQU8sTUFBTSxPQUFPLFdBQVcsTUFBTSxHQUFHLE9BQU87QUFBQSxFQUNoRSxDQUFDO0FBQ0QsTUFBSTtBQUNGLFdBQU8saUJBQWlCLGVBQWUsSUFBSSxDQUFDO0FBQUEsRUFDOUMsUUFBUTtBQVlOLFdBQU8sUUFBUSxJQUFJLENBQUMsUUFBUSxNQUFNLEtBQUssV0FBVyxNQUFNLENBQUMsR0FBRyxLQUFLLENBQUMsRUFBRSxNQUFNLEVBQUU7QUFBQSxFQUM5RTtBQUNGO0FBWUEsU0FBUyxrQkFDUCxNQUNBLFNBQ0EsVUFDQSxLQUNRO0FBQ1IsUUFBTSxRQUFRLENBQUMsTUFBTSxJQUFJLElBQUksR0FBRyxjQUFjLFNBQVMsUUFBUSxDQUFDO0FBQ2hFLE1BQUksSUFBSyxPQUFNLEtBQUssSUFBSSxHQUFHO0FBQzNCLFNBQU8sTUFBTSxLQUFLLElBQUk7QUFDeEI7QUFNQSxTQUFTLFdBQVcsVUFBb0IsUUFBZ0IsUUFBd0I7QUFDOUUsUUFBTSxPQUFPLEdBQUcsTUFBTTtBQUFBO0FBQUEsRUFBTyxTQUFTLEtBQUssYUFBYSxDQUFDO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFBYyxNQUFNO0FBQzdFLFNBQU87QUFBQTtBQUFBLEVBQWlCLElBQUk7QUFBQTtBQUFBO0FBQzlCO0FBT0EsU0FBUyxXQUFXLEtBQW1CLE9BQTBDO0FBQy9FLE1BQUksVUFBVSxhQUFjLFFBQU87QUFDbkMsTUFBSSxJQUFJLFVBQVUsS0FBSyxJQUFJLFFBQVEsRUFBRyxRQUFPO0FBQzdDLFNBQU8sZ0JBQWdCLE9BQU8sRUFBRSxPQUFPLElBQUksT0FBTyxLQUFLLElBQUksSUFBSSxDQUFDO0FBQ2xFO0FBUUEsU0FBUyxxQkFBcUIsU0FBaUIsVUFBNEM7QUFDekYsTUFBSSxRQUFRLFdBQVcsRUFBRyxRQUFPO0FBQ2pDLE1BQUk7QUFDSixNQUFJO0FBQ0YsY0FBYSxpQkFBYSxVQUFVLE1BQU07QUFBQSxFQUM1QyxRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDQSxTQUFPLGFBQWEsU0FBUyxPQUFPO0FBQ3RDO0FBT08sSUFBTSxxQkFBcUI7QUFZbEMsU0FBUyxpQkFDUCxRQUNBLE9BQ0EsVUFDMEI7QUFDMUIsTUFBSSxXQUFXLFVBQWEsVUFBVSxPQUFXLFFBQU87QUFDeEQsUUFBTSxRQUFRLFVBQVU7QUFDeEIsTUFBSTtBQUNKLE1BQUk7QUFDRixVQUFNLFVBQWEsaUJBQWEsVUFBVSxNQUFNO0FBQ2hELGdCQUFZLFFBQVEsV0FBVyxJQUFJLElBQUksUUFBUSxNQUFNLElBQUksRUFBRTtBQUFBLEVBQzdELFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNBLFFBQU0sTUFBTSxLQUFLLElBQUksU0FBUyxTQUFTLHNCQUFzQixHQUFHLEtBQUssSUFBSSxXQUFXLEtBQUssQ0FBQztBQUMxRixTQUFPLEVBQUUsT0FBTyxJQUFJO0FBQ3RCO0FBU0EsU0FBUyxjQUFjLEtBQW1CLFVBQTJCO0FBQ25FLFNBQU8sYUFBYSxJQUFJLFFBQVEsU0FBUyxTQUFTLElBQUksSUFBSSxJQUFJLEVBQUU7QUFDbEU7QUFjQSxlQUFlLGVBQ2IsT0FDQSxXQUNBLE1BQ0EsT0FDd0I7QUFDeEIsUUFBTSxXQUFXLE1BQU0sVUFBVSxLQUFLLE1BQU0sVUFBVSxNQUFNLEdBQUc7QUFDL0QsTUFBSSxTQUFTLFdBQVcsRUFBRyxRQUFPO0FBSWxDLFFBQU0sZ0JBQWdCLG9CQUFJLElBQTRCO0FBQ3RELGFBQVcsT0FBTyxVQUFVO0FBQzFCLFVBQU0sT0FBTyxjQUFjLElBQUksSUFBSSxJQUFJLEtBQUssQ0FBQztBQUM3QyxTQUFLLEtBQUssR0FBRztBQUNiLGtCQUFjLElBQUksSUFBSSxNQUFNLElBQUk7QUFBQSxFQUNsQztBQUNBLFFBQU0sZUFBZSxDQUFDLEdBQUcsY0FBYyxLQUFLLENBQUMsRUFBRTtBQUFBLElBQU8sQ0FBQyxVQUNwRCxjQUFjLElBQUksSUFBSSxLQUFLLENBQUMsR0FBRyxLQUFLLENBQUMsUUFBUSxjQUFjLEtBQUssTUFBTSxRQUFRLEtBQUssV0FBVyxLQUFLLEtBQUssQ0FBQztBQUFBLEVBQzVHO0FBQ0EsTUFBSSxhQUFhLFdBQVcsRUFBRyxRQUFPO0FBRXRDLFFBQU0sWUFBWSxNQUFNLFVBQVUsTUFBTSxDQUFDLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRztBQUNuRSxRQUFNLGNBQWMsb0JBQUksSUFBaUM7QUFDekQsYUFBVyxPQUFPLFdBQVc7QUFDM0IsVUFBTSxPQUFPLFlBQVksSUFBSSxJQUFJLElBQUksS0FBSyxDQUFDO0FBQzNDLFNBQUssS0FBSyxHQUFHO0FBQ2IsZ0JBQVksSUFBSSxJQUFJLE1BQU0sSUFBSTtBQUFBLEVBQ2hDO0FBRUEsUUFBTSxXQUFXLEtBQUssWUFBWSxNQUFNLFNBQVM7QUFDakQsUUFBTSxXQUFxQixDQUFDO0FBQzVCLFFBQU0sV0FBcUIsQ0FBQztBQUM1QixRQUFNLGVBQXlCLENBQUM7QUFFaEMsYUFBVyxRQUFRLGNBQWM7QUFDL0IsVUFBTSxZQUFZLFlBQVksSUFBSSxJQUFJLEtBQUssQ0FBQztBQUM1QyxVQUFNLFdBQVcsVUFBVSxPQUFPLENBQUMsUUFBUSxPQUFPLElBQUksTUFBTSxDQUFDO0FBQzdELFFBQUksVUFBVSxTQUFTLEtBQUssU0FBUyxXQUFXLEVBQUc7QUFFbkQsVUFBTSxlQUFlLENBQUMsR0FBRyxJQUFJLElBQUksU0FBUyxJQUFJLENBQUMsUUFBUSxJQUFJLE1BQU0sQ0FBQyxDQUFDLEVBQUUsS0FBSztBQUMxRSxVQUFNLGlCQUFpQixhQUFhLE9BQU8sQ0FBQyxXQUFXLENBQUMsU0FBUyxJQUFJLFNBQVMsTUFBTSxNQUFNLENBQUMsQ0FBQztBQUM1RixVQUFNLFlBQVksQ0FBQyxTQUFTLElBQUksSUFBSTtBQUNwQyxRQUFJLENBQUMsYUFBYSxlQUFlLFdBQVcsRUFBRztBQUUvQyxVQUFNLE1BQU0sTUFBTSxVQUFVLElBQUksTUFBTSxNQUFNLEdBQUc7QUFDL0MsYUFBUyxLQUFLLGtCQUFrQixNQUFNLGNBQWMsSUFBSSxJQUFJLEtBQUssQ0FBQyxHQUFHLFVBQVUsR0FBRyxDQUFDO0FBQ25GLFFBQUksYUFBYSxTQUFTLEVBQUcsY0FBYSxLQUFLLElBQUk7QUFFbkQsUUFBSSxVQUFXLFVBQVMsS0FBSyxJQUFJO0FBQ2pDLGVBQVcsVUFBVSxlQUFnQixVQUFTLEtBQUssU0FBUyxNQUFNLE1BQU0sQ0FBQztBQUFBLEVBQzNFO0FBRUEsTUFBSSxTQUFTLFdBQVcsRUFBRyxRQUFPO0FBQ2xDLE9BQUssWUFBWSxNQUFNLFdBQVcsUUFBUTtBQUMxQyxRQUFNLFdBQVdDLFVBQVMsTUFBTSxRQUFRO0FBQ3hDLFFBQU0sU0FBUyxhQUFhLFNBQVMsSUFBSSxZQUFZLGFBQWEsUUFBUSxNQUFNLElBQUksSUFBSSxZQUFZLFFBQVE7QUFDNUcsUUFBTSxTQUFTLGFBQWEsU0FBUyxJQUFJLFlBQVksWUFBWSxJQUFJLFlBQVksUUFBUTtBQUN6RixTQUFPLFdBQVcsVUFBVSxRQUFRLE1BQU07QUFDNUM7QUFxQkEsZUFBc0IsYUFDcEIsT0FDQSxXQUNBLE1BQ3NCO0FBQ3RCLE1BQUksZUFBZTtBQUNuQixNQUFJO0FBQ0YsUUFBSSxRQUFrQztBQUN0QyxRQUFJLE1BQU0sU0FBUyxTQUFTO0FBQzFCLFlBQU0sTUFBTSxNQUFNLFVBQVUsSUFBSSxNQUFNLFVBQVUsTUFBTSxHQUFHO0FBQ3pELHFCQUFlLElBQUk7QUFDbkIsY0FBUSxxQkFBcUIsTUFBTSxTQUFTLE1BQU0sUUFBUTtBQUFBLElBQzVELE9BQU87QUFDTCxjQUFRLGlCQUFpQixNQUFNLFFBQVEsTUFBTSxPQUFPLE1BQU0sUUFBUTtBQUFBLElBQ3BFO0FBQ0EsVUFBTSxvQkFBb0IsTUFBTSxlQUFlLE9BQU8sV0FBVyxNQUFNLEtBQUs7QUFDNUUsV0FBTyxFQUFFLG1CQUFtQixhQUFhO0FBQUEsRUFDM0MsUUFBUTtBQUdOLFdBQU8sRUFBRSxtQkFBbUIsTUFBTSxhQUFhO0FBQUEsRUFDakQ7QUFDRjtBQU1BLElBQU0scUJBQXFCO0FBRzNCLFNBQVMsV0FBVyxVQUFrQixLQUEyRDtBQUMvRixRQUFNLFdBQVcsZ0JBQWdCLEdBQUc7QUFDcEMsTUFBSSxDQUFDLFNBQVUsUUFBTztBQUN0QixTQUFPLEVBQUUsVUFBVSxTQUFTLGVBQWUsVUFBVSxRQUFRLEVBQUU7QUFDakU7QUFPQSxTQUFTLG1CQUFtQixVQUEwQjtBQUNwRCxRQUFNLFdBQVcsZ0JBQWdCLFFBQVE7QUFDekMsTUFBSTtBQUNGLFdBQU9DLGNBQWEsT0FBTyxDQUFDLE1BQU0sVUFBVSxVQUFVLGVBQWUsTUFBTSxRQUFRLEdBQUc7QUFBQSxNQUNwRixVQUFVO0FBQUEsTUFDVixPQUFPLENBQUMsVUFBVSxRQUFRLFFBQVE7QUFBQSxNQUNsQyxTQUFTO0FBQUEsSUFDWCxDQUFDO0FBQUEsRUFDSCxRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQVNPLFNBQVMsNEJBQTRCLFlBQW9CLG9CQUFvQztBQUNsRyxTQUFPO0FBQUEsSUFDTCxLQUFLLE9BQU8sVUFBVSxRQUFRO0FBQzVCLFlBQU0sV0FBVyxXQUFXLFVBQVUsR0FBRztBQUN6QyxVQUFJLENBQUMsU0FBVSxRQUFPLEVBQUUsVUFBVSxNQUFNO0FBQ3hDLFlBQU0sU0FBUyxtQkFBbUIsU0FBUyxRQUFRO0FBQ25ELFVBQUk7QUFDRixRQUFBQSxjQUFhLE9BQU8sQ0FBQyxRQUFRLFNBQVMsU0FBUyxTQUFTLE9BQU8sR0FBRztBQUFBLFVBQ2hFLEtBQUssU0FBUztBQUFBLFVBQ2QsVUFBVTtBQUFBLFVBQ1YsT0FBTyxDQUFDLFVBQVUsUUFBUSxNQUFNO0FBQUEsVUFDaEMsU0FBUztBQUFBLFFBQ1gsQ0FBQztBQUFBLE1BQ0gsUUFBUTtBQUFBLE1BSVI7QUFDQSxZQUFNLFFBQVEsbUJBQW1CLFNBQVMsUUFBUTtBQUNsRCxhQUFPLEVBQUUsVUFBVSxXQUFXLE1BQU07QUFBQSxJQUN0QztBQUFBLElBRUEsTUFBTSxPQUFPLFVBQVUsUUFBUTtBQUM3QixZQUFNLFdBQVcsV0FBVyxVQUFVLEdBQUc7QUFDekMsVUFBSSxDQUFDLFNBQVUsUUFBTyxDQUFDO0FBQ3ZCLFVBQUk7QUFDRixjQUFNLE1BQU1BLGNBQWEsT0FBTyxDQUFDLFFBQVEsUUFBUSxlQUFlLFNBQVMsT0FBTyxHQUFHO0FBQUEsVUFDakYsS0FBSyxTQUFTO0FBQUEsVUFDZCxVQUFVO0FBQUEsVUFDVixPQUFPLENBQUMsVUFBVSxRQUFRLE1BQU07QUFBQSxVQUNoQyxTQUFTO0FBQUEsUUFDWCxDQUFDO0FBQ0QsZUFBTyxlQUFlLEdBQUc7QUFBQSxNQUMzQixRQUFRO0FBQ04sZUFBTyxDQUFDO0FBQUEsTUFDVjtBQUFBLElBQ0Y7QUFBQSxJQUVBLE9BQU8sT0FBTyxNQUFNLFFBQVE7QUFDMUIsWUFBTSxXQUFXLGdCQUFnQixHQUFHO0FBQ3BDLFlBQU0sU0FBUyxZQUFZO0FBRzNCLFlBQU0sU0FBUyxXQUFXLEtBQUssSUFBSSxDQUFDLE1BQU0sZUFBZSxVQUFVLENBQUMsQ0FBQyxJQUFJO0FBQ3pFLFVBQUk7QUFDSixVQUFJO0FBQ0YsY0FBTUEsY0FBYSxPQUFPLENBQUMsUUFBUSxTQUFTLFlBQVksYUFBYSxHQUFHLE1BQU0sR0FBRztBQUFBLFVBQy9FLEtBQUs7QUFBQSxVQUNMLFVBQVU7QUFBQSxVQUNWLE9BQU8sQ0FBQyxVQUFVLFFBQVEsTUFBTTtBQUFBLFVBQ2hDLFNBQVM7QUFBQSxRQUNYLENBQUM7QUFBQSxNQUNILFNBQVMsS0FBSztBQUNaLGNBQU0sV0FBWSxJQUE0QjtBQUM5QyxZQUFJLE9BQU8sYUFBYSxVQUFVO0FBQ2hDLGdCQUFNO0FBQUEsUUFDUixPQUFPO0FBQ0wsaUJBQU8sQ0FBQztBQUFBLFFBQ1Y7QUFBQSxNQUNGO0FBQ0EsYUFBTyxvQkFBb0IsR0FBRztBQUFBLElBQ2hDO0FBQUEsSUFFQSxLQUFLLE9BQU8sTUFBTSxRQUFRO0FBQ3hCLFlBQU0sV0FBVyxnQkFBZ0IsR0FBRztBQUNwQyxVQUFJO0FBQ0YsY0FBTSxNQUFNQSxjQUFhLE9BQU8sQ0FBQyxRQUFRLE9BQU8sSUFBSSxHQUFHO0FBQUEsVUFDckQsS0FBSyxZQUFZO0FBQUEsVUFDakIsVUFBVTtBQUFBLFVBQ1YsT0FBTyxDQUFDLFVBQVUsUUFBUSxNQUFNO0FBQUEsVUFDaEMsU0FBUztBQUFBLFFBQ1gsQ0FBQztBQUNELGNBQU0sT0FBTyxJQUFJLFFBQVE7QUFHekIsWUFBSSxLQUFLLFdBQVcsS0FBSyxTQUFTLEtBQUssSUFBSSwwQkFBMkIsUUFBTztBQUM3RSxlQUFPO0FBQUEsTUFDVCxRQUFRO0FBQ04sZUFBTztBQUFBLE1BQ1Q7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGOzs7QUU1bkJBLFlBQVlDLFNBQVE7QUFjcEIsSUFBTSxtQkFBbUI7QUFDekIsSUFBTSxrQkFBa0I7QUFDeEIsSUFBTSxxQkFBcUI7QUFDM0IsSUFBTSxxQkFBcUI7QUFDM0IsSUFBTSxpQkFBaUI7QUFDdkIsSUFBTSxhQUFhO0FBQ25CLElBQU0sd0JBQXdCO0FBQzlCLElBQU0sOEJBQThCO0FBNkI3QixTQUFTLHVCQUF1QixNQUE2QjtBQUNsRSxNQUFJO0FBQ0YsV0FBVSxpQkFBYSxNQUFNLE1BQU07QUFBQSxFQUNyQyxRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQUVBLFNBQVNDLFNBQVEsR0FBbUI7QUFDbEMsU0FBTyxFQUFFLFFBQVEsT0FBTyxHQUFHO0FBQzdCO0FBWUEsU0FBUyxVQUFVLFNBQXlCO0FBQzFDLFFBQU0sUUFBZ0IsQ0FBQztBQUd2QixNQUFJLGFBQWlEO0FBRXJELGFBQVcsT0FBTyxRQUFRLE1BQU0sSUFBSSxHQUFHO0FBSXJDLFVBQU0sYUFBcUIsYUFBYSxJQUFJLFFBQVEsYUFBYSxFQUFFLElBQUksSUFBSSxLQUFLO0FBRWhGLFFBQUksZUFBZSxrQkFBa0I7QUFDbkMsbUJBQWE7QUFDYjtBQUFBLElBQ0Y7QUFDQSxRQUFJLFdBQVcsV0FBVyxlQUFlLEdBQUc7QUFDMUMsWUFBTSxLQUFLLEVBQUUsTUFBTSxPQUFPLE1BQU0sV0FBVyxNQUFNLGdCQUFnQixNQUFNLEVBQUUsQ0FBQztBQUMxRSxtQkFBYTtBQUNiO0FBQUEsSUFDRjtBQUNBLFFBQUksV0FBVyxXQUFXLGtCQUFrQixHQUFHO0FBQzdDLFlBQU0sS0FBSyxFQUFFLE1BQU0sVUFBVSxNQUFNLFdBQVcsTUFBTSxtQkFBbUIsTUFBTSxFQUFFLENBQUM7QUFDaEYsbUJBQWE7QUFDYjtBQUFBLElBQ0Y7QUFDQSxRQUFJLFdBQVcsV0FBVyxrQkFBa0IsR0FBRztBQUM3QyxZQUFNLE9BQWtDO0FBQUEsUUFDdEMsTUFBTTtBQUFBLFFBQ04sTUFBTSxXQUFXLE1BQU0sbUJBQW1CLE1BQU07QUFBQSxRQUNoRCxVQUFVO0FBQUEsUUFDVixRQUFRLENBQUM7QUFBQSxNQUNYO0FBQ0EsWUFBTSxLQUFLLElBQUk7QUFDZixtQkFBYTtBQUNiO0FBQUEsSUFDRjtBQUVBLFFBQUksWUFBWTtBQUNkLHdCQUFrQixZQUFZLEdBQUc7QUFBQSxJQUNuQztBQUFBLEVBR0Y7QUFFQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLFlBQVksTUFBOEM7QUFDakUsUUFBTSxPQUFPLEtBQUssT0FBTyxLQUFLLE9BQU8sU0FBUyxDQUFDO0FBQy9DLE1BQUksS0FBTSxRQUFPO0FBQ2pCLFFBQU0sUUFBcUIsRUFBRSxlQUFlLE1BQU0sVUFBVSxDQUFDLEdBQUcsVUFBVSxDQUFDLEVBQUU7QUFDN0UsT0FBSyxPQUFPLEtBQUssS0FBSztBQUN0QixTQUFPO0FBQ1Q7QUFHQSxTQUFTLGtCQUFrQixNQUFpQyxLQUFtQjtBQUM3RSxRQUFNLGFBQWEsSUFBSSxRQUFRLGFBQWEsRUFBRTtBQUU5QyxNQUFJLGVBQWUsV0FBWTtBQUcvQixNQUFJLEtBQUssT0FBTyxXQUFXLEtBQUssS0FBSyxhQUFhLFFBQVEsV0FBVyxXQUFXLGNBQWMsR0FBRztBQUMvRixTQUFLLFdBQVcsV0FBVyxNQUFNLGVBQWUsTUFBTTtBQUN0RDtBQUFBLEVBQ0Y7QUFFQSxNQUFJLGVBQWUsNkJBQTZCO0FBQzlDLFNBQUssT0FBTyxLQUFLLEVBQUUsZUFBZSxNQUFNLFVBQVUsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxFQUFFLENBQUM7QUFDcEU7QUFBQSxFQUNGO0FBQ0EsTUFBSSxXQUFXLFdBQVcscUJBQXFCLEdBQUc7QUFDaEQsU0FBSyxPQUFPLEtBQUssRUFBRSxlQUFlLFdBQVcsTUFBTSxzQkFBc0IsTUFBTSxHQUFHLFVBQVUsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxFQUFFLENBQUM7QUFDOUc7QUFBQSxFQUNGO0FBR0EsTUFBSSxRQUFRLElBQUk7QUFDZCxVQUFNLFFBQVEsWUFBWSxJQUFJO0FBQzlCLFVBQU0sU0FBUyxLQUFLLEVBQUU7QUFDdEIsVUFBTSxTQUFTLEtBQUssRUFBRTtBQUN0QjtBQUFBLEVBQ0Y7QUFDQSxRQUFNLFFBQVEsSUFBSSxDQUFDO0FBQ25CLE1BQUksVUFBVSxLQUFLO0FBQ2pCLFVBQU0sUUFBUSxZQUFZLElBQUk7QUFDOUIsVUFBTSxVQUFVLElBQUksTUFBTSxDQUFDO0FBQzNCLFVBQU0sU0FBUyxLQUFLLE9BQU87QUFDM0IsVUFBTSxTQUFTLEtBQUssT0FBTztBQUMzQjtBQUFBLEVBQ0Y7QUFDQSxNQUFJLFVBQVUsS0FBSztBQUNqQixVQUFNLFFBQVEsWUFBWSxJQUFJO0FBQzlCLFVBQU0sU0FBUyxLQUFLLElBQUksTUFBTSxDQUFDLENBQUM7QUFDaEM7QUFBQSxFQUNGO0FBQ0EsTUFBSSxVQUFVLEtBQUs7QUFDakIsVUFBTSxRQUFRLFlBQVksSUFBSTtBQUM5QixVQUFNLFNBQVMsS0FBSyxJQUFJLE1BQU0sQ0FBQyxDQUFDO0FBQ2hDO0FBQUEsRUFDRjtBQUVGO0FBUUEsU0FBUyxXQUFXLFNBQTJCO0FBQzdDLFNBQU8sUUFBUSxNQUFNLElBQUk7QUFDM0I7QUFHQSxTQUFTLFlBQVksT0FBaUIsT0FBeUI7QUFDN0QsUUFBTSxNQUFnQixDQUFDO0FBQ3ZCLFdBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUs7QUFDckMsUUFBSSxNQUFNLENBQUMsTUFBTSxNQUFPLEtBQUksS0FBSyxDQUFDO0FBQUEsRUFDcEM7QUFDQSxTQUFPO0FBQ1Q7QUFHQSxTQUFTLGtCQUFrQixVQUFvQixRQUE0QjtBQUN6RSxRQUFNLE1BQWdCLENBQUM7QUFDdkIsTUFBSSxPQUFPLFdBQVcsS0FBSyxPQUFPLFNBQVMsU0FBUyxPQUFRLFFBQU87QUFDbkUsUUFBTSxPQUFPLFNBQVMsU0FBUyxPQUFPO0FBQ3RDLFdBQVMsSUFBSSxHQUFHLEtBQUssTUFBTSxLQUFLO0FBQzlCLFFBQUksS0FBSztBQUNULGFBQVMsSUFBSSxHQUFHLElBQUksT0FBTyxRQUFRLEtBQUs7QUFDdEMsVUFBSSxTQUFTLElBQUksQ0FBQyxNQUFNLE9BQU8sQ0FBQyxHQUFHO0FBQ2pDLGFBQUs7QUFDTDtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsUUFBSSxHQUFJLEtBQUksS0FBSyxDQUFDO0FBQUEsRUFDcEI7QUFDQSxTQUFPO0FBQ1Q7QUFXQSxTQUFTLFlBQVksVUFBb0IsT0FBc0M7QUFDN0UsUUFBTSxRQUFRLE1BQU07QUFFcEIsTUFBSSxNQUFNLFdBQVcsR0FBRztBQUN0QixVQUFNQyxPQUFNLE1BQU07QUFDbEIsUUFBSUEsU0FBUSxRQUFRQSxTQUFRLElBQUk7QUFDOUIsWUFBTSxVQUFVLFlBQVksVUFBVUEsSUFBRztBQUN6QyxVQUFJLFFBQVEsV0FBVyxHQUFHO0FBQ3hCLGNBQU0sT0FBTyxRQUFRLENBQUMsSUFBSTtBQUMxQixlQUFPLEVBQUUsT0FBTyxNQUFNLEtBQUssS0FBSztBQUFBLE1BQ2xDO0FBQUEsSUFDRjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBRUEsUUFBTSxTQUFTLGtCQUFrQixVQUFVLEtBQUs7QUFDaEQsTUFBSSxPQUFPLFdBQVcsR0FBRztBQUN2QixVQUFNLElBQUksT0FBTyxDQUFDO0FBQ2xCLFdBQU8sRUFBRSxPQUFPLElBQUksR0FBRyxLQUFLLElBQUksTUFBTSxPQUFPO0FBQUEsRUFDL0M7QUFDQSxNQUFJLE9BQU8sV0FBVyxFQUFHLFFBQU87QUFHaEMsUUFBTSxNQUFNLE1BQU07QUFDbEIsTUFBSSxRQUFRLFFBQVEsUUFBUSxJQUFJO0FBQzlCLGVBQVcsS0FBSyxZQUFZLFVBQVUsR0FBRyxHQUFHO0FBQzFDLFlBQU0sUUFBUSxPQUFPLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQztBQUN2QyxVQUFJLFVBQVUsUUFBVztBQUN2QixlQUFPLEVBQUUsT0FBTyxRQUFRLEdBQUcsS0FBSyxRQUFRLE1BQU0sT0FBTztBQUFBLE1BQ3ZEO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFNQSxTQUFTQyxjQUFhLFVBQW9CLFFBQXlDO0FBQ2pGLE1BQUksUUFBMEI7QUFDOUIsYUFBVyxTQUFTLFFBQVE7QUFDMUIsVUFBTSxJQUFJLFlBQVksVUFBVSxLQUFLO0FBQ3JDLFFBQUksTUFBTSxLQUFNLFFBQU87QUFDdkIsWUFBUSxVQUFVLE9BQU8sSUFBSSxFQUFFLE9BQU8sS0FBSyxJQUFJLE1BQU0sT0FBTyxFQUFFLEtBQUssR0FBRyxLQUFLLEtBQUssSUFBSSxNQUFNLEtBQUssRUFBRSxHQUFHLEVBQUU7QUFBQSxFQUN4RztBQUNBLFNBQU87QUFDVDtBQWtCTyxTQUFTLGdCQUNkLFNBQ0Esa0JBQW1DLHdCQUNyQjtBQUNkLFFBQU0sVUFBd0IsQ0FBQztBQUUvQixhQUFXLFFBQVEsVUFBVSxPQUFPLEdBQUc7QUFDckMsUUFBSSxLQUFLLFNBQVMsT0FBTztBQUN2QixjQUFRLEtBQUssRUFBRSxNQUFNRixTQUFRLEtBQUssSUFBSSxHQUFHLE1BQU0sU0FBUyxDQUFDO0FBQ3pEO0FBQUEsSUFDRjtBQUNBLFFBQUksS0FBSyxTQUFTLFVBQVU7QUFDMUIsY0FBUSxLQUFLLEVBQUUsTUFBTUEsU0FBUSxLQUFLLElBQUksR0FBRyxNQUFNLGNBQWMsQ0FBQztBQUM5RDtBQUFBLElBQ0Y7QUFHQSxVQUFNLGFBQWFBLFNBQVEsS0FBSyxZQUFZLEtBQUssSUFBSTtBQUdyRCxRQUFJLEtBQUssYUFBYSxNQUFNO0FBQzFCLGNBQVEsS0FBSyxFQUFFLE1BQU0sWUFBWSxNQUFNLGNBQWMsQ0FBQztBQUN0RDtBQUFBLElBQ0Y7QUFHQSxVQUFNLFVBQVUsZ0JBQWdCLEtBQUssSUFBSTtBQUN6QyxVQUFNLFFBQVEsWUFBWSxPQUFPLE9BQU9FLGNBQWEsV0FBVyxPQUFPLEdBQUcsS0FBSyxNQUFNO0FBQ3JGLFFBQUksVUFBVSxNQUFNO0FBQ2xCLGNBQVEsS0FBSyxFQUFFLE1BQU0sWUFBWSxNQUFNLFNBQVMsTUFBTSxDQUFDO0FBQUEsSUFDekQsT0FBTztBQUNMLGNBQVEsS0FBSyxFQUFFLE1BQU0sWUFBWSxNQUFNLGNBQWMsQ0FBQztBQUFBLElBQ3hEO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFDVDs7O0FDM1NBLElBQU0sNkJBQTZCO0FBT25DLElBQU0sdUJBQXVCLENBQUMsVUFBVSxVQUFVLFdBQVcsTUFBTTtBQUc1RCxTQUFTLHdCQUF3QixXQUFtQztBQUN6RSxNQUFJLGNBQWMsUUFBUSxPQUFPLGNBQWMsWUFBWSxhQUFhLFdBQVc7QUFDakYsVUFBTSxVQUFXLFVBQW1DO0FBQ3BELFFBQUksT0FBTyxZQUFZLFNBQVUsUUFBTztBQUFBLEVBQzFDO0FBQ0EsU0FBTztBQUNUO0FBUUEsU0FBUyxrQkFBa0IsV0FBbUM7QUFDNUQsTUFBSSxjQUFjLFFBQVEsT0FBTyxjQUFjLFlBQVksZUFBZSxXQUFXO0FBQ25GLFVBQU0sT0FBUSxVQUFxQztBQUNuRCxRQUFJLE9BQU8sU0FBUyxVQUFVO0FBQzVCLFVBQUk7QUFDRixjQUFNLFNBQVMsS0FBSyxNQUFNLElBQUk7QUFDOUIsWUFBSSxXQUFXLFFBQVEsT0FBTyxXQUFXLFlBQVksT0FBTyxPQUFPLFFBQVEsVUFBVTtBQUNuRixpQkFBTyxPQUFPO0FBQUEsUUFDaEI7QUFBQSxNQUNGLFFBQVE7QUFDTixlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBU0EsU0FBUyxtQkFBbUIsV0FBbUM7QUFDN0QsTUFBSSxjQUFjLFFBQVEsT0FBTyxjQUFjLFlBQVksV0FBVyxXQUFXO0FBQy9FLFVBQU0sUUFBUyxVQUFpQztBQUNoRCxRQUFJLE9BQU8sVUFBVSxTQUFVLFFBQU87QUFFdEMsVUFBTSxRQUFRLE1BQU0sTUFBTSx5RUFBeUU7QUFDbkcsUUFBSSxDQUFDLE1BQU8sUUFBTztBQUNuQixRQUFJO0FBQ0YsWUFBTSxTQUFTLEtBQUssTUFBTSxNQUFNLENBQUMsQ0FBQztBQUNsQyxVQUFJLFdBQVcsUUFBUSxPQUFPLFdBQVcsWUFBWSxPQUFPLE9BQU8sUUFBUSxVQUFVO0FBQ25GLGVBQU8sT0FBTztBQUFBLE1BQ2hCO0FBQUEsSUFDRixRQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBVUEsU0FBUyxvQkFBb0IsY0FBc0M7QUFDakUsTUFBSSxPQUFPLGlCQUFpQixTQUFVLFFBQU87QUFDN0MsTUFBSSxpQkFBaUIsUUFBUSxPQUFPLGlCQUFpQixVQUFVO0FBQzdELFVBQU0sU0FBUztBQUNmLGVBQVcsU0FBUyxzQkFBc0I7QUFDeEMsWUFBTSxRQUFRLE9BQU8sS0FBSztBQUMxQixVQUFJLE9BQU8sVUFBVSxTQUFVLFFBQU87QUFBQSxJQUN4QztBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFhTyxTQUFTLDJCQUEyQixjQUEwRDtBQUNuRyxRQUFNLE9BQU8sb0JBQW9CLFlBQVk7QUFDN0MsTUFBSSxTQUFTLEtBQU0sUUFBTztBQUMxQixTQUFPLEtBQUssV0FBVywwQkFBMEIsSUFBSSxZQUFZO0FBQ25FO0FBR0EsSUFBTSxrQkFBa0IsTUFBWTtBQUU3QixTQUFTLGNBQ2QsWUFBNEIsNEJBQTRCLEdBQ3hELGNBQTJCLHFCQUMzQjtBQUNBLFNBQU8sT0FBTyxPQUF5QixRQUFxQjtBQU0xRCxRQUFJLE9BQU8sS0FBSyx3Q0FBd0M7QUFBQSxNQUN0RCxXQUFXLE1BQU07QUFBQSxNQUNqQixpQkFBaUIsT0FBTyxNQUFNO0FBQUEsTUFDOUIsaUJBQ0UsTUFBTSxlQUFlLFFBQVEsT0FBTyxNQUFNLGVBQWUsV0FDckQsT0FBTyxLQUFLLE1BQU0sVUFBcUMsSUFDdkQ7QUFBQSxJQUNSLENBQUM7QUFFRCxVQUFNLFlBQVksTUFBTTtBQUN4QixVQUFNLE1BQU0sTUFBTSxPQUFPO0FBQ3pCLFVBQU0sWUFBWSxNQUFNO0FBQ3hCLFVBQU0sT0FBTyxZQUFZLElBQUksTUFBTTtBQU9uQyxRQUFJLGNBQWMsa0JBQWtCLGNBQWMsUUFBUTtBQUN4RCxZQUFNQyxXQUFVLGtCQUFrQixNQUFNLFVBQVUsS0FBSyxtQkFBbUIsTUFBTSxVQUFVO0FBQzFGLFVBQUksQ0FBQ0EsU0FBUyxRQUFPO0FBRXJCLFlBQU0sVUFBVSxxQkFBcUJBLFVBQVMsR0FBRztBQUNqRCxZQUFNQyxVQUFtQixDQUFDO0FBQzFCLGlCQUFXLFNBQVMsU0FBUztBQUMzQixZQUFJLE1BQU0sV0FBVyxXQUFZO0FBQ2pDLGNBQU0sT0FBTyxNQUFNO0FBQ25CLGNBQU0sVUFBVSxlQUFlLEtBQUssS0FBSyxZQUFZO0FBQ3JELGNBQU0sUUFBUSxrQkFBa0IsS0FBSyxPQUFPO0FBQzVDLFlBQUksQ0FBQyxNQUFPO0FBQ1osWUFBSTtBQVNKLFlBQUksTUFBTSxVQUFVLGlCQUFpQjtBQUNuQyx1QkFBYSxFQUFFLE1BQU0sU0FBUyxXQUFXLEtBQUssVUFBVSxTQUFTLFNBQVMsR0FBRztBQUFBLFFBQy9FLE9BQU87QUFDTCx1QkFBYTtBQUFBLFlBQ1gsTUFBTTtBQUFBLFlBQ047QUFBQSxZQUNBO0FBQUEsWUFDQSxVQUFVO0FBQUEsWUFDVixRQUFRLEtBQUs7QUFBQSxZQUNiLE9BQU8sS0FBSyxVQUFVLEtBQUssWUFBWTtBQUFBLFVBQ3pDO0FBQUEsUUFDRjtBQUNBLGNBQU0sU0FBUyxNQUFNLGFBQWEsWUFBMEIsV0FBVyxJQUFJO0FBQzNFLFlBQUksT0FBTyxrQkFBbUIsQ0FBQUEsUUFBTyxLQUFLLE9BQU8saUJBQWlCO0FBQUEsTUFDcEU7QUFDQSxVQUFJQSxRQUFPLFdBQVcsRUFBRyxRQUFPO0FBQ2hDLFlBQU1DLFlBQVdELFFBQU8sS0FBSyxFQUFFO0FBQy9CLGFBQU8sa0JBQWtCLEVBQUUsbUJBQW1CQyxXQUFVLGVBQWVBLFVBQVMsQ0FBQztBQUFBLElBQ25GO0FBRUEsVUFBTSxVQUFVLHdCQUF3QixNQUFNLFVBQVU7QUFDeEQsUUFBSSxZQUFZLEtBQU0sUUFBTztBQUk3QixVQUFNLGlCQUFpQiwyQkFBMkIsTUFBTSxhQUFhO0FBQ3JFLFFBQUksbUJBQW1CLFVBQVcsUUFBTztBQUN6QyxRQUFJLG1CQUFtQixXQUFXO0FBQ2hDLFVBQUksT0FBTyxLQUFLLGlGQUFpRjtBQUFBLFFBQy9GLGtCQUFrQixPQUFPLE1BQU07QUFBQSxRQUMvQixrQkFDRSxNQUFNLGtCQUFrQixRQUFRLE9BQU8sTUFBTSxrQkFBa0IsV0FDM0QsT0FBTyxLQUFLLE1BQU0sYUFBd0MsSUFDMUQ7QUFBQSxNQUNSLENBQUM7QUFBQSxJQUNIO0FBS0EsVUFBTSxVQUFVLGdCQUFnQixTQUFTLGVBQWU7QUFDeEQsVUFBTSxTQUFtQixDQUFDO0FBQzFCLGVBQVcsVUFBVSxTQUFTO0FBQzVCLFlBQU0sVUFBVSxlQUFlLEtBQUssT0FBTyxJQUFJO0FBQy9DLFlBQU0sUUFBUSxrQkFBa0IsS0FBSyxPQUFPO0FBQzVDLFVBQUksQ0FBQyxNQUFPO0FBQ1osWUFBTSxTQUFTLE1BQU07QUFBQSxRQUNuQixFQUFFLE1BQU0sU0FBUyxXQUFXLEtBQUssVUFBVSxTQUFTLFNBQVMsR0FBRztBQUFBLFFBQ2hFO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFDQSxVQUFJLE9BQU8sa0JBQW1CLFFBQU8sS0FBSyxPQUFPLGlCQUFpQjtBQUFBLElBQ3BFO0FBRUEsUUFBSSxPQUFPLFdBQVcsRUFBRyxRQUFPO0FBQ2hDLFVBQU0sV0FBVyxPQUFPLEtBQUssRUFBRTtBQUMvQixXQUFPLGtCQUFrQixFQUFFLG1CQUFtQixVQUFVLGVBQWUsU0FBUyxDQUFDO0FBQUEsRUFDbkY7QUFDRjtBQUVBLElBQU8sd0JBQVEsZ0JBQWdCLEVBQUUsU0FBUyxpQ0FBaUMsU0FBUyxJQUFPLEdBQUcsY0FBYyxDQUFDOzs7QUM3UTdHLFFBQVEscUJBQUk7IiwKICAibmFtZXMiOiBbInJlc29sdmUiLCAiZXhlY0ZpbGVTeW5jIiwgInN0YXRTeW5jIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJsb2dnZXIiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgImJhc2VuYW1lIiwgImJhc2VuYW1lIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJ0b1Bvc2l4IiwgImN0eCIsICJyZWNvdmVyUmFuZ2UiLCAiY29tbWFuZCIsICJibG9ja3MiLCAiY29tYmluZWQiXQp9Cg==
