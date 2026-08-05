#!/usr/bin/env -S node --enable-source-maps
// src/codex/post-tool-use.ts
import { resolve as resolvePath3 } from "node:path";

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
      parts.push({ text: s, precededBy: pendingOp, ...bufHeredoc ? { heredoc: true } : {} });
    }
    buf = "";
    bufHeredoc = false;
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
  let bufHeredoc = false;
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
      if (c === "<" && cmd[i + 1] === "<" && cmd[i + 2] === "<" && cmd[i + 3] !== "<" && cmd[i - 1] !== "<") {
        buf += "<<<";
        i += 3;
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
          bufHeredoc = true;
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

// src/common/parse-response.ts
import { existsSync as existsSync2, statSync as statSync3 } from "node:fs";
import { dirname as dirname3, join as join2, resolve as resolvePath2, sep } from "node:path";
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
    if (a.includes(":") && !existsSync2(resolvePath2(cwd, a))) return true;
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
function parseRecord(line, sep2) {
  const first = line.indexOf(sep2);
  if (first === -1) return null;
  const second = line.indexOf(sep2, first + 1);
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
    if (abs === root || abs.startsWith(root + sep)) return true;
  }
  return false;
}
function isFile(abs) {
  try {
    return statSync3(abs).isFile();
  } catch {
    return false;
  }
}
function findGitRoot(startDir) {
  let dir = startDir;
  for (; ; ) {
    if (existsSync2(join2(dir, ".git"))) return dir;
    const parent = dirname3(dir);
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
var HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
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
    const hunk = HUNK_HEADER.exec(line);
    if (hunk !== null) {
      current.sawHunk = true;
      emitHunkRange(perFile, current, hunk);
    }
  }
  return perFile;
}
function emitHunkRange(perFile, record, hunk) {
  if (record.binary || record.combined || record.submodule || record.unusable) return;
  const oldStart = Number.parseInt(hunk[1], 10);
  const oldCount = hunk[2] === void 0 ? 1 : Number.parseInt(hunk[2], 10);
  const newStart = Number.parseInt(hunk[3], 10);
  const newCount = hunk[4] === void 0 ? 1 : Number.parseInt(hunk[4], 10);
  if (record.rename) {
    if (record.newPath !== null) addLines(perFile, record.newPath, newStart, newCount);
    return;
  }
  if (record.oldPath !== null) addLines(perFile, record.oldPath, oldStart, oldCount);
  if (record.newPath !== null) addLines(perFile, record.newPath, newStart, newCount);
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
    const relative = diffRelativeBase(gated.argv, gated.start, effectiveDir, repoRoot);
    if (relative === "unresolvable") return [];
    const base2 = relative !== null ? relative.base : repoRoot;
    const roots2 = relative !== null ? [relative.root] : [repoRoot];
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
  let lineCount2;
  try {
    const content = fs4.readFileSync(filePath, "utf8");
    lineCount2 = content.length === 0 ? 0 : content.split("\n").length;
  } catch {
    return "whole-file";
  }
  const end = Math.min(start + (limit ?? DEFAULT_READ_LIMIT) - 1, Math.max(lineCount2, start));
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
function normalizeShellResponse(toolResponse) {
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
  if (toolResponse !== null && typeof toolResponse === "object") {
    const record = toolResponse;
    for (const field of RESPONSE_TEXT_FIELDS) {
      const value = record[field];
      if (typeof value === "string") {
        return {
          stdout: value,
          stderr: typeof record.stderr === "string" ? record.stderr : void 0,
          exitStatus: typeof record.exitCode === "number" ? record.exitCode : typeof record.exitStatus === "number" ? record.exitStatus : void 0,
          truncated: record.rawOutputPath !== void 0,
          interrupted: record.interrupted === true || record.timedOutAfterMs !== void 0
        };
      }
    }
  }
  return null;
}
function classifyApplyPatchResponse(toolResponse) {
  if (Array.isArray(toolResponse)) return "unknown";
  const normalized = normalizeShellResponse(toolResponse);
  if (normalized === null) return "unknown";
  return normalized.stdout.startsWith(APPLY_PATCH_SUCCESS_PREFIX) ? "success" : "failure";
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
      const effectiveCwd = workdir !== null && !/[`$]/.test(workdir) ? resolvePath3(cwd, workdir) : cwd;
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
      const response = normalizeShellResponse(input.tool_response);
      if (response !== null) {
        for (const span of parseResponse({ command: command2, cwd, ...response })) {
          const absPath = abspathAgainst(cwd, span.absolutePath);
          const scope = resolveTouchScope(cwd, absPath);
          if (!scope) continue;
          const output = await runTouchHook(
            {
              kind: "read",
              sessionId,
              cwd,
              filePath: absPath,
              offset: span.lineStart,
              limit: span.lineEnd - span.lineStart + 1
            },
            executors,
            memo
          );
          if (output.additionalContext) blocks2.push(output.additionalContext);
        }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UudHMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3ZhcmlhYmxlLWV4cGFuZC50cyIsICJzcmMvY29tbW9uL3BhcnNlLXJlc3BvbnNlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1zdXJmYWNlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1pZ25vcmUudHMiLCAic3JjL2NvbW1vbi90b3VjaC1jb3JlLnRzIiwgInNyYy9jb21tb24vYW5jaG9yLXRyZWUudHMiLCAic3JjL2NvZGV4L2FwcGx5LXBhdGNoLnRzIiwgInNyYy9jb2RleC9wb3N0LXRvb2wtdXNlLWVudHJ5LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIENvZGV4IFBvc3RUb29sVXNlIHRvdWNoIGhvb2sgXHUyMDE0IGhlYWwgKyBzdXJmYWNlIGFmdGVyIGEgY29uZmlybWVkIGBhcHBseV9wYXRjaGAsXG4gKiBvciBhIHNoZWxsL2V4ZWMgY2FsbCB3aG9zZSBjb21tYW5kIHN0YXRpY2FsbHkgcmVzb2x2ZXMgdG8gZmlsZStsaW5lIGlkaW9tcy5cbiAqXG4gKiBQb3N0VG9vbFVzZSBmaXJlcyBhZnRlciBgYXBwbHlfcGF0Y2hgIGhhcyBydW4sIHNvIHRoaXMgaXMgdGhlIGFjY3VyYXRlIGhvbWUgZm9yXG4gKiB0aGUgdG91Y2ggc2lnbmFsOiB0aGUgZmlsZSBpcyBhbHJlYWR5IHdyaXR0ZW4sIHNvIGEgc2NvcGVkIGBnaXQgc3BhbiBkcmlmdFxuICogPGZpbGU+IC0tZml4YCBoZWFscyBwb3NpdGlvbmFsIGRyaWZ0IGFnYWluc3QgcmVhbCBieXRlcyBhbmQgdGhlIHN1cmZhY2VkIGJsb2NrXG4gKiByZWZsZWN0cyB0aGUgaGVhbGVkIGFuY2hvcnMuIFRoZSBoYW5kbGVyIG5hcnJvd3MgdGhlIGBhcHBseV9wYXRjaGAgZW52ZWxvcGVcbiAqIChgdG9vbF9pbnB1dC5jb21tYW5kYCwgU0RLLXR5cGVkIGB1bmtub3duYCkgaW50byBwZXItZmlsZSBhbmNob3JzIHZpYSB0aGVcbiAqIHNoYXJlZCBbYXBwbHktcGF0Y2ggcGFyc2VyXSguL2FwcGx5LXBhdGNoLnRzKSwgYW5kIHJlY292ZXJzIHNoZWxsIGNvbW1hbmRzXG4gKiBmcm9tIGVpdGhlciBDb2RleCBlbnZlbG9wZSAoY2xhc3NpYyBgZXhlY19jb21tYW5kYCBKU09OIGBhcmd1bWVudHNgLCBvclxuICogY29kZS1tb2RlIGBleGVjYCB3cmFwcGluZyBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWApIHZpYSB0aGUgc2hhcmVkXG4gKiBbY29tbWFuZCBwYXJzZXJdKC4uL2NvbW1vbi9wYXJzZS1jb21tYW5kLnRzKTsgZWFjaCB0b3VjaGVkIGZpbGUgaXMgc2NvcGVkIHRvXG4gKiB0aGUgQ1dEIHJlcG8sIGFuZCBkcml2ZXMgdGhlIGhhcm5lc3MtYWdub3N0aWMge0BsaW5rIHJ1blRvdWNoSG9va30gY29yZSBcdTIwMTQgdGhlXG4gKiBzYW1lIGNvcmUgdGhlIENsYXVkZSBhZGFwdGVyIHVzZXMuXG4gKlxuICogVHdvIENvZGV4LXNwZWNpZmljIGNvbmNlcm5zIGFyZSBwcmVzZXJ2ZWQgZnJvbSB0aGlzIGZpbGUncyBqb3VybmFsaW5nXG4gKiBwcmVkZWNlc3NvcjpcbiAqXG4gKiAxLiAqKlN1Y2Nlc3MgY2xhc3NpZmljYXRpb24uKiogVGhlIHBhcnNlZCBlbnZlbG9wZSBkZXNjcmliZXMgKmludGVudCosIG5vdFxuICogICAgKm91dGNvbWUqLiBDb2RleCBjb3JlIGZpcmVzIFBvc3RUb29sVXNlIG9ubHkgb24gdG9vbCBzdWNjZXNzLCBidXQgYXMgYVxuICogICAgZHVyYWJpbGl0eSBiZWx0IHdlIGNsYXNzaWZ5IGB0b29sX3Jlc3BvbnNlYCB2aWFcbiAqICAgIHtAbGluayBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZX06IGEgY29uZmlybWVkIHJlamVjdGlvbiAoYCdmYWlsdXJlJ2ApXG4gKiAgICBzdXBwcmVzc2VzIHRoZSB0b3VjaCAobm8gcGhhbnRvbSBoZWFsL3N1cmZhY2Ugb24gYSBwYXRjaCB0aGF0IG5ldmVyXG4gKiAgICBhcHBsaWVkKTsgYSBzdWNjZXNzIG9yIGFuIHVucmVjb2duaXplZCBzaGFwZSAoYCd1bmtub3duJ2AsIHdhcm5lZCkgcHJvY2VlZHMuXG4gKiAyLiAqKk5vIHBvc3QtZWRpdCByYW5nZSByZWNvdmVyeSBmcm9tIHRoZSBlbnZlbG9wZS4qKiBQb3N0VG9vbFVzZSBydW5zIGFmdGVyXG4gKiAgICB0aGUgcGF0Y2ggcmV3cm90ZSB0aGUgZmlsZSwgc28gdGhlIGh1bmsncyBwcmUtZWRpdCBibG9jayBubyBsb25nZXIgc2l0c1xuICogICAgd2hlcmUgdGhlIGVkaXQgaGFwcGVuZWQgYW5kIGNvdWxkIG1pcy1hbmNob3IgYSBkdXBsaWNhdGUuIFRoZSB0b3VjaCBpc1xuICogICAgc2NvcGVkIGZpbGUtd2lkZSAoYHdyaXR0ZW46ICcnYCBcdTIxOTIgd2hvbGUtZmlsZSksIHdoaWNoIGlzIGV4YWN0bHkgdGhlXG4gKiAgICBiZWhhdmlvciB7QGxpbmsgcnVuVG91Y2hIb29rfSB0YWtlcyBmb3IgYW4gZW1wdHkgd3JpdGUuXG4gKlxuICogVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGluIHRoZSBoYW5kbGVyIGNvbmZpZyAodGhlIENMSSBlbWl0cyBgMTBgIHNlY29uZHMpXG4gKiBcdTIwMTQgc2VlIHRoZSB0aW1lb3V0LXVuaXRzIHNwaWtlIG5vdGU7IHRoZSBzb3VyY2UgdmFsdWUgbXVzdCBzdGF5IGluIG1zIHNvIHRoZVxuICogQ29kZXggYnVpbGQncyBzZWNvbmRzIGNvbnZlcnNpb24gYXQgZW1pdCByZW1haW5zIGNvcnJlY3QuXG4gKi9cblxuaW1wb3J0IHsgcmVzb2x2ZSBhcyByZXNvbHZlUGF0aCB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFBvc3RUb29sVXNlSW5wdXQsIHBvc3RUb29sVXNlSG9vaywgcG9zdFRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHsgYWJzcGF0aEFnYWluc3QgfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHBhcnNlQ29tbWFuZERldGFpbGVkIH0gZnJvbSAnLi4vY29tbW9uL3BhcnNlLWNvbW1hbmQuanMnO1xuaW1wb3J0IHsgcGFyc2VSZXNwb25zZSwgdHlwZSBSZXNwb25zZVBhcnNlSW5wdXQgfSBmcm9tICcuLi9jb21tb24vcGFyc2UtcmVzcG9uc2UuanMnO1xuaW1wb3J0IHsgY3JlYXRlRGlza01lbW9TdG9yZSwgdHlwZSBNZW1vRmFjdG9yeSwgcmVzb2x2ZVRvdWNoU2NvcGUgfSBmcm9tICcuLi9jb21tb24vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7XG4gIGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycyxcbiAgcnVuVG91Y2hIb29rLFxuICB0eXBlIFRvdWNoRXhlY3V0b3JzLFxuICB0eXBlIFRvdWNoSW5wdXRcbn0gZnJvbSAnLi4vY29tbW9uL3RvdWNoLWNvcmUuanMnO1xuaW1wb3J0IHsgcGFyc2VBcHBseVBhdGNoIH0gZnJvbSAnLi9hcHBseS1wYXRjaC5qcyc7XG5cbi8qKlxuICogVGhlIHByZWZpeCBhcHBseV9wYXRjaCdzIHN0ZG91dCBjYXJyaWVzIHdoZW4gXHUyMDE0IGFuZCBvbmx5IHdoZW4gXHUyMDE0IHRoZSBwYXRjaFxuICogYXBwbGllZCAoY29kZXgtcnMvYXBwbHktcGF0Y2ggYHByaW50X3N1bW1hcnlgKS4gQ29kZXggc3VyZmFjZXMgdGhhdCBzdGRvdXRcbiAqIHZlcmJhdGltIGFzIHRoZSBQb3N0VG9vbFVzZSBgdG9vbF9yZXNwb25zZWAgKGEgYmFyZSBzdHJpbmcgdG9kYXkpLiBGaXhlZFxuICogYWNyb3NzIEFkZC9Nb2RpZnkvRGVsZXRlOyB0aGUgaGVhZGVyIGlzIGZvbGxvd2VkIGJ5IGBBL00vRCA8cGF0aD5gIGxpbmVzLlxuICovXG5jb25zdCBBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWCA9ICdTdWNjZXNzLiBVcGRhdGVkIHRoZSBmb2xsb3dpbmcgZmlsZXM6JztcblxuLyoqXG4gKiBUaGUgY29tbW9uIGZpZWxkcyBhbiBvYmplY3Qtd3JhcHBlZCB0b29sX3Jlc3BvbnNlIG1pZ2h0IGNhcnJ5IHRoZSB0b29sJ3MgdGV4dFxuICogb3V0cHV0IHVuZGVyLCBpZiBDb2RleCBldmVyIHN0b3BzIHN1cmZhY2luZyBpdCBhcyBhIGJhcmUgc3RyaW5nLiBPcmRlcmVkIGJ5XG4gKiBsaWtlbGlob29kOyB0aGUgZmlyc3QgZmllbGQgd2hvc2UgdmFsdWUgaXMgYSBzdHJpbmcgd2lucy5cbiAqL1xuY29uc3QgUkVTUE9OU0VfVEVYVF9GSUVMRFMgPSBbJ291dHB1dCcsICdzdGRvdXQnLCAnY29udGVudCcsICd0ZXh0J10gYXMgY29uc3Q7XG5cbi8qKiBOYXJyb3cgdGhlIFNESydzIGB1bmtub3duYCB0b29sX2lucHV0IHRvIHRoZSBgYXBwbHlfcGF0Y2hgIGB7IGNvbW1hbmQgfWAgc2hhcGUuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93QXBwbHlQYXRjaENvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2NvbW1hbmQnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGNvbW1hbmQgPSAodG9vbElucHV0IGFzIHsgY29tbWFuZDogdW5rbm93biB9KS5jb21tYW5kO1xuICAgIGlmICh0eXBlb2YgY29tbWFuZCA9PT0gJ3N0cmluZycpIHJldHVybiBjb21tYW5kO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIE5hcnJvdyB0aGUgY2xhc3NpYyBgZXhlY19jb21tYW5kYCBlbnZlbG9wZSAoY2xpX3ZlcnNpb24gXHUyMjY0IDAuMTMwLjApOlxuICogYHRvb2xfaW5wdXQuYXJndW1lbnRzYCBpcyBhIEpTT04gKnN0cmluZyogb2Ygc2hhcGVcbiAqIGB7XCJjbWRcIjogXCIuLi5cIiwgXCJ3b3JrZGlyXCI6IFwiLi4uXCJ9YCBcdTIwMTQgcGFyc2UgaXQgYW5kIHJldHVybiB0aGUgYGNtZGAgYW5kXG4gKiBgd29ya2RpcmAuIFJldHVybnMgYG51bGxgIGZvciBhbnkgb3RoZXIgc2hhcGUgKG5vdCBKU09OLCBubyBgY21kYCBmaWVsZCwgb3JcbiAqIG5vdCB0aGlzIGVudmVsb3BlKTsgYHdvcmtkaXJgIGlzIGBudWxsYCB3aGVuIGFic2VudCBvciBub3QgYSBzdHJpbmcuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dFeGVjQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiB7IGNtZDogc3RyaW5nOyB3b3JrZGlyOiBzdHJpbmcgfCBudWxsIH0gfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnYXJndW1lbnRzJyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBhcmdzID0gKHRvb2xJbnB1dCBhcyB7IGFyZ3VtZW50czogdW5rbm93biB9KS5hcmd1bWVudHM7XG4gICAgaWYgKHR5cGVvZiBhcmdzID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShhcmdzKTtcbiAgICAgICAgaWYgKHBhcnNlZCAhPT0gbnVsbCAmJiB0eXBlb2YgcGFyc2VkID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgcGFyc2VkLmNtZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICByZXR1cm4geyBjbWQ6IHBhcnNlZC5jbWQsIHdvcmtkaXI6IHR5cGVvZiBwYXJzZWQud29ya2RpciA9PT0gJ3N0cmluZycgPyBwYXJzZWQud29ya2RpciA6IG51bGwgfTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBUaGUgcmVzdWx0IG9mIG5hcnJvd2luZyB0aGUgY29kZS1tb2RlIGBleGVjYCBlbnZlbG9wZS4gYG1hdGNoZWRgIHNlcGFyYXRlc1xuICogXCJ0aGUgZW52ZWxvcGUgd2FzIGEgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIGNhbGwgd2hvc2UgYXJndW1lbnQgY291bGQgbm90XG4gKiBiZSByZWNvdmVyZWRcIiAoYSB2YXJpYWJsZS90ZW1wbGF0ZS1idWlsdCBjb21tYW5kIFx1MjAxNCBzdGF0aWNhbGx5IHVucmVzb2x2YWJsZSlcbiAqIGZyb20gXCJ0aGUgZW52ZWxvcGUgaXMgbm90IGNvZGUtbW9kZSBleGVjIGF0IGFsbFwiLCBzbyB0aGUgaGFuZGxlciBjYW4gd2FybiBvblxuICogdGhlIGZvcm1lciBpbnN0ZWFkIG9mIHNpbGVudGx5IGNvbmZsYXRpbmcgaXQgd2l0aCB0aGUgbGF0dGVyLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvZGVNb2RlRXhlY05hcnJvdyB7XG4gIC8qKiBXaGV0aGVyIGB0b29sX2lucHV0LmlucHV0YCBjb250YWluZWQgYSBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgY2FsbC4gKi9cbiAgbWF0Y2hlZDogYm9vbGVhbjtcbiAgLyoqIFRoZSByZWNvdmVyZWQgYGNtZGAgc3RyaW5nLCBvciBgbnVsbGAgd2hlbiBtYXRjaGVkIGJ1dCB1bnBhcnNhYmxlIC8gYWJzZW50LiAqL1xuICBjbWQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKiBUaGUgcmVjb3ZlcmVkIGB3b3JrZGlyYCBzdHJpbmcsIG9yIGBudWxsYCB3aGVuIGFic2VudCBvciBub3QgYSBzdHJpbmcuICovXG4gIHdvcmtkaXI6IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogUXVvdGUgYmFyZSBpZGVudGlmaWVyIGtleXMgaW4gYSBKUyBvYmplY3QgbGl0ZXJhbCBzbyBgSlNPTi5wYXJzZWAgY2FuIHJlYWRcbiAqIGl0LiBSZWFsIGNvZGUtbW9kZSBjYWxsIHNpdGVzIGVtaXQgSlMtc3R5bGUgdW5xdW90ZWQga2V5c1xuICogKGB7Y21kOlwic2VkIC1uICcxLDI0MHAnIC9wYXRoXCIsLi4ufWApLCB3aGljaCBpcyB2YWxpZCBKUyBidXQgaW52YWxpZCBKU09OLlxuICogU3RyaW5nIHZhbHVlcyAoc2luZ2xlLSBvciBkb3VibGUtcXVvdGVkKSBhcmUgY29waWVkIHZlcmJhdGltIFx1MjAxNCBpbmNsdWRpbmcgYW55XG4gKiBgLCBrZXk6YC1zaGFwZWQgdGV4dCBpbnNpZGUgdGhlbSBcdTIwMTQgYW5kIGFscmVhZHktcXVvdGVkIGtleXMgcGFzcyB0aHJvdWdoXG4gKiB1bnRvdWNoZWQuXG4gKi9cbmZ1bmN0aW9uIHF1b3RlT2JqZWN0S2V5cyhsaXRlcmFsOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgb3V0ID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IGxpdGVyYWwubGVuZ3RoO1xuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gbGl0ZXJhbFtpXTtcbiAgICBpZiAoYyA9PT0gJ1wiJyB8fCBjID09PSBcIidcIikge1xuICAgICAgY29uc3QgcXVvdGUgPSBjO1xuICAgICAgY29uc3Qgc3RhcnQgPSBpO1xuICAgICAgaSArPSAxO1xuICAgICAgd2hpbGUgKGkgPCBuKSB7XG4gICAgICAgIGlmIChsaXRlcmFsW2ldID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSBpICs9IDI7XG4gICAgICAgIGVsc2UgaWYgKGxpdGVyYWxbaV0gPT09IHF1b3RlKSB7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9IGVsc2UgaSArPSAxO1xuICAgICAgfVxuICAgICAgb3V0ICs9IGxpdGVyYWwuc2xpY2Uoc3RhcnQsIGkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGtleSA9IGxpdGVyYWwuc2xpY2UoaSkubWF0Y2goL14oXFx7fCwpXFxzKihbQS1aYS16XyRdW0EtWmEtejAtOV8kXSopXFxzKjovKTtcbiAgICBpZiAoa2V5KSB7XG4gICAgICBvdXQgKz0gYCR7a2V5WzFdfVwiJHtrZXlbMl19XCI6YDtcbiAgICAgIGkgKz0ga2V5WzBdLmxlbmd0aDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBvdXQgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBOYXJyb3cgdGhlIGNvZGUtbW9kZSBgZXhlY2AgZW52ZWxvcGUgKGNsaV92ZXJzaW9uIFx1MjI2NSAwLjE0NC4wKTpcbiAqIGB0b29sX2lucHV0LmlucHV0YCBpcyBKUyBzb3VyY2UgdGhhdCBjYWxscyBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgXHUyMDE0XG4gKiByZWNvdmVyIHRoZSBsaXRlcmFsIG9iamVjdCBhcmd1bWVudCB2aWEgYmFsYW5jZWQtYnJhY2UgbWF0Y2hpbmcsIHF1b3RlIGl0c1xuICogdW5xdW90ZWQgSlMga2V5cywgYW5kIHBhcnNlIGl0LiBBIGNvbW1hbmQgYnVpbHQgZnJvbSB2YXJpYWJsZXMgb3IgdGVtcGxhdGVcbiAqIGxpdGVyYWxzIGlzIHN0YXRpY2FsbHkgdW5yZXNvbHZhYmxlOiB0aGUgY2FsbCBzdGlsbCAqbWF0Y2hlZCogYnV0IHlpZWxkc1xuICogYGNtZDogbnVsbGAsIHJlcG9ydGVkIGRpc3RpbmN0bHkgZnJvbSBhIG5vbi1jb2RlLW1vZGUgZW52ZWxvcGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dDb2RlTW9kZUV4ZWModG9vbElucHV0OiB1bmtub3duKTogQ29kZU1vZGVFeGVjTmFycm93IHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnaW5wdXQnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGlucHV0ID0gKHRvb2xJbnB1dCBhcyB7IGlucHV0OiB1bmtub3duIH0pLmlucHV0O1xuICAgIGlmICh0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAvLyBNYXRjaCB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pIFx1MjAxNCBleHRyYWN0IHRoZSBsaXRlcmFsIG9iamVjdCBhcmd1bWVudFxuICAgICAgY29uc3QgbWF0Y2ggPSBpbnB1dC5tYXRjaCgvdG9vbHNcXC5leGVjX2NvbW1hbmRcXChcXHMqKFxceyg/Oltee31dfFxceyg/Oltee31dfFxce1tee31dKlxcfSkqXFx9KSpcXH0pXFxzKlxcKS8pO1xuICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShxdW90ZU9iamVjdEtleXMobWF0Y2hbMV0pKTtcbiAgICAgICAgICBpZiAocGFyc2VkICE9PSBudWxsICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnICYmIHR5cGVvZiBwYXJzZWQuY21kID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbWF0Y2hlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgY21kOiBwYXJzZWQuY21kLFxuICAgICAgICAgICAgICB3b3JrZGlyOiB0eXBlb2YgcGFyc2VkLndvcmtkaXIgPT09ICdzdHJpbmcnID8gcGFyc2VkLndvcmtkaXIgOiBudWxsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IG51bGwsIHdvcmtkaXI6IG51bGwgfTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gbWF0Y2hlZCwgYnV0IHRoZSBsaXRlcmFsIGRpZCBub3QgcGFyc2UgXHUyMDE0IHRoZSBjYWxsIGlzIHN0aWxsIGFcbiAgICAgICAgICAvLyBjb2RlLW1vZGUgZXhlYyB3aG9zZSBjb21tYW5kIGNhbm5vdCBiZSByZWNvdmVyZWQgc3RhdGljYWxseS5cbiAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IG51bGwsIHdvcmtkaXI6IG51bGwgfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4geyBtYXRjaGVkOiBmYWxzZSwgY21kOiBudWxsLCB3b3JrZGlyOiBudWxsIH07XG59XG5cbi8qKiBUaGUgc2hlbGwgYHRvb2xfcmVzcG9uc2VgIGZpZWxkcyBhIHJlc3BvbnNlLWF3YXJlIHBhcnNlIGNvbnRyaWJ1dGVzLCBiZWZvcmUgYGNvbW1hbmRgL2Bjd2RgIGFyZSBhdHRhY2hlZCBhdCB0aGUgY2FsbCBzaXRlLiAqL1xudHlwZSBOb3JtYWxpemVkU2hlbGxSZXNwb25zZSA9IFBpY2s8XG4gIFJlc3BvbnNlUGFyc2VJbnB1dCxcbiAgJ3N0ZG91dCcgfCAnc3RkZXJyJyB8ICdleGl0U3RhdHVzJyB8ICd0cnVuY2F0ZWQnIHwgJ2ludGVycnVwdGVkJ1xuPjtcblxuLyoqXG4gKiBUb2xlcmFudGx5IG5vcm1hbGl6ZSB0aGUgdG9vbCdzIHRleHR1YWwgb3V0cHV0IGFuZCBtZXRhZGF0YSBvdXQgb2YgYVxuICogYHRvb2xfcmVzcG9uc2VgIG9mIHVuY2VydGFpbiBzaGFwZSAoU0RLLXR5cGVkIGB1bmtub3duYCk6IGEgYmFyZSBzdHJpbmdcbiAqICh0b2RheSdzIENvZGV4KSBpcyB1c2VkIGFzLWlzOyBhIHRleHQtYmxvY2sgYXJyYXkgam9pbnMgaXRzIGJsb2NrczsgYW5cbiAqIG9iamVjdCBpcyBwcm9iZWQgZm9yIHRoZSBmaXJzdCB7QGxpbmsgUkVTUE9OU0VfVEVYVF9GSUVMRFN9IGVudHJ5IHRoYXRcbiAqIGhvbGRzIGEgc3RyaW5nLCBjYXJyeWluZyBhbG9uZyBgc3RkZXJyYCwgYGV4aXRDb2RlYC9gZXhpdFN0YXR1c2AsIGFuZCB0aGVcbiAqIHR3by1yZWdpbWUgbWFya2VycyB3aGVuIHRoZSBlbnZlbG9wZSBoYXMgdGhlbSBcdTIwMTQgYHJhd091dHB1dFBhdGhgIHNldCAodGhlXG4gKiBpbmxpbmUgc3Rkb3V0IGlzIG9ubHkgYSBwcmV2aWV3KSBiZWNvbWVzIGB0cnVuY2F0ZWQ6IHRydWVgOyBgaW50ZXJydXB0ZWRgXG4gKiBvciBgdGltZWRPdXRBZnRlck1zYCAodGhlIGNvbW1hbmQgd2FzIGN1dCBvZmYgbWlkLXJ1bikgYmVjb21lc1xuICogYGludGVycnVwdGVkOiB0cnVlYCwgdGhlIGNvbXBsZXRlLXJlY29yZHMgcmVnaW1lIFx1MjAxNCB0aGUgc2FtZSBub3JtYWxpemF0aW9uXG4gKiB0aGUgQ2xhdWRlIGFkYXB0ZXIgYXBwbGllcyB0byBpdHMgQmFzaCBlbnZlbG9wZS4gUmV0dXJucyBgbnVsbGAgd2hlbiBub1xuICogdGV4dCBjYW4gYmUgcmVjb3ZlcmVkICh1bmtub3duIG9iamVjdCBzaGFwZSwgYG51bGxgLCBvciBhIG5vbi1zdHJpbmcvXG4gKiBub24tb2JqZWN0KSwgd2hpY2ggdGhlIGNhbGxlciB0cmVhdHMgYXMgYW4gKnVucmVjb2duaXplZCogXHUyMDE0IG5vdCAqZmFpbGVkKiBcdTIwMTRcbiAqIHJlc3BvbnNlLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTaGVsbFJlc3BvbnNlKHRvb2xSZXNwb25zZTogdW5rbm93bik6IE5vcm1hbGl6ZWRTaGVsbFJlc3BvbnNlIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnc3RyaW5nJykgcmV0dXJuIHsgc3Rkb3V0OiB0b29sUmVzcG9uc2UgfTtcbiAgaWYgKEFycmF5LmlzQXJyYXkodG9vbFJlc3BvbnNlKSkge1xuICAgIGNvbnN0IHRleHQ6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChjb25zdCBibG9jayBvZiB0b29sUmVzcG9uc2UpIHtcbiAgICAgIGlmIChibG9jayAhPT0gbnVsbCAmJiB0eXBlb2YgYmxvY2sgPT09ICdvYmplY3QnKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gKGJsb2NrIGFzIHsgdGV4dD86IHVua25vd24gfSkudGV4dDtcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHRleHQucHVzaCh2YWx1ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7IHN0ZG91dDogdGV4dC5qb2luKCcnKSB9O1xuICB9XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICBjb25zdCByZWNvcmQgPSB0b29sUmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgZm9yIChjb25zdCBmaWVsZCBvZiBSRVNQT05TRV9URVhUX0ZJRUxEUykge1xuICAgICAgY29uc3QgdmFsdWUgPSByZWNvcmRbZmllbGRdO1xuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGRvdXQ6IHZhbHVlLFxuICAgICAgICAgIHN0ZGVycjogdHlwZW9mIHJlY29yZC5zdGRlcnIgPT09ICdzdHJpbmcnID8gcmVjb3JkLnN0ZGVyciA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBleGl0U3RhdHVzOlxuICAgICAgICAgICAgdHlwZW9mIHJlY29yZC5leGl0Q29kZSA9PT0gJ251bWJlcidcbiAgICAgICAgICAgICAgPyByZWNvcmQuZXhpdENvZGVcbiAgICAgICAgICAgICAgOiB0eXBlb2YgcmVjb3JkLmV4aXRTdGF0dXMgPT09ICdudW1iZXInXG4gICAgICAgICAgICAgICAgPyByZWNvcmQuZXhpdFN0YXR1c1xuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgIHRydW5jYXRlZDogcmVjb3JkLnJhd091dHB1dFBhdGggIT09IHVuZGVmaW5lZCxcbiAgICAgICAgICBpbnRlcnJ1cHRlZDogcmVjb3JkLmludGVycnVwdGVkID09PSB0cnVlIHx8IHJlY29yZC50aW1lZE91dEFmdGVyTXMgIT09IHVuZGVmaW5lZFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBDbGFzc2lmeSBhbiBgYXBwbHlfcGF0Y2hgIGB0b29sX3Jlc3BvbnNlYCBmb3IgdGhlIHRvdWNoIGdhdGU6XG4gKlxuICogLSBgJ3N1Y2Nlc3MnYCBcdTIwMTQgdGV4dCB3YXMgcmVjb3ZlcmVkIGZyb20gYSBiYXJlIHN0cmluZyBvciBhIHRleHQtZmllbGRcbiAqICAgb2JqZWN0IGFuZCBjYXJyaWVzIHtAbGluayBBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWH0uXG4gKiAtIGAnZmFpbHVyZSdgIFx1MjAxNCB0ZXh0IHdhcyByZWNvdmVyZWQgZnJvbSBhIGJhcmUgc3RyaW5nIG9yIGEgdGV4dC1maWVsZFxuICogICBvYmplY3QgYnV0IGxhY2tzIHRoZSBoZWFkZXI6IGEgZ2VudWluZSByZWplY3Rpb24gb3IgZXJyb3IuIFRoZSBPTkxZXG4gKiAgIGNsYXNzaWZpY2F0aW9uIHRoYXQgc3VwcHJlc3NlcyB0aGUgdG91Y2guXG4gKiAtIGAndW5rbm93bidgIFx1MjAxNCBubyB0ZXh0IGNvdWxkIGJlIHJlY292ZXJlZCAodW5yZWNvZ25pemVkIHNoYXBlKSwgb3IgdGhlXG4gKiAgIHJlc3BvbnNlIGlzIGEgYmxvY2svdGV4dCBhcnJheS4gV2UgcHJvY2VlZCBkZWZlbnNpdmVseSBoZXJlIHJhdGhlciB0aGFuXG4gKiAgIHJpc2sgbWlzc2luZyBhIHJlYWwgZWRpdCdzIGhlYWwvc3VyZmFjZTsgQ29kZXggY29yZSBmaXJlcyBQb3N0VG9vbFVzZVxuICogICBvbmx5IG9uIHN1Y2Nlc3MsIHNvIHRoaXMgY2Fubm90IGhlYWwvc3VyZmFjZSBhIHBhdGNoIHRoYXQgbmV2ZXIgYXBwbGllZC5cbiAqXG4gKiBUaGUgYXJyYXkgY2hlY2sgcmVzdG9yZXMgdGhlIHByZS1ub3JtYWxpemVyIGNvbnRyYWN0OiB0aGUgYmFzZWxpbmVcbiAqIGBleHRyYWN0UmVzcG9uc2VUZXh0YCByZXR1cm5lZCBgbnVsbGAgZm9yIGV2ZXJ5IGFycmF5IHNoYXBlICh0ZXh0LWJsb2NrLFxuICogZW1wdHksIG5vbi10ZXh0KSwgc28gYXJyYXlzIGNsYXNzaWZpZWQgYCd1bmtub3duJ2AgYW5kIHByb2NlZWRlZCB3aXRoIGFcbiAqIHdhcm5pbmcuIGBub3JtYWxpemVTaGVsbFJlc3BvbnNlYCBkZWxpYmVyYXRlbHkgd2lkZW5lZCB0byBhcnJheXMgZm9yIHRoZVxuICogc2hlbGwtcGFyc2UgZXZpZGVuY2Ugc291cmNlLCBzbyBjbGFzc2lmaWNhdGlvbiByZWFkcyB0aGUgcmF3IGVudmVsb3BlIHRvXG4gKiBrZWVwIHRoZSBhcHBseV9wYXRjaCBnYXRlIGJlaGF2aW9yLWlkZW50aWNhbCBcdTIwMTQgYSBqb2luZWQgYXJyYXkgd2hvc2UgdGV4dFxuICogbWVyZWx5IGxhY2tzIHRoZSBzdWNjZXNzIGhlYWRlciBtdXN0IG5ldmVyIGJlIG1pc3Rha2VuIGZvciBhIGNvbmZpcm1lZFxuICogcmVqZWN0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2UodG9vbFJlc3BvbnNlOiB1bmtub3duKTogJ3N1Y2Nlc3MnIHwgJ2ZhaWx1cmUnIHwgJ3Vua25vd24nIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodG9vbFJlc3BvbnNlKSkgcmV0dXJuICd1bmtub3duJztcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVNoZWxsUmVzcG9uc2UodG9vbFJlc3BvbnNlKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gIHJldHVybiBub3JtYWxpemVkLnN0ZG91dC5zdGFydHNXaXRoKEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYKSA/ICdzdWNjZXNzJyA6ICdmYWlsdXJlJztcbn1cblxuLyoqIEEgcmVhZGVyIHRoYXQgYWx3YXlzIGRlY2xpbmVzLCBmb3JjaW5nIHRoZSBwYXJzZXIgdG8gd2hvbGUtZmlsZSBhbmNob3JzLiAqL1xuY29uc3Qgbm9SYW5nZVJlY292ZXJ5ID0gKCk6IG51bGwgPT4gbnVsbDtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMgPSBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMoKSxcbiAgbWVtb0ZhY3Rvcnk6IE1lbW9GYWN0b3J5ID0gY3JlYXRlRGlza01lbW9TdG9yZVxuKSB7XG4gIHJldHVybiBhc3luYyAoaW5wdXQ6IFBvc3RUb29sVXNlSW5wdXQsIGN0eDogSG9va0NvbnRleHQpID0+IHtcbiAgICBjb25zdCB0b29sX25hbWUgPSBpbnB1dC50b29sX25hbWU7XG4gICAgY29uc3QgY3dkID0gaW5wdXQuY3dkID8/ICcnO1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IGlucHV0LnNlc3Npb25faWQ7XG4gICAgY29uc3QgbWVtbyA9IG1lbW9GYWN0b3J5KGN0eC5sb2dnZXIpO1xuXG4gICAgLy8gU2hlbGwgdG91Y2g6IGV4dHJhY3QgdGhlIGNvbW1hbmQgZnJvbSB3aGljaGV2ZXIgZW52ZWxvcGUgc2hhcGUgdGhlIGhhcm5lc3NcbiAgICAvLyBkZWxpdmVycywgcGFyc2UsIGFuZCBydW4gZWFjaCByZXNvbHZlZCBzcGFuIHRocm91Z2ggdGhlIHNoYXJlZCB0b3VjaCBjb3JlLlxuICAgIC8vIFRoZSBicmFuY2ggYWxzbyBub3JtYWxpemVzIGB0b29sX3Jlc3BvbnNlYCB2aWEgYG5vcm1hbGl6ZVNoZWxsUmVzcG9uc2VgXG4gICAgLy8gYW5kIG1lcmdlcyBgcGFyc2VSZXNwb25zZWAncyBzcGFucyBpbiBhcyByZWFkIHRvdWNoZXMgKHRoZSB0b29sX3Jlc3BvbnNlXG4gICAgLy8gcGFzcyBiZWxvdykuXG4gICAgLy9cbiAgICAvLyAtIGBCYXNoYDogdGhlIGhhcm5lc3MtdW53cmFwcGVkIHNoYXBlIENvZGV4IFx1MjI2NTAuMTQ0IGFjdHVhbGx5IHNlbmRzIFx1MjAxNFxuICAgIC8vICAgYHRvb2xfaW5wdXQuY29tbWFuZGAgaXMgdGhlIHJhdyBzaGVsbCBjb21tYW5kIHN0cmluZyAoc2FtZSBzaGFwZSB0aGVcbiAgICAvLyAgIENsYXVkZSBhZGFwdGVyIGhhbmRsZXMpLlxuICAgIC8vIC0gYGV4ZWNfY29tbWFuZGA6IGNsYXNzaWMgZnVuY3Rpb25fY2FsbCBlbnZlbG9wZSAoY2xpIFx1MjI2NDAuMTMwKSBcdTIwMTRcbiAgICAvLyAgIGB0b29sX2lucHV0LmFyZ3VtZW50c2AgaXMgYSBKU09OIHN0cmluZyB3aXRoIGEgYGNtZGAgZmllbGQuXG4gICAgLy8gLSBgZXhlY2A6IGRpcmVjdCBjb2RlLW1vZGUgZW52ZWxvcGUgKG1heSBzaGlwIGluIGEgZnV0dXJlIENMSSkgXHUyMDE0XG4gICAgLy8gICBgdG9vbF9pbnB1dC5pbnB1dGAgaXMgSlMgc291cmNlIHdyYXBwaW5nIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYC5cbiAgICAvL1xuICAgIC8vIEEgY29tbWFuZCB3aXRoIG5vIHJlY29nbml6ZWQgaWRpb20geWllbGRzIG5vIGJsb2NrcyBhbmQgcmV0dXJucyB1bmRlZmluZWQgXHUyMDE0XG4gICAgLy8gZmFpbC1vcGVuLCBzYW1lIGFzIHRoZSBhcHBseV9wYXRjaCBwYXRoIGJlbG93LlxuICAgIGlmICh0b29sX25hbWUgPT09ICdCYXNoJyB8fCB0b29sX25hbWUgPT09ICdleGVjX2NvbW1hbmQnIHx8IHRvb2xfbmFtZSA9PT0gJ2V4ZWMnKSB7XG4gICAgICBsZXQgY29tbWFuZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICBsZXQgd29ya2Rpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICBpZiAodG9vbF9uYW1lID09PSAnQmFzaCcpIHtcbiAgICAgICAgLy8gVGhlIGhhcm5lc3MgYWxyZWFkeSB1bndyYXBwZWQgdGhlIGNvZGUtbW9kZSBlbnZlbG9wZSBcdTIwMTQgdGhlIGNvbW1hbmQgaXNcbiAgICAgICAgLy8gaW4gYHRvb2xfaW5wdXQuY29tbWFuZGAsIGV4YWN0bHkgYXMgdGhlIENsYXVkZSBhZGFwdGVyIHJlY2VpdmVzIGl0LlxuICAgICAgICBjb25zdCByYXcgPSAoaW5wdXQudG9vbF9pbnB1dCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwpPy5jb21tYW5kO1xuICAgICAgICBjb21tYW5kID0gdHlwZW9mIHJhdyA9PT0gJ3N0cmluZycgPyByYXcgOiBudWxsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVGhlIGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgZW52ZWxvcGUgY2FycmllcyBgd29ya2RpcmAgYmVzaWRlIGBjbWRgXG4gICAgICAgIC8vIChwbGFuIFx1MDBBNzgpIFx1MjAxNCB0aHJlYWQgaXQgdGhyb3VnaCBsaWtlIHRoZSBjb2RlLW1vZGUgZW52ZWxvcGUgYmVsb3cuXG4gICAgICAgIGNvbnN0IGNsYXNzaWMgPSBuYXJyb3dFeGVjQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICAgICAgY29tbWFuZCA9IGNsYXNzaWM/LmNtZCA/PyBudWxsO1xuICAgICAgICB3b3JrZGlyID0gY2xhc3NpYz8ud29ya2RpciA/PyBudWxsO1xuICAgICAgfVxuICAgICAgaWYgKGNvbW1hbmQgPT09IG51bGwgJiYgdG9vbF9uYW1lID09PSAnZXhlYycpIHtcbiAgICAgICAgLy8gQ29kZS1tb2RlIGBleGVjYCB3cmFwcyB0aGUgc2FtZSBjYWxsIGluIEpTIHNvdXJjZS4gQSBtYXRjaGVkIGNhbGxcbiAgICAgICAgLy8gd2hvc2UgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZCAodmFyaWFibGUvdGVtcGxhdGUtYnVpbHQgY29tbWFuZClcbiAgICAgICAgLy8gaXMgYSBkaXN0aW5jdCBvdXRjb21lIGZyb20gXCJub3QgYSBjb2RlLW1vZGUgZW52ZWxvcGUgYXQgYWxsXCI6IHdhcm4gc29cbiAgICAgICAgLy8gdGhlIGJsaW5kIHNwb3QgaXMgdmlzaWJsZSBpbnN0ZWFkIG9mIHNpbGVudGx5IGNvbmZsYXRlZCB3aXRoIG5vIG1hdGNoLlxuICAgICAgICBjb25zdCBjb2RlTW9kZSA9IG5hcnJvd0NvZGVNb2RlRXhlYyhpbnB1dC50b29sX2lucHV0KTtcbiAgICAgICAgaWYgKGNvZGVNb2RlLm1hdGNoZWQgJiYgY29kZU1vZGUuY21kID09PSBudWxsKSB7XG4gICAgICAgICAgY3R4LmxvZ2dlci53YXJuKFxuICAgICAgICAgICAgJ0NvZGV4IGNvZGUtbW9kZSBleGVjIGVudmVsb3BlIG1hdGNoZWQgYnV0IGl0cyBleGVjX2NvbW1hbmQgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZDsgbm8gc2hlbGwgdG91Y2gnLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0b29sSW5wdXRUeXBlOiB0eXBlb2YgaW5wdXQudG9vbF9pbnB1dCxcbiAgICAgICAgICAgICAgdG9vbElucHV0S2V5czpcbiAgICAgICAgICAgICAgICBpbnB1dC50b29sX2lucHV0ICE9PSBudWxsICYmIHR5cGVvZiBpbnB1dC50b29sX2lucHV0ID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX2lucHV0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGNvbW1hbmQgPSBjb2RlTW9kZS5jbWQ7XG4gICAgICAgIHdvcmtkaXIgPSBjb2RlTW9kZS53b3JrZGlyO1xuICAgICAgfVxuICAgICAgaWYgKCFjb21tYW5kKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICAvLyBQbGFuIFx1MDBBNzg6IGEgd29ya2RpciBwcmVzZW50IGFuZCBmcmVlIG9mIGAkYC9iYWNrdGljayBhYnNvbHV0aXplcyBhZ2FpbnN0XG4gICAgICAvLyB0aGUgZW52ZWxvcGUncyBvd24gYGlucHV0LmN3ZGAgXHUyMDE0IHRoZSBzaGVsbCB0b29sIHJlc29sdmVzIGEgcmVsYXRpdmVcbiAgICAgIC8vIHdvcmtkaXIgYWdhaW5zdCB0aGF0IHNhbWUgYmFzZSBcdTIwMTQgYW5kIGlzIHRoZSBzaW5nbGUgZnJhbWUgZm9yIHRoZSB3aG9sZVxuICAgICAgLy8gdG91Y2ggKHBhcnNlIGJhc2UsIGFic29sdXRpemF0aW9uLCBzY29wZSBjaGVjaywgYW5kIHRoZSB0b3VjaCByZWNvcmQnc1xuICAgICAgLy8gY3dkLCB3aGljaCB0aGUgZXhlY3V0b3JzIGRyaXZlIHRoZWlyIGdpdCBzcGFuIHJ1bnMgZnJvbSkuIEFcbiAgICAgIC8vIHRlbXBsYXRlLWxpdGVyYWwgd29ya2RpciAoY29udGFpbmluZyBgJGAvYmFja3RpY2spIGlzIHVucmVzb2x2YWJsZSBhbmRcbiAgICAgIC8vIGZhbGxzIGJhY2sgdG8gaG9vayBgY3dkYC5cbiAgICAgIGNvbnN0IGVmZmVjdGl2ZUN3ZCA9IHdvcmtkaXIgIT09IG51bGwgJiYgIS9bYCRdLy50ZXN0KHdvcmtkaXIpID8gcmVzb2x2ZVBhdGgoY3dkLCB3b3JrZGlyKSA6IGN3ZDtcblxuICAgICAgY29uc3QgbWF0Y2hlcyA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIHsgY3dkOiBlZmZlY3RpdmVDd2QgfSk7XG4gICAgICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoIG9mIG1hdGNoZXMpIHtcbiAgICAgICAgaWYgKG1hdGNoLnN0YXR1cyAhPT0gJ3Jlc29sdmVkJykgY29udGludWU7XG4gICAgICAgIGNvbnN0IHNwYW4gPSBtYXRjaC5zcGFuO1xuICAgICAgICBjb25zdCBhYnNQYXRoID0gYWJzcGF0aEFnYWluc3QoZWZmZWN0aXZlQ3dkLCBzcGFuLmFic29sdXRlUGF0aCk7XG4gICAgICAgIGNvbnN0IHNjb3BlID0gcmVzb2x2ZVRvdWNoU2NvcGUoZWZmZWN0aXZlQ3dkLCBhYnNQYXRoKTtcbiAgICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICAgIGxldCB0b3VjaElucHV0OiB7XG4gICAgICAgICAga2luZDogJ3JlYWQnIHwgJ3dyaXRlJztcbiAgICAgICAgICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgICAgICAgICBjd2Q6IHN0cmluZztcbiAgICAgICAgICBmaWxlUGF0aDogc3RyaW5nO1xuICAgICAgICAgIG9mZnNldD86IG51bWJlcjtcbiAgICAgICAgICBsaW1pdD86IG51bWJlcjtcbiAgICAgICAgICB3cml0dGVuPzogc3RyaW5nO1xuICAgICAgICB9O1xuICAgICAgICBpZiAobWF0Y2guaWRpb20gPT09ICdoZXJlZG9jLXdyaXRlJykge1xuICAgICAgICAgIC8vIGA+YCBvdmVyd3JpdGVzOiB3aG9sZS1maWxlIHNjb3BlIHNvIGRlbGV0ZWQgc3BhbnMgYmV5b25kIHRoZSBuZXdcbiAgICAgICAgICAvLyBFT0YgYXJlIHN1cmZhY2VkLiBgPj5gIGFwcGVuZHM6IG5hcnJvdyB0byB0aGUgYXBwZW5kZWQgbGluZXMuXG4gICAgICAgICAgY29uc3Qgd3JpdHRlbiA9IHNwYW4ucmVkaXJlY3QgPT09ICc+JyA/ICcnIDogKHNwYW4uYm9keSA/PyAnJyk7XG4gICAgICAgICAgdG91Y2hJbnB1dCA9IHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2Q6IGVmZmVjdGl2ZUN3ZCwgZmlsZVBhdGg6IGFic1BhdGgsIHdyaXR0ZW4gfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0b3VjaElucHV0ID0ge1xuICAgICAgICAgICAga2luZDogJ3JlYWQnLFxuICAgICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICAgICAgY3dkOiBlZmZlY3RpdmVDd2QsXG4gICAgICAgICAgICBmaWxlUGF0aDogYWJzUGF0aCxcbiAgICAgICAgICAgIG9mZnNldDogc3Bhbi5saW5lU3RhcnQsXG4gICAgICAgICAgICBsaW1pdDogc3Bhbi5saW5lRW5kIC0gc3Bhbi5saW5lU3RhcnQgKyAxXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2sodG91Y2hJbnB1dCBhcyBUb3VjaElucHV0LCBleGVjdXRvcnMsIG1lbW8pO1xuICAgICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgICAgfVxuICAgICAgLy8gVGhlIHRvb2xfcmVzcG9uc2UgaXMgYSBzZWNvbmQgZXZpZGVuY2Ugc291cmNlIGZvciB0aGUgc2hlbGw6XG4gICAgICAvLyByZXNwb25zZS1kZXJpdmFibGUgY29tbWFuZHMgKGdyZXAvcmlwZ3JlcCB3aXRoIG51bWJlcmVkIG91dHB1dCxcbiAgICAgIC8vIGdpdCBkaWZmL3Nob3cvbG9nIC1wLCBnaXQgYmxhbWUgLUwpIGxvY2F0ZSB0aGVpciByZWFkIHdpbmRvd3MgaW4gdGhlXG4gICAgICAvLyBvdXRwdXQsIHdoaWNoIHRoZSBjb21tYW5kIHRleHQgYWxvbmUgY2Fubm90LiBOb3JtYWxpemUgdGhlIGVudmVsb3BlLFxuICAgICAgLy8gbWVyZ2UgaXRzIHNwYW5zIHdpdGggdGhlIGNvbW1hbmQtZGVyaXZlZCBvbmVzLCBhbmQgcnVuIGVhY2ggYXMgYVxuICAgICAgLy8gcmVhZCB0b3VjaDsgdGhlIG1lbW8gZGVkdXBlcyBkdXBsaWNhdGUgc3VyZmFjZXMgYWNyb3NzIHRoZSBzb3VyY2VzLlxuICAgICAgLy8gQW4gdW5yZWNvZ25pemVkIGVudmVsb3BlIGRlZ3JhZGVzIHRvIGNvbW1hbmQtb25seSBwYXJzaW5nLlxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBub3JtYWxpemVTaGVsbFJlc3BvbnNlKGlucHV0LnRvb2xfcmVzcG9uc2UpO1xuICAgICAgaWYgKHJlc3BvbnNlICE9PSBudWxsKSB7XG4gICAgICAgIGZvciAoY29uc3Qgc3BhbiBvZiBwYXJzZVJlc3BvbnNlKHsgY29tbWFuZCwgY3dkLCAuLi5yZXNwb25zZSB9KSkge1xuICAgICAgICAgIGNvbnN0IGFic1BhdGggPSBhYnNwYXRoQWdhaW5zdChjd2QsIHNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICAgICAgICBjb25zdCBzY29wZSA9IHJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgYWJzUGF0aCk7XG4gICAgICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICAgICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuVG91Y2hIb29rKFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBraW5kOiAncmVhZCcsXG4gICAgICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICAgICAgY3dkLFxuICAgICAgICAgICAgICBmaWxlUGF0aDogYWJzUGF0aCxcbiAgICAgICAgICAgICAgb2Zmc2V0OiBzcGFuLmxpbmVTdGFydCxcbiAgICAgICAgICAgICAgbGltaXQ6IHNwYW4ubGluZUVuZCAtIHNwYW4ubGluZVN0YXJ0ICsgMVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGV4ZWN1dG9ycyxcbiAgICAgICAgICAgIG1lbW9cbiAgICAgICAgICApO1xuICAgICAgICAgIGlmIChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIGJsb2Nrcy5wdXNoKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgICByZXR1cm4gcG9zdFRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQsIHN5c3RlbU1lc3NhZ2U6IGNvbWJpbmVkIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmQgPSBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIC8vIFN1cHByZXNzIG9ubHkgYSAqY29uZmlybWVkKiBub24tc3VjY2Vzcy4gQW4gdW5yZWNvZ25pemVkIHJlc3BvbnNlIHNoYXBlXG4gICAgLy8gcHJvY2VlZHMgKHdpdGggYSB3YXJuaW5nKSByYXRoZXIgdGhhbiByaXNrIHNraXBwaW5nIGEgcmVhbCBlZGl0J3MgdG91Y2guXG4gICAgY29uc3QgY2xhc3NpZmljYXRpb24gPSBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZShpbnB1dC50b29sX3Jlc3BvbnNlKTtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICdmYWlsdXJlJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICd1bmtub3duJykge1xuICAgICAgY3R4LmxvZ2dlci53YXJuKCdDb2RleCBhcHBseV9wYXRjaCB0b29sX3Jlc3BvbnNlIHNoYXBlIHVucmVjb2duaXplZDsgcnVubmluZyB0b3VjaCBkZWZlbnNpdmVseScsIHtcbiAgICAgICAgdG9vbFJlc3BvbnNlVHlwZTogdHlwZW9mIGlucHV0LnRvb2xfcmVzcG9uc2UsXG4gICAgICAgIHRvb2xSZXNwb25zZUtleXM6XG4gICAgICAgICAgaW5wdXQudG9vbF9yZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgaW5wdXQudG9vbF9yZXNwb25zZSA9PT0gJ29iamVjdCdcbiAgICAgICAgICAgID8gT2JqZWN0LmtleXMoaW5wdXQudG9vbF9yZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBPbmUgZW52ZWxvcGUgbWF5IHRvdWNoIHNldmVyYWwgZmlsZXM7IGZvcmNlIHdob2xlLWZpbGUgYW5jaG9ycyAoQ29kZXggbmV2ZXJcbiAgICAvLyByZWNvdmVycyBhIHBvc3QtZWRpdCByYW5nZSkgYW5kIHJ1biB0aGUgc2hhcmVkIHRvdWNoIGNvcmUgcGVyIHRvdWNoZWQgZmlsZS5cbiAgICAvLyBUaGUgc2hhcmVkIG1lbW8gZGVkdXBlcyBzcGFuIHJlbmRlcnMgYWNyb3NzIGFuY2hvcnMgYW5kIHRoZSBzZXNzaW9uLlxuICAgIGNvbnN0IGFuY2hvcnMgPSBwYXJzZUFwcGx5UGF0Y2goY29tbWFuZCwgbm9SYW5nZVJlY292ZXJ5KTtcbiAgICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgICAgY29uc3QgYWJzUGF0aCA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgYW5jaG9yLnBhdGgpO1xuICAgICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2soXG4gICAgICAgIHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2QsIGZpbGVQYXRoOiBhYnNQYXRoLCB3cml0dGVuOiAnJyB9LFxuICAgICAgICBleGVjdXRvcnMsXG4gICAgICAgIG1lbW9cbiAgICAgICk7XG4gICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgIH1cblxuICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNvbWJpbmVkID0gYmxvY2tzLmpvaW4oJycpO1xuICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiBjb21iaW5lZCwgc3lzdGVtTWVzc2FnZTogY29tYmluZWQgfSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHBvc3RUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdhcHBseV9wYXRjaHxleGVjX2NvbW1hbmR8ZXhlY3xCYXNoJywgdGltZW91dDogMTBfMDAwIH0sIGNyZWF0ZUhhbmRsZXIoKSk7XG4iLCAiZXhwb3J0IGNvbnN0IFBBQ0tBR0VfTkFNRSA9IFwiQGdvb2Rmb290L2NvZGV4LWhvb2tzXCI7XG5leHBvcnQgY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gNjAwXzAwMDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1NUQVRVU19NRVNTQUdFID0gdW5kZWZpbmVkO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfRVNCVUlMRF9MT0FERVJTID0ge1xuICAgIFwiLm1kXCI6IFwidGV4dFwiLFxufTtcbmV4cG9ydCBjb25zdCBIT09LX0ZBQ1RPUllfVE9fRVZFTlQgPSB7XG4gICAgcHJlVG9vbFVzZUhvb2s6IFwiUHJlVG9vbFVzZVwiLFxuICAgIHBvc3RUb29sVXNlSG9vazogXCJQb3N0VG9vbFVzZVwiLFxuICAgIHBlcm1pc3Npb25SZXF1ZXN0SG9vazogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIHVzZXJQcm9tcHRTdWJtaXRIb29rOiBcIlVzZXJQcm9tcHRTdWJtaXRcIixcbiAgICBzZXNzaW9uU3RhcnRIb29rOiBcIlNlc3Npb25TdGFydFwiLFxuICAgIHN1YmFnZW50U3RhcnRIb29rOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICBzdG9wSG9vazogXCJTdG9wXCIsXG4gICAgc3ViYWdlbnRTdG9wSG9vazogXCJTdWJhZ2VudFN0b3BcIixcbiAgICBwcmVDb21wYWN0SG9vazogXCJQcmVDb21wYWN0XCIsXG4gICAgcG9zdENvbXBhY3RIb29rOiBcIlBvc3RDb21wYWN0XCIsXG59O1xuZXhwb3J0IGNvbnN0IEVWRU5UU19XSVRIX01BVENIRVIgPSBuZXcgU2V0KFtcbiAgICBcIlByZVRvb2xVc2VcIixcbiAgICBcIlBvc3RUb29sVXNlXCIsXG4gICAgXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0b3BcIixcbiAgICBcIlByZUNvbXBhY3RcIixcbiAgICBcIlBvc3RDb21wYWN0XCIsXG5dKTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9URVhUX09VVFBVVCA9IG5ldyBTZXQoW1wiU2Vzc2lvblN0YXJ0XCIsIFwiVXNlclByb21wdFN1Ym1pdFwiLCBcIlN1YmFnZW50U3RhcnRcIl0pO1xuIiwgImZ1bmN0aW9uIGF0dGFjaE1ldGFkYXRhKGhvb2tFdmVudE5hbWUsIGNvbmZpZywgaGFuZGxlcikge1xuICAgIGNvbnN0IGhvb2sgPSBoYW5kbGVyO1xuICAgIGhvb2suaG9va0V2ZW50TmFtZSA9IGhvb2tFdmVudE5hbWU7XG4gICAgaG9vay50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXQ7XG4gICAgaG9vay5zdGF0dXNNZXNzYWdlID0gY29uZmlnLnN0YXR1c01lc3NhZ2U7XG4gICAgaWYgKFwibWF0Y2hlclwiIGluIGNvbmZpZyAmJiB0eXBlb2YgY29uZmlnLm1hdGNoZXIgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaG9vay5tYXRjaGVyID0gY29uZmlnLm1hdGNoZXI7XG4gICAgfVxuICAgIHJldHVybiBob29rO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZVRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdFRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUGVybWlzc2lvblJlcXVlc3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJVc2VyUHJvbXB0U3VibWl0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTZXNzaW9uU3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdWJhZ2VudFN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdG9wXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUHJlQ29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQb3N0Q29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuIiwgImltcG9ydCB7IGNsb3NlU3luYywgZXhpc3RzU3luYywgbWtkaXJTeW5jLCBvcGVuU3luYywgd3JpdGVTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5jb25zdCBERUZBVUxUX0xPR19FTlZfVkFSID0gXCJDT0RFWF9IT09LU19MT0dfRklMRVwiO1xuZXhwb3J0IGNsYXNzIExvZ2dlciB7XG4gICAgaGFuZGxlcnMgPSBuZXcgTWFwKCk7XG4gICAgZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgbG9nRmlsZUZkID0gbnVsbDtcbiAgICBsb2dGaWxlUGF0aCA9IG51bGw7XG4gICAgY3VycmVudEhvb2tUeXBlO1xuICAgIGN1cnJlbnRJbnB1dDtcbiAgICBjb25zdHJ1Y3Rvcihjb25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ0ZpbGVQYXRoID0gY29uZmlnLmxvZ0ZpbGVQYXRoID8/IHByb2Nlc3MuZW52W2NvbmZpZy5sb2dFbnZWYXIgPz8gREVGQVVMVF9MT0dfRU5WX1ZBUl0gPz8gbnVsbDtcbiAgICB9XG4gICAgc2V0Q29udGV4dChob29rVHlwZSwgaW5wdXQpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSBob29rVHlwZTtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSBpbnB1dDtcbiAgICB9XG4gICAgY2xlYXJDb250ZXh0KCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIG9uKGxldmVsLCBoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5oYW5kbGVycy5nZXQobGV2ZWwpID8/IG5ldyBTZXQoKTtcbiAgICAgICAgZXhpc3RpbmcuYWRkKGhhbmRsZXIpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLnNldChsZXZlbCwgZXhpc3RpbmcpO1xuICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgZXhpc3RpbmcuZGVsZXRlKGhhbmRsZXIpO1xuICAgICAgICAgICAgaWYgKGV4aXN0aW5nLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmhhbmRsZXJzLmRlbGV0ZShsZXZlbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxuICAgIGRlYnVnKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZGVidWdcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGluZm8obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJpbmZvXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICB3YXJuKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwid2FyblwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgZXJyb3IobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgbG9nRXJyb3IoZXJyb3IsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgYCR7bWVzc2FnZX06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIGNvbnRleHQpO1xuICAgIH1cbiAgICBjbG9zZSgpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbG9zZVN5bmModGhpcy5sb2dGaWxlRmQpO1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVtaXQobGV2ZWwsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSB7XG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIGxldmVsLFxuICAgICAgICAgICAgaG9va1R5cGU6IHRoaXMuY3VycmVudEhvb2tUeXBlLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIC4uLih0aGlzLmN1cnJlbnRJbnB1dCAhPT0gdW5kZWZpbmVkID8geyBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQgfSA6IHt9KSxcbiAgICAgICAgICAgIC4uLihjb250ZXh0ICE9PSB1bmRlZmluZWQgPyB7IGNvbnRleHQgfSA6IHt9KSxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy53cml0ZVRvRmlsZShldmVudCk7XG4gICAgICAgIHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKT8uZm9yRWFjaCgoaGFuZGxlcikgPT4ge1xuICAgICAgICAgICAgaGFuZGxlcihldmVudCk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICB3cml0ZVRvRmlsZShldmVudCkge1xuICAgICAgICBpZiAodGhpcy5sb2dGaWxlUGF0aCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5maWxlSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IGxvZ0RpciA9IGRpcm5hbWUodGhpcy5sb2dGaWxlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMobG9nRGlyKSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyhsb2dEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBvcGVuU3luYyh0aGlzLmxvZ0ZpbGVQYXRoLCBcImFcIik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB3cml0ZVN5bmModGhpcy5sb2dGaWxlRmQsIGAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5gKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmV4cG9ydCBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKCk7XG4iLCAiZXhwb3J0IGNvbnN0IEVYSVRfQ09ERVMgPSB7XG4gICAgU1VDQ0VTUzogMCxcbiAgICBFUlJPUjogMSxcbiAgICBCTE9DSzogMixcbn07XG5leHBvcnQgY2xhc3MgQmxvY2tFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICByZWFzb247XG4gICAgY29uc3RydWN0b3IocmVhc29uKSB7XG4gICAgICAgIHN1cGVyKHJlYXNvbik7XG4gICAgICAgIHRoaXMubmFtZSA9IFwiQmxvY2tFcnJvclwiO1xuICAgICAgICB0aGlzLnJlYXNvbiA9IHJlYXNvbjtcbiAgICB9XG59XG5mdW5jdGlvbiBvbWl0VW5kZWZpbmVkKHZhbHVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh2YWx1ZSkuZmlsdGVyKChbLCBlbnRyeV0pID0+IGVudHJ5ICE9PSB1bmRlZmluZWQpKTtcbn1cbmZ1bmN0aW9uIGJ1aWxkT3V0cHV0KHR5cGUsIHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgX3R5cGU6IHR5cGUsXG4gICAgICAgIHN0ZG91dDogb21pdFVuZGVmaW5lZChzdGRvdXQpLFxuICAgICAgICAuLi4oc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZGVyciB9IDoge30pLFxuICAgIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmF3T3V0cHV0KHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUmF3XCIsIHN0ZG91dCwgc3RkZXJyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnVwZGF0ZWRJbnB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlByZVRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbixcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24sXG4gICAgICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlTGVnYWN5QmxvY2tPdXRwdXQob3B0aW9ucykge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQb3N0VG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICB1cGRhdGVkTUNQVG9vbE91dHB1dDogb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdFRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KG9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWNpc2lvbiA9IG9taXRVbmRlZmluZWQoe1xuICAgICAgICBiZWhhdmlvcjogb3B0aW9ucy5iZWhhdmlvcixcbiAgICAgICAgbWVzc2FnZTogb3B0aW9ucy5tZXNzYWdlLFxuICAgICAgICBpbnRlcnJ1cHQ6IG9wdGlvbnMuaW50ZXJydXB0LFxuICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB1cGRhdGVkUGVybWlzc2lvbnM6IG9wdGlvbnMudXBkYXRlZFBlcm1pc3Npb25zLFxuICAgIH0pO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IHtcbiAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgICAgICBkZWNpc2lvbixcbiAgICB9O1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJVc2VyUHJvbXB0U3VibWl0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTZXNzaW9uU3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlNlc3Npb25TdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0Q29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG4iLCAiaW1wb3J0IHsgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgfSBmcm9tIFwiLi9jb25zdGFudHMuanNcIjtcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gXCIuL2xvZ2dlci5qc1wiO1xuaW1wb3J0IHsgQmxvY2tFcnJvciwgRVhJVF9DT0RFUywgc2Vzc2lvblN0YXJ0T3V0cHV0LCBzdWJhZ2VudFN0YXJ0T3V0cHV0LCB1c2VyUHJvbXB0U3VibWl0T3V0cHV0LCB9IGZyb20gXCIuL291dHB1dHMuanNcIjtcbmFzeW5jIGZ1bmN0aW9uIHJlYWRTdGRpbigpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCBjaHVua3MgPSBbXTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5zZXRFbmNvZGluZyhcInV0Zi04XCIpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IGNodW5rcy5wdXNoKGNodW5rKSk7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJlbmRcIiwgKCkgPT4gcmVzb2x2ZShjaHVua3Muam9pbihcIlwiKSkpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZXJyb3JcIiwgcmVqZWN0KTtcbiAgICB9KTtcbn1cbmZ1bmN0aW9uIHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpIHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShzdGRpbkNvbnRlbnQpO1xufVxuZnVuY3Rpb24gd3JpdGVTdGRvdXQob3V0cHV0KSB7XG4gICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoSlNPTi5zdHJpbmdpZnkob3V0cHV0LnN0ZG91dCkpO1xufVxuZnVuY3Rpb24gbm9ybWFsaXplU3RyaW5nT3V0cHV0KGhvb2tFdmVudE5hbWUsIHJlc3VsdCkge1xuICAgIGlmICghRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQuaGFzKGhvb2tFdmVudE5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtob29rRXZlbnROYW1lfSBob29rcyBjYW5ub3QgcmV0dXJuIHBsYWluIHRleHRgKTtcbiAgICB9XG4gICAgaWYgKGhvb2tFdmVudE5hbWUgPT09IFwiU2Vzc2lvblN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlN1YmFnZW50U3RhcnRcIikge1xuICAgICAgICByZXR1cm4gc3ViYWdlbnRTdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIHJldHVybiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0VG9Ib29rT3V0cHV0KG91dHB1dCkge1xuICAgIHJldHVybiBvdXRwdXQuc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCwgc3RkZXJyOiBvdXRwdXQuc3RkZXJyIH0gOiB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCB9O1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGUoaG9va0ZuKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RkaW5Db250ZW50ID0gYXdhaXQgcmVhZFN0ZGluKCk7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcGFyc2VTdGRpbklucHV0KHN0ZGluQ29udGVudCk7XG4gICAgICAgIGxvZ2dlci5zZXRDb250ZXh0KGhvb2tGbi5ob29rRXZlbnROYW1lLCBpbnB1dCk7XG4gICAgICAgIGNvbnN0IGNvbnRleHQgPSB7IGxvZ2dlciB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBob29rRm4oaW5wdXQsIGNvbnRleHQpO1xuICAgICAgICBsZXQgb3V0cHV0ID0geyBzdGRvdXQ6IHt9IH07XG4gICAgICAgIGlmICh0eXBlb2YgcmVzdWx0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRm4uaG9va0V2ZW50TmFtZSwgcmVzdWx0KSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG91dHB1dCA9IGNvbnZlcnRUb0hvb2tPdXRwdXQocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgICB3cml0ZVN0ZG91dChvdXRwdXQpO1xuICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5TVUNDRVNTKTtcbiAgICB9XG4gICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJsb2NrRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnJlYXNvbn1cXG5gKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkJMT0NLKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3Iuc3RhY2sgPz8gZXJyb3IubWVzc2FnZX1cXG5gKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke1N0cmluZyhlcnJvcil9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuRVJST1IpO1xuICAgIH1cbiAgICBmaW5hbGx5IHtcbiAgICAgICAgbG9nZ2VyLmNsZWFyQ29udGV4dCgpO1xuICAgICAgICBsb2dnZXIuY2xvc2UoKTtcbiAgICB9XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgaGVscGVycyB1c2VkIGJ5IG11bHRpcGxlIGFnZW50LWhvb2tzIGVudHJ5IHBvaW50cy5cbiAqXG4gKiBFeHRyYWN0ZWQgZnJvbSBwcmUtdG9vbC11c2UudHMgc28gdGhhdCB0aGUgdXBjb21pbmcgU3RvcCBob29rIChhbmQgYW55XG4gKiBmdXR1cmUgaG9va3MpIGNhbiBpbXBvcnQgcGF0aCB1dGlsaXRpZXMsIHJhbmdlIGhlbHBlcnMsIGFuZCB0aGVcbiAqIHNhbml0aXplU2Vzc2lvbklkL2Zvcm1hdEFuY2hvciBmdW5jdGlvbnMgd2l0aG91dCBkZXBlbmRpbmcgb24gdGhlXG4gKiBQcmVUb29sVXNlLXNwZWNpZmljIG1vZHVsZS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGF0aCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG5mdW5jdGlvbiBpc0Fic29sdXRlUG9zaXgocDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBwLnN0YXJ0c1dpdGgoJy8nKSB8fCAvXltBLVphLXpdOlxcLy8udGVzdChwKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFic3BhdGhBZ2FpbnN0KGJhc2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0ID0gdG9Qb3NpeCh0YXJnZXQpO1xuICBpZiAoaXNBYnNvbHV0ZVBvc2l4KHQpKSByZXR1cm4gdDtcbiAgY29uc3QgYiA9IHRvUG9zaXgoYmFzZSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiBgJHtifS8ke3R9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZXBvUm9vdChkaXI6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFkaXIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIGRpciwgJ3Jldi1wYXJzZScsICctLXNob3ctdG9wbGV2ZWwnXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IG91dC50cmltKCk7XG4gICAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRvUG9zaXgodHJpbW1lZCkgOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGlzIGV4Y2x1ZGVkIGJ5IGdpdCdzIGlnbm9yZSBydWxlc1xuICogKC5naXRpZ25vcmUsIC5naXQvaW5mby9leGNsdWRlLCBjb3JlLmV4Y2x1ZGVzRmlsZSkuIFVzZWQgdG8ga2VlcCBpZ25vcmVkXG4gKiBmaWxlcyBcdTIwMTQgYnVpbGQgb3V0cHV0LCBjYWNoZXMsIGxvZ3MgXHUyMDE0IG91dCBvZiB0b3VjaCB0cmFja2luZyBlbnRpcmVseSwgc29cbiAqIHRoZSB0b3VjaCBob29rIG5ldmVyIHJlcG9ydHMgcmVhZHMsIHdyaXRlcywgb3IgdW5jb3ZlcmVkIHdyaXRlcyBvbiB0aGVtLlxuICpcbiAqIGBnaXQgY2hlY2staWdub3JlIC1xIDxwYXRoPmAgZXhpdHMgMCB3aGVuIHRoZSBwYXRoIGlzIGlnbm9yZWQsIDEgd2hlbiBpdCBpc1xuICogbm90LCBhbmQgMTI4IG9uIGVycm9yLiBleGVjRmlsZVN5bmMgdGhyb3dzIG9uIGFueSBub24temVybyBleGl0LCBzbyBhIGNsZWFuXG4gKiByZXR1cm4gbWVhbnMgXCJpZ25vcmVkXCIuIEEgc3RhdHVzLTEgdGhyb3cgaXMgdGhlIGV4cGVjdGVkIFwibm90IGlnbm9yZWRcIlxuICogc2lnbmFsOyBhbnkgb3RoZXIgZmFpbHVyZSBpcyBhbiB1bnJlbGlhYmxlIGFuc3dlciwgc28gd2UgcmVwb3J0IGBmYWxzZWBcbiAqIChkbyBub3QgZHJvcCB0aGUgdG91Y2gpIHJhdGhlciB0aGFuIHNpbGVudGx5IGhpZGluZyBhIHRyYWNrZWQgZmlsZS5cbiAqL1xuLyoqXG4gKiBUaGUgZGVmYXVsdCBzcGFuIHJvb3QgZGlyZWN0b3J5LCByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290LCB1c2VkIHdoZW4gbm9cbiAqIGVudmlyb25tZW50IHZhcmlhYmxlIG9yIGdpdCBjb25maWcgb3ZlcnJpZGVzIHRoZSBsb2NhdGlvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IFNQQU5fUk9PVCA9ICcuc3Bhbic7XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgc3BhbiByb290IGRpcmVjdG9yeSBmb3IgYSBnaXZlbiByZXBvLCBtaXJyb3JpbmcgdGhlIFJ1c3QgQ0xJXG4gKiBwcmVjZWRlbmNlIChtaW51cyB0aGUgLS1zcGFuLWRpciBDTEkgZmxhZywgd2hpY2ggaXMgaW52aXNpYmxlIHRvIGZpbGUtd3JpdGVcbiAqIGhvb2tzKTpcbiAqICAgMS4gR0lUX1NQQU5fRElSIGVudmlyb25tZW50IHZhcmlhYmxlXG4gKiAgIDIuIGBnaXQgY29uZmlnIGdpdC1zcGFuLmRpcmAgaW4gdGhlIHJlcG9cbiAqICAgMy4gRGVmYXVsdDogXCIuc3BhblwiXG4gKlxuICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgUE9TSVgtc3R5bGUgcGF0aCB3aXRoIG5vIHRyYWlsaW5nIHNsYXNoLlxuICogRmFpbC1zYWZlOiBhbnkgcmVzb2x1dGlvbiBlcnJvciBmYWxscyBiYWNrIHRvIFwiLnNwYW5cIiBzbyB0aGUgaG9vayBuZXZlclxuICogY3Jhc2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgZW52RGlyID0gcHJvY2Vzcy5lbnZbJ0dJVF9TUEFOX0RJUiddO1xuICBpZiAoZW52RGlyICYmIGVudkRpci50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB0b1Bvc2l4KGVudkRpci50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjb25maWcnLCAnZ2l0LXNwYW4uZGlyJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA+IDApIHJldHVybiB0cmltbWVkO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjsgLy8gY29uZmlnIGtleSBhYnNlbnQgb3IgZ2l0IGVycm9yIFx1MjAxNCBmYWxsIHRocm91Z2ggdG8gZGVmYXVsdFxuICB9XG4gIHJldHVybiBTUEFOX1JPT1Q7XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGggZmFsbHMgaW5zaWRlIHRoZSBnaXZlbiBzcGFuIHJvb3RcbiAqIGRpcmVjdG9yeS4gQSBwYXRoIGlzIGluc2lkZSB3aGVuIGl0IGVxdWFscyB0aGUgc3BhbiByb290IGV4YWN0bHkgb3IgaXNcbiAqIG5lc3RlZCBiZW5lYXRoIGl0IChpLmUuIHN0YXJ0cyB3aXRoIFwiPHNwYW5Sb290Pi9cIikuIFRoZSBcIi9cIiBib3VuZGFyeSBwcmV2ZW50c1xuICogZmFsc2UgcG9zaXRpdmVzIGZvciBzaWJsaW5ncyBsaWtlIFwiLnNwYW5zL3hcIiBvciBcIi5zcGFuLW5vdGVzL3hcIi5cbiAqXG4gKiBQYXNzIHRoZSByZXN1bHQgb2YgYHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdClgIGFzIGBzcGFuUm9vdGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNwYW5Sb290OiBzdHJpbmcgPSBTUEFOX1JPT1QpOiBib29sZWFuIHtcbiAgY29uc3Qgcm9vdCA9IHNwYW5Sb290LnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gcmVwb1JlbFBhdGggPT09IHJvb3QgfHwgcmVwb1JlbFBhdGguc3RhcnRzV2l0aChgJHtyb290fS9gKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzR2l0SWdub3JlZChyZXBvUm9vdDogc3RyaW5nLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjaGVjay1pZ25vcmUnLCAnLXEnLCAnLS0nLCByZXBvUmVsUGF0aF0sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdpZ25vcmUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByb290ID0gdG9Qb3NpeChyZXBvUm9vdCk7XG4gIGNvbnN0IGFicyA9IHRvUG9zaXgoYWJzUGF0aCk7XG4gIGNvbnN0IHByZWZpeCA9IHJvb3QuZW5kc1dpdGgoJy8nKSA/IHJvb3QgOiBgJHtyb290fS9gO1xuICByZXR1cm4gYWJzLnN0YXJ0c1dpdGgocHJlZml4KSA/IGFicy5zbGljZShwcmVmaXgubGVuZ3RoKSA6IGFicztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbm9uaWNhbGl6ZVBhdGgoYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKGFic1BhdGgpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmlsZSBkb2Vzbid0IGV4aXN0IHlldCAoZS5nLiBXcml0ZSB0byBhIG5ldyBmaWxlKTogY2Fub25pY2FsaXplIHRoZVxuICAgIC8vIGRpcmVjdG9yeSBhbmQgcmVqb2luIHRoZSBiYXNlbmFtZSBzbyBzeW1saW5rcyBpbiB0aGUgcGFyZW50IGFyZSByZXNvbHZlZC5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlyID0gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpKTtcbiAgICAgIHJldHVybiBgJHtkaXJ9LyR7bm9kZVBhdGguYmFzZW5hbWUoYWJzUGF0aCl9YDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBhcmVudCBkb2Vzbid0IGV4aXN0IGVpdGhlcjsgZmFsbCBiYWNrIHRvIHRoZSB1bi1jYW5vbmljYWxpemVkIHBhdGguXG4gICAgICByZXR1cm4gYWJzUGF0aDtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZVBhdGgodG9vbElucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgY3dkOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgZnAgPSB0b29sSW5wdXQuZmlsZV9wYXRoO1xuICBpZiAodHlwZW9mIGZwICE9PSAnc3RyaW5nJyB8fCBmcC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBhYnMgPSBhYnNwYXRoQWdhaW5zdChjd2QsIGZwKTtcbiAgcmV0dXJuIGNhbm9uaWNhbGl6ZVBhdGgoYWJzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lIHJhbmdlIHR5cGVzIGFuZCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBMaW5lUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmdlc0ludGVyc2VjdChhOiBMaW5lUmFuZ2UsIGI6IExpbmVSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5zdGFydCA8PSBiLmVuZCAmJiBhLmVuZCA+PSBiLnN0YXJ0O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvcmNlbGFpbiByb3cgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9yY2VsYWluUm93IHtcbiAgbmFtZTogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMykgY29udGludWU7XG4gICAgY29uc3QgW25hbWUsIHBhdGgsIHJhbmdlXSA9IHBhcnRzO1xuICAgIGNvbnN0IGRhc2hJZHggPSByYW5nZS5pbmRleE9mKCctJyk7XG4gICAgaWYgKGRhc2hJZHggPT09IC0xKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKDAsIGRhc2hJZHgpLCAxMCk7XG4gICAgY29uc3QgZW5kID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoZGFzaElkeCArIDEpLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwgYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgc3RhdHVzIHRva2VuIHZvY2FidWxhcnkgKHRoZVxuICogZ2l0LXNwYW4gQ0xJJ3MgcG9yY2VsYWluIGNvbnRyYWN0KTogYEZSRVNIYC9gTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGBcbiAqIGFyZSBwb3NpdGlvbmFsLW9yLWNsZWFuIGFuZCBuZXZlciBkZWJ0OyBldmVyeSBvdGhlciB0b2tlbiBpcyBzZW1hbnRpYyBkcmlmdFxuICogb3IgYSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb24gYW5kIGlzIGRlYnQuIFNlZSB7QGxpbmsgaXNEZWJ0fSBmb3IgdGhlXG4gKiBzaW5nbGUgc291cmNlIG9mIHRydXRoIG9uIHRoYXQgc3BsaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBQT1JDRUxBSU5fU1RBVFVTRVMgPSBbXG4gICdGUkVTSCcsXG4gICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCcsXG4gICdNT1ZFRCcsXG4gICdDSEFOR0VEJyxcbiAgJ0RFTEVURUQnLFxuICAnQ09ORkxJQ1QnLFxuICAnU1VCTU9EVUxFJyxcbiAgJ0xGU19OT1RfRkVUQ0hFRCcsXG4gICdMRlNfTk9UX0lOU1RBTExFRCcsXG4gICdQUk9NSVNPUl9NSVNTSU5HJyxcbiAgJ1NQQVJTRV9FWENMVURFRCcsXG4gICdGSUxURVJfRkFJTEVEJyxcbiAgJ0lPX0VSUk9SJ1xuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgUG9yY2VsYWluU3RhdHVzID0gKHR5cGVvZiBQT1JDRUxBSU5fU1RBVFVTRVMpW251bWJlcl07XG5cbmNvbnN0IFBPUkNFTEFJTl9TVEFUVVNfU0VUOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChQT1JDRUxBSU5fU1RBVFVTRVMpO1xuXG5mdW5jdGlvbiBwYXJzZVBvcmNlbGFpblN0YXR1cyhyYXc6IHN0cmluZyk6IFBvcmNlbGFpblN0YXR1cyB8IG51bGwge1xuICByZXR1cm4gUE9SQ0VMQUlOX1NUQVRVU19TRVQuaGFzKHJhdykgPyAocmF3IGFzIFBvcmNlbGFpblN0YXR1cykgOiBudWxsO1xufVxuXG4vKiogQSBgcGFyc2VEcmlmdFBvcmNlbGFpbmAgcm93OiBhIHtAbGluayBQb3JjZWxhaW5Sb3d9IHBsdXMgaXRzIHN0YXR1cyB0b2tlbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRHJpZnRQb3JjZWxhaW5Sb3cgZXh0ZW5kcyBQb3JjZWxhaW5Sb3cge1xuICBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cztcbn1cblxuLyoqXG4gKiBUaGUgZGVidCBpbnZhcmlhbnQgKHN5c3RlbS13aWRlOyBjb25zdW1lZCBieSBib3RoIHRoZSBmdXR1cmUgdG91Y2gtY29yZSBhbmRcbiAqIGFkdmlzb3ItY29yZSk6IG9ubHkgc2VtYW50aWMgc3RhdHVzZXMgYXJlIGRlYnQuIGBDSEFOR0VEYCBhbmQgYERFTEVURURgIGFyZVxuICogc2VtYW50aWMgZHJpZnQ7IHRoZSByZW1haW5pbmcgbm9uLUZSRVNIL01PVkVEL1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUIHRva2Vuc1xuICogYXJlIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbnMgYW5kIGFyZSB0cmVhdGVkIGFzIGRlYnQgdG9vICh0aGV5IGJsb2NrIG9uXG4gKiB0aGVpciBvd24gbWVyaXRzIFx1MjAxNCB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXQgYWxsKS4gYEZSRVNIYCxcbiAqIGBNT1ZFRGAsIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0OiBwb3NpdGlvbmFsIGRyaWZ0IHRoZVxuICogQ0xJIGNhbiBoZWFsIChvciBhbHJlYWR5IGhhcykgaXMgaW52aXNpYmxlLCBhbmQgYSBwZW5kaW5nLWNvbW1pdCByZXNvbHV0aW9uXG4gKiBpcyBub3Qgb3V0c3RhbmRpbmcgZGVidC5cbiAqXG4gKiBOb3RlOiB0aGUgcG9yY2VsYWluIHZvY2FidWxhcnkgZG9lcyBub3QgY3VycmVudGx5IGRpc3Rpbmd1aXNoXG4gKiBjb250ZW50LWVxdWl2YWxlbnQgYENIQU5HRURgIChlLmcuIHdoaXRlc3BhY2Utb25seSBkcmlmdCBgLS1maXhgIGNhbiBoZWFsKVxuICogZnJvbSBnZW51aW5lbHkgc2VtYW50aWMgYENIQU5HRURgIFx1MjAxNCB0aGF0IGNsYXNzaWZpY2F0aW9uIGlzIG5vdCBwcmVzZW50IGluXG4gKiBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBvdXRwdXQgdG9kYXkuIFVudGlsIHRoZSBDTEkgZXhwb3NlcyBpdCxcbiAqIGV2ZXJ5IGBDSEFOR0VEYCByb3cgaXMgdHJlYXRlZCBhcyBkZWJ0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNEZWJ0KHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnRlJFU0gnOlxuICAgIGNhc2UgJ01PVkVEJzpcbiAgICBjYXNlICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCc6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogTG93ZXJjYXNlIGh1bWFuIGxhYmVsIGZvciBhIHBvcmNlbGFpbiBzdGF0dXMgdG9rZW4gKGBMRlNfTk9UX0ZFVENIRURgIFx1MjE5MlxuICogYGxmcyBub3QgZmV0Y2hlZGApLiBUaGUgc2luZ2xlIGxhYmVsIG1hcHBpbmcgZm9yIGV2ZXJ5IGh1bWFuLWZvcm1hdCBhbmNob3JcbiAqIHN1ZmZpeCBcdTIwMTQgYm90aCB0aGUgdG91Y2ggaG9vaydzIGJsb2NrIGFuZCB0aGUgYWR2aXNvcidzIG1lc3NhZ2VzIHJlbmRlciB0aHJvdWdoXG4gKiB0aGlzLCBzbyBhIHN0YXR1cyBuZXZlciByZWFkcyBkaWZmZXJlbnRseSBiZXR3ZWVuIHRoZSB0d28uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBodW1hblN0YXR1c0xhYmVsKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN0YXR1cy50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJyAnKTtcbn1cblxuLyoqXG4gKiBUaGUgdGVybWluYWwvZW52aXJvbm1lbnRhbCBzdGF0dXNlczogdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0XG4gKiBhbGwsIHNvIHRoZSByb3cgaXMgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uIFRoZXNlIGFyZVxuICogYENPTkZMSUNUYCAodW5yZXNvbHZlZCBtZXJnZSksIGBTVUJNT0RVTEVgIChhbmNob3IgaW5zaWRlIGEgc3VibW9kdWxlKSxcbiAqIGBMRlNfTk9UX0ZFVENIRURgL2BMRlNfTk9UX0lOU1RBTExFRGAgKEdpdCBMRlMgY29udGVudCB1bmF2YWlsYWJsZSksXG4gKiBgUFJPTUlTT1JfTUlTU0lOR2AgKHBhcnRpYWwtY2xvbmUgb2JqZWN0IG5vdCBmZXRjaGVkKSwgYFNQQVJTRV9FWENMVURFRGBcbiAqIChwYXRoIG91dHNpZGUgdGhlIHNwYXJzZS1jaGVja291dCBjb25lKSwgYEZJTFRFUl9GQUlMRURgIChhIGNsZWFuL3NtdWRnZVxuICogZmlsdGVyIGVycm9yZWQpLCBhbmQgYElPX0VSUk9SYCAodHJhbnNpZW50IHJlYWQgZmFpbHVyZSkuXG4gKlxuICogVGhlc2UgYXJlIGEgc3RyaWN0IHN1YnNldCBvZiB7QGxpbmsgaXNEZWJ0fTogZXZlcnkgZW52aXJvbm1lbnRhbCBzdGF0dXMgaXNcbiAqIGFsc28gZGVidCAoaXQgYmxvY2tzIG9uIGl0cyBvd24gbWVyaXRzIHdoZW4gc3VyZmFjZWQgaW4gYSBzdGF0dXMgcmVwb3J0KSwgYnV0XG4gKiB0aGUgYWR2aXNvciBtdXN0IHRyZWF0IHRoZW0gZGlmZmVyZW50bHkgZnJvbSAqc2VtYW50aWMqIGRyaWZ0IChgQ0hBTkdFRGAsXG4gKiBgREVMRVRFRGApLiBTZW1hbnRpYyBkcmlmdCBpcyBmaXhhYmxlIGJ5IGVkaXRpbmcgYSBzcGFuLCBzbyB0aGUgYWR2aXNvciBmYWlsc1xuICogY2xvc2VkIG9uIGl0OyBhbiBlbnZpcm9ubWVudGFsIGNvbmRpdGlvbiBpcyBub3Qgc29tZXRoaW5nIGEgc3BhbiBlZGl0IGNhblxuICogcmVzb2x2ZSwgc28gdGhlIGFkdmlzb3IgZmFpbHMgT1BFTiBvbiBpdCAoYWxsb3csIGJ1dCBzdXJmYWNlIHRoZSBjb25kaXRpb24pIFx1MjAxNFxuICogcmUtZGVueWluZyBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gaGVyZSB3b3VsZFxuICogY29udHJhZGljdCB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZSByZXN0IG9mIHRoZSBhZHZpc29yIGFscmVhZHkgaG9ub3JzIGZvclxuICogQ0xJLWFic2VudC90aW1lb3V0L3BhcnNlLWZhaWx1cmUgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRW52aXJvbm1lbnRhbFN0YXR1cyhzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0NPTkZMSUNUJzpcbiAgICBjYXNlICdTVUJNT0RVTEUnOlxuICAgIGNhc2UgJ0xGU19OT1RfRkVUQ0hFRCc6XG4gICAgY2FzZSAnTEZTX05PVF9JTlNUQUxMRUQnOlxuICAgIGNhc2UgJ1BST01JU09SX01JU1NJTkcnOlxuICAgIGNhc2UgJ1NQQVJTRV9FWENMVURFRCc6XG4gICAgY2FzZSAnRklMVEVSX0ZBSUxFRCc6XG4gICAgY2FzZSAnSU9fRVJST1InOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqIFJvd3Mgd2hvc2Ugc3RhdHVzIHRva2VuIGlzIG5vdCBpbiB7QGxpbmsgUE9SQ0VMQUlOX1NUQVRVU0VTfSBhcmUgc2tpcHBlZCBcdTIwMTRcbiAqIGFuIHVucmVjb2duaXplZCB0b2tlbiBmcm9tIGEgbmV3ZXIgQ0xJIGlzIHRyZWF0ZWQgdGhlIHNhbWUgYXMgYSBtYWxmb3JtZWRcbiAqIGxpbmUgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlRHJpZnRQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBEcmlmdFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtzdGF0dXNDb2wsICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGF0dXMgPSBwYXJzZVBvcmNlbGFpblN0YXR1cyhzdGF0dXNDb2wpO1xuICAgIGlmICghc3RhdHVzKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCwgc3RhdHVzIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIGJ5IGFsbCBwZXItc2Vzc2lvbiBzdGF0ZTogY3VycmVudGx5IGp1c3QgdGhlIHRvdWNoLWhvb2tcbi8vIHNlc3Npb24gbWVtbyAoc3Bhbi1zdXJmYWNlLnRzJ3MgTWVtb1N0b3JlKS4gRWFjaCBzZXNzaW9uIGdldHMgb25lXG4vLyBzdWJkaXJlY3Rvcnkga2V5ZWQgYnkgaXRzIHNhbml0aXplZCBpZCwgc28gZXZlcnkgd3JpdGVyL3JlYWRlciBmb3IgYSBnaXZlblxuLy8gc2Vzc2lvbiBhZ3JlZXMgb24gaXRzIGxvY2F0aW9uLlxuZXhwb3J0IGNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8qKiBUaGUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHNlc3Npb24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkRpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5jb25zdCBUSElSVFlfREFZU19NUyA9IDMwICogMjQgKiA2MCAqIDYwICogMTAwMDtcblxuLyoqXG4gKiBPcHBvcnR1bmlzdGljYWxseSBwcnVuZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcmllcyB1bmRlclxuICoge0BsaW5rIFNFU1NJT05fQkFTRV9ESVJ9IHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gYG1heEFnZU1zYCAoZGVmYXVsdCAzMFxuICogZGF5cykuIEEgZGlyZWN0b3J5J3MgbXRpbWUgYWR2YW5jZXMgd2hlbmV2ZXIgYW4gZW50cnkgaW5zaWRlIGl0IGlzXG4gKiBjcmVhdGVkL3JlbmFtZWQvcmVtb3ZlZCwgc28gYW4gYWN0aXZlIHNlc3Npb24gKG1lbW8gd3JpdGVzKSBzdGF5cyBmcmVzaDtcbiAqIG9ubHkgZ2VudWluZWx5IGFiYW5kb25lZCBzZXNzaW9ucyBhZ2Ugb3V0LlxuICpcbiAqIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGNhbGxlZCBvcHBvcnR1bmlzdGljYWxseSBmcm9tIGhvb2sgcmVhZC93cml0ZVxuICogcGF0aHMsIG5vdCBhIHNlcGFyYXRlIGNyb24tbGlrZSBtZWNoYW5pc20sIHNvIGEgZmFpbHVyZSBoZXJlIG11c3QgbmV2ZXJcbiAqIGJsb2NrIHRoZSBjYWxsZXIncyBhY3R1YWwgd29yay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBydW5lU3RhbGVTZXNzaW9ucyhub3c6IG51bWJlciA9IERhdGUubm93KCksIG1heEFnZU1zOiBudW1iZXIgPSBUSElSVFlfREFZU19NUyk6IHZvaWQge1xuICBsZXQgZW50cmllczogZnMuRGlyZW50W107XG4gIHRyeSB7XG4gICAgZW50cmllcyA9IGZzLnJlYWRkaXJTeW5jKFNFU1NJT05fQkFTRV9ESVIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuOyAvLyBiYXNlIGRpciBhYnNlbnQgb3IgdW5yZWFkYWJsZSBcdTIwMTQgbm90aGluZyB0byBwcnVuZVxuICB9XG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZGlyUGF0aCA9IG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgZW50cnkubmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhkaXJQYXRoKTtcbiAgICAgIGlmIChub3cgLSBzdGF0Lm10aW1lTXMgPiBtYXhBZ2VNcykge1xuICAgICAgICBmcy5ybVN5bmMoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVmFuaXNoZWQgYmV0d2VlbiByZWFkZGlyIGFuZCBzdGF0LCBvciByZW1vdmFsIGZhaWxlZCBcdTIwMTQgc2tpcCBpdC4gQVxuICAgICAgLy8gYmVzdC1lZmZvcnQgcHJ1bmUgbXVzdCBuZXZlciB0aHJvdyBpbnRvIHRoZSBjYWxsZXIncyBob3QgcGF0aC5cbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgdGhlIGFkdmlzb3IncyBwZXItY2hhbmdlc2V0IHN0YXRlIG1lbW9zIChkaWdlc3Qgb2Ygc29ydGVkXG4gKiBmaW5kaW5ncyArIHVuY292ZXJlZCBwYXRocyksIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpciBzbyBpdCBpcyBzaGFyZWRcbiAqIGFjcm9zcyB3b3JrdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZpc29yTWVtb0RpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ2Fkdmlzb3InKTtcbn1cbiIsICIvKipcbiAqIFN0YXRpYyBjbGFzc2lmaWNhdGlvbiBvZiBhIEJhc2ggdG9vbCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGVcbiAqIHBhdGgocykgKyBsaW5lIHJhbmdlKHMpIGl0IHJlYWRzIG9yIHdyaXRlcywgd2hlcmUgdGhhdCdzIHN0YXRpY2FsbHlcbiAqIGRldGVybWluYWJsZS4gQnVpbHQgZnJvbSBhbiBlbXBpcmljYWwgcGFzcyBvdmVyIH4zMWsgcmVhbCBDbGF1ZGUgQ29kZVxuICogQmFzaCBpbnZvY2F0aW9ucyAoc2VlIGFuYWx5emUtdHJhbnNjcmlwdHMubXRzKSBcdTIwMTQgdGhlIGlkaW9tcyBiZWxvdyBhcmVcbiAqIGV4YWN0bHkgdGhlIG9uZXMgdGhhdCB0dXJuZWQgb3V0IHRvIGJlIGNvbW1vbiBBTkQgcmVsaWFibGUgdGhlcmUuXG4gKlxuICogRGVsaWJlcmF0ZWx5IE5PVCBjb3ZlcmVkIChzZWUgdGhlIHJlc2VhcmNoIHJlcG9ydCk6IGF3ayBOUi10cmlja3MgKHJhcmUsXG4gKiB1bmNvbnN0cmFpbmVkIHN5bnRheCksIGVtYmVkZGVkIHB5dGhvbjMvbm9kZSBoZXJlZG9jIHNjcmlwdHMgKGEgZGlmZmVyZW50XG4gKiBsYW5ndWFnZSdzIEFTVCwgbm90IGEgc2hlbGwgY29uY2VybiksIHNlZCAtaSAobm8gbGluZS1hZGRyZXNzZWQgdXNhZ2VcbiAqIG9ic2VydmVkIFx1MjAxNCBhbGwgcGF0dGVybi1vbmx5IHN1YnN0aXR1dGlvbnMgd2l0aCBubyBzdGF0aWMgcmFuZ2UpLCBwbGFpblxuICogYGVjaG9gL2BwcmludGZgIHJlZGlyZWN0cyAocmFyZSBhbmQgc2VtYW50aWNhbGx5IGFtYmlndW91cyBpbiB0aGUgY29ycHVzKS5cbiAqXG4gKiBUaGUgZ3JlcCBmYW1pbHkgKGdyZXAgLW4vLUEvLUIvLUMpIGlzIG5vdCBpbiB0aGF0IGxpc3QsIGJ1dCBpdCBpcyBub3RcbiAqIGNsYXNzaWZpZWQgaGVyZSBlaXRoZXI6IGl0cyB3aW5kb3cgaXMgYW5jaG9yZWQgdG8gbWF0Y2ggcG9zaXRpb24sIHdoaWNoIGlzXG4gKiBkYXRhLWRlcGVuZGVudCBhbmQgbGl2ZXMgaW4gdGhlIHJlc3BvbnNlLCBub3QgdGhlIGNvbW1hbmQgdGV4dC4gVGhvc2Ugc3BhbnNcbiAqIGFyZSByZXNwb25zZS1kZXJpdmVkIFx1MjAxNCBgcGFyc2VSZXNwb25zZWAgaW4gLi9wYXJzZS1yZXNwb25zZS5qcyByZWFkcyB0aGVtXG4gKiBvdXQgb2YgdGhlIGNvbW1hbmQncyBgdG9vbF9yZXNwb25zZWAuIFRoZSBgZ2l0IGxvZyAtTGAgLyBgZ2l0IHNob3dcbiAqIHJldjpwYXRoYCBpZGlvbXMgYmVsb3cgcmVtYWluIGNvbW1hbmQtdGV4dC1kZXJpdmVkLlxuICovXG5pbXBvcnQgeyBpc0Fic29sdXRlLCByZXNvbHZlIGFzIHJlc29sdmVQYXRoIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvdW50RmlsZUxpbmVzLCBjb3VudEdpdEJsb2JMaW5lcyB9IGZyb20gJy4vY29tbWFuZC1yZXNvbHZlLmpzJztcbmltcG9ydCB7XG4gIGFyZ3ZPZixcbiAgdHlwZSBPcGVyYXRvcixcbiAgdHlwZSBTaW1wbGVDb21tYW5kLFxuICBzcGxpdFRvcExldmVsLFxuICBzcGxpdFdvcmRzLFxuICBzdHJpcFJlZGlyZWN0cyxcbiAgc3RyaXBXcmFwcGVyc1xufSBmcm9tICcuL3NoZWxsLXNwbGl0LmpzJztcbmltcG9ydCB7IERFRkFVTFRfUEFUSF9BTExPV0xJU1QsIGV4cGFuZFZhcmlhYmxlcyB9IGZyb20gJy4vdmFyaWFibGUtZXhwYW5kLmpzJztcblxuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlZFNwYW4ge1xuICBsaW5lU3RhcnQ6IG51bWJlcjtcbiAgbGluZUVuZDogbnVtYmVyO1xuICBhYnNvbHV0ZVBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBleGFjdCBib2R5IG9mIGEgYGhlcmVkb2Mtd3JpdGVgIHNwYW4gXHUyMDE0IHRoZSBjb250ZW50IHRoZSBoZXJlZG9jIHdyaXRlcy5cbiAgICogQWJzZW50ICh1bmRlZmluZWQpIGZvciByZWFkIGlkaW9tcy5cbiAgICovXG4gIGJvZHk/OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBUaGUgaGVyZWRvYyByZWRpcmVjdCBvcGVyYXRvci4gYD5gIG1lYW5zIHRoZSBmaWxlIHdhcyBvdmVyd3JpdHRlblxuICAgKiAod2hvbGUtZmlsZSBzY29wZSBcdTIwMTQgYW55IHNwYW4gYmV5b25kIHRoZSBuZXcgRU9GIHdhcyBkZWxldGVkIGFuZCBtdXN0XG4gICAqIHN1cmZhY2UpOyBgPj5gIG1lYW5zIHRoZSBib2R5IHdhcyBhcHBlbmRlZCAobmFycm93IHRvIHRoZSBhcHBlbmQgcmFuZ2UpLlxuICAgKiBBYnNlbnQgKHVuZGVmaW5lZCkgZm9yIHJlYWQgaWRpb21zLlxuICAgKi9cbiAgcmVkaXJlY3Q/OiAnPicgfCAnPj4nO1xufVxuXG5leHBvcnQgdHlwZSBJZGlvbSA9XG4gIHwgJ3NlZC1uLXJhbmdlJ1xuICB8ICdoZWFkLWZpbGUnXG4gIHwgJ3RhaWwtZmlsZSdcbiAgfCAnY2F0LWZpbGUnXG4gIHwgJ25sLWZpbGUnXG4gIHwgJ2dpdC1zaG93LXJldi1wYXRoJ1xuICB8ICdnaXQtbG9nLUwnXG4gIHwgJ2hlcmVkb2Mtd3JpdGUnO1xuXG5leHBvcnQgdHlwZSBTcGFuTWF0Y2ggPVxuICB8IHsgc3RhdHVzOiAncmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IHNwYW46IFJlc29sdmVkU3Bhbjsgbm90ZT86IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bnJlc29sdmVkJzsgaWRpb206IElkaW9tOyBmaWxlQXJnOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH07XG5cbi8qKiBPcHRpb25zIGZvciB0aGUgQmFzaCBjb21tYW5kIHBhcnNlciAocGxhbiBcdTAwQTc4KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VPcHRpb25zIHtcbiAgLyoqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0byByZXNvbHZlIHJlbGF0aXZlIHBhdGhzIGFnYWluc3Q7IGRlZmF1bHRzIHRvIGBwcm9jZXNzLmN3ZCgpYC4gKi9cbiAgY3dkPzogc3RyaW5nO1xuICAvKiogVGhlIGhvb2sgcHJvY2VzcyBlbnYsIGZvciBhbGxvd2xpc3RlZCBwYXRoLXZhcmlhYmxlIHJlc29sdXRpb247IGRlZmF1bHRzIHRvIGBwcm9jZXNzLmVudmAuICovXG4gIGVudj86IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD47XG4gIC8qKiBWYXJpYWJsZSBuYW1lcyBhbGxvd2VkIHRvIHJlc29sdmUgZnJvbSBgZW52YDsgZGVmYXVsdHMgdG8gYERFRkFVTFRfUEFUSF9BTExPV0xJU1RgLiAqL1xuICBhbGxvd2xpc3Q/OiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxuLyoqIFdoZXRoZXIgYSBzaW1wbGUgY29tbWFuZCBpcyBrbm93biB0byBoYXZlIGV4ZWN1dGVkLCBwcm92YWJseSBub3QsIG9yIHVuZGV0ZXJtaW5hYmxlIChwbGFuIFx1MDBBNzIpLiAqL1xuZXhwb3J0IHR5cGUgRXhlY1N0YXR1cyA9ICd5ZXMnIHwgJ25vJyB8ICd1bmtub3duJztcblxuLyoqIFRoZSBleGVjdXRpb24tYXdhcmUgd2FsaydzIHZlcmRpY3QgZm9yIG9uZSBzaW1wbGUgY29tbWFuZCAocGxhbiBcdTAwQTcyKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhZ2VFeGVjIHtcbiAgLyoqIGAneWVzJ2AgXHUyMDE0IHByb3ZhYmx5IGV4ZWN1dGVkOyBgJ25vJ2AgXHUyMDE0IHByb3ZhYmx5IG5vdDsgYCd1bmtub3duJ2AgXHUyMDE0IHVuZGV0ZXJtaW5hYmxlIChmYWlsIGNsb3NlZCkuICovXG4gIGV4ZWM6IEV4ZWNTdGF0dXM7XG59XG5cbi8qKlxuICogQ29tcHV0ZSwgcGVyIHNpbXBsZSBjb21tYW5kLCB3aGV0aGVyIGl0IGV4ZWN1dGVkIChwbGFuIFx1MDBBNzIpOiBwaXBlbGluZVxuICogZ3JvdXBpbmcsIGAmJmAvYHx8YCBjaGFpbiBnYXRpbmcgYWdhaW5zdCBrbm93biBzdGF0dXNlcywgYCFgIGdyb3VwLWxldmVsXG4gKiBuZWdhdGlvbiwgaW4tc3RyaW5nIGVycmV4aXQvcGlwZWZhaWwgbGl2ZW5lc3MsIHRlcm1pbmF0b3IgYW5kIG5ldmVyLXJldHVyblxuICogZmlyZXMsIGFuZCB0aGUgZGVjaWRhYmxlLWNvbnRyb2wgY29uc3RydWN0IGNsYXNzZXMuIElPLWZyZWUgYW5kIGV4cG9ydGVkIHNvXG4gKiB0aGUgeHRyYWNlIG9yYWNsZSBjYW4gY29tcGFyZSBleGVjdXRlZCBzZXRzIGFnYWluc3QgcmVhbCBiYXNoLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYW5hbHl6ZUV4ZWN1dGlvbihzaW1wbGVDb21tYW5kczogU2ltcGxlQ29tbWFuZFtdLCBfb3B0czogUGFyc2VPcHRpb25zID0ge30pOiBTdGFnZUV4ZWNbXSB7XG4gIGNvbnN0IHdhbGtlciA9IG5ldyBFeGVjdXRpb25XYWxrZXIoKTtcbiAgd2Fsa2VyLndhbGtJbnB1dChzaW1wbGVDb21tYW5kcyk7XG4gIHJldHVybiB3YWxrZXIudmVyZGljdHMubWFwKChleGVjKSA9PiAoeyBleGVjIH0pKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFeGVjdXRpb24gd2FsayAocGxhbiBcdTAwQTcyKTogcGVyLXNpbXBsZS1jb21tYW5kIEV4ZWNTdGF0dXMsIGRyaXZlbiBieSBwaXBlbGluZVxuLy8gZ3JvdXBpbmcsICYmL3x8IGNoYWluIHN0YXR1cywgaW4tc3RyaW5nIGVycmV4aXQvcGlwZWZhaWwgbGl2ZW5lc3MsIGFuZCB0aGVcbi8vIGRlY2lkYWJsZS1jb250cm9sIGNvbnN0cnVjdCBjbGFzc2VzLiBUaGUgd2FsayBhbHNvIGV4cGFuZHMgZGVjaWRhYmxlXG4vLyBjb25zdHJ1Y3QgaW50ZXJpb3JzIGludG8gdGhlIHN0YWdlIHN0cmVhbSB0aGUgZW1pc3Npb24gcmVwbGF5IGNvbnN1bWVzLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgQ2hhaW5TdGF0dXMgPSAnc3VjY2VzcycgfCAnZmFpbHVyZScgfCAndW5rbm93bic7XG5cbnR5cGUgRGVhZEtpbmQgPSAnZXhpdCcgfCAnbmV2ZXItcmV0dXJuJyB8ICdlcnJleGl0JyB8ICdtYWxmb3JtZWQnO1xuXG4vKiogT25lIHN0YWdlIHRoZSB3YWxrIGNvbnRyaWJ1dGVzIHRvIHRoZSBlbWlzc2lvbiByZXBsYXkuICovXG5pbnRlcmZhY2UgRXhwYW5kZWRTdGFnZSB7XG4gIHRleHQ6IHN0cmluZztcbiAgcHJlY2VkZWRCeTogT3BlcmF0b3I7XG4gIGV4ZWM6IEV4ZWNTdGF0dXM7XG4gIC8qKiBBIG1lbWJlciBvZiBhIG11bHRpLW1lbWJlciBwaXBlbGluZTogc2lkZSBlZmZlY3RzIGFuZCBgZXhpdGAvYGV4ZWNgIHRlcm1pbmF0b3JzIGFyZSBzdXBwcmVzc2VkLiAqL1xuICBpblBpcGVsaW5lOiBib29sZWFuO1xuICAvKiogVGhlIGVtaXNzaW9uJ3MgYGNkYCBmcmFtZTogKzEgaW5zaWRlIGEgc3Vic2hlbGwgaW50ZXJpb3IsIGRpc2NhcmRlZCBhdCB0aGUgY2xvc2UuICovXG4gIGRpckZyYW1lOiBudW1iZXI7XG4gIC8qKiBUaGUgc2NyaXB0IHZhcmlhYmxlIHRhYmxlIGFzIG9mIHRoaXMgc3RhZ2UgKHBsYW4gXHUwMEE3Nyk6IHRoZSBleGVjdXRlZCBub24tcGlwZSBhc3NpZ25tZW50cyBzZWVuIHNvIGZhciwgaW4gb3JkZXIuICovXG4gIGFzc2lnbm1lbnRzOiBSZWFkb25seU1hcDxzdHJpbmcsIHN0cmluZz47XG59XG5cbmludGVyZmFjZSBMb29wRnJhbWUge1xuICBvdXRjb21lOiAnbm9uZScgfCAnYnJlYWsnIHwgJ2NvbnRpbnVlJyB8ICdhbWJpZ3VvdXMnIHwgJ3JldHVybic7XG4gIC8qKiBBIGRlY2lzaXZlIG93bi1kZXB0aCBicmVhay9jb250aW51ZSBmaXJlZDogdGhlIHJlc3Qgb2YgdGhlIGJvZHkgbGlzdCBpcyBkZWFkLiAqL1xuICBib2R5VGVybWluYXRlZDogYm9vbGVhbjtcbiAgLyoqIEEgaGlkZGVuIGJyZWFrL2NvbnRpbnVlIG1hZGUgdGhlIGd1YXJkIG9ud2FyZCB1bnRvdWNoYWJsZS4gKi9cbiAgYW1iaWd1b3VzU3RvcDogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIFdhbGtPcHRpb25zIHtcbiAgLyoqIEVycmV4aXQgbGl2ZW5lc3MgaXMgc3VzcGVuZGVkIGluc2lkZSBpZi93aGlsZS91bnRpbCBjb25kaXRpb25zIChiYXNoIGV4ZW1wdHMgdGhlbSkuICovXG4gIGxpdmVuZXNzOiBib29sZWFuO1xuICAvKiogVGhlIGV4cGFuZGVkIHN0YWdlIHN0cmVhbSBpcyBkaXNjYXJkZWQgKGNvbmRpdGlvbnMsIHNjYW5zLCBkZWYtYm9keSBwcm9iZXMpLiAqL1xuICBkaXNjYXJkOiBib29sZWFuO1xuICAvKiogU2lkZSBlZmZlY3RzIChhc3NpZ25tZW50cywgc2V0IHRvZ2dsZXMsIGRlZiByZWdpc3RyYXRpb24pIGFyZSBhcHBsaWVkLiAqL1xuICBzaWRlRWZmZWN0czogYm9vbGVhbjtcbiAgLyoqIFRoaXMgbGlzdCBpcyB0aGUgdG9wLWxldmVsIGlucHV0OiByZWNvcmQgdGhlIHBlci1pbnB1dCB2ZXJkaWN0cy4gKi9cbiAgaW5wdXRGYWNpbmc6IGJvb2xlYW47XG59XG5cbmNvbnN0IEFTU0lHTk1FTlRfUkUgPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9LztcblxuLyoqIFRoZSBgLW9gL2Arb2Agb3B0aW9uIG5hbWVzIG9mIGBzZXRgIHRoYXQgYmFzaCBkb2N1bWVudHMgKHBsYW4gXHUwMEE3Miwga25vd24gc3RhdHVzZXMpLiAqL1xuY29uc3QgU0VUX09QVElPTl9OQU1FUyA9IG5ldyBTZXQoW1xuICAnYWxsZXhwb3J0JyxcbiAgJ2JyYWNlZXhwYW5kJyxcbiAgJ2VtYWNzJyxcbiAgJ2VycmV4aXQnLFxuICAnZXJydHJhY2UnLFxuICAnZnVuY3RyYWNlJyxcbiAgJ2hhc2hhbGwnLFxuICAnaGlzdGV4cGFuZCcsXG4gICdoaXN0b3J5JyxcbiAgJ2lnbm9yZWVvZicsXG4gICdpbnRlcmFjdGl2ZS1jb21tZW50cycsXG4gICdrZXl3b3JkJyxcbiAgJ2xleGljYWwtd29yZC1wcm9jZXNzaW5nJyxcbiAgJ21vbml0b3InLFxuICAnbm9jbG9iYmVyJyxcbiAgJ25vZXhlYycsXG4gICdub2dsb2InLFxuICAnbm9sb2cnLFxuICAnbm90aWZ5JyxcbiAgJ25vdW5zZXQnLFxuICAnb25lY21kJyxcbiAgJ3BoeXNpY2FsJyxcbiAgJ3BpcGVmYWlsJyxcbiAgJ3Bvc2l4JyxcbiAgJ3ByaXZpbGVnZWQnLFxuICAndmVyYm9zZScsXG4gICd2aScsXG4gICd4dHJhY2UnXG5dKTtcblxuLyoqIGJhc2gncyBkb2N1bWVudGVkIHNpbmdsZS1sZXR0ZXIgYHNldGAgZmxhZ3MgKHBsYW4gXHUwMEE3Miwga25vd24gc3RhdHVzZXMpLiAqL1xuY29uc3QgU0VUX0ZMQUdfTEVUVEVSUyA9ICdhQmJDZUVmaEhpa21ub3BQdFR1dngnO1xuXG4vKiogQnVpbHRpbnMgdGhlIHdhbGsncyByZXN0cmljdGVkIGBidWlsdGluYCB3cmFwcGVyIHN0cmlwIGZvcndhcmRzIChwbGFuIFx1MDBBNzIsIHdyYXBwZXIgZGlzY2lwbGluZSkuICovXG5jb25zdCBSRUNPR05JWkVEX0JVSUxUSU5TID0gbmV3IFNldChbXG4gICd0cnVlJyxcbiAgJzonLFxuICAnZmFsc2UnLFxuICAnc2V0JyxcbiAgJ2V4aXQnLFxuICAnZXhlYycsXG4gICdyZXR1cm4nLFxuICAnYnJlYWsnLFxuICAnY29udGludWUnLFxuICAnY2QnLFxuICAnZXhwb3J0JyxcbiAgJ2NvbW1hbmQnLFxuICAnYnVpbHRpbidcbl0pO1xuXG4vKiogV2Fsay1zaWRlIHdyYXBwZXIgc3RyaXA6IGAhYCwgYGNvbW1hbmRgLCBhbmQgYGJ1aWx0aW5gIChyZXN0cmljdGVkIHRvIHRoZSByZWNvZ25pemVkIGJ1aWx0aW5zKS4gKi9cbmZ1bmN0aW9uIHdhbGtTdHJpcChhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICchJykgaSsrO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICdjb21tYW5kJykgaSsrO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICdidWlsdGluJyAmJiBhcmd2W2kgKyAxXSAhPT0gdW5kZWZpbmVkICYmIFJFQ09HTklaRURfQlVJTFRJTlMuaGFzKGFyZ3ZbaSArIDFdKSlcbiAgICBpKys7XG4gIHJldHVybiBhcmd2LnNsaWNlKGkpO1xufVxuXG4vKiogRW1pc3Npb24tc2lkZSBzdHJpcDogbGVhZGluZyBgIWAsIGBjb21tYW5kYCwgYGV4ZWNgLCBhbmQgYGJ1aWx0aW5gIChyZXN0cmljdGVkIHRvIHRoZSByZWNvZ25pemVkIGJ1aWx0aW5zKSBiZWZvcmUgbWF0Y2hlciBkaXNwYXRjaC4gKi9cbmZ1bmN0aW9uIHN0cmlwRm9yRW1pc3Npb24oYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2ldID09PSAnIScpIGkrKztcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiAoYXJndltpXSA9PT0gJ2NvbW1hbmQnIHx8IGFyZ3ZbaV0gPT09ICdleGVjJykpIGkrKztcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2ldID09PSAnYnVpbHRpbicgJiYgYXJndltpICsgMV0gIT09IHVuZGVmaW5lZCAmJiBSRUNPR05JWkVEX0JVSUxUSU5TLmhhcyhhcmd2W2kgKyAxXSkpXG4gICAgaSsrO1xuICByZXR1cm4gYXJndi5zbGljZShpKTtcbn1cblxuLyoqIEV2ZXJ5IGFyZyBhIHJlY29nbml6ZWQgYHNldGAgZmxhZyBncm91cCAoYC1vYCBjb25zdW1lcyBpdHMgbmFtZSksIGAtLWAsIG9yIGEgcG9zaXRpb25hbCB3b3JkLiAqL1xuZnVuY3Rpb24gc2V0RmxhZ3NLbm93bihhcmdzOiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpIHx8IGEuc3RhcnRzV2l0aCgnKycpKSB7XG4gICAgICBjb25zdCBjaGFycyA9IGEuc2xpY2UoMSk7XG4gICAgICBpZiAoY2hhcnMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2U7XG4gICAgICBmb3IgKGxldCBrID0gMDsgayA8IGNoYXJzLmxlbmd0aDsgaysrKSB7XG4gICAgICAgIGNvbnN0IGMgPSBjaGFyc1trXTtcbiAgICAgICAgaWYgKGMgPT09ICdvJykge1xuICAgICAgICAgIGNvbnN0IG5hbWUgPSBhcmdzW2kgKyAxXTtcbiAgICAgICAgICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkIHx8ICFTRVRfT1BUSU9OX05BTUVTLmhhcyhuYW1lKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIGkrKztcbiAgICAgICAgfSBlbHNlIGlmICghU0VUX0ZMQUdfTEVUVEVSUy5pbmNsdWRlcyhjKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICAvLyBBIHBvc2l0aW9uYWwgcGFyYW1ldGVyIHdvcmQgXHUyMDE0IGBzZXQgZm9vYCBleGl0cyAwLlxuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIEEgcXVvdGUtYXdhcmUgc2NhbiBvZiBhIGNvbnN0cnVjdCdzIHRleHQgdGhhdCB5aWVsZHMgaXRzIHdvcmRzIChxdW90ZVxuICogY29udGVudCBzdHJpcHBlZCkgd2l0aCB0aGUgcGFyZW4vYnJhY2UvY29uc3RydWN0IGRlcHRocyBhdCBlYWNoIHdvcmQsIHNvXG4gKiBgdGhlbmAvYGRvYC9gZG9uZWAvYGZpYC9gZXNhY2AvYGluYCBrZXl3b3JkcyBhcmUgcmVjb2duaXplZCBvbmx5IGF0IHRoZVxuICogbGV2ZWwgdGhhdCBvd25zIHRoZW0uXG4gKi9cbmludGVyZmFjZSBXb3JkVG9rIHtcbiAgd29yZDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbiAgZGVwdGg6IG51bWJlcjtcbiAgYnJhY2VEZXB0aDogbnVtYmVyO1xuICBjb25zdHJ1Y3REZXB0aDogbnVtYmVyO1xuICBxdW90ZWQ6IGJvb2xlYW47XG59XG5cbmNvbnN0IENPTlNUUlVDVF9PUEVORVJTID0gbmV3IFNldChbJ2lmJywgJ3doaWxlJywgJ3VudGlsJywgJ2ZvcicsICdjYXNlJywgJ3NlbGVjdCddKTtcbmNvbnN0IENPTlNUUlVDVF9DTE9TRVJTID0gbmV3IFNldChbJ2ZpJywgJ2RvbmUnLCAnZXNhYyddKTtcblxuZnVuY3Rpb24gc2NhblRva2Vucyh0ZXh0OiBzdHJpbmcpOiBXb3JkVG9rW10ge1xuICBjb25zdCB0b2tzOiBXb3JkVG9rW10gPSBbXTtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gdGV4dC5sZW5ndGg7XG4gIGxldCBwYXJlbkRlcHRoID0gMDtcbiAgbGV0IGJyYWNlRGVwdGggPSAwO1xuICBsZXQgY29uc3RydWN0RGVwdGggPSAwO1xuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gdGV4dFtpXTtcbiAgICBpZiAoL1xccy8udGVzdChjKSkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKCcgfHwgYyA9PT0gJ3snKSB7XG4gICAgICBpZiAoYyA9PT0gJygnKSBwYXJlbkRlcHRoKys7XG4gICAgICBlbHNlIGJyYWNlRGVwdGgrKztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyknIHx8IGMgPT09ICd9Jykge1xuICAgICAgaWYgKGMgPT09ICcpJykgcGFyZW5EZXB0aCA9IE1hdGgubWF4KDAsIHBhcmVuRGVwdGggLSAxKTtcbiAgICAgIGVsc2UgYnJhY2VEZXB0aCA9IE1hdGgubWF4KDAsIGJyYWNlRGVwdGggLSAxKTtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoJzsmfDw+Jy5pbmNsdWRlcyhjKSkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHN0YXJ0ID0gaTtcbiAgICBjb25zdCB3ID0gcmVhZFdvcmRBdCh0ZXh0LCBpKTtcbiAgICBpZiAodyA9PT0gbnVsbCkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGkgPSB3LmVuZDtcbiAgICB0b2tzLnB1c2goeyB3b3JkOiB3LndvcmQsIHN0YXJ0LCBlbmQ6IHcuZW5kLCBkZXB0aDogcGFyZW5EZXB0aCwgYnJhY2VEZXB0aCwgY29uc3RydWN0RGVwdGgsIHF1b3RlZDogdy5xdW90ZWQgfSk7XG4gICAgaWYgKHBhcmVuRGVwdGggPT09IDAgJiYgYnJhY2VEZXB0aCA9PT0gMCAmJiAhdy5xdW90ZWQpIHtcbiAgICAgIGlmIChDT05TVFJVQ1RfT1BFTkVSUy5oYXMody53b3JkKSkgY29uc3RydWN0RGVwdGgrKztcbiAgICAgIGVsc2UgaWYgKENPTlNUUlVDVF9DTE9TRVJTLmhhcyh3LndvcmQpKSBjb25zdHJ1Y3REZXB0aCA9IE1hdGgubWF4KDAsIGNvbnN0cnVjdERlcHRoIC0gMSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB0b2tzO1xufVxuXG4vKiogUmVhZCBvbmUgd29yZCBhdCBgaWAgKHF1b3RlLWF3YXJlLCBzZXBhcmF0b3ItdGVybWluYXRlZCk7IHJldHVybnMgaXRzIGNvbnRlbnQgYW5kIHNwYW4uICovXG5mdW5jdGlvbiByZWFkV29yZEF0KHRleHQ6IHN0cmluZywgaTogbnVtYmVyKTogeyB3b3JkOiBzdHJpbmc7IGVuZDogbnVtYmVyOyBxdW90ZWQ6IGJvb2xlYW4gfSB8IG51bGwge1xuICBpZiAoaSA+PSB0ZXh0Lmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gIGxldCB3b3JkID0gJyc7XG4gIGxldCBxdW90ZWQgPSBmYWxzZTtcbiAgY29uc3QgbiA9IHRleHQubGVuZ3RoO1xuICB3aGlsZSAoaSA8IG4gJiYgIS9cXHMvLnRlc3QodGV4dFtpXSkgJiYgIScoKXt9OyZ8PD4nLmluY2x1ZGVzKHRleHRbaV0pKSB7XG4gICAgY29uc3QgY2ggPSB0ZXh0W2ldO1xuICAgIGlmIChjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlZCA9IHRydWU7XG4gICAgICBpKys7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgdGV4dFtpXSAhPT0gXCInXCIpIHtcbiAgICAgICAgd29yZCArPSB0ZXh0W2ldO1xuICAgICAgICBpKys7XG4gICAgICB9XG4gICAgICBpZiAoaSA8IG4pIGkrKztcbiAgICB9IGVsc2UgaWYgKGNoID09PSAnXCInKSB7XG4gICAgICBxdW90ZWQgPSB0cnVlO1xuICAgICAgaSsrO1xuICAgICAgd2hpbGUgKGkgPCBuICYmIHRleHRbaV0gIT09ICdcIicpIHtcbiAgICAgICAgaWYgKHRleHRbaV0gPT09ICdcXFxcJyAmJiBpICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyh0ZXh0W2kgKyAxXSkpIHtcbiAgICAgICAgICB3b3JkICs9IHRleHRbaSArIDFdO1xuICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB3b3JkICs9IHRleHRbaV07XG4gICAgICAgICAgaSsrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoaSA8IG4pIGkrKztcbiAgICB9IGVsc2UgaWYgKGNoID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICB3b3JkICs9IHRleHRbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgIH0gZWxzZSB7XG4gICAgICB3b3JkICs9IGNoO1xuICAgICAgaSsrO1xuICAgIH1cbiAgfVxuICByZXR1cm4geyB3b3JkLCBlbmQ6IGksIHF1b3RlZCB9O1xufVxuXG4vKiogVGhlIGludGVyaW9yIGJldHdlZW4gdGhlIGZpcnN0IGBvcGVuYCBjaGFyIGFuZCBpdHMgbWF0Y2hpbmcgYGNsb3NlYCwgcXVvdGVzIGF3YXJlLiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdyb3VwQm9keSh0ZXh0OiBzdHJpbmcsIG9wZW46ICd7JyB8ICcoJywgY2xvc2U6ICd9JyB8ICcpJyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBzdGFydCA9IHRleHQuaW5kZXhPZihvcGVuKTtcbiAgaWYgKHN0YXJ0ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBpblF1b3RlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgZm9yIChsZXQgcCA9IHN0YXJ0OyBwIDwgdGV4dC5sZW5ndGg7IHArKykge1xuICAgIGNvbnN0IGNoID0gdGV4dFtwXTtcbiAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaW5RdW90ZSA9PT0gJ1wiJyAmJiBwICsgMSA8IHRleHQubGVuZ3RoICYmICdcIlxcXFwkYCcuaW5jbHVkZXModGV4dFtwICsgMV0pKSBwKys7XG4gICAgICBlbHNlIGlmIChjaCA9PT0gaW5RdW90ZSkgaW5RdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSBcIidcIiB8fCBjaCA9PT0gJ1wiJykge1xuICAgICAgaW5RdW90ZSA9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1xcXFwnKSB7XG4gICAgICBwKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSBvcGVuKSBkZXB0aCsrO1xuICAgIGVsc2UgaWYgKGNoID09PSBjbG9zZSkge1xuICAgICAgZGVwdGgtLTtcbiAgICAgIGlmIChkZXB0aCA9PT0gMCkgcmV0dXJuIHRleHQuc2xpY2Uoc3RhcnQgKyAxLCBwKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbnR5cGUgQ29uc3RydWN0S2luZCA9ICdpZicgfCAnd2hpbGUnIHwgJ3VudGlsJyB8ICdmb3InIHwgJ2Nhc2UnIHwgJ3NlbGVjdCcgfCAnYnJhY2UnIHwgJ3N1YnNoZWxsJyB8ICdkZWYnIHwgJ3BsYWluJztcblxuZnVuY3Rpb24gY2xhc3NpZnlTdGFnZSh0ZXh0OiBzdHJpbmcpOiBDb25zdHJ1Y3RLaW5kIHtcbiAgY29uc3QgdCA9IHRleHQudHJpbVN0YXJ0KCk7XG4gIGlmICh0LnN0YXJ0c1dpdGgoJ3snKSkgcmV0dXJuICdicmFjZSc7XG4gIGlmICh0LnN0YXJ0c1dpdGgoJygnKSkgcmV0dXJuICdzdWJzaGVsbCc7XG4gIGNvbnN0IGt3ID0gdC5tYXRjaCgvXihpZnx3aGlsZXx1bnRpbHxmb3J8Y2FzZXxzZWxlY3QpXFxiLyk7XG4gIGlmIChrdyAhPT0gbnVsbCkgcmV0dXJuIGt3WzFdIGFzIENvbnN0cnVjdEtpbmQ7XG4gIGlmICgvXig/OmZ1bmN0aW9uXFxzKyk/W0EtWmEtel9dW0EtWmEtejAtOV9dKlxcKFxcKVxccypcXHsvLnRlc3QodCkpIHJldHVybiAnZGVmJztcbiAgcmV0dXJuICdwbGFpbic7XG59XG5cbi8qKiBBIGZ1bmN0aW9uIGRlZmluaXRpb24ncyBuYW1lIGFuZCBib2R5IHRleHQgKGJyYWNlLWdyb3VwIGludGVyaW9yKS4gKi9cbmZ1bmN0aW9uIHBhcnNlRGVmKHRleHQ6IHN0cmluZyk6IHsgbmFtZTogc3RyaW5nOyBib2R5OiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCBtID0gdGV4dC5tYXRjaCgvXig/OmZ1bmN0aW9uXFxzKyk/KFtBLVphLXpfXVtBLVphLXowLTlfXSopXFxzKig/OlxcKFxcKSk/XFxzKlxcey8pO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGJvZHkgPSBleHRyYWN0R3JvdXBCb2R5KHRleHQsICd7JywgJ30nKTtcbiAgaWYgKGJvZHkgPT09IG51bGwpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBuYW1lOiBtWzFdLCBib2R5IH07XG59XG5cbmludGVyZmFjZSBQYXJzZWRJZiB7XG4gIGNvbmRpdGlvbjogc3RyaW5nO1xuICB0aGVuQm9keTogc3RyaW5nO1xuICBlbGlmczogeyBjb25kaXRpb246IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXTtcbiAgZWxzZUJvZHk6IHN0cmluZyB8IG51bGw7XG59XG5cbmZ1bmN0aW9uIHBhcnNlSWYodGV4dDogc3RyaW5nKTogUGFyc2VkSWYgfCBudWxsIHtcbiAgY29uc3QgdG9rcyA9IHNjYW5Ub2tlbnModGV4dCk7XG4gIGlmICh0b2tzLmxlbmd0aCA9PT0gMCB8fCB0b2tzWzBdLndvcmQgIT09ICdpZicpIHJldHVybiBudWxsO1xuICBjb25zdCB0aGVuSWR4ID0gdG9rcy5maW5kSW5kZXgoKHQpID0+IHQud29yZCA9PT0gJ3RoZW4nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICBpZiAodGhlbklkeCA9PT0gLTEpIHJldHVybiBudWxsO1xuICBjb25zdCB0aGVuVG9rID0gdG9rc1t0aGVuSWR4XTtcbiAgY29uc3QgY29uZGl0aW9uID0gdGV4dC5zbGljZSh0b2tzWzBdLmVuZCwgdGhlblRvay5zdGFydCk7XG5cbiAgY29uc3QgYm91bmRhcmllczogeyB3b3JkOiBzdHJpbmc7IHRvazogV29yZFRvayB9W10gPSBbXTtcbiAgZm9yIChsZXQgaWR4ID0gdGhlbklkeCArIDE7IGlkeCA8IHRva3MubGVuZ3RoOyBpZHgrKykge1xuICAgIGNvbnN0IHQgPSB0b2tzW2lkeF07XG4gICAgaWYgKHQuY29uc3RydWN0RGVwdGggIT09IDEgfHwgKHQud29yZCAhPT0gJ2VsaWYnICYmIHQud29yZCAhPT0gJ2Vsc2UnICYmIHQud29yZCAhPT0gJ2ZpJykpIGNvbnRpbnVlO1xuICAgIGlmICh0LndvcmQgPT09ICdlbGlmJykge1xuICAgICAgY29uc3QgZVRoZW5JZHggPSB0b2tzLmZpbmRJbmRleCgodHQsIGlpKSA9PiBpaSA+IGlkeCAmJiB0dC53b3JkID09PSAndGhlbicgJiYgdHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICAgICAgaWYgKGVUaGVuSWR4ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBib3VuZGFyaWVzLnB1c2goeyB3b3JkOiAnZWxpZicsIHRvazogdCB9LCB7IHdvcmQ6ICd0aGVuJywgdG9rOiB0b2tzW2VUaGVuSWR4XSB9KTtcbiAgICAgIGlkeCA9IGVUaGVuSWR4O1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGJvdW5kYXJpZXMucHVzaCh7IHdvcmQ6IHQud29yZCwgdG9rOiB0IH0pO1xuICAgIGlmICh0LndvcmQgPT09ICdlbHNlJykge1xuICAgICAgY29uc3QgZmlJZHggPSB0b2tzLmZpbmRJbmRleCgodHQsIGlpKSA9PiBpaSA+IGlkeCAmJiB0dC53b3JkID09PSAnZmknICYmIHR0LmNvbnN0cnVjdERlcHRoID09PSAxKTtcbiAgICAgIGlmIChmaUlkeCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgICAgYm91bmRhcmllcy5wdXNoKHsgd29yZDogJ2ZpJywgdG9rOiB0b2tzW2ZpSWR4XSB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBicmVhaztcbiAgfVxuICBpZiAoYm91bmRhcmllcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHRoZW5Cb2R5ID0gdGV4dC5zbGljZSh0aGVuVG9rLmVuZCwgYm91bmRhcmllc1swXS50b2suc3RhcnQpO1xuICBjb25zdCBlbGlmczogeyBjb25kaXRpb246IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXSA9IFtdO1xuICBsZXQgZWxzZUJvZHk6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBiID0gMDsgYiA8IGJvdW5kYXJpZXMubGVuZ3RoOyBiKyspIHtcbiAgICBjb25zdCB7IHdvcmQsIHRvayB9ID0gYm91bmRhcmllc1tiXTtcbiAgICBpZiAod29yZCA9PT0gJ2VsaWYnKSB7XG4gICAgICBjb25zdCBlVGhlbiA9IGJvdW5kYXJpZXNbYiArIDFdO1xuICAgICAgaWYgKGVUaGVuID09PSB1bmRlZmluZWQgfHwgZVRoZW4ud29yZCAhPT0gJ3RoZW4nKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IG5leHRTdGFydCA9IGJvdW5kYXJpZXNbYiArIDJdPy50b2suc3RhcnQgPz8gdGV4dC5sZW5ndGg7XG4gICAgICBlbGlmcy5wdXNoKHsgY29uZGl0aW9uOiB0ZXh0LnNsaWNlKHRvay5lbmQsIGVUaGVuLnRvay5zdGFydCksIGJvZHk6IHRleHQuc2xpY2UoZVRoZW4udG9rLmVuZCwgbmV4dFN0YXJ0KSB9KTtcbiAgICAgIGIrKztcbiAgICB9IGVsc2UgaWYgKHdvcmQgPT09ICdlbHNlJykge1xuICAgICAgY29uc3QgZmkgPSBib3VuZGFyaWVzW2IgKyAxXTtcbiAgICAgIGlmIChmaSA9PT0gdW5kZWZpbmVkIHx8IGZpLndvcmQgIT09ICdmaScpIHJldHVybiBudWxsO1xuICAgICAgZWxzZUJvZHkgPSB0ZXh0LnNsaWNlKHRvay5lbmQsIGZpLnRvay5zdGFydCk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgY29uZGl0aW9uLCB0aGVuQm9keSwgZWxpZnMsIGVsc2VCb2R5IH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlTG9vcCh0ZXh0OiBzdHJpbmcsIGtleXdvcmQ6ICd3aGlsZScgfCAndW50aWwnKTogeyBjb25kaXRpb246IHN0cmluZzsgYm9keTogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgdG9rcyA9IHNjYW5Ub2tlbnModGV4dCk7XG4gIGlmICh0b2tzLmxlbmd0aCA9PT0gMCB8fCB0b2tzWzBdLndvcmQgIT09IGtleXdvcmQpIHJldHVybiBudWxsO1xuICBjb25zdCBkb1RvayA9IHRva3MuZmluZCgodCkgPT4gdC53b3JkID09PSAnZG8nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICBpZiAoZG9Ub2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRvbmVUb2sgPSB0b2tzLmZpbmQoKHQpID0+IHQuc3RhcnQgPiBkb1Rvay5lbmQgJiYgdC53b3JkID09PSAnZG9uZScgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gIGlmIChkb25lVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBjb25kaXRpb246IHRleHQuc2xpY2UodG9rc1swXS5lbmQsIGRvVG9rLnN0YXJ0KSwgYm9keTogdGV4dC5zbGljZShkb1Rvay5lbmQsIGRvbmVUb2suc3RhcnQpIH07XG59XG5cbmludGVyZmFjZSBQYXJzZWRGb3Ige1xuICBsaXN0OiBzdHJpbmdbXSB8IG51bGw7XG4gIGJvZHk6IHN0cmluZztcbiAgd2hvbGVJbnRlcmlvcjogc3RyaW5nO1xufVxuXG5mdW5jdGlvbiBwYXJzZUZvcih0ZXh0OiBzdHJpbmcpOiBQYXJzZWRGb3IgfCBudWxsIHtcbiAgY29uc3QgdG9rcyA9IHNjYW5Ub2tlbnModGV4dCk7XG4gIGlmICh0b2tzLmxlbmd0aCA9PT0gMCB8fCB0b2tzWzBdLndvcmQgIT09ICdmb3InKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgbmFtZVRvayA9IHRva3NbMV07XG4gIGlmIChuYW1lVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICBjb25zdCBkb1RvayA9IHRva3MuZmluZCgodCkgPT4gdC53b3JkID09PSAnZG8nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEgJiYgdC5zdGFydCA+IG5hbWVUb2suZW5kKTtcbiAgaWYgKGRvVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICBjb25zdCBkb25lVG9rID0gdG9rcy5maW5kKCh0KSA9PiB0LnN0YXJ0ID4gZG9Ub2suZW5kICYmIHQud29yZCA9PT0gJ2RvbmUnICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICBpZiAoZG9uZVRvayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW5Ub2sgPSB0b2tzLmZpbmQoXG4gICAgKHQpID0+IHQuc3RhcnQgPiBuYW1lVG9rLmVuZCAmJiB0LnN0YXJ0IDwgZG9Ub2suc3RhcnQgJiYgdC53b3JkID09PSAnaW4nICYmIHQuY29uc3RydWN0RGVwdGggPT09IDFcbiAgKTtcbiAgbGV0IGxpc3Q6IHN0cmluZ1tdIHwgbnVsbCA9IG51bGw7XG4gIGlmIChpblRvayAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbGlzdCA9IHRva3MuZmlsdGVyKCh0KSA9PiB0LnN0YXJ0ID4gaW5Ub2suZW5kICYmIHQuc3RhcnQgPCBkb1Rvay5zdGFydCkubWFwKCh0KSA9PiB0LndvcmQpO1xuICB9XG4gIHJldHVybiB7IGxpc3QsIGJvZHk6IHRleHQuc2xpY2UoZG9Ub2suZW5kLCBkb25lVG9rLnN0YXJ0KSwgd2hvbGVJbnRlcmlvcjogdGV4dC5zbGljZShuYW1lVG9rLmVuZCwgZG9uZVRvay5zdGFydCkgfTtcbn1cblxuaW50ZXJmYWNlIFBhcnNlZENhc2Uge1xuICBzdWJqZWN0OiBzdHJpbmc7XG4gIGJyYW5jaGVzOiB7IHBhdHRlcm46IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXTtcbiAgZmFsbHRocm91Z2g6IGJvb2xlYW47XG59XG5cbmZ1bmN0aW9uIHBhcnNlQ2FzZSh0ZXh0OiBzdHJpbmcpOiBQYXJzZWRDYXNlIHwgbnVsbCB7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHRleHQubGVuZ3RoO1xuICBjb25zdCBza2lwV3MgPSAoKSA9PiB7XG4gICAgd2hpbGUgKGkgPCBuICYmIC9cXHMvLnRlc3QodGV4dFtpXSkpIGkrKztcbiAgfTtcbiAgc2tpcFdzKCk7XG4gIGNvbnN0IGxlYWQgPSByZWFkV29yZEF0KHRleHQsIGkpO1xuICBpZiAobGVhZCA9PT0gbnVsbCB8fCBsZWFkLndvcmQgIT09ICdjYXNlJykgcmV0dXJuIG51bGw7XG4gIGkgPSBsZWFkLmVuZDtcblxuICAvLyBUaGUgc3ViamVjdCB3b3JkcyB1cCB0byB0aGUgYGluYCBhdCBwYXJlbiBkZXB0aCAwIChxdW90ZSBjb250ZW50IG9ubHkpLlxuICBsZXQgcGFyZW5EZXB0aCA9IDA7XG4gIGNvbnN0IHN1YmplY3RXb3Jkczogc3RyaW5nW10gPSBbXTtcbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgc2tpcFdzKCk7XG4gICAgaWYgKGkgPj0gbikgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgYyA9IHRleHRbaV07XG4gICAgaWYgKGMgPT09ICcoJykge1xuICAgICAgcGFyZW5EZXB0aCsrO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScpIHtcbiAgICAgIHBhcmVuRGVwdGggPSBNYXRoLm1heCgwLCBwYXJlbkRlcHRoIC0gMSk7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCc7Jnw8PicuaW5jbHVkZXMoYykpIHtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCB3ID0gcmVhZFdvcmRBdCh0ZXh0LCBpKTtcbiAgICBpZiAodyA9PT0gbnVsbCkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGkgPSB3LmVuZDtcbiAgICBpZiAocGFyZW5EZXB0aCA9PT0gMCAmJiAhdy5xdW90ZWQgJiYgdy53b3JkID09PSAnaW4nKSBicmVhaztcbiAgICBzdWJqZWN0V29yZHMucHVzaCh3LndvcmQpO1xuICB9XG4gIGlmIChpID49IG4pIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGJyYW5jaGVzOiB7IHBhdHRlcm46IHN0cmluZzsgYm9keTogc3RyaW5nIH1bXSA9IFtdO1xuICBsZXQgZmFsbHRocm91Z2ggPSBmYWxzZTtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBza2lwV3MoKTtcbiAgICBpZiAoaSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCB3ID0gcmVhZFdvcmRBdCh0ZXh0LCBpKTtcbiAgICBpZiAodyAhPT0gbnVsbCAmJiAhdy5xdW90ZWQgJiYgdy53b3JkID09PSAnZXNhYycpIHtcbiAgICAgIHJldHVybiB7IHN1YmplY3Q6IHN1YmplY3RXb3Jkcy5qb2luKCcgJyksIGJyYW5jaGVzLCBmYWxsdGhyb3VnaCB9O1xuICAgIH1cbiAgICAvLyBUaGUgcGF0dGVybjogZXZlcnl0aGluZyB1cCB0byB0aGUgYClgIGF0IHBhcmVuIGRlcHRoIDAuXG4gICAgbGV0IHBhdEVuZCA9IC0xO1xuICAgIHtcbiAgICAgIGxldCBwID0gaTtcbiAgICAgIGxldCBkZXB0aCA9IDA7XG4gICAgICBsZXQgaW5RdW90ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICB3aGlsZSAocCA8IG4pIHtcbiAgICAgICAgY29uc3QgY2ggPSB0ZXh0W3BdO1xuICAgICAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGluUXVvdGUgPT09ICdcIicgJiYgcCArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXModGV4dFtwICsgMV0pKSB7XG4gICAgICAgICAgICBwICs9IDI7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGNoID09PSBpblF1b3RlKSBpblF1b3RlID0gbnVsbDtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSBcIidcIiB8fCBjaCA9PT0gJ1wiJykge1xuICAgICAgICAgIGluUXVvdGUgPSBjaDtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnXFxcXCcpIHtcbiAgICAgICAgICBwICs9IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnKCcpIHtcbiAgICAgICAgICBkZXB0aCsrO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICcpJykge1xuICAgICAgICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgICAgICAgcGF0RW5kID0gcDtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBkZXB0aC0tO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBwKys7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChwYXRFbmQgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBwYXR0ZXJuID0gdGV4dC5zbGljZShpLCBwYXRFbmQpLnRyaW0oKTtcbiAgICBpID0gcGF0RW5kICsgMTtcblxuICAgIC8vIFRoZSBib2R5OiBldmVyeXRoaW5nIHVwIHRvIHRoZSBgOztgL2A7JmAvYDs7JmAgYXQgcGFyZW4vYnJhY2UgZGVwdGggMC5cbiAgICBsZXQgYm9keUVuZCA9IC0xO1xuICAgIGxldCB0ZXJtID0gJyc7XG4gICAge1xuICAgICAgbGV0IHAgPSBpO1xuICAgICAgbGV0IGRlcHRoID0gMDtcbiAgICAgIGxldCBiZGVwdGggPSAwO1xuICAgICAgbGV0IGluUXVvdGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgd2hpbGUgKHAgPCBuKSB7XG4gICAgICAgIGNvbnN0IGNoID0gdGV4dFtwXTtcbiAgICAgICAgaWYgKGluUXVvdGUgIT09IG51bGwpIHtcbiAgICAgICAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpblF1b3RlID09PSAnXCInICYmIHAgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHRleHRbcCArIDFdKSkge1xuICAgICAgICAgICAgcCArPSAyO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChjaCA9PT0gaW5RdW90ZSkgaW5RdW90ZSA9IG51bGw7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gXCInXCIgfHwgY2ggPT09ICdcIicpIHtcbiAgICAgICAgICBpblF1b3RlID0gY2g7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJ1xcXFwnKSB7XG4gICAgICAgICAgcCArPSAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJygnKSB7XG4gICAgICAgICAgZGVwdGgrKztcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnKScpIHtcbiAgICAgICAgICBkZXB0aCA9IE1hdGgubWF4KDAsIGRlcHRoIC0gMSk7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJ3snKSB7XG4gICAgICAgICAgYmRlcHRoKys7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJ30nKSB7XG4gICAgICAgICAgYmRlcHRoID0gTWF0aC5tYXgoMCwgYmRlcHRoIC0gMSk7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCAmJiBiZGVwdGggPT09IDAgJiYgY2ggPT09ICc7Jykge1xuICAgICAgICAgIGNvbnN0IG5leHQgPSB0ZXh0W3AgKyAxXTtcbiAgICAgICAgICBpZiAobmV4dCA9PT0gJzsnIHx8IG5leHQgPT09ICcmJykge1xuICAgICAgICAgICAgdGVybSA9IG5leHQgPT09ICc7JyA/ICh0ZXh0W3AgKyAyXSA9PT0gJyYnID8gJzs7JicgOiAnOzsnKSA6ICc7Jic7XG4gICAgICAgICAgICBib2R5RW5kID0gcDtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBwKys7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICh0ZXJtID09PSAnJykgcmV0dXJuIG51bGw7XG4gICAgYnJhbmNoZXMucHVzaCh7IHBhdHRlcm4sIGJvZHk6IHRleHQuc2xpY2UoaSwgYm9keUVuZCkudHJpbSgpIH0pO1xuICAgIGkgPSBib2R5RW5kICsgdGVybS5sZW5ndGg7XG4gICAgaWYgKHRlcm0gPT09ICc7JicgfHwgdGVybSA9PT0gJzs7JicpIGZhbGx0aHJvdWdoID0gdHJ1ZTtcbiAgfVxufVxuXG4vKiogUmVzb2x2ZSBhIGBjYXNlYCBzdWJqZWN0IGFnYWluc3QgdGhlIHJlY29yZGVkIGFzc2lnbm1lbnRzIChwbGFuIFx1MDBBNzEsIGRlY2lkYWJsZSBjYXNlKS4gKi9cbmZ1bmN0aW9uIHJlc29sdmVTdWJqZWN0KHN1YmplY3Q6IHN0cmluZywgYXNzaWdubWVudHM6IE1hcDxzdHJpbmcsIHN0cmluZz4pOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgbSA9IHN1YmplY3QubWF0Y2goL15cXCQoW0EtWmEtel9dW0EtWmEtejAtOV9dKikkLykgPz8gc3ViamVjdC5tYXRjaCgvXlxcJFxceyhbQS1aYS16X11bQS1aYS16MC05X10qKVxcfSQvKTtcbiAgaWYgKG0gIT09IG51bGwpIHtcbiAgICBjb25zdCB2ID0gYXNzaWdubWVudHMuZ2V0KG1bMV0pO1xuICAgIHJldHVybiB2ICE9PSB1bmRlZmluZWQgPyB2IDogbnVsbDtcbiAgfVxuICBpZiAoL1skYF0vLnRlc3Qoc3ViamVjdCkpIHJldHVybiBudWxsO1xuICByZXR1cm4gc3ViamVjdDtcbn1cblxuLyoqXG4gKiBBbHRlcm5hdGl2ZSBzcGxpdCBvZiBhIGBjYXNlYCBwYXR0ZXJuIG9uIHVucXVvdGVkIGB8YC4gVGhlIGFsdGVybmF0aXZlcyBhcmVcbiAqIHJldHVybmVkIHZlcmJhdGltIFx1MjAxNCBxdW90ZXMgYW5kIGJhY2tzbGFzaCBlc2NhcGVzIHByZXNlcnZlZCBcdTIwMTQgc29cbiAqIGBhbmFseXplUGF0dGVybmAncyBxdW90ZSBoYW5kbGluZyBpcyB0aGUgc2luZ2xlIGludGVycHJldGVyOiBzdHJpcHBpbmcgdGhlbVxuICogaGVyZSB3b3VsZCB0dXJuIGAnYSonYCBpbnRvIGFuIHVucXVvdGVkIGdsb2IgYW5kIGBcXHxgIGludG8gYSBzcGxpdCBwb2ludC5cbiAqL1xuZnVuY3Rpb24gc3BsaXRQYXR0ZXJuQWx0ZXJuYXRpdmVzKHBhdHRlcm46IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXIgPSAnJztcbiAgbGV0IGluUXVvdGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhdHRlcm4ubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IHBhdHRlcm5baV07XG4gICAgaWYgKGluUXVvdGUgIT09IG51bGwpIHtcbiAgICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGluUXVvdGUgPT09ICdcIicgJiYgaSArIDEgPCBwYXR0ZXJuLmxlbmd0aCAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHBhdHRlcm5baSArIDFdKSkge1xuICAgICAgICBjdXIgKz0gY2g7XG4gICAgICAgIGN1ciArPSBwYXR0ZXJuW2kgKyAxXTtcbiAgICAgICAgaSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjaCA9PT0gaW5RdW90ZSkge1xuICAgICAgICBpblF1b3RlID0gbnVsbDtcbiAgICAgICAgY3VyICs9IGNoO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGN1ciArPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09IFwiJ1wiIHx8IGNoID09PSAnXCInKSB7XG4gICAgICBpblF1b3RlID0gY2g7XG4gICAgICBjdXIgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaSArIDEgPCBwYXR0ZXJuLmxlbmd0aCkge1xuICAgICAgY3VyICs9IGNoO1xuICAgICAgY3VyICs9IHBhdHRlcm5baSArIDFdO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ3wnKSB7XG4gICAgICBwYXJ0cy5wdXNoKGN1cik7XG4gICAgICBjdXIgPSAnJztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjdXIgKz0gY2g7XG4gIH1cbiAgcGFydHMucHVzaChjdXIpO1xuICByZXR1cm4gcGFydHM7XG59XG5cbi8qKlxuICogUXVvdGUtYXdhcmUgcGF0dGVybiBhbmFseXNpczogdGhlIGxpdGVyYWwgdmFsdWUgKHF1b3RlcyBzdHJpcHBlZCwgYmFja3NsYXNoXG4gKiBlc2NhcGVzIHJlc29sdmVkKSBhbmQgd2hldGhlciBhbnkgdW5xdW90ZWQgZ2xvYiBjaGFyIGFwcGVhcnMuXG4gKi9cbmZ1bmN0aW9uIGFuYWx5emVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IHsgbGl0ZXJhbDogc3RyaW5nOyBnbG9iOiBib29sZWFuIH0ge1xuICBsZXQgbGl0ZXJhbCA9ICcnO1xuICBsZXQgZ2xvYiA9IGZhbHNlO1xuICBsZXQgaW5RdW90ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGF0dGVybi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gcGF0dGVybltpXTtcbiAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaW5RdW90ZSA9PT0gJ1wiJyAmJiBpICsgMSA8IHBhdHRlcm4ubGVuZ3RoICYmICdcIlxcXFwkYCcuaW5jbHVkZXMocGF0dGVybltpICsgMV0pKSB7XG4gICAgICAgIGxpdGVyYWwgKz0gcGF0dGVybltpICsgMV07XG4gICAgICAgIGkrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoY2ggPT09IGluUXVvdGUpIHtcbiAgICAgICAgaW5RdW90ZSA9IG51bGw7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgbGl0ZXJhbCArPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09IFwiJ1wiIHx8IGNoID09PSAnXCInKSB7XG4gICAgICBpblF1b3RlID0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaSArIDEgPCBwYXR0ZXJuLmxlbmd0aCkge1xuICAgICAgbGl0ZXJhbCArPSBwYXR0ZXJuW2kgKyAxXTtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoJyo/WycuaW5jbHVkZXMoY2gpKSB7XG4gICAgICBnbG9iID0gdHJ1ZTtcbiAgICAgIGxpdGVyYWwgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgbGl0ZXJhbCArPSBjaDtcbiAgfVxuICByZXR1cm4geyBsaXRlcmFsLCBnbG9iIH07XG59XG5cbnR5cGUgUGF0dGVyblJlc3VsdCA9ICdtYXRjaCcgfCAnbm8tbWF0Y2gnIHwgJ2dsb2InIHwgJ3VuZGVjaWRhYmxlJztcblxuLyoqXG4gKiBGaXh0dXJlLXBpbm5lZCBgY2FzZWAgcGF0dGVybiBldmFsdWF0aW9uIChwbGFuIFx1MDBBNzEsIGRlY2lkYWJsZSBjYXNlKTogYSBgfGBcbiAqIHBhdHRlcm4gaXMgZGVjaWRhYmxlIGlmZiBpdHMgZmlyc3QgYWx0ZXJuYXRpdmUgaXMgYSBsaXRlcmFsIG1hdGNoIGFuZCBldmVyeVxuICogYWx0ZXJuYXRpdmUgYWZ0ZXIgdGhlIGZpcnN0IGlzIGEgZ2xvYiAoZGVhZCk7IGEgZ2xvYiBiZWZvcmUgYW55IGxpdGVyYWxcbiAqIG1hdGNoIGlzIHVuZGVjaWRhYmxlLCBhbmQgYSBsYXRlciBsaXRlcmFsIG5vbi1tYXRjaCBhZnRlciBhIGxpdGVyYWwgbWF0Y2hcbiAqIGlzIHVuZGVjaWRhYmxlICh0aGUgYWxsLWxpdGVyYWwgYGF8YmAgZmFpbC1jbG9zZWQgZGl2ZXJnZW5jZSBcdTIwMTQgYmFzaCBydW5zXG4gKiB0aGUgYnJhbmNoKS5cbiAqL1xuZnVuY3Rpb24gZXZhbFBhdHRlcm4ocGF0dGVybjogc3RyaW5nLCBzdWJqZWN0OiBzdHJpbmcpOiBQYXR0ZXJuUmVzdWx0IHtcbiAgY29uc3QgYWx0cyA9IHNwbGl0UGF0dGVybkFsdGVybmF0aXZlcyhwYXR0ZXJuKTtcbiAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCBhbHQgb2YgYWx0cykge1xuICAgIGNvbnN0IHsgbGl0ZXJhbCwgZ2xvYiB9ID0gYW5hbHl6ZVBhdHRlcm4oYWx0KTtcbiAgICBpZiAoZ2xvYikge1xuICAgICAgaWYgKCFtYXRjaGVkKSByZXR1cm4gJ2dsb2InO1xuICAgIH0gZWxzZSBpZiAobGl0ZXJhbCA9PT0gc3ViamVjdCkge1xuICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgfSBlbHNlIGlmIChtYXRjaGVkKSB7XG4gICAgICByZXR1cm4gJ3VuZGVjaWRhYmxlJztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1hdGNoZWQgPyAnbWF0Y2gnIDogJ25vLW1hdGNoJztcbn1cblxuLyoqIFRoZSBleGVjdXRpb24gd2FsaydzIHNoYXJlZCBzdGF0ZSwgb25lIGluc3RhbmNlIHBlciBgcGFyc2VDb21tYW5kRGV0YWlsZWRgIGNhbGwuICovXG5jbGFzcyBFeGVjdXRpb25XYWxrZXIge1xuICBjaGFpbjogQ2hhaW5TdGF0dXMgPSAnc3VjY2Vzcyc7XG4gIGVycmV4aXQgPSBmYWxzZTtcbiAgcGlwZWZhaWwgPSBmYWxzZTtcbiAgYXNzaWdubWVudHMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICBkZWZzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcbiAgZGVhZDogRGVhZEtpbmQgfCBudWxsID0gbnVsbDtcbiAgcmV0dXJuZWQgPSBmYWxzZTtcbiAgZm5EZXB0aCA9IDA7XG4gIGxvb3BTdGFjazogTG9vcEZyYW1lW10gPSBbXTtcbiAgcmVhZG9ubHkgZXhwYW5kZWQ6IEV4cGFuZGVkU3RhZ2VbXSA9IFtdO1xuICByZWFkb25seSB2ZXJkaWN0czogRXhlY1N0YXR1c1tdID0gW107XG4gIGRpckZyYW1lID0gMDtcbiAgcmVhZG9ubHkgZGVmUHJvYmVTdGFjayA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIHdhbGtJbnB1dChzdGFnZXM6IFNpbXBsZUNvbW1hbmRbXSk6IEV4cGFuZGVkU3RhZ2VbXSB7XG4gICAgdGhpcy53YWxrTGlzdChzdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQ6IGZhbHNlLCBzaWRlRWZmZWN0czogdHJ1ZSwgaW5wdXRGYWNpbmc6IHRydWUgfSk7XG4gICAgcmV0dXJuIHRoaXMuZXhwYW5kZWQ7XG4gIH1cblxuICBwcml2YXRlIHN0b3BwZWQoKTogYm9vbGVhbiB7XG4gICAgaWYgKHRoaXMuZGVhZCAhPT0gbnVsbCB8fCB0aGlzLnJldHVybmVkKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCB0b3AgPSB0aGlzLmxvb3BTdGFja1t0aGlzLmxvb3BTdGFjay5sZW5ndGggLSAxXTtcbiAgICByZXR1cm4gdG9wICE9PSB1bmRlZmluZWQgJiYgKHRvcC5ib2R5VGVybWluYXRlZCB8fCB0b3AuYW1iaWd1b3VzU3RvcCk7XG4gIH1cblxuICAvKiogV2FsayBvbmUgbGlzdCAoYSBmcmVzaCBgJiZgL2B8fGAgY2hhaW4pOyByZXR1cm5zIHRoZSBsaXN0J3MgZmluYWwgY2hhaW4gc3RhdHVzLiAqL1xuICBwcml2YXRlIHdhbGtMaXN0KHN0YWdlczogU2ltcGxlQ29tbWFuZFtdLCBvcHRzOiBXYWxrT3B0aW9ucyk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCBzYXZlZENoYWluID0gdGhpcy5jaGFpbjtcbiAgICB0aGlzLmNoYWluID0gJ3N1Y2Nlc3MnO1xuICAgIGxldCBpID0gMDtcbiAgICB3aGlsZSAoaSA8IHN0YWdlcy5sZW5ndGggJiYgIXRoaXMuc3RvcHBlZCgpKSB7XG4gICAgICBjb25zdCBlbmQgPSB0aGlzLmdyb3VwRW5kKHN0YWdlcywgaSk7XG4gICAgICBjb25zdCBuZXh0ID0gZW5kIDwgc3RhZ2VzLmxlbmd0aCA/IHN0YWdlc1tlbmRdIDogbnVsbDtcbiAgICAgIHRoaXMucHJvY2Vzc0dyb3VwKHN0YWdlcy5zbGljZShpLCBlbmQpLCBuZXh0LCBvcHRzKTtcbiAgICAgIGkgPSBlbmQ7XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuY2hhaW47XG4gICAgd2hpbGUgKGkgPCBzdGFnZXMubGVuZ3RoKSB7XG4gICAgICBpZiAob3B0cy5pbnB1dEZhY2luZykgdGhpcy52ZXJkaWN0cy5wdXNoKCdubycpO1xuICAgICAgaSsrO1xuICAgIH1cbiAgICB0aGlzLmNoYWluID0gc2F2ZWRDaGFpbjtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBncm91cEVuZChzdGFnZXM6IFNpbXBsZUNvbW1hbmRbXSwgc3RhcnQ6IG51bWJlcik6IG51bWJlciB7XG4gICAgbGV0IGVuZCA9IHN0YXJ0O1xuICAgIHdoaWxlIChlbmQgKyAxIDwgc3RhZ2VzLmxlbmd0aCAmJiBzdGFnZXNbZW5kICsgMV0ucHJlY2VkZWRCeSA9PT0gJ3BpcGUnKSBlbmQrKztcbiAgICByZXR1cm4gZW5kICsgMTtcbiAgfVxuXG4gIHByaXZhdGUgcHJvY2Vzc0dyb3VwKGdyb3VwOiBTaW1wbGVDb21tYW5kW10sIG5leHQ6IFNpbXBsZUNvbW1hbmQgfCBudWxsLCBvcHRzOiBXYWxrT3B0aW9ucyk6IHZvaWQge1xuICAgIGNvbnN0IGZpcnN0ID0gZ3JvdXBbMF07XG4gICAgbGV0IGV4ZWN1dGVzOiBib29sZWFuIHwgJ3Vua25vd24nO1xuICAgIHN3aXRjaCAoZmlyc3QucHJlY2VkZWRCeSkge1xuICAgICAgY2FzZSAnYW5kJzpcbiAgICAgICAgZXhlY3V0ZXMgPSB0aGlzLmNoYWluID09PSAnc3VjY2VzcycgPyB0cnVlIDogdGhpcy5jaGFpbiA9PT0gJ2ZhaWx1cmUnID8gZmFsc2UgOiAndW5rbm93bic7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnb3InOlxuICAgICAgICBleGVjdXRlcyA9IHRoaXMuY2hhaW4gPT09ICdmYWlsdXJlJyA/IHRydWUgOiB0aGlzLmNoYWluID09PSAnc3VjY2VzcycgPyBmYWxzZSA6ICd1bmtub3duJztcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBleGVjdXRlcyA9IHRydWU7XG4gICAgfVxuICAgIGNvbnN0IGV4ZWM6IEV4ZWNTdGF0dXMgPSBleGVjdXRlcyA9PT0gdHJ1ZSA/ICd5ZXMnIDogZXhlY3V0ZXMgPT09IGZhbHNlID8gJ25vJyA6ICd1bmtub3duJztcbiAgICBjb25zdCBiYWNrZ3JvdW5kZWQgPSBmaXJzdC5wcmVjZWRlZEJ5ID09PSAnYmFja2dyb3VuZCcgfHwgKG5leHQgIT09IG51bGwgJiYgbmV4dC5wcmVjZWRlZEJ5ID09PSAnYmFja2dyb3VuZCcpO1xuICAgIGlmIChvcHRzLmlucHV0RmFjaW5nKSB7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGdyb3VwLmxlbmd0aDsgaSsrKSB0aGlzLnZlcmRpY3RzLnB1c2goZXhlYyk7XG4gICAgfVxuXG4gICAgLy8gYCFgIGlzIGEgZ3JvdXAtbGV2ZWwgbW9kaWZpZXI6IHRoZSBjb3VudCBvZiBsZWFkaW5nIGAhYCB3b3JkcyBvbiB0aGVcbiAgICAvLyBmaXJzdCBtZW1iZXIncyBhcmd2IG5lZ2F0ZXMgdGhlIGdyb3VwJ3MgZmluYWwgc3RhdHVzIChvZGQgbmVnYXRlcykuXG4gICAgY29uc3QgZmlyc3RBcmd2ID0gYXJndk9mKGZpcnN0LnRleHQpO1xuICAgIGxldCBiYW5nQ291bnQgPSAwO1xuICAgIGxldCBtZW1iZXJBcmd2OiBzdHJpbmdbXSB8IG51bGwgPSBmaXJzdEFyZ3Y7XG4gICAgaWYgKGZpcnN0QXJndiAhPT0gbnVsbCkge1xuICAgICAgd2hpbGUgKG1lbWJlckFyZ3YhW2JhbmdDb3VudF0gPT09ICchJykgYmFuZ0NvdW50Kys7XG4gICAgICBtZW1iZXJBcmd2ID0gbWVtYmVyQXJndiEuc2xpY2UoYmFuZ0NvdW50KTtcbiAgICB9XG4gICAgY29uc3QgaW52ZXJ0ZWQgPSBiYW5nQ291bnQgJSAyID09PSAxO1xuXG4gICAgaWYgKGV4ZWMgPT09ICdubycpIHJldHVybjtcblxuICAgIGNvbnN0IHN0YXR1c2VzOiBDaGFpblN0YXR1c1tdID0gW107XG4gICAgY29uc3QgaW5QaXBlbGluZSA9IGdyb3VwLmxlbmd0aCA+IDE7XG4gICAgZm9yIChsZXQgbSA9IDA7IG0gPCBncm91cC5sZW5ndGg7IG0rKykge1xuICAgICAgc3RhdHVzZXMucHVzaChcbiAgICAgICAgdGhpcy5wcm9jZXNzTWVtYmVyKGdyb3VwW21dLCB7XG4gICAgICAgICAgZXhlYyxcbiAgICAgICAgICBpblBpcGVsaW5lLFxuICAgICAgICAgIGJhY2tncm91bmRlZCxcbiAgICAgICAgICBtZW1iZXJBcmd2OiBtID09PSAwID8gbWVtYmVyQXJndiA6IG51bGwsXG4gICAgICAgICAgb3B0c1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBUaGUgZ3JvdXAgc3RhdHVzOiB0aGUgbGFzdCBtZW1iZXIncywgdW5sZXNzIHBpcGVmYWlsIG1ha2VzIGl0IHRoZSB3b3JzdCBtZW1iZXIuXG4gICAgbGV0IGdyb3VwU3RhdHVzOiBDaGFpblN0YXR1cztcbiAgICBpZiAodGhpcy5waXBlZmFpbCAmJiBncm91cC5sZW5ndGggPiAxKSB7XG4gICAgICBpZiAoc3RhdHVzZXMuZXZlcnkoKHMpID0+IHMgPT09ICdzdWNjZXNzJykpIGdyb3VwU3RhdHVzID0gJ3N1Y2Nlc3MnO1xuICAgICAgZWxzZSBpZiAoc3RhdHVzZXMuc29tZSgocykgPT4gcyA9PT0gJ2ZhaWx1cmUnKSkgZ3JvdXBTdGF0dXMgPSAnZmFpbHVyZSc7XG4gICAgICBlbHNlIGdyb3VwU3RhdHVzID0gJ3Vua25vd24nO1xuICAgIH0gZWxzZSB7XG4gICAgICBncm91cFN0YXR1cyA9IHN0YXR1c2VzW3N0YXR1c2VzLmxlbmd0aCAtIDFdO1xuICAgIH1cbiAgICBpZiAoaW52ZXJ0ZWQpIHtcbiAgICAgIGdyb3VwU3RhdHVzID0gZ3JvdXBTdGF0dXMgPT09ICdzdWNjZXNzJyA/ICdmYWlsdXJlJyA6IGdyb3VwU3RhdHVzID09PSAnZmFpbHVyZScgPyAnc3VjY2VzcycgOiAndW5rbm93bic7XG4gICAgfVxuXG4gICAgLy8gRXJyZXhpdCBsaXZlbmVzczogYW4gZXhlY3V0aW5nIGdyb3VwIHdob3NlIG5vbi1leGVtcHQgbWVtYmVycyBkaWQgbm90XG4gICAgLy8gYWxsIHN1Y2NlZWQga2lsbHMgdGhlIHNoZWxsOyBldmVyeSBsYXRlciBzdGFnZSBpcyAnbm8nLlxuICAgIGlmIChvcHRzLmxpdmVuZXNzICYmIHRoaXMuZXJyZXhpdCAmJiBncm91cFN0YXR1cyAhPT0gJ3N1Y2Nlc3MnKSB7XG4gICAgICBjb25zdCBjaGFpbkZpbmFsID0gbmV4dCA9PT0gbnVsbCB8fCAobmV4dC5wcmVjZWRlZEJ5ICE9PSAnYW5kJyAmJiBuZXh0LnByZWNlZGVkQnkgIT09ICdvcicpO1xuICAgICAgaWYgKGNoYWluRmluYWwgJiYgIWludmVydGVkICYmICFiYWNrZ3JvdW5kZWQpIHRoaXMuZGVhZCA9ICdlcnJleGl0JztcbiAgICB9XG5cbiAgICBpZiAoZXhlYyA9PT0gJ3llcycpIHRoaXMuY2hhaW4gPSBncm91cFN0YXR1cztcbiAgICBlbHNlIHRoaXMuY2hhaW4gPSAndW5rbm93bic7XG4gIH1cblxuICBwcml2YXRlIHByb2Nlc3NNZW1iZXIoXG4gICAgbWVtYmVyOiBTaW1wbGVDb21tYW5kLFxuICAgIGN0eDoge1xuICAgICAgZXhlYzogRXhlY1N0YXR1cztcbiAgICAgIGluUGlwZWxpbmU6IGJvb2xlYW47XG4gICAgICBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW47XG4gICAgICBtZW1iZXJBcmd2OiBzdHJpbmdbXSB8IG51bGw7XG4gICAgICBvcHRzOiBXYWxrT3B0aW9ucztcbiAgICB9XG4gICk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCBraW5kID0gY2xhc3NpZnlTdGFnZShtZW1iZXIudGV4dCk7XG4gICAgaWYgKGtpbmQgPT09ICdwbGFpbicpIHJldHVybiB0aGlzLnByb2Nlc3NQbGFpbk1lbWJlcihtZW1iZXIsIGN0eCk7XG4gICAgcmV0dXJuIHRoaXMucHJvY2Vzc0NvbnN0cnVjdChtZW1iZXIsIGtpbmQsIGN0eCk7XG4gIH1cblxuICBwcml2YXRlIHByb2Nlc3NQbGFpbk1lbWJlcihcbiAgICBtZW1iZXI6IFNpbXBsZUNvbW1hbmQsXG4gICAgY3R4OiB7XG4gICAgICBleGVjOiBFeGVjU3RhdHVzO1xuICAgICAgaW5QaXBlbGluZTogYm9vbGVhbjtcbiAgICAgIGJhY2tncm91bmRlZDogYm9vbGVhbjtcbiAgICAgIG1lbWJlckFyZ3Y6IHN0cmluZ1tdIHwgbnVsbDtcbiAgICAgIG9wdHM6IFdhbGtPcHRpb25zO1xuICAgIH1cbiAgKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IHsgZXhlYywgaW5QaXBlbGluZSwgYmFja2dyb3VuZGVkLCBtZW1iZXJBcmd2LCBvcHRzIH0gPSBjdHg7XG4gICAgY29uc3QgYXJndiA9IG1lbWJlckFyZ3YgPz8gYXJndk9mKG1lbWJlci50ZXh0KTtcbiAgICBjb25zdCBzdHJpcHBlZCA9IGFyZ3YgPT09IG51bGwgPyBudWxsIDogd2Fsa1N0cmlwKGFyZ3YpO1xuXG4gICAgLy8gU2lkZSBlZmZlY3RzIG9ubHkgZnJvbSBleGVjdXRlZCwgbm9uLXBpcGUgc3RhZ2VzLlxuICAgIGlmIChleGVjID09PSAneWVzJyAmJiAhaW5QaXBlbGluZSAmJiBvcHRzLnNpZGVFZmZlY3RzKSB7XG4gICAgICB0aGlzLmFwcGx5U2lkZUVmZmVjdHMobWVtYmVyLCBhcmd2LCBzdHJpcHBlZCk7XG4gICAgfVxuXG4gICAgLy8gVGhlIGtub3duIHN0YXR1cy5cbiAgICBjb25zdCBzdGF0dXMgPSB0aGlzLmtub3duU3RhdHVzKGFyZ3YpO1xuXG4gICAgLy8gVGhlIHRlcm1pbmF0b3I6IGFuIGV4ZWN1dGVkIG9yIHVua25vd24tZXhlY3V0aW9uIG5vbi1waXBlIHN0YWdlIHdob3NlXG4gICAgLy8gdGVybWluYXRvciB3b3JkIChiYXJlLCBvciBiZWhpbmQgYGNvbW1hbmRgL2BidWlsdGluYCkgaXMgYGV4aXRgL2BleGVjYC5cbiAgICBpZiAoIWluUGlwZWxpbmUgJiYgZXhlYyAhPT0gJ25vJyAmJiBzdHJpcHBlZCAhPT0gbnVsbCAmJiAoc3RyaXBwZWRbMF0gPT09ICdleGl0JyB8fCBzdHJpcHBlZFswXSA9PT0gJ2V4ZWMnKSkge1xuICAgICAgdGhpcy5kZWFkID0gJ2V4aXQnO1xuICAgIH1cblxuICAgIC8vIFJldHVybi1zdG9wcGluZzogYSBwcm92YWJseS1maXJpbmcgY29tbWFuZC1wb3NpdGlvbiBgcmV0dXJuYCBhdFxuICAgIC8vIGZ1bmN0aW9uLWJvZHkgZGVwdGggZXhpdHMgdGhlIGZ1bmN0aW9uIFx1MjAxNCBldmVyeXRoaW5nIGFmdGVyIG5ldmVyIHJ1bnMuXG4gICAgaWYgKCFpblBpcGVsaW5lICYmIGV4ZWMgPT09ICd5ZXMnICYmIHRoaXMuZm5EZXB0aCA+IDAgJiYgc3RyaXBwZWQgIT09IG51bGwgJiYgc3RyaXBwZWRbMF0gPT09ICdyZXR1cm4nKSB7XG4gICAgICB0aGlzLnJldHVybmVkID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHRvcCA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDFdO1xuICAgICAgaWYgKHRvcCAhPT0gdW5kZWZpbmVkKSB0b3Aub3V0Y29tZSA9ICdyZXR1cm4nO1xuICAgIH1cblxuICAgIC8vIEJyZWFrL2NvbnRpbnVlIGV2ZW50cyAoYSBoaWRkZW4gYCd1bmtub3duJ2AtZXhlYyBvbmUgbWFrZXMgdGhlIGd1YXJkXG4gICAgLy8gdW50b3VjaGFibGUgXHUyMDE0IGFtYmlndW91cyBcdTIwMTQgcGVyIHRoZSBsb29wLXNjYW4gZGlzY2lwbGluZSkuXG4gICAgaWYgKCFpblBpcGVsaW5lICYmIGV4ZWMgIT09ICdubycgJiYgc3RyaXBwZWQgIT09IG51bGwgJiYgKHN0cmlwcGVkWzBdID09PSAnYnJlYWsnIHx8IHN0cmlwcGVkWzBdID09PSAnY29udGludWUnKSkge1xuICAgICAgdGhpcy5hcHBseUJyZWFrQ29udGludWUoc3RyaXBwZWQsIGV4ZWMpO1xuICAgIH1cblxuICAgIC8vIEEgY2FsbCB0byBhIHJlZ2lzdGVyZWQgZGVmaW5pdGlvbi5cbiAgICBpZiAoZXhlYyAhPT0gJ25vJyAmJiBzdHJpcHBlZCAhPT0gbnVsbCAmJiBzdHJpcHBlZC5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmFwcGx5Q2FsbChzdHJpcHBlZFswXSwgaW5QaXBlbGluZSwgYmFja2dyb3VuZGVkKTtcbiAgICB9XG5cbiAgICBpZiAoIW9wdHMuZGlzY2FyZCkge1xuICAgICAgdGhpcy5leHBhbmRlZC5wdXNoKHtcbiAgICAgICAgdGV4dDogbWVtYmVyLnRleHQsXG4gICAgICAgIHByZWNlZGVkQnk6IG1lbWJlci5wcmVjZWRlZEJ5LFxuICAgICAgICBleGVjLFxuICAgICAgICBpblBpcGVsaW5lLFxuICAgICAgICBkaXJGcmFtZTogdGhpcy5kaXJGcmFtZSxcbiAgICAgICAgYXNzaWdubWVudHM6IG5ldyBNYXAodGhpcy5hc3NpZ25tZW50cylcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gc3RhdHVzO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseUJyZWFrQ29udGludWUoc3RyaXBwZWQ6IHN0cmluZ1tdLCBleGVjOiBFeGVjU3RhdHVzKTogdm9pZCB7XG4gICAgY29uc3QgZGVwdGggPSBOdW1iZXIucGFyc2VJbnQoc3RyaXBwZWRbMV0gPz8gJzEnLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihkZXB0aCkgfHwgZGVwdGggPCAxKSByZXR1cm47XG4gICAgaWYgKHRoaXMubG9vcFN0YWNrLmxlbmd0aCA9PT0gMCB8fCBkZXB0aCA+IHRoaXMubG9vcFN0YWNrLmxlbmd0aCkgcmV0dXJuO1xuICAgIGlmIChleGVjID09PSAndW5rbm93bicpIHtcbiAgICAgIGZvciAobGV0IGQgPSAwOyBkIDwgZGVwdGg7IGQrKykge1xuICAgICAgICBjb25zdCBmcmFtZSA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDEgLSBkXTtcbiAgICAgICAgaWYgKGZyYW1lLm91dGNvbWUgPT09ICdub25lJykge1xuICAgICAgICAgIGZyYW1lLm91dGNvbWUgPSAnYW1iaWd1b3VzJztcbiAgICAgICAgICBmcmFtZS5hbWJpZ3VvdXNTdG9wID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBpc0NvbnRpbnVlID0gc3RyaXBwZWRbMF0gPT09ICdjb250aW51ZSc7XG4gICAgZm9yIChsZXQgZCA9IDA7IGQgPCBkZXB0aDsgZCsrKSB7XG4gICAgICBjb25zdCBmcmFtZSA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDEgLSBkXTtcbiAgICAgIGZyYW1lLm91dGNvbWUgPSBpc0NvbnRpbnVlID8gJ2NvbnRpbnVlJyA6ICdicmVhayc7XG4gICAgICBmcmFtZS5ib2R5VGVybWluYXRlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgLyoqIEEgbWF5LXJ1biBjYWxsIHRvIGEgcmVnaXN0ZXJlZCBkZWZpbml0aW9uIGZpcmVzIHBlciBpdHMgYm9keSdzIGRlYWQga2luZC4gKi9cbiAgcHJpdmF0ZSBhcHBseUNhbGwobmFtZTogc3RyaW5nLCBpblBpcGVsaW5lOiBib29sZWFuLCBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW4pOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuZGVmcy5oYXMobmFtZSkgfHwgYmFja2dyb3VuZGVkKSByZXR1cm47XG4gICAgaWYgKHRoaXMuZGVmUHJvYmVTdGFjay5oYXMobmFtZSkpIHJldHVybjsgLy8gcmVjdXJzaW9uOiB0aGUgaW5uZXIgY2FsbCByZXR1cm5zIG5vcm1hbGx5XG4gICAgY29uc3QgYm9keSA9IHRoaXMuZGVmcy5nZXQobmFtZSkhO1xuICAgIHRoaXMuZGVmUHJvYmVTdGFjay5hZGQobmFtZSk7XG4gICAgY29uc3Qga2luZCA9IHRoaXMuZGVmQm9keUZpcmVLaW5kKGJvZHkpO1xuICAgIHRoaXMuZGVmUHJvYmVTdGFjay5kZWxldGUobmFtZSk7XG4gICAgaWYgKGtpbmQgPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAoa2luZCA9PT0gJ25ldmVyLXJldHVybicpIHtcbiAgICAgIHRoaXMuZGVhZCA9ICduZXZlci1yZXR1cm4nO1xuICAgIH0gZWxzZSBpZiAoIWluUGlwZWxpbmUpIHtcbiAgICAgIHRoaXMuZGVhZCA9IGtpbmQ7XG4gICAgfVxuICB9XG5cbiAgLyoqIFdoZXRoZXIgYSBkZWZpbml0aW9uIGJvZHksIHdhbGtlZCBhcyBpdHMgb3duIGZ1bmN0aW9uLCBlbmRzIGRlYWQuICovXG4gIHByaXZhdGUgZGVmQm9keUZpcmVLaW5kKGJvZHk6IHN0cmluZyk6IERlYWRLaW5kIHwgbnVsbCB7XG4gICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChib2R5KTtcbiAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gJ21hbGZvcm1lZCc7XG4gICAgY29uc3Qgc2F2ZWREZWFkID0gdGhpcy5kZWFkO1xuICAgIGNvbnN0IHNhdmVkUmV0dXJuZWQgPSB0aGlzLnJldHVybmVkO1xuICAgIGNvbnN0IHNhdmVkRm5EZXB0aCA9IHRoaXMuZm5EZXB0aDtcbiAgICBjb25zdCBzYXZlZExvb3BTdGFjayA9IHRoaXMubG9vcFN0YWNrO1xuICAgIHRoaXMuZGVhZCA9IG51bGw7XG4gICAgdGhpcy5yZXR1cm5lZCA9IGZhbHNlO1xuICAgIHRoaXMuZm5EZXB0aCA9IHRoaXMuZm5EZXB0aCArIDE7XG4gICAgdGhpcy5sb29wU3RhY2sgPSBbXTtcbiAgICB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQ6IHRydWUsIHNpZGVFZmZlY3RzOiB0cnVlLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgY29uc3Qga2luZCA9IHRoaXMuZGVhZDtcbiAgICB0aGlzLmRlYWQgPSBzYXZlZERlYWQ7XG4gICAgdGhpcy5yZXR1cm5lZCA9IHNhdmVkUmV0dXJuZWQ7XG4gICAgdGhpcy5mbkRlcHRoID0gc2F2ZWRGbkRlcHRoO1xuICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2s7XG4gICAgcmV0dXJuIGtpbmQ7XG4gIH1cblxuICBwcml2YXRlIGtub3duU3RhdHVzKGFyZ3Y6IHN0cmluZ1tdIHwgbnVsbCk6IENoYWluU3RhdHVzIHtcbiAgICBpZiAoYXJndiA9PT0gbnVsbCB8fCBhcmd2Lmxlbmd0aCA9PT0gMCkgcmV0dXJuICdzdWNjZXNzJztcbiAgICAvLyBSZWRpcmVjdHMgYW5kIHRyYW5zcGFyZW50IHdyYXBwZXJzIGFyZSBzdHJpcHBlZCBiZWZvcmUgc3RhdHVzIGV2YWx1YXRpb25cbiAgICAvLyAocGxhbiBcdTAwQTc0L1x1MDBBNzUpOiBgZW52IEZPTz0xIHRydWVgIGFuZCBgdGltZW91dCA1IHRydWVgIGFyZSBrbm93biBzdWNjZXNzZXMsXG4gICAgLy8gYHRydWUgPiBvdXRgIGtlZXBzIGl0cyBzdWNjZXNzLCBhbmQgYSBmYWlsLWNsb3NlZCB3cmFwcGVyIChgZW52IC1pIFx1MjAyNmApXG4gICAgLy8gc3RheXMgdW5rbm93bi5cbiAgICBjb25zdCBhID0gd2Fsa1N0cmlwKHN0cmlwV3JhcHBlcnMoc3RyaXBSZWRpcmVjdHMoYXJndikpKTtcbiAgICBpZiAoYS5sZW5ndGggPT09IDApIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgaWYgKGFbMF0gPT09ICd0cnVlJyB8fCBhWzBdID09PSAnOicpIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgaWYgKGFbMF0gPT09ICdmYWxzZScpIHJldHVybiAnZmFpbHVyZSc7XG4gICAgaWYgKGEuZXZlcnkoKHcpID0+IEFTU0lHTk1FTlRfUkUudGVzdCh3KSkpIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgaWYgKGFbMF0gPT09ICdleHBvcnQnICYmIGEubGVuZ3RoID4gMSAmJiBhLnNsaWNlKDEpLmV2ZXJ5KCh3KSA9PiBBU1NJR05NRU5UX1JFLnRlc3QodykpKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgIGlmIChhWzBdID09PSAnc2V0JykgcmV0dXJuIHNldEZsYWdzS25vd24oYS5zbGljZSgxKSkgPyAnc3VjY2VzcycgOiAndW5rbm93bic7XG4gICAgcmV0dXJuICd1bmtub3duJztcbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlTaWRlRWZmZWN0cyhtZW1iZXI6IFNpbXBsZUNvbW1hbmQsIGFyZ3Y6IHN0cmluZ1tdIHwgbnVsbCwgc3RyaXBwZWQ6IHN0cmluZ1tdIHwgbnVsbCk6IHZvaWQge1xuICAgIGlmIChhcmd2ID09PSBudWxsIHx8IGFyZ3YubGVuZ3RoID09PSAwKSByZXR1cm47XG4gICAgLy8gQXNzaWdubWVudCByZWNvcmRpbmcgKGxhc3QgZGVmaW5pdGlvbiB3aW5zLCBmZWVkaW5nIGNhc2Ugc3ViamVjdHMpLlxuICAgIGNvbnN0IHdvcmRzID0gc3BsaXRXb3JkcyhtZW1iZXIudGV4dCk7XG4gICAgaWYgKHdvcmRzICE9PSBudWxsICYmIHdvcmRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxldCBrID0gMDtcbiAgICAgIHdoaWxlIChrIDwgd29yZHMubGVuZ3RoICYmIEFTU0lHTk1FTlRfUkUudGVzdCh3b3Jkc1trXSkpIGsrKztcbiAgICAgIGlmIChrID09PSB3b3Jkcy5sZW5ndGgpIHtcbiAgICAgICAgZm9yIChjb25zdCB3IG9mIHdvcmRzKSB7XG4gICAgICAgICAgY29uc3QgZXEgPSB3LmluZGV4T2YoJz0nKTtcbiAgICAgICAgICB0aGlzLmFzc2lnbm1lbnRzLnNldCh3LnNsaWNlKDAsIGVxKSwgdy5zbGljZShlcSArIDEpKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh3b3Jkc1swXSA9PT0gJ2V4cG9ydCcpIHtcbiAgICAgICAgZm9yIChjb25zdCB3IG9mIHdvcmRzLnNsaWNlKDEpKSB7XG4gICAgICAgICAgaWYgKEFTU0lHTk1FTlRfUkUudGVzdCh3KSkge1xuICAgICAgICAgICAgY29uc3QgZXEgPSB3LmluZGV4T2YoJz0nKTtcbiAgICAgICAgICAgIHRoaXMuYXNzaWdubWVudHMuc2V0KHcuc2xpY2UoMCwgZXEpLCB3LnNsaWNlKGVxICsgMSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoc3RyaXBwZWQgIT09IG51bGwgJiYgc3RyaXBwZWRbMF0gPT09ICdzZXQnKSB0aGlzLmFwcGx5U2V0RmxhZ3Moc3RyaXBwZWQuc2xpY2UoMSkpO1xuICAgIC8vIFRhYmxlIGxpZmVjeWNsZSAocGxhbiBcdTAwQTc3KTogYW4gZXhlY3V0ZWQgbm9uLXBpcGUgYHVuc2V0IE5BTUVgIGRlbGV0ZXMgdGhlXG4gICAgLy8gZW50cnksIHNvIGBYPS9hOyB1bnNldCBYOyBjYXQgJFgvZmAgc3RheXMgdW5yZXNvbHZlZCBpbnN0ZWFkIG9mXG4gICAgLy8gcmVzdXJyZWN0aW5nIHRoZSBzdGFsZSB2YWx1ZS4gYGV4cG9ydCBOQU1FYCB3aXRob3V0IGEgdmFsdWUgaXMgYSBuby1vcFxuICAgIC8vIGZvciB0aGUgdGFibGUgKGJhc2gga2VlcHMgdGhlIHZhbHVlLCBqdXN0IG1hcmtzIGl0IGV4cG9ydGVkKS5cbiAgICBpZiAoc3RyaXBwZWQgIT09IG51bGwgJiYgc3RyaXBwZWRbMF0gPT09ICd1bnNldCcpIHtcbiAgICAgIGZvciAoY29uc3QgdyBvZiBzdHJpcHBlZC5zbGljZSgxKSkge1xuICAgICAgICBpZiAoIXcuc3RhcnRzV2l0aCgnLScpKSB0aGlzLmFzc2lnbm1lbnRzLmRlbGV0ZSh3KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFwcGx5U2V0RmxhZ3MoYXJnczogc3RyaW5nW10pOiB2b2lkIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgICAgaWYgKGEgPT09ICctLScpIGNvbnRpbnVlO1xuICAgICAgaWYgKCEoYS5zdGFydHNXaXRoKCctJykgfHwgYS5zdGFydHNXaXRoKCcrJykpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IG9uID0gYS5zdGFydHNXaXRoKCctJyk7XG4gICAgICBjb25zdCBjaGFycyA9IGEuc2xpY2UoMSk7XG4gICAgICBmb3IgKGxldCBrID0gMDsgayA8IGNoYXJzLmxlbmd0aDsgaysrKSB7XG4gICAgICAgIGNvbnN0IGMgPSBjaGFyc1trXTtcbiAgICAgICAgaWYgKGMgPT09ICdvJykge1xuICAgICAgICAgIGNvbnN0IG5hbWUgPSBhcmdzW2kgKyAxXTtcbiAgICAgICAgICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkKSByZXR1cm47XG4gICAgICAgICAgaWYgKG5hbWUgPT09ICdlcnJleGl0JykgdGhpcy5lcnJleGl0ID0gb247XG4gICAgICAgICAgZWxzZSBpZiAobmFtZSA9PT0gJ25vZXJyZXhpdCcpIHRoaXMuZXJyZXhpdCA9ICFvbjtcbiAgICAgICAgICBlbHNlIGlmIChuYW1lID09PSAncGlwZWZhaWwnKSB0aGlzLnBpcGVmYWlsID0gb247XG4gICAgICAgICAgZWxzZSBpZiAobmFtZSA9PT0gJ25vcGlwZWZhaWwnKSB0aGlzLnBpcGVmYWlsID0gIW9uO1xuICAgICAgICAgIGkrKztcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJ2UnKSB0aGlzLmVycmV4aXQgPSBvbjtcbiAgICAgICAgLy8gRXZlcnkgb3RoZXIgcmVjb2duaXplZCBsZXR0ZXIgaXMgYSBuby1vcCBmb3IgdGhlIHdhbGsuXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwcm9jZXNzQ29uc3RydWN0KFxuICAgIG1lbWJlcjogU2ltcGxlQ29tbWFuZCxcbiAgICBraW5kOiBDb25zdHJ1Y3RLaW5kLFxuICAgIGN0eDoge1xuICAgICAgZXhlYzogRXhlY1N0YXR1cztcbiAgICAgIGluUGlwZWxpbmU6IGJvb2xlYW47XG4gICAgICBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW47XG4gICAgICBtZW1iZXJBcmd2OiBzdHJpbmdbXSB8IG51bGw7XG4gICAgICBvcHRzOiBXYWxrT3B0aW9ucztcbiAgICB9XG4gICk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCB7IGV4ZWMsIGJhY2tncm91bmRlZCwgb3B0cyB9ID0gY3R4O1xuICAgIGNvbnN0IGRpc2NhcmQgPSBvcHRzLmRpc2NhcmQgfHwgZXhlYyAhPT0gJ3llcyc7XG4gICAgY29uc3Qgc2lkZUVmZmVjdHMgPSBvcHRzLnNpZGVFZmZlY3RzICYmIGV4ZWMgPT09ICd5ZXMnO1xuXG4gICAgc3dpdGNoIChraW5kKSB7XG4gICAgICBjYXNlICdpZic6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VJZihtZW1iZXIudGV4dCk7XG4gICAgICAgIGlmIChwYXJzZWQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IHJlZ2lvbnMgPSBbXG4gICAgICAgICAgcGFyc2VkLmNvbmRpdGlvbixcbiAgICAgICAgICBwYXJzZWQudGhlbkJvZHksXG4gICAgICAgICAgLi4ucGFyc2VkLmVsaWZzLmZsYXRNYXAoKGUpID0+IFtlLmNvbmRpdGlvbiwgZS5ib2R5XSksXG4gICAgICAgICAgLi4uKHBhcnNlZC5lbHNlQm9keSAhPT0gbnVsbCA/IFtwYXJzZWQuZWxzZUJvZHldIDogW10pXG4gICAgICAgIF07XG4gICAgICAgIGNvbnN0IGNvbmRTdGF0dXMgPSB0aGlzLndhbGtMaXN0KHNwbGl0VG9wTGV2ZWwocGFyc2VkLmNvbmRpdGlvbikuc3RhZ2VzLCB7XG4gICAgICAgICAgbGl2ZW5lc3M6IGZhbHNlLFxuICAgICAgICAgIGRpc2NhcmQ6IHRydWUsXG4gICAgICAgICAgc2lkZUVmZmVjdHM6IHRydWUsXG4gICAgICAgICAgaW5wdXRGYWNpbmc6IGZhbHNlXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoY29uZFN0YXR1cyA9PT0gJ3Vua25vd24nKSByZXR1cm4gdGhpcy5vcGFxdWVQYXRoKHJlZ2lvbnMsIGN0eCk7XG4gICAgICAgIGlmIChjb25kU3RhdHVzID09PSAnc3VjY2VzcycpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy53YWxrQnJhbmNoKHBhcnNlZC50aGVuQm9keSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMpO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZWxpZiBvZiBwYXJzZWQuZWxpZnMpIHtcbiAgICAgICAgICBjb25zdCBlU3RhdHVzID0gdGhpcy53YWxrTGlzdChzcGxpdFRvcExldmVsKGVsaWYuY29uZGl0aW9uKS5zdGFnZXMsIHtcbiAgICAgICAgICAgIGxpdmVuZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIGRpc2NhcmQ6IHRydWUsXG4gICAgICAgICAgICBzaWRlRWZmZWN0czogdHJ1ZSxcbiAgICAgICAgICAgIGlucHV0RmFjaW5nOiBmYWxzZVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmIChlU3RhdHVzID09PSAndW5rbm93bicpIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocmVnaW9ucywgY3R4KTtcbiAgICAgICAgICBpZiAoZVN0YXR1cyA9PT0gJ3N1Y2Nlc3MnKSByZXR1cm4gdGhpcy53YWxrQnJhbmNoKGVsaWYuYm9keSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwYXJzZWQuZWxzZUJvZHkgIT09IG51bGwpIHJldHVybiB0aGlzLndhbGtCcmFuY2gocGFyc2VkLmVsc2VCb2R5LCBkaXNjYXJkLCBzaWRlRWZmZWN0cyk7XG4gICAgICAgIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICB9XG4gICAgICBjYXNlICd3aGlsZSc6XG4gICAgICBjYXNlICd1bnRpbCc6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VMb29wKG1lbWJlci50ZXh0LCBraW5kKTtcbiAgICAgICAgaWYgKHBhcnNlZCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgY29uZFN0YXR1cyA9IHRoaXMud2Fsa0xpc3Qoc3BsaXRUb3BMZXZlbChwYXJzZWQuY29uZGl0aW9uKS5zdGFnZXMsIHtcbiAgICAgICAgICBsaXZlbmVzczogZmFsc2UsXG4gICAgICAgICAgZGlzY2FyZDogdHJ1ZSxcbiAgICAgICAgICBzaWRlRWZmZWN0czogdHJ1ZSxcbiAgICAgICAgICBpbnB1dEZhY2luZzogZmFsc2VcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChjb25kU3RhdHVzID09PSAndW5rbm93bicpIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgoW3BhcnNlZC5jb25kaXRpb24sIHBhcnNlZC5ib2R5XSwgY3R4KTtcbiAgICAgICAgY29uc3QgYm9keVJ1bnMgPSBraW5kID09PSAnd2hpbGUnID8gY29uZFN0YXR1cyA9PT0gJ3N1Y2Nlc3MnIDogY29uZFN0YXR1cyA9PT0gJ2ZhaWx1cmUnO1xuICAgICAgICBpZiAoIWJvZHlSdW5zKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgICAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKHBhcnNlZC5ib2R5KTtcbiAgICAgICAgaWYgKHJlcy5tYWxmb3JtZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRoaXMuZGVhZCA9ICdtYWxmb3JtZWQnO1xuICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZnJhbWU6IExvb3BGcmFtZSA9IHsgb3V0Y29tZTogJ25vbmUnLCBib2R5VGVybWluYXRlZDogZmFsc2UsIGFtYmlndW91c1N0b3A6IGZhbHNlIH07XG4gICAgICAgIHRoaXMubG9vcFN0YWNrLnB1c2goZnJhbWUpO1xuICAgICAgICB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQsIHNpZGVFZmZlY3RzLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICAgIHRoaXMubG9vcFN0YWNrLnBvcCgpO1xuICAgICAgICBzd2l0Y2ggKGZyYW1lLm91dGNvbWUpIHtcbiAgICAgICAgICBjYXNlICdicmVhayc6XG4gICAgICAgICAgICByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgICAgICAgIGNhc2UgJ2NvbnRpbnVlJzpcbiAgICAgICAgICBjYXNlICdub25lJzpcbiAgICAgICAgICAgIGlmICh0aGlzLmRlYWQgPT09IG51bGwgJiYgIWJhY2tncm91bmRlZCkgdGhpcy5kZWFkID0gJ25ldmVyLXJldHVybic7XG4gICAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICAgIGNhc2UgJ2FtYmlndW91cyc6XG4gICAgICAgICAgY2FzZSAncmV0dXJuJzpcbiAgICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2Zvcic6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VGb3IobWVtYmVyLnRleHQpO1xuICAgICAgICBpZiAocGFyc2VkID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICBpZiAocGFyc2VkLmxpc3QgPT09IG51bGwgfHwgcGFyc2VkLmxpc3Quc29tZSgodykgPT4gL1skYF0vLnRlc3QodykpKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChbcGFyc2VkLndob2xlSW50ZXJpb3JdLCBjdHgpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwYXJzZWQubGlzdC5sZW5ndGggPT09IDApIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwocGFyc2VkLmJvZHkpO1xuICAgICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgICAgfVxuICAgICAgY2FzZSAnY2FzZSc6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VDYXNlKG1lbWJlci50ZXh0KTtcbiAgICAgICAgaWYgKHBhcnNlZCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgcmVnaW9ucyA9IHBhcnNlZC5icmFuY2hlcy5tYXAoKGIpID0+IGIuYm9keSk7XG4gICAgICAgIGlmIChwYXJzZWQuZmFsbHRocm91Z2ggfHwgcmVzb2x2ZVN1YmplY3QocGFyc2VkLnN1YmplY3QsIHRoaXMuYXNzaWdubWVudHMpID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChyZWdpb25zLCBjdHgpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHN1YmplY3QgPSByZXNvbHZlU3ViamVjdChwYXJzZWQuc3ViamVjdCwgdGhpcy5hc3NpZ25tZW50cykhO1xuICAgICAgICBsZXQgbWF0Y2hlZEJyYW5jaCA9IC0xO1xuICAgICAgICBsZXQgdW5kZWNpZGFibGUgPSBmYWxzZTtcbiAgICAgICAgZm9yIChsZXQgYiA9IDA7IGIgPCBwYXJzZWQuYnJhbmNoZXMubGVuZ3RoOyBiKyspIHtcbiAgICAgICAgICBjb25zdCByID0gZXZhbFBhdHRlcm4ocGFyc2VkLmJyYW5jaGVzW2JdLnBhdHRlcm4sIHN1YmplY3QpO1xuICAgICAgICAgIGlmIChyID09PSAnbWF0Y2gnKSB7XG4gICAgICAgICAgICBtYXRjaGVkQnJhbmNoID0gYjtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAociA9PT0gJ2dsb2InIHx8IHIgPT09ICd1bmRlY2lkYWJsZScpIHtcbiAgICAgICAgICAgIHVuZGVjaWRhYmxlID0gdHJ1ZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAodW5kZWNpZGFibGUpIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocmVnaW9ucywgY3R4KTtcbiAgICAgICAgaWYgKG1hdGNoZWRCcmFuY2ggIT09IC0xKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMud2Fsa0JyYW5jaChwYXJzZWQuYnJhbmNoZXNbbWF0Y2hlZEJyYW5jaF0uYm9keSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICB9XG4gICAgICBjYXNlICdzZWxlY3QnOiB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlTG9vcChtZW1iZXIudGV4dCwgJ3doaWxlJyk7XG4gICAgICAgIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocGFyc2VkICE9PSBudWxsID8gW3BhcnNlZC5ib2R5XSA6IFtdLCBjdHgpO1xuICAgICAgfVxuICAgICAgY2FzZSAnYnJhY2UnOiB7XG4gICAgICAgIGNvbnN0IGludGVyaW9yID0gZXh0cmFjdEdyb3VwQm9keShtZW1iZXIudGV4dCwgJ3snLCAnfScpO1xuICAgICAgICBpZiAoaW50ZXJpb3IgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwoaW50ZXJpb3IpO1xuICAgICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgICAgfVxuICAgICAgY2FzZSAnc3Vic2hlbGwnOiB7XG4gICAgICAgIGNvbnN0IGludGVyaW9yID0gZXh0cmFjdEdyb3VwQm9keShtZW1iZXIudGV4dCwgJygnLCAnKScpO1xuICAgICAgICBpZiAoaW50ZXJpb3IgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwoaW50ZXJpb3IpO1xuICAgICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBzYXZlZEVycmV4aXQgPSB0aGlzLmVycmV4aXQ7XG4gICAgICAgIGNvbnN0IHNhdmVkUGlwZWZhaWwgPSB0aGlzLnBpcGVmYWlsO1xuICAgICAgICBjb25zdCBzYXZlZEFzc2lnbm1lbnRzID0gdGhpcy5hc3NpZ25tZW50cztcbiAgICAgICAgY29uc3Qgc2F2ZWREZWZzID0gdGhpcy5kZWZzO1xuICAgICAgICBjb25zdCBzYXZlZFJldHVybmVkID0gdGhpcy5yZXR1cm5lZDtcbiAgICAgICAgY29uc3Qgc2F2ZWRGbkRlcHRoID0gdGhpcy5mbkRlcHRoO1xuICAgICAgICBjb25zdCBzYXZlZExvb3BTdGFjayA9IHRoaXMubG9vcFN0YWNrO1xuICAgICAgICBjb25zdCBzYXZlZERpckZyYW1lID0gdGhpcy5kaXJGcmFtZTtcbiAgICAgICAgY29uc3Qgc2F2ZWREZWFkID0gdGhpcy5kZWFkO1xuICAgICAgICB0aGlzLmVycmV4aXQgPSBzYXZlZEVycmV4aXQ7XG4gICAgICAgIHRoaXMucGlwZWZhaWwgPSBzYXZlZFBpcGVmYWlsO1xuICAgICAgICB0aGlzLmFzc2lnbm1lbnRzID0gbmV3IE1hcChzYXZlZEFzc2lnbm1lbnRzKTtcbiAgICAgICAgdGhpcy5kZWZzID0gbmV3IE1hcChzYXZlZERlZnMpO1xuICAgICAgICB0aGlzLnJldHVybmVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMuZm5EZXB0aCA9IDA7XG4gICAgICAgIHRoaXMubG9vcFN0YWNrID0gW107XG4gICAgICAgIHRoaXMuZGlyRnJhbWUgPSBzYXZlZERpckZyYW1lICsgMTtcbiAgICAgICAgdGhpcy5kZWFkID0gbnVsbDtcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgICAgICBjb25zdCBpbm5lckRlYWQgPSB0aGlzLmRlYWQ7XG4gICAgICAgIHRoaXMuZXJyZXhpdCA9IHNhdmVkRXJyZXhpdDtcbiAgICAgICAgdGhpcy5waXBlZmFpbCA9IHNhdmVkUGlwZWZhaWw7XG4gICAgICAgIHRoaXMuYXNzaWdubWVudHMgPSBzYXZlZEFzc2lnbm1lbnRzO1xuICAgICAgICB0aGlzLmRlZnMgPSBzYXZlZERlZnM7XG4gICAgICAgIHRoaXMucmV0dXJuZWQgPSBzYXZlZFJldHVybmVkO1xuICAgICAgICB0aGlzLmZuRGVwdGggPSBzYXZlZEZuRGVwdGg7XG4gICAgICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2s7XG4gICAgICAgIHRoaXMuZGlyRnJhbWUgPSBzYXZlZERpckZyYW1lO1xuICAgICAgICB0aGlzLmRlYWQgPSBzYXZlZERlYWQ7XG4gICAgICAgIC8vIEEgc3Vic2hlbGwgaXMgYSBwcm9jZXNzIGJvdW5kYXJ5IGZvciB0aGUgZXhpdCBmaXJlIGJ1dCBub3QgZm9yIHRoZVxuICAgICAgICAvLyBuZXZlci1yZXR1cm4gZmlyZTogdGhlIHNoZWxsIHN5bmNocm9ub3VzbHkgd2FpdHMgZm9yIHRoZSBzdWJzaGVsbC5cbiAgICAgICAgaWYgKGlubmVyRGVhZCA9PT0gJ25ldmVyLXJldHVybicpIHRoaXMuZGVhZCA9ICduZXZlci1yZXR1cm4nO1xuICAgICAgICByZXR1cm4gc3RhdHVzO1xuICAgICAgfVxuICAgICAgY2FzZSAnZGVmJzoge1xuICAgICAgICAvLyBUaGUgZGVmaW5pdGlvbiByZWdpc3RlcnMgd2l0aCB0aGUgd2FsayBzY29wZSB3aGVuIGV4ZWN1dGVkLlxuICAgICAgICBpZiAoc2lkZUVmZmVjdHMpIHtcbiAgICAgICAgICBjb25zdCBkZWYgPSBwYXJzZURlZihtZW1iZXIudGV4dCk7XG4gICAgICAgICAgaWYgKGRlZiAhPT0gbnVsbCkgdGhpcy5kZWZzLnNldChkZWYubmFtZSwgZGVmLmJvZHkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAndW5rbm93bic7XG4gIH1cblxuICBwcml2YXRlIHdhbGtCcmFuY2goYm9keTogc3RyaW5nLCBkaXNjYXJkOiBib29sZWFuLCBzaWRlRWZmZWN0czogYm9vbGVhbik6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKGJvZHkpO1xuICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuZGVhZCA9ICdtYWxmb3JtZWQnO1xuICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgb3BhcXVlLWNvbnN0cnVjdCB0cmVhdG1lbnQgKHBsYW4gXHUwMEE3Mik6IHJlLXNwbGl0IGVhY2ggcmVnaW9uIGFuZCB3YWxrIGl0XG4gICAqIHdpdGggdGhlIHNhbWUgbWFjaGluZXJ5IHNvIGFuIGBleGl0YC9gZXhlY2AgdGhhdCBtYXkgaGF2ZSBydW4sIG9yIGFcbiAgICogbmV2ZXItZXhpdCBsb29wLCBmaXJlcyBmYWlsLWNsb3NlZDsgaGlkZGVuIGJyZWFrL2NvbnRpbnVlIHdvcmRzIHJlYWNoIHRoZVxuICAgKiBzY2FubmVkIGxvb3AgYXMgYW4gYW1iaWd1b3VzIHRlcm1pbmF0aW9uLiBTdGF0ZSBpcyBzbmFwc2hvdC1yZXN0b3JlZC5cbiAgICovXG4gIHByaXZhdGUgb3BhcXVlUGF0aChcbiAgICByZWdpb25zOiBzdHJpbmdbXSxcbiAgICBjdHg6IHsgZXhlYzogRXhlY1N0YXR1czsgaW5QaXBlbGluZTogYm9vbGVhbjsgYmFja2dyb3VuZGVkOiBib29sZWFuOyBvcHRzOiBXYWxrT3B0aW9ucyB9XG4gICk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCBmaW5kaW5ncyA9IHRoaXMuc2Nhbk9wYXF1ZShyZWdpb25zKTtcbiAgICBpZiAoZmluZGluZ3MuZmlyZSAhPT0gbnVsbCkge1xuICAgICAgaWYgKGZpbmRpbmdzLmZpcmUgPT09ICduZXZlci1yZXR1cm4nKSB7XG4gICAgICAgIGlmICghY3R4LmJhY2tncm91bmRlZCkgdGhpcy5kZWFkID0gJ25ldmVyLXJldHVybic7XG4gICAgICB9IGVsc2UgaWYgKCFjdHguaW5QaXBlbGluZSAmJiAhY3R4LmJhY2tncm91bmRlZCkge1xuICAgICAgICB0aGlzLmRlYWQgPSBmaW5kaW5ncy5maXJlO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZmluZGluZ3MuYnJlYWtUYXJnZXQgIT09ICdub25lJykge1xuICAgICAgY29uc3QgdG9wID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMV07XG4gICAgICBpZiAodG9wICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdG9wLm91dGNvbWUgPSAnYW1iaWd1b3VzJztcbiAgICAgICAgdG9wLmFtYmlndW91c1N0b3AgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gJ3Vua25vd24nO1xuICB9XG5cbiAgcHJpdmF0ZSBzY2FuT3BhcXVlKHJlZ2lvbnM6IHN0cmluZ1tdKTogeyBmaXJlOiBEZWFkS2luZCB8IG51bGw7IGJyZWFrVGFyZ2V0OiAnYnJlYWsnIHwgJ2NvbnRpbnVlJyB8ICdub25lJyB9IHtcbiAgICBjb25zdCByZXBvcnQ6IHsgZmlyZTogRGVhZEtpbmQgfCBudWxsOyBicmVha1RhcmdldDogJ2JyZWFrJyB8ICdjb250aW51ZScgfCAnbm9uZScgfSA9IHtcbiAgICAgIGZpcmU6IG51bGwsXG4gICAgICBicmVha1RhcmdldDogJ25vbmUnXG4gICAgfTtcbiAgICBjb25zdCBzYXZlZENoYWluID0gdGhpcy5jaGFpbjtcbiAgICBjb25zdCBzYXZlZEVycmV4aXQgPSB0aGlzLmVycmV4aXQ7XG4gICAgY29uc3Qgc2F2ZWRQaXBlZmFpbCA9IHRoaXMucGlwZWZhaWw7XG4gICAgY29uc3Qgc2F2ZWRBc3NpZ25tZW50cyA9IHRoaXMuYXNzaWdubWVudHM7XG4gICAgY29uc3Qgc2F2ZWREZWZzID0gdGhpcy5kZWZzO1xuICAgIGNvbnN0IHNhdmVkRGVhZCA9IHRoaXMuZGVhZDtcbiAgICBjb25zdCBzYXZlZFJldHVybmVkID0gdGhpcy5yZXR1cm5lZDtcbiAgICBjb25zdCBzYXZlZEZuRGVwdGggPSB0aGlzLmZuRGVwdGg7XG4gICAgY29uc3Qgc2F2ZWRMb29wU3RhY2sgPSB0aGlzLmxvb3BTdGFjaztcbiAgICBjb25zdCBzYXZlZERpckZyYW1lID0gdGhpcy5kaXJGcmFtZTtcbiAgICBjb25zdCBzYXZlZFZlcmRpY3RzID0gdGhpcy52ZXJkaWN0cy5sZW5ndGg7XG4gICAgY29uc3Qgc2F2ZWRFeHBhbmRlZCA9IHRoaXMuZXhwYW5kZWQubGVuZ3RoO1xuICAgIGNvbnN0IHNhdmVkRGVmUHJvYmUgPSBuZXcgU2V0KHRoaXMuZGVmUHJvYmVTdGFjayk7XG5cbiAgICBmb3IgKGNvbnN0IHJlZ2lvbiBvZiByZWdpb25zKSB7XG4gICAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKHJlZ2lvbik7XG4gICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlcG9ydC5maXJlID0gJ21hbGZvcm1lZCc7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgdGhpcy5kZWFkID0gbnVsbDtcbiAgICAgIHRoaXMucmV0dXJuZWQgPSBmYWxzZTtcbiAgICAgIC8vIEVhY2ggcmVnaW9uIHdhbGtzIGFnYWluc3QgYSBmcmVzaCBjb3B5IG9mIHRoZSBlbmNsb3NpbmcgbG9vcCBmcmFtZXMgc29cbiAgICAgIC8vIGl0cyBoaWRkZW4gYnJlYWsvY29udGludWUgZXZlbnRzIGFyZSByZXBvcnRlZCwgbmV2ZXIgYXBwbGllZC5cbiAgICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2subWFwKChmKSA9PiAoeyAuLi5mIH0pKTtcbiAgICAgIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZDogdHJ1ZSwgc2lkZUVmZmVjdHM6IGZhbHNlLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICBpZiAodGhpcy5kZWFkICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChyZXBvcnQuZmlyZSA9PT0gbnVsbCB8fCB0aGlzLmRlYWQgPT09ICduZXZlci1yZXR1cm4nIHx8IHRoaXMuZGVhZCA9PT0gJ21hbGZvcm1lZCcpIHJlcG9ydC5maXJlID0gdGhpcy5kZWFkO1xuICAgICAgfVxuICAgICAgaWYgKHJlcG9ydC5icmVha1RhcmdldCA9PT0gJ25vbmUnKSB7XG4gICAgICAgIGNvbnN0IGlubmVybW9zdCA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDFdO1xuICAgICAgICBpZiAoaW5uZXJtb3N0ICE9PSB1bmRlZmluZWQgJiYgKGlubmVybW9zdC5vdXRjb21lID09PSAnYnJlYWsnIHx8IGlubmVybW9zdC5vdXRjb21lID09PSAnY29udGludWUnKSkge1xuICAgICAgICAgIHJlcG9ydC5icmVha1RhcmdldCA9IGlubmVybW9zdC5vdXRjb21lO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jaGFpbiA9IHNhdmVkQ2hhaW47XG4gICAgdGhpcy5lcnJleGl0ID0gc2F2ZWRFcnJleGl0O1xuICAgIHRoaXMucGlwZWZhaWwgPSBzYXZlZFBpcGVmYWlsO1xuICAgIHRoaXMuYXNzaWdubWVudHMgPSBzYXZlZEFzc2lnbm1lbnRzO1xuICAgIHRoaXMuZGVmcyA9IHNhdmVkRGVmcztcbiAgICB0aGlzLmRlYWQgPSBzYXZlZERlYWQ7XG4gICAgdGhpcy5yZXR1cm5lZCA9IHNhdmVkUmV0dXJuZWQ7XG4gICAgdGhpcy5mbkRlcHRoID0gc2F2ZWRGbkRlcHRoO1xuICAgIHRoaXMubG9vcFN0YWNrID0gc2F2ZWRMb29wU3RhY2s7XG4gICAgdGhpcy5kaXJGcmFtZSA9IHNhdmVkRGlyRnJhbWU7XG4gICAgdGhpcy52ZXJkaWN0cy5sZW5ndGggPSBzYXZlZFZlcmRpY3RzO1xuICAgIHRoaXMuZXhwYW5kZWQubGVuZ3RoID0gc2F2ZWRFeHBhbmRlZDtcbiAgICB0aGlzLmRlZlByb2JlU3RhY2suY2xlYXIoKTtcbiAgICBmb3IgKGNvbnN0IG5hbWUgb2Ygc2F2ZWREZWZQcm9iZSkgdGhpcy5kZWZQcm9iZVN0YWNrLmFkZChuYW1lKTtcbiAgICByZXR1cm4gcmVwb3J0O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZS1yYW5nZSBzcGVjczogd2hhdCBhIG1hdGNoZWQgaWRpb20gc2F5cyBhYm91dCB0aGUgcmFuZ2UsIGJlZm9yZSB3ZSBrbm93XG4vLyB3aGV0aGVyIHJlc29sdmluZyBpdCBuZWVkcyB0byBjb25zdWx0IGEgcmVhbCBmaWxlL2dpdCBibG9iLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgTGluZVJhbmdlU3BlYyA9XG4gIHwgeyBraW5kOiAnbGl0ZXJhbCc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JzsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3RvRW9mJzsgc3RhcnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnbGFzdE5MaW5lcyc7IGNvdW50OiBudW1iZXIgfVxuICB8IHsga2luZDogJ2FwcGVuZExpbmVzJzsgY291bnQ6IG51bWJlciB9O1xuXG5mdW5jdGlvbiByZXNvbHZlU3BlYyhcbiAgc3BlYzogTGluZVJhbmdlU3BlYyxcbiAgdG90YWxMaW5lczogKCkgPT4gbnVtYmVyIHwgbnVsbFxuKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgc3dpdGNoIChzcGVjLmtpbmQpIHtcbiAgICBjYXNlICdsaXRlcmFsJzpcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogc3BlYy5zdGFydCwgbGluZUVuZDogc3BlYy5lbmQgfTtcbiAgICBjYXNlICd1cHBlckJvdW5kRnJvbVN0YXJ0Jzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IHRvdGFsICE9PSBudWxsID8gTWF0aC5taW4oc3BlYy5lbmQsIHRvdGFsKSA6IHNwZWMuZW5kIH07XG4gICAgfVxuICAgIGNhc2UgJ3RvRW9mJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBNYXRoLm1heChzcGVjLnN0YXJ0LCB0b3RhbCkgfTtcbiAgICB9XG4gICAgY2FzZSAnbGFzdE5MaW5lcyc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsIHx8IHRvdGFsID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogTWF0aC5tYXgoMSwgdG90YWwgLSBzcGVjLmNvdW50ICsgMSksIGxpbmVFbmQ6IHRvdGFsIH07XG4gICAgfVxuICAgIGNhc2UgJ2FwcGVuZExpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCkgPz8gMDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogdG90YWwgKyAxLCBsaW5lRW5kOiB0b3RhbCArIHNwZWMuY291bnQgfTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gaGFzU2hlbGxFeHBhbnNpb24oczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvWyRgXS8udGVzdChzKTtcbn1cblxuZnVuY3Rpb24gbG9va3NVbnJlc29sdmFibGUoczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBoYXNTaGVsbEV4cGFuc2lvbihzKSB8fCAvWyo/XS8udGVzdChzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJZGlvbSBtYXRjaGVyczogcHVyZSBmdW5jdGlvbnMgb3ZlciBvbmUgc2ltcGxlIGNvbW1hbmQncyBhcmd2LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBSYXdDYW5kaWRhdGUge1xuICBraW5kOiAnY2FuZGlkYXRlJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHNwZWM6IExpbmVSYW5nZVNwZWM7XG4gIHJlc29sdmVyS2luZDogJ2ZzJyB8IHsga2luZDogJ2dpdCc7IHJldjogc3RyaW5nIH07XG4gIGRpck92ZXJyaWRlPzogc3RyaW5nO1xufVxuaW50ZXJmYWNlIFJhd1VucmVzb2x2ZWQge1xuICBraW5kOiAndW5yZXNvbHZlZCc7XG4gIGlkaW9tOiBJZGlvbTtcbiAgZmlsZUFyZzogc3RyaW5nO1xuICByZWFzb246IHN0cmluZztcbn1cbnR5cGUgTWF0Y2hSZXN1bHQgPSBSYXdDYW5kaWRhdGUgfCBSYXdVbnJlc29sdmVkO1xuXG5jb25zdCBTRURfUkFOR0UgPSAvXihcXGQrKSg/OiwoXFxkK3xcXCQpKT9wJC87XG5cbi8qKiBTcGxpdCBhIGBzZWRgIHNjcmlwdCBhcmd1bWVudCBpbnRvIGl0cyBgO2Atc2VwYXJhdGVkIHNlZ21lbnRzLiAqL1xuZnVuY3Rpb24gc2VkU2NyaXB0U2VnbWVudHMoc2NyaXB0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBzY3JpcHQuc3BsaXQoJzsnKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hTZWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdzZWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAoIXJlc3QuaW5jbHVkZXMoJy1uJykpIHJldHVybiBbXTtcbiAgbGV0IHNjcmlwdElkeCA9IC0xO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAocmVzdFtpXSA9PT0gJy1uJykgY29udGludWU7XG4gICAgaWYgKHNlZFNjcmlwdFNlZ21lbnRzKHJlc3RbaV0pLnNvbWUoKHNlZykgPT4gU0VEX1JBTkdFLnRlc3Qoc2VnKSkpIHtcbiAgICAgIHNjcmlwdElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKHNjcmlwdElkeCA9PT0gLTEpIHJldHVybiBbXTtcbiAgY29uc3QgZmlsZUNhbmRpZGF0ZXMgPSByZXN0LmZpbHRlcigoYSwgaSkgPT4gaSAhPT0gc2NyaXB0SWR4ICYmIGEgIT09ICctbicgJiYgIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgaWYgKGZpbGVDYW5kaWRhdGVzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQXJnID0gZmlsZUNhbmRpZGF0ZXNbMF07XG4gIGNvbnN0IHJlc3VsdHM6IE1hdGNoUmVzdWx0W10gPSBbXTtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZFNjcmlwdFNlZ21lbnRzKHJlc3Rbc2NyaXB0SWR4XSkpIHtcbiAgICBjb25zdCBtYXRjaCA9IHNlZ21lbnQubWF0Y2goU0VEX1JBTkdFKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtYXRjaFsxXSwgMTApO1xuICAgIGNvbnN0IGVuZFRva2VuID0gbWF0Y2hbMl07XG4gICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9XG4gICAgICBlbmRUb2tlbiA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IHN0YXJ0IH1cbiAgICAgICAgOiBlbmRUb2tlbiA9PT0gJyQnXG4gICAgICAgICAgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0IH1cbiAgICAgICAgICA6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydCwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZW5kVG9rZW4sIDEwKSB9O1xuICAgIHJlc3VsdHMucHVzaCh7IGtpbmQ6ICdjYW5kaWRhdGUnLCBpZGlvbTogJ3NlZC1uLXJhbmdlJywgZmlsZUFyZywgc3BlYywgcmVzb2x2ZXJLaW5kOiAnZnMnIH0pO1xuICB9XG4gIHJldHVybiByZXN1bHRzO1xufVxuXG4vKipcbiAqIFBhcnNlIGBoZWFkYC9gdGFpbGAgZmxhZ3MgYW5kIGZpbGUgYXJncy4gQSBiYXJlIGArTmAgaXMgYSBmcm9tLU4gY291bnQgb25seVxuICogZm9yIGB0YWlsYCAoYHRhaWwgKzUgZmAgc3RhcnRzIGF0IGxpbmUgNSk7IEdOVSBgaGVhZGAgdHJlYXRzIGJhcmUgYCtOYCBhcyBhXG4gKiAqZmlsZSogKGNvcmV1dGlscyA5LjcgXHUyMDE0IHByb2JlOiBgaGVhZCArNSBmYCBlcnJvcnMgXCJjYW5ub3Qgb3BlbiAnKzUnXCIgYW5kXG4gKiByZWFkcyBmJ3MgZmlyc3QgMTAgbGluZXMpLCBzbyBgYmFyZVBsdXNJc0NvdW50YCBpcyBmYWxzZSBmb3IgaGVhZCBhbmQgdGhlXG4gKiB3b3JkIGZhbGxzIHRocm91Z2ggdG8gdGhlIGZpbGUgbGlzdC5cbiAqL1xuZnVuY3Rpb24gcGFyc2VIZWFkVGFpbEZsYWdzKFxuICByZXN0OiBzdHJpbmdbXSxcbiAgYmFyZVBsdXNJc0NvdW50OiBib29sZWFuXG4pOiB7XG4gIGNvdW50OiBudW1iZXIgfCBudWxsO1xuICBmcm9tU3RhcnQ6IGJvb2xlYW47XG4gIGRpc3F1YWxpZmllZDogYm9vbGVhbjtcbiAgZmlsZXM6IHN0cmluZ1tdO1xufSB7XG4gIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY291bnQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBsZXQgZnJvbVN0YXJ0ID0gZmFsc2U7XG4gIGxldCBkaXNxdWFsaWZpZWQgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctZicgfHwgYSA9PT0gJy1GJyB8fCBhID09PSAnLS1mb2xsb3cnIHx8IGEuc3RhcnRzV2l0aCgnLS1mb2xsb3c9JykpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICcteicgfHwgYSA9PT0gJy0temVyby10ZXJtaW5hdGVkJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJyB8fCBhID09PSAnLS1ieXRlcycpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eKC1jfC0tYnl0ZXM9KS8udGVzdChhKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1xJyB8fCBhID09PSAnLXYnIHx8IGEgPT09ICctLXF1aWV0JyB8fCBhID09PSAnLS1zaWxlbnQnIHx8IGEgPT09ICctLXZlcmJvc2UnKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLWxpbmVzPScpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgnLS1saW5lcz0nLmxlbmd0aCk7XG4gICAgICBpZiAoL15cXCs/XFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1uXFwrP1xcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgyKTtcbiAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eXFwrXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGlmIChiYXJlUGx1c0lzQ291bnQpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdHJ1ZTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgxKSwgMTApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0nKSB7XG4gICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgZmlsZXMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoSGVhZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2hlYWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpLCBmYWxzZSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgLy8gQmFyZSBgK05gIGlzIGEgR05VLWhlYWQgZmlsZSBhcnRpZmFjdCwgbmV2ZXIgYSByZWFsIHJlYWQgXHUyMDE0IGRyb3AgaXQuXG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nICYmICEvXlxcK1xcZCskLy50ZXN0KGYpKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICByZXR1cm4gcmVhbEZpbGVzLm1hcCgoZmlsZUFyZykgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyBhcyBjb25zdCxcbiAgICBpZGlvbTogJ2hlYWQtZmlsZScgYXMgY29uc3QsXG4gICAgZmlsZUFyZyxcbiAgICBzcGVjOiB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JywgZW5kOiBuIH0gYXMgTGluZVJhbmdlU3BlYyxcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgYXMgY29uc3RcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBtYXRjaFRhaWwoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICd0YWlsJykgcmV0dXJuIFtdO1xuICBjb25zdCB7IGNvdW50LCBmcm9tU3RhcnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpLCB0cnVlKTtcbiAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIFtdO1xuICBjb25zdCByZWFsRmlsZXMgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyk7XG4gIGlmIChyZWFsRmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IG4gPSBjb3VudCA/PyAxMDtcbiAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9IGZyb21TdGFydCA/IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IG4gfSA6IHsga2luZDogJ2xhc3ROTGluZXMnLCBjb3VudDogbiB9O1xuICByZXR1cm4gcmVhbEZpbGVzLm1hcCgoZmlsZUFyZykgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyBhcyBjb25zdCxcbiAgICBpZGlvbTogJ3RhaWwtZmlsZScgYXMgY29uc3QsXG4gICAgZmlsZUFyZyxcbiAgICBzcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIGZpbmRHaXRTdWJjb21tYW5kKFxuICByZXN0OiBzdHJpbmdbXVxuKTogeyBzdWJJZHg6IG51bWJlcjsgc3ViY29tbWFuZDogc3RyaW5nOyBjRGlyOiBzdHJpbmcgfCBudWxsOyBjRGlyVW5yZXNvbHZhYmxlOiBib29sZWFuIH0gfCBudWxsIHtcbiAgbGV0IGNEaXI6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgY0RpclVucmVzb2x2YWJsZSA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgcmVzdC5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gcmVzdFtpXTtcbiAgICBpZiAoYSA9PT0gJy1DJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICBpZiAoaGFzU2hlbGxFeHBhbnNpb24odikpIGNEaXJVbnJlc29sdmFibGUgPSB0cnVlO1xuICAgICAgZWxzZSBjRGlyID0gdjtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJykge1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHJldHVybiB7IHN1YklkeDogaSwgc3ViY29tbWFuZDogYSwgY0RpciwgY0RpclVucmVzb2x2YWJsZSB9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5jb25zdCBSRVZfUEFUSCA9IC9eKFteXFxzOl0rKTooLispJC87XG5cbmZ1bmN0aW9uIG1hdGNoR2l0U2hvdyhhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2dpdCcpIHJldHVybiBbXTtcbiAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndi5zbGljZSgxKSk7XG4gIGlmICghc3ViIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnc2hvdycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2XG4gICAgLnNsaWNlKDEpXG4gICAgLnNsaWNlKHN1Yi5zdWJJZHggKyAxKVxuICAgIC5maWx0ZXIoKGEpID0+ICFhLnN0YXJ0c1dpdGgoJy0nKSk7XG4gIGNvbnN0IHJldlBhdGhBcmcgPSBhZnRlci5maW5kKChhKSA9PiBSRVZfUEFUSC50ZXN0KGEpKTtcbiAgaWYgKCFyZXZQYXRoQXJnKSByZXR1cm4gW107XG4gIGNvbnN0IG0gPSByZXZQYXRoQXJnLm1hdGNoKFJFVl9QQVRIKTtcbiAgaWYgKCFtKSByZXR1cm4gW107XG4gIGNvbnN0IFssIHJldiwgcGF0aF0gPSBtO1xuICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUgfHwgaGFzU2hlbGxFeHBhbnNpb24ocmV2KSkge1xuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgb3IgcmV2aXNpb24gY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgIH1cbiAgICBdO1xuICB9XG4gIHJldHVybiBbXG4gICAge1xuICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgICByZXNvbHZlcktpbmQ6IHsga2luZDogJ2dpdCcsIHJldiB9LFxuICAgICAgZGlyT3ZlcnJpZGU6IHN1Yi5jRGlyID8/IHVuZGVmaW5lZFxuICAgIH1cbiAgXTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hHaXRMb2dMKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdsb2cnKSByZXR1cm4gW107XG4gIGNvbnN0IGFmdGVyID0gYXJndi5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYWZ0ZXIubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYWZ0ZXJbaV07XG4gICAgbGV0IHNwZWM6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIGlmIChhID09PSAnLUwnKSBzcGVjID0gYWZ0ZXJbaSArIDFdID8/IG51bGw7XG4gICAgZWxzZSBpZiAoYS5zdGFydHNXaXRoKCctTCcpKSBzcGVjID0gYS5zbGljZSgyKTtcbiAgICBpZiAoIXNwZWMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IG0gPSBzcGVjLm1hdGNoKC9eKFxcZCspLChcXGQrKTooLispJC8pO1xuICAgIGlmICghbSkgY29udGludWU7XG4gICAgY29uc3QgWywgcywgZSwgcGF0aF0gPSBtO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAge1xuICAgICAgICAgIGtpbmQ6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2dpdC1sb2ctTCcsXG4gICAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgICByZWFzb246ICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICAgIH1cbiAgICAgIF07XG4gICAgfVxuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgICBpZGlvbTogJ2dpdC1sb2ctTCcsXG4gICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgIHNwZWM6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogTnVtYmVyLnBhcnNlSW50KHMsIDEwKSwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZSwgMTApIH0sXG4gICAgICAgIHJlc29sdmVyS2luZDogJ2ZzJyxcbiAgICAgICAgZGlyT3ZlcnJpZGU6IHN1Yi5jRGlyID8/IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEhlcmVkb2Mgd3JpdGVzIChgY2F0ID4gZmlsZSA8PEVPRiAuLi4gRU9GYCk6IGhhbmRsZWQgYXMgYSBkZWRpY2F0ZWQgcmF3LXRleHRcbi8vIHBhc3MgYmVjYXVzZSB0aGUgYm9keSBjYW4gaXRzZWxmIGNvbnRhaW4gJiYvOy98L25ld2xpbmVzIHRoYXQgd291bGRcbi8vIG90aGVyd2lzZSBjb25mdXNlIHNwbGl0VG9wTGV2ZWwuIE1hdGNoZWQgc3BhbnMgYXJlIG1hc2tlZCBvdXQgb2YgdGhlIHN0cmluZ1xuLy8gKHJlcGxhY2VkIHdpdGggYW4gaW5kZXhlZCBwbGFjZWhvbGRlciBzaW1wbGUtY29tbWFuZCkgYmVmb3JlIHRoZSByZXN0IG9mXG4vLyB0aGUgcGlwZWxpbmUgcnVucywgYW5kIHJlLWFzc29jaWF0ZWQgYnkgaW5kZXggZHVyaW5nIHRoZSBtYWluIHdhbGsgc28gdGhlXG4vLyB3cml0ZSBpcyByZXNvbHZlZCBhZ2FpbnN0IHRoZSBjb3JyZWN0IGBjZGAtdHJhY2tlZCBkaXJlY3RvcnkuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIEhlcmVkb2NXcml0ZSB7XG4gIHJlZGlyZWN0OiAnPicgfCAnPj4nO1xuICB0YXJnZXQ6IHN0cmluZztcbiAgYm9keTogc3RyaW5nO1xufVxuXG5jb25zdCBIRVJFRE9DX09QRU4gPVxuICAvXFxiY2F0WyBcXHRdKyg+ezEsMn0pWyBcXHRdKihcXFMrKVsgXFx0XSo8PCgtPylbIFxcdF0qKD86JyhbXiddKiknfFwiKFteXCJdKilcInwoW0EtWmEtel9dW0EtWmEtejAtOV9dKikpL2c7XG5cbmZ1bmN0aW9uIGVzY2FwZVJlZ0V4cChzOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcy5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0SGVyZWRvY1dyaXRlcyhyYXc6IHN0cmluZyk6IHsgd3JpdGVzOiBIZXJlZG9jV3JpdGVbXTsgbWFza2VkOiBzdHJpbmcgfSB7XG4gIGNvbnN0IHdyaXRlczogSGVyZWRvY1dyaXRlW10gPSBbXTtcbiAgbGV0IG1hc2tlZCA9ICcnO1xuICBsZXQgY3Vyc29yID0gMDtcbiAgSEVSRURPQ19PUEVOLmxhc3RJbmRleCA9IDA7XG4gIGxldCBvcGVuTWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGwgPSBIRVJFRE9DX09QRU4uZXhlYyhyYXcpO1xuICB3aGlsZSAob3Blbk1hdGNoICE9PSBudWxsKSB7XG4gICAgY29uc3QgWywgcmVkaXJlY3QsIHRhcmdldCwgZGFzaCwgZHExLCBkcTIsIGJhcmVdID0gb3Blbk1hdGNoO1xuICAgIGNvbnN0IGRlbGltID0gZHExID8/IGRxMiA/PyBiYXJlO1xuICAgIGNvbnN0IG9wZW5FbmQgPSBvcGVuTWF0Y2guaW5kZXggKyBvcGVuTWF0Y2hbMF0ubGVuZ3RoO1xuICAgIGlmICghZGVsaW0gfHwgb3Blbk1hdGNoLmluZGV4IDwgY3Vyc29yKSB7XG4gICAgICBIRVJFRE9DX09QRU4ubGFzdEluZGV4ID0gb3Blbk1hdGNoLmluZGV4ICsgMTtcbiAgICAgIG9wZW5NYXRjaCA9IEhFUkVET0NfT1BFTi5leGVjKHJhdyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVGhlIGJvZHkgcmVnaW9uIHN0YXJ0cyByaWdodCBhZnRlciB0aGUgZGVsaW1pdGVyIGxpbmUncyBuZXdsaW5lLiBBblxuICAgIC8vIGFic2VudCBuZXdsaW5lIChpbnB1dCBlbmRzIGF0IHRoZSBkZWxpbWl0ZXIsIG9yIGAmJmAvYDtgIGNvbnRpbnVlcyB0aGVcbiAgICAvLyBsaW5lKSBpcyBhIHNhbWUtbGluZSB1bnRlcm1pbmF0ZWQgaGVyZWRvYyB3aXRoIGFuIGVtcHR5IGJvZHkgXHUyMDE0IHRoZSBgPmBcbiAgICAvLyByZWRpcmVjdCBzdGlsbCB0cnVuY2F0ZXMgdGhlIGZpbGUsIGFuZCB0aGUgY29udGludWF0aW9uIHN0YXlzIGNvbW1hbmRzLlxuICAgIGNvbnN0IG5sID0gcmF3LnNsaWNlKG9wZW5FbmQpLm1hdGNoKC9eWyBcXHRdKlxccj9cXG4vKTtcbiAgICBjb25zdCBib2R5U3RhcnQgPSBubCAhPT0gbnVsbCA/IG9wZW5FbmQgKyBubFswXS5sZW5ndGggOiBvcGVuRW5kO1xuICAgIGNvbnN0IHJlbWFpbmRlciA9IHJhdy5zbGljZShib2R5U3RhcnQpO1xuICAgIGNvbnN0IGNsb3NlUmUgPSBuZXcgUmVnRXhwKGBeJHtkYXNoID8gJ1xcXFx0KicgOiAnJ30ke2VzY2FwZVJlZ0V4cChkZWxpbSl9WyBcXFxcdF0qJGAsICdtJyk7XG4gICAgY29uc3QgY2xvc2VNYXRjaCA9IGNsb3NlUmUuZXhlYyhyZW1haW5kZXIpO1xuICAgIGxldCBib2R5OiBzdHJpbmc7XG4gICAgbGV0IG1hdGNoRW5kOiBudW1iZXI7XG4gICAgaWYgKGNsb3NlTWF0Y2gpIHtcbiAgICAgIGJvZHkgPSByZW1haW5kZXIuc2xpY2UoMCwgY2xvc2VNYXRjaC5pbmRleCkucmVwbGFjZSgvXFxuJC8sICcnKTtcbiAgICAgIG1hdGNoRW5kID0gYm9keVN0YXJ0ICsgY2xvc2VNYXRjaC5pbmRleCArIGNsb3NlTWF0Y2hbMF0ubGVuZ3RoO1xuICAgIH0gZWxzZSBpZiAobmwgPT09IG51bGwpIHtcbiAgICAgIGJvZHkgPSAnJztcbiAgICAgIG1hdGNoRW5kID0gb3BlbkVuZDtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gVW50ZXJtaW5hdGVkIHdpdGggYSBib2R5IHJlZ2lvbjogdGhlIGRhdGEgcmVnaW9uIHJ1bnMgdG8gRU9GLlxuICAgICAgYm9keSA9IHJlbWFpbmRlci5yZXBsYWNlKC9cXG4kLywgJycpO1xuICAgICAgbWF0Y2hFbmQgPSByYXcubGVuZ3RoO1xuICAgIH1cblxuICAgIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yLCBvcGVuTWF0Y2guaW5kZXgpO1xuICAgIG1hc2tlZCArPSBgX19oZXJlZG9jXyR7d3JpdGVzLmxlbmd0aH1fX2A7XG4gICAgY3Vyc29yID0gbWF0Y2hFbmQ7XG4gICAgd3JpdGVzLnB1c2goeyByZWRpcmVjdDogcmVkaXJlY3QgYXMgJz4nIHwgJz4+JywgdGFyZ2V0LCBib2R5IH0pO1xuXG4gICAgSEVSRURPQ19PUEVOLmxhc3RJbmRleCA9IG1hdGNoRW5kO1xuICAgIG9wZW5NYXRjaCA9IEhFUkVET0NfT1BFTi5leGVjKHJhdyk7XG4gIH1cbiAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IpO1xuICByZXR1cm4geyB3cml0ZXMsIG1hc2tlZCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFdpbmRvdyBhbGdlYnJhIChwbGFuIFx1MDBBNzMpOiBzb3VyY2UgYW5hbHlzaXMgYW5kIHN0ZGluLXNlbGVjdG9yIGNsYXNzaWZpY2F0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIGBubGAncyBhcmctdGFraW5nIGZsYWdzIFx1MjAxNCBlYWNoIGNvbnN1bWVzIHRoZSBmb2xsb3dpbmcgd29yZCAocGxhbiBcdTAwQTczKS4gKi9cbmNvbnN0IE5MX0FSR19GTEFHUyA9IG5ldyBTZXQoWyctYicsICctaScsICctbCcsICctcycsICctdicsICctdyddKTtcblxuLyoqIFN0ZG91dC1mb3JtIHJlZGlyZWN0IG9wZXJhdG9ycyBvbiB0aGUgcHJlLXN0cmlwIGFyZ3YgKHBsYW4gXHUwMEE3MyBzZXZlcmFuY2UpOiBgPmAsIGA+PmAsIGAmPmAsIGAmPj5gLCBgMT5gLCBgMT4+YCwgYD58YC4gKi9cbmNvbnN0IFNURE9VVF9SRURJUkVDVF9UV09fVE9LRU4gPSAvXig/Oj4+P3wmPj4/fDE+Pj98PlxcfCkkLztcbmNvbnN0IFNURE9VVF9SRURJUkVDVF9GVVNFRCA9IC9eKD86Pj4/fCY+Pj98MT4+PylbXjw+JnxdLztcbmNvbnN0IFNURE9VVF9SRURJUkVDVF9GVVNFRF9QSVBFID0gL14+XFx8W148PiZ8XS87XG5cbi8qKiBXaGV0aGVyIGEgcHJlLXN0cmlwIGFyZ3YgY2FycmllcyBhIHN0ZG91dC1mb3JtIHJlZGlyZWN0IChzdGRlcnIgYDI+YCBhbmQgZHVwIGAyPiYxYCBuZXZlciBzZXZlcikuICovXG5jb25zdCBoYXNTdGRvdXRSZWRpcmVjdCA9IChyYXc6IHN0cmluZ1tdKTogYm9vbGVhbiA9PlxuICByYXcuc29tZShcbiAgICAodykgPT4gU1RET1VUX1JFRElSRUNUX1RXT19UT0tFTi50ZXN0KHcpIHx8IFNURE9VVF9SRURJUkVDVF9GVVNFRC50ZXN0KHcpIHx8IFNURE9VVF9SRURJUkVDVF9GVVNFRF9QSVBFLnRlc3QodylcbiAgKTtcblxudHlwZSBTb3VyY2VBbmFseXNpcyA9XG4gIHwgeyBraW5kOiAnbm9uZScgfVxuICB8IHsga2luZDogJ3VubmFycm93YWJsZSc7IGZpbGVzOiB7IGZpbGVBcmc6IHN0cmluZzsgaWRpb206ICdjYXQtZmlsZScgfCAnbmwtZmlsZScgfVtdIH1cbiAgfCB7IGtpbmQ6ICduYXJyb3dhYmxlJzsgZmlsZUFyZzogc3RyaW5nOyBpZGlvbTogJ2NhdC1maWxlJyB8ICdubC1maWxlJzsgcmVzb2x2ZXJLaW5kOiAnZnMnOyBkaXJPdmVycmlkZT86IHN0cmluZyB9XG4gIHwge1xuICAgICAga2luZDogJ2dpdCc7XG4gICAgICBmaWxlQXJnOiBzdHJpbmc7XG4gICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJztcbiAgICAgIHJldjogc3RyaW5nO1xuICAgICAgcmVzb2x2ZXJLaW5kOiB7IGtpbmQ6ICdnaXQnOyByZXY6IHN0cmluZyB9O1xuICAgICAgZGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG4gICAgfVxuICB8IHsga2luZDogJ2dpdFVucmVzb2x2ZWQnOyBmaWxlQXJnOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH07XG5cbi8qKiBBIHNvdXJjZSB0aGF0IG9wZW5zIGEgbmFycm93YWJsZSB3aW5kb3c6IGEgc2luZ2xlLWZpbGUgYGNhdGAvYG5sYCBvciBhIGBnaXQgc2hvdyByZXY6cGF0aGAuICovXG50eXBlIE5hcnJvd2FibGVTb3VyY2UgPSBFeHRyYWN0PFNvdXJjZUFuYWx5c2lzLCB7IGtpbmQ6ICduYXJyb3dhYmxlJyB8ICdnaXQnIH0+O1xuXG4vKipcbiAqIFRoZSBwaXBlbGluZS1zb3VyY2UgYW5hbHlzaXMgKHBsYW4gXHUwMEE3Myk6IGEgYGNhdGAvYG5sYCB3aG9zZSBmaWxlIGFyZ3MgXHUyMDE0XG4gKiBldmVyeSBub24tZmxhZyB3b3JkLCB3aGVyZSBhIGAtYC1wcmVmaXhlZCB3b3JkIGlzIGEgZmxhZyBhbmQgYSBiYXJlIGAtYCBpc1xuICogYSBzdGRpbiBtYXJrZXIgXHUyMDE0IGFyZSBhbGwgZmlsZXMtb3ItYC1gIHdpdGggYXQgbGVhc3Qgb25lIGZpbGUsIG9yIGFcbiAqIGBnaXQgc2hvdyByZXY6cGF0aGAuIEEgc2luZ2xlLWZpbGUgc291cmNlIGlzIG5hcnJvd2FibGU7IGEgbXVsdGktZmlsZSBvclxuICogc3RkaW4tbWl4ZWQgc291cmNlIGlzIHVuLW5hcnJvd2FibGUgKGVhY2ggZmlsZSBlbWl0cyBpdHMgb3duIGNvbnNlcnZhdGl2ZVxuICogd2hvbGUtZmlsZSByZWFkLCBhbmQgc3RkaW4gc2VsZWN0b3JzIG5ldmVyIG5hcnJvdyBpdCkuXG4gKi9cbmZ1bmN0aW9uIGFuYWx5emVTb3VyY2UoYXJndjogc3RyaW5nW10pOiBTb3VyY2VBbmFseXNpcyB7XG4gIGlmIChhcmd2WzBdID09PSAnY2F0JyB8fCBhcmd2WzBdID09PSAnbmwnKSB7XG4gICAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjYXQnKSB7XG4gICAgICBmb3IgKGxldCBpID0gMTsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSAmJiBhICE9PSAnLScpIGNvbnRpbnVlOyAvLyBhIGZsYWcgXHUyMDE0IGNhdCBmbGFncyBuZXZlciB0YWtlIGFyZ3VtZW50c1xuICAgICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGxldCBpID0gMTsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgICAgIGlmIChhID09PSAnLScpIHtcbiAgICAgICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgICAgIGlmIChOTF9BUkdfRkxBR1MuaGFzKGEpKSBpICs9IDE7IC8vIGFyZy10YWtpbmcgZmxhZyBjb25zdW1lcyB0aGUgbmV4dCB3b3JkXG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgcmVhbCA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgICBpZiAocmVhbC5sZW5ndGggPT09IDApIHJldHVybiB7IGtpbmQ6ICdub25lJyB9O1xuICAgIGNvbnN0IGlkaW9tID0gYXJndlswXSA9PT0gJ2NhdCcgPyAnY2F0LWZpbGUnIDogJ25sLWZpbGUnO1xuICAgIGlmIChyZWFsLmxlbmd0aCA9PT0gMSAmJiAhZmlsZXMuaW5jbHVkZXMoJy0nKSkge1xuICAgICAgcmV0dXJuIHsga2luZDogJ25hcnJvd2FibGUnLCBmaWxlQXJnOiByZWFsWzBdLCBpZGlvbSwgcmVzb2x2ZXJLaW5kOiAnZnMnIH07XG4gICAgfVxuICAgIHJldHVybiB7IGtpbmQ6ICd1bm5hcnJvd2FibGUnLCBmaWxlczogcmVhbC5tYXAoKGZpbGVBcmcpID0+ICh7IGZpbGVBcmcsIGlkaW9tIH0pKSB9O1xuICB9XG4gIGlmIChhcmd2WzBdID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IG91dGNvbWVzID0gbWF0Y2hHaXRTaG93KGFyZ3YpO1xuICAgIGlmIChvdXRjb21lcy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGNvbnN0IG8gPSBvdXRjb21lc1swXTtcbiAgICAgIGlmIChvLmtpbmQgPT09ICd1bnJlc29sdmVkJykge1xuICAgICAgICByZXR1cm4geyBraW5kOiAnZ2l0VW5yZXNvbHZlZCcsIGZpbGVBcmc6IG8uZmlsZUFyZywgcmVhc29uOiBvLnJlYXNvbiB9O1xuICAgICAgfVxuICAgICAgaWYgKG8ua2luZCA9PT0gJ2NhbmRpZGF0ZScgJiYgby5yZXNvbHZlcktpbmQgIT09ICdmcycpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBraW5kOiAnZ2l0JyxcbiAgICAgICAgICBmaWxlQXJnOiBvLmZpbGVBcmcsXG4gICAgICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICAgICAgcmV2OiBvLnJlc29sdmVyS2luZC5yZXYsXG4gICAgICAgICAgcmVzb2x2ZXJLaW5kOiBvLnJlc29sdmVyS2luZCxcbiAgICAgICAgICBkaXJPdmVycmlkZTogby5kaXJPdmVycmlkZVxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4geyBraW5kOiAnbm9uZScgfTtcbn1cblxudHlwZSBTdGRpblNlbGVjdG9yID1cbiAgfCB7IGtpbmQ6ICdoZWFkJzsgY291bnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndGFpbCc7IGNvdW50OiBudW1iZXI7IGZyb21TdGFydDogYm9vbGVhbiB9XG4gIHwgeyBraW5kOiAnc2VkJzsgcmFuZ2VzOiB7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIHwgJyQnIH1bXSB9O1xuXG4vKipcbiAqIFdoZXRoZXIgYSB3cmFwcGVyLXN0cmlwcGVkIHN0YWdlIGlzIGEgc3RkaW4gbGluZS1zZWxlY3RvciAocGxhbiBcdTAwQTczKTogYVxuICogYHNlZCAtbmAgcmFuZ2Ugc2NyaXB0LCBgaGVhZGAsIG9yIGB0YWlsYCB3aXRoIG5vIGZpbGUgYXJncyAoYSBiYXJlIGAtYCBpcyBhXG4gKiBzdGRpbiBtYXJrZXIsIG5vdCBhIGZpbGUpLiBBIHJlY29nbml6ZWQgc2VsZWN0b3IgY2FycnlpbmcgaXRzIG93biBmaWxlIGFyZ3NcbiAqIGlzIGEgbm9uLWNvbnN1bWVyIFx1MjAxNCBpdCBuZXZlciByZWFkcyB0aGUgcGlwZSBcdTIwMTQgYW5kIHJldHVybnMgbnVsbC5cbiAqL1xuZnVuY3Rpb24gY2xhc3NpZnlTdGRpblNlbGVjdG9yKGFyZ3Y6IHN0cmluZ1tdKTogU3RkaW5TZWxlY3RvciB8IG51bGwge1xuICBpZiAoYXJndlswXSA9PT0gJ2hlYWQnIHx8IGFyZ3ZbMF0gPT09ICd0YWlsJykge1xuICAgIGNvbnN0IHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSksIGFyZ3ZbMF0gPT09ICd0YWlsJyk7XG4gICAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIG51bGw7IC8vIGJ5dGUvemVyby10ZXJtaW5hdGVkIHJlYWRzIGFyZSBub3QgbGluZSBzZWxlY3RvcnNcbiAgICBjb25zdCBmaWxlQXJncyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgICBpZiAoZmlsZUFyZ3MubGVuZ3RoID4gMCkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIGFyZ3ZbMF0gPT09ICdoZWFkJyA/IHsga2luZDogJ2hlYWQnLCBjb3VudDogY291bnQgPz8gMTAgfSA6IHsga2luZDogJ3RhaWwnLCBjb3VudDogY291bnQgPz8gMTAsIGZyb21TdGFydCB9O1xuICB9XG4gIGlmIChhcmd2WzBdID09PSAnc2VkJykge1xuICAgIGNvbnN0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICAgIGlmICghcmVzdC5pbmNsdWRlcygnLW4nKSkgcmV0dXJuIG51bGw7XG4gICAgbGV0IHNjcmlwdElkeCA9IC0xO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKHJlc3RbaV0gPT09ICctbicpIGNvbnRpbnVlO1xuICAgICAgaWYgKHNlZFNjcmlwdFNlZ21lbnRzKHJlc3RbaV0pLnNvbWUoKHNlZykgPT4gU0VEX1JBTkdFLnRlc3Qoc2VnKSkpIHtcbiAgICAgICAgc2NyaXB0SWR4ID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChzY3JpcHRJZHggPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBmaWxlQ2FuZGlkYXRlcyA9IHJlc3QuZmlsdGVyKChhLCBpKSA9PiBpICE9PSBzY3JpcHRJZHggJiYgYSAhPT0gJy1uJyAmJiAhYS5zdGFydHNXaXRoKCctJykpO1xuICAgIGlmIChmaWxlQ2FuZGlkYXRlcy5sZW5ndGggIT09IDApIHJldHVybiBudWxsOyAvLyBub24tY29uc3VtZXIgXHUyMDE0IHJlYWRzIGl0cyBmaWxlLCBuZXZlciB0aGUgcGlwZVxuICAgIGNvbnN0IHJhbmdlczogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB8ICckJyB9W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VkU2NyaXB0U2VnbWVudHMocmVzdFtzY3JpcHRJZHhdKSkge1xuICAgICAgY29uc3QgbSA9IHNlZ21lbnQubWF0Y2goU0VEX1JBTkdFKTtcbiAgICAgIGlmICghbSkgY29udGludWU7XG4gICAgICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtWzFdLCAxMCk7XG4gICAgICByYW5nZXMucHVzaCh7IHN0YXJ0LCBlbmQ6IG1bMl0gPT09IHVuZGVmaW5lZCA/IHN0YXJ0IDogbVsyXSA9PT0gJyQnID8gJyQnIDogTnVtYmVyLnBhcnNlSW50KG1bMl0sIDEwKSB9KTtcbiAgICB9XG4gICAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7IGtpbmQ6ICdzZWQnLCByYW5nZXMgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcmNoZXN0cmF0b3Jcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBMSU5FX1NFTEVDVE9SUyA9IFttYXRjaFNlZCwgbWF0Y2hIZWFkLCBtYXRjaFRhaWxdO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZDogc3RyaW5nLCBvcHRzOiBQYXJzZU9wdGlvbnMgPSB7fSk6IFNwYW5NYXRjaFtdIHtcbiAgY29uc3QgY3dkID0gb3B0cy5jd2QgPz8gcHJvY2Vzcy5jd2QoKTtcbiAgLy8gUGxhbiBcdTAwQTc3OiB0aGUgcGFyc2VyIGRlZmF1bHRzIGBlbnZgIHRvIHRoZSBob29rIHByb2Nlc3MgZW52LCBnYXRlZCBieSB0aGVcbiAgLy8gYWxsb3dsaXN0IFx1MjAxNCBvbmx5IGBERUZBVUxUX1BBVEhfQUxMT1dMSVNUYCBuYW1lcyBtYXkgcmVzb2x2ZSBmcm9tIGl0LiBBblxuICAvLyBleHBsaWNpdGx5IGluamVjdGVkIGVudiAodGVzdHMsIGFkYXB0ZXJzKSBpcyBjb25zdWx0ZWQgd2hvbGVzYWxlLlxuICBjb25zdCBhbGxvd2xpc3QgPSBvcHRzLmFsbG93bGlzdCA/PyBERUZBVUxUX1BBVEhfQUxMT1dMSVNUO1xuICBjb25zdCBlbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD4gPVxuICAgIG9wdHMuZW52ID8/IE9iamVjdC5mcm9tRW50cmllcyhhbGxvd2xpc3QubWFwKChuKSA9PiBbbiwgcHJvY2Vzcy5lbnZbbl1dKSk7XG4gIGNvbnN0IHsgd3JpdGVzOiBoZXJlZG9jV3JpdGVzLCBtYXNrZWQgfSA9IGV4dHJhY3RIZXJlZG9jV3JpdGVzKGNvbW1hbmQpO1xuICBjb25zdCB7IHN0YWdlczogc2ltcGxlQ29tbWFuZHMsIG1hbGZvcm1lZCB9ID0gc3BsaXRUb3BMZXZlbChtYXNrZWQpO1xuXG4gIC8vIFZlcmRpY3QgY29uc3VtcHRpb24gKHBsYW4gXHUwMEE3MSwgbGlzdC1zY29wZSArIHRlcm1pbmFsIHNlbWFudGljcyk6IHRoZVxuICAvLyBzcGxpdHRlciBoYXMgYWxyZWFkeSBkcm9wcGVkIHRoZSByZWplY3RpbmcgbGlzdCdzIHN0YWdlcyBhbmQgdHJ1bmNhdGVkIGF0XG4gIC8vIHRoZSBmaXJzdCBtYWxmb3JtZWQgbGlzdCwgc28gYHNpbXBsZUNvbW1hbmRzYCBpcyBleGFjdGx5IHRoZSBjb21wbGV0ZWRcbiAgLy8gZWFybGllciBsaXN0cyBhbmQgd2Fsa3Mgbm9ybWFsbHkgYmVsb3cgXHUyMDE0IHRoZSBmdWxsLWxpbmUga2luZHNcbiAgLy8gKCd1bmNsb3NlZC1xdW90ZScsICd1bmJhbGFuY2VkLXBhcmVuJywgJ2RhbmdsaW5nLW9wZXJhdG9yJywgJ3BpcGUtYmFuZycsXG4gIC8vICd1bmNsb3NlZC1icmFjZScsICd1bmNsb3NlZC1jYXNlJywgJ3VuY2xvc2VkLWNvbnN0cnVjdCcpIGVtaXQgbm8gdG91Y2hlc1xuICAvLyB3aXRob3V0IGZ1cnRoZXIgaGFuZGxpbmcuICd1bnRlcm1pbmF0ZWQtaGVyZWRvYycgKHRoZSBwYXJ0aWFsLCBhcnJpdmluZ1xuICAvLyB3aXRoIHRoZSBoZXJlZG9jIG1hY2hpbmVyeSBpbiBhIGxhdGVyIHBoYXNlKSBrZWVwcyB0aGUgY3VycmVudCBiZWhhdmlvcjpcbiAgLy8gaXRzIHN0YWdlIGxpc3QgcnVucyB0aHJvdWdoIHRoZSBkZWxpbWl0ZXIncyBsaW5lIGFuZCBsaWtld2lzZSBhbmFseXplc1xuICAvLyBhcy1pcy5cbiAgdm9pZCBtYWxmb3JtZWQ7XG5cbiAgLy8gVGhlIGV4ZWN1dGlvbiB3YWxrIChwbGFuIFx1MDBBNzIpIGRlY2lkZXMgd2hpY2ggc3RhZ2VzIHJhbiBhbmQgZXhwYW5kcyB0aGVcbiAgLy8gZGVjaWRhYmxlIGNvbnN0cnVjdCBpbnRlcmlvcnMgaW4gdGhlaXIgcGxhY2UuIE9ubHkgYCd5ZXMnYCBzdGFnZXMgZW1pdC5cbiAgY29uc3QgZXhwYW5kZWQgPSBuZXcgRXhlY3V0aW9uV2Fsa2VyKCkud2Fsa0lucHV0KHNpbXBsZUNvbW1hbmRzKTtcblxuICBjb25zdCByZXN1bHRzOiBTcGFuTWF0Y2hbXSA9IFtdO1xuICBjb25zdCBmc0xpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuICBjb25zdCBnaXRMaW5lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyIHwgbnVsbD4oKTtcblxuICBjb25zdCBjYWNoZWRGc1RvdGFsTGluZXMgPSAoYWJzUGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgaWYgKCFmc0xpbmVDYWNoZS5oYXMoYWJzUGF0aCkpIGZzTGluZUNhY2hlLnNldChhYnNQYXRoLCBjb3VudEZpbGVMaW5lcyhhYnNQYXRoKSk7XG4gICAgcmV0dXJuIGZzTGluZUNhY2hlLmdldChhYnNQYXRoKSA/PyBudWxsO1xuICB9O1xuICBjb25zdCBjYWNoZWRHaXRUb3RhbExpbmVzID0gKGdpdEN3ZDogc3RyaW5nLCByZXY6IHN0cmluZywgcGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gYCR7Z2l0Q3dkfVxcdTAwMDAke3Jldn1cXHUwMDAwJHtwYXRofWA7XG4gICAgaWYgKCFnaXRMaW5lQ2FjaGUuaGFzKGtleSkpIGdpdExpbmVDYWNoZS5zZXQoa2V5LCBjb3VudEdpdEJsb2JMaW5lcyhnaXRDd2QsIHJldiwgcGF0aCkpO1xuICAgIHJldHVybiBnaXRMaW5lQ2FjaGUuZ2V0KGtleSkgPz8gbnVsbDtcbiAgfTtcblxuICAvLyBgY2RgIGZyYW1lcyAocGxhbiBcdTAwQTc2KTogdGhlIHdhbGsgYXNzaWducyBlYWNoIHN0YWdlIHRoZSBzdWJzaGVsbCBmcmFtZSBpdFxuICAvLyByYW4gaW47IGEgc3Vic2hlbGwncyBgY2RgIHJlLWJhc2VzIHdpdGhpbiBpdHMgZnJlc2ggZnJhbWUsIGRpc2NhcmRlZCBhdFxuICAvLyB0aGUgY2xvc2UuIEVhY2ggZnJhbWUgdHJhY2tzIHRoZSBjb21wb3NlZCBlZmZlY3RpdmUgZGlyZWN0b3J5LCBpdHNcbiAgLy8gY2VydGFpbnR5IChhbiBleGVjdXRlZCBvciBtYXktaGF2ZS1ydW4gYGNkYCB3aXRoIGFuIHVucmVzb2x2YWJsZSB0YXJnZXRcbiAgLy8gcG9pc29ucyBpdCBcdTIwMTQgcmVsYXRpdmUgcmVzb2x1dGlvbiBmYWlscyBjbG9zZWQpLCBhbmQgdGhlIHByZS1gY2RgIHBhdGhcbiAgLy8gKGBjZCAtYCdzIE9MRFBXRCkuXG4gIGludGVyZmFjZSBEaXJGcmFtZSB7XG4gICAgZGlyOiBzdHJpbmc7XG4gICAgY2VydGFpbjogYm9vbGVhbjtcbiAgICBwcmV2OiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIH1cbiAgY29uc3QgZGlyRnJhbWVzOiBEaXJGcmFtZVtdID0gW3sgZGlyOiBjd2QsIGNlcnRhaW46IHRydWUsIHByZXY6IHVuZGVmaW5lZCB9XTtcblxuICAvKiogVGhlIHBhcnRzIG9mIGEgZnJhbWUgdGhlIHJlc29sdXRpb24gcGF0aHMgbmVlZCAobm8gT0xEUFdEKS4gKi9cbiAgaW50ZXJmYWNlIEZyYW1lIHtcbiAgICBkaXI6IHN0cmluZztcbiAgICBjZXJ0YWluOiBib29sZWFuO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBlZmZlY3RpdmUgZ2l0IHJlcG8gZGlyIGZvciBhIGNhbmRpZGF0ZSAocGxhbiBcdTAwQTc2KTogYW4gYWJzb2x1dGUgYC1DYFxuICAgKiB0YXJnZXQgaXMgc2VsZi1jb250YWluZWQ7IGEgcmVsYXRpdmUgb25lIGNvbXBvc2VzIHdpdGggdGhlIHRyYWNrZWRcbiAgICogZGlyZWN0b3J5OyBubyBgLUNgIHVzZXMgdGhlIHRyYWNrZWQgZGlyZWN0b3J5IGl0c2VsZi4gVW5kZWZpbmVkIHdoZW4gdGhlXG4gICAqIGZyYW1lIGlzIHVuY2VydGFpbiBcdTIwMTQgdGhlIHJlcG8gbG9jYXRpb24gaXMgdW5rbm93biwgZmFpbCBjbG9zZWQuXG4gICAqL1xuICBjb25zdCBnaXREaXJPZiA9IChjOiB7IGRpck92ZXJyaWRlPzogc3RyaW5nIH0sIGZyYW1lOiBGcmFtZSk6IHN0cmluZyB8IHVuZGVmaW5lZCA9PiB7XG4gICAgaWYgKGMuZGlyT3ZlcnJpZGUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZyYW1lLmNlcnRhaW4gPyBmcmFtZS5kaXIgOiB1bmRlZmluZWQ7XG4gICAgaWYgKGlzQWJzb2x1dGUoYy5kaXJPdmVycmlkZSkpIHJldHVybiBjLmRpck92ZXJyaWRlO1xuICAgIHJldHVybiBmcmFtZS5jZXJ0YWluID8gcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCBjLmRpck92ZXJyaWRlKSA6IHVuZGVmaW5lZDtcbiAgfTtcblxuICAvKiogVGhlIHJ1bm5pbmcgd2luZG93IG9mIHRoZSBjdXJyZW50IHBpcGVsaW5lIGdyb3VwIChwbGFuIFx1MDBBNzMpLiAqL1xuICBpbnRlcmZhY2UgV2luZG93U3RhdGUge1xuICAgIGlkaW9tOiBJZGlvbTtcbiAgICBmaWxlQXJnOiBzdHJpbmc7XG4gICAgZGlyOiBzdHJpbmc7XG4gICAgY2VydGFpbjogYm9vbGVhbjtcbiAgICBkaXJPdmVycmlkZT86IHN0cmluZztcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgfCB7IGtpbmQ6ICdnaXQnOyByZXY6IHN0cmluZyB9O1xuICAgIGxvOiBudW1iZXI7XG4gICAgaGk6IG51bWJlcjtcbiAgICBjb25zdW1lZDogYm9vbGVhbjtcbiAgfVxuICBsZXQgd2luZG93OiBXaW5kb3dTdGF0ZSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0IHdob2xlRmlsZUNhbmRpZGF0ZSA9IChzOiB7IGZpbGVBcmc6IHN0cmluZzsgaWRpb206ICdjYXQtZmlsZScgfCAnbmwtZmlsZScgfSk6IFJhd0NhbmRpZGF0ZSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgIGlkaW9tOiBzLmlkaW9tLFxuICAgIGZpbGVBcmc6IHMuZmlsZUFyZyxcbiAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnXG4gIH0pO1xuXG4gIC8qKiBBIHNvdXJjZSdzIHdob2xlLWZpbGUgcmVhZCBhcyBhIGNhbmRpZGF0ZSAoZnMgb3IgZ2l0IHJlc29sdmVyKS4gKi9cbiAgY29uc3Qgc291cmNlQ2FuZGlkYXRlID0gKHNyYzogTmFycm93YWJsZVNvdXJjZSk6IFJhd0NhbmRpZGF0ZSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgIGlkaW9tOiBzcmMuaWRpb20sXG4gICAgZmlsZUFyZzogc3JjLmZpbGVBcmcsXG4gICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgIHJlc29sdmVyS2luZDogc3JjLnJlc29sdmVyS2luZCxcbiAgICBkaXJPdmVycmlkZTogc3JjLmRpck92ZXJyaWRlXG4gIH0pO1xuXG4gIC8qKiBFbWl0IHRoZSB3aW5kb3cncyB0b3VjaDogb25lIG5hcnJvdyByYW5nZSB3aGVuIGEgc3RkaW4gc2VsZWN0b3IgY29uc3VtZWQgaXQsIGVsc2UgdGhlIHdob2xlLWZpbGUgcmVhZC4gKi9cbiAgY29uc3QgZW1pdFdpbmRvd1RvdWNoID0gKHc6IFdpbmRvd1N0YXRlKSA9PiB7XG4gICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9IHcuY29uc3VtZWQgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IHcubG8sIGVuZDogdy5oaSB9IDogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9O1xuICAgIGVtaXRDYW5kaWRhdGUoXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgICBpZGlvbTogdy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogdy5maWxlQXJnLFxuICAgICAgICBzcGVjLFxuICAgICAgICByZXNvbHZlcktpbmQ6IHcucmVzb2x2ZXJLaW5kLFxuICAgICAgICBkaXJPdmVycmlkZTogdy5kaXJPdmVycmlkZVxuICAgICAgfSxcbiAgICAgIHsgZGlyOiB3LmRpciwgY2VydGFpbjogdy5jZXJ0YWluIH1cbiAgICApO1xuICB9O1xuXG4gIC8qKlxuICAgKiBPcGVuIGEgd2luZG93IG92ZXIgYSBuYXJyb3dhYmxlIHNvdXJjZS4gQW4gdW5yZXNvbHZhYmxlIHNvdXJjZSBcdTIwMTQgYW5cbiAgICogdW5leHBhbmRlZCBwYXRoLCBhbiB1bmNlcnRhaW4gdHJhY2tlZCBkaXJlY3RvcnksIG9yIGFuIHVucmVzb2x2YWJsZVxuICAgKiBgZ2l0IC1DYCB0YXJnZXQgKHBsYW4gXHUwMEE3NikgXHUyMDE0IGVtaXRzIGFuIGB1bnJlc29sdmVkYCBlbnRyeSBhbmQgbm8gd2luZG93OlxuICAgKiBkb3duc3RyZWFtIHN0ZGluIHNlbGVjdG9ycyBjb25zdW1lIG5vdGhpbmcgKHBsYW4gXHUwMEE3MykuXG4gICAqL1xuICBjb25zdCBpbml0V2luZG93ID0gKHNyYzogTmFycm93YWJsZVNvdXJjZSwgZnJhbWU6IEZyYW1lKSA9PiB7XG4gICAgaWYgKFxuICAgICAgZ2l0RGlyT2Yoc3JjLCBmcmFtZSkgPT09IHVuZGVmaW5lZCB8fFxuICAgICAgKCFmcmFtZS5jZXJ0YWluICYmIHNyYy5yZXNvbHZlcktpbmQgPT09ICdmcycgJiYgIWlzQWJzb2x1dGUoc3JjLmZpbGVBcmcpKVxuICAgICkge1xuICAgICAgZW1pdENhbmRpZGF0ZShzb3VyY2VDYW5kaWRhdGUoc3JjKSwgZnJhbWUpOyAvLyB0aGUgZ2F0ZSByZXBvcnRzIHRoZSB1bnJlc29sdmVkIGVudHJ5XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHRvdGFsID0gKFxuICAgICAgc3JjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJ1xuICAgICAgICA/IGNhY2hlZEZzVG90YWxMaW5lcyhyZXNvbHZlUGF0aChmcmFtZS5kaXIsIHNyYy5maWxlQXJnKSlcbiAgICAgICAgOiBjYWNoZWRHaXRUb3RhbExpbmVzKGdpdERpck9mKHNyYywgZnJhbWUpISwgc3JjLnJlc29sdmVyS2luZC5yZXYsIHNyYy5maWxlQXJnKVxuICAgICkoKTtcbiAgICBpZiAodG90YWwgPT09IG51bGwpIHtcbiAgICAgIGVtaXRDYW5kaWRhdGUoc291cmNlQ2FuZGlkYXRlKHNyYyksIGZyYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgd2luZG93ID0ge1xuICAgICAgaWRpb206IHNyYy5pZGlvbSxcbiAgICAgIGZpbGVBcmc6IHNyYy5maWxlQXJnLFxuICAgICAgZGlyOiBmcmFtZS5kaXIsXG4gICAgICBjZXJ0YWluOiBmcmFtZS5jZXJ0YWluLFxuICAgICAgZGlyT3ZlcnJpZGU6IHNyYy5kaXJPdmVycmlkZSxcbiAgICAgIHJlc29sdmVyS2luZDogc3JjLnJlc29sdmVyS2luZCxcbiAgICAgIGxvOiAxLFxuICAgICAgaGk6IHRvdGFsLFxuICAgICAgY29uc3VtZWQ6IGZhbHNlXG4gICAgfTtcbiAgfTtcblxuICAvKipcbiAgICogQXBwbHkgYSBzdGRpbiBzZWxlY3RvcidzIHRyYW5zZm9ybSB0byB0aGUgbGl2ZSB3aW5kb3csIGNsYW1wZWQgdG8gdGhlXG4gICAqIGN1cnJlbnQgd2luZG93LiBBIG5hcnJvd2luZyB0cmFuc2Zvcm0gbWFya3MgdGhlIHdpbmRvdyBjb25zdW1lZCAodGhlXG4gICAqIGVtaXR0ZWQgdG91Y2ggaXMgdGhlIG5hcnJvdyByYW5nZSwgbm90IHRoZSB3aG9sZS1maWxlIHJlYWQpLiBSZXR1cm5zXG4gICAqIGZhbHNlIHdoZW4gdGhlIHRyYW5zZm9ybSBlbXB0aWVzIHRoZSB3aW5kb3cgXHUyMDE0IHRoZSBwcmUtdHJhbnNmb3JtIHdpbmRvd1xuICAgKiBzdXJ2aXZlcyAod2hhdCBhIHJlYWRlciBhY3R1YWxseSBjb25zdW1lZCkgYW5kIHN0YXlzIHVuY29uc3VtZWQuXG4gICAqL1xuICBjb25zdCBhcHBseVdpbmRvd1RyYW5zZm9ybSA9IChzZWw6IFN0ZGluU2VsZWN0b3IpOiBib29sZWFuID0+IHtcbiAgICBjb25zdCB3ID0gd2luZG93ITtcbiAgICBjb25zdCBsbyA9IHcubG87XG4gICAgY29uc3QgaGkgPSB3LmhpO1xuICAgIGxldCBuTG86IG51bWJlcjtcbiAgICBsZXQgbkhpOiBudW1iZXI7XG4gICAgaWYgKHNlbC5raW5kID09PSAnaGVhZCcpIHtcbiAgICAgIG5MbyA9IGxvO1xuICAgICAgbkhpID0gbG8gKyBzZWwuY291bnQgLSAxO1xuICAgIH0gZWxzZSBpZiAoc2VsLmtpbmQgPT09ICd0YWlsJykge1xuICAgICAgaWYgKHNlbC5mcm9tU3RhcnQpIHtcbiAgICAgICAgbkxvID0gbG8gKyBzZWwuY291bnQgLSAxO1xuICAgICAgICBuSGkgPSBoaTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5MbyA9IGhpIC0gc2VsLmNvdW50ICsgMTtcbiAgICAgICAgbkhpID0gaGk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG5MbyA9IGxvICsgc2VsLnJhbmdlc1swXS5zdGFydCAtIDE7XG4gICAgICBuSGkgPSBzZWwucmFuZ2VzWzBdLmVuZCA9PT0gJyQnID8gaGkgOiBsbyArIHNlbC5yYW5nZXNbMF0uZW5kIC0gMTtcbiAgICB9XG4gICAgbkxvID0gTWF0aC5tYXgobkxvLCBsbyk7XG4gICAgbkhpID0gTWF0aC5taW4obkhpLCBoaSk7XG4gICAgaWYgKG5MbyA+IG5IaSkgcmV0dXJuIGZhbHNlO1xuICAgIHcubG8gPSBuTG87XG4gICAgdy5oaSA9IG5IaTtcbiAgICB3LmNvbnN1bWVkID0gdHJ1ZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICAvKiogQSBtdWx0aS1yYW5nZSBzdGRpbiBzZWQgZGVsaXZlcnMgZWFjaCByYW5nZSBhcyBpdHMgb3duIHRvdWNoIGFuZCBzZXZlcnM7IGVtcHR5IGNsYW1wcyBkcm9wLiAqL1xuICBjb25zdCBlbWl0TXVsdGlSYW5nZSA9IChyYW5nZXM6IHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfCAnJCcgfVtdKSA9PiB7XG4gICAgY29uc3QgdyA9IHdpbmRvdyE7XG4gICAgbGV0IGVtaXR0ZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IHIgb2YgcmFuZ2VzKSB7XG4gICAgICBjb25zdCBtTG8gPSBNYXRoLm1heCh3LmxvLCB3LmxvICsgci5zdGFydCAtIDEpO1xuICAgICAgY29uc3QgbUhpID0gTWF0aC5taW4ody5oaSwgci5lbmQgPT09ICckJyA/IHcuaGkgOiB3LmxvICsgci5lbmQgLSAxKTtcbiAgICAgIGlmIChtTG8gPiBtSGkpIGNvbnRpbnVlO1xuICAgICAgZW1pdHRlZCA9IHRydWU7XG4gICAgICBlbWl0Q2FuZGlkYXRlKFxuICAgICAgICB7XG4gICAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgICAgaWRpb206IHcuaWRpb20sXG4gICAgICAgICAgZmlsZUFyZzogdy5maWxlQXJnLFxuICAgICAgICAgIHNwZWM6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogbUxvLCBlbmQ6IG1IaSB9LFxuICAgICAgICAgIHJlc29sdmVyS2luZDogdy5yZXNvbHZlcktpbmQsXG4gICAgICAgICAgZGlyT3ZlcnJpZGU6IHcuZGlyT3ZlcnJpZGVcbiAgICAgICAgfSxcbiAgICAgICAgeyBkaXI6IHcuZGlyLCBjZXJ0YWluOiB3LmNlcnRhaW4gfVxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKCFlbWl0dGVkKSBlbWl0V2luZG93VG91Y2godyk7IC8vIGV2ZXJ5IHJhbmdlIGRyb3BwZWQgXHUyMDE0IHRoZSBwcmUtdHJhbnNmb3JtIHdpbmRvdyBzdXJ2aXZlc1xuICB9O1xuXG4gIGNvbnN0IGVtaXRDYW5kaWRhdGUgPSAoYzogUmF3Q2FuZGlkYXRlLCBmcmFtZTogRnJhbWUpID0+IHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoYy5maWxlQXJnKSkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBjLmZpbGVBcmcsXG4gICAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIFBsYW4gXHUwMEE3NiBjZXJ0YWludHk6IGEgcmVsYXRpdmUgcGF0aCBhZ2FpbnN0IGFuIHVuY2VydGFpbiBkaXJlY3RvcnksIG9yIGFcbiAgICAvLyBnaXQgY2FuZGlkYXRlIHdob3NlIHJlcG8gZnJhbWUgY2Fubm90IGJlIGNvbXBvc2VkLCBpcyB1bnJlc29sdmFibGUgXHUyMDE0XG4gICAgLy8gbmV2ZXIgYSBndWVzc2VkIHRvdWNoLiBBYnNvbHV0ZSBwYXRocyBhcmUgdW5hZmZlY3RlZC5cbiAgICBpZiAoYy5yZXNvbHZlcktpbmQgPT09ICdmcycpIHtcbiAgICAgIGlmICghZnJhbWUuY2VydGFpbiAmJiAhaXNBYnNvbHV0ZShjLmZpbGVBcmcpKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgICAgZmlsZUFyZzogYy5maWxlQXJnLFxuICAgICAgICAgIHJlYXNvbjogJ3RoZSB3b3JraW5nIGRpcmVjdG9yeSBpcyB1bmNlcnRhaW4gXHUyMDE0IHRoZSByZWxhdGl2ZSBwYXRoIGNhbm5vdCBiZSByZXNvbHZlZCdcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGdpdERpck9mKGMsIGZyYW1lKSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGMuZmlsZUFyZyxcbiAgICAgICAgcmVhc29uOiAndGhlIGdpdCAtQyB0YXJnZXQgY2Fubm90IGJlIHJlc29sdmVkIGFnYWluc3QgdGhlIHRyYWNrZWQgZGlyZWN0b3J5J1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIEEgZ2l0IGNhbmRpZGF0ZSdzIHBhdGggcmVzb2x2ZXMgaW5zaWRlIGl0cyByZXBvIGRpciAoYC1DYCB0YXJnZXQgb3IgdGhlXG4gICAgLy8gdHJhY2tlZCBkaXJlY3RvcnkpLCBub3QgdGhlIHByb2Nlc3MgZGlyIFx1MjAxNCBwbGFuIFx1MDBBNzYuXG4gICAgY29uc3QgcmVzb2x1dGlvbkRpciA9IGMucmVzb2x2ZXJLaW5kID09PSAnZnMnID8gZnJhbWUuZGlyIDogZ2l0RGlyT2YoYywgZnJhbWUpITtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChyZXNvbHV0aW9uRGlyLCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHRvdGFsTGluZXMgPVxuICAgICAgYy5yZXNvbHZlcktpbmQgPT09ICdmcydcbiAgICAgICAgPyBjYWNoZWRGc1RvdGFsTGluZXMoYWJzb2x1dGVQYXRoKVxuICAgICAgICA6IGNhY2hlZEdpdFRvdGFsTGluZXMocmVzb2x1dGlvbkRpciwgYy5yZXNvbHZlcktpbmQucmV2LCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoYy5zcGVjLCB0b3RhbExpbmVzKTtcbiAgICBpZiAocmFuZ2UgPT09IG51bGwpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYWJzb2x1dGVQYXRoLFxuICAgICAgICByZWFzb246ICdjb3VsZCBub3QgZGV0ZXJtaW5lIGVuZC1vZi1maWxlIGxpbmUgY291bnQgKGZpbGUgdW5yZWFkYWJsZSwgZW1wdHksIG9yIGdpdCByZXYvcGF0aCBub3QgZm91bmQpJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgIHNwYW46IHsgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsIGFic29sdXRlUGF0aCB9XG4gICAgfSk7XG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBleHBhbmRlZC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGl0ZW0gPSBleHBhbmRlZFtpXTtcbiAgICB3aGlsZSAoZGlyRnJhbWVzLmxlbmd0aCA+IGl0ZW0uZGlyRnJhbWUgKyAxKSBkaXJGcmFtZXMucG9wKCk7XG4gICAgd2hpbGUgKGRpckZyYW1lcy5sZW5ndGggPCBpdGVtLmRpckZyYW1lICsgMSkgZGlyRnJhbWVzLnB1c2goeyAuLi5kaXJGcmFtZXNbZGlyRnJhbWVzLmxlbmd0aCAtIDFdIH0pO1xuICAgIGNvbnN0IGZyYW1lID0gZGlyRnJhbWVzW2RpckZyYW1lcy5sZW5ndGggLSAxXTtcblxuICAgIC8vIGAkUFdEYCByZXNvbHZlcyB0byB0aGUgdHJhY2tlZCBkaXJlY3RvcnksIG5vdCB0aGUgc3RhbGUgaG9vayBlbnYgKHBsYW5cbiAgICAvLyBcdTAwQTc2KSBcdTIwMTQgdGhlIHBlci1zdGFnZSBlbnYgb3ZlcnJpZGVzIGl0IHdpdGggdGhlIGNvbXBvc2VkIGZyYW1lLlxuICAgIGNvbnN0IHN0YWdlRW52ID0geyAuLi5lbnYsIFBXRDogZnJhbWUuZGlyIH07XG5cbiAgICBjb25zdCBwaXBlUHJlY2VkZXMgPSBpdGVtLnByZWNlZGVkQnkgPT09ICdwaXBlJztcbiAgICBjb25zdCBwaXBlRm9sbG93cyA9IGV4cGFuZGVkW2kgKyAxXSAhPT0gdW5kZWZpbmVkICYmIGV4cGFuZGVkW2kgKyAxXS5wcmVjZWRlZEJ5ID09PSAncGlwZSc7XG5cbiAgICAvLyBBIHBpcGVsaW5lIGdyb3VwIGlzIGRvbmUgYXQgaXRzIG5leHQgbm9uLXBpcGUgc3RhZ2U6IGZsdXNoIHRoZSB3aW5kb3dcbiAgICAvLyAob25lIG5hcnJvdyB0b3VjaCBpZiBhIHN0ZGluIHNlbGVjdG9yIGNvbnN1bWVkIHRoZSBzb3VyY2UsIGVsc2UgdGhlXG4gICAgLy8gY29uc2VydmF0aXZlIHdob2xlLWZpbGUgcmVhZCBcdTIwMTQgcGxhbiBcdTAwQTczLCBlbWl0KS5cbiAgICBpZiAoIXBpcGVQcmVjZWRlcyAmJiB3aW5kb3cgIT09IG51bGwpIHtcbiAgICAgIGVtaXRXaW5kb3dUb3VjaCh3aW5kb3cpO1xuICAgICAgd2luZG93ID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBgY2RgIGJvb2trZWVwaW5nIChwbGFuIFx1MDBBNzYpIHJ1bnMgYmVmb3JlIHRoZSBleGVjIGdhdGU6IGEgbWF5LWhhdmUtcnVuXG4gICAgLy8gKGAndW5rbm93bidgKSBjZCBwb2lzb25zIGNlcnRhaW50eSBldmVuIHRob3VnaCBpdHMgb3duIHN0YWdlIGVtaXRzXG4gICAgLy8gbm90aGluZywgYW5kIGEgc2tpcHBlZCAoYCdubydgKSBjZCBsZWF2ZXMgdGhlIGRpciB1bmNoYW5nZWQuXG4gICAgY29uc3QgY2RBcmd2ID0gc3RyaXBGb3JFbWlzc2lvbihzdHJpcFJlZGlyZWN0cyhhcmd2T2YoaXRlbS50ZXh0KSA/PyBbXSkpO1xuICAgIGlmIChjZEFyZ3ZbMF0gPT09ICdjZCcgJiYgIWl0ZW0uaW5QaXBlbGluZSkge1xuICAgICAgaWYgKGl0ZW0uZXhlYyA9PT0gJ3llcycpIHtcbiAgICAgICAgLy8gVGhlIHRhcmdldCBleHBhbmRzIGxpa2UgYW55IG90aGVyIHdvcmQgXHUyMDE0IGBjZCBcIiRXT1JLU1BBQ0VfUEFUSFwiYFxuICAgICAgICAvLyBmaW5hbGx5IHdvcmtzIChwbGFuIFx1MDBBNzcpLiBCYXJlIGBjZGAgaXMgYCRIT01FYCB2aWEgdGhlIHNhbWVcbiAgICAgICAgLy8gZXhwYW5zaW9uIG1hY2hpbmVyeS5cbiAgICAgICAgY29uc3QgZXhwYW5kZWRBcmd2ID0gc3RyaXBGb3JFbWlzc2lvbihcbiAgICAgICAgICBzdHJpcFJlZGlyZWN0cyhhcmd2T2YoZXhwYW5kVmFyaWFibGVzKGl0ZW0udGV4dCwgaXRlbS5hc3NpZ25tZW50cywgc3RhZ2VFbnYpKSA/PyBbXSlcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gZXhwYW5kZWRBcmd2WzFdO1xuICAgICAgICBpZiAodGFyZ2V0ID09PSB1bmRlZmluZWQgfHwgdGFyZ2V0ID09PSAnficgfHwgdGFyZ2V0LnN0YXJ0c1dpdGgoJ34vJykpIHtcbiAgICAgICAgICAvLyBCYXJlIGBjZGAgaXMgYCRIT01FYDsgYSBgfmAvYH4vXHUyMDI2YCB0YXJnZXQgaXMgdGhlIHNhbWUgdGlsZGVcbiAgICAgICAgICAvLyBleHBhbnNpb24gKHBsYW4gXHUwMEE3NikgXHUyMDE0IHRoZSBhbGxvd2xpc3RlZCBIT01FIHZpYSB0aGUgZXhwYW5zaW9uXG4gICAgICAgICAgLy8gbWFjaGluZXJ5LCBjZXJ0YWluIHdoZW4gaXQgcmVzb2x2ZXMsIHVuY2VydGFpbiBvdGhlcndpc2UuXG4gICAgICAgICAgY29uc3QgaG9tZSA9IGV4cGFuZFZhcmlhYmxlcygnJEhPTUUnLCBpdGVtLmFzc2lnbm1lbnRzLCBzdGFnZUVudik7XG4gICAgICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGhvbWUpKSBmcmFtZS5jZXJ0YWluID0gZmFsc2U7XG4gICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBmcmFtZS5wcmV2ID0gZnJhbWUuZGlyO1xuICAgICAgICAgICAgZnJhbWUuZGlyID0gcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCB0YXJnZXQgPT09IHVuZGVmaW5lZCA/IGhvbWUgOiBob21lICsgdGFyZ2V0LnNsaWNlKDEpKTtcbiAgICAgICAgICAgIGZyYW1lLmNlcnRhaW4gPSB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh0YXJnZXQgPT09ICctJykge1xuICAgICAgICAgIC8vIGBjZCAtYCBpcyBiYXNoJ3MgT0xEUFdEIFx1MjAxNCB0aGUgcHJldmlvdXMgdHJhY2tlZCBwYXRoLiBXaXRoIG5vXG4gICAgICAgICAgLy8gcHJldmlvdXMgcGF0aCB0aGUgY2QgZmFpbHMgYW5kIHRoZSBzaGVsbCBzdGF5cyBwdXQuXG4gICAgICAgICAgaWYgKGZyYW1lLnByZXYgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc3Qgb2xkID0gZnJhbWUuZGlyO1xuICAgICAgICAgICAgZnJhbWUuZGlyID0gZnJhbWUucHJldjtcbiAgICAgICAgICAgIGZyYW1lLnByZXYgPSBvbGQ7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHRhcmdldC5zdGFydHNXaXRoKCd+JykpIHtcbiAgICAgICAgICAvLyBBIGB+dXNlcmAtc3R5bGUgdGFyZ2V0IHJlc29sdmVzIHRvIHRoYXQgdXNlcidzIGhvbWUgXHUyMDE0IHVua25vd24gdG9cbiAgICAgICAgICAvLyB0aGUgd2FsazogYmFzaCBtb3ZlZCB0byBhbiB1bmtub3duIGRpciBvciBmYWlsZWQgYW5kIHN0YXllZCwgYm90aFxuICAgICAgICAgIC8vIGxpdmUsIHNvIGNlcnRhaW50eSBpcyBwb2lzb25lZC5cbiAgICAgICAgICBmcmFtZS5jZXJ0YWluID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSBpZiAobG9va3NVbnJlc29sdmFibGUodGFyZ2V0KSkge1xuICAgICAgICAgIC8vIFZhcmlhYmxlL2dsb2IgdGFyZ2V0OiBiYXNoIGVpdGhlciBtb3ZlZCB0byBhbiB1bmtub3duIGRpciBvclxuICAgICAgICAgIC8vIGZhaWxlZCBhbmQgc3RheWVkIFx1MjAxNCBib3RoIGxpdmUsIHNvIGNlcnRhaW50eSBpcyBwb2lzb25lZC5cbiAgICAgICAgICBmcmFtZS5jZXJ0YWluID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZnJhbWUucHJldiA9IGZyYW1lLmRpcjtcbiAgICAgICAgICBmcmFtZS5kaXIgPSByZXNvbHZlUGF0aChmcmFtZS5kaXIsIHRhcmdldCk7XG4gICAgICAgICAgZnJhbWUuY2VydGFpbiA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoaXRlbS5leGVjID09PSAndW5rbm93bicpIHtcbiAgICAgICAgZnJhbWUuY2VydGFpbiA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgY29udGludWU7IC8vIGEgY2QgbmV2ZXIgbWF0Y2hlcyBhIHNvdXJjZS9jb25zdW1lciBpZGlvbVxuICAgIH1cblxuICAgIGlmIChpdGVtLmV4ZWMgIT09ICd5ZXMnKSB7XG4gICAgICAvLyBBIGRlYWQgb3IgdW5rbm93biBzdGFnZSBuZXZlciBydW5zIFx1MjAxNCBubyB0b3VjaCwgbm8gc2lkZSBlZmZlY3RzLlxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgaGVyZWRvY1JlZiA9IGl0ZW0udGV4dC5tYXRjaCgvXl9faGVyZWRvY18oXFxkKylfXyQvKTtcbiAgICBpZiAoaGVyZWRvY1JlZikge1xuICAgICAgLy8gVGhlIGhlcmVkb2Mtd3JpdGUgc3RhZ2UgZG9lc24ndCByZWFkIHRoZSBwaXBlIFx1MjAxNCBhbGlnbm1lbnQgc2V2ZXJzLlxuICAgICAgaWYgKHdpbmRvdyAhPT0gbnVsbCkge1xuICAgICAgICBlbWl0V2luZG93VG91Y2god2luZG93KTtcbiAgICAgICAgd2luZG93ID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHcgPSBoZXJlZG9jV3JpdGVzW051bWJlci5wYXJzZUludChoZXJlZG9jUmVmWzFdLCAxMCldO1xuICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHcudGFyZ2V0KSkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgZmlsZUFyZzogdy50YXJnZXQsXG4gICAgICAgICAgcmVhc29uOiAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InXG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICghZnJhbWUuY2VydGFpbiAmJiAhaXNBYnNvbHV0ZSh3LnRhcmdldCkpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIGZpbGVBcmc6IHcudGFyZ2V0LFxuICAgICAgICAgIHJlYXNvbjogJ3RoZSB3b3JraW5nIGRpcmVjdG9yeSBpcyB1bmNlcnRhaW4gXHUyMDE0IHRoZSByZWxhdGl2ZSBwYXRoIGNhbm5vdCBiZSByZXNvbHZlZCdcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCB3LnRhcmdldCk7XG4gICAgICBjb25zdCBib2R5TGluZXMgPSB3LmJvZHkubGVuZ3RoID09PSAwID8gMCA6IHcuYm9keS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICAgICAgaWYgKGJvZHlMaW5lcyA9PT0gMCkge1xuICAgICAgICAvLyBgY2F0ID4gZiA8PCdFT0YnYCB3aXRoIGFuIGVtcHR5IGJvZHkgdHJ1bmNhdGVzIHRoZSBmaWxlIHRvIGVtcHR5IFx1MjAxNCBhXG4gICAgICAgIC8vIHJlYWwgd3JpdGUgdGhhdCBtdXN0IHByb2R1Y2UgYSB0b3VjaCAod2hvbGUtZmlsZSwgdmlhIGBib2R5OiAnJ2ApLlxuICAgICAgICAvLyBgPj5gIHdpdGggYW4gZW1wdHkgYm9keSBhcHBlbmRzIG5vdGhpbmcgYW5kIGlzIGEgZ2VudWluZSBuby1vcC5cbiAgICAgICAgaWYgKHcucmVkaXJlY3QgIT09ICc+JykgY29udGludWU7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3BhbjogeyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IDEsIGFic29sdXRlUGF0aCwgYm9keTogJycsIHJlZGlyZWN0OiB3LnJlZGlyZWN0IH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9XG4gICAgICAgIHcucmVkaXJlY3QgPT09ICc+JyA/IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogMSwgZW5kOiBib2R5TGluZXMgfSA6IHsga2luZDogJ2FwcGVuZExpbmVzJywgY291bnQ6IGJvZHlMaW5lcyB9O1xuICAgICAgY29uc3QgcmFuZ2UgPSByZXNvbHZlU3BlYyhzcGVjLCBjYWNoZWRGc1RvdGFsTGluZXMoYWJzb2x1dGVQYXRoKSk7XG4gICAgICBpZiAocmFuZ2UgPT09IG51bGwpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIGZpbGVBcmc6IGFic29sdXRlUGF0aCxcbiAgICAgICAgICByZWFzb246ICdhcHBlbmQgdGFyZ2V0OiBjb3VsZCBub3QgcmVhZCBleGlzdGluZyBmaWxlIHRvIGZpbmQgaXRzIGN1cnJlbnQgbGVuZ3RoJ1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3BhbjogeyBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCwgbGluZUVuZDogcmFuZ2UubGluZUVuZCwgYWJzb2x1dGVQYXRoLCBib2R5OiB3LmJvZHksIHJlZGlyZWN0OiB3LnJlZGlyZWN0IH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBEaXNwYXRjaCBhcmd2IChwbGFuIFx1MDBBNzcpOiB0aGUgc3RhZ2UncyByYXcgdGV4dCBpcyBleHBhbmRlZCBiZWZvcmVcbiAgICAvLyB0b2tlbml6aW5nIFx1MjAxNCBhIHJlc29sdmVkIGBjYXQgXCIkV09SS1NQQUNFX1BBVEgvZlwiYCBuYXJyb3dzIHRocm91Z2ggYVxuICAgIC8vIHBpcGVsaW5lIGV4YWN0bHkgbGlrZSBgY2F0IGZgLiBSZWRpcmVjdHMgYXJlIHN0cmlwcGVkIGZpcnN0ICh0aGVcbiAgICAvLyByZWFkLXNpZGUgcmVjb3ZlcnksIFx1MDBBNzQpLCB0aGVuIHRoZSB0cmFuc3BhcmVudCB3cmFwcGVycyAoXHUwMEE3NSksIHRoZW4gdGhlXG4gICAgLy8gZW1pc3Npb24tc2lkZSBgIWAvYGNvbW1hbmRgL2BleGVjYCBzdHJpcCBcdTIwMTQgc28gYGNvbW1hbmQgLXAgc2VkIFx1MjAyNmAgc3RpbGxcbiAgICAvLyByZWFjaGVzIGBzZWRgLlxuICAgIGNvbnN0IHJhd0FyZ3YgPSBhcmd2T2YoZXhwYW5kVmFyaWFibGVzKGl0ZW0udGV4dCwgaXRlbS5hc3NpZ25tZW50cywgc3RhZ2VFbnYpKSA/PyBbXTtcbiAgICBjb25zdCBzdHJpcHBlZCA9IHN0cmlwRm9yRW1pc3Npb24oc3RyaXBXcmFwcGVycyhzdHJpcFJlZGlyZWN0cyhyYXdBcmd2KSkpO1xuICAgIGlmIChzdHJpcHBlZC5sZW5ndGggPT09IDApIHtcbiAgICAgIGlmICh3aW5kb3cgIT09IG51bGwpIHtcbiAgICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICAgIHdpbmRvdyA9IG51bGw7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBBIHJlc2lkdWFsIHJlZGlyZWN0IHRva2VuIChgPnxgLCBhbnl0aGluZyBlbHNlIGJlZ2lubmluZyB3aXRoIGA+YC9gPGBcbiAgICAvLyB0aGF0IHN0cmlwUmVkaXJlY3RzIGxlZnQgYWxvbmUsIFx1MDBBNzQpIGZhaWxzIGNsb3NlZDogdGhlIHN0YWdlIG1hdGNoZXNcbiAgICAvLyBub3RoaW5nIFx1MjAxNCBubyBzb3VyY2UsIG5vIHNlbGVjdG9yLCBubyB0b3VjaC5cbiAgICBpZiAoc3RyaXBwZWQuc29tZSgodykgPT4gdy5zdGFydHNXaXRoKCc+JykgfHwgdy5zdGFydHNXaXRoKCc8JykpKSB7XG4gICAgICBpZiAod2luZG93ICE9PSBudWxsKSB7XG4gICAgICAgIGVtaXRXaW5kb3dUb3VjaCh3aW5kb3cpO1xuICAgICAgICB3aW5kb3cgPSBudWxsO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gVGhlIHNvdXJjZSBvZiBhIHBpcGVsaW5lIGdyb3VwIChwbGFuIFx1MDBBNzMpOiBhIG5hcnJvd2FibGUgYGNhdGAvYG5sYCBvclxuICAgIC8vIGBnaXQgc2hvd2Agb3BlbnMgdGhlIHdpbmRvdyBhbmQgZGVmZXJzIGl0cyB3aG9sZS1maWxlIHJlYWQ7IGFcbiAgICAvLyBtdWx0aS1maWxlL3N0ZGluLW1peGVkIHNvdXJjZSBlbWl0cyBlYWNoIGZpbGUncyBjb25zZXJ2YXRpdmUgd2hvbGUtZmlsZVxuICAgIC8vIHJlYWQgYW5kIG5ldmVyIG5hcnJvd3M7IGEgc3Rkb3V0LWZvcm0gcmVkaXJlY3Qgb24gdGhlIHNvdXJjZSBlbXB0aWVzXG4gICAgLy8gdGhlIHBpcGUgXHUyMDE0IGl0cyB3aG9sZS1maWxlIHJlYWQgc3RhbmRzIGFuZCBkb3duc3RyZWFtIGNvbnN1bWVzIG5vdGhpbmcuXG4gICAgaWYgKCFwaXBlUHJlY2VkZXMgJiYgcGlwZUZvbGxvd3MgJiYgKHN0cmlwcGVkWzBdID09PSAnY2F0JyB8fCBzdHJpcHBlZFswXSA9PT0gJ25sJyB8fCBzdHJpcHBlZFswXSA9PT0gJ2dpdCcpKSB7XG4gICAgICBjb25zdCBzcmMgPSBhbmFseXplU291cmNlKHN0cmlwcGVkKTtcbiAgICAgIHN3aXRjaCAoc3JjLmtpbmQpIHtcbiAgICAgICAgY2FzZSAnbm9uZSc6XG4gICAgICAgICAgYnJlYWs7IC8vIGZhbGwgdGhyb3VnaCB0byB0aGUgb3JkaW5hcnkgZGlzcGF0Y2hcbiAgICAgICAgY2FzZSAnZ2l0VW5yZXNvbHZlZCc6XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICAgICAgICBmaWxlQXJnOiBzcmMuZmlsZUFyZyxcbiAgICAgICAgICAgIHJlYXNvbjogc3JjLnJlYXNvblxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICBjYXNlICd1bm5hcnJvd2FibGUnOiB7XG4gICAgICAgICAgZm9yIChjb25zdCBmIG9mIHNyYy5maWxlcykgZW1pdENhbmRpZGF0ZSh3aG9sZUZpbGVDYW5kaWRhdGUoZiksIGZyYW1lKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBjYXNlICduYXJyb3dhYmxlJzpcbiAgICAgICAgY2FzZSAnZ2l0Jzoge1xuICAgICAgICAgIGlmIChoYXNTdGRvdXRSZWRpcmVjdChyYXdBcmd2KSkge1xuICAgICAgICAgICAgZW1pdENhbmRpZGF0ZShzb3VyY2VDYW5kaWRhdGUoc3JjKSwgZnJhbWUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpbml0V2luZG93KHNyYywgZnJhbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEEgcGlwZSBtZW1iZXIgb2YgYSBsaXZlIHdpbmRvdyAocGxhbiBcdTAwQTczLCBjb25zdW1lcnMpOiBhIHN0ZGluXG4gICAgLy8gbGluZS1zZWxlY3RvciB0cmFuc2Zvcm1zIHRoZSB3aW5kb3cgd2hpbGUgYWxpZ25lZDsgYSBub24tY29uc3VtZXIgb3JcbiAgICAvLyB1bnJlY29nbml6ZWQgc3RhZ2Ugc2V2ZXJzIFx1MjAxNCB0aGUgdG91Y2ggaXMgdGhlIHdpbmRvdyBhdCB0aGUgc2V2ZXIgcG9pbnRcbiAgICAvLyBhbmQgbGF0ZXIgc3RhZ2VzIGFyZSBpZ25vcmVkIGZvciB3aW5kb3cgcHVycG9zZXMuIEEgc3Rkb3V0LWZvcm1cbiAgICAvLyByZWRpcmVjdCBvbiB0aGUgc3RhZ2Ugb25seSBtb3ZlcyBpdHMgb3duIG91dHB1dCBcdTIwMTQgaXQgcmVhZHMgbm9ybWFsbHksXG4gICAgLy8gdGhlbiBzZXZlcnMuXG4gICAgaWYgKHBpcGVQcmVjZWRlcyAmJiB3aW5kb3cgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IHNlbCA9IGNsYXNzaWZ5U3RkaW5TZWxlY3RvcihzdHJpcHBlZCk7XG4gICAgICBpZiAoc2VsICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChzZWwua2luZCA9PT0gJ3NlZCcgJiYgc2VsLnJhbmdlcy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgZW1pdE11bHRpUmFuZ2Uoc2VsLnJhbmdlcyk7XG4gICAgICAgICAgd2luZG93ID0gbnVsbDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhcHBseVdpbmRvd1RyYW5zZm9ybShzZWwpO1xuICAgICAgICAgIGlmIChoYXNTdGRvdXRSZWRpcmVjdChyYXdBcmd2KSkge1xuICAgICAgICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICAgICAgICB3aW5kb3cgPSBudWxsO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICAgIHdpbmRvdyA9IG51bGw7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gT3JkaW5hcnkgZGlzcGF0Y2g6IGEgY2F0L25sIHN0YWdlJ3Mgb3duIHdob2xlLWZpbGUgcmVhZCAoYSBsb25lIHN0YWdlXG4gICAgLy8gb3IgYSBub24tc291cmNlIHBpcGUgbWVtYmVyKSwgYW5kIHRoZSBsaW5lLXNlbGVjdG9yL2dpdCBpZGlvbXMuXG4gICAgaWYgKHN0cmlwcGVkWzBdID09PSAnY2F0JyB8fCBzdHJpcHBlZFswXSA9PT0gJ25sJykge1xuICAgICAgY29uc3Qgc3JjID0gYW5hbHl6ZVNvdXJjZShzdHJpcHBlZCk7XG4gICAgICBpZiAoc3JjLmtpbmQgPT09ICduYXJyb3dhYmxlJykge1xuICAgICAgICBlbWl0Q2FuZGlkYXRlKHdob2xlRmlsZUNhbmRpZGF0ZSh7IGZpbGVBcmc6IHNyYy5maWxlQXJnLCBpZGlvbTogc3JjLmlkaW9tIH0pLCBmcmFtZSk7XG4gICAgICB9IGVsc2UgaWYgKHNyYy5raW5kID09PSAndW5uYXJyb3dhYmxlJykge1xuICAgICAgICBmb3IgKGNvbnN0IGYgb2Ygc3JjLmZpbGVzKSBlbWl0Q2FuZGlkYXRlKHdob2xlRmlsZUNhbmRpZGF0ZShmKSwgZnJhbWUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgWy4uLkxJTkVfU0VMRUNUT1JTLCBtYXRjaEdpdFNob3csIG1hdGNoR2l0TG9nTF0pIHtcbiAgICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIoc3RyaXBwZWQpKSB7XG4gICAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ3VucmVzb2x2ZWQnKSB7XG4gICAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgICAgaWRpb206IG91dGNvbWUuaWRpb20sXG4gICAgICAgICAgICAgIGZpbGVBcmc6IG91dGNvbWUuZmlsZUFyZyxcbiAgICAgICAgICAgICAgcmVhc29uOiBvdXRjb21lLnJlYXNvblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgZnJhbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmICh3aW5kb3cgIT09IG51bGwpIHtcbiAgICBlbWl0V2luZG93VG91Y2god2luZG93KTtcbiAgfVxuXG4gIHJldHVybiByZXN1bHRzO1xufVxuXG4vKiogUGFyc2VzIGEgQmFzaCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGUrbGluZS1yYW5nZSBzcGFucyBpdCBzdGF0aWNhbGx5LCByZWxpYWJseSByZWFkcyBvciB3cml0ZXMuIFBhc3MgYG9wdHMuY3dkYCAoZGVmYXVsdHMgdG8gYHByb2Nlc3MuY3dkKClgKSBmb3IgY29ycmVjdCByZXNvbHV0aW9uIG9mIHJlbGF0aXZlIHBhdGhzIGFuZCBgY2RgL2BnaXQgLUNgIHRhcmdldHMsIGFuZCBvZiBgZ2l0IHNob3dgL2BnaXQgbG9nIC1MYCByZXZpc2lvbnM7IGBvcHRzLmVudmAvYG9wdHMuYWxsb3dsaXN0YCBmZWVkIHRoZSBQaGFzZSAzIGFsbG93bGlzdGVkIHZhcmlhYmxlIHJlc29sdXRpb24uICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kKGNvbW1hbmQ6IHN0cmluZywgb3B0czogUGFyc2VPcHRpb25zID0ge30pOiBSZXNvbHZlZFNwYW5bXSB7XG4gIGNvbnN0IGRldGFpbGVkID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgb3B0cyk7XG4gIGNvbnN0IHNwYW5zOiBSZXNvbHZlZFNwYW5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgZGV0YWlsZWQpIHtcbiAgICBpZiAobS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpIHNwYW5zLnB1c2gobS5zcGFuKTtcbiAgfVxuICByZXR1cm4gc3BhbnM7XG59XG4iLCAiLyoqXG4gKiBUaGUgb25seSBpbXB1cmUgYml0czogY291bnRpbmcgbGluZXMgb2YgYSB3b3JraW5nLXRyZWUgZmlsZSwgYW5kIG9mIGEgZmlsZVxuICogYXMgaXQgZXhpc3RlZCBhdCBhIGdpdmVuIGdpdCByZXZpc2lvbi4gQm90aCByZXR1cm4gbnVsbCBvbiBhbnkgZmFpbHVyZVxuICogKG1pc3NpbmcgZmlsZSwgYmFkIHJldiwgbm90IGEgZ2l0IHJlcG8sIGV0Yy4pIGluc3RlYWQgb2YgdGhyb3dpbmcgXHUyMDE0IGFcbiAqIGNvbW1hbmQgdGhhdCBzdGF0aWNhbGx5IG1hdGNoZWQgYW4gaWRpb20gYnV0IHBvaW50cyBhdCBzb21ldGhpbmcgdGhpc1xuICogbWFjaGluZSBjYW4ndCBjdXJyZW50bHkgcmVzb2x2ZSBpcyBhIG5vcm1hbCwgZXhwZWN0ZWQgb3V0Y29tZSwgbm90IGEgYnVnLlxuICovXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGEgd29ya2luZy10cmVlIGZpbGUsIG9yIG51bGwgaWYgaXQgY2FuJ3QgYmUgcmVhZC4gVHJhaWxpbmcgbmV3bGluZSBkb2VzIG5vdCBjb3VudCBhcyBhbiBleHRyYSBlbXB0eSBsaW5lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgaWYgKCFzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRmlsZSgpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgICBpZiAoY29udGVudC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBjb250ZW50LmVuZHNXaXRoKCdcXG4nKSA/IGNvbnRlbnQuc2xpY2UoMCwgLTEpIDogY29udGVudDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGBwYXRoYCBhcyBpdCBleGlzdHMgYXQgYHJldmAsIHJ1biBmcm9tIGBjd2RgLCBvciBudWxsIGlmIHRoZSByZXYvcGF0aC9yZXBvIGRvZXNuJ3QgcmVzb2x2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEdpdEJsb2JMaW5lcyhjd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzaG93JywgYCR7cmV2fToke3BhdGh9YF0sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIGlmIChvdXQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gb3V0LmVuZHNXaXRoKCdcXG4nKSA/IG91dC5zbGljZSgwLCAtMSkgOiBvdXQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICIvKipcbiAqIEhldXJpc3RpYywgZGVwZW5kZW5jeS1mcmVlIHNoZWxsIHNwbGl0dGluZy4gTm90IGEgZnVsbCBzaGVsbCBwYXJzZXIgXHUyMDE0IGdvb2RcbiAqIGVub3VnaCB0byBsb2NhdGUgc2ltcGxlIGNvbW1hbmRzIChhbmQgdGhlaXIgYXJndikgaW5zaWRlIGEgbGFyZ2VyXG4gKiAmJi98fC87L3wtam9pbmVkIEJhc2ggc3RyaW5nIHdpdGhvdXQgcHVsbGluZyBpbiBhIHJlYWwgYmFzaCBBU1QgcGFyc2VyLlxuICogVmFsaWRhdGVkIGR1cmluZyByZXNlYXJjaCBhZ2FpbnN0IGJhc2hsZXggb24gdGhlIHJlYWwgdHJhbnNjcmlwdCBjb3JwdXM7XG4gKiB0aGlzIHBvcnRzIHRoZSBzYW1lIGFsZ29yaXRobS5cbiAqL1xuXG4vKipcbiAqIFRoZSBub3JtYWxpemVkIGJvdW5kYXJ5IG9wZXJhdG9ycyBgc3BsaXRUb3BMZXZlbGAgZW1pdHMgXHUyMDE0IHRoZSBzaW5nbGVcbiAqIHJlcHJlc2VudGF0aW9uIGJvdGggYWRhcHRlcnMgY29uc3VtZS5cbiAqL1xuZXhwb3J0IHR5cGUgT3BlcmF0b3IgPSAncGlwZScgfCAnYW5kJyB8ICdvcicgfCAnc2VtaWNvbG9uJyB8ICduZXdsaW5lJyB8ICdiYWNrZ3JvdW5kJyB8ICdzdGFydCc7XG5cbi8qKiBPbmUgYHNpbXBsZSBjb21tYW5kYCBmb3VuZCBpbiBhIGxhcmdlciBzY3JpcHQsIHBsdXMgd2hpY2ggb3BlcmF0b3IgcHJlY2VkZWQgaXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFNpbXBsZUNvbW1hbmQge1xuICB0ZXh0OiBzdHJpbmc7XG4gIC8qKiBUaGUgb3BlcmF0b3IgaW1tZWRpYXRlbHkgYmVmb3JlIHRoaXMgY29tbWFuZCAoJ3BpcGUnIGZvciBhIHBpcGVsaW5lIHN0YWdlLCAnYW5kJyBmb3IgYCYmYCwgJ29yJyBmb3IgYHx8YCwgJ3NlbWljb2xvbicgZm9yIGA7YCwgJ25ld2xpbmUnIGZvciBhIG5ld2xpbmUgc2VwYXJhdG9yLCAnYmFja2dyb3VuZCcgZm9yIGAmYCwgb3IgJ3N0YXJ0JyBmb3IgdGhlIGZpcnN0IGNvbW1hbmQpLiAqL1xuICBwcmVjZWRlZEJ5OiBPcGVyYXRvcjtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyBzdGFnZSdzIHN0ZGluIGlzIGZlZCBieSBhIGA8PGAvYDw8LWAgaGVyZWRvYyBib2R5LiBUaGVcbiAgICogb3BlcmF0b3IrZGVsaW1pdGVyIGFyZSBzdHJpcHBlZCBmcm9tIGB0ZXh0YCAodGhlIHN0YWdlIGtlZXBzIGEgcGxhaW5cbiAgICogYXJndiksIHNvIGEgY29uc3VtZXIgdGhhdCBzY2FucyBmb3IgYW4gdW5xdW90ZWQgYDxgIGFzIGEgc3RkaW4gcmVkaXJlY3RcbiAgICogY2Fubm90IHNlZSB0aGUgaGVyZWRvYyBpbiB0aGUgdGV4dCBcdTIwMTQgdGhpcyBmbGFnIHN1cmZhY2VzIGl0LlxuICAgKi9cbiAgaGVyZWRvYz86IGJvb2xlYW47XG59XG5cbi8qKiBUaGUgdmVyZGljdCBraW5kcyBgc3BsaXRUb3BMZXZlbGAgY2FuIHJldHVybiB3aGVuIHRoZSBpbnB1dCBpcyBhIEJhc2ggcGFyc2UgZXJyb3IgKHBsYW4gXHUwMEE3MSkuICovXG5leHBvcnQgdHlwZSBNYWxmb3JtZWRWZXJkaWN0ID1cbiAgfCAndW5jbG9zZWQtcXVvdGUnXG4gIHwgJ3VuYmFsYW5jZWQtcGFyZW4nXG4gIHwgJ2RhbmdsaW5nLW9wZXJhdG9yJ1xuICB8ICdwaXBlLWJhbmcnXG4gIHwgJ3VudGVybWluYXRlZC1oZXJlZG9jJ1xuICB8ICd1bmNsb3NlZC1icmFjZSdcbiAgfCAndW5jbG9zZWQtY2FzZSdcbiAgfCAndW5jbG9zZWQtY29uc3RydWN0JztcblxuLyoqIFRoZSByZXN1bHQgb2YgYSB0b3AtbGV2ZWwgc3BsaXQ6IHRoZSBzdGFnZSBsaXN0LCBwbHVzIGEgYG1hbGZvcm1lZGAgdmVyZGljdCB3aGVuIHRoZSBpbnB1dCBpcyBhIEJhc2ggcGFyc2UgZXJyb3IuICovXG5leHBvcnQgaW50ZXJmYWNlIFNwbGl0UmVzdWx0IHtcbiAgc3RhZ2VzOiBTaW1wbGVDb21tYW5kW107XG4gIC8qKlxuICAgKiBTZXQgd2hlbiB0aGUgaW5wdXQgaXMgYSBCYXNoIHBhcnNlIGVycm9yIFx1MjAxNCBiYXNoIHJlamVjdHMgdGhlIGVudGlyZSBsaXN0IGF0XG4gICAqIHBhcnNlIHRpbWUgKGV4aXQgMiwgbm90aGluZyBleGVjdXRlZCksIHNvIGFueSBzdGFnZS1kZXJpdmVkIHRvdWNoIHdvdWxkIGJlXG4gICAqIGEgcGhhbnRvbS4gVGhlIHJlamVjdGlvbiBpcyBsaXN0LXNjb3BlZCBhbmQgdGVybWluYWwgKHBsYW4gXHUwMEE3MSk6IHRoZSBzdGFnZVxuICAgKiBsaXN0IGtlZXBzIGV2ZXJ5IHN0YWdlIGZyb20gY29tcGxldGVkIGVhcmxpZXIgbGlzdHMsIGRyb3BzIHRoZSByZWplY3RpbmdcbiAgICogbGlzdCdzIG93biBzdGFnZXMsIGFuZCBzdG9wcyBhdCBpdCBcdTIwMTQgZXZlcnkgbGF0ZXIgdW5pdCBpcyBkZWFkLlxuICAgKi9cbiAgbWFsZm9ybWVkPzogTWFsZm9ybWVkVmVyZGljdDtcbn1cblxuLyoqIFRoZSBjb25zdHJ1Y3Qga2luZHMgdGhlIGtpbmQtbWF0Y2hlZCBzdGFjayB0cmFja3MgKHBsYW4gXHUwMEE3MykuICovXG50eXBlIENvbnN0cnVjdEtpbmQgPSAnaWYnIHwgJ2xvb3AnIHwgJ2ZvcicgfCAnc2VsZWN0JyB8ICdicmFjZSc7XG5cbi8qKiBPbmUgb3BlbiBjb25zdHJ1Y3Q6IGl0cyBraW5kLCBhbmQgd2hldGhlciBhIGJvZHkgd29yZCBoYXMgYmVlbiBzZWVuLiAqL1xuaW50ZXJmYWNlIE9wZW5Db25zdHJ1Y3Qge1xuICBraW5kOiBDb25zdHJ1Y3RLaW5kO1xuICAvKipcbiAgICogV2hldGhlciBhIGJvZHkgaGFzIHN0YXJ0ZWQuIEZvciBgaWZgIHRoZSBib2R5IHN0YXJ0cyBhdCBgdGhlbmAvYGVsc2VgL1xuICAgKiBgZWxpZmAsIGZvciBsb29wcyBhdCBgZG9gLCBmb3IgYnJhY2UgZ3JvdXBzIGF0IGFueSBjb21tYW5kIHdvcmQgXHUyMDE0IGFcbiAgICogY2xvc2VyIHdpdGggbm8gYm9keSAoYGlmIHg7IGZpYCwgYHsgfWApIGlzIGEgQmFzaCBwYXJzZSBlcnJvci5cbiAgICovXG4gIGJvZHk6IGJvb2xlYW47XG59XG5cbi8qKiBUaGUgY2FzZSByZWdpb24ncyBwb3NpdGlvbiBzdGF0ZSAocGxhbiBcdTAwQTczKS4gKi9cbnR5cGUgQ2FzZVBvcyA9ICdzdWJqZWN0JyB8ICdwYXR0ZXJuLXN0YXJ0JyB8ICdwYXR0ZXJuJyB8ICdjb21tYW5kJztcblxuLyoqIEFuIG9wZW4gY2FzZSByZWdpb246IG9wYXF1ZSBjb250ZW50IG93bmVkIGJ5IHRoZSBjYXNlIHNjYW4uICovXG5pbnRlcmZhY2UgQ2FzZVJlZ2lvbiB7XG4gIHBvczogQ2FzZVBvcztcbiAgLyoqIEluIGEgYGNvbW1hbmRgIHBvc2l0aW9uOiB3aGV0aGVyIHRoZSBjdXJyZW50IGxpc3QgaXRlbSBpcyBzdGlsbCBlbXB0eSAob25seSBgKWAsIGA7YCwgYCZgLCBhbmQgbmV3bGluZXMgcmVzZXQgaXQpLiAqL1xuICBjbWRFbXB0eTogYm9vbGVhbjtcbiAgLyoqIFRoZSByZWdpb24ncyBvd24gcGFyZW4gZGVwdGggXHUyMDE0IGdsb2JhbCBwYXJlbiBkZXB0aCBpcyBmcm96ZW4gd2hpbGUgdGhlIHJlZ2lvbiBpcyBvcGVuICh0aGUgcmVnaW9uIGlzIG5vdCBhIHN0YWNrOyBpdCBvdXRsaXZlcyBwYXJlbiBjbG9zZXMpLiAqL1xuICBsb2NhbERlcHRoOiBudW1iZXI7XG59XG5cbi8qKiBBIHBlbmRpbmcgaGVyZWRvYyB3aG9zZSBib2R5IGhhcyBub3Qgc3RhcnRlZCB5ZXQgKG9yIHdob3NlIGJvZHkgaXMgYmVpbmcgc2Nhbm5lZCkuICovXG5pbnRlcmZhY2UgUGVuZGluZ0hlcmVkb2Mge1xuICAvKiogVGhlIGxpbmUgdGhhdCBjbG9zZXMgdGhlIGJvZHk6IHRoZSBkZWxpbWl0ZXIsIG9wdGlvbmFsbHkgYFxcdGAtcHJlZml4ZWQgZm9yIGA8PC1gLCB3aXRoIG9wdGlvbmFsIHRyYWlsaW5nIHdoaXRlc3BhY2UuICovXG4gIGNsb3NlOiBSZWdFeHA7XG59XG5cbi8qKiBUaGUgd29yZHMgdGhhdCBwdXQgdGhlIHBhcnNlciBiYWNrIGF0IGNvbW1hbmQgc3RhcnQgd2hlbiB0aGV5IGFyZSB0aGUgYnVmZmVyJ3MgbGFzdCB3b3JkIChwbGFuIFx1MDBBNzMpLiAqL1xuY29uc3QgQ09NTUFORF9PUEVORVJfV09SRFMgPSBuZXcgU2V0KFsnZG8nLCAndGhlbicsICdlbHNlJywgJ2VsaWYnLCAnaWYnLCAnd2hpbGUnLCAndW50aWwnLCAnIScsICd0aW1lJywgJ3snLCAnKCddKTtcblxuLyoqIFdvcmQgY2hhcnMgZW5kIGF0IHdoaXRlc3BhY2UgYW5kIHRoZSBvcGVyYXRvci9wYXJlbi9yZWRpcmVjdCBtZXRhY2hhcnMuICovXG5jb25zdCBXT1JEX0VORCA9IC9bXFxzOyZ8KCk8Pl0vO1xuXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHMucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbn1cblxuLyoqXG4gKiBTcGxpdCBhIGNvbW1hbmQgc3RyaW5nIGludG8gc2ltcGxlLWNvbW1hbmQgc3Vic3RyaW5ncyBhdCB0b3AtbGV2ZWwgJiYsIHx8LFxuICogOywgfCwgfCYsICYsIGFuZCBuZXdsaW5lIGJvdW5kYXJpZXMuIFF1b3RlcyBhbmQgJCgpL2BgLygpIG5lc3RpbmcgYXJlXG4gKiByZXNwZWN0ZWQgKG5vdCBzcGxpdCBpbnNpZGUpOyBgI2AgY29tbWVudHMgYW5kIGAke1x1MjAyNn1gIGJyYWNlIGNvbnRlbnQgYXJlXG4gKiBvcGFxdWUsIHBpcGUvYW5kL29yIG5ld2xpbmVzIGFyZSBsaW5lIGNvbnRpbnVhdGlvbnMsIGFuZCBCYXNoIHBhcnNlIGVycm9yc1xuICogKHBsYW4gXHUwMEE3MSkgY29tZSBiYWNrIGFzIGEgYG1hbGZvcm1lZGAgdmVyZGljdCB3aXRoIHRoZSBzdGFnZSBsaXN0IHRydW5jYXRlZFxuICogYXQgdGhlIHJlamVjdGluZyBsaXN0LlxuICpcbiAqIFBoYXNlIDIgKHBsYW4gXHUwMEE3MykgYWRkcyB0aHJlZSBtYWNoaW5lczpcbiAqXG4gKiAtIFRoZSBraW5kLW1hdGNoZWQgY29uc3RydWN0IHN0YWNrOiBgaWZgL2B3aGlsZWAvYHVudGlsYC9gZm9yYC9gc2VsZWN0YC9cbiAqICAgYHtgL2B9YC9gZnVuY3Rpb25gIG9wZW4gY29uc3RydWN0IGZyYW1lcyBhdCBjb21tYW5kIHBvc2l0aW9uLCBjb250ZXh0XG4gKiAgIGtleXdvcmRzIChgZG9gLCBgdGhlbmAsIGBlbHNlYCwgYGVsaWZgLCBgaW5gKSBhbmQgY2xvc2VycyAoYGZpYCwgYGRvbmVgLFxuICogICBgZXNhY2AsIGB9YCkgcmVxdWlyZSBhIG1hdGNoaW5nIG9wZW5lciBvbiB0b3Agb2YgdGhlIHN0YWNrICh3aXRoIHRoZVxuICogICByaWdodCBib2R5IHN0YXRlKSwgYW5kIHdoaWxlIGEgY29uc3RydWN0IGlzIG9wZW4gYXQgZGVwdGggMCB0aGUgYm91bmRhcnlcbiAqICAgb3BlcmF0b3JzIGFyZSB0ZXh0IFx1MjAxNCB0aGUgY29uc3RydWN0IGZvbGRzIHRvIG9uZSBzdGFnZS4gRWFjaCBgKGAgcHVzaGVzIGFcbiAqICAgZnJlc2ggc3RhY2sgYW5kIGVhY2ggYClgIGZpcmVzICd1bmNsb3NlZC1jb25zdHJ1Y3QnIHdoZW4gaXRzIGxldmVsIGlzXG4gKiAgIG5vbi1lbXB0eSAoZmlyZS1iZWZvcmUtcmVzdG9yZSkuXG4gKlxuICogLSBUaGUgY2FzZS1yZWdpb24gbWFjaGluZTogYGNhc2VgIGluIGNvbW1hbmQgcG9zaXRpb24gb3BlbnMgYSByZWdpb24gY2xvc2VkXG4gKiAgIGJ5IGEgbWF0Y2hpbmcgYGVzYWNgLiBUaGUgcmVnaW9uJ3MgY29udGVudCBpcyBvcGFxdWUgXHUyMDE0IHBhdHRlcm4gYClgcyBhbmRcbiAqICAgYHxgcyBhcmUgcGF0dGVybiBzeW50YXgsIG5vdCBwYXJlbnMvcGlwZXMgXHUyMDE0IHdpdGggaXRzIG93biBwYXJlbiBkZXB0aFxuICogICAodGhlIGdsb2JhbCBkZXB0aCBmcmVlemVzIHdoaWxlIG9wZW4pLCBgOztgL2A7JmAvYDs7JmAgcmV0dXJuaW5nIHRvXG4gKiAgIHBhdHRlcm4tc3RhcnQgYW5kIGApYCwgYDtgLCBgJmAsIGFuZCBuZXdsaW5lcyB0byBjb21tYW5kIHN0YXJ0LiBBIHJlZ2lvblxuICogICBvcGVuIGF0IEVPRiBpcyAndW5jbG9zZWQtY2FzZScuXG4gKlxuICogLSBUaGUgaGVyZWRvYyBtYWNoaW5lcnk6IGA8PGAvYDw8LWAgYXQgZGVwdGggMCB3aXRoIGEgZGVsaW1pdGVyIHdvcmQgc3RyaXBzXG4gKiAgIHRoZSBvcGVyYXRvcitkZWxpbWl0ZXIgZnJvbSB0aGUgc3RhZ2UgdGV4dCAodGhlIHN0YWdlIGtlZXBzIGEgcGxhaW4gYXJndilcbiAqICAgYW5kIHNjYW5zIGJvZHkgbGluZXMgcmF3IHVudGlsIHRoZSBkZWxpbWl0ZXIgbGluZTsgYW4gdW50ZXJtaW5hdGVkXG4gKiAgIGhlcmVkb2MgaXMgdGhlICd1bnRlcm1pbmF0ZWQtaGVyZWRvYycgcGFydGlhbCBcdTIwMTQgdGhlIGRlbGltaXRlcidzIGxpbmUgKGFuZFxuICogICBldmVyeXRoaW5nIGJlZm9yZSBpdCkgYW5hbHl6ZXMgbm9ybWFsbHkgYW5kIHRoZSBib2R5IHByb2R1Y2VzIG5vIHN0YWdlcy5cbiAqICAgVGhlIHN0cmlwcGVkIHN0YWdlIGNhcnJpZXMgdGhlIGBoZXJlZG9jYCBmbGFnIHNvIGNvbnN1bWVycyBjYW4gc2VlIHRoYXRcbiAqICAgaXRzIHN0ZGluIGlzIHRoZSBib2R5LCBub3QgYSBwaXBlIG9yIGEgZmlsZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNwbGl0VG9wTGV2ZWwoY21kOiBzdHJpbmcpOiBTcGxpdFJlc3VsdCB7XG4gIGNvbnN0IHBhcnRzOiBTaW1wbGVDb21tYW5kW10gPSBbXTtcbiAgbGV0IGJ1ZiA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBjbWQubGVuZ3RoO1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgYnJhY2VEZXB0aCA9IDA7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgbGV0IHBlbmRpbmdPcDogT3BlcmF0b3IgPSAnc3RhcnQnO1xuICAvKiogU2V0IHdoZW4gdGhlIGN1cnJlbnQgbGlzdCBpcyBhIEJhc2ggcGFyc2UgZXJyb3I7IHRoZSBzY2FuIHN0b3BzIGF0IGl0IChwbGFuIFx1MDBBNzEsIGxpc3Qtc2NvcGUgKyB0ZXJtaW5hbCkuICovXG4gIGxldCBtYWxmb3JtZWQ6IE1hbGZvcm1lZFZlcmRpY3QgfCB1bmRlZmluZWQ7XG4gIC8qKiBJbmRleCBpbnRvIGBwYXJ0c2Agd2hlcmUgdGhlIGN1cnJlbnQgbGlzdCBiZWdhbiBcdTIwMTQgdGhlIHJlamVjdGluZyBsaXN0J3Mgc3RhZ2VzIGFyZSBkcm9wcGVkIGJ5IHJvbGxpbmcgYmFjayB0byBpdC4gKi9cbiAgbGV0IGxpc3RTdGFydCA9IDA7XG5cbiAgLyoqIFJlcG9ydCBhIG1hbGZvcm1lZCBsaXN0OiBkcm9wIGl0cyBzdGFnZXMgKGNvbXBsZXRlZCBlYXJsaWVyIGxpc3RzIHN0YXkpLCBhbmQgc3RvcCB0aGUgc2NhbiBcdTIwMTQgYmFzaCBhYm9ydHMgYXQgdGhlIGZpcnN0IHBhcnNlIGVycm9yLiAqL1xuICBjb25zdCByZWplY3QgPSAodjogTWFsZm9ybWVkVmVyZGljdCkgPT4ge1xuICAgIG1hbGZvcm1lZCA9IHY7XG4gICAgcGFydHMubGVuZ3RoID0gbGlzdFN0YXJ0O1xuICAgIGkgPSBuO1xuICB9O1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgcGlwZS9hbmQvb3Igb3BlcmF0b3IgaXMgcGVuZGluZyB3aXRoIGEgd2hpdGVzcGFjZS1vbmx5IGJ1ZmZlclxuICAgKiBzaW5jZSBpdC4gQSBoZWxwZXIgcmF0aGVyIHRoYW4gYW4gaW5saW5lIGNvbXBhcmlzb246IFR5cGVTY3JpcHQnc1xuICAgKiBjb250cm9sLWZsb3cgbmFycm93aW5nIGNhbm5vdCBzZWUgdGhlIGFzc2lnbm1lbnRzIGBmbHVzaGAgbWFrZXMgdG9cbiAgICogYHBlbmRpbmdPcGAgZnJvbSBpbnNpZGUgaXRzIGNsb3N1cmUsIGFuZCB3b3VsZCBvdGhlcndpc2UgbmFycm93IHRoZVxuICAgKiBkaXJlY3QgY29tcGFyaXNvbiB0byB0aGUgaW5pdGlhbGl6ZXIgYCdzdGFydCdgLlxuICAgKi9cbiAgY29uc3QgaXNVbmNvbnN1bWVkT3BlcmF0b3IgPSAoKTogYm9vbGVhbiA9PlxuICAgIChwZW5kaW5nT3AgPT09ICdwaXBlJyB8fCBwZW5kaW5nT3AgPT09ICdhbmQnIHx8IHBlbmRpbmdPcCA9PT0gJ29yJykgJiYgYnVmLnRyaW0oKSA9PT0gJyc7XG5cbiAgLyoqIFRoZSBidWZmZXIncyBsYXN0IHdoaXRlc3BhY2UtZGVsaW1pdGVkIHdvcmQgKCcnIHdoZW4gdGhlIGJ1ZmZlciBpcyBlbXB0eSkuICovXG4gIGNvbnN0IGxhc3RXb3JkID0gKCk6IHN0cmluZyA9PiBidWYudHJpbUVuZCgpLm1hdGNoKC9cXFMrJC8pPy5bMF0gPz8gJyc7XG5cbiAgLyoqXG4gICAqIFJlZGlyZWN0IG9wZXJhdG9ycyB0aGF0IGFyZSBtaXNzaW5nIHRoZWlyIHRhcmdldCB3b3JkIHdoZW4gdGhleSBhcmUgdGhlXG4gICAqIGJ1ZmZlcidzIGxhc3Qgd29yZCAocGxhbiBcdTAwQTcxKTogYSB0YXJnZXQgbXVzdCBiZSBhIHBsYWluIHdvcmQsIHNvIGV2ZXJ5XG4gICAqIG5vbi1zZWxmLWNvbXBsZXRlIGZvcm0gaXMgYSBwYXJzZSBlcnJvci4gRHVwIGZvcm1zIHdpdGggYm90aCBmZHMgcHJlc2VudFxuICAgKiAoYDI+JjFgLCBgPiYtYCwgYDM8JjBgKSBhbmQgZnVzZWQgd29yZHMgKGA+b3V0YCwgYDI+ZXJyYCwgYDw8RU9GYCxcbiAgICogYCY+b3V0YCkgYXJlIGNvbXBsZXRlIGFuZCBuZXZlciBtYXRjaC5cbiAgICovXG4gIGNvbnN0IERBTkdMSU5HX1JFRElSRUNUX1dPUkQgPSAvXig/Oj58Pj58Jj58Jj4+fD5cXHx8PHw8Pnw8PHw8PC18PDw8fD4mfFxcZCsoPzo+fD4+fD5cXHx8PHw8Pnw8PHw8PC18PDw8fD4mfDwmKSkkLztcblxuICBjb25zdCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCA9ICgpOiBib29sZWFuID0+IERBTkdMSU5HX1JFRElSRUNUX1dPUkQudGVzdChsYXN0V29yZCgpKTtcblxuICAvKiogV2hldGhlciB0aGUgY3VycmVudCBjaGFyIHN0YXJ0cyBhIG5ldyB3b3JkIGluIHRoZSBidWZmZXIgKGVtcHR5IGJ1ZmZlciwgb3IgcHJlY2VkZWQgYnkgd2hpdGVzcGFjZSkuICovXG4gIGNvbnN0IGlzV29yZFN0YXJ0ID0gKCk6IGJvb2xlYW4gPT4gYnVmID09PSAnJyB8fCAvXFxzJC8udGVzdChidWYpO1xuXG4gIC8qKiBXaGV0aGVyIGEgcmVkaXJlY3QgdG9rZW4gYmVnaW5zIGF0IGBpYDogYSBgPmAvYDxgIGZvcm0sIGAmPmAsIG9yIGEgZGlnaXQtcHJlZml4ZWQgZm9ybSBsaWtlIGAyPmAvYDI+JjFgLiAqL1xuICBjb25zdCBzdGFydHNSZWRpcmVjdEF0ID0gKGk6IG51bWJlcik6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IGMgPSBjbWRbaV07XG4gICAgaWYgKGMgPT09ICc+JyB8fCBjID09PSAnPCcpIHJldHVybiB0cnVlO1xuICAgIGlmIChjID09PSAnJicpIHJldHVybiBjbWRbaSArIDFdID09PSAnPic7XG4gICAgaWYgKGMgPj0gJzAnICYmIGMgPD0gJzknKSB7XG4gICAgICBsZXQgaiA9IGk7XG4gICAgICB3aGlsZSAoaiA8IG4gJiYgY21kW2pdID49ICcwJyAmJiBjbWRbal0gPD0gJzknKSBqICs9IDE7XG4gICAgICByZXR1cm4gY21kW2pdID09PSAnPicgfHwgY21kW2pdID09PSAnPCc7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfTtcblxuICAvKipcbiAgICogV2hldGhlciBhIG5ldyBjb21tYW5kIGNhbiBzdGFydCBoZXJlOiB0aGUgYnVmZmVyIGlzIGVtcHR5LCBhIGJvdW5kYXJ5XG4gICAqIG9wZXJhdG9yIG9yIGAoYC9gKWAgcHJlY2VkZXMsIHRoZSBidWZmZXIgZW5kcyB3aXRoIGEgbmV3bGluZSAoYSBuZXdsaW5lXG4gICAqIGluc2lkZSBhbiBvcGVuIGNvbnN0cnVjdCBpcyB0ZXh0IGJ1dCBzdGlsbCBlbmRzIHRoZSBsaXN0IGl0ZW0pLCBvciB0aGVcbiAgICogbGFzdCB3b3JkIGV4cGVjdHMgYSBjb21tYW5kIGJvZHkgKGB0aGVuYCwgYGRvYCwgYHtgLCBcdTIwMjYpLlxuICAgKi9cbiAgY29uc3QgaXNDb21tYW5kUG9zaXRpb24gPSAoKTogYm9vbGVhbiA9PlxuICAgIGJ1Zi50cmltKCkgPT09ICcnIHx8IC9cXG4kLy50ZXN0KGJ1ZikgfHwgL1s7JnwoKV0kLy50ZXN0KGJ1Zi50cmltRW5kKCkpIHx8IENPTU1BTkRfT1BFTkVSX1dPUkRTLmhhcyhsYXN0V29yZCgpKTtcblxuICBjb25zdCBmbHVzaCA9IChuZXh0T3A6IE9wZXJhdG9yKSA9PiB7XG4gICAgY29uc3QgcyA9IGJ1Zi50cmltKCk7XG4gICAgaWYgKHMpIHtcbiAgICAgIC8vIGAhYCBpbiBwaXBlIHBvc2l0aW9uIGlzIGEgcGFyc2UgZXJyb3IgKHBsYW4gXHUwMEE3MSk6IHRoZSBmaXJzdCB3b3JkIG9mIGFcbiAgICAgIC8vIHBpcGUtcHJlY2VkZWQgc3RhZ2UgbWF5IG5vdCBiZSBgIWAgKGBmYWxzZSB8ICEgdHJ1ZWAsIGBjYXQgZiB8XFxuISB0cnVlYCkuXG4gICAgICBpZiAocGVuZGluZ09wID09PSAncGlwZScgJiYgKHMgPT09ICchJyB8fCAvXiFcXHMvLnRlc3QocykpKSB7XG4gICAgICAgIHJlamVjdCgncGlwZS1iYW5nJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHBhcnRzLnB1c2goeyB0ZXh0OiBzLCBwcmVjZWRlZEJ5OiBwZW5kaW5nT3AsIC4uLihidWZIZXJlZG9jID8geyBoZXJlZG9jOiB0cnVlIH0gOiB7fSkgfSk7XG4gICAgfVxuICAgIGJ1ZiA9ICcnO1xuICAgIGJ1ZkhlcmVkb2MgPSBmYWxzZTtcbiAgICBwZW5kaW5nT3AgPSBuZXh0T3A7XG4gIH07XG5cbiAgLy8gVGhlIGtpbmQtbWF0Y2hlZCBjb25zdHJ1Y3Qgc3RhY2ssIG9uZSBsaXN0IHBlciBwYXJlbiBsZXZlbDogYChgIHB1c2hlcyBhXG4gIC8vIGZyZXNoIGxldmVsLCBgKWAgcG9wcyBpdCBhbmQgZmlyZXMgd2hlbiBpdCBpcyBub24tZW1wdHkgXHUyMDE0IGFuIHVuY2xvc2VkXG4gIC8vIGNvbnN0cnVjdCBjYW5ub3Qgb3V0bGl2ZSB0aGUgc3Vic2hlbGwgdGhhdCBjbG9zZWQgKHBsYW4gXHUwMEE3MykuXG4gIGNvbnN0IGxldmVsczogT3BlbkNvbnN0cnVjdFtdW10gPSBbW11dO1xuICBjb25zdCB0b3AgPSAoKTogT3BlbkNvbnN0cnVjdCB8IHVuZGVmaW5lZCA9PiB7XG4gICAgY29uc3QgbHYgPSBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdO1xuICAgIHJldHVybiBsdi5sZW5ndGggPiAwID8gbHZbbHYubGVuZ3RoIC0gMV0gOiB1bmRlZmluZWQ7XG4gIH07XG4gIC8qKiBTZXQgYnkgb3BlbmVycyBhbmQgYm9keSBrZXl3b3JkcywgY2xlYXJlZCBieSBvdGhlciB3b3JkcyBhbmQgYChgIFx1MjAxNCBhbiBvcGVyYXRvciBvciBjbG9zZXIgZGlyZWN0bHkgYWZ0ZXIgaXQgaXMgYW4gZW1wdHktbGlzdCBwYXJzZSBlcnJvciAoYGlmIHRydWU7IHRoZW47IGZpYCwgYHsgOyB9YCkuICovXG4gIGxldCBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgLyoqIGBmdW5jdGlvbmAgc2VlbjsgdGhlIG5leHQgd29yZCBpcyB0aGUgZnVuY3Rpb24gbmFtZSwgYW5kIGB7YCByaWdodCBhZnRlciBpdCBvcGVucyB0aGUgZGVmaW5pdGlvbiBib2R5LiAqL1xuICBsZXQgZnVuY3Rpb25TZWVuID0gZmFsc2U7XG4gIGxldCBuYW1lU2VlbiA9IGZhbHNlO1xuXG4gIC8vIFRoZSBvcGVuIGNhc2UgcmVnaW9uLCBpZiBhbnkgKHBsYW4gXHUwMEE3MykuIFdoaWxlIG9wZW4sIGl0cyBjb250ZW50IGlzIG9wYXF1ZVxuICAvLyB0byBldmVyeSBvdGhlciBtYWNoaW5lOiB0aGUgZ2xvYmFsIHBhcmVuIGRlcHRoIGlzIGZyb3plbiwgdGhlIGNvbnN0cnVjdFxuICAvLyBzdGFjayBpcyB1bnRvdWNoZWQsIGFuZCBib3VuZGFyeSBvcGVyYXRvcnMgYXJlIHRleHQuXG4gIGxldCBjYXNlUmVnaW9uOiBDYXNlUmVnaW9uIHwgbnVsbCA9IG51bGw7XG5cbiAgLy8gUGVuZGluZyBoZXJlZG9jcyAocGxhbiBcdTAwQTczKTogYDw8YC9gPDwtYCBhdCBkZXB0aCAwIHdpdGggYSBkZWxpbWl0ZXIgd29yZC5cbiAgY29uc3QgaGVyZWRvY3M6IFBlbmRpbmdIZXJlZG9jW10gPSBbXTtcbiAgLyoqIEluIHRoZSBib2R5IG9mIGEgcGVuZGluZyBoZXJlZG9jIFx1MjAxNCBsaW5lcyBhcmUgc2Nhbm5lZCByYXcgZm9yIHRoZSBjbG9zZSBsaW5lLiAqL1xuICBsZXQgaW5Cb2R5ID0gZmFsc2U7XG4gIC8qKiBXaGV0aGVyIHRoZSBzdGFnZSBjdXJyZW50bHkgaW4gdGhlIGJ1ZmZlciBmZWVkcyBpdHMgc3RkaW4gZnJvbSBhIGhlcmVkb2MgYm9keSAoc3VyZmFjZWQgb24gdGhlIGZsdXNoZWQgU2ltcGxlQ29tbWFuZCkuICovXG4gIGxldCBidWZIZXJlZG9jID0gZmFsc2U7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IGNtZFtpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgICBidWYgKz0gY21kW2kgKyAxXTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSBpbkRxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGluRHF1b3RlID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBidWYgKz0gYyArIGNtZFtpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gYCR7XHUyMDI2fWAgY29udGVudCBpcyBvcGFxdWUgKHBsYW4gXHUwMEE3MSk6IG5lc3RlZCBleHBhbnNpb25zIG5lc3QsIGFuZCB3aGlsZVxuICAgIC8vIHRoZSBicmFjZSBkZXB0aCBpcyBwb3NpdGl2ZSBub3RoaW5nIGluc2lkZSBjb3VudHMgcGFyZW5zLCBzcGxpdHNcbiAgICAvLyBvcGVyYXRvcnMsIHN0YXJ0cyBjb21tZW50cywgb3IgcmVjb2duaXplcyBjb25zdHJ1Y3RzIFx1MjAxNCBgJHt4JSl9YCxcbiAgICAvLyBgJHt4Ly8oL31gLCBhbmQgYCR7eDotJChlY2hvIHkpfWAgYXJlIGFsbCB2YWxpZC5cbiAgICBpZiAoYnJhY2VEZXB0aCA+IDApIHtcbiAgICAgIGlmIChjID09PSAnfScpIGJyYWNlRGVwdGggLT0gMTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIEhlcmVkb2MgYm9keSBtb2RlOiBzY2FuIGxpbmVzIHJhdyB1bnRpbCB0aGUgZmlyc3QgcGVuZGluZyBoZXJlZG9jJ3NcbiAgICAvLyBjbG9zZSBsaW5lIChhIGxpbmUgdGhhdCBpcyBleGFjdGx5IHRoZSBkZWxpbWl0ZXIsIG9wdGlvbmFsbHkgdGFiLVxuICAgIC8vIHByZWZpeGVkIGZvciBgPDwtYCwgd2l0aCBvcHRpb25hbCB0cmFpbGluZyB3aGl0ZXNwYWNlKS4gVGhlIGJvZHkgaXNcbiAgICAvLyBvcGFxdWUgXHUyMDE0IGl0IHByb2R1Y2VzIG5vIHN0YWdlcyBcdTIwMTQgYW5kIHVudGVybWluYXRlZCBib2RpZXMgZW5kIGF0IEVPRi5cbiAgICBpZiAoaW5Cb2R5KSB7XG4gICAgICBjb25zdCBsaW5lRW5kID0gY21kLmluZGV4T2YoJ1xcbicsIGkpO1xuICAgICAgY29uc3QgbGluZSA9IGxpbmVFbmQgPT09IC0xID8gY21kLnNsaWNlKGkpIDogY21kLnNsaWNlKGksIGxpbmVFbmQpO1xuICAgICAgaWYgKGhlcmVkb2NzWzBdLmNsb3NlLnRlc3QobGluZSkpIHtcbiAgICAgICAgaGVyZWRvY3Muc2hpZnQoKTtcbiAgICAgICAgaWYgKGhlcmVkb2NzLmxlbmd0aCA9PT0gMCkgaW5Cb2R5ID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAobGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPiAwIHx8IGNhc2VSZWdpb24gIT09IG51bGwpIHtcbiAgICAgICAgLy8gSW5zaWRlIGFuIG9wZW4gY29uc3RydWN0IHRoZSBib2R5IGxpbmUgZm9sZHMgaW50byB0aGUgY29uc3RydWN0J3NcbiAgICAgICAgLy8gaW50ZXJpb3IgdGV4dCAoYSBuZXdsaW5lIGluc2lkZSBhbiBvcGVuIGNvbnN0cnVjdCBpcyBub3QgYVxuICAgICAgICAvLyBib3VuZGFyeSwgcGxhbiBcdTAwQTcxKSBcdTIwMTQgdGhlIGludGVyaW9yIHJlLXNwbGl0IHJlLXNjYW5zIGl0IGFzIGJvZHkuXG4gICAgICAgIGJ1ZiArPSBsaW5lO1xuICAgICAgICBpZiAobGluZUVuZCAhPT0gLTEpIGJ1ZiArPSAnXFxuJztcbiAgICAgIH1cbiAgICAgIGkgPSBsaW5lRW5kID09PSAtMSA/IG4gOiBsaW5lRW5kICsgMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUaGUgbmV3bGluZSByaWdodCBhZnRlciBhIGhlcmVkb2MncyBkZWxpbWl0ZXIgbGluZSBlbmRzIHRoZSBkZWxpbWl0ZXInc1xuICAgIC8vIGxpbmUgXHUyMDE0IGl0IHNwbGl0cyBub3JtYWxseSAoYSBjb21wbGV0ZWQgbGlzdCwgYnV0IHdpdGhvdXQgYWR2YW5jaW5nXG4gICAgLy8gYGxpc3RTdGFydGA6IGEgY29tcGxldGVuZXNzIHZpb2xhdGlvbiB0aGF0IHJlamVjdHMgbGF0ZXIgZHJvcHMgdGhlXG4gICAgLy8gZGVsaW1pdGVyJ3MtbGluZSBzdGFnZSB0b28pIFx1MjAxNCBhbmQgc3RhcnRzIHRoZSBib2R5LiBJbnNpZGUgYW4gb3BlblxuICAgIC8vIGNvbnN0cnVjdCB0aGUgbmV3bGluZSBpcyBub3QgYSBib3VuZGFyeTogdGhlIGRlbGltaXRlcidzIGxpbmUsIHRoZVxuICAgIC8vIGJvZHksIGFuZCB0aGUgY2xvc2UgbGluZSBhbGwgZm9sZCBpbnRvIHRoZSBjb25zdHJ1Y3QncyBvbmUgc3RhZ2UsIGFuZFxuICAgIC8vIHRoZSB3YWxrJ3MgaW50ZXJpb3IgcmUtc3BsaXQgYXBwbGllcyB0aGUgc2FtZSBoZXJlZG9jIG1hY2hpbmVyeSB0aGVyZS5cbiAgICBpZiAoYyA9PT0gJ1xcbicgJiYgaGVyZWRvY3MubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCB8fCBjYXNlUmVnaW9uICE9PSBudWxsKSB7XG4gICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICBpbkJvZHkgPSB0cnVlO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgZmx1c2goJ25ld2xpbmUnKTtcbiAgICAgIGluQm9keSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gYCNgIGJlZ2lucyBhIGNvbW1lbnQgd2hlbiBpdCBzdGFydHMgYSB3b3JkIGF0IGRlcHRoIDAgKGVtcHR5IGJ1ZmZlciBvclxuICAgIC8vIHByZWNlZGVkIGJ5IHdoaXRlc3BhY2UpOyBjb21tZW50cyBydW4gdG8gdGhlIG5ld2xpbmUsIGtlZXBpbmcgdGhlIGJ1ZmZlclxuICAgIC8vIGVtcHR5IGZvciB0aGUgY29udGludWF0aW9uIHJ1bGUuIE1pZC13b3JkIGFuZCBxdW90ZWQgYCNgIGFyZSB0ZXh0LCBhbmRcbiAgICAvLyBjb21tZW50cyBpbnNpZGUgcGFyZW5zIGFyZSBvcGFxdWUgbGlrZSBldmVyeXRoaW5nIGVsc2UgdGhlcmUgKHBsYW4gXHUwMEE3MSkuXG4gICAgaWYgKGMgPT09ICcjJyAmJiBkZXB0aCA9PT0gMCAmJiBpc1dvcmRTdGFydCgpKSB7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgY21kW2ldICE9PSAnXFxuJykgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFRoZSBjYXNlLXJlZ2lvbiBzY2FuIG93bnMgZXZlcnl0aGluZyBhdCBpdHMgbG9jYWwgZGVwdGggMCBcdTIwMTQgcGF0dGVyblxuICAgIC8vIHN5bnRheCwgbGlzdCB0ZXJtaW5hdG9ycywgYW5kIHdvcmRzIFx1MjAxNCB3aGlsZSB0aGUgcmVnaW9uIGlzIG9wZW4uXG4gICAgaWYgKGNhc2VSZWdpb24pIHtcbiAgICAgIGNvbnN0IHIgPSBjYXNlUmVnaW9uO1xuICAgICAgaWYgKHIubG9jYWxEZXB0aCA9PT0gMCkge1xuICAgICAgICBjb25zdCBzMiA9IGNtZC5zbGljZShpLCBpICsgMik7XG4gICAgICAgIGNvbnN0IHMzID0gY21kLnNsaWNlKGksIGkgKyAzKTtcbiAgICAgICAgLy8gYDs7YC9gOyZgL2A7OyZgIGVuZCB0aGUgY3VycmVudCBwYXR0ZXJuIGxpc3QgXHUyMDE0IGJhY2sgdG8gcGF0dGVybi1zdGFydC5cbiAgICAgICAgaWYgKHMzID09PSAnOzsmJyB8fCBzMiA9PT0gJzs7JyB8fCBzMiA9PT0gJzsmJykge1xuICAgICAgICAgIHIucG9zID0gJ3BhdHRlcm4tc3RhcnQnO1xuICAgICAgICAgIGJ1ZiArPSBzMyA9PT0gJzs7JicgPyBzMyA6IHMyO1xuICAgICAgICAgIGkgKz0gczMgPT09ICc7OyYnID8gMyA6IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgLy8gYDtgIHJldHVybnMgdG8gY29tbWFuZCBzdGFydCAoYSBgOztgIHdhcyBoYW5kbGVkIGFib3ZlKS5cbiAgICAgICAgaWYgKGMgPT09ICc7Jykge1xuICAgICAgICAgIHIucG9zID0gJ2NvbW1hbmQnO1xuICAgICAgICAgIHIuY21kRW1wdHkgPSB0cnVlO1xuICAgICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICAvLyBBIHNpbmdsZSBgJmAgKG5vdCBwYXJ0IG9mIGEgcmVkaXJlY3Qgb3IgYCYmYCkgaXMgdGhlIGJhY2tncm91bmRcbiAgICAgICAgLy8gb3BlcmF0b3IgXHUyMDE0IGFsc28gY29tbWFuZCBzdGFydC5cbiAgICAgICAgY29uc3QgbGFzdCA9IGJ1ZltidWYubGVuZ3RoIC0gMV07XG4gICAgICAgIGlmIChjID09PSAnJicgJiYgY21kW2kgKyAxXSAhPT0gJz4nICYmIGNtZFtpICsgMV0gIT09ICcmJyAmJiBsYXN0ICE9PSAnPicgJiYgbGFzdCAhPT0gJzwnKSB7XG4gICAgICAgICAgci5wb3MgPSAnY29tbWFuZCc7XG4gICAgICAgICAgci5jbWRFbXB0eSA9IHRydWU7XG4gICAgICAgICAgYnVmICs9IGM7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnXFxuJykge1xuICAgICAgICAgIC8vIEEgcGF0dGVybiBjYW5ub3QgY29udGludWUgYWNyb3NzIGEgbmV3bGluZSAoYmFzaCBlcnJvcnMpLCBidXQgYVxuICAgICAgICAgIC8vIG5ld2xpbmUgYWZ0ZXIgYGluYCBvciBpbnNpZGUgYSBsaXN0IGl0ZW0gaXMgZmluZS5cbiAgICAgICAgICBpZiAoci5wb3MgPT09ICdwYXR0ZXJuJykge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jYXNlJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHIucG9zID09PSAnY29tbWFuZCcpIHIuY21kRW1wdHkgPSB0cnVlO1xuICAgICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJyMnICYmIGlzV29yZFN0YXJ0KCkpIHtcbiAgICAgICAgICAvLyBBIGNvbW1lbnQgaW5zaWRlIHRoZSByZWdpb24gcnVucyB0byB0aGUgbmV3bGluZSBsaWtlIG91dHNpZGUuXG4gICAgICAgICAgd2hpbGUgKGkgPCBuICYmIGNtZFtpXSAhPT0gJ1xcbicpIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoaXNXb3JkU3RhcnQoKSAmJiAhV09SRF9FTkQudGVzdChjKSkge1xuICAgICAgICAgIGxldCBqID0gaTtcbiAgICAgICAgICB3aGlsZSAoaiA8IG4gJiYgIVdPUkRfRU5ELnRlc3QoY21kW2pdKSkgaiArPSAxO1xuICAgICAgICAgIGNvbnN0IHcgPSBjbWQuc2xpY2UoaSwgaik7XG4gICAgICAgICAgLy8gYGVzYWNgIGNsb3NlcyBhdCBhIHBhdHRlcm4tbGlzdCBzdGFydCBvciBhdCB0aGUgc3RhcnQgb2YgYSBsaXN0XG4gICAgICAgICAgLy8gaXRlbTsgZWxzZXdoZXJlIGl0IGlzIGFuIG9yZGluYXJ5IHdvcmQgKGBlY2hvIGVzYWNgLCBgYXxlc2FjKWApLFxuICAgICAgICAgIC8vIGFzIGlzIGBjYXNlYCBpbiB0aGUgc3ViamVjdCAoYGNhc2UgZXNhYyBpbiBcdTIwMjZgKS5cbiAgICAgICAgICBpZiAodyA9PT0gJ2VzYWMnICYmIChyLnBvcyA9PT0gJ3BhdHRlcm4tc3RhcnQnIHx8IChyLnBvcyA9PT0gJ2NvbW1hbmQnICYmIHIuY21kRW1wdHkpKSkge1xuICAgICAgICAgICAgY2FzZVJlZ2lvbiA9IG51bGw7XG4gICAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdpbicgJiYgci5wb3MgPT09ICdzdWJqZWN0Jykge1xuICAgICAgICAgICAgci5wb3MgPSAncGF0dGVybi1zdGFydCc7XG4gICAgICAgICAgfSBlbHNlIGlmIChyLnBvcyA9PT0gJ3BhdHRlcm4tc3RhcnQnKSB7XG4gICAgICAgICAgICByLnBvcyA9ICdwYXR0ZXJuJztcbiAgICAgICAgICB9IGVsc2UgaWYgKHIucG9zID09PSAnY29tbWFuZCcpIHtcbiAgICAgICAgICAgIHIuY21kRW1wdHkgPSBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnVmICs9IHc7XG4gICAgICAgICAgaSA9IGo7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIExvY2FsIGRlcHRoID4gMCBvciBub24td29yZCBjaGFycyBmYWxsIHRocm91Z2ggdG8gdGhlIHBhcmVuIGJyYW5jaGVzXG4gICAgICAvLyBhbmQgdGhlIGdlbmVyaWMgYnVmZmVyLlxuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBpZiAoY2FzZVJlZ2lvbikge1xuICAgICAgICBjYXNlUmVnaW9uLmxvY2FsRGVwdGggKz0gMTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEEgc3Vic2hlbGwgc3RhcnRzIGEgY29tbWFuZCBcdTIwMTQgYGlmIHRydWU7IHRoZW4gKCBlY2hvIGhpICk7IGZpYCBpc1xuICAgICAgICAvLyB2YWxpZCB3aGlsZSBgaWYgdHJ1ZTsgdGhlbjsgZmlgIGlzIG5vdDsgdGhlIHNhbWUgc3Vic2hlbGwgY291bnRzIGFzXG4gICAgICAgIC8vIGEgYm9keSB3b3JkIGZvciBhbiBlbmNsb3NpbmcgYnJhY2UgZ3JvdXAgKGB7ICggZWNobyBoaSApOyB9YCkuXG4gICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgaWYgKHQ/LmtpbmQgPT09ICdicmFjZScpIHQuYm9keSA9IHRydWU7XG4gICAgICAgIGRlcHRoICs9IDE7XG4gICAgICAgIGxldmVscy5wdXNoKFtdKTtcbiAgICAgIH1cbiAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgaWYgKGNhc2VSZWdpb24pIHtcbiAgICAgICAgLy8gQXQgbG9jYWwgZGVwdGggMCBhIGApYCBpcyB0aGUgcGF0dGVybiB0ZXJtaW5hdG9yIChvciB0aGUgZW5kIG9mIGFcbiAgICAgICAgLy8gbGlzdCBpdGVtKSBcdTIwMTQgdGhlIHJlZ2lvbiBvd25zIGl0IGFuZCB0aGUgZ2xvYmFsIGRlcHRoIHN0YXlzIGZyb3plbi5cbiAgICAgICAgaWYgKGNhc2VSZWdpb24ubG9jYWxEZXB0aCA9PT0gMCkge1xuICAgICAgICAgIGNhc2VSZWdpb24ucG9zID0gJ2NvbW1hbmQnO1xuICAgICAgICAgIGNhc2VSZWdpb24uY21kRW1wdHkgPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNhc2VSZWdpb24ubG9jYWxEZXB0aCAtPSAxO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBIHN0cmF5IGApYCBhdCBkZXB0aCAwIChhbmQgYnJhY2UgZGVwdGggMCwgb3V0c2lkZSBxdW90ZXMpIGlzIGEgcGFyc2VcbiAgICAgICAgLy8gZXJyb3IgXHUyMDE0IGBlY2hvIHgpICYmIFx1MjAyNmAgKHBsYW4gXHUwMEE3MSkuIGApYCBpbnNpZGUgcXVvdGVzLCBgJHtcdTIwMjZ9YCwgYW5kXG4gICAgICAgIC8vIGhlcmVkb2MgYm9kaWVzIG5ldmVyIHJlYWNoZXMgdGhpcyBicmFuY2guXG4gICAgICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgICAgIHJlamVjdCgndW5iYWxhbmNlZC1wYXJlbicpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIC8vIEZpcmUtYmVmb3JlLXJlc3RvcmU6IGFuIHVuY2xvc2VkIGNvbnN0cnVjdCBvbiB0aGUgY2xvc2luZyBsZXZlbFxuICAgICAgICAvLyBjYW5ub3Qgb3V0bGl2ZSB0aGUgc3Vic2hlbGwgKHBsYW4gXHUwMEE3MykuXG4gICAgICAgIGlmIChsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGRlcHRoIC09IDE7XG4gICAgICAgIGxldmVscy5wb3AoKTtcbiAgICAgIH1cbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIENvbnN0cnVjdCBrZXl3b3JkcyBhbmQgdGhlIGNhc2UtcmVnaW9uIG9wZW5lcjogcmVjb2duaXplZCBhdCB3b3JkXG4gICAgLy8gc3RhcnRzIGF0IGFueSBwYXJlbiBkZXB0aCAoY29uc3RydWN0cyB0cmFjayB0aHJvdWdoIHN1YnNoZWxscyksIG91dHNpZGVcbiAgICAvLyBxdW90ZXMsICR7XHUyMDI2fSwgaGVyZWRvYyBib2RpZXMsIGFuZCBvcGVuIGNhc2UgcmVnaW9ucyAodGhlIHJlZ2lvbiBzY2FuXG4gICAgLy8gYWJvdmUgb3ducyB0aG9zZSB3b3JkcykuIFdvcmQtZW5kIGNoYXJzIChgO2AsIGAmYCwgYHxgLCBgPGAsIGA+YClcbiAgICAvLyBuZXZlciBiZWdpbiBhIHdvcmQgaGVyZS5cbiAgICBpZiAoXG4gICAgICAhY2FzZVJlZ2lvbiAmJlxuICAgICAgIVdPUkRfRU5ELnRlc3QoYykgJiZcbiAgICAgIChpc1dvcmRTdGFydCgpIHx8IC9bKCldJC8udGVzdChidWYpKSAmJlxuICAgICAgIShjID09PSAnJCcgJiYgY21kW2kgKyAxXSA9PT0gJ3snKVxuICAgICkge1xuICAgICAgbGV0IGogPSBpO1xuICAgICAgd2hpbGUgKGogPCBuICYmICFXT1JEX0VORC50ZXN0KGNtZFtqXSkpIGogKz0gMTtcbiAgICAgIGNvbnN0IHcgPSBjbWQuc2xpY2UoaSwgaik7XG4gICAgICBjb25zdCBpc0ZuU2hhcGUgPSAoKTogYm9vbGVhbiA9PiAvXltBLVphLXpfXVtBLVphLXowLTlfXSpcXChcXCkkLy50ZXN0KGxhc3RXb3JkKCkpIHx8IGxhc3RXb3JkKCkgPT09ICcoKSc7XG4gICAgICBpZiAodyA9PT0gJ2luJyAmJiB0b3AoKSAhPT0gdW5kZWZpbmVkICYmIFsnZm9yJywgJ3NlbGVjdCddLmluY2x1ZGVzKHRvcCgpIS5raW5kKSkge1xuICAgICAgICAvLyBUaGUgZm9yL3NlbGVjdCB3b3JkLWxpc3Qgc2VwYXJhdG9yIFx1MjAxNCByZWNvZ25pemVkIHdoZXJldmVyIGl0IGFwcGVhcnNcbiAgICAgICAgLy8gd2hpbGUgYSBmb3Ivc2VsZWN0IGlzIG9wZW4gKGBmb3IgaSBpbiBhIGJgLCBgc2VsZWN0IHggaW4gYWApLlxuICAgICAgfSBlbHNlIGlmICh3ID09PSAneycgJiYgKGlzQ29tbWFuZFBvc2l0aW9uKCkgfHwgaXNGblNoYXBlKCkgfHwgKGZ1bmN0aW9uU2VlbiAmJiBuYW1lU2VlbikpKSB7XG4gICAgICAgIC8vIGB7YCBvcGVucyBhIGJyYWNlIGdyb3VwIGF0IGNvbW1hbmQgcG9zaXRpb24sIG9yIHJpZ2h0IGFmdGVyIGFcbiAgICAgICAgLy8gZnVuY3Rpb24gbmFtZSAoYGYoKSB7YCwgYGYoKXtgLCBgZnVuY3Rpb24gZiB7YCkuIGB7Y2F0YCBpcyBhIHdvcmQuXG4gICAgICAgIGlmIChmdW5jdGlvblNlZW4gJiYgbmFtZVNlZW4pIHtcbiAgICAgICAgICBmdW5jdGlvblNlZW4gPSBmYWxzZTtcbiAgICAgICAgICBuYW1lU2VlbiA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnB1c2goeyBraW5kOiAnYnJhY2UnLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ30nICYmIGlzQ29tbWFuZFBvc2l0aW9uKCkpIHtcbiAgICAgICAgY29uc3QgdCA9IHRvcCgpO1xuICAgICAgICBpZiAoYWZ0ZXJLZXl3b3JkIHx8IHQgPT09IHVuZGVmaW5lZCB8fCB0LmtpbmQgIT09ICdicmFjZScgfHwgIXQuYm9keSkge1xuICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wb3AoKTtcbiAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICB9IGVsc2UgaWYgKGlzQ29tbWFuZFBvc2l0aW9uKCkpIHtcbiAgICAgICAgaWYgKHcgPT09ICdjYXNlJykge1xuICAgICAgICAgIGNhc2VSZWdpb24gPSB7IHBvczogJ3N1YmplY3QnLCBjbWRFbXB0eTogZmFsc2UsIGxvY2FsRGVwdGg6IDAgfTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgZnVuY3Rpb25TZWVuID0gdHJ1ZTtcbiAgICAgICAgICBuYW1lU2VlbiA9IGZhbHNlO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdpZicpIHtcbiAgICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnB1c2goeyBraW5kOiAnaWYnLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICd3aGlsZScgfHwgdyA9PT0gJ3VudGlsJykge1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucHVzaCh7IGtpbmQ6ICdsb29wJywgYm9keTogZmFsc2UgfSk7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZm9yJykge1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucHVzaCh7IGtpbmQ6ICdmb3InLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdzZWxlY3QnKSB7XG4gICAgICAgICAgaWYgKHRvcCgpPy5raW5kID09PSAnYnJhY2UnKSB0b3AoKSEuYm9keSA9IHRydWU7XG4gICAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wdXNoKHsga2luZDogJ3NlbGVjdCcsIGJvZHk6IGZhbHNlIH0pO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2RvJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8ICFbJ2ZvcicsICdsb29wJywgJ3NlbGVjdCddLmluY2x1ZGVzKHQua2luZCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgdC5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICd0aGVuJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8IHQua2luZCAhPT0gJ2lmJykge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0LmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2Vsc2UnIHx8IHcgPT09ICdlbGlmJykge1xuICAgICAgICAgIC8vIGVsc2UvZWxpZiByZXF1aXJlIGEgYm9keSBhbHJlYWR5IFx1MjAxNCBhbiBlbXB0eSBpZi1saXN0IGlzIGFuIGVycm9yLlxuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8IHQua2luZCAhPT0gJ2lmJyB8fCAhdC5ib2R5KSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2luJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8ICFbJ2ZvcicsICdzZWxlY3QnXS5pbmNsdWRlcyh0LmtpbmQpKSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdmaScpIHtcbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCB0LmtpbmQgIT09ICdpZicgfHwgIXQuYm9keSkge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnBvcCgpO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdkb25lJykge1xuICAgICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgICBpZiAodCA9PT0gdW5kZWZpbmVkIHx8ICFbJ2ZvcicsICdsb29wJywgJ3NlbGVjdCddLmluY2x1ZGVzKHQua2luZCkgfHwgIXQuYm9keSkge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnBvcCgpO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdlc2FjJykge1xuICAgICAgICAgIC8vIE5vIG9wZW4gcmVnaW9uIFx1MjAxNCBhIHN0cmF5IGVzYWMgaXMgYSBwYXJzZSBlcnJvci5cbiAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGlmIChmdW5jdGlvblNlZW4pIHtcbiAgICAgICAgICAgIGlmIChuYW1lU2Vlbikge1xuICAgICAgICAgICAgICBmdW5jdGlvblNlZW4gPSBmYWxzZTtcbiAgICAgICAgICAgICAgbmFtZVNlZW4gPSBmYWxzZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIG5hbWVTZWVuID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEFuIGFyZ3VtZW50LXBvc2l0aW9uIHdvcmQ6IG5vdGhpbmcgb3BlbnMsIHRoZSBlbXB0eS1ib2R5IGZsYWdcbiAgICAgICAgLy8gY2xlYXJzLCBhbmQgdGhlIGZ1bmN0aW9uLW5hbWUgaGFuZG9mZiBhZHZhbmNlcy5cbiAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICAgIGlmIChmdW5jdGlvblNlZW4pIHtcbiAgICAgICAgICBpZiAobmFtZVNlZW4pIHtcbiAgICAgICAgICAgIGZ1bmN0aW9uU2VlbiA9IGZhbHNlO1xuICAgICAgICAgICAgbmFtZVNlZW4gPSBmYWxzZTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmFtZVNlZW4gPSB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYnVmICs9IHc7XG4gICAgICBpID0gajtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBBIGA7YC9gJmAgZGlyZWN0bHkgYWZ0ZXIgYW4gb3BlbmVyIG9yIGJvZHkga2V5d29yZCBpcyBhbiBlbXB0eS1saXN0XG4gICAgLy8gcGFyc2UgZXJyb3IgYXQgYW55IGRlcHRoIChgaWYgdHJ1ZTsgdGhlbjsgZmlgLCBgeyA7IH1gLFxuICAgIC8vIGBmb3IgaSBpbiBhIGI7IGRvOyBkb25lYCwgYCggaWYgdHJ1ZTsgdGhlbjsgZmkgKWApLlxuICAgIGlmIChjYXNlUmVnaW9uID09PSBudWxsICYmIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCAmJiAoYyA9PT0gJzsnIHx8IGMgPT09ICcmJykgJiYgYWZ0ZXJLZXl3b3JkKSB7XG4gICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgLy8gQSByZWRpcmVjdCB0b2tlbiB3aXRoIG5vIHRhcmdldCB3b3JkLCBpbW1lZGlhdGVseSBmb2xsb3dlZCBieSBhbm90aGVyXG4gICAgICAvLyByZWRpcmVjdCB0b2tlbiBtaWQtc3RhZ2UsIGlzIGEgcGFyc2UgZXJyb3I6IGBjYXQgZiA+ID4gb3V0YCxcbiAgICAgIC8vIGBjYXQgZiA+IDI+JjFgLCBgY2F0IGYgPiAmPm91dGAsIGBjYXQgZiA+IDw8PCB4YCAocGxhbiBcdTAwQTcxKS5cbiAgICAgIGlmIChpc1dvcmRTdGFydCgpICYmIGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkgJiYgc3RhcnRzUmVkaXJlY3RBdChpKSkge1xuICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICckJyAmJiBjbWRbaSArIDFdID09PSAneycpIHtcbiAgICAgICAgYnJhY2VEZXB0aCArPSAxO1xuICAgICAgICBidWYgKz0gYztcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIC8vIEhlcmUtc3RyaW5nIHJlY29nbml0aW9uOiBgPDw8YCAoZXhhY3RseSB0aHJlZSBgPGBzLCBub3QgZmQtcHJlZml4ZWQpXG4gICAgICAvLyBpcyBhIHR3by10b2tlbiBvcGVyYXRvciBcdTIwMTQgYDw8PGAgcGx1cyB0aGUgd29yZCBpdCBmZWVkcyB0byBzdGRpbiBcdTIwMTRcbiAgICAgIC8vIE5PVCBhIGhlcmVkb2MuIFRoZSBoZXJlZG9jIGJyYW5jaCBiZWxvdyB3b3VsZCBvdGhlcndpc2UgZmlyZSBhdCB0aGVcbiAgICAgIC8vIFNFQ09ORCBgPGAgKGl0cyBgY21kW2krMl0gIT09ICc8J2AgdGVzdCBwYXNzZXMgb24gdGhlIGZvbGxvd2luZ1xuICAgICAgLy8gd29yZCksIHJlZ2lzdGVyIHRoYXQgd29yZCBhcyBhIGRlbGltaXRlciwgYW5kIG1hcmsgdGhlIHdob2xlXG4gICAgICAvLyBjb21tYW5kIGFuIHVudGVybWluYXRlZCBoZXJlZG9jIFx1MjAxNCBzbyB2YWxpZCBiYXNoIGhlcmUtc3RyaW5nc1xuICAgICAgLy8gKGBjYXQgPDw8aGVsbG9gLCBgcmcgLW4gbmVlZGxlIDEgMiA8PDwgJ3gnYCkgd2VyZSByZWplY3RlZCBhbmRcbiAgICAgIC8vIGZhaWxlZCBjbG9zZWQuIFRoZSBvcGVyYXRvciBzdGF5cyBpbiB0aGUgc3RhZ2UgdGV4dCAobm90aGluZ1xuICAgICAgLy8gc3RyaXBzIGl0KSwgc28gdGhlIHF1b3RlLWF3YXJlIGhhc1VucXVvdGVkUmVkaXJlY3Qgc2NhbiBzdGlsbFxuICAgICAgLy8gYXBwbGllcyB0aGUgc3RkaW4tcmVkaXJlY3QgZ2F0ZTsgY29uc3VtaW5nIGFsbCB0aHJlZSBjaGFyYWN0ZXJzXG4gICAgICAvLyBrZWVwcyB0aGUgd2FsayBmcm9tIHJlLXJlY29nbml6aW5nIGEgaGVyZWRvYyBhdCB0aGUgc2Vjb25kIGA8YC5cbiAgICAgIC8vIExvbmdlciBgPGAgcnVucyAoYDw8PDxgKSBhbmQgZmQtcHJlZml4ZWQgZm9ybXMgKGAyPDw8YCkgYXJlIG5vdFxuICAgICAgLy8gaGVyZS1zdHJpbmdzIHRvIGJhc2ggKHN5bnRheCBlcnJvciAvIGZkLWhlcmVkb2MgbWlzaW50ZXJwcmV0YXRpb24pXG4gICAgICAvLyBhbmQgZmFsbCB0aHJvdWdoIHRvIHRoZSBoZXJlZG9jIG1pc2ZpcmUsIHdoaWNoIGtlZXBzIHRoZW1cbiAgICAgIC8vIG1hbGZvcm1lZCBhbmQgZmFpbC1jbG9zZWQuXG4gICAgICBpZiAoYyA9PT0gJzwnICYmIGNtZFtpICsgMV0gPT09ICc8JyAmJiBjbWRbaSArIDJdID09PSAnPCcgJiYgY21kW2kgKyAzXSAhPT0gJzwnICYmIGNtZFtpIC0gMV0gIT09ICc8Jykge1xuICAgICAgICBidWYgKz0gJzw8PCc7XG4gICAgICAgIGkgKz0gMztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICAvLyBIZXJlZG9jIHJlY29nbml0aW9uIChwbGFuIFx1MDBBNzMpOiBgPDxgL2A8PC1gIChub3QgYDw8PGApIGF0IGRlcHRoIDAgd2l0aFxuICAgICAgLy8gYSBkZWxpbWl0ZXIgd29yZC4gVGhlIG9wZXJhdG9yK2RlbGltaXRlciBhcmUgc3RyaXBwZWQgZnJvbSB0aGUgc3RhZ2VcbiAgICAgIC8vIHRleHQgXHUyMDE0IHRoZSBzdGFnZSBrZWVwcyBhIHBsYWluIGFyZ3YgKGBjYXQgZmAgc3RheXMgYGNhdCBmYCkuXG4gICAgICBpZiAoYyA9PT0gJzwnICYmIGNtZFtpICsgMV0gPT09ICc8JyAmJiBjbWRbaSArIDJdICE9PSAnPCcpIHtcbiAgICAgICAgbGV0IGogPSBpICsgMjtcbiAgICAgICAgbGV0IGFsbG93VGFicyA9IGZhbHNlO1xuICAgICAgICBpZiAoY21kW2pdID09PSAnLScpIHtcbiAgICAgICAgICBhbGxvd1RhYnMgPSB0cnVlO1xuICAgICAgICAgIGogKz0gMTtcbiAgICAgICAgfVxuICAgICAgICB3aGlsZSAoY21kW2pdID09PSAnICcgfHwgY21kW2pdID09PSAnXFx0JykgaiArPSAxO1xuICAgICAgICBsZXQgZGVsaW0gPSAnJztcbiAgICAgICAgaWYgKGNtZFtqXSA9PT0gXCInXCIgfHwgY21kW2pdID09PSAnXCInKSB7XG4gICAgICAgICAgY29uc3QgcSA9IGNtZC5pbmRleE9mKGNtZFtqXSwgaiArIDEpO1xuICAgICAgICAgIGlmIChxID09PSAtMSkge1xuICAgICAgICAgICAgZGVsaW0gPSBjbWQuc2xpY2UoaiArIDEpO1xuICAgICAgICAgICAgaiA9IG47XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRlbGltID0gY21kLnNsaWNlKGogKyAxLCBxKTtcbiAgICAgICAgICAgIGogPSBxICsgMTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3Qgd29yZFN0YXJ0ID0gajtcbiAgICAgICAgICB3aGlsZSAoaiA8IG4gJiYgIVdPUkRfRU5ELnRlc3QoY21kW2pdKSkgaiArPSAxO1xuICAgICAgICAgIGRlbGltID0gY21kLnNsaWNlKHdvcmRTdGFydCwgaik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGltICE9PSAnJykge1xuICAgICAgICAgIGhlcmVkb2NzLnB1c2goe1xuICAgICAgICAgICAgY2xvc2U6IG5ldyBSZWdFeHAoYF4ke2FsbG93VGFicyA/ICdcXHQqJyA6ICcnfSR7ZXNjYXBlUmVnRXhwKGRlbGltKX1bIFxcXFx0XSokYClcbiAgICAgICAgICB9KTtcbiAgICAgICAgICAvLyBUaGUgb3BlcmF0b3IrZGVsaW1pdGVyIGxlYXZlIHRoZSBzdGFnZSB0ZXh0IGJlbG93LCBzbyBtYXJrIHRoZVxuICAgICAgICAgIC8vIHN0YWdlOiBpdHMgc3RkaW4gY29tZXMgZnJvbSB0aGUgaGVyZWRvYyBib2R5LCBhbmQgY29uc3VtZXJzIHRoYXRcbiAgICAgICAgICAvLyByZWFkIGA8YCBmcm9tIHRoZSB0ZXh0IHdvdWxkIG90aGVyd2lzZSBuZXZlciBzZWUgdGhlIHJlZGlyZWN0LlxuICAgICAgICAgIGJ1ZkhlcmVkb2MgPSB0cnVlO1xuICAgICAgICAgIGlmIChsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA+IDAgfHwgY2FzZVJlZ2lvbiAhPT0gbnVsbCkge1xuICAgICAgICAgICAgLy8gSW5zaWRlIGFuIG9wZW4gY29uc3RydWN0IHRoZSBvcGVyYXRvcitkZWxpbWl0ZXIgc3RheSBpbiB0aGVcbiAgICAgICAgICAgIC8vIHN0YWdlIHRleHQgXHUyMDE0IHRoZSB3YWxrJ3MgaW50ZXJpb3IgcmUtc3BsaXQgcmUtcmVjb2duaXplcyB0aGVcbiAgICAgICAgICAgIC8vIGhlcmVkb2MgdGhlcmUgKHBsYW4gXHUwMEE3MykuXG4gICAgICAgICAgICBidWYgKz0gY21kLnNsaWNlKGksIGopO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpID0gajtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gV2hpbGUgYSBjb25zdHJ1Y3QgaXMgb3BlbiBhdCBkZXB0aCAwIHRoZSBib3VuZGFyeSBvcGVyYXRvcnMgYXJlIHRleHQgXHUyMDE0XG4gICAgICAvLyB0aGUgY29uc3RydWN0IGlzIG9uZSBzdGFnZS5cbiAgICAgIGlmIChjYXNlUmVnaW9uID09PSBudWxsICYmIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnJiYnKSB7XG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCdhbmQnKTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8fCcpIHtcbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ29yJyk7XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfCYnKSB7XG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCdwaXBlJyk7XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZmx1c2goJ3NlbWljb2xvbicpO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJ3wnKSB7XG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCdwaXBlJyk7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnXFxuJykge1xuICAgICAgICAgIC8vIEEgbmV3bGluZSBpcyBhIGxpbmUgY29udGludWF0aW9uIFx1MjAxNCBub3QgYSBzdGF0ZW1lbnQgc2VwYXJhdG9yIFx1MjAxNCB3aGVuXG4gICAgICAgICAgLy8gYSBwaXBlL2FuZC9vciBvcGVyYXRvciBpcyBwZW5kaW5nIHdpdGggYSB3aGl0ZXNwYWNlLW9ubHkgYnVmZmVyXG4gICAgICAgICAgLy8gc2luY2UgaXQgKGBjYXQgYS50eHQgfFxcbnNlZCAuLi5gLCBgZmFsc2UgJiZcXG5zZWQgLi4uYCkuIGBjYXQgZiB8IGhlYWQgLTFcXG5jYXQgZ2BcbiAgICAgICAgICAvLyBpcyB0aGVyZWZvcmUgdHdvIGxpc3RzLCBhbmQgYSByZWRpcmVjdCB0YXJnZXQgbmV2ZXIgY29udGludWVzIG9udG9cbiAgICAgICAgICAvLyBhIGxhdGVyIGxpbmUgKHBsYW4gXHUwMEE3MSkuXG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkpIHtcbiAgICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCduZXdsaW5lJyk7XG4gICAgICAgICAgbGlzdFN0YXJ0ID0gcGFydHMubGVuZ3RoO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAgICAgLy8gQSBiYXJlIGAmYCBpcyBhIGJhY2tncm91bmQgb3BlcmF0b3Igb25seSB3aGVuIGl0IGlzIG5vdCBwYXJ0IG9mIGFcbiAgICAgICAgICAvLyByZWRpcmVjdCB0b2tlbjogdGhlIG5leHQgY2hhcmFjdGVyIGlzIGA+YCAoYCY+YC9gJj4+YCksIG9yIHRoZVxuICAgICAgICAgIC8vIGJ1ZmZlcidzIGxhc3QgY2hhcmFjdGVyIGlzIGA+YCBvciBgPGAgKGAyPiYxYCwgYD4mIGZpbGVgLCBgMzwmMGApLlxuICAgICAgICAgIC8vIFNwbGl0dGluZyBpbnNpZGUgdGhvc2UgdG9rZW5zIHdvdWxkIHByb2R1Y2UganVuayBzdGFnZXMuXG4gICAgICAgICAgY29uc3QgbmV4dCA9IGNtZFtpICsgMV07XG4gICAgICAgICAgY29uc3QgbGFzdCA9IGJ1ZltidWYubGVuZ3RoIC0gMV07XG4gICAgICAgICAgaWYgKG5leHQgIT09ICc+JyAmJiBsYXN0ICE9PSAnPicgJiYgbGFzdCAhPT0gJzwnKSB7XG4gICAgICAgICAgICBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmbHVzaCgnYmFja2dyb3VuZCcpO1xuICAgICAgICAgICAgaSArPSAxO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGJ1ZiArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuXG4gIC8vIEVuZCBvZiBpbnB1dDogdGhlIEVPRi1zdGF0ZSB2ZXJkaWN0cyBcdTIwMTQgYW4gdW5jbG9zZWQgcXVvdGUsIGJyYWNlLCBjYXNlXG4gIC8vIHJlZ2lvbiwgcGFyZW4gbGV2ZWwsIG9yIGNvbnN0cnVjdCBcdTIwMTQgdGhlbiB0aGUgdW5jb25zdW1lZC1vcGVyYXRvciBjaGVja3MsXG4gIC8vIHRoZW4gdGhlIHVudGVybWluYXRlZC1oZXJlZG9jIHBhcnRpYWwsIHRoZW4gdGhlIGZpbmFsIGZsdXNoLiBBIHZlcmRpY3RcbiAgLy8gc2V0IG1pZC1zY2FuIGFscmVhZHkgZHJvcHBlZCB0aGUgcmVqZWN0aW5nIGxpc3QgYW5kIGVuZGVkIHRoZSBsb29wLCBzb1xuICAvLyBgcGFydHNgIGlzIGV4YWN0bHkgdGhlIGNvbXBsZXRlZCBlYXJsaWVyIGxpc3RzIGhlcmUuXG4gIGlmIChtYWxmb3JtZWQpIHJldHVybiB7IHN0YWdlczogcGFydHMsIG1hbGZvcm1lZCB9O1xuICBpZiAoaW5TcXVvdGUgfHwgaW5EcXVvdGUpIHtcbiAgICByZWplY3QoJ3VuY2xvc2VkLXF1b3RlJyk7XG4gIH0gZWxzZSBpZiAoYnJhY2VEZXB0aCA+IDApIHtcbiAgICByZWplY3QoJ3VuY2xvc2VkLWJyYWNlJyk7XG4gIH0gZWxzZSBpZiAoY2FzZVJlZ2lvbiAhPT0gbnVsbCkge1xuICAgIHJlamVjdCgndW5jbG9zZWQtY2FzZScpO1xuICB9IGVsc2UgaWYgKGRlcHRoID4gMCkge1xuICAgIHJlamVjdCgndW5iYWxhbmNlZC1wYXJlbicpO1xuICB9IGVsc2UgaWYgKGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCkge1xuICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gIH0gZWxzZSBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICB9IGVsc2UgaWYgKGluQm9keSB8fCBoZXJlZG9jcy5sZW5ndGggPiAwKSB7XG4gICAgLy8gVW50ZXJtaW5hdGVkIGhlcmVkb2MgXHUyMDE0IGJhc2ggd2FybnMsIHJ1bnMgdGhlIGRlbGltaXRlcidzIGxpbmUsIGFuZFxuICAgIC8vIHRyZWF0cyB0aGUgdGFpbCBhcyBib2R5OiB0aGUgcGFydGlhbC4gVGhlIGRlbGltaXRlcidzLWxpbmUgc3RhZ2UocylcbiAgICAvLyBhbmFseXplIGFzLWlzOyB0aGUgYm9keSBwcm9kdWNlcyBubyBzdGFnZXMgKHBsYW4gXHUwMEE3MykuXG4gICAgZmx1c2goJ25ld2xpbmUnKTtcbiAgICBtYWxmb3JtZWQgPSAndW50ZXJtaW5hdGVkLWhlcmVkb2MnO1xuICB9IGVsc2Uge1xuICAgIGZsdXNoKCduZXdsaW5lJyk7XG4gIH1cbiAgcmV0dXJuIHsgc3RhZ2VzOiBwYXJ0cywgbWFsZm9ybWVkIH07XG59XG5cbmNvbnN0IExFQURJTkdfQVNTSUdOTUVOVCA9IC9eKD86W0EtWmEtel9dW0EtWmEtejAtOV9dKj1cXFMqXFxzKykrLztcblxuLyoqIFN0cmlwIGxlYWRpbmcgRk9PPWJhciBWQVI9YmF6IGVudi1wcmVmaXggYXNzaWdubWVudHMgZnJvbSBhIHNpbXBsZSBjb21tYW5kLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNpbXBsZUNtZC5yZXBsYWNlKExFQURJTkdfQVNTSUdOTUVOVCwgJycpO1xufVxuXG4vKiogUXVvdGUtYXdhcmUgd2hpdGVzcGFjZSB0b2tlbml6ZXIsIHJvdWdobHkgbWF0Y2hpbmcgYHNobGV4LnNwbGl0KHMsIHBvc2l4PVRydWUpYC4gUmV0dXJucyBudWxsIG9uIHVuYmFsYW5jZWQgcXVvdGVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNwbGl0V29yZHMoczogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgY29uc3Qgd29yZHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXIgPSAnJztcbiAgbGV0IGhhcyA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBzLmxlbmd0aDtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gc1tpXTtcbiAgICBpZiAoL1xccy8udGVzdChjKSkge1xuICAgICAgaWYgKGhhcykge1xuICAgICAgICB3b3Jkcy5wdXNoKGN1cik7XG4gICAgICAgIGN1ciA9ICcnO1xuICAgICAgICBoYXMgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb25zdCBlbmQgPSBzLmluZGV4T2YoXCInXCIsIGkpO1xuICAgICAgaWYgKGVuZCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgICAgY3VyICs9IHMuc2xpY2UoaSwgZW5kKTtcbiAgICAgIGkgPSBlbmQgKyAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgd2hpbGUgKGkgPCBuICYmIHNbaV0gIT09ICdcIicpIHtcbiAgICAgICAgaWYgKHNbaV0gPT09ICdcXFxcJyAmJiBpICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhzW2kgKyAxXSkpIHtcbiAgICAgICAgICBjdXIgKz0gc1tpICsgMV07XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGN1ciArPSBzW2ldO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGkgPj0gbikgcmV0dXJuIG51bGw7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBjdXIgKz0gc1tpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaGFzID0gdHJ1ZTtcbiAgICBjdXIgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgaWYgKGhhcykgd29yZHMucHVzaChjdXIpO1xuICByZXR1cm4gd29yZHM7XG59XG5cbi8qKlxuICogV2hldGhlciBhbiBVTlFVT1RFRCBgPGAgXHUyMDE0IGEgc3RkaW4gcmVkaXJlY3QsIHN0YW5kYWxvbmUgKGA8IGZpbGVgKSBvciBnbHVlZFxuICogaW5zaWRlIGEgdG9rZW4gKGBoZWFkIC0yPGZgLCBgcmcgbmVlZGxlPGZgLCBhIGNvbnN1bWVkIGAtZWAvYC1mYCB2YWx1ZSBsaWtlXG4gKiBgLWUgbmVlZGxlPGZgKSBcdTIwMTQgYXBwZWFycyBpbiBhIHNpbXBsZSBjb21tYW5kLiBCYXNoIHRyZWF0cyBgPGAgYXMgYSByZWRpcmVjdFxuICogb3BlcmF0b3Igb25seSBvdXRzaWRlIHF1b3Rlcywgc28gdGhlIHNjYW4gaXMgcXVvdGUtYXdhcmU6IGEgbGl0ZXJhbCBgPGAgaW5cbiAqIGEgcGF0dGVybiBsaWtlIGByZyAtbiAnPGRpdj4nYCBvciBhbiBhd2sgc2NyaXB0IGxpa2UgYCdOUjw9MidgIG11c3QgbmV2ZXJcbiAqIGJlIG1pc3Rha2VuIGZvciBhIHJlZGlyZWN0LiBQcm9jZXNzIHN1YnN0aXR1dGlvbiBgPChcdTIwMjYpYCBhbmQgaGVyZS1zdHJpbmdzXG4gKiBgPDw8YCBhbHNvIGJlZ2luIHdpdGggYW4gdW5xdW90ZWQgYDxgIFx1MjAxNCBib3RoIGNvdW50IGFzIHJlZGlyZWN0cyBoZXJlIChmYWlsXG4gKiBjbG9zZWQ7IGEgcmVhZC10b3VjaCBiaW4gbmV2ZXIgbGVnaXRpbWF0ZWx5IG5lZWRzIHRoZW0pLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaGFzVW5xdW90ZWRSZWRpcmVjdChzaW1wbGVDbWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBsZXQgaW5TcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGluRHF1b3RlID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2ltcGxlQ21kLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IHNpbXBsZUNtZFtpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIC8vIE5vIGVzY2FwZXMgaW5zaWRlIHNpbmdsZSBxdW90ZXMgXHUyMDE0IHRoZSBuZXh0IGAnYCBhbHdheXMgY2xvc2VzLlxuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgLy8gSW5zaWRlIGRvdWJsZSBxdW90ZXMgYSBiYWNrc2xhc2ggb25seSBlc2NhcGVzIGBcImAsIGBcXGAsIGAkYCwgYW5kXG4gICAgICAvLyBiYWNrdGljazsgZXZlcnl0aGluZyBlbHNlIChpbmNsdWRpbmcgYDxgKSBpcyBsaXRlcmFsLlxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IHNpbXBsZUNtZC5sZW5ndGggJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhzaW1wbGVDbWRbaSArIDFdKSkge1xuICAgICAgICBpICs9IDE7XG4gICAgICB9IGVsc2UgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgICAgaW5EcXVvdGUgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU3F1b3RlID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBzaW1wbGVDbWQubGVuZ3RoKSB7XG4gICAgICAvLyBBbiBlc2NhcGVkIGNoYXJhY3RlciBpcyBsaXRlcmFsIFx1MjAxNCBgXFw8YCBpcyBub3QgYSByZWRpcmVjdC5cbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzwnKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBCZXN0LWVmZm9ydCBhcmd2IGZvciBhIHNpbXBsZSBjb21tYW5kOiBsZWFkaW5nIGFzc2lnbm1lbnRzIHN0cmlwcGVkLCBxdW90ZS1hd2FyZSBzcGxpdC4gUmV0dXJucyBudWxsIGlmIHRoZSBjb21tYW5kIGRvZXNuJ3QgdG9rZW5pemUgY2xlYW5seSAodW5iYWxhbmNlZCBxdW90ZXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFyZ3ZPZihzaW1wbGVDbWQ6IHN0cmluZyk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIHJldHVybiBzcGxpdFdvcmRzKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZUNtZCkudHJpbSgpKTtcbn1cblxuLyoqXG4gKiBSZWRpcmVjdCBvcGVyYXRvcnMgdGhhdCBkcm9wIHRvZ2V0aGVyIHdpdGggdGhlaXIgcGxhaW4gdGFyZ2V0IHdvcmQgKHBsYW4gXHUwMEE3NFxuICogdHdvLXRva2VuIHNoYXBlcyk6IGA+YCwgYD4+YCwgYDxgLCBgPD5gLCBgJj5gLCBgJj4+YCwgYW5kIGRpZ2l0LXByZWZpeGVkXG4gKiBmb3JtcyBsaWtlIGAyPmAvYDI+PmAvYDM8YC4gYD58YCBpcyBkZWxpYmVyYXRlbHkgYWJzZW50IFx1MjAxNCBpdCBmYWlscyBjbG9zZWQuXG4gKi9cbmNvbnN0IFJFRElSRUNUX1RXT19UT0tFTiA9IC9eKD86Pj4/fDw+fDx8Jj4+P3xbMC05XSsoPzo+Pj98PD58PCkpJC87XG5cbi8qKiBEdXAgZm9ybXMgdGhhdCBkcm9wIGFsb25lIChwbGFuIFx1MDBBNzQpOiBgMj4mMWAsIGA+Ji1gLCBgMzwmMGAuICovXG5jb25zdCBSRURJUkVDVF9EVVAgPSAvXig/OlswLTldKyk/Wzw+XSYoPzpbMC05XSt8LSkkLztcblxuLyoqIEZ1c2VkIG9wZXJhdG9yK3RhcmdldCB3b3JkcyB0aGF0IGRyb3Agd2hvbGUgKHBsYW4gXHUwMEE3NCk6IGA+b3V0YCwgYDI+ZXJyYCwgYCY+b3V0YC4gKi9cbmNvbnN0IFJFRElSRUNUX0ZVU0VEID0gL14oPzo+Pj98PD58PHwmPj4/fFswLTldKyg/Oj4+P3w8Pnw8KSlbXjw+JnxdLztcblxuLyoqIEhlcmVkb2MvaGVyZS1zdHJpbmcgb3BlcmF0b3JzIHdpdGggYSBzZXBhcmF0ZSB0YXJnZXQgd29yZDogYDw8YCwgYDw8LWAsIGA8PDxgLiAqL1xuY29uc3QgSEVSRURPQ19UV09fVE9LRU4gPSAvXig/Ojw8LT98PDw8KSQvO1xuXG4vKiogRnVzZWQgaGVyZWRvYyB3b3JkcyAocGxhbiBcdTAwQTc0KTogYDw8RU9GYCwgYDw8LUVPRmAsIGA8PDx4YC4gKi9cbmNvbnN0IEhFUkVET0NfRlVTRUQgPSAvXig/Ojw8LT98PDw8KVtePD4mfF0vO1xuXG4vKiogV2hldGhlciBhIHdvcmQgaXMgaXRzZWxmIGEgcmVkaXJlY3QgdG9rZW4gXHUyMDE0IG5ldmVyIGEgdmFsaWQgcmVkaXJlY3QgdGFyZ2V0LiAqL1xuY29uc3QgUkVESVJFQ1RfVE9LRU4gPSAodzogc3RyaW5nKTogYm9vbGVhbiA9PlxuICBSRURJUkVDVF9UV09fVE9LRU4udGVzdCh3KSB8fFxuICBSRURJUkVDVF9EVVAudGVzdCh3KSB8fFxuICBSRURJUkVDVF9GVVNFRC50ZXN0KHcpIHx8XG4gIEhFUkVET0NfVFdPX1RPS0VOLnRlc3QodykgfHxcbiAgSEVSRURPQ19GVVNFRC50ZXN0KHcpO1xuXG4vKipcbiAqIFN0cmlwIHJlZGlyZWN0IHRva2VucyBmcm9tIGEgc2ltcGxlIGNvbW1hbmQncyBhcmd2IHNvIHRoZSByZWFkLXNpZGVcbiAqIG1hdGNoZXJzIHNlZSB0aGUgd29yZHMgdGhhdCB3ZXJlIGFjdHVhbGx5IHJlYWQgKHBsYW4gXHUwMEE3NCk6IHR3by10b2tlblxuICogb3BlcmF0b3JzIChgPmAsIGA+PmAsIGA8YCwgYDw+YCwgYCY+YCwgYCY+PmAsIGRpZ2l0LXByZWZpeGVkIGAyPmAvYDI+PmAvXG4gKiBgMzxgLCAuLi4pIGRyb3AgdG9nZXRoZXIgd2l0aCB0aGVpciBwbGFpbiB0YXJnZXQgd29yZCwgZHVwIGZvcm1zIChgMj4mMWAsXG4gKiBgPiYtYCwgYDM8JjBgKSBkcm9wIGFsb25lLCBmdXNlZCBmb3JtcyAoYD5vdXRgLCBgMj5lcnJgLCBgJj5vdXRgKSBkcm9wIGFzXG4gKiBvbmUgd29yZCwgYW5kIGhlcmVkb2MvaGVyZS1zdHJpbmcgb3BlcmF0b3JzIGRyb3Agd2l0aCB0aGVpciB0YXJnZXQgd29yZCBpblxuICogYm90aCBzcGVsbGluZ3MuIEEgdHdvLXRva2VuIG9wZXJhdG9yJ3MgdGFyZ2V0IG11c3QgYmUgYSBwbGFpbiBmaWxlIHdvcmQgXHUyMDE0IGFcbiAqIGZvbGxvd2luZyByZWRpcmVjdCB0b2tlbiAoYGNhdCBmID4gMj4mMWApIGlzIGJhc2gncyBcInN5bnRheCBlcnJvciBuZWFyXG4gKiB1bmV4cGVjdGVkIHRva2VuXCIgYW5kIGxlYXZlcyB0aGUgb3BlcmF0b3IgZGFuZ2xpbmcsIHVubWF0Y2hlZC4gQW55dGhpbmdcbiAqIGVsc2UgYmVnaW5uaW5nIHdpdGggYD5gL2A8YCAobm90YWJseSBgPnxgKSBpcyBsZWZ0IGFsb25lIFx1MjAxNCB0aGUgY2FsbGVyXG4gKiB0cmVhdHMgYSByZXNpZHVhbCByZWRpcmVjdCB3b3JkIGFzIGFuIHVubWF0Y2hlZCBzdGFnZS4gQXBwbGllZCB0byBldmVyeVxuICogc3RhZ2UgXHUyMDE0IHNvdXJjZXMsIHNlbGVjdG9ycywgYW5kIHByZWRpY2F0ZXMgXHUyMDE0IGJlZm9yZSBzdGF0dXMgZXZhbHVhdGlvbiBhbmRcbiAqIG1hdGNoZXIgZGlzcGF0Y2guXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpcFJlZGlyZWN0cyhhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoUkVESVJFQ1RfVFdPX1RPS0VOLnRlc3QoYSkgfHwgSEVSRURPQ19UV09fVE9LRU4udGVzdChhKSkge1xuICAgICAgY29uc3QgbmV4dCA9IGFyZ3ZbaSArIDFdO1xuICAgICAgLy8gVGhlIG9wZXJhdG9yJ3MgdGFyZ2V0IG11c3QgYmUgYSBwbGFpbiBmaWxlIHdvcmQgXHUyMDE0IGEgZm9sbG93aW5nIHJlZGlyZWN0XG4gICAgICAvLyB0b2tlbiBtZWFucyB0aGUgb3BlcmF0b3IgZGFuZ2xlcyBhbmQgdGhlIGNvbW1hbmQgbmV2ZXIgcnVucy4gVGhlXG4gICAgICAvLyBkYW5nbGluZyBvcGVyYXRvciBpdHNlbGYgaXMgbGVmdCBpbiBwbGFjZSBzbyB0aGUgY2FsbGVyIHJlamVjdHMgdGhlXG4gICAgICAvLyBzdGFnZSBhcyB1bm1hdGNoZWQuXG4gICAgICBpZiAobmV4dCAhPT0gdW5kZWZpbmVkICYmICFSRURJUkVDVF9UT0tFTihuZXh0KSkge1xuICAgICAgICBpICs9IDE7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvdXQucHVzaChhKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoUkVESVJFQ1RfRFVQLnRlc3QoYSkgfHwgUkVESVJFQ1RfRlVTRUQudGVzdChhKSB8fCBIRVJFRE9DX0ZVU0VELnRlc3QoYSkpIGNvbnRpbnVlO1xuICAgIG91dC5wdXNoKGEpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBTaGVsbCBidWlsdGlucyB0aGUgd2FsayByZWNvZ25pemVzIGEgYGJ1aWx0aW5gIHdyYXBwZXIgbWF5IGZvcndhcmQgKHBsYW4gXHUwMEE3NSkuICovXG5jb25zdCBXUkFQUEVSX0JVSUxUSU5TID0gbmV3IFNldChbXG4gICdleGl0JyxcbiAgJ2V4ZWMnLFxuICAndHJ1ZScsXG4gICdmYWxzZScsXG4gICc6JyxcbiAgJ2NkJyxcbiAgJ3NldCcsXG4gICd1bnNldCcsXG4gICdleHBvcnQnLFxuICAncmVhZG9ubHknLFxuICAncmV0dXJuJyxcbiAgJ2JyZWFrJyxcbiAgJ2NvbnRpbnVlJ1xuXSk7XG5cbi8qKiBFeHRlcm5hbHMgd2hvc2UgYWJzb2x1dGUgZXhlY3V0YWJsZSBwYXRocyBzdHJpcCB0byB0aGVpciBiYXNlbmFtZSAocGxhbiBcdTAwQTc1KS4gKi9cbmNvbnN0IFJFQ09HTklaRURfRVhURVJOQUxfTkFNRVMgPSBuZXcgU2V0KFtcbiAgJ3NlZCcsXG4gICdoZWFkJyxcbiAgJ3RhaWwnLFxuICAnY2F0JyxcbiAgJ25sJyxcbiAgJ2dpdCcsXG4gICd0cnVlJyxcbiAgJ2ZhbHNlJyxcbiAgJ3RpbWVvdXQnLFxuICAnZW52JyxcbiAgJ2NvbW1hbmQnXG5dKTtcblxuLyoqIEEgYHRpbWVvdXRgIGR1cmF0aW9uIHdvcmQ6IGA1YCwgYDUuNXNgLCBgMW1gLCBgMmhgLCAuLi4gKi9cbmNvbnN0IFRJTUVPVVRfRFVSQVRJT04gPSAvXlxcZCsoPzpcXC5cXGQrKT9bc21oZF0/JC87XG5cbi8qKiBBIGxpdGVyYWwgYE5BTUU9dmFsdWVgIGVudi1wcmVmaXggd29yZC4gKi9cbmNvbnN0IEVOVl9BU1NJR05NRU5UID0gL15bQS1aYS16X11bQS1aYS16MC05X10qPS4qJC87XG5cbi8qKlxuICogT25lIHN0cmlwIHN0ZXAuIFJldHVybnMgbnVsbCB3aGVuIHRoZSB3cmFwcGVyIGlzIG5vdCBjbGVhbiAoZmFpbCBjbG9zZWQgXHUyMDE0XG4gKiB0aGUgY2FsbGVyIHJlc3RvcmVzIHRoZSBvcmlnaW5hbCBhcmd2LCBzbyBub3RoaW5nIGlzIGZvcndhcmRlZCB0byB0aGVcbiAqIG1hdGNoZXJzKSwgb3IgdGhlIGFyZ3Ygd2l0aCBvbmUgd3JhcHBlciBsYXllciByZW1vdmVkLlxuICovXG5mdW5jdGlvbiBzdHJpcFdyYXBwZXJzT25jZShhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2ldID09PSAnIScpIGkrKztcbiAgaWYgKGkgPj0gYXJndi5sZW5ndGgpIHJldHVybiBhcmd2LnNsaWNlKGkpO1xuICBjb25zdCBoZWFkID0gYXJndltpXTtcbiAgaWYgKGhlYWQgPT09ICdjb21tYW5kJykge1xuICAgIGNvbnN0IG5leHQgPSBhcmd2W2kgKyAxXTtcbiAgICBpZiAobmV4dCA9PT0gJy12JyB8fCBuZXh0ID09PSAnLVYnKSByZXR1cm4gbnVsbDsgLy8gYSBxdWVyeSBcdTIwMTQgcnVucyBub3RoaW5nXG4gICAgaWYgKG5leHQgPT09ICctcCcpIHJldHVybiBhcmd2LnNsaWNlKGkgKyAyKTtcbiAgICBpZiAobmV4dCAhPT0gdW5kZWZpbmVkICYmICFuZXh0LnN0YXJ0c1dpdGgoJy0nKSkgcmV0dXJuIGFyZ3Yuc2xpY2UoaSArIDEpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGlmIChoZWFkID09PSAnYnVpbHRpbicpIHtcbiAgICBjb25zdCBuZXh0ID0gYXJndltpICsgMV07XG4gICAgaWYgKG5leHQgIT09IHVuZGVmaW5lZCAmJiBXUkFQUEVSX0JVSUxUSU5TLmhhcyhuZXh0KSkgcmV0dXJuIGFyZ3Yuc2xpY2UoaSArIDIpO1xuICAgIHJldHVybiBudWxsOyAvLyBgYnVpbHRpbiBzZWRgIGVycm9ycyBcdTIwMTQgbmV2ZXIgZm9yd2FyZCBhIG5vbi1idWlsdGluIHdvcmRcbiAgfVxuICBpZiAoaGVhZCA9PT0gJ2VudicpIHtcbiAgICBsZXQgaiA9IGkgKyAxO1xuICAgIHdoaWxlIChqIDwgYXJndi5sZW5ndGggJiYgRU5WX0FTU0lHTk1FTlQudGVzdChhcmd2W2pdKSkgaisrO1xuICAgIGlmIChqID09PSBpICsgMSkgcmV0dXJuIG51bGw7IC8vIGAtaWAsIGAtdSBYYCwgYSBub24tYXNzaWdubWVudCB3b3JkIFx1MjAxNCBub3QgYSBjbGVhbiB3cmFwcGVyXG4gICAgcmV0dXJuIGFyZ3Yuc2xpY2Uoaik7XG4gIH1cbiAgaWYgKGhlYWQgPT09ICd0aW1lb3V0Jykge1xuICAgIGxldCBqID0gaSArIDE7XG4gICAgd2hpbGUgKGogPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2pdLnN0YXJ0c1dpdGgoJy0tJykpIGorKztcbiAgICBpZiAoaiA+PSBhcmd2Lmxlbmd0aCB8fCAhVElNRU9VVF9EVVJBVElPTi50ZXN0KGFyZ3Zbal0pKSByZXR1cm4gbnVsbDsgLy8gbm8gZHVyYXRpb24gXHUyMDE0IG5vdGhpbmcgcnVuc1xuICAgIHJldHVybiBhcmd2LnNsaWNlKGogKyAxKTtcbiAgfVxuICBpZiAoaGVhZC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBjb25zdCBiYXNlID0gaGVhZC5zbGljZShoZWFkLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcbiAgICBpZiAoUkVDT0dOSVpFRF9FWFRFUk5BTF9OQU1FUy5oYXMoYmFzZSkpIHJldHVybiBbYmFzZSwgLi4uYXJndi5zbGljZShpICsgMSldO1xuICAgIHJldHVybiBudWxsOyAvLyBgL3Vzci9iaW4vZXhpdGAgYW5kIGZyaWVuZHMgYXJlIG5vdCByZWNvZ25pemVkIGV4dGVybmFsc1xuICB9XG4gIGlmIChoZWFkLmluY2x1ZGVzKCcvJykpIHJldHVybiBudWxsOyAvLyBhIHJlbGF0aXZlIGNvbGxpZGluZyBwYXRoIGlzIGEgbG9jYWwgYmluYXJ5LCBub3QgdGhlIGNvcmV1dGlsXG4gIHJldHVybiBhcmd2LnNsaWNlKGkpO1xufVxuXG4vKipcbiAqIFN0cmlwIHRyYW5zcGFyZW50IHdyYXBwZXIgcHJlZml4ZXMgZnJvbSBhIHNpbXBsZSBjb21tYW5kJ3MgYXJndiBzbyBtYXRjaGVyXG4gKiBkaXNwYXRjaCBzZWVzIHRoZSB1bmRlcmx5aW5nIGNvbW1hbmQgd29yZCAocGxhbiBcdTAwQTc1KTogYGNvbW1hbmRgIChzdG9wcGluZyBhdFxuICogdGhlIHF1ZXJ5IGZvcm1zIGAtdmAvYC1WYCksIGBidWlsdGluYCByZXN0cmljdGVkIHRvIHRoZSB3YWxrJ3MgcmVjb2duaXplZFxuICogYnVpbHRpbnMsIGBlbnYgTkFNRT12YWx1ZWAgcHJlZml4ZXMsIGB0aW1lb3V0YCBwbHVzIGl0cyBgLS0qYCBmbGFncyBhbmQgb25lXG4gKiBkdXJhdGlvbiwgYW5kIGFic29sdXRlIGV4ZWN1dGFibGUgcGF0aHMgd2hvc2UgYmFzZW5hbWUgaXMgaW4gdGhlIHJlY29nbml6ZWRcbiAqIHNldCBcdTIwMTQgaXRlcmF0aW5nIHVudGlsIGZpeGVkLXBvaW50IHNvIHN0YWNrZWQgd3JhcHBlcnMgc3RpbGwgcmVhY2ggdGhlIHdvcmQuXG4gKiBBbnkgdW5jbGVhbiB3cmFwcGVyIGZhaWxzIGNsb3NlZDogdGhlIG9yaWdpbmFsIGFyZ3YgaXMgcmV0dXJuZWQgdW5jaGFuZ2VkLFxuICogc28gdGhlIHN0YWdlIG1hdGNoZXMgbm90aGluZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0cmlwV3JhcHBlcnMoYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGxldCBjdXJyZW50ID0gYXJndjtcbiAgZm9yIChsZXQgaXRlciA9IDA7IGl0ZXIgPCBhcmd2Lmxlbmd0aCArIDI7IGl0ZXIrKykge1xuICAgIGNvbnN0IG5leHQgPSBzdHJpcFdyYXBwZXJzT25jZShjdXJyZW50KTtcbiAgICBpZiAobmV4dCA9PT0gbnVsbCkgcmV0dXJuIGFyZ3Y7XG4gICAgaWYgKG5leHQubGVuZ3RoID09PSBjdXJyZW50Lmxlbmd0aCAmJiBuZXh0LmV2ZXJ5KCh3LCBrKSA9PiB3ID09PSBjdXJyZW50W2tdKSkgcmV0dXJuIGN1cnJlbnQ7XG4gICAgY3VycmVudCA9IG5leHQ7XG4gIH1cbiAgcmV0dXJuIGFyZ3Y7XG59XG4iLCAiLyoqXG4gKiBWYXJpYWJsZSByZXNvbHV0aW9uIGZvciB0aGUgZXhlY3V0aW9uLWF3YXJlIEJhc2ggdG91Y2ggcGFyc2VyIChwbGFuIFx1MDBBNzcpLlxuICpcbiAqIEV4cGFuc2lvbiBydW5zIG92ZXIgdGhlIHJhdyBzaW1wbGUtY29tbWFuZCB0ZXh0ICpiZWZvcmUqIHRva2VuaXppbmcsIHdpdGggYVxuICogcXVvdGUtYXdhcmUgc2Nhbm5lcjogc2luZ2xlLXF1b3RlZCBzcGFucyBzdGF5IGxpdGVyYWwsIGRvdWJsZS1xdW90ZWQgYW5kXG4gKiB1bnF1b3RlZCBzcGFucyBleHBhbmQgYCRWQVJgIGFuZCBgJHtWQVJ9YCAoZ3JlZWR5IGlkZW50aWZpZXIpLCBhbmQgYVxuICogYmFja3NsYXNoLWVzY2FwZWQgYCRgIHN0YXlzIGxpdGVyYWwuIEV4cGFuZGluZyBiZWZvcmUgdG9rZW5pemluZyBrZWVwcyBhblxuICogZXhwYW5kZWQgdmFsdWUncyBgJiZgL3NwYWNlcyBvdXQgb2YgdGhlIHNwbGl0dGVyJ3MgcmVhY2guIFZhbHVlIHByZWNlZGVuY2VcbiAqIGlzIHNjcmlwdCB2YXJpYWJsZSB0YWJsZSA+IGVudiA+IHVucmVzb2x2ZWQgXHUyMDE0IGEgbmFtZSBhYnNlbnQgZnJvbSBib3RoIGlzXG4gKiBsZWZ0IGFzIHRoZSByZXNpZHVhbCBgJGAsIHdoaWNoIHRyaXBzIHRoZSBwYXJzZXIncyBgbG9va3NVbnJlc29sdmFibGVgIHBhdGhcbiAqIChmYWlsIGNsb3NlZCwgbm8gdG91Y2gpLlxuICpcbiAqIFRoZSBlbnYgaXMgZXhwZWN0ZWQgdG8gYmUgcHJlLWN1cmF0ZWQ6IGBwYXJzZUNvbW1hbmREZXRhaWxlZGAgZ2F0ZXMgaXRzXG4gKiBgcHJvY2Vzcy5lbnZgIGRlZmF1bHQgYnkgYFBhcnNlT3B0aW9ucy5hbGxvd2xpc3RgIChzbyBvbmx5IHRoZVxuICogYERFRkFVTFRfUEFUSF9BTExPV0xJU1RgIG5hbWVzIGV2ZXIgcmVzb2x2ZSBmcm9tIHRoZSBob29rIGVudiksIHdoaWxlIGFuXG4gKiBleHBsaWNpdGx5IGluamVjdGVkIGVudiBcdTIwMTQgYXMgaW4gdGVzdHMgXHUyMDE0IGlzIGNvbnN1bHRlZCB3aG9sZXNhbGUuXG4gKi9cblxuLyoqXG4gKiBUaGUgc2hhcmVkIGFsbG93bGlzdCBvZiBob29rLWVudiB2YXJpYWJsZSBuYW1lcyBwYXRoIGFyZ3VtZW50cyBtYXkgcmVzb2x2ZVxuICogZnJvbSBcdTIwMTQgaWRlbnRpY2FsIGFjcm9zcyBoYXJuZXNzZXMgc28gdGhlIHNhbWUgY29tbWFuZCBzdHJpbmcgcHJvZHVjZXMgdGhlXG4gKiBzYW1lIHRvdWNoZXMgZXZlcnl3aGVyZS4gQW4gYWxsb3dsaXN0ZWQgbmFtZSBhYnNlbnQgZnJvbSBhIHBhcnRpY3VsYXIgaG9va1xuICogZW52IHN0YXlzIHVucmVzb2x2ZWQgKGZhaWwgY2xvc2VkKSwgc28gdGhlIGxpc3QgaXMgc2FmZSB0byBzaGFyZS5cbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUEFUSF9BTExPV0xJU1QgPSBbXG4gICdIT01FJyxcbiAgJ1BXRCcsXG4gICdXT1JLU1BBQ0VfUEFUSCcsXG4gICdDQVJEX1JFUE9fUEFUSCcsXG4gICdSRVBPX1JPT1QnLFxuICAnQkFTRV9CUkFOQ0gnXG5dIGFzIGNvbnN0O1xuXG4vKiogQSBiYXJlIHJlZmVyZW5jZSBuYW1lOiBncmVlZHkgaWRlbnRpZmllciBhZnRlciBgJGAuICovXG5jb25zdCBCQVJFX05BTUUgPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSovO1xuXG4vKiogQSBicmFjZWQgcmVmZXJlbmNlIG11c3QgYmUgZXhhY3RseSBhbiBpZGVudGlmaWVyIFx1MjAxNCBgJHshWH1gLCBgJHtYOi1kfWAsIGAkeyNYfWAgbmV2ZXIgZXhwYW5kLiAqL1xuY29uc3QgQlJBQ0VEX05BTUUgPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSokLztcblxuLyoqXG4gKiBFeHBhbmQgYCRWQVJgIC8gYCR7VkFSfWAgcmVmZXJlbmNlcyBpbiBhIHNpbXBsZSBjb21tYW5kJ3MgcmF3IHRleHQgKHBsYW5cbiAqIFx1MDBBNzcpLiBgJChcdTIwMjYpYCwgYCQoKFx1MjAyNikpYCwgYCR7IVh9YCBpbmRpcmVjdCBleHBhbnNpb24sIGAke1g6XHUyMDI2fWAgb3BlcmF0b3JzLFxuICogc3BlY2lhbCBwYXJhbWV0ZXJzLCBhbmQgdW5rbm93biB2YXJpYWJsZXMgc3RheSB1bnRvdWNoZWQuXG4gKlxuICogQHBhcmFtIHRleHQgVGhlIHJhdyBzaW1wbGUtY29tbWFuZCB0ZXh0LCBiZWZvcmUgdG9rZW5pemluZy5cbiAqIEBwYXJhbSB2YXJpYWJsZXMgVGhlIHNjcmlwdCB2YXJpYWJsZSB0YWJsZSBmcm9tIGV4ZWN1dGVkIG5vbi1waXBlIGFzc2lnbm1lbnRcbiAqICAgc3RhZ2VzLCBpbiBvcmRlciAodGFrZXMgcHJlY2VkZW5jZSBvdmVyIGBlbnZgKS5cbiAqIEBwYXJhbSBlbnYgVGhlIGN1cmF0ZWQgZW52aXJvbm1lbnQgKHRoZSBwYXJzZXIgZ2F0ZXMgaXRzIGBwcm9jZXNzLmVudmBcbiAqICAgZGVmYXVsdCBieSBgREVGQVVMVF9QQVRIX0FMTE9XTElTVGA7IGFuIGluamVjdGVkIGVudiBpcyB1c2VkIHdob2xlc2FsZSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRWYXJpYWJsZXMoXG4gIHRleHQ6IHN0cmluZyxcbiAgdmFyaWFibGVzOiBSZWFkb25seU1hcDxzdHJpbmcsIHN0cmluZz4sXG4gIGVudjogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPlxuKTogc3RyaW5nIHtcbiAgY29uc3QgcmVzb2x2ZSA9IChuYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQgPT4ge1xuICAgIGNvbnN0IGZyb21UYWJsZSA9IHZhcmlhYmxlcy5nZXQobmFtZSk7XG4gICAgaWYgKGZyb21UYWJsZSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gZnJvbVRhYmxlO1xuICAgIGNvbnN0IGZyb21FbnYgPSBlbnZbbmFtZV07XG4gICAgcmV0dXJuIGZyb21FbnYgIT09IHVuZGVmaW5lZCA/IGZyb21FbnYgOiB1bmRlZmluZWQ7XG4gIH07XG5cbiAgbGV0IG91dCA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSB0ZXh0Lmxlbmd0aDtcbiAgbGV0IGluU2luZ2xlID0gZmFsc2U7XG4gIGxldCBpbkRvdWJsZSA9IGZhbHNlO1xuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gdGV4dFtpXTtcbiAgICBpZiAoaW5TaW5nbGUpIHtcbiAgICAgIC8vIFNpbmdsZS1xdW90ZWQgc3BhbnMgYXJlIGZ1bGx5IGxpdGVyYWwgXHUyMDE0IGAkYCBhbmQgYFxcYCBpbmNsdWRlZC5cbiAgICAgIGlmIChjID09PSBcIidcIikgaW5TaW5nbGUgPSBmYWxzZTtcbiAgICAgIG91dCArPSBjO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRvdWJsZSkge1xuICAgICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgICAgaW5Eb3VibGUgPSBmYWxzZTtcbiAgICAgICAgb3V0ICs9IGM7XG4gICAgICAgIGkrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHRleHRbaSArIDFdKSkge1xuICAgICAgICAvLyBJbnNpZGUgZG91YmxlIHF1b3RlcyBiYWNrc2xhc2ggZXNjYXBlcyBgXCJgIGBcXGAgYCRgIGBgIGAgYGAgXHUyMDE0IHRoZVxuICAgICAgICAvLyBlc2NhcGVkIGNoYXJhY3RlciBzdGF5cyBsaXRlcmFsIChubyBleHBhbnNpb24gb2YgYFxcJGApLlxuICAgICAgICBvdXQgKz0gdGV4dFtpICsgMV07XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnKSB7XG4gICAgICAgIG91dCArPSBjO1xuICAgICAgICBpKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICckJykge1xuICAgICAgICBjb25zdCByZWYgPSBleHBhbmRSZWYodGV4dCwgaSwgcmVzb2x2ZSk7XG4gICAgICAgIG91dCArPSByZWYudGV4dDtcbiAgICAgICAgaSA9IHJlZi5uZXh0O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIG91dCArPSBjO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFVucXVvdGVkLlxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TaW5nbGUgPSB0cnVlO1xuICAgICAgb3V0ICs9IGM7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGluRG91YmxlID0gdHJ1ZTtcbiAgICAgIG91dCArPSBjO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcpIHtcbiAgICAgIC8vIEEgYmFja3NsYXNoIGVzY2FwZXMgdGhlIG5leHQgY2hhcmFjdGVyIFx1MjAxNCBgXFwkYCBzdGF5cyBsaXRlcmFsICh0aGVcbiAgICAgIC8vIHRva2VuaXplciByZXNvbHZlcyB0aGUgZXNjYXBlKS5cbiAgICAgIG91dCArPSBjO1xuICAgICAgaWYgKGkgKyAxIDwgbikge1xuICAgICAgICBvdXQgKz0gdGV4dFtpICsgMV07XG4gICAgICAgIGkgKz0gMjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGkrKztcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyQnKSB7XG4gICAgICBjb25zdCByZWYgPSBleHBhbmRSZWYodGV4dCwgaSwgcmVzb2x2ZSk7XG4gICAgICBvdXQgKz0gcmVmLnRleHQ7XG4gICAgICBpID0gcmVmLm5leHQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgb3V0ICs9IGM7XG4gICAgaSsrO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgcmVmZXJlbmNlIHN0YXJ0aW5nIGF0IGB0ZXh0W3N0YXJ0XWAgKGEgYCRgKS4gQSBrbm93biBuYW1lJ3NcbiAqIHZhbHVlIHJlcGxhY2VzIHRoZSB3aG9sZSByZWZlcmVuY2U7IGFueXRoaW5nIGVsc2UgXHUyMDE0IGNvbW1hbmQgc3Vic3RpdHV0aW9uLFxuICogYXJpdGhtZXRpYywgaW5kaXJlY3QgZXhwYW5zaW9uLCBwYXJhbWV0ZXIgb3BlcmF0b3JzLCBzcGVjaWFsIHBhcmFtZXRlcnMsXG4gKiB1bmtub3duIG9yIHVuc2V0IG5hbWVzIFx1MjAxNCBpcyByZXR1cm5lZCB2ZXJiYXRpbSAodGhlIGAkYCBvbmx5KSwgc28gdGhlXG4gKiBjYWxsZXIncyBzY2FuIGNvbnRpbnVlcyBhbmQgdGhlIHJlc2lkdWFsIHRleHQgaXMgdW5jaGFuZ2VkLlxuICovXG5mdW5jdGlvbiBleHBhbmRSZWYoXG4gIHRleHQ6IHN0cmluZyxcbiAgc3RhcnQ6IG51bWJlcixcbiAgcmVzb2x2ZTogKG5hbWU6IHN0cmluZykgPT4gc3RyaW5nIHwgdW5kZWZpbmVkXG4pOiB7IHRleHQ6IHN0cmluZzsgbmV4dDogbnVtYmVyIH0ge1xuICBjb25zdCByZXN0ID0gdGV4dC5zbGljZShzdGFydCArIDEpO1xuICBpZiAocmVzdC5zdGFydHNXaXRoKCcoJykpIHJldHVybiB7IHRleHQ6ICckJywgbmV4dDogc3RhcnQgKyAxIH07IC8vIGAkKFx1MjAyNilgIC8gYCQoKFx1MjAyNikpYCBcdTIwMTQgdW50b3VjaGVkXG4gIGlmIChyZXN0LnN0YXJ0c1dpdGgoJ3snKSkge1xuICAgIGNvbnN0IGNsb3NlID0gdGV4dC5pbmRleE9mKCd9Jywgc3RhcnQgKyAyKTtcbiAgICBpZiAoY2xvc2UgPT09IC0xKSByZXR1cm4geyB0ZXh0OiAnJCcsIG5leHQ6IHN0YXJ0ICsgMSB9OyAvLyB1bnRlcm1pbmF0ZWQgYCQge2AgXHUyMDE0IHVudG91Y2hlZFxuICAgIGNvbnN0IGlubmVyID0gdGV4dC5zbGljZShzdGFydCArIDIsIGNsb3NlKTtcbiAgICBpZiAoQlJBQ0VEX05BTUUudGVzdChpbm5lcikpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcmVzb2x2ZShpbm5lcik7XG4gICAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHsgdGV4dDogdmFsdWUsIG5leHQ6IGNsb3NlICsgMSB9O1xuICAgIH1cbiAgICByZXR1cm4geyB0ZXh0OiAnJCcsIG5leHQ6IHN0YXJ0ICsgMSB9OyAvLyBgJHshWH1gLCBgJHtYOlx1MjAyNn1gLCB1bmtub3duIG5hbWVzIFx1MjAxNCB1bnRvdWNoZWRcbiAgfVxuICBjb25zdCBuYW1lID0gQkFSRV9OQU1FLmV4ZWMocmVzdCk7XG4gIGlmIChuYW1lID09PSBudWxsKSByZXR1cm4geyB0ZXh0OiAnJCcsIG5leHQ6IHN0YXJ0ICsgMSB9OyAvLyBzcGVjaWFsIHBhcmFtZXRlcnMsIGJhcmUgYCRgIFx1MjAxNCB1bnRvdWNoZWRcbiAgY29uc3QgdmFsdWUgPSByZXNvbHZlKG5hbWVbMF0pO1xuICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHsgdGV4dDogdmFsdWUsIG5leHQ6IHN0YXJ0ICsgMSArIG5hbWVbMF0ubGVuZ3RoIH07XG4gIHJldHVybiB7IHRleHQ6ICckJywgbmV4dDogc3RhcnQgKyAxIH07IC8vIHVua25vd24gbmFtZSBcdTIwMTQgdGhlIHJlc2lkdWFsIGAkYCB0cmlwcyBsb29rc1VucmVzb2x2YWJsZVxufVxuIiwgIi8qKlxuICogUmVzcG9uc2UtYXdhcmUgZGVyaXZhdGlvbiBvZiByZWFkLXRvdWNoIHNwYW5zIGZyb20gQmFzaCBgdG9vbF9yZXNwb25zZWBcbiAqIG91dHB1dCwgZm9yIHRoZSBncmVwL3JpcGdyZXAgY29tbWFuZCBmYW1pbGllcyB0aGF0IHBhcnNlLWNvbW1hbmQudHNcbiAqIGRlbGliZXJhdGVseSBjYW5ub3QgY2xhc3NpZnkgZnJvbSBjb21tYW5kIHRleHQgYWxvbmU6IHRoZSB3aW5kb3cgaXMgYW5jaG9yZWRcbiAqIHRvIG1hdGNoIHBvc2l0aW9uLCB3aGljaCBpcyBkYXRhLWRlcGVuZGVudCBhbmQgbGl2ZXMgaW4gdGhlIHJlc3BvbnNlLCBub3RcbiAqIHRoZSBjb21tYW5kLiBwYXJzZVJlc3BvbnNlIGlzIHRoZSBzZWNvbmQgZXZpZGVuY2Ugc291cmNlIHRoZSBDbGF1ZGUgYW5kXG4gKiBDb2RleCBhZGFwdGVycyBtZXJnZSB3aXRoIHBhcnNlQ29tbWFuZCdzIHNwYW5zLlxuICpcbiAqIFRoZSBjb21tb24vIGxheWVyIGNvbnZlbnRpb24gaXMgbG9hZC1iZWFyaW5nOiBtb2R1bGVzIGltcG9ydCBvbmx5IGBub2RlOmBcbiAqIGJ1aWx0aW5zIGFuZCBzaWJsaW5nIG1vZHVsZXMgXHUyMDE0IHplcm8gU0RLIGltcG9ydHMuIEVudmVsb3BlIG5vcm1hbGl6YXRpb25cbiAqIChgdG9vbF9yZXNwb25zZWAgXHUyMTkyIFJlc3BvbnNlUGFyc2VJbnB1dCkgaGFwcGVucyBpbiB0aGUgYWRhcHRlcnMsIHdoaWNoIGhhbmRcbiAqIHRoZSBhbHJlYWR5LW5vcm1hbGl6ZWQgc2hhcGUgZG93biBoZXJlLlxuICpcbiAqIFBoYXNlIDNhIG9mIHRoZSBUREQgYm9vdHN0cmFwIChwbGFucy9pbml0aWFsLm1kKSBpcyBsaXZlOiBjb21tYW5kIGdhdGluZyxcbiAqIHNjb3BlIHJlc3RyaWN0aW9uIGFnYWluc3QgdGhlIGNvbW1hbmQncyBkZWNsYXJlZCByb290cywgQU5TSSByZWplY3Rpb24sIHRoZVxuICogZml2ZSBzZWFyY2gtbGF5b3V0IGRlY29kZXJzLCB3aG9sZS1maWxlIGZhbGxiYWNrLCBhbmQgY29hbGVzY2luZy4gUGhhc2UgM2JcbiAqIGFkZGVkIHRoZSB1bmlmaWVkLWRpZmYgZGVjb2RlciAoYGdpdCBkaWZmYCwgZGlmZi1mb3JtIGBnaXQgc2hvd2AsIGBnaXQgbG9nXG4gKiAtcGApIHdpdGggYmluYXJ5L2NvbWJpbmVkL3N1Ym1vZHVsZSByZWplY3Rpb24sIGFuZCBQaGFzZSAzYyB0aGVcbiAqIGBnaXQgYmxhbWUgLUwgTixNIGZpbGVgIGNvbW1hbmQtdGV4dCBtYXRjaGVyLiBUaGUgZXZhbHVhdGlvbiBmaXhlcyBhZGQgdGhlXG4gKiBkZWNpc2lvbnMgdGhlIHBsYW4ncyByaXNrIHNlY3Rpb24gZGVmZXJyZWQsIGFsbCBkb2N1bWVudGVkIGhlcmU6XG4gKlxuICogLSAqKlRydW5jYXRpb24sIHR3byByZWdpbWVzKiogKHBsYW4gc3RlcCA2KTogYHRydW5jYXRlZDogdHJ1ZWAgKHRoZVxuICogICBhZGFwdGVyJ3MgYHJhd091dHB1dFBhdGhgIHByZXZpZXcgbWFya2VyKSBtZWFucyBwYXJzZSBub3RoaW5nIFx1MjAxNFxuICogICByZXNwb25zZS1kZXJpdmVkIGRlY29kZSBmYWlscyBjbG9zZWQuIGBpbnRlcnJ1cHRlZDogdHJ1ZWAgaXMgdGhlXG4gKiAgIHBsYW4ncyBjb21wbGV0ZS1yZWNvcmRzIHJlZ2ltZTogZnVsbHktdGVybWluYXRlZCByZWNvcmRzIHBhcnNlIGFuZCB0aGVcbiAqICAgaW5jb21wbGV0ZSB0YWlsIGRyb3BzIHZpYSB0aGUgdW5jb25kaXRpb25hbCB0ZXJtaW5hdGluZy1uZXdsaW5lIHJ1bGUsXG4gKiAgIHNvIHRoZSBmbGFnIGNoYW5nZXMgbm90aGluZyB0aGUgZGVmYXVsdCBwYXRoIGFscmVhZHkgZG9lcyBcdTIwMTQgaXQgaXNcbiAqICAgY29udHJhY3QgZG9jdW1lbnRhdGlvbiB0aGUgYWRhcHRlcnMgbWFwIGBpbnRlcnJ1cHRlZGAgb250byAoYSBsYXRlclxuICogICBwaGFzZSBjaGFuZ2VzIHRoZSBhZGFwdGVyczsgdW50aWwgdGhlbiB0aGV5IGNvbGxhcHNlIGl0IGludG9cbiAqICAgYHRydW5jYXRlZGAsIHdoaWNoIGZhaWxzIGNsb3NlZCBzYWZlbHkpLiBOZWl0aGVyIGNvbnRlbnQgZ2F0ZSBhcHBsaWVzXG4gKiAgIHRvIHRoZSBjb21tYW5kLXRleHQtZGVyaXZlZCBgZ2l0IGJsYW1lIC1MIE4sTWAgbWF0Y2hlciwgd2hvc2UgZXZpZGVuY2VcbiAqICAgaXMgdGhlIGNvbW1hbmQsIG5vdCB0aGUgcmVzcG9uc2UgXHUyMDE0IHRoZSBibGFtZSBicmFuY2ggcnVucyBhYm92ZSBib3RoXG4gKiAgIHRoZSBBTlNJIHJlamVjdGlvbiBhbmQgdGhlIHRydW5jYXRlZCBnYXRlLlxuICogLSAqKlNwYW4gY2FwKio6IGBNQVhfUkVTUE9OU0VfU1BBTlNgIGJvdW5kcyBob3cgbWFueSBkaXN0aW5jdCBzcGFucyBhXG4gKiAgIHJlc3BvbnNlIG1heSBlbWl0LiBNZWFzdXJlZCB0aHJvdWdoIHRoZSBkZXBsb3llZCBob29rLCBlYWNoIHNwYW4gY29zdHNcbiAqICAgfjQ2IG1zIG9mIHN1YnByb2Nlc3MgZXhlY3MgaW4gdGhlIHRvdWNoIGNvcmUgKHJlc29sdmVUb3VjaFNjb3BlICsgYGdpdFxuICogICBzcGFuIGxpc3RgIHBlciBzcGFuOyB0aGUgc2Vzc2lvbiBtZW1vIG1ha2VzIHJlcGVhdCBydW5zIGNoZWFwLCBidXQgZmlyc3RcbiAqICAgcnVucyBwYXkgdGhlIGZ1bGwgcHJpY2UpLCBhZ2FpbnN0IGEgMTAgcyBob29rcy5qc29uIHRpbWVvdXQuIDUwIHNwYW5zIFx1MjI0OFxuICogICAyLjMgcyB3b3JzdCBjYXNlIFx1MjAxNCB3ZWxsIHVuZGVyIHRoZSB0aW1lb3V0IHdpdGggbWFyZ2luIGV2ZW4gd2l0aCB0aGVcbiAqICAgY29tbWFuZC1kZXJpdmVkIHNwYW5zIG9uIHRvcC4gQmV5b25kIHRoZSBjYXAgdGhlIGJvdW5kZWQgc2V0IGlzIGVtaXR0ZWRcbiAqICAgKHRoZSBmaXJzdCA1MCBpbiBkZXRlcm1pbmlzdGljIHBhdGggb3JkZXIpIGFuZCB0aGUgcmVzdCBmYWlsIGNsb3NlZDpcbiAqICAgZXZlcnkgZW1pdHRlZCBzcGFuIGlzIGEgZ2VudWluZSBmdWxseS1vYnNlcnZlZCByZWNvcmQsIHNvIGVtaXR0aW5nIHRoZVxuICogICBib3VuZGVkIHNldCBpbnZlbnRzIG5vdGhpbmcsIGFuZCBkcm9wcGluZyB0aGUgZXhjZXNzIGtlZXBzIGhvb2sgbGF0ZW5jeVxuICogICBib3VuZGVkIG9uIGV4YWN0bHkgdGhlIHBhdGhvbG9naWNhbCBzZWFyY2hlcyB0aGF0IHdvdWxkIG90aGVyd2lzZSBzdGFsbFxuICogICB0aGUgYWdlbnQgbG9vcC4gT25lIGNvYWxlc2NlZCBzcGFuIGNvdmVyaW5nIGEgaHVnZSB3aW5kb3cgY291bnRzIG9uY2UuXG4gKiAtICoqUGlwZWxpbmVzKio6IHRoZSByZXNwb25zZSBpcyBhdHRyaWJ1dGVkIHRvIHRoZSBGSVJTVCBnYXRlZCBzdGFnZVxuICogICAobGVmdC10by1yaWdodCB3YWxrOyBpZiBubyBzdGFnZSBnYXRlcywgbm90aGluZyB0byBwYXJzZSkuIEluIGEgcGlwZWxpbmVcbiAqICAgdGhlIGZpbmFsIHN0YWdlJ3Mgc3Rkb3V0IGlzIHRoZSBnYXRlZCBzdGFnZSdzIG91dHB1dCB3aGVuIGV2ZXJ5IGxhdGVyXG4gKiAgIHN0YWdlIGlzIFBST1ZBQkxZIFZFUkJBVElNIFx1MjAxNCB0aGUgYWxsb3dsaXN0IGlzIHRoZSBjbG9zYWJsZSBzZXQ6XG4gKiAgIGhlYWQvdGFpbC93Yy9zb3J0L3VuaXEvY3V0ICh0cnVuY2F0ZS9yZW9yZGVyL2RlZHVwZSBcdTIwMTQgZWFjaCBzdXJ2aXZpbmdcbiAqICAgbGluZSdzIGNvbnRlbnQgaXMgdmVyYmF0aW0pLCBwbGFpbiBgY2F0YCAobm8gYC1uYC9gLS1udW1iZXJgKSwgdGhlIGdyZXBcbiAqICAgZmFtaWx5IHdpdGhvdXQgbnVtYmVyZWQgZXZpZGVuY2UgKGAtbmAvYC0tbGluZS1udW1iZXJgKSBhbmQgd2l0aG91dFxuICogICBmaWxlIG9wZXJhbmRzIGJleW9uZCB0aGUgcGF0dGVybiBzbG90LCBhbmQgdGhlIGV4cHJlc3Npb24tYWxsb3dsaXN0ZWRcbiAqICAgc2VkL2F3ay9wZXJsL3RyIGNhcnZlLW91dHMgKG51bWVyaWMtYWRkcmVzcyBgcGAvYHFgL2BkYCBzY3JpcHRzLFxuICogICBjb25kaXRpb24tb25seSBOUi1jb21wYXJpc29uL3Bhcml0eSBhd2sgcHJvZ3JhbXMsIHN0cmVhbS1wb3NpdGlvblxuICogICBgcHJpbnQgaWYvdW5sZXNzICQuIE4gZGAgcGVybCBzY3JpcHRzLCBhbmQgZGlnaXQvY29sb24vbmV3bGluZS1mcmVlXG4gKiAgIGB0ciAtZGAgZGVsZXRpb25zIFx1MjAxNCBhbGwgcHJvdmFibHkgcGFzcyB3aG9sZSByZWNvcmRzIHRocm91Z2hcbiAqICAgYnl0ZS12ZXJiYXRpbSkuIEV2ZXJ5IGFsbG93bGlzdGVkIHN0YWdlIG11c3QgY2FycnkgTk8gRklMRSBPUEVSQU5EUzogYVxuICogICB0b2tlbiB0aGF0IGlzIG5vdCBhIGZsYWcgbmFtZXMgYSBmaWxlIHRoZSBzdGFnZSByZWFkcyBpbnN0ZWFkIG9mIHRoZVxuICogICBwaXBlLCBzbyB0aGUgcmVzcG9uc2UncyByZWNvcmRzIGNvbWUgZnJvbSB0aGF0IGZpbGUsIG5vdCB0aGUgZ2F0ZWRcbiAqICAgc3RhZ2UsIGFuZCBhIGNyYWZ0ZWQgcmVjb3JkIGRlY29kZXMgYXMgYSBwaGFudG9tIHRvdWNoIFx1MjAxNCB0aGF0IGZvcm1cbiAqICAgZmFpbHMgY2xvc2VkIHdpdGggdGhlIHJlc3QuIFRoZSBzYW1lIHJ1bGUgY292ZXJzIGFuIFVOUVVPVEVEIGA8YCBcdTIwMTQgYVxuICogICBzdGRpbiByZWRpcmVjdCwgc3RhbmRhbG9uZSBvciBHTFVFRCBpbnNpZGUgYSB0b2tlbiAoYGhlYWQgLTI8Y3JhZnRlZC50eHRgLFxuICogICBgZ3JlcCBuZWVkbGU8Y3JhZnRlZC50eHRgLCBhIGNvbnN1bWVkIGAtZWAvYC1mYCB2YWx1ZSkgXHUyMDE0IGJlY2F1c2UgdGhlXG4gKiAgIHN0YWdlIHRoZW4gcmVhZHMgYSBmaWxlIGluc3RlYWQgb2YgdGhlIHBpcGU7IHRoZSBoYXNVbnF1b3RlZFJlZGlyZWN0XG4gKiAgIHNjYW4gaXMgcXVvdGUtYXdhcmUsIHNvIGEgcXVvdGVkIGxpdGVyYWwgYDxgIGluIGEgcGF0dGVyblxuICogICAoYHJnIC1uICc8ZGl2PidgKSBpcyBub3QgYSByZWRpcmVjdC4gQSBgPDxgL2A8PC1gIEhFUkVET0Mgc3RhZ2VcbiAqICAgKGBjYXQgPDwnRU9GJ2ApIHJlYWRzIGl0cyBzdGRpbiBmcm9tIHRoZSBib2R5IHRleHQgXHUyMDE0IGEgY3JhZnRlZCBib2R5IGlzXG4gKiAgIHRoZSBzYW1lIGZhYnJpY2F0ZWQtcmVjb3JkIHNvdXJjZSBhcyBhIGNyYWZ0ZWQgZmlsZSBcdTIwMTQgYW5kIHRoZSBzcGxpdHRlclxuICogICBzdHJpcHMgdGhlIG9wZXJhdG9yIGZyb20gdGhlIHRleHQsIHNvIHRoZSBwZXItc3RhZ2UgYGhlcmVkb2NgIGZsYWdcbiAqICAgZHJpdmVzIHRoZSBzYW1lIGZhaWwtY2xvc2VkIHJ1bGUuIFRoZSB0ZXJtaW5hdGluZy1uZXdsaW5lIHJ1bGUgaGFuZGxlc1xuICogICB0aGUgY3V0LiBFdmVyeXRoaW5nIGVsc2UgZmFpbHMgQ0xPU0VEIFx1MjAxNCB0aGUgZGVmYXVsdCBpcyBpbnZlcnRlZCwgc29cbiAqICAgYW55IHN0YWdlIG5vdCBwcm92YWJseSB2ZXJiYXRpbSAocHl0aG9uLCBydWJ5LCBtYXdrLCBnYXdrLCBwYXN0ZSwgYW5kXG4gKiAgIHRoZSByZXN0IG9mIGFuIHVuYm91bmRlZCByZW51bWJlcmVyIHNldCkgbWF5IHJlbnVtYmVyIG9yIHJld3JpdGUgdGhlXG4gKiAgIHJlY29yZHMsIHRoZSByZXNwb25zZSB0aGVuIGNhcnJpZXMgc3RyZWFtIHBvc2l0aW9ucyBpbnN0ZWFkIG9mIGZpbGVcbiAqICAgbGluZXMsIGFuZCB0aGUgcGlwZWxpbmUgYXR0cmlidXRlcyBub3RoaW5nLlxuICogICBJbiBhIGA7YC9gJiZgL2B8fGAvYCZgL25ld2xpbmUgY2hhaW4gdGhlIHNhbWUgcHJvdmFibHktdmVyYmF0aW0gY2hlY2tcbiAqICAgYXBwbGllcyB0byBFVkVSWSBzaWJsaW5nIHN0YWdlLCBpbiBlaXRoZXIgZGlyZWN0aW9uOiBhIHNpYmxpbmcncyBvdXRwdXRcbiAqICAgbWl4ZXMgaW50byB0aGUgc2FtZSByZXNwb25zZSwgc28gYSBjcmFmdGVkIGZpbGUgcmVhZCBieSBhbnkgb2YgdGhlbVxuICogICBkZWNvZGVzIGFzIHBoYW50b20gdG91Y2hlcyBcdTIwMTQgYSBjaGFpbiBpcyBhdHRyaWJ1dGFibGUgb25seSB3aGVuIGV2ZXJ5XG4gKiAgIHNpYmxpbmcgcGFzc2VzIHRoZSBhbGxvd2xpc3QgKGBjZGAgc3RhZ2VzLCB3aG9zZSBvdXRwdXQgaXMgZW1wdHksXG4gKiAgIGV4Y2VwdGVkKS4gQSBgfGAtam9pbmVkIGZlZWRlciBlYXJsaWVyIGluIHRoZSBwaXBlbGluZSBpcyBjb25zdW1lZCBieVxuICogICB0aGUgZ2F0ZWQgc3RhZ2UgXHUyMDE0IGEgc2VhcmNoIHdpdGggZXhwbGljaXQgcm9vdHMgaWdub3JlcyBzdGRpbiBcdTIwMTQgYW5kIGl0c1xuICogICByZWNvcmRzIG5ldmVyIHJlYWNoIHRoZSByZXNwb25zZTsgaXQgc3RheXMgb3Blbi5cbiAqICAgYGNkYCB0cmFja2luZyBhcHBsaWVzIG9ubHkgdW50aWwgdGhlIGZpcnN0XG4gKiAgIGdhdGVkIHN0YWdlIGlzIGZvdW5kIFx1MjAxNCB0aGUgZXZpZGVuY2Ugd2FzIHByb2R1Y2VkIGluIHRoYXQgZGlyZWN0b3J5LlxuICogLSAqKlN0ZGluLWZlZCBzZWFyY2ggZmFpbHMgY2xvc2VkKio6IGEgbm9uLWdpdCBzZWFyY2ggYmluIChgcmdgL2BncmVwYC9cbiAqICAgYGVncmVwYC9gZmdyZXBgKSB3aXRoIG5vIHBhdGggYXJncyB3aG9zZSBpbnB1dCBpcyBwaXBlZCBvciByZWRpcmVjdGVkXG4gKiAgIChgcHJpbnRmICdcdTIwMjYnIHwgcmcgLW4gbmVlZGxlYCwgYDwgZmlsZWAsIGA8PDxgLCBgPChcdTIwMjYpYCwgYW5kIHRoZSBHTFVFRFxuICogICBmb3JtcyBcdTIwMTQgYHJnIG5lZWRsZTxmaWxlYCwgYGhlYWQgLTI8ZmlsZWAsIGEgY29uc3VtZWQgYC1lYC9gLWZgIHZhbHVlXG4gKiAgIGxpa2UgYC1lIG5lZWRsZTxmaWxlYCBcdTIwMTQgd2hlcmUgdGhlIHJlZGlyZWN0IGlzIGludmlzaWJsZSB0byBhcmd2XG4gKiAgIHNwbGl0dGluZyBhbmQgb25seSB0aGUgcXVvdGUtYXdhcmUgaGFzVW5xdW90ZWRSZWRpcmVjdCBzY2FuIHNlZXMgaXQsIG9yXG4gKiAgIGEgYDw8YC9gPDwtYCBIRVJFRE9DIGJvZHkgXHUyMDE0IHdoZXJlIHRoZSBzcGxpdHRlciBzdHJpcHMgdGhlIG9wZXJhdG9yIGZyb21cbiAqICAgdGhlIHRleHQgYW5kIG9ubHkgdGhlIHBlci1zdGFnZSBgaGVyZWRvY2AgZmxhZyBzZWVzIGl0KSByZWFkcyBTVERJTixcbiAqICAgbm90IGZpbGVzIFx1MjAxNCB0aGUgcmVzcG9uc2UncyByZWNvcmRzIGFyZSBzdHJlYW0gcG9zaXRpb25zLCBhbmQgZGVjb2RpbmdcbiAqICAgdGhlbSBhcyBwYXRocyBmYWJyaWNhdGVzIHRvdWNoZXMgKGEgc3RkaW4gbGluZSBudW1iZXIgbGlrZSBcIjlcIiBiZWNvbWVzXG4gKiAgIGEgcGF0aCwgYW5kIHdpdGggYSByZWFsIGZpbGUgbmFtZWQgYDlgIGF0IHRoZSBjd2QgdGhlIHBoYW50b21cbiAqICAgc3VyZmFjZXMpLlxuICogICBTdWNoIGFuIGludm9jYXRpb24geWllbGRzIG5vIHJlc3BvbnNlLWRlcml2ZWQgc3BhbnMuIEV4cGxpY2l0IHBhdGggYXJnc1xuICogICBtZWFuIHRoZSBiaW4gc2VhcmNoZXMgZmlsZXMgKHRoZSByZWRpcmVjdC9waXBlIGlzIHRoZW4gaXJyZWxldmFudCksIGFuZFxuICogICBgZ2l0IGdyZXBgIG5ldmVyIHJlYWRzIHN0ZGluIFx1MjAxNCBib3RoIHByZXNlcnZlZC4gVGhpcyBpbnZhcmlhbnQgYmluZHMgb25seVxuICogICB0aGUgZGlyZWN0bHktZ2F0ZWQgc3RhZ2U6IHRoZSBhdHRyaWJ1dGlvbiB3YWxrIHN0b3BzIGF0IHRoZSBmaXJzdCBnYXRlZFxuICogICBzdGFnZSwgc28gYW4gdW4tZ2F0ZWQgZmVlZGVyIGVhcmxpZXIgaW4gdGhlIHBpcGVsaW5lIChlLmcuXG4gKiAgIGBmaW5kIHwgeGFyZ3MgcmcgXHUyMDI2YCkgbmV2ZXIgcmVhY2hlcyB0aGUgc3RkaW4gcnVsZSwgYW5kIGl0cyBmZWVkLXNoYXBlXG4gKiAgIGlzIG5vIGV2aWRlbmNlIGFib3V0IHRoZSBzZWFyY2gncyBzdGRpbi5cbiAqIC0gKipEZWNvZGVkIHBhdGhzIG11c3QgYmUgcmVhbCBmaWxlcyoqOiBhcyBhIGZhbWlseS13aWRlIGJhY2tzdG9wLCBhXG4gKiAgIHJlY3Vyc2l2ZS1sYXlvdXQgcmVjb3JkIHdob3NlIGRlY29kZWQgcGF0aCBpcyBub3QgYW4gZXhpc3RpbmcgcmVndWxhclxuICogICBmaWxlICh0aGUgc2FtZSBgaXNGaWxlYCBjaGVjayB0aGUgb25lLWZpbGUgZWxpZ2liaWxpdHkgdXNlcywgcmVzb2x2aW5nXG4gKiAgIGFnYWluc3QgdGhlIHJlY29yZCBiYXNlKSBkcm9wcyBpbnN0ZWFkIG9mIGZhYnJpY2F0aW5nIGEgdG91Y2guXG4gKiAtICoqYGdpdCBzaG93IDxyZXY+OjxwYXRoPmAqKiAocmF3IGJsb2IgY29udGVudCkgaXMgZXhjbHVkZWQgZnJvbSB0aGUgZGlmZlxuICogICBnYXRlOyBhIGRpZmYtc2hhcGVkIGJsb2IgbXVzdCBuZXZlciBkZWNvZGUgaW50byBmYWJyaWNhdGVkIHRvdWNoZXMuIFRoZVxuICogICBjb250ZW50IGlkaW9tIGlzIGRldGVjdGFibGUgZnJvbSB0aGUgY29tbWFuZDogYSBgc2hvd2AgcG9zaXRpb25hbFxuICogICBjb250YWluaW5nIGA6YCBpcyBhIHJldjpwYXRoLCBub3QgYSByZXZpc2lvbi5cbiAqIC0gKipEaWZmIHBhdGhzIGFyZSByZXBvLXJvb3QtcmVsYXRpdmUqKjogZ2l0IGVtaXRzIGBhL3NyYy94LnRzYCBpbiBkaWZmXG4gKiAgIG91dHB1dCByZWdhcmRsZXNzIG9mIGN3ZCwgc28gZGlmZiBkZWNvZGUgYW5jaG9ycyB0byB0aGUgd29ya3RyZWUgcm9vdFxuICogICAoZm91bmQgYnkgd2Fsa2luZyB1cCBmcm9tIHRoZSBlZmZlY3RpdmUgZGlyIGZvciBhIGAuZ2l0YCBlbnRyeSBcdTIwMTQgbm9cbiAqICAgc3VicHJvY2VzcywgdGhlIGNvbW1vbiBsYXllciBpbXBvcnRzIG9ubHkgbm9kZTogYnVpbHRpbnMpLiBUd29cbiAqICAgZXhjZXB0aW9ucyByZS1hbmNob3IgdGhlIG91dHB1dDogYC0tcmVsYXRpdmVgIChiYXJlKSBlbWl0cyBwYXRoc1xuICogICByZWxhdGl2ZSB0byB0aGUgY3dkIGFuZCBleGNsdWRlcyBjaGFuZ2VzIG91dHNpZGUgaXQsIGFuZFxuICogICBgLS1yZWxhdGl2ZT08cGF0aD5gIGVtaXRzIHBhdGhzIHJlbGF0aXZlIHRvIGA8cGF0aD5gIHJlc29sdmVkIGFnYWluc3RcbiAqICAgdGhlIHdvcmt0cmVlIHJvb3QgKHZlcmlmaWVkIGFnYWluc3QgZ2l0IDIuNDcuMykgXHUyMDE0IGJvdGggZGVjb2RlIGFnYWluc3RcbiAqICAgdGhhdCBiYXNlIGluc3RlYWQuIGBnaXQgZGlmZiA8cmV2Pjo8cGF0aD4gPHJldj46PHBhdGg+YCAodHdvLWFyZ1xuICogICBibG9iLWJsb2IpIGVtaXRzIGEgbm9ybWFsIHVuaWZpZWQgZGlmZiBuYW1pbmcgdGhlIGJsb2IgcGF0aHMgd2hpbGUgZ2l0XG4gKiAgIHJlYWRzIG9ubHkgaGlzdG9yaWNhbCBibG9icywgbmV2ZXIgdGhlIHdvcmtpbmctdHJlZSBmaWxlcyBcdTIwMTQgYSBkaWZmXG4gKiAgIHdob3NlIHBvc2l0aW9uYWxzIGNhcnJ5IGByZXY6cGF0aGAgc3BlY3MgKGFueSBgOmAtY29udGFpbmluZyBwb3NpdGlvbmFsXG4gKiAgIHRoYXQgaXMgbm90IGFuIGV4aXN0aW5nIGZpbGUpIGRlY29kZXMgbm90aGluZy5cbiAqIC0gKipVbm51bWJlcmVkIG91dHB1dCBuZXZlciBwYXJzZXMgYXMgbnVtYmVyZWQqKjogdGhlIG9uZS1maWxlIGxheW91dFxuICogICByZXF1aXJlcyBjb21tYW5kLXNpZGUgbnVtYmVyZWQgZXZpZGVuY2UgKGAtbmAvYC0tbGluZS1udW1iZXJgKSwgZXhhY3RseVxuICogICBvbmUgZXhwbGljaXQgZmlsZSBhcmd1bWVudCB0aGF0IGlzIGEgcmVhbCBmaWxlLCBubyBgLUhgXG4gKiAgICgtLXdpdGgtZmlsZW5hbWUsIHdoaWNoIGZvcmNlcyBwYXRoIHByZWZpeGVzKSwgYW5kIGNyb3NzLXJlY29yZFxuICogICBjb25zaXN0ZW5jeSAoZXZlcnkgcmVjb3JkIHBhcnNlcyBhcyBgbGluZTp0ZXh0YCkuIFRoZSBoZWFkaW5nIGxheW91dFxuICogICByZXF1aXJlcyB0aGUgbnVtYmVyZWQgZXZpZGVuY2UgdG9vLiBBIGRpZ2l0cy1sZWFkaW5nIHJlY29yZCB0aGF0IGZhaWxzXG4gKiAgIHRoZXNlIGNoZWNrcyBmYWxscyB0aHJvdWdoIHRvIHRoZSByZWN1cnNpdmUgbGF5b3V0IFx1MjAxNCBhIHB1cmUtZGlnaXRzXG4gKiAgIGZpbGVuYW1lIChcIjlcIiwgXCIxMjNcIikgZW1pdHRlZCBmaXJzdCBtdXN0IG5vdCBjb2xsYXBzZSBhIHdob2xlIHNlYXJjaCB0b1xuICogICB0aGUgb25lLWZpbGUgbGF5b3V0LCBhbmQgY29udGVudCB0aGF0IG1lcmVseSBsb29rcyBudW1iZXJlZCBtdXN0IG5vdFxuICogICBpbnZlbnQgcG9zaXRpb25zLiBHaXQgcGF0aHNwZWMgbWFnaWMgKGA6L2AsIGA6IWAsIGA6XmAsIGA6KC4uLilgKSBpcyBub3RcbiAqICAgYSBmaWxlc3lzdGVtIHBhdGggYW5kIG5ldmVyIGJlY29tZXMgYSBwZXJtaXR0ZWQgcm9vdC4gYGdpdCBncmVwIDxyZXY+YFxuICogICBmdXNlcyB0aGUgcmV2IGludG8gcmVjb3JkIHBhdGhzIChgSEVBRDphLnRzOjM6XHUyMDI2YCk7IHRob3NlIHJlY29yZHMgZHJvcCBhc1xuICogICBwYXRoLWFtYmlndW91cyBcdTIwMTQgZmFpbC1jbG9zZWQgYW5kIGRlZmVuc2libGUsIHNpbmNlIHRoZSByZXYgaXMga25vd24gYnV0XG4gKiAgIHN0cmlwcGluZyBpdCB3b3VsZCBndWVzcyBhdCBhIHBhdGggdGhlIHJlc3BvbnNlIGRvZXMgbm90IGNhcnJ5LlxuICogLSAqKldob2xlLXRyZWUgYGdpdCBncmVwYCBmcm9tIGEgc3ViZGlyIGFuY2hvcnMgdG8gdGhlIHdvcmt0cmVlIHJvb3QqKjpcbiAqICAgcGF0aHNwZWMgbWFnaWMgKGA6L2AsIGA6IWAsIGA6XmAsIGA6KC4uLilgKSBzZWFyY2hlcyB0aGUgd2hvbGUgdHJlZSBhbmRcbiAqICAgZW1pdHMgY3dkLXJlbGF0aXZlIHJlY29yZHMgd2l0aCBgLi4vYCBwcmVmaXhlczsgYC0tZnVsbC1uYW1lYCAodGhlIHJlYWxcbiAqICAgZ2l0IG9wdGlvbiBcdTIwMTQgYC0tZnVsbC10cmVlYCBkb2VzIG5vdCBleGlzdCBvbiBnaXQgMi40Ny4zIGFuZCBlcnJvcnMgd2l0aFxuICogICBhIHVzYWdlIHJlc3BvbnNlIHRoYXQgcGFyc2VzIHRvIG5vdGhpbmcpIHJlLWFuY2hvcnMgcmVjb3JkcyB0b1xuICogICByZXBvLXJvb3QtcmVsYXRpdmUgcGF0aHMuIEJvdGggYW5jaG9yIHRoZSBwZXJtaXR0ZWQgcm9vdCBcdTIwMTQgYW5kLCBmb3JcbiAqICAgYC0tZnVsbC1uYW1lYCwgdGhlIHJlc29sdXRpb24gYmFzZSBcdTIwMTQgdG8gdGhlIHdvcmt0cmVlIHJvb3QsIHNvIGV2ZXJ5XG4gKiAgIGluLXJlcG8gcmVjb3JkIHBhc3NlcyBjb250YWlubWVudC4gUGxhaW4gc3ViZGlyIGBnaXQgZ3JlcGAgKG5vXG4gKiAgIHBhdGhzcGVjKSBpcyBzY29wZWQgdG8gdGhlIHN1YmRpciBieSBnaXQgaXRzZWxmIGFuZCBrZWVwcyB0aGVcbiAqICAgZWZmZWN0aXZlLWRpciByb290LlxuICogLSAqKkNvbnRleHQgcmVjb3JkcyB3aXRoIGRhc2hlcyBpbiB0aGUgcGF0aCoqIGRlY29kZSBieSBhbmNob3JpbmcgdG8gdGhlXG4gKiAgIGV4YWN0IHBhdGhzIHRoZSByZXNwb25zZSdzIGBwYXRoOmxpbmU6dGV4dGAgbWF0Y2ggcmVjb3JkcyBlc3RhYmxpc2gsXG4gKiAgIHdpdGggdGhlIGRhc2ggc3BsaXQgYXMgdGhlIGRhc2gtZnJlZSBmYWxsYmFjayBcdTIwMTQgYSBgLUNgIHdpbmRvdyBvblxuICogICBgc3JjL215LWZpbGUudHNgIG11c3Qgbm90IGNvbGxhcHNlIHRvIHRoZSBiYXJlIG1hdGNoIGxpbmUuXG4gKlxuICogVGhlIGFjY2VwdGFuY2UgY2hlY2tzIGluIHRlc3QvY29tbW9uL3BhcnNlLXJlc3BvbnNlLnRlc3QudHMgd2VyZSB3cml0dGVuXG4gKiBpbiBQaGFzZSAyLlxuICovXG5pbXBvcnQgeyBleGlzdHNTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgZGlybmFtZSwgam9pbiwgcmVzb2x2ZSBhcyByZXNvbHZlUGF0aCwgc2VwIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvdW50RmlsZUxpbmVzIH0gZnJvbSAnLi9jb21tYW5kLXJlc29sdmUuanMnO1xuaW1wb3J0IHR5cGUgeyBSZXNvbHZlZFNwYW4gfSBmcm9tICcuL3BhcnNlLWNvbW1hbmQuanMnO1xuaW1wb3J0IHsgYXJndk9mLCBoYXNVbnF1b3RlZFJlZGlyZWN0LCB0eXBlIE9wZXJhdG9yLCBzcGxpdFRvcExldmVsIH0gZnJvbSAnLi9zaGVsbC1zcGxpdC5qcyc7XG5cbi8qKlxuICogVGhlIG5vcm1hbGl6ZWQgdG9vbC1yZXNwb25zZSBpbnB1dCB0aGUgYWRhcHRlcnMgaGFuZCB0aGUgc2hhcmVkIHBhcnNlci5cbiAqIGBzdGRvdXRgIGlzIHRoZSAocG9zc2libHkgcHJldmlldykgb3V0cHV0IHRleHQ7IGBzdGRlcnJgIGFuZCBgZXhpdFN0YXR1c2BcbiAqIGFyZSBjYXJyaWVkIGZvciBkaWFnbm9zdGljcyBhbmQgYXJlIG5ldmVyIHBhcnNlIGdhdGVzIFx1MjAxNCBgZ2l0IGRpZmZcbiAqIC0tZXhpdC1jb2RlYCBleGl0cyAxIG9uIGRpZmZlcmVuY2VzLCBzbyBleGl0IHN0YXR1cyBtdXN0IG5vdCBiZSB0cmVhdGVkIGFzXG4gKiBmYWlsdXJlLiBQbGFuIHN0ZXAgNidzIHR3byB0cnVuY2F0aW9uIHJlZ2ltZXMgYXJlIGRpc3RpbmN0IGZpZWxkczpcbiAqXG4gKiAtIGB0cnVuY2F0ZWRgIChDbGF1ZGUgYHJhd091dHB1dFBhdGhgIHNldCBcdTIxRDIgaW5saW5lIHN0ZG91dCBpcyBvbmx5IGFcbiAqICAgcHJldmlldykgaXMgc3RyaWN0IG1vZGU6IHJlc3BvbnNlLWRlcml2ZWQgZGVjb2RlIHBhcnNlcyBub3RoaW5nIGFuZFxuICogICBpbnZlbnRzIG5vIHRvdWNoZXMuIFRoZSBjb21tYW5kLXRleHQtZGVyaXZlZCBgZ2l0IGJsYW1lIC1MYCBtYXRjaGVyIGlzXG4gKiAgIGV4ZW1wdCBcdTIwMTQgaXRzIGV2aWRlbmNlIGlzIHRoZSBjb21tYW5kLCBub3QgdGhlIHJlc3BvbnNlLlxuICogLSBgaW50ZXJydXB0ZWRgIGlzIHRoZSBjb21wbGV0ZS1yZWNvcmRzIHJlZ2ltZTogZnVsbHktdGVybWluYXRlZCByZWNvcmRzXG4gKiAgIHBhcnNlIGFuZCB0aGUgaW5jb21wbGV0ZSB0YWlsIGRyb3BzLiBUaGUgdW5jb25kaXRpb25hbCB0ZXJtaW5hdGluZy1cbiAqICAgbmV3bGluZSBydWxlIGFscmVhZHkgZG9lcyBleGFjdGx5IHRoYXQsIHNvIHRoZSBmbGFnIGlzIGNvbnRyYWN0XG4gKiAgIGRvY3VtZW50YXRpb24gdGhlIGFkYXB0ZXJzIG1hcCBgaW50ZXJydXB0ZWQ6IHRydWVgIG9udG87IGl0IG5ldmVyXG4gKiAgIHN1cHByZXNzZXMgYSByZXNwb25zZSB0aGUgZGVmYXVsdCBwYXRoIHdvdWxkIHBhcnNlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlc3BvbnNlUGFyc2VJbnB1dCB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgY3dkOiBzdHJpbmc7XG4gIHN0ZG91dDogc3RyaW5nO1xuICBzdGRlcnI/OiBzdHJpbmc7XG4gIGV4aXRTdGF0dXM/OiBudW1iZXI7IC8vIG1ldGFkYXRhIG9ubHkgXHUyMDE0IG5ldmVyIGdhdGVzIChnaXQgZGlmZiBleGl0cyAxIG9uIGRpZmZlcmVuY2VzKVxuICB0cnVuY2F0ZWQ/OiBib29sZWFuO1xuICBpbnRlcnJ1cHRlZD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogVGhlIG1heGltdW0gbnVtYmVyIG9mIGRpc3RpbmN0IHNwYW5zIGBwYXJzZVJlc3BvbnNlYCBtYXkgZW1pdC4gTWVhc3VyZWRcbiAqIHRocm91Z2ggdGhlIGRlcGxveWVkIGhvb2ssIGVhY2ggc3BhbiBjb3N0cyB+NDYgbXMgb2Ygc3VicHJvY2VzcyBleGVjcyBpblxuICogdGhlIHRvdWNoIGNvcmUgKHJlc29sdmVUb3VjaFNjb3BlICsgYGdpdCBzcGFuIGxpc3RgIHBlciBzcGFuOyB0aGUgc2Vzc2lvblxuICogbWVtbyBtYWtlcyByZXBlYXQgcnVucyBjaGVhcCwgYnV0IGZpcnN0IHJ1bnMgcGF5IHRoZSBmdWxsIHByaWNlKSBhZ2FpbnN0IGFcbiAqIDEwIHMgaG9va3MuanNvbiB0aW1lb3V0IFx1MjAxNCA1MCBzcGFucyBcdTIyNDggMi4zIHMgd29yc3QgY2FzZSwgd2VsbCB1bmRlciB0aGVcbiAqIHRpbWVvdXQgd2l0aCBtYXJnaW4gZXZlbiB3aXRoIHRoZSBjb21tYW5kLWRlcml2ZWQgc3BhbnMgb24gdG9wLiBUaGUgcGxhbidzXG4gKiByaXNrIHNlY3Rpb24gZGVmZXJyZWQgdGhpcyBjYXAgKFwiZmFpbCBjbG9zZWQgYmV5b25kIGl0XCIpIHRvIGEgUGhhc2UgM2FcbiAqIG1lYXN1cmVtZW50OyB0aGUgZ29sZGVuIG1hdHJpeCdzIGxhcmdlc3QgcmVhbGlzdGljIG91dHB1dHMgc3RheSBmYXIgYmVsb3dcbiAqIGl0LCBzbyBpdCBiaW5kcyBvbmx5IHBhdGhvbG9naWNhbCBzZWFyY2hlcy5cbiAqL1xuZXhwb3J0IGNvbnN0IE1BWF9SRVNQT05TRV9TUEFOUyA9IDUwO1xuXG4vKipcbiAqIEEgc2luZ2xlIGRlY29kZWQgc2VhcmNoLW91dHB1dCByZWNvcmQuIFRoZSBwYXRoL2xpbmUgc3BsaXQgaXMgbGF5b3V0LVxuICogZGVwZW5kZW50OiBgcGF0aDpsaW5lOnRleHRgIChyZWN1cnNpdmUpLCBgcGF0aC1saW5lOnRleHRgIChjb250ZXh0IGxpbmVzIGluXG4gKiAtQS8tQi8tQyBncm91cHMgY2Fycnkgbm8gbnVtYmVyIFx1MjAxNCBgbGluZWAgaXMgbnVsbCBhbmQgdGhlIHJlY29yZCBhZHZhbmNlc1xuICogdGhlIHBlci1maWxlIGNvdW50ZXIgaW5zdGVhZCksIGBsaW5lOnRleHRgIChvbmUtZmlsZSBsYXlvdXQpLCBvciBhXG4gKiBOVUwtdGVybWluYXRlZCBgcGF0aDoxOlx1MjAyNmAgcmVjb3JkIChgLXpgKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTZWFyY2hSZWNvcmQge1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBUaGUgcmVjb3JkJ3MgbGluZSBudW1iZXIsIG9yIG51bGwgZm9yIGNvbnRleHQgbGluZXMgd2l0aG91dCBvbmUuICovXG4gIGxpbmU6IG51bWJlciB8IG51bGw7XG4gIHRleHQ6IHN0cmluZztcbn1cblxuLyoqIFRoZSByZWNvZ25pemVkIHNlYXJjaCBvdXRwdXQgbGF5b3V0cyB0aGUgZGVjb2RlcnMgZGlzdGluZ3Vpc2guICovXG5leHBvcnQgdHlwZSBTZWFyY2hMYXlvdXQgPSAncmVjdXJzaXZlJyB8ICdjb250ZXh0JyB8ICdoZWFkaW5nJyB8ICdudWxsLXNlcGFyYXRlZCcgfCAnb25lLWZpbGUnO1xuXG4vKipcbiAqIE9uZSBmaWxlJ3Mgc2VjdGlvbiBvZiBhIHVuaWZpZWQtZGlmZiByZXNwb25zZS4gYG9sZFBhdGhgL2BuZXdQYXRoYCBhcmUgdGhlXG4gKiBgYS9gLWBiL2AtcHJlZml4ZWQgc2lkZXMgd2l0aCB0aGUgcHJlZml4IHN0cmlwcGVkOyBudWxsIGZvciBgL2Rldi9udWxsYFxuICogKG5ldy1maWxlIC8gZGVsZXRlZC1maWxlIHNpZGVzKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEaWZmRmlsZVJlY29yZCB7XG4gIG9sZFBhdGg6IHN0cmluZyB8IG51bGw7XG4gIG5ld1BhdGg6IHN0cmluZyB8IG51bGw7XG4gIC8qKlxuICAgKiBSZW5hbWUvY29weSBtZXRhZGF0YSAoYHJlbmFtZSBmcm9tYC9gcmVuYW1lIHRvYCwgYGNvcHkgZnJvbWAvYGNvcHkgdG9gKTpcbiAgICogdGhlIG5ldyBwYXRoIGlzIHRoZSB0b3VjaCB0YXJnZXQuXG4gICAqL1xuICByZW5hbWU6IHsgZnJvbTogc3RyaW5nOyB0bzogc3RyaW5nIH0gfCBudWxsO1xuICBiaW5hcnk6IGJvb2xlYW47XG4gIGNvbWJpbmVkOiBib29sZWFuO1xuICBzdWJtb2R1bGU6IGJvb2xlYW47XG4gIGh1bmtzOiBEaWZmSHVua1tdO1xufVxuXG4vKipcbiAqIEEgdW5pZmllZC1kaWZmIGh1bmsgaGVhZGVyIChgQEAgLWEsYiArYyxkIEBAYCk7IGFuIG9taXR0ZWQgY291bnQgbWVhbnMgMS5cbiAqIFBlci1zaWRlIHJhbmdlcyBhcmUgYG9sZFN0YXJ0Li5vbGRTdGFydCtvbGRDb3VudC0xYCBvbiB0aGUgb2xkIHBhdGggYW5kXG4gKiBgbmV3U3RhcnQuLm5ld1N0YXJ0K25ld0NvdW50LTFgIG9uIHRoZSBuZXcgcGF0aC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEaWZmSHVuayB7XG4gIG9sZFN0YXJ0OiBudW1iZXI7XG4gIG9sZENvdW50OiBudW1iZXI7XG4gIG5ld1N0YXJ0OiBudW1iZXI7XG4gIG5ld0NvdW50OiBudW1iZXI7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29tbWFuZCBhbmFseXNpc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IFNFQVJDSF9CSU5TID0gbmV3IFNldChbJ3JnJywgJ2dyZXAnLCAnZWdyZXAnLCAnZmdyZXAnXSk7XG5cbi8qKlxuICogU2hvcnQgb3B0aW9ucyB0aGF0IGNvbnN1bWUgYSB2YWx1ZSAocmcvZ3JlcCk6IC1BLy1CLy1DIChjb250ZXh0KSwgLWUvLWZcbiAqIChwYXR0ZXJuL2ZpbGUpLCAtbSAobWF4IGNvdW50KSwgLWcvLXQvLVQgKHJnIHR5cGUvZ2xvYikuIEFueXRoaW5nIGVsc2UgaW4gYVxuICogc2hvcnQgY2x1c3RlciBpcyBhIHBsYWluIGZsYWcuXG4gKi9cbmNvbnN0IFZBTFVFX1NIT1JUX0ZMQUdTID0gbmV3IFNldChbJ0EnLCAnQicsICdDJywgJ2UnLCAnZicsICdtJywgJ2cnLCAndCcsICdUJ10pO1xuXG4vKiogTG9uZyBvcHRpb25zIHRoYXQgY29uc3VtZSBhIHNlcGFyYXRlIHZhbHVlIGFyZ3VtZW50LiAqL1xuY29uc3QgVkFMVUVfTE9OR19GTEFHUyA9IG5ldyBTZXQoW1xuICAnYWZ0ZXItY29udGV4dCcsXG4gICdiZWZvcmUtY29udGV4dCcsXG4gICdjb250ZXh0JyxcbiAgJ21heC1jb3VudCcsXG4gICdyZWdleHAnLFxuICAnZmlsZScsXG4gICdnbG9iJyxcbiAgJ2lnbG9iJyxcbiAgJ3R5cGUnLFxuICAndHlwZS1ub3QnLFxuICAnaW5jbHVkZScsXG4gICdleGNsdWRlJyxcbiAgJ2V4Y2x1ZGUtZGlyJyxcbiAgJ2V4Y2x1ZGUtZnJvbSdcbl0pO1xuXG5mdW5jdGlvbiBoYXNTaGVsbEV4cGFuc2lvbihzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9bJGBdLy50ZXN0KHMpO1xufVxuXG5pbnRlcmZhY2UgU2VhcmNoQXJndkluZm8ge1xuICAvKipcbiAgICogUG9zaXRpb25hbCBwYXRoIGFyZ3M7IGVtcHR5IHdoZW4gdGhlIGNvbW1hbmQgbmFtZWQgbm9uZS4gVGhlIGZpcnN0XG4gICAqIHBvc2l0aW9uYWwgaXMgdGhlIHBhdHRlcm4gdW5sZXNzIHRoZSBwYXR0ZXJuIGNhbWUgZnJvbSBhIGZsYWcgdmFsdWVcbiAgICogKGAtZWAvYC1mYC9gLS1yZWdleHBgL2AtLWZpbGVgKSwgaW4gd2hpY2ggY2FzZSBldmVyeSBwb3NpdGlvbmFsIGlzIGFcbiAgICogcGF0aC5cbiAgICovXG4gIHBhdGhBcmdzOiBzdHJpbmdbXTtcbiAgLyoqIFdoZXRoZXIgLUEvLUIvLUMgKGFueSBjb250ZXh0IHdpbmRvdykgd2FzIHJlcXVlc3RlZC4gKi9cbiAgY29udGV4dEZsYWdzOiBib29sZWFuO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgY29tbWFuZCByZXF1ZXN0ZWQgbGluZSBudW1iZXJzIChgLW5gL2AtLWxpbmUtbnVtYmVyYCkuIHJnIGFuZFxuICAgKiBncmVwIGJvdGggZGVmYXVsdCB0byBOTyBsaW5lIG51bWJlcnMgd2hlbiBwaXBlZCwgc28gdGhpcyBpcyB0aGVcbiAgICogY29tbWFuZC1zaWRlIGV2aWRlbmNlIHRoYXQgYGxpbmU6dGV4dGAtb25seSBvdXRwdXQgaXMgbnVtYmVyZWQgb3V0cHV0IFx1MjAxNFxuICAgKiB0aGUgb25lLWZpbGUgYW5kIGhlYWRpbmcgbGF5b3V0cyByZWZ1c2UgdG8gYXBwbHkgd2l0aG91dCBpdC4gQSBudW1iZXJlZFxuICAgKiBjb21tYW5kIHdob3NlIHJlY29yZHMgYWxsIGZhaWwgdG8gZGVjb2RlIG11c3Qgbm90IGZhbGwgYmFjayB0byBhXG4gICAqIHdob2xlLWZpbGUgc3BhbiBcdTIwMTQgdGhlIHJlY29yZHMgbWF5IGhhdmUgYmVlbiByZW51bWJlcmVkIG9yIGRlc3Ryb3llZCBieSBhXG4gICAqIGxhdGVyIHBpcGVsaW5lIHN0YWdlLlxuICAgKi9cbiAgbnVtYmVyZWQ6IGJvb2xlYW47XG4gIC8qKiBXaGV0aGVyIGAtSGAvYC0td2l0aC1maWxlbmFtZWAgd2FzIHJlcXVlc3RlZCBcdTIwMTQgcmVjb3JkcyBjYXJyeSBwYXRoIHByZWZpeGVzIGV2ZW4gZm9yIGEgc2luZ2xlIGZpbGUuICovXG4gIHdpdGhGaWxlbmFtZTogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFdoZXRoZXIgYW55IHBvc2l0aW9uYWwgd2FzIGdpdCBwYXRoc3BlYyBtYWdpYyAoYDovYCwgYDohYCwgYDpeYCxcbiAgICogYDooLi4uKWApIFx1MjAxNCBhIHdob2xlLXRyZWUgb3IgZXhjbHVzaW9uIHNwZWMsIG5ldmVyIGEgZmlsZXN5c3RlbSByb290LlxuICAgKiBXaGVuIHByZXNlbnQsIGdpdCBncmVwIHNlYXJjaGVzIGJleW9uZCB0aGUgY3dkLCBzbyB0aGUgcGVybWl0dGVkIHJvb3RcbiAgICogYW5jaG9ycyB0byB0aGUgd29ya3RyZWUgcm9vdCBpbnN0ZWFkIG9mIHRoZSBlZmZlY3RpdmUgZGlyLlxuICAgKi9cbiAgcGF0aHNwZWNNYWdpYzogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBzdGRpbiByZWRpcmVjdCAoYDxgLCBgPDw8YCwgYDwoXHUyMDI2YCkgYXBwZWFyczogdGhlIGJpbiByZWFkc1xuICAgKiBTVERJTiwgYW5kIHRoZSB0b2tlbnMgYWZ0ZXIgdGhlIHJlZGlyZWN0IGFyZSBpdHMgdGFyZ2V0cywgbmV2ZXIgc2VhcmNoXG4gICAqIHJvb3RzIFx1MjAxNCB0aGUgcG9zaXRpb25hbCBzY2FuIHN0b3BzIHRoZXJlLlxuICAgKi9cbiAgc3RkaW5SZWRpcmVjdDogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGBwYCBpcyBhIGdpdCBwYXRoc3BlYyBtYWdpYyBwcmVmaXggKGA6L2AsIGA6IWAsIGA6XmAsIGA6KC4uLilgKSBcdTIwMTRcbiAqIGEgbm9uLWZpbGVzeXN0ZW0gcGF0aCBmb3JtIHRoYXQgbXVzdCBuZXZlciBiZWNvbWUgYSBwZXJtaXR0ZWQgcm9vdC4gQVxuICogbGl0ZXJhbCBgY3dkLzovYCByb290IHdvdWxkIHJlamVjdCBldmVyeSBkZWNvZGVkIHJlY29yZDsgdHJlYXRpbmcgcGF0aHNwZWNcbiAqIG1hZ2ljIGxpa2Ugbm8gcGF0aCBhcmdzIGxldHMgcm9vdHMgZmFsbCBiYWNrIHRvIHRoZSBlZmZlY3RpdmUgY3dkLlxuICovXG5mdW5jdGlvbiBpc1BhdGhzcGVjTWFnaWMocDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvXjpbLyFeLihdLy50ZXN0KHApO1xufVxuXG4vKipcbiAqIFNjYW4gYSBzZWFyY2ggY29tbWFuZCdzIGFyZ3YgKHN0YXJ0aW5nIGFmdGVyIHRoZSBiaW5hcnksIG9yIGFmdGVyIHRoZVxuICogYGdyZXBgIHN1YmNvbW1hbmQgZm9yIGdpdCBncmVwKSBmb3IgdGhlIHBvc2l0aW9uYWwgYXJncyBhbmQgY29udGV4dCBmbGFncyxcbiAqIGNvbnN1bWluZyBvcHRpb24gdmFsdWVzIHNvIHRoZXkgYXJlIG5ldmVyIG1pc3Rha2VuIGZvciBwb3NpdGlvbmFscy5cbiAqL1xuZnVuY3Rpb24gYW5hbHl6ZVNlYXJjaEFyZ3YoYXJndjogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBTZWFyY2hBcmd2SW5mbyB7XG4gIGNvbnN0IHBvc2l0aW9uYWxzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY29udGV4dEZsYWdzID0gZmFsc2U7XG4gIGxldCBudW1iZXJlZCA9IGZhbHNlO1xuICBsZXQgd2l0aEZpbGVuYW1lID0gZmFsc2U7XG4gIGxldCBwYXR0ZXJuRnJvbUZsYWcgPSBmYWxzZTtcbiAgbGV0IHN0ZGluUmVkaXJlY3QgPSBmYWxzZTtcbiAgbGV0IGkgPSBzdGFydDtcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBwb3NpdGlvbmFscy5wdXNoKC4uLmFyZ3Yuc2xpY2UoaSArIDEpKTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCc8JykpIHtcbiAgICAgIC8vIEEgc3RkaW4gcmVkaXJlY3QgKGA8YCwgYDw8PGAsIGA8KFx1MjAyNmApOiB0aGUgYmluIHJlYWRzIHN0ZGluLCBhbmQgdGhlXG4gICAgICAvLyBmb2xsb3dpbmcgdG9rZW5zIGFyZSByZWRpcmVjdCB0YXJnZXRzLCBub3Qgc2VhcmNoIHJvb3RzLlxuICAgICAgc3RkaW5SZWRpcmVjdCA9IHRydWU7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLS0nKSkge1xuICAgICAgY29uc3QgZXEgPSBhLmluZGV4T2YoJz0nKTtcbiAgICAgIGNvbnN0IG5hbWUgPSBlcSA9PT0gLTEgPyBhLnNsaWNlKDIpIDogYS5zbGljZSgyLCBlcSk7XG4gICAgICBpZiAobmFtZSA9PT0gJ2FmdGVyLWNvbnRleHQnIHx8IG5hbWUgPT09ICdiZWZvcmUtY29udGV4dCcgfHwgbmFtZSA9PT0gJ2NvbnRleHQnKSBjb250ZXh0RmxhZ3MgPSB0cnVlO1xuICAgICAgaWYgKG5hbWUgPT09ICdsaW5lLW51bWJlcicpIG51bWJlcmVkID0gdHJ1ZTtcbiAgICAgIGlmIChuYW1lID09PSAnd2l0aC1maWxlbmFtZScpIHdpdGhGaWxlbmFtZSA9IHRydWU7XG4gICAgICBpZiAobmFtZSA9PT0gJ3JlZ2V4cCcgfHwgbmFtZSA9PT0gJ2ZpbGUnKSBwYXR0ZXJuRnJvbUZsYWcgPSB0cnVlO1xuICAgICAgaWYgKGVxID09PSAtMSAmJiBWQUxVRV9MT05HX0ZMQUdTLmhhcyhuYW1lKSkge1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSAmJiBhICE9PSAnLScgJiYgYS5sZW5ndGggPiAxKSB7XG4gICAgICBsZXQgY29uc3VtZXNOZXh0ID0gZmFsc2U7XG4gICAgICBmb3IgKGxldCBqID0gMTsgaiA8IGEubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgY29uc3QgYyA9IGFbal07XG4gICAgICAgIGlmIChjID09PSAnQScgfHwgYyA9PT0gJ0InIHx8IGMgPT09ICdDJykgY29udGV4dEZsYWdzID0gdHJ1ZTtcbiAgICAgICAgaWYgKGMgPT09ICduJykgbnVtYmVyZWQgPSB0cnVlO1xuICAgICAgICBpZiAoYyA9PT0gJ0gnKSB3aXRoRmlsZW5hbWUgPSB0cnVlO1xuICAgICAgICBpZiAoYyA9PT0gJ2UnIHx8IGMgPT09ICdmJykgcGF0dGVybkZyb21GbGFnID0gdHJ1ZTtcbiAgICAgICAgaWYgKFZBTFVFX1NIT1JUX0ZMQUdTLmhhcyhjKSkge1xuICAgICAgICAgIC8vIEEgdmFsdWUtdGFraW5nIGZsYWcgY29uc3VtZXMgdGhlIHJlc3Qgb2YgdGhlIGNsdXN0ZXIgYXMgaXRzIHZhbHVlXG4gICAgICAgICAgLy8gKC1DMSkgb3IsIHdoZW4gbGFzdCwgdGhlIG5leHQgYXJndW1lbnQgKC1DIDEpLlxuICAgICAgICAgIGNvbnN1bWVzTmV4dCA9IGogPT09IGEubGVuZ3RoIC0gMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaSArPSBjb25zdW1lc05leHQgPyAyIDogMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBwb3NpdGlvbmFscy5wdXNoKGEpO1xuICAgIGkgKz0gMTtcbiAgfVxuICAvLyBUaGUgZmlyc3QgcG9zaXRpb25hbCBpcyB0aGUgcGF0dGVybiBcdTIwMTQgdW5sZXNzIHRoZSBwYXR0ZXJuIGNhbWUgZnJvbSBhXG4gIC8vIGZsYWcgdmFsdWUgKGAtZWAvYC1mYC9gLS1yZWdleHBgL2AtLWZpbGVgLCBzZXBhcmF0ZSBvciBnbHVlZCksIGluIHdoaWNoXG4gIC8vIGNhc2UgZXZlcnkgcG9zaXRpb25hbCBpcyBhbiBleHBsaWNpdCBzZWFyY2ggcm9vdCwgZXhhY3RseSBhc1xuICAvLyBoYXNHcmVwRmlsZU9wZXJhbmQgdHJlYXRzIGEgZ3JlcC1mYW1pbHkgcGlwZWxpbmUgc3RhZ2UuIEdpdCBwYXRoc3BlY1xuICAvLyBtYWdpYyBpcyBub3QgYSBmaWxlc3lzdGVtIHBhdGggYW5kIG5ldmVyIGJlY29tZXMgYSByb290IFx1MjAxNCBidXQgaXRzXG4gIC8vIHByZXNlbmNlIGlzIHRyYWNrZWQsIGJlY2F1c2UgaXQgbWFrZXMgZ2l0IGdyZXAgc2VhcmNoIHRoZSB3aG9sZSB0cmVlXG4gIC8vIGZyb20gYSBzdWJkaXIuXG4gIGNvbnN0IGZpcnN0UG9zaXRpb25hbCA9IHBhdHRlcm5Gcm9tRmxhZyA/IDAgOiAxO1xuICBjb25zdCBwYXRoQXJncyA9XG4gICAgcG9zaXRpb25hbHMubGVuZ3RoID4gZmlyc3RQb3NpdGlvbmFsID8gcG9zaXRpb25hbHMuc2xpY2UoZmlyc3RQb3NpdGlvbmFsKS5maWx0ZXIoKHApID0+ICFpc1BhdGhzcGVjTWFnaWMocCkpIDogW107XG4gIGNvbnN0IHBhdGhzcGVjTWFnaWMgPVxuICAgIHBvc2l0aW9uYWxzLmxlbmd0aCA+IGZpcnN0UG9zaXRpb25hbCAmJiBwb3NpdGlvbmFscy5zbGljZShmaXJzdFBvc2l0aW9uYWwpLnNvbWUoKHApID0+IGlzUGF0aHNwZWNNYWdpYyhwKSk7XG4gIHJldHVybiB7IHBhdGhBcmdzLCBjb250ZXh0RmxhZ3MsIG51bWJlcmVkLCB3aXRoRmlsZW5hbWUsIHBhdGhzcGVjTWFnaWMsIHN0ZGluUmVkaXJlY3QgfTtcbn1cblxuaW50ZXJmYWNlIEdpdFN1YmNvbW1hbmRJbmZvIHtcbiAgLyoqIFRoZSBgZ2l0IC1DYCBkaXJlY3RvcnksIHdoZW4gcHJlc2VudCBhbmQgc3RhdGljYWxseSByZXNvbHZhYmxlLiAqL1xuICBkaXI6IHN0cmluZyB8IG51bGw7XG4gIGRpclVucmVzb2x2YWJsZTogYm9vbGVhbjtcbiAgLyoqIFRoZSBzdWJjb21tYW5kIHRva2VuIChgZ3JlcGAsIGBkaWZmYCwgYHNob3dgLCBgbG9nYCwgYGJsYW1lYCwgXHUyMDI2KS4gKi9cbiAgc3ViY29tbWFuZDogc3RyaW5nO1xuICAvKiogSW5kZXgganVzdCBwYXN0IHRoZSBzdWJjb21tYW5kLCB3aGVyZSBpdHMgYXJndiBiZWdpbnMuICovXG4gIHN0YXJ0OiBudW1iZXI7XG59XG5cbi8qKlxuICogTG9jYXRlIHRoZSBzdWJjb21tYW5kIHRva2VuIG9mIGEgYGdpdGAgY29tbWFuZCwgaG9ub3JpbmcgYC1DYC9gLWNgIGxpa2VcbiAqIHBhcnNlLWNvbW1hbmQudHMncyBmaW5kR2l0U3ViY29tbWFuZC4gUmV0dXJucyBudWxsIHdoZW4gbm8gc3ViY29tbWFuZFxuICogdG9rZW4gYXBwZWFycyAoYmFyZSBgZ2l0YCkuIFdoaWNoIHN1YmNvbW1hbmRzIHJlc3BvbnNlLWRlY29kZSBpcyB0aGVcbiAqIGdhdGUncyBjYWxsLCBub3QgdGhpcyBzY2FubmVyJ3MuXG4gKi9cbmZ1bmN0aW9uIGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Y6IHN0cmluZ1tdKTogR2l0U3ViY29tbWFuZEluZm8gfCBudWxsIHtcbiAgbGV0IGRpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBkaXJVbnJlc29sdmFibGUgPSBmYWxzZTtcbiAgbGV0IGkgPSAxO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctQycpIHtcbiAgICAgIGNvbnN0IHYgPSBhcmd2W2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgaWYgKGhhc1NoZWxsRXhwYW5zaW9uKHYpKSBkaXJVbnJlc29sdmFibGUgPSB0cnVlO1xuICAgICAgZWxzZSBkaXIgPSB2O1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSB7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcmV0dXJuIHsgZGlyLCBkaXJVbnJlc29sdmFibGUsIHN1YmNvbW1hbmQ6IGEsIHN0YXJ0OiBpICsgMSB9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKiogQSByZXNwb25zZS1kZXJpdmFibGUgY29tbWFuZCB0aGF0IHBhc3NlZCB0aGUgZ2F0ZSwgd2l0aCBpdHMgZGVjb2RlcidzIGlucHV0cy4gKi9cbnR5cGUgR2F0ZWRDb21tYW5kID0ge1xuICBraW5kOiAnc2VhcmNoJyB8ICdkaWZmJyB8ICdibGFtZSc7XG4gIGFyZ3Y6IHN0cmluZ1tdO1xuICAvKiogSW5kZXgganVzdCBwYXN0IHRoZSBiaW5hcnkgKHNlYXJjaCkgb3Igc3ViY29tbWFuZCAoZ2l0KSwgd2hlcmUgaXRzIGFyZ3YgYmVnaW5zLiAqL1xuICBzdGFydDogbnVtYmVyO1xuICAvKiogVGhlIGBnaXQgLUNgIGRpcmVjdG9yeSwgd2hlbiBwcmVzZW50IGFuZCBzdGF0aWNhbGx5IHJlc29sdmFibGUuICovXG4gIGRpcjogc3RyaW5nIHwgbnVsbDtcbiAgZGlyVW5yZXNvbHZhYmxlOiBib29sZWFuO1xufTtcblxuLyoqIFdoZXRoZXIgYSBgZ2l0IGxvZ2AgaW52b2NhdGlvbiBpcyBkaWZmLWZvcm0gKGAtcGAvYC0tcGF0Y2hgIHByZXNlbnQpLiAqL1xuZnVuY3Rpb24gaGFzRGlmZlBhdGNoRmxhZyhhcmd2OiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGFyZ3ZbaV0gPT09ICctcCcgfHwgYXJndltpXSA9PT0gJy0tcGF0Y2gnKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogV2hldGhlciBhIGBnaXQgc2hvd2AgaW52b2NhdGlvbiBpcyB0aGUgYDxyZXY+OjxwYXRoPmAgY29udGVudCBpZGlvbSB3aG9zZVxuICogc3Rkb3V0IGlzIHRoZSBibG9iJ3MgUkFXIGNvbnRlbnQsIG5ldmVyIGRpZmYtZm9ybS4gYGdpdCBzaG93YCBwb3NpdGlvbmFsc1xuICogYXJlIHJldmlzaW9ucywgYW5kIG9ubHkgYSByZXY6cGF0aCBzcGVjIGVtYmVkcyBhIGNvbG9uIFx1MjAxNCBhIGRpZmYtc2hhcGVkXG4gKiB2ZW5kb3JlZCBibG9iIChhIC5wYXRjaCwgYSBmb3JtYXQtcGF0Y2ggYXJjaGl2ZSkgbXVzdCBub3QgZGVjb2RlIGludG9cbiAqIGZhYnJpY2F0ZWQgdG91Y2hlcyBvbiB0aGUgZmlsZXMgaXRzIGNvbnRlbnQgbmFtZXMuIE9wdGlvbiB2YWx1ZXMgYXJlXG4gKiBza2lwcGVkIHNvIGAtLWZvcm1hdCAlSDolc2AgKHdoaWNoIGxlZ2l0aW1hdGVseSBjb250YWlucyBhIGNvbG9uKSBjYW5ub3RcbiAqIGZhbHNlLXBvc2l0aXZlOyBhZnRlciBgLS1gIHRoZSB0b2tlbnMgYXJlIGxpdGVyYWwgcGF0aHNwZWNzLCBub3QgcmV2cy5cbiAqIE9ubHkgZmxhZ3MgdGhhdCBjb25zdW1lIGEgU0VQQVJBVEUgYXJndW1lbnQgc2tpcCB0aGVpciB2YWx1ZTogYC0tc3RhdGAgYW5kXG4gKiBgLS1kaXJzdGF0YCB0YWtlIHRoZWlycyB2aWEgYD1gIChgLS1kaXJzdGF0PWZpbGVzLDEwYCkgb3Igbm90IGF0IGFsbCwgc28gYVxuICogYGdpdCBzaG93IC0tc3RhdCA8cmV2Pjo8cGF0aD5gIG11c3Qgbm90IHN3YWxsb3cgdGhlIHJldjpwYXRoIGFzIGEgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGhhc1JldlBhdGhBcmcoYXJndjogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgdmFsdWVGbGFncyA9IG5ldyBTZXQoWyctLWZvcm1hdCcsICctLXByZXR0eScsICctLW91dHB1dCcsICctLXdvcmQtZGlmZi1yZWdleCddKTtcbiAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLS0nKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpICYmIGEgIT09ICctJykge1xuICAgICAgaWYgKCFhLmluY2x1ZGVzKCc9JykgJiYgdmFsdWVGbGFncy5oYXMoYSkpIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5pbmNsdWRlcygnOicpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgZXhhY3QgbG9uZyBmbGFnIGBmbGFnYCBhcHBlYXJzIGluIHRoZSBjb21tYW5kJ3MgYXJndiAoc3RvcHBpbmdcbiAqIGF0IGAtLWAsIGFmdGVyIHdoaWNoIHRva2VucyBhcmUgbGl0ZXJhbCBwYXRoc3BlY3MsIG5vdCBvcHRpb25zKS4gVXNlZCBmb3JcbiAqIHRoZSBkaWZmIGAtLXJlbGF0aXZlYCBhbmQgZ2l0LWdyZXAgYC0tZnVsbC1uYW1lYCBjYXJ2ZS1vdXRzLlxuICovXG5mdW5jdGlvbiBoYXNGbGFnKGFyZ3Y6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyLCBmbGFnOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLS0nKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGEgPT09IGZsYWcpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgYGdpdCBkaWZmYCBpbnZvY2F0aW9uJ3MgcG9zaXRpb25hbCBhcmd1bWVudHMgY2FycnkgYHJldjpwYXRoYFxuICogc3BlY3MuIGBnaXQgZGlmZiA8cmV2Pjo8cGF0aD4gPHJldj46PHBhdGg+YCBjb21wYXJlcyB0d28gaGlzdG9yaWNhbCBibG9ic1xuICogYW5kIGVtaXRzIGEgbm9ybWFsIHVuaWZpZWQgZGlmZiB3aG9zZSBwYXRocyBuYW1lIHRoZSBibG9iIHBhdGhzLCBub3RcbiAqIHdvcmtpbmctdHJlZSBmaWxlcyBcdTIwMTQgZGVjb2RpbmcgaXQgZmFicmljYXRlcyB0b3VjaGVzIG9uIGEgZmlsZSBnaXQgbmV2ZXJcbiAqIHJlYWQgKHVubGlrZSB0aGUgc2luZ2xlLWFyZyBmb3JtLCB3aGljaCBlcnJvcnMgaW5zdGVhZCBvZiBlbWl0dGluZ1xuICogY29udGVudCkuIEEgcG9zaXRpb25hbCBjb250YWluaW5nIGA6YCBpcyBhIHJldjpwYXRoIHVubGVzcyBhbiBleGlzdGluZ1xuICogZmlsZSBjYXJyaWVzIHRoYXQgbGl0ZXJhbCBuYW1lIChgZ2l0IGRpZmYgLi93ZWlyZDpuYW1lLnRzYCBcdTIwMTQgYSBsaXRlcmFsXG4gKiBjb2xvbiBwYXRoIG5lZWRzIHRoZSBgLi9gIHByZWZpeCB0byBzdXJ2aXZlIGdpdCdzIHJldmlzaW9uIHBhcnNpbmcpO1xuICogYWZ0ZXIgYC0tYCB0aGUgdG9rZW5zIGFyZSBsaXRlcmFsIHBhdGhzcGVjcyBhbmQgdGhlIHNjYW4gc3RvcHMuIEZsYWdzXG4gKiB0aGF0IGNvbnN1bWUgYSBTRVBBUkFURSBhcmd1bWVudCBza2lwIHRoZWlyIHZhbHVlIHNvIGFuIG91dHB1dCBwYXRoXG4gKiBjYW5ub3QgZmFsc2UtcG9zaXRpdmUuXG4gKi9cbmZ1bmN0aW9uIGhhc0RpZmZSZXZQYXRoQXJnKGFyZ3Y6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyLCBjd2Q6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAvLyBWYWx1ZS1jb25zdW1pbmcgZmxhZ3Mgd2hvc2UgU0VQQVJBVEUgdmFsdWUgdG9rZW4gbXVzdCBuZXZlciBiZSBzY2FubmVkXG4gIC8vIGFzIGEgcG9zaXRpb25hbDogYC1MIDxyYW5nZT46PGZpbGU+YCAoZ2l0IGxvZy9ibGFtZSBcdTIwMTQgdGhlIHJhbmdlJ3MgYDpgIGlzXG4gIC8vIGEgbGluZS1yYW5nZSBzZXBhcmF0b3IsIG5vdCBhIHJldjpwYXRoKSwgdGhlIHBpY2theGUgYC1TYC9gLUdgIGFuZCB0aGVcbiAgLy8gbG9nIGZpbHRlcnMgYC0tZ3JlcGAvYC0tYXV0aG9yYC9gLS1jb21taXR0ZXJgLCBhbmQgdGhlIGRhdGUgbGltaXRzXG4gIC8vIGAtLXNpbmNlYC9gLS11bnRpbGAvYC0tYmVmb3JlYC9gLS1hZnRlcmAsIHdob3NlIHNwYWNlLWZvcm0gSVNPIHRpbWVzdGFtcFxuICAvLyB2YWx1ZXMgKGAtLXNpbmNlICcyMDI0LTAxLTAxVDEyOjAwOjAwJ2ApIGNvbnRhaW4gY29sb25zIFx1MjAxNCBhXG4gIC8vIGBnaXQgbG9nIC1wIC1TICc6YXV0aCdgIGFyY2hhZW9sb2d5IGludm9jYXRpb24gaXMgZXhpdC0wIHZhbGlkIGFuZCBpdHNcbiAgLy8gdmFsdWUgdG9rZW4gbXVzdCBub3QgcmVqZWN0IHRoZSB3aG9sZSBkZWNvZGUuIEV4YWN0LXRva2VuIG1lbWJlcnNoaXBcbiAgLy8ga2VlcHMgZ2x1ZWQgZm9ybXMgc2FmZSBieSBjb25zdHJ1Y3Rpb246IGAtUzphdXRoYCBpcyBuZXZlciBpbiB0aGUgc2V0XG4gIC8vIGFuZCBza2lwcyBubyB0b2tlbi5cbiAgY29uc3QgdmFsdWVGbGFncyA9IG5ldyBTZXQoW1xuICAgICctLW91dHB1dCcsXG4gICAgJy0tc3JjLXByZWZpeCcsXG4gICAgJy0tZHN0LXByZWZpeCcsXG4gICAgJy1MJyxcbiAgICAnLVMnLFxuICAgICctRycsXG4gICAgJy0tZ3JlcCcsXG4gICAgJy0tYXV0aG9yJyxcbiAgICAnLS1jb21taXR0ZXInLFxuICAgICctLXNpbmNlJyxcbiAgICAnLS11bnRpbCcsXG4gICAgJy0tYmVmb3JlJyxcbiAgICAnLS1hZnRlcidcbiAgXSk7XG4gIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSAmJiBhICE9PSAnLScpIHtcbiAgICAgIGlmICghYS5pbmNsdWRlcygnPScpICYmIHZhbHVlRmxhZ3MuaGFzKGEpKSBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuaW5jbHVkZXMoJzonKSAmJiAhZXhpc3RzU3luYyhyZXNvbHZlUGF0aChjd2QsIGEpKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIFRoZSBwYXRoIGJhc2UgYGdpdCBkaWZmIC0tcmVsYXRpdmVbPTxwYXRoPl1gIGFuY2hvcnMgaXRzIG91dHB1dCB0bzogbnVsbFxuICogd2hlbiB0aGUgZmxhZyBpcyBhYnNlbnQgKHJlcG8tcm9vdC1yZWxhdGl2ZSBwYXRocyBcdTIwMTQgdGhlIGRlZmF1bHQpOyB0aGVcbiAqIGVmZmVjdGl2ZSBkaXIgZm9yIHRoZSBiYXJlIGZvcm0sIHdob3NlIHBhdGhzIGFyZSBjd2QtcmVsYXRpdmUgYW5kIGV4Y2x1ZGVcbiAqIGNoYW5nZXMgb3V0c2lkZSB0aGUgY3dkOyBvciBgPHBhdGg+YCByZXNvbHZlZCBhZ2FpbnN0IHRoZSB3b3JrdHJlZSByb290XG4gKiBmb3IgdGhlIHZhbHVlIGZvcm0gKHZlcmlmaWVkIGFnYWluc3QgZ2l0IDIuNDcuMyBcdTIwMTQgdGhlIHZhbHVlIGlzXG4gKiByb290LXJlbGF0aXZlLCBub3QgY3dkLXJlbGF0aXZlKS4gYCd1bnJlc29sdmFibGUnYCB3aGVuIHRoZSB2YWx1ZSBmb3JtJ3NcbiAqIHBhdGggY2Fubm90IGJlIHN0YXRpY2FsbHkgcmVzb2x2ZWQgKHNoZWxsIGV4cGFuc2lvbikgb3Igbm8gd29ya3RyZWUgcm9vdFxuICogZXhpc3RzIFx1MjAxNCBmYWlsIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gZGlmZlJlbGF0aXZlQmFzZShcbiAgYXJndjogc3RyaW5nW10sXG4gIHN0YXJ0OiBudW1iZXIsXG4gIGVmZmVjdGl2ZURpcjogc3RyaW5nLFxuICByZXBvUm9vdDogc3RyaW5nIHwgbnVsbFxuKTogeyBiYXNlOiBzdHJpbmc7IHJvb3Q6IHN0cmluZyB9IHwgJ3VucmVzb2x2YWJsZScgfCBudWxsIHtcbiAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLS0nKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoYSA9PT0gJy0tcmVsYXRpdmUnKSByZXR1cm4geyBiYXNlOiBlZmZlY3RpdmVEaXIsIHJvb3Q6IGVmZmVjdGl2ZURpciB9O1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tcmVsYXRpdmU9JykpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gYS5zbGljZSgnLS1yZWxhdGl2ZT0nLmxlbmd0aCk7XG4gICAgICBpZiAocmVwb1Jvb3QgPT09IG51bGwgfHwgaGFzU2hlbGxFeHBhbnNpb24odmFsdWUpIHx8IHZhbHVlID09PSAnJykgcmV0dXJuICd1bnJlc29sdmFibGUnO1xuICAgICAgY29uc3QgYmFzZSA9IHJlc29sdmVQYXRoKHJlcG9Sb290LCB2YWx1ZSk7XG4gICAgICByZXR1cm4geyBiYXNlLCByb290OiBiYXNlIH07XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIFBvc3QtZ2F0ZWQgcGlwZWxpbmUgc3RhZ2VzIHRoYXQgcHJvdmFibHkgb25seSB0cnVuY2F0ZSwgcmVvcmRlciwgb3JcbiAqIGRlZHVwZSB0aGUgZWFybGllciBzdGFnZSdzIHJlY29yZHMgXHUyMDE0IGVhY2ggc3Vydml2aW5nIGxpbmUncyBjb250ZW50IGlzXG4gKiBieXRlLXZlcmJhdGltLCBzbyB0aGUgZGVjb2RlZCBzcGFucyBzdGF5IGdlbnVpbmUuIFRoZSB1bmNvbmRpdGlvbmFsXG4gKiBtZW1iZXJzIG9mIHRoZSBjbG9zYWJsZSBhbGxvd2xpc3QgZm9yIHRoZSBpbnZlcnRlZCBkZWZhdWx0IG9mXG4gKiBpc1JlbnVtYmVyaW5nRmlsdGVyOyB0aGUgY29uZGl0aW9uYWwgY2FydmUtb3V0cyAoc2VkL2F3ay9wZXJsL3RyIHdpdGhcbiAqIGFsbG93bGlzdGVkIHNjcmlwdHMpIGFyZSBoYW5kbGVkIGJ5IHRoZWlyIG93biBzdGFnZSBjaGVja3MgYmVsb3cuIEV2ZXJ5XG4gKiBhbGxvd2xpc3RlZCBzdGFnZSBpcyBhZGRpdGlvbmFsbHkgcmVxdWlyZWQgdG8gY2Fycnkgbm8gZmlsZSBvcGVyYW5kc1xuICogKGhhc0ZpbGVPcGVyYW5kKSBcdTIwMTQgYSB0b2tlbiB0aGF0IGlzIG5vdCBhIGZsYWcgbmFtZXMgYSBmaWxlIHRoZSBzdGFnZVxuICogcmVhZHMgaW5zdGVhZCBvZiB0aGUgcGlwZS5cbiAqL1xuY29uc3QgVkVSQkFUSU1fUEFTU19CSU5TID0gbmV3IFNldChbJ2hlYWQnLCAndGFpbCcsICd3YycsICdzb3J0JywgJ3VuaXEnLCAnY3V0J10pO1xuXG4vKipcbiAqIFdoZXRoZXIgYSBwb3N0LWZpcnN0LWdhdGVkLXN0YWdlIHBpcGVsaW5lIHN0YWdlIHJlbnVtYmVycyBvciByZXN0cnVjdHVyZXNcbiAqIHRoZSBlYXJsaWVyIHN0YWdlJ3MgcmVjb3JkcyBzbyB0aGUgcmVzcG9uc2Ugbm8gbG9uZ2VyIGNhcnJpZXMgdGhlIGZpbGVcbiAqIGxpbmVzIHRoZSBnYXRlZCBzdGFnZSBwcm9kdWNlZC4gVGhlIERFRkFVTFQgSVMgSU5WRVJURUQgKGZhaWwgY2xvc2VkKTpcbiAqIGEgc3RhZ2UgaXMgYWxsb3dlZCBvbmx5IHdoZW4gaXQgaXMgcHJvdmFibHkgdmVyYmF0aW0gXHUyMDE0IHJlbnVtYmVyaW5nIGlzIGFcbiAqIHByb3BlcnR5IG9mIHRoZSBiaW5hcnksIGFuZCB0aGUgcmVudW1iZXJlciBzZXQgKHBlcmwsIHB5dGhvbiwgcnVieSwgbWF3ayxcbiAqIGdhd2ssIG5hd2ssIHRyLCBwYXN0ZSwgXHUyMDI2KSBpcyB1bmJvdW5kZWQsIHNvIGEgZGVueSBsaXN0IGNhbiBuZXZlciBiZVxuICogY2xvc2VkIGFuZCBhbnkgYmluIG91dHNpZGUgdGhlIGFsbG93bGlzdCBpcyB0cmVhdGVkIGFzIGEgcmVudW1iZXJlci5cbiAqIFRoZSBhbGxvd2xpc3QgaXMgcGlwZWxpbmUtc2hhcGUgb25seSAoYSByZW51bWJlcmVkIHJlY29yZCBpcyBieXRlLVxuICogaWRlbnRpY2FsIHRvIGxlZ2l0IG91dHB1dCwgc28gY29udGVudC9yZWNvcmQtc2hhcGUgZGlzY3JpbWluYXRpb24gaXNcbiAqIHVuc291bmQpOiBncmVwL2VncmVwL2ZncmVwL3JnIFdJVEhPVVQgbnVtYmVyZWQgZXZpZGVuY2VcbiAqIChgLW5gL2AtLWxpbmUtbnVtYmVyYCBcdTIwMTQgYSBwbGFpbiBmaWx0ZXIgcGFzc2VzIHJlY29yZHMgdGhyb3VnaCB2ZXJiYXRpbSlcbiAqIGFuZCBXSVRIT1VUIGZpbGUgb3BlcmFuZHMgYmV5b25kIHRoZSBwYXR0ZXJuIHNsb3QsIHBsYWluIGBjYXRgIChub1xuICogYC1uYC9gLS1udW1iZXJgLCBubyBmaWxlIG9wZXJhbmRzKSwgaGVhZC90YWlsL3djL3NvcnQvdW5pcS9jdXRcbiAqICh0cnVuY2F0ZS9yZW9yZGVyL2RlZHVwZSwgbm8gZmlsZSBvcGVyYW5kcyksIGFuZCBgc2VkYC9gYXdrYC9gcGVybGAvYHRyYFxuICogd2hvc2Ugc2NyaXB0L3Byb2dyYW0gcHJvdmFibHkgcGFzc2VzIHdob2xlIHJlY29yZHMgdGhyb3VnaCBieXRlLXZlcmJhdGltXG4gKiAoaXNWZXJiYXRpbVNlZFN0YWdlIC8gaXNWZXJiYXRpbUF3a1N0YWdlIC8gaXNWZXJiYXRpbVBlcmxTdGFnZSAvXG4gKiBpc1ZlcmJhdGltVHJTdGFnZSBcdTIwMTQgbnVtZXJpYy1hZGRyZXNzIGBwYC9gcWAvYGRgIGZvcm1zLCBjb25kaXRpb24tb25seVxuICogTlItY29tcGFyaXNvbi9wYXJpdHkgcHJvZ3JhbXMsIHN0cmVhbS1wb3NpdGlvbiBgcHJpbnQgaWYvdW5sZXNzICQuIE4gZGBcbiAqIHBlcmwgc2NyaXB0cywgYW5kIGRpZ2l0L2NvbG9uL25ld2xpbmUtZnJlZSBgdHIgLWRgIGRlbGV0aW9ucyBvdXRwdXQgdGhlXG4gKiBzYW1lIGJ5dGVzIHRoZSBlYXJsaWVyIHN0YWdlIGVtaXR0ZWQsIHNvIHRoZSBkZWNvZGVkIHNwYW5zIHN0YXlcbiAqIGdlbnVpbmUpLiBBIEZJTEUgT1BFUkFORCBcdTIwMTQgYSB0b2tlbiB0aGF0IGlzIG5vdCBhIGZsYWcgXHUyMDE0IG1ha2VzIHRoZSBzdGFnZVxuICogcmVhZCB0aGF0IGZpbGUgaW5zdGVhZCBvZiB0aGUgcGlwZTogdGhlIHJlc3BvbnNlJ3MgcmVjb3JkcyB0aGVuIGNvbWVcbiAqIGZyb20gdGhlIGZpbGUsIG5vdCB0aGUgZ2F0ZWQgc3RhZ2UsIGFuZCBhIGNyYWZ0ZWQgcmVjb3JkIGRlY29kZXMgYXMgYVxuICogcGhhbnRvbSB0b3VjaCwgc28gZXZlcnkgYWxsb3dsaXN0ZWQgYmluIGZhaWxzIGNsb3NlZCBvbiBmaWxlIG9wZXJhbmRzXG4gKiAodGhlIHNjcmlwdGVkIGJpbnMgYnkgYXJndi1zaGFwZSwgdGhlIHJlc3QgdmlhIGhhc0ZpbGVPcGVyYW5kKS4gYG5sYFxuICogYWx3YXlzIHJlbnVtYmVycy5cbiAqL1xuZnVuY3Rpb24gaXNSZW51bWJlcmluZ0ZpbHRlcihhcmd2OiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBjb25zdCBiaW4gPSBhcmd2WzBdO1xuICBpZiAoYmluID09PSAnbmwnKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKGJpbiA9PT0gJ3NlZCcpIHJldHVybiAhaXNWZXJiYXRpbVNlZFN0YWdlKGFyZ3YpO1xuICBpZiAoYmluID09PSAnYXdrJykgcmV0dXJuICFpc1ZlcmJhdGltQXdrU3RhZ2UoYXJndik7XG4gIGlmIChiaW4gPT09ICdwZXJsJykgcmV0dXJuICFpc1ZlcmJhdGltUGVybFN0YWdlKGFyZ3YpO1xuICBpZiAoYmluID09PSAndHInKSByZXR1cm4gIWlzVmVyYmF0aW1UclN0YWdlKGFyZ3YpO1xuICBpZiAoYmluID09PSAnY2F0Jykge1xuICAgIGlmIChhcmd2LnNvbWUoKGEpID0+IGEgPT09ICctLW51bWJlcicgfHwgKGEuc3RhcnRzV2l0aCgnLScpICYmICFhLnN0YXJ0c1dpdGgoJy0tJykgJiYgYS5pbmNsdWRlcygnbicpKSkpXG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gaGFzRmlsZU9wZXJhbmQoYXJndik7XG4gIH1cbiAgaWYgKFNFQVJDSF9CSU5TLmhhcyhiaW4pKSB7XG4gICAgaWYgKGFyZ3Yuc29tZSgoYSkgPT4gYSA9PT0gJy0tbGluZS1udW1iZXInIHx8IChhLnN0YXJ0c1dpdGgoJy0nKSAmJiAhYS5zdGFydHNXaXRoKCctLScpICYmIGEuaW5jbHVkZXMoJ24nKSkpKVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIGhhc0dyZXBGaWxlT3BlcmFuZChhcmd2KTtcbiAgfVxuICAvLyBUaGUgaW52ZXJ0ZWQgZGVmYXVsdDogYW55IGJpbiBvdXRzaWRlIHRoZSBrbm93bi12ZXJiYXRpbSBhbGxvd2xpc3RcbiAgLy8gKGhlYWQvdGFpbC93Yy9zb3J0L3VuaXEvY3V0KSBmYWlscyBjbG9zZWQgXHUyMDE0IGFuZCB0aGUgYWxsb3dsaXN0IGJpbnNcbiAgLy8gdGhlbXNlbHZlcyBmYWlsIGNsb3NlZCBvbiBmaWxlIG9wZXJhbmRzLlxuICBpZiAoVkVSQkFUSU1fUEFTU19CSU5TLmhhcyhiaW4pKSByZXR1cm4gaGFzRmlsZU9wZXJhbmQoYXJndik7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYW55IGFyZ3YgdG9rZW4gaXMgYSBGSUxFIE9QRVJBTkQgZm9yIGEgc3RhZ2UgdGhhdCBvdGhlcndpc2UgcmVhZHNcbiAqIHRoZSBwaXBlLiBBIHRva2VuIHRoYXQgaXMgbm90IGEgZmxhZyBuYW1lcyBhIGZpbGUgKGFmdGVyIHRoZSBgLS1gXG4gKiB0ZXJtaW5hdG9yIGV2ZXJ5IHRva2VuIGlzIGEgcG9zaXRpb25hbCwgc2luY2Ugb3B0aW9uIHBhcnNpbmcgaGFzIGVuZGVkKTtcbiAqIGAtYCBuYW1lcyBzdGRpbiwgd2hpY2ggaXMgdGhlIHBpcGUgaXRzZWxmLCBhbmQgYC0tYCBpcyBvbmx5IHRoZVxuICogdGVybWluYXRvciBcdTIwMTQgYm90aCBzdGF5IG9wZW4uIEV4YW1wbGU6IGByZyAtbiBuZWVkbGUgZiB8IGhlYWQgLTJgIGNhcnJpZXNcbiAqIG5vIGZpbGUgb3BlcmFuZCBhbmQgcGFzc2VzIHZlcmJhdGltLCBidXQgYHJnIC1uIG5lZWRsZSBmIHwgaGVhZCAtMlxuICogY3JhZnRlZC50eHRgIHJlYWRzIGNyYWZ0ZWQudHh0IGluc3RlYWQgb2YgdGhlIHBpcGUgXHUyMDE0IGl0cyByZWNvcmRzIGFyZSBub3RcbiAqIHRoZSBnYXRlZCBzdGFnZSdzLCBzbyB0aGUgcGlwZWxpbmUgbXVzdCBmYWlsIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gaGFzRmlsZU9wZXJhbmQoYXJndjogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgbGV0IGFmdGVyVGVybWluYXRvciA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMTsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJUZXJtaW5hdG9yID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0nKSBjb250aW51ZTsgLy8gc3RkaW4gXHUyMDE0IHRoZSBwaXBlXG4gICAgaWYgKGFmdGVyVGVybWluYXRvciB8fCAhYS5zdGFydHNXaXRoKCctJykpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgZ3JlcC1mYW1pbHkgc3RhZ2UncyBhcmd2IG5hbWVzIGEgRklMRSBPUEVSQU5EIFx1MjAxNCB0aGUgc3RhZ2UgdGhlblxuICogcmVhZHMgdGhhdCBmaWxlIGluc3RlYWQgb2YgdGhlIHBpcGUuIFdpdGhvdXQgYC1lYC9gLWZgIHRoZSBmaXJzdFxuICogcG9zaXRpb25hbCBpcyB0aGUgUEFUVEVSTiAoYHJnIG5lZWRsZWAvYGdyZXAgbmVlZGxlYCBpbiBhIHBpcGVsaW5lIHJlYWRzXG4gKiBzdGRpbiBhbmQgcGFzc2VzIHJlY29yZHMgdGhyb3VnaCB2ZXJiYXRpbSksIHNvIGEgZmlsZSBvcGVyYW5kIGlzIGFueVxuICogcG9zaXRpb25hbCBCRVlPTkQgdGhlIHBhdHRlcm4gc2xvdDsgd2l0aCB0aGUgcGF0dGVybiBjb21pbmcgZnJvbSBhIGZsYWdcbiAqIHZhbHVlIChgLWUgUEFUYCwgYC1mIFBBVEZJTEVgLCBgLS1yZWdleHBgLCBgLS1maWxlYCwgZ2x1ZWQgYC1lUEFUYCAvXG4gKiBgLWZQQVRGSUxFYCAvIGAtLXJlZ2V4cD1QQVRgIC8gYC0tZmlsZT1QQVRGSUxFYCkgZXZlcnkgcG9zaXRpb25hbCBpcyBhXG4gKiBmaWxlLiBUaGUgdmFsdWVzIGNvbnN1bWVkIGJ5IGAtZWAvYC1mYCBhbmQgdGhlaXIgbG9uZyBmb3JtcyBhcmUgcGF0dGVyblxuICogc291cmNlcyBcdTIwMTQgbmV2ZXIgZmlsZSBvcGVyYW5kcy5cbiAqL1xuZnVuY3Rpb24gaGFzR3JlcEZpbGVPcGVyYW5kKGFyZ3Y6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGxldCBwYXR0ZXJuRnJvbUZsYWcgPSBmYWxzZTtcbiAgbGV0IHNlZW5QYXR0ZXJuID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAxOyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICAvLyBPcHRpb24gcGFyc2luZyBlbmRzOyBldmVyeSByZW1haW5pbmcgdG9rZW4gaXMgYSBwb3NpdGlvbmFsLlxuICAgICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgYXJndi5sZW5ndGg7IGorKykge1xuICAgICAgICBpZiAoIXBhdHRlcm5Gcm9tRmxhZyAmJiAhc2VlblBhdHRlcm4pIHNlZW5QYXR0ZXJuID0gdHJ1ZTtcbiAgICAgICAgZWxzZSByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctZScgfHwgYSA9PT0gJy1mJyB8fCBhID09PSAnLS1yZWdleHAnIHx8IGEgPT09ICctLWZpbGUnKSB7XG4gICAgICBwYXR0ZXJuRnJvbUZsYWcgPSB0cnVlO1xuICAgICAgaSsrOyAvLyBjb25zdW1lIHRoZSB2YWx1ZSB0b2tlbiAodGhlIHBhdHRlcm4gb3IgdGhlIHBhdHRlcm4gZmlsZSlcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tJykpIHtcbiAgICAgICAgaWYgKGEuc3RhcnRzV2l0aCgnLS1yZWdleHA9JykgfHwgYS5zdGFydHNXaXRoKCctLWZpbGU9JykpIHBhdHRlcm5Gcm9tRmxhZyA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKGEubGVuZ3RoID4gMiAmJiAoYVsxXSA9PT0gJ2UnIHx8IGFbMV0gPT09ICdmJykpIHtcbiAgICAgICAgcGF0dGVybkZyb21GbGFnID0gdHJ1ZTsgLy8gZ2x1ZWQgc2hvcnQgdmFsdWUgZm9ybTogLWVQQVQgLyAtZlBBVEZJTEVcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoIXBhdHRlcm5Gcm9tRmxhZyAmJiAhc2VlblBhdHRlcm4pIHNlZW5QYXR0ZXJuID0gdHJ1ZTtcbiAgICBlbHNlIHJldHVybiB0cnVlOyAvLyBhIHBvc2l0aW9uYWwgYmV5b25kIHRoZSBwYXR0ZXJuIGlzIGEgZmlsZSBvcGVyYW5kXG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYHNjcmlwdGAgcHJvdmFibHkgcHJpbnRzIG9yIG9taXRzIHdob2xlIGlucHV0IHJlY29yZHMgYnl0ZS1cbiAqIHZlcmJhdGltIChudW1lcmljIGFkZHJlc3NlcyBvbmx5KS4gV2l0aCBgLW5gIChhdXRvLXByaW50IHN1cHByZXNzZWQpIHRoZVxuICogc2NyaXB0IG11c3QgZXhwbGljaXRseSBwcmludDogYHBgIChzaW5nbGUgcmVjb3JkKSwgYCxwYCAoYSByZWNvcmQgcmFuZ2UpLFxuICogb3IgYCwkcGAgKGEgcmVjb3JkIHRvIHRoZSBlbmQpLiBXaXRob3V0IGAtbmAgdGhlIGRlZmF1bHQgYXV0by1wcmludCBrZWVwc1xuICogcmVjb3JkcyB2ZXJiYXRpbSwgc28gYHFgIChxdWl0IGFmdGVyIGEgcmVjb3JkIFx1MjAxNCBhIHByZWZpeCBjdXQpIGFuZCBgZGBcbiAqIChkZWxldGUgYSBzaW5nbGUgcmVjb3JkIFx1MjAxNCBhIHN1YnNldCBjdXQpIHF1YWxpZnkuIFBhdHRlcm4gYWRkcmVzc2VzIGFuZFxuICogYW55IHJld3JpdGUgY29tbWFuZCAoYHMvLy9gLCBgeS8vL2AsIGA9YCwgYGFgL2BpYC9gY2ApIGNoYW5nZSBvciBpbnNlcnRcbiAqIHJlY29yZCBjb250ZW50IGFuZCBhcmUgbmV2ZXIgYWxsb3dsaXN0ZWQuXG4gKi9cbmZ1bmN0aW9uIGlzVmVyYmF0aW1TZWRTY3JpcHQoc2NyaXB0OiBzdHJpbmcsIHN1cHByZXNzQXV0b1ByaW50OiBib29sZWFuKTogYm9vbGVhbiB7XG4gIGlmIChzdXBwcmVzc0F1dG9QcmludCkge1xuICAgIHJldHVybiAvXlxcZCtwJC8udGVzdChzY3JpcHQpIHx8IC9eXFxkKyxcXGQrcCQvLnRlc3Qoc2NyaXB0KSB8fCAvXlxcZCssXFwkcCQvLnRlc3Qoc2NyaXB0KTtcbiAgfVxuICByZXR1cm4gL15cXGQrcSQvLnRlc3Qoc2NyaXB0KSB8fCAvXlxcZCtkJC8udGVzdChzY3JpcHQpO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBwb3N0LWdhdGVkIGBzZWRgIHN0YWdlJ3Mgd2hvbGUgYXJndiBwcm92YWJseSBwYXNzZXMgdGhlIGVhcmxpZXJcbiAqIHJlY29yZHMgdGhyb3VnaCBieXRlLXZlcmJhdGltLiBUaGUgc2NyaXB0IG11c3QgYmUgdGhlIGZpcnN0IG5vbi1mbGFnXG4gKiBwb3NpdGlvbmFsOyBvbmx5IGAtbmAgbWF5IHByZWNlZGUgaXQsIGFuZCBhbnkgZnVydGhlciBwb3NpdGlvbmFsIChhXG4gKiBzZWNvbmQgc2NyaXB0LCBvciBmaWxlIGFyZ3MgXHUyMDE0IHRoZSBzdGFnZSB0aGVuIHJlYWRzIGZpbGVzLCBub3QgdGhlIHBpcGUpXG4gKiBmYWlscyBjbG9zZWQuIEFueSBvdGhlciBmbGFnIChgLWVgLCBgLWZgLCBgLUVgLCBgLXVgLCBgLXpgLCBcdTIwMjYpIGNoYW5nZXNcbiAqIHNjcmlwdCBzZW1hbnRpY3Mgb3IgcmVjb3JkIHNlcGFyYXRpb24gYW5kIGZhaWxzIGNsb3NlZC4gYDEsMiFkYCBpc1xuICogZGVsaWJlcmF0ZWx5IE5PVCBhbGxvd2xpc3RlZCBcdTIwMTQgYSByYW5nZS1jb21wbGVtZW50IGRlbGV0ZSBoYXBwZW5zIHRvXG4gKiBwcmVzZXJ2ZSByZWNvcmRzLCBidXQgdGhlIGFsbG93bGlzdCBhZG1pdHMgb25seSB0aGUgcHJvdmFibGUgbnVtZXJpY1xuICogZm9ybXMsIHNvIGl0IGZhaWxzIGNsb3NlZCBsaWtlIGV2ZXJ5dGhpbmcgZWxzZS5cbiAqL1xuZnVuY3Rpb24gaXNWZXJiYXRpbVNlZFN0YWdlKGFyZ3Y6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGxldCBzY3JpcHQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgc3VwcHJlc3NBdXRvUHJpbnQgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDE7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctbicpIHtcbiAgICAgIHN1cHByZXNzQXV0b1ByaW50ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgJiYgYSAhPT0gJy0nKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHNjcmlwdCAhPT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICAgIHNjcmlwdCA9IGE7XG4gIH1cbiAgcmV0dXJuIHNjcmlwdCAhPT0gbnVsbCAmJiBpc1ZlcmJhdGltU2VkU2NyaXB0KHNjcmlwdCwgc3VwcHJlc3NBdXRvUHJpbnQpO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBwb3N0LWdhdGVkIGBhd2tgIHN0YWdlJ3MgcHJvZ3JhbSBwcm92YWJseSBzZWxlY3RzIHdob2xlIHJlY29yZHNcbiAqIHdpdGggdGhlIGRlZmF1bHQgcHJpbnQgYWN0aW9uLCBzbyB0aGUgb3V0cHV0IGJ5dGVzIGFyZSB2ZXJiYXRpbS4gVGhlXG4gKiBwcm9ncmFtIG11c3QgYmUgdGhlIHNvbGUgcG9zaXRpb25hbCAobm8gYC1GYC9gLXZgL2AtZmAgZmxhZ3MsIG5vIGZpbGVcbiAqIGFyZ3MpIGFuZCBtYXRjaCBhIGNvbmRpdGlvbi1vbmx5IGZvcm06IGBOUiBPUCBOYCB3aXRoIE9QIGluXG4gKiB7YDxgLCBgPD1gLCBgPmAsIGA+PWAsIGA9PWAsIGAhPWB9IGFnYWluc3QgZGVjaW1hbCBkaWdpdHMgKHJlY29yZC1udW1iZXJcbiAqIHdpbmRvd3MpLCBvciBgTlIgJSBOID09IE1gIC8gYE5SICUgTiAhPSBNYCAocGFyaXR5IHN1YnNldHMpLiBOTyBicmFjZXMsXG4gKiBOTyBhY3Rpb25zLCBOTyBmaWVsZC9yZWNvcmQgcmVmZXJlbmNlcyAoYCRgKSwgTk8gYHByaW50YCwgTk8gYHN1YmAvXG4gKiBgZ3N1YmAgXHUyMDE0IGFueSBvZiB0aG9zZSByZXdyaXRlcyBvciByZW51bWJlcnMgYW5kIGZhaWxzIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gaXNWZXJiYXRpbUF3a1N0YWdlKGFyZ3Y6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGlmIChhcmd2Lmxlbmd0aCAhPT0gMikgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBwcm9ncmFtID0gYXJndlsxXTtcbiAgcmV0dXJuIC9eTlJcXHMqKDw9fD49fD09fCE9fDx8PilcXHMqXFxkKyQvLnRlc3QocHJvZ3JhbSkgfHwgL15OUlxccyolXFxzKlxcZCtcXHMqKD09fCE9KVxccypcXGQrJC8udGVzdChwcm9ncmFtKTtcbn1cblxuLyoqXG4gKiBUaGUgc2NyaXB0IG9mIGEgcG9zdC1nYXRlZCBgcGVybGAgc3RhZ2UncyBhcmd2IHdoZW4gaXRzIGZvcm0gaXMgZXhhY3RseVxuICogYHBlcmwgLW5lIDxzY3JpcHQ+YCBvciBgcGVybCAtbiAtZSA8c2NyaXB0PmAgXHUyMDE0IG5vdGhpbmcgZWxzZS4gQW55IG90aGVyXG4gKiBmbGFnIChgLXBgLCBgLWFgLCBgLUZgLCBcdTIwMjYpIG9yIGFueSBwb3NpdGlvbmFsIGJleW9uZCB0aGUgc2NyaXB0IChmaWxlIGFyZ3NcbiAqIFx1MjAxNCB0aGUgc3RhZ2UgdGhlbiByZWFkcyBmaWxlcywgbm90IHRoZSBwaXBlKSByZXR1cm5zIG51bGwgYW5kIGZhaWxzXG4gKiBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIHZlcmJhdGltUGVybFNjcmlwdChhcmd2OiBzdHJpbmdbXSk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoYXJndi5sZW5ndGggPT09IDMgJiYgYXJndlsxXSA9PT0gJy1uZScpIHJldHVybiBhcmd2WzJdO1xuICBpZiAoYXJndi5sZW5ndGggPT09IDQgJiYgYXJndlsxXSA9PT0gJy1uJyAmJiBhcmd2WzJdID09PSAnLWUnKSByZXR1cm4gYXJndlszXTtcbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogV2hldGhlciBhIHBvc3QtZ2F0ZWQgYHBlcmxgIHN0YWdlIHByb3ZhYmx5IHByaW50cyB3aG9sZSBpbnB1dCByZWNvcmRzXG4gKiBieXRlLXZlcmJhdGltIChzdHJlYW0tcG9zaXRpb24gc2VsZWN0aW9uIG9ubHkpLiBgLW5gIHdyYXBzIHRoZSBzY3JpcHQgaW5cbiAqIGEgbGluZSBsb29wIHdpdGhvdXQgYXV0by1wcmludGluZywgYW5kIHRoZSBzY3JpcHQgbXVzdCBiZSBhIGJhcmUgYHByaW50YFxuICogZ3VhcmRlZCBieSBhIHN0cmVhbS1wb3NpdGlvbiBjb25kaXRpb24gKGBwcmludCBpZiAkLiA8PSAyYCwgYHByaW50IHVubGVzc1xuICogJC4gPiAyYCwgYHByaW50IGlmICQuID09IDJgKSBcdTIwMTQgYmFyZSBgcHJpbnRgIGVtaXRzIGAkX2AgdmVyYmF0aW0gaW5jbHVkaW5nXG4gKiBpdHMgdHJhaWxpbmcgbmV3bGluZSwgc28gcmVjb3JkcyBzdGF5IGNvbXBsZXRlIGZvciB0aGUgdGVybWluYXRpbmctbmV3bGluZVxuICogcnVsZSBhbmQgdGhlaXIgcG9zaXRpb25zIGFyZSBleGFjdGx5IHRoZSBlYXJsaWVyIHN0YWdlJ3MgZmlsZSBsaW5lcy5cbiAqIEFueXRoaW5nIGVsc2UgXHUyMDE0IGluY2x1ZGluZyBgcHJpbnQgXCIkLjokX1wiYCAocmVudW1iZXJzKSwgYC1wYCwgYW55IG90aGVyXG4gKiBleHByZXNzaW9uLCBhbnkgZmlsZSBhcmdzIFx1MjAxNCBmYWlscyBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIGlzVmVyYmF0aW1QZXJsU3RhZ2UoYXJndjogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgY29uc3Qgc2NyaXB0ID0gdmVyYmF0aW1QZXJsU2NyaXB0KGFyZ3YpO1xuICBpZiAoc2NyaXB0ID09PSBudWxsKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiAvXlxccypwcmludFxccysoPzppZnx1bmxlc3MpXFxzK1xcJFxcLlxccyooPD18Pj18PT18IT18PHw+KVxccypcXGQrXFxzKjs/XFxzKiQvLnRlc3Qoc2NyaXB0KTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgcG9zdC1nYXRlZCBgdHJgIHN0YWdlIHByb3ZhYmx5IGRlbGV0ZXMgYSBjaGFyYWN0ZXIgc2V0IHRoYXRcbiAqIGxlYXZlcyB0aGUgZWFybGllciByZWNvcmRzJyBzaGFwZSBhbmQgbGluZSBudW1iZXJzIHVudG91Y2hlZC4gT25seSB0aGVcbiAqIGV4YWN0IGB0ciAtZCA8c2V0PmAgZm9ybSBxdWFsaWZpZXMgKG9uZSBzZXQgdG9rZW4sIG5vIG90aGVyIGZsYWdzLCBub1xuICogZmlsZSBhcmdzKTsgdGhlIHNldCBtdXN0IGNvbnRhaW4gTk9ORSBvZiBgMC05YCAoZGVsZXRpbmcgZGlnaXRzXG4gKiByZW51bWJlcnMpLCBgOmAgKGRlbGV0aW5nIGNvbG9ucyBkZXN0cm95cyB0aGUgcmVjb3JkIHNoYXBlIFx1MjAxNCB0aGlzIGFsc29cbiAqIGJsb2NrcyBgWzpcdTIwMjY6XWAgY2xhc3Mgc3ludGF4KSwgb3IgdGhlIGBcXG5gIGVzY2FwZSAoZGVsZXRpbmcgbmV3bGluZXNcbiAqIG1lcmdlcyByZWNvcmRzKS4gQWxsb3dlZDogYHRyIC1kICdcXHInYCAodGhlIENSTEYgaWRpb20pLCBgdHIgLWQgJyAnYCxcbiAqIGB0ciAtZCAnXFx0XFxyJ2AsIGB0ciAtZCAnYS16J2AuIEFueSBzdWJzdGl0dXRpb24gZm9ybSAoYHRyICcxJyAnOSdgIFx1MjAxNFxuICogcmV3cml0ZXMgZGlnaXRzIGluc2lkZSBsaW5lIG51bWJlcnMpLCBgLXNgL2AtY2AsIG9yIGFueXRoaW5nIGVsc2UgZmFpbHNcbiAqIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gaXNWZXJiYXRpbVRyU3RhZ2UoYXJndjogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgaWYgKGFyZ3YubGVuZ3RoICE9PSAzIHx8IGFyZ3ZbMV0gIT09ICctZCcpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc2V0ID0gYXJndlsyXTtcbiAgcmV0dXJuICEvWzAtOTpdLy50ZXN0KHNldCkgJiYgIXNldC5pbmNsdWRlcygnXFxcXG4nKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMYXlvdXQgZGV0ZWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgbGluZXMgb2YgYHN0ZG91dGAgd2hvc2UgdGVybWluYXRpbmcgbmV3bGluZSBpcyBwcmVzZW50IGluIHRoZSByZXNwb25zZVxuICogdGV4dC4gVGhlIGZpbmFsIHNwbGl0IGVsZW1lbnQgaXMgZWl0aGVyIHRoZSBlbXB0eSBzdHJpbmcgbGVmdCBieSBhIHRyYWlsaW5nXG4gKiBuZXdsaW5lIG9yIGFuIHVudGVybWluYXRlZCBwYXJ0aWFsIHJlY29yZCBcdTIwMTQgZWl0aGVyIHdheSBpdCBpcyBub3QgYSByZWNvcmQsXG4gKiBzbyBpdCBpcyBhbHdheXMgZHJvcHBlZCAodGhlIHVuaXZlcnNhbCB0cnVuY2F0aW9uIHJ1bGUpLlxuICovXG5mdW5jdGlvbiBjb21wbGV0ZUxpbmVzKHN0ZG91dDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsaW5lcyA9IHN0ZG91dC5zcGxpdCgnXFxuJyk7XG4gIGxpbmVzLnBvcCgpO1xuICByZXR1cm4gbGluZXM7XG59XG5cbi8qKlxuICogV2hldGhlciBldmVyeSBub24tZW1wdHkgcmVjb3JkIG9mIGEgYGxpbmU6dGV4dGAgcmVzcG9uc2UgcGFyc2VzIGFzXG4gKiBudW1iZXJlZCBcdTIwMTQgdGhlIGNyb3NzLXJlY29yZCBjb25zaXN0ZW5jeSBjaGVjayB0aGF0IGtlZXBzIG9uZS1maWxlXG4gKiBhdHRyaWJ1dGlvbiBmcm9tIHJlc3Rpbmcgb24gYSBzaW5nbGUgcmVjb3JkJ3Mgc2hhcGUuIEEgYmFyZSBgLS1gIGxpbmUgaXNcbiAqIHRoZSBncm91cCBzZXBhcmF0b3IgYSBjb250ZXh0IHJ1biAoYC1BYC9gLUJgL2AtQ2ApIGVtaXRzIGJldHdlZW5cbiAqIG5vbi1hZGphY2VudCB3aW5kb3dzOiBpdCBpcyBub3QgYSByZWNvcmQgYW5kIGNhbiBuZXZlciBiZWNvbWUgYSB0b3VjaCwgc29cbiAqIHRvbGVyYXRpbmcgaXQgY2Fubm90IGZhYnJpY2F0ZSBcdTIwMTQgd2hpbGUgcmVqZWN0aW5nIGl0IHNlbmRzIHRoZSB3aG9sZVxuICogcmVzcG9uc2UgdG8gbGF5b3V0IG51bGwgKHplcm8gc3BhbnMpIGFuZCwgd29yc2UsIGxldHMgYSB0cnVuY2F0ZWQgcHJlZml4XG4gKiBkZWNvZGUgcmVjb3JkcyB0aGUgY29tcGxldGUgb3V0cHV0IHJlZnVzZXMgKGN1dHRpbmcgbXVzdCBuZXZlciBhZGQpLlxuICovXG5mdW5jdGlvbiByZWNvcmRzQXJlT25lRmlsZShzdGRvdXQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBsaW5lcyA9IGNvbXBsZXRlTGluZXMoc3Rkb3V0KTtcbiAgaWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gbGluZXMuZXZlcnkoKGxpbmUpID0+IGxpbmUgPT09ICcnIHx8IGxpbmUgPT09ICctLScgfHwgcGFyc2VPbmVGaWxlUmVjb3JkKGxpbmUpICE9PSBudWxsKTtcbn1cblxuLyoqXG4gKiBEZWNpZGUgd2hpY2ggc2VhcmNoIGxheW91dCBhIHJlc3BvbnNlIHVzZXMgZnJvbSB0aGUgc2hhcGUgb2YgaXRzIGZpcnN0XG4gKiByZWNvcmQsIGNvbnN1bHRpbmcgdGhlIGNvbW1hbmQncyBjb250ZXh0IGZsYWdzIHRvIGJyZWFrIHRoZSByZWN1cnNpdmUgL1xuICogY29udGV4dCBhbWJpZ3VpdHkgKGJvdGggZW1pdCBgcGF0aDpsaW5lOnRleHRgIG1hdGNoIHJlY29yZHMpLiBGYWlsIGNsb3NlZDpcbiAqIGFuIHVucmVjb2duaXplZCBmaXJzdCByZWNvcmQgbWVhbnMgbm90aGluZyBpbiB0aGlzIHJlc3BvbnNlIGlzIHRydXN0ZWQuXG4gKlxuICogVGhlIGBsaW5lOnRleHRgLW9ubHkgbGF5b3V0cyAob25lLWZpbGUsIGhlYWRpbmcpIHJlcXVpcmUgY29tbWFuZC1zaWRlXG4gKiBudW1iZXJlZCBldmlkZW5jZTogcmcgYW5kIGdyZXAgZGVmYXVsdCB0byBOTyBsaW5lIG51bWJlcnMgd2hlbiBwaXBlZCwgc28gYVxuICogZGlnaXRzLWxlYWRpbmcgcmVjb3JkIHdpdGhvdXQgYC1uYC9gLS1saW5lLW51bWJlcmAgaXMgY29udGVudCwgbm90IGFcbiAqIHBvc2l0aW9uIFx1MjAxNCBgZ3JlcCBUT0RPIG5vdGVzLm1kYCB3aG9zZSBtYXRjaGluZyBsaW5lIGlzIGAxMjM6IFRPRE8gaXRlbWBcbiAqIG11c3Qgbm90IHRvdWNoIGxpbmUgMTIzLCBhbmQgYHJnIC1sIGFscGhhIDIwMjQtbG9nLnR4dGAgbXVzdCBub3QgdG91Y2hcbiAqIGxpbmUgMjAyNC4gVGhlIG9uZS1maWxlIGxheW91dCBhZGRpdGlvbmFsbHkgcmVxdWlyZXMgZXhhY3RseSBvbmUgZXhwbGljaXRcbiAqIGZpbGUgYXJndW1lbnQgdGhhdCBpcyBhIHJlYWwgZmlsZSAoYSBkaXJlY3Rvcnkgb3Igbm8gYXJncyBtZWFucyByZWNvcmRzXG4gKiBjYXJyeSBwYXRoIHByZWZpeGVzIFx1MjAxNCBhIHB1cmUtZGlnaXRzIGZpbGVuYW1lIGVtaXR0ZWQgZmlyc3QgbXVzdCBmYWxsXG4gKiB0aHJvdWdoIHRvIHJlY3Vyc2l2ZSksIG5vIGAtSGAvYC0td2l0aC1maWxlbmFtZWAgKHdoaWNoIGZvcmNlcyBwYXRoXG4gKiBwcmVmaXhlcyksIGFuZCBjcm9zcy1yZWNvcmQgY29uc2lzdGVuY3kgdmlhIGByZWNvcmRzQXJlT25lRmlsZWAuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdExheW91dChzdGRvdXQ6IHN0cmluZywgaW5mbzogU2VhcmNoQXJndkluZm8sIG9uZUZpbGVFbGlnaWJsZTogYm9vbGVhbik6IFNlYXJjaExheW91dCB8IG51bGwge1xuICBpZiAoc3Rkb3V0LmluY2x1ZGVzKCdcXDAnKSkgcmV0dXJuICdudWxsLXNlcGFyYXRlZCc7XG4gIGNvbnN0IGxpbmVzID0gY29tcGxldGVMaW5lcyhzdGRvdXQpO1xuICBjb25zdCBmaXJzdCA9IGxpbmVzLmZpbmQoKGxpbmUpID0+IGxpbmUgIT09ICcnKTtcbiAgaWYgKGZpcnN0ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICBpZiAoL15cXGQrWy06XS8udGVzdChmaXJzdCkpIHtcbiAgICBpZiAob25lRmlsZUVsaWdpYmxlICYmIHJlY29yZHNBcmVPbmVGaWxlKHN0ZG91dCkpIHJldHVybiAnb25lLWZpbGUnO1xuICAgIC8vIE5vdCB0aGUgb25lLWZpbGUgbGF5b3V0OiBmYWxsIHRocm91Z2ggXHUyMDE0IGEgZGlnaXRzLWxlYWRpbmcgcmVjb3JkIGlzXG4gICAgLy8gbW9yZSBwbGF1c2libHkgdGhlIGBwYXRoOmxpbmU6dGV4dGAgcmVjb3JkIG9mIGEgZGlnaXRzLW5hbWVkIGZpbGUsXG4gICAgLy8gd2hpY2ggdGhlIHJlY3Vyc2l2ZSBjaGVja3MgYmVsb3cgcGljayB1cC5cbiAgfVxuICBpZiAoL15bXjpdKzpcXGQrLy50ZXN0KGZpcnN0KSkgcmV0dXJuIGluZm8uY29udGV4dEZsYWdzID8gJ2NvbnRleHQnIDogJ3JlY3Vyc2l2ZSc7XG4gIC8vIEEgY29udGV4dCB3aW5kb3cgY2FuIG9wZW4gd2l0aCBhIGNvbnRleHQgcmVjb3JkIChpdHMgLUIgc2lkZSksIHdob3NlXG4gIC8vIGBwYXRoLWxpbmUtdGV4dGAgc2hhcGUgaXMgYW1iaWd1b3VzIHdoZW4gdGhlIHBhdGggaXRzZWxmIGNvbnRhaW5zIGFcbiAgLy8gZGFzaCBcdTIwMTQgYHNyYy9teS1maWxlLnRzLTItb25lYCBzcGxpdHMgaW5zaWRlIHRoZSBwYXRoLiBFdmVyeSBjb250ZXh0XG4gIC8vIGdyb3VwIGlzIGFuY2hvcmVkIHRvIGEgYHBhdGg6bGluZTp0ZXh0YCBtYXRjaCByZWNvcmQgd2hvc2UgY29sb24gc3BsaXRcbiAgLy8gaXMgdW5hbWJpZ3VvdXMsIHNvIHRoZSByZXNwb25zZSdzIG93biBtYXRjaCByZWNvcmRzIGRldGVjdCB0aGUgbGF5b3V0LlxuICBpZiAoaW5mby5jb250ZXh0RmxhZ3MgJiYgbGluZXMuc29tZSgobGluZSkgPT4gbGluZSAhPT0gJycgJiYgL15bXjpdKzpcXGQrLy50ZXN0KGxpbmUpKSkgcmV0dXJuICdjb250ZXh0JztcbiAgaWYgKC9eW14tOl0rLVxcZCstLy50ZXN0KGZpcnN0KSkgcmV0dXJuIGluZm8uY29udGV4dEZsYWdzID8gJ2NvbnRleHQnIDogbnVsbDtcbiAgaWYgKGluZm8ubnVtYmVyZWQgJiYgL15bXjpdKyQvLnRlc3QoZmlyc3QpKSByZXR1cm4gJ2hlYWRpbmcnO1xuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZWNvcmQgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogU3BsaXQgYSByZWNvcmQgb24gaXRzIGZpcnN0IHR3byBvY2N1cnJlbmNlcyBvZiBgc2VwYCAodGhlIGxheW91dCdzXG4gKiBwYXRoL2xpbmUvdGV4dCBzZXBhcmF0b3JzKSwgc28gc2VwYXJhdG9ycyBpbnNpZGUgdGhlIHRleHQgYXJlIHNhZmUuIEEgcGF0aFxuICogY29udGFpbmluZyBhIGNvbG9uLCBhIG5vbi1udW1lcmljIGxpbmUgdG9rZW4sIG9yIGFuIGVtcHR5IHBhdGggaXNcbiAqIHBhdGgtYW1iaWd1b3VzIGFuZCBkcm9wcGVkLlxuICovXG5mdW5jdGlvbiBwYXJzZVJlY29yZChsaW5lOiBzdHJpbmcsIHNlcDogc3RyaW5nKTogeyBwYXRoOiBzdHJpbmc7IGxpbmU6IG51bWJlcjsgdGV4dDogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgZmlyc3QgPSBsaW5lLmluZGV4T2Yoc2VwKTtcbiAgaWYgKGZpcnN0ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHNlY29uZCA9IGxpbmUuaW5kZXhPZihzZXAsIGZpcnN0ICsgMSk7XG4gIGlmIChzZWNvbmQgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcGF0aCA9IGxpbmUuc2xpY2UoMCwgZmlyc3QpO1xuICBjb25zdCBsaW5lVG9rZW4gPSBsaW5lLnNsaWNlKGZpcnN0ICsgMSwgc2Vjb25kKTtcbiAgY29uc3QgdGV4dCA9IGxpbmUuc2xpY2Uoc2Vjb25kICsgMSk7XG4gIGlmIChwYXRoID09PSAnJyB8fCBwYXRoLmluY2x1ZGVzKCc6JykpIHJldHVybiBudWxsO1xuICBpZiAoIS9eXFxkKyQvLnRlc3QobGluZVRva2VuKSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGxpbmVOdW1iZXIgPSBOdW1iZXIucGFyc2VJbnQobGluZVRva2VuLCAxMCk7XG4gIGlmIChsaW5lTnVtYmVyIDw9IDApIHJldHVybiBudWxsO1xuICByZXR1cm4geyBwYXRoLCBsaW5lOiBsaW5lTnVtYmVyLCB0ZXh0IH07XG59XG5cbi8qKiBPbmUgbnVtYmVyZWQgcmVjb3JkIGluIHRoZSBvbmUtZmlsZS9oZWFkaW5nIGBsaW5lOnRleHRgIG9yIGBsaW5lLXRleHRgIHN0eWxlLiAqL1xuZnVuY3Rpb24gcGFyc2VPbmVGaWxlUmVjb3JkKGxpbmU6IHN0cmluZyk6IHsgbGluZTogbnVtYmVyOyB0ZXh0OiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCBtID0gL14oXFxkKykoWzotXSkvLmV4ZWMobGluZSk7XG4gIGlmIChtID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgbGluZU51bWJlciA9IE51bWJlci5wYXJzZUludChtWzFdLCAxMCk7XG4gIGlmIChsaW5lTnVtYmVyIDw9IDApIHJldHVybiBudWxsO1xuICByZXR1cm4geyBsaW5lOiBsaW5lTnVtYmVyLCB0ZXh0OiBsaW5lLnNsaWNlKG1bMF0ubGVuZ3RoKSB9O1xufVxuXG4vKipcbiAqIERlY29kZSBhIGNvbnRleHQgcmVjb3JkIChgcGF0aC1saW5lLXRleHRgKSBieSBhbmNob3JpbmcgaXQgdG8gdGhlIGV4YWN0XG4gKiBwYXRocyB0aGUgcmVzcG9uc2UncyBgcGF0aDpsaW5lOnRleHRgIG1hdGNoIHJlY29yZHMgZXN0YWJsaXNoZWQ6IHRoZVxuICogcmVjb3JkIG11c3Qgc3RhcnQgd2l0aCBhIGtub3duIHBhdGggZm9sbG93ZWQgYnkgYC1saW5lLXRleHRgLiBMb25nZXN0IHBhdGhcbiAqIGZpcnN0LCBzbyBhIHBhdGggdGhhdCBpcyBhIHByZWZpeCBvZiBhbm90aGVyIChgYS1iLnRzYCB2cyBgYS1iLWMudHNgKVxuICogY2FuJ3Qgc2hhZG93IGl0LiBBIGRhc2ggaW5zaWRlIGEgcGF0aCBtYWtlcyB0aGUgcGxhaW4gZGFzaCBzcGxpdFxuICogYW1iaWd1b3VzIChgc3JjL215LWZpbGUudHMtNC1jdHhgIHNwbGl0cyBpbnNpZGUgdGhlIHBhdGggYW5kIGl0cyBsaW5lXG4gKiB0b2tlbiBjb21lcyBvdXQgbm9uLW51bWVyaWMpLCB3aGljaCBpcyB3aHkgdGhlIGtub3duLXBhdGggYW5jaG9yIGV4aXN0cy5cbiAqL1xuZnVuY3Rpb24gcGFyc2VDb250ZXh0UmVjb3JkKGxpbmU6IHN0cmluZywga25vd25QYXRoczogc3RyaW5nW10pOiB7IHBhdGg6IHN0cmluZzsgbGluZTogbnVtYmVyOyB0ZXh0OiBzdHJpbmcgfSB8IG51bGwge1xuICBmb3IgKGNvbnN0IHBhdGggb2Yga25vd25QYXRocykge1xuICAgIGlmICghbGluZS5zdGFydHNXaXRoKGAke3BhdGh9LWApKSBjb250aW51ZTtcbiAgICBjb25zdCB0YWlsID0gbGluZS5zbGljZShwYXRoLmxlbmd0aCArIDEpO1xuICAgIGNvbnN0IG0gPSAvXihcXGQrKS0vLmV4ZWModGFpbCk7XG4gICAgaWYgKG0gPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGxpbmVOdW1iZXIgPSBOdW1iZXIucGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGlmIChsaW5lTnVtYmVyIDw9IDApIGNvbnRpbnVlO1xuICAgIHJldHVybiB7IHBhdGgsIGxpbmU6IGxpbmVOdW1iZXIsIHRleHQ6IHRhaWwuc2xpY2UobVswXS5sZW5ndGgpIH07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKiAxLWJhc2VkIGxpbmUgY291bnQgb2YgcmVzcG9uc2UgdGV4dCB0aGF0IGhvbGRzIGFuIGVudGlyZSBmaWxlJ3MgY29udGVudC4gKi9cbmZ1bmN0aW9uIGxpbmVDb3VudCh0ZXh0OiBzdHJpbmcpOiBudW1iZXIge1xuICBpZiAodGV4dCA9PT0gJycpIHJldHVybiAwO1xuICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gdGV4dC5lbmRzV2l0aCgnXFxuJykgPyB0ZXh0LnNsaWNlKDAsIC0xKSA6IHRleHQ7XG4gIHJldHVybiB3aXRob3V0VHJhaWxpbmdOZXdsaW5lLnNwbGl0KCdcXG4nKS5sZW5ndGg7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGF5b3V0IGRlY29kZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBEZWNvZGUgYHN0ZG91dGAgaW50byBzZWFyY2ggcmVjb3JkcyBmb3IgYGxheW91dGAuIE9uZS1maWxlIHJlY29yZHMgYXJlXG4gKiBhdHRyaWJ1dGVkIHRvIGBzaW5nbGVGaWxlQXJnYCAodGhlIGNvbW1hbmQncyBzb2xlIGV4cGxpY2l0IGZpbGUpOyBmb3IgYW55XG4gKiBvdGhlciBsYXlvdXQgdGhlIHJlY29yZCBwYXRocyBhcmUgdGhlIHJlc3BvbnNlJ3Mgb3duLiBOdWxsLXNlcGFyYXRlZFxuICogcmVjb3JkcyBjYXJyeSBgbGluZTogbnVsbGAgYW5kIHRoZSBmdWxsIGZpbGUgY29udGVudCBpbiBgdGV4dGAsIGJlY2F1c2UgdGhlXG4gKiBvbmx5IHdlbGwtZGVmaW5lZCB0b3VjaCBmb3IgYSBgcGF0aDoxOlx1MjAyNmAgcmVjb3JkIGhvbGRpbmcgYW4gZW50aXJlIGZpbGUgaXNcbiAqIHRoZSB3aG9sZSBmaWxlLlxuICovXG5mdW5jdGlvbiBkZWNvZGVTZWFyY2hMYXlvdXQobGF5b3V0OiBTZWFyY2hMYXlvdXQsIHN0ZG91dDogc3RyaW5nLCBzaW5nbGVGaWxlQXJnOiBzdHJpbmcgfCBudWxsKTogU2VhcmNoUmVjb3JkW10ge1xuICBjb25zdCByZWNvcmRzOiBTZWFyY2hSZWNvcmRbXSA9IFtdO1xuICBzd2l0Y2ggKGxheW91dCkge1xuICAgIGNhc2UgJ3JlY3Vyc2l2ZSc6XG4gICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgY29tcGxldGVMaW5lcyhzdGRvdXQpKSB7XG4gICAgICAgIGNvbnN0IHJlYyA9IHBhcnNlUmVjb3JkKGxpbmUsICc6Jyk7XG4gICAgICAgIGlmIChyZWMgIT09IG51bGwpIHJlY29yZHMucHVzaChyZWMpO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnY29udGV4dCc6IHtcbiAgICAgIC8vIE1hdGNoIHJlY29yZHMgYXJlIGBwYXRoOmxpbmU6dGV4dGA7IGNvbnRleHQgcmVjb3JkcyBhcmVcbiAgICAgIC8vIGBwYXRoLWxpbmUtdGV4dGAgKHRoZSBzZXBhcmF0b3IgaXMgYSBkYXNoIHdoZXJldmVyIGEgbWF0Y2ggcmVjb3JkXG4gICAgICAvLyB3b3VsZCB1c2UgYSBjb2xvbikuIEJvdGggY2FycnkgdGhlIHJlYWwgbGluZSBudW1iZXI7IGAtLWAgZ3JvdXBcbiAgICAgIC8vIHNlcGFyYXRvcnMgYXJlIG5vdCByZWNvcmRzLiBBIGRhc2ggaW5zaWRlIGEgcGF0aCBicmVha3MgdGhlIGRhc2hcbiAgICAgIC8vIHNwbGl0LCBzbyB0aGUgcmVzcG9uc2UncyBtYXRjaCByZWNvcmRzIGZpcnN0IGVzdGFibGlzaCB0aGUgZmlsZXMnXG4gICAgICAvLyBleGFjdCBwYXRocyBhbmQgZWFjaCBjb250ZXh0IHJlY29yZCBpcyBhbmNob3JlZCB0byBhIGtub3duIHBhdGhcbiAgICAgIC8vIHByZWZpeCBiZWZvcmUgaXRzIGAtbGluZS10ZXh0YCB0YWlsLCB3aXRoIHRoZSBkYXNoLWZyZWUgZGVmYXVsdCBhc1xuICAgICAgLy8gdGhlIGZhbGxiYWNrLiBDb250ZXh0IHJlY29yZHMgY2FuIHByZWNlZGUgdGhlaXIgbWF0Y2ggKC1CIHdpbmRvd3MpLFxuICAgICAgLy8gc28gdGhlIGtub3duIHNldCBpcyBidWlsdCBpbiBhIGZpcnN0IHBhc3Mgb3ZlciBhbGwgbGluZXMuXG4gICAgICBjb25zdCBsaW5lcyA9IGNvbXBsZXRlTGluZXMoc3Rkb3V0KTtcbiAgICAgIGNvbnN0IGtub3duID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgaWYgKGxpbmUgPT09ICctLScpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCByZWMgPSBwYXJzZVJlY29yZChsaW5lLCAnOicpO1xuICAgICAgICBpZiAocmVjICE9PSBudWxsKSBrbm93bi5hZGQocmVjLnBhdGgpO1xuICAgICAgfVxuICAgICAgY29uc3Qga25vd25Tb3J0ZWQgPSBbLi4ua25vd25dLnNvcnQoKGEsIGIpID0+IGIubGVuZ3RoIC0gYS5sZW5ndGgpO1xuICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICAgIGlmIChsaW5lID09PSAnLS0nKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgcmVjID0gcGFyc2VSZWNvcmQobGluZSwgJzonKSA/PyBwYXJzZUNvbnRleHRSZWNvcmQobGluZSwga25vd25Tb3J0ZWQpID8/IHBhcnNlUmVjb3JkKGxpbmUsICctJyk7XG4gICAgICAgIGlmIChyZWMgIT09IG51bGwpIHJlY29yZHMucHVzaChyZWMpO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNhc2UgJ2hlYWRpbmcnOlxuICAgICAgLy8gQSBmaWxlIGhlYWRlciBsaW5lLCB0aGVuIGBsaW5lOnRleHRgIHJlY29yZHM7IGJsYW5rIGxpbmVzIHNlcGFyYXRlXG4gICAgICAvLyBmaWxlIHNlY3Rpb25zOyBhbnkgbm9uLXJlY29yZCBsaW5lIHN0YXJ0cyB0aGUgbmV4dCBmaWxlJ3Mgc2VjdGlvbi5cbiAgICAgIHtcbiAgICAgICAgbGV0IGN1cnJlbnQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgY29tcGxldGVMaW5lcyhzdGRvdXQpKSB7XG4gICAgICAgICAgaWYgKGxpbmUgPT09ICcnKSBjb250aW51ZTtcbiAgICAgICAgICBjb25zdCByZWMgPSBwYXJzZU9uZUZpbGVSZWNvcmQobGluZSk7XG4gICAgICAgICAgaWYgKHJlYyA9PT0gbnVsbCkge1xuICAgICAgICAgICAgY3VycmVudCA9IGxpbmU7XG4gICAgICAgICAgfSBlbHNlIGlmIChjdXJyZW50ICE9PSBudWxsKSB7XG4gICAgICAgICAgICByZWNvcmRzLnB1c2goeyBwYXRoOiBjdXJyZW50LCBsaW5lOiByZWMubGluZSwgdGV4dDogcmVjLnRleHQgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdvbmUtZmlsZSc6XG4gICAgICBpZiAoc2luZ2xlRmlsZUFyZyAhPT0gbnVsbCkge1xuICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgY29tcGxldGVMaW5lcyhzdGRvdXQpKSB7XG4gICAgICAgICAgY29uc3QgcmVjID0gcGFyc2VPbmVGaWxlUmVjb3JkKGxpbmUpO1xuICAgICAgICAgIGlmIChyZWMgIT09IG51bGwpIHJlY29yZHMucHVzaCh7IHBhdGg6IHNpbmdsZUZpbGVBcmcsIGxpbmU6IHJlYy5saW5lLCB0ZXh0OiByZWMudGV4dCB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnbnVsbC1zZXBhcmF0ZWQnOlxuICAgICAgLy8gYGdyZXAgLXpgOiBlYWNoIG1hdGNoaW5nIGZpbGUgYXJyaXZlcyBhcyBvbmUgTlVMLXRlcm1pbmF0ZWRcbiAgICAgIC8vIGBwYXRoOjE6PGVudGlyZSBmaWxlIGNvbnRlbnQ+YCByZWNvcmQuIFRoZSByZWNvcmQgaXMgZnVsbHkgb2JzZXJ2ZWRcbiAgICAgIC8vIG9ubHkgd2hlbiBpdHMgdGVybWluYXRpbmcgTlVMIGlzIHByZXNlbnQuXG4gICAgICB7XG4gICAgICAgIGNvbnN0IHBhcnRzID0gc3Rkb3V0LnNwbGl0KCdcXDAnKTtcbiAgICAgICAgaWYgKCFzdGRvdXQuZW5kc1dpdGgoJ1xcMCcpKSBwYXJ0cy5wb3AoKTtcbiAgICAgICAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XG4gICAgICAgICAgaWYgKHBhcnQgPT09ICcnKSBjb250aW51ZTtcbiAgICAgICAgICBjb25zdCByZWMgPSBwYXJzZVJlY29yZChwYXJ0LCAnOicpO1xuICAgICAgICAgIGlmIChyZWMgPT09IG51bGwgfHwgcmVjLmxpbmUgIT09IDEpIGNvbnRpbnVlO1xuICAgICAgICAgIHJlY29yZHMucHVzaCh7IHBhdGg6IHJlYy5wYXRoLCBsaW5lOiBudWxsLCB0ZXh0OiByZWMudGV4dCB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYnJlYWs7XG4gIH1cbiAgcmV0dXJuIHJlY29yZHM7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2NvcGUgcmVzdHJpY3Rpb24gYW5kIGNvYWxlc2Npbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hldGhlciBgYWJzYCByZXNvbHZlcyBpbnNpZGUgb25lIG9mIHRoZSBwZXJtaXR0ZWQgcm9vdHMgKHBhdGgtcHJlZml4IGNvbnRhaW5tZW50KS4gKi9cbmZ1bmN0aW9uIGluc2lkZVJvb3QoYWJzOiBzdHJpbmcsIHJvb3RzOiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHJvb3Qgb2Ygcm9vdHMpIHtcbiAgICBpZiAoYWJzID09PSByb290IHx8IGFicy5zdGFydHNXaXRoKHJvb3QgKyBzZXApKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBXaGV0aGVyIGBhYnNgIGlzIGFuIGV4aXN0aW5nIHJlZ3VsYXIgZmlsZSAoZm9sbG93aW5nIHN5bWxpbmtzKS4gKi9cbmZ1bmN0aW9uIGlzRmlsZShhYnM6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIHJldHVybiBzdGF0U3luYyhhYnMpLmlzRmlsZSgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgZ2l0IHdvcmt0cmVlIHJvb3QgY29udGFpbmluZyBgc3RhcnREaXJgLCBmb3VuZCBieSB3YWxraW5nIHVwIGZvciB0aGVcbiAqIGZpcnN0IGRpcmVjdG9yeSBob2xkaW5nIGEgYC5naXRgIGVudHJ5IFx1MjAxNCBhIGRpcmVjdG9yeSBpbiBhIHJlZ3VsYXIgcmVwbywgYVxuICogYGdpdGRpcjpgIGZpbGUgaW4gYSBsaW5rZWQgd29ya3RyZWUgb3Igc3VibW9kdWxlLiBEaWZmLWZvcm0gb3V0cHV0IHBhdGhzXG4gKiBhcmUgcmVwby1yb290LXJlbGF0aXZlIHJlZ2FyZGxlc3Mgb2YgY3dkLCBzbyBkaWZmIGRlY29kZSByZXNvbHZlcyBhZ2FpbnN0XG4gKiB0aGlzIHJvb3QgcmF0aGVyIHRoYW4gdGhlIGVmZmVjdGl2ZSBkaXI7IHNlYXJjaC1sYXlvdXQgcGF0aHMgYXJlXG4gKiBjd2QtcmVsYXRpdmUgYW5kIHN0YXkgYW5jaG9yZWQgdG8gdGhlIGVmZmVjdGl2ZSBkaXIuIE5vIHN1YnByb2Nlc3MgXHUyMDE0IHRoZVxuICogY29tbW9uIGxheWVyIGltcG9ydHMgb25seSBub2RlOiBidWlsdGlucy4gTnVsbCB3aGVuIGBzdGFydERpcmAgaXMgbm90XG4gKiBpbnNpZGUgYW55IHdvcmt0cmVlOyBkaWZmIG91dHB1dCBpcyB0aGVuIHN1c3BlY3QgYW5kIHRoZSBwYXJzZSBmYWlsc1xuICogY2xvc2VkLlxuICovXG5mdW5jdGlvbiBmaW5kR2l0Um9vdChzdGFydERpcjogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGxldCBkaXIgPSBzdGFydERpcjtcbiAgZm9yICg7Oykge1xuICAgIGlmIChleGlzdHNTeW5jKGpvaW4oZGlyLCAnLmdpdCcpKSkgcmV0dXJuIGRpcjtcbiAgICBjb25zdCBwYXJlbnQgPSBkaXJuYW1lKGRpcik7XG4gICAgaWYgKHBhcmVudCA9PT0gZGlyKSByZXR1cm4gbnVsbDtcbiAgICBkaXIgPSBwYXJlbnQ7XG4gIH1cbn1cblxuLyoqXG4gKiBPcmRlciBzcGFucyBkZXRlcm1pbmlzdGljYWxseSBhbmQgY2FwIHRoZSBjb3VudCAoZmFpbC1jbG9zZWQgYmV5b25kXG4gKiBgTUFYX1JFU1BPTlNFX1NQQU5TYCk6IHRoZSBmaXJzdCA1MCBzcGFucyBpbiBwYXRoIG9yZGVyIGFyZSBlbWl0dGVkLCB0aGVcbiAqIHJlc3QgYXJlIGRyb3BwZWQuIE5vcm1hbCBwYXJzZXMga2VlcCB0aGVpciBlbWlzc2lvbiBvcmRlciBcdTIwMTQgdGhlIHNvcnQgb25seVxuICogZW5nYWdlcyB3aGVuIHRoZSBjYXAgYmluZHMuXG4gKi9cbmZ1bmN0aW9uIGNhcFNwYW5zKHNwYW5zOiBSZXNvbHZlZFNwYW5bXSk6IFJlc29sdmVkU3BhbltdIHtcbiAgaWYgKHNwYW5zLmxlbmd0aCA8PSBNQVhfUkVTUE9OU0VfU1BBTlMpIHJldHVybiBzcGFucztcbiAgY29uc3Qgb3JkZXJlZCA9IFsuLi5zcGFuc10uc29ydChcbiAgICAoYSwgYikgPT4gYS5hYnNvbHV0ZVBhdGgubG9jYWxlQ29tcGFyZShiLmFic29sdXRlUGF0aCkgfHwgYS5saW5lU3RhcnQgLSBiLmxpbmVTdGFydCB8fCBhLmxpbmVFbmQgLSBiLmxpbmVFbmRcbiAgKTtcbiAgcmV0dXJuIG9yZGVyZWQuc2xpY2UoMCwgTUFYX1JFU1BPTlNFX1NQQU5TKTtcbn1cblxuLyoqXG4gKiBDb2FsZXNjZSBwZXItZmlsZSBsaW5lIG51bWJlcnMgaW50byBjb250aWd1b3VzIHJhbmdlczsgYWRqYWNlbnQgYW5kXG4gKiBvdmVybGFwcGluZyBsaW5lcyBtZXJnZSwgYW5kIGR1cGxpY2F0ZXMgbmV2ZXIgY3JlYXRlIGR1cGxpY2F0ZSBzdXJmYWNlcy5cbiAqL1xuZnVuY3Rpb24gY29hbGVzY2UobGluZXM6IG51bWJlcltdKTogQXJyYXk8W251bWJlciwgbnVtYmVyXT4ge1xuICBpZiAobGluZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IHNvcnRlZCA9IFsuLi5saW5lc10uc29ydCgoYSwgYikgPT4gYSAtIGIpO1xuICBjb25zdCByYW5nZXM6IEFycmF5PFtudW1iZXIsIG51bWJlcl0+ID0gW107XG4gIGxldCBzdGFydCA9IHNvcnRlZFswXTtcbiAgbGV0IGVuZCA9IHNvcnRlZFswXTtcbiAgZm9yIChjb25zdCBuIG9mIHNvcnRlZC5zbGljZSgxKSkge1xuICAgIGlmIChuIDw9IGVuZCArIDEpIHtcbiAgICAgIGlmIChuID4gZW5kKSBlbmQgPSBuO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZXMucHVzaChbc3RhcnQsIGVuZF0pO1xuICAgICAgc3RhcnQgPSBuO1xuICAgICAgZW5kID0gbjtcbiAgICB9XG4gIH1cbiAgcmFuZ2VzLnB1c2goW3N0YXJ0LCBlbmRdKTtcbiAgcmV0dXJuIHJhbmdlcztcbn1cblxuLyoqXG4gKiBSZXNvbHZlIHBlci1maWxlIGxpbmUgc2V0cyBpbnRvIHNwYW5zOiBwYXRocyByZXNvbHZlIGFnYWluc3QgYGJhc2VEaXJgLFxuICogbXVzdCBzaXQgaW5zaWRlIG9uZSBvZiB0aGUgcGVybWl0dGVkIGByb290c2AgKGEgdHJhdmVyc2FsIHBhdGggbm9ybWFsaXplc1xuICogb3V0c2lkZSB0aGVtIGFuZCBpcyByZWplY3RlZCksIGFuZCB0aGVpciBsaW5lcyBjb2FsZXNjZSBpbnRvIGNvbnRpZ3VvdXNcbiAqIHJhbmdlcy5cbiAqL1xuZnVuY3Rpb24gc3BhbnNGb3IocGVyRmlsZTogTWFwPHN0cmluZywgU2V0PG51bWJlcj4+LCBiYXNlRGlyOiBzdHJpbmcsIHJvb3RzOiBzdHJpbmdbXSk6IFJlc29sdmVkU3BhbltdIHtcbiAgY29uc3Qgc3BhbnM6IFJlc29sdmVkU3BhbltdID0gW107XG4gIGZvciAoY29uc3QgW3BhdGgsIGxpbmVzXSBvZiBwZXJGaWxlKSB7XG4gICAgY29uc3QgYWJzID0gcmVzb2x2ZVBhdGgoYmFzZURpciwgcGF0aCk7XG4gICAgaWYgKCFpbnNpZGVSb290KGFicywgcm9vdHMpKSBjb250aW51ZTtcbiAgICBmb3IgKGNvbnN0IFtsaW5lU3RhcnQsIGxpbmVFbmRdIG9mIGNvYWxlc2NlKFsuLi5saW5lc10pKSB7XG4gICAgICBzcGFucy5wdXNoKHsgbGluZVN0YXJ0LCBsaW5lRW5kLCBhYnNvbHV0ZVBhdGg6IGFicyB9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHNwYW5zO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFVuaWZpZWQtZGlmZiBkZWNvZGVyIChgZ2l0IGRpZmZgLCBkaWZmLWZvcm0gYGdpdCBzaG93YCwgYGdpdCBsb2cgLXBgKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQSB1bmlmaWVkLWRpZmYgaHVuayBoZWFkZXI6IGBAQCAtYVssYl0gK2NbLGRdIEBAYDsgb21pdHRlZCBjb3VudHMgbWVhbiAxLlxuICogQSBjdXQtb2ZmIGhlYWRlciAobWlzc2luZyB0aGUgY2xvc2luZyBgQEBgKSBkb2VzIG5vdCBtYXRjaCBhbmQgaXRzIGh1bmsgaXNcbiAqIGlnbm9yZWQuIENvbWJpbmVkLWRpZmYgYEBAQGAgaGVhZGVycyBkbyBub3QgbWF0Y2ggKHRoZWlyIHJlY29yZHMgYXJlXG4gKiByZWplY3RlZCBhdCB0aGUgYGRpZmYgLS1jY2AgbGluZSBhbnl3YXkpLlxuICovXG5jb25zdCBIVU5LX0hFQURFUiA9IC9eQEAgLShcXGQrKSg/OiwoXFxkKykpPyBcXCsoXFxkKykoPzosKFxcZCspKT8gQEAvO1xuXG4vKiogU3RyaXAgdGhlIGBhL2AvYGIvYCBwcmVmaXggYSB1bmlmaWVkLWRpZmYgcGF0aCBjYXJyaWVzLiAqL1xuZnVuY3Rpb24gc3RyaXBEaWZmUHJlZml4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnN0YXJ0c1dpdGgoJ2EvJykgfHwgcC5zdGFydHNXaXRoKCdiLycpID8gcC5zbGljZSgyKSA6IHA7XG59XG5cbi8qKlxuICogUGFyc2UgYSBgZGlmZiAtLWdpdCBhL29sZCBiL25ld2AgZmlsZSBoZWFkZXIsIGBkaWZmIC0tY2NgL2AtLWNvbWJpbmVkYFxuICogKGEgcmVhbCBtZXJnZS1jb25mbGljdCBjb21iaW5lZCBkaWZmOiBubyByYW5nZXMpLCBvciByZXR1cm4gbnVsbCBmb3JcbiAqIG5vbi1oZWFkZXIgbGluZXMuIEEgaGVhZGVyIHdob3NlIHBhdGhzIGFyZSBxdW90ZWQgaXMgdW5wYXJzZWFibGUgXHUyMDE0IHRoZVxuICogcGxhbidzIGZhaWwtY2xvc2VkIHJ1bGUgZm9yIHF1b3RlZC91bmVzY2FwYWJsZSBwYXRocy5cbiAqL1xuZnVuY3Rpb24gcGFyc2VEaWZmSGVhZGVyKFxuICBsaW5lOiBzdHJpbmdcbik6XG4gIHwgeyBraW5kOiAnZmlsZSc7IG9sZFBhdGg6IHN0cmluZyB8IG51bGw7IG5ld1BhdGg6IHN0cmluZyB8IG51bGwgfVxuICB8IHsga2luZDogJ2NvbWJpbmVkJyB9XG4gIHwgeyBraW5kOiAndW5wYXJzZWFibGUnIH1cbiAgfCBudWxsIHtcbiAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnZGlmZiAtLWNjICcpIHx8IGxpbmUuc3RhcnRzV2l0aCgnZGlmZiAtLWNvbWJpbmVkICcpKSByZXR1cm4geyBraW5kOiAnY29tYmluZWQnIH07XG4gIGlmICghbGluZS5zdGFydHNXaXRoKCdkaWZmIC0tZ2l0ICcpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdG9rZW5zID0gbGluZS5zbGljZSgnZGlmZiAtLWdpdCAnLmxlbmd0aCkudHJpbSgpLnNwbGl0KC9cXHMrLyk7XG4gIGlmICh0b2tlbnMubGVuZ3RoICE9PSAyIHx8IHRva2Vuc1swXS5zdGFydHNXaXRoKCdcIicpIHx8IHRva2Vuc1sxXS5zdGFydHNXaXRoKCdcIicpKSByZXR1cm4geyBraW5kOiAndW5wYXJzZWFibGUnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdmaWxlJywgb2xkUGF0aDogc3RyaXBEaWZmUHJlZml4KHRva2Vuc1swXSksIG5ld1BhdGg6IHN0cmlwRGlmZlByZWZpeCh0b2tlbnNbMV0pIH07XG59XG5cbi8qKlxuICogUGFyc2UgYSBgLS0tIGEvcGF0aGAgLyBgKysrIGIvcGF0aGAgc2lkZSBsaW5lLiBgL2Rldi9udWxsYCBtZWFucyB0aGUgc2lkZVxuICogZG9lcyBub3QgZXhpc3QgKG5ldy1maWxlIC8gZGVsZXRpb24gc2lkZXMpLiBBIHF1b3RlZCBwYXRoIGlzIHVucGFyc2VhYmxlLlxuICovXG5mdW5jdGlvbiBwYXJzZURpZmZTaWRlKFxuICBsaW5lOiBzdHJpbmcsXG4gIG1hcmtlcjogJy0tLScgfCAnKysrJ1xuKTogeyBraW5kOiAnc2lkZSc7IHBhdGg6IHN0cmluZyB8IG51bGwgfSB8IHsga2luZDogJ3VucGFyc2VhYmxlJyB9IHwgbnVsbCB7XG4gIGlmICghbGluZS5zdGFydHNXaXRoKGAke21hcmtlcn0gYCkpIHJldHVybiBudWxsO1xuICBjb25zdCBwID0gbGluZS5zbGljZShtYXJrZXIubGVuZ3RoICsgMSk7XG4gIGlmIChwLnN0YXJ0c1dpdGgoJ1wiJykpIHJldHVybiB7IGtpbmQ6ICd1bnBhcnNlYWJsZScgfTtcbiAgcmV0dXJuIHsga2luZDogJ3NpZGUnLCBwYXRoOiBwID09PSAnL2Rldi9udWxsJyA/IG51bGwgOiBzdHJpcERpZmZQcmVmaXgocCkgfTtcbn1cblxuLyoqIE9uZSBmaWxlIHNlY3Rpb24gb2YgYSByZXNwb25zZSwgaW4gdGhlIGRlY29kZXIncyB3b3JraW5nIHN0YXRlLiAqL1xuaW50ZXJmYWNlIERpZmZSZWNvcmRTdGF0ZSB7XG4gIG9sZFBhdGg6IHN0cmluZyB8IG51bGw7XG4gIG5ld1BhdGg6IHN0cmluZyB8IG51bGw7XG4gIC8qKiBSZW5hbWUvY29weSBtZXRhZGF0YSBwcmVzZW50IChgcmVuYW1lIGZyb21gL2ByZW5hbWUgdG9gLCBgY29weSBmcm9tYC9gY29weSB0b2ApOiB0aGUgbmV3IHBhdGggaXMgdGhlIG9ubHkgdG91Y2ggdGFyZ2V0LiAqL1xuICByZW5hbWU6IGJvb2xlYW47XG4gIGJpbmFyeTogYm9vbGVhbjtcbiAgY29tYmluZWQ6IGJvb2xlYW47XG4gIHN1Ym1vZHVsZTogYm9vbGVhbjtcbiAgLyoqIEEgcXVvdGVkL3VuZXNjYXBhYmxlIHBhdGg6IHRoZSByZWNvcmQgcHJvZHVjZXMgbm8gcmFuZ2UuICovXG4gIHVudXNhYmxlOiBib29sZWFuO1xuICAvKiogQSBodW5rIGhlYWRlciBoYXMgYmVlbiBzZWVuOiBsYXRlciBgLS0tYC9gKysrYC1sb29raW5nIGxpbmVzIGFyZSBodW5rIGJvZHkgbGluZXMsIG5vdCBzaWRlIGhlYWRlcnMuICovXG4gIHNhd0h1bms6IGJvb2xlYW47XG59XG5cbi8qKlxuICogRGVjb2RlIGEgdW5pZmllZC1kaWZmIHJlc3BvbnNlIGludG8gcGVyLXBhdGggbGluZSBzZXRzLiBPbmx5IGh1bmsgaGVhZGVyc1xuICogY2FycnkgcG9zaXRpb25hbCBkYXRhIFx1MjAxNCBib2R5IGxpbmVzIGFyZSBpZ25vcmVkIFx1MjAxNCBhbmQgZWFjaCBoZWFkZXIncyBzaWRlXG4gKiByYW5nZXMgYXR0YWNoIHRvIGl0cyBzaWRlJ3MgcGF0aCAoYC9kZXYvbnVsbGAgc2lkZXMgaGF2ZSBubyBwYXRoKS5cbiAqIEJpbmFyeSwgY29tYmluZWQsIHN1Ym1vZHVsZSwgYW5kIHVucGFyc2VhYmxlIHJlY29yZHMgZW1pdCBub3RoaW5nO1xuICogcmVuYW1lL2NvcHkgcmVjb3JkcyBlbWl0IHRoZSBuZXcgc2lkZSBvbmx5LiBgaW5kZXhgIGxpbmVzIGFuZFxuICogYFxcIE5vIG5ld2xpbmUgYXQgZW5kIG9mIGZpbGVgIG1hcmtlcnMgYXJlIG1ldGFkYXRhIGFuZCBmYWxsIHRocm91Z2guIFRoZVxuICogdW5pdmVyc2FsIHRlcm1pbmF0aW5nLW5ld2xpbmUgcnVsZSBhcHBsaWVzIHZpYSBjb21wbGV0ZUxpbmVzLlxuICovXG5mdW5jdGlvbiBkZWNvZGVVbmlmaWVkRGlmZihzdGRvdXQ6IHN0cmluZyk6IE1hcDxzdHJpbmcsIFNldDxudW1iZXI+PiB7XG4gIGNvbnN0IHBlckZpbGUgPSBuZXcgTWFwPHN0cmluZywgU2V0PG51bWJlcj4+KCk7XG4gIGxldCBjdXJyZW50OiBEaWZmUmVjb3JkU3RhdGUgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBsaW5lIG9mIGNvbXBsZXRlTGluZXMoc3Rkb3V0KSkge1xuICAgIGNvbnN0IGhlYWRlciA9IHBhcnNlRGlmZkhlYWRlcihsaW5lKTtcbiAgICBpZiAoaGVhZGVyICE9PSBudWxsKSB7XG4gICAgICBjdXJyZW50ID0ge1xuICAgICAgICBvbGRQYXRoOiBoZWFkZXIua2luZCA9PT0gJ2ZpbGUnID8gaGVhZGVyLm9sZFBhdGggOiBudWxsLFxuICAgICAgICBuZXdQYXRoOiBoZWFkZXIua2luZCA9PT0gJ2ZpbGUnID8gaGVhZGVyLm5ld1BhdGggOiBudWxsLFxuICAgICAgICByZW5hbWU6IGZhbHNlLFxuICAgICAgICBiaW5hcnk6IGZhbHNlLFxuICAgICAgICBjb21iaW5lZDogaGVhZGVyLmtpbmQgPT09ICdjb21iaW5lZCcsXG4gICAgICAgIHN1Ym1vZHVsZTogZmFsc2UsXG4gICAgICAgIHVudXNhYmxlOiBoZWFkZXIua2luZCA9PT0gJ3VucGFyc2VhYmxlJyxcbiAgICAgICAgc2F3SHVuazogZmFsc2VcbiAgICAgIH07XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGN1cnJlbnQgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ0JpbmFyeSBmaWxlcyAnKSkge1xuICAgICAgY3VycmVudC5iaW5hcnkgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFN1Ym1vZHVsZSBtYXJrZXJzOiBhIGBtb2RlIDE2MDAwMGAgbWV0YWRhdGEgbGluZSwgb3IgYFN1YnByb2plY3RcbiAgICAvLyBjb21taXRgIGxpbmVzICh0aGVpciBvd24gKy8tIGJvZHkgbGluZXMpLiBUaGUgbW9kZSBjaGVjayBleGNsdWRlc1xuICAgIC8vIGh1bmsgYm9keSBsaW5lcyBzbyBmaWxlIGNvbnRlbnQgdGhhdCBtZW50aW9ucyB0aGUgbW9kZSBjYW4ndCByZWplY3RcbiAgICAvLyBhIHJlYWwgcmVjb3JkLlxuICAgIGNvbnN0IGlzQm9keUxpbmUgPSBsaW5lLnN0YXJ0c1dpdGgoJyAnKSB8fCBsaW5lLnN0YXJ0c1dpdGgoJysnKSB8fCBsaW5lLnN0YXJ0c1dpdGgoJy0nKSB8fCBsaW5lLnN0YXJ0c1dpdGgoJ1xcXFwnKTtcbiAgICBpZiAoIWlzQm9keUxpbmUgJiYgbGluZS5pbmNsdWRlcygnbW9kZSAxNjAwMDAnKSkge1xuICAgICAgY3VycmVudC5zdWJtb2R1bGUgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLmluY2x1ZGVzKCdTdWJwcm9qZWN0IGNvbW1pdCcpKSB7XG4gICAgICBjdXJyZW50LnN1Ym1vZHVsZSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgbGluZS5zdGFydHNXaXRoKCdyZW5hbWUgZnJvbSAnKSB8fFxuICAgICAgbGluZS5zdGFydHNXaXRoKCdyZW5hbWUgdG8gJykgfHxcbiAgICAgIGxpbmUuc3RhcnRzV2l0aCgnY29weSBmcm9tICcpIHx8XG4gICAgICBsaW5lLnN0YXJ0c1dpdGgoJ2NvcHkgdG8gJylcbiAgICApIHtcbiAgICAgIGN1cnJlbnQucmVuYW1lID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoIWN1cnJlbnQuc2F3SHVuaykge1xuICAgICAgY29uc3Qgb2xkU2lkZSA9IHBhcnNlRGlmZlNpZGUobGluZSwgJy0tLScpO1xuICAgICAgaWYgKG9sZFNpZGUgIT09IG51bGwpIHtcbiAgICAgICAgaWYgKG9sZFNpZGUua2luZCA9PT0gJ3VucGFyc2VhYmxlJykgY3VycmVudC51bnVzYWJsZSA9IHRydWU7XG4gICAgICAgIGVsc2UgY3VycmVudC5vbGRQYXRoID0gb2xkU2lkZS5wYXRoO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG5ld1NpZGUgPSBwYXJzZURpZmZTaWRlKGxpbmUsICcrKysnKTtcbiAgICAgIGlmIChuZXdTaWRlICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChuZXdTaWRlLmtpbmQgPT09ICd1bnBhcnNlYWJsZScpIGN1cnJlbnQudW51c2FibGUgPSB0cnVlO1xuICAgICAgICBlbHNlIGN1cnJlbnQubmV3UGF0aCA9IG5ld1NpZGUucGF0aDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGh1bmsgPSBIVU5LX0hFQURFUi5leGVjKGxpbmUpO1xuICAgIGlmIChodW5rICE9PSBudWxsKSB7XG4gICAgICBjdXJyZW50LnNhd0h1bmsgPSB0cnVlO1xuICAgICAgZW1pdEh1bmtSYW5nZShwZXJGaWxlLCBjdXJyZW50LCBodW5rKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHBlckZpbGU7XG59XG5cbi8qKiBBdHRyaWJ1dGUgb25lIGh1bmsgaGVhZGVyJ3MgcGVyLXNpZGUgcmFuZ2VzIHRvIGl0cyByZWNvcmQncyBwYXRocy4gKi9cbmZ1bmN0aW9uIGVtaXRIdW5rUmFuZ2UocGVyRmlsZTogTWFwPHN0cmluZywgU2V0PG51bWJlcj4+LCByZWNvcmQ6IERpZmZSZWNvcmRTdGF0ZSwgaHVuazogUmVnRXhwRXhlY0FycmF5KTogdm9pZCB7XG4gIGlmIChyZWNvcmQuYmluYXJ5IHx8IHJlY29yZC5jb21iaW5lZCB8fCByZWNvcmQuc3VibW9kdWxlIHx8IHJlY29yZC51bnVzYWJsZSkgcmV0dXJuO1xuICBjb25zdCBvbGRTdGFydCA9IE51bWJlci5wYXJzZUludChodW5rWzFdLCAxMCk7XG4gIGNvbnN0IG9sZENvdW50ID0gaHVua1syXSA9PT0gdW5kZWZpbmVkID8gMSA6IE51bWJlci5wYXJzZUludChodW5rWzJdLCAxMCk7XG4gIGNvbnN0IG5ld1N0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KGh1bmtbM10sIDEwKTtcbiAgY29uc3QgbmV3Q291bnQgPSBodW5rWzRdID09PSB1bmRlZmluZWQgPyAxIDogTnVtYmVyLnBhcnNlSW50KGh1bmtbNF0sIDEwKTtcbiAgLy8gUmVuYW1lL2NvcHk6IHRoZSBuZXcgcGF0aCBpcyB0aGUgdG91Y2ggdGFyZ2V0OyB0aGUgb2xkIHNpZGUgaXMgZHJvcHBlZFxuICAvLyAodGhlIG9sZCBwYXRoIG1heSBub3QgZXhpc3Qgb24gZGlzayBcdTIwMTQgaXQgd2FzIHJlbmFtZWQgYXdheSkuXG4gIGlmIChyZWNvcmQucmVuYW1lKSB7XG4gICAgaWYgKHJlY29yZC5uZXdQYXRoICE9PSBudWxsKSBhZGRMaW5lcyhwZXJGaWxlLCByZWNvcmQubmV3UGF0aCwgbmV3U3RhcnQsIG5ld0NvdW50KTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHJlY29yZC5vbGRQYXRoICE9PSBudWxsKSBhZGRMaW5lcyhwZXJGaWxlLCByZWNvcmQub2xkUGF0aCwgb2xkU3RhcnQsIG9sZENvdW50KTtcbiAgaWYgKHJlY29yZC5uZXdQYXRoICE9PSBudWxsKSBhZGRMaW5lcyhwZXJGaWxlLCByZWNvcmQubmV3UGF0aCwgbmV3U3RhcnQsIG5ld0NvdW50KTtcbn1cblxuLyoqIEFkZCBgY291bnRgIGNvbnNlY3V0aXZlIDEtYmFzZWQgbGluZXMgc3RhcnRpbmcgYXQgYHN0YXJ0YCB0byBgcGF0aGAncyBzZXQuICovXG5mdW5jdGlvbiBhZGRMaW5lcyhwZXJGaWxlOiBNYXA8c3RyaW5nLCBTZXQ8bnVtYmVyPj4sIHBhdGg6IHN0cmluZywgc3RhcnQ6IG51bWJlciwgY291bnQ6IG51bWJlcik6IHZvaWQge1xuICBpZiAoc3RhcnQgPCAxIHx8IGNvdW50IDw9IDApIHJldHVybjtcbiAgbGV0IGxpbmVzID0gcGVyRmlsZS5nZXQocGF0aCk7XG4gIGlmIChsaW5lcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgbGluZXMgPSBuZXcgU2V0KCk7XG4gICAgcGVyRmlsZS5zZXQocGF0aCwgbGluZXMpO1xuICB9XG4gIGZvciAobGV0IG4gPSBzdGFydDsgbiA8IHN0YXJ0ICsgY291bnQ7IG4rKykgbGluZXMuYWRkKG4pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGBnaXQgYmxhbWUgLUxgIGNvbW1hbmQtdGV4dCBtYXRjaGVyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBNYXRjaCBhIGBnaXQgYmxhbWUgLUwgTixNIDxmaWxlPmAgaW52b2NhdGlvbiBmcm9tIGNvbW1hbmQgdGV4dDogdGhlIGV4YWN0XG4gKiBsaXRlcmFsIGBOLE1gIHJhbmdlIGZyb20gdGhlIGAtTGAgdmFsdWUgYW5kIHRoZSBzaW5nbGUgcGF0aCBwb3NpdGlvbmFsXG4gKiB0aGF0IGZvbGxvd3MgaXQgKGVhcmxpZXIgcG9zaXRpb25hbHMgYXJlIHJldmlzaW9ucykuIGBnaXQgbG9nIC1MYCBlbWJlZHNcbiAqIHRoZSBwYXRoIGluIGl0cyBzcGVjIGFuZCBwYXJzZS1jb21tYW5kLnRzIGFscmVhZHkgY292ZXJzIGl0OyBibGFtZSB0YWtlc1xuICogdGhlIHBhdGggYXMgYSBwb3NpdGlvbmFsLCB3aGljaCB0aGUgY29tbWFuZC1vbmx5IHBhcnNlciBkb2VzIG5vdCBoYW5kbGUuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoQmxhbWVSYW5nZShcbiAgYXJndjogc3RyaW5nW10sXG4gIHN0YXJ0OiBudW1iZXJcbik6IHsgbGluZVN0YXJ0OiBudW1iZXI7IGxpbmVFbmQ6IG51bWJlcjsgZmlsZUFyZzogc3RyaW5nIH0gfCBudWxsIHtcbiAgbGV0IHNwZWM6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgc3BlY0lkeCA9IC0xO1xuICBjb25zdCBwb3NpdGlvbmFsczogQXJyYXk8eyBhcmc6IHN0cmluZzsgaWR4OiBudW1iZXIgfT4gPSBbXTtcbiAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBhcmd2Lmxlbmd0aDsgaisrKSBwb3NpdGlvbmFscy5wdXNoKHsgYXJnOiBhcmd2W2pdLCBpZHg6IGogfSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgaWYgKGEgPT09ICctTCcpIHtcbiAgICAgIHNwZWMgPSBhcmd2W2kgKyAxXSA/PyBudWxsO1xuICAgICAgc3BlY0lkeCA9IGk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLUwnKSkge1xuICAgICAgc3BlYyA9IGEuc2xpY2UoMik7XG4gICAgICBzcGVjSWR4ID0gaTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgIHBvc2l0aW9uYWxzLnB1c2goeyBhcmc6IGEsIGlkeDogaSB9KTtcbiAgfVxuICBpZiAoc3BlYyA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG0gPSAvXihcXGQrKSwoXFxkKykkLy5leGVjKHNwZWMpO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGZpbGVzID0gcG9zaXRpb25hbHMuZmlsdGVyKChwKSA9PiBwLmlkeCA+IHNwZWNJZHgpO1xuICBpZiAoZmlsZXMubGVuZ3RoICE9PSAxKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHtcbiAgICBsaW5lU3RhcnQ6IE51bWJlci5wYXJzZUludChtWzFdLCAxMCksXG4gICAgbGluZUVuZDogTnVtYmVyLnBhcnNlSW50KG1bMl0sIDEwKSxcbiAgICBmaWxlQXJnOiBmaWxlc1swXS5hcmdcbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcmNoZXN0cmF0b3Jcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIERlcml2ZXMgcHJlY2lzZSBwZXItZmlsZSByZWFkIHJhbmdlcyBmcm9tIGEgcmVzcG9uc2UtcHJvZHVjaW5nIGNvbW1hbmQ6XG4gKiBjb21tYW5kIGdhdGluZywgc2NvcGUgcmVzdHJpY3Rpb24gYWdhaW5zdCB0aGUgY29tbWFuZCdzIGRlY2xhcmVkIHJvb3RzLFxuICogc2VhcmNoLWxheW91dCBkZWNvZGluZywgdW5pZmllZC1kaWZmIGRlY29kaW5nLCBjb2FsZXNjaW5nLCBhbmQgdGhlXG4gKiBmYWlsLWNsb3NlZCB0cnVuY2F0aW9uL2hvc3RpbGUtb3V0cHV0IHJ1bGVzLiBSZXR1cm5zIFtdIGZvciBhbnl0aGluZyBub3RcbiAqIHJlc3BvbnNlLWRlcml2YWJsZSBvciBub3QgZnVsbHkgb2JzZXJ2ZWQuXG4gKlxuICogUGhhc2UgM2EgY292ZXJzIHRoZSBncmVwL3JpcGdyZXAgZmFtaWx5IChgcmdgLCBgZ3JlcGAsIGBlZ3JlcGAsIGBmZ3JlcGAsXG4gKiBgZ2l0IGdyZXBgKTsgUGhhc2UgM2IgdGhlIGRpZmYtZm9ybSBgZ2l0IGRpZmZgL2BnaXQgc2hvd2AvYGdpdCBsb2cgLXBgXG4gKiB1bmlmaWVkLWRpZmYgZGVjb2RlcjsgUGhhc2UgM2MgdGhlIGBnaXQgYmxhbWUgLUwgTixNIGZpbGVgIGNvbW1hbmQtdGV4dFxuICogbWF0Y2hlci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUmVzcG9uc2UoaW5wdXQ6IFJlc3BvbnNlUGFyc2VJbnB1dCk6IFJlc29sdmVkU3BhbltdIHtcbiAgY29uc3QgeyBjb21tYW5kLCBjd2QsIHN0ZG91dCB9ID0gaW5wdXQ7XG5cbiAgLy8gV2FsayB0aGUgc2ltcGxlIGNvbW1hbmRzIHRyYWNraW5nIGBjZGAsIGV4YWN0bHkgbGlrZSBwYXJzZS1jb21tYW5kLnRzLlxuICAvLyBUaGUgcmVzcG9uc2UgaXMgYXR0cmlidXRlZCB0byB0aGUgRklSU1QgZ2F0ZWQgc3RhZ2UgKGxlZnQtdG8tcmlnaHQ7IGFcbiAgLy8gbGF0ZXIgc3RhZ2UgbmV2ZXIgb3ZlcnJpZGVzIGFuIGVhcmxpZXIgZ2F0ZWQgb25lKTogaW4gYSBwaXBlbGluZSB0aGVcbiAgLy8gZmluYWwgc3RhZ2UncyBzdGRvdXQgaXMgdGhlIGdhdGVkIHN0YWdlJ3Mgb3V0cHV0IFx1MjAxNCBoZWFkL3RhaWwvd2Mvc29ydC9cbiAgLy8gdW5pcS9jdXQgb25seSB0cnVuY2F0ZSwgcmVvcmRlciwgb3IgZGVkdXBlLCBhbmQgdGhlIHRlcm1pbmF0aW5nLW5ld2xpbmVcbiAgLy8gcnVsZSBoYW5kbGVzIHRoZSBjdXQgXHUyMDE0IHdoaWxlIGEgcmVudW1iZXJpbmcgc3RhZ2UgKGdyZXAgLW4sIG5sLCBjYXQgLW4sXG4gIC8vIGF3aywgc2VkKSB0dXJucyB0aGUgcmVjb3JkcyBpbnRvIHN0cmVhbSBwb3NpdGlvbnMsIHNvIHN1Y2ggcGlwZWxpbmVzXG4gIC8vIGZhaWwgY2xvc2VkIGJlbG93LiBJbiBhIGA7YC9gJiZgL2B8fGAvYCZgL25ld2xpbmUgY2hhaW4gZXZlcnkgc2libGluZ1xuICAvLyBzdGFnZSdzIG91dHB1dCBtaXhlcyBpbnRvIHRoZSBTQU1FIHJlc3BvbnNlLCBzbyB0aGUgY2hhaW4gaXNcbiAgLy8gYXR0cmlidXRhYmxlIG9ubHkgd2hlbiBldmVyeSBzaWJsaW5nIChlaXRoZXIgZGlyZWN0aW9uKSBwYXNzZXMgdGhlIHNhbWVcbiAgLy8gcHJvdmFibHktdmVyYmF0aW0gY2hlY2sgdGhlIHBpcGUgc3RhZ2VzIGdldCBcdTIwMTQgYSBjcmFmdGVkIGZpbGUgcmVhZCBieVxuICAvLyBhbnkgc2libGluZyB3b3VsZCBkZWNvZGUgYXMgcGhhbnRvbSB0b3VjaGVzIG90aGVyd2lzZS4gYGNkYCB0cmFja2luZ1xuICAvLyBhcHBsaWVzIG9ubHlcbiAgLy8gdW50aWwgdGhlIGZpcnN0IGdhdGVkIHN0YWdlIGlzIGZvdW5kOiB0aGUgZXZpZGVuY2Ugd2FzIHByb2R1Y2VkIGluIHRoYXRcbiAgLy8gZGlyZWN0b3J5LCBhbmQgYSBgY2RgIGluIGEgbGF0ZXIgc3RhZ2Ugc2F5cyBub3RoaW5nIGFib3V0IHdoZXJlIHRoZVxuICAvLyByZXNwb25zZSB3YXMgbWFkZS5cbiAgbGV0IGN1cnJlbnREaXIgPSBjd2Q7XG4gIGxldCBnYXRlZDogR2F0ZWRDb21tYW5kIHwgbnVsbCA9IG51bGw7XG4gIC8vIFdoZXRoZXIgdGhlIGdhdGVkIHN0YWdlJ3Mgc3RkaW4gY2FtZSBmcm9tIGEgcGlwZSBcdTIwMTQgdGhlIHNpZ25hbCB0aGF0IGl0c1xuICAvLyByZWNvcmRzIGFyZSBzdHJlYW0gcG9zaXRpb25zIHdoZW4gbm8gc2VhcmNoIHJvb3RzIHdlcmUgZ2l2ZW4uXG4gIGxldCBnYXRlZFByZWNlZGVkQnk6IE9wZXJhdG9yID0gJ3N0YXJ0JztcbiAgLy8gV2hldGhlciB0aGUgZ2F0ZWQgc3RhZ2UncyBvd24gdGV4dCBjYXJyaWVzIGFuIFVOUVVPVEVEIGA8YCBcdTIwMTQgYSBzdGRpblxuICAvLyByZWRpcmVjdCwgc3RhbmRhbG9uZSBvciBnbHVlZCBpbnNpZGUgYSB0b2tlbiAoYHJnIG5lZWRsZTxjcmFmdGVkLnR4dGAsXG4gIC8vIGEgY29uc3VtZWQgYC1lYC9gLWZgIHZhbHVlKS4gVGhlIHN0ZGluLWZlZCBydWxlIG11c3Qgc2VlIGl0IGV2ZW4gd2hlblxuICAvLyBubyBzdGFuZGFsb25lIGA8YCB0b2tlbiBzdXJ2aXZlcyBhcmd2IHNwbGl0dGluZy4gUXVvdGUtYXdhcmU6IGEgcXVvdGVkXG4gIC8vIGxpdGVyYWwgYDxgIGluIGEgcGF0dGVybiAoYHJnIC1uICc8ZGl2PidgKSBpcyBub3QgYSByZWRpcmVjdC5cbiAgbGV0IGdhdGVkUmVkaXJlY3QgPSBmYWxzZTtcbiAgLy8gV2hldGhlciB0aGUgZ2F0ZWQgc3RhZ2UncyBzdGRpbiBjb21lcyBmcm9tIGEgYDw8YC9gPDwtYCBIRVJFRE9DIGJvZHkgXHUyMDE0XG4gIC8vIHRoZSBzcGxpdHRlciBzdHJpcHMgdGhlIG9wZXJhdG9yK2RlbGltaXRlciBmcm9tIHRoZSBzdGFnZSB0ZXh0LCBzbyBvbmx5XG4gIC8vIHRoZSBwZXItc3RhZ2UgZmxhZyBzZWVzIHRoZSByZWRpcmVjdC5cbiAgbGV0IGdhdGVkSGVyZWRvYyA9IGZhbHNlO1xuICBjb25zdCBzcGxpdCA9IHNwbGl0VG9wTGV2ZWwoY29tbWFuZCk7XG4gIC8vIEEgQmFzaCBwYXJzZSBlcnJvciBtZWFucyBub3RoaW5nIGV4ZWN1dGVkIChiYXNoIGV4aXRzIDIgYXQgcGFyc2UgdGltZSkgXHUyMDE0XG4gIC8vIHRoZSByZXNwb25zZSBjb3VsZCBub3QgaGF2ZSBiZWVuIHByb2R1Y2VkIGJ5IHRoaXMgY29tbWFuZCwgc28gZmFpbFxuICAvLyBjbG9zZWQgcmF0aGVyIHRoYW4gYXR0cmlidXRlIGl0IHRvIGhhbGYtcGFyc2VkIHN0YWdlcy5cbiAgaWYgKHNwbGl0Lm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gW107XG4gIGNvbnN0IHBhcnRzID0gc3BsaXQuc3RhZ2VzO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3Qgc2ltcGxlID0gcGFydHNbaV07XG4gICAgY29uc3QgYXJndiA9IGFyZ3ZPZihzaW1wbGUudGV4dCk7XG4gICAgaWYgKGFyZ3YgPT09IG51bGwgfHwgYXJndi5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIGlmIChhcmd2WzBdID09PSAnY2QnKSB7XG4gICAgICBpZiAoZ2F0ZWQgPT09IG51bGwpIHtcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYXJndlsxXTtcbiAgICAgICAgaWYgKHRhcmdldCAhPT0gdW5kZWZpbmVkICYmIHRhcmdldCAhPT0gJy0nICYmICFoYXNTaGVsbEV4cGFuc2lvbih0YXJnZXQpKSB7XG4gICAgICAgICAgY3VycmVudERpciA9IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIHRhcmdldCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZ2F0ZWQgIT09IG51bGwpIGNvbnRpbnVlO1xuICAgIGlmIChTRUFSQ0hfQklOUy5oYXMoYXJndlswXSkpIHtcbiAgICAgIGdhdGVkID0geyBraW5kOiAnc2VhcmNoJywgYXJndiwgc3RhcnQ6IDEsIGRpcjogbnVsbCwgZGlyVW5yZXNvbHZhYmxlOiBmYWxzZSB9O1xuICAgIH0gZWxzZSBpZiAoYXJndlswXSA9PT0gJ2dpdCcpIHtcbiAgICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3YpO1xuICAgICAgaWYgKHN1YiAhPT0gbnVsbCkge1xuICAgICAgICBjb25zdCBiYXNlID0geyBhcmd2LCBzdGFydDogc3ViLnN0YXJ0LCBkaXI6IHN1Yi5kaXIsIGRpclVucmVzb2x2YWJsZTogc3ViLmRpclVucmVzb2x2YWJsZSB9O1xuICAgICAgICBpZiAoc3ViLnN1YmNvbW1hbmQgPT09ICdncmVwJykgZ2F0ZWQgPSB7IGtpbmQ6ICdzZWFyY2gnLCAuLi5iYXNlIH07XG4gICAgICAgIC8vIGBnaXQgc2hvdyA8cmV2Pjo8cGF0aD5gIHN0cmVhbXMgdGhlIGJsb2IncyBSQVcgY29udGVudCwgbmV2ZXIgYVxuICAgICAgICAvLyBkaWZmIFx1MjAxNCBhIGRpZmYtc2hhcGVkIGJsb2IgbXVzdCBub3QgZGVjb2RlIGludG8gZmFicmljYXRlZCB0b3VjaGVzXG4gICAgICAgIC8vIG9uIHRoZSBmaWxlcyBpdHMgY29udGVudCBuYW1lcywgc28gdGhlIGNvbnRlbnQgaWRpb20gaXMgZXhjbHVkZWRcbiAgICAgICAgLy8gZnJvbSB0aGUgZGlmZiBnYXRlLiBgZ2l0IGRpZmYgPHJldj46PHBhdGg+YCBlcnJvcnMgaW5zdGVhZCBvZlxuICAgICAgICAvLyBlbWl0dGluZyBjb250ZW50LCBzbyBvbmx5IGBzaG93YCBuZWVkcyB0aGUgY2hlY2s7IHRoZSB0d28tYXJnXG4gICAgICAgIC8vIGJsb2ItYmxvYiBmb3JtIGBnaXQgZGlmZiA8cmV2Pjo8cGF0aD4gPHJldj46PHBhdGg+YCBET0VTIGVtaXQgYVxuICAgICAgICAvLyBkaWZmIG5hbWluZyB3b3JraW5nLXRyZWUgcGF0aHMgZ2l0IG5ldmVyIHJlYWQgYW5kIGlzIHJlamVjdGVkIGluXG4gICAgICAgIC8vIHRoZSBkaWZmIGJyYW5jaCBiZWxvdy5cbiAgICAgICAgZWxzZSBpZiAoc3ViLnN1YmNvbW1hbmQgPT09ICdzaG93JyAmJiAhaGFzUmV2UGF0aEFyZyhhcmd2LCBzdWIuc3RhcnQpKSBnYXRlZCA9IHsga2luZDogJ2RpZmYnLCAuLi5iYXNlIH07XG4gICAgICAgIGVsc2UgaWYgKHN1Yi5zdWJjb21tYW5kID09PSAnZGlmZicpIGdhdGVkID0geyBraW5kOiAnZGlmZicsIC4uLmJhc2UgfTtcbiAgICAgICAgZWxzZSBpZiAoc3ViLnN1YmNvbW1hbmQgPT09ICdsb2cnICYmIGhhc0RpZmZQYXRjaEZsYWcoYXJndiwgc3ViLnN0YXJ0KSkgZ2F0ZWQgPSB7IGtpbmQ6ICdkaWZmJywgLi4uYmFzZSB9O1xuICAgICAgICBlbHNlIGlmIChzdWIuc3ViY29tbWFuZCA9PT0gJ2JsYW1lJykgZ2F0ZWQgPSB7IGtpbmQ6ICdibGFtZScsIC4uLmJhc2UgfTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGdhdGVkID09PSBudWxsKSBjb250aW51ZTtcbiAgICBnYXRlZFByZWNlZGVkQnkgPSBzaW1wbGUucHJlY2VkZWRCeTtcbiAgICBnYXRlZFJlZGlyZWN0ID0gaGFzVW5xdW90ZWRSZWRpcmVjdChzaW1wbGUudGV4dCk7XG4gICAgZ2F0ZWRIZXJlZG9jID0gc2ltcGxlLmhlcmVkb2MgPz8gZmFsc2U7XG4gICAgLy8gRXZlcnkgT1RIRVIgc3RhZ2UncyByZWNvcmRzIGNhbiByZWFjaCB0aGUgcmVzcG9uc2UsIHNvIGVhY2ggbXVzdCBiZVxuICAgIC8vIHByb3ZhYmx5IHZlcmJhdGltIFx1MjAxNCB0aGUgZGVmYXVsdCBvZiBpc1JlbnVtYmVyaW5nRmlsdGVyIGlzIGNsb3NlZCwgc29cbiAgICAvLyBhbnkgYmluIG91dHNpZGUgdGhlIHZlcmJhdGltIGFsbG93bGlzdCAocHl0aG9uLCBydWJ5LCBtYXdrLCBcdTIwMjYpIG1heVxuICAgIC8vIHJlbnVtYmVyIG9yIHJld3JpdGUgdGhlIHJlY29yZHMsIGRlc3Ryb3kgdGhlIGZpbGUtbGluZSBtYXBwaW5nIHRoZXlcbiAgICAvLyBjYXJyeSwgYW5kIHRoZSBwaXBlbGluZSBmYWlscyBjbG9zZWQ6IGF0dHJpYnV0ZSBub3RoaW5nLiBUaGF0IGNvdmVyc1xuICAgIC8vIHRoZSBwaXBlIHN0YWdlcyBvZiB0aGUgc2FtZSBwaXBlbGluZSBBTkQgdGhlIGNoYWluIHNpYmxpbmdzIGpvaW5lZFxuICAgIC8vIGJ5IGA7YCwgYCYmYCwgYHx8YCwgYCZgLCBvciBhIG5ld2xpbmUgXHUyMDE0IGluIGVpdGhlciBkaXJlY3Rpb24gXHUyMDE0IHdob3NlXG4gICAgLy8gb3V0cHV0IG1peGVzIGludG8gdGhlIHNhbWUgcmVzcG9uc2U6IGEgY3JhZnRlZCBmaWxlIHJlYWQgYnkgYW55XG4gICAgLy8gc2libGluZyBkZWNvZGVzIGFzIHBoYW50b20gdG91Y2hlcywgc28gYSBjaGFpbiBpcyBhdHRyaWJ1dGFibGUgb25seVxuICAgIC8vIHdoZW4gZXZlcnkgc2libGluZyBwYXNzZXMgdGhlIHNhbWUgdmVyYmF0aW0gY2hlY2suIGBjZGAgc3RhZ2VzIGFyZVxuICAgIC8vIHNraXBwZWQgYWJvdmUgKHRoZWlyIG91dHB1dCBpcyBlbXB0eSksIGFuZCBhIGB8YC1qb2luZWQgZmVlZGVyXG4gICAgLy8gRUFSTElFUiBpbiB0aGUgcGlwZWxpbmUgaXMgY29uc3VtZWQgYnkgdGhlIGdhdGVkIHN0YWdlIFx1MjAxNCBhIHNlYXJjaFxuICAgIC8vIHdpdGggZXhwbGljaXQgcm9vdHMgaWdub3JlcyBzdGRpbiwgc28gdGhlIGZlZWRlcidzIHJlY29yZHMgbmV2ZXJcbiAgICAvLyByZWFjaCB0aGUgcmVzcG9uc2UuXG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBwYXJ0cy5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGogPT09IGkpIGNvbnRpbnVlO1xuICAgICAgaWYgKGogPCBpKSB7XG4gICAgICAgIC8vIEEgZmVlZGVyJ3Mgb3V0cHV0IGlzIGNvbnN1bWVkIG9ubHkgd2hlbiBFVkVSWSBwYXJ0IGJldHdlZW4gaXRcbiAgICAgICAgLy8gYW5kIHRoZSBnYXRlZCBzdGFnZSBpcyBwaXBlLWpvaW5lZCBcdTIwMTQgYSBgO2AvYCYmYC9cdTIwMjYgYW55d2hlcmUgaW5cbiAgICAgICAgLy8gYmV0d2VlbiBtYWtlcyBpdCBhIGNoYWluIHNpYmxpbmcgd2hvc2Ugb3V0cHV0IHJlYWNoZXMgdGhlXG4gICAgICAgIC8vIHJlc3BvbnNlICh0aHJvdWdoIHRoZSBzdGFnZXMgYmV0d2VlbiB0aGVtKS5cbiAgICAgICAgbGV0IGNvbnN1bWVkID0gdHJ1ZTtcbiAgICAgICAgZm9yIChsZXQgayA9IGogKyAxOyBrIDw9IGkgJiYgY29uc3VtZWQ7IGsrKykge1xuICAgICAgICAgIGlmIChwYXJ0c1trXS5wcmVjZWRlZEJ5ICE9PSAncGlwZScpIGNvbnN1bWVkID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNvbnN1bWVkKSBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHNpYmxpbmdUZXh0ID0gcGFydHNbal0udGV4dDtcbiAgICAgIGNvbnN0IHNpYmxpbmdBcmd2ID0gYXJndk9mKHNpYmxpbmdUZXh0KTtcbiAgICAgIGlmIChzaWJsaW5nQXJndiA9PT0gbnVsbCB8fCBzaWJsaW5nQXJndi5sZW5ndGggPT09IDAgfHwgc2libGluZ0FyZ3ZbMF0gPT09ICdjZCcpIGNvbnRpbnVlO1xuICAgICAgLy8gQW4gdW5xdW90ZWQgYDxgIFx1MjAxNCBldmVuIEdMVUVEIGluc2lkZSBhIGZsYWcsIHBhdHRlcm4sIG9yIHZhbHVlIHRva2VuXG4gICAgICAvLyAoYGhlYWQgLTI8Y3JhZnRlZC50eHRgLCBgZ3JlcCBuZWVkbGU8Y3JhZnRlZC50eHRgLCBgLWUgbmVlZGxlPGZgKSBcdTIwMTRcbiAgICAgIC8vIHJlZGlyZWN0cyB0aGUgc3RhZ2UncyBzdGRpbiB0byBhIGZpbGUsIHNvIGl0cyByZWNvcmRzIGNvbWUgZnJvbSB0aGF0XG4gICAgICAvLyBmaWxlLCBub3QgdGhlIHBpcGU6IGEgY3JhZnRlZCByZWNvcmQgZGVjb2RlcyBhcyBhIHBoYW50b20gdG91Y2gsIHNvXG4gICAgICAvLyBmYWlsIGNsb3NlZCBsaWtlIGFueSBvdGhlciBmaWxlIG9wZXJhbmQuIFF1b3RlLWF3YXJlOiBhIHF1b3RlZFxuICAgICAgLy8gbGl0ZXJhbCBgPGAgaW4gYSBwYXR0ZXJuIChgcmcgLW4gJzxkaXY+J2ApIGlzIG5vdCBhIHJlZGlyZWN0LlxuICAgICAgaWYgKGhhc1VucXVvdGVkUmVkaXJlY3Qoc2libGluZ1RleHQpKSByZXR1cm4gW107XG4gICAgICAvLyBBIGhlcmVkb2MgKGBjYXQgPDwnRU9GJ2ApIGZlZWRzIHRoZSBzdGFnZSdzIHN0ZGluIGZyb20gaXRzIEJPRFkgXHUyMDE0IGFcbiAgICAgIC8vIGNyYWZ0ZWQgYm9keSBpcyB0aGUgc2FtZSBmYWJyaWNhdGVkLXJlY29yZCBzb3VyY2UgYXMgYSBjcmFmdGVkIGZpbGUuXG4gICAgICAvLyBUaGUgc3BsaXR0ZXIgc3RyaXBzIGA8PGAgZnJvbSB0aGUgdGV4dCwgc28gb25seSB0aGUgcGVyLXN0YWdlIGZsYWdcbiAgICAgIC8vIHNlZXMgdGhlIHJlZGlyZWN0LlxuICAgICAgaWYgKHBhcnRzW2pdLmhlcmVkb2MpIHJldHVybiBbXTtcbiAgICAgIGlmIChpc1JlbnVtYmVyaW5nRmlsdGVyKHNpYmxpbmdBcmd2KSkgcmV0dXJuIFtdO1xuICAgIH1cbiAgfVxuICBpZiAoZ2F0ZWQgPT09IG51bGwgfHwgZ2F0ZWQuZGlyVW5yZXNvbHZhYmxlKSByZXR1cm4gW107XG5cbiAgLy8gVGhlIGRpcmVjdG9yeSBzZWFyY2ggcGF0aHMgYXJlIHJlbGF0aXZlIHRvIFx1MjAxNCB0aGUgYGdpdCAtQ2AgdGFyZ2V0IHdoZW5cbiAgLy8gcHJlc2VudCwgb3RoZXJ3aXNlIHRoZSBzaGVsbCBjd2QgYWZ0ZXIgYW55IGBjZGAuXG4gIGNvbnN0IGVmZmVjdGl2ZURpciA9IGdhdGVkLmRpciAhPT0gbnVsbCA/IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGdhdGVkLmRpcikgOiBjdXJyZW50RGlyO1xuXG4gIC8vIGBnaXQgYmxhbWUgLUwgTixNIGZpbGVgIHJlc29sdmVzIHN0cmFpZ2h0IGZyb20gdGhlIGNvbW1hbmQgdGV4dDsgdGhlXG4gIC8vIHJlc3BvbnNlJ3MgY29udGVudCBpcyBpcnJlbGV2YW50IHRvIGl0LCBzbyB0aGUgQU5TSSByZWplY3Rpb24gYW5kIHRoZVxuICAvLyB0cnVuY2F0aW9uIGdhdGUgYmVsb3cgXHUyMDE0IGJvdGggcmVzcG9uc2UtZGVyaXZlZCBkZWNvZGUgZ2F0ZXMgXHUyMDE0IG11c3Qgbm90XG4gIC8vIHN1cHByZXNzIGl0LlxuICBpZiAoZ2F0ZWQua2luZCA9PT0gJ2JsYW1lJykge1xuICAgIGNvbnN0IG0gPSBtYXRjaEJsYW1lUmFuZ2UoZ2F0ZWQuYXJndiwgZ2F0ZWQuc3RhcnQpO1xuICAgIGlmIChtID09PSBudWxsIHx8IGhhc1NoZWxsRXhwYW5zaW9uKG0uZmlsZUFyZykgfHwgL1sqP10vLnRlc3QobS5maWxlQXJnKSkgcmV0dXJuIFtdO1xuICAgIHJldHVybiBbeyBsaW5lU3RhcnQ6IG0ubGluZVN0YXJ0LCBsaW5lRW5kOiBtLmxpbmVFbmQsIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZWZmZWN0aXZlRGlyLCBtLmZpbGVBcmcpIH1dO1xuICB9XG5cbiAgLy8gQU5TSSBlc2NhcGUgYnl0ZXMgcmVqZWN0IHRoZSB3aG9sZSBwYXJzZTogbmVpdGhlciByZy9ncmVwIG5vciBnaXQgZW1pdFxuICAvLyBjb2xvciB3aGVuIHBpcGVkLCBzbyBhbiBFU0MgYnl0ZSBtZWFucyBzb21ldGhpbmcgZGVsaWJlcmF0ZSBpcyBnb2luZyBvbi5cbiAgaWYgKHN0ZG91dC5pbmNsdWRlcygnXFx1MDAxYicpKSByZXR1cm4gW107XG5cbiAgLy8gVGhlIGFkYXB0ZXItc3VwcGxpZWQgdHJ1bmNhdGVkIGZsYWcgKENsYXVkZSByYXdPdXRwdXRQYXRoIHNldCBcdTIxRDIgaW5saW5lXG4gIC8vIHN0ZG91dCBpcyBvbmx5IGEgcHJldmlldykgZGVjbGFyZXMgdGhlIHJlc3BvbnNlLWRlcml2ZWQgZGVjb2RlXG4gIC8vIHVudHJ1c3R3b3J0aHkgXHUyMDE0IGZhaWwgY2xvc2VkLCBwYXJzZSBub3RoaW5nLCBpbnZlbnQgbm8gdG91Y2hlcy5cbiAgLy8gYGludGVycnVwdGVkYCBpcyB0aGUgcGxhbidzIGNvbXBsZXRlLXJlY29yZHMgcmVnaW1lOiBmdWxseS10ZXJtaW5hdGVkXG4gIC8vIHJlY29yZHMgcGFyc2UgYW5kIHRoZSBpbmNvbXBsZXRlIHRhaWwgZHJvcHMgdmlhIHRoZSB1bmNvbmRpdGlvbmFsXG4gIC8vIHRlcm1pbmF0aW5nLW5ld2xpbmUgcnVsZSwgd2hpY2ggdGhlIGRlZmF1bHQgcGF0aCBhbHJlYWR5IGFwcGxpZXMuXG4gIGlmIChpbnB1dC50cnVuY2F0ZWQpIHJldHVybiBbXTtcblxuICBpZiAoZ2F0ZWQua2luZCA9PT0gJ2RpZmYnKSB7XG4gICAgLy8gVHdvLWFyZyBibG9iLWJsb2IgYGdpdCBkaWZmIDxyZXY+OjxwYXRoPiA8cmV2Pjo8cGF0aD5gIGVtaXRzIGEgbm9ybWFsXG4gICAgLy8gdW5pZmllZCBkaWZmIG5hbWluZyB3b3JraW5nLXRyZWUgcGF0aHMgd2hpbGUgZ2l0IHJlYWRzIG9ubHkgaGlzdG9yaWNhbFxuICAgIC8vIGJsb2JzIFx1MjAxNCBkZWNvZGluZyBpdCB3b3VsZCBmYWJyaWNhdGUgdG91Y2hlcyBvbiBmaWxlcyBnaXQgbmV2ZXIgcmVhZCxcbiAgICAvLyBzbyBhIHBvc2l0aW9uYWwgY2FycnlpbmcgYHJldjpwYXRoYCAoYW55IGA6YC1jb250YWluaW5nIHBvc2l0aW9uYWxcbiAgICAvLyB0aGF0IGlzIG5vdCBhbiBleGlzdGluZyBmaWxlKSByZWplY3RzIHRoZSBkZWNvZGUgb3V0cmlnaHQuXG4gICAgaWYgKGhhc0RpZmZSZXZQYXRoQXJnKGdhdGVkLmFyZ3YsIGdhdGVkLnN0YXJ0LCBlZmZlY3RpdmVEaXIpKSByZXR1cm4gW107XG4gICAgLy8gRGlmZi1mb3JtIHBhdGhzIGFyZSByZXBvLXJvb3QtcmVsYXRpdmUgcmVnYXJkbGVzcyBvZiBjd2QsIHNvIHRoZXlcbiAgICAvLyByZXNvbHZlIGFnYWluc3QgdGhlIHdvcmt0cmVlIHJvb3QgZGlzY292ZXJlZCBmcm9tIHRoZSBlZmZlY3RpdmUgZGlyXG4gICAgLy8gKGEgYC5naXRgIGVudHJ5IG1hcmtzIGl0IFx1MjAxNCBubyBzdWJwcm9jZXNzKS4gVGhlIHJlcG8gcm9vdCBpcyBhbHNvIHRoZVxuICAgIC8vIHBlcm1pdHRlZCByb290OiBhIHRyYXZlcnNhbCBwYXRoIG5vcm1hbGl6ZXMgb3V0c2lkZSBpdCBhbmQgaXMgcmVqZWN0ZWRcbiAgICAvLyBieSB0aGUgc2FtZSBjb250YWlubWVudCBjaGVjay4gYC0tcmVsYXRpdmVgIChiYXJlKSByZS1hbmNob3JzIHRvIHRoZVxuICAgIC8vIGN3ZCBhbmQgYC0tcmVsYXRpdmU9PHBhdGg+YCB0byBhIHBhdGggcmVzb2x2ZWQgYWdhaW5zdCB0aGUgd29ya3RyZWVcbiAgICAvLyByb290IFx1MjAxNCBib3RoIGRlY29kZSBhZ2FpbnN0IHRoYXQgYmFzZSBpbnN0ZWFkIChhIHNoZWxsLWV4cGFuZGVkIG9yXG4gICAgLy8gZW1wdHkgdmFsdWUgaXMgdW5yZXNvbHZhYmxlIGFuZCBmYWlscyBjbG9zZWQpLlxuICAgIGNvbnN0IHJlcG9Sb290ID0gZmluZEdpdFJvb3QoZWZmZWN0aXZlRGlyKTtcbiAgICBpZiAocmVwb1Jvb3QgPT09IG51bGwpIHJldHVybiBbXTtcbiAgICBjb25zdCByZWxhdGl2ZSA9IGRpZmZSZWxhdGl2ZUJhc2UoZ2F0ZWQuYXJndiwgZ2F0ZWQuc3RhcnQsIGVmZmVjdGl2ZURpciwgcmVwb1Jvb3QpO1xuICAgIGlmIChyZWxhdGl2ZSA9PT0gJ3VucmVzb2x2YWJsZScpIHJldHVybiBbXTtcbiAgICBjb25zdCBiYXNlID0gcmVsYXRpdmUgIT09IG51bGwgPyByZWxhdGl2ZS5iYXNlIDogcmVwb1Jvb3Q7XG4gICAgY29uc3Qgcm9vdHMgPSByZWxhdGl2ZSAhPT0gbnVsbCA/IFtyZWxhdGl2ZS5yb290XSA6IFtyZXBvUm9vdF07XG4gICAgcmV0dXJuIGNhcFNwYW5zKHNwYW5zRm9yKGRlY29kZVVuaWZpZWREaWZmKHN0ZG91dCksIGJhc2UsIHJvb3RzKSk7XG4gIH1cblxuICBjb25zdCBpbmZvID0gYW5hbHl6ZVNlYXJjaEFyZ3YoZ2F0ZWQuYXJndiwgZ2F0ZWQuc3RhcnQpO1xuXG4gIC8vIEEgbm9uLWdpdCBzZWFyY2ggYmluIHdpdGggbm8gcGF0aCBhcmdzIHJlYWRzIGl0cyByZWNvcmRzIGZyb20gd2hhdGV2ZXJcbiAgLy8gc3RkaW4gY2FycmllcyB3aGVuIGl0IGlzIHBpcGVkIG9yIHJlZGlyZWN0ZWQgaW4gKGB8YCwgYDwgZmlsZWAsXG4gIC8vIGA8PDxgLCBgPChcdTIwMjYpYCkgXHUyMDE0IGxpbmUgbnVtYmVycyBhcmUgdGhlbiBzdHJlYW0gcG9zaXRpb25zLCBub3QgZmlsZVxuICAvLyBsaW5lcywgYW5kIGRlY29kaW5nIHRoZW0gZmFicmljYXRlcyB0b3VjaGVzIChhIHN0ZGluIGxpbmUgXCI5XCIgYmVjb21lcyBhXG4gIC8vIHBhdGgsIGFuZCB3aXRoIGEgcmVhbCBmaWxlIG5hbWVkIGA5YCBhdCB0aGUgY3dkIHRoZSBwaGFudG9tIHN1cmZhY2VzKS5cbiAgLy8gZ2F0ZWRSZWRpcmVjdCBleHRlbmRzIHRoZSBydWxlIHRvIGEgcmVkaXJlY3QgR0xVRUQgaW5zaWRlIGEgdG9rZW5cbiAgLy8gKGByZyBuZWVkbGU8Y3JhZnRlZC50eHRgLCBhIGNvbnN1bWVkIGAtZWAvYC1mYCB2YWx1ZSk6IGFyZ3Ygc3BsaXR0aW5nXG4gIC8vIG5ldmVyIHN1cmZhY2VzIGEgc3RhbmRhbG9uZSBgPGAgdG9rZW4sIHNvIG9ubHkgdGhlIHF1b3RlLWF3YXJlIHJhdy10ZXh0XG4gIC8vIHNjYW4gc2VlcyBpdC4gZ2F0ZWRIZXJlZG9jIGV4dGVuZHMgaXQgdG8gYSBgPDxgL2A8PC1gIEhFUkVET0MgYm9keSBcdTIwMTQgdGhlXG4gIC8vIHNwbGl0dGVyIHN0cmlwcyB0aGUgb3BlcmF0b3IgZnJvbSB0aGUgdGV4dCwgc28gb25seSB0aGUgcGVyLXN0YWdlIGZsYWdcbiAgLy8gc2VlcyB0aGUgcmVkaXJlY3QuIEZhaWwgY2xvc2VkOiBubyByZXNwb25zZS1kZXJpdmVkIHNwYW5zLiBFeHBsaWNpdFxuICAvLyBwYXRoIGFyZ3Mgc2NvcGUgdGhlIHNlYXJjaCB0byBmaWxlcyAodGhlIHJlZGlyZWN0L3BpcGUgaXMgdGhlblxuICAvLyBpcnJlbGV2YW50KSwgYW5kIGBnaXQgZ3JlcGAgbmV2ZXIgcmVhZHMgc3RkaW4gXHUyMDE0IGJvdGggc3RheSBvcGVuLlxuICBjb25zdCBzdGRpbkZlZCA9XG4gICAgZ2F0ZWQua2luZCA9PT0gJ3NlYXJjaCcgJiZcbiAgICBnYXRlZC5hcmd2WzBdICE9PSAnZ2l0JyAmJlxuICAgIGluZm8ucGF0aEFyZ3MubGVuZ3RoID09PSAwICYmXG4gICAgKGdhdGVkUHJlY2VkZWRCeSA9PT0gJ3BpcGUnIHx8IGluZm8uc3RkaW5SZWRpcmVjdCB8fCBnYXRlZFJlZGlyZWN0IHx8IGdhdGVkSGVyZWRvYyk7XG4gIGlmIChzdGRpbkZlZCkgcmV0dXJuIFtdO1xuXG4gIC8vIGdpdCBncmVwIHNjb3Bpbmc6IHBsYWluIGludm9jYXRpb24gZnJvbSBhIHN1YmRpciBpcyBzY29wZWQgdG8gdGhlIHN1YmRpclxuICAvLyBieSBnaXQgaXRzZWxmIChyZWNvcmRzIGFyZSBjd2QtcmVsYXRpdmUsIHJvb3Qgc3RheXMgdGhlIGVmZmVjdGl2ZSBkaXIpO1xuICAvLyBwYXRoc3BlYyBtYWdpYyAoYDovYCwgYDohYCwgYDpeYCwgYDooLi4uKWApIHNlYXJjaGVzIHRoZSB3aG9sZSB0cmVlIGFuZFxuICAvLyBlbWl0cyBjd2QtcmVsYXRpdmUgcmVjb3JkcyB3aXRoIGAuLi9gIHByZWZpeGVzLCBzbyB0aGUgcGVybWl0dGVkIHJvb3RcbiAgLy8gd2lkZW5zIHRvIHRoZSB3b3JrdHJlZSByb290OyBgLS1mdWxsLW5hbWVgIHJlLWFuY2hvcnMgcmVjb3JkcyB0b1xuICAvLyByZXBvLXJvb3QtcmVsYXRpdmUgcGF0aHMsIHdoaWNoIHJlc29sdmVzIGFnYWluc3QgdGhlIHdvcmt0cmVlIHJvb3QgdG9vLlxuICBjb25zdCBpc0dpdEdyZXAgPSBnYXRlZC5raW5kID09PSAnc2VhcmNoJyAmJiBnYXRlZC5hcmd2WzBdID09PSAnZ2l0JztcbiAgY29uc3QgZnVsbE5hbWUgPSBpc0dpdEdyZXAgJiYgaGFzRmxhZyhnYXRlZC5hcmd2LCBnYXRlZC5zdGFydCwgJy0tZnVsbC1uYW1lJyk7XG4gIGNvbnN0IG1hZ2ljID0gaXNHaXRHcmVwICYmIGluZm8ucGF0aHNwZWNNYWdpYztcbiAgY29uc3Qgd29ya3RyZWVSb290ID0gbWFnaWMgfHwgZnVsbE5hbWUgPyBmaW5kR2l0Um9vdChlZmZlY3RpdmVEaXIpIDogbnVsbDtcbiAgaWYgKChtYWdpYyB8fCBmdWxsTmFtZSkgJiYgd29ya3RyZWVSb290ID09PSBudWxsKSByZXR1cm4gW107XG5cbiAgLy8gV2hlcmUgZGVjb2RlZCByZWNvcmQgcGF0aHMgcmVzb2x2ZSBmcm9tOiB0aGUgZWZmZWN0aXZlIGN3ZCBmb3IgcGxhaW5cbiAgLy8gYW5kIG1hZ2ljIGdpdCBncmVwIChyZWNvcmRzIGFyZSBjd2QtcmVsYXRpdmUpLCB0aGUgd29ya3RyZWUgcm9vdCBmb3JcbiAgLy8gYC0tZnVsbC1uYW1lYCAocmVjb3JkcyBhcmUgcmVwby1yb290LXJlbGF0aXZlKS5cbiAgY29uc3QgYmFzZSA9IGZ1bGxOYW1lICYmIHdvcmt0cmVlUm9vdCAhPT0gbnVsbCA/IHdvcmt0cmVlUm9vdCA6IGVmZmVjdGl2ZURpcjtcblxuICAvLyBQZXJtaXR0ZWQgcm9vdHM6IHRoZSBjb21tYW5kJ3MgZXhwbGljaXQgc2VhcmNoIHJvb3RzLCBvciB0aGUgZWZmZWN0aXZlXG4gIC8vIGN3ZCB3aGVuIG5vIHBhdGggYXJncyBhcmUgZ2l2ZW4gKHJnL2dyZXAgc2VhcmNoIGl0IGJ5IGRlZmF1bHQpIFx1MjAxNCBleGNlcHRcbiAgLy8gZ2l0IGdyZXAgd2l0aCBwYXRoc3BlYyBtYWdpYywgd2hpY2ggc2VhcmNoZXMgdGhlIHdob2xlIHRyZWUgYW5kIG11c3QgYmVcbiAgLy8gcGVybWl0dGVkIGFnYWluc3QgdGhlIHdvcmt0cmVlIHJvb3QuXG4gIGNvbnN0IHJvb3RzID1cbiAgICBtYWdpYyAmJiB3b3JrdHJlZVJvb3QgIT09IG51bGxcbiAgICAgID8gW3dvcmt0cmVlUm9vdF1cbiAgICAgIDogaW5mby5wYXRoQXJncy5sZW5ndGggPiAwXG4gICAgICAgID8gaW5mby5wYXRoQXJncy5tYXAoKHApID0+IHJlc29sdmVQYXRoKGVmZmVjdGl2ZURpciwgcCkpXG4gICAgICAgIDogW2VmZmVjdGl2ZURpcl07XG5cbiAgY29uc3Qgc2luZ2xlRmlsZUFyZyA9IGluZm8ucGF0aEFyZ3MubGVuZ3RoID09PSAxID8gaW5mby5wYXRoQXJnc1swXSA6IG51bGw7XG4gIC8vIE9uZS1maWxlIGVsaWdpYmlsaXR5OiBudW1iZXJlZCBldmlkZW5jZSwgZXhhY3RseSBvbmUgZXhwbGljaXQgZmlsZVxuICAvLyBhcmd1bWVudCB0aGF0IGlzIGEgcmVhbCBmaWxlIChhIGRpcmVjdG9yeSBvciBubyBhcmdzIG1lYW5zIHJlY29yZHMgY2FycnlcbiAgLy8gcGF0aCBwcmVmaXhlcyksIGFuZCBubyAtSC8tLXdpdGgtZmlsZW5hbWUgKHdoaWNoIGZvcmNlcyBwYXRoIHByZWZpeGVzKS5cbiAgY29uc3Qgb25lRmlsZUVsaWdpYmxlID1cbiAgICBpbmZvLm51bWJlcmVkICYmICFpbmZvLndpdGhGaWxlbmFtZSAmJiBzaW5nbGVGaWxlQXJnICE9PSBudWxsICYmIGlzRmlsZShyZXNvbHZlUGF0aChlZmZlY3RpdmVEaXIsIHNpbmdsZUZpbGVBcmcpKTtcblxuICBjb25zdCBsYXlvdXQgPSBkZXRlY3RMYXlvdXQoc3Rkb3V0LCBpbmZvLCBvbmVGaWxlRWxpZ2libGUpO1xuXG4gIGNvbnN0IHBlckZpbGUgPSBuZXcgTWFwPHN0cmluZywgU2V0PG51bWJlcj4+KCk7XG4gIGlmIChsYXlvdXQgIT09IG51bGwpIHtcbiAgICBmb3IgKGNvbnN0IHJlYyBvZiBkZWNvZGVTZWFyY2hMYXlvdXQobGF5b3V0LCBzdGRvdXQsIHNpbmdsZUZpbGVBcmcpKSB7XG4gICAgICAvLyBEZWNvZGVkIHBhdGhzIG11c3QgYmUgcmVhbCBmaWxlczogYSByZWN1cnNpdmUtbGF5b3V0IHJlY29yZCB3aG9zZVxuICAgICAgLy8gcGF0aCBpcyBub3QgYW4gZXhpc3RpbmcgcmVndWxhciBmaWxlIChyZXNvbHZlZCBhZ2FpbnN0IHRoZSByZWNvcmRcbiAgICAgIC8vIGJhc2UgXHUyMDE0IHRoZSBlZmZlY3RpdmUgY3dkLCBvciB0aGUgd29ya3RyZWUgcm9vdCB1bmRlciBgLS1mdWxsLW5hbWVgKVxuICAgICAgLy8gZHJvcHMgaW5zdGVhZCBvZiBmYWJyaWNhdGluZyBhIHRvdWNoLlxuICAgICAgaWYgKGxheW91dCA9PT0gJ3JlY3Vyc2l2ZScgJiYgIWlzRmlsZShyZXNvbHZlUGF0aChiYXNlLCByZWMucGF0aCkpKSBjb250aW51ZTtcbiAgICAgIGlmIChyZWMubGluZSA9PT0gbnVsbCkge1xuICAgICAgICAvLyBXaG9sZS1maWxlIG51bGwtc2VwYXJhdGVkIHJlY29yZDogdGhlIHRleHQgaG9sZHMgdGhlIGVudGlyZSBmaWxlLlxuICAgICAgICBjb25zdCB0b3RhbCA9IGxpbmVDb3VudChyZWMudGV4dCk7XG4gICAgICAgIGxldCBsaW5lcyA9IHBlckZpbGUuZ2V0KHJlYy5wYXRoKTtcbiAgICAgICAgaWYgKGxpbmVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBsaW5lcyA9IG5ldyBTZXQoKTtcbiAgICAgICAgICBwZXJGaWxlLnNldChyZWMucGF0aCwgbGluZXMpO1xuICAgICAgICB9XG4gICAgICAgIGZvciAobGV0IG4gPSAxOyBuIDw9IHRvdGFsOyBuKyspIGxpbmVzLmFkZChuKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxldCBsaW5lcyA9IHBlckZpbGUuZ2V0KHJlYy5wYXRoKTtcbiAgICAgICAgaWYgKGxpbmVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBsaW5lcyA9IG5ldyBTZXQoKTtcbiAgICAgICAgICBwZXJGaWxlLnNldChyZWMucGF0aCwgbGluZXMpO1xuICAgICAgICB9XG4gICAgICAgIGxpbmVzLmFkZChyZWMubGluZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgY29uc3Qgc3BhbnMgPSBzcGFuc0ZvcihwZXJGaWxlLCBiYXNlLCByb290cyk7XG5cbiAgLy8gV2hvbGUtZmlsZSBmYWxsYmFjazogbm9uLWVtcHR5LCBmdWxseSBvYnNlcnZlZCBvdXRwdXQgKGl0cyB0ZXJtaW5hdGluZ1xuICAvLyBuZXdsaW5lIGlzIHByZXNlbnQpIHdpdGggbm8gcGFyc2VhYmxlIG51bWJlcmVkIHJlY29yZCwgYW4gdW5udW1iZXJlZFxuICAvLyBjb21tYW5kIChhIG51bWJlcmVkIGNvbW1hbmQgXHUyMDE0IGdyZXAgLW4sIG5sLCBjYXQgLW4gXHUyMDE0IHdob3NlIG91dHB1dFxuICAvLyBjYXJyaWVzIG5vIHBhcnNlYWJsZSByZWNvcmQgbXVzdCBub3QgZmFsbCBiYWNrIGVpdGhlcjogaXRzIHJlY29yZHMgYXJlXG4gIC8vIHN0cmVhbSBwb3NpdGlvbnMgb3IgZ2FyYmFnZSwgYW5kIHRoZSB3aG9sZS1maWxlIHNwYW4gd291bGQgZmFicmljYXRlIGFcbiAgLy8gcmVhZCB0aGUgcmVzcG9uc2UgbmV2ZXIgZXZpZGVuY2VkKSwgYW5kIGV4YWN0bHkgb25lIGV4cGxpY2l0IGZpbGVcbiAgLy8gcmVzb2x2ZXMgdG8gYSB3aG9sZS1maWxlIHJlYWQgb2YgaXQuIFRoZSB1bml2ZXJzYWwgdGVybWluYXRpbmctbmV3bGluZVxuICAvLyBydWxlIGFwcGxpZXMgaGVyZSB0b286IGEgc3RyZWFtIGN1dCBiZWZvcmUgYW55IGNvbXBsZXRlIHJlY29yZCBpcyBub3RcbiAgLy8gZnVsbHkgb2JzZXJ2ZWQsIHNvIGEgcHJldmlldyBvZiBhIG51bWJlcmVkIG91dHB1dCBtdXN0IG5vdCBiZSBtaXN0YWtlblxuICAvLyBmb3IgdW5udW1iZXJlZCBvdXRwdXQgYW5kIG11c3Qgbm90IGludmVudCBhIHdob2xlLWZpbGUgdG91Y2guIFRoZSBmaWxlXG4gIC8vIG11c3QgYmUgYSByZWFkYWJsZSBmaWxlIChhIGRpcmVjdG9yeSBhcmcgbGVhdmVzIHRoZSBmYWxsYmFja1xuICAvLyB1bnJlc29sdmVkKSwgYW5kIGl0IG11c3Qgc2l0IGluc2lkZSB0aGUgZGVjbGFyZWQgcm9vdHMgXHUyMDE0IGl0IGlzIG9uZSBvZlxuICAvLyB0aGVtIGJ5IGNvbnN0cnVjdGlvbi5cbiAgaWYgKHBlckZpbGUuc2l6ZSA9PT0gMCAmJiAhaW5mby5udW1iZXJlZCAmJiBzdGRvdXQgIT09ICcnICYmIHN0ZG91dC5lbmRzV2l0aCgnXFxuJykgJiYgc2luZ2xlRmlsZUFyZyAhPT0gbnVsbCkge1xuICAgIGNvbnN0IGFicyA9IHJlc29sdmVQYXRoKGVmZmVjdGl2ZURpciwgc2luZ2xlRmlsZUFyZyk7XG4gICAgY29uc3QgdG90YWwgPSBjb3VudEZpbGVMaW5lcyhhYnMpO1xuICAgIGlmICh0b3RhbCAhPT0gbnVsbCAmJiB0b3RhbCA+IDApIHtcbiAgICAgIHNwYW5zLnB1c2goeyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IHRvdGFsLCBhYnNvbHV0ZVBhdGg6IGFicyB9KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gY2FwU3BhbnMoc3BhbnMpO1xufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBzcGFuLXN1cmZhY2luZyBjb3JlLlxuICpcbiAqIEdpdmVuIGFuIGFscmVhZHktcmVzb2x2ZWQgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCBhIGxpbmUgcmFuZ2UsIHRoaXMgbW9kdWxlXG4gKiBydW5zIHRoZSBzaGFyZWQgYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW5gIC8gYC5ob29raWdub3JlYCAvIHNlc3Npb24tbWVtbyAvXG4gKiBgZ2l0IHNwYW4gZHJpZnRgIHBpcGVsaW5lIGFuZCBhc3NlbWJsZXMgdGhlIGh1bWFuLXJlYWRhYmxlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gXG4gKiBibG9jayB0aGF0IGJvdGggYWRhcHRlcnMgc3VyZmFjZSBpbmxpbmUgYmVmb3JlIGFuIGVkaXQuIEl0IGltcG9ydHMgbm90aGluZ1xuICogZnJvbSBlaXRoZXIgaG9vayBTREs6IHRoZSBDbGF1ZGUgUHJlVG9vbFVzZSBob29rIGZlZWRzIGl0IGEgcmFuZ2UgZGVyaXZlZCBmcm9tXG4gKiBgZmlsZV9wYXRoYC9gb2Zmc2V0YC9gb2xkX3N0cmluZ2A7IHRoZSBDb2RleCBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgdGhlXG4gKiByYW5nZXMgcmVjb3ZlcmVkIGZyb20gYW4gYGFwcGx5X3BhdGNoYCBlbnZlbG9wZS4gRWFjaCBhZGFwdGVyIHdyYXBzIHRoZVxuICogcmV0dXJuZWQgYmxvY2sgc3RyaW5nIGluIGl0cyBvd24gU0RLIG91dHB1dCBidWlsZGVyLlxuICpcbiAqIFRoZSBleGVjdXRvci9kcmlmdC9tZW1vIGRlcGVuZGVuY2llcyBhcmUgaW5qZWN0ZWQgc28gdGhlIHBpcGVsaW5lIGlzIHRlc3RhYmxlXG4gKiB3aXRoIGZha2VzIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlIHNoYXJlZCBrZXJuZWwuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7XG4gIGlzR2l0SWdub3JlZCxcbiAgaXNJbnNpZGVTcGFuUm9vdCxcbiAgdHlwZSBMaW5lUmFuZ2UsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcHJ1bmVTdGFsZVNlc3Npb25zLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdCxcbiAgc2Vzc2lvbkRpcixcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyB0eXBlIEhvb2tJZ25vcmVMb2FkZXIsIGlzU3BhblN1cHByZXNzZWQgfSBmcm9tICcuL3NwYW4taWdub3JlLmpzJztcblxuLyoqXG4gKiBNaW5pbWFsIGxvZ2dlciBzdXJmYWNlIHRoZSBgY29tbW9uL2AgbGF5ZXIgbG9ncyB0aHJvdWdoOyBib3RoIFNESyBsb2dnZXJzXG4gKiBzYXRpc2Z5IGl0LiBgd2FybmAgaXMgcmVxdWlyZWQgXHUyMDE0IGV2ZXJ5IGV4aXN0aW5nIGNhbGwgc2l0ZSByZXBvcnRzIGEgZmFpbHVyZS5cbiAqIGBpbmZvYCBpcyBvcHRpb25hbCBzbyBhIGZha2UgY2Fycnlpbmcgb25seSBgd2FybmAgc3RpbGwgc2F0aXNmaWVzIHRoZVxuICogaW50ZXJmYWNlOiBpdCBleGlzdHMgZm9yIHRoZSBkaWFnbm9zdGljIGJyZWFkY3J1bWJzIGEgKnN1Y2Nlc3NmdWwqIHJ1biBsZWF2ZXNcbiAqIGJlaGluZCAoYWR2aXNvci1jb3JlJ3MgY2h1cm4tc3VwcHJlc3Npb24gY291bnQpLCB3aGljaCBhcmUgbm90IHdhcm5pbmdzIGFuZFxuICogbXVzdCBub3QgcmVhZCBhcyBmYWlsdXJlcyBpbiB0aGUgaG9vayBsb2cuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29yZUxvZ2dlciB7XG4gIHdhcm4obWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkO1xuICBpbmZvPyhtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3BhbiBleGVjdXRvciBhYnN0cmFjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRXhlY3V0ZXMgYGdpdCBzcGFuIGxpc3RgIHdpdGggZ2l2ZW4gYXJncyBpbiBhIGdpdmVuIGN3ZC5cbiAqIFJldHVybnMgc3Rkb3V0IHN0cmluZy4gVGhyb3dzIG9uIG5vbi16ZXJvIGV4aXQuXG4gKi9cbmV4cG9ydCB0eXBlIFNwYW5FeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRTcGFuRXhlY3V0b3IodGltZW91dE1zID0gMTBfMDAwKTogU3BhbkV4ZWN1dG9yIHtcbiAgcmV0dXJuIChhcmdzLCBjd2QpID0+IHtcbiAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsIC4uLmFyZ3NdLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gIH07XG59XG5cbi8qKlxuICogUnVucyBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluIDxzbHVncz5gIGFuZCByZXR1cm5zIGl0cyBwb3JjZWxhaW4gc3Rkb3V0IFx1MjAxNFxuICogb25lIHJvdyBwZXIgKmRyaWZ0ZWQqIGFuY2hvciBhbW9uZyB0aGUgZ2l2ZW4gc3BhbnMsIGVtcHR5IHdoZW4gYWxsIGFyZSBjbGVhbi5cbiAqIGBnaXQgc3BhbiBkcmlmdGAgZXhpdHMgMCBpbiBwb3JjZWxhaW4gbW9kZSB3aGV0aGVyIG9yIG5vdCBkcmlmdCBleGlzdHMsIGJ1dCB3ZVxuICogc3RpbGwgY2FwdHVyZSBzdGRvdXQgZnJvbSBhIHRocm93biBlcnJvciBzbyBhIGRyaWZ0IHNpZ25hbCBpcyBuZXZlciBsb3N0IHRvIGFcbiAqIG5vbi16ZXJvIGV4aXQuIFRocm93cyBvbmx5IHdoZW4gbm8gc3Rkb3V0IGlzIGF2YWlsYWJsZSAoZ2VudWluZSBmYWlsdXJlKS5cbiAqL1xuZXhwb3J0IHR5cGUgRHJpZnRFeGVjdXRvciA9IChzbHVnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBzdHJpbmc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0RHJpZnRFeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBEcmlmdEV4ZWN1dG9yIHtcbiAgcmV0dXJuIChzbHVncywgY3dkKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zbHVnc10sIHtcbiAgICAgICAgY3dkLFxuICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgIGlmICh0eXBlb2Ygb3V0ID09PSAnc3RyaW5nJykgcmV0dXJuIG91dDtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBtZW1vIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBNZW1vU3RvcmUge1xuICBnZXRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZyk6IFNldDxzdHJpbmc+O1xuICBhZGRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZywgbmFtZXM6IHN0cmluZ1tdKTogdm9pZDtcbn1cblxuLy8gTGl2ZXMgdW5kZXIgdGhlIHNoYXJlZCBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgKGFnZW50LWhvb2tzLWNvbW1vbi50cydzXG4vLyBzZXNzaW9uRGlyKSBcdTIwMTQgcmVsb2NhdGVkIGZyb20gb3MudG1wZGlyKCkvYWdlbnQtaG9va3MtZ2l0LXNwYW4vIHNvXG4vLyBwZXItc2Vzc2lvbiBzdGF0ZSBoYXMgb25lIGhvbWUgYW5kIGlzIGNvdmVyZWQgYnkgcHJ1bmVTdGFsZVNlc3Npb25zJ3Ncbi8vIG9wcG9ydHVuaXN0aWMgPjMwLWRheSBwcnVuaW5nLlxuZnVuY3Rpb24gbWVtb0ZpbGVQYXRoKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oc2Vzc2lvbkRpcihzZXNzaW9uSWQpLCAndG91Y2gtbWVtby5qc29uJyk7XG59XG5cbmV4cG9ydCB0eXBlIE1lbW9Mb2dnZXIgPSBDb3JlTG9nZ2VyO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4ge1xuICAgIGdldFN1cmZhY2VkKHNlc3Npb25JZCkge1xuICAgICAgcHJ1bmVTdGFsZVNlc3Npb25zKCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByYXcgPSBmcy5yZWFkRmlsZVN5bmMobWVtb0ZpbGVQYXRoKHNlc3Npb25JZCksICd1dGY4Jyk7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KSBhcyB7IHN1cmZhY2VkPzogdW5rbm93biB9O1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQuc3VyZmFjZWQpKSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBTZXQocGFyc2VkLnN1cmZhY2VkIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHJlYWQgZmFpbGVkICh0cmVhdGluZyBhcyBlbXB0eSknLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgU2V0KCk7XG4gICAgfSxcbiAgICBhZGRTdXJmYWNlZChzZXNzaW9uSWQsIG5hbWVzKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICAgICAgZm9yIChjb25zdCBuIG9mIG5hbWVzKSBleGlzdGluZy5hZGQobik7XG4gICAgICBjb25zdCBtZW1vRGlyID0gc2Vzc2lvbkRpcihzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgbWVtb1BhdGggPSBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKTtcbiAgICAgIGNvbnN0IHRtcFBhdGggPSBgJHttZW1vUGF0aH0udG1wYDtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZzLm1rZGlyU3luYyhtZW1vRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBKU09OLnN0cmluZ2lmeSh7IHN1cmZhY2VkOiBbLi4uZXhpc3RpbmddIH0pLCAndXRmOCcpO1xuICAgICAgICBmcy5yZW5hbWVTeW5jKHRtcFBhdGgsIG1lbW9QYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyB3cml0ZSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKiBGYWN0b3J5IGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyBhIE1lbW9TdG9yZSBnaXZlbiBhIGxvZ2dlci4gKi9cbmV4cG9ydCB0eXBlIE1lbW9GYWN0b3J5ID0gKGxvZ2dlcjogTWVtb0xvZ2dlcikgPT4gTWVtb1N0b3JlO1xuXG4vKiogRGVmYXVsdCBkaXNrLWJhY2tlZCBtZW1vIGZhY3RvcnkgdXNlZCBpbiBwcm9kdWN0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2tNZW1vRmFjdG9yeShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXIpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIHNjb3BlIHJlc29sdXRpb24gKHJlcG8tc2NvcGluZyArIGdpdGlnbm9yZSArIHNwYW4tcm9vdCBndWFyZHMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBUb3VjaFNjb3BlIHtcbiAgcmVwb1Jvb3Q6IHN0cmluZztcbiAgcmVwb1JlbFBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCb3VuZCBhIHRvdWNoZWQgZmlsZSB0byB0aGUgQ1dEIHJlcG8uIFJlc29sdmUgdGhlIHJlcG8gcm9vdCBvZiB0aGUgY3VycmVudFxuICogd29ya2luZyBkaXJlY3RvcnkgYW5kIHJlcXVpcmUgdGhlIHRvdWNoZWQgZmlsZSB0byByZXNvbHZlIHRvIHRoZSBTQU1FIHJlcG9cbiAqIHJvb3Q7IGRyb3AgZmlsZXMgaW4gYSBkaWZmZXJlbnQgcmVwb3NpdG9yeS93b3JrdHJlZSwgZ2l0aWdub3JlZCBmaWxlcywgYW5kXG4gKiBmaWxlcyB1bmRlciB0aGUgc3BhbiByb290LiBSZXR1cm5zIHRoZSByZXNvbHZlZCBgeyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfWBcbiAqIG9yIG51bGwgd2hlbiB0aGUgdG91Y2ggaXMgb3V0IG9mIHNjb3BlLlxuICpcbiAqIENvbXBhcmluZyByZXNvbHZlZCBgZ2l0IC0tc2hvdy10b3BsZXZlbGAgdG9wbGV2ZWxzIChub3QgcGF0aCBwcmVmaXhlcylcbiAqIGRpc3Rpbmd1aXNoZXMgc2VwYXJhdGUgcmVwb3MgYW5kIHdvcmt0cmVlcyBhbmQgaXMgcm9idXN0IHRvIHN5bWxpbmtzLiBGYWlsXG4gKiBjbG9zZWQ6IGlmIHRoZSBDV0QgcmVwbyBjYW4ndCBiZSByZXNvbHZlZCwgdGhlIHRvdWNoIGlzIGRyb3BwZWQgcmF0aGVyIHRoYW5cbiAqIGZhbGxpbmcgYmFjayB0byB0aGUgZmlsZSdzIG93biByZXBvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IFRvdWNoU2NvcGUgfCBudWxsIHtcbiAgY29uc3QgY3dkUmVwb1Jvb3QgPSBjd2QgPyByZXNvbHZlUmVwb1Jvb3QoY3dkKSA6IG51bGw7XG4gIGlmICghY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFic0RpciA9IHRvUG9zaXgobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSk7XG4gIGNvbnN0IGZpbGVSZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChhYnNEaXIpO1xuICBpZiAoZmlsZVJlcG9Sb290ICE9PSBjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgcmVwb1Jvb3QgPSBjd2RSZXBvUm9vdDtcbiAgY29uc3QgcmVwb1JlbFBhdGggPSByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYWJzUGF0aCk7XG5cbiAgLy8gU2tpcCBnaXRpZ25vcmVkIGZpbGVzIGVudGlyZWx5LiBCdWlsZCBvdXRwdXQsIGNhY2hlcywgYW5kIGxvZ3MgYXJlIG5vdFxuICAvLyBzcGFuLXJlbGV2YW50OiB0aGV5IG11c3QgbmV2ZXIgc3VyZmFjZSBzcGFuIG92ZXJsYXBzLlxuICBpZiAoaXNHaXRJZ25vcmVkKHJlcG9Sb290LCByZXBvUmVsUGF0aCkpIHJldHVybiBudWxsO1xuXG4gIC8vIFNraXAgc3BhbiBkb2N1bWVudHMgZW50aXJlbHkuIEZpbGVzIHVuZGVyIHRoZSByZXNvbHZlZCBzcGFuIHJvb3QgYXJlIG1hbmFnZWRcbiAgLy8gYnkgZ2l0IHNwYW4gaXRzZWxmIGFuZCBhcmUgbm90IGFwcGxpY2F0aW9uIHNvdXJjZXMgdGhhdCBuZWVkIHNwYW4gY292ZXJhZ2UuXG4gIGNvbnN0IHNwYW5Sb290ID0gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KTtcbiAgaWYgKGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGgsIHNwYW5Sb290KSkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHsgcmVwb1Jvb3QsIHJlcG9SZWxQYXRoIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3VyZmFjZSByb3V0aW5lXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEluamVjdGVkIGRlcGVuZGVuY2llcyBmb3Ige0BsaW5rIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zfS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3VyZmFjZURlcHMge1xuICBleGVjdXRvcjogU3BhbkV4ZWN1dG9yO1xuICBkcmlmdEV4ZWN1dG9yOiBEcmlmdEV4ZWN1dG9yO1xuICBtZW1vOiBNZW1vU3RvcmU7XG4gIGxvYWRSdWxlczogSG9va0lnbm9yZUxvYWRlcjtcbiAgbG9nZ2VyOiBDb3JlTG9nZ2VyO1xufVxuXG4vKipcbiAqIEdpdmVuIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCB0aGUgbGluZSByYW5nZSBiZWluZyB0b3VjaGVkIHdpdGhpbiBhblxuICogYWxyZWFkeS1yZXNvbHZlZCByZXBvLCBwcm9kdWNlIHRoZSBgPGdpdC1zcGFuPlx1MjAyNjwvZ2l0LXNwYW4+YCBibG9jayBmb3IgdGhlXG4gKiBzcGFucyBvdmVybGFwcGluZyB0aGF0IHJhbmdlLCBvciBudWxsIHdoZW4gdGhlcmUgaXMgbm90aGluZyB0byBzdXJmYWNlLlxuICpcbiAqIFRoZSBwaXBlbGluZTogYGdpdCBzcGFuIGxpc3QgPHBhdGg+IC0tcG9yY2VsYWluYCBcdTIxOTIga2VlcCBsaW5lLXJhbmdlZCBhbmNob3JzIG9uXG4gKiB0aGUgc2FtZSBmaWxlIHRoYXQgaW50ZXJzZWN0IHRoZSByYW5nZSBhbmQgYXJlIG5vdCBgLmhvb2tpZ25vcmVgLXN1cHByZXNzZWQgXHUyMTkyXG4gKiBkcm9wIHNsdWdzIGFscmVhZHkgc3VyZmFjZWQgdGhpcyBzZXNzaW9uIChtZW1vKSBcdTIxOTIgcmVuZGVyIGBnaXQgc3BhbiBsaXN0XG4gKiA8bmFtZXNcdTIwMjY+YCBcdTIxOTIgYXBwZW5kIGEgYGdpdCBzcGFuIGhpc3RvcnkgPG5hbWU+YCBwb2ludGVyIGZvciBhbnkgYWxyZWFkeS1kcmlmdGVkXG4gKiBzcGFuLiBPbiBzdWNjZXNzIHRoZSBzdXJmYWNlZCBuYW1lcyBhcmUgcmVjb3JkZWQgaW4gdGhlIG1lbW8uIEV4ZWN1dG9yIGFuZFxuICogZHJpZnQtcHJvYmUgZmFpbHVyZXMgYXJlIGxvZ2dlZCBhbmQgZGVncmFkZSB0byBudWxsIC8gdGhlIHBsYWluIGJsb2NrOyB0aGV5XG4gKiBuZXZlciB0aHJvdy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zKFxuICBkZXBzOiBTdXJmYWNlRGVwcyxcbiAgcmVwb1Jvb3Q6IHN0cmluZyxcbiAgcmVwb1JlbFBhdGg6IHN0cmluZyxcbiAgcmFuZ2U6IExpbmVSYW5nZSxcbiAgc2Vzc2lvbklkOiBzdHJpbmdcbik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCB7IGV4ZWN1dG9yLCBkcmlmdEV4ZWN1dG9yLCBtZW1vLCBsb2FkUnVsZXMsIGxvZ2dlciB9ID0gZGVwcztcblxuICAvLyBGaWx0ZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5cbiAgbGV0IHBvcmNlbGFpblN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHBvcmNlbGFpblN0ZG91dCA9IGV4ZWN1dG9yKFsnLS1wb3JjZWxhaW4nLCByZXBvUmVsUGF0aF0sIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBQYXRoLXNjb3BlZCBzdXBwcmVzc2lvbjogYSByZXBvJ3MgLnNwYW4vLmhvb2tpZ25vcmUgY2FuIGhvbGQgYmFjayBzcGFuIHNsdWdcbiAgLy8gcHJlZml4ZXMgZm9yIGFuY2hvcnMgdW5kZXIgZ2l2ZW4gcGF0aHMuIEEgc3VwcHJlc3NlZCBzcGFuIGlzIG5ldmVyIHN1cmZhY2VkLlxuICBjb25zdCBpZ25vcmVSdWxlcyA9IGxvYWRSdWxlcyhyZXBvUm9vdCk7XG5cbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBwYXJzZVBvcmNlbGFpbihwb3JjZWxhaW5TdGRvdXQpO1xuICBjb25zdCBjYW5kaWRhdGVOYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgaWYgKHJvdy5wYXRoICE9PSByZXBvUmVsUGF0aCkgY29udGludWU7XG4gICAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSBjb250aW51ZTsgLy8gd2hvbGUtZmlsZSBhbmNob3JcbiAgICBpZiAoIXJhbmdlc0ludGVyc2VjdChyYW5nZSwgeyBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfSkpIGNvbnRpbnVlO1xuICAgIGlmIChpc1NwYW5TdXBwcmVzc2VkKGlnbm9yZVJ1bGVzLCByb3cucGF0aCwgcm93Lm5hbWUpKSBjb250aW51ZTtcbiAgICBjYW5kaWRhdGVOYW1lcy5hZGQocm93Lm5hbWUpO1xuICB9XG5cbiAgaWYgKGNhbmRpZGF0ZU5hbWVzLnNpemUgPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFN1YnRyYWN0IGFscmVhZHktc3VyZmFjZWQgbmFtZXNcbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gIGNvbnN0IHRvU3VyZmFjZSA9IFsuLi5jYW5kaWRhdGVOYW1lc10uZmlsdGVyKChuKSA9PiAhc3VyZmFjZWQuaGFzKG4pKS5zb3J0KCk7XG4gIGlmICh0b1N1cmZhY2UubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBSZW5kZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8bmFtZTE+IDxuYW1lMj4gLi4uXG4gIGxldCByZW5kZXJTdGRvdXQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICByZW5kZXJTdGRvdXQgPSBleGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgKHJlbmRlcikgZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBPZiB0aGUgc3BhbnMgYmVpbmcgc3VyZmFjZWQsIGZsYWcgYW55IGFscmVhZHkgZHJpZnRlZCBcdTIwMTQgdGhlIHRvdWNoZWQgbGluZXMgaGF2ZVxuICAvLyBkcmlmdGVkIGZyb20gdGhlaXIgYW5jaG9yZWQgc3RhdGUgXHUyMDE0IHdpdGggYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIuXG4gIC8vIERldGVjdGlvbiBpcyBhcy1vZi1ub3cgKHN1cmZhY2luZyBydW5zIGJlZm9yZSB0aGUgZWRpdCBhcHBsaWVzKSwgc28gdGhpc1xuICAvLyBjYXRjaGVzIHByZS1leGlzdGluZyBkcmlmdDsgZHJpZnQgdGhpcyBzZXNzaW9uIGNhdXNlcyBpcyB0aGUgU3RvcCBob29rJ3Mgam9iLlxuICAvLyBGYWlsdXJlIHRvIGNvbXB1dGUgZHJpZnQgaXMgbm9uLWZhdGFsOiBmYWxsIGJhY2sgdG8gdGhlIHBsYWluIGJsb2NrLlxuICBsZXQgZHJpZnRIaW50ID0gJyc7XG4gIHRyeSB7XG4gICAgY29uc3QgZHJpZnROYW1lcyA9IG5ldyBTZXQocGFyc2VEcmlmdFBvcmNlbGFpbihkcmlmdEV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpKS5tYXAoKHIpID0+IHIubmFtZSkpO1xuICAgIGNvbnN0IGRyaWZ0U3VyZmFjZWQgPSB0b1N1cmZhY2UuZmlsdGVyKChuKSA9PiBkcmlmdE5hbWVzLmhhcyhuKSk7XG4gICAgaWYgKGRyaWZ0U3VyZmFjZWQubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbGluZXMgPSBkcmlmdFN1cmZhY2VkLm1hcCgobikgPT4gYCAgZ2l0IHNwYW4gaGlzdG9yeSAke259YCkuam9pbignXFxuJyk7XG4gICAgICBkcmlmdEhpbnQgPSBgXFxuRHJpZnQgXHUyMDE0IHRoZSBsaW5lcyB5b3UncmUgdG91Y2hpbmcgaGF2ZSBkcmlmdGVkIGZyb20gdGhlc2Ugc3BhbnMnIGFuY2hvcmVkIHN0YXRlLiBSZXZpZXcgaG93IGVhY2ggc3Vic3lzdGVtIGV2b2x2ZWQgYmVmb3JlIGNoYW5naW5nIGl0OlxcbiR7bGluZXN9YDtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBkcmlmdCAoaGlzdG9yeSBoaW50KSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgfVxuXG4gIGNvbnN0IHdyYXBwZWQgPSBgXFxuPGdpdC1zcGFuPlxcbiR7cmVuZGVyU3Rkb3V0fSR7ZHJpZnRIaW50fVxcbjwvZ2l0LXNwYW4+XFxuYDtcblxuICAvLyBVcGRhdGUgbWVtb1xuICBtZW1vLmFkZFN1cmZhY2VkKHNlc3Npb25JZCwgdG9TdXJmYWNlKTtcblxuICByZXR1cm4gd3JhcHBlZDtcbn1cbiIsICIvKipcbiAqIFBhdGgtc2NvcGVkIHNwYW4gc3VwcHJlc3Npb24gZm9yIHRoZSBhZ2VudCBob29rcy5cbiAqXG4gKiBTb21lIHNwYW5zIGFyZSBub2lzZSB3aGVuIGJyb3dzaW5nIGNlcnRhaW4gcGFydHMgb2YgdGhlIHRyZWUgXHUyMDE0IHdpa2kgb3JcbiAqIG1hcmtldGluZyBzcGFucyB0aGF0IGFuY2hvciBwcm9zZSwgc3VyZmFjZWQgaW5saW5lIHdoaWxlIHJlYWRpbmcgc291cmNlLFxuICogYWRkIGxpdHRsZS4gVGhpcyBtb2R1bGUgbGV0cyBhIHJlcG8gZGVjbGFyZSwgcGVyIHBhdGgsIHdoaWNoIHNwYW4gc2x1Z1xuICogcHJlZml4ZXMgdG8gaG9sZCBiYWNrLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uaG9va2lnbm9yZWAuIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhXG4gKiBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuLCBhIHNpbmdsZSBydW4gb2Ygd2hpdGVzcGFjZSwgdGhlbiBhXG4gKiBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBzcGFuIHNsdWcgcHJlZml4ZXMgdG8gc3VwcHJlc3MgZm9yIHBhdGhzIHRoZSBwYXR0ZXJuXG4gKiBtYXRjaGVzOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjIHdpa2ksbWFya2V0aW5nXG4gKlxuICogQSBzcGFuIHdob3NlIHNsdWcgYmVnaW5zIHdpdGggYHdpa2lgIG9yIGBtYXJrZXRpbmdgICh0aGUgc2x1ZyBlcXVhbHMgdGhlXG4gKiBwcmVmaXgsIG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgKSBpcyB0aGVuIG5ldmVyIHN1cmZhY2VkIGZvciBhbiBhbmNob3Igd2hvc2UgcGF0aFxuICogc2l0cyB1bmRlciBgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjYCBcdTIwMTQgaXQgaXMgbmV2ZXIgc3VyZmFjZWQgaW4gdGhlIGlubGluZVxuICogYDxnaXQtc3Bhbj5gIGJsb2NrIHRoZSBgUG9zdFRvb2xVc2VgIHRvdWNoIGhvb2sgZW1pdHMuIEl0IGhhcyBubyBlZmZlY3Qgb25cbiAqIHRoZSBgUHJlVG9vbFVzZWAgYWR2aXNvciwgd2hvc2Ugb3duIHVuY292ZXJlZC13cml0ZXMgc3VwcHJlc3Npb24gbGl2ZXMgaW5cbiAqIGAuc3Bhbi8uYWR2aXNvcmlnbm9yZWAgKHNlZSBgYWR2aXNvci1pZ25vcmUudHNgKS5cbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXIgaXMgYSBkZWxpYmVyYXRlIHN1YnNldCBvZiBnaXRpZ25vcmU6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMgKHRoZSBsZWFmIGZpbGUgaXMgbm90XG4gKiAgIGl0c2VsZiB0ZXN0ZWQsIG9ubHkgaXRzIGFuY2VzdG9yIGRpcmVjdG9yaWVzKS5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogU3VwcHJlc3Npb24gaXMgZmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmhvb2tpZ25vcmVgLCBvciBhXG4gKiBtYWxmb3JtZWQgbGluZSwgeWllbGRzIG5vIHJ1bGUgcmF0aGVyIHRoYW4gaGlkaW5nIHNwYW5zIHRoZSBhdXRob3IgZGlkIG5vdFxuICogYXNrIHRvIGhpZGUuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBTcGFuIHNsdWcgcHJlZml4ZXMgc3VwcHJlc3NlZCBmb3IgcGF0aHMgdGhpcyBydWxlIG1hdGNoZXMuICovXG4gIHByZWZpeGVzOiBzdHJpbmdbXTtcbiAgLyoqIFRydWUgd2hlbiBgcmVwb1JlbFBhdGhgIChQT1NJWCwgcmVwby1yZWxhdGl2ZSkgaXMgZ292ZXJuZWQgYnkgdGhpcyBydWxlLiAqL1xuICBtYXRjaGVzOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbjtcbn1cblxuY29uc3QgSE9PS19JR05PUkVfUkVMID0gbm9kZVBhdGguam9pbignLnNwYW4nLCAnLmhvb2tpZ25vcmUnKTtcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIGdpdGlnbm9yZS1zdHlsZSBnbG9iIHNlZ21lbnQgaW50byBhbiBhbmNob3JlZCBSZWdFeHAuIGAqYCBhbmRcbiAqIGA/YCBzdGF5IHdpdGhpbiBhIHBhdGggc2VnbWVudDsgYCoqYCAob3B0aW9uYWxseSBmb2xsb3dlZCBieSBgL2ApIHNwYW5zIHRoZW0uXG4gKi9cbmZ1bmN0aW9uIGdsb2JUb1JlZ0V4cChnbG9iOiBzdHJpbmcpOiBSZWdFeHAge1xuICBsZXQgcmUgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBnbG9iLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IGdsb2JbaV07XG4gICAgaWYgKGMgPT09ICcqJykge1xuICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnKicpIHtcbiAgICAgICAgcmUgKz0gJy4qJztcbiAgICAgICAgaSsrO1xuICAgICAgICAvLyBBYnNvcmIgYSBmb2xsb3dpbmcgc2xhc2ggc28gYCoqL2Zvb2AgZG9lcyBub3QgZGVtYW5kIGEgbGl0ZXJhbCBgL2AuXG4gICAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJy8nKSBpKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZSArPSAnW14vXSonO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYyA9PT0gJz8nKSB7XG4gICAgICByZSArPSAnW14vXSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlICs9IGMucmVwbGFjZSgvWy4rXiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBeJHtyZX0kYCk7XG59XG5cbi8qKiBBbmNlc3RvciBwYXRoIGNoYWluOiBgYS9iL2MudHNgIFx1MjE5MiBgWydhJywgJ2EvYicsICdhL2IvYy50cyddYC4gKi9cbmZ1bmN0aW9uIGFuY2VzdG9yUGF0aHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0LnB1c2gocGFydHMuc2xpY2UoMCwgaSArIDEpLmpvaW4oJy8nKSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDb21waWxlIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuICh0aGlzIG1vZHVsZSdzIGdyYW1tYXIgXHUyMDE0IHNlZSB0aGVcbiAqIG1vZHVsZSBkb2MgY29tbWVudCkgaW50byBhIHBhdGggcHJlZGljYXRlLiBBIHBhdHRlcm4gbWF0Y2hlcyBhIGZpbGUgd2hlbiBpdFxuICogbWF0Y2hlcyB0aGUgZmlsZSdzIHBhdGggb3IgYW55IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBpdCwgc28gYSBkaXJlY3RvcnlcbiAqIHBhdHRlcm4gc3VwcHJlc3NlcyBldmVyeXRoaW5nIGJlbmVhdGggaXQuXG4gKlxuICogRXhwb3J0ZWQgc28gb3RoZXIgcGF0aC1zY29wZWQgaWdub3JlLWZpbGUgY29udmVudGlvbnMgKGUuZy4gYC5hZHZpc29yaWdub3JlYFxuICogaW4gYGFkdmlzb3ItaWdub3JlLnRzYCkgY2FuIHJldXNlIHRoZSBleGFjdCBtYXRjaGluZyBzZW1hbnRpY3MgcmF0aGVyIHRoYW5cbiAqIHJlaW1wbGVtZW50aW5nIHRoZW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21waWxlUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiB7XG4gIGxldCBwYXQgPSBwYXR0ZXJuO1xuICBsZXQgZGlyT25seSA9IGZhbHNlO1xuICBpZiAocGF0LmVuZHNXaXRoKCcvJykpIHtcbiAgICBkaXJPbmx5ID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMCwgLTEpO1xuICB9XG4gIGxldCBhbmNob3JlZCA9IHBhdC5pbmNsdWRlcygnLycpO1xuICBpZiAocGF0LnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGFuY2hvcmVkID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMSk7XG4gIH1cbiAgY29uc3QgcmUgPSBnbG9iVG9SZWdFeHAocGF0KTtcblxuICByZXR1cm4gKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoYW5jaG9yZWQpIHtcbiAgICAgIGNvbnN0IHNlZ3MgPSBhbmNlc3RvclBhdGhzKHJlcG9SZWxQYXRoKTtcbiAgICAgIC8vIEZvciBhIGRpci1vbmx5IHBhdHRlcm4sIG5ldmVyIHRlc3QgdGhlIGxlYWYgZmlsZSBpdHNlbGYuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IHNlZ3Muc2xpY2UoMCwgLTEpIDogc2VncztcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKHMpID0+IHJlLnRlc3QocykpO1xuICAgIH1cbiAgICAvLyBVbmFuY2hvcmVkOiBtYXRjaCBhZ2FpbnN0IGluZGl2aWR1YWwgcGF0aCBjb21wb25lbnRzIGF0IGFueSBkZXB0aC5cbiAgICBjb25zdCBjb21wb25lbnRzID0gcmVwb1JlbFBhdGguc3BsaXQoJy8nKTtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IGNvbXBvbmVudHMuc2xpY2UoMCwgLTEpIDogY29tcG9uZW50cztcbiAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjKSA9PiByZS50ZXN0KGMpKTtcbiAgfTtcbn1cblxuLyoqIFBhcnNlIGAuaG9va2lnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgbWFsZm9ybWVkIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSG9va0lnbm9yZShjb250ZW50OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIWxpbmUgfHwgbGluZS5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIC8vIGA8cGF0dGVybj48d2hpdGVzcGFjZT48cHJlZml4ZXM+YCBcdTIwMTQgcGF0dGVybiBpcyB0aGUgZmlyc3QgdG9rZW4sIHByZWZpeGVzXG4gICAgLy8gdGhlIHNlY29uZC4gQSBsaW5lIHdpdGhvdXQgYm90aCBpcyBtYWxmb3JtZWQgYW5kIHNraXBwZWQuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxcUyspXFxzKyhcXFMrKSQvKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBwYXR0ZXJuLCBwcmVmaXhlc1Jhd10gPSBtYXRjaDtcbiAgICBjb25zdCBwcmVmaXhlcyA9IHByZWZpeGVzUmF3XG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGlmIChwcmVmaXhlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBwcmVmaXhlcywgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHN1cHByZXNzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgb3IgcGFyc2UgZmFpbHVyZVxuICogeWllbGRzIGFuIGVtcHR5IHJ1bGUgc2V0LCBzbyBzcGFucyBzdXJmYWNlIGFzIG5vcm1hbCB3aGVuIG5vIGNvbmZpZyBleGlzdHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSG9va0lnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEhPT0tfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlSG9va0lnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBBIHNsdWcgY2FycmllcyBhIHByZWZpeCB3aGVuIGl0IGVxdWFscyB0aGUgcHJlZml4IG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgLiAqL1xuZnVuY3Rpb24gc2x1Z0hhc1ByZWZpeChzbHVnOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBzbHVnID09PSBwcmVmaXggfHwgc2x1Zy5zdGFydHNXaXRoKGAke3ByZWZpeH0vYCk7XG59XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGEgc3BhbiBgc2x1Z2Agc2hvdWxkIGJlIHN1cHByZXNzZWQgZm9yIGFuIGFuY2hvciBhdCBgcmVwb1JlbFBhdGhgOlxuICogc29tZSBydWxlIG1hdGNoZXMgdGhlIHBhdGggYW5kIGxpc3RzIGEgcHJlZml4IHRoZSBzbHVnIGNhcnJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYW5TdXBwcmVzc2VkKHJ1bGVzOiBJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNsdWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICBpZiAoIXJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpIGNvbnRpbnVlO1xuICAgIGlmIChydWxlLnByZWZpeGVzLnNvbWUoKHApID0+IHNsdWdIYXNQcmVmaXgoc2x1ZywgcCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkSG9va0lnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgSG9va0lnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHRvdWNoLWhvb2sgY29yZS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpbXBsZW1lbnRzIHRoZSBQb3N0VG9vbFVzZSBcInRvdWNoIHNpZ25hbFwiIHRoYXQgYm90aCB0aGUgQ2xhdWRlXG4gKiAoYFJlYWR8RWRpdHxXcml0ZWApIGFuZCBDb2RleCAoYGFwcGx5X3BhdGNoYCkgYWRhcHRlcnMgZHJpdmUuIEl0IGltcG9ydHNcbiAqIG5vdGhpbmcgZnJvbSBlaXRoZXIgaG9vayBTREsgYW5kIGlzIHR5cGVkIHN0cnVjdHVyYWxseSwgcGVyIHRoZSBgY29tbW9uL2BcbiAqIGxheWVyIGNvbnZlbnRpb246IGFkYXB0ZXJzIHRyYW5zbGF0ZSB0aGVpciBTREstc3BlY2lmaWMgaG9vayBpbnB1dCBpbnRvIGFcbiAqIHtAbGluayBUb3VjaElucHV0fSwgaW5qZWN0IGV4ZWN1dGlvbi9zdGF0ZSBkZXBlbmRlbmNpZXMsIGFuZCB3cmFwIHRoZSByZXR1cm5lZFxuICoge0BsaW5rIFRvdWNoT3V0cHV0fSBpbiB0aGVpciBvd24gb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogUmV1c2VkIGZyb20gdGhlIHNoYXJlZCBrZXJuZWwgKG5vdCByZWRlZmluZWQpOiBgaXNEZWJ0KClgICtcbiAqIGBQb3JjZWxhaW5TdGF0dXNgL2BEcmlmdFBvcmNlbGFpblJvd2AvYFBvcmNlbGFpblJvd2AvYHBhcnNlUG9yY2VsYWluYC9cbiAqIGBwYXJzZURyaWZ0UG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYHJhbmdlc0ludGVyc2VjdGAgYW5kIHRoZVxuICogcmVwby9zcGFuLXJvb3QgcGF0aCB1dGlsaXRpZXMgKGFnZW50LWhvb2tzLWNvbW1vbi50cyksIGFuZCB0aGUgYE1lbW9TdG9yZWBcbiAqIGNhZGVuY2Ugc3RvcmUgKHNwYW4tc3VyZmFjZS50cykuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgdHlwZSBEcmlmdFBvcmNlbGFpblJvdyxcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHR5cGUgUG9yY2VsYWluU3RhdHVzLFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcmFuZ2VzSW50ZXJzZWN0LFxuICByZWxhdGl2ZVRvUmVwbyxcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICByZXNvbHZlU3BhblJvb3Rcbn0gZnJvbSAnLi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgY29sbGFwc2VCeVBhdGgsIHR5cGUgUmFuZ2VMYWJlbCwgcmVuZGVyQW5jaG9yVHJlZSB9IGZyb20gJy4vYW5jaG9yLXRyZWUuanMnO1xuaW1wb3J0IHR5cGUgeyBNZW1vU3RvcmUgfSBmcm9tICcuL3NwYW4tc3VyZmFjZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9zdC1lZGl0IHJhbmdlIHJlY292ZXJ5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTcGxpdCB3cml0dGVuIGNvbnRlbnQgaW50byB0aGUgbGluZXMgdG8gbG9jYXRlIG9uIGRpc2suIEEgc2luZ2xlIHRyYWlsaW5nXG4gKiBuZXdsaW5lIGlzIGRyb3BwZWQgc28gYFwiYVxcbmJcXG5cImAgYW5kIGBcImFcXG5iXCJgIGxvY2F0ZSBpZGVudGljYWxseTsgYW4gZW1wdHlcbiAqIChvciBuZXdsaW5lLW9ubHkpIHdyaXRlIGhhcyBubyBsb2NhdGFibGUgYmxvY2suXG4gKi9cbmZ1bmN0aW9uIHRvTmVlZGxlTGluZXMod3JpdHRlbjogc3RyaW5nKTogc3RyaW5nW10ge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgdHJpbW1lZCA9IHdyaXR0ZW4uZW5kc1dpdGgoJ1xcbicpID8gd3JpdHRlbi5zbGljZSgwLCAtMSkgOiB3cml0dGVuO1xuICBpZiAodHJpbW1lZC5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgcmV0dXJuIHRyaW1tZWQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIGxpbmUgcmFuZ2UgdGhhdCB3cml0dGVuIGNvbnRlbnQgbm93IG9jY3VwaWVzIGluIHRoZSBvbi1kaXNrIGZpbGUsXG4gKiBmb3IgYW5jaG9yaW5nIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZnRlciBhbiBlZGl0IGhhcyBhbHJlYWR5IGFwcGxpZWQuXG4gKlxuICogVGhpcyBnZW5lcmFsaXplcyB0aGUgcHJlLWVkaXQgYGxvY2F0ZUNodW5rKClgIHRlY2huaXF1ZSBpblxuICogW2FwcGx5LXBhdGNoLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jb2RleC9hcHBseS1wYXRjaC50cyNMMjUzLUwyODYpXG4gKiAocHJldmlvdXNseSBDb2RleC1vbmx5KSBpbnRvIGEgc2hhcmVkIHBvc3QtZWRpdCBwcmltaXRpdmUgYm90aCBoYXJuZXNzZXMgdXNlOlxuICogc3BsaXQgYHdyaXR0ZW5gIGFuZCBgb25EaXNrQ29udGVudGAgaW50byBsaW5lcyBhbmQgbG9jYXRlIHRoZSB3cml0dGVuIGJsb2NrIGFzXG4gKiBhIGNvbnRpZ3VvdXMgcnVuIGluc2lkZSB0aGUgb24tZGlzayBsaW5lcy5cbiAqXG4gKiAtIEEgc2luZ2xlIGNvbnRpZ3VvdXMgbWF0Y2ggeWllbGRzIGl0cyAxLWJhc2VkIGluY2x1c2l2ZSB7QGxpbmsgTGluZVJhbmdlfS5cbiAqIC0gV2hlbiB0aGUgYmxvY2sgaXMgYWJzZW50LCBvciBhcHBlYXJzIG1vcmUgdGhhbiBvbmNlIChjb250ZXh0IHRvIGRpc2FtYmlndWF0ZVxuICogICBpcyBub3QgYXZhaWxhYmxlIHBvc3QtZWRpdCksIHJlY292ZXJ5IGlzIGFtYmlndW91cyBhbmQgdGhlIHJlc3VsdCBkZWdyYWRlc1xuICogICB0byBgJ3dob2xlLWZpbGUnYCAodGhlIHNhbWUgZmFsbGJhY2sgYGxvY2F0ZUNodW5rKClgIHNpZ25hbHMgd2l0aCBgbnVsbGApLlxuICpcbiAqIE5ldmVyIHRocm93czogYW4gdW5sb2NhdGFibGUgd3JpdGUgaXMgYSBgJ3dob2xlLWZpbGUnYCBhbnN3ZXIsIG5vdCBhbiBlcnJvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY292ZXJSYW5nZSh3cml0dGVuOiBzdHJpbmcsIG9uRGlza0NvbnRlbnQ6IHN0cmluZyk6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGNvbnN0IG5lZWRsZSA9IHRvTmVlZGxlTGluZXMod3JpdHRlbik7XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuXG4gIGNvbnN0IGhheXN0YWNrID0gb25EaXNrQ29udGVudC5zcGxpdCgnXFxuJyk7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBjb25zdCBzdGFydHM6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSB7XG4gICAgICBzdGFydHMucHVzaChpKTtcbiAgICAgIGlmIChzdGFydHMubGVuZ3RoID4gMSkgYnJlYWs7IC8vIGR1cGxpY2F0ZWQgXHUyMTkyIGFtYmlndW91cywgc3RvcCBlYXJseVxuICAgIH1cbiAgfVxuXG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHN0YXJ0c1swXSArIDEsIGVuZDogc3RhcnRzWzBdICsgbmVlZGxlLmxlbmd0aCB9O1xuICB9XG4gIHJldHVybiAnd2hvbGUtZmlsZSc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaW5wdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFdoaWNoIGhhcm5lc3MgZXZlbnQgZmlyZWQsIGFzIHRoZSB0b3VjaCBjb3JlIHNlZXMgaXQuIFRoZSBjb3JlIGJyYW5jaGVzIG9uXG4gKiB0aGlzOiBgd3JpdGVgIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSBhbmQgbWF5IHN1cmZhY2UgYVxuICogbWVyZ2VkIGJsb2NrOyBgcmVhZGAgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZSBhbmQgZmlsdGVycyBwb3NpdGlvbmFsIHN0YXR1c2VzXG4gKiBvdXQgb2Ygd2hhdCBpdCBzdXJmYWNlcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hFdmVudEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnO1xuXG4vKiogRmllbGRzIHNoYXJlZCBieSBldmVyeSB0b3VjaCwgcmVnYXJkbGVzcyBvZiBraW5kLiAqL1xuaW50ZXJmYWNlIFRvdWNoSW5wdXRCYXNlIHtcbiAgLyoqIEhhcm5lc3Mgc2Vzc2lvbiBpZCBcdTIwMTQga2V5cyB0aGUgcGVyLXNlc3Npb24gY2FkZW5jZSB7QGxpbmsgTWVtb1N0b3JlfS4gKi9cbiAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBXb3JraW5nIGRpcmVjdG9yeSB0aGUgdG9vbCByYW4gaW4sIHVzZWQgdG8gYm91bmQgdGhlIHRvdWNoIHRvIHRoZSBDV0QgcmVwb1xuICAgKiB2aWEgYHJlc29sdmVUb3VjaFNjb3BlKClgIGJlZm9yZSBhbnkgc3BhbiBpbnZvY2F0aW9uLlxuICAgKi9cbiAgY3dkOiBzdHJpbmc7XG4gIC8qKiBBYnNvbHV0ZSwgY2Fub25pY2FsaXplZCBwYXRoIG9mIHRoZSB0b3VjaGVkIGZpbGUuICovXG4gIGZpbGVQYXRoOiBzdHJpbmc7XG59XG5cbi8qKiBBIHJlYWQgdG91Y2ggKENsYXVkZSBgUmVhZGAsIG9yIGEgcmVhZC1zaGFwZWQgQ29kZXggZXZlbnQpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaFJlYWRJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3JlYWQnO1xuICAvKipcbiAgICogMS1iYXNlZCBzdGFydGluZyBsaW5lIG9mIHRoZSByZWFkLCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBgb2Zmc2V0YFxuICAgKiBpbnB1dC4gYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYG9mZnNldGAgKHJlYWRzIGZyb20gbGluZSAxKS5cbiAgICovXG4gIG9mZnNldD86IG51bWJlcjtcbiAgLyoqXG4gICAqIExpbmUgY291bnQgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBsaW1pdGAgaW5wdXQuXG4gICAqIGB1bmRlZmluZWRgIHdoZW4gdGhlIHJlYWQgaGFkIG5vIGBsaW1pdGAgXHUyMDE0IHNlZSB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfVxuICAgKiBmb3IgaG93IHRoZSByYW5nZSBpcyBjb21wdXRlZCBpbiB0aGF0IGNhc2UuXG4gICAqL1xuICBsaW1pdD86IG51bWJlcjtcbn1cblxuLyoqIEEgd3JpdGUgdG91Y2ggKENsYXVkZSBgRWRpdGAvYFdyaXRlYCwgQ29kZXggYGFwcGx5X3BhdGNoYCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoV3JpdGVJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3dyaXRlJztcbiAgLyoqXG4gICAqIFRoZSBjb250ZW50IGp1c3Qgd3JpdHRlbiB0byBgZmlsZVBhdGhgLCBmZWQgdG8ge0BsaW5rIHJlY292ZXJSYW5nZX0gdG9cbiAgICogcmUtYW5jaG9yIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZ2FpbnN0IHRoZSBoZWFsZWQgb24tZGlzayBmaWxlLiBGb3IgYVxuICAgKiB3aG9sZS1maWxlIGNyZWF0ZSB0aGlzIGlzIHRoZSBlbnRpcmUgZmlsZSBib2R5OyBhbiBlbXB0eSBzdHJpbmcgbWVhbnNcbiAgICogXCJubyBsb2NhdGFibGUgYmxvY2tcIiBhbmQgdGhlIHRvdWNoIGlzIHNjb3BlZCBmaWxlLXdpZGUuXG4gICAqL1xuICB3cml0dGVuOiBzdHJpbmc7XG59XG5cbi8qKiBUaGUgaGFybmVzcy1hZ25vc3RpYyB0b3VjaCB0aGUgY29yZSBjb25zdW1lcy4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoSW5wdXQgPSBUb3VjaFJlYWRJbnB1dCB8IFRvdWNoV3JpdGVJbnB1dDtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbmplY3RlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3RydWN0dXJlZCByZXN1bHQgb2YgYSBzY29wZWQgYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGAuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoRml4UmVzdWx0IHtcbiAgLyoqXG4gICAqIFdoZXRoZXIgYC0tZml4YCByZS1hbmNob3JlZCBhdCBsZWFzdCBvbmUgc3BhbiBpbiB0aGUgd29ya2luZyB0cmVlLiBEcml2ZXNcbiAgICoge0BsaW5rIFRvdWNoT3V0cHV0LnRyZWVNb2RpZmllZH0gc28gYSBjYWxsZXIvdGVzdCBjYW4gYXNzZXJ0IHRoZSBoZWFsaW5nXG4gICAqIGhhcHBlbmVkIHdpdGhvdXQgZGlmZmluZyB0aGUgdHJlZSBpdHNlbGYuXG4gICAqL1xuICBtb2RpZmllZDogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGAgc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgKHdyaXRlIHBhdGhcbiAqIG9ubHkpLCByZXBvcnRpbmcgd2hldGhlciB0aGUgd29ya2luZyB0cmVlIHdhcyBoZWFsZWQuIEFzeW5jIHNvIHRoZSBldmVudHVhbFxuICogaW1wbGVtZW50YXRpb24gYW5kIGl0cyB0ZXN0cyBjYW4gaW5qZWN0IGEgZmFrZSB3aXRob3V0IGEgcmVhbCBzdWJwcm9jZXNzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEZpeEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFRvdWNoRml4UmVzdWx0PjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gPGZpbGU+YCBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlclxuICogYW5jaG9yIGNvdmVyaW5nIHRoZSBmaWxlLiBTdHJ1Y3R1cmVkIChub3QgcmF3IHN0ZG91dCkgc28gdGhlIG1lcmdlZC1ibG9ja1xuICogY29tcHV0YXRpb24gYW5kIGl0cyB0ZXN0cyBzaGFyZSB0aGUgc2FtZSBzaGFwZS5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hMaXN0RXhlY3V0b3IgPSAoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8UG9yY2VsYWluUm93W10+O1xuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluIDxhcmdzPmAgKHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlIG9yXG4gKiBpdHMgc3BhbnMpIGFuZCByZXR1cm4gaXRzIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyIGRyaWZ0ZWQgYW5jaG9yLCBlbXB0eSB3aGVuXG4gKiBjbGVhbi4gU3RhdHVzIGNsYXNzaWZpY2F0aW9uIGlzIHZpYSBgaXNEZWJ0KClgOyBwb3NpdGlvbmFsIChgTU9WRURgLFxuICogYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCkgcm93cyBhcmUgbmV2ZXIgZGVidC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hEcmlmdEV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxEcmlmdFBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYmFyZSBgZ2l0IHNwYW4gd2h5IDxuYW1lPmAgYW5kIHJldHVybiB0aGUgc3BhbidzIHJlY29yZGVkIHdoeSBzZW50ZW5jZSxcbiAqIG9yIGBudWxsYCB3aGVuIG5vbmUgaXMgcmVjb3JkZWQgb3IgdGhlIHJlYWQgZmFpbHMuIEZlZWRzIHRoZSBodW1hbi1mb3JtYXRcbiAqIHNwYW4gcmVuZGVyOyBpbnZva2VkIG9ubHkgZm9yIHNwYW5zIGFjdHVhbGx5IGJlaW5nIHN1cmZhY2VkIHRoaXMgdG91Y2guXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoV2h5RXhlY3V0b3IgPSAobmFtZTogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxzdHJpbmcgfCBudWxsPjtcblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZXhlY3V0aW9uIHN1cmZhY2UuIEtlcHQgYXMgZm91ciBuYXJyb3cgYXN5bmMgZnVuY3Rpb25zIChyYXRoZXJcbiAqIHRoYW4gYSByYXcgY29tbWFuZCBydW5uZXIpIHNvIHRlc3RzIGluamVjdCBmYWtlcyByZXR1cm5pbmcgc3RydWN0dXJlZCBkYXRhXG4gKiBhbmQgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIGEgc3VicHJvY2VzcyBpdHNlbGYuIFRoZSBgcmVhZGAgcGF0aCBuZXZlciBpbnZva2VzXG4gKiBgZml4YC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEV4ZWN1dG9ycyB7XG4gIGZpeDogVG91Y2hGaXhFeGVjdXRvcjtcbiAgbGlzdDogVG91Y2hMaXN0RXhlY3V0b3I7XG4gIGRyaWZ0OiBUb3VjaERyaWZ0RXhlY3V0b3I7XG4gIHdoeTogVG91Y2hXaHlFeGVjdXRvcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBvdXRwdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hhdCB0aGUgY29yZSBoYW5kcyBiYWNrIGZvciB0aGUgYWRhcHRlciB0byB0cmFuc2xhdGUgaW50byBTREsgb3V0cHV0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaE91dHB1dCB7XG4gIC8qKlxuICAgKiBUaGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayAoaGVhZGVyLCBvbmUgaHVtYW4tZm9ybWF0IHNlY3Rpb24gcGVyXG4gICAqIHN1cmZhY2VkIHNwYW4sIGZvb3RlcikgdG8gaW5qZWN0IHZpYSB0aGUgaGFybmVzcydzIGBhZGRpdGlvbmFsQ29udGV4dGAsXG4gICAqIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzIG5vdGhpbmcgd29ydGggc3VyZmFjaW5nIHRoaXMgdG91Y2guXG4gICAqL1xuICBhZGRpdGlvbmFsQ29udGV4dDogc3RyaW5nIHwgbnVsbDtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgbW9kaWZpZWQgYnkgYSBzY29wZWQgYC0tZml4YCBvbiB0aGUgd3JpdGUgcGF0aC5cbiAgICogQWx3YXlzIGBmYWxzZWAgb24gdGhlIHJlYWQgcGF0aCAocmVhZHMgbmV2ZXIgbXV0YXRlIHRoZSB0cmVlKS5cbiAgICovXG4gIHRyZWVNb2RpZmllZDogYm9vbGVhbjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBNZXJnZWQtYmxvY2sgYXNzZW1ibHlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIG1lbW8ga2V5IHVuZGVyIHdoaWNoIGEgc3BhbidzIHJlbmRlciBmb3IgYSBnaXZlbiBkcmlmdCBzdGF0dXMgaXMgZGVkdXBlZC4gKi9cbmZ1bmN0aW9uIGRyaWZ0S2V5KG5hbWU6IHN0cmluZywgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICAvLyBTcGFuIG5hbWVzIGNvbWUgZnJvbSB0YWItZGVsaW1pdGVkIHBvcmNlbGFpbiwgc28gdGhleSBuZXZlciBjb250YWluIGEgdGFiO1xuICAvLyBhIHRhYi1qb2luZWQga2V5IGNhbiBuZXZlciBjb2xsaWRlIHdpdGggYSBiYXJlIHNwYW4gbmFtZSAodGhlIHN1cmZhY2luZyBrZXkpLlxuICByZXR1cm4gYCR7bmFtZX1cXHQke3N0YXR1c31gO1xufVxuXG4vKiogVGhlIGBwYXRoI0xzdGFydC1MZW5kYCAob3IgYmFyZS1wYXRoLCB3aG9sZS1maWxlKSBhbmNob3IgdGV4dCBmb3IgYSByb3cuICovXG5mdW5jdGlvbiBhbmNob3JUZXh0KHJvdzogUG9yY2VsYWluUm93KTogc3RyaW5nIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4gcm93LnBhdGg7XG4gIHJldHVybiBgJHtyb3cucGF0aH0jTCR7cm93LnN0YXJ0fS1MJHtyb3cuZW5kfWA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuSGVhZGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCR7ZmlsZU5hbWV9IGhhcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXM6YDtcbn1cblxuZnVuY3Rpb24gY2xlYW5Gb290ZXIoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgSWYgeW91IGNoYW5nZSAke2ZpbGVOYW1lfSBjaGVjayB0aGUgb3RoZXIgZmlsZXMgdG8gY29uZmlybSB0aGV5IHN0aWxsIHdvcmsgdG9nZXRoZXIuYDtcbn1cblxuLyoqXG4gKiBUaGUgd3JpdGUgcGF0aCBuYW1lcyB0aGUgZWRpdCBhcyB0aGUgY2F1c2U7IHRoZSByZWFkIHBhdGggb25seSBzdXJmYWNlc1xuICogcHJlLWV4aXN0aW5nIGRyaWZ0IGl0IGRpZG4ndCBjcmVhdGUsIHNvIGl0IG5hbWVzIHRoZSBkZXBlbmRlbmN5IGluc3RlYWQuXG4gKi9cbmZ1bmN0aW9uIGRyaWZ0SGVhZGVyKGRyaWZ0ZWRDb3VudDogbnVtYmVyLCBraW5kOiBUb3VjaElucHV0WydraW5kJ10pOiBzdHJpbmcge1xuICBpZiAoa2luZCA9PT0gJ3dyaXRlJykge1xuICAgIHJldHVybiBkcmlmdGVkQ291bnQgPT09IDFcbiAgICAgID8gJ1RoaXMgZWRpdCBwdXQgYW4gaW1wbGljaXQgZGVwZW5kZW5jeSBvdXQgb2YgZGF0ZTonXG4gICAgICA6ICdUaGlzIGVkaXQgcHV0IGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xuICB9XG4gIHJldHVybiBkcmlmdGVkQ291bnQgPT09IDFcbiAgICA/ICdUaGlzIGZpbGUgaGFzIGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgIDogJ1RoaXMgZmlsZSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzIG91dCBvZiBkYXRlOic7XG59XG5cbmZ1bmN0aW9uIGRyaWZ0Rm9vdGVyKGRyaWZ0ZWROYW1lczogc3RyaW5nW10pOiBzdHJpbmcge1xuICBpZiAoZHJpZnRlZE5hbWVzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IG5hbWUgPSBkcmlmdGVkTmFtZXNbMF07XG4gICAgcmV0dXJuIGBSZXN0b3JlIGFncmVlbWVudCBiZWZvcmUgY29tbWl0dGluZy4gRm9sbG93IGNvbmZpcm1lZCBhdXRob3JpdHkuIFByZXNlcnZlIGFuY2hvciBzaGFwZTsgaWYgYW4gYWRkcmVzcyBjaGFuZ2VkLCBzd2FwIHRoZSBvbGQgYW5jaG9yIGZvciB0aGUgbmV3IG9uZSB3aXRoIFxcYGdpdCBzcGFuIHJlcGxhY2VcXGAuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgXFxgZ2l0IHNwYW4gZHJpZnQgJHtuYW1lfVxcYCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLmA7XG4gIH1cbiAgcmV0dXJuICdGb3IgZWFjaCBvdXQtb2YtZGF0ZSBzcGFuOiByZXN0b3JlIGFncmVlbWVudCBiZWZvcmUgY29tbWl0dGluZy4gRm9sbG93IGNvbmZpcm1lZCBhdXRob3JpdHkuIFByZXNlcnZlIGFuY2hvciBzaGFwZTsgaWYgYW4gYWRkcmVzcyBjaGFuZ2VkLCBzd2FwIHRoZSBvbGQgYW5jaG9yIGZvciB0aGUgbmV3IG9uZSB3aXRoIGBnaXQgc3BhbiByZXBsYWNlYC4gVXBkYXRlIG9yIHJldGlyZSB0aGUgd2h5IG9ubHkgaWYgaXRzIG1lYW5pbmcgY2hhbmdlZC4gUmVxdWlyZSBgZ2l0IHNwYW4gZHJpZnQgPG5hbWU+YCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLic7XG59XG5cbi8qKiBUaGUge0BsaW5rIFJhbmdlTGFiZWx9IGZvciBhIHBvcmNlbGFpbiByb3cgXHUyMDE0IGAwLTBgIGlzIHRoZSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIHJhbmdlTGFiZWwocm93OiBQb3JjZWxhaW5Sb3cpOiBSYW5nZUxhYmVsIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4geyBraW5kOiAnd2hvbGUtZmlsZScgfTtcbiAgcmV0dXJuIHsga2luZDogJ3JhbmdlJywgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH07XG59XG5cbi8qKlxuICogQSBzcGFuJ3MgZnVsbCBhbmNob3IgbGlzdCwgcmVuZGVyZWQgYXMgYSBzaGFyZWQtcHJlZml4IHRyZWUgYnlcbiAqIHtAbGluayByZW5kZXJBbmNob3JUcmVlfSwgd2l0aCBlYWNoIGFuY2hvciB0aGF0IGNhcnJpZXMgZ2VudWluZSBkcmlmdFxuICogc3VmZml4ZWQgYnkgaXRzIGxvd2VyY2FzZSBzdGF0dXMgdG9rZW4ocykgKGAgXHUyMDE0IGNoYW5nZWRgKS5cbiAqXG4gKiBBIGRyaWZ0IHJvdyBtYXRjaGVzIGFuIGFuY2hvciBieSBleGFjdCBwYXRoK3JhbmdlLCBvciBieSBwYXRoIGFsb25lIHdoZW4gdGhlXG4gKiBzcGFuIGhhcyBhIHNpbmdsZSBhbmNob3Igb24gdGhhdCBwYXRoIChyYW5nZXMgY2FuIGRpc2FncmVlIGFmdGVyIGEgaGVhbCkuXG4gKiBgc29sZU9uUGF0aGAgaXMgZGVsaWJlcmF0ZWx5IGNvbXB1dGVkIG92ZXIgdGhlICoqZnVsbCBmbGF0IGFuY2hvciBsaXN0KiosXG4gKiBiZWZvcmUgYW55IGdyb3VwaW5nIFx1MjAxNCB0aGUgdHJlZSBsYXlvdXQgbXVzdCBuZXZlciBiZSBhYmxlIHRvIGNoYW5nZSAqd2hpY2gqXG4gKiBhbmNob3JzIGdldCBsYWJlbGVkLCBvbmx5IHdoZXJlIHRoZXkgc2l0IG9uIHRoZSBwYWdlLlxuICovXG5mdW5jdGlvbiBhbmNob3JCdWxsZXRzKGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLCBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgcm93cyA9IGFuY2hvcnMubWFwKChhbmNob3IpID0+IHtcbiAgICBjb25zdCBzb2xlT25QYXRoID0gYW5jaG9ycy5maWx0ZXIoKGEpID0+IGEucGF0aCA9PT0gYW5jaG9yLnBhdGgpLmxlbmd0aCA9PT0gMTtcbiAgICBjb25zdCBzdGF0dXNlcyA9IG5ldyBTZXQ8UG9yY2VsYWluU3RhdHVzPigpO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIGRlYnRSb3dzKSB7XG4gICAgICBpZiAocm93LnBhdGggIT09IGFuY2hvci5wYXRoKSBjb250aW51ZTtcbiAgICAgIGlmIChzb2xlT25QYXRoIHx8IChyb3cuc3RhcnQgPT09IGFuY2hvci5zdGFydCAmJiByb3cuZW5kID09PSBhbmNob3IuZW5kKSkge1xuICAgICAgICBzdGF0dXNlcy5hZGQocm93LnN0YXR1cyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi5zdGF0dXNlc10uc29ydCgpO1xuICAgIGNvbnN0IHN1ZmZpeCA9IHNvcnRlZC5sZW5ndGggPiAwID8gYCBcdTIwMTQgJHtzb3J0ZWQubWFwKGh1bWFuU3RhdHVzTGFiZWwpLmpvaW4oJywgJyl9YCA6ICcnO1xuICAgIHJldHVybiB7IHBhdGg6IGFuY2hvci5wYXRoLCByYW5nZTogcmFuZ2VMYWJlbChhbmNob3IpLCBzdWZmaXggfTtcbiAgfSk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlbmRlckFuY2hvclRyZWUoY29sbGFwc2VCeVBhdGgocm93cykpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCBkbyBub3QgcmVtb3ZlIGl0XG4gICAgLy8gb24gdGhlIHRoZW9yeSB0aGF0IGEgZGVncmFkZWQgZmFsbGJhY2sgaXMgaXRzZWxmIGZvcmJpZGRlbi4gQW4gdW5jYXVnaHRcbiAgICAvLyB0aHJvdyBoZXJlIGRvZXMgbm90IGRlZ3JhZGUgdG8gYSBmbGF0IGxpc3Q6IGl0IGVzY2FwZXMgdG9cbiAgICAvLyBgcnVuVG91Y2hIb29rYCdzIGNhdGNoLCB3aGljaCByZXNvbHZlcyB0aGUgd2hvbGUgaG9vayB0b1xuICAgIC8vIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAsIHNvIHRoZSBhZ2VudCBpcyBuZXZlciB0b2xkIGFib3V0IHRoZSBkcmlmdCBhdFxuICAgIC8vIGFsbC4gQ2F0Y2hpbmcgbG9jYWxseSBuYXJyb3dzIHdoYXQgYSByZW5kZXJpbmcgZGVmZWN0IGNhbiBjb3N0IGZyb20gXCJ0aGVcbiAgICAvLyByZW1pbmRlciBkaXNhcHBlYXJzXCIgdG8gXCJ0aGUgcmVtaW5kZXIgbG9va3MgbGlrZSBpdCBkaWQgYmVmb3JlIHRoZSB0cmVlXCIuXG4gICAgLy8gV2hldGhlciB0byBzdXJmYWNlIGFuZCB3aGF0IHNoYXBlIHRvIHN1cmZhY2UgaW4gYXJlIGRpZmZlcmVudCB0aGluZ3MsIGFuZFxuICAgIC8vIHRoaXMgY2F0Y2ggb25seSBldmVyIHRvdWNoZXMgdGhlIGxhdHRlci5cbiAgICAvLyBgcm93c2AgaXMgaW5kZXgtYWxpZ25lZCB3aXRoIGBhbmNob3JzYCwgc28gdGhpcyByZXByb2R1Y2VzIHRvZGF5J3MgZmxhdFxuICAgIC8vIGJ1bGxldCBydW4gYnl0ZSBmb3IgYnl0ZSwgc3VmZml4ZXMgaW5jbHVkZWQuXG4gICAgcmV0dXJuIGFuY2hvcnMubWFwKChhbmNob3IsIGkpID0+IGAtICR7YW5jaG9yVGV4dChhbmNob3IpfSR7cm93c1tpXS5zdWZmaXh9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBPbmUgaHVtYW4tZm9ybWF0IHNwYW4gc2VjdGlvbjogYCMjIDxuYW1lPmAsIHRoZSBmdWxsIGFuY2hvciBsaXN0IChkcmlmdGVkXG4gKiBhbmNob3JzIHN0YXR1cy1zdWZmaXhlZCksIGFuZCB0aGUgd2h5IHNlbnRlbmNlIHdoZW4gb25lIGlzIHJlY29yZGVkLlxuICpcbiAqIFRoZSBuYW1lIGhlYWRlciBhbmQgdGhlIHdoeSBzZW50ZW5jZSBhcmUgdGhlIHNhbWUgc2hhcGUgYGdpdCBzcGFuIGxpc3RgXG4gKiByZW5kZXJzOyB0aGUgYW5jaG9yIGxpc3QgZGVsaWJlcmF0ZWx5IGlzIG5vdCBcdTIwMTQgaXQgcmVuZGVycyBhcyBhIHNoYXJlZC1wcmVmaXhcbiAqIHRyZWUgKHtAbGluayBhbmNob3JCdWxsZXRzfSkgd2hlcmUgdGhlIENMSSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHJhbmdlYFxuICogYnVsbGV0IHJ1bi4gVGhlIENMSSdzIG93biB0ZXh0IGZvcm1hdCBpcyB1bnRvdWNoZWQ7IG9ubHkgdGhpcyBob29rJ3NcbiAqIHJlLXByZXNlbnRhdGlvbiBvZiBpdCBncm91cHMuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclNwYW5TZWN0aW9uKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLFxuICBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSxcbiAgd2h5OiBzdHJpbmcgfCBudWxsXG4pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IFtgIyMgJHtuYW1lfWAsIC4uLmFuY2hvckJ1bGxldHMoYW5jaG9ycywgZGVidFJvd3MpXTtcbiAgaWYgKHdoeSkgbGluZXMucHVzaCgnJywgd2h5KTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIEFzc2VtYmxlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrOiBoZWFkZXIsIG9uZSBzZWN0aW9uIHBlciBzdXJmYWNlZFxuICogc3BhbiAoc2VwYXJhdGVkIGJ5IGAtLS1gKSwgYW5kIGEgc2luZ2xlIGZvb3RlciBhZnRlciBhIGZpbmFsIGAtLS1gLlxuICovXG5mdW5jdGlvbiBidWlsZEJsb2NrKHNlY3Rpb25zOiBzdHJpbmdbXSwgaGVhZGVyOiBzdHJpbmcsIGZvb3Rlcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYm9keSA9IGAke2hlYWRlcn1cXG5cXG4ke3NlY3Rpb25zLmpvaW4oJ1xcblxcbi0tLVxcblxcbicpfVxcblxcbi0tLVxcblxcbiR7Zm9vdGVyfWA7XG4gIHJldHVybiBgXFxuPGdpdC1zcGFuPlxcbiR7Ym9keX1cXG48L2dpdC1zcGFuPlxcbmA7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaG9vayBlbnRyeSBwb2ludFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGluIHNjb3BlIGZvciB0aGUgcmVjb3ZlcmVkIHJhbmdlLiAqL1xuZnVuY3Rpb24gaW50ZXJzZWN0cyhyb3c6IFBvcmNlbGFpblJvdywgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyk6IGJvb2xlYW4ge1xuICBpZiAocmFuZ2UgPT09ICd3aG9sZS1maWxlJykgcmV0dXJuIHRydWU7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHRydWU7IC8vIHdob2xlLWZpbGUgYW5jaG9yXG4gIHJldHVybiByYW5nZXNJbnRlcnNlY3QocmFuZ2UsIHsgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH0pO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIHRvdWNoZWQgcmFuZ2UgZnJvbSB0aGUgb24tZGlzayBmaWxlIGZvciBhIHdyaXRlLiBBbiBlbXB0eSB3cml0ZSBvclxuICogYW4gdW5yZWFkYWJsZSBmaWxlIChlLmcuIGEgZGVsZXRlLCBvciB0aGUgZmlsZSB3YXMgbmV2ZXIgd3JpdHRlbikgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgLCBzY29waW5nIHRoZSB0b3VjaCB0byBldmVyeSBjb3ZlcmluZyBzcGFuIFx1MjAxNCB0aGUgZmFpbC1vcGVuXG4gKiBiZWhhdmlvciwgbm90IGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2VGcm9tRGlzayh3cml0dGVuOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcpOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGxldCBjb250ZW50OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICByZXR1cm4gcmVjb3ZlclJhbmdlKHdyaXR0ZW4sIGNvbnRlbnQpO1xufVxuXG4vKipcbiAqIFRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBkb2N1bWVudGVkIGRlZmF1bHQgbGluZSBjb3VudCB3aGVuIGBvZmZzZXRgIGlzXG4gKiBnaXZlbiB3aXRob3V0IGBsaW1pdGAgKFwiQnkgZGVmYXVsdCwgaXQgcmVhZHMgdXAgdG8gMjAwMCBsaW5lc1wiKS4gTmFtZWQgc29cbiAqIHRoZSBhc3N1bXB0aW9uIGlzIHZpc2libGUgYW5kIGVhc3kgdG8gdXBkYXRlIGlmIHRoYXQgZGVmYXVsdCBldmVyIGNoYW5nZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQURfTElNSVQgPSAyMDAwO1xuXG4vKipcbiAqIENvbXB1dGUgdGhlIHRvdWNoZWQgcmFuZ2UgZm9yIGEgcmVhZCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wnc1xuICogYG9mZnNldGAvYGxpbWl0YCBpbnB1dHMuIE5laXRoZXIgcHJlc2VudCBtZWFucyBhIGdlbnVpbmUgd2hvbGUtZmlsZSByZWFkIFx1MjAxNFxuICogZXZlcnkgY292ZXJpbmcgc3BhbiBzdGF5cyBpbiBzY29wZSwgbWF0Y2hpbmcgdG9kYXkncyBiZWhhdmlvci4gT3RoZXJ3aXNlXG4gKiB0aGUgcmFuZ2Ugc3RhcnRzIGF0IGBvZmZzZXRgIChkZWZhdWx0IGxpbmUgMSkgYW5kIHJ1bnMgZm9yIGBsaW1pdGAgbGluZXNcbiAqIChkZWZhdWx0IHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9KSwgY2xhbXBlZCB0byB0aGUgZmlsZSdzIGFjdHVhbCBsaW5lXG4gKiBjb3VudCBzbyBhIHNob3J0IGZpbGUgd2l0aCBhIGxhcmdlIGBvZmZzZXRgL2BsaW1pdGAgZG9lc24ndCBvdmVyc2hvb3QuXG4gKiBDbGFtcGluZyByZXF1aXJlcyByZWFkaW5nIHRoZSBmaWxlOyBhbiB1bnJlYWRhYmxlIGZpbGUgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgIFx1MjAxNCB0aGUgc2FtZSBmYWlsLW9wZW4gYmVoYXZpb3IgdGhlIHdyaXRlIHBhdGggdXNlcy5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJlYWRSYW5nZShcbiAgb2Zmc2V0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGxpbWl0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCAmJiBsaW1pdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBjb25zdCBzdGFydCA9IG9mZnNldCA/PyAxO1xuICBsZXQgbGluZUNvdW50OiBudW1iZXI7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICBsaW5lQ291bnQgPSBjb250ZW50Lmxlbmd0aCA9PT0gMCA/IDAgOiBjb250ZW50LnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyAobGltaXQgPz8gREVGQVVMVF9SRUFEX0xJTUlUKSAtIDEsIE1hdGgubWF4KGxpbmVDb3VudCwgc3RhcnQpKTtcbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgYW4gYW5jaG9yIGluIHRoZSB0b3VjaGVkIGZpbGUgaXRzZWxmLiBgbGlzdFxuICogLS1wb3JjZWxhaW4gPGZpbGU+YCByZXR1cm5zIGV2ZXJ5IGFuY2hvciBvZiBlYWNoIG1hdGNoaW5nIHNwYW4gXHUyMDE0IGNyb3NzLWZpbGVcbiAqIGFuY2hvcnMgaW5jbHVkZWQgXHUyMDE0IGJ1dCBvbmx5IGFuY2hvcnMgaW4gdGhlIHRvdWNoZWQgZmlsZSBwYXJ0aWNpcGF0ZSBpbiB0aGVcbiAqIHJhbmdlLWludGVyc2VjdGlvbiBzY29wZSB0ZXN0LiBSb3cgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmU7IHRoZSB0b3VjaGVkIHBhdGhcbiAqIGlzIGFic29sdXRlLCBzbyBtYXRjaCBvbiBhbiBleGFjdCBvciBgL2Atc2VwYXJhdGVkIHN1ZmZpeC5cbiAqL1xuZnVuY3Rpb24gb25Ub3VjaGVkRmlsZShyb3c6IFBvcmNlbGFpblJvdywgZmlsZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gZmlsZVBhdGggPT09IHJvdy5wYXRoIHx8IGZpbGVQYXRoLmVuZHNXaXRoKGAvJHtyb3cucGF0aH1gKTtcbn1cblxuLyoqXG4gKiBDb21wdXRlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGZvciB0aGUgdG91Y2gsIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzXG4gKiBub3RoaW5nIHdvcnRoIHN1cmZhY2luZy4gU2hhcmVkIGJ5IGJvdGggcGF0aHM7IHRoZSB3cml0ZSBwYXRoIHBhc3NlcyBhXG4gKiByZWNvdmVyZWQgcmFuZ2UgZm9yIHByZWNpc2lvbiwgdGhlIHJlYWQgcGF0aCBzY29wZXMgZmlsZS13aWRlLlxuICpcbiAqIEEgc3BhbiByZW5kZXJzIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiAobmFtZSwgYWxsIGFuY2hvcnMgd2l0aFxuICogZHJpZnRlZCBvbmVzIHN0YXR1cy1zdWZmaXhlZCwgd2h5KSB3aGVuIGl0cyBuYW1lIGhhcyBub3QgYmVlbiBzdXJmYWNlZCB0aGlzXG4gKiBzZXNzaW9uLCBvciB3aGVuIGl0IGNhcnJpZXMgYSBkcmlmdCBzdGF0dXMgbm90IHlldCBzdXJmYWNlZCBmb3IgaXQgXHUyMDE0IHNvIGFcbiAqIHNwYW4gZmlyc3Qgc2VlbiBoZWFsdGh5IHJlLXJlbmRlcnMgaW4gZnVsbCB3aGVuIGRyaWZ0IGxhdGVyIGFwcGVhcnMuIEEgc3BhblxuICogd2hvc2Ugb25seSBkcmlmdCBpcyBwb3NpdGlvbmFsIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgXHUyMDE0IG5ldmVyXG4gKiBgaXNEZWJ0YCkgaXMgZmlsdGVyZWQgb3V0IGVudGlyZWx5OiBwb3NpdGlvbmFsIGRyaWZ0IG5ldmVyIHN1cmZhY2VzLlxuICovXG5hc3luYyBmdW5jdGlvbiBjb21wdXRlU3VyZmFjZShcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJ1xuKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gIGlmIChjb3ZlcmluZy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIEdyb3VwIGV2ZXJ5IGFuY2hvciBieSBzcGFuOyBhIHNwYW4gaXMgaW4gc2NvcGUgd2hlbiBvbmUgb2YgaXRzIGFuY2hvcnMgb25cbiAgLy8gdGhlIHRvdWNoZWQgZmlsZSBpbnRlcnNlY3RzIHRoZSByZWNvdmVyZWQgcmFuZ2UuXG4gIGNvbnN0IGFuY2hvcnNCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGNvdmVyaW5nKSB7XG4gICAgY29uc3Qgcm93cyA9IGFuY2hvcnNCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBhbmNob3JzQnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cbiAgY29uc3QgdG91Y2hlZE5hbWVzID0gWy4uLmFuY2hvcnNCeU5hbWUua2V5cygpXS5maWx0ZXIoKG5hbWUpID0+XG4gICAgKGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdKS5zb21lKChyb3cpID0+IG9uVG91Y2hlZEZpbGUocm93LCBpbnB1dC5maWxlUGF0aCkgJiYgaW50ZXJzZWN0cyhyb3csIHJhbmdlKSlcbiAgKTtcbiAgaWYgKHRvdWNoZWROYW1lcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGRyaWZ0Um93cyA9IGF3YWl0IGV4ZWN1dG9ycy5kcmlmdChbaW5wdXQuZmlsZVBhdGhdLCBpbnB1dC5jd2QpO1xuICBjb25zdCBkcmlmdEJ5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBEcmlmdFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBkcmlmdFJvd3MpIHtcbiAgICBjb25zdCByb3dzID0gZHJpZnRCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBkcmlmdEJ5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG5cbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCk7XG4gIGNvbnN0IHRvUmVjb3JkOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzZWN0aW9uczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgbmFtZSBvZiB0b3VjaGVkTmFtZXMpIHtcbiAgICBjb25zdCBzcGFuRHJpZnQgPSBkcmlmdEJ5TmFtZS5nZXQobmFtZSkgPz8gW107XG4gICAgY29uc3QgZGVidFJvd3MgPSBzcGFuRHJpZnQuZmlsdGVyKChyb3cpID0+IGlzRGVidChyb3cuc3RhdHVzKSk7XG4gICAgaWYgKHNwYW5EcmlmdC5sZW5ndGggPiAwICYmIGRlYnRSb3dzLmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIHBvc2l0aW9uYWwtb25seSBkcmlmdCBuZXZlciBzdXJmYWNlc1xuXG4gICAgY29uc3QgZGVidFN0YXR1c2VzID0gWy4uLm5ldyBTZXQoZGVidFJvd3MubWFwKChyb3cpID0+IHJvdy5zdGF0dXMpKV0uc29ydCgpO1xuICAgIGNvbnN0IHVuc3VyZmFjZWREZWJ0ID0gZGVidFN0YXR1c2VzLmZpbHRlcigoc3RhdHVzKSA9PiAhc3VyZmFjZWQuaGFzKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpKTtcbiAgICBjb25zdCBpc05ld05hbWUgPSAhc3VyZmFjZWQuaGFzKG5hbWUpO1xuICAgIGlmICghaXNOZXdOYW1lICYmIHVuc3VyZmFjZWREZWJ0Lmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIGZ1bGx5IHN1cmZhY2VkIGFscmVhZHlcblxuICAgIGNvbnN0IHdoeSA9IGF3YWl0IGV4ZWN1dG9ycy53aHkobmFtZSwgaW5wdXQuY3dkKTtcbiAgICBzZWN0aW9ucy5wdXNoKHJlbmRlclNwYW5TZWN0aW9uKG5hbWUsIGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdLCBkZWJ0Um93cywgd2h5KSk7XG4gICAgaWYgKGRlYnRTdGF0dXNlcy5sZW5ndGggPiAwKSBkcmlmdGVkTmFtZXMucHVzaChuYW1lKTtcblxuICAgIGlmIChpc05ld05hbWUpIHRvUmVjb3JkLnB1c2gobmFtZSk7XG4gICAgZm9yIChjb25zdCBzdGF0dXMgb2YgdW5zdXJmYWNlZERlYnQpIHRvUmVjb3JkLnB1c2goZHJpZnRLZXkobmFtZSwgc3RhdHVzKSk7XG4gIH1cblxuICBpZiAoc2VjdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgbWVtby5hZGRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQsIHRvUmVjb3JkKTtcbiAgY29uc3QgZmlsZU5hbWUgPSBiYXNlbmFtZShpbnB1dC5maWxlUGF0aCk7XG4gIGNvbnN0IGhlYWRlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRIZWFkZXIoZHJpZnRlZE5hbWVzLmxlbmd0aCwgaW5wdXQua2luZCkgOiBjbGVhbkhlYWRlcihmaWxlTmFtZSk7XG4gIGNvbnN0IGZvb3RlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzKSA6IGNsZWFuRm9vdGVyKGZpbGVOYW1lKTtcbiAgcmV0dXJuIGJ1aWxkQmxvY2soc2VjdGlvbnMsIGhlYWRlciwgZm9vdGVyKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHRvdWNoIGhvb2sgZm9yIGEgc2luZ2xlIHRvb2wgY2FsbCwgYnJhbmNoaW5nIG9uIHtAbGluayBUb3VjaElucHV0LmtpbmR9LlxuICpcbiAqIC0gKipXcml0ZSBwYXRoKio6IHJ1biBgZXhlY3V0b3JzLmZpeGAgKGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgKSBzY29wZWRcbiAqICAgdG8gdGhlIHRvdWNoZWQgZmlsZSB0byBoZWFsIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSwgdGhlblxuICogICBjb21wdXRlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGFnYWluc3QgdGhlIGhlYWxlZCBhbmNob3JzLCByZW5kZXJpbmdcbiAqICAgZWFjaCBzdXJmYWNlZCBzcGFuIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiB3aXRoIGFueSByZW1haW5pbmdcbiAqICAgc2VtYW50aWMgZHJpZnQgc3RhdHVzLXN1ZmZpeGVkIG9uIGl0cyBhbmNob3JzLiBDYWRlbmNlIGlzIGRlZHVwZWQgdGhyb3VnaFxuICogICBgbWVtb2AgcGVyIHNwYW4gbmFtZSBhbmQgcGVyIChzcGFuLCBzdGF0dXMpLlxuICogLSAqKlJlYWQgcGF0aCoqOiBuZXZlciBpbnZva2VzIGBmaXhgIGFuZCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlOyBzdXJmYWNlcyB0aGVcbiAqICAgc3BhbnMgb3ZlcmxhcHBpbmcgdGhlIHJlYWQncyBgb2Zmc2V0YC9gbGltaXRgIHdpbmRvdyAoc2VlXG4gKiAgIHtAbGluayByZWNvdmVyUmVhZFJhbmdlfTsgYSByZWFkIHdpdGggbmVpdGhlciBpcyB3aG9sZS1maWxlLCBtYXRjaGluZ1xuICogICB0b2RheSdzIGJlaGF2aW9yKSB3aXRoIHBvc2l0aW9uYWwgc3RhdHVzZXMgZmlsdGVyZWQgb3V0IHZpYSBgaXNEZWJ0KClgLlxuICpcbiAqIEZhaWxzIG9wZW46IGFueSBleGVjdXRvciByZWplY3Rpb24gb3IgaW50ZXJuYWwgZXJyb3IgeWllbGRzXG4gKiBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgIChubyBzaWduYWwsIGVkaXRpbmcgbmV2ZXIgYmxvY2tlZCkgcmF0aGVyIHRoYW5cbiAqIHRocm93aW5nLiBgdHJlZU1vZGlmaWVkYCByZWZsZWN0cyBhIHN1Y2Nlc3NmdWwgYC0tZml4YCBldmVuIHdoZW4gdGhlXG4gKiBzdWJzZXF1ZW50IHN1cmZhY2UgY29tcHV0YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Ub3VjaEhvb2soXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmVcbik6IFByb21pc2U8VG91Y2hPdXRwdXQ+IHtcbiAgbGV0IHRyZWVNb2RpZmllZCA9IGZhbHNlO1xuICB0cnkge1xuICAgIGxldCByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnID0gJ3dob2xlLWZpbGUnO1xuICAgIGlmIChpbnB1dC5raW5kID09PSAnd3JpdGUnKSB7XG4gICAgICBjb25zdCBmaXggPSBhd2FpdCBleGVjdXRvcnMuZml4KGlucHV0LmZpbGVQYXRoLCBpbnB1dC5jd2QpO1xuICAgICAgdHJlZU1vZGlmaWVkID0gZml4Lm1vZGlmaWVkO1xuICAgICAgcmFuZ2UgPSByZWNvdmVyUmFuZ2VGcm9tRGlzayhpbnB1dC53cml0dGVuLCBpbnB1dC5maWxlUGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gcmVjb3ZlclJlYWRSYW5nZShpbnB1dC5vZmZzZXQsIGlucHV0LmxpbWl0LCBpbnB1dC5maWxlUGF0aCk7XG4gICAgfVxuICAgIGNvbnN0IGFkZGl0aW9uYWxDb250ZXh0ID0gYXdhaXQgY29tcHV0ZVN1cmZhY2UoaW5wdXQsIGV4ZWN1dG9ycywgbWVtbywgcmFuZ2UpO1xuICAgIHJldHVybiB7IGFkZGl0aW9uYWxDb250ZXh0LCB0cmVlTW9kaWZpZWQgfTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmFpbCBvcGVuOiBuZXZlciBsZXQgYSB0b3VjaC1jb3JlIGVycm9yIHByb3BhZ2F0ZSB1cCBhbmQgYmxvY2sgdGhlIHRvb2xcbiAgICAvLyBjYWxsLiBUaGUgdHJlZSBtYXkgYWxyZWFkeSBoYXZlIGJlZW4gaGVhbGVkICh0cmVlTW9kaWZpZWQgcHJlc2VydmVkKS5cbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dDogbnVsbCwgdHJlZU1vZGlmaWVkIH07XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9yc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDEwXzAwMDtcblxuLyoqIFJlc29sdmUgdGhlIHRvdWNoZWQgZmlsZSB0byBhIHBhdGggcmVsYXRpdmUgdG8gaXRzIHJlcG8gcm9vdCwgZm9yIGBnaXQgc3BhbmAuICovXG5mdW5jdGlvbiByZXBvUmVsQXJnKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKTogeyByZXBvUm9vdDogc3RyaW5nOyByZWxQYXRoOiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICBpZiAoIXJlcG9Sb290KSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgcmVwb1Jvb3QsIHJlbFBhdGg6IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBmaWxlUGF0aCkgfTtcbn1cblxuLyoqXG4gKiBBIHNuYXBzaG90IG9mIHRoZSBzcGFuIHJvb3QncyB3b3JraW5nLXRyZWUgc3RhdHVzLCB1c2VkIHRvIGRldGVjdCB3aGV0aGVyIGFcbiAqIGAtLWZpeGAgcmUtYW5jaG9yZWQgYW55dGhpbmcuIENvbXBhcmVkIGJlZm9yZS9hZnRlcjsgYW4gdW5yZXNvbHZhYmxlIHJlcG8gb3JcbiAqIGEgZmFpbGVkIHN0YXR1cyB5aWVsZHMgYSBzdGFibGUgZW1wdHkgc3RyaW5nIChcdTIxOTIgYG1vZGlmaWVkOiBmYWxzZWApLlxuICovXG5mdW5jdGlvbiBzcGFuU3RhdHVzU25hcHNob3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHNwYW5Sb290ID0gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdzdGF0dXMnLCAnLS1wb3JjZWxhaW4nLCAnLS0nLCBzcGFuUm9vdF0sIHtcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IERFRkFVTFRfVElNRU9VVF9NU1xuICAgIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcHJvZHVjdGlvbiBleGVjdXRpb24gc3VyZmFjZTogdGhyZWUgc3VicHJvY2Vzcy1iYWNrZWQgZXhlY3V0b3JzIGZvbGxvd2luZ1xuICogc3Bhbi1zdXJmYWNlLnRzJ3MgYGNyZWF0ZURlZmF1bHQqRXhlY3V0b3JgIHN0eWxlLiBFYWNoIGNhcHR1cmVzIHN0ZG91dCBldmVuIG9uXG4gKiBhIG5vbi16ZXJvIGV4aXQgd2hlcmUgdGhlIENMSSBzdGlsbCBlbWl0cyB1c2VmdWwgb3V0cHV0LCBhbmQgZXZlcnkgZmFpbHVyZVxuICogbW9kZSAoYWJzZW50IGJpbmFyeSwgdGltZW91dCwgcGFyc2UgZmFpbHVyZSkgc3VyZmFjZXMgYXMgYW4gZW1wdHkvY2xlYW4gcmVzdWx0XG4gKiBzbyB7QGxpbmsgcnVuVG91Y2hIb29rfSdzIGZhaWwtb3BlbiBjb250cmFjdCBob2xkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycyh0aW1lb3V0TXM6IG51bWJlciA9IERFRkFVTFRfVElNRU9VVF9NUyk6IFRvdWNoRXhlY3V0b3JzIHtcbiAgcmV0dXJuIHtcbiAgICBmaXg6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4geyBtb2RpZmllZDogZmFsc2UgfTtcbiAgICAgIGNvbnN0IGJlZm9yZSA9IHNwYW5TdGF0dXNTbmFwc2hvdChyZXNvbHZlZC5yZXBvUm9vdCk7XG4gICAgICB0cnkge1xuICAgICAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsIHJlc29sdmVkLnJlbFBhdGgsICctLWZpeCddLCB7XG4gICAgICAgICAgY3dkOiByZXNvbHZlZC5yZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAxIG9uIGRyaWZ0IGV2ZW4gd2hlbiBgLS1maXhgIGhlYWxlZCBzb21ldGhpbmcsXG4gICAgICAgIC8vIGFuZCBub24temVybyBvbiBnZW51aW5lIGZhaWx1cmU7IHRoZSBzbmFwc2hvdCBkaWZmIGlzIHRoZSBzb3VyY2Ugb2ZcbiAgICAgICAgLy8gdHJ1dGggZm9yIHdoZXRoZXIgdGhlIHRyZWUgY2hhbmdlZCwgc28gdGhlIGV4aXQgY29kZSBpcyBpZ25vcmVkIGhlcmUuXG4gICAgICB9XG4gICAgICBjb25zdCBhZnRlciA9IHNwYW5TdGF0dXNTbmFwc2hvdChyZXNvbHZlZC5yZXBvUm9vdCk7XG4gICAgICByZXR1cm4geyBtb2RpZmllZDogYmVmb3JlICE9PSBhZnRlciB9O1xuICAgIH0sXG5cbiAgICBsaXN0OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIFtdO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsICctLXBvcmNlbGFpbicsIHJlc29sdmVkLnJlbFBhdGhdLCB7XG4gICAgICAgICAgY3dkOiByZXNvbHZlZC5yZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBwYXJzZVBvcmNlbGFpbihvdXQpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgZHJpZnQ6IGFzeW5jIChhcmdzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBjb25zdCBydW5Dd2QgPSByZXBvUm9vdCA/PyBjd2Q7XG4gICAgICAvLyBUaGUgY29yZSBwYXNzZXMgYW4gYWJzb2x1dGUgZmlsZSBwYXRoOyBzY29wZSBgZ2l0IHNwYW4gZHJpZnRgIHRvIGl0XG4gICAgICAvLyByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290IHNvIHRoZSBwYXRoIGluZGV4IHJlc29sdmVzIGl0LlxuICAgICAgY29uc3Qgc2NvcGVkID0gcmVwb1Jvb3QgPyBhcmdzLm1hcCgoYSkgPT4gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGEpKSA6IGFyZ3M7XG4gICAgICBsZXQgb3V0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zY29wZWRdLCB7XG4gICAgICAgICAgY3dkOiBydW5Dd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnN0IGNhcHR1cmVkID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgIGlmICh0eXBlb2YgY2FwdHVyZWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgb3V0ID0gY2FwdHVyZWQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcGFyc2VEcmlmdFBvcmNlbGFpbihvdXQpO1xuICAgIH0sXG5cbiAgICB3aHk6IGFzeW5jIChuYW1lLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICd3aHknLCBuYW1lXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QgPz8gY3dkLFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgdGV4dCA9IG91dC50cmltRW5kKCk7XG4gICAgICAgIC8vIEJhcmUgYGdpdCBzcGFuIHdoeWAgcHJpbnRzIHRoaXMgZXhhY3Qgc2VudGluZWwgKGV4aXQgMCkgd2hlbiB0aGVcbiAgICAgICAgLy8gc3BhbiBoYXMgbm8gd2h5IHJlY29yZGVkIFx1MjAxNCB0cmVhdCBpdCBhcyBcIm5vIHdoeVwiLCBub3QgYXMgY29udGVudC5cbiAgICAgICAgaWYgKHRleHQubGVuZ3RoID09PSAwIHx8IHRleHQgPT09IGBcXGAke25hbWV9XFxgIGhhcyBubyB3aHkgcmVjb3JkZWQuYCkgcmV0dXJuIG51bGw7XG4gICAgICAgIHJldHVybiB0ZXh0O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBib3gtZHJhd2luZyB0cmVlIHJlbmRlcmVyIGZvciBhIHNwYW4ncyBhbmNob3IgbGlzdCwgdXNlZCBieSBldmVyeVxuICogY2FsbCBzaXRlIHRoYXQgdG9kYXkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xzdGFydC1MZW5kYCBidWxsZXQgcnVuXG4gKiAoYHRvdWNoLWNvcmUudHNgJ3MgYGFuY2hvckJ1bGxldHNgLCBhbmQgYGFkdmlzb3ItY29yZS50c2Anc1xuICogYGFubm90YXRlQmxvY2tzYC9gZ3JvdXBDb3ZlcmluZ0J5TmFtZWApLiBBbmNob3JzIHRoYXQgc2hhcmUgYSBkaXJlY3RvcnlcbiAqIHByZWZpeCBjb2xsYXBzZSBpbnRvIG9uZSB0cmVlIGluc3RlYWQgb2YgYmVpbmcgcmVjb25zdHJ1Y3RlZCBieSBleWUgZnJvbSBhXG4gKiBmbGF0IGxpc3QgXHUyMDE0IHRoZSBtb3RpdmF0aW5nIGNhc2UgaXMgcGFyaXR5IGFuY2hvcnMgdW5kZXIgcGFyYWxsZWxcbiAqIGBwdWJsaWMvY2xhdWRlLy4uLmAvYHB1YmxpYy9jb2RleC8uLi5gIHRyZWVzLlxuICpcbiAqIFRoaXMgbW9kdWxlIGlzIGEgcHVyZSBwcmVzZW50YXRpb24gdHJhbnNmb3JtOiBpdCBuZXZlciBjb21wdXRlcyBkcmlmdFxuICogc3RhdHVzIG9yIGRlY2lkZXMgd2hpY2ggYW5jaG9ycyBhcmUgc3VyZmFjZWQuIENhbGxlcnMgcHJlY29tcHV0ZSBlYWNoIHJvdydzXG4gKiBgc3VmZml4YCAoZS5nLiBgIFx1MjAxNCBjaGFuZ2VkYCkgZXhhY3RseSBhcyB0aGV5IGRvIHRvZGF5LCBhbmQgb25seSB0aGUgKnNoYXBlKlxuICogb2YgdGhlIHByaW50ZWQgbGlzdCBjaGFuZ2VzLlxuICovXG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIHR5cGVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBIb3cgYSBzaW5nbGUgYW5jaG9yJ3MgbGluZSByYW5nZSBpcyBrbm93bi4gYHJhbmdlYCBhbmQgYHdob2xlLWZpbGVgIGFyZSB0aGVcbiAqIHR3byBzaGFwZXMgZXZlcnkgYW5jaG9yIHRha2VzIHRvZGF5OyBgdHJ1bmNhdGVkYCBpcyBhIGRlZmVuc2l2ZSB0aGlyZCBzaGFwZVxuICogcmVhY2hhYmxlIG9ubHkgZnJvbSByZS1wYXJzaW5nIHRoZSBDTEkncyBmbGF0IGh1bWFuLWZvcm1hdCB0ZXh0IChhIGAjTGBcbiAqIGZyYWdtZW50IHRoYXQgZG9lc24ndCBjbGVhbmx5IG1hdGNoIGAjTHN0YXJ0LUxlbmRgKS5cbiAqXG4gKiBWZXJpZmllZCBpbnZhcmlhbnQ6IHRoZSBzdHJ1Y3R1cmVkLWRhdGEgY2FsbCBzaXRlcyBjYW4gbmV2ZXIgcHJvZHVjZVxuICogYHRydW5jYXRlZGAuIGBwYXJzZVBvcmNlbGFpbmAgKGFnZW50LWhvb2tzLWNvbW1vbi50cykgYGNvbnRpbnVlYHMgcGFzdCBhbnlcbiAqIHJvdyBtaXNzaW5nIGEgdmFsaWQgcmFuZ2UsIHNvIGFuIGluY29tcGxldGUgYFBvcmNlbGFpblJvd2AgY2FuIG5ldmVyIGJlXG4gKiBjb25zdHJ1Y3RlZDsgdGhlIFJ1c3QgQ0xJJ3Mgb3duIHBvcmNlbGFpbiB3cml0ZXIgYWx3YXlzIGVtaXRzIGEgcmFuZ2VcbiAqIGNvbHVtbiAoYDAtMGAgZm9yIHdob2xlLWZpbGUpLiBgdHJ1bmNhdGVkYCBpcyByZWFjaGFibGUgb25seSBmcm9tXG4gKiBgYW5ub3RhdGVCbG9ja3NgJyBmbGF0LXRleHQgcGFyc2luZyBvZiBgYmxvY2tzVGV4dGAgaW4gYSBsYXRlciBwaGFzZS5cbiAqL1xuZXhwb3J0IHR5cGUgUmFuZ2VMYWJlbCA9IHsga2luZDogJ3JhbmdlJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfSB8IHsga2luZDogJ3dob2xlLWZpbGUnIH0gfCB7IGtpbmQ6ICd0cnVuY2F0ZWQnIH07XG5cbi8qKiBPbmUgc3RhY2tlZCByYW5nZSB1bmRlciBhIGBUcmVlQW5jaG9yYCwgd2l0aCBpdHMgcHJlY29tcHV0ZWQgZHJpZnQgc3VmZml4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBSYW5nZUVudHJ5IHtcbiAgcmFuZ2U6IFJhbmdlTGFiZWw7XG4gIC8qKiBQcmVjb21wdXRlZCBgIFx1MjAxNCBjaGFuZ2VkYCAoZXRjLiksIG9yIGAnJ2Agd2hlbiB0aGUgYW5jaG9yIGNhcnJpZXMgbm8gZHJpZnQuICovXG4gIHN1ZmZpeDogc3RyaW5nO1xufVxuXG4vKiogT25lIGRpc3RpbmN0IHBhdGgncyBjb2xsYXBzZWQgYW5jaG9yIGVudHJ5LCByZWFkeSBmb3IgdHJlZSBsYXlvdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRyZWVBbmNob3Ige1xuICAvKiogUmVwby1yZWxhdGl2ZSwgcG9zaXgtc2VwYXJhdGVkIHBhdGguICovXG4gIHBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIFN0YWNrZWQgcmFuZ2VzIG9uIHRoaXMgcGF0aC4gRW1wdHkgbWVhbnMgXCJwYXRoIG9ubHksIG5vIHJhbmdlIGNvbHVtbiBhdFxuICAgKiBhbGxcIiBcdTIwMTQgYSBiYXJlLXBhdGggbGVhZiwgZGlzdGluY3QgZnJvbSBhIHNpbmdsZSBgd2hvbGUtZmlsZWAgZW50cnkgKHdoaWNoXG4gICAqIHJlbmRlcnMgdGhlIHBhdGggdG9vLCBidXQgaXMgYW4gZXhwbGljaXQgcmFuZ2Uta2luZCBjbGFzc2lmaWNhdGlvbikuXG4gICAqL1xuICByYW5nZXM6IFJhbmdlRW50cnlbXTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBjb2xsYXBzZUJ5UGF0aFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ29sbGFwc2Ugcm93cyB0aGF0IG5hbWUgdGhlIHNhbWUgcGF0aCBpbnRvIG9uZSBgVHJlZUFuY2hvcmAgd2l0aCBzdGFja2VkXG4gKiByYW5nZXMsIHByZXNlcnZpbmcgZmlyc3Qtc2VlbiBvcmRlci4gYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXNcbiAqIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXIgZGlzdGluY3QgcGF0aCBcdTIwMTQgdGhpcyBpcyB0aGUgbWFuZGF0b3J5XG4gKiBwcmUtcHJvY2Vzc2luZyBzdGVwIGV2ZXJ5IGNhbGxlciBydW5zIGZpcnN0IHRvIGd1YXJhbnRlZSB0aGF0LlxuICpcbiAqIE1pcnJvcnMgdGhlIG9yZGVyLWFycmF5LXBsdXMtTWFwIGlkaW9tIGFscmVhZHkgdXNlZCBieVxuICogYGRlZHVwZUJ5QW5jaG9yKClgIChhZHZpc29yLWNvcmUudHMpIGZvciB0aGUgc2FtZSByZWFzb246IHRoZSBDTEkgY2FuIGVtaXRcbiAqIG11bHRpcGxlIHJvd3MgZm9yIG9uZSBsb2dpY2FsIHBhdGgsIGFuZCB0aGUgKnBvc2l0aW9uKiBvZiBhIGxhdGVyXG4gKiBzYW1lLXBhdGggcm93IGlzIHN1YnN1bWVkIGludG8gdGhhdCBwYXRoJ3MgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGFwcGVuZGVkXG4gKiBhdCBpdHMgb3duIGxhdGVyIHBvc2l0aW9uLiBDb25jcmV0ZWx5OiBgYS50cyNMMS1MNWAsIGBiLnRzI0wxLUw1YCxcbiAqIGBhLnRzI0w5LUwxMmAgY29sbGFwc2VzIHRvIGBbYS50cyAodHdvIHN0YWNrZWQgcmFuZ2VzKSwgYi50cyAob25lIHJhbmdlKV1gXG4gKiBcdTIwMTQgYGEudHNgIHNpdHMgYXQgcG9zaXRpb24gMCwgaXRzIGZpcnN0IG9jY3VycmVuY2UsIG5vdCBpdHMgbGFzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbGxhcHNlQnlQYXRoKHJvd3M6IHsgcGF0aDogc3RyaW5nOyByYW5nZTogUmFuZ2VMYWJlbDsgc3VmZml4OiBzdHJpbmcgfVtdKTogVHJlZUFuY2hvcltdIHtcbiAgY29uc3Qgb3JkZXI6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGJ5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBUcmVlQW5jaG9yPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgbGV0IGFuY2hvciA9IGJ5UGF0aC5nZXQocm93LnBhdGgpO1xuICAgIGlmICghYW5jaG9yKSB7XG4gICAgICBhbmNob3IgPSB7IHBhdGg6IHJvdy5wYXRoLCByYW5nZXM6IFtdIH07XG4gICAgICBieVBhdGguc2V0KHJvdy5wYXRoLCBhbmNob3IpO1xuICAgICAgb3JkZXIucHVzaChyb3cucGF0aCk7XG4gICAgfVxuICAgIGFuY2hvci5yYW5nZXMucHVzaCh7IHJhbmdlOiByb3cucmFuZ2UsIHN1ZmZpeDogcm93LnN1ZmZpeCB9KTtcbiAgfVxuICByZXR1cm4gb3JkZXIubWFwKChwYXRoKSA9PiBieVBhdGguZ2V0KHBhdGgpIGFzIFRyZWVBbmNob3IpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRyZWUgY29uc3RydWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIExlYWZOb2RlIHtcbiAga2luZDogJ2xlYWYnO1xuICBuYW1lOiBzdHJpbmc7XG4gIGFuY2hvcjogVHJlZUFuY2hvcjtcbn1cblxuaW50ZXJmYWNlIERpck5vZGUge1xuICBraW5kOiAnZGlyJztcbiAgbmFtZTogc3RyaW5nO1xuICBjaGlsZHJlbjogUGF0aFRyZWVOb2RlW107XG59XG5cbnR5cGUgUGF0aFRyZWVOb2RlID0gTGVhZk5vZGUgfCBEaXJOb2RlO1xuXG4vKipcbiAqIFNwbGl0IGEgcGF0aCBpbnRvIGAvYC1zZXBhcmF0ZWQgc2VnbWVudHMsIG9yIGBudWxsYCB3aGVuIGRvaW5nIHNvIHdvdWxkXG4gKiBmZWVkIGFuIGVtcHR5LXN0cmluZyBzZWdtZW50IGludG8gdGhlIHRyaWUgKGEgbGVhZGluZyBgL2AsIGEgdHJhaWxpbmcgYC9gLFxuICogYSBkb3VibGVkIGAvL2AsIG9yIHRoZSBlbXB0eSBzdHJpbmcpLiBgbnVsbGAgc2lnbmFscyB0aGUgY2FsbGVyIHRvIHJlbmRlclxuICogdGhhdCBhbmNob3IncyBmdWxsIHBhdGggc3RyaW5nIGFzIGEgc2luZ2xlLCB1bnNwbGl0LCBhdG9taWMgdG9wLWxldmVsIGxlYWZcbiAqIGluc3RlYWQgb2YgYXR0ZW1wdGluZyB0byBuZXN0IGl0IFx1MjAxNCBhIGtub3duLWVudW1lcmFibGUgY2xhc3Mgb2YgbWFsZm9ybWVkXG4gKiBwYXRocyBnZXRzIGEgcmVhbCBydWxlIGhlcmUgcmF0aGVyIHRoYW4gdGhlIHNwbGl0IHJ1bm5pbmcgYW55d2F5IGFuZFxuICogZmFicmljYXRpbmcgYW4gZW1wdHktbmFtZWQgZGlyZWN0b3J5IG5vZGUuIEEgYmFyZSBmaWxlbmFtZSB3aXRoIG5vIGAvYCBhdFxuICogYWxsIHByb2R1Y2VzIGV4YWN0bHkgb25lIG5vbi1lbXB0eSBzZWdtZW50IGFuZCBpcyBoYW5kbGVkIGJ5IHRoZSBvcmRpbmFyeVxuICogcGF0aCBiZWxvdyAoaXQgYmVjb21lcyBhIHRvcC1sZXZlbCBsZWFmIHdpdGggbm8gZGlyZWN0b3J5IHRvIG5lc3QgdW5kZXIgXHUyMDE0XG4gKiBhbHJlYWR5IGF0b21pYywgbm8gc3BlY2lhbCBjYXNlIG5lZWRlZCkuXG4gKi9cbmZ1bmN0aW9uIHNwbGl0U2VnbWVudHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc2VnbWVudHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGlmIChzZWdtZW50cy5zb21lKChzZWdtZW50KSA9PiBzZWdtZW50Lmxlbmd0aCA9PT0gMCkpIHJldHVybiBudWxsO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbmZ1bmN0aW9uIGZpbmRPckNyZWF0ZURpcihwYXJlbnQ6IERpck5vZGUsIG5hbWU6IHN0cmluZyk6IERpck5vZGUge1xuICBmb3IgKGNvbnN0IGNoaWxkIG9mIHBhcmVudC5jaGlsZHJlbikge1xuICAgIGlmIChjaGlsZC5raW5kID09PSAnZGlyJyAmJiBjaGlsZC5uYW1lID09PSBuYW1lKSByZXR1cm4gY2hpbGQ7XG4gIH1cbiAgY29uc3Qgbm9kZTogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWUsIGNoaWxkcmVuOiBbXSB9O1xuICBwYXJlbnQuY2hpbGRyZW4ucHVzaChub2RlKTtcbiAgcmV0dXJuIG5vZGU7XG59XG5cbi8qKiBJbnNlcnQgb25lIGFuY2hvciBpbnRvIHRoZSB0cmllLCBjcmVhdGluZy9yZXVzaW5nIGRpcmVjdG9yeSBub2RlcyBpbiBhcnJpdmFsIG9yZGVyLiAqL1xuZnVuY3Rpb24gaW5zZXJ0QW5jaG9yKHJvb3Q6IERpck5vZGUsIHNlZ21lbnRzOiBzdHJpbmdbXSwgYW5jaG9yOiBUcmVlQW5jaG9yKTogdm9pZCB7XG4gIGxldCBjdXIgPSByb290O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnRzLmxlbmd0aCAtIDE7IGkrKykge1xuICAgIGN1ciA9IGZpbmRPckNyZWF0ZURpcihjdXIsIHNlZ21lbnRzW2ldKTtcbiAgfVxuICBjdXIuY2hpbGRyZW4ucHVzaCh7IGtpbmQ6ICdsZWFmJywgbmFtZTogc2VnbWVudHNbc2VnbWVudHMubGVuZ3RoIC0gMV0sIGFuY2hvciB9KTtcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgdG9wLWxldmVsIGZvcmVzdCBmcm9tIGEgYFRyZWVBbmNob3JbXWAgYWxyZWFkeSBjb2xsYXBzZWQgYnlcbiAqIGBjb2xsYXBzZUJ5UGF0aGAuIFNpYmxpbmcgb3JkZXIgaXMgbmV2ZXIgcmUtc29ydGVkIFx1MjAxNCBhIHBhdGggZWl0aGVyIG9wZW5zIGFcbiAqIG5ldyBub2RlIGF0IGl0cyBhcnJpdmFsIHBvc2l0aW9uIG9yIGlzIG5lc3RlZCB1bmRlciBhIGRpcmVjdG9yeSBub2RlXG4gKiBjcmVhdGVkL3JldXNlZCBhdCB0aGF0IGRpcmVjdG9yeSdzIG93biBmaXJzdC1vY2N1cnJlbmNlIHBvc2l0aW9uLlxuICovXG5mdW5jdGlvbiBidWlsZEZvcmVzdChhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBQYXRoVHJlZU5vZGVbXSB7XG4gIGNvbnN0IHJvb3Q6IERpck5vZGUgPSB7IGtpbmQ6ICdkaXInLCBuYW1lOiAnJywgY2hpbGRyZW46IFtdIH07XG4gIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcbiAgICBjb25zdCBzZWdtZW50cyA9IHNwbGl0U2VnbWVudHMoYW5jaG9yLnBhdGgpO1xuICAgIGlmIChzZWdtZW50cyA9PT0gbnVsbCkge1xuICAgICAgcm9vdC5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBhbmNob3IucGF0aCwgYW5jaG9yIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGluc2VydEFuY2hvcihyb290LCBzZWdtZW50cywgYW5jaG9yKTtcbiAgfVxuICByZXR1cm4gcm9vdC5jaGlsZHJlbjtcbn1cblxuLyoqIEEgbm9kZSBwYWlyZWQgd2l0aCB0aGUgKHBvc3NpYmx5IGZvbGRlZCkgbmFtZSBpdCBkaXNwbGF5cyBvbiBpdHMgb3duIGxpbmUuICovXG5pbnRlcmZhY2UgRGlzcGxheUl0ZW0ge1xuICBuYW1lOiBzdHJpbmc7XG4gIG5vZGU6IFBhdGhUcmVlTm9kZTtcbn1cblxuLyoqXG4gKiBGb2xkIGEgY2hhaW4gb2Ygc2luZ2xlLWNoaWxkIG5vZGVzIGludG8gb25lIGNvbWJpbmVkIG5hbWVcbiAqIChgcHVibGljL2NsYXVkZS9ydW50aW1lL3NraWxscy9jYXJkYCwgYGRpcnR5L21vZC5yc2AsXG4gKiBgLmRldmNvbnRhaW5lci9Eb2NrZXJmaWxlYCkuIEZvbGRpbmcgY29udGludWVzIHdoaWxlIHRoZSBjdXJyZW50IG5vZGUgaXMgYVxuICogZGlyZWN0b3J5IHdpdGggKipleGFjdGx5IG9uZSBjaGlsZCoqLCByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhhdCBjaGlsZCBpcyBhXG4gKiBkaXJlY3Rvcnkgb3IgYSBsZWFmOiBhIG5vZGUgd2l0aCBvbmUgY2hpbGQgY29udmV5cyBubyBncm91cGluZyBieVxuICogZGVmaW5pdGlvbiwgc28gZm9sZGluZyBpdCBsb3NlcyBubyBzdHJ1Y3R1cmUgd2hpbGUgcmVtb3ZpbmcgYSBsaW5lIHdob3NlXG4gKiBvbmx5IGNvbnRlbnQgaXMgYSBjb25uZWN0b3IuIFN0b3BzIGF0IHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2l0aCAyKyBjaGlsZHJlblxuICogKGV4cGFuZCBmcm9tIHRoZXJlKSBvciBhdCBhIGxlYWYgKHdoaWNoIHRoZW4gcmVuZGVycyB3aXRoIHRoZSBmb2xkZWQgbmFtZSkuXG4gKlxuICogRm9sZGluZyBsb25lICpsZWF2ZXMqIFx1MjAxNCBub3QganVzdCBsb25lIGRpcmVjdG9yaWVzIFx1MjAxNCBpcyB3aGF0IGtlZXBzIHRoZSB0cmVlXG4gKiBubyB0YWxsZXIgdGhhbiB0aGUgZmxhdCBidWxsZXQgbGlzdCBpdCByZXBsYWNlcywgYW5kIHdoYXQgbWFrZXMgYSBzaW5nbGVcbiAqIGFuY2hvciByZW5kZXIgYXMgdGhlIG9uZS1saW5lIHRyZWUgdGhlIHBsYW4gcHJvbWlzZXMgZXZlbiB3aGVuIGl0cyBwYXRoIGhhc1xuICogZGlyZWN0b3JpZXMgaW4gaXQuIEl0IGFsc28ga2VlcHMgdGhlIGRpc2NyaW1pbmF0aW5nIHNlZ21lbnQgb24gdGhlIHNhbWVcbiAqIGxpbmUgYXMgaXRzIHJhbmdlIChgZGlydHkvbW9kLnJzICNMMzkyLUwzOTlgKSBmb3IgYG1vZC5yc2AvYGluZGV4LnRzYFxuICogbGF5b3V0cywgd2hlcmUgdGhlIGZpbGVuYW1lIGFsb25lIGlkZW50aWZpZXMgbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gZm9sZENoYWluKG5vZGU6IFBhdGhUcmVlTm9kZSk6IERpc3BsYXlJdGVtIHtcbiAgbGV0IG5hbWUgPSBub2RlLm5hbWU7XG4gIGxldCBjdXIgPSBub2RlO1xuICB3aGlsZSAoY3VyLmtpbmQgPT09ICdkaXInICYmIGN1ci5jaGlsZHJlbi5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBjaGlsZCA9IGN1ci5jaGlsZHJlblswXTtcbiAgICBuYW1lID0gYCR7bmFtZX0vJHtjaGlsZC5uYW1lfWA7XG4gICAgY3VyID0gY2hpbGQ7XG4gIH1cbiAgcmV0dXJuIHsgbmFtZSwgbm9kZTogY3VyIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVuZGVyaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSYW5rIG9mIGEgc3RhY2tlZCBlbnRyeSdzIHJhbmdlIGtpbmQ6IGB3aG9sZS1maWxlYCBmaXJzdCwgdGhlbiBudW1lcmljXG4gKiBgcmFuZ2VgcywgdGhlbiBgdHJ1bmNhdGVkYC4gQSB3aG9sZS1maWxlIGFuY2hvciBpcyB0aGUgQ0xJJ3MgYDAtMGAgcm93IFx1MjAxNCBpdFxuICogY292ZXJzIHRoZSBlbnRpcmUgZmlsZSwgc28gaXQgc29ydHMgYWhlYWQgb2YgZXZlcnkgbGluZSByYW5nZSBvbiB0aGF0IGZpbGVcbiAqIHRoZSBzYW1lIHdheSBsaW5lIDAgd291bGQuIGB0cnVuY2F0ZWRgIGNhcnJpZXMgbm8gcG9zaXRpb24gYXQgYWxsIGFuZCBzb3J0c1xuICogbGFzdC5cbiAqL1xuZnVuY3Rpb24gcmFuZ2VSYW5rKHJhbmdlOiBSYW5nZUxhYmVsKTogbnVtYmVyIHtcbiAgc3dpdGNoIChyYW5nZS5raW5kKSB7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gMDtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gMTtcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuIDI7XG4gIH1cbn1cblxuLyoqXG4gKiBTdGFja2VkLXJhbmdlIG9yZGVyIGlzIGJ5IGtpbmQgcmFuayB0aGVuIG51bWVyaWMgKGBzdGFydGAgdGhlbiBgZW5kYCksXG4gKiBvdmVycmlkaW5nIGFycml2YWwgb3IgY29kZXBvaW50IG9yZGVyIFx1MjAxNCB0aGUgb25seSBzb3J0aW5nIHRoaXMgbW9kdWxlIGRvZXMsXG4gKiBhbmQgc2NvcGVkIHN0cmljdGx5IHRvIHJhbmdlcyBzdGFja2VkIG9uIG9uZSBwYXRoIChuZXZlciB0byBzaWJsaW5nIHBhdGhzXG4gKiBvciBkaXJlY3Rvcnkgb3JkZXIpLiBFcXVhbC1yYW5rZWQgZW50cmllcyAodHdvIGB0cnVuY2F0ZWRgcywgb3IgdHdvXG4gKiBpZGVudGljYWwgcmFuZ2VzKSBrZWVwIHRoZWlyIG93biByZWxhdGl2ZSBhcnJpdmFsIG9yZGVyLCBzaW5jZSB0aGUgc29ydCBpc1xuICogc3RhYmxlLlxuICovXG5mdW5jdGlvbiBjb21wYXJlUmFuZ2VFbnRyaWVzKGE6IFJhbmdlRW50cnksIGI6IFJhbmdlRW50cnkpOiBudW1iZXIge1xuICBjb25zdCByYW5rID0gcmFuZ2VSYW5rKGEucmFuZ2UpIC0gcmFuZ2VSYW5rKGIucmFuZ2UpO1xuICBpZiAocmFuayAhPT0gMCkgcmV0dXJuIHJhbms7XG4gIGlmIChhLnJhbmdlLmtpbmQgPT09ICdyYW5nZScgJiYgYi5yYW5nZS5raW5kID09PSAncmFuZ2UnKSB7XG4gICAgcmV0dXJuIGEucmFuZ2Uuc3RhcnQgLSBiLnJhbmdlLnN0YXJ0IHx8IGEucmFuZ2UuZW5kIC0gYi5yYW5nZS5lbmQ7XG4gIH1cbiAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogVGhlIHJhbmdlIGNvbHVtbidzIHRleHQsIG9yIGBudWxsYCB3aGVuIHRoZSBlbnRyeSBwcmludHMgYXMgYSBiYXJlIHBhdGhcbiAqIHdpdGggbm8gcmFuZ2UgY29sdW1uIGF0IGFsbC5cbiAqXG4gKiBBIGB3aG9sZS1maWxlYCBlbnRyeSBpcyB0aGUgb25lIGtpbmQgd2hvc2UgcmVuZGVyaW5nIGRlcGVuZHMgb24gY29udGV4dC5cbiAqIEFsb25lIG9uIGl0cyBwYXRoIGl0IHN0YXlzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIgXHUyMDE0IHRoYXQgaXMgd2hhdCB0aGVcbiAqIENMSSdzIG93biBmbGF0IGxpc3QgcHJpbnRzIGZvciBhIHdob2xlLWZpbGUgYW5jaG9yLCBhbmQgYWRkaW5nIGEgbWFya2VyXG4gKiB0aGVyZSB3b3VsZCBhbm5vdGF0ZSB0aGUgb3ZlcndoZWxtaW5nbHkgY29tbW9uIGNhc2UgZm9yIHRoZSBiZW5lZml0IG9mIHRoZVxuICogcmFyZSBvbmUuICpTdGFja2VkKiBiZWhpbmQgb3RoZXIgcmFuZ2VzIG9uIHRoZSBzYW1lIHBhdGggaXQgbXVzdCBjYXJyeSBhblxuICogZXhwbGljaXQgbWFya2VyOiB3aXRob3V0IG9uZSBpdCByZW5kZXJzIGFzIGEgY29udGludWF0aW9uIGxpbmUgaG9sZGluZ1xuICogbm90aGluZyBidXQgaW5kZW50YXRpb24gYW5kIGl0cyBkcmlmdCBzdWZmaXgsIHdoaWNoIGVyYXNlcyB0aGUgYW5jaG9yXG4gKiBvdXRyaWdodCB3aGVuIHRoZSBzdWZmaXggaXMgZW1wdHkgYW5kIFx1MjAxNCB3b3JzZSBcdTIwMTQgaGFuZ3MgaXRzIGAgXHUyMDE0IGNoYW5nZWRgXG4gKiB1bmRlciBhIG5laWdoYm91cmluZyByYW5nZSwgZXhhY3RseSB0aGUgdmlzdWFsIGdyYW1tYXIgdGhhdCBtZWFucyBcImFub3RoZXJcbiAqIHJhbmdlIG9uIHRoaXMgc2FtZSBmaWxlXCIuIFRoZSByZWFkZXIgd291bGQgdGhlbiByZWNvbmNpbGUgdGhlIHJhbmdlIHRoYXRcbiAqIGRpZCBub3QgZHJpZnQuIE9mIHRoZSB0aHJlZSBmaXhlcyBhdmFpbGFibGUgKHByaW50IHRoZSBwYXRoIG9uXG4gKiBjb250aW51YXRpb24gbGluZXMsIHNvcnQgd2hvbGUtZmlsZSB0byBwb3NpdGlvbiAwLCBvciBzcGxpdCBpdCBpbnRvIGl0cyBvd25cbiAqIGxlYWYpLCBhbiBleHBsaWNpdCBtYXJrZXIgaXMgdGhlIG9ubHkgb25lIHRoYXQgbWFrZXMgdGhlIGVudHJ5IGlkZW50aWZpYWJsZVxuICogaW4gKmV2ZXJ5KiBwb3NpdGlvbiByYXRoZXIgdGhhbiBvbmx5IGluIHRoZSBwb3NpdGlvbiB0aGUgc29ydCBoYXBwZW5zIHRvXG4gKiBwdXQgaXQgaW47IHNvcnRpbmcgaXQgZmlyc3QgKHNlZSB7QGxpbmsgcmFuZ2VSYW5rfSkgaXMga2VwdCBhcyB3ZWxsIGJlY2F1c2VcbiAqIFwid2hvbGUgZmlsZSwgdGhlbiBpdHMgcmFuZ2VzIGluIGxpbmUgb3JkZXJcIiBpcyB0aGUgb3JkZXIgYSByZWFkZXIgZXhwZWN0cyxcbiAqIG5vdCBiZWNhdXNlIGlkZW50aWZpYWJpbGl0eSBkZXBlbmRzIG9uIGl0LlxuICovXG5mdW5jdGlvbiBsYWJlbEZvcihyYW5nZTogUmFuZ2VMYWJlbCwgc29sZTogYm9vbGVhbik6IHN0cmluZyB8IG51bGwge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gYCNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gc29sZSA/IG51bGwgOiAnKHdob2xlIGZpbGUpJztcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuICcodHJ1bmNhdGVkIGluIHNvdXJjZSBcdTIwMTQgYW5jaG9yIGluY29tcGxldGUpJztcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbHVtbiBtYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgZ3JhcGhlbWUgc2VnbWVudGVyLCBjb25zdHJ1Y3RlZCBvbiBmaXJzdCB1c2UgYW5kIHRoZW4gY2FjaGVkIFx1MjAxNCBpbmNsdWRpbmdcbiAqIGEgY2FjaGVkIGBudWxsYCB3aGVuIGl0IGNhbm5vdCBiZSBjb25zdHJ1Y3RlZCBhdCBhbGwuXG4gKlxuICogTGF6eSBvbiBwdXJwb3NlLiBgSW50bGAgaXMgbm90IHBhcnQgb2YgdGhlIEphdmFTY3JpcHQgbGFuZ3VhZ2UgY29yZTogYSBOb2RlXG4gKiBidWlsdCBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgd2hhdHNvZXZlciwgYW5kIGBob29rcy5qc29uYFxuICogaW52b2tlcyBhIGJhcmUgYG5vZGVgIG9mZiB0aGUgdXNlcidzIGBQQVRIYCwgc28gYGVuZ2luZXMubm9kZWAgY29uc3RyYWluc1xuICogbm90aGluZyBoZXJlLiBDb25zdHJ1Y3RpbmcgdGhpcyBhdCBtb2R1bGUgc2NvcGUgcHV0IGEgYFJlZmVyZW5jZUVycm9yYCBpblxuICogdGhlIGJ1bmRsZXMnIHRvcC1sZXZlbCBzdGF0ZW1lbnRzLCB3aGVyZSBpdCB0aHJvd3MgYXQgKmltcG9ydCogXHUyMDE0IGJlZm9yZSBhbnlcbiAqIG9mIHRoZSBmYWlsLWNsb3NlZCBgdHJ5L2NhdGNoYCBibG9ja3MgaW4gYHJlbmRlckFuY2hvclJ1bmAsIGByZW5kZXJQYXRoUnVuYFxuICogYW5kIGBhbmNob3JCdWxsZXRzYCBleGlzdCB0byBjYXRjaCBpdC4gVGhlIGhvb2sgcHJvY2VzcyB0aGVuIGRpZWQgd2l0aCBleGl0XG4gKiAxLCB3aGljaCBDbGF1ZGUgQ29kZSB0cmVhdHMgYXMgYSBub24tYmxvY2tpbmcgaG9vayBlcnJvcjogdGhlIGNvbW1pdCBnYXRlXG4gKiBzaWxlbnRseSBhbGxvd2VkIHRoZSBjb21taXQgYW5kIHRoZSBkcmlmdCByZW1pbmRlciBzaWxlbnRseSB2YW5pc2hlZC5cbiAqIEJ1aWxkaW5nIGl0IGluc2lkZSB0aGUgcmVuZGVyIHBhdGggcHV0cyBhbnkgZmFpbHVyZSBiYWNrIGluc2lkZSB0aG9zZVxuICogY2F0Y2hlcy5cbiAqXG4gKiBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCB0aGUgc2FtZSBjYXRlZ29yeSBhc1xuICogdGhlIGxvY2FsIGB0cnkvY2F0Y2hgIGJsb2NrcyBhdCB0aGlzIG1vZHVsZSdzIGNhbGwgc2l0ZXMsIGFuZCBsb2FkLWJlYXJpbmdcbiAqIGZvciB0aGUgc2FtZSByZWFzb24uIE5vdGhpbmcgaW4gdGhlIGNvbHVtbi1hbGlnbm1lbnQgcGF0aCBtYXkgYmUgYWJsZSB0b1xuICogY29zdCB0aGUgY29tbWl0IGdhdGUgb3IgdGhlIGRyaWZ0IHJlbWluZGVyOiBpZiBkaXNwbGF5IHdpZHRoIGNhbm5vdCBiZVxuICogbWVhc3VyZWQsIHRoZSBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGdhdGUgc3RpbGwgaG9sZHM7IG9ubHkgYWxpZ25tZW50IGlzXG4gKiBsb3N0LlxuICovXG5sZXQgY2FjaGVkU2VnbWVudGVyOiB7IHZhbHVlOiBJbnRsLlNlZ21lbnRlciB8IG51bGwgfSB8IHVuZGVmaW5lZDtcblxuZnVuY3Rpb24gZ3JhcGhlbWVTZWdtZW50ZXIoKTogSW50bC5TZWdtZW50ZXIgfCBudWxsIHtcbiAgaWYgKGNhY2hlZFNlZ21lbnRlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG5ldyBJbnRsLlNlZ21lbnRlcignZW4nLCB7IGdyYW51bGFyaXR5OiAnZ3JhcGhlbWUnIH0pIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICBjYWNoZWRTZWdtZW50ZXIgPSB7IHZhbHVlOiBudWxsIH07XG4gICAgfVxuICB9XG4gIHJldHVybiBjYWNoZWRTZWdtZW50ZXIudmFsdWU7XG59XG5cbi8qKlxuICogQ29kZSBwb2ludCByYW5nZXMgcmVuZGVyZWQgdHdvIGNvbHVtbnMgd2lkZTogdGhlIEVhc3QgQXNpYW4gV2lkZSAoVykgYW5kXG4gKiBGdWxsd2lkdGggKEYpIGJsb2NrcyBvZiBVQVggIzExLCBwbHVzIHRoZSBlbW9qaSBibG9ja3MgdGhhdCB0ZXJtaW5hbHMgYW5kXG4gKiBwcm9wb3J0aW9uYWwgYWdlbnQtZmFjaW5nIHJlbmRlcmVycyBib3RoIGdpdmUgZG91YmxlIHdpZHRoLiBFdmVyeXRoaW5nIGVsc2VcbiAqIGNvdW50cyBhcyBvbmUgY29sdW1uLlxuICpcbiAqIFNvcnRlZCBhc2NlbmRpbmcgYW5kIG5vbi1vdmVybGFwcGluZyBcdTIwMTQge0BsaW5rIGlzV2lkZUNvZGVQb2ludH0gc2hvcnQtY2lyY3VpdHNcbiAqIG9uIHRoZSBmaXJzdCByYW5nZSBzdGFydGluZyBwYXN0IHRoZSBjb2RlIHBvaW50LlxuICovXG5jb25zdCBXSURFX1JBTkdFUzogcmVhZG9ubHkgKHJlYWRvbmx5IFtudW1iZXIsIG51bWJlcl0pW10gPSBbXG4gIFsweDExMDAsIDB4MTE1Zl0sXG4gIFsweDIzMjksIDB4MjMyYV0sXG4gIFsweDI2MDAsIDB4MjdiZl0sXG4gIFsweDJlODAsIDB4MzAzZV0sXG4gIFsweDMwNDEsIDB4MzNmZl0sXG4gIFsweDM0MDAsIDB4NGRiZl0sXG4gIFsweDRlMDAsIDB4OWZmZl0sXG4gIFsweGEwMDAsIDB4YTRjZl0sXG4gIFsweGE5NjAsIDB4YTk3Zl0sXG4gIFsweGFjMDAsIDB4ZDdhM10sXG4gIFsweGY5MDAsIDB4ZmFmZl0sXG4gIFsweGZlMTAsIDB4ZmUxOV0sXG4gIFsweGZlMzAsIDB4ZmU2Zl0sXG4gIFsweGZmMDAsIDB4ZmY2MF0sXG4gIFsweGZmZTAsIDB4ZmZlNl0sXG4gIFsweDE3MDAwLCAweDE4YWZmXSxcbiAgWzB4MWYxZTYsIDB4MWYxZmZdLFxuICBbMHgxZjMwMCwgMHgxZjY0Zl0sXG4gIFsweDFmNjgwLCAweDFmNmZmXSxcbiAgWzB4MWY5MDAsIDB4MWY5ZmZdLFxuICBbMHgxZmE3MCwgMHgxZmFmZl0sXG4gIFsweDIwMDAwLCAweDJmZmZkXSxcbiAgWzB4MzAwMDAsIDB4M2ZmZmRdXG5dO1xuXG5mdW5jdGlvbiBpc1dpZGVDb2RlUG9pbnQoY3A6IG51bWJlcik6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IFtsbywgaGldIG9mIFdJREVfUkFOR0VTKSB7XG4gICAgaWYgKGNwIDwgbG8pIHJldHVybiBmYWxzZTtcbiAgICBpZiAoY3AgPD0gaGkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBEaXNwbGF5IHdpZHRoIG9mIGEgbmFtZSBpbiB0ZXJtaW5hbCBjb2x1bW5zIFx1MjAxNCB0aGUgdW5pdCB0aGUgcmFuZ2UgY29sdW1uIGlzXG4gKiBhY3R1YWxseSBhbGlnbmVkIGluLiBNZWFzdXJlZCBvdmVyIGdyYXBoZW1lIGNsdXN0ZXJzIChzbyBhIGRlY29tcG9zZWQgYFx1MDBFOWBcbiAqIG9yIGEgY29tYmluaW5nLW1hcmsgc2VxdWVuY2UgY291bnRzIG9uY2UsIG5vdCBvbmNlIHBlciBjb2RlIHBvaW50KSwgd2l0aFxuICogZWFjaCBjbHVzdGVyIGNvbnRyaWJ1dGluZyB0d28gY29sdW1ucyB3aGVuIGl0cyBiYXNlIGNvZGUgcG9pbnQgaXMgRWFzdFxuICogQXNpYW4gV2lkZS9GdWxsd2lkdGggb3IgZW1vamkgYW5kIG9uZSBvdGhlcndpc2UuXG4gKlxuICogTmVpdGhlciBVVEYtMTYgYC5sZW5ndGhgIG5vciBgQXJyYXkuZnJvbShuYW1lKS5sZW5ndGhgIGlzIHRoaXMgdW5pdDogdGhlXG4gKiBmaXJzdCBvdmVyLWNvdW50cyBhIHN1cnJvZ2F0ZSBwYWlyLCB0aGUgc2Vjb25kIHVuZGVyLWNvdW50cyBhIENKSyBpZGVvZ3JhcGhcbiAqIGFuZCBvdmVyLWNvdW50cyBhIGRlY29tcG9zZWQgYWNjZW50LlxuICpcbiAqIFdoZW4ge0BsaW5rIGdyYXBoZW1lU2VnbWVudGVyfSBpcyB1bmF2YWlsYWJsZSAoYSBOb2RlIGJ1aWx0XG4gKiBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgYXQgYWxsKSwgdGhpcyBkZWdyYWRlcyB0byB0aGUgY3J1ZGVyXG4gKiBwZXItY29kZS1wb2ludCBtZWFzdXJlIHJhdGhlciB0aGFuIHRocm93aW5nLiBUaGF0IG1lYXN1cmUgb3Zlci1jb3VudHMgYVxuICogZGVjb21wb3NlZCBhY2NlbnQgYW5kIGEgcmVnaW9uYWwtaW5kaWNhdG9yIGZsYWcgcGFpciwgc28gYWxpZ25tZW50IGNhbiBiZSBhXG4gKiBjb2x1bW4gb3IgdHdvIG9mZiBcdTIwMTQgd2hpY2ggaXMgdGhlIGVudGlyZSBjb3N0LCBhbmQgaXMgdGhlIGNvcnJlY3QgcHJpY2UgdG9cbiAqIHBheTogdGhlIGFuY2hvciBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGNvbW1pdCBnYXRlIHN0aWxsIGhvbGRzLlxuICovXG5mdW5jdGlvbiBkaXNwbGF5V2lkdGgobmFtZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3Qgc2VnbWVudGVyID0gZ3JhcGhlbWVTZWdtZW50ZXIoKTtcbiAgbGV0IHdpZHRoID0gMDtcbiAgaWYgKHNlZ21lbnRlciA9PT0gbnVsbCkge1xuICAgIGZvciAoY29uc3QgY29kZVBvaW50IG9mIG5hbWUpIHtcbiAgICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChjb2RlUG9pbnQuY29kZVBvaW50QXQoMCkgPz8gMCkgPyAyIDogMTtcbiAgICB9XG4gICAgcmV0dXJuIHdpZHRoO1xuICB9XG4gIGZvciAoY29uc3QgeyBzZWdtZW50IH0gb2Ygc2VnbWVudGVyLnNlZ21lbnQobmFtZSkpIHtcbiAgICB3aWR0aCArPSBpc1dpZGVDb2RlUG9pbnQoc2VnbWVudC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICB9XG4gIHJldHVybiB3aWR0aDtcbn1cblxuLyoqXG4gKiBBbGlnbm1lbnQgY2VpbGluZy4gQSBzaWJsaW5nIGdyb3VwIHdob3NlIHdpZGVzdCByYW5nZS1iZWFyaW5nIG5hbWUgZXhjZWVkc1xuICogdGhpcyB3aWR0aCBkb2VzIG5vdCBhbGlnbiBhdCBhbGwgXHUyMDE0IGV2ZXJ5IG5hbWUgaW4gaXQgdGFrZXMgYSBzaW5nbGUgc3BhY2VcbiAqIGJlZm9yZSBpdHMgcmFuZ2UuIFRoZSBhbHRlcm5hdGl2ZSAocGFkIHRoZSBzaG9ydCBuYW1lcyB0byB0aGUgY2VpbGluZyB3aGlsZVxuICogdGhlIGxvbmcgb25lIHNpdHMgYXQgaXRzIG93biBuYXR1cmFsIGNvbHVtbikgcGF5cyBtb3N0IG9mIHRoZSB3aWR0aCBmb3JcbiAqIGFsaWdubWVudCB0aGF0IGFsaWducyB3aXRoIG5vdGhpbmcsIHdoaWNoIGlzIHN0cmljdGx5IHdvcnNlIHRoYW4gbm90XG4gKiBhbGlnbmluZy4gTmFtZXMgdGhlbXNlbHZlcyBhcmUgbmV2ZXIgdHJ1bmNhdGVkIG9yIGVsaWRlZCBhdCBhbnkgd2lkdGguXG4gKi9cbmNvbnN0IE1BWF9BTElHTl9DT0xVTU4gPSA0ODtcblxuLyoqXG4gKiBUaGUgY29sdW1uIGV2ZXJ5IHJhbmdlLWJlYXJpbmcgbmFtZSBpbiB0aGlzIHNpYmxpbmcgZ3JvdXAgcGFkcyB0bywgb3IgYDBgXG4gKiB3aGVuIHRoZSBncm91cCBmb3Jnb2VzIGFsaWdubWVudCAobm8gcmFuZ2UtYmVhcmluZyBuYW1lcywgb3IgYSBuYW1lIHBhc3RcbiAqIHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSkuIEFsaWdubWVudCBzY29wZSBpcyB0aGUgZ3JvdXAncyBkaXJlY3QgY2hpbGRyZW5cbiAqIG9ubHksIG5ldmVyIHRoZSB3aG9sZSB0cmVlIFx1MjAxNCB3aG9sZS10cmVlIGFsaWdubWVudCB3b3VsZCBsZXQgb25lIGRlZXBseVxuICogbmVzdGVkIGxvbmcgbmFtZSBwYWQgZXZlcnkgdW5yZWxhdGVkIGJyYW5jaC5cbiAqL1xuZnVuY3Rpb24gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zOiBEaXNwbGF5SXRlbVtdKTogbnVtYmVyIHtcbiAgbGV0IG1heCA9IDA7XG4gIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnICYmIHByaW50c1JhbmdlQ29sdW1uKGl0ZW0ubm9kZS5hbmNob3IpKSB7XG4gICAgICBtYXggPSBNYXRoLm1heChtYXgsIGRpc3BsYXlXaWR0aChpdGVtLm5hbWUpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1heCA+IE1BWF9BTElHTl9DT0xVTU4gPyAwIDogbWF4O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhpcyBhbmNob3IgcHJpbnRzIGEgcmFuZ2UgY29sdW1uIGF0IGFsbCBcdTIwMTQgdGhlIGV4YWN0IGNvbmRpdGlvblxuICoge0BsaW5rIGxhYmVsRm9yfSBlbmNvZGVzLCBob2lzdGVkIHNvIHtAbGluayBjb21wdXRlR3JvdXBUYXJnZXR9IG1lYXN1cmVzIHRoZVxuICogc2FtZSBzZXQgb2YgbmFtZXMgaXQgcGFkcy4gQW4gYW5jaG9yIHdpdGggbm8gcmFuZ2VzLCBvciBhICpzb2xlKiB3aG9sZS1maWxlXG4gKiBlbnRyeSAod2hpY2ggcmVuZGVycyBhcyBhIGJhcmUgcGF0aCB3aXRoIHplcm8gbWFya2VyKSwgY29udHJpYnV0ZXMgbm8gcmFuZ2VcbiAqIGNvbHVtbiBhbmQgc28gbXVzdCBub3QgY29udHJpYnV0ZSB0byB0aGUgZ3JvdXAgbWF4IGVpdGhlcjogb3RoZXJ3aXNlIGFcbiAqIHdob2xlLWZpbGUgYW5jaG9yIG9uIGEgcGF0aCBwYXN0IHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSBzaWxlbnRseSBzdXBwcmVzc2VzXG4gKiBhbGlnbm1lbnQgZm9yIGl0cyByYW5nZS1iZWFyaW5nIHNpYmxpbmdzIHdoaWxlIGl0c2VsZiBwcmludGluZyBub3RoaW5nIHRvXG4gKiBhbGlnbi5cbiAqL1xuZnVuY3Rpb24gcHJpbnRzUmFuZ2VDb2x1bW4oYW5jaG9yOiBUcmVlQW5jaG9yKTogYm9vbGVhbiB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiByYW5nZXMuc29tZSgoZW50cnkpID0+IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCByYW5nZXMubGVuZ3RoID09PSAxKSAhPT0gbnVsbCk7XG59XG5cbi8qKiBUaGUgc3BhY2luZyBiZXR3ZWVuIGEgbmFtZSBvZiBgbmFtZVdpZHRoYCBjb2x1bW5zIGFuZCBpdHMgcmFuZ2UgY29sdW1uLiAqL1xuZnVuY3Rpb24gY29tcHV0ZVBhZChuYW1lV2lkdGg6IG51bWJlciwgdGFyZ2V0OiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAobmFtZVdpZHRoID49IHRhcmdldCkgcmV0dXJuICcgJztcbiAgcmV0dXJuICcgJy5yZXBlYXQodGFyZ2V0IC0gbmFtZVdpZHRoICsgMSk7XG59XG5cbi8qKlxuICogUmVuZGVyIG9uZSBsZWFmJ3MgbGluZShzKS4gQW4gZW1wdHkgYHJhbmdlc2AgYXJyYXkgaXMgYSBiYXJlLXBhdGggbGVhZiB3aXRoXG4gKiBubyByYW5nZSBjb2x1bW4gYXQgYWxsIChkaXN0aW5jdCBmcm9tIGEgYHdob2xlLWZpbGVgIGVudHJ5LCB3aGljaCBpcyBhblxuICogZXhwbGljaXQgY2xhc3NpZmljYXRpb24gdGhhdCBhbHNvIHByaW50cyB3aXRoIHplcm8gbWFya2VyIHdoZW4gaXQgc3RhbmRzXG4gKiBhbG9uZSwgYnV0IHRocm91Z2ggdGhlIHJhbmdlcyBwaXBlbGluZSkuIE11bHRpcGxlIHN0YWNrZWQgcmFuZ2VzIHByaW50XG4gKiB1bmRlciBhIGNvbnRpbnVhdGlvbiBwcmVmaXggaW5zdGVhZCBvZiByZXBlYXRpbmcgdGhlIG5hbWU7IGVhY2ggY2FycmllcyBpdHNcbiAqIG93biBzdWZmaXggaW5kZXBlbmRlbnRseSwgYW5kIGVhY2ggY2FycmllcyBhIGxhYmVsIGlkZW50aWZ5aW5nIHdoaWNoIGFuY2hvclxuICogdGhlIHN1ZmZpeCBiZWxvbmdzIHRvLlxuICovXG5mdW5jdGlvbiByZW5kZXJMZWFmTGluZXMoXG4gIG5hbWU6IHN0cmluZyxcbiAgYW5jaG9yOiBUcmVlQW5jaG9yLFxuICBvd25QcmVmaXg6IHN0cmluZyxcbiAgY2hpbGRQcmVmaXg6IHN0cmluZyxcbiAgZ3JvdXBUYXJnZXQ6IG51bWJlclxuKTogc3RyaW5nW10ge1xuICBjb25zdCB7IHJhbmdlcyB9ID0gYW5jaG9yO1xuICBpZiAocmFuZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtgJHtvd25QcmVmaXh9JHtuYW1lfWBdO1xuXG4gIGNvbnN0IHNvcnRlZCA9IFsuLi5yYW5nZXNdLnNvcnQoY29tcGFyZVJhbmdlRW50cmllcyk7XG4gIGNvbnN0IHNvbGUgPSBzb3J0ZWQubGVuZ3RoID09PSAxO1xuICBjb25zdCBuYW1lV2lkdGggPSBkaXNwbGF5V2lkdGgobmFtZSk7XG4gIGNvbnN0IHBhZCA9IGNvbXB1dGVQYWQobmFtZVdpZHRoLCBncm91cFRhcmdldCk7XG4gIGNvbnN0IGJsYW5rID0gJyAnLnJlcGVhdChuYW1lV2lkdGggKyBwYWQubGVuZ3RoKTtcblxuICByZXR1cm4gc29ydGVkLm1hcCgoZW50cnksIGkpID0+IHtcbiAgICBjb25zdCBsYWJlbCA9IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCBzb2xlKTtcbiAgICBpZiAobGFiZWwgPT09IG51bGwpIHJldHVybiBgJHtvd25QcmVmaXh9JHtuYW1lfSR7ZW50cnkuc3VmZml4fWA7XG4gICAgY29uc3QgYmFzZSA9IGkgPT09IDAgPyBgJHtvd25QcmVmaXh9JHtuYW1lfSR7cGFkfWAgOiBgJHtjaGlsZFByZWZpeH0ke2JsYW5rfWA7XG4gICAgcmV0dXJuIGAke2Jhc2V9JHtsYWJlbH0ke2VudHJ5LnN1ZmZpeH1gO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTm9kZXMobm9kZXM6IFBhdGhUcmVlTm9kZVtdLCBwcmVmaXg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGl0ZW1zID0gbm9kZXMubWFwKGZvbGRDaGFpbik7XG4gIGNvbnN0IGdyb3VwVGFyZ2V0ID0gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zKTtcbiAgaXRlbXMuZm9yRWFjaCgoaXRlbSwgaSkgPT4ge1xuICAgIGNvbnN0IGlzTGFzdCA9IGkgPT09IGl0ZW1zLmxlbmd0aCAtIDE7XG4gICAgY29uc3Qgb3duUHJlZml4ID0gYCR7cHJlZml4fSR7aXNMYXN0ID8gJ1x1MjUxNFx1MjUwMCAnIDogJ1x1MjUxQ1x1MjUwMCAnfWA7XG4gICAgY29uc3QgY2hpbGRQcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnICAgJyA6ICdcdTI1MDIgICd9YDtcbiAgICBpZiAoaXRlbS5ub2RlLmtpbmQgPT09ICdsZWFmJykge1xuICAgICAgbGluZXMucHVzaCguLi5yZW5kZXJMZWFmTGluZXMoaXRlbS5uYW1lLCBpdGVtLm5vZGUuYW5jaG9yLCBvd25QcmVmaXgsIGNoaWxkUHJlZml4LCBncm91cFRhcmdldCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaW5lcy5wdXNoKGAke293blByZWZpeH0ke2l0ZW0ubmFtZX0vYCk7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlck5vZGVzKGl0ZW0ubm9kZS5jaGlsZHJlbiwgY2hpbGRQcmVmaXgpKTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gbGluZXM7XG59XG5cbi8qKlxuICogUmVuZGVyIGEgY29sbGFwc2VkIGFuY2hvciBsaXN0IGFzIGEgYm94LWRyYXdpbmcgdHJlZSwgZ3JvdXBlZCBieSBzaGFyZWRcbiAqIHBhdGggcHJlZml4LiBFdmVyeSBhbmNob3IgbGlzdCByZW5kZXJzIGFzIGEgdHJlZSB1bmNvbmRpdGlvbmFsbHkgXHUyMDE0IGEgc2luZ2xlXG4gKiBhbmNob3IgYmVjb21lcyBhIG9uZS1saW5lIHRyZWUgd2hhdGV2ZXIgaXRzIGRlcHRoIChzZWUge0BsaW5rIGZvbGRDaGFpbn0pO1xuICogdGhlcmUgaXMgbm8gZmxhdC1idWxsZXQgcGF0aCBvciBzaXplIGZsb29yIGluIHRoaXMgbW9kdWxlLlxuICpcbiAqIEhlaWdodCBpcyBib3VuZGVkIGJ5IHtAbGluayBmb2xkQ2hhaW59OiBhIGRpcmVjdG9yeSBsaW5lIG9ubHkgZXZlciBhcHBlYXJzXG4gKiB3aGVyZSBpdCBnZW51aW5lbHkgZ3JvdXBzIHR3byBvciBtb3JlIHNpYmxpbmdzLCBzbyB0aGUgdHJlZSBhZGRzIGF0IG1vc3RcbiAqIG9uZSBsaW5lIHBlciByZWFsIGdyb3VwaW5nIGFuZCBuZXZlciBvbmUgcGVyIHBhdGggc2VnbWVudC5cbiAqXG4gKiBUb3RhbCBmb3IgYW55IHdlbGwtZm9ybWVkIGBUcmVlQW5jaG9yW11gOiBkZWdlbmVyYXRlIHBhdGhzIChydWxlIGVuZm9yY2VkXG4gKiBpbiB7QGxpbmsgc3BsaXRTZWdtZW50c30pIGFyZSBub3JtYWxpemVkIHRvIGF0b21pYyBsZWF2ZXMgcmF0aGVyIHRoYW5cbiAqIHRocm93biBvbiwgc28gdGhpcyBmdW5jdGlvbiBuZXZlciBuZWVkcyBhbiBpbnRlcm5hbCB0cnkvY2F0Y2guIENhbGxlcnMgYWRkXG4gKiB0aGVpciBvd24gY2F0Y2ggYXJvdW5kIHRoaXMgY2FsbCBpbiBhIGxhdGVyIHBoYXNlIChmYWlsLW9wZW4gZGlzY2lwbGluZVxuICogbGl2ZXMgYXQgdGhlIGNhbGwgc2l0ZSwgbm90IGhlcmUpLlxuICpcbiAqIGByZW5kZXJBbmNob3JUcmVlYCdzIGNvbnRyYWN0IHJlcXVpcmVzIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXJcbiAqIGRpc3RpbmN0IGBwYXRoYCBcdTIwMTQgcGFzcyBhbmNob3JzIHRocm91Z2gge0BsaW5rIGNvbGxhcHNlQnlQYXRofSBmaXJzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckFuY2hvclRyZWUoYW5jaG9yczogVHJlZUFuY2hvcltdKTogc3RyaW5nW10ge1xuICBjb25zdCBmb3Jlc3QgPSBidWlsZEZvcmVzdChhbmNob3JzKTtcbiAgcmV0dXJuIHJlbmRlck5vZGVzKGZvcmVzdCwgJycpO1xufVxuIiwgIi8qKlxuICogQ29kZXggYGFwcGx5X3BhdGNoYCBlbnZlbG9wZSBwYXJzZXIuXG4gKlxuICogVHVybnMgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGB0b29sX2lucHV0LmNvbW1hbmRgIHBhdGNoIHN0cmluZyBpbnRvIHRoZVxuICogYEFuY2hvclNwZWNbXWAgc2hhcGUgdGhlIHNoYXJlZCB0b3VjaCBjb3JlIGFscmVhZHkgY29uc3VtZXMgXHUyMDE0IHRoZSBvbmVcbiAqIGdlbnVpbmVseSBuZXcgYWxnb3JpdGhtIHRoZSBDb2RleCBhZGFwdGVyIG5lZWRzLiBJdCByZXBsYWNlcyB0aGUgc3RydWN0dXJlZFxuICogYGZpbGVfcGF0aGAvYG9sZF9zdHJpbmdgL2BvZmZzZXRgIHJlYWRpbmcgdGhlIENsYXVkZSBQb3N0VG9vbFVzZSB0b3VjaCBob29rXG4gKiBkb2VzLCBiZWNhdXNlIENvZGV4IGRlbGl2ZXJzIGV2ZXJ5IGVkaXQgYXMgYSBzaW5nbGUgYXBwbHlfcGF0Y2ggZW52ZWxvcGVcbiAqIHJhdGhlciB0aGFuIGEgdHlwZWQgdG9vbCBpbnB1dC5cbiAqXG4gKiBUaGUgbW9kdWxlIGlzIHB1cmU6IGl0IGltcG9ydHMgb25seSB0aGUga2VybmVsIGFuY2hvciB0eXBlcyBhbmQgbmV2ZXIgdG91Y2hlc1xuICogdGhlIENvZGV4IFNESywgc28gaXQgaXMgREktdGVzdGFibGUgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGVcbiAqIHNoYXJlZCBrZXJuZWwuIFJhbmdlIHJlY292ZXJ5IGlzIGJlc3QtZWZmb3J0IFx1MjAxNCB0aGUgYXBwbHlfcGF0Y2ggZm9ybWF0IGNhcnJpZXNcbiAqIGBAQGAgY29udGV4dCBhbmQgYCtgL2AtYC9zcGFjZSBjaGFuZ2UgbGluZXMgYnV0IG5vIGV4cGxpY2l0IGxpbmUgbnVtYmVycywgc28gYVxuICogcmFuZ2UgY2FuIG9ubHkgYmUgcmVjb3ZlcmVkIGJ5IGxvY2F0aW5nIGEgaHVuaydzIHByZS1lZGl0IGJsb2NrIGluIHRoZVxuICogb24tZGlzayBmaWxlLiBUaGF0IGZpbGUgcmVhZCBpcyBpbmplY3RlZCAoYHJlYWRQcmVFZGl0RmlsZWApIHNvIHRoZSBmdW5jdGlvblxuICogc3RheXMgcHVyZSBhbmQgdGVzdGFibGUuIE9uIEFOWSBhbWJpZ3VpdHkgKG5vIHJlYWRlciwgZmlsZSBtaXNzaW5nLCBjb250ZXh0XG4gKiBub3QgZm91bmQsIGZ1enp5L2R1cGxpY2F0ZSBtYXRjaCkgdGhlIHBhcnNlciBkZWdyYWRlcyB0byBhIHdob2xlLWZpbGUgYW5jaG9yXG4gKiByYXRoZXIgdGhhbiB0aHJvd2luZyBcdTIwMTQgd2hvbGUtZmlsZSBhbmNob3JzIGFyZSBmaXJzdC1jbGFzcyBhbmQgdG91Y2ggdHJhY2tpbmdcbiAqIG11c3QgbmV2ZXIgYmUgYmxvY2tlZC5cbiAqXG4gKiBUaGUgZ3JhbW1hciBpcyBjcm9zcy1jaGVja2VkIGFnYWluc3QgQ29kZXgncyBvd24gYXBwbHlfcGF0Y2ggY3JhdGVcbiAqIChjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMve3BhcnNlcixzdHJlYW1pbmdfcGFyc2VyfS5ycykuIFR3byBzdWJ0bGV0aWVzIGFyZVxuICogbWlycm9yZWQgZGVsaWJlcmF0ZWx5OiBodW5rLWhlYWRlciBtYXJrZXJzIGFyZSBvbmx5IHJlY29nbml6ZWQgYXQgdGhlIHN0YXJ0IG9mXG4gKiBhIGxpbmUgd2l0aCBubyBsZWFkaW5nIHdoaXRlc3BhY2Ugd2hpbGUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rIChhIGxlYWRpbmcgc3BhY2VcbiAqIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpLCBhbmQgYSBiYXJlIGVtcHR5IGxpbmUgaW5zaWRlIGFuIFVwZGF0ZVxuICogaHVuayBpcyB0cmVhdGVkIGFzIGFuIGVtcHR5IGNvbnRleHQgbGluZSBwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcgY29udGVudC5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCB0eXBlIHsgQW5jaG9yU3BlYywgTGluZVJhbmdlIH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5cbi8qKlxuICogUmVhZHMgdGhlIHByZS1lZGl0IChvbi1kaXNrLCBiZWZvcmUgdGhlIHBhdGNoIGFwcGxpZXMpIGNvbnRlbnQgb2YgdGhlIGZpbGUgYXRcbiAqIGBwYXRoYCwgb3IgcmV0dXJucyBgbnVsbGAgd2hlbiBpdCBjYW5ub3QgYmUgcmVhZC4gSW5qZWN0ZWQgc28gdGhlIHBhcnNlciBzdGF5c1xuICogcHVyZTsgY2FsbCBzaXRlcyBkZWZhdWx0IHRvIGEgcmVhbCBmaWxlc3lzdGVtIHJlYWQuXG4gKi9cbmV4cG9ydCB0eXBlIFJlYWRQcmVFZGl0RmlsZSA9IChwYXRoOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gR3JhbW1hciBtYXJrZXJzIChtaXJyb3JzIGNvZGV4LXJzL2FwcGx5LXBhdGNoL3NyYy9wYXJzZXIucnMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgRU5EX1BBVENIX01BUktFUiA9ICcqKiogRW5kIFBhdGNoJztcbmNvbnN0IEFERF9GSUxFX01BUktFUiA9ICcqKiogQWRkIEZpbGU6ICc7XG5jb25zdCBERUxFVEVfRklMRV9NQVJLRVIgPSAnKioqIERlbGV0ZSBGaWxlOiAnO1xuY29uc3QgVVBEQVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBVcGRhdGUgRmlsZTogJztcbmNvbnN0IE1PVkVfVE9fTUFSS0VSID0gJyoqKiBNb3ZlIHRvOiAnO1xuY29uc3QgRU9GX01BUktFUiA9ICcqKiogRW5kIG9mIEZpbGUnO1xuY29uc3QgQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAICc7XG5jb25zdCBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIgPSAnQEAnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEludGVybWVkaWF0ZSBodW5rIG1vZGVsXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFVwZGF0ZUNodW5rIHtcbiAgLyoqIE9wdGlvbmFsIGBAQCA8Y29udGV4dD5gIGxpbmUgdXNlZCB0byBkaXNhbWJpZ3VhdGUgdGhlIGJsb2NrJ3MgbG9jYXRpb24uICovXG4gIGNoYW5nZUNvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKiBQcmUtZWRpdCBsaW5lcyB0aGlzIGNodW5rIGNvdmVycyAoY29udGV4dCBgIGAgKyByZW1vdmVkIGAtYCksIGluIG9yZGVyLiAqL1xuICBvbGRMaW5lczogc3RyaW5nW107XG4gIC8qKiBQb3N0LWVkaXQgbGluZXMgKGNvbnRleHQgYCBgICsgYWRkZWQgYCtgKTsgcmV0YWluZWQgZm9yIGNvbXBsZXRlbmVzcy4gKi9cbiAgbmV3TGluZXM6IHN0cmluZ1tdO1xufVxuXG50eXBlIEh1bmsgPVxuICB8IHsga2luZDogJ2FkZCc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAnZGVsZXRlJzsgcGF0aDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6ICd1cGRhdGUnOyBwYXRoOiBzdHJpbmc7IG1vdmVQYXRoOiBzdHJpbmcgfCBudWxsOyBjaHVua3M6IFVwZGF0ZUNodW5rW10gfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHJlYWRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVhbC1maWxlc3lzdGVtIHJlYWRlciB1c2VkIHdoZW4gbm8gcmVhZGVyIGlzIGluamVjdGVkLiBCZXN0LWVmZm9ydDogYW55XG4gKiBmYWlsdXJlIChtaXNzaW5nIGZpbGUsIHBlcm1pc3Npb24gZXJyb3IpIHlpZWxkcyBgbnVsbGAsIHdoaWNoIHRoZSBwYXJzZXJcbiAqIGRlZ3JhZGVzIHRvIGEgd2hvbGUtZmlsZSBhbmNob3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0UmVhZFByZUVkaXRGaWxlKHBhdGg6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICB0cnkge1xuICAgIHJldHVybiBmcy5yZWFkRmlsZVN5bmMocGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRW52ZWxvcGUgc2Nhbm5pbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNjYW4gdGhlIHBhdGNoIHRleHQgaW50byBodW5rcy4gTGVuaWVudCBieSBkZXNpZ246IHVucmVjb2duaXplZCBsaW5lcyBhcmVcbiAqIGlnbm9yZWQgcmF0aGVyIHRoYW4gcmVqZWN0ZWQsIGFuZCBCZWdpbi9FbmQvRW52aXJvbm1lbnQgbGluZXMgYXJlIHNraXBwZWQsIHNvXG4gKiBhIG1hbGZvcm1lZCBlbnZlbG9wZSBkZWdyYWRlcyB0byB3aGF0ZXZlciBodW5rcyBjb3VsZCBiZSByZWNvdmVyZWQgKG9mdGVuXG4gKiBub25lIFx1MjE5MiBgW11gKSBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICovXG5mdW5jdGlvbiBzY2FuSHVua3MoY29tbWFuZDogc3RyaW5nKTogSHVua1tdIHtcbiAgY29uc3QgaHVua3M6IEh1bmtbXSA9IFtdO1xuICAvLyBUaGUgY3VycmVudGx5LW9wZW4gVXBkYXRlIGh1bmssIG9yIG51bGwuIEFkZC9EZWxldGUgaHVua3MgaGF2ZSBubyBib2R5LCBzb1xuICAvLyB0aGV5IGNsb3NlIGltbWVkaWF0ZWx5IGFuZCByZXNldCB0aGlzIHRvIG51bGwuXG4gIGxldCBvcGVuVXBkYXRlOiAoSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSkgfCBudWxsID0gbnVsbDtcblxuICBmb3IgKGNvbnN0IHJhdyBvZiBjb21tYW5kLnNwbGl0KCdcXG4nKSkge1xuICAgIC8vIEhlYWRlciBkZXRlY3Rpb24gaXMgd2hpdGVzcGFjZS1zZW5zaXRpdmUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rOiBDb2RleCB1c2VzXG4gICAgLy8gdHJpbV9lbmQgdGhlcmUgKGxlYWRpbmcgc3BhY2UgZGVtb3RlcyBhIG1hcmtlciB0byBhIGNvbnRleHQgbGluZSkgYW5kIGZ1bGxcbiAgICAvLyB0cmltIGVsc2V3aGVyZS4gTWF0Y2ggdGhhdCBzbyBpbmRlbnRlZCBtYXJrZXJzIGluc2lkZSBhIGh1bmsgc3RheSBjb250ZW50LlxuICAgIGNvbnN0IGhlYWRlckxpbmU6IHN0cmluZyA9IG9wZW5VcGRhdGUgPyByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJykgOiByYXcudHJpbSgpO1xuXG4gICAgaWYgKGhlYWRlckxpbmUgPT09IEVORF9QQVRDSF9NQVJLRVIpIHtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoQUREX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdhZGQnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKEFERF9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChERUxFVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBodW5rcy5wdXNoKHsga2luZDogJ2RlbGV0ZScsIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoREVMRVRFX0ZJTEVfTUFSS0VSLmxlbmd0aCkgfSk7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKFVQREFURV9GSUxFX01BUktFUikpIHtcbiAgICAgIGNvbnN0IGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0gPSB7XG4gICAgICAgIGtpbmQ6ICd1cGRhdGUnLFxuICAgICAgICBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKFVQREFURV9GSUxFX01BUktFUi5sZW5ndGgpLFxuICAgICAgICBtb3ZlUGF0aDogbnVsbCxcbiAgICAgICAgY2h1bmtzOiBbXVxuICAgICAgfTtcbiAgICAgIGh1bmtzLnB1c2goaHVuayk7XG4gICAgICBvcGVuVXBkYXRlID0gaHVuaztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChvcGVuVXBkYXRlKSB7XG4gICAgICBwcm9jZXNzVXBkYXRlTGluZShvcGVuVXBkYXRlLCByYXcpO1xuICAgIH1cbiAgICAvLyBBbnkgb3RoZXIgbGluZSBvdXRzaWRlIGFuIFVwZGF0ZSBodW5rIChCZWdpbiBQYXRjaCwgRW52aXJvbm1lbnQgSUQsIEFkZFxuICAgIC8vIEZpbGUgYCtgIGNvbnRlbnQsIHN0cmF5IHRleHQpIGlzIGlnbm9yZWQuXG4gIH1cblxuICByZXR1cm4gaHVua3M7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZUNodW5rKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pOiBVcGRhdGVDaHVuayB7XG4gIGNvbnN0IGxhc3QgPSBodW5rLmNodW5rc1todW5rLmNodW5rcy5sZW5ndGggLSAxXTtcbiAgaWYgKGxhc3QpIHJldHVybiBsYXN0O1xuICBjb25zdCBjaHVuazogVXBkYXRlQ2h1bmsgPSB7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH07XG4gIGh1bmsuY2h1bmtzLnB1c2goY2h1bmspO1xuICByZXR1cm4gY2h1bms7XG59XG5cbi8qKiBBcHBseSBvbmUgYm9keSBsaW5lIG9mIGFuIFVwZGF0ZSBodW5rIHRvIGl0cyBjaHVuayBsaXN0LiAqL1xuZnVuY3Rpb24gcHJvY2Vzc1VwZGF0ZUxpbmUoaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSwgcmF3OiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgdHJpbW1lZEVuZCA9IHJhdy5yZXBsYWNlKC9bIFxcdFxccl0rJC8sICcnKTtcblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU9GX01BUktFUikgcmV0dXJuOyAvLyBlbmQtb2YtZmlsZSBoaW50OyBub3QgbmVlZGVkIGZvciByYW5nZXNcblxuICAvLyBgKioqIE1vdmUgdG86YCBpcyBvbmx5IG1lYW5pbmdmdWwgYmVmb3JlIGFueSBjaGFuZ2UgY29udGVudC5cbiAgaWYgKGh1bmsuY2h1bmtzLmxlbmd0aCA9PT0gMCAmJiBodW5rLm1vdmVQYXRoID09PSBudWxsICYmIHRyaW1tZWRFbmQuc3RhcnRzV2l0aChNT1ZFX1RPX01BUktFUikpIHtcbiAgICBodW5rLm1vdmVQYXRoID0gdHJpbW1lZEVuZC5zbGljZShNT1ZFX1RPX01BUktFUi5sZW5ndGgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICh0cmltbWVkRW5kID09PSBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogbnVsbCwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0cmltbWVkRW5kLnN0YXJ0c1dpdGgoQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSkge1xuICAgIGh1bmsuY2h1bmtzLnB1c2goeyBjaGFuZ2VDb250ZXh0OiB0cmltbWVkRW5kLnNsaWNlKENIQU5HRV9DT05URVhUX01BUktFUi5sZW5ndGgpLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBIGJhcmUgZW1wdHkgbGluZSBpcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgKHByZXNlbnQgaW4gYm90aCBvbGQgYW5kIG5ldykuXG4gIGlmIChyYXcgPT09ICcnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKCcnKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKCcnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZmlyc3QgPSByYXdbMF07XG4gIGlmIChmaXJzdCA9PT0gJyAnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjb25zdCBjb250ZW50ID0gcmF3LnNsaWNlKDEpO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2goY29udGVudCk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaChjb250ZW50KTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnKycpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnLScpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gVW5yZWNvZ25pemVkIGNvbnRlbnQgbGluZSBcdTIwMTQgaWdub3JlIGxlbmllbnRseSByYXRoZXIgdGhhbiB0aHJvdy5cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSYW5nZSByZWNvdmVyeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTcGxpdCBmaWxlIGNvbnRlbnQgaW50byBsaW5lcyBmb3IgbWF0Y2hpbmcuIEEgdHJhaWxpbmcgbmV3bGluZSB5aWVsZHMgYVxuICogdHJhaWxpbmcgZW1wdHkgZWxlbWVudCwgd2hpY2ggaXMgaGFybWxlc3MgZm9yIHN1Yi1zbGljZSBtYXRjaGluZy4gKi9cbmZ1bmN0aW9uIHNwbGl0TGluZXMoY29udGVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gY29udGVudC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKiBJbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgdmFsdWVgIGFwcGVhcnMgYXMgYSBmdWxsIGxpbmUgaW4gYGxpbmVzYC4gKi9cbmZ1bmN0aW9uIGxpbmVJbmRpY2VzKGxpbmVzOiBzdHJpbmdbXSwgdmFsdWU6IHN0cmluZyk6IG51bWJlcltdIHtcbiAgY29uc3Qgb3V0OiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGxpbmVzW2ldID09PSB2YWx1ZSkgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFN0YXJ0IGluZGljZXMgKDAtYmFzZWQpIGF0IHdoaWNoIGBuZWVkbGVgIG1hdGNoZXMgY29udGlndW91c2x5IGluIGBoYXlzdGFja2AuICovXG5mdW5jdGlvbiBjb250aWd1b3VzTWF0Y2hlcyhoYXlzdGFjazogc3RyaW5nW10sIG5lZWRsZTogc3RyaW5nW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDAgfHwgbmVlZGxlLmxlbmd0aCA+IGhheXN0YWNrLmxlbmd0aCkgcmV0dXJuIG91dDtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSBvdXQucHVzaChpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIExvY2F0ZSBhIHNpbmdsZSBjaHVuaydzIHByZS1lZGl0IGJsb2NrIGluIHRoZSBmaWxlLCByZXR1cm5pbmcgaXRzIDEtYmFzZWRcbiAqIGxpbmUgcmFuZ2Ugb3IgbnVsbCB3aGVuIGl0IGNhbm5vdCBiZSBsb2NhdGVkIHVuYW1iaWd1b3VzbHkuXG4gKlxuICogLSBOb24tZW1wdHkgYmxvY2s6IHJlcXVpcmUgYSB1bmlxdWUgY29udGlndW91cyBtYXRjaCwgb3IgXHUyMDE0IHdoZW4gZHVwbGljYXRlZCBcdTIwMTRcbiAqICAgYSBgQEBgIGNoYW5nZS1jb250ZXh0IGxpbmUgdGhhdCBzZWxlY3RzIHRoZSBvY2N1cnJlbmNlIGFmdGVyIGl0LlxuICogLSBFbXB0eSBibG9jayAocHVyZSBpbnNlcnRpb24pOiBhbmNob3Igb24gYSB1bmlxdWUgY2hhbmdlLWNvbnRleHQgbGluZSBpZiBvbmVcbiAqICAgaXMgZ2l2ZW47IG90aGVyd2lzZSBpdCBpcyB1bmxvY2F0YWJsZS5cbiAqL1xuZnVuY3Rpb24gbG9jYXRlQ2h1bmsocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVuazogVXBkYXRlQ2h1bmspOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgYmxvY2sgPSBjaHVuay5vbGRMaW5lcztcblxuICBpZiAoYmxvY2subGVuZ3RoID09PSAwKSB7XG4gICAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICAgIGNvbnN0IGN0eElkeHMgPSBsaW5lSW5kaWNlcyhwcmVMaW5lcywgY3R4KTtcbiAgICAgIGlmIChjdHhJZHhzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBjb25zdCBsaW5lID0gY3R4SWR4c1swXSArIDE7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiBsaW5lLCBlbmQ6IGxpbmUgfTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBzdGFydHMgPSBjb250aWd1b3VzTWF0Y2hlcyhwcmVMaW5lcywgYmxvY2spO1xuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IHMgPSBzdGFydHNbMF07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHMgKyAxLCBlbmQ6IHMgKyBibG9jay5sZW5ndGggfTtcbiAgfVxuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gRHVwbGljYXRlZCBibG9jazogdXNlIHRoZSBjaGFuZ2UgY29udGV4dCB0byBzZWxlY3QgdGhlIG1hdGNoIGFmdGVyIGl0LlxuICBjb25zdCBjdHggPSBjaHVuay5jaGFuZ2VDb250ZXh0O1xuICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICBmb3IgKGNvbnN0IGMgb2YgbGluZUluZGljZXMocHJlTGluZXMsIGN0eCkpIHtcbiAgICAgIGNvbnN0IGFmdGVyID0gc3RhcnRzLmZpbmQoKHMpID0+IHMgPj0gYyk7XG4gICAgICBpZiAoYWZ0ZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4geyBzdGFydDogYWZ0ZXIgKyAxLCBlbmQ6IGFmdGVyICsgYmxvY2subGVuZ3RoIH07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsOyAvLyBhbWJpZ3VvdXMgXHUyMTkyIGNhbGxlciBkZWdyYWRlcyB0byB3aG9sZS1maWxlXG59XG5cbi8qKlxuICogUmVjb3ZlciBhIHNpbmdsZSBsaW5lIHJhbmdlIHNwYW5uaW5nIGFsbCBvZiBhbiB1cGRhdGUncyBjaHVua3MuIFJldHVybnMgbnVsbFxuICogKFx1MjE5MiB3aG9sZS1maWxlIGZhbGxiYWNrKSBpZiBhbnkgY2h1bmsgY2Fubm90IGJlIGxvY2F0ZWQuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSYW5nZShwcmVMaW5lczogc3RyaW5nW10sIGNodW5rczogVXBkYXRlQ2h1bmtbXSk6IExpbmVSYW5nZSB8IG51bGwge1xuICBsZXQgdW5pb246IExpbmVSYW5nZSB8IG51bGwgPSBudWxsO1xuICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgIGNvbnN0IHIgPSBsb2NhdGVDaHVuayhwcmVMaW5lcywgY2h1bmspO1xuICAgIGlmIChyID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICB1bmlvbiA9IHVuaW9uID09PSBudWxsID8gciA6IHsgc3RhcnQ6IE1hdGgubWluKHVuaW9uLnN0YXJ0LCByLnN0YXJ0KSwgZW5kOiBNYXRoLm1heCh1bmlvbi5lbmQsIHIuZW5kKSB9O1xuICB9XG4gIHJldHVybiB1bmlvbjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgQVBJXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBQYXJzZSBhIENvZGV4IGBhcHBseV9wYXRjaGAgY29tbWFuZCBzdHJpbmcgaW50byBhbiBhbmNob3IgcGVyIHRvdWNoZWQgZmlsZS5cbiAqXG4gKiAtIGAqKiogQWRkIEZpbGU6YCBcdTIxOTIgYGNyZWF0ZWAgKHdob2xlLWZpbGUpXG4gKiAtIGAqKiogRGVsZXRlIEZpbGU6YCBcdTIxOTIgYHdob2xlLXdyaXRlYCAod2hvbGUtZmlsZTsgdGhlIGZpbGUgbm8gbG9uZ2VyIGV4aXN0cylcbiAqIC0gYCoqKiBVcGRhdGUgRmlsZTpgIFx1MjE5MiBgd3JpdGVgIHdpdGggYSByZWNvdmVyZWQgbGluZSByYW5nZSB3aGVuIHRoZSBodW5rJ3NcbiAqICAgcHJlLWVkaXQgYmxvY2sgY2FuIGJlIGxvY2F0ZWQgdmlhIGByZWFkUHJlRWRpdEZpbGVgLCBvdGhlcndpc2UgYHdob2xlLXdyaXRlYC5cbiAqICAgQSByZW5hbWVkIHVwZGF0ZSAoYCoqKiBNb3ZlIHRvOmApIGFuY2hvcnMgdGhlIGRlc3RpbmF0aW9uIHBhdGggYXNcbiAqICAgYHdob2xlLXdyaXRlYCBzaW5jZSBwcmUtZWRpdCBsaW5lIG51bWJlcnMgY2Fubm90IGJlIG1hcHBlZCBhY3Jvc3MgYSByZW5hbWUuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhIG1hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB5aWVsZHMgYFtdYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQXBwbHlQYXRjaChcbiAgY29tbWFuZDogc3RyaW5nLFxuICByZWFkUHJlRWRpdEZpbGU6IFJlYWRQcmVFZGl0RmlsZSA9IGRlZmF1bHRSZWFkUHJlRWRpdEZpbGVcbik6IEFuY2hvclNwZWNbXSB7XG4gIGNvbnN0IGFuY2hvcnM6IEFuY2hvclNwZWNbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgaHVuayBvZiBzY2FuSHVua3MoY29tbWFuZCkpIHtcbiAgICBpZiAoaHVuay5raW5kID09PSAnYWRkJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnY3JlYXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaHVuay5raW5kID09PSAnZGVsZXRlJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlOiBhbmNob3Igb24gdGhlIGRlc3RpbmF0aW9uIHBhdGggKHBvc3QtZWRpdCBsb2NhdGlvbikuXG4gICAgY29uc3QgdGFyZ2V0UGF0aCA9IHRvUG9zaXgoaHVuay5tb3ZlUGF0aCA/PyBodW5rLnBhdGgpO1xuXG4gICAgLy8gQSByZW5hbWUgZGVmZWF0cyBwcmUtZWRpdCBsaW5lIG1hcHBpbmcgXHUyMDE0IGFuY2hvciB3aG9sZS1maWxlIG9uIHRoZSB0YXJnZXQuXG4gICAgaWYgKGh1bmsubW92ZVBhdGggIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBSYW5nZSByZWNvdmVyeSByZWFkcyB0aGUgcHJlLWVkaXQgY29udGVudCBhdCB0aGUgb3JpZ2luYWwgKHByZS1tb3ZlKSBwYXRoLlxuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkUHJlRWRpdEZpbGUoaHVuay5wYXRoKTtcbiAgICBjb25zdCByYW5nZSA9IGNvbnRlbnQgPT09IG51bGwgPyBudWxsIDogcmVjb3ZlclJhbmdlKHNwbGl0TGluZXMoY29udGVudCksIGh1bmsuY2h1bmtzKTtcbiAgICBpZiAocmFuZ2UgIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3cml0ZScsIHJhbmdlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhbmNob3JzO1xufVxuIiwgImltcG9ydCBob29rIGZyb20gXCIuL3Bvc3QtdG9vbC11c2UudHNcIjtcbmltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tIFwiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L3J1bnRpbWUuanNcIjtcbmV4ZWN1dGUoaG9vayk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBb0NBLFNBQVMsV0FBV0Esb0JBQW1COzs7QUNSaEMsSUFBTSwwQkFBMEIsb0JBQUksSUFBSSxDQUFDLGdCQUFnQixvQkFBb0IsZUFBZSxDQUFDOzs7QUM1QnBHLFNBQVMsZUFBZSxlQUFlLFFBQVEsU0FBUztBQUNwRCxRQUFNLE9BQU87QUFDYixPQUFLLGdCQUFnQjtBQUNyQixPQUFLLFVBQVUsT0FBTztBQUN0QixPQUFLLGdCQUFnQixPQUFPO0FBQzVCLE1BQUksYUFBYSxVQUFVLE9BQU8sT0FBTyxZQUFZLFVBQVU7QUFDM0QsU0FBSyxVQUFVLE9BQU87QUFBQSxFQUMxQjtBQUNBLFNBQU87QUFDWDtBQUlPLFNBQVMsZ0JBQWdCLFFBQVEsU0FBUztBQUM3QyxTQUFPLGVBQWUsZUFBZSxRQUFRLE9BQU87QUFDeEQ7OztBQ2ZBLFNBQVMsV0FBVyxZQUFZLFdBQVcsVUFBVSxpQkFBaUI7QUFDdEUsU0FBUyxlQUFlO0FBQ3hCLElBQU0sc0JBQXNCO0FBQ3JCLElBQU0sU0FBTixNQUFhO0FBQUEsRUFDaEIsV0FBVyxvQkFBSSxJQUFJO0FBQUEsRUFDbkIsa0JBQWtCO0FBQUEs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LFlBQU0sU0FBUyxNQUFNO0FBQUEsUUFDbkIsRUFBRSxNQUFNLFNBQVMsV0FBVyxLQUFLLFVBQVUsU0FBUyxTQUFTLEdBQUc7QUFBQSxRQUNoRTtBQUFBLFFBQ0E7QUFBQSxNQUNGO0FBQ0EsVUFBSSxPQUFPLGtCQUFtQixRQUFPLEtBQUssT0FBTyxpQkFBaUI7QUFBQSxJQUNwRTtBQUVBLFFBQUksT0FBTyxXQUFXLEVBQUcsUUFBTztBQUNoQyxVQUFNLFdBQVcsT0FBTyxLQUFLLEVBQUU7QUFDL0IsV0FBTyxrQkFBa0IsRUFBRSxtQkFBbUIsVUFBVSxlQUFlLFNBQVMsQ0FBQztBQUFBLEVBQ25GO0FBQ0Y7QUFFQSxJQUFPLHdCQUFRLGdCQUFnQixFQUFFLFNBQVMsc0NBQXNDLFNBQVMsSUFBTyxHQUFHLGNBQWMsQ0FBQzs7O0FpQnpjbEgsUUFBUSxxQkFBSTsiLAogICJuYW1lcyI6IFsicmVzb2x2ZVBhdGgiLCAicmVzb2x2ZSIsICJpc0Fic29sdXRlIiwgImV4ZWNGaWxlU3luYyIsICJzdGF0U3luYyIsICJpIiwgInJlc29sdmUiLCAidmFsdWUiLCAiZXNjYXBlUmVnRXhwIiwgImlzQWJzb2x1dGUiLCAiZXhpc3RzU3luYyIsICJzdGF0U3luYyIsICJkaXJuYW1lIiwgImpvaW4iLCAicmVzb2x2ZVBhdGgiLCAiaGFzU2hlbGxFeHBhbnNpb24iLCAiZmluZEdpdFN1YmNvbW1hbmQiLCAiZXhpc3RzU3luYyIsICJyZXNvbHZlUGF0aCIsICJzZXAiLCAic3RhdFN5bmMiLCAiam9pbiIsICJkaXJuYW1lIiwgImJhc2UiLCAicm9vdHMiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImxvZ2dlciIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAiYmFzZW5hbWUiLCAibGluZUNvdW50IiwgImJhc2VuYW1lIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJ0b1Bvc2l4IiwgImN0eCIsICJyZWNvdmVyUmFuZ2UiLCAiY29tbWFuZCIsICJyZXNvbHZlUGF0aCIsICJibG9ja3MiLCAiY29tYmluZWQiXQp9Cg==
