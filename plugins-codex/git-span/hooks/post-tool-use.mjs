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
import { randomUUID } from "node:crypto";
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
function parseStalePorcelain(stdout) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("	");
    if (parts.length < 6) continue;
    const [, , name, path, startCol, endCol] = parts;
    const start = startCol === "(whole)" ? 0 : parseInt(startCol, 10);
    const end = endCol === "-" ? 0 : parseInt(endCol, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    rows.push({ name, path, start, end });
  }
  return rows;
}
function sanitizeSessionId(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, (ch) => {
    return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  });
}
var SESSION_BASE_DIR = nodePath.join(os.homedir(), ".cache", "git-span", "session");

// src/common/span-surface.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import * as fs3 from "node:fs";
import * as os2 from "node:os";
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
function parseHookIgnore(content) {
  const rules = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(\S+)\s+(\S+)$/);
    if (!match) continue;
    const [, pattern, prefixesRaw] = match;
    const prefixes = prefixesRaw.split(",").map((p) => p.trim()).filter(Boolean);
    if (prefixes.length === 0) continue;
    rules.push({ pattern, prefixes, matches: compilePattern(pattern) });
  }
  return rules;
}
function loadHookIgnore(repoRoot) {
  try {
    const content = fs2.readFileSync(nodePath2.join(repoRoot, HOOK_IGNORE_REL), "utf8");
    return parseHookIgnore(content);
  } catch {
    return [];
  }
}
function slugHasPrefix(slug, prefix) {
  return slug === prefix || slug.startsWith(`${prefix}/`);
}
function isSpanSuppressed(rules, repoRelPath, slug) {
  for (const rule of rules) {
    if (!rule.matches(repoRelPath)) continue;
    if (rule.prefixes.some((p) => slugHasPrefix(slug, p))) return true;
  }
  return false;
}

// src/common/span-surface.ts
function createDefaultSpanExecutor(timeoutMs = 1e4) {
  return (args, cwd) => {
    return execFileSync2("git", ["span", "list", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs
    });
  };
}
function createDefaultStaleExecutor(timeoutMs = 1e4) {
  return (slugs, cwd) => {
    try {
      return execFileSync2("git", ["span", "stale", "--format", "porcelain", ...slugs], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs
      });
    } catch (err) {
      const out = err.stdout;
      if (typeof out === "string") return out;
      throw err;
    }
  };
}
var MEMO_DIR = nodePath3.join(os2.tmpdir(), "agent-hooks-git-span");
function memoFilePath(sessionId) {
  return nodePath3.join(MEMO_DIR, `${sanitizeSessionId(sessionId)}.json`);
}
function createDiskMemoStore(logger2) {
  return {
    getSurfaced(sessionId) {
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
      const existing = this.getSurfaced(sessionId);
      for (const n of names) existing.add(n);
      const memoPath = memoFilePath(sessionId);
      const tmpPath = `${memoPath}.tmp`;
      try {
        fs3.mkdirSync(MEMO_DIR, { recursive: true });
        fs3.writeFileSync(tmpPath, JSON.stringify({ surfaced: [...existing] }), "utf8");
        fs3.renameSync(tmpPath, memoPath);
      } catch (err) {
        logger2.warn("memo write failed", { err });
      }
    }
  };
}
function diskMemoFactory(logger2) {
  return createDiskMemoStore(logger2);
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
function surfaceOverlappingSpans(deps, repoRoot, repoRelPath, range, sessionId) {
  const { executor, staleExecutor, memo, loadRules, logger: logger2 } = deps;
  let porcelainStdout;
  try {
    porcelainStdout = executor(["--porcelain", repoRelPath], repoRoot);
  } catch (err) {
    logger2.warn("git span list --porcelain failed", { err });
    return null;
  }
  const ignoreRules = loadRules(repoRoot);
  const rows = parsePorcelain(porcelainStdout);
  const candidateNames = /* @__PURE__ */ new Set();
  for (const row of rows) {
    if (row.path !== repoRelPath) continue;
    if (row.start === 0 && row.end === 0) continue;
    if (!rangesIntersect(range, { start: row.start, end: row.end })) continue;
    if (isSpanSuppressed(ignoreRules, row.path, row.name)) continue;
    candidateNames.add(row.name);
  }
  if (candidateNames.size === 0) return null;
  const surfaced = memo.getSurfaced(sessionId);
  const toSurface = [...candidateNames].filter((n) => !surfaced.has(n)).sort();
  if (toSurface.length === 0) return null;
  let renderStdout;
  try {
    renderStdout = executor(toSurface, repoRoot);
  } catch (err) {
    logger2.warn("git span list (render) failed", { err });
    return null;
  }
  let staleHint = "";
  try {
    const staleNames = new Set(parseStalePorcelain(staleExecutor(toSurface, repoRoot)).map((r) => r.name));
    const staleSurfaced = toSurface.filter((n) => staleNames.has(n));
    if (staleSurfaced.length > 0) {
      const lines = staleSurfaced.map((n) => `  git span history ${n}`).join("\n");
      staleHint = `
Stale \u2014 the lines you're touching have drifted from these spans' anchored state. Review how each subsystem evolved before changing it:
${lines}`;
    }
  } catch (err) {
    logger2.warn("git span stale (history hint) failed", { err });
  }
  const wrapped = `
<git-span>
${renderStdout}${staleHint}
</git-span>
`;
  memo.addSurfaced(sessionId, toSurface);
  return wrapped;
}

// src/common/stop-core.ts
import * as fs4 from "node:fs";
import * as os3 from "node:os";
import * as nodePath4 from "node:path";
var JOURNAL_BASE_DIR = nodePath4.join(os3.homedir(), ".cache", "git-span", "session");
function journalDir(sessionId) {
  return nodePath4.join(JOURNAL_BASE_DIR, sanitizeSessionId(sessionId));
}
function journalPath(sessionId) {
  return nodePath4.join(journalDir(sessionId), "touches.jsonl");
}
function appendTouchJournal(sessionId, tool, anchors, logger2) {
  if (anchors.length === 0) return;
  try {
    fs4.mkdirSync(journalDir(sessionId), { recursive: true });
    const lines = anchors.map((a) => {
      const row = { tool, path: a.path, kind: a.kind, seen: false };
      if ((a.kind === "read" || a.kind === "write") && a.range) {
        row.start = a.range.start;
        row.end = a.range.end;
      }
      return JSON.stringify(row);
    });
    fs4.appendFileSync(journalPath(sessionId), `${lines.join("\n")}
`, "utf8");
  } catch (err) {
    logger2.warn("journal append failed", { err });
  }
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
function recoverRange(preLines, chunks) {
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
    const range = content === null ? null : recoverRange(splitLines(content), hunk.chunks);
    if (range !== null) {
      anchors.push({ path: targetPath, kind: "write", range });
    } else {
      anchors.push({ path: targetPath, kind: "whole-write" });
    }
  }
  return anchors;
}

// src/codex/pre-tool-use.ts
function narrowApplyPatchCommand(toolInput) {
  if (toolInput !== null && typeof toolInput === "object" && "command" in toolInput) {
    const command = toolInput.command;
    if (typeof command === "string") return command;
  }
  return null;
}
function createHandler(executor, memoFactory, loadRules = loadHookIgnore, staleExecutor = createDefaultStaleExecutor(), readPreEditFile = defaultReadPreEditFile) {
  return (input, ctx) => {
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return void 0;
    const sessionId = input.session_id;
    const cwd = input.cwd ?? "";
    const memo = memoFactory(ctx.logger);
    const deps = { executor, staleExecutor, memo, loadRules, logger: ctx.logger };
    const anchors = parseApplyPatch(command, readPreEditFile);
    const blocks = [];
    for (const anchor of anchors) {
      if (!anchor.range) continue;
      const absPath = abspathAgainst(cwd, anchor.path);
      const scope = resolveTouchScope(cwd, absPath);
      if (!scope) continue;
      const block = surfaceOverlappingSpans(deps, scope.repoRoot, scope.repoRelPath, anchor.range, sessionId);
      if (block) blocks.push(block);
    }
    if (blocks.length === 0) return void 0;
    const combined = blocks.join("");
    return preToolUseOutput({ additionalContext: combined, systemMessage: combined });
  };
}
var pre_tool_use_default = preToolUseHook(
  { matcher: "apply_patch", timeout: 1e4 },
  createHandler(createDefaultSpanExecutor(), diskMemoFactory)
);

// src/codex/post-tool-use.ts
function createHandler2(readPreEditFile = defaultReadPreEditFile) {
  return (input, ctx) => {
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return postToolUseOutput({});
    const cwd = input.cwd ?? "";
    const sessionId = input.session_id;
    const anchors = parseApplyPatch(command, readPreEditFile);
    const entries = [];
    for (const anchor of anchors) {
      const absPath = abspathAgainst(cwd, anchor.path);
      const scope = resolveTouchScope(cwd, absPath);
      if (!scope) continue;
      entries.push({ path: scope.repoRelPath, kind: anchor.kind, range: anchor.range });
    }
    appendTouchJournal(sessionId, "apply_patch", entries, ctx.logger);
    return postToolUseOutput({});
  };
}
var post_tool_use_default = postToolUseHook({ matcher: "apply_patch", timeout: 1e4 }, createHandler2());

// src/codex/post-tool-use-entry.ts
execute(post_tool_use_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vc3RvcC1jb3JlLnRzIiwgInNyYy9jb2RleC9hcHBseS1wYXRjaC50cyIsICJzcmMvY29kZXgvcHJlLXRvb2wtdXNlLnRzIiwgInNyYy9jb2RleC9wb3N0LXRvb2wtdXNlLnRzIiwgInNyYy9jb2RleC9wb3N0LXRvb2wtdXNlLWVudHJ5LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJleHBvcnQgY29uc3QgUEFDS0FHRV9OQU1FID0gXCJAZ29vZGZvb3QvY29kZXgtaG9va3NcIjtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSA2MDBfMDAwO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfU1RBVFVTX01FU1NBR0UgPSB1bmRlZmluZWQ7XG5leHBvcnQgY29uc3QgREVGQVVMVF9FU0JVSUxEX0xPQURFUlMgPSB7XG4gICAgXCIubWRcIjogXCJ0ZXh0XCIsXG59O1xuZXhwb3J0IGNvbnN0IEhPT0tfRkFDVE9SWV9UT19FVkVOVCA9IHtcbiAgICBwcmVUb29sVXNlSG9vazogXCJQcmVUb29sVXNlXCIsXG4gICAgcG9zdFRvb2xVc2VIb29rOiBcIlBvc3RUb29sVXNlXCIsXG4gICAgcGVybWlzc2lvblJlcXVlc3RIb29rOiBcIlBlcm1pc3Npb25SZXF1ZXN0XCIsXG4gICAgdXNlclByb21wdFN1Ym1pdEhvb2s6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgIHNlc3Npb25TdGFydEhvb2s6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgc3ViYWdlbnRTdGFydEhvb2s6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIHN0b3BIb29rOiBcIlN0b3BcIixcbiAgICBzdWJhZ2VudFN0b3BIb29rOiBcIlN1YmFnZW50U3RvcFwiLFxuICAgIHByZUNvbXBhY3RIb29rOiBcIlByZUNvbXBhY3RcIixcbiAgICBwb3N0Q29tcGFjdEhvb2s6IFwiUG9zdENvbXBhY3RcIixcbn07XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfTUFUQ0hFUiA9IG5ldyBTZXQoW1xuICAgIFwiUHJlVG9vbFVzZVwiLFxuICAgIFwiUG9zdFRvb2xVc2VcIixcbiAgICBcIlBlcm1pc3Npb25SZXF1ZXN0XCIsXG4gICAgXCJTZXNzaW9uU3RhcnRcIixcbiAgICBcIlN1YmFnZW50U3RhcnRcIixcbiAgICBcIlN1YmFnZW50U3RvcFwiLFxuICAgIFwiUHJlQ29tcGFjdFwiLFxuICAgIFwiUG9zdENvbXBhY3RcIixcbl0pO1xuZXhwb3J0IGNvbnN0IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUID0gbmV3IFNldChbXCJTZXNzaW9uU3RhcnRcIiwgXCJVc2VyUHJvbXB0U3VibWl0XCIsIFwiU3ViYWdlbnRTdGFydFwiXSk7XG4iLCAiZnVuY3Rpb24gYXR0YWNoTWV0YWRhdGEoaG9va0V2ZW50TmFtZSwgY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgY29uc3QgaG9vayA9IGhhbmRsZXI7XG4gICAgaG9vay5ob29rRXZlbnROYW1lID0gaG9va0V2ZW50TmFtZTtcbiAgICBob29rLnRpbWVvdXQgPSBjb25maWcudGltZW91dDtcbiAgICBob29rLnN0YXR1c01lc3NhZ2UgPSBjb25maWcuc3RhdHVzTWVzc2FnZTtcbiAgICBpZiAoXCJtYXRjaGVyXCIgaW4gY29uZmlnICYmIHR5cGVvZiBjb25maWcubWF0Y2hlciA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBob29rLm1hdGNoZXIgPSBjb25maWcubWF0Y2hlcjtcbiAgICB9XG4gICAgcmV0dXJuIGhvb2s7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUHJlVG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQb3N0VG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlVzZXJQcm9tcHRTdWJtaXRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlNlc3Npb25TdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RhcnRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdG9wXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdWJhZ2VudFN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4iLCAiaW1wb3J0IHsgY2xvc2VTeW5jLCBleGlzdHNTeW5jLCBta2RpclN5bmMsIG9wZW5TeW5jLCB3cml0ZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbmNvbnN0IERFRkFVTFRfTE9HX0VOVl9WQVIgPSBcIkNPREVYX0hPT0tTX0xPR19GSUxFXCI7XG5leHBvcnQgY2xhc3MgTG9nZ2VyIHtcbiAgICBoYW5kbGVycyA9IG5ldyBNYXAoKTtcbiAgICBmaWxlSW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgICBsb2dGaWxlRmQgPSBudWxsO1xuICAgIGxvZ0ZpbGVQYXRoID0gbnVsbDtcbiAgICBjdXJyZW50SG9va1R5cGU7XG4gICAgY3VycmVudElucHV0O1xuICAgIGNvbnN0cnVjdG9yKGNvbmZpZyA9IHt9KSB7XG4gICAgICAgIHRoaXMubG9nRmlsZVBhdGggPSBjb25maWcubG9nRmlsZVBhdGggPz8gcHJvY2Vzcy5lbnZbY29uZmlnLmxvZ0VudlZhciA/PyBERUZBVUxUX0xPR19FTlZfVkFSXSA/PyBudWxsO1xuICAgIH1cbiAgICBzZXRDb250ZXh0KGhvb2tUeXBlLCBpbnB1dCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IGhvb2tUeXBlO1xuICAgICAgICB0aGlzLmN1cnJlbnRJbnB1dCA9IGlucHV0O1xuICAgIH1cbiAgICBjbGVhckNvbnRleHQoKSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLmN1cnJlbnRJbnB1dCA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgb24obGV2ZWwsIGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCkgPz8gbmV3IFNldCgpO1xuICAgICAgICBleGlzdGluZy5hZGQoaGFuZGxlcik7XG4gICAgICAgIHRoaXMuaGFuZGxlcnMuc2V0KGxldmVsLCBleGlzdGluZyk7XG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBleGlzdGluZy5kZWxldGUoaGFuZGxlcik7XG4gICAgICAgICAgICBpZiAoZXhpc3Rpbmcuc2l6ZSA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHRoaXMuaGFuZGxlcnMuZGVsZXRlKGxldmVsKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICB9XG4gICAgZGVidWcobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJkZWJ1Z1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgaW5mbyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImluZm9cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIHdhcm4obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJ3YXJuXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBlcnJvcihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBsb2dFcnJvcihlcnJvciwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBgJHttZXNzYWdlfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCwgY29udGV4dCk7XG4gICAgfVxuICAgIGNsb3NlKCkge1xuICAgICAgICBpZiAodGhpcy5sb2dGaWxlRmQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGNsb3NlU3luYyh0aGlzLmxvZ0ZpbGVGZCk7XG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZW1pdChsZXZlbCwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbGV2ZWwsXG4gICAgICAgICAgICBob29rVHlwZTogdGhpcy5jdXJyZW50SG9va1R5cGUsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgLi4uKHRoaXMuY3VycmVudElucHV0ICE9PSB1bmRlZmluZWQgPyB7IGlucHV0OiB0aGlzLmN1cnJlbnRJbnB1dCB9IDoge30pLFxuICAgICAgICAgICAgLi4uKGNvbnRleHQgIT09IHVuZGVmaW5lZCA/IHsgY29udGV4dCB9IDoge30pLFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLndyaXRlVG9GaWxlKGV2ZW50KTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5nZXQobGV2ZWwpPy5mb3JFYWNoKChoYW5kbGVyKSA9PiB7XG4gICAgICAgICAgICBoYW5kbGVyKGV2ZW50KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHdyaXRlVG9GaWxlKGV2ZW50KSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVQYXRoID09PSBudWxsKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCF0aGlzLmZpbGVJbml0aWFsaXplZCkge1xuICAgICAgICAgICAgdGhpcy5maWxlSW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgICAgICAgY29uc3QgbG9nRGlyID0gZGlybmFtZSh0aGlzLmxvZ0ZpbGVQYXRoKTtcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhsb2dEaXIpKSB7XG4gICAgICAgICAgICAgICAgbWtkaXJTeW5jKGxvZ0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG9wZW5TeW5jKHRoaXMubG9nRmlsZVBhdGgsIFwiYVwiKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5sb2dGaWxlRmQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHdyaXRlU3luYyh0aGlzLmxvZ0ZpbGVGZCwgYCR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcbmApO1xuICAgICAgICB9XG4gICAgfVxufVxuZXhwb3J0IGNvbnN0IGxvZ2dlciA9IG5ldyBMb2dnZXIoKTtcbiIsICJleHBvcnQgY29uc3QgRVhJVF9DT0RFUyA9IHtcbiAgICBTVUNDRVNTOiAwLFxuICAgIEVSUk9SOiAxLFxuICAgIEJMT0NLOiAyLFxufTtcbmV4cG9ydCBjbGFzcyBCbG9ja0Vycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAgIHJlYXNvbjtcbiAgICBjb25zdHJ1Y3RvcihyZWFzb24pIHtcbiAgICAgICAgc3VwZXIocmVhc29uKTtcbiAgICAgICAgdGhpcy5uYW1lID0gXCJCbG9ja0Vycm9yXCI7XG4gICAgICAgIHRoaXMucmVhc29uID0gcmVhc29uO1xuICAgIH1cbn1cbmZ1bmN0aW9uIG9taXRVbmRlZmluZWQodmFsdWUpIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKHZhbHVlKS5maWx0ZXIoKFssIGVudHJ5XSkgPT4gZW50cnkgIT09IHVuZGVmaW5lZCkpO1xufVxuZnVuY3Rpb24gYnVpbGRPdXRwdXQodHlwZSwgc3Rkb3V0LCBzdGRlcnIpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBfdHlwZTogdHlwZSxcbiAgICAgICAgc3Rkb3V0OiBvbWl0VW5kZWZpbmVkKHN0ZG91dCksXG4gICAgICAgIC4uLihzdGRlcnIgIT09IHVuZGVmaW5lZCA/IHsgc3RkZXJyIH0gOiB7fSksXG4gICAgfTtcbn1cbmV4cG9ydCBmdW5jdGlvbiByYXdPdXRwdXQoc3Rkb3V0LCBzdGRlcnIpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJSYXdcIiwgc3Rkb3V0LCBzdGRlcnIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaGFzU3BlY2lmaWMgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvblJlYXNvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMudXBkYXRlZElucHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUHJlVG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uLFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvblJlYXNvbixcbiAgICAgICAgICAgIHVwZGF0ZWRJbnB1dDogb3B0aW9ucy51cGRhdGVkSW5wdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VMZWdhY3lCbG9ja091dHB1dChvcHRpb25zKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaGFzU3BlY2lmaWMgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWQgfHwgb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlBvc3RUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHVwZGF0ZWRNQ1BUb29sT3V0cHV0OiBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0VG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RPdXRwdXQob3B0aW9ucykge1xuICAgIGNvbnN0IGRlY2lzaW9uID0gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgIGJlaGF2aW9yOiBvcHRpb25zLmJlaGF2aW9yLFxuICAgICAgICBtZXNzYWdlOiBvcHRpb25zLm1lc3NhZ2UsXG4gICAgICAgIGludGVycnVwdDogb3B0aW9ucy5pbnRlcnJ1cHQsXG4gICAgICAgIHVwZGF0ZWRJbnB1dDogb3B0aW9ucy51cGRhdGVkSW5wdXQsXG4gICAgICAgIHVwZGF0ZWRQZXJtaXNzaW9uczogb3B0aW9ucy51cGRhdGVkUGVybWlzc2lvbnMsXG4gICAgfSk7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0ge1xuICAgICAgICBob29rRXZlbnROYW1lOiBcIlBlcm1pc3Npb25SZXF1ZXN0XCIsXG4gICAgICAgIGRlY2lzaW9uLFxuICAgIH07XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUGVybWlzc2lvblJlcXVlc3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlVzZXJQcm9tcHRTdWJtaXRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlVzZXJQcm9tcHRTdWJtaXRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlNlc3Npb25TdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU2Vzc2lvblN0YXJ0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdWJhZ2VudFN0YXJ0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdWJhZ2VudFN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVDb21wYWN0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZUNvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RDb21wYWN0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbiIsICJpbXBvcnQgeyBFVkVOVFNfV0lUSF9URVhUX09VVFBVVCB9IGZyb20gXCIuL2NvbnN0YW50cy5qc1wiO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2VyLmpzXCI7XG5pbXBvcnQgeyBCbG9ja0Vycm9yLCBFWElUX0NPREVTLCBzZXNzaW9uU3RhcnRPdXRwdXQsIHN1YmFnZW50U3RhcnRPdXRwdXQsIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQsIH0gZnJvbSBcIi4vb3V0cHV0cy5qc1wiO1xuYXN5bmMgZnVuY3Rpb24gcmVhZFN0ZGluKCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGNvbnN0IGNodW5rcyA9IFtdO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLnNldEVuY29kaW5nKFwidXRmLThcIik7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJkYXRhXCIsIChjaHVuaykgPT4gY2h1bmtzLnB1c2goY2h1bmspKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVuZFwiLCAoKSA9PiByZXNvbHZlKGNodW5rcy5qb2luKFwiXCIpKSk7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJlcnJvclwiLCByZWplY3QpO1xuICAgIH0pO1xufVxuZnVuY3Rpb24gcGFyc2VTdGRpbklucHV0KHN0ZGluQ29udGVudCkge1xuICAgIHJldHVybiBKU09OLnBhcnNlKHN0ZGluQ29udGVudCk7XG59XG5mdW5jdGlvbiB3cml0ZVN0ZG91dChvdXRwdXQpIHtcbiAgICBwcm9jZXNzLnN0ZG91dC53cml0ZShKU09OLnN0cmluZ2lmeShvdXRwdXQuc3Rkb3V0KSk7XG59XG5mdW5jdGlvbiBub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0V2ZW50TmFtZSwgcmVzdWx0KSB7XG4gICAgaWYgKCFFVkVOVFNfV0lUSF9URVhUX09VVFBVVC5oYXMoaG9va0V2ZW50TmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2hvb2tFdmVudE5hbWV9IGhvb2tzIGNhbm5vdCByZXR1cm4gcGxhaW4gdGV4dGApO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTZXNzaW9uU3RhcnRcIikge1xuICAgICAgICByZXR1cm4gc2Vzc2lvblN0YXJ0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbiAgICB9XG4gICAgaWYgKGhvb2tFdmVudE5hbWUgPT09IFwiU3ViYWdlbnRTdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzdWJhZ2VudFN0YXJ0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIGNvbnZlcnRUb0hvb2tPdXRwdXQob3V0cHV0KSB7XG4gICAgcmV0dXJuIG91dHB1dC5zdGRlcnIgIT09IHVuZGVmaW5lZCA/IHsgc3Rkb3V0OiBvdXRwdXQuc3Rkb3V0LCBzdGRlcnI6IG91dHB1dC5zdGRlcnIgfSA6IHsgc3Rkb3V0OiBvdXRwdXQuc3Rkb3V0IH07XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXhlY3V0ZShob29rRm4pIHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBzdGRpbkNvbnRlbnQgPSBhd2FpdCByZWFkU3RkaW4oKTtcbiAgICAgICAgY29uc3QgaW5wdXQgPSBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KTtcbiAgICAgICAgbG9nZ2VyLnNldENvbnRleHQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIGlucHV0KTtcbiAgICAgICAgY29uc3QgY29udGV4dCA9IHsgbG9nZ2VyIH07XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhvb2tGbihpbnB1dCwgY29udGV4dCk7XG4gICAgICAgIGxldCBvdXRwdXQgPSB7IHN0ZG91dDoge30gfTtcbiAgICAgICAgaWYgKHR5cGVvZiByZXN1bHQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgIG91dHB1dCA9IGNvbnZlcnRUb0hvb2tPdXRwdXQobm9ybWFsaXplU3RyaW5nT3V0cHV0KGhvb2tGbi5ob29rRXZlbnROYW1lLCByZXN1bHQpKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChyZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICAgIHdyaXRlU3Rkb3V0KG91dHB1dCk7XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLlNVQ0NFU1MpO1xuICAgIH1cbiAgICBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQmxvY2tFcnJvcikge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3IucmVhc29ufVxcbmApO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuQkxPQ0spO1xuICAgICAgICB9XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5zdGFjayA/PyBlcnJvci5tZXNzYWdlfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7U3RyaW5nKGVycm9yKX1cXG5gKTtcbiAgICAgICAgfVxuICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5FUlJPUik7XG4gICAgfVxuICAgIGZpbmFsbHkge1xuICAgICAgICBsb2dnZXIuY2xlYXJDb250ZXh0KCk7XG4gICAgICAgIGxvZ2dlci5jbG9zZSgpO1xuICAgIH1cbn1cbiIsICIvKipcbiAqIFNoYXJlZCBoZWxwZXJzIHVzZWQgYnkgbXVsdGlwbGUgYWdlbnQtaG9va3MgZW50cnkgcG9pbnRzLlxuICpcbiAqIEV4dHJhY3RlZCBmcm9tIHByZS10b29sLXVzZS50cyBzbyB0aGF0IHRoZSB1cGNvbWluZyBTdG9wIGhvb2sgKGFuZCBhbnlcbiAqIGZ1dHVyZSBob29rcykgY2FuIGltcG9ydCBwYXRoIHV0aWxpdGllcywgcmFuZ2UgaGVscGVycywgYW5kIHRoZVxuICogc2FuaXRpemVTZXNzaW9uSWQvZm9ybWF0QW5jaG9yIGZ1bmN0aW9ucyB3aXRob3V0IGRlcGVuZGluZyBvbiB0aGVcbiAqIFByZVRvb2xVc2Utc3BlY2lmaWMgbW9kdWxlLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnbm9kZTpjcnlwdG8nO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGF0aCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG5mdW5jdGlvbiBpc0Fic29sdXRlUG9zaXgocDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBwLnN0YXJ0c1dpdGgoJy8nKSB8fCAvXltBLVphLXpdOlxcLy8udGVzdChwKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFic3BhdGhBZ2FpbnN0KGJhc2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0ID0gdG9Qb3NpeCh0YXJnZXQpO1xuICBpZiAoaXNBYnNvbHV0ZVBvc2l4KHQpKSByZXR1cm4gdDtcbiAgY29uc3QgYiA9IHRvUG9zaXgoYmFzZSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiBgJHtifS8ke3R9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZXBvUm9vdChkaXI6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFkaXIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIGRpciwgJ3Jldi1wYXJzZScsICctLXNob3ctdG9wbGV2ZWwnXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IG91dC50cmltKCk7XG4gICAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRvUG9zaXgodHJpbW1lZCkgOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGlzIGV4Y2x1ZGVkIGJ5IGdpdCdzIGlnbm9yZSBydWxlc1xuICogKC5naXRpZ25vcmUsIC5naXQvaW5mby9leGNsdWRlLCBjb3JlLmV4Y2x1ZGVzRmlsZSkuIFVzZWQgdG8ga2VlcCBpZ25vcmVkXG4gKiBmaWxlcyBcdTIwMTQgYnVpbGQgb3V0cHV0LCBjYWNoZXMsIGxvZ3MgXHUyMDE0IG91dCBvZiB0aGUgdG91Y2ggam91cm5hbCBlbnRpcmVseSwgc29cbiAqIHRoZSBTdG9wIGhvb2sgbmV2ZXIgcmVwb3J0cyByZWFkcywgd3JpdGVzLCBvciB1bmNvdmVyZWQgd3JpdGVzIG9uIHRoZW0uXG4gKlxuICogYGdpdCBjaGVjay1pZ25vcmUgLXEgPHBhdGg+YCBleGl0cyAwIHdoZW4gdGhlIHBhdGggaXMgaWdub3JlZCwgMSB3aGVuIGl0IGlzXG4gKiBub3QsIGFuZCAxMjggb24gZXJyb3IuIGV4ZWNGaWxlU3luYyB0aHJvd3Mgb24gYW55IG5vbi16ZXJvIGV4aXQsIHNvIGEgY2xlYW5cbiAqIHJldHVybiBtZWFucyBcImlnbm9yZWRcIi4gQSBzdGF0dXMtMSB0aHJvdyBpcyB0aGUgZXhwZWN0ZWQgXCJub3QgaWdub3JlZFwiXG4gKiBzaWduYWw7IGFueSBvdGhlciBmYWlsdXJlIGlzIGFuIHVucmVsaWFibGUgYW5zd2VyLCBzbyB3ZSByZXBvcnQgYGZhbHNlYFxuICogKGRvIG5vdCBkcm9wIHRoZSB0b3VjaCkgcmF0aGVyIHRoYW4gc2lsZW50bHkgaGlkaW5nIGEgdHJhY2tlZCBmaWxlLlxuICovXG4vKipcbiAqIFRoZSBkZWZhdWx0IHNwYW4gcm9vdCBkaXJlY3RvcnksIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3QsIHVzZWQgd2hlbiBub1xuICogZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgZ2l0IGNvbmZpZyBvdmVycmlkZXMgdGhlIGxvY2F0aW9uLlxuICovXG5leHBvcnQgY29uc3QgU1BBTl9ST09UID0gJy5zcGFuJztcblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBzcGFuIHJvb3QgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHJlcG8sIG1pcnJvcmluZyB0aGUgUnVzdCBDTElcbiAqIHByZWNlZGVuY2UgKG1pbnVzIHRoZSAtLXNwYW4tZGlyIENMSSBmbGFnLCB3aGljaCBpcyBpbnZpc2libGUgdG8gZmlsZS13cml0ZVxuICogaG9va3MpOlxuICogICAxLiBHSVRfU1BBTl9ESVIgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAqICAgMi4gYGdpdCBjb25maWcgZ2l0LXNwYW4uZGlyYCBpbiB0aGUgcmVwb1xuICogICAzLiBEZWZhdWx0OiBcIi5zcGFuXCJcbiAqXG4gKiBUaGUgcmV0dXJuZWQgdmFsdWUgaXMgYSBQT1NJWC1zdHlsZSBwYXRoIHdpdGggbm8gdHJhaWxpbmcgc2xhc2guXG4gKiBGYWlsLXNhZmU6IGFueSByZXNvbHV0aW9uIGVycm9yIGZhbGxzIGJhY2sgdG8gXCIuc3BhblwiIHNvIHRoZSBob29rIG5ldmVyXG4gKiBjcmFzaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBlbnZEaXIgPSBwcm9jZXNzLmVudlsnR0lUX1NQQU5fRElSJ107XG4gIGlmIChlbnZEaXIgJiYgZW52RGlyLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZW52RGlyLnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NvbmZpZycsICdnaXQtc3Bhbi5kaXInXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkgcmV0dXJuIHRyaW1tZWQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyOyAvLyBjb25maWcga2V5IGFic2VudCBvciBnaXQgZXJyb3IgXHUyMDE0IGZhbGwgdGhyb3VnaCB0byBkZWZhdWx0XG4gIH1cbiAgcmV0dXJuIFNQQU5fUk9PVDtcbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aCBmYWxscyBpbnNpZGUgdGhlIGdpdmVuIHNwYW4gcm9vdFxuICogZGlyZWN0b3J5LiBBIHBhdGggaXMgaW5zaWRlIHdoZW4gaXQgZXF1YWxzIHRoZSBzcGFuIHJvb3QgZXhhY3RseSBvciBpc1xuICogbmVzdGVkIGJlbmVhdGggaXQgKGkuZS4gc3RhcnRzIHdpdGggXCI8c3BhblJvb3Q+L1wiKS4gVGhlIFwiL1wiIGJvdW5kYXJ5IHByZXZlbnRzXG4gKiBmYWxzZSBwb3NpdGl2ZXMgZm9yIHNpYmxpbmdzIGxpa2UgXCIuc3BhbnMveFwiIG9yIFwiLnNwYW4tbm90ZXMveFwiLlxuICpcbiAqIFBhc3MgdGhlIHJlc3VsdCBvZiBgcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KWAgYXMgYHNwYW5Sb290YC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGg6IHN0cmluZywgc3BhblJvb3Q6IHN0cmluZyA9IFNQQU5fUk9PVCk6IGJvb2xlYW4ge1xuICBjb25zdCByb290ID0gc3BhblJvb3QucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiByZXBvUmVsUGF0aCA9PT0gcm9vdCB8fCByZXBvUmVsUGF0aC5zdGFydHNXaXRoKGAke3Jvb3R9L2ApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNHaXRJZ25vcmVkKHJlcG9Sb290OiBzdHJpbmcsIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NoZWNrLWlnbm9yZScsICctcScsICctLScsIHJlcG9SZWxQYXRoXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ2lnbm9yZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290OiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJvb3QgPSB0b1Bvc2l4KHJlcG9Sb290KTtcbiAgY29uc3QgYWJzID0gdG9Qb3NpeChhYnNQYXRoKTtcbiAgY29uc3QgcHJlZml4ID0gcm9vdC5lbmRzV2l0aCgnLycpID8gcm9vdCA6IGAke3Jvb3R9L2A7XG4gIHJldHVybiBhYnMuc3RhcnRzV2l0aChwcmVmaXgpID8gYWJzLnNsaWNlKHByZWZpeC5sZW5ndGgpIDogYWJzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsaXplUGF0aChhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUoYWJzUGF0aCkpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGaWxlIGRvZXNuJ3QgZXhpc3QgeWV0IChlLmcuIFdyaXRlIHRvIGEgbmV3IGZpbGUpOiBjYW5vbmljYWxpemUgdGhlXG4gICAgLy8gZGlyZWN0b3J5IGFuZCByZWpvaW4gdGhlIGJhc2VuYW1lIHNvIHN5bWxpbmtzIGluIHRoZSBwYXJlbnQgYXJlIHJlc29sdmVkLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXIgPSB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSkpO1xuICAgICAgcmV0dXJuIGAke2Rpcn0vJHtub2RlUGF0aC5iYXNlbmFtZShhYnNQYXRoKX1gO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGFyZW50IGRvZXNuJ3QgZXhpc3QgZWl0aGVyOyBmYWxsIGJhY2sgdG8gdGhlIHVuLWNhbm9uaWNhbGl6ZWQgcGF0aC5cbiAgICAgIHJldHVybiBhYnNQYXRoO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlUGF0aCh0b29sSW5wdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBjd2Q6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBmcCA9IHRvb2xJbnB1dC5maWxlX3BhdGg7XG4gIGlmICh0eXBlb2YgZnAgIT09ICdzdHJpbmcnIHx8IGZwLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFicyA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgZnApO1xuICByZXR1cm4gY2Fub25pY2FsaXplUGF0aChhYnMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUgcmFuZ2UgdHlwZXMgYW5kIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIExpbmVSYW5nZSB7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmFuZ2VzSW50ZXJzZWN0KGE6IExpbmVSYW5nZSwgYjogTGluZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBhLnN0YXJ0IDw9IGIuZW5kICYmIGEuZW5kID49IGIuc3RhcnQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9yY2VsYWluIHJvdyBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBQb3JjZWxhaW5Sb3cge1xuICBuYW1lOiBzdHJpbmc7XG4gIHBhdGg6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzKSBjb250aW51ZTtcbiAgICBjb25zdCBbbmFtZSwgcGF0aCwgcmFuZ2VdID0gcGFydHM7XG4gICAgY29uc3QgZGFzaElkeCA9IHJhbmdlLmluZGV4T2YoJy0nKTtcbiAgICBpZiAoZGFzaElkeCA9PT0gLTEpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoMCwgZGFzaElkeCksIDEwKTtcbiAgICBjb25zdCBlbmQgPSBwYXJzZUludChyYW5nZS5zbGljZShkYXNoSWR4ICsgMSksIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLyoqXG4gKiBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBlbWl0cyBhIGRpZmZlcmVudCBzaGFwZSB0aGFuXG4gKiBgbGlzdCAtLXBvcmNlbGFpbmA6IGEgYCMgcG9yY2VsYWluIHYyYCBoZWFkZXIsIGAjIGZ1enp5IE5gIGNvbW1lbnQgbGluZXMsXG4gKiBhbmQgb25lIGA8c3RhdHVzPlxcdDxzcmM+XFx0PG5hbWU+XFx0PHBhdGg+XFx0PHN0YXJ0PlxcdDxlbmQ+YCByb3cgcGVyIGRyaWZ0ZWRcbiAqIGFuY2hvciAod2hvbGUtZmlsZSBhbmNob3JzIGNhcnJ5IGAod2hvbGUpYC9gLWAgaW4gcGxhY2Ugb2YgdGhlIGxpbmUgY29sdW1ucykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVN0YWxlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIElEIHNhbml0aXphdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSW5qZWN0aXZlIHRyYW5zZm9ybTogcGVyY2VudC1lbmNvZGUgYnl0ZXMgb3V0c2lkZSBbQS1aYS16MC05Ll8tXSBhcyAlSEhcbiAqICh1cHBlcmNhc2UgaGV4KS4gVXNlZCB0byBwcm9kdWNlIHNhZmUgZmlsZW5hbWVzIGZyb20gYXJiaXRyYXJ5IHNlc3Npb24gaWRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2Vzc2lvbklkLnJlcGxhY2UoL1teQS1aYS16MC05Ll8tXS9nLCAoY2gpID0+IHtcbiAgICByZXR1cm4gYCUke2NoLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkucGFkU3RhcnQoMiwgJzAnKX1gO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQZXItc2Vzc2lvbiBiYXNlIGRpcmVjdG9yeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEJhc2UgZGlyIHNoYXJlZCB3aXRoIHRoZSBTdG9wIGhvb2sncyB0b3VjaCBqb3VybmFsLiBFYWNoIHNlc3Npb24gZ2V0cyBvbmVcbi8vIGRpcmVjdG9yeTsgdGhlIHN1YmFnZW50IGNvdW50ZXIgbGl2ZXMgYWxvbmdzaWRlIHRoZSBqb3VybmFsIHNvIHRoZVxuLy8gU3ViYWdlbnRTdGFydC9TdWJhZ2VudFN0b3AgaG9va3MgKHdyaXRlcnMpIGFuZCB0aGUgU3RvcCBob29rIChyZWFkZXIpIGFncmVlIG9uXG4vLyBpdHMgbG9jYXRpb24uXG5jb25zdCBTRVNTSU9OX0JBU0VfRElSID0gbm9kZVBhdGguam9pbihvcy5ob21lZGlyKCksICcuY2FjaGUnLCAnZ2l0LXNwYW4nLCAnc2Vzc2lvbicpO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIHN1YmFnZW50IGNvdW50ZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRDb3VudFBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQpLCAnc3ViYWdlbnQtY291bnQnKTtcbn1cblxuLy8gTG9jayBjb25zdGFudHNcbmNvbnN0IExPQ0tfUkVUUllfSU5URVJWQUxfTVMgPSA1O1xuLy8gVGhlIGNyaXRpY2FsIHNlY3Rpb24gaXMgYSBtaWNyb3NlY29uZC1zY2FsZSByZWFkLW1vZGlmeS13cml0ZSwgc28gcmVhbFxuLy8gY29udGVudGlvbiByZXNvbHZlcyBhbG1vc3QgaW1tZWRpYXRlbHkuIEEgZ2VuZXJvdXMgYnVkZ2V0ICh+NSBzIG9mIHJldHJpZXMpXG4vLyBtZWFucyB0aGUgb25seSB3YXkgdG8gZXhoYXVzdCBpdCBpcyBhIGdlbnVpbmVseSBhYmFuZG9uZWQgbG9jayBcdTIwMTQgd2hpY2ggdGhlXG4vLyBzdGFsZS1sb2NrIGJyZWFrZXIgcmVjbGFpbXMgYmVsb3cgXHUyMDE0IHJhdGhlciB0aGFuIG9yZGluYXJ5IGNvbnRlbnRpb24uXG5jb25zdCBMT0NLX01BWF9SRVRSSUVTID0gMTAwMDsgLy8gfjUgcyB0b3RhbCBidWRnZXQgYXQgNSBtcy9yZXRyeVxuLy8gUmVjbGFpbSBsb2NrcyBvbGRlciB0aGFuIHRoaXMuIFRoZSBob2xkIGlzIG1pY3Jvc2Vjb25kLXNjYWxlLCBzbyBhIHRocmVzaG9sZFxuLy8gdGhpcyBmYXIgYWJvdmUgYW55IHJlYWwgaG9sZCB0aW1lIG1lYW5zIGEgbG9jayB0aGlzIG9sZCBpcyBnZW51aW5lbHlcbi8vIGFiYW5kb25lZCAoYSBjcmFzaGVkL2tpbGxlZCBob2xkZXIpLCBuZXZlciBvbmUgbWlkLWNyaXRpY2FsLXNlY3Rpb24uXG5jb25zdCBMT0NLX1NUQUxFX01TID0gMzBfMDAwOyAvLyAzMCBzXG5cbnR5cGUgQ291bnRMb2dnZXIgPSB7IHdhcm46IChtc2c6IHN0cmluZywgbWV0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkIH0gfCB1bmRlZmluZWQ7XG5cbi8qKlxuICogQWNxdWlyZSBhbiBleGNsdXNpdmUgcGVyLXNlc3Npb24gZmlsZXN5c3RlbSBsb2NrLlxuICpcbiAqIFNwaW5zIHdpdGggTE9DS19SRVRSWV9JTlRFUlZBTF9NUyBzbGVlcHMgdXAgdG8gTE9DS19NQVhfUkVUUklFUyBhdHRlbXB0cyxcbiAqIGdpdmluZyBhIGdlbmVyb3VzIGJ1ZGdldCBzbyBvcmRpbmFyeSBjb250ZW50aW9uIG5ldmVyIGV4aGF1c3RzIGl0LiBBIGxvY2tcbiAqIHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gTE9DS19TVEFMRV9NUyBpcyB0cmVhdGVkIGFzIGFiYW5kb25lZCBhbmQgcmVjbGFpbWVkLlxuICpcbiAqIFJlY2xhaW0gaXMgcmFjZS1mcmVlOiB0aGUgY29udGVuZGVyIGZpcnN0IGF0b21pY2FsbHkgcmVuYW1lcyB0aGUgc3RhbGUgbG9jayB0b1xuICogYSB1bmlxdWUgc2lkZWxpbmVkIG5hbWUgKGByZW5hbWVgIGhhcyBleGFjdGx5IG9uZSB3aW5uZXIgYWNyb3NzIHByb2Nlc3NlcyksXG4gKiB0aGVuIHVubGlua3MgdGhlIHNpZGVsaW5lIGFuZCByZXRyaWVzIHRoZSBleGNsdXNpdmUgYG9wZW4od3gpYC4gVHdvIGNvbnRlbmRlcnNcbiAqIGNhbm5vdCBib3RoIHdpbiB0aGUgcmVuYW1lLCBzbyB0aGV5IGNhbm5vdCBib3RoIGFjcXVpcmUgXHUyMDE0IGF0IG1vc3Qgb25lIHJlY2xhaW1zXG4gKiBhbmQgdGhlIHJlc3QgZmFsbCBiYWNrIHRvIHRoZSBub3JtYWwgZXhjbHVzaXZlLWNyZWF0ZSBjb250ZW50aW9uLlxuICpcbiAqIFJldHVybnMgdGhlIGxvY2sgcGF0aCBmb3IgdGhlIGNhbGxlciB0byB1bmxpbmsgaW4gZmluYWxseS5cbiAqL1xuZnVuY3Rpb24gYWNxdWlyZUxvY2soY291bnRGaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbG9ja1BhdGggPSBgJHtjb3VudEZpbGVQYXRofS5sb2NrYDtcbiAgbGV0IGF0dGVtcHRzID0gMDtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZmQgPSBmcy5vcGVuU3luYyhsb2NrUGF0aCwgJ3d4Jyk7XG4gICAgICBmcy5jbG9zZVN5bmMoZmQpO1xuICAgICAgcmV0dXJuIGxvY2tQYXRoO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc3QgZSA9IGVyciBhcyBOb2RlSlMuRXJybm9FeGNlcHRpb247XG4gICAgICBpZiAoZS5jb2RlICE9PSAnRUVYSVNUJykgdGhyb3cgZXJyO1xuICAgICAgLy8gTG9jayBleGlzdHMgXHUyMDE0IGNoZWNrIHN0YWxlbmVzcy5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhsb2NrUGF0aCk7XG4gICAgICAgIGlmIChEYXRlLm5vdygpIC0gc3RhdC5tdGltZU1zID4gTE9DS19TVEFMRV9NUykge1xuICAgICAgICAgIC8vIEFiYW5kb25lZDogcmVjbGFpbSBhdG9taWNhbGx5LiBSZW5hbWUgdGhlIHN0YWxlIGxvY2sgYXNpZGU7IG9ubHkgb25lXG4gICAgICAgICAgLy8gY29udGVuZGVyIGNhbiB3aW4gdGhpcyByZW5hbWUsIHNvIHJlY2xhaW0gY2Fubm90IHJhY2UgdHdvIGFjcXVpcmVycy5cbiAgICAgICAgICBjb25zdCBzaWRlbGluZSA9IGAke2xvY2tQYXRofS5zdGFsZS4ke3Byb2Nlc3MucGlkfS4ke3JhbmRvbVVVSUQoKX1gO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBmcy5yZW5hbWVTeW5jKGxvY2tQYXRoLCBzaWRlbGluZSk7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBmcy51bmxpbmtTeW5jKHNpZGVsaW5lKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUyKSB7XG4gICAgICAgICAgICAgIHZvaWQgZTI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBjYXRjaCAoZTIpIHtcbiAgICAgICAgICAgIC8vIExvc3QgdGhlIHJlbmFtZSByYWNlIChhbm90aGVyIGNvbnRlbmRlciByZWNsYWltZWQgaXQpIG9yIHRoZSBsb2NrXG4gICAgICAgICAgICAvLyB2YW5pc2hlZCBcdTIwMTQgZWl0aGVyIHdheSwgcmV0cnkgdGhlIGV4Y2x1c2l2ZSBjcmVhdGUuXG4gICAgICAgICAgICB2b2lkIGUyO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIExvY2sgZGlzYXBwZWFyZWQgYmV0d2VlbiBleGlzdGVuY2UgY2hlY2sgYW5kIHN0YXQgXHUyMDE0IHJldHJ5LlxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICgrK2F0dGVtcHRzID49IExPQ0tfTUFYX1JFVFJJRVMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBzdWJhZ2VudC1jb3VudDogY291bGQgbm90IGFjcXVpcmUgbG9jayBhZnRlciAke0xPQ0tfTUFYX1JFVFJJRVN9IHJldHJpZXNgKTtcbiAgICAgIH1cbiAgICAgIC8vIEJ1c3ktd2FpdCB3aXRoIGEgc3luY2hyb25vdXMgc2xlZXAgKGhvb2tzIGFyZSBzaG9ydC1saXZlZCBwcm9jZXNzZXMpLlxuICAgICAgQXRvbWljcy53YWl0KG5ldyBJbnQzMkFycmF5KG5ldyBTaGFyZWRBcnJheUJ1ZmZlcig0KSksIDAsIDAsIExPQ0tfUkVUUllfSU5URVJWQUxfTVMpO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJlYWQgYW5kIHBhcnNlIHRoZSBjb3VudCBmaWxlLiBEaXN0aW5ndWlzaGVzIHRocmVlIHN0YXRlczpcbiAqICAgLSBhYnNlbnQgKEVOT0VOVCkgXHUyMTkyIDAgKGxlZ2l0aW1hdGUgXCJubyBzdWJhZ2VudCBoYXMgc3RhcnRlZCB0aGlzIHNlc3Npb25cIilcbiAqICAgLSBwcmVzZW50IGJ1dCBlbXB0eSAvIHVucGFyc2VhYmxlIC8gbmVnYXRpdmUgXHUyMTkyIHRocm93cyAoYW1iaWd1b3VzOyB0aGUgY2FsbGVyXG4gKiAgICAgbXVzdCBmYWlsIGNsb3NlZCBhbmQgc3VwcHJlc3MgcmF0aGVyIHRoYW4gdHJlYXQgYXMgMClcbiAqICAgLSBwcmVzZW50IGFuZCBhIHZhbGlkIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyIFx1MjE5MiB0aGF0IHZhbHVlXG4gKlxuICogQW55IG5vbi1FTk9FTlQgSS9PIGVycm9yIChFQUNDRVMsIEVJTywgRUlTRElSLCBcdTIwMjYpIHByb3BhZ2F0ZXMgdW5jaGFuZ2VkLlxuICovXG5mdW5jdGlvbiByZWFkQ291bnRSYXcoY291bnRGaWxlUGF0aDogc3RyaW5nKTogbnVtYmVyIHtcbiAgbGV0IHJhdzogc3RyaW5nO1xuICB0cnkge1xuICAgIHJhdyA9IGZzLnJlYWRGaWxlU3luYyhjb3VudEZpbGVQYXRoLCAndXRmOCcpLnRyaW0oKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc3QgZSA9IGVyciBhcyBOb2RlSlMuRXJybm9FeGNlcHRpb247XG4gICAgaWYgKGUuY29kZSA9PT0gJ0VOT0VOVCcpIHJldHVybiAwO1xuICAgIHRocm93IGVycjtcbiAgfVxuICBpZiAoIXJhdykge1xuICAgIHRocm93IG5ldyBFcnJvcihgc3ViYWdlbnQtY291bnQ6IGNvdW50IGZpbGUgaXMgcHJlc2VudCBidXQgZW1wdHk6ICR7Y291bnRGaWxlUGF0aH1gKTtcbiAgfVxuICBjb25zdCBuID0gcGFyc2VJbnQocmF3LCAxMCk7XG4gIGlmIChOdW1iZXIuaXNOYU4obikgfHwgbiA8IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYHN1YmFnZW50LWNvdW50OiBjb3VudCBmaWxlIGhvbGRzIGFuIHVucGFyc2VhYmxlIG9yIG5lZ2F0aXZlIHZhbHVlOiAke0pTT04uc3RyaW5naWZ5KHJhdyl9YCk7XG4gIH1cbiAgcmV0dXJuIG47XG59XG5cbi8qKlxuICogQXRvbWljYWxseSBwZXJzaXN0IHRoZSBjb3VudDogd3JpdGUgYSB1bmlxdWVseS1uYW1lZCB0ZW1wIGZpbGUgaW4gdGhlIHNhbWVcbiAqIGRpcmVjdG9yeSwgdGhlbiBgcmVuYW1lYCBpdCBpbnRvIHBsYWNlLiBSZW5hbWUgaXMgYXRvbWljIG9uIHRoZSBzYW1lXG4gKiBmaWxlc3lzdGVtLCBzbyBhIGNvbmN1cnJlbnQgbG9jay1mcmVlIHJlYWRlciBvYnNlcnZlcyBlaXRoZXIgdGhlIG9sZCBjb21wbGV0ZVxuICogZmlsZSBvciB0aGUgbmV3IGNvbXBsZXRlIGZpbGUgXHUyMDE0IG5ldmVyIGEgdG9ybiBvciB6ZXJvLWJ5dGUgaW50ZXJtZWRpYXRlLiBUaGVcbiAqIHRlbXAgbmFtZSBjYXJyaWVzIHRoZSBwaWQgYW5kIGEgdXVpZCBzbyB0d28gd3JpdGVycyBuZXZlciBjb2xsaWRlLiBNaXJyb3JzXG4gKiBgd3JpdGVKb3VybmFsYCBpbiBzdG9wLnRzLlxuICovXG5mdW5jdGlvbiB3cml0ZUNvdW50QXRvbWljKGNvdW50RmlsZVBhdGg6IHN0cmluZywgdmFsdWU6IG51bWJlciB8IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCB0bXBQYXRoID0gYCR7Y291bnRGaWxlUGF0aH0udG1wLiR7cHJvY2Vzcy5waWR9LiR7cmFuZG9tVVVJRCgpfWA7XG4gIHRyeSB7XG4gICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBgJHt2YWx1ZX1gLCAndXRmOCcpO1xuICAgIGZzLnJlbmFtZVN5bmModG1wUGF0aCwgY291bnRGaWxlUGF0aCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIC8vIEJlc3QtZWZmb3J0IGNsZWFudXAgb2YgdGhlIHRlbXAgZmlsZSBvbiBmYWlsdXJlLCB0aGVuIHJlLXRocm93IHNvIHRoZVxuICAgIC8vIGNhbGxlciAoaW5jcmVtZW50U3ViYWdlbnRDb3VudC9kZWNyZW1lbnRTdWJhZ2VudENvdW50KSBsb2dzIGl0LlxuICAgIHRyeSB7XG4gICAgICBmcy51bmxpbmtTeW5jKHRtcFBhdGgpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHZvaWQgZTtcbiAgICB9XG4gICAgdGhyb3cgZXJyO1xuICB9XG59XG5cbmZ1bmN0aW9uIHdpdGhDb3VudExvY2soY291bnRGaWxlUGF0aDogc3RyaW5nLCBmbjogKGN1cnJlbnQ6IG51bWJlcikgPT4gbnVtYmVyKTogdm9pZCB7XG4gIC8vIEVuc3VyZSB0aGUgc2Vzc2lvbiBkaXJlY3RvcnkgZXhpc3RzIGJlZm9yZSBhY3F1aXJpbmcgdGhlIGxvY2sgXHUyMDE0IHRoZSBsb2NrXG4gIC8vIGZpbGUgbGl2ZXMgaW4gdGhlIHNhbWUgZGlyZWN0b3J5IGFzIHRoZSBjb3VudCBmaWxlLlxuICBmcy5ta2RpclN5bmMobm9kZVBhdGguZGlybmFtZShjb3VudEZpbGVQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGNvbnN0IGxvY2tQYXRoID0gYWNxdWlyZUxvY2soY291bnRGaWxlUGF0aCk7XG4gIHRyeSB7XG4gICAgLy8gVW5kZXIgdGhlIGxvY2sgdGhlIGZpbGUgaXMgbmV2ZXIgdG9ybiwgc28gYSBwcmVzZW50LWJ1dC1lbXB0eS91bnBhcnNlYWJsZVxuICAgIC8vIHJlYWQgaGVyZSB3b3VsZCBiZSBnZW51aW5lIGNvcnJ1cHRpb247IHJlYWRDb3VudFJhdyB0aHJvd3MgYW5kIHdlIGxldCBpdFxuICAgIC8vIHByb3BhZ2F0ZSB0byB0aGUgY2FsbGVyJ3MgY2F0Y2ggcmF0aGVyIHRoYW4gc2lsZW50bHkgcmVzZXR0aW5nIHRvIDAuXG4gICAgY29uc3QgY3VycmVudCA9IHJlYWRDb3VudFJhdyhjb3VudEZpbGVQYXRoKTtcbiAgICBjb25zdCBuZXh0ID0gZm4oY3VycmVudCk7XG4gICAgd3JpdGVDb3VudEF0b21pYyhjb3VudEZpbGVQYXRoLCBuZXh0KTtcbiAgfSBmaW5hbGx5IHtcbiAgICB0cnkge1xuICAgICAgZnMudW5saW5rU3luYyhsb2NrUGF0aCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdm9pZCBlO1xuICAgIH1cbiAgfVxufVxuXG4vLyBUaGUgbWFya2VyIGFuIGluY3JlbWVudCB3cml0ZXMgd2hlbiBpdCBjYW5ub3QgY29tcGxldGUgaXRzIHJlYWQtbW9kaWZ5LXdyaXRlXG4vLyAoZS5nLiBsb2NrLWJ1ZGdldCBleGhhdXN0aW9uIG9yIGNvdW50LWZpbGUgY29ycnVwdGlvbikuIEl0IGlzIGRlbGliZXJhdGVseVxuLy8gdW5wYXJzZWFibGUgc28gZXZlcnkgc3Vic2VxdWVudCByZWFkQ291bnRSYXcgY2FsbCB0aHJvd3MgXHUyMDE0IGluY2x1ZGluZyBhbnlcbi8vIGxhdGVyIGluY3JlbWVudCdzIHByZS13cml0ZSByZWFkIGluc2lkZSB3aXRoQ291bnRMb2NrIFx1MjAxNCB3aGljaCBtZWFucyBub1xuLy8gc3VjY2Vzc2Z1bCBSTVcgY2FuIGV2ZXIgcmUtZXN0YWJsaXNoIGEgbnVtZXJpYyBjb3VudCBvbmNlIHRoZSBtYXJrZXIgaXMgb25cbi8vIGRpc2suIFRoZSBsYXRjaCBpcyBwZXJtYW5lbnQgZm9yIHRoZSByZW1haW5kZXIgb2YgdGhlIHNlc3Npb246IHRoZSBTdG9wIGhvb2tcbi8vIHdpbGwgc3VwcHJlc3Mgc3Bhbi1yZXZpZXcgZGlzcGF0Y2ggb24gZXZlcnkgU3RvcCBmb3IgdGhpcyBzZXNzaW9uLCBhbmRcbi8vIHJlY292ZXJ5IHJlcXVpcmVzIGEgZnJlc2ggc2Vzc2lvbiAobmV3IHNlc3Npb24gaWQgXHUyMTkyIG5ldyBwZXItc2Vzc2lvblxuLy8gZGlyZWN0b3J5KS4gVGhpcyBpcyB0aGUgc2FmZSAoZmFpbC1jbG9zZWQpIGRpcmVjdGlvbiBhbmQgaXMgY29uc2lzdGVudCB3aXRoXG4vLyB0aGUgYWNjZXB0ZWQgXCJjcmFzaGVkIHN1YmFnZW50IGxlYWtzIHRoZSBjb3VudCBhbmQgc3VwcHJlc3NlcyBzZXNzaW9uLXdpZGVcIlxuLy8gbGltaXRhdGlvbi5cbmNvbnN0IENPVU5UX0ZBSUxDTE9TRURfTUFSS0VSID0gJ0ZBSUxfQ0xPU0VEJztcblxuLyoqXG4gKiBJbmNyZW1lbnQgdGhlIHBlci1zZXNzaW9uIGFjdGl2ZS1zdWJhZ2VudCBjb3VudCBieSAxLiBBdG9taWMgUk1XIHVuZGVyIGFcbiAqIHBlci1zZXNzaW9uIGZpbGVzeXN0ZW0gbG9jay5cbiAqXG4gKiBOb24tZmF0YWwgdG8gdGhlIGhvb2s6IGEgZmFpbHVyZSBpcyBsb2dnZWQsIG5ldmVyIHRocm93bi4gQnV0IGFuIGluY3JlbWVudFxuICogbXVzdCBuZXZlciBzaWxlbnRseSB1bmRlcmNvdW50IFx1MjAxNCBhIGRyb3BwZWQgKzEgbGV0cyBhIGxhdGVyIFN0b3AgcmVhZCBhXG4gKiB0b28tbG93IGNvdW50IGFuZCBkaXNwYXRjaCBtaWQtZmFuLW91dCAoZmFpbC1vcGVuKS4gU28gd2hlbiB0aGUgUk1XIGNhbm5vdCBiZVxuICogY29tcGxldGVkIChlLmcuIHRoZSBsb2NrIGJ1ZGdldCBpcyBleGhhdXN0ZWQgYnkgYSBnZW51aW5lbHkgc3R1Y2sgaG9sZGVyKSwgd2VcbiAqIHdyaXRlIGEgZmFpbC1jbG9zZWQgbWFya2VyIHRoYXQgbWFrZXMgdGhlIGxvY2stZnJlZSBTdG9wIHJlYWQgdGhyb3cgYW5kIHRoZVxuICogU3RvcCBob29rIHN1cHByZXNzLCByYXRoZXIgdGhhbiBsZWF2aW5nIGEgc3RhbGUgbG93IG51bWJlciBpbiBwbGFjZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluY3JlbWVudFN1YmFnZW50Q291bnQoc2Vzc2lvbklkOiBzdHJpbmcsIGxvZ2dlcj86IENvdW50TG9nZ2VyKTogdm9pZCB7XG4gIGNvbnN0IGNvdW50UGF0aCA9IHN1YmFnZW50Q291bnRQYXRoKHNlc3Npb25JZCk7XG4gIHRyeSB7XG4gICAgd2l0aENvdW50TG9jayhjb3VudFBhdGgsIChuKSA9PiBuICsgMSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlcj8ud2FybignZmFpbGVkIHRvIGluY3JlbWVudCBzdWJhZ2VudCBjb3VudDsgd3JpdGluZyBmYWlsLWNsb3NlZCBtYXJrZXInLCB7IGVyciB9KTtcbiAgICAvLyBGYWlsIGNsb3NlZDogYW4gdW5wYXJzZWFibGUgY291bnQgc3VwcHJlc3NlcyBkaXNwYXRjaCAoc2VlIHJlYWRDb3VudFJhdykuXG4gICAgdHJ5IHtcbiAgICAgIGZzLm1rZGlyU3luYyhub2RlUGF0aC5kaXJuYW1lKGNvdW50UGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgd3JpdGVDb3VudEF0b21pYyhjb3VudFBhdGgsIENPVU5UX0ZBSUxDTE9TRURfTUFSS0VSKTtcbiAgICB9IGNhdGNoIChlcnIyKSB7XG4gICAgICBsb2dnZXI/Lndhcm4oJ2ZhaWxlZCB0byB3cml0ZSBmYWlsLWNsb3NlZCBzdWJhZ2VudC1jb3VudCBtYXJrZXInLCB7IGVycjogZXJyMiB9KTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBEZWNyZW1lbnQgdGhlIHBlci1zZXNzaW9uIGFjdGl2ZS1zdWJhZ2VudCBjb3VudCBieSAxLCBmbG9vcmluZyBhdCB6ZXJvLlxuICogQXRvbWljIFJNVyB1bmRlciBhIHBlci1zZXNzaW9uIGZpbGVzeXN0ZW0gbG9jay4gQmVzdC1lZmZvcnQgXHUyMDE0IGEgZmFpbHVyZSBpc1xuICogbG9nZ2VkIGFuZCBzd2FsbG93ZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWNyZW1lbnRTdWJhZ2VudENvdW50KHNlc3Npb25JZDogc3RyaW5nLCBsb2dnZXI/OiBDb3VudExvZ2dlcik6IHZvaWQge1xuICB0cnkge1xuICAgIHdpdGhDb3VudExvY2soc3ViYWdlbnRDb3VudFBhdGgoc2Vzc2lvbklkKSwgKG4pID0+IE1hdGgubWF4KDAsIG4gLSAxKSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlcj8ud2FybignZmFpbGVkIHRvIGRlY3JlbWVudCBzdWJhZ2VudCBjb3VudCcsIHsgZXJyIH0pO1xuICB9XG59XG5cbi8qKlxuICogUmVhZCB0aGUgY3VycmVudCBhY3RpdmUtc3ViYWdlbnQgY291bnQuXG4gKlxuICogRmFpbC1jbG9zZWQgY29udHJhY3QgZm9yIHRoZSBTdG9wIGhvb2s6IHRoZSBvbmx5IHN0YXRlIHRoYXQgbGVnaXRpbWF0ZWx5IG1lYW5zXG4gKiBcIjAgYWN0aXZlIHN1YmFnZW50cywgZGlzcGF0Y2ggbm9ybWFsbHlcIiBpcyB0aGUgY291bnQgZmlsZSBiZWluZyAqKmFic2VudCoqLCBzb1xuICogYWJzZW50IFx1MjE5MiAwLiBFdmVyeSBvdGhlciBhbWJpZ3VpdHkgXHUyMDE0IGFuIEkvTy9wZXJtaXNzaW9uIGVycm9yLCBhbiB1bnJlYWRhYmxlXG4gKiBwYXRoLCBhIHRvcm4vZW1wdHkvcGFydGlhbC91bnBhcnNlYWJsZSBmaWxlIFx1MjAxNCAqKnRocm93cyoqLCBzbyB0aGUgY2FsbGVyXG4gKiAoc3RvcC50cyBTdGVwIDAuNSkgc3VwcHJlc3NlcyBkaXNwYXRjaCByYXRoZXIgdGhhbiBkaXNwYXRjaGluZyBvbiBhIHZhbHVlIGl0XG4gKiBjYW5ub3QgY29uZmlkZW50bHkgY29uZmlybS4gVGhpcyBkZWxpYmVyYXRlbHkgZG9lcyBOT1Qgc3dhbGxvdyBlcnJvcnMgdG8gMDtcbiAqIGRvaW5nIHNvIHdvdWxkIG1ha2Ugc3RvcC50cydzIGZhaWwtY2xvc2VkIGNhdGNoIGRlYWQgY29kZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlYWRTdWJhZ2VudENvdW50KHNlc3Npb25JZDogc3RyaW5nKTogbnVtYmVyIHtcbiAgcmV0dXJuIHJlYWRDb3VudFJhdyhzdWJhZ2VudENvdW50UGF0aChzZXNzaW9uSWQpKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGUgKHNoYXJlZCB3aXRoIHF1ZXVlIHJlY29yZCB0eXBlcylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgcmVjb3JkIHR5cGVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBQcmVDb21taXRSZWNvcmQge1xuICBhbmNob3JzOiBBbmNob3JTcGVjW107XG4gIGNyZWF0ZWRfYXQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQb3N0Q29tbWl0UmVjb3JkIGV4dGVuZHMgUHJlQ29tbWl0UmVjb3JkIHtcbiAgc2hhOiBzdHJpbmc7XG4gIGJyYW5jaDogc3RyaW5nO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFF1ZXVlIGRpcmVjdG9yeSBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBnaXQgY29tbW9uIGRpcmVjdG9yeSBmb3IgdGhlIGdpdmVuIHJlcG8gcm9vdC5cbiAqIFRoaXMgaXMgdGhlIHNoYXJlZCBkaXJlY3RvcnkgKG5vdCB0aGUgd29ya3RyZWUtc3BlY2lmaWMgLmdpdCksIHNvIHF1ZXVlXG4gKiByZWNvcmRzIHN1cnZpdmUgd29ya3RyZWUgZGVsZXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3Jldi1wYXJzZScsICctLWdpdC1jb21tb24tZGlyJ10sIHtcbiAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICBlbmNvZGluZzogJ3V0ZjgnXG4gIH0pO1xuICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKTtcbiAgLy8gZ2l0IHJldHVybnMgYSByZWxhdGl2ZSBwYXRoIChlLmcuIFwiLmdpdFwiKSBmb3Igc2ltcGxlIHJlcG9zLiBSZXNvbHZlIGl0XG4gIC8vIGFnYWluc3QgcmVwb1Jvb3Qgc28gY2FsbGVycyBuZXZlciBkZXBlbmQgb24gcHJvY2Vzcy5jd2QoKS5cbiAgaWYgKCFub2RlUGF0aC5pc0Fic29sdXRlKHRyaW1tZWQpKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgobm9kZVBhdGgucmVzb2x2ZShyZXBvUm9vdCwgdHJpbW1lZCkpO1xuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJvb3Qgb2YgdGhlIGdpdC1zcGFuIHF1ZXVlIGRpcmVjdG9yeSB0cmVlLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWV1ZVJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3QpLCAnZ2l0LXNwYW4nKTtcbn1cblxuLyoqIERpcmVjdG9yeSBmb3IgcHJlLWNvbW1pdCByZWNvcmRzICh3cml0dGVuIGJ5IHRoZSBTdG9wIGhvb2spLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbW1pdERpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ3ByZS1jb21taXQnKTtcbn1cblxuLyoqIERpcmVjdG9yeSBmb3IgcG9zdC1jb21taXQgcmVjb3JkcyAocHJvbW90ZWQgZnJvbSBwcmUtY29tbWl0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tbWl0RGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAncG9zdC1jb21taXQnKTtcbn1cblxuLyoqIERpcmVjdG9yeSBmb3IgY2xhaW1lZCByZWNvcmRzIChwaWNrZWQgdXAgYnkgdGhlIGRpc3BhdGNoZXIpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsYWltZWREaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHBvc3RDb21taXREaXIocmVwb1Jvb3QpLCAnY2xhaW1lZCcpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgYSBzaW5nbGUgY2xhaW0gc2Vzc2lvbidzIHJlY29yZHMsIHNjb3BlZCBieSBjbGFpbSBJRC5cbiAqIEEgY2xhaW0gSUQgaXMgYSBVVUlEIHNoYXJlZCBiZXR3ZWVuIHRoZSBjbGFpbSBkaXJlY3RvcnkgbmFtZSBhbmQgdGhlXG4gKiByZWNvbmNpbGVyIGFnZW50J3Mgb3duIGAtLXJlc3VtZWAgc2Vzc2lvbiBpZCwgc28gdGhlIHR3byBhbHdheXMgbWF0Y2guXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGFpbURpckZvcihyZXBvUm9vdDogc3RyaW5nLCBjbGFpbUlkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihjbGFpbWVkRGlyKHJlcG9Sb290KSwgY2xhaW1JZCk7XG59XG5cbi8qKiBEaXJlY3RvcnkgZm9yIHNjcmF0Y2ggd29ya3RyZWVzIGNyZWF0ZWQgYnkgdGhlIGRpc3BhdGNoZXIuICovXG5leHBvcnQgZnVuY3Rpb24gc2NyYXRjaERpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ3NjcmF0Y2gnKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRdWV1ZSBsb2NrXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBBY3F1aXJlIGFuIGV4Y2x1c2l2ZSBxdWV1ZSBsb2NrLlxuICpcbiAqIFNwaW5zIHdpdGggTE9DS19SRVRSWV9JTlRFUlZBTF9NUyBzbGVlcHMgdXAgdG8gTE9DS19NQVhfUkVUUklFUyBhdHRlbXB0cy5cbiAqIEEgbG9jayB3aG9zZSBtdGltZSBpcyBvbGRlciB0aGFuIExPQ0tfU1RBTEVfTVMgaXMgdHJlYXRlZCBhcyBhYmFuZG9uZWQgYW5kXG4gKiByZWNsYWltZWQgYXRvbWljYWxseSB2aWEgcmVuYW1lICsgdW5saW5rIChzYW1lIHBhdHRlcm4gYXMgYWNxdWlyZUxvY2spLlxuICovXG5mdW5jdGlvbiBhY3F1aXJlUXVldWVMb2NrKGxvY2tQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgYXR0ZW1wdHMgPSAwO1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBmZCA9IGZzLm9wZW5TeW5jKGxvY2tQYXRoLCAnd3gnKTtcbiAgICAgIGZzLmNsb3NlU3luYyhmZCk7XG4gICAgICByZXR1cm4gbG9ja1BhdGg7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBlID0gZXJyIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbjtcbiAgICAgIGlmIChlLmNvZGUgIT09ICdFRVhJU1QnKSB0aHJvdyBlcnI7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMobG9ja1BhdGgpO1xuICAgICAgICBpZiAoRGF0ZS5ub3coKSAtIHN0YXQubXRpbWVNcyA+IExPQ0tfU1RBTEVfTVMpIHtcbiAgICAgICAgICBjb25zdCBzaWRlbGluZSA9IGAke2xvY2tQYXRofS5zdGFsZS4ke3Byb2Nlc3MucGlkfS4ke3JhbmRvbVVVSUQoKX1gO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBmcy5yZW5hbWVTeW5jKGxvY2tQYXRoLCBzaWRlbGluZSk7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBmcy51bmxpbmtTeW5jKHNpZGVsaW5lKTtcbiAgICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgICB2b2lkIDA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICB2b2lkIDA7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoKythdHRlbXB0cyA+PSBMT0NLX01BWF9SRVRSSUVTKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgd2l0aFF1ZXVlTG9jazogY291bGQgbm90IGFjcXVpcmUgbG9jayBhZnRlciAke0xPQ0tfTUFYX1JFVFJJRVN9IHJldHJpZXNgKTtcbiAgICAgIH1cbiAgICAgIEF0b21pY3Mud2FpdChuZXcgSW50MzJBcnJheShuZXcgU2hhcmVkQXJyYXlCdWZmZXIoNCkpLCAwLCAwLCBMT0NLX1JFVFJZX0lOVEVSVkFMX01TKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBFeGVjdXRlIGEgZnVuY3Rpb24gdW5kZXIgdGhlIGV4Y2x1c2l2ZSBxdWV1ZSBsb2NrLlxuICogVGhlIGxvY2sgZmlsZSBpcyBhdCBgPHF1ZXVlUm9vdChyZXBvUm9vdCk+Ly5xdWV1ZS5sb2NrYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdpdGhRdWV1ZUxvY2s8VD4ocmVwb1Jvb3Q6IHN0cmluZywgZm46ICgpID0+IFQpOiBUIHtcbiAgY29uc3QgcVJvb3QgPSBxdWV1ZVJvb3QocmVwb1Jvb3QpO1xuICBjb25zdCBsb2NrUGF0aCA9IG5vZGVQYXRoLmpvaW4ocVJvb3QsICcucXVldWUubG9jaycpO1xuICBmcy5ta2RpclN5bmMocVJvb3QsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICBjb25zdCBhY3F1aXJlZFBhdGggPSBhY3F1aXJlUXVldWVMb2NrKGxvY2tQYXRoKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZm4oKTtcbiAgfSBmaW5hbGx5IHtcbiAgICB0cnkge1xuICAgICAgZnMudW5saW5rU3luYyhhY3F1aXJlZFBhdGgpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHZvaWQgZTtcbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBdG9taWMgcmVjb3JkIEkvT1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVhZCBhbmQgcGFyc2UgYSBKU09OIGZpbGUuXG4gKiBQcm9wYWdhdGVzIEVOT0VOVCBvciBwYXJzZSBlcnJvcnMgdG8gdGhlIGNhbGxlci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlYWRKc29uRmlsZTxUPihwYXRoOiBzdHJpbmcpOiBUIHtcbiAgY29uc3QgcmF3ID0gZnMucmVhZEZpbGVTeW5jKHBhdGgsICd1dGY4Jyk7XG4gIHJldHVybiBKU09OLnBhcnNlKHJhdykgYXMgVDtcbn1cblxuLyoqXG4gKiBBdG9taWNhbGx5IHdyaXRlIGEgSlNPTiBmaWxlIHVzaW5nIHRtcCtyZW5hbWUuXG4gKiBUaGUgdGVtcCBuYW1lIGNhcnJpZXMgdGhlIHBpZCBhbmQgYSB1dWlkIHNvIGNvbmN1cnJlbnQgd3JpdGVycyBuZXZlciBjb2xsaWRlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVKc29uRmlsZUF0b21pYzxUPihwYXRoOiBzdHJpbmcsIGRhdGE6IFQpOiB2b2lkIHtcbiAgY29uc3QgdG1wUGF0aCA9IGAke3BhdGh9LnRtcC4ke3Byb2Nlc3MucGlkfS4ke3JhbmRvbVVVSUQoKX1gO1xuICB0cnkge1xuICAgIGZzLndyaXRlRmlsZVN5bmModG1wUGF0aCwgSlNPTi5zdHJpbmdpZnkoZGF0YSksICd1dGY4Jyk7XG4gICAgZnMucmVuYW1lU3luYyh0bXBQYXRoLCBwYXRoKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdHJ5IHtcbiAgICAgIGZzLnVubGlua1N5bmModG1wUGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICB2b2lkIDA7XG4gICAgfVxuICAgIHRocm93IGVycjtcbiAgfVxufVxuXG4vKipcbiAqIEF0b21pY2FsbHkgbW92ZSAocmVuYW1lKSBhIHJlY29yZCBmaWxlIGZyb20gb25lIGRpcmVjdG9yeSB0byBhbm90aGVyLlxuICogQm90aCBwYXRocyBtdXN0IHJlc2lkZSBvbiB0aGUgc2FtZSBmaWxlc3lzdGVtIChndWFyYW50ZWVkIHdpdGhpbiB0aGUgcXVldWUpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbW92ZVJlY29yZChmcm9tOiBzdHJpbmcsIHRvOiBzdHJpbmcpOiB2b2lkIHtcbiAgZnMucmVuYW1lU3luYyhmcm9tLCB0byk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHJlLWNvbW1pdCByZWNvcmQgd3JpdGVyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBXcml0ZSBhIHByZS1jb21taXQgcmVjb3JkIHRvIHRoZSBxdWV1ZSBkaXJlY3RvcnkuXG4gKiBUaGUgZmlsZSBpcyB3cml0dGVuIGF0b21pY2FsbHkgKHRtcCtyZW5hbWUpIHdpdGggYSByYW5kb20gVVVJRCBmaWxlbmFtZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdyaXRlUHJlQ29tbWl0UmVjb3JkKHJlcG9Sb290OiBzdHJpbmcsIHJlY29yZDogUHJlQ29tbWl0UmVjb3JkKTogdm9pZCB7XG4gIGNvbnN0IGRpciA9IHByZUNvbW1pdERpcihyZXBvUm9vdCk7XG4gIGZzLm1rZGlyU3luYyhkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICBjb25zdCBwYXRoID0gbm9kZVBhdGguam9pbihkaXIsIGAke3JhbmRvbVVVSUQoKX0uanNvbmApO1xuICB3cml0ZUpzb25GaWxlQXRvbWljKHBhdGgsIHJlY29yZCk7XG59XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHNwYW4tc3VyZmFjaW5nIGNvcmUuXG4gKlxuICogR2l2ZW4gYW4gYWxyZWFkeS1yZXNvbHZlZCByZXBvLXJlbGF0aXZlIHBhdGggYW5kIGEgbGluZSByYW5nZSwgdGhpcyBtb2R1bGVcbiAqIHJ1bnMgdGhlIHNoYXJlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgLyBgLmhvb2tpZ25vcmVgIC8gc2Vzc2lvbi1tZW1vIC9cbiAqIGBnaXQgc3BhbiBzdGFsZWAgcGlwZWxpbmUgYW5kIGFzc2VtYmxlcyB0aGUgaHVtYW4tcmVhZGFibGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmBcbiAqIGJsb2NrIHRoYXQgYm90aCBhZGFwdGVycyBzdXJmYWNlIGlubGluZSBiZWZvcmUgYW4gZWRpdC4gSXQgaW1wb3J0cyBub3RoaW5nXG4gKiBmcm9tIGVpdGhlciBob29rIFNESzogdGhlIENsYXVkZSBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgYSByYW5nZSBkZXJpdmVkIGZyb21cbiAqIGBmaWxlX3BhdGhgL2BvZmZzZXRgL2BvbGRfc3RyaW5nYDsgdGhlIENvZGV4IFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCB0aGVcbiAqIHJhbmdlcyByZWNvdmVyZWQgZnJvbSBhbiBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlLiBFYWNoIGFkYXB0ZXIgd3JhcHMgdGhlXG4gKiByZXR1cm5lZCBibG9jayBzdHJpbmcgaW4gaXRzIG93biBTREsgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogVGhlIGV4ZWN1dG9yL3N0YWxlL21lbW8gZGVwZW5kZW5jaWVzIGFyZSBpbmplY3RlZCBzbyB0aGUgcGlwZWxpbmUgaXMgdGVzdGFibGVcbiAqIHdpdGggZmFrZXMgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGUgc2hhcmVkIGtlcm5lbC5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBpc0dpdElnbm9yZWQsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHBhcnNlU3RhbGVQb3JjZWxhaW4sXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290LFxuICBzYW5pdGl6ZVNlc3Npb25JZCxcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyB0eXBlIEhvb2tJZ25vcmVMb2FkZXIsIGlzU3BhblN1cHByZXNzZWQgfSBmcm9tICcuL3NwYW4taWdub3JlLmpzJztcbmltcG9ydCB0eXBlIHsgQ29yZUxvZ2dlciB9IGZyb20gJy4vc3RvcC1jb3JlLmpzJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTcGFuIGV4ZWN1dG9yIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBFeGVjdXRlcyBgZ2l0IHNwYW4gbGlzdGAgd2l0aCBnaXZlbiBhcmdzIGluIGEgZ2l2ZW4gY3dkLlxuICogUmV0dXJucyBzdGRvdXQgc3RyaW5nLiBUaHJvd3Mgb24gbm9uLXplcm8gZXhpdC5cbiAqL1xuZXhwb3J0IHR5cGUgU3BhbkV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBTcGFuRXhlY3V0b3Ige1xuICByZXR1cm4gKGFyZ3MsIGN3ZCkgPT4ge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4uYXJnc10sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW5zIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW4gPHNsdWdzPmAgYW5kIHJldHVybnMgaXRzIHBvcmNlbGFpbiBzdGRvdXQgXHUyMDE0XG4gKiBvbmUgcm93IHBlciAqZHJpZnRlZCogYW5jaG9yIGFtb25nIHRoZSBnaXZlbiBzcGFucywgZW1wdHkgd2hlbiBhbGwgYXJlIGNsZWFuLlxuICogYGdpdCBzcGFuIHN0YWxlYCBleGl0cyAwIGluIHBvcmNlbGFpbiBtb2RlIHdoZXRoZXIgb3Igbm90IGRyaWZ0IGV4aXN0cywgYnV0IHdlXG4gKiBzdGlsbCBjYXB0dXJlIHN0ZG91dCBmcm9tIGEgdGhyb3duIGVycm9yIHNvIGEgZHJpZnQgc2lnbmFsIGlzIG5ldmVyIGxvc3QgdG8gYVxuICogbm9uLXplcm8gZXhpdC4gVGhyb3dzIG9ubHkgd2hlbiBubyBzdGRvdXQgaXMgYXZhaWxhYmxlIChnZW51aW5lIGZhaWx1cmUpLlxuICovXG5leHBvcnQgdHlwZSBTdGFsZUV4ZWN1dG9yID0gKHNsdWdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRTdGFsZUV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IFN0YWxlRXhlY3V0b3Ige1xuICByZXR1cm4gKHNsdWdzLCBjd2QpID0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNsdWdzXSwge1xuICAgICAgICBjd2QsXG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgaWYgKHR5cGVvZiBvdXQgPT09ICdzdHJpbmcnKSByZXR1cm4gb3V0O1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIG1lbW8gYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lbW9TdG9yZSB7XG4gIGdldFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nKTogU2V0PHN0cmluZz47XG4gIGFkZFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nLCBuYW1lczogc3RyaW5nW10pOiB2b2lkO1xufVxuXG5jb25zdCBNRU1PX0RJUiA9IG5vZGVQYXRoLmpvaW4ob3MudG1wZGlyKCksICdhZ2VudC1ob29rcy1naXQtc3BhbicpO1xuXG5mdW5jdGlvbiBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihNRU1PX0RJUiwgYCR7c2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkKX0uanNvbmApO1xufVxuXG5leHBvcnQgdHlwZSBNZW1vTG9nZ2VyID0gQ29yZUxvZ2dlcjtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURpc2tNZW1vU3RvcmUobG9nZ2VyOiBNZW1vTG9nZ2VyKTogTWVtb1N0b3JlIHtcbiAgcmV0dXJuIHtcbiAgICBnZXRTdXJmYWNlZChzZXNzaW9uSWQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJhdyA9IGZzLnJlYWRGaWxlU3luYyhtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKSwgJ3V0ZjgnKTtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHsgc3VyZmFjZWQ/OiB1bmtub3duIH07XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZC5zdXJmYWNlZCkpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IFNldChwYXJzZWQuc3VyZmFjZWQgYXMgc3RyaW5nW10pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gcmVhZCBmYWlsZWQgKHRyZWF0aW5nIGFzIGVtcHR5KScsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBTZXQoKTtcbiAgICB9LFxuICAgIGFkZFN1cmZhY2VkKHNlc3Npb25JZCwgbmFtZXMpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICAgICAgZm9yIChjb25zdCBuIG9mIG5hbWVzKSBleGlzdGluZy5hZGQobik7XG4gICAgICBjb25zdCBtZW1vUGF0aCA9IG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgdG1wUGF0aCA9IGAke21lbW9QYXRofS50bXBgO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKE1FTU9fRElSLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBKU09OLnN0cmluZ2lmeSh7IHN1cmZhY2VkOiBbLi4uZXhpc3RpbmddIH0pLCAndXRmOCcpO1xuICAgICAgICBmcy5yZW5hbWVTeW5jKHRtcFBhdGgsIG1lbW9QYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyB3cml0ZSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKiBGYWN0b3J5IGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyBhIE1lbW9TdG9yZSBnaXZlbiBhIGxvZ2dlci4gKi9cbmV4cG9ydCB0eXBlIE1lbW9GYWN0b3J5ID0gKGxvZ2dlcjogTWVtb0xvZ2dlcikgPT4gTWVtb1N0b3JlO1xuXG4vKiogRGVmYXVsdCBkaXNrLWJhY2tlZCBtZW1vIGZhY3RvcnkgdXNlZCBpbiBwcm9kdWN0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2tNZW1vRmFjdG9yeShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXIpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIHNjb3BlIHJlc29sdXRpb24gKHJlcG8tc2NvcGluZyArIGdpdGlnbm9yZSArIHNwYW4tcm9vdCBndWFyZHMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBUb3VjaFNjb3BlIHtcbiAgcmVwb1Jvb3Q6IHN0cmluZztcbiAgcmVwb1JlbFBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCb3VuZCBhIHRvdWNoZWQgZmlsZSB0byB0aGUgQ1dEIHJlcG8uIFJlc29sdmUgdGhlIHJlcG8gcm9vdCBvZiB0aGUgY3VycmVudFxuICogd29ya2luZyBkaXJlY3RvcnkgYW5kIHJlcXVpcmUgdGhlIHRvdWNoZWQgZmlsZSB0byByZXNvbHZlIHRvIHRoZSBTQU1FIHJlcG9cbiAqIHJvb3Q7IGRyb3AgZmlsZXMgaW4gYSBkaWZmZXJlbnQgcmVwb3NpdG9yeS93b3JrdHJlZSwgZ2l0aWdub3JlZCBmaWxlcywgYW5kXG4gKiBmaWxlcyB1bmRlciB0aGUgc3BhbiByb290LiBSZXR1cm5zIHRoZSByZXNvbHZlZCBgeyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfWBcbiAqIG9yIG51bGwgd2hlbiB0aGUgdG91Y2ggaXMgb3V0IG9mIHNjb3BlLlxuICpcbiAqIENvbXBhcmluZyByZXNvbHZlZCBgZ2l0IC0tc2hvdy10b3BsZXZlbGAgdG9wbGV2ZWxzIChub3QgcGF0aCBwcmVmaXhlcylcbiAqIGRpc3Rpbmd1aXNoZXMgc2VwYXJhdGUgcmVwb3MgYW5kIHdvcmt0cmVlcyBhbmQgaXMgcm9idXN0IHRvIHN5bWxpbmtzLiBGYWlsXG4gKiBjbG9zZWQ6IGlmIHRoZSBDV0QgcmVwbyBjYW4ndCBiZSByZXNvbHZlZCwgdGhlIHRvdWNoIGlzIGRyb3BwZWQgcmF0aGVyIHRoYW5cbiAqIGZhbGxpbmcgYmFjayB0byB0aGUgZmlsZSdzIG93biByZXBvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IFRvdWNoU2NvcGUgfCBudWxsIHtcbiAgY29uc3QgY3dkUmVwb1Jvb3QgPSBjd2QgPyByZXNvbHZlUmVwb1Jvb3QoY3dkKSA6IG51bGw7XG4gIGlmICghY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFic0RpciA9IHRvUG9zaXgobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSk7XG4gIGNvbnN0IGZpbGVSZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChhYnNEaXIpO1xuICBpZiAoZmlsZVJlcG9Sb290ICE9PSBjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgcmVwb1Jvb3QgPSBjd2RSZXBvUm9vdDtcbiAgY29uc3QgcmVwb1JlbFBhdGggPSByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYWJzUGF0aCk7XG5cbiAgLy8gU2tpcCBnaXRpZ25vcmVkIGZpbGVzIGVudGlyZWx5LiBCdWlsZCBvdXRwdXQsIGNhY2hlcywgYW5kIGxvZ3MgYXJlIG5vdFxuICAvLyBzcGFuLXJlbGV2YW50OiB0aGV5IG11c3QgbmV2ZXIgZW50ZXIgdGhlIGpvdXJuYWwgbm9yIHN1cmZhY2Ugc3BhbiBvdmVybGFwcy5cbiAgaWYgKGlzR2l0SWdub3JlZChyZXBvUm9vdCwgcmVwb1JlbFBhdGgpKSByZXR1cm4gbnVsbDtcblxuICAvLyBTa2lwIHNwYW4gZG9jdW1lbnRzIGVudGlyZWx5LiBGaWxlcyB1bmRlciB0aGUgcmVzb2x2ZWQgc3BhbiByb290IGFyZSBtYW5hZ2VkXG4gIC8vIGJ5IGdpdCBzcGFuIGl0c2VsZiBhbmQgYXJlIG5vdCBhcHBsaWNhdGlvbiBzb3VyY2VzIHRoYXQgbmVlZCBzcGFuIGNvdmVyYWdlLlxuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIGlmIChpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoLCBzcGFuUm9vdCkpIHJldHVybiBudWxsO1xuXG4gIHJldHVybiB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFN1cmZhY2Ugcm91dGluZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBJbmplY3RlZCBkZXBlbmRlbmNpZXMgZm9yIHtAbGluayBzdXJmYWNlT3ZlcmxhcHBpbmdTcGFuc30uICovXG5leHBvcnQgaW50ZXJmYWNlIFN1cmZhY2VEZXBzIHtcbiAgZXhlY3V0b3I6IFNwYW5FeGVjdXRvcjtcbiAgc3RhbGVFeGVjdXRvcjogU3RhbGVFeGVjdXRvcjtcbiAgbWVtbzogTWVtb1N0b3JlO1xuICBsb2FkUnVsZXM6IEhvb2tJZ25vcmVMb2FkZXI7XG4gIGxvZ2dlcjogQ29yZUxvZ2dlcjtcbn1cblxuLyoqXG4gKiBHaXZlbiBhIHJlcG8tcmVsYXRpdmUgcGF0aCBhbmQgdGhlIGxpbmUgcmFuZ2UgYmVpbmcgdG91Y2hlZCB3aXRoaW4gYW5cbiAqIGFscmVhZHktcmVzb2x2ZWQgcmVwbywgcHJvZHVjZSB0aGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmAgYmxvY2sgZm9yIHRoZVxuICogc3BhbnMgb3ZlcmxhcHBpbmcgdGhhdCByYW5nZSwgb3IgbnVsbCB3aGVuIHRoZXJlIGlzIG5vdGhpbmcgdG8gc3VyZmFjZS5cbiAqXG4gKiBUaGUgcGlwZWxpbmU6IGBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpbmAgXHUyMTkyIGtlZXAgbGluZS1yYW5nZWQgYW5jaG9ycyBvblxuICogdGhlIHNhbWUgZmlsZSB0aGF0IGludGVyc2VjdCB0aGUgcmFuZ2UgYW5kIGFyZSBub3QgYC5ob29raWdub3JlYC1zdXBwcmVzc2VkIFx1MjE5MlxuICogZHJvcCBzbHVncyBhbHJlYWR5IHN1cmZhY2VkIHRoaXMgc2Vzc2lvbiAobWVtbykgXHUyMTkyIHJlbmRlciBgZ2l0IHNwYW4gbGlzdFxuICogPG5hbWVzXHUyMDI2PmAgXHUyMTkyIGFwcGVuZCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlciBmb3IgYW55IGFscmVhZHktc3RhbGVcbiAqIHNwYW4uIE9uIHN1Y2Nlc3MgdGhlIHN1cmZhY2VkIG5hbWVzIGFyZSByZWNvcmRlZCBpbiB0aGUgbWVtby4gRXhlY3V0b3IgYW5kXG4gKiBzdGFsZS1wcm9iZSBmYWlsdXJlcyBhcmUgbG9nZ2VkIGFuZCBkZWdyYWRlIHRvIG51bGwgLyB0aGUgcGxhaW4gYmxvY2s7IHRoZXlcbiAqIG5ldmVyIHRocm93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnMoXG4gIGRlcHM6IFN1cmZhY2VEZXBzLFxuICByZXBvUm9vdDogc3RyaW5nLFxuICByZXBvUmVsUGF0aDogc3RyaW5nLFxuICByYW5nZTogTGluZVJhbmdlLFxuICBzZXNzaW9uSWQ6IHN0cmluZ1xuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHsgZXhlY3V0b3IsIHN0YWxlRXhlY3V0b3IsIG1lbW8sIGxvYWRSdWxlcywgbG9nZ2VyIH0gPSBkZXBzO1xuXG4gIC8vIEZpbHRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpblxuICBsZXQgcG9yY2VsYWluU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcG9yY2VsYWluU3Rkb3V0ID0gZXhlY3V0b3IoWyctLXBvcmNlbGFpbicsIHJlcG9SZWxQYXRoXSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIFBhdGgtc2NvcGVkIHN1cHByZXNzaW9uOiBhIHJlcG8ncyAuc3Bhbi8uaG9va2lnbm9yZSBjYW4gaG9sZCBiYWNrIHNwYW4gc2x1Z1xuICAvLyBwcmVmaXhlcyBmb3IgYW5jaG9ycyB1bmRlciBnaXZlbiBwYXRocy4gQSBzdXBwcmVzc2VkIHNwYW4gaXMgbmV2ZXIgc3VyZmFjZWQuXG4gIGNvbnN0IGlnbm9yZVJ1bGVzID0gbG9hZFJ1bGVzKHJlcG9Sb290KTtcblxuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IHBhcnNlUG9yY2VsYWluKHBvcmNlbGFpblN0ZG91dCk7XG4gIGNvbnN0IGNhbmRpZGF0ZU5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBpZiAocm93LnBhdGggIT09IHJlcG9SZWxQYXRoKSBjb250aW51ZTtcbiAgICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIGNvbnRpbnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICAgIGlmICghcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KSkgY29udGludWU7XG4gICAgaWYgKGlzU3BhblN1cHByZXNzZWQoaWdub3JlUnVsZXMsIHJvdy5wYXRoLCByb3cubmFtZSkpIGNvbnRpbnVlO1xuICAgIGNhbmRpZGF0ZU5hbWVzLmFkZChyb3cubmFtZSk7XG4gIH1cblxuICBpZiAoY2FuZGlkYXRlTmFtZXMuc2l6ZSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU3VidHJhY3QgYWxyZWFkeS1zdXJmYWNlZCBuYW1lc1xuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9TdXJmYWNlID0gWy4uLmNhbmRpZGF0ZU5hbWVzXS5maWx0ZXIoKG4pID0+ICFzdXJmYWNlZC5oYXMobikpLnNvcnQoKTtcbiAgaWYgKHRvU3VyZmFjZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFJlbmRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxuYW1lMT4gPG5hbWUyPiAuLi5cbiAgbGV0IHJlbmRlclN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHJlbmRlclN0ZG91dCA9IGV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAocmVuZGVyKSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE9mIHRoZSBzcGFucyBiZWluZyBzdXJmYWNlZCwgZmxhZyBhbnkgYWxyZWFkeSBzdGFsZSBcdTIwMTQgdGhlIHRvdWNoZWQgbGluZXMgaGF2ZVxuICAvLyBkcmlmdGVkIGZyb20gdGhlaXIgYW5jaG9yZWQgc3RhdGUgXHUyMDE0IHdpdGggYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIuXG4gIC8vIERldGVjdGlvbiBpcyBhcy1vZi1ub3cgKHN1cmZhY2luZyBydW5zIGJlZm9yZSB0aGUgZWRpdCBhcHBsaWVzKSwgc28gdGhpc1xuICAvLyBjYXRjaGVzIHByZS1leGlzdGluZyBkcmlmdDsgZHJpZnQgdGhpcyBzZXNzaW9uIGNhdXNlcyBpcyB0aGUgU3RvcCBob29rJ3Mgam9iLlxuICAvLyBGYWlsdXJlIHRvIGNvbXB1dGUgc3RhbGVuZXNzIGlzIG5vbi1mYXRhbDogZmFsbCBiYWNrIHRvIHRoZSBwbGFpbiBibG9jay5cbiAgbGV0IHN0YWxlSGludCA9ICcnO1xuICB0cnkge1xuICAgIGNvbnN0IHN0YWxlTmFtZXMgPSBuZXcgU2V0KHBhcnNlU3RhbGVQb3JjZWxhaW4oc3RhbGVFeGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KSkubWFwKChyKSA9PiByLm5hbWUpKTtcbiAgICBjb25zdCBzdGFsZVN1cmZhY2VkID0gdG9TdXJmYWNlLmZpbHRlcigobikgPT4gc3RhbGVOYW1lcy5oYXMobikpO1xuICAgIGlmIChzdGFsZVN1cmZhY2VkLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGxpbmVzID0gc3RhbGVTdXJmYWNlZC5tYXAoKG4pID0+IGAgIGdpdCBzcGFuIGhpc3RvcnkgJHtufWApLmpvaW4oJ1xcbicpO1xuICAgICAgc3RhbGVIaW50ID0gYFxcblN0YWxlIFx1MjAxNCB0aGUgbGluZXMgeW91J3JlIHRvdWNoaW5nIGhhdmUgZHJpZnRlZCBmcm9tIHRoZXNlIHNwYW5zJyBhbmNob3JlZCBzdGF0ZS4gUmV2aWV3IGhvdyBlYWNoIHN1YnN5c3RlbSBldm9sdmVkIGJlZm9yZSBjaGFuZ2luZyBpdDpcXG4ke2xpbmVzfWA7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gc3RhbGUgKGhpc3RvcnkgaGludCkgZmFpbGVkJywgeyBlcnIgfSk7XG4gIH1cblxuICBjb25zdCB3cmFwcGVkID0gYFxcbjxnaXQtc3Bhbj5cXG4ke3JlbmRlclN0ZG91dH0ke3N0YWxlSGludH1cXG48L2dpdC1zcGFuPlxcbmA7XG5cbiAgLy8gVXBkYXRlIG1lbW9cbiAgbWVtby5hZGRTdXJmYWNlZChzZXNzaW9uSWQsIHRvU3VyZmFjZSk7XG5cbiAgcmV0dXJuIHdyYXBwZWQ7XG59XG4iLCAiLyoqXG4gKiBQYXRoLXNjb3BlZCBzcGFuIHN1cHByZXNzaW9uIGZvciB0aGUgYWdlbnQgaG9va3MuXG4gKlxuICogU29tZSBzcGFucyBhcmUgbm9pc2Ugd2hlbiBicm93c2luZyBjZXJ0YWluIHBhcnRzIG9mIHRoZSB0cmVlIFx1MjAxNCB3aWtpIG9yXG4gKiBtYXJrZXRpbmcgc3BhbnMgdGhhdCBhbmNob3IgcHJvc2UsIHN1cmZhY2VkIGlubGluZSB3aGlsZSByZWFkaW5nIHNvdXJjZSxcbiAqIGFkZCBsaXR0bGUuIFRoaXMgbW9kdWxlIGxldHMgYSByZXBvIGRlY2xhcmUsIHBlciBwYXRoLCB3aGljaCBzcGFuIHNsdWdcbiAqIHByZWZpeGVzIHRvIGhvbGQgYmFjay5cbiAqXG4gKiBDb25maWcgbGl2ZXMgYXQgYDxyZXBvUm9vdD4vLnNwYW4vLmhvb2tpZ25vcmVgLiBFYWNoIG5vbi1jb21tZW50IGxpbmUgaXMgYVxuICogZ2l0aWdub3JlLXN0eWxlIHBhdGggcGF0dGVybiwgYSBzaW5nbGUgcnVuIG9mIHdoaXRlc3BhY2UsIHRoZW4gYVxuICogY29tbWEtc2VwYXJhdGVkIGxpc3Qgb2Ygc3BhbiBzbHVnIHByZWZpeGVzIHRvIHN1cHByZXNzIGZvciBwYXRocyB0aGUgcGF0dGVyblxuICogbWF0Y2hlczpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyYyB3aWtpLG1hcmtldGluZ1xuICpcbiAqIEEgc3BhbiB3aG9zZSBzbHVnIGJlZ2lucyB3aXRoIGB3aWtpYCBvciBgbWFya2V0aW5nYCAodGhlIHNsdWcgZXF1YWxzIHRoZVxuICogcHJlZml4LCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YCkgaXMgdGhlbiBuZXZlciBzdXJmYWNlZCBmb3IgYW4gYW5jaG9yIHdob3NlIHBhdGhcbiAqIHNpdHMgdW5kZXIgYHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyY2AgXHUyMDE0IG5laXRoZXIgaW5saW5lIGJ5IHRoZSBQcmVUb29sVXNlIGhvb2tcbiAqIG5vciBpbiB0aGUgU3RvcCBob29rJ3Mgc3RhbGUgLyByZWxhdGVkIHNlY3Rpb25zLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgcGF0dGVybiBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuXG4gKiBpdCBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqL1xuZnVuY3Rpb24gY29tcGlsZVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW4ge1xuICBsZXQgcGF0ID0gcGF0dGVybjtcbiAgbGV0IGRpck9ubHkgPSBmYWxzZTtcbiAgaWYgKHBhdC5lbmRzV2l0aCgnLycpKSB7XG4gICAgZGlyT25seSA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDAsIC0xKTtcbiAgfVxuICBsZXQgYW5jaG9yZWQgPSBwYXQuaW5jbHVkZXMoJy8nKTtcbiAgaWYgKHBhdC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBhbmNob3JlZCA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDEpO1xuICB9XG4gIGNvbnN0IHJlID0gZ2xvYlRvUmVnRXhwKHBhdCk7XG5cbiAgcmV0dXJuIChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiB7XG4gICAgaWYgKGFuY2hvcmVkKSB7XG4gICAgICBjb25zdCBzZWdzID0gYW5jZXN0b3JQYXRocyhyZXBvUmVsUGF0aCk7XG4gICAgICAvLyBGb3IgYSBkaXItb25seSBwYXR0ZXJuLCBuZXZlciB0ZXN0IHRoZSBsZWFmIGZpbGUgaXRzZWxmLlxuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBzZWdzLnNsaWNlKDAsIC0xKSA6IHNlZ3M7XG4gICAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChzKSA9PiByZS50ZXN0KHMpKTtcbiAgICB9XG4gICAgLy8gVW5hbmNob3JlZDogbWF0Y2ggYWdhaW5zdCBpbmRpdmlkdWFsIHBhdGggY29tcG9uZW50cyBhdCBhbnkgZGVwdGguXG4gICAgY29uc3QgY29tcG9uZW50cyA9IHJlcG9SZWxQYXRoLnNwbGl0KCcvJyk7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBjb21wb25lbnRzLnNsaWNlKDAsIC0xKSA6IGNvbXBvbmVudHM7XG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgoYykgPT4gcmUudGVzdChjKSk7XG4gIH07XG59XG5cbi8qKiBQYXJzZSBgLmhvb2tpZ25vcmVgIHRleHQgaW50byBydWxlcywgc2tpcHBpbmcgY29tbWVudHMgYW5kIG1hbGZvcm1lZCBsaW5lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUhvb2tJZ25vcmUoY29udGVudDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IElnbm9yZVJ1bGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgY29udGVudC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCBsaW5lID0gcmF3TGluZS50cmltKCk7XG4gICAgaWYgKCFsaW5lIHx8IGxpbmUuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICAvLyBgPHBhdHRlcm4+PHdoaXRlc3BhY2U+PHByZWZpeGVzPmAgXHUyMDE0IHBhdHRlcm4gaXMgdGhlIGZpcnN0IHRva2VuLCBwcmVmaXhlc1xuICAgIC8vIHRoZSBzZWNvbmQuIEEgbGluZSB3aXRob3V0IGJvdGggaXMgbWFsZm9ybWVkIGFuZCBza2lwcGVkLlxuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXFMrKVxccysoXFxTKykkLyk7XG4gICAgaWYgKCFtYXRjaCkgY29udGludWU7XG4gICAgY29uc3QgWywgcGF0dGVybiwgcHJlZml4ZXNSYXddID0gbWF0Y2g7XG4gICAgY29uc3QgcHJlZml4ZXMgPSBwcmVmaXhlc1Jhd1xuICAgICAgLnNwbGl0KCcsJylcbiAgICAgIC5tYXAoKHApID0+IHAudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICBpZiAocHJlZml4ZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICBydWxlcy5wdXNoKHsgcGF0dGVybiwgcHJlZml4ZXMsIG1hdGNoZXM6IGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm4pIH0pO1xuICB9XG4gIHJldHVybiBydWxlcztcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBzdXBwcmVzc2lvbiBydWxlcyBmb3IgYSByZXBvLiBGYWlsLW9wZW46IGFueSByZWFkIG9yIHBhcnNlIGZhaWx1cmVcbiAqIHlpZWxkcyBhbiBlbXB0eSBydWxlIHNldCwgc28gc3BhbnMgc3VyZmFjZSBhcyBub3JtYWwgd2hlbiBubyBjb25maWcgZXhpc3RzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbG9hZEhvb2tJZ25vcmUocmVwb1Jvb3Q6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhub2RlUGF0aC5qb2luKHJlcG9Sb290LCBIT09LX0lHTk9SRV9SRUwpLCAndXRmOCcpO1xuICAgIHJldHVybiBwYXJzZUhvb2tJZ25vcmUoY29udGVudCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKiogQSBzbHVnIGNhcnJpZXMgYSBwcmVmaXggd2hlbiBpdCBlcXVhbHMgdGhlIHByZWZpeCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YC4gKi9cbmZ1bmN0aW9uIHNsdWdIYXNQcmVmaXgoc2x1Zzogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gc2x1ZyA9PT0gcHJlZml4IHx8IHNsdWcuc3RhcnRzV2l0aChgJHtwcmVmaXh9L2ApO1xufVxuXG4vKipcbiAqIFRydWUgd2hlbiBhIHNwYW4gYHNsdWdgIHNob3VsZCBiZSBzdXBwcmVzc2VkIGZvciBhbiBhbmNob3IgYXQgYHJlcG9SZWxQYXRoYDpcbiAqIHNvbWUgcnVsZSBtYXRjaGVzIHRoZSBwYXRoIGFuZCBsaXN0cyBhIHByZWZpeCB0aGUgc2x1ZyBjYXJyaWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTcGFuU3VwcHJlc3NlZChydWxlczogSWdub3JlUnVsZVtdLCByZXBvUmVsUGF0aDogc3RyaW5nLCBzbHVnOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBydWxlIG9mIHJ1bGVzKSB7XG4gICAgaWYgKCFydWxlLm1hdGNoZXMocmVwb1JlbFBhdGgpKSBjb250aW51ZTtcbiAgICBpZiAocnVsZS5wcmVmaXhlcy5zb21lKChwKSA9PiBzbHVnSGFzUHJlZml4KHNsdWcsIHApKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU2lnbmF0dXJlIGZvciBpbmplY3RpbmcgYSBydWxlIGxvYWRlciAocHJvZHVjdGlvbiBkZWZhdWx0OiB7QGxpbmsgbG9hZEhvb2tJZ25vcmV9KS4gKi9cbmV4cG9ydCB0eXBlIEhvb2tJZ25vcmVMb2FkZXIgPSAocmVwb1Jvb3Q6IHN0cmluZykgPT4gSWdub3JlUnVsZVtdO1xuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBTdG9wL2pvdXJuYWwgY29yZS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBvd25zIHRoZSBwZXItc2Vzc2lvbiB0b3VjaCBqb3VybmFsIChyZWFkLCB3cml0ZSwgYXBwZW5kKSBhbmQgdGhlXG4gKiBTdG9wLXRpbWUgZHJhaW4gdGhhdCB0dXJucyB1bnJlcG9ydGVkIHdyaXRlIGFuY2hvcnMgaW50byBhIGBQcmVDb21taXRSZWNvcmRgXG4gKiBmb3IgdGhlIGJhY2tncm91bmQgZGlzcGF0Y2hlci4gSXQgaW1wb3J0cyBub3RoaW5nIGZyb20gZWl0aGVyIGhvb2sgU0RLIFx1MjAxNCB0aGVcbiAqIENsYXVkZSBhbmQgQ29kZXggU3RvcCBhZGFwdGVycyBiaW5kIHRoZWlyIFNESy10eXBlZCBgU3RvcElucHV0YC9gSG9va0NvbnRleHRgXG4gKiB0byB0aGUgbWluaW1hbCBzdHJ1Y3R1cmFsIHtAbGluayBTdG9wQ29yZUlucHV0fSAvIHtAbGluayBTdG9wQ29yZUNvbnRleHR9XG4gKiBzaGFwZXMgZGVmaW5lZCBoZXJlIGFuZCBwYXNzIHRoZW0gc3RyYWlnaHQgdGhyb3VnaC5cbiAqXG4gKiBUaGUgYHN0b3BfaG9va19hY3RpdmVgIGd1YXJkIGF0IHRoZSB0b3Agb2YgdGhlIGhhbmRsZXIgc2hvcnQtY2lyY3VpdHMgYVxuICogcmUtZmlyZWQgc3RvcCAodGhlIHJ1biB0aGF0IGRpc3BhdGNoZWQgYWxyZWFkeSBtYXJrZWQgaXRzIGVudHJpZXMgc2Vlbiwgc28gYVxuICogcmUtZmlyZSB3b3VsZCBhc3NlbWJsZSBub3RoaW5nIFx1MjAxNCB0aGlzIGlzIHRoZSBleHBsaWNpdCBndWFyZCkuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICB0eXBlIEFuY2hvclNwZWMsXG4gIHdyaXRlUHJlQ29tbWl0UmVjb3JkIGFzIGRlZmF1bHRXcml0ZVByZUNvbW1pdFJlY29yZCxcbiAgdHlwZSBMaW5lUmFuZ2UsXG4gIHR5cGUgUHJlQ29tbWl0UmVjb3JkLFxuICByZWFkU3ViYWdlbnRDb3VudCxcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICBzYW5pdGl6ZVNlc3Npb25JZCxcbiAgdHlwZSBUb3VjaEtpbmRcbn0gZnJvbSAnLi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHR5cGUgeyBIb29rSWdub3JlTG9hZGVyIH0gZnJvbSAnLi9zcGFuLWlnbm9yZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3RydWN0dXJhbCBoYXJuZXNzLWFnbm9zdGljIGlucHV0L2NvbnRleHQgdHlwZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBtaW5pbWFsIFN0b3AgaW5wdXQgdGhlIGNvcmUgcmVhZHMuIEJvdGggdGhlIENsYXVkZSBhbmQgQ29kZXggU0RLXG4gKiBgU3RvcElucHV0YCBzdHJ1Y3R1cmFsbHkgc2F0aXNmeSB0aGlzIFx1MjAxNCB0aGUgY29yZSBpbXBvcnRzIG5laXRoZXIgU0RLLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFN0b3BDb3JlSW5wdXQge1xuICBzZXNzaW9uX2lkOiBzdHJpbmc7XG4gIGN3ZD86IHN0cmluZztcbiAgc3RvcF9ob29rX2FjdGl2ZT86IGJvb2xlYW47XG59XG5cbi8qKiBNaW5pbWFsIGxvZ2dlciBzdXJmYWNlIHRoZSBjb3JlIHVzZXM7IGJvdGggU0RLIGxvZ2dlcnMgc2F0aXNmeSBpdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29yZUxvZ2dlciB7XG4gIHdhcm4obWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkO1xufVxuXG4vKiogVGhlIG1pbmltYWwgaG9vayBjb250ZXh0IHRoZSBjb3JlIHJlYWRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdG9wQ29yZUNvbnRleHQge1xuICBsb2dnZXI6IENvcmVMb2dnZXI7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVHlwZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEpvdXJuYWxFbnRyeSB7XG4gIHRvb2w6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBraW5kOiBUb3VjaEtpbmQ7XG4gIHNlZW46IGJvb2xlYW47XG4gIHN0YXJ0PzogbnVtYmVyO1xuICBlbmQ/OiBudW1iZXI7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSm91cm5hbCBJL09cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBKT1VSTkFMX0JBU0VfRElSID0gbm9kZVBhdGguam9pbihvcy5ob21lZGlyKCksICcuY2FjaGUnLCAnZ2l0LXNwYW4nLCAnc2Vzc2lvbicpO1xuXG5leHBvcnQgZnVuY3Rpb24gam91cm5hbERpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKEpPVVJOQUxfQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gam91cm5hbFBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihqb3VybmFsRGlyKHNlc3Npb25JZCksICd0b3VjaGVzLmpzb25sJyk7XG59XG5cbi8qKiBUaGUgc2V0IG9mIHZhbGlkIGN1cnJlbnQgVG91Y2hLaW5kIHZhbHVlcy4gQW55IG90aGVyIHN0cmluZyBpcyByZWplY3RlZC4gKi9cbmNvbnN0IFZBTElEX1RPVUNIX0tJTkRTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldDxzdHJpbmc+KFtcbiAgJ3JlYWQnLFxuICAnd3JpdGUnLFxuICAnd2hvbGUtcmVhZCcsXG4gICd3aG9sZS13cml0ZScsXG4gICdjcmVhdGUnXG5dKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRKb3VybmFsKHNlc3Npb25JZDogc3RyaW5nKTogSm91cm5hbEVudHJ5W10gfCBudWxsIHtcbiAgY29uc3QgcGF0aCA9IGpvdXJuYWxQYXRoKHNlc3Npb25JZCk7XG4gIGxldCByYXc6IHN0cmluZztcbiAgdHJ5IHtcbiAgICByYXcgPSBmcy5yZWFkRmlsZVN5bmMocGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgY29uc3QgbGluZXMgPSByYXcuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbiAgaWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGVudHJpZXM6IEpvdXJuYWxFbnRyeVtdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBlID0gSlNPTi5wYXJzZShsaW5lKSBhcyBKb3VybmFsRW50cnk7XG4gICAgICBpZiAodHlwZW9mIGUucGF0aCA9PT0gJ3N0cmluZycgJiYgdHlwZW9mIGUua2luZCA9PT0gJ3N0cmluZycgJiYgVkFMSURfVE9VQ0hfS0lORFMuaGFzKGUua2luZCkpIHtcbiAgICAgICAgZW50cmllcy5wdXNoKGUpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKF8pIHtcbiAgICAgIC8vIHVucGFyc2VhYmxlIGxpbmUgXHUyMDE0IHNraXBcbiAgICAgIHZvaWQgXztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGVudHJpZXMubGVuZ3RoID09PSAwID8gbnVsbCA6IGVudHJpZXM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZUpvdXJuYWwoc2Vzc2lvbklkOiBzdHJpbmcsIGVudHJpZXM6IEpvdXJuYWxFbnRyeVtdLCBsb2dnZXI6IENvcmVMb2dnZXIpOiB2b2lkIHtcbiAgY29uc3QgcGF0aCA9IGpvdXJuYWxQYXRoKHNlc3Npb25JZCk7XG4gIGNvbnN0IHRtcFBhdGggPSBgJHtwYXRofS50bXBgO1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBgJHtlbnRyaWVzLm1hcCgoZSkgPT4gSlNPTi5zdHJpbmdpZnkoZSkpLmpvaW4oJ1xcbicpfVxcbmA7XG4gICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBjb250ZW50LCAndXRmOCcpO1xuICAgIGZzLnJlbmFtZVN5bmModG1wUGF0aCwgcGF0aCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdqb3VybmFsIHJld3JpdGUgZmFpbGVkJywgeyBlcnIgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBBcHBlbmQgdG91Y2ggYW5jaG9ycyB0byB0aGUgcGVyLXNlc3Npb24gam91cm5hbCBcdTIwMTQgdGhlIHdyaXRlLWtpbmQgZW50cmllcyB0aGVcbiAqIFN0b3AgZHJhaW4gbGF0ZXIgY29uc3VtZXMuIFNoYXJlZCBieSBib3RoIGFkYXB0ZXJzOiB0aGUgQ2xhdWRlIFByZVRvb2xVc2UgaG9va1xuICogam91cm5hbHMgcmVhZHMvZWRpdHMvd3JpdGVzIGFzIHRoZXkgYXJlIHJlcXVlc3RlZDsgdGhlIENvZGV4IFBvc3RUb29sVXNlIGhvb2tcbiAqIGpvdXJuYWxzIHRoZSBjb25maXJtZWQgYGFwcGx5X3BhdGNoYCB3cml0ZXMuIEJlc3QtZWZmb3J0OiBhIGZhaWx1cmUgaXMgbG9nZ2VkLFxuICogbmV2ZXIgdGhyb3duLCBzbyBqb3VybmFsaW5nIG5ldmVyIGJsb2NrcyB0aGUgZWRpdC5cbiAqXG4gKiBFYWNoIGFuY2hvcidzIGBwYXRoYCBtdXN0IGFscmVhZHkgYmUgcmVwby1yZWxhdGl2ZS4gT25seSBgcmVhZGAvYHdyaXRlYCBraW5kc1xuICogY2FycnkgYSByYW5nZTsgd2hvbGUtZmlsZSBraW5kcyAoYHdob2xlLXJlYWRgL2B3aG9sZS13cml0ZWAvYGNyZWF0ZWApIGRvIG5vdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGVuZFRvdWNoSm91cm5hbChcbiAgc2Vzc2lvbklkOiBzdHJpbmcsXG4gIHRvb2w6IHN0cmluZyxcbiAgYW5jaG9yczogQXJyYXk8eyBwYXRoOiBzdHJpbmc7IGtpbmQ6IFRvdWNoS2luZDsgcmFuZ2U/OiBMaW5lUmFuZ2UgfT4sXG4gIGxvZ2dlcjogQ29yZUxvZ2dlclxuKTogdm9pZCB7XG4gIGlmIChhbmNob3JzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICB0cnkge1xuICAgIGZzLm1rZGlyU3luYyhqb3VybmFsRGlyKHNlc3Npb25JZCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGNvbnN0IGxpbmVzID0gYW5jaG9ycy5tYXAoKGEpID0+IHtcbiAgICAgIGNvbnN0IHJvdzogSm91cm5hbEVudHJ5ID0geyB0b29sLCBwYXRoOiBhLnBhdGgsIGtpbmQ6IGEua2luZCwgc2VlbjogZmFsc2UgfTtcbiAgICAgIGlmICgoYS5raW5kID09PSAncmVhZCcgfHwgYS5raW5kID09PSAnd3JpdGUnKSAmJiBhLnJhbmdlKSB7XG4gICAgICAgIHJvdy5zdGFydCA9IGEucmFuZ2Uuc3RhcnQ7XG4gICAgICAgIHJvdy5lbmQgPSBhLnJhbmdlLmVuZDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShyb3cpO1xuICAgIH0pO1xuICAgIGZzLmFwcGVuZEZpbGVTeW5jKGpvdXJuYWxQYXRoKHNlc3Npb25JZCksIGAke2xpbmVzLmpvaW4oJ1xcbicpfVxcbmAsICd1dGY4Jyk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdqb3VybmFsIGFwcGVuZCBmYWlsZWQnLCB7IGVyciB9KTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBidWlsZGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQnVpbGQgZGVkdXBsaWNhdGVkIGFuY2hvciBzcGVjcyBmcm9tIGpvdXJuYWwgZW50cmllcy5cbiAqIEdyb3VwcyBieSAocGF0aCwga2luZCk7IGZvciByYW5nZWQga2luZHMgdW5pb24gYWxsIHJhbmdlcy5cbiAqIE9yZGVyOiBzdGFibGUgYnkgZmlyc3QgYXBwZWFyYW5jZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQW5jaG9yU3BlY3MoZW50cmllczogSm91cm5hbEVudHJ5W10pOiBBbmNob3JTcGVjW10ge1xuICAvLyBrZXk6IGAke2tpbmR9OiR7cGF0aH1gXG4gIGNvbnN0IG9yZGVyOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByYW5nZWQgPSBuZXcgTWFwPHN0cmluZywgTGluZVJhbmdlPigpOyAvLyBmb3IgcmVhZC93cml0ZSBraW5kc1xuICBjb25zdCB3aG9sZSA9IG5ldyBTZXQ8c3RyaW5nPigpOyAvLyBmb3Igd2hvbGUtcmVhZC93aG9sZS13cml0ZS9jcmVhdGUga2luZHNcblxuICBmb3IgKGNvbnN0IGUgb2YgZW50cmllcykge1xuICAgIGNvbnN0IGtleSA9IGAke2Uua2luZH06JHtlLnBhdGh9YDtcbiAgICBpZiAoZS5raW5kID09PSAncmVhZCcgfHwgZS5raW5kID09PSAnd3JpdGUnKSB7XG4gICAgICBpZiAoZS5zdGFydCAhPT0gdW5kZWZpbmVkICYmIGUuZW5kICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSByYW5nZWQuZ2V0KGtleSk7XG4gICAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICAgIGV4aXN0aW5nLnN0YXJ0ID0gTWF0aC5taW4oZXhpc3Rpbmcuc3RhcnQsIGUuc3RhcnQpO1xuICAgICAgICAgIGV4aXN0aW5nLmVuZCA9IE1hdGgubWF4KGV4aXN0aW5nLmVuZCwgZS5lbmQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmICghb3JkZXIuaW5jbHVkZXMoa2V5KSkgb3JkZXIucHVzaChrZXkpO1xuICAgICAgICAgIHJhbmdlZC5zZXQoa2V5LCB7IHN0YXJ0OiBlLnN0YXJ0LCBlbmQ6IGUuZW5kIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIHdob2xlLXJlYWQsIHdob2xlLXdyaXRlLCBvciBjcmVhdGVcbiAgICAgIGlmICghd2hvbGUuaGFzKGtleSkpIHtcbiAgICAgICAgd2hvbGUuYWRkKGtleSk7XG4gICAgICAgIGlmICghb3JkZXIuaW5jbHVkZXMoa2V5KSkgb3JkZXIucHVzaChrZXkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvcmRlci5tYXAoKGtleSkgPT4ge1xuICAgIGNvbnN0IGNvbG9uSWR4ID0ga2V5LmluZGV4T2YoJzonKTtcbiAgICBjb25zdCBraW5kID0ga2V5LnNsaWNlKDAsIGNvbG9uSWR4KSBhcyBUb3VjaEtpbmQ7XG4gICAgY29uc3QgcGF0aCA9IGtleS5zbGljZShjb2xvbklkeCArIDEpO1xuICAgIGlmIChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykge1xuICAgICAgcmV0dXJuIHsgcGF0aCwga2luZCwgcmFuZ2U6IHJhbmdlZC5nZXQoa2V5KSB9O1xuICAgIH1cbiAgICByZXR1cm4geyBwYXRoLCBraW5kIH07XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFByZS1jb21taXQgcmVjb3JkIHdyaXRlciB0eXBlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RhYmxlIHdyaXRlciBmb3IgcHJlLWNvbW1pdCByZWNvcmRzLiBUaGUgZGVmYXVsdCBpbXBsZW1lbnRhdGlvbiB3cml0ZXNcbiAqIHRvIHRoZSBzaGFyZWQgcXVldWUgdW5kZXIgPGdpdC1jb21tb24tZGlyPi9naXQtc3Bhbi9wcmUtY29tbWl0Ly5cbiAqL1xuZXhwb3J0IHR5cGUgUHJlQ29tbWl0UmVjb3JkV3JpdGVyID0gKHJlcG9Sb290OiBzdHJpbmcsIHJlY29yZDogUHJlQ29tbWl0UmVjb3JkKSA9PiB2b2lkO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1haW4gaGFuZGxlciBmYWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBTdG9wSGFuZGxlckRlcHMge1xuICAvKiogTG9hZCBwYXRoLXNjb3BlZCBzcGFuIHN1cHByZXNzaW9uIHJ1bGVzLiAqL1xuICBsb2FkUnVsZXM/OiBIb29rSWdub3JlTG9hZGVyO1xuICAvKiogV3JpdGUgYSBwcmUtY29tbWl0IHJlY29yZCB0byB0aGUgcXVldWUuIERlZmF1bHRzIHRvIHdyaXRlUHJlQ29tbWl0UmVjb3JkLiAqL1xuICB3cml0ZVJlY29yZD86IFByZUNvbW1pdFJlY29yZFdyaXRlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVN0b3BIYW5kbGVyKGRlcHM6IFN0b3BIYW5kbGVyRGVwcykge1xuICBjb25zdCB3cml0ZVJlY29yZCA9IGRlcHMud3JpdGVSZWNvcmQgPz8gZGVmYXVsdFdyaXRlUHJlQ29tbWl0UmVjb3JkO1xuXG4gIHJldHVybiAoaW5wdXQ6IFN0b3BDb3JlSW5wdXQsIGN0eDogU3RvcENvcmVDb250ZXh0KTogbnVsbCA9PiB7XG4gICAgY29uc3Qgc2Vzc2lvbklkID0gaW5wdXQuc2Vzc2lvbl9pZDtcblxuICAgIC8vIFN0ZXAgMDogQnJlYWsgdGhlIHN0b3AgbG9vcC4gV2hlbiB0aGUgYWdlbnQgdHJpZXMgdG8gc3RvcCBhZ2FpbiB0aGlzXG4gICAgLy8gaG9vayByZS1maXJlcyB3aXRoIGBzdG9wX2hvb2tfYWN0aXZlID0gdHJ1ZWA7IGFsbG93IHRoYXQgc3RvcCBvdXRyaWdodC5cbiAgICAvLyAoUmVwb3J0ZWQgZW50cmllcyBhcmUgYWxzbyBtYXJrZWQgc2VlbiBiZWxvdywgc28gYSByZS1maXJlIHdvdWxkIGhhdmUgbm9cbiAgICAvLyBuZXcgZW50cmllcyB0byB3cml0ZSBcdTIwMTQgdGhpcyBpcyB0aGUgZXhwbGljaXQgZ3VhcmQuKVxuICAgIGlmIChpbnB1dC5zdG9wX2hvb2tfYWN0aXZlID09PSB0cnVlKSByZXR1cm4gbnVsbDtcblxuICAgIC8vIFN0ZXAgMC41OiBTdXBwcmVzcyB3aGlsZSBzdWJhZ2VudHMgYXJlIGluIGZsaWdodC4gVGhlIGpvdXJuYWwgbWF5IHN0aWxsXG4gICAgLy8gYmUgY2hhbmdpbmcgdW5kZXIgdGhlbS5cbiAgICBsZXQgYWN0aXZlU3ViYWdlbnRzOiBudW1iZXI7XG4gICAgdHJ5IHtcbiAgICAgIGFjdGl2ZVN1YmFnZW50cyA9IHJlYWRTdWJhZ2VudENvdW50KHNlc3Npb25JZCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKGFjdGl2ZVN1YmFnZW50cyA+IDApIHJldHVybiBudWxsO1xuXG4gICAgLy8gU3RlcCAxOiBMb2FkIGpvdXJuYWxcbiAgICBjb25zdCBlbnRyaWVzID0gbG9hZEpvdXJuYWwoc2Vzc2lvbklkKTtcbiAgICBpZiAoIWVudHJpZXMpIHJldHVybiBudWxsO1xuXG4gICAgLy8gU3RlcCAyOiBSZXNvbHZlIHJlcG8gcm9vdC5cbiAgICAvLyBQcmltYXJ5OiBpbnB1dC5jd2QgKHByZXNlbnQgaW4gbW9zdCBTdG9wIGV2ZW50cykuXG4gICAgLy8gRmFsbGJhY2sgMTogcHJvY2Vzcy5jd2QoKSAodGhlIGhvb2sgcHJvY2VzcydzIG93biB3b3JraW5nIGRpcmVjdG9yeSkuXG4gICAgLy8gRmFsbGJhY2sgMjogZm9yIGVhY2ggam91cm5hbCBlbnRyeSwgdHJ5IHRoYXQgZGlyZWN0b3J5IFx1MjAxNCB1c2VmdWwgd2hlbiB0aGVcbiAgICAvLyAgIGhvb2sgaXMgaW52b2tlZCBmcm9tIG91dHNpZGUgdGhlIHJlcG8gYnV0IGpvdXJuYWwgcGF0aHMgaGludCBhdCBsb2NhdGlvbnMuXG4gICAgbGV0IHJlcG9Sb290OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICBjb25zdCBjd2RGaWVsZCA9IGlucHV0LmN3ZDtcbiAgICBpZiAodHlwZW9mIGN3ZEZpZWxkID09PSAnc3RyaW5nJyAmJiBjd2RGaWVsZC5sZW5ndGggPiAwKSB7XG4gICAgICByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2RGaWVsZCk7XG4gICAgfVxuICAgIGlmICghcmVwb1Jvb3QpIHtcbiAgICAgIHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KHByb2Nlc3MuY3dkKCkpO1xuICAgIH1cbiAgICBpZiAoIXJlcG9Sb290KSB7XG4gICAgICBmb3IgKGNvbnN0IGUgb2YgZW50cmllcykge1xuICAgICAgICBjb25zdCBjYW5kaWRhdGUgPSBub2RlUGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG5vZGVQYXRoLmRpcm5hbWUoZS5wYXRoKSk7XG4gICAgICAgIHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGNhbmRpZGF0ZSk7XG4gICAgICAgIGlmIChyZXBvUm9vdCkgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICghcmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3QgZmluYWxSZXBvUm9vdCA9IHJlcG9Sb290O1xuXG4gICAgLy8gU3RlcCAzOiBCdWlsZCBhbmNob3Igc3BlY3MgZnJvbSB1bnJlcG9ydGVkIHdyaXRlLWtpbmQgZW50cmllcy5cbiAgICAvLyBPbmx5IHdyaXR0ZW4gYW5jaG9ycyAod3JpdGUsIGNyZWF0ZSwgd2hvbGUtd3JpdGUpIHByb2R1Y2UgcHJlLWNvbW1pdFxuICAgIC8vIHJlY29yZHMgXHUyMDE0IHJlYWRzIChyZWFkLCB3aG9sZS1yZWFkKSBkbyBub3QuIFRoZSB3aG9sZSB1bnJlcG9ydGVkIGJhdGNoXG4gICAgLy8gaXMgc3RpbGwgbWFya2VkIHNlZW4gaW4gU3RlcCA1IHNvIHJlYWRzIGRvbid0IHJlLWZpcmUgZW5kbGVzc2x5LlxuICAgIGNvbnN0IHVucmVwb3J0ZWRFbnRyaWVzID0gZW50cmllcy5maWx0ZXIoKGUpID0+ICFlLnNlZW4pO1xuICAgIGNvbnN0IGlzV3JpdGVLaW5kID0gKGtpbmQ6IFRvdWNoS2luZCk6IGJvb2xlYW4gPT4ga2luZCA9PT0gJ3dyaXRlJyB8fCBraW5kID09PSAnY3JlYXRlJyB8fCBraW5kID09PSAnd2hvbGUtd3JpdGUnO1xuICAgIGNvbnN0IGFuY2hvclNwZWNzID0gYnVpbGRBbmNob3JTcGVjcyh1bnJlcG9ydGVkRW50cmllcy5maWx0ZXIoKGUpID0+IGlzV3JpdGVLaW5kKGUua2luZCkpKTtcblxuICAgIGlmIChhbmNob3JTcGVjcy5sZW5ndGggPT09IDApIHtcbiAgICAgIC8vIFJlYWQtb25seSBzZXNzaW9uOiBubyB3cml0ZXMgdG8gcmVjb3JkLiBNYXJrIGFsbCB1bnJlcG9ydGVkIGVudHJpZXNcbiAgICAgIC8vIHNlZW4gc28gYSBsYXRlciBTdG9wIGRvZXMgbm90IHJlLWV4YW1pbmUgdGhlbSwgdGhlbiBleGl0IHNpbGVudGx5LlxuICAgICAgZm9yIChjb25zdCBlIG9mIHVucmVwb3J0ZWRFbnRyaWVzKSB7XG4gICAgICAgIGUuc2VlbiA9IHRydWU7XG4gICAgICB9XG4gICAgICB3cml0ZUpvdXJuYWwoc2Vzc2lvbklkLCBlbnRyaWVzLCBjdHgubG9nZ2VyKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIC8vIFN0ZXAgNDogV3JpdGUgdGhlIHByZS1jb21taXQgcmVjb3JkIGZvciB0aGUgYmFja2dyb3VuZCBkaXNwYXRjaGVyLlxuICAgIGNvbnN0IHJlY29yZDogUHJlQ29tbWl0UmVjb3JkID0ge1xuICAgICAgYW5jaG9yczogYW5jaG9yU3BlY3MsXG4gICAgICBjcmVhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICB9O1xuICAgIHRyeSB7XG4gICAgICB3cml0ZVJlY29yZChmaW5hbFJlcG9Sb290LCByZWNvcmQpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY3R4LmxvZ2dlci53YXJuKCdmYWlsZWQgdG8gd3JpdGUgcHJlLWNvbW1pdCByZWNvcmQnLCB7IGVyciB9KTtcbiAgICAgIC8vIERvbid0IHN1cHByZXNzIHNlZW4tbWFya2luZyBcdTIwMTQgYSBqb3VybmFsLW9ubHkgc2Vzc2lvbiBpcyBiZXR0ZXIgdGhhbiBhXG4gICAgICAvLyByZS1kaXNwYXRjaCBsb29wIG9uIGEgcGVyc2lzdGVudGx5IGZhaWxpbmcgcXVldWUuXG4gICAgfVxuXG4gICAgLy8gU3RlcCA1OiBNYXJrIGFsbCBwcm9jZXNzZWQgZW50cmllcyBzZWVuIHNvIGEgbGF0ZXIgU3RvcCB3aXRoIG5vIG5ld1xuICAgIC8vIHRvdWNoZXMgcHJvZHVjZXMgbm8gcmVjb3JkIGFuZCBleGl0cyBzaWxlbnRseS5cbiAgICBmb3IgKGNvbnN0IGUgb2YgdW5yZXBvcnRlZEVudHJpZXMpIHtcbiAgICAgIGUuc2VlbiA9IHRydWU7XG4gICAgfVxuXG4gICAgLy8gU3RlcCA2OiBSZXdyaXRlIGpvdXJuYWwgd2l0aCB1cGRhdGVkIHNlZW4gZmxhZ3MuXG4gICAgd3JpdGVKb3VybmFsKHNlc3Npb25JZCwgZW50cmllcywgY3R4LmxvZ2dlcik7XG5cbiAgICAvLyBTdGVwIDc6IFJldHVybiBudWxsIFx1MjAxNCB0aGUgc3RvcCBwcm9jZWVkcy4gQWxsIGRvd25zdHJlYW0gd29yayBoYXBwZW5zIGluXG4gICAgLy8gdGhlIGJhY2tncm91bmQgZGlzcGF0Y2hlciAoUGhhc2UgMyspLlxuICAgIHJldHVybiBudWxsO1xuICB9O1xufVxuIiwgIi8qKlxuICogQ29kZXggYGFwcGx5X3BhdGNoYCBlbnZlbG9wZSBwYXJzZXIuXG4gKlxuICogVHVybnMgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGB0b29sX2lucHV0LmNvbW1hbmRgIHBhdGNoIHN0cmluZyBpbnRvIHRoZVxuICogYEFuY2hvclNwZWNbXWAgc2hhcGUgdGhlIHNoYXJlZCBqb3VybmFsIGFscmVhZHkgY29uc3VtZXMgXHUyMDE0IHRoZSBvbmUgZ2VudWluZWx5XG4gKiBuZXcgYWxnb3JpdGhtIHRoZSBDb2RleCBhZGFwdGVyIG5lZWRzLiBJdCByZXBsYWNlcyB0aGUgc3RydWN0dXJlZFxuICogYGZpbGVfcGF0aGAvYG9sZF9zdHJpbmdgL2BvZmZzZXRgIHJlYWRpbmcgdGhlIENsYXVkZSBQcmVUb29sVXNlIGhvb2sgZG9lcyxcbiAqIGJlY2F1c2UgQ29kZXggZGVsaXZlcnMgZXZlcnkgZWRpdCBhcyBhIHNpbmdsZSBhcHBseV9wYXRjaCBlbnZlbG9wZSByYXRoZXJcbiAqIHRoYW4gYSB0eXBlZCB0b29sIGlucHV0LlxuICpcbiAqIFRoZSBtb2R1bGUgaXMgcHVyZTogaXQgaW1wb3J0cyBvbmx5IHRoZSBrZXJuZWwgYW5jaG9yIHR5cGVzIGFuZCBuZXZlciB0b3VjaGVzXG4gKiB0aGUgQ29kZXggU0RLLCBzbyBpdCBpcyBESS10ZXN0YWJsZSBleGFjdGx5IGxpa2UgdGhlIHBvcmNlbGFpbiBwYXJzZXJzIGluIHRoZVxuICogc2hhcmVkIGtlcm5lbC4gUmFuZ2UgcmVjb3ZlcnkgaXMgYmVzdC1lZmZvcnQgXHUyMDE0IHRoZSBhcHBseV9wYXRjaCBmb3JtYXQgY2Fycmllc1xuICogYEBAYCBjb250ZXh0IGFuZCBgK2AvYC1gL3NwYWNlIGNoYW5nZSBsaW5lcyBidXQgbm8gZXhwbGljaXQgbGluZSBudW1iZXJzLCBzbyBhXG4gKiByYW5nZSBjYW4gb25seSBiZSByZWNvdmVyZWQgYnkgbG9jYXRpbmcgYSBodW5rJ3MgcHJlLWVkaXQgYmxvY2sgaW4gdGhlXG4gKiBvbi1kaXNrIGZpbGUuIFRoYXQgZmlsZSByZWFkIGlzIGluamVjdGVkIChgcmVhZFByZUVkaXRGaWxlYCkgc28gdGhlIGZ1bmN0aW9uXG4gKiBzdGF5cyBwdXJlIGFuZCB0ZXN0YWJsZS4gT24gQU5ZIGFtYmlndWl0eSAobm8gcmVhZGVyLCBmaWxlIG1pc3NpbmcsIGNvbnRleHRcbiAqIG5vdCBmb3VuZCwgZnV6enkvZHVwbGljYXRlIG1hdGNoKSB0aGUgcGFyc2VyIGRlZ3JhZGVzIHRvIGEgd2hvbGUtZmlsZSBhbmNob3JcbiAqIHJhdGhlciB0aGFuIHRocm93aW5nIFx1MjAxNCB3aG9sZS1maWxlIGFuY2hvcnMgYXJlIGZpcnN0LWNsYXNzIGFuZCBqb3VybmFsaW5nIG11c3RcbiAqIG5ldmVyIGJlIGJsb2NrZWQuXG4gKlxuICogVGhlIGdyYW1tYXIgaXMgY3Jvc3MtY2hlY2tlZCBhZ2FpbnN0IENvZGV4J3Mgb3duIGFwcGx5X3BhdGNoIGNyYXRlXG4gKiAoY29kZXgtcnMvYXBwbHktcGF0Y2gvc3JjL3twYXJzZXIsc3RyZWFtaW5nX3BhcnNlcn0ucnMpLiBUd28gc3VidGxldGllcyBhcmVcbiAqIG1pcnJvcmVkIGRlbGliZXJhdGVseTogaHVuay1oZWFkZXIgbWFya2VycyBhcmUgb25seSByZWNvZ25pemVkIGF0IHRoZSBzdGFydCBvZlxuICogYSBsaW5lIHdpdGggbm8gbGVhZGluZyB3aGl0ZXNwYWNlIHdoaWxlIGluc2lkZSBhbiBVcGRhdGUgaHVuayAoYSBsZWFkaW5nIHNwYWNlXG4gKiBkZW1vdGVzIGEgbWFya2VyIHRvIGEgY29udGV4dCBsaW5lKSwgYW5kIGEgYmFyZSBlbXB0eSBsaW5lIGluc2lkZSBhbiBVcGRhdGVcbiAqIGh1bmsgaXMgdHJlYXRlZCBhcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgcHJlc2VudCBpbiBib3RoIG9sZCBhbmQgbmV3IGNvbnRlbnQuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgdHlwZSB7IEFuY2hvclNwZWMsIExpbmVSYW5nZSB9IGZyb20gJy4uL2NvbW1vbi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuXG4vKipcbiAqIFJlYWRzIHRoZSBwcmUtZWRpdCAob24tZGlzaywgYmVmb3JlIHRoZSBwYXRjaCBhcHBsaWVzKSBjb250ZW50IG9mIHRoZSBmaWxlIGF0XG4gKiBgcGF0aGAsIG9yIHJldHVybnMgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIHJlYWQuIEluamVjdGVkIHNvIHRoZSBwYXJzZXIgc3RheXNcbiAqIHB1cmU7IGNhbGwgc2l0ZXMgZGVmYXVsdCB0byBhIHJlYWwgZmlsZXN5c3RlbSByZWFkLlxuICovXG5leHBvcnQgdHlwZSBSZWFkUHJlRWRpdEZpbGUgPSAocGF0aDogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEdyYW1tYXIgbWFya2VycyAobWlycm9ycyBjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMvcGFyc2VyLnJzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IEVORF9QQVRDSF9NQVJLRVIgPSAnKioqIEVuZCBQYXRjaCc7XG5jb25zdCBBRERfRklMRV9NQVJLRVIgPSAnKioqIEFkZCBGaWxlOiAnO1xuY29uc3QgREVMRVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBEZWxldGUgRmlsZTogJztcbmNvbnN0IFVQREFURV9GSUxFX01BUktFUiA9ICcqKiogVXBkYXRlIEZpbGU6ICc7XG5jb25zdCBNT1ZFX1RPX01BUktFUiA9ICcqKiogTW92ZSB0bzogJztcbmNvbnN0IEVPRl9NQVJLRVIgPSAnKioqIEVuZCBvZiBGaWxlJztcbmNvbnN0IENIQU5HRV9DT05URVhUX01BUktFUiA9ICdAQCAnO1xuY29uc3QgRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbnRlcm1lZGlhdGUgaHVuayBtb2RlbFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBVcGRhdGVDaHVuayB7XG4gIC8qKiBPcHRpb25hbCBgQEAgPGNvbnRleHQ+YCBsaW5lIHVzZWQgdG8gZGlzYW1iaWd1YXRlIHRoZSBibG9jaydzIGxvY2F0aW9uLiAqL1xuICBjaGFuZ2VDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKiogUHJlLWVkaXQgbGluZXMgdGhpcyBjaHVuayBjb3ZlcnMgKGNvbnRleHQgYCBgICsgcmVtb3ZlZCBgLWApLCBpbiBvcmRlci4gKi9cbiAgb2xkTGluZXM6IHN0cmluZ1tdO1xuICAvKiogUG9zdC1lZGl0IGxpbmVzIChjb250ZXh0IGAgYCArIGFkZGVkIGArYCk7IHJldGFpbmVkIGZvciBjb21wbGV0ZW5lc3MuICovXG4gIG5ld0xpbmVzOiBzdHJpbmdbXTtcbn1cblxudHlwZSBIdW5rID1cbiAgfCB7IGtpbmQ6ICdhZGQnOyBwYXRoOiBzdHJpbmcgfVxuICB8IHsga2luZDogJ2RlbGV0ZSc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAndXBkYXRlJzsgcGF0aDogc3RyaW5nOyBtb3ZlUGF0aDogc3RyaW5nIHwgbnVsbDsgY2h1bmtzOiBVcGRhdGVDaHVua1tdIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCByZWFkZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlYWwtZmlsZXN5c3RlbSByZWFkZXIgdXNlZCB3aGVuIG5vIHJlYWRlciBpcyBpbmplY3RlZC4gQmVzdC1lZmZvcnQ6IGFueVxuICogZmFpbHVyZSAobWlzc2luZyBmaWxlLCBwZXJtaXNzaW9uIGVycm9yKSB5aWVsZHMgYG51bGxgLCB3aGljaCB0aGUgcGFyc2VyXG4gKiBkZWdyYWRlcyB0byBhIHdob2xlLWZpbGUgYW5jaG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFJlYWRQcmVFZGl0RmlsZShwYXRoOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZnMucmVhZEZpbGVTeW5jKHBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEVudmVsb3BlIHNjYW5uaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTY2FuIHRoZSBwYXRjaCB0ZXh0IGludG8gaHVua3MuIExlbmllbnQgYnkgZGVzaWduOiB1bnJlY29nbml6ZWQgbGluZXMgYXJlXG4gKiBpZ25vcmVkIHJhdGhlciB0aGFuIHJlamVjdGVkLCBhbmQgQmVnaW4vRW5kL0Vudmlyb25tZW50IGxpbmVzIGFyZSBza2lwcGVkLCBzb1xuICogYSBtYWxmb3JtZWQgZW52ZWxvcGUgZGVncmFkZXMgdG8gd2hhdGV2ZXIgaHVua3MgY291bGQgYmUgcmVjb3ZlcmVkIChvZnRlblxuICogbm9uZSBcdTIxOTIgYFtdYCkgaW5zdGVhZCBvZiB0aHJvd2luZy5cbiAqL1xuZnVuY3Rpb24gc2Nhbkh1bmtzKGNvbW1hbmQ6IHN0cmluZyk6IEh1bmtbXSB7XG4gIGNvbnN0IGh1bmtzOiBIdW5rW10gPSBbXTtcbiAgLy8gVGhlIGN1cnJlbnRseS1vcGVuIFVwZGF0ZSBodW5rLCBvciBudWxsLiBBZGQvRGVsZXRlIGh1bmtzIGhhdmUgbm8gYm9keSwgc29cbiAgLy8gdGhleSBjbG9zZSBpbW1lZGlhdGVseSBhbmQgcmVzZXQgdGhpcyB0byBudWxsLlxuICBsZXQgb3BlblVwZGF0ZTogKEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pIHwgbnVsbCA9IG51bGw7XG5cbiAgZm9yIChjb25zdCByYXcgb2YgY29tbWFuZC5zcGxpdCgnXFxuJykpIHtcbiAgICAvLyBIZWFkZXIgZGV0ZWN0aW9uIGlzIHdoaXRlc3BhY2Utc2Vuc2l0aXZlIGluc2lkZSBhbiBVcGRhdGUgaHVuazogQ29kZXggdXNlc1xuICAgIC8vIHRyaW1fZW5kIHRoZXJlIChsZWFkaW5nIHNwYWNlIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpIGFuZCBmdWxsXG4gICAgLy8gdHJpbSBlbHNld2hlcmUuIE1hdGNoIHRoYXQgc28gaW5kZW50ZWQgbWFya2VycyBpbnNpZGUgYSBodW5rIHN0YXkgY29udGVudC5cbiAgICBjb25zdCBoZWFkZXJMaW5lOiBzdHJpbmcgPSBvcGVuVXBkYXRlID8gcmF3LnJlcGxhY2UoL1sgXFx0XFxyXSskLywgJycpIDogcmF3LnRyaW0oKTtcblxuICAgIGlmIChoZWFkZXJMaW5lID09PSBFTkRfUEFUQ0hfTUFSS0VSKSB7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKEFERF9GSUxFX01BUktFUikpIHtcbiAgICAgIGh1bmtzLnB1c2goeyBraW5kOiAnYWRkJywgcGF0aDogaGVhZGVyTGluZS5zbGljZShBRERfRklMRV9NQVJLRVIubGVuZ3RoKSB9KTtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoREVMRVRFX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdkZWxldGUnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKERFTEVURV9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChVUERBVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBjb25zdCBodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9ID0ge1xuICAgICAgICBraW5kOiAndXBkYXRlJyxcbiAgICAgICAgcGF0aDogaGVhZGVyTGluZS5zbGljZShVUERBVEVfRklMRV9NQVJLRVIubGVuZ3RoKSxcbiAgICAgICAgbW92ZVBhdGg6IG51bGwsXG4gICAgICAgIGNodW5rczogW11cbiAgICAgIH07XG4gICAgICBodW5rcy5wdXNoKGh1bmspO1xuICAgICAgb3BlblVwZGF0ZSA9IGh1bms7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAob3BlblVwZGF0ZSkge1xuICAgICAgcHJvY2Vzc1VwZGF0ZUxpbmUob3BlblVwZGF0ZSwgcmF3KTtcbiAgICB9XG4gICAgLy8gQW55IG90aGVyIGxpbmUgb3V0c2lkZSBhbiBVcGRhdGUgaHVuayAoQmVnaW4gUGF0Y2gsIEVudmlyb25tZW50IElELCBBZGRcbiAgICAvLyBGaWxlIGArYCBjb250ZW50LCBzdHJheSB0ZXh0KSBpcyBpZ25vcmVkLlxuICB9XG5cbiAgcmV0dXJuIGh1bmtzO1xufVxuXG5mdW5jdGlvbiBlbnN1cmVDaHVuayhodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9KTogVXBkYXRlQ2h1bmsge1xuICBjb25zdCBsYXN0ID0gaHVuay5jaHVua3NbaHVuay5jaHVua3MubGVuZ3RoIC0gMV07XG4gIGlmIChsYXN0KSByZXR1cm4gbGFzdDtcbiAgY29uc3QgY2h1bms6IFVwZGF0ZUNodW5rID0geyBjaGFuZ2VDb250ZXh0OiBudWxsLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9O1xuICBodW5rLmNodW5rcy5wdXNoKGNodW5rKTtcbiAgcmV0dXJuIGNodW5rO1xufVxuXG4vKiogQXBwbHkgb25lIGJvZHkgbGluZSBvZiBhbiBVcGRhdGUgaHVuayB0byBpdHMgY2h1bmsgbGlzdC4gKi9cbmZ1bmN0aW9uIHByb2Nlc3NVcGRhdGVMaW5lKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0sIHJhdzogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHRyaW1tZWRFbmQgPSByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJyk7XG5cbiAgaWYgKHRyaW1tZWRFbmQgPT09IEVPRl9NQVJLRVIpIHJldHVybjsgLy8gZW5kLW9mLWZpbGUgaGludDsgbm90IG5lZWRlZCBmb3IgcmFuZ2VzXG5cbiAgLy8gYCoqKiBNb3ZlIHRvOmAgaXMgb25seSBtZWFuaW5nZnVsIGJlZm9yZSBhbnkgY2hhbmdlIGNvbnRlbnQuXG4gIGlmIChodW5rLmNodW5rcy5sZW5ndGggPT09IDAgJiYgaHVuay5tb3ZlUGF0aCA9PT0gbnVsbCAmJiB0cmltbWVkRW5kLnN0YXJ0c1dpdGgoTU9WRV9UT19NQVJLRVIpKSB7XG4gICAgaHVuay5tb3ZlUGF0aCA9IHRyaW1tZWRFbmQuc2xpY2UoTU9WRV9UT19NQVJLRVIubGVuZ3RoKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSB7XG4gICAgaHVuay5jaHVua3MucHVzaCh7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodHJpbW1lZEVuZC5zdGFydHNXaXRoKENIQU5HRV9DT05URVhUX01BUktFUikpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogdHJpbW1lZEVuZC5zbGljZShDSEFOR0VfQ09OVEVYVF9NQVJLRVIubGVuZ3RoKSwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gQSBiYXJlIGVtcHR5IGxpbmUgaXMgYW4gZW1wdHkgY29udGV4dCBsaW5lIChwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcpLlxuICBpZiAocmF3ID09PSAnJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaCgnJyk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaCgnJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZpcnN0ID0gcmF3WzBdO1xuICBpZiAoZmlyc3QgPT09ICcgJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY29uc3QgY29udGVudCA9IHJhdy5zbGljZSgxKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKGNvbnRlbnQpO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2goY29udGVudCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJysnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJy0nKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIFVucmVjb2duaXplZCBjb250ZW50IGxpbmUgXHUyMDE0IGlnbm9yZSBsZW5pZW50bHkgcmF0aGVyIHRoYW4gdGhyb3cuXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3BsaXQgZmlsZSBjb250ZW50IGludG8gbGluZXMgZm9yIG1hdGNoaW5nLiBBIHRyYWlsaW5nIG5ld2xpbmUgeWllbGRzIGFcbiAqIHRyYWlsaW5nIGVtcHR5IGVsZW1lbnQsIHdoaWNoIGlzIGhhcm1sZXNzIGZvciBzdWItc2xpY2UgbWF0Y2hpbmcuICovXG5mdW5jdGlvbiBzcGxpdExpbmVzKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIGNvbnRlbnQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKiogSW5kaWNlcyAoMC1iYXNlZCkgYXQgd2hpY2ggYHZhbHVlYCBhcHBlYXJzIGFzIGEgZnVsbCBsaW5lIGluIGBsaW5lc2AuICovXG5mdW5jdGlvbiBsaW5lSW5kaWNlcyhsaW5lczogc3RyaW5nW10sIHZhbHVlOiBzdHJpbmcpOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChsaW5lc1tpXSA9PT0gdmFsdWUpIG91dC5wdXNoKGkpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBTdGFydCBpbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgbmVlZGxlYCBtYXRjaGVzIGNvbnRpZ3VvdXNseSBpbiBgaGF5c3RhY2tgLiAqL1xuZnVuY3Rpb24gY29udGlndW91c01hdGNoZXMoaGF5c3RhY2s6IHN0cmluZ1tdLCBuZWVkbGU6IHN0cmluZ1tdKTogbnVtYmVyW10ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwIHx8IG5lZWRsZS5sZW5ndGggPiBoYXlzdGFjay5sZW5ndGgpIHJldHVybiBvdXQ7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBmb3IgKGxldCBpID0gMDsgaSA8PSBsYXN0OyBpKyspIHtcbiAgICBsZXQgb2sgPSB0cnVlO1xuICAgIGZvciAobGV0IGogPSAwOyBqIDwgbmVlZGxlLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaGF5c3RhY2tbaSArIGpdICE9PSBuZWVkbGVbal0pIHtcbiAgICAgICAgb2sgPSBmYWxzZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChvaykgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBMb2NhdGUgYSBzaW5nbGUgY2h1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGUgZmlsZSwgcmV0dXJuaW5nIGl0cyAxLWJhc2VkXG4gKiBsaW5lIHJhbmdlIG9yIG51bGwgd2hlbiBpdCBjYW5ub3QgYmUgbG9jYXRlZCB1bmFtYmlndW91c2x5LlxuICpcbiAqIC0gTm9uLWVtcHR5IGJsb2NrOiByZXF1aXJlIGEgdW5pcXVlIGNvbnRpZ3VvdXMgbWF0Y2gsIG9yIFx1MjAxNCB3aGVuIGR1cGxpY2F0ZWQgXHUyMDE0XG4gKiAgIGEgYEBAYCBjaGFuZ2UtY29udGV4dCBsaW5lIHRoYXQgc2VsZWN0cyB0aGUgb2NjdXJyZW5jZSBhZnRlciBpdC5cbiAqIC0gRW1wdHkgYmxvY2sgKHB1cmUgaW5zZXJ0aW9uKTogYW5jaG9yIG9uIGEgdW5pcXVlIGNoYW5nZS1jb250ZXh0IGxpbmUgaWYgb25lXG4gKiAgIGlzIGdpdmVuOyBvdGhlcndpc2UgaXQgaXMgdW5sb2NhdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGxvY2F0ZUNodW5rKHByZUxpbmVzOiBzdHJpbmdbXSwgY2h1bms6IFVwZGF0ZUNodW5rKTogTGluZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IGJsb2NrID0gY2h1bmsub2xkTGluZXM7XG5cbiAgaWYgKGJsb2NrLmxlbmd0aCA9PT0gMCkge1xuICAgIGNvbnN0IGN0eCA9IGNodW5rLmNoYW5nZUNvbnRleHQ7XG4gICAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgICBjb25zdCBjdHhJZHhzID0gbGluZUluZGljZXMocHJlTGluZXMsIGN0eCk7XG4gICAgICBpZiAoY3R4SWR4cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgY29uc3QgbGluZSA9IGN0eElkeHNbMF0gKyAxO1xuICAgICAgICByZXR1cm4geyBzdGFydDogbGluZSwgZW5kOiBsaW5lIH07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3Qgc3RhcnRzID0gY29udGlndW91c01hdGNoZXMocHJlTGluZXMsIGJsb2NrKTtcbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBzID0gc3RhcnRzWzBdO1xuICAgIHJldHVybiB7IHN0YXJ0OiBzICsgMSwgZW5kOiBzICsgYmxvY2subGVuZ3RoIH07XG4gIH1cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIER1cGxpY2F0ZWQgYmxvY2s6IHVzZSB0aGUgY2hhbmdlIGNvbnRleHQgdG8gc2VsZWN0IHRoZSBtYXRjaCBhZnRlciBpdC5cbiAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgZm9yIChjb25zdCBjIG9mIGxpbmVJbmRpY2VzKHByZUxpbmVzLCBjdHgpKSB7XG4gICAgICBjb25zdCBhZnRlciA9IHN0YXJ0cy5maW5kKChzKSA9PiBzID49IGMpO1xuICAgICAgaWYgKGFmdGVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IGFmdGVyICsgMSwgZW5kOiBhZnRlciArIGJsb2NrLmxlbmd0aCB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDsgLy8gYW1iaWd1b3VzIFx1MjE5MiBjYWxsZXIgZGVncmFkZXMgdG8gd2hvbGUtZmlsZVxufVxuXG4vKipcbiAqIFJlY292ZXIgYSBzaW5nbGUgbGluZSByYW5nZSBzcGFubmluZyBhbGwgb2YgYW4gdXBkYXRlJ3MgY2h1bmtzLiBSZXR1cm5zIG51bGxcbiAqIChcdTIxOTIgd2hvbGUtZmlsZSBmYWxsYmFjaykgaWYgYW55IGNodW5rIGNhbm5vdCBiZSBsb2NhdGVkLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2UocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVua3M6IFVwZGF0ZUNodW5rW10pOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgbGV0IHVuaW9uOiBMaW5lUmFuZ2UgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBjaHVuayBvZiBjaHVua3MpIHtcbiAgICBjb25zdCByID0gbG9jYXRlQ2h1bmsocHJlTGluZXMsIGNodW5rKTtcbiAgICBpZiAociA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgdW5pb24gPSB1bmlvbiA9PT0gbnVsbCA/IHIgOiB7IHN0YXJ0OiBNYXRoLm1pbih1bmlvbi5zdGFydCwgci5zdGFydCksIGVuZDogTWF0aC5tYXgodW5pb24uZW5kLCByLmVuZCkgfTtcbiAgfVxuICByZXR1cm4gdW5pb247XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIEFQSVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUGFyc2UgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGNvbW1hbmQgc3RyaW5nIGludG8gYW4gYW5jaG9yIHBlciB0b3VjaGVkIGZpbGUuXG4gKlxuICogLSBgKioqIEFkZCBGaWxlOmAgXHUyMTkyIGBjcmVhdGVgICh3aG9sZS1maWxlKVxuICogLSBgKioqIERlbGV0ZSBGaWxlOmAgXHUyMTkyIGB3aG9sZS13cml0ZWAgKHdob2xlLWZpbGU7IHRoZSBmaWxlIG5vIGxvbmdlciBleGlzdHMpXG4gKiAtIGAqKiogVXBkYXRlIEZpbGU6YCBcdTIxOTIgYHdyaXRlYCB3aXRoIGEgcmVjb3ZlcmVkIGxpbmUgcmFuZ2Ugd2hlbiB0aGUgaHVuaydzXG4gKiAgIHByZS1lZGl0IGJsb2NrIGNhbiBiZSBsb2NhdGVkIHZpYSBgcmVhZFByZUVkaXRGaWxlYCwgb3RoZXJ3aXNlIGB3aG9sZS13cml0ZWAuXG4gKiAgIEEgcmVuYW1lZCB1cGRhdGUgKGAqKiogTW92ZSB0bzpgKSBhbmNob3JzIHRoZSBkZXN0aW5hdGlvbiBwYXRoIGFzXG4gKiAgIGB3aG9sZS13cml0ZWAgc2luY2UgcHJlLWVkaXQgbGluZSBudW1iZXJzIGNhbm5vdCBiZSBtYXBwZWQgYWNyb3NzIGEgcmVuYW1lLlxuICpcbiAqIE5ldmVyIHRocm93czogYSBtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggeWllbGRzIGBbXWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUFwcGx5UGF0Y2goXG4gIGNvbW1hbmQ6IHN0cmluZyxcbiAgcmVhZFByZUVkaXRGaWxlOiBSZWFkUHJlRWRpdEZpbGUgPSBkZWZhdWx0UmVhZFByZUVkaXRGaWxlXG4pOiBBbmNob3JTcGVjW10ge1xuICBjb25zdCBhbmNob3JzOiBBbmNob3JTcGVjW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGh1bmsgb2Ygc2Nhbkh1bmtzKGNvbW1hbmQpKSB7XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2FkZCcpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ2NyZWF0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ3dob2xlLXdyaXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZTogYW5jaG9yIG9uIHRoZSBkZXN0aW5hdGlvbiBwYXRoIChwb3N0LWVkaXQgbG9jYXRpb24pLlxuICAgIGNvbnN0IHRhcmdldFBhdGggPSB0b1Bvc2l4KGh1bmsubW92ZVBhdGggPz8gaHVuay5wYXRoKTtcblxuICAgIC8vIEEgcmVuYW1lIGRlZmVhdHMgcHJlLWVkaXQgbGluZSBtYXBwaW5nIFx1MjAxNCBhbmNob3Igd2hvbGUtZmlsZSBvbiB0aGUgdGFyZ2V0LlxuICAgIGlmIChodW5rLm1vdmVQYXRoICE9PSBudWxsKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gUmFuZ2UgcmVjb3ZlcnkgcmVhZHMgdGhlIHByZS1lZGl0IGNvbnRlbnQgYXQgdGhlIG9yaWdpbmFsIChwcmUtbW92ZSkgcGF0aC5cbiAgICBjb25zdCBjb250ZW50ID0gcmVhZFByZUVkaXRGaWxlKGh1bmsucGF0aCk7XG4gICAgY29uc3QgcmFuZ2UgPSBjb250ZW50ID09PSBudWxsID8gbnVsbCA6IHJlY292ZXJSYW5nZShzcGxpdExpbmVzKGNvbnRlbnQpLCBodW5rLmNodW5rcyk7XG4gICAgaWYgKHJhbmdlICE9PSBudWxsKSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd3JpdGUnLCByYW5nZSB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dob2xlLXdyaXRlJyB9KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYW5jaG9ycztcbn1cbiIsICIvKipcbiAqIENvZGV4IFByZVRvb2xVc2UgaG9vayBcdTIwMTQgc3VyZmFjZSBjb3VwbGVkIHNwYW5zIGJlZm9yZSBhbiBgYXBwbHlfcGF0Y2hgIGFwcGxpZXMuXG4gKlxuICogQ29kZXggZGVsaXZlcnMgZXZlcnkgZmlsZSBtdXRhdGlvbiBhcyBhIHNpbmdsZSBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlIGluXG4gKiBgdG9vbF9pbnB1dC5jb21tYW5kYCAoYSBgc3RyaW5nYCksIG5vdCBhcyBzdHJ1Y3R1cmVkIGBmaWxlX3BhdGhgL2BvbGRfc3RyaW5nYFxuICogaW5wdXRzLiBUaGlzIGhhbmRsZXIncyBvbmx5IGpvYiBpcyAqKnN1cmZhY2luZyoqOiBpdCBwYXJzZXMgdGhlIGVudmVsb3BlIGludG9cbiAqIGBBbmNob3JTcGVjW11gIHZpYSB0aGUgc2hhcmVkIFthcHBseS1wYXRjaCBwYXJzZXJdKC4vYXBwbHktcGF0Y2gudHMpLCB0aGVuIGZlZWRzXG4gKiBlYWNoIHRvdWNoZWQgcGF0aCArIHJlY292ZXJlZCByYW5nZSBpbnRvIHRoZSBoYXJuZXNzLWFnbm9zdGljIHNwYW4tc3VyZmFjaW5nXG4gKiBjb3JlIChzaGFyZWQgd2l0aCB0aGUgQ2xhdWRlIGFkYXB0ZXIpIHRvIGVtaXQgdGhlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gXG4gKiBibG9jayBmb3Igb3ZlcmxhcHBpbmcgc3BhbnMgYXMgYGFkZGl0aW9uYWxDb250ZXh0YCAocmVhY2hpbmcgdGhlIG1vZGVsIGxvb3ApXG4gKiBhbmQgYHN5c3RlbU1lc3NhZ2VgICh0aGUgdXNlci1mYWNpbmcgbGluZSkgYmVmb3JlIHRoZSBwYXRjaCBsYW5kcy5cbiAqXG4gKiBKb3VybmFsaW5nIHRoZSB3cml0ZSBpcyB0aGUgUG9zdFRvb2xVc2UgaG9vaydzIGpvYiwgcGVyIHRoZSBldmVudC1tYXBwaW5nIG5vdGU6XG4gKiBQcmVUb29sVXNlIHN1cmZhY2VzLCBQb3N0VG9vbFVzZSBqb3VybmFscyB0aGUgY29uZmlybWVkIGVkaXQuIEFuY2hvcnMgd2l0aG91dCBhXG4gKiByZWNvdmVyZWQgbGluZSByYW5nZSAod2hvbGUtZmlsZSB3cml0ZXMsIGNyZWF0ZXMpIGhhdmUgbm90aGluZyB0byBpbnRlcnNlY3QgYW5kXG4gKiBhcmUgc2tpcHBlZCBoZXJlIFx1MjAxNCBtYXRjaGluZyB0aGUgQ2xhdWRlIGhhbmRsZXIsIHdoaWNoIGRvZXMgbm90IHN1cmZhY2Ugb24gYVxuICogd2hvbGUtZmlsZSB3cml0ZS4gVGhlIHNlc3Npb24gbWVtbyBkZWR1cGVzIHNsdWdzIGFscmVhZHkgc3VyZmFjZWQgdGhpcyBzZXNzaW9uLlxuICpcbiAqIGB0b29sX2lucHV0YCBpcyB0eXBlZCBgdW5rbm93bmAgYnkgdGhlIFNESzsgd2UgbmFycm93IGl0IHRvIGB7IGNvbW1hbmQgfWAuXG4gKiBUaGUgdGltZW91dCBpcyBtaWxsaXNlY29uZHMgaW4gdGhlIGhhbmRsZXIgY29uZmlnICh0aGUgQ0xJIGVtaXRzIGAxMGAgc2Vjb25kcykuXG4gKi9cblxuaW1wb3J0IHsgdHlwZSBIb29rQ29udGV4dCwgdHlwZSBQcmVUb29sVXNlSW5wdXQsIHByZVRvb2xVc2VIb29rLCBwcmVUb29sVXNlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NvZGV4LWhvb2tzJztcbmltcG9ydCB7IGFic3BhdGhBZ2FpbnN0IH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyB0eXBlIEhvb2tJZ25vcmVMb2FkZXIsIGxvYWRIb29rSWdub3JlIH0gZnJvbSAnLi4vY29tbW9uL3NwYW4taWdub3JlLmpzJztcbmltcG9ydCB7XG4gIGNyZWF0ZURlZmF1bHRTcGFuRXhlY3V0b3IsXG4gIGNyZWF0ZURlZmF1bHRTdGFsZUV4ZWN1dG9yLFxuICBkaXNrTWVtb0ZhY3RvcnksXG4gIHR5cGUgTWVtb0ZhY3RvcnksXG4gIHJlc29sdmVUb3VjaFNjb3BlLFxuICB0eXBlIFNwYW5FeGVjdXRvcixcbiAgdHlwZSBTdGFsZUV4ZWN1dG9yLFxuICBzdXJmYWNlT3ZlcmxhcHBpbmdTcGFuc1xufSBmcm9tICcuLi9jb21tb24vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7IGRlZmF1bHRSZWFkUHJlRWRpdEZpbGUsIHBhcnNlQXBwbHlQYXRjaCwgdHlwZSBSZWFkUHJlRWRpdEZpbGUgfSBmcm9tICcuL2FwcGx5LXBhdGNoLmpzJztcblxuLyoqIE5hcnJvdyB0aGUgU0RLJ3MgYHVua25vd25gIHRvb2xfaW5wdXQgdG8gdGhlIGBhcHBseV9wYXRjaGAgYHsgY29tbWFuZCB9YCBzaGFwZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnY29tbWFuZCcgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgY29tbWFuZCA9ICh0b29sSW5wdXQgYXMgeyBjb21tYW5kOiB1bmtub3duIH0pLmNvbW1hbmQ7XG4gICAgaWYgKHR5cGVvZiBjb21tYW5kID09PSAnc3RyaW5nJykgcmV0dXJuIGNvbW1hbmQ7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVIYW5kbGVyKFxuICBleGVjdXRvcjogU3BhbkV4ZWN1dG9yLFxuICBtZW1vRmFjdG9yeTogTWVtb0ZhY3RvcnksXG4gIGxvYWRSdWxlczogSG9va0lnbm9yZUxvYWRlciA9IGxvYWRIb29rSWdub3JlLFxuICBzdGFsZUV4ZWN1dG9yOiBTdGFsZUV4ZWN1dG9yID0gY3JlYXRlRGVmYXVsdFN0YWxlRXhlY3V0b3IoKSxcbiAgcmVhZFByZUVkaXRGaWxlOiBSZWFkUHJlRWRpdEZpbGUgPSBkZWZhdWx0UmVhZFByZUVkaXRGaWxlXG4pIHtcbiAgcmV0dXJuIChpbnB1dDogUHJlVG9vbFVzZUlucHV0LCBjdHg6IEhvb2tDb250ZXh0KSA9PiB7XG4gICAgY29uc3QgY29tbWFuZCA9IG5hcnJvd0FwcGx5UGF0Y2hDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgIGlmIChjb21tYW5kID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgY29uc3Qgc2Vzc2lvbklkID0gaW5wdXQuc2Vzc2lvbl9pZDtcbiAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgY29uc3QgbWVtbyA9IG1lbW9GYWN0b3J5KGN0eC5sb2dnZXIpO1xuICAgIGNvbnN0IGRlcHMgPSB7IGV4ZWN1dG9yLCBzdGFsZUV4ZWN1dG9yLCBtZW1vLCBsb2FkUnVsZXMsIGxvZ2dlcjogY3R4LmxvZ2dlciB9O1xuXG4gICAgLy8gUGFyc2UgdGhlIGVudmVsb3BlIGludG8gcGVyLWZpbGUgYW5jaG9ycywgdGhlbiBzdXJmYWNlIHNwYW5zIG92ZXJsYXBwaW5nXG4gICAgLy8gZWFjaCByZWNvdmVyZWQgcmFuZ2UuIE9uZSBlbnZlbG9wZSBtYXkgdG91Y2ggc2V2ZXJhbCBmaWxlczsgdGhlIHNoYXJlZFxuICAgIC8vIG1lbW8gZGVkdXBlcyBhY3Jvc3MgYW5jaG9ycyB3aXRoaW4gdGhpcyBjYWxsIGFuZCBhY3Jvc3MgdGhlIHNlc3Npb24uXG4gICAgY29uc3QgYW5jaG9ycyA9IHBhcnNlQXBwbHlQYXRjaChjb21tYW5kLCByZWFkUHJlRWRpdEZpbGUpO1xuICAgIGNvbnN0IGJsb2Nrczogc3RyaW5nW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IGFuY2hvciBvZiBhbmNob3JzKSB7XG4gICAgICAvLyBXaG9sZS1maWxlIHdyaXRlcy9jcmVhdGVzIGNhcnJ5IG5vIHJhbmdlIFx1MjAxNCBub3RoaW5nIHRvIGludGVyc2VjdCBvbi5cbiAgICAgIGlmICghYW5jaG9yLnJhbmdlKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGFic1BhdGggPSBhYnNwYXRoQWdhaW5zdChjd2QsIGFuY2hvci5wYXRoKTtcbiAgICAgIGNvbnN0IHNjb3BlID0gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkLCBhYnNQYXRoKTtcbiAgICAgIGlmICghc2NvcGUpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgYmxvY2sgPSBzdXJmYWNlT3ZlcmxhcHBpbmdTcGFucyhkZXBzLCBzY29wZS5yZXBvUm9vdCwgc2NvcGUucmVwb1JlbFBhdGgsIGFuY2hvci5yYW5nZSwgc2Vzc2lvbklkKTtcbiAgICAgIGlmIChibG9jaykgYmxvY2tzLnB1c2goYmxvY2spO1xuICAgIH1cblxuICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNvbWJpbmVkID0gYmxvY2tzLmpvaW4oJycpO1xuICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IGNvbWJpbmVkLCBzeXN0ZW1NZXNzYWdlOiBjb21iaW5lZCB9KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgcHJlVG9vbFVzZUhvb2soXG4gIHsgbWF0Y2hlcjogJ2FwcGx5X3BhdGNoJywgdGltZW91dDogMTBfMDAwIH0sXG4gIGNyZWF0ZUhhbmRsZXIoY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcigpLCBkaXNrTWVtb0ZhY3RvcnkpXG4pO1xuIiwgIi8qKlxuICogQ29kZXggUG9zdFRvb2xVc2UgaG9vayBcdTIwMTQgam91cm5hbCB0aGUgY29uZmlybWVkIGBhcHBseV9wYXRjaGAgd3JpdGUuXG4gKlxuICogUG9zdFRvb2xVc2UgZmlyZXMgYWZ0ZXIgYGFwcGx5X3BhdGNoYCBzdWNjZWVkcywgc28gdGhpcyBpcyB0aGUgYWNjdXJhdGUgaG9tZVxuICogZm9yIGpvdXJuYWxpbmcgdGhlIGFjdHVhbCB3cml0ZSAodGhlIGVkaXQgaGFzIGxhbmRlZCkgXHUyMDE0IHRoZSByZWNvbW1lbmRhdGlvbiBpblxuICogdGhlIGV2ZW50LW1hcHBpbmcgbm90ZSwgc2luY2UgdGhlIHJlY29uY2lsZXIgcnVucyBwb3N0LWNvbW1pdCBhbnl3YXkuIFRoaXNcbiAqIGhhbmRsZXIncyBvbmx5IGpvYiBpcyAqKmpvdXJuYWxpbmcqKjogaXQgcGFyc2VzIHRoZSBzYW1lIGBhcHBseV9wYXRjaGAgZW52ZWxvcGVcbiAqIChgdG9vbF9pbnB1dC5jb21tYW5kYCwgbmFycm93ZWQgZnJvbSB0aGUgU0RLJ3MgYHVua25vd25gKSBpbnRvIGBBbmNob3JTcGVjW11gXG4gKiB2aWEgdGhlIHNoYXJlZCBbYXBwbHktcGF0Y2ggcGFyc2VyXSguL2FwcGx5LXBhdGNoLnRzKSwgc2NvcGVzIGVhY2ggdG91Y2hlZCBmaWxlXG4gKiB0byB0aGUgQ1dEIHJlcG8gKGRyb3BwaW5nIGNyb3NzLXJlcG8sIGdpdGlnbm9yZWQsIGFuZCBzcGFuLWRvY3VtZW50IHBhdGhzIHZpYVxuICogdGhlIHNoYXJlZCBndWFyZCksIGFuZCBhcHBlbmRzIHRoZSB3cml0ZSBhbmNob3JzIHRvIHRoZSBwZXItc2Vzc2lvbiB0b3VjaFxuICogam91cm5hbCB0aGF0IHRoZSBTdG9wIGNvcmUgbGF0ZXIgZHJhaW5zIGludG8gYSBgUHJlQ29tbWl0UmVjb3JkYC5cbiAqXG4gKiBTcGFuIHN1cmZhY2luZyBpcyB0aGUgUHJlVG9vbFVzZSBob29rJ3Mgam9iIChiZWZvcmUgdGhlIHBhdGNoIGFwcGxpZXMpOyB0aGlzXG4gKiBob29rIG5ldmVyIHN1cmZhY2VzLiBUaGUgdGltZW91dCBpcyBtaWxsaXNlY29uZHMgaW4gdGhlIGhhbmRsZXIgY29uZmlnICh0aGVcbiAqIENMSSBlbWl0cyBgMTBgIHNlY29uZHMpIFx1MjAxNCBzZWUgdGhlIHRpbWVvdXQtdW5pdHMgc3Bpa2Ugbm90ZS5cbiAqL1xuXG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFBvc3RUb29sVXNlSW5wdXQsIHBvc3RUb29sVXNlSG9vaywgcG9zdFRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHsgYWJzcGF0aEFnYWluc3QgfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHJlc29sdmVUb3VjaFNjb3BlIH0gZnJvbSAnLi4vY29tbW9uL3NwYW4tc3VyZmFjZS5qcyc7XG5pbXBvcnQgeyBhcHBlbmRUb3VjaEpvdXJuYWwgfSBmcm9tICcuLi9jb21tb24vc3RvcC1jb3JlLmpzJztcbmltcG9ydCB7IGRlZmF1bHRSZWFkUHJlRWRpdEZpbGUsIHBhcnNlQXBwbHlQYXRjaCwgdHlwZSBSZWFkUHJlRWRpdEZpbGUgfSBmcm9tICcuL2FwcGx5LXBhdGNoLmpzJztcbmltcG9ydCB7IG5hcnJvd0FwcGx5UGF0Y2hDb21tYW5kIH0gZnJvbSAnLi9wcmUtdG9vbC11c2UuanMnO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSGFuZGxlcihyZWFkUHJlRWRpdEZpbGU6IFJlYWRQcmVFZGl0RmlsZSA9IGRlZmF1bHRSZWFkUHJlRWRpdEZpbGUpIHtcbiAgcmV0dXJuIChpbnB1dDogUG9zdFRvb2xVc2VJbnB1dCwgY3R4OiBIb29rQ29udGV4dCkgPT4ge1xuICAgIGNvbnN0IGNvbW1hbmQgPSBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHBvc3RUb29sVXNlT3V0cHV0KHt9KTtcblxuICAgIGNvbnN0IGN3ZCA9IGlucHV0LmN3ZCA/PyAnJztcbiAgICBjb25zdCBzZXNzaW9uSWQgPSBpbnB1dC5zZXNzaW9uX2lkO1xuXG4gICAgLy8gUGFyc2UgdGhlIGNvbmZpcm1lZCB3cml0ZSBpbnRvIHBlci1maWxlIGFuY2hvcnMsIHRoZW4gam91cm5hbCBlYWNoIG9uZSB0aGF0XG4gICAgLy8gc2NvcGVzIHRvIHRoZSBDV0QgcmVwby4gYHJlc29sdmVUb3VjaFNjb3BlYCBkcm9wcyBjcm9zcy1yZXBvLCBnaXRpZ25vcmVkLFxuICAgIC8vIGFuZCBzcGFuLWRvY3VtZW50IHBhdGhzIGFuZCB5aWVsZHMgdGhlIHJlcG8tcmVsYXRpdmUgcGF0aCB0aGUgam91cm5hbCBhbmRcbiAgICAvLyB0aGUgU3RvcCBkcmFpbiBleHBlY3QgXHUyMDE0IHRoZSBzYW1lIGludmFyaWFudCB0aGUgQ2xhdWRlIFByZVRvb2xVc2UgaG9vayBob2xkcy5cbiAgICBjb25zdCBhbmNob3JzID0gcGFyc2VBcHBseVBhdGNoKGNvbW1hbmQsIHJlYWRQcmVFZGl0RmlsZSk7XG4gICAgY29uc3QgZW50cmllczogQXJyYXk8e1xuICAgICAgcGF0aDogc3RyaW5nO1xuICAgICAga2luZDogKHR5cGVvZiBhbmNob3JzKVtudW1iZXJdWydraW5kJ107XG4gICAgICByYW5nZT86ICh0eXBlb2YgYW5jaG9ycylbbnVtYmVyXVsncmFuZ2UnXTtcbiAgICB9PiA9IFtdO1xuICAgIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcbiAgICAgIGNvbnN0IGFic1BhdGggPSBhYnNwYXRoQWdhaW5zdChjd2QsIGFuY2hvci5wYXRoKTtcbiAgICAgIGNvbnN0IHNjb3BlID0gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkLCBhYnNQYXRoKTtcbiAgICAgIGlmICghc2NvcGUpIGNvbnRpbnVlO1xuICAgICAgZW50cmllcy5wdXNoKHsgcGF0aDogc2NvcGUucmVwb1JlbFBhdGgsIGtpbmQ6IGFuY2hvci5raW5kLCByYW5nZTogYW5jaG9yLnJhbmdlIH0pO1xuICAgIH1cblxuICAgIGFwcGVuZFRvdWNoSm91cm5hbChzZXNzaW9uSWQsICdhcHBseV9wYXRjaCcsIGVudHJpZXMsIGN0eC5sb2dnZXIpO1xuXG4gICAgcmV0dXJuIHBvc3RUb29sVXNlT3V0cHV0KHt9KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgcG9zdFRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ2FwcGx5X3BhdGNoJywgdGltZW91dDogMTBfMDAwIH0sIGNyZWF0ZUhhbmRsZXIoKSk7XG4iLCAiaW1wb3J0IGhvb2sgZnJvbSBcIi4vcG9zdC10b29sLXVzZS50c1wiO1xuaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gXCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qc1wiO1xuZXhlY3V0ZShob29rKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUE0Qk8sSUFBTSwwQkFBMEIsb0JBQUksSUFBSSxDQUFDLGdCQUFnQixvQkFBb0IsZUFBZSxDQUFDOzs7QUM1QnBHLFNBQVMsZUFBZSxlQUFlLFFBQVEsU0FBUztBQUNwRCxRQUFNLE9BQU87QUFDYixPQUFLLGdCQUFnQjtBQUNyQixPQUFLLFVBQVUsT0FBTztBQUN0QixPQUFLLGdCQUFnQixPQUFPO0FBQzVCLE1BQUksYUFBYSxVQUFVLE9BQU8sT0FBTyxZQUFZLFVBQVU7QUFDM0QsU0FBSyxVQUFVLE9BQU87QUFBQSxFQUMxQjtBQUNBLFNBQU87QUFDWDtBQUNPLFNBQVMsZUFBZSxRQUFRLFNBQVM7QUFDNUMsU0FBTyxlQUFlLGNBQWMsUUFBUSxPQUFPO0FBQ3ZEO0FBQ08sU0FBUyxnQkFBZ0IsUUFBUSxTQUFTO0FBQzdDLFNBQU8sZUFBZSxlQUFlLFFBQVEsT0FBTztBQUN4RDs7O0FDZkEsU0FBUyxXQUFXLFlBQVksV0FBVyxVQUFVLGlCQUFpQjtBQUN0RSxTQUFTLGVBQWU7QUFDeEIsSUFBTSxzQkFBc0I7QUFDckIsSUFBTSxTQUFOLE1BQWE7QUFBQSxFQUNoQixXQUFXLG9CQUFJLElBQUk7QUFBQSxFQUNuQixrQkFBa0I7QUFBQSxFQUNsQixZQUFZO0FBQUEsRUFDWixjQUFjO0FBQUEsRUFDZDtBQUFBLEVBQ0E7QUFBQSxFQUNBLFlBQVksU0FBUyxDQUFDLEdBQUc7QUFDckIsU0FBSyxjQUFjLE9BQU8sZUFBZSxRQUFRLElBQUksT0FBTyxhQUFhLG1CQUFtQixLQUFLO0FBQUEsRUFDckc7QUFBQSxFQUNBLFdBQVcsVUFB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TSxNQUFNLE9BQU87QUFDekIsVUFBTSxZQUFZLE1BQU07QUFNeEIsVUFBTSxVQUFVLGdCQUFnQixTQUFTLGVBQWU7QUFDeEQsVUFBTSxVQUlELENBQUM7QUFDTixlQUFXLFVBQVUsU0FBUztBQUM1QixZQUFNLFVBQVUsZUFBZSxLQUFLLE9BQU8sSUFBSTtBQUMvQyxZQUFNLFFBQVEsa0JBQWtCLEtBQUssT0FBTztBQUM1QyxVQUFJLENBQUMsTUFBTztBQUNaLGNBQVEsS0FBSyxFQUFFLE1BQU0sTUFBTSxhQUFhLE1BQU0sT0FBTyxNQUFNLE9BQU8sT0FBTyxNQUFNLENBQUM7QUFBQSxJQUNsRjtBQUVBLHVCQUFtQixXQUFXLGVBQWUsU0FBUyxJQUFJLE1BQU07QUFFaEUsV0FBTyxrQkFBa0IsQ0FBQyxDQUFDO0FBQUEsRUFDN0I7QUFDRjtBQUVBLElBQU8sd0JBQVEsZ0JBQWdCLEVBQUUsU0FBUyxlQUFlLFNBQVMsSUFBTyxHQUFHQSxlQUFjLENBQUM7OztBQ3REM0YsUUFBUSxxQkFBSTsiLAogICJuYW1lcyI6IFsicmVzb2x2ZSIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAib3MiLCAibm9kZVBhdGgiLCAiZnMiLCAibm9kZVBhdGgiLCAiY2FuZGlkYXRlcyIsICJleGVjRmlsZVN5bmMiLCAibG9nZ2VyIiwgImZzIiwgIm9zIiwgIm5vZGVQYXRoIiwgImxvZ2dlciIsICJmcyIsICJ0b1Bvc2l4IiwgImN0eCIsICJjcmVhdGVIYW5kbGVyIl0KfQo=
