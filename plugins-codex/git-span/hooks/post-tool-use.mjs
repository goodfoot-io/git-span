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
          span: { lineStart: 1, lineEnd: 1, absolutePath, body: "" }
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
          span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath, body: w.body }
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
          touchInput = { kind: "write", sessionId, cwd, filePath: absPath, written: span.body ?? "" };
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb2RleC9hcHBseS1wYXRjaC50cyIsICJzcmMvY29kZXgvcG9zdC10b29sLXVzZS50cyIsICJzcmMvY29kZXgvcG9zdC10b29sLXVzZS1lbnRyeS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZXhwb3J0IGNvbnN0IFBBQ0tBR0VfTkFNRSA9IFwiQGdvb2Rmb290L2NvZGV4LWhvb2tzXCI7XG5leHBvcnQgY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gNjAwXzAwMDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1NUQVRVU19NRVNTQUdFID0gdW5kZWZpbmVkO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfRVNCVUlMRF9MT0FERVJTID0ge1xuICAgIFwiLm1kXCI6IFwidGV4dFwiLFxufTtcbmV4cG9ydCBjb25zdCBIT09LX0ZBQ1RPUllfVE9fRVZFTlQgPSB7XG4gICAgcHJlVG9vbFVzZUhvb2s6IFwiUHJlVG9vbFVzZVwiLFxuICAgIHBvc3RUb29sVXNlSG9vazogXCJQb3N0VG9vbFVzZVwiLFxuICAgIHBlcm1pc3Npb25SZXF1ZXN0SG9vazogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIHVzZXJQcm9tcHRTdWJtaXRIb29rOiBcIlVzZXJQcm9tcHRTdWJtaXRcIixcbiAgICBzZXNzaW9uU3RhcnRIb29rOiBcIlNlc3Npb25TdGFydFwiLFxuICAgIHN1YmFnZW50U3RhcnRIb29rOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICBzdG9wSG9vazogXCJTdG9wXCIsXG4gICAgc3ViYWdlbnRTdG9wSG9vazogXCJTdWJhZ2VudFN0b3BcIixcbiAgICBwcmVDb21wYWN0SG9vazogXCJQcmVDb21wYWN0XCIsXG4gICAgcG9zdENvbXBhY3RIb29rOiBcIlBvc3RDb21wYWN0XCIsXG59O1xuZXhwb3J0IGNvbnN0IEVWRU5UU19XSVRIX01BVENIRVIgPSBuZXcgU2V0KFtcbiAgICBcIlByZVRvb2xVc2VcIixcbiAgICBcIlBvc3RUb29sVXNlXCIsXG4gICAgXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0b3BcIixcbiAgICBcIlByZUNvbXBhY3RcIixcbiAgICBcIlBvc3RDb21wYWN0XCIsXG5dKTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9URVhUX09VVFBVVCA9IG5ldyBTZXQoW1wiU2Vzc2lvblN0YXJ0XCIsIFwiVXNlclByb21wdFN1Ym1pdFwiLCBcIlN1YmFnZW50U3RhcnRcIl0pO1xuIiwgImZ1bmN0aW9uIGF0dGFjaE1ldGFkYXRhKGhvb2tFdmVudE5hbWUsIGNvbmZpZywgaGFuZGxlcikge1xuICAgIGNvbnN0IGhvb2sgPSBoYW5kbGVyO1xuICAgIGhvb2suaG9va0V2ZW50TmFtZSA9IGhvb2tFdmVudE5hbWU7XG4gICAgaG9vay50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXQ7XG4gICAgaG9vay5zdGF0dXNNZXNzYWdlID0gY29uZmlnLnN0YXR1c01lc3NhZ2U7XG4gICAgaWYgKFwibWF0Y2hlclwiIGluIGNvbmZpZyAmJiB0eXBlb2YgY29uZmlnLm1hdGNoZXIgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaG9vay5tYXRjaGVyID0gY29uZmlnLm1hdGNoZXI7XG4gICAgfVxuICAgIHJldHVybiBob29rO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZVRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdFRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUGVybWlzc2lvblJlcXVlc3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJVc2VyUHJvbXB0U3VibWl0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTZXNzaW9uU3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdWJhZ2VudFN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdG9wXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUHJlQ29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQb3N0Q29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuIiwgImltcG9ydCB7IGNsb3NlU3luYywgZXhpc3RzU3luYywgbWtkaXJTeW5jLCBvcGVuU3luYywgd3JpdGVTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5jb25zdCBERUZBVUxUX0xPR19FTlZfVkFSID0gXCJDT0RFWF9IT09LU19MT0dfRklMRVwiO1xuZXhwb3J0IGNsYXNzIExvZ2dlciB7XG4gICAgaGFuZGxlcnMgPSBuZXcgTWFwKCk7XG4gICAgZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgbG9nRmlsZUZkID0gbnVsbDtcbiAgICBsb2dGaWxlUGF0aCA9IG51bGw7XG4gICAgY3VycmVudEhvb2tUeXBlO1xuICAgIGN1cnJlbnRJbnB1dDtcbiAgICBjb25zdHJ1Y3Rvcihjb25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ0ZpbGVQYXRoID0gY29uZmlnLmxvZ0ZpbGVQYXRoID8/IHByb2Nlc3MuZW52W2NvbmZpZy5sb2dFbnZWYXIgPz8gREVGQVVMVF9MT0dfRU5WX1ZBUl0gPz8gbnVsbDtcbiAgICB9XG4gICAgc2V0Q29udGV4dChob29rVHlwZSwgaW5wdXQpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSBob29rVHlwZTtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSBpbnB1dDtcbiAgICB9XG4gICAgY2xlYXJDb250ZXh0KCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIG9uKGxldmVsLCBoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5oYW5kbGVycy5nZXQobGV2ZWwpID8/IG5ldyBTZXQoKTtcbiAgICAgICAgZXhpc3RpbmcuYWRkKGhhbmRsZXIpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLnNldChsZXZlbCwgZXhpc3RpbmcpO1xuICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgZXhpc3RpbmcuZGVsZXRlKGhhbmRsZXIpO1xuICAgICAgICAgICAgaWYgKGV4aXN0aW5nLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmhhbmRsZXJzLmRlbGV0ZShsZXZlbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxuICAgIGRlYnVnKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZGVidWdcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGluZm8obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJpbmZvXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICB3YXJuKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwid2FyblwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgZXJyb3IobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgbG9nRXJyb3IoZXJyb3IsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgYCR7bWVzc2FnZX06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIGNvbnRleHQpO1xuICAgIH1cbiAgICBjbG9zZSgpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbG9zZVN5bmModGhpcy5sb2dGaWxlRmQpO1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVtaXQobGV2ZWwsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSB7XG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIGxldmVsLFxuICAgICAgICAgICAgaG9va1R5cGU6IHRoaXMuY3VycmVudEhvb2tUeXBlLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIC4uLih0aGlzLmN1cnJlbnRJbnB1dCAhPT0gdW5kZWZpbmVkID8geyBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQgfSA6IHt9KSxcbiAgICAgICAgICAgIC4uLihjb250ZXh0ICE9PSB1bmRlZmluZWQgPyB7IGNvbnRleHQgfSA6IHt9KSxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy53cml0ZVRvRmlsZShldmVudCk7XG4gICAgICAgIHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKT8uZm9yRWFjaCgoaGFuZGxlcikgPT4ge1xuICAgICAgICAgICAgaGFuZGxlcihldmVudCk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICB3cml0ZVRvRmlsZShldmVudCkge1xuICAgICAgICBpZiAodGhpcy5sb2dGaWxlUGF0aCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5maWxlSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IGxvZ0RpciA9IGRpcm5hbWUodGhpcy5sb2dGaWxlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMobG9nRGlyKSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyhsb2dEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBvcGVuU3luYyh0aGlzLmxvZ0ZpbGVQYXRoLCBcImFcIik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB3cml0ZVN5bmModGhpcy5sb2dGaWxlRmQsIGAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5gKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmV4cG9ydCBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKCk7XG4iLCAiZXhwb3J0IGNvbnN0IEVYSVRfQ09ERVMgPSB7XG4gICAgU1VDQ0VTUzogMCxcbiAgICBFUlJPUjogMSxcbiAgICBCTE9DSzogMixcbn07XG5leHBvcnQgY2xhc3MgQmxvY2tFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICByZWFzb247XG4gICAgY29uc3RydWN0b3IocmVhc29uKSB7XG4gICAgICAgIHN1cGVyKHJlYXNvbik7XG4gICAgICAgIHRoaXMubmFtZSA9IFwiQmxvY2tFcnJvclwiO1xuICAgICAgICB0aGlzLnJlYXNvbiA9IHJlYXNvbjtcbiAgICB9XG59XG5mdW5jdGlvbiBvbWl0VW5kZWZpbmVkKHZhbHVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh2YWx1ZSkuZmlsdGVyKChbLCBlbnRyeV0pID0+IGVudHJ5ICE9PSB1bmRlZmluZWQpKTtcbn1cbmZ1bmN0aW9uIGJ1aWxkT3V0cHV0KHR5cGUsIHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgX3R5cGU6IHR5cGUsXG4gICAgICAgIHN0ZG91dDogb21pdFVuZGVmaW5lZChzdGRvdXQpLFxuICAgICAgICAuLi4oc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZGVyciB9IDoge30pLFxuICAgIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmF3T3V0cHV0KHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUmF3XCIsIHN0ZG91dCwgc3RkZXJyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnVwZGF0ZWRJbnB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlByZVRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbixcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24sXG4gICAgICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlTGVnYWN5QmxvY2tPdXRwdXQob3B0aW9ucykge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQb3N0VG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICB1cGRhdGVkTUNQVG9vbE91dHB1dDogb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdFRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KG9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWNpc2lvbiA9IG9taXRVbmRlZmluZWQoe1xuICAgICAgICBiZWhhdmlvcjogb3B0aW9ucy5iZWhhdmlvcixcbiAgICAgICAgbWVzc2FnZTogb3B0aW9ucy5tZXNzYWdlLFxuICAgICAgICBpbnRlcnJ1cHQ6IG9wdGlvbnMuaW50ZXJydXB0LFxuICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB1cGRhdGVkUGVybWlzc2lvbnM6IG9wdGlvbnMudXBkYXRlZFBlcm1pc3Npb25zLFxuICAgIH0pO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IHtcbiAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgICAgICBkZWNpc2lvbixcbiAgICB9O1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJVc2VyUHJvbXB0U3VibWl0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTZXNzaW9uU3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlNlc3Npb25TdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0Q29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG4iLCAiaW1wb3J0IHsgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgfSBmcm9tIFwiLi9jb25zdGFudHMuanNcIjtcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gXCIuL2xvZ2dlci5qc1wiO1xuaW1wb3J0IHsgQmxvY2tFcnJvciwgRVhJVF9DT0RFUywgc2Vzc2lvblN0YXJ0T3V0cHV0LCBzdWJhZ2VudFN0YXJ0T3V0cHV0LCB1c2VyUHJvbXB0U3VibWl0T3V0cHV0LCB9IGZyb20gXCIuL291dHB1dHMuanNcIjtcbmFzeW5jIGZ1bmN0aW9uIHJlYWRTdGRpbigpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCBjaHVua3MgPSBbXTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5zZXRFbmNvZGluZyhcInV0Zi04XCIpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IGNodW5rcy5wdXNoKGNodW5rKSk7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJlbmRcIiwgKCkgPT4gcmVzb2x2ZShjaHVua3Muam9pbihcIlwiKSkpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZXJyb3JcIiwgcmVqZWN0KTtcbiAgICB9KTtcbn1cbmZ1bmN0aW9uIHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpIHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShzdGRpbkNvbnRlbnQpO1xufVxuZnVuY3Rpb24gd3JpdGVTdGRvdXQob3V0cHV0KSB7XG4gICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoSlNPTi5zdHJpbmdpZnkob3V0cHV0LnN0ZG91dCkpO1xufVxuZnVuY3Rpb24gbm9ybWFsaXplU3RyaW5nT3V0cHV0KGhvb2tFdmVudE5hbWUsIHJlc3VsdCkge1xuICAgIGlmICghRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQuaGFzKGhvb2tFdmVudE5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtob29rRXZlbnROYW1lfSBob29rcyBjYW5ub3QgcmV0dXJuIHBsYWluIHRleHRgKTtcbiAgICB9XG4gICAgaWYgKGhvb2tFdmVudE5hbWUgPT09IFwiU2Vzc2lvblN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlN1YmFnZW50U3RhcnRcIikge1xuICAgICAgICByZXR1cm4gc3ViYWdlbnRTdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIHJldHVybiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0VG9Ib29rT3V0cHV0KG91dHB1dCkge1xuICAgIHJldHVybiBvdXRwdXQuc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCwgc3RkZXJyOiBvdXRwdXQuc3RkZXJyIH0gOiB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCB9O1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGUoaG9va0ZuKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RkaW5Db250ZW50ID0gYXdhaXQgcmVhZFN0ZGluKCk7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcGFyc2VTdGRpbklucHV0KHN0ZGluQ29udGVudCk7XG4gICAgICAgIGxvZ2dlci5zZXRDb250ZXh0KGhvb2tGbi5ob29rRXZlbnROYW1lLCBpbnB1dCk7XG4gICAgICAgIGNvbnN0IGNvbnRleHQgPSB7IGxvZ2dlciB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBob29rRm4oaW5wdXQsIGNvbnRleHQpO1xuICAgICAgICBsZXQgb3V0cHV0ID0geyBzdGRvdXQ6IHt9IH07XG4gICAgICAgIGlmICh0eXBlb2YgcmVzdWx0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRm4uaG9va0V2ZW50TmFtZSwgcmVzdWx0KSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG91dHB1dCA9IGNvbnZlcnRUb0hvb2tPdXRwdXQocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgICB3cml0ZVN0ZG91dChvdXRwdXQpO1xuICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5TVUNDRVNTKTtcbiAgICB9XG4gICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJsb2NrRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnJlYXNvbn1cXG5gKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkJMT0NLKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3Iuc3RhY2sgPz8gZXJyb3IubWVzc2FnZX1cXG5gKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke1N0cmluZyhlcnJvcil9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuRVJST1IpO1xuICAgIH1cbiAgICBmaW5hbGx5IHtcbiAgICAgICAgbG9nZ2VyLmNsZWFyQ29udGV4dCgpO1xuICAgICAgICBsb2dnZXIuY2xvc2UoKTtcbiAgICB9XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgaGVscGVycyB1c2VkIGJ5IG11bHRpcGxlIGFnZW50LWhvb2tzIGVudHJ5IHBvaW50cy5cbiAqXG4gKiBFeHRyYWN0ZWQgZnJvbSBwcmUtdG9vbC11c2UudHMgc28gdGhhdCB0aGUgdXBjb21pbmcgU3RvcCBob29rIChhbmQgYW55XG4gKiBmdXR1cmUgaG9va3MpIGNhbiBpbXBvcnQgcGF0aCB1dGlsaXRpZXMsIHJhbmdlIGhlbHBlcnMsIGFuZCB0aGVcbiAqIHNhbml0aXplU2Vzc2lvbklkL2Zvcm1hdEFuY2hvciBmdW5jdGlvbnMgd2l0aG91dCBkZXBlbmRpbmcgb24gdGhlXG4gKiBQcmVUb29sVXNlLXNwZWNpZmljIG1vZHVsZS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGF0aCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG5mdW5jdGlvbiBpc0Fic29sdXRlUG9zaXgocDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBwLnN0YXJ0c1dpdGgoJy8nKSB8fCAvXltBLVphLXpdOlxcLy8udGVzdChwKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFic3BhdGhBZ2FpbnN0KGJhc2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0ID0gdG9Qb3NpeCh0YXJnZXQpO1xuICBpZiAoaXNBYnNvbHV0ZVBvc2l4KHQpKSByZXR1cm4gdDtcbiAgY29uc3QgYiA9IHRvUG9zaXgoYmFzZSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiBgJHtifS8ke3R9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZXBvUm9vdChkaXI6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFkaXIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIGRpciwgJ3Jldi1wYXJzZScsICctLXNob3ctdG9wbGV2ZWwnXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IG91dC50cmltKCk7XG4gICAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRvUG9zaXgodHJpbW1lZCkgOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGlzIGV4Y2x1ZGVkIGJ5IGdpdCdzIGlnbm9yZSBydWxlc1xuICogKC5naXRpZ25vcmUsIC5naXQvaW5mby9leGNsdWRlLCBjb3JlLmV4Y2x1ZGVzRmlsZSkuIFVzZWQgdG8ga2VlcCBpZ25vcmVkXG4gKiBmaWxlcyBcdTIwMTQgYnVpbGQgb3V0cHV0LCBjYWNoZXMsIGxvZ3MgXHUyMDE0IG91dCBvZiB0b3VjaCB0cmFja2luZyBlbnRpcmVseSwgc29cbiAqIHRoZSB0b3VjaCBob29rIG5ldmVyIHJlcG9ydHMgcmVhZHMsIHdyaXRlcywgb3IgdW5jb3ZlcmVkIHdyaXRlcyBvbiB0aGVtLlxuICpcbiAqIGBnaXQgY2hlY2staWdub3JlIC1xIDxwYXRoPmAgZXhpdHMgMCB3aGVuIHRoZSBwYXRoIGlzIGlnbm9yZWQsIDEgd2hlbiBpdCBpc1xuICogbm90LCBhbmQgMTI4IG9uIGVycm9yLiBleGVjRmlsZVN5bmMgdGhyb3dzIG9uIGFueSBub24temVybyBleGl0LCBzbyBhIGNsZWFuXG4gKiByZXR1cm4gbWVhbnMgXCJpZ25vcmVkXCIuIEEgc3RhdHVzLTEgdGhyb3cgaXMgdGhlIGV4cGVjdGVkIFwibm90IGlnbm9yZWRcIlxuICogc2lnbmFsOyBhbnkgb3RoZXIgZmFpbHVyZSBpcyBhbiB1bnJlbGlhYmxlIGFuc3dlciwgc28gd2UgcmVwb3J0IGBmYWxzZWBcbiAqIChkbyBub3QgZHJvcCB0aGUgdG91Y2gpIHJhdGhlciB0aGFuIHNpbGVudGx5IGhpZGluZyBhIHRyYWNrZWQgZmlsZS5cbiAqL1xuLyoqXG4gKiBUaGUgZGVmYXVsdCBzcGFuIHJvb3QgZGlyZWN0b3J5LCByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290LCB1c2VkIHdoZW4gbm9cbiAqIGVudmlyb25tZW50IHZhcmlhYmxlIG9yIGdpdCBjb25maWcgb3ZlcnJpZGVzIHRoZSBsb2NhdGlvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IFNQQU5fUk9PVCA9ICcuc3Bhbic7XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgc3BhbiByb290IGRpcmVjdG9yeSBmb3IgYSBnaXZlbiByZXBvLCBtaXJyb3JpbmcgdGhlIFJ1c3QgQ0xJXG4gKiBwcmVjZWRlbmNlIChtaW51cyB0aGUgLS1zcGFuLWRpciBDTEkgZmxhZywgd2hpY2ggaXMgaW52aXNpYmxlIHRvIGZpbGUtd3JpdGVcbiAqIGhvb2tzKTpcbiAqICAgMS4gR0lUX1NQQU5fRElSIGVudmlyb25tZW50IHZhcmlhYmxlXG4gKiAgIDIuIGBnaXQgY29uZmlnIGdpdC1zcGFuLmRpcmAgaW4gdGhlIHJlcG9cbiAqICAgMy4gRGVmYXVsdDogXCIuc3BhblwiXG4gKlxuICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgUE9TSVgtc3R5bGUgcGF0aCB3aXRoIG5vIHRyYWlsaW5nIHNsYXNoLlxuICogRmFpbC1zYWZlOiBhbnkgcmVzb2x1dGlvbiBlcnJvciBmYWxscyBiYWNrIHRvIFwiLnNwYW5cIiBzbyB0aGUgaG9vayBuZXZlclxuICogY3Jhc2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgZW52RGlyID0gcHJvY2Vzcy5lbnZbJ0dJVF9TUEFOX0RJUiddO1xuICBpZiAoZW52RGlyICYmIGVudkRpci50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB0b1Bvc2l4KGVudkRpci50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjb25maWcnLCAnZ2l0LXNwYW4uZGlyJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA+IDApIHJldHVybiB0cmltbWVkO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjsgLy8gY29uZmlnIGtleSBhYnNlbnQgb3IgZ2l0IGVycm9yIFx1MjAxNCBmYWxsIHRocm91Z2ggdG8gZGVmYXVsdFxuICB9XG4gIHJldHVybiBTUEFOX1JPT1Q7XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGggZmFsbHMgaW5zaWRlIHRoZSBnaXZlbiBzcGFuIHJvb3RcbiAqIGRpcmVjdG9yeS4gQSBwYXRoIGlzIGluc2lkZSB3aGVuIGl0IGVxdWFscyB0aGUgc3BhbiByb290IGV4YWN0bHkgb3IgaXNcbiAqIG5lc3RlZCBiZW5lYXRoIGl0IChpLmUuIHN0YXJ0cyB3aXRoIFwiPHNwYW5Sb290Pi9cIikuIFRoZSBcIi9cIiBib3VuZGFyeSBwcmV2ZW50c1xuICogZmFsc2UgcG9zaXRpdmVzIGZvciBzaWJsaW5ncyBsaWtlIFwiLnNwYW5zL3hcIiBvciBcIi5zcGFuLW5vdGVzL3hcIi5cbiAqXG4gKiBQYXNzIHRoZSByZXN1bHQgb2YgYHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdClgIGFzIGBzcGFuUm9vdGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNwYW5Sb290OiBzdHJpbmcgPSBTUEFOX1JPT1QpOiBib29sZWFuIHtcbiAgY29uc3Qgcm9vdCA9IHNwYW5Sb290LnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gcmVwb1JlbFBhdGggPT09IHJvb3QgfHwgcmVwb1JlbFBhdGguc3RhcnRzV2l0aChgJHtyb290fS9gKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzR2l0SWdub3JlZChyZXBvUm9vdDogc3RyaW5nLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjaGVjay1pZ25vcmUnLCAnLXEnLCAnLS0nLCByZXBvUmVsUGF0aF0sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdpZ25vcmUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByb290ID0gdG9Qb3NpeChyZXBvUm9vdCk7XG4gIGNvbnN0IGFicyA9IHRvUG9zaXgoYWJzUGF0aCk7XG4gIGNvbnN0IHByZWZpeCA9IHJvb3QuZW5kc1dpdGgoJy8nKSA/IHJvb3QgOiBgJHtyb290fS9gO1xuICByZXR1cm4gYWJzLnN0YXJ0c1dpdGgocHJlZml4KSA/IGFicy5zbGljZShwcmVmaXgubGVuZ3RoKSA6IGFicztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbm9uaWNhbGl6ZVBhdGgoYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKGFic1BhdGgpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmlsZSBkb2Vzbid0IGV4aXN0IHlldCAoZS5nLiBXcml0ZSB0byBhIG5ldyBmaWxlKTogY2Fub25pY2FsaXplIHRoZVxuICAgIC8vIGRpcmVjdG9yeSBhbmQgcmVqb2luIHRoZSBiYXNlbmFtZSBzbyBzeW1saW5rcyBpbiB0aGUgcGFyZW50IGFyZSByZXNvbHZlZC5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlyID0gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpKTtcbiAgICAgIHJldHVybiBgJHtkaXJ9LyR7bm9kZVBhdGguYmFzZW5hbWUoYWJzUGF0aCl9YDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBhcmVudCBkb2Vzbid0IGV4aXN0IGVpdGhlcjsgZmFsbCBiYWNrIHRvIHRoZSB1bi1jYW5vbmljYWxpemVkIHBhdGguXG4gICAgICByZXR1cm4gYWJzUGF0aDtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZVBhdGgodG9vbElucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgY3dkOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgZnAgPSB0b29sSW5wdXQuZmlsZV9wYXRoO1xuICBpZiAodHlwZW9mIGZwICE9PSAnc3RyaW5nJyB8fCBmcC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBhYnMgPSBhYnNwYXRoQWdhaW5zdChjd2QsIGZwKTtcbiAgcmV0dXJuIGNhbm9uaWNhbGl6ZVBhdGgoYWJzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lIHJhbmdlIHR5cGVzIGFuZCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBMaW5lUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmdlc0ludGVyc2VjdChhOiBMaW5lUmFuZ2UsIGI6IExpbmVSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5zdGFydCA8PSBiLmVuZCAmJiBhLmVuZCA+PSBiLnN0YXJ0O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvcmNlbGFpbiByb3cgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9yY2VsYWluUm93IHtcbiAgbmFtZTogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMykgY29udGludWU7XG4gICAgY29uc3QgW25hbWUsIHBhdGgsIHJhbmdlXSA9IHBhcnRzO1xuICAgIGNvbnN0IGRhc2hJZHggPSByYW5nZS5pbmRleE9mKCctJyk7XG4gICAgaWYgKGRhc2hJZHggPT09IC0xKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKDAsIGRhc2hJZHgpLCAxMCk7XG4gICAgY29uc3QgZW5kID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoZGFzaElkeCArIDEpLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwgYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgc3RhdHVzIHRva2VuIHZvY2FidWxhcnkgKHRoZVxuICogZ2l0LXNwYW4gQ0xJJ3MgcG9yY2VsYWluIGNvbnRyYWN0KTogYEZSRVNIYC9gTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGBcbiAqIGFyZSBwb3NpdGlvbmFsLW9yLWNsZWFuIGFuZCBuZXZlciBkZWJ0OyBldmVyeSBvdGhlciB0b2tlbiBpcyBzZW1hbnRpYyBkcmlmdFxuICogb3IgYSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb24gYW5kIGlzIGRlYnQuIFNlZSB7QGxpbmsgaXNEZWJ0fSBmb3IgdGhlXG4gKiBzaW5nbGUgc291cmNlIG9mIHRydXRoIG9uIHRoYXQgc3BsaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBQT1JDRUxBSU5fU1RBVFVTRVMgPSBbXG4gICdGUkVTSCcsXG4gICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCcsXG4gICdNT1ZFRCcsXG4gICdDSEFOR0VEJyxcbiAgJ0RFTEVURUQnLFxuICAnQ09ORkxJQ1QnLFxuICAnU1VCTU9EVUxFJyxcbiAgJ0xGU19OT1RfRkVUQ0hFRCcsXG4gICdMRlNfTk9UX0lOU1RBTExFRCcsXG4gICdQUk9NSVNPUl9NSVNTSU5HJyxcbiAgJ1NQQVJTRV9FWENMVURFRCcsXG4gICdGSUxURVJfRkFJTEVEJyxcbiAgJ0lPX0VSUk9SJ1xuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgUG9yY2VsYWluU3RhdHVzID0gKHR5cGVvZiBQT1JDRUxBSU5fU1RBVFVTRVMpW251bWJlcl07XG5cbmNvbnN0IFBPUkNFTEFJTl9TVEFUVVNfU0VUOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChQT1JDRUxBSU5fU1RBVFVTRVMpO1xuXG5mdW5jdGlvbiBwYXJzZVBvcmNlbGFpblN0YXR1cyhyYXc6IHN0cmluZyk6IFBvcmNlbGFpblN0YXR1cyB8IG51bGwge1xuICByZXR1cm4gUE9SQ0VMQUlOX1NUQVRVU19TRVQuaGFzKHJhdykgPyAocmF3IGFzIFBvcmNlbGFpblN0YXR1cykgOiBudWxsO1xufVxuXG4vKiogQSBgcGFyc2VTdGFsZVBvcmNlbGFpbmAgcm93OiBhIHtAbGluayBQb3JjZWxhaW5Sb3d9IHBsdXMgaXRzIHN0YXR1cyB0b2tlbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhbGVQb3JjZWxhaW5Sb3cgZXh0ZW5kcyBQb3JjZWxhaW5Sb3cge1xuICBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cztcbn1cblxuLyoqXG4gKiBUaGUgZGVidCBpbnZhcmlhbnQgKHN5c3RlbS13aWRlOyBjb25zdW1lZCBieSBib3RoIHRoZSBmdXR1cmUgdG91Y2gtY29yZSBhbmRcbiAqIGFkdmlzb3ItY29yZSk6IG9ubHkgc2VtYW50aWMgc3RhdHVzZXMgYXJlIGRlYnQuIGBDSEFOR0VEYCBhbmQgYERFTEVURURgIGFyZVxuICogc2VtYW50aWMgZHJpZnQ7IHRoZSByZW1haW5pbmcgbm9uLUZSRVNIL01PVkVEL1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUIHRva2Vuc1xuICogYXJlIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbnMgYW5kIGFyZSB0cmVhdGVkIGFzIGRlYnQgdG9vICh0aGV5IGJsb2NrIG9uXG4gKiB0aGVpciBvd24gbWVyaXRzIFx1MjAxNCB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXQgYWxsKS4gYEZSRVNIYCxcbiAqIGBNT1ZFRGAsIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0OiBwb3NpdGlvbmFsIGRyaWZ0IHRoZVxuICogQ0xJIGNhbiBoZWFsIChvciBhbHJlYWR5IGhhcykgaXMgaW52aXNpYmxlLCBhbmQgYSBwZW5kaW5nLWNvbW1pdCByZXNvbHV0aW9uXG4gKiBpcyBub3Qgb3V0c3RhbmRpbmcgZGVidC5cbiAqXG4gKiBOb3RlOiB0aGUgcG9yY2VsYWluIHZvY2FidWxhcnkgZG9lcyBub3QgY3VycmVudGx5IGRpc3Rpbmd1aXNoXG4gKiBjb250ZW50LWVxdWl2YWxlbnQgYENIQU5HRURgIChlLmcuIHdoaXRlc3BhY2Utb25seSBkcmlmdCBgLS1maXhgIGNhbiBoZWFsKVxuICogZnJvbSBnZW51aW5lbHkgc2VtYW50aWMgYENIQU5HRURgIFx1MjAxNCB0aGF0IGNsYXNzaWZpY2F0aW9uIGlzIG5vdCBwcmVzZW50IGluXG4gKiBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBvdXRwdXQgdG9kYXkuIFVudGlsIHRoZSBDTEkgZXhwb3NlcyBpdCxcbiAqIGV2ZXJ5IGBDSEFOR0VEYCByb3cgaXMgdHJlYXRlZCBhcyBkZWJ0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNEZWJ0KHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnRlJFU0gnOlxuICAgIGNhc2UgJ01PVkVEJzpcbiAgICBjYXNlICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCc6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogTG93ZXJjYXNlIGh1bWFuIGxhYmVsIGZvciBhIHBvcmNlbGFpbiBzdGF0dXMgdG9rZW4gKGBMRlNfTk9UX0ZFVENIRURgIFx1MjE5MlxuICogYGxmcyBub3QgZmV0Y2hlZGApLiBUaGUgc2luZ2xlIGxhYmVsIG1hcHBpbmcgZm9yIGV2ZXJ5IGh1bWFuLWZvcm1hdCBhbmNob3JcbiAqIHN1ZmZpeCBcdTIwMTQgYm90aCB0aGUgdG91Y2ggaG9vaydzIGJsb2NrIGFuZCB0aGUgYWR2aXNvcidzIG1lc3NhZ2VzIHJlbmRlciB0aHJvdWdoXG4gKiB0aGlzLCBzbyBhIHN0YXR1cyBuZXZlciByZWFkcyBkaWZmZXJlbnRseSBiZXR3ZWVuIHRoZSB0d28uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBodW1hblN0YXR1c0xhYmVsKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN0YXR1cy50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJyAnKTtcbn1cblxuLyoqXG4gKiBUaGUgdGVybWluYWwvZW52aXJvbm1lbnRhbCBzdGF0dXNlczogdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0XG4gKiBhbGwsIHNvIHRoZSByb3cgaXMgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uIFRoZXNlIGFyZVxuICogYENPTkZMSUNUYCAodW5yZXNvbHZlZCBtZXJnZSksIGBTVUJNT0RVTEVgIChhbmNob3IgaW5zaWRlIGEgc3VibW9kdWxlKSxcbiAqIGBMRlNfTk9UX0ZFVENIRURgL2BMRlNfTk9UX0lOU1RBTExFRGAgKEdpdCBMRlMgY29udGVudCB1bmF2YWlsYWJsZSksXG4gKiBgUFJPTUlTT1JfTUlTU0lOR2AgKHBhcnRpYWwtY2xvbmUgb2JqZWN0IG5vdCBmZXRjaGVkKSwgYFNQQVJTRV9FWENMVURFRGBcbiAqIChwYXRoIG91dHNpZGUgdGhlIHNwYXJzZS1jaGVja291dCBjb25lKSwgYEZJTFRFUl9GQUlMRURgIChhIGNsZWFuL3NtdWRnZVxuICogZmlsdGVyIGVycm9yZWQpLCBhbmQgYElPX0VSUk9SYCAodHJhbnNpZW50IHJlYWQgZmFpbHVyZSkuXG4gKlxuICogVGhlc2UgYXJlIGEgc3RyaWN0IHN1YnNldCBvZiB7QGxpbmsgaXNEZWJ0fTogZXZlcnkgZW52aXJvbm1lbnRhbCBzdGF0dXMgaXNcbiAqIGFsc28gZGVidCAoaXQgYmxvY2tzIG9uIGl0cyBvd24gbWVyaXRzIHdoZW4gc3VyZmFjZWQgaW4gYSBzdGF0dXMgcmVwb3J0KSwgYnV0XG4gKiB0aGUgYWR2aXNvciBtdXN0IHRyZWF0IHRoZW0gZGlmZmVyZW50bHkgZnJvbSAqc2VtYW50aWMqIGRyaWZ0IChgQ0hBTkdFRGAsXG4gKiBgREVMRVRFRGApLiBTZW1hbnRpYyBkcmlmdCBpcyBmaXhhYmxlIGJ5IGVkaXRpbmcgYSBzcGFuLCBzbyB0aGUgYWR2aXNvciBmYWlsc1xuICogY2xvc2VkIG9uIGl0OyBhbiBlbnZpcm9ubWVudGFsIGNvbmRpdGlvbiBpcyBub3Qgc29tZXRoaW5nIGEgc3BhbiBlZGl0IGNhblxuICogcmVzb2x2ZSwgc28gdGhlIGFkdmlzb3IgZmFpbHMgT1BFTiBvbiBpdCAoYWxsb3csIGJ1dCBzdXJmYWNlIHRoZSBjb25kaXRpb24pIFx1MjAxNFxuICogcmUtZGVueWluZyBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gaGVyZSB3b3VsZFxuICogY29udHJhZGljdCB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZSByZXN0IG9mIHRoZSBhZHZpc29yIGFscmVhZHkgaG9ub3JzIGZvclxuICogQ0xJLWFic2VudC90aW1lb3V0L3BhcnNlLWZhaWx1cmUgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRW52aXJvbm1lbnRhbFN0YXR1cyhzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0NPTkZMSUNUJzpcbiAgICBjYXNlICdTVUJNT0RVTEUnOlxuICAgIGNhc2UgJ0xGU19OT1RfRkVUQ0hFRCc6XG4gICAgY2FzZSAnTEZTX05PVF9JTlNUQUxMRUQnOlxuICAgIGNhc2UgJ1BST01JU09SX01JU1NJTkcnOlxuICAgIGNhc2UgJ1NQQVJTRV9FWENMVURFRCc6XG4gICAgY2FzZSAnRklMVEVSX0ZBSUxFRCc6XG4gICAgY2FzZSAnSU9fRVJST1InOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqIFJvd3Mgd2hvc2Ugc3RhdHVzIHRva2VuIGlzIG5vdCBpbiB7QGxpbmsgUE9SQ0VMQUlOX1NUQVRVU0VTfSBhcmUgc2tpcHBlZCBcdTIwMTRcbiAqIGFuIHVucmVjb2duaXplZCB0b2tlbiBmcm9tIGEgbmV3ZXIgQ0xJIGlzIHRyZWF0ZWQgdGhlIHNhbWUgYXMgYSBtYWxmb3JtZWRcbiAqIGxpbmUgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3RhbGVQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBTdGFsZVBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtzdGF0dXNDb2wsICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGF0dXMgPSBwYXJzZVBvcmNlbGFpblN0YXR1cyhzdGF0dXNDb2wpO1xuICAgIGlmICghc3RhdHVzKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCwgc3RhdHVzIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIGJ5IGFsbCBwZXItc2Vzc2lvbiBzdGF0ZTogY3VycmVudGx5IGp1c3QgdGhlIHRvdWNoLWhvb2tcbi8vIHNlc3Npb24gbWVtbyAoc3Bhbi1zdXJmYWNlLnRzJ3MgTWVtb1N0b3JlKS4gRWFjaCBzZXNzaW9uIGdldHMgb25lXG4vLyBzdWJkaXJlY3Rvcnkga2V5ZWQgYnkgaXRzIHNhbml0aXplZCBpZCwgc28gZXZlcnkgd3JpdGVyL3JlYWRlciBmb3IgYSBnaXZlblxuLy8gc2Vzc2lvbiBhZ3JlZXMgb24gaXRzIGxvY2F0aW9uLlxuZXhwb3J0IGNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8qKiBUaGUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHNlc3Npb24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkRpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5jb25zdCBUSElSVFlfREFZU19NUyA9IDMwICogMjQgKiA2MCAqIDYwICogMTAwMDtcblxuLyoqXG4gKiBPcHBvcnR1bmlzdGljYWxseSBwcnVuZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcmllcyB1bmRlclxuICoge0BsaW5rIFNFU1NJT05fQkFTRV9ESVJ9IHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gYG1heEFnZU1zYCAoZGVmYXVsdCAzMFxuICogZGF5cykuIEEgZGlyZWN0b3J5J3MgbXRpbWUgYWR2YW5jZXMgd2hlbmV2ZXIgYW4gZW50cnkgaW5zaWRlIGl0IGlzXG4gKiBjcmVhdGVkL3JlbmFtZWQvcmVtb3ZlZCwgc28gYW4gYWN0aXZlIHNlc3Npb24gKG1lbW8gd3JpdGVzKSBzdGF5cyBmcmVzaDtcbiAqIG9ubHkgZ2VudWluZWx5IGFiYW5kb25lZCBzZXNzaW9ucyBhZ2Ugb3V0LlxuICpcbiAqIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGNhbGxlZCBvcHBvcnR1bmlzdGljYWxseSBmcm9tIGhvb2sgcmVhZC93cml0ZVxuICogcGF0aHMsIG5vdCBhIHNlcGFyYXRlIGNyb24tbGlrZSBtZWNoYW5pc20sIHNvIGEgZmFpbHVyZSBoZXJlIG11c3QgbmV2ZXJcbiAqIGJsb2NrIHRoZSBjYWxsZXIncyBhY3R1YWwgd29yay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBydW5lU3RhbGVTZXNzaW9ucyhub3c6IG51bWJlciA9IERhdGUubm93KCksIG1heEFnZU1zOiBudW1iZXIgPSBUSElSVFlfREFZU19NUyk6IHZvaWQge1xuICBsZXQgZW50cmllczogZnMuRGlyZW50W107XG4gIHRyeSB7XG4gICAgZW50cmllcyA9IGZzLnJlYWRkaXJTeW5jKFNFU1NJT05fQkFTRV9ESVIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuOyAvLyBiYXNlIGRpciBhYnNlbnQgb3IgdW5yZWFkYWJsZSBcdTIwMTQgbm90aGluZyB0byBwcnVuZVxuICB9XG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZGlyUGF0aCA9IG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgZW50cnkubmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhkaXJQYXRoKTtcbiAgICAgIGlmIChub3cgLSBzdGF0Lm10aW1lTXMgPiBtYXhBZ2VNcykge1xuICAgICAgICBmcy5ybVN5bmMoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVmFuaXNoZWQgYmV0d2VlbiByZWFkZGlyIGFuZCBzdGF0LCBvciByZW1vdmFsIGZhaWxlZCBcdTIwMTQgc2tpcCBpdC4gQVxuICAgICAgLy8gYmVzdC1lZmZvcnQgcHJ1bmUgbXVzdCBuZXZlciB0aHJvdyBpbnRvIHRoZSBjYWxsZXIncyBob3QgcGF0aC5cbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgdGhlIGFkdmlzb3IncyBwZXItY2hhbmdlc2V0IHN0YXRlIG1lbW9zIChkaWdlc3Qgb2Ygc29ydGVkXG4gKiBmaW5kaW5ncyArIHVuY292ZXJlZCBwYXRocyksIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpciBzbyBpdCBpcyBzaGFyZWRcbiAqIGFjcm9zcyB3b3JrdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZpc29yTWVtb0RpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ2Fkdmlzb3InKTtcbn1cbiIsICIvKipcbiAqIFN0YXRpYyBjbGFzc2lmaWNhdGlvbiBvZiBhIEJhc2ggdG9vbCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGVcbiAqIHBhdGgocykgKyBsaW5lIHJhbmdlKHMpIGl0IHJlYWRzIG9yIHdyaXRlcywgd2hlcmUgdGhhdCdzIHN0YXRpY2FsbHlcbiAqIGRldGVybWluYWJsZS4gQnVpbHQgZnJvbSBhbiBlbXBpcmljYWwgcGFzcyBvdmVyIH4zMWsgcmVhbCBDbGF1ZGUgQ29kZVxuICogQmFzaCBpbnZvY2F0aW9ucyAoc2VlIGFuYWx5emUtdHJhbnNjcmlwdHMubXRzKSBcdTIwMTQgdGhlIGlkaW9tcyBiZWxvdyBhcmVcbiAqIGV4YWN0bHkgdGhlIG9uZXMgdGhhdCB0dXJuZWQgb3V0IHRvIGJlIGNvbW1vbiBBTkQgcmVsaWFibGUgdGhlcmUuXG4gKlxuICogRGVsaWJlcmF0ZWx5IE5PVCBjb3ZlcmVkIChzZWUgdGhlIHJlc2VhcmNoIHJlcG9ydCk6IGF3ayBOUi10cmlja3MgKHJhcmUsXG4gKiB1bmNvbnN0cmFpbmVkIHN5bnRheCksIGdyZXAgLW4vLUEvLUIvLUMgKHRoZSB3aW5kb3cgaXMgYW5jaG9yZWQgdG8gbWF0Y2hcbiAqIHBvc2l0aW9uLCB3aGljaCBpcyBkYXRhLWRlcGVuZGVudCwgbm90IGluIHRoZSBjb21tYW5kIHRleHQpLCBlbWJlZGRlZFxuICogcHl0aG9uMy9ub2RlIGhlcmVkb2Mgc2NyaXB0cyAoYSBkaWZmZXJlbnQgbGFuZ3VhZ2UncyBBU1QsIG5vdCBhIHNoZWxsXG4gKiBjb25jZXJuKSwgc2VkIC1pIChubyBsaW5lLWFkZHJlc3NlZCB1c2FnZSBvYnNlcnZlZCBcdTIwMTQgYWxsIHBhdHRlcm4tb25seVxuICogc3Vic3RpdHV0aW9ucyB3aXRoIG5vIHN0YXRpYyByYW5nZSksIHBsYWluIGBlY2hvYC9gcHJpbnRmYCByZWRpcmVjdHMgKHJhcmVcbiAqIGFuZCBzZW1hbnRpY2FsbHkgYW1iaWd1b3VzIGluIHRoZSBjb3JwdXMpLlxuICovXG5pbXBvcnQgeyByZXNvbHZlIGFzIHJlc29sdmVQYXRoIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvdW50RmlsZUxpbmVzLCBjb3VudEdpdEJsb2JMaW5lcyB9IGZyb20gJy4vY29tbWFuZC1yZXNvbHZlLmpzJztcbmltcG9ydCB7IGFyZ3ZPZiwgc3BsaXRUb3BMZXZlbCB9IGZyb20gJy4vc2hlbGwtc3BsaXQuanMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVkU3BhbiB7XG4gIGxpbmVTdGFydDogbnVtYmVyO1xuICBsaW5lRW5kOiBudW1iZXI7XG4gIGFic29sdXRlUGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogVGhlIGV4YWN0IGJvZHkgb2YgYSBgaGVyZWRvYy13cml0ZWAgc3BhbiBcdTIwMTQgdGhlIGNvbnRlbnQgdGhlIGhlcmVkb2Mgd3JpdGVzLlxuICAgKiBBYnNlbnQgKHVuZGVmaW5lZCkgZm9yIHJlYWQgaWRpb21zLiBBZGFwdGVycyBmZWVkIGl0IHRvIHRoZSB0b3VjaCBjb3JlIGFzXG4gICAqIGB3cml0dGVuYCBzbyBhIHBvc3QtZWRpdCByYW5nZSByZWNvdmVyeSBjYW4gbmFycm93IGA+YCBvdmVyd3JpdGVzIHRvIHRoZVxuICAgKiB3cml0dGVuIGxpbmVzIGFuZCBsb2NhdGUgdGhlIGFwcGVuZGVkIGJsb2NrIG9mIGEgYD4+YCBhcHBlbmQ7IGFuIGVtcHR5XG4gICAqIGJvZHkgbWVhbnMgXCJ0cnVuY2F0ZSB0byBlbXB0eVwiIGFuZCBzY29wZXMgdGhlIHRvdWNoIHdob2xlLWZpbGUuXG4gICAqL1xuICBib2R5Pzogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBJZGlvbSA9XG4gIHwgJ3NlZC1uLXJhbmdlJ1xuICB8ICdoZWFkLWZpbGUnXG4gIHwgJ3RhaWwtZmlsZSdcbiAgfCAnY2F0LWZpbGUnXG4gIHwgJ25sLWZpbGUnXG4gIHwgJ2dpdC1zaG93LXJldi1wYXRoJ1xuICB8ICdnaXQtbG9nLUwnXG4gIHwgJ2hlcmVkb2Mtd3JpdGUnO1xuXG5leHBvcnQgdHlwZSBTcGFuTWF0Y2ggPVxuICB8IHsgc3RhdHVzOiAncmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IHNwYW46IFJlc29sdmVkU3Bhbjsgbm90ZT86IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bnJlc29sdmVkJzsgaWRpb206IElkaW9tOyBmaWxlQXJnOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZS1yYW5nZSBzcGVjczogd2hhdCBhIG1hdGNoZWQgaWRpb20gc2F5cyBhYm91dCB0aGUgcmFuZ2UsIGJlZm9yZSB3ZSBrbm93XG4vLyB3aGV0aGVyIHJlc29sdmluZyBpdCBuZWVkcyB0byBjb25zdWx0IGEgcmVhbCBmaWxlL2dpdCBibG9iLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgTGluZVJhbmdlU3BlYyA9XG4gIHwgeyBraW5kOiAnbGl0ZXJhbCc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JzsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3RvRW9mJzsgc3RhcnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnbGFzdE5MaW5lcyc7IGNvdW50OiBudW1iZXIgfVxuICB8IHsga2luZDogJ2FwcGVuZExpbmVzJzsgY291bnQ6IG51bWJlciB9O1xuXG5mdW5jdGlvbiByZXNvbHZlU3BlYyhcbiAgc3BlYzogTGluZVJhbmdlU3BlYyxcbiAgdG90YWxMaW5lczogKCkgPT4gbnVtYmVyIHwgbnVsbFxuKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgc3dpdGNoIChzcGVjLmtpbmQpIHtcbiAgICBjYXNlICdsaXRlcmFsJzpcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogc3BlYy5zdGFydCwgbGluZUVuZDogc3BlYy5lbmQgfTtcbiAgICBjYXNlICd1cHBlckJvdW5kRnJvbVN0YXJ0Jzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IHRvdGFsICE9PSBudWxsID8gTWF0aC5taW4oc3BlYy5lbmQsIHRvdGFsKSA6IHNwZWMuZW5kIH07XG4gICAgfVxuICAgIGNhc2UgJ3RvRW9mJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBNYXRoLm1heChzcGVjLnN0YXJ0LCB0b3RhbCkgfTtcbiAgICB9XG4gICAgY2FzZSAnbGFzdE5MaW5lcyc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsIHx8IHRvdGFsID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogTWF0aC5tYXgoMSwgdG90YWwgLSBzcGVjLmNvdW50ICsgMSksIGxpbmVFbmQ6IHRvdGFsIH07XG4gICAgfVxuICAgIGNhc2UgJ2FwcGVuZExpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCkgPz8gMDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogdG90YWwgKyAxLCBsaW5lRW5kOiB0b3RhbCArIHNwZWMuY291bnQgfTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gaGFzU2hlbGxFeHBhbnNpb24oczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvWyRgXS8udGVzdChzKTtcbn1cblxuZnVuY3Rpb24gbG9va3NVbnJlc29sdmFibGUoczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBoYXNTaGVsbEV4cGFuc2lvbihzKSB8fCAvWyo/XS8udGVzdChzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJZGlvbSBtYXRjaGVyczogcHVyZSBmdW5jdGlvbnMgb3ZlciBvbmUgc2ltcGxlIGNvbW1hbmQncyBhcmd2LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBSYXdDYW5kaWRhdGUge1xuICBraW5kOiAnY2FuZGlkYXRlJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHNwZWM6IExpbmVSYW5nZVNwZWM7XG4gIHJlc29sdmVyS2luZDogJ2ZzJyB8IHsga2luZDogJ2dpdCc7IHJldjogc3RyaW5nIH07XG4gIGRpck92ZXJyaWRlPzogc3RyaW5nO1xufVxuaW50ZXJmYWNlIFJhd1VucmVzb2x2ZWQge1xuICBraW5kOiAndW5yZXNvbHZlZCc7XG4gIGlkaW9tOiBJZGlvbTtcbiAgZmlsZUFyZzogc3RyaW5nO1xuICByZWFzb246IHN0cmluZztcbn1cbnR5cGUgTWF0Y2hSZXN1bHQgPSBSYXdDYW5kaWRhdGUgfCBSYXdVbnJlc29sdmVkO1xuXG5jb25zdCBTRURfUkFOR0UgPSAvXihcXGQrKSg/OiwoXFxkK3xcXCQpKT9wJC87XG5cbi8qKiBTcGxpdCBhIGBzZWRgIHNjcmlwdCBhcmd1bWVudCBpbnRvIGl0cyBgO2Atc2VwYXJhdGVkIHNlZ21lbnRzLiAqL1xuZnVuY3Rpb24gc2VkU2NyaXB0U2VnbWVudHMoc2NyaXB0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBzY3JpcHQuc3BsaXQoJzsnKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hTZWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdzZWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAoIXJlc3QuaW5jbHVkZXMoJy1uJykpIHJldHVybiBbXTtcbiAgbGV0IHNjcmlwdElkeCA9IC0xO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAocmVzdFtpXSA9PT0gJy1uJykgY29udGludWU7XG4gICAgaWYgKHNlZFNjcmlwdFNlZ21lbnRzKHJlc3RbaV0pLnNvbWUoKHNlZykgPT4gU0VEX1JBTkdFLnRlc3Qoc2VnKSkpIHtcbiAgICAgIHNjcmlwdElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKHNjcmlwdElkeCA9PT0gLTEpIHJldHVybiBbXTtcbiAgY29uc3QgZmlsZUNhbmRpZGF0ZXMgPSByZXN0LmZpbHRlcigoYSwgaSkgPT4gaSAhPT0gc2NyaXB0SWR4ICYmIGEgIT09ICctbicgJiYgIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgaWYgKGZpbGVDYW5kaWRhdGVzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQXJnID0gZmlsZUNhbmRpZGF0ZXNbMF07XG4gIGNvbnN0IHJlc3VsdHM6IE1hdGNoUmVzdWx0W10gPSBbXTtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZFNjcmlwdFNlZ21lbnRzKHJlc3Rbc2NyaXB0SWR4XSkpIHtcbiAgICBjb25zdCBtYXRjaCA9IHNlZ21lbnQubWF0Y2goU0VEX1JBTkdFKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtYXRjaFsxXSwgMTApO1xuICAgIGNvbnN0IGVuZFRva2VuID0gbWF0Y2hbMl07XG4gICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9XG4gICAgICBlbmRUb2tlbiA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IHN0YXJ0IH1cbiAgICAgICAgOiBlbmRUb2tlbiA9PT0gJyQnXG4gICAgICAgICAgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0IH1cbiAgICAgICAgICA6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydCwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZW5kVG9rZW4sIDEwKSB9O1xuICAgIHJlc3VsdHMucHVzaCh7IGtpbmQ6ICdjYW5kaWRhdGUnLCBpZGlvbTogJ3NlZC1uLXJhbmdlJywgZmlsZUFyZywgc3BlYywgcmVzb2x2ZXJLaW5kOiAnZnMnIH0pO1xuICB9XG4gIHJldHVybiByZXN1bHRzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUhlYWRUYWlsRmxhZ3MocmVzdDogc3RyaW5nW10pOiB7XG4gIGNvdW50OiBudW1iZXIgfCBudWxsO1xuICBmcm9tU3RhcnQ6IGJvb2xlYW47XG4gIGRpc3F1YWxpZmllZDogYm9vbGVhbjtcbiAgZmlsZXM6IHN0cmluZ1tdO1xufSB7XG4gIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY291bnQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBsZXQgZnJvbVN0YXJ0ID0gZmFsc2U7XG4gIGxldCBkaXNxdWFsaWZpZWQgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctZicgfHwgYSA9PT0gJy1GJyB8fCBhID09PSAnLS1mb2xsb3cnIHx8IGEuc3RhcnRzV2l0aCgnLS1mb2xsb3c9JykpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICcteicgfHwgYSA9PT0gJy0temVyby10ZXJtaW5hdGVkJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJyB8fCBhID09PSAnLS1ieXRlcycpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eKC1jfC0tYnl0ZXM9KS8udGVzdChhKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1xJyB8fCBhID09PSAnLXYnIHx8IGEgPT09ICctLXF1aWV0JyB8fCBhID09PSAnLS1zaWxlbnQnIHx8IGEgPT09ICctLXZlcmJvc2UnKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLWxpbmVzPScpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgnLS1saW5lcz0nLmxlbmd0aCk7XG4gICAgICBpZiAoL15cXCs/XFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1uXFwrP1xcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgyKTtcbiAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eXFwrXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGZyb21TdGFydCA9IHRydWU7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLVxcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctJykge1xuICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgIGZpbGVzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaEhlYWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdoZWFkJykgcmV0dXJuIFtdO1xuICBjb25zdCB7IGNvdW50LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAnaGVhZC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWM6IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnLCBlbmQ6IG4gfSBhcyBMaW5lUmFuZ2VTcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoVGFpbChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3RhaWwnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoZGlzcXVhbGlmaWVkKSByZXR1cm4gW107XG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID0gZnJvbVN0YXJ0ID8geyBraW5kOiAndG9Fb2YnLCBzdGFydDogbiB9IDogeyBraW5kOiAnbGFzdE5MaW5lcycsIGNvdW50OiBuIH07XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAndGFpbC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gZmluZEdpdFN1YmNvbW1hbmQoXG4gIHJlc3Q6IHN0cmluZ1tdXG4pOiB7IHN1YklkeDogbnVtYmVyOyBzdWJjb21tYW5kOiBzdHJpbmc7IGNEaXI6IHN0cmluZyB8IG51bGw7IGNEaXJVbnJlc29sdmFibGU6IGJvb2xlYW4gfSB8IG51bGwge1xuICBsZXQgY0Rpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBjRGlyVW5yZXNvbHZhYmxlID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCByZXN0Lmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSByZXN0W2ldO1xuICAgIGlmIChhID09PSAnLUMnKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGlmIChoYXNTaGVsbEV4cGFuc2lvbih2KSkgY0RpclVucmVzb2x2YWJsZSA9IHRydWU7XG4gICAgICBlbHNlIGNEaXIgPSB2O1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSB7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcmV0dXJuIHsgc3ViSWR4OiBpLCBzdWJjb21tYW5kOiBhLCBjRGlyLCBjRGlyVW5yZXNvbHZhYmxlIH07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmNvbnN0IFJFVl9QQVRIID0gL14oW15cXHM6XSspOiguKykkLztcblxuZnVuY3Rpb24gbWF0Y2hHaXRTaG93KGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdzaG93JykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3ZcbiAgICAuc2xpY2UoMSlcbiAgICAuc2xpY2Uoc3ViLnN1YklkeCArIDEpXG4gICAgLmZpbHRlcigoYSkgPT4gIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgY29uc3QgcmV2UGF0aEFyZyA9IGFmdGVyLmZpbmQoKGEpID0+IFJFVl9QQVRILnRlc3QoYSkpO1xuICBpZiAoIXJldlBhdGhBcmcpIHJldHVybiBbXTtcbiAgY29uc3QgbSA9IHJldlBhdGhBcmcubWF0Y2goUkVWX1BBVEgpO1xuICBpZiAoIW0pIHJldHVybiBbXTtcbiAgY29uc3QgWywgcmV2LCBwYXRoXSA9IG07XG4gIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSB8fCBoYXNTaGVsbEV4cGFuc2lvbihyZXYpKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBvciByZXZpc2lvbiBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtcbiAgICB7XG4gICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgIHNwZWM6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSxcbiAgICAgIHJlc29sdmVyS2luZDogeyBraW5kOiAnZ2l0JywgcmV2IH0sXG4gICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgfVxuICBdO1xufVxuXG5mdW5jdGlvbiBtYXRjaEdpdExvZ0woYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2xvZycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhZnRlci5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhZnRlcltpXTtcbiAgICBsZXQgc3BlYzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGEgPT09ICctTCcpIHNwZWMgPSBhZnRlcltpICsgMV0gPz8gbnVsbDtcbiAgICBlbHNlIGlmIChhLnN0YXJ0c1dpdGgoJy1MJykpIHNwZWMgPSBhLnNsaWNlKDIpO1xuICAgIGlmICghc3BlYykgY29udGludWU7XG4gICAgY29uc3QgbSA9IHNwZWMubWF0Y2goL14oXFxkKyksKFxcZCspOiguKykkLyk7XG4gICAgaWYgKCFtKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBzLCBlLCBwYXRoXSA9IG07XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICB7XG4gICAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgICAgfVxuICAgICAgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgc3BlYzogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0OiBOdW1iZXIucGFyc2VJbnQocywgMTApLCBlbmQ6IE51bWJlci5wYXJzZUludChlLCAxMCkgfSxcbiAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnLFxuICAgICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW107XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVyZWRvYyB3cml0ZXMgKGBjYXQgPiBmaWxlIDw8RU9GIC4uLiBFT0ZgKTogaGFuZGxlZCBhcyBhIGRlZGljYXRlZCByYXctdGV4dFxuLy8gcGFzcyBiZWNhdXNlIHRoZSBib2R5IGNhbiBpdHNlbGYgY29udGFpbiAmJi87L3wvbmV3bGluZXMgdGhhdCB3b3VsZFxuLy8gb3RoZXJ3aXNlIGNvbmZ1c2Ugc3BsaXRUb3BMZXZlbC4gTWF0Y2hlZCBzcGFucyBhcmUgbWFza2VkIG91dCBvZiB0aGUgc3RyaW5nXG4vLyAocmVwbGFjZWQgd2l0aCBhbiBpbmRleGVkIHBsYWNlaG9sZGVyIHNpbXBsZS1jb21tYW5kKSBiZWZvcmUgdGhlIHJlc3Qgb2Zcbi8vIHRoZSBwaXBlbGluZSBydW5zLCBhbmQgcmUtYXNzb2NpYXRlZCBieSBpbmRleCBkdXJpbmcgdGhlIG1haW4gd2FsayBzbyB0aGVcbi8vIHdyaXRlIGlzIHJlc29sdmVkIGFnYWluc3QgdGhlIGNvcnJlY3QgYGNkYC10cmFja2VkIGRpcmVjdG9yeS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgSGVyZWRvY1dyaXRlIHtcbiAgcmVkaXJlY3Q6ICc+JyB8ICc+Pic7XG4gIHRhcmdldDogc3RyaW5nO1xuICBib2R5OiBzdHJpbmc7XG59XG5cbmNvbnN0IEhFUkVET0NfT1BFTiA9XG4gIC9cXGJjYXRbIFxcdF0rKD57MSwyfSlbIFxcdF0qKFxcUyspWyBcXHRdKjw8KC0/KVsgXFx0XSooPzonKFteJ10qKSd8XCIoW15cIl0qKVwifChbQS1aYS16X11bQS1aYS16MC05X10qKSlbIFxcdF0qXFxyP1xcbi9nO1xuXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHMucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdEhlcmVkb2NXcml0ZXMocmF3OiBzdHJpbmcpOiB7IHdyaXRlczogSGVyZWRvY1dyaXRlW107IG1hc2tlZDogc3RyaW5nIH0ge1xuICBjb25zdCB3cml0ZXM6IEhlcmVkb2NXcml0ZVtdID0gW107XG4gIGxldCBtYXNrZWQgPSAnJztcbiAgbGV0IGN1cnNvciA9IDA7XG4gIEhFUkVET0NfT1BFTi5sYXN0SW5kZXggPSAwO1xuICBsZXQgb3Blbk1hdGNoOiBSZWdFeHBFeGVjQXJyYXkgfCBudWxsID0gSEVSRURPQ19PUEVOLmV4ZWMocmF3KTtcbiAgd2hpbGUgKG9wZW5NYXRjaCAhPT0gbnVsbCkge1xuICAgIGNvbnN0IFssIHJlZGlyZWN0LCB0YXJnZXQsIGRhc2gsIGRxMSwgZHEyLCBiYXJlXSA9IG9wZW5NYXRjaDtcbiAgICBjb25zdCBkZWxpbSA9IGRxMSA/PyBkcTIgPz8gYmFyZTtcbiAgICBjb25zdCBib2R5U3RhcnQgPSBvcGVuTWF0Y2guaW5kZXggKyBvcGVuTWF0Y2hbMF0ubGVuZ3RoO1xuICAgIGlmICghZGVsaW0gfHwgYm9keVN0YXJ0IDwgY3Vyc29yKSB7XG4gICAgICBIRVJFRE9DX09QRU4ubGFzdEluZGV4ID0gb3Blbk1hdGNoLmluZGV4ICsgMTtcbiAgICAgIG9wZW5NYXRjaCA9IEhFUkVET0NfT1BFTi5leGVjKHJhdyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgY2xvc2VSZSA9IG5ldyBSZWdFeHAoYF4ke2Rhc2ggPyAnXFxcXHQqJyA6ICcnfSR7ZXNjYXBlUmVnRXhwKGRlbGltKX1bIFxcXFx0XSokYCwgJ20nKTtcbiAgICBjb25zdCByZW1haW5kZXIgPSByYXcuc2xpY2UoYm9keVN0YXJ0KTtcbiAgICBjb25zdCBjbG9zZU1hdGNoID0gY2xvc2VSZS5leGVjKHJlbWFpbmRlcik7XG4gICAgaWYgKCFjbG9zZU1hdGNoKSB7XG4gICAgICBIRVJFRE9DX09QRU4ubGFzdEluZGV4ID0gYm9keVN0YXJ0O1xuICAgICAgb3Blbk1hdGNoID0gSEVSRURPQ19PUEVOLmV4ZWMocmF3KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBib2R5ID0gcmVtYWluZGVyLnNsaWNlKDAsIGNsb3NlTWF0Y2guaW5kZXgpLnJlcGxhY2UoL1xcbiQvLCAnJyk7XG4gICAgY29uc3QgbWF0Y2hFbmQgPSBib2R5U3RhcnQgKyBjbG9zZU1hdGNoLmluZGV4ICsgY2xvc2VNYXRjaFswXS5sZW5ndGg7XG5cbiAgICBtYXNrZWQgKz0gcmF3LnNsaWNlKGN1cnNvciwgb3Blbk1hdGNoLmluZGV4KTtcbiAgICBtYXNrZWQgKz0gYF9faGVyZWRvY18ke3dyaXRlcy5sZW5ndGh9X19gO1xuICAgIGN1cnNvciA9IG1hdGNoRW5kO1xuICAgIHdyaXRlcy5wdXNoKHsgcmVkaXJlY3Q6IHJlZGlyZWN0IGFzICc+JyB8ICc+PicsIHRhcmdldCwgYm9keSB9KTtcblxuICAgIEhFUkVET0NfT1BFTi5sYXN0SW5kZXggPSBtYXRjaEVuZDtcbiAgICBvcGVuTWF0Y2ggPSBIRVJFRE9DX09QRU4uZXhlYyhyYXcpO1xuICB9XG4gIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yKTtcbiAgcmV0dXJuIHsgd3JpdGVzLCBtYXNrZWQgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcmNoZXN0cmF0b3Jcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBMSU5FX1NFTEVDVE9SUyA9IFttYXRjaFNlZCwgbWF0Y2hIZWFkLCBtYXRjaFRhaWxdO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZDogc3RyaW5nLCBjd2Q6IHN0cmluZyA9IHByb2Nlc3MuY3dkKCkpOiBTcGFuTWF0Y2hbXSB7XG4gIGNvbnN0IHsgd3JpdGVzOiBoZXJlZG9jV3JpdGVzLCBtYXNrZWQgfSA9IGV4dHJhY3RIZXJlZG9jV3JpdGVzKGNvbW1hbmQpO1xuICBjb25zdCBzaW1wbGVDb21tYW5kcyA9IHNwbGl0VG9wTGV2ZWwobWFza2VkKTtcblxuICBjb25zdCByZXN1bHRzOiBTcGFuTWF0Y2hbXSA9IFtdO1xuICBjb25zdCBmc0xpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuICBjb25zdCBnaXRMaW5lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyIHwgbnVsbD4oKTtcblxuICBjb25zdCBjYWNoZWRGc1RvdGFsTGluZXMgPSAoYWJzUGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgaWYgKCFmc0xpbmVDYWNoZS5oYXMoYWJzUGF0aCkpIGZzTGluZUNhY2hlLnNldChhYnNQYXRoLCBjb3VudEZpbGVMaW5lcyhhYnNQYXRoKSk7XG4gICAgcmV0dXJuIGZzTGluZUNhY2hlLmdldChhYnNQYXRoKSA/PyBudWxsO1xuICB9O1xuICBjb25zdCBjYWNoZWRHaXRUb3RhbExpbmVzID0gKGdpdEN3ZDogc3RyaW5nLCByZXY6IHN0cmluZywgcGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gYCR7Z2l0Q3dkfVx1MDAwMCR7cmV2fVx1MDAwMCR7cGF0aH1gO1xuICAgIGlmICghZ2l0TGluZUNhY2hlLmhhcyhrZXkpKSBnaXRMaW5lQ2FjaGUuc2V0KGtleSwgY291bnRHaXRCbG9iTGluZXMoZ2l0Q3dkLCByZXYsIHBhdGgpKTtcbiAgICByZXR1cm4gZ2l0TGluZUNhY2hlLmdldChrZXkpID8/IG51bGw7XG4gIH07XG5cbiAgbGV0IGN1cnJlbnREaXIgPSBjd2Q7XG4gIGxldCBsYXN0UGxhaW5GaWxlU291cmNlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICBjb25zdCBlbWl0Q2FuZGlkYXRlID0gKGM6IFJhd0NhbmRpZGF0ZSwgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nKSA9PiB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGMuZmlsZUFyZykpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYy5maWxlQXJnLFxuICAgICAgICByZWFzb246ICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYidcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChkaXJGb3JSZXNvbHV0aW9uLCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHRvdGFsTGluZXMgPVxuICAgICAgYy5yZXNvbHZlcktpbmQgPT09ICdmcydcbiAgICAgICAgPyBjYWNoZWRGc1RvdGFsTGluZXMoYWJzb2x1dGVQYXRoKVxuICAgICAgICA6IGNhY2hlZEdpdFRvdGFsTGluZXMoYy5kaXJPdmVycmlkZSA/PyBkaXJGb3JSZXNvbHV0aW9uLCBjLnJlc29sdmVyS2luZC5yZXYsIGMuZmlsZUFyZyk7XG4gICAgY29uc3QgcmFuZ2UgPSByZXNvbHZlU3BlYyhjLnNwZWMsIHRvdGFsTGluZXMpO1xuICAgIGlmIChyYW5nZSA9PT0gbnVsbCkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHJlYXNvbjogJ2NvdWxkIG5vdCBkZXRlcm1pbmUgZW5kLW9mLWZpbGUgbGluZSBjb3VudCAoZmlsZSB1bnJlYWRhYmxlLCBlbXB0eSwgb3IgZ2l0IHJldi9wYXRoIG5vdCBmb3VuZCknXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgc3BhbjogeyBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCwgbGluZUVuZDogcmFuZ2UubGluZUVuZCwgYWJzb2x1dGVQYXRoIH1cbiAgICB9KTtcbiAgfTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IHNpbXBsZUNvbW1hbmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3Qgc2ltcGxlID0gc2ltcGxlQ29tbWFuZHNbaV07XG4gICAgY29uc3QgaGVyZWRvY1JlZiA9IHNpbXBsZS50ZXh0Lm1hdGNoKC9eX19oZXJlZG9jXyhcXGQrKV9fJC8pO1xuICAgIGlmIChoZXJlZG9jUmVmKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnN0IHcgPSBoZXJlZG9jV3JpdGVzW051bWJlci5wYXJzZUludChoZXJlZG9jUmVmWzFdLCAxMCldO1xuICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHcudGFyZ2V0KSkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgZmlsZUFyZzogdy50YXJnZXQsXG4gICAgICAgICAgcmVhc29uOiAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InXG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIHcudGFyZ2V0KTtcbiAgICAgIGNvbnN0IGJvZHlMaW5lcyA9IHcuYm9keS5sZW5ndGggPT09IDAgPyAwIDogdy5ib2R5LnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gICAgICBpZiAoYm9keUxpbmVzID09PSAwKSB7XG4gICAgICAgIC8vIGBjYXQgPiBmIDw8J0VPRidgIHdpdGggYW4gZW1wdHkgYm9keSB0cnVuY2F0ZXMgdGhlIGZpbGUgdG8gZW1wdHkgXHUyMDE0IGFcbiAgICAgICAgLy8gcmVhbCB3cml0ZSB0aGF0IG11c3QgcHJvZHVjZSBhIHRvdWNoICh3aG9sZS1maWxlLCB2aWEgYGJvZHk6ICcnYCkuXG4gICAgICAgIC8vIGA+PmAgd2l0aCBhbiBlbXB0eSBib2R5IGFwcGVuZHMgbm90aGluZyBhbmQgaXMgYSBnZW51aW5lIG5vLW9wLlxuICAgICAgICBpZiAody5yZWRpcmVjdCAhPT0gJz4nKSBjb250aW51ZTtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBzcGFuOiB7IGxpbmVTdGFydDogMSwgbGluZUVuZDogMSwgYWJzb2x1dGVQYXRoLCBib2R5OiAnJyB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPVxuICAgICAgICB3LnJlZGlyZWN0ID09PSAnPicgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IDEsIGVuZDogYm9keUxpbmVzIH0gOiB7IGtpbmQ6ICdhcHBlbmRMaW5lcycsIGNvdW50OiBib2R5TGluZXMgfTtcbiAgICAgIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoc3BlYywgY2FjaGVkRnNUb3RhbExpbmVzKGFic29sdXRlUGF0aCkpO1xuICAgICAgaWYgKHJhbmdlID09PSBudWxsKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBmaWxlQXJnOiBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgcmVhc29uOiAnYXBwZW5kIHRhcmdldDogY291bGQgbm90IHJlYWQgZXhpc3RpbmcgZmlsZSB0byBmaW5kIGl0cyBjdXJyZW50IGxlbmd0aCdcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46IHsgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsIGFic29sdXRlUGF0aCwgYm9keTogdy5ib2R5IH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBhcmd2ID0gYXJndk9mKHNpbXBsZS50ZXh0KTtcbiAgICBpZiAoIWFyZ3YgfHwgYXJndi5sZW5ndGggPT09IDApIHtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjZCcpIHtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29uc3QgdGFyZ2V0ID0gYXJndlsxXTtcbiAgICAgIGlmICh0YXJnZXQgIT09IHVuZGVmaW5lZCAmJiB0YXJnZXQgIT09ICctJyAmJiAhaGFzU2hlbGxFeHBhbnNpb24odGFyZ2V0KSkge1xuICAgICAgICBjdXJyZW50RGlyID0gcmVzb2x2ZVBhdGgoY3VycmVudERpciwgdGFyZ2V0KTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGxldCBpc1BsYWluU291cmNlID0gZmFsc2U7XG4gICAgbGV0IHBsYWluRmlsZUFyZzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjYXQnICYmIGFyZ3YubGVuZ3RoID09PSAyICYmICFhcmd2WzFdLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICBwbGFpbkZpbGVBcmcgPSBhcmd2WzFdO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IGhhc1NoZWxsRXhwYW5zaW9uKGFyZ3ZbMV0pID8gbnVsbCA6IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGFyZ3ZbMV0pO1xuICAgIH0gZWxzZSBpZiAoYXJndlswXSA9PT0gJ25sJyAmJiBhcmd2Lmxlbmd0aCA+PSAyICYmICFhcmd2W2FyZ3YubGVuZ3RoIC0gMV0uc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgIGNvbnN0IGYgPSBhcmd2W2FyZ3YubGVuZ3RoIC0gMV07XG4gICAgICBwbGFpbkZpbGVBcmcgPSBmO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IGhhc1NoZWxsRXhwYW5zaW9uKGYpID8gbnVsbCA6IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGYpO1xuICAgIH1cblxuICAgIC8vIEEgYmFyZSBgY2F0IGZpbGVgL2BubCBmaWxlYCB0aGF0IGlzIG5vdCBmZWVkaW5nIGEgZG93bnN0cmVhbSBwaXBlIHN0YWdlXG4gICAgLy8gcmVhZHMgdGhlIHdob2xlIGZpbGU6IGVtaXQgdGhlIHNhbWUgd2hvbGUtZmlsZSBzcGFuIGBnaXQgc2hvdyByZXY6cGF0aGBcbiAgICAvLyBwcm9kdWNlcy4gV2hlbiBhIHBpcGUgZm9sbG93cywgdGhlIGRvd25zdHJlYW0gbGluZS1zZWxlY3RvciBhbHJlYWR5XG4gICAgLy8gZW1pdHMgdGhlIHByZWNpc2UgcmFuZ2UsIHNvIHRoZSBzb3VyY2Ugc3RheXMgc291cmNlLW9ubHkuXG4gICAgaWYgKHBsYWluRmlsZUFyZyAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgbmV4dCA9IHNpbXBsZUNvbW1hbmRzW2kgKyAxXTtcbiAgICAgIGlmIChuZXh0ID09PSB1bmRlZmluZWQgfHwgbmV4dC5wcmVjZWRlZEJ5ICE9PSAnfCcpIHtcbiAgICAgICAgZW1pdENhbmRpZGF0ZShcbiAgICAgICAgICB7XG4gICAgICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgICAgIGlkaW9tOiBhcmd2WzBdID09PSAnY2F0JyA/ICdjYXQtZmlsZScgOiAnbmwtZmlsZScsXG4gICAgICAgICAgICBmaWxlQXJnOiBwbGFpbkZpbGVBcmcsXG4gICAgICAgICAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgICAgICAgICByZXNvbHZlcktpbmQ6ICdmcydcbiAgICAgICAgICB9LFxuICAgICAgICAgIGN1cnJlbnREaXJcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgbWF0Y2hlciBvZiBbLi4uTElORV9TRUxFQ1RPUlMsIG1hdGNoR2l0U2hvdywgbWF0Y2hHaXRMb2dMXSkge1xuICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIoYXJndikpIHtcbiAgICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgICAgIGlmIChvdXRjb21lLmtpbmQgPT09ICd1bnJlc29sdmVkJykge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgIGlkaW9tOiBvdXRjb21lLmlkaW9tLFxuICAgICAgICAgICAgZmlsZUFyZzogb3V0Y29tZS5maWxlQXJnLFxuICAgICAgICAgICAgcmVhc29uOiBvdXRjb21lLnJlYXNvblxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgb3V0Y29tZS5kaXJPdmVycmlkZSA/PyBjdXJyZW50RGlyKTtcbiAgICAgICAgICAvLyBgZ2l0IHNob3cgcmV2OnBhdGhgIHByaW50cyB0aGUgYmxvYiB2ZXJiYXRpbSwgc28gKHVubGlrZSBgZ2l0IGxvZyAtTGAsXG4gICAgICAgICAgLy8gd2hpY2ggcHJpbnRzIGRpZmYtZm9ybWF0dGVkIGhpc3RvcnkpIGl0J3MgYSB2YWxpZCBvbmUtaG9wIHBpcGUgc291cmNlXG4gICAgICAgICAgLy8gZm9yIGEgZG93bnN0cmVhbSBsaW5lLXNlbGVjdG9yLCBzYW1lIGFzIGBjYXRgL2BubGAuXG4gICAgICAgICAgaWYgKG91dGNvbWUuaWRpb20gPT09ICdnaXQtc2hvdy1yZXYtcGF0aCcgJiYgIWxvb2tzVW5yZXNvbHZhYmxlKG91dGNvbWUuZmlsZUFyZykpIHtcbiAgICAgICAgICAgIGlzUGxhaW5Tb3VyY2UgPSB0cnVlO1xuICAgICAgICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IHJlc29sdmVQYXRoKG91dGNvbWUuZGlyT3ZlcnJpZGUgPz8gY3VycmVudERpciwgb3V0Y29tZS5maWxlQXJnKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIW1hdGNoZWQgJiYgc2ltcGxlLnByZWNlZGVkQnkgPT09ICd8JyAmJiBsYXN0UGxhaW5GaWxlU291cmNlKSB7XG4gICAgICBjb25zdCB3aXRoRmlsZSA9IFsuLi5hcmd2LCBsYXN0UGxhaW5GaWxlU291cmNlXTtcbiAgICAgIGZvciAoY29uc3QgbWF0Y2hlciBvZiBMSU5FX1NFTEVDVE9SUykge1xuICAgICAgICBmb3IgKGNvbnN0IG91dGNvbWUgb2YgbWF0Y2hlcih3aXRoRmlsZSkpIHtcbiAgICAgICAgICBpZiAob3V0Y29tZS5raW5kID09PSAnY2FuZGlkYXRlJykgZW1pdENhbmRpZGF0ZShvdXRjb21lLCBjdXJyZW50RGlyKTtcbiAgICAgICAgICBlbHNlXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgICAgaWRpb206IG91dGNvbWUuaWRpb20sXG4gICAgICAgICAgICAgIGZpbGVBcmc6IG91dGNvbWUuZmlsZUFyZyxcbiAgICAgICAgICAgICAgcmVhc29uOiBvdXRjb21lLnJlYXNvblxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzUGxhaW5Tb3VyY2UpIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbi8qKiBQYXJzZXMgYSBCYXNoIGBjb21tYW5kYCBzdHJpbmcgaW50byB0aGUgZmlsZStsaW5lLXJhbmdlIHNwYW5zIGl0IHN0YXRpY2FsbHksIHJlbGlhYmx5IHJlYWRzIG9yIHdyaXRlcy4gYGN3ZGAgZGVmYXVsdHMgdG8gYHByb2Nlc3MuY3dkKClgIFx1MjAxNCBwYXNzIHRoZSBob29rJ3Mgb3duIGBjd2RgIGZpZWxkIGZvciBjb3JyZWN0IHJlc29sdXRpb24gb2YgcmVsYXRpdmUgcGF0aHMgYW5kIGBjZGAvYGdpdCAtQ2AgdGFyZ2V0cywgYW5kIG9mIGBnaXQgc2hvd2AvYGdpdCBsb2cgLUxgIHJldmlzaW9ucy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbW1hbmQoY29tbWFuZDogc3RyaW5nLCBjd2Q6IHN0cmluZyA9IHByb2Nlc3MuY3dkKCkpOiBSZXNvbHZlZFNwYW5bXSB7XG4gIGNvbnN0IGRldGFpbGVkID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgY3dkKTtcbiAgY29uc3Qgc3BhbnM6IFJlc29sdmVkU3BhbltdID0gW107XG4gIGZvciAoY29uc3QgbSBvZiBkZXRhaWxlZCkge1xuICAgIGlmIChtLnN0YXR1cyA9PT0gJ3Jlc29sdmVkJykgc3BhbnMucHVzaChtLnNwYW4pO1xuICB9XG4gIHJldHVybiBzcGFucztcbn1cbiIsICIvKipcbiAqIFRoZSBvbmx5IGltcHVyZSBiaXRzOiBjb3VudGluZyBsaW5lcyBvZiBhIHdvcmtpbmctdHJlZSBmaWxlLCBhbmQgb2YgYSBmaWxlXG4gKiBhcyBpdCBleGlzdGVkIGF0IGEgZ2l2ZW4gZ2l0IHJldmlzaW9uLiBCb3RoIHJldHVybiBudWxsIG9uIGFueSBmYWlsdXJlXG4gKiAobWlzc2luZyBmaWxlLCBiYWQgcmV2LCBub3QgYSBnaXQgcmVwbywgZXRjLikgaW5zdGVhZCBvZiB0aHJvd2luZyBcdTIwMTQgYVxuICogY29tbWFuZCB0aGF0IHN0YXRpY2FsbHkgbWF0Y2hlZCBhbiBpZGlvbSBidXQgcG9pbnRzIGF0IHNvbWV0aGluZyB0aGlzXG4gKiBtYWNoaW5lIGNhbid0IGN1cnJlbnRseSByZXNvbHZlIGlzIGEgbm9ybWFsLCBleHBlY3RlZCBvdXRjb21lLCBub3QgYSBidWcuXG4gKi9cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyByZWFkRmlsZVN5bmMsIHN0YXRTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5cbi8qKiBOdW1iZXIgb2YgbGluZXMgaW4gYSB3b3JraW5nLXRyZWUgZmlsZSwgb3IgbnVsbCBpZiBpdCBjYW4ndCBiZSByZWFkLiBUcmFpbGluZyBuZXdsaW5lIGRvZXMgbm90IGNvdW50IGFzIGFuIGV4dHJhIGVtcHR5IGxpbmUuICovXG5leHBvcnQgZnVuY3Rpb24gY291bnRGaWxlTGluZXMoYWJzb2x1dGVQYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBpZiAoIXN0YXRTeW5jKGFic29sdXRlUGF0aCkuaXNGaWxlKCkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkRmlsZVN5bmMoYWJzb2x1dGVQYXRoLCAndXRmOCcpO1xuICAgIGlmIChjb250ZW50Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIDA7XG4gICAgY29uc3Qgd2l0aG91dFRyYWlsaW5nTmV3bGluZSA9IGNvbnRlbnQuZW5kc1dpdGgoJ1xcbicpID8gY29udGVudC5zbGljZSgwLCAtMSkgOiBjb250ZW50O1xuICAgIHJldHVybiB3aXRob3V0VHJhaWxpbmdOZXdsaW5lLnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKiBOdW1iZXIgb2YgbGluZXMgaW4gYHBhdGhgIGFzIGl0IGV4aXN0cyBhdCBgcmV2YCwgcnVuIGZyb20gYGN3ZGAsIG9yIG51bGwgaWYgdGhlIHJldi9wYXRoL3JlcG8gZG9lc24ndCByZXNvbHZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50R2l0QmxvYkxpbmVzKGN3ZDogc3RyaW5nLCByZXY6IHN0cmluZywgcGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3Nob3cnLCBgJHtyZXZ9OiR7cGF0aH1gXSwge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgaWYgKG91dC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBvdXQuZW5kc1dpdGgoJ1xcbicpID8gb3V0LnNsaWNlKDAsIC0xKSA6IG91dDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIiwgIi8qKlxuICogSGV1cmlzdGljLCBkZXBlbmRlbmN5LWZyZWUgc2hlbGwgc3BsaXR0aW5nLiBOb3QgYSBmdWxsIHNoZWxsIHBhcnNlciBcdTIwMTQgZ29vZFxuICogZW5vdWdoIHRvIGxvY2F0ZSBzaW1wbGUgY29tbWFuZHMgKGFuZCB0aGVpciBhcmd2KSBpbnNpZGUgYSBsYXJnZXJcbiAqICYmL3x8LzsvfC1qb2luZWQgQmFzaCBzdHJpbmcgd2l0aG91dCBwdWxsaW5nIGluIGEgcmVhbCBiYXNoIEFTVCBwYXJzZXIuXG4gKiBWYWxpZGF0ZWQgZHVyaW5nIHJlc2VhcmNoIGFnYWluc3QgYmFzaGxleCBvbiB0aGUgcmVhbCB0cmFuc2NyaXB0IGNvcnB1cztcbiAqIHRoaXMgcG9ydHMgdGhlIHNhbWUgYWxnb3JpdGhtLlxuICovXG5cbi8qKiBPbmUgYHNpbXBsZSBjb21tYW5kYCBmb3VuZCBpbiBhIGxhcmdlciBzY3JpcHQsIHBsdXMgd2hpY2ggb3BlcmF0b3IgcHJlY2VkZWQgaXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFNpbXBsZUNvbW1hbmQge1xuICB0ZXh0OiBzdHJpbmc7XG4gIC8qKiBUaGUgb3BlcmF0b3IgaW1tZWRpYXRlbHkgYmVmb3JlIHRoaXMgY29tbWFuZCAoJ3wnIGZvciBhIHBpcGVsaW5lIHN0YWdlLCBvdGhlcndpc2UgJyYmJy8nOycvJ1xcbicvZXRjLiwgb3IgJ3N0YXJ0JyBmb3IgdGhlIGZpcnN0IGNvbW1hbmQpLiAqL1xuICBwcmVjZWRlZEJ5OiAnfCcgfCAnb3RoZXInIHwgJ3N0YXJ0Jztcbn1cblxuLyoqIFNwbGl0IGEgY29tbWFuZCBzdHJpbmcgaW50byBzaW1wbGUtY29tbWFuZCBzdWJzdHJpbmdzIGF0IHRvcC1sZXZlbCAmJiwgfHwsIDssIHwsIHwmLCBhbmQgbmV3bGluZSBib3VuZGFyaWVzLiBRdW90ZXMgYW5kICQoKS9gYC8oKSBuZXN0aW5nIGFyZSByZXNwZWN0ZWQgKG5vdCBzcGxpdCBpbnNpZGUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNwbGl0VG9wTGV2ZWwoY21kOiBzdHJpbmcpOiBTaW1wbGVDb21tYW5kW10ge1xuICBjb25zdCBwYXJ0czogU2ltcGxlQ29tbWFuZFtdID0gW107XG4gIGxldCBidWYgPSAnJztcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gY21kLmxlbmd0aDtcbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IGluU3F1b3RlID0gZmFsc2U7XG4gIGxldCBpbkRxdW90ZSA9IGZhbHNlO1xuICBsZXQgcGVuZGluZ09wOiBTaW1wbGVDb21tYW5kWydwcmVjZWRlZEJ5J10gPSAnc3RhcnQnO1xuXG4gIGNvbnN0IGZsdXNoID0gKG5leHRPcDogU2ltcGxlQ29tbWFuZFsncHJlY2VkZWRCeSddKSA9PiB7XG4gICAgY29uc3QgcyA9IGJ1Zi50cmltKCk7XG4gICAgaWYgKHMpIHBhcnRzLnB1c2goeyB0ZXh0OiBzLCBwcmVjZWRlZEJ5OiBwZW5kaW5nT3AgfSk7XG4gICAgYnVmID0gJyc7XG4gICAgcGVuZGluZ09wID0gbmV4dE9wO1xuICB9O1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBvcGVyYXRvciBjdXJyZW50bHkgcGVuZGluZyBpcyBhIHBpcGUgKGB8YC9gfCZgKS4gQSBoZWxwZXJcbiAgICogcmF0aGVyIHRoYW4gYW4gaW5saW5lIGNvbXBhcmlzb246IFR5cGVTY3JpcHQncyBjb250cm9sLWZsb3cgbmFycm93aW5nXG4gICAqIGNhbm5vdCBzZWUgdGhlIGFzc2lnbm1lbnRzIGBmbHVzaGAgbWFrZXMgdG8gYHBlbmRpbmdPcGAgZnJvbSBpbnNpZGUgaXRzXG4gICAqIGNsb3N1cmUsIGFuZCB3b3VsZCBvdGhlcndpc2UgbmFycm93IHRoZSBkaXJlY3QgY29tcGFyaXNvbiB0byB0aGVcbiAgICogaW5pdGlhbGl6ZXIgYCdzdGFydCdgLlxuICAgKi9cbiAgY29uc3QgaXNQZW5kaW5nUGlwZSA9ICgpOiBib29sZWFuID0+IHBlbmRpbmdPcCA9PT0gJ3wnO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBjbWRbaV07XG4gICAgaWYgKGluU3F1b3RlKSB7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGlmIChjID09PSBcIidcIikgaW5TcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5EcXVvdGUpIHtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgICAgYnVmICs9IGNtZFtpICsgMV07XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1wiJykgaW5EcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU3F1b3RlID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBpbkRxdW90ZSA9IHRydWU7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgYnVmICs9IGMgKyBjbWRbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKCcpIHtcbiAgICAgIGRlcHRoICs9IDE7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyknKSB7XG4gICAgICBkZXB0aCA9IE1hdGgubWF4KDAsIGRlcHRoIC0gMSk7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZGVwdGggPT09IDApIHtcbiAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnJiYnKSB7XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8fCcpIHtcbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJ3wmJykge1xuICAgICAgICBmbHVzaCgnfCcpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICc7Jykge1xuICAgICAgICBmbHVzaCgnb3RoZXInKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnfCcpIHtcbiAgICAgICAgZmx1c2goJ3wnKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxuJykge1xuICAgICAgICAvLyBBIG5ld2xpbmUgaW1tZWRpYXRlbHkgYWZ0ZXIgYSBwaXBlIG9wZXJhdG9yIGlzIGEgbGluZSBjb250aW51YXRpb25cbiAgICAgICAgLy8gKGBjYXQgYS50eHQgfFxcbnNlZCAuLi5gIGtlZXBzIHRoZSBwaXBlbGluZSksIG5vdCBhIHN0YXRlbWVudFxuICAgICAgICAvLyBzZXBhcmF0b3I6IHNraXBwaW5nIGl0IHByZXNlcnZlcyBgcHJlY2VkZWRCeTogJ3wnYCBmb3IgdGhlIG5leHRcbiAgICAgICAgLy8gc3RhZ2UgaW5zdGVhZCBvZiBkZWdyYWRpbmcgaXQgdG8gJ290aGVyJy5cbiAgICAgICAgaWYgKGlzUGVuZGluZ1BpcGUoKSkge1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBmbHVzaCgnb3RoZXInKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnJicpIHtcbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIGJ1ZiArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICBmbHVzaCgnb3RoZXInKTtcbiAgcmV0dXJuIHBhcnRzO1xufVxuXG5jb25zdCBMRUFESU5HX0FTU0lHTk1FTlQgPSAvXig/OltBLVphLXpfXVtBLVphLXowLTlfXSo9XFxTKlxccyspKy87XG5cbi8qKiBTdHJpcCBsZWFkaW5nIEZPTz1iYXIgVkFSPWJheiBlbnYtcHJlZml4IGFzc2lnbm1lbnRzIGZyb20gYSBzaW1wbGUgY29tbWFuZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGVDbWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzaW1wbGVDbWQucmVwbGFjZShMRUFESU5HX0FTU0lHTk1FTlQsICcnKTtcbn1cblxuLyoqIFF1b3RlLWF3YXJlIHdoaXRlc3BhY2UgdG9rZW5pemVyLCByb3VnaGx5IG1hdGNoaW5nIGBzaGxleC5zcGxpdChzLCBwb3NpeD1UcnVlKWAuIFJldHVybnMgbnVsbCBvbiB1bmJhbGFuY2VkIHF1b3Rlcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzcGxpdFdvcmRzKHM6IHN0cmluZyk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGNvbnN0IHdvcmRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3VyID0gJyc7XG4gIGxldCBoYXMgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gcy5sZW5ndGg7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IHNbaV07XG4gICAgaWYgKC9cXHMvLnRlc3QoYykpIHtcbiAgICAgIGlmIChoYXMpIHtcbiAgICAgICAgd29yZHMucHVzaChjdXIpO1xuICAgICAgICBjdXIgPSAnJztcbiAgICAgICAgaGFzID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29uc3QgZW5kID0gcy5pbmRleE9mKFwiJ1wiLCBpKTtcbiAgICAgIGlmIChlbmQgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICAgIGN1ciArPSBzLnNsaWNlKGksIGVuZCk7XG4gICAgICBpID0gZW5kICsgMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIHdoaWxlIChpIDwgbiAmJiBzW2ldICE9PSAnXCInKSB7XG4gICAgICAgIGlmIChzW2ldID09PSAnXFxcXCcgJiYgaSArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXMoc1tpICsgMV0pKSB7XG4gICAgICAgICAgY3VyICs9IHNbaSArIDFdO1xuICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjdXIgKz0gc1tpXTtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChpID49IG4pIHJldHVybiBudWxsO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY3VyICs9IHNbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGhhcyA9IHRydWU7XG4gICAgY3VyICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG4gIGlmIChoYXMpIHdvcmRzLnB1c2goY3VyKTtcbiAgcmV0dXJuIHdvcmRzO1xufVxuXG4vKiogQmVzdC1lZmZvcnQgYXJndiBmb3IgYSBzaW1wbGUgY29tbWFuZDogbGVhZGluZyBhc3NpZ25tZW50cyBzdHJpcHBlZCwgcXVvdGUtYXdhcmUgc3BsaXQuIFJldHVybnMgbnVsbCBpZiB0aGUgY29tbWFuZCBkb2Vzbid0IHRva2VuaXplIGNsZWFubHkgKHVuYmFsYW5jZWQgcXVvdGVzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcmd2T2Yoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICByZXR1cm4gc3BsaXRXb3JkcyhzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGVDbWQpLnRyaW0oKSk7XG59XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHNwYW4tc3VyZmFjaW5nIGNvcmUuXG4gKlxuICogR2l2ZW4gYW4gYWxyZWFkeS1yZXNvbHZlZCByZXBvLXJlbGF0aXZlIHBhdGggYW5kIGEgbGluZSByYW5nZSwgdGhpcyBtb2R1bGVcbiAqIHJ1bnMgdGhlIHNoYXJlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgLyBgLmhvb2tpZ25vcmVgIC8gc2Vzc2lvbi1tZW1vIC9cbiAqIGBnaXQgc3BhbiBzdGFsZWAgcGlwZWxpbmUgYW5kIGFzc2VtYmxlcyB0aGUgaHVtYW4tcmVhZGFibGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmBcbiAqIGJsb2NrIHRoYXQgYm90aCBhZGFwdGVycyBzdXJmYWNlIGlubGluZSBiZWZvcmUgYW4gZWRpdC4gSXQgaW1wb3J0cyBub3RoaW5nXG4gKiBmcm9tIGVpdGhlciBob29rIFNESzogdGhlIENsYXVkZSBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgYSByYW5nZSBkZXJpdmVkIGZyb21cbiAqIGBmaWxlX3BhdGhgL2BvZmZzZXRgL2BvbGRfc3RyaW5nYDsgdGhlIENvZGV4IFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCB0aGVcbiAqIHJhbmdlcyByZWNvdmVyZWQgZnJvbSBhbiBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlLiBFYWNoIGFkYXB0ZXIgd3JhcHMgdGhlXG4gKiByZXR1cm5lZCBibG9jayBzdHJpbmcgaW4gaXRzIG93biBTREsgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogVGhlIGV4ZWN1dG9yL3N0YWxlL21lbW8gZGVwZW5kZW5jaWVzIGFyZSBpbmplY3RlZCBzbyB0aGUgcGlwZWxpbmUgaXMgdGVzdGFibGVcbiAqIHdpdGggZmFrZXMgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGUgc2hhcmVkIGtlcm5lbC5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgaXNHaXRJZ25vcmVkLFxuICBpc0luc2lkZVNwYW5Sb290LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHBhcnNlUG9yY2VsYWluLFxuICBwYXJzZVN0YWxlUG9yY2VsYWluLFxuICBwcnVuZVN0YWxlU2Vzc2lvbnMsXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290LFxuICBzZXNzaW9uRGlyLFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHR5cGUgSG9va0lnbm9yZUxvYWRlciwgaXNTcGFuU3VwcHJlc3NlZCB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG4vKipcbiAqIE1pbmltYWwgbG9nZ2VyIHN1cmZhY2UgdGhlIGBjb21tb24vYCBsYXllciBsb2dzIHRocm91Z2g7IGJvdGggU0RLIGxvZ2dlcnNcbiAqIHNhdGlzZnkgaXQuIGB3YXJuYCBpcyByZXF1aXJlZCBcdTIwMTQgZXZlcnkgZXhpc3RpbmcgY2FsbCBzaXRlIHJlcG9ydHMgYSBmYWlsdXJlLlxuICogYGluZm9gIGlzIG9wdGlvbmFsIHNvIGEgZmFrZSBjYXJyeWluZyBvbmx5IGB3YXJuYCBzdGlsbCBzYXRpc2ZpZXMgdGhlXG4gKiBpbnRlcmZhY2U6IGl0IGV4aXN0cyBmb3IgdGhlIGRpYWdub3N0aWMgYnJlYWRjcnVtYnMgYSAqc3VjY2Vzc2Z1bCogcnVuIGxlYXZlc1xuICogYmVoaW5kIChhZHZpc29yLWNvcmUncyBjaHVybi1zdXBwcmVzc2lvbiBjb3VudCksIHdoaWNoIGFyZSBub3Qgd2FybmluZ3MgYW5kXG4gKiBtdXN0IG5vdCByZWFkIGFzIGZhaWx1cmVzIGluIHRoZSBob29rIGxvZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb3JlTG9nZ2VyIHtcbiAgd2FybihtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG4gIGluZm8/KG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTcGFuIGV4ZWN1dG9yIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBFeGVjdXRlcyBgZ2l0IHNwYW4gbGlzdGAgd2l0aCBnaXZlbiBhcmdzIGluIGEgZ2l2ZW4gY3dkLlxuICogUmV0dXJucyBzdGRvdXQgc3RyaW5nLiBUaHJvd3Mgb24gbm9uLXplcm8gZXhpdC5cbiAqL1xuZXhwb3J0IHR5cGUgU3BhbkV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBTcGFuRXhlY3V0b3Ige1xuICByZXR1cm4gKGFyZ3MsIGN3ZCkgPT4ge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4uYXJnc10sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW5zIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW4gPHNsdWdzPmAgYW5kIHJldHVybnMgaXRzIHBvcmNlbGFpbiBzdGRvdXQgXHUyMDE0XG4gKiBvbmUgcm93IHBlciAqZHJpZnRlZCogYW5jaG9yIGFtb25nIHRoZSBnaXZlbiBzcGFucywgZW1wdHkgd2hlbiBhbGwgYXJlIGNsZWFuLlxuICogYGdpdCBzcGFuIHN0YWxlYCBleGl0cyAwIGluIHBvcmNlbGFpbiBtb2RlIHdoZXRoZXIgb3Igbm90IGRyaWZ0IGV4aXN0cywgYnV0IHdlXG4gKiBzdGlsbCBjYXB0dXJlIHN0ZG91dCBmcm9tIGEgdGhyb3duIGVycm9yIHNvIGEgZHJpZnQgc2lnbmFsIGlzIG5ldmVyIGxvc3QgdG8gYVxuICogbm9uLXplcm8gZXhpdC4gVGhyb3dzIG9ubHkgd2hlbiBubyBzdGRvdXQgaXMgYXZhaWxhYmxlIChnZW51aW5lIGZhaWx1cmUpLlxuICovXG5leHBvcnQgdHlwZSBTdGFsZUV4ZWN1dG9yID0gKHNsdWdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRTdGFsZUV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IFN0YWxlRXhlY3V0b3Ige1xuICByZXR1cm4gKHNsdWdzLCBjd2QpID0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNsdWdzXSwge1xuICAgICAgICBjd2QsXG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgaWYgKHR5cGVvZiBvdXQgPT09ICdzdHJpbmcnKSByZXR1cm4gb3V0O1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIG1lbW8gYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lbW9TdG9yZSB7XG4gIGdldFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nKTogU2V0PHN0cmluZz47XG4gIGFkZFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nLCBuYW1lczogc3RyaW5nW10pOiB2b2lkO1xufVxuXG4vLyBMaXZlcyB1bmRlciB0aGUgc2hhcmVkIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSAoYWdlbnQtaG9va3MtY29tbW9uLnRzJ3Ncbi8vIHNlc3Npb25EaXIpIFx1MjAxNCByZWxvY2F0ZWQgZnJvbSBvcy50bXBkaXIoKS9hZ2VudC1ob29rcy1naXQtc3Bhbi8gc29cbi8vIHBlci1zZXNzaW9uIHN0YXRlIGhhcyBvbmUgaG9tZSBhbmQgaXMgY292ZXJlZCBieSBwcnVuZVN0YWxlU2Vzc2lvbnMnc1xuLy8gb3Bwb3J0dW5pc3RpYyA+MzAtZGF5IHBydW5pbmcuXG5mdW5jdGlvbiBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihzZXNzaW9uRGlyKHNlc3Npb25JZCksICd0b3VjaC1tZW1vLmpzb24nKTtcbn1cblxuZXhwb3J0IHR5cGUgTWVtb0xvZ2dlciA9IENvcmVMb2dnZXI7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiB7XG4gICAgZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJhdyA9IGZzLnJlYWRGaWxlU3luYyhtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKSwgJ3V0ZjgnKTtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHsgc3VyZmFjZWQ/OiB1bmtub3duIH07XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZC5zdXJmYWNlZCkpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IFNldChwYXJzZWQuc3VyZmFjZWQgYXMgc3RyaW5nW10pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gcmVhZCBmYWlsZWQgKHRyZWF0aW5nIGFzIGVtcHR5KScsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBTZXQoKTtcbiAgICB9LFxuICAgIGFkZFN1cmZhY2VkKHNlc3Npb25JZCwgbmFtZXMpIHtcbiAgICAgIHBydW5lU3RhbGVTZXNzaW9ucygpO1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gICAgICBmb3IgKGNvbnN0IG4gb2YgbmFtZXMpIGV4aXN0aW5nLmFkZChuKTtcbiAgICAgIGNvbnN0IG1lbW9EaXIgPSBzZXNzaW9uRGlyKHNlc3Npb25JZCk7XG4gICAgICBjb25zdCBtZW1vUGF0aCA9IG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgdG1wUGF0aCA9IGAke21lbW9QYXRofS50bXBgO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKG1lbW9EaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHRtcFBhdGgsIEpTT04uc3RyaW5naWZ5KHsgc3VyZmFjZWQ6IFsuLi5leGlzdGluZ10gfSksICd1dGY4Jyk7XG4gICAgICAgIGZzLnJlbmFtZVN5bmModG1wUGF0aCwgbWVtb1BhdGgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHdyaXRlIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqIEZhY3RvcnkgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEgTWVtb1N0b3JlIGdpdmVuIGEgbG9nZ2VyLiAqL1xuZXhwb3J0IHR5cGUgTWVtb0ZhY3RvcnkgPSAobG9nZ2VyOiBNZW1vTG9nZ2VyKSA9PiBNZW1vU3RvcmU7XG5cbi8qKiBEZWZhdWx0IGRpc2stYmFja2VkIG1lbW8gZmFjdG9yeSB1c2VkIGluIHByb2R1Y3Rpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZGlza01lbW9GYWN0b3J5KGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggc2NvcGUgcmVzb2x1dGlvbiAocmVwby1zY29waW5nICsgZ2l0aWdub3JlICsgc3Bhbi1yb290IGd1YXJkcylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoU2NvcGUge1xuICByZXBvUm9vdDogc3RyaW5nO1xuICByZXBvUmVsUGF0aDogc3RyaW5nO1xufVxuXG4vKipcbiAqIEJvdW5kIGEgdG91Y2hlZCBmaWxlIHRvIHRoZSBDV0QgcmVwby4gUmVzb2x2ZSB0aGUgcmVwbyByb290IG9mIHRoZSBjdXJyZW50XG4gKiB3b3JraW5nIGRpcmVjdG9yeSBhbmQgcmVxdWlyZSB0aGUgdG91Y2hlZCBmaWxlIHRvIHJlc29sdmUgdG8gdGhlIFNBTUUgcmVwb1xuICogcm9vdDsgZHJvcCBmaWxlcyBpbiBhIGRpZmZlcmVudCByZXBvc2l0b3J5L3dvcmt0cmVlLCBnaXRpZ25vcmVkIGZpbGVzLCBhbmRcbiAqIGZpbGVzIHVuZGVyIHRoZSBzcGFuIHJvb3QuIFJldHVybnMgdGhlIHJlc29sdmVkIGB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9YFxuICogb3IgbnVsbCB3aGVuIHRoZSB0b3VjaCBpcyBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQ29tcGFyaW5nIHJlc29sdmVkIGBnaXQgLS1zaG93LXRvcGxldmVsYCB0b3BsZXZlbHMgKG5vdCBwYXRoIHByZWZpeGVzKVxuICogZGlzdGluZ3Vpc2hlcyBzZXBhcmF0ZSByZXBvcyBhbmQgd29ya3RyZWVzIGFuZCBpcyByb2J1c3QgdG8gc3ltbGlua3MuIEZhaWxcbiAqIGNsb3NlZDogaWYgdGhlIENXRCByZXBvIGNhbid0IGJlIHJlc29sdmVkLCB0aGUgdG91Y2ggaXMgZHJvcHBlZCByYXRoZXIgdGhhblxuICogZmFsbGluZyBiYWNrIHRvIHRoZSBmaWxlJ3Mgb3duIHJlcG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlVG91Y2hTY29wZShjd2Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogVG91Y2hTY29wZSB8IG51bGwge1xuICBjb25zdCBjd2RSZXBvUm9vdCA9IGN3ZCA/IHJlc29sdmVSZXBvUm9vdChjd2QpIDogbnVsbDtcbiAgaWYgKCFjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgYWJzRGlyID0gdG9Qb3NpeChub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKTtcbiAgY29uc3QgZmlsZVJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGFic0Rpcik7XG4gIGlmIChmaWxlUmVwb1Jvb3QgIT09IGN3ZFJlcG9Sb290KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCByZXBvUm9vdCA9IGN3ZFJlcG9Sb290O1xuICBjb25zdCByZXBvUmVsUGF0aCA9IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhYnNQYXRoKTtcblxuICAvLyBTa2lwIGdpdGlnbm9yZWQgZmlsZXMgZW50aXJlbHkuIEJ1aWxkIG91dHB1dCwgY2FjaGVzLCBhbmQgbG9ncyBhcmUgbm90XG4gIC8vIHNwYW4tcmVsZXZhbnQ6IHRoZXkgbXVzdCBuZXZlciBzdXJmYWNlIHNwYW4gb3ZlcmxhcHMuXG4gIGlmIChpc0dpdElnbm9yZWQocmVwb1Jvb3QsIHJlcG9SZWxQYXRoKSkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU2tpcCBzcGFuIGRvY3VtZW50cyBlbnRpcmVseS4gRmlsZXMgdW5kZXIgdGhlIHJlc29sdmVkIHNwYW4gcm9vdCBhcmUgbWFuYWdlZFxuICAvLyBieSBnaXQgc3BhbiBpdHNlbGYgYW5kIGFyZSBub3QgYXBwbGljYXRpb24gc291cmNlcyB0aGF0IG5lZWQgc3BhbiBjb3ZlcmFnZS5cbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICBpZiAoaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aCwgc3BhblJvb3QpKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4geyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTdXJmYWNlIHJvdXRpbmVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogSW5qZWN0ZWQgZGVwZW5kZW5jaWVzIGZvciB7QGxpbmsgc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnN9LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdXJmYWNlRGVwcyB7XG4gIGV4ZWN1dG9yOiBTcGFuRXhlY3V0b3I7XG4gIHN0YWxlRXhlY3V0b3I6IFN0YWxlRXhlY3V0b3I7XG4gIG1lbW86IE1lbW9TdG9yZTtcbiAgbG9hZFJ1bGVzOiBIb29rSWdub3JlTG9hZGVyO1xuICBsb2dnZXI6IENvcmVMb2dnZXI7XG59XG5cbi8qKlxuICogR2l2ZW4gYSByZXBvLXJlbGF0aXZlIHBhdGggYW5kIHRoZSBsaW5lIHJhbmdlIGJlaW5nIHRvdWNoZWQgd2l0aGluIGFuXG4gKiBhbHJlYWR5LXJlc29sdmVkIHJlcG8sIHByb2R1Y2UgdGhlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gIGJsb2NrIGZvciB0aGVcbiAqIHNwYW5zIG92ZXJsYXBwaW5nIHRoYXQgcmFuZ2UsIG9yIG51bGwgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHRvIHN1cmZhY2UuXG4gKlxuICogVGhlIHBpcGVsaW5lOiBgZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5gIFx1MjE5MiBrZWVwIGxpbmUtcmFuZ2VkIGFuY2hvcnMgb25cbiAqIHRoZSBzYW1lIGZpbGUgdGhhdCBpbnRlcnNlY3QgdGhlIHJhbmdlIGFuZCBhcmUgbm90IGAuaG9va2lnbm9yZWAtc3VwcHJlc3NlZCBcdTIxOTJcbiAqIGRyb3Agc2x1Z3MgYWxyZWFkeSBzdXJmYWNlZCB0aGlzIHNlc3Npb24gKG1lbW8pIFx1MjE5MiByZW5kZXIgYGdpdCBzcGFuIGxpc3RcbiAqIDxuYW1lc1x1MjAyNj5gIFx1MjE5MiBhcHBlbmQgYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIgZm9yIGFueSBhbHJlYWR5LXN0YWxlXG4gKiBzcGFuLiBPbiBzdWNjZXNzIHRoZSBzdXJmYWNlZCBuYW1lcyBhcmUgcmVjb3JkZWQgaW4gdGhlIG1lbW8uIEV4ZWN1dG9yIGFuZFxuICogc3RhbGUtcHJvYmUgZmFpbHVyZXMgYXJlIGxvZ2dlZCBhbmQgZGVncmFkZSB0byBudWxsIC8gdGhlIHBsYWluIGJsb2NrOyB0aGV5XG4gKiBuZXZlciB0aHJvdy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zKFxuICBkZXBzOiBTdXJmYWNlRGVwcyxcbiAgcmVwb1Jvb3Q6IHN0cmluZyxcbiAgcmVwb1JlbFBhdGg6IHN0cmluZyxcbiAgcmFuZ2U6IExpbmVSYW5nZSxcbiAgc2Vzc2lvbklkOiBzdHJpbmdcbik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCB7IGV4ZWN1dG9yLCBzdGFsZUV4ZWN1dG9yLCBtZW1vLCBsb2FkUnVsZXMsIGxvZ2dlciB9ID0gZGVwcztcblxuICAvLyBGaWx0ZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5cbiAgbGV0IHBvcmNlbGFpblN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHBvcmNlbGFpblN0ZG91dCA9IGV4ZWN1dG9yKFsnLS1wb3JjZWxhaW4nLCByZXBvUmVsUGF0aF0sIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBQYXRoLXNjb3BlZCBzdXBwcmVzc2lvbjogYSByZXBvJ3MgLnNwYW4vLmhvb2tpZ25vcmUgY2FuIGhvbGQgYmFjayBzcGFuIHNsdWdcbiAgLy8gcHJlZml4ZXMgZm9yIGFuY2hvcnMgdW5kZXIgZ2l2ZW4gcGF0aHMuIEEgc3VwcHJlc3NlZCBzcGFuIGlzIG5ldmVyIHN1cmZhY2VkLlxuICBjb25zdCBpZ25vcmVSdWxlcyA9IGxvYWRSdWxlcyhyZXBvUm9vdCk7XG5cbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBwYXJzZVBvcmNlbGFpbihwb3JjZWxhaW5TdGRvdXQpO1xuICBjb25zdCBjYW5kaWRhdGVOYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgaWYgKHJvdy5wYXRoICE9PSByZXBvUmVsUGF0aCkgY29udGludWU7XG4gICAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSBjb250aW51ZTsgLy8gd2hvbGUtZmlsZSBhbmNob3JcbiAgICBpZiAoIXJhbmdlc0ludGVyc2VjdChyYW5nZSwgeyBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfSkpIGNvbnRpbnVlO1xuICAgIGlmIChpc1NwYW5TdXBwcmVzc2VkKGlnbm9yZVJ1bGVzLCByb3cucGF0aCwgcm93Lm5hbWUpKSBjb250aW51ZTtcbiAgICBjYW5kaWRhdGVOYW1lcy5hZGQocm93Lm5hbWUpO1xuICB9XG5cbiAgaWYgKGNhbmRpZGF0ZU5hbWVzLnNpemUgPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFN1YnRyYWN0IGFscmVhZHktc3VyZmFjZWQgbmFtZXNcbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gIGNvbnN0IHRvU3VyZmFjZSA9IFsuLi5jYW5kaWRhdGVOYW1lc10uZmlsdGVyKChuKSA9PiAhc3VyZmFjZWQuaGFzKG4pKS5zb3J0KCk7XG4gIGlmICh0b1N1cmZhY2UubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBSZW5kZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8bmFtZTE+IDxuYW1lMj4gLi4uXG4gIGxldCByZW5kZXJTdGRvdXQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICByZW5kZXJTdGRvdXQgPSBleGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgKHJlbmRlcikgZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBPZiB0aGUgc3BhbnMgYmVpbmcgc3VyZmFjZWQsIGZsYWcgYW55IGFscmVhZHkgc3RhbGUgXHUyMDE0IHRoZSB0b3VjaGVkIGxpbmVzIGhhdmVcbiAgLy8gZHJpZnRlZCBmcm9tIHRoZWlyIGFuY2hvcmVkIHN0YXRlIFx1MjAxNCB3aXRoIGEgYGdpdCBzcGFuIGhpc3RvcnkgPG5hbWU+YCBwb2ludGVyLlxuICAvLyBEZXRlY3Rpb24gaXMgYXMtb2Ytbm93IChzdXJmYWNpbmcgcnVucyBiZWZvcmUgdGhlIGVkaXQgYXBwbGllcyksIHNvIHRoaXNcbiAgLy8gY2F0Y2hlcyBwcmUtZXhpc3RpbmcgZHJpZnQ7IGRyaWZ0IHRoaXMgc2Vzc2lvbiBjYXVzZXMgaXMgdGhlIFN0b3AgaG9vaydzIGpvYi5cbiAgLy8gRmFpbHVyZSB0byBjb21wdXRlIHN0YWxlbmVzcyBpcyBub24tZmF0YWw6IGZhbGwgYmFjayB0byB0aGUgcGxhaW4gYmxvY2suXG4gIGxldCBzdGFsZUhpbnQgPSAnJztcbiAgdHJ5IHtcbiAgICBjb25zdCBzdGFsZU5hbWVzID0gbmV3IFNldChwYXJzZVN0YWxlUG9yY2VsYWluKHN0YWxlRXhlY3V0b3IodG9TdXJmYWNlLCByZXBvUm9vdCkpLm1hcCgocikgPT4gci5uYW1lKSk7XG4gICAgY29uc3Qgc3RhbGVTdXJmYWNlZCA9IHRvU3VyZmFjZS5maWx0ZXIoKG4pID0+IHN0YWxlTmFtZXMuaGFzKG4pKTtcbiAgICBpZiAoc3RhbGVTdXJmYWNlZC5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBsaW5lcyA9IHN0YWxlU3VyZmFjZWQubWFwKChuKSA9PiBgICBnaXQgc3BhbiBoaXN0b3J5ICR7bn1gKS5qb2luKCdcXG4nKTtcbiAgICAgIHN0YWxlSGludCA9IGBcXG5TdGFsZSBcdTIwMTQgdGhlIGxpbmVzIHlvdSdyZSB0b3VjaGluZyBoYXZlIGRyaWZ0ZWQgZnJvbSB0aGVzZSBzcGFucycgYW5jaG9yZWQgc3RhdGUuIFJldmlldyBob3cgZWFjaCBzdWJzeXN0ZW0gZXZvbHZlZCBiZWZvcmUgY2hhbmdpbmcgaXQ6XFxuJHtsaW5lc31gO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIHN0YWxlIChoaXN0b3J5IGhpbnQpIGZhaWxlZCcsIHsgZXJyIH0pO1xuICB9XG5cbiAgY29uc3Qgd3JhcHBlZCA9IGBcXG48Z2l0LXNwYW4+XFxuJHtyZW5kZXJTdGRvdXR9JHtzdGFsZUhpbnR9XFxuPC9naXQtc3Bhbj5cXG5gO1xuXG4gIC8vIFVwZGF0ZSBtZW1vXG4gIG1lbW8uYWRkU3VyZmFjZWQoc2Vzc2lvbklkLCB0b1N1cmZhY2UpO1xuXG4gIHJldHVybiB3cmFwcGVkO1xufVxuIiwgIi8qKlxuICogUGF0aC1zY29wZWQgc3BhbiBzdXBwcmVzc2lvbiBmb3IgdGhlIGFnZW50IGhvb2tzLlxuICpcbiAqIFNvbWUgc3BhbnMgYXJlIG5vaXNlIHdoZW4gYnJvd3NpbmcgY2VydGFpbiBwYXJ0cyBvZiB0aGUgdHJlZSBcdTIwMTQgd2lraSBvclxuICogbWFya2V0aW5nIHNwYW5zIHRoYXQgYW5jaG9yIHByb3NlLCBzdXJmYWNlZCBpbmxpbmUgd2hpbGUgcmVhZGluZyBzb3VyY2UsXG4gKiBhZGQgbGl0dGxlLiBUaGlzIG1vZHVsZSBsZXRzIGEgcmVwbyBkZWNsYXJlLCBwZXIgcGF0aCwgd2hpY2ggc3BhbiBzbHVnXG4gKiBwcmVmaXhlcyB0byBob2xkIGJhY2suXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5ob29raWdub3JlYC4gRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGFcbiAqIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4sIGEgc2luZ2xlIHJ1biBvZiB3aGl0ZXNwYWNlLCB0aGVuIGFcbiAqIGNvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHNwYW4gc2x1ZyBwcmVmaXhlcyB0byBzdXBwcmVzcyBmb3IgcGF0aHMgdGhlIHBhdHRlcm5cbiAqIG1hdGNoZXM6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMgd2lraSxtYXJrZXRpbmdcbiAqXG4gKiBBIHNwYW4gd2hvc2Ugc2x1ZyBiZWdpbnMgd2l0aCBgd2lraWAgb3IgYG1hcmtldGluZ2AgKHRoZSBzbHVnIGVxdWFscyB0aGVcbiAqIHByZWZpeCwgb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmApIGlzIHRoZW4gbmV2ZXIgc3VyZmFjZWQgZm9yIGFuIGFuY2hvciB3aG9zZSBwYXRoXG4gKiBzaXRzIHVuZGVyIGBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmNgIFx1MjAxNCBpdCBpcyBuZXZlciBzdXJmYWNlZCBpbiB0aGUgaW5saW5lXG4gKiBgPGdpdC1zcGFuPmAgYmxvY2sgdGhlIGBQb3N0VG9vbFVzZWAgdG91Y2ggaG9vayBlbWl0cy4gSXQgaGFzIG5vIGVmZmVjdCBvblxuICogdGhlIGBQcmVUb29sVXNlYCBhZHZpc29yLCB3aG9zZSBvd24gdW5jb3ZlcmVkLXdyaXRlcyBzdXBwcmVzc2lvbiBsaXZlcyBpblxuICogYC5zcGFuLy5hZHZpc29yaWdub3JlYCAoc2VlIGBhZHZpc29yLWlnbm9yZS50c2ApLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmFkdmlzb3JpZ25vcmVgXG4gKiBpbiBgYWR2aXNvci1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIEhhcm5lc3MtYWdub3N0aWMgdG91Y2gtaG9vayBjb3JlLlxuICpcbiAqIFRoaXMgbW9kdWxlIGltcGxlbWVudHMgdGhlIFBvc3RUb29sVXNlIFwidG91Y2ggc2lnbmFsXCIgdGhhdCBib3RoIHRoZSBDbGF1ZGVcbiAqIChgUmVhZHxFZGl0fFdyaXRlYCkgYW5kIENvZGV4IChgYXBwbHlfcGF0Y2hgKSBhZGFwdGVycyBkcml2ZS4gSXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICoge0BsaW5rIFRvdWNoSW5wdXR9LCBpbmplY3QgZXhlY3V0aW9uL3N0YXRlIGRlcGVuZGVuY2llcywgYW5kIHdyYXAgdGhlIHJldHVybmVkXG4gKiB7QGxpbmsgVG91Y2hPdXRwdXR9IGluIHRoZWlyIG93biBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBSZXVzZWQgZnJvbSB0aGUgc2hhcmVkIGtlcm5lbCAobm90IHJlZGVmaW5lZCk6IGBpc0RlYnQoKWAgK1xuICogYFBvcmNlbGFpblN0YXR1c2AvYFN0YWxlUG9yY2VsYWluUm93YC9gUG9yY2VsYWluUm93YC9gcGFyc2VQb3JjZWxhaW5gL1xuICogYHBhcnNlU3RhbGVQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpLCBgcmFuZ2VzSW50ZXJzZWN0YCBhbmQgdGhlXG4gKiByZXBvL3NwYW4tcm9vdCBwYXRoIHV0aWxpdGllcyAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYW5kIHRoZSBgTWVtb1N0b3JlYFxuICogY2FkZW5jZSBzdG9yZSAoc3Bhbi1zdXJmYWNlLnRzKS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBodW1hblN0YXR1c0xhYmVsLFxuICBpc0RlYnQsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgdHlwZSBQb3JjZWxhaW5TdGF0dXMsXG4gIHBhcnNlUG9yY2VsYWluLFxuICBwYXJzZVN0YWxlUG9yY2VsYWluLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdCxcbiAgdHlwZSBTdGFsZVBvcmNlbGFpblJvd1xufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBjb2xsYXBzZUJ5UGF0aCwgdHlwZSBSYW5nZUxhYmVsLCByZW5kZXJBbmNob3JUcmVlIH0gZnJvbSAnLi9hbmNob3ItdHJlZS5qcyc7XG5pbXBvcnQgdHlwZSB7IE1lbW9TdG9yZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LWVkaXQgcmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNwbGl0IHdyaXR0ZW4gY29udGVudCBpbnRvIHRoZSBsaW5lcyB0byBsb2NhdGUgb24gZGlzay4gQSBzaW5nbGUgdHJhaWxpbmdcbiAqIG5ld2xpbmUgaXMgZHJvcHBlZCBzbyBgXCJhXFxuYlxcblwiYCBhbmQgYFwiYVxcbmJcImAgbG9jYXRlIGlkZW50aWNhbGx5OyBhbiBlbXB0eVxuICogKG9yIG5ld2xpbmUtb25seSkgd3JpdGUgaGFzIG5vIGxvY2F0YWJsZSBibG9jay5cbiAqL1xuZnVuY3Rpb24gdG9OZWVkbGVMaW5lcyh3cml0dGVuOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCB0cmltbWVkID0gd3JpdHRlbi5lbmRzV2l0aCgnXFxuJykgPyB3cml0dGVuLnNsaWNlKDAsIC0xKSA6IHdyaXR0ZW47XG4gIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICByZXR1cm4gdHJpbW1lZC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgbGluZSByYW5nZSB0aGF0IHdyaXR0ZW4gY29udGVudCBub3cgb2NjdXBpZXMgaW4gdGhlIG9uLWRpc2sgZmlsZSxcbiAqIGZvciBhbmNob3JpbmcgdGhlIHRvdWNoZWQgcmVnaW9uIGFmdGVyIGFuIGVkaXQgaGFzIGFscmVhZHkgYXBwbGllZC5cbiAqXG4gKiBUaGlzIGdlbmVyYWxpemVzIHRoZSBwcmUtZWRpdCBgbG9jYXRlQ2h1bmsoKWAgdGVjaG5pcXVlIGluXG4gKiBbYXBwbHktcGF0Y2gudHNdKC4vcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjL2NvZGV4L2FwcGx5LXBhdGNoLnRzI0wyNTMtTDI4NilcbiAqIChwcmV2aW91c2x5IENvZGV4LW9ubHkpIGludG8gYSBzaGFyZWQgcG9zdC1lZGl0IHByaW1pdGl2ZSBib3RoIGhhcm5lc3NlcyB1c2U6XG4gKiBzcGxpdCBgd3JpdHRlbmAgYW5kIGBvbkRpc2tDb250ZW50YCBpbnRvIGxpbmVzIGFuZCBsb2NhdGUgdGhlIHdyaXR0ZW4gYmxvY2sgYXNcbiAqIGEgY29udGlndW91cyBydW4gaW5zaWRlIHRoZSBvbi1kaXNrIGxpbmVzLlxuICpcbiAqIC0gQSBzaW5nbGUgY29udGlndW91cyBtYXRjaCB5aWVsZHMgaXRzIDEtYmFzZWQgaW5jbHVzaXZlIHtAbGluayBMaW5lUmFuZ2V9LlxuICogLSBXaGVuIHRoZSBibG9jayBpcyBhYnNlbnQsIG9yIGFwcGVhcnMgbW9yZSB0aGFuIG9uY2UgKGNvbnRleHQgdG8gZGlzYW1iaWd1YXRlXG4gKiAgIGlzIG5vdCBhdmFpbGFibGUgcG9zdC1lZGl0KSwgcmVjb3ZlcnkgaXMgYW1iaWd1b3VzIGFuZCB0aGUgcmVzdWx0IGRlZ3JhZGVzXG4gKiAgIHRvIGAnd2hvbGUtZmlsZSdgICh0aGUgc2FtZSBmYWxsYmFjayBgbG9jYXRlQ2h1bmsoKWAgc2lnbmFscyB3aXRoIGBudWxsYCkuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhbiB1bmxvY2F0YWJsZSB3cml0ZSBpcyBhIGAnd2hvbGUtZmlsZSdgIGFuc3dlciwgbm90IGFuIGVycm9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3ZlclJhbmdlKHdyaXR0ZW46IHN0cmluZywgb25EaXNrQ29udGVudDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgY29uc3QgbmVlZGxlID0gdG9OZWVkbGVMaW5lcyh3cml0dGVuKTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG5cbiAgY29uc3QgaGF5c3RhY2sgPSBvbkRpc2tDb250ZW50LnNwbGl0KCdcXG4nKTtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGNvbnN0IHN0YXJ0czogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbGFzdDsgaSsrKSB7XG4gICAgbGV0IG9rID0gdHJ1ZTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IG5lZWRsZS5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGhheXN0YWNrW2kgKyBqXSAhPT0gbmVlZGxlW2pdKSB7XG4gICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob2spIHtcbiAgICAgIHN0YXJ0cy5wdXNoKGkpO1xuICAgICAgaWYgKHN0YXJ0cy5sZW5ndGggPiAxKSBicmVhazsgLy8gZHVwbGljYXRlZCBcdTIxOTIgYW1iaWd1b3VzLCBzdG9wIGVhcmx5XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4geyBzdGFydDogc3RhcnRzWzBdICsgMSwgZW5kOiBzdGFydHNbMF0gKyBuZWVkbGUubGVuZ3RoIH07XG4gIH1cbiAgcmV0dXJuICd3aG9sZS1maWxlJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBpbnB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogV2hpY2ggaGFybmVzcyBldmVudCBmaXJlZCwgYXMgdGhlIHRvdWNoIGNvcmUgc2VlcyBpdC4gVGhlIGNvcmUgYnJhbmNoZXMgb25cbiAqIHRoaXM6IGB3cml0ZWAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlIGFuZCBtYXkgc3VyZmFjZSBhXG4gKiBtZXJnZWQgYmxvY2s7IGByZWFkYCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlIGFuZCBmaWx0ZXJzIHBvc2l0aW9uYWwgc3RhdHVzZXNcbiAqIG91dCBvZiB3aGF0IGl0IHN1cmZhY2VzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEV2ZW50S2luZCA9ICdyZWFkJyB8ICd3cml0ZSc7XG5cbi8qKiBGaWVsZHMgc2hhcmVkIGJ5IGV2ZXJ5IHRvdWNoLCByZWdhcmRsZXNzIG9mIGtpbmQuICovXG5pbnRlcmZhY2UgVG91Y2hJbnB1dEJhc2Uge1xuICAvKiogSGFybmVzcyBzZXNzaW9uIGlkIFx1MjAxNCBrZXlzIHRoZSBwZXItc2Vzc2lvbiBjYWRlbmNlIHtAbGluayBNZW1vU3RvcmV9LiAqL1xuICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFdvcmtpbmcgZGlyZWN0b3J5IHRoZSB0b29sIHJhbiBpbiwgdXNlZCB0byBib3VuZCB0aGUgdG91Y2ggdG8gdGhlIENXRCByZXBvXG4gICAqIHZpYSBgcmVzb2x2ZVRvdWNoU2NvcGUoKWAgYmVmb3JlIGFueSBzcGFuIGludm9jYXRpb24uXG4gICAqL1xuICBjd2Q6IHN0cmluZztcbiAgLyoqIEFic29sdXRlLCBjYW5vbmljYWxpemVkIHBhdGggb2YgdGhlIHRvdWNoZWQgZmlsZS4gKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbn1cblxuLyoqIEEgcmVhZCB0b3VjaCAoQ2xhdWRlIGBSZWFkYCwgb3IgYSByZWFkLXNoYXBlZCBDb2RleCBldmVudCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoUmVhZElucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAncmVhZCc7XG4gIC8qKlxuICAgKiAxLWJhc2VkIHN0YXJ0aW5nIGxpbmUgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBvZmZzZXRgXG4gICAqIGlucHV0LiBgdW5kZWZpbmVkYCB3aGVuIHRoZSByZWFkIGhhZCBubyBgb2Zmc2V0YCAocmVhZHMgZnJvbSBsaW5lIDEpLlxuICAgKi9cbiAgb2Zmc2V0PzogbnVtYmVyO1xuICAvKipcbiAgICogTGluZSBjb3VudCBvZiB0aGUgcmVhZCwgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgYGxpbWl0YCBpbnB1dC5cbiAgICogYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYGxpbWl0YCBcdTIwMTQgc2VlIHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9XG4gICAqIGZvciBob3cgdGhlIHJhbmdlIGlzIGNvbXB1dGVkIGluIHRoYXQgY2FzZS5cbiAgICovXG4gIGxpbWl0PzogbnVtYmVyO1xufVxuXG4vKiogQSB3cml0ZSB0b3VjaCAoQ2xhdWRlIGBFZGl0YC9gV3JpdGVgLCBDb2RleCBgYXBwbHlfcGF0Y2hgKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hXcml0ZUlucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAnd3JpdGUnO1xuICAvKipcbiAgICogVGhlIGNvbnRlbnQganVzdCB3cml0dGVuIHRvIGBmaWxlUGF0aGAsIGZlZCB0byB7QGxpbmsgcmVjb3ZlclJhbmdlfSB0b1xuICAgKiByZS1hbmNob3IgdGhlIHRvdWNoZWQgcmVnaW9uIGFnYWluc3QgdGhlIGhlYWxlZCBvbi1kaXNrIGZpbGUuIEZvciBhXG4gICAqIHdob2xlLWZpbGUgY3JlYXRlIHRoaXMgaXMgdGhlIGVudGlyZSBmaWxlIGJvZHk7IGFuIGVtcHR5IHN0cmluZyBtZWFuc1xuICAgKiBcIm5vIGxvY2F0YWJsZSBibG9ja1wiIGFuZCB0aGUgdG91Y2ggaXMgc2NvcGVkIGZpbGUtd2lkZS5cbiAgICovXG4gIHdyaXR0ZW46IHN0cmluZztcbn1cblxuLyoqIFRoZSBoYXJuZXNzLWFnbm9zdGljIHRvdWNoIHRoZSBjb3JlIGNvbnN1bWVzLiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hJbnB1dCA9IFRvdWNoUmVhZElucHV0IHwgVG91Y2hXcml0ZUlucHV0O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEluamVjdGVkIGV4ZWN1dG9yc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTdHJ1Y3R1cmVkIHJlc3VsdCBvZiBhIHNjb3BlZCBgZ2l0IHNwYW4gc3RhbGUgPGZpbGU+IC0tZml4YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hGaXhSZXN1bHQge1xuICAvKipcbiAgICogV2hldGhlciBgLS1maXhgIHJlLWFuY2hvcmVkIGF0IGxlYXN0IG9uZSBzcGFuIGluIHRoZSB3b3JraW5nIHRyZWUuIERyaXZlc1xuICAgKiB7QGxpbmsgVG91Y2hPdXRwdXQudHJlZU1vZGlmaWVkfSBzbyBhIGNhbGxlci90ZXN0IGNhbiBhc3NlcnQgdGhlIGhlYWxpbmdcbiAgICogaGFwcGVuZWQgd2l0aG91dCBkaWZmaW5nIHRoZSB0cmVlIGl0c2VsZi5cbiAgICovXG4gIG1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gc3RhbGUgPGZpbGU+IC0tZml4YCBzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSAod3JpdGUgcGF0aFxuICogb25seSksIHJlcG9ydGluZyB3aGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIGhlYWxlZC4gQXN5bmMgc28gdGhlIGV2ZW50dWFsXG4gKiBpbXBsZW1lbnRhdGlvbiBhbmQgaXRzIHRlc3RzIGNhbiBpbmplY3QgYSBmYWtlIHdpdGhvdXQgYSByZWFsIHN1YnByb2Nlc3MuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRml4RXhlY3V0b3IgPSAoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8VG91Y2hGaXhSZXN1bHQ+O1xuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiA8ZmlsZT5gIGFuZCByZXR1cm4gaXRzIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyXG4gKiBhbmNob3IgY292ZXJpbmcgdGhlIGZpbGUuIFN0cnVjdHVyZWQgKG5vdCByYXcgc3Rkb3V0KSBzbyB0aGUgbWVyZ2VkLWJsb2NrXG4gKiBjb21wdXRhdGlvbiBhbmQgaXRzIHRlc3RzIHNoYXJlIHRoZSBzYW1lIHNoYXBlLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaExpc3RFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW4gPGFyZ3M+YCAoc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgb3JcbiAqIGl0cyBzcGFucykgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXIgZHJpZnRlZCBhbmNob3IsIGVtcHR5IHdoZW5cbiAqIGNsZWFuLiBTdGF0dXMgY2xhc3NpZmljYXRpb24gaXMgdmlhIGBpc0RlYnQoKWA7IHBvc2l0aW9uYWwgKGBNT1ZFRGAsXG4gKiBgUkVTT0xWRURfUEVORElOR19DT01NSVRgKSByb3dzIGFyZSBuZXZlciBkZWJ0LlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFN0YWxlRXhlY3V0b3IgPSAoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFN0YWxlUG9yY2VsYWluUm93W10+O1xuXG4vKipcbiAqIFJ1biBiYXJlIGBnaXQgc3BhbiB3aHkgPG5hbWU+YCBhbmQgcmV0dXJuIHRoZSBzcGFuJ3MgcmVjb3JkZWQgd2h5IHNlbnRlbmNlLFxuICogb3IgYG51bGxgIHdoZW4gbm9uZSBpcyByZWNvcmRlZCBvciB0aGUgcmVhZCBmYWlscy4gRmVlZHMgdGhlIGh1bWFuLWZvcm1hdFxuICogc3BhbiByZW5kZXI7IGludm9rZWQgb25seSBmb3Igc3BhbnMgYWN0dWFsbHkgYmVpbmcgc3VyZmFjZWQgdGhpcyB0b3VjaC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hXaHlFeGVjdXRvciA9IChuYW1lOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xuXG4vKipcbiAqIFRoZSBpbmplY3RlZCBleGVjdXRpb24gc3VyZmFjZS4gS2VwdCBhcyBmb3VyIG5hcnJvdyBhc3luYyBmdW5jdGlvbnMgKHJhdGhlclxuICogdGhhbiBhIHJhdyBjb21tYW5kIHJ1bm5lcikgc28gdGVzdHMgaW5qZWN0IGZha2VzIHJldHVybmluZyBzdHJ1Y3R1cmVkIGRhdGFcbiAqIGFuZCB0aGUgY29yZSBuZXZlciBzcGF3bnMgYSBzdWJwcm9jZXNzIGl0c2VsZi4gVGhlIGByZWFkYCBwYXRoIG5ldmVyIGludm9rZXNcbiAqIGBmaXhgLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoRXhlY3V0b3JzIHtcbiAgZml4OiBUb3VjaEZpeEV4ZWN1dG9yO1xuICBsaXN0OiBUb3VjaExpc3RFeGVjdXRvcjtcbiAgc3RhbGU6IFRvdWNoU3RhbGVFeGVjdXRvcjtcbiAgd2h5OiBUb3VjaFdoeUV4ZWN1dG9yO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIG91dHB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGF0IHRoZSBjb3JlIGhhbmRzIGJhY2sgZm9yIHRoZSBhZGFwdGVyIHRvIHRyYW5zbGF0ZSBpbnRvIFNESyBvdXRwdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoT3V0cHV0IHtcbiAgLyoqXG4gICAqIFRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIChoZWFkZXIsIG9uZSBodW1hbi1mb3JtYXQgc2VjdGlvbiBwZXJcbiAgICogc3VyZmFjZWQgc3BhbiwgZm9vdGVyKSB0byBpbmplY3QgdmlhIHRoZSBoYXJuZXNzJ3MgYGFkZGl0aW9uYWxDb250ZXh0YCxcbiAgICogb3IgYG51bGxgIHdoZW4gdGhlcmUgaXMgbm90aGluZyB3b3J0aCBzdXJmYWNpbmcgdGhpcyB0b3VjaC5cbiAgICovXG4gIGFkZGl0aW9uYWxDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgd29ya2luZyB0cmVlIHdhcyBtb2RpZmllZCBieSBhIHNjb3BlZCBgLS1maXhgIG9uIHRoZSB3cml0ZSBwYXRoLlxuICAgKiBBbHdheXMgYGZhbHNlYCBvbiB0aGUgcmVhZCBwYXRoIChyZWFkcyBuZXZlciBtdXRhdGUgdGhlIHRyZWUpLlxuICAgKi9cbiAgdHJlZU1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1lcmdlZC1ibG9jayBhc3NlbWJseVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgbWVtbyBrZXkgdW5kZXIgd2hpY2ggYSBzcGFuJ3MgcmVuZGVyIGZvciBhIGdpdmVuIGRyaWZ0IHN0YXR1cyBpcyBkZWR1cGVkLiAqL1xuZnVuY3Rpb24gZHJpZnRLZXkobmFtZTogc3RyaW5nLCBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIC8vIFNwYW4gbmFtZXMgY29tZSBmcm9tIHRhYi1kZWxpbWl0ZWQgcG9yY2VsYWluLCBzbyB0aGV5IG5ldmVyIGNvbnRhaW4gYSB0YWI7XG4gIC8vIGEgdGFiLWpvaW5lZCBrZXkgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCBhIGJhcmUgc3BhbiBuYW1lICh0aGUgc3VyZmFjaW5nIGtleSkuXG4gIHJldHVybiBgJHtuYW1lfVxcdCR7c3RhdHVzfWA7XG59XG5cbi8qKiBUaGUgYHBhdGgjTHN0YXJ0LUxlbmRgIChvciBiYXJlLXBhdGgsIHdob2xlLWZpbGUpIGFuY2hvciB0ZXh0IGZvciBhIHJvdy4gKi9cbmZ1bmN0aW9uIGFuY2hvclRleHQocm93OiBQb3JjZWxhaW5Sb3cpOiBzdHJpbmcge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiByb3cucGF0aDtcbiAgcmV0dXJuIGAke3Jvdy5wYXRofSNMJHtyb3cuc3RhcnR9LUwke3Jvdy5lbmR9YDtcbn1cblxuZnVuY3Rpb24gY2xlYW5IZWFkZXIoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJHtmaWxlTmFtZX0gaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llczpgO1xufVxuXG5mdW5jdGlvbiBjbGVhbkZvb3RlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBJZiB5b3UgY2hhbmdlICR7ZmlsZU5hbWV9IGNoZWNrIHRoZSBvdGhlciBmaWxlcyB0byBjb25maXJtIHRoZXkgc3RpbGwgd29yayB0b2dldGhlci5gO1xufVxuXG4vKipcbiAqIFRoZSB3cml0ZSBwYXRoIG5hbWVzIHRoZSBlZGl0IGFzIHRoZSBjYXVzZTsgdGhlIHJlYWQgcGF0aCBvbmx5IHN1cmZhY2VzXG4gKiBwcmUtZXhpc3RpbmcgZHJpZnQgaXQgZGlkbid0IGNyZWF0ZSwgc28gaXQgbmFtZXMgdGhlIGRlcGVuZGVuY3kgaW5zdGVhZC5cbiAqL1xuZnVuY3Rpb24gZHJpZnRIZWFkZXIoZHJpZnRlZENvdW50OiBudW1iZXIsIGtpbmQ6IFRvdWNoSW5wdXRbJ2tpbmQnXSk6IHN0cmluZyB7XG4gIGlmIChraW5kID09PSAnd3JpdGUnKSB7XG4gICAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgICAgPyAnVGhpcyBlZGl0IHB1dCBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICAgIDogJ1RoaXMgZWRpdCBwdXQgaW1wbGljaXQgZGVwZW5kZW5jaWVzIG91dCBvZiBkYXRlOic7XG4gIH1cbiAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgID8gJ1RoaXMgZmlsZSBoYXMgYW4gaW1wbGljaXQgZGVwZW5kZW5jeSBvdXQgb2YgZGF0ZTonXG4gICAgOiAnVGhpcyBmaWxlIGhhcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6Jztcbn1cblxuZnVuY3Rpb24gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIGlmIChkcmlmdGVkTmFtZXMubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgbmFtZSA9IGRyaWZ0ZWROYW1lc1swXTtcbiAgICByZXR1cm4gYFJlc3RvcmUgYWdyZWVtZW50IGFjcm9zcyB0aGUgYW5jaG9ycyBiZWZvcmUgY29tbWl0dGluZyBcdTIwMTQgZG9jcyBmb2xsb3cgZGVsaWJlcmF0ZWx5IGNvbW1pdHRlZCBjb2RlIFx1MjAxNCB0aGVuIHJlZnJlc2g6IFxcYGdpdCBzcGFuIGFkZCAke25hbWV9IDxwYXRoI0xzdGFydC1MZW5kPlxcYCAvIFxcYGdpdCBzcGFuIHdoeSAke25hbWV9IFwiLi4uXCJcXGAgXHUyMDE0IGFuZCBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycyBmb3Iga25vY2stb24gY2hhbmdlcy4gSWYgdGhlIGZpeCBuZWVkcyBhIGNvZGUgY2hhbmdlIG9yIHRoZSBjb3VwbGluZyBubyBsb25nZXIgaG9sZHMsIHRlbGwgdGhlIHVzZXIgaW5zdGVhZC5gO1xuICB9XG4gIHJldHVybiAnRm9yIGVhY2ggb3V0LW9mLWRhdGUgc3BhbiBhYm92ZTogcmVzdG9yZSBhZ3JlZW1lbnQgYWNyb3NzIHRoZSBhbmNob3JzIGJlZm9yZSBjb21taXR0aW5nIFx1MjAxNCBkb2NzIGZvbGxvdyBkZWxpYmVyYXRlbHkgY29tbWl0dGVkIGNvZGUgXHUyMDE0IHRoZW4gcmVmcmVzaDogYGdpdCBzcGFuIGFkZCA8bmFtZT4gPHBhdGgjTHN0YXJ0LUxlbmQ+YCAvIGBnaXQgc3BhbiB3aHkgPG5hbWU+IFwiLi4uXCJgIFx1MjAxNCBhbmQgY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMgZm9yIGtub2NrLW9uIGNoYW5nZXMuIElmIGEgZml4IG5lZWRzIGEgY29kZSBjaGFuZ2Ugb3IgYSBjb3VwbGluZyBubyBsb25nZXIgaG9sZHMsIHRlbGwgdGhlIHVzZXIgaW5zdGVhZC4nO1xufVxuXG4vKiogVGhlIHtAbGluayBSYW5nZUxhYmVsfSBmb3IgYSBwb3JjZWxhaW4gcm93IFx1MjAxNCBgMC0wYCBpcyB0aGUgd2hvbGUtZmlsZSBhbmNob3IuICovXG5mdW5jdGlvbiByYW5nZUxhYmVsKHJvdzogUG9yY2VsYWluUm93KTogUmFuZ2VMYWJlbCB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHsga2luZDogJ3dob2xlLWZpbGUnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdyYW5nZScsIHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9O1xufVxuXG4vKipcbiAqIEEgc3BhbidzIGZ1bGwgYW5jaG9yIGxpc3QsIHJlbmRlcmVkIGFzIGEgc2hhcmVkLXByZWZpeCB0cmVlIGJ5XG4gKiB7QGxpbmsgcmVuZGVyQW5jaG9yVHJlZX0sIHdpdGggZWFjaCBhbmNob3IgdGhhdCBjYXJyaWVzIGdlbnVpbmUgZHJpZnRcbiAqIHN1ZmZpeGVkIGJ5IGl0cyBsb3dlcmNhc2Ugc3RhdHVzIHRva2VuKHMpIChgIFx1MjAxNCBjaGFuZ2VkYCkuXG4gKlxuICogQSBkcmlmdCByb3cgbWF0Y2hlcyBhbiBhbmNob3IgYnkgZXhhY3QgcGF0aCtyYW5nZSwgb3IgYnkgcGF0aCBhbG9uZSB3aGVuIHRoZVxuICogc3BhbiBoYXMgYSBzaW5nbGUgYW5jaG9yIG9uIHRoYXQgcGF0aCAocmFuZ2VzIGNhbiBkaXNhZ3JlZSBhZnRlciBhIGhlYWwpLlxuICogYHNvbGVPblBhdGhgIGlzIGRlbGliZXJhdGVseSBjb21wdXRlZCBvdmVyIHRoZSAqKmZ1bGwgZmxhdCBhbmNob3IgbGlzdCoqLFxuICogYmVmb3JlIGFueSBncm91cGluZyBcdTIwMTQgdGhlIHRyZWUgbGF5b3V0IG11c3QgbmV2ZXIgYmUgYWJsZSB0byBjaGFuZ2UgKndoaWNoKlxuICogYW5jaG9ycyBnZXQgbGFiZWxlZCwgb25seSB3aGVyZSB0aGV5IHNpdCBvbiB0aGUgcGFnZS5cbiAqL1xuZnVuY3Rpb24gYW5jaG9yQnVsbGV0cyhhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSwgZGVidFJvd3M6IFN0YWxlUG9yY2VsYWluUm93W10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHJvd3MgPSBhbmNob3JzLm1hcCgoYW5jaG9yKSA9PiB7XG4gICAgY29uc3Qgc29sZU9uUGF0aCA9IGFuY2hvcnMuZmlsdGVyKChhKSA9PiBhLnBhdGggPT09IGFuY2hvci5wYXRoKS5sZW5ndGggPT09IDE7XG4gICAgY29uc3Qgc3RhdHVzZXMgPSBuZXcgU2V0PFBvcmNlbGFpblN0YXR1cz4oKTtcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBkZWJ0Um93cykge1xuICAgICAgaWYgKHJvdy5wYXRoICE9PSBhbmNob3IucGF0aCkgY29udGludWU7XG4gICAgICBpZiAoc29sZU9uUGF0aCB8fCAocm93LnN0YXJ0ID09PSBhbmNob3Iuc3RhcnQgJiYgcm93LmVuZCA9PT0gYW5jaG9yLmVuZCkpIHtcbiAgICAgICAgc3RhdHVzZXMuYWRkKHJvdy5zdGF0dXMpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4uc3RhdHVzZXNdLnNvcnQoKTtcbiAgICBjb25zdCBzdWZmaXggPSBzb3J0ZWQubGVuZ3RoID4gMCA/IGAgXHUyMDE0ICR7c29ydGVkLm1hcChodW1hblN0YXR1c0xhYmVsKS5qb2luKCcsICcpfWAgOiAnJztcbiAgICByZXR1cm4geyBwYXRoOiBhbmNob3IucGF0aCwgcmFuZ2U6IHJhbmdlTGFiZWwoYW5jaG9yKSwgc3VmZml4IH07XG4gIH0pO1xuICB0cnkge1xuICAgIHJldHVybiByZW5kZXJBbmNob3JUcmVlKGNvbGxhcHNlQnlQYXRoKHJvd3MpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRkFJTC1DTE9TRUQsIG5vdCBhIGA8Z3JlZW5maWVsZD5gLWZvcmJpZGRlbiBmYWxsYmFjayBcdTIwMTQgZG8gbm90IHJlbW92ZSBpdFxuICAgIC8vIG9uIHRoZSB0aGVvcnkgdGhhdCBhIGRlZ3JhZGVkIGZhbGxiYWNrIGlzIGl0c2VsZiBmb3JiaWRkZW4uIEFuIHVuY2F1Z2h0XG4gICAgLy8gdGhyb3cgaGVyZSBkb2VzIG5vdCBkZWdyYWRlIHRvIGEgZmxhdCBsaXN0OiBpdCBlc2NhcGVzIHRvXG4gICAgLy8gYHJ1blRvdWNoSG9va2AncyBjYXRjaCwgd2hpY2ggcmVzb2x2ZXMgdGhlIHdob2xlIGhvb2sgdG9cbiAgICAvLyBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgLCBzbyB0aGUgYWdlbnQgaXMgbmV2ZXIgdG9sZCBhYm91dCB0aGUgZHJpZnQgYXRcbiAgICAvLyBhbGwuIENhdGNoaW5nIGxvY2FsbHkgbmFycm93cyB3aGF0IGEgcmVuZGVyaW5nIGRlZmVjdCBjYW4gY29zdCBmcm9tIFwidGhlXG4gICAgLy8gcmVtaW5kZXIgZGlzYXBwZWFyc1wiIHRvIFwidGhlIHJlbWluZGVyIGxvb2tzIGxpa2UgaXQgZGlkIGJlZm9yZSB0aGUgdHJlZVwiLlxuICAgIC8vIFdoZXRoZXIgdG8gc3VyZmFjZSBhbmQgd2hhdCBzaGFwZSB0byBzdXJmYWNlIGluIGFyZSBkaWZmZXJlbnQgdGhpbmdzLCBhbmRcbiAgICAvLyB0aGlzIGNhdGNoIG9ubHkgZXZlciB0b3VjaGVzIHRoZSBsYXR0ZXIuXG4gICAgLy8gYHJvd3NgIGlzIGluZGV4LWFsaWduZWQgd2l0aCBgYW5jaG9yc2AsIHNvIHRoaXMgcmVwcm9kdWNlcyB0b2RheSdzIGZsYXRcbiAgICAvLyBidWxsZXQgcnVuIGJ5dGUgZm9yIGJ5dGUsIHN1ZmZpeGVzIGluY2x1ZGVkLlxuICAgIHJldHVybiBhbmNob3JzLm1hcCgoYW5jaG9yLCBpKSA9PiBgLSAke2FuY2hvclRleHQoYW5jaG9yKX0ke3Jvd3NbaV0uc3VmZml4fWApO1xuICB9XG59XG5cbi8qKlxuICogT25lIGh1bWFuLWZvcm1hdCBzcGFuIHNlY3Rpb246IGAjIyA8bmFtZT5gLCB0aGUgZnVsbCBhbmNob3IgbGlzdCAoZHJpZnRlZFxuICogYW5jaG9ycyBzdGF0dXMtc3VmZml4ZWQpLCBhbmQgdGhlIHdoeSBzZW50ZW5jZSB3aGVuIG9uZSBpcyByZWNvcmRlZC5cbiAqXG4gKiBUaGUgbmFtZSBoZWFkZXIgYW5kIHRoZSB3aHkgc2VudGVuY2UgYXJlIHRoZSBzYW1lIHNoYXBlIGBnaXQgc3BhbiBsaXN0YFxuICogcmVuZGVyczsgdGhlIGFuY2hvciBsaXN0IGRlbGliZXJhdGVseSBpcyBub3QgXHUyMDE0IGl0IHJlbmRlcnMgYXMgYSBzaGFyZWQtcHJlZml4XG4gKiB0cmVlICh7QGxpbmsgYW5jaG9yQnVsbGV0c30pIHdoZXJlIHRoZSBDTEkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xyYW5nZWBcbiAqIGJ1bGxldCBydW4uIFRoZSBDTEkncyBvd24gdGV4dCBmb3JtYXQgaXMgdW50b3VjaGVkOyBvbmx5IHRoaXMgaG9vaydzXG4gKiByZS1wcmVzZW50YXRpb24gb2YgaXQgZ3JvdXBzLlxuICovXG5mdW5jdGlvbiByZW5kZXJTcGFuU2VjdGlvbihcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSxcbiAgZGVidFJvd3M6IFN0YWxlUG9yY2VsYWluUm93W10sXG4gIHdoeTogc3RyaW5nIHwgbnVsbFxuKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBbYCMjICR7bmFtZX1gLCAuLi5hbmNob3JCdWxsZXRzKGFuY2hvcnMsIGRlYnRSb3dzKV07XG4gIGlmICh3aHkpIGxpbmVzLnB1c2goJycsIHdoeSk7XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBBc3NlbWJsZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jazogaGVhZGVyLCBvbmUgc2VjdGlvbiBwZXIgc3VyZmFjZWRcbiAqIHNwYW4gKHNlcGFyYXRlZCBieSBgLS0tYCksIGFuZCBhIHNpbmdsZSBmb290ZXIgYWZ0ZXIgYSBmaW5hbCBgLS0tYC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRCbG9jayhzZWN0aW9uczogc3RyaW5nW10sIGhlYWRlcjogc3RyaW5nLCBmb290ZXI6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGJvZHkgPSBgJHtoZWFkZXJ9XFxuXFxuJHtzZWN0aW9ucy5qb2luKCdcXG5cXG4tLS1cXG5cXG4nKX1cXG5cXG4tLS1cXG5cXG4ke2Zvb3Rlcn1gO1xuICByZXR1cm4gYFxcbjxnaXQtc3Bhbj5cXG4ke2JvZHl9XFxuPC9naXQtc3Bhbj5cXG5gO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGhvb2sgZW50cnkgcG9pbnRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hldGhlciBhIGNvdmVyaW5nIHJvdyBpcyBpbiBzY29wZSBmb3IgdGhlIHJlY292ZXJlZCByYW5nZS4gKi9cbmZ1bmN0aW9uIGludGVyc2VjdHMocm93OiBQb3JjZWxhaW5Sb3csIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScpOiBib29sZWFuIHtcbiAgaWYgKHJhbmdlID09PSAnd2hvbGUtZmlsZScpIHJldHVybiB0cnVlO1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiB0cnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICByZXR1cm4gcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KTtcbn1cblxuLyoqXG4gKiBSZWNvdmVyIHRoZSB0b3VjaGVkIHJhbmdlIGZyb20gdGhlIG9uLWRpc2sgZmlsZSBmb3IgYSB3cml0ZS4gQW4gZW1wdHkgd3JpdGUgb3JcbiAqIGFuIHVucmVhZGFibGUgZmlsZSAoZS5nLiBhIGRlbGV0ZSwgb3IgdGhlIGZpbGUgd2FzIG5ldmVyIHdyaXR0ZW4pIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCwgc2NvcGluZyB0aGUgdG91Y2ggdG8gZXZlcnkgY292ZXJpbmcgc3BhbiBcdTIwMTQgdGhlIGZhaWwtb3BlblxuICogYmVoYXZpb3IsIG5vdCBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJhbmdlRnJvbURpc2sod3JpdHRlbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgaWYgKHdyaXR0ZW4ubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBsZXQgY29udGVudDogc3RyaW5nO1xuICB0cnkge1xuICAgIGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgcmV0dXJuIHJlY292ZXJSYW5nZSh3cml0dGVuLCBjb250ZW50KTtcbn1cblxuLyoqXG4gKiBUaGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgZG9jdW1lbnRlZCBkZWZhdWx0IGxpbmUgY291bnQgd2hlbiBgb2Zmc2V0YCBpc1xuICogZ2l2ZW4gd2l0aG91dCBgbGltaXRgIChcIkJ5IGRlZmF1bHQsIGl0IHJlYWRzIHVwIHRvIDIwMDAgbGluZXNcIikuIE5hbWVkIHNvXG4gKiB0aGUgYXNzdW1wdGlvbiBpcyB2aXNpYmxlIGFuZCBlYXN5IHRvIHVwZGF0ZSBpZiB0aGF0IGRlZmF1bHQgZXZlciBjaGFuZ2VzLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUFEX0xJTUlUID0gMjAwMDtcblxuLyoqXG4gKiBDb21wdXRlIHRoZSB0b3VjaGVkIHJhbmdlIGZvciBhIHJlYWQgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3NcbiAqIGBvZmZzZXRgL2BsaW1pdGAgaW5wdXRzLiBOZWl0aGVyIHByZXNlbnQgbWVhbnMgYSBnZW51aW5lIHdob2xlLWZpbGUgcmVhZCBcdTIwMTRcbiAqIGV2ZXJ5IGNvdmVyaW5nIHNwYW4gc3RheXMgaW4gc2NvcGUsIG1hdGNoaW5nIHRvZGF5J3MgYmVoYXZpb3IuIE90aGVyd2lzZVxuICogdGhlIHJhbmdlIHN0YXJ0cyBhdCBgb2Zmc2V0YCAoZGVmYXVsdCBsaW5lIDEpIGFuZCBydW5zIGZvciBgbGltaXRgIGxpbmVzXG4gKiAoZGVmYXVsdCB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfSksIGNsYW1wZWQgdG8gdGhlIGZpbGUncyBhY3R1YWwgbGluZVxuICogY291bnQgc28gYSBzaG9ydCBmaWxlIHdpdGggYSBsYXJnZSBgb2Zmc2V0YC9gbGltaXRgIGRvZXNuJ3Qgb3ZlcnNob290LlxuICogQ2xhbXBpbmcgcmVxdWlyZXMgcmVhZGluZyB0aGUgZmlsZTsgYW4gdW5yZWFkYWJsZSBmaWxlIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCBcdTIwMTQgdGhlIHNhbWUgZmFpbC1vcGVuIGJlaGF2aW9yIHRoZSB3cml0ZSBwYXRoIHVzZXMuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSZWFkUmFuZ2UoXG4gIG9mZnNldDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBsaW1pdDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBmaWxlUGF0aDogc3RyaW5nXG4pOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAob2Zmc2V0ID09PSB1bmRlZmluZWQgJiYgbGltaXQgPT09IHVuZGVmaW5lZCkgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgY29uc3Qgc3RhcnQgPSBvZmZzZXQgPz8gMTtcbiAgbGV0IGxpbmVDb3VudDogbnVtYmVyO1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgbGluZUNvdW50ID0gY29udGVudC5sZW5ndGggPT09IDAgPyAwIDogY29udGVudC5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICB9XG4gIGNvbnN0IGVuZCA9IE1hdGgubWluKHN0YXJ0ICsgKGxpbWl0ID8/IERFRkFVTFRfUkVBRF9MSU1JVCkgLSAxLCBNYXRoLm1heChsaW5lQ291bnQsIHN0YXJ0KSk7XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGFuIGFuY2hvciBpbiB0aGUgdG91Y2hlZCBmaWxlIGl0c2VsZi4gYGxpc3RcbiAqIC0tcG9yY2VsYWluIDxmaWxlPmAgcmV0dXJucyBldmVyeSBhbmNob3Igb2YgZWFjaCBtYXRjaGluZyBzcGFuIFx1MjAxNCBjcm9zcy1maWxlXG4gKiBhbmNob3JzIGluY2x1ZGVkIFx1MjAxNCBidXQgb25seSBhbmNob3JzIGluIHRoZSB0b3VjaGVkIGZpbGUgcGFydGljaXBhdGUgaW4gdGhlXG4gKiByYW5nZS1pbnRlcnNlY3Rpb24gc2NvcGUgdGVzdC4gUm93IHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlOyB0aGUgdG91Y2hlZCBwYXRoXG4gKiBpcyBhYnNvbHV0ZSwgc28gbWF0Y2ggb24gYW4gZXhhY3Qgb3IgYC9gLXNlcGFyYXRlZCBzdWZmaXguXG4gKi9cbmZ1bmN0aW9uIG9uVG91Y2hlZEZpbGUocm93OiBQb3JjZWxhaW5Sb3csIGZpbGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGZpbGVQYXRoID09PSByb3cucGF0aCB8fCBmaWxlUGF0aC5lbmRzV2l0aChgLyR7cm93LnBhdGh9YCk7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBmb3IgdGhlIHRvdWNoLCBvciBgbnVsbGAgd2hlbiB0aGVyZSBpc1xuICogbm90aGluZyB3b3J0aCBzdXJmYWNpbmcuIFNoYXJlZCBieSBib3RoIHBhdGhzOyB0aGUgd3JpdGUgcGF0aCBwYXNzZXMgYVxuICogcmVjb3ZlcmVkIHJhbmdlIGZvciBwcmVjaXNpb24sIHRoZSByZWFkIHBhdGggc2NvcGVzIGZpbGUtd2lkZS5cbiAqXG4gKiBBIHNwYW4gcmVuZGVycyBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gKG5hbWUsIGFsbCBhbmNob3JzIHdpdGhcbiAqIGRyaWZ0ZWQgb25lcyBzdGF0dXMtc3VmZml4ZWQsIHdoeSkgd2hlbiBpdHMgbmFtZSBoYXMgbm90IGJlZW4gc3VyZmFjZWQgdGhpc1xuICogc2Vzc2lvbiwgb3Igd2hlbiBpdCBjYXJyaWVzIGEgZHJpZnQgc3RhdHVzIG5vdCB5ZXQgc3VyZmFjZWQgZm9yIGl0IFx1MjAxNCBzbyBhXG4gKiBzcGFuIGZpcnN0IHNlZW4gaGVhbHRoeSByZS1yZW5kZXJzIGluIGZ1bGwgd2hlbiBkcmlmdCBsYXRlciBhcHBlYXJzLiBBIHNwYW5cbiAqIHdob3NlIG9ubHkgZHJpZnQgaXMgcG9zaXRpb25hbCAoYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgIFx1MjAxNCBuZXZlclxuICogYGlzRGVidGApIGlzIGZpbHRlcmVkIG91dCBlbnRpcmVseTogcG9zaXRpb25hbCBkcmlmdCBuZXZlciBzdXJmYWNlcy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY29tcHV0ZVN1cmZhY2UoXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmUsXG4gIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZSdcbik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICBjb25zdCBjb3ZlcmluZyA9IGF3YWl0IGV4ZWN1dG9ycy5saXN0KGlucHV0LmZpbGVQYXRoLCBpbnB1dC5jd2QpO1xuICBpZiAoY292ZXJpbmcubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBHcm91cCBldmVyeSBhbmNob3IgYnkgc3BhbjsgYSBzcGFuIGlzIGluIHNjb3BlIHdoZW4gb25lIG9mIGl0cyBhbmNob3JzIG9uXG4gIC8vIHRoZSB0b3VjaGVkIGZpbGUgaW50ZXJzZWN0cyB0aGUgcmVjb3ZlcmVkIHJhbmdlLlxuICBjb25zdCBhbmNob3JzQnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBjb3ZlcmluZykge1xuICAgIGNvbnN0IHJvd3MgPSBhbmNob3JzQnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgYW5jaG9yc0J5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG4gIGNvbnN0IHRvdWNoZWROYW1lcyA9IFsuLi5hbmNob3JzQnlOYW1lLmtleXMoKV0uZmlsdGVyKChuYW1lKSA9PlxuICAgIChhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSkuc29tZSgocm93KSA9PiBvblRvdWNoZWRGaWxlKHJvdywgaW5wdXQuZmlsZVBhdGgpICYmIGludGVyc2VjdHMocm93LCByYW5nZSkpXG4gICk7XG4gIGlmICh0b3VjaGVkTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBzdGFsZVJvd3MgPSBhd2FpdCBleGVjdXRvcnMuc3RhbGUoW2lucHV0LmZpbGVQYXRoXSwgaW5wdXQuY3dkKTtcbiAgY29uc3Qgc3RhbGVCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgU3RhbGVQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygc3RhbGVSb3dzKSB7XG4gICAgY29uc3Qgcm93cyA9IHN0YWxlQnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgc3RhbGVCeU5hbWUuc2V0KHJvdy5uYW1lLCByb3dzKTtcbiAgfVxuXG4gIGNvbnN0IHN1cmZhY2VkID0gbWVtby5nZXRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQpO1xuICBjb25zdCB0b1JlY29yZDogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc2VjdGlvbnM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGRyaWZ0ZWROYW1lczogc3RyaW5nW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IG5hbWUgb2YgdG91Y2hlZE5hbWVzKSB7XG4gICAgY29uc3Qgc3BhblN0YWxlID0gc3RhbGVCeU5hbWUuZ2V0KG5hbWUpID8/IFtdO1xuICAgIGNvbnN0IGRlYnRSb3dzID0gc3BhblN0YWxlLmZpbHRlcigocm93KSA9PiBpc0RlYnQocm93LnN0YXR1cykpO1xuICAgIGlmIChzcGFuU3RhbGUubGVuZ3RoID4gMCAmJiBkZWJ0Um93cy5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBwb3NpdGlvbmFsLW9ubHkgZHJpZnQgbmV2ZXIgc3VyZmFjZXNcblxuICAgIGNvbnN0IGRlYnRTdGF0dXNlcyA9IFsuLi5uZXcgU2V0KGRlYnRSb3dzLm1hcCgocm93KSA9PiByb3cuc3RhdHVzKSldLnNvcnQoKTtcbiAgICBjb25zdCB1bnN1cmZhY2VkRGVidCA9IGRlYnRTdGF0dXNlcy5maWx0ZXIoKHN0YXR1cykgPT4gIXN1cmZhY2VkLmhhcyhkcmlmdEtleShuYW1lLCBzdGF0dXMpKSk7XG4gICAgY29uc3QgaXNOZXdOYW1lID0gIXN1cmZhY2VkLmhhcyhuYW1lKTtcbiAgICBpZiAoIWlzTmV3TmFtZSAmJiB1bnN1cmZhY2VkRGVidC5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBmdWxseSBzdXJmYWNlZCBhbHJlYWR5XG5cbiAgICBjb25zdCB3aHkgPSBhd2FpdCBleGVjdXRvcnMud2h5KG5hbWUsIGlucHV0LmN3ZCk7XG4gICAgc2VjdGlvbnMucHVzaChyZW5kZXJTcGFuU2VjdGlvbihuYW1lLCBhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSwgZGVidFJvd3MsIHdoeSkpO1xuICAgIGlmIChkZWJ0U3RhdHVzZXMubGVuZ3RoID4gMCkgZHJpZnRlZE5hbWVzLnB1c2gobmFtZSk7XG5cbiAgICBpZiAoaXNOZXdOYW1lKSB0b1JlY29yZC5wdXNoKG5hbWUpO1xuICAgIGZvciAoY29uc3Qgc3RhdHVzIG9mIHVuc3VyZmFjZWREZWJ0KSB0b1JlY29yZC5wdXNoKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpO1xuICB9XG5cbiAgaWYgKHNlY3Rpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIG1lbW8uYWRkU3VyZmFjZWQoaW5wdXQuc2Vzc2lvbklkLCB0b1JlY29yZCk7XG4gIGNvbnN0IGZpbGVOYW1lID0gYmFzZW5hbWUoaW5wdXQuZmlsZVBhdGgpO1xuICBjb25zdCBoZWFkZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0SGVhZGVyKGRyaWZ0ZWROYW1lcy5sZW5ndGgsIGlucHV0LmtpbmQpIDogY2xlYW5IZWFkZXIoZmlsZU5hbWUpO1xuICBjb25zdCBmb290ZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0Rm9vdGVyKGRyaWZ0ZWROYW1lcykgOiBjbGVhbkZvb3RlcihmaWxlTmFtZSk7XG4gIHJldHVybiBidWlsZEJsb2NrKHNlY3Rpb25zLCBoZWFkZXIsIGZvb3Rlcik7XG59XG5cbi8qKlxuICogUnVuIHRoZSB0b3VjaCBob29rIGZvciBhIHNpbmdsZSB0b29sIGNhbGwsIGJyYW5jaGluZyBvbiB7QGxpbmsgVG91Y2hJbnB1dC5raW5kfS5cbiAqXG4gKiAtICoqV3JpdGUgcGF0aCoqOiBydW4gYGV4ZWN1dG9ycy5maXhgIChgZ2l0IHNwYW4gc3RhbGUgPGZpbGU+IC0tZml4YCkgc2NvcGVkXG4gKiAgIHRvIHRoZSB0b3VjaGVkIGZpbGUgdG8gaGVhbCBwb3NpdGlvbmFsIGRyaWZ0IGluIHRoZSB3b3JraW5nIHRyZWUsIHRoZW5cbiAqICAgY29tcHV0ZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBhZ2FpbnN0IHRoZSBoZWFsZWQgYW5jaG9ycywgcmVuZGVyaW5nXG4gKiAgIGVhY2ggc3VyZmFjZWQgc3BhbiBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gd2l0aCBhbnkgcmVtYWluaW5nXG4gKiAgIHNlbWFudGljIGRyaWZ0IHN0YXR1cy1zdWZmaXhlZCBvbiBpdHMgYW5jaG9ycy4gQ2FkZW5jZSBpcyBkZWR1cGVkIHRocm91Z2hcbiAqICAgYG1lbW9gIHBlciBzcGFuIG5hbWUgYW5kIHBlciAoc3Bhbiwgc3RhdHVzKS5cbiAqIC0gKipSZWFkIHBhdGgqKjogbmV2ZXIgaW52b2tlcyBgZml4YCBhbmQgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZTsgc3VyZmFjZXMgdGhlXG4gKiAgIHNwYW5zIG92ZXJsYXBwaW5nIHRoZSByZWFkJ3MgYG9mZnNldGAvYGxpbWl0YCB3aW5kb3cgKHNlZVxuICogICB7QGxpbmsgcmVjb3ZlclJlYWRSYW5nZX07IGEgcmVhZCB3aXRoIG5laXRoZXIgaXMgd2hvbGUtZmlsZSwgbWF0Y2hpbmdcbiAqICAgdG9kYXkncyBiZWhhdmlvcikgd2l0aCBwb3NpdGlvbmFsIHN0YXR1c2VzIGZpbHRlcmVkIG91dCB2aWEgYGlzRGVidCgpYC5cbiAqXG4gKiBGYWlscyBvcGVuOiBhbnkgZXhlY3V0b3IgcmVqZWN0aW9uIG9yIGludGVybmFsIGVycm9yIHlpZWxkc1xuICogYGFkZGl0aW9uYWxDb250ZXh0OiBudWxsYCAobm8gc2lnbmFsLCBlZGl0aW5nIG5ldmVyIGJsb2NrZWQpIHJhdGhlciB0aGFuXG4gKiB0aHJvd2luZy4gYHRyZWVNb2RpZmllZGAgcmVmbGVjdHMgYSBzdWNjZXNzZnVsIGAtLWZpeGAgZXZlbiB3aGVuIHRoZVxuICogc3Vic2VxdWVudCBzdXJmYWNlIGNvbXB1dGF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVG91Y2hIb29rKFxuICBpbnB1dDogVG91Y2hJbnB1dCxcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlXG4pOiBQcm9taXNlPFRvdWNoT3V0cHV0PiB7XG4gIGxldCB0cmVlTW9kaWZpZWQgPSBmYWxzZTtcbiAgdHJ5IHtcbiAgICBsZXQgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyA9ICd3aG9sZS1maWxlJztcbiAgICBpZiAoaW5wdXQua2luZCA9PT0gJ3dyaXRlJykge1xuICAgICAgY29uc3QgZml4ID0gYXdhaXQgZXhlY3V0b3JzLmZpeChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgICAgIHRyZWVNb2RpZmllZCA9IGZpeC5tb2RpZmllZDtcbiAgICAgIHJhbmdlID0gcmVjb3ZlclJhbmdlRnJvbURpc2soaW5wdXQud3JpdHRlbiwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IHJlY292ZXJSZWFkUmFuZ2UoaW5wdXQub2Zmc2V0LCBpbnB1dC5saW1pdCwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH1cbiAgICBjb25zdCBhZGRpdGlvbmFsQ29udGV4dCA9IGF3YWl0IGNvbXB1dGVTdXJmYWNlKGlucHV0LCBleGVjdXRvcnMsIG1lbW8sIHJhbmdlKTtcbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dCwgdHJlZU1vZGlmaWVkIH07XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZhaWwgb3BlbjogbmV2ZXIgbGV0IGEgdG91Y2gtY29yZSBlcnJvciBwcm9wYWdhdGUgdXAgYW5kIGJsb2NrIHRoZSB0b29sXG4gICAgLy8gY2FsbC4gVGhlIHRyZWUgbWF5IGFscmVhZHkgaGF2ZSBiZWVuIGhlYWxlZCAodHJlZU1vZGlmaWVkIHByZXNlcnZlZCkuXG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQ6IG51bGwsIHRyZWVNb2RpZmllZCB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSZXNvbHZlIHRoZSB0b3VjaGVkIGZpbGUgdG8gYSBwYXRoIHJlbGF0aXZlIHRvIGl0cyByZXBvIHJvb3QsIGZvciBgZ2l0IHNwYW5gLiAqL1xuZnVuY3Rpb24gcmVwb1JlbEFyZyhmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZyk6IHsgcmVwb1Jvb3Q6IHN0cmluZzsgcmVsUGF0aDogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHJlcG9Sb290LCByZWxQYXRoOiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgZmlsZVBhdGgpIH07XG59XG5cbi8qKlxuICogQSBzbmFwc2hvdCBvZiB0aGUgc3BhbiByb290J3Mgd29ya2luZy10cmVlIHN0YXR1cywgdXNlZCB0byBkZXRlY3Qgd2hldGhlciBhXG4gKiBgLS1maXhgIHJlLWFuY2hvcmVkIGFueXRoaW5nLiBDb21wYXJlZCBiZWZvcmUvYWZ0ZXI7IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yXG4gKiBhIGZhaWxlZCBzdGF0dXMgeWllbGRzIGEgc3RhYmxlIGVtcHR5IHN0cmluZyAoXHUyMTkyIGBtb2RpZmllZDogZmFsc2VgKS5cbiAqL1xuZnVuY3Rpb24gc3BhblN0YXR1c1NuYXBzaG90KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnc3RhdHVzJywgJy0tcG9yY2VsYWluJywgJy0tJywgc3BhblJvb3RdLCB7XG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICcnO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHByb2R1Y3Rpb24gZXhlY3V0aW9uIHN1cmZhY2U6IHRocmVlIHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9ycyBmb2xsb3dpbmdcbiAqIHNwYW4tc3VyZmFjZS50cydzIGBjcmVhdGVEZWZhdWx0KkV4ZWN1dG9yYCBzdHlsZS4gRWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlbiBvblxuICogYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbiAqIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIHBhcnNlIGZhaWx1cmUpIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdFxuICogc28ge0BsaW5rIHJ1blRvdWNoSG9va30ncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBUb3VjaEV4ZWN1dG9ycyB7XG4gIHJldHVybiB7XG4gICAgZml4OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIHsgbW9kaWZpZWQ6IGZhbHNlIH07XG4gICAgICBjb25zdCBiZWZvcmUgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnc3RhbGUnLCByZXNvbHZlZC5yZWxQYXRoLCAnLS1maXgnXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGBnaXQgc3BhbiBzdGFsZWAgZXhpdHMgMSBvbiBkcmlmdCBldmVuIHdoZW4gYC0tZml4YCBoZWFsZWQgc29tZXRoaW5nLFxuICAgICAgICAvLyBhbmQgbm9uLXplcm8gb24gZ2VudWluZSBmYWlsdXJlOyB0aGUgc25hcHNob3QgZGlmZiBpcyB0aGUgc291cmNlIG9mXG4gICAgICAgIC8vIHRydXRoIGZvciB3aGV0aGVyIHRoZSB0cmVlIGNoYW5nZWQsIHNvIHRoZSBleGl0IGNvZGUgaXMgaWdub3JlZCBoZXJlLlxuICAgICAgfVxuICAgICAgY29uc3QgYWZ0ZXIgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgcmV0dXJuIHsgbW9kaWZpZWQ6IGJlZm9yZSAhPT0gYWZ0ZXIgfTtcbiAgICB9LFxuXG4gICAgbGlzdDogYXN5bmMgKGZpbGVQYXRoLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVwb1JlbEFyZyhmaWxlUGF0aCwgY3dkKTtcbiAgICAgIGlmICghcmVzb2x2ZWQpIHJldHVybiBbXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCByZXNvbHZlZC5yZWxQYXRoXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcGFyc2VQb3JjZWxhaW4ob3V0KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG4gICAgfSxcblxuICAgIHN0YWxlOiBhc3luYyAoYXJncywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgY29uc3QgcnVuQ3dkID0gcmVwb1Jvb3QgPz8gY3dkO1xuICAgICAgLy8gVGhlIGNvcmUgcGFzc2VzIGFuIGFic29sdXRlIGZpbGUgcGF0aDsgc2NvcGUgYGdpdCBzcGFuIHN0YWxlYCB0byBpdFxuICAgICAgLy8gcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCBzbyB0aGUgcGF0aCBpbmRleCByZXNvbHZlcyBpdC5cbiAgICAgIGNvbnN0IHNjb3BlZCA9IHJlcG9Sb290ID8gYXJncy5tYXAoKGEpID0+IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhKSkgOiBhcmdzO1xuICAgICAgbGV0IG91dDogc3RyaW5nO1xuICAgICAgdHJ5IHtcbiAgICAgICAgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnc3RhbGUnLCAnLS1mb3JtYXQnLCAncG9yY2VsYWluJywgLi4uc2NvcGVkXSwge1xuICAgICAgICAgIGN3ZDogcnVuQ3dkLFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zdCBjYXB0dXJlZCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICBpZiAodHlwZW9mIGNhcHR1cmVkID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIG91dCA9IGNhcHR1cmVkO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnNlU3RhbGVQb3JjZWxhaW4ob3V0KTtcbiAgICB9LFxuXG4gICAgd2h5OiBhc3luYyAobmFtZSwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnd2h5JywgbmFtZV0sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290ID8/IGN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHRleHQgPSBvdXQudHJpbUVuZCgpO1xuICAgICAgICAvLyBCYXJlIGBnaXQgc3BhbiB3aHlgIHByaW50cyB0aGlzIGV4YWN0IHNlbnRpbmVsIChleGl0IDApIHdoZW4gdGhlXG4gICAgICAgIC8vIHNwYW4gaGFzIG5vIHdoeSByZWNvcmRlZCBcdTIwMTQgdHJlYXQgaXQgYXMgXCJubyB3aHlcIiwgbm90IGFzIGNvbnRlbnQuXG4gICAgICAgIGlmICh0ZXh0Lmxlbmd0aCA9PT0gMCB8fCB0ZXh0ID09PSBgXFxgJHtuYW1lfVxcYCBoYXMgbm8gd2h5IHJlY29yZGVkLmApIHJldHVybiBudWxsO1xuICAgICAgICByZXR1cm4gdGV4dDtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgYm94LWRyYXdpbmcgdHJlZSByZW5kZXJlciBmb3IgYSBzcGFuJ3MgYW5jaG9yIGxpc3QsIHVzZWQgYnkgZXZlcnlcbiAqIGNhbGwgc2l0ZSB0aGF0IHRvZGF5IHByaW50cyBhIGZsYXQgYC0gcGF0aCNMc3RhcnQtTGVuZGAgYnVsbGV0IHJ1blxuICogKGB0b3VjaC1jb3JlLnRzYCdzIGBhbmNob3JCdWxsZXRzYCwgYW5kIGBhZHZpc29yLWNvcmUudHNgJ3NcbiAqIGBhbm5vdGF0ZUJsb2Nrc2AvYGdyb3VwQ292ZXJpbmdCeU5hbWVgKS4gQW5jaG9ycyB0aGF0IHNoYXJlIGEgZGlyZWN0b3J5XG4gKiBwcmVmaXggY29sbGFwc2UgaW50byBvbmUgdHJlZSBpbnN0ZWFkIG9mIGJlaW5nIHJlY29uc3RydWN0ZWQgYnkgZXllIGZyb20gYVxuICogZmxhdCBsaXN0IFx1MjAxNCB0aGUgbW90aXZhdGluZyBjYXNlIGlzIHBhcml0eSBhbmNob3JzIHVuZGVyIHBhcmFsbGVsXG4gKiBgcHVibGljL2NsYXVkZS8uLi5gL2BwdWJsaWMvY29kZXgvLi4uYCB0cmVlcy5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpcyBhIHB1cmUgcHJlc2VudGF0aW9uIHRyYW5zZm9ybTogaXQgbmV2ZXIgY29tcHV0ZXMgZHJpZnRcbiAqIHN0YXR1cyBvciBkZWNpZGVzIHdoaWNoIGFuY2hvcnMgYXJlIHN1cmZhY2VkLiBDYWxsZXJzIHByZWNvbXB1dGUgZWFjaCByb3cnc1xuICogYHN1ZmZpeGAgKGUuZy4gYCBcdTIwMTQgY2hhbmdlZGApIGV4YWN0bHkgYXMgdGhleSBkbyB0b2RheSwgYW5kIG9ubHkgdGhlICpzaGFwZSpcbiAqIG9mIHRoZSBwcmludGVkIGxpc3QgY2hhbmdlcy5cbiAqL1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFB1YmxpYyB0eXBlc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSG93IGEgc2luZ2xlIGFuY2hvcidzIGxpbmUgcmFuZ2UgaXMga25vd24uIGByYW5nZWAgYW5kIGB3aG9sZS1maWxlYCBhcmUgdGhlXG4gKiB0d28gc2hhcGVzIGV2ZXJ5IGFuY2hvciB0YWtlcyB0b2RheTsgYHRydW5jYXRlZGAgaXMgYSBkZWZlbnNpdmUgdGhpcmQgc2hhcGVcbiAqIHJlYWNoYWJsZSBvbmx5IGZyb20gcmUtcGFyc2luZyB0aGUgQ0xJJ3MgZmxhdCBodW1hbi1mb3JtYXQgdGV4dCAoYSBgI0xgXG4gKiBmcmFnbWVudCB0aGF0IGRvZXNuJ3QgY2xlYW5seSBtYXRjaCBgI0xzdGFydC1MZW5kYCkuXG4gKlxuICogVmVyaWZpZWQgaW52YXJpYW50OiB0aGUgc3RydWN0dXJlZC1kYXRhIGNhbGwgc2l0ZXMgY2FuIG5ldmVyIHByb2R1Y2VcbiAqIGB0cnVuY2F0ZWRgLiBgcGFyc2VQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpIGBjb250aW51ZWBzIHBhc3QgYW55XG4gKiByb3cgbWlzc2luZyBhIHZhbGlkIHJhbmdlLCBzbyBhbiBpbmNvbXBsZXRlIGBQb3JjZWxhaW5Sb3dgIGNhbiBuZXZlciBiZVxuICogY29uc3RydWN0ZWQ7IHRoZSBSdXN0IENMSSdzIG93biBwb3JjZWxhaW4gd3JpdGVyIGFsd2F5cyBlbWl0cyBhIHJhbmdlXG4gKiBjb2x1bW4gKGAwLTBgIGZvciB3aG9sZS1maWxlKS4gYHRydW5jYXRlZGAgaXMgcmVhY2hhYmxlIG9ubHkgZnJvbVxuICogYGFubm90YXRlQmxvY2tzYCcgZmxhdC10ZXh0IHBhcnNpbmcgb2YgYGJsb2Nrc1RleHRgIGluIGEgbGF0ZXIgcGhhc2UuXG4gKi9cbmV4cG9ydCB0eXBlIFJhbmdlTGFiZWwgPSB7IGtpbmQ6ICdyYW5nZSc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0gfCB7IGtpbmQ6ICd3aG9sZS1maWxlJyB9IHwgeyBraW5kOiAndHJ1bmNhdGVkJyB9O1xuXG4vKiogT25lIHN0YWNrZWQgcmFuZ2UgdW5kZXIgYSBgVHJlZUFuY2hvcmAsIHdpdGggaXRzIHByZWNvbXB1dGVkIGRyaWZ0IHN1ZmZpeC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmFuZ2VFbnRyeSB7XG4gIHJhbmdlOiBSYW5nZUxhYmVsO1xuICAvKiogUHJlY29tcHV0ZWQgYCBcdTIwMTQgY2hhbmdlZGAgKGV0Yy4pLCBvciBgJydgIHdoZW4gdGhlIGFuY2hvciBjYXJyaWVzIG5vIGRyaWZ0LiAqL1xuICBzdWZmaXg6IHN0cmluZztcbn1cblxuLyoqIE9uZSBkaXN0aW5jdCBwYXRoJ3MgY29sbGFwc2VkIGFuY2hvciBlbnRyeSwgcmVhZHkgZm9yIHRyZWUgbGF5b3V0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBUcmVlQW5jaG9yIHtcbiAgLyoqIFJlcG8tcmVsYXRpdmUsIHBvc2l4LXNlcGFyYXRlZCBwYXRoLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBTdGFja2VkIHJhbmdlcyBvbiB0aGlzIHBhdGguIEVtcHR5IG1lYW5zIFwicGF0aCBvbmx5LCBubyByYW5nZSBjb2x1bW4gYXRcbiAgICogYWxsXCIgXHUyMDE0IGEgYmFyZS1wYXRoIGxlYWYsIGRpc3RpbmN0IGZyb20gYSBzaW5nbGUgYHdob2xlLWZpbGVgIGVudHJ5ICh3aGljaFxuICAgKiByZW5kZXJzIHRoZSBwYXRoIHRvbywgYnV0IGlzIGFuIGV4cGxpY2l0IHJhbmdlLWtpbmQgY2xhc3NpZmljYXRpb24pLlxuICAgKi9cbiAgcmFuZ2VzOiBSYW5nZUVudHJ5W107XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gY29sbGFwc2VCeVBhdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIENvbGxhcHNlIHJvd3MgdGhhdCBuYW1lIHRoZSBzYW1lIHBhdGggaW50byBvbmUgYFRyZWVBbmNob3JgIHdpdGggc3RhY2tlZFxuICogcmFuZ2VzLCBwcmVzZXJ2aW5nIGZpcnN0LXNlZW4gb3JkZXIuIGByZW5kZXJBbmNob3JUcmVlYCdzIGNvbnRyYWN0IHJlcXVpcmVzXG4gKiBhdCBtb3N0IG9uZSBgVHJlZUFuY2hvcmAgcGVyIGRpc3RpbmN0IHBhdGggXHUyMDE0IHRoaXMgaXMgdGhlIG1hbmRhdG9yeVxuICogcHJlLXByb2Nlc3Npbmcgc3RlcCBldmVyeSBjYWxsZXIgcnVucyBmaXJzdCB0byBndWFyYW50ZWUgdGhhdC5cbiAqXG4gKiBNaXJyb3JzIHRoZSBvcmRlci1hcnJheS1wbHVzLU1hcCBpZGlvbSBhbHJlYWR5IHVzZWQgYnlcbiAqIGBkZWR1cGVCeUFuY2hvcigpYCAoYWR2aXNvci1jb3JlLnRzKSBmb3IgdGhlIHNhbWUgcmVhc29uOiB0aGUgQ0xJIGNhbiBlbWl0XG4gKiBtdWx0aXBsZSByb3dzIGZvciBvbmUgbG9naWNhbCBwYXRoLCBhbmQgdGhlICpwb3NpdGlvbiogb2YgYSBsYXRlclxuICogc2FtZS1wYXRoIHJvdyBpcyBzdWJzdW1lZCBpbnRvIHRoYXQgcGF0aCdzIGZpcnN0IG9jY3VycmVuY2UsIG5vdCBhcHBlbmRlZFxuICogYXQgaXRzIG93biBsYXRlciBwb3NpdGlvbi4gQ29uY3JldGVseTogYGEudHMjTDEtTDVgLCBgYi50cyNMMS1MNWAsXG4gKiBgYS50cyNMOS1MMTJgIGNvbGxhcHNlcyB0byBgW2EudHMgKHR3byBzdGFja2VkIHJhbmdlcyksIGIudHMgKG9uZSByYW5nZSldYFxuICogXHUyMDE0IGBhLnRzYCBzaXRzIGF0IHBvc2l0aW9uIDAsIGl0cyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgaXRzIGxhc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb2xsYXBzZUJ5UGF0aChyb3dzOiB7IHBhdGg6IHN0cmluZzsgcmFuZ2U6IFJhbmdlTGFiZWw7IHN1ZmZpeDogc3RyaW5nIH1bXSk6IFRyZWVBbmNob3JbXSB7XG4gIGNvbnN0IG9yZGVyOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBieVBhdGggPSBuZXcgTWFwPHN0cmluZywgVHJlZUFuY2hvcj4oKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGxldCBhbmNob3IgPSBieVBhdGguZ2V0KHJvdy5wYXRoKTtcbiAgICBpZiAoIWFuY2hvcikge1xuICAgICAgYW5jaG9yID0geyBwYXRoOiByb3cucGF0aCwgcmFuZ2VzOiBbXSB9O1xuICAgICAgYnlQYXRoLnNldChyb3cucGF0aCwgYW5jaG9yKTtcbiAgICAgIG9yZGVyLnB1c2gocm93LnBhdGgpO1xuICAgIH1cbiAgICBhbmNob3IucmFuZ2VzLnB1c2goeyByYW5nZTogcm93LnJhbmdlLCBzdWZmaXg6IHJvdy5zdWZmaXggfSk7XG4gIH1cbiAgcmV0dXJuIG9yZGVyLm1hcCgocGF0aCkgPT4gYnlQYXRoLmdldChwYXRoKSBhcyBUcmVlQW5jaG9yKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUcmVlIGNvbnN0cnVjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBMZWFmTm9kZSB7XG4gIGtpbmQ6ICdsZWFmJztcbiAgbmFtZTogc3RyaW5nO1xuICBhbmNob3I6IFRyZWVBbmNob3I7XG59XG5cbmludGVyZmFjZSBEaXJOb2RlIHtcbiAga2luZDogJ2Rpcic7XG4gIG5hbWU6IHN0cmluZztcbiAgY2hpbGRyZW46IFBhdGhUcmVlTm9kZVtdO1xufVxuXG50eXBlIFBhdGhUcmVlTm9kZSA9IExlYWZOb2RlIHwgRGlyTm9kZTtcblxuLyoqXG4gKiBTcGxpdCBhIHBhdGggaW50byBgL2Atc2VwYXJhdGVkIHNlZ21lbnRzLCBvciBgbnVsbGAgd2hlbiBkb2luZyBzbyB3b3VsZFxuICogZmVlZCBhbiBlbXB0eS1zdHJpbmcgc2VnbWVudCBpbnRvIHRoZSB0cmllIChhIGxlYWRpbmcgYC9gLCBhIHRyYWlsaW5nIGAvYCxcbiAqIGEgZG91YmxlZCBgLy9gLCBvciB0aGUgZW1wdHkgc3RyaW5nKS4gYG51bGxgIHNpZ25hbHMgdGhlIGNhbGxlciB0byByZW5kZXJcbiAqIHRoYXQgYW5jaG9yJ3MgZnVsbCBwYXRoIHN0cmluZyBhcyBhIHNpbmdsZSwgdW5zcGxpdCwgYXRvbWljIHRvcC1sZXZlbCBsZWFmXG4gKiBpbnN0ZWFkIG9mIGF0dGVtcHRpbmcgdG8gbmVzdCBpdCBcdTIwMTQgYSBrbm93bi1lbnVtZXJhYmxlIGNsYXNzIG9mIG1hbGZvcm1lZFxuICogcGF0aHMgZ2V0cyBhIHJlYWwgcnVsZSBoZXJlIHJhdGhlciB0aGFuIHRoZSBzcGxpdCBydW5uaW5nIGFueXdheSBhbmRcbiAqIGZhYnJpY2F0aW5nIGFuIGVtcHR5LW5hbWVkIGRpcmVjdG9yeSBub2RlLiBBIGJhcmUgZmlsZW5hbWUgd2l0aCBubyBgL2AgYXRcbiAqIGFsbCBwcm9kdWNlcyBleGFjdGx5IG9uZSBub24tZW1wdHkgc2VnbWVudCBhbmQgaXMgaGFuZGxlZCBieSB0aGUgb3JkaW5hcnlcbiAqIHBhdGggYmVsb3cgKGl0IGJlY29tZXMgYSB0b3AtbGV2ZWwgbGVhZiB3aXRoIG5vIGRpcmVjdG9yeSB0byBuZXN0IHVuZGVyIFx1MjAxNFxuICogYWxyZWFkeSBhdG9taWMsIG5vIHNwZWNpYWwgY2FzZSBuZWVkZWQpLlxuICovXG5mdW5jdGlvbiBzcGxpdFNlZ21lbnRzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGlmIChwYXRoLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHNlZ21lbnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBpZiAoc2VnbWVudHMuc29tZSgoc2VnbWVudCkgPT4gc2VnbWVudC5sZW5ndGggPT09IDApKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHNlZ21lbnRzO1xufVxuXG5mdW5jdGlvbiBmaW5kT3JDcmVhdGVEaXIocGFyZW50OiBEaXJOb2RlLCBuYW1lOiBzdHJpbmcpOiBEaXJOb2RlIHtcbiAgZm9yIChjb25zdCBjaGlsZCBvZiBwYXJlbnQuY2hpbGRyZW4pIHtcbiAgICBpZiAoY2hpbGQua2luZCA9PT0gJ2RpcicgJiYgY2hpbGQubmFtZSA9PT0gbmFtZSkgcmV0dXJuIGNoaWxkO1xuICB9XG4gIGNvbnN0IG5vZGU6IERpck5vZGUgPSB7IGtpbmQ6ICdkaXInLCBuYW1lLCBjaGlsZHJlbjogW10gfTtcbiAgcGFyZW50LmNoaWxkcmVuLnB1c2gobm9kZSk7XG4gIHJldHVybiBub2RlO1xufVxuXG4vKiogSW5zZXJ0IG9uZSBhbmNob3IgaW50byB0aGUgdHJpZSwgY3JlYXRpbmcvcmV1c2luZyBkaXJlY3Rvcnkgbm9kZXMgaW4gYXJyaXZhbCBvcmRlci4gKi9cbmZ1bmN0aW9uIGluc2VydEFuY2hvcihyb290OiBEaXJOb2RlLCBzZWdtZW50czogc3RyaW5nW10sIGFuY2hvcjogVHJlZUFuY2hvcik6IHZvaWQge1xuICBsZXQgY3VyID0gcm9vdDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50cy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICBjdXIgPSBmaW5kT3JDcmVhdGVEaXIoY3VyLCBzZWdtZW50c1tpXSk7XG4gIH1cbiAgY3VyLmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IHNlZ21lbnRzW3NlZ21lbnRzLmxlbmd0aCAtIDFdLCBhbmNob3IgfSk7XG59XG5cbi8qKlxuICogQnVpbGQgdGhlIHRvcC1sZXZlbCBmb3Jlc3QgZnJvbSBhIGBUcmVlQW5jaG9yW11gIGFscmVhZHkgY29sbGFwc2VkIGJ5XG4gKiBgY29sbGFwc2VCeVBhdGhgLiBTaWJsaW5nIG9yZGVyIGlzIG5ldmVyIHJlLXNvcnRlZCBcdTIwMTQgYSBwYXRoIGVpdGhlciBvcGVucyBhXG4gKiBuZXcgbm9kZSBhdCBpdHMgYXJyaXZhbCBwb3NpdGlvbiBvciBpcyBuZXN0ZWQgdW5kZXIgYSBkaXJlY3Rvcnkgbm9kZVxuICogY3JlYXRlZC9yZXVzZWQgYXQgdGhhdCBkaXJlY3RvcnkncyBvd24gZmlyc3Qtb2NjdXJyZW5jZSBwb3NpdGlvbi5cbiAqL1xuZnVuY3Rpb24gYnVpbGRGb3Jlc3QoYW5jaG9yczogVHJlZUFuY2hvcltdKTogUGF0aFRyZWVOb2RlW10ge1xuICBjb25zdCByb290OiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZTogJycsIGNoaWxkcmVuOiBbXSB9O1xuICBmb3IgKGNvbnN0IGFuY2hvciBvZiBhbmNob3JzKSB7XG4gICAgY29uc3Qgc2VnbWVudHMgPSBzcGxpdFNlZ21lbnRzKGFuY2hvci5wYXRoKTtcbiAgICBpZiAoc2VnbWVudHMgPT09IG51bGwpIHtcbiAgICAgIHJvb3QuY2hpbGRyZW4ucHVzaCh7IGtpbmQ6ICdsZWFmJywgbmFtZTogYW5jaG9yLnBhdGgsIGFuY2hvciB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpbnNlcnRBbmNob3Iocm9vdCwgc2VnbWVudHMsIGFuY2hvcik7XG4gIH1cbiAgcmV0dXJuIHJvb3QuY2hpbGRyZW47XG59XG5cbi8qKiBBIG5vZGUgcGFpcmVkIHdpdGggdGhlIChwb3NzaWJseSBmb2xkZWQpIG5hbWUgaXQgZGlzcGxheXMgb24gaXRzIG93biBsaW5lLiAqL1xuaW50ZXJmYWNlIERpc3BsYXlJdGVtIHtcbiAgbmFtZTogc3RyaW5nO1xuICBub2RlOiBQYXRoVHJlZU5vZGU7XG59XG5cbi8qKlxuICogRm9sZCBhIGNoYWluIG9mIHNpbmdsZS1jaGlsZCBub2RlcyBpbnRvIG9uZSBjb21iaW5lZCBuYW1lXG4gKiAoYHB1YmxpYy9jbGF1ZGUvcnVudGltZS9za2lsbHMvY2FyZGAsIGBkaXJ0eS9tb2QucnNgLFxuICogYC5kZXZjb250YWluZXIvRG9ja2VyZmlsZWApLiBGb2xkaW5nIGNvbnRpbnVlcyB3aGlsZSB0aGUgY3VycmVudCBub2RlIGlzIGFcbiAqIGRpcmVjdG9yeSB3aXRoICoqZXhhY3RseSBvbmUgY2hpbGQqKiwgcmVnYXJkbGVzcyBvZiB3aGV0aGVyIHRoYXQgY2hpbGQgaXMgYVxuICogZGlyZWN0b3J5IG9yIGEgbGVhZjogYSBub2RlIHdpdGggb25lIGNoaWxkIGNvbnZleXMgbm8gZ3JvdXBpbmcgYnlcbiAqIGRlZmluaXRpb24sIHNvIGZvbGRpbmcgaXQgbG9zZXMgbm8gc3RydWN0dXJlIHdoaWxlIHJlbW92aW5nIGEgbGluZSB3aG9zZVxuICogb25seSBjb250ZW50IGlzIGEgY29ubmVjdG9yLiBTdG9wcyBhdCB0aGUgZmlyc3QgZGlyZWN0b3J5IHdpdGggMisgY2hpbGRyZW5cbiAqIChleHBhbmQgZnJvbSB0aGVyZSkgb3IgYXQgYSBsZWFmICh3aGljaCB0aGVuIHJlbmRlcnMgd2l0aCB0aGUgZm9sZGVkIG5hbWUpLlxuICpcbiAqIEZvbGRpbmcgbG9uZSAqbGVhdmVzKiBcdTIwMTQgbm90IGp1c3QgbG9uZSBkaXJlY3RvcmllcyBcdTIwMTQgaXMgd2hhdCBrZWVwcyB0aGUgdHJlZVxuICogbm8gdGFsbGVyIHRoYW4gdGhlIGZsYXQgYnVsbGV0IGxpc3QgaXQgcmVwbGFjZXMsIGFuZCB3aGF0IG1ha2VzIGEgc2luZ2xlXG4gKiBhbmNob3IgcmVuZGVyIGFzIHRoZSBvbmUtbGluZSB0cmVlIHRoZSBwbGFuIHByb21pc2VzIGV2ZW4gd2hlbiBpdHMgcGF0aCBoYXNcbiAqIGRpcmVjdG9yaWVzIGluIGl0LiBJdCBhbHNvIGtlZXBzIHRoZSBkaXNjcmltaW5hdGluZyBzZWdtZW50IG9uIHRoZSBzYW1lXG4gKiBsaW5lIGFzIGl0cyByYW5nZSAoYGRpcnR5L21vZC5ycyAjTDM5Mi1MMzk5YCkgZm9yIGBtb2QucnNgL2BpbmRleC50c2BcbiAqIGxheW91dHMsIHdoZXJlIHRoZSBmaWxlbmFtZSBhbG9uZSBpZGVudGlmaWVzIG5vdGhpbmcuXG4gKi9cbmZ1bmN0aW9uIGZvbGRDaGFpbihub2RlOiBQYXRoVHJlZU5vZGUpOiBEaXNwbGF5SXRlbSB7XG4gIGxldCBuYW1lID0gbm9kZS5uYW1lO1xuICBsZXQgY3VyID0gbm9kZTtcbiAgd2hpbGUgKGN1ci5raW5kID09PSAnZGlyJyAmJiBjdXIuY2hpbGRyZW4ubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgY2hpbGQgPSBjdXIuY2hpbGRyZW5bMF07XG4gICAgbmFtZSA9IGAke25hbWV9LyR7Y2hpbGQubmFtZX1gO1xuICAgIGN1ciA9IGNoaWxkO1xuICB9XG4gIHJldHVybiB7IG5hbWUsIG5vZGU6IGN1ciB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlbmRlcmluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmFuayBvZiBhIHN0YWNrZWQgZW50cnkncyByYW5nZSBraW5kOiBgd2hvbGUtZmlsZWAgZmlyc3QsIHRoZW4gbnVtZXJpY1xuICogYHJhbmdlYHMsIHRoZW4gYHRydW5jYXRlZGAuIEEgd2hvbGUtZmlsZSBhbmNob3IgaXMgdGhlIENMSSdzIGAwLTBgIHJvdyBcdTIwMTQgaXRcbiAqIGNvdmVycyB0aGUgZW50aXJlIGZpbGUsIHNvIGl0IHNvcnRzIGFoZWFkIG9mIGV2ZXJ5IGxpbmUgcmFuZ2Ugb24gdGhhdCBmaWxlXG4gKiB0aGUgc2FtZSB3YXkgbGluZSAwIHdvdWxkLiBgdHJ1bmNhdGVkYCBjYXJyaWVzIG5vIHBvc2l0aW9uIGF0IGFsbCBhbmQgc29ydHNcbiAqIGxhc3QuXG4gKi9cbmZ1bmN0aW9uIHJhbmdlUmFuayhyYW5nZTogUmFuZ2VMYWJlbCk6IG51bWJlciB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3dob2xlLWZpbGUnOlxuICAgICAgcmV0dXJuIDA7XG4gICAgY2FzZSAncmFuZ2UnOlxuICAgICAgcmV0dXJuIDE7XG4gICAgY2FzZSAndHJ1bmNhdGVkJzpcbiAgICAgIHJldHVybiAyO1xuICB9XG59XG5cbi8qKlxuICogU3RhY2tlZC1yYW5nZSBvcmRlciBpcyBieSBraW5kIHJhbmsgdGhlbiBudW1lcmljIChgc3RhcnRgIHRoZW4gYGVuZGApLFxuICogb3ZlcnJpZGluZyBhcnJpdmFsIG9yIGNvZGVwb2ludCBvcmRlciBcdTIwMTQgdGhlIG9ubHkgc29ydGluZyB0aGlzIG1vZHVsZSBkb2VzLFxuICogYW5kIHNjb3BlZCBzdHJpY3RseSB0byByYW5nZXMgc3RhY2tlZCBvbiBvbmUgcGF0aCAobmV2ZXIgdG8gc2libGluZyBwYXRoc1xuICogb3IgZGlyZWN0b3J5IG9yZGVyKS4gRXF1YWwtcmFua2VkIGVudHJpZXMgKHR3byBgdHJ1bmNhdGVkYHMsIG9yIHR3b1xuICogaWRlbnRpY2FsIHJhbmdlcykga2VlcCB0aGVpciBvd24gcmVsYXRpdmUgYXJyaXZhbCBvcmRlciwgc2luY2UgdGhlIHNvcnQgaXNcbiAqIHN0YWJsZS5cbiAqL1xuZnVuY3Rpb24gY29tcGFyZVJhbmdlRW50cmllcyhhOiBSYW5nZUVudHJ5LCBiOiBSYW5nZUVudHJ5KTogbnVtYmVyIHtcbiAgY29uc3QgcmFuayA9IHJhbmdlUmFuayhhLnJhbmdlKSAtIHJhbmdlUmFuayhiLnJhbmdlKTtcbiAgaWYgKHJhbmsgIT09IDApIHJldHVybiByYW5rO1xuICBpZiAoYS5yYW5nZS5raW5kID09PSAncmFuZ2UnICYmIGIucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJykge1xuICAgIHJldHVybiBhLnJhbmdlLnN0YXJ0IC0gYi5yYW5nZS5zdGFydCB8fCBhLnJhbmdlLmVuZCAtIGIucmFuZ2UuZW5kO1xuICB9XG4gIHJldHVybiAwO1xufVxuXG4vKipcbiAqIFRoZSByYW5nZSBjb2x1bW4ncyB0ZXh0LCBvciBgbnVsbGAgd2hlbiB0aGUgZW50cnkgcHJpbnRzIGFzIGEgYmFyZSBwYXRoXG4gKiB3aXRoIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwuXG4gKlxuICogQSBgd2hvbGUtZmlsZWAgZW50cnkgaXMgdGhlIG9uZSBraW5kIHdob3NlIHJlbmRlcmluZyBkZXBlbmRzIG9uIGNvbnRleHQuXG4gKiBBbG9uZSBvbiBpdHMgcGF0aCBpdCBzdGF5cyBhIGJhcmUgcGF0aCB3aXRoIHplcm8gbWFya2VyIFx1MjAxNCB0aGF0IGlzIHdoYXQgdGhlXG4gKiBDTEkncyBvd24gZmxhdCBsaXN0IHByaW50cyBmb3IgYSB3aG9sZS1maWxlIGFuY2hvciwgYW5kIGFkZGluZyBhIG1hcmtlclxuICogdGhlcmUgd291bGQgYW5ub3RhdGUgdGhlIG92ZXJ3aGVsbWluZ2x5IGNvbW1vbiBjYXNlIGZvciB0aGUgYmVuZWZpdCBvZiB0aGVcbiAqIHJhcmUgb25lLiAqU3RhY2tlZCogYmVoaW5kIG90aGVyIHJhbmdlcyBvbiB0aGUgc2FtZSBwYXRoIGl0IG11c3QgY2FycnkgYW5cbiAqIGV4cGxpY2l0IG1hcmtlcjogd2l0aG91dCBvbmUgaXQgcmVuZGVycyBhcyBhIGNvbnRpbnVhdGlvbiBsaW5lIGhvbGRpbmdcbiAqIG5vdGhpbmcgYnV0IGluZGVudGF0aW9uIGFuZCBpdHMgZHJpZnQgc3VmZml4LCB3aGljaCBlcmFzZXMgdGhlIGFuY2hvclxuICogb3V0cmlnaHQgd2hlbiB0aGUgc3VmZml4IGlzIGVtcHR5IGFuZCBcdTIwMTQgd29yc2UgXHUyMDE0IGhhbmdzIGl0cyBgIFx1MjAxNCBjaGFuZ2VkYFxuICogdW5kZXIgYSBuZWlnaGJvdXJpbmcgcmFuZ2UsIGV4YWN0bHkgdGhlIHZpc3VhbCBncmFtbWFyIHRoYXQgbWVhbnMgXCJhbm90aGVyXG4gKiByYW5nZSBvbiB0aGlzIHNhbWUgZmlsZVwiLiBUaGUgcmVhZGVyIHdvdWxkIHRoZW4gcmVjb25jaWxlIHRoZSByYW5nZSB0aGF0XG4gKiBkaWQgbm90IGRyaWZ0LiBPZiB0aGUgdGhyZWUgZml4ZXMgYXZhaWxhYmxlIChwcmludCB0aGUgcGF0aCBvblxuICogY29udGludWF0aW9uIGxpbmVzLCBzb3J0IHdob2xlLWZpbGUgdG8gcG9zaXRpb24gMCwgb3Igc3BsaXQgaXQgaW50byBpdHMgb3duXG4gKiBsZWFmKSwgYW4gZXhwbGljaXQgbWFya2VyIGlzIHRoZSBvbmx5IG9uZSB0aGF0IG1ha2VzIHRoZSBlbnRyeSBpZGVudGlmaWFibGVcbiAqIGluICpldmVyeSogcG9zaXRpb24gcmF0aGVyIHRoYW4gb25seSBpbiB0aGUgcG9zaXRpb24gdGhlIHNvcnQgaGFwcGVucyB0b1xuICogcHV0IGl0IGluOyBzb3J0aW5nIGl0IGZpcnN0IChzZWUge0BsaW5rIHJhbmdlUmFua30pIGlzIGtlcHQgYXMgd2VsbCBiZWNhdXNlXG4gKiBcIndob2xlIGZpbGUsIHRoZW4gaXRzIHJhbmdlcyBpbiBsaW5lIG9yZGVyXCIgaXMgdGhlIG9yZGVyIGEgcmVhZGVyIGV4cGVjdHMsXG4gKiBub3QgYmVjYXVzZSBpZGVudGlmaWFiaWxpdHkgZGVwZW5kcyBvbiBpdC5cbiAqL1xuZnVuY3Rpb24gbGFiZWxGb3IocmFuZ2U6IFJhbmdlTGFiZWwsIHNvbGU6IGJvb2xlYW4pOiBzdHJpbmcgfCBudWxsIHtcbiAgc3dpdGNoIChyYW5nZS5raW5kKSB7XG4gICAgY2FzZSAncmFuZ2UnOlxuICAgICAgcmV0dXJuIGAjTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICAgIGNhc2UgJ3dob2xlLWZpbGUnOlxuICAgICAgcmV0dXJuIHNvbGUgPyBudWxsIDogJyh3aG9sZSBmaWxlKSc7XG4gICAgY2FzZSAndHJ1bmNhdGVkJzpcbiAgICAgIHJldHVybiAnKHRydW5jYXRlZCBpbiBzb3VyY2UgXHUyMDE0IGFuY2hvciBpbmNvbXBsZXRlKSc7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDb2x1bW4gbWF0aFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGdyYXBoZW1lIHNlZ21lbnRlciwgY29uc3RydWN0ZWQgb24gZmlyc3QgdXNlIGFuZCB0aGVuIGNhY2hlZCBcdTIwMTQgaW5jbHVkaW5nXG4gKiBhIGNhY2hlZCBgbnVsbGAgd2hlbiBpdCBjYW5ub3QgYmUgY29uc3RydWN0ZWQgYXQgYWxsLlxuICpcbiAqIExhenkgb24gcHVycG9zZS4gYEludGxgIGlzIG5vdCBwYXJ0IG9mIHRoZSBKYXZhU2NyaXB0IGxhbmd1YWdlIGNvcmU6IGEgTm9kZVxuICogYnVpbHQgYC0td2l0aC1pbnRsPW5vbmVgIGhhcyBubyBgSW50bGAgZ2xvYmFsIHdoYXRzb2V2ZXIsIGFuZCBgaG9va3MuanNvbmBcbiAqIGludm9rZXMgYSBiYXJlIGBub2RlYCBvZmYgdGhlIHVzZXIncyBgUEFUSGAsIHNvIGBlbmdpbmVzLm5vZGVgIGNvbnN0cmFpbnNcbiAqIG5vdGhpbmcgaGVyZS4gQ29uc3RydWN0aW5nIHRoaXMgYXQgbW9kdWxlIHNjb3BlIHB1dCBhIGBSZWZlcmVuY2VFcnJvcmAgaW5cbiAqIHRoZSBidW5kbGVzJyB0b3AtbGV2ZWwgc3RhdGVtZW50cywgd2hlcmUgaXQgdGhyb3dzIGF0ICppbXBvcnQqIFx1MjAxNCBiZWZvcmUgYW55XG4gKiBvZiB0aGUgZmFpbC1jbG9zZWQgYHRyeS9jYXRjaGAgYmxvY2tzIGluIGByZW5kZXJBbmNob3JSdW5gLCBgcmVuZGVyUGF0aFJ1bmBcbiAqIGFuZCBgYW5jaG9yQnVsbGV0c2AgZXhpc3QgdG8gY2F0Y2ggaXQuIFRoZSBob29rIHByb2Nlc3MgdGhlbiBkaWVkIHdpdGggZXhpdFxuICogMSwgd2hpY2ggQ2xhdWRlIENvZGUgdHJlYXRzIGFzIGEgbm9uLWJsb2NraW5nIGhvb2sgZXJyb3I6IHRoZSBjb21taXQgZ2F0ZVxuICogc2lsZW50bHkgYWxsb3dlZCB0aGUgY29tbWl0IGFuZCB0aGUgZHJpZnQgcmVtaW5kZXIgc2lsZW50bHkgdmFuaXNoZWQuXG4gKiBCdWlsZGluZyBpdCBpbnNpZGUgdGhlIHJlbmRlciBwYXRoIHB1dHMgYW55IGZhaWx1cmUgYmFjayBpbnNpZGUgdGhvc2VcbiAqIGNhdGNoZXMuXG4gKlxuICogRkFJTC1DTE9TRUQsIG5vdCBhIGA8Z3JlZW5maWVsZD5gLWZvcmJpZGRlbiBmYWxsYmFjayBcdTIwMTQgdGhlIHNhbWUgY2F0ZWdvcnkgYXNcbiAqIHRoZSBsb2NhbCBgdHJ5L2NhdGNoYCBibG9ja3MgYXQgdGhpcyBtb2R1bGUncyBjYWxsIHNpdGVzLCBhbmQgbG9hZC1iZWFyaW5nXG4gKiBmb3IgdGhlIHNhbWUgcmVhc29uLiBOb3RoaW5nIGluIHRoZSBjb2x1bW4tYWxpZ25tZW50IHBhdGggbWF5IGJlIGFibGUgdG9cbiAqIGNvc3QgdGhlIGNvbW1pdCBnYXRlIG9yIHRoZSBkcmlmdCByZW1pbmRlcjogaWYgZGlzcGxheSB3aWR0aCBjYW5ub3QgYmVcbiAqIG1lYXN1cmVkLCB0aGUgbGlzdCBzdGlsbCBwcmludHMgYW5kIHRoZSBnYXRlIHN0aWxsIGhvbGRzOyBvbmx5IGFsaWdubWVudCBpc1xuICogbG9zdC5cbiAqL1xubGV0IGNhY2hlZFNlZ21lbnRlcjogeyB2YWx1ZTogSW50bC5TZWdtZW50ZXIgfCBudWxsIH0gfCB1bmRlZmluZWQ7XG5cbmZ1bmN0aW9uIGdyYXBoZW1lU2VnbWVudGVyKCk6IEludGwuU2VnbWVudGVyIHwgbnVsbCB7XG4gIGlmIChjYWNoZWRTZWdtZW50ZXIgPT09IHVuZGVmaW5lZCkge1xuICAgIHRyeSB7XG4gICAgICBjYWNoZWRTZWdtZW50ZXIgPSB7IHZhbHVlOiBuZXcgSW50bC5TZWdtZW50ZXIoJ2VuJywgeyBncmFudWxhcml0eTogJ2dyYXBoZW1lJyB9KSB9O1xuICAgIH0gY2F0Y2gge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbnVsbCB9O1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2FjaGVkU2VnbWVudGVyLnZhbHVlO1xufVxuXG4vKipcbiAqIENvZGUgcG9pbnQgcmFuZ2VzIHJlbmRlcmVkIHR3byBjb2x1bW5zIHdpZGU6IHRoZSBFYXN0IEFzaWFuIFdpZGUgKFcpIGFuZFxuICogRnVsbHdpZHRoIChGKSBibG9ja3Mgb2YgVUFYICMxMSwgcGx1cyB0aGUgZW1vamkgYmxvY2tzIHRoYXQgdGVybWluYWxzIGFuZFxuICogcHJvcG9ydGlvbmFsIGFnZW50LWZhY2luZyByZW5kZXJlcnMgYm90aCBnaXZlIGRvdWJsZSB3aWR0aC4gRXZlcnl0aGluZyBlbHNlXG4gKiBjb3VudHMgYXMgb25lIGNvbHVtbi5cbiAqXG4gKiBTb3J0ZWQgYXNjZW5kaW5nIGFuZCBub24tb3ZlcmxhcHBpbmcgXHUyMDE0IHtAbGluayBpc1dpZGVDb2RlUG9pbnR9IHNob3J0LWNpcmN1aXRzXG4gKiBvbiB0aGUgZmlyc3QgcmFuZ2Ugc3RhcnRpbmcgcGFzdCB0aGUgY29kZSBwb2ludC5cbiAqL1xuY29uc3QgV0lERV9SQU5HRVM6IHJlYWRvbmx5IChyZWFkb25seSBbbnVtYmVyLCBudW1iZXJdKVtdID0gW1xuICBbMHgxMTAwLCAweDExNWZdLFxuICBbMHgyMzI5LCAweDIzMmFdLFxuICBbMHgyNjAwLCAweDI3YmZdLFxuICBbMHgyZTgwLCAweDMwM2VdLFxuICBbMHgzMDQxLCAweDMzZmZdLFxuICBbMHgzNDAwLCAweDRkYmZdLFxuICBbMHg0ZTAwLCAweDlmZmZdLFxuICBbMHhhMDAwLCAweGE0Y2ZdLFxuICBbMHhhOTYwLCAweGE5N2ZdLFxuICBbMHhhYzAwLCAweGQ3YTNdLFxuICBbMHhmOTAwLCAweGZhZmZdLFxuICBbMHhmZTEwLCAweGZlMTldLFxuICBbMHhmZTMwLCAweGZlNmZdLFxuICBbMHhmZjAwLCAweGZmNjBdLFxuICBbMHhmZmUwLCAweGZmZTZdLFxuICBbMHgxNzAwMCwgMHgxOGFmZl0sXG4gIFsweDFmMWU2LCAweDFmMWZmXSxcbiAgWzB4MWYzMDAsIDB4MWY2NGZdLFxuICBbMHgxZjY4MCwgMHgxZjZmZl0sXG4gIFsweDFmOTAwLCAweDFmOWZmXSxcbiAgWzB4MWZhNzAsIDB4MWZhZmZdLFxuICBbMHgyMDAwMCwgMHgyZmZmZF0sXG4gIFsweDMwMDAwLCAweDNmZmZkXVxuXTtcblxuZnVuY3Rpb24gaXNXaWRlQ29kZVBvaW50KGNwOiBudW1iZXIpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBbbG8sIGhpXSBvZiBXSURFX1JBTkdFUykge1xuICAgIGlmIChjcCA8IGxvKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGNwIDw9IGhpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogRGlzcGxheSB3aWR0aCBvZiBhIG5hbWUgaW4gdGVybWluYWwgY29sdW1ucyBcdTIwMTQgdGhlIHVuaXQgdGhlIHJhbmdlIGNvbHVtbiBpc1xuICogYWN0dWFsbHkgYWxpZ25lZCBpbi4gTWVhc3VyZWQgb3ZlciBncmFwaGVtZSBjbHVzdGVycyAoc28gYSBkZWNvbXBvc2VkIGBcdTAwRTlgXG4gKiBvciBhIGNvbWJpbmluZy1tYXJrIHNlcXVlbmNlIGNvdW50cyBvbmNlLCBub3Qgb25jZSBwZXIgY29kZSBwb2ludCksIHdpdGhcbiAqIGVhY2ggY2x1c3RlciBjb250cmlidXRpbmcgdHdvIGNvbHVtbnMgd2hlbiBpdHMgYmFzZSBjb2RlIHBvaW50IGlzIEVhc3RcbiAqIEFzaWFuIFdpZGUvRnVsbHdpZHRoIG9yIGVtb2ppIGFuZCBvbmUgb3RoZXJ3aXNlLlxuICpcbiAqIE5laXRoZXIgVVRGLTE2IGAubGVuZ3RoYCBub3IgYEFycmF5LmZyb20obmFtZSkubGVuZ3RoYCBpcyB0aGlzIHVuaXQ6IHRoZVxuICogZmlyc3Qgb3Zlci1jb3VudHMgYSBzdXJyb2dhdGUgcGFpciwgdGhlIHNlY29uZCB1bmRlci1jb3VudHMgYSBDSksgaWRlb2dyYXBoXG4gKiBhbmQgb3Zlci1jb3VudHMgYSBkZWNvbXBvc2VkIGFjY2VudC5cbiAqXG4gKiBXaGVuIHtAbGluayBncmFwaGVtZVNlZ21lbnRlcn0gaXMgdW5hdmFpbGFibGUgKGEgTm9kZSBidWlsdFxuICogYC0td2l0aC1pbnRsPW5vbmVgIGhhcyBubyBgSW50bGAgZ2xvYmFsIGF0IGFsbCksIHRoaXMgZGVncmFkZXMgdG8gdGhlIGNydWRlclxuICogcGVyLWNvZGUtcG9pbnQgbWVhc3VyZSByYXRoZXIgdGhhbiB0aHJvd2luZy4gVGhhdCBtZWFzdXJlIG92ZXItY291bnRzIGFcbiAqIGRlY29tcG9zZWQgYWNjZW50IGFuZCBhIHJlZ2lvbmFsLWluZGljYXRvciBmbGFnIHBhaXIsIHNvIGFsaWdubWVudCBjYW4gYmUgYVxuICogY29sdW1uIG9yIHR3byBvZmYgXHUyMDE0IHdoaWNoIGlzIHRoZSBlbnRpcmUgY29zdCwgYW5kIGlzIHRoZSBjb3JyZWN0IHByaWNlIHRvXG4gKiBwYXk6IHRoZSBhbmNob3IgbGlzdCBzdGlsbCBwcmludHMgYW5kIHRoZSBjb21taXQgZ2F0ZSBzdGlsbCBob2xkcy5cbiAqL1xuZnVuY3Rpb24gZGlzcGxheVdpZHRoKG5hbWU6IHN0cmluZyk6IG51bWJlciB7XG4gIGNvbnN0IHNlZ21lbnRlciA9IGdyYXBoZW1lU2VnbWVudGVyKCk7XG4gIGxldCB3aWR0aCA9IDA7XG4gIGlmIChzZWdtZW50ZXIgPT09IG51bGwpIHtcbiAgICBmb3IgKGNvbnN0IGNvZGVQb2ludCBvZiBuYW1lKSB7XG4gICAgICB3aWR0aCArPSBpc1dpZGVDb2RlUG9pbnQoY29kZVBvaW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gICAgfVxuICAgIHJldHVybiB3aWR0aDtcbiAgfVxuICBmb3IgKGNvbnN0IHsgc2VnbWVudCB9IG9mIHNlZ21lbnRlci5zZWdtZW50KG5hbWUpKSB7XG4gICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KHNlZ21lbnQuY29kZVBvaW50QXQoMCkgPz8gMCkgPyAyIDogMTtcbiAgfVxuICByZXR1cm4gd2lkdGg7XG59XG5cbi8qKlxuICogQWxpZ25tZW50IGNlaWxpbmcuIEEgc2libGluZyBncm91cCB3aG9zZSB3aWRlc3QgcmFuZ2UtYmVhcmluZyBuYW1lIGV4Y2VlZHNcbiAqIHRoaXMgd2lkdGggZG9lcyBub3QgYWxpZ24gYXQgYWxsIFx1MjAxNCBldmVyeSBuYW1lIGluIGl0IHRha2VzIGEgc2luZ2xlIHNwYWNlXG4gKiBiZWZvcmUgaXRzIHJhbmdlLiBUaGUgYWx0ZXJuYXRpdmUgKHBhZCB0aGUgc2hvcnQgbmFtZXMgdG8gdGhlIGNlaWxpbmcgd2hpbGVcbiAqIHRoZSBsb25nIG9uZSBzaXRzIGF0IGl0cyBvd24gbmF0dXJhbCBjb2x1bW4pIHBheXMgbW9zdCBvZiB0aGUgd2lkdGggZm9yXG4gKiBhbGlnbm1lbnQgdGhhdCBhbGlnbnMgd2l0aCBub3RoaW5nLCB3aGljaCBpcyBzdHJpY3RseSB3b3JzZSB0aGFuIG5vdFxuICogYWxpZ25pbmcuIE5hbWVzIHRoZW1zZWx2ZXMgYXJlIG5ldmVyIHRydW5jYXRlZCBvciBlbGlkZWQgYXQgYW55IHdpZHRoLlxuICovXG5jb25zdCBNQVhfQUxJR05fQ09MVU1OID0gNDg7XG5cbi8qKlxuICogVGhlIGNvbHVtbiBldmVyeSByYW5nZS1iZWFyaW5nIG5hbWUgaW4gdGhpcyBzaWJsaW5nIGdyb3VwIHBhZHMgdG8sIG9yIGAwYFxuICogd2hlbiB0aGUgZ3JvdXAgZm9yZ29lcyBhbGlnbm1lbnQgKG5vIHJhbmdlLWJlYXJpbmcgbmFtZXMsIG9yIGEgbmFtZSBwYXN0XG4gKiB7QGxpbmsgTUFYX0FMSUdOX0NPTFVNTn0pLiBBbGlnbm1lbnQgc2NvcGUgaXMgdGhlIGdyb3VwJ3MgZGlyZWN0IGNoaWxkcmVuXG4gKiBvbmx5LCBuZXZlciB0aGUgd2hvbGUgdHJlZSBcdTIwMTQgd2hvbGUtdHJlZSBhbGlnbm1lbnQgd291bGQgbGV0IG9uZSBkZWVwbHlcbiAqIG5lc3RlZCBsb25nIG5hbWUgcGFkIGV2ZXJ5IHVucmVsYXRlZCBicmFuY2guXG4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVHcm91cFRhcmdldChpdGVtczogRGlzcGxheUl0ZW1bXSk6IG51bWJlciB7XG4gIGxldCBtYXggPSAwO1xuICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICBpZiAoaXRlbS5ub2RlLmtpbmQgPT09ICdsZWFmJyAmJiBwcmludHNSYW5nZUNvbHVtbihpdGVtLm5vZGUuYW5jaG9yKSkge1xuICAgICAgbWF4ID0gTWF0aC5tYXgobWF4LCBkaXNwbGF5V2lkdGgoaXRlbS5uYW1lKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBtYXggPiBNQVhfQUxJR05fQ09MVU1OID8gMCA6IG1heDtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoaXMgYW5jaG9yIHByaW50cyBhIHJhbmdlIGNvbHVtbiBhdCBhbGwgXHUyMDE0IHRoZSBleGFjdCBjb25kaXRpb25cbiAqIHtAbGluayBsYWJlbEZvcn0gZW5jb2RlcywgaG9pc3RlZCBzbyB7QGxpbmsgY29tcHV0ZUdyb3VwVGFyZ2V0fSBtZWFzdXJlcyB0aGVcbiAqIHNhbWUgc2V0IG9mIG5hbWVzIGl0IHBhZHMuIEFuIGFuY2hvciB3aXRoIG5vIHJhbmdlcywgb3IgYSAqc29sZSogd2hvbGUtZmlsZVxuICogZW50cnkgKHdoaWNoIHJlbmRlcnMgYXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciksIGNvbnRyaWJ1dGVzIG5vIHJhbmdlXG4gKiBjb2x1bW4gYW5kIHNvIG11c3Qgbm90IGNvbnRyaWJ1dGUgdG8gdGhlIGdyb3VwIG1heCBlaXRoZXI6IG90aGVyd2lzZSBhXG4gKiB3aG9sZS1maWxlIGFuY2hvciBvbiBhIHBhdGggcGFzdCB7QGxpbmsgTUFYX0FMSUdOX0NPTFVNTn0gc2lsZW50bHkgc3VwcHJlc3Nlc1xuICogYWxpZ25tZW50IGZvciBpdHMgcmFuZ2UtYmVhcmluZyBzaWJsaW5ncyB3aGlsZSBpdHNlbGYgcHJpbnRpbmcgbm90aGluZyB0b1xuICogYWxpZ24uXG4gKi9cbmZ1bmN0aW9uIHByaW50c1JhbmdlQ29sdW1uKGFuY2hvcjogVHJlZUFuY2hvcik6IGJvb2xlYW4ge1xuICBjb25zdCB7IHJhbmdlcyB9ID0gYW5jaG9yO1xuICBpZiAocmFuZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gcmFuZ2VzLnNvbWUoKGVudHJ5KSA9PiBsYWJlbEZvcihlbnRyeS5yYW5nZSwgcmFuZ2VzLmxlbmd0aCA9PT0gMSkgIT09IG51bGwpO1xufVxuXG4vKiogVGhlIHNwYWNpbmcgYmV0d2VlbiBhIG5hbWUgb2YgYG5hbWVXaWR0aGAgY29sdW1ucyBhbmQgaXRzIHJhbmdlIGNvbHVtbi4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVQYWQobmFtZVdpZHRoOiBudW1iZXIsIHRhcmdldDogbnVtYmVyKTogc3RyaW5nIHtcbiAgaWYgKG5hbWVXaWR0aCA+PSB0YXJnZXQpIHJldHVybiAnICc7XG4gIHJldHVybiAnICcucmVwZWF0KHRhcmdldCAtIG5hbWVXaWR0aCArIDEpO1xufVxuXG4vKipcbiAqIFJlbmRlciBvbmUgbGVhZidzIGxpbmUocykuIEFuIGVtcHR5IGByYW5nZXNgIGFycmF5IGlzIGEgYmFyZS1wYXRoIGxlYWYgd2l0aFxuICogbm8gcmFuZ2UgY29sdW1uIGF0IGFsbCAoZGlzdGluY3QgZnJvbSBhIGB3aG9sZS1maWxlYCBlbnRyeSwgd2hpY2ggaXMgYW5cbiAqIGV4cGxpY2l0IGNsYXNzaWZpY2F0aW9uIHRoYXQgYWxzbyBwcmludHMgd2l0aCB6ZXJvIG1hcmtlciB3aGVuIGl0IHN0YW5kc1xuICogYWxvbmUsIGJ1dCB0aHJvdWdoIHRoZSByYW5nZXMgcGlwZWxpbmUpLiBNdWx0aXBsZSBzdGFja2VkIHJhbmdlcyBwcmludFxuICogdW5kZXIgYSBjb250aW51YXRpb24gcHJlZml4IGluc3RlYWQgb2YgcmVwZWF0aW5nIHRoZSBuYW1lOyBlYWNoIGNhcnJpZXMgaXRzXG4gKiBvd24gc3VmZml4IGluZGVwZW5kZW50bHksIGFuZCBlYWNoIGNhcnJpZXMgYSBsYWJlbCBpZGVudGlmeWluZyB3aGljaCBhbmNob3JcbiAqIHRoZSBzdWZmaXggYmVsb25ncyB0by5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyTGVhZkxpbmVzKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcjogVHJlZUFuY2hvcixcbiAgb3duUHJlZml4OiBzdHJpbmcsXG4gIGNoaWxkUHJlZml4OiBzdHJpbmcsXG4gIGdyb3VwVGFyZ2V0OiBudW1iZXJcbik6IHN0cmluZ1tdIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBbYCR7b3duUHJlZml4fSR7bmFtZX1gXTtcblxuICBjb25zdCBzb3J0ZWQgPSBbLi4ucmFuZ2VzXS5zb3J0KGNvbXBhcmVSYW5nZUVudHJpZXMpO1xuICBjb25zdCBzb2xlID0gc29ydGVkLmxlbmd0aCA9PT0gMTtcbiAgY29uc3QgbmFtZVdpZHRoID0gZGlzcGxheVdpZHRoKG5hbWUpO1xuICBjb25zdCBwYWQgPSBjb21wdXRlUGFkKG5hbWVXaWR0aCwgZ3JvdXBUYXJnZXQpO1xuICBjb25zdCBibGFuayA9ICcgJy5yZXBlYXQobmFtZVdpZHRoICsgcGFkLmxlbmd0aCk7XG5cbiAgcmV0dXJuIHNvcnRlZC5tYXAoKGVudHJ5LCBpKSA9PiB7XG4gICAgY29uc3QgbGFiZWwgPSBsYWJlbEZvcihlbnRyeS5yYW5nZSwgc29sZSk7XG4gICAgaWYgKGxhYmVsID09PSBudWxsKSByZXR1cm4gYCR7b3duUHJlZml4fSR7bmFtZX0ke2VudHJ5LnN1ZmZpeH1gO1xuICAgIGNvbnN0IGJhc2UgPSBpID09PSAwID8gYCR7b3duUHJlZml4fSR7bmFtZX0ke3BhZH1gIDogYCR7Y2hpbGRQcmVmaXh9JHtibGFua31gO1xuICAgIHJldHVybiBgJHtiYXNlfSR7bGFiZWx9JHtlbnRyeS5zdWZmaXh9YDtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlck5vZGVzKG5vZGVzOiBQYXRoVHJlZU5vZGVbXSwgcHJlZml4OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBpdGVtcyA9IG5vZGVzLm1hcChmb2xkQ2hhaW4pO1xuICBjb25zdCBncm91cFRhcmdldCA9IGNvbXB1dGVHcm91cFRhcmdldChpdGVtcyk7XG4gIGl0ZW1zLmZvckVhY2goKGl0ZW0sIGkpID0+IHtcbiAgICBjb25zdCBpc0xhc3QgPSBpID09PSBpdGVtcy5sZW5ndGggLSAxO1xuICAgIGNvbnN0IG93blByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICdcdTI1MTRcdTI1MDAgJyA6ICdcdTI1MUNcdTI1MDAgJ31gO1xuICAgIGNvbnN0IGNoaWxkUHJlZml4ID0gYCR7cHJlZml4fSR7aXNMYXN0ID8gJyAgICcgOiAnXHUyNTAyICAnfWA7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicpIHtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTGVhZkxpbmVzKGl0ZW0ubmFtZSwgaXRlbS5ub2RlLmFuY2hvciwgb3duUHJlZml4LCBjaGlsZFByZWZpeCwgZ3JvdXBUYXJnZXQpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGluZXMucHVzaChgJHtvd25QcmVmaXh9JHtpdGVtLm5hbWV9L2ApO1xuICAgICAgbGluZXMucHVzaCguLi5yZW5kZXJOb2RlcyhpdGVtLm5vZGUuY2hpbGRyZW4sIGNoaWxkUHJlZml4KSk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIGxpbmVzO1xufVxuXG4vKipcbiAqIFJlbmRlciBhIGNvbGxhcHNlZCBhbmNob3IgbGlzdCBhcyBhIGJveC1kcmF3aW5nIHRyZWUsIGdyb3VwZWQgYnkgc2hhcmVkXG4gKiBwYXRoIHByZWZpeC4gRXZlcnkgYW5jaG9yIGxpc3QgcmVuZGVycyBhcyBhIHRyZWUgdW5jb25kaXRpb25hbGx5IFx1MjAxNCBhIHNpbmdsZVxuICogYW5jaG9yIGJlY29tZXMgYSBvbmUtbGluZSB0cmVlIHdoYXRldmVyIGl0cyBkZXB0aCAoc2VlIHtAbGluayBmb2xkQ2hhaW59KTtcbiAqIHRoZXJlIGlzIG5vIGZsYXQtYnVsbGV0IHBhdGggb3Igc2l6ZSBmbG9vciBpbiB0aGlzIG1vZHVsZS5cbiAqXG4gKiBIZWlnaHQgaXMgYm91bmRlZCBieSB7QGxpbmsgZm9sZENoYWlufTogYSBkaXJlY3RvcnkgbGluZSBvbmx5IGV2ZXIgYXBwZWFyc1xuICogd2hlcmUgaXQgZ2VudWluZWx5IGdyb3VwcyB0d28gb3IgbW9yZSBzaWJsaW5ncywgc28gdGhlIHRyZWUgYWRkcyBhdCBtb3N0XG4gKiBvbmUgbGluZSBwZXIgcmVhbCBncm91cGluZyBhbmQgbmV2ZXIgb25lIHBlciBwYXRoIHNlZ21lbnQuXG4gKlxuICogVG90YWwgZm9yIGFueSB3ZWxsLWZvcm1lZCBgVHJlZUFuY2hvcltdYDogZGVnZW5lcmF0ZSBwYXRocyAocnVsZSBlbmZvcmNlZFxuICogaW4ge0BsaW5rIHNwbGl0U2VnbWVudHN9KSBhcmUgbm9ybWFsaXplZCB0byBhdG9taWMgbGVhdmVzIHJhdGhlciB0aGFuXG4gKiB0aHJvd24gb24sIHNvIHRoaXMgZnVuY3Rpb24gbmV2ZXIgbmVlZHMgYW4gaW50ZXJuYWwgdHJ5L2NhdGNoLiBDYWxsZXJzIGFkZFxuICogdGhlaXIgb3duIGNhdGNoIGFyb3VuZCB0aGlzIGNhbGwgaW4gYSBsYXRlciBwaGFzZSAoZmFpbC1vcGVuIGRpc2NpcGxpbmVcbiAqIGxpdmVzIGF0IHRoZSBjYWxsIHNpdGUsIG5vdCBoZXJlKS5cbiAqXG4gKiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlcyBhdCBtb3N0IG9uZSBgVHJlZUFuY2hvcmAgcGVyXG4gKiBkaXN0aW5jdCBgcGF0aGAgXHUyMDE0IHBhc3MgYW5jaG9ycyB0aHJvdWdoIHtAbGluayBjb2xsYXBzZUJ5UGF0aH0gZmlyc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJBbmNob3JUcmVlKGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3QgZm9yZXN0ID0gYnVpbGRGb3Jlc3QoYW5jaG9ycyk7XG4gIHJldHVybiByZW5kZXJOb2Rlcyhmb3Jlc3QsICcnKTtcbn1cbiIsICIvKipcbiAqIENvZGV4IGBhcHBseV9wYXRjaGAgZW52ZWxvcGUgcGFyc2VyLlxuICpcbiAqIFR1cm5zIGEgQ29kZXggYGFwcGx5X3BhdGNoYCBgdG9vbF9pbnB1dC5jb21tYW5kYCBwYXRjaCBzdHJpbmcgaW50byB0aGVcbiAqIGBBbmNob3JTcGVjW11gIHNoYXBlIHRoZSBzaGFyZWQgdG91Y2ggY29yZSBhbHJlYWR5IGNvbnN1bWVzIFx1MjAxNCB0aGUgb25lXG4gKiBnZW51aW5lbHkgbmV3IGFsZ29yaXRobSB0aGUgQ29kZXggYWRhcHRlciBuZWVkcy4gSXQgcmVwbGFjZXMgdGhlIHN0cnVjdHVyZWRcbiAqIGBmaWxlX3BhdGhgL2BvbGRfc3RyaW5nYC9gb2Zmc2V0YCByZWFkaW5nIHRoZSBDbGF1ZGUgUG9zdFRvb2xVc2UgdG91Y2ggaG9va1xuICogZG9lcywgYmVjYXVzZSBDb2RleCBkZWxpdmVycyBldmVyeSBlZGl0IGFzIGEgc2luZ2xlIGFwcGx5X3BhdGNoIGVudmVsb3BlXG4gKiByYXRoZXIgdGhhbiBhIHR5cGVkIHRvb2wgaW5wdXQuXG4gKlxuICogVGhlIG1vZHVsZSBpcyBwdXJlOiBpdCBpbXBvcnRzIG9ubHkgdGhlIGtlcm5lbCBhbmNob3IgdHlwZXMgYW5kIG5ldmVyIHRvdWNoZXNcbiAqIHRoZSBDb2RleCBTREssIHNvIGl0IGlzIERJLXRlc3RhYmxlIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlXG4gKiBzaGFyZWQga2VybmVsLiBSYW5nZSByZWNvdmVyeSBpcyBiZXN0LWVmZm9ydCBcdTIwMTQgdGhlIGFwcGx5X3BhdGNoIGZvcm1hdCBjYXJyaWVzXG4gKiBgQEBgIGNvbnRleHQgYW5kIGArYC9gLWAvc3BhY2UgY2hhbmdlIGxpbmVzIGJ1dCBubyBleHBsaWNpdCBsaW5lIG51bWJlcnMsIHNvIGFcbiAqIHJhbmdlIGNhbiBvbmx5IGJlIHJlY292ZXJlZCBieSBsb2NhdGluZyBhIGh1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGVcbiAqIG9uLWRpc2sgZmlsZS4gVGhhdCBmaWxlIHJlYWQgaXMgaW5qZWN0ZWQgKGByZWFkUHJlRWRpdEZpbGVgKSBzbyB0aGUgZnVuY3Rpb25cbiAqIHN0YXlzIHB1cmUgYW5kIHRlc3RhYmxlLiBPbiBBTlkgYW1iaWd1aXR5IChubyByZWFkZXIsIGZpbGUgbWlzc2luZywgY29udGV4dFxuICogbm90IGZvdW5kLCBmdXp6eS9kdXBsaWNhdGUgbWF0Y2gpIHRoZSBwYXJzZXIgZGVncmFkZXMgdG8gYSB3aG9sZS1maWxlIGFuY2hvclxuICogcmF0aGVyIHRoYW4gdGhyb3dpbmcgXHUyMDE0IHdob2xlLWZpbGUgYW5jaG9ycyBhcmUgZmlyc3QtY2xhc3MgYW5kIHRvdWNoIHRyYWNraW5nXG4gKiBtdXN0IG5ldmVyIGJlIGJsb2NrZWQuXG4gKlxuICogVGhlIGdyYW1tYXIgaXMgY3Jvc3MtY2hlY2tlZCBhZ2FpbnN0IENvZGV4J3Mgb3duIGFwcGx5X3BhdGNoIGNyYXRlXG4gKiAoY29kZXgtcnMvYXBwbHktcGF0Y2gvc3JjL3twYXJzZXIsc3RyZWFtaW5nX3BhcnNlcn0ucnMpLiBUd28gc3VidGxldGllcyBhcmVcbiAqIG1pcnJvcmVkIGRlbGliZXJhdGVseTogaHVuay1oZWFkZXIgbWFya2VycyBhcmUgb25seSByZWNvZ25pemVkIGF0IHRoZSBzdGFydCBvZlxuICogYSBsaW5lIHdpdGggbm8gbGVhZGluZyB3aGl0ZXNwYWNlIHdoaWxlIGluc2lkZSBhbiBVcGRhdGUgaHVuayAoYSBsZWFkaW5nIHNwYWNlXG4gKiBkZW1vdGVzIGEgbWFya2VyIHRvIGEgY29udGV4dCBsaW5lKSwgYW5kIGEgYmFyZSBlbXB0eSBsaW5lIGluc2lkZSBhbiBVcGRhdGVcbiAqIGh1bmsgaXMgdHJlYXRlZCBhcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgcHJlc2VudCBpbiBib3RoIG9sZCBhbmQgbmV3IGNvbnRlbnQuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgdHlwZSB7IEFuY2hvclNwZWMsIExpbmVSYW5nZSB9IGZyb20gJy4uL2NvbW1vbi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuXG4vKipcbiAqIFJlYWRzIHRoZSBwcmUtZWRpdCAob24tZGlzaywgYmVmb3JlIHRoZSBwYXRjaCBhcHBsaWVzKSBjb250ZW50IG9mIHRoZSBmaWxlIGF0XG4gKiBgcGF0aGAsIG9yIHJldHVybnMgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIHJlYWQuIEluamVjdGVkIHNvIHRoZSBwYXJzZXIgc3RheXNcbiAqIHB1cmU7IGNhbGwgc2l0ZXMgZGVmYXVsdCB0byBhIHJlYWwgZmlsZXN5c3RlbSByZWFkLlxuICovXG5leHBvcnQgdHlwZSBSZWFkUHJlRWRpdEZpbGUgPSAocGF0aDogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEdyYW1tYXIgbWFya2VycyAobWlycm9ycyBjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMvcGFyc2VyLnJzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IEVORF9QQVRDSF9NQVJLRVIgPSAnKioqIEVuZCBQYXRjaCc7XG5jb25zdCBBRERfRklMRV9NQVJLRVIgPSAnKioqIEFkZCBGaWxlOiAnO1xuY29uc3QgREVMRVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBEZWxldGUgRmlsZTogJztcbmNvbnN0IFVQREFURV9GSUxFX01BUktFUiA9ICcqKiogVXBkYXRlIEZpbGU6ICc7XG5jb25zdCBNT1ZFX1RPX01BUktFUiA9ICcqKiogTW92ZSB0bzogJztcbmNvbnN0IEVPRl9NQVJLRVIgPSAnKioqIEVuZCBvZiBGaWxlJztcbmNvbnN0IENIQU5HRV9DT05URVhUX01BUktFUiA9ICdAQCAnO1xuY29uc3QgRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbnRlcm1lZGlhdGUgaHVuayBtb2RlbFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBVcGRhdGVDaHVuayB7XG4gIC8qKiBPcHRpb25hbCBgQEAgPGNvbnRleHQ+YCBsaW5lIHVzZWQgdG8gZGlzYW1iaWd1YXRlIHRoZSBibG9jaydzIGxvY2F0aW9uLiAqL1xuICBjaGFuZ2VDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKiogUHJlLWVkaXQgbGluZXMgdGhpcyBjaHVuayBjb3ZlcnMgKGNvbnRleHQgYCBgICsgcmVtb3ZlZCBgLWApLCBpbiBvcmRlci4gKi9cbiAgb2xkTGluZXM6IHN0cmluZ1tdO1xuICAvKiogUG9zdC1lZGl0IGxpbmVzIChjb250ZXh0IGAgYCArIGFkZGVkIGArYCk7IHJldGFpbmVkIGZvciBjb21wbGV0ZW5lc3MuICovXG4gIG5ld0xpbmVzOiBzdHJpbmdbXTtcbn1cblxudHlwZSBIdW5rID1cbiAgfCB7IGtpbmQ6ICdhZGQnOyBwYXRoOiBzdHJpbmcgfVxuICB8IHsga2luZDogJ2RlbGV0ZSc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAndXBkYXRlJzsgcGF0aDogc3RyaW5nOyBtb3ZlUGF0aDogc3RyaW5nIHwgbnVsbDsgY2h1bmtzOiBVcGRhdGVDaHVua1tdIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCByZWFkZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlYWwtZmlsZXN5c3RlbSByZWFkZXIgdXNlZCB3aGVuIG5vIHJlYWRlciBpcyBpbmplY3RlZC4gQmVzdC1lZmZvcnQ6IGFueVxuICogZmFpbHVyZSAobWlzc2luZyBmaWxlLCBwZXJtaXNzaW9uIGVycm9yKSB5aWVsZHMgYG51bGxgLCB3aGljaCB0aGUgcGFyc2VyXG4gKiBkZWdyYWRlcyB0byBhIHdob2xlLWZpbGUgYW5jaG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFJlYWRQcmVFZGl0RmlsZShwYXRoOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZnMucmVhZEZpbGVTeW5jKHBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEVudmVsb3BlIHNjYW5uaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTY2FuIHRoZSBwYXRjaCB0ZXh0IGludG8gaHVua3MuIExlbmllbnQgYnkgZGVzaWduOiB1bnJlY29nbml6ZWQgbGluZXMgYXJlXG4gKiBpZ25vcmVkIHJhdGhlciB0aGFuIHJlamVjdGVkLCBhbmQgQmVnaW4vRW5kL0Vudmlyb25tZW50IGxpbmVzIGFyZSBza2lwcGVkLCBzb1xuICogYSBtYWxmb3JtZWQgZW52ZWxvcGUgZGVncmFkZXMgdG8gd2hhdGV2ZXIgaHVua3MgY291bGQgYmUgcmVjb3ZlcmVkIChvZnRlblxuICogbm9uZSBcdTIxOTIgYFtdYCkgaW5zdGVhZCBvZiB0aHJvd2luZy5cbiAqL1xuZnVuY3Rpb24gc2Nhbkh1bmtzKGNvbW1hbmQ6IHN0cmluZyk6IEh1bmtbXSB7XG4gIGNvbnN0IGh1bmtzOiBIdW5rW10gPSBbXTtcbiAgLy8gVGhlIGN1cnJlbnRseS1vcGVuIFVwZGF0ZSBodW5rLCBvciBudWxsLiBBZGQvRGVsZXRlIGh1bmtzIGhhdmUgbm8gYm9keSwgc29cbiAgLy8gdGhleSBjbG9zZSBpbW1lZGlhdGVseSBhbmQgcmVzZXQgdGhpcyB0byBudWxsLlxuICBsZXQgb3BlblVwZGF0ZTogKEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pIHwgbnVsbCA9IG51bGw7XG5cbiAgZm9yIChjb25zdCByYXcgb2YgY29tbWFuZC5zcGxpdCgnXFxuJykpIHtcbiAgICAvLyBIZWFkZXIgZGV0ZWN0aW9uIGlzIHdoaXRlc3BhY2Utc2Vuc2l0aXZlIGluc2lkZSBhbiBVcGRhdGUgaHVuazogQ29kZXggdXNlc1xuICAgIC8vIHRyaW1fZW5kIHRoZXJlIChsZWFkaW5nIHNwYWNlIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpIGFuZCBmdWxsXG4gICAgLy8gdHJpbSBlbHNld2hlcmUuIE1hdGNoIHRoYXQgc28gaW5kZW50ZWQgbWFya2VycyBpbnNpZGUgYSBodW5rIHN0YXkgY29udGVudC5cbiAgICBjb25zdCBoZWFkZXJMaW5lOiBzdHJpbmcgPSBvcGVuVXBkYXRlID8gcmF3LnJlcGxhY2UoL1sgXFx0XFxyXSskLywgJycpIDogcmF3LnRyaW0oKTtcblxuICAgIGlmIChoZWFkZXJMaW5lID09PSBFTkRfUEFUQ0hfTUFSS0VSKSB7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKEFERF9GSUxFX01BUktFUikpIHtcbiAgICAgIGh1bmtzLnB1c2goeyBraW5kOiAnYWRkJywgcGF0aDogaGVhZGVyTGluZS5zbGljZShBRERfRklMRV9NQVJLRVIubGVuZ3RoKSB9KTtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoREVMRVRFX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdkZWxldGUnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKERFTEVURV9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChVUERBVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBjb25zdCBodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9ID0ge1xuICAgICAgICBraW5kOiAndXBkYXRlJyxcbiAgICAgICAgcGF0aDogaGVhZGVyTGluZS5zbGljZShVUERBVEVfRklMRV9NQVJLRVIubGVuZ3RoKSxcbiAgICAgICAgbW92ZVBhdGg6IG51bGwsXG4gICAgICAgIGNodW5rczogW11cbiAgICAgIH07XG4gICAgICBodW5rcy5wdXNoKGh1bmspO1xuICAgICAgb3BlblVwZGF0ZSA9IGh1bms7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAob3BlblVwZGF0ZSkge1xuICAgICAgcHJvY2Vzc1VwZGF0ZUxpbmUob3BlblVwZGF0ZSwgcmF3KTtcbiAgICB9XG4gICAgLy8gQW55IG90aGVyIGxpbmUgb3V0c2lkZSBhbiBVcGRhdGUgaHVuayAoQmVnaW4gUGF0Y2gsIEVudmlyb25tZW50IElELCBBZGRcbiAgICAvLyBGaWxlIGArYCBjb250ZW50LCBzdHJheSB0ZXh0KSBpcyBpZ25vcmVkLlxuICB9XG5cbiAgcmV0dXJuIGh1bmtzO1xufVxuXG5mdW5jdGlvbiBlbnN1cmVDaHVuayhodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9KTogVXBkYXRlQ2h1bmsge1xuICBjb25zdCBsYXN0ID0gaHVuay5jaHVua3NbaHVuay5jaHVua3MubGVuZ3RoIC0gMV07XG4gIGlmIChsYXN0KSByZXR1cm4gbGFzdDtcbiAgY29uc3QgY2h1bms6IFVwZGF0ZUNodW5rID0geyBjaGFuZ2VDb250ZXh0OiBudWxsLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9O1xuICBodW5rLmNodW5rcy5wdXNoKGNodW5rKTtcbiAgcmV0dXJuIGNodW5rO1xufVxuXG4vKiogQXBwbHkgb25lIGJvZHkgbGluZSBvZiBhbiBVcGRhdGUgaHVuayB0byBpdHMgY2h1bmsgbGlzdC4gKi9cbmZ1bmN0aW9uIHByb2Nlc3NVcGRhdGVMaW5lKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0sIHJhdzogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHRyaW1tZWRFbmQgPSByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJyk7XG5cbiAgaWYgKHRyaW1tZWRFbmQgPT09IEVPRl9NQVJLRVIpIHJldHVybjsgLy8gZW5kLW9mLWZpbGUgaGludDsgbm90IG5lZWRlZCBmb3IgcmFuZ2VzXG5cbiAgLy8gYCoqKiBNb3ZlIHRvOmAgaXMgb25seSBtZWFuaW5nZnVsIGJlZm9yZSBhbnkgY2hhbmdlIGNvbnRlbnQuXG4gIGlmIChodW5rLmNodW5rcy5sZW5ndGggPT09IDAgJiYgaHVuay5tb3ZlUGF0aCA9PT0gbnVsbCAmJiB0cmltbWVkRW5kLnN0YXJ0c1dpdGgoTU9WRV9UT19NQVJLRVIpKSB7XG4gICAgaHVuay5tb3ZlUGF0aCA9IHRyaW1tZWRFbmQuc2xpY2UoTU9WRV9UT19NQVJLRVIubGVuZ3RoKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSB7XG4gICAgaHVuay5jaHVua3MucHVzaCh7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodHJpbW1lZEVuZC5zdGFydHNXaXRoKENIQU5HRV9DT05URVhUX01BUktFUikpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogdHJpbW1lZEVuZC5zbGljZShDSEFOR0VfQ09OVEVYVF9NQVJLRVIubGVuZ3RoKSwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gQSBiYXJlIGVtcHR5IGxpbmUgaXMgYW4gZW1wdHkgY29udGV4dCBsaW5lIChwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcpLlxuICBpZiAocmF3ID09PSAnJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaCgnJyk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaCgnJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZpcnN0ID0gcmF3WzBdO1xuICBpZiAoZmlyc3QgPT09ICcgJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY29uc3QgY29udGVudCA9IHJhdy5zbGljZSgxKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKGNvbnRlbnQpO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2goY29udGVudCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJysnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJy0nKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIFVucmVjb2duaXplZCBjb250ZW50IGxpbmUgXHUyMDE0IGlnbm9yZSBsZW5pZW50bHkgcmF0aGVyIHRoYW4gdGhyb3cuXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3BsaXQgZmlsZSBjb250ZW50IGludG8gbGluZXMgZm9yIG1hdGNoaW5nLiBBIHRyYWlsaW5nIG5ld2xpbmUgeWllbGRzIGFcbiAqIHRyYWlsaW5nIGVtcHR5IGVsZW1lbnQsIHdoaWNoIGlzIGhhcm1sZXNzIGZvciBzdWItc2xpY2UgbWF0Y2hpbmcuICovXG5mdW5jdGlvbiBzcGxpdExpbmVzKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIGNvbnRlbnQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKiogSW5kaWNlcyAoMC1iYXNlZCkgYXQgd2hpY2ggYHZhbHVlYCBhcHBlYXJzIGFzIGEgZnVsbCBsaW5lIGluIGBsaW5lc2AuICovXG5mdW5jdGlvbiBsaW5lSW5kaWNlcyhsaW5lczogc3RyaW5nW10sIHZhbHVlOiBzdHJpbmcpOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChsaW5lc1tpXSA9PT0gdmFsdWUpIG91dC5wdXNoKGkpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBTdGFydCBpbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgbmVlZGxlYCBtYXRjaGVzIGNvbnRpZ3VvdXNseSBpbiBgaGF5c3RhY2tgLiAqL1xuZnVuY3Rpb24gY29udGlndW91c01hdGNoZXMoaGF5c3RhY2s6IHN0cmluZ1tdLCBuZWVkbGU6IHN0cmluZ1tdKTogbnVtYmVyW10ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwIHx8IG5lZWRsZS5sZW5ndGggPiBoYXlzdGFjay5sZW5ndGgpIHJldHVybiBvdXQ7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBmb3IgKGxldCBpID0gMDsgaSA8PSBsYXN0OyBpKyspIHtcbiAgICBsZXQgb2sgPSB0cnVlO1xuICAgIGZvciAobGV0IGogPSAwOyBqIDwgbmVlZGxlLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaGF5c3RhY2tbaSArIGpdICE9PSBuZWVkbGVbal0pIHtcbiAgICAgICAgb2sgPSBmYWxzZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChvaykgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBMb2NhdGUgYSBzaW5nbGUgY2h1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGUgZmlsZSwgcmV0dXJuaW5nIGl0cyAxLWJhc2VkXG4gKiBsaW5lIHJhbmdlIG9yIG51bGwgd2hlbiBpdCBjYW5ub3QgYmUgbG9jYXRlZCB1bmFtYmlndW91c2x5LlxuICpcbiAqIC0gTm9uLWVtcHR5IGJsb2NrOiByZXF1aXJlIGEgdW5pcXVlIGNvbnRpZ3VvdXMgbWF0Y2gsIG9yIFx1MjAxNCB3aGVuIGR1cGxpY2F0ZWQgXHUyMDE0XG4gKiAgIGEgYEBAYCBjaGFuZ2UtY29udGV4dCBsaW5lIHRoYXQgc2VsZWN0cyB0aGUgb2NjdXJyZW5jZSBhZnRlciBpdC5cbiAqIC0gRW1wdHkgYmxvY2sgKHB1cmUgaW5zZXJ0aW9uKTogYW5jaG9yIG9uIGEgdW5pcXVlIGNoYW5nZS1jb250ZXh0IGxpbmUgaWYgb25lXG4gKiAgIGlzIGdpdmVuOyBvdGhlcndpc2UgaXQgaXMgdW5sb2NhdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGxvY2F0ZUNodW5rKHByZUxpbmVzOiBzdHJpbmdbXSwgY2h1bms6IFVwZGF0ZUNodW5rKTogTGluZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IGJsb2NrID0gY2h1bmsub2xkTGluZXM7XG5cbiAgaWYgKGJsb2NrLmxlbmd0aCA9PT0gMCkge1xuICAgIGNvbnN0IGN0eCA9IGNodW5rLmNoYW5nZUNvbnRleHQ7XG4gICAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgICBjb25zdCBjdHhJZHhzID0gbGluZUluZGljZXMocHJlTGluZXMsIGN0eCk7XG4gICAgICBpZiAoY3R4SWR4cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgY29uc3QgbGluZSA9IGN0eElkeHNbMF0gKyAxO1xuICAgICAgICByZXR1cm4geyBzdGFydDogbGluZSwgZW5kOiBsaW5lIH07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3Qgc3RhcnRzID0gY29udGlndW91c01hdGNoZXMocHJlTGluZXMsIGJsb2NrKTtcbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBzID0gc3RhcnRzWzBdO1xuICAgIHJldHVybiB7IHN0YXJ0OiBzICsgMSwgZW5kOiBzICsgYmxvY2subGVuZ3RoIH07XG4gIH1cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIER1cGxpY2F0ZWQgYmxvY2s6IHVzZSB0aGUgY2hhbmdlIGNvbnRleHQgdG8gc2VsZWN0IHRoZSBtYXRjaCBhZnRlciBpdC5cbiAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgZm9yIChjb25zdCBjIG9mIGxpbmVJbmRpY2VzKHByZUxpbmVzLCBjdHgpKSB7XG4gICAgICBjb25zdCBhZnRlciA9IHN0YXJ0cy5maW5kKChzKSA9PiBzID49IGMpO1xuICAgICAgaWYgKGFmdGVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IGFmdGVyICsgMSwgZW5kOiBhZnRlciArIGJsb2NrLmxlbmd0aCB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDsgLy8gYW1iaWd1b3VzIFx1MjE5MiBjYWxsZXIgZGVncmFkZXMgdG8gd2hvbGUtZmlsZVxufVxuXG4vKipcbiAqIFJlY292ZXIgYSBzaW5nbGUgbGluZSByYW5nZSBzcGFubmluZyBhbGwgb2YgYW4gdXBkYXRlJ3MgY2h1bmtzLiBSZXR1cm5zIG51bGxcbiAqIChcdTIxOTIgd2hvbGUtZmlsZSBmYWxsYmFjaykgaWYgYW55IGNodW5rIGNhbm5vdCBiZSBsb2NhdGVkLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2UocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVua3M6IFVwZGF0ZUNodW5rW10pOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgbGV0IHVuaW9uOiBMaW5lUmFuZ2UgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBjaHVuayBvZiBjaHVua3MpIHtcbiAgICBjb25zdCByID0gbG9jYXRlQ2h1bmsocHJlTGluZXMsIGNodW5rKTtcbiAgICBpZiAociA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgdW5pb24gPSB1bmlvbiA9PT0gbnVsbCA/IHIgOiB7IHN0YXJ0OiBNYXRoLm1pbih1bmlvbi5zdGFydCwgci5zdGFydCksIGVuZDogTWF0aC5tYXgodW5pb24uZW5kLCByLmVuZCkgfTtcbiAgfVxuICByZXR1cm4gdW5pb247XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIEFQSVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUGFyc2UgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGNvbW1hbmQgc3RyaW5nIGludG8gYW4gYW5jaG9yIHBlciB0b3VjaGVkIGZpbGUuXG4gKlxuICogLSBgKioqIEFkZCBGaWxlOmAgXHUyMTkyIGBjcmVhdGVgICh3aG9sZS1maWxlKVxuICogLSBgKioqIERlbGV0ZSBGaWxlOmAgXHUyMTkyIGB3aG9sZS13cml0ZWAgKHdob2xlLWZpbGU7IHRoZSBmaWxlIG5vIGxvbmdlciBleGlzdHMpXG4gKiAtIGAqKiogVXBkYXRlIEZpbGU6YCBcdTIxOTIgYHdyaXRlYCB3aXRoIGEgcmVjb3ZlcmVkIGxpbmUgcmFuZ2Ugd2hlbiB0aGUgaHVuaydzXG4gKiAgIHByZS1lZGl0IGJsb2NrIGNhbiBiZSBsb2NhdGVkIHZpYSBgcmVhZFByZUVkaXRGaWxlYCwgb3RoZXJ3aXNlIGB3aG9sZS13cml0ZWAuXG4gKiAgIEEgcmVuYW1lZCB1cGRhdGUgKGAqKiogTW92ZSB0bzpgKSBhbmNob3JzIHRoZSBkZXN0aW5hdGlvbiBwYXRoIGFzXG4gKiAgIGB3aG9sZS13cml0ZWAgc2luY2UgcHJlLWVkaXQgbGluZSBudW1iZXJzIGNhbm5vdCBiZSBtYXBwZWQgYWNyb3NzIGEgcmVuYW1lLlxuICpcbiAqIE5ldmVyIHRocm93czogYSBtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggeWllbGRzIGBbXWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUFwcGx5UGF0Y2goXG4gIGNvbW1hbmQ6IHN0cmluZyxcbiAgcmVhZFByZUVkaXRGaWxlOiBSZWFkUHJlRWRpdEZpbGUgPSBkZWZhdWx0UmVhZFByZUVkaXRGaWxlXG4pOiBBbmNob3JTcGVjW10ge1xuICBjb25zdCBhbmNob3JzOiBBbmNob3JTcGVjW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGh1bmsgb2Ygc2Nhbkh1bmtzKGNvbW1hbmQpKSB7XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2FkZCcpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ2NyZWF0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ3dob2xlLXdyaXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZTogYW5jaG9yIG9uIHRoZSBkZXN0aW5hdGlvbiBwYXRoIChwb3N0LWVkaXQgbG9jYXRpb24pLlxuICAgIGNvbnN0IHRhcmdldFBhdGggPSB0b1Bvc2l4KGh1bmsubW92ZVBhdGggPz8gaHVuay5wYXRoKTtcblxuICAgIC8vIEEgcmVuYW1lIGRlZmVhdHMgcHJlLWVkaXQgbGluZSBtYXBwaW5nIFx1MjAxNCBhbmNob3Igd2hvbGUtZmlsZSBvbiB0aGUgdGFyZ2V0LlxuICAgIGlmIChodW5rLm1vdmVQYXRoICE9PSBudWxsKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gUmFuZ2UgcmVjb3ZlcnkgcmVhZHMgdGhlIHByZS1lZGl0IGNvbnRlbnQgYXQgdGhlIG9yaWdpbmFsIChwcmUtbW92ZSkgcGF0aC5cbiAgICBjb25zdCBjb250ZW50ID0gcmVhZFByZUVkaXRGaWxlKGh1bmsucGF0aCk7XG4gICAgY29uc3QgcmFuZ2UgPSBjb250ZW50ID09PSBudWxsID8gbnVsbCA6IHJlY292ZXJSYW5nZShzcGxpdExpbmVzKGNvbnRlbnQpLCBodW5rLmNodW5rcyk7XG4gICAgaWYgKHJhbmdlICE9PSBudWxsKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd3JpdGUnLCByYW5nZSB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dob2xlLXdyaXRlJyB9KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYW5jaG9ycztcbn1cbiIsICIvKipcbiAqIENvZGV4IFBvc3RUb29sVXNlIHRvdWNoIGhvb2sgXHUyMDE0IGhlYWwgKyBzdXJmYWNlIGFmdGVyIGEgY29uZmlybWVkIGBhcHBseV9wYXRjaGAsXG4gKiBvciBhIHNoZWxsL2V4ZWMgY2FsbCB3aG9zZSBjb21tYW5kIHN0YXRpY2FsbHkgcmVzb2x2ZXMgdG8gZmlsZStsaW5lIGlkaW9tcy5cbiAqXG4gKiBQb3N0VG9vbFVzZSBmaXJlcyBhZnRlciBgYXBwbHlfcGF0Y2hgIGhhcyBydW4sIHNvIHRoaXMgaXMgdGhlIGFjY3VyYXRlIGhvbWUgZm9yXG4gKiB0aGUgdG91Y2ggc2lnbmFsOiB0aGUgZmlsZSBpcyBhbHJlYWR5IHdyaXR0ZW4sIHNvIGEgc2NvcGVkIGBnaXQgc3BhbiBzdGFsZVxuICogPGZpbGU+IC0tZml4YCBoZWFscyBwb3NpdGlvbmFsIGRyaWZ0IGFnYWluc3QgcmVhbCBieXRlcyBhbmQgdGhlIHN1cmZhY2VkIGJsb2NrXG4gKiByZWZsZWN0cyB0aGUgaGVhbGVkIGFuY2hvcnMuIFRoZSBoYW5kbGVyIG5hcnJvd3MgdGhlIGBhcHBseV9wYXRjaGAgZW52ZWxvcGVcbiAqIChgdG9vbF9pbnB1dC5jb21tYW5kYCwgU0RLLXR5cGVkIGB1bmtub3duYCkgaW50byBwZXItZmlsZSBhbmNob3JzIHZpYSB0aGVcbiAqIHNoYXJlZCBbYXBwbHktcGF0Y2ggcGFyc2VyXSguL2FwcGx5LXBhdGNoLnRzKSwgYW5kIHJlY292ZXJzIHNoZWxsIGNvbW1hbmRzXG4gKiBmcm9tIGVpdGhlciBDb2RleCBlbnZlbG9wZSAoY2xhc3NpYyBgZXhlY19jb21tYW5kYCBKU09OIGBhcmd1bWVudHNgLCBvclxuICogY29kZS1tb2RlIGBleGVjYCB3cmFwcGluZyBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWApIHZpYSB0aGUgc2hhcmVkXG4gKiBbY29tbWFuZCBwYXJzZXJdKC4uL2NvbW1vbi9wYXJzZS1jb21tYW5kLnRzKTsgZWFjaCB0b3VjaGVkIGZpbGUgaXMgc2NvcGVkIHRvXG4gKiB0aGUgQ1dEIHJlcG8sIGFuZCBkcml2ZXMgdGhlIGhhcm5lc3MtYWdub3N0aWMge0BsaW5rIHJ1blRvdWNoSG9va30gY29yZSBcdTIwMTQgdGhlXG4gKiBzYW1lIGNvcmUgdGhlIENsYXVkZSBhZGFwdGVyIHVzZXMuXG4gKlxuICogVHdvIENvZGV4LXNwZWNpZmljIGNvbmNlcm5zIGFyZSBwcmVzZXJ2ZWQgZnJvbSB0aGlzIGZpbGUncyBqb3VybmFsaW5nXG4gKiBwcmVkZWNlc3NvcjpcbiAqXG4gKiAxLiAqKlN1Y2Nlc3MgY2xhc3NpZmljYXRpb24uKiogVGhlIHBhcnNlZCBlbnZlbG9wZSBkZXNjcmliZXMgKmludGVudCosIG5vdFxuICogICAgKm91dGNvbWUqLiBDb2RleCBjb3JlIGZpcmVzIFBvc3RUb29sVXNlIG9ubHkgb24gdG9vbCBzdWNjZXNzLCBidXQgYXMgYVxuICogICAgZHVyYWJpbGl0eSBiZWx0IHdlIGNsYXNzaWZ5IGB0b29sX3Jlc3BvbnNlYCB2aWFcbiAqICAgIHtAbGluayBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZX06IGEgY29uZmlybWVkIHJlamVjdGlvbiAoYCdmYWlsdXJlJ2ApXG4gKiAgICBzdXBwcmVzc2VzIHRoZSB0b3VjaCAobm8gcGhhbnRvbSBoZWFsL3N1cmZhY2Ugb24gYSBwYXRjaCB0aGF0IG5ldmVyXG4gKiAgICBhcHBsaWVkKTsgYSBzdWNjZXNzIG9yIGFuIHVucmVjb2duaXplZCBzaGFwZSAoYCd1bmtub3duJ2AsIHdhcm5lZCkgcHJvY2VlZHMuXG4gKiAyLiAqKk5vIHBvc3QtZWRpdCByYW5nZSByZWNvdmVyeSBmcm9tIHRoZSBlbnZlbG9wZS4qKiBQb3N0VG9vbFVzZSBydW5zIGFmdGVyXG4gKiAgICB0aGUgcGF0Y2ggcmV3cm90ZSB0aGUgZmlsZSwgc28gdGhlIGh1bmsncyBwcmUtZWRpdCBibG9jayBubyBsb25nZXIgc2l0c1xuICogICAgd2hlcmUgdGhlIGVkaXQgaGFwcGVuZWQgYW5kIGNvdWxkIG1pcy1hbmNob3IgYSBkdXBsaWNhdGUuIFRoZSB0b3VjaCBpc1xuICogICAgc2NvcGVkIGZpbGUtd2lkZSAoYHdyaXR0ZW46ICcnYCBcdTIxOTIgd2hvbGUtZmlsZSksIHdoaWNoIGlzIGV4YWN0bHkgdGhlXG4gKiAgICBiZWhhdmlvciB7QGxpbmsgcnVuVG91Y2hIb29rfSB0YWtlcyBmb3IgYW4gZW1wdHkgd3JpdGUuXG4gKlxuICogVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGluIHRoZSBoYW5kbGVyIGNvbmZpZyAodGhlIENMSSBlbWl0cyBgMTBgIHNlY29uZHMpXG4gKiBcdTIwMTQgc2VlIHRoZSB0aW1lb3V0LXVuaXRzIHNwaWtlIG5vdGU7IHRoZSBzb3VyY2UgdmFsdWUgbXVzdCBzdGF5IGluIG1zIHNvIHRoZVxuICogQ29kZXggYnVpbGQncyBzZWNvbmRzIGNvbnZlcnNpb24gYXQgZW1pdCByZW1haW5zIGNvcnJlY3QuXG4gKi9cblxuaW1wb3J0IHsgdHlwZSBIb29rQ29udGV4dCwgdHlwZSBQb3N0VG9vbFVzZUlucHV0LCBwb3N0VG9vbFVzZUhvb2ssIHBvc3RUb29sVXNlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NvZGV4LWhvb2tzJztcbmltcG9ydCB7IGFic3BhdGhBZ2FpbnN0IH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBwYXJzZUNvbW1hbmREZXRhaWxlZCB9IGZyb20gJy4uL2NvbW1vbi9wYXJzZS1jb21tYW5kLmpzJztcbmltcG9ydCB7IGNyZWF0ZURpc2tNZW1vU3RvcmUsIHR5cGUgTWVtb0ZhY3RvcnksIHJlc29sdmVUb3VjaFNjb3BlIH0gZnJvbSAnLi4vY29tbW9uL3NwYW4tc3VyZmFjZS5qcyc7XG5pbXBvcnQge1xuICBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMsXG4gIHJ1blRvdWNoSG9vayxcbiAgdHlwZSBUb3VjaEV4ZWN1dG9ycyxcbiAgdHlwZSBUb3VjaElucHV0XG59IGZyb20gJy4uL2NvbW1vbi90b3VjaC1jb3JlLmpzJztcbmltcG9ydCB7IHBhcnNlQXBwbHlQYXRjaCB9IGZyb20gJy4vYXBwbHktcGF0Y2guanMnO1xuXG4vKipcbiAqIFRoZSBwcmVmaXggYXBwbHlfcGF0Y2gncyBzdGRvdXQgY2FycmllcyB3aGVuIFx1MjAxNCBhbmQgb25seSB3aGVuIFx1MjAxNCB0aGUgcGF0Y2hcbiAqIGFwcGxpZWQgKGNvZGV4LXJzL2FwcGx5LXBhdGNoIGBwcmludF9zdW1tYXJ5YCkuIENvZGV4IHN1cmZhY2VzIHRoYXQgc3Rkb3V0XG4gKiB2ZXJiYXRpbSBhcyB0aGUgUG9zdFRvb2xVc2UgYHRvb2xfcmVzcG9uc2VgIChhIGJhcmUgc3RyaW5nIHRvZGF5KS4gRml4ZWRcbiAqIGFjcm9zcyBBZGQvTW9kaWZ5L0RlbGV0ZTsgdGhlIGhlYWRlciBpcyBmb2xsb3dlZCBieSBgQS9NL0QgPHBhdGg+YCBsaW5lcy5cbiAqL1xuY29uc3QgQVBQTFlfUEFUQ0hfU1VDQ0VTU19QUkVGSVggPSAnU3VjY2Vzcy4gVXBkYXRlZCB0aGUgZm9sbG93aW5nIGZpbGVzOic7XG5cbi8qKlxuICogVGhlIGNvbW1vbiBmaWVsZHMgYW4gb2JqZWN0LXdyYXBwZWQgdG9vbF9yZXNwb25zZSBtaWdodCBjYXJyeSB0aGUgdG9vbCdzIHRleHRcbiAqIG91dHB1dCB1bmRlciwgaWYgQ29kZXggZXZlciBzdG9wcyBzdXJmYWNpbmcgaXQgYXMgYSBiYXJlIHN0cmluZy4gT3JkZXJlZCBieVxuICogbGlrZWxpaG9vZDsgdGhlIGZpcnN0IGZpZWxkIHdob3NlIHZhbHVlIGlzIGEgc3RyaW5nIHdpbnMuXG4gKi9cbmNvbnN0IFJFU1BPTlNFX1RFWFRfRklFTERTID0gWydvdXRwdXQnLCAnc3Rkb3V0JywgJ2NvbnRlbnQnLCAndGV4dCddIGFzIGNvbnN0O1xuXG4vKiogTmFycm93IHRoZSBTREsncyBgdW5rbm93bmAgdG9vbF9pbnB1dCB0byB0aGUgYGFwcGx5X3BhdGNoYCBgeyBjb21tYW5kIH1gIHNoYXBlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5hcnJvd0FwcGx5UGF0Y2hDb21tYW5kKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ICE9PSBudWxsICYmIHR5cGVvZiB0b29sSW5wdXQgPT09ICdvYmplY3QnICYmICdjb21tYW5kJyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBjb21tYW5kID0gKHRvb2xJbnB1dCBhcyB7IGNvbW1hbmQ6IHVua25vd24gfSkuY29tbWFuZDtcbiAgICBpZiAodHlwZW9mIGNvbW1hbmQgPT09ICdzdHJpbmcnKSByZXR1cm4gY29tbWFuZDtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBOYXJyb3cgdGhlIGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgZW52ZWxvcGUgKGNsaV92ZXJzaW9uIFx1MjI2NCAwLjEzMC4wKTpcbiAqIGB0b29sX2lucHV0LmFyZ3VtZW50c2AgaXMgYSBKU09OICpzdHJpbmcqIG9mIHNoYXBlXG4gKiBge1wiY21kXCI6IFwiLi4uXCIsIFwid29ya2RpclwiOiBcIi4uLlwifWAgXHUyMDE0IHBhcnNlIGl0IGFuZCByZXR1cm4gdGhlIGBjbWRgLiBSZXR1cm5zXG4gKiBgbnVsbGAgZm9yIGFueSBvdGhlciBzaGFwZSAobm90IEpTT04sIG5vIGBjbWRgIGZpZWxkLCBvciBub3QgdGhpcyBlbnZlbG9wZSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dFeGVjQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnYXJndW1lbnRzJyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBhcmdzID0gKHRvb2xJbnB1dCBhcyB7IGFyZ3VtZW50czogdW5rbm93biB9KS5hcmd1bWVudHM7XG4gICAgaWYgKHR5cGVvZiBhcmdzID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShhcmdzKTtcbiAgICAgICAgaWYgKHBhcnNlZCAhPT0gbnVsbCAmJiB0eXBlb2YgcGFyc2VkID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgcGFyc2VkLmNtZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICByZXR1cm4gcGFyc2VkLmNtZDtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBUaGUgcmVzdWx0IG9mIG5hcnJvd2luZyB0aGUgY29kZS1tb2RlIGBleGVjYCBlbnZlbG9wZS4gYG1hdGNoZWRgIHNlcGFyYXRlc1xuICogXCJ0aGUgZW52ZWxvcGUgd2FzIGEgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIGNhbGwgd2hvc2UgYXJndW1lbnQgY291bGQgbm90XG4gKiBiZSByZWNvdmVyZWRcIiAoYSB2YXJpYWJsZS90ZW1wbGF0ZS1idWlsdCBjb21tYW5kIFx1MjAxNCBzdGF0aWNhbGx5IHVucmVzb2x2YWJsZSlcbiAqIGZyb20gXCJ0aGUgZW52ZWxvcGUgaXMgbm90IGNvZGUtbW9kZSBleGVjIGF0IGFsbFwiLCBzbyB0aGUgaGFuZGxlciBjYW4gd2FybiBvblxuICogdGhlIGZvcm1lciBpbnN0ZWFkIG9mIHNpbGVudGx5IGNvbmZsYXRpbmcgaXQgd2l0aCB0aGUgbGF0dGVyLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvZGVNb2RlRXhlY05hcnJvdyB7XG4gIC8qKiBXaGV0aGVyIGB0b29sX2lucHV0LmlucHV0YCBjb250YWluZWQgYSBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgY2FsbC4gKi9cbiAgbWF0Y2hlZDogYm9vbGVhbjtcbiAgLyoqIFRoZSByZWNvdmVyZWQgYGNtZGAgc3RyaW5nLCBvciBgbnVsbGAgd2hlbiBtYXRjaGVkIGJ1dCB1bnBhcnNhYmxlIC8gYWJzZW50LiAqL1xuICBjbWQ6IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogUXVvdGUgYmFyZSBpZGVudGlmaWVyIGtleXMgaW4gYSBKUyBvYmplY3QgbGl0ZXJhbCBzbyBgSlNPTi5wYXJzZWAgY2FuIHJlYWRcbiAqIGl0LiBSZWFsIGNvZGUtbW9kZSBjYWxsIHNpdGVzIGVtaXQgSlMtc3R5bGUgdW5xdW90ZWQga2V5c1xuICogKGB7Y21kOlwic2VkIC1uICcxLDI0MHAnIC9wYXRoXCIsLi4ufWApLCB3aGljaCBpcyB2YWxpZCBKUyBidXQgaW52YWxpZCBKU09OLlxuICogU3RyaW5nIHZhbHVlcyAoc2luZ2xlLSBvciBkb3VibGUtcXVvdGVkKSBhcmUgY29waWVkIHZlcmJhdGltIFx1MjAxNCBpbmNsdWRpbmcgYW55XG4gKiBgLCBrZXk6YC1zaGFwZWQgdGV4dCBpbnNpZGUgdGhlbSBcdTIwMTQgYW5kIGFscmVhZHktcXVvdGVkIGtleXMgcGFzcyB0aHJvdWdoXG4gKiB1bnRvdWNoZWQuXG4gKi9cbmZ1bmN0aW9uIHF1b3RlT2JqZWN0S2V5cyhsaXRlcmFsOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgb3V0ID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IGxpdGVyYWwubGVuZ3RoO1xuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gbGl0ZXJhbFtpXTtcbiAgICBpZiAoYyA9PT0gJ1wiJyB8fCBjID09PSBcIidcIikge1xuICAgICAgY29uc3QgcXVvdGUgPSBjO1xuICAgICAgY29uc3Qgc3RhcnQgPSBpO1xuICAgICAgaSArPSAxO1xuICAgICAgd2hpbGUgKGkgPCBuKSB7XG4gICAgICAgIGlmIChsaXRlcmFsW2ldID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSBpICs9IDI7XG4gICAgICAgIGVsc2UgaWYgKGxpdGVyYWxbaV0gPT09IHF1b3RlKSB7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9IGVsc2UgaSArPSAxO1xuICAgICAgfVxuICAgICAgb3V0ICs9IGxpdGVyYWwuc2xpY2Uoc3RhcnQsIGkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGtleSA9IGxpdGVyYWwuc2xpY2UoaSkubWF0Y2goL14oXFx7fCwpXFxzKihbQS1aYS16XyRdW0EtWmEtejAtOV8kXSopXFxzKjovKTtcbiAgICBpZiAoa2V5KSB7XG4gICAgICBvdXQgKz0gYCR7a2V5WzFdfVwiJHtrZXlbMl19XCI6YDtcbiAgICAgIGkgKz0ga2V5WzBdLmxlbmd0aDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBvdXQgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBOYXJyb3cgdGhlIGNvZGUtbW9kZSBgZXhlY2AgZW52ZWxvcGUgKGNsaV92ZXJzaW9uIFx1MjI2NSAwLjE0NC4wKTpcbiAqIGB0b29sX2lucHV0LmlucHV0YCBpcyBKUyBzb3VyY2UgdGhhdCBjYWxscyBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgXHUyMDE0XG4gKiByZWNvdmVyIHRoZSBsaXRlcmFsIG9iamVjdCBhcmd1bWVudCB2aWEgYmFsYW5jZWQtYnJhY2UgbWF0Y2hpbmcsIHF1b3RlIGl0c1xuICogdW5xdW90ZWQgSlMga2V5cywgYW5kIHBhcnNlIGl0LiBBIGNvbW1hbmQgYnVpbHQgZnJvbSB2YXJpYWJsZXMgb3IgdGVtcGxhdGVcbiAqIGxpdGVyYWxzIGlzIHN0YXRpY2FsbHkgdW5yZXNvbHZhYmxlOiB0aGUgY2FsbCBzdGlsbCAqbWF0Y2hlZCogYnV0IHlpZWxkc1xuICogYGNtZDogbnVsbGAsIHJlcG9ydGVkIGRpc3RpbmN0bHkgZnJvbSBhIG5vbi1jb2RlLW1vZGUgZW52ZWxvcGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dDb2RlTW9kZUV4ZWModG9vbElucHV0OiB1bmtub3duKTogQ29kZU1vZGVFeGVjTmFycm93IHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnaW5wdXQnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGlucHV0ID0gKHRvb2xJbnB1dCBhcyB7IGlucHV0OiB1bmtub3duIH0pLmlucHV0O1xuICAgIGlmICh0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAvLyBNYXRjaCB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pIFx1MjAxNCBleHRyYWN0IHRoZSBsaXRlcmFsIG9iamVjdCBhcmd1bWVudFxuICAgICAgY29uc3QgbWF0Y2ggPSBpbnB1dC5tYXRjaCgvdG9vbHNcXC5leGVjX2NvbW1hbmRcXChcXHMqKFxceyg/Oltee31dfFxceyg/Oltee31dfFxce1tee31dKlxcfSkqXFx9KSpcXH0pXFxzKlxcKS8pO1xuICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShxdW90ZU9iamVjdEtleXMobWF0Y2hbMV0pKTtcbiAgICAgICAgICBpZiAocGFyc2VkICE9PSBudWxsICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnICYmIHR5cGVvZiBwYXJzZWQuY21kID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgbWF0Y2hlZDogdHJ1ZSwgY21kOiBwYXJzZWQuY21kIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB7IG1hdGNoZWQ6IHRydWUsIGNtZDogbnVsbCB9O1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBtYXRjaGVkLCBidXQgdGhlIGxpdGVyYWwgZGlkIG5vdCBwYXJzZSBcdTIwMTQgdGhlIGNhbGwgaXMgc3RpbGwgYVxuICAgICAgICAgIC8vIGNvZGUtbW9kZSBleGVjIHdob3NlIGNvbW1hbmQgY2Fubm90IGJlIHJlY292ZXJlZCBzdGF0aWNhbGx5LlxuICAgICAgICAgIHJldHVybiB7IG1hdGNoZWQ6IHRydWUsIGNtZDogbnVsbCB9O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiB7IG1hdGNoZWQ6IGZhbHNlLCBjbWQ6IG51bGwgfTtcbn1cblxuLyoqXG4gKiBUb2xlcmFudGx5IHB1bGwgdGhlIHRvb2wncyB0ZXh0dWFsIG91dHB1dCBvdXQgb2YgYSBgdG9vbF9yZXNwb25zZWAgb2ZcbiAqIHVuY2VydGFpbiBzaGFwZSAoU0RLLXR5cGVkIGB1bmtub3duYCk6IGEgYmFyZSBzdHJpbmcgKHRvZGF5J3MgQ29kZXgpIGlzXG4gKiByZXR1cm5lZCBhcy1pczsgYW4gb2JqZWN0IGlzIHByb2JlZCBmb3IgdGhlIGZpcnN0IHtAbGluayBSRVNQT05TRV9URVhUX0ZJRUxEU31cbiAqIGVudHJ5IHRoYXQgaG9sZHMgYSBzdHJpbmcuIFJldHVybnMgYG51bGxgIHdoZW4gbm8gdGV4dCBjYW4gYmUgcmVjb3ZlcmVkXG4gKiAodW5rbm93biBvYmplY3Qgc2hhcGUsIGBudWxsYCwgb3IgYSBub24tc3RyaW5nL25vbi1vYmplY3QpLCB3aGljaCB0aGUgY2FsbGVyXG4gKiB0cmVhdHMgYXMgYW4gKnVucmVjb2duaXplZCogXHUyMDE0IG5vdCAqZmFpbGVkKiBcdTIwMTQgcmVzcG9uc2UuXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RSZXNwb25zZVRleHQodG9vbFJlc3BvbnNlOiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnc3RyaW5nJykgcmV0dXJuIHRvb2xSZXNwb25zZTtcbiAgaWYgKHRvb2xSZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnb2JqZWN0Jykge1xuICAgIGNvbnN0IHJlY29yZCA9IHRvb2xSZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBmb3IgKGNvbnN0IGZpZWxkIG9mIFJFU1BPTlNFX1RFWFRfRklFTERTKSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHJlY29yZFtmaWVsZF07XG4gICAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBDbGFzc2lmeSBhbiBgYXBwbHlfcGF0Y2hgIGB0b29sX3Jlc3BvbnNlYCBmb3IgdGhlIHRvdWNoIGdhdGU6XG4gKlxuICogLSBgJ3N1Y2Nlc3MnYCBcdTIwMTQgdGV4dCB3YXMgcmVjb3ZlcmVkIGFuZCBjYXJyaWVzIHtAbGluayBBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWH0uXG4gKiAtIGAnZmFpbHVyZSdgIFx1MjAxNCB0ZXh0IHdhcyByZWNvdmVyZWQgYnV0IGxhY2tzIHRoZSBoZWFkZXI6IGEgZ2VudWluZSByZWplY3Rpb25cbiAqICAgb3IgZXJyb3IuIFRoZSBPTkxZIGNsYXNzaWZpY2F0aW9uIHRoYXQgc3VwcHJlc3NlcyB0aGUgdG91Y2guXG4gKiAtIGAndW5rbm93bidgIFx1MjAxNCBubyB0ZXh0IGNvdWxkIGJlIHJlY292ZXJlZCAodW5yZWNvZ25pemVkIHNoYXBlKS4gV2UgcHJvY2VlZFxuICogICBkZWZlbnNpdmVseSBoZXJlIHJhdGhlciB0aGFuIHJpc2sgbWlzc2luZyBhIHJlYWwgZWRpdCdzIGhlYWwvc3VyZmFjZTsgQ29kZXhcbiAqICAgY29yZSBmaXJlcyBQb3N0VG9vbFVzZSBvbmx5IG9uIHN1Y2Nlc3MsIHNvIHRoaXMgY2Fubm90IGhlYWwvc3VyZmFjZSBhIHBhdGNoXG4gKiAgIHRoYXQgbmV2ZXIgYXBwbGllZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsYXNzaWZ5QXBwbHlQYXRjaFJlc3BvbnNlKHRvb2xSZXNwb25zZTogdW5rbm93bik6ICdzdWNjZXNzJyB8ICdmYWlsdXJlJyB8ICd1bmtub3duJyB7XG4gIGNvbnN0IHRleHQgPSBleHRyYWN0UmVzcG9uc2VUZXh0KHRvb2xSZXNwb25zZSk7XG4gIGlmICh0ZXh0ID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICByZXR1cm4gdGV4dC5zdGFydHNXaXRoKEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYKSA/ICdzdWNjZXNzJyA6ICdmYWlsdXJlJztcbn1cblxuLyoqIEEgcmVhZGVyIHRoYXQgYWx3YXlzIGRlY2xpbmVzLCBmb3JjaW5nIHRoZSBwYXJzZXIgdG8gd2hvbGUtZmlsZSBhbmNob3JzLiAqL1xuY29uc3Qgbm9SYW5nZVJlY292ZXJ5ID0gKCk6IG51bGwgPT4gbnVsbDtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMgPSBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMoKSxcbiAgbWVtb0ZhY3Rvcnk6IE1lbW9GYWN0b3J5ID0gY3JlYXRlRGlza01lbW9TdG9yZVxuKSB7XG4gIHJldHVybiBhc3luYyAoaW5wdXQ6IFBvc3RUb29sVXNlSW5wdXQsIGN0eDogSG9va0NvbnRleHQpID0+IHtcbiAgICBjb25zdCB0b29sX25hbWUgPSBpbnB1dC50b29sX25hbWU7XG4gICAgY29uc3QgY3dkID0gaW5wdXQuY3dkID8/ICcnO1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IGlucHV0LnNlc3Npb25faWQ7XG4gICAgY29uc3QgbWVtbyA9IG1lbW9GYWN0b3J5KGN0eC5sb2dnZXIpO1xuXG4gICAgLy8gU2hlbGwgdG91Y2g6IGV4dHJhY3QgdGhlIGNvbW1hbmQgZnJvbSB3aGljaGV2ZXIgZW52ZWxvcGUgc2hhcGUgdGhlIGhhcm5lc3NcbiAgICAvLyBkZWxpdmVycywgcGFyc2UsIGFuZCBydW4gZWFjaCByZXNvbHZlZCBzcGFuIHRocm91Z2ggdGhlIHNoYXJlZCB0b3VjaCBjb3JlLlxuICAgIC8vXG4gICAgLy8gLSBgQmFzaGA6IHRoZSBoYXJuZXNzLXVud3JhcHBlZCBzaGFwZSBDb2RleCBcdTIyNjUwLjE0NCBhY3R1YWxseSBzZW5kcyBcdTIwMTRcbiAgICAvLyAgIGB0b29sX2lucHV0LmNvbW1hbmRgIGlzIHRoZSByYXcgc2hlbGwgY29tbWFuZCBzdHJpbmcgKHNhbWUgc2hhcGUgdGhlXG4gICAgLy8gICBDbGF1ZGUgYWRhcHRlciBoYW5kbGVzKS5cbiAgICAvLyAtIGBleGVjX2NvbW1hbmRgOiBjbGFzc2ljIGZ1bmN0aW9uX2NhbGwgZW52ZWxvcGUgKGNsaSBcdTIyNjQwLjEzMCkgXHUyMDE0XG4gICAgLy8gICBgdG9vbF9pbnB1dC5hcmd1bWVudHNgIGlzIGEgSlNPTiBzdHJpbmcgd2l0aCBhIGBjbWRgIGZpZWxkLlxuICAgIC8vIC0gYGV4ZWNgOiBkaXJlY3QgY29kZS1tb2RlIGVudmVsb3BlIChtYXkgc2hpcCBpbiBhIGZ1dHVyZSBDTEkpIFx1MjAxNFxuICAgIC8vICAgYHRvb2xfaW5wdXQuaW5wdXRgIGlzIEpTIHNvdXJjZSB3cmFwcGluZyBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAuXG4gICAgLy9cbiAgICAvLyBBIGNvbW1hbmQgd2l0aCBubyByZWNvZ25pemVkIGlkaW9tIHlpZWxkcyBubyBibG9ja3MgYW5kIHJldHVybnMgdW5kZWZpbmVkIFx1MjAxNFxuICAgIC8vIGZhaWwtb3Blbiwgc2FtZSBhcyB0aGUgYXBwbHlfcGF0Y2ggcGF0aCBiZWxvdy5cbiAgICBpZiAodG9vbF9uYW1lID09PSAnQmFzaCcgfHwgdG9vbF9uYW1lID09PSAnZXhlY19jb21tYW5kJyB8fCB0b29sX25hbWUgPT09ICdleGVjJykge1xuICAgICAgbGV0IGNvbW1hbmQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgaWYgKHRvb2xfbmFtZSA9PT0gJ0Jhc2gnKSB7XG4gICAgICAgIC8vIFRoZSBoYXJuZXNzIGFscmVhZHkgdW53cmFwcGVkIHRoZSBjb2RlLW1vZGUgZW52ZWxvcGUgXHUyMDE0IHRoZSBjb21tYW5kIGlzXG4gICAgICAgIC8vIGluIGB0b29sX2lucHV0LmNvbW1hbmRgLCBleGFjdGx5IGFzIHRoZSBDbGF1ZGUgYWRhcHRlciByZWNlaXZlcyBpdC5cbiAgICAgICAgY29uc3QgcmF3ID0gKGlucHV0LnRvb2xfaW5wdXQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsKT8uY29tbWFuZDtcbiAgICAgICAgY29tbWFuZCA9IHR5cGVvZiByYXcgPT09ICdzdHJpbmcnID8gcmF3IDogbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbW1hbmQgPSBuYXJyb3dFeGVjQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICAgIH1cbiAgICAgIGlmIChjb21tYW5kID09PSBudWxsICYmIHRvb2xfbmFtZSA9PT0gJ2V4ZWMnKSB7XG4gICAgICAgIC8vIENvZGUtbW9kZSBgZXhlY2Agd3JhcHMgdGhlIHNhbWUgY2FsbCBpbiBKUyBzb3VyY2UuIEEgbWF0Y2hlZCBjYWxsXG4gICAgICAgIC8vIHdob3NlIGFyZ3VtZW50IGNvdWxkIG5vdCBiZSBwYXJzZWQgKHZhcmlhYmxlL3RlbXBsYXRlLWJ1aWx0IGNvbW1hbmQpXG4gICAgICAgIC8vIGlzIGEgZGlzdGluY3Qgb3V0Y29tZSBmcm9tIFwibm90IGEgY29kZS1tb2RlIGVudmVsb3BlIGF0IGFsbFwiOiB3YXJuIHNvXG4gICAgICAgIC8vIHRoZSBibGluZCBzcG90IGlzIHZpc2libGUgaW5zdGVhZCBvZiBzaWxlbnRseSBjb25mbGF0ZWQgd2l0aCBubyBtYXRjaC5cbiAgICAgICAgY29uc3QgY29kZU1vZGUgPSBuYXJyb3dDb2RlTW9kZUV4ZWMoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgICAgIGlmIChjb2RlTW9kZS5tYXRjaGVkICYmIGNvZGVNb2RlLmNtZCA9PT0gbnVsbCkge1xuICAgICAgICAgIGN0eC5sb2dnZXIud2FybihcbiAgICAgICAgICAgICdDb2RleCBjb2RlLW1vZGUgZXhlYyBlbnZlbG9wZSBtYXRjaGVkIGJ1dCBpdHMgZXhlY19jb21tYW5kIGFyZ3VtZW50IGNvdWxkIG5vdCBiZSBwYXJzZWQ7IG5vIHNoZWxsIHRvdWNoJyxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdG9vbElucHV0VHlwZTogdHlwZW9mIGlucHV0LnRvb2xfaW5wdXQsXG4gICAgICAgICAgICAgIHRvb2xJbnB1dEtleXM6XG4gICAgICAgICAgICAgICAgaW5wdXQudG9vbF9pbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgaW5wdXQudG9vbF9pbnB1dCA9PT0gJ29iamVjdCdcbiAgICAgICAgICAgICAgICAgID8gT2JqZWN0LmtleXMoaW5wdXQudG9vbF9pbnB1dCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBjb21tYW5kID0gY29kZU1vZGUuY21kO1xuICAgICAgfVxuICAgICAgaWYgKCFjb21tYW5kKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBtYXRjaGVzID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgY3dkKTtcbiAgICAgIGNvbnN0IGJsb2Nrczogc3RyaW5nW10gPSBbXTtcbiAgICAgIGZvciAoY29uc3QgbWF0Y2ggb2YgbWF0Y2hlcykge1xuICAgICAgICBpZiAobWF0Y2guc3RhdHVzICE9PSAncmVzb2x2ZWQnKSBjb250aW51ZTtcbiAgICAgICAgY29uc3Qgc3BhbiA9IG1hdGNoLnNwYW47XG4gICAgICAgIGNvbnN0IGFic1BhdGggPSBhYnNwYXRoQWdhaW5zdChjd2QsIHNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICAgICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgICAgICBpZiAoIXNjb3BlKSBjb250aW51ZTtcbiAgICAgICAgbGV0IHRvdWNoSW5wdXQ6IHtcbiAgICAgICAgICBraW5kOiAncmVhZCcgfCAnd3JpdGUnO1xuICAgICAgICAgIHNlc3Npb25JZDogc3RyaW5nO1xuICAgICAgICAgIGN3ZDogc3RyaW5nO1xuICAgICAgICAgIGZpbGVQYXRoOiBzdHJpbmc7XG4gICAgICAgICAgb2Zmc2V0PzogbnVtYmVyO1xuICAgICAgICAgIGxpbWl0PzogbnVtYmVyO1xuICAgICAgICAgIHdyaXR0ZW4/OiBzdHJpbmc7XG4gICAgICAgIH07XG4gICAgICAgIGlmIChtYXRjaC5pZGlvbSA9PT0gJ2hlcmVkb2Mtd3JpdGUnKSB7XG4gICAgICAgICAgdG91Y2hJbnB1dCA9IHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2QsIGZpbGVQYXRoOiBhYnNQYXRoLCB3cml0dGVuOiBzcGFuLmJvZHkgPz8gJycgfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0b3VjaElucHV0ID0ge1xuICAgICAgICAgICAga2luZDogJ3JlYWQnLFxuICAgICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICAgICAgY3dkLFxuICAgICAgICAgICAgZmlsZVBhdGg6IGFic1BhdGgsXG4gICAgICAgICAgICBvZmZzZXQ6IHNwYW4ubGluZVN0YXJ0LFxuICAgICAgICAgICAgbGltaXQ6IHNwYW4ubGluZUVuZCAtIHNwYW4ubGluZVN0YXJ0ICsgMVxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuVG91Y2hIb29rKHRvdWNoSW5wdXQgYXMgVG91Y2hJbnB1dCwgZXhlY3V0b3JzLCBtZW1vKTtcbiAgICAgICAgaWYgKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCkgYmxvY2tzLnB1c2gob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KTtcbiAgICAgIH1cbiAgICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgICByZXR1cm4gcG9zdFRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQsIHN5c3RlbU1lc3NhZ2U6IGNvbWJpbmVkIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmQgPSBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIC8vIFN1cHByZXNzIG9ubHkgYSAqY29uZmlybWVkKiBub24tc3VjY2Vzcy4gQW4gdW5yZWNvZ25pemVkIHJlc3BvbnNlIHNoYXBlXG4gICAgLy8gcHJvY2VlZHMgKHdpdGggYSB3YXJuaW5nKSByYXRoZXIgdGhhbiByaXNrIHNraXBwaW5nIGEgcmVhbCBlZGl0J3MgdG91Y2guXG4gICAgY29uc3QgY2xhc3NpZmljYXRpb24gPSBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZShpbnB1dC50b29sX3Jlc3BvbnNlKTtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICdmYWlsdXJlJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICd1bmtub3duJykge1xuICAgICAgY3R4LmxvZ2dlci53YXJuKCdDb2RleCBhcHBseV9wYXRjaCB0b29sX3Jlc3BvbnNlIHNoYXBlIHVucmVjb2duaXplZDsgcnVubmluZyB0b3VjaCBkZWZlbnNpdmVseScsIHtcbiAgICAgICAgdG9vbFJlc3BvbnNlVHlwZTogdHlwZW9mIGlucHV0LnRvb2xfcmVzcG9uc2UsXG4gICAgICAgIHRvb2xSZXNwb25zZUtleXM6XG4gICAgICAgICAgaW5wdXQudG9vbF9yZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgaW5wdXQudG9vbF9yZXNwb25zZSA9PT0gJ29iamVjdCdcbiAgICAgICAgICAgID8gT2JqZWN0LmtleXMoaW5wdXQudG9vbF9yZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBPbmUgZW52ZWxvcGUgbWF5IHRvdWNoIHNldmVyYWwgZmlsZXM7IGZvcmNlIHdob2xlLWZpbGUgYW5jaG9ycyAoQ29kZXggbmV2ZXJcbiAgICAvLyByZWNvdmVycyBhIHBvc3QtZWRpdCByYW5nZSkgYW5kIHJ1biB0aGUgc2hhcmVkIHRvdWNoIGNvcmUgcGVyIHRvdWNoZWQgZmlsZS5cbiAgICAvLyBUaGUgc2hhcmVkIG1lbW8gZGVkdXBlcyBzcGFuIHJlbmRlcnMgYWNyb3NzIGFuY2hvcnMgYW5kIHRoZSBzZXNzaW9uLlxuICAgIGNvbnN0IGFuY2hvcnMgPSBwYXJzZUFwcGx5UGF0Y2goY29tbWFuZCwgbm9SYW5nZVJlY292ZXJ5KTtcbiAgICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgICAgY29uc3QgYWJzUGF0aCA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgYW5jaG9yLnBhdGgpO1xuICAgICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2soXG4gICAgICAgIHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2QsIGZpbGVQYXRoOiBhYnNQYXRoLCB3cml0dGVuOiAnJyB9LFxuICAgICAgICBleGVjdXRvcnMsXG4gICAgICAgIG1lbW9cbiAgICAgICk7XG4gICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgIH1cblxuICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNvbWJpbmVkID0gYmxvY2tzLmpvaW4oJycpO1xuICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiBjb21iaW5lZCwgc3lzdGVtTWVzc2FnZTogY29tYmluZWQgfSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHBvc3RUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdhcHBseV9wYXRjaHxleGVjX2NvbW1hbmR8ZXhlY3xCYXNoJywgdGltZW91dDogMTBfMDAwIH0sIGNyZWF0ZUhhbmRsZXIoKSk7XG4iLCAiaW1wb3J0IGhvb2sgZnJvbSBcIi4vcG9zdC10b29sLXVzZS50c1wiO1xuaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gXCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qc1wiO1xuZXhlY3V0ZShob29rKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUE0Qk8sSUFBTSwwQkFBMEIsb0JBQUksSUFBSSxDQUFDLGdCQUFnQixvQkFBb0IsZUFBZSxDQUFDOzs7QUM1QnBHLFNBQVMsZUFBZSxlQUFlLFFBQVEsU0FBUztBQUNwRCxRQUFNLE9BQU87QUFDYixPQUFLLGdCQUFnQjtBQUNyQixPQUFLLFVBQVUsT0FBTztBQUN0QixPQUFLLGdCQUFnQixPQUFPO0FBQzVCLE1BQUksYUFBYSxVQUFVLE9BQU8sT0FBTyxZQUFZLFVBQVU7QUFDM0QsU0FBSyxVQUFVLE9BQU87QUFBQSxFQUMxQjtBQUNBLFNBQU87QUFDWDtBQUlPLFNBQVMsZ0JBQWdCLFFBQVEsU0FBUztBQUM3QyxTQUFPLGVBQWUsZUFBZSxRQUFRLE9BQU87QUFDeEQ7OztBQ2ZBLFNBQVMsV0FBVyxZQUFZLFdBQVcsVUFBVSxpQkFBaUI7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TUFDRjtBQUNBLFVBQUksT0FBTyxrQkFBbUIsUUFBTyxLQUFLLE9BQU8saUJBQWlCO0FBQUEsSUFDcEU7QUFFQSxRQUFJLE9BQU8sV0FBVyxFQUFHLFFBQU87QUFDaEMsVUFBTSxXQUFXLE9BQU8sS0FBSyxFQUFFO0FBQy9CLFdBQU8sa0JBQWtCLEVBQUUsbUJBQW1CLFVBQVUsZUFBZSxTQUFTLENBQUM7QUFBQSxFQUNuRjtBQUNGO0FBRUEsSUFBTyx3QkFBUSxnQkFBZ0IsRUFBRSxTQUFTLHNDQUFzQyxTQUFTLElBQU8sR0FBRyxjQUFjLENBQUM7OztBQy9WbEgsUUFBUSxxQkFBSTsiLAogICJuYW1lcyI6IFsicmVzb2x2ZSIsICJleGVjRmlsZVN5bmMiLCAic3RhdFN5bmMiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImxvZ2dlciIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAiYmFzZW5hbWUiLCAiYmFzZW5hbWUiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgInRvUG9zaXgiLCAiY3R4IiwgInJlY292ZXJSYW5nZSIsICJjb21tYW5kIiwgImJsb2NrcyIsICJjb21iaW5lZCJdCn0K
