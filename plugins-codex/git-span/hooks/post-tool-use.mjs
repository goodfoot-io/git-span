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

// src/common/span-surface.ts
import { execFileSync as execFileSync2 } from "node:child_process";
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
import { execFileSync as execFileSync3 } from "node:child_process";
import * as fs4 from "node:fs";
import { basename as basename2, join as join4 } from "node:path";

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
    fs4.statSync(absPath);
    return true;
  } catch {
    return false;
  }
}
function isFileOnDisk(absPath) {
  try {
    return fs4.statSync(absPath).isFile();
  } catch {
    return false;
  }
}
function contentMatches(post, filePath) {
  try {
    if ("exact" in post) return fs4.readFileSync(filePath, "utf8") === post.exact;
    if ("suffix" in post) {
      const content = fs4.readFileSync(filePath, "utf8");
      return content.endsWith(post.suffix) || content.endsWith(`${post.suffix}
`);
    }
    if ("empty" in post) return fs4.statSync(filePath).size === 0;
    return fs4.statSync(filePath).size === post.size;
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
          return execFileSync3("git", args, {
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
        const out = execFileSync3("git", ["status", "--porcelain", "-z", "--untracked-files=no", "--", ...rels], {
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
        src = fs4.readFileSync(input.sourcePath, "utf8");
        dst = fs4.readFileSync(input.filePath, "utf8");
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
    return `Restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, remove its old anchor before adding the new one. Update or retire the why only if its meaning changed. Require \`git span drift ${name}\` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.`;
  }
  return "For each out-of-date span: restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, remove its old anchor before adding the new one. Update or retire the why only if its meaning changed. Require `git span drift <name>` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.";
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
async function runTouchHook(input, executors, memo, probeCache) {
  let treeModified = false;
  try {
    let range = "whole-file";
    if (input.kind === "write") {
      const probe = probeCache ?? createRealityProbeCache(input.targetState === "absent" ? [input.filePath] : []);
      const outcome = evaluateWriteGate(input, probe);
      if (outcome === "decisiveFail" || outcome === "inconclusive" && input.targetState === "absent") {
        return { additionalContext: null, treeModified: false };
      }
      const fix = await executors.fix(input.filePath, input.cwd);
      treeModified = fix.modified;
      range = input.range ?? recoverRangeFromDisk(input.written, input.filePath);
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
    return execFileSync3("git", ["-C", repoRoot, "status", "--porcelain", "--", spanRoot], {
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
        execFileSync3("git", ["span", "drift", resolved.relPath, "--fix"], {
          cwd: resolved.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch (err) {
        void err;
      }
      const after = spanStatusSnapshot(resolved.repoRoot);
      return { modified: before !== after };
    },
    list: async (filePath, cwd) => {
      const resolved = repoRelArg(filePath, cwd);
      if (!resolved) return [];
      try {
        const out = execFileSync3("git", ["span", "list", "--porcelain", resolved.relPath], {
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
        out = execFileSync3("git", ["span", "drift", "--format", "porcelain", ...scoped], {
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
        const out = execFileSync3("git", ["span", "why", name], {
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

// src/common/bash-touch.ts
function bashSpanToTouch(span, sessionId, cwd) {
  if (!resolveTouchScope(cwd, span.absolutePath)) return null;
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
        targetState: "exists",
        postState: span.written !== void 0 ? { content: { suffix: span.written } } : void 0
      };
    case "modify":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        range: span.lineStart !== void 0 ? { start: span.lineStart, end: span.lineEnd ?? span.lineStart } : void 0
      };
    case "delete":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "absent",
        postState: { realDelete: true }
      };
  }
}
function bashResponseInterrupted(toolResponse) {
  if (toolResponse !== null && typeof toolResponse === "object") {
    return Boolean(toolResponse.interrupted);
  }
  return false;
}
function bashResponseExitCode(toolResponse) {
  if (toolResponse !== null && typeof toolResponse === "object") {
    const code = toolResponse.exit_code;
    if (typeof code === "number" && Number.isInteger(code)) return code;
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
async function runBashTouches(matches, sessionId, cwd, toolResponse, executors, memo, warn = console.warn) {
  if (bashResponseInterrupted(toolResponse)) return [];
  const exitCode = bashResponseExitCode(toolResponse);
  const resolved = matches.filter((m) => m.status === "resolved");
  const guards = matches.filter((m) => m.status === "builtin-guard");
  if (resolved.length === 0) return [];
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
      const touch = bashSpanToTouch(m.span, sessionId, cwd);
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
    const join5 = joinOfCommand(idx, groups, guardByIndex);
    const prevVerdict = prevIndex !== null ? effective.get(prevIndex) : void 0;
    if (prevVerdict !== void 0 && join5 !== void 0) {
      if (join5 === "&&" && prevVerdict === "failed" || join5 === "||" && prevVerdict === "succeeded") {
        effective.set(idx, join5 === "&&" ? "failed" : "succeeded");
        skipped.add(idx);
        prevIndex = idx;
        continue;
      }
    }
    effective.set(idx, computed.get(idx));
    prevIndex = idx;
  }
  const blocks = [];
  for (const idx of commandOrder) {
    if (skipped.has(idx)) continue;
    const list = evals.get(idx);
    if (list === void 0) continue;
    let touches = 0;
    for (const e of list) {
      if (e.touch === null || e.explained) continue;
      if (e.outcome === "decisiveFail") continue;
      if (e.outcome === "inconclusive" && e.touch.kind === "write" && e.touch.targetState === "absent") continue;
      if (e.outcome === "inconclusive" && e.touch.kind === "write" && exitCode !== void 0 && exitCode !== 0)
        continue;
      if (touches >= 32) {
        warn(`Bash touch cap (32) reached for simple command ${idx}; dropping the remaining touches`);
        break;
      }
      touches += 1;
      const output = await runTouchHook(e.touch, executors, memo, probeCache);
      if (output.additionalContext) blocks.push(output.additionalContext);
    }
  }
  return blocks;
}

// src/common/parse-command.ts
import { readFileSync as readFileSync5, statSync as statSync4 } from "node:fs";
import { basename as basename3, join as joinPath, resolve as resolvePath } from "node:path";

// src/common/command-resolve.ts
import { execFileSync as execFileSync4 } from "node:child_process";
import { readFileSync as readFileSync4, statSync as statSync3 } from "node:fs";
function countFileLines(absolutePath) {
  try {
    if (!statSync3(absolutePath).isFile()) return null;
    const content = readFileSync4(absolutePath, "utf8");
    if (content.length === 0) return 0;
    const withoutTrailingNewline = content.endsWith("\n") ? content.slice(0, -1) : content;
    return withoutTrailingNewline.split("\n").length;
  } catch {
    return null;
  }
}
function countGitBlobLines(cwd, rev, path) {
  try {
    const out = execFileSync4("git", ["show", `${rev}:${path}`], {
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
        flush("&&");
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === "||") {
        flush("||");
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
        const trimmed = buf.trimEnd();
        let dupRedirect = false;
        if (trimmed.endsWith(">")) {
          const before = trimmed.length >= 2 ? trimmed[trimmed.length - 2] : "";
          dupRedirect = trimmed.length === 1 || /\s|\d/.test(before);
        }
        if (cmd[i + 1] === ">" || dupRedirect) {
          buf += c;
          i += 1;
          continue;
        }
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
function matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join5, results) {
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
        join: join5,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      } : {
        operation: "append",
        absolutePath,
        simpleCommandIndex,
        join: join5,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      }
    });
  }
}
function matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, simpleCommandIndex, join5, results) {
  const contentRedirects = redirects.filter(isContentRedirect);
  const host = argv[0];
  if (contentRedirects.length === 0) {
    if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join5, results);
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
        span: { operation: "truncate", absolutePath, simpleCommandIndex, join: join5 }
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
          join: join5,
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
          join: join5,
          ...threadedOverwrite !== void 0 ? { written: threadedOverwrite } : {}
        }
      });
    }
  }
  if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join5, results);
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
    return statSync4(absolutePath).isDirectory();
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
function emitSourceSpan(results, spec, absolutePath, simpleCommandIndex, join5) {
  if (spec.sourceOperation === "delete") {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: "delete", absolutePath, simpleCommandIndex, join: join5 }
    });
    return;
  }
  const range = resolveSpec({ kind: "toEof", start: 1 }, () => countFileLines(absolutePath));
  results.push({
    status: "resolved",
    idiom: spec.idiom,
    span: range === null ? { operation: "read", absolutePath, simpleCommandIndex, join: join5 } : {
      operation: "read",
      lineStart: range.lineStart,
      lineEnd: range.lineEnd,
      absolutePath,
      simpleCommandIndex,
      join: join5
    }
  });
}
function matchCopyMoveFamily(argv, dirForResolution, simpleCommandIndex, join5, results) {
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
    destPaths = sourcePaths.map((p) => joinPath(targetAbs, basename3(p)));
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
    destPaths = destIsDir ? sourcePaths.map((p) => joinPath(destAbs, basename3(p))) : [destAbs];
  }
  for (let k = 0; k < sourcePaths.length; k++) {
    emitSourceSpan(results, spec, sourcePaths[k], simpleCommandIndex, join5);
  }
  for (let k = 0; k < sourcePaths.length; k++) {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: spec.destOperation, absolutePath: destPaths[k], simpleCommandIndex, join: join5 }
    });
  }
}
var RM_NO_VALUE = /* @__PURE__ */ new Set(["-f", "-i", "-v"]);
var RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d"]);
var GIT_RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d", "-n", "--dry-run"]);
function matchRmOperands(args, excluded, excludeCached, dir, simpleCommandIndex, join5, results) {
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
      span: { operation: "delete", absolutePath: resolvePath(dir, operand), simpleCommandIndex, join: join5 }
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
function matchTruncateOperands(args, dir, simpleCommandIndex, join5, results) {
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
        join: join5,
        ...operand.size !== void 0 ? { size: operand.size } : {}
      }
    });
  }
}
function matchRmTruncate(argv, dirForResolution, simpleCommandIndex, join5, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "rm") {
    matchRmOperands(rest.slice(1), RM_EXCLUDED, false, dirForResolution, simpleCommandIndex, join5, results);
    return;
  }
  if (command === "truncate") {
    matchTruncateOperands(rest.slice(1), dirForResolution, simpleCommandIndex, join5, results);
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
        join5,
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
function classifyHeredocOpener(opener, body, quotedDelim, currentDir, simpleCommandIndex, join5, results) {
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
            join: join5,
            ...singlePlainAppend && r.op === ">>" && bodyLiteral ? { written: body } : {}
          }
        });
      } else {
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join5 } : {
            operation: "create-overwrite",
            absolutePath,
            simpleCommandIndex,
            join: join5,
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
              join: join5,
              ...contentRedirects.length === 0 && bodyLiteral ? { written: body } : {}
            }
          });
        } else {
          results.push({
            status: "resolved",
            idiom: "heredoc-write",
            span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join5 } : {
              operation: "create-overwrite",
              absolutePath,
              simpleCommandIndex,
              join: join5,
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
    classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join5, results);
    return;
  }
}
var NUMERIC_SUBSTITUTION = /^(\d+)(?:,(\d+))?[sy]/;
var UNRESTRICTED_SUBSTITUTION = /^[sy]/;
function matchSedInplace(argv, dirForResolution, simpleCommandIndex, join5, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "sed") {
    matchSedInplaceArgs(rest.slice(1), dirForResolution, simpleCommandIndex, join5, results);
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
function matchSedInplaceArgs(args, dir, simpleCommandIndex, join5, results) {
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
        span: { operation: "modify", lineStart: start, lineEnd: end, absolutePath, simpleCommandIndex, join: join5 }
      });
    } else {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "modify", absolutePath, simpleCommandIndex, join: join5 }
      });
    }
    if (suffix !== null && suffix !== "") {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "create-overwrite", absolutePath: `${absolutePath}${suffix}`, simpleCommandIndex, join: join5 }
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
    return readFileSync5(absolutePath, "utf8");
  } catch {
    return null;
  }
}
function emitPatchTargets(args, isGitApply, host, targetDir, shellDir, redirects, simpleCommandIndex, join5, results) {
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
        join: join5,
        ...t.lineStart !== void 0 ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {}
      }
    });
  }
}
function matchPatchApply(argv, redirects, dirForResolution, simpleCommandIndex, join5, results) {
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
      join5,
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
      join5,
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
function classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join5, results) {
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
        join: join5,
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
function matchFormatter(argv, dirForResolution, simpleCommandIndex, join5, results) {
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
      span: { operation: "modify", absolutePath: resolvePath(dirForResolution, operand), simpleCommandIndex, join: join5 }
    });
  }
}
var RESTORE_NO_VALUE = /* @__PURE__ */ new Set(["-q", "-f", "-u"]);
function emitRestoreCheckoutPathspec(results, idiom, operand, dir, simpleCommandIndex, join5) {
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
    span: { operation: "create-overwrite", absolutePath, simpleCommandIndex, join: join5 }
  });
}
function matchRestoreOperands(args, dir, simpleCommandIndex, join5, results) {
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
    emitRestoreCheckoutPathspec(results, "git-restore-write", operand, dir, simpleCommandIndex, join5);
  }
}
function matchCheckoutOperands(args, dir, simpleCommandIndex, join5, results) {
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
    emitRestoreCheckoutPathspec(results, "git-checkout-write", operand, dir, simpleCommandIndex, join5);
  }
}
function matchGitRestoreCheckout(argv, dirForResolution, simpleCommandIndex, join5, results) {
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
    if (sub.subcommand === "restore") matchRestoreOperands(args, dir, simpleCommandIndex, join5, results);
    else matchCheckoutOperands(args, dir, simpleCommandIndex, join5, results);
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
  let pipeEchoContent = null;
  const joinOf = (simple) => simple.precededBy === "&&" || simple.precededBy === "||" ? simple.precededBy : void 0;
  const emitCandidate = (c, dirForResolution, simpleCommandIndex, join5) => {
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
      span: {
        operation: "read",
        lineStart: range.lineStart,
        lineEnd: range.lineEnd,
        absolutePath,
        simpleCommandIndex,
        join: join5
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
      if (next === void 0 || next.precededBy !== "|") {
        emitCandidate(
          {
            kind: "candidate",
            idiom: argv[0] === "cat" ? "cat-file" : "nl-file",
            fileArg: plainFileArg,
            spec: { kind: "toEof", start: 1 },
            resolverKind: "fs"
          },
          currentDir,
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
          emitCandidate(outcome, outcome.dirOverride ?? currentDir, i, joinOf(simple));
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
          if (outcome.kind === "candidate") emitCandidate(outcome, currentDir, i, joinOf(simple));
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
    if (simple.precededBy !== "|") pipeEchoContent = null;
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
      anchors.push({ path: toPosix2(hunk.path), kind: "whole-write", absent: true });
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
      if (bashResponseInterrupted(input.tool_response)) return void 0;
      const matches = parseCommandDetailed(command2, cwd);
      const blocks2 = await runBashTouches(
        matches,
        sessionId,
        cwd,
        input.tool_response,
        executors,
        memo,
        (message) => ctx.logger.warn(message)
      );
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
        {
          kind: "write",
          sessionId,
          cwd,
          filePath: absPath,
          written: "",
          targetState: anchor.absent ? "absent" : "exists",
          ...anchor.absent ? { postState: { realDelete: true } } : {}
        },
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb21tb24vYmFzaC10b3VjaC50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3VuaWZpZWQtZGlmZi50cyIsICJzcmMvY29kZXgvYXBwbHktcGF0Y2gudHMiLCAic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UudHMiLCAic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhdGggaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNBYnNvbHV0ZVBvc2l4KHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCcvJykgfHwgL15bQS1aYS16XTpcXC8vLnRlc3QocCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhYnNwYXRoQWdhaW5zdChiYXNlOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdCA9IHRvUG9zaXgodGFyZ2V0KTtcbiAgaWYgKGlzQWJzb2x1dGVQb3NpeCh0KSkgcmV0dXJuIHQ7XG4gIGNvbnN0IGIgPSB0b1Bvc2l4KGJhc2UpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gYCR7Yn0vJHt0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVwb1Jvb3QoZGlyOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghZGlyKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCBkaXIsICdyZXYtcGFyc2UnLCAnLS1zaG93LXRvcGxldmVsJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBvdXQudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0b1Bvc2l4KHRyaW1tZWQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgcGF0aCBpcyBleGNsdWRlZCBieSBnaXQncyBpZ25vcmUgcnVsZXNcbiAqICguZ2l0aWdub3JlLCAuZ2l0L2luZm8vZXhjbHVkZSwgY29yZS5leGNsdWRlc0ZpbGUpLiBVc2VkIHRvIGtlZXAgaWdub3JlZFxuICogZmlsZXMgXHUyMDE0IGJ1aWxkIG91dHB1dCwgY2FjaGVzLCBsb2dzIFx1MjAxNCBvdXQgb2YgdG91Y2ggdHJhY2tpbmcgZW50aXJlbHksIHNvXG4gKiB0aGUgdG91Y2ggaG9vayBuZXZlciByZXBvcnRzIHJlYWRzLCB3cml0ZXMsIG9yIHVuY292ZXJlZCB3cml0ZXMgb24gdGhlbS5cbiAqXG4gKiBgZ2l0IGNoZWNrLWlnbm9yZSAtcSA8cGF0aD5gIGV4aXRzIDAgd2hlbiB0aGUgcGF0aCBpcyBpZ25vcmVkLCAxIHdoZW4gaXQgaXNcbiAqIG5vdCwgYW5kIDEyOCBvbiBlcnJvci4gZXhlY0ZpbGVTeW5jIHRocm93cyBvbiBhbnkgbm9uLXplcm8gZXhpdCwgc28gYSBjbGVhblxuICogcmV0dXJuIG1lYW5zIFwiaWdub3JlZFwiLiBBIHN0YXR1cy0xIHRocm93IGlzIHRoZSBleHBlY3RlZCBcIm5vdCBpZ25vcmVkXCJcbiAqIHNpZ25hbDsgYW55IG90aGVyIGZhaWx1cmUgaXMgYW4gdW5yZWxpYWJsZSBhbnN3ZXIsIHNvIHdlIHJlcG9ydCBgZmFsc2VgXG4gKiAoZG8gbm90IGRyb3AgdGhlIHRvdWNoKSByYXRoZXIgdGhhbiBzaWxlbnRseSBoaWRpbmcgYSB0cmFja2VkIGZpbGUuXG4gKi9cbi8qKlxuICogVGhlIGRlZmF1bHQgc3BhbiByb290IGRpcmVjdG9yeSwgcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCwgdXNlZCB3aGVuIG5vXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBnaXQgY29uZmlnIG92ZXJyaWRlcyB0aGUgbG9jYXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOX1JPT1QgPSAnLnNwYW4nO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHNwYW4gcm9vdCBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gcmVwbywgbWlycm9yaW5nIHRoZSBSdXN0IENMSVxuICogcHJlY2VkZW5jZSAobWludXMgdGhlIC0tc3Bhbi1kaXIgQ0xJIGZsYWcsIHdoaWNoIGlzIGludmlzaWJsZSB0byBmaWxlLXdyaXRlXG4gKiBob29rcyk6XG4gKiAgIDEuIEdJVF9TUEFOX0RJUiBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICogICAyLiBgZ2l0IGNvbmZpZyBnaXQtc3Bhbi5kaXJgIGluIHRoZSByZXBvXG4gKiAgIDMuIERlZmF1bHQ6IFwiLnNwYW5cIlxuICpcbiAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIFBPU0lYLXN0eWxlIHBhdGggd2l0aCBubyB0cmFpbGluZyBzbGFzaC5cbiAqIEZhaWwtc2FmZTogYW55IHJlc29sdXRpb24gZXJyb3IgZmFsbHMgYmFjayB0byBcIi5zcGFuXCIgc28gdGhlIGhvb2sgbmV2ZXJcbiAqIGNyYXNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudkRpciA9IHByb2Nlc3MuZW52WydHSVRfU1BBTl9ESVInXTtcbiAgaWYgKGVudkRpciAmJiBlbnZEaXIudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gdG9Qb3NpeChlbnZEaXIudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY29uZmlnJywgJ2dpdC1zcGFuLmRpciddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSByZXR1cm4gdHJpbW1lZDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7IC8vIGNvbmZpZyBrZXkgYWJzZW50IG9yIGdpdCBlcnJvciBcdTIwMTQgZmFsbCB0aHJvdWdoIHRvIGRlZmF1bHRcbiAgfVxuICByZXR1cm4gU1BBTl9ST09UO1xufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRoIGZhbGxzIGluc2lkZSB0aGUgZ2l2ZW4gc3BhbiByb290XG4gKiBkaXJlY3RvcnkuIEEgcGF0aCBpcyBpbnNpZGUgd2hlbiBpdCBlcXVhbHMgdGhlIHNwYW4gcm9vdCBleGFjdGx5IG9yIGlzXG4gKiBuZXN0ZWQgYmVuZWF0aCBpdCAoaS5lLiBzdGFydHMgd2l0aCBcIjxzcGFuUm9vdD4vXCIpLiBUaGUgXCIvXCIgYm91bmRhcnkgcHJldmVudHNcbiAqIGZhbHNlIHBvc2l0aXZlcyBmb3Igc2libGluZ3MgbGlrZSBcIi5zcGFucy94XCIgb3IgXCIuc3Bhbi1ub3Rlcy94XCIuXG4gKlxuICogUGFzcyB0aGUgcmVzdWx0IG9mIGByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpYCBhcyBgc3BhblJvb3RgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aDogc3RyaW5nLCBzcGFuUm9vdDogc3RyaW5nID0gU1BBTl9ST09UKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvb3QgPSBzcGFuUm9vdC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIHJlcG9SZWxQYXRoID09PSByb290IHx8IHJlcG9SZWxQYXRoLnN0YXJ0c1dpdGgoYCR7cm9vdH0vYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0dpdElnbm9yZWQocmVwb1Jvb3Q6IHN0cmluZywgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY2hlY2staWdub3JlJywgJy1xJywgJy0tJywgcmVwb1JlbFBhdGhdLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAnaWdub3JlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgcm9vdCA9IHRvUG9zaXgocmVwb1Jvb3QpO1xuICBjb25zdCBhYnMgPSB0b1Bvc2l4KGFic1BhdGgpO1xuICBjb25zdCBwcmVmaXggPSByb290LmVuZHNXaXRoKCcvJykgPyByb290IDogYCR7cm9vdH0vYDtcbiAgcmV0dXJuIGFicy5zdGFydHNXaXRoKHByZWZpeCkgPyBhYnMuc2xpY2UocHJlZml4Lmxlbmd0aCkgOiBhYnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5vbmljYWxpemVQYXRoKGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShhYnNQYXRoKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCB5ZXQgKGUuZy4gV3JpdGUgdG8gYSBuZXcgZmlsZSk6IGNhbm9uaWNhbGl6ZSB0aGVcbiAgICAvLyBkaXJlY3RvcnkgYW5kIHJlam9pbiB0aGUgYmFzZW5hbWUgc28gc3ltbGlua3MgaW4gdGhlIHBhcmVudCBhcmUgcmVzb2x2ZWQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKSk7XG4gICAgICByZXR1cm4gYCR7ZGlyfS8ke25vZGVQYXRoLmJhc2VuYW1lKGFic1BhdGgpfWA7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQYXJlbnQgZG9lc24ndCBleGlzdCBlaXRoZXI7IGZhbGwgYmFjayB0byB0aGUgdW4tY2Fub25pY2FsaXplZCBwYXRoLlxuICAgICAgcmV0dXJuIGFic1BhdGg7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVQYXRoKHRvb2xJbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGN3ZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGZwID0gdG9vbElucHV0LmZpbGVfcGF0aDtcbiAgaWYgKHR5cGVvZiBmcCAhPT0gJ3N0cmluZycgfHwgZnAubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYWJzID0gYWJzcGF0aEFnYWluc3QoY3dkLCBmcCk7XG4gIHJldHVybiBjYW5vbmljYWxpemVQYXRoKGFicyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZSByYW5nZSB0eXBlcyBhbmQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZXNJbnRlcnNlY3QoYTogTGluZVJhbmdlLCBiOiBMaW5lUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuc3RhcnQgPD0gYi5lbmQgJiYgYS5lbmQgPj0gYi5zdGFydDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3JjZWxhaW4gcm93IHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcmNlbGFpblJvdyB7XG4gIG5hbWU6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtuYW1lLCBwYXRoLCByYW5nZV0gPSBwYXJ0cztcbiAgICBjb25zdCBkYXNoSWR4ID0gcmFuZ2UuaW5kZXhPZignLScpO1xuICAgIGlmIChkYXNoSWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBwYXJzZUludChyYW5nZS5zbGljZSgwLCBkYXNoSWR4KSwgMTApO1xuICAgIGNvbnN0IGVuZCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKGRhc2hJZHggKyAxKSwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vKipcbiAqIFRoZSBmdWxsIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIHN0YXR1cyB0b2tlbiB2b2NhYnVsYXJ5ICh0aGVcbiAqIGdpdC1zcGFuIENMSSdzIHBvcmNlbGFpbiBjb250cmFjdCk6IGBGUkVTSGAvYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBhcmUgcG9zaXRpb25hbC1vci1jbGVhbiBhbmQgbmV2ZXIgZGVidDsgZXZlcnkgb3RoZXIgdG9rZW4gaXMgc2VtYW50aWMgZHJpZnRcbiAqIG9yIGEgdGVybWluYWwvZXJyb3IgY29uZGl0aW9uIGFuZCBpcyBkZWJ0LiBTZWUge0BsaW5rIGlzRGVidH0gZm9yIHRoZVxuICogc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBvbiB0aGF0IHNwbGl0LlxuICovXG5leHBvcnQgY29uc3QgUE9SQ0VMQUlOX1NUQVRVU0VTID0gW1xuICAnRlJFU0gnLFxuICAnUkVTT0xWRURfUEVORElOR19DT01NSVQnLFxuICAnTU9WRUQnLFxuICAnQ0hBTkdFRCcsXG4gICdERUxFVEVEJyxcbiAgJ0NPTkZMSUNUJyxcbiAgJ1NVQk1PRFVMRScsXG4gICdMRlNfTk9UX0ZFVENIRUQnLFxuICAnTEZTX05PVF9JTlNUQUxMRUQnLFxuICAnUFJPTUlTT1JfTUlTU0lORycsXG4gICdTUEFSU0VfRVhDTFVERUQnLFxuICAnRklMVEVSX0ZBSUxFRCcsXG4gICdJT19FUlJPUidcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIFBvcmNlbGFpblN0YXR1cyA9ICh0eXBlb2YgUE9SQ0VMQUlOX1NUQVRVU0VTKVtudW1iZXJdO1xuXG5jb25zdCBQT1JDRUxBSU5fU1RBVFVTX1NFVDogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoUE9SQ0VMQUlOX1NUQVRVU0VTKTtcblxuZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW5TdGF0dXMocmF3OiBzdHJpbmcpOiBQb3JjZWxhaW5TdGF0dXMgfCBudWxsIHtcbiAgcmV0dXJuIFBPUkNFTEFJTl9TVEFUVVNfU0VULmhhcyhyYXcpID8gKHJhdyBhcyBQb3JjZWxhaW5TdGF0dXMpIDogbnVsbDtcbn1cblxuLyoqIEEgYHBhcnNlRHJpZnRQb3JjZWxhaW5gIHJvdzogYSB7QGxpbmsgUG9yY2VsYWluUm93fSBwbHVzIGl0cyBzdGF0dXMgdG9rZW4uICovXG5leHBvcnQgaW50ZXJmYWNlIERyaWZ0UG9yY2VsYWluUm93IGV4dGVuZHMgUG9yY2VsYWluUm93IHtcbiAgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXM7XG59XG5cbi8qKlxuICogVGhlIGRlYnQgaW52YXJpYW50IChzeXN0ZW0td2lkZTsgY29uc3VtZWQgYnkgYm90aCB0aGUgZnV0dXJlIHRvdWNoLWNvcmUgYW5kXG4gKiBhZHZpc29yLWNvcmUpOiBvbmx5IHNlbWFudGljIHN0YXR1c2VzIGFyZSBkZWJ0LiBgQ0hBTkdFRGAgYW5kIGBERUxFVEVEYCBhcmVcbiAqIHNlbWFudGljIGRyaWZ0OyB0aGUgcmVtYWluaW5nIG5vbi1GUkVTSC9NT1ZFRC9SRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCB0b2tlbnNcbiAqIGFyZSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb25zIGFuZCBhcmUgdHJlYXRlZCBhcyBkZWJ0IHRvbyAodGhleSBibG9jayBvblxuICogdGhlaXIgb3duIG1lcml0cyBcdTIwMTQgdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0IGFsbCkuIGBGUkVTSGAsXG4gKiBgTU9WRURgLCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidDogcG9zaXRpb25hbCBkcmlmdCB0aGVcbiAqIENMSSBjYW4gaGVhbCAob3IgYWxyZWFkeSBoYXMpIGlzIGludmlzaWJsZSwgYW5kIGEgcGVuZGluZy1jb21taXQgcmVzb2x1dGlvblxuICogaXMgbm90IG91dHN0YW5kaW5nIGRlYnQuXG4gKlxuICogTm90ZTogdGhlIHBvcmNlbGFpbiB2b2NhYnVsYXJ5IGRvZXMgbm90IGN1cnJlbnRseSBkaXN0aW5ndWlzaFxuICogY29udGVudC1lcXVpdmFsZW50IGBDSEFOR0VEYCAoZS5nLiB3aGl0ZXNwYWNlLW9ubHkgZHJpZnQgYC0tZml4YCBjYW4gaGVhbClcbiAqIGZyb20gZ2VudWluZWx5IHNlbWFudGljIGBDSEFOR0VEYCBcdTIwMTQgdGhhdCBjbGFzc2lmaWNhdGlvbiBpcyBub3QgcHJlc2VudCBpblxuICogYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgb3V0cHV0IHRvZGF5LiBVbnRpbCB0aGUgQ0xJIGV4cG9zZXMgaXQsXG4gKiBldmVyeSBgQ0hBTkdFRGAgcm93IGlzIHRyZWF0ZWQgYXMgZGVidC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRGVidChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0ZSRVNIJzpcbiAgICBjYXNlICdNT1ZFRCc6XG4gICAgY2FzZSAnUkVTT0xWRURfUEVORElOR19DT01NSVQnOlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG4vKipcbiAqIExvd2VyY2FzZSBodW1hbiBsYWJlbCBmb3IgYSBwb3JjZWxhaW4gc3RhdHVzIHRva2VuIChgTEZTX05PVF9GRVRDSEVEYCBcdTIxOTJcbiAqIGBsZnMgbm90IGZldGNoZWRgKS4gVGhlIHNpbmdsZSBsYWJlbCBtYXBwaW5nIGZvciBldmVyeSBodW1hbi1mb3JtYXQgYW5jaG9yXG4gKiBzdWZmaXggXHUyMDE0IGJvdGggdGhlIHRvdWNoIGhvb2sncyBibG9jayBhbmQgdGhlIGFkdmlzb3IncyBtZXNzYWdlcyByZW5kZXIgdGhyb3VnaFxuICogdGhpcywgc28gYSBzdGF0dXMgbmV2ZXIgcmVhZHMgZGlmZmVyZW50bHkgYmV0d2VlbiB0aGUgdHdvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaHVtYW5TdGF0dXNMYWJlbChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIHJldHVybiBzdGF0dXMudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fL2csICcgJyk7XG59XG5cbi8qKlxuICogVGhlIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgc3RhdHVzZXM6IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdFxuICogYWxsLCBzbyB0aGUgcm93IGlzIG5vdCBzcGFuIGRyaWZ0IGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuLiBUaGVzZSBhcmVcbiAqIGBDT05GTElDVGAgKHVucmVzb2x2ZWQgbWVyZ2UpLCBgU1VCTU9EVUxFYCAoYW5jaG9yIGluc2lkZSBhIHN1Ym1vZHVsZSksXG4gKiBgTEZTX05PVF9GRVRDSEVEYC9gTEZTX05PVF9JTlNUQUxMRURgIChHaXQgTEZTIGNvbnRlbnQgdW5hdmFpbGFibGUpLFxuICogYFBST01JU09SX01JU1NJTkdgIChwYXJ0aWFsLWNsb25lIG9iamVjdCBub3QgZmV0Y2hlZCksIGBTUEFSU0VfRVhDTFVERURgXG4gKiAocGF0aCBvdXRzaWRlIHRoZSBzcGFyc2UtY2hlY2tvdXQgY29uZSksIGBGSUxURVJfRkFJTEVEYCAoYSBjbGVhbi9zbXVkZ2VcbiAqIGZpbHRlciBlcnJvcmVkKSwgYW5kIGBJT19FUlJPUmAgKHRyYW5zaWVudCByZWFkIGZhaWx1cmUpLlxuICpcbiAqIFRoZXNlIGFyZSBhIHN0cmljdCBzdWJzZXQgb2Yge0BsaW5rIGlzRGVidH06IGV2ZXJ5IGVudmlyb25tZW50YWwgc3RhdHVzIGlzXG4gKiBhbHNvIGRlYnQgKGl0IGJsb2NrcyBvbiBpdHMgb3duIG1lcml0cyB3aGVuIHN1cmZhY2VkIGluIGEgc3RhdHVzIHJlcG9ydCksIGJ1dFxuICogdGhlIGFkdmlzb3IgbXVzdCB0cmVhdCB0aGVtIGRpZmZlcmVudGx5IGZyb20gKnNlbWFudGljKiBkcmlmdCAoYENIQU5HRURgLFxuICogYERFTEVURURgKS4gU2VtYW50aWMgZHJpZnQgaXMgZml4YWJsZSBieSBlZGl0aW5nIGEgc3Bhbiwgc28gdGhlIGFkdmlzb3IgZmFpbHNcbiAqIGNsb3NlZCBvbiBpdDsgYW4gZW52aXJvbm1lbnRhbCBjb25kaXRpb24gaXMgbm90IHNvbWV0aGluZyBhIHNwYW4gZWRpdCBjYW5cbiAqIHJlc29sdmUsIHNvIHRoZSBhZHZpc29yIGZhaWxzIE9QRU4gb24gaXQgKGFsbG93LCBidXQgc3VyZmFjZSB0aGUgY29uZGl0aW9uKSBcdTIwMTRcbiAqIHJlLWRlbnlpbmcgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZSB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIGhlcmUgd291bGRcbiAqIGNvbnRyYWRpY3QgdGhlIGZhaWwtb3BlbiBjb250cmFjdCB0aGUgcmVzdCBvZiB0aGUgYWR2aXNvciBhbHJlYWR5IGhvbm9ycyBmb3JcbiAqIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZS1mYWlsdXJlIGNvbmRpdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0Vudmlyb25tZW50YWxTdGF0dXMoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdDT05GTElDVCc6XG4gICAgY2FzZSAnU1VCTU9EVUxFJzpcbiAgICBjYXNlICdMRlNfTk9UX0ZFVENIRUQnOlxuICAgIGNhc2UgJ0xGU19OT1RfSU5TVEFMTEVEJzpcbiAgICBjYXNlICdQUk9NSVNPUl9NSVNTSU5HJzpcbiAgICBjYXNlICdTUEFSU0VfRVhDTFVERUQnOlxuICAgIGNhc2UgJ0ZJTFRFUl9GQUlMRUQnOlxuICAgIGNhc2UgJ0lPX0VSUk9SJzpcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBlbWl0cyBhIGRpZmZlcmVudCBzaGFwZSB0aGFuXG4gKiBgbGlzdCAtLXBvcmNlbGFpbmA6IGEgYCMgcG9yY2VsYWluIHYyYCBoZWFkZXIsIGAjIGZ1enp5IE5gIGNvbW1lbnQgbGluZXMsXG4gKiBhbmQgb25lIGA8c3RhdHVzPlxcdDxzcmM+XFx0PG5hbWU+XFx0PHBhdGg+XFx0PHN0YXJ0PlxcdDxlbmQ+YCByb3cgcGVyIGRyaWZ0ZWRcbiAqIGFuY2hvciAod2hvbGUtZmlsZSBhbmNob3JzIGNhcnJ5IGAod2hvbGUpYC9gLWAgaW4gcGxhY2Ugb2YgdGhlIGxpbmUgY29sdW1ucykuXG4gKiBSb3dzIHdob3NlIHN0YXR1cyB0b2tlbiBpcyBub3QgaW4ge0BsaW5rIFBPUkNFTEFJTl9TVEFUVVNFU30gYXJlIHNraXBwZWQgXHUyMDE0XG4gKiBhbiB1bnJlY29nbml6ZWQgdG9rZW4gZnJvbSBhIG5ld2VyIENMSSBpcyB0cmVhdGVkIHRoZSBzYW1lIGFzIGEgbWFsZm9ybWVkXG4gKiBsaW5lIHJhdGhlciB0aGFuIGd1ZXNzZWQgYXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZURyaWZ0UG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogRHJpZnRQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IHRyaW1tZWQuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCA2KSBjb250aW51ZTtcbiAgICBjb25zdCBbc3RhdHVzQ29sLCAsIG5hbWUsIHBhdGgsIHN0YXJ0Q29sLCBlbmRDb2xdID0gcGFydHM7XG4gICAgY29uc3Qgc3RhdHVzID0gcGFyc2VQb3JjZWxhaW5TdGF0dXMoc3RhdHVzQ29sKTtcbiAgICBpZiAoIXN0YXR1cykgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBzdGFydENvbCA9PT0gJyh3aG9sZSknID8gMCA6IHBhcnNlSW50KHN0YXJ0Q29sLCAxMCk7XG4gICAgY29uc3QgZW5kID0gZW5kQ29sID09PSAnLScgPyAwIDogcGFyc2VJbnQoZW5kQ29sLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQsIHN0YXR1cyB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIElEIHNhbml0aXphdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSW5qZWN0aXZlIHRyYW5zZm9ybTogcGVyY2VudC1lbmNvZGUgYnl0ZXMgb3V0c2lkZSBbQS1aYS16MC05Ll8tXSBhcyAlSEhcbiAqICh1cHBlcmNhc2UgaGV4KS4gVXNlZCB0byBwcm9kdWNlIHNhZmUgZmlsZW5hbWVzIGZyb20gYXJiaXRyYXJ5IHNlc3Npb24gaWRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2Vzc2lvbklkLnJlcGxhY2UoL1teQS1aYS16MC05Ll8tXS9nLCAoY2gpID0+IHtcbiAgICByZXR1cm4gYCUke2NoLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkucGFkU3RhcnQoMiwgJzAnKX1gO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQZXItc2Vzc2lvbiBiYXNlIGRpcmVjdG9yeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEJhc2UgZGlyIHNoYXJlZCBieSBhbGwgcGVyLXNlc3Npb24gc3RhdGU6IGN1cnJlbnRseSBqdXN0IHRoZSB0b3VjaC1ob29rXG4vLyBzZXNzaW9uIG1lbW8gKHNwYW4tc3VyZmFjZS50cydzIE1lbW9TdG9yZSkuIEVhY2ggc2Vzc2lvbiBnZXRzIG9uZVxuLy8gc3ViZGlyZWN0b3J5IGtleWVkIGJ5IGl0cyBzYW5pdGl6ZWQgaWQsIHNvIGV2ZXJ5IHdyaXRlci9yZWFkZXIgZm9yIGEgZ2l2ZW5cbi8vIHNlc3Npb24gYWdyZWVzIG9uIGl0cyBsb2NhdGlvbi5cbmV4cG9ydCBjb25zdCBTRVNTSU9OX0JBU0VfRElSID0gbm9kZVBhdGguam9pbihvcy5ob21lZGlyKCksICcuY2FjaGUnLCAnZ2l0LXNwYW4nLCAnc2Vzc2lvbicpO1xuXG4vKiogVGhlIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSBmb3IgYSBnaXZlbiBzZXNzaW9uIGlkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25EaXIoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQpKTtcbn1cblxuY29uc3QgVEhJUlRZX0RBWVNfTVMgPSAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDA7XG5cbi8qKlxuICogT3Bwb3J0dW5pc3RpY2FsbHkgcHJ1bmUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3JpZXMgdW5kZXJcbiAqIHtAbGluayBTRVNTSU9OX0JBU0VfRElSfSB3aG9zZSBtdGltZSBpcyBvbGRlciB0aGFuIGBtYXhBZ2VNc2AgKGRlZmF1bHQgMzBcbiAqIGRheXMpLiBBIGRpcmVjdG9yeSdzIG10aW1lIGFkdmFuY2VzIHdoZW5ldmVyIGFuIGVudHJ5IGluc2lkZSBpdCBpc1xuICogY3JlYXRlZC9yZW5hbWVkL3JlbW92ZWQsIHNvIGFuIGFjdGl2ZSBzZXNzaW9uIChtZW1vIHdyaXRlcykgc3RheXMgZnJlc2g7XG4gKiBvbmx5IGdlbnVpbmVseSBhYmFuZG9uZWQgc2Vzc2lvbnMgYWdlIG91dC5cbiAqXG4gKiBCZXN0LWVmZm9ydCBhbmQgbm9uLXRocm93aW5nOiBjYWxsZWQgb3Bwb3J0dW5pc3RpY2FsbHkgZnJvbSBob29rIHJlYWQvd3JpdGVcbiAqIHBhdGhzLCBub3QgYSBzZXBhcmF0ZSBjcm9uLWxpa2UgbWVjaGFuaXNtLCBzbyBhIGZhaWx1cmUgaGVyZSBtdXN0IG5ldmVyXG4gKiBibG9jayB0aGUgY2FsbGVyJ3MgYWN0dWFsIHdvcmsuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcnVuZVN0YWxlU2Vzc2lvbnMobm93OiBudW1iZXIgPSBEYXRlLm5vdygpLCBtYXhBZ2VNczogbnVtYmVyID0gVEhJUlRZX0RBWVNfTVMpOiB2b2lkIHtcbiAgbGV0IGVudHJpZXM6IGZzLkRpcmVudFtdO1xuICB0cnkge1xuICAgIGVudHJpZXMgPSBmcy5yZWFkZGlyU3luYyhTRVNTSU9OX0JBU0VfRElSLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybjsgLy8gYmFzZSBkaXIgYWJzZW50IG9yIHVucmVhZGFibGUgXHUyMDE0IG5vdGhpbmcgdG8gcHJ1bmVcbiAgfVxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBpZiAoIWVudHJ5LmlzRGlyZWN0b3J5KCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGRpclBhdGggPSBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIGVudHJ5Lm5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoZGlyUGF0aCk7XG4gICAgICBpZiAobm93IC0gc3RhdC5tdGltZU1zID4gbWF4QWdlTXMpIHtcbiAgICAgICAgZnMucm1TeW5jKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFZhbmlzaGVkIGJldHdlZW4gcmVhZGRpciBhbmQgc3RhdCwgb3IgcmVtb3ZhbCBmYWlsZWQgXHUyMDE0IHNraXAgaXQuIEFcbiAgICAgIC8vIGJlc3QtZWZmb3J0IHBydW5lIG11c3QgbmV2ZXIgdGhyb3cgaW50byB0aGUgY2FsbGVyJ3MgaG90IHBhdGguXG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2gga2luZCBhbmQgYW5jaG9yIGZvcm1hdHRpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUb3VjaEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnIHwgJ3dob2xlLXJlYWQnIHwgJ3dob2xlLXdyaXRlJyB8ICdjcmVhdGUnO1xuXG4vKipcbiAqIEZvcm1hdCBhIHNwYW4gYW5jaG9yIHN0cmluZy5cbiAqXG4gKiAtIGB3aG9sZS1yZWFkYCwgYHdob2xlLXdyaXRlYCwgYW5kIGBjcmVhdGVgOiByZXR1cm5zIGp1c3QgdGhlIHBhdGhcbiAqIC0gYHJlYWRgIGFuZCBgd3JpdGVgOiByZXR1cm5zIGBwYXRoI0w8c3RhcnQ+LUw8ZW5kPmAgKHJlcXVpcmVzIHJhbmdlKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0QW5jaG9yKHBhdGg6IHN0cmluZywga2luZDogVG91Y2hLaW5kLCByYW5nZT86IExpbmVSYW5nZSk6IHN0cmluZyB7XG4gIGlmICgoa2luZCA9PT0gJ3JlYWQnIHx8IGtpbmQgPT09ICd3cml0ZScpICYmIHJhbmdlKSB7XG4gICAgcmV0dXJuIGAke3BhdGh9I0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgfVxuICByZXR1cm4gcGF0aDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBbmNob3Igc3BlYyB0eXBlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBBbmNob3JTcGVjIHtcbiAgcGF0aDogc3RyaW5nO1xuICBraW5kOiBUb3VjaEtpbmQ7XG4gIHJhbmdlPzogTGluZVJhbmdlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFF1ZXVlIGRpcmVjdG9yeSBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBnaXQgY29tbW9uIGRpcmVjdG9yeSBmb3IgdGhlIGdpdmVuIHJlcG8gcm9vdC5cbiAqIFRoaXMgaXMgdGhlIHNoYXJlZCBkaXJlY3RvcnkgKG5vdCB0aGUgd29ya3RyZWUtc3BlY2lmaWMgLmdpdCksIHNvIHF1ZXVlXG4gKiByZWNvcmRzIHN1cnZpdmUgd29ya3RyZWUgZGVsZXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3Jldi1wYXJzZScsICctLWdpdC1jb21tb24tZGlyJ10sIHtcbiAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICBlbmNvZGluZzogJ3V0ZjgnXG4gIH0pO1xuICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKTtcbiAgLy8gZ2l0IHJldHVybnMgYSByZWxhdGl2ZSBwYXRoIChlLmcuIFwiLmdpdFwiKSBmb3Igc2ltcGxlIHJlcG9zLiBSZXNvbHZlIGl0XG4gIC8vIGFnYWluc3QgcmVwb1Jvb3Qgc28gY2FsbGVycyBuZXZlciBkZXBlbmQgb24gcHJvY2Vzcy5jd2QoKS5cbiAgaWYgKCFub2RlUGF0aC5pc0Fic29sdXRlKHRyaW1tZWQpKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgobm9kZVBhdGgucmVzb2x2ZShyZXBvUm9vdCwgdHJpbW1lZCkpO1xuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJvb3Qgb2YgdGhlIGdpdC1zcGFuIHF1ZXVlIGRpcmVjdG9yeSB0cmVlLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWV1ZVJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3QpLCAnZ2l0LXNwYW4nKTtcbn1cblxuLyoqXG4gKiBEaXJlY3RvcnkgZm9yIHRoZSBhZHZpc29yJ3MgcGVyLWNoYW5nZXNldCBzdGF0ZSBtZW1vcyAoZGlnZXN0IG9mIHNvcnRlZFxuICogZmluZGluZ3MgKyB1bmNvdmVyZWQgcGF0aHMpLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIgc28gaXQgaXMgc2hhcmVkXG4gKiBhY3Jvc3Mgd29ya3RyZWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYWR2aXNvck1lbW9EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHF1ZXVlUm9vdChyZXBvUm9vdCksICdhZHZpc29yJyk7XG59XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHNwYW4tc3VyZmFjaW5nIGNvcmUuXG4gKlxuICogR2l2ZW4gYW4gYWxyZWFkeS1yZXNvbHZlZCByZXBvLXJlbGF0aXZlIHBhdGggYW5kIGEgbGluZSByYW5nZSwgdGhpcyBtb2R1bGVcbiAqIHJ1bnMgdGhlIHNoYXJlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgLyBgLmhvb2tpZ25vcmVgIC8gc2Vzc2lvbi1tZW1vIC9cbiAqIGBnaXQgc3BhbiBkcmlmdGAgcGlwZWxpbmUgYW5kIGFzc2VtYmxlcyB0aGUgaHVtYW4tcmVhZGFibGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmBcbiAqIGJsb2NrIHRoYXQgYm90aCBhZGFwdGVycyBzdXJmYWNlIGlubGluZSBiZWZvcmUgYW4gZWRpdC4gSXQgaW1wb3J0cyBub3RoaW5nXG4gKiBmcm9tIGVpdGhlciBob29rIFNESzogdGhlIENsYXVkZSBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgYSByYW5nZSBkZXJpdmVkIGZyb21cbiAqIGBmaWxlX3BhdGhgL2BvZmZzZXRgL2BvbGRfc3RyaW5nYDsgdGhlIENvZGV4IFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCB0aGVcbiAqIHJhbmdlcyByZWNvdmVyZWQgZnJvbSBhbiBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlLiBFYWNoIGFkYXB0ZXIgd3JhcHMgdGhlXG4gKiByZXR1cm5lZCBibG9jayBzdHJpbmcgaW4gaXRzIG93biBTREsgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogVGhlIGV4ZWN1dG9yL2RyaWZ0L21lbW8gZGVwZW5kZW5jaWVzIGFyZSBpbmplY3RlZCBzbyB0aGUgcGlwZWxpbmUgaXMgdGVzdGFibGVcbiAqIHdpdGggZmFrZXMgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGUgc2hhcmVkIGtlcm5lbC5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgaXNHaXRJZ25vcmVkLFxuICBpc0luc2lkZVNwYW5Sb290LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICBwcnVuZVN0YWxlU2Vzc2lvbnMsXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290LFxuICBzZXNzaW9uRGlyLFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHR5cGUgSG9va0lnbm9yZUxvYWRlciwgaXNTcGFuU3VwcHJlc3NlZCB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG4vKipcbiAqIE1pbmltYWwgbG9nZ2VyIHN1cmZhY2UgdGhlIGBjb21tb24vYCBsYXllciBsb2dzIHRocm91Z2g7IGJvdGggU0RLIGxvZ2dlcnNcbiAqIHNhdGlzZnkgaXQuIGB3YXJuYCBpcyByZXF1aXJlZCBcdTIwMTQgZXZlcnkgZXhpc3RpbmcgY2FsbCBzaXRlIHJlcG9ydHMgYSBmYWlsdXJlLlxuICogYGluZm9gIGlzIG9wdGlvbmFsIHNvIGEgZmFrZSBjYXJyeWluZyBvbmx5IGB3YXJuYCBzdGlsbCBzYXRpc2ZpZXMgdGhlXG4gKiBpbnRlcmZhY2U6IGl0IGV4aXN0cyBmb3IgdGhlIGRpYWdub3N0aWMgYnJlYWRjcnVtYnMgYSAqc3VjY2Vzc2Z1bCogcnVuIGxlYXZlc1xuICogYmVoaW5kIChhZHZpc29yLWNvcmUncyBjaHVybi1zdXBwcmVzc2lvbiBjb3VudCksIHdoaWNoIGFyZSBub3Qgd2FybmluZ3MgYW5kXG4gKiBtdXN0IG5vdCByZWFkIGFzIGZhaWx1cmVzIGluIHRoZSBob29rIGxvZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb3JlTG9nZ2VyIHtcbiAgd2FybihtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG4gIGluZm8/KG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTcGFuIGV4ZWN1dG9yIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBFeGVjdXRlcyBgZ2l0IHNwYW4gbGlzdGAgd2l0aCBnaXZlbiBhcmdzIGluIGEgZ2l2ZW4gY3dkLlxuICogUmV0dXJucyBzdGRvdXQgc3RyaW5nLiBUaHJvd3Mgb24gbm9uLXplcm8gZXhpdC5cbiAqL1xuZXhwb3J0IHR5cGUgU3BhbkV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBTcGFuRXhlY3V0b3Ige1xuICByZXR1cm4gKGFyZ3MsIGN3ZCkgPT4ge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4uYXJnc10sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW5zIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPHNsdWdzPmAgYW5kIHJldHVybnMgaXRzIHBvcmNlbGFpbiBzdGRvdXQgXHUyMDE0XG4gKiBvbmUgcm93IHBlciAqZHJpZnRlZCogYW5jaG9yIGFtb25nIHRoZSBnaXZlbiBzcGFucywgZW1wdHkgd2hlbiBhbGwgYXJlIGNsZWFuLlxuICogYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAwIGluIHBvcmNlbGFpbiBtb2RlIHdoZXRoZXIgb3Igbm90IGRyaWZ0IGV4aXN0cywgYnV0IHdlXG4gKiBzdGlsbCBjYXB0dXJlIHN0ZG91dCBmcm9tIGEgdGhyb3duIGVycm9yIHNvIGEgZHJpZnQgc2lnbmFsIGlzIG5ldmVyIGxvc3QgdG8gYVxuICogbm9uLXplcm8gZXhpdC4gVGhyb3dzIG9ubHkgd2hlbiBubyBzdGRvdXQgaXMgYXZhaWxhYmxlIChnZW51aW5lIGZhaWx1cmUpLlxuICovXG5leHBvcnQgdHlwZSBEcmlmdEV4ZWN1dG9yID0gKHNsdWdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHREcmlmdEV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IERyaWZ0RXhlY3V0b3Ige1xuICByZXR1cm4gKHNsdWdzLCBjd2QpID0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNsdWdzXSwge1xuICAgICAgICBjd2QsXG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgaWYgKHR5cGVvZiBvdXQgPT09ICdzdHJpbmcnKSByZXR1cm4gb3V0O1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIG1lbW8gYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lbW9TdG9yZSB7XG4gIGdldFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nKTogU2V0PHN0cmluZz47XG4gIGFkZFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nLCBuYW1lczogc3RyaW5nW10pOiB2b2lkO1xufVxuXG4vLyBMaXZlcyB1bmRlciB0aGUgc2hhcmVkIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSAoYWdlbnQtaG9va3MtY29tbW9uLnRzJ3Ncbi8vIHNlc3Npb25EaXIpIFx1MjAxNCByZWxvY2F0ZWQgZnJvbSBvcy50bXBkaXIoKS9hZ2VudC1ob29rcy1naXQtc3Bhbi8gc29cbi8vIHBlci1zZXNzaW9uIHN0YXRlIGhhcyBvbmUgaG9tZSBhbmQgaXMgY292ZXJlZCBieSBwcnVuZVN0YWxlU2Vzc2lvbnMnc1xuLy8gb3Bwb3J0dW5pc3RpYyA+MzAtZGF5IHBydW5pbmcuXG5mdW5jdGlvbiBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihzZXNzaW9uRGlyKHNlc3Npb25JZCksICd0b3VjaC1tZW1vLmpzb24nKTtcbn1cblxuZXhwb3J0IHR5cGUgTWVtb0xvZ2dlciA9IENvcmVMb2dnZXI7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiB7XG4gICAgZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJhdyA9IGZzLnJlYWRGaWxlU3luYyhtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKSwgJ3V0ZjgnKTtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHsgc3VyZmFjZWQ/OiB1bmtub3duIH07XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZC5zdXJmYWNlZCkpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IFNldChwYXJzZWQuc3VyZmFjZWQgYXMgc3RyaW5nW10pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gcmVhZCBmYWlsZWQgKHRyZWF0aW5nIGFzIGVtcHR5KScsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBTZXQoKTtcbiAgICB9LFxuICAgIGFkZFN1cmZhY2VkKHNlc3Npb25JZCwgbmFtZXMpIHtcbiAgICAgIHBydW5lU3RhbGVTZXNzaW9ucygpO1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gICAgICBmb3IgKGNvbnN0IG4gb2YgbmFtZXMpIGV4aXN0aW5nLmFkZChuKTtcbiAgICAgIGNvbnN0IG1lbW9EaXIgPSBzZXNzaW9uRGlyKHNlc3Npb25JZCk7XG4gICAgICBjb25zdCBtZW1vUGF0aCA9IG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgdG1wUGF0aCA9IGAke21lbW9QYXRofS50bXBgO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKG1lbW9EaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHRtcFBhdGgsIEpTT04uc3RyaW5naWZ5KHsgc3VyZmFjZWQ6IFsuLi5leGlzdGluZ10gfSksICd1dGY4Jyk7XG4gICAgICAgIGZzLnJlbmFtZVN5bmModG1wUGF0aCwgbWVtb1BhdGgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHdyaXRlIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqIEZhY3RvcnkgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEgTWVtb1N0b3JlIGdpdmVuIGEgbG9nZ2VyLiAqL1xuZXhwb3J0IHR5cGUgTWVtb0ZhY3RvcnkgPSAobG9nZ2VyOiBNZW1vTG9nZ2VyKSA9PiBNZW1vU3RvcmU7XG5cbi8qKiBEZWZhdWx0IGRpc2stYmFja2VkIG1lbW8gZmFjdG9yeSB1c2VkIGluIHByb2R1Y3Rpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZGlza01lbW9GYWN0b3J5KGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggc2NvcGUgcmVzb2x1dGlvbiAocmVwby1zY29waW5nICsgZ2l0aWdub3JlICsgc3Bhbi1yb290IGd1YXJkcylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoU2NvcGUge1xuICByZXBvUm9vdDogc3RyaW5nO1xuICByZXBvUmVsUGF0aDogc3RyaW5nO1xufVxuXG4vKipcbiAqIEJvdW5kIGEgdG91Y2hlZCBmaWxlIHRvIHRoZSBDV0QgcmVwby4gUmVzb2x2ZSB0aGUgcmVwbyByb290IG9mIHRoZSBjdXJyZW50XG4gKiB3b3JraW5nIGRpcmVjdG9yeSBhbmQgcmVxdWlyZSB0aGUgdG91Y2hlZCBmaWxlIHRvIHJlc29sdmUgdG8gdGhlIFNBTUUgcmVwb1xuICogcm9vdDsgZHJvcCBmaWxlcyBpbiBhIGRpZmZlcmVudCByZXBvc2l0b3J5L3dvcmt0cmVlLCBnaXRpZ25vcmVkIGZpbGVzLCBhbmRcbiAqIGZpbGVzIHVuZGVyIHRoZSBzcGFuIHJvb3QuIFJldHVybnMgdGhlIHJlc29sdmVkIGB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9YFxuICogb3IgbnVsbCB3aGVuIHRoZSB0b3VjaCBpcyBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQ29tcGFyaW5nIHJlc29sdmVkIGBnaXQgLS1zaG93LXRvcGxldmVsYCB0b3BsZXZlbHMgKG5vdCBwYXRoIHByZWZpeGVzKVxuICogZGlzdGluZ3Vpc2hlcyBzZXBhcmF0ZSByZXBvcyBhbmQgd29ya3RyZWVzIGFuZCBpcyByb2J1c3QgdG8gc3ltbGlua3MuIEZhaWxcbiAqIGNsb3NlZDogaWYgdGhlIENXRCByZXBvIGNhbid0IGJlIHJlc29sdmVkLCB0aGUgdG91Y2ggaXMgZHJvcHBlZCByYXRoZXIgdGhhblxuICogZmFsbGluZyBiYWNrIHRvIHRoZSBmaWxlJ3Mgb3duIHJlcG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlVG91Y2hTY29wZShjd2Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogVG91Y2hTY29wZSB8IG51bGwge1xuICBjb25zdCBjd2RSZXBvUm9vdCA9IGN3ZCA/IHJlc29sdmVSZXBvUm9vdChjd2QpIDogbnVsbDtcbiAgaWYgKCFjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgYWJzRGlyID0gdG9Qb3NpeChub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKTtcbiAgY29uc3QgZmlsZVJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGFic0Rpcik7XG4gIGlmIChmaWxlUmVwb1Jvb3QgIT09IGN3ZFJlcG9Sb290KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCByZXBvUm9vdCA9IGN3ZFJlcG9Sb290O1xuICBjb25zdCByZXBvUmVsUGF0aCA9IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhYnNQYXRoKTtcblxuICAvLyBTa2lwIGdpdGlnbm9yZWQgZmlsZXMgZW50aXJlbHkuIEJ1aWxkIG91dHB1dCwgY2FjaGVzLCBhbmQgbG9ncyBhcmUgbm90XG4gIC8vIHNwYW4tcmVsZXZhbnQ6IHRoZXkgbXVzdCBuZXZlciBzdXJmYWNlIHNwYW4gb3ZlcmxhcHMuXG4gIGlmIChpc0dpdElnbm9yZWQocmVwb1Jvb3QsIHJlcG9SZWxQYXRoKSkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU2tpcCBzcGFuIGRvY3VtZW50cyBlbnRpcmVseS4gRmlsZXMgdW5kZXIgdGhlIHJlc29sdmVkIHNwYW4gcm9vdCBhcmUgbWFuYWdlZFxuICAvLyBieSBnaXQgc3BhbiBpdHNlbGYgYW5kIGFyZSBub3QgYXBwbGljYXRpb24gc291cmNlcyB0aGF0IG5lZWQgc3BhbiBjb3ZlcmFnZS5cbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICBpZiAoaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aCwgc3BhblJvb3QpKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4geyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTdXJmYWNlIHJvdXRpbmVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogSW5qZWN0ZWQgZGVwZW5kZW5jaWVzIGZvciB7QGxpbmsgc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnN9LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdXJmYWNlRGVwcyB7XG4gIGV4ZWN1dG9yOiBTcGFuRXhlY3V0b3I7XG4gIGRyaWZ0RXhlY3V0b3I6IERyaWZ0RXhlY3V0b3I7XG4gIG1lbW86IE1lbW9TdG9yZTtcbiAgbG9hZFJ1bGVzOiBIb29rSWdub3JlTG9hZGVyO1xuICBsb2dnZXI6IENvcmVMb2dnZXI7XG59XG5cbi8qKlxuICogR2l2ZW4gYSByZXBvLXJlbGF0aXZlIHBhdGggYW5kIHRoZSBsaW5lIHJhbmdlIGJlaW5nIHRvdWNoZWQgd2l0aGluIGFuXG4gKiBhbHJlYWR5LXJlc29sdmVkIHJlcG8sIHByb2R1Y2UgdGhlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gIGJsb2NrIGZvciB0aGVcbiAqIHNwYW5zIG92ZXJsYXBwaW5nIHRoYXQgcmFuZ2UsIG9yIG51bGwgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHRvIHN1cmZhY2UuXG4gKlxuICogVGhlIHBpcGVsaW5lOiBgZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5gIFx1MjE5MiBrZWVwIGxpbmUtcmFuZ2VkIGFuY2hvcnMgb25cbiAqIHRoZSBzYW1lIGZpbGUgdGhhdCBpbnRlcnNlY3QgdGhlIHJhbmdlIGFuZCBhcmUgbm90IGAuaG9va2lnbm9yZWAtc3VwcHJlc3NlZCBcdTIxOTJcbiAqIGRyb3Agc2x1Z3MgYWxyZWFkeSBzdXJmYWNlZCB0aGlzIHNlc3Npb24gKG1lbW8pIFx1MjE5MiByZW5kZXIgYGdpdCBzcGFuIGxpc3RcbiAqIDxuYW1lc1x1MjAyNj5gIFx1MjE5MiBhcHBlbmQgYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIgZm9yIGFueSBhbHJlYWR5LWRyaWZ0ZWRcbiAqIHNwYW4uIE9uIHN1Y2Nlc3MgdGhlIHN1cmZhY2VkIG5hbWVzIGFyZSByZWNvcmRlZCBpbiB0aGUgbWVtby4gRXhlY3V0b3IgYW5kXG4gKiBkcmlmdC1wcm9iZSBmYWlsdXJlcyBhcmUgbG9nZ2VkIGFuZCBkZWdyYWRlIHRvIG51bGwgLyB0aGUgcGxhaW4gYmxvY2s7IHRoZXlcbiAqIG5ldmVyIHRocm93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnMoXG4gIGRlcHM6IFN1cmZhY2VEZXBzLFxuICByZXBvUm9vdDogc3RyaW5nLFxuICByZXBvUmVsUGF0aDogc3RyaW5nLFxuICByYW5nZTogTGluZVJhbmdlLFxuICBzZXNzaW9uSWQ6IHN0cmluZ1xuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHsgZXhlY3V0b3IsIGRyaWZ0RXhlY3V0b3IsIG1lbW8sIGxvYWRSdWxlcywgbG9nZ2VyIH0gPSBkZXBzO1xuXG4gIC8vIEZpbHRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpblxuICBsZXQgcG9yY2VsYWluU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcG9yY2VsYWluU3Rkb3V0ID0gZXhlY3V0b3IoWyctLXBvcmNlbGFpbicsIHJlcG9SZWxQYXRoXSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIFBhdGgtc2NvcGVkIHN1cHByZXNzaW9uOiBhIHJlcG8ncyAuc3Bhbi8uaG9va2lnbm9yZSBjYW4gaG9sZCBiYWNrIHNwYW4gc2x1Z1xuICAvLyBwcmVmaXhlcyBmb3IgYW5jaG9ycyB1bmRlciBnaXZlbiBwYXRocy4gQSBzdXBwcmVzc2VkIHNwYW4gaXMgbmV2ZXIgc3VyZmFjZWQuXG4gIGNvbnN0IGlnbm9yZVJ1bGVzID0gbG9hZFJ1bGVzKHJlcG9Sb290KTtcblxuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IHBhcnNlUG9yY2VsYWluKHBvcmNlbGFpblN0ZG91dCk7XG4gIGNvbnN0IGNhbmRpZGF0ZU5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBpZiAocm93LnBhdGggIT09IHJlcG9SZWxQYXRoKSBjb250aW51ZTtcbiAgICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIGNvbnRpbnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICAgIGlmICghcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KSkgY29udGludWU7XG4gICAgaWYgKGlzU3BhblN1cHByZXNzZWQoaWdub3JlUnVsZXMsIHJvdy5wYXRoLCByb3cubmFtZSkpIGNvbnRpbnVlO1xuICAgIGNhbmRpZGF0ZU5hbWVzLmFkZChyb3cubmFtZSk7XG4gIH1cblxuICBpZiAoY2FuZGlkYXRlTmFtZXMuc2l6ZSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU3VidHJhY3QgYWxyZWFkeS1zdXJmYWNlZCBuYW1lc1xuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9TdXJmYWNlID0gWy4uLmNhbmRpZGF0ZU5hbWVzXS5maWx0ZXIoKG4pID0+ICFzdXJmYWNlZC5oYXMobikpLnNvcnQoKTtcbiAgaWYgKHRvU3VyZmFjZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFJlbmRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxuYW1lMT4gPG5hbWUyPiAuLi5cbiAgbGV0IHJlbmRlclN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHJlbmRlclN0ZG91dCA9IGV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAocmVuZGVyKSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE9mIHRoZSBzcGFucyBiZWluZyBzdXJmYWNlZCwgZmxhZyBhbnkgYWxyZWFkeSBkcmlmdGVkIFx1MjAxNCB0aGUgdG91Y2hlZCBsaW5lcyBoYXZlXG4gIC8vIGRyaWZ0ZWQgZnJvbSB0aGVpciBhbmNob3JlZCBzdGF0ZSBcdTIwMTQgd2l0aCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlci5cbiAgLy8gRGV0ZWN0aW9uIGlzIGFzLW9mLW5vdyAoc3VyZmFjaW5nIHJ1bnMgYmVmb3JlIHRoZSBlZGl0IGFwcGxpZXMpLCBzbyB0aGlzXG4gIC8vIGNhdGNoZXMgcHJlLWV4aXN0aW5nIGRyaWZ0OyBkcmlmdCB0aGlzIHNlc3Npb24gY2F1c2VzIGlzIHRoZSBTdG9wIGhvb2sncyBqb2IuXG4gIC8vIEZhaWx1cmUgdG8gY29tcHV0ZSBkcmlmdCBpcyBub24tZmF0YWw6IGZhbGwgYmFjayB0byB0aGUgcGxhaW4gYmxvY2suXG4gIGxldCBkcmlmdEhpbnQgPSAnJztcbiAgdHJ5IHtcbiAgICBjb25zdCBkcmlmdE5hbWVzID0gbmV3IFNldChwYXJzZURyaWZ0UG9yY2VsYWluKGRyaWZ0RXhlY3V0b3IodG9TdXJmYWNlLCByZXBvUm9vdCkpLm1hcCgocikgPT4gci5uYW1lKSk7XG4gICAgY29uc3QgZHJpZnRTdXJmYWNlZCA9IHRvU3VyZmFjZS5maWx0ZXIoKG4pID0+IGRyaWZ0TmFtZXMuaGFzKG4pKTtcbiAgICBpZiAoZHJpZnRTdXJmYWNlZC5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBsaW5lcyA9IGRyaWZ0U3VyZmFjZWQubWFwKChuKSA9PiBgICBnaXQgc3BhbiBoaXN0b3J5ICR7bn1gKS5qb2luKCdcXG4nKTtcbiAgICAgIGRyaWZ0SGludCA9IGBcXG5EcmlmdCBcdTIwMTQgdGhlIGxpbmVzIHlvdSdyZSB0b3VjaGluZyBoYXZlIGRyaWZ0ZWQgZnJvbSB0aGVzZSBzcGFucycgYW5jaG9yZWQgc3RhdGUuIFJldmlldyBob3cgZWFjaCBzdWJzeXN0ZW0gZXZvbHZlZCBiZWZvcmUgY2hhbmdpbmcgaXQ6XFxuJHtsaW5lc31gO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGRyaWZ0IChoaXN0b3J5IGhpbnQpIGZhaWxlZCcsIHsgZXJyIH0pO1xuICB9XG5cbiAgY29uc3Qgd3JhcHBlZCA9IGBcXG48Z2l0LXNwYW4+XFxuJHtyZW5kZXJTdGRvdXR9JHtkcmlmdEhpbnR9XFxuPC9naXQtc3Bhbj5cXG5gO1xuXG4gIC8vIFVwZGF0ZSBtZW1vXG4gIG1lbW8uYWRkU3VyZmFjZWQoc2Vzc2lvbklkLCB0b1N1cmZhY2UpO1xuXG4gIHJldHVybiB3cmFwcGVkO1xufVxuIiwgIi8qKlxuICogUGF0aC1zY29wZWQgc3BhbiBzdXBwcmVzc2lvbiBmb3IgdGhlIGFnZW50IGhvb2tzLlxuICpcbiAqIFNvbWUgc3BhbnMgYXJlIG5vaXNlIHdoZW4gYnJvd3NpbmcgY2VydGFpbiBwYXJ0cyBvZiB0aGUgdHJlZSBcdTIwMTQgd2lraSBvclxuICogbWFya2V0aW5nIHNwYW5zIHRoYXQgYW5jaG9yIHByb3NlLCBzdXJmYWNlZCBpbmxpbmUgd2hpbGUgcmVhZGluZyBzb3VyY2UsXG4gKiBhZGQgbGl0dGxlLiBUaGlzIG1vZHVsZSBsZXRzIGEgcmVwbyBkZWNsYXJlLCBwZXIgcGF0aCwgd2hpY2ggc3BhbiBzbHVnXG4gKiBwcmVmaXhlcyB0byBob2xkIGJhY2suXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5ob29raWdub3JlYC4gRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGFcbiAqIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4sIGEgc2luZ2xlIHJ1biBvZiB3aGl0ZXNwYWNlLCB0aGVuIGFcbiAqIGNvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHNwYW4gc2x1ZyBwcmVmaXhlcyB0byBzdXBwcmVzcyBmb3IgcGF0aHMgdGhlIHBhdHRlcm5cbiAqIG1hdGNoZXM6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMgd2lraSxtYXJrZXRpbmdcbiAqXG4gKiBBIHNwYW4gd2hvc2Ugc2x1ZyBiZWdpbnMgd2l0aCBgd2lraWAgb3IgYG1hcmtldGluZ2AgKHRoZSBzbHVnIGVxdWFscyB0aGVcbiAqIHByZWZpeCwgb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmApIGlzIHRoZW4gbmV2ZXIgc3VyZmFjZWQgZm9yIGFuIGFuY2hvciB3aG9zZSBwYXRoXG4gKiBzaXRzIHVuZGVyIGBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmNgIFx1MjAxNCBpdCBpcyBuZXZlciBzdXJmYWNlZCBpbiB0aGUgaW5saW5lXG4gKiBgPGdpdC1zcGFuPmAgYmxvY2sgdGhlIGBQb3N0VG9vbFVzZWAgdG91Y2ggaG9vayBlbWl0cy4gSXQgaGFzIG5vIGVmZmVjdCBvblxuICogdGhlIGBQcmVUb29sVXNlYCBhZHZpc29yLCB3aG9zZSBvd24gdW5jb3ZlcmVkLXdyaXRlcyBzdXBwcmVzc2lvbiBsaXZlcyBpblxuICogYC5zcGFuLy5hZHZpc29yaWdub3JlYCAoc2VlIGBhZHZpc29yLWlnbm9yZS50c2ApLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmFkdmlzb3JpZ25vcmVgXG4gKiBpbiBgYWR2aXNvci1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIEhhcm5lc3MtYWdub3N0aWMgdG91Y2gtaG9vayBjb3JlLlxuICpcbiAqIFRoaXMgbW9kdWxlIGltcGxlbWVudHMgdGhlIFBvc3RUb29sVXNlIFwidG91Y2ggc2lnbmFsXCIgdGhhdCBib3RoIHRoZSBDbGF1ZGVcbiAqIChgUmVhZHxFZGl0fFdyaXRlYCkgYW5kIENvZGV4IChgYXBwbHlfcGF0Y2hgKSBhZGFwdGVycyBkcml2ZS4gSXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICoge0BsaW5rIFRvdWNoSW5wdXR9LCBpbmplY3QgZXhlY3V0aW9uL3N0YXRlIGRlcGVuZGVuY2llcywgYW5kIHdyYXAgdGhlIHJldHVybmVkXG4gKiB7QGxpbmsgVG91Y2hPdXRwdXR9IGluIHRoZWlyIG93biBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBSZXVzZWQgZnJvbSB0aGUgc2hhcmVkIGtlcm5lbCAobm90IHJlZGVmaW5lZCk6IGBpc0RlYnQoKWAgK1xuICogYFBvcmNlbGFpblN0YXR1c2AvYERyaWZ0UG9yY2VsYWluUm93YC9gUG9yY2VsYWluUm93YC9gcGFyc2VQb3JjZWxhaW5gL1xuICogYHBhcnNlRHJpZnRQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpLCBgcmFuZ2VzSW50ZXJzZWN0YCBhbmQgdGhlXG4gKiByZXBvL3NwYW4tcm9vdCBwYXRoIHV0aWxpdGllcyAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYW5kIHRoZSBgTWVtb1N0b3JlYFxuICogY2FkZW5jZSBzdG9yZSAoc3Bhbi1zdXJmYWNlLnRzKS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSwgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICB0eXBlIERyaWZ0UG9yY2VsYWluUm93LFxuICBodW1hblN0YXR1c0xhYmVsLFxuICBpc0RlYnQsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgdHlwZSBQb3JjZWxhaW5TdGF0dXMsXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBjb2xsYXBzZUJ5UGF0aCwgdHlwZSBSYW5nZUxhYmVsLCByZW5kZXJBbmNob3JUcmVlIH0gZnJvbSAnLi9hbmNob3ItdHJlZS5qcyc7XG5pbXBvcnQgdHlwZSB7IE1lbW9TdG9yZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LWVkaXQgcmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNwbGl0IHdyaXR0ZW4gY29udGVudCBpbnRvIHRoZSBsaW5lcyB0byBsb2NhdGUgb24gZGlzay4gQSBzaW5nbGUgdHJhaWxpbmdcbiAqIG5ld2xpbmUgaXMgZHJvcHBlZCBzbyBgXCJhXFxuYlxcblwiYCBhbmQgYFwiYVxcbmJcImAgbG9jYXRlIGlkZW50aWNhbGx5OyBhbiBlbXB0eVxuICogKG9yIG5ld2xpbmUtb25seSkgd3JpdGUgaGFzIG5vIGxvY2F0YWJsZSBibG9jay5cbiAqL1xuZnVuY3Rpb24gdG9OZWVkbGVMaW5lcyh3cml0dGVuOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCB0cmltbWVkID0gd3JpdHRlbi5lbmRzV2l0aCgnXFxuJykgPyB3cml0dGVuLnNsaWNlKDAsIC0xKSA6IHdyaXR0ZW47XG4gIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICByZXR1cm4gdHJpbW1lZC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgbGluZSByYW5nZSB0aGF0IHdyaXR0ZW4gY29udGVudCBub3cgb2NjdXBpZXMgaW4gdGhlIG9uLWRpc2sgZmlsZSxcbiAqIGZvciBhbmNob3JpbmcgdGhlIHRvdWNoZWQgcmVnaW9uIGFmdGVyIGFuIGVkaXQgaGFzIGFscmVhZHkgYXBwbGllZC5cbiAqXG4gKiBUaGlzIGdlbmVyYWxpemVzIHRoZSBwcmUtZWRpdCBgbG9jYXRlQ2h1bmsoKWAgdGVjaG5pcXVlIGluXG4gKiBbYXBwbHktcGF0Y2gudHNdKC4vcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjL2NvZGV4L2FwcGx5LXBhdGNoLnRzI0wyNTMtTDI4NilcbiAqIChwcmV2aW91c2x5IENvZGV4LW9ubHkpIGludG8gYSBzaGFyZWQgcG9zdC1lZGl0IHByaW1pdGl2ZSBib3RoIGhhcm5lc3NlcyB1c2U6XG4gKiBzcGxpdCBgd3JpdHRlbmAgYW5kIGBvbkRpc2tDb250ZW50YCBpbnRvIGxpbmVzIGFuZCBsb2NhdGUgdGhlIHdyaXR0ZW4gYmxvY2sgYXNcbiAqIGEgY29udGlndW91cyBydW4gaW5zaWRlIHRoZSBvbi1kaXNrIGxpbmVzLlxuICpcbiAqIC0gQSBzaW5nbGUgY29udGlndW91cyBtYXRjaCB5aWVsZHMgaXRzIDEtYmFzZWQgaW5jbHVzaXZlIHtAbGluayBMaW5lUmFuZ2V9LlxuICogLSBXaGVuIHRoZSBibG9jayBpcyBhYnNlbnQsIG9yIGFwcGVhcnMgbW9yZSB0aGFuIG9uY2UgKGNvbnRleHQgdG8gZGlzYW1iaWd1YXRlXG4gKiAgIGlzIG5vdCBhdmFpbGFibGUgcG9zdC1lZGl0KSwgcmVjb3ZlcnkgaXMgYW1iaWd1b3VzIGFuZCB0aGUgcmVzdWx0IGRlZ3JhZGVzXG4gKiAgIHRvIGAnd2hvbGUtZmlsZSdgICh0aGUgc2FtZSBmYWxsYmFjayBgbG9jYXRlQ2h1bmsoKWAgc2lnbmFscyB3aXRoIGBudWxsYCkuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhbiB1bmxvY2F0YWJsZSB3cml0ZSBpcyBhIGAnd2hvbGUtZmlsZSdgIGFuc3dlciwgbm90IGFuIGVycm9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3ZlclJhbmdlKHdyaXR0ZW46IHN0cmluZywgb25EaXNrQ29udGVudDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgY29uc3QgbmVlZGxlID0gdG9OZWVkbGVMaW5lcyh3cml0dGVuKTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG5cbiAgY29uc3QgaGF5c3RhY2sgPSBvbkRpc2tDb250ZW50LnNwbGl0KCdcXG4nKTtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGNvbnN0IHN0YXJ0czogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbGFzdDsgaSsrKSB7XG4gICAgbGV0IG9rID0gdHJ1ZTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IG5lZWRsZS5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGhheXN0YWNrW2kgKyBqXSAhPT0gbmVlZGxlW2pdKSB7XG4gICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob2spIHtcbiAgICAgIHN0YXJ0cy5wdXNoKGkpO1xuICAgICAgaWYgKHN0YXJ0cy5sZW5ndGggPiAxKSBicmVhazsgLy8gZHVwbGljYXRlZCBcdTIxOTIgYW1iaWd1b3VzLCBzdG9wIGVhcmx5XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4geyBzdGFydDogc3RhcnRzWzBdICsgMSwgZW5kOiBzdGFydHNbMF0gKyBuZWVkbGUubGVuZ3RoIH07XG4gIH1cbiAgcmV0dXJuICd3aG9sZS1maWxlJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBpbnB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogV2hpY2ggaGFybmVzcyBldmVudCBmaXJlZCwgYXMgdGhlIHRvdWNoIGNvcmUgc2VlcyBpdC4gVGhlIGNvcmUgYnJhbmNoZXMgb25cbiAqIHRoaXM6IGB3cml0ZWAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlIGFuZCBtYXkgc3VyZmFjZSBhXG4gKiBtZXJnZWQgYmxvY2s7IGByZWFkYCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlIGFuZCBmaWx0ZXJzIHBvc2l0aW9uYWwgc3RhdHVzZXNcbiAqIG91dCBvZiB3aGF0IGl0IHN1cmZhY2VzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEV2ZW50S2luZCA9ICdyZWFkJyB8ICd3cml0ZSc7XG5cbi8qKiBGaWVsZHMgc2hhcmVkIGJ5IGV2ZXJ5IHRvdWNoLCByZWdhcmRsZXNzIG9mIGtpbmQuICovXG5pbnRlcmZhY2UgVG91Y2hJbnB1dEJhc2Uge1xuICAvKiogSGFybmVzcyBzZXNzaW9uIGlkIFx1MjAxNCBrZXlzIHRoZSBwZXItc2Vzc2lvbiBjYWRlbmNlIHtAbGluayBNZW1vU3RvcmV9LiAqL1xuICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFdvcmtpbmcgZGlyZWN0b3J5IHRoZSB0b29sIHJhbiBpbiwgdXNlZCB0byBib3VuZCB0aGUgdG91Y2ggdG8gdGhlIENXRCByZXBvXG4gICAqIHZpYSBgcmVzb2x2ZVRvdWNoU2NvcGUoKWAgYmVmb3JlIGFueSBzcGFuIGludm9jYXRpb24uXG4gICAqL1xuICBjd2Q6IHN0cmluZztcbiAgLyoqIEFic29sdXRlLCBjYW5vbmljYWxpemVkIHBhdGggb2YgdGhlIHRvdWNoZWQgZmlsZS4gKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbn1cblxuLyoqIEEgcmVhZCB0b3VjaCAoQ2xhdWRlIGBSZWFkYCwgb3IgYSByZWFkLXNoYXBlZCBDb2RleCBldmVudCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoUmVhZElucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAncmVhZCc7XG4gIC8qKlxuICAgKiAxLWJhc2VkIHN0YXJ0aW5nIGxpbmUgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBvZmZzZXRgXG4gICAqIGlucHV0LiBgdW5kZWZpbmVkYCB3aGVuIHRoZSByZWFkIGhhZCBubyBgb2Zmc2V0YCAocmVhZHMgZnJvbSBsaW5lIDEpLlxuICAgKi9cbiAgb2Zmc2V0PzogbnVtYmVyO1xuICAvKipcbiAgICogTGluZSBjb3VudCBvZiB0aGUgcmVhZCwgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgYGxpbWl0YCBpbnB1dC5cbiAgICogYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYGxpbWl0YCBcdTIwMTQgc2VlIHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9XG4gICAqIGZvciBob3cgdGhlIHJhbmdlIGlzIGNvbXB1dGVkIGluIHRoYXQgY2FzZS5cbiAgICovXG4gIGxpbWl0PzogbnVtYmVyO1xufVxuXG4vKiogQSB3cml0ZSB0b3VjaCAoQ2xhdWRlIGBFZGl0YC9gV3JpdGVgLCBDb2RleCBgYXBwbHlfcGF0Y2hgLCBvciBhIHRyYW5zbGF0ZWQgQmFzaCB3cml0ZSBzcGFuKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hXcml0ZUlucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAnd3JpdGUnO1xuICAvKipcbiAgICogVGhlIGNvbnRlbnQganVzdCB3cml0dGVuIHRvIGBmaWxlUGF0aGAsIGZlZCB0byB7QGxpbmsgcmVjb3ZlclJhbmdlfSB0b1xuICAgKiByZS1hbmNob3IgdGhlIHRvdWNoZWQgcmVnaW9uIGFnYWluc3QgdGhlIGhlYWxlZCBvbi1kaXNrIGZpbGUuIEZvciBhXG4gICAqIHdob2xlLWZpbGUgY3JlYXRlIHRoaXMgaXMgdGhlIGVudGlyZSBmaWxlIGJvZHk7IGFuIGVtcHR5IHN0cmluZyBtZWFuc1xuICAgKiBcIm5vIGxvY2F0YWJsZSBibG9ja1wiIGFuZCB0aGUgdG91Y2ggaXMgc2NvcGVkIGZpbGUtd2lkZS5cbiAgICovXG4gIHdyaXR0ZW46IHN0cmluZztcbiAgLyoqXG4gICAqIEV4YWN0IHBvc3QtZWRpdCByYW5nZSB3aGVuIHN0YXRpY2FsbHkga25vd24gKHNlZCAtaSBudW1lcmljIGFkZHJlc3NlcyxcbiAgICogcGF0Y2ggaHVuayB1bmlvbnMpOyBieXBhc3NlcyB7QGxpbmsgcmVjb3ZlclJhbmdlRnJvbURpc2t9IChwbGFuIFx1MDBBNzNcbiAgICogc3RlcCAzKS5cbiAgICovXG4gIHJhbmdlPzogTGluZVJhbmdlO1xuICAvKipcbiAgICogVGhlIGZpbGUncyBleHBlY3RlZCBwb3N0LWNvbW1hbmQgc3RhdGU7IHRoZSB3cml0ZSBwYXRoIGdhdGVzIG9uIGl0IGJlZm9yZVxuICAgKiBpbnZva2luZyBhbnkgZXhlY3V0b3IgKHBsYW4gXHUwMEE3MyBzdGVwIDEpLiBBYnNlbnQgbWVhbnMgYCdleGlzdHMnYCBcdTIwMTQgdGhlXG4gICAqIEVkaXQvV3JpdGUgYW5kIGFwcGx5X3BhdGNoIHBhdGhzJyBkZWZhdWx0LlxuICAgKi9cbiAgdGFyZ2V0U3RhdGU/OiAnZXhpc3RzJyB8ICdhYnNlbnQnO1xuICAvKipcbiAgICogU3RhdGljYWxseSBrbm93YWJsZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQsIHZlcmlmaWVkIGJlZm9yZSBhbnkgZXhlY3V0b3JcbiAgICogY2FsbCAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBgY29udGVudGAgY29tcGFyZXMgdGhlIG9uLWRpc2sgc3RhdGUgYWZ0ZXIgdGhlXG4gICAqIGNvbW1hbmQgcmFuOyBgcmVhbERlbGV0ZWAgaXMgZGVsZXRlLW9ubHkgXHUyMDE0IHRoZSBwYXRoIG11c3QgYWxzbyBiZVxuICAgKiBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQgKHByb2JlcyBjYWNoZWQgcGVyIGNvbW1hbmQpLlxuICAgKi9cbiAgcG9zdFN0YXRlPzoge1xuICAgIC8qKiBgZXhhY3RgOiBmaWxlIGJ5dGVzIGVxdWFsOyBgc3VmZml4YDogZmlsZSBjb250ZW50IGVuZHMgd2l0aCBpdDsgYGVtcHR5YDogemVybyBieXRlczsgYHNpemVgOiBieXRlIGNvdW50LiAqL1xuICAgIGNvbnRlbnQ/OiBUb3VjaFBvc3RDb250ZW50O1xuICAgIC8qKiBkZWxldGUtb25seTogdGhlIHBhdGggbXVzdCBhbHNvIGJlIGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCAocHJvYmVzIGNhY2hlZCBwZXIgY29tbWFuZCkuICovXG4gICAgcmVhbERlbGV0ZT86IGJvb2xlYW47XG4gIH07XG4gIC8qKlxuICAgKiBjcC9pbnN0YWxsIGRlc3RpbmF0aW9uLXZzLXNvdXJjZSB2ZXJpZmljYXRpb24gKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogYVxuICAgKiBzdGlsbC1wcmVzZW50IHNvdXJjZSBtdXN0IGJ5dGUtZXF1YWwgdGhlIGRlc3RpbmF0aW9uOyBhbiBhYnNlbnQgc291cmNlXG4gICAqIGFwcGxpZXMgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocmVhbCArIGFic2VuY2UgZXhwbGFpbmVkIGJ5IGEgbGF0ZXJcbiAgICogc2FtZS1wYXRoIGRlY2lzaXZlUGFzcyBcdTIwMTQgdGhlIGRyaXZlcidzIHBhc3MtQSBob2xkKS4gU2V0IGJ5IHRoZVxuICAgKiBgcnVuQmFzaFRvdWNoZXNgIGRyaXZlciBvbiBwYWlyZWQgY3AgY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaGVzOyBuZXZlciBzZXRcbiAgICogYnkgYWRhcHRlcnMuIGBpbnN0YWxsIC1zYC9gLS1zdHJpcGAgaXMgZGVsaWJlcmF0ZWx5IG5ldmVyIHBhaXJlZCBcdTIwMTRcbiAgICogc3RyaXBwZWQgb3V0cHV0IG5ldmVyIGVxdWFscyB0aGUgc291cmNlLCBzbyBpbnN0YWxsIGRlc3RzIGdhdGVcbiAgICogZXhpc3RlbmNlLW9ubHkuXG4gICAqL1xuICBzb3VyY2VQYXRoPzogc3RyaW5nO1xuICAvKipcbiAgICogbXYvZ2l0IG12L3BhdGNoIHJlbmFtZSBzb3VyY2UgdmVyaWZpY2F0aW9uIChwbGFuIFx1MDBBNzMgc3RlcCAxYyk6IHRoZVxuICAgKiBkZXN0aW5hdGlvbiBmaXJlcyBvbmx5IHdoZW4gaXRzIHNvdXJjZSBwYXNzZWQgdGhlIGRlbGV0ZS1yZWFsaXR5IHByb2JlIFx1MjAxNFxuICAgKiBhIHBoYW50b20gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCBhbmQgYSBwcmUtZXhpc3RpbmcgZGVzdGluYXRpb24gd2FzXG4gICAqIG5ldmVyIHRvdWNoZWQuIE5vIGNvbnRlbnQgY29tcGFyaXNvbiAocGF0Y2ggcmVuYW1lcyBtYXkgY2hhbmdlIGNvbnRlbnQpLlxuICAgKiBTZXQgYnkgdGhlIGBydW5CYXNoVG91Y2hlc2AgZHJpdmVyIG9uIHBhaXJlZCByZW5hbWUtY29weSB0b3VjaGVzLlxuICAgKi9cbiAgcmVuYW1lU291cmNlUGF0aD86IHN0cmluZztcbn1cblxuLyoqIFRoZSBoYXJuZXNzLWFnbm9zdGljIHRvdWNoIHRoZSBjb3JlIGNvbnN1bWVzLiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hJbnB1dCA9IFRvdWNoUmVhZElucHV0IHwgVG91Y2hXcml0ZUlucHV0O1xuXG4vKipcbiAqIEEgc3RhdGljYWxseSBrbm93YWJsZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogYGV4YWN0YCBcdTIwMTRcbiAqIGZpbGUgYnl0ZXMgZXF1YWw7IGBzdWZmaXhgIFx1MjAxNCBmaWxlIGNvbnRlbnQgZW5kcyB3aXRoIGl0OyBgZW1wdHlgIFx1MjAxNCB6ZXJvXG4gKiBieXRlczsgYHNpemVgIFx1MjAxNCBieXRlIGNvdW50LlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFBvc3RDb250ZW50ID0geyBleGFjdDogc3RyaW5nIH0gfCB7IHN1ZmZpeDogc3RyaW5nIH0gfCB7IGVtcHR5OiB0cnVlIH0gfCB7IHNpemU6IG51bWJlciB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvc3Qtc3RhdGUgd3JpdGUgZ2F0ZSAocGxhbiBcdTAwQTczIHN0ZXAgMSlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBvdXRjb21lIG9mIHtAbGluayBldmFsdWF0ZVdyaXRlR2F0ZX06IGEgZGVjaXNpdmUgcGFzcy9mYWlsIGNhcnJpZXNcbiAqIHZlcmRpY3Qgd2VpZ2h0IChjb250ZW50IHZlcmlmaWVkLCBvciBhYnNlbmNlICsgZGVsZXRlLXJlYWxpdHkgdmVyaWZpZWQpO1xuICogYCdpbmNvbmNsdXNpdmUnYCBpcyBldmVyeXRoaW5nIGVsc2UgXHUyMDE0IHRoZSBleGlzdGVuY2UtZ2F0ZWQgZmFtaWxpZXMgKHNlZCAtaSxcbiAqIHBhdGNoL2dpdCBhcHBseSwgZm9ybWF0dGVycywgcmVzdG9yZS9jaGVja291dCkgd2hvc2UgZXhpc3RlbmNlIHBhc3MgcHJvdmVzXG4gKiBub3RoaW5nLCBhbmQgcHJvYmUtaW5hcHBsaWNhYmxlIGNhc2VzIChwaGFudG9tIG9yIHVudHJhY2tlZC11bnNwYW5uZWRcbiAqIGRlbGV0ZXMsIGRpcmVjdG9yeSB0YXJnZXRzKS4gYCdwZW5kaW5nJ2AgaXMgdGhlIGRyaXZlcidzIGFic2VudC1zb3VyY2UgaG9sZFxuICogKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBhbiBhYnNlbnQgY3Agc291cmNlIHRoYXQgcGFzc2VkIHRoZSByZWFsaXR5IHByb2JlIGNhbm5vdFxuICogZGVjaWRlIGl0cyBkZXN0aW5hdGlvbiB1bnRpbCB0aGUgcGFzcy1BIGV4cGxhbmF0aW9uIG1hcCBpcyBjb21wbGV0ZS5cbiAqL1xuZXhwb3J0IHR5cGUgV3JpdGVHYXRlT3V0Y29tZSA9ICdkZWNpc2l2ZVBhc3MnIHwgJ2RlY2lzaXZlRmFpbCcgfCAnaW5jb25jbHVzaXZlJyB8ICdwZW5kaW5nJztcblxuLyoqXG4gKiBQZXItY29tbWFuZCByZWFsaXR5IHByb2JlIGNhY2hlIChwbGFuIFx1MDBBNzMgc3RlcCAxYywgcm91bmQtMyk6IHR3byBsYXp5LFxuICogYmF0Y2hlZCBwcm9iZXMgXHUyMDE0IG9uZSBgZ2l0IGxzLWZpbGVzIC0tZXJyb3ItdW5tYXRjaGAgKyBgZ2l0IHNwYW4gbGlzdFxuICogLS1wb3JjZWxhaW5gIHBhaXIgZm9yIHRoZSBkZWxldGUtcmVhbGl0eSBtZW1iZXJzaGlwLCBhbmQgb25lIGBnaXQgc3RhdHVzXG4gKiAtLXBvcmNlbGFpbmAgYmF0Y2ggZm9yIHRoZSB3b3JraW5nLXRyZWUtdnMtaW5kZXggbWFyayBcdTIwMTQgbmV2ZXIgb25lXG4gKiBzdWJwcm9jZXNzIHBlciBwYXRoLCBtZW1iZXJzaGlwIGZyb20gcHJpbnRlZCByb3dzLiBUaGUgYHJ1bkJhc2hUb3VjaGVzYFxuICogZHJpdmVyIHNlZWRzIHRoZSBkZWxldGUtcmVhbGl0eSBoYWxmIHdpdGggZXZlcnkgYWJzZW50IHRhcmdldCBhbmRcbiAqIGNwL2luc3RhbGwgc291cmNlIG9mIHRoZSBjb21wb3VuZCBhbmQgdGhlIHN0YXR1cyBoYWxmIHdpdGggdGhlXG4gKiBsYXRlci1yZWNyZWF0ZSBleHBsYW5hdGlvbidzIGNhbmRpZGF0ZSBwYXRocywgYW5kIHNoYXJlcyB0aGUgY2FjaGUgaW50b1xuICogcGFzcyBCIHNvIHN1cnZpdmluZyBkZWxldGVzIHJlLWdhdGUgd2l0aG91dCByZS1wcm9iaW5nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlYWxpdHlQcm9iZUNhY2hlIHtcbiAgLyoqIERpc3RpbmN0IGFic29sdXRlIHBhdGhzIHRvIHByb2JlLCBpbiBmaXJzdC1zZWVuIG9yZGVyLiAqL1xuICBwYXRoczogc3RyaW5nW107XG4gIC8qKiBMYXp5OiBhYnNvbHV0ZSBwYXRocyBjb25maXJtZWQgaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkLCBjb21wdXRlZCBvbmNlLiAqL1xuICByZWFsUGF0aHM6IFNldDxzdHJpbmc+IHwgbnVsbDtcbiAgLyoqXG4gICAqIFRoZSBsYXRlci1yZWNyZWF0ZSBleHBsYW5hdGlvbidzIHByb2JlIHNjb3BlIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogZGlzdGluY3RcbiAgICogZGVsZXRlIHBhdGhzIGEgbGF0ZXIgY29tbWFuZCBvZiB0aGUgY29tcG91bmQgY2FuIHJlLWNyZWF0ZSB3aXRoIGFcbiAgICogZmlsZS1wcm9kdWNpbmcgd3JpdGUsIGluIGZpcnN0LXNlZW4gb3JkZXIuXG4gICAqL1xuICBjaGFuZ2VkQ2FuZGlkYXRlczogc3RyaW5nW107XG4gIC8qKiBMYXp5OiBjYW5kaWRhdGVzIGNhcnJ5aW5nIGFueSB0cmFja2VkIHN0YXR1cyByb3cgKGluZGV4IG9yIHdvcmt0cmVlIGNvbHVtbiksIGNvbXB1dGVkIG9uY2UuICovXG4gIGNoYW5nZWRQYXRoczogU2V0PHN0cmluZz4gfCBudWxsO1xufVxuXG4vKiogQ3JlYXRlIGEgcGVyLWNvbW1hbmQgcHJvYmUgY2FjaGUgZm9yIHRoZSBnaXZlbiBhYnNvbHV0ZSBwYXRocy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShcbiAgcGF0aHM6IEl0ZXJhYmxlPHN0cmluZz4sXG4gIGNoYW5nZWRDYW5kaWRhdGVzOiBJdGVyYWJsZTxzdHJpbmc+ID0gW11cbik6IFJlYWxpdHlQcm9iZUNhY2hlIHtcbiAgcmV0dXJuIHtcbiAgICBwYXRoczogWy4uLm5ldyBTZXQocGF0aHMpXSxcbiAgICByZWFsUGF0aHM6IG51bGwsXG4gICAgY2hhbmdlZENhbmRpZGF0ZXM6IFsuLi5uZXcgU2V0KGNoYW5nZWRDYW5kaWRhdGVzKV0sXG4gICAgY2hhbmdlZFBhdGhzOiBudWxsXG4gIH07XG59XG5cbi8qKiBXaGV0aGVyIHRoZSBwYXRoIGV4aXN0cyBvbiBkaXNrIChhbnkgbm9kZSBraW5kKTsgYGZhbHNlYCBvbiBhbnkgc3RhdCBmYWlsdXJlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbGVFeGlzdHMoYWJzUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZnMuc3RhdFN5bmMoYWJzUGF0aCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKiogV2hldGhlciB0aGUgcGF0aCBpcyBhIHJlZ3VsYXIgZmlsZSBcdTIwMTQgYSBkaXJlY3RvcnkgdGFyZ2V0IGZhaWxzIHRoZSBgJ2V4aXN0cydgIGdhdGUuICovXG5mdW5jdGlvbiBpc0ZpbGVPbkRpc2soYWJzUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGZzLnN0YXRTeW5jKGFic1BhdGgpLmlzRmlsZSgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBWZXJpZnkgYSBzdGF0aWNhbGx5IGtub3dhYmxlIHBvc3QtY29udGVudCBleHBlY3RhdGlvbiBhZ2FpbnN0IHRoZSBvbi1kaXNrXG4gKiBmaWxlIChwbGFuIFx1MDBBNzMgc3RlcCAxYikuIEFueSByZWFkIGZhaWx1cmUgaXMgYSBtaXNtYXRjaCwgbmV2ZXIgYW4gZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIGNvbnRlbnRNYXRjaGVzKHBvc3Q6IFRvdWNoUG9zdENvbnRlbnQsIGZpbGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBpZiAoJ2V4YWN0JyBpbiBwb3N0KSByZXR1cm4gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpID09PSBwb3N0LmV4YWN0O1xuICAgIGlmICgnc3VmZml4JyBpbiBwb3N0KSB7XG4gICAgICAvLyBUaGUgc2hlbGwgYXBwZW5kcyB0aGUgYm9keSBwbHVzIGl0cyB0ZXJtaW5hdGluZyBuZXdsaW5lOyB0aGUgaGVyZWRvY1xuICAgICAgLy8gZ3JhbW1hciBzdHJpcHMgZXhhY3RseSB0aGF0IG9uZSBgXFxuYCBmcm9tIGBzcGFuLndyaXR0ZW5gXG4gICAgICAvLyAocGFyc2UtY29tbWFuZC50cyBoZXJlZG9jIGJvZHkgZXh0cmFjdGlvbiksIHNvIGEgZmlsZSBlbmRpbmdcbiAgICAgIC8vIGB3cml0dGVuXFxuYCBpcyB0aGUgc2FtZSBhcHBlbmRlZCB0ZXh0IGFzIGB3cml0dGVuYCBcdTIwMTQgYWNjZXB0IGJvdGguXG4gICAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpO1xuICAgICAgcmV0dXJuIGNvbnRlbnQuZW5kc1dpdGgocG9zdC5zdWZmaXgpIHx8IGNvbnRlbnQuZW5kc1dpdGgoYCR7cG9zdC5zdWZmaXh9XFxuYCk7XG4gICAgfVxuICAgIGlmICgnZW1wdHknIGluIHBvc3QpIHJldHVybiBmcy5zdGF0U3luYyhmaWxlUGF0aCkuc2l6ZSA9PT0gMDtcbiAgICByZXR1cm4gZnMuc3RhdFN5bmMoZmlsZVBhdGgpLnNpemUgPT09IHBvc3Quc2l6ZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGRlbGV0ZS1yZWFsaXR5IHByb2JlIChwbGFuIFx1MDBBNzMgc3RlcCAxYyk6IGxhemlseSBydW4gdGhlIHR3byBwZXItY29tbWFuZFxuICogYmF0Y2hlcyBhbmQgY2FjaGUgdGhlIGNvbmZpcm1lZC1yZWFsIHBhdGggc2V0LiBNZW1iZXJzaGlwIGNvbWVzIGZyb20gdGhlXG4gKiBwcmludGVkIHJvd3MsIG5vdCB0aGUgZXhpdCBjb2RlIFx1MjAxNCBgZ2l0IGxzLWZpbGVzIC0tZXJyb3ItdW5tYXRjaGAgcHJpbnRzXG4gKiBldmVyeSB0cmFja2VkIHBhdGggZXZlbiB3aGVuIGl0IGV4aXRzIG5vbnplcm8gKGFueSBtaXNzaW5nIHBhdGgpLCBhbmRcbiAqIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluYCBwcmludHMgbm90aGluZyBmb3IgcGhhbnRvbSBvciBrbm93bi1idXQtXG4gKiB1bnNwYW5uZWQgcGF0aHMgKGV4aXQgMCB3aXRoIFwiTm8gc3BhbnMgbWF0Y2ggdGhlIGZpbHRlcnNcIikuIEEgcGxhaW4tYHJtYCdkXG4gKiB0cmFja2VkIGZpbGUga2VlcHMgaXRzIGluZGV4IGVudHJ5IChscy1maWxlcyBleGl0IDAgXHUyMDE0IHRoZSBwcm9iZSBmaXJlcyk7XG4gKiBgZ2l0IHJtYCByZW1vdmVzIGl0IChscy1maWxlcyAxMjgpIHNvIG9ubHkgc3Bhbm5lZCBmaWxlcyBzdGF5IHJlYWwuIEFcbiAqIHBoYW50b20gb3IgdW50cmFja2VkLXVuc3Bhbm5lZCBwYXRoIGZhaWxzIGJvdGggcHJvYmVzIFx1MjAxNCB0aGUgZGVsZXRlIGRlZ3JhZGVzXG4gKiB0byBgJ2luY29uY2x1c2l2ZSdgIGFuZCBuZXZlciBmaXJlcy4gRmFpbC1zYWZlOiBhbiB1bnJlc29sdmFibGUgcmVwbyBvciBhXG4gKiBwcm9iZSBmYWlsdXJlIHlpZWxkcyBhbiBlbXB0eSBzZXQsIG5ldmVyIGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiByZWFsUGF0aHMoY2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlLCBjd2Q6IHN0cmluZyk6IFNldDxzdHJpbmc+IHtcbiAgaWYgKGNhY2hlLnJlYWxQYXRocyAhPT0gbnVsbCkgcmV0dXJuIGNhY2hlLnJlYWxQYXRocztcbiAgY29uc3QgcmVhbCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBpZiAoY2FjaGUucGF0aHMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgaWYgKHJlcG9Sb290ICE9PSBudWxsKSB7XG4gICAgICBjb25zdCByZWxzID0gY2FjaGUucGF0aHMubWFwKChwKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgcCkpO1xuICAgICAgY29uc3QgY2FwdHVyZSA9IChhcmdzOiBzdHJpbmdbXSk6IHN0cmluZyB8IG51bGwgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgICAgdGltZW91dDogREVGQVVMVF9USU1FT1VUX01TXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIGNvbnN0IHN0ZG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICAgIHJldHVybiB0eXBlb2Ygc3Rkb3V0ID09PSAnc3RyaW5nJyA/IHN0ZG91dCA6IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBjb25zdCBsc0ZpbGVzID0gY2FwdHVyZShbJ2xzLWZpbGVzJywgJy0tZXJyb3ItdW5tYXRjaCcsICctLScsIC4uLnJlbHNdKTtcbiAgICAgIGlmIChsc0ZpbGVzICE9PSBudWxsKSB7XG4gICAgICAgIGZvciAoY29uc3QgbGluZSBvZiBsc0ZpbGVzLnNwbGl0KCdcXG4nKSkge1xuICAgICAgICAgIGNvbnN0IHJlbCA9IGxpbmUudHJpbSgpO1xuICAgICAgICAgIGlmIChyZWwubGVuZ3RoID4gMCkgcmVhbC5hZGQoam9pbihyZXBvUm9vdCwgcmVsKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnN0IHNwYW5MaXN0ID0gY2FwdHVyZShbJ3NwYW4nLCAnbGlzdCcsICctLXBvcmNlbGFpbicsIC4uLnJlbHNdKTtcbiAgICAgIGlmIChzcGFuTGlzdCAhPT0gbnVsbCkge1xuICAgICAgICBmb3IgKGNvbnN0IHJvdyBvZiBwYXJzZVBvcmNlbGFpbihzcGFuTGlzdCkpIHJlYWwuYWRkKGpvaW4ocmVwb1Jvb3QsIHJvdy5wYXRoKSk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGNhY2hlLnJlYWxQYXRocyA9IHJlYWw7XG4gIHJldHVybiByZWFsO1xufVxuXG4vKipcbiAqIFRoZSB3b3JraW5nLXRyZWUtdnMtaW5kZXggcHJvYmUgKHBsYW4gXHUwMEE3MyBzdGVwIDIsIHJvdW5kLTM7IHdpZGVuZWQgcm91bmQtNCk6XG4gKiBsYXppbHkgcnVuIG9uZSBgZ2l0IHN0YXR1cyAtLXBvcmNlbGFpbiAtemAgYmF0Y2ggb3ZlciB0aGUgc2VlZGVkIGNhbmRpZGF0ZXNcbiAqIGFuZCBjYWNoZSB0aGUgc2V0IGNhcnJ5aW5nIGFueSB0cmFja2VkIHN0YXR1cyByb3cgXHUyMDE0IHRoZSByZS1jcmVhdGUncyBtYXJrLlxuICogVGhlIGRyaXZlciBjb25zdWx0cyBpdCBiZWZvcmUgZXhwbGFpbmluZyBhIGRlbGV0ZSdzIGRlY2lzaXZlRmFpbCAoXCJmaWxlXG4gKiBwcmVzZW50LCBzbyB0aGUgZGVsZXRlIGRpZG4ndCBoYXBwZW5cIikgYnkgYSBsYXRlciBzYW1lLXBhdGggd3JpdGU7IGFcbiAqIGRlY2lzaXZlRmFpbCBpbXBsaWVzIHRoZSBwYXRoIEVYSVNUUyBhdCBjb21wb3VuZCBlbmQsIHNvIGV2ZXJ5IHJvdyBzaGFwZVxuICogYmVsb3cgaXMganVkZ2VkIGFnYWluc3QgdGhhdCByZWFsaXR5LlxuICpcbiAqIFJvdW5kLTMgcmVhZCBvbmx5IHRoZSBZICh3b3JrdHJlZSkgY29sdW1uLCB0cmVhdGluZyBcIndvcmtpbmcgdHJlZSA9PVxuICogaW5kZXhcIiBhcyBwcm9vZiB0aGUgcmUtY3JlYXRlIHdyaXRlIG5ldmVyIHJhbi4gVGhhdCBwcm9iZSBzdGF0ZSBpcyBzaGFyZWRcbiAqIGJ5IHR3byByZWFsaXRpZXMgdGhlIHJ1bGUgY29uZmxhdGVkOiAoYSkgdGhlIHdyaXRlIGdlbnVpbmVseSBuZXZlciByYW4gXHUyMDE0XG4gKiBhIGZhaWxlZCBybSBzaG9ydC1jaXJjdWl0cyB0aGUgYCYmYCBjaGFpbiwgdGhlIGZpbGUgc3RpbGwgbWF0Y2hlcyBIRUFEIGFuZFxuICogdGhlIGluZGV4LCBhbmQgTk8gcm93IGV4aXN0cyBcdTIwMTQgYW5kIChiKSB0aGUgd3JpdGUgcmFuIEFORCB3YXMgc3RhZ2VkIGluIHRoZVxuICogc2FtZSBjb21wb3VuZCAoYHJtIGYgJiYgcGF0Y2ggPCBkICYmIGdpdCBhZGQgZmAgXHUyMTkyIGBNIGAgcm93LCBibGFuayBZKTogdGhlXG4gKiByb3VuZC00IGZpbmRpbmcsIGEgdmVyaWZpZWQgd3JpdGUgbGVmdCBzaWxlbnQuIFRoZSBydWxlIG5vdyBtYXJrcyBBTllcbiAqIHRyYWNrZWQgc3RhdHVzIHJvdzogdGhlIFggKGluZGV4KSBjb2x1bW4gb3IgdGhlIFkgKHdvcmt0cmVlKSBjb2x1bW5cbiAqIG5vbi1ibGFuay4gYC0tdW50cmFja2VkLWZpbGVzPW5vYCBzdXBwcmVzc2VzIGA/PyBgIHJvd3MsIGFuZCBgP2AvYCFgIGFyZVxuICogcmVqZWN0ZWQgZGVmZW5zaXZlbHkgXHUyMDE0IGFuIHVudHJhY2tlZCBvciBpZ25vcmVkIHBhdGggY2FycmllcyBubyBpbmRleFxuICogYmFzZWxpbmUsIHNvIGl0IGNhbiBuZXZlciBjb3VudCBhcyByZS1jcmVhdGVkIChmYWlsIGNsb3NlZCkuXG4gKlxuICogUGVyLWNvbHVtbiByZWFzb25pbmcgYWdhaW5zdCB0aGUgZGVsZXRlLXNwYW4gcmVhbGl0eSAodGhlIHBhdGggaXMgdHJhY2tlZFxuICogaW4gdGhlIGluZGV4IHBlciB0aGUgZGVsZXRlLXJlYWxpdHkgcHJvYmUsIGFuZCBleGlzdHMgYXQgY29tcG91bmQgZW5kKTpcbiAqIC0gYE0gYCAvIGBBIGAgKGluZGV4IGRpZmZlcnMgZnJvbSBIRUFELCB3b3JrdHJlZSBtYXRjaGVzIHRoZSBpbmRleCk6IHRoZVxuICogICBjb21wb3VuZCBzdGFnZWQgYSB3cml0ZSAoYGdpdCBhZGRgOyBgQSBgIHdoZW4gdGhlIHBhdGgncyBiYXNlbGluZSB3YXNcbiAqICAgaXRzZWxmIGEgc3RhZ2VkIGFkZCwgc28gbmV2ZXIgaW4gSEVBRCkgXHUyMDE0IGNhc2UgKGIpLCB0aGUgcmUtY3JlYXRlIGlzXG4gKiAgIHZlcmlmaWVkIHJlYWwgaW4gdGhlIGluZGV4LlxuICogLSBgUiBgIChhIHN0YWdlZCByZW5hbWUgd2hvc2UgZGVzdGluYXRpb24gaXMgdGhlIHBhdGgpOiBzYW1lIFx1MjAxNCB0aGUgaW5kZXhcbiAqICAgcmVjb3JkcyB0aGUgd3JpdGUuXG4gKiAtIGBEIGAgKGluZGV4IGRlbGV0ZWQsIHdvcmt0cmVlIG1hdGNoZXMpOiB0aGUgZmlsZSBpcyBlaXRoZXIgYWJzZW50XG4gKiAgIChtYXRjaGluZyB0aGUgc3RhZ2VkIGRlbGV0ZSBcdTIwMTQgbm8gZGVjaXNpdmVGYWlsLCB0aGUgYXhpcyBpcyBuZXZlclxuICogICBjb25zdWx0ZWQpIG9yIHJlY3JlYXRlZC1idXQtdW50cmFja2VkIGFmdGVyIGEgYGdpdCBybWAgKGhpZGRlbiBieVxuICogICBgLS11bnRyYWNrZWQtZmlsZXM9bm9gLCB0aGUgcm93IHBlcnNpc3RzKSBcdTIwMTQgYSBwcmVzZW50IGZpbGUgbWVhbnMgdGhlXG4gKiAgIGNvbXBvdW5kIHdyb3RlIGl0LCBzbyBpdCBjb3VudHMuXG4gKiAtIFktY29sdW1uIHJvd3MgKGAgTWAsIGBNTWAsIGAgRGAsIGBBTWAuLi4pOiB0aGUgcm91bmQtMyBydWxlIHVuY2hhbmdlZCBcdTIwMTRcbiAqICAgdGhlIHdvcmt0cmVlIGRlbW9uc3RyYWJseSBkaWZmZXJzIGZyb20gdGhlIGluZGV4LlxuICpcbiAqIENhc2UgKGEpIHN0aWxsIHlpZWxkcyBOTyByb3cgKHRoZSBmaWxlIG1hdGNoZXMgSEVBRCBcdTIwMTQgdGhlIGNoYWluXG4gKiBzaG9ydC1jaXJjdWl0ZWQgYmVmb3JlIGFueXRoaW5nIGNoYW5nZWQpLCBzbyB0aGUgZ2VudWluZSBzdXBwcmVzc2lvbiBob2xkcy5cbiAqIFRoZSBvbmUgcmVzaWR1YWwgY2xhc3MgKGRvY3VtZW50ZWQgaW4gdGhlIGF4aXMncyBjYWxsIHNpdGUpOiBhIFBSRS1FWElTVElOR1xuICogdW5jb21taXR0ZWQgb3Igc3RhZ2VkIGNoYW5nZSBvbiB0aGUgZGVsZXRlZCBwYXRoIG1hc2tzIHRoZSBkaXNjcmltaW5hdG9yIFx1MjAxNFxuICogdGhlIHN0YXR1cyByb3cgcHJlZGF0ZXMgdGhlIGNvbXBvdW5kLCBzbyBhIGZhaWxlZCBybSBsZXRzIHRoZSBqb2luZWQgd3JpdGVcbiAqIGZpcmUgYWR2aXNvcnkuIFRoZSBzdGFnZWQgZmFjZSBpcyB0aGUgd2lkZW5pbmcncyBvbmUgY29zdDogcm91bmQtMydzXG4gKiBibGFuay1ZIHJ1bGUga2VwdCBgTSBgL2BBIGAgcm93cyBpbnZpc2libGUsIHNvIG9ubHkgdGhlIHdvcmt0cmVlLWRpcnR5XG4gKiBtYXNrIGZpcmVkOyB0aGUgaW5kZXggY29sdW1uIG5vdyBtYXJrcyBib3RoLiBJdCBvbmx5IG1hbmlmZXN0cyB3aGVyZVxuICogZ2VudWluZSBkcmlmdCBleGlzdHMgYWdhaW5zdCB0aGUgc3BhbiBiYXNlbGluZSwgYW5kIGEgaGFybmVzcy1zdXBwbGllZFxuICogbm9uLXplcm8gZXhpdCBjb2RlIHN0aWxsIHN1cHByZXNzZXMgdGhlIGFkdmlzb3J5IGNsYXNzIGluIHBhc3MgQiBcdTIwMTQgdGhlXG4gKiBzYW1lIGJvdW5kZWQgaGFybSBhcyB0aGUgcGxhbidzIGRvY3VtZW50ZWQgXCJjb2luY2lkZW50YWxseSBwYXNzZXNcIiBqb2luXG4gKiBjb3JuZXIuIGAtemAgcHJpbnRzIHJhdywgTlVMLXNlcGFyYXRlZCBgWFkgPHBhdGg+YCBlbnRyaWVzIHNvIHNwYWNlLSBhbmRcbiAqIHF1b3RlLWJlYXJpbmcgcGF0aHMgcGFyc2UgdW5hbWJpZ3VvdXNseS4gRmFpbC1zYWZlOiBhbiB1bnJlc29sdmFibGUgcmVwb1xuICogb3IgYSBwcm9iZSBmYWlsdXJlIHlpZWxkcyBhbiBlbXB0eSBzZXQsIG5ldmVyIGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiBjaGFuZ2VkT25EaXNrKGNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSwgY3dkOiBzdHJpbmcpOiBTZXQ8c3RyaW5nPiB7XG4gIGlmIChjYWNoZS5jaGFuZ2VkUGF0aHMgIT09IG51bGwpIHJldHVybiBjYWNoZS5jaGFuZ2VkUGF0aHM7XG4gIGNvbnN0IGNoYW5nZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgaWYgKGNhY2hlLmNoYW5nZWRDYW5kaWRhdGVzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgIGlmIChyZXBvUm9vdCAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgcmVscyA9IGNhY2hlLmNoYW5nZWRDYW5kaWRhdGVzLm1hcCgocCkgPT4gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIHApKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzdGF0dXMnLCAnLS1wb3JjZWxhaW4nLCAnLXonLCAnLS11bnRyYWNrZWQtZmlsZXM9bm8nLCAnLS0nLCAuLi5yZWxzXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogREVGQVVMVF9USU1FT1VUX01TXG4gICAgICAgIH0pO1xuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG91dC5zcGxpdCgnXFwwJykpIHtcbiAgICAgICAgICBpZiAoZW50cnkubGVuZ3RoIDwgNCkgY29udGludWU7IC8vIHNraXAgdGhlIHRyYWlsaW5nIGVtcHR5IGVudHJ5IGFuZCByZW5hbWUtcGFpciBwYXRoIHJvd3NcbiAgICAgICAgICBjb25zdCBpbmRleFN0YXR1cyA9IGVudHJ5LmNoYXJBdCgwKTtcbiAgICAgICAgICBjb25zdCB3b3JrdHJlZVN0YXR1cyA9IGVudHJ5LmNoYXJBdCgxKTtcbiAgICAgICAgICBpZiAoaW5kZXhTdGF0dXMgPT09ICcgJyAmJiB3b3JrdHJlZVN0YXR1cyA9PT0gJyAnKSBjb250aW51ZTsgLy8gbm8gdHJhY2tlZCBkaWZmZXJlbmNlIFx1MjE5MiBubyBtYXJrXG4gICAgICAgICAgaWYgKGluZGV4U3RhdHVzID09PSAnPycgfHwgaW5kZXhTdGF0dXMgPT09ICchJyB8fCB3b3JrdHJlZVN0YXR1cyA9PT0gJz8nIHx8IHdvcmt0cmVlU3RhdHVzID09PSAnIScpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlOyAvLyB1bnRyYWNrZWQgb3IgaWdub3JlZCBcdTIxOTIgbm8gaW5kZXggYmFzZWxpbmUgKGZhaWwgY2xvc2VkKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjaGFuZ2VkLmFkZChqb2luKHJlcG9Sb290LCBlbnRyeS5zbGljZSgzKSkpO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgdm9pZCBlcnI7IC8vIHByb2JlIGZhaWx1cmUgXHUyMTkyIGVtcHR5IHNldCAoZmFpbC1zYWZlLCBuZXZlciBhbiBlcnJvcilcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgY2FjaGUuY2hhbmdlZFBhdGhzID0gY2hhbmdlZDtcbiAgcmV0dXJuIGNoYW5nZWQ7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgcGF0aCBjYXJyaWVzIGEgdHJhY2tlZCBzdGF0dXMgcm93IFx1MjAxNCBpdHMgaW5kZXggY29udGVudCwgaXRzXG4gKiB3b3JraW5nLXRyZWUgY29udGVudCwgb3IgYm90aCBkaWZmZXIgZnJvbSB0aGUgY29tbWl0dGVkL2luZGV4IGJhc2VsaW5lXG4gKiAoc2VlIHRoZSBwcm9iZSdzIHBlci1jb2x1bW4gcmVhc29uaW5nKSBcdTIwMTQgdGhlIGxhdGVyLXJlY3JlYXRlIGV4cGxhbmF0aW9uJ3NcbiAqIG1hcmsuIGBmYWxzZWAgb24gYW55IHByb2JlIGZhaWx1cmUgb3IgZm9yIGFueSBwYXRoIG91dHNpZGUgdGhlIHNlZWRlZFxuICogY2FuZGlkYXRlcyAoZmFpbCBjbG9zZWQpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd29ya2luZ1RyZWVDaGFuZ2VkKHByb2JlQ2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlLCBjd2Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBjaGFuZ2VkT25EaXNrKHByb2JlQ2FjaGUsIGN3ZCkuaGFzKGFic1BhdGgpO1xufVxuXG4vKipcbiAqIFRoZSBsYXllcmVkIHBvc3Qtc3RhdGUgZ2F0ZSAocGxhbiBcdTAwQTczIHN0ZXAgMSksIGV2YWx1YXRlZCBiZWZvcmUgYW55IGV4ZWN1dG9yXG4gKiBjYWxsLCBzaWRlLWVmZmVjdC1mcmVlIChubyBtZW1vIHdyaXRlcywgbm8gZXhlY3V0b3IgY2FsbHM7IHRoZSBwcm9iZSBpc1xuICogcmVhZC1vbmx5IGFuZCBwZXItY29tbWFuZCBjYWNoZWQpOlxuICpcbiAqIDEuIGB0YXJnZXRTdGF0ZTogJ2Fic2VudCdgIFx1MjE5MiB0aGUgcGF0aCBtdXN0IGJlIGFic2VudDsgd2hlbiBpdCBpcywgdGhlXG4gKiAgICBkZWxldGUtcmVhbGl0eSBwcm9iZSBkZWNpZGVzOiBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQgXHUyMTkyIGBkZWNpc2l2ZVBhc3NgXG4gKiAgICAoZGFuZ2xpbmcgYW5jaG9ycyBzdXJmYWNlKSwgcGhhbnRvbSBcdTIxOTIgYCdpbmNvbmNsdXNpdmUnYCAobm90aGluZyB0b1xuICogICAgc3VyZmFjZSBcdTIwMTQgdGhlIG1pc3MgaXMgaGFybWxlc3MsIGFuZCB0aGUgZGVsZXRlIG5ldmVyIGZpcmVzKS5cbiAqIDIuIGB0YXJnZXRTdGF0ZTogJ2V4aXN0cydgIFx1MjE5MiB0aGUgdGFyZ2V0IG11c3QgYmUgYSByZWd1bGFyIGZpbGUgKGEgZGlyZWN0b3J5XG4gKiAgICBvciBtaXNzaW5nIHRhcmdldCBmYWlscykuXG4gKiAzLiBDb250ZW50IHZlcmlmaWNhdGlvbiB3aGVyZSB0aGUgZXhwZWN0ZWQgcG9zdC1jb250ZW50IGlzIHN0YXRpY2FsbHlcbiAqICAgIGtub3dhYmxlIChgZXhhY3RgL2BzdWZmaXhgL2BlbXB0eWAvYHNpemVgKTogYSBtaXNtYXRjaCBtZWFucyB0aGUgd3JpdGUnc1xuICogICAgZWZmZWN0IGlzIGFic2VudCBcdTIwMTQgbm8gdG91Y2guXG4gKiA0LiBjcCBkZXN0aW5hdGlvbi12cy1zb3VyY2U6IGEgc3RpbGwtcHJlc2VudCBzb3VyY2UgbXVzdCBieXRlLWVxdWFsIHRoZVxuICogICAgZGVzdGluYXRpb247IGFuIGFic2VudCBzb3VyY2UgYXBwbGllcyB0aGUgYWJzZW50LXNvdXJjZSBydWxlIChwYXNzZWQgdGhlXG4gKiAgICByZWFsaXR5IHByb2JlIEFORCBpdHMgYWJzZW5jZSBleHBsYWluZWQgYnkgYSBsYXRlciBzYW1lLXBhdGhcbiAqICAgIGBkZWNpc2l2ZVBhc3NgIFx1MjAxNCB0aGUgZHJpdmVyIHJlc29sdmVzIHRoZSBgJ3BlbmRpbmcnYCBob2xkKS5cbiAqIDUuIHJlbmFtZS1jb3B5OiB0aGUgZGVzdGluYXRpb24gZmlyZXMgb25seSB3aGVuIGl0cyBzb3VyY2UgcGFzc2VkIHRoZVxuICogICAgZGVsZXRlLXJlYWxpdHkgcHJvYmUgKGEgcGhhbnRvbSBzb3VyY2UgbWVhbnMgdGhlIG1vdmUgZmFpbGVkKS5cbiAqXG4gKiBFdmVyeXRoaW5nIGVsc2UgXHUyMDE0IHRoZSBleGlzdGVuY2UtZ2F0ZWQgZmFtaWxpZXMgd2hvc2UgZXhpc3RlbmNlIHBhc3MgcHJvdmVzXG4gKiBub3RoaW5nIFx1MjAxNCBpcyBgJ2luY29uY2x1c2l2ZSdgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXZhbHVhdGVXcml0ZUdhdGUoaW5wdXQ6IFRvdWNoV3JpdGVJbnB1dCwgcHJvYmVDYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUpOiBXcml0ZUdhdGVPdXRjb21lIHtcbiAgaWYgKGlucHV0LnRhcmdldFN0YXRlID09PSAnYWJzZW50Jykge1xuICAgIGlmIChmaWxlRXhpc3RzKGlucHV0LmZpbGVQYXRoKSkgcmV0dXJuICdkZWNpc2l2ZUZhaWwnO1xuICAgIHJldHVybiByZWFsUGF0aHMocHJvYmVDYWNoZSwgaW5wdXQuY3dkKS5oYXMoaW5wdXQuZmlsZVBhdGgpID8gJ2RlY2lzaXZlUGFzcycgOiAnaW5jb25jbHVzaXZlJztcbiAgfVxuXG4gIGlmICghaXNGaWxlT25EaXNrKGlucHV0LmZpbGVQYXRoKSkgcmV0dXJuICdkZWNpc2l2ZUZhaWwnO1xuXG4gIGNvbnN0IGNvbnRlbnQgPSBpbnB1dC5wb3N0U3RhdGU/LmNvbnRlbnQ7XG4gIGlmIChjb250ZW50ICE9PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gY29udGVudE1hdGNoZXMoY29udGVudCwgaW5wdXQuZmlsZVBhdGgpID8gJ2RlY2lzaXZlUGFzcycgOiAnZGVjaXNpdmVGYWlsJztcbiAgfVxuXG4gIGlmIChpbnB1dC5zb3VyY2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoZmlsZUV4aXN0cyhpbnB1dC5zb3VyY2VQYXRoKSkge1xuICAgICAgbGV0IHNyYzogc3RyaW5nO1xuICAgICAgbGV0IGRzdDogc3RyaW5nO1xuICAgICAgdHJ5IHtcbiAgICAgICAgc3JjID0gZnMucmVhZEZpbGVTeW5jKGlucHV0LnNvdXJjZVBhdGgsICd1dGY4Jyk7XG4gICAgICAgIGRzdCA9IGZzLnJlYWRGaWxlU3luYyhpbnB1dC5maWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gJ2RlY2lzaXZlRmFpbCc7XG4gICAgICB9XG4gICAgICByZXR1cm4gc3JjID09PSBkc3QgPyAnZGVjaXNpdmVQYXNzJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICAgIH1cbiAgICAvLyBBYnNlbnQgc291cmNlIFx1MjAxNCB0aGUgYWJzZW50LXNvdXJjZSBydWxlIChwbGFuIFx1MDBBNzMgc3RlcCAxYik6IHRoZSBkZXN0XG4gICAgLy8gZmlyZXMgb25seSB3aGVuIHRoZSBzb3VyY2UgcGFzc2VkIHRoZSByZWFsaXR5IHByb2JlIChpdCB3YXMgYSByZWFsXG4gICAgLy8gZmlsZSkgQU5EIGl0cyBhYnNlbmNlIGlzIGV4cGxhaW5lZCBieSBhIGxhdGVyIHNhbWUtcGF0aCBkZWNpc2l2ZVBhc3MuXG4gICAgcmV0dXJuIHJlYWxQYXRocyhwcm9iZUNhY2hlLCBpbnB1dC5jd2QpLmhhcyhpbnB1dC5zb3VyY2VQYXRoKSA/ICdwZW5kaW5nJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICB9XG5cbiAgaWYgKGlucHV0LnJlbmFtZVNvdXJjZVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgIC8vIE5vIGNvbnRlbnQgY29tcGFyaXNvbiBcdTIwMTQgcGF0Y2ggcmVuYW1lcyBtYXkgY2hhbmdlIGNvbnRlbnQ7IGEgcGhhbnRvbVxuICAgIC8vIHNvdXJjZSBtZWFucyB0aGUgbW92ZSBmYWlsZWQgYW5kIGEgcHJlLWV4aXN0aW5nIGRlc3RpbmF0aW9uIHdhcyBuZXZlclxuICAgIC8vIHRvdWNoZWQgKHBsYW4gXHUwMEE3MyBzdGVwIDFjKS5cbiAgICByZXR1cm4gcmVhbFBhdGhzKHByb2JlQ2FjaGUsIGlucHV0LmN3ZCkuaGFzKGlucHV0LnJlbmFtZVNvdXJjZVBhdGgpID8gJ2RlY2lzaXZlUGFzcycgOiAnZGVjaXNpdmVGYWlsJztcbiAgfVxuXG4gIHJldHVybiAnaW5jb25jbHVzaXZlJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbmplY3RlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3RydWN0dXJlZCByZXN1bHQgb2YgYSBzY29wZWQgYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGAuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoRml4UmVzdWx0IHtcbiAgLyoqXG4gICAqIFdoZXRoZXIgYC0tZml4YCByZS1hbmNob3JlZCBhdCBsZWFzdCBvbmUgc3BhbiBpbiB0aGUgd29ya2luZyB0cmVlLiBEcml2ZXNcbiAgICoge0BsaW5rIFRvdWNoT3V0cHV0LnRyZWVNb2RpZmllZH0gc28gYSBjYWxsZXIvdGVzdCBjYW4gYXNzZXJ0IHRoZSBoZWFsaW5nXG4gICAqIGhhcHBlbmVkIHdpdGhvdXQgZGlmZmluZyB0aGUgdHJlZSBpdHNlbGYuXG4gICAqL1xuICBtb2RpZmllZDogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGAgc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgKHdyaXRlIHBhdGhcbiAqIG9ubHkpLCByZXBvcnRpbmcgd2hldGhlciB0aGUgd29ya2luZyB0cmVlIHdhcyBoZWFsZWQuIEFzeW5jIHNvIHRoZSBldmVudHVhbFxuICogaW1wbGVtZW50YXRpb24gYW5kIGl0cyB0ZXN0cyBjYW4gaW5qZWN0IGEgZmFrZSB3aXRob3V0IGEgcmVhbCBzdWJwcm9jZXNzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEZpeEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFRvdWNoRml4UmVzdWx0PjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gPGZpbGU+YCBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlclxuICogYW5jaG9yIGNvdmVyaW5nIHRoZSBmaWxlLiBTdHJ1Y3R1cmVkIChub3QgcmF3IHN0ZG91dCkgc28gdGhlIG1lcmdlZC1ibG9ja1xuICogY29tcHV0YXRpb24gYW5kIGl0cyB0ZXN0cyBzaGFyZSB0aGUgc2FtZSBzaGFwZS5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hMaXN0RXhlY3V0b3IgPSAoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8UG9yY2VsYWluUm93W10+O1xuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluIDxhcmdzPmAgKHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlIG9yXG4gKiBpdHMgc3BhbnMpIGFuZCByZXR1cm4gaXRzIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyIGRyaWZ0ZWQgYW5jaG9yLCBlbXB0eSB3aGVuXG4gKiBjbGVhbi4gU3RhdHVzIGNsYXNzaWZpY2F0aW9uIGlzIHZpYSBgaXNEZWJ0KClgOyBwb3NpdGlvbmFsIChgTU9WRURgLFxuICogYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCkgcm93cyBhcmUgbmV2ZXIgZGVidC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hEcmlmdEV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxEcmlmdFBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYmFyZSBgZ2l0IHNwYW4gd2h5IDxuYW1lPmAgYW5kIHJldHVybiB0aGUgc3BhbidzIHJlY29yZGVkIHdoeSBzZW50ZW5jZSxcbiAqIG9yIGBudWxsYCB3aGVuIG5vbmUgaXMgcmVjb3JkZWQgb3IgdGhlIHJlYWQgZmFpbHMuIEZlZWRzIHRoZSBodW1hbi1mb3JtYXRcbiAqIHNwYW4gcmVuZGVyOyBpbnZva2VkIG9ubHkgZm9yIHNwYW5zIGFjdHVhbGx5IGJlaW5nIHN1cmZhY2VkIHRoaXMgdG91Y2guXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoV2h5RXhlY3V0b3IgPSAobmFtZTogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxzdHJpbmcgfCBudWxsPjtcblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZXhlY3V0aW9uIHN1cmZhY2UuIEtlcHQgYXMgZm91ciBuYXJyb3cgYXN5bmMgZnVuY3Rpb25zIChyYXRoZXJcbiAqIHRoYW4gYSByYXcgY29tbWFuZCBydW5uZXIpIHNvIHRlc3RzIGluamVjdCBmYWtlcyByZXR1cm5pbmcgc3RydWN0dXJlZCBkYXRhXG4gKiBhbmQgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIGEgc3VicHJvY2VzcyBpdHNlbGYuIFRoZSBgcmVhZGAgcGF0aCBuZXZlciBpbnZva2VzXG4gKiBgZml4YC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEV4ZWN1dG9ycyB7XG4gIGZpeDogVG91Y2hGaXhFeGVjdXRvcjtcbiAgbGlzdDogVG91Y2hMaXN0RXhlY3V0b3I7XG4gIGRyaWZ0OiBUb3VjaERyaWZ0RXhlY3V0b3I7XG4gIHdoeTogVG91Y2hXaHlFeGVjdXRvcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBvdXRwdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hhdCB0aGUgY29yZSBoYW5kcyBiYWNrIGZvciB0aGUgYWRhcHRlciB0byB0cmFuc2xhdGUgaW50byBTREsgb3V0cHV0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaE91dHB1dCB7XG4gIC8qKlxuICAgKiBUaGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayAoaGVhZGVyLCBvbmUgaHVtYW4tZm9ybWF0IHNlY3Rpb24gcGVyXG4gICAqIHN1cmZhY2VkIHNwYW4sIGZvb3RlcikgdG8gaW5qZWN0IHZpYSB0aGUgaGFybmVzcydzIGBhZGRpdGlvbmFsQ29udGV4dGAsXG4gICAqIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzIG5vdGhpbmcgd29ydGggc3VyZmFjaW5nIHRoaXMgdG91Y2guXG4gICAqL1xuICBhZGRpdGlvbmFsQ29udGV4dDogc3RyaW5nIHwgbnVsbDtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgbW9kaWZpZWQgYnkgYSBzY29wZWQgYC0tZml4YCBvbiB0aGUgd3JpdGUgcGF0aC5cbiAgICogQWx3YXlzIGBmYWxzZWAgb24gdGhlIHJlYWQgcGF0aCAocmVhZHMgbmV2ZXIgbXV0YXRlIHRoZSB0cmVlKS5cbiAgICovXG4gIHRyZWVNb2RpZmllZDogYm9vbGVhbjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBNZXJnZWQtYmxvY2sgYXNzZW1ibHlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIG1lbW8ga2V5IHVuZGVyIHdoaWNoIGEgc3BhbidzIHJlbmRlciBmb3IgYSBnaXZlbiBkcmlmdCBzdGF0dXMgaXMgZGVkdXBlZC4gKi9cbmZ1bmN0aW9uIGRyaWZ0S2V5KG5hbWU6IHN0cmluZywgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICAvLyBTcGFuIG5hbWVzIGNvbWUgZnJvbSB0YWItZGVsaW1pdGVkIHBvcmNlbGFpbiwgc28gdGhleSBuZXZlciBjb250YWluIGEgdGFiO1xuICAvLyBhIHRhYi1qb2luZWQga2V5IGNhbiBuZXZlciBjb2xsaWRlIHdpdGggYSBiYXJlIHNwYW4gbmFtZSAodGhlIHN1cmZhY2luZyBrZXkpLlxuICByZXR1cm4gYCR7bmFtZX1cXHQke3N0YXR1c31gO1xufVxuXG4vKiogVGhlIGBwYXRoI0xzdGFydC1MZW5kYCAob3IgYmFyZS1wYXRoLCB3aG9sZS1maWxlKSBhbmNob3IgdGV4dCBmb3IgYSByb3cuICovXG5mdW5jdGlvbiBhbmNob3JUZXh0KHJvdzogUG9yY2VsYWluUm93KTogc3RyaW5nIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4gcm93LnBhdGg7XG4gIHJldHVybiBgJHtyb3cucGF0aH0jTCR7cm93LnN0YXJ0fS1MJHtyb3cuZW5kfWA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuSGVhZGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCR7ZmlsZU5hbWV9IGhhcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXM6YDtcbn1cblxuZnVuY3Rpb24gY2xlYW5Gb290ZXIoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgSWYgeW91IGNoYW5nZSAke2ZpbGVOYW1lfSBjaGVjayB0aGUgb3RoZXIgZmlsZXMgdG8gY29uZmlybSB0aGV5IHN0aWxsIHdvcmsgdG9nZXRoZXIuYDtcbn1cblxuLyoqXG4gKiBUaGUgd3JpdGUgcGF0aCBuYW1lcyB0aGUgZWRpdCBhcyB0aGUgY2F1c2U7IHRoZSByZWFkIHBhdGggb25seSBzdXJmYWNlc1xuICogcHJlLWV4aXN0aW5nIGRyaWZ0IGl0IGRpZG4ndCBjcmVhdGUsIHNvIGl0IG5hbWVzIHRoZSBkZXBlbmRlbmN5IGluc3RlYWQuXG4gKi9cbmZ1bmN0aW9uIGRyaWZ0SGVhZGVyKGRyaWZ0ZWRDb3VudDogbnVtYmVyLCBraW5kOiBUb3VjaElucHV0WydraW5kJ10pOiBzdHJpbmcge1xuICBpZiAoa2luZCA9PT0gJ3dyaXRlJykge1xuICAgIHJldHVybiBkcmlmdGVkQ291bnQgPT09IDFcbiAgICAgID8gJ1RoaXMgZWRpdCBwdXQgYW4gaW1wbGljaXQgZGVwZW5kZW5jeSBvdXQgb2YgZGF0ZTonXG4gICAgICA6ICdUaGlzIGVkaXQgcHV0IGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xuICB9XG4gIHJldHVybiBkcmlmdGVkQ291bnQgPT09IDFcbiAgICA/ICdUaGlzIGZpbGUgaGFzIGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgIDogJ1RoaXMgZmlsZSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzIG91dCBvZiBkYXRlOic7XG59XG5cbmZ1bmN0aW9uIGRyaWZ0Rm9vdGVyKGRyaWZ0ZWROYW1lczogc3RyaW5nW10pOiBzdHJpbmcge1xuICBpZiAoZHJpZnRlZE5hbWVzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IG5hbWUgPSBkcmlmdGVkTmFtZXNbMF07XG4gICAgcmV0dXJuIGBSZXN0b3JlIGFncmVlbWVudCBiZWZvcmUgY29tbWl0dGluZy4gRm9sbG93IGNvbmZpcm1lZCBhdXRob3JpdHkuIFByZXNlcnZlIGFuY2hvciBzaGFwZTsgaWYgYW4gYWRkcmVzcyBjaGFuZ2VkLCByZW1vdmUgaXRzIG9sZCBhbmNob3IgYmVmb3JlIGFkZGluZyB0aGUgbmV3IG9uZS4gVXBkYXRlIG9yIHJldGlyZSB0aGUgd2h5IG9ubHkgaWYgaXRzIG1lYW5pbmcgY2hhbmdlZC4gUmVxdWlyZSBcXGBnaXQgc3BhbiBkcmlmdCAke25hbWV9XFxgIHRvIHJlcG9ydCB6ZXJvLCB0aGVuIGNoZWNrIHRoZSBvdGhlciBhbmNob3JzLiBDb25mb3JtIGEgc2lkZSBvbmx5IHdoZW4gY29uZmlybWVkIGF1dGhvcml0eSBvciBhIHNhdGlzZmllZCBnYXRlIGRlY2lkZXMgaXQ7IHJlcG9ydCBhbWJpZ3VpdHkgb3IgYW4gb2Jzb2xldGUgY291cGxpbmcuYDtcbiAgfVxuICByZXR1cm4gJ0ZvciBlYWNoIG91dC1vZi1kYXRlIHNwYW46IHJlc3RvcmUgYWdyZWVtZW50IGJlZm9yZSBjb21taXR0aW5nLiBGb2xsb3cgY29uZmlybWVkIGF1dGhvcml0eS4gUHJlc2VydmUgYW5jaG9yIHNoYXBlOyBpZiBhbiBhZGRyZXNzIGNoYW5nZWQsIHJlbW92ZSBpdHMgb2xkIGFuY2hvciBiZWZvcmUgYWRkaW5nIHRoZSBuZXcgb25lLiBVcGRhdGUgb3IgcmV0aXJlIHRoZSB3aHkgb25seSBpZiBpdHMgbWVhbmluZyBjaGFuZ2VkLiBSZXF1aXJlIGBnaXQgc3BhbiBkcmlmdCA8bmFtZT5gIHRvIHJlcG9ydCB6ZXJvLCB0aGVuIGNoZWNrIHRoZSBvdGhlciBhbmNob3JzLiBDb25mb3JtIGEgc2lkZSBvbmx5IHdoZW4gY29uZmlybWVkIGF1dGhvcml0eSBvciBhIHNhdGlzZmllZCBnYXRlIGRlY2lkZXMgaXQ7IHJlcG9ydCBhbWJpZ3VpdHkgb3IgYW4gb2Jzb2xldGUgY291cGxpbmcuJztcbn1cblxuLyoqIFRoZSB7QGxpbmsgUmFuZ2VMYWJlbH0gZm9yIGEgcG9yY2VsYWluIHJvdyBcdTIwMTQgYDAtMGAgaXMgdGhlIHdob2xlLWZpbGUgYW5jaG9yLiAqL1xuZnVuY3Rpb24gcmFuZ2VMYWJlbChyb3c6IFBvcmNlbGFpblJvdyk6IFJhbmdlTGFiZWwge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiB7IGtpbmQ6ICd3aG9sZS1maWxlJyB9O1xuICByZXR1cm4geyBraW5kOiAncmFuZ2UnLCBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfTtcbn1cblxuLyoqXG4gKiBBIHNwYW4ncyBmdWxsIGFuY2hvciBsaXN0LCByZW5kZXJlZCBhcyBhIHNoYXJlZC1wcmVmaXggdHJlZSBieVxuICoge0BsaW5rIHJlbmRlckFuY2hvclRyZWV9LCB3aXRoIGVhY2ggYW5jaG9yIHRoYXQgY2FycmllcyBnZW51aW5lIGRyaWZ0XG4gKiBzdWZmaXhlZCBieSBpdHMgbG93ZXJjYXNlIHN0YXR1cyB0b2tlbihzKSAoYCBcdTIwMTQgY2hhbmdlZGApLlxuICpcbiAqIEEgZHJpZnQgcm93IG1hdGNoZXMgYW4gYW5jaG9yIGJ5IGV4YWN0IHBhdGgrcmFuZ2UsIG9yIGJ5IHBhdGggYWxvbmUgd2hlbiB0aGVcbiAqIHNwYW4gaGFzIGEgc2luZ2xlIGFuY2hvciBvbiB0aGF0IHBhdGggKHJhbmdlcyBjYW4gZGlzYWdyZWUgYWZ0ZXIgYSBoZWFsKS5cbiAqIGBzb2xlT25QYXRoYCBpcyBkZWxpYmVyYXRlbHkgY29tcHV0ZWQgb3ZlciB0aGUgKipmdWxsIGZsYXQgYW5jaG9yIGxpc3QqKixcbiAqIGJlZm9yZSBhbnkgZ3JvdXBpbmcgXHUyMDE0IHRoZSB0cmVlIGxheW91dCBtdXN0IG5ldmVyIGJlIGFibGUgdG8gY2hhbmdlICp3aGljaCpcbiAqIGFuY2hvcnMgZ2V0IGxhYmVsZWQsIG9ubHkgd2hlcmUgdGhleSBzaXQgb24gdGhlIHBhZ2UuXG4gKi9cbmZ1bmN0aW9uIGFuY2hvckJ1bGxldHMoYW5jaG9yczogUG9yY2VsYWluUm93W10sIGRlYnRSb3dzOiBEcmlmdFBvcmNlbGFpblJvd1tdKTogc3RyaW5nW10ge1xuICBjb25zdCByb3dzID0gYW5jaG9ycy5tYXAoKGFuY2hvcikgPT4ge1xuICAgIGNvbnN0IHNvbGVPblBhdGggPSBhbmNob3JzLmZpbHRlcigoYSkgPT4gYS5wYXRoID09PSBhbmNob3IucGF0aCkubGVuZ3RoID09PSAxO1xuICAgIGNvbnN0IHN0YXR1c2VzID0gbmV3IFNldDxQb3JjZWxhaW5TdGF0dXM+KCk7XG4gICAgZm9yIChjb25zdCByb3cgb2YgZGVidFJvd3MpIHtcbiAgICAgIGlmIChyb3cucGF0aCAhPT0gYW5jaG9yLnBhdGgpIGNvbnRpbnVlO1xuICAgICAgaWYgKHNvbGVPblBhdGggfHwgKHJvdy5zdGFydCA9PT0gYW5jaG9yLnN0YXJ0ICYmIHJvdy5lbmQgPT09IGFuY2hvci5lbmQpKSB7XG4gICAgICAgIHN0YXR1c2VzLmFkZChyb3cuc3RhdHVzKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3Qgc29ydGVkID0gWy4uLnN0YXR1c2VzXS5zb3J0KCk7XG4gICAgY29uc3Qgc3VmZml4ID0gc29ydGVkLmxlbmd0aCA+IDAgPyBgIFx1MjAxNCAke3NvcnRlZC5tYXAoaHVtYW5TdGF0dXNMYWJlbCkuam9pbignLCAnKX1gIDogJyc7XG4gICAgcmV0dXJuIHsgcGF0aDogYW5jaG9yLnBhdGgsIHJhbmdlOiByYW5nZUxhYmVsKGFuY2hvciksIHN1ZmZpeCB9O1xuICB9KTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gcmVuZGVyQW5jaG9yVHJlZShjb2xsYXBzZUJ5UGF0aChyb3dzKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IGRvIG5vdCByZW1vdmUgaXRcbiAgICAvLyBvbiB0aGUgdGhlb3J5IHRoYXQgYSBkZWdyYWRlZCBmYWxsYmFjayBpcyBpdHNlbGYgZm9yYmlkZGVuLiBBbiB1bmNhdWdodFxuICAgIC8vIHRocm93IGhlcmUgZG9lcyBub3QgZGVncmFkZSB0byBhIGZsYXQgbGlzdDogaXQgZXNjYXBlcyB0b1xuICAgIC8vIGBydW5Ub3VjaEhvb2tgJ3MgY2F0Y2gsIHdoaWNoIHJlc29sdmVzIHRoZSB3aG9sZSBob29rIHRvXG4gICAgLy8gYGFkZGl0aW9uYWxDb250ZXh0OiBudWxsYCwgc28gdGhlIGFnZW50IGlzIG5ldmVyIHRvbGQgYWJvdXQgdGhlIGRyaWZ0IGF0XG4gICAgLy8gYWxsLiBDYXRjaGluZyBsb2NhbGx5IG5hcnJvd3Mgd2hhdCBhIHJlbmRlcmluZyBkZWZlY3QgY2FuIGNvc3QgZnJvbSBcInRoZVxuICAgIC8vIHJlbWluZGVyIGRpc2FwcGVhcnNcIiB0byBcInRoZSByZW1pbmRlciBsb29rcyBsaWtlIGl0IGRpZCBiZWZvcmUgdGhlIHRyZWVcIi5cbiAgICAvLyBXaGV0aGVyIHRvIHN1cmZhY2UgYW5kIHdoYXQgc2hhcGUgdG8gc3VyZmFjZSBpbiBhcmUgZGlmZmVyZW50IHRoaW5ncywgYW5kXG4gICAgLy8gdGhpcyBjYXRjaCBvbmx5IGV2ZXIgdG91Y2hlcyB0aGUgbGF0dGVyLlxuICAgIC8vIGByb3dzYCBpcyBpbmRleC1hbGlnbmVkIHdpdGggYGFuY2hvcnNgLCBzbyB0aGlzIHJlcHJvZHVjZXMgdG9kYXkncyBmbGF0XG4gICAgLy8gYnVsbGV0IHJ1biBieXRlIGZvciBieXRlLCBzdWZmaXhlcyBpbmNsdWRlZC5cbiAgICByZXR1cm4gYW5jaG9ycy5tYXAoKGFuY2hvciwgaSkgPT4gYC0gJHthbmNob3JUZXh0KGFuY2hvcil9JHtyb3dzW2ldLnN1ZmZpeH1gKTtcbiAgfVxufVxuXG4vKipcbiAqIE9uZSBodW1hbi1mb3JtYXQgc3BhbiBzZWN0aW9uOiBgIyMgPG5hbWU+YCwgdGhlIGZ1bGwgYW5jaG9yIGxpc3QgKGRyaWZ0ZWRcbiAqIGFuY2hvcnMgc3RhdHVzLXN1ZmZpeGVkKSwgYW5kIHRoZSB3aHkgc2VudGVuY2Ugd2hlbiBvbmUgaXMgcmVjb3JkZWQuXG4gKlxuICogVGhlIG5hbWUgaGVhZGVyIGFuZCB0aGUgd2h5IHNlbnRlbmNlIGFyZSB0aGUgc2FtZSBzaGFwZSBgZ2l0IHNwYW4gbGlzdGBcbiAqIHJlbmRlcnM7IHRoZSBhbmNob3IgbGlzdCBkZWxpYmVyYXRlbHkgaXMgbm90IFx1MjAxNCBpdCByZW5kZXJzIGFzIGEgc2hhcmVkLXByZWZpeFxuICogdHJlZSAoe0BsaW5rIGFuY2hvckJ1bGxldHN9KSB3aGVyZSB0aGUgQ0xJIHByaW50cyBhIGZsYXQgYC0gcGF0aCNMcmFuZ2VgXG4gKiBidWxsZXQgcnVuLiBUaGUgQ0xJJ3Mgb3duIHRleHQgZm9ybWF0IGlzIHVudG91Y2hlZDsgb25seSB0aGlzIGhvb2snc1xuICogcmUtcHJlc2VudGF0aW9uIG9mIGl0IGdyb3Vwcy5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyU3BhblNlY3Rpb24oXG4gIG5hbWU6IHN0cmluZyxcbiAgYW5jaG9yczogUG9yY2VsYWluUm93W10sXG4gIGRlYnRSb3dzOiBEcmlmdFBvcmNlbGFpblJvd1tdLFxuICB3aHk6IHN0cmluZyB8IG51bGxcbik6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gW2AjIyAke25hbWV9YCwgLi4uYW5jaG9yQnVsbGV0cyhhbmNob3JzLCBkZWJ0Um93cyldO1xuICBpZiAod2h5KSBsaW5lcy5wdXNoKCcnLCB3aHkpO1xuICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogQXNzZW1ibGUgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2s6IGhlYWRlciwgb25lIHNlY3Rpb24gcGVyIHN1cmZhY2VkXG4gKiBzcGFuIChzZXBhcmF0ZWQgYnkgYC0tLWApLCBhbmQgYSBzaW5nbGUgZm9vdGVyIGFmdGVyIGEgZmluYWwgYC0tLWAuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkQmxvY2soc2VjdGlvbnM6IHN0cmluZ1tdLCBoZWFkZXI6IHN0cmluZywgZm9vdGVyOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBib2R5ID0gYCR7aGVhZGVyfVxcblxcbiR7c2VjdGlvbnMuam9pbignXFxuXFxuLS0tXFxuXFxuJyl9XFxuXFxuLS0tXFxuXFxuJHtmb290ZXJ9YDtcbiAgcmV0dXJuIGBcXG48Z2l0LXNwYW4+XFxuJHtib2R5fVxcbjwvZ2l0LXNwYW4+XFxuYDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBob29rIGVudHJ5IHBvaW50XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgaW4gc2NvcGUgZm9yIHRoZSByZWNvdmVyZWQgcmFuZ2UuICovXG5mdW5jdGlvbiBpbnRlcnNlY3RzKHJvdzogUG9yY2VsYWluUm93LCByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnKTogYm9vbGVhbiB7XG4gIGlmIChyYW5nZSA9PT0gJ3dob2xlLWZpbGUnKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4gdHJ1ZTsgLy8gd2hvbGUtZmlsZSBhbmNob3JcbiAgcmV0dXJuIHJhbmdlc0ludGVyc2VjdChyYW5nZSwgeyBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfSk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgdG91Y2hlZCByYW5nZSBmcm9tIHRoZSBvbi1kaXNrIGZpbGUgZm9yIGEgd3JpdGUuIEFuIGVtcHR5IHdyaXRlIG9yXG4gKiBhbiB1bnJlYWRhYmxlIGZpbGUgKGUuZy4gYSBkZWxldGUsIG9yIHRoZSBmaWxlIHdhcyBuZXZlciB3cml0dGVuKSBkZWdyYWRlcyB0b1xuICogYCd3aG9sZS1maWxlJ2AsIHNjb3BpbmcgdGhlIHRvdWNoIHRvIGV2ZXJ5IGNvdmVyaW5nIHNwYW4gXHUyMDE0IHRoZSBmYWlsLW9wZW5cbiAqIGJlaGF2aW9yLCBub3QgYW4gZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSYW5nZUZyb21EaXNrKHdyaXR0ZW46IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZyk6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgbGV0IGNvbnRlbnQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICB9XG4gIHJldHVybiByZWNvdmVyUmFuZ2Uod3JpdHRlbiwgY29udGVudCk7XG59XG5cbi8qKlxuICogVGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGRvY3VtZW50ZWQgZGVmYXVsdCBsaW5lIGNvdW50IHdoZW4gYG9mZnNldGAgaXNcbiAqIGdpdmVuIHdpdGhvdXQgYGxpbWl0YCAoXCJCeSBkZWZhdWx0LCBpdCByZWFkcyB1cCB0byAyMDAwIGxpbmVzXCIpLiBOYW1lZCBzb1xuICogdGhlIGFzc3VtcHRpb24gaXMgdmlzaWJsZSBhbmQgZWFzeSB0byB1cGRhdGUgaWYgdGhhdCBkZWZhdWx0IGV2ZXIgY2hhbmdlcy5cbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVBRF9MSU1JVCA9IDIwMDA7XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgdG91Y2hlZCByYW5nZSBmb3IgYSByZWFkIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzXG4gKiBgb2Zmc2V0YC9gbGltaXRgIGlucHV0cy4gTmVpdGhlciBwcmVzZW50IG1lYW5zIGEgZ2VudWluZSB3aG9sZS1maWxlIHJlYWQgXHUyMDE0XG4gKiBldmVyeSBjb3ZlcmluZyBzcGFuIHN0YXlzIGluIHNjb3BlLCBtYXRjaGluZyB0b2RheSdzIGJlaGF2aW9yLiBPdGhlcndpc2VcbiAqIHRoZSByYW5nZSBzdGFydHMgYXQgYG9mZnNldGAgKGRlZmF1bHQgbGluZSAxKSBhbmQgcnVucyBmb3IgYGxpbWl0YCBsaW5lc1xuICogKGRlZmF1bHQge0BsaW5rIERFRkFVTFRfUkVBRF9MSU1JVH0pLCBjbGFtcGVkIHRvIHRoZSBmaWxlJ3MgYWN0dWFsIGxpbmVcbiAqIGNvdW50IHNvIGEgc2hvcnQgZmlsZSB3aXRoIGEgbGFyZ2UgYG9mZnNldGAvYGxpbWl0YCBkb2Vzbid0IG92ZXJzaG9vdC5cbiAqIENsYW1waW5nIHJlcXVpcmVzIHJlYWRpbmcgdGhlIGZpbGU7IGFuIHVucmVhZGFibGUgZmlsZSBkZWdyYWRlcyB0b1xuICogYCd3aG9sZS1maWxlJ2AgXHUyMDE0IHRoZSBzYW1lIGZhaWwtb3BlbiBiZWhhdmlvciB0aGUgd3JpdGUgcGF0aCB1c2VzLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmVhZFJhbmdlKFxuICBvZmZzZXQ6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgbGltaXQ6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgZmlsZVBhdGg6IHN0cmluZ1xuKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkICYmIGxpbWl0ID09PSB1bmRlZmluZWQpIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGNvbnN0IHN0YXJ0ID0gb2Zmc2V0ID8/IDE7XG4gIGxldCBsaW5lQ291bnQ6IG51bWJlcjtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpO1xuICAgIGxpbmVDb3VudCA9IGNvbnRlbnQubGVuZ3RoID09PSAwID8gMCA6IGNvbnRlbnQuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICBjb25zdCBlbmQgPSBNYXRoLm1pbihzdGFydCArIChsaW1pdCA/PyBERUZBVUxUX1JFQURfTElNSVQpIC0gMSwgTWF0aC5tYXgobGluZUNvdW50LCBzdGFydCkpO1xuICByZXR1cm4geyBzdGFydCwgZW5kIH07XG59XG5cbi8qKlxuICogV2hldGhlciBhIGNvdmVyaW5nIHJvdyBpcyBhbiBhbmNob3IgaW4gdGhlIHRvdWNoZWQgZmlsZSBpdHNlbGYuIGBsaXN0XG4gKiAtLXBvcmNlbGFpbiA8ZmlsZT5gIHJldHVybnMgZXZlcnkgYW5jaG9yIG9mIGVhY2ggbWF0Y2hpbmcgc3BhbiBcdTIwMTQgY3Jvc3MtZmlsZVxuICogYW5jaG9ycyBpbmNsdWRlZCBcdTIwMTQgYnV0IG9ubHkgYW5jaG9ycyBpbiB0aGUgdG91Y2hlZCBmaWxlIHBhcnRpY2lwYXRlIGluIHRoZVxuICogcmFuZ2UtaW50ZXJzZWN0aW9uIHNjb3BlIHRlc3QuIFJvdyBwYXRocyBhcmUgcmVwby1yZWxhdGl2ZTsgdGhlIHRvdWNoZWQgcGF0aFxuICogaXMgYWJzb2x1dGUsIHNvIG1hdGNoIG9uIGFuIGV4YWN0IG9yIGAvYC1zZXBhcmF0ZWQgc3VmZml4LlxuICovXG5mdW5jdGlvbiBvblRvdWNoZWRGaWxlKHJvdzogUG9yY2VsYWluUm93LCBmaWxlUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBmaWxlUGF0aCA9PT0gcm93LnBhdGggfHwgZmlsZVBhdGguZW5kc1dpdGgoYC8ke3Jvdy5wYXRofWApO1xufVxuXG4vKipcbiAqIENvbXB1dGUgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgZm9yIHRoZSB0b3VjaCwgb3IgYG51bGxgIHdoZW4gdGhlcmUgaXNcbiAqIG5vdGhpbmcgd29ydGggc3VyZmFjaW5nLiBTaGFyZWQgYnkgYm90aCBwYXRoczsgdGhlIHdyaXRlIHBhdGggcGFzc2VzIGFcbiAqIHJlY292ZXJlZCByYW5nZSBmb3IgcHJlY2lzaW9uLCB0aGUgcmVhZCBwYXRoIHNjb3BlcyBmaWxlLXdpZGUuXG4gKlxuICogQSBzcGFuIHJlbmRlcnMgYXMgYSBmdWxsIGh1bWFuLWZvcm1hdCBzZWN0aW9uIChuYW1lLCBhbGwgYW5jaG9ycyB3aXRoXG4gKiBkcmlmdGVkIG9uZXMgc3RhdHVzLXN1ZmZpeGVkLCB3aHkpIHdoZW4gaXRzIG5hbWUgaGFzIG5vdCBiZWVuIHN1cmZhY2VkIHRoaXNcbiAqIHNlc3Npb24sIG9yIHdoZW4gaXQgY2FycmllcyBhIGRyaWZ0IHN0YXR1cyBub3QgeWV0IHN1cmZhY2VkIGZvciBpdCBcdTIwMTQgc28gYVxuICogc3BhbiBmaXJzdCBzZWVuIGhlYWx0aHkgcmUtcmVuZGVycyBpbiBmdWxsIHdoZW4gZHJpZnQgbGF0ZXIgYXBwZWFycy4gQSBzcGFuXG4gKiB3aG9zZSBvbmx5IGRyaWZ0IGlzIHBvc2l0aW9uYWwgKGBNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBcdTIwMTQgbmV2ZXJcbiAqIGBpc0RlYnRgKSBpcyBmaWx0ZXJlZCBvdXQgZW50aXJlbHk6IHBvc2l0aW9uYWwgZHJpZnQgbmV2ZXIgc3VyZmFjZXMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNvbXB1dGVTdXJmYWNlKFxuICBpbnB1dDogVG91Y2hJbnB1dCxcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlLFxuICByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnXG4pOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgY29uc3QgY292ZXJpbmcgPSBhd2FpdCBleGVjdXRvcnMubGlzdChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgaWYgKGNvdmVyaW5nLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gR3JvdXAgZXZlcnkgYW5jaG9yIGJ5IHNwYW47IGEgc3BhbiBpcyBpbiBzY29wZSB3aGVuIG9uZSBvZiBpdHMgYW5jaG9ycyBvblxuICAvLyB0aGUgdG91Y2hlZCBmaWxlIGludGVyc2VjdHMgdGhlIHJlY292ZXJlZCByYW5nZS5cbiAgY29uc3QgYW5jaG9yc0J5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2YgY292ZXJpbmcpIHtcbiAgICBjb25zdCByb3dzID0gYW5jaG9yc0J5TmFtZS5nZXQocm93Lm5hbWUpID8/IFtdO1xuICAgIHJvd3MucHVzaChyb3cpO1xuICAgIGFuY2hvcnNCeU5hbWUuc2V0KHJvdy5uYW1lLCByb3dzKTtcbiAgfVxuICBjb25zdCB0b3VjaGVkTmFtZXMgPSBbLi4uYW5jaG9yc0J5TmFtZS5rZXlzKCldLmZpbHRlcigobmFtZSkgPT5cbiAgICAoYW5jaG9yc0J5TmFtZS5nZXQobmFtZSkgPz8gW10pLnNvbWUoKHJvdykgPT4gb25Ub3VjaGVkRmlsZShyb3csIGlucHV0LmZpbGVQYXRoKSAmJiBpbnRlcnNlY3RzKHJvdywgcmFuZ2UpKVxuICApO1xuICBpZiAodG91Y2hlZE5hbWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgZHJpZnRSb3dzID0gYXdhaXQgZXhlY3V0b3JzLmRyaWZ0KFtpbnB1dC5maWxlUGF0aF0sIGlucHV0LmN3ZCk7XG4gIGNvbnN0IGRyaWZ0QnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIERyaWZ0UG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGRyaWZ0Um93cykge1xuICAgIGNvbnN0IHJvd3MgPSBkcmlmdEJ5TmFtZS5nZXQocm93Lm5hbWUpID8/IFtdO1xuICAgIHJvd3MucHVzaChyb3cpO1xuICAgIGRyaWZ0QnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cblxuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoaW5wdXQuc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9SZWNvcmQ6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHNlY3Rpb25zOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBkcmlmdGVkTmFtZXM6IHN0cmluZ1tdID0gW107XG5cbiAgZm9yIChjb25zdCBuYW1lIG9mIHRvdWNoZWROYW1lcykge1xuICAgIGNvbnN0IHNwYW5EcmlmdCA9IGRyaWZ0QnlOYW1lLmdldChuYW1lKSA/PyBbXTtcbiAgICBjb25zdCBkZWJ0Um93cyA9IHNwYW5EcmlmdC5maWx0ZXIoKHJvdykgPT4gaXNEZWJ0KHJvdy5zdGF0dXMpKTtcbiAgICBpZiAoc3BhbkRyaWZ0Lmxlbmd0aCA+IDAgJiYgZGVidFJvd3MubGVuZ3RoID09PSAwKSBjb250aW51ZTsgLy8gcG9zaXRpb25hbC1vbmx5IGRyaWZ0IG5ldmVyIHN1cmZhY2VzXG5cbiAgICBjb25zdCBkZWJ0U3RhdHVzZXMgPSBbLi4ubmV3IFNldChkZWJ0Um93cy5tYXAoKHJvdykgPT4gcm93LnN0YXR1cykpXS5zb3J0KCk7XG4gICAgY29uc3QgdW5zdXJmYWNlZERlYnQgPSBkZWJ0U3RhdHVzZXMuZmlsdGVyKChzdGF0dXMpID0+ICFzdXJmYWNlZC5oYXMoZHJpZnRLZXkobmFtZSwgc3RhdHVzKSkpO1xuICAgIGNvbnN0IGlzTmV3TmFtZSA9ICFzdXJmYWNlZC5oYXMobmFtZSk7XG4gICAgaWYgKCFpc05ld05hbWUgJiYgdW5zdXJmYWNlZERlYnQubGVuZ3RoID09PSAwKSBjb250aW51ZTsgLy8gZnVsbHkgc3VyZmFjZWQgYWxyZWFkeVxuXG4gICAgY29uc3Qgd2h5ID0gYXdhaXQgZXhlY3V0b3JzLndoeShuYW1lLCBpbnB1dC5jd2QpO1xuICAgIHNlY3Rpb25zLnB1c2gocmVuZGVyU3BhblNlY3Rpb24obmFtZSwgYW5jaG9yc0J5TmFtZS5nZXQobmFtZSkgPz8gW10sIGRlYnRSb3dzLCB3aHkpKTtcbiAgICBpZiAoZGVidFN0YXR1c2VzLmxlbmd0aCA+IDApIGRyaWZ0ZWROYW1lcy5wdXNoKG5hbWUpO1xuXG4gICAgaWYgKGlzTmV3TmFtZSkgdG9SZWNvcmQucHVzaChuYW1lKTtcbiAgICBmb3IgKGNvbnN0IHN0YXR1cyBvZiB1bnN1cmZhY2VkRGVidCkgdG9SZWNvcmQucHVzaChkcmlmdEtleShuYW1lLCBzdGF0dXMpKTtcbiAgfVxuXG4gIGlmIChzZWN0aW9ucy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBtZW1vLmFkZFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCwgdG9SZWNvcmQpO1xuICBjb25zdCBmaWxlTmFtZSA9IGJhc2VuYW1lKGlucHV0LmZpbGVQYXRoKTtcbiAgY29uc3QgaGVhZGVyID0gZHJpZnRlZE5hbWVzLmxlbmd0aCA+IDAgPyBkcmlmdEhlYWRlcihkcmlmdGVkTmFtZXMubGVuZ3RoLCBpbnB1dC5raW5kKSA6IGNsZWFuSGVhZGVyKGZpbGVOYW1lKTtcbiAgY29uc3QgZm9vdGVyID0gZHJpZnRlZE5hbWVzLmxlbmd0aCA+IDAgPyBkcmlmdEZvb3RlcihkcmlmdGVkTmFtZXMpIDogY2xlYW5Gb290ZXIoZmlsZU5hbWUpO1xuICByZXR1cm4gYnVpbGRCbG9jayhzZWN0aW9ucywgaGVhZGVyLCBmb290ZXIpO1xufVxuXG4vKipcbiAqIFJ1biB0aGUgdG91Y2ggaG9vayBmb3IgYSBzaW5nbGUgdG9vbCBjYWxsLCBicmFuY2hpbmcgb24ge0BsaW5rIFRvdWNoSW5wdXQua2luZH0uXG4gKlxuICogLSAqKldyaXRlIHBhdGgqKjoge0BsaW5rIGV2YWx1YXRlV3JpdGVHYXRlfSAocGxhbiBcdTAwQTczIHN0ZXAgMSkgcnVucyBmaXJzdCBcdTIwMTRcbiAqICAgYW55IGRlY2lzaXZlIGZhaWwsIG9yIGFuIGluY29uY2x1c2l2ZSBwaGFudG9tIGRlbGV0ZSwgYmxvY2tzIHRoZSB0b3VjaFxuICogICB3aXRoIG5vIGV4ZWN1dG9yIGNhbGwgXHUyMDE0IHRoZW4gYGV4ZWN1dG9ycy5maXhgIChgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+XG4gKiAgIC0tZml4YCkgc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZ1xuICogICB0cmVlLCBhbmQgdGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgaXMgY29tcHV0ZWQgYWdhaW5zdCB0aGUgaGVhbGVkXG4gKiAgIGFuY2hvcnMsIHJlbmRlcmluZyBlYWNoIHN1cmZhY2VkIHNwYW4gYXMgYSBmdWxsIGh1bWFuLWZvcm1hdCBzZWN0aW9uIHdpdGhcbiAqICAgYW55IHJlbWFpbmluZyBzZW1hbnRpYyBkcmlmdCBzdGF0dXMtc3VmZml4ZWQgb24gaXRzIGFuY2hvcnMuIENhZGVuY2UgaXNcbiAqICAgZGVkdXBlZCB0aHJvdWdoIGBtZW1vYCBwZXIgc3BhbiBuYW1lIGFuZCBwZXIgKHNwYW4sIHN0YXR1cykuXG4gKiAtICoqUmVhZCBwYXRoKio6IG5ldmVyIGludm9rZXMgYGZpeGAgYW5kIG5ldmVyIG11dGF0ZXMgdGhlIHRyZWU7IHN1cmZhY2VzIHRoZVxuICogICBzcGFucyBvdmVybGFwcGluZyB0aGUgcmVhZCdzIGBvZmZzZXRgL2BsaW1pdGAgd2luZG93IChzZWVcbiAqICAge0BsaW5rIHJlY292ZXJSZWFkUmFuZ2V9OyBhIHJlYWQgd2l0aCBuZWl0aGVyIGlzIHdob2xlLWZpbGUsIG1hdGNoaW5nXG4gKiAgIHRvZGF5J3MgYmVoYXZpb3IpIHdpdGggcG9zaXRpb25hbCBzdGF0dXNlcyBmaWx0ZXJlZCBvdXQgdmlhIGBpc0RlYnQoKWAuXG4gKlxuICogVGhlIG9wdGlvbmFsIGBwcm9iZUNhY2hlYCBzaGFyZXMgdGhlIGRyaXZlcidzIHBlci1jb21tYW5kIGRlbGV0ZS1yZWFsaXR5XG4gKiBwcm9iZSBpbnRvIHBhc3MgQiAocGxhbiBcdTAwQTczIHN0ZXAgMikgc28gc3Vydml2aW5nIGRlbGV0ZXMgcmUtZ2F0ZSB3aXRob3V0XG4gKiByZS1wcm9iaW5nOyBkaXJlY3QgY2FsbGVycyBnZXQgYSBwZXItY2FsbCBjYWNoZSBzZWVkZWQgd2l0aCB0aGUgdG91Y2hlZFxuICogcGF0aCB3aGVuIHRoZSB0YXJnZXQgaXMgYCdhYnNlbnQnYC5cbiAqXG4gKiBGYWlscyBvcGVuOiBhbnkgZXhlY3V0b3IgcmVqZWN0aW9uIG9yIGludGVybmFsIGVycm9yIHlpZWxkc1xuICogYGFkZGl0aW9uYWxDb250ZXh0OiBudWxsYCAobm8gc2lnbmFsLCBlZGl0aW5nIG5ldmVyIGJsb2NrZWQpIHJhdGhlciB0aGFuXG4gKiB0aHJvd2luZy4gYHRyZWVNb2RpZmllZGAgcmVmbGVjdHMgYSBzdWNjZXNzZnVsIGAtLWZpeGAgZXZlbiB3aGVuIHRoZVxuICogc3Vic2VxdWVudCBzdXJmYWNlIGNvbXB1dGF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVG91Y2hIb29rKFxuICBpbnB1dDogVG91Y2hJbnB1dCxcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlLFxuICBwcm9iZUNhY2hlPzogUmVhbGl0eVByb2JlQ2FjaGVcbik6IFByb21pc2U8VG91Y2hPdXRwdXQ+IHtcbiAgbGV0IHRyZWVNb2RpZmllZCA9IGZhbHNlO1xuICB0cnkge1xuICAgIGxldCByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnID0gJ3dob2xlLWZpbGUnO1xuICAgIGlmIChpbnB1dC5raW5kID09PSAnd3JpdGUnKSB7XG4gICAgICBjb25zdCBwcm9iZSA9IHByb2JlQ2FjaGUgPz8gY3JlYXRlUmVhbGl0eVByb2JlQ2FjaGUoaW5wdXQudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnID8gW2lucHV0LmZpbGVQYXRoXSA6IFtdKTtcbiAgICAgIGNvbnN0IG91dGNvbWUgPSBldmFsdWF0ZVdyaXRlR2F0ZShpbnB1dCwgcHJvYmUpO1xuICAgICAgaWYgKG91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnIHx8IChvdXRjb21lID09PSAnaW5jb25jbHVzaXZlJyAmJiBpbnB1dC50YXJnZXRTdGF0ZSA9PT0gJ2Fic2VudCcpKSB7XG4gICAgICAgIHJldHVybiB7IGFkZGl0aW9uYWxDb250ZXh0OiBudWxsLCB0cmVlTW9kaWZpZWQ6IGZhbHNlIH07XG4gICAgICB9XG4gICAgICBjb25zdCBmaXggPSBhd2FpdCBleGVjdXRvcnMuZml4KGlucHV0LmZpbGVQYXRoLCBpbnB1dC5jd2QpO1xuICAgICAgdHJlZU1vZGlmaWVkID0gZml4Lm1vZGlmaWVkO1xuICAgICAgcmFuZ2UgPSBpbnB1dC5yYW5nZSA/PyByZWNvdmVyUmFuZ2VGcm9tRGlzayhpbnB1dC53cml0dGVuLCBpbnB1dC5maWxlUGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gcmVjb3ZlclJlYWRSYW5nZShpbnB1dC5vZmZzZXQsIGlucHV0LmxpbWl0LCBpbnB1dC5maWxlUGF0aCk7XG4gICAgfVxuICAgIGNvbnN0IGFkZGl0aW9uYWxDb250ZXh0ID0gYXdhaXQgY29tcHV0ZVN1cmZhY2UoaW5wdXQsIGV4ZWN1dG9ycywgbWVtbywgcmFuZ2UpO1xuICAgIHJldHVybiB7IGFkZGl0aW9uYWxDb250ZXh0LCB0cmVlTW9kaWZpZWQgfTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmFpbCBvcGVuOiBuZXZlciBsZXQgYSB0b3VjaC1jb3JlIGVycm9yIHByb3BhZ2F0ZSB1cCBhbmQgYmxvY2sgdGhlIHRvb2xcbiAgICAvLyBjYWxsLiBUaGUgdHJlZSBtYXkgYWxyZWFkeSBoYXZlIGJlZW4gaGVhbGVkICh0cmVlTW9kaWZpZWQgcHJlc2VydmVkKS5cbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dDogbnVsbCwgdHJlZU1vZGlmaWVkIH07XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9yc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDEwXzAwMDtcblxuLyoqIFJlc29sdmUgdGhlIHRvdWNoZWQgZmlsZSB0byBhIHBhdGggcmVsYXRpdmUgdG8gaXRzIHJlcG8gcm9vdCwgZm9yIGBnaXQgc3BhbmAuICovXG5mdW5jdGlvbiByZXBvUmVsQXJnKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKTogeyByZXBvUm9vdDogc3RyaW5nOyByZWxQYXRoOiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICBpZiAoIXJlcG9Sb290KSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgcmVwb1Jvb3QsIHJlbFBhdGg6IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBmaWxlUGF0aCkgfTtcbn1cblxuLyoqXG4gKiBBIHNuYXBzaG90IG9mIHRoZSBzcGFuIHJvb3QncyB3b3JraW5nLXRyZWUgc3RhdHVzLCB1c2VkIHRvIGRldGVjdCB3aGV0aGVyIGFcbiAqIGAtLWZpeGAgcmUtYW5jaG9yZWQgYW55dGhpbmcuIENvbXBhcmVkIGJlZm9yZS9hZnRlcjsgYW4gdW5yZXNvbHZhYmxlIHJlcG8gb3JcbiAqIGEgZmFpbGVkIHN0YXR1cyB5aWVsZHMgYSBzdGFibGUgZW1wdHkgc3RyaW5nIChcdTIxOTIgYG1vZGlmaWVkOiBmYWxzZWApLlxuICovXG5mdW5jdGlvbiBzcGFuU3RhdHVzU25hcHNob3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHNwYW5Sb290ID0gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdzdGF0dXMnLCAnLS1wb3JjZWxhaW4nLCAnLS0nLCBzcGFuUm9vdF0sIHtcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IERFRkFVTFRfVElNRU9VVF9NU1xuICAgIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcHJvZHVjdGlvbiBleGVjdXRpb24gc3VyZmFjZTogdGhyZWUgc3VicHJvY2Vzcy1iYWNrZWQgZXhlY3V0b3JzIGZvbGxvd2luZ1xuICogc3Bhbi1zdXJmYWNlLnRzJ3MgYGNyZWF0ZURlZmF1bHQqRXhlY3V0b3JgIHN0eWxlLiBFYWNoIGNhcHR1cmVzIHN0ZG91dCBldmVuIG9uXG4gKiBhIG5vbi16ZXJvIGV4aXQgd2hlcmUgdGhlIENMSSBzdGlsbCBlbWl0cyB1c2VmdWwgb3V0cHV0LCBhbmQgZXZlcnkgZmFpbHVyZVxuICogbW9kZSAoYWJzZW50IGJpbmFyeSwgdGltZW91dCwgcGFyc2UgZmFpbHVyZSkgc3VyZmFjZXMgYXMgYW4gZW1wdHkvY2xlYW4gcmVzdWx0XG4gKiBzbyB7QGxpbmsgcnVuVG91Y2hIb29rfSdzIGZhaWwtb3BlbiBjb250cmFjdCBob2xkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycyh0aW1lb3V0TXM6IG51bWJlciA9IERFRkFVTFRfVElNRU9VVF9NUyk6IFRvdWNoRXhlY3V0b3JzIHtcbiAgcmV0dXJuIHtcbiAgICBmaXg6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4geyBtb2RpZmllZDogZmFsc2UgfTtcbiAgICAgIGNvbnN0IGJlZm9yZSA9IHNwYW5TdGF0dXNTbmFwc2hvdChyZXNvbHZlZC5yZXBvUm9vdCk7XG4gICAgICB0cnkge1xuICAgICAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsIHJlc29sdmVkLnJlbFBhdGgsICctLWZpeCddLCB7XG4gICAgICAgICAgY3dkOiByZXNvbHZlZC5yZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgdm9pZCBlcnI7IC8vIGBnaXQgc3BhbiBkcmlmdGAgZXhpdHMgMSBvbiBkcmlmdCBldmVuIHdoZW4gYC0tZml4YCBoZWFsZWQgc29tZXRoaW5nLCBhbmRcbiAgICAgICAgLy8gbm9uLXplcm8gb24gZ2VudWluZSBmYWlsdXJlOyB0aGUgc25hcHNob3QgZGlmZiBpcyB0aGUgc291cmNlIG9mXG4gICAgICAgIC8vIHRydXRoIGZvciB3aGV0aGVyIHRoZSB0cmVlIGNoYW5nZWQsIHNvIHRoZSBleGl0IGNvZGUgaXMgaWdub3JlZCBoZXJlLlxuICAgICAgfVxuICAgICAgY29uc3QgYWZ0ZXIgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgcmV0dXJuIHsgbW9kaWZpZWQ6IGJlZm9yZSAhPT0gYWZ0ZXIgfTtcbiAgICB9LFxuXG4gICAgbGlzdDogYXN5bmMgKGZpbGVQYXRoLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVwb1JlbEFyZyhmaWxlUGF0aCwgY3dkKTtcbiAgICAgIGlmICghcmVzb2x2ZWQpIHJldHVybiBbXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCByZXNvbHZlZC5yZWxQYXRoXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcGFyc2VQb3JjZWxhaW4ob3V0KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG4gICAgfSxcblxuICAgIGRyaWZ0OiBhc3luYyAoYXJncywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgY29uc3QgcnVuQ3dkID0gcmVwb1Jvb3QgPz8gY3dkO1xuICAgICAgLy8gVGhlIGNvcmUgcGFzc2VzIGFuIGFic29sdXRlIGZpbGUgcGF0aDsgc2NvcGUgYGdpdCBzcGFuIGRyaWZ0YCB0byBpdFxuICAgICAgLy8gcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCBzbyB0aGUgcGF0aCBpbmRleCByZXNvbHZlcyBpdC5cbiAgICAgIGNvbnN0IHNjb3BlZCA9IHJlcG9Sb290ID8gYXJncy5tYXAoKGEpID0+IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhKSkgOiBhcmdzO1xuICAgICAgbGV0IG91dDogc3RyaW5nO1xuICAgICAgdHJ5IHtcbiAgICAgICAgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCAnLS1mb3JtYXQnLCAncG9yY2VsYWluJywgLi4uc2NvcGVkXSwge1xuICAgICAgICAgIGN3ZDogcnVuQ3dkLFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zdCBjYXB0dXJlZCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICBpZiAodHlwZW9mIGNhcHR1cmVkID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIG91dCA9IGNhcHR1cmVkO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnNlRHJpZnRQb3JjZWxhaW4ob3V0KTtcbiAgICB9LFxuXG4gICAgd2h5OiBhc3luYyAobmFtZSwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnd2h5JywgbmFtZV0sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290ID8/IGN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHRleHQgPSBvdXQudHJpbUVuZCgpO1xuICAgICAgICAvLyBCYXJlIGBnaXQgc3BhbiB3aHlgIHByaW50cyB0aGlzIGV4YWN0IHNlbnRpbmVsIChleGl0IDApIHdoZW4gdGhlXG4gICAgICAgIC8vIHNwYW4gaGFzIG5vIHdoeSByZWNvcmRlZCBcdTIwMTQgdHJlYXQgaXQgYXMgXCJubyB3aHlcIiwgbm90IGFzIGNvbnRlbnQuXG4gICAgICAgIGlmICh0ZXh0Lmxlbmd0aCA9PT0gMCB8fCB0ZXh0ID09PSBgXFxgJHtuYW1lfVxcYCBoYXMgbm8gd2h5IHJlY29yZGVkLmApIHJldHVybiBudWxsO1xuICAgICAgICByZXR1cm4gdGV4dDtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgYm94LWRyYXdpbmcgdHJlZSByZW5kZXJlciBmb3IgYSBzcGFuJ3MgYW5jaG9yIGxpc3QsIHVzZWQgYnkgZXZlcnlcbiAqIGNhbGwgc2l0ZSB0aGF0IHRvZGF5IHByaW50cyBhIGZsYXQgYC0gcGF0aCNMc3RhcnQtTGVuZGAgYnVsbGV0IHJ1blxuICogKGB0b3VjaC1jb3JlLnRzYCdzIGBhbmNob3JCdWxsZXRzYCwgYW5kIGBhZHZpc29yLWNvcmUudHNgJ3NcbiAqIGBhbm5vdGF0ZUJsb2Nrc2AvYGdyb3VwQ292ZXJpbmdCeU5hbWVgKS4gQW5jaG9ycyB0aGF0IHNoYXJlIGEgZGlyZWN0b3J5XG4gKiBwcmVmaXggY29sbGFwc2UgaW50byBvbmUgdHJlZSBpbnN0ZWFkIG9mIGJlaW5nIHJlY29uc3RydWN0ZWQgYnkgZXllIGZyb20gYVxuICogZmxhdCBsaXN0IFx1MjAxNCB0aGUgbW90aXZhdGluZyBjYXNlIGlzIHBhcml0eSBhbmNob3JzIHVuZGVyIHBhcmFsbGVsXG4gKiBgcHVibGljL2NsYXVkZS8uLi5gL2BwdWJsaWMvY29kZXgvLi4uYCB0cmVlcy5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpcyBhIHB1cmUgcHJlc2VudGF0aW9uIHRyYW5zZm9ybTogaXQgbmV2ZXIgY29tcHV0ZXMgZHJpZnRcbiAqIHN0YXR1cyBvciBkZWNpZGVzIHdoaWNoIGFuY2hvcnMgYXJlIHN1cmZhY2VkLiBDYWxsZXJzIHByZWNvbXB1dGUgZWFjaCByb3cnc1xuICogYHN1ZmZpeGAgKGUuZy4gYCBcdTIwMTQgY2hhbmdlZGApIGV4YWN0bHkgYXMgdGhleSBkbyB0b2RheSwgYW5kIG9ubHkgdGhlICpzaGFwZSpcbiAqIG9mIHRoZSBwcmludGVkIGxpc3QgY2hhbmdlcy5cbiAqL1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFB1YmxpYyB0eXBlc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSG93IGEgc2luZ2xlIGFuY2hvcidzIGxpbmUgcmFuZ2UgaXMga25vd24uIGByYW5nZWAgYW5kIGB3aG9sZS1maWxlYCBhcmUgdGhlXG4gKiB0d28gc2hhcGVzIGV2ZXJ5IGFuY2hvciB0YWtlcyB0b2RheTsgYHRydW5jYXRlZGAgaXMgYSBkZWZlbnNpdmUgdGhpcmQgc2hhcGVcbiAqIHJlYWNoYWJsZSBvbmx5IGZyb20gcmUtcGFyc2luZyB0aGUgQ0xJJ3MgZmxhdCBodW1hbi1mb3JtYXQgdGV4dCAoYSBgI0xgXG4gKiBmcmFnbWVudCB0aGF0IGRvZXNuJ3QgY2xlYW5seSBtYXRjaCBgI0xzdGFydC1MZW5kYCkuXG4gKlxuICogVmVyaWZpZWQgaW52YXJpYW50OiB0aGUgc3RydWN0dXJlZC1kYXRhIGNhbGwgc2l0ZXMgY2FuIG5ldmVyIHByb2R1Y2VcbiAqIGB0cnVuY2F0ZWRgLiBgcGFyc2VQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpIGBjb250aW51ZWBzIHBhc3QgYW55XG4gKiByb3cgbWlzc2luZyBhIHZhbGlkIHJhbmdlLCBzbyBhbiBpbmNvbXBsZXRlIGBQb3JjZWxhaW5Sb3dgIGNhbiBuZXZlciBiZVxuICogY29uc3RydWN0ZWQ7IHRoZSBSdXN0IENMSSdzIG93biBwb3JjZWxhaW4gd3JpdGVyIGFsd2F5cyBlbWl0cyBhIHJhbmdlXG4gKiBjb2x1bW4gKGAwLTBgIGZvciB3aG9sZS1maWxlKS4gYHRydW5jYXRlZGAgaXMgcmVhY2hhYmxlIG9ubHkgZnJvbVxuICogYGFubm90YXRlQmxvY2tzYCcgZmxhdC10ZXh0IHBhcnNpbmcgb2YgYGJsb2Nrc1RleHRgIGluIGEgbGF0ZXIgcGhhc2UuXG4gKi9cbmV4cG9ydCB0eXBlIFJhbmdlTGFiZWwgPSB7IGtpbmQ6ICdyYW5nZSc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0gfCB7IGtpbmQ6ICd3aG9sZS1maWxlJyB9IHwgeyBraW5kOiAndHJ1bmNhdGVkJyB9O1xuXG4vKiogT25lIHN0YWNrZWQgcmFuZ2UgdW5kZXIgYSBgVHJlZUFuY2hvcmAsIHdpdGggaXRzIHByZWNvbXB1dGVkIGRyaWZ0IHN1ZmZpeC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmFuZ2VFbnRyeSB7XG4gIHJhbmdlOiBSYW5nZUxhYmVsO1xuICAvKiogUHJlY29tcHV0ZWQgYCBcdTIwMTQgY2hhbmdlZGAgKGV0Yy4pLCBvciBgJydgIHdoZW4gdGhlIGFuY2hvciBjYXJyaWVzIG5vIGRyaWZ0LiAqL1xuICBzdWZmaXg6IHN0cmluZztcbn1cblxuLyoqIE9uZSBkaXN0aW5jdCBwYXRoJ3MgY29sbGFwc2VkIGFuY2hvciBlbnRyeSwgcmVhZHkgZm9yIHRyZWUgbGF5b3V0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBUcmVlQW5jaG9yIHtcbiAgLyoqIFJlcG8tcmVsYXRpdmUsIHBvc2l4LXNlcGFyYXRlZCBwYXRoLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBTdGFja2VkIHJhbmdlcyBvbiB0aGlzIHBhdGguIEVtcHR5IG1lYW5zIFwicGF0aCBvbmx5LCBubyByYW5nZSBjb2x1bW4gYXRcbiAgICogYWxsXCIgXHUyMDE0IGEgYmFyZS1wYXRoIGxlYWYsIGRpc3RpbmN0IGZyb20gYSBzaW5nbGUgYHdob2xlLWZpbGVgIGVudHJ5ICh3aGljaFxuICAgKiByZW5kZXJzIHRoZSBwYXRoIHRvbywgYnV0IGlzIGFuIGV4cGxpY2l0IHJhbmdlLWtpbmQgY2xhc3NpZmljYXRpb24pLlxuICAgKi9cbiAgcmFuZ2VzOiBSYW5nZUVudHJ5W107XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gY29sbGFwc2VCeVBhdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIENvbGxhcHNlIHJvd3MgdGhhdCBuYW1lIHRoZSBzYW1lIHBhdGggaW50byBvbmUgYFRyZWVBbmNob3JgIHdpdGggc3RhY2tlZFxuICogcmFuZ2VzLCBwcmVzZXJ2aW5nIGZpcnN0LXNlZW4gb3JkZXIuIGByZW5kZXJBbmNob3JUcmVlYCdzIGNvbnRyYWN0IHJlcXVpcmVzXG4gKiBhdCBtb3N0IG9uZSBgVHJlZUFuY2hvcmAgcGVyIGRpc3RpbmN0IHBhdGggXHUyMDE0IHRoaXMgaXMgdGhlIG1hbmRhdG9yeVxuICogcHJlLXByb2Nlc3Npbmcgc3RlcCBldmVyeSBjYWxsZXIgcnVucyBmaXJzdCB0byBndWFyYW50ZWUgdGhhdC5cbiAqXG4gKiBNaXJyb3JzIHRoZSBvcmRlci1hcnJheS1wbHVzLU1hcCBpZGlvbSBhbHJlYWR5IHVzZWQgYnlcbiAqIGBkZWR1cGVCeUFuY2hvcigpYCAoYWR2aXNvci1jb3JlLnRzKSBmb3IgdGhlIHNhbWUgcmVhc29uOiB0aGUgQ0xJIGNhbiBlbWl0XG4gKiBtdWx0aXBsZSByb3dzIGZvciBvbmUgbG9naWNhbCBwYXRoLCBhbmQgdGhlICpwb3NpdGlvbiogb2YgYSBsYXRlclxuICogc2FtZS1wYXRoIHJvdyBpcyBzdWJzdW1lZCBpbnRvIHRoYXQgcGF0aCdzIGZpcnN0IG9jY3VycmVuY2UsIG5vdCBhcHBlbmRlZFxuICogYXQgaXRzIG93biBsYXRlciBwb3NpdGlvbi4gQ29uY3JldGVseTogYGEudHMjTDEtTDVgLCBgYi50cyNMMS1MNWAsXG4gKiBgYS50cyNMOS1MMTJgIGNvbGxhcHNlcyB0byBgW2EudHMgKHR3byBzdGFja2VkIHJhbmdlcyksIGIudHMgKG9uZSByYW5nZSldYFxuICogXHUyMDE0IGBhLnRzYCBzaXRzIGF0IHBvc2l0aW9uIDAsIGl0cyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgaXRzIGxhc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb2xsYXBzZUJ5UGF0aChyb3dzOiB7IHBhdGg6IHN0cmluZzsgcmFuZ2U6IFJhbmdlTGFiZWw7IHN1ZmZpeDogc3RyaW5nIH1bXSk6IFRyZWVBbmNob3JbXSB7XG4gIGNvbnN0IG9yZGVyOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBieVBhdGggPSBuZXcgTWFwPHN0cmluZywgVHJlZUFuY2hvcj4oKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGxldCBhbmNob3IgPSBieVBhdGguZ2V0KHJvdy5wYXRoKTtcbiAgICBpZiAoIWFuY2hvcikge1xuICAgICAgYW5jaG9yID0geyBwYXRoOiByb3cucGF0aCwgcmFuZ2VzOiBbXSB9O1xuICAgICAgYnlQYXRoLnNldChyb3cucGF0aCwgYW5jaG9yKTtcbiAgICAgIG9yZGVyLnB1c2gocm93LnBhdGgpO1xuICAgIH1cbiAgICBhbmNob3IucmFuZ2VzLnB1c2goeyByYW5nZTogcm93LnJhbmdlLCBzdWZmaXg6IHJvdy5zdWZmaXggfSk7XG4gIH1cbiAgcmV0dXJuIG9yZGVyLm1hcCgocGF0aCkgPT4gYnlQYXRoLmdldChwYXRoKSBhcyBUcmVlQW5jaG9yKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUcmVlIGNvbnN0cnVjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBMZWFmTm9kZSB7XG4gIGtpbmQ6ICdsZWFmJztcbiAgbmFtZTogc3RyaW5nO1xuICBhbmNob3I6IFRyZWVBbmNob3I7XG59XG5cbmludGVyZmFjZSBEaXJOb2RlIHtcbiAga2luZDogJ2Rpcic7XG4gIG5hbWU6IHN0cmluZztcbiAgY2hpbGRyZW46IFBhdGhUcmVlTm9kZVtdO1xufVxuXG50eXBlIFBhdGhUcmVlTm9kZSA9IExlYWZOb2RlIHwgRGlyTm9kZTtcblxuLyoqXG4gKiBTcGxpdCBhIHBhdGggaW50byBgL2Atc2VwYXJhdGVkIHNlZ21lbnRzLCBvciBgbnVsbGAgd2hlbiBkb2luZyBzbyB3b3VsZFxuICogZmVlZCBhbiBlbXB0eS1zdHJpbmcgc2VnbWVudCBpbnRvIHRoZSB0cmllIChhIGxlYWRpbmcgYC9gLCBhIHRyYWlsaW5nIGAvYCxcbiAqIGEgZG91YmxlZCBgLy9gLCBvciB0aGUgZW1wdHkgc3RyaW5nKS4gYG51bGxgIHNpZ25hbHMgdGhlIGNhbGxlciB0byByZW5kZXJcbiAqIHRoYXQgYW5jaG9yJ3MgZnVsbCBwYXRoIHN0cmluZyBhcyBhIHNpbmdsZSwgdW5zcGxpdCwgYXRvbWljIHRvcC1sZXZlbCBsZWFmXG4gKiBpbnN0ZWFkIG9mIGF0dGVtcHRpbmcgdG8gbmVzdCBpdCBcdTIwMTQgYSBrbm93bi1lbnVtZXJhYmxlIGNsYXNzIG9mIG1hbGZvcm1lZFxuICogcGF0aHMgZ2V0cyBhIHJlYWwgcnVsZSBoZXJlIHJhdGhlciB0aGFuIHRoZSBzcGxpdCBydW5uaW5nIGFueXdheSBhbmRcbiAqIGZhYnJpY2F0aW5nIGFuIGVtcHR5LW5hbWVkIGRpcmVjdG9yeSBub2RlLiBBIGJhcmUgZmlsZW5hbWUgd2l0aCBubyBgL2AgYXRcbiAqIGFsbCBwcm9kdWNlcyBleGFjdGx5IG9uZSBub24tZW1wdHkgc2VnbWVudCBhbmQgaXMgaGFuZGxlZCBieSB0aGUgb3JkaW5hcnlcbiAqIHBhdGggYmVsb3cgKGl0IGJlY29tZXMgYSB0b3AtbGV2ZWwgbGVhZiB3aXRoIG5vIGRpcmVjdG9yeSB0byBuZXN0IHVuZGVyIFx1MjAxNFxuICogYWxyZWFkeSBhdG9taWMsIG5vIHNwZWNpYWwgY2FzZSBuZWVkZWQpLlxuICovXG5mdW5jdGlvbiBzcGxpdFNlZ21lbnRzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGlmIChwYXRoLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHNlZ21lbnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBpZiAoc2VnbWVudHMuc29tZSgoc2VnbWVudCkgPT4gc2VnbWVudC5sZW5ndGggPT09IDApKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHNlZ21lbnRzO1xufVxuXG5mdW5jdGlvbiBmaW5kT3JDcmVhdGVEaXIocGFyZW50OiBEaXJOb2RlLCBuYW1lOiBzdHJpbmcpOiBEaXJOb2RlIHtcbiAgZm9yIChjb25zdCBjaGlsZCBvZiBwYXJlbnQuY2hpbGRyZW4pIHtcbiAgICBpZiAoY2hpbGQua2luZCA9PT0gJ2RpcicgJiYgY2hpbGQubmFtZSA9PT0gbmFtZSkgcmV0dXJuIGNoaWxkO1xuICB9XG4gIGNvbnN0IG5vZGU6IERpck5vZGUgPSB7IGtpbmQ6ICdkaXInLCBuYW1lLCBjaGlsZHJlbjogW10gfTtcbiAgcGFyZW50LmNoaWxkcmVuLnB1c2gobm9kZSk7XG4gIHJldHVybiBub2RlO1xufVxuXG4vKiogSW5zZXJ0IG9uZSBhbmNob3IgaW50byB0aGUgdHJpZSwgY3JlYXRpbmcvcmV1c2luZyBkaXJlY3Rvcnkgbm9kZXMgaW4gYXJyaXZhbCBvcmRlci4gKi9cbmZ1bmN0aW9uIGluc2VydEFuY2hvcihyb290OiBEaXJOb2RlLCBzZWdtZW50czogc3RyaW5nW10sIGFuY2hvcjogVHJlZUFuY2hvcik6IHZvaWQge1xuICBsZXQgY3VyID0gcm9vdDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50cy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICBjdXIgPSBmaW5kT3JDcmVhdGVEaXIoY3VyLCBzZWdtZW50c1tpXSk7XG4gIH1cbiAgY3VyLmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IHNlZ21lbnRzW3NlZ21lbnRzLmxlbmd0aCAtIDFdLCBhbmNob3IgfSk7XG59XG5cbi8qKlxuICogQnVpbGQgdGhlIHRvcC1sZXZlbCBmb3Jlc3QgZnJvbSBhIGBUcmVlQW5jaG9yW11gIGFscmVhZHkgY29sbGFwc2VkIGJ5XG4gKiBgY29sbGFwc2VCeVBhdGhgLiBTaWJsaW5nIG9yZGVyIGlzIG5ldmVyIHJlLXNvcnRlZCBcdTIwMTQgYSBwYXRoIGVpdGhlciBvcGVucyBhXG4gKiBuZXcgbm9kZSBhdCBpdHMgYXJyaXZhbCBwb3NpdGlvbiBvciBpcyBuZXN0ZWQgdW5kZXIgYSBkaXJlY3Rvcnkgbm9kZVxuICogY3JlYXRlZC9yZXVzZWQgYXQgdGhhdCBkaXJlY3RvcnkncyBvd24gZmlyc3Qtb2NjdXJyZW5jZSBwb3NpdGlvbi5cbiAqL1xuZnVuY3Rpb24gYnVpbGRGb3Jlc3QoYW5jaG9yczogVHJlZUFuY2hvcltdKTogUGF0aFRyZWVOb2RlW10ge1xuICBjb25zdCByb290OiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZTogJycsIGNoaWxkcmVuOiBbXSB9O1xuICBmb3IgKGNvbnN0IGFuY2hvciBvZiBhbmNob3JzKSB7XG4gICAgY29uc3Qgc2VnbWVudHMgPSBzcGxpdFNlZ21lbnRzKGFuY2hvci5wYXRoKTtcbiAgICBpZiAoc2VnbWVudHMgPT09IG51bGwpIHtcbiAgICAgIHJvb3QuY2hpbGRyZW4ucHVzaCh7IGtpbmQ6ICdsZWFmJywgbmFtZTogYW5jaG9yLnBhdGgsIGFuY2hvciB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpbnNlcnRBbmNob3Iocm9vdCwgc2VnbWVudHMsIGFuY2hvcik7XG4gIH1cbiAgcmV0dXJuIHJvb3QuY2hpbGRyZW47XG59XG5cbi8qKiBBIG5vZGUgcGFpcmVkIHdpdGggdGhlIChwb3NzaWJseSBmb2xkZWQpIG5hbWUgaXQgZGlzcGxheXMgb24gaXRzIG93biBsaW5lLiAqL1xuaW50ZXJmYWNlIERpc3BsYXlJdGVtIHtcbiAgbmFtZTogc3RyaW5nO1xuICBub2RlOiBQYXRoVHJlZU5vZGU7XG59XG5cbi8qKlxuICogRm9sZCBhIGNoYWluIG9mIHNpbmdsZS1jaGlsZCBub2RlcyBpbnRvIG9uZSBjb21iaW5lZCBuYW1lXG4gKiAoYHB1YmxpYy9jbGF1ZGUvcnVudGltZS9za2lsbHMvY2FyZGAsIGBkaXJ0eS9tb2QucnNgLFxuICogYC5kZXZjb250YWluZXIvRG9ja2VyZmlsZWApLiBGb2xkaW5nIGNvbnRpbnVlcyB3aGlsZSB0aGUgY3VycmVudCBub2RlIGlzIGFcbiAqIGRpcmVjdG9yeSB3aXRoICoqZXhhY3RseSBvbmUgY2hpbGQqKiwgcmVnYXJkbGVzcyBvZiB3aGV0aGVyIHRoYXQgY2hpbGQgaXMgYVxuICogZGlyZWN0b3J5IG9yIGEgbGVhZjogYSBub2RlIHdpdGggb25lIGNoaWxkIGNvbnZleXMgbm8gZ3JvdXBpbmcgYnlcbiAqIGRlZmluaXRpb24sIHNvIGZvbGRpbmcgaXQgbG9zZXMgbm8gc3RydWN0dXJlIHdoaWxlIHJlbW92aW5nIGEgbGluZSB3aG9zZVxuICogb25seSBjb250ZW50IGlzIGEgY29ubmVjdG9yLiBTdG9wcyBhdCB0aGUgZmlyc3QgZGlyZWN0b3J5IHdpdGggMisgY2hpbGRyZW5cbiAqIChleHBhbmQgZnJvbSB0aGVyZSkgb3IgYXQgYSBsZWFmICh3aGljaCB0aGVuIHJlbmRlcnMgd2l0aCB0aGUgZm9sZGVkIG5hbWUpLlxuICpcbiAqIEZvbGRpbmcgbG9uZSAqbGVhdmVzKiBcdTIwMTQgbm90IGp1c3QgbG9uZSBkaXJlY3RvcmllcyBcdTIwMTQgaXMgd2hhdCBrZWVwcyB0aGUgdHJlZVxuICogbm8gdGFsbGVyIHRoYW4gdGhlIGZsYXQgYnVsbGV0IGxpc3QgaXQgcmVwbGFjZXMsIGFuZCB3aGF0IG1ha2VzIGEgc2luZ2xlXG4gKiBhbmNob3IgcmVuZGVyIGFzIHRoZSBvbmUtbGluZSB0cmVlIHRoZSBwbGFuIHByb21pc2VzIGV2ZW4gd2hlbiBpdHMgcGF0aCBoYXNcbiAqIGRpcmVjdG9yaWVzIGluIGl0LiBJdCBhbHNvIGtlZXBzIHRoZSBkaXNjcmltaW5hdGluZyBzZWdtZW50IG9uIHRoZSBzYW1lXG4gKiBsaW5lIGFzIGl0cyByYW5nZSAoYGRpcnR5L21vZC5ycyAjTDM5Mi1MMzk5YCkgZm9yIGBtb2QucnNgL2BpbmRleC50c2BcbiAqIGxheW91dHMsIHdoZXJlIHRoZSBmaWxlbmFtZSBhbG9uZSBpZGVudGlmaWVzIG5vdGhpbmcuXG4gKi9cbmZ1bmN0aW9uIGZvbGRDaGFpbihub2RlOiBQYXRoVHJlZU5vZGUpOiBEaXNwbGF5SXRlbSB7XG4gIGxldCBuYW1lID0gbm9kZS5uYW1lO1xuICBsZXQgY3VyID0gbm9kZTtcbiAgd2hpbGUgKGN1ci5raW5kID09PSAnZGlyJyAmJiBjdXIuY2hpbGRyZW4ubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgY2hpbGQgPSBjdXIuY2hpbGRyZW5bMF07XG4gICAgbmFtZSA9IGAke25hbWV9LyR7Y2hpbGQubmFtZX1gO1xuICAgIGN1ciA9IGNoaWxkO1xuICB9XG4gIHJldHVybiB7IG5hbWUsIG5vZGU6IGN1ciB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlbmRlcmluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmFuayBvZiBhIHN0YWNrZWQgZW50cnkncyByYW5nZSBraW5kOiBgd2hvbGUtZmlsZWAgZmlyc3QsIHRoZW4gbnVtZXJpY1xuICogYHJhbmdlYHMsIHRoZW4gYHRydW5jYXRlZGAuIEEgd2hvbGUtZmlsZSBhbmNob3IgaXMgdGhlIENMSSdzIGAwLTBgIHJvdyBcdTIwMTQgaXRcbiAqIGNvdmVycyB0aGUgZW50aXJlIGZpbGUsIHNvIGl0IHNvcnRzIGFoZWFkIG9mIGV2ZXJ5IGxpbmUgcmFuZ2Ugb24gdGhhdCBmaWxlXG4gKiB0aGUgc2FtZSB3YXkgbGluZSAwIHdvdWxkLiBgdHJ1bmNhdGVkYCBjYXJyaWVzIG5vIHBvc2l0aW9uIGF0IGFsbCBhbmQgc29ydHNcbiAqIGxhc3QuXG4gKi9cbmZ1bmN0aW9uIHJhbmdlUmFuayhyYW5nZTogUmFuZ2VMYWJlbCk6IG51bWJlciB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3dob2xlLWZpbGUnOlxuICAgICAgcmV0dXJuIDA7XG4gICAgY2FzZSAncmFuZ2UnOlxuICAgICAgcmV0dXJuIDE7XG4gICAgY2FzZSAndHJ1bmNhdGVkJzpcbiAgICAgIHJldHVybiAyO1xuICB9XG59XG5cbi8qKlxuICogU3RhY2tlZC1yYW5nZSBvcmRlciBpcyBieSBraW5kIHJhbmsgdGhlbiBudW1lcmljIChgc3RhcnRgIHRoZW4gYGVuZGApLFxuICogb3ZlcnJpZGluZyBhcnJpdmFsIG9yIGNvZGVwb2ludCBvcmRlciBcdTIwMTQgdGhlIG9ubHkgc29ydGluZyB0aGlzIG1vZHVsZSBkb2VzLFxuICogYW5kIHNjb3BlZCBzdHJpY3RseSB0byByYW5nZXMgc3RhY2tlZCBvbiBvbmUgcGF0aCAobmV2ZXIgdG8gc2libGluZyBwYXRoc1xuICogb3IgZGlyZWN0b3J5IG9yZGVyKS4gRXF1YWwtcmFua2VkIGVudHJpZXMgKHR3byBgdHJ1bmNhdGVkYHMsIG9yIHR3b1xuICogaWRlbnRpY2FsIHJhbmdlcykga2VlcCB0aGVpciBvd24gcmVsYXRpdmUgYXJyaXZhbCBvcmRlciwgc2luY2UgdGhlIHNvcnQgaXNcbiAqIHN0YWJsZS5cbiAqL1xuZnVuY3Rpb24gY29tcGFyZVJhbmdlRW50cmllcyhhOiBSYW5nZUVudHJ5LCBiOiBSYW5nZUVudHJ5KTogbnVtYmVyIHtcbiAgY29uc3QgcmFuayA9IHJhbmdlUmFuayhhLnJhbmdlKSAtIHJhbmdlUmFuayhiLnJhbmdlKTtcbiAgaWYgKHJhbmsgIT09IDApIHJldHVybiByYW5rO1xuICBpZiAoYS5yYW5nZS5raW5kID09PSAncmFuZ2UnICYmIGIucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJykge1xuICAgIHJldHVybiBhLnJhbmdlLnN0YXJ0IC0gYi5yYW5nZS5zdGFydCB8fCBhLnJhbmdlLmVuZCAtIGIucmFuZ2UuZW5kO1xuICB9XG4gIHJldHVybiAwO1xufVxuXG4vKipcbiAqIFRoZSByYW5nZSBjb2x1bW4ncyB0ZXh0LCBvciBgbnVsbGAgd2hlbiB0aGUgZW50cnkgcHJpbnRzIGFzIGEgYmFyZSBwYXRoXG4gKiB3aXRoIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwuXG4gKlxuICogQSBgd2hvbGUtZmlsZWAgZW50cnkgaXMgdGhlIG9uZSBraW5kIHdob3NlIHJlbmRlcmluZyBkZXBlbmRzIG9uIGNvbnRleHQuXG4gKiBBbG9uZSBvbiBpdHMgcGF0aCBpdCBzdGF5cyBhIGJhcmUgcGF0aCB3aXRoIHplcm8gbWFya2VyIFx1MjAxNCB0aGF0IGlzIHdoYXQgdGhlXG4gKiBDTEkncyBvd24gZmxhdCBsaXN0IHByaW50cyBmb3IgYSB3aG9sZS1maWxlIGFuY2hvciwgYW5kIGFkZGluZyBhIG1hcmtlclxuICogdGhlcmUgd291bGQgYW5ub3RhdGUgdGhlIG92ZXJ3aGVsbWluZ2x5IGNvbW1vbiBjYXNlIGZvciB0aGUgYmVuZWZpdCBvZiB0aGVcbiAqIHJhcmUgb25lLiAqU3RhY2tlZCogYmVoaW5kIG90aGVyIHJhbmdlcyBvbiB0aGUgc2FtZSBwYXRoIGl0IG11c3QgY2FycnkgYW5cbiAqIGV4cGxpY2l0IG1hcmtlcjogd2l0aG91dCBvbmUgaXQgcmVuZGVycyBhcyBhIGNvbnRpbnVhdGlvbiBsaW5lIGhvbGRpbmdcbiAqIG5vdGhpbmcgYnV0IGluZGVudGF0aW9uIGFuZCBpdHMgZHJpZnQgc3VmZml4LCB3aGljaCBlcmFzZXMgdGhlIGFuY2hvclxuICogb3V0cmlnaHQgd2hlbiB0aGUgc3VmZml4IGlzIGVtcHR5IGFuZCBcdTIwMTQgd29yc2UgXHUyMDE0IGhhbmdzIGl0cyBgIFx1MjAxNCBjaGFuZ2VkYFxuICogdW5kZXIgYSBuZWlnaGJvdXJpbmcgcmFuZ2UsIGV4YWN0bHkgdGhlIHZpc3VhbCBncmFtbWFyIHRoYXQgbWVhbnMgXCJhbm90aGVyXG4gKiByYW5nZSBvbiB0aGlzIHNhbWUgZmlsZVwiLiBUaGUgcmVhZGVyIHdvdWxkIHRoZW4gcmVjb25jaWxlIHRoZSByYW5nZSB0aGF0XG4gKiBkaWQgbm90IGRyaWZ0LiBPZiB0aGUgdGhyZWUgZml4ZXMgYXZhaWxhYmxlIChwcmludCB0aGUgcGF0aCBvblxuICogY29udGludWF0aW9uIGxpbmVzLCBzb3J0IHdob2xlLWZpbGUgdG8gcG9zaXRpb24gMCwgb3Igc3BsaXQgaXQgaW50byBpdHMgb3duXG4gKiBsZWFmKSwgYW4gZXhwbGljaXQgbWFya2VyIGlzIHRoZSBvbmx5IG9uZSB0aGF0IG1ha2VzIHRoZSBlbnRyeSBpZGVudGlmaWFibGVcbiAqIGluICpldmVyeSogcG9zaXRpb24gcmF0aGVyIHRoYW4gb25seSBpbiB0aGUgcG9zaXRpb24gdGhlIHNvcnQgaGFwcGVucyB0b1xuICogcHV0IGl0IGluOyBzb3J0aW5nIGl0IGZpcnN0IChzZWUge0BsaW5rIHJhbmdlUmFua30pIGlzIGtlcHQgYXMgd2VsbCBiZWNhdXNlXG4gKiBcIndob2xlIGZpbGUsIHRoZW4gaXRzIHJhbmdlcyBpbiBsaW5lIG9yZGVyXCIgaXMgdGhlIG9yZGVyIGEgcmVhZGVyIGV4cGVjdHMsXG4gKiBub3QgYmVjYXVzZSBpZGVudGlmaWFiaWxpdHkgZGVwZW5kcyBvbiBpdC5cbiAqL1xuZnVuY3Rpb24gbGFiZWxGb3IocmFuZ2U6IFJhbmdlTGFiZWwsIHNvbGU6IGJvb2xlYW4pOiBzdHJpbmcgfCBudWxsIHtcbiAgc3dpdGNoIChyYW5nZS5raW5kKSB7XG4gICAgY2FzZSAncmFuZ2UnOlxuICAgICAgcmV0dXJuIGAjTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICAgIGNhc2UgJ3dob2xlLWZpbGUnOlxuICAgICAgcmV0dXJuIHNvbGUgPyBudWxsIDogJyh3aG9sZSBmaWxlKSc7XG4gICAgY2FzZSAndHJ1bmNhdGVkJzpcbiAgICAgIHJldHVybiAnKHRydW5jYXRlZCBpbiBzb3VyY2UgXHUyMDE0IGFuY2hvciBpbmNvbXBsZXRlKSc7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDb2x1bW4gbWF0aFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGdyYXBoZW1lIHNlZ21lbnRlciwgY29uc3RydWN0ZWQgb24gZmlyc3QgdXNlIGFuZCB0aGVuIGNhY2hlZCBcdTIwMTQgaW5jbHVkaW5nXG4gKiBhIGNhY2hlZCBgbnVsbGAgd2hlbiBpdCBjYW5ub3QgYmUgY29uc3RydWN0ZWQgYXQgYWxsLlxuICpcbiAqIExhenkgb24gcHVycG9zZS4gYEludGxgIGlzIG5vdCBwYXJ0IG9mIHRoZSBKYXZhU2NyaXB0IGxhbmd1YWdlIGNvcmU6IGEgTm9kZVxuICogYnVpbHQgYC0td2l0aC1pbnRsPW5vbmVgIGhhcyBubyBgSW50bGAgZ2xvYmFsIHdoYXRzb2V2ZXIsIGFuZCBgaG9va3MuanNvbmBcbiAqIGludm9rZXMgYSBiYXJlIGBub2RlYCBvZmYgdGhlIHVzZXIncyBgUEFUSGAsIHNvIGBlbmdpbmVzLm5vZGVgIGNvbnN0cmFpbnNcbiAqIG5vdGhpbmcgaGVyZS4gQ29uc3RydWN0aW5nIHRoaXMgYXQgbW9kdWxlIHNjb3BlIHB1dCBhIGBSZWZlcmVuY2VFcnJvcmAgaW5cbiAqIHRoZSBidW5kbGVzJyB0b3AtbGV2ZWwgc3RhdGVtZW50cywgd2hlcmUgaXQgdGhyb3dzIGF0ICppbXBvcnQqIFx1MjAxNCBiZWZvcmUgYW55XG4gKiBvZiB0aGUgZmFpbC1jbG9zZWQgYHRyeS9jYXRjaGAgYmxvY2tzIGluIGByZW5kZXJBbmNob3JSdW5gLCBgcmVuZGVyUGF0aFJ1bmBcbiAqIGFuZCBgYW5jaG9yQnVsbGV0c2AgZXhpc3QgdG8gY2F0Y2ggaXQuIFRoZSBob29rIHByb2Nlc3MgdGhlbiBkaWVkIHdpdGggZXhpdFxuICogMSwgd2hpY2ggQ2xhdWRlIENvZGUgdHJlYXRzIGFzIGEgbm9uLWJsb2NraW5nIGhvb2sgZXJyb3I6IHRoZSBjb21taXQgZ2F0ZVxuICogc2lsZW50bHkgYWxsb3dlZCB0aGUgY29tbWl0IGFuZCB0aGUgZHJpZnQgcmVtaW5kZXIgc2lsZW50bHkgdmFuaXNoZWQuXG4gKiBCdWlsZGluZyBpdCBpbnNpZGUgdGhlIHJlbmRlciBwYXRoIHB1dHMgYW55IGZhaWx1cmUgYmFjayBpbnNpZGUgdGhvc2VcbiAqIGNhdGNoZXMuXG4gKlxuICogRkFJTC1DTE9TRUQsIG5vdCBhIGA8Z3JlZW5maWVsZD5gLWZvcmJpZGRlbiBmYWxsYmFjayBcdTIwMTQgdGhlIHNhbWUgY2F0ZWdvcnkgYXNcbiAqIHRoZSBsb2NhbCBgdHJ5L2NhdGNoYCBibG9ja3MgYXQgdGhpcyBtb2R1bGUncyBjYWxsIHNpdGVzLCBhbmQgbG9hZC1iZWFyaW5nXG4gKiBmb3IgdGhlIHNhbWUgcmVhc29uLiBOb3RoaW5nIGluIHRoZSBjb2x1bW4tYWxpZ25tZW50IHBhdGggbWF5IGJlIGFibGUgdG9cbiAqIGNvc3QgdGhlIGNvbW1pdCBnYXRlIG9yIHRoZSBkcmlmdCByZW1pbmRlcjogaWYgZGlzcGxheSB3aWR0aCBjYW5ub3QgYmVcbiAqIG1lYXN1cmVkLCB0aGUgbGlzdCBzdGlsbCBwcmludHMgYW5kIHRoZSBnYXRlIHN0aWxsIGhvbGRzOyBvbmx5IGFsaWdubWVudCBpc1xuICogbG9zdC5cbiAqL1xubGV0IGNhY2hlZFNlZ21lbnRlcjogeyB2YWx1ZTogSW50bC5TZWdtZW50ZXIgfCBudWxsIH0gfCB1bmRlZmluZWQ7XG5cbmZ1bmN0aW9uIGdyYXBoZW1lU2VnbWVudGVyKCk6IEludGwuU2VnbWVudGVyIHwgbnVsbCB7XG4gIGlmIChjYWNoZWRTZWdtZW50ZXIgPT09IHVuZGVmaW5lZCkge1xuICAgIHRyeSB7XG4gICAgICBjYWNoZWRTZWdtZW50ZXIgPSB7IHZhbHVlOiBuZXcgSW50bC5TZWdtZW50ZXIoJ2VuJywgeyBncmFudWxhcml0eTogJ2dyYXBoZW1lJyB9KSB9O1xuICAgIH0gY2F0Y2gge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbnVsbCB9O1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2FjaGVkU2VnbWVudGVyLnZhbHVlO1xufVxuXG4vKipcbiAqIENvZGUgcG9pbnQgcmFuZ2VzIHJlbmRlcmVkIHR3byBjb2x1bW5zIHdpZGU6IHRoZSBFYXN0IEFzaWFuIFdpZGUgKFcpIGFuZFxuICogRnVsbHdpZHRoIChGKSBibG9ja3Mgb2YgVUFYICMxMSwgcGx1cyB0aGUgZW1vamkgYmxvY2tzIHRoYXQgdGVybWluYWxzIGFuZFxuICogcHJvcG9ydGlvbmFsIGFnZW50LWZhY2luZyByZW5kZXJlcnMgYm90aCBnaXZlIGRvdWJsZSB3aWR0aC4gRXZlcnl0aGluZyBlbHNlXG4gKiBjb3VudHMgYXMgb25lIGNvbHVtbi5cbiAqXG4gKiBTb3J0ZWQgYXNjZW5kaW5nIGFuZCBub24tb3ZlcmxhcHBpbmcgXHUyMDE0IHtAbGluayBpc1dpZGVDb2RlUG9pbnR9IHNob3J0LWNpcmN1aXRzXG4gKiBvbiB0aGUgZmlyc3QgcmFuZ2Ugc3RhcnRpbmcgcGFzdCB0aGUgY29kZSBwb2ludC5cbiAqL1xuY29uc3QgV0lERV9SQU5HRVM6IHJlYWRvbmx5IChyZWFkb25seSBbbnVtYmVyLCBudW1iZXJdKVtdID0gW1xuICBbMHgxMTAwLCAweDExNWZdLFxuICBbMHgyMzI5LCAweDIzMmFdLFxuICBbMHgyNjAwLCAweDI3YmZdLFxuICBbMHgyZTgwLCAweDMwM2VdLFxuICBbMHgzMDQxLCAweDMzZmZdLFxuICBbMHgzNDAwLCAweDRkYmZdLFxuICBbMHg0ZTAwLCAweDlmZmZdLFxuICBbMHhhMDAwLCAweGE0Y2ZdLFxuICBbMHhhOTYwLCAweGE5N2ZdLFxuICBbMHhhYzAwLCAweGQ3YTNdLFxuICBbMHhmOTAwLCAweGZhZmZdLFxuICBbMHhmZTEwLCAweGZlMTldLFxuICBbMHhmZTMwLCAweGZlNmZdLFxuICBbMHhmZjAwLCAweGZmNjBdLFxuICBbMHhmZmUwLCAweGZmZTZdLFxuICBbMHgxNzAwMCwgMHgxOGFmZl0sXG4gIFsweDFmMWU2LCAweDFmMWZmXSxcbiAgWzB4MWYzMDAsIDB4MWY2NGZdLFxuICBbMHgxZjY4MCwgMHgxZjZmZl0sXG4gIFsweDFmOTAwLCAweDFmOWZmXSxcbiAgWzB4MWZhNzAsIDB4MWZhZmZdLFxuICBbMHgyMDAwMCwgMHgyZmZmZF0sXG4gIFsweDMwMDAwLCAweDNmZmZkXVxuXTtcblxuZnVuY3Rpb24gaXNXaWRlQ29kZVBvaW50KGNwOiBudW1iZXIpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBbbG8sIGhpXSBvZiBXSURFX1JBTkdFUykge1xuICAgIGlmIChjcCA8IGxvKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGNwIDw9IGhpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogRGlzcGxheSB3aWR0aCBvZiBhIG5hbWUgaW4gdGVybWluYWwgY29sdW1ucyBcdTIwMTQgdGhlIHVuaXQgdGhlIHJhbmdlIGNvbHVtbiBpc1xuICogYWN0dWFsbHkgYWxpZ25lZCBpbi4gTWVhc3VyZWQgb3ZlciBncmFwaGVtZSBjbHVzdGVycyAoc28gYSBkZWNvbXBvc2VkIGBcdTAwRTlgXG4gKiBvciBhIGNvbWJpbmluZy1tYXJrIHNlcXVlbmNlIGNvdW50cyBvbmNlLCBub3Qgb25jZSBwZXIgY29kZSBwb2ludCksIHdpdGhcbiAqIGVhY2ggY2x1c3RlciBjb250cmlidXRpbmcgdHdvIGNvbHVtbnMgd2hlbiBpdHMgYmFzZSBjb2RlIHBvaW50IGlzIEVhc3RcbiAqIEFzaWFuIFdpZGUvRnVsbHdpZHRoIG9yIGVtb2ppIGFuZCBvbmUgb3RoZXJ3aXNlLlxuICpcbiAqIE5laXRoZXIgVVRGLTE2IGAubGVuZ3RoYCBub3IgYEFycmF5LmZyb20obmFtZSkubGVuZ3RoYCBpcyB0aGlzIHVuaXQ6IHRoZVxuICogZmlyc3Qgb3Zlci1jb3VudHMgYSBzdXJyb2dhdGUgcGFpciwgdGhlIHNlY29uZCB1bmRlci1jb3VudHMgYSBDSksgaWRlb2dyYXBoXG4gKiBhbmQgb3Zlci1jb3VudHMgYSBkZWNvbXBvc2VkIGFjY2VudC5cbiAqXG4gKiBXaGVuIHtAbGluayBncmFwaGVtZVNlZ21lbnRlcn0gaXMgdW5hdmFpbGFibGUgKGEgTm9kZSBidWlsdFxuICogYC0td2l0aC1pbnRsPW5vbmVgIGhhcyBubyBgSW50bGAgZ2xvYmFsIGF0IGFsbCksIHRoaXMgZGVncmFkZXMgdG8gdGhlIGNydWRlclxuICogcGVyLWNvZGUtcG9pbnQgbWVhc3VyZSByYXRoZXIgdGhhbiB0aHJvd2luZy4gVGhhdCBtZWFzdXJlIG92ZXItY291bnRzIGFcbiAqIGRlY29tcG9zZWQgYWNjZW50IGFuZCBhIHJlZ2lvbmFsLWluZGljYXRvciBmbGFnIHBhaXIsIHNvIGFsaWdubWVudCBjYW4gYmUgYVxuICogY29sdW1uIG9yIHR3byBvZmYgXHUyMDE0IHdoaWNoIGlzIHRoZSBlbnRpcmUgY29zdCwgYW5kIGlzIHRoZSBjb3JyZWN0IHByaWNlIHRvXG4gKiBwYXk6IHRoZSBhbmNob3IgbGlzdCBzdGlsbCBwcmludHMgYW5kIHRoZSBjb21taXQgZ2F0ZSBzdGlsbCBob2xkcy5cbiAqL1xuZnVuY3Rpb24gZGlzcGxheVdpZHRoKG5hbWU6IHN0cmluZyk6IG51bWJlciB7XG4gIGNvbnN0IHNlZ21lbnRlciA9IGdyYXBoZW1lU2VnbWVudGVyKCk7XG4gIGxldCB3aWR0aCA9IDA7XG4gIGlmIChzZWdtZW50ZXIgPT09IG51bGwpIHtcbiAgICBmb3IgKGNvbnN0IGNvZGVQb2ludCBvZiBuYW1lKSB7XG4gICAgICB3aWR0aCArPSBpc1dpZGVDb2RlUG9pbnQoY29kZVBvaW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gICAgfVxuICAgIHJldHVybiB3aWR0aDtcbiAgfVxuICBmb3IgKGNvbnN0IHsgc2VnbWVudCB9IG9mIHNlZ21lbnRlci5zZWdtZW50KG5hbWUpKSB7XG4gICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KHNlZ21lbnQuY29kZVBvaW50QXQoMCkgPz8gMCkgPyAyIDogMTtcbiAgfVxuICByZXR1cm4gd2lkdGg7XG59XG5cbi8qKlxuICogQWxpZ25tZW50IGNlaWxpbmcuIEEgc2libGluZyBncm91cCB3aG9zZSB3aWRlc3QgcmFuZ2UtYmVhcmluZyBuYW1lIGV4Y2VlZHNcbiAqIHRoaXMgd2lkdGggZG9lcyBub3QgYWxpZ24gYXQgYWxsIFx1MjAxNCBldmVyeSBuYW1lIGluIGl0IHRha2VzIGEgc2luZ2xlIHNwYWNlXG4gKiBiZWZvcmUgaXRzIHJhbmdlLiBUaGUgYWx0ZXJuYXRpdmUgKHBhZCB0aGUgc2hvcnQgbmFtZXMgdG8gdGhlIGNlaWxpbmcgd2hpbGVcbiAqIHRoZSBsb25nIG9uZSBzaXRzIGF0IGl0cyBvd24gbmF0dXJhbCBjb2x1bW4pIHBheXMgbW9zdCBvZiB0aGUgd2lkdGggZm9yXG4gKiBhbGlnbm1lbnQgdGhhdCBhbGlnbnMgd2l0aCBub3RoaW5nLCB3aGljaCBpcyBzdHJpY3RseSB3b3JzZSB0aGFuIG5vdFxuICogYWxpZ25pbmcuIE5hbWVzIHRoZW1zZWx2ZXMgYXJlIG5ldmVyIHRydW5jYXRlZCBvciBlbGlkZWQgYXQgYW55IHdpZHRoLlxuICovXG5jb25zdCBNQVhfQUxJR05fQ09MVU1OID0gNDg7XG5cbi8qKlxuICogVGhlIGNvbHVtbiBldmVyeSByYW5nZS1iZWFyaW5nIG5hbWUgaW4gdGhpcyBzaWJsaW5nIGdyb3VwIHBhZHMgdG8sIG9yIGAwYFxuICogd2hlbiB0aGUgZ3JvdXAgZm9yZ29lcyBhbGlnbm1lbnQgKG5vIHJhbmdlLWJlYXJpbmcgbmFtZXMsIG9yIGEgbmFtZSBwYXN0XG4gKiB7QGxpbmsgTUFYX0FMSUdOX0NPTFVNTn0pLiBBbGlnbm1lbnQgc2NvcGUgaXMgdGhlIGdyb3VwJ3MgZGlyZWN0IGNoaWxkcmVuXG4gKiBvbmx5LCBuZXZlciB0aGUgd2hvbGUgdHJlZSBcdTIwMTQgd2hvbGUtdHJlZSBhbGlnbm1lbnQgd291bGQgbGV0IG9uZSBkZWVwbHlcbiAqIG5lc3RlZCBsb25nIG5hbWUgcGFkIGV2ZXJ5IHVucmVsYXRlZCBicmFuY2guXG4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVHcm91cFRhcmdldChpdGVtczogRGlzcGxheUl0ZW1bXSk6IG51bWJlciB7XG4gIGxldCBtYXggPSAwO1xuICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICBpZiAoaXRlbS5ub2RlLmtpbmQgPT09ICdsZWFmJyAmJiBwcmludHNSYW5nZUNvbHVtbihpdGVtLm5vZGUuYW5jaG9yKSkge1xuICAgICAgbWF4ID0gTWF0aC5tYXgobWF4LCBkaXNwbGF5V2lkdGgoaXRlbS5uYW1lKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBtYXggPiBNQVhfQUxJR05fQ09MVU1OID8gMCA6IG1heDtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoaXMgYW5jaG9yIHByaW50cyBhIHJhbmdlIGNvbHVtbiBhdCBhbGwgXHUyMDE0IHRoZSBleGFjdCBjb25kaXRpb25cbiAqIHtAbGluayBsYWJlbEZvcn0gZW5jb2RlcywgaG9pc3RlZCBzbyB7QGxpbmsgY29tcHV0ZUdyb3VwVGFyZ2V0fSBtZWFzdXJlcyB0aGVcbiAqIHNhbWUgc2V0IG9mIG5hbWVzIGl0IHBhZHMuIEFuIGFuY2hvciB3aXRoIG5vIHJhbmdlcywgb3IgYSAqc29sZSogd2hvbGUtZmlsZVxuICogZW50cnkgKHdoaWNoIHJlbmRlcnMgYXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciksIGNvbnRyaWJ1dGVzIG5vIHJhbmdlXG4gKiBjb2x1bW4gYW5kIHNvIG11c3Qgbm90IGNvbnRyaWJ1dGUgdG8gdGhlIGdyb3VwIG1heCBlaXRoZXI6IG90aGVyd2lzZSBhXG4gKiB3aG9sZS1maWxlIGFuY2hvciBvbiBhIHBhdGggcGFzdCB7QGxpbmsgTUFYX0FMSUdOX0NPTFVNTn0gc2lsZW50bHkgc3VwcHJlc3Nlc1xuICogYWxpZ25tZW50IGZvciBpdHMgcmFuZ2UtYmVhcmluZyBzaWJsaW5ncyB3aGlsZSBpdHNlbGYgcHJpbnRpbmcgbm90aGluZyB0b1xuICogYWxpZ24uXG4gKi9cbmZ1bmN0aW9uIHByaW50c1JhbmdlQ29sdW1uKGFuY2hvcjogVHJlZUFuY2hvcik6IGJvb2xlYW4ge1xuICBjb25zdCB7IHJhbmdlcyB9ID0gYW5jaG9yO1xuICBpZiAocmFuZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gcmFuZ2VzLnNvbWUoKGVudHJ5KSA9PiBsYWJlbEZvcihlbnRyeS5yYW5nZSwgcmFuZ2VzLmxlbmd0aCA9PT0gMSkgIT09IG51bGwpO1xufVxuXG4vKiogVGhlIHNwYWNpbmcgYmV0d2VlbiBhIG5hbWUgb2YgYG5hbWVXaWR0aGAgY29sdW1ucyBhbmQgaXRzIHJhbmdlIGNvbHVtbi4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVQYWQobmFtZVdpZHRoOiBudW1iZXIsIHRhcmdldDogbnVtYmVyKTogc3RyaW5nIHtcbiAgaWYgKG5hbWVXaWR0aCA+PSB0YXJnZXQpIHJldHVybiAnICc7XG4gIHJldHVybiAnICcucmVwZWF0KHRhcmdldCAtIG5hbWVXaWR0aCArIDEpO1xufVxuXG4vKipcbiAqIFJlbmRlciBvbmUgbGVhZidzIGxpbmUocykuIEFuIGVtcHR5IGByYW5nZXNgIGFycmF5IGlzIGEgYmFyZS1wYXRoIGxlYWYgd2l0aFxuICogbm8gcmFuZ2UgY29sdW1uIGF0IGFsbCAoZGlzdGluY3QgZnJvbSBhIGB3aG9sZS1maWxlYCBlbnRyeSwgd2hpY2ggaXMgYW5cbiAqIGV4cGxpY2l0IGNsYXNzaWZpY2F0aW9uIHRoYXQgYWxzbyBwcmludHMgd2l0aCB6ZXJvIG1hcmtlciB3aGVuIGl0IHN0YW5kc1xuICogYWxvbmUsIGJ1dCB0aHJvdWdoIHRoZSByYW5nZXMgcGlwZWxpbmUpLiBNdWx0aXBsZSBzdGFja2VkIHJhbmdlcyBwcmludFxuICogdW5kZXIgYSBjb250aW51YXRpb24gcHJlZml4IGluc3RlYWQgb2YgcmVwZWF0aW5nIHRoZSBuYW1lOyBlYWNoIGNhcnJpZXMgaXRzXG4gKiBvd24gc3VmZml4IGluZGVwZW5kZW50bHksIGFuZCBlYWNoIGNhcnJpZXMgYSBsYWJlbCBpZGVudGlmeWluZyB3aGljaCBhbmNob3JcbiAqIHRoZSBzdWZmaXggYmVsb25ncyB0by5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyTGVhZkxpbmVzKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcjogVHJlZUFuY2hvcixcbiAgb3duUHJlZml4OiBzdHJpbmcsXG4gIGNoaWxkUHJlZml4OiBzdHJpbmcsXG4gIGdyb3VwVGFyZ2V0OiBudW1iZXJcbik6IHN0cmluZ1tdIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBbYCR7b3duUHJlZml4fSR7bmFtZX1gXTtcblxuICBjb25zdCBzb3J0ZWQgPSBbLi4ucmFuZ2VzXS5zb3J0KGNvbXBhcmVSYW5nZUVudHJpZXMpO1xuICBjb25zdCBzb2xlID0gc29ydGVkLmxlbmd0aCA9PT0gMTtcbiAgY29uc3QgbmFtZVdpZHRoID0gZGlzcGxheVdpZHRoKG5hbWUpO1xuICBjb25zdCBwYWQgPSBjb21wdXRlUGFkKG5hbWVXaWR0aCwgZ3JvdXBUYXJnZXQpO1xuICBjb25zdCBibGFuayA9ICcgJy5yZXBlYXQobmFtZVdpZHRoICsgcGFkLmxlbmd0aCk7XG5cbiAgcmV0dXJuIHNvcnRlZC5tYXAoKGVudHJ5LCBpKSA9PiB7XG4gICAgY29uc3QgbGFiZWwgPSBsYWJlbEZvcihlbnRyeS5yYW5nZSwgc29sZSk7XG4gICAgaWYgKGxhYmVsID09PSBudWxsKSByZXR1cm4gYCR7b3duUHJlZml4fSR7bmFtZX0ke2VudHJ5LnN1ZmZpeH1gO1xuICAgIGNvbnN0IGJhc2UgPSBpID09PSAwID8gYCR7b3duUHJlZml4fSR7bmFtZX0ke3BhZH1gIDogYCR7Y2hpbGRQcmVmaXh9JHtibGFua31gO1xuICAgIHJldHVybiBgJHtiYXNlfSR7bGFiZWx9JHtlbnRyeS5zdWZmaXh9YDtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlck5vZGVzKG5vZGVzOiBQYXRoVHJlZU5vZGVbXSwgcHJlZml4OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBpdGVtcyA9IG5vZGVzLm1hcChmb2xkQ2hhaW4pO1xuICBjb25zdCBncm91cFRhcmdldCA9IGNvbXB1dGVHcm91cFRhcmdldChpdGVtcyk7XG4gIGl0ZW1zLmZvckVhY2goKGl0ZW0sIGkpID0+IHtcbiAgICBjb25zdCBpc0xhc3QgPSBpID09PSBpdGVtcy5sZW5ndGggLSAxO1xuICAgIGNvbnN0IG93blByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICdcdTI1MTRcdTI1MDAgJyA6ICdcdTI1MUNcdTI1MDAgJ31gO1xuICAgIGNvbnN0IGNoaWxkUHJlZml4ID0gYCR7cHJlZml4fSR7aXNMYXN0ID8gJyAgICcgOiAnXHUyNTAyICAnfWA7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicpIHtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTGVhZkxpbmVzKGl0ZW0ubmFtZSwgaXRlbS5ub2RlLmFuY2hvciwgb3duUHJlZml4LCBjaGlsZFByZWZpeCwgZ3JvdXBUYXJnZXQpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGluZXMucHVzaChgJHtvd25QcmVmaXh9JHtpdGVtLm5hbWV9L2ApO1xuICAgICAgbGluZXMucHVzaCguLi5yZW5kZXJOb2RlcyhpdGVtLm5vZGUuY2hpbGRyZW4sIGNoaWxkUHJlZml4KSk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIGxpbmVzO1xufVxuXG4vKipcbiAqIFJlbmRlciBhIGNvbGxhcHNlZCBhbmNob3IgbGlzdCBhcyBhIGJveC1kcmF3aW5nIHRyZWUsIGdyb3VwZWQgYnkgc2hhcmVkXG4gKiBwYXRoIHByZWZpeC4gRXZlcnkgYW5jaG9yIGxpc3QgcmVuZGVycyBhcyBhIHRyZWUgdW5jb25kaXRpb25hbGx5IFx1MjAxNCBhIHNpbmdsZVxuICogYW5jaG9yIGJlY29tZXMgYSBvbmUtbGluZSB0cmVlIHdoYXRldmVyIGl0cyBkZXB0aCAoc2VlIHtAbGluayBmb2xkQ2hhaW59KTtcbiAqIHRoZXJlIGlzIG5vIGZsYXQtYnVsbGV0IHBhdGggb3Igc2l6ZSBmbG9vciBpbiB0aGlzIG1vZHVsZS5cbiAqXG4gKiBIZWlnaHQgaXMgYm91bmRlZCBieSB7QGxpbmsgZm9sZENoYWlufTogYSBkaXJlY3RvcnkgbGluZSBvbmx5IGV2ZXIgYXBwZWFyc1xuICogd2hlcmUgaXQgZ2VudWluZWx5IGdyb3VwcyB0d28gb3IgbW9yZSBzaWJsaW5ncywgc28gdGhlIHRyZWUgYWRkcyBhdCBtb3N0XG4gKiBvbmUgbGluZSBwZXIgcmVhbCBncm91cGluZyBhbmQgbmV2ZXIgb25lIHBlciBwYXRoIHNlZ21lbnQuXG4gKlxuICogVG90YWwgZm9yIGFueSB3ZWxsLWZvcm1lZCBgVHJlZUFuY2hvcltdYDogZGVnZW5lcmF0ZSBwYXRocyAocnVsZSBlbmZvcmNlZFxuICogaW4ge0BsaW5rIHNwbGl0U2VnbWVudHN9KSBhcmUgbm9ybWFsaXplZCB0byBhdG9taWMgbGVhdmVzIHJhdGhlciB0aGFuXG4gKiB0aHJvd24gb24sIHNvIHRoaXMgZnVuY3Rpb24gbmV2ZXIgbmVlZHMgYW4gaW50ZXJuYWwgdHJ5L2NhdGNoLiBDYWxsZXJzIGFkZFxuICogdGhlaXIgb3duIGNhdGNoIGFyb3VuZCB0aGlzIGNhbGwgaW4gYSBsYXRlciBwaGFzZSAoZmFpbC1vcGVuIGRpc2NpcGxpbmVcbiAqIGxpdmVzIGF0IHRoZSBjYWxsIHNpdGUsIG5vdCBoZXJlKS5cbiAqXG4gKiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlcyBhdCBtb3N0IG9uZSBgVHJlZUFuY2hvcmAgcGVyXG4gKiBkaXN0aW5jdCBgcGF0aGAgXHUyMDE0IHBhc3MgYW5jaG9ycyB0aHJvdWdoIHtAbGluayBjb2xsYXBzZUJ5UGF0aH0gZmlyc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJBbmNob3JUcmVlKGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3QgZm9yZXN0ID0gYnVpbGRGb3Jlc3QoYW5jaG9ycyk7XG4gIHJldHVybiByZW5kZXJOb2Rlcyhmb3Jlc3QsICcnKTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBCYXNoIHNwYW4gXHUyMTkyIHRvdWNoIHRyYW5zbGF0aW9uIGFuZCB0aGUgam9pbi1nYXRpbmcgZHJpdmVyIChwbGFuIFx1MDBBNzIsXG4gKiBcdTAwQTczIHN0ZXAgMikuIEJvdGggYWRhcHRlcnMgY29uc3VtZSB0aGlzIG1vZHVsZSBvbmNlIHRoZWlyIGR1cGxpY2F0ZSBCYXNoXG4gKiBzcGFuIGxvb3BzIGNvbGxhcHNlOiBpdCBvd25zIHRoZSBwZXItY29tbWFuZCB2ZXJkaWN0IHRocmVhZCBcdTIwMTQgcGFzcyBBXG4gKiBgZXZhbHVhdGVXcml0ZUdhdGVgIHN3ZWVwLCB0aGUgZXhwbGFuYXRpb24gbWFwLCB0aGUgam9pbiBmaWx0ZXIsIGFuZCBwYXNzIEJcbiAqIHBlci1zdXJ2aXZpbmctc3BhbiBgcnVuVG91Y2hIb29rYCBcdTIwMTQgcGx1cyB0aGUgd2hvbGUtY29tbWFuZCBgaW50ZXJydXB0ZWRgXG4gKiBnYXRlIChwbGFuIFx1MDBBNzQpLlxuICovXG5cbmltcG9ydCB0eXBlIHsgUmVzb2x2ZWRTcGFuLCBTcGFuTWF0Y2ggfSBmcm9tICcuL3BhcnNlLWNvbW1hbmQuanMnO1xuaW1wb3J0IHsgdHlwZSBNZW1vU3RvcmUsIHJlc29sdmVUb3VjaFNjb3BlIH0gZnJvbSAnLi9zcGFuLXN1cmZhY2UuanMnO1xuaW1wb3J0IHtcbiAgY3JlYXRlUmVhbGl0eVByb2JlQ2FjaGUsXG4gIGV2YWx1YXRlV3JpdGVHYXRlLFxuICBmaWxlRXhpc3RzLFxuICB0eXBlIFJlYWxpdHlQcm9iZUNhY2hlLFxuICBydW5Ub3VjaEhvb2ssXG4gIHR5cGUgVG91Y2hFeGVjdXRvcnMsXG4gIHR5cGUgVG91Y2hJbnB1dCxcbiAgdHlwZSBXcml0ZUdhdGVPdXRjb21lLFxuICB3b3JraW5nVHJlZUNoYW5nZWRcbn0gZnJvbSAnLi90b3VjaC1jb3JlLmpzJztcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIHJlc29sdmVkIHNwYW4gaW50byBhIGZ1bGx5LXR5cGVkIHtAbGluayBUb3VjaElucHV0fSBwZXIgdGhlXG4gKiBwbGFuIFx1MDBBNzIgdGFibGUsIG9yIGBudWxsYCB3aGVuIHRoZSBwYXRoIGZhaWxzIGByZXNvbHZlVG91Y2hTY29wZWAgXHUyMDE0IGNyb3NzLVxuICogcmVwbywgZ2l0aWdub3JlZCwgYW5kIHNwYW4tZG9jdW1lbnQgcGF0aHMgZmFpbCBjbG9zZWQuXG4gKlxuICogVGhlIHBvc3Qtc3RhdGUgZ2F0ZSBmaWVsZHMgdGhlIHNwYW4gY2FuIGRldGVybWluZSAoYHRhcmdldFN0YXRlYCwgYW5kXG4gKiBgcG9zdFN0YXRlYCBmb3IgYXBwZW5kcyBhbmQgZGVsZXRlcykgYXJlIHNldCBoZXJlOyBhIGxpdGVyYWwgb3ZlcndyaXRlIGJvZHlcbiAqIChgc3Bhbi53cml0dGVuYCBcdTIwMTQgdGhlIGZsYWctbGVzcyBgZWNob2AvYHByaW50ZmAgYD5gIGNhc2UpIHJpZGVzIGFzIHRoZVxuICogYGV4YWN0YCBwb3N0LWNvbnRlbnQgZXhwZWN0YXRpb24gc28gdGhlIGdhdGUgdmVyaWZpZXMgdGhlIHdyaXRlJ3MgZWZmZWN0XG4gKiB3aGlsZSB0aGUgdG91Y2ggaXRzZWxmIHN0YXlzIHdob2xlLWZpbGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gVHJ1bmNhdGVzIG1hcFxuICogdGhlIHNwYW4ncyBzdGF0aWNhbGx5IGV2YWx1YXRlZCBhYnNvbHV0ZSBgLXMgTmAgdG8gdGhlIGBzaXplYCBwb3N0LWNvbnRlbnRcbiAqIChgLXMgMGAgXHUyMTkyIGBlbXB0eWApOyBhIHRydW5jYXRlIHdpdGhvdXQgYSBzaXplIGdhdGVzIGV4aXN0ZW5jZS1vbmx5LiBUaGVcbiAqIGRyaXZlciBwYWlycyBjcC9pbnN0YWxsIGFuZCBtdiBzb3VyY2VzIG9udG8gdGhlIGRlc3RpbmF0aW9uIHRvdWNoZXNcbiAqIGFmdGVyd2FyZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhc2hTcGFuVG9Ub3VjaChzcGFuOiBSZXNvbHZlZFNwYW4sIHNlc3Npb25JZDogc3RyaW5nLCBjd2Q6IHN0cmluZyk6IFRvdWNoSW5wdXQgfCBudWxsIHtcbiAgaWYgKCFyZXNvbHZlVG91Y2hTY29wZShjd2QsIHNwYW4uYWJzb2x1dGVQYXRoKSkgcmV0dXJuIG51bGw7XG4gIHN3aXRjaCAoc3Bhbi5vcGVyYXRpb24pIHtcbiAgICBjYXNlICdyZWFkJzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICdyZWFkJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgb2Zmc2V0OiBzcGFuLmxpbmVTdGFydCxcbiAgICAgICAgbGltaXQ6XG4gICAgICAgICAgc3Bhbi5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCAmJiBzcGFuLmxpbmVFbmQgIT09IHVuZGVmaW5lZCA/IHNwYW4ubGluZUVuZCAtIHNwYW4ubGluZVN0YXJ0ICsgMSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdjcmVhdGUtb3ZlcndyaXRlJzpcbiAgICBjYXNlICdyZW5hbWUtY29weSc6XG4gICAgICAvLyBXaG9sZS1maWxlIHdyaXRlczogYHdyaXR0ZW46ICcnYCBzY29wZXMgdGhlIHRvdWNoIHRvIGV2ZXJ5IGNvdmVyaW5nXG4gICAgICAvLyBzcGFuIFx1MjAxNCB0cnVuY2F0aW5nIHdyaXRlcyBkZXN0cm95IGFuY2hvcnMgYmV5b25kIHRoZSBuZXcgRU9GICh0aGVcbiAgICAgIC8vIG1haW4tMjAwIEYyIGxlc3NvbikuIEEgbGl0ZXJhbCBib2R5IHJpZGVzIGFzIHRoZSBleGFjdCBwb3N0LWNvbnRlbnRcbiAgICAgIC8vIGV4cGVjdGF0aW9uIHNvIHRoZSBnYXRlIHZlcmlmaWVzIHRoZSB3cml0ZSdzIGVmZmVjdC5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHBvc3RTdGF0ZTogc3Bhbi53cml0dGVuICE9PSB1bmRlZmluZWQgPyB7IGNvbnRlbnQ6IHsgZXhhY3Q6IHNwYW4ud3JpdHRlbiB9IH0gOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAndHJ1bmNhdGUnOlxuICAgICAgLy8gU2FtZSB3aG9sZS1maWxlIHNjb3BlOyB0aGUgc2l6ZSBnYXRlIChwbGFuIFx1MDBBNzIsIFx1MDBBNzMgc3RlcCAxYikgdmVyaWZpZXNcbiAgICAgIC8vIHRoZSBwb3N0LWNvbW1hbmQgYnl0ZSBjb3VudCB3aGVuIHRoZSBzcGFuIGNhcnJpZXMgYSBzdGF0aWNhbGx5XG4gICAgICAvLyBldmFsdWF0ZWQgYWJzb2x1dGUgYC1zIE5gIChgLXMgMGAgXHUyMTkyIGVtcHR5KTsgd2l0aG91dCBvbmUgdGhlIGdhdGUgaXNcbiAgICAgIC8vIGV4aXN0ZW5jZS1vbmx5LlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcG9zdFN0YXRlOlxuICAgICAgICAgIHNwYW4uc2l6ZSA9PT0gMFxuICAgICAgICAgICAgPyB7IGNvbnRlbnQ6IHsgZW1wdHk6IHRydWUgfSB9XG4gICAgICAgICAgICA6IHNwYW4uc2l6ZSAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICAgID8geyBjb250ZW50OiB7IHNpemU6IHNwYW4uc2l6ZSB9IH1cbiAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnYXBwZW5kJzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46IHNwYW4ud3JpdHRlbiA/PyAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICBwb3N0U3RhdGU6IHNwYW4ud3JpdHRlbiAhPT0gdW5kZWZpbmVkID8geyBjb250ZW50OiB7IHN1ZmZpeDogc3Bhbi53cml0dGVuIH0gfSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdtb2RpZnknOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcmFuZ2U6IHNwYW4ubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgPyB7IHN0YXJ0OiBzcGFuLmxpbmVTdGFydCwgZW5kOiBzcGFuLmxpbmVFbmQgPz8gc3Bhbi5saW5lU3RhcnQgfSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdkZWxldGUnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnYWJzZW50JyxcbiAgICAgICAgcG9zdFN0YXRlOiB7IHJlYWxEZWxldGU6IHRydWUgfVxuICAgICAgfTtcbiAgfVxufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIEJhc2ggYHRvb2xfcmVzcG9uc2VgIHNpZ25hbHMgdGhhdCB0aGUgY29tbWFuZCB3YXMgaW50ZXJydXB0ZWRcbiAqIChwbGFuIFx1MDBBNzQpLiBUaGUgU0RLIHR5cGVzIHRoZSByZXNwb25zZSBgdW5rbm93bmAgb24gYm90aCBhZGFwdGVycywgc28gdGhpc1xuICogaXMgYSBkZWZlbnNpdmUgcnVudGltZSBzaGFwZS1wcm9iZTogYW4gb2JqZWN0IGNhcnJ5aW5nIGEgdHJ1dGh5XG4gKiBgaW50ZXJydXB0ZWRgIGZpZWxkIGNsYXNzaWZpZXMgYXMgaW50ZXJydXB0ZWQ7IGFueSBvdGhlciBzaGFwZSAoc3RyaW5nLFxuICogbnVsbCwgb2JqZWN0IHdpdGhvdXQgdGhlIGZpZWxkKSBwcm9jZWVkcyBmYWlsLW9wZW4sIG1hdGNoaW5nIHRvZGF5J3NcbiAqIGJlaGF2aW9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQodG9vbFJlc3BvbnNlOiB1bmtub3duKTogYm9vbGVhbiB7XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gQm9vbGVhbigodG9vbFJlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5pbnRlcnJ1cHRlZCk7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIFRoZSBCYXNoIGB0b29sX3Jlc3BvbnNlYCdzIHByb2Nlc3MgZXhpdCBjb2RlLCB3aGVuIHRoZSBoYXJuZXNzIHN1cHBsaWVzXG4gKiBvbmUuIFRoZSBTREsgdHlwZXMgdGhlIHJlc3BvbnNlIGB1bmtub3duYCBvbiBib3RoIGFkYXB0ZXJzIGFuZCBDbGF1ZGUnc1xuICogQmFzaCBlbnZlbG9wZXMgZG8gbm90IGN1cnJlbnRseSBjYXJyeSBhbiBgZXhpdF9jb2RlYCBmaWVsZCwgc28gdGhpcyBpcyBhXG4gKiBkZWZlbnNpdmUgc2hhcGUtcHJvYmUgd2l0aCB0aGUgcGxhbiBcdTAwQTc0IGZhaWwtb3BlbiBwb3N0dXJlOiBwcmVzZW50IFx1MjE5MiB0aGVcbiAqIGludGVnZXIgY29kZSwgYWJzZW50IG9yIGFueSBvdGhlciBzaGFwZSBcdTIxOTIgdW5kZWZpbmVkLCBhbmQgdGhlIGNhbGxlclxuICogcHJvY2VlZHMgZXhhY3RseSBhcyB0b2RheS4gKFRoZSBob29rIHN1YnByb2Nlc3MncyBvd24gZXhpdCBzdGF0dXMgXHUyMDE0IHRoZVxuICogU0RLJ3MgYFNES0hvb2tSZXNwb25zZU1lc3NhZ2UuZXhpdF9jb2RlYCBcdTIwMTQgaXMgYSBkaWZmZXJlbnQgY2hhbm5lbCBhbmQgaXNcbiAqIG5ldmVyIHJlYWQgaGVyZS4pXG4gKlxuICogR3JhbnVsYXJpdHkgZWRnZSAoZG9jdW1lbnRlZCByZXNpZHVlKTogdGhlIGNvZGUgaXMgdGhlIHdob2xlIGNvbXBvdW5kXG4gKiBjb21tYW5kJ3MsIG5vdCBvbmUgc2ltcGxlIGNvbW1hbmQncyBcdTIwMTQgYSBtYXNrZWQgZmFpbHVyZSAoYGdpdCBhcHBseVxuICogcC5kaWZmIHx8IGVjaG8gb2tgIGV4aXRpbmcgMCkgc3VwcHJlc3NlcyBub3RoaW5nLCBhbmQgYSB0cmFpbGluZyBmYWlsdXJlXG4gKiAoYHNlZCAtaSBzL2EvYi8gZjsgZmFsc2VgIGV4aXRpbmcgMSkgc3VwcHJlc3NlcyB0aGUgZWFybGllciByZWFsIHdyaXRlLlxuICogQW5kIHRoZSBcImZhaWxlZCwgc28gdGhlIHdyaXRlIGRpZCBub3QgaGFwcGVuXCIgcHJlbWlzZSBiZWhpbmQgdGhlXG4gKiBzdXBwcmVzc2lvbiBob2xkcyBmb3IgYXRvbWljIGZhaWx1cmVzIChgZ2l0IGFwcGx5YCB3aXRob3V0IGAtLXJlamVjdGAsXG4gKiBwcmV0dGllciBvbiBhIHN5bnRheCBlcnJvcikgYnV0IG92ZXItc3VwcHJlc3NlcyB0aGUgbm9uLWF0b21pYyB3cml0ZXJzXG4gKiB0aGF0IG1vZGlmeSBiZWZvcmUgZmFpbGluZyBcdTIwMTQgR05VIGBwYXRjaGAgYXBwbHlpbmcgZWFybGllciBodW5rcywgYGdpdFxuICogYXBwbHkgLS1yZWplY3RgIHdyaXRpbmcgdGhlIGFwcGxpY2FibGUgaHVua3MgcGx1cyBgLnJlamAgZmlsZXMsIGFuZFxuICogZm9ybWF0dGVycyAoYGVzbGludCAtLWZpeGAsIGBydWJvY29wIC1hYCkgd3JpdGluZyB0aGVpciBmaXhlcyBiZWZvcmVcbiAqIGV4aXRpbmcgbm9uemVybyBvbiByZW1haW5pbmcgdmlvbGF0aW9ucy4gVGhhdCB3cm90ZS1idXQtbm9uemVybyBjb3JuZXIgaXNcbiAqIGFjY2VwdGVkIGFuZCBwaW5uZWQgYnkgdGhlIGdhdGUncyB0ZXN0cyByYXRoZXIgdGhhbiBjYXJ2ZWQgb3V0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzaFJlc3BvbnNlRXhpdENvZGUodG9vbFJlc3BvbnNlOiB1bmtub3duKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHRvb2xSZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnb2JqZWN0Jykge1xuICAgIGNvbnN0IGNvZGUgPSAodG9vbFJlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5leGl0X2NvZGU7XG4gICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJyAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvZGUpKSByZXR1cm4gY29kZTtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBwZXItY29tbWFuZCB2ZXJkaWN0IGRyaXZlciAocGxhbiBcdTAwQTczIHN0ZXAgMilcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50eXBlIFJlc29sdmVkTWF0Y2ggPSBFeHRyYWN0PFNwYW5NYXRjaCwgeyBzdGF0dXM6ICdyZXNvbHZlZCcgfT47XG50eXBlIEd1YXJkTWF0Y2ggPSBFeHRyYWN0PFNwYW5NYXRjaCwgeyBzdGF0dXM6ICdidWlsdGluLWd1YXJkJyB9PjtcblxudHlwZSBWZXJkaWN0ID0gJ2ZhaWxlZCcgfCAnc3VjY2VlZGVkJyB8ICd1bmtub3duJztcblxuLyoqXG4gKiBGaWxlLXByb2R1Y2luZyB3cml0ZSBvcGVyYXRpb25zIFx1MjAxNCB0aGUgb25seSBzcGFucyB0aGF0IGNhbiBleHBsYWluIGFcbiAqIGRlbGV0ZSdzIGRlY2lzaXZlRmFpbCBieSByZS1jcmVhdGluZyBpdHMgcGF0aCBsYXRlciBpbiB0aGUgY29tcG91bmQgKHBsYW5cbiAqIFx1MDBBNzMgc3RlcCAyLCByb3VuZC0zKS4gYG1vZGlmeWAgKHNlZCAtaSBhbmQgZnJpZW5kcykgZGVsaWJlcmF0ZWx5IGNhbm5vdDpcbiAqIGl0IG5ldmVyIGNyZWF0ZXMgYSBtaXNzaW5nIGZpbGUsIHNvIGFuIGVuZC1zdGF0ZS1wcmVzZW50IHBhdGggYWZ0ZXIgYVxuICogZmFpbGVkIGBybWAgaXMgbmV2ZXIgaXRzIGRvaW5nLlxuICovXG5jb25zdCBGSUxFX1BST0RVQ0lOR19PUFM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFsnY3JlYXRlLW92ZXJ3cml0ZScsICdyZW5hbWUtY29weScsICd0cnVuY2F0ZScsICdhcHBlbmQnXSk7XG5cbi8qKiBPbmUgcGFzcy1BIGV2YWx1YXRpb246IHRoZSBzcGFuLCBpdHMgdG91Y2gsIGFuZCB0aGUgKHBvc3QtcmVzb2x1dGlvbikgZ2F0ZSBvdXRjb21lLiAqL1xuaW50ZXJmYWNlIFNwYW5FdmFsIHtcbiAgbWF0Y2g6IFJlc29sdmVkTWF0Y2g7XG4gIC8qKiBUaGUgdHJhbnNsYXRlZCB0b3VjaCwgb3IgYG51bGxgIHdoZW4gdGhlIHNwYW4gZmFpbGVkIGByZXNvbHZlVG91Y2hTY29wZWAuICovXG4gIHRvdWNoOiBUb3VjaElucHV0IHwgbnVsbDtcbiAgLyoqIFRoZSBwYXNzLUEgZ2F0ZSBvdXRjb21lLCBwb3N0LXJlc29sdXRpb24gZm9yIGAncGVuZGluZydgIGFuZCBleHBsYWluZWQgZmFpbHMuICovXG4gIG91dGNvbWU6IFdyaXRlR2F0ZU91dGNvbWU7XG4gIC8qKiBBIGRlY2lzaXZlRmFpbCBkb3duZ3JhZGVkIGJ5IGEgbGF0ZXIgc2FtZS1wYXRoIGRlY2lzaXZlUGFzcyAocGxhbiBcdTAwQTczIHN0ZXAgMikuICovXG4gIGV4cGxhaW5lZDogYm9vbGVhbjtcbiAgY29tbWFuZEluZGV4OiBudW1iZXI7XG4gIC8qKiBUaGUgc3BhbidzIG93biBwYXRoIFx1MjAxNCB0aGUgZXhwbGFuYXRpb24ga2V5IGZvciBkZWNpc2l2ZSBmYWlscy4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKiogY3AgZGVzdGluYXRpb25zOiB0aGUgcGFpcmVkIHNvdXJjZSBwYXRoIFx1MjAxNCB0aGUgZXhwbGFuYXRpb24ga2V5IGZvciBwZW5kaW5ncy4gKi9cbiAgc291cmNlS2V5OiBzdHJpbmcgfCBudWxsO1xufVxuXG4vKipcbiAqIEV2YWx1YXRlIG9uZSBzcGFuJ3MgZ2F0ZS4gUmVhZHMgaGF2ZSBubyBnYXRlIFx1MjE5MiBgJ2luY29uY2x1c2l2ZSdgLCB3aXRoIG9uZVxuICogZXhjZXB0aW9uOiBjcC9pbnN0YWxsIHNvdXJjZSByZWFkcyBnYXRlIG9uIHRoZSBzb3VyY2UgZXhpc3RpbmcgcG9zdC1jb21tYW5kXG4gKiAocGxhbiBcdTAwQTcyKSBcdTIwMTQgYSBmYWlsZWQgY29weSBuZXZlciByZWFkIGFueXRoaW5nLiBUaGUgcmVhZCB2ZXJkaWN0IGZsaXBzIG9ubHlcbiAqIHRoZSBjb21tYW5kJ3Mgam9pbiB2ZXJkaWN0LCBuZXZlciB0aGUgc2FtZSBjb21tYW5kJ3MgZGVzdCB3cml0ZS5cbiAqL1xuZnVuY3Rpb24gZXZhbFNwYW5HYXRlKG1hdGNoOiBSZXNvbHZlZE1hdGNoLCB0b3VjaDogVG91Y2hJbnB1dCB8IG51bGwsIHByb2JlQ2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlKTogV3JpdGVHYXRlT3V0Y29tZSB7XG4gIGlmICh0b3VjaCA9PT0gbnVsbCkgcmV0dXJuICdpbmNvbmNsdXNpdmUnO1xuICBpZiAodG91Y2gua2luZCA9PT0gJ3JlYWQnKSB7XG4gICAgaWYgKChtYXRjaC5pZGlvbSA9PT0gJ2NwLXdyaXRlJyB8fCBtYXRjaC5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSAmJiBtYXRjaC5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlYWQnKSB7XG4gICAgICByZXR1cm4gZmlsZUV4aXN0cyhtYXRjaC5zcGFuLmFic29sdXRlUGF0aCkgPyAnaW5jb25jbHVzaXZlJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICAgIH1cbiAgICByZXR1cm4gJ2luY29uY2x1c2l2ZSc7XG4gIH1cbiAgcmV0dXJuIGV2YWx1YXRlV3JpdGVHYXRlKHRvdWNoLCBwcm9iZUNhY2hlKTtcbn1cblxuLyoqIFRoZSBvcGVyYXRvciBwcmVjZWRpbmcgYSBjb21tYW5kLCBmcm9tIGl0cyBmaXJzdCBzcGFuIChhbGwgc3BhbnMgb2Ygb25lIGNvbW1hbmQgc2hhcmUgaXQpIFx1MjAxNCBvciBmcm9tIGl0cyBndWFyZCBtYXRjaCB3aGVuIHRoZSBjb21tYW5kIGhhcyBubyBzcGFucy4gKi9cbmZ1bmN0aW9uIGpvaW5PZkNvbW1hbmQoXG4gIGlkeDogbnVtYmVyLFxuICBncm91cHM6IE1hcDxudW1iZXIsIFJlc29sdmVkTWF0Y2hbXT4sXG4gIGd1YXJkQnlJbmRleDogTWFwPG51bWJlciwgR3VhcmRNYXRjaD5cbik6ICcmJicgfCAnfHwnIHwgdW5kZWZpbmVkIHtcbiAgY29uc3Qgc3BhbnMgPSBncm91cHMuZ2V0KGlkeCk7XG4gIGlmIChzcGFucyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgZm9yIChjb25zdCBtIG9mIHNwYW5zKSB7XG4gICAgICBpZiAobS5zcGFuLmpvaW4gIT09IHVuZGVmaW5lZCkgcmV0dXJuIG0uc3Bhbi5qb2luO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBndWFyZEJ5SW5kZXguZ2V0KGlkeCk/LmpvaW47XG59XG5cbi8qKlxuICogU2hhcmVkIEJhc2ggZHJpdmVyIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogb3ducyB0aGUgcGVyLWNvbW1hbmQgdmVyZGljdCB0aHJlYWQgXHUyMDE0XG4gKiBwYXNzIEEgYGV2YWx1YXRlV3JpdGVHYXRlYCBzd2VlcCAoZXZlcnkgc3BhbiwgYmVmb3JlIGFueSBqb2luIGRlY2lzaW9uKSxcbiAqIHRoZSBleHBsYW5hdGlvbiBtYXAsIHBlci1jb21tYW5kIHZlcmRpY3RzLCB0aGUgam9pbiBmaWx0ZXIgd2l0aCBjaGFpbmVkXG4gKiBza2lwcywgYW5kIHBhc3MgQiBwZXItc3Vydml2aW5nLXNwYW4gYHJ1blRvdWNoSG9va2AgXHUyMDE0IHBsdXMgdGhlIHdob2xlLWNvbW1hbmRcbiAqIGBpbnRlcnJ1cHRlZGAgYW5kIGV4aXQtY29kZSBnYXRlcyAocGxhbiBcdTAwQTc0KSBhbmQgdGhlIHNwYW4tbGVzcy1ndWFyZFxuICogY29tbWFuZHMgKGBmYWxzZWAvYHRydWVgL2A6YCBqb2luIHZlcmRpY3RzIHdpdGggbm8gc3BhbnMgb2YgdGhlaXIgb3duKS5cbiAqIFJldHVybnMgdGhlIG5vbi1udWxsIGBhZGRpdGlvbmFsQ29udGV4dGAgYmxvY2tzIGZvciB0aGUgYWRhcHRlciB0byBqb2luO1xuICogdGhlIHNlc3Npb24gbWVtbyBkZWR1cHMgcmVwZWF0ZWQgdGFyZ2V0cy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1bkJhc2hUb3VjaGVzKFxuICBtYXRjaGVzOiBTcGFuTWF0Y2hbXSxcbiAgc2Vzc2lvbklkOiBzdHJpbmcsXG4gIGN3ZDogc3RyaW5nLFxuICB0b29sUmVzcG9uc2U6IHVua25vd24sXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgd2FybjogKG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZCA9IGNvbnNvbGUud2FyblxuKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAvLyBBIGNvbW1hbmQgdGhhdCBkaWQgbm90IGNvbXBsZXRlIHByb2R1Y2VzIG5vIHRvdWNoZXMsIHdoYXRldmVyIGl0cyBzcGFucy5cbiAgaWYgKGJhc2hSZXNwb25zZUludGVycnVwdGVkKHRvb2xSZXNwb25zZSkpIHJldHVybiBbXTtcbiAgY29uc3QgZXhpdENvZGUgPSBiYXNoUmVzcG9uc2VFeGl0Q29kZSh0b29sUmVzcG9uc2UpO1xuICBjb25zdCByZXNvbHZlZCA9IG1hdGNoZXMuZmlsdGVyKChtKTogbSBpcyBSZXNvbHZlZE1hdGNoID0+IG0uc3RhdHVzID09PSAncmVzb2x2ZWQnKTtcbiAgY29uc3QgZ3VhcmRzID0gbWF0Y2hlcy5maWx0ZXIoKG0pOiBtIGlzIEd1YXJkTWF0Y2ggPT4gbS5zdGF0dXMgPT09ICdidWlsdGluLWd1YXJkJyk7XG4gIGlmIChyZXNvbHZlZC5sZW5ndGggPT09IDApIHJldHVybiBbXTtcblxuICAvLyBTZWVkIHRoZSBwZXItY29tbWFuZCBwcm9iZSBjYWNoZSAocGxhbiBcdTAwQTczIHN0ZXAgMWMpIHdpdGggZXZlcnkgYWJzZW50XG4gIC8vIHRhcmdldCBhbmQgY3AvaW5zdGFsbCBzb3VyY2Ugb2YgdGhlIGNvbXBvdW5kOyB0aGUgZmlyc3QgZ2F0ZSB0aGF0IG5lZWRzXG4gIC8vIGl0IHJ1bnMgb25lIGxzLWZpbGVzICsgb25lIHNwYW4tbGlzdCBiYXRjaCBmb3IgYWxsIG9mIHRoZW0uIFRoZVxuICAvLyBsYXRlci1yZWNyZWF0ZSBleHBsYW5hdGlvbidzIHByb2JlIHNjb3BlIChyb3VuZC0zKSByaWRlcyBhbG9uZ3NpZGU6IHRoZVxuICAvLyBkZWxldGUgcGF0aHMgYSBsYXRlciBjb21tYW5kIGNhbiByZS1jcmVhdGUgd2l0aCBhIGZpbGUtcHJvZHVjaW5nIHdyaXRlIFx1MjAxNFxuICAvLyB0aGVpciB3b3JraW5nLXRyZWUtdnMtaW5kZXggc3RhdHVzIGlzIHRoZSByZS1jcmVhdGUncyBtYXJrLCByZWFkIG9uY2UgaW5cbiAgLy8gb25lIGBnaXQgc3RhdHVzYCBiYXRjaC5cbiAgY29uc3QgcHJvYmVQYXRoczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgZmlsZVByb2R1Y2luZ0J5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXJbXT4oKTtcbiAgZm9yIChjb25zdCBtIG9mIHJlc29sdmVkKSB7XG4gICAgaWYgKG0uc3Bhbi5vcGVyYXRpb24gPT09ICdkZWxldGUnKSBwcm9iZVBhdGhzLnB1c2gobS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgZWxzZSBpZiAoKG0uaWRpb20gPT09ICdjcC13cml0ZScgfHwgbS5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSAmJiBtLnNwYW4ub3BlcmF0aW9uID09PSAncmVhZCcpIHtcbiAgICAgIHByb2JlUGF0aHMucHVzaChtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICB9IGVsc2UgaWYgKEZJTEVfUFJPRFVDSU5HX09QUy5oYXMobS5zcGFuLm9wZXJhdGlvbikpIHtcbiAgICAgIGNvbnN0IGxpc3QgPSBmaWxlUHJvZHVjaW5nQnlQYXRoLmdldChtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICAgIGlmIChsaXN0ICE9PSB1bmRlZmluZWQpIGxpc3QucHVzaChtLnNwYW4uc2ltcGxlQ29tbWFuZEluZGV4KTtcbiAgICAgIGVsc2UgZmlsZVByb2R1Y2luZ0J5UGF0aC5zZXQobS5zcGFuLmFic29sdXRlUGF0aCwgW20uc3Bhbi5zaW1wbGVDb21tYW5kSW5kZXhdKTtcbiAgICB9XG4gIH1cbiAgY29uc3QgcmVjcmVhdGVQcm9iZVBhdGhzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgcmVzb2x2ZWQpIHtcbiAgICBpZiAobS5zcGFuLm9wZXJhdGlvbiAhPT0gJ2RlbGV0ZScpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGxhdGVyID0gKGZpbGVQcm9kdWNpbmdCeVBhdGguZ2V0KG0uc3Bhbi5hYnNvbHV0ZVBhdGgpID8/IFtdKS5zb21lKChpKSA9PiBpID4gbS5zcGFuLnNpbXBsZUNvbW1hbmRJbmRleCk7XG4gICAgaWYgKGxhdGVyKSByZWNyZWF0ZVByb2JlUGF0aHMucHVzaChtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgfVxuICBjb25zdCBwcm9iZUNhY2hlID0gY3JlYXRlUmVhbGl0eVByb2JlQ2FjaGUocHJvYmVQYXRocywgcmVjcmVhdGVQcm9iZVBhdGhzKTtcblxuICAvLyBHcm91cCBieSBzaW1wbGUgY29tbWFuZCBpbiB3YWxrZXIgb3JkZXIuIFNwYW4tbGVzcyBndWFyZCBjb21tYW5kc1xuICAvLyAoYGZhbHNlYC9gdHJ1ZWAvYDpgKSBqb2luIHRoZSBvcmRlciB3aXRoIG5vIGdyb3VwOiB0aGVpciBkZXRlcm1pbmlzdGljXG4gIC8vIGV4aXQgc3RhdHVzIGRyaXZlcyB0aGUgam9pbiBmaWx0ZXIsIGFuZCB0aGV5IG5ldmVyIHRvdWNoIGFueXRoaW5nLlxuICBjb25zdCBncm91cHMgPSBuZXcgTWFwPG51bWJlciwgUmVzb2x2ZWRNYXRjaFtdPigpO1xuICBjb25zdCBndWFyZEJ5SW5kZXggPSBuZXcgTWFwPG51bWJlciwgR3VhcmRNYXRjaD4oKTtcbiAgY29uc3QgY29tbWFuZE9yZGVyOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgcmVzb2x2ZWQpIHtcbiAgICBjb25zdCBpZHggPSBtLnNwYW4uc2ltcGxlQ29tbWFuZEluZGV4O1xuICAgIGNvbnN0IGxpc3QgPSBncm91cHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgIT09IHVuZGVmaW5lZCkge1xuICAgICAgbGlzdC5wdXNoKG0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBncm91cHMuc2V0KGlkeCwgW21dKTtcbiAgICAgIGNvbW1hbmRPcmRlci5wdXNoKGlkeCk7XG4gICAgfVxuICB9XG4gIGZvciAoY29uc3QgZyBvZiBndWFyZHMpIHtcbiAgICBpZiAoZ3JvdXBzLmhhcyhnLnNpbXBsZUNvbW1hbmRJbmRleCkgfHwgZ3VhcmRCeUluZGV4LmhhcyhnLnNpbXBsZUNvbW1hbmRJbmRleCkpIGNvbnRpbnVlO1xuICAgIGd1YXJkQnlJbmRleC5zZXQoZy5zaW1wbGVDb21tYW5kSW5kZXgsIGcpO1xuICAgIGNvbW1hbmRPcmRlci5wdXNoKGcuc2ltcGxlQ29tbWFuZEluZGV4KTtcbiAgfVxuICBjb21tYW5kT3JkZXIuc29ydCgoYSwgYikgPT4gYSAtIGIpO1xuXG4gIC8vIFBhc3MgQTogdHJhbnNsYXRlIGV2ZXJ5IHNwYW4gb25jZSBhbmQgZXZhbHVhdGUgaXRzIGdhdGUsIHBhaXJpbmdcbiAgLy8gY3AvaW5zdGFsbCBzb3VyY2VzIHdpdGggZGVzdGluYXRpb25zIGFuZCBtdiBkZWxldGVzIHdpdGggcmVuYW1lLWNvcGllcyBieVxuICAvLyBkZWNsYXJhdGlvbiBvcmRlciAodGhlIHBhcnNlciBlbWl0cyBzb3VyY2VzIGJlZm9yZSBkZXN0aW5hdGlvbnMpLlxuICBjb25zdCBldmFscyA9IG5ldyBNYXA8bnVtYmVyLCBTcGFuRXZhbFtdPigpO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBzcGFucyA9IGdyb3Vwcy5nZXQoaWR4KTtcbiAgICBpZiAoc3BhbnMgPT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIGd1YXJkLW9ubHkgY29tbWFuZCBcdTIwMTQgbm90aGluZyB0byBldmFsdWF0ZVxuICAgIGNvbnN0IHJlYWRQYXRocyA9IHNwYW5zXG4gICAgICAuZmlsdGVyKChtKSA9PiAobS5pZGlvbSA9PT0gJ2NwLXdyaXRlJyB8fCBtLmlkaW9tID09PSAnaW5zdGFsbC13cml0ZScpICYmIG0uc3Bhbi5vcGVyYXRpb24gPT09ICdyZWFkJylcbiAgICAgIC5tYXAoKG0pID0+IG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIGNvbnN0IGRlbGV0ZVBhdGhzID0gc3BhbnMuZmlsdGVyKChtKSA9PiBtLnNwYW4ub3BlcmF0aW9uID09PSAnZGVsZXRlJykubWFwKChtKSA9PiBtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICBsZXQgcmVhZEN1cnNvciA9IDA7XG4gICAgbGV0IGRlbGV0ZUN1cnNvciA9IDA7XG4gICAgY29uc3QgbGlzdDogU3BhbkV2YWxbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgbSBvZiBzcGFucykge1xuICAgICAgY29uc3QgdG91Y2ggPSBiYXNoU3BhblRvVG91Y2gobS5zcGFuLCBzZXNzaW9uSWQsIGN3ZCk7XG4gICAgICBjb25zdCBlbnRyeTogU3BhbkV2YWwgPSB7XG4gICAgICAgIG1hdGNoOiBtLFxuICAgICAgICB0b3VjaCxcbiAgICAgICAgb3V0Y29tZTogJ2luY29uY2x1c2l2ZScsXG4gICAgICAgIGV4cGxhaW5lZDogZmFsc2UsXG4gICAgICAgIGNvbW1hbmRJbmRleDogaWR4LFxuICAgICAgICBwYXRoOiBtLnNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICBzb3VyY2VLZXk6IG51bGxcbiAgICAgIH07XG4gICAgICBpZiAodG91Y2ggIT09IG51bGwgJiYgdG91Y2gua2luZCA9PT0gJ3dyaXRlJykge1xuICAgICAgICBpZiAobS5zcGFuLm9wZXJhdGlvbiA9PT0gJ2NyZWF0ZS1vdmVyd3JpdGUnICYmIChtLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG0uaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykpIHtcbiAgICAgICAgICBjb25zdCBzb3VyY2UgPSByZWFkUGF0aHNbcmVhZEN1cnNvcl07XG4gICAgICAgICAgaWYgKHNvdXJjZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZWFkQ3Vyc29yICs9IDE7XG4gICAgICAgICAgICAvLyBgaW5zdGFsbCAtc2AvYC0tc3RyaXBgIGlzIGRlbGliZXJhdGVseSBuZXZlciBwYWlyZWQ6IHN0cmlwcGVkXG4gICAgICAgICAgICAvLyBvdXRwdXQgbmV2ZXIgZXF1YWxzIHRoZSBzb3VyY2UsIHNvIGluc3RhbGwgZGVzdHMgZ2F0ZVxuICAgICAgICAgICAgLy8gZXhpc3RlbmNlLW9ubHkgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS5cbiAgICAgICAgICAgIGlmIChtLmlkaW9tID09PSAnY3Atd3JpdGUnKSB7XG4gICAgICAgICAgICAgIHRvdWNoLnNvdXJjZVBhdGggPSBzb3VyY2U7XG4gICAgICAgICAgICAgIGVudHJ5LnNvdXJjZUtleSA9IHNvdXJjZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAobS5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlbmFtZS1jb3B5Jykge1xuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IGRlbGV0ZVBhdGhzW2RlbGV0ZUN1cnNvcl07XG4gICAgICAgICAgaWYgKHNvdXJjZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkZWxldGVDdXJzb3IgKz0gMTtcbiAgICAgICAgICAgIHRvdWNoLnJlbmFtZVNvdXJjZVBhdGggPSBzb3VyY2U7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBlbnRyeS5vdXRjb21lID0gZXZhbFNwYW5HYXRlKG0sIHRvdWNoLCBwcm9iZUNhY2hlKTtcbiAgICAgIGxpc3QucHVzaChlbnRyeSk7XG4gICAgfVxuICAgIGV2YWxzLnNldChpZHgsIGxpc3QpO1xuICB9XG5cbiAgLy8gVGhlIGV4cGxhbmF0aW9uIG1hcCAocGxhbiBcdTAwQTczIHN0ZXAgMik6IHRoZSBoaWdoZXN0IHNpbXBsZUNvbW1hbmRJbmRleCB3aXRoXG4gIC8vIGEgZGVjaXNpdmVQYXNzIG9uIGVhY2ggcGF0aC5cbiAgY29uc3QgcGFzc0J5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBmb3IgKGNvbnN0IGUgb2YgbGlzdCkge1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlUGFzcycpIHtcbiAgICAgICAgY29uc3QgcHJldiA9IHBhc3NCeVBhdGguZ2V0KGUucGF0aCk7XG4gICAgICAgIGlmIChwcmV2ID09PSB1bmRlZmluZWQgfHwgaWR4ID4gcHJldikgcGFzc0J5UGF0aC5zZXQoZS5wYXRoLCBpZHgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFJlc29sdmUgdGhlIGFic2VudC1zb3VyY2UgaG9sZHMgYWdhaW5zdCB0aGUgbm93LWNvbXBsZXRlIG1hcCwgYW5kXG4gIC8vIGRvd25ncmFkZSBleHBsYWluZWQgZmFpbHM6IGEgZGVjaXNpdmVGYWlsIG9uIGEgcGF0aCBhIGxhdGVyIGNvbW1hbmRcbiAgLy8gZGVtb25zdHJhYmx5IHJld3JvdGUgb3IgZGVsZXRlZCBpcyB0aGUgb3ZlcndyaXRlLCBub3QgdGhlIGVhcmxpZXIgY29tbWFuZFxuICAvLyBmYWlsaW5nIChwbGFuIFx1MDBBNzMgc3RlcCAyKS5cbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAncGVuZGluZycpIHtcbiAgICAgICAgY29uc3QgcGFzc0lkeCA9IGUuc291cmNlS2V5ICE9PSBudWxsID8gcGFzc0J5UGF0aC5nZXQoZS5zb3VyY2VLZXkpIDogdW5kZWZpbmVkO1xuICAgICAgICBlLm91dGNvbWUgPSBwYXNzSWR4ICE9PSB1bmRlZmluZWQgJiYgcGFzc0lkeCA+IGUuY29tbWFuZEluZGV4ID8gJ2RlY2lzaXZlUGFzcycgOiAnZGVjaXNpdmVGYWlsJztcbiAgICAgIH0gZWxzZSBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJykge1xuICAgICAgICBjb25zdCBwYXNzSWR4ID0gcGFzc0J5UGF0aC5nZXQoZS5wYXRoKTtcbiAgICAgICAgaWYgKHBhc3NJZHggIT09IHVuZGVmaW5lZCAmJiBwYXNzSWR4ID4gZS5jb21tYW5kSW5kZXgpIGUuZXhwbGFpbmVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBUaGUgbGF0ZXItcmVjcmVhdGUgZXhwbGFuYXRpb24gKHJvdW5kLTMsIG1hcmsgd2lkZW5lZCByb3VuZC00KTogYVxuICAvLyBkZWxldGUncyBkZWNpc2l2ZUZhaWwgXHUyMDE0IFwiZmlsZSBwcmVzZW50LCBzbyB0aGUgZGVsZXRlIGRpZG4ndCBoYXBwZW5cIiBcdTIwMTQgaXNcbiAgLy8gYWxzbyBleHBsYWluZWQgd2hlbiBhIExBVEVSIGNvbW1hbmQgd3JpdGVzIHRoZSBzYW1lIHBhdGggd2l0aCBhXG4gIC8vIGZpbGUtcHJvZHVjaW5nIG9wZXJhdGlvbiB3aG9zZSBvd24gZ2F0ZSBkaWQgbm90IGZhaWwgKGEgZGVjaXNpdmVGYWlsXG4gIC8vIHRoZXJlIHByb3ZlcyB0aGUgd3JpdGUgZGlkbid0IGhhcHBlbikgQU5EIHRoZSBwYXRoIGNhcnJpZXMgYW55IHRyYWNrZWRcbiAgLy8gc3RhdHVzIHJvdyBcdTIwMTQgaW5kZXggY29sdW1uIG9yIHdvcmt0cmVlIGNvbHVtbiwgcmVhZCBmcm9tIHRoZSBwZXItY29tbWFuZFxuICAvLyBwcm9iZSAoc2VlIHRoZSBwcm9iZSdzIHBlci1jb2x1bW4gcmVhc29uaW5nKS4gQSBmaWxlIHdpdGggTk8gc3RhdHVzIHJvd1xuICAvLyBtZWFucyBpdCBzdGlsbCBtYXRjaGVzIEhFQUQ6IHRoZSBjaGFpbiBzaG9ydC1jaXJjdWl0ZWQgYmVmb3JlIHRoZSB3cml0ZVxuICAvLyAodGhlIHJtIGZhaWxlZCBhbmQgYCYmYCBkcm9wcGVkIHRoZSByZXN0KSwgc28gdGhlIGZhaWwgc3RhbmRzIGFuZCB0aGVcbiAgLy8gam9pbiBmaWx0ZXIgc3RpbGwgc3VwcHJlc3NlcyB0aGUgam9pbmVkIGNvbW1hbmQuIFRoZSBpbmRleCBjb2x1bW4gaXNcbiAgLy8gd2hhdCBzZXBhcmF0ZXMgdGhlIHR3byByZWFsaXRpZXMgYSBjbGVhbiB3b3JrdHJlZSBjYW5ub3Q6IGBybSBmICYmIHBhdGNoXG4gIC8vIC1wMCA8IGQgJiYgZ2l0IGFkZCBmYCBlbmRzIHdpdGggZiBzdGFnZWQgKGBNIGAgcm93LCBibGFuayB3b3JrdHJlZVxuICAvLyBjb2x1bW4pIFx1MjAxNCB0aGUgd3JpdGUgcmFuIGFuZCB3YXMgdmVyaWZpZWQgaW50byB0aGUgaW5kZXggXHUyMDE0IHdoaWxlIGFcbiAgLy8gZ2VudWluZWx5IGZhaWxlZCBybSBsZWF2ZXMgbm8gcm93IGF0IGFsbC4gVGhpcyBpcyB0aGUgZXhpc3RlbmNlLWdhdGVkXG4gIC8vIHNpYmxpbmcgb2YgdGhlIGRlY2lzaXZlUGFzcyBleHBsYW5hdGlvbiBhYm92ZTogYHJtIGYgJiYgcGF0Y2ggLXAwIDxcbiAgLy8gbmV3LmRpZmZgIGVuZHMgd2l0aCBmIHByZXNlbnQgYmVjYXVzZSB0aGUgcGF0Y2ggcmUtY3JlYXRlZCBpdCwgbm90XG4gIC8vIGJlY2F1c2UgdGhlIHJtIGZhaWxlZCwgYW5kIHRoZSBwYXRjaCdzIGdhdGUgaXMgaW5jb25jbHVzaXZlIFx1MjAxNCBvbmx5IHRoaXNcbiAgLy8gcnVsZSBjYW4gc2VlIHRoZSByZS1jcmVhdGUuIENvbnRlbnQtdmVyaWZpZWQgcmUtY3JlYXRlcyAoZWNoby9jcC9cbiAgLy8gdHJ1bmNhdGUgd2l0aCBhIGJvZHkpIG5ldmVyIG5lZWQgaXQgXHUyMDE0IHRoZWlyIGRlY2lzaXZlUGFzcyBleHBsYWlucyB2aWFcbiAgLy8gdGhlIG1hcCBhYm92ZS4gUmVzaWR1YWw6IGEgcHJlLWV4aXN0aW5nIHVuY29tbWl0dGVkIE9SIHN0YWdlZCBjaGFuZ2Ugb25cbiAgLy8gdGhlIGRlbGV0ZWQgcGF0aCBtYXNrcyB0aGUgZGlzY3JpbWluYXRvciAodGhlIGZpbGUgZGlmZmVyZWQgZnJvbSB0aGVcbiAgLy8gaW5kZXggYmVmb3JlIHRoZSBjb21wb3VuZCBldmVyIHJhbiksIHNvIGFuIHJtIHRoYXQgZmFpbGVkIG9uIGEgZGlydHlcbiAgLy8gcGF0aCBsZXRzIHRoZSBqb2luZWQgd3JpdGUgZmlyZSBhZHZpc29yeSBcdTIwMTQgc2FtZSBib3VuZGVkIGhhcm0gYXMgdGhlXG4gIC8vIHBsYW4ncyBkb2N1bWVudGVkIFwiY29pbmNpZGVudGFsbHkgcGFzc2VzXCIgam9pbiBjb3JuZXIsIGFuZCBhXG4gIC8vIGhhcm5lc3Mtc3VwcGxpZWQgbm9uLXplcm8gZXhpdCBjb2RlIHN0aWxsIHN1cHByZXNzZXMgdGhlIGFkdmlzb3J5IGNsYXNzXG4gIC8vIGluIHBhc3MgQi4gVGhlIHN0YWdlZCBmYWNlIGlzIHRoZSB3aWRlbmluZydzIG9uZSBjb3N0OiByb3VuZC0zJ3MgYmxhbmstWVxuICAvLyBydWxlIGtlcHQgYE0gYC9gQSBgIHJvd3MgaW52aXNpYmxlLCBzbyBhIGZhaWxlZCBybSBvbiBhIHByZS1zdGFnZWQgcGF0aFxuICAvLyBzdGF5ZWQgZnVsbHkgc3VwcHJlc3NlZDsgdGhlIGluZGV4IGNvbHVtbiBub3cgbWFya3MgaXQsIGFuZCB0aGUgam9pbmVkXG4gIC8vIHdyaXRlIGZpcmVzIGFkdmlzb3J5IHdoZXJldmVyIGdlbnVpbmUgc3RhZ2VkIGRyaWZ0IGV4aXN0cyBhZ2FpbnN0IHRoZVxuICAvLyBzcGFuIGJhc2VsaW5lIChwaW5uZWQgZW5kLXRvLWVuZCBpbiB0aGUgaW50ZWdyYXRpb24gc3VpdGUpLlxuICBjb25zdCByZWNyZWF0ZUJ5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBmb3IgKGNvbnN0IGUgb2YgbGlzdCkge1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcpIGNvbnRpbnVlO1xuICAgICAgaWYgKGUudG91Y2ggPT09IG51bGwgfHwgZS50b3VjaC5raW5kICE9PSAnd3JpdGUnIHx8IGUudG91Y2gudGFyZ2V0U3RhdGUgIT09ICdleGlzdHMnKSBjb250aW51ZTtcbiAgICAgIGlmICghRklMRV9QUk9EVUNJTkdfT1BTLmhhcyhlLm1hdGNoLnNwYW4ub3BlcmF0aW9uKSkgY29udGludWU7XG4gICAgICBjb25zdCBwcmV2ID0gcmVjcmVhdGVCeVBhdGguZ2V0KGUucGF0aCk7XG4gICAgICBpZiAocHJldiA9PT0gdW5kZWZpbmVkIHx8IGlkeCA+IHByZXYpIHJlY3JlYXRlQnlQYXRoLnNldChlLnBhdGgsIGlkeCk7XG4gICAgfVxuICB9XG4gIGlmIChyZWNyZWF0ZUJ5UGF0aC5zaXplID4gMCkge1xuICAgIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgICBmb3IgKGNvbnN0IGUgb2YgbGlzdCkge1xuICAgICAgICBpZiAoZS5vdXRjb21lICE9PSAnZGVjaXNpdmVGYWlsJyB8fCBlLmV4cGxhaW5lZCkgY29udGludWU7XG4gICAgICAgIGlmIChlLnRvdWNoID09PSBudWxsIHx8IGUudG91Y2gua2luZCAhPT0gJ3dyaXRlJyB8fCBlLnRvdWNoLnRhcmdldFN0YXRlICE9PSAnYWJzZW50JykgY29udGludWU7XG4gICAgICAgIGNvbnN0IHJlY3JlYXRlSWR4ID0gcmVjcmVhdGVCeVBhdGguZ2V0KGUucGF0aCk7XG4gICAgICAgIGlmIChyZWNyZWF0ZUlkeCAhPT0gdW5kZWZpbmVkICYmIHJlY3JlYXRlSWR4ID4gZS5jb21tYW5kSW5kZXggJiYgd29ya2luZ1RyZWVDaGFuZ2VkKHByb2JlQ2FjaGUsIGN3ZCwgZS5wYXRoKSkge1xuICAgICAgICAgIGUuZXhwbGFpbmVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFBlci1jb21tYW5kIHZlcmRpY3RzOiAnZmFpbGVkJyBvbiBhbnkgdW5leHBsYWluZWQgZGVjaXNpdmVGYWlsLCBlbHNlXG4gIC8vICdzdWNjZWVkZWQnIG9uIGF0IGxlYXN0IG9uZSBkZWNpc2l2ZSBvdXRjb21lLCBlbHNlICd1bmtub3duJy4gQVxuICAvLyBndWFyZC1vbmx5IGNvbW1hbmQncyBkZXRlcm1pbmlzdGljIGV4aXQgc3RhdHVzIElTIGl0cyB2ZXJkaWN0IChwbGFuIFx1MDBBNzNcbiAgLy8gc3RlcCAyJ3Mgc3Bhbi1sZXNzLWd1YXJkIHJ1bGUpLlxuICBjb25zdCBjb21wdXRlZCA9IG5ldyBNYXA8bnVtYmVyLCBWZXJkaWN0PigpO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgZ3VhcmQgPSBndWFyZEJ5SW5kZXguZ2V0KGlkeCk7XG4gICAgICBjb21wdXRlZC5zZXQoaWR4LCBndWFyZCAhPT0gdW5kZWZpbmVkID8gKGd1YXJkLmV4aXRTdGF0dXMgPT09IDAgPyAnc3VjY2VlZGVkJyA6ICdmYWlsZWQnKSA6ICd1bmtub3duJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgbGV0IGZhaWxlZCA9IGZhbHNlO1xuICAgIGxldCBwYXNzZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IGUgb2YgbGlzdCkge1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcgJiYgIWUuZXhwbGFpbmVkKSBmYWlsZWQgPSB0cnVlO1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlUGFzcycpIHBhc3NlZCA9IHRydWU7XG4gICAgfVxuICAgIGNvbXB1dGVkLnNldChpZHgsIGZhaWxlZCA/ICdmYWlsZWQnIDogcGFzc2VkID8gJ3N1Y2NlZWRlZCcgOiAndW5rbm93bicpO1xuICB9XG5cbiAgLy8gVGhlIGpvaW4gZmlsdGVyIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogYSBza2lwcGVkIGNvbW1hbmQncyBjaGFpbmVkIHZlcmRpY3QgaXNcbiAgLy8gdGhlIGd1YXJkIHRoYXQgc2tpcHBlZCBpdCBcdTIwMTQgJ2ZhaWxlZCcgYWZ0ZXIgYW4gJiYtc2tpcCwgJ3N1Y2NlZWRlZCcgYWZ0ZXJcbiAgLy8gYW4gfHwtc2tpcCBcdTIwMTQgbWF0Y2hpbmcgdGhlIHNoZWxsIHNob3J0LWNpcmN1aXQgKGEgfHwgYiB8fCBjIHN0b3BzIGFmdGVyXG4gIC8vIHRoZSBmaXJzdCBzdWNjZXNzKS4gJ3Vua25vd24nIGZhaWxzIG9wZW4uXG4gIGNvbnN0IGVmZmVjdGl2ZSA9IG5ldyBNYXA8bnVtYmVyLCBWZXJkaWN0PigpO1xuICBjb25zdCBza2lwcGVkID0gbmV3IFNldDxudW1iZXI+KCk7XG4gIGxldCBwcmV2SW5kZXg6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBqb2luID0gam9pbk9mQ29tbWFuZChpZHgsIGdyb3VwcywgZ3VhcmRCeUluZGV4KTtcbiAgICBjb25zdCBwcmV2VmVyZGljdCA9IHByZXZJbmRleCAhPT0gbnVsbCA/IGVmZmVjdGl2ZS5nZXQocHJldkluZGV4KSA6IHVuZGVmaW5lZDtcbiAgICBpZiAocHJldlZlcmRpY3QgIT09IHVuZGVmaW5lZCAmJiBqb2luICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICgoam9pbiA9PT0gJyYmJyAmJiBwcmV2VmVyZGljdCA9PT0gJ2ZhaWxlZCcpIHx8IChqb2luID09PSAnfHwnICYmIHByZXZWZXJkaWN0ID09PSAnc3VjY2VlZGVkJykpIHtcbiAgICAgICAgZWZmZWN0aXZlLnNldChpZHgsIGpvaW4gPT09ICcmJicgPyAnZmFpbGVkJyA6ICdzdWNjZWVkZWQnKTtcbiAgICAgICAgc2tpcHBlZC5hZGQoaWR4KTtcbiAgICAgICAgcHJldkluZGV4ID0gaWR4O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgZWZmZWN0aXZlLnNldChpZHgsIGNvbXB1dGVkLmdldChpZHgpISk7XG4gICAgcHJldkluZGV4ID0gaWR4O1xuICB9XG5cbiAgLy8gUGFzcyBCOiBydW4gdGhlIHRvdWNoIGhvb2sgZm9yIHN1cnZpdmluZyBzcGFucyBvbmx5IFx1MjAxNCBkZWNpc2l2ZVBhc3MsIG9yXG4gIC8vIGluY29uY2x1c2l2ZSB3aXRoIGFuICdleGlzdHMnIHRhcmdldCAodGhlIGFkdmlzb3J5IHJlc2lkdWFsIGNsYXNzOlxuICAvLyBleGlzdGVuY2UtZ2F0ZWQgZmFtaWxpZXMgZmlyZSBhbmQgaGVhbC9zdXJmYWNlOyBwaGFudG9tIGRlbGV0ZXMgbmV2ZXJcbiAgLy8gZmlyZSkuIEEgaGFybmVzcy1zdXBwbGllZCBub24temVybyBleGl0IGNvZGUgc3VwcHJlc3NlcyB0aGUgYWR2aXNvcnlcbiAgLy8gY2xhc3MgdG9vLCBib3VuZGVkIGJ5IHR3byBkb2N1bWVudGVkLXJlc2lkdWUgZmFjZXMgKHNlZVxuICAvLyBiYXNoUmVzcG9uc2VFeGl0Q29kZSk6IHRoZSBjb2RlIGlzIHRoZSBjb21wb3VuZCdzLCBzbyBhIG1hc2tlZCBmYWlsdXJlXG4gIC8vIChgZ2l0IGFwcGx5IHAuZGlmZiB8fCBlY2hvIG9rYCBleGl0aW5nIDApIHN1cHByZXNzZXMgbm90aGluZyBhbmQgYVxuICAvLyB0cmFpbGluZyBmYWlsdXJlIChgc2VkIC1pIHMvYS9iLyBmOyBmYWxzZWApIHN1cHByZXNzZXMgYW4gZWFybGllciByZWFsXG4gIC8vIHdyaXRlIFx1MjAxNCBhbmQgYSBub256ZXJvIGNvZGUgZG9lcyBub3QgcHJvdmUgdGhlIHdyaXRlIGRpZCBub3QgaGFwcGVuIGZvclxuICAvLyB0aGUgbm9uLWF0b21pYyB3cml0ZXJzIHRoYXQgbW9kaWZ5IGJlZm9yZSBmYWlsaW5nIChwYXRjaCBhcHBseWluZ1xuICAvLyBlYXJsaWVyIGh1bmtzLCBgZ2l0IGFwcGx5IC0tcmVqZWN0YCwgZm9ybWF0dGVycyB3cml0aW5nIGZpeGVzIHRoZW5cbiAgLy8gZXhpdGluZyBub256ZXJvKS4gQSB6ZXJvIG9yIGFic2VudCBjb2RlIHByb2NlZWRzLCBhbmQgY29udGVudC12ZXJpZmllZFxuICAvLyBkZWNpc2l2ZSBwYXNzZXMgZmlyZSByZWdhcmRsZXNzIChmYWlsLW9wZW4sIHBsYW4gXHUwMEE3NCkuIEd1YXJkLW9ubHlcbiAgLy8gY29tbWFuZHMgaGF2ZSBubyB0b3VjaGVzLiBFeHBsYWluZWQgZmFpbHMgYW5kIGRlY2lzaXZlIGZhaWxzIG5ldmVyXG4gIC8vIHJlYWNoIGFuIGV4ZWN1dG9yLlxuICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGlmIChza2lwcGVkLmhhcyhpZHgpKSBjb250aW51ZTtcbiAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgbGV0IHRvdWNoZXMgPSAwO1xuICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICBpZiAoZS50b3VjaCA9PT0gbnVsbCB8fCBlLmV4cGxhaW5lZCkgY29udGludWU7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJykgY29udGludWU7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnaW5jb25jbHVzaXZlJyAmJiBlLnRvdWNoLmtpbmQgPT09ICd3cml0ZScgJiYgZS50b3VjaC50YXJnZXRTdGF0ZSA9PT0gJ2Fic2VudCcpIGNvbnRpbnVlO1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2luY29uY2x1c2l2ZScgJiYgZS50b3VjaC5raW5kID09PSAnd3JpdGUnICYmIGV4aXRDb2RlICE9PSB1bmRlZmluZWQgJiYgZXhpdENvZGUgIT09IDApXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgaWYgKHRvdWNoZXMgPj0gMzIpIHtcbiAgICAgICAgLy8gSGFyZCBwZXItY29tbWFuZCB2b2x1bWUgY2FwIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogZHJvcCB0aGUgc3VycGx1cyB3aXRoXG4gICAgICAgIC8vIGEgd2FybmluZyByYXRoZXIgdGhhbiBibG93IHRoZSBob29rIHRpbWVvdXQgb24gYSA1MC1jb3B5IGNoYWluLlxuICAgICAgICB3YXJuKGBCYXNoIHRvdWNoIGNhcCAoMzIpIHJlYWNoZWQgZm9yIHNpbXBsZSBjb21tYW5kICR7aWR4fTsgZHJvcHBpbmcgdGhlIHJlbWFpbmluZyB0b3VjaGVzYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgdG91Y2hlcyArPSAxO1xuICAgICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuVG91Y2hIb29rKGUudG91Y2gsIGV4ZWN1dG9ycywgbWVtbywgcHJvYmVDYWNoZSk7XG4gICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gYmxvY2tzO1xufVxuIiwgIi8qKlxuICogU3RhdGljIGNsYXNzaWZpY2F0aW9uIG9mIGEgQmFzaCB0b29sIGBjb21tYW5kYCBzdHJpbmcgaW50byB0aGUgZmlsZVxuICogcGF0aChzKSArIGxpbmUgcmFuZ2UocykgaXQgcmVhZHMgb3Igd3JpdGVzLCB3aGVyZSB0aGF0J3Mgc3RhdGljYWxseVxuICogZGV0ZXJtaW5hYmxlLiBCdWlsdCBmcm9tIGFuIGVtcGlyaWNhbCBwYXNzIG92ZXIgfjMxayByZWFsIENsYXVkZSBDb2RlXG4gKiBCYXNoIGludm9jYXRpb25zIChzZWUgYW5hbHl6ZS10cmFuc2NyaXB0cy5tdHMpIFx1MjAxNCB0aGUgaWRpb21zIGJlbG93IGFyZVxuICogZXhhY3RseSB0aGUgb25lcyB0aGF0IHR1cm5lZCBvdXQgdG8gYmUgY29tbW9uIEFORCByZWxpYWJsZSB0aGVyZS5cbiAqXG4gKiBEZWxpYmVyYXRlbHkgTk9UIGNvdmVyZWQgKHNlZSB0aGUgcmVzZWFyY2ggcmVwb3J0KTogYXdrIE5SLXRyaWNrcyAocmFyZSxcbiAqIHVuY29uc3RyYWluZWQgc3ludGF4KSwgZ3JlcCAtbi8tQS8tQi8tQyAodGhlIHdpbmRvdyBpcyBhbmNob3JlZCB0byBtYXRjaFxuICogcG9zaXRpb24sIHdoaWNoIGlzIGRhdGEtZGVwZW5kZW50LCBub3QgaW4gdGhlIGNvbW1hbmQgdGV4dCksIGVtYmVkZGVkXG4gKiBweXRob24zL25vZGUgaGVyZWRvYyBzY3JpcHRzIChhIGRpZmZlcmVudCBsYW5ndWFnZSdzIEFTVCwgbm90IGEgc2hlbGxcbiAqIGNvbmNlcm4pLCBhbmQgYGZpbmQgPGRpcj4gLW5hbWUvLXBhdGggLi4uIC1kZWxldGVgICh0aGUgZGVsZXRlZCBwYXRocyBhcmVcbiAqIHRoZSBkaXJlY3RvcnkncyBjb250ZW50cyBhcyB0aGUgZmluZGVyIHdhbGtzIGl0IFx1MjAxNCBkYXRhLWRlcGVuZGVudCwgbm90XG4gKiBzdGF0aWNhbGx5IGVudW1lcmFibGU7IHRoZSByZWN1cnNpdmUtcmVtb3ZhbCBmYWlsLWNsb3NlZCBydWxlIGFwcGxpZXMpLlxuICpcbiAqIFRoZSBjYXJkJ3Mgd3JpdGUtdG91Y2ggZmFtaWxpZXMgXHUyMDE0IHJlZGlyZWN0aW9ucyBhbmQgaGVyZWRvY3MgKFx1MDBBNzUuMVx1MjAxM1x1MDBBNzUuMiksXG4gKiBjcCBhbmQgaW5zdGFsbCAoXHUwMEE3NS4zKSwgbXYgYW5kIGdpdCBtdiAoXHUwMEE3NS40KSwgcm0gYW5kIHRydW5jYXRlIChcdTAwQTc1LjUpLFxuICogc2VkIC1pIChcdTAwQTc1LjYpLCBwYXRjaCBhbmQgZ2l0IGFwcGx5IChcdTAwQTc1LjcpLCBmb3JtYXR0ZXIgd3JpdGUgZmxhZ3MgKFx1MDBBNzUuOCksXG4gKiBhbmQgZ2l0IHJlc3RvcmUvY2hlY2tvdXQgcGF0aHNwZWNzIChcdTAwQTc1LjkpIFx1MjAxNCBhcmUgdGhlIGdyYW1tYXJzIGJlbG93LiBFYWNoXG4gKiBmYW1pbHkgZmFpbHMgY2xvc2VkIG9uIHdoYXQgaXQgY2Fubm90IHN0YXRpY2FsbHkgYXR0cmlidXRlOlxuICogc2hlbGwtZXhwYW5kZWQgb3IgZHluYW1pYyBjb250ZW50LCByZWN1cnNpdmUgcmVtb3ZhbCAoYHJtIC1yYCksXG4gKiBoZXJlLXN0cmluZ3MgKGA8PDxgKSwgZGlyZWN0b3J5LXNoYXBlZCB0YXJnZXRzLCB3cmFwcGVyLXdyYXBwZWQgY29tbWFuZHNcbiAqIHdob3NlIGFyZ3YgY2Fubm90IGJlIHJlY292ZXJlZCwgYW5kIHVubWF0Y2hlZCBwYXRoc3BlY3MgZW1pdCBubyBzcGFuIGF0XG4gKiBhbGwgb3IgYW4gZXhwbGljaXQgdW5yZXNvbHZlZCBlbnRyeSBcdTIwMTQgbmV2ZXIgYSBndWVzc2VkIHdyaXRlLlxuICovXG5pbXBvcnQgeyByZWFkRmlsZVN5bmMsIHN0YXRTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSwgam9pbiBhcyBqb2luUGF0aCwgcmVzb2x2ZSBhcyByZXNvbHZlUGF0aCB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBjb3VudEZpbGVMaW5lcywgY291bnRHaXRCbG9iTGluZXMgfSBmcm9tICcuL2NvbW1hbmQtcmVzb2x2ZS5qcyc7XG5pbXBvcnQgeyB0eXBlIFNpbXBsZUNvbW1hbmQsIHNwbGl0VG9wTGV2ZWwsIHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzLCB0eXBlIFRva2VuLCB0b2tlbml6ZSB9IGZyb20gJy4vc2hlbGwtc3BsaXQuanMnO1xuaW1wb3J0IHsgdHlwZSBQYXRoU3RyaXAsIHBhcnNlVW5pZmllZERpZmZSYW5nZSB9IGZyb20gJy4vdW5pZmllZC1kaWZmLmpzJztcblxuLyoqXG4gKiBUaGUgZXhwbGljaXQgb3BlcmF0aW9uIGtpbmQgb2YgYSByZXNvbHZlZCBzcGFuLiBUaGUgYWRhcHRlcnMgdHJhbnNsYXRlIGZyb21cbiAqIHRoaXMsIG5ldmVyIGZyb20gYGlkaW9tID09PSAnaGVyZWRvYy13cml0ZSdgLXN0eWxlIGNoZWNrcyAocGxhbiBcdTAwQTcxKS5cbiAqL1xuZXhwb3J0IHR5cGUgT3BlcmF0aW9uID1cbiAgfCAncmVhZCcgLy8gcmVhZCBpZGlvbXM7IGNwL2luc3RhbGwgc291cmNlIG9wZXJhbmRzXG4gIHwgJ2NyZWF0ZS1vdmVyd3JpdGUnIC8vIHRydW5jYXRpbmcgY29udGVudCB3cml0ZXM6ID4gcmVkaXJlY3RzLCB0ZWUsIGhlcmVkb2MgPiwgY3AvbXYgZGVzdCwgcmVzdG9yZS9jaGVja291dCwgcGF0Y2ggYWRkXG4gIHwgJ2FwcGVuZCcgLy8gPj4gcmVkaXJlY3RzLCB0ZWUgLWEsIGhlcmVkb2MgPj5cbiAgfCAnbW9kaWZ5JyAvLyBpbi1wbGFjZSBlZGl0cyB3aXRoIHVua25vd24gY29udGVudDogc2VkIC1pLCBwYXRjaCBodW5rcywgZm9ybWF0dGVyIHdyaXRlIGZsYWdzXG4gIHwgJ3JlbmFtZS1jb3B5JyAvLyBtdi9naXQgbXYvcGF0Y2gtcmVuYW1lIGRlc3RpbmF0aW9uICh3aG9sZS1maWxlIHdyaXRlLCBzYW1lIHRvdWNoIGFzIGNyZWF0ZS1vdmVyd3JpdGUpXG4gIHwgJ3RydW5jYXRlJyAvLyA6ID4gZiwgYmFyZSA+IGYsIHRydW5jYXRlXG4gIHwgJ2RlbGV0ZSc7IC8vIHJtLCBtdi9naXQgbXYgc291cmNlLCBwYXRjaCBkZWxldGVcblxuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlZFNwYW4ge1xuICBvcGVyYXRpb246IE9wZXJhdGlvbjtcbiAgYWJzb2x1dGVQYXRoOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBFeGFjdCByYW5nZTogZXZlcnkgcmVhZDsgbW9kaWZ5IG9wZXJhdGlvbnMgd2l0aCBhIHN0YXRpY2FsbHkga25vd24gcmFuZ2VcbiAgICogKHNlZCAtaSBudW1lcmljIGFkZHJlc3NlcywgcGF0Y2ggaHVuayB1bmlvbnMpLiBBYnNlbnQgZm9yIHdyaXRlcyBcdTIxOTJcbiAgICogd2hvbGUtZmlsZSBzY29wZS5cbiAgICovXG4gIGxpbmVTdGFydD86IG51bWJlcjtcbiAgbGluZUVuZD86IG51bWJlcjtcbiAgLyoqXG4gICAqIFN0YXRpY2FsbHkga25vd24gd3JpdHRlbiBjb250ZW50IFx1MjAxNCBhcHBlbmQgYm9kaWVzIGFuZCBsaXRlcmFsIG92ZXJ3cml0ZVxuICAgKiBib2RpZXMgKGhlcmVkb2MvZWNoby9wcmludGYvdGVlIGxpdGVyYWxzLCBwbGFuIFx1MDBBNzMgc3RlcCAxYikuIE9uIGFwcGVuZHMgaXRcbiAgICogaXMgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keTsgb24gYGNyZWF0ZS1vdmVyd3JpdGVgIGl0IGlzIHRoZSBleGFjdCBnYXRlJ3NcbiAgICogcG9zdC1jb250ZW50IFx1MjAxNCB0aGUgdG91Y2ggaXRzZWxmIHN0YXlzIHdob2xlLWZpbGUgKGB3cml0dGVuOiAnJ2ApIGVpdGhlclxuICAgKiB3YXkuXG4gICAqL1xuICB3cml0dGVuPzogc3RyaW5nO1xuICAvKipcbiAgICogVGhlIHN0YXRpY2FsbHkgZXZhbHVhdGVkIGFic29sdXRlIGB0cnVuY2F0ZSAtcyBOYCBzaXplIChwbGFuIFx1MDBBNzUuNSk6IHRoZVxuICAgKiBcdTAwQTczIGBzaXplYCBnYXRlJ3MgcG9zdC1jb21tYW5kIGJ5dGUgY291bnQgKGAtcyAwYCBcdTIxOTIgdGhlIGVtcHR5IGdhdGUpLlxuICAgKiBBYnNlbnQgZm9yIHJlbGF0aXZlIHNpemVzIChgLXMgK05gL2AtcyAtTmApLCBgLXIgcmVmYCwgYW5kIGV2ZXJ5IG90aGVyXG4gICAqIG9wZXJhdGlvbiBcdTIwMTQgdGhvc2UgZ2F0ZSBleGlzdGVuY2Utb25seS5cbiAgICovXG4gIHNpemU/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBPcmRpbmFsIG9mIHRoZSBzcGFuJ3Mgc2ltcGxlIGNvbW1hbmQgd2l0aGluIHRoZSBjb21wb3VuZCwgaW4gd2Fsa2VyXG4gICAqIG9yZGVyOyBncm91cHMgdGhlIHNwYW5zIG9mIG9uZSBjb21tYW5kIGZvciBqb2luIGdhdGluZyAocGxhbiBcdTAwQTczIHN0ZXAgMikuXG4gICAqL1xuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcjtcbiAgLyoqXG4gICAqIFRoZSBvcGVyYXRvciBwcmVjZWRpbmcgdGhlIHNwYW4ncyBzaW1wbGUgY29tbWFuZDsgb25seSBgJyYmJ2AvYCd8fCdgIGdhdGUuXG4gICAqIEFic2VudCBmb3IgYHN0YXJ0YC9gO2AvbmV3bGluZS9gJmAvYHxgIGJvdW5kYXJpZXMuXG4gICAqL1xuICBqb2luPzogJyYmJyB8ICd8fCc7XG4gIG5vdGU/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCB0eXBlIElkaW9tID1cbiAgfCAnc2VkLW4tcmFuZ2UnXG4gIHwgJ2hlYWQtZmlsZSdcbiAgfCAndGFpbC1maWxlJ1xuICB8ICdjYXQtZmlsZSdcbiAgfCAnbmwtZmlsZSdcbiAgfCAnZ2l0LXNob3ctcmV2LXBhdGgnXG4gIHwgJ2dpdC1sb2ctTCdcbiAgfCAnaGVyZWRvYy13cml0ZSdcbiAgLy8gVGhlIHdyaXRlLXRvdWNoIGZhbWlsaWVzIChwbGFuIFx1MDBBNzUpLiBJZGlvbSBzdGF5cyBtYXRjaCBtZXRhZGF0YSBmb3IgdGVzdHNcbiAgLy8gYW5kIHVucmVzb2x2ZWQgcmVhc29uczsgYWRhcHRlciBiZWhhdmlvciBrZXlzIG9uIGBvcGVyYXRpb25gLCBuZXZlciBpZGlvbS5cbiAgfCAncmVkaXJlY3Qtd3JpdGUnIC8vIFx1MDBBNzUuMTogZWNoby9wcmludGYvdGVlIGNvbnRlbnQgcmVkaXJlY3RzXG4gIHwgJ3RydW5jYXRlLXdyaXRlJyAvLyBcdTAwQTc1LjE6IGJhcmUgYD4gZmAgLyBgOiA+IGZgIHRydW5jYXRpb25zXG4gIHwgJ2NwLXdyaXRlJyAvLyBcdTAwQTc1LjNcbiAgfCAnaW5zdGFsbC13cml0ZScgLy8gXHUwMEE3NS4zXG4gIHwgJ212LXdyaXRlJyAvLyBcdTAwQTc1LjQ6IG12IGFuZCBnaXQgbXZcbiAgfCAncm0td3JpdGUnIC8vIFx1MDBBNzUuNTogcm0gYW5kIGdpdCBybVxuICB8ICd0cnVuY2F0ZS1jb21tYW5kJyAvLyBcdTAwQTc1LjU6IHRoZSB0cnVuY2F0ZSBjb21tYW5kXG4gIHwgJ3NlZC1pbnBsYWNlJyAvLyBcdTAwQTc1LjY6IHNlZCAtaVxuICB8ICdwYXRjaC13cml0ZScgLy8gXHUwMEE3NS43OiBwYXRjaCBhbmQgZ2l0IGFwcGx5XG4gIHwgJ2Zvcm1hdHRlci13cml0ZScgLy8gXHUwMEE3NS44XG4gIHwgJ2dpdC1yZXN0b3JlLXdyaXRlJyAvLyBcdTAwQTc1Ljk6IGdpdCByZXN0b3JlIHBhdGhzcGVjc1xuICB8ICdnaXQtY2hlY2tvdXQtd3JpdGUnOyAvLyBcdTAwQTc1Ljk6IGdpdCBjaGVja291dCAtLSBwYXRoc3BlY3NcblxuZXhwb3J0IHR5cGUgU3Bhbk1hdGNoID1cbiAgfCB7IHN0YXR1czogJ3Jlc29sdmVkJzsgaWRpb206IElkaW9tOyBzcGFuOiBSZXNvbHZlZFNwYW47IG5vdGU/OiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAndW5yZXNvbHZlZCc7IGlkaW9tOiBJZGlvbTsgZmlsZUFyZzogc3RyaW5nOyByZWFzb246IHN0cmluZyB9XG4gIHwge1xuICAgICAgLyoqXG4gICAgICAgKiBBIHNwYW4tbGVzcyBjb21tYW5kIHdpdGggYSBkZXRlcm1pbmlzdGljIGV4aXQgc3RhdHVzIFx1MjAxNCBgZmFsc2VgICgxKSxcbiAgICAgICAqIGB0cnVlYCAoMCksIGA6YCAoMCkuIE5vIHNwYW4gYW5kIG5vIHRvdWNoLCBidXQgdGhlIGpvaW4gZHJpdmVyIG5lZWRzXG4gICAgICAgKiB0aGUgdmVyZGljdDogYGZhbHNlICYmIGVjaG8geCA+IGZgIHNraXBzIHRoZSBlY2hvLCBgdHJ1ZSB8fCBlY2hvIHggPlxuICAgICAgICogZmAgc2tpcHMgaXQgdG9vLCBhbmQgd2l0aG91dCB0aGUgZ3VhcmQgYm90aCB3b3VsZCBmaXJlIGFuIGV4YWN0LWdhdGVcbiAgICAgICAqIHRvdWNoIGZvciBhIHdyaXRlIHRoYXQgbmV2ZXIgcmFuIChwbGFuIFx1MDBBNzMgc3RlcCAyJ3Mgc3Bhbi1sZXNzLWd1YXJkXG4gICAgICAgKiBydWxlKS4gRmlsdGVyZWQgb3V0IG9mIGBwYXJzZUNvbW1hbmRgJ3Mgc3BhbiBsaXN0IHdpdGggdGhlXG4gICAgICAgKiB1bnJlc29sdmVkcy5cbiAgICAgICAqL1xuICAgICAgc3RhdHVzOiAnYnVpbHRpbi1ndWFyZCc7XG4gICAgICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcjtcbiAgICAgIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddO1xuICAgICAgZXhpdFN0YXR1czogMCB8IDE7XG4gICAgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lLXJhbmdlIHNwZWNzOiB3aGF0IGEgbWF0Y2hlZCBpZGlvbSBzYXlzIGFib3V0IHRoZSByYW5nZSwgYmVmb3JlIHdlIGtub3dcbi8vIHdoZXRoZXIgcmVzb2x2aW5nIGl0IG5lZWRzIHRvIGNvbnN1bHQgYSByZWFsIGZpbGUvZ2l0IGJsb2IuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudHlwZSBMaW5lUmFuZ2VTcGVjID1cbiAgfCB7IGtpbmQ6ICdsaXRlcmFsJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnOyBlbmQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndG9Fb2YnOyBzdGFydDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICdsYXN0TkxpbmVzJzsgY291bnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnYXBwZW5kTGluZXMnOyBjb3VudDogbnVtYmVyIH07XG5cbmZ1bmN0aW9uIHJlc29sdmVTcGVjKFxuICBzcGVjOiBMaW5lUmFuZ2VTcGVjLFxuICB0b3RhbExpbmVzOiAoKSA9PiBudW1iZXIgfCBudWxsXG4pOiB7IGxpbmVTdGFydDogbnVtYmVyOyBsaW5lRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBzd2l0Y2ggKHNwZWMua2luZCkge1xuICAgIGNhc2UgJ2xpdGVyYWwnOlxuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBzcGVjLmVuZCB9O1xuICAgIGNhc2UgJ3VwcGVyQm91bmRGcm9tU3RhcnQnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogMSwgbGluZUVuZDogdG90YWwgIT09IG51bGwgPyBNYXRoLm1pbihzcGVjLmVuZCwgdG90YWwpIDogc3BlYy5lbmQgfTtcbiAgICB9XG4gICAgY2FzZSAndG9Fb2YnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCB8fCB0b3RhbCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHNwZWMuc3RhcnQsIGxpbmVFbmQ6IE1hdGgubWF4KHNwZWMuc3RhcnQsIHRvdGFsKSB9O1xuICAgIH1cbiAgICBjYXNlICdsYXN0TkxpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBNYXRoLm1heCgxLCB0b3RhbCAtIHNwZWMuY291bnQgKyAxKSwgbGluZUVuZDogdG90YWwgfTtcbiAgICB9XG4gICAgY2FzZSAnYXBwZW5kTGluZXMnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKSA/PyAwO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiB0b3RhbCArIDEsIGxpbmVFbmQ6IHRvdGFsICsgc3BlYy5jb3VudCB9O1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBoYXNTaGVsbEV4cGFuc2lvbihzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9bJGBdLy50ZXN0KHMpO1xufVxuXG5mdW5jdGlvbiBsb29rc1VucmVzb2x2YWJsZShzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGhhc1NoZWxsRXhwYW5zaW9uKHMpIHx8IC9bKj9dLy50ZXN0KHMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIElkaW9tIG1hdGNoZXJzOiBwdXJlIGZ1bmN0aW9ucyBvdmVyIG9uZSBzaW1wbGUgY29tbWFuZCdzIGFyZ3YuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFJhd0NhbmRpZGF0ZSB7XG4gIGtpbmQ6ICdjYW5kaWRhdGUnO1xuICBpZGlvbTogSWRpb207XG4gIGZpbGVBcmc6IHN0cmluZztcbiAgc3BlYzogTGluZVJhbmdlU3BlYztcbiAgcmVzb2x2ZXJLaW5kOiAnZnMnIHwgeyBraW5kOiAnZ2l0JzsgcmV2OiBzdHJpbmcgfTtcbiAgZGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG59XG5pbnRlcmZhY2UgUmF3VW5yZXNvbHZlZCB7XG4gIGtpbmQ6ICd1bnJlc29sdmVkJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHJlYXNvbjogc3RyaW5nO1xufVxudHlwZSBNYXRjaFJlc3VsdCA9IFJhd0NhbmRpZGF0ZSB8IFJhd1VucmVzb2x2ZWQ7XG5cbmNvbnN0IFNFRF9SQU5HRSA9IC9eKFxcZCspKD86LChcXGQrfFxcJCkpP3AkLztcblxuLyoqIFNwbGl0IGEgYHNlZGAgc2NyaXB0IGFyZ3VtZW50IGludG8gaXRzIGA7YC1zZXBhcmF0ZWQgc2VnbWVudHMuICovXG5mdW5jdGlvbiBzZWRTY3JpcHRTZWdtZW50cyhzY3JpcHQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHNjcmlwdC5zcGxpdCgnOycpO1xufVxuXG5mdW5jdGlvbiBtYXRjaFNlZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3NlZCcpIHJldHVybiBbXTtcbiAgY29uc3QgcmVzdCA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmICghcmVzdC5pbmNsdWRlcygnLW4nKSkgcmV0dXJuIFtdO1xuICBsZXQgc2NyaXB0SWR4ID0gLTE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgIGlmIChyZXN0W2ldID09PSAnLW4nKSBjb250aW51ZTtcbiAgICBpZiAoc2VkU2NyaXB0U2VnbWVudHMocmVzdFtpXSkuc29tZSgoc2VnKSA9PiBTRURfUkFOR0UudGVzdChzZWcpKSkge1xuICAgICAgc2NyaXB0SWR4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBpZiAoc2NyaXB0SWR4ID09PSAtMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQ2FuZGlkYXRlcyA9IHJlc3QuZmlsdGVyKChhLCBpKSA9PiBpICE9PSBzY3JpcHRJZHggJiYgYSAhPT0gJy1uJyAmJiAhYS5zdGFydHNXaXRoKCctJykpO1xuICBpZiAoZmlsZUNhbmRpZGF0ZXMubGVuZ3RoICE9PSAxKSByZXR1cm4gW107XG4gIGNvbnN0IGZpbGVBcmcgPSBmaWxlQ2FuZGlkYXRlc1swXTtcbiAgY29uc3QgcmVzdWx0czogTWF0Y2hSZXN1bHRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VkU2NyaXB0U2VnbWVudHMocmVzdFtzY3JpcHRJZHhdKSkge1xuICAgIGNvbnN0IG1hdGNoID0gc2VnbWVudC5tYXRjaChTRURfUkFOR0UpO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gICAgY29uc3QgZW5kVG9rZW4gPSBtYXRjaFsyXTtcbiAgICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID1cbiAgICAgIGVuZFRva2VuID09PSB1bmRlZmluZWRcbiAgICAgICAgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQsIGVuZDogc3RhcnQgfVxuICAgICAgICA6IGVuZFRva2VuID09PSAnJCdcbiAgICAgICAgICA/IHsga2luZDogJ3RvRW9mJywgc3RhcnQgfVxuICAgICAgICAgIDogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IE51bWJlci5wYXJzZUludChlbmRUb2tlbiwgMTApIH07XG4gICAgcmVzdWx0cy5wdXNoKHsga2luZDogJ2NhbmRpZGF0ZScsIGlkaW9tOiAnc2VkLW4tcmFuZ2UnLCBmaWxlQXJnLCBzcGVjLCByZXNvbHZlcktpbmQ6ICdmcycgfSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbmZ1bmN0aW9uIHBhcnNlSGVhZFRhaWxGbGFncyhyZXN0OiBzdHJpbmdbXSk6IHtcbiAgY291bnQ6IG51bWJlciB8IG51bGw7XG4gIGZyb21TdGFydDogYm9vbGVhbjtcbiAgZGlzcXVhbGlmaWVkOiBib29sZWFuO1xuICBmaWxlczogc3RyaW5nW107XG59IHtcbiAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjb3VudDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCBmcm9tU3RhcnQgPSBmYWxzZTtcbiAgbGV0IGRpc3F1YWxpZmllZCA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gcmVzdFtpXTtcbiAgICBpZiAoYSA9PT0gJy1mJyB8fCBhID09PSAnLUYnIHx8IGEgPT09ICctLWZvbGxvdycgfHwgYS5zdGFydHNXaXRoKCctLWZvbGxvdz0nKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy16JyB8fCBhID09PSAnLS16ZXJvLXRlcm1pbmF0ZWQnKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnIHx8IGEgPT09ICctLWJ5dGVzJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14oLWN8LS1ieXRlcz0pLy50ZXN0KGEpKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXEnIHx8IGEgPT09ICctdicgfHwgYSA9PT0gJy0tcXVpZXQnIHx8IGEgPT09ICctLXNpbGVudCcgfHwgYSA9PT0gJy0tdmVyYm9zZScpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLW4nKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFwrP1xcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tbGluZXM9JykpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKCctLWxpbmVzPScubGVuZ3RoKTtcbiAgICAgIGlmICgvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLW5cXCs/XFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKDIpO1xuICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL15cXCtcXGQrJC8udGVzdChhKSkge1xuICAgICAgZnJvbVN0YXJ0ID0gdHJ1ZTtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0nKSB7XG4gICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgZmlsZXMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoSGVhZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2hlYWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIFtdO1xuICBjb25zdCByZWFsRmlsZXMgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyk7XG4gIGlmIChyZWFsRmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IG4gPSBjb3VudCA/PyAxMDtcbiAgcmV0dXJuIHJlYWxGaWxlcy5tYXAoKGZpbGVBcmcpID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScgYXMgY29uc3QsXG4gICAgaWRpb206ICdoZWFkLWZpbGUnIGFzIGNvbnN0LFxuICAgIGZpbGVBcmcsXG4gICAgc3BlYzogeyBraW5kOiAndXBwZXJCb3VuZEZyb21TdGFydCcsIGVuZDogbiB9IGFzIExpbmVSYW5nZVNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hUYWlsKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAndGFpbCcpIHJldHVybiBbXTtcbiAgY29uc3QgeyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPSBmcm9tU3RhcnQgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiBuIH0gOiB7IGtpbmQ6ICdsYXN0TkxpbmVzJywgY291bnQ6IG4gfTtcbiAgcmV0dXJuIHJlYWxGaWxlcy5tYXAoKGZpbGVBcmcpID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScgYXMgY29uc3QsXG4gICAgaWRpb206ICd0YWlsLWZpbGUnIGFzIGNvbnN0LFxuICAgIGZpbGVBcmcsXG4gICAgc3BlYyxcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgYXMgY29uc3RcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBmaW5kR2l0U3ViY29tbWFuZChcbiAgcmVzdDogc3RyaW5nW11cbik6IHsgc3ViSWR4OiBudW1iZXI7IHN1YmNvbW1hbmQ6IHN0cmluZzsgY0Rpcjogc3RyaW5nIHwgbnVsbDsgY0RpclVucmVzb2x2YWJsZTogYm9vbGVhbiB9IHwgbnVsbCB7XG4gIGxldCBjRGlyOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGNEaXJVbnJlc29sdmFibGUgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IHJlc3QubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctQycpIHtcbiAgICAgIGNvbnN0IHYgPSByZXN0W2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgaWYgKGhhc1NoZWxsRXhwYW5zaW9uKHYpKSBjRGlyVW5yZXNvbHZhYmxlID0gdHJ1ZTtcbiAgICAgIGVsc2UgY0RpciA9IHY7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYycpIHtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICByZXR1cm4geyBzdWJJZHg6IGksIHN1YmNvbW1hbmQ6IGEsIGNEaXIsIGNEaXJVbnJlc29sdmFibGUgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuY29uc3QgUkVWX1BBVEggPSAvXihbXlxcczpdKyk6KC4rKSQvO1xuXG5mdW5jdGlvbiBtYXRjaEdpdFNob3coYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ3Nob3cnKSByZXR1cm4gW107XG4gIGNvbnN0IGFmdGVyID0gYXJndlxuICAgIC5zbGljZSgxKVxuICAgIC5zbGljZShzdWIuc3ViSWR4ICsgMSlcbiAgICAuZmlsdGVyKChhKSA9PiAhYS5zdGFydHNXaXRoKCctJykpO1xuICBjb25zdCByZXZQYXRoQXJnID0gYWZ0ZXIuZmluZCgoYSkgPT4gUkVWX1BBVEgudGVzdChhKSk7XG4gIGlmICghcmV2UGF0aEFyZykgcmV0dXJuIFtdO1xuICBjb25zdCBtID0gcmV2UGF0aEFyZy5tYXRjaChSRVZfUEFUSCk7XG4gIGlmICghbSkgcmV0dXJuIFtdO1xuICBjb25zdCBbLCByZXYsIHBhdGhdID0gbTtcbiAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlIHx8IGhhc1NoZWxsRXhwYW5zaW9uKHJldikpIHtcbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICByZWFzb246ICdnaXQgLUMgdGFyZ2V0IG9yIHJldmlzaW9uIGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW1xuICAgIHtcbiAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgICAgcmVzb2x2ZXJLaW5kOiB7IGtpbmQ6ICdnaXQnLCByZXYgfSxcbiAgICAgIGRpck92ZXJyaWRlOiBzdWIuY0RpciA/PyB1bmRlZmluZWRcbiAgICB9XG4gIF07XG59XG5cbmZ1bmN0aW9uIG1hdGNoR2l0TG9nTChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2dpdCcpIHJldHVybiBbXTtcbiAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndi5zbGljZSgxKSk7XG4gIGlmICghc3ViIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnbG9nJykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3Yuc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFmdGVyLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFmdGVyW2ldO1xuICAgIGxldCBzcGVjOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICBpZiAoYSA9PT0gJy1MJykgc3BlYyA9IGFmdGVyW2kgKyAxXSA/PyBudWxsO1xuICAgIGVsc2UgaWYgKGEuc3RhcnRzV2l0aCgnLUwnKSkgc3BlYyA9IGEuc2xpY2UoMik7XG4gICAgaWYgKCFzcGVjKSBjb250aW51ZTtcbiAgICBjb25zdCBtID0gc3BlYy5tYXRjaCgvXihcXGQrKSwoXFxkKyk6KC4rKSQvKTtcbiAgICBpZiAoIW0pIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHMsIGUsIHBhdGhdID0gbTtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdnaXQtbG9nLUwnLFxuICAgICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgICB9XG4gICAgICBdO1xuICAgIH1cbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgaWRpb206ICdnaXQtbG9nLUwnLFxuICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICBzcGVjOiB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IE51bWJlci5wYXJzZUludChzLCAxMCksIGVuZDogTnVtYmVyLnBhcnNlSW50KGUsIDEwKSB9LFxuICAgICAgICByZXNvbHZlcktpbmQ6ICdmcycsXG4gICAgICAgIGRpck92ZXJyaWRlOiBzdWIuY0RpciA/PyB1bmRlZmluZWRcbiAgICAgIH1cbiAgICBdO1xuICB9XG4gIHJldHVybiBbXTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBIZXJlZG9jIHdyaXRlcyAocGxhbiBcdTAwQTc1LjIpOiBoYW5kbGVkIGFzIGEgZGVkaWNhdGVkIHJhdy10ZXh0IHBhc3MgYmVjYXVzZSB0aGVcbi8vIGJvZHkgY2FuIGl0c2VsZiBjb250YWluICYmLzsvfC9uZXdsaW5lcyB0aGF0IHdvdWxkIG90aGVyd2lzZSBjb25mdXNlXG4vLyBzcGxpdFRvcExldmVsLiBUaGUgb3BlbmVyIHNjYW5uZXIgaXMgcXVvdGUtYXdhcmUgYW5kIHZhbGlkYXRlcyB0aGUgY2xvc2luZ1xuLy8gZGVsaW1pdGVyOyBtYXRjaGVkIGhlcmVkb2NzIGFyZSBtYXNrZWQgb3V0IG9mIHRoZSBzdHJpbmcgKHJlcGxhY2VkIHdpdGggYW5cbi8vIGluZGV4ZWQgcGxhY2Vob2xkZXIgc2ltcGxlLWNvbW1hbmQpIGJlZm9yZSB0aGUgcmVzdCBvZiB0aGUgcGlwZWxpbmUgcnVucyxcbi8vIGFuZCByZS1hc3NvY2lhdGVkIGJ5IGluZGV4IGR1cmluZyB0aGUgbWFpbiB3YWxrIHNvIHRoZSB3cml0ZSBpcyByZXNvbHZlZFxuLy8gYWdhaW5zdCB0aGUgY29ycmVjdCBgY2RgLXRyYWNrZWQgZGlyZWN0b3J5LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgaGVyZWRvYydzIGNvbnRlbnQtY2FycnlpbmcgZmFjdHMsIHJlLWFzc29jaWF0ZWQgYnkgaW5kZXggZHVyaW5nIHRoZSB3YWxrLiAqL1xuaW50ZXJmYWNlIEhlcmVkb2NXcml0ZSB7XG4gIC8qKiBUaGUgb3BlbmVyIGxpbmUgdmVyYmF0aW0gKGUuZy4gYGNhdCA+IGYgPDwnRU9GJ2ApLCByZS10b2tlbml6ZWQgZHVyaW5nIHRoZSB3YWxrLiAqL1xuICBvcGVuZXI6IHN0cmluZztcbiAgLyoqIFRoZSBoZXJlZG9jIGJvZHk7IGA8PC1gIGJvZGllcyBoYXZlIGxlYWRpbmcgdGFicyBzdHJpcHBlZCBwZXIgbGluZS4gKi9cbiAgYm9keTogc3RyaW5nO1xuICAvKiogV2hldGhlciB0aGUgZGVsaW1pdGVyIHdhcyBxdW90ZWQvZXNjYXBlZCAoYDw8J0VPRidgLCBgPDxcIkVPRlwiYCwgYDw8XFxFT0ZgKTogdGhlIGJvZHkgdGhlbiB1bmRlcmdvZXMgbm8gc2hlbGwgZXhwYW5zaW9uLiAqL1xuICBxdW90ZWREZWxpbTogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIEhlcmVkb2NPcGVuZXIge1xuICAvKiogV2hlcmUgdGhlIGhlcmVkb2MncyBzaW1wbGUgY29tbWFuZCBzdGFydHMgaW4gdGhlIHJhdyBzdHJpbmcuICovXG4gIGNtZFN0YXJ0OiBudW1iZXI7XG4gIC8qKiBUaGUgbmV3bGluZSBlbmRpbmcgdGhlIG9wZW5lciBsaW5lLCBvciByYXcubGVuZ3RoIHdoZW4gaXQncyB0aGUgbGFzdCBsaW5lLiAqL1xuICBvcGVuZXJMaW5lRW5kOiBudW1iZXI7XG4gIC8qKiBUaGUgY2xvc2luZyBkZWxpbWl0ZXIgKHF1b3RlcyBzdHJpcHBlZCkuICovXG4gIGRlbGltOiBzdHJpbmc7XG4gIC8qKiBgPDwtYDogc3RyaXAgbGVhZGluZyB0YWJzIGZyb20gdGhlIGJvZHkgYW5kIHRoZSBjbG9zZXIgbGluZS4gKi9cbiAgdGFiU3RyaXA6IGJvb2xlYW47XG4gIC8qKiBXaGV0aGVyIHRoZSBkZWxpbWl0ZXIgd2FzIHF1b3RlZC9lc2NhcGVkIFx1MjAxNCB0aGUgc2hlbGwgc2tpcHMgYm9keSBleHBhbnNpb24gdGhlbi4gKi9cbiAgcXVvdGVkRGVsaW06IGJvb2xlYW47XG59XG5cbmNvbnN0IEJBUkVfREVMSU0gPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSokLztcblxuLyoqXG4gKiBGaW5kIHRoZSBuZXh0IGhlcmVkb2Mgb3BlbmVyIChgPDxgL2A8PC1gKSBhdCB0b3AgbGV2ZWwsIHNjYW5uaW5nIGZyb21cbiAqIGBmcm9tYC4gTWlycm9ycyBzcGxpdFRvcExldmVsJ3Mgc2VwYXJhdG9yIGhhbmRsaW5nIHNvIGBjbWRTdGFydGAgbWFya3MgdGhlXG4gKiBvcGVuZXIncyBvd24gc2ltcGxlIGNvbW1hbmQ6IHRvcC1sZXZlbCBgJiZgL2B8fGAvYDtgL25ld2xpbmUvYCZgIHN0YXJ0IGEgbmV3XG4gKiBjb21tYW5kIChhIG5ld2xpbmUgYWZ0ZXIgYSBwaXBlIGlzIGEgbGluZSBjb250aW51YXRpb24pLCBgPmAtcmVkaXJlY3RzLCBkdXBcbiAqIHJlZGlyZWN0cyAoYDI+JjFgKSBhbmQgcGFyZW4gbmVzdGluZyBzdGF5IGluc2lkZSB0aGUgY29tbWFuZCwgYW5kXG4gKiBoZXJlLXN0cmluZ3MgKGA8PDxgKSBhcmUgb3V0IG9mIHNjb3BlLiBBbiBJT19OVU1CRVIgZmQgZGlyZWN0bHkgYmVmb3JlIHRoZVxuICogb3BlcmF0b3IgKGAyPDxFT0ZgKSByZWRpcmVjdHMgdGhhdCBmZCwgbm90IHN0ZGluIFx1MjAxNCBub3QgYSBoZXJlZG9jLiBSZXR1cm5zXG4gKiBudWxsIHdoZW4gbm8gb3BlbmVyIGlzIGZvdW5kLlxuICovXG5mdW5jdGlvbiBmaW5kSGVyZWRvY09wZW5lcihyYXc6IHN0cmluZywgZnJvbTogbnVtYmVyKTogSGVyZWRvY09wZW5lciB8IG51bGwge1xuICBjb25zdCBuID0gcmF3Lmxlbmd0aDtcbiAgbGV0IGluU3F1b3RlID0gZmFsc2U7XG4gIGxldCBpbkRxdW90ZSA9IGZhbHNlO1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgY21kU3RhcnQgPSBmcm9tO1xuICBsZXQgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgbGV0IGkgPSBmcm9tO1xuXG4gIC8qKiBSZWFkIG9uZSBkZWxpbWl0ZXIgd29yZCBzdGFydGluZyBhdCBgc3RhcnRgICh0aGUgYXR0YWNoZWQgdGFpbCBvZiBgPDxFT0ZgL2A8PCdFT0YnYCwgb3IgYSBzdGFuZGFsb25lIG5leHQgd29yZCkuIFF1b3RlcyBjb250cmlidXRlIHRoZWlyIGNvbnRlbnQ7IGEgYmFja3NsYXNoIGVzY2FwZXMgdGhlIG5leHQgY2hhci4gUmV0dXJucyBudWxsIG9uIGFuIHVuYmFsYW5jZWQgcXVvdGUgKGZhaWwgY2xvc2VkKS4gKi9cbiAgY29uc3QgcmVhZERlbGltV29yZCA9IChzdGFydDogbnVtYmVyKTogeyBkZWxpbTogc3RyaW5nOyBzYXdRdW90ZTogYm9vbGVhbjsgbmV4dDogbnVtYmVyIH0gfCBudWxsID0+IHtcbiAgICBsZXQgZCA9ICcnO1xuICAgIGxldCBzYXdRdW90ZSA9IGZhbHNlO1xuICAgIGxldCBrID0gc3RhcnQ7XG4gICAgd2hpbGUgKGsgPCBuICYmICEvXFxzLy50ZXN0KHJhd1trXSkgJiYgcmF3W2tdICE9PSAnPCcgJiYgcmF3W2tdICE9PSAnPicpIHtcbiAgICAgIGNvbnN0IGMgPSByYXdba107XG4gICAgICBpZiAoYyA9PT0gXCInXCIgfHwgYyA9PT0gJ1wiJykge1xuICAgICAgICBjb25zdCBxdW90ZSA9IGM7XG4gICAgICAgIGxldCBtID0gayArIDE7XG4gICAgICAgIHdoaWxlIChtIDwgbiAmJiByYXdbbV0gIT09IHF1b3RlKSB7XG4gICAgICAgICAgZCArPSByYXdbbV07XG4gICAgICAgICAgbSArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtID49IG4pIHJldHVybiBudWxsO1xuICAgICAgICBzYXdRdW90ZSA9IHRydWU7XG4gICAgICAgIGsgPSBtICsgMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGsgKyAxIDwgbikge1xuICAgICAgICAvLyBBIGJhY2tzbGFzaC1lc2NhcGVkIGRlbGltaXRlciBjaGFyIHF1b3RlcyB0aGUgZGVsaW1pdGVyIFx1MjAxNCB0aGUgYm9keVxuICAgICAgICAvLyBpcyBsaXRlcmFsIChgPDxcXEVPRmApLCBzYW1lIGFzIHF1b3Rlcy5cbiAgICAgICAgZCArPSByYXdbayArIDFdO1xuICAgICAgICBzYXdRdW90ZSA9IHRydWU7XG4gICAgICAgIGsgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBkICs9IGM7XG4gICAgICBrICs9IDE7XG4gICAgfVxuICAgIHJldHVybiB7IGRlbGltOiBkLCBzYXdRdW90ZSwgbmV4dDogayB9O1xuICB9O1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSByYXdbaV07XG4gICAgaWYgKGluU3F1b3RlKSB7XG4gICAgICBpZiAoYyA9PT0gXCInXCIpIGluU3F1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRHF1b3RlKSB7XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIGluRHF1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBpblNxdW90ZSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGluRHF1b3RlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKCcpIHtcbiAgICAgIGRlcHRoICs9IDE7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgZGVwdGggPSBNYXRoLm1heCgwLCBkZXB0aCAtIDEpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChkZXB0aCA+IDApIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmF3LnN0YXJ0c1dpdGgoJyYmJywgaSkgfHwgcmF3LnN0YXJ0c1dpdGgoJ3x8JywgaSkpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDI7XG4gICAgICBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChyYXcuc3RhcnRzV2l0aCgnfCYnLCBpKSkge1xuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzsnKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ3wnKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxuJykge1xuICAgICAgLy8gQSBuZXdsaW5lIGFmdGVyIGEgcGlwZSBpcyBhIGxpbmUgY29udGludWF0aW9uIChtaXJyb3JpbmdcbiAgICAgIC8vIHNwbGl0VG9wTGV2ZWwpOyBhbnl0aGluZyBlbHNlIHN0YXJ0cyBhIG5ldyBzaW1wbGUgY29tbWFuZC5cbiAgICAgIGlmICghcGVuZGluZ1BpcGUpIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcmJykge1xuICAgICAgLy8gYCY+YC9gJj4+YCBhbmQgZHVwIHJlZGlyZWN0cyAoYDI+JjFgKSBhcmUgcmVkaXJlY3Qgb3BlcmF0b3JzLCBub3RcbiAgICAgIC8vIGNvbW1hbmQgc2VwYXJhdG9ycyAobWlycm9yaW5nIHNwbGl0VG9wTGV2ZWwpLlxuICAgICAgY29uc3QgdHJpbW1lZCA9IHJhdy5zbGljZShjbWRTdGFydCwgaSkudHJpbUVuZCgpO1xuICAgICAgY29uc3QgZHVwUmVkaXJlY3QgPVxuICAgICAgICB0cmltbWVkLmVuZHNXaXRoKCc+JykgJiYgKHRyaW1tZWQubGVuZ3RoID09PSAxIHx8IC9cXHN8XFxkLy50ZXN0KHRyaW1tZWRbdHJpbW1lZC5sZW5ndGggLSAyXSA/PyAnJykpO1xuICAgICAgaWYgKHJhd1tpICsgMV0gPT09ICc+JyB8fCBkdXBSZWRpcmVjdCkge1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICc8JyAmJiByYXdbaSArIDFdID09PSAnPCcpIHtcbiAgICAgIC8vIGA8PDxgIGlzIGEgaGVyZS1zdHJpbmcgKG91dCBvZiBzY29wZSk7IGA8PC1gIHN0cmlwcyBsZWFkaW5nIHRhYnMuXG4gICAgICBpZiAocmF3W2kgKyAyXSA9PT0gJzwnKSB7XG4gICAgICAgIGkgKz0gMztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBsZXQgaiA9IGkgLSAxO1xuICAgICAgd2hpbGUgKGogPj0gZnJvbSAmJiAvXFxkLy50ZXN0KHJhd1tqXSkpIGogLT0gMTtcbiAgICAgIGNvbnN0IGlvTnVtYmVyID0gaiA8IGkgLSAxICYmIChqIDwgZnJvbSB8fCAvXFxzfFs7fCYoXS8udGVzdChyYXdbal0pKTtcbiAgICAgIGlmIChpb051bWJlcikge1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgdGFiU3RyaXAgPSByYXdbaSArIDJdID09PSAnLSc7XG4gICAgICBjb25zdCBvcExlbiA9IHRhYlN0cmlwID8gMyA6IDI7XG4gICAgICBjb25zdCBsaW5lRW5kID0gcmF3LmluZGV4T2YoJ1xcbicsIGkpO1xuICAgICAgY29uc3Qgb3BlbmVyTGluZUVuZCA9IGxpbmVFbmQgPT09IC0xID8gbiA6IGxpbmVFbmQ7XG4gICAgICBjb25zdCBhdHRhY2hlZCA9IHJlYWREZWxpbVdvcmQoaSArIG9wTGVuKTtcbiAgICAgIGxldCBkZWxpbSA9IGF0dGFjaGVkID09PSBudWxsID8gJycgOiBhdHRhY2hlZC5kZWxpbTtcbiAgICAgIGxldCBzYXdRdW90ZSA9IGF0dGFjaGVkID09PSBudWxsID8gZmFsc2UgOiBhdHRhY2hlZC5zYXdRdW90ZTtcbiAgICAgIGlmIChkZWxpbSA9PT0gJycgJiYgYXR0YWNoZWQgIT09IG51bGwpIHtcbiAgICAgICAgLy8gU3RhbmRhbG9uZSBvcGVyYXRvcjogdGhlIGRlbGltaXRlciBpcyB0aGUgbmV4dCB3b3JkLlxuICAgICAgICBsZXQgayA9IGF0dGFjaGVkLm5leHQ7XG4gICAgICAgIHdoaWxlIChrIDwgb3BlbmVyTGluZUVuZCAmJiAvXFxzLy50ZXN0KHJhd1trXSkpIGsgKz0gMTtcbiAgICAgICAgY29uc3Qgd29yZCA9IHJlYWREZWxpbVdvcmQoayk7XG4gICAgICAgIGlmICh3b3JkID09PSBudWxsKSBkZWxpbSA9ICcnO1xuICAgICAgICBlbHNlIHtcbiAgICAgICAgICBkZWxpbSA9IHdvcmQuZGVsaW07XG4gICAgICAgICAgc2F3UXVvdGUgPSB3b3JkLnNhd1F1b3RlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoZGVsaW0gPT09ICcnIHx8ICghc2F3UXVvdGUgJiYgIUJBUkVfREVMSU0udGVzdChkZWxpbSkpKSB7XG4gICAgICAgIC8vIE5vIGRlbGltaXRlciwgb3IgYSBiYXJlIGZvcm0gb3V0c2lkZSB0aGUgaWRlbnRpZmllciBzaGFwZSBcdTIwMTQgZmFpbFxuICAgICAgICAvLyBjbG9zZWQgYW5kIGtlZXAgc2Nhbm5pbmcgcGFzdCB0aGUgb3BlcmF0b3IuXG4gICAgICAgIGkgKz0gb3BMZW47XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHsgY21kU3RhcnQsIG9wZW5lckxpbmVFbmQsIGRlbGltLCB0YWJTdHJpcCwgcXVvdGVkRGVsaW06IHNhd1F1b3RlIH07XG4gICAgfVxuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBUaGUgYm9keSBvZiBhbiBvcGVuZXIgcnVucyBmcm9tIGFmdGVyIHRoZSBvcGVuZXIgbGluZSdzIG5ld2xpbmUgdG8gdGhlIGxpbmVcbiAqIHRoYXQgaXMgZXhhY3RseSB0aGUgZGVsaW1pdGVyIChgPDxgKSwgb3IgaXRzIGxlYWRpbmctdGFiLXN0cmlwcGVkIGZvcm1cbiAqIChgPDwtYCksIHRyYWlsaW5nIHdoaXRlc3BhY2UgYWxsb3dlZC4gUmV0dXJucyB0aGUgY2xvc2VyJ3MgbGluZSBib3VuZHMsIG9yXG4gKiBudWxsIHdoZW4gbm8gY2xvc2VyIGV4aXN0cyAoZmFpbCBjbG9zZWQpLlxuICovXG5mdW5jdGlvbiBoZXJlZG9jQ2xvc2VyKHJhdzogc3RyaW5nLCBvcGVuOiBIZXJlZG9jT3BlbmVyKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgY29uc3QgbiA9IHJhdy5sZW5ndGg7XG4gIGNvbnN0IGJvZHlTdGFydCA9IG9wZW4ub3BlbmVyTGluZUVuZCA8IG4gPyBvcGVuLm9wZW5lckxpbmVFbmQgKyAxIDogbjtcbiAgbGV0IGxpbmVQb3MgPSBib2R5U3RhcnQ7XG4gIHdoaWxlIChsaW5lUG9zIDwgbikge1xuICAgIGNvbnN0IG5sID0gcmF3LmluZGV4T2YoJ1xcbicsIGxpbmVQb3MpO1xuICAgIGNvbnN0IGxpbmVFbmQgPSBubCA9PT0gLTEgPyBuIDogbmw7XG4gICAgY29uc3QgY2FuZGlkYXRlID0gb3Blbi50YWJTdHJpcCA/IHJhdy5zbGljZShsaW5lUG9zLCBsaW5lRW5kKS5yZXBsYWNlKC9eXFx0Ky8sICcnKSA6IHJhdy5zbGljZShsaW5lUG9zLCBsaW5lRW5kKTtcbiAgICBpZiAoXG4gICAgICBjYW5kaWRhdGUgPT09IG9wZW4uZGVsaW0gfHxcbiAgICAgIChjYW5kaWRhdGUuc3RhcnRzV2l0aChvcGVuLmRlbGltKSAmJiAvXlsgXFx0XSokLy50ZXN0KGNhbmRpZGF0ZS5zbGljZShvcGVuLmRlbGltLmxlbmd0aCkpKVxuICAgICkge1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBsaW5lUG9zLCBsaW5lRW5kIH07XG4gICAgfVxuICAgIGlmIChubCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgIGxpbmVQb3MgPSBubCArIDE7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogTWFzayBldmVyeSBoZXJlZG9jIG91dCBvZiB0aGUgcmF3IGNvbW1hbmQgc3RyaW5nLCByZXR1cm5pbmcgdGhlIGJvZGllcyBhbmRcbiAqIG9wZW5lcnMgZm9yIHJlLWFzc29jaWF0aW9uIGJ5IGluZGV4LiBUaGUgbWFzayBjb3ZlcnNcbiAqIGBbY21kU3RhcnQsIGNsb3NlckxpbmVFbmQpYCBcdTIwMTQgdGhlIG9wZW5lciBsaW5lIHRocm91Z2ggdGhlIGNsb3NlciBsaW5lLCB0aGVcbiAqIGNsb3NlcidzIG5ld2xpbmUgZXhjbHVkZWQgXHUyMDE0IHNvIGEgY29tbWFuZCBqb2luZWQgYmVmb3JlIHRoZSBvcGVuZXJcbiAqIChgY21kMSAmJiBjYXQgPDxFT0ZgKSBrZWVwcyBpdHMgc3RydWN0dXJlLCBhbmQgdGhlIHBsYWNlaG9sZGVyIHN0YW5kcyBhbG9uZVxuICogYXMgaXRzIG93biBzaW1wbGUgY29tbWFuZC4gQSBoZXJlZG9jIHdpdGhvdXQgYSBjbG9zZXIgZmFpbHMgY2xvc2VkOiBpdHNcbiAqIG9wZW5lciBsaW5lIHN0YXlzIHVubWFza2VkIGFuZCBzY2FubmluZyByZXN1bWVzIGFmdGVyIGl0LlxuICovXG5mdW5jdGlvbiBleHRyYWN0SGVyZWRvY1dyaXRlcyhyYXc6IHN0cmluZyk6IHsgd3JpdGVzOiBIZXJlZG9jV3JpdGVbXTsgbWFza2VkOiBzdHJpbmcgfSB7XG4gIGNvbnN0IHdyaXRlczogSGVyZWRvY1dyaXRlW10gPSBbXTtcbiAgbGV0IG1hc2tlZCA9ICcnO1xuICBsZXQgY3Vyc29yID0gMDtcbiAgZm9yICg7Oykge1xuICAgIGNvbnN0IG9wZW4gPSBmaW5kSGVyZWRvY09wZW5lcihyYXcsIGN1cnNvcik7XG4gICAgaWYgKG9wZW4gPT09IG51bGwpIGJyZWFrO1xuICAgIGNvbnN0IGNsb3NlID0gaGVyZWRvY0Nsb3NlcihyYXcsIG9wZW4pO1xuICAgIGlmIChjbG9zZSA9PT0gbnVsbCkge1xuICAgICAgY3Vyc29yID0gb3Blbi5vcGVuZXJMaW5lRW5kIDwgcmF3Lmxlbmd0aCA/IG9wZW4ub3BlbmVyTGluZUVuZCArIDEgOiByYXcubGVuZ3RoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGJvZHlTdGFydCA9IG9wZW4ub3BlbmVyTGluZUVuZCA8IHJhdy5sZW5ndGggPyBvcGVuLm9wZW5lckxpbmVFbmQgKyAxIDogcmF3Lmxlbmd0aDtcbiAgICBsZXQgYm9keSA9IHJhdy5zbGljZShib2R5U3RhcnQsIGNsb3NlLmxpbmVTdGFydCkucmVwbGFjZSgvXFxuJC8sICcnKTtcbiAgICBpZiAob3Blbi50YWJTdHJpcCkgYm9keSA9IGJvZHkucmVwbGFjZSgvXlxcdCsvZ20sICcnKTtcbiAgICBtYXNrZWQgKz0gcmF3LnNsaWNlKGN1cnNvciwgb3Blbi5jbWRTdGFydCk7XG4gICAgbWFza2VkICs9IGBfX2hlcmVkb2NfJHt3cml0ZXMubGVuZ3RofV9fYDtcbiAgICB3cml0ZXMucHVzaCh7IG9wZW5lcjogcmF3LnNsaWNlKG9wZW4uY21kU3RhcnQsIG9wZW4ub3BlbmVyTGluZUVuZCksIGJvZHksIHF1b3RlZERlbGltOiBvcGVuLnF1b3RlZERlbGltIH0pO1xuICAgIGN1cnNvciA9IGNsb3NlLmxpbmVFbmQ7XG4gIH1cbiAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IpO1xuICByZXR1cm4geyB3cml0ZXMsIG1hc2tlZCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlZGlyZWN0LXRva2VuIGFuYWx5c2lzIGFuZCB0aGUgd3JpdGUtdG91Y2ggZ3JhbW1hcnMgKHBsYW4gXHUwMEE3NS4xLCBcdTAwQTc1LjIpLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBSZWRpcmVjdEluZm8ge1xuICAvKiogSU9fTlVNQkVSIGZkIChgMT5gL2AyPmApLCBvciBudWxsIHdoZW4gaW1wbGljaXQuICovXG4gIGZkOiBudW1iZXIgfCBudWxsO1xuICAvKiogVGhlIG9wZXJhdG9yLiAqL1xuICBvcDogJz4nIHwgJz4+JyB8ICcmPicgfCAnJj4+JyB8ICc+JicgfCAnPCcgfCAnPDwnIHwgJzw8LScgfCAnPDw8JztcbiAgLyoqIEF0dGFjaGVkIHRhcmdldCB0ZXh0LCBvciBudWxsIGZvciBhIHN0YW5kYWxvbmUgb3BlcmF0b3IgKHRhcmdldCA9IG5leHQgdG9rZW4pLiAqL1xuICB0YXJnZXQ6IHN0cmluZyB8IG51bGw7XG59XG5cbmNvbnN0IFJFRElSRUNUX1RPS0VOID0gL14oXFxkKikoPDw8fDw8LXwmPj58PDx8Pj58Jj58PiZ8PHw+KSguKikkLztcblxuZnVuY3Rpb24gY2xhc3NpZnlSZWRpcmVjdFRva2VuKHRleHQ6IHN0cmluZyk6IFJlZGlyZWN0SW5mbyB8IG51bGwge1xuICBjb25zdCBtID0gdGV4dC5tYXRjaChSRURJUkVDVF9UT0tFTik7XG4gIGlmIChtID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgWywgZmRUZXh0LCBvcCwgdGFyZ2V0XSA9IG07XG4gIHJldHVybiB7XG4gICAgZmQ6IGZkVGV4dCA9PT0gJycgPyBudWxsIDogTnVtYmVyLnBhcnNlSW50KGZkVGV4dCwgMTApLFxuICAgIG9wOiBvcCBhcyBSZWRpcmVjdEluZm9bJ29wJ10sXG4gICAgdGFyZ2V0OiB0YXJnZXQgPT09ICcnID8gbnVsbCA6IHRhcmdldFxuICB9O1xufVxuXG4vKipcbiAqIEEgY29udGVudC1wcm9kdWNpbmcgcmVkaXJlY3QgKHBsYW4gXHUwMEE3NS4xKTogZmQtMSBgPmAvYD4+YCAoZXhwbGljaXQgYDE+YC9gMT4+YFxuICogaW5jbHVkZWQpIGFuZCBgJj5gL2AmPj5gLiBGRC1udW1iZXJlZCAoYDI+YCksIGR1cCAoYDI+JjFgLCBgPiZmYCksXG4gKiBgJmAtbGVhZGluZy10YXJnZXQgZHVwIChgPiZgKSBhbmQgc3RkaW4gKGA8YCkgZm9ybXMgbmV2ZXIgcHJvZHVjZSBjb250ZW50LlxuICovXG5mdW5jdGlvbiBpc0NvbnRlbnRSZWRpcmVjdChyOiBSZWRpcmVjdEluZm8pOiBib29sZWFuIHtcbiAgaWYgKHIub3AgPT09ICc+JyB8fCByLm9wID09PSAnPj4nKSB7XG4gICAgaWYgKHIuZmQgIT09IG51bGwgJiYgci5mZCAhPT0gMSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChyLnRhcmdldD8uc3RhcnRzV2l0aCgnJicpKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIHIub3AgPT09ICcmPicgfHwgci5vcCA9PT0gJyY+Pic7XG59XG5cbi8qKiBUaGUgYXJndiBzdHJlYW0gYW5kIHJlZGlyZWN0IGxpc3Qgb2YgYSBzaW1wbGUgY29tbWFuZCAocGxhbiBcdTAwQTc1LjEwKTogd29yZHMgbWludXMgcmVkaXJlY3QgdG9rZW5zIGFuZCB0aGVpciB0YXJnZXRzLiAqL1xuZnVuY3Rpb24gYW5hbHl6ZVRva2Vucyh0b2tlbnM6IFRva2VuW10pOiB7IGFyZ3Y6IHN0cmluZ1tdOyByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdIH0ge1xuICBjb25zdCBhcmd2OiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdG9rZW5zLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdG9rZW4gPSB0b2tlbnNbaV07XG4gICAgaWYgKCF0b2tlbi5pc1JlZGlyZWN0KSB7XG4gICAgICBhcmd2LnB1c2godG9rZW4udGV4dCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgaW5mbyA9IGNsYXNzaWZ5UmVkaXJlY3RUb2tlbih0b2tlbi50ZXh0KTtcbiAgICBpZiAoaW5mbyA9PT0gbnVsbCkge1xuICAgICAgYXJndi5wdXNoKHRva2VuLnRleHQpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbmZvLnRhcmdldCA9PT0gbnVsbCkge1xuICAgICAgLy8gQSBzdGFuZGFsb25lIG9wZXJhdG9yIGNvbnN1bWVzIHRoZSBuZXh0IHRva2VuIGFzIGl0cyB0YXJnZXQgKG9yXG4gICAgICAvLyBoZXJlZG9jIGRlbGltaXRlciAvIGhlcmUtc3RyaW5nIGNvbnRlbnQpIFx1MjAxNCBhdHRhY2hlZCB0byB0aGUgcmVkaXJlY3RcbiAgICAgIC8vIHNvIHRoZSB3cml0ZSBncmFtbWFycyBzZWUgaXQsIGFuZCBleGNsdWRlZCBmcm9tIGFyZ3YuXG4gICAgICBjb25zdCBuZXh0ID0gdG9rZW5zW2kgKyAxXTtcbiAgICAgIGlmIChuZXh0ICE9PSB1bmRlZmluZWQgJiYgIW5leHQuaXNSZWRpcmVjdCkge1xuICAgICAgICByZWRpcmVjdHMucHVzaCh7IC4uLmluZm8sIHRhcmdldDogbmV4dC50ZXh0IH0pO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZWRpcmVjdHMucHVzaChpbmZvKTtcbiAgfVxuICByZXR1cm4geyBhcmd2LCByZWRpcmVjdHMgfTtcbn1cblxuLyoqXG4gKiBMaXRlcmFsIGBlY2hvYC9gcHJpbnRmYCBjb250ZW50IChwbGFuIFx1MDBBNzUuMSkgZm9yIGJvZHkgdGhyZWFkaW5nOiBub1xuICogZmxhZ3MsIG5vIHNoZWxsIGV4cGFuc2lvbiwgbm8gZ2xvYnM7IGBwcmludGZgIG9ubHkgd2hlbiB0aGUgZm9ybWF0IGhhcyBub1xuICogYCVgL2JhY2tzbGFzaCBkaXJlY3RpdmVzICh0aGVuIHRoZSBmb3JtYXQgaXRzZWxmIGlzIHRoZSBsaXRlcmFsIGNvbnRlbnQpLlxuICogVGhyZWFkZWQgb24gYXBwZW5kcyBhcyB0aGUgc3VmZml4IGdhdGUncyBib2R5IGFuZCBvbiBzaW5nbGUgcGxhaW4gYD5gXG4gKiBvdmVyd3JpdGVzIChhbmQgdGVlIG9wZXJhbmRzIHdpdGggYSBvbmUtaG9wIGxpdGVyYWwgcGlwZSBzb3VyY2UpIGFzIHRoZVxuICogZXhhY3QgZ2F0ZSdzIHBvc3QtY29udGVudC5cbiAqL1xuZnVuY3Rpb24gbGl0ZXJhbENvbnRlbnQoYXJndjogc3RyaW5nW10pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBjb25zdCBob3N0ID0gYXJndlswXTtcbiAgaWYgKGhvc3QgIT09ICdlY2hvJyAmJiBob3N0ICE9PSAncHJpbnRmJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgYXJncyA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmIChhcmdzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCBhIG9mIGFyZ3MpIHtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgfHwgaGFzU2hlbGxFeHBhbnNpb24oYSkgfHwgL1sqP10vLnRlc3QoYSkpIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKGhvc3QgPT09ICdwcmludGYnKSB7XG4gICAgaWYgKGFyZ3MubGVuZ3RoICE9PSAxKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGZtdCA9IGFyZ3NbMF07XG4gICAgaWYgKGZtdC5pbmNsdWRlcygnJScpIHx8IGZtdC5pbmNsdWRlcygnXFxcXCcpKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIHJldHVybiBmbXQ7XG4gIH1cbiAgcmV0dXJuIGAke2FyZ3Muam9pbignICcpfVxcbmA7XG59XG5cbi8qKlxuICogUmVzb2x2ZSBhIHJlZGlyZWN0IHRhcmdldCBhZ2FpbnN0IHRoZSBjdXJyZW50IGRpcmVjdG9yeSwgZW1pdHRpbmcgdGhlXG4gKiB1bnJlc29sdmVkIHZlcmRpY3QgKHRoZSByZWFkIGlkaW9tcycgcmVhc29uKSB3aGVuIHRoZSBwYXRoIGNhcnJpZXMgYW5cbiAqIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYi4gUmV0dXJucyB0aGUgYWJzb2x1dGUgcGF0aCwgb3IgbnVsbC5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVRhcmdldChyZXN1bHRzOiBTcGFuTWF0Y2hbXSwgaWRpb206IElkaW9tLCB0YXJnZXQ6IHN0cmluZywgY3VycmVudERpcjogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmIChsb29rc1VucmVzb2x2YWJsZSh0YXJnZXQpKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgaWRpb20sXG4gICAgICBmaWxlQXJnOiB0YXJnZXQsXG4gICAgICByZWFzb246ICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYidcbiAgICB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4gcmVzb2x2ZVBhdGgoY3VycmVudERpciwgdGFyZ2V0KTtcbn1cblxuLyoqIFRoZSBgdGVlYCBvcGVyYW5kIGdyYW1tYXI6IGFwcGVuZCBtb2RlIGFuZCBvcGVyYW5kIGxpc3Q7IHVua25vd24gb3B0aW9ucyByZXR1cm4gbnVsbCAoZmFpbCBjbG9zZWQpLiAqL1xuZnVuY3Rpb24gdGVlT3BlcmFuZFBhcnRzKGFyZ3Y6IHN0cmluZ1tdKTogeyBhcHBlbmQ6IGJvb2xlYW47IG9wZXJhbmRzOiBzdHJpbmdbXSB9IHwgbnVsbCB7XG4gIGxldCBhcHBlbmQgPSBmYWxzZTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgYSBvZiBhcmd2LnNsaWNlKDEpKSB7XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWEnIHx8IGEgPT09ICctLWFwcGVuZCcpIHtcbiAgICAgIGFwcGVuZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSByZXR1cm4gbnVsbDtcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIHJldHVybiB7IGFwcGVuZCwgb3BlcmFuZHMgfTtcbn1cblxuLyoqXG4gKiBUaGUgYHRlZWAgb3BlcmFuZCB3cml0ZXMgKHBsYW4gXHUwMEE3NS4xKTogZWFjaCBvcGVyYW5kIGlzIGEgd2hvbGUtZmlsZVxuICogY3JlYXRlLW92ZXJ3cml0ZSAodHJ1bmNhdGluZyksIG9yIGEgd2hvbGUtZmlsZSBhcHBlbmQgdW5kZXIgYC1hYC9gLS1hcHBlbmRgLlxuICogQSBvbmUtaG9wIGxpdGVyYWwgZWNoby9wcmludGYgcGlwZSBzb3VyY2UgKGBlY2hvIHggfCB0ZWUgZmAsIGBwcmludGYgeSB8XG4gKiB0ZWUgLWEgZmAsIHBsYW4gXHUwMEE3NS4yKSB0aHJlYWRzIGFzIHRoZSB3cml0dGVuIGJvZHkgXHUyMDE0IHRoZSBleGFjdCBnYXRlJ3NcbiAqIHBvc3QtY29udGVudCBvbiB0aGUgdHJ1bmNhdGluZyB3cml0ZSwgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keSBvbiB0aGUgYXBwZW5kO1xuICogd2l0aG91dCBhIGtub3duIHNvdXJjZSBuZWl0aGVyIG9wIGNhcnJpZXMgd3JpdHRlbiBjb250ZW50LlxuICovXG5mdW5jdGlvbiBtYXRjaFRlZU9wZXJhbmRzKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgcGlwZUVjaG9Db250ZW50OiBzdHJpbmcgfCBudWxsLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBwYXJ0cyA9IHRlZU9wZXJhbmRQYXJ0cyhhcmd2KTtcbiAgaWYgKHBhcnRzID09PSBudWxsKSByZXR1cm47XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBwYXJ0cy5vcGVyYW5kcykge1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3JlZGlyZWN0LXdyaXRlJywgb3BlcmFuZCwgY3VycmVudERpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncmVkaXJlY3Qtd3JpdGUnLFxuICAgICAgc3BhbjogIXBhcnRzLmFwcGVuZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgIC4uLihwaXBlRWNob0NvbnRlbnQgIT09IG51bGwgPyB7IHdyaXR0ZW46IHBpcGVFY2hvQ29udGVudCB9IDoge30pXG4gICAgICAgICAgfVxuICAgICAgICA6IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2FwcGVuZCcsXG4gICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgLi4uKHBpcGVFY2hvQ29udGVudCAhPT0gbnVsbCA/IHsgd3JpdHRlbjogcGlwZUVjaG9Db250ZW50IH0gOiB7fSlcbiAgICAgICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcmVkaXJlY3QgZmFtaWx5IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS4xKSwgcnVuIGZvciBldmVyeSBzaW1wbGUgY29tbWFuZCBhZnRlclxuICogdGhlIHJlYWQgbWF0Y2hlcnM6IGNvbnRlbnQtcHJvZHVjaW5nIHJlZGlyZWN0cyBvbiBgZWNob2AvYHByaW50ZmAvYHRlZWBcbiAqIHdyaXRlIHdob2xlLWZpbGU7IGEgYmFyZSBgPiBmYCAvIGA6ID4gZmAgdHJ1bmNhdGVzICh0aGUgbWFpbiB3YWxrIGhhbmRzXG4gKiBhcmd2LWVtcHR5IGNvbW1hbmRzIGRpcmVjdGx5IGhlcmUpOyBgPj5gLW9ubHkgdHJ1bmNhdGlvbiBmb3JtcyBhcHBlbmRcbiAqIG5vdGhpbmcgYW5kIHRvdWNoIG5vdGhpbmcuIEFueSBvdGhlciBob3N0IHdpdGggYSBjb250ZW50IHJlZGlyZWN0IChgbHMgPiBmYCxcbiAqIGBweXRob24zIHgucHkgPiBvdXRgLCBgY2F0IGYgPiBnYCkgZ2V0cyBubyB3cml0ZSB0b3VjaCBcdTIwMTQgdGhlIHJlZGlyZWN0IGlzXG4gKiByZWFsLCBidXQgaXRzIGNvbnRlbnQgaXMgZHluYW1pYyBhbmQgb3V0IG9mIHNjb3BlLlxuICpcbiAqIEJvZHkgdGhyZWFkaW5nOiBleGFjdGx5IG9uZSBwbGFpbiBgPj5gIChvciBgMT4+YCkgY29udGVudCByZWRpcmVjdCBvbiBhXG4gKiBmdWxseSBsaXRlcmFsIGBlY2hvYC9gcHJpbnRmYCB0aHJlYWRzIHRoZSB3cml0dGVuIGJvZHkgKHRoZSBzdWZmaXggZ2F0ZSksXG4gKiBhbmQgZXhhY3RseSBvbmUgcGxhaW4gYD5gIChvciBgMT5gKSBjb250ZW50IHJlZGlyZWN0IG9uIHRoZSBzYW1lIGxpdGVyYWxzXG4gKiB0aHJlYWRzIGl0IGFzIHRoZSBleGFjdCBnYXRlJ3MgcG9zdC1jb250ZW50IChwbGFuIFx1MDBBNzMgc3RlcCAxYiBcdTIwMTQgdGhlXG4gKiBjb250ZW50IGxheWVyIGlzIHdoYXQgc3VwcHJlc3NlcyBgZWNobyBoaSA+IHJlYWQtb25seS1maWxlYCwgd2hlcmUgdGhlXG4gKiBmaWxlIHN0YXlzIHByZXNlbnQgYnV0IHVuY2hhbmdlZCkuIGAmPmAvYCY+PmAsIG11bHRpLXJlZGlyZWN0IGNvbW1hbmRzLFxuICogYW5kIGB0ZWVgJ3Mgb3duIHJlZGlyZWN0cyBuZXZlciB0aHJlYWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUmVkaXJlY3RGYW1pbHkoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdLFxuICBwaXBlRWNob0NvbnRlbnQ6IHN0cmluZyB8IG51bGwsXG4gIGN1cnJlbnREaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IGNvbnRlbnRSZWRpcmVjdHMgPSByZWRpcmVjdHMuZmlsdGVyKGlzQ29udGVudFJlZGlyZWN0KTtcbiAgY29uc3QgaG9zdCA9IGFyZ3ZbMF07XG4gIGlmIChjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMCkge1xuICAgIGlmIChob3N0ID09PSAndGVlJykgbWF0Y2hUZWVPcGVyYW5kcyhhcmd2LCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ID09PSB1bmRlZmluZWQgfHwgaG9zdCA9PT0gJzonIHx8IGhvc3QgPT09ICdleGVjJykge1xuICAgIC8vIEJhcmUgYD4gZmAsIGA6ID4gZmAgYW5kIGBleGVjID4gZmAgdHJ1bmNhdGUgKGV4ZWMgYXBwbGllcyB0aGUgcmVkaXJlY3RcbiAgICAvLyB0byB0aGUgc2hlbGwncyBvd24gZmQgMSBpbW1lZGlhdGVseSBcdTIwMTQgdGhlIGZkLTEgdGFyZ2V0IGlzIHN0YXRpYywgc28gdGhlXG4gICAgLy8gdHJ1bmNhdGlvbiBoYXBwZW5zIGV2ZW4gdGhvdWdoIHRoZSBjb21tYW5kIG5ldmVyIHdyaXRlcyk7XG4gICAgLy8gYD4+YC9gJj4+YCBhcHBlbmQgbm90aGluZyBcdTIxOTIgbm8gdG91Y2guXG4gICAgZm9yIChjb25zdCByIG9mIGNvbnRlbnRSZWRpcmVjdHMpIHtcbiAgICAgIGlmIChyLm9wID09PSAnPj4nIHx8IHIub3AgPT09ICcmPj4nIHx8IHIudGFyZ2V0ID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3RydW5jYXRlLXdyaXRlJywgci50YXJnZXQsIGN1cnJlbnREaXIpO1xuICAgICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAndHJ1bmNhdGUtd3JpdGUnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ3RydW5jYXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCAhPT0gJ2VjaG8nICYmIGhvc3QgIT09ICdwcmludGYnICYmIGhvc3QgIT09ICd0ZWUnKSByZXR1cm47XG4gIGNvbnN0IHNpbmdsZVBsYWluQXBwZW5kID0gY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDEgJiYgY29udGVudFJlZGlyZWN0c1swXS5vcCA9PT0gJz4+JztcbiAgY29uc3Qgc2luZ2xlUGxhaW5PdmVyd3JpdGUgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPic7XG4gIGNvbnN0IHRocmVhZGVkQXBwZW5kID0gc2luZ2xlUGxhaW5BcHBlbmQgJiYgaG9zdCAhPT0gJ3RlZScgPyBsaXRlcmFsQ29udGVudChhcmd2KSA6IHVuZGVmaW5lZDtcbiAgY29uc3QgdGhyZWFkZWRPdmVyd3JpdGUgPSBzaW5nbGVQbGFpbk92ZXJ3cml0ZSAmJiBob3N0ICE9PSAndGVlJyA/IGxpdGVyYWxDb250ZW50KGFyZ3YpIDogdW5kZWZpbmVkO1xuICBmb3IgKGNvbnN0IHIgb2YgY29udGVudFJlZGlyZWN0cykge1xuICAgIGlmIChyLnRhcmdldCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncmVkaXJlY3Qtd3JpdGUnLCByLnRhcmdldCwgY3VycmVudERpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgaWYgKHIub3AgPT09ICc+PicgfHwgci5vcCA9PT0gJyY+PicpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdyZWRpcmVjdC13cml0ZScsXG4gICAgICAgIHNwYW46IHtcbiAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgam9pbixcbiAgICAgICAgICAuLi4odGhyZWFkZWRBcHBlbmQgIT09IHVuZGVmaW5lZCA/IHsgd3JpdHRlbjogdGhyZWFkZWRBcHBlbmQgfSA6IHt9KVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3JlZGlyZWN0LXdyaXRlJyxcbiAgICAgICAgc3Bhbjoge1xuICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLFxuICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgam9pbixcbiAgICAgICAgICAuLi4odGhyZWFkZWRPdmVyd3JpdGUgIT09IHVuZGVmaW5lZCA/IHsgd3JpdHRlbjogdGhyZWFkZWRPdmVyd3JpdGUgfSA6IHt9KVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgaWYgKGhvc3QgPT09ICd0ZWUnKSBtYXRjaFRlZU9wZXJhbmRzKGFyZ3YsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgZmlsZS1tdXRhdGlvbiBmYW1pbHkgZ3JhbW1hcnMgKHBsYW4gXHUwMEE3NS4zXHUyMDEzXHUwMEE3NS43KTogY3AvaW5zdGFsbC9tdi9naXQgbXYsXG4vLyBybS9naXQgcm0vdHJ1bmNhdGUsIHNlZCAtaSBpbi1wbGFjZSBlZGl0cywgYW5kIHBhdGNoL2dpdCBhcHBseS4gVGhleSBzaGFyZVxuLy8gdGhlIFx1MDBBNzUgZmFpbC1jbG9zZWQgcnVsZXM6IGxlYWRpbmcgZW52IGFzc2lnbm1lbnRzIChzdHJpcHBlZCBieSB0aGUgd2Fsaylcbi8vIGFuZCBvbmUgYGNvbW1hbmRgL2BlbnZgIHdyYXBwZXIgYXJlIHNraXBwZWQgKG1lY2hhbmljYWxseSBjZXJ0YWluKTsgYW55XG4vLyBvdGhlciB3cmFwcGVyIGlzIHVucmVzb2x2ZWQ7IGEgbGVhZGluZy1gLWAgdG9rZW4gdGhhdCBpcyBub3QgYSBrbm93biBvcHRpb25cbi8vIGlzIHRyZWF0ZWQgYXMgYW4gb3B0aW9uOyBgLS1gIG1ha2VzIHRoZSByZXN0IG9wZXJhbmRzOyBnbG9iYmVkIG9yIHZhcmlhYmxlXG4vLyBwYXRocyBhcmUgdW5yZXNvbHZlZDsgZGlyZWN0b3J5LXNoYXBlZCBzb3VyY2Ugb3BlcmFuZHMgZmFpbCBjbG9zZWQuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdyYXBwZXIgd29yZHMgdGhhdCBvYnNjdXJlIHRoZSB3cmFwcGVkIGNvbW1hbmQncyBhcmd2IChwbGFuIFx1MDBBNzUpOiBhIGZhbWlseSBjb21tYW5kIGJlaGluZCBvbmUgaXMgdW5yZXNvbHZlZCwgbmV2ZXIgZ3Vlc3NlZC4gKi9cbmNvbnN0IEZPUkVJR05fV1JBUFBFUlMgPSBuZXcgU2V0KFsnc3VkbycsICd4YXJncycsICdub2h1cCcsICd0aW1lJywgJ25pY2UnLCAnZG9hcyddKTtcblxuLyoqIEEgbGVhZGluZyBgTkFNRT12YWx1ZWAgYXNzaWdubWVudCB0b2tlbiAoYGVudiBGT089YmFyIGNwIGEgYmAga2VlcHMgb25lIGFmdGVyIHRoZSB3cmFwcGVyIHdvcmQpLiAqL1xuY29uc3QgQVNTSUdOTUVOVF9UT0tFTiA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKj0vO1xuXG4vKipcbiAqIFN0cmlwIGF0IG1vc3Qgb25lIGBjb21tYW5kYC9gZW52YCB3cmFwcGVyIFx1MjAxNCBtZWNoYW5pY2FsbHkgdHJhbnNwYXJlbnQgKHBsYW5cbiAqIFx1MDBBNzUpIFx1MjAxNCBhbmQgYW55IGxlYWRpbmcgYXNzaWdubWVudHMgYWZ0ZXIgaXQ6IGBlbnYgRk9PPWJhciBjcCBhIGJgIHNldHMgRk9PXG4gKiB0aGVuIHJ1bnMgY3AsIGV4YWN0bHkgdGhlIHRyYW5zcGFyZW50LXByZWZpeCBjbGFzcyB0aGUgd2FsayBzdHJpcHMgYmVmb3JlXG4gKiB0b2tlbml6aW5nIChgRk9PPWJhciBlbnYgY3AgYSBiYCBhcnJpdmVzIGhlcmUgd2l0aCB0aGUgYXNzaWdubWVudHMgYWxyZWFkeVxuICogZ29uZSkuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBjb25zdCB1bndyYXBwZWQgPSBhcmd2WzBdID09PSAnY29tbWFuZCcgfHwgYXJndlswXSA9PT0gJ2VudicgPyBhcmd2LnNsaWNlKDEpIDogYXJndjtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IHVud3JhcHBlZC5sZW5ndGggJiYgQVNTSUdOTUVOVF9UT0tFTi50ZXN0KHVud3JhcHBlZFtpXSkpIGkgKz0gMTtcbiAgcmV0dXJuIGkgPiAwID8gdW53cmFwcGVkLnNsaWNlKGkpIDogdW53cmFwcGVkO1xufVxuXG5mdW5jdGlvbiBwdXNoVW5yZXNvbHZlZChyZXN1bHRzOiBTcGFuTWF0Y2hbXSwgaWRpb206IElkaW9tLCBmaWxlQXJnOiBzdHJpbmcsIHJlYXNvbjogc3RyaW5nKTogdm9pZCB7XG4gIHJlc3VsdHMucHVzaCh7IHN0YXR1czogJ3VucmVzb2x2ZWQnLCBpZGlvbSwgZmlsZUFyZywgcmVhc29uIH0pO1xufVxuXG4vKiogV2hldGhlciB0aGUgcGF0aCBpcyBhbiBleGlzdGluZyBkaXJlY3RvcnkgKHRoZSBkZXN0LWRpciBkZWNpc2lvbiwgcGxhbiBcdTAwQTc1LjMvXHUwMEE3NS40OyBmcyBzdGF0IGxpa2UgdGhlIHJlYWQgaWRpb21zJyBsaW5lIGNvdW50cykuICovXG5mdW5jdGlvbiBpc0V4aXN0aW5nRGlyZWN0b3J5KGFic29sdXRlUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHN0YXRTeW5jKGFic29sdXRlUGF0aCkuaXNEaXJlY3RvcnkoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHNoYXJlZCBjcC9pbnN0YWxsL212IG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjMvXHUwMEE3NS40KTogcGVyLWZhbWlseSBvcHRpb25cbiAqIHNldHMgYW5kIHRvdWNoIG9wZXJhdGlvbnMgYmVoaW5kIG9uZSBwYXJzZXIuXG4gKi9cbmludGVyZmFjZSBDb3B5TW92ZVNwZWMge1xuICBpZGlvbTogJ2NwLXdyaXRlJyB8ICdpbnN0YWxsLXdyaXRlJyB8ICdtdi13cml0ZSc7XG4gIC8qKiBLbm93biBuby12YWx1ZSBmbGFncyAoY29uc3VtZWQsIG5ldmVyIG9wZXJhbmRzKS4gKi9cbiAgbm9WYWx1ZTogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqXG4gICAqIE5vLWNsb2JiZXIgZmxhZ3MgKGBjcCAtbmAvYC0tbm8tY2xvYmJlcmApOiBjb25zdW1lZCBsaWtlIG5vLXZhbHVlIGZsYWdzLFxuICAgKiBidXQgdGhlIHdyaXRlIHN0aWxsIHBhcnNlcyBcdTIwMTQgdGhlIHNraXAgaXMgaW52aXNpYmxlIHRvIHRoZSBwb3N0LWNvbW1hbmRcbiAgICogYnl0ZS1jb21wYXJlIGdhdGUsIHdoaWNoIGNhbm5vdCBkaXN0aW5ndWlzaCBhIHJlYWwgY29weSBmcm9tIGEgcHJlLWV4aXN0aW5nXG4gICAqIGVxdWFsIGRlc3QgKHRoZSBkb2N1bWVudGVkIG5vLW9wIHJlc2lkdWUsIHBpbm5lZCBpblxuICAgKiBiYXNoLXdyaXRlLWludGVncmF0aW9uLnRlc3QudHMpLlxuICAgKi9cbiAgbm9DbG9iYmVyOiBSZWFkb25seVNldDxzdHJpbmc+O1xuICAvKiogS25vd24gdmFsdWUtdGFraW5nIGZsYWdzICh0aGUgbmV4dCB3b3JkIGlzIHRoZSB2YWx1ZSBcdTIwMTQgYC10IERJUmAsIG9yIGFuIGluc3RhbGwgbW9kZS9vd25lci9ncm91cCkuICovXG4gIHZhbHVlVGFraW5nOiBSZWFkb25seVNldDxzdHJpbmc+O1xuICAvKiogRmxhZ3MgdGhhdCBmYWlsIHRoZSB3aG9sZSBjb21tYW5kIGNsb3NlZCAoYGNwIC1iYC9gLS1iYWNrdXBgLCBgaW5zdGFsbCAtZGAsIGdpdCBtdiBkcnktcnVuIGAtbmAvYC0tZHJ5LXJ1bmApLiAqL1xuICBleGNsdWRlZDogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqIFRoZSBwZXItc291cmNlIHRvdWNoOiBjcC9pbnN0YWxsIHJlYWQgdGhlaXIgc291cmNlczsgbXYgZGVsZXRlcyB0aGVtLiAqL1xuICBzb3VyY2VPcGVyYXRpb246ICdyZWFkJyB8ICdkZWxldGUnO1xuICAvKiogVGhlIHBlci1kZXN0IHRvdWNoOiBjcC9pbnN0YWxsIG92ZXJ3cml0ZTsgbXYgcmVuYW1lLWNvcGllcy4gKi9cbiAgZGVzdE9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnIHwgJ3JlbmFtZS1jb3B5Jztcbn1cblxuY29uc3QgQ1BfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ2NwLXdyaXRlJyxcbiAgbm9WYWx1ZTogbmV3IFNldChbJy1yJywgJy1SJywgJy1wJywgJy1mJywgJy12JywgJy1pJywgJy11JywgJy1hJywgJy1kJywgJy1MJywgJy1QJ10pLFxuICBub0Nsb2JiZXI6IG5ldyBTZXQoWyctbicsICctLW5vLWNsb2JiZXInXSksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KFsnLXQnLCAnLS10YXJnZXQtZGlyZWN0b3J5J10pLFxuICBleGNsdWRlZDogbmV3IFNldChbJy1iJywgJy0tYmFja3VwJ10pLFxuICBzb3VyY2VPcGVyYXRpb246ICdyZWFkJyxcbiAgZGVzdE9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnXG59O1xuXG5jb25zdCBJTlNUQUxMX1NQRUM6IENvcHlNb3ZlU3BlYyA9IHtcbiAgaWRpb206ICdpbnN0YWxsLXdyaXRlJyxcbiAgbm9WYWx1ZTogbmV3IFNldChbJy1EJywgJy1zJywgJy12J10pLFxuICBub0Nsb2JiZXI6IG5ldyBTZXQoKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoWyctdCcsICctLXRhcmdldC1kaXJlY3RvcnknLCAnLW0nLCAnLW8nLCAnLWcnXSksXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KFsnLWQnXSksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ3JlYWQnLFxuICBkZXN0T3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZSdcbn07XG5cbmNvbnN0IE1WX1NQRUM6IENvcHlNb3ZlU3BlYyA9IHtcbiAgaWRpb206ICdtdi13cml0ZScsXG4gIC8vIGBtdiAtbmAgc3RheXMgaW4gbm9WYWx1ZSwgbm90IG5vQ2xvYmJlcjogYW4gbXYgc2tpcCBsZWF2ZXMgdGhlIHNvdXJjZSBpblxuICAvLyBwbGFjZSwgYW5kIHRoZSBkZWxldGUncyBvd24gYWJzZW5jZSBnYXRlIHRoZW4gZmFpbHMgdGhlIHRvdWNoIFx1MjAxNCB0aGVcbiAgLy8gbm8tY2xvYmJlciBibGluZCBzcG90IGlzIGNwJ3MgYnl0ZS1jb21wYXJlLCBub3QgbXYncy5cbiAgbm9WYWx1ZTogbmV3IFNldChbJy1mJywgJy1pJywgJy1uJywgJy12JywgJy11J10pLFxuICBub0Nsb2JiZXI6IG5ldyBTZXQoKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoWyctdCcsICctLXRhcmdldC1kaXJlY3RvcnknXSksXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KCksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ2RlbGV0ZScsXG4gIGRlc3RPcGVyYXRpb246ICdyZW5hbWUtY29weSdcbn07XG5cbmNvbnN0IEdJVF9NVl9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnbXYtd3JpdGUnLFxuICBub1ZhbHVlOiBuZXcgU2V0KFsnLWYnLCAnLWsnLCAnLXYnXSksXG4gIG5vQ2xvYmJlcjogbmV3IFNldCgpLFxuICB2YWx1ZVRha2luZzogbmV3IFNldCgpLFxuICAvLyBgZ2l0IG12IC1uYC9gLS1kcnktcnVuYCBpcyBhIHRyaWFsIHJ1biB0aGF0IG1vdmVzIG5vdGhpbmcgKHRoZSBzYW1lXG4gIC8vIHJlYWQtb25seSBjbGFzcyBhcyBgcGF0Y2ggLS1kcnktcnVuYCwgcGxhbiBcdTAwQTc1LjcpIFx1MjAxNCBmYWlsIGNsb3NlZC5cbiAgZXhjbHVkZWQ6IG5ldyBTZXQoWyctbicsICctLWRyeS1ydW4nXSksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ2RlbGV0ZScsXG4gIGRlc3RPcGVyYXRpb246ICdyZW5hbWUtY29weSdcbn07XG5cbmludGVyZmFjZSBDb3B5TW92ZVBhcnRzIHtcbiAgLyoqIE9wZXJhbmRzIGluIG9yZGVyIChzb3VyY2VzOyBpbiB0aGUgbm9uLWAtdGAgZm9ybSB0aGUgbGFzdCBpcyB0aGUgZGVzdCkuICovXG4gIG9wZXJhbmRzOiBzdHJpbmdbXTtcbiAgLyoqIFRoZSBgLXRgL2AtLXRhcmdldC1kaXJlY3RvcnlgIHZhbHVlLCBvciBudWxsLiAqL1xuICB0YXJnZXREaXI6IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogUGFyc2UgdGhlIG9wZXJhbmRzIG9mIGEgY3AvaW5zdGFsbC9tdiBjb21tYW5kOiBrbm93biBvcHRpb25zIGFyZSBjb25zdW1lZCxcbiAqIGAtLWAgbWFrZXMgdGhlIHJlc3Qgb3BlcmFuZHMsIGFuZCBgLXRgL2AtLXRhcmdldC1kaXJlY3RvcnlbPURJUl1gIGlzXG4gKiB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZSBuZXh0IHdvcmQgaXMgdGhlIHRhcmdldCBkaXJlY3RvcnksIG5ldmVyIGEgc291cmNlLiBBXG4gKiBsZWFkaW5nLWAtYCB0b2tlbiB0aGF0IGlzIG5vdCBhIGtub3duIG9wdGlvbiBpcyB0cmVhdGVkIGFzIGFuIG9wdGlvbiAobm9cbiAqIHRvdWNoKS4gUmV0dXJucyBudWxsIHdoZW4gYSBmYWlsLWNsb3NlZCBvcHRpb24gaXMgcHJlc2VudCBvciBhIHZhbHVlLXRha2luZ1xuICogZmxhZyBpcyBsZWZ0IHZhbHVlbGVzcy5cbiAqL1xuZnVuY3Rpb24gY29weU1vdmVQYXJ0cyhhcmdzOiBzdHJpbmdbXSwgc3BlYzogQ29weU1vdmVTcGVjKTogQ29weU1vdmVQYXJ0cyB8IG51bGwge1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IHRhcmdldERpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBpID0gMDtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgd2hpbGUgKGkgPCBhcmdzLmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy10JyB8fCBhID09PSAnLS10YXJnZXQtZGlyZWN0b3J5Jykge1xuICAgICAgY29uc3QgdiA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICB0YXJnZXREaXIgPSB2O1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tdGFyZ2V0LWRpcmVjdG9yeT0nKSkge1xuICAgICAgdGFyZ2V0RGlyID0gYS5zbGljZSgnLS10YXJnZXQtZGlyZWN0b3J5PScubGVuZ3RoKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoc3BlYy5leGNsdWRlZC5oYXMoYSkpIHJldHVybiBudWxsO1xuICAgIGlmIChzcGVjLnZhbHVlVGFraW5nLmhhcyhhKSkge1xuICAgICAgaWYgKGFyZ3NbaSArIDFdID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChzcGVjLm5vVmFsdWUuaGFzKGEpIHx8IHNwZWMubm9DbG9iYmVyLmhhcyhhKSkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgaSArPSAxO1xuICB9XG4gIHJldHVybiB7IG9wZXJhbmRzLCB0YXJnZXREaXIgfTtcbn1cblxuLyoqXG4gKiBUaGUgcGVyLXNvdXJjZSB0b3VjaCBvZiBhIGNwL2luc3RhbGwvbXYgY29tbWFuZC4gY3AvaW5zdGFsbCBzb3VyY2VzIGFyZVxuICogd2hvbGUtZmlsZSByZWFkcyByZXNvbHZlZCBhZ2FpbnN0IGZzIGxpa2UgdGhlIHJlYWQgaWRpb21zOyBhIHNvdXJjZSB3aG9zZVxuICogbGluZSBjb3VudCBjYW5ub3QgYmUgcmVhZCBhdCBwYXJzZSB0aW1lIChtaXNzaW5nIG9yIHVucmVhZGFibGUgXHUyMDE0IHRoZSBwYXJzZVxuICogcnVucyBwb3N0LWNvbW1hbmQsIHNvIGEgc291cmNlIHRoZSBjb21wb3VuZCdzIG93biBlYXJsaWVyIGBybWAgZGVsZXRlZCBpc1xuICogZXhhY3RseSB0aGlzKSBzdGlsbCByZXNvbHZlcyBhcyBhIHJhbmdlLWxlc3Mgd2hvbGUtZmlsZSByZWFkOiB0aGUgZHJpdmVyXG4gKiBwYWlycyB0aGUgZGVzdGluYXRpb24gYWdhaW5zdCBpdCwgc28gdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocGxhbiBcdTAwQTczIHN0ZXBcbiAqIDFiKSBhbmQgdGhlIHJlYWQncyBwb3N0LWNvbW1hbmQgZXhpc3RlbmNlIGdhdGUgYXBwbHkgXHUyMDE0IGFuIHVuZXhwbGFpbmVkXG4gKiBhYnNlbmNlIGZhaWxzIHRoZSBjb3B5IGRlY2lzaXZlbHkgYW5kIGEgcGhhbnRvbSBzb3VyY2UgbmV2ZXIgZmlyZXMgdGhlXG4gKiBkZXN0LiBUaGUgbXYgc291cmNlIGlzIGEgZGVsZXRlLlxuICovXG5mdW5jdGlvbiBlbWl0U291cmNlU3BhbihcbiAgcmVzdWx0czogU3Bhbk1hdGNoW10sXG4gIHNwZWM6IENvcHlNb3ZlU3BlYyxcbiAgYWJzb2x1dGVQYXRoOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXVxuKTogdm9pZCB7XG4gIGlmIChzcGVjLnNvdXJjZU9wZXJhdGlvbiA9PT0gJ2RlbGV0ZScpIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IHNwZWMuaWRpb20sXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2RlbGV0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcmFuZ2UgPSByZXNvbHZlU3BlYyh7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sICgpID0+IGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aCkpO1xuICByZXN1bHRzLnB1c2goe1xuICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICBpZGlvbTogc3BlYy5pZGlvbSxcbiAgICBzcGFuOlxuICAgICAgcmFuZ2UgPT09IG51bGxcbiAgICAgICAgPyB7IG9wZXJhdGlvbjogJ3JlYWQnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICAgIDoge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAncmVhZCcsXG4gICAgICAgICAgICBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCxcbiAgICAgICAgICAgIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsXG4gICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICBqb2luXG4gICAgICAgICAgfVxuICB9KTtcbn1cblxuLyoqXG4gKiBUaGUgY3AvaW5zdGFsbC9tdiBmYW1pbHkgKHBsYW4gXHUwMEE3NS4zL1x1MDBBNzUuNCk6IG9wZXJhbmRzIHJlc29sdmUgdG8gc291cmNlL2Rlc3RcbiAqIHBhaXJzIFx1MjAxNCBlYWNoIHNvdXJjZSBpcyBhIHJlYWQgKGNwL2luc3RhbGwpIG9yIGRlbGV0ZSAobXYpLCBlYWNoIGRlc3QgYVxuICogY3JlYXRlLW92ZXJ3cml0ZSAoY3AvaW5zdGFsbCkgb3IgcmVuYW1lLWNvcHkgKG12KSwgc291cmNlcyBiZWZvcmUgZGVzdHMgaW5cbiAqIGRlY2xhcmF0aW9uIG9yZGVyLiBBIGRlc3QgdGhhdCBlbmRzIGluIGAvYCBvciBzdGF0cyBhcyBhbiBleGlzdGluZyBkaXJlY3RvcnlcbiAqIG1hcHMgdG8gYGRpci9iYXNlbmFtZShzb3VyY2UpYCBwZXIgc291cmNlOyBgLXQgRElSYC9gLS10YXJnZXQtZGlyZWN0b3J5PURJUmBcbiAqIG1hcHMgdGhlIHNhbWUgd2F5IGFuZCBpcyB1bnJlc29sdmVkIHdoZW4gaXRzIHZhbHVlIGlzIG5vdCBkaXJlY3Rvcnktc2hhcGVkLlxuICogTXVsdGktc291cmNlIGNvbW1hbmRzIG5lZWQgYSBkaXJlY3RvcnkgZGVzdDsgYSBkaXJlY3Rvcnktc2hhcGVkIG9yXG4gKiBnbG9iYmVkL3ZhcmlhYmxlIHNvdXJjZSwgYSBnbG9iYmVkL3ZhcmlhYmxlIGRlc3QsIG9yIGEgZmFpbC1jbG9zZWQgb3B0aW9uXG4gKiAoYGNwIC1iYCwgYGluc3RhbGwgLWRgLCBnaXQgbXYgYC1uYCkgZW1pdHMgbm8gdG91Y2hlcy5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hDb3B5TW92ZUZhbWlseShcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBsZXQgc3BlYzogQ29weU1vdmVTcGVjIHwgbnVsbCA9IG51bGw7XG4gIGxldCBhcmdzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgZGlyID0gZGlyRm9yUmVzb2x1dGlvbjtcbiAgaWYgKGNvbW1hbmQgPT09ICdjcCcgfHwgY29tbWFuZCA9PT0gJ2luc3RhbGwnIHx8IGNvbW1hbmQgPT09ICdtdicpIHtcbiAgICBzcGVjID0gY29tbWFuZCA9PT0gJ2NwJyA/IENQX1NQRUMgOiBjb21tYW5kID09PSAnaW5zdGFsbCcgPyBJTlNUQUxMX1NQRUMgOiBNVl9TUEVDO1xuICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpO1xuICB9IGVsc2UgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiAhPT0gbnVsbCAmJiBzdWIuc3ViY29tbWFuZCA9PT0gJ212Jykge1xuICAgICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdtdi13cml0ZScsICdtdicsICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc3BlYyA9IEdJVF9NVl9TUEVDO1xuICAgICAgYXJncyA9IHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICAgICAgZGlyID0gc3ViLmNEaXIgPz8gZGlyRm9yUmVzb2x1dGlvbjtcbiAgICB9XG4gIH0gZWxzZSBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICAvLyBBIHdyYXBwZXIgb2JzY3VyZXMgdGhlIHdyYXBwZWQgYXJndiBcdTIwMTQgZmFpbCBjbG9zZWQgcmF0aGVyIHRoYW4gbWlzLXBhcnNlLlxuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGNvbnN0IHdyYXBwZWRTcGVjID1cbiAgICAgIHdyYXBwZWQgPT09ICdjcCcgPyBDUF9TUEVDIDogd3JhcHBlZCA9PT0gJ2luc3RhbGwnID8gSU5TVEFMTF9TUEVDIDogd3JhcHBlZCA9PT0gJ212JyA/IE1WX1NQRUMgOiBudWxsO1xuICAgIGlmICh3cmFwcGVkU3BlYyAhPT0gbnVsbCkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgd3JhcHBlZFNwZWMuaWRpb20sIHdyYXBwZWQsIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChzcGVjID09PSBudWxsKSByZXR1cm47XG5cbiAgY29uc3QgcGFydHMgPSBjb3B5TW92ZVBhcnRzKGFyZ3MsIHNwZWMpO1xuICBpZiAocGFydHMgPT09IG51bGwgfHwgcGFydHMub3BlcmFuZHMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgLy8gUmVzb2x2ZSBldmVyeSBzb3VyY2UgYmVmb3JlIGVtaXR0aW5nIGFueXRoaW5nOiBhIGRpcmVjdG9yeS1zaGFwZWQsXG4gIC8vIGdsb2JiZWQsIG9yIHZhcmlhYmxlIHNvdXJjZSBmYWlscyB0aGUgd2hvbGUgY29tbWFuZCBjbG9zZWQgKHRoZSBkZXN0XG4gIC8vIG1hcHBpbmcgaXMgcGVyLXNvdXJjZSwgc28gYW4gdW5rbm93YWJsZSBzb3VyY2UgbWFrZXMgdGhlIGRlc3RzIHVua25vd2FibGUpLlxuICBjb25zdCBzb3VyY2VQYXRoczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBzb3VyY2Ugb2YgcGFydHMub3BlcmFuZHMuc2xpY2UoMCwgcGFydHMudGFyZ2V0RGlyID09PSBudWxsID8gLTEgOiB1bmRlZmluZWQpKSB7XG4gICAgaWYgKHNvdXJjZS5lbmRzV2l0aCgnLycpKSByZXR1cm47XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCBzcGVjLmlkaW9tLCBzb3VyY2UsIGRpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGlmIChpc0V4aXN0aW5nRGlyZWN0b3J5KGFic29sdXRlUGF0aCkpIHJldHVybjtcbiAgICBzb3VyY2VQYXRocy5wdXNoKGFic29sdXRlUGF0aCk7XG4gIH1cbiAgaWYgKHNvdXJjZVBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gIGxldCBkZXN0UGF0aHM6IHN0cmluZ1tdO1xuICBpZiAocGFydHMudGFyZ2V0RGlyICE9PSBudWxsKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHBhcnRzLnRhcmdldERpcikpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIHBhcnRzLnRhcmdldERpciwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghcGFydHMudGFyZ2V0RGlyLmVuZHNXaXRoKCcvJykgJiYgIWlzRXhpc3RpbmdEaXJlY3RvcnkocmVzb2x2ZVBhdGgoZGlyLCBwYXJ0cy50YXJnZXREaXIpKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgc3BlYy5pZGlvbSwgcGFydHMudGFyZ2V0RGlyLCAndGhlIC10IHRhcmdldCBpcyBub3QgYW4gZXhpc3RpbmcgZGlyZWN0b3J5Jyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHRhcmdldEFicyA9IHJlc29sdmVQYXRoKGRpciwgcGFydHMudGFyZ2V0RGlyKTtcbiAgICBkZXN0UGF0aHMgPSBzb3VyY2VQYXRocy5tYXAoKHApID0+IGpvaW5QYXRoKHRhcmdldEFicywgYmFzZW5hbWUocCkpKTtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBkZXN0ID0gcGFydHMub3BlcmFuZHNbcGFydHMub3BlcmFuZHMubGVuZ3RoIC0gMV07XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGRlc3QpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBkZXN0LCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZGVzdEFicyA9IHJlc29sdmVQYXRoKGRpciwgZGVzdCk7XG4gICAgY29uc3QgZGVzdElzRGlyID0gZGVzdC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkoZGVzdEFicyk7XG4gICAgaWYgKHNvdXJjZVBhdGhzLmxlbmd0aCA+IDEgJiYgIWRlc3RJc0Rpcikge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgc3BlYy5pZGlvbSwgZGVzdCwgJ2EgbXVsdGktc291cmNlIGNvcHkvbW92ZSBuZWVkcyBhIGRpcmVjdG9yeSBkZXN0aW5hdGlvbicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBkZXN0UGF0aHMgPSBkZXN0SXNEaXIgPyBzb3VyY2VQYXRocy5tYXAoKHApID0+IGpvaW5QYXRoKGRlc3RBYnMsIGJhc2VuYW1lKHApKSkgOiBbZGVzdEFic107XG4gIH1cblxuICBmb3IgKGxldCBrID0gMDsgayA8IHNvdXJjZVBhdGhzLmxlbmd0aDsgaysrKSB7XG4gICAgZW1pdFNvdXJjZVNwYW4ocmVzdWx0cywgc3BlYywgc291cmNlUGF0aHNba10sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbik7XG4gIH1cbiAgZm9yIChsZXQgayA9IDA7IGsgPCBzb3VyY2VQYXRocy5sZW5ndGg7IGsrKykge1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogc3BlYy5pZGlvbSxcbiAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiBzcGVjLmRlc3RPcGVyYXRpb24sIGFic29sdXRlUGF0aDogZGVzdFBhdGhzW2tdLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgIH0pO1xuICB9XG59XG5cbmNvbnN0IFJNX05PX1ZBTFVFID0gbmV3IFNldChbJy1mJywgJy1pJywgJy12J10pO1xuLyoqIGBybWAvYGdpdCBybWAgZmxhZ3Mgd2hvc2Ugc2VtYW50aWNzIGFyZSBvdXQgb2Ygc2NvcGU6IHJlY3Vyc2l2ZSByZW1vdmFsIGFuZCBybWRpci4gKi9cbmNvbnN0IFJNX0VYQ0xVREVEID0gbmV3IFNldChbJy1yJywgJy1SJywgJy0tcmVjdXJzaXZlJywgJy1kJ10pO1xuLyoqIGBnaXQgcm1gIGFkZHMgdGhlIGRyeS1ydW4gZm9ybSB0byB0aGUgZXhjbHVzaW9ucy4gKi9cbmNvbnN0IEdJVF9STV9FWENMVURFRCA9IG5ldyBTZXQoWyctcicsICctUicsICctLXJlY3Vyc2l2ZScsICctZCcsICctbicsICctLWRyeS1ydW4nXSk7XG5cbi8qKlxuICogVGhlIHNoYXJlZCBybS9naXQgcm0gb3BlcmFuZCBncmFtbWFyIChwbGFuIFx1MDBBNzUuNSk6IGEgcmVjdXJzaXZlL3JtZGlyIGZsYWcgKG9yXG4gKiBgLS1jYWNoZWRgIGZvciBnaXQgcm0gXHUyMDE0IHRoZSB3b3JrdHJlZSBmaWxlIHN1cnZpdmVzKSBleGNsdWRlcyB0aGUgd2hvbGVcbiAqIGNvbW1hbmQ7IGVhY2ggcmVtYWluaW5nIGZpbGUtc2hhcGVkIG9wZXJhbmQgaXMgYSBkZWxldGUsIGFuZCBhXG4gKiBkaXJlY3Rvcnktc2hhcGVkIG9wZXJhbmQgZmFpbHMgY2xvc2VkLlxuICovXG5mdW5jdGlvbiBtYXRjaFJtT3BlcmFuZHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBleGNsdWRlZDogUmVhZG9ubHlTZXQ8c3RyaW5nPixcbiAgZXhjbHVkZUNhY2hlZDogYm9vbGVhbixcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBhIG9mIGFyZ3MpIHtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGV4Y2x1ZGVkLmhhcyhhKSB8fCAoZXhjbHVkZUNhY2hlZCAmJiBhID09PSAnLS1jYWNoZWQnKSkgcmV0dXJuO1xuICAgIGlmIChSTV9OT19WQUxVRS5oYXMoYSkpIGNvbnRpbnVlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvblxuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncm0td3JpdGUnLCBvcGVyYW5kLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAob3BlcmFuZC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkocmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kKSkpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3JtLXdyaXRlJyxcbiAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnZGVsZXRlJywgYWJzb2x1dGVQYXRoOiByZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQpLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogU3RhdGljYWxseSBldmFsdWF0ZSBhbiBhYnNvbHV0ZSBgdHJ1bmNhdGUgLXNgIHNpemUgKHBsYW4gXHUwMEE3NS41KTogYSBwbGFpblxuICogaW50ZWdlciB3aXRoIGFuIG9wdGlvbmFsIEsvTS9HIHN1ZmZpeC4gUmVsYXRpdmUgc2l6ZXMgKGAtcyArTmAvYC1zIC1OYCksXG4gKiBgLXIgcmVmYCB2YWx1ZXMsIGFuZCBzaGVsbC1leHBhbmRlZCB2YWx1ZXMgZGVwZW5kIG9uIHJ1bnRpbWUgc3RhdGUgXHUyMTkyXG4gKiB1bmRlZmluZWQgKHRob3NlIHNwYW5zIGdhdGUgZXhpc3RlbmNlLW9ubHkpLlxuICovXG5mdW5jdGlvbiBldmFsdWF0ZVN0YXRpY1NpemUodmFsdWU6IHN0cmluZyB8IHVuZGVmaW5lZCk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBtID0gdmFsdWUubWF0Y2goL14oXFxkKykoW0tNR10pPyQvKTtcbiAgaWYgKG0gPT09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IGJhc2UgPSBOdW1iZXIucGFyc2VJbnQobVsxXSwgMTApO1xuICBjb25zdCBtdWx0ID0gbVsyXSA9PT0gJ0snID8gMTAyNCA6IG1bMl0gPT09ICdNJyA/IDEwMjQgKiogMiA6IG1bMl0gPT09ICdHJyA/IDEwMjQgKiogMyA6IDE7XG4gIHJldHVybiBiYXNlICogbXVsdDtcbn1cblxuLyoqXG4gKiBUaGUgdHJ1bmNhdGUgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjUpOiBgLXMgU0laRWAvYC1yIHJlZmAgYXJlIHZhbHVlLXRha2luZyBcdTIwMTQgdGhlXG4gKiBzaXplIHZhbHVlIG1heSBpdHNlbGYgbGVhZCB3aXRoIGAtYCAoYHRydW5jYXRlIC1zIC0xMCBmYCkgXHUyMDE0IGFuZCBgLWNgIGlzXG4gKiBjb21wYXRpYmxlLiBXaXRob3V0IGAtc2AvYC1yYCB0aGUgY29tbWFuZCBjaGFuZ2VzIG5vdGhpbmcgXHUyMTkyIG5vIHRvdWNoLiBFYWNoXG4gKiBmaWxlLXNoYXBlZCBvcGVyYW5kIGlzIGEgdHJ1bmNhdGU7IGFuIGFic29sdXRlIGAtcyBOYCBjYXJyaWVzIHRoZSBzdGF0aWNhbGx5XG4gKiBldmFsdWF0ZWQgc2l6ZSBvbiB0aGUgc3BhbiAodGhlIFx1MDBBNzMgYHNpemVgIGdhdGUncyBwb3N0LWNvbW1hbmQgYnl0ZSBjb3VudCxcbiAqIGAtcyAwYCBcdTIxOTIgZW1wdHkpLCByZWxhdGl2ZSBzaXplcyBhbmQgYC1yIHJlZmAgc3RheSBleGlzdGVuY2Utb25seS5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hUcnVuY2F0ZU9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgc2F3U2l6ZUZsYWcgPSBmYWxzZTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgbGV0IHN0YXRpY1NpemU6IG51bWJlciB8IHVuZGVmaW5lZDtcbiAgY29uc3Qgb3BlcmFuZHM6IEFycmF5PHsgcGF0aDogc3RyaW5nOyBzaXplOiBudW1iZXIgfCB1bmRlZmluZWQgfT4gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goeyBwYXRoOiBhLCBzaXplOiBzdGF0aWNTaXplIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1zJykge1xuICAgICAgc2F3U2l6ZUZsYWcgPSB0cnVlO1xuICAgICAgc3RhdGljU2l6ZSA9IGV2YWx1YXRlU3RhdGljU2l6ZShhcmdzW2kgKyAxXSk7XG4gICAgICBpICs9IDE7IC8vIGNvbnN1bWUgdGhlIHNpemUgdmFsdWUsIGV2ZW4gd2hlbiBpdCBsZWFkcyB3aXRoIGAtYFxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXInKSB7XG4gICAgICBzYXdTaXplRmxhZyA9IHRydWU7XG4gICAgICBzdGF0aWNTaXplID0gdW5kZWZpbmVkOyAvLyB0aGUgbGFzdCBzaXplIG9wdGlvbiB3aW5zOyBhIHJlZiBoYXMgbm8gc3RhdGljIHZhbHVlXG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYycpIGNvbnRpbnVlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvblxuICAgIG9wZXJhbmRzLnB1c2goeyBwYXRoOiBhLCBzaXplOiBzdGF0aWNTaXplIH0pO1xuICB9XG4gIGlmICghc2F3U2l6ZUZsYWcpIHJldHVybjtcbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQucGF0aCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICd0cnVuY2F0ZS1jb21tYW5kJywgb3BlcmFuZC5wYXRoLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAob3BlcmFuZC5wYXRoLmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShyZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQucGF0aCkpKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICd0cnVuY2F0ZS1jb21tYW5kJyxcbiAgICAgIHNwYW46IHtcbiAgICAgICAgb3BlcmF0aW9uOiAndHJ1bmNhdGUnLFxuICAgICAgICBhYnNvbHV0ZVBhdGg6IHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZC5wYXRoKSxcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luLFxuICAgICAgICAuLi4ob3BlcmFuZC5zaXplICE9PSB1bmRlZmluZWQgPyB7IHNpemU6IG9wZXJhbmQuc2l6ZSB9IDoge30pXG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcm0vZ2l0IHJtL3RydW5jYXRlIGZhbWlseSAocGxhbiBcdTAwQTc1LjUpOiBgcm1gL2BnaXQgcm1gIG9wZXJhbmRzIGFyZVxuICogZGVsZXRlcywgYHRydW5jYXRlYCBvcGVyYW5kcyBhcmUgdHJ1bmNhdGlvbnMgKG9ubHkgd2hlbiBgLXNgL2AtcmAgaXNcbiAqIHByZXNlbnQpLiBgZ2l0IHJtIC0tY2FjaGVkYCB0b3VjaGVzIG5vdGhpbmcuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUm1UcnVuY2F0ZShcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ3JtJykge1xuICAgIG1hdGNoUm1PcGVyYW5kcyhyZXN0LnNsaWNlKDEpLCBSTV9FWENMVURFRCwgZmFsc2UsIGRpckZvclJlc29sdXRpb24sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjb21tYW5kID09PSAndHJ1bmNhdGUnKSB7XG4gICAgbWF0Y2hUcnVuY2F0ZU9wZXJhbmRzKHJlc3Quc2xpY2UoMSksIGRpckZvclJlc29sdXRpb24sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgIT09IG51bGwgJiYgc3ViLnN1YmNvbW1hbmQgPT09ICdybScpIHtcbiAgICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncm0td3JpdGUnLCAncm0nLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIG1hdGNoUm1PcGVyYW5kcyhcbiAgICAgICAgcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSksXG4gICAgICAgIEdJVF9STV9FWENMVURFRCxcbiAgICAgICAgdHJ1ZSxcbiAgICAgICAgc3ViLmNEaXIgPz8gZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luLFxuICAgICAgICByZXN1bHRzXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgaWYgKHdyYXBwZWQgPT09ICdybScgfHwgd3JhcHBlZCA9PT0gJ3RydW5jYXRlJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHdyYXBwZWQgPT09ICdybScgPyAncm0td3JpdGUnIDogJ3RydW5jYXRlLWNvbW1hbmQnLFxuICAgICAgICB3cmFwcGVkLFxuICAgICAgICBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSBib2R5IG9mIGFuIHVucXVvdGVkIGhlcmVkb2MgaXMgc2hlbGwtbGl0ZXJhbC4gVGhlIHNoZWxsIGV4cGFuZHNcbiAqIGAkYCBhbmQgYmFja3RpY2sgc3Vic3RpdHV0aW9ucyBhbmQgcHJvY2Vzc2VzIGJhY2tzbGFzaCBlc2NhcGVzIChgXFwkYCwgYGAgXFxgIGBgLFxuICogYFxcXFxgLCBiYWNrc2xhc2gtbmV3bGluZSkgaW4gYW4gdW5xdW90ZWQgYm9keSBiZWZvcmUgdGhlIGhvc3QgcmVhZHMgaXQ7IGFcbiAqIGJhcmUgYmFja3NsYXNoIGJlZm9yZSBhbnkgb3RoZXIgY2hhciBzdXJ2aXZlcyBsaXRlcmFsbHkuIEEgcXVvdGVkIGRlbGltaXRlclxuICogbWFrZXMgdGhlIGJvZHkgbGl0ZXJhbCByZWdhcmRsZXNzIFx1MjAxNCBjaGVja2VkIGJ5IHRoZSBjYWxsZXIuXG4gKi9cbmZ1bmN0aW9uIGhlcmVkb2NCb2R5SXNMaXRlcmFsKGJvZHk6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoYm9keS5pbmNsdWRlcygnJCcpIHx8IGJvZHkuaW5jbHVkZXMoJ2AnKSkgcmV0dXJuIGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGJvZHkubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoYm9keVtpXSAhPT0gJ1xcXFwnKSBjb250aW51ZTtcbiAgICBjb25zdCBuZXh0ID0gYm9keVtpICsgMV07XG4gICAgaWYgKG5leHQgPT09IHVuZGVmaW5lZCB8fCBuZXh0ID09PSAnJCcgfHwgbmV4dCA9PT0gJ2AnIHx8IG5leHQgPT09ICdcXFxcJyB8fCBuZXh0ID09PSAnXFxuJykgcmV0dXJuIGZhbHNlO1xuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqXG4gKiBUaGUgaGVyZWRvYyB3cml0ZSBncmFtbWFyIChwbGFuIFx1MDBBNzUuMikgZm9yIHRoZSBob3N0IGZhbWlsaWVzIHdob3NlIGJvZGllcyBhcmVcbiAqIGNvbnRlbnQ6IGBjYXRgIChib2R5IFx1MjE5MiB0aGUgY29udGVudCByZWRpcmVjdHMpLCBgdGVlYCAoYm9keSBcdTIxOTIgdGhlIG9wZXJhbmRzKSxcbiAqIGFuZCBgcGF0Y2hgL2BnaXQgYXBwbHlgIChib2R5IFx1MjE5MiBwYXRjaCB0ZXh0LCBcdTAwQTc1LjcpLiBBbnkgb3RoZXIgaG9zdCdzIGhlcmVkb2NcbiAqIGJvZHkgaXMgbm90IGF0dHJpYnV0YWJsZSBjb250ZW50IFx1MjAxNCBzdGRpbi1vbmx5IGFuZCBub24tZmFtaWx5IGNvbW1hbmRzXG4gKiAoYHB5dGhvbjMgLSA8PEVPRiA+IG91dGAsIGBscyA+IG91dCA8PEVPRmApIGdldCBubyB3cml0ZSB0b3VjaCwgYW5kXG4gKiByZWFkLWZhbWlseSBjb21tYW5kcyAoYHNlZCAtbiAnMSwycCcgPDxFT0ZgKSBmYWxsIHRocm91Z2ggdG8gdGhlIHJlYWRcbiAqIG1hdGNoZXJzLiBFbXB0eSBgPj5gLWJvZGllcyBhcHBlbmQgbm90aGluZyBhbmQgdG91Y2ggbm90aGluZzsgZW1wdHkgYD5gLWJvZGllc1xuICogdHJ1bmNhdGUgKHdob2xlLWZpbGUsIHRoZSBGMiBydWxlKS5cbiAqXG4gKiBCb2R5IHRocmVhZGluZzogYD4+YCBhcHBlbmRzIGFuZCBgPmAgb3ZlcndyaXRlcyB0aHJlYWQgdGhlIGJvZHkgd2hlbiB0aGVcbiAqIGNvbnRlbnQgcmVkaXJlY3QgaXMgc2luZ2xlIGFuZCBwbGFpbiBcdTIwMTQgdGhlIGV4YWN0IGdhdGUncyBwb3N0LWNvbnRlbnQgb24gdGhlXG4gKiBvdmVyd3JpdGUgKHRoZSB0cmFpbGluZyBgXFxuYCB0aGUgZXh0cmFjdGlvbiBzdHJpcHMgaXMgcmVzdG9yZWQsIHNpbmNlIHRoZVxuICogZ2F0ZSBjb21wYXJlcyBmdWxsIGZpbGUgYnl0ZXMpLCB0aGUgc3VmZml4IGdhdGUncyBib2R5IG9uIHRoZSBhcHBlbmQgKHBsYW5cbiAqIFx1MDBBNzMgc3RlcCAxYiBsaXN0cyBcInRlZS9oZXJlZG9jIHdpdGggYSBsaXRlcmFsIGJvZHlcIiBpbiB0aGUgZXhhY3QgY2xhc3MpLlxuICogQW4gdW5xdW90ZWQgZGVsaW1pdGVyIGxldHMgdGhlIHNoZWxsIGV4cGFuZCB0aGUgYm9keSBiZWZvcmUgdGhlIGhvc3QgcmVhZHNcbiAqIGl0LCBzbyBvbmx5IGEgbGl0ZXJhbCBib2R5IChubyBgJGAsIGJhY2t0aWNrLCBvciBzaGVsbC1wcm9jZXNzZWQgYmFja3NsYXNoKVxuICogdGhyZWFkcyBcdTIwMTQgYW4gZXhwYW5kYWJsZSBvbmUgZGVncmFkZXMgdG8gdGhlIGV4aXN0ZW5jZS1nYXRlZCBhZHZpc29yeSBjbGFzc1xuICogcmF0aGVyIHRoYW4gcmlzayBhIGRlY2lzaXZlLWZhaWwgb24gY29udGVudCB0aGF0IG5ldmVyIHJlYWNoZWQgdGhlIGZpbGUuXG4gKi9cbmZ1bmN0aW9uIGNsYXNzaWZ5SGVyZWRvY09wZW5lcihcbiAgb3BlbmVyOiBzdHJpbmcsXG4gIGJvZHk6IHN0cmluZyxcbiAgcXVvdGVkRGVsaW06IGJvb2xlYW4sXG4gIGN1cnJlbnREaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IGJvZHlMaXRlcmFsID0gcXVvdGVkRGVsaW0gfHwgaGVyZWRvY0JvZHlJc0xpdGVyYWwoYm9keSk7XG4gIGNvbnN0IHRva2VucyA9IHRva2VuaXplKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKG9wZW5lcikudHJpbSgpKTtcbiAgaWYgKHRva2VucyA9PT0gbnVsbCkgcmV0dXJuO1xuICBjb25zdCB7IGFyZ3YsIHJlZGlyZWN0cyB9ID0gYW5hbHl6ZVRva2Vucyh0b2tlbnMpO1xuICBjb25zdCBob3N0ID0gYXJndlswXTtcbiAgY29uc3QgY29udGVudFJlZGlyZWN0cyA9IHJlZGlyZWN0cy5maWx0ZXIoaXNDb250ZW50UmVkaXJlY3QpO1xuICBjb25zdCBzaW5nbGVQbGFpbkFwcGVuZCA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+Pic7XG4gIGNvbnN0IHNpbmdsZVBsYWluT3ZlcndyaXRlID0gY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDEgJiYgY29udGVudFJlZGlyZWN0c1swXS5vcCA9PT0gJz4nO1xuXG4gIGNvbnN0IGVtaXRDb250ZW50UmVkaXJlY3RzID0gKCk6IHZvaWQgPT4ge1xuICAgIGZvciAoY29uc3QgciBvZiBjb250ZW50UmVkaXJlY3RzKSB7XG4gICAgICBpZiAoci50YXJnZXQgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAnaGVyZWRvYy13cml0ZScsIHIudGFyZ2V0LCBjdXJyZW50RGlyKTtcbiAgICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgaWYgKHIub3AgPT09ICc+PicgfHwgci5vcCA9PT0gJyY+PicpIHtcbiAgICAgICAgaWYgKGJvZHkubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBzcGFuOiB7XG4gICAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgIC4uLihzaW5nbGVQbGFpbkFwcGVuZCAmJiByLm9wID09PSAnPj4nICYmIGJvZHlMaXRlcmFsID8geyB3cml0dGVuOiBib2R5IH0gOiB7fSlcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBzcGFuOlxuICAgICAgICAgICAgYm9keS5sZW5ndGggPT09IDBcbiAgICAgICAgICAgICAgPyB7IG9wZXJhdGlvbjogJ3RydW5jYXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgICAgICAgICA6IHtcbiAgICAgICAgICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLFxuICAgICAgICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgICAgICAgIC8vIFRoZSBleGFjdCBnYXRlIGNvbXBhcmVzIGZ1bGwgZmlsZSBieXRlcywgc28gdGhlIHRyYWlsaW5nXG4gICAgICAgICAgICAgICAgICAvLyBgXFxuYCB0aGUgZXh0cmFjdGlvbiBzdHJpcHBlZCBjb21lcyBiYWNrIG9uIHRoZSBvdmVyd3JpdGUuXG4gICAgICAgICAgICAgICAgICAuLi4oc2luZ2xlUGxhaW5PdmVyd3JpdGUgJiYgYm9keUxpdGVyYWwgPyB7IHdyaXR0ZW46IGAke2JvZHl9XFxuYCB9IDoge30pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgaWYgKGhvc3QgPT09ICdjYXQnKSB7XG4gICAgZW1pdENvbnRlbnRSZWRpcmVjdHMoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGhvc3QgPT09ICd0ZWUnKSB7XG4gICAgY29uc3QgcGFydHMgPSB0ZWVPcGVyYW5kUGFydHMoYXJndik7XG4gICAgaWYgKHBhcnRzICE9PSBudWxsKSB7XG4gICAgICBmb3IgKGNvbnN0IG9wZXJhbmQgb2YgcGFydHMub3BlcmFuZHMpIHtcbiAgICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAnaGVyZWRvYy13cml0ZScsIG9wZXJhbmQsIGN1cnJlbnREaXIpO1xuICAgICAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgICAgaWYgKHBhcnRzLmFwcGVuZCkge1xuICAgICAgICAgIGlmIChib2R5Lmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgICBzcGFuOiB7XG4gICAgICAgICAgICAgIG9wZXJhdGlvbjogJ2FwcGVuZCcsXG4gICAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgICAuLi4oY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDAgJiYgYm9keUxpdGVyYWwgPyB7IHdyaXR0ZW46IGJvZHkgfSA6IHt9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgICAgc3BhbjpcbiAgICAgICAgICAgICAgYm9keS5sZW5ndGggPT09IDBcbiAgICAgICAgICAgICAgICA/IHsgb3BlcmF0aW9uOiAndHJ1bmNhdGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICAgICAgICAgICAgOiB7XG4gICAgICAgICAgICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLFxuICAgICAgICAgICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgICAgICAgICAgLy8gU2FtZSByZXN0b3JlZC1gXFxuYCBleGFjdCBib2R5IGFzIHRoZSByZWRpcmVjdCBicmFuY2g7IGFcbiAgICAgICAgICAgICAgICAgICAgLy8gdGVlIG9wZXJhbmQgd2l0aCBhIGNvbnRlbnQgcmVkaXJlY3QgcHJlc2VudCBrZWVwcyB0aGVcbiAgICAgICAgICAgICAgICAgICAgLy8gcmVkaXJlY3QncyB0aHJlYWRpbmcgb25seSAobWlycm9yIG9mIHRoZSBhcHBlbmQgYnJhbmNoKS5cbiAgICAgICAgICAgICAgICAgICAgLi4uKGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAwICYmIGJvZHlMaXRlcmFsID8geyB3cml0dGVuOiBgJHtib2R5fVxcbmAgfSA6IHt9KVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGVtaXRDb250ZW50UmVkaXJlY3RzKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ID09PSAncGF0Y2gnIHx8IGhvc3QgPT09ICdnaXQnKSB7XG4gICAgY2xhc3NpZnlQYXRjaEhlcmVkb2MoYXJndiwgYm9keSwgY3VycmVudERpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gTm9uLWZhbWlseSBob3N0OiB0aGUgYm9keSBpcyBub3QgYXR0cmlidXRhYmxlIGNvbnRlbnQgXHUyMDE0IG5vIHdyaXRlIHRvdWNoLlxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBzZWQgLWkgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjYpLCB0aGUgZmlyc3QgY29uc3VtZXIgb2YgZXhhY3QgcmFuZ2VzOiBhXG4vLyBzdWJzdGl0dXRpb24tb25seSBzY3JpcHQgd2l0aCBudW1lcmljIGFkZHJlc3NlcyBtb2RpZmllcyB0aGUgYWRkcmVzc2VkXG4vLyBsaW5lczsgYW55dGhpbmcgbGVzcyBzdGF0aWNhbGx5IGNlcnRhaW4gaXMgYSB3aG9sZS1maWxlIG1vZGlmeS4gVGhlXG4vLyBzdWZmaXgvc2NyaXB0IGRpc2FtYmlndWF0aW9uIGFuZCB0aGUgc2VnbWVudCBjbGFzc2lmaWNhdGlvbiBiZWxvdyBhcmUgdGhlXG4vLyB3aG9sZSBvZiBpdCBcdTIwMTQgZXZlcnl0aGluZyBlbHNlIGZvbGxvd3MgdGhlIHNoYXJlZCBcdTAwQTc1IGZhaWwtY2xvc2VkIHJ1bGVzLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBIG51bWVyaWMtYWRkcmVzc2VkIHN1YnN0aXR1dGlvbiBzZWdtZW50IChgTmAsIGBOLE1gKSBcdTIwMTQgdGhlIG9ubHkgZm9ybSB3aXRoIGFuIGV4YWN0IHJhbmdlLiAqL1xuY29uc3QgTlVNRVJJQ19TVUJTVElUVVRJT04gPSAvXihcXGQrKSg/OiwoXFxkKykpP1tzeV0vO1xuXG4vKiogQW4gdW5hZGRyZXNzZWQgc3Vic3RpdHV0aW9uIHNlZ21lbnQgXHUyMDE0IGxpbmUtY291bnQtcHJlc2VydmluZywgd2hvbGUgZmlsZSBhZGRyZXNzZWQuICovXG5jb25zdCBVTlJFU1RSSUNURURfU1VCU1RJVFVUSU9OID0gL15bc3ldLztcblxuZnVuY3Rpb24gbWF0Y2hTZWRJbnBsYWNlKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGlmIChjb21tYW5kID09PSAnc2VkJykge1xuICAgIG1hdGNoU2VkSW5wbGFjZUFyZ3MocmVzdC5zbGljZSgxKSwgZGlyRm9yUmVzb2x1dGlvbiwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgaWYgKHdyYXBwZWQgPT09ICdzZWQnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnc2VkLWlucGxhY2UnLCB3cmFwcGVkLCBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogVGhlIHNlZCAtaSBvcGVyYW5kIGdyYW1tYXI6IGAtaWAgYmFyZSwgYC1pU1VGRklYYCBhdHRhY2hlZCwgb3IgYSBzZXBhcmF0ZVxuICogc3VmZml4IHdvcmQgcmVzb2x2ZWQgYnkgdGhlIHN0YW5kYXJkIGRpc2FtYmlndWF0aW9uIFx1MjAxNCB0aGUgd29yZCBhZnRlciBgLWlgXG4gKiBpcyB0aGUgc3VmZml4IG9ubHkgd2hlbiBpdCBkb2VzIG5vdCBzdGFydCB3aXRoIGAtYCwgaXMgbm90IHNjcmlwdC1zaGFwZWRcbiAqIChhIHNlZCBjb21tYW5kIGxldHRlciBvciBhbiBhZGRyZXNzIHN0YXJ0IFx1MjAxNCBgcy9hL2IvYCwgYDJkYCwgYC94L2RgKSwgYW5kIGFcbiAqIHNjcmlwdCBwbHVzIGF0IGxlYXN0IG9uZSBmaWxlIG9wZXJhbmQgc3RpbGwgZm9sbG93IGl0ICh0aGUgQlNEXG4gKiBzZXBhcmF0ZS1zdWZmaXggcmVhZGluZzsgR05VJ3MgYXR0YWNoZWQtb25seSByZWFkaW5nIG90aGVyd2lzZSkuIEFcbiAqIHNjcmlwdC1zaGFwZWQgd29yZCBpcyB0aGUgc2NyaXB0IHVuZGVyIEdOVSdzIHJlYWRpbmc6IGBzZWQgLWkgcy9hL2IvIGYgZ2BcbiAqIHdvdWxkIG90aGVyd2lzZSBzdGVhbCB0aGUgZmlyc3QgZmlsZSBvcGVyYW5kIGFzIGEgc3VmZml4IGFuZCBzaWxlbnRseSBtaXNzXG4gKiBpdHMgd3JpdGUgKHRoZSBtdWx0aS1maWxlLXNlZCBtaXNwYXJzZSkuIEFuIGF0dGFjaGVkIG9yIGRpc2FtYmlndWF0ZWRcbiAqIHN1ZmZpeCBpcyBhIGJhY2t1cDogYSBub24tZW1wdHkgc3VmZml4IGVtaXRzIGFuIGFkZGl0aW9uYWwgY3JlYXRlLW92ZXJ3cml0ZVxuICogdG91Y2ggb24gYDxmaWxlPjxTVUZGSVg+YDsgYW4gZW1wdHkgc3VmZml4ICh3aGljaCB0aGUgcXVvdGUtYXdhcmUgdG9rZW5pemVyXG4gKiBkcm9wcyBlbnRpcmVseSBcdTIwMTQgYHNlZCAtaSAnJyBmYCBhbmQgYHNlZCAtaSBmYCB0b2tlbml6ZSBhbGlrZSkgY3JlYXRlcyBub1xuICogYmFja3VwLlxuICpcbiAqIFRoZSBzY3JpcHQgaXMgdGhlIHNjcmlwdCBhcmd1bWVudCBwbHVzIGV2ZXJ5IGAtZWAgYXJndW1lbnQsIHNwbGl0IG9uIGA7YC5cbiAqIFNlZ21lbnRzIHRoYXQgYXJlIGFsbCBudW1lcmljLWFkZHJlc3NlZCBzdWJzdGl0dXRpb25zIHlpZWxkIHRoZSBleGFjdCByYW5nZVxuICogW21pbiBzdGFydCwgbWluKG1heCBlbmQsIEVPRildIChwZXIgZmlsZSwgRU9GIGZyb20gdGhlIHBvc3QtZWRpdCBjb3VudCk7XG4gKiBzZWdtZW50cyB0aGF0IGFyZSBhbGwgc3Vic3RpdHV0aW9ucyBcdTIwMTQgYW55IG51bWVyaWMvdW5hZGRyZXNzZWQgbWl4IFx1MjAxNCBhcmVcbiAqIHN0aWxsIGxpbmUtY291bnQtcHJlc2VydmluZywgc28gdGhlIHdob2xlIGZpbGUgaXMgYWRkcmVzc2VkIChbMSwgRU9GXSk7XG4gKiBhbnkgY291bnQtY2hhbmdpbmcsIHBhdHRlcm4tYWRkcmVzc2VkLCBzdGVwLCBvciBgJGAtYWRkcmVzc2VkIHNlZ21lbnQgaXMgYVxuICogd2hvbGUtZmlsZSBtb2RpZnkgd2l0aCBubyByYW5nZS4gQW4gYWJzZW50IHNjcmlwdCAobm8gc2NyaXB0IGFyZ3VtZW50LCBub1xuICogYC1lYCkgaXMgdW5yZXNvbHZlZC5cbiAqL1xuLyoqXG4gKiBBIHdvcmQgdGhhdCBjYW4gb25seSBiZSBhIHNlZCBzY3JpcHQsIG5ldmVyIGEgQlNEIHNlcGFyYXRlIHN1ZmZpeDogYSBzZWRcbiAqIGNvbW1hbmQgbGV0dGVyIChgc2AvYHlgL2BkYC9cdTIwMjYpLCBvciBhbiBhZGRyZXNzIHN0YXJ0IChkaWdpdCwgYC9gLCBgXFxgLCBgJGAsXG4gKiBgfmApLiBUaGUgbXVsdGktZmlsZSBmb3JtIGBzZWQgLWkgcy9hL2IvIGYgZ2AgcHV0cyB0aGUgc2NyaXB0IGltbWVkaWF0ZWx5XG4gKiBhZnRlciBiYXJlIGAtaWAgKEdOVSdzIHJlYWRpbmc7IHRoZSBCU0QgcmVhZGluZyBuZWVkcyBhIHNlcGFyYXRlIHN1ZmZpeFxuICogd29yZCBmaXJzdCwgYW5kIGEgbGV0dGVyLWxlYWRpbmcgb3IgYWRkcmVzcy1sZWFkaW5nIHdvcmQgaXMgbm90IG9uZSkuXG4gKi9cbmNvbnN0IFNFRF9TQ1JJUFRfU0hBUEUgPSAvXig/OltBLVphLXpdfFxcZHxcXC98XFxcXHxcXCR8fikvO1xuXG5mdW5jdGlvbiBtYXRjaFNlZElucGxhY2VBcmdzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgc3VmZml4OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHNhd0lucGxhY2UgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBlU2NyaXB0czogc3RyaW5nW10gPSBbXTtcbiAgLy8gVGhlIHNjcmlwdC9maWxlIHNwbGl0IG9mIHRoZSBwb3NpdGlvbmFscyBpcyBkZXJpdmVkIGFmdGVyIHRoZSBzY2FuOiB0aGVcbiAgLy8gZmlyc3QgcG9zaXRpb25hbCBpcyB0aGUgc2NyaXB0IGFyZ3VtZW50IG9ubHkgd2hlbiBubyBgLWVgIHNjcmlwdCBleGlzdHMgXHUyMDE0XG4gIC8vIHdpdGggYC1lYCBwcmVzZW50IGV2ZXJ5IHBvc2l0aW9uYWwgaXMgYSBmaWxlIChHTlUgc2VkIHJlYWRzIHRoZSBzY3JpcHRcbiAgLy8gZnJvbSBgLWVgIHRoZW4sIG5vdCBmcm9tIHRoZSBmaXJzdCBwb3NpdGlvbmFsKS5cbiAgY29uc3QgcG9zaXRpb25hbHM6IHN0cmluZ1tdID0gW107XG4gIC8vIEZpbGVzIHB1c2hlZCBvdXRzaWRlIHRoZSBwb3NpdGlvbmFsIHBhdGg6IGBzZWQgLWkgZmAgKHNjcmlwdCBhYnNlbnQpLlxuICBjb25zdCBmaWxlczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcblxuICB3aGlsZSAoaSA8IGFyZ3MubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIHBvc2l0aW9uYWxzLnB1c2goYSk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLW4nKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctZScpIHtcbiAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgYSwgJ3RoZSAtZSBmbGFnIGlzIGxlZnQgdmFsdWVsZXNzJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGVTY3JpcHRzLnB1c2godik7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctaScpIHtcbiAgICAgIHNhd0lucGxhY2UgPSB0cnVlO1xuICAgICAgY29uc3QgdyA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKHcgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBgc2VkIC1pYCB3aXRoIG5vdGhpbmcgYWZ0ZXI6IG5vIHN1ZmZpeCwgbm8gc2NyaXB0IFx1MjAxNCB0aGUgYWJzZW50LXNjcmlwdFxuICAgICAgICAvLyBjaGVjayBiZWxvdyByZXNvbHZlcyB0aGlzIHVucmVzb2x2ZWQuXG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAody5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgICAgLy8gVGhlIHdvcmQgYWZ0ZXIgLWkgaXMgYW4gb3B0aW9uLCBuZXZlciBhIHN1ZmZpeC5cbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc3RBZnRlciA9IGFyZ3Muc2xpY2UoaSArIDIpO1xuICAgICAgaWYgKHJlc3RBZnRlci5sZW5ndGggPj0gMiAmJiAhU0VEX1NDUklQVF9TSEFQRS50ZXN0KHcpKSB7XG4gICAgICAgIC8vIFRoZSBCU0Qgc2VwYXJhdGUtc3VmZml4IHJlYWRpbmc6IHcgaXMgdGhlIHN1ZmZpeCwgYW5kIGEgc2NyaXB0IHBsdXNcbiAgICAgICAgLy8gYXQgbGVhc3Qgb25lIGZpbGUgb3BlcmFuZCBzdGlsbCBmb2xsb3cgXHUyMDE0IG9ubHkgZm9yIGEgc3VmZml4LXNoYXBlZFxuICAgICAgICAvLyB3b3JkIChgLmJha2AsIGAnJ2ApLiBBIHNjcmlwdC1zaGFwZWQgd29yZCBpcyB0aGUgc2NyaXB0IHVuZGVyIEdOVSdzXG4gICAgICAgIC8vIHJlYWRpbmcsIHNvIGBzZWQgLWkgcy9hL2IvIGYgZ2AgdHJlYXRzIGBzL2EvYi9gIGFzIHRoZSBzY3JpcHQgYW5kXG4gICAgICAgIC8vIGJvdGggZiBhbmQgZyBhcyBmaWxlcy5cbiAgICAgICAgc3VmZml4ID0gdztcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChyZXN0QWZ0ZXIubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIGBzZWQgLWkgZmA6IHcgaXMgdGhlIGxhc3QgdG9rZW4gXHUyMDE0IG5vIHNjcmlwdCBjYW4gZm9sbG93LCBzbyB3IGlzIHRoZVxuICAgICAgICAvLyBmaWxlIG9wZXJhbmQgd2l0aCB0aGUgc2NyaXB0IGFic2VudCAoR05VIGluc3RlYWQgcmVhZHMgdyBhcyBhIHNjcmlwdFxuICAgICAgICAvLyBhbmQgZXJyb3JzOyBlaXRoZXIgd2F5IHRoZSBlZGl0IGRvZXMgbm90IGhhcHBlbikuXG4gICAgICAgIGZpbGVzLnB1c2godyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICAvLyBPbmUgdG9rZW4gYWZ0ZXIgdzogdyBpcyB0aGUgc2NyaXB0IGFyZ3VtZW50IChvciBhIGZpbGUsIHdoZW4gYC1lYFxuICAgICAgLy8gc2NyaXB0cyBhcmUgcHJlc2VudCkgYW5kIHRoZSB0b2tlbiBpcyBhIGZpbGUgXHUyMDE0IGNvbnN1bWUgYm90aCwgc29cbiAgICAgIC8vIG5laXRoZXIgZmFsbHMgdGhyb3VnaCB0byB0aGUgcG9zaXRpb25hbCBwYXRoIGFnYWluLlxuICAgICAgcG9zaXRpb25hbHMucHVzaCh3LCByZXN0QWZ0ZXJbMF0pO1xuICAgICAgaSArPSAzO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy1pJykgJiYgYS5sZW5ndGggPiAyKSB7XG4gICAgICBzYXdJbnBsYWNlID0gdHJ1ZTtcbiAgICAgIHN1ZmZpeCA9IGEuc2xpY2UoMik7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICAvLyBVbmtub3duIG9wdGlvbiBcdTIwMTQgbmV2ZXIgYSBzY3JpcHQgb3IgZmlsZS5cbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBwb3NpdGlvbmFscy5wdXNoKGEpO1xuICAgIGkgKz0gMTtcbiAgfVxuXG4gIGlmICghc2F3SW5wbGFjZSkgcmV0dXJuOyAvLyBub3QgYW4gaW4tcGxhY2UgZWRpdCBhdCBhbGxcbiAgY29uc3Qgc2NyaXB0QXJnID0gZVNjcmlwdHMubGVuZ3RoID09PSAwID8gKHBvc2l0aW9uYWxzWzBdID8/IG51bGwpIDogbnVsbDtcbiAgaWYgKHNjcmlwdEFyZyAhPT0gbnVsbCkgZmlsZXMucHVzaCguLi5wb3NpdGlvbmFscy5zbGljZSgxKSk7XG4gIGVsc2UgZmlsZXMucHVzaCguLi5wb3NpdGlvbmFscyk7XG4gIGNvbnN0IHNlZ21lbnRzOiBzdHJpbmdbXSA9IFtdO1xuICBpZiAoc2NyaXB0QXJnICE9PSBudWxsKSBzZWdtZW50cy5wdXNoKC4uLnNjcmlwdEFyZy5zcGxpdCgnOycpKTtcbiAgZm9yIChjb25zdCBzIG9mIGVTY3JpcHRzKSBzZWdtZW50cy5wdXNoKC4uLnMuc3BsaXQoJzsnKSk7XG4gIGlmIChzZWdtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnc2VkLWlucGxhY2UnLCBmaWxlc1swXSA/PyAnc2VkJywgJ25vIHNjcmlwdCAoYWJzZW50IG9yIGVtcHR5IHNjcmlwdCBhcmd1bWVudCknKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBTZWdtZW50IGNsYXNzaWZpY2F0aW9uOiBleGFjdCB3aGVuIGV2ZXJ5IHNlZ21lbnQgaXMgYSBudW1lcmljLWFkZHJlc3NlZFxuICAvLyBzdWJzdGl0dXRpb247IGV4cGxpY2l0IHdob2xlLWZpbGUgWzEsIEVPRl0gd2hlbiBldmVyeSBzZWdtZW50IGlzIHN0aWxsIGFcbiAgLy8gc3Vic3RpdHV0aW9uIChhbnkgdW5hZGRyZXNzZWQvbnVtZXJpYyBtaXgpOyBubyByYW5nZSBvdGhlcndpc2UuXG4gIGxldCBhbGxOdW1lcmljID0gdHJ1ZTtcbiAgbGV0IGFsbFN1YnN0aXR1dGlvbiA9IHRydWU7XG4gIGxldCBtaW5TdGFydCA9IEluZmluaXR5O1xuICBsZXQgbWF4RW5kID0gMDtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZ21lbnRzKSB7XG4gICAgY29uc3QgbSA9IHNlZ21lbnQubWF0Y2goTlVNRVJJQ19TVUJTVElUVVRJT04pO1xuICAgIGlmIChtID09PSBudWxsKSB7XG4gICAgICBhbGxOdW1lcmljID0gZmFsc2U7XG4gICAgICBpZiAoIVVOUkVTVFJJQ1RFRF9TVUJTVElUVVRJT04udGVzdChzZWdtZW50KSkgYWxsU3Vic3RpdHV0aW9uID0gZmFsc2U7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgcyA9IE51bWJlci5wYXJzZUludChtWzFdLCAxMCk7XG4gICAgY29uc3QgZSA9IG1bMl0gPT09IHVuZGVmaW5lZCA/IHMgOiBOdW1iZXIucGFyc2VJbnQobVsyXSwgMTApO1xuICAgIG1pblN0YXJ0ID0gTWF0aC5taW4obWluU3RhcnQsIHMpO1xuICAgIG1heEVuZCA9IE1hdGgubWF4KG1heEVuZCwgZSk7XG4gIH1cblxuICBmb3IgKGNvbnN0IGYgb2YgZmlsZXMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoZikpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIGYsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGRpciwgZik7XG4gICAgaWYgKGFsbE51bWVyaWMgfHwgYWxsU3Vic3RpdHV0aW9uKSB7XG4gICAgICBjb25zdCB0b3RhbCA9IGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgICAnc2VkLWlucGxhY2UnLFxuICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAnY291bGQgbm90IGRldGVybWluZSBlbmQtb2YtZmlsZSBsaW5lIGNvdW50IChmaWxlIHVucmVhZGFibGUsIGVtcHR5LCBvciBtaXNzaW5nKSdcbiAgICAgICAgKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBzdGFydCA9IGFsbE51bWVyaWMgPyBtaW5TdGFydCA6IDE7XG4gICAgICBjb25zdCBlbmQgPSBhbGxOdW1lcmljID8gTWF0aC5taW4obWF4RW5kLCB0b3RhbCkgOiB0b3RhbDtcbiAgICAgIGlmIChzdGFydCA+IGVuZCkgY29udGludWU7IC8vIHRoZSBhZGRyZXNzZWQgcmFuZ2UgbGllcyBiZXlvbmQgRU9GIFx1MjAxNCBub3RoaW5nIGlzIG1vZGlmaWVkXG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnc2VkLWlucGxhY2UnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ21vZGlmeScsIGxpbmVTdGFydDogc3RhcnQsIGxpbmVFbmQ6IGVuZCwgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdzZWQtaW5wbGFjZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnbW9kaWZ5JywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChzdWZmaXggIT09IG51bGwgJiYgc3VmZml4ICE9PSAnJykge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJywgYWJzb2x1dGVQYXRoOiBgJHthYnNvbHV0ZVBhdGh9JHtzdWZmaXh9YCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBwYXRjaCAvIGdpdCBhcHBseSBncmFtbWFyIChwbGFuIFx1MDBBNzUuNykuIFBhdGNoIHRleHQgc291cmNlcywgaW4gb3JkZXIgb2Zcbi8vIHJlY29nbml0aW9uOiBhIGxpdGVyYWwgcGF0Y2gtZmlsZSBvcGVyYW5kIChgZ2l0IGFwcGx5IDxmaWxlPmAgXHUyMDE0IGEgYHBhdGNoYFxuLy8gb3BlcmFuZCBpcyBhIHRhcmdldCBmaWxlLCBub3QgYSBzb3VyY2UsIGFuZCBpcyBpZ25vcmVkKSwgdGhlIHN0ZGluIGA8YFxuLy8gc291cmNlIChgcGF0Y2ggLXBOIDwgZmlsZWAsIGBnaXQgYXBwbHkgLSA8IGZpbGVgKSwgb3IgYSBoZXJlZG9jIGJvZHlcbi8vIChjbGFzc2lmeVBhdGNoSGVyZWRvYywgXHUwMEE3NS4yKS4gUmVhZC1vbmx5IG1vZGVzIChgLS1jaGVja2AvYC0tc3RhdGAvXG4vLyBgLS1udW1zdGF0YC9gLS1zdW1tYXJ5YCwgYHBhdGNoIC0tZHJ5LXJ1bmApIGFuZCBpbmRleC1vbmx5IGAtLWNhY2hlZGAgdG91Y2hcbi8vIG5vdGhpbmc7IGAtLWRpcmVjdG9yeWAgZmFpbHMgY2xvc2VkIChpdCByZXdyaXRlcyBwYXRjaCBwYXRocykuIEEgY29tbWFuZFxuLy8gd2l0aCBubyBzdGF0aWNhbGx5IGtub3duIHNvdXJjZSAocGlwZWQgb3IgdGVybWluYWwgc3RkaW4sIGEgdmFyaWFibGUgcGF0Y2hcbi8vIHBhdGgpIGlzIHVucmVzb2x2ZWQuIFRhcmdldHMgYW5kIHJhbmdlcyBjb21lIGZyb20gdGhlIG5ld1xuLy8gcmFuZ2UtcHJlc2VydmluZyB1bmlmaWVkLWRpZmYgcGFyc2VyICh1bmlmaWVkLWRpZmYudHMpLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgc2hhcmVkIGBwYXRjaGAvYGdpdCBhcHBseWAgb3B0aW9uIHN1cmZhY2UgKHBsYW4gXHUwMEE3NS43KTogc3RyaXAgbGV2ZWwsIHJlYWQtb25seSBhbmQgaW5kZXgtb25seSBtb2RlcywgYC0tZGlyZWN0b3J5YCwgYW5kIG9wZXJhbmRzLiAqL1xuaW50ZXJmYWNlIFBhdGNoQXBwbHlQYXJ0cyB7XG4gIHN0cmlwOiBQYXRoU3RyaXA7XG4gIHJlYWRPbmx5OiBib29sZWFuO1xuICBjYWNoZWRPbmx5OiBib29sZWFuO1xuICBkaXJlY3Rvcnk6IGJvb2xlYW47XG4gIG9wZXJhbmRzOiBzdHJpbmdbXTtcbn1cblxuZnVuY3Rpb24gcGF0Y2hBcHBseVBhcnRzKGFyZ3M6IHN0cmluZ1tdLCBpc0dpdEFwcGx5OiBib29sZWFuKTogUGF0Y2hBcHBseVBhcnRzIHtcbiAgbGV0IHN0cmlwOiBQYXRoU3RyaXAgPSBpc0dpdEFwcGx5ID8gMSA6ICdhdXRvJztcbiAgbGV0IHJlYWRPbmx5ID0gZmFsc2U7XG4gIGxldCBjYWNoZWRPbmx5ID0gZmFsc2U7XG4gIGxldCBkaXJlY3RvcnkgPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaXNHaXRBcHBseSkge1xuICAgICAgaWYgKGEgPT09ICctLWNoZWNrJyB8fCBhID09PSAnLS1zdGF0JyB8fCBhID09PSAnLS1udW1zdGF0JyB8fCBhID09PSAnLS1zdW1tYXJ5Jykge1xuICAgICAgICByZWFkT25seSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEgPT09ICctLWNhY2hlZCcpIHtcbiAgICAgICAgY2FjaGVkT25seSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEgPT09ICctLWluZGV4JyB8fCBhID09PSAnLVInIHx8IGEgPT09ICctLXJldmVyc2UnIHx8IGEgPT09ICctLXVuc2FmZS1wYXRocycgfHwgYSA9PT0gJy0tcmVqZWN0JykgY29udGludWU7XG4gICAgICBpZiAoYSA9PT0gJy0tZGlyZWN0b3J5Jykge1xuICAgICAgICBkaXJlY3RvcnkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tZGlyZWN0b3J5PScpKSB7XG4gICAgICAgIGRpcmVjdG9yeSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEgPT09ICctcCcpIHtcbiAgICAgICAgY29uc3QgdiA9IGFyZ3NbaSArIDFdO1xuICAgICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludCh2LCAxMCk7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKC9eLXBcXGQrJC8udGVzdChhKSkge1xuICAgICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDIpLCAxMCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gcGF0Y2hcbiAgICBpZiAoYSA9PT0gJy0tZHJ5LXJ1bicpIHtcbiAgICAgIHJlYWRPbmx5ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1OJyB8fCBhID09PSAnLS1mb3J3YXJkJykgY29udGludWU7XG4gICAgaWYgKGEgPT09ICctcCcpIHtcbiAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQgJiYgL15cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludCh2LCAxMCk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tcFxcZCskLy50ZXN0KGEpKSB7XG4gICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDIpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIHJldHVybiB7IHN0cmlwLCByZWFkT25seSwgY2FjaGVkT25seSwgZGlyZWN0b3J5LCBvcGVyYW5kcyB9O1xufVxuXG4vKiogVGhlIHBhdGNoIHRleHQgYXQgYGFic29sdXRlUGF0aGAsIG9yIG51bGwgd2hlbiBpdCBjYW4ndCBiZSByZWFkLiAqL1xuZnVuY3Rpb24gcmVhZFBhdGNoRmlsZShhYnNvbHV0ZVBhdGg6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICB0cnkge1xuICAgIHJldHVybiByZWFkRmlsZVN5bmMoYWJzb2x1dGVQYXRoLCAndXRmOCcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIEVtaXQgdGhlIHdyaXRlIHRvdWNoZXMgZm9yIGEgYHBhdGNoYC9gZ2l0IGFwcGx5YCBjb21tYW5kIHdpdGggYSBzdGF0aWNhbGx5XG4gKiBrbm93biBwYXRjaC10ZXh0IHNvdXJjZS4gYHRhcmdldERpcmAgaXMgd2hlcmUgdGhlIHBhdGNoJ3MgdGFyZ2V0IHBhdGhzXG4gKiByZXNvbHZlICh0aGUgZ2l0IGAtQ2AgZGlyZWN0b3J5IGZvciBgZ2l0IGFwcGx5YCwgdGhlIGN1cnJlbnQgZGlyZWN0b3J5XG4gKiBvdGhlcndpc2UpOyBgc2hlbGxEaXJgIGlzIHdoZXJlIHRoZSBzaGVsbCdzIHN0ZGluIGA8YCByZWRpcmVjdCB0YXJnZXRcbiAqIHJlc29sdmVzIFx1MjAxNCBhIHJlZGlyZWN0IGlzIHNoZWxsLXNpZGUsIHNvIGBnaXQgLUNgIG5ldmVyIGFmZmVjdHMgaXQuXG4gKi9cbmZ1bmN0aW9uIGVtaXRQYXRjaFRhcmdldHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBpc0dpdEFwcGx5OiBib29sZWFuLFxuICBob3N0OiBzdHJpbmcsXG4gIHRhcmdldERpcjogc3RyaW5nLFxuICBzaGVsbERpcjogc3RyaW5nLFxuICByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcGFydHMgPSBwYXRjaEFwcGx5UGFydHMoYXJncywgaXNHaXRBcHBseSk7XG4gIGlmIChwYXJ0cy5yZWFkT25seSB8fCBwYXJ0cy5jYWNoZWRPbmx5KSByZXR1cm47IC8vIHJlYWQtb25seSAvIGluZGV4LW9ubHkgXHUyMDE0IG5vIHRvdWNoZXNcbiAgaWYgKHBhcnRzLmRpcmVjdG9yeSkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICctLWRpcmVjdG9yeScsICctLWRpcmVjdG9yeSByZXdyaXRlcyBwYXRjaCBwYXRocycpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGxldCBwYXRjaFRleHQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgc291cmNlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgLy8gMS4gQSBsaXRlcmFsIHBhdGNoLWZpbGUgb3BlcmFuZCAoZ2l0IGFwcGx5IG9ubHk7IGEgcGF0Y2ggb3BlcmFuZCBpcyBhXG4gIC8vICAgIHRhcmdldCBmaWxlLCBub3QgYSBzb3VyY2UgXHUyMDE0IGlnbm9yZWQpLlxuICBpZiAoaXNHaXRBcHBseSkge1xuICAgIGNvbnN0IG9wZXJhbmQgPSBwYXJ0cy5vcGVyYW5kcy5maW5kKChvKSA9PiBvICE9PSAnLScpO1xuICAgIGlmIChvcGVyYW5kICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBvcGVyYW5kLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc291cmNlID0gcmVzb2x2ZVBhdGgodGFyZ2V0RGlyLCBvcGVyYW5kKTtcbiAgICAgIHBhdGNoVGV4dCA9IHJlYWRQYXRjaEZpbGUoc291cmNlKTtcbiAgICAgIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc291cmNlLCAncGF0Y2ggZmlsZSB1bnJlYWRhYmxlIG9yIG1pc3NpbmcnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICAvLyAyLiBUaGUgc3RkaW4gYDxgIHNvdXJjZSAocGF0Y2ggYW5kIGdpdCBhcHBseSkuXG4gIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICBjb25zdCBzdGRpbiA9IHJlZGlyZWN0cy5maW5kKChyKSA9PiByLm9wID09PSAnPCcpO1xuICAgIGlmIChzdGRpbiAhPT0gdW5kZWZpbmVkICYmIHN0ZGluLnRhcmdldCAhPT0gbnVsbCkge1xuICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHN0ZGluLnRhcmdldCkpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc3RkaW4udGFyZ2V0LCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc291cmNlID0gcmVzb2x2ZVBhdGgoc2hlbGxEaXIsIHN0ZGluLnRhcmdldCk7XG4gICAgICBwYXRjaFRleHQgPSByZWFkUGF0Y2hGaWxlKHNvdXJjZSk7XG4gICAgICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHNvdXJjZSwgJ3BhdGNoIHRleHQgdW5yZWFkYWJsZSBvciBtaXNzaW5nJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgLy8gMy4gTm8gc3RhdGljYWxseSBrbm93biBzb3VyY2U6IHN0ZGluIGlzIGR5bmFtaWMgKHRlcm1pbmFsLCBwaXBlLCB2YXJpYWJsZSkuXG4gIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBob3N0LCAnbm8gc3RhdGljYWxseSBrbm93biBwYXRjaCB0ZXh0IHNvdXJjZSAoc3RkaW4gaXMgZHluYW1pYyknKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCB0YXJnZXRzID0gcGFyc2VVbmlmaWVkRGlmZlJhbmdlKHBhdGNoVGV4dCwgcGFydHMuc3RyaXApO1xuICBpZiAodGFyZ2V0cyA9PT0gbnVsbCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHNvdXJjZSA/PyBob3N0LCAnbWFsZm9ybWVkIG9yIGVtcHR5IHBhdGNoIHRleHQnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZm9yIChjb25zdCB0IG9mIHRhcmdldHMpIHtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHQucGF0aCwgdGFyZ2V0RGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdwYXRjaC13cml0ZScsXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogdC5vcGVyYXRpb24sXG4gICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luLFxuICAgICAgICAuLi4odC5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCA/IHsgbGluZVN0YXJ0OiB0LmxpbmVTdGFydCwgbGluZUVuZDogdC5saW5lRW5kIH0gOiB7fSlcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBwYXRjaC9naXQgYXBwbHkgZ3JhbW1hciBpbiB0aGUgbWFpbiB3YWxrOiBgcGF0Y2hgIHJlYWRzIHBhdGNoIHRleHQgZnJvbVxuICogc3RkaW4gb3IgYSBgPGAgcmVkaXJlY3Q7IGBnaXQgYXBwbHlgIGFkZGl0aW9uYWxseSBhY2NlcHRzIGEgcGF0Y2gtZmlsZVxuICogb3BlcmFuZCBhbmQgcmVzb2x2ZXMgdGFyZ2V0cyBhZ2FpbnN0IGl0cyBgLUNgIGRpcmVjdG9yeS4gQSB3cmFwcGVkXG4gKiBgcGF0Y2hgL2BhcHBseWAgaXMgdW5yZXNvbHZlZCBcdTIwMTQgdGhlIHdyYXBwZXIgb2JzY3VyZXMgdGhlIGFyZ3YuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUGF0Y2hBcHBseShcbiAgYXJndjogc3RyaW5nW10sXG4gIHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ3BhdGNoJykge1xuICAgIGVtaXRQYXRjaFRhcmdldHMoXG4gICAgICByZXN0LnNsaWNlKDEpLFxuICAgICAgZmFsc2UsXG4gICAgICAncGF0Y2gnLFxuICAgICAgZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIGRpckZvclJlc29sdXRpb24sXG4gICAgICByZWRpcmVjdHMsXG4gICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICBqb2luLFxuICAgICAgcmVzdWx0c1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgPT09IG51bGwgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdhcHBseScpIHJldHVybjtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICdhcHBseScsICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZW1pdFBhdGNoVGFyZ2V0cyhcbiAgICAgIHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpLFxuICAgICAgdHJ1ZSxcbiAgICAgICdhcHBseScsXG4gICAgICBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIHJlZGlyZWN0cyxcbiAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgIGpvaW4sXG4gICAgICByZXN1bHRzXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgaWYgKHdyYXBwZWQgPT09ICdwYXRjaCcgfHwgd3JhcHBlZCA9PT0gJ2FwcGx5Jykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgd3JhcHBlZCwgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFRoZSBoZXJlZG9jIHBhdGNoLXRleHQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjcpOiBhIGBwYXRjaGAvYGdpdCBhcHBseWAgaGVyZWRvY1xuICogYm9keSBpcyBwYXRjaCB0ZXh0LiBUaGUgb3BlbmVyJ3Mgb3duIG9wdGlvbnMgc3RpbGwgYXBwbHkgXHUyMDE0IGAtLWRyeS1ydW5gL1xuICogYC0tY2hlY2tgL2AtLXN0YXRgL2AtLW51bXN0YXRgL2AtLXN1bW1hcnlgL2AtLWNhY2hlZGAgbWFrZSB0aGUgYm9keVxuICogcmVhZC1vbmx5IChubyB0b3VjaGVzKSwgYC0tZGlyZWN0b3J5YCBmYWlscyBjbG9zZWQsIGFuZCBgLXBOYCBzZXRzIHRoZVxuICogaGVhZGVyIHN0cmlwIGxldmVsLlxuICovXG5mdW5jdGlvbiBjbGFzc2lmeVBhdGNoSGVyZWRvYyhcbiAgYXJndjogc3RyaW5nW10sXG4gIGJvZHk6IHN0cmluZyxcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGxldCBpc0dpdEFwcGx5ID0gZmFsc2U7XG4gIGxldCBhcmdzOiBzdHJpbmdbXTtcbiAgbGV0IGRpciA9IGN1cnJlbnREaXI7XG4gIGlmIChjb21tYW5kID09PSAncGF0Y2gnKSB7XG4gICAgYXJncyA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViID09PSBudWxsIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnYXBwbHknKSByZXR1cm47XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnYXBwbHknLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlzR2l0QXBwbHkgPSB0cnVlO1xuICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgICBkaXIgPSBzdWIuY0RpciA/PyBjdXJyZW50RGlyO1xuICB9IGVsc2Uge1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBwYXJ0cyA9IHBhdGNoQXBwbHlQYXJ0cyhhcmdzLCBpc0dpdEFwcGx5KTtcbiAgaWYgKHBhcnRzLnJlYWRPbmx5IHx8IHBhcnRzLmNhY2hlZE9ubHkpIHJldHVybjtcbiAgaWYgKHBhcnRzLmRpcmVjdG9yeSkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICctLWRpcmVjdG9yeScsICctLWRpcmVjdG9yeSByZXdyaXRlcyBwYXRjaCBwYXRocycpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB0YXJnZXRzID0gcGFyc2VVbmlmaWVkRGlmZlJhbmdlKGJvZHksIHBhcnRzLnN0cmlwKTtcbiAgaWYgKHRhcmdldHMgPT09IG51bGwpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnaGVyZWRvYycsICdtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggdGV4dCcpO1xuICAgIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IHQgb2YgdGFyZ2V0cykge1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgdC5wYXRoLCBkaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3BhdGNoLXdyaXRlJyxcbiAgICAgIHNwYW46IHtcbiAgICAgICAgb3BlcmF0aW9uOiB0Lm9wZXJhdGlvbixcbiAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIC4uLih0LmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkID8geyBsaW5lU3RhcnQ6IHQubGluZVN0YXJ0LCBsaW5lRW5kOiB0LmxpbmVFbmQgfSA6IHt9KVxuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIGZvcm1hdHRlciAvIGZpeGVyIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS44KTogYSB0YWJsZS1kcml2ZW4gZmFtaWx5IG92ZXIgdGhlXG4vLyBjb3JwdXMtZGVyaXZlZCAxNi10b29sIHNldC4gRmxhZyBtYXRjaGluZyBpcyBleGFjdC10b2tlbiBvbiBmdWxsIGFyZ3Ygd29yZHMgXHUyMDE0XG4vLyBuZXZlciBwcmVmaXggb3Igc3Vic3RyaW5nIFx1MjAxNCBhbmQgdGhlIHJlYWQtb25seSBsaXN0IGlzIGNvbnN1bHRlZCBmaXJzdCwgc29cbi8vIGAtLWZpeC1kcnktcnVuYCBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGAtLWZpeGAgYW5kIGBibGFjayAtLWNoZWNrYCBuZXZlclxuLy8gaGVhbHMuIFRvb2xzIHdob3NlIHdyaXRlIGZvcm0gaXMgYSBiYXJlIGludm9jYXRpb24gKGJsYWNrLCBpc29ydCwgcnVzdGZtdClcbi8vIGNhcnJ5IHRoZSBlbXB0eSBmb3JtIGFuZCBmaXJlIG9uIHRoZSB3cml0ZSBmb3JtIGl0c2VsZi4gTGVhZGluZyB0cmFuc3BhcmVudFxuLy8gcGFja2FnZS1ydW5uZXIgd3JhcHBlcnMgKG5weCwgeWFybiwgcG5wbSBleGVjL2RseCwgYnVueCwgbnBtIGV4ZWMpIHN0cmlwXG4vLyB1bmRlciBhIHBpbm5lZCBvcHRpb24gZ3JhbW1hcjsgYSB3cmFwcGVyIHRoYXQgY291bGQgcmV3cml0ZSBhcmd2IGZhaWxzXG4vLyBjbG9zZWQgYXMgdW5yZXNvbHZlZC5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogT25lIFx1MDBBNzUuOCB0YWJsZSByb3c6IHRoZSB0b29sIGNvbW1hbmQgYW5kIGl0cyB3cml0ZS9yZWFkLW9ubHkgdG9rZW4gZm9ybXMuICovXG5leHBvcnQgaW50ZXJmYWNlIEZvcm1hdHRlclRvb2xSb3cge1xuICBjb21tYW5kOiBzdHJpbmc7XG4gIC8qKiBUb2tlbiBzZXF1ZW5jZXMgd2hvc2UgZXhhY3QtdG9rZW4gcHJlc2VuY2UgbWFya3MgdGhlIGludm9jYXRpb24gYSB3cml0ZS4gKi9cbiAgd3JpdGVGb3Jtczogc3RyaW5nW11bXTtcbiAgLyoqIFRva2VuIHNlcXVlbmNlcyBjb25zdWx0ZWQgZmlyc3QgXHUyMDE0IHByZXNlbmNlIHN1cHByZXNzZXMgdGhlIHdyaXRlICh0aGUgcmVhZC1vbmx5IG1vZGUgd2lucykuICovXG4gIHJlYWRPbmx5Rm9ybXM6IHN0cmluZ1tdW107XG59XG5cbi8qKlxuICogVGhlIFx1MDBBNzUuOCB0YWJsZSwgZXhwb3J0ZWQgc28gdGhlIGNvcnB1cy1jb3ZlcmFnZSBmaXh0dXJlIGNhbiBhc3NlcnQgdHdvLXNpZGVkXG4gKiB0b29sLXNldCBlcXVhbGl0eSBhbmQgcGVyLXRvb2wgcmVhZC1vbmx5IHN1cHByZXNzaW9uIChwbGFuIFx1MDBBNzUuOCwgUGhhc2UgM1xuICogc3RlcCA4KS5cbiAqL1xuZXhwb3J0IGNvbnN0IEZPUk1BVFRFUl9UQUJMRTogcmVhZG9ubHkgRm9ybWF0dGVyVG9vbFJvd1tdID0gW1xuICB7XG4gICAgY29tbWFuZDogJ3ByZXR0aWVyJyxcbiAgICB3cml0ZUZvcm1zOiBbWyctLXdyaXRlJ10sIFsnLXcnXV0sXG4gICAgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjayddLCBbJy0tbGlzdC1kaWZmZXJlbnQnXSwgWyctLWRlYnVnLWNoZWNrJ11dXG4gIH0sXG4gIHsgY29tbWFuZDogJ2VzbGludCcsIHdyaXRlRm9ybXM6IFtbJy0tZml4J11dLCByZWFkT25seUZvcm1zOiBbWyctLWZpeC1kcnktcnVuJ11dIH0sXG4gIHtcbiAgICBjb21tYW5kOiAnYmlvbWUnLFxuICAgIHdyaXRlRm9ybXM6IFtcbiAgICAgIFsnY2hlY2snLCAnLS13cml0ZSddLFxuICAgICAgWydjaGVjaycsICctLWZpeCddLFxuICAgICAgWydmb3JtYXQnLCAnLS13cml0ZSddXG4gICAgXSxcbiAgICByZWFkT25seUZvcm1zOiBbXVxuICB9LFxuICB7IGNvbW1hbmQ6ICdnb2ZtdCcsIHdyaXRlRm9ybXM6IFtbJy13J11dLCByZWFkT25seUZvcm1zOiBbWyctbCddXSB9LFxuICB7IGNvbW1hbmQ6ICdnb2ltcG9ydHMnLCB3cml0ZUZvcm1zOiBbWyctdyddXSwgcmVhZE9ubHlGb3JtczogW10gfSxcbiAgeyBjb21tYW5kOiAnY2xhbmctZm9ybWF0Jywgd3JpdGVGb3JtczogW1snLWknXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tZHJ5LXJ1biddXSB9LFxuICB7IGNvbW1hbmQ6ICdzaGZtdCcsIHdyaXRlRm9ybXM6IFtbJy13J11dLCByZWFkT25seUZvcm1zOiBbWyctZCddXSB9LFxuICB7IGNvbW1hbmQ6ICd5YXBmJywgd3JpdGVGb3JtczogW1snLWknXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tZGlmZiddXSB9LFxuICB7IGNvbW1hbmQ6ICdhdXRvcGVwOCcsIHdyaXRlRm9ybXM6IFtbJy1pJ11dLCByZWFkT25seUZvcm1zOiBbWyctZCddLCBbJy0tZGlmZiddXSB9LFxuICB7IGNvbW1hbmQ6ICdibGFjaycsIHdyaXRlRm9ybXM6IFtbXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2snXSwgWyctLWRpZmYnXV0gfSxcbiAgeyBjb21tYW5kOiAnaXNvcnQnLCB3cml0ZUZvcm1zOiBbW11dLCByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrLW9ubHknXSwgWyctLWRpZmYnXV0gfSxcbiAge1xuICAgIGNvbW1hbmQ6ICdydWZmJyxcbiAgICB3cml0ZUZvcm1zOiBbWydmb3JtYXQnXSwgWydjaGVjaycsICctLWZpeCddXSxcbiAgICByZWFkT25seUZvcm1zOiBbXG4gICAgICBbJ2NoZWNrJywgJy0tbm8tZml4J10sXG4gICAgICBbJ2Zvcm1hdCcsICctLWNoZWNrJ11cbiAgICBdXG4gIH0sXG4gIHsgY29tbWFuZDogJ2Rlbm8nLCB3cml0ZUZvcm1zOiBbWydmbXQnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJ2ZtdCcsICctLWNoZWNrJ11dIH0sXG4gIHsgY29tbWFuZDogJ2RwcmludCcsIHdyaXRlRm9ybXM6IFtbJ2ZtdCddXSwgcmVhZE9ubHlGb3JtczogW1snY2hlY2snXV0gfSxcbiAgeyBjb21tYW5kOiAncnVzdGZtdCcsIHdyaXRlRm9ybXM6IFtbXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2snXSwgWyctLWVtaXQnLCAnc3Rkb3V0J11dIH0sXG4gIHtcbiAgICBjb21tYW5kOiAndGVycmFmb3JtJyxcbiAgICB3cml0ZUZvcm1zOiBbWydmbXQnXV0sXG4gICAgcmVhZE9ubHlGb3JtczogW1xuICAgICAgWydmbXQnLCAnLWNoZWNrJ10sXG4gICAgICBbJ2ZtdCcsICctZGlmZiddXG4gICAgXVxuICB9XG5dO1xuXG4vKiogVGhlIHBpbm5lZCBwYWNrYWdlLXJ1bm5lciBuby1hcmcgZmxhZ3MgKHBsYW4gXHUwMEE3NS44KTogZmxhZ3MgdGhhdCBjYW5ub3QgbW92ZSBvciByZXdyaXRlIGFyZ3YuICovXG5jb25zdCBSVU5ORVJfTk9fQVJHX0ZMQUdTID0gbmV3IFNldChbJy15JywgJy0teWVzJywgJy0tbm8taW5zdGFsbCddKTtcblxuLyoqIFRoZSBvdXRjb21lIG9mIHN0cmlwcGluZyBvbmUgbGVhZGluZyBwYWNrYWdlLXJ1bm5lciB3cmFwcGVyLiAqL1xudHlwZSBSdW5uZXJTdHJpcCA9IHsga2luZDogJ3N0cmlwcGVkJzsgc3RyaXBwZWQ6IHN0cmluZ1tdIH0gfCB7IGtpbmQ6ICdvYnNjdXJlZCcgfTtcblxuLyoqXG4gKiBTdHJpcCBvbmUgbGVhZGluZyB0cmFuc3BhcmVudCBwYWNrYWdlLXJ1bm5lciB3cmFwcGVyIChwbGFuIFx1MDBBNzUuOCk6IGBucHhgLFxuICogYHlhcm5gLCBgcG5wbSBleGVjYC9gcG5wbSBkbHhgLCBgYnVueGAsIGFuZCBgbnBtIGV4ZWNgIGZvbGxvd2VkIGRpcmVjdGx5IGJ5XG4gKiB0aGUgd3JhcHBlZCBjb21tYW5kIHdvcmQsIHdpdGggb25seSB0aGUgcGlubmVkIG5vLWFyZyBmbGFncyAoYC15YC9gLS15ZXNgLFxuICogYC0tbm8taW5zdGFsbGApIGFuZCBgbnBtIGV4ZWNgJ3MgYC0tYCB0ZXJtaW5hdG9yIGJldHdlZW4uIEEgc3RyaW5nLWZvcm1cbiAqIGFyZ3VtZW50IChgbnB4IFwicHJldHRpZXIgLS13cml0ZSBmXCJgKSwgYW4gYXJndi1hbHRlcmluZyBydW5uZXIgZmxhZ1xuICogKGAtLXBhY2thZ2U9WGAgb3IgYSBmbGFnIGNvbnN1bWluZyB0aGUgbmV4dCB3b3JkKSwgb3IgYSB3cmFwcGVyIHdvcmQgdGhhdCBpc1xuICogaXRzZWxmIGEgc2NyaXB0IChgLmAtcHJlZml4ZWQpIG9ic2N1cmVzIHRoZSB3cmFwcGVkIGFyZ3YgXHUyMDE0IHRoZSB3cmFwcGVyIGlzXG4gKiB0cmFuc3BhcmVudCBvbmx5IHdoZW4gdGhlIHBpbm5lZCBncmFtbWFyIHByb3ZlcyBpdCBzby4gUmV0dXJucyAnbm90LXJ1bm5lcidcbiAqIHdoZW4gdGhlIHdvcmQgaXMgbm90IGEgcnVubmVyIGF0IGFsbCAoYSBkaWZmZXJlbnQgbnBtL3BucG0gc3ViY29tbWFuZCwgb3IgYVxuICogYmFyZSBydW5uZXIgd2l0aCBubyBjb21tYW5kIHdvcmQpIFx1MjAxNCB0aGUgdGFibGUgbWF0Y2hlcyBpdCBkaXJlY3RseSwgd2hpY2hcbiAqIGZhaWxzIGNsb3NlZCBmb3Igbm9uLWZvcm1hdHRlciBydW5uZXJzLlxuICovXG5mdW5jdGlvbiBzdHJpcFBhY2thZ2VSdW5uZXIoYXJndjogc3RyaW5nW10pOiBSdW5uZXJTdHJpcCB8ICdub3QtcnVubmVyJyB7XG4gIGNvbnN0IHJ1bm5lciA9IGFyZ3ZbMF07XG4gIGxldCByZXN0ID0gYXJndi5zbGljZSgxKTtcbiAgaWYgKHJ1bm5lciA9PT0gJ25weCcgfHwgcnVubmVyID09PSAneWFybicgfHwgcnVubmVyID09PSAnYnVueCcpIHtcbiAgICAvLyBUaGVzZSBydW5uZXJzIHRha2UgdGhlIGNvbW1hbmQgd29yZCBkaXJlY3RseS5cbiAgfSBlbHNlIGlmIChydW5uZXIgPT09ICdwbnBtJykge1xuICAgIGlmIChyZXN0WzBdICE9PSAnZXhlYycgJiYgcmVzdFswXSAhPT0gJ2RseCcpIHJldHVybiAnbm90LXJ1bm5lcic7XG4gICAgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSBpZiAocnVubmVyID09PSAnbnBtJykge1xuICAgIGlmIChyZXN0WzBdICE9PSAnZXhlYycpIHJldHVybiAnbm90LXJ1bm5lcic7XG4gICAgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuICdub3QtcnVubmVyJztcbiAgfVxuICB3aGlsZSAoUlVOTkVSX05PX0FSR19GTEFHUy5oYXMocmVzdFswXSkpIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICBpZiAocnVubmVyID09PSAnbnBtJyAmJiByZXN0WzBdID09PSAnLS0nKSByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm4gJ25vdC1ydW5uZXInOyAvLyBhIGJhcmUgcnVubmVyIGF0dHJpYnV0ZXMgbm90aGluZ1xuICBjb25zdCB3cmFwcGVkID0gcmVzdFswXTtcbiAgaWYgKHdyYXBwZWQuc3RhcnRzV2l0aCgnLScpIHx8IHdyYXBwZWQuc3RhcnRzV2l0aCgnLicpIHx8IC9cXHMvLnRlc3Qod3JhcHBlZCkpIHJldHVybiB7IGtpbmQ6ICdvYnNjdXJlZCcgfTtcbiAgcmV0dXJuIHsga2luZDogJ3N0cmlwcGVkJywgc3RyaXBwZWQ6IHJlc3QgfTtcbn1cblxuLyoqXG4gKiBUaGUgZm9ybWF0dGVyL2ZpeGVyIGZhbWlseSAocGxhbiBcdTAwQTc1LjgpLiBUaGUgcmVhZC1vbmx5IGZvcm1zIGFyZSBjb25zdWx0ZWRcbiAqIGZpcnN0IGFuZCB3aW4gb3ZlciBhbnkgd3JpdGUgZm9ybTsgYSB3cml0ZSBmb3JtIHdpdGggbm8gcmVhZC1vbmx5IGZvcm0gYW5kXG4gKiBldmVyeSBvcGVyYW5kIGFuIGV4cGxpY2l0IGZpbGUgZW1pdHMgYSB3aG9sZS1maWxlIGBtb2RpZnlgIHBlciBvcGVyYW5kO1xuICogZGlyZWN0b3J5L2dsb2Ivbm8tb3BlcmFuZCBpbnZvY2F0aW9ucyB0b3VjaCBub3RoaW5nOyB1bmtub3duIGV4ZWN1dGFibGVzXG4gKiBmYWlsIGNsb3NlZC4gQSBmb3JtJ3MgbGVhZGluZyBzdWJjb21tYW5kIHdvcmQgKGBjaGVja2AvYGZvcm1hdGAvYGZtdGApIGlzXG4gKiBwb3NpdGlvbmFsIFx1MjAxNCBpdCBtdXN0IGxlYWQgdGhlIHRvb2wncyBhcmdzLCBzbyBgZGVubyB0YXNrIGZtdGAgaXMgYSBzY3JpcHRcbiAqIHJ1bm5lciwgbm90IGEgZm9ybWF0dGVyLlxuICovXG5mdW5jdGlvbiBtYXRjaEZvcm1hdHRlcihcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGxldCB3b3JkcyA9IHJlc3Q7XG4gIGNvbnN0IHN0cmlwID0gc3RyaXBQYWNrYWdlUnVubmVyKHJlc3QpO1xuICBpZiAoc3RyaXAgPT09ICdub3QtcnVubmVyJykge1xuICAgIC8vIHJlc3RbMF0gaXMgbm90IGEgcGFja2FnZSBydW5uZXIgXHUyMDE0IHRoZSB0YWJsZSBtYXRjaGVzIGl0IGRpcmVjdGx5LlxuICB9IGVsc2UgaWYgKHN0cmlwLmtpbmQgPT09ICdvYnNjdXJlZCcpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnZm9ybWF0dGVyLXdyaXRlJywgcmVzdFswXSwgYHRoZSAke3Jlc3RbMF19IHdyYXBwZXIgb2JzY3VyZXMgdGhlIHdyYXBwZWQgYXJndmApO1xuICAgIHJldHVybjtcbiAgfSBlbHNlIHtcbiAgICB3b3JkcyA9IHN0cmlwLnN0cmlwcGVkO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyh3b3Jkc1swXSkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gd29yZHNbMV07XG4gICAgaWYgKHdyYXBwZWQgIT09IHVuZGVmaW5lZCAmJiBGT1JNQVRURVJfVEFCTEUuc29tZSgocikgPT4gci5jb21tYW5kID09PSB3cmFwcGVkKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ2Zvcm1hdHRlci13cml0ZScsIHdyYXBwZWQsIGB0aGUgJHt3b3Jkc1swXX0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3cgPSBGT1JNQVRURVJfVEFCTEUuZmluZCgocikgPT4gci5jb21tYW5kID09PSB3b3Jkc1swXSk7XG4gIGlmIChyb3cgPT09IHVuZGVmaW5lZCkgcmV0dXJuOyAvLyB1bmtub3duIGV4ZWN1dGFibGUgXHUyMDE0IGZhaWwgY2xvc2VkLCBubyB0b3VjaFxuICBjb25zdCBhcmdzID0gd29yZHMuc2xpY2UoMSk7XG4gIGNvbnN0IGZvcm1QcmVzZW50ID0gKGZvcm06IHN0cmluZ1tdKTogYm9vbGVhbiA9PiB7XG4gICAgY29uc3QgZmlyc3QgPSBmb3JtWzBdO1xuICAgIGlmIChmaXJzdCAhPT0gdW5kZWZpbmVkICYmICFmaXJzdC5zdGFydHNXaXRoKCctJykgJiYgYXJnc1swXSAhPT0gZmlyc3QpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gZm9ybS5ldmVyeSgodG9rZW4pID0+IGFyZ3MuaW5jbHVkZXModG9rZW4pKTtcbiAgfTtcbiAgLy8gVGhlIHJlYWQtb25seSBsaXN0IGlzIGNvbnN1bHRlZCBmaXJzdCBhbmQgd2lucyBvdmVyIGFueSB3cml0ZSBmb3JtOlxuICAvLyBgZXNsaW50IC0tZml4IC0tZml4LWRyeS1ydW4gZmAgd3JpdGVzIG5vdGhpbmcsIGBibGFjayAtLWNoZWNrIGZgIG5ldmVyIGhlYWxzLlxuICBpZiAocm93LnJlYWRPbmx5Rm9ybXMuc29tZShmb3JtUHJlc2VudCkpIHJldHVybjtcbiAgaWYgKCFyb3cud3JpdGVGb3Jtcy5zb21lKGZvcm1QcmVzZW50KSkgcmV0dXJuOyAvLyBiYXJlIGludm9jYXRpb25zIG9mIGZsYWctcmVxdWlyZWQgdG9vbHMgYXJlIHJlYWQtb25seSAoc3Rkb3V0L2xpbnQpXG4gIC8vIENvbnN1bWUgdGhlIHRvb2wncyBzdWJjb21tYW5kIHdvcmQgYmVmb3JlIGNvbGxlY3Rpbmcgb3BlcmFuZHMuXG4gIGNvbnN0IHN1YmNvbW1hbmRXb3JkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGZvcm0gb2Ygcm93LndyaXRlRm9ybXMpIHtcbiAgICBmb3IgKGNvbnN0IHRva2VuIG9mIGZvcm0pIHtcbiAgICAgIGlmICghdG9rZW4uc3RhcnRzV2l0aCgnLScpKSBzdWJjb21tYW5kV29yZHMuYWRkKHRva2VuKTtcbiAgICB9XG4gIH1cbiAgY29uc3QgYWZ0ZXJTdWJjb21tYW5kID0gc3ViY29tbWFuZFdvcmRzLmhhcyhhcmdzWzBdKSA/IGFyZ3Muc2xpY2UoMSkgOiBhcmdzO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBhIG9mIGFmdGVyU3ViY29tbWFuZCkge1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb24gKHNoYXJlZCBcdTAwQTc1KVxuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgaWYgKG9wZXJhbmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuOyAvLyBuby1vcGVyYW5kIGludm9jYXRpb25zIHRvdWNoIG5vdGhpbmdcbiAgLy8gRXZlcnkgb3BlcmFuZCBtdXN0IGJlIGFuIGV4cGxpY2l0IGZpbGUgXHUyMDE0IGEgZ2xvYiwgdmFyaWFibGUsIGRpcmVjdG9yeSwgb3JcbiAgLy8gdHJhaWxpbmctc2xhc2ggb3BlcmFuZCBmYWlscyB0aGUgd2hvbGUgY29tbWFuZCBjbG9zZWQuXG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ2Zvcm1hdHRlci13cml0ZScsIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAob3BlcmFuZC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkocmVzb2x2ZVBhdGgoZGlyRm9yUmVzb2x1dGlvbiwgb3BlcmFuZCkpKSByZXR1cm47XG4gIH1cbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAnZm9ybWF0dGVyLXdyaXRlJyxcbiAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnbW9kaWZ5JywgYWJzb2x1dGVQYXRoOiByZXNvbHZlUGF0aChkaXJGb3JSZXNvbHV0aW9uLCBvcGVyYW5kKSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBnaXQgcmVzdG9yZSAvIGdpdCBjaGVja291dCBncmFtbWFyIChwbGFuIFx1MDBBNzUuOSksIHRoZSBsYXN0IHB1cmUtcGFyc2VyXG4vLyBmYW1pbHkuIFJlc3RvcmUgaGFzIG5vIHJldmlzaW9uIG9wZXJhbmQgZm9ybSBcdTIwMTQgaXRzIHBvc2l0aW9uYWwgYXJncyBhcmVcbi8vIGFsd2F5cyBwYXRoc3BlY3M7IGNoZWNrb3V0IHNraXBzIGEgcHJlLWAtLWAgcmV2aXNpb24vcmVmIG9wZXJhbmQgYW5kIHRha2VzXG4vLyBwYXRoc3BlY3Mgb25seSBhZnRlciBgLS1gLiBFdmVyeSBleHBsaWNpdC1maWxlIHBhdGhzcGVjIGlzIGEgd2hvbGUtZmlsZVxuLy8gY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaDsgYSBkaXJlY3Rvcnktc2hhcGVkIHBhdGhzcGVjIChgLmAvYC4uYCwgdHJhaWxpbmcgYC9gLFxuLy8gb3IgYSBwYXRoIHRoYXQgc3RhdHMgYXMgYSBkaXJlY3RvcnkpLCBgLS1zdGFnZWRgLW9ubHkgcmVzdG9yZSwgYW5kXG4vLyBgLXBgL2AtLXBhdGNoYCBpbnRlcmFjdGl2ZSBodW5rIHNlbGVjdGlvbiBhbGwgZmFpbCBjbG9zZWQuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIGdpdCByZXN0b3JlIG5vLXZhbHVlIGZsYWdzIChwbGFuIFx1MDBBNzUuOSk7IGAtc2AvYC0tc291cmNlYCwgYC0tc3RhZ2VkYCwgYC1XYC9gLS13b3JrdHJlZWAsIGAtbWAvYC0tbWVyZ2VgLCBhbmQgYC1wYC9gLS1wYXRjaGAgYXJlIGhhbmRsZWQgZXhwbGljaXRseS4gKi9cbmNvbnN0IFJFU1RPUkVfTk9fVkFMVUUgPSBuZXcgU2V0KFsnLXEnLCAnLWYnLCAnLXUnXSk7XG5cbi8qKlxuICogVGhlIHNoYXJlZCByZXN0b3JlL2NoZWNrb3V0IHBhdGhzcGVjIGVtaXNzaW9uIChwbGFuIFx1MDBBNzUuOSk6IGFuIGV4cGxpY2l0LWZpbGVcbiAqIHBhdGhzcGVjIChubyBnbG9icywgbm8gYC5gL2AuLmAsIG5vIGRpcmVjdG9yeSwgbm8gdHJhaWxpbmcgYC9gKSBpcyBhXG4gKiBjcmVhdGUtb3ZlcndyaXRlIHdob2xlLWZpbGUgdG91Y2g7IGEgZGlyZWN0b3J5LXNoYXBlZCBwYXRoc3BlYyBpc1xuICogdW5yZXNvbHZlZCBcdTIwMTQgYSBkaXJlY3RvcnkgcmVzdG9yZS9jaGVja291dCByZXdyaXRlcyBhcmJpdHJhcnkgZmlsZXMgYmVuZWF0aFxuICogaXQgYW5kIGNhbm5vdCBiZSBhdHRyaWJ1dGVkIHRvIGEgZmlsZSB3cml0ZS5cbiAqL1xuZnVuY3Rpb24gZW1pdFJlc3RvcmVDaGVja291dFBhdGhzcGVjKFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXSxcbiAgaWRpb206ICdnaXQtcmVzdG9yZS13cml0ZScgfCAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgb3BlcmFuZDogc3RyaW5nLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddXG4pOiB2b2lkIHtcbiAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQpKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgaWRpb20sIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQpO1xuICBpZiAob3BlcmFuZCA9PT0gJy4nIHx8IG9wZXJhbmQgPT09ICcuLicgfHwgb3BlcmFuZC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkoYWJzb2x1dGVQYXRoKSkge1xuICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgcmVzdWx0cyxcbiAgICAgIGlkaW9tLFxuICAgICAgb3BlcmFuZCxcbiAgICAgICdkaXJlY3Rvcnktc2hhcGVkIHBhdGhzcGVjIHJld3JpdGVzIGFyYml0cmFyeSBmaWxlcyBiZW5lYXRoIGl0IFx1MjAxNCBub3QgYXR0cmlidXRhYmxlIHRvIGEgZmlsZSB3cml0ZSdcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICByZXN1bHRzLnB1c2goe1xuICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICBpZGlvbSxcbiAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gIH0pO1xufVxuXG4vKipcbiAqIFRoZSBnaXQgcmVzdG9yZSBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS45KTogYC1zYC9gLS1zb3VyY2U9PHRyZWU+YCBpc1xuICogdmFsdWUtdGFraW5nIFx1MjAxNCB0aGUgdHJlZSBvcGVyYW5kIG5ldmVyIHJlc29sdmVzIGFzIGEgcGF0aHNwZWM7IGAtcGAvYC0tcGF0Y2hgXG4gKiBpbnRlcmFjdGl2ZSBodW5rIHNlbGVjdGlvbiBpcyB1bnJlc29sdmVkOyBgLW1gL2AtLW1lcmdlYCAodGhlIG1lcmdlXG4gKiBtYWNoaW5lcnksIGNvbmRpdGlvbmFsIG9uIHRoZSBpbmRleCBiZWluZyB1bm1lcmdlZCkgYW5kIGAtLXN0YWdlZGAgd2l0aG91dFxuICogYC0td29ya3RyZWVgIChpbmRleC1vbmx5IFx1MjAxNCB0aGUgd29ya2luZyBmaWxlIHN1cnZpdmVzKSB0b3VjaCBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBtYXRjaFJlc3RvcmVPcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IHN0YWdlZCA9IGZhbHNlO1xuICBsZXQgd29ya3RyZWUgPSBmYWxzZTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1wJyB8fCBhID09PSAnLS1wYXRjaCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICAnZ2l0LXJlc3RvcmUtd3JpdGUnLFxuICAgICAgICBhLFxuICAgICAgICAnaW50ZXJhY3RpdmUgcGF0Y2ggbW9kZSBhcHBsaWVzIHVzZXItY2hvc2VuIGh1bmtzIFx1MjAxNCBubyBzdGF0aWMgc3BhbidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChhID09PSAnLXMnIHx8IGEgPT09ICctLXNvdXJjZScpIHtcbiAgICAgIGkgKz0gMTsgLy8gdGhlIHRyZWUgb3BlcmFuZCBpcyBuZXZlciBhIHBhdGhzcGVjXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLS1zb3VyY2U9JykpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLW0nIHx8IGEgPT09ICctLW1lcmdlJykgcmV0dXJuO1xuICAgIGlmIChhID09PSAnLS1zdGFnZWQnKSB7XG4gICAgICBzdGFnZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLVcnIHx8IGEgPT09ICctLXdvcmt0cmVlJykge1xuICAgICAgd29ya3RyZWUgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChSRVNUT1JFX05PX1ZBTFVFLmhhcyhhKSkgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChmYWlsIGNsb3NlZClcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIGlmIChzdGFnZWQgJiYgIXdvcmt0cmVlKSByZXR1cm47IC8vIGluZGV4LW9ubHkgcmVzdG9yZSBkb2VzIG5vdCB0b3VjaCB0aGUgd29ya2luZyBmaWxlXG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGVtaXRSZXN0b3JlQ2hlY2tvdXRQYXRoc3BlYyhyZXN1bHRzLCAnZ2l0LXJlc3RvcmUtd3JpdGUnLCBvcGVyYW5kLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbik7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgZ2l0IGNoZWNrb3V0IG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjkpOiBgLWJgL2AtQmAvYC0tb3JwaGFuIDxicmFuY2g+YFxuICogYXJlIHZhbHVlLXRha2luZyBcdTIwMTQgdGhlIGJyYW5jaCBuYW1lIG5ldmVyIHJlc29sdmVzIGFzIGEgcGF0aHNwZWM7IGAtcGAvXG4gKiBgLS1wYXRjaGAgaW50ZXJhY3RpdmUgaHVuayBzZWxlY3Rpb24gaXMgdW5yZXNvbHZlZDsgYSBwcmUtYC0tYCBwb3NpdGlvbmFsIGlzXG4gKiBhIHJldmlzaW9uL3JlZiBvcGVyYW5kIGFuZCBpcyBza2lwcGVkLiBQYXRoc3BlY3Mgb25seSBhZnRlciBgLS1gLlxuICovXG5mdW5jdGlvbiBtYXRjaENoZWNrb3V0T3BlcmFuZHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcCcgfHwgYSA9PT0gJy0tcGF0Y2gnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgJ2dpdC1jaGVja291dC13cml0ZScsXG4gICAgICAgIGEsXG4gICAgICAgICdpbnRlcmFjdGl2ZSBwYXRjaCBtb2RlIGFwcGxpZXMgdXNlci1jaG9zZW4gaHVua3MgXHUyMDE0IG5vIHN0YXRpYyBzcGFuJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYicgfHwgYSA9PT0gJy1CJyB8fCBhID09PSAnLS1vcnBoYW4nKSB7XG4gICAgICBpICs9IDE7IC8vIHRoZSBicmFuY2ggbmFtZSBpcyBuZXZlciBhIHBhdGhzcGVjXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctZicgfHwgYSA9PT0gJy1xJyB8fCBhID09PSAnLW0nIHx8IGEgPT09ICctdCcpIGNvbnRpbnVlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvbiAoZmFpbCBjbG9zZWQpXG4gICAgLy8gQSBwcmUtYC0tYCBwb3NpdGlvbmFsIGlzIGEgcmV2aXNpb24vcmVmIG9wZXJhbmQgXHUyMDE0IG5ldmVyIGEgcGF0aHNwZWMuXG4gIH1cbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgZW1pdFJlc3RvcmVDaGVja291dFBhdGhzcGVjKHJlc3VsdHMsICdnaXQtY2hlY2tvdXQtd3JpdGUnLCBvcGVyYW5kLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbik7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgZ2l0IHJlc3RvcmUgLyBnaXQgY2hlY2tvdXQgZmFtaWx5IChwbGFuIFx1MDBBNzUuOSk6IHZpYSBgZmluZEdpdFN1YmNvbW1hbmRgXG4gKiAoaGFuZGxlcyBgZ2l0IC1DYC9gLWNgKSwgdGhlIHR3byBzdWJjb21tYW5kcyByZXNvbHZlIHRoZWlyIHBhdGhzcGVjcyB0b1xuICogd2hvbGUtZmlsZSBjcmVhdGUtb3ZlcndyaXRlIHRvdWNoZXM7IGEgd3JhcHBlZCBzdWJjb21tYW5kIGZhaWxzIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hHaXRSZXN0b3JlQ2hlY2tvdXQoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiA9PT0gbnVsbCB8fCAoc3ViLnN1YmNvbW1hbmQgIT09ICdyZXN0b3JlJyAmJiBzdWIuc3ViY29tbWFuZCAhPT0gJ2NoZWNrb3V0JykpIHJldHVybjtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICBzdWIuc3ViY29tbWFuZCA9PT0gJ3Jlc3RvcmUnID8gJ2dpdC1yZXN0b3JlLXdyaXRlJyA6ICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICAgICAgICBzdWIuc3ViY29tbWFuZCxcbiAgICAgICAgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGRpciA9IHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb247XG4gICAgY29uc3QgYXJncyA9IHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICAgIGlmIChzdWIuc3ViY29tbWFuZCA9PT0gJ3Jlc3RvcmUnKSBtYXRjaFJlc3RvcmVPcGVyYW5kcyhhcmdzLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgZWxzZSBtYXRjaENoZWNrb3V0T3BlcmFuZHMoYXJncywgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3Jlc3RvcmUnIHx8IHdyYXBwZWQgPT09ICdjaGVja291dCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICB3cmFwcGVkID09PSAncmVzdG9yZScgPyAnZ2l0LXJlc3RvcmUtd3JpdGUnIDogJ2dpdC1jaGVja291dC13cml0ZScsXG4gICAgICAgIHdyYXBwZWQsXG4gICAgICAgIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE9yY2hlc3RyYXRvclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IExJTkVfU0VMRUNUT1JTID0gW21hdGNoU2VkLCBtYXRjaEhlYWQsIG1hdGNoVGFpbF07XG5cbi8qKlxuICogU3Bhbi1sZXNzIGNvbW1hbmRzIHdob3NlIGV4aXQgc3RhdHVzIGlzIGRldGVybWluaXN0aWMgXHUyMDE0IHVzYWJsZSBhcyBndWFyZHMgaW5cbiAqIGAmJmAvYHx8YCBqb2lucyAocGxhbiBcdTAwQTczIHN0ZXAgMidzIHNwYW4tbGVzcy1ndWFyZCBydWxlKTogYGZhbHNlYCBhbHdheXNcbiAqIGV4aXRzIDEsIGB0cnVlYCBhbmQgYDpgIGFsd2F5cyAwLCBzbyBhIGZvbGxvd2luZyBqb2luZWQgY29tbWFuZCdzIHNraXAgaXNcbiAqIGtub3dhYmxlIGV2ZW4gdGhvdWdoIG5laXRoZXIgcHJvZHVjZXMgYSBzcGFuLlxuICovXG5jb25zdCBCVUlMVElOX0dVQVJEX1NUQVRVUyA9IG5ldyBNYXA8c3RyaW5nLCAwIHwgMT4oW1xuICBbJ2ZhbHNlJywgMV0sXG4gIFsndHJ1ZScsIDBdLFxuICBbJzonLCAwXVxuXSk7XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kOiBzdHJpbmcsIGN3ZDogc3RyaW5nID0gcHJvY2Vzcy5jd2QoKSk6IFNwYW5NYXRjaFtdIHtcbiAgY29uc3QgeyB3cml0ZXM6IGhlcmVkb2NXcml0ZXMsIG1hc2tlZCB9ID0gZXh0cmFjdEhlcmVkb2NXcml0ZXMoY29tbWFuZCk7XG4gIGNvbnN0IHNpbXBsZUNvbW1hbmRzID0gc3BsaXRUb3BMZXZlbChtYXNrZWQpO1xuXG4gIGNvbnN0IHJlc3VsdHM6IFNwYW5NYXRjaFtdID0gW107XG4gIGNvbnN0IGZzTGluZUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlciB8IG51bGw+KCk7XG4gIGNvbnN0IGdpdExpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuXG4gIGNvbnN0IGNhY2hlZEZzVG90YWxMaW5lcyA9IChhYnNQYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBpZiAoIWZzTGluZUNhY2hlLmhhcyhhYnNQYXRoKSkgZnNMaW5lQ2FjaGUuc2V0KGFic1BhdGgsIGNvdW50RmlsZUxpbmVzKGFic1BhdGgpKTtcbiAgICByZXR1cm4gZnNMaW5lQ2FjaGUuZ2V0KGFic1BhdGgpID8/IG51bGw7XG4gIH07XG4gIGNvbnN0IGNhY2hlZEdpdFRvdGFsTGluZXMgPSAoZ2l0Q3dkOiBzdHJpbmcsIHJldjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBjb25zdCBrZXkgPSBgJHtnaXRDd2R9XHUwMDAwJHtyZXZ9XHUwMDAwJHtwYXRofWA7XG4gICAgaWYgKCFnaXRMaW5lQ2FjaGUuaGFzKGtleSkpIGdpdExpbmVDYWNoZS5zZXQoa2V5LCBjb3VudEdpdEJsb2JMaW5lcyhnaXRDd2QsIHJldiwgcGF0aCkpO1xuICAgIHJldHVybiBnaXRMaW5lQ2FjaGUuZ2V0KGtleSkgPz8gbnVsbDtcbiAgfTtcblxuICBsZXQgY3VycmVudERpciA9IGN3ZDtcbiAgbGV0IGxhc3RQbGFpbkZpbGVTb3VyY2U6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAvLyBUaGUgb25lLWhvcCBsaXRlcmFsIGVjaG8vcHJpbnRmIHBpcGUgc291cmNlIChwbGFuIFx1MDBBNzUuMik6IHNldCBhdCB0aGUgZW5kIG9mXG4gIC8vIGVhY2ggc2ltcGxlIGNvbW1hbmQsIGNsZWFyZWQgYXQgYW55IG5vbi1waXBlIGJvdW5kYXJ5LCB0aHJlYWRlZCBieSB0ZWUgLWFcbiAgLy8gYXBwZW5kcyBpbiB0aGUgbmV4dCBwaXBlIHN0YWdlIChgZWNobyB4IHwgdGVlIC1hIGZgKS5cbiAgbGV0IHBpcGVFY2hvQ29udGVudDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgLyoqIFRoZSBgam9pbmAgc3RhbXAgZm9yIGEgc2ltcGxlIGNvbW1hbmQ6IG9ubHkgdGhlIGNvbmRpdGlvbmFsIG9wZXJhdG9ycyBnYXRlIChwbGFuIFx1MDBBNzMgc3RlcCAyKS4gKi9cbiAgY29uc3Qgam9pbk9mID0gKHNpbXBsZTogU2ltcGxlQ29tbWFuZCk6IFJlc29sdmVkU3Bhblsnam9pbiddID0+XG4gICAgc2ltcGxlLnByZWNlZGVkQnkgPT09ICcmJicgfHwgc2ltcGxlLnByZWNlZGVkQnkgPT09ICd8fCcgPyBzaW1wbGUucHJlY2VkZWRCeSA6IHVuZGVmaW5lZDtcblxuICBjb25zdCBlbWl0Q2FuZGlkYXRlID0gKFxuICAgIGM6IFJhd0NhbmRpZGF0ZSxcbiAgICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gICAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gICAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ11cbiAgKSA9PiB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGMuZmlsZUFyZykpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYy5maWxlQXJnLFxuICAgICAgICByZWFzb246ICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYidcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChkaXJGb3JSZXNvbHV0aW9uLCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHRvdGFsTGluZXMgPVxuICAgICAgYy5yZXNvbHZlcktpbmQgPT09ICdmcydcbiAgICAgICAgPyBjYWNoZWRGc1RvdGFsTGluZXMoYWJzb2x1dGVQYXRoKVxuICAgICAgICA6IGNhY2hlZEdpdFRvdGFsTGluZXMoYy5kaXJPdmVycmlkZSA/PyBkaXJGb3JSZXNvbHV0aW9uLCBjLnJlc29sdmVyS2luZC5yZXYsIGMuZmlsZUFyZyk7XG4gICAgY29uc3QgcmFuZ2UgPSByZXNvbHZlU3BlYyhjLnNwZWMsIHRvdGFsTGluZXMpO1xuICAgIGlmIChyYW5nZSA9PT0gbnVsbCkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHJlYXNvbjogJ2NvdWxkIG5vdCBkZXRlcm1pbmUgZW5kLW9mLWZpbGUgbGluZSBjb3VudCAoZmlsZSB1bnJlYWRhYmxlLCBlbXB0eSwgb3IgZ2l0IHJldi9wYXRoIG5vdCBmb3VuZCknXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246ICdyZWFkJyxcbiAgICAgICAgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsXG4gICAgICAgIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsXG4gICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luXG4gICAgICB9XG4gICAgfSk7XG4gIH07XG5cbiAgLyoqXG4gICAqIFRoZSByZWFkIGlkaW9tcyBmb3Igb25lIHNpbXBsZSBjb21tYW5kICh0aGUgZXhpc3RpbmcgY29ycHVzIGdyYW1tYXIpOlxuICAgKiBwbGFpbiBgY2F0YC9gbmxgIHNvdXJjZXMsIHRoZSBsaW5lIHNlbGVjdG9ycywgYW5kIHRoZSBnaXQgbWF0Y2hlcnMsIHdpdGhcbiAgICogb25lLWhvcCBwaXBlLXNvdXJjZSBwcm9wYWdhdGlvbiBmb3IgZG93bnN0cmVhbSBgaGVhZGAvYHRhaWxgL2BzZWQgLW5gLlxuICAgKi9cbiAgY29uc3QgbWF0Y2hSZWFkcyA9IChzaW1wbGU6IFNpbXBsZUNvbW1hbmQsIGFyZ3Y6IHN0cmluZ1tdLCBpOiBudW1iZXIpOiB2b2lkID0+IHtcbiAgICBsZXQgaXNQbGFpblNvdXJjZSA9IGZhbHNlO1xuICAgIGxldCBwbGFpbkZpbGVBcmc6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIGlmIChhcmd2WzBdID09PSAnY2F0JyAmJiBhcmd2Lmxlbmd0aCA9PT0gMiAmJiAhYXJndlsxXS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGlzUGxhaW5Tb3VyY2UgPSB0cnVlO1xuICAgICAgcGxhaW5GaWxlQXJnID0gYXJndlsxXTtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBoYXNTaGVsbEV4cGFuc2lvbihhcmd2WzFdKSA/IG51bGwgOiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCBhcmd2WzFdKTtcbiAgICB9IGVsc2UgaWYgKGFyZ3ZbMF0gPT09ICdubCcgJiYgYXJndi5sZW5ndGggPj0gMiAmJiAhYXJndlthcmd2Lmxlbmd0aCAtIDFdLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICBjb25zdCBmID0gYXJndlthcmd2Lmxlbmd0aCAtIDFdO1xuICAgICAgcGxhaW5GaWxlQXJnID0gZjtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBoYXNTaGVsbEV4cGFuc2lvbihmKSA/IG51bGwgOiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCBmKTtcbiAgICB9XG5cbiAgICAvLyBBIGJhcmUgYGNhdCBmaWxlYC9gbmwgZmlsZWAgdGhhdCBpcyBub3QgZmVlZGluZyBhIGRvd25zdHJlYW0gcGlwZSBzdGFnZVxuICAgIC8vIHJlYWRzIHRoZSB3aG9sZSBmaWxlOiBlbWl0IHRoZSBzYW1lIHdob2xlLWZpbGUgc3BhbiBgZ2l0IHNob3cgcmV2OnBhdGhgXG4gICAgLy8gcHJvZHVjZXMuIFdoZW4gYSBwaXBlIGZvbGxvd3MsIHRoZSBkb3duc3RyZWFtIGxpbmUtc2VsZWN0b3IgYWxyZWFkeVxuICAgIC8vIGVtaXRzIHRoZSBwcmVjaXNlIHJhbmdlLCBzbyB0aGUgc291cmNlIHN0YXlzIHNvdXJjZS1vbmx5LlxuICAgIGlmIChwbGFpbkZpbGVBcmcgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IG5leHQgPSBzaW1wbGVDb21tYW5kc1tpICsgMV07XG4gICAgICBpZiAobmV4dCA9PT0gdW5kZWZpbmVkIHx8IG5leHQucHJlY2VkZWRCeSAhPT0gJ3wnKSB7XG4gICAgICAgIGVtaXRDYW5kaWRhdGUoXG4gICAgICAgICAge1xuICAgICAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgICAgICBpZGlvbTogYXJndlswXSA9PT0gJ2NhdCcgPyAnY2F0LWZpbGUnIDogJ25sLWZpbGUnLFxuICAgICAgICAgICAgZmlsZUFyZzogcGxhaW5GaWxlQXJnLFxuICAgICAgICAgICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgICAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBjdXJyZW50RGlyLFxuICAgICAgICAgIGksXG4gICAgICAgICAgam9pbk9mKHNpbXBsZSlcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgbWF0Y2hlciBvZiBbLi4uTElORV9TRUxFQ1RPUlMsIG1hdGNoR2l0U2hvdywgbWF0Y2hHaXRMb2dMXSkge1xuICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIoYXJndikpIHtcbiAgICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgICAgIGlmIChvdXRjb21lLmtpbmQgPT09ICd1bnJlc29sdmVkJykge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgIGlkaW9tOiBvdXRjb21lLmlkaW9tLFxuICAgICAgICAgICAgZmlsZUFyZzogb3V0Y29tZS5maWxlQXJnLFxuICAgICAgICAgICAgcmVhc29uOiBvdXRjb21lLnJlYXNvblxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgb3V0Y29tZS5kaXJPdmVycmlkZSA/PyBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSk7XG4gICAgICAgICAgLy8gYGdpdCBzaG93IHJldjpwYXRoYCBwcmludHMgdGhlIGJsb2IgdmVyYmF0aW0sIHNvICh1bmxpa2UgYGdpdCBsb2cgLUxgLFxuICAgICAgICAgIC8vIHdoaWNoIHByaW50cyBkaWZmLWZvcm1hdHRlZCBoaXN0b3J5KSBpdCdzIGEgdmFsaWQgb25lLWhvcCBwaXBlIHNvdXJjZVxuICAgICAgICAgIC8vIGZvciBhIGRvd25zdHJlYW0gbGluZS1zZWxlY3Rvciwgc2FtZSBhcyBgY2F0YC9gbmxgLlxuICAgICAgICAgIGlmIChvdXRjb21lLmlkaW9tID09PSAnZ2l0LXNob3ctcmV2LXBhdGgnICYmICFsb29rc1VucmVzb2x2YWJsZShvdXRjb21lLmZpbGVBcmcpKSB7XG4gICAgICAgICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgICAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSByZXNvbHZlUGF0aChvdXRjb21lLmRpck92ZXJyaWRlID8/IGN1cnJlbnREaXIsIG91dGNvbWUuZmlsZUFyZyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFtYXRjaGVkICYmIHNpbXBsZS5wcmVjZWRlZEJ5ID09PSAnfCcgJiYgbGFzdFBsYWluRmlsZVNvdXJjZSkge1xuICAgICAgY29uc3Qgd2l0aEZpbGUgPSBbLi4uYXJndiwgbGFzdFBsYWluRmlsZVNvdXJjZV07XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgTElORV9TRUxFQ1RPUlMpIHtcbiAgICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIod2l0aEZpbGUpKSB7XG4gICAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ2NhbmRpZGF0ZScpIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSkpO1xuICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgICAgICBpZGlvbTogb3V0Y29tZS5pZGlvbSxcbiAgICAgICAgICAgICAgZmlsZUFyZzogb3V0Y29tZS5maWxlQXJnLFxuICAgICAgICAgICAgICByZWFzb246IG91dGNvbWUucmVhc29uXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNQbGFpblNvdXJjZSkgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzaW1wbGVDb21tYW5kcy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHNpbXBsZSA9IHNpbXBsZUNvbW1hbmRzW2ldO1xuXG4gICAgLy8gQSBwaXBlIHN0YWdlIG1heSBpbmhlcml0IHRoZSBwcmV2aW91cyBzdGFnZSdzIGxpdGVyYWwgZWNobyBjb250ZW50OyBhbnlcbiAgICAvLyBvdGhlciBib3VuZGFyeSBjbGVhcnMgaXQuXG4gICAgaWYgKHNpbXBsZS5wcmVjZWRlZEJ5ICE9PSAnfCcpIHBpcGVFY2hvQ29udGVudCA9IG51bGw7XG5cbiAgICBjb25zdCBoZXJlZG9jUmVmID0gc2ltcGxlLnRleHQubWF0Y2goL15fX2hlcmVkb2NfKFxcZCspX18kLyk7XG4gICAgaWYgKGhlcmVkb2NSZWYpIHtcbiAgICAgIGNvbnN0IHcgPSBoZXJlZG9jV3JpdGVzW051bWJlci5wYXJzZUludChoZXJlZG9jUmVmWzFdLCAxMCldO1xuICAgICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMody5vcGVuZXIpLnRyaW0oKSk7XG4gICAgICBpZiAodG9rZW5zID09PSBudWxsKSB7XG4gICAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG9wZW5lckFyZ3YgPSBhbmFseXplVG9rZW5zKHRva2VucykuYXJndjtcbiAgICAgIG1hdGNoUmVhZHMoc2ltcGxlLCBvcGVuZXJBcmd2LCBpKTtcbiAgICAgIGNsYXNzaWZ5SGVyZWRvY09wZW5lcih3Lm9wZW5lciwgdy5ib2R5LCB3LnF1b3RlZERlbGltLCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgICBwaXBlRWNob0NvbnRlbnQgPSBsaXRlcmFsQ29udGVudChvcGVuZXJBcmd2KSA/PyBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlLnRleHQpLnRyaW0oKSk7XG4gICAgaWYgKHRva2VucyA9PT0gbnVsbCkge1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgeyBhcmd2LCByZWRpcmVjdHMgfSA9IGFuYWx5emVUb2tlbnModG9rZW5zKTtcbiAgICBpZiAoYXJndi5sZW5ndGggPT09IDApIHtcbiAgICAgIC8vIEJhcmUgYD4gZmAgLyBgOiA+IGZgOiBubyBhcmd2LCBidXQgdGhlIHRydW5jYXRpb24gZ3JhbW1hciBzdGlsbCBmaXJlcy5cbiAgICAgIG1hdGNoUmVkaXJlY3RGYW1pbHkoYXJndiwgcmVkaXJlY3RzLCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjZCcpIHtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29uc3QgdGFyZ2V0ID0gYXJndlsxXTtcbiAgICAgIGlmICh0YXJnZXQgIT09IHVuZGVmaW5lZCAmJiB0YXJnZXQgIT09ICctJyAmJiAhaGFzU2hlbGxFeHBhbnNpb24odGFyZ2V0KSkge1xuICAgICAgICBjdXJyZW50RGlyID0gcmVzb2x2ZVBhdGgoY3VycmVudERpciwgdGFyZ2V0KTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGJlZm9yZSA9IHJlc3VsdHMubGVuZ3RoO1xuICAgIG1hdGNoUmVhZHMoc2ltcGxlLCBhcmd2LCBpKTtcbiAgICBtYXRjaFJlZGlyZWN0RmFtaWx5KGFyZ3YsIHJlZGlyZWN0cywgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hDb3B5TW92ZUZhbWlseShhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hSbVRydW5jYXRlKGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaFNlZElucGxhY2UoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoUGF0Y2hBcHBseShhcmd2LCByZWRpcmVjdHMsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaEZvcm1hdHRlcihhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hHaXRSZXN0b3JlQ2hlY2tvdXQoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIGlmIChyZXN1bHRzLmxlbmd0aCA9PT0gYmVmb3JlKSB7XG4gICAgICAvLyBObyBzcGFuIGZvciB0aGlzIGNvbW1hbmQ6IGEgZGV0ZXJtaW5pc3RpYyBidWlsdGluIGlzIHN0aWxsIGEgdXNhYmxlXG4gICAgICAvLyBqb2luIGd1YXJkIChgZmFsc2UgJiYgZWNobyB4ID4gZmAgbXVzdCBza2lwIHRoZSBlY2hvKS4gQW55IG90aGVyXG4gICAgICAvLyBjb21tYW5kIHN0YXlzIHNwYW4tbGVzcyBhbmQgdW5rbm93YWJsZSBcdTIwMTQgdGhlIGRyaXZlciBmYWlscyBvcGVuLlxuICAgICAgY29uc3Qgc3RhdHVzID0gQlVJTFRJTl9HVUFSRF9TVEFUVVMuZ2V0KGFyZ3ZbMF0pO1xuICAgICAgaWYgKHN0YXR1cyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAnYnVpbHRpbi1ndWFyZCcsXG4gICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4OiBpLFxuICAgICAgICAgIGpvaW46IGpvaW5PZihzaW1wbGUpLFxuICAgICAgICAgIGV4aXRTdGF0dXM6IHN0YXR1c1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgcGlwZUVjaG9Db250ZW50ID0gbGl0ZXJhbENvbnRlbnQoYXJndikgPz8gbnVsbDtcbiAgfVxuXG4gIHJldHVybiByZXN1bHRzO1xufVxuXG4vKiogUGFyc2VzIGEgQmFzaCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGUrbGluZS1yYW5nZSBzcGFucyBpdCBzdGF0aWNhbGx5LCByZWxpYWJseSByZWFkcyBvciB3cml0ZXMuIGBjd2RgIGRlZmF1bHRzIHRvIGBwcm9jZXNzLmN3ZCgpYCBcdTIwMTQgcGFzcyB0aGUgaG9vaydzIG93biBgY3dkYCBmaWVsZCBmb3IgY29ycmVjdCByZXNvbHV0aW9uIG9mIHJlbGF0aXZlIHBhdGhzIGFuZCBgY2RgL2BnaXQgLUNgIHRhcmdldHMsIGFuZCBvZiBgZ2l0IHNob3dgL2BnaXQgbG9nIC1MYCByZXZpc2lvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kKGNvbW1hbmQ6IHN0cmluZywgY3dkOiBzdHJpbmcgPSBwcm9jZXNzLmN3ZCgpKTogUmVzb2x2ZWRTcGFuW10ge1xuICBjb25zdCBkZXRhaWxlZCA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIGN3ZCk7XG4gIGNvbnN0IHNwYW5zOiBSZXNvbHZlZFNwYW5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgZGV0YWlsZWQpIHtcbiAgICBpZiAobS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpIHNwYW5zLnB1c2gobS5zcGFuKTtcbiAgfVxuICByZXR1cm4gc3BhbnM7XG59XG4iLCAiLyoqXG4gKiBUaGUgb25seSBpbXB1cmUgYml0czogY291bnRpbmcgbGluZXMgb2YgYSB3b3JraW5nLXRyZWUgZmlsZSwgYW5kIG9mIGEgZmlsZVxuICogYXMgaXQgZXhpc3RlZCBhdCBhIGdpdmVuIGdpdCByZXZpc2lvbi4gQm90aCByZXR1cm4gbnVsbCBvbiBhbnkgZmFpbHVyZVxuICogKG1pc3NpbmcgZmlsZSwgYmFkIHJldiwgbm90IGEgZ2l0IHJlcG8sIGV0Yy4pIGluc3RlYWQgb2YgdGhyb3dpbmcgXHUyMDE0IGFcbiAqIGNvbW1hbmQgdGhhdCBzdGF0aWNhbGx5IG1hdGNoZWQgYW4gaWRpb20gYnV0IHBvaW50cyBhdCBzb21ldGhpbmcgdGhpc1xuICogbWFjaGluZSBjYW4ndCBjdXJyZW50bHkgcmVzb2x2ZSBpcyBhIG5vcm1hbCwgZXhwZWN0ZWQgb3V0Y29tZSwgbm90IGEgYnVnLlxuICovXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGEgd29ya2luZy10cmVlIGZpbGUsIG9yIG51bGwgaWYgaXQgY2FuJ3QgYmUgcmVhZC4gVHJhaWxpbmcgbmV3bGluZSBkb2VzIG5vdCBjb3VudCBhcyBhbiBleHRyYSBlbXB0eSBsaW5lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgaWYgKCFzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRmlsZSgpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgICBpZiAoY29udGVudC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBjb250ZW50LmVuZHNXaXRoKCdcXG4nKSA/IGNvbnRlbnQuc2xpY2UoMCwgLTEpIDogY29udGVudDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGBwYXRoYCBhcyBpdCBleGlzdHMgYXQgYHJldmAsIHJ1biBmcm9tIGBjd2RgLCBvciBudWxsIGlmIHRoZSByZXYvcGF0aC9yZXBvIGRvZXNuJ3QgcmVzb2x2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEdpdEJsb2JMaW5lcyhjd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzaG93JywgYCR7cmV2fToke3BhdGh9YF0sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIGlmIChvdXQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gb3V0LmVuZHNXaXRoKCdcXG4nKSA/IG91dC5zbGljZSgwLCAtMSkgOiBvdXQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICIvKipcbiAqIEhldXJpc3RpYywgZGVwZW5kZW5jeS1mcmVlIHNoZWxsIHNwbGl0dGluZy4gTm90IGEgZnVsbCBzaGVsbCBwYXJzZXIgXHUyMDE0IGdvb2RcbiAqIGVub3VnaCB0byBsb2NhdGUgc2ltcGxlIGNvbW1hbmRzIChhbmQgdGhlaXIgYXJndikgaW5zaWRlIGEgbGFyZ2VyXG4gKiAmJi98fC87L3wtam9pbmVkIEJhc2ggc3RyaW5nIHdpdGhvdXQgcHVsbGluZyBpbiBhIHJlYWwgYmFzaCBBU1QgcGFyc2VyLlxuICogVmFsaWRhdGVkIGR1cmluZyByZXNlYXJjaCBhZ2FpbnN0IGJhc2hsZXggb24gdGhlIHJlYWwgdHJhbnNjcmlwdCBjb3JwdXM7XG4gKiB0aGlzIHBvcnRzIHRoZSBzYW1lIGFsZ29yaXRobS5cbiAqXG4gKiBUaGUgd29yZC1sZXZlbCB0b2tlbml6ZXIgKFt0b2tlbml6ZV0pIGlzIHF1b3RlLSBhbmQgcmVkaXJlY3QtYXdhcmUgKHBsYW5cbiAqIFx1MDBBNzUuMTApOiByZWRpcmVjdCBvcGVyYXRvcnMgYXJlIHNwbGl0IGFzIGRpc3RpbmN0IHRva2VucyB3aXRoIGF0dGFjaGVkLXRhcmdldFxuICogZm9ybXMgcHJlc2VydmVkIChgPmZgKSwgcXVvdGVkIHRva2VucyBhcmUgd29yZHMgYW5kIG5ldmVyIG9wZXJhdG9ycywgYW5kXG4gKiBbYXJndk9mXSBkZXJpdmVzIG9wZXJhbmRzIGZyb20gdGhlIHRva2VuIHN0cmVhbSBtaW51cyByZWRpcmVjdCB0b2tlbnMgYW5kXG4gKiB0aGVpciB0YXJnZXRzLlxuICovXG5cbi8qKiBPbmUgYHNpbXBsZSBjb21tYW5kYCBmb3VuZCBpbiBhIGxhcmdlciBzY3JpcHQsIHBsdXMgd2hpY2ggb3BlcmF0b3IgcHJlY2VkZWQgaXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFNpbXBsZUNvbW1hbmQge1xuICB0ZXh0OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBUaGUgb3BlcmF0b3IgaW1tZWRpYXRlbHkgYmVmb3JlIHRoaXMgY29tbWFuZDogJ3wnIGZvciBhIHBpcGVsaW5lIHN0YWdlLFxuICAgKiAnJiYnLyd8fCcgZm9yIHRoZSBjb25kaXRpb25hbCBvcGVyYXRvcnMgKHRoZSBvbmx5IG9uZXMgdGhhdCBnYXRlLCBwbGFuXG4gICAqIFx1MDBBNzMgc3RlcCAyKSwgJ290aGVyJyBmb3IgJzsnL25ld2xpbmUvJyYnLCBvciAnc3RhcnQnIGZvciB0aGUgZmlyc3QgY29tbWFuZC5cbiAgICovXG4gIHByZWNlZGVkQnk6ICdzdGFydCcgfCAnfCcgfCAnJiYnIHwgJ3x8JyB8ICdvdGhlcic7XG59XG5cbi8qKiBTcGxpdCBhIGNvbW1hbmQgc3RyaW5nIGludG8gc2ltcGxlLWNvbW1hbmQgc3Vic3RyaW5ncyBhdCB0b3AtbGV2ZWwgJiYsIHx8LCA7LCB8LCB8JiwgYW5kIG5ld2xpbmUgYm91bmRhcmllcy4gUXVvdGVzIGFuZCAkKCkvYGAvKCkgbmVzdGluZyBhcmUgcmVzcGVjdGVkIChub3Qgc3BsaXQgaW5zaWRlKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzcGxpdFRvcExldmVsKGNtZDogc3RyaW5nKTogU2ltcGxlQ29tbWFuZFtdIHtcbiAgY29uc3QgcGFydHM6IFNpbXBsZUNvbW1hbmRbXSA9IFtdO1xuICBsZXQgYnVmID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IGNtZC5sZW5ndGg7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgbGV0IHBlbmRpbmdPcDogU2ltcGxlQ29tbWFuZFsncHJlY2VkZWRCeSddID0gJ3N0YXJ0JztcblxuICBjb25zdCBmbHVzaCA9IChuZXh0T3A6IFNpbXBsZUNvbW1hbmRbJ3ByZWNlZGVkQnknXSkgPT4ge1xuICAgIGNvbnN0IHMgPSBidWYudHJpbSgpO1xuICAgIGlmIChzKSBwYXJ0cy5wdXNoKHsgdGV4dDogcywgcHJlY2VkZWRCeTogcGVuZGluZ09wIH0pO1xuICAgIGJ1ZiA9ICcnO1xuICAgIHBlbmRpbmdPcCA9IG5leHRPcDtcbiAgfTtcblxuICAvKipcbiAgICogV2hldGhlciB0aGUgb3BlcmF0b3IgY3VycmVudGx5IHBlbmRpbmcgaXMgYSBwaXBlIChgfGAvYHwmYCkuIEEgaGVscGVyXG4gICAqIHJhdGhlciB0aGFuIGFuIGlubGluZSBjb21wYXJpc29uOiBUeXBlU2NyaXB0J3MgY29udHJvbC1mbG93IG5hcnJvd2luZ1xuICAgKiBjYW5ub3Qgc2VlIHRoZSBhc3NpZ25tZW50cyBgZmx1c2hgIG1ha2VzIHRvIGBwZW5kaW5nT3BgIGZyb20gaW5zaWRlIGl0c1xuICAgKiBjbG9zdXJlLCBhbmQgd291bGQgb3RoZXJ3aXNlIG5hcnJvdyB0aGUgZGlyZWN0IGNvbXBhcmlzb24gdG8gdGhlXG4gICAqIGluaXRpYWxpemVyIGAnc3RhcnQnYC5cbiAgICovXG4gIGNvbnN0IGlzUGVuZGluZ1BpcGUgPSAoKTogYm9vbGVhbiA9PiBwZW5kaW5nT3AgPT09ICd8JztcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gY21kW2ldO1xuICAgIGlmIChpblNxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gXCInXCIpIGluU3F1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRHF1b3RlKSB7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICAgIGJ1ZiArPSBjbWRbaSArIDFdO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIGluRHF1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBpblNxdW90ZSA9IHRydWU7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGJ1ZiArPSBjICsgY21kW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBkZXB0aCArPSAxO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgZGVwdGggPSBNYXRoLm1heCgwLCBkZXB0aCAtIDEpO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJyYmJykge1xuICAgICAgICBmbHVzaCgnJiYnKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfHwnKSB7XG4gICAgICAgIGZsdXNoKCd8fCcpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8JicpIHtcbiAgICAgICAgZmx1c2goJ3wnKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ3wnKSB7XG4gICAgICAgIGZsdXNoKCd8Jyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgICAgLy8gQSBuZXdsaW5lIGltbWVkaWF0ZWx5IGFmdGVyIGEgcGlwZSBvcGVyYXRvciBpcyBhIGxpbmUgY29udGludWF0aW9uXG4gICAgICAgIC8vIChgY2F0IGEudHh0IHxcXG5zZWQgLi4uYCBrZWVwcyB0aGUgcGlwZWxpbmUpLCBub3QgYSBzdGF0ZW1lbnRcbiAgICAgICAgLy8gc2VwYXJhdG9yOiBza2lwcGluZyBpdCBwcmVzZXJ2ZXMgYHByZWNlZGVkQnk6ICd8J2AgZm9yIHRoZSBuZXh0XG4gICAgICAgIC8vIHN0YWdlIGluc3RlYWQgb2YgZGVncmFkaW5nIGl0IHRvICdvdGhlcicuXG4gICAgICAgIGlmIChpc1BlbmRpbmdQaXBlKCkpIHtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAgIC8vIGAmPmAvYCY+PmAgKHN0ZG91dCtzdGRlcnIgcmVkaXJlY3QpIGFuZCBgPiZgIChmZC1kdXAgcmVkaXJlY3QsIGFzIGluXG4gICAgICAgIC8vIGAyPiYxYCkgYXJlIHJlZGlyZWN0IG9wZXJhdG9ycywgbm90IGNvbW1hbmQgc2VwYXJhdG9ycyBcdTIwMTQga2VlcCB0aGVtXG4gICAgICAgIC8vIGluIHRoZSBjdXJyZW50IHNpbXBsZSBjb21tYW5kIHNvIHRoZSB0b2tlbml6ZXIgY2FuIGxleCB0aGVtIGFzIG9uZVxuICAgICAgICAvLyB0b2tlbi4gQSBgPmAgY291bnRzIGFzIGEgZHVwLXJlZGlyZWN0IHByZWZpeCBvbmx5IGF0IGEgdG9rZW5cbiAgICAgICAgLy8gYm91bmRhcnkgKHN0YXJ0LCBvciBhZnRlciB3aGl0ZXNwYWNlL2RpZ2l0cykgXHUyMDE0IGBhPmImY2Agc3RpbGxcbiAgICAgICAgLy8gYmFja2dyb3VuZHMgdGhlIGBhPmJgIHJlZGlyZWN0LlxuICAgICAgICBjb25zdCB0cmltbWVkID0gYnVmLnRyaW1FbmQoKTtcbiAgICAgICAgbGV0IGR1cFJlZGlyZWN0ID0gZmFsc2U7XG4gICAgICAgIGlmICh0cmltbWVkLmVuZHNXaXRoKCc+JykpIHtcbiAgICAgICAgICBjb25zdCBiZWZvcmUgPSB0cmltbWVkLmxlbmd0aCA+PSAyID8gdHJpbW1lZFt0cmltbWVkLmxlbmd0aCAtIDJdIDogJyc7XG4gICAgICAgICAgZHVwUmVkaXJlY3QgPSB0cmltbWVkLmxlbmd0aCA9PT0gMSB8fCAvXFxzfFxcZC8udGVzdChiZWZvcmUpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjbWRbaSArIDFdID09PSAnPicgfHwgZHVwUmVkaXJlY3QpIHtcbiAgICAgICAgICBidWYgKz0gYztcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIGJ1ZiArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICBmbHVzaCgnb3RoZXInKTtcbiAgcmV0dXJuIHBhcnRzO1xufVxuXG5jb25zdCBMRUFESU5HX0FTU0lHTk1FTlQgPSAvXig/OltBLVphLXpfXVtBLVphLXowLTlfXSo9XFxTKlxccyspKy87XG5cbi8qKiBTdHJpcCBsZWFkaW5nIEZPTz1iYXIgVkFSPWJheiBlbnYtcHJlZml4IGFzc2lnbm1lbnRzIGZyb20gYSBzaW1wbGUgY29tbWFuZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGVDbWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzaW1wbGVDbWQucmVwbGFjZShMRUFESU5HX0FTU0lHTk1FTlQsICcnKTtcbn1cblxuLyoqIE9uZSBxdW90ZS1hd2FyZSBsZXhpY2FsIHRva2VuIGZyb20gYSBzaW1wbGUgY29tbWFuZCdzIHRleHQgKHBsYW4gXHUwMEE3NS4xMCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRva2VuIHtcbiAgLyoqXG4gICAqIFRoZSB0b2tlbiB0ZXh0LiBXb3JkIHRva2VucyBoYXZlIHF1b3RlcyBzdHJpcHBlZCBhbmQgZXNjYXBlcyByZXNvbHZlZDtcbiAgICogcmVkaXJlY3QgdG9rZW5zIGtlZXAgdGhlIG9wZXJhdG9yIHdpdGggYW55IGF0dGFjaGVkIHRhcmdldCAoYD5mYCxcbiAgICogYD4+ZmApLCBzaGVsbC1sZXhlciBzdHlsZS5cbiAgICovXG4gIHRleHQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHRva2VuIHdhcyBxdW90ZWQgb3IgZXNjYXBlZCBhbnl3aGVyZSBpbiB0aGUgc291cmNlLiBBIHF1b3RlZFxuICAgKiB0b2tlbiBpcyBhIHdvcmQsIG5ldmVyIGFuIG9wZXJhdG9yIChgZWNobyAnPidgIGlzIG5vdCBhIHJlZGlyZWN0KS5cbiAgICovXG4gIHF1b3RlZDogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHRva2VuIGlzIGEgcmVkaXJlY3Qgb3BlcmF0b3IgKGA+YCwgYD4+YCwgYDE+YCwgYDI+YCwgYCY+YCxcbiAgICogYCY+PmAsIGA+JmAsIGA8YCwgYDw8YCwgYDw8LWAsIGA8PDxgKSwgd2l0aCBhbnkgYXR0YWNoZWQgdGFyZ2V0IHByZXNlcnZlZFxuICAgKiBpbiBgdGV4dGAuXG4gICAqL1xuICBpc1JlZGlyZWN0OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFF1b3RlLWF3YXJlIHRva2VuaXplciB0aGF0IHNwbGl0cyByZWRpcmVjdCBvcGVyYXRvcnMgYXMgZGlzdGluY3QgdG9rZW5zIHdpdGhcbiAqIGF0dGFjaGVkLXRhcmdldCBmb3JtcyBwcmVzZXJ2ZWQgKHBsYW4gXHUwMEE3NS4xMCkuIFdvcmQgdG9rZW5zIGNhcnJ5IHRoZVxuICogYHF1b3RlZGAgZmxhZyBzbyBjb25zdW1lcnMgY2FuIHRlbGwgYSByZWFsIGA8PGAgb3BlcmF0b3IgZnJvbSBhIHF1b3RlZFxuICogYFwiPDxcImAgbGl0ZXJhbC4gUmV0dXJucyBudWxsIG9uIHVuYmFsYW5jZWQgcXVvdGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9rZW5pemUoczogc3RyaW5nKTogVG9rZW5bXSB8IG51bGwge1xuICBjb25zdCB0b2tlbnM6IFRva2VuW10gPSBbXTtcbiAgbGV0IGJ1ZiA9ICcnO1xuICBsZXQgcXVvdGVkID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHMubGVuZ3RoO1xuXG4gIGNvbnN0IGZsdXNoV29yZCA9ICgpOiB2b2lkID0+IHtcbiAgICBpZiAoYnVmLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIHRva2Vucy5wdXNoKHsgdGV4dDogYnVmLCBxdW90ZWQsIGlzUmVkaXJlY3Q6IGZhbHNlIH0pO1xuICAgIGJ1ZiA9ICcnO1xuICAgIHF1b3RlZCA9IGZhbHNlO1xuICB9O1xuXG4gIC8qKlxuICAgKiBBcHBlbmQgdGhlIHVucXVvdGVkIGNvbnRlbnQgb2YgdGhlIHF1b3RlZCBzZWN0aW9uIG9wZW5pbmcgYXQgYHN0YXJ0YFxuICAgKiAodGhlIHF1b3RlIGNoYXIpIHRvIGBvdXRgLCBtaXJyb3Jpbmcgc2hsZXgncyBlc2NhcGUgcnVsZXMgZm9yIGRvdWJsZVxuICAgKiBxdW90ZXMuIFJldHVybnMgdGhlIGluZGV4IGFmdGVyIHRoZSBjbG9zaW5nIHF1b3RlLCBvciBudWxsIHdoZW5cbiAgICogdW5iYWxhbmNlZC5cbiAgICovXG4gIGNvbnN0IGFwcGVuZFF1b3RlZENvbnRlbnQgPSAob3V0OiBzdHJpbmcsIHN0YXJ0OiBudW1iZXIpOiB7IG91dDogc3RyaW5nOyBuZXh0OiBudW1iZXIgfSB8IG51bGwgPT4ge1xuICAgIGNvbnN0IHF1b3RlID0gc1tzdGFydF07XG4gICAgbGV0IGogPSBzdGFydCArIDE7XG4gICAgd2hpbGUgKGogPCBuKSB7XG4gICAgICBjb25zdCBjID0gc1tqXTtcbiAgICAgIGlmIChxdW90ZSA9PT0gXCInXCIpIHtcbiAgICAgICAgaWYgKGMgPT09IFwiJ1wiKSByZXR1cm4geyBvdXQsIG5leHQ6IGogKyAxIH07XG4gICAgICAgIG91dCArPSBjO1xuICAgICAgICBqICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBqICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhzW2ogKyAxXSkpIHtcbiAgICAgICAgb3V0ICs9IHNbaiArIDFdO1xuICAgICAgICBqICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIHJldHVybiB7IG91dCwgbmV4dDogaiArIDEgfTtcbiAgICAgIG91dCArPSBjO1xuICAgICAgaiArPSAxO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfTtcblxuICAvKipcbiAgICogQXBwZW5kIHRoZSByYXcgYXR0YWNoZWQtdGFyZ2V0IHRleHQgc3RhcnRpbmcgYXQgYHN0YXJ0YCB0byBgb3V0YCBcdTIwMTRcbiAgICogdmVyYmF0aW0sIHF1b3RlZCBzZWN0aW9ucyBzcGFubmluZyBzcGFjZXMgaW5jbHVkZWQgXHUyMDE0IHN0b3BwaW5nIGF0XG4gICAqIHdoaXRlc3BhY2Ugb3IgYW5vdGhlciByZWRpcmVjdCBvcGVyYXRvci4gUmV0dXJucyB0aGUgbmV4dCBpbmRleCwgb3IgbnVsbFxuICAgKiBvbiB1bmJhbGFuY2VkIHF1b3Rlcy5cbiAgICovXG4gIGNvbnN0IGFwcGVuZEF0dGFjaGVkVGFyZ2V0ID0gKG91dDogc3RyaW5nLCBzdGFydDogbnVtYmVyKTogeyBvdXQ6IHN0cmluZzsgbmV4dDogbnVtYmVyIH0gfCBudWxsID0+IHtcbiAgICBsZXQgaiA9IHN0YXJ0O1xuICAgIHdoaWxlIChqIDwgbikge1xuICAgICAgY29uc3QgYyA9IHNbal07XG4gICAgICBpZiAoL1xccy8udGVzdChjKSB8fCBjID09PSAnPCcgfHwgYyA9PT0gJz4nKSByZXR1cm4geyBvdXQsIG5leHQ6IGogfTtcbiAgICAgIGlmIChjID09PSBcIidcIiB8fCBjID09PSAnXCInKSB7XG4gICAgICAgIGNvbnN0IHNlY3Rpb24gPSBhcHBlbmRRdW90ZWRDb250ZW50KCcnLCBqKTtcbiAgICAgICAgaWYgKHNlY3Rpb24gPT09IG51bGwpIHJldHVybiBudWxsO1xuICAgICAgICBvdXQgKz0gcy5zbGljZShqLCBzZWN0aW9uLm5leHQpO1xuICAgICAgICBqID0gc2VjdGlvbi5uZXh0O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaiArIDEgPCBuKSB7XG4gICAgICAgIG91dCArPSBjICsgc1tqICsgMV07XG4gICAgICAgIGogKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBvdXQgKz0gYztcbiAgICAgIGogKz0gMTtcbiAgICB9XG4gICAgcmV0dXJuIHsgb3V0LCBuZXh0OiBqIH07XG4gIH07XG5cbiAgLyoqIEVtaXQgYSByZWRpcmVjdCB0b2tlbiB3aG9zZSB0ZXh0IHByZWZpeGVzIHRoZSBvcGVyYXRvciB3aXRoIHRoZSBjdXJyZW50IGRpZ2l0IGJ1ZmZlciAoYW4gSU9fTlVNQkVSIGxpa2UgYDI+YCkuICovXG4gIGNvbnN0IGVtaXRSZWRpcmVjdCA9IChvcGVyYXRvcjogc3RyaW5nLCBhdHRhY2hlZFN0YXJ0OiBudW1iZXIpOiBib29sZWFuID0+IHtcbiAgICBjb25zdCBhdHRhY2hlZCA9IGFwcGVuZEF0dGFjaGVkVGFyZ2V0KCcnLCBhdHRhY2hlZFN0YXJ0KTtcbiAgICBpZiAoYXR0YWNoZWQgPT09IG51bGwpIHJldHVybiBmYWxzZTtcbiAgICB0b2tlbnMucHVzaCh7IHRleHQ6IGJ1ZiArIG9wZXJhdG9yICsgYXR0YWNoZWQub3V0LCBxdW90ZWQ6IGZhbHNlLCBpc1JlZGlyZWN0OiB0cnVlIH0pO1xuICAgIGJ1ZiA9ICcnO1xuICAgIHF1b3RlZCA9IGZhbHNlO1xuICAgIGkgPSBhdHRhY2hlZC5uZXh0O1xuICAgIHJldHVybiB0cnVlO1xuICB9O1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBzW2ldO1xuICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7XG4gICAgICBmbHVzaFdvcmQoKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIgfHwgYyA9PT0gJ1wiJykge1xuICAgICAgcXVvdGVkID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHNlY3Rpb24gPSBhcHBlbmRRdW90ZWRDb250ZW50KGJ1ZiwgaSk7XG4gICAgICBpZiAoc2VjdGlvbiA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgICBidWYgPSBzZWN0aW9uLm91dDtcbiAgICAgIGkgPSBzZWN0aW9uLm5leHQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIHF1b3RlZCA9IHRydWU7XG4gICAgICBidWYgKz0gc1tpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICc8JyB8fCBjID09PSAnPicpIHtcbiAgICAgIC8vIEEgYDxgL2A+YCBpcyBhIHJlZGlyZWN0IG9wZXJhdG9yIGF0IGEgd29yZCBib3VuZGFyeSwgb3IgYWZ0ZXIgYW5cbiAgICAgIC8vIElPX05VTUJFUiBkaWdpdCBydW4gKGAxPmAsIGAyPmApOyBtaWQtd29yZCBpdCBlbmRzIHRoZSBjdXJyZW50IHdvcmRcbiAgICAgIC8vIGZpcnN0IChgZWNobyBhPmJgIFx1MjE5MiB3b3JkcyBgZWNob2AsIGBhYDsgcmVkaXJlY3QgYD5iYCkuXG4gICAgICBpZiAoYnVmICE9PSAnJyAmJiAhL15cXGQrJC8udGVzdChidWYpKSBmbHVzaFdvcmQoKTtcbiAgICAgIGxldCBvcGVyYXRvcjogc3RyaW5nO1xuICAgICAgaWYgKGMgPT09ICc8Jykge1xuICAgICAgICBpZiAocy5zbGljZShpLCBpICsgMykgPT09ICc8PDwnKSBvcGVyYXRvciA9ICc8PDwnO1xuICAgICAgICBlbHNlIGlmIChzLnNsaWNlKGksIGkgKyAzKSA9PT0gJzw8LScpIG9wZXJhdG9yID0gJzw8LSc7XG4gICAgICAgIGVsc2UgaWYgKHMuc2xpY2UoaSwgaSArIDIpID09PSAnPDwnKSBvcGVyYXRvciA9ICc8PCc7XG4gICAgICAgIGVsc2Ugb3BlcmF0b3IgPSAnPCc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvcGVyYXRvciA9IHMuc2xpY2UoaSwgaSArIDIpID09PSAnPj4nID8gJz4+JyA6ICc+JztcbiAgICAgIH1cbiAgICAgIGlmICghZW1pdFJlZGlyZWN0KG9wZXJhdG9yLCBpICsgb3BlcmF0b3IubGVuZ3RoKSkgcmV0dXJuIG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcmJykge1xuICAgICAgLy8gYCY+YC9gJj4+YCBcdTIwMTQgdGhlIHN0ZG91dCtzdGRlcnIgcmVkaXJlY3QgKGtlcHQgdG9nZXRoZXIgYnlcbiAgICAgIC8vIHNwbGl0VG9wTGV2ZWwpLiBBIGJhcmUgYCZgIGhlcmUgaXMgYW4gb3JkaW5hcnkgd29yZCBjaGFyIChgJjFgIGluXG4gICAgICAvLyBgMj4mMWAsIHdoaWNoIHRoZSBhdHRhY2hlZC10YXJnZXQgc2NhbiBhYm92ZSBjb25zdW1lZCBhbnl3YXkpLlxuICAgICAgaWYgKHNbaSArIDFdID09PSAnPicpIHtcbiAgICAgICAgZmx1c2hXb3JkKCk7XG4gICAgICAgIGNvbnN0IG9wZXJhdG9yID0gcy5zbGljZShpLCBpICsgMykgPT09ICcmPj4nID8gJyY+PicgOiAnJj4nO1xuICAgICAgICBpZiAoIWVtaXRSZWRpcmVjdChvcGVyYXRvciwgaSArIG9wZXJhdG9yLmxlbmd0aCkpIHJldHVybiBudWxsO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGJ1ZiArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICBmbHVzaFdvcmQoKTtcbiAgcmV0dXJuIHRva2Vucztcbn1cblxuLyoqXG4gKiBUaGUgYXR0YWNoZWQgdGFyZ2V0IG9mIGEgcmVkaXJlY3QgdG9rZW4sIG9yIG51bGwgd2hlbiB0aGUgb3BlcmF0b3IgaXNcbiAqIHN0YW5kYWxvbmUgKGA+YCB2cyBgPmZgOyBgMj5gIHZzIGAyPiYxYCkuIFNwbGl0cyBhbiBvcHRpb25hbCBJT19OVU1CRVJcbiAqIGRpZ2l0IHJ1biBvZmYgdGhlIGZyb250LCB0aGVuIHRoZSBvcGVyYXRvciwgbGVhdmluZyB0aGUgdGFyZ2V0LlxuICovXG5mdW5jdGlvbiByZWRpcmVjdEF0dGFjaGVkVGFyZ2V0KHRleHQ6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IHRleHQubWF0Y2goL14oXFxkKikoPDw8fDw8LXwmPj58PDx8Pj58Jj58PiZ8PHw+KSguKikkLyk7XG4gIGlmIChtYXRjaCA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IFssICwgLCByZXN0XSA9IG1hdGNoO1xuICByZXR1cm4gcmVzdC5sZW5ndGggPiAwID8gcmVzdCA6IG51bGw7XG59XG5cbi8qKiBCZXN0LWVmZm9ydCBhcmd2IGZvciBhIHNpbXBsZSBjb21tYW5kOiBsZWFkaW5nIGFzc2lnbm1lbnRzIHN0cmlwcGVkLCBxdW90ZS1hd2FyZSB0b2tlbnMgbWludXMgcmVkaXJlY3Qgb3BlcmF0b3JzIGFuZCB0aGVpciB0YXJnZXRzLiBSZXR1cm5zIG51bGwgaWYgdGhlIGNvbW1hbmQgZG9lc24ndCB0b2tlbml6ZSBjbGVhbmx5ICh1bmJhbGFuY2VkIHF1b3RlcykuICovXG5leHBvcnQgZnVuY3Rpb24gYXJndk9mKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kKS50cmltKCkpO1xuICBpZiAodG9rZW5zID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYXJndjogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b2tlbnMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0b2tlbiA9IHRva2Vuc1tpXTtcbiAgICBpZiAoIXRva2VuLmlzUmVkaXJlY3QpIHtcbiAgICAgIGFyZ3YucHVzaCh0b2tlbi50ZXh0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBBIHN0YW5kYWxvbmUgcmVkaXJlY3Qgb3BlcmF0b3IgY29uc3VtZXMgdGhlIG5leHQgdG9rZW4gYXMgaXRzIHRhcmdldDtcbiAgICAvLyBhbiBhdHRhY2hlZCBmb3JtIChgPmZgLCBgPj5mYCkgaXMgc2VsZi1jb250YWluZWQuXG4gICAgaWYgKHJlZGlyZWN0QXR0YWNoZWRUYXJnZXQodG9rZW4udGV4dCkgPT09IG51bGwpIGkgKz0gMTtcbiAgfVxuICByZXR1cm4gYXJndjtcbn1cbiIsICIvKipcbiAqIFRoZSByYW5nZS1wcmVzZXJ2aW5nIHVuaWZpZWQtZGlmZiBwYXJzZXIgKHBsYW4gXHUwMEE3NS43KSwgc2libGluZyB0b1xuICogbWVjaGFuaWNhbC1jaGFuZ2UudHMncyByYW5nZS1sZXNzIGBwYXJzZVVuaWZpZWREaWZmYC4gVGhlIHBhdGNoL2dpdCBhcHBseVxuICogZ3JhbW1hciBuZWVkcyB0aGUgYEBAIC1hLGIgK2MsZCBAQGAgaHVuayBudW1iZXJzIHRoYXQgcGFyc2VVbmlmaWVkRGlmZlxuICogZGlzY2FyZHMsIHNvIHRoaXMgcGFyc2VzIHRoZSBzYW1lIGhlYWRlciBkaWFsZWN0IGZyb20gc2NyYXRjaC5cbiAqXG4gKiBBIGh1bmsgd2hvc2UgcHJlL3Bvc3QgbGluZSBjb3VudHMgbWF0Y2ggcHJlc2VydmVzIGxpbmUgY29vcmRpbmF0ZXMsIHNvIGFcbiAqIGZpbGUgd2hvc2UgaHVua3MgYXJlIGFsbCBjb3VudC1wcmVzZXJ2aW5nIGdldHMgYW4gZXhhY3QgcmFuZ2UgXHUyMDE0IHRoZSB1bmlvbiBvZlxuICogZXZlcnkgaHVuaydzIHJlZ2lvbi4gQW55IGNvdW50LWNoYW5naW5nIGh1bmsgKHB1cmUgYWRkLCBwdXJlIGRlbGV0ZSwgdW5lcXVhbFxuICogY291bnRzKSBkZWdyYWRlcyB0aGUgZmlsZSB0byBhIHdob2xlLWZpbGUgbW9kaWZ5OiBwb3NpdGlvbnMgYmVsb3cgaXQgc2hpZnQsXG4gKiBhbmQgYSBkZWxldGVkIGxpbmUgb2NjdXBpZXMgbm8gcG9zdC1lZGl0IHJhbmdlIGF0IGFsbC5cbiAqXG4gKiBQZXItZmlsZSBjbGFzc2lmaWNhdGlvbnM6IGBuZXcgZmlsZSBtb2RlYCBcdTIxOTIgY3JlYXRlLW92ZXJ3cml0ZTsgYGRlbGV0ZWQgZmlsZVxuICogbW9kZWAgXHUyMTkyIGRlbGV0ZTsgYHJlbmFtZSBmcm9tYC9gcmVuYW1lIHRvYCBcdTIxOTIgc291cmNlIGRlbGV0ZSArIGRlc3RcbiAqIHJlbmFtZS1jb3B5OyBiaW5hcnkgZGlmZnMgXHUyMTkyIHdob2xlLWZpbGUgbW9kaWZ5OyBhIGArKysgL2Rldi9udWxsYCB0YXJnZXQgKHRoZVxuICogc2hhcGUgYGRpZmYgLXVgLWZvcm1hdCBkZWxldGlvbnMgdGFrZSkgXHUyMTkyIGRlbGV0ZSwgYW5kIGEgYC0tLSAvZGV2L251bGxgIHNpZGVcbiAqICh0aGUgYGRpZmYgLXVgLWZvcm1hdCBjcmVhdGlvbiBzaGFwZSwgd2l0aCBubyBgbmV3IGZpbGUgbW9kZWAgaGVhZGVyKSBcdTIxOTJcbiAqIGNyZWF0ZS1vdmVyd3JpdGUuXG4gKlxuICogR2l0LXN0eWxlIGBhL1x1MjAyNmAvYGIvXHUyMDI2YCBwcmVmaXhlcyBhcmUgc3RyaXBwZWQgcGVyIHRoZSBjYWxsZXIncyBgLXBOYCBzdHJpcFxuICogbGV2ZWw6IGEgbnVtYmVyIHN0cmlwcyB0aGF0IG1hbnkgbGVhZGluZyBwYXRoIGNvbXBvbmVudHMsIGFuZCBgJ2F1dG8nYFxuICogKHBhdGNoJ3MgZGVmYXVsdCkgc3RyaXBzIG9uZSB3aGVuIHRoZSBwYXRoIGlzIGEvLSBvciBiLy1wcmVmaXhlZCBhbmQgbm9uZVxuICogb3RoZXJ3aXNlLiBgL2Rldi9udWxsYCBpcyBjaGVja2VkIGJlZm9yZSBzdHJpcHBpbmcgXHUyMDE0IHRoZSBoZWFkZXIgbWFya2VyXG4gKiB3b3VsZCBvdGhlcndpc2UgbG9zZSBpdHMgYGRldi9gIGNvbXBvbmVudC5cbiAqXG4gKiBgZGlmZiAtdWAgaGVhZGVycyBjYXJyeSBhIHRhYi1zZXBhcmF0ZWQgdGltZXN0YW1wIChgLS0tIGYudHh0XFx0MjAyNC0wMS0wMVxuICogMDA6MDA6MDBgKSBhbmQgbWF5IGJlIENSTEYtdGVybWluYXRlZDsgYm90aCBhcmUgc3RyaXBwZWQgYmVmb3JlIHBhdGhcbiAqIHJlc29sdXRpb24uIFRoZSB0YXJnZXQgb2YgYSBtb2RpZnkgaHVuayBpcyB0aGUgYC0tLWAgc2lkZTogcGF0Y2ggYW5kIGdpdFxuICogYXBwbHkgcmV3cml0ZSB0aGUgZmlsZSBuYW1lZCB0aGVyZSAoZm9yIGBkaWZmIC11IGYudHh0IGYubmV3YCwgdGhlIGArKytgXG4gKiBzaWRlIGlzIG9ubHkgYSBsYWJlbCksIHNvIHRoZSBgKysrYCBsaW5lIG92ZXJyaWRlcyB0aGUgcGF0aCBvbmx5IGZvciB0aGVcbiAqIGAvZGV2L251bGxgIG1hcmtlcnMgXHUyMDE0IGEgYC0tLSAvZGV2L251bGxgIHNpZGUgKGEgbmV3IGZpbGUpIG5hbWVzIHRoZSB0YXJnZXRcbiAqIG9uIGArKytgLCBhbmQgYSBgKysrIC9kZXYvbnVsbGAgc2lkZSBtYXJrcyBhIGRlbGV0aW9uLlxuICpcbiAqIE1hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB0ZXh0IHJldHVybnMgbnVsbCAoZmFpbCBjbG9zZWQgXHUyMDE0IHRoZSBjYWxsZXIgZW1pdHNcbiAqIHVucmVzb2x2ZWQgcmF0aGVyIHRoYW4gZ3Vlc3NpbmcgYXQgdGFyZ2V0cykuXG4gKi9cblxuLyoqIFRoZSBgLXBOYCBoZWFkZXIgc3RyaXAgbGV2ZWw6IGEgY29tcG9uZW50IGNvdW50LCBvciBwYXRjaCdzIGAnYXV0bydgIGRlZmF1bHQuICovXG5leHBvcnQgdHlwZSBQYXRoU3RyaXAgPSBudW1iZXIgfCAnYXV0byc7XG5cbi8qKiBPbmUgZmlsZSBhIHBhdGNoIHRvdWNoZXM6IHRoZSB0YXJnZXQgcGF0aCwgdGhlIHRvdWNoIGtpbmQsIGFuZCB0aGUgZXhhY3QgcmFuZ2Ugd2hlbiB0aGUgaHVua3MgcHJlc2VydmUgbGluZSBjb3VudHMuICovXG5leHBvcnQgaW50ZXJmYWNlIFVuaWZpZWREaWZmVGFyZ2V0IHtcbiAgcGF0aDogc3RyaW5nO1xuICBvcGVyYXRpb246ICdtb2RpZnknIHwgJ2NyZWF0ZS1vdmVyd3JpdGUnIHwgJ2RlbGV0ZScgfCAncmVuYW1lLWNvcHknO1xuICBsaW5lU3RhcnQ/OiBudW1iZXI7XG4gIGxpbmVFbmQ/OiBudW1iZXI7XG59XG5cbmNvbnN0IEhVTktfSEVBREVSID0gL15AQCAtKFxcZCspKD86LChcXGQrKSk/IFxcKyhcXGQrKSg/OiwoXFxkKykpPyBAQC87XG5cbi8qKiBTdHJpcCB0aGUgZmlyc3QgYG5gIGxlYWRpbmcgcGF0aCBjb21wb25lbnRzIChgLXBOYCksIHN0b3BwaW5nIGF0IGEgY29tcG9uZW50LWxlc3MgcGF0aC4gKi9cbmZ1bmN0aW9uIHN0cmlwUGF0aENvbXBvbmVudHMocDogc3RyaW5nLCBuOiBudW1iZXIpOiBzdHJpbmcge1xuICBsZXQgcyA9IHA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7XG4gICAgY29uc3Qgc2xhc2ggPSBzLmluZGV4T2YoJy8nKTtcbiAgICBpZiAoc2xhc2ggPT09IC0xKSByZXR1cm4gcztcbiAgICBzID0gcy5zbGljZShzbGFzaCArIDEpO1xuICB9XG4gIHJldHVybiBzO1xufVxuXG4vKipcbiAqIFRoZSBsZXZlbCB0byBzdHJpcCBmcm9tIGByYXdgIHVuZGVyIGBzdHJpcGA6IGEgbnVtYmVyIHBhc3NlcyB0aHJvdWdoOyBgJ2F1dG8nYFxuICogcmVzb2x2ZXMgdG8gcDEgd2hlbiB0aGUgcGF0aCBpcyBgYS9gL2BiL2AtcHJlZml4ZWQgYW5kIHAwIG90aGVyd2lzZSBcdTIwMTQgcGF0Y2gnc1xuICogZGVmYXVsdCBmb3IgZGlmZnMgd2hvc2UgcHJlZml4ZXMgYXJlIGBkaWZmIC11YC1zdHlsZSByYXRoZXIgdGhhbiBnaXQncy5cbiAqL1xuZnVuY3Rpb24gc3RyaXBMZXZlbEZvcihyYXc6IHN0cmluZywgc3RyaXA6IFBhdGhTdHJpcCk6IG51bWJlciB7XG4gIHJldHVybiBzdHJpcCA9PT0gJ2F1dG8nID8gKHJhdy5zdGFydHNXaXRoKCdhLycpIHx8IHJhdy5zdGFydHNXaXRoKCdiLycpID8gMSA6IDApIDogc3RyaXA7XG59XG5cbi8qKlxuICogVGhlIHJhdyBgLS0tYC9gKysrYCBoZWFkZXIgcGF0aDogdGhlIHRleHQgdXAgdG8gdGhlIGZpcnN0IHRhYiAodGhlXG4gKiBgZGlmZiAtdWAgdGltZXN0YW1wIGNvbHVtbiksIG9yIHRoZSB3aG9sZSB3b3JkIHdoZW4gdGhlcmUgaXMgbm9uZS4gQ1JMRlxuICogaXMgaGFuZGxlZCBhdCB0aGUgbGluZSBsZXZlbCAoc2VlIHBhcnNlVW5pZmllZERpZmZSYW5nZSksIHdoaWNoIGFsc29cbiAqIGNvdmVycyBodW5rIGhlYWRlcnMuXG4gKi9cbmZ1bmN0aW9uIGhlYWRlclBhdGhUZXh0KHJhdzogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdGFiID0gcmF3LmluZGV4T2YoJ1xcdCcpO1xuICByZXR1cm4gdGFiID09PSAtMSA/IHJhdyA6IHJhdy5zbGljZSgwLCB0YWIpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VVbmlmaWVkRGlmZlJhbmdlKHBhdGNoVGV4dDogc3RyaW5nLCBzdHJpcDogUGF0aFN0cmlwKTogVW5pZmllZERpZmZUYXJnZXRbXSB8IG51bGwge1xuICBjb25zdCByZXN1bHRzOiBVbmlmaWVkRGlmZlRhcmdldFtdID0gW107XG4gIGxldCBzYXdCbG9jayA9IGZhbHNlO1xuICBsZXQgY3VycmVudDoge1xuICAgIHBhdGg6IHN0cmluZztcbiAgICBraW5kOiAnbW9kaWZ5JyB8ICduZXcnIHwgJ2RlbGV0ZWQnO1xuICAgIGh1bmtzOiBBcnJheTx7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0+O1xuICAgIGNvdW50Q2hhbmdpbmc6IGJvb2xlYW47XG4gIH0gfCBudWxsID0gbnVsbDtcbiAgbGV0IHBlbmRpbmdLaW5kOiAnbmV3JyB8ICdkZWxldGVkJyB8IG51bGwgPSBudWxsO1xuICBsZXQgcmVuYW1lRnJvbTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCByZW5hbWVUbzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBiaW5hcnkgPSBmYWxzZTtcblxuICAvKiogVGhlIGhlYWRlciBwYXRoLCB0YWIvQ1Itc3RyaXBwZWQsIHdpdGggdGhlIGAtcE5gIGxldmVsIGFwcGxpZWQgXHUyMDE0IGAvZGV2L251bGxgIGtlcHQgdmVyYmF0aW0gKHRoZSBtYXJrZXIgaXMgbmV2ZXIgYSByZWFsIHBhdGgpLiAqL1xuICBjb25zdCBzdHJpcHBlZCA9IChyYXc6IHN0cmluZyk6IHN0cmluZyA9PiB7XG4gICAgY29uc3QgdGV4dCA9IGhlYWRlclBhdGhUZXh0KHJhdyk7XG4gICAgaWYgKHRleHQgPT09ICcvZGV2L251bGwnKSByZXR1cm4gdGV4dDtcbiAgICByZXR1cm4gc3RyaXBQYXRoQ29tcG9uZW50cyh0ZXh0LCBzdHJpcExldmVsRm9yKHRleHQsIHN0cmlwKSk7XG4gIH07XG5cbiAgY29uc3QgZmluaXNoID0gKCk6IHZvaWQgPT4ge1xuICAgIGlmIChjdXJyZW50ICE9PSBudWxsKSB7XG4gICAgICBpZiAoY3VycmVudC5raW5kID09PSAnbmV3JykgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyB9KTtcbiAgICAgIGVsc2UgaWYgKGN1cnJlbnQua2luZCA9PT0gJ2RlbGV0ZWQnKSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ2RlbGV0ZScgfSk7XG4gICAgICBlbHNlIGlmIChiaW5hcnkpIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnbW9kaWZ5JyB9KTtcbiAgICAgIGVsc2UgaWYgKGN1cnJlbnQuaHVua3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIEEgaGVhZGVyLW9ubHkgYmxvY2sgd2l0aCBubyBodW5rczogbm90aGluZyBzdGF0aWNhbGx5IGtub3duLlxuICAgICAgfSBlbHNlIGlmIChjdXJyZW50LmNvdW50Q2hhbmdpbmcpIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnbW9kaWZ5JyB9KTtcbiAgICAgIGVsc2Uge1xuICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKC4uLmN1cnJlbnQuaHVua3MubWFwKChoKSA9PiBoLnN0YXJ0KSk7XG4gICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KC4uLmN1cnJlbnQuaHVua3MubWFwKChoKSA9PiBoLmVuZCkpO1xuICAgICAgICByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ21vZGlmeScsIGxpbmVTdGFydDogc3RhcnQsIGxpbmVFbmQ6IGVuZCB9KTtcbiAgICAgIH1cbiAgICAgIGN1cnJlbnQgPSBudWxsO1xuICAgIH1cbiAgICBpZiAocmVuYW1lRnJvbSAhPT0gbnVsbCkgcmVzdWx0cy5wdXNoKHsgcGF0aDogcmVuYW1lRnJvbSwgb3BlcmF0aW9uOiAnZGVsZXRlJyB9KTtcbiAgICBpZiAocmVuYW1lVG8gIT09IG51bGwpIHJlc3VsdHMucHVzaCh7IHBhdGg6IHJlbmFtZVRvLCBvcGVyYXRpb246ICdyZW5hbWUtY29weScgfSk7XG4gICAgcmVuYW1lRnJvbSA9IG51bGw7XG4gICAgcmVuYW1lVG8gPSBudWxsO1xuICAgIGJpbmFyeSA9IGZhbHNlO1xuICB9O1xuXG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBwYXRjaFRleHQuc3BsaXQoJ1xcbicpKSB7XG4gICAgLy8gQSB0cmFpbGluZyBgXFxyYCAoQ1JMRiBwYXRjaCB0ZXh0IFx1MjAxNCBXaW5kb3dzLWF1dGhvcmVkIGRpZmZzKSBwb2xsdXRlc1xuICAgIC8vIGhlYWRlcnMsIGh1bmsgaGVhZGVycywgYW5kIHBhdGggbGluZXMgYWxpa2U7IGJvdGggcGF0Y2ggYW5kIGdpdCBhcHBseVxuICAgIC8vIHN0cmlwIGl0LCBzbyB0aGUgcGFyc2VyIGRvZXMgdG9vLlxuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLmVuZHNXaXRoKCdcXHInKSA/IHJhd0xpbmUuc2xpY2UoMCwgLTEpIDogcmF3TGluZTtcbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCctLS0gJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGlmIChjdXJyZW50ICE9PSBudWxsKSBmaW5pc2goKTtcbiAgICAgIGN1cnJlbnQgPSB7XG4gICAgICAgIHBhdGg6IHN0cmlwcGVkKGxpbmUuc2xpY2UoNCkpLFxuICAgICAgICBraW5kOiBwZW5kaW5nS2luZCA/PyAnbW9kaWZ5JyxcbiAgICAgICAgaHVua3M6IFtdLFxuICAgICAgICBjb3VudENoYW5naW5nOiBmYWxzZVxuICAgICAgfTtcbiAgICAgIHBlbmRpbmdLaW5kID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCcrKysgJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHBhdGggPSBzdHJpcHBlZChsaW5lLnNsaWNlKDQpKTtcbiAgICAgIGlmIChjdXJyZW50ID09PSBudWxsKSBjdXJyZW50ID0geyBwYXRoLCBraW5kOiBwZW5kaW5nS2luZCA/PyAnbW9kaWZ5JywgaHVua3M6IFtdLCBjb3VudENoYW5naW5nOiBmYWxzZSB9O1xuICAgICAgZWxzZSBpZiAocGF0aCA9PT0gJy9kZXYvbnVsbCcpIGN1cnJlbnQua2luZCA9ICdkZWxldGVkJztcbiAgICAgIGVsc2UgaWYgKGN1cnJlbnQucGF0aCA9PT0gJy9kZXYvbnVsbCcpIHtcbiAgICAgICAgLy8gQSBgLS0tIC9kZXYvbnVsbGAgc2lkZSByZXBsYWNlZCBieSBhIHJlYWwgYCsrK2AgcGF0aCBpcyBhIG5ldyBmaWxlXG4gICAgICAgIC8vICh0aGUgYGRpZmYgLXVgLWZvcm1hdCBjcmVhdGlvbiBzaGFwZSBcdTIwMTQgbm8gYG5ldyBmaWxlIG1vZGVgIGhlYWRlcikuXG4gICAgICAgIC8vIEl0cyBgQEAgLTAsMCArTiBAQGAgaHVuayBoYXMgbm8gcHJlLWVkaXQgbGluZXMsIHNvIHRoZVxuICAgICAgICAvLyBjcmVhdGUtb3ZlcndyaXRlIGlzIGRlY2lkZWQgaGVyZSwgbm90IGZyb20gaHVuayBjb3ZlcmFnZS5cbiAgICAgICAgY3VycmVudC5wYXRoID0gcGF0aDtcbiAgICAgICAgY3VycmVudC5raW5kID0gJ25ldyc7XG4gICAgICB9XG4gICAgICAvLyBPdGhlcndpc2Uga2VlcCB0aGUgYC0tLWAgc2lkZTogcGF0Y2ggYW5kIGdpdCBhcHBseSByZXdyaXRlIHRoZSBmaWxlXG4gICAgICAvLyBuYW1lZCBvbiB0aGUgYC0tLWAgbGluZSwgYW5kIGBkaWZmIC11IGYgZi5uZXdgIGhlYWRlcnMgbmFtZSB0aGVcbiAgICAgIC8vIHByZS1pbWFnZSB0aGVyZSBcdTIwMTQgdGhlIGArKytgIHBhdGggaXMgb25seSBhIGxhYmVsICh0aGUgZGlmZi11dVxuICAgICAgLy8gcGF0Y2gtaGVhZGVyIG1pc3MpLlxuICAgICAgcGVuZGluZ0tpbmQgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ25ldyBmaWxlIG1vZGUnKSkge1xuICAgICAgcGVuZGluZ0tpbmQgPSAnbmV3JztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdkZWxldGVkIGZpbGUgbW9kZScpKSB7XG4gICAgICBwZW5kaW5nS2luZCA9ICdkZWxldGVkJztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdyZW5hbWUgZnJvbSAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgaWYgKGN1cnJlbnQgIT09IG51bGwpIGZpbmlzaCgpO1xuICAgICAgcmVuYW1lRnJvbSA9IHN0cmlwcGVkKGxpbmUuc2xpY2UoJ3JlbmFtZSBmcm9tICcubGVuZ3RoKSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgncmVuYW1lIHRvICcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICByZW5hbWVUbyA9IHN0cmlwcGVkKGxpbmUuc2xpY2UoJ3JlbmFtZSB0byAnLmxlbmd0aCkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ0JpbmFyeSBmaWxlcyAnKSB8fCBsaW5lLnN0YXJ0c1dpdGgoJ0dJVCBiaW5hcnkgcGF0Y2gnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgYmluYXJ5ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBodW5rID0gbGluZS5tYXRjaChIVU5LX0hFQURFUik7XG4gICAgaWYgKGh1bmspIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHByZVN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KGh1bmtbMV0sIDEwKTtcbiAgICAgIGNvbnN0IHByZUNvdW50ID0gaHVua1syXSA9PT0gdW5kZWZpbmVkID8gMSA6IE51bWJlci5wYXJzZUludChodW5rWzJdLCAxMCk7XG4gICAgICBjb25zdCBwb3N0Q291bnQgPSBodW5rWzRdID09PSB1bmRlZmluZWQgPyAxIDogTnVtYmVyLnBhcnNlSW50KGh1bmtbNF0sIDEwKTtcbiAgICAgIGlmIChjdXJyZW50ID09PSBudWxsKSByZXR1cm4gbnVsbDsgLy8gYSBodW5rIHdpdGhvdXQgYSBmaWxlIGhlYWRlciBcdTIxOTIgbWFsZm9ybWVkXG4gICAgICBpZiAocHJlQ291bnQgIT09IHBvc3RDb3VudCkgY3VycmVudC5jb3VudENoYW5naW5nID0gdHJ1ZTtcbiAgICAgIGlmIChwcmVDb3VudCA+IDApIGN1cnJlbnQuaHVua3MucHVzaCh7IHN0YXJ0OiBwcmVTdGFydCwgZW5kOiBwcmVTdGFydCArIHByZUNvdW50IC0gMSB9KTtcbiAgICB9XG4gIH1cbiAgZmluaXNoKCk7XG4gIHJldHVybiBzYXdCbG9jayA/IHJlc3VsdHMgOiBudWxsO1xufVxuIiwgIi8qKlxuICogQ29kZXggYGFwcGx5X3BhdGNoYCBlbnZlbG9wZSBwYXJzZXIuXG4gKlxuICogVHVybnMgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGB0b29sX2lucHV0LmNvbW1hbmRgIHBhdGNoIHN0cmluZyBpbnRvIHRoZVxuICogYEFuY2hvclNwZWNbXWAgc2hhcGUgdGhlIHNoYXJlZCB0b3VjaCBjb3JlIGFscmVhZHkgY29uc3VtZXMgXHUyMDE0IHRoZSBvbmVcbiAqIGdlbnVpbmVseSBuZXcgYWxnb3JpdGhtIHRoZSBDb2RleCBhZGFwdGVyIG5lZWRzLiBJdCByZXBsYWNlcyB0aGUgc3RydWN0dXJlZFxuICogYGZpbGVfcGF0aGAvYG9sZF9zdHJpbmdgL2BvZmZzZXRgIHJlYWRpbmcgdGhlIENsYXVkZSBQb3N0VG9vbFVzZSB0b3VjaCBob29rXG4gKiBkb2VzLCBiZWNhdXNlIENvZGV4IGRlbGl2ZXJzIGV2ZXJ5IGVkaXQgYXMgYSBzaW5nbGUgYXBwbHlfcGF0Y2ggZW52ZWxvcGVcbiAqIHJhdGhlciB0aGFuIGEgdHlwZWQgdG9vbCBpbnB1dC5cbiAqXG4gKiBUaGUgbW9kdWxlIGlzIHB1cmU6IGl0IGltcG9ydHMgb25seSB0aGUga2VybmVsIGFuY2hvciB0eXBlcyBhbmQgbmV2ZXIgdG91Y2hlc1xuICogdGhlIENvZGV4IFNESywgc28gaXQgaXMgREktdGVzdGFibGUgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGVcbiAqIHNoYXJlZCBrZXJuZWwuIFJhbmdlIHJlY292ZXJ5IGlzIGJlc3QtZWZmb3J0IFx1MjAxNCB0aGUgYXBwbHlfcGF0Y2ggZm9ybWF0IGNhcnJpZXNcbiAqIGBAQGAgY29udGV4dCBhbmQgYCtgL2AtYC9zcGFjZSBjaGFuZ2UgbGluZXMgYnV0IG5vIGV4cGxpY2l0IGxpbmUgbnVtYmVycywgc28gYVxuICogcmFuZ2UgY2FuIG9ubHkgYmUgcmVjb3ZlcmVkIGJ5IGxvY2F0aW5nIGEgaHVuaydzIHByZS1lZGl0IGJsb2NrIGluIHRoZVxuICogb24tZGlzayBmaWxlLiBUaGF0IGZpbGUgcmVhZCBpcyBpbmplY3RlZCAoYHJlYWRQcmVFZGl0RmlsZWApIHNvIHRoZSBmdW5jdGlvblxuICogc3RheXMgcHVyZSBhbmQgdGVzdGFibGUuIE9uIEFOWSBhbWJpZ3VpdHkgKG5vIHJlYWRlciwgZmlsZSBtaXNzaW5nLCBjb250ZXh0XG4gKiBub3QgZm91bmQsIGZ1enp5L2R1cGxpY2F0ZSBtYXRjaCkgdGhlIHBhcnNlciBkZWdyYWRlcyB0byBhIHdob2xlLWZpbGUgYW5jaG9yXG4gKiByYXRoZXIgdGhhbiB0aHJvd2luZyBcdTIwMTQgd2hvbGUtZmlsZSBhbmNob3JzIGFyZSBmaXJzdC1jbGFzcyBhbmQgdG91Y2ggdHJhY2tpbmdcbiAqIG11c3QgbmV2ZXIgYmUgYmxvY2tlZC5cbiAqXG4gKiBUaGUgZ3JhbW1hciBpcyBjcm9zcy1jaGVja2VkIGFnYWluc3QgQ29kZXgncyBvd24gYXBwbHlfcGF0Y2ggY3JhdGVcbiAqIChjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMve3BhcnNlcixzdHJlYW1pbmdfcGFyc2VyfS5ycykuIFR3byBzdWJ0bGV0aWVzIGFyZVxuICogbWlycm9yZWQgZGVsaWJlcmF0ZWx5OiBodW5rLWhlYWRlciBtYXJrZXJzIGFyZSBvbmx5IHJlY29nbml6ZWQgYXQgdGhlIHN0YXJ0IG9mXG4gKiBhIGxpbmUgd2l0aCBubyBsZWFkaW5nIHdoaXRlc3BhY2Ugd2hpbGUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rIChhIGxlYWRpbmcgc3BhY2VcbiAqIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpLCBhbmQgYSBiYXJlIGVtcHR5IGxpbmUgaW5zaWRlIGFuIFVwZGF0ZVxuICogaHVuayBpcyB0cmVhdGVkIGFzIGFuIGVtcHR5IGNvbnRleHQgbGluZSBwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcgY29udGVudC5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCB0eXBlIHsgQW5jaG9yU3BlYywgTGluZVJhbmdlIH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5cbi8qKlxuICogQW4gYW5jaG9yIHBhcnNlZCBmcm9tIGFuIGFwcGx5X3BhdGNoIGVudmVsb3BlOiBhbiB7QGxpbmsgQW5jaG9yU3BlY30gcGx1c1xuICogdGhlIGRlbGV0ZSBjbGFzc2lmaWNhdGlvbiAocGxhbiBcdTAwQTczKS4gYCoqKiBEZWxldGUgRmlsZTpgIGh1bmtzIGtlZXAgdGhlXG4gKiBgd2hvbGUtd3JpdGVgIGtpbmQgKFRvdWNoS2luZCBpcyBmaXhlZCkgYW5kIGFkZCB0aGUgYGFic2VudGAgbWFya2VyIHNvIHRoZVxuICogYXBwbHlfcGF0Y2ggY2FsbCBzaXRlIHBhc3NlcyBgdGFyZ2V0U3RhdGU6ICdhYnNlbnQnYCBcdTIwMTQgd2l0aG91dCBpdCB0aGVcbiAqIGRlbGV0aW9uIHRvdWNoIHdvdWxkIGJlIGdhdGVkIGF3YXkgYnkgdGhlIGAnZXhpc3RzJ2AgZGVmYXVsdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBcHBseVBhdGNoQW5jaG9yIGV4dGVuZHMgQW5jaG9yU3BlYyB7XG4gIC8qKiB0cnVlIGZvciBgKioqIERlbGV0ZSBGaWxlOmAgaHVua3MgXHUyMDE0IHRoZSB0b3VjaCdzIHRhcmdldFN0YXRlIGlzIGAnYWJzZW50J2AuICovXG4gIGFic2VudD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogUmVhZHMgdGhlIHByZS1lZGl0IChvbi1kaXNrLCBiZWZvcmUgdGhlIHBhdGNoIGFwcGxpZXMpIGNvbnRlbnQgb2YgdGhlIGZpbGUgYXRcbiAqIGBwYXRoYCwgb3IgcmV0dXJucyBgbnVsbGAgd2hlbiBpdCBjYW5ub3QgYmUgcmVhZC4gSW5qZWN0ZWQgc28gdGhlIHBhcnNlciBzdGF5c1xuICogcHVyZTsgY2FsbCBzaXRlcyBkZWZhdWx0IHRvIGEgcmVhbCBmaWxlc3lzdGVtIHJlYWQuXG4gKi9cbmV4cG9ydCB0eXBlIFJlYWRQcmVFZGl0RmlsZSA9IChwYXRoOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gR3JhbW1hciBtYXJrZXJzIChtaXJyb3JzIGNvZGV4LXJzL2FwcGx5LXBhdGNoL3NyYy9wYXJzZXIucnMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgRU5EX1BBVENIX01BUktFUiA9ICcqKiogRW5kIFBhdGNoJztcbmNvbnN0IEFERF9GSUxFX01BUktFUiA9ICcqKiogQWRkIEZpbGU6ICc7XG5jb25zdCBERUxFVEVfRklMRV9NQVJLRVIgPSAnKioqIERlbGV0ZSBGaWxlOiAnO1xuY29uc3QgVVBEQVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBVcGRhdGUgRmlsZTogJztcbmNvbnN0IE1PVkVfVE9fTUFSS0VSID0gJyoqKiBNb3ZlIHRvOiAnO1xuY29uc3QgRU9GX01BUktFUiA9ICcqKiogRW5kIG9mIEZpbGUnO1xuY29uc3QgQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAICc7XG5jb25zdCBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIgPSAnQEAnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEludGVybWVkaWF0ZSBodW5rIG1vZGVsXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFVwZGF0ZUNodW5rIHtcbiAgLyoqIE9wdGlvbmFsIGBAQCA8Y29udGV4dD5gIGxpbmUgdXNlZCB0byBkaXNhbWJpZ3VhdGUgdGhlIGJsb2NrJ3MgbG9jYXRpb24uICovXG4gIGNoYW5nZUNvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKiBQcmUtZWRpdCBsaW5lcyB0aGlzIGNodW5rIGNvdmVycyAoY29udGV4dCBgIGAgKyByZW1vdmVkIGAtYCksIGluIG9yZGVyLiAqL1xuICBvbGRMaW5lczogc3RyaW5nW107XG4gIC8qKiBQb3N0LWVkaXQgbGluZXMgKGNvbnRleHQgYCBgICsgYWRkZWQgYCtgKTsgcmV0YWluZWQgZm9yIGNvbXBsZXRlbmVzcy4gKi9cbiAgbmV3TGluZXM6IHN0cmluZ1tdO1xufVxuXG50eXBlIEh1bmsgPVxuICB8IHsga2luZDogJ2FkZCc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAnZGVsZXRlJzsgcGF0aDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6ICd1cGRhdGUnOyBwYXRoOiBzdHJpbmc7IG1vdmVQYXRoOiBzdHJpbmcgfCBudWxsOyBjaHVua3M6IFVwZGF0ZUNodW5rW10gfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHJlYWRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVhbC1maWxlc3lzdGVtIHJlYWRlciB1c2VkIHdoZW4gbm8gcmVhZGVyIGlzIGluamVjdGVkLiBCZXN0LWVmZm9ydDogYW55XG4gKiBmYWlsdXJlIChtaXNzaW5nIGZpbGUsIHBlcm1pc3Npb24gZXJyb3IpIHlpZWxkcyBgbnVsbGAsIHdoaWNoIHRoZSBwYXJzZXJcbiAqIGRlZ3JhZGVzIHRvIGEgd2hvbGUtZmlsZSBhbmNob3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0UmVhZFByZUVkaXRGaWxlKHBhdGg6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICB0cnkge1xuICAgIHJldHVybiBmcy5yZWFkRmlsZVN5bmMocGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRW52ZWxvcGUgc2Nhbm5pbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNjYW4gdGhlIHBhdGNoIHRleHQgaW50byBodW5rcy4gTGVuaWVudCBieSBkZXNpZ246IHVucmVjb2duaXplZCBsaW5lcyBhcmVcbiAqIGlnbm9yZWQgcmF0aGVyIHRoYW4gcmVqZWN0ZWQsIGFuZCBCZWdpbi9FbmQvRW52aXJvbm1lbnQgbGluZXMgYXJlIHNraXBwZWQsIHNvXG4gKiBhIG1hbGZvcm1lZCBlbnZlbG9wZSBkZWdyYWRlcyB0byB3aGF0ZXZlciBodW5rcyBjb3VsZCBiZSByZWNvdmVyZWQgKG9mdGVuXG4gKiBub25lIFx1MjE5MiBgW11gKSBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICovXG5mdW5jdGlvbiBzY2FuSHVua3MoY29tbWFuZDogc3RyaW5nKTogSHVua1tdIHtcbiAgY29uc3QgaHVua3M6IEh1bmtbXSA9IFtdO1xuICAvLyBUaGUgY3VycmVudGx5LW9wZW4gVXBkYXRlIGh1bmssIG9yIG51bGwuIEFkZC9EZWxldGUgaHVua3MgaGF2ZSBubyBib2R5LCBzb1xuICAvLyB0aGV5IGNsb3NlIGltbWVkaWF0ZWx5IGFuZCByZXNldCB0aGlzIHRvIG51bGwuXG4gIGxldCBvcGVuVXBkYXRlOiAoSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSkgfCBudWxsID0gbnVsbDtcblxuICBmb3IgKGNvbnN0IHJhdyBvZiBjb21tYW5kLnNwbGl0KCdcXG4nKSkge1xuICAgIC8vIEhlYWRlciBkZXRlY3Rpb24gaXMgd2hpdGVzcGFjZS1zZW5zaXRpdmUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rOiBDb2RleCB1c2VzXG4gICAgLy8gdHJpbV9lbmQgdGhlcmUgKGxlYWRpbmcgc3BhY2UgZGVtb3RlcyBhIG1hcmtlciB0byBhIGNvbnRleHQgbGluZSkgYW5kIGZ1bGxcbiAgICAvLyB0cmltIGVsc2V3aGVyZS4gTWF0Y2ggdGhhdCBzbyBpbmRlbnRlZCBtYXJrZXJzIGluc2lkZSBhIGh1bmsgc3RheSBjb250ZW50LlxuICAgIGNvbnN0IGhlYWRlckxpbmU6IHN0cmluZyA9IG9wZW5VcGRhdGUgPyByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJykgOiByYXcudHJpbSgpO1xuXG4gICAgaWYgKGhlYWRlckxpbmUgPT09IEVORF9QQVRDSF9NQVJLRVIpIHtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoQUREX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdhZGQnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKEFERF9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChERUxFVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBodW5rcy5wdXNoKHsga2luZDogJ2RlbGV0ZScsIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoREVMRVRFX0ZJTEVfTUFSS0VSLmxlbmd0aCkgfSk7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKFVQREFURV9GSUxFX01BUktFUikpIHtcbiAgICAgIGNvbnN0IGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0gPSB7XG4gICAgICAgIGtpbmQ6ICd1cGRhdGUnLFxuICAgICAgICBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKFVQREFURV9GSUxFX01BUktFUi5sZW5ndGgpLFxuICAgICAgICBtb3ZlUGF0aDogbnVsbCxcbiAgICAgICAgY2h1bmtzOiBbXVxuICAgICAgfTtcbiAgICAgIGh1bmtzLnB1c2goaHVuayk7XG4gICAgICBvcGVuVXBkYXRlID0gaHVuaztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChvcGVuVXBkYXRlKSB7XG4gICAgICBwcm9jZXNzVXBkYXRlTGluZShvcGVuVXBkYXRlLCByYXcpO1xuICAgIH1cbiAgICAvLyBBbnkgb3RoZXIgbGluZSBvdXRzaWRlIGFuIFVwZGF0ZSBodW5rIChCZWdpbiBQYXRjaCwgRW52aXJvbm1lbnQgSUQsIEFkZFxuICAgIC8vIEZpbGUgYCtgIGNvbnRlbnQsIHN0cmF5IHRleHQpIGlzIGlnbm9yZWQuXG4gIH1cblxuICByZXR1cm4gaHVua3M7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZUNodW5rKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pOiBVcGRhdGVDaHVuayB7XG4gIGNvbnN0IGxhc3QgPSBodW5rLmNodW5rc1todW5rLmNodW5rcy5sZW5ndGggLSAxXTtcbiAgaWYgKGxhc3QpIHJldHVybiBsYXN0O1xuICBjb25zdCBjaHVuazogVXBkYXRlQ2h1bmsgPSB7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH07XG4gIGh1bmsuY2h1bmtzLnB1c2goY2h1bmspO1xuICByZXR1cm4gY2h1bms7XG59XG5cbi8qKiBBcHBseSBvbmUgYm9keSBsaW5lIG9mIGFuIFVwZGF0ZSBodW5rIHRvIGl0cyBjaHVuayBsaXN0LiAqL1xuZnVuY3Rpb24gcHJvY2Vzc1VwZGF0ZUxpbmUoaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSwgcmF3OiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgdHJpbW1lZEVuZCA9IHJhdy5yZXBsYWNlKC9bIFxcdFxccl0rJC8sICcnKTtcblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU9GX01BUktFUikgcmV0dXJuOyAvLyBlbmQtb2YtZmlsZSBoaW50OyBub3QgbmVlZGVkIGZvciByYW5nZXNcblxuICAvLyBgKioqIE1vdmUgdG86YCBpcyBvbmx5IG1lYW5pbmdmdWwgYmVmb3JlIGFueSBjaGFuZ2UgY29udGVudC5cbiAgaWYgKGh1bmsuY2h1bmtzLmxlbmd0aCA9PT0gMCAmJiBodW5rLm1vdmVQYXRoID09PSBudWxsICYmIHRyaW1tZWRFbmQuc3RhcnRzV2l0aChNT1ZFX1RPX01BUktFUikpIHtcbiAgICBodW5rLm1vdmVQYXRoID0gdHJpbW1lZEVuZC5zbGljZShNT1ZFX1RPX01BUktFUi5sZW5ndGgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICh0cmltbWVkRW5kID09PSBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogbnVsbCwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0cmltbWVkRW5kLnN0YXJ0c1dpdGgoQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSkge1xuICAgIGh1bmsuY2h1bmtzLnB1c2goeyBjaGFuZ2VDb250ZXh0OiB0cmltbWVkRW5kLnNsaWNlKENIQU5HRV9DT05URVhUX01BUktFUi5sZW5ndGgpLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBIGJhcmUgZW1wdHkgbGluZSBpcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgKHByZXNlbnQgaW4gYm90aCBvbGQgYW5kIG5ldykuXG4gIGlmIChyYXcgPT09ICcnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKCcnKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKCcnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZmlyc3QgPSByYXdbMF07XG4gIGlmIChmaXJzdCA9PT0gJyAnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjb25zdCBjb250ZW50ID0gcmF3LnNsaWNlKDEpO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2goY29udGVudCk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaChjb250ZW50KTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnKycpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnLScpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gVW5yZWNvZ25pemVkIGNvbnRlbnQgbGluZSBcdTIwMTQgaWdub3JlIGxlbmllbnRseSByYXRoZXIgdGhhbiB0aHJvdy5cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSYW5nZSByZWNvdmVyeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTcGxpdCBmaWxlIGNvbnRlbnQgaW50byBsaW5lcyBmb3IgbWF0Y2hpbmcuIEEgdHJhaWxpbmcgbmV3bGluZSB5aWVsZHMgYVxuICogdHJhaWxpbmcgZW1wdHkgZWxlbWVudCwgd2hpY2ggaXMgaGFybWxlc3MgZm9yIHN1Yi1zbGljZSBtYXRjaGluZy4gKi9cbmZ1bmN0aW9uIHNwbGl0TGluZXMoY29udGVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gY29udGVudC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKiBJbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgdmFsdWVgIGFwcGVhcnMgYXMgYSBmdWxsIGxpbmUgaW4gYGxpbmVzYC4gKi9cbmZ1bmN0aW9uIGxpbmVJbmRpY2VzKGxpbmVzOiBzdHJpbmdbXSwgdmFsdWU6IHN0cmluZyk6IG51bWJlcltdIHtcbiAgY29uc3Qgb3V0OiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGxpbmVzW2ldID09PSB2YWx1ZSkgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFN0YXJ0IGluZGljZXMgKDAtYmFzZWQpIGF0IHdoaWNoIGBuZWVkbGVgIG1hdGNoZXMgY29udGlndW91c2x5IGluIGBoYXlzdGFja2AuICovXG5mdW5jdGlvbiBjb250aWd1b3VzTWF0Y2hlcyhoYXlzdGFjazogc3RyaW5nW10sIG5lZWRsZTogc3RyaW5nW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDAgfHwgbmVlZGxlLmxlbmd0aCA+IGhheXN0YWNrLmxlbmd0aCkgcmV0dXJuIG91dDtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSBvdXQucHVzaChpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIExvY2F0ZSBhIHNpbmdsZSBjaHVuaydzIHByZS1lZGl0IGJsb2NrIGluIHRoZSBmaWxlLCByZXR1cm5pbmcgaXRzIDEtYmFzZWRcbiAqIGxpbmUgcmFuZ2Ugb3IgbnVsbCB3aGVuIGl0IGNhbm5vdCBiZSBsb2NhdGVkIHVuYW1iaWd1b3VzbHkuXG4gKlxuICogLSBOb24tZW1wdHkgYmxvY2s6IHJlcXVpcmUgYSB1bmlxdWUgY29udGlndW91cyBtYXRjaCwgb3IgXHUyMDE0IHdoZW4gZHVwbGljYXRlZCBcdTIwMTRcbiAqICAgYSBgQEBgIGNoYW5nZS1jb250ZXh0IGxpbmUgdGhhdCBzZWxlY3RzIHRoZSBvY2N1cnJlbmNlIGFmdGVyIGl0LlxuICogLSBFbXB0eSBibG9jayAocHVyZSBpbnNlcnRpb24pOiBhbmNob3Igb24gYSB1bmlxdWUgY2hhbmdlLWNvbnRleHQgbGluZSBpZiBvbmVcbiAqICAgaXMgZ2l2ZW47IG90aGVyd2lzZSBpdCBpcyB1bmxvY2F0YWJsZS5cbiAqL1xuZnVuY3Rpb24gbG9jYXRlQ2h1bmsocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVuazogVXBkYXRlQ2h1bmspOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgYmxvY2sgPSBjaHVuay5vbGRMaW5lcztcblxuICBpZiAoYmxvY2subGVuZ3RoID09PSAwKSB7XG4gICAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICAgIGNvbnN0IGN0eElkeHMgPSBsaW5lSW5kaWNlcyhwcmVMaW5lcywgY3R4KTtcbiAgICAgIGlmIChjdHhJZHhzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBjb25zdCBsaW5lID0gY3R4SWR4c1swXSArIDE7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiBsaW5lLCBlbmQ6IGxpbmUgfTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBzdGFydHMgPSBjb250aWd1b3VzTWF0Y2hlcyhwcmVMaW5lcywgYmxvY2spO1xuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IHMgPSBzdGFydHNbMF07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHMgKyAxLCBlbmQ6IHMgKyBibG9jay5sZW5ndGggfTtcbiAgfVxuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gRHVwbGljYXRlZCBibG9jazogdXNlIHRoZSBjaGFuZ2UgY29udGV4dCB0byBzZWxlY3QgdGhlIG1hdGNoIGFmdGVyIGl0LlxuICBjb25zdCBjdHggPSBjaHVuay5jaGFuZ2VDb250ZXh0O1xuICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICBmb3IgKGNvbnN0IGMgb2YgbGluZUluZGljZXMocHJlTGluZXMsIGN0eCkpIHtcbiAgICAgIGNvbnN0IGFmdGVyID0gc3RhcnRzLmZpbmQoKHMpID0+IHMgPj0gYyk7XG4gICAgICBpZiAoYWZ0ZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4geyBzdGFydDogYWZ0ZXIgKyAxLCBlbmQ6IGFmdGVyICsgYmxvY2subGVuZ3RoIH07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsOyAvLyBhbWJpZ3VvdXMgXHUyMTkyIGNhbGxlciBkZWdyYWRlcyB0byB3aG9sZS1maWxlXG59XG5cbi8qKlxuICogUmVjb3ZlciBhIHNpbmdsZSBsaW5lIHJhbmdlIHNwYW5uaW5nIGFsbCBvZiBhbiB1cGRhdGUncyBjaHVua3MuIFJldHVybnMgbnVsbFxuICogKFx1MjE5MiB3aG9sZS1maWxlIGZhbGxiYWNrKSBpZiBhbnkgY2h1bmsgY2Fubm90IGJlIGxvY2F0ZWQuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSYW5nZShwcmVMaW5lczogc3RyaW5nW10sIGNodW5rczogVXBkYXRlQ2h1bmtbXSk6IExpbmVSYW5nZSB8IG51bGwge1xuICBsZXQgdW5pb246IExpbmVSYW5nZSB8IG51bGwgPSBudWxsO1xuICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgIGNvbnN0IHIgPSBsb2NhdGVDaHVuayhwcmVMaW5lcywgY2h1bmspO1xuICAgIGlmIChyID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICB1bmlvbiA9IHVuaW9uID09PSBudWxsID8gciA6IHsgc3RhcnQ6IE1hdGgubWluKHVuaW9uLnN0YXJ0LCByLnN0YXJ0KSwgZW5kOiBNYXRoLm1heCh1bmlvbi5lbmQsIHIuZW5kKSB9O1xuICB9XG4gIHJldHVybiB1bmlvbjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgQVBJXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBQYXJzZSBhIENvZGV4IGBhcHBseV9wYXRjaGAgY29tbWFuZCBzdHJpbmcgaW50byBhbiBhbmNob3IgcGVyIHRvdWNoZWQgZmlsZS5cbiAqXG4gKiAtIGAqKiogQWRkIEZpbGU6YCBcdTIxOTIgYGNyZWF0ZWAgKHdob2xlLWZpbGUpXG4gKiAtIGAqKiogRGVsZXRlIEZpbGU6YCBcdTIxOTIgYHdob2xlLXdyaXRlYCB3aXRoIHRoZSBgYWJzZW50YCBtYXJrZXIgKHdob2xlLWZpbGU7XG4gKiAgIHRoZSBmaWxlIG5vIGxvbmdlciBleGlzdHMgXHUyMDE0IHRoZSB0b3VjaCB0YXJnZXRzIGFic2VuY2UsIHBsYW4gXHUwMEE3MylcbiAqIC0gYCoqKiBVcGRhdGUgRmlsZTpgIFx1MjE5MiBgd3JpdGVgIHdpdGggYSByZWNvdmVyZWQgbGluZSByYW5nZSB3aGVuIHRoZSBodW5rJ3NcbiAqICAgcHJlLWVkaXQgYmxvY2sgY2FuIGJlIGxvY2F0ZWQgdmlhIGByZWFkUHJlRWRpdEZpbGVgLCBvdGhlcndpc2UgYHdob2xlLXdyaXRlYC5cbiAqICAgQSByZW5hbWVkIHVwZGF0ZSAoYCoqKiBNb3ZlIHRvOmApIGFuY2hvcnMgdGhlIGRlc3RpbmF0aW9uIHBhdGggYXNcbiAqICAgYHdob2xlLXdyaXRlYCBzaW5jZSBwcmUtZWRpdCBsaW5lIG51bWJlcnMgY2Fubm90IGJlIG1hcHBlZCBhY3Jvc3MgYSByZW5hbWUuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhIG1hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB5aWVsZHMgYFtdYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQXBwbHlQYXRjaChcbiAgY29tbWFuZDogc3RyaW5nLFxuICByZWFkUHJlRWRpdEZpbGU6IFJlYWRQcmVFZGl0RmlsZSA9IGRlZmF1bHRSZWFkUHJlRWRpdEZpbGVcbik6IEFwcGx5UGF0Y2hBbmNob3JbXSB7XG4gIGNvbnN0IGFuY2hvcnM6IEFwcGx5UGF0Y2hBbmNob3JbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgaHVuayBvZiBzY2FuSHVua3MoY29tbWFuZCkpIHtcbiAgICBpZiAoaHVuay5raW5kID09PSAnYWRkJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnY3JlYXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaHVuay5raW5kID09PSAnZGVsZXRlJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnd2hvbGUtd3JpdGUnLCBhYnNlbnQ6IHRydWUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGU6IGFuY2hvciBvbiB0aGUgZGVzdGluYXRpb24gcGF0aCAocG9zdC1lZGl0IGxvY2F0aW9uKS5cbiAgICBjb25zdCB0YXJnZXRQYXRoID0gdG9Qb3NpeChodW5rLm1vdmVQYXRoID8/IGh1bmsucGF0aCk7XG5cbiAgICAvLyBBIHJlbmFtZSBkZWZlYXRzIHByZS1lZGl0IGxpbmUgbWFwcGluZyBcdTIwMTQgYW5jaG9yIHdob2xlLWZpbGUgb24gdGhlIHRhcmdldC5cbiAgICBpZiAoaHVuay5tb3ZlUGF0aCAhPT0gbnVsbCkge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dob2xlLXdyaXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFJhbmdlIHJlY292ZXJ5IHJlYWRzIHRoZSBwcmUtZWRpdCBjb250ZW50IGF0IHRoZSBvcmlnaW5hbCAocHJlLW1vdmUpIHBhdGguXG4gICAgY29uc3QgY29udGVudCA9IHJlYWRQcmVFZGl0RmlsZShodW5rLnBhdGgpO1xuICAgIGNvbnN0IHJhbmdlID0gY29udGVudCA9PT0gbnVsbCA/IG51bGwgOiByZWNvdmVyUmFuZ2Uoc3BsaXRMaW5lcyhjb250ZW50KSwgaHVuay5jaHVua3MpO1xuICAgIGlmIChyYW5nZSAhPT0gbnVsbCkge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dyaXRlJywgcmFuZ2UgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGFuY2hvcnM7XG59XG4iLCAiLyoqXG4gKiBDb2RleCBQb3N0VG9vbFVzZSB0b3VjaCBob29rIFx1MjAxNCBoZWFsICsgc3VyZmFjZSBhZnRlciBhIGNvbmZpcm1lZCBgYXBwbHlfcGF0Y2hgLFxuICogb3IgYSBzaGVsbC9leGVjIGNhbGwgd2hvc2UgY29tbWFuZCBzdGF0aWNhbGx5IHJlc29sdmVzIHRvIGZpbGUrbGluZSBpZGlvbXMuXG4gKlxuICogUG9zdFRvb2xVc2UgZmlyZXMgYWZ0ZXIgYGFwcGx5X3BhdGNoYCBoYXMgcnVuLCBzbyB0aGlzIGlzIHRoZSBhY2N1cmF0ZSBob21lIGZvclxuICogdGhlIHRvdWNoIHNpZ25hbDogdGhlIGZpbGUgaXMgYWxyZWFkeSB3cml0dGVuLCBzbyBhIHNjb3BlZCBgZ2l0IHNwYW4gZHJpZnRcbiAqIDxmaWxlPiAtLWZpeGAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBhZ2FpbnN0IHJlYWwgYnl0ZXMgYW5kIHRoZSBzdXJmYWNlZCBibG9ja1xuICogcmVmbGVjdHMgdGhlIGhlYWxlZCBhbmNob3JzLiBUaGUgaGFuZGxlciBuYXJyb3dzIHRoZSBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlXG4gKiAoYHRvb2xfaW5wdXQuY29tbWFuZGAsIFNESy10eXBlZCBgdW5rbm93bmApIGludG8gcGVyLWZpbGUgYW5jaG9ycyB2aWEgdGhlXG4gKiBzaGFyZWQgW2FwcGx5LXBhdGNoIHBhcnNlcl0oLi9hcHBseS1wYXRjaC50cyksIGFuZCByZWNvdmVycyBzaGVsbCBjb21tYW5kc1xuICogZnJvbSBlaXRoZXIgQ29kZXggZW52ZWxvcGUgKGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgSlNPTiBgYXJndW1lbnRzYCwgb3JcbiAqIGNvZGUtbW9kZSBgZXhlY2Agd3JhcHBpbmcgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgKSB2aWEgdGhlIHNoYXJlZFxuICogW2NvbW1hbmQgcGFyc2VyXSguLi9jb21tb24vcGFyc2UtY29tbWFuZC50cyk7IGVhY2ggdG91Y2hlZCBmaWxlIGlzIHNjb3BlZCB0b1xuICogdGhlIENXRCByZXBvLCBhbmQgZHJpdmVzIHRoZSBoYXJuZXNzLWFnbm9zdGljIHtAbGluayBydW5Ub3VjaEhvb2t9IGNvcmUgXHUyMDE0IHRoZVxuICogc2FtZSBjb3JlIHRoZSBDbGF1ZGUgYWRhcHRlciB1c2VzLlxuICpcbiAqIFR3byBDb2RleC1zcGVjaWZpYyBjb25jZXJucyBhcmUgcHJlc2VydmVkIGZyb20gdGhpcyBmaWxlJ3Mgam91cm5hbGluZ1xuICogcHJlZGVjZXNzb3I6XG4gKlxuICogMS4gKipTdWNjZXNzIGNsYXNzaWZpY2F0aW9uLioqIFRoZSBwYXJzZWQgZW52ZWxvcGUgZGVzY3JpYmVzICppbnRlbnQqLCBub3RcbiAqICAgICpvdXRjb21lKi4gQ29kZXggY29yZSBmaXJlcyBQb3N0VG9vbFVzZSBvbmx5IG9uIHRvb2wgc3VjY2VzcywgYnV0IGFzIGFcbiAqICAgIGR1cmFiaWxpdHkgYmVsdCB3ZSBjbGFzc2lmeSBgdG9vbF9yZXNwb25zZWAgdmlhXG4gKiAgICB7QGxpbmsgY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2V9OiBhIGNvbmZpcm1lZCByZWplY3Rpb24gKGAnZmFpbHVyZSdgKVxuICogICAgc3VwcHJlc3NlcyB0aGUgdG91Y2ggKG5vIHBoYW50b20gaGVhbC9zdXJmYWNlIG9uIGEgcGF0Y2ggdGhhdCBuZXZlclxuICogICAgYXBwbGllZCk7IGEgc3VjY2VzcyBvciBhbiB1bnJlY29nbml6ZWQgc2hhcGUgKGAndW5rbm93bidgLCB3YXJuZWQpIHByb2NlZWRzLlxuICogMi4gKipObyBwb3N0LWVkaXQgcmFuZ2UgcmVjb3ZlcnkgZnJvbSB0aGUgZW52ZWxvcGUuKiogUG9zdFRvb2xVc2UgcnVucyBhZnRlclxuICogICAgdGhlIHBhdGNoIHJld3JvdGUgdGhlIGZpbGUsIHNvIHRoZSBodW5rJ3MgcHJlLWVkaXQgYmxvY2sgbm8gbG9uZ2VyIHNpdHNcbiAqICAgIHdoZXJlIHRoZSBlZGl0IGhhcHBlbmVkIGFuZCBjb3VsZCBtaXMtYW5jaG9yIGEgZHVwbGljYXRlLiBUaGUgdG91Y2ggaXNcbiAqICAgIHNjb3BlZCBmaWxlLXdpZGUgKGB3cml0dGVuOiAnJ2AgXHUyMTkyIHdob2xlLWZpbGUpLCB3aGljaCBpcyBleGFjdGx5IHRoZVxuICogICAgYmVoYXZpb3Ige0BsaW5rIHJ1blRvdWNoSG9va30gdGFrZXMgZm9yIGFuIGVtcHR5IHdyaXRlLlxuICpcbiAqIFRoZSB0aW1lb3V0IGlzIG1pbGxpc2Vjb25kcyBpbiB0aGUgaGFuZGxlciBjb25maWcgKHRoZSBDTEkgZW1pdHMgYDEwYCBzZWNvbmRzKVxuICogXHUyMDE0IHNlZSB0aGUgdGltZW91dC11bml0cyBzcGlrZSBub3RlOyB0aGUgc291cmNlIHZhbHVlIG11c3Qgc3RheSBpbiBtcyBzbyB0aGVcbiAqIENvZGV4IGJ1aWxkJ3Mgc2Vjb25kcyBjb252ZXJzaW9uIGF0IGVtaXQgcmVtYWlucyBjb3JyZWN0LlxuICovXG5cbmltcG9ydCB7IHR5cGUgSG9va0NvbnRleHQsIHR5cGUgUG9zdFRvb2xVc2VJbnB1dCwgcG9zdFRvb2xVc2VIb29rLCBwb3N0VG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jb2RleC1ob29rcyc7XG5pbXBvcnQgeyBhYnNwYXRoQWdhaW5zdCB9IGZyb20gJy4uL2NvbW1vbi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQsIHJ1bkJhc2hUb3VjaGVzIH0gZnJvbSAnLi4vY29tbW9uL2Jhc2gtdG91Y2guanMnO1xuaW1wb3J0IHsgcGFyc2VDb21tYW5kRGV0YWlsZWQgfSBmcm9tICcuLi9jb21tb24vcGFyc2UtY29tbWFuZC5qcyc7XG5pbXBvcnQgeyBjcmVhdGVEaXNrTWVtb1N0b3JlLCB0eXBlIE1lbW9GYWN0b3J5LCByZXNvbHZlVG91Y2hTY29wZSB9IGZyb20gJy4uL2NvbW1vbi9zcGFuLXN1cmZhY2UuanMnO1xuaW1wb3J0IHsgY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzLCBydW5Ub3VjaEhvb2ssIHR5cGUgVG91Y2hFeGVjdXRvcnMgfSBmcm9tICcuLi9jb21tb24vdG91Y2gtY29yZS5qcyc7XG5pbXBvcnQgeyBwYXJzZUFwcGx5UGF0Y2ggfSBmcm9tICcuL2FwcGx5LXBhdGNoLmpzJztcblxuLyoqXG4gKiBUaGUgcHJlZml4IGFwcGx5X3BhdGNoJ3Mgc3Rkb3V0IGNhcnJpZXMgd2hlbiBcdTIwMTQgYW5kIG9ubHkgd2hlbiBcdTIwMTQgdGhlIHBhdGNoXG4gKiBhcHBsaWVkIChjb2RleC1ycy9hcHBseS1wYXRjaCBgcHJpbnRfc3VtbWFyeWApLiBDb2RleCBzdXJmYWNlcyB0aGF0IHN0ZG91dFxuICogdmVyYmF0aW0gYXMgdGhlIFBvc3RUb29sVXNlIGB0b29sX3Jlc3BvbnNlYCAoYSBiYXJlIHN0cmluZyB0b2RheSkuIEZpeGVkXG4gKiBhY3Jvc3MgQWRkL01vZGlmeS9EZWxldGU7IHRoZSBoZWFkZXIgaXMgZm9sbG93ZWQgYnkgYEEvTS9EIDxwYXRoPmAgbGluZXMuXG4gKi9cbmNvbnN0IEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYID0gJ1N1Y2Nlc3MuIFVwZGF0ZWQgdGhlIGZvbGxvd2luZyBmaWxlczonO1xuXG4vKipcbiAqIFRoZSBjb21tb24gZmllbGRzIGFuIG9iamVjdC13cmFwcGVkIHRvb2xfcmVzcG9uc2UgbWlnaHQgY2FycnkgdGhlIHRvb2wncyB0ZXh0XG4gKiBvdXRwdXQgdW5kZXIsIGlmIENvZGV4IGV2ZXIgc3RvcHMgc3VyZmFjaW5nIGl0IGFzIGEgYmFyZSBzdHJpbmcuIE9yZGVyZWQgYnlcbiAqIGxpa2VsaWhvb2Q7IHRoZSBmaXJzdCBmaWVsZCB3aG9zZSB2YWx1ZSBpcyBhIHN0cmluZyB3aW5zLlxuICovXG5jb25zdCBSRVNQT05TRV9URVhUX0ZJRUxEUyA9IFsnb3V0cHV0JywgJ3N0ZG91dCcsICdjb250ZW50JywgJ3RleHQnXSBhcyBjb25zdDtcblxuLyoqIE5hcnJvdyB0aGUgU0RLJ3MgYHVua25vd25gIHRvb2xfaW5wdXQgdG8gdGhlIGBhcHBseV9wYXRjaGAgYHsgY29tbWFuZCB9YCBzaGFwZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnY29tbWFuZCcgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgY29tbWFuZCA9ICh0b29sSW5wdXQgYXMgeyBjb21tYW5kOiB1bmtub3duIH0pLmNvbW1hbmQ7XG4gICAgaWYgKHR5cGVvZiBjb21tYW5kID09PSAnc3RyaW5nJykgcmV0dXJuIGNvbW1hbmQ7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogTmFycm93IHRoZSBjbGFzc2ljIGBleGVjX2NvbW1hbmRgIGVudmVsb3BlIChjbGlfdmVyc2lvbiBcdTIyNjQgMC4xMzAuMCk6XG4gKiBgdG9vbF9pbnB1dC5hcmd1bWVudHNgIGlzIGEgSlNPTiAqc3RyaW5nKiBvZiBzaGFwZVxuICogYHtcImNtZFwiOiBcIi4uLlwiLCBcIndvcmtkaXJcIjogXCIuLi5cIn1gIFx1MjAxNCBwYXJzZSBpdCBhbmQgcmV0dXJuIHRoZSBgY21kYC4gUmV0dXJuc1xuICogYG51bGxgIGZvciBhbnkgb3RoZXIgc2hhcGUgKG5vdCBKU09OLCBubyBgY21kYCBmaWVsZCwgb3Igbm90IHRoaXMgZW52ZWxvcGUpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93RXhlY0NvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2FyZ3VtZW50cycgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgYXJncyA9ICh0b29sSW5wdXQgYXMgeyBhcmd1bWVudHM6IHVua25vd24gfSkuYXJndW1lbnRzO1xuICAgIGlmICh0eXBlb2YgYXJncyA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoYXJncyk7XG4gICAgICAgIGlmIChwYXJzZWQgIT09IG51bGwgJiYgdHlwZW9mIHBhcnNlZCA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHBhcnNlZC5jbWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgcmV0dXJuIHBhcnNlZC5jbWQ7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogVGhlIHJlc3VsdCBvZiBuYXJyb3dpbmcgdGhlIGNvZGUtbW9kZSBgZXhlY2AgZW52ZWxvcGUuIGBtYXRjaGVkYCBzZXBhcmF0ZXNcbiAqIFwidGhlIGVudmVsb3BlIHdhcyBhIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCBjYWxsIHdob3NlIGFyZ3VtZW50IGNvdWxkIG5vdFxuICogYmUgcmVjb3ZlcmVkXCIgKGEgdmFyaWFibGUvdGVtcGxhdGUtYnVpbHQgY29tbWFuZCBcdTIwMTQgc3RhdGljYWxseSB1bnJlc29sdmFibGUpXG4gKiBmcm9tIFwidGhlIGVudmVsb3BlIGlzIG5vdCBjb2RlLW1vZGUgZXhlYyBhdCBhbGxcIiwgc28gdGhlIGhhbmRsZXIgY2FuIHdhcm4gb25cbiAqIHRoZSBmb3JtZXIgaW5zdGVhZCBvZiBzaWxlbnRseSBjb25mbGF0aW5nIGl0IHdpdGggdGhlIGxhdHRlci5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb2RlTW9kZUV4ZWNOYXJyb3cge1xuICAvKiogV2hldGhlciBgdG9vbF9pbnB1dC5pbnB1dGAgY29udGFpbmVkIGEgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIGNhbGwuICovXG4gIG1hdGNoZWQ6IGJvb2xlYW47XG4gIC8qKiBUaGUgcmVjb3ZlcmVkIGBjbWRgIHN0cmluZywgb3IgYG51bGxgIHdoZW4gbWF0Y2hlZCBidXQgdW5wYXJzYWJsZSAvIGFic2VudC4gKi9cbiAgY21kOiBzdHJpbmcgfCBudWxsO1xufVxuXG4vKipcbiAqIFF1b3RlIGJhcmUgaWRlbnRpZmllciBrZXlzIGluIGEgSlMgb2JqZWN0IGxpdGVyYWwgc28gYEpTT04ucGFyc2VgIGNhbiByZWFkXG4gKiBpdC4gUmVhbCBjb2RlLW1vZGUgY2FsbCBzaXRlcyBlbWl0IEpTLXN0eWxlIHVucXVvdGVkIGtleXNcbiAqIChge2NtZDpcInNlZCAtbiAnMSwyNDBwJyAvcGF0aFwiLC4uLn1gKSwgd2hpY2ggaXMgdmFsaWQgSlMgYnV0IGludmFsaWQgSlNPTi5cbiAqIFN0cmluZyB2YWx1ZXMgKHNpbmdsZS0gb3IgZG91YmxlLXF1b3RlZCkgYXJlIGNvcGllZCB2ZXJiYXRpbSBcdTIwMTQgaW5jbHVkaW5nIGFueVxuICogYCwga2V5OmAtc2hhcGVkIHRleHQgaW5zaWRlIHRoZW0gXHUyMDE0IGFuZCBhbHJlYWR5LXF1b3RlZCBrZXlzIHBhc3MgdGhyb3VnaFxuICogdW50b3VjaGVkLlxuICovXG5mdW5jdGlvbiBxdW90ZU9iamVjdEtleXMobGl0ZXJhbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IG91dCA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBsaXRlcmFsLmxlbmd0aDtcbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IGxpdGVyYWxbaV07XG4gICAgaWYgKGMgPT09ICdcIicgfHwgYyA9PT0gXCInXCIpIHtcbiAgICAgIGNvbnN0IHF1b3RlID0gYztcbiAgICAgIGNvbnN0IHN0YXJ0ID0gaTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIHdoaWxlIChpIDwgbikge1xuICAgICAgICBpZiAobGl0ZXJhbFtpXSA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikgaSArPSAyO1xuICAgICAgICBlbHNlIGlmIChsaXRlcmFsW2ldID09PSBxdW90ZSkge1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfSBlbHNlIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIG91dCArPSBsaXRlcmFsLnNsaWNlKHN0YXJ0LCBpKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBrZXkgPSBsaXRlcmFsLnNsaWNlKGkpLm1hdGNoKC9eKFxce3wsKVxccyooW0EtWmEtel8kXVtBLVphLXowLTlfJF0qKVxccyo6Lyk7XG4gICAgaWYgKGtleSkge1xuICAgICAgb3V0ICs9IGAke2tleVsxXX1cIiR7a2V5WzJdfVwiOmA7XG4gICAgICBpICs9IGtleVswXS5sZW5ndGg7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgb3V0ICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogTmFycm93IHRoZSBjb2RlLW1vZGUgYGV4ZWNgIGVudmVsb3BlIChjbGlfdmVyc2lvbiBcdTIyNjUgMC4xNDQuMCk6XG4gKiBgdG9vbF9pbnB1dC5pbnB1dGAgaXMgSlMgc291cmNlIHRoYXQgY2FsbHMgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIFx1MjAxNFxuICogcmVjb3ZlciB0aGUgbGl0ZXJhbCBvYmplY3QgYXJndW1lbnQgdmlhIGJhbGFuY2VkLWJyYWNlIG1hdGNoaW5nLCBxdW90ZSBpdHNcbiAqIHVucXVvdGVkIEpTIGtleXMsIGFuZCBwYXJzZSBpdC4gQSBjb21tYW5kIGJ1aWx0IGZyb20gdmFyaWFibGVzIG9yIHRlbXBsYXRlXG4gKiBsaXRlcmFscyBpcyBzdGF0aWNhbGx5IHVucmVzb2x2YWJsZTogdGhlIGNhbGwgc3RpbGwgKm1hdGNoZWQqIGJ1dCB5aWVsZHNcbiAqIGBjbWQ6IG51bGxgLCByZXBvcnRlZCBkaXN0aW5jdGx5IGZyb20gYSBub24tY29kZS1tb2RlIGVudmVsb3BlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93Q29kZU1vZGVFeGVjKHRvb2xJbnB1dDogdW5rbm93bik6IENvZGVNb2RlRXhlY05hcnJvdyB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2lucHV0JyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBpbnB1dCA9ICh0b29sSW5wdXQgYXMgeyBpbnB1dDogdW5rbm93biB9KS5pbnB1dDtcbiAgICBpZiAodHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJykge1xuICAgICAgLy8gTWF0Y2ggdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KSBcdTIwMTQgZXh0cmFjdCB0aGUgbGl0ZXJhbCBvYmplY3QgYXJndW1lbnRcbiAgICAgIGNvbnN0IG1hdGNoID0gaW5wdXQubWF0Y2goL3Rvb2xzXFwuZXhlY19jb21tYW5kXFwoXFxzKihcXHsoPzpbXnt9XXxcXHsoPzpbXnt9XXxcXHtbXnt9XSpcXH0pKlxcfSkqXFx9KVxccypcXCkvKTtcbiAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocXVvdGVPYmplY3RLZXlzKG1hdGNoWzFdKSk7XG4gICAgICAgICAgaWYgKHBhcnNlZCAhPT0gbnVsbCAmJiB0eXBlb2YgcGFyc2VkID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgcGFyc2VkLmNtZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiB7IG1hdGNoZWQ6IHRydWUsIGNtZDogcGFyc2VkLmNtZCB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IG51bGwgfTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gbWF0Y2hlZCwgYnV0IHRoZSBsaXRlcmFsIGRpZCBub3QgcGFyc2UgXHUyMDE0IHRoZSBjYWxsIGlzIHN0aWxsIGFcbiAgICAgICAgICAvLyBjb2RlLW1vZGUgZXhlYyB3aG9zZSBjb21tYW5kIGNhbm5vdCBiZSByZWNvdmVyZWQgc3RhdGljYWxseS5cbiAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IG51bGwgfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4geyBtYXRjaGVkOiBmYWxzZSwgY21kOiBudWxsIH07XG59XG5cbi8qKlxuICogVG9sZXJhbnRseSBwdWxsIHRoZSB0b29sJ3MgdGV4dHVhbCBvdXRwdXQgb3V0IG9mIGEgYHRvb2xfcmVzcG9uc2VgIG9mXG4gKiB1bmNlcnRhaW4gc2hhcGUgKFNESy10eXBlZCBgdW5rbm93bmApOiBhIGJhcmUgc3RyaW5nICh0b2RheSdzIENvZGV4KSBpc1xuICogcmV0dXJuZWQgYXMtaXM7IGFuIG9iamVjdCBpcyBwcm9iZWQgZm9yIHRoZSBmaXJzdCB7QGxpbmsgUkVTUE9OU0VfVEVYVF9GSUVMRFN9XG4gKiBlbnRyeSB0aGF0IGhvbGRzIGEgc3RyaW5nLiBSZXR1cm5zIGBudWxsYCB3aGVuIG5vIHRleHQgY2FuIGJlIHJlY292ZXJlZFxuICogKHVua25vd24gb2JqZWN0IHNoYXBlLCBgbnVsbGAsIG9yIGEgbm9uLXN0cmluZy9ub24tb2JqZWN0KSwgd2hpY2ggdGhlIGNhbGxlclxuICogdHJlYXRzIGFzIGFuICp1bnJlY29nbml6ZWQqIFx1MjAxNCBub3QgKmZhaWxlZCogXHUyMDE0IHJlc3BvbnNlLlxuICovXG5mdW5jdGlvbiBleHRyYWN0UmVzcG9uc2VUZXh0KHRvb2xSZXNwb25zZTogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ3N0cmluZycpIHJldHVybiB0b29sUmVzcG9uc2U7XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICBjb25zdCByZWNvcmQgPSB0b29sUmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgZm9yIChjb25zdCBmaWVsZCBvZiBSRVNQT05TRV9URVhUX0ZJRUxEUykge1xuICAgICAgY29uc3QgdmFsdWUgPSByZWNvcmRbZmllbGRdO1xuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogQ2xhc3NpZnkgYW4gYGFwcGx5X3BhdGNoYCBgdG9vbF9yZXNwb25zZWAgZm9yIHRoZSB0b3VjaCBnYXRlOlxuICpcbiAqIC0gYCdzdWNjZXNzJ2AgXHUyMDE0IHRleHQgd2FzIHJlY292ZXJlZCBhbmQgY2FycmllcyB7QGxpbmsgQVBQTFlfUEFUQ0hfU1VDQ0VTU19QUkVGSVh9LlxuICogLSBgJ2ZhaWx1cmUnYCBcdTIwMTQgdGV4dCB3YXMgcmVjb3ZlcmVkIGJ1dCBsYWNrcyB0aGUgaGVhZGVyOiBhIGdlbnVpbmUgcmVqZWN0aW9uXG4gKiAgIG9yIGVycm9yLiBUaGUgT05MWSBjbGFzc2lmaWNhdGlvbiB0aGF0IHN1cHByZXNzZXMgdGhlIHRvdWNoLlxuICogLSBgJ3Vua25vd24nYCBcdTIwMTQgbm8gdGV4dCBjb3VsZCBiZSByZWNvdmVyZWQgKHVucmVjb2duaXplZCBzaGFwZSkuIFdlIHByb2NlZWRcbiAqICAgZGVmZW5zaXZlbHkgaGVyZSByYXRoZXIgdGhhbiByaXNrIG1pc3NpbmcgYSByZWFsIGVkaXQncyBoZWFsL3N1cmZhY2U7IENvZGV4XG4gKiAgIGNvcmUgZmlyZXMgUG9zdFRvb2xVc2Ugb25seSBvbiBzdWNjZXNzLCBzbyB0aGlzIGNhbm5vdCBoZWFsL3N1cmZhY2UgYSBwYXRjaFxuICogICB0aGF0IG5ldmVyIGFwcGxpZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZSh0b29sUmVzcG9uc2U6IHVua25vd24pOiAnc3VjY2VzcycgfCAnZmFpbHVyZScgfCAndW5rbm93bicge1xuICBjb25zdCB0ZXh0ID0gZXh0cmFjdFJlc3BvbnNlVGV4dCh0b29sUmVzcG9uc2UpO1xuICBpZiAodGV4dCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgcmV0dXJuIHRleHQuc3RhcnRzV2l0aChBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWCkgPyAnc3VjY2VzcycgOiAnZmFpbHVyZSc7XG59XG5cbi8qKiBBIHJlYWRlciB0aGF0IGFsd2F5cyBkZWNsaW5lcywgZm9yY2luZyB0aGUgcGFyc2VyIHRvIHdob2xlLWZpbGUgYW5jaG9ycy4gKi9cbmNvbnN0IG5vUmFuZ2VSZWNvdmVyeSA9ICgpOiBudWxsID0+IG51bGw7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVIYW5kbGVyKFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzID0gY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzKCksXG4gIG1lbW9GYWN0b3J5OiBNZW1vRmFjdG9yeSA9IGNyZWF0ZURpc2tNZW1vU3RvcmVcbikge1xuICByZXR1cm4gYXN5bmMgKGlucHV0OiBQb3N0VG9vbFVzZUlucHV0LCBjdHg6IEhvb2tDb250ZXh0KSA9PiB7XG4gICAgY29uc3QgdG9vbF9uYW1lID0gaW5wdXQudG9vbF9uYW1lO1xuICAgIGNvbnN0IGN3ZCA9IGlucHV0LmN3ZCA/PyAnJztcbiAgICBjb25zdCBzZXNzaW9uSWQgPSBpbnB1dC5zZXNzaW9uX2lkO1xuICAgIGNvbnN0IG1lbW8gPSBtZW1vRmFjdG9yeShjdHgubG9nZ2VyKTtcblxuICAgIC8vIFNoZWxsIHRvdWNoOiBleHRyYWN0IHRoZSBjb21tYW5kIGZyb20gd2hpY2hldmVyIGVudmVsb3BlIHNoYXBlIHRoZSBoYXJuZXNzXG4gICAgLy8gZGVsaXZlcnMsIHBhcnNlLCBhbmQgcnVuIGVhY2ggcmVzb2x2ZWQgc3BhbiB0aHJvdWdoIHRoZSBzaGFyZWQgdG91Y2ggY29yZS5cbiAgICAvL1xuICAgIC8vIC0gYEJhc2hgOiB0aGUgaGFybmVzcy11bndyYXBwZWQgc2hhcGUgQ29kZXggXHUyMjY1MC4xNDQgYWN0dWFsbHkgc2VuZHMgXHUyMDE0XG4gICAgLy8gICBgdG9vbF9pbnB1dC5jb21tYW5kYCBpcyB0aGUgcmF3IHNoZWxsIGNvbW1hbmQgc3RyaW5nIChzYW1lIHNoYXBlIHRoZVxuICAgIC8vICAgQ2xhdWRlIGFkYXB0ZXIgaGFuZGxlcykuXG4gICAgLy8gLSBgZXhlY19jb21tYW5kYDogY2xhc3NpYyBmdW5jdGlvbl9jYWxsIGVudmVsb3BlIChjbGkgXHUyMjY0MC4xMzApIFx1MjAxNFxuICAgIC8vICAgYHRvb2xfaW5wdXQuYXJndW1lbnRzYCBpcyBhIEpTT04gc3RyaW5nIHdpdGggYSBgY21kYCBmaWVsZC5cbiAgICAvLyAtIGBleGVjYDogZGlyZWN0IGNvZGUtbW9kZSBlbnZlbG9wZSAobWF5IHNoaXAgaW4gYSBmdXR1cmUgQ0xJKSBcdTIwMTRcbiAgICAvLyAgIGB0b29sX2lucHV0LmlucHV0YCBpcyBKUyBzb3VyY2Ugd3JhcHBpbmcgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgLlxuICAgIC8vXG4gICAgLy8gQSBjb21tYW5kIHdpdGggbm8gcmVjb2duaXplZCBpZGlvbSB5aWVsZHMgbm8gYmxvY2tzIGFuZCByZXR1cm5zIHVuZGVmaW5lZCBcdTIwMTRcbiAgICAvLyBmYWlsLW9wZW4sIHNhbWUgYXMgdGhlIGFwcGx5X3BhdGNoIHBhdGggYmVsb3cuXG4gICAgaWYgKHRvb2xfbmFtZSA9PT0gJ0Jhc2gnIHx8IHRvb2xfbmFtZSA9PT0gJ2V4ZWNfY29tbWFuZCcgfHwgdG9vbF9uYW1lID09PSAnZXhlYycpIHtcbiAgICAgIGxldCBjb21tYW5kOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICAgIGlmICh0b29sX25hbWUgPT09ICdCYXNoJykge1xuICAgICAgICAvLyBUaGUgaGFybmVzcyBhbHJlYWR5IHVud3JhcHBlZCB0aGUgY29kZS1tb2RlIGVudmVsb3BlIFx1MjAxNCB0aGUgY29tbWFuZCBpc1xuICAgICAgICAvLyBpbiBgdG9vbF9pbnB1dC5jb21tYW5kYCwgZXhhY3RseSBhcyB0aGUgQ2xhdWRlIGFkYXB0ZXIgcmVjZWl2ZXMgaXQuXG4gICAgICAgIGNvbnN0IHJhdyA9IChpbnB1dC50b29sX2lucHV0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCk/LmNvbW1hbmQ7XG4gICAgICAgIGNvbW1hbmQgPSB0eXBlb2YgcmF3ID09PSAnc3RyaW5nJyA/IHJhdyA6IG51bGw7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb21tYW5kID0gbmFycm93RXhlY0NvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgICB9XG4gICAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCAmJiB0b29sX25hbWUgPT09ICdleGVjJykge1xuICAgICAgICAvLyBDb2RlLW1vZGUgYGV4ZWNgIHdyYXBzIHRoZSBzYW1lIGNhbGwgaW4gSlMgc291cmNlLiBBIG1hdGNoZWQgY2FsbFxuICAgICAgICAvLyB3aG9zZSBhcmd1bWVudCBjb3VsZCBub3QgYmUgcGFyc2VkICh2YXJpYWJsZS90ZW1wbGF0ZS1idWlsdCBjb21tYW5kKVxuICAgICAgICAvLyBpcyBhIGRpc3RpbmN0IG91dGNvbWUgZnJvbSBcIm5vdCBhIGNvZGUtbW9kZSBlbnZlbG9wZSBhdCBhbGxcIjogd2FybiBzb1xuICAgICAgICAvLyB0aGUgYmxpbmQgc3BvdCBpcyB2aXNpYmxlIGluc3RlYWQgb2Ygc2lsZW50bHkgY29uZmxhdGVkIHdpdGggbm8gbWF0Y2guXG4gICAgICAgIGNvbnN0IGNvZGVNb2RlID0gbmFycm93Q29kZU1vZGVFeGVjKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgICAgICBpZiAoY29kZU1vZGUubWF0Y2hlZCAmJiBjb2RlTW9kZS5jbWQgPT09IG51bGwpIHtcbiAgICAgICAgICBjdHgubG9nZ2VyLndhcm4oXG4gICAgICAgICAgICAnQ29kZXggY29kZS1tb2RlIGV4ZWMgZW52ZWxvcGUgbWF0Y2hlZCBidXQgaXRzIGV4ZWNfY29tbWFuZCBhcmd1bWVudCBjb3VsZCBub3QgYmUgcGFyc2VkOyBubyBzaGVsbCB0b3VjaCcsXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHRvb2xJbnB1dFR5cGU6IHR5cGVvZiBpbnB1dC50b29sX2lucHV0LFxuICAgICAgICAgICAgICB0b29sSW5wdXRLZXlzOlxuICAgICAgICAgICAgICAgIGlucHV0LnRvb2xfaW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIGlucHV0LnRvb2xfaW5wdXQgPT09ICdvYmplY3QnXG4gICAgICAgICAgICAgICAgICA/IE9iamVjdC5rZXlzKGlucHV0LnRvb2xfaW5wdXQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgICAgICAgfVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgY29tbWFuZCA9IGNvZGVNb2RlLmNtZDtcbiAgICAgIH1cbiAgICAgIGlmICghY29tbWFuZCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgLy8gQW4gaW50ZXJydXB0ZWQgY29tbWFuZCBwcm9kdWNlcyBubyB0b3VjaGVzLCB3aGF0ZXZlciBpdHMgc3BhbnM7IHRoZVxuICAgICAgLy8gZHJpdmVyIHJlLWNoZWNrcyBkZWZlbnNpdmVseS5cbiAgICAgIGlmIChiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZChpbnB1dC50b29sX3Jlc3BvbnNlKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kLCBjd2QpO1xuICAgICAgY29uc3QgYmxvY2tzID0gYXdhaXQgcnVuQmFzaFRvdWNoZXMobWF0Y2hlcywgc2Vzc2lvbklkLCBjd2QsIGlucHV0LnRvb2xfcmVzcG9uc2UsIGV4ZWN1dG9ycywgbWVtbywgKG1lc3NhZ2UpID0+XG4gICAgICAgIGN0eC5sb2dnZXIud2FybihtZXNzYWdlKVxuICAgICAgKTtcbiAgICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgICByZXR1cm4gcG9zdFRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQsIHN5c3RlbU1lc3NhZ2U6IGNvbWJpbmVkIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmQgPSBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIC8vIFN1cHByZXNzIG9ubHkgYSAqY29uZmlybWVkKiBub24tc3VjY2Vzcy4gQW4gdW5yZWNvZ25pemVkIHJlc3BvbnNlIHNoYXBlXG4gICAgLy8gcHJvY2VlZHMgKHdpdGggYSB3YXJuaW5nKSByYXRoZXIgdGhhbiByaXNrIHNraXBwaW5nIGEgcmVhbCBlZGl0J3MgdG91Y2guXG4gICAgY29uc3QgY2xhc3NpZmljYXRpb24gPSBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZShpbnB1dC50b29sX3Jlc3BvbnNlKTtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICdmYWlsdXJlJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICd1bmtub3duJykge1xuICAgICAgY3R4LmxvZ2dlci53YXJuKCdDb2RleCBhcHBseV9wYXRjaCB0b29sX3Jlc3BvbnNlIHNoYXBlIHVucmVjb2duaXplZDsgcnVubmluZyB0b3VjaCBkZWZlbnNpdmVseScsIHtcbiAgICAgICAgdG9vbFJlc3BvbnNlVHlwZTogdHlwZW9mIGlucHV0LnRvb2xfcmVzcG9uc2UsXG4gICAgICAgIHRvb2xSZXNwb25zZUtleXM6XG4gICAgICAgICAgaW5wdXQudG9vbF9yZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgaW5wdXQudG9vbF9yZXNwb25zZSA9PT0gJ29iamVjdCdcbiAgICAgICAgICAgID8gT2JqZWN0LmtleXMoaW5wdXQudG9vbF9yZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBPbmUgZW52ZWxvcGUgbWF5IHRvdWNoIHNldmVyYWwgZmlsZXM7IGZvcmNlIHdob2xlLWZpbGUgYW5jaG9ycyAoQ29kZXggbmV2ZXJcbiAgICAvLyByZWNvdmVycyBhIHBvc3QtZWRpdCByYW5nZSkgYW5kIHJ1biB0aGUgc2hhcmVkIHRvdWNoIGNvcmUgcGVyIHRvdWNoZWQgZmlsZS5cbiAgICAvLyBUaGUgc2hhcmVkIG1lbW8gZGVkdXBlcyBzcGFuIHJlbmRlcnMgYWNyb3NzIGFuY2hvcnMgYW5kIHRoZSBzZXNzaW9uLlxuICAgIGNvbnN0IGFuY2hvcnMgPSBwYXJzZUFwcGx5UGF0Y2goY29tbWFuZCwgbm9SYW5nZVJlY292ZXJ5KTtcbiAgICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgICAgY29uc3QgYWJzUGF0aCA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgYW5jaG9yLnBhdGgpO1xuICAgICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICAvLyBBIGAqKiogRGVsZXRlIEZpbGU6YCBhbmNob3IgY2FycmllcyB0aGUgYWJzZW50IG1hcmtlciAocGxhbiBcdTAwQTczKTogaXRzXG4gICAgICAvLyB0b3VjaCB0YXJnZXRzIGFic2VuY2UgXHUyMDE0IHRoZSBkZWxldGUgZ2F0ZSB2ZXJpZmllcyB0aGUgcGF0aCBpcyBnb25lIEFORFxuICAgICAgLy8gd2FzIHJlYWwgKGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCkgYmVmb3JlIGZpcmluZy4gRXZlcnl0aGluZyBlbHNlXG4gICAgICAvLyB0YXJnZXRzIGV4aXN0ZW5jZS5cbiAgICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1blRvdWNoSG9vayhcbiAgICAgICAge1xuICAgICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICAgIGN3ZCxcbiAgICAgICAgICBmaWxlUGF0aDogYWJzUGF0aCxcbiAgICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgICB0YXJnZXRTdGF0ZTogYW5jaG9yLmFic2VudCA/ICdhYnNlbnQnIDogJ2V4aXN0cycsXG4gICAgICAgICAgLi4uKGFuY2hvci5hYnNlbnQgPyB7IHBvc3RTdGF0ZTogeyByZWFsRGVsZXRlOiB0cnVlIH0gfSA6IHt9KVxuICAgICAgICB9LFxuICAgICAgICBleGVjdXRvcnMsXG4gICAgICAgIG1lbW9cbiAgICAgICk7XG4gICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgIH1cblxuICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNvbWJpbmVkID0gYmxvY2tzLmpvaW4oJycpO1xuICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiBjb21iaW5lZCwgc3lzdGVtTWVzc2FnZTogY29tYmluZWQgfSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHBvc3RUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdhcHBseV9wYXRjaHxleGVjX2NvbW1hbmR8ZXhlY3xCYXNoJywgdGltZW91dDogMTBfMDAwIH0sIGNyZWF0ZUhhbmRsZXIoKSk7XG4iLCAiaW1wb3J0IGhvb2sgZnJvbSBcIi4vcG9zdC10b29sLXVzZS50c1wiO1xuaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gXCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qc1wiO1xu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S1osWUFBTSxTQUFTLE1BQU07QUFBQSxRQUNuQjtBQUFBLFVBQ0UsTUFBTTtBQUFBLFVBQ047QUFBQSxVQUNBO0FBQUEsVUFDQSxVQUFVO0FBQUEsVUFDVixTQUFTO0FBQUEsVUFDVCxhQUFhLE9BQU8sU0FBUyxXQUFXO0FBQUEsVUFDeEMsR0FBSSxPQUFPLFNBQVMsRUFBRSxXQUFXLEVBQUUsWUFBWSxLQUFLLEVBQUUsSUFBSSxDQUFDO0FBQUEsUUFDN0Q7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFDQSxVQUFJLE9BQU8sa0JBQW1CLFFBQU8sS0FBSyxPQUFPLGlCQUFpQjtBQUFBLElBQ3BFO0FBRUEsUUFBSSxPQUFPLFdBQVcsRUFBRyxRQUFPO0FBQ2hDLFVBQU0sV0FBVyxPQUFPLEtBQUssRUFBRTtBQUMvQixXQUFPLGtCQUFrQixFQUFFLG1CQUFtQixVQUFVLGVBQWUsU0FBUyxDQUFDO0FBQUEsRUFDbkY7QUFDRjtBQUVBLElBQU8sd0JBQVEsZ0JBQWdCLEVBQUUsU0FBUyxzQ0FBc0MsU0FBUyxJQUFPLEdBQUcsY0FBYyxDQUFDOzs7QUM5VWxILFFBQVEscUJBQUk7IiwKICAibmFtZXMiOiBbInJlc29sdmUiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImxvZ2dlciIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAiYmFzZW5hbWUiLCAiam9pbiIsICJleGVjRmlsZVN5bmMiLCAiam9pbiIsICJiYXNlbmFtZSIsICJqb2luIiwgInJlYWRGaWxlU3luYyIsICJzdGF0U3luYyIsICJiYXNlbmFtZSIsICJleGVjRmlsZVN5bmMiLCAicmVhZEZpbGVTeW5jIiwgInN0YXRTeW5jIiwgImpvaW4iLCAic3RhdFN5bmMiLCAiYmFzZW5hbWUiLCAicmVhZEZpbGVTeW5jIiwgInRva2VucyIsICJmcyIsICJ0b1Bvc2l4IiwgImN0eCIsICJyZWNvdmVyUmFuZ2UiLCAiY29tbWFuZCIsICJibG9ja3MiLCAiY29tYmluZWQiXQp9Cg==
