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
import { execFileSync as execFileSync2 } from "node:child_process";
import * as fs3 from "node:fs";
import * as os2 from "node:os";
import * as nodePath3 from "node:path";
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

// src/codex/apply-patch.ts
import * as fs4 from "node:fs";
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
    return fs4.readFileSync(path, "utf8");
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

// src/codex/pre-tool-use-entry.ts
execute(pre_tool_use_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1zdXJmYWNlLnRzIiwgInNyYy9jb2RleC9hcHBseS1wYXRjaC50cyIsICJzcmMvY29kZXgvcHJlLXRvb2wtdXNlLnRzIiwgInNyYy9jb2RleC9wcmUtdG9vbC11c2UtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQYXRoIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbmZ1bmN0aW9uIGlzQWJzb2x1dGVQb3NpeChwOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHAuc3RhcnRzV2l0aCgnLycpIHx8IC9eW0EtWmEtel06XFwvLy50ZXN0KHApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWJzcGF0aEFnYWluc3QoYmFzZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHQgPSB0b1Bvc2l4KHRhcmdldCk7XG4gIGlmIChpc0Fic29sdXRlUG9zaXgodCkpIHJldHVybiB0O1xuICBjb25zdCBiID0gdG9Qb3NpeChiYXNlKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIGAke2J9LyR7dH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlcG9Sb290KGRpcjogc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWRpcikgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgZGlyLCAncmV2LXBhcnNlJywgJy0tc2hvdy10b3BsZXZlbCddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gb3V0LnRyaW0oKTtcbiAgICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdG9Qb3NpeCh0cmltbWVkKSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIHBhdGggaXMgZXhjbHVkZWQgYnkgZ2l0J3MgaWdub3JlIHJ1bGVzXG4gKiAoLmdpdGlnbm9yZSwgLmdpdC9pbmZvL2V4Y2x1ZGUsIGNvcmUuZXhjbHVkZXNGaWxlKS4gVXNlZCB0byBrZWVwIGlnbm9yZWRcbiAqIGZpbGVzIFx1MjAxNCBidWlsZCBvdXRwdXQsIGNhY2hlcywgbG9ncyBcdTIwMTQgb3V0IG9mIHRoZSB0b3VjaCBqb3VybmFsIGVudGlyZWx5LCBzb1xuICogdGhlIFN0b3AgaG9vayBuZXZlciByZXBvcnRzIHJlYWRzLCB3cml0ZXMsIG9yIHVuY292ZXJlZCB3cml0ZXMgb24gdGhlbS5cbiAqXG4gKiBgZ2l0IGNoZWNrLWlnbm9yZSAtcSA8cGF0aD5gIGV4aXRzIDAgd2hlbiB0aGUgcGF0aCBpcyBpZ25vcmVkLCAxIHdoZW4gaXQgaXNcbiAqIG5vdCwgYW5kIDEyOCBvbiBlcnJvci4gZXhlY0ZpbGVTeW5jIHRocm93cyBvbiBhbnkgbm9uLXplcm8gZXhpdCwgc28gYSBjbGVhblxuICogcmV0dXJuIG1lYW5zIFwiaWdub3JlZFwiLiBBIHN0YXR1cy0xIHRocm93IGlzIHRoZSBleHBlY3RlZCBcIm5vdCBpZ25vcmVkXCJcbiAqIHNpZ25hbDsgYW55IG90aGVyIGZhaWx1cmUgaXMgYW4gdW5yZWxpYWJsZSBhbnN3ZXIsIHNvIHdlIHJlcG9ydCBgZmFsc2VgXG4gKiAoZG8gbm90IGRyb3AgdGhlIHRvdWNoKSByYXRoZXIgdGhhbiBzaWxlbnRseSBoaWRpbmcgYSB0cmFja2VkIGZpbGUuXG4gKi9cbi8qKlxuICogVGhlIGRlZmF1bHQgc3BhbiByb290IGRpcmVjdG9yeSwgcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCwgdXNlZCB3aGVuIG5vXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBnaXQgY29uZmlnIG92ZXJyaWRlcyB0aGUgbG9jYXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOX1JPT1QgPSAnLnNwYW4nO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHNwYW4gcm9vdCBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gcmVwbywgbWlycm9yaW5nIHRoZSBSdXN0IENMSVxuICogcHJlY2VkZW5jZSAobWludXMgdGhlIC0tc3Bhbi1kaXIgQ0xJIGZsYWcsIHdoaWNoIGlzIGludmlzaWJsZSB0byBmaWxlLXdyaXRlXG4gKiBob29rcyk6XG4gKiAgIDEuIEdJVF9TUEFOX0RJUiBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICogICAyLiBgZ2l0IGNvbmZpZyBnaXQtc3Bhbi5kaXJgIGluIHRoZSByZXBvXG4gKiAgIDMuIERlZmF1bHQ6IFwiLnNwYW5cIlxuICpcbiAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIFBPU0lYLXN0eWxlIHBhdGggd2l0aCBubyB0cmFpbGluZyBzbGFzaC5cbiAqIEZhaWwtc2FmZTogYW55IHJlc29sdXRpb24gZXJyb3IgZmFsbHMgYmFjayB0byBcIi5zcGFuXCIgc28gdGhlIGhvb2sgbmV2ZXJcbiAqIGNyYXNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudkRpciA9IHByb2Nlc3MuZW52WydHSVRfU1BBTl9ESVInXTtcbiAgaWYgKGVudkRpciAmJiBlbnZEaXIudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gdG9Qb3NpeChlbnZEaXIudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY29uZmlnJywgJ2dpdC1zcGFuLmRpciddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSByZXR1cm4gdHJpbW1lZDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7IC8vIGNvbmZpZyBrZXkgYWJzZW50IG9yIGdpdCBlcnJvciBcdTIwMTQgZmFsbCB0aHJvdWdoIHRvIGRlZmF1bHRcbiAgfVxuICByZXR1cm4gU1BBTl9ST09UO1xufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRoIGZhbGxzIGluc2lkZSB0aGUgZ2l2ZW4gc3BhbiByb290XG4gKiBkaXJlY3RvcnkuIEEgcGF0aCBpcyBpbnNpZGUgd2hlbiBpdCBlcXVhbHMgdGhlIHNwYW4gcm9vdCBleGFjdGx5IG9yIGlzXG4gKiBuZXN0ZWQgYmVuZWF0aCBpdCAoaS5lLiBzdGFydHMgd2l0aCBcIjxzcGFuUm9vdD4vXCIpLiBUaGUgXCIvXCIgYm91bmRhcnkgcHJldmVudHNcbiAqIGZhbHNlIHBvc2l0aXZlcyBmb3Igc2libGluZ3MgbGlrZSBcIi5zcGFucy94XCIgb3IgXCIuc3Bhbi1ub3Rlcy94XCIuXG4gKlxuICogUGFzcyB0aGUgcmVzdWx0IG9mIGByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpYCBhcyBgc3BhblJvb3RgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aDogc3RyaW5nLCBzcGFuUm9vdDogc3RyaW5nID0gU1BBTl9ST09UKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvb3QgPSBzcGFuUm9vdC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIHJlcG9SZWxQYXRoID09PSByb290IHx8IHJlcG9SZWxQYXRoLnN0YXJ0c1dpdGgoYCR7cm9vdH0vYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0dpdElnbm9yZWQocmVwb1Jvb3Q6IHN0cmluZywgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY2hlY2staWdub3JlJywgJy1xJywgJy0tJywgcmVwb1JlbFBhdGhdLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAnaWdub3JlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgcm9vdCA9IHRvUG9zaXgocmVwb1Jvb3QpO1xuICBjb25zdCBhYnMgPSB0b1Bvc2l4KGFic1BhdGgpO1xuICBjb25zdCBwcmVmaXggPSByb290LmVuZHNXaXRoKCcvJykgPyByb290IDogYCR7cm9vdH0vYDtcbiAgcmV0dXJuIGFicy5zdGFydHNXaXRoKHByZWZpeCkgPyBhYnMuc2xpY2UocHJlZml4Lmxlbmd0aCkgOiBhYnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5vbmljYWxpemVQYXRoKGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShhYnNQYXRoKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCB5ZXQgKGUuZy4gV3JpdGUgdG8gYSBuZXcgZmlsZSk6IGNhbm9uaWNhbGl6ZSB0aGVcbiAgICAvLyBkaXJlY3RvcnkgYW5kIHJlam9pbiB0aGUgYmFzZW5hbWUgc28gc3ltbGlua3MgaW4gdGhlIHBhcmVudCBhcmUgcmVzb2x2ZWQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKSk7XG4gICAgICByZXR1cm4gYCR7ZGlyfS8ke25vZGVQYXRoLmJhc2VuYW1lKGFic1BhdGgpfWA7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQYXJlbnQgZG9lc24ndCBleGlzdCBlaXRoZXI7IGZhbGwgYmFjayB0byB0aGUgdW4tY2Fub25pY2FsaXplZCBwYXRoLlxuICAgICAgcmV0dXJuIGFic1BhdGg7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVQYXRoKHRvb2xJbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGN3ZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGZwID0gdG9vbElucHV0LmZpbGVfcGF0aDtcbiAgaWYgKHR5cGVvZiBmcCAhPT0gJ3N0cmluZycgfHwgZnAubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYWJzID0gYWJzcGF0aEFnYWluc3QoY3dkLCBmcCk7XG4gIHJldHVybiBjYW5vbmljYWxpemVQYXRoKGFicyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZSByYW5nZSB0eXBlcyBhbmQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZXNJbnRlcnNlY3QoYTogTGluZVJhbmdlLCBiOiBMaW5lUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuc3RhcnQgPD0gYi5lbmQgJiYgYS5lbmQgPj0gYi5zdGFydDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3JjZWxhaW4gcm93IHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcmNlbGFpblJvdyB7XG4gIG5hbWU6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtuYW1lLCBwYXRoLCByYW5nZV0gPSBwYXJ0cztcbiAgICBjb25zdCBkYXNoSWR4ID0gcmFuZ2UuaW5kZXhPZignLScpO1xuICAgIGlmIChkYXNoSWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBwYXJzZUludChyYW5nZS5zbGljZSgwLCBkYXNoSWR4KSwgMTApO1xuICAgIGNvbnN0IGVuZCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKGRhc2hJZHggKyAxKSwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3RhbGVQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgNikgY29udGludWU7XG4gICAgY29uc3QgWywgLCBuYW1lLCBwYXRoLCBzdGFydENvbCwgZW5kQ29sXSA9IHBhcnRzO1xuICAgIGNvbnN0IHN0YXJ0ID0gc3RhcnRDb2wgPT09ICcod2hvbGUpJyA/IDAgOiBwYXJzZUludChzdGFydENvbCwgMTApO1xuICAgIGNvbnN0IGVuZCA9IGVuZENvbCA9PT0gJy0nID8gMCA6IHBhcnNlSW50KGVuZENvbCwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIHdpdGggdGhlIFN0b3AgaG9vaydzIHRvdWNoIGpvdXJuYWwuIEVhY2ggc2Vzc2lvbiBnZXRzIG9uZVxuLy8gZGlyZWN0b3J5OyB0aGUgc3ViYWdlbnQgY291bnRlciBsaXZlcyBhbG9uZ3NpZGUgdGhlIGpvdXJuYWwgc28gdGhlXG4vLyBTdWJhZ2VudFN0YXJ0L1N1YmFnZW50U3RvcCBob29rcyAod3JpdGVycykgYW5kIHRoZSBTdG9wIGhvb2sgKHJlYWRlcikgYWdyZWUgb25cbi8vIGl0cyBsb2NhdGlvbi5cbmNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGVyLXNlc3Npb24gc3ViYWdlbnQgY291bnRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudENvdW50UGF0aChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCksICdzdWJhZ2VudC1jb3VudCcpO1xufVxuXG4vLyBMb2NrIGNvbnN0YW50c1xuY29uc3QgTE9DS19SRVRSWV9JTlRFUlZBTF9NUyA9IDU7XG4vLyBUaGUgY3JpdGljYWwgc2VjdGlvbiBpcyBhIG1pY3Jvc2Vjb25kLXNjYWxlIHJlYWQtbW9kaWZ5LXdyaXRlLCBzbyByZWFsXG4vLyBjb250ZW50aW9uIHJlc29sdmVzIGFsbW9zdCBpbW1lZGlhdGVseS4gQSBnZW5lcm91cyBidWRnZXQgKH41IHMgb2YgcmV0cmllcylcbi8vIG1lYW5zIHRoZSBvbmx5IHdheSB0byBleGhhdXN0IGl0IGlzIGEgZ2VudWluZWx5IGFiYW5kb25lZCBsb2NrIFx1MjAxNCB3aGljaCB0aGVcbi8vIHN0YWxlLWxvY2sgYnJlYWtlciByZWNsYWltcyBiZWxvdyBcdTIwMTQgcmF0aGVyIHRoYW4gb3JkaW5hcnkgY29udGVudGlvbi5cbmNvbnN0IExPQ0tfTUFYX1JFVFJJRVMgPSAxMDAwOyAvLyB+NSBzIHRvdGFsIGJ1ZGdldCBhdCA1IG1zL3JldHJ5XG4vLyBSZWNsYWltIGxvY2tzIG9sZGVyIHRoYW4gdGhpcy4gVGhlIGhvbGQgaXMgbWljcm9zZWNvbmQtc2NhbGUsIHNvIGEgdGhyZXNob2xkXG4vLyB0aGlzIGZhciBhYm92ZSBhbnkgcmVhbCBob2xkIHRpbWUgbWVhbnMgYSBsb2NrIHRoaXMgb2xkIGlzIGdlbnVpbmVseVxuLy8gYWJhbmRvbmVkIChhIGNyYXNoZWQva2lsbGVkIGhvbGRlciksIG5ldmVyIG9uZSBtaWQtY3JpdGljYWwtc2VjdGlvbi5cbmNvbnN0IExPQ0tfU1RBTEVfTVMgPSAzMF8wMDA7IC8vIDMwIHNcblxudHlwZSBDb3VudExvZ2dlciA9IHsgd2FybjogKG1zZzogc3RyaW5nLCBtZXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQgfSB8IHVuZGVmaW5lZDtcblxuLyoqXG4gKiBBY3F1aXJlIGFuIGV4Y2x1c2l2ZSBwZXItc2Vzc2lvbiBmaWxlc3lzdGVtIGxvY2suXG4gKlxuICogU3BpbnMgd2l0aCBMT0NLX1JFVFJZX0lOVEVSVkFMX01TIHNsZWVwcyB1cCB0byBMT0NLX01BWF9SRVRSSUVTIGF0dGVtcHRzLFxuICogZ2l2aW5nIGEgZ2VuZXJvdXMgYnVkZ2V0IHNvIG9yZGluYXJ5IGNvbnRlbnRpb24gbmV2ZXIgZXhoYXVzdHMgaXQuIEEgbG9ja1xuICogd2hvc2UgbXRpbWUgaXMgb2xkZXIgdGhhbiBMT0NLX1NUQUxFX01TIGlzIHRyZWF0ZWQgYXMgYWJhbmRvbmVkIGFuZCByZWNsYWltZWQuXG4gKlxuICogUmVjbGFpbSBpcyByYWNlLWZyZWU6IHRoZSBjb250ZW5kZXIgZmlyc3QgYXRvbWljYWxseSByZW5hbWVzIHRoZSBzdGFsZSBsb2NrIHRvXG4gKiBhIHVuaXF1ZSBzaWRlbGluZWQgbmFtZSAoYHJlbmFtZWAgaGFzIGV4YWN0bHkgb25lIHdpbm5lciBhY3Jvc3MgcHJvY2Vzc2VzKSxcbiAqIHRoZW4gdW5saW5rcyB0aGUgc2lkZWxpbmUgYW5kIHJldHJpZXMgdGhlIGV4Y2x1c2l2ZSBgb3Blbih3eClgLiBUd28gY29udGVuZGVyc1xuICogY2Fubm90IGJvdGggd2luIHRoZSByZW5hbWUsIHNvIHRoZXkgY2Fubm90IGJvdGggYWNxdWlyZSBcdTIwMTQgYXQgbW9zdCBvbmUgcmVjbGFpbXNcbiAqIGFuZCB0aGUgcmVzdCBmYWxsIGJhY2sgdG8gdGhlIG5vcm1hbCBleGNsdXNpdmUtY3JlYXRlIGNvbnRlbnRpb24uXG4gKlxuICogUmV0dXJucyB0aGUgbG9jayBwYXRoIGZvciB0aGUgY2FsbGVyIHRvIHVubGluayBpbiBmaW5hbGx5LlxuICovXG5mdW5jdGlvbiBhY3F1aXJlTG9jayhjb3VudEZpbGVQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBsb2NrUGF0aCA9IGAke2NvdW50RmlsZVBhdGh9LmxvY2tgO1xuICBsZXQgYXR0ZW1wdHMgPSAwO1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBmZCA9IGZzLm9wZW5TeW5jKGxvY2tQYXRoLCAnd3gnKTtcbiAgICAgIGZzLmNsb3NlU3luYyhmZCk7XG4gICAgICByZXR1cm4gbG9ja1BhdGg7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBlID0gZXJyIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbjtcbiAgICAgIGlmIChlLmNvZGUgIT09ICdFRVhJU1QnKSB0aHJvdyBlcnI7XG4gICAgICAvLyBMb2NrIGV4aXN0cyBcdTIwMTQgY2hlY2sgc3RhbGVuZXNzLlxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RhdCA9IGZzLnN0YXRTeW5jKGxvY2tQYXRoKTtcbiAgICAgICAgaWYgKERhdGUubm93KCkgLSBzdGF0Lm10aW1lTXMgPiBMT0NLX1NUQUxFX01TKSB7XG4gICAgICAgICAgLy8gQWJhbmRvbmVkOiByZWNsYWltIGF0b21pY2FsbHkuIFJlbmFtZSB0aGUgc3RhbGUgbG9jayBhc2lkZTsgb25seSBvbmVcbiAgICAgICAgICAvLyBjb250ZW5kZXIgY2FuIHdpbiB0aGlzIHJlbmFtZSwgc28gcmVjbGFpbSBjYW5ub3QgcmFjZSB0d28gYWNxdWlyZXJzLlxuICAgICAgICAgIGNvbnN0IHNpZGVsaW5lID0gYCR7bG9ja1BhdGh9LnN0YWxlLiR7cHJvY2Vzcy5waWR9LiR7cmFuZG9tVVVJRCgpfWA7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGZzLnJlbmFtZVN5bmMobG9ja1BhdGgsIHNpZGVsaW5lKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGZzLnVubGlua1N5bmMoc2lkZWxpbmUpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZTIpIHtcbiAgICAgICAgICAgICAgdm9pZCBlMjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGNhdGNoIChlMikge1xuICAgICAgICAgICAgLy8gTG9zdCB0aGUgcmVuYW1lIHJhY2UgKGFub3RoZXIgY29udGVuZGVyIHJlY2xhaW1lZCBpdCkgb3IgdGhlIGxvY2tcbiAgICAgICAgICAgIC8vIHZhbmlzaGVkIFx1MjAxNCBlaXRoZXIgd2F5LCByZXRyeSB0aGUgZXhjbHVzaXZlIGNyZWF0ZS5cbiAgICAgICAgICAgIHZvaWQgZTI7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gTG9jayBkaXNhcHBlYXJlZCBiZXR3ZWVuIGV4aXN0ZW5jZSBjaGVjayBhbmQgc3RhdCBcdTIwMTQgcmV0cnkuXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCsrYXR0ZW1wdHMgPj0gTE9DS19NQVhfUkVUUklFUykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHN1YmFnZW50LWNvdW50OiBjb3VsZCBub3QgYWNxdWlyZSBsb2NrIGFmdGVyICR7TE9DS19NQVhfUkVUUklFU30gcmV0cmllc2ApO1xuICAgICAgfVxuICAgICAgLy8gQnVzeS13YWl0IHdpdGggYSBzeW5jaHJvbm91cyBzbGVlcCAoaG9va3MgYXJlIHNob3J0LWxpdmVkIHByb2Nlc3NlcykuXG4gICAgICBBdG9taWNzLndhaXQobmV3IEludDMyQXJyYXkobmV3IFNoYXJlZEFycmF5QnVmZmVyKDQpKSwgMCwgMCwgTE9DS19SRVRSWV9JTlRFUlZBTF9NUyk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUmVhZCBhbmQgcGFyc2UgdGhlIGNvdW50IGZpbGUuIERpc3Rpbmd1aXNoZXMgdGhyZWUgc3RhdGVzOlxuICogICAtIGFic2VudCAoRU5PRU5UKSBcdTIxOTIgMCAobGVnaXRpbWF0ZSBcIm5vIHN1YmFnZW50IGhhcyBzdGFydGVkIHRoaXMgc2Vzc2lvblwiKVxuICogICAtIHByZXNlbnQgYnV0IGVtcHR5IC8gdW5wYXJzZWFibGUgLyBuZWdhdGl2ZSBcdTIxOTIgdGhyb3dzIChhbWJpZ3VvdXM7IHRoZSBjYWxsZXJcbiAqICAgICBtdXN0IGZhaWwgY2xvc2VkIGFuZCBzdXBwcmVzcyByYXRoZXIgdGhhbiB0cmVhdCBhcyAwKVxuICogICAtIHByZXNlbnQgYW5kIGEgdmFsaWQgbm9uLW5lZ2F0aXZlIGludGVnZXIgXHUyMTkyIHRoYXQgdmFsdWVcbiAqXG4gKiBBbnkgbm9uLUVOT0VOVCBJL08gZXJyb3IgKEVBQ0NFUywgRUlPLCBFSVNESVIsIFx1MjAyNikgcHJvcGFnYXRlcyB1bmNoYW5nZWQuXG4gKi9cbmZ1bmN0aW9uIHJlYWRDb3VudFJhdyhjb3VudEZpbGVQYXRoOiBzdHJpbmcpOiBudW1iZXIge1xuICBsZXQgcmF3OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcmF3ID0gZnMucmVhZEZpbGVTeW5jKGNvdW50RmlsZVBhdGgsICd1dGY4JykudHJpbSgpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zdCBlID0gZXJyIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbjtcbiAgICBpZiAoZS5jb2RlID09PSAnRU5PRU5UJykgcmV0dXJuIDA7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGlmICghcmF3KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBzdWJhZ2VudC1jb3VudDogY291bnQgZmlsZSBpcyBwcmVzZW50IGJ1dCBlbXB0eTogJHtjb3VudEZpbGVQYXRofWApO1xuICB9XG4gIGNvbnN0IG4gPSBwYXJzZUludChyYXcsIDEwKTtcbiAgaWYgKE51bWJlci5pc05hTihuKSB8fCBuIDwgMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgc3ViYWdlbnQtY291bnQ6IGNvdW50IGZpbGUgaG9sZHMgYW4gdW5wYXJzZWFibGUgb3IgbmVnYXRpdmUgdmFsdWU6ICR7SlNPTi5zdHJpbmdpZnkocmF3KX1gKTtcbiAgfVxuICByZXR1cm4gbjtcbn1cblxuLyoqXG4gKiBBdG9taWNhbGx5IHBlcnNpc3QgdGhlIGNvdW50OiB3cml0ZSBhIHVuaXF1ZWx5LW5hbWVkIHRlbXAgZmlsZSBpbiB0aGUgc2FtZVxuICogZGlyZWN0b3J5LCB0aGVuIGByZW5hbWVgIGl0IGludG8gcGxhY2UuIFJlbmFtZSBpcyBhdG9taWMgb24gdGhlIHNhbWVcbiAqIGZpbGVzeXN0ZW0sIHNvIGEgY29uY3VycmVudCBsb2NrLWZyZWUgcmVhZGVyIG9ic2VydmVzIGVpdGhlciB0aGUgb2xkIGNvbXBsZXRlXG4gKiBmaWxlIG9yIHRoZSBuZXcgY29tcGxldGUgZmlsZSBcdTIwMTQgbmV2ZXIgYSB0b3JuIG9yIHplcm8tYnl0ZSBpbnRlcm1lZGlhdGUuIFRoZVxuICogdGVtcCBuYW1lIGNhcnJpZXMgdGhlIHBpZCBhbmQgYSB1dWlkIHNvIHR3byB3cml0ZXJzIG5ldmVyIGNvbGxpZGUuIE1pcnJvcnNcbiAqIGB3cml0ZUpvdXJuYWxgIGluIHN0b3AudHMuXG4gKi9cbmZ1bmN0aW9uIHdyaXRlQ291bnRBdG9taWMoY291bnRGaWxlUGF0aDogc3RyaW5nLCB2YWx1ZTogbnVtYmVyIHwgc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHRtcFBhdGggPSBgJHtjb3VudEZpbGVQYXRofS50bXAuJHtwcm9jZXNzLnBpZH0uJHtyYW5kb21VVUlEKCl9YDtcbiAgdHJ5IHtcbiAgICBmcy53cml0ZUZpbGVTeW5jKHRtcFBhdGgsIGAke3ZhbHVlfWAsICd1dGY4Jyk7XG4gICAgZnMucmVuYW1lU3luYyh0bXBQYXRoLCBjb3VudEZpbGVQYXRoKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgLy8gQmVzdC1lZmZvcnQgY2xlYW51cCBvZiB0aGUgdGVtcCBmaWxlIG9uIGZhaWx1cmUsIHRoZW4gcmUtdGhyb3cgc28gdGhlXG4gICAgLy8gY2FsbGVyIChpbmNyZW1lbnRTdWJhZ2VudENvdW50L2RlY3JlbWVudFN1YmFnZW50Q291bnQpIGxvZ3MgaXQuXG4gICAgdHJ5IHtcbiAgICAgIGZzLnVubGlua1N5bmModG1wUGF0aCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdm9pZCBlO1xuICAgIH1cbiAgICB0aHJvdyBlcnI7XG4gIH1cbn1cblxuZnVuY3Rpb24gd2l0aENvdW50TG9jayhjb3VudEZpbGVQYXRoOiBzdHJpbmcsIGZuOiAoY3VycmVudDogbnVtYmVyKSA9PiBudW1iZXIpOiB2b2lkIHtcbiAgLy8gRW5zdXJlIHRoZSBzZXNzaW9uIGRpcmVjdG9yeSBleGlzdHMgYmVmb3JlIGFjcXVpcmluZyB0aGUgbG9jayBcdTIwMTQgdGhlIGxvY2tcbiAgLy8gZmlsZSBsaXZlcyBpbiB0aGUgc2FtZSBkaXJlY3RvcnkgYXMgdGhlIGNvdW50IGZpbGUuXG4gIGZzLm1rZGlyU3luYyhub2RlUGF0aC5kaXJuYW1lKGNvdW50RmlsZVBhdGgpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgY29uc3QgbG9ja1BhdGggPSBhY3F1aXJlTG9jayhjb3VudEZpbGVQYXRoKTtcbiAgdHJ5IHtcbiAgICAvLyBVbmRlciB0aGUgbG9jayB0aGUgZmlsZSBpcyBuZXZlciB0b3JuLCBzbyBhIHByZXNlbnQtYnV0LWVtcHR5L3VucGFyc2VhYmxlXG4gICAgLy8gcmVhZCBoZXJlIHdvdWxkIGJlIGdlbnVpbmUgY29ycnVwdGlvbjsgcmVhZENvdW50UmF3IHRocm93cyBhbmQgd2UgbGV0IGl0XG4gICAgLy8gcHJvcGFnYXRlIHRvIHRoZSBjYWxsZXIncyBjYXRjaCByYXRoZXIgdGhhbiBzaWxlbnRseSByZXNldHRpbmcgdG8gMC5cbiAgICBjb25zdCBjdXJyZW50ID0gcmVhZENvdW50UmF3KGNvdW50RmlsZVBhdGgpO1xuICAgIGNvbnN0IG5leHQgPSBmbihjdXJyZW50KTtcbiAgICB3cml0ZUNvdW50QXRvbWljKGNvdW50RmlsZVBhdGgsIG5leHQpO1xuICB9IGZpbmFsbHkge1xuICAgIHRyeSB7XG4gICAgICBmcy51bmxpbmtTeW5jKGxvY2tQYXRoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB2b2lkIGU7XG4gICAgfVxuICB9XG59XG5cbi8vIFRoZSBtYXJrZXIgYW4gaW5jcmVtZW50IHdyaXRlcyB3aGVuIGl0IGNhbm5vdCBjb21wbGV0ZSBpdHMgcmVhZC1tb2RpZnktd3JpdGVcbi8vIChlLmcuIGxvY2stYnVkZ2V0IGV4aGF1c3Rpb24gb3IgY291bnQtZmlsZSBjb3JydXB0aW9uKS4gSXQgaXMgZGVsaWJlcmF0ZWx5XG4vLyB1bnBhcnNlYWJsZSBzbyBldmVyeSBzdWJzZXF1ZW50IHJlYWRDb3VudFJhdyBjYWxsIHRocm93cyBcdTIwMTQgaW5jbHVkaW5nIGFueVxuLy8gbGF0ZXIgaW5jcmVtZW50J3MgcHJlLXdyaXRlIHJlYWQgaW5zaWRlIHdpdGhDb3VudExvY2sgXHUyMDE0IHdoaWNoIG1lYW5zIG5vXG4vLyBzdWNjZXNzZnVsIFJNVyBjYW4gZXZlciByZS1lc3RhYmxpc2ggYSBudW1lcmljIGNvdW50IG9uY2UgdGhlIG1hcmtlciBpcyBvblxuLy8gZGlzay4gVGhlIGxhdGNoIGlzIHBlcm1hbmVudCBmb3IgdGhlIHJlbWFpbmRlciBvZiB0aGUgc2Vzc2lvbjogdGhlIFN0b3AgaG9va1xuLy8gd2lsbCBzdXBwcmVzcyBzcGFuLXJldmlldyBkaXNwYXRjaCBvbiBldmVyeSBTdG9wIGZvciB0aGlzIHNlc3Npb24sIGFuZFxuLy8gcmVjb3ZlcnkgcmVxdWlyZXMgYSBmcmVzaCBzZXNzaW9uIChuZXcgc2Vzc2lvbiBpZCBcdTIxOTIgbmV3IHBlci1zZXNzaW9uXG4vLyBkaXJlY3RvcnkpLiBUaGlzIGlzIHRoZSBzYWZlIChmYWlsLWNsb3NlZCkgZGlyZWN0aW9uIGFuZCBpcyBjb25zaXN0ZW50IHdpdGhcbi8vIHRoZSBhY2NlcHRlZCBcImNyYXNoZWQgc3ViYWdlbnQgbGVha3MgdGhlIGNvdW50IGFuZCBzdXBwcmVzc2VzIHNlc3Npb24td2lkZVwiXG4vLyBsaW1pdGF0aW9uLlxuY29uc3QgQ09VTlRfRkFJTENMT1NFRF9NQVJLRVIgPSAnRkFJTF9DTE9TRUQnO1xuXG4vKipcbiAqIEluY3JlbWVudCB0aGUgcGVyLXNlc3Npb24gYWN0aXZlLXN1YmFnZW50IGNvdW50IGJ5IDEuIEF0b21pYyBSTVcgdW5kZXIgYVxuICogcGVyLXNlc3Npb24gZmlsZXN5c3RlbSBsb2NrLlxuICpcbiAqIE5vbi1mYXRhbCB0byB0aGUgaG9vazogYSBmYWlsdXJlIGlzIGxvZ2dlZCwgbmV2ZXIgdGhyb3duLiBCdXQgYW4gaW5jcmVtZW50XG4gKiBtdXN0IG5ldmVyIHNpbGVudGx5IHVuZGVyY291bnQgXHUyMDE0IGEgZHJvcHBlZCArMSBsZXRzIGEgbGF0ZXIgU3RvcCByZWFkIGFcbiAqIHRvby1sb3cgY291bnQgYW5kIGRpc3BhdGNoIG1pZC1mYW4tb3V0IChmYWlsLW9wZW4pLiBTbyB3aGVuIHRoZSBSTVcgY2Fubm90IGJlXG4gKiBjb21wbGV0ZWQgKGUuZy4gdGhlIGxvY2sgYnVkZ2V0IGlzIGV4aGF1c3RlZCBieSBhIGdlbnVpbmVseSBzdHVjayBob2xkZXIpLCB3ZVxuICogd3JpdGUgYSBmYWlsLWNsb3NlZCBtYXJrZXIgdGhhdCBtYWtlcyB0aGUgbG9jay1mcmVlIFN0b3AgcmVhZCB0aHJvdyBhbmQgdGhlXG4gKiBTdG9wIGhvb2sgc3VwcHJlc3MsIHJhdGhlciB0aGFuIGxlYXZpbmcgYSBzdGFsZSBsb3cgbnVtYmVyIGluIHBsYWNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaW5jcmVtZW50U3ViYWdlbnRDb3VudChzZXNzaW9uSWQ6IHN0cmluZywgbG9nZ2VyPzogQ291bnRMb2dnZXIpOiB2b2lkIHtcbiAgY29uc3QgY291bnRQYXRoID0gc3ViYWdlbnRDb3VudFBhdGgoc2Vzc2lvbklkKTtcbiAgdHJ5IHtcbiAgICB3aXRoQ291bnRMb2NrKGNvdW50UGF0aCwgKG4pID0+IG4gKyAxKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyPy53YXJuKCdmYWlsZWQgdG8gaW5jcmVtZW50IHN1YmFnZW50IGNvdW50OyB3cml0aW5nIGZhaWwtY2xvc2VkIG1hcmtlcicsIHsgZXJyIH0pO1xuICAgIC8vIEZhaWwgY2xvc2VkOiBhbiB1bnBhcnNlYWJsZSBjb3VudCBzdXBwcmVzc2VzIGRpc3BhdGNoIChzZWUgcmVhZENvdW50UmF3KS5cbiAgICB0cnkge1xuICAgICAgZnMubWtkaXJTeW5jKG5vZGVQYXRoLmRpcm5hbWUoY291bnRQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICB3cml0ZUNvdW50QXRvbWljKGNvdW50UGF0aCwgQ09VTlRfRkFJTENMT1NFRF9NQVJLRVIpO1xuICAgIH0gY2F0Y2ggKGVycjIpIHtcbiAgICAgIGxvZ2dlcj8ud2FybignZmFpbGVkIHRvIHdyaXRlIGZhaWwtY2xvc2VkIHN1YmFnZW50LWNvdW50IG1hcmtlcicsIHsgZXJyOiBlcnIyIH0pO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIERlY3JlbWVudCB0aGUgcGVyLXNlc3Npb24gYWN0aXZlLXN1YmFnZW50IGNvdW50IGJ5IDEsIGZsb29yaW5nIGF0IHplcm8uXG4gKiBBdG9taWMgUk1XIHVuZGVyIGEgcGVyLXNlc3Npb24gZmlsZXN5c3RlbSBsb2NrLiBCZXN0LWVmZm9ydCBcdTIwMTQgYSBmYWlsdXJlIGlzXG4gKiBsb2dnZWQgYW5kIHN3YWxsb3dlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlY3JlbWVudFN1YmFnZW50Q291bnQoc2Vzc2lvbklkOiBzdHJpbmcsIGxvZ2dlcj86IENvdW50TG9nZ2VyKTogdm9pZCB7XG4gIHRyeSB7XG4gICAgd2l0aENvdW50TG9jayhzdWJhZ2VudENvdW50UGF0aChzZXNzaW9uSWQpLCAobikgPT4gTWF0aC5tYXgoMCwgbiAtIDEpKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyPy53YXJuKCdmYWlsZWQgdG8gZGVjcmVtZW50IHN1YmFnZW50IGNvdW50JywgeyBlcnIgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBSZWFkIHRoZSBjdXJyZW50IGFjdGl2ZS1zdWJhZ2VudCBjb3VudC5cbiAqXG4gKiBGYWlsLWNsb3NlZCBjb250cmFjdCBmb3IgdGhlIFN0b3AgaG9vazogdGhlIG9ubHkgc3RhdGUgdGhhdCBsZWdpdGltYXRlbHkgbWVhbnNcbiAqIFwiMCBhY3RpdmUgc3ViYWdlbnRzLCBkaXNwYXRjaCBub3JtYWxseVwiIGlzIHRoZSBjb3VudCBmaWxlIGJlaW5nICoqYWJzZW50KiosIHNvXG4gKiBhYnNlbnQgXHUyMTkyIDAuIEV2ZXJ5IG90aGVyIGFtYmlndWl0eSBcdTIwMTQgYW4gSS9PL3Blcm1pc3Npb24gZXJyb3IsIGFuIHVucmVhZGFibGVcbiAqIHBhdGgsIGEgdG9ybi9lbXB0eS9wYXJ0aWFsL3VucGFyc2VhYmxlIGZpbGUgXHUyMDE0ICoqdGhyb3dzKiosIHNvIHRoZSBjYWxsZXJcbiAqIChzdG9wLnRzIFN0ZXAgMC41KSBzdXBwcmVzc2VzIGRpc3BhdGNoIHJhdGhlciB0aGFuIGRpc3BhdGNoaW5nIG9uIGEgdmFsdWUgaXRcbiAqIGNhbm5vdCBjb25maWRlbnRseSBjb25maXJtLiBUaGlzIGRlbGliZXJhdGVseSBkb2VzIE5PVCBzd2FsbG93IGVycm9ycyB0byAwO1xuICogZG9pbmcgc28gd291bGQgbWFrZSBzdG9wLnRzJ3MgZmFpbC1jbG9zZWQgY2F0Y2ggZGVhZCBjb2RlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVhZFN1YmFnZW50Q291bnQoc2Vzc2lvbklkOiBzdHJpbmcpOiBudW1iZXIge1xuICByZXR1cm4gcmVhZENvdW50UmF3KHN1YmFnZW50Q291bnRQYXRoKHNlc3Npb25JZCkpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGtpbmQgYW5kIGFuY2hvciBmb3JtYXR0aW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVG91Y2hLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJyB8ICd3aG9sZS1yZWFkJyB8ICd3aG9sZS13cml0ZScgfCAnY3JlYXRlJztcblxuLyoqXG4gKiBGb3JtYXQgYSBzcGFuIGFuY2hvciBzdHJpbmcuXG4gKlxuICogLSBgd2hvbGUtcmVhZGAsIGB3aG9sZS13cml0ZWAsIGFuZCBgY3JlYXRlYDogcmV0dXJucyBqdXN0IHRoZSBwYXRoXG4gKiAtIGByZWFkYCBhbmQgYHdyaXRlYDogcmV0dXJucyBgcGF0aCNMPHN0YXJ0Pi1MPGVuZD5gIChyZXF1aXJlcyByYW5nZSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEFuY2hvcihwYXRoOiBzdHJpbmcsIGtpbmQ6IFRvdWNoS2luZCwgcmFuZ2U/OiBMaW5lUmFuZ2UpOiBzdHJpbmcge1xuICBpZiAoKGtpbmQgPT09ICdyZWFkJyB8fCBraW5kID09PSAnd3JpdGUnKSAmJiByYW5nZSkge1xuICAgIHJldHVybiBgJHtwYXRofSNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQW5jaG9yIHNwZWMgdHlwZSAoc2hhcmVkIHdpdGggcXVldWUgcmVjb3JkIHR5cGVzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5jaG9yU3BlYyB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogVG91Y2hLaW5kO1xuICByYW5nZT86IExpbmVSYW5nZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRdWV1ZSByZWNvcmQgdHlwZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFByZUNvbW1pdFJlY29yZCB7XG4gIGFuY2hvcnM6IEFuY2hvclNwZWNbXTtcbiAgY3JlYXRlZF9hdDogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvc3RDb21taXRSZWNvcmQgZXh0ZW5kcyBQcmVDb21taXRSZWNvcmQge1xuICBzaGE6IHN0cmluZztcbiAgYnJhbmNoOiBzdHJpbmc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKiogRGlyZWN0b3J5IGZvciBwcmUtY29tbWl0IHJlY29yZHMgKHdyaXR0ZW4gYnkgdGhlIFN0b3AgaG9vaykuICovXG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tbWl0RGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAncHJlLWNvbW1pdCcpO1xufVxuXG4vKiogRGlyZWN0b3J5IGZvciBwb3N0LWNvbW1pdCByZWNvcmRzIChwcm9tb3RlZCBmcm9tIHByZS1jb21taXQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBvc3RDb21taXREaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHF1ZXVlUm9vdChyZXBvUm9vdCksICdwb3N0LWNvbW1pdCcpO1xufVxuXG4vKiogRGlyZWN0b3J5IGZvciBjbGFpbWVkIHJlY29yZHMgKHBpY2tlZCB1cCBieSB0aGUgZGlzcGF0Y2hlcikuICovXG5leHBvcnQgZnVuY3Rpb24gY2xhaW1lZERpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocG9zdENvbW1pdERpcihyZXBvUm9vdCksICdjbGFpbWVkJyk7XG59XG5cbi8qKlxuICogRGlyZWN0b3J5IGZvciBhIHNpbmdsZSBjbGFpbSBzZXNzaW9uJ3MgcmVjb3Jkcywgc2NvcGVkIGJ5IGNsYWltIElELlxuICogQSBjbGFpbSBJRCBpcyBhIFVVSUQgc2hhcmVkIGJldHdlZW4gdGhlIGNsYWltIGRpcmVjdG9yeSBuYW1lIGFuZCB0aGVcbiAqIHJlY29uY2lsZXIgYWdlbnQncyBvd24gYC0tcmVzdW1lYCBzZXNzaW9uIGlkLCBzbyB0aGUgdHdvIGFsd2F5cyBtYXRjaC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsYWltRGlyRm9yKHJlcG9Sb290OiBzdHJpbmcsIGNsYWltSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKGNsYWltZWREaXIocmVwb1Jvb3QpLCBjbGFpbUlkKTtcbn1cblxuLyoqIERpcmVjdG9yeSBmb3Igc2NyYXRjaCB3b3JrdHJlZXMgY3JlYXRlZCBieSB0aGUgZGlzcGF0Y2hlci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzY3JhdGNoRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAnc2NyYXRjaCcpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFF1ZXVlIGxvY2tcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEFjcXVpcmUgYW4gZXhjbHVzaXZlIHF1ZXVlIGxvY2suXG4gKlxuICogU3BpbnMgd2l0aCBMT0NLX1JFVFJZX0lOVEVSVkFMX01TIHNsZWVwcyB1cCB0byBMT0NLX01BWF9SRVRSSUVTIGF0dGVtcHRzLlxuICogQSBsb2NrIHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gTE9DS19TVEFMRV9NUyBpcyB0cmVhdGVkIGFzIGFiYW5kb25lZCBhbmRcbiAqIHJlY2xhaW1lZCBhdG9taWNhbGx5IHZpYSByZW5hbWUgKyB1bmxpbmsgKHNhbWUgcGF0dGVybiBhcyBhY3F1aXJlTG9jaykuXG4gKi9cbmZ1bmN0aW9uIGFjcXVpcmVRdWV1ZUxvY2sobG9ja1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBhdHRlbXB0cyA9IDA7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGZkID0gZnMub3BlblN5bmMobG9ja1BhdGgsICd3eCcpO1xuICAgICAgZnMuY2xvc2VTeW5jKGZkKTtcbiAgICAgIHJldHVybiBsb2NrUGF0aDtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IGUgPSBlcnIgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uO1xuICAgICAgaWYgKGUuY29kZSAhPT0gJ0VFWElTVCcpIHRocm93IGVycjtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhsb2NrUGF0aCk7XG4gICAgICAgIGlmIChEYXRlLm5vdygpIC0gc3RhdC5tdGltZU1zID4gTE9DS19TVEFMRV9NUykge1xuICAgICAgICAgIGNvbnN0IHNpZGVsaW5lID0gYCR7bG9ja1BhdGh9LnN0YWxlLiR7cHJvY2Vzcy5waWR9LiR7cmFuZG9tVVVJRCgpfWA7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGZzLnJlbmFtZVN5bmMobG9ja1BhdGgsIHNpZGVsaW5lKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGZzLnVubGlua1N5bmMoc2lkZWxpbmUpO1xuICAgICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAgIHZvaWQgMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIHZvaWQgMDtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICgrK2F0dGVtcHRzID49IExPQ0tfTUFYX1JFVFJJRVMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGB3aXRoUXVldWVMb2NrOiBjb3VsZCBub3QgYWNxdWlyZSBsb2NrIGFmdGVyICR7TE9DS19NQVhfUkVUUklFU30gcmV0cmllc2ApO1xuICAgICAgfVxuICAgICAgQXRvbWljcy53YWl0KG5ldyBJbnQzMkFycmF5KG5ldyBTaGFyZWRBcnJheUJ1ZmZlcig0KSksIDAsIDAsIExPQ0tfUkVUUllfSU5URVJWQUxfTVMpO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEV4ZWN1dGUgYSBmdW5jdGlvbiB1bmRlciB0aGUgZXhjbHVzaXZlIHF1ZXVlIGxvY2suXG4gKiBUaGUgbG9jayBmaWxlIGlzIGF0IGA8cXVldWVSb290KHJlcG9Sb290KT4vLnF1ZXVlLmxvY2tgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd2l0aFF1ZXVlTG9jazxUPihyZXBvUm9vdDogc3RyaW5nLCBmbjogKCkgPT4gVCk6IFQge1xuICBjb25zdCBxUm9vdCA9IHF1ZXVlUm9vdChyZXBvUm9vdCk7XG4gIGNvbnN0IGxvY2tQYXRoID0gbm9kZVBhdGguam9pbihxUm9vdCwgJy5xdWV1ZS5sb2NrJyk7XG4gIGZzLm1rZGlyU3luYyhxUm9vdCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGNvbnN0IGFjcXVpcmVkUGF0aCA9IGFjcXVpcmVRdWV1ZUxvY2sobG9ja1BhdGgpO1xuICB0cnkge1xuICAgIHJldHVybiBmbigpO1xuICB9IGZpbmFsbHkge1xuICAgIHRyeSB7XG4gICAgICBmcy51bmxpbmtTeW5jKGFjcXVpcmVkUGF0aCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdm9pZCBlO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEF0b21pYyByZWNvcmQgSS9PXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZWFkIGFuZCBwYXJzZSBhIEpTT04gZmlsZS5cbiAqIFByb3BhZ2F0ZXMgRU5PRU5UIG9yIHBhcnNlIGVycm9ycyB0byB0aGUgY2FsbGVyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVhZEpzb25GaWxlPFQ+KHBhdGg6IHN0cmluZyk6IFQge1xuICBjb25zdCByYXcgPSBmcy5yZWFkRmlsZVN5bmMocGF0aCwgJ3V0ZjgnKTtcbiAgcmV0dXJuIEpTT04ucGFyc2UocmF3KSBhcyBUO1xufVxuXG4vKipcbiAqIEF0b21pY2FsbHkgd3JpdGUgYSBKU09OIGZpbGUgdXNpbmcgdG1wK3JlbmFtZS5cbiAqIFRoZSB0ZW1wIG5hbWUgY2FycmllcyB0aGUgcGlkIGFuZCBhIHV1aWQgc28gY29uY3VycmVudCB3cml0ZXJzIG5ldmVyIGNvbGxpZGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZUpzb25GaWxlQXRvbWljPFQ+KHBhdGg6IHN0cmluZywgZGF0YTogVCk6IHZvaWQge1xuICBjb25zdCB0bXBQYXRoID0gYCR7cGF0aH0udG1wLiR7cHJvY2Vzcy5waWR9LiR7cmFuZG9tVVVJRCgpfWA7XG4gIHRyeSB7XG4gICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBKU09OLnN0cmluZ2lmeShkYXRhKSwgJ3V0ZjgnKTtcbiAgICBmcy5yZW5hbWVTeW5jKHRtcFBhdGgsIHBhdGgpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0cnkge1xuICAgICAgZnMudW5saW5rU3luYyh0bXBQYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHZvaWQgMDtcbiAgICB9XG4gICAgdGhyb3cgZXJyO1xuICB9XG59XG5cbi8qKlxuICogQXRvbWljYWxseSBtb3ZlIChyZW5hbWUpIGEgcmVjb3JkIGZpbGUgZnJvbSBvbmUgZGlyZWN0b3J5IHRvIGFub3RoZXIuXG4gKiBCb3RoIHBhdGhzIG11c3QgcmVzaWRlIG9uIHRoZSBzYW1lIGZpbGVzeXN0ZW0gKGd1YXJhbnRlZWQgd2l0aGluIHRoZSBxdWV1ZSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtb3ZlUmVjb3JkKGZyb206IHN0cmluZywgdG86IHN0cmluZyk6IHZvaWQge1xuICBmcy5yZW5hbWVTeW5jKGZyb20sIHRvKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQcmUtY29tbWl0IHJlY29yZCB3cml0ZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFdyaXRlIGEgcHJlLWNvbW1pdCByZWNvcmQgdG8gdGhlIHF1ZXVlIGRpcmVjdG9yeS5cbiAqIFRoZSBmaWxlIGlzIHdyaXR0ZW4gYXRvbWljYWxseSAodG1wK3JlbmFtZSkgd2l0aCBhIHJhbmRvbSBVVUlEIGZpbGVuYW1lLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVQcmVDb21taXRSZWNvcmQocmVwb1Jvb3Q6IHN0cmluZywgcmVjb3JkOiBQcmVDb21taXRSZWNvcmQpOiB2b2lkIHtcbiAgY29uc3QgZGlyID0gcHJlQ29tbWl0RGlyKHJlcG9Sb290KTtcbiAgZnMubWtkaXJTeW5jKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGNvbnN0IHBhdGggPSBub2RlUGF0aC5qb2luKGRpciwgYCR7cmFuZG9tVVVJRCgpfS5qc29uYCk7XG4gIHdyaXRlSnNvbkZpbGVBdG9taWMocGF0aCwgcmVjb3JkKTtcbn1cbiIsICIvKipcbiAqIFBhdGgtc2NvcGVkIHNwYW4gc3VwcHJlc3Npb24gZm9yIHRoZSBhZ2VudCBob29rcy5cbiAqXG4gKiBTb21lIHNwYW5zIGFyZSBub2lzZSB3aGVuIGJyb3dzaW5nIGNlcnRhaW4gcGFydHMgb2YgdGhlIHRyZWUgXHUyMDE0IHdpa2kgb3JcbiAqIG1hcmtldGluZyBzcGFucyB0aGF0IGFuY2hvciBwcm9zZSwgc3VyZmFjZWQgaW5saW5lIHdoaWxlIHJlYWRpbmcgc291cmNlLFxuICogYWRkIGxpdHRsZS4gVGhpcyBtb2R1bGUgbGV0cyBhIHJlcG8gZGVjbGFyZSwgcGVyIHBhdGgsIHdoaWNoIHNwYW4gc2x1Z1xuICogcHJlZml4ZXMgdG8gaG9sZCBiYWNrLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uaG9va2lnbm9yZWAuIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhXG4gKiBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuLCBhIHNpbmdsZSBydW4gb2Ygd2hpdGVzcGFjZSwgdGhlbiBhXG4gKiBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBzcGFuIHNsdWcgcHJlZml4ZXMgdG8gc3VwcHJlc3MgZm9yIHBhdGhzIHRoZSBwYXR0ZXJuXG4gKiBtYXRjaGVzOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjIHdpa2ksbWFya2V0aW5nXG4gKlxuICogQSBzcGFuIHdob3NlIHNsdWcgYmVnaW5zIHdpdGggYHdpa2lgIG9yIGBtYXJrZXRpbmdgICh0aGUgc2x1ZyBlcXVhbHMgdGhlXG4gKiBwcmVmaXgsIG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgKSBpcyB0aGVuIG5ldmVyIHN1cmZhY2VkIGZvciBhbiBhbmNob3Igd2hvc2UgcGF0aFxuICogc2l0cyB1bmRlciBgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjYCBcdTIwMTQgbmVpdGhlciBpbmxpbmUgYnkgdGhlIFByZVRvb2xVc2UgaG9va1xuICogbm9yIGluIHRoZSBTdG9wIGhvb2sncyBzdGFsZSAvIHJlbGF0ZWQgc2VjdGlvbnMuXG4gKlxuICogUGF0dGVybiBncmFtbWFyIGlzIGEgZGVsaWJlcmF0ZSBzdWJzZXQgb2YgZ2l0aWdub3JlOlxuICpcbiAqIC0gQmxhbmsgbGluZXMgYW5kIGxpbmVzIGJlZ2lubmluZyB3aXRoIGAjYCBhcmUgc2tpcHBlZC5cbiAqIC0gQSB0cmFpbGluZyBgL2AgcmVzdHJpY3RzIHRoZSBwYXR0ZXJuIHRvIGRpcmVjdG9yaWVzICh0aGUgbGVhZiBmaWxlIGlzIG5vdFxuICogICBpdHNlbGYgdGVzdGVkLCBvbmx5IGl0cyBhbmNlc3RvciBkaXJlY3RvcmllcykuXG4gKiAtIEEgcGF0dGVybiBjb250YWluaW5nIGEgc2xhc2ggaXMgYW5jaG9yZWQgdG8gdGhlIHJlcG8gcm9vdDsgYSBwYXR0ZXJuIHdpdGhcbiAqICAgbm8gc2xhc2ggbWF0Y2hlcyBhIHNpbmdsZSBwYXRoIGNvbXBvbmVudCBhdCBhbnkgZGVwdGguXG4gKiAtIGAqYCBhbmQgYD9gIG1hdGNoIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50OyBgKipgIG1hdGNoZXMgYWNyb3NzIHNlZ21lbnRzLlxuICogLSBOZWdhdGlvbiAoYCFgKSBpcyBub3Qgc3VwcG9ydGVkLlxuICpcbiAqIFN1cHByZXNzaW9uIGlzIGZhaWwtb3BlbjogYSBtaXNzaW5nIG9yIHVucmVhZGFibGUgYC5ob29raWdub3JlYCwgb3IgYVxuICogbWFsZm9ybWVkIGxpbmUsIHlpZWxkcyBubyBydWxlIHJhdGhlciB0aGFuIGhpZGluZyBzcGFucyB0aGUgYXV0aG9yIGRpZCBub3RcbiAqIGFzayB0byBoaWRlLlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBJZ25vcmVSdWxlIHtcbiAgLyoqIFRoZSByYXcgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4sIHJldGFpbmVkIGZvciBkaWFnbm9zdGljcy4gKi9cbiAgcGF0dGVybjogc3RyaW5nO1xuICAvKiogU3BhbiBzbHVnIHByZWZpeGVzIHN1cHByZXNzZWQgZm9yIHBhdGhzIHRoaXMgcnVsZSBtYXRjaGVzLiAqL1xuICBwcmVmaXhlczogc3RyaW5nW107XG4gIC8qKiBUcnVlIHdoZW4gYHJlcG9SZWxQYXRoYCAoUE9TSVgsIHJlcG8tcmVsYXRpdmUpIGlzIGdvdmVybmVkIGJ5IHRoaXMgcnVsZS4gKi9cbiAgbWF0Y2hlczogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW47XG59XG5cbmNvbnN0IEhPT0tfSUdOT1JFX1JFTCA9IG5vZGVQYXRoLmpvaW4oJy5zcGFuJywgJy5ob29raWdub3JlJyk7XG5cbi8qKlxuICogVHJhbnNsYXRlIG9uZSBnaXRpZ25vcmUtc3R5bGUgZ2xvYiBzZWdtZW50IGludG8gYW4gYW5jaG9yZWQgUmVnRXhwLiBgKmAgYW5kXG4gKiBgP2Agc3RheSB3aXRoaW4gYSBwYXRoIHNlZ21lbnQ7IGAqKmAgKG9wdGlvbmFsbHkgZm9sbG93ZWQgYnkgYC9gKSBzcGFucyB0aGVtLlxuICovXG5mdW5jdGlvbiBnbG9iVG9SZWdFeHAoZ2xvYjogc3RyaW5nKTogUmVnRXhwIHtcbiAgbGV0IHJlID0gJyc7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZ2xvYi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGMgPSBnbG9iW2ldO1xuICAgIGlmIChjID09PSAnKicpIHtcbiAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJyonKSB7XG4gICAgICAgIHJlICs9ICcuKic7XG4gICAgICAgIGkrKztcbiAgICAgICAgLy8gQWJzb3JiIGEgZm9sbG93aW5nIHNsYXNoIHNvIGAqKi9mb29gIGRvZXMgbm90IGRlbWFuZCBhIGxpdGVyYWwgYC9gLlxuICAgICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcvJykgaSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmUgKz0gJ1teL10qJztcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGMgPT09ICc/Jykge1xuICAgICAgcmUgKz0gJ1teL10nO1xuICAgIH0gZWxzZSB7XG4gICAgICByZSArPSBjLnJlcGxhY2UoL1suK14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3IFJlZ0V4cChgXiR7cmV9JGApO1xufVxuXG4vKiogQW5jZXN0b3IgcGF0aCBjaGFpbjogYGEvYi9jLnRzYCBcdTIxOTIgYFsnYScsICdhL2InLCAnYS9iL2MudHMnXWAuICovXG5mdW5jdGlvbiBhbmNlc3RvclBhdGhzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIG91dC5wdXNoKHBhcnRzLnNsaWNlKDAsIGkgKyAxKS5qb2luKCcvJykpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogQ29tcGlsZSBhIHNpbmdsZSBwYXR0ZXJuIGludG8gYSBwYXRoIHByZWRpY2F0ZS4gQSBwYXR0ZXJuIG1hdGNoZXMgYSBmaWxlIHdoZW5cbiAqIGl0IG1hdGNoZXMgdGhlIGZpbGUncyBwYXRoIG9yIGFueSBhbmNlc3RvciBkaXJlY3Rvcnkgb2YgaXQsIHNvIGEgZGlyZWN0b3J5XG4gKiBwYXR0ZXJuIHN1cHByZXNzZXMgZXZlcnl0aGluZyBiZW5lYXRoIGl0LlxuICovXG5mdW5jdGlvbiBjb21waWxlUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiB7XG4gIGxldCBwYXQgPSBwYXR0ZXJuO1xuICBsZXQgZGlyT25seSA9IGZhbHNlO1xuICBpZiAocGF0LmVuZHNXaXRoKCcvJykpIHtcbiAgICBkaXJPbmx5ID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMCwgLTEpO1xuICB9XG4gIGxldCBhbmNob3JlZCA9IHBhdC5pbmNsdWRlcygnLycpO1xuICBpZiAocGF0LnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGFuY2hvcmVkID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMSk7XG4gIH1cbiAgY29uc3QgcmUgPSBnbG9iVG9SZWdFeHAocGF0KTtcblxuICByZXR1cm4gKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoYW5jaG9yZWQpIHtcbiAgICAgIGNvbnN0IHNlZ3MgPSBhbmNlc3RvclBhdGhzKHJlcG9SZWxQYXRoKTtcbiAgICAgIC8vIEZvciBhIGRpci1vbmx5IHBhdHRlcm4sIG5ldmVyIHRlc3QgdGhlIGxlYWYgZmlsZSBpdHNlbGYuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IHNlZ3Muc2xpY2UoMCwgLTEpIDogc2VncztcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKHMpID0+IHJlLnRlc3QocykpO1xuICAgIH1cbiAgICAvLyBVbmFuY2hvcmVkOiBtYXRjaCBhZ2FpbnN0IGluZGl2aWR1YWwgcGF0aCBjb21wb25lbnRzIGF0IGFueSBkZXB0aC5cbiAgICBjb25zdCBjb21wb25lbnRzID0gcmVwb1JlbFBhdGguc3BsaXQoJy8nKTtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IGNvbXBvbmVudHMuc2xpY2UoMCwgLTEpIDogY29tcG9uZW50cztcbiAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjKSA9PiByZS50ZXN0KGMpKTtcbiAgfTtcbn1cblxuLyoqIFBhcnNlIGAuaG9va2lnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgbWFsZm9ybWVkIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSG9va0lnbm9yZShjb250ZW50OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIWxpbmUgfHwgbGluZS5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIC8vIGA8cGF0dGVybj48d2hpdGVzcGFjZT48cHJlZml4ZXM+YCBcdTIwMTQgcGF0dGVybiBpcyB0aGUgZmlyc3QgdG9rZW4sIHByZWZpeGVzXG4gICAgLy8gdGhlIHNlY29uZC4gQSBsaW5lIHdpdGhvdXQgYm90aCBpcyBtYWxmb3JtZWQgYW5kIHNraXBwZWQuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxcUyspXFxzKyhcXFMrKSQvKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBwYXR0ZXJuLCBwcmVmaXhlc1Jhd10gPSBtYXRjaDtcbiAgICBjb25zdCBwcmVmaXhlcyA9IHByZWZpeGVzUmF3XG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGlmIChwcmVmaXhlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBwcmVmaXhlcywgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHN1cHByZXNzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgb3IgcGFyc2UgZmFpbHVyZVxuICogeWllbGRzIGFuIGVtcHR5IHJ1bGUgc2V0LCBzbyBzcGFucyBzdXJmYWNlIGFzIG5vcm1hbCB3aGVuIG5vIGNvbmZpZyBleGlzdHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSG9va0lnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEhPT0tfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlSG9va0lnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBBIHNsdWcgY2FycmllcyBhIHByZWZpeCB3aGVuIGl0IGVxdWFscyB0aGUgcHJlZml4IG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgLiAqL1xuZnVuY3Rpb24gc2x1Z0hhc1ByZWZpeChzbHVnOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBzbHVnID09PSBwcmVmaXggfHwgc2x1Zy5zdGFydHNXaXRoKGAke3ByZWZpeH0vYCk7XG59XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGEgc3BhbiBgc2x1Z2Agc2hvdWxkIGJlIHN1cHByZXNzZWQgZm9yIGFuIGFuY2hvciBhdCBgcmVwb1JlbFBhdGhgOlxuICogc29tZSBydWxlIG1hdGNoZXMgdGhlIHBhdGggYW5kIGxpc3RzIGEgcHJlZml4IHRoZSBzbHVnIGNhcnJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYW5TdXBwcmVzc2VkKHJ1bGVzOiBJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNsdWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICBpZiAoIXJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpIGNvbnRpbnVlO1xuICAgIGlmIChydWxlLnByZWZpeGVzLnNvbWUoKHApID0+IHNsdWdIYXNQcmVmaXgoc2x1ZywgcCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkSG9va0lnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgSG9va0lnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHNwYW4tc3VyZmFjaW5nIGNvcmUuXG4gKlxuICogR2l2ZW4gYW4gYWxyZWFkeS1yZXNvbHZlZCByZXBvLXJlbGF0aXZlIHBhdGggYW5kIGEgbGluZSByYW5nZSwgdGhpcyBtb2R1bGVcbiAqIHJ1bnMgdGhlIHNoYXJlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgLyBgLmhvb2tpZ25vcmVgIC8gc2Vzc2lvbi1tZW1vIC9cbiAqIGBnaXQgc3BhbiBzdGFsZWAgcGlwZWxpbmUgYW5kIGFzc2VtYmxlcyB0aGUgaHVtYW4tcmVhZGFibGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmBcbiAqIGJsb2NrIHRoYXQgYm90aCBhZGFwdGVycyBzdXJmYWNlIGlubGluZSBiZWZvcmUgYW4gZWRpdC4gSXQgaW1wb3J0cyBub3RoaW5nXG4gKiBmcm9tIGVpdGhlciBob29rIFNESzogdGhlIENsYXVkZSBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgYSByYW5nZSBkZXJpdmVkIGZyb21cbiAqIGBmaWxlX3BhdGhgL2BvZmZzZXRgL2BvbGRfc3RyaW5nYDsgdGhlIENvZGV4IFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCB0aGVcbiAqIHJhbmdlcyByZWNvdmVyZWQgZnJvbSBhbiBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlLiBFYWNoIGFkYXB0ZXIgd3JhcHMgdGhlXG4gKiByZXR1cm5lZCBibG9jayBzdHJpbmcgaW4gaXRzIG93biBTREsgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogVGhlIGV4ZWN1dG9yL3N0YWxlL21lbW8gZGVwZW5kZW5jaWVzIGFyZSBpbmplY3RlZCBzbyB0aGUgcGlwZWxpbmUgaXMgdGVzdGFibGVcbiAqIHdpdGggZmFrZXMgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGUgc2hhcmVkIGtlcm5lbC5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBpc0dpdElnbm9yZWQsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHBhcnNlU3RhbGVQb3JjZWxhaW4sXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290LFxuICBzYW5pdGl6ZVNlc3Npb25JZCxcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyB0eXBlIEhvb2tJZ25vcmVMb2FkZXIsIGlzU3BhblN1cHByZXNzZWQgfSBmcm9tICcuL3NwYW4taWdub3JlLmpzJztcbmltcG9ydCB0eXBlIHsgQ29yZUxvZ2dlciB9IGZyb20gJy4vc3RvcC1jb3JlLmpzJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTcGFuIGV4ZWN1dG9yIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBFeGVjdXRlcyBgZ2l0IHNwYW4gbGlzdGAgd2l0aCBnaXZlbiBhcmdzIGluIGEgZ2l2ZW4gY3dkLlxuICogUmV0dXJucyBzdGRvdXQgc3RyaW5nLiBUaHJvd3Mgb24gbm9uLXplcm8gZXhpdC5cbiAqL1xuZXhwb3J0IHR5cGUgU3BhbkV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBTcGFuRXhlY3V0b3Ige1xuICByZXR1cm4gKGFyZ3MsIGN3ZCkgPT4ge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4uYXJnc10sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW5zIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW4gPHNsdWdzPmAgYW5kIHJldHVybnMgaXRzIHBvcmNlbGFpbiBzdGRvdXQgXHUyMDE0XG4gKiBvbmUgcm93IHBlciAqZHJpZnRlZCogYW5jaG9yIGFtb25nIHRoZSBnaXZlbiBzcGFucywgZW1wdHkgd2hlbiBhbGwgYXJlIGNsZWFuLlxuICogYGdpdCBzcGFuIHN0YWxlYCBleGl0cyAwIGluIHBvcmNlbGFpbiBtb2RlIHdoZXRoZXIgb3Igbm90IGRyaWZ0IGV4aXN0cywgYnV0IHdlXG4gKiBzdGlsbCBjYXB0dXJlIHN0ZG91dCBmcm9tIGEgdGhyb3duIGVycm9yIHNvIGEgZHJpZnQgc2lnbmFsIGlzIG5ldmVyIGxvc3QgdG8gYVxuICogbm9uLXplcm8gZXhpdC4gVGhyb3dzIG9ubHkgd2hlbiBubyBzdGRvdXQgaXMgYXZhaWxhYmxlIChnZW51aW5lIGZhaWx1cmUpLlxuICovXG5leHBvcnQgdHlwZSBTdGFsZUV4ZWN1dG9yID0gKHNsdWdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRTdGFsZUV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IFN0YWxlRXhlY3V0b3Ige1xuICByZXR1cm4gKHNsdWdzLCBjd2QpID0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNsdWdzXSwge1xuICAgICAgICBjd2QsXG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgaWYgKHR5cGVvZiBvdXQgPT09ICdzdHJpbmcnKSByZXR1cm4gb3V0O1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIG1lbW8gYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lbW9TdG9yZSB7XG4gIGdldFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nKTogU2V0PHN0cmluZz47XG4gIGFkZFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nLCBuYW1lczogc3RyaW5nW10pOiB2b2lkO1xufVxuXG5jb25zdCBNRU1PX0RJUiA9IG5vZGVQYXRoLmpvaW4ob3MudG1wZGlyKCksICdhZ2VudC1ob29rcy1naXQtc3BhbicpO1xuXG5mdW5jdGlvbiBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihNRU1PX0RJUiwgYCR7c2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkKX0uanNvbmApO1xufVxuXG5leHBvcnQgdHlwZSBNZW1vTG9nZ2VyID0gQ29yZUxvZ2dlcjtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURpc2tNZW1vU3RvcmUobG9nZ2VyOiBNZW1vTG9nZ2VyKTogTWVtb1N0b3JlIHtcbiAgcmV0dXJuIHtcbiAgICBnZXRTdXJmYWNlZChzZXNzaW9uSWQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJhdyA9IGZzLnJlYWRGaWxlU3luYyhtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKSwgJ3V0ZjgnKTtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHsgc3VyZmFjZWQ/OiB1bmtub3duIH07XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZC5zdXJmYWNlZCkpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IFNldChwYXJzZWQuc3VyZmFjZWQgYXMgc3RyaW5nW10pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gcmVhZCBmYWlsZWQgKHRyZWF0aW5nIGFzIGVtcHR5KScsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBTZXQoKTtcbiAgICB9LFxuICAgIGFkZFN1cmZhY2VkKHNlc3Npb25JZCwgbmFtZXMpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICAgICAgZm9yIChjb25zdCBuIG9mIG5hbWVzKSBleGlzdGluZy5hZGQobik7XG4gICAgICBjb25zdCBtZW1vUGF0aCA9IG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgdG1wUGF0aCA9IGAke21lbW9QYXRofS50bXBgO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKE1FTU9fRElSLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBKU09OLnN0cmluZ2lmeSh7IHN1cmZhY2VkOiBbLi4uZXhpc3RpbmddIH0pLCAndXRmOCcpO1xuICAgICAgICBmcy5yZW5hbWVTeW5jKHRtcFBhdGgsIG1lbW9QYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyB3cml0ZSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKiBGYWN0b3J5IGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyBhIE1lbW9TdG9yZSBnaXZlbiBhIGxvZ2dlci4gKi9cbmV4cG9ydCB0eXBlIE1lbW9GYWN0b3J5ID0gKGxvZ2dlcjogTWVtb0xvZ2dlcikgPT4gTWVtb1N0b3JlO1xuXG4vKiogRGVmYXVsdCBkaXNrLWJhY2tlZCBtZW1vIGZhY3RvcnkgdXNlZCBpbiBwcm9kdWN0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2tNZW1vRmFjdG9yeShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXIpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIHNjb3BlIHJlc29sdXRpb24gKHJlcG8tc2NvcGluZyArIGdpdGlnbm9yZSArIHNwYW4tcm9vdCBndWFyZHMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBUb3VjaFNjb3BlIHtcbiAgcmVwb1Jvb3Q6IHN0cmluZztcbiAgcmVwb1JlbFBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCb3VuZCBhIHRvdWNoZWQgZmlsZSB0byB0aGUgQ1dEIHJlcG8uIFJlc29sdmUgdGhlIHJlcG8gcm9vdCBvZiB0aGUgY3VycmVudFxuICogd29ya2luZyBkaXJlY3RvcnkgYW5kIHJlcXVpcmUgdGhlIHRvdWNoZWQgZmlsZSB0byByZXNvbHZlIHRvIHRoZSBTQU1FIHJlcG9cbiAqIHJvb3Q7IGRyb3AgZmlsZXMgaW4gYSBkaWZmZXJlbnQgcmVwb3NpdG9yeS93b3JrdHJlZSwgZ2l0aWdub3JlZCBmaWxlcywgYW5kXG4gKiBmaWxlcyB1bmRlciB0aGUgc3BhbiByb290LiBSZXR1cm5zIHRoZSByZXNvbHZlZCBgeyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfWBcbiAqIG9yIG51bGwgd2hlbiB0aGUgdG91Y2ggaXMgb3V0IG9mIHNjb3BlLlxuICpcbiAqIENvbXBhcmluZyByZXNvbHZlZCBgZ2l0IC0tc2hvdy10b3BsZXZlbGAgdG9wbGV2ZWxzIChub3QgcGF0aCBwcmVmaXhlcylcbiAqIGRpc3Rpbmd1aXNoZXMgc2VwYXJhdGUgcmVwb3MgYW5kIHdvcmt0cmVlcyBhbmQgaXMgcm9idXN0IHRvIHN5bWxpbmtzLiBGYWlsXG4gKiBjbG9zZWQ6IGlmIHRoZSBDV0QgcmVwbyBjYW4ndCBiZSByZXNvbHZlZCwgdGhlIHRvdWNoIGlzIGRyb3BwZWQgcmF0aGVyIHRoYW5cbiAqIGZhbGxpbmcgYmFjayB0byB0aGUgZmlsZSdzIG93biByZXBvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IFRvdWNoU2NvcGUgfCBudWxsIHtcbiAgY29uc3QgY3dkUmVwb1Jvb3QgPSBjd2QgPyByZXNvbHZlUmVwb1Jvb3QoY3dkKSA6IG51bGw7XG4gIGlmICghY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFic0RpciA9IHRvUG9zaXgobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSk7XG4gIGNvbnN0IGZpbGVSZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChhYnNEaXIpO1xuICBpZiAoZmlsZVJlcG9Sb290ICE9PSBjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgcmVwb1Jvb3QgPSBjd2RSZXBvUm9vdDtcbiAgY29uc3QgcmVwb1JlbFBhdGggPSByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYWJzUGF0aCk7XG5cbiAgLy8gU2tpcCBnaXRpZ25vcmVkIGZpbGVzIGVudGlyZWx5LiBCdWlsZCBvdXRwdXQsIGNhY2hlcywgYW5kIGxvZ3MgYXJlIG5vdFxuICAvLyBzcGFuLXJlbGV2YW50OiB0aGV5IG11c3QgbmV2ZXIgZW50ZXIgdGhlIGpvdXJuYWwgbm9yIHN1cmZhY2Ugc3BhbiBvdmVybGFwcy5cbiAgaWYgKGlzR2l0SWdub3JlZChyZXBvUm9vdCwgcmVwb1JlbFBhdGgpKSByZXR1cm4gbnVsbDtcblxuICAvLyBTa2lwIHNwYW4gZG9jdW1lbnRzIGVudGlyZWx5LiBGaWxlcyB1bmRlciB0aGUgcmVzb2x2ZWQgc3BhbiByb290IGFyZSBtYW5hZ2VkXG4gIC8vIGJ5IGdpdCBzcGFuIGl0c2VsZiBhbmQgYXJlIG5vdCBhcHBsaWNhdGlvbiBzb3VyY2VzIHRoYXQgbmVlZCBzcGFuIGNvdmVyYWdlLlxuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIGlmIChpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoLCBzcGFuUm9vdCkpIHJldHVybiBudWxsO1xuXG4gIHJldHVybiB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFN1cmZhY2Ugcm91dGluZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBJbmplY3RlZCBkZXBlbmRlbmNpZXMgZm9yIHtAbGluayBzdXJmYWNlT3ZlcmxhcHBpbmdTcGFuc30uICovXG5leHBvcnQgaW50ZXJmYWNlIFN1cmZhY2VEZXBzIHtcbiAgZXhlY3V0b3I6IFNwYW5FeGVjdXRvcjtcbiAgc3RhbGVFeGVjdXRvcjogU3RhbGVFeGVjdXRvcjtcbiAgbWVtbzogTWVtb1N0b3JlO1xuICBsb2FkUnVsZXM6IEhvb2tJZ25vcmVMb2FkZXI7XG4gIGxvZ2dlcjogQ29yZUxvZ2dlcjtcbn1cblxuLyoqXG4gKiBHaXZlbiBhIHJlcG8tcmVsYXRpdmUgcGF0aCBhbmQgdGhlIGxpbmUgcmFuZ2UgYmVpbmcgdG91Y2hlZCB3aXRoaW4gYW5cbiAqIGFscmVhZHktcmVzb2x2ZWQgcmVwbywgcHJvZHVjZSB0aGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmAgYmxvY2sgZm9yIHRoZVxuICogc3BhbnMgb3ZlcmxhcHBpbmcgdGhhdCByYW5nZSwgb3IgbnVsbCB3aGVuIHRoZXJlIGlzIG5vdGhpbmcgdG8gc3VyZmFjZS5cbiAqXG4gKiBUaGUgcGlwZWxpbmU6IGBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpbmAgXHUyMTkyIGtlZXAgbGluZS1yYW5nZWQgYW5jaG9ycyBvblxuICogdGhlIHNhbWUgZmlsZSB0aGF0IGludGVyc2VjdCB0aGUgcmFuZ2UgYW5kIGFyZSBub3QgYC5ob29raWdub3JlYC1zdXBwcmVzc2VkIFx1MjE5MlxuICogZHJvcCBzbHVncyBhbHJlYWR5IHN1cmZhY2VkIHRoaXMgc2Vzc2lvbiAobWVtbykgXHUyMTkyIHJlbmRlciBgZ2l0IHNwYW4gbGlzdFxuICogPG5hbWVzXHUyMDI2PmAgXHUyMTkyIGFwcGVuZCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlciBmb3IgYW55IGFscmVhZHktc3RhbGVcbiAqIHNwYW4uIE9uIHN1Y2Nlc3MgdGhlIHN1cmZhY2VkIG5hbWVzIGFyZSByZWNvcmRlZCBpbiB0aGUgbWVtby4gRXhlY3V0b3IgYW5kXG4gKiBzdGFsZS1wcm9iZSBmYWlsdXJlcyBhcmUgbG9nZ2VkIGFuZCBkZWdyYWRlIHRvIG51bGwgLyB0aGUgcGxhaW4gYmxvY2s7IHRoZXlcbiAqIG5ldmVyIHRocm93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnMoXG4gIGRlcHM6IFN1cmZhY2VEZXBzLFxuICByZXBvUm9vdDogc3RyaW5nLFxuICByZXBvUmVsUGF0aDogc3RyaW5nLFxuICByYW5nZTogTGluZVJhbmdlLFxuICBzZXNzaW9uSWQ6IHN0cmluZ1xuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHsgZXhlY3V0b3IsIHN0YWxlRXhlY3V0b3IsIG1lbW8sIGxvYWRSdWxlcywgbG9nZ2VyIH0gPSBkZXBzO1xuXG4gIC8vIEZpbHRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpblxuICBsZXQgcG9yY2VsYWluU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcG9yY2VsYWluU3Rkb3V0ID0gZXhlY3V0b3IoWyctLXBvcmNlbGFpbicsIHJlcG9SZWxQYXRoXSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIFBhdGgtc2NvcGVkIHN1cHByZXNzaW9uOiBhIHJlcG8ncyAuc3Bhbi8uaG9va2lnbm9yZSBjYW4gaG9sZCBiYWNrIHNwYW4gc2x1Z1xuICAvLyBwcmVmaXhlcyBmb3IgYW5jaG9ycyB1bmRlciBnaXZlbiBwYXRocy4gQSBzdXBwcmVzc2VkIHNwYW4gaXMgbmV2ZXIgc3VyZmFjZWQuXG4gIGNvbnN0IGlnbm9yZVJ1bGVzID0gbG9hZFJ1bGVzKHJlcG9Sb290KTtcblxuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IHBhcnNlUG9yY2VsYWluKHBvcmNlbGFpblN0ZG91dCk7XG4gIGNvbnN0IGNhbmRpZGF0ZU5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBpZiAocm93LnBhdGggIT09IHJlcG9SZWxQYXRoKSBjb250aW51ZTtcbiAgICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIGNvbnRpbnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICAgIGlmICghcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KSkgY29udGludWU7XG4gICAgaWYgKGlzU3BhblN1cHByZXNzZWQoaWdub3JlUnVsZXMsIHJvdy5wYXRoLCByb3cubmFtZSkpIGNvbnRpbnVlO1xuICAgIGNhbmRpZGF0ZU5hbWVzLmFkZChyb3cubmFtZSk7XG4gIH1cblxuICBpZiAoY2FuZGlkYXRlTmFtZXMuc2l6ZSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU3VidHJhY3QgYWxyZWFkeS1zdXJmYWNlZCBuYW1lc1xuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9TdXJmYWNlID0gWy4uLmNhbmRpZGF0ZU5hbWVzXS5maWx0ZXIoKG4pID0+ICFzdXJmYWNlZC5oYXMobikpLnNvcnQoKTtcbiAgaWYgKHRvU3VyZmFjZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFJlbmRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxuYW1lMT4gPG5hbWUyPiAuLi5cbiAgbGV0IHJlbmRlclN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHJlbmRlclN0ZG91dCA9IGV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAocmVuZGVyKSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE9mIHRoZSBzcGFucyBiZWluZyBzdXJmYWNlZCwgZmxhZyBhbnkgYWxyZWFkeSBzdGFsZSBcdTIwMTQgdGhlIHRvdWNoZWQgbGluZXMgaGF2ZVxuICAvLyBkcmlmdGVkIGZyb20gdGhlaXIgYW5jaG9yZWQgc3RhdGUgXHUyMDE0IHdpdGggYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIuXG4gIC8vIERldGVjdGlvbiBpcyBhcy1vZi1ub3cgKHN1cmZhY2luZyBydW5zIGJlZm9yZSB0aGUgZWRpdCBhcHBsaWVzKSwgc28gdGhpc1xuICAvLyBjYXRjaGVzIHByZS1leGlzdGluZyBkcmlmdDsgZHJpZnQgdGhpcyBzZXNzaW9uIGNhdXNlcyBpcyB0aGUgU3RvcCBob29rJ3Mgam9iLlxuICAvLyBGYWlsdXJlIHRvIGNvbXB1dGUgc3RhbGVuZXNzIGlzIG5vbi1mYXRhbDogZmFsbCBiYWNrIHRvIHRoZSBwbGFpbiBibG9jay5cbiAgbGV0IHN0YWxlSGludCA9ICcnO1xuICB0cnkge1xuICAgIGNvbnN0IHN0YWxlTmFtZXMgPSBuZXcgU2V0KHBhcnNlU3RhbGVQb3JjZWxhaW4oc3RhbGVFeGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KSkubWFwKChyKSA9PiByLm5hbWUpKTtcbiAgICBjb25zdCBzdGFsZVN1cmZhY2VkID0gdG9TdXJmYWNlLmZpbHRlcigobikgPT4gc3RhbGVOYW1lcy5oYXMobikpO1xuICAgIGlmIChzdGFsZVN1cmZhY2VkLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGxpbmVzID0gc3RhbGVTdXJmYWNlZC5tYXAoKG4pID0+IGAgIGdpdCBzcGFuIGhpc3RvcnkgJHtufWApLmpvaW4oJ1xcbicpO1xuICAgICAgc3RhbGVIaW50ID0gYFxcblN0YWxlIFx1MjAxNCB0aGUgbGluZXMgeW91J3JlIHRvdWNoaW5nIGhhdmUgZHJpZnRlZCBmcm9tIHRoZXNlIHNwYW5zJyBhbmNob3JlZCBzdGF0ZS4gUmV2aWV3IGhvdyBlYWNoIHN1YnN5c3RlbSBldm9sdmVkIGJlZm9yZSBjaGFuZ2luZyBpdDpcXG4ke2xpbmVzfWA7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gc3RhbGUgKGhpc3RvcnkgaGludCkgZmFpbGVkJywgeyBlcnIgfSk7XG4gIH1cblxuICBjb25zdCB3cmFwcGVkID0gYFxcbjxnaXQtc3Bhbj5cXG4ke3JlbmRlclN0ZG91dH0ke3N0YWxlSGludH1cXG48L2dpdC1zcGFuPlxcbmA7XG5cbiAgLy8gVXBkYXRlIG1lbW9cbiAgbWVtby5hZGRTdXJmYWNlZChzZXNzaW9uSWQsIHRvU3VyZmFjZSk7XG5cbiAgcmV0dXJuIHdyYXBwZWQ7XG59XG4iLCAiLyoqXG4gKiBDb2RleCBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlIHBhcnNlci5cbiAqXG4gKiBUdXJucyBhIENvZGV4IGBhcHBseV9wYXRjaGAgYHRvb2xfaW5wdXQuY29tbWFuZGAgcGF0Y2ggc3RyaW5nIGludG8gdGhlXG4gKiBgQW5jaG9yU3BlY1tdYCBzaGFwZSB0aGUgc2hhcmVkIGpvdXJuYWwgYWxyZWFkeSBjb25zdW1lcyBcdTIwMTQgdGhlIG9uZSBnZW51aW5lbHlcbiAqIG5ldyBhbGdvcml0aG0gdGhlIENvZGV4IGFkYXB0ZXIgbmVlZHMuIEl0IHJlcGxhY2VzIHRoZSBzdHJ1Y3R1cmVkXG4gKiBgZmlsZV9wYXRoYC9gb2xkX3N0cmluZ2AvYG9mZnNldGAgcmVhZGluZyB0aGUgQ2xhdWRlIFByZVRvb2xVc2UgaG9vayBkb2VzLFxuICogYmVjYXVzZSBDb2RleCBkZWxpdmVycyBldmVyeSBlZGl0IGFzIGEgc2luZ2xlIGFwcGx5X3BhdGNoIGVudmVsb3BlIHJhdGhlclxuICogdGhhbiBhIHR5cGVkIHRvb2wgaW5wdXQuXG4gKlxuICogVGhlIG1vZHVsZSBpcyBwdXJlOiBpdCBpbXBvcnRzIG9ubHkgdGhlIGtlcm5lbCBhbmNob3IgdHlwZXMgYW5kIG5ldmVyIHRvdWNoZXNcbiAqIHRoZSBDb2RleCBTREssIHNvIGl0IGlzIERJLXRlc3RhYmxlIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlXG4gKiBzaGFyZWQga2VybmVsLiBSYW5nZSByZWNvdmVyeSBpcyBiZXN0LWVmZm9ydCBcdTIwMTQgdGhlIGFwcGx5X3BhdGNoIGZvcm1hdCBjYXJyaWVzXG4gKiBgQEBgIGNvbnRleHQgYW5kIGArYC9gLWAvc3BhY2UgY2hhbmdlIGxpbmVzIGJ1dCBubyBleHBsaWNpdCBsaW5lIG51bWJlcnMsIHNvIGFcbiAqIHJhbmdlIGNhbiBvbmx5IGJlIHJlY292ZXJlZCBieSBsb2NhdGluZyBhIGh1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGVcbiAqIG9uLWRpc2sgZmlsZS4gVGhhdCBmaWxlIHJlYWQgaXMgaW5qZWN0ZWQgKGByZWFkUHJlRWRpdEZpbGVgKSBzbyB0aGUgZnVuY3Rpb25cbiAqIHN0YXlzIHB1cmUgYW5kIHRlc3RhYmxlLiBPbiBBTlkgYW1iaWd1aXR5IChubyByZWFkZXIsIGZpbGUgbWlzc2luZywgY29udGV4dFxuICogbm90IGZvdW5kLCBmdXp6eS9kdXBsaWNhdGUgbWF0Y2gpIHRoZSBwYXJzZXIgZGVncmFkZXMgdG8gYSB3aG9sZS1maWxlIGFuY2hvclxuICogcmF0aGVyIHRoYW4gdGhyb3dpbmcgXHUyMDE0IHdob2xlLWZpbGUgYW5jaG9ycyBhcmUgZmlyc3QtY2xhc3MgYW5kIGpvdXJuYWxpbmcgbXVzdFxuICogbmV2ZXIgYmUgYmxvY2tlZC5cbiAqXG4gKiBUaGUgZ3JhbW1hciBpcyBjcm9zcy1jaGVja2VkIGFnYWluc3QgQ29kZXgncyBvd24gYXBwbHlfcGF0Y2ggY3JhdGVcbiAqIChjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMve3BhcnNlcixzdHJlYW1pbmdfcGFyc2VyfS5ycykuIFR3byBzdWJ0bGV0aWVzIGFyZVxuICogbWlycm9yZWQgZGVsaWJlcmF0ZWx5OiBodW5rLWhlYWRlciBtYXJrZXJzIGFyZSBvbmx5IHJlY29nbml6ZWQgYXQgdGhlIHN0YXJ0IG9mXG4gKiBhIGxpbmUgd2l0aCBubyBsZWFkaW5nIHdoaXRlc3BhY2Ugd2hpbGUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rIChhIGxlYWRpbmcgc3BhY2VcbiAqIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpLCBhbmQgYSBiYXJlIGVtcHR5IGxpbmUgaW5zaWRlIGFuIFVwZGF0ZVxuICogaHVuayBpcyB0cmVhdGVkIGFzIGFuIGVtcHR5IGNvbnRleHQgbGluZSBwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcgY29udGVudC5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCB0eXBlIHsgQW5jaG9yU3BlYywgTGluZVJhbmdlIH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5cbi8qKlxuICogUmVhZHMgdGhlIHByZS1lZGl0IChvbi1kaXNrLCBiZWZvcmUgdGhlIHBhdGNoIGFwcGxpZXMpIGNvbnRlbnQgb2YgdGhlIGZpbGUgYXRcbiAqIGBwYXRoYCwgb3IgcmV0dXJucyBgbnVsbGAgd2hlbiBpdCBjYW5ub3QgYmUgcmVhZC4gSW5qZWN0ZWQgc28gdGhlIHBhcnNlciBzdGF5c1xuICogcHVyZTsgY2FsbCBzaXRlcyBkZWZhdWx0IHRvIGEgcmVhbCBmaWxlc3lzdGVtIHJlYWQuXG4gKi9cbmV4cG9ydCB0eXBlIFJlYWRQcmVFZGl0RmlsZSA9IChwYXRoOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gR3JhbW1hciBtYXJrZXJzIChtaXJyb3JzIGNvZGV4LXJzL2FwcGx5LXBhdGNoL3NyYy9wYXJzZXIucnMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgRU5EX1BBVENIX01BUktFUiA9ICcqKiogRW5kIFBhdGNoJztcbmNvbnN0IEFERF9GSUxFX01BUktFUiA9ICcqKiogQWRkIEZpbGU6ICc7XG5jb25zdCBERUxFVEVfRklMRV9NQVJLRVIgPSAnKioqIERlbGV0ZSBGaWxlOiAnO1xuY29uc3QgVVBEQVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBVcGRhdGUgRmlsZTogJztcbmNvbnN0IE1PVkVfVE9fTUFSS0VSID0gJyoqKiBNb3ZlIHRvOiAnO1xuY29uc3QgRU9GX01BUktFUiA9ICcqKiogRW5kIG9mIEZpbGUnO1xuY29uc3QgQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAICc7XG5jb25zdCBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIgPSAnQEAnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEludGVybWVkaWF0ZSBodW5rIG1vZGVsXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFVwZGF0ZUNodW5rIHtcbiAgLyoqIE9wdGlvbmFsIGBAQCA8Y29udGV4dD5gIGxpbmUgdXNlZCB0byBkaXNhbWJpZ3VhdGUgdGhlIGJsb2NrJ3MgbG9jYXRpb24uICovXG4gIGNoYW5nZUNvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKiBQcmUtZWRpdCBsaW5lcyB0aGlzIGNodW5rIGNvdmVycyAoY29udGV4dCBgIGAgKyByZW1vdmVkIGAtYCksIGluIG9yZGVyLiAqL1xuICBvbGRMaW5lczogc3RyaW5nW107XG4gIC8qKiBQb3N0LWVkaXQgbGluZXMgKGNvbnRleHQgYCBgICsgYWRkZWQgYCtgKTsgcmV0YWluZWQgZm9yIGNvbXBsZXRlbmVzcy4gKi9cbiAgbmV3TGluZXM6IHN0cmluZ1tdO1xufVxuXG50eXBlIEh1bmsgPVxuICB8IHsga2luZDogJ2FkZCc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAnZGVsZXRlJzsgcGF0aDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6ICd1cGRhdGUnOyBwYXRoOiBzdHJpbmc7IG1vdmVQYXRoOiBzdHJpbmcgfCBudWxsOyBjaHVua3M6IFVwZGF0ZUNodW5rW10gfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHJlYWRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVhbC1maWxlc3lzdGVtIHJlYWRlciB1c2VkIHdoZW4gbm8gcmVhZGVyIGlzIGluamVjdGVkLiBCZXN0LWVmZm9ydDogYW55XG4gKiBmYWlsdXJlIChtaXNzaW5nIGZpbGUsIHBlcm1pc3Npb24gZXJyb3IpIHlpZWxkcyBgbnVsbGAsIHdoaWNoIHRoZSBwYXJzZXJcbiAqIGRlZ3JhZGVzIHRvIGEgd2hvbGUtZmlsZSBhbmNob3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0UmVhZFByZUVkaXRGaWxlKHBhdGg6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICB0cnkge1xuICAgIHJldHVybiBmcy5yZWFkRmlsZVN5bmMocGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRW52ZWxvcGUgc2Nhbm5pbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNjYW4gdGhlIHBhdGNoIHRleHQgaW50byBodW5rcy4gTGVuaWVudCBieSBkZXNpZ246IHVucmVjb2duaXplZCBsaW5lcyBhcmVcbiAqIGlnbm9yZWQgcmF0aGVyIHRoYW4gcmVqZWN0ZWQsIGFuZCBCZWdpbi9FbmQvRW52aXJvbm1lbnQgbGluZXMgYXJlIHNraXBwZWQsIHNvXG4gKiBhIG1hbGZvcm1lZCBlbnZlbG9wZSBkZWdyYWRlcyB0byB3aGF0ZXZlciBodW5rcyBjb3VsZCBiZSByZWNvdmVyZWQgKG9mdGVuXG4gKiBub25lIFx1MjE5MiBgW11gKSBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICovXG5mdW5jdGlvbiBzY2FuSHVua3MoY29tbWFuZDogc3RyaW5nKTogSHVua1tdIHtcbiAgY29uc3QgaHVua3M6IEh1bmtbXSA9IFtdO1xuICAvLyBUaGUgY3VycmVudGx5LW9wZW4gVXBkYXRlIGh1bmssIG9yIG51bGwuIEFkZC9EZWxldGUgaHVua3MgaGF2ZSBubyBib2R5LCBzb1xuICAvLyB0aGV5IGNsb3NlIGltbWVkaWF0ZWx5IGFuZCByZXNldCB0aGlzIHRvIG51bGwuXG4gIGxldCBvcGVuVXBkYXRlOiAoSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSkgfCBudWxsID0gbnVsbDtcblxuICBmb3IgKGNvbnN0IHJhdyBvZiBjb21tYW5kLnNwbGl0KCdcXG4nKSkge1xuICAgIC8vIEhlYWRlciBkZXRlY3Rpb24gaXMgd2hpdGVzcGFjZS1zZW5zaXRpdmUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rOiBDb2RleCB1c2VzXG4gICAgLy8gdHJpbV9lbmQgdGhlcmUgKGxlYWRpbmcgc3BhY2UgZGVtb3RlcyBhIG1hcmtlciB0byBhIGNvbnRleHQgbGluZSkgYW5kIGZ1bGxcbiAgICAvLyB0cmltIGVsc2V3aGVyZS4gTWF0Y2ggdGhhdCBzbyBpbmRlbnRlZCBtYXJrZXJzIGluc2lkZSBhIGh1bmsgc3RheSBjb250ZW50LlxuICAgIGNvbnN0IGhlYWRlckxpbmU6IHN0cmluZyA9IG9wZW5VcGRhdGUgPyByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJykgOiByYXcudHJpbSgpO1xuXG4gICAgaWYgKGhlYWRlckxpbmUgPT09IEVORF9QQVRDSF9NQVJLRVIpIHtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoQUREX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdhZGQnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKEFERF9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChERUxFVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBodW5rcy5wdXNoKHsga2luZDogJ2RlbGV0ZScsIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoREVMRVRFX0ZJTEVfTUFSS0VSLmxlbmd0aCkgfSk7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKFVQREFURV9GSUxFX01BUktFUikpIHtcbiAgICAgIGNvbnN0IGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0gPSB7XG4gICAgICAgIGtpbmQ6ICd1cGRhdGUnLFxuICAgICAgICBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKFVQREFURV9GSUxFX01BUktFUi5sZW5ndGgpLFxuICAgICAgICBtb3ZlUGF0aDogbnVsbCxcbiAgICAgICAgY2h1bmtzOiBbXVxuICAgICAgfTtcbiAgICAgIGh1bmtzLnB1c2goaHVuayk7XG4gICAgICBvcGVuVXBkYXRlID0gaHVuaztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChvcGVuVXBkYXRlKSB7XG4gICAgICBwcm9jZXNzVXBkYXRlTGluZShvcGVuVXBkYXRlLCByYXcpO1xuICAgIH1cbiAgICAvLyBBbnkgb3RoZXIgbGluZSBvdXRzaWRlIGFuIFVwZGF0ZSBodW5rIChCZWdpbiBQYXRjaCwgRW52aXJvbm1lbnQgSUQsIEFkZFxuICAgIC8vIEZpbGUgYCtgIGNvbnRlbnQsIHN0cmF5IHRleHQpIGlzIGlnbm9yZWQuXG4gIH1cblxuICByZXR1cm4gaHVua3M7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZUNodW5rKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pOiBVcGRhdGVDaHVuayB7XG4gIGNvbnN0IGxhc3QgPSBodW5rLmNodW5rc1todW5rLmNodW5rcy5sZW5ndGggLSAxXTtcbiAgaWYgKGxhc3QpIHJldHVybiBsYXN0O1xuICBjb25zdCBjaHVuazogVXBkYXRlQ2h1bmsgPSB7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH07XG4gIGh1bmsuY2h1bmtzLnB1c2goY2h1bmspO1xuICByZXR1cm4gY2h1bms7XG59XG5cbi8qKiBBcHBseSBvbmUgYm9keSBsaW5lIG9mIGFuIFVwZGF0ZSBodW5rIHRvIGl0cyBjaHVuayBsaXN0LiAqL1xuZnVuY3Rpb24gcHJvY2Vzc1VwZGF0ZUxpbmUoaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSwgcmF3OiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgdHJpbW1lZEVuZCA9IHJhdy5yZXBsYWNlKC9bIFxcdFxccl0rJC8sICcnKTtcblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU9GX01BUktFUikgcmV0dXJuOyAvLyBlbmQtb2YtZmlsZSBoaW50OyBub3QgbmVlZGVkIGZvciByYW5nZXNcblxuICAvLyBgKioqIE1vdmUgdG86YCBpcyBvbmx5IG1lYW5pbmdmdWwgYmVmb3JlIGFueSBjaGFuZ2UgY29udGVudC5cbiAgaWYgKGh1bmsuY2h1bmtzLmxlbmd0aCA9PT0gMCAmJiBodW5rLm1vdmVQYXRoID09PSBudWxsICYmIHRyaW1tZWRFbmQuc3RhcnRzV2l0aChNT1ZFX1RPX01BUktFUikpIHtcbiAgICBodW5rLm1vdmVQYXRoID0gdHJpbW1lZEVuZC5zbGljZShNT1ZFX1RPX01BUktFUi5sZW5ndGgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICh0cmltbWVkRW5kID09PSBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogbnVsbCwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0cmltbWVkRW5kLnN0YXJ0c1dpdGgoQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSkge1xuICAgIGh1bmsuY2h1bmtzLnB1c2goeyBjaGFuZ2VDb250ZXh0OiB0cmltbWVkRW5kLnNsaWNlKENIQU5HRV9DT05URVhUX01BUktFUi5sZW5ndGgpLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBIGJhcmUgZW1wdHkgbGluZSBpcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgKHByZXNlbnQgaW4gYm90aCBvbGQgYW5kIG5ldykuXG4gIGlmIChyYXcgPT09ICcnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKCcnKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKCcnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZmlyc3QgPSByYXdbMF07XG4gIGlmIChmaXJzdCA9PT0gJyAnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjb25zdCBjb250ZW50ID0gcmF3LnNsaWNlKDEpO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2goY29udGVudCk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaChjb250ZW50KTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnKycpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnLScpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gVW5yZWNvZ25pemVkIGNvbnRlbnQgbGluZSBcdTIwMTQgaWdub3JlIGxlbmllbnRseSByYXRoZXIgdGhhbiB0aHJvdy5cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSYW5nZSByZWNvdmVyeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTcGxpdCBmaWxlIGNvbnRlbnQgaW50byBsaW5lcyBmb3IgbWF0Y2hpbmcuIEEgdHJhaWxpbmcgbmV3bGluZSB5aWVsZHMgYVxuICogdHJhaWxpbmcgZW1wdHkgZWxlbWVudCwgd2hpY2ggaXMgaGFybWxlc3MgZm9yIHN1Yi1zbGljZSBtYXRjaGluZy4gKi9cbmZ1bmN0aW9uIHNwbGl0TGluZXMoY29udGVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gY29udGVudC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKiBJbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgdmFsdWVgIGFwcGVhcnMgYXMgYSBmdWxsIGxpbmUgaW4gYGxpbmVzYC4gKi9cbmZ1bmN0aW9uIGxpbmVJbmRpY2VzKGxpbmVzOiBzdHJpbmdbXSwgdmFsdWU6IHN0cmluZyk6IG51bWJlcltdIHtcbiAgY29uc3Qgb3V0OiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGxpbmVzW2ldID09PSB2YWx1ZSkgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFN0YXJ0IGluZGljZXMgKDAtYmFzZWQpIGF0IHdoaWNoIGBuZWVkbGVgIG1hdGNoZXMgY29udGlndW91c2x5IGluIGBoYXlzdGFja2AuICovXG5mdW5jdGlvbiBjb250aWd1b3VzTWF0Y2hlcyhoYXlzdGFjazogc3RyaW5nW10sIG5lZWRsZTogc3RyaW5nW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDAgfHwgbmVlZGxlLmxlbmd0aCA+IGhheXN0YWNrLmxlbmd0aCkgcmV0dXJuIG91dDtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSBvdXQucHVzaChpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIExvY2F0ZSBhIHNpbmdsZSBjaHVuaydzIHByZS1lZGl0IGJsb2NrIGluIHRoZSBmaWxlLCByZXR1cm5pbmcgaXRzIDEtYmFzZWRcbiAqIGxpbmUgcmFuZ2Ugb3IgbnVsbCB3aGVuIGl0IGNhbm5vdCBiZSBsb2NhdGVkIHVuYW1iaWd1b3VzbHkuXG4gKlxuICogLSBOb24tZW1wdHkgYmxvY2s6IHJlcXVpcmUgYSB1bmlxdWUgY29udGlndW91cyBtYXRjaCwgb3IgXHUyMDE0IHdoZW4gZHVwbGljYXRlZCBcdTIwMTRcbiAqICAgYSBgQEBgIGNoYW5nZS1jb250ZXh0IGxpbmUgdGhhdCBzZWxlY3RzIHRoZSBvY2N1cnJlbmNlIGFmdGVyIGl0LlxuICogLSBFbXB0eSBibG9jayAocHVyZSBpbnNlcnRpb24pOiBhbmNob3Igb24gYSB1bmlxdWUgY2hhbmdlLWNvbnRleHQgbGluZSBpZiBvbmVcbiAqICAgaXMgZ2l2ZW47IG90aGVyd2lzZSBpdCBpcyB1bmxvY2F0YWJsZS5cbiAqL1xuZnVuY3Rpb24gbG9jYXRlQ2h1bmsocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVuazogVXBkYXRlQ2h1bmspOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgYmxvY2sgPSBjaHVuay5vbGRMaW5lcztcblxuICBpZiAoYmxvY2subGVuZ3RoID09PSAwKSB7XG4gICAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICAgIGNvbnN0IGN0eElkeHMgPSBsaW5lSW5kaWNlcyhwcmVMaW5lcywgY3R4KTtcbiAgICAgIGlmIChjdHhJZHhzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBjb25zdCBsaW5lID0gY3R4SWR4c1swXSArIDE7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiBsaW5lLCBlbmQ6IGxpbmUgfTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBzdGFydHMgPSBjb250aWd1b3VzTWF0Y2hlcyhwcmVMaW5lcywgYmxvY2spO1xuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IHMgPSBzdGFydHNbMF07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHMgKyAxLCBlbmQ6IHMgKyBibG9jay5sZW5ndGggfTtcbiAgfVxuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gRHVwbGljYXRlZCBibG9jazogdXNlIHRoZSBjaGFuZ2UgY29udGV4dCB0byBzZWxlY3QgdGhlIG1hdGNoIGFmdGVyIGl0LlxuICBjb25zdCBjdHggPSBjaHVuay5jaGFuZ2VDb250ZXh0O1xuICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICBmb3IgKGNvbnN0IGMgb2YgbGluZUluZGljZXMocHJlTGluZXMsIGN0eCkpIHtcbiAgICAgIGNvbnN0IGFmdGVyID0gc3RhcnRzLmZpbmQoKHMpID0+IHMgPj0gYyk7XG4gICAgICBpZiAoYWZ0ZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4geyBzdGFydDogYWZ0ZXIgKyAxLCBlbmQ6IGFmdGVyICsgYmxvY2subGVuZ3RoIH07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsOyAvLyBhbWJpZ3VvdXMgXHUyMTkyIGNhbGxlciBkZWdyYWRlcyB0byB3aG9sZS1maWxlXG59XG5cbi8qKlxuICogUmVjb3ZlciBhIHNpbmdsZSBsaW5lIHJhbmdlIHNwYW5uaW5nIGFsbCBvZiBhbiB1cGRhdGUncyBjaHVua3MuIFJldHVybnMgbnVsbFxuICogKFx1MjE5MiB3aG9sZS1maWxlIGZhbGxiYWNrKSBpZiBhbnkgY2h1bmsgY2Fubm90IGJlIGxvY2F0ZWQuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSYW5nZShwcmVMaW5lczogc3RyaW5nW10sIGNodW5rczogVXBkYXRlQ2h1bmtbXSk6IExpbmVSYW5nZSB8IG51bGwge1xuICBsZXQgdW5pb246IExpbmVSYW5nZSB8IG51bGwgPSBudWxsO1xuICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgIGNvbnN0IHIgPSBsb2NhdGVDaHVuayhwcmVMaW5lcywgY2h1bmspO1xuICAgIGlmIChyID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICB1bmlvbiA9IHVuaW9uID09PSBudWxsID8gciA6IHsgc3RhcnQ6IE1hdGgubWluKHVuaW9uLnN0YXJ0LCByLnN0YXJ0KSwgZW5kOiBNYXRoLm1heCh1bmlvbi5lbmQsIHIuZW5kKSB9O1xuICB9XG4gIHJldHVybiB1bmlvbjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgQVBJXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBQYXJzZSBhIENvZGV4IGBhcHBseV9wYXRjaGAgY29tbWFuZCBzdHJpbmcgaW50byBhbiBhbmNob3IgcGVyIHRvdWNoZWQgZmlsZS5cbiAqXG4gKiAtIGAqKiogQWRkIEZpbGU6YCBcdTIxOTIgYGNyZWF0ZWAgKHdob2xlLWZpbGUpXG4gKiAtIGAqKiogRGVsZXRlIEZpbGU6YCBcdTIxOTIgYHdob2xlLXdyaXRlYCAod2hvbGUtZmlsZTsgdGhlIGZpbGUgbm8gbG9uZ2VyIGV4aXN0cylcbiAqIC0gYCoqKiBVcGRhdGUgRmlsZTpgIFx1MjE5MiBgd3JpdGVgIHdpdGggYSByZWNvdmVyZWQgbGluZSByYW5nZSB3aGVuIHRoZSBodW5rJ3NcbiAqICAgcHJlLWVkaXQgYmxvY2sgY2FuIGJlIGxvY2F0ZWQgdmlhIGByZWFkUHJlRWRpdEZpbGVgLCBvdGhlcndpc2UgYHdob2xlLXdyaXRlYC5cbiAqICAgQSByZW5hbWVkIHVwZGF0ZSAoYCoqKiBNb3ZlIHRvOmApIGFuY2hvcnMgdGhlIGRlc3RpbmF0aW9uIHBhdGggYXNcbiAqICAgYHdob2xlLXdyaXRlYCBzaW5jZSBwcmUtZWRpdCBsaW5lIG51bWJlcnMgY2Fubm90IGJlIG1hcHBlZCBhY3Jvc3MgYSByZW5hbWUuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhIG1hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB5aWVsZHMgYFtdYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQXBwbHlQYXRjaChcbiAgY29tbWFuZDogc3RyaW5nLFxuICByZWFkUHJlRWRpdEZpbGU6IFJlYWRQcmVFZGl0RmlsZSA9IGRlZmF1bHRSZWFkUHJlRWRpdEZpbGVcbik6IEFuY2hvclNwZWNbXSB7XG4gIGNvbnN0IGFuY2hvcnM6IEFuY2hvclNwZWNbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgaHVuayBvZiBzY2FuSHVua3MoY29tbWFuZCkpIHtcbiAgICBpZiAoaHVuay5raW5kID09PSAnYWRkJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnY3JlYXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaHVuay5raW5kID09PSAnZGVsZXRlJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlOiBhbmNob3Igb24gdGhlIGRlc3RpbmF0aW9uIHBhdGggKHBvc3QtZWRpdCBsb2NhdGlvbikuXG4gICAgY29uc3QgdGFyZ2V0UGF0aCA9IHRvUG9zaXgoaHVuay5tb3ZlUGF0aCA/PyBodW5rLnBhdGgpO1xuXG4gICAgLy8gQSByZW5hbWUgZGVmZWF0cyBwcmUtZWRpdCBsaW5lIG1hcHBpbmcgXHUyMDE0IGFuY2hvciB3aG9sZS1maWxlIG9uIHRoZSB0YXJnZXQuXG4gICAgaWYgKGh1bmsubW92ZVBhdGggIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBSYW5nZSByZWNvdmVyeSByZWFkcyB0aGUgcHJlLWVkaXQgY29udGVudCBhdCB0aGUgb3JpZ2luYWwgKHByZS1tb3ZlKSBwYXRoLlxuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkUHJlRWRpdEZpbGUoaHVuay5wYXRoKTtcbiAgICBjb25zdCByYW5nZSA9IGNvbnRlbnQgPT09IG51bGwgPyBudWxsIDogcmVjb3ZlclJhbmdlKHNwbGl0TGluZXMoY29udGVudCksIGh1bmsuY2h1bmtzKTtcbiAgICBpZiAocmFuZ2UgIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3cml0ZScsIHJhbmdlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhbmNob3JzO1xufVxuIiwgIi8qKlxuICogQ29kZXggUHJlVG9vbFVzZSBob29rIFx1MjAxNCBzdXJmYWNlIGNvdXBsZWQgc3BhbnMgYmVmb3JlIGFuIGBhcHBseV9wYXRjaGAgYXBwbGllcy5cbiAqXG4gKiBDb2RleCBkZWxpdmVycyBldmVyeSBmaWxlIG11dGF0aW9uIGFzIGEgc2luZ2xlIGBhcHBseV9wYXRjaGAgZW52ZWxvcGUgaW5cbiAqIGB0b29sX2lucHV0LmNvbW1hbmRgIChhIGBzdHJpbmdgKSwgbm90IGFzIHN0cnVjdHVyZWQgYGZpbGVfcGF0aGAvYG9sZF9zdHJpbmdgXG4gKiBpbnB1dHMuIFRoaXMgaGFuZGxlcidzIG9ubHkgam9iIGlzICoqc3VyZmFjaW5nKio6IGl0IHBhcnNlcyB0aGUgZW52ZWxvcGUgaW50b1xuICogYEFuY2hvclNwZWNbXWAgdmlhIHRoZSBzaGFyZWQgW2FwcGx5LXBhdGNoIHBhcnNlcl0oLi9hcHBseS1wYXRjaC50cyksIHRoZW4gZmVlZHNcbiAqIGVhY2ggdG91Y2hlZCBwYXRoICsgcmVjb3ZlcmVkIHJhbmdlIGludG8gdGhlIGhhcm5lc3MtYWdub3N0aWMgc3Bhbi1zdXJmYWNpbmdcbiAqIGNvcmUgKHNoYXJlZCB3aXRoIHRoZSBDbGF1ZGUgYWRhcHRlcikgdG8gZW1pdCB0aGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmBcbiAqIGJsb2NrIGZvciBvdmVybGFwcGluZyBzcGFucyBhcyBgYWRkaXRpb25hbENvbnRleHRgIChyZWFjaGluZyB0aGUgbW9kZWwgbG9vcClcbiAqIGFuZCBgc3lzdGVtTWVzc2FnZWAgKHRoZSB1c2VyLWZhY2luZyBsaW5lKSBiZWZvcmUgdGhlIHBhdGNoIGxhbmRzLlxuICpcbiAqIEpvdXJuYWxpbmcgdGhlIHdyaXRlIGlzIHRoZSBQb3N0VG9vbFVzZSBob29rJ3Mgam9iLCBwZXIgdGhlIGV2ZW50LW1hcHBpbmcgbm90ZTpcbiAqIFByZVRvb2xVc2Ugc3VyZmFjZXMsIFBvc3RUb29sVXNlIGpvdXJuYWxzIHRoZSBjb25maXJtZWQgZWRpdC4gQW5jaG9ycyB3aXRob3V0IGFcbiAqIHJlY292ZXJlZCBsaW5lIHJhbmdlICh3aG9sZS1maWxlIHdyaXRlcywgY3JlYXRlcykgaGF2ZSBub3RoaW5nIHRvIGludGVyc2VjdCBhbmRcbiAqIGFyZSBza2lwcGVkIGhlcmUgXHUyMDE0IG1hdGNoaW5nIHRoZSBDbGF1ZGUgaGFuZGxlciwgd2hpY2ggZG9lcyBub3Qgc3VyZmFjZSBvbiBhXG4gKiB3aG9sZS1maWxlIHdyaXRlLiBUaGUgc2Vzc2lvbiBtZW1vIGRlZHVwZXMgc2x1Z3MgYWxyZWFkeSBzdXJmYWNlZCB0aGlzIHNlc3Npb24uXG4gKlxuICogYHRvb2xfaW5wdXRgIGlzIHR5cGVkIGB1bmtub3duYCBieSB0aGUgU0RLOyB3ZSBuYXJyb3cgaXQgdG8gYHsgY29tbWFuZCB9YC5cbiAqIFRoZSB0aW1lb3V0IGlzIG1pbGxpc2Vjb25kcyBpbiB0aGUgaGFuZGxlciBjb25maWcgKHRoZSBDTEkgZW1pdHMgYDEwYCBzZWNvbmRzKS5cbiAqL1xuXG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFByZVRvb2xVc2VJbnB1dCwgcHJlVG9vbFVzZUhvb2ssIHByZVRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHsgYWJzcGF0aEFnYWluc3QgfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHR5cGUgSG9va0lnbm9yZUxvYWRlciwgbG9hZEhvb2tJZ25vcmUgfSBmcm9tICcuLi9jb21tb24vc3Bhbi1pZ25vcmUuanMnO1xuaW1wb3J0IHtcbiAgY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcixcbiAgY3JlYXRlRGVmYXVsdFN0YWxlRXhlY3V0b3IsXG4gIGRpc2tNZW1vRmFjdG9yeSxcbiAgdHlwZSBNZW1vRmFjdG9yeSxcbiAgcmVzb2x2ZVRvdWNoU2NvcGUsXG4gIHR5cGUgU3BhbkV4ZWN1dG9yLFxuICB0eXBlIFN0YWxlRXhlY3V0b3IsXG4gIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zXG59IGZyb20gJy4uL2NvbW1vbi9zcGFuLXN1cmZhY2UuanMnO1xuaW1wb3J0IHsgZGVmYXVsdFJlYWRQcmVFZGl0RmlsZSwgcGFyc2VBcHBseVBhdGNoLCB0eXBlIFJlYWRQcmVFZGl0RmlsZSB9IGZyb20gJy4vYXBwbHktcGF0Y2guanMnO1xuXG4vKiogTmFycm93IHRoZSBTREsncyBgdW5rbm93bmAgdG9vbF9pbnB1dCB0byB0aGUgYGFwcGx5X3BhdGNoYCBgeyBjb21tYW5kIH1gIHNoYXBlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5hcnJvd0FwcGx5UGF0Y2hDb21tYW5kKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ICE9PSBudWxsICYmIHR5cGVvZiB0b29sSW5wdXQgPT09ICdvYmplY3QnICYmICdjb21tYW5kJyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBjb21tYW5kID0gKHRvb2xJbnB1dCBhcyB7IGNvbW1hbmQ6IHVua25vd24gfSkuY29tbWFuZDtcbiAgICBpZiAodHlwZW9mIGNvbW1hbmQgPT09ICdzdHJpbmcnKSByZXR1cm4gY29tbWFuZDtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGV4ZWN1dG9yOiBTcGFuRXhlY3V0b3IsXG4gIG1lbW9GYWN0b3J5OiBNZW1vRmFjdG9yeSxcbiAgbG9hZFJ1bGVzOiBIb29rSWdub3JlTG9hZGVyID0gbG9hZEhvb2tJZ25vcmUsXG4gIHN0YWxlRXhlY3V0b3I6IFN0YWxlRXhlY3V0b3IgPSBjcmVhdGVEZWZhdWx0U3RhbGVFeGVjdXRvcigpLFxuICByZWFkUHJlRWRpdEZpbGU6IFJlYWRQcmVFZGl0RmlsZSA9IGRlZmF1bHRSZWFkUHJlRWRpdEZpbGVcbikge1xuICByZXR1cm4gKGlucHV0OiBQcmVUb29sVXNlSW5wdXQsIGN0eDogSG9va0NvbnRleHQpID0+IHtcbiAgICBjb25zdCBjb21tYW5kID0gbmFycm93QXBwbHlQYXRjaENvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgaWYgKGNvbW1hbmQgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBzZXNzaW9uSWQgPSBpbnB1dC5zZXNzaW9uX2lkO1xuICAgIGNvbnN0IGN3ZCA9IGlucHV0LmN3ZCA/PyAnJztcbiAgICBjb25zdCBtZW1vID0gbWVtb0ZhY3RvcnkoY3R4LmxvZ2dlcik7XG4gICAgY29uc3QgZGVwcyA9IHsgZXhlY3V0b3IsIHN0YWxlRXhlY3V0b3IsIG1lbW8sIGxvYWRSdWxlcywgbG9nZ2VyOiBjdHgubG9nZ2VyIH07XG5cbiAgICAvLyBQYXJzZSB0aGUgZW52ZWxvcGUgaW50byBwZXItZmlsZSBhbmNob3JzLCB0aGVuIHN1cmZhY2Ugc3BhbnMgb3ZlcmxhcHBpbmdcbiAgICAvLyBlYWNoIHJlY292ZXJlZCByYW5nZS4gT25lIGVudmVsb3BlIG1heSB0b3VjaCBzZXZlcmFsIGZpbGVzOyB0aGUgc2hhcmVkXG4gICAgLy8gbWVtbyBkZWR1cGVzIGFjcm9zcyBhbmNob3JzIHdpdGhpbiB0aGlzIGNhbGwgYW5kIGFjcm9zcyB0aGUgc2Vzc2lvbi5cbiAgICBjb25zdCBhbmNob3JzID0gcGFyc2VBcHBseVBhdGNoKGNvbW1hbmQsIHJlYWRQcmVFZGl0RmlsZSk7XG4gICAgY29uc3QgYmxvY2tzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcbiAgICAgIC8vIFdob2xlLWZpbGUgd3JpdGVzL2NyZWF0ZXMgY2Fycnkgbm8gcmFuZ2UgXHUyMDE0IG5vdGhpbmcgdG8gaW50ZXJzZWN0IG9uLlxuICAgICAgaWYgKCFhbmNob3IucmFuZ2UpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgYWJzUGF0aCA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgYW5jaG9yLnBhdGgpO1xuICAgICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICBjb25zdCBibG9jayA9IHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zKGRlcHMsIHNjb3BlLnJlcG9Sb290LCBzY29wZS5yZXBvUmVsUGF0aCwgYW5jaG9yLnJhbmdlLCBzZXNzaW9uSWQpO1xuICAgICAgaWYgKGJsb2NrKSBibG9ja3MucHVzaChibG9jayk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2Nrcy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQsIHN5c3RlbU1lc3NhZ2U6IGNvbWJpbmVkIH0pO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBwcmVUb29sVXNlSG9vayhcbiAgeyBtYXRjaGVyOiAnYXBwbHlfcGF0Y2gnLCB0aW1lb3V0OiAxMF8wMDAgfSxcbiAgY3JlYXRlSGFuZGxlcihjcmVhdGVEZWZhdWx0U3BhbkV4ZWN1dG9yKCksIGRpc2tNZW1vRmFjdG9yeSlcbik7XG4iLCAiaW1wb3J0IGhvb2sgZnJvbSBcIi4vcHJlLXRvb2wtdXNlLnRzXCI7XG5pbXBvcnQgeyBleGVjdXRlIH0gZnJvbSBcIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9ydW50aW1lLmpzXCI7XG5leGVjdXRlKGhvb2spO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQTRCTyxJQUFNLDBCQUEwQixvQkFBSSxJQUFJLENBQUMsZ0JBQWdCLG9CQUFvQixlQUFlLENBQUM7OztBQzVCcEcsU0FBUyxlQUFlLGVBQWUsUUFBUSxTQUFTO0FBQ3BELFFBQU0sT0FBTztBQUNiLE9BQUssZ0JBQWdCO0FBQ3JCLE9BQUssVUFBVSxPQUFPO0FBQ3RCLE9BQUssZ0JBQWdCLE9BQU87QUFDNUIsTUFBSSxhQUFhLFVBQVUsT0FBTyxPQUFPLFlBQVksVUFBVTtBQUMzRCxTQUFLLFVBQVUsT0FBTztBQUFBLEVBQzFCO0FBQ0EsU0FBTztBQUNYO0FBQ08sU0FBUyxlQUFlLFFB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
