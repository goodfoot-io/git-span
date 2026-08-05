#!/usr/bin/env -S node --enable-source-maps
// src/codex/post-tool-use.ts
import { resolve as resolvePath2 } from "node:path";

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
import { isAbsolute as isAbsolute2, resolve as resolvePath } from "node:path";

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
var COMMAND_OPENER_WORDS = /* @__PURE__ */ new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "time", "{", "("]);
var WORD_END = /[\s;&|()<>]/;
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function splitTopLevel(cmd) {
  const parts = [];
  let buf = "";
  let i = 0;
  const n = cmd.length;
  let depth = 0;
  let braceDepth = 0;
  let inSquote = false;
  let inDquote = false;
  let pendingOp = "start";
  let malformed;
  let listStart = 0;
  const reject = (v) => {
    malformed = v;
    parts.length = listStart;
    i = n;
  };
  const isUnconsumedOperator = () => (pendingOp === "pipe" || pendingOp === "and" || pendingOp === "or") && buf.trim() === "";
  const lastWord = () => buf.trimEnd().match(/\S+$/)?.[0] ?? "";
  const DANGLING_REDIRECT_WORD = /^(?:>|>>|&>|&>>|>\||<|<>|<<|<<-|<<<|>&|\d+(?:>|>>|>\||<|<>|<<|<<-|<<<|>&|<&))$/;
  const lastWordIsDanglingRedirect = () => DANGLING_REDIRECT_WORD.test(lastWord());
  const isWordStart = () => buf === "" || /\s$/.test(buf);
  const startsRedirectAt = (i2) => {
    const c = cmd[i2];
    if (c === ">" || c === "<") return true;
    if (c === "&") return cmd[i2 + 1] === ">";
    if (c >= "0" && c <= "9") {
      let j = i2;
      while (j < n && cmd[j] >= "0" && cmd[j] <= "9") j += 1;
      return cmd[j] === ">" || cmd[j] === "<";
    }
    return false;
  };
  const isCommandPosition = () => buf.trim() === "" || /\n$/.test(buf) || /[;&|()]$/.test(buf.trimEnd()) || COMMAND_OPENER_WORDS.has(lastWord());
  const flush = (nextOp) => {
    const s = buf.trim();
    if (s) {
      if (pendingOp === "pipe" && (s === "!" || /^!\s/.test(s))) {
        reject("pipe-bang");
        return;
      }
      parts.push({ text: s, precededBy: pendingOp });
    }
    buf = "";
    pendingOp = nextOp;
  };
  const levels = [[]];
  const top = () => {
    const lv = levels[levels.length - 1];
    return lv.length > 0 ? lv[lv.length - 1] : void 0;
  };
  let afterKeyword = false;
  let functionSeen = false;
  let nameSeen = false;
  let caseRegion = null;
  const heredocs = [];
  let inBody = false;
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
    if (braceDepth > 0) {
      if (c === "}") braceDepth -= 1;
      buf += c;
      i += 1;
      continue;
    }
    if (inBody) {
      const lineEnd = cmd.indexOf("\n", i);
      const line = lineEnd === -1 ? cmd.slice(i) : cmd.slice(i, lineEnd);
      if (heredocs[0].close.test(line)) {
        heredocs.shift();
        if (heredocs.length === 0) inBody = false;
      }
      if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
        buf += line;
        if (lineEnd !== -1) buf += "\n";
      }
      i = lineEnd === -1 ? n : lineEnd + 1;
      continue;
    }
    if (c === "\n" && heredocs.length > 0) {
      if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
        buf += c;
        inBody = true;
        i += 1;
        continue;
      }
      if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
        reject("dangling-operator");
        break;
      }
      flush("newline");
      inBody = true;
      i += 1;
      continue;
    }
    if (c === "#" && depth === 0 && isWordStart()) {
      while (i < n && cmd[i] !== "\n") i += 1;
      continue;
    }
    if (caseRegion) {
      const r = caseRegion;
      if (r.localDepth === 0) {
        const s2 = cmd.slice(i, i + 2);
        const s3 = cmd.slice(i, i + 3);
        if (s3 === ";;&" || s2 === ";;" || s2 === ";&") {
          r.pos = "pattern-start";
          buf += s3 === ";;&" ? s3 : s2;
          i += s3 === ";;&" ? 3 : 2;
          continue;
        }
        if (c === ";") {
          r.pos = "command";
          r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        const last = buf[buf.length - 1];
        if (c === "&" && cmd[i + 1] !== ">" && cmd[i + 1] !== "&" && last !== ">" && last !== "<") {
          r.pos = "command";
          r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        if (c === "\n") {
          if (r.pos === "pattern") {
            reject("unclosed-case");
            break;
          }
          if (r.pos === "command") r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        if (c === "#" && isWordStart()) {
          while (i < n && cmd[i] !== "\n") i += 1;
          continue;
        }
        if (isWordStart() && !WORD_END.test(c)) {
          let j = i;
          while (j < n && !WORD_END.test(cmd[j])) j += 1;
          const w = cmd.slice(i, j);
          if (w === "esac" && (r.pos === "pattern-start" || r.pos === "command" && r.cmdEmpty)) {
            caseRegion = null;
            afterKeyword = false;
          } else if (w === "in" && r.pos === "subject") {
            r.pos = "pattern-start";
          } else if (r.pos === "pattern-start") {
            r.pos = "pattern";
          } else if (r.pos === "command") {
            r.cmdEmpty = false;
          }
          buf += w;
          i = j;
          continue;
        }
      }
    }
    if (c === "(") {
      if (caseRegion) {
        caseRegion.localDepth += 1;
      } else {
        const t = top();
        if (t?.kind === "brace") t.body = true;
        depth += 1;
        levels.push([]);
      }
      afterKeyword = false;
      buf += c;
      i += 1;
      continue;
    }
    if (c === ")") {
      if (caseRegion) {
        if (caseRegion.localDepth === 0) {
          caseRegion.pos = "command";
          caseRegion.cmdEmpty = true;
        } else {
          caseRegion.localDepth -= 1;
        }
      } else {
        if (depth === 0) {
          reject("unbalanced-paren");
          break;
        }
        if (levels[levels.length - 1].length > 0) {
          reject("unclosed-construct");
          break;
        }
        depth -= 1;
        levels.pop();
      }
      buf += c;
      i += 1;
      continue;
    }
    if (!caseRegion && !WORD_END.test(c) && (isWordStart() || /[()]$/.test(buf)) && !(c === "$" && cmd[i + 1] === "{")) {
      let j = i;
      while (j < n && !WORD_END.test(cmd[j])) j += 1;
      const w = cmd.slice(i, j);
      const isFnShape = () => /^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(lastWord()) || lastWord() === "()";
      if (w === "in" && top() !== void 0 && ["for", "select"].includes(top().kind)) {
      } else if (w === "{" && (isCommandPosition() || isFnShape() || functionSeen && nameSeen)) {
        if (functionSeen && nameSeen) {
          functionSeen = false;
          nameSeen = false;
        }
        if (top()?.kind === "brace") top().body = true;
        levels[levels.length - 1].push({ kind: "brace", body: false });
        afterKeyword = true;
      } else if (w === "}" && isCommandPosition()) {
        const t = top();
        if (afterKeyword || t === void 0 || t.kind !== "brace" || !t.body) {
          reject("unclosed-construct");
          break;
        }
        levels[levels.length - 1].pop();
        afterKeyword = false;
      } else if (isCommandPosition()) {
        if (w === "case") {
          caseRegion = { pos: "subject", cmdEmpty: false, localDepth: 0 };
          afterKeyword = false;
        } else if (w === "function") {
          functionSeen = true;
          nameSeen = false;
          afterKeyword = false;
        } else if (w === "if") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "if", body: false });
          afterKeyword = true;
        } else if (w === "while" || w === "until") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "loop", body: false });
          afterKeyword = true;
        } else if (w === "for") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "for", body: false });
          afterKeyword = true;
        } else if (w === "select") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "select", body: false });
          afterKeyword = true;
        } else if (w === "do") {
          const t = top();
          if (t === void 0 || !["for", "loop", "select"].includes(t.kind)) {
            reject("unclosed-construct");
            break;
          }
          t.body = true;
          afterKeyword = true;
        } else if (w === "then") {
          const t = top();
          if (t === void 0 || t.kind !== "if") {
            reject("unclosed-construct");
            break;
          }
          t.body = true;
          afterKeyword = true;
        } else if (w === "else" || w === "elif") {
          const t = top();
          if (t === void 0 || t.kind !== "if" || !t.body) {
            reject("unclosed-construct");
            break;
          }
          afterKeyword = true;
        } else if (w === "in") {
          const t = top();
          if (t === void 0 || !["for", "select"].includes(t.kind)) {
            reject("unclosed-construct");
            break;
          }
        } else if (w === "fi") {
          const t = top();
          if (t === void 0 || t.kind !== "if" || !t.body) {
            reject("unclosed-construct");
            break;
          }
          levels[levels.length - 1].pop();
          afterKeyword = false;
        } else if (w === "done") {
          const t = top();
          if (t === void 0 || !["for", "loop", "select"].includes(t.kind) || !t.body) {
            reject("unclosed-construct");
            break;
          }
          levels[levels.length - 1].pop();
          afterKeyword = false;
        } else if (w === "esac") {
          reject("unclosed-construct");
          break;
        } else {
          afterKeyword = false;
          if (top()?.kind === "brace") top().body = true;
          if (functionSeen) {
            if (nameSeen) {
              functionSeen = false;
              nameSeen = false;
            } else {
              nameSeen = true;
            }
          }
        }
      } else {
        afterKeyword = false;
        if (functionSeen) {
          if (nameSeen) {
            functionSeen = false;
            nameSeen = false;
          } else {
            nameSeen = true;
          }
        }
      }
      buf += w;
      i = j;
      continue;
    }
    if (caseRegion === null && levels[levels.length - 1].length > 0 && (c === ";" || c === "&") && afterKeyword) {
      reject("unclosed-construct");
      break;
    }
    if (depth === 0) {
      if (isWordStart() && lastWordIsDanglingRedirect() && startsRedirectAt(i)) {
        reject("dangling-operator");
        break;
      }
      if (c === "$" && cmd[i + 1] === "{") {
        braceDepth += 1;
        buf += c;
        i += 1;
        continue;
      }
      if (c === "<" && cmd[i + 1] === "<" && cmd[i + 2] !== "<") {
        let j = i + 2;
        let allowTabs = false;
        if (cmd[j] === "-") {
          allowTabs = true;
          j += 1;
        }
        while (cmd[j] === " " || cmd[j] === "	") j += 1;
        let delim = "";
        if (cmd[j] === "'" || cmd[j] === '"') {
          const q = cmd.indexOf(cmd[j], j + 1);
          if (q === -1) {
            delim = cmd.slice(j + 1);
            j = n;
          } else {
            delim = cmd.slice(j + 1, q);
            j = q + 1;
          }
        } else {
          const wordStart = j;
          while (j < n && !WORD_END.test(cmd[j])) j += 1;
          delim = cmd.slice(wordStart, j);
        }
        if (delim !== "") {
          heredocs.push({
            close: new RegExp(`^${allowTabs ? "	*" : ""}${escapeRegExp(delim)}[ \\t]*$`)
          });
          if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
            buf += cmd.slice(i, j);
          }
          i = j;
          continue;
        }
      }
      if (caseRegion === null && levels[levels.length - 1].length === 0) {
        if (cmd.slice(i, i + 2) === "&&") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("and");
          i += 2;
          continue;
        }
        if (cmd.slice(i, i + 2) === "||") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("or");
          i += 2;
          continue;
        }
        if (cmd.slice(i, i + 2) === "|&") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("pipe");
          i += 2;
          continue;
        }
        if (c === ";") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("semicolon");
          i += 1;
          continue;
        }
        if (c === "|") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("pipe");
          i += 1;
          continue;
        }
        if (c === "\n") {
          if (isUnconsumedOperator()) {
            i += 1;
            continue;
          }
          if (lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("newline");
          listStart = parts.length;
          i += 1;
          continue;
        }
        if (c === "&") {
          const next = cmd[i + 1];
          const last = buf[buf.length - 1];
          if (next !== ">" && last !== ">" && last !== "<") {
            if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
              reject("dangling-operator");
              break;
            }
            flush("background");
            i += 1;
            continue;
          }
        }
      }
    }
    buf += c;
    i += 1;
  }
  if (malformed) return { stages: parts, malformed };
  if (inSquote || inDquote) {
    reject("unclosed-quote");
  } else if (braceDepth > 0) {
    reject("unclosed-brace");
  } else if (caseRegion !== null) {
    reject("unclosed-case");
  } else if (depth > 0) {
    reject("unbalanced-paren");
  } else if (levels[levels.length - 1].length > 0) {
    reject("unclosed-construct");
  } else if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
    reject("dangling-operator");
  } else if (inBody || heredocs.length > 0) {
    flush("newline");
    malformed = "unterminated-heredoc";
  } else {
    flush("newline");
  }
  return { stages: parts, malformed };
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
var REDIRECT_TWO_TOKEN = /^(?:>>?|<>|<|&>>?|[0-9]+(?:>>?|<>|<))$/;
var REDIRECT_DUP = /^(?:[0-9]+)?[<>]&(?:[0-9]+|-)$/;
var REDIRECT_FUSED = /^(?:>>?|<>|<|&>>?|[0-9]+(?:>>?|<>|<))[^<>&|]/;
var HEREDOC_TWO_TOKEN = /^(?:<<-?|<<<)$/;
var HEREDOC_FUSED = /^(?:<<-?|<<<)[^<>&|]/;
var REDIRECT_TOKEN = (w) => REDIRECT_TWO_TOKEN.test(w) || REDIRECT_DUP.test(w) || REDIRECT_FUSED.test(w) || HEREDOC_TWO_TOKEN.test(w) || HEREDOC_FUSED.test(w);
function stripRedirects(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (REDIRECT_TWO_TOKEN.test(a) || HEREDOC_TWO_TOKEN.test(a)) {
      const next = argv[i + 1];
      if (next !== void 0 && !REDIRECT_TOKEN(next)) {
        i += 1;
      } else {
        out.push(a);
      }
      continue;
    }
    if (REDIRECT_DUP.test(a) || REDIRECT_FUSED.test(a) || HEREDOC_FUSED.test(a)) continue;
    out.push(a);
  }
  return out;
}
var WRAPPER_BUILTINS = /* @__PURE__ */ new Set([
  "exit",
  "exec",
  "true",
  "false",
  ":",
  "cd",
  "set",
  "unset",
  "export",
  "readonly",
  "return",
  "break",
  "continue"
]);
var RECOGNIZED_EXTERNAL_NAMES = /* @__PURE__ */ new Set([
  "sed",
  "head",
  "tail",
  "cat",
  "nl",
  "git",
  "true",
  "false",
  "timeout",
  "env",
  "command"
]);
var TIMEOUT_DURATION = /^\d+(?:\.\d+)?[smhd]?$/;
var ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=.*$/;
function stripWrappersOnce(argv) {
  let i = 0;
  while (i < argv.length && argv[i] === "!") i++;
  if (i >= argv.length) return argv.slice(i);
  const head = argv[i];
  if (head === "command") {
    const next = argv[i + 1];
    if (next === "-v" || next === "-V") return null;
    if (next === "-p") return argv.slice(i + 2);
    if (next !== void 0 && !next.startsWith("-")) return argv.slice(i + 1);
    return null;
  }
  if (head === "builtin") {
    const next = argv[i + 1];
    if (next !== void 0 && WRAPPER_BUILTINS.has(next)) return argv.slice(i + 2);
    return null;
  }
  if (head === "env") {
    let j = i + 1;
    while (j < argv.length && ENV_ASSIGNMENT.test(argv[j])) j++;
    if (j === i + 1) return null;
    return argv.slice(j);
  }
  if (head === "timeout") {
    let j = i + 1;
    while (j < argv.length && argv[j].startsWith("--")) j++;
    if (j >= argv.length || !TIMEOUT_DURATION.test(argv[j])) return null;
    return argv.slice(j + 1);
  }
  if (head.startsWith("/")) {
    const base = head.slice(head.lastIndexOf("/") + 1);
    if (RECOGNIZED_EXTERNAL_NAMES.has(base)) return [base, ...argv.slice(i + 1)];
    return null;
  }
  if (head.includes("/")) return null;
  return argv.slice(i);
}
function stripWrappers(argv) {
  let current = argv;
  for (let iter = 0; iter < argv.length + 2; iter++) {
    const next = stripWrappersOnce(current);
    if (next === null) return argv;
    if (next.length === current.length && next.every((w, k) => w === current[k])) return current;
    current = next;
  }
  return argv;
}

// src/common/variable-expand.ts
var DEFAULT_PATH_ALLOWLIST = [
  "HOME",
  "PWD",
  "WORKSPACE_PATH",
  "CARD_REPO_PATH",
  "REPO_ROOT",
  "BASE_BRANCH"
];
var BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
var BRACED_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
function expandVariables(text, variables, env) {
  const resolve2 = (name) => {
    const fromTable = variables.get(name);
    if (fromTable !== void 0) return fromTable;
    const fromEnv = env[name];
    return fromEnv !== void 0 ? fromEnv : void 0;
  };
  let out = "";
  let i = 0;
  const n = text.length;
  let inSingle = false;
  let inDouble = false;
  while (i < n) {
    const c = text[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      out += c;
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"') {
        inDouble = false;
        out += c;
        i++;
        continue;
      }
      if (c === "\\" && i + 1 < n && '"\\$`'.includes(text[i + 1])) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (c === "\\") {
        out += c;
        i++;
        continue;
      }
      if (c === "$") {
        const ref = expandRef(text, i, resolve2);
        out += ref.text;
        i = ref.next;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      out += c;
      i++;
      continue;
    }
    if (c === "\\") {
      out += c;
      if (i + 1 < n) {
        out += text[i + 1];
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (c === "$") {
      const ref = expandRef(text, i, resolve2);
      out += ref.text;
      i = ref.next;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function expandRef(text, start, resolve2) {
  const rest = text.slice(start + 1);
  if (rest.startsWith("(")) return { text: "$", next: start + 1 };
  if (rest.startsWith("{")) {
    const close = text.indexOf("}", start + 2);
    if (close === -1) return { text: "$", next: start + 1 };
    const inner = text.slice(start + 2, close);
    if (BRACED_NAME.test(inner)) {
      const value2 = resolve2(inner);
      if (value2 !== void 0) return { text: value2, next: close + 1 };
    }
    return { text: "$", next: start + 1 };
  }
  const name = BARE_NAME.exec(rest);
  if (name === null) return { text: "$", next: start + 1 };
  const value = resolve2(name[0]);
  if (value !== void 0) return { text: value, next: start + 1 + name[0].length };
  return { text: "$", next: start + 1 };
}

// src/common/parse-command.ts
var ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
var SET_OPTION_NAMES = /* @__PURE__ */ new Set([
  "allexport",
  "braceexpand",
  "emacs",
  "errexit",
  "errtrace",
  "functrace",
  "hashall",
  "histexpand",
  "history",
  "ignoreeof",
  "interactive-comments",
  "keyword",
  "lexical-word-processing",
  "monitor",
  "noclobber",
  "noexec",
  "noglob",
  "nolog",
  "notify",
  "nounset",
  "onecmd",
  "physical",
  "pipefail",
  "posix",
  "privileged",
  "verbose",
  "vi",
  "xtrace"
]);
var SET_FLAG_LETTERS = "aBbCeEfhHikmnopPtTuvx";
var RECOGNIZED_BUILTINS = /* @__PURE__ */ new Set([
  "true",
  ":",
  "false",
  "set",
  "exit",
  "exec",
  "return",
  "break",
  "continue",
  "cd",
  "export",
  "command",
  "builtin"
]);
function walkStrip(argv) {
  let i = 0;
  while (i < argv.length && argv[i] === "!") i++;
  while (i < argv.length && argv[i] === "command") i++;
  while (i < argv.length && argv[i] === "builtin" && argv[i + 1] !== void 0 && RECOGNIZED_BUILTINS.has(argv[i + 1]))
    i++;
  return argv.slice(i);
}
function stripForEmission(argv) {
  let i = 0;
  while (i < argv.length && argv[i] === "!") i++;
  while (i < argv.length && (argv[i] === "command" || argv[i] === "exec")) i++;
  while (i < argv.length && argv[i] === "builtin" && argv[i + 1] !== void 0 && RECOGNIZED_BUILTINS.has(argv[i + 1]))
    i++;
  return argv.slice(i);
}
function setFlagsKnown(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") continue;
    if (a.startsWith("-") || a.startsWith("+")) {
      const chars = a.slice(1);
      if (chars.length === 0) return false;
      for (let k = 0; k < chars.length; k++) {
        const c = chars[k];
        if (c === "o") {
          const name = args[i + 1];
          if (name === void 0 || !SET_OPTION_NAMES.has(name)) return false;
          i++;
        } else if (!SET_FLAG_LETTERS.includes(c)) {
          return false;
        }
      }
    }
  }
  return true;
}
var CONSTRUCT_OPENERS = /* @__PURE__ */ new Set(["if", "while", "until", "for", "case", "select"]);
var CONSTRUCT_CLOSERS = /* @__PURE__ */ new Set(["fi", "done", "esac"]);
function scanTokens(text) {
  const toks = [];
  let i = 0;
  const n = text.length;
  let parenDepth = 0;
  let braceDepth = 0;
  let constructDepth = 0;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(" || c === "{") {
      if (c === "(") parenDepth++;
      else braceDepth++;
      i++;
      continue;
    }
    if (c === ")" || c === "}") {
      if (c === ")") parenDepth = Math.max(0, parenDepth - 1);
      else braceDepth = Math.max(0, braceDepth - 1);
      i++;
      continue;
    }
    if (";&|<>".includes(c)) {
      i++;
      continue;
    }
    const start = i;
    const w = readWordAt(text, i);
    if (w === null) {
      i++;
      continue;
    }
    i = w.end;
    toks.push({ word: w.word, start, end: w.end, depth: parenDepth, braceDepth, constructDepth, quoted: w.quoted });
    if (parenDepth === 0 && braceDepth === 0 && !w.quoted) {
      if (CONSTRUCT_OPENERS.has(w.word)) constructDepth++;
      else if (CONSTRUCT_CLOSERS.has(w.word)) constructDepth = Math.max(0, constructDepth - 1);
    }
  }
  return toks;
}
function readWordAt(text, i) {
  if (i >= text.length) return null;
  let word = "";
  let quoted = false;
  const n = text.length;
  while (i < n && !/\s/.test(text[i]) && !"(){};&|<>".includes(text[i])) {
    const ch = text[i];
    if (ch === "'") {
      quoted = true;
      i++;
      while (i < n && text[i] !== "'") {
        word += text[i];
        i++;
      }
      if (i < n) i++;
    } else if (ch === '"') {
      quoted = true;
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < n && '"\\$`'.includes(text[i + 1])) {
          word += text[i + 1];
          i += 2;
        } else {
          word += text[i];
          i++;
        }
      }
      if (i < n) i++;
    } else if (ch === "\\" && i + 1 < n) {
      word += text[i + 1];
      i += 2;
    } else {
      word += ch;
      i++;
    }
  }
  return { word, end: i, quoted };
}
function extractGroupBody(text, open, close) {
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inQuote = null;
  for (let p = start; p < text.length; p++) {
    const ch = text[p];
    if (inQuote !== null) {
      if (ch === "\\" && inQuote === '"' && p + 1 < text.length && '"\\$`'.includes(text[p + 1])) p++;
      else if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === "\\") {
      p++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start + 1, p);
    }
  }
  return null;
}
function classifyStage(text) {
  const t = text.trimStart();
  if (t.startsWith("{")) return "brace";
  if (t.startsWith("(")) return "subshell";
  const kw = t.match(/^(if|while|until|for|case|select)\b/);
  if (kw !== null) return kw[1];
  if (/^(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{/.test(t)) return "def";
  return "plain";
}
function parseDef(text) {
  const m = text.match(/^(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*\{/);
  if (m === null) return null;
  const body = extractGroupBody(text, "{", "}");
  if (body === null) return null;
  return { name: m[1], body };
}
function parseIf(text) {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== "if") return null;
  const thenIdx = toks.findIndex((t) => t.word === "then" && t.constructDepth === 1);
  if (thenIdx === -1) return null;
  const thenTok = toks[thenIdx];
  const condition = text.slice(toks[0].end, thenTok.start);
  const boundaries = [];
  for (let idx = thenIdx + 1; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.constructDepth !== 1 || t.word !== "elif" && t.word !== "else" && t.word !== "fi") continue;
    if (t.word === "elif") {
      const eThenIdx = toks.findIndex((tt, ii) => ii > idx && tt.word === "then" && tt.constructDepth === 1);
      if (eThenIdx === -1) return null;
      boundaries.push({ word: "elif", tok: t }, { word: "then", tok: toks[eThenIdx] });
      idx = eThenIdx;
      continue;
    }
    boundaries.push({ word: t.word, tok: t });
    if (t.word === "else") {
      const fiIdx = toks.findIndex((tt, ii) => ii > idx && tt.word === "fi" && tt.constructDepth === 1);
      if (fiIdx === -1) return null;
      boundaries.push({ word: "fi", tok: toks[fiIdx] });
      break;
    }
    break;
  }
  if (boundaries.length === 0) return null;
  const thenBody = text.slice(thenTok.end, boundaries[0].tok.start);
  const elifs = [];
  let elseBody = null;
  for (let b = 0; b < boundaries.length; b++) {
    const { word, tok } = boundaries[b];
    if (word === "elif") {
      const eThen = boundaries[b + 1];
      if (eThen === void 0 || eThen.word !== "then") return null;
      const nextStart = boundaries[b + 2]?.tok.start ?? text.length;
      elifs.push({ condition: text.slice(tok.end, eThen.tok.start), body: text.slice(eThen.tok.end, nextStart) });
      b++;
    } else if (word === "else") {
      const fi = boundaries[b + 1];
      if (fi === void 0 || fi.word !== "fi") return null;
      elseBody = text.slice(tok.end, fi.tok.start);
      break;
    }
  }
  return { condition, thenBody, elifs, elseBody };
}
function parseLoop(text, keyword) {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== keyword) return null;
  const doTok = toks.find((t) => t.word === "do" && t.constructDepth === 1);
  if (doTok === void 0) return null;
  const doneTok = toks.find((t) => t.start > doTok.end && t.word === "done" && t.constructDepth === 1);
  if (doneTok === void 0) return null;
  return { condition: text.slice(toks[0].end, doTok.start), body: text.slice(doTok.end, doneTok.start) };
}
function parseFor(text) {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== "for") return null;
  const nameTok = toks[1];
  if (nameTok === void 0) return null;
  const doTok = toks.find((t) => t.word === "do" && t.constructDepth === 1 && t.start > nameTok.end);
  if (doTok === void 0) return null;
  const doneTok = toks.find((t) => t.start > doTok.end && t.word === "done" && t.constructDepth === 1);
  if (doneTok === void 0) return null;
  const inTok = toks.find(
    (t) => t.start > nameTok.end && t.start < doTok.start && t.word === "in" && t.constructDepth === 1
  );
  let list = null;
  if (inTok !== void 0) {
    list = toks.filter((t) => t.start > inTok.end && t.start < doTok.start).map((t) => t.word);
  }
  return { list, body: text.slice(doTok.end, doneTok.start), wholeInterior: text.slice(nameTok.end, doneTok.start) };
}
function parseCase(text) {
  let i = 0;
  const n = text.length;
  const skipWs = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };
  skipWs();
  const lead = readWordAt(text, i);
  if (lead === null || lead.word !== "case") return null;
  i = lead.end;
  let parenDepth = 0;
  const subjectWords = [];
  while (i < n) {
    skipWs();
    if (i >= n) return null;
    const c = text[i];
    if (c === "(") {
      parenDepth++;
      i++;
      continue;
    }
    if (c === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      i++;
      continue;
    }
    if (";&|<>".includes(c)) {
      i++;
      continue;
    }
    const w = readWordAt(text, i);
    if (w === null) {
      i++;
      continue;
    }
    i = w.end;
    if (parenDepth === 0 && !w.quoted && w.word === "in") break;
    subjectWords.push(w.word);
  }
  if (i >= n) return null;
  const branches = [];
  let fallthrough = false;
  while (true) {
    skipWs();
    if (i >= n) return null;
    const w = readWordAt(text, i);
    if (w !== null && !w.quoted && w.word === "esac") {
      return { subject: subjectWords.join(" "), branches, fallthrough };
    }
    let patEnd = -1;
    {
      let p = i;
      let depth = 0;
      let inQuote = null;
      while (p < n) {
        const ch = text[p];
        if (inQuote !== null) {
          if (ch === "\\" && inQuote === '"' && p + 1 < n && '"\\$`'.includes(text[p + 1])) {
            p += 2;
            continue;
          }
          if (ch === inQuote) inQuote = null;
          p++;
          continue;
        }
        if (ch === "'" || ch === '"') {
          inQuote = ch;
          p++;
          continue;
        }
        if (ch === "\\") {
          p += 2;
          continue;
        }
        if (ch === "(") {
          depth++;
          p++;
          continue;
        }
        if (ch === ")") {
          if (depth === 0) {
            patEnd = p;
            break;
          }
          depth--;
          p++;
          continue;
        }
        p++;
      }
    }
    if (patEnd === -1) return null;
    const pattern = text.slice(i, patEnd).trim();
    i = patEnd + 1;
    let bodyEnd = -1;
    let term = "";
    {
      let p = i;
      let depth = 0;
      let bdepth = 0;
      let inQuote = null;
      while (p < n) {
        const ch = text[p];
        if (inQuote !== null) {
          if (ch === "\\" && inQuote === '"' && p + 1 < n && '"\\$`'.includes(text[p + 1])) {
            p += 2;
            continue;
          }
          if (ch === inQuote) inQuote = null;
          p++;
          continue;
        }
        if (ch === "'" || ch === '"') {
          inQuote = ch;
          p++;
          continue;
        }
        if (ch === "\\") {
          p += 2;
          continue;
        }
        if (ch === "(") {
          depth++;
          p++;
          continue;
        }
        if (ch === ")") {
          depth = Math.max(0, depth - 1);
          p++;
          continue;
        }
        if (ch === "{") {
          bdepth++;
          p++;
          continue;
        }
        if (ch === "}") {
          bdepth = Math.max(0, bdepth - 1);
          p++;
          continue;
        }
        if (depth === 0 && bdepth === 0 && ch === ";") {
          const next = text[p + 1];
          if (next === ";" || next === "&") {
            term = next === ";" ? text[p + 2] === "&" ? ";;&" : ";;" : ";&";
            bodyEnd = p;
            break;
          }
        }
        p++;
      }
    }
    if (term === "") return null;
    branches.push({ pattern, body: text.slice(i, bodyEnd).trim() });
    i = bodyEnd + term.length;
    if (term === ";&" || term === ";;&") fallthrough = true;
  }
}
function resolveSubject(subject, assignments) {
  const m = subject.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/) ?? subject.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (m !== null) {
    const v = assignments.get(m[1]);
    return v !== void 0 ? v : null;
  }
  if (/[$`]/.test(subject)) return null;
  return subject;
}
function splitPatternAlternatives(pattern) {
  const parts = [];
  let cur = "";
  let inQuote = null;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inQuote !== null) {
      if (ch === "\\" && inQuote === '"' && i + 1 < pattern.length && '"\\$`'.includes(pattern[i + 1])) {
        cur += ch;
        cur += pattern[i + 1];
        i++;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
        cur += ch;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      cur += ch;
      continue;
    }
    if (ch === "\\" && i + 1 < pattern.length) {
      cur += ch;
      cur += pattern[i + 1];
      i++;
      continue;
    }
    if (ch === "|") {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}
function analyzePattern(pattern) {
  let literal = "";
  let glob = false;
  let inQuote = null;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inQuote !== null) {
      if (ch === "\\" && inQuote === '"' && i + 1 < pattern.length && '"\\$`'.includes(pattern[i + 1])) {
        literal += pattern[i + 1];
        i++;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
        continue;
      }
      literal += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === "\\" && i + 1 < pattern.length) {
      literal += pattern[i + 1];
      i++;
      continue;
    }
    if ("*?[".includes(ch)) {
      glob = true;
      literal += ch;
      continue;
    }
    literal += ch;
  }
  return { literal, glob };
}
function evalPattern(pattern, subject) {
  const alts = splitPatternAlternatives(pattern);
  let matched = false;
  for (const alt of alts) {
    const { literal, glob } = analyzePattern(alt);
    if (glob) {
      if (!matched) return "glob";
    } else if (literal === subject) {
      matched = true;
    } else if (matched) {
      return "undecidable";
    }
  }
  return matched ? "match" : "no-match";
}
var ExecutionWalker = class {
  chain = "success";
  errexit = false;
  pipefail = false;
  assignments = /* @__PURE__ */ new Map();
  defs = /* @__PURE__ */ new Map();
  dead = null;
  returned = false;
  fnDepth = 0;
  loopStack = [];
  expanded = [];
  verdicts = [];
  dirFrame = 0;
  defProbeStack = /* @__PURE__ */ new Set();
  walkInput(stages) {
    this.walkList(stages, { liveness: true, discard: false, sideEffects: true, inputFacing: true });
    return this.expanded;
  }
  stopped() {
    if (this.dead !== null || this.returned) return true;
    const top = this.loopStack[this.loopStack.length - 1];
    return top !== void 0 && (top.bodyTerminated || top.ambiguousStop);
  }
  /** Walk one list (a fresh `&&`/`||` chain); returns the list's final chain status. */
  walkList(stages, opts) {
    const savedChain = this.chain;
    this.chain = "success";
    let i = 0;
    while (i < stages.length && !this.stopped()) {
      const end = this.groupEnd(stages, i);
      const next = end < stages.length ? stages[end] : null;
      this.processGroup(stages.slice(i, end), next, opts);
      i = end;
    }
    const result = this.chain;
    while (i < stages.length) {
      if (opts.inputFacing) this.verdicts.push("no");
      i++;
    }
    this.chain = savedChain;
    return result;
  }
  groupEnd(stages, start) {
    let end = start;
    while (end + 1 < stages.length && stages[end + 1].precededBy === "pipe") end++;
    return end + 1;
  }
  processGroup(group, next, opts) {
    const first = group[0];
    let executes;
    switch (first.precededBy) {
      case "and":
        executes = this.chain === "success" ? true : this.chain === "failure" ? false : "unknown";
        break;
      case "or":
        executes = this.chain === "failure" ? true : this.chain === "success" ? false : "unknown";
        break;
      default:
        executes = true;
    }
    const exec = executes === true ? "yes" : executes === false ? "no" : "unknown";
    const backgrounded = first.precededBy === "background" || next !== null && next.precededBy === "background";
    if (opts.inputFacing) {
      for (let i = 0; i < group.length; i++) this.verdicts.push(exec);
    }
    const firstArgv = argvOf(first.text);
    let bangCount = 0;
    let memberArgv = firstArgv;
    if (firstArgv !== null) {
      while (memberArgv[bangCount] === "!") bangCount++;
      memberArgv = memberArgv.slice(bangCount);
    }
    const inverted = bangCount % 2 === 1;
    if (exec === "no") return;
    const statuses = [];
    const inPipeline = group.length > 1;
    for (let m = 0; m < group.length; m++) {
      statuses.push(
        this.processMember(group[m], {
          exec,
          inPipeline,
          backgrounded,
          memberArgv: m === 0 ? memberArgv : null,
          opts
        })
      );
    }
    let groupStatus;
    if (this.pipefail && group.length > 1) {
      if (statuses.every((s) => s === "success")) groupStatus = "success";
      else if (statuses.some((s) => s === "failure")) groupStatus = "failure";
      else groupStatus = "unknown";
    } else {
      groupStatus = statuses[statuses.length - 1];
    }
    if (inverted) {
      groupStatus = groupStatus === "success" ? "failure" : groupStatus === "failure" ? "success" : "unknown";
    }
    if (opts.liveness && this.errexit && groupStatus !== "success") {
      const chainFinal = next === null || next.precededBy !== "and" && next.precededBy !== "or";
      if (chainFinal && !inverted && !backgrounded) this.dead = "errexit";
    }
    if (exec === "yes") this.chain = groupStatus;
    else this.chain = "unknown";
  }
  processMember(member, ctx) {
    const kind = classifyStage(member.text);
    if (kind === "plain") return this.processPlainMember(member, ctx);
    return this.processConstruct(member, kind, ctx);
  }
  processPlainMember(member, ctx) {
    const { exec, inPipeline, backgrounded, memberArgv, opts } = ctx;
    const argv = memberArgv ?? argvOf(member.text);
    const stripped = argv === null ? null : walkStrip(argv);
    if (exec === "yes" && !inPipeline && opts.sideEffects) {
      this.applySideEffects(member, argv, stripped);
    }
    const status = this.knownStatus(argv);
    if (!inPipeline && exec !== "no" && stripped !== null && (stripped[0] === "exit" || stripped[0] === "exec")) {
      this.dead = "exit";
    }
    if (!inPipeline && exec === "yes" && this.fnDepth > 0 && stripped !== null && stripped[0] === "return") {
      this.returned = true;
      const top = this.loopStack[this.loopStack.length - 1];
      if (top !== void 0) top.outcome = "return";
    }
    if (!inPipeline && exec !== "no" && stripped !== null && (stripped[0] === "break" || stripped[0] === "continue")) {
      this.applyBreakContinue(stripped, exec);
    }
    if (exec !== "no" && stripped !== null && stripped.length > 0) {
      this.applyCall(stripped[0], inPipeline, backgrounded);
    }
    if (!opts.discard) {
      this.expanded.push({
        text: member.text,
        precededBy: member.precededBy,
        exec,
        inPipeline,
        dirFrame: this.dirFrame,
        assignments: new Map(this.assignments)
      });
    }
    return status;
  }
  applyBreakContinue(stripped, exec) {
    const depth = Number.parseInt(stripped[1] ?? "1", 10);
    if (Number.isNaN(depth) || depth < 1) return;
    if (this.loopStack.length === 0 || depth > this.loopStack.length) return;
    if (exec === "unknown") {
      for (let d = 0; d < depth; d++) {
        const frame = this.loopStack[this.loopStack.length - 1 - d];
        if (frame.outcome === "none") {
          frame.outcome = "ambiguous";
          frame.ambiguousStop = true;
        }
      }
      return;
    }
    const isContinue = stripped[0] === "continue";
    for (let d = 0; d < depth; d++) {
      const frame = this.loopStack[this.loopStack.length - 1 - d];
      frame.outcome = isContinue ? "continue" : "break";
      frame.bodyTerminated = true;
    }
  }
  /** A may-run call to a registered definition fires per its body's dead kind. */
  applyCall(name, inPipeline, backgrounded) {
    if (!this.defs.has(name) || backgrounded) return;
    if (this.defProbeStack.has(name)) return;
    const body = this.defs.get(name);
    this.defProbeStack.add(name);
    const kind = this.defBodyFireKind(body);
    this.defProbeStack.delete(name);
    if (kind === null) return;
    if (kind === "never-return") {
      this.dead = "never-return";
    } else if (!inPipeline) {
      this.dead = kind;
    }
  }
  /** Whether a definition body, walked as its own function, ends dead. */
  defBodyFireKind(body) {
    const res = splitTopLevel(body);
    if (res.malformed !== void 0) return "malformed";
    const savedDead = this.dead;
    const savedReturned = this.returned;
    const savedFnDepth = this.fnDepth;
    const savedLoopStack = this.loopStack;
    this.dead = null;
    this.returned = false;
    this.fnDepth = this.fnDepth + 1;
    this.loopStack = [];
    this.walkList(res.stages, { liveness: true, discard: true, sideEffects: true, inputFacing: false });
    const kind = this.dead;
    this.dead = savedDead;
    this.returned = savedReturned;
    this.fnDepth = savedFnDepth;
    this.loopStack = savedLoopStack;
    return kind;
  }
  knownStatus(argv) {
    if (argv === null || argv.length === 0) return "success";
    const a = walkStrip(stripWrappers(stripRedirects(argv)));
    if (a.length === 0) return "success";
    if (a[0] === "true" || a[0] === ":") return "success";
    if (a[0] === "false") return "failure";
    if (a.every((w) => ASSIGNMENT_RE.test(w))) return "success";
    if (a[0] === "export" && a.length > 1 && a.slice(1).every((w) => ASSIGNMENT_RE.test(w))) return "success";
    if (a[0] === "set") return setFlagsKnown(a.slice(1)) ? "success" : "unknown";
    return "unknown";
  }
  applySideEffects(member, argv, stripped) {
    if (argv === null || argv.length === 0) return;
    const words = splitWords(member.text);
    if (words !== null && words.length > 0) {
      let k = 0;
      while (k < words.length && ASSIGNMENT_RE.test(words[k])) k++;
      if (k === words.length) {
        for (const w of words) {
          const eq = w.indexOf("=");
          this.assignments.set(w.slice(0, eq), w.slice(eq + 1));
        }
      } else if (words[0] === "export") {
        for (const w of words.slice(1)) {
          if (ASSIGNMENT_RE.test(w)) {
            const eq = w.indexOf("=");
            this.assignments.set(w.slice(0, eq), w.slice(eq + 1));
          }
        }
      }
    }
    if (stripped !== null && stripped[0] === "set") this.applySetFlags(stripped.slice(1));
    if (stripped !== null && stripped[0] === "unset") {
      for (const w of stripped.slice(1)) {
        if (!w.startsWith("-")) this.assignments.delete(w);
      }
    }
  }
  applySetFlags(args) {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--") continue;
      if (!(a.startsWith("-") || a.startsWith("+"))) continue;
      const on = a.startsWith("-");
      const chars = a.slice(1);
      for (let k = 0; k < chars.length; k++) {
        const c = chars[k];
        if (c === "o") {
          const name = args[i + 1];
          if (name === void 0) return;
          if (name === "errexit") this.errexit = on;
          else if (name === "noerrexit") this.errexit = !on;
          else if (name === "pipefail") this.pipefail = on;
          else if (name === "nopipefail") this.pipefail = !on;
          i++;
          break;
        }
        if (c === "e") this.errexit = on;
      }
    }
  }
  processConstruct(member, kind, ctx) {
    const { exec, backgrounded, opts } = ctx;
    const discard = opts.discard || exec !== "yes";
    const sideEffects = opts.sideEffects && exec === "yes";
    switch (kind) {
      case "if": {
        const parsed = parseIf(member.text);
        if (parsed === null) return "unknown";
        const regions = [
          parsed.condition,
          parsed.thenBody,
          ...parsed.elifs.flatMap((e) => [e.condition, e.body]),
          ...parsed.elseBody !== null ? [parsed.elseBody] : []
        ];
        const condStatus = this.walkList(splitTopLevel(parsed.condition).stages, {
          liveness: false,
          discard: true,
          sideEffects: true,
          inputFacing: false
        });
        if (condStatus === "unknown") return this.opaquePath(regions, ctx);
        if (condStatus === "success") {
          return this.walkBranch(parsed.thenBody, discard, sideEffects);
        }
        for (const elif of parsed.elifs) {
          const eStatus = this.walkList(splitTopLevel(elif.condition).stages, {
            liveness: false,
            discard: true,
            sideEffects: true,
            inputFacing: false
          });
          if (eStatus === "unknown") return this.opaquePath(regions, ctx);
          if (eStatus === "success") return this.walkBranch(elif.body, discard, sideEffects);
        }
        if (parsed.elseBody !== null) return this.walkBranch(parsed.elseBody, discard, sideEffects);
        return "success";
      }
      case "while":
      case "until": {
        const parsed = parseLoop(member.text, kind);
        if (parsed === null) return "unknown";
        const condStatus = this.walkList(splitTopLevel(parsed.condition).stages, {
          liveness: false,
          discard: true,
          sideEffects: true,
          inputFacing: false
        });
        if (condStatus === "unknown") return this.opaquePath([parsed.condition, parsed.body], ctx);
        const bodyRuns = kind === "while" ? condStatus === "success" : condStatus === "failure";
        if (!bodyRuns) return "success";
        const res = splitTopLevel(parsed.body);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        const frame = { outcome: "none", bodyTerminated: false, ambiguousStop: false };
        this.loopStack.push(frame);
        this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
        this.loopStack.pop();
        switch (frame.outcome) {
          case "break":
            return "success";
          case "continue":
          case "none":
            if (this.dead === null && !backgrounded) this.dead = "never-return";
            return "unknown";
          case "ambiguous":
          case "return":
            return "unknown";
        }
        return "unknown";
      }
      case "for": {
        const parsed = parseFor(member.text);
        if (parsed === null) return "unknown";
        if (parsed.list === null || parsed.list.some((w) => /[$`]/.test(w))) {
          return this.opaquePath([parsed.wholeInterior], ctx);
        }
        if (parsed.list.length === 0) return "success";
        const res = splitTopLevel(parsed.body);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
      }
      case "case": {
        const parsed = parseCase(member.text);
        if (parsed === null) return "unknown";
        const regions = parsed.branches.map((b) => b.body);
        if (parsed.fallthrough || resolveSubject(parsed.subject, this.assignments) === null) {
          return this.opaquePath(regions, ctx);
        }
        const subject = resolveSubject(parsed.subject, this.assignments);
        let matchedBranch = -1;
        let undecidable = false;
        for (let b = 0; b < parsed.branches.length; b++) {
          const r = evalPattern(parsed.branches[b].pattern, subject);
          if (r === "match") {
            matchedBranch = b;
            break;
          }
          if (r === "glob" || r === "undecidable") {
            undecidable = true;
            break;
          }
        }
        if (undecidable) return this.opaquePath(regions, ctx);
        if (matchedBranch !== -1) {
          return this.walkBranch(parsed.branches[matchedBranch].body, discard, sideEffects);
        }
        return "success";
      }
      case "select": {
        const parsed = parseLoop(member.text, "while");
        return this.opaquePath(parsed !== null ? [parsed.body] : [], ctx);
      }
      case "brace": {
        const interior = extractGroupBody(member.text, "{", "}");
        if (interior === null) return "unknown";
        const res = splitTopLevel(interior);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
      }
      case "subshell": {
        const interior = extractGroupBody(member.text, "(", ")");
        if (interior === null) return "unknown";
        const res = splitTopLevel(interior);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        const savedErrexit = this.errexit;
        const savedPipefail = this.pipefail;
        const savedAssignments = this.assignments;
        const savedDefs = this.defs;
        const savedReturned = this.returned;
        const savedFnDepth = this.fnDepth;
        const savedLoopStack = this.loopStack;
        const savedDirFrame = this.dirFrame;
        const savedDead = this.dead;
        this.errexit = savedErrexit;
        this.pipefail = savedPipefail;
        this.assignments = new Map(savedAssignments);
        this.defs = new Map(savedDefs);
        this.returned = false;
        this.fnDepth = 0;
        this.loopStack = [];
        this.dirFrame = savedDirFrame + 1;
        this.dead = null;
        const status = this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
        const innerDead = this.dead;
        this.errexit = savedErrexit;
        this.pipefail = savedPipefail;
        this.assignments = savedAssignments;
        this.defs = savedDefs;
        this.returned = savedReturned;
        this.fnDepth = savedFnDepth;
        this.loopStack = savedLoopStack;
        this.dirFrame = savedDirFrame;
        this.dead = savedDead;
        if (innerDead === "never-return") this.dead = "never-return";
        return status;
      }
      case "def": {
        if (sideEffects) {
          const def = parseDef(member.text);
          if (def !== null) this.defs.set(def.name, def.body);
        }
        return "success";
      }
    }
    return "unknown";
  }
  walkBranch(body, discard, sideEffects) {
    const res = splitTopLevel(body);
    if (res.malformed !== void 0) {
      this.dead = "malformed";
      return "unknown";
    }
    return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
  }
  /**
   * The opaque-construct treatment (plan §2): re-split each region and walk it
   * with the same machinery so an `exit`/`exec` that may have run, or a
   * never-exit loop, fires fail-closed; hidden break/continue words reach the
   * scanned loop as an ambiguous termination. State is snapshot-restored.
   */
  opaquePath(regions, ctx) {
    const findings = this.scanOpaque(regions);
    if (findings.fire !== null) {
      if (findings.fire === "never-return") {
        if (!ctx.backgrounded) this.dead = "never-return";
      } else if (!ctx.inPipeline && !ctx.backgrounded) {
        this.dead = findings.fire;
      }
    }
    if (findings.breakTarget !== "none") {
      const top = this.loopStack[this.loopStack.length - 1];
      if (top !== void 0) {
        top.outcome = "ambiguous";
        top.ambiguousStop = true;
      }
    }
    return "unknown";
  }
  scanOpaque(regions) {
    const report = {
      fire: null,
      breakTarget: "none"
    };
    const savedChain = this.chain;
    const savedErrexit = this.errexit;
    const savedPipefail = this.pipefail;
    const savedAssignments = this.assignments;
    const savedDefs = this.defs;
    const savedDead = this.dead;
    const savedReturned = this.returned;
    const savedFnDepth = this.fnDepth;
    const savedLoopStack = this.loopStack;
    const savedDirFrame = this.dirFrame;
    const savedVerdicts = this.verdicts.length;
    const savedExpanded = this.expanded.length;
    const savedDefProbe = new Set(this.defProbeStack);
    for (const region of regions) {
      const res = splitTopLevel(region);
      if (res.malformed !== void 0) {
        report.fire = "malformed";
        break;
      }
      this.dead = null;
      this.returned = false;
      this.loopStack = savedLoopStack.map((f) => ({ ...f }));
      this.walkList(res.stages, { liveness: true, discard: true, sideEffects: false, inputFacing: false });
      if (this.dead !== null) {
        if (report.fire === null || this.dead === "never-return" || this.dead === "malformed") report.fire = this.dead;
      }
      if (report.breakTarget === "none") {
        const innermost = this.loopStack[this.loopStack.length - 1];
        if (innermost !== void 0 && (innermost.outcome === "break" || innermost.outcome === "continue")) {
          report.breakTarget = innermost.outcome;
        }
      }
    }
    this.chain = savedChain;
    this.errexit = savedErrexit;
    this.pipefail = savedPipefail;
    this.assignments = savedAssignments;
    this.defs = savedDefs;
    this.dead = savedDead;
    this.returned = savedReturned;
    this.fnDepth = savedFnDepth;
    this.loopStack = savedLoopStack;
    this.dirFrame = savedDirFrame;
    this.verdicts.length = savedVerdicts;
    this.expanded.length = savedExpanded;
    this.defProbeStack.clear();
    for (const name of savedDefProbe) this.defProbeStack.add(name);
    return report;
  }
};
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
var HEREDOC_OPEN = /\bcat[ \t]+(>{1,2})[ \t]*(\S+)[ \t]*<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))/g;
function escapeRegExp2(s) {
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
    const openEnd = openMatch.index + openMatch[0].length;
    if (!delim || openMatch.index < cursor) {
      HEREDOC_OPEN.lastIndex = openMatch.index + 1;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    const nl = raw.slice(openEnd).match(/^[ \t]*\r?\n/);
    const bodyStart = nl !== null ? openEnd + nl[0].length : openEnd;
    const remainder = raw.slice(bodyStart);
    const closeRe = new RegExp(`^${dash ? "\\t*" : ""}${escapeRegExp2(delim)}[ \\t]*$`, "m");
    const closeMatch = closeRe.exec(remainder);
    let body;
    let matchEnd;
    if (closeMatch) {
      body = remainder.slice(0, closeMatch.index).replace(/\n$/, "");
      matchEnd = bodyStart + closeMatch.index + closeMatch[0].length;
    } else if (nl === null) {
      body = "";
      matchEnd = openEnd;
    } else {
      body = remainder.replace(/\n$/, "");
      matchEnd = raw.length;
    }
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
var NL_ARG_FLAGS = /* @__PURE__ */ new Set(["-b", "-i", "-l", "-s", "-v", "-w"]);
var STDOUT_REDIRECT_TWO_TOKEN = /^(?:>>?|&>>?|1>>?|>\|)$/;
var STDOUT_REDIRECT_FUSED = /^(?:>>?|&>>?|1>>?)[^<>&|]/;
var STDOUT_REDIRECT_FUSED_PIPE = /^>\|[^<>&|]/;
var hasStdoutRedirect = (raw) => raw.some(
  (w) => STDOUT_REDIRECT_TWO_TOKEN.test(w) || STDOUT_REDIRECT_FUSED.test(w) || STDOUT_REDIRECT_FUSED_PIPE.test(w)
);
function analyzeSource(argv) {
  if (argv[0] === "cat" || argv[0] === "nl") {
    const files = [];
    if (argv[0] === "cat") {
      for (let i = 1; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("-") && a !== "-") continue;
        files.push(a);
      }
    } else {
      for (let i = 1; i < argv.length; i++) {
        const a = argv[i];
        if (a === "-") {
          files.push(a);
          continue;
        }
        if (a.startsWith("-")) {
          if (NL_ARG_FLAGS.has(a)) i += 1;
          continue;
        }
        files.push(a);
      }
    }
    const real = files.filter((f) => f !== "-");
    if (real.length === 0) return { kind: "none" };
    const idiom = argv[0] === "cat" ? "cat-file" : "nl-file";
    if (real.length === 1 && !files.includes("-")) {
      return { kind: "narrowable", fileArg: real[0], idiom, resolverKind: "fs" };
    }
    return { kind: "unnarrowable", files: real.map((fileArg) => ({ fileArg, idiom })) };
  }
  if (argv[0] === "git") {
    const outcomes = matchGitShow(argv);
    if (outcomes.length === 1) {
      const o = outcomes[0];
      if (o.kind === "unresolved") {
        return { kind: "gitUnresolved", fileArg: o.fileArg, reason: o.reason };
      }
      if (o.kind === "candidate" && o.resolverKind !== "fs") {
        return {
          kind: "git",
          fileArg: o.fileArg,
          idiom: "git-show-rev-path",
          rev: o.resolverKind.rev,
          resolverKind: o.resolverKind,
          dirOverride: o.dirOverride
        };
      }
    }
  }
  return { kind: "none" };
}
function classifyStdinSelector(argv) {
  if (argv[0] === "head" || argv[0] === "tail") {
    const { count, fromStart, disqualified, files } = parseHeadTailFlags(argv.slice(1), argv[0] === "tail");
    if (disqualified) return null;
    const fileArgs = files.filter((f) => f !== "-");
    if (fileArgs.length > 0) return null;
    return argv[0] === "head" ? { kind: "head", count: count ?? 10 } : { kind: "tail", count: count ?? 10, fromStart };
  }
  if (argv[0] === "sed") {
    const rest = argv.slice(1);
    if (!rest.includes("-n")) return null;
    let scriptIdx = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "-n") continue;
      if (sedScriptSegments(rest[i]).some((seg) => SED_RANGE.test(seg))) {
        scriptIdx = i;
        break;
      }
    }
    if (scriptIdx === -1) return null;
    const fileCandidates = rest.filter((a, i) => i !== scriptIdx && a !== "-n" && !a.startsWith("-"));
    if (fileCandidates.length !== 0) return null;
    const ranges = [];
    for (const segment of sedScriptSegments(rest[scriptIdx])) {
      const m = segment.match(SED_RANGE);
      if (!m) continue;
      const start = Number.parseInt(m[1], 10);
      ranges.push({ start, end: m[2] === void 0 ? start : m[2] === "$" ? "$" : Number.parseInt(m[2], 10) });
    }
    if (ranges.length === 0) return null;
    return { kind: "sed", ranges };
  }
  return null;
}
var LINE_SELECTORS = [matchSed, matchHead, matchTail];
function parseCommandDetailed(command, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const allowlist = opts.allowlist ?? DEFAULT_PATH_ALLOWLIST;
  const env = opts.env ?? Object.fromEntries(allowlist.map((n) => [n, process.env[n]]));
  const { writes: heredocWrites, masked } = extractHeredocWrites(command);
  const { stages: simpleCommands, malformed } = splitTopLevel(masked);
  void malformed;
  const expanded = new ExecutionWalker().walkInput(simpleCommands);
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
  const dirFrames = [{ dir: cwd, certain: true, prev: void 0 }];
  const gitDirOf = (c, frame) => {
    if (c.dirOverride === void 0) return frame.certain ? frame.dir : void 0;
    if (isAbsolute2(c.dirOverride)) return c.dirOverride;
    return frame.certain ? resolvePath(frame.dir, c.dirOverride) : void 0;
  };
  let window = null;
  const wholeFileCandidate = (s) => ({
    kind: "candidate",
    idiom: s.idiom,
    fileArg: s.fileArg,
    spec: { kind: "toEof", start: 1 },
    resolverKind: "fs"
  });
  const sourceCandidate = (src) => ({
    kind: "candidate",
    idiom: src.idiom,
    fileArg: src.fileArg,
    spec: { kind: "toEof", start: 1 },
    resolverKind: src.resolverKind,
    dirOverride: src.dirOverride
  });
  const emitWindowTouch = (w) => {
    const spec = w.consumed ? { kind: "literal", start: w.lo, end: w.hi } : { kind: "toEof", start: 1 };
    emitCandidate(
      {
        kind: "candidate",
        idiom: w.idiom,
        fileArg: w.fileArg,
        spec,
        resolverKind: w.resolverKind,
        dirOverride: w.dirOverride
      },
      { dir: w.dir, certain: w.certain }
    );
  };
  const initWindow = (src, frame) => {
    if (gitDirOf(src, frame) === void 0 || !frame.certain && src.resolverKind === "fs" && !isAbsolute2(src.fileArg)) {
      emitCandidate(sourceCandidate(src), frame);
      return;
    }
    const total = (src.resolverKind === "fs" ? cachedFsTotalLines(resolvePath(frame.dir, src.fileArg)) : cachedGitTotalLines(gitDirOf(src, frame), src.resolverKind.rev, src.fileArg))();
    if (total === null) {
      emitCandidate(sourceCandidate(src), frame);
      return;
    }
    window = {
      idiom: src.idiom,
      fileArg: src.fileArg,
      dir: frame.dir,
      certain: frame.certain,
      dirOverride: src.dirOverride,
      resolverKind: src.resolverKind,
      lo: 1,
      hi: total,
      consumed: false
    };
  };
  const applyWindowTransform = (sel) => {
    const w = window;
    const lo = w.lo;
    const hi = w.hi;
    let nLo;
    let nHi;
    if (sel.kind === "head") {
      nLo = lo;
      nHi = lo + sel.count - 1;
    } else if (sel.kind === "tail") {
      if (sel.fromStart) {
        nLo = lo + sel.count - 1;
        nHi = hi;
      } else {
        nLo = hi - sel.count + 1;
        nHi = hi;
      }
    } else {
      nLo = lo + sel.ranges[0].start - 1;
      nHi = sel.ranges[0].end === "$" ? hi : lo + sel.ranges[0].end - 1;
    }
    nLo = Math.max(nLo, lo);
    nHi = Math.min(nHi, hi);
    if (nLo > nHi) return false;
    w.lo = nLo;
    w.hi = nHi;
    w.consumed = true;
    return true;
  };
  const emitMultiRange = (ranges) => {
    const w = window;
    let emitted = false;
    for (const r of ranges) {
      const mLo = Math.max(w.lo, w.lo + r.start - 1);
      const mHi = Math.min(w.hi, r.end === "$" ? w.hi : w.lo + r.end - 1);
      if (mLo > mHi) continue;
      emitted = true;
      emitCandidate(
        {
          kind: "candidate",
          idiom: w.idiom,
          fileArg: w.fileArg,
          spec: { kind: "literal", start: mLo, end: mHi },
          resolverKind: w.resolverKind,
          dirOverride: w.dirOverride
        },
        { dir: w.dir, certain: w.certain }
      );
    }
    if (!emitted) emitWindowTouch(w);
  };
  const emitCandidate = (c, frame) => {
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
    const resolutionDir = c.resolverKind === "fs" ? frame.dir : gitDirOf(c, frame);
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
      span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath }
    });
  };
  for (let i = 0; i < expanded.length; i++) {
    const item = expanded[i];
    while (dirFrames.length > item.dirFrame + 1) dirFrames.pop();
    while (dirFrames.length < item.dirFrame + 1) dirFrames.push({ ...dirFrames[dirFrames.length - 1] });
    const frame = dirFrames[dirFrames.length - 1];
    const stageEnv = { ...env, PWD: frame.dir };
    const pipePrecedes = item.precededBy === "pipe";
    const pipeFollows = expanded[i + 1] !== void 0 && expanded[i + 1].precededBy === "pipe";
    if (!pipePrecedes && window !== null) {
      emitWindowTouch(window);
      window = null;
    }
    const cdArgv = stripForEmission(stripRedirects(argvOf(item.text) ?? []));
    if (cdArgv[0] === "cd" && !item.inPipeline) {
      if (item.exec === "yes") {
        const expandedArgv = stripForEmission(
          stripRedirects(argvOf(expandVariables(item.text, item.assignments, stageEnv)) ?? [])
        );
        const target = expandedArgv[1];
        if (target === void 0 || target === "~" || target.startsWith("~/")) {
          const home = expandVariables("$HOME", item.assignments, stageEnv);
          if (looksUnresolvable(home)) frame.certain = false;
          else {
            frame.prev = frame.dir;
            frame.dir = resolvePath(frame.dir, target === void 0 ? home : home + target.slice(1));
            frame.certain = true;
          }
        } else if (target === "-") {
          if (frame.prev !== void 0) {
            const old = frame.dir;
            frame.dir = frame.prev;
            frame.prev = old;
          }
        } else if (target.startsWith("~")) {
          frame.certain = false;
        } else if (looksUnresolvable(target)) {
          frame.certain = false;
        } else {
          frame.prev = frame.dir;
          frame.dir = resolvePath(frame.dir, target);
          frame.certain = true;
        }
      } else if (item.exec === "unknown") {
        frame.certain = false;
      }
      continue;
    }
    if (item.exec !== "yes") {
      continue;
    }
    const heredocRef = item.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef) {
      if (window !== null) {
        emitWindowTouch(window);
        window = null;
      }
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
      if (!frame.certain && !isAbsolute2(w.target)) {
        results.push({
          status: "unresolved",
          idiom: "heredoc-write",
          fileArg: w.target,
          reason: "the working directory is uncertain \u2014 the relative path cannot be resolved"
        });
        continue;
      }
      const absolutePath = resolvePath(frame.dir, w.target);
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
    const rawArgv = argvOf(expandVariables(item.text, item.assignments, stageEnv)) ?? [];
    const stripped = stripForEmission(stripWrappers(stripRedirects(rawArgv)));
    if (stripped.length === 0) {
      if (window !== null) {
        emitWindowTouch(window);
        window = null;
      }
      continue;
    }
    if (stripped.some((w) => w.startsWith(">") || w.startsWith("<"))) {
      if (window !== null) {
        emitWindowTouch(window);
        window = null;
      }
      continue;
    }
    if (!pipePrecedes && pipeFollows && (stripped[0] === "cat" || stripped[0] === "nl" || stripped[0] === "git")) {
      const src = analyzeSource(stripped);
      switch (src.kind) {
        case "none":
          break;
        // fall through to the ordinary dispatch
        case "gitUnresolved":
          results.push({
            status: "unresolved",
            idiom: "git-show-rev-path",
            fileArg: src.fileArg,
            reason: src.reason
          });
          continue;
        case "unnarrowable": {
          for (const f of src.files) emitCandidate(wholeFileCandidate(f), frame);
          continue;
        }
        case "narrowable":
        case "git": {
          if (hasStdoutRedirect(rawArgv)) {
            emitCandidate(sourceCandidate(src), frame);
          } else {
            initWindow(src, frame);
          }
          continue;
        }
      }
    }
    if (pipePrecedes && window !== null) {
      const sel = classifyStdinSelector(stripped);
      if (sel !== null) {
        if (sel.kind === "sed" && sel.ranges.length > 1) {
          emitMultiRange(sel.ranges);
          window = null;
        } else {
          applyWindowTransform(sel);
          if (hasStdoutRedirect(rawArgv)) {
            emitWindowTouch(window);
            window = null;
          }
        }
      } else {
        emitWindowTouch(window);
        window = null;
      }
    }
    if (stripped[0] === "cat" || stripped[0] === "nl") {
      const src = analyzeSource(stripped);
      if (src.kind === "narrowable") {
        emitCandidate(wholeFileCandidate({ fileArg: src.fileArg, idiom: src.idiom }), frame);
      } else if (src.kind === "unnarrowable") {
        for (const f of src.files) emitCandidate(wholeFileCandidate(f), frame);
      }
    } else {
      for (const matcher of [...LINE_SELECTORS, matchGitShow, matchGitLogL]) {
        for (const outcome of matcher(stripped)) {
          if (outcome.kind === "unresolved") {
            results.push({
              status: "unresolved",
              idiom: outcome.idiom,
              fileArg: outcome.fileArg,
              reason: outcome.reason
            });
          } else {
            emitCandidate(outcome, frame);
          }
        }
      }
    }
  }
  if (window !== null) {
    emitWindowTouch(window);
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
            return {
              matched: true,
              cmd: parsed.cmd,
              workdir: typeof parsed.workdir === "string" ? parsed.workdir : null
            };
          }
          return { matched: true, cmd: null, workdir: null };
        } catch {
          return { matched: true, cmd: null, workdir: null };
        }
      }
    }
  }
  return { matched: false, cmd: null, workdir: null };
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
      let workdir = null;
      if (tool_name === "Bash") {
        const raw = input.tool_input?.command;
        command2 = typeof raw === "string" ? raw : null;
      } else {
        const classic = narrowExecCommand(input.tool_input);
        command2 = classic?.cmd ?? null;
        workdir = classic?.workdir ?? null;
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
        workdir = codeMode.workdir;
      }
      if (!command2) return void 0;
      const effectiveCwd = workdir !== null && !/[`$]/.test(workdir) ? resolvePath2(cwd, workdir) : cwd;
      const matches = parseCommandDetailed(command2, { cwd: effectiveCwd });
      const blocks2 = [];
      for (const match of matches) {
        if (match.status !== "resolved") continue;
        const span = match.span;
        const absPath = abspathAgainst(effectiveCwd, span.absolutePath);
        const scope = resolveTouchScope(effectiveCwd, absPath);
        if (!scope) continue;
        let touchInput;
        if (match.idiom === "heredoc-write") {
          const written = span.redirect === ">" ? "" : span.body ?? "";
          touchInput = { kind: "write", sessionId, cwd: effectiveCwd, filePath: absPath, written };
        } else {
          touchInput = {
            kind: "read",
            sessionId,
            cwd: effectiveCwd,
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UudHMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3ZhcmlhYmxlLWV4cGFuZC50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb2RleC9hcHBseS1wYXRjaC50cyIsICJzcmMvY29kZXgvcG9zdC10b29sLXVzZS1lbnRyeS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqXG4gKiBDb2RleCBQb3N0VG9vbFVzZSB0b3VjaCBob29rIFx1MjAxNCBoZWFsICsgc3VyZmFjZSBhZnRlciBhIGNvbmZpcm1lZCBgYXBwbHlfcGF0Y2hgLFxuICogb3IgYSBzaGVsbC9leGVjIGNhbGwgd2hvc2UgY29tbWFuZCBzdGF0aWNhbGx5IHJlc29sdmVzIHRvIGZpbGUrbGluZSBpZGlvbXMuXG4gKlxuICogUG9zdFRvb2xVc2UgZmlyZXMgYWZ0ZXIgYGFwcGx5X3BhdGNoYCBoYXMgcnVuLCBzbyB0aGlzIGlzIHRoZSBhY2N1cmF0ZSBob21lIGZvclxuICogdGhlIHRvdWNoIHNpZ25hbDogdGhlIGZpbGUgaXMgYWxyZWFkeSB3cml0dGVuLCBzbyBhIHNjb3BlZCBgZ2l0IHNwYW4gZHJpZnRcbiAqIDxmaWxlPiAtLWZpeGAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBhZ2FpbnN0IHJlYWwgYnl0ZXMgYW5kIHRoZSBzdXJmYWNlZCBibG9ja1xuICogcmVmbGVjdHMgdGhlIGhlYWxlZCBhbmNob3JzLiBUaGUgaGFuZGxlciBuYXJyb3dzIHRoZSBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlXG4gKiAoYHRvb2xfaW5wdXQuY29tbWFuZGAsIFNESy10eXBlZCBgdW5rbm93bmApIGludG8gcGVyLWZpbGUgYW5jaG9ycyB2aWEgdGhlXG4gKiBzaGFyZWQgW2FwcGx5LXBhdGNoIHBhcnNlcl0oLi9hcHBseS1wYXRjaC50cyksIGFuZCByZWNvdmVycyBzaGVsbCBjb21tYW5kc1xuICogZnJvbSBlaXRoZXIgQ29kZXggZW52ZWxvcGUgKGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgSlNPTiBgYXJndW1lbnRzYCwgb3JcbiAqIGNvZGUtbW9kZSBgZXhlY2Agd3JhcHBpbmcgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgKSB2aWEgdGhlIHNoYXJlZFxuICogW2NvbW1hbmQgcGFyc2VyXSguLi9jb21tb24vcGFyc2UtY29tbWFuZC50cyk7IGVhY2ggdG91Y2hlZCBmaWxlIGlzIHNjb3BlZCB0b1xuICogdGhlIENXRCByZXBvLCBhbmQgZHJpdmVzIHRoZSBoYXJuZXNzLWFnbm9zdGljIHtAbGluayBydW5Ub3VjaEhvb2t9IGNvcmUgXHUyMDE0IHRoZVxuICogc2FtZSBjb3JlIHRoZSBDbGF1ZGUgYWRhcHRlciB1c2VzLlxuICpcbiAqIFR3byBDb2RleC1zcGVjaWZpYyBjb25jZXJucyBhcmUgcHJlc2VydmVkIGZyb20gdGhpcyBmaWxlJ3Mgam91cm5hbGluZ1xuICogcHJlZGVjZXNzb3I6XG4gKlxuICogMS4gKipTdWNjZXNzIGNsYXNzaWZpY2F0aW9uLioqIFRoZSBwYXJzZWQgZW52ZWxvcGUgZGVzY3JpYmVzICppbnRlbnQqLCBub3RcbiAqICAgICpvdXRjb21lKi4gQ29kZXggY29yZSBmaXJlcyBQb3N0VG9vbFVzZSBvbmx5IG9uIHRvb2wgc3VjY2VzcywgYnV0IGFzIGFcbiAqICAgIGR1cmFiaWxpdHkgYmVsdCB3ZSBjbGFzc2lmeSBgdG9vbF9yZXNwb25zZWAgdmlhXG4gKiAgICB7QGxpbmsgY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2V9OiBhIGNvbmZpcm1lZCByZWplY3Rpb24gKGAnZmFpbHVyZSdgKVxuICogICAgc3VwcHJlc3NlcyB0aGUgdG91Y2ggKG5vIHBoYW50b20gaGVhbC9zdXJmYWNlIG9uIGEgcGF0Y2ggdGhhdCBuZXZlclxuICogICAgYXBwbGllZCk7IGEgc3VjY2VzcyBvciBhbiB1bnJlY29nbml6ZWQgc2hhcGUgKGAndW5rbm93bidgLCB3YXJuZWQpIHByb2NlZWRzLlxuICogMi4gKipObyBwb3N0LWVkaXQgcmFuZ2UgcmVjb3ZlcnkgZnJvbSB0aGUgZW52ZWxvcGUuKiogUG9zdFRvb2xVc2UgcnVucyBhZnRlclxuICogICAgdGhlIHBhdGNoIHJld3JvdGUgdGhlIGZpbGUsIHNvIHRoZSBodW5rJ3MgcHJlLWVkaXQgYmxvY2sgbm8gbG9uZ2VyIHNpdHNcbiAqICAgIHdoZXJlIHRoZSBlZGl0IGhhcHBlbmVkIGFuZCBjb3VsZCBtaXMtYW5jaG9yIGEgZHVwbGljYXRlLiBUaGUgdG91Y2ggaXNcbiAqICAgIHNjb3BlZCBmaWxlLXdpZGUgKGB3cml0dGVuOiAnJ2AgXHUyMTkyIHdob2xlLWZpbGUpLCB3aGljaCBpcyBleGFjdGx5IHRoZVxuICogICAgYmVoYXZpb3Ige0BsaW5rIHJ1blRvdWNoSG9va30gdGFrZXMgZm9yIGFuIGVtcHR5IHdyaXRlLlxuICpcbiAqIFRoZSB0aW1lb3V0IGlzIG1pbGxpc2Vjb25kcyBpbiB0aGUgaGFuZGxlciBjb25maWcgKHRoZSBDTEkgZW1pdHMgYDEwYCBzZWNvbmRzKVxuICogXHUyMDE0IHNlZSB0aGUgdGltZW91dC11bml0cyBzcGlrZSBub3RlOyB0aGUgc291cmNlIHZhbHVlIG11c3Qgc3RheSBpbiBtcyBzbyB0aGVcbiAqIENvZGV4IGJ1aWxkJ3Mgc2Vjb25kcyBjb252ZXJzaW9uIGF0IGVtaXQgcmVtYWlucyBjb3JyZWN0LlxuICovXG5cbmltcG9ydCB7IHJlc29sdmUgYXMgcmVzb2x2ZVBhdGggfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgdHlwZSBIb29rQ29udGV4dCwgdHlwZSBQb3N0VG9vbFVzZUlucHV0LCBwb3N0VG9vbFVzZUhvb2ssIHBvc3RUb29sVXNlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NvZGV4LWhvb2tzJztcbmltcG9ydCB7IGFic3BhdGhBZ2FpbnN0IH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBwYXJzZUNvbW1hbmREZXRhaWxlZCB9IGZyb20gJy4uL2NvbW1vbi9wYXJzZS1jb21tYW5kLmpzJztcbmltcG9ydCB7IGNyZWF0ZURpc2tNZW1vU3RvcmUsIHR5cGUgTWVtb0ZhY3RvcnksIHJlc29sdmVUb3VjaFNjb3BlIH0gZnJvbSAnLi4vY29tbW9uL3NwYW4tc3VyZmFjZS5qcyc7XG5pbXBvcnQge1xuICBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMsXG4gIHJ1blRvdWNoSG9vayxcbiAgdHlwZSBUb3VjaEV4ZWN1dG9ycyxcbiAgdHlwZSBUb3VjaElucHV0XG59IGZyb20gJy4uL2NvbW1vbi90b3VjaC1jb3JlLmpzJztcbmltcG9ydCB7IHBhcnNlQXBwbHlQYXRjaCB9IGZyb20gJy4vYXBwbHktcGF0Y2guanMnO1xuXG4vKipcbiAqIFRoZSBwcmVmaXggYXBwbHlfcGF0Y2gncyBzdGRvdXQgY2FycmllcyB3aGVuIFx1MjAxNCBhbmQgb25seSB3aGVuIFx1MjAxNCB0aGUgcGF0Y2hcbiAqIGFwcGxpZWQgKGNvZGV4LXJzL2FwcGx5LXBhdGNoIGBwcmludF9zdW1tYXJ5YCkuIENvZGV4IHN1cmZhY2VzIHRoYXQgc3Rkb3V0XG4gKiB2ZXJiYXRpbSBhcyB0aGUgUG9zdFRvb2xVc2UgYHRvb2xfcmVzcG9uc2VgIChhIGJhcmUgc3RyaW5nIHRvZGF5KS4gRml4ZWRcbiAqIGFjcm9zcyBBZGQvTW9kaWZ5L0RlbGV0ZTsgdGhlIGhlYWRlciBpcyBmb2xsb3dlZCBieSBgQS9NL0QgPHBhdGg+YCBsaW5lcy5cbiAqL1xuY29uc3QgQVBQTFlfUEFUQ0hfU1VDQ0VTU19QUkVGSVggPSAnU3VjY2Vzcy4gVXBkYXRlZCB0aGUgZm9sbG93aW5nIGZpbGVzOic7XG5cbi8qKlxuICogVGhlIGNvbW1vbiBmaWVsZHMgYW4gb2JqZWN0LXdyYXBwZWQgdG9vbF9yZXNwb25zZSBtaWdodCBjYXJyeSB0aGUgdG9vbCdzIHRleHRcbiAqIG91dHB1dCB1bmRlciwgaWYgQ29kZXggZXZlciBzdG9wcyBzdXJmYWNpbmcgaXQgYXMgYSBiYXJlIHN0cmluZy4gT3JkZXJlZCBieVxuICogbGlrZWxpaG9vZDsgdGhlIGZpcnN0IGZpZWxkIHdob3NlIHZhbHVlIGlzIGEgc3RyaW5nIHdpbnMuXG4gKi9cbmNvbnN0IFJFU1BPTlNFX1RFWFRfRklFTERTID0gWydvdXRwdXQnLCAnc3Rkb3V0JywgJ2NvbnRlbnQnLCAndGV4dCddIGFzIGNvbnN0O1xuXG4vKiogTmFycm93IHRoZSBTREsncyBgdW5rbm93bmAgdG9vbF9pbnB1dCB0byB0aGUgYGFwcGx5X3BhdGNoYCBgeyBjb21tYW5kIH1gIHNoYXBlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5hcnJvd0FwcGx5UGF0Y2hDb21tYW5kKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ICE9PSBudWxsICYmIHR5cGVvZiB0b29sSW5wdXQgPT09ICdvYmplY3QnICYmICdjb21tYW5kJyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBjb21tYW5kID0gKHRvb2xJbnB1dCBhcyB7IGNvbW1hbmQ6IHVua25vd24gfSkuY29tbWFuZDtcbiAgICBpZiAodHlwZW9mIGNvbW1hbmQgPT09ICdzdHJpbmcnKSByZXR1cm4gY29tbWFuZDtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBOYXJyb3cgdGhlIGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgZW52ZWxvcGUgKGNsaV92ZXJzaW9uIFx1MjI2NCAwLjEzMC4wKTpcbiAqIGB0b29sX2lucHV0LmFyZ3VtZW50c2AgaXMgYSBKU09OICpzdHJpbmcqIG9mIHNoYXBlXG4gKiBge1wiY21kXCI6IFwiLi4uXCIsIFwid29ya2RpclwiOiBcIi4uLlwifWAgXHUyMDE0IHBhcnNlIGl0IGFuZCByZXR1cm4gdGhlIGBjbWRgIGFuZFxuICogYHdvcmtkaXJgLiBSZXR1cm5zIGBudWxsYCBmb3IgYW55IG90aGVyIHNoYXBlIChub3QgSlNPTiwgbm8gYGNtZGAgZmllbGQsIG9yXG4gKiBub3QgdGhpcyBlbnZlbG9wZSk7IGB3b3JrZGlyYCBpcyBgbnVsbGAgd2hlbiBhYnNlbnQgb3Igbm90IGEgc3RyaW5nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93RXhlY0NvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogeyBjbWQ6IHN0cmluZzsgd29ya2Rpcjogc3RyaW5nIHwgbnVsbCB9IHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2FyZ3VtZW50cycgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgYXJncyA9ICh0b29sSW5wdXQgYXMgeyBhcmd1bWVudHM6IHVua25vd24gfSkuYXJndW1lbnRzO1xuICAgIGlmICh0eXBlb2YgYXJncyA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoYXJncyk7XG4gICAgICAgIGlmIChwYXJzZWQgIT09IG51bGwgJiYgdHlwZW9mIHBhcnNlZCA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHBhcnNlZC5jbWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgcmV0dXJuIHsgY21kOiBwYXJzZWQuY21kLCB3b3JrZGlyOiB0eXBlb2YgcGFyc2VkLndvcmtkaXIgPT09ICdzdHJpbmcnID8gcGFyc2VkLndvcmtkaXIgOiBudWxsIH07XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogVGhlIHJlc3VsdCBvZiBuYXJyb3dpbmcgdGhlIGNvZGUtbW9kZSBgZXhlY2AgZW52ZWxvcGUuIGBtYXRjaGVkYCBzZXBhcmF0ZXNcbiAqIFwidGhlIGVudmVsb3BlIHdhcyBhIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCBjYWxsIHdob3NlIGFyZ3VtZW50IGNvdWxkIG5vdFxuICogYmUgcmVjb3ZlcmVkXCIgKGEgdmFyaWFibGUvdGVtcGxhdGUtYnVpbHQgY29tbWFuZCBcdTIwMTQgc3RhdGljYWxseSB1bnJlc29sdmFibGUpXG4gKiBmcm9tIFwidGhlIGVudmVsb3BlIGlzIG5vdCBjb2RlLW1vZGUgZXhlYyBhdCBhbGxcIiwgc28gdGhlIGhhbmRsZXIgY2FuIHdhcm4gb25cbiAqIHRoZSBmb3JtZXIgaW5zdGVhZCBvZiBzaWxlbnRseSBjb25mbGF0aW5nIGl0IHdpdGggdGhlIGxhdHRlci5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb2RlTW9kZUV4ZWNOYXJyb3cge1xuICAvKiogV2hldGhlciBgdG9vbF9pbnB1dC5pbnB1dGAgY29udGFpbmVkIGEgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIGNhbGwuICovXG4gIG1hdGNoZWQ6IGJvb2xlYW47XG4gIC8qKiBUaGUgcmVjb3ZlcmVkIGBjbWRgIHN0cmluZywgb3IgYG51bGxgIHdoZW4gbWF0Y2hlZCBidXQgdW5wYXJzYWJsZSAvIGFic2VudC4gKi9cbiAgY21kOiBzdHJpbmcgfCBudWxsO1xuICAvKiogVGhlIHJlY292ZXJlZCBgd29ya2RpcmAgc3RyaW5nLCBvciBgbnVsbGAgd2hlbiBhYnNlbnQgb3Igbm90IGEgc3RyaW5nLiAqL1xuICB3b3JrZGlyOiBzdHJpbmcgfCBudWxsO1xufVxuXG4vKipcbiAqIFF1b3RlIGJhcmUgaWRlbnRpZmllciBrZXlzIGluIGEgSlMgb2JqZWN0IGxpdGVyYWwgc28gYEpTT04ucGFyc2VgIGNhbiByZWFkXG4gKiBpdC4gUmVhbCBjb2RlLW1vZGUgY2FsbCBzaXRlcyBlbWl0IEpTLXN0eWxlIHVucXVvdGVkIGtleXNcbiAqIChge2NtZDpcInNlZCAtbiAnMSwyNDBwJyAvcGF0aFwiLC4uLn1gKSwgd2hpY2ggaXMgdmFsaWQgSlMgYnV0IGludmFsaWQgSlNPTi5cbiAqIFN0cmluZyB2YWx1ZXMgKHNpbmdsZS0gb3IgZG91YmxlLXF1b3RlZCkgYXJlIGNvcGllZCB2ZXJiYXRpbSBcdTIwMTQgaW5jbHVkaW5nIGFueVxuICogYCwga2V5OmAtc2hhcGVkIHRleHQgaW5zaWRlIHRoZW0gXHUyMDE0IGFuZCBhbHJlYWR5LXF1b3RlZCBrZXlzIHBhc3MgdGhyb3VnaFxuICogdW50b3VjaGVkLlxuICovXG5mdW5jdGlvbiBxdW90ZU9iamVjdEtleXMobGl0ZXJhbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IG91dCA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBsaXRlcmFsLmxlbmd0aDtcbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IGxpdGVyYWxbaV07XG4gICAgaWYgKGMgPT09ICdcIicgfHwgYyA9PT0gXCInXCIpIHtcbiAgICAgIGNvbnN0IHF1b3RlID0gYztcbiAgICAgIGNvbnN0IHN0YXJ0ID0gaTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIHdoaWxlIChpIDwgbikge1xuICAgICAgICBpZiAobGl0ZXJhbFtpXSA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikgaSArPSAyO1xuICAgICAgICBlbHNlIGlmIChsaXRlcmFsW2ldID09PSBxdW90ZSkge1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfSBlbHNlIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIG91dCArPSBsaXRlcmFsLnNsaWNlKHN0YXJ0LCBpKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBrZXkgPSBsaXRlcmFsLnNsaWNlKGkpLm1hdGNoKC9eKFxce3wsKVxccyooW0EtWmEtel8kXVtBLVphLXowLTlfJF0qKVxccyo6Lyk7XG4gICAgaWYgKGtleSkge1xuICAgICAgb3V0ICs9IGAke2tleVsxXX1cIiR7a2V5WzJdfVwiOmA7XG4gICAgICBpICs9IGtleVswXS5sZW5ndGg7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgb3V0ICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogTmFycm93IHRoZSBjb2RlLW1vZGUgYGV4ZWNgIGVudmVsb3BlIChjbGlfdmVyc2lvbiBcdTIyNjUgMC4xNDQuMCk6XG4gKiBgdG9vbF9pbnB1dC5pbnB1dGAgaXMgSlMgc291cmNlIHRoYXQgY2FsbHMgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIFx1MjAxNFxuICogcmVjb3ZlciB0aGUgbGl0ZXJhbCBvYmplY3QgYXJndW1lbnQgdmlhIGJhbGFuY2VkLWJyYWNlIG1hdGNoaW5nLCBxdW90ZSBpdHNcbiAqIHVucXVvdGVkIEpTIGtleXMsIGFuZCBwYXJzZSBpdC4gQSBjb21tYW5kIGJ1aWx0IGZyb20gdmFyaWFibGVzIG9yIHRlbXBsYXRlXG4gKiBsaXRlcmFscyBpcyBzdGF0aWNhbGx5IHVucmVzb2x2YWJsZTogdGhlIGNhbGwgc3RpbGwgKm1hdGNoZWQqIGJ1dCB5aWVsZHNcbiAqIGBjbWQ6IG51bGxgLCByZXBvcnRlZCBkaXN0aW5jdGx5IGZyb20gYSBub24tY29kZS1tb2RlIGVudmVsb3BlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93Q29kZU1vZGVFeGVjKHRvb2xJbnB1dDogdW5rbm93bik6IENvZGVNb2RlRXhlY05hcnJvdyB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2lucHV0JyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBpbnB1dCA9ICh0b29sSW5wdXQgYXMgeyBpbnB1dDogdW5rbm93biB9KS5pbnB1dDtcbiAgICBpZiAodHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJykge1xuICAgICAgLy8gTWF0Y2ggdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KSBcdTIwMTQgZXh0cmFjdCB0aGUgbGl0ZXJhbCBvYmplY3QgYXJndW1lbnRcbiAgICAgIGNvbnN0IG1hdGNoID0gaW5wdXQubWF0Y2goL3Rvb2xzXFwuZXhlY19jb21tYW5kXFwoXFxzKihcXHsoPzpbXnt9XXxcXHsoPzpbXnt9XXxcXHtbXnt9XSpcXH0pKlxcfSkqXFx9KVxccypcXCkvKTtcbiAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocXVvdGVPYmplY3RLZXlzKG1hdGNoWzFdKSk7XG4gICAgICAgICAgaWYgKHBhcnNlZCAhPT0gbnVsbCAmJiB0eXBlb2YgcGFyc2VkID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgcGFyc2VkLmNtZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG1hdGNoZWQ6IHRydWUsXG4gICAgICAgICAgICAgIGNtZDogcGFyc2VkLmNtZCxcbiAgICAgICAgICAgICAgd29ya2RpcjogdHlwZW9mIHBhcnNlZC53b3JrZGlyID09PSAnc3RyaW5nJyA/IHBhcnNlZC53b3JrZGlyIDogbnVsbFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHsgbWF0Y2hlZDogdHJ1ZSwgY21kOiBudWxsLCB3b3JrZGlyOiBudWxsIH07XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIG1hdGNoZWQsIGJ1dCB0aGUgbGl0ZXJhbCBkaWQgbm90IHBhcnNlIFx1MjAxNCB0aGUgY2FsbCBpcyBzdGlsbCBhXG4gICAgICAgICAgLy8gY29kZS1tb2RlIGV4ZWMgd2hvc2UgY29tbWFuZCBjYW5ub3QgYmUgcmVjb3ZlcmVkIHN0YXRpY2FsbHkuXG4gICAgICAgICAgcmV0dXJuIHsgbWF0Y2hlZDogdHJ1ZSwgY21kOiBudWxsLCB3b3JrZGlyOiBudWxsIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgbWF0Y2hlZDogZmFsc2UsIGNtZDogbnVsbCwgd29ya2RpcjogbnVsbCB9O1xufVxuXG4vKipcbiAqIFRvbGVyYW50bHkgcHVsbCB0aGUgdG9vbCdzIHRleHR1YWwgb3V0cHV0IG91dCBvZiBhIGB0b29sX3Jlc3BvbnNlYCBvZlxuICogdW5jZXJ0YWluIHNoYXBlIChTREstdHlwZWQgYHVua25vd25gKTogYSBiYXJlIHN0cmluZyAodG9kYXkncyBDb2RleCkgaXNcbiAqIHJldHVybmVkIGFzLWlzOyBhbiBvYmplY3QgaXMgcHJvYmVkIGZvciB0aGUgZmlyc3Qge0BsaW5rIFJFU1BPTlNFX1RFWFRfRklFTERTfVxuICogZW50cnkgdGhhdCBob2xkcyBhIHN0cmluZy4gUmV0dXJucyBgbnVsbGAgd2hlbiBubyB0ZXh0IGNhbiBiZSByZWNvdmVyZWRcbiAqICh1bmtub3duIG9iamVjdCBzaGFwZSwgYG51bGxgLCBvciBhIG5vbi1zdHJpbmcvbm9uLW9iamVjdCksIHdoaWNoIHRoZSBjYWxsZXJcbiAqIHRyZWF0cyBhcyBhbiAqdW5yZWNvZ25pemVkKiBcdTIwMTQgbm90ICpmYWlsZWQqIFx1MjAxNCByZXNwb25zZS5cbiAqL1xuZnVuY3Rpb24gZXh0cmFjdFJlc3BvbnNlVGV4dCh0b29sUmVzcG9uc2U6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdzdHJpbmcnKSByZXR1cm4gdG9vbFJlc3BvbnNlO1xuICBpZiAodG9vbFJlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdvYmplY3QnKSB7XG4gICAgY29uc3QgcmVjb3JkID0gdG9vbFJlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGZvciAoY29uc3QgZmllbGQgb2YgUkVTUE9OU0VfVEVYVF9GSUVMRFMpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcmVjb3JkW2ZpZWxkXTtcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIENsYXNzaWZ5IGFuIGBhcHBseV9wYXRjaGAgYHRvb2xfcmVzcG9uc2VgIGZvciB0aGUgdG91Y2ggZ2F0ZTpcbiAqXG4gKiAtIGAnc3VjY2VzcydgIFx1MjAxNCB0ZXh0IHdhcyByZWNvdmVyZWQgYW5kIGNhcnJpZXMge0BsaW5rIEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYfS5cbiAqIC0gYCdmYWlsdXJlJ2AgXHUyMDE0IHRleHQgd2FzIHJlY292ZXJlZCBidXQgbGFja3MgdGhlIGhlYWRlcjogYSBnZW51aW5lIHJlamVjdGlvblxuICogICBvciBlcnJvci4gVGhlIE9OTFkgY2xhc3NpZmljYXRpb24gdGhhdCBzdXBwcmVzc2VzIHRoZSB0b3VjaC5cbiAqIC0gYCd1bmtub3duJ2AgXHUyMDE0IG5vIHRleHQgY291bGQgYmUgcmVjb3ZlcmVkICh1bnJlY29nbml6ZWQgc2hhcGUpLiBXZSBwcm9jZWVkXG4gKiAgIGRlZmVuc2l2ZWx5IGhlcmUgcmF0aGVyIHRoYW4gcmlzayBtaXNzaW5nIGEgcmVhbCBlZGl0J3MgaGVhbC9zdXJmYWNlOyBDb2RleFxuICogICBjb3JlIGZpcmVzIFBvc3RUb29sVXNlIG9ubHkgb24gc3VjY2Vzcywgc28gdGhpcyBjYW5ub3QgaGVhbC9zdXJmYWNlIGEgcGF0Y2hcbiAqICAgdGhhdCBuZXZlciBhcHBsaWVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2UodG9vbFJlc3BvbnNlOiB1bmtub3duKTogJ3N1Y2Nlc3MnIHwgJ2ZhaWx1cmUnIHwgJ3Vua25vd24nIHtcbiAgY29uc3QgdGV4dCA9IGV4dHJhY3RSZXNwb25zZVRleHQodG9vbFJlc3BvbnNlKTtcbiAgaWYgKHRleHQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gIHJldHVybiB0ZXh0LnN0YXJ0c1dpdGgoQVBQTFlfUEFUQ0hfU1VDQ0VTU19QUkVGSVgpID8gJ3N1Y2Nlc3MnIDogJ2ZhaWx1cmUnO1xufVxuXG4vKiogQSByZWFkZXIgdGhhdCBhbHdheXMgZGVjbGluZXMsIGZvcmNpbmcgdGhlIHBhcnNlciB0byB3aG9sZS1maWxlIGFuY2hvcnMuICovXG5jb25zdCBub1JhbmdlUmVjb3ZlcnkgPSAoKTogbnVsbCA9PiBudWxsO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSGFuZGxlcihcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyA9IGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycygpLFxuICBtZW1vRmFjdG9yeTogTWVtb0ZhY3RvcnkgPSBjcmVhdGVEaXNrTWVtb1N0b3JlXG4pIHtcbiAgcmV0dXJuIGFzeW5jIChpbnB1dDogUG9zdFRvb2xVc2VJbnB1dCwgY3R4OiBIb29rQ29udGV4dCkgPT4ge1xuICAgIGNvbnN0IHRvb2xfbmFtZSA9IGlucHV0LnRvb2xfbmFtZTtcbiAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgY29uc3Qgc2Vzc2lvbklkID0gaW5wdXQuc2Vzc2lvbl9pZDtcbiAgICBjb25zdCBtZW1vID0gbWVtb0ZhY3RvcnkoY3R4LmxvZ2dlcik7XG5cbiAgICAvLyBTaGVsbCB0b3VjaDogZXh0cmFjdCB0aGUgY29tbWFuZCBmcm9tIHdoaWNoZXZlciBlbnZlbG9wZSBzaGFwZSB0aGUgaGFybmVzc1xuICAgIC8vIGRlbGl2ZXJzLCBwYXJzZSwgYW5kIHJ1biBlYWNoIHJlc29sdmVkIHNwYW4gdGhyb3VnaCB0aGUgc2hhcmVkIHRvdWNoIGNvcmUuXG4gICAgLy9cbiAgICAvLyAtIGBCYXNoYDogdGhlIGhhcm5lc3MtdW53cmFwcGVkIHNoYXBlIENvZGV4IFx1MjI2NTAuMTQ0IGFjdHVhbGx5IHNlbmRzIFx1MjAxNFxuICAgIC8vICAgYHRvb2xfaW5wdXQuY29tbWFuZGAgaXMgdGhlIHJhdyBzaGVsbCBjb21tYW5kIHN0cmluZyAoc2FtZSBzaGFwZSB0aGVcbiAgICAvLyAgIENsYXVkZSBhZGFwdGVyIGhhbmRsZXMpLlxuICAgIC8vIC0gYGV4ZWNfY29tbWFuZGA6IGNsYXNzaWMgZnVuY3Rpb25fY2FsbCBlbnZlbG9wZSAoY2xpIFx1MjI2NDAuMTMwKSBcdTIwMTRcbiAgICAvLyAgIGB0b29sX2lucHV0LmFyZ3VtZW50c2AgaXMgYSBKU09OIHN0cmluZyB3aXRoIGEgYGNtZGAgZmllbGQuXG4gICAgLy8gLSBgZXhlY2A6IGRpcmVjdCBjb2RlLW1vZGUgZW52ZWxvcGUgKG1heSBzaGlwIGluIGEgZnV0dXJlIENMSSkgXHUyMDE0XG4gICAgLy8gICBgdG9vbF9pbnB1dC5pbnB1dGAgaXMgSlMgc291cmNlIHdyYXBwaW5nIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYC5cbiAgICAvL1xuICAgIC8vIEEgY29tbWFuZCB3aXRoIG5vIHJlY29nbml6ZWQgaWRpb20geWllbGRzIG5vIGJsb2NrcyBhbmQgcmV0dXJucyB1bmRlZmluZWQgXHUyMDE0XG4gICAgLy8gZmFpbC1vcGVuLCBzYW1lIGFzIHRoZSBhcHBseV9wYXRjaCBwYXRoIGJlbG93LlxuICAgIGlmICh0b29sX25hbWUgPT09ICdCYXNoJyB8fCB0b29sX25hbWUgPT09ICdleGVjX2NvbW1hbmQnIHx8IHRvb2xfbmFtZSA9PT0gJ2V4ZWMnKSB7XG4gICAgICBsZXQgY29tbWFuZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICBsZXQgd29ya2Rpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICBpZiAodG9vbF9uYW1lID09PSAnQmFzaCcpIHtcbiAgICAgICAgLy8gVGhlIGhhcm5lc3MgYWxyZWFkeSB1bndyYXBwZWQgdGhlIGNvZGUtbW9kZSBlbnZlbG9wZSBcdTIwMTQgdGhlIGNvbW1hbmQgaXNcbiAgICAgICAgLy8gaW4gYHRvb2xfaW5wdXQuY29tbWFuZGAsIGV4YWN0bHkgYXMgdGhlIENsYXVkZSBhZGFwdGVyIHJlY2VpdmVzIGl0LlxuICAgICAgICBjb25zdCByYXcgPSAoaW5wdXQudG9vbF9pbnB1dCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwpPy5jb21tYW5kO1xuICAgICAgICBjb21tYW5kID0gdHlwZW9mIHJhdyA9PT0gJ3N0cmluZycgPyByYXcgOiBudWxsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVGhlIGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgZW52ZWxvcGUgY2FycmllcyBgd29ya2RpcmAgYmVzaWRlIGBjbWRgXG4gICAgICAgIC8vIChwbGFuIFx1MDBBNzgpIFx1MjAxNCB0aHJlYWQgaXQgdGhyb3VnaCBsaWtlIHRoZSBjb2RlLW1vZGUgZW52ZWxvcGUgYmVsb3cuXG4gICAgICAgIGNvbnN0IGNsYXNzaWMgPSBuYXJyb3dFeGVjQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICAgICAgY29tbWFuZCA9IGNsYXNzaWM/LmNtZCA/PyBudWxsO1xuICAgICAgICB3b3JrZGlyID0gY2xhc3NpYz8ud29ya2RpciA/PyBudWxsO1xuICAgICAgfVxuICAgICAgaWYgKGNvbW1hbmQgPT09IG51bGwgJiYgdG9vbF9uYW1lID09PSAnZXhlYycpIHtcbiAgICAgICAgLy8gQ29kZS1tb2RlIGBleGVjYCB3cmFwcyB0aGUgc2FtZSBjYWxsIGluIEpTIHNvdXJjZS4gQSBtYXRjaGVkIGNhbGxcbiAgICAgICAgLy8gd2hvc2UgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZCAodmFyaWFibGUvdGVtcGxhdGUtYnVpbHQgY29tbWFuZClcbiAgICAgICAgLy8gaXMgYSBkaXN0aW5jdCBvdXRjb21lIGZyb20gXCJub3QgYSBjb2RlLW1vZGUgZW52ZWxvcGUgYXQgYWxsXCI6IHdhcm4gc29cbiAgICAgICAgLy8gdGhlIGJsaW5kIHNwb3QgaXMgdmlzaWJsZSBpbnN0ZWFkIG9mIHNpbGVudGx5IGNvbmZsYXRlZCB3aXRoIG5vIG1hdGNoLlxuICAgICAgICBjb25zdCBjb2RlTW9kZSA9IG5hcnJvd0NvZGVNb2RlRXhlYyhpbnB1dC50b29sX2lucHV0KTtcbiAgICAgICAgaWYgKGNvZGVNb2RlLm1hdGNoZWQgJiYgY29kZU1vZGUuY21kID09PSBudWxsKSB7XG4gICAgICAgICAgY3R4LmxvZ2dlci53YXJuKFxuICAgICAgICAgICAgJ0NvZGV4IGNvZGUtbW9kZSBleGVjIGVudmVsb3BlIG1hdGNoZWQgYnV0IGl0cyBleGVjX2NvbW1hbmQgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZDsgbm8gc2hlbGwgdG91Y2gnLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0b29sSW5wdXRUeXBlOiB0eXBlb2YgaW5wdXQudG9vbF9pbnB1dCxcbiAgICAgICAgICAgICAgdG9vbElucHV0S2V5czpcbiAgICAgICAgICAgICAgICBpbnB1dC50b29sX2lucHV0ICE9PSBudWxsICYmIHR5cGVvZiBpbnB1dC50b29sX2lucHV0ID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX2lucHV0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGNvbW1hbmQgPSBjb2RlTW9kZS5jbWQ7XG4gICAgICAgIHdvcmtkaXIgPSBjb2RlTW9kZS53b3JrZGlyO1xuICAgICAgfVxuICAgICAgaWYgKCFjb21tYW5kKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICAvLyBQbGFuIFx1MDBBNzg6IGEgd29ya2RpciBwcmVzZW50IGFuZCBmcmVlIG9mIGAkYC9iYWNrdGljayBhYnNvbHV0aXplcyBhZ2FpbnN0XG4gICAgICAvLyB0aGUgZW52ZWxvcGUncyBvd24gYGlucHV0LmN3ZGAgXHUyMDE0IHRoZSBzaGVsbCB0b29sIHJlc29sdmVzIGEgcmVsYXRpdmVcbiAgICAgIC8vIHdvcmtkaXIgYWdhaW5zdCB0aGF0IHNhbWUgYmFzZSBcdTIwMTQgYW5kIGlzIHRoZSBzaW5nbGUgZnJhbWUgZm9yIHRoZSB3aG9sZVxuICAgICAgLy8gdG91Y2ggKHBhcnNlIGJhc2UsIGFic29sdXRpemF0aW9uLCBzY29wZSBjaGVjaywgYW5kIHRoZSB0b3VjaCByZWNvcmQnc1xuICAgICAgLy8gY3dkLCB3aGljaCB0aGUgZXhlY3V0b3JzIGRyaXZlIHRoZWlyIGdpdCBzcGFuIHJ1bnMgZnJvbSkuIEFcbiAgICAgIC8vIHRlbXBsYXRlLWxpdGVyYWwgd29ya2RpciAoY29udGFpbmluZyBgJGAvYmFja3RpY2spIGlzIHVucmVzb2x2YWJsZSBhbmRcbiAgICAgIC8vIGZhbGxzIGJhY2sgdG8gaG9vayBgY3dkYC5cbiAgICAgIGNvbnN0IGVmZmVjdGl2ZUN3ZCA9IHdvcmtkaXIgIT09IG51bGwgJiYgIS9bYCRdLy50ZXN0KHdvcmtkaXIpID8gcmVzb2x2ZVBhdGgoY3dkLCB3b3JrZGlyKSA6IGN3ZDtcblxuICAgICAgY29uc3QgbWF0Y2hlcyA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIHsgY3dkOiBlZmZlY3RpdmVDd2QgfSk7XG4gICAgICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoIG9mIG1hdGNoZXMpIHtcbiAgICAgICAgaWYgKG1hdGNoLnN0YXR1cyAhPT0gJ3Jlc29sdmVkJykgY29udGludWU7XG4gICAgICAgIGNvbnN0IHNwYW4gPSBtYXRjaC5zcGFuO1xuICAgICAgICBjb25zdCBhYnNQYXRoID0gYWJzcGF0aEFnYWluc3QoZWZmZWN0aXZlQ3dkLCBzcGFuLmFic29sdXRlUGF0aCk7XG4gICAgICAgIGNvbnN0IHNjb3BlID0gcmVzb2x2ZVRvdWNoU2NvcGUoZWZmZWN0aXZlQ3dkLCBhYnNQYXRoKTtcbiAgICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICAgIGxldCB0b3VjaElucHV0OiB7XG4gICAgICAgICAga2luZDogJ3JlYWQnIHwgJ3dyaXRlJztcbiAgICAgICAgICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgICAgICAgICBjd2Q6IHN0cmluZztcbiAgICAgICAgICBmaWxlUGF0aDogc3RyaW5nO1xuICAgICAgICAgIG9mZnNldD86IG51bWJlcjtcbiAgICAgICAgICBsaW1pdD86IG51bWJlcjtcbiAgICAgICAgICB3cml0dGVuPzogc3RyaW5nO1xuICAgICAgICB9O1xuICAgICAgICBpZiAobWF0Y2guaWRpb20gPT09ICdoZXJlZG9jLXdyaXRlJykge1xuICAgICAgICAgIC8vIGA+YCBvdmVyd3JpdGVzOiB3aG9sZS1maWxlIHNjb3BlIHNvIGRlbGV0ZWQgc3BhbnMgYmV5b25kIHRoZSBuZXdcbiAgICAgICAgICAvLyBFT0YgYXJlIHN1cmZhY2VkLiBgPj5gIGFwcGVuZHM6IG5hcnJvdyB0byB0aGUgYXBwZW5kZWQgbGluZXMuXG4gICAgICAgICAgY29uc3Qgd3JpdHRlbiA9IHNwYW4ucmVkaXJlY3QgPT09ICc+JyA/ICcnIDogKHNwYW4uYm9keSA/PyAnJyk7XG4gICAgICAgICAgdG91Y2hJbnB1dCA9IHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2Q6IGVmZmVjdGl2ZUN3ZCwgZmlsZVBhdGg6IGFic1BhdGgsIHdyaXR0ZW4gfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0b3VjaElucHV0ID0ge1xuICAgICAgICAgICAga2luZDogJ3JlYWQnLFxuICAgICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICAgICAgY3dkOiBlZmZlY3RpdmVDd2QsXG4gICAgICAgICAgICBmaWxlUGF0aDogYWJzUGF0aCxcbiAgICAgICAgICAgIG9mZnNldDogc3Bhbi5saW5lU3RhcnQsXG4gICAgICAgICAgICBsaW1pdDogc3Bhbi5saW5lRW5kIC0gc3Bhbi5saW5lU3RhcnQgKyAxXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2sodG91Y2hJbnB1dCBhcyBUb3VjaElucHV0LCBleGVjdXRvcnMsIG1lbW8pO1xuICAgICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgICAgfVxuICAgICAgaWYgKGJsb2Nrcy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICBjb25zdCBjb21iaW5lZCA9IGJsb2Nrcy5qb2luKCcnKTtcbiAgICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiBjb21iaW5lZCwgc3lzdGVtTWVzc2FnZTogY29tYmluZWQgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgY29tbWFuZCA9IG5hcnJvd0FwcGx5UGF0Y2hDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgIGlmIChjb21tYW5kID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgLy8gU3VwcHJlc3Mgb25seSBhICpjb25maXJtZWQqIG5vbi1zdWNjZXNzLiBBbiB1bnJlY29nbml6ZWQgcmVzcG9uc2Ugc2hhcGVcbiAgICAvLyBwcm9jZWVkcyAod2l0aCBhIHdhcm5pbmcpIHJhdGhlciB0aGFuIHJpc2sgc2tpcHBpbmcgYSByZWFsIGVkaXQncyB0b3VjaC5cbiAgICBjb25zdCBjbGFzc2lmaWNhdGlvbiA9IGNsYXNzaWZ5QXBwbHlQYXRjaFJlc3BvbnNlKGlucHV0LnRvb2xfcmVzcG9uc2UpO1xuICAgIGlmIChjbGFzc2lmaWNhdGlvbiA9PT0gJ2ZhaWx1cmUnKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmIChjbGFzc2lmaWNhdGlvbiA9PT0gJ3Vua25vd24nKSB7XG4gICAgICBjdHgubG9nZ2VyLndhcm4oJ0NvZGV4IGFwcGx5X3BhdGNoIHRvb2xfcmVzcG9uc2Ugc2hhcGUgdW5yZWNvZ25pemVkOyBydW5uaW5nIHRvdWNoIGRlZmVuc2l2ZWx5Jywge1xuICAgICAgICB0b29sUmVzcG9uc2VUeXBlOiB0eXBlb2YgaW5wdXQudG9vbF9yZXNwb25zZSxcbiAgICAgICAgdG9vbFJlc3BvbnNlS2V5czpcbiAgICAgICAgICBpbnB1dC50b29sX3Jlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiBpbnB1dC50b29sX3Jlc3BvbnNlID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX3Jlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIE9uZSBlbnZlbG9wZSBtYXkgdG91Y2ggc2V2ZXJhbCBmaWxlczsgZm9yY2Ugd2hvbGUtZmlsZSBhbmNob3JzIChDb2RleCBuZXZlclxuICAgIC8vIHJlY292ZXJzIGEgcG9zdC1lZGl0IHJhbmdlKSBhbmQgcnVuIHRoZSBzaGFyZWQgdG91Y2ggY29yZSBwZXIgdG91Y2hlZCBmaWxlLlxuICAgIC8vIFRoZSBzaGFyZWQgbWVtbyBkZWR1cGVzIHNwYW4gcmVuZGVycyBhY3Jvc3MgYW5jaG9ycyBhbmQgdGhlIHNlc3Npb24uXG4gICAgY29uc3QgYW5jaG9ycyA9IHBhcnNlQXBwbHlQYXRjaChjb21tYW5kLCBub1JhbmdlUmVjb3ZlcnkpO1xuICAgIGNvbnN0IGJsb2Nrczogc3RyaW5nW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IGFuY2hvciBvZiBhbmNob3JzKSB7XG4gICAgICBjb25zdCBhYnNQYXRoID0gYWJzcGF0aEFnYWluc3QoY3dkLCBhbmNob3IucGF0aCk7XG4gICAgICBjb25zdCBzY29wZSA9IHJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgYWJzUGF0aCk7XG4gICAgICBpZiAoIXNjb3BlKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1blRvdWNoSG9vayhcbiAgICAgICAgeyBraW5kOiAnd3JpdGUnLCBzZXNzaW9uSWQsIGN3ZCwgZmlsZVBhdGg6IGFic1BhdGgsIHdyaXR0ZW46ICcnIH0sXG4gICAgICAgIGV4ZWN1dG9ycyxcbiAgICAgICAgbWVtb1xuICAgICAgKTtcbiAgICAgIGlmIChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIGJsb2Nrcy5wdXNoKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2Nrcy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgcmV0dXJuIHBvc3RUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IGNvbWJpbmVkLCBzeXN0ZW1NZXNzYWdlOiBjb21iaW5lZCB9KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgcG9zdFRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ2FwcGx5X3BhdGNofGV4ZWNfY29tbWFuZHxleGVjfEJhc2gnLCB0aW1lb3V0OiAxMF8wMDAgfSwgY3JlYXRlSGFuZGxlcigpKTtcbiIsICJleHBvcnQgY29uc3QgUEFDS0FHRV9OQU1FID0gXCJAZ29vZGZvb3QvY29kZXgtaG9va3NcIjtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSA2MDBfMDAwO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfU1RBVFVTX01FU1NBR0UgPSB1bmRlZmluZWQ7XG5leHBvcnQgY29uc3QgREVGQVVMVF9FU0JVSUxEX0xPQURFUlMgPSB7XG4gICAgXCIubWRcIjogXCJ0ZXh0XCIsXG59O1xuZXhwb3J0IGNvbnN0IEhPT0tfRkFDVE9SWV9UT19FVkVOVCA9IHtcbiAgICBwcmVUb29sVXNlSG9vazogXCJQcmVUb29sVXNlXCIsXG4gICAgcG9zdFRvb2xVc2VIb29rOiBcIlBvc3RUb29sVXNlXCIsXG4gICAgcGVybWlzc2lvblJlcXVlc3RIb29rOiBcIlBlcm1pc3Npb25SZXF1ZXN0XCIsXG4gICAgdXNlclByb21wdFN1Ym1pdEhvb2s6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgIHNlc3Npb25TdGFydEhvb2s6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgc3ViYWdlbnRTdGFydEhvb2s6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIHN0b3BIb29rOiBcIlN0b3BcIixcbiAgICBzdWJhZ2VudFN0b3BIb29rOiBcIlN1YmFnZW50U3RvcFwiLFxuICAgIHByZUNvbXBhY3RIb29rOiBcIlByZUNvbXBhY3RcIixcbiAgICBwb3N0Q29tcGFjdEhvb2s6IFwiUG9zdENvbXBhY3RcIixcbn07XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfTUFUQ0hFUiA9IG5ldyBTZXQoW1xuICAgIFwiUHJlVG9vbFVzZVwiLFxuICAgIFwiUG9zdFRvb2xVc2VcIixcbiAgICBcIlBlcm1pc3Npb25SZXF1ZXN0XCIsXG4gICAgXCJTZXNzaW9uU3RhcnRcIixcbiAgICBcIlN1YmFnZW50U3RhcnRcIixcbiAgICBcIlN1YmFnZW50U3RvcFwiLFxuICAgIFwiUHJlQ29tcGFjdFwiLFxuICAgIFwiUG9zdENvbXBhY3RcIixcbl0pO1xuZXhwb3J0IGNvbnN0IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUID0gbmV3IFNldChbXCJTZXNzaW9uU3RhcnRcIiwgXCJVc2VyUHJvbXB0U3VibWl0XCIsIFwiU3ViYWdlbnRTdGFydFwiXSk7XG4iLCAiZnVuY3Rpb24gYXR0YWNoTWV0YWRhdGEoaG9va0V2ZW50TmFtZSwgY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgY29uc3QgaG9vayA9IGhhbmRsZXI7XG4gICAgaG9vay5ob29rRXZlbnROYW1lID0gaG9va0V2ZW50TmFtZTtcbiAgICBob29rLnRpbWVvdXQgPSBjb25maWcudGltZW91dDtcbiAgICBob29rLnN0YXR1c01lc3NhZ2UgPSBjb25maWcuc3RhdHVzTWVzc2FnZTtcbiAgICBpZiAoXCJtYXRjaGVyXCIgaW4gY29uZmlnICYmIHR5cGVvZiBjb25maWcubWF0Y2hlciA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBob29rLm1hdGNoZXIgPSBjb25maWcubWF0Y2hlcjtcbiAgICB9XG4gICAgcmV0dXJuIGhvb2s7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUHJlVG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQb3N0VG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlVzZXJQcm9tcHRTdWJtaXRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlNlc3Npb25TdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RhcnRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdG9wXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdWJhZ2VudFN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4iLCAiaW1wb3J0IHsgY2xvc2VTeW5jLCBleGlzdHNTeW5jLCBta2RpclN5bmMsIG9wZW5TeW5jLCB3cml0ZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbmNvbnN0IERFRkFVTFRfTE9HX0VOVl9WQVIgPSBcIkNPREVYX0hPT0tTX0xPR19GSUxFXCI7XG5leHBvcnQgY2xhc3MgTG9nZ2VyIHtcbiAgICBoYW5kbGVycyA9IG5ldyBNYXAoKTtcbiAgICBmaWxlSW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgICBsb2dGaWxlRmQgPSBudWxsO1xuICAgIGxvZ0ZpbGVQYXRoID0gbnVsbDtcbiAgICBjdXJyZW50SG9va1R5cGU7XG4gICAgY3VycmVudElucHV0O1xuICAgIGNvbnN0cnVjdG9yKGNvbmZpZyA9IHt9KSB7XG4gICAgICAgIHRoaXMubG9nRmlsZVBhdGggPSBjb25maWcubG9nRmlsZVBhdGggPz8gcHJvY2Vzcy5lbnZbY29uZmlnLmxvZ0VudlZhciA/PyBERUZBVUxUX0xPR19FTlZfVkFSXSA/PyBudWxsO1xuICAgIH1cbiAgICBzZXRDb250ZXh0KGhvb2tUeXBlLCBpbnB1dCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IGhvb2tUeXBlO1xuICAgICAgICB0aGlzLmN1cnJlbnRJbnB1dCA9IGlucHV0O1xuICAgIH1cbiAgICBjbGVhckNvbnRleHQoKSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLmN1cnJlbnRJbnB1dCA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgb24obGV2ZWwsIGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCkgPz8gbmV3IFNldCgpO1xuICAgICAgICBleGlzdGluZy5hZGQoaGFuZGxlcik7XG4gICAgICAgIHRoaXMuaGFuZGxlcnMuc2V0KGxldmVsLCBleGlzdGluZyk7XG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBleGlzdGluZy5kZWxldGUoaGFuZGxlcik7XG4gICAgICAgICAgICBpZiAoZXhpc3Rpbmcuc2l6ZSA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHRoaXMuaGFuZGxlcnMuZGVsZXRlKGxldmVsKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICB9XG4gICAgZGVidWcobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJkZWJ1Z1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgaW5mbyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImluZm9cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIHdhcm4obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJ3YXJuXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBlcnJvcihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBsb2dFcnJvcihlcnJvciwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBgJHttZXNzYWdlfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCwgY29udGV4dCk7XG4gICAgfVxuICAgIGNsb3NlKCkge1xuICAgICAgICBpZiAodGhpcy5sb2dGaWxlRmQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGNsb3NlU3luYyh0aGlzLmxvZ0ZpbGVGZCk7XG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZW1pdChsZXZlbCwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbGV2ZWwsXG4gICAgICAgICAgICBob29rVHlwZTogdGhpcy5jdXJyZW50SG9va1R5cGUsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgLi4uKHRoaXMuY3VycmVudElucHV0ICE9PSB1bmRlZmluZWQgPyB7IGlucHV0OiB0aGlzLmN1cnJlbnRJbnB1dCB9IDoge30pLFxuICAgICAgICAgICAgLi4uKGNvbnRleHQgIT09IHVuZGVmaW5lZCA/IHsgY29udGV4dCB9IDoge30pLFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLndyaXRlVG9GaWxlKGV2ZW50KTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5nZXQobGV2ZWwpPy5mb3JFYWNoKChoYW5kbGVyKSA9PiB7XG4gICAgICAgICAgICBoYW5kbGVyKGV2ZW50KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHdyaXRlVG9GaWxlKGV2ZW50KSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVQYXRoID09PSBudWxsKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCF0aGlzLmZpbGVJbml0aWFsaXplZCkge1xuICAgICAgICAgICAgdGhpcy5maWxlSW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgICAgICAgY29uc3QgbG9nRGlyID0gZGlybmFtZSh0aGlzLmxvZ0ZpbGVQYXRoKTtcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhsb2dEaXIpKSB7XG4gICAgICAgICAgICAgICAgbWtkaXJTeW5jKGxvZ0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG9wZW5TeW5jKHRoaXMubG9nRmlsZVBhdGgsIFwiYVwiKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5sb2dGaWxlRmQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHdyaXRlU3luYyh0aGlzLmxvZ0ZpbGVGZCwgYCR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcbmApO1xuICAgICAgICB9XG4gICAgfVxufVxuZXhwb3J0IGNvbnN0IGxvZ2dlciA9IG5ldyBMb2dnZXIoKTtcbiIsICJleHBvcnQgY29uc3QgRVhJVF9DT0RFUyA9IHtcbiAgICBTVUNDRVNTOiAwLFxuICAgIEVSUk9SOiAxLFxuICAgIEJMT0NLOiAyLFxufTtcbmV4cG9ydCBjbGFzcyBCbG9ja0Vycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAgIHJlYXNvbjtcbiAgICBjb25zdHJ1Y3RvcihyZWFzb24pIHtcbiAgICAgICAgc3VwZXIocmVhc29uKTtcbiAgICAgICAgdGhpcy5uYW1lID0gXCJCbG9ja0Vycm9yXCI7XG4gICAgICAgIHRoaXMucmVhc29uID0gcmVhc29uO1xuICAgIH1cbn1cbmZ1bmN0aW9uIG9taXRVbmRlZmluZWQodmFsdWUpIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKHZhbHVlKS5maWx0ZXIoKFssIGVudHJ5XSkgPT4gZW50cnkgIT09IHVuZGVmaW5lZCkpO1xufVxuZnVuY3Rpb24gYnVpbGRPdXRwdXQodHlwZSwgc3Rkb3V0LCBzdGRlcnIpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBfdHlwZTogdHlwZSxcbiAgICAgICAgc3Rkb3V0OiBvbWl0VW5kZWZpbmVkKHN0ZG91dCksXG4gICAgICAgIC4uLihzdGRlcnIgIT09IHVuZGVmaW5lZCA/IHsgc3RkZXJyIH0gOiB7fSksXG4gICAgfTtcbn1cbmV4cG9ydCBmdW5jdGlvbiByYXdPdXRwdXQoc3Rkb3V0LCBzdGRlcnIpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJSYXdcIiwgc3Rkb3V0LCBzdGRlcnIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaGFzU3BlY2lmaWMgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvblJlYXNvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMudXBkYXRlZElucHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUHJlVG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uLFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvblJlYXNvbixcbiAgICAgICAgICAgIHVwZGF0ZWRJbnB1dDogb3B0aW9ucy51cGRhdGVkSW5wdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VMZWdhY3lCbG9ja091dHB1dChvcHRpb25zKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaGFzU3BlY2lmaWMgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWQgfHwgb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlBvc3RUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHVwZGF0ZWRNQ1BUb29sT3V0cHV0OiBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0VG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RPdXRwdXQob3B0aW9ucykge1xuICAgIGNvbnN0IGRlY2lzaW9uID0gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgIGJlaGF2aW9yOiBvcHRpb25zLmJlaGF2aW9yLFxuICAgICAgICBtZXNzYWdlOiBvcHRpb25zLm1lc3NhZ2UsXG4gICAgICAgIGludGVycnVwdDogb3B0aW9ucy5pbnRlcnJ1cHQsXG4gICAgICAgIHVwZGF0ZWRJbnB1dDogb3B0aW9ucy51cGRhdGVkSW5wdXQsXG4gICAgICAgIHVwZGF0ZWRQZXJtaXNzaW9uczogb3B0aW9ucy51cGRhdGVkUGVybWlzc2lvbnMsXG4gICAgfSk7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0ge1xuICAgICAgICBob29rRXZlbnROYW1lOiBcIlBlcm1pc3Npb25SZXF1ZXN0XCIsXG4gICAgICAgIGRlY2lzaW9uLFxuICAgIH07XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUGVybWlzc2lvblJlcXVlc3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlVzZXJQcm9tcHRTdWJtaXRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlVzZXJQcm9tcHRTdWJtaXRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlNlc3Npb25TdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU2Vzc2lvblN0YXJ0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdWJhZ2VudFN0YXJ0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdWJhZ2VudFN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVDb21wYWN0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZUNvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RDb21wYWN0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbiIsICJpbXBvcnQgeyBFVkVOVFNfV0lUSF9URVhUX09VVFBVVCB9IGZyb20gXCIuL2NvbnN0YW50cy5qc1wiO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2VyLmpzXCI7XG5pbXBvcnQgeyBCbG9ja0Vycm9yLCBFWElUX0NPREVTLCBzZXNzaW9uU3RhcnRPdXRwdXQsIHN1YmFnZW50U3RhcnRPdXRwdXQsIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQsIH0gZnJvbSBcIi4vb3V0cHV0cy5qc1wiO1xuYXN5bmMgZnVuY3Rpb24gcmVhZFN0ZGluKCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGNvbnN0IGNodW5rcyA9IFtdO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLnNldEVuY29kaW5nKFwidXRmLThcIik7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJkYXRhXCIsIChjaHVuaykgPT4gY2h1bmtzLnB1c2goY2h1bmspKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVuZFwiLCAoKSA9PiByZXNvbHZlKGNodW5rcy5qb2luKFwiXCIpKSk7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJlcnJvclwiLCByZWplY3QpO1xuICAgIH0pO1xufVxuZnVuY3Rpb24gcGFyc2VTdGRpbklucHV0KHN0ZGluQ29udGVudCkge1xuICAgIHJldHVybiBKU09OLnBhcnNlKHN0ZGluQ29udGVudCk7XG59XG5mdW5jdGlvbiB3cml0ZVN0ZG91dChvdXRwdXQpIHtcbiAgICBwcm9jZXNzLnN0ZG91dC53cml0ZShKU09OLnN0cmluZ2lmeShvdXRwdXQuc3Rkb3V0KSk7XG59XG5mdW5jdGlvbiBub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0V2ZW50TmFtZSwgcmVzdWx0KSB7XG4gICAgaWYgKCFFVkVOVFNfV0lUSF9URVhUX09VVFBVVC5oYXMoaG9va0V2ZW50TmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2hvb2tFdmVudE5hbWV9IGhvb2tzIGNhbm5vdCByZXR1cm4gcGxhaW4gdGV4dGApO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTZXNzaW9uU3RhcnRcIikge1xuICAgICAgICByZXR1cm4gc2Vzc2lvblN0YXJ0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbiAgICB9XG4gICAgaWYgKGhvb2tFdmVudE5hbWUgPT09IFwiU3ViYWdlbnRTdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzdWJhZ2VudFN0YXJ0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIGNvbnZlcnRUb0hvb2tPdXRwdXQob3V0cHV0KSB7XG4gICAgcmV0dXJuIG91dHB1dC5zdGRlcnIgIT09IHVuZGVmaW5lZCA/IHsgc3Rkb3V0OiBvdXRwdXQuc3Rkb3V0LCBzdGRlcnI6IG91dHB1dC5zdGRlcnIgfSA6IHsgc3Rkb3V0OiBvdXRwdXQuc3Rkb3V0IH07XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXhlY3V0ZShob29rRm4pIHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBzdGRpbkNvbnRlbnQgPSBhd2FpdCByZWFkU3RkaW4oKTtcbiAgICAgICAgY29uc3QgaW5wdXQgPSBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KTtcbiAgICAgICAgbG9nZ2VyLnNldENvbnRleHQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIGlucHV0KTtcbiAgICAgICAgY29uc3QgY29udGV4dCA9IHsgbG9nZ2VyIH07XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhvb2tGbihpbnB1dCwgY29udGV4dCk7XG4gICAgICAgIGxldCBvdXRwdXQgPSB7IHN0ZG91dDoge30gfTtcbiAgICAgICAgaWYgKHR5cGVvZiByZXN1bHQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgIG91dHB1dCA9IGNvbnZlcnRUb0hvb2tPdXRwdXQobm9ybWFsaXplU3RyaW5nT3V0cHV0KGhvb2tGbi5ob29rRXZlbnROYW1lLCByZXN1bHQpKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChyZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICAgIHdyaXRlU3Rkb3V0KG91dHB1dCk7XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLlNVQ0NFU1MpO1xuICAgIH1cbiAgICBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQmxvY2tFcnJvcikge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3IucmVhc29ufVxcbmApO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuQkxPQ0spO1xuICAgICAgICB9XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5zdGFjayA/PyBlcnJvci5tZXNzYWdlfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7U3RyaW5nKGVycm9yKX1cXG5gKTtcbiAgICAgICAgfVxuICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5FUlJPUik7XG4gICAgfVxuICAgIGZpbmFsbHkge1xuICAgICAgICBsb2dnZXIuY2xlYXJDb250ZXh0KCk7XG4gICAgICAgIGxvZ2dlci5jbG9zZSgpO1xuICAgIH1cbn1cbiIsICIvKipcbiAqIFNoYXJlZCBoZWxwZXJzIHVzZWQgYnkgbXVsdGlwbGUgYWdlbnQtaG9va3MgZW50cnkgcG9pbnRzLlxuICpcbiAqIEV4dHJhY3RlZCBmcm9tIHByZS10b29sLXVzZS50cyBzbyB0aGF0IHRoZSB1cGNvbWluZyBTdG9wIGhvb2sgKGFuZCBhbnlcbiAqIGZ1dHVyZSBob29rcykgY2FuIGltcG9ydCBwYXRoIHV0aWxpdGllcywgcmFuZ2UgaGVscGVycywgYW5kIHRoZVxuICogc2FuaXRpemVTZXNzaW9uSWQvZm9ybWF0QW5jaG9yIGZ1bmN0aW9ucyB3aXRob3V0IGRlcGVuZGluZyBvbiB0aGVcbiAqIFByZVRvb2xVc2Utc3BlY2lmaWMgbW9kdWxlLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQYXRoIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbmZ1bmN0aW9uIGlzQWJzb2x1dGVQb3NpeChwOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHAuc3RhcnRzV2l0aCgnLycpIHx8IC9eW0EtWmEtel06XFwvLy50ZXN0KHApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWJzcGF0aEFnYWluc3QoYmFzZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHQgPSB0b1Bvc2l4KHRhcmdldCk7XG4gIGlmIChpc0Fic29sdXRlUG9zaXgodCkpIHJldHVybiB0O1xuICBjb25zdCBiID0gdG9Qb3NpeChiYXNlKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIGAke2J9LyR7dH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlcG9Sb290KGRpcjogc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWRpcikgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgZGlyLCAncmV2LXBhcnNlJywgJy0tc2hvdy10b3BsZXZlbCddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gb3V0LnRyaW0oKTtcbiAgICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdG9Qb3NpeCh0cmltbWVkKSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIHBhdGggaXMgZXhjbHVkZWQgYnkgZ2l0J3MgaWdub3JlIHJ1bGVzXG4gKiAoLmdpdGlnbm9yZSwgLmdpdC9pbmZvL2V4Y2x1ZGUsIGNvcmUuZXhjbHVkZXNGaWxlKS4gVXNlZCB0byBrZWVwIGlnbm9yZWRcbiAqIGZpbGVzIFx1MjAxNCBidWlsZCBvdXRwdXQsIGNhY2hlcywgbG9ncyBcdTIwMTQgb3V0IG9mIHRvdWNoIHRyYWNraW5nIGVudGlyZWx5LCBzb1xuICogdGhlIHRvdWNoIGhvb2sgbmV2ZXIgcmVwb3J0cyByZWFkcywgd3JpdGVzLCBvciB1bmNvdmVyZWQgd3JpdGVzIG9uIHRoZW0uXG4gKlxuICogYGdpdCBjaGVjay1pZ25vcmUgLXEgPHBhdGg+YCBleGl0cyAwIHdoZW4gdGhlIHBhdGggaXMgaWdub3JlZCwgMSB3aGVuIGl0IGlzXG4gKiBub3QsIGFuZCAxMjggb24gZXJyb3IuIGV4ZWNGaWxlU3luYyB0aHJvd3Mgb24gYW55IG5vbi16ZXJvIGV4aXQsIHNvIGEgY2xlYW5cbiAqIHJldHVybiBtZWFucyBcImlnbm9yZWRcIi4gQSBzdGF0dXMtMSB0aHJvdyBpcyB0aGUgZXhwZWN0ZWQgXCJub3QgaWdub3JlZFwiXG4gKiBzaWduYWw7IGFueSBvdGhlciBmYWlsdXJlIGlzIGFuIHVucmVsaWFibGUgYW5zd2VyLCBzbyB3ZSByZXBvcnQgYGZhbHNlYFxuICogKGRvIG5vdCBkcm9wIHRoZSB0b3VjaCkgcmF0aGVyIHRoYW4gc2lsZW50bHkgaGlkaW5nIGEgdHJhY2tlZCBmaWxlLlxuICovXG4vKipcbiAqIFRoZSBkZWZhdWx0IHNwYW4gcm9vdCBkaXJlY3RvcnksIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3QsIHVzZWQgd2hlbiBub1xuICogZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgZ2l0IGNvbmZpZyBvdmVycmlkZXMgdGhlIGxvY2F0aW9uLlxuICovXG5leHBvcnQgY29uc3QgU1BBTl9ST09UID0gJy5zcGFuJztcblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBzcGFuIHJvb3QgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHJlcG8sIG1pcnJvcmluZyB0aGUgUnVzdCBDTElcbiAqIHByZWNlZGVuY2UgKG1pbnVzIHRoZSAtLXNwYW4tZGlyIENMSSBmbGFnLCB3aGljaCBpcyBpbnZpc2libGUgdG8gZmlsZS13cml0ZVxuICogaG9va3MpOlxuICogICAxLiBHSVRfU1BBTl9ESVIgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAqICAgMi4gYGdpdCBjb25maWcgZ2l0LXNwYW4uZGlyYCBpbiB0aGUgcmVwb1xuICogICAzLiBEZWZhdWx0OiBcIi5zcGFuXCJcbiAqXG4gKiBUaGUgcmV0dXJuZWQgdmFsdWUgaXMgYSBQT1NJWC1zdHlsZSBwYXRoIHdpdGggbm8gdHJhaWxpbmcgc2xhc2guXG4gKiBGYWlsLXNhZmU6IGFueSByZXNvbHV0aW9uIGVycm9yIGZhbGxzIGJhY2sgdG8gXCIuc3BhblwiIHNvIHRoZSBob29rIG5ldmVyXG4gKiBjcmFzaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBlbnZEaXIgPSBwcm9jZXNzLmVudlsnR0lUX1NQQU5fRElSJ107XG4gIGlmIChlbnZEaXIgJiYgZW52RGlyLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZW52RGlyLnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NvbmZpZycsICdnaXQtc3Bhbi5kaXInXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkgcmV0dXJuIHRyaW1tZWQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyOyAvLyBjb25maWcga2V5IGFic2VudCBvciBnaXQgZXJyb3IgXHUyMDE0IGZhbGwgdGhyb3VnaCB0byBkZWZhdWx0XG4gIH1cbiAgcmV0dXJuIFNQQU5fUk9PVDtcbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aCBmYWxscyBpbnNpZGUgdGhlIGdpdmVuIHNwYW4gcm9vdFxuICogZGlyZWN0b3J5LiBBIHBhdGggaXMgaW5zaWRlIHdoZW4gaXQgZXF1YWxzIHRoZSBzcGFuIHJvb3QgZXhhY3RseSBvciBpc1xuICogbmVzdGVkIGJlbmVhdGggaXQgKGkuZS4gc3RhcnRzIHdpdGggXCI8c3BhblJvb3Q+L1wiKS4gVGhlIFwiL1wiIGJvdW5kYXJ5IHByZXZlbnRzXG4gKiBmYWxzZSBwb3NpdGl2ZXMgZm9yIHNpYmxpbmdzIGxpa2UgXCIuc3BhbnMveFwiIG9yIFwiLnNwYW4tbm90ZXMveFwiLlxuICpcbiAqIFBhc3MgdGhlIHJlc3VsdCBvZiBgcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KWAgYXMgYHNwYW5Sb290YC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGg6IHN0cmluZywgc3BhblJvb3Q6IHN0cmluZyA9IFNQQU5fUk9PVCk6IGJvb2xlYW4ge1xuICBjb25zdCByb290ID0gc3BhblJvb3QucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiByZXBvUmVsUGF0aCA9PT0gcm9vdCB8fCByZXBvUmVsUGF0aC5zdGFydHNXaXRoKGAke3Jvb3R9L2ApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNHaXRJZ25vcmVkKHJlcG9Sb290OiBzdHJpbmcsIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NoZWNrLWlnbm9yZScsICctcScsICctLScsIHJlcG9SZWxQYXRoXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ2lnbm9yZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290OiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJvb3QgPSB0b1Bvc2l4KHJlcG9Sb290KTtcbiAgY29uc3QgYWJzID0gdG9Qb3NpeChhYnNQYXRoKTtcbiAgY29uc3QgcHJlZml4ID0gcm9vdC5lbmRzV2l0aCgnLycpID8gcm9vdCA6IGAke3Jvb3R9L2A7XG4gIHJldHVybiBhYnMuc3RhcnRzV2l0aChwcmVmaXgpID8gYWJzLnNsaWNlKHByZWZpeC5sZW5ndGgpIDogYWJzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsaXplUGF0aChhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUoYWJzUGF0aCkpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGaWxlIGRvZXNuJ3QgZXhpc3QgeWV0IChlLmcuIFdyaXRlIHRvIGEgbmV3IGZpbGUpOiBjYW5vbmljYWxpemUgdGhlXG4gICAgLy8gZGlyZWN0b3J5IGFuZCByZWpvaW4gdGhlIGJhc2VuYW1lIHNvIHN5bWxpbmtzIGluIHRoZSBwYXJlbnQgYXJlIHJlc29sdmVkLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXIgPSB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSkpO1xuICAgICAgcmV0dXJuIGAke2Rpcn0vJHtub2RlUGF0aC5iYXNlbmFtZShhYnNQYXRoKX1gO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGFyZW50IGRvZXNuJ3QgZXhpc3QgZWl0aGVyOyBmYWxsIGJhY2sgdG8gdGhlIHVuLWNhbm9uaWNhbGl6ZWQgcGF0aC5cbiAgICAgIHJldHVybiBhYnNQYXRoO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlUGF0aCh0b29sSW5wdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBjd2Q6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBmcCA9IHRvb2xJbnB1dC5maWxlX3BhdGg7XG4gIGlmICh0eXBlb2YgZnAgIT09ICdzdHJpbmcnIHx8IGZwLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFicyA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgZnApO1xuICByZXR1cm4gY2Fub25pY2FsaXplUGF0aChhYnMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUgcmFuZ2UgdHlwZXMgYW5kIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIExpbmVSYW5nZSB7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmFuZ2VzSW50ZXJzZWN0KGE6IExpbmVSYW5nZSwgYjogTGluZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBhLnN0YXJ0IDw9IGIuZW5kICYmIGEuZW5kID49IGIuc3RhcnQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9yY2VsYWluIHJvdyBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBQb3JjZWxhaW5Sb3cge1xuICBuYW1lOiBzdHJpbmc7XG4gIHBhdGg6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzKSBjb250aW51ZTtcbiAgICBjb25zdCBbbmFtZSwgcGF0aCwgcmFuZ2VdID0gcGFydHM7XG4gICAgY29uc3QgZGFzaElkeCA9IHJhbmdlLmluZGV4T2YoJy0nKTtcbiAgICBpZiAoZGFzaElkeCA9PT0gLTEpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoMCwgZGFzaElkeCksIDEwKTtcbiAgICBjb25zdCBlbmQgPSBwYXJzZUludChyYW5nZS5zbGljZShkYXNoSWR4ICsgMSksIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLyoqXG4gKiBUaGUgZnVsbCBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBzdGF0dXMgdG9rZW4gdm9jYWJ1bGFyeSAodGhlXG4gKiBnaXQtc3BhbiBDTEkncyBwb3JjZWxhaW4gY29udHJhY3QpOiBgRlJFU0hgL2BNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYFxuICogYXJlIHBvc2l0aW9uYWwtb3ItY2xlYW4gYW5kIG5ldmVyIGRlYnQ7IGV2ZXJ5IG90aGVyIHRva2VuIGlzIHNlbWFudGljIGRyaWZ0XG4gKiBvciBhIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbiBhbmQgaXMgZGVidC4gU2VlIHtAbGluayBpc0RlYnR9IGZvciB0aGVcbiAqIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggb24gdGhhdCBzcGxpdC5cbiAqL1xuZXhwb3J0IGNvbnN0IFBPUkNFTEFJTl9TVEFUVVNFUyA9IFtcbiAgJ0ZSRVNIJyxcbiAgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJyxcbiAgJ01PVkVEJyxcbiAgJ0NIQU5HRUQnLFxuICAnREVMRVRFRCcsXG4gICdDT05GTElDVCcsXG4gICdTVUJNT0RVTEUnLFxuICAnTEZTX05PVF9GRVRDSEVEJyxcbiAgJ0xGU19OT1RfSU5TVEFMTEVEJyxcbiAgJ1BST01JU09SX01JU1NJTkcnLFxuICAnU1BBUlNFX0VYQ0xVREVEJyxcbiAgJ0ZJTFRFUl9GQUlMRUQnLFxuICAnSU9fRVJST1InXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBQb3JjZWxhaW5TdGF0dXMgPSAodHlwZW9mIFBPUkNFTEFJTl9TVEFUVVNFUylbbnVtYmVyXTtcblxuY29uc3QgUE9SQ0VMQUlOX1NUQVRVU19TRVQ6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFBPUkNFTEFJTl9TVEFUVVNFUyk7XG5cbmZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluU3RhdHVzKHJhdzogc3RyaW5nKTogUG9yY2VsYWluU3RhdHVzIHwgbnVsbCB7XG4gIHJldHVybiBQT1JDRUxBSU5fU1RBVFVTX1NFVC5oYXMocmF3KSA/IChyYXcgYXMgUG9yY2VsYWluU3RhdHVzKSA6IG51bGw7XG59XG5cbi8qKiBBIGBwYXJzZURyaWZ0UG9yY2VsYWluYCByb3c6IGEge0BsaW5rIFBvcmNlbGFpblJvd30gcGx1cyBpdHMgc3RhdHVzIHRva2VuLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEcmlmdFBvcmNlbGFpblJvdyBleHRlbmRzIFBvcmNlbGFpblJvdyB7XG4gIHN0YXR1czogUG9yY2VsYWluU3RhdHVzO1xufVxuXG4vKipcbiAqIFRoZSBkZWJ0IGludmFyaWFudCAoc3lzdGVtLXdpZGU7IGNvbnN1bWVkIGJ5IGJvdGggdGhlIGZ1dHVyZSB0b3VjaC1jb3JlIGFuZFxuICogYWR2aXNvci1jb3JlKTogb25seSBzZW1hbnRpYyBzdGF0dXNlcyBhcmUgZGVidC4gYENIQU5HRURgIGFuZCBgREVMRVRFRGAgYXJlXG4gKiBzZW1hbnRpYyBkcmlmdDsgdGhlIHJlbWFpbmluZyBub24tRlJFU0gvTU9WRUQvUkVTT0xWRURfUEVORElOR19DT01NSVQgdG9rZW5zXG4gKiBhcmUgdGVybWluYWwvZXJyb3IgY29uZGl0aW9ucyBhbmQgYXJlIHRyZWF0ZWQgYXMgZGVidCB0b28gKHRoZXkgYmxvY2sgb25cbiAqIHRoZWlyIG93biBtZXJpdHMgXHUyMDE0IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdCBhbGwpLiBgRlJFU0hgLFxuICogYE1PVkVEYCwgYW5kIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQ6IHBvc2l0aW9uYWwgZHJpZnQgdGhlXG4gKiBDTEkgY2FuIGhlYWwgKG9yIGFscmVhZHkgaGFzKSBpcyBpbnZpc2libGUsIGFuZCBhIHBlbmRpbmctY29tbWl0IHJlc29sdXRpb25cbiAqIGlzIG5vdCBvdXRzdGFuZGluZyBkZWJ0LlxuICpcbiAqIE5vdGU6IHRoZSBwb3JjZWxhaW4gdm9jYWJ1bGFyeSBkb2VzIG5vdCBjdXJyZW50bHkgZGlzdGluZ3Vpc2hcbiAqIGNvbnRlbnQtZXF1aXZhbGVudCBgQ0hBTkdFRGAgKGUuZy4gd2hpdGVzcGFjZS1vbmx5IGRyaWZ0IGAtLWZpeGAgY2FuIGhlYWwpXG4gKiBmcm9tIGdlbnVpbmVseSBzZW1hbnRpYyBgQ0hBTkdFRGAgXHUyMDE0IHRoYXQgY2xhc3NpZmljYXRpb24gaXMgbm90IHByZXNlbnQgaW5cbiAqIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIG91dHB1dCB0b2RheS4gVW50aWwgdGhlIENMSSBleHBvc2VzIGl0LFxuICogZXZlcnkgYENIQU5HRURgIHJvdyBpcyB0cmVhdGVkIGFzIGRlYnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0RlYnQoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdGUkVTSCc6XG4gICAgY2FzZSAnTU9WRUQnOlxuICAgIGNhc2UgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJzpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHRydWU7XG4gIH1cbn1cblxuLyoqXG4gKiBMb3dlcmNhc2UgaHVtYW4gbGFiZWwgZm9yIGEgcG9yY2VsYWluIHN0YXR1cyB0b2tlbiAoYExGU19OT1RfRkVUQ0hFRGAgXHUyMTkyXG4gKiBgbGZzIG5vdCBmZXRjaGVkYCkuIFRoZSBzaW5nbGUgbGFiZWwgbWFwcGluZyBmb3IgZXZlcnkgaHVtYW4tZm9ybWF0IGFuY2hvclxuICogc3VmZml4IFx1MjAxNCBib3RoIHRoZSB0b3VjaCBob29rJ3MgYmxvY2sgYW5kIHRoZSBhZHZpc29yJ3MgbWVzc2FnZXMgcmVuZGVyIHRocm91Z2hcbiAqIHRoaXMsIHNvIGEgc3RhdHVzIG5ldmVyIHJlYWRzIGRpZmZlcmVudGx5IGJldHdlZW4gdGhlIHR3by5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGh1bWFuU3RhdHVzTGFiZWwoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICByZXR1cm4gc3RhdHVzLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy9nLCAnICcpO1xufVxuXG4vKipcbiAqIFRoZSB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIHN0YXR1c2VzOiB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXRcbiAqIGFsbCwgc28gdGhlIHJvdyBpcyBub3Qgc3BhbiBkcmlmdCBhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi4gVGhlc2UgYXJlXG4gKiBgQ09ORkxJQ1RgICh1bnJlc29sdmVkIG1lcmdlKSwgYFNVQk1PRFVMRWAgKGFuY2hvciBpbnNpZGUgYSBzdWJtb2R1bGUpLFxuICogYExGU19OT1RfRkVUQ0hFRGAvYExGU19OT1RfSU5TVEFMTEVEYCAoR2l0IExGUyBjb250ZW50IHVuYXZhaWxhYmxlKSxcbiAqIGBQUk9NSVNPUl9NSVNTSU5HYCAocGFydGlhbC1jbG9uZSBvYmplY3Qgbm90IGZldGNoZWQpLCBgU1BBUlNFX0VYQ0xVREVEYFxuICogKHBhdGggb3V0c2lkZSB0aGUgc3BhcnNlLWNoZWNrb3V0IGNvbmUpLCBgRklMVEVSX0ZBSUxFRGAgKGEgY2xlYW4vc211ZGdlXG4gKiBmaWx0ZXIgZXJyb3JlZCksIGFuZCBgSU9fRVJST1JgICh0cmFuc2llbnQgcmVhZCBmYWlsdXJlKS5cbiAqXG4gKiBUaGVzZSBhcmUgYSBzdHJpY3Qgc3Vic2V0IG9mIHtAbGluayBpc0RlYnR9OiBldmVyeSBlbnZpcm9ubWVudGFsIHN0YXR1cyBpc1xuICogYWxzbyBkZWJ0IChpdCBibG9ja3Mgb24gaXRzIG93biBtZXJpdHMgd2hlbiBzdXJmYWNlZCBpbiBhIHN0YXR1cyByZXBvcnQpLCBidXRcbiAqIHRoZSBhZHZpc29yIG11c3QgdHJlYXQgdGhlbSBkaWZmZXJlbnRseSBmcm9tICpzZW1hbnRpYyogZHJpZnQgKGBDSEFOR0VEYCxcbiAqIGBERUxFVEVEYCkuIFNlbWFudGljIGRyaWZ0IGlzIGZpeGFibGUgYnkgZWRpdGluZyBhIHNwYW4sIHNvIHRoZSBhZHZpc29yIGZhaWxzXG4gKiBjbG9zZWQgb24gaXQ7IGFuIGVudmlyb25tZW50YWwgY29uZGl0aW9uIGlzIG5vdCBzb21ldGhpbmcgYSBzcGFuIGVkaXQgY2FuXG4gKiByZXNvbHZlLCBzbyB0aGUgYWR2aXNvciBmYWlscyBPUEVOIG9uIGl0IChhbGxvdywgYnV0IHN1cmZhY2UgdGhlIGNvbmRpdGlvbikgXHUyMDE0XG4gKiByZS1kZW55aW5nIGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGUgdXNlciBjYW5ub3QgY2xlYXIgZnJvbSBoZXJlIHdvdWxkXG4gKiBjb250cmFkaWN0IHRoZSBmYWlsLW9wZW4gY29udHJhY3QgdGhlIHJlc3Qgb2YgdGhlIGFkdmlzb3IgYWxyZWFkeSBob25vcnMgZm9yXG4gKiBDTEktYWJzZW50L3RpbWVvdXQvcGFyc2UtZmFpbHVyZSBjb25kaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNFbnZpcm9ubWVudGFsU3RhdHVzKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnQ09ORkxJQ1QnOlxuICAgIGNhc2UgJ1NVQk1PRFVMRSc6XG4gICAgY2FzZSAnTEZTX05PVF9GRVRDSEVEJzpcbiAgICBjYXNlICdMRlNfTk9UX0lOU1RBTExFRCc6XG4gICAgY2FzZSAnUFJPTUlTT1JfTUlTU0lORyc6XG4gICAgY2FzZSAnU1BBUlNFX0VYQ0xVREVEJzpcbiAgICBjYXNlICdGSUxURVJfRkFJTEVEJzpcbiAgICBjYXNlICdJT19FUlJPUic6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgZW1pdHMgYSBkaWZmZXJlbnQgc2hhcGUgdGhhblxuICogYGxpc3QgLS1wb3JjZWxhaW5gOiBhIGAjIHBvcmNlbGFpbiB2MmAgaGVhZGVyLCBgIyBmdXp6eSBOYCBjb21tZW50IGxpbmVzLFxuICogYW5kIG9uZSBgPHN0YXR1cz5cXHQ8c3JjPlxcdDxuYW1lPlxcdDxwYXRoPlxcdDxzdGFydD5cXHQ8ZW5kPmAgcm93IHBlciBkcmlmdGVkXG4gKiBhbmNob3IgKHdob2xlLWZpbGUgYW5jaG9ycyBjYXJyeSBgKHdob2xlKWAvYC1gIGluIHBsYWNlIG9mIHRoZSBsaW5lIGNvbHVtbnMpLlxuICogUm93cyB3aG9zZSBzdGF0dXMgdG9rZW4gaXMgbm90IGluIHtAbGluayBQT1JDRUxBSU5fU1RBVFVTRVN9IGFyZSBza2lwcGVkIFx1MjAxNFxuICogYW4gdW5yZWNvZ25pemVkIHRva2VuIGZyb20gYSBuZXdlciBDTEkgaXMgdHJlYXRlZCB0aGUgc2FtZSBhcyBhIG1hbGZvcm1lZFxuICogbGluZSByYXRoZXIgdGhhbiBndWVzc2VkIGF0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VEcmlmdFBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IERyaWZ0UG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBEcmlmdFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgNikgY29udGludWU7XG4gICAgY29uc3QgW3N0YXR1c0NvbCwgLCBuYW1lLCBwYXRoLCBzdGFydENvbCwgZW5kQ29sXSA9IHBhcnRzO1xuICAgIGNvbnN0IHN0YXR1cyA9IHBhcnNlUG9yY2VsYWluU3RhdHVzKHN0YXR1c0NvbCk7XG4gICAgaWYgKCFzdGF0dXMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gc3RhcnRDb2wgPT09ICcod2hvbGUpJyA/IDAgOiBwYXJzZUludChzdGFydENvbCwgMTApO1xuICAgIGNvbnN0IGVuZCA9IGVuZENvbCA9PT0gJy0nID8gMCA6IHBhcnNlSW50KGVuZENvbCwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kLCBzdGF0dXMgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBJRCBzYW5pdGl6YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEluamVjdGl2ZSB0cmFuc2Zvcm06IHBlcmNlbnQtZW5jb2RlIGJ5dGVzIG91dHNpZGUgW0EtWmEtejAtOS5fLV0gYXMgJUhIXG4gKiAodXBwZXJjYXNlIGhleCkuIFVzZWQgdG8gcHJvZHVjZSBzYWZlIGZpbGVuYW1lcyBmcm9tIGFyYml0cmFyeSBzZXNzaW9uIGlkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNlc3Npb25JZC5yZXBsYWNlKC9bXkEtWmEtejAtOS5fLV0vZywgKGNoKSA9PiB7XG4gICAgcmV0dXJuIGAlJHtjaC5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpLnBhZFN0YXJ0KDIsICcwJyl9YDtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGVyLXNlc3Npb24gYmFzZSBkaXJlY3Rvcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBCYXNlIGRpciBzaGFyZWQgYnkgYWxsIHBlci1zZXNzaW9uIHN0YXRlOiBjdXJyZW50bHkganVzdCB0aGUgdG91Y2gtaG9va1xuLy8gc2Vzc2lvbiBtZW1vIChzcGFuLXN1cmZhY2UudHMncyBNZW1vU3RvcmUpLiBFYWNoIHNlc3Npb24gZ2V0cyBvbmVcbi8vIHN1YmRpcmVjdG9yeSBrZXllZCBieSBpdHMgc2FuaXRpemVkIGlkLCBzbyBldmVyeSB3cml0ZXIvcmVhZGVyIGZvciBhIGdpdmVuXG4vLyBzZXNzaW9uIGFncmVlcyBvbiBpdHMgbG9jYXRpb24uXG5leHBvcnQgY29uc3QgU0VTU0lPTl9CQVNFX0RJUiA9IG5vZGVQYXRoLmpvaW4ob3MuaG9tZWRpcigpLCAnLmNhY2hlJywgJ2dpdC1zcGFuJywgJ3Nlc3Npb24nKTtcblxuLyoqIFRoZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gc2Vzc2lvbiBpZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRGlyKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkKSk7XG59XG5cbmNvbnN0IFRISVJUWV9EQVlTX01TID0gMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwO1xuXG4vKipcbiAqIE9wcG9ydHVuaXN0aWNhbGx5IHBydW5lIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yaWVzIHVuZGVyXG4gKiB7QGxpbmsgU0VTU0lPTl9CQVNFX0RJUn0gd2hvc2UgbXRpbWUgaXMgb2xkZXIgdGhhbiBgbWF4QWdlTXNgIChkZWZhdWx0IDMwXG4gKiBkYXlzKS4gQSBkaXJlY3RvcnkncyBtdGltZSBhZHZhbmNlcyB3aGVuZXZlciBhbiBlbnRyeSBpbnNpZGUgaXQgaXNcbiAqIGNyZWF0ZWQvcmVuYW1lZC9yZW1vdmVkLCBzbyBhbiBhY3RpdmUgc2Vzc2lvbiAobWVtbyB3cml0ZXMpIHN0YXlzIGZyZXNoO1xuICogb25seSBnZW51aW5lbHkgYWJhbmRvbmVkIHNlc3Npb25zIGFnZSBvdXQuXG4gKlxuICogQmVzdC1lZmZvcnQgYW5kIG5vbi10aHJvd2luZzogY2FsbGVkIG9wcG9ydHVuaXN0aWNhbGx5IGZyb20gaG9vayByZWFkL3dyaXRlXG4gKiBwYXRocywgbm90IGEgc2VwYXJhdGUgY3Jvbi1saWtlIG1lY2hhbmlzbSwgc28gYSBmYWlsdXJlIGhlcmUgbXVzdCBuZXZlclxuICogYmxvY2sgdGhlIGNhbGxlcidzIGFjdHVhbCB3b3JrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJ1bmVTdGFsZVNlc3Npb25zKG5vdzogbnVtYmVyID0gRGF0ZS5ub3coKSwgbWF4QWdlTXM6IG51bWJlciA9IFRISVJUWV9EQVlTX01TKTogdm9pZCB7XG4gIGxldCBlbnRyaWVzOiBmcy5EaXJlbnRbXTtcbiAgdHJ5IHtcbiAgICBlbnRyaWVzID0gZnMucmVhZGRpclN5bmMoU0VTU0lPTl9CQVNFX0RJUiwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm47IC8vIGJhc2UgZGlyIGFic2VudCBvciB1bnJlYWRhYmxlIFx1MjAxNCBub3RoaW5nIHRvIHBydW5lXG4gIH1cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgaWYgKCFlbnRyeS5pc0RpcmVjdG9yeSgpKSBjb250aW51ZTtcbiAgICBjb25zdCBkaXJQYXRoID0gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBlbnRyeS5uYW1lKTtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGZzLnN0YXRTeW5jKGRpclBhdGgpO1xuICAgICAgaWYgKG5vdyAtIHN0YXQubXRpbWVNcyA+IG1heEFnZU1zKSB7XG4gICAgICAgIGZzLnJtU3luYyhkaXJQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBWYW5pc2hlZCBiZXR3ZWVuIHJlYWRkaXIgYW5kIHN0YXQsIG9yIHJlbW92YWwgZmFpbGVkIFx1MjAxNCBza2lwIGl0LiBBXG4gICAgICAvLyBiZXN0LWVmZm9ydCBwcnVuZSBtdXN0IG5ldmVyIHRocm93IGludG8gdGhlIGNhbGxlcidzIGhvdCBwYXRoLlxuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGtpbmQgYW5kIGFuY2hvciBmb3JtYXR0aW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVG91Y2hLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJyB8ICd3aG9sZS1yZWFkJyB8ICd3aG9sZS13cml0ZScgfCAnY3JlYXRlJztcblxuLyoqXG4gKiBGb3JtYXQgYSBzcGFuIGFuY2hvciBzdHJpbmcuXG4gKlxuICogLSBgd2hvbGUtcmVhZGAsIGB3aG9sZS13cml0ZWAsIGFuZCBgY3JlYXRlYDogcmV0dXJucyBqdXN0IHRoZSBwYXRoXG4gKiAtIGByZWFkYCBhbmQgYHdyaXRlYDogcmV0dXJucyBgcGF0aCNMPHN0YXJ0Pi1MPGVuZD5gIChyZXF1aXJlcyByYW5nZSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEFuY2hvcihwYXRoOiBzdHJpbmcsIGtpbmQ6IFRvdWNoS2luZCwgcmFuZ2U/OiBMaW5lUmFuZ2UpOiBzdHJpbmcge1xuICBpZiAoKGtpbmQgPT09ICdyZWFkJyB8fCBraW5kID09PSAnd3JpdGUnKSAmJiByYW5nZSkge1xuICAgIHJldHVybiBgJHtwYXRofSNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQW5jaG9yIHNwZWMgdHlwZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5jaG9yU3BlYyB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogVG91Y2hLaW5kO1xuICByYW5nZT86IExpbmVSYW5nZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRdWV1ZSBkaXJlY3RvcnkgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgZ2l0IGNvbW1vbiBkaXJlY3RvcnkgZm9yIHRoZSBnaXZlbiByZXBvIHJvb3QuXG4gKiBUaGlzIGlzIHRoZSBzaGFyZWQgZGlyZWN0b3J5IChub3QgdGhlIHdvcmt0cmVlLXNwZWNpZmljIC5naXQpLCBzbyBxdWV1ZVxuICogcmVjb3JkcyBzdXJ2aXZlIHdvcmt0cmVlIGRlbGV0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdyZXYtcGFyc2UnLCAnLS1naXQtY29tbW9uLWRpciddLCB7XG4gICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgZW5jb2Rpbmc6ICd1dGY4J1xuICB9KTtcbiAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSk7XG4gIC8vIGdpdCByZXR1cm5zIGEgcmVsYXRpdmUgcGF0aCAoZS5nLiBcIi5naXRcIikgZm9yIHNpbXBsZSByZXBvcy4gUmVzb2x2ZSBpdFxuICAvLyBhZ2FpbnN0IHJlcG9Sb290IHNvIGNhbGxlcnMgbmV2ZXIgZGVwZW5kIG9uIHByb2Nlc3MuY3dkKCkuXG4gIGlmICghbm9kZVBhdGguaXNBYnNvbHV0ZSh0cmltbWVkKSkge1xuICAgIHJldHVybiB0b1Bvc2l4KG5vZGVQYXRoLnJlc29sdmUocmVwb1Jvb3QsIHRyaW1tZWQpKTtcbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSb290IG9mIHRoZSBnaXQtc3BhbiBxdWV1ZSBkaXJlY3RvcnkgdHJlZSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcXVldWVSb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihyZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290KSwgJ2dpdC1zcGFuJyk7XG59XG5cbi8qKlxuICogRGlyZWN0b3J5IGZvciB0aGUgYWR2aXNvcidzIHBlci1jaGFuZ2VzZXQgc3RhdGUgbWVtb3MgKGRpZ2VzdCBvZiBzb3J0ZWRcbiAqIGZpbmRpbmdzICsgdW5jb3ZlcmVkIHBhdGhzKSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyIHNvIGl0IGlzIHNoYXJlZFxuICogYWNyb3NzIHdvcmt0cmVlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmlzb3JNZW1vRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAnYWR2aXNvcicpO1xufVxuIiwgIi8qKlxuICogU3RhdGljIGNsYXNzaWZpY2F0aW9uIG9mIGEgQmFzaCB0b29sIGBjb21tYW5kYCBzdHJpbmcgaW50byB0aGUgZmlsZVxuICogcGF0aChzKSArIGxpbmUgcmFuZ2UocykgaXQgcmVhZHMgb3Igd3JpdGVzLCB3aGVyZSB0aGF0J3Mgc3RhdGljYWxseVxuICogZGV0ZXJtaW5hYmxlLiBCdWlsdCBmcm9tIGFuIGVtcGlyaWNhbCBwYXNzIG92ZXIgfjMxayByZWFsIENsYXVkZSBDb2RlXG4gKiBCYXNoIGludm9jYXRpb25zIChzZWUgYW5hbHl6ZS10cmFuc2NyaXB0cy5tdHMpIFx1MjAxNCB0aGUgaWRpb21zIGJlbG93IGFyZVxuICogZXhhY3RseSB0aGUgb25lcyB0aGF0IHR1cm5lZCBvdXQgdG8gYmUgY29tbW9uIEFORCByZWxpYWJsZSB0aGVyZS5cbiAqXG4gKiBEZWxpYmVyYXRlbHkgTk9UIGNvdmVyZWQgKHNlZSB0aGUgcmVzZWFyY2ggcmVwb3J0KTogYXdrIE5SLXRyaWNrcyAocmFyZSxcbiAqIHVuY29uc3RyYWluZWQgc3ludGF4KSwgZ3JlcCAtbi8tQS8tQi8tQyAodGhlIHdpbmRvdyBpcyBhbmNob3JlZCB0byBtYXRjaFxuICogcG9zaXRpb24sIHdoaWNoIGlzIGRhdGEtZGVwZW5kZW50LCBub3QgaW4gdGhlIGNvbW1hbmQgdGV4dCksIGVtYmVkZGVkXG4gKiBweXRob24zL25vZGUgaGVyZWRvYyBzY3JpcHRzIChhIGRpZmZlcmVudCBsYW5ndWFnZSdzIEFTVCwgbm90IGEgc2hlbGxcbiAqIGNvbmNlcm4pLCBzZWQgLWkgKG5vIGxpbmUtYWRkcmVzc2VkIHVzYWdlIG9ic2VydmVkIFx1MjAxNCBhbGwgcGF0dGVybi1vbmx5XG4gKiBzdWJzdGl0dXRpb25zIHdpdGggbm8gc3RhdGljIHJhbmdlKSwgcGxhaW4gYGVjaG9gL2BwcmludGZgIHJlZGlyZWN0cyAocmFyZVxuICogYW5kIHNlbWFudGljYWxseSBhbWJpZ3VvdXMgaW4gdGhlIGNvcnB1cykuXG4gKi9cbmltcG9ydCB7IGlzQWJzb2x1dGUsIHJlc29sdmUgYXMgcmVzb2x2ZVBhdGggfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgY291bnRGaWxlTGluZXMsIGNvdW50R2l0QmxvYkxpbmVzIH0gZnJvbSAnLi9jb21tYW5kLXJlc29sdmUuanMnO1xuaW1wb3J0IHtcbiAgYXJndk9mLFxuICB0eXBlIE9wZXJhdG9yLFxuICB0eXBlIFNpbXBsZUNvbW1hbmQsXG4gIHNwbGl0VG9wTGV2ZWwsXG4gIHNwbGl0V29yZHMsXG4gIHN0cmlwUmVkaXJlY3RzLFxuICBzdHJpcFdyYXBwZXJzXG59IGZyb20gJy4vc2hlbGwtc3BsaXQuanMnO1xuaW1wb3J0IHsgREVGQVVMVF9QQVRIX0FMTE9XTElTVCwgZXhwYW5kVmFyaWFibGVzIH0gZnJvbSAnLi92YXJpYWJsZS1leHBhbmQuanMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVkU3BhbiB7XG4gIGxpbmVTdGFydDogbnVtYmVyO1xuICBsaW5lRW5kOiBudW1iZXI7XG4gIGFic29sdXRlUGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogVGhlIGV4YWN0IGJvZHkgb2YgYSBgaGVyZWRvYy13cml0ZWAgc3BhbiBcdTIwMTQgdGhlIGNvbnRlbnQgdGhlIGhlcmVkb2Mgd3JpdGVzLlxuICAgKiBBYnNlbnQgKHVuZGVmaW5lZCkgZm9yIHJlYWQgaWRpb21zLlxuICAgKi9cbiAgYm9keT86IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBoZXJlZG9jIHJlZGlyZWN0IG9wZXJhdG9yLiBgPmAgbWVhbnMgdGhlIGZpbGUgd2FzIG92ZXJ3cml0dGVuXG4gICAqICh3aG9sZS1maWxlIHNjb3BlIFx1MjAxNCBhbnkgc3BhbiBiZXlvbmQgdGhlIG5ldyBFT0Ygd2FzIGRlbGV0ZWQgYW5kIG11c3RcbiAgICogc3VyZmFjZSk7IGA+PmAgbWVhbnMgdGhlIGJvZHkgd2FzIGFwcGVuZGVkIChuYXJyb3cgdG8gdGhlIGFwcGVuZCByYW5nZSkuXG4gICAqIEFic2VudCAodW5kZWZpbmVkKSBmb3IgcmVhZCBpZGlvbXMuXG4gICAqL1xuICByZWRpcmVjdD86ICc+JyB8ICc+Pic7XG59XG5cbmV4cG9ydCB0eXBlIElkaW9tID1cbiAgfCAnc2VkLW4tcmFuZ2UnXG4gIHwgJ2hlYWQtZmlsZSdcbiAgfCAndGFpbC1maWxlJ1xuICB8ICdjYXQtZmlsZSdcbiAgfCAnbmwtZmlsZSdcbiAgfCAnZ2l0LXNob3ctcmV2LXBhdGgnXG4gIHwgJ2dpdC1sb2ctTCdcbiAgfCAnaGVyZWRvYy13cml0ZSc7XG5cbmV4cG9ydCB0eXBlIFNwYW5NYXRjaCA9XG4gIHwgeyBzdGF0dXM6ICdyZXNvbHZlZCc7IGlkaW9tOiBJZGlvbTsgc3BhbjogUmVzb2x2ZWRTcGFuOyBub3RlPzogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VucmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IGZpbGVBcmc6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfTtcblxuLyoqIE9wdGlvbnMgZm9yIHRoZSBCYXNoIGNvbW1hbmQgcGFyc2VyIChwbGFuIFx1MDBBNzgpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQYXJzZU9wdGlvbnMge1xuICAvKiogVGhlIHdvcmtpbmcgZGlyZWN0b3J5IHRvIHJlc29sdmUgcmVsYXRpdmUgcGF0aHMgYWdhaW5zdDsgZGVmYXVsdHMgdG8gYHByb2Nlc3MuY3dkKClgLiAqL1xuICBjd2Q/OiBzdHJpbmc7XG4gIC8qKiBUaGUgaG9vayBwcm9jZXNzIGVudiwgZm9yIGFsbG93bGlzdGVkIHBhdGgtdmFyaWFibGUgcmVzb2x1dGlvbjsgZGVmYXVsdHMgdG8gYHByb2Nlc3MuZW52YC4gKi9cbiAgZW52PzogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPjtcbiAgLyoqIFZhcmlhYmxlIG5hbWVzIGFsbG93ZWQgdG8gcmVzb2x2ZSBmcm9tIGBlbnZgOyBkZWZhdWx0cyB0byBgREVGQVVMVF9QQVRIX0FMTE9XTElTVGAuICovXG4gIGFsbG93bGlzdD86IHJlYWRvbmx5IHN0cmluZ1tdO1xufVxuXG4vKiogV2hldGhlciBhIHNpbXBsZSBjb21tYW5kIGlzIGtub3duIHRvIGhhdmUgZXhlY3V0ZWQsIHByb3ZhYmx5IG5vdCwgb3IgdW5kZXRlcm1pbmFibGUgKHBsYW4gXHUwMEE3MikuICovXG5leHBvcnQgdHlwZSBFeGVjU3RhdHVzID0gJ3llcycgfCAnbm8nIHwgJ3Vua25vd24nO1xuXG4vKiogVGhlIGV4ZWN1dGlvbi1hd2FyZSB3YWxrJ3MgdmVyZGljdCBmb3Igb25lIHNpbXBsZSBjb21tYW5kIChwbGFuIFx1MDBBNzIpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdGFnZUV4ZWMge1xuICAvKiogYCd5ZXMnYCBcdTIwMTQgcHJvdmFibHkgZXhlY3V0ZWQ7IGAnbm8nYCBcdTIwMTQgcHJvdmFibHkgbm90OyBgJ3Vua25vd24nYCBcdTIwMTQgdW5kZXRlcm1pbmFibGUgKGZhaWwgY2xvc2VkKS4gKi9cbiAgZXhlYzogRXhlY1N0YXR1cztcbn1cblxuLyoqXG4gKiBDb21wdXRlLCBwZXIgc2ltcGxlIGNvbW1hbmQsIHdoZXRoZXIgaXQgZXhlY3V0ZWQgKHBsYW4gXHUwMEE3Mik6IHBpcGVsaW5lXG4gKiBncm91cGluZywgYCYmYC9gfHxgIGNoYWluIGdhdGluZyBhZ2FpbnN0IGtub3duIHN0YXR1c2VzLCBgIWAgZ3JvdXAtbGV2ZWxcbiAqIG5lZ2F0aW9uLCBpbi1zdHJpbmcgZXJyZXhpdC9waXBlZmFpbCBsaXZlbmVzcywgdGVybWluYXRvciBhbmQgbmV2ZXItcmV0dXJuXG4gKiBmaXJlcywgYW5kIHRoZSBkZWNpZGFibGUtY29udHJvbCBjb25zdHJ1Y3QgY2xhc3Nlcy4gSU8tZnJlZSBhbmQgZXhwb3J0ZWQgc29cbiAqIHRoZSB4dHJhY2Ugb3JhY2xlIGNhbiBjb21wYXJlIGV4ZWN1dGVkIHNldHMgYWdhaW5zdCByZWFsIGJhc2guXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhbmFseXplRXhlY3V0aW9uKHNpbXBsZUNvbW1hbmRzOiBTaW1wbGVDb21tYW5kW10sIF9vcHRzOiBQYXJzZU9wdGlvbnMgPSB7fSk6IFN0YWdlRXhlY1tdIHtcbiAgY29uc3Qgd2Fsa2VyID0gbmV3IEV4ZWN1dGlvbldhbGtlcigpO1xuICB3YWxrZXIud2Fsa0lucHV0KHNpbXBsZUNvbW1hbmRzKTtcbiAgcmV0dXJuIHdhbGtlci52ZXJkaWN0cy5tYXAoKGV4ZWMpID0+ICh7IGV4ZWMgfSkpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEV4ZWN1dGlvbiB3YWxrIChwbGFuIFx1MDBBNzIpOiBwZXItc2ltcGxlLWNvbW1hbmQgRXhlY1N0YXR1cywgZHJpdmVuIGJ5IHBpcGVsaW5lXG4vLyBncm91cGluZywgJiYvfHwgY2hhaW4gc3RhdHVzLCBpbi1zdHJpbmcgZXJyZXhpdC9waXBlZmFpbCBsaXZlbmVzcywgYW5kIHRoZVxuLy8gZGVjaWRhYmxlLWNvbnRyb2wgY29uc3RydWN0IGNsYXNzZXMuIFRoZSB3YWxrIGFsc28gZXhwYW5kcyBkZWNpZGFibGVcbi8vIGNvbnN0cnVjdCBpbnRlcmlvcnMgaW50byB0aGUgc3RhZ2Ugc3RyZWFtIHRoZSBlbWlzc2lvbiByZXBsYXkgY29uc3VtZXMuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudHlwZSBDaGFpblN0YXR1cyA9ICdzdWNjZXNzJyB8ICdmYWlsdXJlJyB8ICd1bmtub3duJztcblxudHlwZSBEZWFkS2luZCA9ICdleGl0JyB8ICduZXZlci1yZXR1cm4nIHwgJ2VycmV4aXQnIHwgJ21hbGZvcm1lZCc7XG5cbi8qKiBPbmUgc3RhZ2UgdGhlIHdhbGsgY29udHJpYnV0ZXMgdG8gdGhlIGVtaXNzaW9uIHJlcGxheS4gKi9cbmludGVyZmFjZSBFeHBhbmRlZFN0YWdlIHtcbiAgdGV4dDogc3RyaW5nO1xuICBwcmVjZWRlZEJ5OiBPcGVyYXRvcjtcbiAgZXhlYzogRXhlY1N0YXR1cztcbiAgLyoqIEEgbWVtYmVyIG9mIGEgbXVsdGktbWVtYmVyIHBpcGVsaW5lOiBzaWRlIGVmZmVjdHMgYW5kIGBleGl0YC9gZXhlY2AgdGVybWluYXRvcnMgYXJlIHN1cHByZXNzZWQuICovXG4gIGluUGlwZWxpbmU6IGJvb2xlYW47XG4gIC8qKiBUaGUgZW1pc3Npb24ncyBgY2RgIGZyYW1lOiArMSBpbnNpZGUgYSBzdWJzaGVsbCBpbnRlcmlvciwgZGlzY2FyZGVkIGF0IHRoZSBjbG9zZS4gKi9cbiAgZGlyRnJhbWU6IG51bWJlcjtcbiAgLyoqIFRoZSBzY3JpcHQgdmFyaWFibGUgdGFibGUgYXMgb2YgdGhpcyBzdGFnZSAocGxhbiBcdTAwQTc3KTogdGhlIGV4ZWN1dGVkIG5vbi1waXBlIGFzc2lnbm1lbnRzIHNlZW4gc28gZmFyLCBpbiBvcmRlci4gKi9cbiAgYXNzaWdubWVudHM6IFJlYWRvbmx5TWFwPHN0cmluZywgc3RyaW5nPjtcbn1cblxuaW50ZXJmYWNlIExvb3BGcmFtZSB7XG4gIG91dGNvbWU6ICdub25lJyB8ICdicmVhaycgfCAnY29udGludWUnIHwgJ2FtYmlndW91cycgfCAncmV0dXJuJztcbiAgLyoqIEEgZGVjaXNpdmUgb3duLWRlcHRoIGJyZWFrL2NvbnRpbnVlIGZpcmVkOiB0aGUgcmVzdCBvZiB0aGUgYm9keSBsaXN0IGlzIGRlYWQuICovXG4gIGJvZHlUZXJtaW5hdGVkOiBib29sZWFuO1xuICAvKiogQSBoaWRkZW4gYnJlYWsvY29udGludWUgbWFkZSB0aGUgZ3VhcmQgb253YXJkIHVudG91Y2hhYmxlLiAqL1xuICBhbWJpZ3VvdXNTdG9wOiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgV2Fsa09wdGlvbnMge1xuICAvKiogRXJyZXhpdCBsaXZlbmVzcyBpcyBzdXNwZW5kZWQgaW5zaWRlIGlmL3doaWxlL3VudGlsIGNvbmRpdGlvbnMgKGJhc2ggZXhlbXB0cyB0aGVtKS4gKi9cbiAgbGl2ZW5lc3M6IGJvb2xlYW47XG4gIC8qKiBUaGUgZXhwYW5kZWQgc3RhZ2Ugc3RyZWFtIGlzIGRpc2NhcmRlZCAoY29uZGl0aW9ucywgc2NhbnMsIGRlZi1ib2R5IHByb2JlcykuICovXG4gIGRpc2NhcmQ6IGJvb2xlYW47XG4gIC8qKiBTaWRlIGVmZmVjdHMgKGFzc2lnbm1lbnRzLCBzZXQgdG9nZ2xlcywgZGVmIHJlZ2lzdHJhdGlvbikgYXJlIGFwcGxpZWQuICovXG4gIHNpZGVFZmZlY3RzOiBib29sZWFuO1xuICAvKiogVGhpcyBsaXN0IGlzIHRoZSB0b3AtbGV2ZWwgaW5wdXQ6IHJlY29yZCB0aGUgcGVyLWlucHV0IHZlcmRpY3RzLiAqL1xuICBpbnB1dEZhY2luZzogYm9vbGVhbjtcbn1cblxuY29uc3QgQVNTSUdOTUVOVF9SRSA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKj0vO1xuXG4vKiogVGhlIGAtb2AvYCtvYCBvcHRpb24gbmFtZXMgb2YgYHNldGAgdGhhdCBiYXNoIGRvY3VtZW50cyAocGxhbiBcdTAwQTcyLCBrbm93biBzdGF0dXNlcykuICovXG5jb25zdCBTRVRfT1BUSU9OX05BTUVTID0gbmV3IFNldChbXG4gICdhbGxleHBvcnQnLFxuICAnYnJhY2VleHBhbmQnLFxuICAnZW1hY3MnLFxuICAnZXJyZXhpdCcsXG4gICdlcnJ0cmFjZScsXG4gICdmdW5jdHJhY2UnLFxuICAnaGFzaGFsbCcsXG4gICdoaXN0ZXhwYW5kJyxcbiAgJ2hpc3RvcnknLFxuICAnaWdub3JlZW9mJyxcbiAgJ2ludGVyYWN0aXZlLWNvbW1lbnRzJyxcbiAgJ2tleXdvcmQnLFxuICAnbGV4aWNhbC13b3JkLXByb2Nlc3NpbmcnLFxuICAnbW9uaXRvcicsXG4gICdub2Nsb2JiZXInLFxuICAnbm9leGVjJyxcbiAgJ25vZ2xvYicsXG4gICdub2xvZycsXG4gICdub3RpZnknLFxuICAnbm91bnNldCcsXG4gICdvbmVjbWQnLFxuICAncGh5c2ljYWwnLFxuICAncGlwZWZhaWwnLFxuICAncG9zaXgnLFxuICAncHJpdmlsZWdlZCcsXG4gICd2ZXJib3NlJyxcbiAgJ3ZpJyxcbiAgJ3h0cmFjZSdcbl0pO1xuXG4vKiogYmFzaCdzIGRvY3VtZW50ZWQgc2luZ2xlLWxldHRlciBgc2V0YCBmbGFncyAocGxhbiBcdTAwQTcyLCBrbm93biBzdGF0dXNlcykuICovXG5jb25zdCBTRVRfRkxBR19MRVRURVJTID0gJ2FCYkNlRWZoSGlrbW5vcFB0VHV2eCc7XG5cbi8qKiBCdWlsdGlucyB0aGUgd2FsaydzIHJlc3RyaWN0ZWQgYGJ1aWx0aW5gIHdyYXBwZXIgc3RyaXAgZm9yd2FyZHMgKHBsYW4gXHUwMEE3Miwgd3JhcHBlciBkaXNjaXBsaW5lKS4gKi9cbmNvbnN0IFJFQ09HTklaRURfQlVJTFRJTlMgPSBuZXcgU2V0KFtcbiAgJ3RydWUnLFxuICAnOicsXG4gICdmYWxzZScsXG4gICdzZXQnLFxuICAnZXhpdCcsXG4gICdleGVjJyxcbiAgJ3JldHVybicsXG4gICdicmVhaycsXG4gICdjb250aW51ZScsXG4gICdjZCcsXG4gICdleHBvcnQnLFxuICAnY29tbWFuZCcsXG4gICdidWlsdGluJ1xuXSk7XG5cbi8qKiBXYWxrLXNpZGUgd3JhcHBlciBzdHJpcDogYCFgLCBgY29tbWFuZGAsIGFuZCBgYnVpbHRpbmAgKHJlc3RyaWN0ZWQgdG8gdGhlIHJlY29nbml6ZWQgYnVpbHRpbnMpLiAqL1xuZnVuY3Rpb24gd2Fsa1N0cmlwKGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgYXJndi5sZW5ndGggJiYgYXJndltpXSA9PT0gJyEnKSBpKys7XG4gIHdoaWxlIChpIDwgYXJndi5sZW5ndGggJiYgYXJndltpXSA9PT0gJ2NvbW1hbmQnKSBpKys7XG4gIHdoaWxlIChpIDwgYXJndi5sZW5ndGggJiYgYXJndltpXSA9PT0gJ2J1aWx0aW4nICYmIGFyZ3ZbaSArIDFdICE9PSB1bmRlZmluZWQgJiYgUkVDT0dOSVpFRF9CVUlMVElOUy5oYXMoYXJndltpICsgMV0pKVxuICAgIGkrKztcbiAgcmV0dXJuIGFyZ3Yuc2xpY2UoaSk7XG59XG5cbi8qKiBFbWlzc2lvbi1zaWRlIHN0cmlwOiBsZWFkaW5nIGAhYCwgYGNvbW1hbmRgLCBgZXhlY2AsIGFuZCBgYnVpbHRpbmAgKHJlc3RyaWN0ZWQgdG8gdGhlIHJlY29nbml6ZWQgYnVpbHRpbnMpIGJlZm9yZSBtYXRjaGVyIGRpc3BhdGNoLiAqL1xuZnVuY3Rpb24gc3RyaXBGb3JFbWlzc2lvbihhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICchJykgaSsrO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIChhcmd2W2ldID09PSAnY29tbWFuZCcgfHwgYXJndltpXSA9PT0gJ2V4ZWMnKSkgaSsrO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICdidWlsdGluJyAmJiBhcmd2W2kgKyAxXSAhPT0gdW5kZWZpbmVkICYmIFJFQ09HTklaRURfQlVJTFRJTlMuaGFzKGFyZ3ZbaSArIDFdKSlcbiAgICBpKys7XG4gIHJldHVybiBhcmd2LnNsaWNlKGkpO1xufVxuXG4vKiogRXZlcnkgYXJnIGEgcmVjb2duaXplZCBgc2V0YCBmbGFnIGdyb3VwIChgLW9gIGNvbnN1bWVzIGl0cyBuYW1lKSwgYC0tYCwgb3IgYSBwb3NpdGlvbmFsIHdvcmQuICovXG5mdW5jdGlvbiBzZXRGbGFnc0tub3duKGFyZ3M6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhID09PSAnLS0nKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgfHwgYS5zdGFydHNXaXRoKCcrJykpIHtcbiAgICAgIGNvbnN0IGNoYXJzID0gYS5zbGljZSgxKTtcbiAgICAgIGlmIChjaGFycy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZTtcbiAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgY2hhcnMubGVuZ3RoOyBrKyspIHtcbiAgICAgICAgY29uc3QgYyA9IGNoYXJzW2tdO1xuICAgICAgICBpZiAoYyA9PT0gJ28nKSB7XG4gICAgICAgICAgY29uc3QgbmFtZSA9IGFyZ3NbaSArIDFdO1xuICAgICAgICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQgfHwgIVNFVF9PUFRJT05fTkFNRVMuaGFzKG5hbWUpKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgaSsrO1xuICAgICAgICB9IGVsc2UgaWYgKCFTRVRfRkxBR19MRVRURVJTLmluY2x1ZGVzKGMpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIC8vIEEgcG9zaXRpb25hbCBwYXJhbWV0ZXIgd29yZCBcdTIwMTQgYHNldCBmb29gIGV4aXRzIDAuXG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKlxuICogQSBxdW90ZS1hd2FyZSBzY2FuIG9mIGEgY29uc3RydWN0J3MgdGV4dCB0aGF0IHlpZWxkcyBpdHMgd29yZHMgKHF1b3RlXG4gKiBjb250ZW50IHN0cmlwcGVkKSB3aXRoIHRoZSBwYXJlbi9icmFjZS9jb25zdHJ1Y3QgZGVwdGhzIGF0IGVhY2ggd29yZCwgc29cbiAqIGB0aGVuYC9gZG9gL2Bkb25lYC9gZmlgL2Blc2FjYC9gaW5gIGtleXdvcmRzIGFyZSByZWNvZ25pemVkIG9ubHkgYXQgdGhlXG4gKiBsZXZlbCB0aGF0IG93bnMgdGhlbS5cbiAqL1xuaW50ZXJmYWNlIFdvcmRUb2sge1xuICB3b3JkOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xuICBkZXB0aDogbnVtYmVyO1xuICBicmFjZURlcHRoOiBudW1iZXI7XG4gIGNvbnN0cnVjdERlcHRoOiBudW1iZXI7XG4gIHF1b3RlZDogYm9vbGVhbjtcbn1cblxuY29uc3QgQ09OU1RSVUNUX09QRU5FUlMgPSBuZXcgU2V0KFsnaWYnLCAnd2hpbGUnLCAndW50aWwnLCAnZm9yJywgJ2Nhc2UnLCAnc2VsZWN0J10pO1xuY29uc3QgQ09OU1RSVUNUX0NMT1NFUlMgPSBuZXcgU2V0KFsnZmknLCAnZG9uZScsICdlc2FjJ10pO1xuXG5mdW5jdGlvbiBzY2FuVG9rZW5zKHRleHQ6IHN0cmluZyk6IFdvcmRUb2tbXSB7XG4gIGNvbnN0IHRva3M6IFdvcmRUb2tbXSA9IFtdO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSB0ZXh0Lmxlbmd0aDtcbiAgbGV0IHBhcmVuRGVwdGggPSAwO1xuICBsZXQgYnJhY2VEZXB0aCA9IDA7XG4gIGxldCBjb25zdHJ1Y3REZXB0aCA9IDA7XG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSB0ZXh0W2ldO1xuICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcoJyB8fCBjID09PSAneycpIHtcbiAgICAgIGlmIChjID09PSAnKCcpIHBhcmVuRGVwdGgrKztcbiAgICAgIGVsc2UgYnJhY2VEZXB0aCsrO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScgfHwgYyA9PT0gJ30nKSB7XG4gICAgICBpZiAoYyA9PT0gJyknKSBwYXJlbkRlcHRoID0gTWF0aC5tYXgoMCwgcGFyZW5EZXB0aCAtIDEpO1xuICAgICAgZWxzZSBicmFjZURlcHRoID0gTWF0aC5tYXgoMCwgYnJhY2VEZXB0aCAtIDEpO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgnOyZ8PD4nLmluY2x1ZGVzKGMpKSB7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3Qgc3RhcnQgPSBpO1xuICAgIGNvbnN0IHcgPSByZWFkV29yZEF0KHRleHQsIGkpO1xuICAgIGlmICh3ID09PSBudWxsKSB7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaSA9IHcuZW5kO1xuICAgIHRva3MucHVzaCh7IHdvcmQ6IHcud29yZCwgc3RhcnQsIGVuZDogdy5lbmQsIGRlcHRoOiBwYXJlbkRlcHRoLCBicmFjZURlcHRoLCBjb25zdHJ1Y3REZXB0aCwgcXVvdGVkOiB3LnF1b3RlZCB9KTtcbiAgICBpZiAocGFyZW5EZXB0aCA9PT0gMCAmJiBicmFjZURlcHRoID09PSAwICYmICF3LnF1b3RlZCkge1xuICAgICAgaWYgKENPTlNUUlVDVF9PUEVORVJTLmhhcyh3LndvcmQpKSBjb25zdHJ1Y3REZXB0aCsrO1xuICAgICAgZWxzZSBpZiAoQ09OU1RSVUNUX0NMT1NFUlMuaGFzKHcud29yZCkpIGNvbnN0cnVjdERlcHRoID0gTWF0aC5tYXgoMCwgY29uc3RydWN0RGVwdGggLSAxKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRva3M7XG59XG5cbi8qKiBSZWFkIG9uZSB3b3JkIGF0IGBpYCAocXVvdGUtYXdhcmUsIHNlcGFyYXRvci10ZXJtaW5hdGVkKTsgcmV0dXJucyBpdHMgY29udGVudCBhbmQgc3Bhbi4gKi9cbmZ1bmN0aW9uIHJlYWRXb3JkQXQodGV4dDogc3RyaW5nLCBpOiBudW1iZXIpOiB7IHdvcmQ6IHN0cmluZzsgZW5kOiBudW1iZXI7IHF1b3RlZDogYm9vbGVhbiB9IHwgbnVsbCB7XG4gIGlmIChpID49IHRleHQubGVuZ3RoKSByZXR1cm4gbnVsbDtcbiAgbGV0IHdvcmQgPSAnJztcbiAgbGV0IHF1b3RlZCA9IGZhbHNlO1xuICBjb25zdCBuID0gdGV4dC5sZW5ndGg7XG4gIHdoaWxlIChpIDwgbiAmJiAhL1xccy8udGVzdCh0ZXh0W2ldKSAmJiAhJygpe307Jnw8PicuaW5jbHVkZXModGV4dFtpXSkpIHtcbiAgICBjb25zdCBjaCA9IHRleHRbaV07XG4gICAgaWYgKGNoID09PSBcIidcIikge1xuICAgICAgcXVvdGVkID0gdHJ1ZTtcbiAgICAgIGkrKztcbiAgICAgIHdoaWxlIChpIDwgbiAmJiB0ZXh0W2ldICE9PSBcIidcIikge1xuICAgICAgICB3b3JkICs9IHRleHRbaV07XG4gICAgICAgIGkrKztcbiAgICAgIH1cbiAgICAgIGlmIChpIDwgbikgaSsrO1xuICAgIH0gZWxzZSBpZiAoY2ggPT09ICdcIicpIHtcbiAgICAgIHF1b3RlZCA9IHRydWU7XG4gICAgICBpKys7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgdGV4dFtpXSAhPT0gJ1wiJykge1xuICAgICAgICBpZiAodGV4dFtpXSA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHRleHRbaSArIDFdKSkge1xuICAgICAgICAgIHdvcmQgKz0gdGV4dFtpICsgMV07XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHdvcmQgKz0gdGV4dFtpXTtcbiAgICAgICAgICBpKys7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChpIDwgbikgaSsrO1xuICAgIH0gZWxzZSBpZiAoY2ggPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIHdvcmQgKz0gdGV4dFtpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgfSBlbHNlIHtcbiAgICAgIHdvcmQgKz0gY2g7XG4gICAgICBpKys7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IHdvcmQsIGVuZDogaSwgcXVvdGVkIH07XG59XG5cbi8qKiBUaGUgaW50ZXJpb3IgYmV0d2VlbiB0aGUgZmlyc3QgYG9wZW5gIGNoYXIgYW5kIGl0cyBtYXRjaGluZyBgY2xvc2VgLCBxdW90ZXMgYXdhcmUuICovXG5mdW5jdGlvbiBleHRyYWN0R3JvdXBCb2R5KHRleHQ6IHN0cmluZywgb3BlbjogJ3snIHwgJygnLCBjbG9zZTogJ30nIHwgJyknKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHN0YXJ0ID0gdGV4dC5pbmRleE9mKG9wZW4pO1xuICBpZiAoc3RhcnQgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IGluUXVvdGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBwID0gc3RhcnQ7IHAgPCB0ZXh0Lmxlbmd0aDsgcCsrKSB7XG4gICAgY29uc3QgY2ggPSB0ZXh0W3BdO1xuICAgIGlmIChpblF1b3RlICE9PSBudWxsKSB7XG4gICAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpblF1b3RlID09PSAnXCInICYmIHAgKyAxIDwgdGV4dC5sZW5ndGggJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyh0ZXh0W3AgKyAxXSkpIHArKztcbiAgICAgIGVsc2UgaWYgKGNoID09PSBpblF1b3RlKSBpblF1b3RlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09IFwiJ1wiIHx8IGNoID09PSAnXCInKSB7XG4gICAgICBpblF1b3RlID0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXFxcXCcpIHtcbiAgICAgIHArKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09IG9wZW4pIGRlcHRoKys7XG4gICAgZWxzZSBpZiAoY2ggPT09IGNsb3NlKSB7XG4gICAgICBkZXB0aC0tO1xuICAgICAgaWYgKGRlcHRoID09PSAwKSByZXR1cm4gdGV4dC5zbGljZShzdGFydCArIDEsIHApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxudHlwZSBDb25zdHJ1Y3RLaW5kID0gJ2lmJyB8ICd3aGlsZScgfCAndW50aWwnIHwgJ2ZvcicgfCAnY2FzZScgfCAnc2VsZWN0JyB8ICdicmFjZScgfCAnc3Vic2hlbGwnIHwgJ2RlZicgfCAncGxhaW4nO1xuXG5mdW5jdGlvbiBjbGFzc2lmeVN0YWdlKHRleHQ6IHN0cmluZyk6IENvbnN0cnVjdEtpbmQge1xuICBjb25zdCB0ID0gdGV4dC50cmltU3RhcnQoKTtcbiAgaWYgKHQuc3RhcnRzV2l0aCgneycpKSByZXR1cm4gJ2JyYWNlJztcbiAgaWYgKHQuc3RhcnRzV2l0aCgnKCcpKSByZXR1cm4gJ3N1YnNoZWxsJztcbiAgY29uc3Qga3cgPSB0Lm1hdGNoKC9eKGlmfHdoaWxlfHVudGlsfGZvcnxjYXNlfHNlbGVjdClcXGIvKTtcbiAgaWYgKGt3ICE9PSBudWxsKSByZXR1cm4ga3dbMV0gYXMgQ29uc3RydWN0S2luZDtcbiAgaWYgKC9eKD86ZnVuY3Rpb25cXHMrKT9bQS1aYS16X11bQS1aYS16MC05X10qXFwoXFwpXFxzKlxcey8udGVzdCh0KSkgcmV0dXJuICdkZWYnO1xuICByZXR1cm4gJ3BsYWluJztcbn1cblxuLyoqIEEgZnVuY3Rpb24gZGVmaW5pdGlvbidzIG5hbWUgYW5kIGJvZHkgdGV4dCAoYnJhY2UtZ3JvdXAgaW50ZXJpb3IpLiAqL1xuZnVuY3Rpb24gcGFyc2VEZWYodGV4dDogc3RyaW5nKTogeyBuYW1lOiBzdHJpbmc7IGJvZHk6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IG0gPSB0ZXh0Lm1hdGNoKC9eKD86ZnVuY3Rpb25cXHMrKT8oW0EtWmEtel9dW0EtWmEtejAtOV9dKilcXHMqKD86XFwoXFwpKT9cXHMqXFx7Lyk7XG4gIGlmIChtID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYm9keSA9IGV4dHJhY3RHcm91cEJvZHkodGV4dCwgJ3snLCAnfScpO1xuICBpZiAoYm9keSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IG5hbWU6IG1bMV0sIGJvZHkgfTtcbn1cblxuaW50ZXJmYWNlIFBhcnNlZElmIHtcbiAgY29uZGl0aW9uOiBzdHJpbmc7XG4gIHRoZW5Cb2R5OiBzdHJpbmc7XG4gIGVsaWZzOiB7IGNvbmRpdGlvbjogc3RyaW5nOyBib2R5OiBzdHJpbmcgfVtdO1xuICBlbHNlQm9keTogc3RyaW5nIHwgbnVsbDtcbn1cblxuZnVuY3Rpb24gcGFyc2VJZih0ZXh0OiBzdHJpbmcpOiBQYXJzZWRJZiB8IG51bGwge1xuICBjb25zdCB0b2tzID0gc2NhblRva2Vucyh0ZXh0KTtcbiAgaWYgKHRva3MubGVuZ3RoID09PSAwIHx8IHRva3NbMF0ud29yZCAhPT0gJ2lmJykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRoZW5JZHggPSB0b2tzLmZpbmRJbmRleCgodCkgPT4gdC53b3JkID09PSAndGhlbicgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gIGlmICh0aGVuSWR4ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRoZW5Ub2sgPSB0b2tzW3RoZW5JZHhdO1xuICBjb25zdCBjb25kaXRpb24gPSB0ZXh0LnNsaWNlKHRva3NbMF0uZW5kLCB0aGVuVG9rLnN0YXJ0KTtcblxuICBjb25zdCBib3VuZGFyaWVzOiB7IHdvcmQ6IHN0cmluZzsgdG9rOiBXb3JkVG9rIH1bXSA9IFtdO1xuICBmb3IgKGxldCBpZHggPSB0aGVuSWR4ICsgMTsgaWR4IDwgdG9rcy5sZW5ndGg7IGlkeCsrKSB7XG4gICAgY29uc3QgdCA9IHRva3NbaWR4XTtcbiAgICBpZiAodC5jb25zdHJ1Y3REZXB0aCAhPT0gMSB8fCAodC53b3JkICE9PSAnZWxpZicgJiYgdC53b3JkICE9PSAnZWxzZScgJiYgdC53b3JkICE9PSAnZmknKSkgY29udGludWU7XG4gICAgaWYgKHQud29yZCA9PT0gJ2VsaWYnKSB7XG4gICAgICBjb25zdCBlVGhlbklkeCA9IHRva3MuZmluZEluZGV4KCh0dCwgaWkpID0+IGlpID4gaWR4ICYmIHR0LndvcmQgPT09ICd0aGVuJyAmJiB0dC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gICAgICBpZiAoZVRoZW5JZHggPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICAgIGJvdW5kYXJpZXMucHVzaCh7IHdvcmQ6ICdlbGlmJywgdG9rOiB0IH0sIHsgd29yZDogJ3RoZW4nLCB0b2s6IHRva3NbZVRoZW5JZHhdIH0pO1xuICAgICAgaWR4ID0gZVRoZW5JZHg7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgYm91bmRhcmllcy5wdXNoKHsgd29yZDogdC53b3JkLCB0b2s6IHQgfSk7XG4gICAgaWYgKHQud29yZCA9PT0gJ2Vsc2UnKSB7XG4gICAgICBjb25zdCBmaUlkeCA9IHRva3MuZmluZEluZGV4KCh0dCwgaWkpID0+IGlpID4gaWR4ICYmIHR0LndvcmQgPT09ICdmaScgJiYgdHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICAgICAgaWYgKGZpSWR4ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBib3VuZGFyaWVzLnB1c2goeyB3b3JkOiAnZmknLCB0b2s6IHRva3NbZmlJZHhdIH0pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGJyZWFrO1xuICB9XG4gIGlmIChib3VuZGFyaWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgdGhlbkJvZHkgPSB0ZXh0LnNsaWNlKHRoZW5Ub2suZW5kLCBib3VuZGFyaWVzWzBdLnRvay5zdGFydCk7XG4gIGNvbnN0IGVsaWZzOiB7IGNvbmRpdGlvbjogc3RyaW5nOyBib2R5OiBzdHJpbmcgfVtdID0gW107XG4gIGxldCBlbHNlQm9keTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGIgPSAwOyBiIDwgYm91bmRhcmllcy5sZW5ndGg7IGIrKykge1xuICAgIGNvbnN0IHsgd29yZCwgdG9rIH0gPSBib3VuZGFyaWVzW2JdO1xuICAgIGlmICh3b3JkID09PSAnZWxpZicpIHtcbiAgICAgIGNvbnN0IGVUaGVuID0gYm91bmRhcmllc1tiICsgMV07XG4gICAgICBpZiAoZVRoZW4gPT09IHVuZGVmaW5lZCB8fCBlVGhlbi53b3JkICE9PSAndGhlbicpIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgbmV4dFN0YXJ0ID0gYm91bmRhcmllc1tiICsgMl0/LnRvay5zdGFydCA/PyB0ZXh0Lmxlbmd0aDtcbiAgICAgIGVsaWZzLnB1c2goeyBjb25kaXRpb246IHRleHQuc2xpY2UodG9rLmVuZCwgZVRoZW4udG9rLnN0YXJ0KSwgYm9keTogdGV4dC5zbGljZShlVGhlbi50b2suZW5kLCBuZXh0U3RhcnQpIH0pO1xuICAgICAgYisrO1xuICAgIH0gZWxzZSBpZiAod29yZCA9PT0gJ2Vsc2UnKSB7XG4gICAgICBjb25zdCBmaSA9IGJvdW5kYXJpZXNbYiArIDFdO1xuICAgICAgaWYgKGZpID09PSB1bmRlZmluZWQgfHwgZmkud29yZCAhPT0gJ2ZpJykgcmV0dXJuIG51bGw7XG4gICAgICBlbHNlQm9keSA9IHRleHQuc2xpY2UodG9rLmVuZCwgZmkudG9rLnN0YXJ0KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4geyBjb25kaXRpb24sIHRoZW5Cb2R5LCBlbGlmcywgZWxzZUJvZHkgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VMb29wKHRleHQ6IHN0cmluZywga2V5d29yZDogJ3doaWxlJyB8ICd1bnRpbCcpOiB7IGNvbmRpdGlvbjogc3RyaW5nOyBib2R5OiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCB0b2tzID0gc2NhblRva2Vucyh0ZXh0KTtcbiAgaWYgKHRva3MubGVuZ3RoID09PSAwIHx8IHRva3NbMF0ud29yZCAhPT0ga2V5d29yZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRvVG9rID0gdG9rcy5maW5kKCh0KSA9PiB0LndvcmQgPT09ICdkbycgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gIGlmIChkb1RvayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZG9uZVRvayA9IHRva3MuZmluZCgodCkgPT4gdC5zdGFydCA+IGRvVG9rLmVuZCAmJiB0LndvcmQgPT09ICdkb25lJyAmJiB0LmNvbnN0cnVjdERlcHRoID09PSAxKTtcbiAgaWYgKGRvbmVUb2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IGNvbmRpdGlvbjogdGV4dC5zbGljZSh0b2tzWzBdLmVuZCwgZG9Ub2suc3RhcnQpLCBib2R5OiB0ZXh0LnNsaWNlKGRvVG9rLmVuZCwgZG9uZVRvay5zdGFydCkgfTtcbn1cblxuaW50ZXJmYWNlIFBhcnNlZEZvciB7XG4gIGxpc3Q6IHN0cmluZ1tdIHwgbnVsbDtcbiAgYm9keTogc3RyaW5nO1xuICB3aG9sZUludGVyaW9yOiBzdHJpbmc7XG59XG5cbmZ1bmN0aW9uIHBhcnNlRm9yKHRleHQ6IHN0cmluZyk6IFBhcnNlZEZvciB8IG51bGwge1xuICBjb25zdCB0b2tzID0gc2NhblRva2Vucyh0ZXh0KTtcbiAgaWYgKHRva3MubGVuZ3RoID09PSAwIHx8IHRva3NbMF0ud29yZCAhPT0gJ2ZvcicpIHJldHVybiBudWxsO1xuICBjb25zdCBuYW1lVG9rID0gdG9rc1sxXTtcbiAgaWYgKG5hbWVUb2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRvVG9rID0gdG9rcy5maW5kKCh0KSA9PiB0LndvcmQgPT09ICdkbycgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMSAmJiB0LnN0YXJ0ID4gbmFtZVRvay5lbmQpO1xuICBpZiAoZG9Ub2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRvbmVUb2sgPSB0b2tzLmZpbmQoKHQpID0+IHQuc3RhcnQgPiBkb1Rvay5lbmQgJiYgdC53b3JkID09PSAnZG9uZScgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gIGlmIChkb25lVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICBjb25zdCBpblRvayA9IHRva3MuZmluZChcbiAgICAodCkgPT4gdC5zdGFydCA+IG5hbWVUb2suZW5kICYmIHQuc3RhcnQgPCBkb1Rvay5zdGFydCAmJiB0LndvcmQgPT09ICdpbicgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMVxuICApO1xuICBsZXQgbGlzdDogc3RyaW5nW10gfCBudWxsID0gbnVsbDtcbiAgaWYgKGluVG9rICE9PSB1bmRlZmluZWQpIHtcbiAgICBsaXN0ID0gdG9rcy5maWx0ZXIoKHQpID0+IHQuc3RhcnQgPiBpblRvay5lbmQgJiYgdC5zdGFydCA8IGRvVG9rLnN0YXJ0KS5tYXAoKHQpID0+IHQud29yZCk7XG4gIH1cbiAgcmV0dXJuIHsgbGlzdCwgYm9keTogdGV4dC5zbGljZShkb1Rvay5lbmQsIGRvbmVUb2suc3RhcnQpLCB3aG9sZUludGVyaW9yOiB0ZXh0LnNsaWNlKG5hbWVUb2suZW5kLCBkb25lVG9rLnN0YXJ0KSB9O1xufVxuXG5pbnRlcmZhY2UgUGFyc2VkQ2FzZSB7XG4gIHN1YmplY3Q6IHN0cmluZztcbiAgYnJhbmNoZXM6IHsgcGF0dGVybjogc3RyaW5nOyBib2R5OiBzdHJpbmcgfVtdO1xuICBmYWxsdGhyb3VnaDogYm9vbGVhbjtcbn1cblxuZnVuY3Rpb24gcGFyc2VDYXNlKHRleHQ6IHN0cmluZyk6IFBhcnNlZENhc2UgfCBudWxsIHtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gdGV4dC5sZW5ndGg7XG4gIGNvbnN0IHNraXBXcyA9ICgpID0+IHtcbiAgICB3aGlsZSAoaSA8IG4gJiYgL1xccy8udGVzdCh0ZXh0W2ldKSkgaSsrO1xuICB9O1xuICBza2lwV3MoKTtcbiAgY29uc3QgbGVhZCA9IHJlYWRXb3JkQXQodGV4dCwgaSk7XG4gIGlmIChsZWFkID09PSBudWxsIHx8IGxlYWQud29yZCAhPT0gJ2Nhc2UnKSByZXR1cm4gbnVsbDtcbiAgaSA9IGxlYWQuZW5kO1xuXG4gIC8vIFRoZSBzdWJqZWN0IHdvcmRzIHVwIHRvIHRoZSBgaW5gIGF0IHBhcmVuIGRlcHRoIDAgKHF1b3RlIGNvbnRlbnQgb25seSkuXG4gIGxldCBwYXJlbkRlcHRoID0gMDtcbiAgY29uc3Qgc3ViamVjdFdvcmRzOiBzdHJpbmdbXSA9IFtdO1xuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBza2lwV3MoKTtcbiAgICBpZiAoaSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjID0gdGV4dFtpXTtcbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBwYXJlbkRlcHRoKys7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgcGFyZW5EZXB0aCA9IE1hdGgubWF4KDAsIHBhcmVuRGVwdGggLSAxKTtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoJzsmfDw+Jy5pbmNsdWRlcyhjKSkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHcgPSByZWFkV29yZEF0KHRleHQsIGkpO1xuICAgIGlmICh3ID09PSBudWxsKSB7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaSA9IHcuZW5kO1xuICAgIGlmIChwYXJlbkRlcHRoID09PSAwICYmICF3LnF1b3RlZCAmJiB3LndvcmQgPT09ICdpbicpIGJyZWFrO1xuICAgIHN1YmplY3RXb3Jkcy5wdXNoKHcud29yZCk7XG4gIH1cbiAgaWYgKGkgPj0gbikgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgYnJhbmNoZXM6IHsgcGF0dGVybjogc3RyaW5nOyBib2R5OiBzdHJpbmcgfVtdID0gW107XG4gIGxldCBmYWxsdGhyb3VnaCA9IGZhbHNlO1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHNraXBXcygpO1xuICAgIGlmIChpID49IG4pIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHcgPSByZWFkV29yZEF0KHRleHQsIGkpO1xuICAgIGlmICh3ICE9PSBudWxsICYmICF3LnF1b3RlZCAmJiB3LndvcmQgPT09ICdlc2FjJykge1xuICAgICAgcmV0dXJuIHsgc3ViamVjdDogc3ViamVjdFdvcmRzLmpvaW4oJyAnKSwgYnJhbmNoZXMsIGZhbGx0aHJvdWdoIH07XG4gICAgfVxuICAgIC8vIFRoZSBwYXR0ZXJuOiBldmVyeXRoaW5nIHVwIHRvIHRoZSBgKWAgYXQgcGFyZW4gZGVwdGggMC5cbiAgICBsZXQgcGF0RW5kID0gLTE7XG4gICAge1xuICAgICAgbGV0IHAgPSBpO1xuICAgICAgbGV0IGRlcHRoID0gMDtcbiAgICAgIGxldCBpblF1b3RlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICAgIHdoaWxlIChwIDwgbikge1xuICAgICAgICBjb25zdCBjaCA9IHRleHRbcF07XG4gICAgICAgIGlmIChpblF1b3RlICE9PSBudWxsKSB7XG4gICAgICAgICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaW5RdW90ZSA9PT0gJ1wiJyAmJiBwICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyh0ZXh0W3AgKyAxXSkpIHtcbiAgICAgICAgICAgIHAgKz0gMjtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoY2ggPT09IGluUXVvdGUpIGluUXVvdGUgPSBudWxsO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09IFwiJ1wiIHx8IGNoID09PSAnXCInKSB7XG4gICAgICAgICAgaW5RdW90ZSA9IGNoO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICdcXFxcJykge1xuICAgICAgICAgIHAgKz0gMjtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICcoJykge1xuICAgICAgICAgIGRlcHRoKys7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJyknKSB7XG4gICAgICAgICAgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICAgICAgICBwYXRFbmQgPSBwO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGRlcHRoLS07XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIHArKztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHBhdEVuZCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHBhdHRlcm4gPSB0ZXh0LnNsaWNlKGksIHBhdEVuZCkudHJpbSgpO1xuICAgIGkgPSBwYXRFbmQgKyAxO1xuXG4gICAgLy8gVGhlIGJvZHk6IGV2ZXJ5dGhpbmcgdXAgdG8gdGhlIGA7O2AvYDsmYC9gOzsmYCBhdCBwYXJlbi9icmFjZSBkZXB0aCAwLlxuICAgIGxldCBib2R5RW5kID0gLTE7XG4gICAgbGV0IHRlcm0gPSAnJztcbiAgICB7XG4gICAgICBsZXQgcCA9IGk7XG4gICAgICBsZXQgZGVwdGggPSAwO1xuICAgICAgbGV0IGJkZXB0aCA9IDA7XG4gICAgICBsZXQgaW5RdW90ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICB3aGlsZSAocCA8IG4pIHtcbiAgICAgICAgY29uc3QgY2ggPSB0ZXh0W3BdO1xuICAgICAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGluUXVvdGUgPT09ICdcIicgJiYgcCArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXModGV4dFtwICsgMV0pKSB7XG4gICAgICAgICAgICBwICs9IDI7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGNoID09PSBpblF1b3RlKSBpblF1b3RlID0gbnVsbDtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSBcIidcIiB8fCBjaCA9PT0gJ1wiJykge1xuICAgICAgICAgIGluUXVvdGUgPSBjaDtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnXFxcXCcpIHtcbiAgICAgICAgICBwICs9IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnKCcpIHtcbiAgICAgICAgICBkZXB0aCsrO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICcpJykge1xuICAgICAgICAgIGRlcHRoID0gTWF0aC5tYXgoMCwgZGVwdGggLSAxKTtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAneycpIHtcbiAgICAgICAgICBiZGVwdGgrKztcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnfScpIHtcbiAgICAgICAgICBiZGVwdGggPSBNYXRoLm1heCgwLCBiZGVwdGggLSAxKTtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlcHRoID09PSAwICYmIGJkZXB0aCA9PT0gMCAmJiBjaCA9PT0gJzsnKSB7XG4gICAgICAgICAgY29uc3QgbmV4dCA9IHRleHRbcCArIDFdO1xuICAgICAgICAgIGlmIChuZXh0ID09PSAnOycgfHwgbmV4dCA9PT0gJyYnKSB7XG4gICAgICAgICAgICB0ZXJtID0gbmV4dCA9PT0gJzsnID8gKHRleHRbcCArIDJdID09PSAnJicgPyAnOzsmJyA6ICc7OycpIDogJzsmJztcbiAgICAgICAgICAgIGJvZHlFbmQgPSBwO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHArKztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHRlcm0gPT09ICcnKSByZXR1cm4gbnVsbDtcbiAgICBicmFuY2hlcy5wdXNoKHsgcGF0dGVybiwgYm9keTogdGV4dC5zbGljZShpLCBib2R5RW5kKS50cmltKCkgfSk7XG4gICAgaSA9IGJvZHlFbmQgKyB0ZXJtLmxlbmd0aDtcbiAgICBpZiAodGVybSA9PT0gJzsmJyB8fCB0ZXJtID09PSAnOzsmJykgZmFsbHRocm91Z2ggPSB0cnVlO1xuICB9XG59XG5cbi8qKiBSZXNvbHZlIGEgYGNhc2VgIHN1YmplY3QgYWdhaW5zdCB0aGUgcmVjb3JkZWQgYXNzaWdubWVudHMgKHBsYW4gXHUwMEE3MSwgZGVjaWRhYmxlIGNhc2UpLiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVN1YmplY3Qoc3ViamVjdDogc3RyaW5nLCBhc3NpZ25tZW50czogTWFwPHN0cmluZywgc3RyaW5nPik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBtID0gc3ViamVjdC5tYXRjaCgvXlxcJChbQS1aYS16X11bQS1aYS16MC05X10qKSQvKSA/PyBzdWJqZWN0Lm1hdGNoKC9eXFwkXFx7KFtBLVphLXpfXVtBLVphLXowLTlfXSopXFx9JC8pO1xuICBpZiAobSAhPT0gbnVsbCkge1xuICAgIGNvbnN0IHYgPSBhc3NpZ25tZW50cy5nZXQobVsxXSk7XG4gICAgcmV0dXJuIHYgIT09IHVuZGVmaW5lZCA/IHYgOiBudWxsO1xuICB9XG4gIGlmICgvWyRgXS8udGVzdChzdWJqZWN0KSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBzdWJqZWN0O1xufVxuXG4vKipcbiAqIEFsdGVybmF0aXZlIHNwbGl0IG9mIGEgYGNhc2VgIHBhdHRlcm4gb24gdW5xdW90ZWQgYHxgLiBUaGUgYWx0ZXJuYXRpdmVzIGFyZVxuICogcmV0dXJuZWQgdmVyYmF0aW0gXHUyMDE0IHF1b3RlcyBhbmQgYmFja3NsYXNoIGVzY2FwZXMgcHJlc2VydmVkIFx1MjAxNCBzb1xuICogYGFuYWx5emVQYXR0ZXJuYCdzIHF1b3RlIGhhbmRsaW5nIGlzIHRoZSBzaW5nbGUgaW50ZXJwcmV0ZXI6IHN0cmlwcGluZyB0aGVtXG4gKiBoZXJlIHdvdWxkIHR1cm4gYCdhKidgIGludG8gYW4gdW5xdW90ZWQgZ2xvYiBhbmQgYFxcfGAgaW50byBhIHNwbGl0IHBvaW50LlxuICovXG5mdW5jdGlvbiBzcGxpdFBhdHRlcm5BbHRlcm5hdGl2ZXMocGF0dGVybjogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1ciA9ICcnO1xuICBsZXQgaW5RdW90ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGF0dGVybi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gcGF0dGVybltpXTtcbiAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaW5RdW90ZSA9PT0gJ1wiJyAmJiBpICsgMSA8IHBhdHRlcm4ubGVuZ3RoICYmICdcIlxcXFwkYCcuaW5jbHVkZXMocGF0dGVybltpICsgMV0pKSB7XG4gICAgICAgIGN1ciArPSBjaDtcbiAgICAgICAgY3VyICs9IHBhdHRlcm5baSArIDFdO1xuICAgICAgICBpKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNoID09PSBpblF1b3RlKSB7XG4gICAgICAgIGluUXVvdGUgPSBudWxsO1xuICAgICAgICBjdXIgKz0gY2g7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY3VyICs9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gXCInXCIgfHwgY2ggPT09ICdcIicpIHtcbiAgICAgIGluUXVvdGUgPSBjaDtcbiAgICAgIGN1ciArPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpICsgMSA8IHBhdHRlcm4ubGVuZ3RoKSB7XG4gICAgICBjdXIgKz0gY2g7XG4gICAgICBjdXIgKz0gcGF0dGVybltpICsgMV07XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnfCcpIHtcbiAgICAgIHBhcnRzLnB1c2goY3VyKTtcbiAgICAgIGN1ciA9ICcnO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGN1ciArPSBjaDtcbiAgfVxuICBwYXJ0cy5wdXNoKGN1cik7XG4gIHJldHVybiBwYXJ0cztcbn1cblxuLyoqXG4gKiBRdW90ZS1hd2FyZSBwYXR0ZXJuIGFuYWx5c2lzOiB0aGUgbGl0ZXJhbCB2YWx1ZSAocXVvdGVzIHN0cmlwcGVkLCBiYWNrc2xhc2hcbiAqIGVzY2FwZXMgcmVzb2x2ZWQpIGFuZCB3aGV0aGVyIGFueSB1bnF1b3RlZCBnbG9iIGNoYXIgYXBwZWFycy5cbiAqL1xuZnVuY3Rpb24gYW5hbHl6ZVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogeyBsaXRlcmFsOiBzdHJpbmc7IGdsb2I6IGJvb2xlYW4gfSB7XG4gIGxldCBsaXRlcmFsID0gJyc7XG4gIGxldCBnbG9iID0gZmFsc2U7XG4gIGxldCBpblF1b3RlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXR0ZXJuLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgY2ggPSBwYXR0ZXJuW2ldO1xuICAgIGlmIChpblF1b3RlICE9PSBudWxsKSB7XG4gICAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpblF1b3RlID09PSAnXCInICYmIGkgKyAxIDwgcGF0dGVybi5sZW5ndGggJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhwYXR0ZXJuW2kgKyAxXSkpIHtcbiAgICAgICAgbGl0ZXJhbCArPSBwYXR0ZXJuW2kgKyAxXTtcbiAgICAgICAgaSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjaCA9PT0gaW5RdW90ZSkge1xuICAgICAgICBpblF1b3RlID0gbnVsbDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBsaXRlcmFsICs9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gXCInXCIgfHwgY2ggPT09ICdcIicpIHtcbiAgICAgIGluUXVvdGUgPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpICsgMSA8IHBhdHRlcm4ubGVuZ3RoKSB7XG4gICAgICBsaXRlcmFsICs9IHBhdHRlcm5baSArIDFdO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgnKj9bJy5pbmNsdWRlcyhjaCkpIHtcbiAgICAgIGdsb2IgPSB0cnVlO1xuICAgICAgbGl0ZXJhbCArPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBsaXRlcmFsICs9IGNoO1xuICB9XG4gIHJldHVybiB7IGxpdGVyYWwsIGdsb2IgfTtcbn1cblxudHlwZSBQYXR0ZXJuUmVzdWx0ID0gJ21hdGNoJyB8ICduby1tYXRjaCcgfCAnZ2xvYicgfCAndW5kZWNpZGFibGUnO1xuXG4vKipcbiAqIEZpeHR1cmUtcGlubmVkIGBjYXNlYCBwYXR0ZXJuIGV2YWx1YXRpb24gKHBsYW4gXHUwMEE3MSwgZGVjaWRhYmxlIGNhc2UpOiBhIGB8YFxuICogcGF0dGVybiBpcyBkZWNpZGFibGUgaWZmIGl0cyBmaXJzdCBhbHRlcm5hdGl2ZSBpcyBhIGxpdGVyYWwgbWF0Y2ggYW5kIGV2ZXJ5XG4gKiBhbHRlcm5hdGl2ZSBhZnRlciB0aGUgZmlyc3QgaXMgYSBnbG9iIChkZWFkKTsgYSBnbG9iIGJlZm9yZSBhbnkgbGl0ZXJhbFxuICogbWF0Y2ggaXMgdW5kZWNpZGFibGUsIGFuZCBhIGxhdGVyIGxpdGVyYWwgbm9uLW1hdGNoIGFmdGVyIGEgbGl0ZXJhbCBtYXRjaFxuICogaXMgdW5kZWNpZGFibGUgKHRoZSBhbGwtbGl0ZXJhbCBgYXxiYCBmYWlsLWNsb3NlZCBkaXZlcmdlbmNlIFx1MjAxNCBiYXNoIHJ1bnNcbiAqIHRoZSBicmFuY2gpLlxuICovXG5mdW5jdGlvbiBldmFsUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcsIHN1YmplY3Q6IHN0cmluZyk6IFBhdHRlcm5SZXN1bHQge1xuICBjb25zdCBhbHRzID0gc3BsaXRQYXR0ZXJuQWx0ZXJuYXRpdmVzKHBhdHRlcm4pO1xuICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IGFsdCBvZiBhbHRzKSB7XG4gICAgY29uc3QgeyBsaXRlcmFsLCBnbG9iIH0gPSBhbmFseXplUGF0dGVybihhbHQpO1xuICAgIGlmIChnbG9iKSB7XG4gICAgICBpZiAoIW1hdGNoZWQpIHJldHVybiAnZ2xvYic7XG4gICAgfSBlbHNlIGlmIChsaXRlcmFsID09PSBzdWJqZWN0KSB7XG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICB9IGVsc2UgaWYgKG1hdGNoZWQpIHtcbiAgICAgIHJldHVybiAndW5kZWNpZGFibGUnO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWF0Y2hlZCA/ICdtYXRjaCcgOiAnbm8tbWF0Y2gnO1xufVxuXG4vKiogVGhlIGV4ZWN1dGlvbiB3YWxrJ3Mgc2hhcmVkIHN0YXRlLCBvbmUgaW5zdGFuY2UgcGVyIGBwYXJzZUNvbW1hbmREZXRhaWxlZGAgY2FsbC4gKi9cbmNsYXNzIEV4ZWN1dGlvbldhbGtlciB7XG4gIGNoYWluOiBDaGFpblN0YXR1cyA9ICdzdWNjZXNzJztcbiAgZXJyZXhpdCA9IGZhbHNlO1xuICBwaXBlZmFpbCA9IGZhbHNlO1xuICBhc3NpZ25tZW50cyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIGRlZnMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICBkZWFkOiBEZWFkS2luZCB8IG51bGwgPSBudWxsO1xuICByZXR1cm5lZCA9IGZhbHNlO1xuICBmbkRlcHRoID0gMDtcbiAgbG9vcFN0YWNrOiBMb29wRnJhbWVbXSA9IFtdO1xuICByZWFkb25seSBleHBhbmRlZDogRXhwYW5kZWRTdGFnZVtdID0gW107XG4gIHJlYWRvbmx5IHZlcmRpY3RzOiBFeGVjU3RhdHVzW10gPSBbXTtcbiAgZGlyRnJhbWUgPSAwO1xuICByZWFkb25seSBkZWZQcm9iZVN0YWNrID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgd2Fsa0lucHV0KHN0YWdlczogU2ltcGxlQ29tbWFuZFtdKTogRXhwYW5kZWRTdGFnZVtdIHtcbiAgICB0aGlzLndhbGtMaXN0KHN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZDogZmFsc2UsIHNpZGVFZmZlY3RzOiB0cnVlLCBpbnB1dEZhY2luZzogdHJ1ZSB9KTtcbiAgICByZXR1cm4gdGhpcy5leHBhbmRlZDtcbiAgfVxuXG4gIHByaXZhdGUgc3RvcHBlZCgpOiBib29sZWFuIHtcbiAgICBpZiAodGhpcy5kZWFkICE9PSBudWxsIHx8IHRoaXMucmV0dXJuZWQpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHRvcCA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDFdO1xuICAgIHJldHVybiB0b3AgIT09IHVuZGVmaW5lZCAmJiAodG9wLmJvZHlUZXJtaW5hdGVkIHx8IHRvcC5hbWJpZ3VvdXNTdG9wKTtcbiAgfVxuXG4gIC8qKiBXYWxrIG9uZSBsaXN0IChhIGZyZXNoIGAmJmAvYHx8YCBjaGFpbik7IHJldHVybnMgdGhlIGxpc3QncyBmaW5hbCBjaGFpbiBzdGF0dXMuICovXG4gIHByaXZhdGUgd2Fsa0xpc3Qoc3RhZ2VzOiBTaW1wbGVDb21tYW5kW10sIG9wdHM6IFdhbGtPcHRpb25zKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IHNhdmVkQ2hhaW4gPSB0aGlzLmNoYWluO1xuICAgIHRoaXMuY2hhaW4gPSAnc3VjY2Vzcyc7XG4gICAgbGV0IGkgPSAwO1xuICAgIHdoaWxlIChpIDwgc3RhZ2VzLmxlbmd0aCAmJiAhdGhpcy5zdG9wcGVkKCkpIHtcbiAgICAgIGNvbnN0IGVuZCA9IHRoaXMuZ3JvdXBFbmQoc3RhZ2VzLCBpKTtcbiAgICAgIGNvbnN0IG5leHQgPSBlbmQgPCBzdGFnZXMubGVuZ3RoID8gc3RhZ2VzW2VuZF0gOiBudWxsO1xuICAgICAgdGhpcy5wcm9jZXNzR3JvdXAoc3RhZ2VzLnNsaWNlKGksIGVuZCksIG5leHQsIG9wdHMpO1xuICAgICAgaSA9IGVuZDtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gdGhpcy5jaGFpbjtcbiAgICB3aGlsZSAoaSA8IHN0YWdlcy5sZW5ndGgpIHtcbiAgICAgIGlmIChvcHRzLmlucHV0RmFjaW5nKSB0aGlzLnZlcmRpY3RzLnB1c2goJ25vJyk7XG4gICAgICBpKys7XG4gICAgfVxuICAgIHRoaXMuY2hhaW4gPSBzYXZlZENoYWluO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwcml2YXRlIGdyb3VwRW5kKHN0YWdlczogU2ltcGxlQ29tbWFuZFtdLCBzdGFydDogbnVtYmVyKTogbnVtYmVyIHtcbiAgICBsZXQgZW5kID0gc3RhcnQ7XG4gICAgd2hpbGUgKGVuZCArIDEgPCBzdGFnZXMubGVuZ3RoICYmIHN0YWdlc1tlbmQgKyAxXS5wcmVjZWRlZEJ5ID09PSAncGlwZScpIGVuZCsrO1xuICAgIHJldHVybiBlbmQgKyAxO1xuICB9XG5cbiAgcHJpdmF0ZSBwcm9jZXNzR3JvdXAoZ3JvdXA6IFNpbXBsZUNvbW1hbmRbXSwgbmV4dDogU2ltcGxlQ29tbWFuZCB8IG51bGwsIG9wdHM6IFdhbGtPcHRpb25zKTogdm9pZCB7XG4gICAgY29uc3QgZmlyc3QgPSBncm91cFswXTtcbiAgICBsZXQgZXhlY3V0ZXM6IGJvb2xlYW4gfCAndW5rbm93bic7XG4gICAgc3dpdGNoIChmaXJzdC5wcmVjZWRlZEJ5KSB7XG4gICAgICBjYXNlICdhbmQnOlxuICAgICAgICBleGVjdXRlcyA9IHRoaXMuY2hhaW4gPT09ICdzdWNjZXNzJyA/IHRydWUgOiB0aGlzLmNoYWluID09PSAnZmFpbHVyZScgPyBmYWxzZSA6ICd1bmtub3duJztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdvcic6XG4gICAgICAgIGV4ZWN1dGVzID0gdGhpcy5jaGFpbiA9PT0gJ2ZhaWx1cmUnID8gdHJ1ZSA6IHRoaXMuY2hhaW4gPT09ICdzdWNjZXNzJyA/IGZhbHNlIDogJ3Vua25vd24nO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGV4ZWN1dGVzID0gdHJ1ZTtcbiAgICB9XG4gICAgY29uc3QgZXhlYzogRXhlY1N0YXR1cyA9IGV4ZWN1dGVzID09PSB0cnVlID8gJ3llcycgOiBleGVjdXRlcyA9PT0gZmFsc2UgPyAnbm8nIDogJ3Vua25vd24nO1xuICAgIGNvbnN0IGJhY2tncm91bmRlZCA9IGZpcnN0LnByZWNlZGVkQnkgPT09ICdiYWNrZ3JvdW5kJyB8fCAobmV4dCAhPT0gbnVsbCAmJiBuZXh0LnByZWNlZGVkQnkgPT09ICdiYWNrZ3JvdW5kJyk7XG4gICAgaWYgKG9wdHMuaW5wdXRGYWNpbmcpIHtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ3JvdXAubGVuZ3RoOyBpKyspIHRoaXMudmVyZGljdHMucHVzaChleGVjKTtcbiAgICB9XG5cbiAgICAvLyBgIWAgaXMgYSBncm91cC1sZXZlbCBtb2RpZmllcjogdGhlIGNvdW50IG9mIGxlYWRpbmcgYCFgIHdvcmRzIG9uIHRoZVxuICAgIC8vIGZpcnN0IG1lbWJlcidzIGFyZ3YgbmVnYXRlcyB0aGUgZ3JvdXAncyBmaW5hbCBzdGF0dXMgKG9kZCBuZWdhdGVzKS5cbiAgICBjb25zdCBmaXJzdEFyZ3YgPSBhcmd2T2YoZmlyc3QudGV4dCk7XG4gICAgbGV0IGJhbmdDb3VudCA9IDA7XG4gICAgbGV0IG1lbWJlckFyZ3Y6IHN0cmluZ1tdIHwgbnVsbCA9IGZpcnN0QXJndjtcbiAgICBpZiAoZmlyc3RBcmd2ICE9PSBudWxsKSB7XG4gICAgICB3aGlsZSAobWVtYmVyQXJndiFbYmFuZ0NvdW50XSA9PT0gJyEnKSBiYW5nQ291bnQrKztcbiAgICAgIG1lbWJlckFyZ3YgPSBtZW1iZXJBcmd2IS5zbGljZShiYW5nQ291bnQpO1xuICAgIH1cbiAgICBjb25zdCBpbnZlcnRlZCA9IGJhbmdDb3VudCAlIDIgPT09IDE7XG5cbiAgICBpZiAoZXhlYyA9PT0gJ25vJykgcmV0dXJuO1xuXG4gICAgY29uc3Qgc3RhdHVzZXM6IENoYWluU3RhdHVzW10gPSBbXTtcbiAgICBjb25zdCBpblBpcGVsaW5lID0gZ3JvdXAubGVuZ3RoID4gMTtcbiAgICBmb3IgKGxldCBtID0gMDsgbSA8IGdyb3VwLmxlbmd0aDsgbSsrKSB7XG4gICAgICBzdGF0dXNlcy5wdXNoKFxuICAgICAgICB0aGlzLnByb2Nlc3NNZW1iZXIoZ3JvdXBbbV0sIHtcbiAgICAgICAgICBleGVjLFxuICAgICAgICAgIGluUGlwZWxpbmUsXG4gICAgICAgICAgYmFja2dyb3VuZGVkLFxuICAgICAgICAgIG1lbWJlckFyZ3Y6IG0gPT09IDAgPyBtZW1iZXJBcmd2IDogbnVsbCxcbiAgICAgICAgICBvcHRzXG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFRoZSBncm91cCBzdGF0dXM6IHRoZSBsYXN0IG1lbWJlcidzLCB1bmxlc3MgcGlwZWZhaWwgbWFrZXMgaXQgdGhlIHdvcnN0IG1lbWJlci5cbiAgICBsZXQgZ3JvdXBTdGF0dXM6IENoYWluU3RhdHVzO1xuICAgIGlmICh0aGlzLnBpcGVmYWlsICYmIGdyb3VwLmxlbmd0aCA+IDEpIHtcbiAgICAgIGlmIChzdGF0dXNlcy5ldmVyeSgocykgPT4gcyA9PT0gJ3N1Y2Nlc3MnKSkgZ3JvdXBTdGF0dXMgPSAnc3VjY2Vzcyc7XG4gICAgICBlbHNlIGlmIChzdGF0dXNlcy5zb21lKChzKSA9PiBzID09PSAnZmFpbHVyZScpKSBncm91cFN0YXR1cyA9ICdmYWlsdXJlJztcbiAgICAgIGVsc2UgZ3JvdXBTdGF0dXMgPSAndW5rbm93bic7XG4gICAgfSBlbHNlIHtcbiAgICAgIGdyb3VwU3RhdHVzID0gc3RhdHVzZXNbc3RhdHVzZXMubGVuZ3RoIC0gMV07XG4gICAgfVxuICAgIGlmIChpbnZlcnRlZCkge1xuICAgICAgZ3JvdXBTdGF0dXMgPSBncm91cFN0YXR1cyA9PT0gJ3N1Y2Nlc3MnID8gJ2ZhaWx1cmUnIDogZ3JvdXBTdGF0dXMgPT09ICdmYWlsdXJlJyA/ICdzdWNjZXNzJyA6ICd1bmtub3duJztcbiAgICB9XG5cbiAgICAvLyBFcnJleGl0IGxpdmVuZXNzOiBhbiBleGVjdXRpbmcgZ3JvdXAgd2hvc2Ugbm9uLWV4ZW1wdCBtZW1iZXJzIGRpZCBub3RcbiAgICAvLyBhbGwgc3VjY2VlZCBraWxscyB0aGUgc2hlbGw7IGV2ZXJ5IGxhdGVyIHN0YWdlIGlzICdubycuXG4gICAgaWYgKG9wdHMubGl2ZW5lc3MgJiYgdGhpcy5lcnJleGl0ICYmIGdyb3VwU3RhdHVzICE9PSAnc3VjY2VzcycpIHtcbiAgICAgIGNvbnN0IGNoYWluRmluYWwgPSBuZXh0ID09PSBudWxsIHx8IChuZXh0LnByZWNlZGVkQnkgIT09ICdhbmQnICYmIG5leHQucHJlY2VkZWRCeSAhPT0gJ29yJyk7XG4gICAgICBpZiAoY2hhaW5GaW5hbCAmJiAhaW52ZXJ0ZWQgJiYgIWJhY2tncm91bmRlZCkgdGhpcy5kZWFkID0gJ2VycmV4aXQnO1xuICAgIH1cblxuICAgIGlmIChleGVjID09PSAneWVzJykgdGhpcy5jaGFpbiA9IGdyb3VwU3RhdHVzO1xuICAgIGVsc2UgdGhpcy5jaGFpbiA9ICd1bmtub3duJztcbiAgfVxuXG4gIHByaXZhdGUgcHJvY2Vzc01lbWJlcihcbiAgICBtZW1iZXI6IFNpbXBsZUNvbW1hbmQsXG4gICAgY3R4OiB7XG4gICAgICBleGVjOiBFeGVjU3RhdHVzO1xuICAgICAgaW5QaXBlbGluZTogYm9vbGVhbjtcbiAgICAgIGJhY2tncm91bmRlZDogYm9vbGVhbjtcbiAgICAgIG1lbWJlckFyZ3Y6IHN0cmluZ1tdIHwgbnVsbDtcbiAgICAgIG9wdHM6IFdhbGtPcHRpb25zO1xuICAgIH1cbiAgKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IGtpbmQgPSBjbGFzc2lmeVN0YWdlKG1lbWJlci50ZXh0KTtcbiAgICBpZiAoa2luZCA9PT0gJ3BsYWluJykgcmV0dXJuIHRoaXMucHJvY2Vzc1BsYWluTWVtYmVyKG1lbWJlciwgY3R4KTtcbiAgICByZXR1cm4gdGhpcy5wcm9jZXNzQ29uc3RydWN0KG1lbWJlciwga2luZCwgY3R4KTtcbiAgfVxuXG4gIHByaXZhdGUgcHJvY2Vzc1BsYWluTWVtYmVyKFxuICAgIG1lbWJlcjogU2ltcGxlQ29tbWFuZCxcbiAgICBjdHg6IHtcbiAgICAgIGV4ZWM6IEV4ZWNTdGF0dXM7XG4gICAgICBpblBpcGVsaW5lOiBib29sZWFuO1xuICAgICAgYmFja2dyb3VuZGVkOiBib29sZWFuO1xuICAgICAgbWVtYmVyQXJndjogc3RyaW5nW10gfCBudWxsO1xuICAgICAgb3B0czogV2Fsa09wdGlvbnM7XG4gICAgfVxuICApOiBDaGFpblN0YXR1cyB7XG4gICAgY29uc3QgeyBleGVjLCBpblBpcGVsaW5lLCBiYWNrZ3JvdW5kZWQsIG1lbWJlckFyZ3YsIG9wdHMgfSA9IGN0eDtcbiAgICBjb25zdCBhcmd2ID0gbWVtYmVyQXJndiA/PyBhcmd2T2YobWVtYmVyLnRleHQpO1xuICAgIGNvbnN0IHN0cmlwcGVkID0gYXJndiA9PT0gbnVsbCA/IG51bGwgOiB3YWxrU3RyaXAoYXJndik7XG5cbiAgICAvLyBTaWRlIGVmZmVjdHMgb25seSBmcm9tIGV4ZWN1dGVkLCBub24tcGlwZSBzdGFnZXMuXG4gICAgaWYgKGV4ZWMgPT09ICd5ZXMnICYmICFpblBpcGVsaW5lICYmIG9wdHMuc2lkZUVmZmVjdHMpIHtcbiAgICAgIHRoaXMuYXBwbHlTaWRlRWZmZWN0cyhtZW1iZXIsIGFyZ3YsIHN0cmlwcGVkKTtcbiAgICB9XG5cbiAgICAvLyBUaGUga25vd24gc3RhdHVzLlxuICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMua25vd25TdGF0dXMoYXJndik7XG5cbiAgICAvLyBUaGUgdGVybWluYXRvcjogYW4gZXhlY3V0ZWQgb3IgdW5rbm93bi1leGVjdXRpb24gbm9uLXBpcGUgc3RhZ2Ugd2hvc2VcbiAgICAvLyB0ZXJtaW5hdG9yIHdvcmQgKGJhcmUsIG9yIGJlaGluZCBgY29tbWFuZGAvYGJ1aWx0aW5gKSBpcyBgZXhpdGAvYGV4ZWNgLlxuICAgIGlmICghaW5QaXBlbGluZSAmJiBleGVjICE9PSAnbm8nICYmIHN0cmlwcGVkICE9PSBudWxsICYmIChzdHJpcHBlZFswXSA9PT0gJ2V4aXQnIHx8IHN0cmlwcGVkWzBdID09PSAnZXhlYycpKSB7XG4gICAgICB0aGlzLmRlYWQgPSAnZXhpdCc7XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuLXN0b3BwaW5nOiBhIHByb3ZhYmx5LWZpcmluZyBjb21tYW5kLXBvc2l0aW9uIGByZXR1cm5gIGF0XG4gICAgLy8gZnVuY3Rpb24tYm9keSBkZXB0aCBleGl0cyB0aGUgZnVuY3Rpb24gXHUyMDE0IGV2ZXJ5dGhpbmcgYWZ0ZXIgbmV2ZXIgcnVucy5cbiAgICBpZiAoIWluUGlwZWxpbmUgJiYgZXhlYyA9PT0gJ3llcycgJiYgdGhpcy5mbkRlcHRoID4gMCAmJiBzdHJpcHBlZCAhPT0gbnVsbCAmJiBzdHJpcHBlZFswXSA9PT0gJ3JldHVybicpIHtcbiAgICAgIHRoaXMucmV0dXJuZWQgPSB0cnVlO1xuICAgICAgY29uc3QgdG9wID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMV07XG4gICAgICBpZiAodG9wICE9PSB1bmRlZmluZWQpIHRvcC5vdXRjb21lID0gJ3JldHVybic7XG4gICAgfVxuXG4gICAgLy8gQnJlYWsvY29udGludWUgZXZlbnRzIChhIGhpZGRlbiBgJ3Vua25vd24nYC1leGVjIG9uZSBtYWtlcyB0aGUgZ3VhcmRcbiAgICAvLyB1bnRvdWNoYWJsZSBcdTIwMTQgYW1iaWd1b3VzIFx1MjAxNCBwZXIgdGhlIGxvb3Atc2NhbiBkaXNjaXBsaW5lKS5cbiAgICBpZiAoIWluUGlwZWxpbmUgJiYgZXhlYyAhPT0gJ25vJyAmJiBzdHJpcHBlZCAhPT0gbnVsbCAmJiAoc3RyaXBwZWRbMF0gPT09ICdicmVhaycgfHwgc3RyaXBwZWRbMF0gPT09ICdjb250aW51ZScpKSB7XG4gICAgICB0aGlzLmFwcGx5QnJlYWtDb250aW51ZShzdHJpcHBlZCwgZXhlYyk7XG4gICAgfVxuXG4gICAgLy8gQSBjYWxsIHRvIGEgcmVnaXN0ZXJlZCBkZWZpbml0aW9uLlxuICAgIGlmIChleGVjICE9PSAnbm8nICYmIHN0cmlwcGVkICE9PSBudWxsICYmIHN0cmlwcGVkLmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuYXBwbHlDYWxsKHN0cmlwcGVkWzBdLCBpblBpcGVsaW5lLCBiYWNrZ3JvdW5kZWQpO1xuICAgIH1cblxuICAgIGlmICghb3B0cy5kaXNjYXJkKSB7XG4gICAgICB0aGlzLmV4cGFuZGVkLnB1c2goe1xuICAgICAgICB0ZXh0OiBtZW1iZXIudGV4dCxcbiAgICAgICAgcHJlY2VkZWRCeTogbWVtYmVyLnByZWNlZGVkQnksXG4gICAgICAgIGV4ZWMsXG4gICAgICAgIGluUGlwZWxpbmUsXG4gICAgICAgIGRpckZyYW1lOiB0aGlzLmRpckZyYW1lLFxuICAgICAgICBhc3NpZ25tZW50czogbmV3IE1hcCh0aGlzLmFzc2lnbm1lbnRzKVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBzdGF0dXM7XG4gIH1cblxuICBwcml2YXRlIGFwcGx5QnJlYWtDb250aW51ZShzdHJpcHBlZDogc3RyaW5nW10sIGV4ZWM6IEV4ZWNTdGF0dXMpOiB2b2lkIHtcbiAgICBjb25zdCBkZXB0aCA9IE51bWJlci5wYXJzZUludChzdHJpcHBlZFsxXSA/PyAnMScsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKGRlcHRoKSB8fCBkZXB0aCA8IDEpIHJldHVybjtcbiAgICBpZiAodGhpcy5sb29wU3RhY2subGVuZ3RoID09PSAwIHx8IGRlcHRoID4gdGhpcy5sb29wU3RhY2subGVuZ3RoKSByZXR1cm47XG4gICAgaWYgKGV4ZWMgPT09ICd1bmtub3duJykge1xuICAgICAgZm9yIChsZXQgZCA9IDA7IGQgPCBkZXB0aDsgZCsrKSB7XG4gICAgICAgIGNvbnN0IGZyYW1lID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMSAtIGRdO1xuICAgICAgICBpZiAoZnJhbWUub3V0Y29tZSA9PT0gJ25vbmUnKSB7XG4gICAgICAgICAgZnJhbWUub3V0Y29tZSA9ICdhbWJpZ3VvdXMnO1xuICAgICAgICAgIGZyYW1lLmFtYmlndW91c1N0b3AgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGlzQ29udGludWUgPSBzdHJpcHBlZFswXSA9PT0gJ2NvbnRpbnVlJztcbiAgICBmb3IgKGxldCBkID0gMDsgZCA8IGRlcHRoOyBkKyspIHtcbiAgICAgIGNvbnN0IGZyYW1lID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMSAtIGRdO1xuICAgICAgZnJhbWUub3V0Y29tZSA9IGlzQ29udGludWUgPyAnY29udGludWUnIDogJ2JyZWFrJztcbiAgICAgIGZyYW1lLmJvZHlUZXJtaW5hdGVkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICAvKiogQSBtYXktcnVuIGNhbGwgdG8gYSByZWdpc3RlcmVkIGRlZmluaXRpb24gZmlyZXMgcGVyIGl0cyBib2R5J3MgZGVhZCBraW5kLiAqL1xuICBwcml2YXRlIGFwcGx5Q2FsbChuYW1lOiBzdHJpbmcsIGluUGlwZWxpbmU6IGJvb2xlYW4sIGJhY2tncm91bmRlZDogYm9vbGVhbik6IHZvaWQge1xuICAgIGlmICghdGhpcy5kZWZzLmhhcyhuYW1lKSB8fCBiYWNrZ3JvdW5kZWQpIHJldHVybjtcbiAgICBpZiAodGhpcy5kZWZQcm9iZVN0YWNrLmhhcyhuYW1lKSkgcmV0dXJuOyAvLyByZWN1cnNpb246IHRoZSBpbm5lciBjYWxsIHJldHVybnMgbm9ybWFsbHlcbiAgICBjb25zdCBib2R5ID0gdGhpcy5kZWZzLmdldChuYW1lKSE7XG4gICAgdGhpcy5kZWZQcm9iZVN0YWNrLmFkZChuYW1lKTtcbiAgICBjb25zdCBraW5kID0gdGhpcy5kZWZCb2R5RmlyZUtpbmQoYm9keSk7XG4gICAgdGhpcy5kZWZQcm9iZVN0YWNrLmRlbGV0ZShuYW1lKTtcbiAgICBpZiAoa2luZCA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGlmIChraW5kID09PSAnbmV2ZXItcmV0dXJuJykge1xuICAgICAgdGhpcy5kZWFkID0gJ25ldmVyLXJldHVybic7XG4gICAgfSBlbHNlIGlmICghaW5QaXBlbGluZSkge1xuICAgICAgdGhpcy5kZWFkID0ga2luZDtcbiAgICB9XG4gIH1cblxuICAvKiogV2hldGhlciBhIGRlZmluaXRpb24gYm9keSwgd2Fsa2VkIGFzIGl0cyBvd24gZnVuY3Rpb24sIGVuZHMgZGVhZC4gKi9cbiAgcHJpdmF0ZSBkZWZCb2R5RmlyZUtpbmQoYm9keTogc3RyaW5nKTogRGVhZEtpbmQgfCBudWxsIHtcbiAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKGJvZHkpO1xuICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHJldHVybiAnbWFsZm9ybWVkJztcbiAgICBjb25zdCBzYXZlZERlYWQgPSB0aGlzLmRlYWQ7XG4gICAgY29uc3Qgc2F2ZWRSZXR1cm5lZCA9IHRoaXMucmV0dXJuZWQ7XG4gICAgY29uc3Qgc2F2ZWRGbkRlcHRoID0gdGhpcy5mbkRlcHRoO1xuICAgIGNvbnN0IHNhdmVkTG9vcFN0YWNrID0gdGhpcy5sb29wU3RhY2s7XG4gICAgdGhpcy5kZWFkID0gbnVsbDtcbiAgICB0aGlzLnJldHVybmVkID0gZmFsc2U7XG4gICAgdGhpcy5mbkRlcHRoID0gdGhpcy5mbkRlcHRoICsgMTtcbiAgICB0aGlzLmxvb3BTdGFjayA9IFtdO1xuICAgIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZDogdHJ1ZSwgc2lkZUVmZmVjdHM6IHRydWUsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgICBjb25zdCBraW5kID0gdGhpcy5kZWFkO1xuICAgIHRoaXMuZGVhZCA9IHNhdmVkRGVhZDtcbiAgICB0aGlzLnJldHVybmVkID0gc2F2ZWRSZXR1cm5lZDtcbiAgICB0aGlzLmZuRGVwdGggPSBzYXZlZEZuRGVwdGg7XG4gICAgdGhpcy5sb29wU3RhY2sgPSBzYXZlZExvb3BTdGFjaztcbiAgICByZXR1cm4ga2luZDtcbiAgfVxuXG4gIHByaXZhdGUga25vd25TdGF0dXMoYXJndjogc3RyaW5nW10gfCBudWxsKTogQ2hhaW5TdGF0dXMge1xuICAgIGlmIChhcmd2ID09PSBudWxsIHx8IGFyZ3YubGVuZ3RoID09PSAwKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgIC8vIFJlZGlyZWN0cyBhbmQgdHJhbnNwYXJlbnQgd3JhcHBlcnMgYXJlIHN0cmlwcGVkIGJlZm9yZSBzdGF0dXMgZXZhbHVhdGlvblxuICAgIC8vIChwbGFuIFx1MDBBNzQvXHUwMEE3NSk6IGBlbnYgRk9PPTEgdHJ1ZWAgYW5kIGB0aW1lb3V0IDUgdHJ1ZWAgYXJlIGtub3duIHN1Y2Nlc3NlcyxcbiAgICAvLyBgdHJ1ZSA+IG91dGAga2VlcHMgaXRzIHN1Y2Nlc3MsIGFuZCBhIGZhaWwtY2xvc2VkIHdyYXBwZXIgKGBlbnYgLWkgXHUyMDI2YClcbiAgICAvLyBzdGF5cyB1bmtub3duLlxuICAgIGNvbnN0IGEgPSB3YWxrU3RyaXAoc3RyaXBXcmFwcGVycyhzdHJpcFJlZGlyZWN0cyhhcmd2KSkpO1xuICAgIGlmIChhLmxlbmd0aCA9PT0gMCkgcmV0dXJuICdzdWNjZXNzJztcbiAgICBpZiAoYVswXSA9PT0gJ3RydWUnIHx8IGFbMF0gPT09ICc6JykgcmV0dXJuICdzdWNjZXNzJztcbiAgICBpZiAoYVswXSA9PT0gJ2ZhbHNlJykgcmV0dXJuICdmYWlsdXJlJztcbiAgICBpZiAoYS5ldmVyeSgodykgPT4gQVNTSUdOTUVOVF9SRS50ZXN0KHcpKSkgcmV0dXJuICdzdWNjZXNzJztcbiAgICBpZiAoYVswXSA9PT0gJ2V4cG9ydCcgJiYgYS5sZW5ndGggPiAxICYmIGEuc2xpY2UoMSkuZXZlcnkoKHcpID0+IEFTU0lHTk1FTlRfUkUudGVzdCh3KSkpIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgaWYgKGFbMF0gPT09ICdzZXQnKSByZXR1cm4gc2V0RmxhZ3NLbm93bihhLnNsaWNlKDEpKSA/ICdzdWNjZXNzJyA6ICd1bmtub3duJztcbiAgICByZXR1cm4gJ3Vua25vd24nO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseVNpZGVFZmZlY3RzKG1lbWJlcjogU2ltcGxlQ29tbWFuZCwgYXJndjogc3RyaW5nW10gfCBudWxsLCBzdHJpcHBlZDogc3RyaW5nW10gfCBudWxsKTogdm9pZCB7XG4gICAgaWYgKGFyZ3YgPT09IG51bGwgfHwgYXJndi5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICAvLyBBc3NpZ25tZW50IHJlY29yZGluZyAobGFzdCBkZWZpbml0aW9uIHdpbnMsIGZlZWRpbmcgY2FzZSBzdWJqZWN0cykuXG4gICAgY29uc3Qgd29yZHMgPSBzcGxpdFdvcmRzKG1lbWJlci50ZXh0KTtcbiAgICBpZiAod29yZHMgIT09IG51bGwgJiYgd29yZHMubGVuZ3RoID4gMCkge1xuICAgICAgbGV0IGsgPSAwO1xuICAgICAgd2hpbGUgKGsgPCB3b3Jkcy5sZW5ndGggJiYgQVNTSUdOTUVOVF9SRS50ZXN0KHdvcmRzW2tdKSkgaysrO1xuICAgICAgaWYgKGsgPT09IHdvcmRzLmxlbmd0aCkge1xuICAgICAgICBmb3IgKGNvbnN0IHcgb2Ygd29yZHMpIHtcbiAgICAgICAgICBjb25zdCBlcSA9IHcuaW5kZXhPZignPScpO1xuICAgICAgICAgIHRoaXMuYXNzaWdubWVudHMuc2V0KHcuc2xpY2UoMCwgZXEpLCB3LnNsaWNlKGVxICsgMSkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHdvcmRzWzBdID09PSAnZXhwb3J0Jykge1xuICAgICAgICBmb3IgKGNvbnN0IHcgb2Ygd29yZHMuc2xpY2UoMSkpIHtcbiAgICAgICAgICBpZiAoQVNTSUdOTUVOVF9SRS50ZXN0KHcpKSB7XG4gICAgICAgICAgICBjb25zdCBlcSA9IHcuaW5kZXhPZignPScpO1xuICAgICAgICAgICAgdGhpcy5hc3NpZ25tZW50cy5zZXQody5zbGljZSgwLCBlcSksIHcuc2xpY2UoZXEgKyAxKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChzdHJpcHBlZCAhPT0gbnVsbCAmJiBzdHJpcHBlZFswXSA9PT0gJ3NldCcpIHRoaXMuYXBwbHlTZXRGbGFncyhzdHJpcHBlZC5zbGljZSgxKSk7XG4gICAgLy8gVGFibGUgbGlmZWN5Y2xlIChwbGFuIFx1MDBBNzcpOiBhbiBleGVjdXRlZCBub24tcGlwZSBgdW5zZXQgTkFNRWAgZGVsZXRlcyB0aGVcbiAgICAvLyBlbnRyeSwgc28gYFg9L2E7IHVuc2V0IFg7IGNhdCAkWC9mYCBzdGF5cyB1bnJlc29sdmVkIGluc3RlYWQgb2ZcbiAgICAvLyByZXN1cnJlY3RpbmcgdGhlIHN0YWxlIHZhbHVlLiBgZXhwb3J0IE5BTUVgIHdpdGhvdXQgYSB2YWx1ZSBpcyBhIG5vLW9wXG4gICAgLy8gZm9yIHRoZSB0YWJsZSAoYmFzaCBrZWVwcyB0aGUgdmFsdWUsIGp1c3QgbWFya3MgaXQgZXhwb3J0ZWQpLlxuICAgIGlmIChzdHJpcHBlZCAhPT0gbnVsbCAmJiBzdHJpcHBlZFswXSA9PT0gJ3Vuc2V0Jykge1xuICAgICAgZm9yIChjb25zdCB3IG9mIHN0cmlwcGVkLnNsaWNlKDEpKSB7XG4gICAgICAgIGlmICghdy5zdGFydHNXaXRoKCctJykpIHRoaXMuYXNzaWdubWVudHMuZGVsZXRlKHcpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlTZXRGbGFncyhhcmdzOiBzdHJpbmdbXSk6IHZvaWQge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgICBpZiAoYSA9PT0gJy0tJykgY29udGludWU7XG4gICAgICBpZiAoIShhLnN0YXJ0c1dpdGgoJy0nKSB8fCBhLnN0YXJ0c1dpdGgoJysnKSkpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgb24gPSBhLnN0YXJ0c1dpdGgoJy0nKTtcbiAgICAgIGNvbnN0IGNoYXJzID0gYS5zbGljZSgxKTtcbiAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgY2hhcnMubGVuZ3RoOyBrKyspIHtcbiAgICAgICAgY29uc3QgYyA9IGNoYXJzW2tdO1xuICAgICAgICBpZiAoYyA9PT0gJ28nKSB7XG4gICAgICAgICAgY29uc3QgbmFtZSA9IGFyZ3NbaSArIDFdO1xuICAgICAgICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQpIHJldHVybjtcbiAgICAgICAgICBpZiAobmFtZSA9PT0gJ2VycmV4aXQnKSB0aGlzLmVycmV4aXQgPSBvbjtcbiAgICAgICAgICBlbHNlIGlmIChuYW1lID09PSAnbm9lcnJleGl0JykgdGhpcy5lcnJleGl0ID0gIW9uO1xuICAgICAgICAgIGVsc2UgaWYgKG5hbWUgPT09ICdwaXBlZmFpbCcpIHRoaXMucGlwZWZhaWwgPSBvbjtcbiAgICAgICAgICBlbHNlIGlmIChuYW1lID09PSAnbm9waXBlZmFpbCcpIHRoaXMucGlwZWZhaWwgPSAhb247XG4gICAgICAgICAgaSsrO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnZScpIHRoaXMuZXJyZXhpdCA9IG9uO1xuICAgICAgICAvLyBFdmVyeSBvdGhlciByZWNvZ25pemVkIGxldHRlciBpcyBhIG5vLW9wIGZvciB0aGUgd2Fsay5cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHByb2Nlc3NDb25zdHJ1Y3QoXG4gICAgbWVtYmVyOiBTaW1wbGVDb21tYW5kLFxuICAgIGtpbmQ6IENvbnN0cnVjdEtpbmQsXG4gICAgY3R4OiB7XG4gICAgICBleGVjOiBFeGVjU3RhdHVzO1xuICAgICAgaW5QaXBlbGluZTogYm9vbGVhbjtcbiAgICAgIGJhY2tncm91bmRlZDogYm9vbGVhbjtcbiAgICAgIG1lbWJlckFyZ3Y6IHN0cmluZ1tdIHwgbnVsbDtcbiAgICAgIG9wdHM6IFdhbGtPcHRpb25zO1xuICAgIH1cbiAgKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IHsgZXhlYywgYmFja2dyb3VuZGVkLCBvcHRzIH0gPSBjdHg7XG4gICAgY29uc3QgZGlzY2FyZCA9IG9wdHMuZGlzY2FyZCB8fCBleGVjICE9PSAneWVzJztcbiAgICBjb25zdCBzaWRlRWZmZWN0cyA9IG9wdHMuc2lkZUVmZmVjdHMgJiYgZXhlYyA9PT0gJ3llcyc7XG5cbiAgICBzd2l0Y2ggKGtpbmQpIHtcbiAgICAgIGNhc2UgJ2lmJzoge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUlmKG1lbWJlci50ZXh0KTtcbiAgICAgICAgaWYgKHBhcnNlZCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgcmVnaW9ucyA9IFtcbiAgICAgICAgICBwYXJzZWQuY29uZGl0aW9uLFxuICAgICAgICAgIHBhcnNlZC50aGVuQm9keSxcbiAgICAgICAgICAuLi5wYXJzZWQuZWxpZnMuZmxhdE1hcCgoZSkgPT4gW2UuY29uZGl0aW9uLCBlLmJvZHldKSxcbiAgICAgICAgICAuLi4ocGFyc2VkLmVsc2VCb2R5ICE9PSBudWxsID8gW3BhcnNlZC5lbHNlQm9keV0gOiBbXSlcbiAgICAgICAgXTtcbiAgICAgICAgY29uc3QgY29uZFN0YXR1cyA9IHRoaXMud2Fsa0xpc3Qoc3BsaXRUb3BMZXZlbChwYXJzZWQuY29uZGl0aW9uKS5zdGFnZXMsIHtcbiAgICAgICAgICBsaXZlbmVzczogZmFsc2UsXG4gICAgICAgICAgZGlzY2FyZDogdHJ1ZSxcbiAgICAgICAgICBzaWRlRWZmZWN0czogdHJ1ZSxcbiAgICAgICAgICBpbnB1dEZhY2luZzogZmFsc2VcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChjb25kU3RhdHVzID09PSAndW5rbm93bicpIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocmVnaW9ucywgY3R4KTtcbiAgICAgICAgaWYgKGNvbmRTdGF0dXMgPT09ICdzdWNjZXNzJykge1xuICAgICAgICAgIHJldHVybiB0aGlzLndhbGtCcmFuY2gocGFyc2VkLnRoZW5Cb2R5LCBkaXNjYXJkLCBzaWRlRWZmZWN0cyk7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBlbGlmIG9mIHBhcnNlZC5lbGlmcykge1xuICAgICAgICAgIGNvbnN0IGVTdGF0dXMgPSB0aGlzLndhbGtMaXN0KHNwbGl0VG9wTGV2ZWwoZWxpZi5jb25kaXRpb24pLnN0YWdlcywge1xuICAgICAgICAgICAgbGl2ZW5lc3M6IGZhbHNlLFxuICAgICAgICAgICAgZGlzY2FyZDogdHJ1ZSxcbiAgICAgICAgICAgIHNpZGVFZmZlY3RzOiB0cnVlLFxuICAgICAgICAgICAgaW5wdXRGYWNpbmc6IGZhbHNlXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaWYgKGVTdGF0dXMgPT09ICd1bmtub3duJykgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChyZWdpb25zLCBjdHgpO1xuICAgICAgICAgIGlmIChlU3RhdHVzID09PSAnc3VjY2VzcycpIHJldHVybiB0aGlzLndhbGtCcmFuY2goZWxpZi5ib2R5LCBkaXNjYXJkLCBzaWRlRWZmZWN0cyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBhcnNlZC5lbHNlQm9keSAhPT0gbnVsbCkgcmV0dXJuIHRoaXMud2Fsa0JyYW5jaChwYXJzZWQuZWxzZUJvZHksIGRpc2NhcmQsIHNpZGVFZmZlY3RzKTtcbiAgICAgICAgcmV0dXJuICdzdWNjZXNzJztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ3doaWxlJzpcbiAgICAgIGNhc2UgJ3VudGlsJzoge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUxvb3AobWVtYmVyLnRleHQsIGtpbmQpO1xuICAgICAgICBpZiAocGFyc2VkID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICBjb25zdCBjb25kU3RhdHVzID0gdGhpcy53YWxrTGlzdChzcGxpdFRvcExldmVsKHBhcnNlZC5jb25kaXRpb24pLnN0YWdlcywge1xuICAgICAgICAgIGxpdmVuZXNzOiBmYWxzZSxcbiAgICAgICAgICBkaXNjYXJkOiB0cnVlLFxuICAgICAgICAgIHNpZGVFZmZlY3RzOiB0cnVlLFxuICAgICAgICAgIGlucHV0RmFjaW5nOiBmYWxzZVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGNvbmRTdGF0dXMgPT09ICd1bmtub3duJykgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChbcGFyc2VkLmNvbmRpdGlvbiwgcGFyc2VkLmJvZHldLCBjdHgpO1xuICAgICAgICBjb25zdCBib2R5UnVucyA9IGtpbmQgPT09ICd3aGlsZScgPyBjb25kU3RhdHVzID09PSAnc3VjY2VzcycgOiBjb25kU3RhdHVzID09PSAnZmFpbHVyZSc7XG4gICAgICAgIGlmICghYm9keVJ1bnMpIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwocGFyc2VkLmJvZHkpO1xuICAgICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBmcmFtZTogTG9vcEZyYW1lID0geyBvdXRjb21lOiAnbm9uZScsIGJvZHlUZXJtaW5hdGVkOiBmYWxzZSwgYW1iaWd1b3VzU3RvcDogZmFsc2UgfTtcbiAgICAgICAgdGhpcy5sb29wU3RhY2sucHVzaChmcmFtZSk7XG4gICAgICAgIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgICAgICAgdGhpcy5sb29wU3RhY2sucG9wKCk7XG4gICAgICAgIHN3aXRjaCAoZnJhbWUub3V0Y29tZSkge1xuICAgICAgICAgIGNhc2UgJ2JyZWFrJzpcbiAgICAgICAgICAgIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICAgICAgY2FzZSAnY29udGludWUnOlxuICAgICAgICAgIGNhc2UgJ25vbmUnOlxuICAgICAgICAgICAgaWYgKHRoaXMuZGVhZCA9PT0gbnVsbCAmJiAhYmFja2dyb3VuZGVkKSB0aGlzLmRlYWQgPSAnbmV2ZXItcmV0dXJuJztcbiAgICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICAgICAgY2FzZSAnYW1iaWd1b3VzJzpcbiAgICAgICAgICBjYXNlICdyZXR1cm4nOlxuICAgICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgfVxuICAgICAgY2FzZSAnZm9yJzoge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUZvcihtZW1iZXIudGV4dCk7XG4gICAgICAgIGlmIChwYXJzZWQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGlmIChwYXJzZWQubGlzdCA9PT0gbnVsbCB8fCBwYXJzZWQubGlzdC5zb21lKCh3KSA9PiAvWyRgXS8udGVzdCh3KSkpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5vcGFxdWVQYXRoKFtwYXJzZWQud2hvbGVJbnRlcmlvcl0sIGN0eCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBhcnNlZC5saXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuICdzdWNjZXNzJztcbiAgICAgICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChwYXJzZWQuYm9keSk7XG4gICAgICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aGlzLmRlYWQgPSAnbWFsZm9ybWVkJztcbiAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQsIHNpZGVFZmZlY3RzLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICB9XG4gICAgICBjYXNlICdjYXNlJzoge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUNhc2UobWVtYmVyLnRleHQpO1xuICAgICAgICBpZiAocGFyc2VkID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICBjb25zdCByZWdpb25zID0gcGFyc2VkLmJyYW5jaGVzLm1hcCgoYikgPT4gYi5ib2R5KTtcbiAgICAgICAgaWYgKHBhcnNlZC5mYWxsdGhyb3VnaCB8fCByZXNvbHZlU3ViamVjdChwYXJzZWQuc3ViamVjdCwgdGhpcy5hc3NpZ25tZW50cykgPT09IG51bGwpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5vcGFxdWVQYXRoKHJlZ2lvbnMsIGN0eCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc3ViamVjdCA9IHJlc29sdmVTdWJqZWN0KHBhcnNlZC5zdWJqZWN0LCB0aGlzLmFzc2lnbm1lbnRzKSE7XG4gICAgICAgIGxldCBtYXRjaGVkQnJhbmNoID0gLTE7XG4gICAgICAgIGxldCB1bmRlY2lkYWJsZSA9IGZhbHNlO1xuICAgICAgICBmb3IgKGxldCBiID0gMDsgYiA8IHBhcnNlZC5icmFuY2hlcy5sZW5ndGg7IGIrKykge1xuICAgICAgICAgIGNvbnN0IHIgPSBldmFsUGF0dGVybihwYXJzZWQuYnJhbmNoZXNbYl0ucGF0dGVybiwgc3ViamVjdCk7XG4gICAgICAgICAgaWYgKHIgPT09ICdtYXRjaCcpIHtcbiAgICAgICAgICAgIG1hdGNoZWRCcmFuY2ggPSBiO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChyID09PSAnZ2xvYicgfHwgciA9PT0gJ3VuZGVjaWRhYmxlJykge1xuICAgICAgICAgICAgdW5kZWNpZGFibGUgPSB0cnVlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICh1bmRlY2lkYWJsZSkgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChyZWdpb25zLCBjdHgpO1xuICAgICAgICBpZiAobWF0Y2hlZEJyYW5jaCAhPT0gLTEpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy53YWxrQnJhbmNoKHBhcnNlZC5icmFuY2hlc1ttYXRjaGVkQnJhbmNoXS5ib2R5LCBkaXNjYXJkLCBzaWRlRWZmZWN0cyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICdzdWNjZXNzJztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ3NlbGVjdCc6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VMb29wKG1lbWJlci50ZXh0LCAnd2hpbGUnKTtcbiAgICAgICAgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChwYXJzZWQgIT09IG51bGwgPyBbcGFyc2VkLmJvZHldIDogW10sIGN0eCk7XG4gICAgICB9XG4gICAgICBjYXNlICdicmFjZSc6IHtcbiAgICAgICAgY29uc3QgaW50ZXJpb3IgPSBleHRyYWN0R3JvdXBCb2R5KG1lbWJlci50ZXh0LCAneycsICd9Jyk7XG4gICAgICAgIGlmIChpbnRlcmlvciA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChpbnRlcmlvcik7XG4gICAgICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aGlzLmRlYWQgPSAnbWFsZm9ybWVkJztcbiAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQsIHNpZGVFZmZlY3RzLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICB9XG4gICAgICBjYXNlICdzdWJzaGVsbCc6IHtcbiAgICAgICAgY29uc3QgaW50ZXJpb3IgPSBleHRyYWN0R3JvdXBCb2R5KG1lbWJlci50ZXh0LCAnKCcsICcpJyk7XG4gICAgICAgIGlmIChpbnRlcmlvciA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChpbnRlcmlvcik7XG4gICAgICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aGlzLmRlYWQgPSAnbWFsZm9ybWVkJztcbiAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNhdmVkRXJyZXhpdCA9IHRoaXMuZXJyZXhpdDtcbiAgICAgICAgY29uc3Qgc2F2ZWRQaXBlZmFpbCA9IHRoaXMucGlwZWZhaWw7XG4gICAgICAgIGNvbnN0IHNhdmVkQXNzaWdubWVudHMgPSB0aGlzLmFzc2lnbm1lbnRzO1xuICAgICAgICBjb25zdCBzYXZlZERlZnMgPSB0aGlzLmRlZnM7XG4gICAgICAgIGNvbnN0IHNhdmVkUmV0dXJuZWQgPSB0aGlzLnJldHVybmVkO1xuICAgICAgICBjb25zdCBzYXZlZEZuRGVwdGggPSB0aGlzLmZuRGVwdGg7XG4gICAgICAgIGNvbnN0IHNhdmVkTG9vcFN0YWNrID0gdGhpcy5sb29wU3RhY2s7XG4gICAgICAgIGNvbnN0IHNhdmVkRGlyRnJhbWUgPSB0aGlzLmRpckZyYW1lO1xuICAgICAgICBjb25zdCBzYXZlZERlYWQgPSB0aGlzLmRlYWQ7XG4gICAgICAgIHRoaXMuZXJyZXhpdCA9IHNhdmVkRXJyZXhpdDtcbiAgICAgICAgdGhpcy5waXBlZmFpbCA9IHNhdmVkUGlwZWZhaWw7XG4gICAgICAgIHRoaXMuYXNzaWdubWVudHMgPSBuZXcgTWFwKHNhdmVkQXNzaWdubWVudHMpO1xuICAgICAgICB0aGlzLmRlZnMgPSBuZXcgTWFwKHNhdmVkRGVmcyk7XG4gICAgICAgIHRoaXMucmV0dXJuZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5mbkRlcHRoID0gMDtcbiAgICAgICAgdGhpcy5sb29wU3RhY2sgPSBbXTtcbiAgICAgICAgdGhpcy5kaXJGcmFtZSA9IHNhdmVkRGlyRnJhbWUgKyAxO1xuICAgICAgICB0aGlzLmRlYWQgPSBudWxsO1xuICAgICAgICBjb25zdCBzdGF0dXMgPSB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQsIHNpZGVFZmZlY3RzLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICAgIGNvbnN0IGlubmVyRGVhZCA9IHRoaXMuZGVhZDtcbiAgICAgICAgdGhpcy5lcnJleGl0ID0gc2F2ZWRFcnJleGl0O1xuICAgICAgICB0aGlzLnBpcGVmYWlsID0gc2F2ZWRQaXBlZmFpbDtcbiAgICAgICAgdGhpcy5hc3NpZ25tZW50cyA9IHNhdmVkQXNzaWdubWVudHM7XG4gICAgICAgIHRoaXMuZGVmcyA9IHNhdmVkRGVmcztcbiAgICAgICAgdGhpcy5yZXR1cm5lZCA9IHNhdmVkUmV0dXJuZWQ7XG4gICAgICAgIHRoaXMuZm5EZXB0aCA9IHNhdmVkRm5EZXB0aDtcbiAgICAgICAgdGhpcy5sb29wU3RhY2sgPSBzYXZlZExvb3BTdGFjaztcbiAgICAgICAgdGhpcy5kaXJGcmFtZSA9IHNhdmVkRGlyRnJhbWU7XG4gICAgICAgIHRoaXMuZGVhZCA9IHNhdmVkRGVhZDtcbiAgICAgICAgLy8gQSBzdWJzaGVsbCBpcyBhIHByb2Nlc3MgYm91bmRhcnkgZm9yIHRoZSBleGl0IGZpcmUgYnV0IG5vdCBmb3IgdGhlXG4gICAgICAgIC8vIG5ldmVyLXJldHVybiBmaXJlOiB0aGUgc2hlbGwgc3luY2hyb25vdXNseSB3YWl0cyBmb3IgdGhlIHN1YnNoZWxsLlxuICAgICAgICBpZiAoaW5uZXJEZWFkID09PSAnbmV2ZXItcmV0dXJuJykgdGhpcy5kZWFkID0gJ25ldmVyLXJldHVybic7XG4gICAgICAgIHJldHVybiBzdGF0dXM7XG4gICAgICB9XG4gICAgICBjYXNlICdkZWYnOiB7XG4gICAgICAgIC8vIFRoZSBkZWZpbml0aW9uIHJlZ2lzdGVycyB3aXRoIHRoZSB3YWxrIHNjb3BlIHdoZW4gZXhlY3V0ZWQuXG4gICAgICAgIGlmIChzaWRlRWZmZWN0cykge1xuICAgICAgICAgIGNvbnN0IGRlZiA9IHBhcnNlRGVmKG1lbWJlci50ZXh0KTtcbiAgICAgICAgICBpZiAoZGVmICE9PSBudWxsKSB0aGlzLmRlZnMuc2V0KGRlZi5uYW1lLCBkZWYuYm9keSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICdzdWNjZXNzJztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuICd1bmtub3duJztcbiAgfVxuXG4gIHByaXZhdGUgd2Fsa0JyYW5jaChib2R5OiBzdHJpbmcsIGRpc2NhcmQ6IGJvb2xlYW4sIHNpZGVFZmZlY3RzOiBib29sZWFuKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwoYm9keSk7XG4gICAgaWYgKHJlcy5tYWxmb3JtZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBvcGFxdWUtY29uc3RydWN0IHRyZWF0bWVudCAocGxhbiBcdTAwQTcyKTogcmUtc3BsaXQgZWFjaCByZWdpb24gYW5kIHdhbGsgaXRcbiAgICogd2l0aCB0aGUgc2FtZSBtYWNoaW5lcnkgc28gYW4gYGV4aXRgL2BleGVjYCB0aGF0IG1heSBoYXZlIHJ1biwgb3IgYVxuICAgKiBuZXZlci1leGl0IGxvb3AsIGZpcmVzIGZhaWwtY2xvc2VkOyBoaWRkZW4gYnJlYWsvY29udGludWUgd29yZHMgcmVhY2ggdGhlXG4gICAqIHNjYW5uZWQgbG9vcCBhcyBhbiBhbWJpZ3VvdXMgdGVybWluYXRpb24uIFN0YXRlIGlzIHNuYXBzaG90LXJlc3RvcmVkLlxuICAgKi9cbiAgcHJpdmF0ZSBvcGFxdWVQYXRoKFxuICAgIHJlZ2lvbnM6IHN0cmluZ1tdLFxuICAgIGN0eDogeyBleGVjOiBFeGVjU3RhdHVzOyBpblBpcGVsaW5lOiBib29sZWFuOyBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW47IG9wdHM6IFdhbGtPcHRpb25zIH1cbiAgKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IGZpbmRpbmdzID0gdGhpcy5zY2FuT3BhcXVlKHJlZ2lvbnMpO1xuICAgIGlmIChmaW5kaW5ncy5maXJlICE9PSBudWxsKSB7XG4gICAgICBpZiAoZmluZGluZ3MuZmlyZSA9PT0gJ25ldmVyLXJldHVybicpIHtcbiAgICAgICAgaWYgKCFjdHguYmFja2dyb3VuZGVkKSB0aGlzLmRlYWQgPSAnbmV2ZXItcmV0dXJuJztcbiAgICAgIH0gZWxzZSBpZiAoIWN0eC5pblBpcGVsaW5lICYmICFjdHguYmFja2dyb3VuZGVkKSB7XG4gICAgICAgIHRoaXMuZGVhZCA9IGZpbmRpbmdzLmZpcmU7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChmaW5kaW5ncy5icmVha1RhcmdldCAhPT0gJ25vbmUnKSB7XG4gICAgICBjb25zdCB0b3AgPSB0aGlzLmxvb3BTdGFja1t0aGlzLmxvb3BTdGFjay5sZW5ndGggLSAxXTtcbiAgICAgIGlmICh0b3AgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0b3Aub3V0Y29tZSA9ICdhbWJpZ3VvdXMnO1xuICAgICAgICB0b3AuYW1iaWd1b3VzU3RvcCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAndW5rbm93bic7XG4gIH1cblxuICBwcml2YXRlIHNjYW5PcGFxdWUocmVnaW9uczogc3RyaW5nW10pOiB7IGZpcmU6IERlYWRLaW5kIHwgbnVsbDsgYnJlYWtUYXJnZXQ6ICdicmVhaycgfCAnY29udGludWUnIHwgJ25vbmUnIH0ge1xuICAgIGNvbnN0IHJlcG9ydDogeyBmaXJlOiBEZWFkS2luZCB8IG51bGw7IGJyZWFrVGFyZ2V0OiAnYnJlYWsnIHwgJ2NvbnRpbnVlJyB8ICdub25lJyB9ID0ge1xuICAgICAgZmlyZTogbnVsbCxcbiAgICAgIGJyZWFrVGFyZ2V0OiAnbm9uZSdcbiAgICB9O1xuICAgIGNvbnN0IHNhdmVkQ2hhaW4gPSB0aGlzLmNoYWluO1xuICAgIGNvbnN0IHNhdmVkRXJyZXhpdCA9IHRoaXMuZXJyZXhpdDtcbiAgICBjb25zdCBzYXZlZFBpcGVmYWlsID0gdGhpcy5waXBlZmFpbDtcbiAgICBjb25zdCBzYXZlZEFzc2lnbm1lbnRzID0gdGhpcy5hc3NpZ25tZW50cztcbiAgICBjb25zdCBzYXZlZERlZnMgPSB0aGlzLmRlZnM7XG4gICAgY29uc3Qgc2F2ZWREZWFkID0gdGhpcy5kZWFkO1xuICAgIGNvbnN0IHNhdmVkUmV0dXJuZWQgPSB0aGlzLnJldHVybmVkO1xuICAgIGNvbnN0IHNhdmVkRm5EZXB0aCA9IHRoaXMuZm5EZXB0aDtcbiAgICBjb25zdCBzYXZlZExvb3BTdGFjayA9IHRoaXMubG9vcFN0YWNrO1xuICAgIGNvbnN0IHNhdmVkRGlyRnJhbWUgPSB0aGlzLmRpckZyYW1lO1xuICAgIGNvbnN0IHNhdmVkVmVyZGljdHMgPSB0aGlzLnZlcmRpY3RzLmxlbmd0aDtcbiAgICBjb25zdCBzYXZlZEV4cGFuZGVkID0gdGhpcy5leHBhbmRlZC5sZW5ndGg7XG4gICAgY29uc3Qgc2F2ZWREZWZQcm9iZSA9IG5ldyBTZXQodGhpcy5kZWZQcm9iZVN0YWNrKTtcblxuICAgIGZvciAoY29uc3QgcmVnaW9uIG9mIHJlZ2lvbnMpIHtcbiAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwocmVnaW9uKTtcbiAgICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmVwb3J0LmZpcmUgPSAnbWFsZm9ybWVkJztcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICB0aGlzLmRlYWQgPSBudWxsO1xuICAgICAgdGhpcy5yZXR1cm5lZCA9IGZhbHNlO1xuICAgICAgLy8gRWFjaCByZWdpb24gd2Fsa3MgYWdhaW5zdCBhIGZyZXNoIGNvcHkgb2YgdGhlIGVuY2xvc2luZyBsb29wIGZyYW1lcyBzb1xuICAgICAgLy8gaXRzIGhpZGRlbiBicmVhay9jb250aW51ZSBldmVudHMgYXJlIHJlcG9ydGVkLCBuZXZlciBhcHBsaWVkLlxuICAgICAgdGhpcy5sb29wU3RhY2sgPSBzYXZlZExvb3BTdGFjay5tYXAoKGYpID0+ICh7IC4uLmYgfSkpO1xuICAgICAgdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkOiB0cnVlLCBzaWRlRWZmZWN0czogZmFsc2UsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgICAgIGlmICh0aGlzLmRlYWQgIT09IG51bGwpIHtcbiAgICAgICAgaWYgKHJlcG9ydC5maXJlID09PSBudWxsIHx8IHRoaXMuZGVhZCA9PT0gJ25ldmVyLXJldHVybicgfHwgdGhpcy5kZWFkID09PSAnbWFsZm9ybWVkJykgcmVwb3J0LmZpcmUgPSB0aGlzLmRlYWQ7XG4gICAgICB9XG4gICAgICBpZiAocmVwb3J0LmJyZWFrVGFyZ2V0ID09PSAnbm9uZScpIHtcbiAgICAgICAgY29uc3QgaW5uZXJtb3N0ID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMV07XG4gICAgICAgIGlmIChpbm5lcm1vc3QgIT09IHVuZGVmaW5lZCAmJiAoaW5uZXJtb3N0Lm91dGNvbWUgPT09ICdicmVhaycgfHwgaW5uZXJtb3N0Lm91dGNvbWUgPT09ICdjb250aW51ZScpKSB7XG4gICAgICAgICAgcmVwb3J0LmJyZWFrVGFyZ2V0ID0gaW5uZXJtb3N0Lm91dGNvbWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmNoYWluID0gc2F2ZWRDaGFpbjtcbiAgICB0aGlzLmVycmV4aXQgPSBzYXZlZEVycmV4aXQ7XG4gICAgdGhpcy5waXBlZmFpbCA9IHNhdmVkUGlwZWZhaWw7XG4gICAgdGhpcy5hc3NpZ25tZW50cyA9IHNhdmVkQXNzaWdubWVudHM7XG4gICAgdGhpcy5kZWZzID0gc2F2ZWREZWZzO1xuICAgIHRoaXMuZGVhZCA9IHNhdmVkRGVhZDtcbiAgICB0aGlzLnJldHVybmVkID0gc2F2ZWRSZXR1cm5lZDtcbiAgICB0aGlzLmZuRGVwdGggPSBzYXZlZEZuRGVwdGg7XG4gICAgdGhpcy5sb29wU3RhY2sgPSBzYXZlZExvb3BTdGFjaztcbiAgICB0aGlzLmRpckZyYW1lID0gc2F2ZWREaXJGcmFtZTtcbiAgICB0aGlzLnZlcmRpY3RzLmxlbmd0aCA9IHNhdmVkVmVyZGljdHM7XG4gICAgdGhpcy5leHBhbmRlZC5sZW5ndGggPSBzYXZlZEV4cGFuZGVkO1xuICAgIHRoaXMuZGVmUHJvYmVTdGFjay5jbGVhcigpO1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiBzYXZlZERlZlByb2JlKSB0aGlzLmRlZlByb2JlU3RhY2suYWRkKG5hbWUpO1xuICAgIHJldHVybiByZXBvcnQ7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lLXJhbmdlIHNwZWNzOiB3aGF0IGEgbWF0Y2hlZCBpZGlvbSBzYXlzIGFib3V0IHRoZSByYW5nZSwgYmVmb3JlIHdlIGtub3dcbi8vIHdoZXRoZXIgcmVzb2x2aW5nIGl0IG5lZWRzIHRvIGNvbnN1bHQgYSByZWFsIGZpbGUvZ2l0IGJsb2IuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudHlwZSBMaW5lUmFuZ2VTcGVjID1cbiAgfCB7IGtpbmQ6ICdsaXRlcmFsJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnOyBlbmQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndG9Fb2YnOyBzdGFydDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICdsYXN0TkxpbmVzJzsgY291bnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnYXBwZW5kTGluZXMnOyBjb3VudDogbnVtYmVyIH07XG5cbmZ1bmN0aW9uIHJlc29sdmVTcGVjKFxuICBzcGVjOiBMaW5lUmFuZ2VTcGVjLFxuICB0b3RhbExpbmVzOiAoKSA9PiBudW1iZXIgfCBudWxsXG4pOiB7IGxpbmVTdGFydDogbnVtYmVyOyBsaW5lRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBzd2l0Y2ggKHNwZWMua2luZCkge1xuICAgIGNhc2UgJ2xpdGVyYWwnOlxuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBzcGVjLmVuZCB9O1xuICAgIGNhc2UgJ3VwcGVyQm91bmRGcm9tU3RhcnQnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogMSwgbGluZUVuZDogdG90YWwgIT09IG51bGwgPyBNYXRoLm1pbihzcGVjLmVuZCwgdG90YWwpIDogc3BlYy5lbmQgfTtcbiAgICB9XG4gICAgY2FzZSAndG9Fb2YnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCB8fCB0b3RhbCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHNwZWMuc3RhcnQsIGxpbmVFbmQ6IE1hdGgubWF4KHNwZWMuc3RhcnQsIHRvdGFsKSB9O1xuICAgIH1cbiAgICBjYXNlICdsYXN0TkxpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBNYXRoLm1heCgxLCB0b3RhbCAtIHNwZWMuY291bnQgKyAxKSwgbGluZUVuZDogdG90YWwgfTtcbiAgICB9XG4gICAgY2FzZSAnYXBwZW5kTGluZXMnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKSA/PyAwO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiB0b3RhbCArIDEsIGxpbmVFbmQ6IHRvdGFsICsgc3BlYy5jb3VudCB9O1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBoYXNTaGVsbEV4cGFuc2lvbihzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9bJGBdLy50ZXN0KHMpO1xufVxuXG5mdW5jdGlvbiBsb29rc1VucmVzb2x2YWJsZShzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGhhc1NoZWxsRXhwYW5zaW9uKHMpIHx8IC9bKj9dLy50ZXN0KHMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIElkaW9tIG1hdGNoZXJzOiBwdXJlIGZ1bmN0aW9ucyBvdmVyIG9uZSBzaW1wbGUgY29tbWFuZCdzIGFyZ3YuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFJhd0NhbmRpZGF0ZSB7XG4gIGtpbmQ6ICdjYW5kaWRhdGUnO1xuICBpZGlvbTogSWRpb207XG4gIGZpbGVBcmc6IHN0cmluZztcbiAgc3BlYzogTGluZVJhbmdlU3BlYztcbiAgcmVzb2x2ZXJLaW5kOiAnZnMnIHwgeyBraW5kOiAnZ2l0JzsgcmV2OiBzdHJpbmcgfTtcbiAgZGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG59XG5pbnRlcmZhY2UgUmF3VW5yZXNvbHZlZCB7XG4gIGtpbmQ6ICd1bnJlc29sdmVkJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHJlYXNvbjogc3RyaW5nO1xufVxudHlwZSBNYXRjaFJlc3VsdCA9IFJhd0NhbmRpZGF0ZSB8IFJhd1VucmVzb2x2ZWQ7XG5cbmNvbnN0IFNFRF9SQU5HRSA9IC9eKFxcZCspKD86LChcXGQrfFxcJCkpP3AkLztcblxuLyoqIFNwbGl0IGEgYHNlZGAgc2NyaXB0IGFyZ3VtZW50IGludG8gaXRzIGA7YC1zZXBhcmF0ZWQgc2VnbWVudHMuICovXG5mdW5jdGlvbiBzZWRTY3JpcHRTZWdtZW50cyhzY3JpcHQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHNjcmlwdC5zcGxpdCgnOycpO1xufVxuXG5mdW5jdGlvbiBtYXRjaFNlZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3NlZCcpIHJldHVybiBbXTtcbiAgY29uc3QgcmVzdCA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmICghcmVzdC5pbmNsdWRlcygnLW4nKSkgcmV0dXJuIFtdO1xuICBsZXQgc2NyaXB0SWR4ID0gLTE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgIGlmIChyZXN0W2ldID09PSAnLW4nKSBjb250aW51ZTtcbiAgICBpZiAoc2VkU2NyaXB0U2VnbWVudHMocmVzdFtpXSkuc29tZSgoc2VnKSA9PiBTRURfUkFOR0UudGVzdChzZWcpKSkge1xuICAgICAgc2NyaXB0SWR4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBpZiAoc2NyaXB0SWR4ID09PSAtMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQ2FuZGlkYXRlcyA9IHJlc3QuZmlsdGVyKChhLCBpKSA9PiBpICE9PSBzY3JpcHRJZHggJiYgYSAhPT0gJy1uJyAmJiAhYS5zdGFydHNXaXRoKCctJykpO1xuICBpZiAoZmlsZUNhbmRpZGF0ZXMubGVuZ3RoICE9PSAxKSByZXR1cm4gW107XG4gIGNvbnN0IGZpbGVBcmcgPSBmaWxlQ2FuZGlkYXRlc1swXTtcbiAgY29uc3QgcmVzdWx0czogTWF0Y2hSZXN1bHRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VkU2NyaXB0U2VnbWVudHMocmVzdFtzY3JpcHRJZHhdKSkge1xuICAgIGNvbnN0IG1hdGNoID0gc2VnbWVudC5tYXRjaChTRURfUkFOR0UpO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gICAgY29uc3QgZW5kVG9rZW4gPSBtYXRjaFsyXTtcbiAgICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID1cbiAgICAgIGVuZFRva2VuID09PSB1bmRlZmluZWRcbiAgICAgICAgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQsIGVuZDogc3RhcnQgfVxuICAgICAgICA6IGVuZFRva2VuID09PSAnJCdcbiAgICAgICAgICA/IHsga2luZDogJ3RvRW9mJywgc3RhcnQgfVxuICAgICAgICAgIDogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IE51bWJlci5wYXJzZUludChlbmRUb2tlbiwgMTApIH07XG4gICAgcmVzdWx0cy5wdXNoKHsga2luZDogJ2NhbmRpZGF0ZScsIGlkaW9tOiAnc2VkLW4tcmFuZ2UnLCBmaWxlQXJnLCBzcGVjLCByZXNvbHZlcktpbmQ6ICdmcycgfSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbi8qKlxuICogUGFyc2UgYGhlYWRgL2B0YWlsYCBmbGFncyBhbmQgZmlsZSBhcmdzLiBBIGJhcmUgYCtOYCBpcyBhIGZyb20tTiBjb3VudCBvbmx5XG4gKiBmb3IgYHRhaWxgIChgdGFpbCArNSBmYCBzdGFydHMgYXQgbGluZSA1KTsgR05VIGBoZWFkYCB0cmVhdHMgYmFyZSBgK05gIGFzIGFcbiAqICpmaWxlKiAoY29yZXV0aWxzIDkuNyBcdTIwMTQgcHJvYmU6IGBoZWFkICs1IGZgIGVycm9ycyBcImNhbm5vdCBvcGVuICcrNSdcIiBhbmRcbiAqIHJlYWRzIGYncyBmaXJzdCAxMCBsaW5lcyksIHNvIGBiYXJlUGx1c0lzQ291bnRgIGlzIGZhbHNlIGZvciBoZWFkIGFuZCB0aGVcbiAqIHdvcmQgZmFsbHMgdGhyb3VnaCB0byB0aGUgZmlsZSBsaXN0LlxuICovXG5mdW5jdGlvbiBwYXJzZUhlYWRUYWlsRmxhZ3MoXG4gIHJlc3Q6IHN0cmluZ1tdLFxuICBiYXJlUGx1c0lzQ291bnQ6IGJvb2xlYW5cbik6IHtcbiAgY291bnQ6IG51bWJlciB8IG51bGw7XG4gIGZyb21TdGFydDogYm9vbGVhbjtcbiAgZGlzcXVhbGlmaWVkOiBib29sZWFuO1xuICBmaWxlczogc3RyaW5nW107XG59IHtcbiAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjb3VudDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCBmcm9tU3RhcnQgPSBmYWxzZTtcbiAgbGV0IGRpc3F1YWxpZmllZCA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gcmVzdFtpXTtcbiAgICBpZiAoYSA9PT0gJy1mJyB8fCBhID09PSAnLUYnIHx8IGEgPT09ICctLWZvbGxvdycgfHwgYS5zdGFydHNXaXRoKCctLWZvbGxvdz0nKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy16JyB8fCBhID09PSAnLS16ZXJvLXRlcm1pbmF0ZWQnKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnIHx8IGEgPT09ICctLWJ5dGVzJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14oLWN8LS1ieXRlcz0pLy50ZXN0KGEpKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXEnIHx8IGEgPT09ICctdicgfHwgYSA9PT0gJy0tcXVpZXQnIHx8IGEgPT09ICctLXNpbGVudCcgfHwgYSA9PT0gJy0tdmVyYm9zZScpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLW4nKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFwrP1xcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tbGluZXM9JykpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKCctLWxpbmVzPScubGVuZ3RoKTtcbiAgICAgIGlmICgvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLW5cXCs/XFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKDIpO1xuICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL15cXCtcXGQrJC8udGVzdChhKSkge1xuICAgICAgaWYgKGJhcmVQbHVzSXNDb3VudCkge1xuICAgICAgICBmcm9tU3RhcnQgPSB0cnVlO1xuICAgICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1cXGQrJC8udGVzdChhKSkge1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgxKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLScpIHtcbiAgICAgIGZpbGVzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICBmaWxlcy5wdXNoKGEpO1xuICB9XG4gIHJldHVybiB7IGNvdW50LCBmcm9tU3RhcnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hIZWFkKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnaGVhZCcpIHJldHVybiBbXTtcbiAgY29uc3QgeyBjb3VudCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSksIGZhbHNlKTtcbiAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIFtdO1xuICAvLyBCYXJlIGArTmAgaXMgYSBHTlUtaGVhZCBmaWxlIGFydGlmYWN0LCBuZXZlciBhIHJlYWwgcmVhZCBcdTIwMTQgZHJvcCBpdC5cbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScgJiYgIS9eXFwrXFxkKyQvLnRlc3QoZikpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAnaGVhZC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWM6IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnLCBlbmQ6IG4gfSBhcyBMaW5lUmFuZ2VTcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoVGFpbChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3RhaWwnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSksIHRydWUpO1xuICBpZiAoZGlzcXVhbGlmaWVkKSByZXR1cm4gW107XG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID0gZnJvbVN0YXJ0ID8geyBraW5kOiAndG9Fb2YnLCBzdGFydDogbiB9IDogeyBraW5kOiAnbGFzdE5MaW5lcycsIGNvdW50OiBuIH07XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAndGFpbC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gZmluZEdpdFN1YmNvbW1hbmQoXG4gIHJlc3Q6IHN0cmluZ1tdXG4pOiB7IHN1YklkeDogbnVtYmVyOyBzdWJjb21tYW5kOiBzdHJpbmc7IGNEaXI6IHN0cmluZyB8IG51bGw7IGNEaXJVbnJlc29sdmFibGU6IGJvb2xlYW4gfSB8IG51bGwge1xuICBsZXQgY0Rpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBjRGlyVW5yZXNvbHZhYmxlID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCByZXN0Lmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSByZXN0W2ldO1xuICAgIGlmIChhID09PSAnLUMnKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGlmIChoYXNTaGVsbEV4cGFuc2lvbih2KSkgY0RpclVucmVzb2x2YWJsZSA9IHRydWU7XG4gICAgICBlbHNlIGNEaXIgPSB2O1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSB7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcmV0dXJuIHsgc3ViSWR4OiBpLCBzdWJjb21tYW5kOiBhLCBjRGlyLCBjRGlyVW5yZXNvbHZhYmxlIH07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmNvbnN0IFJFVl9QQVRIID0gL14oW15cXHM6XSspOiguKykkLztcblxuZnVuY3Rpb24gbWF0Y2hHaXRTaG93KGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdzaG93JykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3ZcbiAgICAuc2xpY2UoMSlcbiAgICAuc2xpY2Uoc3ViLnN1YklkeCArIDEpXG4gICAgLmZpbHRlcigoYSkgPT4gIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgY29uc3QgcmV2UGF0aEFyZyA9IGFmdGVyLmZpbmQoKGEpID0+IFJFVl9QQVRILnRlc3QoYSkpO1xuICBpZiAoIXJldlBhdGhBcmcpIHJldHVybiBbXTtcbiAgY29uc3QgbSA9IHJldlBhdGhBcmcubWF0Y2goUkVWX1BBVEgpO1xuICBpZiAoIW0pIHJldHVybiBbXTtcbiAgY29uc3QgWywgcmV2LCBwYXRoXSA9IG07XG4gIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSB8fCBoYXNTaGVsbEV4cGFuc2lvbihyZXYpKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBvciByZXZpc2lvbiBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtcbiAgICB7XG4gICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgIHNwZWM6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSxcbiAgICAgIHJlc29sdmVyS2luZDogeyBraW5kOiAnZ2l0JywgcmV2IH0sXG4gICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgfVxuICBdO1xufVxuXG5mdW5jdGlvbiBtYXRjaEdpdExvZ0woYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2xvZycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhZnRlci5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhZnRlcltpXTtcbiAgICBsZXQgc3BlYzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGEgPT09ICctTCcpIHNwZWMgPSBhZnRlcltpICsgMV0gPz8gbnVsbDtcbiAgICBlbHNlIGlmIChhLnN0YXJ0c1dpdGgoJy1MJykpIHNwZWMgPSBhLnNsaWNlKDIpO1xuICAgIGlmICghc3BlYykgY29udGludWU7XG4gICAgY29uc3QgbSA9IHNwZWMubWF0Y2goL14oXFxkKyksKFxcZCspOiguKykkLyk7XG4gICAgaWYgKCFtKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBzLCBlLCBwYXRoXSA9IG07XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICB7XG4gICAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgICAgfVxuICAgICAgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgc3BlYzogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0OiBOdW1iZXIucGFyc2VJbnQocywgMTApLCBlbmQ6IE51bWJlci5wYXJzZUludChlLCAxMCkgfSxcbiAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnLFxuICAgICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW107XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVyZWRvYyB3cml0ZXMgKGBjYXQgPiBmaWxlIDw8RU9GIC4uLiBFT0ZgKTogaGFuZGxlZCBhcyBhIGRlZGljYXRlZCByYXctdGV4dFxuLy8gcGFzcyBiZWNhdXNlIHRoZSBib2R5IGNhbiBpdHNlbGYgY29udGFpbiAmJi87L3wvbmV3bGluZXMgdGhhdCB3b3VsZFxuLy8gb3RoZXJ3aXNlIGNvbmZ1c2Ugc3BsaXRUb3BMZXZlbC4gTWF0Y2hlZCBzcGFucyBhcmUgbWFza2VkIG91dCBvZiB0aGUgc3RyaW5nXG4vLyAocmVwbGFjZWQgd2l0aCBhbiBpbmRleGVkIHBsYWNlaG9sZGVyIHNpbXBsZS1jb21tYW5kKSBiZWZvcmUgdGhlIHJlc3Qgb2Zcbi8vIHRoZSBwaXBlbGluZSBydW5zLCBhbmQgcmUtYXNzb2NpYXRlZCBieSBpbmRleCBkdXJpbmcgdGhlIG1haW4gd2FsayBzbyB0aGVcbi8vIHdyaXRlIGlzIHJlc29sdmVkIGFnYWluc3QgdGhlIGNvcnJlY3QgYGNkYC10cmFja2VkIGRpcmVjdG9yeS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgSGVyZWRvY1dyaXRlIHtcbiAgcmVkaXJlY3Q6ICc+JyB8ICc+Pic7XG4gIHRhcmdldDogc3RyaW5nO1xuICBib2R5OiBzdHJpbmc7XG59XG5cbmNvbnN0IEhFUkVET0NfT1BFTiA9XG4gIC9cXGJjYXRbIFxcdF0rKD57MSwyfSlbIFxcdF0qKFxcUyspWyBcXHRdKjw8KC0/KVsgXFx0XSooPzonKFteJ10qKSd8XCIoW15cIl0qKVwifChbQS1aYS16X11bQS1aYS16MC05X10qKSkvZztcblxuZnVuY3Rpb24gZXNjYXBlUmVnRXhwKHM6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RIZXJlZG9jV3JpdGVzKHJhdzogc3RyaW5nKTogeyB3cml0ZXM6IEhlcmVkb2NXcml0ZVtdOyBtYXNrZWQ6IHN0cmluZyB9IHtcbiAgY29uc3Qgd3JpdGVzOiBIZXJlZG9jV3JpdGVbXSA9IFtdO1xuICBsZXQgbWFza2VkID0gJyc7XG4gIGxldCBjdXJzb3IgPSAwO1xuICBIRVJFRE9DX09QRU4ubGFzdEluZGV4ID0gMDtcbiAgbGV0IG9wZW5NYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbCA9IEhFUkVET0NfT1BFTi5leGVjKHJhdyk7XG4gIHdoaWxlIChvcGVuTWF0Y2ggIT09IG51bGwpIHtcbiAgICBjb25zdCBbLCByZWRpcmVjdCwgdGFyZ2V0LCBkYXNoLCBkcTEsIGRxMiwgYmFyZV0gPSBvcGVuTWF0Y2g7XG4gICAgY29uc3QgZGVsaW0gPSBkcTEgPz8gZHEyID8/IGJhcmU7XG4gICAgY29uc3Qgb3BlbkVuZCA9IG9wZW5NYXRjaC5pbmRleCArIG9wZW5NYXRjaFswXS5sZW5ndGg7XG4gICAgaWYgKCFkZWxpbSB8fCBvcGVuTWF0Y2guaW5kZXggPCBjdXJzb3IpIHtcbiAgICAgIEhFUkVET0NfT1BFTi5sYXN0SW5kZXggPSBvcGVuTWF0Y2guaW5kZXggKyAxO1xuICAgICAgb3Blbk1hdGNoID0gSEVSRURPQ19PUEVOLmV4ZWMocmF3KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUaGUgYm9keSByZWdpb24gc3RhcnRzIHJpZ2h0IGFmdGVyIHRoZSBkZWxpbWl0ZXIgbGluZSdzIG5ld2xpbmUuIEFuXG4gICAgLy8gYWJzZW50IG5ld2xpbmUgKGlucHV0IGVuZHMgYXQgdGhlIGRlbGltaXRlciwgb3IgYCYmYC9gO2AgY29udGludWVzIHRoZVxuICAgIC8vIGxpbmUpIGlzIGEgc2FtZS1saW5lIHVudGVybWluYXRlZCBoZXJlZG9jIHdpdGggYW4gZW1wdHkgYm9keSBcdTIwMTQgdGhlIGA+YFxuICAgIC8vIHJlZGlyZWN0IHN0aWxsIHRydW5jYXRlcyB0aGUgZmlsZSwgYW5kIHRoZSBjb250aW51YXRpb24gc3RheXMgY29tbWFuZHMuXG4gICAgY29uc3QgbmwgPSByYXcuc2xpY2Uob3BlbkVuZCkubWF0Y2goL15bIFxcdF0qXFxyP1xcbi8pO1xuICAgIGNvbnN0IGJvZHlTdGFydCA9IG5sICE9PSBudWxsID8gb3BlbkVuZCArIG5sWzBdLmxlbmd0aCA6IG9wZW5FbmQ7XG4gICAgY29uc3QgcmVtYWluZGVyID0gcmF3LnNsaWNlKGJvZHlTdGFydCk7XG4gICAgY29uc3QgY2xvc2VSZSA9IG5ldyBSZWdFeHAoYF4ke2Rhc2ggPyAnXFxcXHQqJyA6ICcnfSR7ZXNjYXBlUmVnRXhwKGRlbGltKX1bIFxcXFx0XSokYCwgJ20nKTtcbiAgICBjb25zdCBjbG9zZU1hdGNoID0gY2xvc2VSZS5leGVjKHJlbWFpbmRlcik7XG4gICAgbGV0IGJvZHk6IHN0cmluZztcbiAgICBsZXQgbWF0Y2hFbmQ6IG51bWJlcjtcbiAgICBpZiAoY2xvc2VNYXRjaCkge1xuICAgICAgYm9keSA9IHJlbWFpbmRlci5zbGljZSgwLCBjbG9zZU1hdGNoLmluZGV4KS5yZXBsYWNlKC9cXG4kLywgJycpO1xuICAgICAgbWF0Y2hFbmQgPSBib2R5U3RhcnQgKyBjbG9zZU1hdGNoLmluZGV4ICsgY2xvc2VNYXRjaFswXS5sZW5ndGg7XG4gICAgfSBlbHNlIGlmIChubCA9PT0gbnVsbCkge1xuICAgICAgYm9keSA9ICcnO1xuICAgICAgbWF0Y2hFbmQgPSBvcGVuRW5kO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBVbnRlcm1pbmF0ZWQgd2l0aCBhIGJvZHkgcmVnaW9uOiB0aGUgZGF0YSByZWdpb24gcnVucyB0byBFT0YuXG4gICAgICBib2R5ID0gcmVtYWluZGVyLnJlcGxhY2UoL1xcbiQvLCAnJyk7XG4gICAgICBtYXRjaEVuZCA9IHJhdy5sZW5ndGg7XG4gICAgfVxuXG4gICAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IsIG9wZW5NYXRjaC5pbmRleCk7XG4gICAgbWFza2VkICs9IGBfX2hlcmVkb2NfJHt3cml0ZXMubGVuZ3RofV9fYDtcbiAgICBjdXJzb3IgPSBtYXRjaEVuZDtcbiAgICB3cml0ZXMucHVzaCh7IHJlZGlyZWN0OiByZWRpcmVjdCBhcyAnPicgfCAnPj4nLCB0YXJnZXQsIGJvZHkgfSk7XG5cbiAgICBIRVJFRE9DX09QRU4ubGFzdEluZGV4ID0gbWF0Y2hFbmQ7XG4gICAgb3Blbk1hdGNoID0gSEVSRURPQ19PUEVOLmV4ZWMocmF3KTtcbiAgfVxuICBtYXNrZWQgKz0gcmF3LnNsaWNlKGN1cnNvcik7XG4gIHJldHVybiB7IHdyaXRlcywgbWFza2VkIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gV2luZG93IGFsZ2VicmEgKHBsYW4gXHUwMEE3Myk6IHNvdXJjZSBhbmFseXNpcyBhbmQgc3RkaW4tc2VsZWN0b3IgY2xhc3NpZmljYXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogYG5sYCdzIGFyZy10YWtpbmcgZmxhZ3MgXHUyMDE0IGVhY2ggY29uc3VtZXMgdGhlIGZvbGxvd2luZyB3b3JkIChwbGFuIFx1MDBBNzMpLiAqL1xuY29uc3QgTkxfQVJHX0ZMQUdTID0gbmV3IFNldChbJy1iJywgJy1pJywgJy1sJywgJy1zJywgJy12JywgJy13J10pO1xuXG4vKiogU3Rkb3V0LWZvcm0gcmVkaXJlY3Qgb3BlcmF0b3JzIG9uIHRoZSBwcmUtc3RyaXAgYXJndiAocGxhbiBcdTAwQTczIHNldmVyYW5jZSk6IGA+YCwgYD4+YCwgYCY+YCwgYCY+PmAsIGAxPmAsIGAxPj5gLCBgPnxgLiAqL1xuY29uc3QgU1RET1VUX1JFRElSRUNUX1RXT19UT0tFTiA9IC9eKD86Pj4/fCY+Pj98MT4+P3w+XFx8KSQvO1xuY29uc3QgU1RET1VUX1JFRElSRUNUX0ZVU0VEID0gL14oPzo+Pj98Jj4+P3wxPj4/KVtePD4mfF0vO1xuY29uc3QgU1RET1VUX1JFRElSRUNUX0ZVU0VEX1BJUEUgPSAvXj5cXHxbXjw+JnxdLztcblxuLyoqIFdoZXRoZXIgYSBwcmUtc3RyaXAgYXJndiBjYXJyaWVzIGEgc3Rkb3V0LWZvcm0gcmVkaXJlY3QgKHN0ZGVyciBgMj5gIGFuZCBkdXAgYDI+JjFgIG5ldmVyIHNldmVyKS4gKi9cbmNvbnN0IGhhc1N0ZG91dFJlZGlyZWN0ID0gKHJhdzogc3RyaW5nW10pOiBib29sZWFuID0+XG4gIHJhdy5zb21lKFxuICAgICh3KSA9PiBTVERPVVRfUkVESVJFQ1RfVFdPX1RPS0VOLnRlc3QodykgfHwgU1RET1VUX1JFRElSRUNUX0ZVU0VELnRlc3QodykgfHwgU1RET1VUX1JFRElSRUNUX0ZVU0VEX1BJUEUudGVzdCh3KVxuICApO1xuXG50eXBlIFNvdXJjZUFuYWx5c2lzID1cbiAgfCB7IGtpbmQ6ICdub25lJyB9XG4gIHwgeyBraW5kOiAndW5uYXJyb3dhYmxlJzsgZmlsZXM6IHsgZmlsZUFyZzogc3RyaW5nOyBpZGlvbTogJ2NhdC1maWxlJyB8ICdubC1maWxlJyB9W10gfVxuICB8IHsga2luZDogJ25hcnJvd2FibGUnOyBmaWxlQXJnOiBzdHJpbmc7IGlkaW9tOiAnY2F0LWZpbGUnIHwgJ25sLWZpbGUnOyByZXNvbHZlcktpbmQ6ICdmcyc7IGRpck92ZXJyaWRlPzogc3RyaW5nIH1cbiAgfCB7XG4gICAgICBraW5kOiAnZ2l0JztcbiAgICAgIGZpbGVBcmc6IHN0cmluZztcbiAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnO1xuICAgICAgcmV2OiBzdHJpbmc7XG4gICAgICByZXNvbHZlcktpbmQ6IHsga2luZDogJ2dpdCc7IHJldjogc3RyaW5nIH07XG4gICAgICBkaXJPdmVycmlkZT86IHN0cmluZztcbiAgICB9XG4gIHwgeyBraW5kOiAnZ2l0VW5yZXNvbHZlZCc7IGZpbGVBcmc6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfTtcblxuLyoqIEEgc291cmNlIHRoYXQgb3BlbnMgYSBuYXJyb3dhYmxlIHdpbmRvdzogYSBzaW5nbGUtZmlsZSBgY2F0YC9gbmxgIG9yIGEgYGdpdCBzaG93IHJldjpwYXRoYC4gKi9cbnR5cGUgTmFycm93YWJsZVNvdXJjZSA9IEV4dHJhY3Q8U291cmNlQW5hbHlzaXMsIHsga2luZDogJ25hcnJvd2FibGUnIHwgJ2dpdCcgfT47XG5cbi8qKlxuICogVGhlIHBpcGVsaW5lLXNvdXJjZSBhbmFseXNpcyAocGxhbiBcdTAwQTczKTogYSBgY2F0YC9gbmxgIHdob3NlIGZpbGUgYXJncyBcdTIwMTRcbiAqIGV2ZXJ5IG5vbi1mbGFnIHdvcmQsIHdoZXJlIGEgYC1gLXByZWZpeGVkIHdvcmQgaXMgYSBmbGFnIGFuZCBhIGJhcmUgYC1gIGlzXG4gKiBhIHN0ZGluIG1hcmtlciBcdTIwMTQgYXJlIGFsbCBmaWxlcy1vci1gLWAgd2l0aCBhdCBsZWFzdCBvbmUgZmlsZSwgb3IgYVxuICogYGdpdCBzaG93IHJldjpwYXRoYC4gQSBzaW5nbGUtZmlsZSBzb3VyY2UgaXMgbmFycm93YWJsZTsgYSBtdWx0aS1maWxlIG9yXG4gKiBzdGRpbi1taXhlZCBzb3VyY2UgaXMgdW4tbmFycm93YWJsZSAoZWFjaCBmaWxlIGVtaXRzIGl0cyBvd24gY29uc2VydmF0aXZlXG4gKiB3aG9sZS1maWxlIHJlYWQsIGFuZCBzdGRpbiBzZWxlY3RvcnMgbmV2ZXIgbmFycm93IGl0KS5cbiAqL1xuZnVuY3Rpb24gYW5hbHl6ZVNvdXJjZShhcmd2OiBzdHJpbmdbXSk6IFNvdXJjZUFuYWx5c2lzIHtcbiAgaWYgKGFyZ3ZbMF0gPT09ICdjYXQnIHx8IGFyZ3ZbMF0gPT09ICdubCcpIHtcbiAgICBjb25zdCBmaWxlczogc3RyaW5nW10gPSBbXTtcbiAgICBpZiAoYXJndlswXSA9PT0gJ2NhdCcpIHtcbiAgICAgIGZvciAobGV0IGkgPSAxOyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICAgICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpICYmIGEgIT09ICctJykgY29udGludWU7IC8vIGEgZmxhZyBcdTIwMTQgY2F0IGZsYWdzIG5ldmVyIHRha2UgYXJndW1lbnRzXG4gICAgICAgIGZpbGVzLnB1c2goYSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAobGV0IGkgPSAxOyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICAgICAgaWYgKGEgPT09ICctJykge1xuICAgICAgICAgIGZpbGVzLnB1c2goYSk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICAgICAgaWYgKE5MX0FSR19GTEFHUy5oYXMoYSkpIGkgKz0gMTsgLy8gYXJnLXRha2luZyBmbGFnIGNvbnN1bWVzIHRoZSBuZXh0IHdvcmRcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCByZWFsID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICAgIGlmIChyZWFsLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsga2luZDogJ25vbmUnIH07XG4gICAgY29uc3QgaWRpb20gPSBhcmd2WzBdID09PSAnY2F0JyA/ICdjYXQtZmlsZScgOiAnbmwtZmlsZSc7XG4gICAgaWYgKHJlYWwubGVuZ3RoID09PSAxICYmICFmaWxlcy5pbmNsdWRlcygnLScpKSB7XG4gICAgICByZXR1cm4geyBraW5kOiAnbmFycm93YWJsZScsIGZpbGVBcmc6IHJlYWxbMF0sIGlkaW9tLCByZXNvbHZlcktpbmQ6ICdmcycgfTtcbiAgICB9XG4gICAgcmV0dXJuIHsga2luZDogJ3VubmFycm93YWJsZScsIGZpbGVzOiByZWFsLm1hcCgoZmlsZUFyZykgPT4gKHsgZmlsZUFyZywgaWRpb20gfSkpIH07XG4gIH1cbiAgaWYgKGFyZ3ZbMF0gPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgb3V0Y29tZXMgPSBtYXRjaEdpdFNob3coYXJndik7XG4gICAgaWYgKG91dGNvbWVzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgY29uc3QgbyA9IG91dGNvbWVzWzBdO1xuICAgICAgaWYgKG8ua2luZCA9PT0gJ3VucmVzb2x2ZWQnKSB7XG4gICAgICAgIHJldHVybiB7IGtpbmQ6ICdnaXRVbnJlc29sdmVkJywgZmlsZUFyZzogby5maWxlQXJnLCByZWFzb246IG8ucmVhc29uIH07XG4gICAgICB9XG4gICAgICBpZiAoby5raW5kID09PSAnY2FuZGlkYXRlJyAmJiBvLnJlc29sdmVyS2luZCAhPT0gJ2ZzJykge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGtpbmQ6ICdnaXQnLFxuICAgICAgICAgIGZpbGVBcmc6IG8uZmlsZUFyZyxcbiAgICAgICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgICAgICByZXY6IG8ucmVzb2x2ZXJLaW5kLnJldixcbiAgICAgICAgICByZXNvbHZlcktpbmQ6IG8ucmVzb2x2ZXJLaW5kLFxuICAgICAgICAgIGRpck92ZXJyaWRlOiBvLmRpck92ZXJyaWRlXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiB7IGtpbmQ6ICdub25lJyB9O1xufVxuXG50eXBlIFN0ZGluU2VsZWN0b3IgPVxuICB8IHsga2luZDogJ2hlYWQnOyBjb3VudDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd0YWlsJzsgY291bnQ6IG51bWJlcjsgZnJvbVN0YXJ0OiBib29sZWFuIH1cbiAgfCB7IGtpbmQ6ICdzZWQnOyByYW5nZXM6IHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfCAnJCcgfVtdIH07XG5cbi8qKlxuICogV2hldGhlciBhIHdyYXBwZXItc3RyaXBwZWQgc3RhZ2UgaXMgYSBzdGRpbiBsaW5lLXNlbGVjdG9yIChwbGFuIFx1MDBBNzMpOiBhXG4gKiBgc2VkIC1uYCByYW5nZSBzY3JpcHQsIGBoZWFkYCwgb3IgYHRhaWxgIHdpdGggbm8gZmlsZSBhcmdzIChhIGJhcmUgYC1gIGlzIGFcbiAqIHN0ZGluIG1hcmtlciwgbm90IGEgZmlsZSkuIEEgcmVjb2duaXplZCBzZWxlY3RvciBjYXJyeWluZyBpdHMgb3duIGZpbGUgYXJnc1xuICogaXMgYSBub24tY29uc3VtZXIgXHUyMDE0IGl0IG5ldmVyIHJlYWRzIHRoZSBwaXBlIFx1MjAxNCBhbmQgcmV0dXJucyBudWxsLlxuICovXG5mdW5jdGlvbiBjbGFzc2lmeVN0ZGluU2VsZWN0b3IoYXJndjogc3RyaW5nW10pOiBTdGRpblNlbGVjdG9yIHwgbnVsbCB7XG4gIGlmIChhcmd2WzBdID09PSAnaGVhZCcgfHwgYXJndlswXSA9PT0gJ3RhaWwnKSB7XG4gICAgY29uc3QgeyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSwgYXJndlswXSA9PT0gJ3RhaWwnKTtcbiAgICBpZiAoZGlzcXVhbGlmaWVkKSByZXR1cm4gbnVsbDsgLy8gYnl0ZS96ZXJvLXRlcm1pbmF0ZWQgcmVhZHMgYXJlIG5vdCBsaW5lIHNlbGVjdG9yc1xuICAgIGNvbnN0IGZpbGVBcmdzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICAgIGlmIChmaWxlQXJncy5sZW5ndGggPiAwKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gYXJndlswXSA9PT0gJ2hlYWQnID8geyBraW5kOiAnaGVhZCcsIGNvdW50OiBjb3VudCA/PyAxMCB9IDogeyBraW5kOiAndGFpbCcsIGNvdW50OiBjb3VudCA/PyAxMCwgZnJvbVN0YXJ0IH07XG4gIH1cbiAgaWYgKGFyZ3ZbMF0gPT09ICdzZWQnKSB7XG4gICAgY29uc3QgcmVzdCA9IGFyZ3Yuc2xpY2UoMSk7XG4gICAgaWYgKCFyZXN0LmluY2x1ZGVzKCctbicpKSByZXR1cm4gbnVsbDtcbiAgICBsZXQgc2NyaXB0SWR4ID0gLTE7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAocmVzdFtpXSA9PT0gJy1uJykgY29udGludWU7XG4gICAgICBpZiAoc2VkU2NyaXB0U2VnbWVudHMocmVzdFtpXSkuc29tZSgoc2VnKSA9PiBTRURfUkFOR0UudGVzdChzZWcpKSkge1xuICAgICAgICBzY3JpcHRJZHggPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHNjcmlwdElkeCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGZpbGVDYW5kaWRhdGVzID0gcmVzdC5maWx0ZXIoKGEsIGkpID0+IGkgIT09IHNjcmlwdElkeCAmJiBhICE9PSAnLW4nICYmICFhLnN0YXJ0c1dpdGgoJy0nKSk7XG4gICAgaWYgKGZpbGVDYW5kaWRhdGVzLmxlbmd0aCAhPT0gMCkgcmV0dXJuIG51bGw7IC8vIG5vbi1jb25zdW1lciBcdTIwMTQgcmVhZHMgaXRzIGZpbGUsIG5ldmVyIHRoZSBwaXBlXG4gICAgY29uc3QgcmFuZ2VzOiB7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIHwgJyQnIH1bXSA9IFtdO1xuICAgIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzZWRTY3JpcHRTZWdtZW50cyhyZXN0W3NjcmlwdElkeF0pKSB7XG4gICAgICBjb25zdCBtID0gc2VnbWVudC5tYXRjaChTRURfUkFOR0UpO1xuICAgICAgaWYgKCFtKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICAgIHJhbmdlcy5wdXNoKHsgc3RhcnQsIGVuZDogbVsyXSA9PT0gdW5kZWZpbmVkID8gc3RhcnQgOiBtWzJdID09PSAnJCcgPyAnJCcgOiBOdW1iZXIucGFyc2VJbnQobVsyXSwgMTApIH0pO1xuICAgIH1cbiAgICBpZiAocmFuZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHsga2luZDogJ3NlZCcsIHJhbmdlcyB9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE9yY2hlc3RyYXRvclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IExJTkVfU0VMRUNUT1JTID0gW21hdGNoU2VkLCBtYXRjaEhlYWQsIG1hdGNoVGFpbF07XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kOiBzdHJpbmcsIG9wdHM6IFBhcnNlT3B0aW9ucyA9IHt9KTogU3Bhbk1hdGNoW10ge1xuICBjb25zdCBjd2QgPSBvcHRzLmN3ZCA/PyBwcm9jZXNzLmN3ZCgpO1xuICAvLyBQbGFuIFx1MDBBNzc6IHRoZSBwYXJzZXIgZGVmYXVsdHMgYGVudmAgdG8gdGhlIGhvb2sgcHJvY2VzcyBlbnYsIGdhdGVkIGJ5IHRoZVxuICAvLyBhbGxvd2xpc3QgXHUyMDE0IG9ubHkgYERFRkFVTFRfUEFUSF9BTExPV0xJU1RgIG5hbWVzIG1heSByZXNvbHZlIGZyb20gaXQuIEFuXG4gIC8vIGV4cGxpY2l0bHkgaW5qZWN0ZWQgZW52ICh0ZXN0cywgYWRhcHRlcnMpIGlzIGNvbnN1bHRlZCB3aG9sZXNhbGUuXG4gIGNvbnN0IGFsbG93bGlzdCA9IG9wdHMuYWxsb3dsaXN0ID8/IERFRkFVTFRfUEFUSF9BTExPV0xJU1Q7XG4gIGNvbnN0IGVudjogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPiA9XG4gICAgb3B0cy5lbnYgPz8gT2JqZWN0LmZyb21FbnRyaWVzKGFsbG93bGlzdC5tYXAoKG4pID0+IFtuLCBwcm9jZXNzLmVudltuXV0pKTtcbiAgY29uc3QgeyB3cml0ZXM6IGhlcmVkb2NXcml0ZXMsIG1hc2tlZCB9ID0gZXh0cmFjdEhlcmVkb2NXcml0ZXMoY29tbWFuZCk7XG4gIGNvbnN0IHsgc3RhZ2VzOiBzaW1wbGVDb21tYW5kcywgbWFsZm9ybWVkIH0gPSBzcGxpdFRvcExldmVsKG1hc2tlZCk7XG5cbiAgLy8gVmVyZGljdCBjb25zdW1wdGlvbiAocGxhbiBcdTAwQTcxLCBsaXN0LXNjb3BlICsgdGVybWluYWwgc2VtYW50aWNzKTogdGhlXG4gIC8vIHNwbGl0dGVyIGhhcyBhbHJlYWR5IGRyb3BwZWQgdGhlIHJlamVjdGluZyBsaXN0J3Mgc3RhZ2VzIGFuZCB0cnVuY2F0ZWQgYXRcbiAgLy8gdGhlIGZpcnN0IG1hbGZvcm1lZCBsaXN0LCBzbyBgc2ltcGxlQ29tbWFuZHNgIGlzIGV4YWN0bHkgdGhlIGNvbXBsZXRlZFxuICAvLyBlYXJsaWVyIGxpc3RzIGFuZCB3YWxrcyBub3JtYWxseSBiZWxvdyBcdTIwMTQgdGhlIGZ1bGwtbGluZSBraW5kc1xuICAvLyAoJ3VuY2xvc2VkLXF1b3RlJywgJ3VuYmFsYW5jZWQtcGFyZW4nLCAnZGFuZ2xpbmctb3BlcmF0b3InLCAncGlwZS1iYW5nJyxcbiAgLy8gJ3VuY2xvc2VkLWJyYWNlJywgJ3VuY2xvc2VkLWNhc2UnLCAndW5jbG9zZWQtY29uc3RydWN0JykgZW1pdCBubyB0b3VjaGVzXG4gIC8vIHdpdGhvdXQgZnVydGhlciBoYW5kbGluZy4gJ3VudGVybWluYXRlZC1oZXJlZG9jJyAodGhlIHBhcnRpYWwsIGFycml2aW5nXG4gIC8vIHdpdGggdGhlIGhlcmVkb2MgbWFjaGluZXJ5IGluIGEgbGF0ZXIgcGhhc2UpIGtlZXBzIHRoZSBjdXJyZW50IGJlaGF2aW9yOlxuICAvLyBpdHMgc3RhZ2UgbGlzdCBydW5zIHRocm91Z2ggdGhlIGRlbGltaXRlcidzIGxpbmUgYW5kIGxpa2V3aXNlIGFuYWx5emVzXG4gIC8vIGFzLWlzLlxuICB2b2lkIG1hbGZvcm1lZDtcblxuICAvLyBUaGUgZXhlY3V0aW9uIHdhbGsgKHBsYW4gXHUwMEE3MikgZGVjaWRlcyB3aGljaCBzdGFnZXMgcmFuIGFuZCBleHBhbmRzIHRoZVxuICAvLyBkZWNpZGFibGUgY29uc3RydWN0IGludGVyaW9ycyBpbiB0aGVpciBwbGFjZS4gT25seSBgJ3llcydgIHN0YWdlcyBlbWl0LlxuICBjb25zdCBleHBhbmRlZCA9IG5ldyBFeGVjdXRpb25XYWxrZXIoKS53YWxrSW5wdXQoc2ltcGxlQ29tbWFuZHMpO1xuXG4gIGNvbnN0IHJlc3VsdHM6IFNwYW5NYXRjaFtdID0gW107XG4gIGNvbnN0IGZzTGluZUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlciB8IG51bGw+KCk7XG4gIGNvbnN0IGdpdExpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuXG4gIGNvbnN0IGNhY2hlZEZzVG90YWxMaW5lcyA9IChhYnNQYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBpZiAoIWZzTGluZUNhY2hlLmhhcyhhYnNQYXRoKSkgZnNMaW5lQ2FjaGUuc2V0KGFic1BhdGgsIGNvdW50RmlsZUxpbmVzKGFic1BhdGgpKTtcbiAgICByZXR1cm4gZnNMaW5lQ2FjaGUuZ2V0KGFic1BhdGgpID8/IG51bGw7XG4gIH07XG4gIGNvbnN0IGNhY2hlZEdpdFRvdGFsTGluZXMgPSAoZ2l0Q3dkOiBzdHJpbmcsIHJldjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBjb25zdCBrZXkgPSBgJHtnaXRDd2R9XFx1MDAwMCR7cmV2fVxcdTAwMDAke3BhdGh9YDtcbiAgICBpZiAoIWdpdExpbmVDYWNoZS5oYXMoa2V5KSkgZ2l0TGluZUNhY2hlLnNldChrZXksIGNvdW50R2l0QmxvYkxpbmVzKGdpdEN3ZCwgcmV2LCBwYXRoKSk7XG4gICAgcmV0dXJuIGdpdExpbmVDYWNoZS5nZXQoa2V5KSA/PyBudWxsO1xuICB9O1xuXG4gIC8vIGBjZGAgZnJhbWVzIChwbGFuIFx1MDBBNzYpOiB0aGUgd2FsayBhc3NpZ25zIGVhY2ggc3RhZ2UgdGhlIHN1YnNoZWxsIGZyYW1lIGl0XG4gIC8vIHJhbiBpbjsgYSBzdWJzaGVsbCdzIGBjZGAgcmUtYmFzZXMgd2l0aGluIGl0cyBmcmVzaCBmcmFtZSwgZGlzY2FyZGVkIGF0XG4gIC8vIHRoZSBjbG9zZS4gRWFjaCBmcmFtZSB0cmFja3MgdGhlIGNvbXBvc2VkIGVmZmVjdGl2ZSBkaXJlY3RvcnksIGl0c1xuICAvLyBjZXJ0YWludHkgKGFuIGV4ZWN1dGVkIG9yIG1heS1oYXZlLXJ1biBgY2RgIHdpdGggYW4gdW5yZXNvbHZhYmxlIHRhcmdldFxuICAvLyBwb2lzb25zIGl0IFx1MjAxNCByZWxhdGl2ZSByZXNvbHV0aW9uIGZhaWxzIGNsb3NlZCksIGFuZCB0aGUgcHJlLWBjZGAgcGF0aFxuICAvLyAoYGNkIC1gJ3MgT0xEUFdEKS5cbiAgaW50ZXJmYWNlIERpckZyYW1lIHtcbiAgICBkaXI6IHN0cmluZztcbiAgICBjZXJ0YWluOiBib29sZWFuO1xuICAgIHByZXY6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgfVxuICBjb25zdCBkaXJGcmFtZXM6IERpckZyYW1lW10gPSBbeyBkaXI6IGN3ZCwgY2VydGFpbjogdHJ1ZSwgcHJldjogdW5kZWZpbmVkIH1dO1xuXG4gIC8qKiBUaGUgcGFydHMgb2YgYSBmcmFtZSB0aGUgcmVzb2x1dGlvbiBwYXRocyBuZWVkIChubyBPTERQV0QpLiAqL1xuICBpbnRlcmZhY2UgRnJhbWUge1xuICAgIGRpcjogc3RyaW5nO1xuICAgIGNlcnRhaW46IGJvb2xlYW47XG4gIH1cblxuICAvKipcbiAgICogVGhlIGVmZmVjdGl2ZSBnaXQgcmVwbyBkaXIgZm9yIGEgY2FuZGlkYXRlIChwbGFuIFx1MDBBNzYpOiBhbiBhYnNvbHV0ZSBgLUNgXG4gICAqIHRhcmdldCBpcyBzZWxmLWNvbnRhaW5lZDsgYSByZWxhdGl2ZSBvbmUgY29tcG9zZXMgd2l0aCB0aGUgdHJhY2tlZFxuICAgKiBkaXJlY3Rvcnk7IG5vIGAtQ2AgdXNlcyB0aGUgdHJhY2tlZCBkaXJlY3RvcnkgaXRzZWxmLiBVbmRlZmluZWQgd2hlbiB0aGVcbiAgICogZnJhbWUgaXMgdW5jZXJ0YWluIFx1MjAxNCB0aGUgcmVwbyBsb2NhdGlvbiBpcyB1bmtub3duLCBmYWlsIGNsb3NlZC5cbiAgICovXG4gIGNvbnN0IGdpdERpck9mID0gKGM6IHsgZGlyT3ZlcnJpZGU/OiBzdHJpbmcgfSwgZnJhbWU6IEZyYW1lKTogc3RyaW5nIHwgdW5kZWZpbmVkID0+IHtcbiAgICBpZiAoYy5kaXJPdmVycmlkZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZnJhbWUuY2VydGFpbiA/IGZyYW1lLmRpciA6IHVuZGVmaW5lZDtcbiAgICBpZiAoaXNBYnNvbHV0ZShjLmRpck92ZXJyaWRlKSkgcmV0dXJuIGMuZGlyT3ZlcnJpZGU7XG4gICAgcmV0dXJuIGZyYW1lLmNlcnRhaW4gPyByZXNvbHZlUGF0aChmcmFtZS5kaXIsIGMuZGlyT3ZlcnJpZGUpIDogdW5kZWZpbmVkO1xuICB9O1xuXG4gIC8qKiBUaGUgcnVubmluZyB3aW5kb3cgb2YgdGhlIGN1cnJlbnQgcGlwZWxpbmUgZ3JvdXAgKHBsYW4gXHUwMEE3MykuICovXG4gIGludGVyZmFjZSBXaW5kb3dTdGF0ZSB7XG4gICAgaWRpb206IElkaW9tO1xuICAgIGZpbGVBcmc6IHN0cmluZztcbiAgICBkaXI6IHN0cmluZztcbiAgICBjZXJ0YWluOiBib29sZWFuO1xuICAgIGRpck92ZXJyaWRlPzogc3RyaW5nO1xuICAgIHJlc29sdmVyS2luZDogJ2ZzJyB8IHsga2luZDogJ2dpdCc7IHJldjogc3RyaW5nIH07XG4gICAgbG86IG51bWJlcjtcbiAgICBoaTogbnVtYmVyO1xuICAgIGNvbnN1bWVkOiBib29sZWFuO1xuICB9XG4gIGxldCB3aW5kb3c6IFdpbmRvd1N0YXRlIHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3Qgd2hvbGVGaWxlQ2FuZGlkYXRlID0gKHM6IHsgZmlsZUFyZzogc3RyaW5nOyBpZGlvbTogJ2NhdC1maWxlJyB8ICdubC1maWxlJyB9KTogUmF3Q2FuZGlkYXRlID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgaWRpb206IHMuaWRpb20sXG4gICAgZmlsZUFyZzogcy5maWxlQXJnLFxuICAgIHNwZWM6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSxcbiAgICByZXNvbHZlcktpbmQ6ICdmcydcbiAgfSk7XG5cbiAgLyoqIEEgc291cmNlJ3Mgd2hvbGUtZmlsZSByZWFkIGFzIGEgY2FuZGlkYXRlIChmcyBvciBnaXQgcmVzb2x2ZXIpLiAqL1xuICBjb25zdCBzb3VyY2VDYW5kaWRhdGUgPSAoc3JjOiBOYXJyb3dhYmxlU291cmNlKTogUmF3Q2FuZGlkYXRlID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgaWRpb206IHNyYy5pZGlvbSxcbiAgICBmaWxlQXJnOiBzcmMuZmlsZUFyZyxcbiAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgcmVzb2x2ZXJLaW5kOiBzcmMucmVzb2x2ZXJLaW5kLFxuICAgIGRpck92ZXJyaWRlOiBzcmMuZGlyT3ZlcnJpZGVcbiAgfSk7XG5cbiAgLyoqIEVtaXQgdGhlIHdpbmRvdydzIHRvdWNoOiBvbmUgbmFycm93IHJhbmdlIHdoZW4gYSBzdGRpbiBzZWxlY3RvciBjb25zdW1lZCBpdCwgZWxzZSB0aGUgd2hvbGUtZmlsZSByZWFkLiAqL1xuICBjb25zdCBlbWl0V2luZG93VG91Y2ggPSAodzogV2luZG93U3RhdGUpID0+IHtcbiAgICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID0gdy5jb25zdW1lZCA/IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogdy5sbywgZW5kOiB3LmhpIH0gOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH07XG4gICAgZW1pdENhbmRpZGF0ZShcbiAgICAgIHtcbiAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgIGlkaW9tOiB3LmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiB3LmZpbGVBcmcsXG4gICAgICAgIHNwZWMsXG4gICAgICAgIHJlc29sdmVyS2luZDogdy5yZXNvbHZlcktpbmQsXG4gICAgICAgIGRpck92ZXJyaWRlOiB3LmRpck92ZXJyaWRlXG4gICAgICB9LFxuICAgICAgeyBkaXI6IHcuZGlyLCBjZXJ0YWluOiB3LmNlcnRhaW4gfVxuICAgICk7XG4gIH07XG5cbiAgLyoqXG4gICAqIE9wZW4gYSB3aW5kb3cgb3ZlciBhIG5hcnJvd2FibGUgc291cmNlLiBBbiB1bnJlc29sdmFibGUgc291cmNlIFx1MjAxNCBhblxuICAgKiB1bmV4cGFuZGVkIHBhdGgsIGFuIHVuY2VydGFpbiB0cmFja2VkIGRpcmVjdG9yeSwgb3IgYW4gdW5yZXNvbHZhYmxlXG4gICAqIGBnaXQgLUNgIHRhcmdldCAocGxhbiBcdTAwQTc2KSBcdTIwMTQgZW1pdHMgYW4gYHVucmVzb2x2ZWRgIGVudHJ5IGFuZCBubyB3aW5kb3c6XG4gICAqIGRvd25zdHJlYW0gc3RkaW4gc2VsZWN0b3JzIGNvbnN1bWUgbm90aGluZyAocGxhbiBcdTAwQTczKS5cbiAgICovXG4gIGNvbnN0IGluaXRXaW5kb3cgPSAoc3JjOiBOYXJyb3dhYmxlU291cmNlLCBmcmFtZTogRnJhbWUpID0+IHtcbiAgICBpZiAoXG4gICAgICBnaXREaXJPZihzcmMsIGZyYW1lKSA9PT0gdW5kZWZpbmVkIHx8XG4gICAgICAoIWZyYW1lLmNlcnRhaW4gJiYgc3JjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJyAmJiAhaXNBYnNvbHV0ZShzcmMuZmlsZUFyZykpXG4gICAgKSB7XG4gICAgICBlbWl0Q2FuZGlkYXRlKHNvdXJjZUNhbmRpZGF0ZShzcmMpLCBmcmFtZSk7IC8vIHRoZSBnYXRlIHJlcG9ydHMgdGhlIHVucmVzb2x2ZWQgZW50cnlcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdG90YWwgPSAoXG4gICAgICBzcmMucmVzb2x2ZXJLaW5kID09PSAnZnMnXG4gICAgICAgID8gY2FjaGVkRnNUb3RhbExpbmVzKHJlc29sdmVQYXRoKGZyYW1lLmRpciwgc3JjLmZpbGVBcmcpKVxuICAgICAgICA6IGNhY2hlZEdpdFRvdGFsTGluZXMoZ2l0RGlyT2Yoc3JjLCBmcmFtZSkhLCBzcmMucmVzb2x2ZXJLaW5kLnJldiwgc3JjLmZpbGVBcmcpXG4gICAgKSgpO1xuICAgIGlmICh0b3RhbCA9PT0gbnVsbCkge1xuICAgICAgZW1pdENhbmRpZGF0ZShzb3VyY2VDYW5kaWRhdGUoc3JjKSwgZnJhbWUpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB3aW5kb3cgPSB7XG4gICAgICBpZGlvbTogc3JjLmlkaW9tLFxuICAgICAgZmlsZUFyZzogc3JjLmZpbGVBcmcsXG4gICAgICBkaXI6IGZyYW1lLmRpcixcbiAgICAgIGNlcnRhaW46IGZyYW1lLmNlcnRhaW4sXG4gICAgICBkaXJPdmVycmlkZTogc3JjLmRpck92ZXJyaWRlLFxuICAgICAgcmVzb2x2ZXJLaW5kOiBzcmMucmVzb2x2ZXJLaW5kLFxuICAgICAgbG86IDEsXG4gICAgICBoaTogdG90YWwsXG4gICAgICBjb25zdW1lZDogZmFsc2VcbiAgICB9O1xuICB9O1xuXG4gIC8qKlxuICAgKiBBcHBseSBhIHN0ZGluIHNlbGVjdG9yJ3MgdHJhbnNmb3JtIHRvIHRoZSBsaXZlIHdpbmRvdywgY2xhbXBlZCB0byB0aGVcbiAgICogY3VycmVudCB3aW5kb3cuIEEgbmFycm93aW5nIHRyYW5zZm9ybSBtYXJrcyB0aGUgd2luZG93IGNvbnN1bWVkICh0aGVcbiAgICogZW1pdHRlZCB0b3VjaCBpcyB0aGUgbmFycm93IHJhbmdlLCBub3QgdGhlIHdob2xlLWZpbGUgcmVhZCkuIFJldHVybnNcbiAgICogZmFsc2Ugd2hlbiB0aGUgdHJhbnNmb3JtIGVtcHRpZXMgdGhlIHdpbmRvdyBcdTIwMTQgdGhlIHByZS10cmFuc2Zvcm0gd2luZG93XG4gICAqIHN1cnZpdmVzICh3aGF0IGEgcmVhZGVyIGFjdHVhbGx5IGNvbnN1bWVkKSBhbmQgc3RheXMgdW5jb25zdW1lZC5cbiAgICovXG4gIGNvbnN0IGFwcGx5V2luZG93VHJhbnNmb3JtID0gKHNlbDogU3RkaW5TZWxlY3Rvcik6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IHcgPSB3aW5kb3chO1xuICAgIGNvbnN0IGxvID0gdy5sbztcbiAgICBjb25zdCBoaSA9IHcuaGk7XG4gICAgbGV0IG5MbzogbnVtYmVyO1xuICAgIGxldCBuSGk6IG51bWJlcjtcbiAgICBpZiAoc2VsLmtpbmQgPT09ICdoZWFkJykge1xuICAgICAgbkxvID0gbG87XG4gICAgICBuSGkgPSBsbyArIHNlbC5jb3VudCAtIDE7XG4gICAgfSBlbHNlIGlmIChzZWwua2luZCA9PT0gJ3RhaWwnKSB7XG4gICAgICBpZiAoc2VsLmZyb21TdGFydCkge1xuICAgICAgICBuTG8gPSBsbyArIHNlbC5jb3VudCAtIDE7XG4gICAgICAgIG5IaSA9IGhpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbkxvID0gaGkgLSBzZWwuY291bnQgKyAxO1xuICAgICAgICBuSGkgPSBoaTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbkxvID0gbG8gKyBzZWwucmFuZ2VzWzBdLnN0YXJ0IC0gMTtcbiAgICAgIG5IaSA9IHNlbC5yYW5nZXNbMF0uZW5kID09PSAnJCcgPyBoaSA6IGxvICsgc2VsLnJhbmdlc1swXS5lbmQgLSAxO1xuICAgIH1cbiAgICBuTG8gPSBNYXRoLm1heChuTG8sIGxvKTtcbiAgICBuSGkgPSBNYXRoLm1pbihuSGksIGhpKTtcbiAgICBpZiAobkxvID4gbkhpKSByZXR1cm4gZmFsc2U7XG4gICAgdy5sbyA9IG5MbztcbiAgICB3LmhpID0gbkhpO1xuICAgIHcuY29uc3VtZWQgPSB0cnVlO1xuICAgIHJldHVybiB0cnVlO1xuICB9O1xuXG4gIC8qKiBBIG11bHRpLXJhbmdlIHN0ZGluIHNlZCBkZWxpdmVycyBlYWNoIHJhbmdlIGFzIGl0cyBvd24gdG91Y2ggYW5kIHNldmVyczsgZW1wdHkgY2xhbXBzIGRyb3AuICovXG4gIGNvbnN0IGVtaXRNdWx0aVJhbmdlID0gKHJhbmdlczogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB8ICckJyB9W10pID0+IHtcbiAgICBjb25zdCB3ID0gd2luZG93ITtcbiAgICBsZXQgZW1pdHRlZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgciBvZiByYW5nZXMpIHtcbiAgICAgIGNvbnN0IG1MbyA9IE1hdGgubWF4KHcubG8sIHcubG8gKyByLnN0YXJ0IC0gMSk7XG4gICAgICBjb25zdCBtSGkgPSBNYXRoLm1pbih3LmhpLCByLmVuZCA9PT0gJyQnID8gdy5oaSA6IHcubG8gKyByLmVuZCAtIDEpO1xuICAgICAgaWYgKG1MbyA+IG1IaSkgY29udGludWU7XG4gICAgICBlbWl0dGVkID0gdHJ1ZTtcbiAgICAgIGVtaXRDYW5kaWRhdGUoXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgICBpZGlvbTogdy5pZGlvbSxcbiAgICAgICAgICBmaWxlQXJnOiB3LmZpbGVBcmcsXG4gICAgICAgICAgc3BlYzogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0OiBtTG8sIGVuZDogbUhpIH0sXG4gICAgICAgICAgcmVzb2x2ZXJLaW5kOiB3LnJlc29sdmVyS2luZCxcbiAgICAgICAgICBkaXJPdmVycmlkZTogdy5kaXJPdmVycmlkZVxuICAgICAgICB9LFxuICAgICAgICB7IGRpcjogdy5kaXIsIGNlcnRhaW46IHcuY2VydGFpbiB9XG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoIWVtaXR0ZWQpIGVtaXRXaW5kb3dUb3VjaCh3KTsgLy8gZXZlcnkgcmFuZ2UgZHJvcHBlZCBcdTIwMTQgdGhlIHByZS10cmFuc2Zvcm0gd2luZG93IHN1cnZpdmVzXG4gIH07XG5cbiAgY29uc3QgZW1pdENhbmRpZGF0ZSA9IChjOiBSYXdDYW5kaWRhdGUsIGZyYW1lOiBGcmFtZSkgPT4ge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShjLmZpbGVBcmcpKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGMuZmlsZUFyZyxcbiAgICAgICAgcmVhc29uOiAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gUGxhbiBcdTAwQTc2IGNlcnRhaW50eTogYSByZWxhdGl2ZSBwYXRoIGFnYWluc3QgYW4gdW5jZXJ0YWluIGRpcmVjdG9yeSwgb3IgYVxuICAgIC8vIGdpdCBjYW5kaWRhdGUgd2hvc2UgcmVwbyBmcmFtZSBjYW5ub3QgYmUgY29tcG9zZWQsIGlzIHVucmVzb2x2YWJsZSBcdTIwMTRcbiAgICAvLyBuZXZlciBhIGd1ZXNzZWQgdG91Y2guIEFic29sdXRlIHBhdGhzIGFyZSB1bmFmZmVjdGVkLlxuICAgIGlmIChjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJykge1xuICAgICAgaWYgKCFmcmFtZS5jZXJ0YWluICYmICFpc0Fic29sdXRlKGMuZmlsZUFyZykpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgICBmaWxlQXJnOiBjLmZpbGVBcmcsXG4gICAgICAgICAgcmVhc29uOiAndGhlIHdvcmtpbmcgZGlyZWN0b3J5IGlzIHVuY2VydGFpbiBcdTIwMTQgdGhlIHJlbGF0aXZlIHBhdGggY2Fubm90IGJlIHJlc29sdmVkJ1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZ2l0RGlyT2YoYywgZnJhbWUpID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYy5maWxlQXJnLFxuICAgICAgICByZWFzb246ICd0aGUgZ2l0IC1DIHRhcmdldCBjYW5ub3QgYmUgcmVzb2x2ZWQgYWdhaW5zdCB0aGUgdHJhY2tlZCBkaXJlY3RvcnknXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gQSBnaXQgY2FuZGlkYXRlJ3MgcGF0aCByZXNvbHZlcyBpbnNpZGUgaXRzIHJlcG8gZGlyIChgLUNgIHRhcmdldCBvciB0aGVcbiAgICAvLyB0cmFja2VkIGRpcmVjdG9yeSksIG5vdCB0aGUgcHJvY2VzcyBkaXIgXHUyMDE0IHBsYW4gXHUwMEE3Ni5cbiAgICBjb25zdCByZXNvbHV0aW9uRGlyID0gYy5yZXNvbHZlcktpbmQgPT09ICdmcycgPyBmcmFtZS5kaXIgOiBnaXREaXJPZihjLCBmcmFtZSkhO1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKHJlc29sdXRpb25EaXIsIGMuZmlsZUFyZyk7XG4gICAgY29uc3QgdG90YWxMaW5lcyA9XG4gICAgICBjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJ1xuICAgICAgICA/IGNhY2hlZEZzVG90YWxMaW5lcyhhYnNvbHV0ZVBhdGgpXG4gICAgICAgIDogY2FjaGVkR2l0VG90YWxMaW5lcyhyZXNvbHV0aW9uRGlyLCBjLnJlc29sdmVyS2luZC5yZXYsIGMuZmlsZUFyZyk7XG4gICAgY29uc3QgcmFuZ2UgPSByZXNvbHZlU3BlYyhjLnNwZWMsIHRvdGFsTGluZXMpO1xuICAgIGlmIChyYW5nZSA9PT0gbnVsbCkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHJlYXNvbjogJ2NvdWxkIG5vdCBkZXRlcm1pbmUgZW5kLW9mLWZpbGUgbGluZSBjb3VudCAoZmlsZSB1bnJlYWRhYmxlLCBlbXB0eSwgb3IgZ2l0IHJldi9wYXRoIG5vdCBmb3VuZCknXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgc3BhbjogeyBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCwgbGluZUVuZDogcmFuZ2UubGluZUVuZCwgYWJzb2x1dGVQYXRoIH1cbiAgICB9KTtcbiAgfTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGV4cGFuZGVkLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgaXRlbSA9IGV4cGFuZGVkW2ldO1xuICAgIHdoaWxlIChkaXJGcmFtZXMubGVuZ3RoID4gaXRlbS5kaXJGcmFtZSArIDEpIGRpckZyYW1lcy5wb3AoKTtcbiAgICB3aGlsZSAoZGlyRnJhbWVzLmxlbmd0aCA8IGl0ZW0uZGlyRnJhbWUgKyAxKSBkaXJGcmFtZXMucHVzaCh7IC4uLmRpckZyYW1lc1tkaXJGcmFtZXMubGVuZ3RoIC0gMV0gfSk7XG4gICAgY29uc3QgZnJhbWUgPSBkaXJGcmFtZXNbZGlyRnJhbWVzLmxlbmd0aCAtIDFdO1xuXG4gICAgLy8gYCRQV0RgIHJlc29sdmVzIHRvIHRoZSB0cmFja2VkIGRpcmVjdG9yeSwgbm90IHRoZSBzdGFsZSBob29rIGVudiAocGxhblxuICAgIC8vIFx1MDBBNzYpIFx1MjAxNCB0aGUgcGVyLXN0YWdlIGVudiBvdmVycmlkZXMgaXQgd2l0aCB0aGUgY29tcG9zZWQgZnJhbWUuXG4gICAgY29uc3Qgc3RhZ2VFbnYgPSB7IC4uLmVudiwgUFdEOiBmcmFtZS5kaXIgfTtcblxuICAgIGNvbnN0IHBpcGVQcmVjZWRlcyA9IGl0ZW0ucHJlY2VkZWRCeSA9PT0gJ3BpcGUnO1xuICAgIGNvbnN0IHBpcGVGb2xsb3dzID0gZXhwYW5kZWRbaSArIDFdICE9PSB1bmRlZmluZWQgJiYgZXhwYW5kZWRbaSArIDFdLnByZWNlZGVkQnkgPT09ICdwaXBlJztcblxuICAgIC8vIEEgcGlwZWxpbmUgZ3JvdXAgaXMgZG9uZSBhdCBpdHMgbmV4dCBub24tcGlwZSBzdGFnZTogZmx1c2ggdGhlIHdpbmRvd1xuICAgIC8vIChvbmUgbmFycm93IHRvdWNoIGlmIGEgc3RkaW4gc2VsZWN0b3IgY29uc3VtZWQgdGhlIHNvdXJjZSwgZWxzZSB0aGVcbiAgICAvLyBjb25zZXJ2YXRpdmUgd2hvbGUtZmlsZSByZWFkIFx1MjAxNCBwbGFuIFx1MDBBNzMsIGVtaXQpLlxuICAgIGlmICghcGlwZVByZWNlZGVzICYmIHdpbmRvdyAhPT0gbnVsbCkge1xuICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICB3aW5kb3cgPSBudWxsO1xuICAgIH1cblxuICAgIC8vIGBjZGAgYm9va2tlZXBpbmcgKHBsYW4gXHUwMEE3NikgcnVucyBiZWZvcmUgdGhlIGV4ZWMgZ2F0ZTogYSBtYXktaGF2ZS1ydW5cbiAgICAvLyAoYCd1bmtub3duJ2ApIGNkIHBvaXNvbnMgY2VydGFpbnR5IGV2ZW4gdGhvdWdoIGl0cyBvd24gc3RhZ2UgZW1pdHNcbiAgICAvLyBub3RoaW5nLCBhbmQgYSBza2lwcGVkIChgJ25vJ2ApIGNkIGxlYXZlcyB0aGUgZGlyIHVuY2hhbmdlZC5cbiAgICBjb25zdCBjZEFyZ3YgPSBzdHJpcEZvckVtaXNzaW9uKHN0cmlwUmVkaXJlY3RzKGFyZ3ZPZihpdGVtLnRleHQpID8/IFtdKSk7XG4gICAgaWYgKGNkQXJndlswXSA9PT0gJ2NkJyAmJiAhaXRlbS5pblBpcGVsaW5lKSB7XG4gICAgICBpZiAoaXRlbS5leGVjID09PSAneWVzJykge1xuICAgICAgICAvLyBUaGUgdGFyZ2V0IGV4cGFuZHMgbGlrZSBhbnkgb3RoZXIgd29yZCBcdTIwMTQgYGNkIFwiJFdPUktTUEFDRV9QQVRIXCJgXG4gICAgICAgIC8vIGZpbmFsbHkgd29ya3MgKHBsYW4gXHUwMEE3NykuIEJhcmUgYGNkYCBpcyBgJEhPTUVgIHZpYSB0aGUgc2FtZVxuICAgICAgICAvLyBleHBhbnNpb24gbWFjaGluZXJ5LlxuICAgICAgICBjb25zdCBleHBhbmRlZEFyZ3YgPSBzdHJpcEZvckVtaXNzaW9uKFxuICAgICAgICAgIHN0cmlwUmVkaXJlY3RzKGFyZ3ZPZihleHBhbmRWYXJpYWJsZXMoaXRlbS50ZXh0LCBpdGVtLmFzc2lnbm1lbnRzLCBzdGFnZUVudikpID8/IFtdKVxuICAgICAgICApO1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBleHBhbmRlZEFyZ3ZbMV07XG4gICAgICAgIGlmICh0YXJnZXQgPT09IHVuZGVmaW5lZCB8fCB0YXJnZXQgPT09ICd+JyB8fCB0YXJnZXQuc3RhcnRzV2l0aCgnfi8nKSkge1xuICAgICAgICAgIC8vIEJhcmUgYGNkYCBpcyBgJEhPTUVgOyBhIGB+YC9gfi9cdTIwMjZgIHRhcmdldCBpcyB0aGUgc2FtZSB0aWxkZVxuICAgICAgICAgIC8vIGV4cGFuc2lvbiAocGxhbiBcdTAwQTc2KSBcdTIwMTQgdGhlIGFsbG93bGlzdGVkIEhPTUUgdmlhIHRoZSBleHBhbnNpb25cbiAgICAgICAgICAvLyBtYWNoaW5lcnksIGNlcnRhaW4gd2hlbiBpdCByZXNvbHZlcywgdW5jZXJ0YWluIG90aGVyd2lzZS5cbiAgICAgICAgICBjb25zdCBob21lID0gZXhwYW5kVmFyaWFibGVzKCckSE9NRScsIGl0ZW0uYXNzaWdubWVudHMsIHN0YWdlRW52KTtcbiAgICAgICAgICBpZiAobG9va3NVbnJlc29sdmFibGUoaG9tZSkpIGZyYW1lLmNlcnRhaW4gPSBmYWxzZTtcbiAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGZyYW1lLnByZXYgPSBmcmFtZS5kaXI7XG4gICAgICAgICAgICBmcmFtZS5kaXIgPSByZXNvbHZlUGF0aChmcmFtZS5kaXIsIHRhcmdldCA9PT0gdW5kZWZpbmVkID8gaG9tZSA6IGhvbWUgKyB0YXJnZXQuc2xpY2UoMSkpO1xuICAgICAgICAgICAgZnJhbWUuY2VydGFpbiA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHRhcmdldCA9PT0gJy0nKSB7XG4gICAgICAgICAgLy8gYGNkIC1gIGlzIGJhc2gncyBPTERQV0QgXHUyMDE0IHRoZSBwcmV2aW91cyB0cmFja2VkIHBhdGguIFdpdGggbm9cbiAgICAgICAgICAvLyBwcmV2aW91cyBwYXRoIHRoZSBjZCBmYWlscyBhbmQgdGhlIHNoZWxsIHN0YXlzIHB1dC5cbiAgICAgICAgICBpZiAoZnJhbWUucHJldiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb25zdCBvbGQgPSBmcmFtZS5kaXI7XG4gICAgICAgICAgICBmcmFtZS5kaXIgPSBmcmFtZS5wcmV2O1xuICAgICAgICAgICAgZnJhbWUucHJldiA9IG9sZDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0LnN0YXJ0c1dpdGgoJ34nKSkge1xuICAgICAgICAgIC8vIEEgYH51c2VyYC1zdHlsZSB0YXJnZXQgcmVzb2x2ZXMgdG8gdGhhdCB1c2VyJ3MgaG9tZSBcdTIwMTQgdW5rbm93biB0b1xuICAgICAgICAgIC8vIHRoZSB3YWxrOiBiYXNoIG1vdmVkIHRvIGFuIHVua25vd24gZGlyIG9yIGZhaWxlZCBhbmQgc3RheWVkLCBib3RoXG4gICAgICAgICAgLy8gbGl2ZSwgc28gY2VydGFpbnR5IGlzIHBvaXNvbmVkLlxuICAgICAgICAgIGZyYW1lLmNlcnRhaW4gPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIGlmIChsb29rc1VucmVzb2x2YWJsZSh0YXJnZXQpKSB7XG4gICAgICAgICAgLy8gVmFyaWFibGUvZ2xvYiB0YXJnZXQ6IGJhc2ggZWl0aGVyIG1vdmVkIHRvIGFuIHVua25vd24gZGlyIG9yXG4gICAgICAgICAgLy8gZmFpbGVkIGFuZCBzdGF5ZWQgXHUyMDE0IGJvdGggbGl2ZSwgc28gY2VydGFpbnR5IGlzIHBvaXNvbmVkLlxuICAgICAgICAgIGZyYW1lLmNlcnRhaW4gPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBmcmFtZS5wcmV2ID0gZnJhbWUuZGlyO1xuICAgICAgICAgIGZyYW1lLmRpciA9IHJlc29sdmVQYXRoKGZyYW1lLmRpciwgdGFyZ2V0KTtcbiAgICAgICAgICBmcmFtZS5jZXJ0YWluID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChpdGVtLmV4ZWMgPT09ICd1bmtub3duJykge1xuICAgICAgICBmcmFtZS5jZXJ0YWluID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb250aW51ZTsgLy8gYSBjZCBuZXZlciBtYXRjaGVzIGEgc291cmNlL2NvbnN1bWVyIGlkaW9tXG4gICAgfVxuXG4gICAgaWYgKGl0ZW0uZXhlYyAhPT0gJ3llcycpIHtcbiAgICAgIC8vIEEgZGVhZCBvciB1bmtub3duIHN0YWdlIG5ldmVyIHJ1bnMgXHUyMDE0IG5vIHRvdWNoLCBubyBzaWRlIGVmZmVjdHMuXG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBoZXJlZG9jUmVmID0gaXRlbS50ZXh0Lm1hdGNoKC9eX19oZXJlZG9jXyhcXGQrKV9fJC8pO1xuICAgIGlmIChoZXJlZG9jUmVmKSB7XG4gICAgICAvLyBUaGUgaGVyZWRvYy13cml0ZSBzdGFnZSBkb2Vzbid0IHJlYWQgdGhlIHBpcGUgXHUyMDE0IGFsaWdubWVudCBzZXZlcnMuXG4gICAgICBpZiAod2luZG93ICE9PSBudWxsKSB7XG4gICAgICAgIGVtaXRXaW5kb3dUb3VjaCh3aW5kb3cpO1xuICAgICAgICB3aW5kb3cgPSBudWxsO1xuICAgICAgfVxuICAgICAgY29uc3QgdyA9IGhlcmVkb2NXcml0ZXNbTnVtYmVyLnBhcnNlSW50KGhlcmVkb2NSZWZbMV0sIDEwKV07XG4gICAgICBpZiAobG9va3NVbnJlc29sdmFibGUody50YXJnZXQpKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBmaWxlQXJnOiB3LnRhcmdldCxcbiAgICAgICAgICByZWFzb246ICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYidcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFmcmFtZS5jZXJ0YWluICYmICFpc0Fic29sdXRlKHcudGFyZ2V0KSkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgZmlsZUFyZzogdy50YXJnZXQsXG4gICAgICAgICAgcmVhc29uOiAndGhlIHdvcmtpbmcgZGlyZWN0b3J5IGlzIHVuY2VydGFpbiBcdTIwMTQgdGhlIHJlbGF0aXZlIHBhdGggY2Fubm90IGJlIHJlc29sdmVkJ1xuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChmcmFtZS5kaXIsIHcudGFyZ2V0KTtcbiAgICAgIGNvbnN0IGJvZHlMaW5lcyA9IHcuYm9keS5sZW5ndGggPT09IDAgPyAwIDogdy5ib2R5LnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gICAgICBpZiAoYm9keUxpbmVzID09PSAwKSB7XG4gICAgICAgIC8vIGBjYXQgPiBmIDw8J0VPRidgIHdpdGggYW4gZW1wdHkgYm9keSB0cnVuY2F0ZXMgdGhlIGZpbGUgdG8gZW1wdHkgXHUyMDE0IGFcbiAgICAgICAgLy8gcmVhbCB3cml0ZSB0aGF0IG11c3QgcHJvZHVjZSBhIHRvdWNoICh3aG9sZS1maWxlLCB2aWEgYGJvZHk6ICcnYCkuXG4gICAgICAgIC8vIGA+PmAgd2l0aCBhbiBlbXB0eSBib2R5IGFwcGVuZHMgbm90aGluZyBhbmQgaXMgYSBnZW51aW5lIG5vLW9wLlxuICAgICAgICBpZiAody5yZWRpcmVjdCAhPT0gJz4nKSBjb250aW51ZTtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBzcGFuOiB7IGxpbmVTdGFydDogMSwgbGluZUVuZDogMSwgYWJzb2x1dGVQYXRoLCBib2R5OiAnJywgcmVkaXJlY3Q6IHcucmVkaXJlY3QgfVxuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID1cbiAgICAgICAgdy5yZWRpcmVjdCA9PT0gJz4nID8geyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0OiAxLCBlbmQ6IGJvZHlMaW5lcyB9IDogeyBraW5kOiAnYXBwZW5kTGluZXMnLCBjb3VudDogYm9keUxpbmVzIH07XG4gICAgICBjb25zdCByYW5nZSA9IHJlc29sdmVTcGVjKHNwZWMsIGNhY2hlZEZzVG90YWxMaW5lcyhhYnNvbHV0ZVBhdGgpKTtcbiAgICAgIGlmIChyYW5nZSA9PT0gbnVsbCkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgZmlsZUFyZzogYWJzb2x1dGVQYXRoLFxuICAgICAgICAgIHJlYXNvbjogJ2FwcGVuZCB0YXJnZXQ6IGNvdWxkIG5vdCByZWFkIGV4aXN0aW5nIGZpbGUgdG8gZmluZCBpdHMgY3VycmVudCBsZW5ndGgnXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBzcGFuOiB7IGxpbmVTdGFydDogcmFuZ2UubGluZVN0YXJ0LCBsaW5lRW5kOiByYW5nZS5saW5lRW5kLCBhYnNvbHV0ZVBhdGgsIGJvZHk6IHcuYm9keSwgcmVkaXJlY3Q6IHcucmVkaXJlY3QgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIERpc3BhdGNoIGFyZ3YgKHBsYW4gXHUwMEE3Nyk6IHRoZSBzdGFnZSdzIHJhdyB0ZXh0IGlzIGV4cGFuZGVkIGJlZm9yZVxuICAgIC8vIHRva2VuaXppbmcgXHUyMDE0IGEgcmVzb2x2ZWQgYGNhdCBcIiRXT1JLU1BBQ0VfUEFUSC9mXCJgIG5hcnJvd3MgdGhyb3VnaCBhXG4gICAgLy8gcGlwZWxpbmUgZXhhY3RseSBsaWtlIGBjYXQgZmAuIFJlZGlyZWN0cyBhcmUgc3RyaXBwZWQgZmlyc3QgKHRoZVxuICAgIC8vIHJlYWQtc2lkZSByZWNvdmVyeSwgXHUwMEE3NCksIHRoZW4gdGhlIHRyYW5zcGFyZW50IHdyYXBwZXJzIChcdTAwQTc1KSwgdGhlbiB0aGVcbiAgICAvLyBlbWlzc2lvbi1zaWRlIGAhYC9gY29tbWFuZGAvYGV4ZWNgIHN0cmlwIFx1MjAxNCBzbyBgY29tbWFuZCAtcCBzZWQgXHUyMDI2YCBzdGlsbFxuICAgIC8vIHJlYWNoZXMgYHNlZGAuXG4gICAgY29uc3QgcmF3QXJndiA9IGFyZ3ZPZihleHBhbmRWYXJpYWJsZXMoaXRlbS50ZXh0LCBpdGVtLmFzc2lnbm1lbnRzLCBzdGFnZUVudikpID8/IFtdO1xuICAgIGNvbnN0IHN0cmlwcGVkID0gc3RyaXBGb3JFbWlzc2lvbihzdHJpcFdyYXBwZXJzKHN0cmlwUmVkaXJlY3RzKHJhd0FyZ3YpKSk7XG4gICAgaWYgKHN0cmlwcGVkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgaWYgKHdpbmRvdyAhPT0gbnVsbCkge1xuICAgICAgICBlbWl0V2luZG93VG91Y2god2luZG93KTtcbiAgICAgICAgd2luZG93ID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIEEgcmVzaWR1YWwgcmVkaXJlY3QgdG9rZW4gKGA+fGAsIGFueXRoaW5nIGVsc2UgYmVnaW5uaW5nIHdpdGggYD5gL2A8YFxuICAgIC8vIHRoYXQgc3RyaXBSZWRpcmVjdHMgbGVmdCBhbG9uZSwgXHUwMEE3NCkgZmFpbHMgY2xvc2VkOiB0aGUgc3RhZ2UgbWF0Y2hlc1xuICAgIC8vIG5vdGhpbmcgXHUyMDE0IG5vIHNvdXJjZSwgbm8gc2VsZWN0b3IsIG5vIHRvdWNoLlxuICAgIGlmIChzdHJpcHBlZC5zb21lKCh3KSA9PiB3LnN0YXJ0c1dpdGgoJz4nKSB8fCB3LnN0YXJ0c1dpdGgoJzwnKSkpIHtcbiAgICAgIGlmICh3aW5kb3cgIT09IG51bGwpIHtcbiAgICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICAgIHdpbmRvdyA9IG51bGw7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBUaGUgc291cmNlIG9mIGEgcGlwZWxpbmUgZ3JvdXAgKHBsYW4gXHUwMEE3Myk6IGEgbmFycm93YWJsZSBgY2F0YC9gbmxgIG9yXG4gICAgLy8gYGdpdCBzaG93YCBvcGVucyB0aGUgd2luZG93IGFuZCBkZWZlcnMgaXRzIHdob2xlLWZpbGUgcmVhZDsgYVxuICAgIC8vIG11bHRpLWZpbGUvc3RkaW4tbWl4ZWQgc291cmNlIGVtaXRzIGVhY2ggZmlsZSdzIGNvbnNlcnZhdGl2ZSB3aG9sZS1maWxlXG4gICAgLy8gcmVhZCBhbmQgbmV2ZXIgbmFycm93czsgYSBzdGRvdXQtZm9ybSByZWRpcmVjdCBvbiB0aGUgc291cmNlIGVtcHRpZXNcbiAgICAvLyB0aGUgcGlwZSBcdTIwMTQgaXRzIHdob2xlLWZpbGUgcmVhZCBzdGFuZHMgYW5kIGRvd25zdHJlYW0gY29uc3VtZXMgbm90aGluZy5cbiAgICBpZiAoIXBpcGVQcmVjZWRlcyAmJiBwaXBlRm9sbG93cyAmJiAoc3RyaXBwZWRbMF0gPT09ICdjYXQnIHx8IHN0cmlwcGVkWzBdID09PSAnbmwnIHx8IHN0cmlwcGVkWzBdID09PSAnZ2l0JykpIHtcbiAgICAgIGNvbnN0IHNyYyA9IGFuYWx5emVTb3VyY2Uoc3RyaXBwZWQpO1xuICAgICAgc3dpdGNoIChzcmMua2luZCkge1xuICAgICAgICBjYXNlICdub25lJzpcbiAgICAgICAgICBicmVhazsgLy8gZmFsbCB0aHJvdWdoIHRvIHRoZSBvcmRpbmFyeSBkaXNwYXRjaFxuICAgICAgICBjYXNlICdnaXRVbnJlc29sdmVkJzpcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgICAgICAgIGZpbGVBcmc6IHNyYy5maWxlQXJnLFxuICAgICAgICAgICAgcmVhc29uOiBzcmMucmVhc29uXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIGNhc2UgJ3VubmFycm93YWJsZSc6IHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGYgb2Ygc3JjLmZpbGVzKSBlbWl0Q2FuZGlkYXRlKHdob2xlRmlsZUNhbmRpZGF0ZShmKSwgZnJhbWUpO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgJ25hcnJvd2FibGUnOlxuICAgICAgICBjYXNlICdnaXQnOiB7XG4gICAgICAgICAgaWYgKGhhc1N0ZG91dFJlZGlyZWN0KHJhd0FyZ3YpKSB7XG4gICAgICAgICAgICBlbWl0Q2FuZGlkYXRlKHNvdXJjZUNhbmRpZGF0ZShzcmMpLCBmcmFtZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGluaXRXaW5kb3coc3JjLCBmcmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQSBwaXBlIG1lbWJlciBvZiBhIGxpdmUgd2luZG93IChwbGFuIFx1MDBBNzMsIGNvbnN1bWVycyk6IGEgc3RkaW5cbiAgICAvLyBsaW5lLXNlbGVjdG9yIHRyYW5zZm9ybXMgdGhlIHdpbmRvdyB3aGlsZSBhbGlnbmVkOyBhIG5vbi1jb25zdW1lciBvclxuICAgIC8vIHVucmVjb2duaXplZCBzdGFnZSBzZXZlcnMgXHUyMDE0IHRoZSB0b3VjaCBpcyB0aGUgd2luZG93IGF0IHRoZSBzZXZlciBwb2ludFxuICAgIC8vIGFuZCBsYXRlciBzdGFnZXMgYXJlIGlnbm9yZWQgZm9yIHdpbmRvdyBwdXJwb3Nlcy4gQSBzdGRvdXQtZm9ybVxuICAgIC8vIHJlZGlyZWN0IG9uIHRoZSBzdGFnZSBvbmx5IG1vdmVzIGl0cyBvd24gb3V0cHV0IFx1MjAxNCBpdCByZWFkcyBub3JtYWxseSxcbiAgICAvLyB0aGVuIHNldmVycy5cbiAgICBpZiAocGlwZVByZWNlZGVzICYmIHdpbmRvdyAhPT0gbnVsbCkge1xuICAgICAgY29uc3Qgc2VsID0gY2xhc3NpZnlTdGRpblNlbGVjdG9yKHN0cmlwcGVkKTtcbiAgICAgIGlmIChzZWwgIT09IG51bGwpIHtcbiAgICAgICAgaWYgKHNlbC5raW5kID09PSAnc2VkJyAmJiBzZWwucmFuZ2VzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICBlbWl0TXVsdGlSYW5nZShzZWwucmFuZ2VzKTtcbiAgICAgICAgICB3aW5kb3cgPSBudWxsO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGFwcGx5V2luZG93VHJhbnNmb3JtKHNlbCk7XG4gICAgICAgICAgaWYgKGhhc1N0ZG91dFJlZGlyZWN0KHJhd0FyZ3YpKSB7XG4gICAgICAgICAgICBlbWl0V2luZG93VG91Y2god2luZG93KTtcbiAgICAgICAgICAgIHdpbmRvdyA9IG51bGw7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlbWl0V2luZG93VG91Y2god2luZG93KTtcbiAgICAgICAgd2luZG93ID0gbnVsbDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBPcmRpbmFyeSBkaXNwYXRjaDogYSBjYXQvbmwgc3RhZ2UncyBvd24gd2hvbGUtZmlsZSByZWFkIChhIGxvbmUgc3RhZ2VcbiAgICAvLyBvciBhIG5vbi1zb3VyY2UgcGlwZSBtZW1iZXIpLCBhbmQgdGhlIGxpbmUtc2VsZWN0b3IvZ2l0IGlkaW9tcy5cbiAgICBpZiAoc3RyaXBwZWRbMF0gPT09ICdjYXQnIHx8IHN0cmlwcGVkWzBdID09PSAnbmwnKSB7XG4gICAgICBjb25zdCBzcmMgPSBhbmFseXplU291cmNlKHN0cmlwcGVkKTtcbiAgICAgIGlmIChzcmMua2luZCA9PT0gJ25hcnJvd2FibGUnKSB7XG4gICAgICAgIGVtaXRDYW5kaWRhdGUod2hvbGVGaWxlQ2FuZGlkYXRlKHsgZmlsZUFyZzogc3JjLmZpbGVBcmcsIGlkaW9tOiBzcmMuaWRpb20gfSksIGZyYW1lKTtcbiAgICAgIH0gZWxzZSBpZiAoc3JjLmtpbmQgPT09ICd1bm5hcnJvd2FibGUnKSB7XG4gICAgICAgIGZvciAoY29uc3QgZiBvZiBzcmMuZmlsZXMpIGVtaXRDYW5kaWRhdGUod2hvbGVGaWxlQ2FuZGlkYXRlKGYpLCBmcmFtZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAoY29uc3QgbWF0Y2hlciBvZiBbLi4uTElORV9TRUxFQ1RPUlMsIG1hdGNoR2l0U2hvdywgbWF0Y2hHaXRMb2dMXSkge1xuICAgICAgICBmb3IgKGNvbnN0IG91dGNvbWUgb2YgbWF0Y2hlcihzdHJpcHBlZCkpIHtcbiAgICAgICAgICBpZiAob3V0Y29tZS5raW5kID09PSAndW5yZXNvbHZlZCcpIHtcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgICAgICBpZGlvbTogb3V0Y29tZS5pZGlvbSxcbiAgICAgICAgICAgICAgZmlsZUFyZzogb3V0Y29tZS5maWxlQXJnLFxuICAgICAgICAgICAgICByZWFzb246IG91dGNvbWUucmVhc29uXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZW1pdENhbmRpZGF0ZShvdXRjb21lLCBmcmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKHdpbmRvdyAhPT0gbnVsbCkge1xuICAgIGVtaXRXaW5kb3dUb3VjaCh3aW5kb3cpO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbi8qKiBQYXJzZXMgYSBCYXNoIGBjb21tYW5kYCBzdHJpbmcgaW50byB0aGUgZmlsZStsaW5lLXJhbmdlIHNwYW5zIGl0IHN0YXRpY2FsbHksIHJlbGlhYmx5IHJlYWRzIG9yIHdyaXRlcy4gUGFzcyBgb3B0cy5jd2RgIChkZWZhdWx0cyB0byBgcHJvY2Vzcy5jd2QoKWApIGZvciBjb3JyZWN0IHJlc29sdXRpb24gb2YgcmVsYXRpdmUgcGF0aHMgYW5kIGBjZGAvYGdpdCAtQ2AgdGFyZ2V0cywgYW5kIG9mIGBnaXQgc2hvd2AvYGdpdCBsb2cgLUxgIHJldmlzaW9uczsgYG9wdHMuZW52YC9gb3B0cy5hbGxvd2xpc3RgIGZlZWQgdGhlIFBoYXNlIDMgYWxsb3dsaXN0ZWQgdmFyaWFibGUgcmVzb2x1dGlvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbW1hbmQoY29tbWFuZDogc3RyaW5nLCBvcHRzOiBQYXJzZU9wdGlvbnMgPSB7fSk6IFJlc29sdmVkU3BhbltdIHtcbiAgY29uc3QgZGV0YWlsZWQgPSBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kLCBvcHRzKTtcbiAgY29uc3Qgc3BhbnM6IFJlc29sdmVkU3BhbltdID0gW107XG4gIGZvciAoY29uc3QgbSBvZiBkZXRhaWxlZCkge1xuICAgIGlmIChtLnN0YXR1cyA9PT0gJ3Jlc29sdmVkJykgc3BhbnMucHVzaChtLnNwYW4pO1xuICB9XG4gIHJldHVybiBzcGFucztcbn1cbiIsICIvKipcbiAqIFRoZSBvbmx5IGltcHVyZSBiaXRzOiBjb3VudGluZyBsaW5lcyBvZiBhIHdvcmtpbmctdHJlZSBmaWxlLCBhbmQgb2YgYSBmaWxlXG4gKiBhcyBpdCBleGlzdGVkIGF0IGEgZ2l2ZW4gZ2l0IHJldmlzaW9uLiBCb3RoIHJldHVybiBudWxsIG9uIGFueSBmYWlsdXJlXG4gKiAobWlzc2luZyBmaWxlLCBiYWQgcmV2LCBub3QgYSBnaXQgcmVwbywgZXRjLikgaW5zdGVhZCBvZiB0aHJvd2luZyBcdTIwMTQgYVxuICogY29tbWFuZCB0aGF0IHN0YXRpY2FsbHkgbWF0Y2hlZCBhbiBpZGlvbSBidXQgcG9pbnRzIGF0IHNvbWV0aGluZyB0aGlzXG4gKiBtYWNoaW5lIGNhbid0IGN1cnJlbnRseSByZXNvbHZlIGlzIGEgbm9ybWFsLCBleHBlY3RlZCBvdXRjb21lLCBub3QgYSBidWcuXG4gKi9cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyByZWFkRmlsZVN5bmMsIHN0YXRTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5cbi8qKiBOdW1iZXIgb2YgbGluZXMgaW4gYSB3b3JraW5nLXRyZWUgZmlsZSwgb3IgbnVsbCBpZiBpdCBjYW4ndCBiZSByZWFkLiBUcmFpbGluZyBuZXdsaW5lIGRvZXMgbm90IGNvdW50IGFzIGFuIGV4dHJhIGVtcHR5IGxpbmUuICovXG5leHBvcnQgZnVuY3Rpb24gY291bnRGaWxlTGluZXMoYWJzb2x1dGVQYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBpZiAoIXN0YXRTeW5jKGFic29sdXRlUGF0aCkuaXNGaWxlKCkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkRmlsZVN5bmMoYWJzb2x1dGVQYXRoLCAndXRmOCcpO1xuICAgIGlmIChjb250ZW50Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIDA7XG4gICAgY29uc3Qgd2l0aG91dFRyYWlsaW5nTmV3bGluZSA9IGNvbnRlbnQuZW5kc1dpdGgoJ1xcbicpID8gY29udGVudC5zbGljZSgwLCAtMSkgOiBjb250ZW50O1xuICAgIHJldHVybiB3aXRob3V0VHJhaWxpbmdOZXdsaW5lLnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKiBOdW1iZXIgb2YgbGluZXMgaW4gYHBhdGhgIGFzIGl0IGV4aXN0cyBhdCBgcmV2YCwgcnVuIGZyb20gYGN3ZGAsIG9yIG51bGwgaWYgdGhlIHJldi9wYXRoL3JlcG8gZG9lc24ndCByZXNvbHZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50R2l0QmxvYkxpbmVzKGN3ZDogc3RyaW5nLCByZXY6IHN0cmluZywgcGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3Nob3cnLCBgJHtyZXZ9OiR7cGF0aH1gXSwge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgaWYgKG91dC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBvdXQuZW5kc1dpdGgoJ1xcbicpID8gb3V0LnNsaWNlKDAsIC0xKSA6IG91dDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIiwgIi8qKlxuICogSGV1cmlzdGljLCBkZXBlbmRlbmN5LWZyZWUgc2hlbGwgc3BsaXR0aW5nLiBOb3QgYSBmdWxsIHNoZWxsIHBhcnNlciBcdTIwMTQgZ29vZFxuICogZW5vdWdoIHRvIGxvY2F0ZSBzaW1wbGUgY29tbWFuZHMgKGFuZCB0aGVpciBhcmd2KSBpbnNpZGUgYSBsYXJnZXJcbiAqICYmL3x8LzsvfC1qb2luZWQgQmFzaCBzdHJpbmcgd2l0aG91dCBwdWxsaW5nIGluIGEgcmVhbCBiYXNoIEFTVCBwYXJzZXIuXG4gKiBWYWxpZGF0ZWQgZHVyaW5nIHJlc2VhcmNoIGFnYWluc3QgYmFzaGxleCBvbiB0aGUgcmVhbCB0cmFuc2NyaXB0IGNvcnB1cztcbiAqIHRoaXMgcG9ydHMgdGhlIHNhbWUgYWxnb3JpdGhtLlxuICovXG5cbi8qKlxuICogVGhlIG5vcm1hbGl6ZWQgYm91bmRhcnkgb3BlcmF0b3JzIGBzcGxpdFRvcExldmVsYCBlbWl0cyBcdTIwMTQgdGhlIHNpbmdsZVxuICogcmVwcmVzZW50YXRpb24gYm90aCBhZGFwdGVycyBjb25zdW1lLlxuICovXG5leHBvcnQgdHlwZSBPcGVyYXRvciA9ICdwaXBlJyB8ICdhbmQnIHwgJ29yJyB8ICdzZW1pY29sb24nIHwgJ25ld2xpbmUnIHwgJ2JhY2tncm91bmQnIHwgJ3N0YXJ0JztcblxuLyoqIE9uZSBgc2ltcGxlIGNvbW1hbmRgIGZvdW5kIGluIGEgbGFyZ2VyIHNjcmlwdCwgcGx1cyB3aGljaCBvcGVyYXRvciBwcmVjZWRlZCBpdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2ltcGxlQ29tbWFuZCB7XG4gIHRleHQ6IHN0cmluZztcbiAgLyoqIFRoZSBvcGVyYXRvciBpbW1lZGlhdGVseSBiZWZvcmUgdGhpcyBjb21tYW5kICgncGlwZScgZm9yIGEgcGlwZWxpbmUgc3RhZ2UsICdhbmQnIGZvciBgJiZgLCAnb3InIGZvciBgfHxgLCAnc2VtaWNvbG9uJyBmb3IgYDtgLCAnbmV3bGluZScgZm9yIGEgbmV3bGluZSBzZXBhcmF0b3IsICdiYWNrZ3JvdW5kJyBmb3IgYCZgLCBvciAnc3RhcnQnIGZvciB0aGUgZmlyc3QgY29tbWFuZCkuICovXG4gIHByZWNlZGVkQnk6IE9wZXJhdG9yO1xufVxuXG4vKiogVGhlIHZlcmRpY3Qga2luZHMgYHNwbGl0VG9wTGV2ZWxgIGNhbiByZXR1cm4gd2hlbiB0aGUgaW5wdXQgaXMgYSBCYXNoIHBhcnNlIGVycm9yIChwbGFuIFx1MDBBNzEpLiAqL1xuZXhwb3J0IHR5cGUgTWFsZm9ybWVkVmVyZGljdCA9XG4gIHwgJ3VuY2xvc2VkLXF1b3RlJ1xuICB8ICd1bmJhbGFuY2VkLXBhcmVuJ1xuICB8ICdkYW5nbGluZy1vcGVyYXRvcidcbiAgfCAncGlwZS1iYW5nJ1xuICB8ICd1bnRlcm1pbmF0ZWQtaGVyZWRvYydcbiAgfCAndW5jbG9zZWQtYnJhY2UnXG4gIHwgJ3VuY2xvc2VkLWNhc2UnXG4gIHwgJ3VuY2xvc2VkLWNvbnN0cnVjdCc7XG5cbi8qKiBUaGUgcmVzdWx0IG9mIGEgdG9wLWxldmVsIHNwbGl0OiB0aGUgc3RhZ2UgbGlzdCwgcGx1cyBhIGBtYWxmb3JtZWRgIHZlcmRpY3Qgd2hlbiB0aGUgaW5wdXQgaXMgYSBCYXNoIHBhcnNlIGVycm9yLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGxpdFJlc3VsdCB7XG4gIHN0YWdlczogU2ltcGxlQ29tbWFuZFtdO1xuICAvKipcbiAgICogU2V0IHdoZW4gdGhlIGlucHV0IGlzIGEgQmFzaCBwYXJzZSBlcnJvciBcdTIwMTQgYmFzaCByZWplY3RzIHRoZSBlbnRpcmUgbGlzdCBhdFxuICAgKiBwYXJzZSB0aW1lIChleGl0IDIsIG5vdGhpbmcgZXhlY3V0ZWQpLCBzbyBhbnkgc3RhZ2UtZGVyaXZlZCB0b3VjaCB3b3VsZCBiZVxuICAgKiBhIHBoYW50b20uIFRoZSByZWplY3Rpb24gaXMgbGlzdC1zY29wZWQgYW5kIHRlcm1pbmFsIChwbGFuIFx1MDBBNzEpOiB0aGUgc3RhZ2VcbiAgICogbGlzdCBrZWVwcyBldmVyeSBzdGFnZSBmcm9tIGNvbXBsZXRlZCBlYXJsaWVyIGxpc3RzLCBkcm9wcyB0aGUgcmVqZWN0aW5nXG4gICAqIGxpc3QncyBvd24gc3RhZ2VzLCBhbmQgc3RvcHMgYXQgaXQgXHUyMDE0IGV2ZXJ5IGxhdGVyIHVuaXQgaXMgZGVhZC5cbiAgICovXG4gIG1hbGZvcm1lZD86IE1hbGZvcm1lZFZlcmRpY3Q7XG59XG5cbi8qKiBUaGUgY29uc3RydWN0IGtpbmRzIHRoZSBraW5kLW1hdGNoZWQgc3RhY2sgdHJhY2tzIChwbGFuIFx1MDBBNzMpLiAqL1xudHlwZSBDb25zdHJ1Y3RLaW5kID0gJ2lmJyB8ICdsb29wJyB8ICdmb3InIHwgJ3NlbGVjdCcgfCAnYnJhY2UnO1xuXG4vKiogT25lIG9wZW4gY29uc3RydWN0OiBpdHMga2luZCwgYW5kIHdoZXRoZXIgYSBib2R5IHdvcmQgaGFzIGJlZW4gc2Vlbi4gKi9cbmludGVyZmFjZSBPcGVuQ29uc3RydWN0IHtcbiAga2luZDogQ29uc3RydWN0S2luZDtcbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBib2R5IGhhcyBzdGFydGVkLiBGb3IgYGlmYCB0aGUgYm9keSBzdGFydHMgYXQgYHRoZW5gL2BlbHNlYC9cbiAgICogYGVsaWZgLCBmb3IgbG9vcHMgYXQgYGRvYCwgZm9yIGJyYWNlIGdyb3VwcyBhdCBhbnkgY29tbWFuZCB3b3JkIFx1MjAxNCBhXG4gICAqIGNsb3NlciB3aXRoIG5vIGJvZHkgKGBpZiB4OyBmaWAsIGB7IH1gKSBpcyBhIEJhc2ggcGFyc2UgZXJyb3IuXG4gICAqL1xuICBib2R5OiBib29sZWFuO1xufVxuXG4vKiogVGhlIGNhc2UgcmVnaW9uJ3MgcG9zaXRpb24gc3RhdGUgKHBsYW4gXHUwMEE3MykuICovXG50eXBlIENhc2VQb3MgPSAnc3ViamVjdCcgfCAncGF0dGVybi1zdGFydCcgfCAncGF0dGVybicgfCAnY29tbWFuZCc7XG5cbi8qKiBBbiBvcGVuIGNhc2UgcmVnaW9uOiBvcGFxdWUgY29udGVudCBvd25lZCBieSB0aGUgY2FzZSBzY2FuLiAqL1xuaW50ZXJmYWNlIENhc2VSZWdpb24ge1xuICBwb3M6IENhc2VQb3M7XG4gIC8qKiBJbiBhIGBjb21tYW5kYCBwb3NpdGlvbjogd2hldGhlciB0aGUgY3VycmVudCBsaXN0IGl0ZW0gaXMgc3RpbGwgZW1wdHkgKG9ubHkgYClgLCBgO2AsIGAmYCwgYW5kIG5ld2xpbmVzIHJlc2V0IGl0KS4gKi9cbiAgY21kRW1wdHk6IGJvb2xlYW47XG4gIC8qKiBUaGUgcmVnaW9uJ3Mgb3duIHBhcmVuIGRlcHRoIFx1MjAxNCBnbG9iYWwgcGFyZW4gZGVwdGggaXMgZnJvemVuIHdoaWxlIHRoZSByZWdpb24gaXMgb3BlbiAodGhlIHJlZ2lvbiBpcyBub3QgYSBzdGFjazsgaXQgb3V0bGl2ZXMgcGFyZW4gY2xvc2VzKS4gKi9cbiAgbG9jYWxEZXB0aDogbnVtYmVyO1xufVxuXG4vKiogQSBwZW5kaW5nIGhlcmVkb2Mgd2hvc2UgYm9keSBoYXMgbm90IHN0YXJ0ZWQgeWV0IChvciB3aG9zZSBib2R5IGlzIGJlaW5nIHNjYW5uZWQpLiAqL1xuaW50ZXJmYWNlIFBlbmRpbmdIZXJlZG9jIHtcbiAgLyoqIFRoZSBsaW5lIHRoYXQgY2xvc2VzIHRoZSBib2R5OiB0aGUgZGVsaW1pdGVyLCBvcHRpb25hbGx5IGBcXHRgLXByZWZpeGVkIGZvciBgPDwtYCwgd2l0aCBvcHRpb25hbCB0cmFpbGluZyB3aGl0ZXNwYWNlLiAqL1xuICBjbG9zZTogUmVnRXhwO1xufVxuXG4vKiogVGhlIHdvcmRzIHRoYXQgcHV0IHRoZSBwYXJzZXIgYmFjayBhdCBjb21tYW5kIHN0YXJ0IHdoZW4gdGhleSBhcmUgdGhlIGJ1ZmZlcidzIGxhc3Qgd29yZCAocGxhbiBcdTAwQTczKS4gKi9cbmNvbnN0IENPTU1BTkRfT1BFTkVSX1dPUkRTID0gbmV3IFNldChbJ2RvJywgJ3RoZW4nLCAnZWxzZScsICdlbGlmJywgJ2lmJywgJ3doaWxlJywgJ3VudGlsJywgJyEnLCAndGltZScsICd7JywgJygnXSk7XG5cbi8qKiBXb3JkIGNoYXJzIGVuZCBhdCB3aGl0ZXNwYWNlIGFuZCB0aGUgb3BlcmF0b3IvcGFyZW4vcmVkaXJlY3QgbWV0YWNoYXJzLiAqL1xuY29uc3QgV09SRF9FTkQgPSAvW1xcczsmfCgpPD5dLztcblxuZnVuY3Rpb24gZXNjYXBlUmVnRXhwKHM6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG59XG5cbi8qKlxuICogU3BsaXQgYSBjb21tYW5kIHN0cmluZyBpbnRvIHNpbXBsZS1jb21tYW5kIHN1YnN0cmluZ3MgYXQgdG9wLWxldmVsICYmLCB8fCxcbiAqIDssIHwsIHwmLCAmLCBhbmQgbmV3bGluZSBib3VuZGFyaWVzLiBRdW90ZXMgYW5kICQoKS9gYC8oKSBuZXN0aW5nIGFyZVxuICogcmVzcGVjdGVkIChub3Qgc3BsaXQgaW5zaWRlKTsgYCNgIGNvbW1lbnRzIGFuZCBgJHtcdTIwMjZ9YCBicmFjZSBjb250ZW50IGFyZVxuICogb3BhcXVlLCBwaXBlL2FuZC9vciBuZXdsaW5lcyBhcmUgbGluZSBjb250aW51YXRpb25zLCBhbmQgQmFzaCBwYXJzZSBlcnJvcnNcbiAqIChwbGFuIFx1MDBBNzEpIGNvbWUgYmFjayBhcyBhIGBtYWxmb3JtZWRgIHZlcmRpY3Qgd2l0aCB0aGUgc3RhZ2UgbGlzdCB0cnVuY2F0ZWRcbiAqIGF0IHRoZSByZWplY3RpbmcgbGlzdC5cbiAqXG4gKiBQaGFzZSAyIChwbGFuIFx1MDBBNzMpIGFkZHMgdGhyZWUgbWFjaGluZXM6XG4gKlxuICogLSBUaGUga2luZC1tYXRjaGVkIGNvbnN0cnVjdCBzdGFjazogYGlmYC9gd2hpbGVgL2B1bnRpbGAvYGZvcmAvYHNlbGVjdGAvXG4gKiAgIGB7YC9gfWAvYGZ1bmN0aW9uYCBvcGVuIGNvbnN0cnVjdCBmcmFtZXMgYXQgY29tbWFuZCBwb3NpdGlvbiwgY29udGV4dFxuICogICBrZXl3b3JkcyAoYGRvYCwgYHRoZW5gLCBgZWxzZWAsIGBlbGlmYCwgYGluYCkgYW5kIGNsb3NlcnMgKGBmaWAsIGBkb25lYCxcbiAqICAgYGVzYWNgLCBgfWApIHJlcXVpcmUgYSBtYXRjaGluZyBvcGVuZXIgb24gdG9wIG9mIHRoZSBzdGFjayAod2l0aCB0aGVcbiAqICAgcmlnaHQgYm9keSBzdGF0ZSksIGFuZCB3aGlsZSBhIGNvbnN0cnVjdCBpcyBvcGVuIGF0IGRlcHRoIDAgdGhlIGJvdW5kYXJ5XG4gKiAgIG9wZXJhdG9ycyBhcmUgdGV4dCBcdTIwMTQgdGhlIGNvbnN0cnVjdCBmb2xkcyB0byBvbmUgc3RhZ2UuIEVhY2ggYChgIHB1c2hlcyBhXG4gKiAgIGZyZXNoIHN0YWNrIGFuZCBlYWNoIGApYCBmaXJlcyAndW5jbG9zZWQtY29uc3RydWN0JyB3aGVuIGl0cyBsZXZlbCBpc1xuICogICBub24tZW1wdHkgKGZpcmUtYmVmb3JlLXJlc3RvcmUpLlxuICpcbiAqIC0gVGhlIGNhc2UtcmVnaW9uIG1hY2hpbmU6IGBjYXNlYCBpbiBjb21tYW5kIHBvc2l0aW9uIG9wZW5zIGEgcmVnaW9uIGNsb3NlZFxuICogICBieSBhIG1hdGNoaW5nIGBlc2FjYC4gVGhlIHJlZ2lvbidzIGNvbnRlbnQgaXMgb3BhcXVlIFx1MjAxNCBwYXR0ZXJuIGApYHMgYW5kXG4gKiAgIGB8YHMgYXJlIHBhdHRlcm4gc3ludGF4LCBub3QgcGFyZW5zL3BpcGVzIFx1MjAxNCB3aXRoIGl0cyBvd24gcGFyZW4gZGVwdGhcbiAqICAgKHRoZSBnbG9iYWwgZGVwdGggZnJlZXplcyB3aGlsZSBvcGVuKSwgYDs7YC9gOyZgL2A7OyZgIHJldHVybmluZyB0b1xuICogICBwYXR0ZXJuLXN0YXJ0IGFuZCBgKWAsIGA7YCwgYCZgLCBhbmQgbmV3bGluZXMgdG8gY29tbWFuZCBzdGFydC4gQSByZWdpb25cbiAqICAgb3BlbiBhdCBFT0YgaXMgJ3VuY2xvc2VkLWNhc2UnLlxuICpcbiAqIC0gVGhlIGhlcmVkb2MgbWFjaGluZXJ5OiBgPDxgL2A8PC1gIGF0IGRlcHRoIDAgd2l0aCBhIGRlbGltaXRlciB3b3JkIHN0cmlwc1xuICogICB0aGUgb3BlcmF0b3IrZGVsaW1pdGVyIGZyb20gdGhlIHN0YWdlIHRleHQgYW5kIHNjYW5zIGJvZHkgbGluZXMgcmF3IHVudGlsXG4gKiAgIHRoZSBkZWxpbWl0ZXIgbGluZTsgYW4gdW50ZXJtaW5hdGVkIGhlcmVkb2MgaXMgdGhlICd1bnRlcm1pbmF0ZWQtaGVyZWRvYydcbiAqICAgcGFydGlhbCBcdTIwMTQgdGhlIGRlbGltaXRlcidzIGxpbmUgKGFuZCBldmVyeXRoaW5nIGJlZm9yZSBpdCkgYW5hbHl6ZXNcbiAqICAgbm9ybWFsbHkgYW5kIHRoZSBib2R5IHByb2R1Y2VzIG5vIHN0YWdlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNwbGl0VG9wTGV2ZWwoY21kOiBzdHJpbmcpOiBTcGxpdFJlc3VsdCB7XG4gIGNvbnN0IHBhcnRzOiBTaW1wbGVDb21tYW5kW10gPSBbXTtcbiAgbGV0IGJ1ZiA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBjbWQubGVuZ3RoO1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgYnJhY2VEZXB0aCA9IDA7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgbGV0IHBlbmRpbmdPcDogT3BlcmF0b3IgPSAnc3RhcnQnO1xuICAvKiogU2V0IHdoZW4gdGhlIGN1cnJlbnQgbGlzdCBpcyBhIEJhc2ggcGFyc2UgZXJyb3I7IHRoZSBzY2FuIHN0b3BzIGF0IGl0IChwbGFuIFx1MDBBNzEsIGxpc3Qtc2NvcGUgKyB0ZXJtaW5hbCkuICovXG4gIGxldCBtYWxmb3JtZWQ6IE1hbGZvcm1lZFZlcmRpY3QgfCB1bmRlZmluZWQ7XG4gIC8qKiBJbmRleCBpbnRvIGBwYXJ0c2Agd2hlcmUgdGhlIGN1cnJlbnQgbGlzdCBiZWdhbiBcdTIwMTQgdGhlIHJlamVjdGluZyBsaXN0J3Mgc3RhZ2VzIGFyZSBkcm9wcGVkIGJ5IHJvbGxpbmcgYmFjayB0byBpdC4gKi9cbiAgbGV0IGxpc3RTdGFydCA9IDA7XG5cbiAgLyoqIFJlcG9ydCBhIG1hbGZvcm1lZCBsaXN0OiBkcm9wIGl0cyBzdGFnZXMgKGNvbXBsZXRlZCBlYXJsaWVyIGxpc3RzIHN0YXkpLCBhbmQgc3RvcCB0aGUgc2NhbiBcdTIwMTQgYmFzaCBhYm9ydHMgYXQgdGhlIGZpcnN0IHBhcnNlIGVycm9yLiAqL1xuICBjb25zdCByZWplY3QgPSAodjogTWFsZm9ybWVkVmVyZGljdCkgPT4ge1xuICAgIG1hbGZvcm1lZCA9IHY7XG4gICAgcGFydHMubGVuZ3RoID0gbGlzdFN0YXJ0O1xuICAgIGkgPSBuO1xuICB9O1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgcGlwZS9hbmQvb3Igb3BlcmF0b3IgaXMgcGVuZGluZyB3aXRoIGEgd2hpdGVzcGFjZS1vbmx5IGJ1ZmZlclxuICAgKiBzaW5jZSBpdC4gQSBoZWxwZXIgcmF0aGVyIHRoYW4gYW4gaW5saW5lIGNvbXBhcmlzb246IFR5cGVTY3JpcHQnc1xuICAgKiBjb250cm9sLWZsb3cgbmFycm93aW5nIGNhbm5vdCBzZWUgdGhlIGFzc2lnbm1lbnRzIGBmbHVzaGAgbWFrZXMgdG9cbiAgICogYHBlbmRpbmdPcGAgZnJvbSBpbnNpZGUgaXRzIGNsb3N1cmUsIGFuZCB3b3VsZCBvdGhlcndpc2UgbmFycm93IHRoZVxuICAgKiBkaXJlY3QgY29tcGFyaXNvbiB0byB0aGUgaW5pdGlhbGl6ZXIgYCdzdGFydCdgLlxuICAgKi9cbiAgY29uc3QgaXNVbmNvbnN1bWVkT3BlcmF0b3IgPSAoKTogYm9vbGVhbiA9PlxuICAgIChwZW5kaW5nT3AgPT09ICdwaXBlJyB8fCBwZW5kaW5nT3AgPT09ICdhbmQnIHx8IHBlbmRpbmdPcCA9PT0gJ29yJykgJiYgYnVmLnRyaW0oKSA9PT0gJyc7XG5cbiAgLyoqIFRoZSBidWZmZXIncyBsYXN0IHdoaXRlc3BhY2UtZGVsaW1pdGVkIHdvcmQgKCcnIHdoZW4gdGhlIGJ1ZmZlciBpcyBlbXB0eSkuICovXG4gIGNvbnN0IGxhc3RXb3JkID0gKCk6IHN0cmluZyA9PiBidWYudHJpbUVuZCgpLm1hdGNoKC9cXFMrJC8pPy5bMF0gPz8gJyc7XG5cbiAgLyoqXG4gICAqIFJlZGlyZWN0IG9wZXJhdG9ycyB0aGF0IGFyZSBtaXNzaW5nIHRoZWlyIHRhcmdldCB3b3JkIHdoZW4gdGhleSBhcmUgdGhlXG4gICAqIGJ1ZmZlcidzIGxhc3Qgd29yZCAocGxhbiBcdTAwQTcxKTogYSB0YXJnZXQgbXVzdCBiZSBhIHBsYWluIHdvcmQsIHNvIGV2ZXJ5XG4gICAqIG5vbi1zZWxmLWNvbXBsZXRlIGZvcm0gaXMgYSBwYXJzZSBlcnJvci4gRHVwIGZvcm1zIHdpdGggYm90aCBmZHMgcHJlc2VudFxuICAgKiAoYDI+JjFgLCBgPiYtYCwgYDM8JjBgKSBhbmQgZnVzZWQgd29yZHMgKGA+b3V0YCwgYDI+ZXJyYCwgYDw8RU9GYCxcbiAgICogYCY+b3V0YCkgYXJlIGNvbXBsZXRlIGFuZCBuZXZlciBtYXRjaC5cbiAgICovXG4gIGNvbnN0IERBTkdMSU5HX1JFRElSRUNUX1dPUkQgPSAvXig/Oj58Pj58Jj58Jj4+fD5cXHx8PHw8Pnw8PHw8PC18PDw8fD4mfFxcZCsoPzo+fD4+fD5cXHx8PHw8Pnw8PHw8PC18PDw8fD4mfDwmKSkkLztcblxuICBjb25zdCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCA9ICgpOiBib29sZWFuID0+IERBTkdMSU5HX1JFRElSRUNUX1dPUkQudGVzdChsYXN0V29yZCgpKTtcblxuICAvKiogV2hldGhlciB0aGUgY3VycmVudCBjaGFyIHN0YXJ0cyBhIG5ldyB3b3JkIGluIHRoZSBidWZmZXIgKGVtcHR5IGJ1ZmZlciwgb3IgcHJlY2VkZWQgYnkgd2hpdGVzcGFjZSkuICovXG4gIGNvbnN0IGlzV29yZFN0YXJ0ID0gKCk6IGJvb2xlYW4gPT4gYnVmID09PSAnJyB8fCAvXFxzJC8udGVzdChidWYpO1xuXG4gIC8qKiBXaGV0aGVyIGEgcmVkaXJlY3QgdG9rZW4gYmVnaW5zIGF0IGBpYDogYSBgPmAvYDxgIGZvcm0sIGAmPmAsIG9yIGEgZGlnaXQtcHJlZml4ZWQgZm9ybSBsaWtlIGAyPmAvYDI+JjFgLiAqL1xuICBjb25zdCBzdGFydHNSZWRpcmVjdEF0ID0gKGk6IG51bWJlcik6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IGMgPSBjbWRbaV07XG4gICAgaWYgKGMgPT09ICc+JyB8fCBjID09PSAnPCcpIHJldHVybiB0cnVlO1xuICAgIGlmIChjID09PSAnJicpIHJldHVybiBjbWRbaSArIDFdID09PSAnPic7XG4gICAgaWYgKGMgPj0gJzAnICYmIGMgPD0gJzknKSB7XG4gICAgICBsZXQgaiA9IGk7XG4gICAgICB3aGlsZSAoaiA8IG4gJiYgY21kW2pdID49ICcwJyAmJiBjbWRbal0gPD0gJzknKSBqICs9IDE7XG4gICAgICByZXR1cm4gY21kW2pdID09PSAnPicgfHwgY21kW2pdID09PSAnPCc7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfTtcblxuICAvKipcbiAgICogV2hldGhlciBhIG5ldyBjb21tYW5kIGNhbiBzdGFydCBoZXJlOiB0aGUgYnVmZmVyIGlzIGVtcHR5LCBhIGJvdW5kYXJ5XG4gICAqIG9wZXJhdG9yIG9yIGAoYC9gKWAgcHJlY2VkZXMsIHRoZSBidWZmZXIgZW5kcyB3aXRoIGEgbmV3bGluZSAoYSBuZXdsaW5lXG4gICAqIGluc2lkZSBhbiBvcGVuIGNvbnN0cnVjdCBpcyB0ZXh0IGJ1dCBzdGlsbCBlbmRzIHRoZSBsaXN0IGl0ZW0pLCBvciB0aGVcbiAgICogbGFzdCB3b3JkIGV4cGVjdHMgYSBjb21tYW5kIGJvZHkgKGB0aGVuYCwgYGRvYCwgYHtgLCBcdTIwMjYpLlxuICAgKi9cbiAgY29uc3QgaXNDb21tYW5kUG9zaXRpb24gPSAoKTogYm9vbGVhbiA9PlxuICAgIGJ1Zi50cmltKCkgPT09ICcnIHx8IC9cXG4kLy50ZXN0KGJ1ZikgfHwgL1s7JnwoKV0kLy50ZXN0KGJ1Zi50cmltRW5kKCkpIHx8IENPTU1BTkRfT1BFTkVSX1dPUkRTLmhhcyhsYXN0V29yZCgpKTtcblxuICBjb25zdCBmbHVzaCA9IChuZXh0T3A6IE9wZXJhdG9yKSA9PiB7XG4gICAgY29uc3QgcyA9IGJ1Zi50cmltKCk7XG4gICAgaWYgKHMpIHtcbiAgICAgIC8vIGAhYCBpbiBwaXBlIHBvc2l0aW9uIGlzIGEgcGFyc2UgZXJyb3IgKHBsYW4gXHUwMEE3MSk6IHRoZSBmaXJzdCB3b3JkIG9mIGFcbiAgICAgIC8vIHBpcGUtcHJlY2VkZWQgc3RhZ2UgbWF5IG5vdCBiZSBgIWAgKGBmYWxzZSB8ICEgdHJ1ZWAsIGBjYXQgZiB8XFxuISB0cnVlYCkuXG4gICAgICBpZiAocGVuZGluZ09wID09PSAncGlwZScgJiYgKHMgPT09ICchJyB8fCAvXiFcXHMvLnRlc3QocykpKSB7XG4gICAgICAgIHJlamVjdCgncGlwZS1iYW5nJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHBhcnRzLnB1c2goeyB0ZXh0OiBzLCBwcmVjZWRlZEJ5OiBwZW5kaW5nT3AgfSk7XG4gICAgfVxuICAgIGJ1ZiA9ICcnO1xuICAgIHBlbmRpbmdPcCA9IG5leHRPcDtcbiAgfTtcblxuICAvLyBUaGUga2luZC1tYXRjaGVkIGNvbnN0cnVjdCBzdGFjaywgb25lIGxpc3QgcGVyIHBhcmVuIGxldmVsOiBgKGAgcHVzaGVzIGFcbiAgLy8gZnJlc2ggbGV2ZWwsIGApYCBwb3BzIGl0IGFuZCBmaXJlcyB3aGVuIGl0IGlzIG5vbi1lbXB0eSBcdTIwMTQgYW4gdW5jbG9zZWRcbiAgLy8gY29uc3RydWN0IGNhbm5vdCBvdXRsaXZlIHRoZSBzdWJzaGVsbCB0aGF0IGNsb3NlZCAocGxhbiBcdTAwQTczKS5cbiAgY29uc3QgbGV2ZWxzOiBPcGVuQ29uc3RydWN0W11bXSA9IFtbXV07XG4gIGNvbnN0IHRvcCA9ICgpOiBPcGVuQ29uc3RydWN0IHwgdW5kZWZpbmVkID0+IHtcbiAgICBjb25zdCBsdiA9IGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV07XG4gICAgcmV0dXJuIGx2Lmxlbmd0aCA+IDAgPyBsdltsdi5sZW5ndGggLSAxXSA6IHVuZGVmaW5lZDtcbiAgfTtcbiAgLyoqIFNldCBieSBvcGVuZXJzIGFuZCBib2R5IGtleXdvcmRzLCBjbGVhcmVkIGJ5IG90aGVyIHdvcmRzIGFuZCBgKGAgXHUyMDE0IGFuIG9wZXJhdG9yIG9yIGNsb3NlciBkaXJlY3RseSBhZnRlciBpdCBpcyBhbiBlbXB0eS1saXN0IHBhcnNlIGVycm9yIChgaWYgdHJ1ZTsgdGhlbjsgZmlgLCBgeyA7IH1gKS4gKi9cbiAgbGV0IGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAvKiogYGZ1bmN0aW9uYCBzZWVuOyB0aGUgbmV4dCB3b3JkIGlzIHRoZSBmdW5jdGlvbiBuYW1lLCBhbmQgYHtgIHJpZ2h0IGFmdGVyIGl0IG9wZW5zIHRoZSBkZWZpbml0aW9uIGJvZHkuICovXG4gIGxldCBmdW5jdGlvblNlZW4gPSBmYWxzZTtcbiAgbGV0IG5hbWVTZWVuID0gZmFsc2U7XG5cbiAgLy8gVGhlIG9wZW4gY2FzZSByZWdpb24sIGlmIGFueSAocGxhbiBcdTAwQTczKS4gV2hpbGUgb3BlbiwgaXRzIGNvbnRlbnQgaXMgb3BhcXVlXG4gIC8vIHRvIGV2ZXJ5IG90aGVyIG1hY2hpbmU6IHRoZSBnbG9iYWwgcGFyZW4gZGVwdGggaXMgZnJvemVuLCB0aGUgY29uc3RydWN0XG4gIC8vIHN0YWNrIGlzIHVudG91Y2hlZCwgYW5kIGJvdW5kYXJ5IG9wZXJhdG9ycyBhcmUgdGV4dC5cbiAgbGV0IGNhc2VSZWdpb246IENhc2VSZWdpb24gfCBudWxsID0gbnVsbDtcblxuICAvLyBQZW5kaW5nIGhlcmVkb2NzIChwbGFuIFx1MDBBNzMpOiBgPDxgL2A8PC1gIGF0IGRlcHRoIDAgd2l0aCBhIGRlbGltaXRlciB3b3JkLlxuICBjb25zdCBoZXJlZG9jczogUGVuZGluZ0hlcmVkb2NbXSA9IFtdO1xuICAvKiogSW4gdGhlIGJvZHkgb2YgYSBwZW5kaW5nIGhlcmVkb2MgXHUyMDE0IGxpbmVzIGFyZSBzY2FubmVkIHJhdyBmb3IgdGhlIGNsb3NlIGxpbmUuICovXG4gIGxldCBpbkJvZHkgPSBmYWxzZTtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gY21kW2ldO1xuICAgIGlmIChpblNxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gXCInXCIpIGluU3F1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRHF1b3RlKSB7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICAgIGJ1ZiArPSBjbWRbaSArIDFdO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIGluRHF1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBpblNxdW90ZSA9IHRydWU7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGJ1ZiArPSBjICsgY21kW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBgJHtcdTIwMjZ9YCBjb250ZW50IGlzIG9wYXF1ZSAocGxhbiBcdTAwQTcxKTogbmVzdGVkIGV4cGFuc2lvbnMgbmVzdCwgYW5kIHdoaWxlXG4gICAgLy8gdGhlIGJyYWNlIGRlcHRoIGlzIHBvc2l0aXZlIG5vdGhpbmcgaW5zaWRlIGNvdW50cyBwYXJlbnMsIHNwbGl0c1xuICAgIC8vIG9wZXJhdG9ycywgc3RhcnRzIGNvbW1lbnRzLCBvciByZWNvZ25pemVzIGNvbnN0cnVjdHMgXHUyMDE0IGAke3glKX1gLFxuICAgIC8vIGAke3gvLygvfWAsIGFuZCBgJHt4Oi0kKGVjaG8geSl9YCBhcmUgYWxsIHZhbGlkLlxuICAgIGlmIChicmFjZURlcHRoID4gMCkge1xuICAgICAgaWYgKGMgPT09ICd9JykgYnJhY2VEZXB0aCAtPSAxO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gSGVyZWRvYyBib2R5IG1vZGU6IHNjYW4gbGluZXMgcmF3IHVudGlsIHRoZSBmaXJzdCBwZW5kaW5nIGhlcmVkb2Mnc1xuICAgIC8vIGNsb3NlIGxpbmUgKGEgbGluZSB0aGF0IGlzIGV4YWN0bHkgdGhlIGRlbGltaXRlciwgb3B0aW9uYWxseSB0YWItXG4gICAgLy8gcHJlZml4ZWQgZm9yIGA8PC1gLCB3aXRoIG9wdGlvbmFsIHRyYWlsaW5nIHdoaXRlc3BhY2UpLiBUaGUgYm9keSBpc1xuICAgIC8vIG9wYXF1ZSBcdTIwMTQgaXQgcHJvZHVjZXMgbm8gc3RhZ2VzIFx1MjAxNCBhbmQgdW50ZXJtaW5hdGVkIGJvZGllcyBlbmQgYXQgRU9GLlxuICAgIGlmIChpbkJvZHkpIHtcbiAgICAgIGNvbnN0IGxpbmVFbmQgPSBjbWQuaW5kZXhPZignXFxuJywgaSk7XG4gICAgICBjb25zdCBsaW5lID0gbGluZUVuZCA9PT0gLTEgPyBjbWQuc2xpY2UoaSkgOiBjbWQuc2xpY2UoaSwgbGluZUVuZCk7XG4gICAgICBpZiAoaGVyZWRvY3NbMF0uY2xvc2UudGVzdChsaW5lKSkge1xuICAgICAgICBoZXJlZG9jcy5zaGlmdCgpO1xuICAgICAgICBpZiAoaGVyZWRvY3MubGVuZ3RoID09PSAwKSBpbkJvZHkgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGlmIChsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA+IDAgfHwgY2FzZVJlZ2lvbiAhPT0gbnVsbCkge1xuICAgICAgICAvLyBJbnNpZGUgYW4gb3BlbiBjb25zdHJ1Y3QgdGhlIGJvZHkgbGluZSBmb2xkcyBpbnRvIHRoZSBjb25zdHJ1Y3Qnc1xuICAgICAgICAvLyBpbnRlcmlvciB0ZXh0IChhIG5ld2xpbmUgaW5zaWRlIGFuIG9wZW4gY29uc3RydWN0IGlzIG5vdCBhXG4gICAgICAgIC8vIGJvdW5kYXJ5LCBwbGFuIFx1MDBBNzEpIFx1MjAxNCB0aGUgaW50ZXJpb3IgcmUtc3BsaXQgcmUtc2NhbnMgaXQgYXMgYm9keS5cbiAgICAgICAgYnVmICs9IGxpbmU7XG4gICAgICAgIGlmIChsaW5lRW5kICE9PSAtMSkgYnVmICs9ICdcXG4nO1xuICAgICAgfVxuICAgICAgaSA9IGxpbmVFbmQgPT09IC0xID8gbiA6IGxpbmVFbmQgKyAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFRoZSBuZXdsaW5lIHJpZ2h0IGFmdGVyIGEgaGVyZWRvYydzIGRlbGltaXRlciBsaW5lIGVuZHMgdGhlIGRlbGltaXRlcidzXG4gICAgLy8gbGluZSBcdTIwMTQgaXQgc3BsaXRzIG5vcm1hbGx5IChhIGNvbXBsZXRlZCBsaXN0LCBidXQgd2l0aG91dCBhZHZhbmNpbmdcbiAgICAvLyBgbGlzdFN0YXJ0YDogYSBjb21wbGV0ZW5lc3MgdmlvbGF0aW9uIHRoYXQgcmVqZWN0cyBsYXRlciBkcm9wcyB0aGVcbiAgICAvLyBkZWxpbWl0ZXIncy1saW5lIHN0YWdlIHRvbykgXHUyMDE0IGFuZCBzdGFydHMgdGhlIGJvZHkuIEluc2lkZSBhbiBvcGVuXG4gICAgLy8gY29uc3RydWN0IHRoZSBuZXdsaW5lIGlzIG5vdCBhIGJvdW5kYXJ5OiB0aGUgZGVsaW1pdGVyJ3MgbGluZSwgdGhlXG4gICAgLy8gYm9keSwgYW5kIHRoZSBjbG9zZSBsaW5lIGFsbCBmb2xkIGludG8gdGhlIGNvbnN0cnVjdCdzIG9uZSBzdGFnZSwgYW5kXG4gICAgLy8gdGhlIHdhbGsncyBpbnRlcmlvciByZS1zcGxpdCBhcHBsaWVzIHRoZSBzYW1lIGhlcmVkb2MgbWFjaGluZXJ5IHRoZXJlLlxuICAgIGlmIChjID09PSAnXFxuJyAmJiBoZXJlZG9jcy5sZW5ndGggPiAwKSB7XG4gICAgICBpZiAobGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPiAwIHx8IGNhc2VSZWdpb24gIT09IG51bGwpIHtcbiAgICAgICAgYnVmICs9IGM7XG4gICAgICAgIGluQm9keSA9IHRydWU7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBmbHVzaCgnbmV3bGluZScpO1xuICAgICAgaW5Cb2R5ID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBgI2AgYmVnaW5zIGEgY29tbWVudCB3aGVuIGl0IHN0YXJ0cyBhIHdvcmQgYXQgZGVwdGggMCAoZW1wdHkgYnVmZmVyIG9yXG4gICAgLy8gcHJlY2VkZWQgYnkgd2hpdGVzcGFjZSk7IGNvbW1lbnRzIHJ1biB0byB0aGUgbmV3bGluZSwga2VlcGluZyB0aGUgYnVmZmVyXG4gICAgLy8gZW1wdHkgZm9yIHRoZSBjb250aW51YXRpb24gcnVsZS4gTWlkLXdvcmQgYW5kIHF1b3RlZCBgI2AgYXJlIHRleHQsIGFuZFxuICAgIC8vIGNvbW1lbnRzIGluc2lkZSBwYXJlbnMgYXJlIG9wYXF1ZSBsaWtlIGV2ZXJ5dGhpbmcgZWxzZSB0aGVyZSAocGxhbiBcdTAwQTcxKS5cbiAgICBpZiAoYyA9PT0gJyMnICYmIGRlcHRoID09PSAwICYmIGlzV29yZFN0YXJ0KCkpIHtcbiAgICAgIHdoaWxlIChpIDwgbiAmJiBjbWRbaV0gIT09ICdcXG4nKSBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVGhlIGNhc2UtcmVnaW9uIHNjYW4gb3ducyBldmVyeXRoaW5nIGF0IGl0cyBsb2NhbCBkZXB0aCAwIFx1MjAxNCBwYXR0ZXJuXG4gICAgLy8gc3ludGF4LCBsaXN0IHRlcm1pbmF0b3JzLCBhbmQgd29yZHMgXHUyMDE0IHdoaWxlIHRoZSByZWdpb24gaXMgb3Blbi5cbiAgICBpZiAoY2FzZVJlZ2lvbikge1xuICAgICAgY29uc3QgciA9IGNhc2VSZWdpb247XG4gICAgICBpZiAoci5sb2NhbERlcHRoID09PSAwKSB7XG4gICAgICAgIGNvbnN0IHMyID0gY21kLnNsaWNlKGksIGkgKyAyKTtcbiAgICAgICAgY29uc3QgczMgPSBjbWQuc2xpY2UoaSwgaSArIDMpO1xuICAgICAgICAvLyBgOztgL2A7JmAvYDs7JmAgZW5kIHRoZSBjdXJyZW50IHBhdHRlcm4gbGlzdCBcdTIwMTQgYmFjayB0byBwYXR0ZXJuLXN0YXJ0LlxuICAgICAgICBpZiAoczMgPT09ICc7OyYnIHx8IHMyID09PSAnOzsnIHx8IHMyID09PSAnOyYnKSB7XG4gICAgICAgICAgci5wb3MgPSAncGF0dGVybi1zdGFydCc7XG4gICAgICAgICAgYnVmICs9IHMzID09PSAnOzsmJyA/IHMzIDogczI7XG4gICAgICAgICAgaSArPSBzMyA9PT0gJzs7JicgPyAzIDogMjtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICAvLyBgO2AgcmV0dXJucyB0byBjb21tYW5kIHN0YXJ0IChhIGA7O2Agd2FzIGhhbmRsZWQgYWJvdmUpLlxuICAgICAgICBpZiAoYyA9PT0gJzsnKSB7XG4gICAgICAgICAgci5wb3MgPSAnY29tbWFuZCc7XG4gICAgICAgICAgci5jbWRFbXB0eSA9IHRydWU7XG4gICAgICAgICAgYnVmICs9IGM7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIC8vIEEgc2luZ2xlIGAmYCAobm90IHBhcnQgb2YgYSByZWRpcmVjdCBvciBgJiZgKSBpcyB0aGUgYmFja2dyb3VuZFxuICAgICAgICAvLyBvcGVyYXRvciBcdTIwMTQgYWxzbyBjb21tYW5kIHN0YXJ0LlxuICAgICAgICBjb25zdCBsYXN0ID0gYnVmW2J1Zi5sZW5ndGggLSAxXTtcbiAgICAgICAgaWYgKGMgPT09ICcmJyAmJiBjbWRbaSArIDFdICE9PSAnPicgJiYgY21kW2kgKyAxXSAhPT0gJyYnICYmIGxhc3QgIT09ICc+JyAmJiBsYXN0ICE9PSAnPCcpIHtcbiAgICAgICAgICByLnBvcyA9ICdjb21tYW5kJztcbiAgICAgICAgICByLmNtZEVtcHR5ID0gdHJ1ZTtcbiAgICAgICAgICBidWYgKz0gYztcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICdcXG4nKSB7XG4gICAgICAgICAgLy8gQSBwYXR0ZXJuIGNhbm5vdCBjb250aW51ZSBhY3Jvc3MgYSBuZXdsaW5lIChiYXNoIGVycm9ycyksIGJ1dCBhXG4gICAgICAgICAgLy8gbmV3bGluZSBhZnRlciBgaW5gIG9yIGluc2lkZSBhIGxpc3QgaXRlbSBpcyBmaW5lLlxuICAgICAgICAgIGlmIChyLnBvcyA9PT0gJ3BhdHRlcm4nKSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNhc2UnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoci5wb3MgPT09ICdjb21tYW5kJykgci5jbWRFbXB0eSA9IHRydWU7XG4gICAgICAgICAgYnVmICs9IGM7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnIycgJiYgaXNXb3JkU3RhcnQoKSkge1xuICAgICAgICAgIC8vIEEgY29tbWVudCBpbnNpZGUgdGhlIHJlZ2lvbiBydW5zIHRvIHRoZSBuZXdsaW5lIGxpa2Ugb3V0c2lkZS5cbiAgICAgICAgICB3aGlsZSAoaSA8IG4gJiYgY21kW2ldICE9PSAnXFxuJykgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChpc1dvcmRTdGFydCgpICYmICFXT1JEX0VORC50ZXN0KGMpKSB7XG4gICAgICAgICAgbGV0IGogPSBpO1xuICAgICAgICAgIHdoaWxlIChqIDwgbiAmJiAhV09SRF9FTkQudGVzdChjbWRbal0pKSBqICs9IDE7XG4gICAgICAgICAgY29uc3QgdyA9IGNtZC5zbGljZShpLCBqKTtcbiAgICAgICAgICAvLyBgZXNhY2AgY2xvc2VzIGF0IGEgcGF0dGVybi1saXN0IHN0YXJ0IG9yIGF0IHRoZSBzdGFydCBvZiBhIGxpc3RcbiAgICAgICAgICAvLyBpdGVtOyBlbHNld2hlcmUgaXQgaXMgYW4gb3JkaW5hcnkgd29yZCAoYGVjaG8gZXNhY2AsIGBhfGVzYWMpYCksXG4gICAgICAgICAgLy8gYXMgaXMgYGNhc2VgIGluIHRoZSBzdWJqZWN0IChgY2FzZSBlc2FjIGluIFx1MjAyNmApLlxuICAgICAgICAgIGlmICh3ID09PSAnZXNhYycgJiYgKHIucG9zID09PSAncGF0dGVybi1zdGFydCcgfHwgKHIucG9zID09PSAnY29tbWFuZCcgJiYgci5jbWRFbXB0eSkpKSB7XG4gICAgICAgICAgICBjYXNlUmVnaW9uID0gbnVsbDtcbiAgICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2luJyAmJiByLnBvcyA9PT0gJ3N1YmplY3QnKSB7XG4gICAgICAgICAgICByLnBvcyA9ICdwYXR0ZXJuLXN0YXJ0JztcbiAgICAgICAgICB9IGVsc2UgaWYgKHIucG9zID09PSAncGF0dGVybi1zdGFydCcpIHtcbiAgICAgICAgICAgIHIucG9zID0gJ3BhdHRlcm4nO1xuICAgICAgICAgIH0gZWxzZSBpZiAoci5wb3MgPT09ICdjb21tYW5kJykge1xuICAgICAgICAgICAgci5jbWRFbXB0eSA9IGZhbHNlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBidWYgKz0gdztcbiAgICAgICAgICBpID0gajtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gTG9jYWwgZGVwdGggPiAwIG9yIG5vbi13b3JkIGNoYXJzIGZhbGwgdGhyb3VnaCB0byB0aGUgcGFyZW4gYnJhbmNoZXNcbiAgICAgIC8vIGFuZCB0aGUgZ2VuZXJpYyBidWZmZXIuXG4gICAgfVxuICAgIGlmIChjID09PSAnKCcpIHtcbiAgICAgIGlmIChjYXNlUmVnaW9uKSB7XG4gICAgICAgIGNhc2VSZWdpb24ubG9jYWxEZXB0aCArPSAxO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQSBzdWJzaGVsbCBzdGFydHMgYSBjb21tYW5kIFx1MjAxNCBgaWYgdHJ1ZTsgdGhlbiAoIGVjaG8gaGkgKTsgZmlgIGlzXG4gICAgICAgIC8vIHZhbGlkIHdoaWxlIGBpZiB0cnVlOyB0aGVuOyBmaWAgaXMgbm90OyB0aGUgc2FtZSBzdWJzaGVsbCBjb3VudHMgYXNcbiAgICAgICAgLy8gYSBib2R5IHdvcmQgZm9yIGFuIGVuY2xvc2luZyBicmFjZSBncm91cCAoYHsgKCBlY2hvIGhpICk7IH1gKS5cbiAgICAgICAgY29uc3QgdCA9IHRvcCgpO1xuICAgICAgICBpZiAodD8ua2luZCA9PT0gJ2JyYWNlJykgdC5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgZGVwdGggKz0gMTtcbiAgICAgICAgbGV2ZWxzLnB1c2goW10pO1xuICAgICAgfVxuICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyknKSB7XG4gICAgICBpZiAoY2FzZVJlZ2lvbikge1xuICAgICAgICAvLyBBdCBsb2NhbCBkZXB0aCAwIGEgYClgIGlzIHRoZSBwYXR0ZXJuIHRlcm1pbmF0b3IgKG9yIHRoZSBlbmQgb2YgYVxuICAgICAgICAvLyBsaXN0IGl0ZW0pIFx1MjAxNCB0aGUgcmVnaW9uIG93bnMgaXQgYW5kIHRoZSBnbG9iYWwgZGVwdGggc3RheXMgZnJvemVuLlxuICAgICAgICBpZiAoY2FzZVJlZ2lvbi5sb2NhbERlcHRoID09PSAwKSB7XG4gICAgICAgICAgY2FzZVJlZ2lvbi5wb3MgPSAnY29tbWFuZCc7XG4gICAgICAgICAgY2FzZVJlZ2lvbi5jbWRFbXB0eSA9IHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FzZVJlZ2lvbi5sb2NhbERlcHRoIC09IDE7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEEgc3RyYXkgYClgIGF0IGRlcHRoIDAgKGFuZCBicmFjZSBkZXB0aCAwLCBvdXRzaWRlIHF1b3RlcykgaXMgYSBwYXJzZVxuICAgICAgICAvLyBlcnJvciBcdTIwMTQgYGVjaG8geCkgJiYgXHUyMDI2YCAocGxhbiBcdTAwQTcxKS4gYClgIGluc2lkZSBxdW90ZXMsIGAke1x1MjAyNn1gLCBhbmRcbiAgICAgICAgLy8gaGVyZWRvYyBib2RpZXMgbmV2ZXIgcmVhY2hlcyB0aGlzIGJyYW5jaC5cbiAgICAgICAgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICAgICAgcmVqZWN0KCd1bmJhbGFuY2VkLXBhcmVuJyk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgLy8gRmlyZS1iZWZvcmUtcmVzdG9yZTogYW4gdW5jbG9zZWQgY29uc3RydWN0IG9uIHRoZSBjbG9zaW5nIGxldmVsXG4gICAgICAgIC8vIGNhbm5vdCBvdXRsaXZlIHRoZSBzdWJzaGVsbCAocGxhbiBcdTAwQTczKS5cbiAgICAgICAgaWYgKGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgZGVwdGggLT0gMTtcbiAgICAgICAgbGV2ZWxzLnBvcCgpO1xuICAgICAgfVxuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gQ29uc3RydWN0IGtleXdvcmRzIGFuZCB0aGUgY2FzZS1yZWdpb24gb3BlbmVyOiByZWNvZ25pemVkIGF0IHdvcmRcbiAgICAvLyBzdGFydHMgYXQgYW55IHBhcmVuIGRlcHRoIChjb25zdHJ1Y3RzIHRyYWNrIHRocm91Z2ggc3Vic2hlbGxzKSwgb3V0c2lkZVxuICAgIC8vIHF1b3RlcywgJHtcdTIwMjZ9LCBoZXJlZG9jIGJvZGllcywgYW5kIG9wZW4gY2FzZSByZWdpb25zICh0aGUgcmVnaW9uIHNjYW5cbiAgICAvLyBhYm92ZSBvd25zIHRob3NlIHdvcmRzKS4gV29yZC1lbmQgY2hhcnMgKGA7YCwgYCZgLCBgfGAsIGA8YCwgYD5gKVxuICAgIC8vIG5ldmVyIGJlZ2luIGEgd29yZCBoZXJlLlxuICAgIGlmIChcbiAgICAgICFjYXNlUmVnaW9uICYmXG4gICAgICAhV09SRF9FTkQudGVzdChjKSAmJlxuICAgICAgKGlzV29yZFN0YXJ0KCkgfHwgL1soKV0kLy50ZXN0KGJ1ZikpICYmXG4gICAgICAhKGMgPT09ICckJyAmJiBjbWRbaSArIDFdID09PSAneycpXG4gICAgKSB7XG4gICAgICBsZXQgaiA9IGk7XG4gICAgICB3aGlsZSAoaiA8IG4gJiYgIVdPUkRfRU5ELnRlc3QoY21kW2pdKSkgaiArPSAxO1xuICAgICAgY29uc3QgdyA9IGNtZC5zbGljZShpLCBqKTtcbiAgICAgIGNvbnN0IGlzRm5TaGFwZSA9ICgpOiBib29sZWFuID0+IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKlxcKFxcKSQvLnRlc3QobGFzdFdvcmQoKSkgfHwgbGFzdFdvcmQoKSA9PT0gJygpJztcbiAgICAgIGlmICh3ID09PSAnaW4nICYmIHRvcCgpICE9PSB1bmRlZmluZWQgJiYgWydmb3InLCAnc2VsZWN0J10uaW5jbHVkZXModG9wKCkhLmtpbmQpKSB7XG4gICAgICAgIC8vIFRoZSBmb3Ivc2VsZWN0IHdvcmQtbGlzdCBzZXBhcmF0b3IgXHUyMDE0IHJlY29nbml6ZWQgd2hlcmV2ZXIgaXQgYXBwZWFyc1xuICAgICAgICAvLyB3aGlsZSBhIGZvci9zZWxlY3QgaXMgb3BlbiAoYGZvciBpIGluIGEgYmAsIGBzZWxlY3QgeCBpbiBhYCkuXG4gICAgICB9IGVsc2UgaWYgKHcgPT09ICd7JyAmJiAoaXNDb21tYW5kUG9zaXRpb24oKSB8fCBpc0ZuU2hhcGUoKSB8fCAoZnVuY3Rpb25TZWVuICYmIG5hbWVTZWVuKSkpIHtcbiAgICAgICAgLy8gYHtgIG9wZW5zIGEgYnJhY2UgZ3JvdXAgYXQgY29tbWFuZCBwb3NpdGlvbiwgb3IgcmlnaHQgYWZ0ZXIgYVxuICAgICAgICAvLyBmdW5jdGlvbiBuYW1lIChgZigpIHtgLCBgZigpe2AsIGBmdW5jdGlvbiBmIHtgKS4gYHtjYXRgIGlzIGEgd29yZC5cbiAgICAgICAgaWYgKGZ1bmN0aW9uU2VlbiAmJiBuYW1lU2Vlbikge1xuICAgICAgICAgIGZ1bmN0aW9uU2VlbiA9IGZhbHNlO1xuICAgICAgICAgIG5hbWVTZWVuID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRvcCgpPy5raW5kID09PSAnYnJhY2UnKSB0b3AoKSEuYm9keSA9IHRydWU7XG4gICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucHVzaCh7IGtpbmQ6ICdicmFjZScsIGJvZHk6IGZhbHNlIH0pO1xuICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmICh3ID09PSAnfScgJiYgaXNDb21tYW5kUG9zaXRpb24oKSkge1xuICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgIGlmIChhZnRlcktleXdvcmQgfHwgdCA9PT0gdW5kZWZpbmVkIHx8IHQua2luZCAhPT0gJ2JyYWNlJyB8fCAhdC5ib2R5KSB7XG4gICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnBvcCgpO1xuICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgIH0gZWxzZSBpZiAoaXNDb21tYW5kUG9zaXRpb24oKSkge1xuICAgICAgICBpZiAodyA9PT0gJ2Nhc2UnKSB7XG4gICAgICAgICAgY2FzZVJlZ2lvbiA9IHsgcG9zOiAnc3ViamVjdCcsIGNtZEVtcHR5OiBmYWxzZSwgbG9jYWxEZXB0aDogMCB9O1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBmdW5jdGlvblNlZW4gPSB0cnVlO1xuICAgICAgICAgIG5hbWVTZWVuID0gZmFsc2U7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2lmJykge1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucHVzaCh7IGtpbmQ6ICdpZicsIGJvZHk6IGZhbHNlIH0pO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ3doaWxlJyB8fCB3ID09PSAndW50aWwnKSB7XG4gICAgICAgICAgaWYgKHRvcCgpPy5raW5kID09PSAnYnJhY2UnKSB0b3AoKSEuYm9keSA9IHRydWU7XG4gICAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wdXNoKHsga2luZDogJ2xvb3AnLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdmb3InKSB7XG4gICAgICAgICAgaWYgKHRvcCgpPy5raW5kID09PSAnYnJhY2UnKSB0b3AoKSEuYm9keSA9IHRydWU7XG4gICAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wdXNoKHsga2luZDogJ2ZvcicsIGJvZHk6IGZhbHNlIH0pO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ3NlbGVjdCcpIHtcbiAgICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnB1c2goeyBraW5kOiAnc2VsZWN0JywgYm9keTogZmFsc2UgfSk7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZG8nKSB7XG4gICAgICAgICAgY29uc3QgdCA9IHRvcCgpO1xuICAgICAgICAgIGlmICh0ID09PSB1bmRlZmluZWQgfHwgIVsnZm9yJywgJ2xvb3AnLCAnc2VsZWN0J10uaW5jbHVkZXModC5raW5kKSkge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0LmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ3RoZW4nKSB7XG4gICAgICAgICAgY29uc3QgdCA9IHRvcCgpO1xuICAgICAgICAgIGlmICh0ID09PSB1bmRlZmluZWQgfHwgdC5raW5kICE9PSAnaWYnKSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIHQuYm9keSA9IHRydWU7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZWxzZScgfHwgdyA9PT0gJ2VsaWYnKSB7XG4gICAgICAgICAgLy8gZWxzZS9lbGlmIHJlcXVpcmUgYSBib2R5IGFscmVhZHkgXHUyMDE0IGFuIGVtcHR5IGlmLWxpc3QgaXMgYW4gZXJyb3IuXG4gICAgICAgICAgY29uc3QgdCA9IHRvcCgpO1xuICAgICAgICAgIGlmICh0ID09PSB1bmRlZmluZWQgfHwgdC5raW5kICE9PSAnaWYnIHx8ICF0LmJvZHkpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnaW4nKSB7XG4gICAgICAgICAgY29uc3QgdCA9IHRvcCgpO1xuICAgICAgICAgIGlmICh0ID09PSB1bmRlZmluZWQgfHwgIVsnZm9yJywgJ3NlbGVjdCddLmluY2x1ZGVzKHQua2luZCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2ZpJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8IHQua2luZCAhPT0gJ2lmJyB8fCAhdC5ib2R5KSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucG9wKCk7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2RvbmUnKSB7XG4gICAgICAgICAgY29uc3QgdCA9IHRvcCgpO1xuICAgICAgICAgIGlmICh0ID09PSB1bmRlZmluZWQgfHwgIVsnZm9yJywgJ2xvb3AnLCAnc2VsZWN0J10uaW5jbHVkZXModC5raW5kKSB8fCAhdC5ib2R5KSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucG9wKCk7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2VzYWMnKSB7XG4gICAgICAgICAgLy8gTm8gb3BlbiByZWdpb24gXHUyMDE0IGEgc3RyYXkgZXNhYyBpcyBhIHBhcnNlIGVycm9yLlxuICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICAgICAgaWYgKHRvcCgpPy5raW5kID09PSAnYnJhY2UnKSB0b3AoKSEuYm9keSA9IHRydWU7XG4gICAgICAgICAgaWYgKGZ1bmN0aW9uU2Vlbikge1xuICAgICAgICAgICAgaWYgKG5hbWVTZWVuKSB7XG4gICAgICAgICAgICAgIGZ1bmN0aW9uU2VlbiA9IGZhbHNlO1xuICAgICAgICAgICAgICBuYW1lU2VlbiA9IGZhbHNlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgbmFtZVNlZW4gPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQW4gYXJndW1lbnQtcG9zaXRpb24gd29yZDogbm90aGluZyBvcGVucywgdGhlIGVtcHR5LWJvZHkgZmxhZ1xuICAgICAgICAvLyBjbGVhcnMsIGFuZCB0aGUgZnVuY3Rpb24tbmFtZSBoYW5kb2ZmIGFkdmFuY2VzLlxuICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgaWYgKGZ1bmN0aW9uU2Vlbikge1xuICAgICAgICAgIGlmIChuYW1lU2Vlbikge1xuICAgICAgICAgICAgZnVuY3Rpb25TZWVuID0gZmFsc2U7XG4gICAgICAgICAgICBuYW1lU2VlbiA9IGZhbHNlO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBuYW1lU2VlbiA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBidWYgKz0gdztcbiAgICAgIGkgPSBqO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIEEgYDtgL2AmYCBkaXJlY3RseSBhZnRlciBhbiBvcGVuZXIgb3IgYm9keSBrZXl3b3JkIGlzIGFuIGVtcHR5LWxpc3RcbiAgICAvLyBwYXJzZSBlcnJvciBhdCBhbnkgZGVwdGggKGBpZiB0cnVlOyB0aGVuOyBmaWAsIGB7IDsgfWAsXG4gICAgLy8gYGZvciBpIGluIGEgYjsgZG87IGRvbmVgLCBgKCBpZiB0cnVlOyB0aGVuOyBmaSApYCkuXG4gICAgaWYgKGNhc2VSZWdpb24gPT09IG51bGwgJiYgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPiAwICYmIChjID09PSAnOycgfHwgYyA9PT0gJyYnKSAmJiBhZnRlcktleXdvcmQpIHtcbiAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICAvLyBBIHJlZGlyZWN0IHRva2VuIHdpdGggbm8gdGFyZ2V0IHdvcmQsIGltbWVkaWF0ZWx5IGZvbGxvd2VkIGJ5IGFub3RoZXJcbiAgICAgIC8vIHJlZGlyZWN0IHRva2VuIG1pZC1zdGFnZSwgaXMgYSBwYXJzZSBlcnJvcjogYGNhdCBmID4gPiBvdXRgLFxuICAgICAgLy8gYGNhdCBmID4gMj4mMWAsIGBjYXQgZiA+ICY+b3V0YCwgYGNhdCBmID4gPDw8IHhgIChwbGFuIFx1MDBBNzEpLlxuICAgICAgaWYgKGlzV29yZFN0YXJ0KCkgJiYgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSAmJiBzdGFydHNSZWRpcmVjdEF0KGkpKSB7XG4gICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJyQnICYmIGNtZFtpICsgMV0gPT09ICd7Jykge1xuICAgICAgICBicmFjZURlcHRoICs9IDE7XG4gICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLy8gSGVyZWRvYyByZWNvZ25pdGlvbiAocGxhbiBcdTAwQTczKTogYDw8YC9gPDwtYCAobm90IGA8PDxgKSBhdCBkZXB0aCAwIHdpdGhcbiAgICAgIC8vIGEgZGVsaW1pdGVyIHdvcmQuIFRoZSBvcGVyYXRvcitkZWxpbWl0ZXIgYXJlIHN0cmlwcGVkIGZyb20gdGhlIHN0YWdlXG4gICAgICAvLyB0ZXh0IFx1MjAxNCB0aGUgc3RhZ2Uga2VlcHMgYSBwbGFpbiBhcmd2IChgY2F0IGZgIHN0YXlzIGBjYXQgZmApLlxuICAgICAgaWYgKGMgPT09ICc8JyAmJiBjbWRbaSArIDFdID09PSAnPCcgJiYgY21kW2kgKyAyXSAhPT0gJzwnKSB7XG4gICAgICAgIGxldCBqID0gaSArIDI7XG4gICAgICAgIGxldCBhbGxvd1RhYnMgPSBmYWxzZTtcbiAgICAgICAgaWYgKGNtZFtqXSA9PT0gJy0nKSB7XG4gICAgICAgICAgYWxsb3dUYWJzID0gdHJ1ZTtcbiAgICAgICAgICBqICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgd2hpbGUgKGNtZFtqXSA9PT0gJyAnIHx8IGNtZFtqXSA9PT0gJ1xcdCcpIGogKz0gMTtcbiAgICAgICAgbGV0IGRlbGltID0gJyc7XG4gICAgICAgIGlmIChjbWRbal0gPT09IFwiJ1wiIHx8IGNtZFtqXSA9PT0gJ1wiJykge1xuICAgICAgICAgIGNvbnN0IHEgPSBjbWQuaW5kZXhPZihjbWRbal0sIGogKyAxKTtcbiAgICAgICAgICBpZiAocSA9PT0gLTEpIHtcbiAgICAgICAgICAgIGRlbGltID0gY21kLnNsaWNlKGogKyAxKTtcbiAgICAgICAgICAgIGogPSBuO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkZWxpbSA9IGNtZC5zbGljZShqICsgMSwgcSk7XG4gICAgICAgICAgICBqID0gcSArIDE7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IHdvcmRTdGFydCA9IGo7XG4gICAgICAgICAgd2hpbGUgKGogPCBuICYmICFXT1JEX0VORC50ZXN0KGNtZFtqXSkpIGogKz0gMTtcbiAgICAgICAgICBkZWxpbSA9IGNtZC5zbGljZSh3b3JkU3RhcnQsIGopO1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZWxpbSAhPT0gJycpIHtcbiAgICAgICAgICBoZXJlZG9jcy5wdXNoKHtcbiAgICAgICAgICAgIGNsb3NlOiBuZXcgUmVnRXhwKGBeJHthbGxvd1RhYnMgPyAnXFx0KicgOiAnJ30ke2VzY2FwZVJlZ0V4cChkZWxpbSl9WyBcXFxcdF0qJGApXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaWYgKGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCB8fCBjYXNlUmVnaW9uICE9PSBudWxsKSB7XG4gICAgICAgICAgICAvLyBJbnNpZGUgYW4gb3BlbiBjb25zdHJ1Y3QgdGhlIG9wZXJhdG9yK2RlbGltaXRlciBzdGF5IGluIHRoZVxuICAgICAgICAgICAgLy8gc3RhZ2UgdGV4dCBcdTIwMTQgdGhlIHdhbGsncyBpbnRlcmlvciByZS1zcGxpdCByZS1yZWNvZ25pemVzIHRoZVxuICAgICAgICAgICAgLy8gaGVyZWRvYyB0aGVyZSAocGxhbiBcdTAwQTczKS5cbiAgICAgICAgICAgIGJ1ZiArPSBjbWQuc2xpY2UoaSwgaik7XG4gICAgICAgICAgfVxuICAgICAgICAgIGkgPSBqO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBXaGlsZSBhIGNvbnN0cnVjdCBpcyBvcGVuIGF0IGRlcHRoIDAgdGhlIGJvdW5kYXJ5IG9wZXJhdG9ycyBhcmUgdGV4dCBcdTIwMTRcbiAgICAgIC8vIHRoZSBjb25zdHJ1Y3QgaXMgb25lIHN0YWdlLlxuICAgICAgaWYgKGNhc2VSZWdpb24gPT09IG51bGwgJiYgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICcmJicpIHtcbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ2FuZCcpO1xuICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJ3x8Jykge1xuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgnb3InKTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8JicpIHtcbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ3BpcGUnKTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICc7Jykge1xuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgnc2VtaWNvbG9uJyk7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnfCcpIHtcbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ3BpcGUnKTtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICdcXG4nKSB7XG4gICAgICAgICAgLy8gQSBuZXdsaW5lIGlzIGEgbGluZSBjb250aW51YXRpb24gXHUyMDE0IG5vdCBhIHN0YXRlbWVudCBzZXBhcmF0b3IgXHUyMDE0IHdoZW5cbiAgICAgICAgICAvLyBhIHBpcGUvYW5kL29yIG9wZXJhdG9yIGlzIHBlbmRpbmcgd2l0aCBhIHdoaXRlc3BhY2Utb25seSBidWZmZXJcbiAgICAgICAgICAvLyBzaW5jZSBpdCAoYGNhdCBhLnR4dCB8XFxuc2VkIC4uLmAsIGBmYWxzZSAmJlxcbnNlZCAuLi5gKS4gYGNhdCBmIHwgaGVhZCAtMVxcbmNhdCBnYFxuICAgICAgICAgIC8vIGlzIHRoZXJlZm9yZSB0d28gbGlzdHMsIGFuZCBhIHJlZGlyZWN0IHRhcmdldCBuZXZlciBjb250aW51ZXMgb250b1xuICAgICAgICAgIC8vIGEgbGF0ZXIgbGluZSAocGxhbiBcdTAwQTcxKS5cbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSkge1xuICAgICAgICAgICAgaSArPSAxO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ25ld2xpbmUnKTtcbiAgICAgICAgICBsaXN0U3RhcnQgPSBwYXJ0cy5sZW5ndGg7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnJicpIHtcbiAgICAgICAgICAvLyBBIGJhcmUgYCZgIGlzIGEgYmFja2dyb3VuZCBvcGVyYXRvciBvbmx5IHdoZW4gaXQgaXMgbm90IHBhcnQgb2YgYVxuICAgICAgICAgIC8vIHJlZGlyZWN0IHRva2VuOiB0aGUgbmV4dCBjaGFyYWN0ZXIgaXMgYD5gIChgJj5gL2AmPj5gKSwgb3IgdGhlXG4gICAgICAgICAgLy8gYnVmZmVyJ3MgbGFzdCBjaGFyYWN0ZXIgaXMgYD5gIG9yIGA8YCAoYDI+JjFgLCBgPiYgZmlsZWAsIGAzPCYwYCkuXG4gICAgICAgICAgLy8gU3BsaXR0aW5nIGluc2lkZSB0aG9zZSB0b2tlbnMgd291bGQgcHJvZHVjZSBqdW5rIHN0YWdlcy5cbiAgICAgICAgICBjb25zdCBuZXh0ID0gY21kW2kgKyAxXTtcbiAgICAgICAgICBjb25zdCBsYXN0ID0gYnVmW2J1Zi5sZW5ndGggLSAxXTtcbiAgICAgICAgICBpZiAobmV4dCAhPT0gJz4nICYmIGxhc3QgIT09ICc+JyAmJiBsYXN0ICE9PSAnPCcpIHtcbiAgICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZsdXNoKCdiYWNrZ3JvdW5kJyk7XG4gICAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgYnVmICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG5cbiAgLy8gRW5kIG9mIGlucHV0OiB0aGUgRU9GLXN0YXRlIHZlcmRpY3RzIFx1MjAxNCBhbiB1bmNsb3NlZCBxdW90ZSwgYnJhY2UsIGNhc2VcbiAgLy8gcmVnaW9uLCBwYXJlbiBsZXZlbCwgb3IgY29uc3RydWN0IFx1MjAxNCB0aGVuIHRoZSB1bmNvbnN1bWVkLW9wZXJhdG9yIGNoZWNrcyxcbiAgLy8gdGhlbiB0aGUgdW50ZXJtaW5hdGVkLWhlcmVkb2MgcGFydGlhbCwgdGhlbiB0aGUgZmluYWwgZmx1c2guIEEgdmVyZGljdFxuICAvLyBzZXQgbWlkLXNjYW4gYWxyZWFkeSBkcm9wcGVkIHRoZSByZWplY3RpbmcgbGlzdCBhbmQgZW5kZWQgdGhlIGxvb3AsIHNvXG4gIC8vIGBwYXJ0c2AgaXMgZXhhY3RseSB0aGUgY29tcGxldGVkIGVhcmxpZXIgbGlzdHMgaGVyZS5cbiAgaWYgKG1hbGZvcm1lZCkgcmV0dXJuIHsgc3RhZ2VzOiBwYXJ0cywgbWFsZm9ybWVkIH07XG4gIGlmIChpblNxdW90ZSB8fCBpbkRxdW90ZSkge1xuICAgIHJlamVjdCgndW5jbG9zZWQtcXVvdGUnKTtcbiAgfSBlbHNlIGlmIChicmFjZURlcHRoID4gMCkge1xuICAgIHJlamVjdCgndW5jbG9zZWQtYnJhY2UnKTtcbiAgfSBlbHNlIGlmIChjYXNlUmVnaW9uICE9PSBudWxsKSB7XG4gICAgcmVqZWN0KCd1bmNsb3NlZC1jYXNlJyk7XG4gIH0gZWxzZSBpZiAoZGVwdGggPiAwKSB7XG4gICAgcmVqZWN0KCd1bmJhbGFuY2VkLXBhcmVuJyk7XG4gIH0gZWxzZSBpZiAobGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPiAwKSB7XG4gICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgfSBlbHNlIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gIH0gZWxzZSBpZiAoaW5Cb2R5IHx8IGhlcmVkb2NzLmxlbmd0aCA+IDApIHtcbiAgICAvLyBVbnRlcm1pbmF0ZWQgaGVyZWRvYyBcdTIwMTQgYmFzaCB3YXJucywgcnVucyB0aGUgZGVsaW1pdGVyJ3MgbGluZSwgYW5kXG4gICAgLy8gdHJlYXRzIHRoZSB0YWlsIGFzIGJvZHk6IHRoZSBwYXJ0aWFsLiBUaGUgZGVsaW1pdGVyJ3MtbGluZSBzdGFnZShzKVxuICAgIC8vIGFuYWx5emUgYXMtaXM7IHRoZSBib2R5IHByb2R1Y2VzIG5vIHN0YWdlcyAocGxhbiBcdTAwQTczKS5cbiAgICBmbHVzaCgnbmV3bGluZScpO1xuICAgIG1hbGZvcm1lZCA9ICd1bnRlcm1pbmF0ZWQtaGVyZWRvYyc7XG4gIH0gZWxzZSB7XG4gICAgZmx1c2goJ25ld2xpbmUnKTtcbiAgfVxuICByZXR1cm4geyBzdGFnZXM6IHBhcnRzLCBtYWxmb3JtZWQgfTtcbn1cblxuY29uc3QgTEVBRElOR19BU1NJR05NRU5UID0gL14oPzpbQS1aYS16X11bQS1aYS16MC05X10qPVxcUypcXHMrKSsvO1xuXG4vKiogU3RyaXAgbGVhZGluZyBGT089YmFyIFZBUj1iYXogZW52LXByZWZpeCBhc3NpZ25tZW50cyBmcm9tIGEgc2ltcGxlIGNvbW1hbmQuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2ltcGxlQ21kLnJlcGxhY2UoTEVBRElOR19BU1NJR05NRU5ULCAnJyk7XG59XG5cbi8qKiBRdW90ZS1hd2FyZSB3aGl0ZXNwYWNlIHRva2VuaXplciwgcm91Z2hseSBtYXRjaGluZyBgc2hsZXguc3BsaXQocywgcG9zaXg9VHJ1ZSlgLiBSZXR1cm5zIG51bGwgb24gdW5iYWxhbmNlZCBxdW90ZXMuICovXG5leHBvcnQgZnVuY3Rpb24gc3BsaXRXb3JkcyhzOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBjb25zdCB3b3Jkczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1ciA9ICcnO1xuICBsZXQgaGFzID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHMubGVuZ3RoO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBzW2ldO1xuICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7XG4gICAgICBpZiAoaGFzKSB7XG4gICAgICAgIHdvcmRzLnB1c2goY3VyKTtcbiAgICAgICAgY3VyID0gJyc7XG4gICAgICAgIGhhcyA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnN0IGVuZCA9IHMuaW5kZXhPZihcIidcIiwgaSk7XG4gICAgICBpZiAoZW5kID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBjdXIgKz0gcy5zbGljZShpLCBlbmQpO1xuICAgICAgaSA9IGVuZCArIDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgc1tpXSAhPT0gJ1wiJykge1xuICAgICAgICBpZiAoc1tpXSA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHNbaSArIDFdKSkge1xuICAgICAgICAgIGN1ciArPSBzW2kgKyAxXTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3VyICs9IHNbaV07XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoaSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGN1ciArPSBzW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBoYXMgPSB0cnVlO1xuICAgIGN1ciArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICBpZiAoaGFzKSB3b3Jkcy5wdXNoKGN1cik7XG4gIHJldHVybiB3b3Jkcztcbn1cblxuLyoqIEJlc3QtZWZmb3J0IGFyZ3YgZm9yIGEgc2ltcGxlIGNvbW1hbmQ6IGxlYWRpbmcgYXNzaWdubWVudHMgc3RyaXBwZWQsIHF1b3RlLWF3YXJlIHNwbGl0LiBSZXR1cm5zIG51bGwgaWYgdGhlIGNvbW1hbmQgZG9lc24ndCB0b2tlbml6ZSBjbGVhbmx5ICh1bmJhbGFuY2VkIHF1b3RlcykuICovXG5leHBvcnQgZnVuY3Rpb24gYXJndk9mKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgcmV0dXJuIHNwbGl0V29yZHMoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kKS50cmltKCkpO1xufVxuXG4vKipcbiAqIFJlZGlyZWN0IG9wZXJhdG9ycyB0aGF0IGRyb3AgdG9nZXRoZXIgd2l0aCB0aGVpciBwbGFpbiB0YXJnZXQgd29yZCAocGxhbiBcdTAwQTc0XG4gKiB0d28tdG9rZW4gc2hhcGVzKTogYD5gLCBgPj5gLCBgPGAsIGA8PmAsIGAmPmAsIGAmPj5gLCBhbmQgZGlnaXQtcHJlZml4ZWRcbiAqIGZvcm1zIGxpa2UgYDI+YC9gMj4+YC9gMzxgLiBgPnxgIGlzIGRlbGliZXJhdGVseSBhYnNlbnQgXHUyMDE0IGl0IGZhaWxzIGNsb3NlZC5cbiAqL1xuY29uc3QgUkVESVJFQ1RfVFdPX1RPS0VOID0gL14oPzo+Pj98PD58PHwmPj4/fFswLTldKyg/Oj4+P3w8Pnw8KSkkLztcblxuLyoqIER1cCBmb3JtcyB0aGF0IGRyb3AgYWxvbmUgKHBsYW4gXHUwMEE3NCk6IGAyPiYxYCwgYD4mLWAsIGAzPCYwYC4gKi9cbmNvbnN0IFJFRElSRUNUX0RVUCA9IC9eKD86WzAtOV0rKT9bPD5dJig/OlswLTldK3wtKSQvO1xuXG4vKiogRnVzZWQgb3BlcmF0b3IrdGFyZ2V0IHdvcmRzIHRoYXQgZHJvcCB3aG9sZSAocGxhbiBcdTAwQTc0KTogYD5vdXRgLCBgMj5lcnJgLCBgJj5vdXRgLiAqL1xuY29uc3QgUkVESVJFQ1RfRlVTRUQgPSAvXig/Oj4+P3w8Pnw8fCY+Pj98WzAtOV0rKD86Pj4/fDw+fDwpKVtePD4mfF0vO1xuXG4vKiogSGVyZWRvYy9oZXJlLXN0cmluZyBvcGVyYXRvcnMgd2l0aCBhIHNlcGFyYXRlIHRhcmdldCB3b3JkOiBgPDxgLCBgPDwtYCwgYDw8PGAuICovXG5jb25zdCBIRVJFRE9DX1RXT19UT0tFTiA9IC9eKD86PDwtP3w8PDwpJC87XG5cbi8qKiBGdXNlZCBoZXJlZG9jIHdvcmRzIChwbGFuIFx1MDBBNzQpOiBgPDxFT0ZgLCBgPDwtRU9GYCwgYDw8PHhgLiAqL1xuY29uc3QgSEVSRURPQ19GVVNFRCA9IC9eKD86PDwtP3w8PDwpW148PiZ8XS87XG5cbi8qKiBXaGV0aGVyIGEgd29yZCBpcyBpdHNlbGYgYSByZWRpcmVjdCB0b2tlbiBcdTIwMTQgbmV2ZXIgYSB2YWxpZCByZWRpcmVjdCB0YXJnZXQuICovXG5jb25zdCBSRURJUkVDVF9UT0tFTiA9ICh3OiBzdHJpbmcpOiBib29sZWFuID0+XG4gIFJFRElSRUNUX1RXT19UT0tFTi50ZXN0KHcpIHx8XG4gIFJFRElSRUNUX0RVUC50ZXN0KHcpIHx8XG4gIFJFRElSRUNUX0ZVU0VELnRlc3QodykgfHxcbiAgSEVSRURPQ19UV09fVE9LRU4udGVzdCh3KSB8fFxuICBIRVJFRE9DX0ZVU0VELnRlc3Qodyk7XG5cbi8qKlxuICogU3RyaXAgcmVkaXJlY3QgdG9rZW5zIGZyb20gYSBzaW1wbGUgY29tbWFuZCdzIGFyZ3Ygc28gdGhlIHJlYWQtc2lkZVxuICogbWF0Y2hlcnMgc2VlIHRoZSB3b3JkcyB0aGF0IHdlcmUgYWN0dWFsbHkgcmVhZCAocGxhbiBcdTAwQTc0KTogdHdvLXRva2VuXG4gKiBvcGVyYXRvcnMgKGA+YCwgYD4+YCwgYDxgLCBgPD5gLCBgJj5gLCBgJj4+YCwgZGlnaXQtcHJlZml4ZWQgYDI+YC9gMj4+YC9cbiAqIGAzPGAsIC4uLikgZHJvcCB0b2dldGhlciB3aXRoIHRoZWlyIHBsYWluIHRhcmdldCB3b3JkLCBkdXAgZm9ybXMgKGAyPiYxYCxcbiAqIGA+Ji1gLCBgMzwmMGApIGRyb3AgYWxvbmUsIGZ1c2VkIGZvcm1zIChgPm91dGAsIGAyPmVycmAsIGAmPm91dGApIGRyb3AgYXNcbiAqIG9uZSB3b3JkLCBhbmQgaGVyZWRvYy9oZXJlLXN0cmluZyBvcGVyYXRvcnMgZHJvcCB3aXRoIHRoZWlyIHRhcmdldCB3b3JkIGluXG4gKiBib3RoIHNwZWxsaW5ncy4gQSB0d28tdG9rZW4gb3BlcmF0b3IncyB0YXJnZXQgbXVzdCBiZSBhIHBsYWluIGZpbGUgd29yZCBcdTIwMTQgYVxuICogZm9sbG93aW5nIHJlZGlyZWN0IHRva2VuIChgY2F0IGYgPiAyPiYxYCkgaXMgYmFzaCdzIFwic3ludGF4IGVycm9yIG5lYXJcbiAqIHVuZXhwZWN0ZWQgdG9rZW5cIiBhbmQgbGVhdmVzIHRoZSBvcGVyYXRvciBkYW5nbGluZywgdW5tYXRjaGVkLiBBbnl0aGluZ1xuICogZWxzZSBiZWdpbm5pbmcgd2l0aCBgPmAvYDxgIChub3RhYmx5IGA+fGApIGlzIGxlZnQgYWxvbmUgXHUyMDE0IHRoZSBjYWxsZXJcbiAqIHRyZWF0cyBhIHJlc2lkdWFsIHJlZGlyZWN0IHdvcmQgYXMgYW4gdW5tYXRjaGVkIHN0YWdlLiBBcHBsaWVkIHRvIGV2ZXJ5XG4gKiBzdGFnZSBcdTIwMTQgc291cmNlcywgc2VsZWN0b3JzLCBhbmQgcHJlZGljYXRlcyBcdTIwMTQgYmVmb3JlIHN0YXR1cyBldmFsdWF0aW9uIGFuZFxuICogbWF0Y2hlciBkaXNwYXRjaC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0cmlwUmVkaXJlY3RzKGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChSRURJUkVDVF9UV09fVE9LRU4udGVzdChhKSB8fCBIRVJFRE9DX1RXT19UT0tFTi50ZXN0KGEpKSB7XG4gICAgICBjb25zdCBuZXh0ID0gYXJndltpICsgMV07XG4gICAgICAvLyBUaGUgb3BlcmF0b3IncyB0YXJnZXQgbXVzdCBiZSBhIHBsYWluIGZpbGUgd29yZCBcdTIwMTQgYSBmb2xsb3dpbmcgcmVkaXJlY3RcbiAgICAgIC8vIHRva2VuIG1lYW5zIHRoZSBvcGVyYXRvciBkYW5nbGVzIGFuZCB0aGUgY29tbWFuZCBuZXZlciBydW5zLiBUaGVcbiAgICAgIC8vIGRhbmdsaW5nIG9wZXJhdG9yIGl0c2VsZiBpcyBsZWZ0IGluIHBsYWNlIHNvIHRoZSBjYWxsZXIgcmVqZWN0cyB0aGVcbiAgICAgIC8vIHN0YWdlIGFzIHVubWF0Y2hlZC5cbiAgICAgIGlmIChuZXh0ICE9PSB1bmRlZmluZWQgJiYgIVJFRElSRUNUX1RPS0VOKG5leHQpKSB7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG91dC5wdXNoKGEpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChSRURJUkVDVF9EVVAudGVzdChhKSB8fCBSRURJUkVDVF9GVVNFRC50ZXN0KGEpIHx8IEhFUkVET0NfRlVTRUQudGVzdChhKSkgY29udGludWU7XG4gICAgb3V0LnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFNoZWxsIGJ1aWx0aW5zIHRoZSB3YWxrIHJlY29nbml6ZXMgYSBgYnVpbHRpbmAgd3JhcHBlciBtYXkgZm9yd2FyZCAocGxhbiBcdTAwQTc1KS4gKi9cbmNvbnN0IFdSQVBQRVJfQlVJTFRJTlMgPSBuZXcgU2V0KFtcbiAgJ2V4aXQnLFxuICAnZXhlYycsXG4gICd0cnVlJyxcbiAgJ2ZhbHNlJyxcbiAgJzonLFxuICAnY2QnLFxuICAnc2V0JyxcbiAgJ3Vuc2V0JyxcbiAgJ2V4cG9ydCcsXG4gICdyZWFkb25seScsXG4gICdyZXR1cm4nLFxuICAnYnJlYWsnLFxuICAnY29udGludWUnXG5dKTtcblxuLyoqIEV4dGVybmFscyB3aG9zZSBhYnNvbHV0ZSBleGVjdXRhYmxlIHBhdGhzIHN0cmlwIHRvIHRoZWlyIGJhc2VuYW1lIChwbGFuIFx1MDBBNzUpLiAqL1xuY29uc3QgUkVDT0dOSVpFRF9FWFRFUk5BTF9OQU1FUyA9IG5ldyBTZXQoW1xuICAnc2VkJyxcbiAgJ2hlYWQnLFxuICAndGFpbCcsXG4gICdjYXQnLFxuICAnbmwnLFxuICAnZ2l0JyxcbiAgJ3RydWUnLFxuICAnZmFsc2UnLFxuICAndGltZW91dCcsXG4gICdlbnYnLFxuICAnY29tbWFuZCdcbl0pO1xuXG4vKiogQSBgdGltZW91dGAgZHVyYXRpb24gd29yZDogYDVgLCBgNS41c2AsIGAxbWAsIGAyaGAsIC4uLiAqL1xuY29uc3QgVElNRU9VVF9EVVJBVElPTiA9IC9eXFxkKyg/OlxcLlxcZCspP1tzbWhkXT8kLztcblxuLyoqIEEgbGl0ZXJhbCBgTkFNRT12YWx1ZWAgZW52LXByZWZpeCB3b3JkLiAqL1xuY29uc3QgRU5WX0FTU0lHTk1FTlQgPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9LiokLztcblxuLyoqXG4gKiBPbmUgc3RyaXAgc3RlcC4gUmV0dXJucyBudWxsIHdoZW4gdGhlIHdyYXBwZXIgaXMgbm90IGNsZWFuIChmYWlsIGNsb3NlZCBcdTIwMTRcbiAqIHRoZSBjYWxsZXIgcmVzdG9yZXMgdGhlIG9yaWdpbmFsIGFyZ3YsIHNvIG5vdGhpbmcgaXMgZm9yd2FyZGVkIHRvIHRoZVxuICogbWF0Y2hlcnMpLCBvciB0aGUgYXJndiB3aXRoIG9uZSB3cmFwcGVyIGxheWVyIHJlbW92ZWQuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwV3JhcHBlcnNPbmNlKGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nW10gfCBudWxsIHtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICchJykgaSsrO1xuICBpZiAoaSA+PSBhcmd2Lmxlbmd0aCkgcmV0dXJuIGFyZ3Yuc2xpY2UoaSk7XG4gIGNvbnN0IGhlYWQgPSBhcmd2W2ldO1xuICBpZiAoaGVhZCA9PT0gJ2NvbW1hbmQnKSB7XG4gICAgY29uc3QgbmV4dCA9IGFyZ3ZbaSArIDFdO1xuICAgIGlmIChuZXh0ID09PSAnLXYnIHx8IG5leHQgPT09ICctVicpIHJldHVybiBudWxsOyAvLyBhIHF1ZXJ5IFx1MjAxNCBydW5zIG5vdGhpbmdcbiAgICBpZiAobmV4dCA9PT0gJy1wJykgcmV0dXJuIGFyZ3Yuc2xpY2UoaSArIDIpO1xuICAgIGlmIChuZXh0ICE9PSB1bmRlZmluZWQgJiYgIW5leHQuc3RhcnRzV2l0aCgnLScpKSByZXR1cm4gYXJndi5zbGljZShpICsgMSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgaWYgKGhlYWQgPT09ICdidWlsdGluJykge1xuICAgIGNvbnN0IG5leHQgPSBhcmd2W2kgKyAxXTtcbiAgICBpZiAobmV4dCAhPT0gdW5kZWZpbmVkICYmIFdSQVBQRVJfQlVJTFRJTlMuaGFzKG5leHQpKSByZXR1cm4gYXJndi5zbGljZShpICsgMik7XG4gICAgcmV0dXJuIG51bGw7IC8vIGBidWlsdGluIHNlZGAgZXJyb3JzIFx1MjAxNCBuZXZlciBmb3J3YXJkIGEgbm9uLWJ1aWx0aW4gd29yZFxuICB9XG4gIGlmIChoZWFkID09PSAnZW52Jykge1xuICAgIGxldCBqID0gaSArIDE7XG4gICAgd2hpbGUgKGogPCBhcmd2Lmxlbmd0aCAmJiBFTlZfQVNTSUdOTUVOVC50ZXN0KGFyZ3Zbal0pKSBqKys7XG4gICAgaWYgKGogPT09IGkgKyAxKSByZXR1cm4gbnVsbDsgLy8gYC1pYCwgYC11IFhgLCBhIG5vbi1hc3NpZ25tZW50IHdvcmQgXHUyMDE0IG5vdCBhIGNsZWFuIHdyYXBwZXJcbiAgICByZXR1cm4gYXJndi5zbGljZShqKTtcbiAgfVxuICBpZiAoaGVhZCA9PT0gJ3RpbWVvdXQnKSB7XG4gICAgbGV0IGogPSBpICsgMTtcbiAgICB3aGlsZSAoaiA8IGFyZ3YubGVuZ3RoICYmIGFyZ3Zbal0uc3RhcnRzV2l0aCgnLS0nKSkgaisrO1xuICAgIGlmIChqID49IGFyZ3YubGVuZ3RoIHx8ICFUSU1FT1VUX0RVUkFUSU9OLnRlc3QoYXJndltqXSkpIHJldHVybiBudWxsOyAvLyBubyBkdXJhdGlvbiBcdTIwMTQgbm90aGluZyBydW5zXG4gICAgcmV0dXJuIGFyZ3Yuc2xpY2UoaiArIDEpO1xuICB9XG4gIGlmIChoZWFkLnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGNvbnN0IGJhc2UgPSBoZWFkLnNsaWNlKGhlYWQubGFzdEluZGV4T2YoJy8nKSArIDEpO1xuICAgIGlmIChSRUNPR05JWkVEX0VYVEVSTkFMX05BTUVTLmhhcyhiYXNlKSkgcmV0dXJuIFtiYXNlLCAuLi5hcmd2LnNsaWNlKGkgKyAxKV07XG4gICAgcmV0dXJuIG51bGw7IC8vIGAvdXNyL2Jpbi9leGl0YCBhbmQgZnJpZW5kcyBhcmUgbm90IHJlY29nbml6ZWQgZXh0ZXJuYWxzXG4gIH1cbiAgaWYgKGhlYWQuaW5jbHVkZXMoJy8nKSkgcmV0dXJuIG51bGw7IC8vIGEgcmVsYXRpdmUgY29sbGlkaW5nIHBhdGggaXMgYSBsb2NhbCBiaW5hcnksIG5vdCB0aGUgY29yZXV0aWxcbiAgcmV0dXJuIGFyZ3Yuc2xpY2UoaSk7XG59XG5cbi8qKlxuICogU3RyaXAgdHJhbnNwYXJlbnQgd3JhcHBlciBwcmVmaXhlcyBmcm9tIGEgc2ltcGxlIGNvbW1hbmQncyBhcmd2IHNvIG1hdGNoZXJcbiAqIGRpc3BhdGNoIHNlZXMgdGhlIHVuZGVybHlpbmcgY29tbWFuZCB3b3JkIChwbGFuIFx1MDBBNzUpOiBgY29tbWFuZGAgKHN0b3BwaW5nIGF0XG4gKiB0aGUgcXVlcnkgZm9ybXMgYC12YC9gLVZgKSwgYGJ1aWx0aW5gIHJlc3RyaWN0ZWQgdG8gdGhlIHdhbGsncyByZWNvZ25pemVkXG4gKiBidWlsdGlucywgYGVudiBOQU1FPXZhbHVlYCBwcmVmaXhlcywgYHRpbWVvdXRgIHBsdXMgaXRzIGAtLSpgIGZsYWdzIGFuZCBvbmVcbiAqIGR1cmF0aW9uLCBhbmQgYWJzb2x1dGUgZXhlY3V0YWJsZSBwYXRocyB3aG9zZSBiYXNlbmFtZSBpcyBpbiB0aGUgcmVjb2duaXplZFxuICogc2V0IFx1MjAxNCBpdGVyYXRpbmcgdW50aWwgZml4ZWQtcG9pbnQgc28gc3RhY2tlZCB3cmFwcGVycyBzdGlsbCByZWFjaCB0aGUgd29yZC5cbiAqIEFueSB1bmNsZWFuIHdyYXBwZXIgZmFpbHMgY2xvc2VkOiB0aGUgb3JpZ2luYWwgYXJndiBpcyByZXR1cm5lZCB1bmNoYW5nZWQsXG4gKiBzbyB0aGUgc3RhZ2UgbWF0Y2hlcyBub3RoaW5nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBXcmFwcGVycyhhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgbGV0IGN1cnJlbnQgPSBhcmd2O1xuICBmb3IgKGxldCBpdGVyID0gMDsgaXRlciA8IGFyZ3YubGVuZ3RoICsgMjsgaXRlcisrKSB7XG4gICAgY29uc3QgbmV4dCA9IHN0cmlwV3JhcHBlcnNPbmNlKGN1cnJlbnQpO1xuICAgIGlmIChuZXh0ID09PSBudWxsKSByZXR1cm4gYXJndjtcbiAgICBpZiAobmV4dC5sZW5ndGggPT09IGN1cnJlbnQubGVuZ3RoICYmIG5leHQuZXZlcnkoKHcsIGspID0+IHcgPT09IGN1cnJlbnRba10pKSByZXR1cm4gY3VycmVudDtcbiAgICBjdXJyZW50ID0gbmV4dDtcbiAgfVxuICByZXR1cm4gYXJndjtcbn1cbiIsICIvKipcbiAqIFZhcmlhYmxlIHJlc29sdXRpb24gZm9yIHRoZSBleGVjdXRpb24tYXdhcmUgQmFzaCB0b3VjaCBwYXJzZXIgKHBsYW4gXHUwMEE3NykuXG4gKlxuICogRXhwYW5zaW9uIHJ1bnMgb3ZlciB0aGUgcmF3IHNpbXBsZS1jb21tYW5kIHRleHQgKmJlZm9yZSogdG9rZW5pemluZywgd2l0aCBhXG4gKiBxdW90ZS1hd2FyZSBzY2FubmVyOiBzaW5nbGUtcXVvdGVkIHNwYW5zIHN0YXkgbGl0ZXJhbCwgZG91YmxlLXF1b3RlZCBhbmRcbiAqIHVucXVvdGVkIHNwYW5zIGV4cGFuZCBgJFZBUmAgYW5kIGAke1ZBUn1gIChncmVlZHkgaWRlbnRpZmllciksIGFuZCBhXG4gKiBiYWNrc2xhc2gtZXNjYXBlZCBgJGAgc3RheXMgbGl0ZXJhbC4gRXhwYW5kaW5nIGJlZm9yZSB0b2tlbml6aW5nIGtlZXBzIGFuXG4gKiBleHBhbmRlZCB2YWx1ZSdzIGAmJmAvc3BhY2VzIG91dCBvZiB0aGUgc3BsaXR0ZXIncyByZWFjaC4gVmFsdWUgcHJlY2VkZW5jZVxuICogaXMgc2NyaXB0IHZhcmlhYmxlIHRhYmxlID4gZW52ID4gdW5yZXNvbHZlZCBcdTIwMTQgYSBuYW1lIGFic2VudCBmcm9tIGJvdGggaXNcbiAqIGxlZnQgYXMgdGhlIHJlc2lkdWFsIGAkYCwgd2hpY2ggdHJpcHMgdGhlIHBhcnNlcidzIGBsb29rc1VucmVzb2x2YWJsZWAgcGF0aFxuICogKGZhaWwgY2xvc2VkLCBubyB0b3VjaCkuXG4gKlxuICogVGhlIGVudiBpcyBleHBlY3RlZCB0byBiZSBwcmUtY3VyYXRlZDogYHBhcnNlQ29tbWFuZERldGFpbGVkYCBnYXRlcyBpdHNcbiAqIGBwcm9jZXNzLmVudmAgZGVmYXVsdCBieSBgUGFyc2VPcHRpb25zLmFsbG93bGlzdGAgKHNvIG9ubHkgdGhlXG4gKiBgREVGQVVMVF9QQVRIX0FMTE9XTElTVGAgbmFtZXMgZXZlciByZXNvbHZlIGZyb20gdGhlIGhvb2sgZW52KSwgd2hpbGUgYW5cbiAqIGV4cGxpY2l0bHkgaW5qZWN0ZWQgZW52IFx1MjAxNCBhcyBpbiB0ZXN0cyBcdTIwMTQgaXMgY29uc3VsdGVkIHdob2xlc2FsZS5cbiAqL1xuXG4vKipcbiAqIFRoZSBzaGFyZWQgYWxsb3dsaXN0IG9mIGhvb2stZW52IHZhcmlhYmxlIG5hbWVzIHBhdGggYXJndW1lbnRzIG1heSByZXNvbHZlXG4gKiBmcm9tIFx1MjAxNCBpZGVudGljYWwgYWNyb3NzIGhhcm5lc3NlcyBzbyB0aGUgc2FtZSBjb21tYW5kIHN0cmluZyBwcm9kdWNlcyB0aGVcbiAqIHNhbWUgdG91Y2hlcyBldmVyeXdoZXJlLiBBbiBhbGxvd2xpc3RlZCBuYW1lIGFic2VudCBmcm9tIGEgcGFydGljdWxhciBob29rXG4gKiBlbnYgc3RheXMgdW5yZXNvbHZlZCAoZmFpbCBjbG9zZWQpLCBzbyB0aGUgbGlzdCBpcyBzYWZlIHRvIHNoYXJlLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9QQVRIX0FMTE9XTElTVCA9IFtcbiAgJ0hPTUUnLFxuICAnUFdEJyxcbiAgJ1dPUktTUEFDRV9QQVRIJyxcbiAgJ0NBUkRfUkVQT19QQVRIJyxcbiAgJ1JFUE9fUk9PVCcsXG4gICdCQVNFX0JSQU5DSCdcbl0gYXMgY29uc3Q7XG5cbi8qKiBBIGJhcmUgcmVmZXJlbmNlIG5hbWU6IGdyZWVkeSBpZGVudGlmaWVyIGFmdGVyIGAkYC4gKi9cbmNvbnN0IEJBUkVfTkFNRSA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKi87XG5cbi8qKiBBIGJyYWNlZCByZWZlcmVuY2UgbXVzdCBiZSBleGFjdGx5IGFuIGlkZW50aWZpZXIgXHUyMDE0IGAkeyFYfWAsIGAke1g6LWR9YCwgYCR7I1h9YCBuZXZlciBleHBhbmQuICovXG5jb25zdCBCUkFDRURfTkFNRSA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKiQvO1xuXG4vKipcbiAqIEV4cGFuZCBgJFZBUmAgLyBgJHtWQVJ9YCByZWZlcmVuY2VzIGluIGEgc2ltcGxlIGNvbW1hbmQncyByYXcgdGV4dCAocGxhblxuICogXHUwMEE3NykuIGAkKFx1MjAyNilgLCBgJCgoXHUyMDI2KSlgLCBgJHshWH1gIGluZGlyZWN0IGV4cGFuc2lvbiwgYCR7WDpcdTIwMjZ9YCBvcGVyYXRvcnMsXG4gKiBzcGVjaWFsIHBhcmFtZXRlcnMsIGFuZCB1bmtub3duIHZhcmlhYmxlcyBzdGF5IHVudG91Y2hlZC5cbiAqXG4gKiBAcGFyYW0gdGV4dCBUaGUgcmF3IHNpbXBsZS1jb21tYW5kIHRleHQsIGJlZm9yZSB0b2tlbml6aW5nLlxuICogQHBhcmFtIHZhcmlhYmxlcyBUaGUgc2NyaXB0IHZhcmlhYmxlIHRhYmxlIGZyb20gZXhlY3V0ZWQgbm9uLXBpcGUgYXNzaWdubWVudFxuICogICBzdGFnZXMsIGluIG9yZGVyICh0YWtlcyBwcmVjZWRlbmNlIG92ZXIgYGVudmApLlxuICogQHBhcmFtIGVudiBUaGUgY3VyYXRlZCBlbnZpcm9ubWVudCAodGhlIHBhcnNlciBnYXRlcyBpdHMgYHByb2Nlc3MuZW52YFxuICogICBkZWZhdWx0IGJ5IGBERUZBVUxUX1BBVEhfQUxMT1dMSVNUYDsgYW4gaW5qZWN0ZWQgZW52IGlzIHVzZWQgd2hvbGVzYWxlKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4cGFuZFZhcmlhYmxlcyhcbiAgdGV4dDogc3RyaW5nLFxuICB2YXJpYWJsZXM6IFJlYWRvbmx5TWFwPHN0cmluZywgc3RyaW5nPixcbiAgZW52OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+XG4pOiBzdHJpbmcge1xuICBjb25zdCByZXNvbHZlID0gKG5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCA9PiB7XG4gICAgY29uc3QgZnJvbVRhYmxlID0gdmFyaWFibGVzLmdldChuYW1lKTtcbiAgICBpZiAoZnJvbVRhYmxlICE9PSB1bmRlZmluZWQpIHJldHVybiBmcm9tVGFibGU7XG4gICAgY29uc3QgZnJvbUVudiA9IGVudltuYW1lXTtcbiAgICByZXR1cm4gZnJvbUVudiAhPT0gdW5kZWZpbmVkID8gZnJvbUVudiA6IHVuZGVmaW5lZDtcbiAgfTtcblxuICBsZXQgb3V0ID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHRleHQubGVuZ3RoO1xuICBsZXQgaW5TaW5nbGUgPSBmYWxzZTtcbiAgbGV0IGluRG91YmxlID0gZmFsc2U7XG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSB0ZXh0W2ldO1xuICAgIGlmIChpblNpbmdsZSkge1xuICAgICAgLy8gU2luZ2xlLXF1b3RlZCBzcGFucyBhcmUgZnVsbHkgbGl0ZXJhbCBcdTIwMTQgYCRgIGFuZCBgXFxgIGluY2x1ZGVkLlxuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNpbmdsZSA9IGZhbHNlO1xuICAgICAgb3V0ICs9IGM7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRG91YmxlKSB7XG4gICAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgICBpbkRvdWJsZSA9IGZhbHNlO1xuICAgICAgICBvdXQgKz0gYztcbiAgICAgICAgaSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXModGV4dFtpICsgMV0pKSB7XG4gICAgICAgIC8vIEluc2lkZSBkb3VibGUgcXVvdGVzIGJhY2tzbGFzaCBlc2NhcGVzIGBcImAgYFxcYCBgJGAgYGAgYCBgYCBcdTIwMTQgdGhlXG4gICAgICAgIC8vIGVzY2FwZWQgY2hhcmFjdGVyIHN0YXlzIGxpdGVyYWwgKG5vIGV4cGFuc2lvbiBvZiBgXFwkYCkuXG4gICAgICAgIG91dCArPSB0ZXh0W2kgKyAxXTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcpIHtcbiAgICAgICAgb3V0ICs9IGM7XG4gICAgICAgIGkrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJyQnKSB7XG4gICAgICAgIGNvbnN0IHJlZiA9IGV4cGFuZFJlZih0ZXh0LCBpLCByZXNvbHZlKTtcbiAgICAgICAgb3V0ICs9IHJlZi50ZXh0O1xuICAgICAgICBpID0gcmVmLm5leHQ7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgb3V0ICs9IGM7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVW5xdW90ZWQuXG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBpblNpbmdsZSA9IHRydWU7XG4gICAgICBvdXQgKz0gYztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5Eb3VibGUgPSB0cnVlO1xuICAgICAgb3V0ICs9IGM7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJykge1xuICAgICAgLy8gQSBiYWNrc2xhc2ggZXNjYXBlcyB0aGUgbmV4dCBjaGFyYWN0ZXIgXHUyMDE0IGBcXCRgIHN0YXlzIGxpdGVyYWwgKHRoZVxuICAgICAgLy8gdG9rZW5pemVyIHJlc29sdmVzIHRoZSBlc2NhcGUpLlxuICAgICAgb3V0ICs9IGM7XG4gICAgICBpZiAoaSArIDEgPCBuKSB7XG4gICAgICAgIG91dCArPSB0ZXh0W2kgKyAxXTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaSsrO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnJCcpIHtcbiAgICAgIGNvbnN0IHJlZiA9IGV4cGFuZFJlZih0ZXh0LCBpLCByZXNvbHZlKTtcbiAgICAgIG91dCArPSByZWYudGV4dDtcbiAgICAgIGkgPSByZWYubmV4dDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBvdXQgKz0gYztcbiAgICBpKys7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSByZWZlcmVuY2Ugc3RhcnRpbmcgYXQgYHRleHRbc3RhcnRdYCAoYSBgJGApLiBBIGtub3duIG5hbWUnc1xuICogdmFsdWUgcmVwbGFjZXMgdGhlIHdob2xlIHJlZmVyZW5jZTsgYW55dGhpbmcgZWxzZSBcdTIwMTQgY29tbWFuZCBzdWJzdGl0dXRpb24sXG4gKiBhcml0aG1ldGljLCBpbmRpcmVjdCBleHBhbnNpb24sIHBhcmFtZXRlciBvcGVyYXRvcnMsIHNwZWNpYWwgcGFyYW1ldGVycyxcbiAqIHVua25vd24gb3IgdW5zZXQgbmFtZXMgXHUyMDE0IGlzIHJldHVybmVkIHZlcmJhdGltICh0aGUgYCRgIG9ubHkpLCBzbyB0aGVcbiAqIGNhbGxlcidzIHNjYW4gY29udGludWVzIGFuZCB0aGUgcmVzaWR1YWwgdGV4dCBpcyB1bmNoYW5nZWQuXG4gKi9cbmZ1bmN0aW9uIGV4cGFuZFJlZihcbiAgdGV4dDogc3RyaW5nLFxuICBzdGFydDogbnVtYmVyLFxuICByZXNvbHZlOiAobmFtZTogc3RyaW5nKSA9PiBzdHJpbmcgfCB1bmRlZmluZWRcbik6IHsgdGV4dDogc3RyaW5nOyBuZXh0OiBudW1iZXIgfSB7XG4gIGNvbnN0IHJlc3QgPSB0ZXh0LnNsaWNlKHN0YXJ0ICsgMSk7XG4gIGlmIChyZXN0LnN0YXJ0c1dpdGgoJygnKSkgcmV0dXJuIHsgdGV4dDogJyQnLCBuZXh0OiBzdGFydCArIDEgfTsgLy8gYCQoXHUyMDI2KWAgLyBgJCgoXHUyMDI2KSlgIFx1MjAxNCB1bnRvdWNoZWRcbiAgaWYgKHJlc3Quc3RhcnRzV2l0aCgneycpKSB7XG4gICAgY29uc3QgY2xvc2UgPSB0ZXh0LmluZGV4T2YoJ30nLCBzdGFydCArIDIpO1xuICAgIGlmIChjbG9zZSA9PT0gLTEpIHJldHVybiB7IHRleHQ6ICckJywgbmV4dDogc3RhcnQgKyAxIH07IC8vIHVudGVybWluYXRlZCBgJCB7YCBcdTIwMTQgdW50b3VjaGVkXG4gICAgY29uc3QgaW5uZXIgPSB0ZXh0LnNsaWNlKHN0YXJ0ICsgMiwgY2xvc2UpO1xuICAgIGlmIChCUkFDRURfTkFNRS50ZXN0KGlubmVyKSkge1xuICAgICAgY29uc3QgdmFsdWUgPSByZXNvbHZlKGlubmVyKTtcbiAgICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSByZXR1cm4geyB0ZXh0OiB2YWx1ZSwgbmV4dDogY2xvc2UgKyAxIH07XG4gICAgfVxuICAgIHJldHVybiB7IHRleHQ6ICckJywgbmV4dDogc3RhcnQgKyAxIH07IC8vIGAkeyFYfWAsIGAke1g6XHUyMDI2fWAsIHVua25vd24gbmFtZXMgXHUyMDE0IHVudG91Y2hlZFxuICB9XG4gIGNvbnN0IG5hbWUgPSBCQVJFX05BTUUuZXhlYyhyZXN0KTtcbiAgaWYgKG5hbWUgPT09IG51bGwpIHJldHVybiB7IHRleHQ6ICckJywgbmV4dDogc3RhcnQgKyAxIH07IC8vIHNwZWNpYWwgcGFyYW1ldGVycywgYmFyZSBgJGAgXHUyMDE0IHVudG91Y2hlZFxuICBjb25zdCB2YWx1ZSA9IHJlc29sdmUobmFtZVswXSk7XG4gIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSByZXR1cm4geyB0ZXh0OiB2YWx1ZSwgbmV4dDogc3RhcnQgKyAxICsgbmFtZVswXS5sZW5ndGggfTtcbiAgcmV0dXJuIHsgdGV4dDogJyQnLCBuZXh0OiBzdGFydCArIDEgfTsgLy8gdW5rbm93biBuYW1lIFx1MjAxNCB0aGUgcmVzaWR1YWwgYCRgIHRyaXBzIGxvb2tzVW5yZXNvbHZhYmxlXG59XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHNwYW4tc3VyZmFjaW5nIGNvcmUuXG4gKlxuICogR2l2ZW4gYW4gYWxyZWFkeS1yZXNvbHZlZCByZXBvLXJlbGF0aXZlIHBhdGggYW5kIGEgbGluZSByYW5nZSwgdGhpcyBtb2R1bGVcbiAqIHJ1bnMgdGhlIHNoYXJlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgLyBgLmhvb2tpZ25vcmVgIC8gc2Vzc2lvbi1tZW1vIC9cbiAqIGBnaXQgc3BhbiBkcmlmdGAgcGlwZWxpbmUgYW5kIGFzc2VtYmxlcyB0aGUgaHVtYW4tcmVhZGFibGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmBcbiAqIGJsb2NrIHRoYXQgYm90aCBhZGFwdGVycyBzdXJmYWNlIGlubGluZSBiZWZvcmUgYW4gZWRpdC4gSXQgaW1wb3J0cyBub3RoaW5nXG4gKiBmcm9tIGVpdGhlciBob29rIFNESzogdGhlIENsYXVkZSBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgYSByYW5nZSBkZXJpdmVkIGZyb21cbiAqIGBmaWxlX3BhdGhgL2BvZmZzZXRgL2BvbGRfc3RyaW5nYDsgdGhlIENvZGV4IFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCB0aGVcbiAqIHJhbmdlcyByZWNvdmVyZWQgZnJvbSBhbiBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlLiBFYWNoIGFkYXB0ZXIgd3JhcHMgdGhlXG4gKiByZXR1cm5lZCBibG9jayBzdHJpbmcgaW4gaXRzIG93biBTREsgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogVGhlIGV4ZWN1dG9yL2RyaWZ0L21lbW8gZGVwZW5kZW5jaWVzIGFyZSBpbmplY3RlZCBzbyB0aGUgcGlwZWxpbmUgaXMgdGVzdGFibGVcbiAqIHdpdGggZmFrZXMgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGUgc2hhcmVkIGtlcm5lbC5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgaXNHaXRJZ25vcmVkLFxuICBpc0luc2lkZVNwYW5Sb290LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICBwcnVuZVN0YWxlU2Vzc2lvbnMsXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290LFxuICBzZXNzaW9uRGlyLFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHR5cGUgSG9va0lnbm9yZUxvYWRlciwgaXNTcGFuU3VwcHJlc3NlZCB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG4vKipcbiAqIE1pbmltYWwgbG9nZ2VyIHN1cmZhY2UgdGhlIGBjb21tb24vYCBsYXllciBsb2dzIHRocm91Z2g7IGJvdGggU0RLIGxvZ2dlcnNcbiAqIHNhdGlzZnkgaXQuIGB3YXJuYCBpcyByZXF1aXJlZCBcdTIwMTQgZXZlcnkgZXhpc3RpbmcgY2FsbCBzaXRlIHJlcG9ydHMgYSBmYWlsdXJlLlxuICogYGluZm9gIGlzIG9wdGlvbmFsIHNvIGEgZmFrZSBjYXJyeWluZyBvbmx5IGB3YXJuYCBzdGlsbCBzYXRpc2ZpZXMgdGhlXG4gKiBpbnRlcmZhY2U6IGl0IGV4aXN0cyBmb3IgdGhlIGRpYWdub3N0aWMgYnJlYWRjcnVtYnMgYSAqc3VjY2Vzc2Z1bCogcnVuIGxlYXZlc1xuICogYmVoaW5kIChhZHZpc29yLWNvcmUncyBjaHVybi1zdXBwcmVzc2lvbiBjb3VudCksIHdoaWNoIGFyZSBub3Qgd2FybmluZ3MgYW5kXG4gKiBtdXN0IG5vdCByZWFkIGFzIGZhaWx1cmVzIGluIHRoZSBob29rIGxvZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb3JlTG9nZ2VyIHtcbiAgd2FybihtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG4gIGluZm8/KG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTcGFuIGV4ZWN1dG9yIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBFeGVjdXRlcyBgZ2l0IHNwYW4gbGlzdGAgd2l0aCBnaXZlbiBhcmdzIGluIGEgZ2l2ZW4gY3dkLlxuICogUmV0dXJucyBzdGRvdXQgc3RyaW5nLiBUaHJvd3Mgb24gbm9uLXplcm8gZXhpdC5cbiAqL1xuZXhwb3J0IHR5cGUgU3BhbkV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBTcGFuRXhlY3V0b3Ige1xuICByZXR1cm4gKGFyZ3MsIGN3ZCkgPT4ge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4uYXJnc10sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW5zIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPHNsdWdzPmAgYW5kIHJldHVybnMgaXRzIHBvcmNlbGFpbiBzdGRvdXQgXHUyMDE0XG4gKiBvbmUgcm93IHBlciAqZHJpZnRlZCogYW5jaG9yIGFtb25nIHRoZSBnaXZlbiBzcGFucywgZW1wdHkgd2hlbiBhbGwgYXJlIGNsZWFuLlxuICogYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAwIGluIHBvcmNlbGFpbiBtb2RlIHdoZXRoZXIgb3Igbm90IGRyaWZ0IGV4aXN0cywgYnV0IHdlXG4gKiBzdGlsbCBjYXB0dXJlIHN0ZG91dCBmcm9tIGEgdGhyb3duIGVycm9yIHNvIGEgZHJpZnQgc2lnbmFsIGlzIG5ldmVyIGxvc3QgdG8gYVxuICogbm9uLXplcm8gZXhpdC4gVGhyb3dzIG9ubHkgd2hlbiBubyBzdGRvdXQgaXMgYXZhaWxhYmxlIChnZW51aW5lIGZhaWx1cmUpLlxuICovXG5leHBvcnQgdHlwZSBEcmlmdEV4ZWN1dG9yID0gKHNsdWdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHREcmlmdEV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IERyaWZ0RXhlY3V0b3Ige1xuICByZXR1cm4gKHNsdWdzLCBjd2QpID0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNsdWdzXSwge1xuICAgICAgICBjd2QsXG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgaWYgKHR5cGVvZiBvdXQgPT09ICdzdHJpbmcnKSByZXR1cm4gb3V0O1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIG1lbW8gYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lbW9TdG9yZSB7XG4gIGdldFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nKTogU2V0PHN0cmluZz47XG4gIGFkZFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nLCBuYW1lczogc3RyaW5nW10pOiB2b2lkO1xufVxuXG4vLyBMaXZlcyB1bmRlciB0aGUgc2hhcmVkIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSAoYWdlbnQtaG9va3MtY29tbW9uLnRzJ3Ncbi8vIHNlc3Npb25EaXIpIFx1MjAxNCByZWxvY2F0ZWQgZnJvbSBvcy50bXBkaXIoKS9hZ2VudC1ob29rcy1naXQtc3Bhbi8gc29cbi8vIHBlci1zZXNzaW9uIHN0YXRlIGhhcyBvbmUgaG9tZSBhbmQgaXMgY292ZXJlZCBieSBwcnVuZVN0YWxlU2Vzc2lvbnMnc1xuLy8gb3Bwb3J0dW5pc3RpYyA+MzAtZGF5IHBydW5pbmcuXG5mdW5jdGlvbiBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihzZXNzaW9uRGlyKHNlc3Npb25JZCksICd0b3VjaC1tZW1vLmpzb24nKTtcbn1cblxuZXhwb3J0IHR5cGUgTWVtb0xvZ2dlciA9IENvcmVMb2dnZXI7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiB7XG4gICAgZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJhdyA9IGZzLnJlYWRGaWxlU3luYyhtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKSwgJ3V0ZjgnKTtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHsgc3VyZmFjZWQ/OiB1bmtub3duIH07XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZC5zdXJmYWNlZCkpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IFNldChwYXJzZWQuc3VyZmFjZWQgYXMgc3RyaW5nW10pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gcmVhZCBmYWlsZWQgKHRyZWF0aW5nIGFzIGVtcHR5KScsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBTZXQoKTtcbiAgICB9LFxuICAgIGFkZFN1cmZhY2VkKHNlc3Npb25JZCwgbmFtZXMpIHtcbiAgICAgIHBydW5lU3RhbGVTZXNzaW9ucygpO1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gICAgICBmb3IgKGNvbnN0IG4gb2YgbmFtZXMpIGV4aXN0aW5nLmFkZChuKTtcbiAgICAgIGNvbnN0IG1lbW9EaXIgPSBzZXNzaW9uRGlyKHNlc3Npb25JZCk7XG4gICAgICBjb25zdCBtZW1vUGF0aCA9IG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgdG1wUGF0aCA9IGAke21lbW9QYXRofS50bXBgO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKG1lbW9EaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHRtcFBhdGgsIEpTT04uc3RyaW5naWZ5KHsgc3VyZmFjZWQ6IFsuLi5leGlzdGluZ10gfSksICd1dGY4Jyk7XG4gICAgICAgIGZzLnJlbmFtZVN5bmModG1wUGF0aCwgbWVtb1BhdGgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHdyaXRlIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqIEZhY3RvcnkgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEgTWVtb1N0b3JlIGdpdmVuIGEgbG9nZ2VyLiAqL1xuZXhwb3J0IHR5cGUgTWVtb0ZhY3RvcnkgPSAobG9nZ2VyOiBNZW1vTG9nZ2VyKSA9PiBNZW1vU3RvcmU7XG5cbi8qKiBEZWZhdWx0IGRpc2stYmFja2VkIG1lbW8gZmFjdG9yeSB1c2VkIGluIHByb2R1Y3Rpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZGlza01lbW9GYWN0b3J5KGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggc2NvcGUgcmVzb2x1dGlvbiAocmVwby1zY29waW5nICsgZ2l0aWdub3JlICsgc3Bhbi1yb290IGd1YXJkcylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoU2NvcGUge1xuICByZXBvUm9vdDogc3RyaW5nO1xuICByZXBvUmVsUGF0aDogc3RyaW5nO1xufVxuXG4vKipcbiAqIEJvdW5kIGEgdG91Y2hlZCBmaWxlIHRvIHRoZSBDV0QgcmVwby4gUmVzb2x2ZSB0aGUgcmVwbyByb290IG9mIHRoZSBjdXJyZW50XG4gKiB3b3JraW5nIGRpcmVjdG9yeSBhbmQgcmVxdWlyZSB0aGUgdG91Y2hlZCBmaWxlIHRvIHJlc29sdmUgdG8gdGhlIFNBTUUgcmVwb1xuICogcm9vdDsgZHJvcCBmaWxlcyBpbiBhIGRpZmZlcmVudCByZXBvc2l0b3J5L3dvcmt0cmVlLCBnaXRpZ25vcmVkIGZpbGVzLCBhbmRcbiAqIGZpbGVzIHVuZGVyIHRoZSBzcGFuIHJvb3QuIFJldHVybnMgdGhlIHJlc29sdmVkIGB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9YFxuICogb3IgbnVsbCB3aGVuIHRoZSB0b3VjaCBpcyBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQ29tcGFyaW5nIHJlc29sdmVkIGBnaXQgLS1zaG93LXRvcGxldmVsYCB0b3BsZXZlbHMgKG5vdCBwYXRoIHByZWZpeGVzKVxuICogZGlzdGluZ3Vpc2hlcyBzZXBhcmF0ZSByZXBvcyBhbmQgd29ya3RyZWVzIGFuZCBpcyByb2J1c3QgdG8gc3ltbGlua3MuIEZhaWxcbiAqIGNsb3NlZDogaWYgdGhlIENXRCByZXBvIGNhbid0IGJlIHJlc29sdmVkLCB0aGUgdG91Y2ggaXMgZHJvcHBlZCByYXRoZXIgdGhhblxuICogZmFsbGluZyBiYWNrIHRvIHRoZSBmaWxlJ3Mgb3duIHJlcG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlVG91Y2hTY29wZShjd2Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogVG91Y2hTY29wZSB8IG51bGwge1xuICBjb25zdCBjd2RSZXBvUm9vdCA9IGN3ZCA/IHJlc29sdmVSZXBvUm9vdChjd2QpIDogbnVsbDtcbiAgaWYgKCFjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgYWJzRGlyID0gdG9Qb3NpeChub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKTtcbiAgY29uc3QgZmlsZVJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGFic0Rpcik7XG4gIGlmIChmaWxlUmVwb1Jvb3QgIT09IGN3ZFJlcG9Sb290KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCByZXBvUm9vdCA9IGN3ZFJlcG9Sb290O1xuICBjb25zdCByZXBvUmVsUGF0aCA9IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhYnNQYXRoKTtcblxuICAvLyBTa2lwIGdpdGlnbm9yZWQgZmlsZXMgZW50aXJlbHkuIEJ1aWxkIG91dHB1dCwgY2FjaGVzLCBhbmQgbG9ncyBhcmUgbm90XG4gIC8vIHNwYW4tcmVsZXZhbnQ6IHRoZXkgbXVzdCBuZXZlciBzdXJmYWNlIHNwYW4gb3ZlcmxhcHMuXG4gIGlmIChpc0dpdElnbm9yZWQocmVwb1Jvb3QsIHJlcG9SZWxQYXRoKSkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU2tpcCBzcGFuIGRvY3VtZW50cyBlbnRpcmVseS4gRmlsZXMgdW5kZXIgdGhlIHJlc29sdmVkIHNwYW4gcm9vdCBhcmUgbWFuYWdlZFxuICAvLyBieSBnaXQgc3BhbiBpdHNlbGYgYW5kIGFyZSBub3QgYXBwbGljYXRpb24gc291cmNlcyB0aGF0IG5lZWQgc3BhbiBjb3ZlcmFnZS5cbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICBpZiAoaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aCwgc3BhblJvb3QpKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4geyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTdXJmYWNlIHJvdXRpbmVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogSW5qZWN0ZWQgZGVwZW5kZW5jaWVzIGZvciB7QGxpbmsgc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnN9LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdXJmYWNlRGVwcyB7XG4gIGV4ZWN1dG9yOiBTcGFuRXhlY3V0b3I7XG4gIGRyaWZ0RXhlY3V0b3I6IERyaWZ0RXhlY3V0b3I7XG4gIG1lbW86IE1lbW9TdG9yZTtcbiAgbG9hZFJ1bGVzOiBIb29rSWdub3JlTG9hZGVyO1xuICBsb2dnZXI6IENvcmVMb2dnZXI7XG59XG5cbi8qKlxuICogR2l2ZW4gYSByZXBvLXJlbGF0aXZlIHBhdGggYW5kIHRoZSBsaW5lIHJhbmdlIGJlaW5nIHRvdWNoZWQgd2l0aGluIGFuXG4gKiBhbHJlYWR5LXJlc29sdmVkIHJlcG8sIHByb2R1Y2UgdGhlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gIGJsb2NrIGZvciB0aGVcbiAqIHNwYW5zIG92ZXJsYXBwaW5nIHRoYXQgcmFuZ2UsIG9yIG51bGwgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHRvIHN1cmZhY2UuXG4gKlxuICogVGhlIHBpcGVsaW5lOiBgZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5gIFx1MjE5MiBrZWVwIGxpbmUtcmFuZ2VkIGFuY2hvcnMgb25cbiAqIHRoZSBzYW1lIGZpbGUgdGhhdCBpbnRlcnNlY3QgdGhlIHJhbmdlIGFuZCBhcmUgbm90IGAuaG9va2lnbm9yZWAtc3VwcHJlc3NlZCBcdTIxOTJcbiAqIGRyb3Agc2x1Z3MgYWxyZWFkeSBzdXJmYWNlZCB0aGlzIHNlc3Npb24gKG1lbW8pIFx1MjE5MiByZW5kZXIgYGdpdCBzcGFuIGxpc3RcbiAqIDxuYW1lc1x1MjAyNj5gIFx1MjE5MiBhcHBlbmQgYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIgZm9yIGFueSBhbHJlYWR5LWRyaWZ0ZWRcbiAqIHNwYW4uIE9uIHN1Y2Nlc3MgdGhlIHN1cmZhY2VkIG5hbWVzIGFyZSByZWNvcmRlZCBpbiB0aGUgbWVtby4gRXhlY3V0b3IgYW5kXG4gKiBkcmlmdC1wcm9iZSBmYWlsdXJlcyBhcmUgbG9nZ2VkIGFuZCBkZWdyYWRlIHRvIG51bGwgLyB0aGUgcGxhaW4gYmxvY2s7IHRoZXlcbiAqIG5ldmVyIHRocm93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnMoXG4gIGRlcHM6IFN1cmZhY2VEZXBzLFxuICByZXBvUm9vdDogc3RyaW5nLFxuICByZXBvUmVsUGF0aDogc3RyaW5nLFxuICByYW5nZTogTGluZVJhbmdlLFxuICBzZXNzaW9uSWQ6IHN0cmluZ1xuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHsgZXhlY3V0b3IsIGRyaWZ0RXhlY3V0b3IsIG1lbW8sIGxvYWRSdWxlcywgbG9nZ2VyIH0gPSBkZXBzO1xuXG4gIC8vIEZpbHRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpblxuICBsZXQgcG9yY2VsYWluU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcG9yY2VsYWluU3Rkb3V0ID0gZXhlY3V0b3IoWyctLXBvcmNlbGFpbicsIHJlcG9SZWxQYXRoXSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIFBhdGgtc2NvcGVkIHN1cHByZXNzaW9uOiBhIHJlcG8ncyAuc3Bhbi8uaG9va2lnbm9yZSBjYW4gaG9sZCBiYWNrIHNwYW4gc2x1Z1xuICAvLyBwcmVmaXhlcyBmb3IgYW5jaG9ycyB1bmRlciBnaXZlbiBwYXRocy4gQSBzdXBwcmVzc2VkIHNwYW4gaXMgbmV2ZXIgc3VyZmFjZWQuXG4gIGNvbnN0IGlnbm9yZVJ1bGVzID0gbG9hZFJ1bGVzKHJlcG9Sb290KTtcblxuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IHBhcnNlUG9yY2VsYWluKHBvcmNlbGFpblN0ZG91dCk7XG4gIGNvbnN0IGNhbmRpZGF0ZU5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBpZiAocm93LnBhdGggIT09IHJlcG9SZWxQYXRoKSBjb250aW51ZTtcbiAgICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIGNvbnRpbnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICAgIGlmICghcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KSkgY29udGludWU7XG4gICAgaWYgKGlzU3BhblN1cHByZXNzZWQoaWdub3JlUnVsZXMsIHJvdy5wYXRoLCByb3cubmFtZSkpIGNvbnRpbnVlO1xuICAgIGNhbmRpZGF0ZU5hbWVzLmFkZChyb3cubmFtZSk7XG4gIH1cblxuICBpZiAoY2FuZGlkYXRlTmFtZXMuc2l6ZSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU3VidHJhY3QgYWxyZWFkeS1zdXJmYWNlZCBuYW1lc1xuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9TdXJmYWNlID0gWy4uLmNhbmRpZGF0ZU5hbWVzXS5maWx0ZXIoKG4pID0+ICFzdXJmYWNlZC5oYXMobikpLnNvcnQoKTtcbiAgaWYgKHRvU3VyZmFjZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFJlbmRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxuYW1lMT4gPG5hbWUyPiAuLi5cbiAgbGV0IHJlbmRlclN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHJlbmRlclN0ZG91dCA9IGV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAocmVuZGVyKSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE9mIHRoZSBzcGFucyBiZWluZyBzdXJmYWNlZCwgZmxhZyBhbnkgYWxyZWFkeSBkcmlmdGVkIFx1MjAxNCB0aGUgdG91Y2hlZCBsaW5lcyBoYXZlXG4gIC8vIGRyaWZ0ZWQgZnJvbSB0aGVpciBhbmNob3JlZCBzdGF0ZSBcdTIwMTQgd2l0aCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlci5cbiAgLy8gRGV0ZWN0aW9uIGlzIGFzLW9mLW5vdyAoc3VyZmFjaW5nIHJ1bnMgYmVmb3JlIHRoZSBlZGl0IGFwcGxpZXMpLCBzbyB0aGlzXG4gIC8vIGNhdGNoZXMgcHJlLWV4aXN0aW5nIGRyaWZ0OyBkcmlmdCB0aGlzIHNlc3Npb24gY2F1c2VzIGlzIHRoZSBTdG9wIGhvb2sncyBqb2IuXG4gIC8vIEZhaWx1cmUgdG8gY29tcHV0ZSBkcmlmdCBpcyBub24tZmF0YWw6IGZhbGwgYmFjayB0byB0aGUgcGxhaW4gYmxvY2suXG4gIGxldCBkcmlmdEhpbnQgPSAnJztcbiAgdHJ5IHtcbiAgICBjb25zdCBkcmlmdE5hbWVzID0gbmV3IFNldChwYXJzZURyaWZ0UG9yY2VsYWluKGRyaWZ0RXhlY3V0b3IodG9TdXJmYWNlLCByZXBvUm9vdCkpLm1hcCgocikgPT4gci5uYW1lKSk7XG4gICAgY29uc3QgZHJpZnRTdXJmYWNlZCA9IHRvU3VyZmFjZS5maWx0ZXIoKG4pID0+IGRyaWZ0TmFtZXMuaGFzKG4pKTtcbiAgICBpZiAoZHJpZnRTdXJmYWNlZC5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBsaW5lcyA9IGRyaWZ0U3VyZmFjZWQubWFwKChuKSA9PiBgICBnaXQgc3BhbiBoaXN0b3J5ICR7bn1gKS5qb2luKCdcXG4nKTtcbiAgICAgIGRyaWZ0SGludCA9IGBcXG5EcmlmdCBcdTIwMTQgdGhlIGxpbmVzIHlvdSdyZSB0b3VjaGluZyBoYXZlIGRyaWZ0ZWQgZnJvbSB0aGVzZSBzcGFucycgYW5jaG9yZWQgc3RhdGUuIFJldmlldyBob3cgZWFjaCBzdWJzeXN0ZW0gZXZvbHZlZCBiZWZvcmUgY2hhbmdpbmcgaXQ6XFxuJHtsaW5lc31gO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGRyaWZ0IChoaXN0b3J5IGhpbnQpIGZhaWxlZCcsIHsgZXJyIH0pO1xuICB9XG5cbiAgY29uc3Qgd3JhcHBlZCA9IGBcXG48Z2l0LXNwYW4+XFxuJHtyZW5kZXJTdGRvdXR9JHtkcmlmdEhpbnR9XFxuPC9naXQtc3Bhbj5cXG5gO1xuXG4gIC8vIFVwZGF0ZSBtZW1vXG4gIG1lbW8uYWRkU3VyZmFjZWQoc2Vzc2lvbklkLCB0b1N1cmZhY2UpO1xuXG4gIHJldHVybiB3cmFwcGVkO1xufVxuIiwgIi8qKlxuICogUGF0aC1zY29wZWQgc3BhbiBzdXBwcmVzc2lvbiBmb3IgdGhlIGFnZW50IGhvb2tzLlxuICpcbiAqIFNvbWUgc3BhbnMgYXJlIG5vaXNlIHdoZW4gYnJvd3NpbmcgY2VydGFpbiBwYXJ0cyBvZiB0aGUgdHJlZSBcdTIwMTQgd2lraSBvclxuICogbWFya2V0aW5nIHNwYW5zIHRoYXQgYW5jaG9yIHByb3NlLCBzdXJmYWNlZCBpbmxpbmUgd2hpbGUgcmVhZGluZyBzb3VyY2UsXG4gKiBhZGQgbGl0dGxlLiBUaGlzIG1vZHVsZSBsZXRzIGEgcmVwbyBkZWNsYXJlLCBwZXIgcGF0aCwgd2hpY2ggc3BhbiBzbHVnXG4gKiBwcmVmaXhlcyB0byBob2xkIGJhY2suXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5ob29raWdub3JlYC4gRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGFcbiAqIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4sIGEgc2luZ2xlIHJ1biBvZiB3aGl0ZXNwYWNlLCB0aGVuIGFcbiAqIGNvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHNwYW4gc2x1ZyBwcmVmaXhlcyB0byBzdXBwcmVzcyBmb3IgcGF0aHMgdGhlIHBhdHRlcm5cbiAqIG1hdGNoZXM6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMgd2lraSxtYXJrZXRpbmdcbiAqXG4gKiBBIHNwYW4gd2hvc2Ugc2x1ZyBiZWdpbnMgd2l0aCBgd2lraWAgb3IgYG1hcmtldGluZ2AgKHRoZSBzbHVnIGVxdWFscyB0aGVcbiAqIHByZWZpeCwgb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmApIGlzIHRoZW4gbmV2ZXIgc3VyZmFjZWQgZm9yIGFuIGFuY2hvciB3aG9zZSBwYXRoXG4gKiBzaXRzIHVuZGVyIGBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmNgIFx1MjAxNCBpdCBpcyBuZXZlciBzdXJmYWNlZCBpbiB0aGUgaW5saW5lXG4gKiBgPGdpdC1zcGFuPmAgYmxvY2sgdGhlIGBQb3N0VG9vbFVzZWAgdG91Y2ggaG9vayBlbWl0cy4gSXQgaGFzIG5vIGVmZmVjdCBvblxuICogdGhlIGBQcmVUb29sVXNlYCBhZHZpc29yLCB3aG9zZSBvd24gdW5jb3ZlcmVkLXdyaXRlcyBzdXBwcmVzc2lvbiBsaXZlcyBpblxuICogYC5zcGFuLy5hZHZpc29yaWdub3JlYCAoc2VlIGBhZHZpc29yLWlnbm9yZS50c2ApLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmFkdmlzb3JpZ25vcmVgXG4gKiBpbiBgYWR2aXNvci1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIEhhcm5lc3MtYWdub3N0aWMgdG91Y2gtaG9vayBjb3JlLlxuICpcbiAqIFRoaXMgbW9kdWxlIGltcGxlbWVudHMgdGhlIFBvc3RUb29sVXNlIFwidG91Y2ggc2lnbmFsXCIgdGhhdCBib3RoIHRoZSBDbGF1ZGVcbiAqIChgUmVhZHxFZGl0fFdyaXRlYCkgYW5kIENvZGV4IChgYXBwbHlfcGF0Y2hgKSBhZGFwdGVycyBkcml2ZS4gSXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICoge0BsaW5rIFRvdWNoSW5wdXR9LCBpbmplY3QgZXhlY3V0aW9uL3N0YXRlIGRlcGVuZGVuY2llcywgYW5kIHdyYXAgdGhlIHJldHVybmVkXG4gKiB7QGxpbmsgVG91Y2hPdXRwdXR9IGluIHRoZWlyIG93biBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBSZXVzZWQgZnJvbSB0aGUgc2hhcmVkIGtlcm5lbCAobm90IHJlZGVmaW5lZCk6IGBpc0RlYnQoKWAgK1xuICogYFBvcmNlbGFpblN0YXR1c2AvYERyaWZ0UG9yY2VsYWluUm93YC9gUG9yY2VsYWluUm93YC9gcGFyc2VQb3JjZWxhaW5gL1xuICogYHBhcnNlRHJpZnRQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpLCBgcmFuZ2VzSW50ZXJzZWN0YCBhbmQgdGhlXG4gKiByZXBvL3NwYW4tcm9vdCBwYXRoIHV0aWxpdGllcyAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYW5kIHRoZSBgTWVtb1N0b3JlYFxuICogY2FkZW5jZSBzdG9yZSAoc3Bhbi1zdXJmYWNlLnRzKS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICB0eXBlIERyaWZ0UG9yY2VsYWluUm93LFxuICBodW1hblN0YXR1c0xhYmVsLFxuICBpc0RlYnQsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgdHlwZSBQb3JjZWxhaW5TdGF0dXMsXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBjb2xsYXBzZUJ5UGF0aCwgdHlwZSBSYW5nZUxhYmVsLCByZW5kZXJBbmNob3JUcmVlIH0gZnJvbSAnLi9hbmNob3ItdHJlZS5qcyc7XG5pbXBvcnQgdHlwZSB7IE1lbW9TdG9yZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LWVkaXQgcmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNwbGl0IHdyaXR0ZW4gY29udGVudCBpbnRvIHRoZSBsaW5lcyB0byBsb2NhdGUgb24gZGlzay4gQSBzaW5nbGUgdHJhaWxpbmdcbiAqIG5ld2xpbmUgaXMgZHJvcHBlZCBzbyBgXCJhXFxuYlxcblwiYCBhbmQgYFwiYVxcbmJcImAgbG9jYXRlIGlkZW50aWNhbGx5OyBhbiBlbXB0eVxuICogKG9yIG5ld2xpbmUtb25seSkgd3JpdGUgaGFzIG5vIGxvY2F0YWJsZSBibG9jay5cbiAqL1xuZnVuY3Rpb24gdG9OZWVkbGVMaW5lcyh3cml0dGVuOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCB0cmltbWVkID0gd3JpdHRlbi5lbmRzV2l0aCgnXFxuJykgPyB3cml0dGVuLnNsaWNlKDAsIC0xKSA6IHdyaXR0ZW47XG4gIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICByZXR1cm4gdHJpbW1lZC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgbGluZSByYW5nZSB0aGF0IHdyaXR0ZW4gY29udGVudCBub3cgb2NjdXBpZXMgaW4gdGhlIG9uLWRpc2sgZmlsZSxcbiAqIGZvciBhbmNob3JpbmcgdGhlIHRvdWNoZWQgcmVnaW9uIGFmdGVyIGFuIGVkaXQgaGFzIGFscmVhZHkgYXBwbGllZC5cbiAqXG4gKiBUaGlzIGdlbmVyYWxpemVzIHRoZSBwcmUtZWRpdCBgbG9jYXRlQ2h1bmsoKWAgdGVjaG5pcXVlIGluXG4gKiBbYXBwbHktcGF0Y2gudHNdKC4vcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjL2NvZGV4L2FwcGx5LXBhdGNoLnRzI0wyNTMtTDI4NilcbiAqIChwcmV2aW91c2x5IENvZGV4LW9ubHkpIGludG8gYSBzaGFyZWQgcG9zdC1lZGl0IHByaW1pdGl2ZSBib3RoIGhhcm5lc3NlcyB1c2U6XG4gKiBzcGxpdCBgd3JpdHRlbmAgYW5kIGBvbkRpc2tDb250ZW50YCBpbnRvIGxpbmVzIGFuZCBsb2NhdGUgdGhlIHdyaXR0ZW4gYmxvY2sgYXNcbiAqIGEgY29udGlndW91cyBydW4gaW5zaWRlIHRoZSBvbi1kaXNrIGxpbmVzLlxuICpcbiAqIC0gQSBzaW5nbGUgY29udGlndW91cyBtYXRjaCB5aWVsZHMgaXRzIDEtYmFzZWQgaW5jbHVzaXZlIHtAbGluayBMaW5lUmFuZ2V9LlxuICogLSBXaGVuIHRoZSBibG9jayBpcyBhYnNlbnQsIG9yIGFwcGVhcnMgbW9yZSB0aGFuIG9uY2UgKGNvbnRleHQgdG8gZGlzYW1iaWd1YXRlXG4gKiAgIGlzIG5vdCBhdmFpbGFibGUgcG9zdC1lZGl0KSwgcmVjb3ZlcnkgaXMgYW1iaWd1b3VzIGFuZCB0aGUgcmVzdWx0IGRlZ3JhZGVzXG4gKiAgIHRvIGAnd2hvbGUtZmlsZSdgICh0aGUgc2FtZSBmYWxsYmFjayBgbG9jYXRlQ2h1bmsoKWAgc2lnbmFscyB3aXRoIGBudWxsYCkuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhbiB1bmxvY2F0YWJsZSB3cml0ZSBpcyBhIGAnd2hvbGUtZmlsZSdgIGFuc3dlciwgbm90IGFuIGVycm9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3ZlclJhbmdlKHdyaXR0ZW46IHN0cmluZywgb25EaXNrQ29udGVudDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgY29uc3QgbmVlZGxlID0gdG9OZWVkbGVMaW5lcyh3cml0dGVuKTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG5cbiAgY29uc3QgaGF5c3RhY2sgPSBvbkRpc2tDb250ZW50LnNwbGl0KCdcXG4nKTtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGNvbnN0IHN0YXJ0czogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbGFzdDsgaSsrKSB7XG4gICAgbGV0IG9rID0gdHJ1ZTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IG5lZWRsZS5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGhheXN0YWNrW2kgKyBqXSAhPT0gbmVlZGxlW2pdKSB7XG4gICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob2spIHtcbiAgICAgIHN0YXJ0cy5wdXNoKGkpO1xuICAgICAgaWYgKHN0YXJ0cy5sZW5ndGggPiAxKSBicmVhazsgLy8gZHVwbGljYXRlZCBcdTIxOTIgYW1iaWd1b3VzLCBzdG9wIGVhcmx5XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4geyBzdGFydDogc3RhcnRzWzBdICsgMSwgZW5kOiBzdGFydHNbMF0gKyBuZWVkbGUubGVuZ3RoIH07XG4gIH1cbiAgcmV0dXJuICd3aG9sZS1maWxlJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBpbnB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogV2hpY2ggaGFybmVzcyBldmVudCBmaXJlZCwgYXMgdGhlIHRvdWNoIGNvcmUgc2VlcyBpdC4gVGhlIGNvcmUgYnJhbmNoZXMgb25cbiAqIHRoaXM6IGB3cml0ZWAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlIGFuZCBtYXkgc3VyZmFjZSBhXG4gKiBtZXJnZWQgYmxvY2s7IGByZWFkYCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlIGFuZCBmaWx0ZXJzIHBvc2l0aW9uYWwgc3RhdHVzZXNcbiAqIG91dCBvZiB3aGF0IGl0IHN1cmZhY2VzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEV2ZW50S2luZCA9ICdyZWFkJyB8ICd3cml0ZSc7XG5cbi8qKiBGaWVsZHMgc2hhcmVkIGJ5IGV2ZXJ5IHRvdWNoLCByZWdhcmRsZXNzIG9mIGtpbmQuICovXG5pbnRlcmZhY2UgVG91Y2hJbnB1dEJhc2Uge1xuICAvKiogSGFybmVzcyBzZXNzaW9uIGlkIFx1MjAxNCBrZXlzIHRoZSBwZXItc2Vzc2lvbiBjYWRlbmNlIHtAbGluayBNZW1vU3RvcmV9LiAqL1xuICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFdvcmtpbmcgZGlyZWN0b3J5IHRoZSB0b29sIHJhbiBpbiwgdXNlZCB0byBib3VuZCB0aGUgdG91Y2ggdG8gdGhlIENXRCByZXBvXG4gICAqIHZpYSBgcmVzb2x2ZVRvdWNoU2NvcGUoKWAgYmVmb3JlIGFueSBzcGFuIGludm9jYXRpb24uXG4gICAqL1xuICBjd2Q6IHN0cmluZztcbiAgLyoqIEFic29sdXRlLCBjYW5vbmljYWxpemVkIHBhdGggb2YgdGhlIHRvdWNoZWQgZmlsZS4gKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbn1cblxuLyoqIEEgcmVhZCB0b3VjaCAoQ2xhdWRlIGBSZWFkYCwgb3IgYSByZWFkLXNoYXBlZCBDb2RleCBldmVudCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoUmVhZElucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAncmVhZCc7XG4gIC8qKlxuICAgKiAxLWJhc2VkIHN0YXJ0aW5nIGxpbmUgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBvZmZzZXRgXG4gICAqIGlucHV0LiBgdW5kZWZpbmVkYCB3aGVuIHRoZSByZWFkIGhhZCBubyBgb2Zmc2V0YCAocmVhZHMgZnJvbSBsaW5lIDEpLlxuICAgKi9cbiAgb2Zmc2V0PzogbnVtYmVyO1xuICAvKipcbiAgICogTGluZSBjb3VudCBvZiB0aGUgcmVhZCwgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgYGxpbWl0YCBpbnB1dC5cbiAgICogYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYGxpbWl0YCBcdTIwMTQgc2VlIHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9XG4gICAqIGZvciBob3cgdGhlIHJhbmdlIGlzIGNvbXB1dGVkIGluIHRoYXQgY2FzZS5cbiAgICovXG4gIGxpbWl0PzogbnVtYmVyO1xufVxuXG4vKiogQSB3cml0ZSB0b3VjaCAoQ2xhdWRlIGBFZGl0YC9gV3JpdGVgLCBDb2RleCBgYXBwbHlfcGF0Y2hgKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hXcml0ZUlucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAnd3JpdGUnO1xuICAvKipcbiAgICogVGhlIGNvbnRlbnQganVzdCB3cml0dGVuIHRvIGBmaWxlUGF0aGAsIGZlZCB0byB7QGxpbmsgcmVjb3ZlclJhbmdlfSB0b1xuICAgKiByZS1hbmNob3IgdGhlIHRvdWNoZWQgcmVnaW9uIGFnYWluc3QgdGhlIGhlYWxlZCBvbi1kaXNrIGZpbGUuIEZvciBhXG4gICAqIHdob2xlLWZpbGUgY3JlYXRlIHRoaXMgaXMgdGhlIGVudGlyZSBmaWxlIGJvZHk7IGFuIGVtcHR5IHN0cmluZyBtZWFuc1xuICAgKiBcIm5vIGxvY2F0YWJsZSBibG9ja1wiIGFuZCB0aGUgdG91Y2ggaXMgc2NvcGVkIGZpbGUtd2lkZS5cbiAgICovXG4gIHdyaXR0ZW46IHN0cmluZztcbn1cblxuLyoqIFRoZSBoYXJuZXNzLWFnbm9zdGljIHRvdWNoIHRoZSBjb3JlIGNvbnN1bWVzLiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hJbnB1dCA9IFRvdWNoUmVhZElucHV0IHwgVG91Y2hXcml0ZUlucHV0O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEluamVjdGVkIGV4ZWN1dG9yc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTdHJ1Y3R1cmVkIHJlc3VsdCBvZiBhIHNjb3BlZCBgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hGaXhSZXN1bHQge1xuICAvKipcbiAgICogV2hldGhlciBgLS1maXhgIHJlLWFuY2hvcmVkIGF0IGxlYXN0IG9uZSBzcGFuIGluIHRoZSB3b3JraW5nIHRyZWUuIERyaXZlc1xuICAgKiB7QGxpbmsgVG91Y2hPdXRwdXQudHJlZU1vZGlmaWVkfSBzbyBhIGNhbGxlci90ZXN0IGNhbiBhc3NlcnQgdGhlIGhlYWxpbmdcbiAgICogaGFwcGVuZWQgd2l0aG91dCBkaWZmaW5nIHRoZSB0cmVlIGl0c2VsZi5cbiAgICovXG4gIG1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YCBzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSAod3JpdGUgcGF0aFxuICogb25seSksIHJlcG9ydGluZyB3aGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIGhlYWxlZC4gQXN5bmMgc28gdGhlIGV2ZW50dWFsXG4gKiBpbXBsZW1lbnRhdGlvbiBhbmQgaXRzIHRlc3RzIGNhbiBpbmplY3QgYSBmYWtlIHdpdGhvdXQgYSByZWFsIHN1YnByb2Nlc3MuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRml4RXhlY3V0b3IgPSAoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8VG91Y2hGaXhSZXN1bHQ+O1xuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiA8ZmlsZT5gIGFuZCByZXR1cm4gaXRzIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyXG4gKiBhbmNob3IgY292ZXJpbmcgdGhlIGZpbGUuIFN0cnVjdHVyZWQgKG5vdCByYXcgc3Rkb3V0KSBzbyB0aGUgbWVyZ2VkLWJsb2NrXG4gKiBjb21wdXRhdGlvbiBhbmQgaXRzIHRlc3RzIHNoYXJlIHRoZSBzYW1lIHNoYXBlLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaExpc3RFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPGFyZ3M+YCAoc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgb3JcbiAqIGl0cyBzcGFucykgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXIgZHJpZnRlZCBhbmNob3IsIGVtcHR5IHdoZW5cbiAqIGNsZWFuLiBTdGF0dXMgY2xhc3NpZmljYXRpb24gaXMgdmlhIGBpc0RlYnQoKWA7IHBvc2l0aW9uYWwgKGBNT1ZFRGAsXG4gKiBgUkVTT0xWRURfUEVORElOR19DT01NSVRgKSByb3dzIGFyZSBuZXZlciBkZWJ0LlxuICovXG5leHBvcnQgdHlwZSBUb3VjaERyaWZ0RXhlY3V0b3IgPSAoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPERyaWZ0UG9yY2VsYWluUm93W10+O1xuXG4vKipcbiAqIFJ1biBiYXJlIGBnaXQgc3BhbiB3aHkgPG5hbWU+YCBhbmQgcmV0dXJuIHRoZSBzcGFuJ3MgcmVjb3JkZWQgd2h5IHNlbnRlbmNlLFxuICogb3IgYG51bGxgIHdoZW4gbm9uZSBpcyByZWNvcmRlZCBvciB0aGUgcmVhZCBmYWlscy4gRmVlZHMgdGhlIGh1bWFuLWZvcm1hdFxuICogc3BhbiByZW5kZXI7IGludm9rZWQgb25seSBmb3Igc3BhbnMgYWN0dWFsbHkgYmVpbmcgc3VyZmFjZWQgdGhpcyB0b3VjaC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hXaHlFeGVjdXRvciA9IChuYW1lOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xuXG4vKipcbiAqIFRoZSBpbmplY3RlZCBleGVjdXRpb24gc3VyZmFjZS4gS2VwdCBhcyBmb3VyIG5hcnJvdyBhc3luYyBmdW5jdGlvbnMgKHJhdGhlclxuICogdGhhbiBhIHJhdyBjb21tYW5kIHJ1bm5lcikgc28gdGVzdHMgaW5qZWN0IGZha2VzIHJldHVybmluZyBzdHJ1Y3R1cmVkIGRhdGFcbiAqIGFuZCB0aGUgY29yZSBuZXZlciBzcGF3bnMgYSBzdWJwcm9jZXNzIGl0c2VsZi4gVGhlIGByZWFkYCBwYXRoIG5ldmVyIGludm9rZXNcbiAqIGBmaXhgLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoRXhlY3V0b3JzIHtcbiAgZml4OiBUb3VjaEZpeEV4ZWN1dG9yO1xuICBsaXN0OiBUb3VjaExpc3RFeGVjdXRvcjtcbiAgZHJpZnQ6IFRvdWNoRHJpZnRFeGVjdXRvcjtcbiAgd2h5OiBUb3VjaFdoeUV4ZWN1dG9yO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIG91dHB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGF0IHRoZSBjb3JlIGhhbmRzIGJhY2sgZm9yIHRoZSBhZGFwdGVyIHRvIHRyYW5zbGF0ZSBpbnRvIFNESyBvdXRwdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoT3V0cHV0IHtcbiAgLyoqXG4gICAqIFRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIChoZWFkZXIsIG9uZSBodW1hbi1mb3JtYXQgc2VjdGlvbiBwZXJcbiAgICogc3VyZmFjZWQgc3BhbiwgZm9vdGVyKSB0byBpbmplY3QgdmlhIHRoZSBoYXJuZXNzJ3MgYGFkZGl0aW9uYWxDb250ZXh0YCxcbiAgICogb3IgYG51bGxgIHdoZW4gdGhlcmUgaXMgbm90aGluZyB3b3J0aCBzdXJmYWNpbmcgdGhpcyB0b3VjaC5cbiAgICovXG4gIGFkZGl0aW9uYWxDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgd29ya2luZyB0cmVlIHdhcyBtb2RpZmllZCBieSBhIHNjb3BlZCBgLS1maXhgIG9uIHRoZSB3cml0ZSBwYXRoLlxuICAgKiBBbHdheXMgYGZhbHNlYCBvbiB0aGUgcmVhZCBwYXRoIChyZWFkcyBuZXZlciBtdXRhdGUgdGhlIHRyZWUpLlxuICAgKi9cbiAgdHJlZU1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1lcmdlZC1ibG9jayBhc3NlbWJseVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgbWVtbyBrZXkgdW5kZXIgd2hpY2ggYSBzcGFuJ3MgcmVuZGVyIGZvciBhIGdpdmVuIGRyaWZ0IHN0YXR1cyBpcyBkZWR1cGVkLiAqL1xuZnVuY3Rpb24gZHJpZnRLZXkobmFtZTogc3RyaW5nLCBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIC8vIFNwYW4gbmFtZXMgY29tZSBmcm9tIHRhYi1kZWxpbWl0ZWQgcG9yY2VsYWluLCBzbyB0aGV5IG5ldmVyIGNvbnRhaW4gYSB0YWI7XG4gIC8vIGEgdGFiLWpvaW5lZCBrZXkgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCBhIGJhcmUgc3BhbiBuYW1lICh0aGUgc3VyZmFjaW5nIGtleSkuXG4gIHJldHVybiBgJHtuYW1lfVxcdCR7c3RhdHVzfWA7XG59XG5cbi8qKiBUaGUgYHBhdGgjTHN0YXJ0LUxlbmRgIChvciBiYXJlLXBhdGgsIHdob2xlLWZpbGUpIGFuY2hvciB0ZXh0IGZvciBhIHJvdy4gKi9cbmZ1bmN0aW9uIGFuY2hvclRleHQocm93OiBQb3JjZWxhaW5Sb3cpOiBzdHJpbmcge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiByb3cucGF0aDtcbiAgcmV0dXJuIGAke3Jvdy5wYXRofSNMJHtyb3cuc3RhcnR9LUwke3Jvdy5lbmR9YDtcbn1cblxuZnVuY3Rpb24gY2xlYW5IZWFkZXIoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJHtmaWxlTmFtZX0gaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llczpgO1xufVxuXG5mdW5jdGlvbiBjbGVhbkZvb3RlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBJZiB5b3UgY2hhbmdlICR7ZmlsZU5hbWV9IGNoZWNrIHRoZSBvdGhlciBmaWxlcyB0byBjb25maXJtIHRoZXkgc3RpbGwgd29yayB0b2dldGhlci5gO1xufVxuXG4vKipcbiAqIFRoZSB3cml0ZSBwYXRoIG5hbWVzIHRoZSBlZGl0IGFzIHRoZSBjYXVzZTsgdGhlIHJlYWQgcGF0aCBvbmx5IHN1cmZhY2VzXG4gKiBwcmUtZXhpc3RpbmcgZHJpZnQgaXQgZGlkbid0IGNyZWF0ZSwgc28gaXQgbmFtZXMgdGhlIGRlcGVuZGVuY3kgaW5zdGVhZC5cbiAqL1xuZnVuY3Rpb24gZHJpZnRIZWFkZXIoZHJpZnRlZENvdW50OiBudW1iZXIsIGtpbmQ6IFRvdWNoSW5wdXRbJ2tpbmQnXSk6IHN0cmluZyB7XG4gIGlmIChraW5kID09PSAnd3JpdGUnKSB7XG4gICAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgICAgPyAnVGhpcyBlZGl0IHB1dCBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICAgIDogJ1RoaXMgZWRpdCBwdXQgaW1wbGljaXQgZGVwZW5kZW5jaWVzIG91dCBvZiBkYXRlOic7XG4gIH1cbiAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgID8gJ1RoaXMgZmlsZSBoYXMgYW4gaW1wbGljaXQgZGVwZW5kZW5jeSBvdXQgb2YgZGF0ZTonXG4gICAgOiAnVGhpcyBmaWxlIGhhcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6Jztcbn1cblxuZnVuY3Rpb24gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIGlmIChkcmlmdGVkTmFtZXMubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgbmFtZSA9IGRyaWZ0ZWROYW1lc1swXTtcbiAgICByZXR1cm4gYFJlc3RvcmUgYWdyZWVtZW50IGJlZm9yZSBjb21taXR0aW5nLiBGb2xsb3cgY29uZmlybWVkIGF1dGhvcml0eS4gUHJlc2VydmUgYW5jaG9yIHNoYXBlOyBpZiBhbiBhZGRyZXNzIGNoYW5nZWQsIHN3YXAgdGhlIG9sZCBhbmNob3IgZm9yIHRoZSBuZXcgb25lIHdpdGggXFxgZ2l0IHNwYW4gcmVwbGFjZVxcYC4gVXBkYXRlIG9yIHJldGlyZSB0aGUgd2h5IG9ubHkgaWYgaXRzIG1lYW5pbmcgY2hhbmdlZC4gUmVxdWlyZSBcXGBnaXQgc3BhbiBkcmlmdCAke25hbWV9XFxgIHRvIHJlcG9ydCB6ZXJvLCB0aGVuIGNoZWNrIHRoZSBvdGhlciBhbmNob3JzLiBDb25mb3JtIGEgc2lkZSBvbmx5IHdoZW4gY29uZmlybWVkIGF1dGhvcml0eSBvciBhIHNhdGlzZmllZCBnYXRlIGRlY2lkZXMgaXQ7IHJlcG9ydCBhbWJpZ3VpdHkgb3IgYW4gb2Jzb2xldGUgY291cGxpbmcuYDtcbiAgfVxuICByZXR1cm4gJ0ZvciBlYWNoIG91dC1vZi1kYXRlIHNwYW46IHJlc3RvcmUgYWdyZWVtZW50IGJlZm9yZSBjb21taXR0aW5nLiBGb2xsb3cgY29uZmlybWVkIGF1dGhvcml0eS4gUHJlc2VydmUgYW5jaG9yIHNoYXBlOyBpZiBhbiBhZGRyZXNzIGNoYW5nZWQsIHN3YXAgdGhlIG9sZCBhbmNob3IgZm9yIHRoZSBuZXcgb25lIHdpdGggYGdpdCBzcGFuIHJlcGxhY2VgLiBVcGRhdGUgb3IgcmV0aXJlIHRoZSB3aHkgb25seSBpZiBpdHMgbWVhbmluZyBjaGFuZ2VkLiBSZXF1aXJlIGBnaXQgc3BhbiBkcmlmdCA8bmFtZT5gIHRvIHJlcG9ydCB6ZXJvLCB0aGVuIGNoZWNrIHRoZSBvdGhlciBhbmNob3JzLiBDb25mb3JtIGEgc2lkZSBvbmx5IHdoZW4gY29uZmlybWVkIGF1dGhvcml0eSBvciBhIHNhdGlzZmllZCBnYXRlIGRlY2lkZXMgaXQ7IHJlcG9ydCBhbWJpZ3VpdHkgb3IgYW4gb2Jzb2xldGUgY291cGxpbmcuJztcbn1cblxuLyoqIFRoZSB7QGxpbmsgUmFuZ2VMYWJlbH0gZm9yIGEgcG9yY2VsYWluIHJvdyBcdTIwMTQgYDAtMGAgaXMgdGhlIHdob2xlLWZpbGUgYW5jaG9yLiAqL1xuZnVuY3Rpb24gcmFuZ2VMYWJlbChyb3c6IFBvcmNlbGFpblJvdyk6IFJhbmdlTGFiZWwge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiB7IGtpbmQ6ICd3aG9sZS1maWxlJyB9O1xuICByZXR1cm4geyBraW5kOiAncmFuZ2UnLCBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfTtcbn1cblxuLyoqXG4gKiBBIHNwYW4ncyBmdWxsIGFuY2hvciBsaXN0LCByZW5kZXJlZCBhcyBhIHNoYXJlZC1wcmVmaXggdHJlZSBieVxuICoge0BsaW5rIHJlbmRlckFuY2hvclRyZWV9LCB3aXRoIGVhY2ggYW5jaG9yIHRoYXQgY2FycmllcyBnZW51aW5lIGRyaWZ0XG4gKiBzdWZmaXhlZCBieSBpdHMgbG93ZXJjYXNlIHN0YXR1cyB0b2tlbihzKSAoYCBcdTIwMTQgY2hhbmdlZGApLlxuICpcbiAqIEEgZHJpZnQgcm93IG1hdGNoZXMgYW4gYW5jaG9yIGJ5IGV4YWN0IHBhdGgrcmFuZ2UsIG9yIGJ5IHBhdGggYWxvbmUgd2hlbiB0aGVcbiAqIHNwYW4gaGFzIGEgc2luZ2xlIGFuY2hvciBvbiB0aGF0IHBhdGggKHJhbmdlcyBjYW4gZGlzYWdyZWUgYWZ0ZXIgYSBoZWFsKS5cbiAqIGBzb2xlT25QYXRoYCBpcyBkZWxpYmVyYXRlbHkgY29tcHV0ZWQgb3ZlciB0aGUgKipmdWxsIGZsYXQgYW5jaG9yIGxpc3QqKixcbiAqIGJlZm9yZSBhbnkgZ3JvdXBpbmcgXHUyMDE0IHRoZSB0cmVlIGxheW91dCBtdXN0IG5ldmVyIGJlIGFibGUgdG8gY2hhbmdlICp3aGljaCpcbiAqIGFuY2hvcnMgZ2V0IGxhYmVsZWQsIG9ubHkgd2hlcmUgdGhleSBzaXQgb24gdGhlIHBhZ2UuXG4gKi9cbmZ1bmN0aW9uIGFuY2hvckJ1bGxldHMoYW5jaG9yczogUG9yY2VsYWluUm93W10sIGRlYnRSb3dzOiBEcmlmdFBvcmNlbGFpblJvd1tdKTogc3RyaW5nW10ge1xuICBjb25zdCByb3dzID0gYW5jaG9ycy5tYXAoKGFuY2hvcikgPT4ge1xuICAgIGNvbnN0IHNvbGVPblBhdGggPSBhbmNob3JzLmZpbHRlcigoYSkgPT4gYS5wYXRoID09PSBhbmNob3IucGF0aCkubGVuZ3RoID09PSAxO1xuICAgIGNvbnN0IHN0YXR1c2VzID0gbmV3IFNldDxQb3JjZWxhaW5TdGF0dXM+KCk7XG4gICAgZm9yIChjb25zdCByb3cgb2YgZGVidFJvd3MpIHtcbiAgICAgIGlmIChyb3cucGF0aCAhPT0gYW5jaG9yLnBhdGgpIGNvbnRpbnVlO1xuICAgICAgaWYgKHNvbGVPblBhdGggfHwgKHJvdy5zdGFydCA9PT0gYW5jaG9yLnN0YXJ0ICYmIHJvdy5lbmQgPT09IGFuY2hvci5lbmQpKSB7XG4gICAgICAgIHN0YXR1c2VzLmFkZChyb3cuc3RhdHVzKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3Qgc29ydGVkID0gWy4uLnN0YXR1c2VzXS5zb3J0KCk7XG4gICAgY29uc3Qgc3VmZml4ID0gc29ydGVkLmxlbmd0aCA+IDAgPyBgIFx1MjAxNCAke3NvcnRlZC5tYXAoaHVtYW5TdGF0dXNMYWJlbCkuam9pbignLCAnKX1gIDogJyc7XG4gICAgcmV0dXJuIHsgcGF0aDogYW5jaG9yLnBhdGgsIHJhbmdlOiByYW5nZUxhYmVsKGFuY2hvciksIHN1ZmZpeCB9O1xuICB9KTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gcmVuZGVyQW5jaG9yVHJlZShjb2xsYXBzZUJ5UGF0aChyb3dzKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IGRvIG5vdCByZW1vdmUgaXRcbiAgICAvLyBvbiB0aGUgdGhlb3J5IHRoYXQgYSBkZWdyYWRlZCBmYWxsYmFjayBpcyBpdHNlbGYgZm9yYmlkZGVuLiBBbiB1bmNhdWdodFxuICAgIC8vIHRocm93IGhlcmUgZG9lcyBub3QgZGVncmFkZSB0byBhIGZsYXQgbGlzdDogaXQgZXNjYXBlcyB0b1xuICAgIC8vIGBydW5Ub3VjaEhvb2tgJ3MgY2F0Y2gsIHdoaWNoIHJlc29sdmVzIHRoZSB3aG9sZSBob29rIHRvXG4gICAgLy8gYGFkZGl0aW9uYWxDb250ZXh0OiBudWxsYCwgc28gdGhlIGFnZW50IGlzIG5ldmVyIHRvbGQgYWJvdXQgdGhlIGRyaWZ0IGF0XG4gICAgLy8gYWxsLiBDYXRjaGluZyBsb2NhbGx5IG5hcnJvd3Mgd2hhdCBhIHJlbmRlcmluZyBkZWZlY3QgY2FuIGNvc3QgZnJvbSBcInRoZVxuICAgIC8vIHJlbWluZGVyIGRpc2FwcGVhcnNcIiB0byBcInRoZSByZW1pbmRlciBsb29rcyBsaWtlIGl0IGRpZCBiZWZvcmUgdGhlIHRyZWVcIi5cbiAgICAvLyBXaGV0aGVyIHRvIHN1cmZhY2UgYW5kIHdoYXQgc2hhcGUgdG8gc3VyZmFjZSBpbiBhcmUgZGlmZmVyZW50IHRoaW5ncywgYW5kXG4gICAgLy8gdGhpcyBjYXRjaCBvbmx5IGV2ZXIgdG91Y2hlcyB0aGUgbGF0dGVyLlxuICAgIC8vIGByb3dzYCBpcyBpbmRleC1hbGlnbmVkIHdpdGggYGFuY2hvcnNgLCBzbyB0aGlzIHJlcHJvZHVjZXMgdG9kYXkncyBmbGF0XG4gICAgLy8gYnVsbGV0IHJ1biBieXRlIGZvciBieXRlLCBzdWZmaXhlcyBpbmNsdWRlZC5cbiAgICByZXR1cm4gYW5jaG9ycy5tYXAoKGFuY2hvciwgaSkgPT4gYC0gJHthbmNob3JUZXh0KGFuY2hvcil9JHtyb3dzW2ldLnN1ZmZpeH1gKTtcbiAgfVxufVxuXG4vKipcbiAqIE9uZSBodW1hbi1mb3JtYXQgc3BhbiBzZWN0aW9uOiBgIyMgPG5hbWU+YCwgdGhlIGZ1bGwgYW5jaG9yIGxpc3QgKGRyaWZ0ZWRcbiAqIGFuY2hvcnMgc3RhdHVzLXN1ZmZpeGVkKSwgYW5kIHRoZSB3aHkgc2VudGVuY2Ugd2hlbiBvbmUgaXMgcmVjb3JkZWQuXG4gKlxuICogVGhlIG5hbWUgaGVhZGVyIGFuZCB0aGUgd2h5IHNlbnRlbmNlIGFyZSB0aGUgc2FtZSBzaGFwZSBgZ2l0IHNwYW4gbGlzdGBcbiAqIHJlbmRlcnM7IHRoZSBhbmNob3IgbGlzdCBkZWxpYmVyYXRlbHkgaXMgbm90IFx1MjAxNCBpdCByZW5kZXJzIGFzIGEgc2hhcmVkLXByZWZpeFxuICogdHJlZSAoe0BsaW5rIGFuY2hvckJ1bGxldHN9KSB3aGVyZSB0aGUgQ0xJIHByaW50cyBhIGZsYXQgYC0gcGF0aCNMcmFuZ2VgXG4gKiBidWxsZXQgcnVuLiBUaGUgQ0xJJ3Mgb3duIHRleHQgZm9ybWF0IGlzIHVudG91Y2hlZDsgb25seSB0aGlzIGhvb2snc1xuICogcmUtcHJlc2VudGF0aW9uIG9mIGl0IGdyb3Vwcy5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyU3BhblNlY3Rpb24oXG4gIG5hbWU6IHN0cmluZyxcbiAgYW5jaG9yczogUG9yY2VsYWluUm93W10sXG4gIGRlYnRSb3dzOiBEcmlmdFBvcmNlbGFpblJvd1tdLFxuICB3aHk6IHN0cmluZyB8IG51bGxcbik6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gW2AjIyAke25hbWV9YCwgLi4uYW5jaG9yQnVsbGV0cyhhbmNob3JzLCBkZWJ0Um93cyldO1xuICBpZiAod2h5KSBsaW5lcy5wdXNoKCcnLCB3aHkpO1xuICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogQXNzZW1ibGUgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2s6IGhlYWRlciwgb25lIHNlY3Rpb24gcGVyIHN1cmZhY2VkXG4gKiBzcGFuIChzZXBhcmF0ZWQgYnkgYC0tLWApLCBhbmQgYSBzaW5nbGUgZm9vdGVyIGFmdGVyIGEgZmluYWwgYC0tLWAuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkQmxvY2soc2VjdGlvbnM6IHN0cmluZ1tdLCBoZWFkZXI6IHN0cmluZywgZm9vdGVyOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBib2R5ID0gYCR7aGVhZGVyfVxcblxcbiR7c2VjdGlvbnMuam9pbignXFxuXFxuLS0tXFxuXFxuJyl9XFxuXFxuLS0tXFxuXFxuJHtmb290ZXJ9YDtcbiAgcmV0dXJuIGBcXG48Z2l0LXNwYW4+XFxuJHtib2R5fVxcbjwvZ2l0LXNwYW4+XFxuYDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBob29rIGVudHJ5IHBvaW50XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgaW4gc2NvcGUgZm9yIHRoZSByZWNvdmVyZWQgcmFuZ2UuICovXG5mdW5jdGlvbiBpbnRlcnNlY3RzKHJvdzogUG9yY2VsYWluUm93LCByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnKTogYm9vbGVhbiB7XG4gIGlmIChyYW5nZSA9PT0gJ3dob2xlLWZpbGUnKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4gdHJ1ZTsgLy8gd2hvbGUtZmlsZSBhbmNob3JcbiAgcmV0dXJuIHJhbmdlc0ludGVyc2VjdChyYW5nZSwgeyBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfSk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgdG91Y2hlZCByYW5nZSBmcm9tIHRoZSBvbi1kaXNrIGZpbGUgZm9yIGEgd3JpdGUuIEFuIGVtcHR5IHdyaXRlIG9yXG4gKiBhbiB1bnJlYWRhYmxlIGZpbGUgKGUuZy4gYSBkZWxldGUsIG9yIHRoZSBmaWxlIHdhcyBuZXZlciB3cml0dGVuKSBkZWdyYWRlcyB0b1xuICogYCd3aG9sZS1maWxlJ2AsIHNjb3BpbmcgdGhlIHRvdWNoIHRvIGV2ZXJ5IGNvdmVyaW5nIHNwYW4gXHUyMDE0IHRoZSBmYWlsLW9wZW5cbiAqIGJlaGF2aW9yLCBub3QgYW4gZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSYW5nZUZyb21EaXNrKHdyaXR0ZW46IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZyk6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgbGV0IGNvbnRlbnQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICB9XG4gIHJldHVybiByZWNvdmVyUmFuZ2Uod3JpdHRlbiwgY29udGVudCk7XG59XG5cbi8qKlxuICogVGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGRvY3VtZW50ZWQgZGVmYXVsdCBsaW5lIGNvdW50IHdoZW4gYG9mZnNldGAgaXNcbiAqIGdpdmVuIHdpdGhvdXQgYGxpbWl0YCAoXCJCeSBkZWZhdWx0LCBpdCByZWFkcyB1cCB0byAyMDAwIGxpbmVzXCIpLiBOYW1lZCBzb1xuICogdGhlIGFzc3VtcHRpb24gaXMgdmlzaWJsZSBhbmQgZWFzeSB0byB1cGRhdGUgaWYgdGhhdCBkZWZhdWx0IGV2ZXIgY2hhbmdlcy5cbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVBRF9MSU1JVCA9IDIwMDA7XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgdG91Y2hlZCByYW5nZSBmb3IgYSByZWFkIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzXG4gKiBgb2Zmc2V0YC9gbGltaXRgIGlucHV0cy4gTmVpdGhlciBwcmVzZW50IG1lYW5zIGEgZ2VudWluZSB3aG9sZS1maWxlIHJlYWQgXHUyMDE0XG4gKiBldmVyeSBjb3ZlcmluZyBzcGFuIHN0YXlzIGluIHNjb3BlLCBtYXRjaGluZyB0b2RheSdzIGJlaGF2aW9yLiBPdGhlcndpc2VcbiAqIHRoZSByYW5nZSBzdGFydHMgYXQgYG9mZnNldGAgKGRlZmF1bHQgbGluZSAxKSBhbmQgcnVucyBmb3IgYGxpbWl0YCBsaW5lc1xuICogKGRlZmF1bHQge0BsaW5rIERFRkFVTFRfUkVBRF9MSU1JVH0pLCBjbGFtcGVkIHRvIHRoZSBmaWxlJ3MgYWN0dWFsIGxpbmVcbiAqIGNvdW50IHNvIGEgc2hvcnQgZmlsZSB3aXRoIGEgbGFyZ2UgYG9mZnNldGAvYGxpbWl0YCBkb2Vzbid0IG92ZXJzaG9vdC5cbiAqIENsYW1waW5nIHJlcXVpcmVzIHJlYWRpbmcgdGhlIGZpbGU7IGFuIHVucmVhZGFibGUgZmlsZSBkZWdyYWRlcyB0b1xuICogYCd3aG9sZS1maWxlJ2AgXHUyMDE0IHRoZSBzYW1lIGZhaWwtb3BlbiBiZWhhdmlvciB0aGUgd3JpdGUgcGF0aCB1c2VzLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmVhZFJhbmdlKFxuICBvZmZzZXQ6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgbGltaXQ6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgZmlsZVBhdGg6IHN0cmluZ1xuKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkICYmIGxpbWl0ID09PSB1bmRlZmluZWQpIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGNvbnN0IHN0YXJ0ID0gb2Zmc2V0ID8/IDE7XG4gIGxldCBsaW5lQ291bnQ6IG51bWJlcjtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpO1xuICAgIGxpbmVDb3VudCA9IGNvbnRlbnQubGVuZ3RoID09PSAwID8gMCA6IGNvbnRlbnQuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICBjb25zdCBlbmQgPSBNYXRoLm1pbihzdGFydCArIChsaW1pdCA/PyBERUZBVUxUX1JFQURfTElNSVQpIC0gMSwgTWF0aC5tYXgobGluZUNvdW50LCBzdGFydCkpO1xuICByZXR1cm4geyBzdGFydCwgZW5kIH07XG59XG5cbi8qKlxuICogV2hldGhlciBhIGNvdmVyaW5nIHJvdyBpcyBhbiBhbmNob3IgaW4gdGhlIHRvdWNoZWQgZmlsZSBpdHNlbGYuIGBsaXN0XG4gKiAtLXBvcmNlbGFpbiA8ZmlsZT5gIHJldHVybnMgZXZlcnkgYW5jaG9yIG9mIGVhY2ggbWF0Y2hpbmcgc3BhbiBcdTIwMTQgY3Jvc3MtZmlsZVxuICogYW5jaG9ycyBpbmNsdWRlZCBcdTIwMTQgYnV0IG9ubHkgYW5jaG9ycyBpbiB0aGUgdG91Y2hlZCBmaWxlIHBhcnRpY2lwYXRlIGluIHRoZVxuICogcmFuZ2UtaW50ZXJzZWN0aW9uIHNjb3BlIHRlc3QuIFJvdyBwYXRocyBhcmUgcmVwby1yZWxhdGl2ZTsgdGhlIHRvdWNoZWQgcGF0aFxuICogaXMgYWJzb2x1dGUsIHNvIG1hdGNoIG9uIGFuIGV4YWN0IG9yIGAvYC1zZXBhcmF0ZWQgc3VmZml4LlxuICovXG5mdW5jdGlvbiBvblRvdWNoZWRGaWxlKHJvdzogUG9yY2VsYWluUm93LCBmaWxlUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBmaWxlUGF0aCA9PT0gcm93LnBhdGggfHwgZmlsZVBhdGguZW5kc1dpdGgoYC8ke3Jvdy5wYXRofWApO1xufVxuXG4vKipcbiAqIENvbXB1dGUgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgZm9yIHRoZSB0b3VjaCwgb3IgYG51bGxgIHdoZW4gdGhlcmUgaXNcbiAqIG5vdGhpbmcgd29ydGggc3VyZmFjaW5nLiBTaGFyZWQgYnkgYm90aCBwYXRoczsgdGhlIHdyaXRlIHBhdGggcGFzc2VzIGFcbiAqIHJlY292ZXJlZCByYW5nZSBmb3IgcHJlY2lzaW9uLCB0aGUgcmVhZCBwYXRoIHNjb3BlcyBmaWxlLXdpZGUuXG4gKlxuICogQSBzcGFuIHJlbmRlcnMgYXMgYSBmdWxsIGh1bWFuLWZvcm1hdCBzZWN0aW9uIChuYW1lLCBhbGwgYW5jaG9ycyB3aXRoXG4gKiBkcmlmdGVkIG9uZXMgc3RhdHVzLXN1ZmZpeGVkLCB3aHkpIHdoZW4gaXRzIG5hbWUgaGFzIG5vdCBiZWVuIHN1cmZhY2VkIHRoaXNcbiAqIHNlc3Npb24sIG9yIHdoZW4gaXQgY2FycmllcyBhIGRyaWZ0IHN0YXR1cyBub3QgeWV0IHN1cmZhY2VkIGZvciBpdCBcdTIwMTQgc28gYVxuICogc3BhbiBmaXJzdCBzZWVuIGhlYWx0aHkgcmUtcmVuZGVycyBpbiBmdWxsIHdoZW4gZHJpZnQgbGF0ZXIgYXBwZWFycy4gQSBzcGFuXG4gKiB3aG9zZSBvbmx5IGRyaWZ0IGlzIHBvc2l0aW9uYWwgKGBNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBcdTIwMTQgbmV2ZXJcbiAqIGBpc0RlYnRgKSBpcyBmaWx0ZXJlZCBvdXQgZW50aXJlbHk6IHBvc2l0aW9uYWwgZHJpZnQgbmV2ZXIgc3VyZmFjZXMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNvbXB1dGVTdXJmYWNlKFxuICBpbnB1dDogVG91Y2hJbnB1dCxcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlLFxuICByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnXG4pOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgY29uc3QgY292ZXJpbmcgPSBhd2FpdCBleGVjdXRvcnMubGlzdChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgaWYgKGNvdmVyaW5nLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gR3JvdXAgZXZlcnkgYW5jaG9yIGJ5IHNwYW47IGEgc3BhbiBpcyBpbiBzY29wZSB3aGVuIG9uZSBvZiBpdHMgYW5jaG9ycyBvblxuICAvLyB0aGUgdG91Y2hlZCBmaWxlIGludGVyc2VjdHMgdGhlIHJlY292ZXJlZCByYW5nZS5cbiAgY29uc3QgYW5jaG9yc0J5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2YgY292ZXJpbmcpIHtcbiAgICBjb25zdCByb3dzID0gYW5jaG9yc0J5TmFtZS5nZXQocm93Lm5hbWUpID8/IFtdO1xuICAgIHJvd3MucHVzaChyb3cpO1xuICAgIGFuY2hvcnNCeU5hbWUuc2V0KHJvdy5uYW1lLCByb3dzKTtcbiAgfVxuICBjb25zdCB0b3VjaGVkTmFtZXMgPSBbLi4uYW5jaG9yc0J5TmFtZS5rZXlzKCldLmZpbHRlcigobmFtZSkgPT5cbiAgICAoYW5jaG9yc0J5TmFtZS5nZXQobmFtZSkgPz8gW10pLnNvbWUoKHJvdykgPT4gb25Ub3VjaGVkRmlsZShyb3csIGlucHV0LmZpbGVQYXRoKSAmJiBpbnRlcnNlY3RzKHJvdywgcmFuZ2UpKVxuICApO1xuICBpZiAodG91Y2hlZE5hbWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgZHJpZnRSb3dzID0gYXdhaXQgZXhlY3V0b3JzLmRyaWZ0KFtpbnB1dC5maWxlUGF0aF0sIGlucHV0LmN3ZCk7XG4gIGNvbnN0IGRyaWZ0QnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIERyaWZ0UG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGRyaWZ0Um93cykge1xuICAgIGNvbnN0IHJvd3MgPSBkcmlmdEJ5TmFtZS5nZXQocm93Lm5hbWUpID8/IFtdO1xuICAgIHJvd3MucHVzaChyb3cpO1xuICAgIGRyaWZ0QnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cblxuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoaW5wdXQuc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9SZWNvcmQ6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHNlY3Rpb25zOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBkcmlmdGVkTmFtZXM6IHN0cmluZ1tdID0gW107XG5cbiAgZm9yIChjb25zdCBuYW1lIG9mIHRvdWNoZWROYW1lcykge1xuICAgIGNvbnN0IHNwYW5EcmlmdCA9IGRyaWZ0QnlOYW1lLmdldChuYW1lKSA/PyBbXTtcbiAgICBjb25zdCBkZWJ0Um93cyA9IHNwYW5EcmlmdC5maWx0ZXIoKHJvdykgPT4gaXNEZWJ0KHJvdy5zdGF0dXMpKTtcbiAgICBpZiAoc3BhbkRyaWZ0Lmxlbmd0aCA+IDAgJiYgZGVidFJvd3MubGVuZ3RoID09PSAwKSBjb250aW51ZTsgLy8gcG9zaXRpb25hbC1vbmx5IGRyaWZ0IG5ldmVyIHN1cmZhY2VzXG5cbiAgICBjb25zdCBkZWJ0U3RhdHVzZXMgPSBbLi4ubmV3IFNldChkZWJ0Um93cy5tYXAoKHJvdykgPT4gcm93LnN0YXR1cykpXS5zb3J0KCk7XG4gICAgY29uc3QgdW5zdXJmYWNlZERlYnQgPSBkZWJ0U3RhdHVzZXMuZmlsdGVyKChzdGF0dXMpID0+ICFzdXJmYWNlZC5oYXMoZHJpZnRLZXkobmFtZSwgc3RhdHVzKSkpO1xuICAgIGNvbnN0IGlzTmV3TmFtZSA9ICFzdXJmYWNlZC5oYXMobmFtZSk7XG4gICAgaWYgKCFpc05ld05hbWUgJiYgdW5zdXJmYWNlZERlYnQubGVuZ3RoID09PSAwKSBjb250aW51ZTsgLy8gZnVsbHkgc3VyZmFjZWQgYWxyZWFkeVxuXG4gICAgY29uc3Qgd2h5ID0gYXdhaXQgZXhlY3V0b3JzLndoeShuYW1lLCBpbnB1dC5jd2QpO1xuICAgIHNlY3Rpb25zLnB1c2gocmVuZGVyU3BhblNlY3Rpb24obmFtZSwgYW5jaG9yc0J5TmFtZS5nZXQobmFtZSkgPz8gW10sIGRlYnRSb3dzLCB3aHkpKTtcbiAgICBpZiAoZGVidFN0YXR1c2VzLmxlbmd0aCA+IDApIGRyaWZ0ZWROYW1lcy5wdXNoKG5hbWUpO1xuXG4gICAgaWYgKGlzTmV3TmFtZSkgdG9SZWNvcmQucHVzaChuYW1lKTtcbiAgICBmb3IgKGNvbnN0IHN0YXR1cyBvZiB1bnN1cmZhY2VkRGVidCkgdG9SZWNvcmQucHVzaChkcmlmdEtleShuYW1lLCBzdGF0dXMpKTtcbiAgfVxuXG4gIGlmIChzZWN0aW9ucy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBtZW1vLmFkZFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCwgdG9SZWNvcmQpO1xuICBjb25zdCBmaWxlTmFtZSA9IGJhc2VuYW1lKGlucHV0LmZpbGVQYXRoKTtcbiAgY29uc3QgaGVhZGVyID0gZHJpZnRlZE5hbWVzLmxlbmd0aCA+IDAgPyBkcmlmdEhlYWRlcihkcmlmdGVkTmFtZXMubGVuZ3RoLCBpbnB1dC5raW5kKSA6IGNsZWFuSGVhZGVyKGZpbGVOYW1lKTtcbiAgY29uc3QgZm9vdGVyID0gZHJpZnRlZE5hbWVzLmxlbmd0aCA+IDAgPyBkcmlmdEZvb3RlcihkcmlmdGVkTmFtZXMpIDogY2xlYW5Gb290ZXIoZmlsZU5hbWUpO1xuICByZXR1cm4gYnVpbGRCbG9jayhzZWN0aW9ucywgaGVhZGVyLCBmb290ZXIpO1xufVxuXG4vKipcbiAqIFJ1biB0aGUgdG91Y2ggaG9vayBmb3IgYSBzaW5nbGUgdG9vbCBjYWxsLCBicmFuY2hpbmcgb24ge0BsaW5rIFRvdWNoSW5wdXQua2luZH0uXG4gKlxuICogLSAqKldyaXRlIHBhdGgqKjogcnVuIGBleGVjdXRvcnMuZml4YCAoYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGApIHNjb3BlZFxuICogICB0byB0aGUgdG91Y2hlZCBmaWxlIHRvIGhlYWwgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlLCB0aGVuXG4gKiAgIGNvbXB1dGUgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgYWdhaW5zdCB0aGUgaGVhbGVkIGFuY2hvcnMsIHJlbmRlcmluZ1xuICogICBlYWNoIHN1cmZhY2VkIHNwYW4gYXMgYSBmdWxsIGh1bWFuLWZvcm1hdCBzZWN0aW9uIHdpdGggYW55IHJlbWFpbmluZ1xuICogICBzZW1hbnRpYyBkcmlmdCBzdGF0dXMtc3VmZml4ZWQgb24gaXRzIGFuY2hvcnMuIENhZGVuY2UgaXMgZGVkdXBlZCB0aHJvdWdoXG4gKiAgIGBtZW1vYCBwZXIgc3BhbiBuYW1lIGFuZCBwZXIgKHNwYW4sIHN0YXR1cykuXG4gKiAtICoqUmVhZCBwYXRoKio6IG5ldmVyIGludm9rZXMgYGZpeGAgYW5kIG5ldmVyIG11dGF0ZXMgdGhlIHRyZWU7IHN1cmZhY2VzIHRoZVxuICogICBzcGFucyBvdmVybGFwcGluZyB0aGUgcmVhZCdzIGBvZmZzZXRgL2BsaW1pdGAgd2luZG93IChzZWVcbiAqICAge0BsaW5rIHJlY292ZXJSZWFkUmFuZ2V9OyBhIHJlYWQgd2l0aCBuZWl0aGVyIGlzIHdob2xlLWZpbGUsIG1hdGNoaW5nXG4gKiAgIHRvZGF5J3MgYmVoYXZpb3IpIHdpdGggcG9zaXRpb25hbCBzdGF0dXNlcyBmaWx0ZXJlZCBvdXQgdmlhIGBpc0RlYnQoKWAuXG4gKlxuICogRmFpbHMgb3BlbjogYW55IGV4ZWN1dG9yIHJlamVjdGlvbiBvciBpbnRlcm5hbCBlcnJvciB5aWVsZHNcbiAqIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAgKG5vIHNpZ25hbCwgZWRpdGluZyBuZXZlciBibG9ja2VkKSByYXRoZXIgdGhhblxuICogdGhyb3dpbmcuIGB0cmVlTW9kaWZpZWRgIHJlZmxlY3RzIGEgc3VjY2Vzc2Z1bCBgLS1maXhgIGV2ZW4gd2hlbiB0aGVcbiAqIHN1YnNlcXVlbnQgc3VyZmFjZSBjb21wdXRhdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRvdWNoSG9vayhcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZVxuKTogUHJvbWlzZTxUb3VjaE91dHB1dD4ge1xuICBsZXQgdHJlZU1vZGlmaWVkID0gZmFsc2U7XG4gIHRyeSB7XG4gICAgbGV0IHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScgPSAnd2hvbGUtZmlsZSc7XG4gICAgaWYgKGlucHV0LmtpbmQgPT09ICd3cml0ZScpIHtcbiAgICAgIGNvbnN0IGZpeCA9IGF3YWl0IGV4ZWN1dG9ycy5maXgoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gICAgICB0cmVlTW9kaWZpZWQgPSBmaXgubW9kaWZpZWQ7XG4gICAgICByYW5nZSA9IHJlY292ZXJSYW5nZUZyb21EaXNrKGlucHV0LndyaXR0ZW4sIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSByZWNvdmVyUmVhZFJhbmdlKGlucHV0Lm9mZnNldCwgaW5wdXQubGltaXQsIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9XG4gICAgY29uc3QgYWRkaXRpb25hbENvbnRleHQgPSBhd2FpdCBjb21wdXRlU3VyZmFjZShpbnB1dCwgZXhlY3V0b3JzLCBtZW1vLCByYW5nZSk7XG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQsIHRyZWVNb2RpZmllZCB9O1xuICB9IGNhdGNoIHtcbiAgICAvLyBGYWlsIG9wZW46IG5ldmVyIGxldCBhIHRvdWNoLWNvcmUgZXJyb3IgcHJvcGFnYXRlIHVwIGFuZCBibG9jayB0aGUgdG9vbFxuICAgIC8vIGNhbGwuIFRoZSB0cmVlIG1heSBhbHJlYWR5IGhhdmUgYmVlbiBoZWFsZWQgKHRyZWVNb2RpZmllZCBwcmVzZXJ2ZWQpLlxuICAgIHJldHVybiB7IGFkZGl0aW9uYWxDb250ZXh0OiBudWxsLCB0cmVlTW9kaWZpZWQgfTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgc3VicHJvY2Vzcy1iYWNrZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gMTBfMDAwO1xuXG4vKiogUmVzb2x2ZSB0aGUgdG91Y2hlZCBmaWxlIHRvIGEgcGF0aCByZWxhdGl2ZSB0byBpdHMgcmVwbyByb290LCBmb3IgYGdpdCBzcGFuYC4gKi9cbmZ1bmN0aW9uIHJlcG9SZWxBcmcoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpOiB7IHJlcG9Sb290OiBzdHJpbmc7IHJlbFBhdGg6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGlmICghcmVwb1Jvb3QpIHJldHVybiBudWxsO1xuICByZXR1cm4geyByZXBvUm9vdCwgcmVsUGF0aDogcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGZpbGVQYXRoKSB9O1xufVxuXG4vKipcbiAqIEEgc25hcHNob3Qgb2YgdGhlIHNwYW4gcm9vdCdzIHdvcmtpbmctdHJlZSBzdGF0dXMsIHVzZWQgdG8gZGV0ZWN0IHdoZXRoZXIgYVxuICogYC0tZml4YCByZS1hbmNob3JlZCBhbnl0aGluZy4gQ29tcGFyZWQgYmVmb3JlL2FmdGVyOyBhbiB1bnJlc29sdmFibGUgcmVwbyBvclxuICogYSBmYWlsZWQgc3RhdHVzIHlpZWxkcyBhIHN0YWJsZSBlbXB0eSBzdHJpbmcgKFx1MjE5MiBgbW9kaWZpZWQ6IGZhbHNlYCkuXG4gKi9cbmZ1bmN0aW9uIHNwYW5TdGF0dXNTbmFwc2hvdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICB0cnkge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3N0YXR1cycsICctLXBvcmNlbGFpbicsICctLScsIHNwYW5Sb290XSwge1xuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgdGltZW91dDogREVGQVVMVF9USU1FT1VUX01TXG4gICAgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBwcm9kdWN0aW9uIGV4ZWN1dGlvbiBzdXJmYWNlOiB0aHJlZSBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnMgZm9sbG93aW5nXG4gKiBzcGFuLXN1cmZhY2UudHMncyBgY3JlYXRlRGVmYXVsdCpFeGVjdXRvcmAgc3R5bGUuIEVhY2ggY2FwdHVyZXMgc3Rkb3V0IGV2ZW4gb25cbiAqIGEgbm9uLXplcm8gZXhpdCB3aGVyZSB0aGUgQ0xJIHN0aWxsIGVtaXRzIHVzZWZ1bCBvdXRwdXQsIGFuZCBldmVyeSBmYWlsdXJlXG4gKiBtb2RlIChhYnNlbnQgYmluYXJ5LCB0aW1lb3V0LCBwYXJzZSBmYWlsdXJlKSBzdXJmYWNlcyBhcyBhbiBlbXB0eS9jbGVhbiByZXN1bHRcbiAqIHNvIHtAbGluayBydW5Ub3VjaEhvb2t9J3MgZmFpbC1vcGVuIGNvbnRyYWN0IGhvbGRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzKHRpbWVvdXRNczogbnVtYmVyID0gREVGQVVMVF9USU1FT1VUX01TKTogVG91Y2hFeGVjdXRvcnMge1xuICByZXR1cm4ge1xuICAgIGZpeDogYXN5bmMgKGZpbGVQYXRoLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVwb1JlbEFyZyhmaWxlUGF0aCwgY3dkKTtcbiAgICAgIGlmICghcmVzb2x2ZWQpIHJldHVybiB7IG1vZGlmaWVkOiBmYWxzZSB9O1xuICAgICAgY29uc3QgYmVmb3JlID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgcmVzb2x2ZWQucmVsUGF0aCwgJy0tZml4J10sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBgZ2l0IHNwYW4gZHJpZnRgIGV4aXRzIDEgb24gZHJpZnQgZXZlbiB3aGVuIGAtLWZpeGAgaGVhbGVkIHNvbWV0aGluZyxcbiAgICAgICAgLy8gYW5kIG5vbi16ZXJvIG9uIGdlbnVpbmUgZmFpbHVyZTsgdGhlIHNuYXBzaG90IGRpZmYgaXMgdGhlIHNvdXJjZSBvZlxuICAgICAgICAvLyB0cnV0aCBmb3Igd2hldGhlciB0aGUgdHJlZSBjaGFuZ2VkLCBzbyB0aGUgZXhpdCBjb2RlIGlzIGlnbm9yZWQgaGVyZS5cbiAgICAgIH1cbiAgICAgIGNvbnN0IGFmdGVyID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHJldHVybiB7IG1vZGlmaWVkOiBiZWZvcmUgIT09IGFmdGVyIH07XG4gICAgfSxcblxuICAgIGxpc3Q6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4gW107XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgcmVzb2x2ZWQucmVsUGF0aF0sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBkcmlmdDogYXN5bmMgKGFyZ3MsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGNvbnN0IHJ1bkN3ZCA9IHJlcG9Sb290ID8/IGN3ZDtcbiAgICAgIC8vIFRoZSBjb3JlIHBhc3NlcyBhbiBhYnNvbHV0ZSBmaWxlIHBhdGg7IHNjb3BlIGBnaXQgc3BhbiBkcmlmdGAgdG8gaXRcbiAgICAgIC8vIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3Qgc28gdGhlIHBhdGggaW5kZXggcmVzb2x2ZXMgaXQuXG4gICAgICBjb25zdCBzY29wZWQgPSByZXBvUm9vdCA/IGFyZ3MubWFwKChhKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYSkpIDogYXJncztcbiAgICAgIGxldCBvdXQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNjb3BlZF0sIHtcbiAgICAgICAgICBjd2Q6IHJ1bkN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgaWYgKHR5cGVvZiBjYXB0dXJlZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICBvdXQgPSBjYXB0dXJlZDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZURyaWZ0UG9yY2VsYWluKG91dCk7XG4gICAgfSxcblxuICAgIHdoeTogYXN5bmMgKG5hbWUsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3doeScsIG5hbWVdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCA/PyBjd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB0ZXh0ID0gb3V0LnRyaW1FbmQoKTtcbiAgICAgICAgLy8gQmFyZSBgZ2l0IHNwYW4gd2h5YCBwcmludHMgdGhpcyBleGFjdCBzZW50aW5lbCAoZXhpdCAwKSB3aGVuIHRoZVxuICAgICAgICAvLyBzcGFuIGhhcyBubyB3aHkgcmVjb3JkZWQgXHUyMDE0IHRyZWF0IGl0IGFzIFwibm8gd2h5XCIsIG5vdCBhcyBjb250ZW50LlxuICAgICAgICBpZiAodGV4dC5sZW5ndGggPT09IDAgfHwgdGV4dCA9PT0gYFxcYCR7bmFtZX1cXGAgaGFzIG5vIHdoeSByZWNvcmRlZC5gKSByZXR1cm4gbnVsbDtcbiAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGJveC1kcmF3aW5nIHRyZWUgcmVuZGVyZXIgZm9yIGEgc3BhbidzIGFuY2hvciBsaXN0LCB1c2VkIGJ5IGV2ZXJ5XG4gKiBjYWxsIHNpdGUgdGhhdCB0b2RheSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHN0YXJ0LUxlbmRgIGJ1bGxldCBydW5cbiAqIChgdG91Y2gtY29yZS50c2AncyBgYW5jaG9yQnVsbGV0c2AsIGFuZCBgYWR2aXNvci1jb3JlLnRzYCdzXG4gKiBgYW5ub3RhdGVCbG9ja3NgL2Bncm91cENvdmVyaW5nQnlOYW1lYCkuIEFuY2hvcnMgdGhhdCBzaGFyZSBhIGRpcmVjdG9yeVxuICogcHJlZml4IGNvbGxhcHNlIGludG8gb25lIHRyZWUgaW5zdGVhZCBvZiBiZWluZyByZWNvbnN0cnVjdGVkIGJ5IGV5ZSBmcm9tIGFcbiAqIGZsYXQgbGlzdCBcdTIwMTQgdGhlIG1vdGl2YXRpbmcgY2FzZSBpcyBwYXJpdHkgYW5jaG9ycyB1bmRlciBwYXJhbGxlbFxuICogYHB1YmxpYy9jbGF1ZGUvLi4uYC9gcHVibGljL2NvZGV4Ly4uLmAgdHJlZXMuXG4gKlxuICogVGhpcyBtb2R1bGUgaXMgYSBwdXJlIHByZXNlbnRhdGlvbiB0cmFuc2Zvcm06IGl0IG5ldmVyIGNvbXB1dGVzIGRyaWZ0XG4gKiBzdGF0dXMgb3IgZGVjaWRlcyB3aGljaCBhbmNob3JzIGFyZSBzdXJmYWNlZC4gQ2FsbGVycyBwcmVjb21wdXRlIGVhY2ggcm93J3NcbiAqIGBzdWZmaXhgIChlLmcuIGAgXHUyMDE0IGNoYW5nZWRgKSBleGFjdGx5IGFzIHRoZXkgZG8gdG9kYXksIGFuZCBvbmx5IHRoZSAqc2hhcGUqXG4gKiBvZiB0aGUgcHJpbnRlZCBsaXN0IGNoYW5nZXMuXG4gKi9cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgdHlwZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEhvdyBhIHNpbmdsZSBhbmNob3IncyBsaW5lIHJhbmdlIGlzIGtub3duLiBgcmFuZ2VgIGFuZCBgd2hvbGUtZmlsZWAgYXJlIHRoZVxuICogdHdvIHNoYXBlcyBldmVyeSBhbmNob3IgdGFrZXMgdG9kYXk7IGB0cnVuY2F0ZWRgIGlzIGEgZGVmZW5zaXZlIHRoaXJkIHNoYXBlXG4gKiByZWFjaGFibGUgb25seSBmcm9tIHJlLXBhcnNpbmcgdGhlIENMSSdzIGZsYXQgaHVtYW4tZm9ybWF0IHRleHQgKGEgYCNMYFxuICogZnJhZ21lbnQgdGhhdCBkb2Vzbid0IGNsZWFubHkgbWF0Y2ggYCNMc3RhcnQtTGVuZGApLlxuICpcbiAqIFZlcmlmaWVkIGludmFyaWFudDogdGhlIHN0cnVjdHVyZWQtZGF0YSBjYWxsIHNpdGVzIGNhbiBuZXZlciBwcm9kdWNlXG4gKiBgdHJ1bmNhdGVkYC4gYHBhcnNlUG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSBgY29udGludWVgcyBwYXN0IGFueVxuICogcm93IG1pc3NpbmcgYSB2YWxpZCByYW5nZSwgc28gYW4gaW5jb21wbGV0ZSBgUG9yY2VsYWluUm93YCBjYW4gbmV2ZXIgYmVcbiAqIGNvbnN0cnVjdGVkOyB0aGUgUnVzdCBDTEkncyBvd24gcG9yY2VsYWluIHdyaXRlciBhbHdheXMgZW1pdHMgYSByYW5nZVxuICogY29sdW1uIChgMC0wYCBmb3Igd2hvbGUtZmlsZSkuIGB0cnVuY2F0ZWRgIGlzIHJlYWNoYWJsZSBvbmx5IGZyb21cbiAqIGBhbm5vdGF0ZUJsb2Nrc2AnIGZsYXQtdGV4dCBwYXJzaW5nIG9mIGBibG9ja3NUZXh0YCBpbiBhIGxhdGVyIHBoYXNlLlxuICovXG5leHBvcnQgdHlwZSBSYW5nZUxhYmVsID0geyBraW5kOiAncmFuZ2UnOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgeyBraW5kOiAnd2hvbGUtZmlsZScgfSB8IHsga2luZDogJ3RydW5jYXRlZCcgfTtcblxuLyoqIE9uZSBzdGFja2VkIHJhbmdlIHVuZGVyIGEgYFRyZWVBbmNob3JgLCB3aXRoIGl0cyBwcmVjb21wdXRlZCBkcmlmdCBzdWZmaXguICovXG5leHBvcnQgaW50ZXJmYWNlIFJhbmdlRW50cnkge1xuICByYW5nZTogUmFuZ2VMYWJlbDtcbiAgLyoqIFByZWNvbXB1dGVkIGAgXHUyMDE0IGNoYW5nZWRgIChldGMuKSwgb3IgYCcnYCB3aGVuIHRoZSBhbmNob3IgY2FycmllcyBubyBkcmlmdC4gKi9cbiAgc3VmZml4OiBzdHJpbmc7XG59XG5cbi8qKiBPbmUgZGlzdGluY3QgcGF0aCdzIGNvbGxhcHNlZCBhbmNob3IgZW50cnksIHJlYWR5IGZvciB0cmVlIGxheW91dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVHJlZUFuY2hvciB7XG4gIC8qKiBSZXBvLXJlbGF0aXZlLCBwb3NpeC1zZXBhcmF0ZWQgcGF0aC4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogU3RhY2tlZCByYW5nZXMgb24gdGhpcyBwYXRoLiBFbXB0eSBtZWFucyBcInBhdGggb25seSwgbm8gcmFuZ2UgY29sdW1uIGF0XG4gICAqIGFsbFwiIFx1MjAxNCBhIGJhcmUtcGF0aCBsZWFmLCBkaXN0aW5jdCBmcm9tIGEgc2luZ2xlIGB3aG9sZS1maWxlYCBlbnRyeSAod2hpY2hcbiAgICogcmVuZGVycyB0aGUgcGF0aCB0b28sIGJ1dCBpcyBhbiBleHBsaWNpdCByYW5nZS1raW5kIGNsYXNzaWZpY2F0aW9uKS5cbiAgICovXG4gIHJhbmdlczogUmFuZ2VFbnRyeVtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGNvbGxhcHNlQnlQYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDb2xsYXBzZSByb3dzIHRoYXQgbmFtZSB0aGUgc2FtZSBwYXRoIGludG8gb25lIGBUcmVlQW5jaG9yYCB3aXRoIHN0YWNrZWRcbiAqIHJhbmdlcywgcHJlc2VydmluZyBmaXJzdC1zZWVuIG9yZGVyLiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlc1xuICogYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlciBkaXN0aW5jdCBwYXRoIFx1MjAxNCB0aGlzIGlzIHRoZSBtYW5kYXRvcnlcbiAqIHByZS1wcm9jZXNzaW5nIHN0ZXAgZXZlcnkgY2FsbGVyIHJ1bnMgZmlyc3QgdG8gZ3VhcmFudGVlIHRoYXQuXG4gKlxuICogTWlycm9ycyB0aGUgb3JkZXItYXJyYXktcGx1cy1NYXAgaWRpb20gYWxyZWFkeSB1c2VkIGJ5XG4gKiBgZGVkdXBlQnlBbmNob3IoKWAgKGFkdmlzb3ItY29yZS50cykgZm9yIHRoZSBzYW1lIHJlYXNvbjogdGhlIENMSSBjYW4gZW1pdFxuICogbXVsdGlwbGUgcm93cyBmb3Igb25lIGxvZ2ljYWwgcGF0aCwgYW5kIHRoZSAqcG9zaXRpb24qIG9mIGEgbGF0ZXJcbiAqIHNhbWUtcGF0aCByb3cgaXMgc3Vic3VtZWQgaW50byB0aGF0IHBhdGgncyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgYXBwZW5kZWRcbiAqIGF0IGl0cyBvd24gbGF0ZXIgcG9zaXRpb24uIENvbmNyZXRlbHk6IGBhLnRzI0wxLUw1YCwgYGIudHMjTDEtTDVgLFxuICogYGEudHMjTDktTDEyYCBjb2xsYXBzZXMgdG8gYFthLnRzICh0d28gc3RhY2tlZCByYW5nZXMpLCBiLnRzIChvbmUgcmFuZ2UpXWBcbiAqIFx1MjAxNCBgYS50c2Agc2l0cyBhdCBwb3NpdGlvbiAwLCBpdHMgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGl0cyBsYXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29sbGFwc2VCeVBhdGgocm93czogeyBwYXRoOiBzdHJpbmc7IHJhbmdlOiBSYW5nZUxhYmVsOyBzdWZmaXg6IHN0cmluZyB9W10pOiBUcmVlQW5jaG9yW10ge1xuICBjb25zdCBvcmRlcjogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgYnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIFRyZWVBbmNob3I+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBsZXQgYW5jaG9yID0gYnlQYXRoLmdldChyb3cucGF0aCk7XG4gICAgaWYgKCFhbmNob3IpIHtcbiAgICAgIGFuY2hvciA9IHsgcGF0aDogcm93LnBhdGgsIHJhbmdlczogW10gfTtcbiAgICAgIGJ5UGF0aC5zZXQocm93LnBhdGgsIGFuY2hvcik7XG4gICAgICBvcmRlci5wdXNoKHJvdy5wYXRoKTtcbiAgICB9XG4gICAgYW5jaG9yLnJhbmdlcy5wdXNoKHsgcmFuZ2U6IHJvdy5yYW5nZSwgc3VmZml4OiByb3cuc3VmZml4IH0pO1xuICB9XG4gIHJldHVybiBvcmRlci5tYXAoKHBhdGgpID0+IGJ5UGF0aC5nZXQocGF0aCkgYXMgVHJlZUFuY2hvcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVHJlZSBjb25zdHJ1Y3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgTGVhZk5vZGUge1xuICBraW5kOiAnbGVhZic7XG4gIG5hbWU6IHN0cmluZztcbiAgYW5jaG9yOiBUcmVlQW5jaG9yO1xufVxuXG5pbnRlcmZhY2UgRGlyTm9kZSB7XG4gIGtpbmQ6ICdkaXInO1xuICBuYW1lOiBzdHJpbmc7XG4gIGNoaWxkcmVuOiBQYXRoVHJlZU5vZGVbXTtcbn1cblxudHlwZSBQYXRoVHJlZU5vZGUgPSBMZWFmTm9kZSB8IERpck5vZGU7XG5cbi8qKlxuICogU3BsaXQgYSBwYXRoIGludG8gYC9gLXNlcGFyYXRlZCBzZWdtZW50cywgb3IgYG51bGxgIHdoZW4gZG9pbmcgc28gd291bGRcbiAqIGZlZWQgYW4gZW1wdHktc3RyaW5nIHNlZ21lbnQgaW50byB0aGUgdHJpZSAoYSBsZWFkaW5nIGAvYCwgYSB0cmFpbGluZyBgL2AsXG4gKiBhIGRvdWJsZWQgYC8vYCwgb3IgdGhlIGVtcHR5IHN0cmluZykuIGBudWxsYCBzaWduYWxzIHRoZSBjYWxsZXIgdG8gcmVuZGVyXG4gKiB0aGF0IGFuY2hvcidzIGZ1bGwgcGF0aCBzdHJpbmcgYXMgYSBzaW5nbGUsIHVuc3BsaXQsIGF0b21pYyB0b3AtbGV2ZWwgbGVhZlxuICogaW5zdGVhZCBvZiBhdHRlbXB0aW5nIHRvIG5lc3QgaXQgXHUyMDE0IGEga25vd24tZW51bWVyYWJsZSBjbGFzcyBvZiBtYWxmb3JtZWRcbiAqIHBhdGhzIGdldHMgYSByZWFsIHJ1bGUgaGVyZSByYXRoZXIgdGhhbiB0aGUgc3BsaXQgcnVubmluZyBhbnl3YXkgYW5kXG4gKiBmYWJyaWNhdGluZyBhbiBlbXB0eS1uYW1lZCBkaXJlY3Rvcnkgbm9kZS4gQSBiYXJlIGZpbGVuYW1lIHdpdGggbm8gYC9gIGF0XG4gKiBhbGwgcHJvZHVjZXMgZXhhY3RseSBvbmUgbm9uLWVtcHR5IHNlZ21lbnQgYW5kIGlzIGhhbmRsZWQgYnkgdGhlIG9yZGluYXJ5XG4gKiBwYXRoIGJlbG93IChpdCBiZWNvbWVzIGEgdG9wLWxldmVsIGxlYWYgd2l0aCBubyBkaXJlY3RvcnkgdG8gbmVzdCB1bmRlciBcdTIwMTRcbiAqIGFscmVhZHkgYXRvbWljLCBubyBzcGVjaWFsIGNhc2UgbmVlZGVkKS5cbiAqL1xuZnVuY3Rpb24gc3BsaXRTZWdtZW50cyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBzZWdtZW50cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IHNlZ21lbnQubGVuZ3RoID09PSAwKSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBzZWdtZW50cztcbn1cblxuZnVuY3Rpb24gZmluZE9yQ3JlYXRlRGlyKHBhcmVudDogRGlyTm9kZSwgbmFtZTogc3RyaW5nKTogRGlyTm9kZSB7XG4gIGZvciAoY29uc3QgY2hpbGQgb2YgcGFyZW50LmNoaWxkcmVuKSB7XG4gICAgaWYgKGNoaWxkLmtpbmQgPT09ICdkaXInICYmIGNoaWxkLm5hbWUgPT09IG5hbWUpIHJldHVybiBjaGlsZDtcbiAgfVxuICBjb25zdCBub2RlOiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZSwgY2hpbGRyZW46IFtdIH07XG4gIHBhcmVudC5jaGlsZHJlbi5wdXNoKG5vZGUpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuLyoqIEluc2VydCBvbmUgYW5jaG9yIGludG8gdGhlIHRyaWUsIGNyZWF0aW5nL3JldXNpbmcgZGlyZWN0b3J5IG5vZGVzIGluIGFycml2YWwgb3JkZXIuICovXG5mdW5jdGlvbiBpbnNlcnRBbmNob3Iocm9vdDogRGlyTm9kZSwgc2VnbWVudHM6IHN0cmluZ1tdLCBhbmNob3I6IFRyZWVBbmNob3IpOiB2b2lkIHtcbiAgbGV0IGN1ciA9IHJvb3Q7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgY3VyID0gZmluZE9yQ3JlYXRlRGlyKGN1ciwgc2VnbWVudHNbaV0pO1xuICB9XG4gIGN1ci5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXSwgYW5jaG9yIH0pO1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSB0b3AtbGV2ZWwgZm9yZXN0IGZyb20gYSBgVHJlZUFuY2hvcltdYCBhbHJlYWR5IGNvbGxhcHNlZCBieVxuICogYGNvbGxhcHNlQnlQYXRoYC4gU2libGluZyBvcmRlciBpcyBuZXZlciByZS1zb3J0ZWQgXHUyMDE0IGEgcGF0aCBlaXRoZXIgb3BlbnMgYVxuICogbmV3IG5vZGUgYXQgaXRzIGFycml2YWwgcG9zaXRpb24gb3IgaXMgbmVzdGVkIHVuZGVyIGEgZGlyZWN0b3J5IG5vZGVcbiAqIGNyZWF0ZWQvcmV1c2VkIGF0IHRoYXQgZGlyZWN0b3J5J3Mgb3duIGZpcnN0LW9jY3VycmVuY2UgcG9zaXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRm9yZXN0KGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IFBhdGhUcmVlTm9kZVtdIHtcbiAgY29uc3Qgcm9vdDogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWU6ICcnLCBjaGlsZHJlbjogW10gfTtcbiAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgIGNvbnN0IHNlZ21lbnRzID0gc3BsaXRTZWdtZW50cyhhbmNob3IucGF0aCk7XG4gICAgaWYgKHNlZ21lbnRzID09PSBudWxsKSB7XG4gICAgICByb290LmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IGFuY2hvci5wYXRoLCBhbmNob3IgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaW5zZXJ0QW5jaG9yKHJvb3QsIHNlZ21lbnRzLCBhbmNob3IpO1xuICB9XG4gIHJldHVybiByb290LmNoaWxkcmVuO1xufVxuXG4vKiogQSBub2RlIHBhaXJlZCB3aXRoIHRoZSAocG9zc2libHkgZm9sZGVkKSBuYW1lIGl0IGRpc3BsYXlzIG9uIGl0cyBvd24gbGluZS4gKi9cbmludGVyZmFjZSBEaXNwbGF5SXRlbSB7XG4gIG5hbWU6IHN0cmluZztcbiAgbm9kZTogUGF0aFRyZWVOb2RlO1xufVxuXG4vKipcbiAqIEZvbGQgYSBjaGFpbiBvZiBzaW5nbGUtY2hpbGQgbm9kZXMgaW50byBvbmUgY29tYmluZWQgbmFtZVxuICogKGBwdWJsaWMvY2xhdWRlL3J1bnRpbWUvc2tpbGxzL2NhcmRgLCBgZGlydHkvbW9kLnJzYCxcbiAqIGAuZGV2Y29udGFpbmVyL0RvY2tlcmZpbGVgKS4gRm9sZGluZyBjb250aW51ZXMgd2hpbGUgdGhlIGN1cnJlbnQgbm9kZSBpcyBhXG4gKiBkaXJlY3Rvcnkgd2l0aCAqKmV4YWN0bHkgb25lIGNoaWxkKiosIHJlZ2FyZGxlc3Mgb2Ygd2hldGhlciB0aGF0IGNoaWxkIGlzIGFcbiAqIGRpcmVjdG9yeSBvciBhIGxlYWY6IGEgbm9kZSB3aXRoIG9uZSBjaGlsZCBjb252ZXlzIG5vIGdyb3VwaW5nIGJ5XG4gKiBkZWZpbml0aW9uLCBzbyBmb2xkaW5nIGl0IGxvc2VzIG5vIHN0cnVjdHVyZSB3aGlsZSByZW1vdmluZyBhIGxpbmUgd2hvc2VcbiAqIG9ubHkgY29udGVudCBpcyBhIGNvbm5lY3Rvci4gU3RvcHMgYXQgdGhlIGZpcnN0IGRpcmVjdG9yeSB3aXRoIDIrIGNoaWxkcmVuXG4gKiAoZXhwYW5kIGZyb20gdGhlcmUpIG9yIGF0IGEgbGVhZiAod2hpY2ggdGhlbiByZW5kZXJzIHdpdGggdGhlIGZvbGRlZCBuYW1lKS5cbiAqXG4gKiBGb2xkaW5nIGxvbmUgKmxlYXZlcyogXHUyMDE0IG5vdCBqdXN0IGxvbmUgZGlyZWN0b3JpZXMgXHUyMDE0IGlzIHdoYXQga2VlcHMgdGhlIHRyZWVcbiAqIG5vIHRhbGxlciB0aGFuIHRoZSBmbGF0IGJ1bGxldCBsaXN0IGl0IHJlcGxhY2VzLCBhbmQgd2hhdCBtYWtlcyBhIHNpbmdsZVxuICogYW5jaG9yIHJlbmRlciBhcyB0aGUgb25lLWxpbmUgdHJlZSB0aGUgcGxhbiBwcm9taXNlcyBldmVuIHdoZW4gaXRzIHBhdGggaGFzXG4gKiBkaXJlY3RvcmllcyBpbiBpdC4gSXQgYWxzbyBrZWVwcyB0aGUgZGlzY3JpbWluYXRpbmcgc2VnbWVudCBvbiB0aGUgc2FtZVxuICogbGluZSBhcyBpdHMgcmFuZ2UgKGBkaXJ0eS9tb2QucnMgI0wzOTItTDM5OWApIGZvciBgbW9kLnJzYC9gaW5kZXgudHNgXG4gKiBsYXlvdXRzLCB3aGVyZSB0aGUgZmlsZW5hbWUgYWxvbmUgaWRlbnRpZmllcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBmb2xkQ2hhaW4obm9kZTogUGF0aFRyZWVOb2RlKTogRGlzcGxheUl0ZW0ge1xuICBsZXQgbmFtZSA9IG5vZGUubmFtZTtcbiAgbGV0IGN1ciA9IG5vZGU7XG4gIHdoaWxlIChjdXIua2luZCA9PT0gJ2RpcicgJiYgY3VyLmNoaWxkcmVuLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IGNoaWxkID0gY3VyLmNoaWxkcmVuWzBdO1xuICAgIG5hbWUgPSBgJHtuYW1lfS8ke2NoaWxkLm5hbWV9YDtcbiAgICBjdXIgPSBjaGlsZDtcbiAgfVxuICByZXR1cm4geyBuYW1lLCBub2RlOiBjdXIgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJhbmsgb2YgYSBzdGFja2VkIGVudHJ5J3MgcmFuZ2Uga2luZDogYHdob2xlLWZpbGVgIGZpcnN0LCB0aGVuIG51bWVyaWNcbiAqIGByYW5nZWBzLCB0aGVuIGB0cnVuY2F0ZWRgLiBBIHdob2xlLWZpbGUgYW5jaG9yIGlzIHRoZSBDTEkncyBgMC0wYCByb3cgXHUyMDE0IGl0XG4gKiBjb3ZlcnMgdGhlIGVudGlyZSBmaWxlLCBzbyBpdCBzb3J0cyBhaGVhZCBvZiBldmVyeSBsaW5lIHJhbmdlIG9uIHRoYXQgZmlsZVxuICogdGhlIHNhbWUgd2F5IGxpbmUgMCB3b3VsZC4gYHRydW5jYXRlZGAgY2FycmllcyBubyBwb3NpdGlvbiBhdCBhbGwgYW5kIHNvcnRzXG4gKiBsYXN0LlxuICovXG5mdW5jdGlvbiByYW5nZVJhbmsocmFuZ2U6IFJhbmdlTGFiZWwpOiBudW1iZXIge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiAwO1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiAxO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gMjtcbiAgfVxufVxuXG4vKipcbiAqIFN0YWNrZWQtcmFuZ2Ugb3JkZXIgaXMgYnkga2luZCByYW5rIHRoZW4gbnVtZXJpYyAoYHN0YXJ0YCB0aGVuIGBlbmRgKSxcbiAqIG92ZXJyaWRpbmcgYXJyaXZhbCBvciBjb2RlcG9pbnQgb3JkZXIgXHUyMDE0IHRoZSBvbmx5IHNvcnRpbmcgdGhpcyBtb2R1bGUgZG9lcyxcbiAqIGFuZCBzY29wZWQgc3RyaWN0bHkgdG8gcmFuZ2VzIHN0YWNrZWQgb24gb25lIHBhdGggKG5ldmVyIHRvIHNpYmxpbmcgcGF0aHNcbiAqIG9yIGRpcmVjdG9yeSBvcmRlcikuIEVxdWFsLXJhbmtlZCBlbnRyaWVzICh0d28gYHRydW5jYXRlZGBzLCBvciB0d29cbiAqIGlkZW50aWNhbCByYW5nZXMpIGtlZXAgdGhlaXIgb3duIHJlbGF0aXZlIGFycml2YWwgb3JkZXIsIHNpbmNlIHRoZSBzb3J0IGlzXG4gKiBzdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGNvbXBhcmVSYW5nZUVudHJpZXMoYTogUmFuZ2VFbnRyeSwgYjogUmFuZ2VFbnRyeSk6IG51bWJlciB7XG4gIGNvbnN0IHJhbmsgPSByYW5nZVJhbmsoYS5yYW5nZSkgLSByYW5nZVJhbmsoYi5yYW5nZSk7XG4gIGlmIChyYW5rICE9PSAwKSByZXR1cm4gcmFuaztcbiAgaWYgKGEucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJyAmJiBiLnJhbmdlLmtpbmQgPT09ICdyYW5nZScpIHtcbiAgICByZXR1cm4gYS5yYW5nZS5zdGFydCAtIGIucmFuZ2Uuc3RhcnQgfHwgYS5yYW5nZS5lbmQgLSBiLnJhbmdlLmVuZDtcbiAgfVxuICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBUaGUgcmFuZ2UgY29sdW1uJ3MgdGV4dCwgb3IgYG51bGxgIHdoZW4gdGhlIGVudHJ5IHByaW50cyBhcyBhIGJhcmUgcGF0aFxuICogd2l0aCBubyByYW5nZSBjb2x1bW4gYXQgYWxsLlxuICpcbiAqIEEgYHdob2xlLWZpbGVgIGVudHJ5IGlzIHRoZSBvbmUga2luZCB3aG9zZSByZW5kZXJpbmcgZGVwZW5kcyBvbiBjb250ZXh0LlxuICogQWxvbmUgb24gaXRzIHBhdGggaXQgc3RheXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciBcdTIwMTQgdGhhdCBpcyB3aGF0IHRoZVxuICogQ0xJJ3Mgb3duIGZsYXQgbGlzdCBwcmludHMgZm9yIGEgd2hvbGUtZmlsZSBhbmNob3IsIGFuZCBhZGRpbmcgYSBtYXJrZXJcbiAqIHRoZXJlIHdvdWxkIGFubm90YXRlIHRoZSBvdmVyd2hlbG1pbmdseSBjb21tb24gY2FzZSBmb3IgdGhlIGJlbmVmaXQgb2YgdGhlXG4gKiByYXJlIG9uZS4gKlN0YWNrZWQqIGJlaGluZCBvdGhlciByYW5nZXMgb24gdGhlIHNhbWUgcGF0aCBpdCBtdXN0IGNhcnJ5IGFuXG4gKiBleHBsaWNpdCBtYXJrZXI6IHdpdGhvdXQgb25lIGl0IHJlbmRlcnMgYXMgYSBjb250aW51YXRpb24gbGluZSBob2xkaW5nXG4gKiBub3RoaW5nIGJ1dCBpbmRlbnRhdGlvbiBhbmQgaXRzIGRyaWZ0IHN1ZmZpeCwgd2hpY2ggZXJhc2VzIHRoZSBhbmNob3JcbiAqIG91dHJpZ2h0IHdoZW4gdGhlIHN1ZmZpeCBpcyBlbXB0eSBhbmQgXHUyMDE0IHdvcnNlIFx1MjAxNCBoYW5ncyBpdHMgYCBcdTIwMTQgY2hhbmdlZGBcbiAqIHVuZGVyIGEgbmVpZ2hib3VyaW5nIHJhbmdlLCBleGFjdGx5IHRoZSB2aXN1YWwgZ3JhbW1hciB0aGF0IG1lYW5zIFwiYW5vdGhlclxuICogcmFuZ2Ugb24gdGhpcyBzYW1lIGZpbGVcIi4gVGhlIHJlYWRlciB3b3VsZCB0aGVuIHJlY29uY2lsZSB0aGUgcmFuZ2UgdGhhdFxuICogZGlkIG5vdCBkcmlmdC4gT2YgdGhlIHRocmVlIGZpeGVzIGF2YWlsYWJsZSAocHJpbnQgdGhlIHBhdGggb25cbiAqIGNvbnRpbnVhdGlvbiBsaW5lcywgc29ydCB3aG9sZS1maWxlIHRvIHBvc2l0aW9uIDAsIG9yIHNwbGl0IGl0IGludG8gaXRzIG93blxuICogbGVhZiksIGFuIGV4cGxpY2l0IG1hcmtlciBpcyB0aGUgb25seSBvbmUgdGhhdCBtYWtlcyB0aGUgZW50cnkgaWRlbnRpZmlhYmxlXG4gKiBpbiAqZXZlcnkqIHBvc2l0aW9uIHJhdGhlciB0aGFuIG9ubHkgaW4gdGhlIHBvc2l0aW9uIHRoZSBzb3J0IGhhcHBlbnMgdG9cbiAqIHB1dCBpdCBpbjsgc29ydGluZyBpdCBmaXJzdCAoc2VlIHtAbGluayByYW5nZVJhbmt9KSBpcyBrZXB0IGFzIHdlbGwgYmVjYXVzZVxuICogXCJ3aG9sZSBmaWxlLCB0aGVuIGl0cyByYW5nZXMgaW4gbGluZSBvcmRlclwiIGlzIHRoZSBvcmRlciBhIHJlYWRlciBleHBlY3RzLFxuICogbm90IGJlY2F1c2UgaWRlbnRpZmlhYmlsaXR5IGRlcGVuZHMgb24gaXQuXG4gKi9cbmZ1bmN0aW9uIGxhYmVsRm9yKHJhbmdlOiBSYW5nZUxhYmVsLCBzb2xlOiBib29sZWFuKTogc3RyaW5nIHwgbnVsbCB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiBgI0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiBzb2xlID8gbnVsbCA6ICcod2hvbGUgZmlsZSknO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gJyh0cnVuY2F0ZWQgaW4gc291cmNlIFx1MjAxNCBhbmNob3IgaW5jb21wbGV0ZSknO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29sdW1uIG1hdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBncmFwaGVtZSBzZWdtZW50ZXIsIGNvbnN0cnVjdGVkIG9uIGZpcnN0IHVzZSBhbmQgdGhlbiBjYWNoZWQgXHUyMDE0IGluY2x1ZGluZ1xuICogYSBjYWNoZWQgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIGNvbnN0cnVjdGVkIGF0IGFsbC5cbiAqXG4gKiBMYXp5IG9uIHB1cnBvc2UuIGBJbnRsYCBpcyBub3QgcGFydCBvZiB0aGUgSmF2YVNjcmlwdCBsYW5ndWFnZSBjb3JlOiBhIE5vZGVcbiAqIGJ1aWx0IGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCB3aGF0c29ldmVyLCBhbmQgYGhvb2tzLmpzb25gXG4gKiBpbnZva2VzIGEgYmFyZSBgbm9kZWAgb2ZmIHRoZSB1c2VyJ3MgYFBBVEhgLCBzbyBgZW5naW5lcy5ub2RlYCBjb25zdHJhaW5zXG4gKiBub3RoaW5nIGhlcmUuIENvbnN0cnVjdGluZyB0aGlzIGF0IG1vZHVsZSBzY29wZSBwdXQgYSBgUmVmZXJlbmNlRXJyb3JgIGluXG4gKiB0aGUgYnVuZGxlcycgdG9wLWxldmVsIHN0YXRlbWVudHMsIHdoZXJlIGl0IHRocm93cyBhdCAqaW1wb3J0KiBcdTIwMTQgYmVmb3JlIGFueVxuICogb2YgdGhlIGZhaWwtY2xvc2VkIGB0cnkvY2F0Y2hgIGJsb2NrcyBpbiBgcmVuZGVyQW5jaG9yUnVuYCwgYHJlbmRlclBhdGhSdW5gXG4gKiBhbmQgYGFuY2hvckJ1bGxldHNgIGV4aXN0IHRvIGNhdGNoIGl0LiBUaGUgaG9vayBwcm9jZXNzIHRoZW4gZGllZCB3aXRoIGV4aXRcbiAqIDEsIHdoaWNoIENsYXVkZSBDb2RlIHRyZWF0cyBhcyBhIG5vbi1ibG9ja2luZyBob29rIGVycm9yOiB0aGUgY29tbWl0IGdhdGVcbiAqIHNpbGVudGx5IGFsbG93ZWQgdGhlIGNvbW1pdCBhbmQgdGhlIGRyaWZ0IHJlbWluZGVyIHNpbGVudGx5IHZhbmlzaGVkLlxuICogQnVpbGRpbmcgaXQgaW5zaWRlIHRoZSByZW5kZXIgcGF0aCBwdXRzIGFueSBmYWlsdXJlIGJhY2sgaW5zaWRlIHRob3NlXG4gKiBjYXRjaGVzLlxuICpcbiAqIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IHRoZSBzYW1lIGNhdGVnb3J5IGFzXG4gKiB0aGUgbG9jYWwgYHRyeS9jYXRjaGAgYmxvY2tzIGF0IHRoaXMgbW9kdWxlJ3MgY2FsbCBzaXRlcywgYW5kIGxvYWQtYmVhcmluZ1xuICogZm9yIHRoZSBzYW1lIHJlYXNvbi4gTm90aGluZyBpbiB0aGUgY29sdW1uLWFsaWdubWVudCBwYXRoIG1heSBiZSBhYmxlIHRvXG4gKiBjb3N0IHRoZSBjb21taXQgZ2F0ZSBvciB0aGUgZHJpZnQgcmVtaW5kZXI6IGlmIGRpc3BsYXkgd2lkdGggY2Fubm90IGJlXG4gKiBtZWFzdXJlZCwgdGhlIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgZ2F0ZSBzdGlsbCBob2xkczsgb25seSBhbGlnbm1lbnQgaXNcbiAqIGxvc3QuXG4gKi9cbmxldCBjYWNoZWRTZWdtZW50ZXI6IHsgdmFsdWU6IEludGwuU2VnbWVudGVyIHwgbnVsbCB9IHwgdW5kZWZpbmVkO1xuXG5mdW5jdGlvbiBncmFwaGVtZVNlZ21lbnRlcigpOiBJbnRsLlNlZ21lbnRlciB8IG51bGwge1xuICBpZiAoY2FjaGVkU2VnbWVudGVyID09PSB1bmRlZmluZWQpIHtcbiAgICB0cnkge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbmV3IEludGwuU2VnbWVudGVyKCdlbicsIHsgZ3JhbnVsYXJpdHk6ICdncmFwaGVtZScgfSkgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG51bGwgfTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNhY2hlZFNlZ21lbnRlci52YWx1ZTtcbn1cblxuLyoqXG4gKiBDb2RlIHBvaW50IHJhbmdlcyByZW5kZXJlZCB0d28gY29sdW1ucyB3aWRlOiB0aGUgRWFzdCBBc2lhbiBXaWRlIChXKSBhbmRcbiAqIEZ1bGx3aWR0aCAoRikgYmxvY2tzIG9mIFVBWCAjMTEsIHBsdXMgdGhlIGVtb2ppIGJsb2NrcyB0aGF0IHRlcm1pbmFscyBhbmRcbiAqIHByb3BvcnRpb25hbCBhZ2VudC1mYWNpbmcgcmVuZGVyZXJzIGJvdGggZ2l2ZSBkb3VibGUgd2lkdGguIEV2ZXJ5dGhpbmcgZWxzZVxuICogY291bnRzIGFzIG9uZSBjb2x1bW4uXG4gKlxuICogU29ydGVkIGFzY2VuZGluZyBhbmQgbm9uLW92ZXJsYXBwaW5nIFx1MjAxNCB7QGxpbmsgaXNXaWRlQ29kZVBvaW50fSBzaG9ydC1jaXJjdWl0c1xuICogb24gdGhlIGZpcnN0IHJhbmdlIHN0YXJ0aW5nIHBhc3QgdGhlIGNvZGUgcG9pbnQuXG4gKi9cbmNvbnN0IFdJREVfUkFOR0VTOiByZWFkb25seSAocmVhZG9ubHkgW251bWJlciwgbnVtYmVyXSlbXSA9IFtcbiAgWzB4MTEwMCwgMHgxMTVmXSxcbiAgWzB4MjMyOSwgMHgyMzJhXSxcbiAgWzB4MjYwMCwgMHgyN2JmXSxcbiAgWzB4MmU4MCwgMHgzMDNlXSxcbiAgWzB4MzA0MSwgMHgzM2ZmXSxcbiAgWzB4MzQwMCwgMHg0ZGJmXSxcbiAgWzB4NGUwMCwgMHg5ZmZmXSxcbiAgWzB4YTAwMCwgMHhhNGNmXSxcbiAgWzB4YTk2MCwgMHhhOTdmXSxcbiAgWzB4YWMwMCwgMHhkN2EzXSxcbiAgWzB4ZjkwMCwgMHhmYWZmXSxcbiAgWzB4ZmUxMCwgMHhmZTE5XSxcbiAgWzB4ZmUzMCwgMHhmZTZmXSxcbiAgWzB4ZmYwMCwgMHhmZjYwXSxcbiAgWzB4ZmZlMCwgMHhmZmU2XSxcbiAgWzB4MTcwMDAsIDB4MThhZmZdLFxuICBbMHgxZjFlNiwgMHgxZjFmZl0sXG4gIFsweDFmMzAwLCAweDFmNjRmXSxcbiAgWzB4MWY2ODAsIDB4MWY2ZmZdLFxuICBbMHgxZjkwMCwgMHgxZjlmZl0sXG4gIFsweDFmYTcwLCAweDFmYWZmXSxcbiAgWzB4MjAwMDAsIDB4MmZmZmRdLFxuICBbMHgzMDAwMCwgMHgzZmZmZF1cbl07XG5cbmZ1bmN0aW9uIGlzV2lkZUNvZGVQb2ludChjcDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgW2xvLCBoaV0gb2YgV0lERV9SQU5HRVMpIHtcbiAgICBpZiAoY3AgPCBsbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChjcCA8PSBoaSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIERpc3BsYXkgd2lkdGggb2YgYSBuYW1lIGluIHRlcm1pbmFsIGNvbHVtbnMgXHUyMDE0IHRoZSB1bml0IHRoZSByYW5nZSBjb2x1bW4gaXNcbiAqIGFjdHVhbGx5IGFsaWduZWQgaW4uIE1lYXN1cmVkIG92ZXIgZ3JhcGhlbWUgY2x1c3RlcnMgKHNvIGEgZGVjb21wb3NlZCBgXHUwMEU5YFxuICogb3IgYSBjb21iaW5pbmctbWFyayBzZXF1ZW5jZSBjb3VudHMgb25jZSwgbm90IG9uY2UgcGVyIGNvZGUgcG9pbnQpLCB3aXRoXG4gKiBlYWNoIGNsdXN0ZXIgY29udHJpYnV0aW5nIHR3byBjb2x1bW5zIHdoZW4gaXRzIGJhc2UgY29kZSBwb2ludCBpcyBFYXN0XG4gKiBBc2lhbiBXaWRlL0Z1bGx3aWR0aCBvciBlbW9qaSBhbmQgb25lIG90aGVyd2lzZS5cbiAqXG4gKiBOZWl0aGVyIFVURi0xNiBgLmxlbmd0aGAgbm9yIGBBcnJheS5mcm9tKG5hbWUpLmxlbmd0aGAgaXMgdGhpcyB1bml0OiB0aGVcbiAqIGZpcnN0IG92ZXItY291bnRzIGEgc3Vycm9nYXRlIHBhaXIsIHRoZSBzZWNvbmQgdW5kZXItY291bnRzIGEgQ0pLIGlkZW9ncmFwaFxuICogYW5kIG92ZXItY291bnRzIGEgZGVjb21wb3NlZCBhY2NlbnQuXG4gKlxuICogV2hlbiB7QGxpbmsgZ3JhcGhlbWVTZWdtZW50ZXJ9IGlzIHVuYXZhaWxhYmxlIChhIE5vZGUgYnVpbHRcbiAqIGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCBhdCBhbGwpLCB0aGlzIGRlZ3JhZGVzIHRvIHRoZSBjcnVkZXJcbiAqIHBlci1jb2RlLXBvaW50IG1lYXN1cmUgcmF0aGVyIHRoYW4gdGhyb3dpbmcuIFRoYXQgbWVhc3VyZSBvdmVyLWNvdW50cyBhXG4gKiBkZWNvbXBvc2VkIGFjY2VudCBhbmQgYSByZWdpb25hbC1pbmRpY2F0b3IgZmxhZyBwYWlyLCBzbyBhbGlnbm1lbnQgY2FuIGJlIGFcbiAqIGNvbHVtbiBvciB0d28gb2ZmIFx1MjAxNCB3aGljaCBpcyB0aGUgZW50aXJlIGNvc3QsIGFuZCBpcyB0aGUgY29ycmVjdCBwcmljZSB0b1xuICogcGF5OiB0aGUgYW5jaG9yIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgY29tbWl0IGdhdGUgc3RpbGwgaG9sZHMuXG4gKi9cbmZ1bmN0aW9uIGRpc3BsYXlXaWR0aChuYW1lOiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCBzZWdtZW50ZXIgPSBncmFwaGVtZVNlZ21lbnRlcigpO1xuICBsZXQgd2lkdGggPSAwO1xuICBpZiAoc2VnbWVudGVyID09PSBudWxsKSB7XG4gICAgZm9yIChjb25zdCBjb2RlUG9pbnQgb2YgbmFtZSkge1xuICAgICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KGNvZGVQb2ludC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICAgIH1cbiAgICByZXR1cm4gd2lkdGg7XG4gIH1cbiAgZm9yIChjb25zdCB7IHNlZ21lbnQgfSBvZiBzZWdtZW50ZXIuc2VnbWVudChuYW1lKSkge1xuICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChzZWdtZW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gIH1cbiAgcmV0dXJuIHdpZHRoO1xufVxuXG4vKipcbiAqIEFsaWdubWVudCBjZWlsaW5nLiBBIHNpYmxpbmcgZ3JvdXAgd2hvc2Ugd2lkZXN0IHJhbmdlLWJlYXJpbmcgbmFtZSBleGNlZWRzXG4gKiB0aGlzIHdpZHRoIGRvZXMgbm90IGFsaWduIGF0IGFsbCBcdTIwMTQgZXZlcnkgbmFtZSBpbiBpdCB0YWtlcyBhIHNpbmdsZSBzcGFjZVxuICogYmVmb3JlIGl0cyByYW5nZS4gVGhlIGFsdGVybmF0aXZlIChwYWQgdGhlIHNob3J0IG5hbWVzIHRvIHRoZSBjZWlsaW5nIHdoaWxlXG4gKiB0aGUgbG9uZyBvbmUgc2l0cyBhdCBpdHMgb3duIG5hdHVyYWwgY29sdW1uKSBwYXlzIG1vc3Qgb2YgdGhlIHdpZHRoIGZvclxuICogYWxpZ25tZW50IHRoYXQgYWxpZ25zIHdpdGggbm90aGluZywgd2hpY2ggaXMgc3RyaWN0bHkgd29yc2UgdGhhbiBub3RcbiAqIGFsaWduaW5nLiBOYW1lcyB0aGVtc2VsdmVzIGFyZSBuZXZlciB0cnVuY2F0ZWQgb3IgZWxpZGVkIGF0IGFueSB3aWR0aC5cbiAqL1xuY29uc3QgTUFYX0FMSUdOX0NPTFVNTiA9IDQ4O1xuXG4vKipcbiAqIFRoZSBjb2x1bW4gZXZlcnkgcmFuZ2UtYmVhcmluZyBuYW1lIGluIHRoaXMgc2libGluZyBncm91cCBwYWRzIHRvLCBvciBgMGBcbiAqIHdoZW4gdGhlIGdyb3VwIGZvcmdvZXMgYWxpZ25tZW50IChubyByYW5nZS1iZWFyaW5nIG5hbWVzLCBvciBhIG5hbWUgcGFzdFxuICoge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59KS4gQWxpZ25tZW50IHNjb3BlIGlzIHRoZSBncm91cCdzIGRpcmVjdCBjaGlsZHJlblxuICogb25seSwgbmV2ZXIgdGhlIHdob2xlIHRyZWUgXHUyMDE0IHdob2xlLXRyZWUgYWxpZ25tZW50IHdvdWxkIGxldCBvbmUgZGVlcGx5XG4gKiBuZXN0ZWQgbG9uZyBuYW1lIHBhZCBldmVyeSB1bnJlbGF0ZWQgYnJhbmNoLlxuICovXG5mdW5jdGlvbiBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXM6IERpc3BsYXlJdGVtW10pOiBudW1iZXIge1xuICBsZXQgbWF4ID0gMDtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicgJiYgcHJpbnRzUmFuZ2VDb2x1bW4oaXRlbS5ub2RlLmFuY2hvcikpIHtcbiAgICAgIG1heCA9IE1hdGgubWF4KG1heCwgZGlzcGxheVdpZHRoKGl0ZW0ubmFtZSkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWF4ID4gTUFYX0FMSUdOX0NPTFVNTiA/IDAgOiBtYXg7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGlzIGFuY2hvciBwcmludHMgYSByYW5nZSBjb2x1bW4gYXQgYWxsIFx1MjAxNCB0aGUgZXhhY3QgY29uZGl0aW9uXG4gKiB7QGxpbmsgbGFiZWxGb3J9IGVuY29kZXMsIGhvaXN0ZWQgc28ge0BsaW5rIGNvbXB1dGVHcm91cFRhcmdldH0gbWVhc3VyZXMgdGhlXG4gKiBzYW1lIHNldCBvZiBuYW1lcyBpdCBwYWRzLiBBbiBhbmNob3Igd2l0aCBubyByYW5nZXMsIG9yIGEgKnNvbGUqIHdob2xlLWZpbGVcbiAqIGVudHJ5ICh3aGljaCByZW5kZXJzIGFzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIpLCBjb250cmlidXRlcyBubyByYW5nZVxuICogY29sdW1uIGFuZCBzbyBtdXN0IG5vdCBjb250cmlidXRlIHRvIHRoZSBncm91cCBtYXggZWl0aGVyOiBvdGhlcndpc2UgYVxuICogd2hvbGUtZmlsZSBhbmNob3Igb24gYSBwYXRoIHBhc3Qge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59IHNpbGVudGx5IHN1cHByZXNzZXNcbiAqIGFsaWdubWVudCBmb3IgaXRzIHJhbmdlLWJlYXJpbmcgc2libGluZ3Mgd2hpbGUgaXRzZWxmIHByaW50aW5nIG5vdGhpbmcgdG9cbiAqIGFsaWduLlxuICovXG5mdW5jdGlvbiBwcmludHNSYW5nZUNvbHVtbihhbmNob3I6IFRyZWVBbmNob3IpOiBib29sZWFuIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHJhbmdlcy5zb21lKChlbnRyeSkgPT4gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHJhbmdlcy5sZW5ndGggPT09IDEpICE9PSBudWxsKTtcbn1cblxuLyoqIFRoZSBzcGFjaW5nIGJldHdlZW4gYSBuYW1lIG9mIGBuYW1lV2lkdGhgIGNvbHVtbnMgYW5kIGl0cyByYW5nZSBjb2x1bW4uICovXG5mdW5jdGlvbiBjb21wdXRlUGFkKG5hbWVXaWR0aDogbnVtYmVyLCB0YXJnZXQ6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmIChuYW1lV2lkdGggPj0gdGFyZ2V0KSByZXR1cm4gJyAnO1xuICByZXR1cm4gJyAnLnJlcGVhdCh0YXJnZXQgLSBuYW1lV2lkdGggKyAxKTtcbn1cblxuLyoqXG4gKiBSZW5kZXIgb25lIGxlYWYncyBsaW5lKHMpLiBBbiBlbXB0eSBgcmFuZ2VzYCBhcnJheSBpcyBhIGJhcmUtcGF0aCBsZWFmIHdpdGhcbiAqIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwgKGRpc3RpbmN0IGZyb20gYSBgd2hvbGUtZmlsZWAgZW50cnksIHdoaWNoIGlzIGFuXG4gKiBleHBsaWNpdCBjbGFzc2lmaWNhdGlvbiB0aGF0IGFsc28gcHJpbnRzIHdpdGggemVybyBtYXJrZXIgd2hlbiBpdCBzdGFuZHNcbiAqIGFsb25lLCBidXQgdGhyb3VnaCB0aGUgcmFuZ2VzIHBpcGVsaW5lKS4gTXVsdGlwbGUgc3RhY2tlZCByYW5nZXMgcHJpbnRcbiAqIHVuZGVyIGEgY29udGludWF0aW9uIHByZWZpeCBpbnN0ZWFkIG9mIHJlcGVhdGluZyB0aGUgbmFtZTsgZWFjaCBjYXJyaWVzIGl0c1xuICogb3duIHN1ZmZpeCBpbmRlcGVuZGVudGx5LCBhbmQgZWFjaCBjYXJyaWVzIGEgbGFiZWwgaWRlbnRpZnlpbmcgd2hpY2ggYW5jaG9yXG4gKiB0aGUgc3VmZml4IGJlbG9uZ3MgdG8uXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckxlYWZMaW5lcyhcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3I6IFRyZWVBbmNob3IsXG4gIG93blByZWZpeDogc3RyaW5nLFxuICBjaGlsZFByZWZpeDogc3RyaW5nLFxuICBncm91cFRhcmdldDogbnVtYmVyXG4pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW2Ake293blByZWZpeH0ke25hbWV9YF07XG5cbiAgY29uc3Qgc29ydGVkID0gWy4uLnJhbmdlc10uc29ydChjb21wYXJlUmFuZ2VFbnRyaWVzKTtcbiAgY29uc3Qgc29sZSA9IHNvcnRlZC5sZW5ndGggPT09IDE7XG4gIGNvbnN0IG5hbWVXaWR0aCA9IGRpc3BsYXlXaWR0aChuYW1lKTtcbiAgY29uc3QgcGFkID0gY29tcHV0ZVBhZChuYW1lV2lkdGgsIGdyb3VwVGFyZ2V0KTtcbiAgY29uc3QgYmxhbmsgPSAnICcucmVwZWF0KG5hbWVXaWR0aCArIHBhZC5sZW5ndGgpO1xuXG4gIHJldHVybiBzb3J0ZWQubWFwKChlbnRyeSwgaSkgPT4ge1xuICAgIGNvbnN0IGxhYmVsID0gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHNvbGUpO1xuICAgIGlmIChsYWJlbCA9PT0gbnVsbCkgcmV0dXJuIGAke293blByZWZpeH0ke25hbWV9JHtlbnRyeS5zdWZmaXh9YDtcbiAgICBjb25zdCBiYXNlID0gaSA9PT0gMCA/IGAke293blByZWZpeH0ke25hbWV9JHtwYWR9YCA6IGAke2NoaWxkUHJlZml4fSR7Ymxhbmt9YDtcbiAgICByZXR1cm4gYCR7YmFzZX0ke2xhYmVsfSR7ZW50cnkuc3VmZml4fWA7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJOb2Rlcyhub2RlczogUGF0aFRyZWVOb2RlW10sIHByZWZpeDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgaXRlbXMgPSBub2Rlcy5tYXAoZm9sZENoYWluKTtcbiAgY29uc3QgZ3JvdXBUYXJnZXQgPSBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXMpO1xuICBpdGVtcy5mb3JFYWNoKChpdGVtLCBpKSA9PiB7XG4gICAgY29uc3QgaXNMYXN0ID0gaSA9PT0gaXRlbXMubGVuZ3RoIC0gMTtcbiAgICBjb25zdCBvd25QcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnXHUyNTE0XHUyNTAwICcgOiAnXHUyNTFDXHUyNTAwICd9YDtcbiAgICBjb25zdCBjaGlsZFByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICcgICAnIDogJ1x1MjUwMiAgJ31gO1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnKSB7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlckxlYWZMaW5lcyhpdGVtLm5hbWUsIGl0ZW0ubm9kZS5hbmNob3IsIG93blByZWZpeCwgY2hpbGRQcmVmaXgsIGdyb3VwVGFyZ2V0KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpbmVzLnB1c2goYCR7b3duUHJlZml4fSR7aXRlbS5uYW1lfS9gKTtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTm9kZXMoaXRlbS5ub2RlLmNoaWxkcmVuLCBjaGlsZFByZWZpeCkpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsaW5lcztcbn1cblxuLyoqXG4gKiBSZW5kZXIgYSBjb2xsYXBzZWQgYW5jaG9yIGxpc3QgYXMgYSBib3gtZHJhd2luZyB0cmVlLCBncm91cGVkIGJ5IHNoYXJlZFxuICogcGF0aCBwcmVmaXguIEV2ZXJ5IGFuY2hvciBsaXN0IHJlbmRlcnMgYXMgYSB0cmVlIHVuY29uZGl0aW9uYWxseSBcdTIwMTQgYSBzaW5nbGVcbiAqIGFuY2hvciBiZWNvbWVzIGEgb25lLWxpbmUgdHJlZSB3aGF0ZXZlciBpdHMgZGVwdGggKHNlZSB7QGxpbmsgZm9sZENoYWlufSk7XG4gKiB0aGVyZSBpcyBubyBmbGF0LWJ1bGxldCBwYXRoIG9yIHNpemUgZmxvb3IgaW4gdGhpcyBtb2R1bGUuXG4gKlxuICogSGVpZ2h0IGlzIGJvdW5kZWQgYnkge0BsaW5rIGZvbGRDaGFpbn06IGEgZGlyZWN0b3J5IGxpbmUgb25seSBldmVyIGFwcGVhcnNcbiAqIHdoZXJlIGl0IGdlbnVpbmVseSBncm91cHMgdHdvIG9yIG1vcmUgc2libGluZ3MsIHNvIHRoZSB0cmVlIGFkZHMgYXQgbW9zdFxuICogb25lIGxpbmUgcGVyIHJlYWwgZ3JvdXBpbmcgYW5kIG5ldmVyIG9uZSBwZXIgcGF0aCBzZWdtZW50LlxuICpcbiAqIFRvdGFsIGZvciBhbnkgd2VsbC1mb3JtZWQgYFRyZWVBbmNob3JbXWA6IGRlZ2VuZXJhdGUgcGF0aHMgKHJ1bGUgZW5mb3JjZWRcbiAqIGluIHtAbGluayBzcGxpdFNlZ21lbnRzfSkgYXJlIG5vcm1hbGl6ZWQgdG8gYXRvbWljIGxlYXZlcyByYXRoZXIgdGhhblxuICogdGhyb3duIG9uLCBzbyB0aGlzIGZ1bmN0aW9uIG5ldmVyIG5lZWRzIGFuIGludGVybmFsIHRyeS9jYXRjaC4gQ2FsbGVycyBhZGRcbiAqIHRoZWlyIG93biBjYXRjaCBhcm91bmQgdGhpcyBjYWxsIGluIGEgbGF0ZXIgcGhhc2UgKGZhaWwtb3BlbiBkaXNjaXBsaW5lXG4gKiBsaXZlcyBhdCB0aGUgY2FsbCBzaXRlLCBub3QgaGVyZSkuXG4gKlxuICogYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXMgYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlclxuICogZGlzdGluY3QgYHBhdGhgIFx1MjAxNCBwYXNzIGFuY2hvcnMgdGhyb3VnaCB7QGxpbmsgY29sbGFwc2VCeVBhdGh9IGZpcnN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQW5jaG9yVHJlZShhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGZvcmVzdCA9IGJ1aWxkRm9yZXN0KGFuY2hvcnMpO1xuICByZXR1cm4gcmVuZGVyTm9kZXMoZm9yZXN0LCAnJyk7XG59XG4iLCAiLyoqXG4gKiBDb2RleCBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlIHBhcnNlci5cbiAqXG4gKiBUdXJucyBhIENvZGV4IGBhcHBseV9wYXRjaGAgYHRvb2xfaW5wdXQuY29tbWFuZGAgcGF0Y2ggc3RyaW5nIGludG8gdGhlXG4gKiBgQW5jaG9yU3BlY1tdYCBzaGFwZSB0aGUgc2hhcmVkIHRvdWNoIGNvcmUgYWxyZWFkeSBjb25zdW1lcyBcdTIwMTQgdGhlIG9uZVxuICogZ2VudWluZWx5IG5ldyBhbGdvcml0aG0gdGhlIENvZGV4IGFkYXB0ZXIgbmVlZHMuIEl0IHJlcGxhY2VzIHRoZSBzdHJ1Y3R1cmVkXG4gKiBgZmlsZV9wYXRoYC9gb2xkX3N0cmluZ2AvYG9mZnNldGAgcmVhZGluZyB0aGUgQ2xhdWRlIFBvc3RUb29sVXNlIHRvdWNoIGhvb2tcbiAqIGRvZXMsIGJlY2F1c2UgQ29kZXggZGVsaXZlcnMgZXZlcnkgZWRpdCBhcyBhIHNpbmdsZSBhcHBseV9wYXRjaCBlbnZlbG9wZVxuICogcmF0aGVyIHRoYW4gYSB0eXBlZCB0b29sIGlucHV0LlxuICpcbiAqIFRoZSBtb2R1bGUgaXMgcHVyZTogaXQgaW1wb3J0cyBvbmx5IHRoZSBrZXJuZWwgYW5jaG9yIHR5cGVzIGFuZCBuZXZlciB0b3VjaGVzXG4gKiB0aGUgQ29kZXggU0RLLCBzbyBpdCBpcyBESS10ZXN0YWJsZSBleGFjdGx5IGxpa2UgdGhlIHBvcmNlbGFpbiBwYXJzZXJzIGluIHRoZVxuICogc2hhcmVkIGtlcm5lbC4gUmFuZ2UgcmVjb3ZlcnkgaXMgYmVzdC1lZmZvcnQgXHUyMDE0IHRoZSBhcHBseV9wYXRjaCBmb3JtYXQgY2Fycmllc1xuICogYEBAYCBjb250ZXh0IGFuZCBgK2AvYC1gL3NwYWNlIGNoYW5nZSBsaW5lcyBidXQgbm8gZXhwbGljaXQgbGluZSBudW1iZXJzLCBzbyBhXG4gKiByYW5nZSBjYW4gb25seSBiZSByZWNvdmVyZWQgYnkgbG9jYXRpbmcgYSBodW5rJ3MgcHJlLWVkaXQgYmxvY2sgaW4gdGhlXG4gKiBvbi1kaXNrIGZpbGUuIFRoYXQgZmlsZSByZWFkIGlzIGluamVjdGVkIChgcmVhZFByZUVkaXRGaWxlYCkgc28gdGhlIGZ1bmN0aW9uXG4gKiBzdGF5cyBwdXJlIGFuZCB0ZXN0YWJsZS4gT24gQU5ZIGFtYmlndWl0eSAobm8gcmVhZGVyLCBmaWxlIG1pc3NpbmcsIGNvbnRleHRcbiAqIG5vdCBmb3VuZCwgZnV6enkvZHVwbGljYXRlIG1hdGNoKSB0aGUgcGFyc2VyIGRlZ3JhZGVzIHRvIGEgd2hvbGUtZmlsZSBhbmNob3JcbiAqIHJhdGhlciB0aGFuIHRocm93aW5nIFx1MjAxNCB3aG9sZS1maWxlIGFuY2hvcnMgYXJlIGZpcnN0LWNsYXNzIGFuZCB0b3VjaCB0cmFja2luZ1xuICogbXVzdCBuZXZlciBiZSBibG9ja2VkLlxuICpcbiAqIFRoZSBncmFtbWFyIGlzIGNyb3NzLWNoZWNrZWQgYWdhaW5zdCBDb2RleCdzIG93biBhcHBseV9wYXRjaCBjcmF0ZVxuICogKGNvZGV4LXJzL2FwcGx5LXBhdGNoL3NyYy97cGFyc2VyLHN0cmVhbWluZ19wYXJzZXJ9LnJzKS4gVHdvIHN1YnRsZXRpZXMgYXJlXG4gKiBtaXJyb3JlZCBkZWxpYmVyYXRlbHk6IGh1bmstaGVhZGVyIG1hcmtlcnMgYXJlIG9ubHkgcmVjb2duaXplZCBhdCB0aGUgc3RhcnQgb2ZcbiAqIGEgbGluZSB3aXRoIG5vIGxlYWRpbmcgd2hpdGVzcGFjZSB3aGlsZSBpbnNpZGUgYW4gVXBkYXRlIGh1bmsgKGEgbGVhZGluZyBzcGFjZVxuICogZGVtb3RlcyBhIG1hcmtlciB0byBhIGNvbnRleHQgbGluZSksIGFuZCBhIGJhcmUgZW1wdHkgbGluZSBpbnNpZGUgYW4gVXBkYXRlXG4gKiBodW5rIGlzIHRyZWF0ZWQgYXMgYW4gZW1wdHkgY29udGV4dCBsaW5lIHByZXNlbnQgaW4gYm90aCBvbGQgYW5kIG5ldyBjb250ZW50LlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHR5cGUgeyBBbmNob3JTcGVjLCBMaW5lUmFuZ2UgfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcblxuLyoqXG4gKiBSZWFkcyB0aGUgcHJlLWVkaXQgKG9uLWRpc2ssIGJlZm9yZSB0aGUgcGF0Y2ggYXBwbGllcykgY29udGVudCBvZiB0aGUgZmlsZSBhdFxuICogYHBhdGhgLCBvciByZXR1cm5zIGBudWxsYCB3aGVuIGl0IGNhbm5vdCBiZSByZWFkLiBJbmplY3RlZCBzbyB0aGUgcGFyc2VyIHN0YXlzXG4gKiBwdXJlOyBjYWxsIHNpdGVzIGRlZmF1bHQgdG8gYSByZWFsIGZpbGVzeXN0ZW0gcmVhZC5cbiAqL1xuZXhwb3J0IHR5cGUgUmVhZFByZUVkaXRGaWxlID0gKHBhdGg6IHN0cmluZykgPT4gc3RyaW5nIHwgbnVsbDtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBHcmFtbWFyIG1hcmtlcnMgKG1pcnJvcnMgY29kZXgtcnMvYXBwbHktcGF0Y2gvc3JjL3BhcnNlci5ycylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBFTkRfUEFUQ0hfTUFSS0VSID0gJyoqKiBFbmQgUGF0Y2gnO1xuY29uc3QgQUREX0ZJTEVfTUFSS0VSID0gJyoqKiBBZGQgRmlsZTogJztcbmNvbnN0IERFTEVURV9GSUxFX01BUktFUiA9ICcqKiogRGVsZXRlIEZpbGU6ICc7XG5jb25zdCBVUERBVEVfRklMRV9NQVJLRVIgPSAnKioqIFVwZGF0ZSBGaWxlOiAnO1xuY29uc3QgTU9WRV9UT19NQVJLRVIgPSAnKioqIE1vdmUgdG86ICc7XG5jb25zdCBFT0ZfTUFSS0VSID0gJyoqKiBFbmQgb2YgRmlsZSc7XG5jb25zdCBDSEFOR0VfQ09OVEVYVF9NQVJLRVIgPSAnQEAgJztcbmNvbnN0IEVNUFRZX0NIQU5HRV9DT05URVhUX01BUktFUiA9ICdAQCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSW50ZXJtZWRpYXRlIGh1bmsgbW9kZWxcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgVXBkYXRlQ2h1bmsge1xuICAvKiogT3B0aW9uYWwgYEBAIDxjb250ZXh0PmAgbGluZSB1c2VkIHRvIGRpc2FtYmlndWF0ZSB0aGUgYmxvY2sncyBsb2NhdGlvbi4gKi9cbiAgY2hhbmdlQ29udGV4dDogc3RyaW5nIHwgbnVsbDtcbiAgLyoqIFByZS1lZGl0IGxpbmVzIHRoaXMgY2h1bmsgY292ZXJzIChjb250ZXh0IGAgYCArIHJlbW92ZWQgYC1gKSwgaW4gb3JkZXIuICovXG4gIG9sZExpbmVzOiBzdHJpbmdbXTtcbiAgLyoqIFBvc3QtZWRpdCBsaW5lcyAoY29udGV4dCBgIGAgKyBhZGRlZCBgK2ApOyByZXRhaW5lZCBmb3IgY29tcGxldGVuZXNzLiAqL1xuICBuZXdMaW5lczogc3RyaW5nW107XG59XG5cbnR5cGUgSHVuayA9XG4gIHwgeyBraW5kOiAnYWRkJzsgcGF0aDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6ICdkZWxldGUnOyBwYXRoOiBzdHJpbmcgfVxuICB8IHsga2luZDogJ3VwZGF0ZSc7IHBhdGg6IHN0cmluZzsgbW92ZVBhdGg6IHN0cmluZyB8IG51bGw7IGNodW5rczogVXBkYXRlQ2h1bmtbXSB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgcmVhZGVyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZWFsLWZpbGVzeXN0ZW0gcmVhZGVyIHVzZWQgd2hlbiBubyByZWFkZXIgaXMgaW5qZWN0ZWQuIEJlc3QtZWZmb3J0OiBhbnlcbiAqIGZhaWx1cmUgKG1pc3NpbmcgZmlsZSwgcGVybWlzc2lvbiBlcnJvcikgeWllbGRzIGBudWxsYCwgd2hpY2ggdGhlIHBhcnNlclxuICogZGVncmFkZXMgdG8gYSB3aG9sZS1maWxlIGFuY2hvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRSZWFkUHJlRWRpdEZpbGUocGF0aDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGZzLnJlYWRGaWxlU3luYyhwYXRoLCAndXRmOCcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFbnZlbG9wZSBzY2FubmluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogU2NhbiB0aGUgcGF0Y2ggdGV4dCBpbnRvIGh1bmtzLiBMZW5pZW50IGJ5IGRlc2lnbjogdW5yZWNvZ25pemVkIGxpbmVzIGFyZVxuICogaWdub3JlZCByYXRoZXIgdGhhbiByZWplY3RlZCwgYW5kIEJlZ2luL0VuZC9FbnZpcm9ubWVudCBsaW5lcyBhcmUgc2tpcHBlZCwgc29cbiAqIGEgbWFsZm9ybWVkIGVudmVsb3BlIGRlZ3JhZGVzIHRvIHdoYXRldmVyIGh1bmtzIGNvdWxkIGJlIHJlY292ZXJlZCAob2Z0ZW5cbiAqIG5vbmUgXHUyMTkyIGBbXWApIGluc3RlYWQgb2YgdGhyb3dpbmcuXG4gKi9cbmZ1bmN0aW9uIHNjYW5IdW5rcyhjb21tYW5kOiBzdHJpbmcpOiBIdW5rW10ge1xuICBjb25zdCBodW5rczogSHVua1tdID0gW107XG4gIC8vIFRoZSBjdXJyZW50bHktb3BlbiBVcGRhdGUgaHVuaywgb3IgbnVsbC4gQWRkL0RlbGV0ZSBodW5rcyBoYXZlIG5vIGJvZHksIHNvXG4gIC8vIHRoZXkgY2xvc2UgaW1tZWRpYXRlbHkgYW5kIHJlc2V0IHRoaXMgdG8gbnVsbC5cbiAgbGV0IG9wZW5VcGRhdGU6IChIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9KSB8IG51bGwgPSBudWxsO1xuXG4gIGZvciAoY29uc3QgcmF3IG9mIGNvbW1hbmQuc3BsaXQoJ1xcbicpKSB7XG4gICAgLy8gSGVhZGVyIGRldGVjdGlvbiBpcyB3aGl0ZXNwYWNlLXNlbnNpdGl2ZSBpbnNpZGUgYW4gVXBkYXRlIGh1bms6IENvZGV4IHVzZXNcbiAgICAvLyB0cmltX2VuZCB0aGVyZSAobGVhZGluZyBzcGFjZSBkZW1vdGVzIGEgbWFya2VyIHRvIGEgY29udGV4dCBsaW5lKSBhbmQgZnVsbFxuICAgIC8vIHRyaW0gZWxzZXdoZXJlLiBNYXRjaCB0aGF0IHNvIGluZGVudGVkIG1hcmtlcnMgaW5zaWRlIGEgaHVuayBzdGF5IGNvbnRlbnQuXG4gICAgY29uc3QgaGVhZGVyTGluZTogc3RyaW5nID0gb3BlblVwZGF0ZSA/IHJhdy5yZXBsYWNlKC9bIFxcdFxccl0rJC8sICcnKSA6IHJhdy50cmltKCk7XG5cbiAgICBpZiAoaGVhZGVyTGluZSA9PT0gRU5EX1BBVENIX01BUktFUikge1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChBRERfRklMRV9NQVJLRVIpKSB7XG4gICAgICBodW5rcy5wdXNoKHsga2luZDogJ2FkZCcsIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoQUREX0ZJTEVfTUFSS0VSLmxlbmd0aCkgfSk7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKERFTEVURV9GSUxFX01BUktFUikpIHtcbiAgICAgIGh1bmtzLnB1c2goeyBraW5kOiAnZGVsZXRlJywgcGF0aDogaGVhZGVyTGluZS5zbGljZShERUxFVEVfRklMRV9NQVJLRVIubGVuZ3RoKSB9KTtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoVVBEQVRFX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgY29uc3QgaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSA9IHtcbiAgICAgICAga2luZDogJ3VwZGF0ZScsXG4gICAgICAgIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoVVBEQVRFX0ZJTEVfTUFSS0VSLmxlbmd0aCksXG4gICAgICAgIG1vdmVQYXRoOiBudWxsLFxuICAgICAgICBjaHVua3M6IFtdXG4gICAgICB9O1xuICAgICAgaHVua3MucHVzaChodW5rKTtcbiAgICAgIG9wZW5VcGRhdGUgPSBodW5rO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKG9wZW5VcGRhdGUpIHtcbiAgICAgIHByb2Nlc3NVcGRhdGVMaW5lKG9wZW5VcGRhdGUsIHJhdyk7XG4gICAgfVxuICAgIC8vIEFueSBvdGhlciBsaW5lIG91dHNpZGUgYW4gVXBkYXRlIGh1bmsgKEJlZ2luIFBhdGNoLCBFbnZpcm9ubWVudCBJRCwgQWRkXG4gICAgLy8gRmlsZSBgK2AgY29udGVudCwgc3RyYXkgdGV4dCkgaXMgaWdub3JlZC5cbiAgfVxuXG4gIHJldHVybiBodW5rcztcbn1cblxuZnVuY3Rpb24gZW5zdXJlQ2h1bmsoaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSk6IFVwZGF0ZUNodW5rIHtcbiAgY29uc3QgbGFzdCA9IGh1bmsuY2h1bmtzW2h1bmsuY2h1bmtzLmxlbmd0aCAtIDFdO1xuICBpZiAobGFzdCkgcmV0dXJuIGxhc3Q7XG4gIGNvbnN0IGNodW5rOiBVcGRhdGVDaHVuayA9IHsgY2hhbmdlQ29udGV4dDogbnVsbCwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfTtcbiAgaHVuay5jaHVua3MucHVzaChjaHVuayk7XG4gIHJldHVybiBjaHVuaztcbn1cblxuLyoqIEFwcGx5IG9uZSBib2R5IGxpbmUgb2YgYW4gVXBkYXRlIGh1bmsgdG8gaXRzIGNodW5rIGxpc3QuICovXG5mdW5jdGlvbiBwcm9jZXNzVXBkYXRlTGluZShodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9LCByYXc6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCB0cmltbWVkRW5kID0gcmF3LnJlcGxhY2UoL1sgXFx0XFxyXSskLywgJycpO1xuXG4gIGlmICh0cmltbWVkRW5kID09PSBFT0ZfTUFSS0VSKSByZXR1cm47IC8vIGVuZC1vZi1maWxlIGhpbnQ7IG5vdCBuZWVkZWQgZm9yIHJhbmdlc1xuXG4gIC8vIGAqKiogTW92ZSB0bzpgIGlzIG9ubHkgbWVhbmluZ2Z1bCBiZWZvcmUgYW55IGNoYW5nZSBjb250ZW50LlxuICBpZiAoaHVuay5jaHVua3MubGVuZ3RoID09PSAwICYmIGh1bmsubW92ZVBhdGggPT09IG51bGwgJiYgdHJpbW1lZEVuZC5zdGFydHNXaXRoKE1PVkVfVE9fTUFSS0VSKSkge1xuICAgIGh1bmsubW92ZVBhdGggPSB0cmltbWVkRW5kLnNsaWNlKE1PVkVfVE9fTUFSS0VSLmxlbmd0aCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKHRyaW1tZWRFbmQgPT09IEVNUFRZX0NIQU5HRV9DT05URVhUX01BUktFUikge1xuICAgIGh1bmsuY2h1bmtzLnB1c2goeyBjaGFuZ2VDb250ZXh0OiBudWxsLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9KTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHRyaW1tZWRFbmQuc3RhcnRzV2l0aChDSEFOR0VfQ09OVEVYVF9NQVJLRVIpKSB7XG4gICAgaHVuay5jaHVua3MucHVzaCh7IGNoYW5nZUNvbnRleHQ6IHRyaW1tZWRFbmQuc2xpY2UoQ0hBTkdFX0NPTlRFWFRfTUFSS0VSLmxlbmd0aCksIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH0pO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEEgYmFyZSBlbXB0eSBsaW5lIGlzIGFuIGVtcHR5IGNvbnRleHQgbGluZSAocHJlc2VudCBpbiBib3RoIG9sZCBhbmQgbmV3KS5cbiAgaWYgKHJhdyA9PT0gJycpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2goJycpO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2goJycpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBmaXJzdCA9IHJhd1swXTtcbiAgaWYgKGZpcnN0ID09PSAnICcpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNvbnN0IGNvbnRlbnQgPSByYXcuc2xpY2UoMSk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaChjb250ZW50KTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKGNvbnRlbnQpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoZmlyc3QgPT09ICcrJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaChyYXcuc2xpY2UoMSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoZmlyc3QgPT09ICctJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaChyYXcuc2xpY2UoMSkpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBVbnJlY29nbml6ZWQgY29udGVudCBsaW5lIFx1MjAxNCBpZ25vcmUgbGVuaWVudGx5IHJhdGhlciB0aGFuIHRocm93LlxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJhbmdlIHJlY292ZXJ5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFNwbGl0IGZpbGUgY29udGVudCBpbnRvIGxpbmVzIGZvciBtYXRjaGluZy4gQSB0cmFpbGluZyBuZXdsaW5lIHlpZWxkcyBhXG4gKiB0cmFpbGluZyBlbXB0eSBlbGVtZW50LCB3aGljaCBpcyBoYXJtbGVzcyBmb3Igc3ViLXNsaWNlIG1hdGNoaW5nLiAqL1xuZnVuY3Rpb24gc3BsaXRMaW5lcyhjb250ZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBjb250ZW50LnNwbGl0KCdcXG4nKTtcbn1cblxuLyoqIEluZGljZXMgKDAtYmFzZWQpIGF0IHdoaWNoIGB2YWx1ZWAgYXBwZWFycyBhcyBhIGZ1bGwgbGluZSBpbiBgbGluZXNgLiAqL1xuZnVuY3Rpb24gbGluZUluZGljZXMobGluZXM6IHN0cmluZ1tdLCB2YWx1ZTogc3RyaW5nKTogbnVtYmVyW10ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAobGluZXNbaV0gPT09IHZhbHVlKSBvdXQucHVzaChpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKiogU3RhcnQgaW5kaWNlcyAoMC1iYXNlZCkgYXQgd2hpY2ggYG5lZWRsZWAgbWF0Y2hlcyBjb250aWd1b3VzbHkgaW4gYGhheXN0YWNrYC4gKi9cbmZ1bmN0aW9uIGNvbnRpZ3VvdXNNYXRjaGVzKGhheXN0YWNrOiBzdHJpbmdbXSwgbmVlZGxlOiBzdHJpbmdbXSk6IG51bWJlcltdIHtcbiAgY29uc3Qgb3V0OiBudW1iZXJbXSA9IFtdO1xuICBpZiAobmVlZGxlLmxlbmd0aCA9PT0gMCB8fCBuZWVkbGUubGVuZ3RoID4gaGF5c3RhY2subGVuZ3RoKSByZXR1cm4gb3V0O1xuICBjb25zdCBsYXN0ID0gaGF5c3RhY2subGVuZ3RoIC0gbmVlZGxlLmxlbmd0aDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbGFzdDsgaSsrKSB7XG4gICAgbGV0IG9rID0gdHJ1ZTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IG5lZWRsZS5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGhheXN0YWNrW2kgKyBqXSAhPT0gbmVlZGxlW2pdKSB7XG4gICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob2spIG91dC5wdXNoKGkpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogTG9jYXRlIGEgc2luZ2xlIGNodW5rJ3MgcHJlLWVkaXQgYmxvY2sgaW4gdGhlIGZpbGUsIHJldHVybmluZyBpdHMgMS1iYXNlZFxuICogbGluZSByYW5nZSBvciBudWxsIHdoZW4gaXQgY2Fubm90IGJlIGxvY2F0ZWQgdW5hbWJpZ3VvdXNseS5cbiAqXG4gKiAtIE5vbi1lbXB0eSBibG9jazogcmVxdWlyZSBhIHVuaXF1ZSBjb250aWd1b3VzIG1hdGNoLCBvciBcdTIwMTQgd2hlbiBkdXBsaWNhdGVkIFx1MjAxNFxuICogICBhIGBAQGAgY2hhbmdlLWNvbnRleHQgbGluZSB0aGF0IHNlbGVjdHMgdGhlIG9jY3VycmVuY2UgYWZ0ZXIgaXQuXG4gKiAtIEVtcHR5IGJsb2NrIChwdXJlIGluc2VydGlvbik6IGFuY2hvciBvbiBhIHVuaXF1ZSBjaGFuZ2UtY29udGV4dCBsaW5lIGlmIG9uZVxuICogICBpcyBnaXZlbjsgb3RoZXJ3aXNlIGl0IGlzIHVubG9jYXRhYmxlLlxuICovXG5mdW5jdGlvbiBsb2NhdGVDaHVuayhwcmVMaW5lczogc3RyaW5nW10sIGNodW5rOiBVcGRhdGVDaHVuayk6IExpbmVSYW5nZSB8IG51bGwge1xuICBjb25zdCBibG9jayA9IGNodW5rLm9sZExpbmVzO1xuXG4gIGlmIChibG9jay5sZW5ndGggPT09IDApIHtcbiAgICBjb25zdCBjdHggPSBjaHVuay5jaGFuZ2VDb250ZXh0O1xuICAgIGlmIChjdHggIT09IG51bGwgJiYgY3R4ICE9PSAnJykge1xuICAgICAgY29uc3QgY3R4SWR4cyA9IGxpbmVJbmRpY2VzKHByZUxpbmVzLCBjdHgpO1xuICAgICAgaWYgKGN0eElkeHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBjdHhJZHhzWzBdICsgMTtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IGxpbmUsIGVuZDogbGluZSB9O1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHN0YXJ0cyA9IGNvbnRpZ3VvdXNNYXRjaGVzKHByZUxpbmVzLCBibG9jayk7XG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgcyA9IHN0YXJ0c1swXTtcbiAgICByZXR1cm4geyBzdGFydDogcyArIDEsIGVuZDogcyArIGJsb2NrLmxlbmd0aCB9O1xuICB9XG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBEdXBsaWNhdGVkIGJsb2NrOiB1c2UgdGhlIGNoYW5nZSBjb250ZXh0IHRvIHNlbGVjdCB0aGUgbWF0Y2ggYWZ0ZXIgaXQuXG4gIGNvbnN0IGN0eCA9IGNodW5rLmNoYW5nZUNvbnRleHQ7XG4gIGlmIChjdHggIT09IG51bGwgJiYgY3R4ICE9PSAnJykge1xuICAgIGZvciAoY29uc3QgYyBvZiBsaW5lSW5kaWNlcyhwcmVMaW5lcywgY3R4KSkge1xuICAgICAgY29uc3QgYWZ0ZXIgPSBzdGFydHMuZmluZCgocykgPT4gcyA+PSBjKTtcbiAgICAgIGlmIChhZnRlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiBhZnRlciArIDEsIGVuZDogYWZ0ZXIgKyBibG9jay5sZW5ndGggfTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7IC8vIGFtYmlndW91cyBcdTIxOTIgY2FsbGVyIGRlZ3JhZGVzIHRvIHdob2xlLWZpbGVcbn1cblxuLyoqXG4gKiBSZWNvdmVyIGEgc2luZ2xlIGxpbmUgcmFuZ2Ugc3Bhbm5pbmcgYWxsIG9mIGFuIHVwZGF0ZSdzIGNodW5rcy4gUmV0dXJucyBudWxsXG4gKiAoXHUyMTkyIHdob2xlLWZpbGUgZmFsbGJhY2spIGlmIGFueSBjaHVuayBjYW5ub3QgYmUgbG9jYXRlZC5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJhbmdlKHByZUxpbmVzOiBzdHJpbmdbXSwgY2h1bmtzOiBVcGRhdGVDaHVua1tdKTogTGluZVJhbmdlIHwgbnVsbCB7XG4gIGxldCB1bmlvbjogTGluZVJhbmdlIHwgbnVsbCA9IG51bGw7XG4gIGZvciAoY29uc3QgY2h1bmsgb2YgY2h1bmtzKSB7XG4gICAgY29uc3QgciA9IGxvY2F0ZUNodW5rKHByZUxpbmVzLCBjaHVuayk7XG4gICAgaWYgKHIgPT09IG51bGwpIHJldHVybiBudWxsO1xuICAgIHVuaW9uID0gdW5pb24gPT09IG51bGwgPyByIDogeyBzdGFydDogTWF0aC5taW4odW5pb24uc3RhcnQsIHIuc3RhcnQpLCBlbmQ6IE1hdGgubWF4KHVuaW9uLmVuZCwgci5lbmQpIH07XG4gIH1cbiAgcmV0dXJuIHVuaW9uO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFB1YmxpYyBBUElcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFBhcnNlIGEgQ29kZXggYGFwcGx5X3BhdGNoYCBjb21tYW5kIHN0cmluZyBpbnRvIGFuIGFuY2hvciBwZXIgdG91Y2hlZCBmaWxlLlxuICpcbiAqIC0gYCoqKiBBZGQgRmlsZTpgIFx1MjE5MiBgY3JlYXRlYCAod2hvbGUtZmlsZSlcbiAqIC0gYCoqKiBEZWxldGUgRmlsZTpgIFx1MjE5MiBgd2hvbGUtd3JpdGVgICh3aG9sZS1maWxlOyB0aGUgZmlsZSBubyBsb25nZXIgZXhpc3RzKVxuICogLSBgKioqIFVwZGF0ZSBGaWxlOmAgXHUyMTkyIGB3cml0ZWAgd2l0aCBhIHJlY292ZXJlZCBsaW5lIHJhbmdlIHdoZW4gdGhlIGh1bmsnc1xuICogICBwcmUtZWRpdCBibG9jayBjYW4gYmUgbG9jYXRlZCB2aWEgYHJlYWRQcmVFZGl0RmlsZWAsIG90aGVyd2lzZSBgd2hvbGUtd3JpdGVgLlxuICogICBBIHJlbmFtZWQgdXBkYXRlIChgKioqIE1vdmUgdG86YCkgYW5jaG9ycyB0aGUgZGVzdGluYXRpb24gcGF0aCBhc1xuICogICBgd2hvbGUtd3JpdGVgIHNpbmNlIHByZS1lZGl0IGxpbmUgbnVtYmVycyBjYW5ub3QgYmUgbWFwcGVkIGFjcm9zcyBhIHJlbmFtZS5cbiAqXG4gKiBOZXZlciB0aHJvd3M6IGEgbWFsZm9ybWVkIG9yIGVtcHR5IHBhdGNoIHlpZWxkcyBgW11gLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VBcHBseVBhdGNoKFxuICBjb21tYW5kOiBzdHJpbmcsXG4gIHJlYWRQcmVFZGl0RmlsZTogUmVhZFByZUVkaXRGaWxlID0gZGVmYXVsdFJlYWRQcmVFZGl0RmlsZVxuKTogQW5jaG9yU3BlY1tdIHtcbiAgY29uc3QgYW5jaG9yczogQW5jaG9yU3BlY1tdID0gW107XG5cbiAgZm9yIChjb25zdCBodW5rIG9mIHNjYW5IdW5rcyhjb21tYW5kKSkge1xuICAgIGlmIChodW5rLmtpbmQgPT09ICdhZGQnKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0b1Bvc2l4KGh1bmsucGF0aCksIGtpbmQ6ICdjcmVhdGUnIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChodW5rLmtpbmQgPT09ICdkZWxldGUnKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0b1Bvc2l4KGh1bmsucGF0aCksIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGU6IGFuY2hvciBvbiB0aGUgZGVzdGluYXRpb24gcGF0aCAocG9zdC1lZGl0IGxvY2F0aW9uKS5cbiAgICBjb25zdCB0YXJnZXRQYXRoID0gdG9Qb3NpeChodW5rLm1vdmVQYXRoID8/IGh1bmsucGF0aCk7XG5cbiAgICAvLyBBIHJlbmFtZSBkZWZlYXRzIHByZS1lZGl0IGxpbmUgbWFwcGluZyBcdTIwMTQgYW5jaG9yIHdob2xlLWZpbGUgb24gdGhlIHRhcmdldC5cbiAgICBpZiAoaHVuay5tb3ZlUGF0aCAhPT0gbnVsbCkge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dob2xlLXdyaXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFJhbmdlIHJlY292ZXJ5IHJlYWRzIHRoZSBwcmUtZWRpdCBjb250ZW50IGF0IHRoZSBvcmlnaW5hbCAocHJlLW1vdmUpIHBhdGguXG4gICAgY29uc3QgY29udGVudCA9IHJlYWRQcmVFZGl0RmlsZShodW5rLnBhdGgpO1xuICAgIGNvbnN0IHJhbmdlID0gY29udGVudCA9PT0gbnVsbCA/IG51bGwgOiByZWNvdmVyUmFuZ2Uoc3BsaXRMaW5lcyhjb250ZW50KSwgaHVuay5jaHVua3MpO1xuICAgIGlmIChyYW5nZSAhPT0gbnVsbCkge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dyaXRlJywgcmFuZ2UgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGFuY2hvcnM7XG59XG4iLCAiaW1wb3J0IGhvb2sgZnJvbSBcIi4vcG9zdC10b29sLXVzZS50c1wiO1xuaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gXCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qc1wiO1xuZXhlY3V0ZShob29rKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFvQ0EsU0FBUyxXQUFXQSxvQkFBbUI7OztBQ1JoQyxJQUFNLDBCQUEwQixvQkFBSSxJQUFJLENBQUMsZ0JBQWdCLG9CQUFvQixlQUFlLENBQUM7OztBQzVCcEcsU0FBUyxlQUFlLGVBQWUsUUFBUSxTQUFTO0FBQ3BELFFBQU0sT0FBTztBQUNiLE9BQUssZ0JBQWdCO0FBQ3JCLE9BQUssVUFBVSxPQUFPO0FBQ3RCLE9BQUssZ0JBQWdCLE9BQU87QUFDNUIsTUFBSSxhQUFhLFVBQVUsT0FBTyxPQUFPLFlBQVksVUFBVTtBQUMzRCxTQUFLLFVBQVUsT0FBTztBQUFBLEVBQzFCO0FBQ0EsU0FBTztBQUNYO0FBSU8sU0FBUyxnQkFBZ0IsUUFBUSxTQUFTO0FB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QVcsT0FBTyxLQUFLLEVBQUU7QUFDL0IsV0FBTyxrQkFBa0IsRUFBRSxtQkFBbUIsVUFBVSxlQUFlLFNBQVMsQ0FBQztBQUFBLEVBQ25GO0FBQ0Y7QUFFQSxJQUFPLHdCQUFRLGdCQUFnQixFQUFFLFNBQVMsc0NBQXNDLFNBQVMsSUFBTyxHQUFHLGNBQWMsQ0FBQzs7O0FnQnpYbEgsUUFBUSxxQkFBSTsiLAogICJuYW1lcyI6IFsicmVzb2x2ZVBhdGgiLCAicmVzb2x2ZSIsICJpc0Fic29sdXRlIiwgImV4ZWNGaWxlU3luYyIsICJzdGF0U3luYyIsICJpIiwgInJlc29sdmUiLCAidmFsdWUiLCAiZXNjYXBlUmVnRXhwIiwgImlzQWJzb2x1dGUiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImxvZ2dlciIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAiYmFzZW5hbWUiLCAiYmFzZW5hbWUiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgInRvUG9zaXgiLCAiY3R4IiwgInJlY292ZXJSYW5nZSIsICJjb21tYW5kIiwgInJlc29sdmVQYXRoIiwgImJsb2NrcyIsICJjb21iaW5lZCJdCn0K
