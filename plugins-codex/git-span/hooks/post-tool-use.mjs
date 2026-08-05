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
          const worktreeStatus = entry.charAt(1);
          if (worktreeStatus === " " || worktreeStatus === "?") continue;
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb21tb24vYmFzaC10b3VjaC50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3VuaWZpZWQtZGlmZi50cyIsICJzcmMvY29kZXgvYXBwbHktcGF0Y2gudHMiLCAic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UudHMiLCAic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhdGggaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNBYnNvbHV0ZVBvc2l4KHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCcvJykgfHwgL15bQS1aYS16XTpcXC8vLnRlc3QocCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhYnNwYXRoQWdhaW5zdChiYXNlOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdCA9IHRvUG9zaXgodGFyZ2V0KTtcbiAgaWYgKGlzQWJzb2x1dGVQb3NpeCh0KSkgcmV0dXJuIHQ7XG4gIGNvbnN0IGIgPSB0b1Bvc2l4KGJhc2UpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gYCR7Yn0vJHt0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVwb1Jvb3QoZGlyOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghZGlyKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCBkaXIsICdyZXYtcGFyc2UnLCAnLS1zaG93LXRvcGxldmVsJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBvdXQudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0b1Bvc2l4KHRyaW1tZWQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgcGF0aCBpcyBleGNsdWRlZCBieSBnaXQncyBpZ25vcmUgcnVsZXNcbiAqICguZ2l0aWdub3JlLCAuZ2l0L2luZm8vZXhjbHVkZSwgY29yZS5leGNsdWRlc0ZpbGUpLiBVc2VkIHRvIGtlZXAgaWdub3JlZFxuICogZmlsZXMgXHUyMDE0IGJ1aWxkIG91dHB1dCwgY2FjaGVzLCBsb2dzIFx1MjAxNCBvdXQgb2YgdG91Y2ggdHJhY2tpbmcgZW50aXJlbHksIHNvXG4gKiB0aGUgdG91Y2ggaG9vayBuZXZlciByZXBvcnRzIHJlYWRzLCB3cml0ZXMsIG9yIHVuY292ZXJlZCB3cml0ZXMgb24gdGhlbS5cbiAqXG4gKiBgZ2l0IGNoZWNrLWlnbm9yZSAtcSA8cGF0aD5gIGV4aXRzIDAgd2hlbiB0aGUgcGF0aCBpcyBpZ25vcmVkLCAxIHdoZW4gaXQgaXNcbiAqIG5vdCwgYW5kIDEyOCBvbiBlcnJvci4gZXhlY0ZpbGVTeW5jIHRocm93cyBvbiBhbnkgbm9uLXplcm8gZXhpdCwgc28gYSBjbGVhblxuICogcmV0dXJuIG1lYW5zIFwiaWdub3JlZFwiLiBBIHN0YXR1cy0xIHRocm93IGlzIHRoZSBleHBlY3RlZCBcIm5vdCBpZ25vcmVkXCJcbiAqIHNpZ25hbDsgYW55IG90aGVyIGZhaWx1cmUgaXMgYW4gdW5yZWxpYWJsZSBhbnN3ZXIsIHNvIHdlIHJlcG9ydCBgZmFsc2VgXG4gKiAoZG8gbm90IGRyb3AgdGhlIHRvdWNoKSByYXRoZXIgdGhhbiBzaWxlbnRseSBoaWRpbmcgYSB0cmFja2VkIGZpbGUuXG4gKi9cbi8qKlxuICogVGhlIGRlZmF1bHQgc3BhbiByb290IGRpcmVjdG9yeSwgcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCwgdXNlZCB3aGVuIG5vXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBnaXQgY29uZmlnIG92ZXJyaWRlcyB0aGUgbG9jYXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOX1JPT1QgPSAnLnNwYW4nO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHNwYW4gcm9vdCBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gcmVwbywgbWlycm9yaW5nIHRoZSBSdXN0IENMSVxuICogcHJlY2VkZW5jZSAobWludXMgdGhlIC0tc3Bhbi1kaXIgQ0xJIGZsYWcsIHdoaWNoIGlzIGludmlzaWJsZSB0byBmaWxlLXdyaXRlXG4gKiBob29rcyk6XG4gKiAgIDEuIEdJVF9TUEFOX0RJUiBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICogICAyLiBgZ2l0IGNvbmZpZyBnaXQtc3Bhbi5kaXJgIGluIHRoZSByZXBvXG4gKiAgIDMuIERlZmF1bHQ6IFwiLnNwYW5cIlxuICpcbiAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIFBPU0lYLXN0eWxlIHBhdGggd2l0aCBubyB0cmFpbGluZyBzbGFzaC5cbiAqIEZhaWwtc2FmZTogYW55IHJlc29sdXRpb24gZXJyb3IgZmFsbHMgYmFjayB0byBcIi5zcGFuXCIgc28gdGhlIGhvb2sgbmV2ZXJcbiAqIGNyYXNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudkRpciA9IHByb2Nlc3MuZW52WydHSVRfU1BBTl9ESVInXTtcbiAgaWYgKGVudkRpciAmJiBlbnZEaXIudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gdG9Qb3NpeChlbnZEaXIudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY29uZmlnJywgJ2dpdC1zcGFuLmRpciddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSByZXR1cm4gdHJpbW1lZDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7IC8vIGNvbmZpZyBrZXkgYWJzZW50IG9yIGdpdCBlcnJvciBcdTIwMTQgZmFsbCB0aHJvdWdoIHRvIGRlZmF1bHRcbiAgfVxuICByZXR1cm4gU1BBTl9ST09UO1xufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRoIGZhbGxzIGluc2lkZSB0aGUgZ2l2ZW4gc3BhbiByb290XG4gKiBkaXJlY3RvcnkuIEEgcGF0aCBpcyBpbnNpZGUgd2hlbiBpdCBlcXVhbHMgdGhlIHNwYW4gcm9vdCBleGFjdGx5IG9yIGlzXG4gKiBuZXN0ZWQgYmVuZWF0aCBpdCAoaS5lLiBzdGFydHMgd2l0aCBcIjxzcGFuUm9vdD4vXCIpLiBUaGUgXCIvXCIgYm91bmRhcnkgcHJldmVudHNcbiAqIGZhbHNlIHBvc2l0aXZlcyBmb3Igc2libGluZ3MgbGlrZSBcIi5zcGFucy94XCIgb3IgXCIuc3Bhbi1ub3Rlcy94XCIuXG4gKlxuICogUGFzcyB0aGUgcmVzdWx0IG9mIGByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpYCBhcyBgc3BhblJvb3RgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aDogc3RyaW5nLCBzcGFuUm9vdDogc3RyaW5nID0gU1BBTl9ST09UKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvb3QgPSBzcGFuUm9vdC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIHJlcG9SZWxQYXRoID09PSByb290IHx8IHJlcG9SZWxQYXRoLnN0YXJ0c1dpdGgoYCR7cm9vdH0vYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0dpdElnbm9yZWQocmVwb1Jvb3Q6IHN0cmluZywgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY2hlY2staWdub3JlJywgJy1xJywgJy0tJywgcmVwb1JlbFBhdGhdLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAnaWdub3JlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgcm9vdCA9IHRvUG9zaXgocmVwb1Jvb3QpO1xuICBjb25zdCBhYnMgPSB0b1Bvc2l4KGFic1BhdGgpO1xuICBjb25zdCBwcmVmaXggPSByb290LmVuZHNXaXRoKCcvJykgPyByb290IDogYCR7cm9vdH0vYDtcbiAgcmV0dXJuIGFicy5zdGFydHNXaXRoKHByZWZpeCkgPyBhYnMuc2xpY2UocHJlZml4Lmxlbmd0aCkgOiBhYnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5vbmljYWxpemVQYXRoKGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShhYnNQYXRoKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCB5ZXQgKGUuZy4gV3JpdGUgdG8gYSBuZXcgZmlsZSk6IGNhbm9uaWNhbGl6ZSB0aGVcbiAgICAvLyBkaXJlY3RvcnkgYW5kIHJlam9pbiB0aGUgYmFzZW5hbWUgc28gc3ltbGlua3MgaW4gdGhlIHBhcmVudCBhcmUgcmVzb2x2ZWQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKSk7XG4gICAgICByZXR1cm4gYCR7ZGlyfS8ke25vZGVQYXRoLmJhc2VuYW1lKGFic1BhdGgpfWA7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQYXJlbnQgZG9lc24ndCBleGlzdCBlaXRoZXI7IGZhbGwgYmFjayB0byB0aGUgdW4tY2Fub25pY2FsaXplZCBwYXRoLlxuICAgICAgcmV0dXJuIGFic1BhdGg7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVQYXRoKHRvb2xJbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGN3ZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGZwID0gdG9vbElucHV0LmZpbGVfcGF0aDtcbiAgaWYgKHR5cGVvZiBmcCAhPT0gJ3N0cmluZycgfHwgZnAubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYWJzID0gYWJzcGF0aEFnYWluc3QoY3dkLCBmcCk7XG4gIHJldHVybiBjYW5vbmljYWxpemVQYXRoKGFicyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZSByYW5nZSB0eXBlcyBhbmQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZXNJbnRlcnNlY3QoYTogTGluZVJhbmdlLCBiOiBMaW5lUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuc3RhcnQgPD0gYi5lbmQgJiYgYS5lbmQgPj0gYi5zdGFydDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3JjZWxhaW4gcm93IHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcmNlbGFpblJvdyB7XG4gIG5hbWU6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtuYW1lLCBwYXRoLCByYW5nZV0gPSBwYXJ0cztcbiAgICBjb25zdCBkYXNoSWR4ID0gcmFuZ2UuaW5kZXhPZignLScpO1xuICAgIGlmIChkYXNoSWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBwYXJzZUludChyYW5nZS5zbGljZSgwLCBkYXNoSWR4KSwgMTApO1xuICAgIGNvbnN0IGVuZCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKGRhc2hJZHggKyAxKSwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vKipcbiAqIFRoZSBmdWxsIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIHN0YXR1cyB0b2tlbiB2b2NhYnVsYXJ5ICh0aGVcbiAqIGdpdC1zcGFuIENMSSdzIHBvcmNlbGFpbiBjb250cmFjdCk6IGBGUkVTSGAvYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBhcmUgcG9zaXRpb25hbC1vci1jbGVhbiBhbmQgbmV2ZXIgZGVidDsgZXZlcnkgb3RoZXIgdG9rZW4gaXMgc2VtYW50aWMgZHJpZnRcbiAqIG9yIGEgdGVybWluYWwvZXJyb3IgY29uZGl0aW9uIGFuZCBpcyBkZWJ0LiBTZWUge0BsaW5rIGlzRGVidH0gZm9yIHRoZVxuICogc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBvbiB0aGF0IHNwbGl0LlxuICovXG5leHBvcnQgY29uc3QgUE9SQ0VMQUlOX1NUQVRVU0VTID0gW1xuICAnRlJFU0gnLFxuICAnUkVTT0xWRURfUEVORElOR19DT01NSVQnLFxuICAnTU9WRUQnLFxuICAnQ0hBTkdFRCcsXG4gICdERUxFVEVEJyxcbiAgJ0NPTkZMSUNUJyxcbiAgJ1NVQk1PRFVMRScsXG4gICdMRlNfTk9UX0ZFVENIRUQnLFxuICAnTEZTX05PVF9JTlNUQUxMRUQnLFxuICAnUFJPTUlTT1JfTUlTU0lORycsXG4gICdTUEFSU0VfRVhDTFVERUQnLFxuICAnRklMVEVSX0ZBSUxFRCcsXG4gICdJT19FUlJPUidcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIFBvcmNlbGFpblN0YXR1cyA9ICh0eXBlb2YgUE9SQ0VMQUlOX1NUQVRVU0VTKVtudW1iZXJdO1xuXG5jb25zdCBQT1JDRUxBSU5fU1RBVFVTX1NFVDogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoUE9SQ0VMQUlOX1NUQVRVU0VTKTtcblxuZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW5TdGF0dXMocmF3OiBzdHJpbmcpOiBQb3JjZWxhaW5TdGF0dXMgfCBudWxsIHtcbiAgcmV0dXJuIFBPUkNFTEFJTl9TVEFUVVNfU0VULmhhcyhyYXcpID8gKHJhdyBhcyBQb3JjZWxhaW5TdGF0dXMpIDogbnVsbDtcbn1cblxuLyoqIEEgYHBhcnNlRHJpZnRQb3JjZWxhaW5gIHJvdzogYSB7QGxpbmsgUG9yY2VsYWluUm93fSBwbHVzIGl0cyBzdGF0dXMgdG9rZW4uICovXG5leHBvcnQgaW50ZXJmYWNlIERyaWZ0UG9yY2VsYWluUm93IGV4dGVuZHMgUG9yY2VsYWluUm93IHtcbiAgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXM7XG59XG5cbi8qKlxuICogVGhlIGRlYnQgaW52YXJpYW50IChzeXN0ZW0td2lkZTsgY29uc3VtZWQgYnkgYm90aCB0aGUgZnV0dXJlIHRvdWNoLWNvcmUgYW5kXG4gKiBhZHZpc29yLWNvcmUpOiBvbmx5IHNlbWFudGljIHN0YXR1c2VzIGFyZSBkZWJ0LiBgQ0hBTkdFRGAgYW5kIGBERUxFVEVEYCBhcmVcbiAqIHNlbWFudGljIGRyaWZ0OyB0aGUgcmVtYWluaW5nIG5vbi1GUkVTSC9NT1ZFRC9SRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCB0b2tlbnNcbiAqIGFyZSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb25zIGFuZCBhcmUgdHJlYXRlZCBhcyBkZWJ0IHRvbyAodGhleSBibG9jayBvblxuICogdGhlaXIgb3duIG1lcml0cyBcdTIwMTQgdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0IGFsbCkuIGBGUkVTSGAsXG4gKiBgTU9WRURgLCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidDogcG9zaXRpb25hbCBkcmlmdCB0aGVcbiAqIENMSSBjYW4gaGVhbCAob3IgYWxyZWFkeSBoYXMpIGlzIGludmlzaWJsZSwgYW5kIGEgcGVuZGluZy1jb21taXQgcmVzb2x1dGlvblxuICogaXMgbm90IG91dHN0YW5kaW5nIGRlYnQuXG4gKlxuICogTm90ZTogdGhlIHBvcmNlbGFpbiB2b2NhYnVsYXJ5IGRvZXMgbm90IGN1cnJlbnRseSBkaXN0aW5ndWlzaFxuICogY29udGVudC1lcXVpdmFsZW50IGBDSEFOR0VEYCAoZS5nLiB3aGl0ZXNwYWNlLW9ubHkgZHJpZnQgYC0tZml4YCBjYW4gaGVhbClcbiAqIGZyb20gZ2VudWluZWx5IHNlbWFudGljIGBDSEFOR0VEYCBcdTIwMTQgdGhhdCBjbGFzc2lmaWNhdGlvbiBpcyBub3QgcHJlc2VudCBpblxuICogYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgb3V0cHV0IHRvZGF5LiBVbnRpbCB0aGUgQ0xJIGV4cG9zZXMgaXQsXG4gKiBldmVyeSBgQ0hBTkdFRGAgcm93IGlzIHRyZWF0ZWQgYXMgZGVidC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRGVidChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0ZSRVNIJzpcbiAgICBjYXNlICdNT1ZFRCc6XG4gICAgY2FzZSAnUkVTT0xWRURfUEVORElOR19DT01NSVQnOlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG4vKipcbiAqIExvd2VyY2FzZSBodW1hbiBsYWJlbCBmb3IgYSBwb3JjZWxhaW4gc3RhdHVzIHRva2VuIChgTEZTX05PVF9GRVRDSEVEYCBcdTIxOTJcbiAqIGBsZnMgbm90IGZldGNoZWRgKS4gVGhlIHNpbmdsZSBsYWJlbCBtYXBwaW5nIGZvciBldmVyeSBodW1hbi1mb3JtYXQgYW5jaG9yXG4gKiBzdWZmaXggXHUyMDE0IGJvdGggdGhlIHRvdWNoIGhvb2sncyBibG9jayBhbmQgdGhlIGFkdmlzb3IncyBtZXNzYWdlcyByZW5kZXIgdGhyb3VnaFxuICogdGhpcywgc28gYSBzdGF0dXMgbmV2ZXIgcmVhZHMgZGlmZmVyZW50bHkgYmV0d2VlbiB0aGUgdHdvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaHVtYW5TdGF0dXNMYWJlbChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIHJldHVybiBzdGF0dXMudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fL2csICcgJyk7XG59XG5cbi8qKlxuICogVGhlIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgc3RhdHVzZXM6IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdFxuICogYWxsLCBzbyB0aGUgcm93IGlzIG5vdCBzcGFuIGRyaWZ0IGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuLiBUaGVzZSBhcmVcbiAqIGBDT05GTElDVGAgKHVucmVzb2x2ZWQgbWVyZ2UpLCBgU1VCTU9EVUxFYCAoYW5jaG9yIGluc2lkZSBhIHN1Ym1vZHVsZSksXG4gKiBgTEZTX05PVF9GRVRDSEVEYC9gTEZTX05PVF9JTlNUQUxMRURgIChHaXQgTEZTIGNvbnRlbnQgdW5hdmFpbGFibGUpLFxuICogYFBST01JU09SX01JU1NJTkdgIChwYXJ0aWFsLWNsb25lIG9iamVjdCBub3QgZmV0Y2hlZCksIGBTUEFSU0VfRVhDTFVERURgXG4gKiAocGF0aCBvdXRzaWRlIHRoZSBzcGFyc2UtY2hlY2tvdXQgY29uZSksIGBGSUxURVJfRkFJTEVEYCAoYSBjbGVhbi9zbXVkZ2VcbiAqIGZpbHRlciBlcnJvcmVkKSwgYW5kIGBJT19FUlJPUmAgKHRyYW5zaWVudCByZWFkIGZhaWx1cmUpLlxuICpcbiAqIFRoZXNlIGFyZSBhIHN0cmljdCBzdWJzZXQgb2Yge0BsaW5rIGlzRGVidH06IGV2ZXJ5IGVudmlyb25tZW50YWwgc3RhdHVzIGlzXG4gKiBhbHNvIGRlYnQgKGl0IGJsb2NrcyBvbiBpdHMgb3duIG1lcml0cyB3aGVuIHN1cmZhY2VkIGluIGEgc3RhdHVzIHJlcG9ydCksIGJ1dFxuICogdGhlIGFkdmlzb3IgbXVzdCB0cmVhdCB0aGVtIGRpZmZlcmVudGx5IGZyb20gKnNlbWFudGljKiBkcmlmdCAoYENIQU5HRURgLFxuICogYERFTEVURURgKS4gU2VtYW50aWMgZHJpZnQgaXMgZml4YWJsZSBieSBlZGl0aW5nIGEgc3Bhbiwgc28gdGhlIGFkdmlzb3IgZmFpbHNcbiAqIGNsb3NlZCBvbiBpdDsgYW4gZW52aXJvbm1lbnRhbCBjb25kaXRpb24gaXMgbm90IHNvbWV0aGluZyBhIHNwYW4gZWRpdCBjYW5cbiAqIHJlc29sdmUsIHNvIHRoZSBhZHZpc29yIGZhaWxzIE9QRU4gb24gaXQgKGFsbG93LCBidXQgc3VyZmFjZSB0aGUgY29uZGl0aW9uKSBcdTIwMTRcbiAqIHJlLWRlbnlpbmcgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZSB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIGhlcmUgd291bGRcbiAqIGNvbnRyYWRpY3QgdGhlIGZhaWwtb3BlbiBjb250cmFjdCB0aGUgcmVzdCBvZiB0aGUgYWR2aXNvciBhbHJlYWR5IGhvbm9ycyBmb3JcbiAqIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZS1mYWlsdXJlIGNvbmRpdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0Vudmlyb25tZW50YWxTdGF0dXMoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdDT05GTElDVCc6XG4gICAgY2FzZSAnU1VCTU9EVUxFJzpcbiAgICBjYXNlICdMRlNfTk9UX0ZFVENIRUQnOlxuICAgIGNhc2UgJ0xGU19OT1RfSU5TVEFMTEVEJzpcbiAgICBjYXNlICdQUk9NSVNPUl9NSVNTSU5HJzpcbiAgICBjYXNlICdTUEFSU0VfRVhDTFVERUQnOlxuICAgIGNhc2UgJ0ZJTFRFUl9GQUlMRUQnOlxuICAgIGNhc2UgJ0lPX0VSUk9SJzpcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBlbWl0cyBhIGRpZmZlcmVudCBzaGFwZSB0aGFuXG4gKiBgbGlzdCAtLXBvcmNlbGFpbmA6IGEgYCMgcG9yY2VsYWluIHYyYCBoZWFkZXIsIGAjIGZ1enp5IE5gIGNvbW1lbnQgbGluZXMsXG4gKiBhbmQgb25lIGA8c3RhdHVzPlxcdDxzcmM+XFx0PG5hbWU+XFx0PHBhdGg+XFx0PHN0YXJ0PlxcdDxlbmQ+YCByb3cgcGVyIGRyaWZ0ZWRcbiAqIGFuY2hvciAod2hvbGUtZmlsZSBhbmNob3JzIGNhcnJ5IGAod2hvbGUpYC9gLWAgaW4gcGxhY2Ugb2YgdGhlIGxpbmUgY29sdW1ucykuXG4gKiBSb3dzIHdob3NlIHN0YXR1cyB0b2tlbiBpcyBub3QgaW4ge0BsaW5rIFBPUkNFTEFJTl9TVEFUVVNFU30gYXJlIHNraXBwZWQgXHUyMDE0XG4gKiBhbiB1bnJlY29nbml6ZWQgdG9rZW4gZnJvbSBhIG5ld2VyIENMSSBpcyB0cmVhdGVkIHRoZSBzYW1lIGFzIGEgbWFsZm9ybWVkXG4gKiBsaW5lIHJhdGhlciB0aGFuIGd1ZXNzZWQgYXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZURyaWZ0UG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogRHJpZnRQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IHRyaW1tZWQuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCA2KSBjb250aW51ZTtcbiAgICBjb25zdCBbc3RhdHVzQ29sLCAsIG5hbWUsIHBhdGgsIHN0YXJ0Q29sLCBlbmRDb2xdID0gcGFydHM7XG4gICAgY29uc3Qgc3RhdHVzID0gcGFyc2VQb3JjZWxhaW5TdGF0dXMoc3RhdHVzQ29sKTtcbiAgICBpZiAoIXN0YXR1cykgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBzdGFydENvbCA9PT0gJyh3aG9sZSknID8gMCA6IHBhcnNlSW50KHN0YXJ0Q29sLCAxMCk7XG4gICAgY29uc3QgZW5kID0gZW5kQ29sID09PSAnLScgPyAwIDogcGFyc2VJbnQoZW5kQ29sLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQsIHN0YXR1cyB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIElEIHNhbml0aXphdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSW5qZWN0aXZlIHRyYW5zZm9ybTogcGVyY2VudC1lbmNvZGUgYnl0ZXMgb3V0c2lkZSBbQS1aYS16MC05Ll8tXSBhcyAlSEhcbiAqICh1cHBlcmNhc2UgaGV4KS4gVXNlZCB0byBwcm9kdWNlIHNhZmUgZmlsZW5hbWVzIGZyb20gYXJiaXRyYXJ5IHNlc3Npb24gaWRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2Vzc2lvbklkLnJlcGxhY2UoL1teQS1aYS16MC05Ll8tXS9nLCAoY2gpID0+IHtcbiAgICByZXR1cm4gYCUke2NoLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkucGFkU3RhcnQoMiwgJzAnKX1gO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQZXItc2Vzc2lvbiBiYXNlIGRpcmVjdG9yeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEJhc2UgZGlyIHNoYXJlZCBieSBhbGwgcGVyLXNlc3Npb24gc3RhdGU6IGN1cnJlbnRseSBqdXN0IHRoZSB0b3VjaC1ob29rXG4vLyBzZXNzaW9uIG1lbW8gKHNwYW4tc3VyZmFjZS50cydzIE1lbW9TdG9yZSkuIEVhY2ggc2Vzc2lvbiBnZXRzIG9uZVxuLy8gc3ViZGlyZWN0b3J5IGtleWVkIGJ5IGl0cyBzYW5pdGl6ZWQgaWQsIHNvIGV2ZXJ5IHdyaXRlci9yZWFkZXIgZm9yIGEgZ2l2ZW5cbi8vIHNlc3Npb24gYWdyZWVzIG9uIGl0cyBsb2NhdGlvbi5cbmV4cG9ydCBjb25zdCBTRVNTSU9OX0JBU0VfRElSID0gbm9kZVBhdGguam9pbihvcy5ob21lZGlyKCksICcuY2FjaGUnLCAnZ2l0LXNwYW4nLCAnc2Vzc2lvbicpO1xuXG4vKiogVGhlIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSBmb3IgYSBnaXZlbiBzZXNzaW9uIGlkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25EaXIoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQpKTtcbn1cblxuY29uc3QgVEhJUlRZX0RBWVNfTVMgPSAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDA7XG5cbi8qKlxuICogT3Bwb3J0dW5pc3RpY2FsbHkgcHJ1bmUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3JpZXMgdW5kZXJcbiAqIHtAbGluayBTRVNTSU9OX0JBU0VfRElSfSB3aG9zZSBtdGltZSBpcyBvbGRlciB0aGFuIGBtYXhBZ2VNc2AgKGRlZmF1bHQgMzBcbiAqIGRheXMpLiBBIGRpcmVjdG9yeSdzIG10aW1lIGFkdmFuY2VzIHdoZW5ldmVyIGFuIGVudHJ5IGluc2lkZSBpdCBpc1xuICogY3JlYXRlZC9yZW5hbWVkL3JlbW92ZWQsIHNvIGFuIGFjdGl2ZSBzZXNzaW9uIChtZW1vIHdyaXRlcykgc3RheXMgZnJlc2g7XG4gKiBvbmx5IGdlbnVpbmVseSBhYmFuZG9uZWQgc2Vzc2lvbnMgYWdlIG91dC5cbiAqXG4gKiBCZXN0LWVmZm9ydCBhbmQgbm9uLXRocm93aW5nOiBjYWxsZWQgb3Bwb3J0dW5pc3RpY2FsbHkgZnJvbSBob29rIHJlYWQvd3JpdGVcbiAqIHBhdGhzLCBub3QgYSBzZXBhcmF0ZSBjcm9uLWxpa2UgbWVjaGFuaXNtLCBzbyBhIGZhaWx1cmUgaGVyZSBtdXN0IG5ldmVyXG4gKiBibG9jayB0aGUgY2FsbGVyJ3MgYWN0dWFsIHdvcmsuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcnVuZVN0YWxlU2Vzc2lvbnMobm93OiBudW1iZXIgPSBEYXRlLm5vdygpLCBtYXhBZ2VNczogbnVtYmVyID0gVEhJUlRZX0RBWVNfTVMpOiB2b2lkIHtcbiAgbGV0IGVudHJpZXM6IGZzLkRpcmVudFtdO1xuICB0cnkge1xuICAgIGVudHJpZXMgPSBmcy5yZWFkZGlyU3luYyhTRVNTSU9OX0JBU0VfRElSLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybjsgLy8gYmFzZSBkaXIgYWJzZW50IG9yIHVucmVhZGFibGUgXHUyMDE0IG5vdGhpbmcgdG8gcHJ1bmVcbiAgfVxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBpZiAoIWVudHJ5LmlzRGlyZWN0b3J5KCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGRpclBhdGggPSBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIGVudHJ5Lm5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoZGlyUGF0aCk7XG4gICAgICBpZiAobm93IC0gc3RhdC5tdGltZU1zID4gbWF4QWdlTXMpIHtcbiAgICAgICAgZnMucm1TeW5jKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFZhbmlzaGVkIGJldHdlZW4gcmVhZGRpciBhbmQgc3RhdCwgb3IgcmVtb3ZhbCBmYWlsZWQgXHUyMDE0IHNraXAgaXQuIEFcbiAgICAgIC8vIGJlc3QtZWZmb3J0IHBydW5lIG11c3QgbmV2ZXIgdGhyb3cgaW50byB0aGUgY2FsbGVyJ3MgaG90IHBhdGguXG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2gga2luZCBhbmQgYW5jaG9yIGZvcm1hdHRpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUb3VjaEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnIHwgJ3dob2xlLXJlYWQnIHwgJ3dob2xlLXdyaXRlJyB8ICdjcmVhdGUnO1xuXG4vKipcbiAqIEZvcm1hdCBhIHNwYW4gYW5jaG9yIHN0cmluZy5cbiAqXG4gKiAtIGB3aG9sZS1yZWFkYCwgYHdob2xlLXdyaXRlYCwgYW5kIGBjcmVhdGVgOiByZXR1cm5zIGp1c3QgdGhlIHBhdGhcbiAqIC0gYHJlYWRgIGFuZCBgd3JpdGVgOiByZXR1cm5zIGBwYXRoI0w8c3RhcnQ+LUw8ZW5kPmAgKHJlcXVpcmVzIHJhbmdlKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0QW5jaG9yKHBhdGg6IHN0cmluZywga2luZDogVG91Y2hLaW5kLCByYW5nZT86IExpbmVSYW5nZSk6IHN0cmluZyB7XG4gIGlmICgoa2luZCA9PT0gJ3JlYWQnIHx8IGtpbmQgPT09ICd3cml0ZScpICYmIHJhbmdlKSB7XG4gICAgcmV0dXJuIGAke3BhdGh9I0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgfVxuICByZXR1cm4gcGF0aDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBbmNob3Igc3BlYyB0eXBlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBBbmNob3JTcGVjIHtcbiAgcGF0aDogc3RyaW5nO1xuICBraW5kOiBUb3VjaEtpbmQ7XG4gIHJhbmdlPzogTGluZVJhbmdlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFF1ZXVlIGRpcmVjdG9yeSBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBnaXQgY29tbW9uIGRpcmVjdG9yeSBmb3IgdGhlIGdpdmVuIHJlcG8gcm9vdC5cbiAqIFRoaXMgaXMgdGhlIHNoYXJlZCBkaXJlY3RvcnkgKG5vdCB0aGUgd29ya3RyZWUtc3BlY2lmaWMgLmdpdCksIHNvIHF1ZXVlXG4gKiByZWNvcmRzIHN1cnZpdmUgd29ya3RyZWUgZGVsZXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3Jldi1wYXJzZScsICctLWdpdC1jb21tb24tZGlyJ10sIHtcbiAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICBlbmNvZGluZzogJ3V0ZjgnXG4gIH0pO1xuICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKTtcbiAgLy8gZ2l0IHJldHVybnMgYSByZWxhdGl2ZSBwYXRoIChlLmcuIFwiLmdpdFwiKSBmb3Igc2ltcGxlIHJlcG9zLiBSZXNvbHZlIGl0XG4gIC8vIGFnYWluc3QgcmVwb1Jvb3Qgc28gY2FsbGVycyBuZXZlciBkZXBlbmQgb24gcHJvY2Vzcy5jd2QoKS5cbiAgaWYgKCFub2RlUGF0aC5pc0Fic29sdXRlKHRyaW1tZWQpKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgobm9kZVBhdGgucmVzb2x2ZShyZXBvUm9vdCwgdHJpbW1lZCkpO1xuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJvb3Qgb2YgdGhlIGdpdC1zcGFuIHF1ZXVlIGRpcmVjdG9yeSB0cmVlLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWV1ZVJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3QpLCAnZ2l0LXNwYW4nKTtcbn1cblxuLyoqXG4gKiBEaXJlY3RvcnkgZm9yIHRoZSBhZHZpc29yJ3MgcGVyLWNoYW5nZXNldCBzdGF0ZSBtZW1vcyAoZGlnZXN0IG9mIHNvcnRlZFxuICogZmluZGluZ3MgKyB1bmNvdmVyZWQgcGF0aHMpLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIgc28gaXQgaXMgc2hhcmVkXG4gKiBhY3Jvc3Mgd29ya3RyZWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYWR2aXNvck1lbW9EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHF1ZXVlUm9vdChyZXBvUm9vdCksICdhZHZpc29yJyk7XG59XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHNwYW4tc3VyZmFjaW5nIGNvcmUuXG4gKlxuICogR2l2ZW4gYW4gYWxyZWFkeS1yZXNvbHZlZCByZXBvLXJlbGF0aXZlIHBhdGggYW5kIGEgbGluZSByYW5nZSwgdGhpcyBtb2R1bGVcbiAqIHJ1bnMgdGhlIHNoYXJlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgLyBgLmhvb2tpZ25vcmVgIC8gc2Vzc2lvbi1tZW1vIC9cbiAqIGBnaXQgc3BhbiBkcmlmdGAgcGlwZWxpbmUgYW5kIGFzc2VtYmxlcyB0aGUgaHVtYW4tcmVhZGFibGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmBcbiAqIGJsb2NrIHRoYXQgYm90aCBhZGFwdGVycyBzdXJmYWNlIGlubGluZSBiZWZvcmUgYW4gZWRpdC4gSXQgaW1wb3J0cyBub3RoaW5nXG4gKiBmcm9tIGVpdGhlciBob29rIFNESzogdGhlIENsYXVkZSBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgYSByYW5nZSBkZXJpdmVkIGZyb21cbiAqIGBmaWxlX3BhdGhgL2BvZmZzZXRgL2BvbGRfc3RyaW5nYDsgdGhlIENvZGV4IFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCB0aGVcbiAqIHJhbmdlcyByZWNvdmVyZWQgZnJvbSBhbiBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlLiBFYWNoIGFkYXB0ZXIgd3JhcHMgdGhlXG4gKiByZXR1cm5lZCBibG9jayBzdHJpbmcgaW4gaXRzIG93biBTREsgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogVGhlIGV4ZWN1dG9yL2RyaWZ0L21lbW8gZGVwZW5kZW5jaWVzIGFyZSBpbmplY3RlZCBzbyB0aGUgcGlwZWxpbmUgaXMgdGVzdGFibGVcbiAqIHdpdGggZmFrZXMgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGUgc2hhcmVkIGtlcm5lbC5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgaXNHaXRJZ25vcmVkLFxuICBpc0luc2lkZVNwYW5Sb290LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICBwcnVuZVN0YWxlU2Vzc2lvbnMsXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290LFxuICBzZXNzaW9uRGlyLFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHR5cGUgSG9va0lnbm9yZUxvYWRlciwgaXNTcGFuU3VwcHJlc3NlZCB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG4vKipcbiAqIE1pbmltYWwgbG9nZ2VyIHN1cmZhY2UgdGhlIGBjb21tb24vYCBsYXllciBsb2dzIHRocm91Z2g7IGJvdGggU0RLIGxvZ2dlcnNcbiAqIHNhdGlzZnkgaXQuIGB3YXJuYCBpcyByZXF1aXJlZCBcdTIwMTQgZXZlcnkgZXhpc3RpbmcgY2FsbCBzaXRlIHJlcG9ydHMgYSBmYWlsdXJlLlxuICogYGluZm9gIGlzIG9wdGlvbmFsIHNvIGEgZmFrZSBjYXJyeWluZyBvbmx5IGB3YXJuYCBzdGlsbCBzYXRpc2ZpZXMgdGhlXG4gKiBpbnRlcmZhY2U6IGl0IGV4aXN0cyBmb3IgdGhlIGRpYWdub3N0aWMgYnJlYWRjcnVtYnMgYSAqc3VjY2Vzc2Z1bCogcnVuIGxlYXZlc1xuICogYmVoaW5kIChhZHZpc29yLWNvcmUncyBjaHVybi1zdXBwcmVzc2lvbiBjb3VudCksIHdoaWNoIGFyZSBub3Qgd2FybmluZ3MgYW5kXG4gKiBtdXN0IG5vdCByZWFkIGFzIGZhaWx1cmVzIGluIHRoZSBob29rIGxvZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb3JlTG9nZ2VyIHtcbiAgd2FybihtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG4gIGluZm8/KG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTcGFuIGV4ZWN1dG9yIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBFeGVjdXRlcyBgZ2l0IHNwYW4gbGlzdGAgd2l0aCBnaXZlbiBhcmdzIGluIGEgZ2l2ZW4gY3dkLlxuICogUmV0dXJucyBzdGRvdXQgc3RyaW5nLiBUaHJvd3Mgb24gbm9uLXplcm8gZXhpdC5cbiAqL1xuZXhwb3J0IHR5cGUgU3BhbkV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBTcGFuRXhlY3V0b3Ige1xuICByZXR1cm4gKGFyZ3MsIGN3ZCkgPT4ge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4uYXJnc10sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW5zIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPHNsdWdzPmAgYW5kIHJldHVybnMgaXRzIHBvcmNlbGFpbiBzdGRvdXQgXHUyMDE0XG4gKiBvbmUgcm93IHBlciAqZHJpZnRlZCogYW5jaG9yIGFtb25nIHRoZSBnaXZlbiBzcGFucywgZW1wdHkgd2hlbiBhbGwgYXJlIGNsZWFuLlxuICogYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAwIGluIHBvcmNlbGFpbiBtb2RlIHdoZXRoZXIgb3Igbm90IGRyaWZ0IGV4aXN0cywgYnV0IHdlXG4gKiBzdGlsbCBjYXB0dXJlIHN0ZG91dCBmcm9tIGEgdGhyb3duIGVycm9yIHNvIGEgZHJpZnQgc2lnbmFsIGlzIG5ldmVyIGxvc3QgdG8gYVxuICogbm9uLXplcm8gZXhpdC4gVGhyb3dzIG9ubHkgd2hlbiBubyBzdGRvdXQgaXMgYXZhaWxhYmxlIChnZW51aW5lIGZhaWx1cmUpLlxuICovXG5leHBvcnQgdHlwZSBEcmlmdEV4ZWN1dG9yID0gKHNsdWdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHREcmlmdEV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IERyaWZ0RXhlY3V0b3Ige1xuICByZXR1cm4gKHNsdWdzLCBjd2QpID0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNsdWdzXSwge1xuICAgICAgICBjd2QsXG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgaWYgKHR5cGVvZiBvdXQgPT09ICdzdHJpbmcnKSByZXR1cm4gb3V0O1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIG1lbW8gYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lbW9TdG9yZSB7XG4gIGdldFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nKTogU2V0PHN0cmluZz47XG4gIGFkZFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nLCBuYW1lczogc3RyaW5nW10pOiB2b2lkO1xufVxuXG4vLyBMaXZlcyB1bmRlciB0aGUgc2hhcmVkIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSAoYWdlbnQtaG9va3MtY29tbW9uLnRzJ3Ncbi8vIHNlc3Npb25EaXIpIFx1MjAxNCByZWxvY2F0ZWQgZnJvbSBvcy50bXBkaXIoKS9hZ2VudC1ob29rcy1naXQtc3Bhbi8gc29cbi8vIHBlci1zZXNzaW9uIHN0YXRlIGhhcyBvbmUgaG9tZSBhbmQgaXMgY292ZXJlZCBieSBwcnVuZVN0YWxlU2Vzc2lvbnMnc1xuLy8gb3Bwb3J0dW5pc3RpYyA+MzAtZGF5IHBydW5pbmcuXG5mdW5jdGlvbiBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihzZXNzaW9uRGlyKHNlc3Npb25JZCksICd0b3VjaC1tZW1vLmpzb24nKTtcbn1cblxuZXhwb3J0IHR5cGUgTWVtb0xvZ2dlciA9IENvcmVMb2dnZXI7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiB7XG4gICAgZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJhdyA9IGZzLnJlYWRGaWxlU3luYyhtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKSwgJ3V0ZjgnKTtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHsgc3VyZmFjZWQ/OiB1bmtub3duIH07XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZC5zdXJmYWNlZCkpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IFNldChwYXJzZWQuc3VyZmFjZWQgYXMgc3RyaW5nW10pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gcmVhZCBmYWlsZWQgKHRyZWF0aW5nIGFzIGVtcHR5KScsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBTZXQoKTtcbiAgICB9LFxuICAgIGFkZFN1cmZhY2VkKHNlc3Npb25JZCwgbmFtZXMpIHtcbiAgICAgIHBydW5lU3RhbGVTZXNzaW9ucygpO1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gICAgICBmb3IgKGNvbnN0IG4gb2YgbmFtZXMpIGV4aXN0aW5nLmFkZChuKTtcbiAgICAgIGNvbnN0IG1lbW9EaXIgPSBzZXNzaW9uRGlyKHNlc3Npb25JZCk7XG4gICAgICBjb25zdCBtZW1vUGF0aCA9IG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgdG1wUGF0aCA9IGAke21lbW9QYXRofS50bXBgO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKG1lbW9EaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHRtcFBhdGgsIEpTT04uc3RyaW5naWZ5KHsgc3VyZmFjZWQ6IFsuLi5leGlzdGluZ10gfSksICd1dGY4Jyk7XG4gICAgICAgIGZzLnJlbmFtZVN5bmModG1wUGF0aCwgbWVtb1BhdGgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHdyaXRlIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqIEZhY3RvcnkgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEgTWVtb1N0b3JlIGdpdmVuIGEgbG9nZ2VyLiAqL1xuZXhwb3J0IHR5cGUgTWVtb0ZhY3RvcnkgPSAobG9nZ2VyOiBNZW1vTG9nZ2VyKSA9PiBNZW1vU3RvcmU7XG5cbi8qKiBEZWZhdWx0IGRpc2stYmFja2VkIG1lbW8gZmFjdG9yeSB1c2VkIGluIHByb2R1Y3Rpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZGlza01lbW9GYWN0b3J5KGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggc2NvcGUgcmVzb2x1dGlvbiAocmVwby1zY29waW5nICsgZ2l0aWdub3JlICsgc3Bhbi1yb290IGd1YXJkcylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoU2NvcGUge1xuICByZXBvUm9vdDogc3RyaW5nO1xuICByZXBvUmVsUGF0aDogc3RyaW5nO1xufVxuXG4vKipcbiAqIEJvdW5kIGEgdG91Y2hlZCBmaWxlIHRvIHRoZSBDV0QgcmVwby4gUmVzb2x2ZSB0aGUgcmVwbyByb290IG9mIHRoZSBjdXJyZW50XG4gKiB3b3JraW5nIGRpcmVjdG9yeSBhbmQgcmVxdWlyZSB0aGUgdG91Y2hlZCBmaWxlIHRvIHJlc29sdmUgdG8gdGhlIFNBTUUgcmVwb1xuICogcm9vdDsgZHJvcCBmaWxlcyBpbiBhIGRpZmZlcmVudCByZXBvc2l0b3J5L3dvcmt0cmVlLCBnaXRpZ25vcmVkIGZpbGVzLCBhbmRcbiAqIGZpbGVzIHVuZGVyIHRoZSBzcGFuIHJvb3QuIFJldHVybnMgdGhlIHJlc29sdmVkIGB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9YFxuICogb3IgbnVsbCB3aGVuIHRoZSB0b3VjaCBpcyBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQ29tcGFyaW5nIHJlc29sdmVkIGBnaXQgLS1zaG93LXRvcGxldmVsYCB0b3BsZXZlbHMgKG5vdCBwYXRoIHByZWZpeGVzKVxuICogZGlzdGluZ3Vpc2hlcyBzZXBhcmF0ZSByZXBvcyBhbmQgd29ya3RyZWVzIGFuZCBpcyByb2J1c3QgdG8gc3ltbGlua3MuIEZhaWxcbiAqIGNsb3NlZDogaWYgdGhlIENXRCByZXBvIGNhbid0IGJlIHJlc29sdmVkLCB0aGUgdG91Y2ggaXMgZHJvcHBlZCByYXRoZXIgdGhhblxuICogZmFsbGluZyBiYWNrIHRvIHRoZSBmaWxlJ3Mgb3duIHJlcG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlVG91Y2hTY29wZShjd2Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogVG91Y2hTY29wZSB8IG51bGwge1xuICBjb25zdCBjd2RSZXBvUm9vdCA9IGN3ZCA/IHJlc29sdmVSZXBvUm9vdChjd2QpIDogbnVsbDtcbiAgaWYgKCFjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgYWJzRGlyID0gdG9Qb3NpeChub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKTtcbiAgY29uc3QgZmlsZVJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGFic0Rpcik7XG4gIGlmIChmaWxlUmVwb1Jvb3QgIT09IGN3ZFJlcG9Sb290KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCByZXBvUm9vdCA9IGN3ZFJlcG9Sb290O1xuICBjb25zdCByZXBvUmVsUGF0aCA9IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhYnNQYXRoKTtcblxuICAvLyBTa2lwIGdpdGlnbm9yZWQgZmlsZXMgZW50aXJlbHkuIEJ1aWxkIG91dHB1dCwgY2FjaGVzLCBhbmQgbG9ncyBhcmUgbm90XG4gIC8vIHNwYW4tcmVsZXZhbnQ6IHRoZXkgbXVzdCBuZXZlciBzdXJmYWNlIHNwYW4gb3ZlcmxhcHMuXG4gIGlmIChpc0dpdElnbm9yZWQocmVwb1Jvb3QsIHJlcG9SZWxQYXRoKSkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU2tpcCBzcGFuIGRvY3VtZW50cyBlbnRpcmVseS4gRmlsZXMgdW5kZXIgdGhlIHJlc29sdmVkIHNwYW4gcm9vdCBhcmUgbWFuYWdlZFxuICAvLyBieSBnaXQgc3BhbiBpdHNlbGYgYW5kIGFyZSBub3QgYXBwbGljYXRpb24gc291cmNlcyB0aGF0IG5lZWQgc3BhbiBjb3ZlcmFnZS5cbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICBpZiAoaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aCwgc3BhblJvb3QpKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4geyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTdXJmYWNlIHJvdXRpbmVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogSW5qZWN0ZWQgZGVwZW5kZW5jaWVzIGZvciB7QGxpbmsgc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnN9LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdXJmYWNlRGVwcyB7XG4gIGV4ZWN1dG9yOiBTcGFuRXhlY3V0b3I7XG4gIGRyaWZ0RXhlY3V0b3I6IERyaWZ0RXhlY3V0b3I7XG4gIG1lbW86IE1lbW9TdG9yZTtcbiAgbG9hZFJ1bGVzOiBIb29rSWdub3JlTG9hZGVyO1xuICBsb2dnZXI6IENvcmVMb2dnZXI7XG59XG5cbi8qKlxuICogR2l2ZW4gYSByZXBvLXJlbGF0aXZlIHBhdGggYW5kIHRoZSBsaW5lIHJhbmdlIGJlaW5nIHRvdWNoZWQgd2l0aGluIGFuXG4gKiBhbHJlYWR5LXJlc29sdmVkIHJlcG8sIHByb2R1Y2UgdGhlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gIGJsb2NrIGZvciB0aGVcbiAqIHNwYW5zIG92ZXJsYXBwaW5nIHRoYXQgcmFuZ2UsIG9yIG51bGwgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHRvIHN1cmZhY2UuXG4gKlxuICogVGhlIHBpcGVsaW5lOiBgZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5gIFx1MjE5MiBrZWVwIGxpbmUtcmFuZ2VkIGFuY2hvcnMgb25cbiAqIHRoZSBzYW1lIGZpbGUgdGhhdCBpbnRlcnNlY3QgdGhlIHJhbmdlIGFuZCBhcmUgbm90IGAuaG9va2lnbm9yZWAtc3VwcHJlc3NlZCBcdTIxOTJcbiAqIGRyb3Agc2x1Z3MgYWxyZWFkeSBzdXJmYWNlZCB0aGlzIHNlc3Npb24gKG1lbW8pIFx1MjE5MiByZW5kZXIgYGdpdCBzcGFuIGxpc3RcbiAqIDxuYW1lc1x1MjAyNj5gIFx1MjE5MiBhcHBlbmQgYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIgZm9yIGFueSBhbHJlYWR5LWRyaWZ0ZWRcbiAqIHNwYW4uIE9uIHN1Y2Nlc3MgdGhlIHN1cmZhY2VkIG5hbWVzIGFyZSByZWNvcmRlZCBpbiB0aGUgbWVtby4gRXhlY3V0b3IgYW5kXG4gKiBkcmlmdC1wcm9iZSBmYWlsdXJlcyBhcmUgbG9nZ2VkIGFuZCBkZWdyYWRlIHRvIG51bGwgLyB0aGUgcGxhaW4gYmxvY2s7IHRoZXlcbiAqIG5ldmVyIHRocm93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnMoXG4gIGRlcHM6IFN1cmZhY2VEZXBzLFxuICByZXBvUm9vdDogc3RyaW5nLFxuICByZXBvUmVsUGF0aDogc3RyaW5nLFxuICByYW5nZTogTGluZVJhbmdlLFxuICBzZXNzaW9uSWQ6IHN0cmluZ1xuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHsgZXhlY3V0b3IsIGRyaWZ0RXhlY3V0b3IsIG1lbW8sIGxvYWRSdWxlcywgbG9nZ2VyIH0gPSBkZXBzO1xuXG4gIC8vIEZpbHRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpblxuICBsZXQgcG9yY2VsYWluU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcG9yY2VsYWluU3Rkb3V0ID0gZXhlY3V0b3IoWyctLXBvcmNlbGFpbicsIHJlcG9SZWxQYXRoXSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIFBhdGgtc2NvcGVkIHN1cHByZXNzaW9uOiBhIHJlcG8ncyAuc3Bhbi8uaG9va2lnbm9yZSBjYW4gaG9sZCBiYWNrIHNwYW4gc2x1Z1xuICAvLyBwcmVmaXhlcyBmb3IgYW5jaG9ycyB1bmRlciBnaXZlbiBwYXRocy4gQSBzdXBwcmVzc2VkIHNwYW4gaXMgbmV2ZXIgc3VyZmFjZWQuXG4gIGNvbnN0IGlnbm9yZVJ1bGVzID0gbG9hZFJ1bGVzKHJlcG9Sb290KTtcblxuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IHBhcnNlUG9yY2VsYWluKHBvcmNlbGFpblN0ZG91dCk7XG4gIGNvbnN0IGNhbmRpZGF0ZU5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBpZiAocm93LnBhdGggIT09IHJlcG9SZWxQYXRoKSBjb250aW51ZTtcbiAgICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIGNvbnRpbnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICAgIGlmICghcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KSkgY29udGludWU7XG4gICAgaWYgKGlzU3BhblN1cHByZXNzZWQoaWdub3JlUnVsZXMsIHJvdy5wYXRoLCByb3cubmFtZSkpIGNvbnRpbnVlO1xuICAgIGNhbmRpZGF0ZU5hbWVzLmFkZChyb3cubmFtZSk7XG4gIH1cblxuICBpZiAoY2FuZGlkYXRlTmFtZXMuc2l6ZSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU3VidHJhY3QgYWxyZWFkeS1zdXJmYWNlZCBuYW1lc1xuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9TdXJmYWNlID0gWy4uLmNhbmRpZGF0ZU5hbWVzXS5maWx0ZXIoKG4pID0+ICFzdXJmYWNlZC5oYXMobikpLnNvcnQoKTtcbiAgaWYgKHRvU3VyZmFjZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFJlbmRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxuYW1lMT4gPG5hbWUyPiAuLi5cbiAgbGV0IHJlbmRlclN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHJlbmRlclN0ZG91dCA9IGV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAocmVuZGVyKSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE9mIHRoZSBzcGFucyBiZWluZyBzdXJmYWNlZCwgZmxhZyBhbnkgYWxyZWFkeSBkcmlmdGVkIFx1MjAxNCB0aGUgdG91Y2hlZCBsaW5lcyBoYXZlXG4gIC8vIGRyaWZ0ZWQgZnJvbSB0aGVpciBhbmNob3JlZCBzdGF0ZSBcdTIwMTQgd2l0aCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlci5cbiAgLy8gRGV0ZWN0aW9uIGlzIGFzLW9mLW5vdyAoc3VyZmFjaW5nIHJ1bnMgYmVmb3JlIHRoZSBlZGl0IGFwcGxpZXMpLCBzbyB0aGlzXG4gIC8vIGNhdGNoZXMgcHJlLWV4aXN0aW5nIGRyaWZ0OyBkcmlmdCB0aGlzIHNlc3Npb24gY2F1c2VzIGlzIHRoZSBTdG9wIGhvb2sncyBqb2IuXG4gIC8vIEZhaWx1cmUgdG8gY29tcHV0ZSBkcmlmdCBpcyBub24tZmF0YWw6IGZhbGwgYmFjayB0byB0aGUgcGxhaW4gYmxvY2suXG4gIGxldCBkcmlmdEhpbnQgPSAnJztcbiAgdHJ5IHtcbiAgICBjb25zdCBkcmlmdE5hbWVzID0gbmV3IFNldChwYXJzZURyaWZ0UG9yY2VsYWluKGRyaWZ0RXhlY3V0b3IodG9TdXJmYWNlLCByZXBvUm9vdCkpLm1hcCgocikgPT4gci5uYW1lKSk7XG4gICAgY29uc3QgZHJpZnRTdXJmYWNlZCA9IHRvU3VyZmFjZS5maWx0ZXIoKG4pID0+IGRyaWZ0TmFtZXMuaGFzKG4pKTtcbiAgICBpZiAoZHJpZnRTdXJmYWNlZC5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBsaW5lcyA9IGRyaWZ0U3VyZmFjZWQubWFwKChuKSA9PiBgICBnaXQgc3BhbiBoaXN0b3J5ICR7bn1gKS5qb2luKCdcXG4nKTtcbiAgICAgIGRyaWZ0SGludCA9IGBcXG5EcmlmdCBcdTIwMTQgdGhlIGxpbmVzIHlvdSdyZSB0b3VjaGluZyBoYXZlIGRyaWZ0ZWQgZnJvbSB0aGVzZSBzcGFucycgYW5jaG9yZWQgc3RhdGUuIFJldmlldyBob3cgZWFjaCBzdWJzeXN0ZW0gZXZvbHZlZCBiZWZvcmUgY2hhbmdpbmcgaXQ6XFxuJHtsaW5lc31gO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGRyaWZ0IChoaXN0b3J5IGhpbnQpIGZhaWxlZCcsIHsgZXJyIH0pO1xuICB9XG5cbiAgY29uc3Qgd3JhcHBlZCA9IGBcXG48Z2l0LXNwYW4+XFxuJHtyZW5kZXJTdGRvdXR9JHtkcmlmdEhpbnR9XFxuPC9naXQtc3Bhbj5cXG5gO1xuXG4gIC8vIFVwZGF0ZSBtZW1vXG4gIG1lbW8uYWRkU3VyZmFjZWQoc2Vzc2lvbklkLCB0b1N1cmZhY2UpO1xuXG4gIHJldHVybiB3cmFwcGVkO1xufVxuIiwgIi8qKlxuICogUGF0aC1zY29wZWQgc3BhbiBzdXBwcmVzc2lvbiBmb3IgdGhlIGFnZW50IGhvb2tzLlxuICpcbiAqIFNvbWUgc3BhbnMgYXJlIG5vaXNlIHdoZW4gYnJvd3NpbmcgY2VydGFpbiBwYXJ0cyBvZiB0aGUgdHJlZSBcdTIwMTQgd2lraSBvclxuICogbWFya2V0aW5nIHNwYW5zIHRoYXQgYW5jaG9yIHByb3NlLCBzdXJmYWNlZCBpbmxpbmUgd2hpbGUgcmVhZGluZyBzb3VyY2UsXG4gKiBhZGQgbGl0dGxlLiBUaGlzIG1vZHVsZSBsZXRzIGEgcmVwbyBkZWNsYXJlLCBwZXIgcGF0aCwgd2hpY2ggc3BhbiBzbHVnXG4gKiBwcmVmaXhlcyB0byBob2xkIGJhY2suXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5ob29raWdub3JlYC4gRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGFcbiAqIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4sIGEgc2luZ2xlIHJ1biBvZiB3aGl0ZXNwYWNlLCB0aGVuIGFcbiAqIGNvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHNwYW4gc2x1ZyBwcmVmaXhlcyB0byBzdXBwcmVzcyBmb3IgcGF0aHMgdGhlIHBhdHRlcm5cbiAqIG1hdGNoZXM6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMgd2lraSxtYXJrZXRpbmdcbiAqXG4gKiBBIHNwYW4gd2hvc2Ugc2x1ZyBiZWdpbnMgd2l0aCBgd2lraWAgb3IgYG1hcmtldGluZ2AgKHRoZSBzbHVnIGVxdWFscyB0aGVcbiAqIHByZWZpeCwgb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmApIGlzIHRoZW4gbmV2ZXIgc3VyZmFjZWQgZm9yIGFuIGFuY2hvciB3aG9zZSBwYXRoXG4gKiBzaXRzIHVuZGVyIGBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmNgIFx1MjAxNCBpdCBpcyBuZXZlciBzdXJmYWNlZCBpbiB0aGUgaW5saW5lXG4gKiBgPGdpdC1zcGFuPmAgYmxvY2sgdGhlIGBQb3N0VG9vbFVzZWAgdG91Y2ggaG9vayBlbWl0cy4gSXQgaGFzIG5vIGVmZmVjdCBvblxuICogdGhlIGBQcmVUb29sVXNlYCBhZHZpc29yLCB3aG9zZSBvd24gdW5jb3ZlcmVkLXdyaXRlcyBzdXBwcmVzc2lvbiBsaXZlcyBpblxuICogYC5zcGFuLy5hZHZpc29yaWdub3JlYCAoc2VlIGBhZHZpc29yLWlnbm9yZS50c2ApLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmFkdmlzb3JpZ25vcmVgXG4gKiBpbiBgYWR2aXNvci1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIEhhcm5lc3MtYWdub3N0aWMgdG91Y2gtaG9vayBjb3JlLlxuICpcbiAqIFRoaXMgbW9kdWxlIGltcGxlbWVudHMgdGhlIFBvc3RUb29sVXNlIFwidG91Y2ggc2lnbmFsXCIgdGhhdCBib3RoIHRoZSBDbGF1ZGVcbiAqIChgUmVhZHxFZGl0fFdyaXRlYCkgYW5kIENvZGV4IChgYXBwbHlfcGF0Y2hgKSBhZGFwdGVycyBkcml2ZS4gSXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICoge0BsaW5rIFRvdWNoSW5wdXR9LCBpbmplY3QgZXhlY3V0aW9uL3N0YXRlIGRlcGVuZGVuY2llcywgYW5kIHdyYXAgdGhlIHJldHVybmVkXG4gKiB7QGxpbmsgVG91Y2hPdXRwdXR9IGluIHRoZWlyIG93biBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBSZXVzZWQgZnJvbSB0aGUgc2hhcmVkIGtlcm5lbCAobm90IHJlZGVmaW5lZCk6IGBpc0RlYnQoKWAgK1xuICogYFBvcmNlbGFpblN0YXR1c2AvYERyaWZ0UG9yY2VsYWluUm93YC9gUG9yY2VsYWluUm93YC9gcGFyc2VQb3JjZWxhaW5gL1xuICogYHBhcnNlRHJpZnRQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpLCBgcmFuZ2VzSW50ZXJzZWN0YCBhbmQgdGhlXG4gKiByZXBvL3NwYW4tcm9vdCBwYXRoIHV0aWxpdGllcyAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYW5kIHRoZSBgTWVtb1N0b3JlYFxuICogY2FkZW5jZSBzdG9yZSAoc3Bhbi1zdXJmYWNlLnRzKS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSwgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICB0eXBlIERyaWZ0UG9yY2VsYWluUm93LFxuICBodW1hblN0YXR1c0xhYmVsLFxuICBpc0RlYnQsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgdHlwZSBQb3JjZWxhaW5TdGF0dXMsXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBjb2xsYXBzZUJ5UGF0aCwgdHlwZSBSYW5nZUxhYmVsLCByZW5kZXJBbmNob3JUcmVlIH0gZnJvbSAnLi9hbmNob3ItdHJlZS5qcyc7XG5pbXBvcnQgdHlwZSB7IE1lbW9TdG9yZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LWVkaXQgcmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNwbGl0IHdyaXR0ZW4gY29udGVudCBpbnRvIHRoZSBsaW5lcyB0byBsb2NhdGUgb24gZGlzay4gQSBzaW5nbGUgdHJhaWxpbmdcbiAqIG5ld2xpbmUgaXMgZHJvcHBlZCBzbyBgXCJhXFxuYlxcblwiYCBhbmQgYFwiYVxcbmJcImAgbG9jYXRlIGlkZW50aWNhbGx5OyBhbiBlbXB0eVxuICogKG9yIG5ld2xpbmUtb25seSkgd3JpdGUgaGFzIG5vIGxvY2F0YWJsZSBibG9jay5cbiAqL1xuZnVuY3Rpb24gdG9OZWVkbGVMaW5lcyh3cml0dGVuOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCB0cmltbWVkID0gd3JpdHRlbi5lbmRzV2l0aCgnXFxuJykgPyB3cml0dGVuLnNsaWNlKDAsIC0xKSA6IHdyaXR0ZW47XG4gIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICByZXR1cm4gdHJpbW1lZC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgbGluZSByYW5nZSB0aGF0IHdyaXR0ZW4gY29udGVudCBub3cgb2NjdXBpZXMgaW4gdGhlIG9uLWRpc2sgZmlsZSxcbiAqIGZvciBhbmNob3JpbmcgdGhlIHRvdWNoZWQgcmVnaW9uIGFmdGVyIGFuIGVkaXQgaGFzIGFscmVhZHkgYXBwbGllZC5cbiAqXG4gKiBUaGlzIGdlbmVyYWxpemVzIHRoZSBwcmUtZWRpdCBgbG9jYXRlQ2h1bmsoKWAgdGVjaG5pcXVlIGluXG4gKiBbYXBwbHktcGF0Y2gudHNdKC4vcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjL2NvZGV4L2FwcGx5LXBhdGNoLnRzI0wyNTMtTDI4NilcbiAqIChwcmV2aW91c2x5IENvZGV4LW9ubHkpIGludG8gYSBzaGFyZWQgcG9zdC1lZGl0IHByaW1pdGl2ZSBib3RoIGhhcm5lc3NlcyB1c2U6XG4gKiBzcGxpdCBgd3JpdHRlbmAgYW5kIGBvbkRpc2tDb250ZW50YCBpbnRvIGxpbmVzIGFuZCBsb2NhdGUgdGhlIHdyaXR0ZW4gYmxvY2sgYXNcbiAqIGEgY29udGlndW91cyBydW4gaW5zaWRlIHRoZSBvbi1kaXNrIGxpbmVzLlxuICpcbiAqIC0gQSBzaW5nbGUgY29udGlndW91cyBtYXRjaCB5aWVsZHMgaXRzIDEtYmFzZWQgaW5jbHVzaXZlIHtAbGluayBMaW5lUmFuZ2V9LlxuICogLSBXaGVuIHRoZSBibG9jayBpcyBhYnNlbnQsIG9yIGFwcGVhcnMgbW9yZSB0aGFuIG9uY2UgKGNvbnRleHQgdG8gZGlzYW1iaWd1YXRlXG4gKiAgIGlzIG5vdCBhdmFpbGFibGUgcG9zdC1lZGl0KSwgcmVjb3ZlcnkgaXMgYW1iaWd1b3VzIGFuZCB0aGUgcmVzdWx0IGRlZ3JhZGVzXG4gKiAgIHRvIGAnd2hvbGUtZmlsZSdgICh0aGUgc2FtZSBmYWxsYmFjayBgbG9jYXRlQ2h1bmsoKWAgc2lnbmFscyB3aXRoIGBudWxsYCkuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhbiB1bmxvY2F0YWJsZSB3cml0ZSBpcyBhIGAnd2hvbGUtZmlsZSdgIGFuc3dlciwgbm90IGFuIGVycm9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3ZlclJhbmdlKHdyaXR0ZW46IHN0cmluZywgb25EaXNrQ29udGVudDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgY29uc3QgbmVlZGxlID0gdG9OZWVkbGVMaW5lcyh3cml0dGVuKTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG5cbiAgY29uc3QgaGF5c3RhY2sgPSBvbkRpc2tDb250ZW50LnNwbGl0KCdcXG4nKTtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGNvbnN0IHN0YXJ0czogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbGFzdDsgaSsrKSB7XG4gICAgbGV0IG9rID0gdHJ1ZTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IG5lZWRsZS5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGhheXN0YWNrW2kgKyBqXSAhPT0gbmVlZGxlW2pdKSB7XG4gICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob2spIHtcbiAgICAgIHN0YXJ0cy5wdXNoKGkpO1xuICAgICAgaWYgKHN0YXJ0cy5sZW5ndGggPiAxKSBicmVhazsgLy8gZHVwbGljYXRlZCBcdTIxOTIgYW1iaWd1b3VzLCBzdG9wIGVhcmx5XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4geyBzdGFydDogc3RhcnRzWzBdICsgMSwgZW5kOiBzdGFydHNbMF0gKyBuZWVkbGUubGVuZ3RoIH07XG4gIH1cbiAgcmV0dXJuICd3aG9sZS1maWxlJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBpbnB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogV2hpY2ggaGFybmVzcyBldmVudCBmaXJlZCwgYXMgdGhlIHRvdWNoIGNvcmUgc2VlcyBpdC4gVGhlIGNvcmUgYnJhbmNoZXMgb25cbiAqIHRoaXM6IGB3cml0ZWAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlIGFuZCBtYXkgc3VyZmFjZSBhXG4gKiBtZXJnZWQgYmxvY2s7IGByZWFkYCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlIGFuZCBmaWx0ZXJzIHBvc2l0aW9uYWwgc3RhdHVzZXNcbiAqIG91dCBvZiB3aGF0IGl0IHN1cmZhY2VzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEV2ZW50S2luZCA9ICdyZWFkJyB8ICd3cml0ZSc7XG5cbi8qKiBGaWVsZHMgc2hhcmVkIGJ5IGV2ZXJ5IHRvdWNoLCByZWdhcmRsZXNzIG9mIGtpbmQuICovXG5pbnRlcmZhY2UgVG91Y2hJbnB1dEJhc2Uge1xuICAvKiogSGFybmVzcyBzZXNzaW9uIGlkIFx1MjAxNCBrZXlzIHRoZSBwZXItc2Vzc2lvbiBjYWRlbmNlIHtAbGluayBNZW1vU3RvcmV9LiAqL1xuICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFdvcmtpbmcgZGlyZWN0b3J5IHRoZSB0b29sIHJhbiBpbiwgdXNlZCB0byBib3VuZCB0aGUgdG91Y2ggdG8gdGhlIENXRCByZXBvXG4gICAqIHZpYSBgcmVzb2x2ZVRvdWNoU2NvcGUoKWAgYmVmb3JlIGFueSBzcGFuIGludm9jYXRpb24uXG4gICAqL1xuICBjd2Q6IHN0cmluZztcbiAgLyoqIEFic29sdXRlLCBjYW5vbmljYWxpemVkIHBhdGggb2YgdGhlIHRvdWNoZWQgZmlsZS4gKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbn1cblxuLyoqIEEgcmVhZCB0b3VjaCAoQ2xhdWRlIGBSZWFkYCwgb3IgYSByZWFkLXNoYXBlZCBDb2RleCBldmVudCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoUmVhZElucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAncmVhZCc7XG4gIC8qKlxuICAgKiAxLWJhc2VkIHN0YXJ0aW5nIGxpbmUgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBvZmZzZXRgXG4gICAqIGlucHV0LiBgdW5kZWZpbmVkYCB3aGVuIHRoZSByZWFkIGhhZCBubyBgb2Zmc2V0YCAocmVhZHMgZnJvbSBsaW5lIDEpLlxuICAgKi9cbiAgb2Zmc2V0PzogbnVtYmVyO1xuICAvKipcbiAgICogTGluZSBjb3VudCBvZiB0aGUgcmVhZCwgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgYGxpbWl0YCBpbnB1dC5cbiAgICogYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYGxpbWl0YCBcdTIwMTQgc2VlIHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9XG4gICAqIGZvciBob3cgdGhlIHJhbmdlIGlzIGNvbXB1dGVkIGluIHRoYXQgY2FzZS5cbiAgICovXG4gIGxpbWl0PzogbnVtYmVyO1xufVxuXG4vKiogQSB3cml0ZSB0b3VjaCAoQ2xhdWRlIGBFZGl0YC9gV3JpdGVgLCBDb2RleCBgYXBwbHlfcGF0Y2hgLCBvciBhIHRyYW5zbGF0ZWQgQmFzaCB3cml0ZSBzcGFuKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hXcml0ZUlucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAnd3JpdGUnO1xuICAvKipcbiAgICogVGhlIGNvbnRlbnQganVzdCB3cml0dGVuIHRvIGBmaWxlUGF0aGAsIGZlZCB0byB7QGxpbmsgcmVjb3ZlclJhbmdlfSB0b1xuICAgKiByZS1hbmNob3IgdGhlIHRvdWNoZWQgcmVnaW9uIGFnYWluc3QgdGhlIGhlYWxlZCBvbi1kaXNrIGZpbGUuIEZvciBhXG4gICAqIHdob2xlLWZpbGUgY3JlYXRlIHRoaXMgaXMgdGhlIGVudGlyZSBmaWxlIGJvZHk7IGFuIGVtcHR5IHN0cmluZyBtZWFuc1xuICAgKiBcIm5vIGxvY2F0YWJsZSBibG9ja1wiIGFuZCB0aGUgdG91Y2ggaXMgc2NvcGVkIGZpbGUtd2lkZS5cbiAgICovXG4gIHdyaXR0ZW46IHN0cmluZztcbiAgLyoqXG4gICAqIEV4YWN0IHBvc3QtZWRpdCByYW5nZSB3aGVuIHN0YXRpY2FsbHkga25vd24gKHNlZCAtaSBudW1lcmljIGFkZHJlc3NlcyxcbiAgICogcGF0Y2ggaHVuayB1bmlvbnMpOyBieXBhc3NlcyB7QGxpbmsgcmVjb3ZlclJhbmdlRnJvbURpc2t9IChwbGFuIFx1MDBBNzNcbiAgICogc3RlcCAzKS5cbiAgICovXG4gIHJhbmdlPzogTGluZVJhbmdlO1xuICAvKipcbiAgICogVGhlIGZpbGUncyBleHBlY3RlZCBwb3N0LWNvbW1hbmQgc3RhdGU7IHRoZSB3cml0ZSBwYXRoIGdhdGVzIG9uIGl0IGJlZm9yZVxuICAgKiBpbnZva2luZyBhbnkgZXhlY3V0b3IgKHBsYW4gXHUwMEE3MyBzdGVwIDEpLiBBYnNlbnQgbWVhbnMgYCdleGlzdHMnYCBcdTIwMTQgdGhlXG4gICAqIEVkaXQvV3JpdGUgYW5kIGFwcGx5X3BhdGNoIHBhdGhzJyBkZWZhdWx0LlxuICAgKi9cbiAgdGFyZ2V0U3RhdGU/OiAnZXhpc3RzJyB8ICdhYnNlbnQnO1xuICAvKipcbiAgICogU3RhdGljYWxseSBrbm93YWJsZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQsIHZlcmlmaWVkIGJlZm9yZSBhbnkgZXhlY3V0b3JcbiAgICogY2FsbCAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBgY29udGVudGAgY29tcGFyZXMgdGhlIG9uLWRpc2sgc3RhdGUgYWZ0ZXIgdGhlXG4gICAqIGNvbW1hbmQgcmFuOyBgcmVhbERlbGV0ZWAgaXMgZGVsZXRlLW9ubHkgXHUyMDE0IHRoZSBwYXRoIG11c3QgYWxzbyBiZVxuICAgKiBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQgKHByb2JlcyBjYWNoZWQgcGVyIGNvbW1hbmQpLlxuICAgKi9cbiAgcG9zdFN0YXRlPzoge1xuICAgIC8qKiBgZXhhY3RgOiBmaWxlIGJ5dGVzIGVxdWFsOyBgc3VmZml4YDogZmlsZSBjb250ZW50IGVuZHMgd2l0aCBpdDsgYGVtcHR5YDogemVybyBieXRlczsgYHNpemVgOiBieXRlIGNvdW50LiAqL1xuICAgIGNvbnRlbnQ/OiBUb3VjaFBvc3RDb250ZW50O1xuICAgIC8qKiBkZWxldGUtb25seTogdGhlIHBhdGggbXVzdCBhbHNvIGJlIGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCAocHJvYmVzIGNhY2hlZCBwZXIgY29tbWFuZCkuICovXG4gICAgcmVhbERlbGV0ZT86IGJvb2xlYW47XG4gIH07XG4gIC8qKlxuICAgKiBjcC9pbnN0YWxsIGRlc3RpbmF0aW9uLXZzLXNvdXJjZSB2ZXJpZmljYXRpb24gKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogYVxuICAgKiBzdGlsbC1wcmVzZW50IHNvdXJjZSBtdXN0IGJ5dGUtZXF1YWwgdGhlIGRlc3RpbmF0aW9uOyBhbiBhYnNlbnQgc291cmNlXG4gICAqIGFwcGxpZXMgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocmVhbCArIGFic2VuY2UgZXhwbGFpbmVkIGJ5IGEgbGF0ZXJcbiAgICogc2FtZS1wYXRoIGRlY2lzaXZlUGFzcyBcdTIwMTQgdGhlIGRyaXZlcidzIHBhc3MtQSBob2xkKS4gU2V0IGJ5IHRoZVxuICAgKiBgcnVuQmFzaFRvdWNoZXNgIGRyaXZlciBvbiBwYWlyZWQgY3AgY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaGVzOyBuZXZlciBzZXRcbiAgICogYnkgYWRhcHRlcnMuIGBpbnN0YWxsIC1zYC9gLS1zdHJpcGAgaXMgZGVsaWJlcmF0ZWx5IG5ldmVyIHBhaXJlZCBcdTIwMTRcbiAgICogc3RyaXBwZWQgb3V0cHV0IG5ldmVyIGVxdWFscyB0aGUgc291cmNlLCBzbyBpbnN0YWxsIGRlc3RzIGdhdGVcbiAgICogZXhpc3RlbmNlLW9ubHkuXG4gICAqL1xuICBzb3VyY2VQYXRoPzogc3RyaW5nO1xuICAvKipcbiAgICogbXYvZ2l0IG12L3BhdGNoIHJlbmFtZSBzb3VyY2UgdmVyaWZpY2F0aW9uIChwbGFuIFx1MDBBNzMgc3RlcCAxYyk6IHRoZVxuICAgKiBkZXN0aW5hdGlvbiBmaXJlcyBvbmx5IHdoZW4gaXRzIHNvdXJjZSBwYXNzZWQgdGhlIGRlbGV0ZS1yZWFsaXR5IHByb2JlIFx1MjAxNFxuICAgKiBhIHBoYW50b20gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCBhbmQgYSBwcmUtZXhpc3RpbmcgZGVzdGluYXRpb24gd2FzXG4gICAqIG5ldmVyIHRvdWNoZWQuIE5vIGNvbnRlbnQgY29tcGFyaXNvbiAocGF0Y2ggcmVuYW1lcyBtYXkgY2hhbmdlIGNvbnRlbnQpLlxuICAgKiBTZXQgYnkgdGhlIGBydW5CYXNoVG91Y2hlc2AgZHJpdmVyIG9uIHBhaXJlZCByZW5hbWUtY29weSB0b3VjaGVzLlxuICAgKi9cbiAgcmVuYW1lU291cmNlUGF0aD86IHN0cmluZztcbn1cblxuLyoqIFRoZSBoYXJuZXNzLWFnbm9zdGljIHRvdWNoIHRoZSBjb3JlIGNvbnN1bWVzLiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hJbnB1dCA9IFRvdWNoUmVhZElucHV0IHwgVG91Y2hXcml0ZUlucHV0O1xuXG4vKipcbiAqIEEgc3RhdGljYWxseSBrbm93YWJsZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogYGV4YWN0YCBcdTIwMTRcbiAqIGZpbGUgYnl0ZXMgZXF1YWw7IGBzdWZmaXhgIFx1MjAxNCBmaWxlIGNvbnRlbnQgZW5kcyB3aXRoIGl0OyBgZW1wdHlgIFx1MjAxNCB6ZXJvXG4gKiBieXRlczsgYHNpemVgIFx1MjAxNCBieXRlIGNvdW50LlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFBvc3RDb250ZW50ID0geyBleGFjdDogc3RyaW5nIH0gfCB7IHN1ZmZpeDogc3RyaW5nIH0gfCB7IGVtcHR5OiB0cnVlIH0gfCB7IHNpemU6IG51bWJlciB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvc3Qtc3RhdGUgd3JpdGUgZ2F0ZSAocGxhbiBcdTAwQTczIHN0ZXAgMSlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBvdXRjb21lIG9mIHtAbGluayBldmFsdWF0ZVdyaXRlR2F0ZX06IGEgZGVjaXNpdmUgcGFzcy9mYWlsIGNhcnJpZXNcbiAqIHZlcmRpY3Qgd2VpZ2h0IChjb250ZW50IHZlcmlmaWVkLCBvciBhYnNlbmNlICsgZGVsZXRlLXJlYWxpdHkgdmVyaWZpZWQpO1xuICogYCdpbmNvbmNsdXNpdmUnYCBpcyBldmVyeXRoaW5nIGVsc2UgXHUyMDE0IHRoZSBleGlzdGVuY2UtZ2F0ZWQgZmFtaWxpZXMgKHNlZCAtaSxcbiAqIHBhdGNoL2dpdCBhcHBseSwgZm9ybWF0dGVycywgcmVzdG9yZS9jaGVja291dCkgd2hvc2UgZXhpc3RlbmNlIHBhc3MgcHJvdmVzXG4gKiBub3RoaW5nLCBhbmQgcHJvYmUtaW5hcHBsaWNhYmxlIGNhc2VzIChwaGFudG9tIG9yIHVudHJhY2tlZC11bnNwYW5uZWRcbiAqIGRlbGV0ZXMsIGRpcmVjdG9yeSB0YXJnZXRzKS4gYCdwZW5kaW5nJ2AgaXMgdGhlIGRyaXZlcidzIGFic2VudC1zb3VyY2UgaG9sZFxuICogKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBhbiBhYnNlbnQgY3Agc291cmNlIHRoYXQgcGFzc2VkIHRoZSByZWFsaXR5IHByb2JlIGNhbm5vdFxuICogZGVjaWRlIGl0cyBkZXN0aW5hdGlvbiB1bnRpbCB0aGUgcGFzcy1BIGV4cGxhbmF0aW9uIG1hcCBpcyBjb21wbGV0ZS5cbiAqL1xuZXhwb3J0IHR5cGUgV3JpdGVHYXRlT3V0Y29tZSA9ICdkZWNpc2l2ZVBhc3MnIHwgJ2RlY2lzaXZlRmFpbCcgfCAnaW5jb25jbHVzaXZlJyB8ICdwZW5kaW5nJztcblxuLyoqXG4gKiBQZXItY29tbWFuZCByZWFsaXR5IHByb2JlIGNhY2hlIChwbGFuIFx1MDBBNzMgc3RlcCAxYywgcm91bmQtMyk6IHR3byBsYXp5LFxuICogYmF0Y2hlZCBwcm9iZXMgXHUyMDE0IG9uZSBgZ2l0IGxzLWZpbGVzIC0tZXJyb3ItdW5tYXRjaGAgKyBgZ2l0IHNwYW4gbGlzdFxuICogLS1wb3JjZWxhaW5gIHBhaXIgZm9yIHRoZSBkZWxldGUtcmVhbGl0eSBtZW1iZXJzaGlwLCBhbmQgb25lIGBnaXQgc3RhdHVzXG4gKiAtLXBvcmNlbGFpbmAgYmF0Y2ggZm9yIHRoZSB3b3JraW5nLXRyZWUtdnMtaW5kZXggbWFyayBcdTIwMTQgbmV2ZXIgb25lXG4gKiBzdWJwcm9jZXNzIHBlciBwYXRoLCBtZW1iZXJzaGlwIGZyb20gcHJpbnRlZCByb3dzLiBUaGUgYHJ1bkJhc2hUb3VjaGVzYFxuICogZHJpdmVyIHNlZWRzIHRoZSBkZWxldGUtcmVhbGl0eSBoYWxmIHdpdGggZXZlcnkgYWJzZW50IHRhcmdldCBhbmRcbiAqIGNwL2luc3RhbGwgc291cmNlIG9mIHRoZSBjb21wb3VuZCBhbmQgdGhlIHN0YXR1cyBoYWxmIHdpdGggdGhlXG4gKiBsYXRlci1yZWNyZWF0ZSBleHBsYW5hdGlvbidzIGNhbmRpZGF0ZSBwYXRocywgYW5kIHNoYXJlcyB0aGUgY2FjaGUgaW50b1xuICogcGFzcyBCIHNvIHN1cnZpdmluZyBkZWxldGVzIHJlLWdhdGUgd2l0aG91dCByZS1wcm9iaW5nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlYWxpdHlQcm9iZUNhY2hlIHtcbiAgLyoqIERpc3RpbmN0IGFic29sdXRlIHBhdGhzIHRvIHByb2JlLCBpbiBmaXJzdC1zZWVuIG9yZGVyLiAqL1xuICBwYXRoczogc3RyaW5nW107XG4gIC8qKiBMYXp5OiBhYnNvbHV0ZSBwYXRocyBjb25maXJtZWQgaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkLCBjb21wdXRlZCBvbmNlLiAqL1xuICByZWFsUGF0aHM6IFNldDxzdHJpbmc+IHwgbnVsbDtcbiAgLyoqXG4gICAqIFRoZSBsYXRlci1yZWNyZWF0ZSBleHBsYW5hdGlvbidzIHByb2JlIHNjb3BlIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogZGlzdGluY3RcbiAgICogZGVsZXRlIHBhdGhzIGEgbGF0ZXIgY29tbWFuZCBvZiB0aGUgY29tcG91bmQgY2FuIHJlLWNyZWF0ZSB3aXRoIGFcbiAgICogZmlsZS1wcm9kdWNpbmcgd3JpdGUsIGluIGZpcnN0LXNlZW4gb3JkZXIuXG4gICAqL1xuICBjaGFuZ2VkQ2FuZGlkYXRlczogc3RyaW5nW107XG4gIC8qKiBMYXp5OiBjYW5kaWRhdGVzIHdob3NlIHRyYWNrZWQgd29ya2luZy10cmVlIGNvbnRlbnQgZGlmZmVycyBmcm9tIHRoZSBpbmRleCwgY29tcHV0ZWQgb25jZS4gKi9cbiAgY2hhbmdlZFBhdGhzOiBTZXQ8c3RyaW5nPiB8IG51bGw7XG59XG5cbi8qKiBDcmVhdGUgYSBwZXItY29tbWFuZCBwcm9iZSBjYWNoZSBmb3IgdGhlIGdpdmVuIGFic29sdXRlIHBhdGhzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlKFxuICBwYXRoczogSXRlcmFibGU8c3RyaW5nPixcbiAgY2hhbmdlZENhbmRpZGF0ZXM6IEl0ZXJhYmxlPHN0cmluZz4gPSBbXVxuKTogUmVhbGl0eVByb2JlQ2FjaGUge1xuICByZXR1cm4ge1xuICAgIHBhdGhzOiBbLi4ubmV3IFNldChwYXRocyldLFxuICAgIHJlYWxQYXRoczogbnVsbCxcbiAgICBjaGFuZ2VkQ2FuZGlkYXRlczogWy4uLm5ldyBTZXQoY2hhbmdlZENhbmRpZGF0ZXMpXSxcbiAgICBjaGFuZ2VkUGF0aHM6IG51bGxcbiAgfTtcbn1cblxuLyoqIFdoZXRoZXIgdGhlIHBhdGggZXhpc3RzIG9uIGRpc2sgKGFueSBub2RlIGtpbmQpOyBgZmFsc2VgIG9uIGFueSBzdGF0IGZhaWx1cmUuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsZUV4aXN0cyhhYnNQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBmcy5zdGF0U3luYyhhYnNQYXRoKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKiBXaGV0aGVyIHRoZSBwYXRoIGlzIGEgcmVndWxhciBmaWxlIFx1MjAxNCBhIGRpcmVjdG9yeSB0YXJnZXQgZmFpbHMgdGhlIGAnZXhpc3RzJ2AgZ2F0ZS4gKi9cbmZ1bmN0aW9uIGlzRmlsZU9uRGlzayhhYnNQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZnMuc3RhdFN5bmMoYWJzUGF0aCkuaXNGaWxlKCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFZlcmlmeSBhIHN0YXRpY2FsbHkga25vd2FibGUgcG9zdC1jb250ZW50IGV4cGVjdGF0aW9uIGFnYWluc3QgdGhlIG9uLWRpc2tcbiAqIGZpbGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gQW55IHJlYWQgZmFpbHVyZSBpcyBhIG1pc21hdGNoLCBuZXZlciBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gY29udGVudE1hdGNoZXMocG9zdDogVG91Y2hQb3N0Q29udGVudCwgZmlsZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGlmICgnZXhhY3QnIGluIHBvc3QpIHJldHVybiBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4JykgPT09IHBvc3QuZXhhY3Q7XG4gICAgaWYgKCdzdWZmaXgnIGluIHBvc3QpIHtcbiAgICAgIC8vIFRoZSBzaGVsbCBhcHBlbmRzIHRoZSBib2R5IHBsdXMgaXRzIHRlcm1pbmF0aW5nIG5ld2xpbmU7IHRoZSBoZXJlZG9jXG4gICAgICAvLyBncmFtbWFyIHN0cmlwcyBleGFjdGx5IHRoYXQgb25lIGBcXG5gIGZyb20gYHNwYW4ud3JpdHRlbmBcbiAgICAgIC8vIChwYXJzZS1jb21tYW5kLnRzIGhlcmVkb2MgYm9keSBleHRyYWN0aW9uKSwgc28gYSBmaWxlIGVuZGluZ1xuICAgICAgLy8gYHdyaXR0ZW5cXG5gIGlzIHRoZSBzYW1lIGFwcGVuZGVkIHRleHQgYXMgYHdyaXR0ZW5gIFx1MjAxNCBhY2NlcHQgYm90aC5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICByZXR1cm4gY29udGVudC5lbmRzV2l0aChwb3N0LnN1ZmZpeCkgfHwgY29udGVudC5lbmRzV2l0aChgJHtwb3N0LnN1ZmZpeH1cXG5gKTtcbiAgICB9XG4gICAgaWYgKCdlbXB0eScgaW4gcG9zdCkgcmV0dXJuIGZzLnN0YXRTeW5jKGZpbGVQYXRoKS5zaXplID09PSAwO1xuICAgIHJldHVybiBmcy5zdGF0U3luYyhmaWxlUGF0aCkuc2l6ZSA9PT0gcG9zdC5zaXplO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgZGVsZXRlLXJlYWxpdHkgcHJvYmUgKHBsYW4gXHUwMEE3MyBzdGVwIDFjKTogbGF6aWx5IHJ1biB0aGUgdHdvIHBlci1jb21tYW5kXG4gKiBiYXRjaGVzIGFuZCBjYWNoZSB0aGUgY29uZmlybWVkLXJlYWwgcGF0aCBzZXQuIE1lbWJlcnNoaXAgY29tZXMgZnJvbSB0aGVcbiAqIHByaW50ZWQgcm93cywgbm90IHRoZSBleGl0IGNvZGUgXHUyMDE0IGBnaXQgbHMtZmlsZXMgLS1lcnJvci11bm1hdGNoYCBwcmludHNcbiAqIGV2ZXJ5IHRyYWNrZWQgcGF0aCBldmVuIHdoZW4gaXQgZXhpdHMgbm9uemVybyAoYW55IG1pc3NpbmcgcGF0aCksIGFuZFxuICogYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW5gIHByaW50cyBub3RoaW5nIGZvciBwaGFudG9tIG9yIGtub3duLWJ1dC1cbiAqIHVuc3Bhbm5lZCBwYXRocyAoZXhpdCAwIHdpdGggXCJObyBzcGFucyBtYXRjaCB0aGUgZmlsdGVyc1wiKS4gQSBwbGFpbi1gcm1gJ2RcbiAqIHRyYWNrZWQgZmlsZSBrZWVwcyBpdHMgaW5kZXggZW50cnkgKGxzLWZpbGVzIGV4aXQgMCBcdTIwMTQgdGhlIHByb2JlIGZpcmVzKTtcbiAqIGBnaXQgcm1gIHJlbW92ZXMgaXQgKGxzLWZpbGVzIDEyOCkgc28gb25seSBzcGFubmVkIGZpbGVzIHN0YXkgcmVhbC4gQVxuICogcGhhbnRvbSBvciB1bnRyYWNrZWQtdW5zcGFubmVkIHBhdGggZmFpbHMgYm90aCBwcm9iZXMgXHUyMDE0IHRoZSBkZWxldGUgZGVncmFkZXNcbiAqIHRvIGAnaW5jb25jbHVzaXZlJ2AgYW5kIG5ldmVyIGZpcmVzLiBGYWlsLXNhZmU6IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yIGFcbiAqIHByb2JlIGZhaWx1cmUgeWllbGRzIGFuIGVtcHR5IHNldCwgbmV2ZXIgYW4gZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHJlYWxQYXRocyhjYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUsIGN3ZDogc3RyaW5nKTogU2V0PHN0cmluZz4ge1xuICBpZiAoY2FjaGUucmVhbFBhdGhzICE9PSBudWxsKSByZXR1cm4gY2FjaGUucmVhbFBhdGhzO1xuICBjb25zdCByZWFsID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGlmIChjYWNoZS5wYXRocy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICBpZiAocmVwb1Jvb3QgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IHJlbHMgPSBjYWNoZS5wYXRocy5tYXAoKHApID0+IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBwKSk7XG4gICAgICBjb25zdCBjYXB0dXJlID0gKGFyZ3M6IHN0cmluZ1tdKTogc3RyaW5nIHwgbnVsbCA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgYXJncywge1xuICAgICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgY29uc3Qgc3Rkb3V0ID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgICAgcmV0dXJuIHR5cGVvZiBzdGRvdXQgPT09ICdzdHJpbmcnID8gc3Rkb3V0IDogbnVsbDtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGNvbnN0IGxzRmlsZXMgPSBjYXB0dXJlKFsnbHMtZmlsZXMnLCAnLS1lcnJvci11bm1hdGNoJywgJy0tJywgLi4ucmVsc10pO1xuICAgICAgaWYgKGxzRmlsZXMgIT09IG51bGwpIHtcbiAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxzRmlsZXMuc3BsaXQoJ1xcbicpKSB7XG4gICAgICAgICAgY29uc3QgcmVsID0gbGluZS50cmltKCk7XG4gICAgICAgICAgaWYgKHJlbC5sZW5ndGggPiAwKSByZWFsLmFkZChqb2luKHJlcG9Sb290LCByZWwpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3Qgc3Bhbkxpc3QgPSBjYXB0dXJlKFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgLi4ucmVsc10pO1xuICAgICAgaWYgKHNwYW5MaXN0ICE9PSBudWxsKSB7XG4gICAgICAgIGZvciAoY29uc3Qgcm93IG9mIHBhcnNlUG9yY2VsYWluKHNwYW5MaXN0KSkgcmVhbC5hZGQoam9pbihyZXBvUm9vdCwgcm93LnBhdGgpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgY2FjaGUucmVhbFBhdGhzID0gcmVhbDtcbiAgcmV0dXJuIHJlYWw7XG59XG5cbi8qKlxuICogVGhlIHdvcmtpbmctdHJlZS12cy1pbmRleCBwcm9iZSAocGxhbiBcdTAwQTczIHN0ZXAgMiwgcm91bmQtMyk6IGxhemlseSBydW4gb25lXG4gKiBgZ2l0IHN0YXR1cyAtLXBvcmNlbGFpbiAtemAgYmF0Y2ggb3ZlciB0aGUgc2VlZGVkIGNhbmRpZGF0ZXMgYW5kIGNhY2hlIHRoZVxuICogc2V0IHdob3NlIHRyYWNrZWQgd29ya2luZy10cmVlIGNvbnRlbnQgZGlmZmVycyBmcm9tIHRoZSBpbmRleCBcdTIwMTQgdGhlXG4gKiByZS1jcmVhdGUncyBtYXJrLiBUaGUgZHJpdmVyIGNvbnN1bHRzIGl0IGJlZm9yZSBleHBsYWluaW5nIGEgZGVsZXRlJ3NcbiAqIGRlY2lzaXZlRmFpbCAoXCJmaWxlIHByZXNlbnQsIHNvIHRoZSBkZWxldGUgZGlkbid0IGhhcHBlblwiKSBieSBhIGxhdGVyXG4gKiBzYW1lLXBhdGggd3JpdGU6IGFuIGVuZC1zdGF0ZS1wcmVzZW50IGZpbGUgdGhhdCBzdGlsbCBtYXRjaGVzIHRoZSBpbmRleCBpc1xuICogYSBmYWlsZWQgcm0gKHRoZSBgJiZgIGNoYWluIHNob3J0LWNpcmN1aXRlZCBiZWZvcmUgdGhlIHdyaXRlIHJhbiksIG5vdCBhXG4gKiByZS1jcmVhdGUuIFRoZSBZICh3b3JrdHJlZSkgc3RhdHVzIGNvbHVtbiBkZWNpZGVzIFx1MjAxNCBhIHJvdyB3aG9zZSBpbmRleFxuICogY29sdW1uIGFsb25lIGRpZmZlcnMgKGBBIGAgZm9yIGFuIGFkZGVkLWJ1dC11bmNvbW1pdHRlZCBmaWxlIHdob3NlXG4gKiB3b3JraW5nIHRyZWUgbWF0Y2hlcyB0aGUgaW5kZXgpIGlzIG5vIHJlLWNyZWF0ZSwgb25seSBhIG5vbi1zcGFjZSBZIGNvbHVtblxuICogKGAgTWAsIGBNTWAsIGBBTWApIHByb3ZlcyB0aGUgd29ya2luZy10cmVlIGNvbnRlbnQgZGlmZmVycyBmcm9tIHRoZSBpbmRleC5cbiAqIGAtLXVudHJhY2tlZC1maWxlcz1ub2Agc3VwcHJlc3NlcyB0aGUgYD8/IGAgcm93cyBcdTIwMTQgYW4gdW50cmFja2VkIHBhdGhcbiAqIGNhcnJpZXMgbm8gaW5kZXggYmFzZWxpbmUsIHNvIGl0IGNhbiBuZXZlciBjb3VudCBhcyByZS1jcmVhdGVkIChmYWlsXG4gKiBjbG9zZWQpLiBgLXpgIHByaW50cyByYXcsIE5VTC1zZXBhcmF0ZWQgYFhZIDxwYXRoPmAgZW50cmllcyBzbyBzcGFjZS0gYW5kXG4gKiBxdW90ZS1iZWFyaW5nIHBhdGhzIHBhcnNlIHVuYW1iaWd1b3VzbHkuIEZhaWwtc2FmZTogYW4gdW5yZXNvbHZhYmxlIHJlcG8gb3JcbiAqIGEgcHJvYmUgZmFpbHVyZSB5aWVsZHMgYW4gZW1wdHkgc2V0LCBuZXZlciBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gY2hhbmdlZE9uRGlzayhjYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUsIGN3ZDogc3RyaW5nKTogU2V0PHN0cmluZz4ge1xuICBpZiAoY2FjaGUuY2hhbmdlZFBhdGhzICE9PSBudWxsKSByZXR1cm4gY2FjaGUuY2hhbmdlZFBhdGhzO1xuICBjb25zdCBjaGFuZ2VkID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGlmIChjYWNoZS5jaGFuZ2VkQ2FuZGlkYXRlcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICBpZiAocmVwb1Jvb3QgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IHJlbHMgPSBjYWNoZS5jaGFuZ2VkQ2FuZGlkYXRlcy5tYXAoKHApID0+IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBwKSk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3RhdHVzJywgJy0tcG9yY2VsYWluJywgJy16JywgJy0tdW50cmFja2VkLWZpbGVzPW5vJywgJy0tJywgLi4ucmVsc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IERFRkFVTFRfVElNRU9VVF9NU1xuICAgICAgICB9KTtcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBvdXQuc3BsaXQoJ1xcMCcpKSB7XG4gICAgICAgICAgaWYgKGVudHJ5Lmxlbmd0aCA8IDQpIGNvbnRpbnVlOyAvLyBza2lwIHRoZSB0cmFpbGluZyBlbXB0eSBlbnRyeSBhbmQgcmVuYW1lLXBhaXIgcGF0aCByb3dzXG4gICAgICAgICAgY29uc3Qgd29ya3RyZWVTdGF0dXMgPSBlbnRyeS5jaGFyQXQoMSk7XG4gICAgICAgICAgaWYgKHdvcmt0cmVlU3RhdHVzID09PSAnICcgfHwgd29ya3RyZWVTdGF0dXMgPT09ICc/JykgY29udGludWU7IC8vIGluZGV4LW9ubHkgb3IgdW50cmFja2VkIFx1MjE5MiBubyBtYXJrXG4gICAgICAgICAgY2hhbmdlZC5hZGQoam9pbihyZXBvUm9vdCwgZW50cnkuc2xpY2UoMykpKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHZvaWQgZXJyOyAvLyBwcm9iZSBmYWlsdXJlIFx1MjE5MiBlbXB0eSBzZXQgKGZhaWwtc2FmZSwgbmV2ZXIgYW4gZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICB9XG4gIGNhY2hlLmNoYW5nZWRQYXRocyA9IGNoYW5nZWQ7XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIHBhdGgncyB0cmFja2VkIHdvcmtpbmctdHJlZSBjb250ZW50IGRpZmZlcnMgZnJvbSB0aGUgaW5kZXggXHUyMDE0XG4gKiB0aGUgbGF0ZXItcmVjcmVhdGUgZXhwbGFuYXRpb24ncyBtYXJrLiBgZmFsc2VgIG9uIGFueSBwcm9iZSBmYWlsdXJlIG9yIGZvclxuICogYW55IHBhdGggb3V0c2lkZSB0aGUgc2VlZGVkIGNhbmRpZGF0ZXMgKGZhaWwgY2xvc2VkKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdvcmtpbmdUcmVlQ2hhbmdlZChwcm9iZUNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSwgY3dkOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gY2hhbmdlZE9uRGlzayhwcm9iZUNhY2hlLCBjd2QpLmhhcyhhYnNQYXRoKTtcbn1cblxuLyoqXG4gKiBUaGUgbGF5ZXJlZCBwb3N0LXN0YXRlIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDEpLCBldmFsdWF0ZWQgYmVmb3JlIGFueSBleGVjdXRvclxuICogY2FsbCwgc2lkZS1lZmZlY3QtZnJlZSAobm8gbWVtbyB3cml0ZXMsIG5vIGV4ZWN1dG9yIGNhbGxzOyB0aGUgcHJvYmUgaXNcbiAqIHJlYWQtb25seSBhbmQgcGVyLWNvbW1hbmQgY2FjaGVkKTpcbiAqXG4gKiAxLiBgdGFyZ2V0U3RhdGU6ICdhYnNlbnQnYCBcdTIxOTIgdGhlIHBhdGggbXVzdCBiZSBhYnNlbnQ7IHdoZW4gaXQgaXMsIHRoZVxuICogICAgZGVsZXRlLXJlYWxpdHkgcHJvYmUgZGVjaWRlczogaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkIFx1MjE5MiBgZGVjaXNpdmVQYXNzYFxuICogICAgKGRhbmdsaW5nIGFuY2hvcnMgc3VyZmFjZSksIHBoYW50b20gXHUyMTkyIGAnaW5jb25jbHVzaXZlJ2AgKG5vdGhpbmcgdG9cbiAqICAgIHN1cmZhY2UgXHUyMDE0IHRoZSBtaXNzIGlzIGhhcm1sZXNzLCBhbmQgdGhlIGRlbGV0ZSBuZXZlciBmaXJlcykuXG4gKiAyLiBgdGFyZ2V0U3RhdGU6ICdleGlzdHMnYCBcdTIxOTIgdGhlIHRhcmdldCBtdXN0IGJlIGEgcmVndWxhciBmaWxlIChhIGRpcmVjdG9yeVxuICogICAgb3IgbWlzc2luZyB0YXJnZXQgZmFpbHMpLlxuICogMy4gQ29udGVudCB2ZXJpZmljYXRpb24gd2hlcmUgdGhlIGV4cGVjdGVkIHBvc3QtY29udGVudCBpcyBzdGF0aWNhbGx5XG4gKiAgICBrbm93YWJsZSAoYGV4YWN0YC9gc3VmZml4YC9gZW1wdHlgL2BzaXplYCk6IGEgbWlzbWF0Y2ggbWVhbnMgdGhlIHdyaXRlJ3NcbiAqICAgIGVmZmVjdCBpcyBhYnNlbnQgXHUyMDE0IG5vIHRvdWNoLlxuICogNC4gY3AgZGVzdGluYXRpb24tdnMtc291cmNlOiBhIHN0aWxsLXByZXNlbnQgc291cmNlIG11c3QgYnl0ZS1lcXVhbCB0aGVcbiAqICAgIGRlc3RpbmF0aW9uOyBhbiBhYnNlbnQgc291cmNlIGFwcGxpZXMgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocGFzc2VkIHRoZVxuICogICAgcmVhbGl0eSBwcm9iZSBBTkQgaXRzIGFic2VuY2UgZXhwbGFpbmVkIGJ5IGEgbGF0ZXIgc2FtZS1wYXRoXG4gKiAgICBgZGVjaXNpdmVQYXNzYCBcdTIwMTQgdGhlIGRyaXZlciByZXNvbHZlcyB0aGUgYCdwZW5kaW5nJ2AgaG9sZCkuXG4gKiA1LiByZW5hbWUtY29weTogdGhlIGRlc3RpbmF0aW9uIGZpcmVzIG9ubHkgd2hlbiBpdHMgc291cmNlIHBhc3NlZCB0aGVcbiAqICAgIGRlbGV0ZS1yZWFsaXR5IHByb2JlIChhIHBoYW50b20gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCkuXG4gKlxuICogRXZlcnl0aGluZyBlbHNlIFx1MjAxNCB0aGUgZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIHdob3NlIGV4aXN0ZW5jZSBwYXNzIHByb3Zlc1xuICogbm90aGluZyBcdTIwMTQgaXMgYCdpbmNvbmNsdXNpdmUnYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlV3JpdGVHYXRlKGlucHV0OiBUb3VjaFdyaXRlSW5wdXQsIHByb2JlQ2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlKTogV3JpdGVHYXRlT3V0Y29tZSB7XG4gIGlmIChpbnB1dC50YXJnZXRTdGF0ZSA9PT0gJ2Fic2VudCcpIHtcbiAgICBpZiAoZmlsZUV4aXN0cyhpbnB1dC5maWxlUGF0aCkpIHJldHVybiAnZGVjaXNpdmVGYWlsJztcbiAgICByZXR1cm4gcmVhbFBhdGhzKHByb2JlQ2FjaGUsIGlucHV0LmN3ZCkuaGFzKGlucHV0LmZpbGVQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2luY29uY2x1c2l2ZSc7XG4gIH1cblxuICBpZiAoIWlzRmlsZU9uRGlzayhpbnB1dC5maWxlUGF0aCkpIHJldHVybiAnZGVjaXNpdmVGYWlsJztcblxuICBjb25zdCBjb250ZW50ID0gaW5wdXQucG9zdFN0YXRlPy5jb250ZW50O1xuICBpZiAoY29udGVudCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGNvbnRlbnRNYXRjaGVzKGNvbnRlbnQsIGlucHV0LmZpbGVQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gIH1cblxuICBpZiAoaW5wdXQuc291cmNlUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKGZpbGVFeGlzdHMoaW5wdXQuc291cmNlUGF0aCkpIHtcbiAgICAgIGxldCBzcmM6IHN0cmluZztcbiAgICAgIGxldCBkc3Q6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIHNyYyA9IGZzLnJlYWRGaWxlU3luYyhpbnB1dC5zb3VyY2VQYXRoLCAndXRmOCcpO1xuICAgICAgICBkc3QgPSBmcy5yZWFkRmlsZVN5bmMoaW5wdXQuZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuICdkZWNpc2l2ZUZhaWwnO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNyYyA9PT0gZHN0ID8gJ2RlY2lzaXZlUGFzcycgOiAnZGVjaXNpdmVGYWlsJztcbiAgICB9XG4gICAgLy8gQWJzZW50IHNvdXJjZSBcdTIwMTQgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpOiB0aGUgZGVzdFxuICAgIC8vIGZpcmVzIG9ubHkgd2hlbiB0aGUgc291cmNlIHBhc3NlZCB0aGUgcmVhbGl0eSBwcm9iZSAoaXQgd2FzIGEgcmVhbFxuICAgIC8vIGZpbGUpIEFORCBpdHMgYWJzZW5jZSBpcyBleHBsYWluZWQgYnkgYSBsYXRlciBzYW1lLXBhdGggZGVjaXNpdmVQYXNzLlxuICAgIHJldHVybiByZWFsUGF0aHMocHJvYmVDYWNoZSwgaW5wdXQuY3dkKS5oYXMoaW5wdXQuc291cmNlUGF0aCkgPyAncGVuZGluZycgOiAnZGVjaXNpdmVGYWlsJztcbiAgfVxuXG4gIGlmIChpbnB1dC5yZW5hbWVTb3VyY2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBObyBjb250ZW50IGNvbXBhcmlzb24gXHUyMDE0IHBhdGNoIHJlbmFtZXMgbWF5IGNoYW5nZSBjb250ZW50OyBhIHBoYW50b21cbiAgICAvLyBzb3VyY2UgbWVhbnMgdGhlIG1vdmUgZmFpbGVkIGFuZCBhIHByZS1leGlzdGluZyBkZXN0aW5hdGlvbiB3YXMgbmV2ZXJcbiAgICAvLyB0b3VjaGVkIChwbGFuIFx1MDBBNzMgc3RlcCAxYykuXG4gICAgcmV0dXJuIHJlYWxQYXRocyhwcm9iZUNhY2hlLCBpbnB1dC5jd2QpLmhhcyhpbnB1dC5yZW5hbWVTb3VyY2VQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gIH1cblxuICByZXR1cm4gJ2luY29uY2x1c2l2ZSc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSW5qZWN0ZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFN0cnVjdHVyZWQgcmVzdWx0IG9mIGEgc2NvcGVkIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEZpeFJlc3VsdCB7XG4gIC8qKlxuICAgKiBXaGV0aGVyIGAtLWZpeGAgcmUtYW5jaG9yZWQgYXQgbGVhc3Qgb25lIHNwYW4gaW4gdGhlIHdvcmtpbmcgdHJlZS4gRHJpdmVzXG4gICAqIHtAbGluayBUb3VjaE91dHB1dC50cmVlTW9kaWZpZWR9IHNvIGEgY2FsbGVyL3Rlc3QgY2FuIGFzc2VydCB0aGUgaGVhbGluZ1xuICAgKiBoYXBwZW5lZCB3aXRob3V0IGRpZmZpbmcgdGhlIHRyZWUgaXRzZWxmLlxuICAgKi9cbiAgbW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlICh3cml0ZSBwYXRoXG4gKiBvbmx5KSwgcmVwb3J0aW5nIHdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgaGVhbGVkLiBBc3luYyBzbyB0aGUgZXZlbnR1YWxcbiAqIGltcGxlbWVudGF0aW9uIGFuZCBpdHMgdGVzdHMgY2FuIGluamVjdCBhIGZha2Ugd2l0aG91dCBhIHJlYWwgc3VicHJvY2Vzcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hGaXhFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxUb3VjaEZpeFJlc3VsdD47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIDxmaWxlPmAgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXJcbiAqIGFuY2hvciBjb3ZlcmluZyB0aGUgZmlsZS4gU3RydWN0dXJlZCAobm90IHJhdyBzdGRvdXQpIHNvIHRoZSBtZXJnZWQtYmxvY2tcbiAqIGNvbXB1dGF0aW9uIGFuZCBpdHMgdGVzdHMgc2hhcmUgdGhlIHNhbWUgc2hhcGUuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoTGlzdEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbiA8YXJncz5gIChzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSBvclxuICogaXRzIHNwYW5zKSBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlciBkcmlmdGVkIGFuY2hvciwgZW1wdHkgd2hlblxuICogY2xlYW4uIFN0YXR1cyBjbGFzc2lmaWNhdGlvbiBpcyB2aWEgYGlzRGVidCgpYDsgcG9zaXRpb25hbCAoYE1PVkVEYCxcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGApIHJvd3MgYXJlIG5ldmVyIGRlYnQuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRHJpZnRFeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8RHJpZnRQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGJhcmUgYGdpdCBzcGFuIHdoeSA8bmFtZT5gIGFuZCByZXR1cm4gdGhlIHNwYW4ncyByZWNvcmRlZCB3aHkgc2VudGVuY2UsXG4gKiBvciBgbnVsbGAgd2hlbiBub25lIGlzIHJlY29yZGVkIG9yIHRoZSByZWFkIGZhaWxzLiBGZWVkcyB0aGUgaHVtYW4tZm9ybWF0XG4gKiBzcGFuIHJlbmRlcjsgaW52b2tlZCBvbmx5IGZvciBzcGFucyBhY3R1YWxseSBiZWluZyBzdXJmYWNlZCB0aGlzIHRvdWNoLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFdoeUV4ZWN1dG9yID0gKG5hbWU6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG5cbi8qKlxuICogVGhlIGluamVjdGVkIGV4ZWN1dGlvbiBzdXJmYWNlLiBLZXB0IGFzIGZvdXIgbmFycm93IGFzeW5jIGZ1bmN0aW9ucyAocmF0aGVyXG4gKiB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBzbyB0ZXN0cyBpbmplY3QgZmFrZXMgcmV0dXJuaW5nIHN0cnVjdHVyZWQgZGF0YVxuICogYW5kIHRoZSBjb3JlIG5ldmVyIHNwYXducyBhIHN1YnByb2Nlc3MgaXRzZWxmLiBUaGUgYHJlYWRgIHBhdGggbmV2ZXIgaW52b2tlc1xuICogYGZpeGAuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hFeGVjdXRvcnMge1xuICBmaXg6IFRvdWNoRml4RXhlY3V0b3I7XG4gIGxpc3Q6IFRvdWNoTGlzdEV4ZWN1dG9yO1xuICBkcmlmdDogVG91Y2hEcmlmdEV4ZWN1dG9yO1xuICB3aHk6IFRvdWNoV2h5RXhlY3V0b3I7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggb3V0cHV0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoYXQgdGhlIGNvcmUgaGFuZHMgYmFjayBmb3IgdGhlIGFkYXB0ZXIgdG8gdHJhbnNsYXRlIGludG8gU0RLIG91dHB1dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hPdXRwdXQge1xuICAvKipcbiAgICogVGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgKGhlYWRlciwgb25lIGh1bWFuLWZvcm1hdCBzZWN0aW9uIHBlclxuICAgKiBzdXJmYWNlZCBzcGFuLCBmb290ZXIpIHRvIGluamVjdCB2aWEgdGhlIGhhcm5lc3MncyBgYWRkaXRpb25hbENvbnRleHRgLFxuICAgKiBvciBgbnVsbGAgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHdvcnRoIHN1cmZhY2luZyB0aGlzIHRvdWNoLlxuICAgKi9cbiAgYWRkaXRpb25hbENvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIG1vZGlmaWVkIGJ5IGEgc2NvcGVkIGAtLWZpeGAgb24gdGhlIHdyaXRlIHBhdGguXG4gICAqIEFsd2F5cyBgZmFsc2VgIG9uIHRoZSByZWFkIHBhdGggKHJlYWRzIG5ldmVyIG11dGF0ZSB0aGUgdHJlZSkuXG4gICAqL1xuICB0cmVlTW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTWVyZ2VkLWJsb2NrIGFzc2VtYmx5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBtZW1vIGtleSB1bmRlciB3aGljaCBhIHNwYW4ncyByZW5kZXIgZm9yIGEgZ2l2ZW4gZHJpZnQgc3RhdHVzIGlzIGRlZHVwZWQuICovXG5mdW5jdGlvbiBkcmlmdEtleShuYW1lOiBzdHJpbmcsIHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgLy8gU3BhbiBuYW1lcyBjb21lIGZyb20gdGFiLWRlbGltaXRlZCBwb3JjZWxhaW4sIHNvIHRoZXkgbmV2ZXIgY29udGFpbiBhIHRhYjtcbiAgLy8gYSB0YWItam9pbmVkIGtleSBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGEgYmFyZSBzcGFuIG5hbWUgKHRoZSBzdXJmYWNpbmcga2V5KS5cbiAgcmV0dXJuIGAke25hbWV9XFx0JHtzdGF0dXN9YDtcbn1cblxuLyoqIFRoZSBgcGF0aCNMc3RhcnQtTGVuZGAgKG9yIGJhcmUtcGF0aCwgd2hvbGUtZmlsZSkgYW5jaG9yIHRleHQgZm9yIGEgcm93LiAqL1xuZnVuY3Rpb24gYW5jaG9yVGV4dChyb3c6IFBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG5mdW5jdGlvbiBjbGVhbkhlYWRlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke2ZpbGVOYW1lfSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzOmA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuRm9vdGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYElmIHlvdSBjaGFuZ2UgJHtmaWxlTmFtZX0gY2hlY2sgdGhlIG90aGVyIGZpbGVzIHRvIGNvbmZpcm0gdGhleSBzdGlsbCB3b3JrIHRvZ2V0aGVyLmA7XG59XG5cbi8qKlxuICogVGhlIHdyaXRlIHBhdGggbmFtZXMgdGhlIGVkaXQgYXMgdGhlIGNhdXNlOyB0aGUgcmVhZCBwYXRoIG9ubHkgc3VyZmFjZXNcbiAqIHByZS1leGlzdGluZyBkcmlmdCBpdCBkaWRuJ3QgY3JlYXRlLCBzbyBpdCBuYW1lcyB0aGUgZGVwZW5kZW5jeSBpbnN0ZWFkLlxuICovXG5mdW5jdGlvbiBkcmlmdEhlYWRlcihkcmlmdGVkQ291bnQ6IG51bWJlciwga2luZDogVG91Y2hJbnB1dFsna2luZCddKTogc3RyaW5nIHtcbiAgaWYgKGtpbmQgPT09ICd3cml0ZScpIHtcbiAgICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgICA/ICdUaGlzIGVkaXQgcHV0IGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgICAgOiAnVGhpcyBlZGl0IHB1dCBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6JztcbiAgfVxuICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgPyAnVGhpcyBmaWxlIGhhcyBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICA6ICdUaGlzIGZpbGUgaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xufVxuXG5mdW5jdGlvbiBkcmlmdEZvb3RlcihkcmlmdGVkTmFtZXM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgaWYgKGRyaWZ0ZWROYW1lcy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBuYW1lID0gZHJpZnRlZE5hbWVzWzBdO1xuICAgIHJldHVybiBgUmVzdG9yZSBhZ3JlZW1lbnQgYmVmb3JlIGNvbW1pdHRpbmcuIEZvbGxvdyBjb25maXJtZWQgYXV0aG9yaXR5LiBQcmVzZXJ2ZSBhbmNob3Igc2hhcGU7IGlmIGFuIGFkZHJlc3MgY2hhbmdlZCwgcmVtb3ZlIGl0cyBvbGQgYW5jaG9yIGJlZm9yZSBhZGRpbmcgdGhlIG5ldyBvbmUuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgXFxgZ2l0IHNwYW4gZHJpZnQgJHtuYW1lfVxcYCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLmA7XG4gIH1cbiAgcmV0dXJuICdGb3IgZWFjaCBvdXQtb2YtZGF0ZSBzcGFuOiByZXN0b3JlIGFncmVlbWVudCBiZWZvcmUgY29tbWl0dGluZy4gRm9sbG93IGNvbmZpcm1lZCBhdXRob3JpdHkuIFByZXNlcnZlIGFuY2hvciBzaGFwZTsgaWYgYW4gYWRkcmVzcyBjaGFuZ2VkLCByZW1vdmUgaXRzIG9sZCBhbmNob3IgYmVmb3JlIGFkZGluZyB0aGUgbmV3IG9uZS4gVXBkYXRlIG9yIHJldGlyZSB0aGUgd2h5IG9ubHkgaWYgaXRzIG1lYW5pbmcgY2hhbmdlZC4gUmVxdWlyZSBgZ2l0IHNwYW4gZHJpZnQgPG5hbWU+YCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLic7XG59XG5cbi8qKiBUaGUge0BsaW5rIFJhbmdlTGFiZWx9IGZvciBhIHBvcmNlbGFpbiByb3cgXHUyMDE0IGAwLTBgIGlzIHRoZSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIHJhbmdlTGFiZWwocm93OiBQb3JjZWxhaW5Sb3cpOiBSYW5nZUxhYmVsIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4geyBraW5kOiAnd2hvbGUtZmlsZScgfTtcbiAgcmV0dXJuIHsga2luZDogJ3JhbmdlJywgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH07XG59XG5cbi8qKlxuICogQSBzcGFuJ3MgZnVsbCBhbmNob3IgbGlzdCwgcmVuZGVyZWQgYXMgYSBzaGFyZWQtcHJlZml4IHRyZWUgYnlcbiAqIHtAbGluayByZW5kZXJBbmNob3JUcmVlfSwgd2l0aCBlYWNoIGFuY2hvciB0aGF0IGNhcnJpZXMgZ2VudWluZSBkcmlmdFxuICogc3VmZml4ZWQgYnkgaXRzIGxvd2VyY2FzZSBzdGF0dXMgdG9rZW4ocykgKGAgXHUyMDE0IGNoYW5nZWRgKS5cbiAqXG4gKiBBIGRyaWZ0IHJvdyBtYXRjaGVzIGFuIGFuY2hvciBieSBleGFjdCBwYXRoK3JhbmdlLCBvciBieSBwYXRoIGFsb25lIHdoZW4gdGhlXG4gKiBzcGFuIGhhcyBhIHNpbmdsZSBhbmNob3Igb24gdGhhdCBwYXRoIChyYW5nZXMgY2FuIGRpc2FncmVlIGFmdGVyIGEgaGVhbCkuXG4gKiBgc29sZU9uUGF0aGAgaXMgZGVsaWJlcmF0ZWx5IGNvbXB1dGVkIG92ZXIgdGhlICoqZnVsbCBmbGF0IGFuY2hvciBsaXN0KiosXG4gKiBiZWZvcmUgYW55IGdyb3VwaW5nIFx1MjAxNCB0aGUgdHJlZSBsYXlvdXQgbXVzdCBuZXZlciBiZSBhYmxlIHRvIGNoYW5nZSAqd2hpY2gqXG4gKiBhbmNob3JzIGdldCBsYWJlbGVkLCBvbmx5IHdoZXJlIHRoZXkgc2l0IG9uIHRoZSBwYWdlLlxuICovXG5mdW5jdGlvbiBhbmNob3JCdWxsZXRzKGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLCBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgcm93cyA9IGFuY2hvcnMubWFwKChhbmNob3IpID0+IHtcbiAgICBjb25zdCBzb2xlT25QYXRoID0gYW5jaG9ycy5maWx0ZXIoKGEpID0+IGEucGF0aCA9PT0gYW5jaG9yLnBhdGgpLmxlbmd0aCA9PT0gMTtcbiAgICBjb25zdCBzdGF0dXNlcyA9IG5ldyBTZXQ8UG9yY2VsYWluU3RhdHVzPigpO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIGRlYnRSb3dzKSB7XG4gICAgICBpZiAocm93LnBhdGggIT09IGFuY2hvci5wYXRoKSBjb250aW51ZTtcbiAgICAgIGlmIChzb2xlT25QYXRoIHx8IChyb3cuc3RhcnQgPT09IGFuY2hvci5zdGFydCAmJiByb3cuZW5kID09PSBhbmNob3IuZW5kKSkge1xuICAgICAgICBzdGF0dXNlcy5hZGQocm93LnN0YXR1cyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi5zdGF0dXNlc10uc29ydCgpO1xuICAgIGNvbnN0IHN1ZmZpeCA9IHNvcnRlZC5sZW5ndGggPiAwID8gYCBcdTIwMTQgJHtzb3J0ZWQubWFwKGh1bWFuU3RhdHVzTGFiZWwpLmpvaW4oJywgJyl9YCA6ICcnO1xuICAgIHJldHVybiB7IHBhdGg6IGFuY2hvci5wYXRoLCByYW5nZTogcmFuZ2VMYWJlbChhbmNob3IpLCBzdWZmaXggfTtcbiAgfSk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlbmRlckFuY2hvclRyZWUoY29sbGFwc2VCeVBhdGgocm93cykpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCBkbyBub3QgcmVtb3ZlIGl0XG4gICAgLy8gb24gdGhlIHRoZW9yeSB0aGF0IGEgZGVncmFkZWQgZmFsbGJhY2sgaXMgaXRzZWxmIGZvcmJpZGRlbi4gQW4gdW5jYXVnaHRcbiAgICAvLyB0aHJvdyBoZXJlIGRvZXMgbm90IGRlZ3JhZGUgdG8gYSBmbGF0IGxpc3Q6IGl0IGVzY2FwZXMgdG9cbiAgICAvLyBgcnVuVG91Y2hIb29rYCdzIGNhdGNoLCB3aGljaCByZXNvbHZlcyB0aGUgd2hvbGUgaG9vayB0b1xuICAgIC8vIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAsIHNvIHRoZSBhZ2VudCBpcyBuZXZlciB0b2xkIGFib3V0IHRoZSBkcmlmdCBhdFxuICAgIC8vIGFsbC4gQ2F0Y2hpbmcgbG9jYWxseSBuYXJyb3dzIHdoYXQgYSByZW5kZXJpbmcgZGVmZWN0IGNhbiBjb3N0IGZyb20gXCJ0aGVcbiAgICAvLyByZW1pbmRlciBkaXNhcHBlYXJzXCIgdG8gXCJ0aGUgcmVtaW5kZXIgbG9va3MgbGlrZSBpdCBkaWQgYmVmb3JlIHRoZSB0cmVlXCIuXG4gICAgLy8gV2hldGhlciB0byBzdXJmYWNlIGFuZCB3aGF0IHNoYXBlIHRvIHN1cmZhY2UgaW4gYXJlIGRpZmZlcmVudCB0aGluZ3MsIGFuZFxuICAgIC8vIHRoaXMgY2F0Y2ggb25seSBldmVyIHRvdWNoZXMgdGhlIGxhdHRlci5cbiAgICAvLyBgcm93c2AgaXMgaW5kZXgtYWxpZ25lZCB3aXRoIGBhbmNob3JzYCwgc28gdGhpcyByZXByb2R1Y2VzIHRvZGF5J3MgZmxhdFxuICAgIC8vIGJ1bGxldCBydW4gYnl0ZSBmb3IgYnl0ZSwgc3VmZml4ZXMgaW5jbHVkZWQuXG4gICAgcmV0dXJuIGFuY2hvcnMubWFwKChhbmNob3IsIGkpID0+IGAtICR7YW5jaG9yVGV4dChhbmNob3IpfSR7cm93c1tpXS5zdWZmaXh9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBPbmUgaHVtYW4tZm9ybWF0IHNwYW4gc2VjdGlvbjogYCMjIDxuYW1lPmAsIHRoZSBmdWxsIGFuY2hvciBsaXN0IChkcmlmdGVkXG4gKiBhbmNob3JzIHN0YXR1cy1zdWZmaXhlZCksIGFuZCB0aGUgd2h5IHNlbnRlbmNlIHdoZW4gb25lIGlzIHJlY29yZGVkLlxuICpcbiAqIFRoZSBuYW1lIGhlYWRlciBhbmQgdGhlIHdoeSBzZW50ZW5jZSBhcmUgdGhlIHNhbWUgc2hhcGUgYGdpdCBzcGFuIGxpc3RgXG4gKiByZW5kZXJzOyB0aGUgYW5jaG9yIGxpc3QgZGVsaWJlcmF0ZWx5IGlzIG5vdCBcdTIwMTQgaXQgcmVuZGVycyBhcyBhIHNoYXJlZC1wcmVmaXhcbiAqIHRyZWUgKHtAbGluayBhbmNob3JCdWxsZXRzfSkgd2hlcmUgdGhlIENMSSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHJhbmdlYFxuICogYnVsbGV0IHJ1bi4gVGhlIENMSSdzIG93biB0ZXh0IGZvcm1hdCBpcyB1bnRvdWNoZWQ7IG9ubHkgdGhpcyBob29rJ3NcbiAqIHJlLXByZXNlbnRhdGlvbiBvZiBpdCBncm91cHMuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclNwYW5TZWN0aW9uKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLFxuICBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSxcbiAgd2h5OiBzdHJpbmcgfCBudWxsXG4pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IFtgIyMgJHtuYW1lfWAsIC4uLmFuY2hvckJ1bGxldHMoYW5jaG9ycywgZGVidFJvd3MpXTtcbiAgaWYgKHdoeSkgbGluZXMucHVzaCgnJywgd2h5KTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIEFzc2VtYmxlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrOiBoZWFkZXIsIG9uZSBzZWN0aW9uIHBlciBzdXJmYWNlZFxuICogc3BhbiAoc2VwYXJhdGVkIGJ5IGAtLS1gKSwgYW5kIGEgc2luZ2xlIGZvb3RlciBhZnRlciBhIGZpbmFsIGAtLS1gLlxuICovXG5mdW5jdGlvbiBidWlsZEJsb2NrKHNlY3Rpb25zOiBzdHJpbmdbXSwgaGVhZGVyOiBzdHJpbmcsIGZvb3Rlcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYm9keSA9IGAke2hlYWRlcn1cXG5cXG4ke3NlY3Rpb25zLmpvaW4oJ1xcblxcbi0tLVxcblxcbicpfVxcblxcbi0tLVxcblxcbiR7Zm9vdGVyfWA7XG4gIHJldHVybiBgXFxuPGdpdC1zcGFuPlxcbiR7Ym9keX1cXG48L2dpdC1zcGFuPlxcbmA7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaG9vayBlbnRyeSBwb2ludFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGluIHNjb3BlIGZvciB0aGUgcmVjb3ZlcmVkIHJhbmdlLiAqL1xuZnVuY3Rpb24gaW50ZXJzZWN0cyhyb3c6IFBvcmNlbGFpblJvdywgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyk6IGJvb2xlYW4ge1xuICBpZiAocmFuZ2UgPT09ICd3aG9sZS1maWxlJykgcmV0dXJuIHRydWU7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHRydWU7IC8vIHdob2xlLWZpbGUgYW5jaG9yXG4gIHJldHVybiByYW5nZXNJbnRlcnNlY3QocmFuZ2UsIHsgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH0pO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIHRvdWNoZWQgcmFuZ2UgZnJvbSB0aGUgb24tZGlzayBmaWxlIGZvciBhIHdyaXRlLiBBbiBlbXB0eSB3cml0ZSBvclxuICogYW4gdW5yZWFkYWJsZSBmaWxlIChlLmcuIGEgZGVsZXRlLCBvciB0aGUgZmlsZSB3YXMgbmV2ZXIgd3JpdHRlbikgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgLCBzY29waW5nIHRoZSB0b3VjaCB0byBldmVyeSBjb3ZlcmluZyBzcGFuIFx1MjAxNCB0aGUgZmFpbC1vcGVuXG4gKiBiZWhhdmlvciwgbm90IGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2VGcm9tRGlzayh3cml0dGVuOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcpOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGxldCBjb250ZW50OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICByZXR1cm4gcmVjb3ZlclJhbmdlKHdyaXR0ZW4sIGNvbnRlbnQpO1xufVxuXG4vKipcbiAqIFRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBkb2N1bWVudGVkIGRlZmF1bHQgbGluZSBjb3VudCB3aGVuIGBvZmZzZXRgIGlzXG4gKiBnaXZlbiB3aXRob3V0IGBsaW1pdGAgKFwiQnkgZGVmYXVsdCwgaXQgcmVhZHMgdXAgdG8gMjAwMCBsaW5lc1wiKS4gTmFtZWQgc29cbiAqIHRoZSBhc3N1bXB0aW9uIGlzIHZpc2libGUgYW5kIGVhc3kgdG8gdXBkYXRlIGlmIHRoYXQgZGVmYXVsdCBldmVyIGNoYW5nZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQURfTElNSVQgPSAyMDAwO1xuXG4vKipcbiAqIENvbXB1dGUgdGhlIHRvdWNoZWQgcmFuZ2UgZm9yIGEgcmVhZCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wnc1xuICogYG9mZnNldGAvYGxpbWl0YCBpbnB1dHMuIE5laXRoZXIgcHJlc2VudCBtZWFucyBhIGdlbnVpbmUgd2hvbGUtZmlsZSByZWFkIFx1MjAxNFxuICogZXZlcnkgY292ZXJpbmcgc3BhbiBzdGF5cyBpbiBzY29wZSwgbWF0Y2hpbmcgdG9kYXkncyBiZWhhdmlvci4gT3RoZXJ3aXNlXG4gKiB0aGUgcmFuZ2Ugc3RhcnRzIGF0IGBvZmZzZXRgIChkZWZhdWx0IGxpbmUgMSkgYW5kIHJ1bnMgZm9yIGBsaW1pdGAgbGluZXNcbiAqIChkZWZhdWx0IHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9KSwgY2xhbXBlZCB0byB0aGUgZmlsZSdzIGFjdHVhbCBsaW5lXG4gKiBjb3VudCBzbyBhIHNob3J0IGZpbGUgd2l0aCBhIGxhcmdlIGBvZmZzZXRgL2BsaW1pdGAgZG9lc24ndCBvdmVyc2hvb3QuXG4gKiBDbGFtcGluZyByZXF1aXJlcyByZWFkaW5nIHRoZSBmaWxlOyBhbiB1bnJlYWRhYmxlIGZpbGUgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgIFx1MjAxNCB0aGUgc2FtZSBmYWlsLW9wZW4gYmVoYXZpb3IgdGhlIHdyaXRlIHBhdGggdXNlcy5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJlYWRSYW5nZShcbiAgb2Zmc2V0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGxpbWl0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCAmJiBsaW1pdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBjb25zdCBzdGFydCA9IG9mZnNldCA/PyAxO1xuICBsZXQgbGluZUNvdW50OiBudW1iZXI7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICBsaW5lQ291bnQgPSBjb250ZW50Lmxlbmd0aCA9PT0gMCA/IDAgOiBjb250ZW50LnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyAobGltaXQgPz8gREVGQVVMVF9SRUFEX0xJTUlUKSAtIDEsIE1hdGgubWF4KGxpbmVDb3VudCwgc3RhcnQpKTtcbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgYW4gYW5jaG9yIGluIHRoZSB0b3VjaGVkIGZpbGUgaXRzZWxmLiBgbGlzdFxuICogLS1wb3JjZWxhaW4gPGZpbGU+YCByZXR1cm5zIGV2ZXJ5IGFuY2hvciBvZiBlYWNoIG1hdGNoaW5nIHNwYW4gXHUyMDE0IGNyb3NzLWZpbGVcbiAqIGFuY2hvcnMgaW5jbHVkZWQgXHUyMDE0IGJ1dCBvbmx5IGFuY2hvcnMgaW4gdGhlIHRvdWNoZWQgZmlsZSBwYXJ0aWNpcGF0ZSBpbiB0aGVcbiAqIHJhbmdlLWludGVyc2VjdGlvbiBzY29wZSB0ZXN0LiBSb3cgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmU7IHRoZSB0b3VjaGVkIHBhdGhcbiAqIGlzIGFic29sdXRlLCBzbyBtYXRjaCBvbiBhbiBleGFjdCBvciBgL2Atc2VwYXJhdGVkIHN1ZmZpeC5cbiAqL1xuZnVuY3Rpb24gb25Ub3VjaGVkRmlsZShyb3c6IFBvcmNlbGFpblJvdywgZmlsZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gZmlsZVBhdGggPT09IHJvdy5wYXRoIHx8IGZpbGVQYXRoLmVuZHNXaXRoKGAvJHtyb3cucGF0aH1gKTtcbn1cblxuLyoqXG4gKiBDb21wdXRlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGZvciB0aGUgdG91Y2gsIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzXG4gKiBub3RoaW5nIHdvcnRoIHN1cmZhY2luZy4gU2hhcmVkIGJ5IGJvdGggcGF0aHM7IHRoZSB3cml0ZSBwYXRoIHBhc3NlcyBhXG4gKiByZWNvdmVyZWQgcmFuZ2UgZm9yIHByZWNpc2lvbiwgdGhlIHJlYWQgcGF0aCBzY29wZXMgZmlsZS13aWRlLlxuICpcbiAqIEEgc3BhbiByZW5kZXJzIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiAobmFtZSwgYWxsIGFuY2hvcnMgd2l0aFxuICogZHJpZnRlZCBvbmVzIHN0YXR1cy1zdWZmaXhlZCwgd2h5KSB3aGVuIGl0cyBuYW1lIGhhcyBub3QgYmVlbiBzdXJmYWNlZCB0aGlzXG4gKiBzZXNzaW9uLCBvciB3aGVuIGl0IGNhcnJpZXMgYSBkcmlmdCBzdGF0dXMgbm90IHlldCBzdXJmYWNlZCBmb3IgaXQgXHUyMDE0IHNvIGFcbiAqIHNwYW4gZmlyc3Qgc2VlbiBoZWFsdGh5IHJlLXJlbmRlcnMgaW4gZnVsbCB3aGVuIGRyaWZ0IGxhdGVyIGFwcGVhcnMuIEEgc3BhblxuICogd2hvc2Ugb25seSBkcmlmdCBpcyBwb3NpdGlvbmFsIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgXHUyMDE0IG5ldmVyXG4gKiBgaXNEZWJ0YCkgaXMgZmlsdGVyZWQgb3V0IGVudGlyZWx5OiBwb3NpdGlvbmFsIGRyaWZ0IG5ldmVyIHN1cmZhY2VzLlxuICovXG5hc3luYyBmdW5jdGlvbiBjb21wdXRlU3VyZmFjZShcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJ1xuKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gIGlmIChjb3ZlcmluZy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIEdyb3VwIGV2ZXJ5IGFuY2hvciBieSBzcGFuOyBhIHNwYW4gaXMgaW4gc2NvcGUgd2hlbiBvbmUgb2YgaXRzIGFuY2hvcnMgb25cbiAgLy8gdGhlIHRvdWNoZWQgZmlsZSBpbnRlcnNlY3RzIHRoZSByZWNvdmVyZWQgcmFuZ2UuXG4gIGNvbnN0IGFuY2hvcnNCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGNvdmVyaW5nKSB7XG4gICAgY29uc3Qgcm93cyA9IGFuY2hvcnNCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBhbmNob3JzQnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cbiAgY29uc3QgdG91Y2hlZE5hbWVzID0gWy4uLmFuY2hvcnNCeU5hbWUua2V5cygpXS5maWx0ZXIoKG5hbWUpID0+XG4gICAgKGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdKS5zb21lKChyb3cpID0+IG9uVG91Y2hlZEZpbGUocm93LCBpbnB1dC5maWxlUGF0aCkgJiYgaW50ZXJzZWN0cyhyb3csIHJhbmdlKSlcbiAgKTtcbiAgaWYgKHRvdWNoZWROYW1lcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGRyaWZ0Um93cyA9IGF3YWl0IGV4ZWN1dG9ycy5kcmlmdChbaW5wdXQuZmlsZVBhdGhdLCBpbnB1dC5jd2QpO1xuICBjb25zdCBkcmlmdEJ5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBEcmlmdFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBkcmlmdFJvd3MpIHtcbiAgICBjb25zdCByb3dzID0gZHJpZnRCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBkcmlmdEJ5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG5cbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCk7XG4gIGNvbnN0IHRvUmVjb3JkOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzZWN0aW9uczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgbmFtZSBvZiB0b3VjaGVkTmFtZXMpIHtcbiAgICBjb25zdCBzcGFuRHJpZnQgPSBkcmlmdEJ5TmFtZS5nZXQobmFtZSkgPz8gW107XG4gICAgY29uc3QgZGVidFJvd3MgPSBzcGFuRHJpZnQuZmlsdGVyKChyb3cpID0+IGlzRGVidChyb3cuc3RhdHVzKSk7XG4gICAgaWYgKHNwYW5EcmlmdC5sZW5ndGggPiAwICYmIGRlYnRSb3dzLmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIHBvc2l0aW9uYWwtb25seSBkcmlmdCBuZXZlciBzdXJmYWNlc1xuXG4gICAgY29uc3QgZGVidFN0YXR1c2VzID0gWy4uLm5ldyBTZXQoZGVidFJvd3MubWFwKChyb3cpID0+IHJvdy5zdGF0dXMpKV0uc29ydCgpO1xuICAgIGNvbnN0IHVuc3VyZmFjZWREZWJ0ID0gZGVidFN0YXR1c2VzLmZpbHRlcigoc3RhdHVzKSA9PiAhc3VyZmFjZWQuaGFzKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpKTtcbiAgICBjb25zdCBpc05ld05hbWUgPSAhc3VyZmFjZWQuaGFzKG5hbWUpO1xuICAgIGlmICghaXNOZXdOYW1lICYmIHVuc3VyZmFjZWREZWJ0Lmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIGZ1bGx5IHN1cmZhY2VkIGFscmVhZHlcblxuICAgIGNvbnN0IHdoeSA9IGF3YWl0IGV4ZWN1dG9ycy53aHkobmFtZSwgaW5wdXQuY3dkKTtcbiAgICBzZWN0aW9ucy5wdXNoKHJlbmRlclNwYW5TZWN0aW9uKG5hbWUsIGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdLCBkZWJ0Um93cywgd2h5KSk7XG4gICAgaWYgKGRlYnRTdGF0dXNlcy5sZW5ndGggPiAwKSBkcmlmdGVkTmFtZXMucHVzaChuYW1lKTtcblxuICAgIGlmIChpc05ld05hbWUpIHRvUmVjb3JkLnB1c2gobmFtZSk7XG4gICAgZm9yIChjb25zdCBzdGF0dXMgb2YgdW5zdXJmYWNlZERlYnQpIHRvUmVjb3JkLnB1c2goZHJpZnRLZXkobmFtZSwgc3RhdHVzKSk7XG4gIH1cblxuICBpZiAoc2VjdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgbWVtby5hZGRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQsIHRvUmVjb3JkKTtcbiAgY29uc3QgZmlsZU5hbWUgPSBiYXNlbmFtZShpbnB1dC5maWxlUGF0aCk7XG4gIGNvbnN0IGhlYWRlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRIZWFkZXIoZHJpZnRlZE5hbWVzLmxlbmd0aCwgaW5wdXQua2luZCkgOiBjbGVhbkhlYWRlcihmaWxlTmFtZSk7XG4gIGNvbnN0IGZvb3RlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzKSA6IGNsZWFuRm9vdGVyKGZpbGVOYW1lKTtcbiAgcmV0dXJuIGJ1aWxkQmxvY2soc2VjdGlvbnMsIGhlYWRlciwgZm9vdGVyKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHRvdWNoIGhvb2sgZm9yIGEgc2luZ2xlIHRvb2wgY2FsbCwgYnJhbmNoaW5nIG9uIHtAbGluayBUb3VjaElucHV0LmtpbmR9LlxuICpcbiAqIC0gKipXcml0ZSBwYXRoKio6IHtAbGluayBldmFsdWF0ZVdyaXRlR2F0ZX0gKHBsYW4gXHUwMEE3MyBzdGVwIDEpIHJ1bnMgZmlyc3QgXHUyMDE0XG4gKiAgIGFueSBkZWNpc2l2ZSBmYWlsLCBvciBhbiBpbmNvbmNsdXNpdmUgcGhhbnRvbSBkZWxldGUsIGJsb2NrcyB0aGUgdG91Y2hcbiAqICAgd2l0aCBubyBleGVjdXRvciBjYWxsIFx1MjAxNCB0aGVuIGBleGVjdXRvcnMuZml4YCAoYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPlxuICogICAtLWZpeGApIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmdcbiAqICAgdHJlZSwgYW5kIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGlzIGNvbXB1dGVkIGFnYWluc3QgdGhlIGhlYWxlZFxuICogICBhbmNob3JzLCByZW5kZXJpbmcgZWFjaCBzdXJmYWNlZCBzcGFuIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiB3aXRoXG4gKiAgIGFueSByZW1haW5pbmcgc2VtYW50aWMgZHJpZnQgc3RhdHVzLXN1ZmZpeGVkIG9uIGl0cyBhbmNob3JzLiBDYWRlbmNlIGlzXG4gKiAgIGRlZHVwZWQgdGhyb3VnaCBgbWVtb2AgcGVyIHNwYW4gbmFtZSBhbmQgcGVyIChzcGFuLCBzdGF0dXMpLlxuICogLSAqKlJlYWQgcGF0aCoqOiBuZXZlciBpbnZva2VzIGBmaXhgIGFuZCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlOyBzdXJmYWNlcyB0aGVcbiAqICAgc3BhbnMgb3ZlcmxhcHBpbmcgdGhlIHJlYWQncyBgb2Zmc2V0YC9gbGltaXRgIHdpbmRvdyAoc2VlXG4gKiAgIHtAbGluayByZWNvdmVyUmVhZFJhbmdlfTsgYSByZWFkIHdpdGggbmVpdGhlciBpcyB3aG9sZS1maWxlLCBtYXRjaGluZ1xuICogICB0b2RheSdzIGJlaGF2aW9yKSB3aXRoIHBvc2l0aW9uYWwgc3RhdHVzZXMgZmlsdGVyZWQgb3V0IHZpYSBgaXNEZWJ0KClgLlxuICpcbiAqIFRoZSBvcHRpb25hbCBgcHJvYmVDYWNoZWAgc2hhcmVzIHRoZSBkcml2ZXIncyBwZXItY29tbWFuZCBkZWxldGUtcmVhbGl0eVxuICogcHJvYmUgaW50byBwYXNzIEIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpIHNvIHN1cnZpdmluZyBkZWxldGVzIHJlLWdhdGUgd2l0aG91dFxuICogcmUtcHJvYmluZzsgZGlyZWN0IGNhbGxlcnMgZ2V0IGEgcGVyLWNhbGwgY2FjaGUgc2VlZGVkIHdpdGggdGhlIHRvdWNoZWRcbiAqIHBhdGggd2hlbiB0aGUgdGFyZ2V0IGlzIGAnYWJzZW50J2AuXG4gKlxuICogRmFpbHMgb3BlbjogYW55IGV4ZWN1dG9yIHJlamVjdGlvbiBvciBpbnRlcm5hbCBlcnJvciB5aWVsZHNcbiAqIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAgKG5vIHNpZ25hbCwgZWRpdGluZyBuZXZlciBibG9ja2VkKSByYXRoZXIgdGhhblxuICogdGhyb3dpbmcuIGB0cmVlTW9kaWZpZWRgIHJlZmxlY3RzIGEgc3VjY2Vzc2Z1bCBgLS1maXhgIGV2ZW4gd2hlbiB0aGVcbiAqIHN1YnNlcXVlbnQgc3VyZmFjZSBjb21wdXRhdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRvdWNoSG9vayhcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcHJvYmVDYWNoZT86IFJlYWxpdHlQcm9iZUNhY2hlXG4pOiBQcm9taXNlPFRvdWNoT3V0cHV0PiB7XG4gIGxldCB0cmVlTW9kaWZpZWQgPSBmYWxzZTtcbiAgdHJ5IHtcbiAgICBsZXQgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyA9ICd3aG9sZS1maWxlJztcbiAgICBpZiAoaW5wdXQua2luZCA9PT0gJ3dyaXRlJykge1xuICAgICAgY29uc3QgcHJvYmUgPSBwcm9iZUNhY2hlID8/IGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlKGlucHV0LnRhcmdldFN0YXRlID09PSAnYWJzZW50JyA/IFtpbnB1dC5maWxlUGF0aF0gOiBbXSk7XG4gICAgICBjb25zdCBvdXRjb21lID0gZXZhbHVhdGVXcml0ZUdhdGUoaW5wdXQsIHByb2JlKTtcbiAgICAgIGlmIChvdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJyB8fCAob3V0Y29tZSA9PT0gJ2luY29uY2x1c2l2ZScgJiYgaW5wdXQudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnKSkge1xuICAgICAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dDogbnVsbCwgdHJlZU1vZGlmaWVkOiBmYWxzZSB9O1xuICAgICAgfVxuICAgICAgY29uc3QgZml4ID0gYXdhaXQgZXhlY3V0b3JzLmZpeChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgICAgIHRyZWVNb2RpZmllZCA9IGZpeC5tb2RpZmllZDtcbiAgICAgIHJhbmdlID0gaW5wdXQucmFuZ2UgPz8gcmVjb3ZlclJhbmdlRnJvbURpc2soaW5wdXQud3JpdHRlbiwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IHJlY292ZXJSZWFkUmFuZ2UoaW5wdXQub2Zmc2V0LCBpbnB1dC5saW1pdCwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH1cbiAgICBjb25zdCBhZGRpdGlvbmFsQ29udGV4dCA9IGF3YWl0IGNvbXB1dGVTdXJmYWNlKGlucHV0LCBleGVjdXRvcnMsIG1lbW8sIHJhbmdlKTtcbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dCwgdHJlZU1vZGlmaWVkIH07XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZhaWwgb3BlbjogbmV2ZXIgbGV0IGEgdG91Y2gtY29yZSBlcnJvciBwcm9wYWdhdGUgdXAgYW5kIGJsb2NrIHRoZSB0b29sXG4gICAgLy8gY2FsbC4gVGhlIHRyZWUgbWF5IGFscmVhZHkgaGF2ZSBiZWVuIGhlYWxlZCAodHJlZU1vZGlmaWVkIHByZXNlcnZlZCkuXG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQ6IG51bGwsIHRyZWVNb2RpZmllZCB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSZXNvbHZlIHRoZSB0b3VjaGVkIGZpbGUgdG8gYSBwYXRoIHJlbGF0aXZlIHRvIGl0cyByZXBvIHJvb3QsIGZvciBgZ2l0IHNwYW5gLiAqL1xuZnVuY3Rpb24gcmVwb1JlbEFyZyhmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZyk6IHsgcmVwb1Jvb3Q6IHN0cmluZzsgcmVsUGF0aDogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHJlcG9Sb290LCByZWxQYXRoOiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgZmlsZVBhdGgpIH07XG59XG5cbi8qKlxuICogQSBzbmFwc2hvdCBvZiB0aGUgc3BhbiByb290J3Mgd29ya2luZy10cmVlIHN0YXR1cywgdXNlZCB0byBkZXRlY3Qgd2hldGhlciBhXG4gKiBgLS1maXhgIHJlLWFuY2hvcmVkIGFueXRoaW5nLiBDb21wYXJlZCBiZWZvcmUvYWZ0ZXI7IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yXG4gKiBhIGZhaWxlZCBzdGF0dXMgeWllbGRzIGEgc3RhYmxlIGVtcHR5IHN0cmluZyAoXHUyMTkyIGBtb2RpZmllZDogZmFsc2VgKS5cbiAqL1xuZnVuY3Rpb24gc3BhblN0YXR1c1NuYXBzaG90KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnc3RhdHVzJywgJy0tcG9yY2VsYWluJywgJy0tJywgc3BhblJvb3RdLCB7XG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICcnO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHByb2R1Y3Rpb24gZXhlY3V0aW9uIHN1cmZhY2U6IHRocmVlIHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9ycyBmb2xsb3dpbmdcbiAqIHNwYW4tc3VyZmFjZS50cydzIGBjcmVhdGVEZWZhdWx0KkV4ZWN1dG9yYCBzdHlsZS4gRWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlbiBvblxuICogYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbiAqIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIHBhcnNlIGZhaWx1cmUpIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdFxuICogc28ge0BsaW5rIHJ1blRvdWNoSG9va30ncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBUb3VjaEV4ZWN1dG9ycyB7XG4gIHJldHVybiB7XG4gICAgZml4OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIHsgbW9kaWZpZWQ6IGZhbHNlIH07XG4gICAgICBjb25zdCBiZWZvcmUgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCByZXNvbHZlZC5yZWxQYXRoLCAnLS1maXgnXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHZvaWQgZXJyOyAvLyBgZ2l0IHNwYW4gZHJpZnRgIGV4aXRzIDEgb24gZHJpZnQgZXZlbiB3aGVuIGAtLWZpeGAgaGVhbGVkIHNvbWV0aGluZywgYW5kXG4gICAgICAgIC8vIG5vbi16ZXJvIG9uIGdlbnVpbmUgZmFpbHVyZTsgdGhlIHNuYXBzaG90IGRpZmYgaXMgdGhlIHNvdXJjZSBvZlxuICAgICAgICAvLyB0cnV0aCBmb3Igd2hldGhlciB0aGUgdHJlZSBjaGFuZ2VkLCBzbyB0aGUgZXhpdCBjb2RlIGlzIGlnbm9yZWQgaGVyZS5cbiAgICAgIH1cbiAgICAgIGNvbnN0IGFmdGVyID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHJldHVybiB7IG1vZGlmaWVkOiBiZWZvcmUgIT09IGFmdGVyIH07XG4gICAgfSxcblxuICAgIGxpc3Q6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4gW107XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgcmVzb2x2ZWQucmVsUGF0aF0sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBkcmlmdDogYXN5bmMgKGFyZ3MsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGNvbnN0IHJ1bkN3ZCA9IHJlcG9Sb290ID8/IGN3ZDtcbiAgICAgIC8vIFRoZSBjb3JlIHBhc3NlcyBhbiBhYnNvbHV0ZSBmaWxlIHBhdGg7IHNjb3BlIGBnaXQgc3BhbiBkcmlmdGAgdG8gaXRcbiAgICAgIC8vIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3Qgc28gdGhlIHBhdGggaW5kZXggcmVzb2x2ZXMgaXQuXG4gICAgICBjb25zdCBzY29wZWQgPSByZXBvUm9vdCA/IGFyZ3MubWFwKChhKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYSkpIDogYXJncztcbiAgICAgIGxldCBvdXQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNjb3BlZF0sIHtcbiAgICAgICAgICBjd2Q6IHJ1bkN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgaWYgKHR5cGVvZiBjYXB0dXJlZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICBvdXQgPSBjYXB0dXJlZDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZURyaWZ0UG9yY2VsYWluKG91dCk7XG4gICAgfSxcblxuICAgIHdoeTogYXN5bmMgKG5hbWUsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3doeScsIG5hbWVdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCA/PyBjd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB0ZXh0ID0gb3V0LnRyaW1FbmQoKTtcbiAgICAgICAgLy8gQmFyZSBgZ2l0IHNwYW4gd2h5YCBwcmludHMgdGhpcyBleGFjdCBzZW50aW5lbCAoZXhpdCAwKSB3aGVuIHRoZVxuICAgICAgICAvLyBzcGFuIGhhcyBubyB3aHkgcmVjb3JkZWQgXHUyMDE0IHRyZWF0IGl0IGFzIFwibm8gd2h5XCIsIG5vdCBhcyBjb250ZW50LlxuICAgICAgICBpZiAodGV4dC5sZW5ndGggPT09IDAgfHwgdGV4dCA9PT0gYFxcYCR7bmFtZX1cXGAgaGFzIG5vIHdoeSByZWNvcmRlZC5gKSByZXR1cm4gbnVsbDtcbiAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGJveC1kcmF3aW5nIHRyZWUgcmVuZGVyZXIgZm9yIGEgc3BhbidzIGFuY2hvciBsaXN0LCB1c2VkIGJ5IGV2ZXJ5XG4gKiBjYWxsIHNpdGUgdGhhdCB0b2RheSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHN0YXJ0LUxlbmRgIGJ1bGxldCBydW5cbiAqIChgdG91Y2gtY29yZS50c2AncyBgYW5jaG9yQnVsbGV0c2AsIGFuZCBgYWR2aXNvci1jb3JlLnRzYCdzXG4gKiBgYW5ub3RhdGVCbG9ja3NgL2Bncm91cENvdmVyaW5nQnlOYW1lYCkuIEFuY2hvcnMgdGhhdCBzaGFyZSBhIGRpcmVjdG9yeVxuICogcHJlZml4IGNvbGxhcHNlIGludG8gb25lIHRyZWUgaW5zdGVhZCBvZiBiZWluZyByZWNvbnN0cnVjdGVkIGJ5IGV5ZSBmcm9tIGFcbiAqIGZsYXQgbGlzdCBcdTIwMTQgdGhlIG1vdGl2YXRpbmcgY2FzZSBpcyBwYXJpdHkgYW5jaG9ycyB1bmRlciBwYXJhbGxlbFxuICogYHB1YmxpYy9jbGF1ZGUvLi4uYC9gcHVibGljL2NvZGV4Ly4uLmAgdHJlZXMuXG4gKlxuICogVGhpcyBtb2R1bGUgaXMgYSBwdXJlIHByZXNlbnRhdGlvbiB0cmFuc2Zvcm06IGl0IG5ldmVyIGNvbXB1dGVzIGRyaWZ0XG4gKiBzdGF0dXMgb3IgZGVjaWRlcyB3aGljaCBhbmNob3JzIGFyZSBzdXJmYWNlZC4gQ2FsbGVycyBwcmVjb21wdXRlIGVhY2ggcm93J3NcbiAqIGBzdWZmaXhgIChlLmcuIGAgXHUyMDE0IGNoYW5nZWRgKSBleGFjdGx5IGFzIHRoZXkgZG8gdG9kYXksIGFuZCBvbmx5IHRoZSAqc2hhcGUqXG4gKiBvZiB0aGUgcHJpbnRlZCBsaXN0IGNoYW5nZXMuXG4gKi9cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgdHlwZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEhvdyBhIHNpbmdsZSBhbmNob3IncyBsaW5lIHJhbmdlIGlzIGtub3duLiBgcmFuZ2VgIGFuZCBgd2hvbGUtZmlsZWAgYXJlIHRoZVxuICogdHdvIHNoYXBlcyBldmVyeSBhbmNob3IgdGFrZXMgdG9kYXk7IGB0cnVuY2F0ZWRgIGlzIGEgZGVmZW5zaXZlIHRoaXJkIHNoYXBlXG4gKiByZWFjaGFibGUgb25seSBmcm9tIHJlLXBhcnNpbmcgdGhlIENMSSdzIGZsYXQgaHVtYW4tZm9ybWF0IHRleHQgKGEgYCNMYFxuICogZnJhZ21lbnQgdGhhdCBkb2Vzbid0IGNsZWFubHkgbWF0Y2ggYCNMc3RhcnQtTGVuZGApLlxuICpcbiAqIFZlcmlmaWVkIGludmFyaWFudDogdGhlIHN0cnVjdHVyZWQtZGF0YSBjYWxsIHNpdGVzIGNhbiBuZXZlciBwcm9kdWNlXG4gKiBgdHJ1bmNhdGVkYC4gYHBhcnNlUG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSBgY29udGludWVgcyBwYXN0IGFueVxuICogcm93IG1pc3NpbmcgYSB2YWxpZCByYW5nZSwgc28gYW4gaW5jb21wbGV0ZSBgUG9yY2VsYWluUm93YCBjYW4gbmV2ZXIgYmVcbiAqIGNvbnN0cnVjdGVkOyB0aGUgUnVzdCBDTEkncyBvd24gcG9yY2VsYWluIHdyaXRlciBhbHdheXMgZW1pdHMgYSByYW5nZVxuICogY29sdW1uIChgMC0wYCBmb3Igd2hvbGUtZmlsZSkuIGB0cnVuY2F0ZWRgIGlzIHJlYWNoYWJsZSBvbmx5IGZyb21cbiAqIGBhbm5vdGF0ZUJsb2Nrc2AnIGZsYXQtdGV4dCBwYXJzaW5nIG9mIGBibG9ja3NUZXh0YCBpbiBhIGxhdGVyIHBoYXNlLlxuICovXG5leHBvcnQgdHlwZSBSYW5nZUxhYmVsID0geyBraW5kOiAncmFuZ2UnOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgeyBraW5kOiAnd2hvbGUtZmlsZScgfSB8IHsga2luZDogJ3RydW5jYXRlZCcgfTtcblxuLyoqIE9uZSBzdGFja2VkIHJhbmdlIHVuZGVyIGEgYFRyZWVBbmNob3JgLCB3aXRoIGl0cyBwcmVjb21wdXRlZCBkcmlmdCBzdWZmaXguICovXG5leHBvcnQgaW50ZXJmYWNlIFJhbmdlRW50cnkge1xuICByYW5nZTogUmFuZ2VMYWJlbDtcbiAgLyoqIFByZWNvbXB1dGVkIGAgXHUyMDE0IGNoYW5nZWRgIChldGMuKSwgb3IgYCcnYCB3aGVuIHRoZSBhbmNob3IgY2FycmllcyBubyBkcmlmdC4gKi9cbiAgc3VmZml4OiBzdHJpbmc7XG59XG5cbi8qKiBPbmUgZGlzdGluY3QgcGF0aCdzIGNvbGxhcHNlZCBhbmNob3IgZW50cnksIHJlYWR5IGZvciB0cmVlIGxheW91dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVHJlZUFuY2hvciB7XG4gIC8qKiBSZXBvLXJlbGF0aXZlLCBwb3NpeC1zZXBhcmF0ZWQgcGF0aC4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogU3RhY2tlZCByYW5nZXMgb24gdGhpcyBwYXRoLiBFbXB0eSBtZWFucyBcInBhdGggb25seSwgbm8gcmFuZ2UgY29sdW1uIGF0XG4gICAqIGFsbFwiIFx1MjAxNCBhIGJhcmUtcGF0aCBsZWFmLCBkaXN0aW5jdCBmcm9tIGEgc2luZ2xlIGB3aG9sZS1maWxlYCBlbnRyeSAod2hpY2hcbiAgICogcmVuZGVycyB0aGUgcGF0aCB0b28sIGJ1dCBpcyBhbiBleHBsaWNpdCByYW5nZS1raW5kIGNsYXNzaWZpY2F0aW9uKS5cbiAgICovXG4gIHJhbmdlczogUmFuZ2VFbnRyeVtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGNvbGxhcHNlQnlQYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDb2xsYXBzZSByb3dzIHRoYXQgbmFtZSB0aGUgc2FtZSBwYXRoIGludG8gb25lIGBUcmVlQW5jaG9yYCB3aXRoIHN0YWNrZWRcbiAqIHJhbmdlcywgcHJlc2VydmluZyBmaXJzdC1zZWVuIG9yZGVyLiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlc1xuICogYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlciBkaXN0aW5jdCBwYXRoIFx1MjAxNCB0aGlzIGlzIHRoZSBtYW5kYXRvcnlcbiAqIHByZS1wcm9jZXNzaW5nIHN0ZXAgZXZlcnkgY2FsbGVyIHJ1bnMgZmlyc3QgdG8gZ3VhcmFudGVlIHRoYXQuXG4gKlxuICogTWlycm9ycyB0aGUgb3JkZXItYXJyYXktcGx1cy1NYXAgaWRpb20gYWxyZWFkeSB1c2VkIGJ5XG4gKiBgZGVkdXBlQnlBbmNob3IoKWAgKGFkdmlzb3ItY29yZS50cykgZm9yIHRoZSBzYW1lIHJlYXNvbjogdGhlIENMSSBjYW4gZW1pdFxuICogbXVsdGlwbGUgcm93cyBmb3Igb25lIGxvZ2ljYWwgcGF0aCwgYW5kIHRoZSAqcG9zaXRpb24qIG9mIGEgbGF0ZXJcbiAqIHNhbWUtcGF0aCByb3cgaXMgc3Vic3VtZWQgaW50byB0aGF0IHBhdGgncyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgYXBwZW5kZWRcbiAqIGF0IGl0cyBvd24gbGF0ZXIgcG9zaXRpb24uIENvbmNyZXRlbHk6IGBhLnRzI0wxLUw1YCwgYGIudHMjTDEtTDVgLFxuICogYGEudHMjTDktTDEyYCBjb2xsYXBzZXMgdG8gYFthLnRzICh0d28gc3RhY2tlZCByYW5nZXMpLCBiLnRzIChvbmUgcmFuZ2UpXWBcbiAqIFx1MjAxNCBgYS50c2Agc2l0cyBhdCBwb3NpdGlvbiAwLCBpdHMgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGl0cyBsYXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29sbGFwc2VCeVBhdGgocm93czogeyBwYXRoOiBzdHJpbmc7IHJhbmdlOiBSYW5nZUxhYmVsOyBzdWZmaXg6IHN0cmluZyB9W10pOiBUcmVlQW5jaG9yW10ge1xuICBjb25zdCBvcmRlcjogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgYnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIFRyZWVBbmNob3I+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBsZXQgYW5jaG9yID0gYnlQYXRoLmdldChyb3cucGF0aCk7XG4gICAgaWYgKCFhbmNob3IpIHtcbiAgICAgIGFuY2hvciA9IHsgcGF0aDogcm93LnBhdGgsIHJhbmdlczogW10gfTtcbiAgICAgIGJ5UGF0aC5zZXQocm93LnBhdGgsIGFuY2hvcik7XG4gICAgICBvcmRlci5wdXNoKHJvdy5wYXRoKTtcbiAgICB9XG4gICAgYW5jaG9yLnJhbmdlcy5wdXNoKHsgcmFuZ2U6IHJvdy5yYW5nZSwgc3VmZml4OiByb3cuc3VmZml4IH0pO1xuICB9XG4gIHJldHVybiBvcmRlci5tYXAoKHBhdGgpID0+IGJ5UGF0aC5nZXQocGF0aCkgYXMgVHJlZUFuY2hvcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVHJlZSBjb25zdHJ1Y3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgTGVhZk5vZGUge1xuICBraW5kOiAnbGVhZic7XG4gIG5hbWU6IHN0cmluZztcbiAgYW5jaG9yOiBUcmVlQW5jaG9yO1xufVxuXG5pbnRlcmZhY2UgRGlyTm9kZSB7XG4gIGtpbmQ6ICdkaXInO1xuICBuYW1lOiBzdHJpbmc7XG4gIGNoaWxkcmVuOiBQYXRoVHJlZU5vZGVbXTtcbn1cblxudHlwZSBQYXRoVHJlZU5vZGUgPSBMZWFmTm9kZSB8IERpck5vZGU7XG5cbi8qKlxuICogU3BsaXQgYSBwYXRoIGludG8gYC9gLXNlcGFyYXRlZCBzZWdtZW50cywgb3IgYG51bGxgIHdoZW4gZG9pbmcgc28gd291bGRcbiAqIGZlZWQgYW4gZW1wdHktc3RyaW5nIHNlZ21lbnQgaW50byB0aGUgdHJpZSAoYSBsZWFkaW5nIGAvYCwgYSB0cmFpbGluZyBgL2AsXG4gKiBhIGRvdWJsZWQgYC8vYCwgb3IgdGhlIGVtcHR5IHN0cmluZykuIGBudWxsYCBzaWduYWxzIHRoZSBjYWxsZXIgdG8gcmVuZGVyXG4gKiB0aGF0IGFuY2hvcidzIGZ1bGwgcGF0aCBzdHJpbmcgYXMgYSBzaW5nbGUsIHVuc3BsaXQsIGF0b21pYyB0b3AtbGV2ZWwgbGVhZlxuICogaW5zdGVhZCBvZiBhdHRlbXB0aW5nIHRvIG5lc3QgaXQgXHUyMDE0IGEga25vd24tZW51bWVyYWJsZSBjbGFzcyBvZiBtYWxmb3JtZWRcbiAqIHBhdGhzIGdldHMgYSByZWFsIHJ1bGUgaGVyZSByYXRoZXIgdGhhbiB0aGUgc3BsaXQgcnVubmluZyBhbnl3YXkgYW5kXG4gKiBmYWJyaWNhdGluZyBhbiBlbXB0eS1uYW1lZCBkaXJlY3Rvcnkgbm9kZS4gQSBiYXJlIGZpbGVuYW1lIHdpdGggbm8gYC9gIGF0XG4gKiBhbGwgcHJvZHVjZXMgZXhhY3RseSBvbmUgbm9uLWVtcHR5IHNlZ21lbnQgYW5kIGlzIGhhbmRsZWQgYnkgdGhlIG9yZGluYXJ5XG4gKiBwYXRoIGJlbG93IChpdCBiZWNvbWVzIGEgdG9wLWxldmVsIGxlYWYgd2l0aCBubyBkaXJlY3RvcnkgdG8gbmVzdCB1bmRlciBcdTIwMTRcbiAqIGFscmVhZHkgYXRvbWljLCBubyBzcGVjaWFsIGNhc2UgbmVlZGVkKS5cbiAqL1xuZnVuY3Rpb24gc3BsaXRTZWdtZW50cyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBzZWdtZW50cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IHNlZ21lbnQubGVuZ3RoID09PSAwKSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBzZWdtZW50cztcbn1cblxuZnVuY3Rpb24gZmluZE9yQ3JlYXRlRGlyKHBhcmVudDogRGlyTm9kZSwgbmFtZTogc3RyaW5nKTogRGlyTm9kZSB7XG4gIGZvciAoY29uc3QgY2hpbGQgb2YgcGFyZW50LmNoaWxkcmVuKSB7XG4gICAgaWYgKGNoaWxkLmtpbmQgPT09ICdkaXInICYmIGNoaWxkLm5hbWUgPT09IG5hbWUpIHJldHVybiBjaGlsZDtcbiAgfVxuICBjb25zdCBub2RlOiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZSwgY2hpbGRyZW46IFtdIH07XG4gIHBhcmVudC5jaGlsZHJlbi5wdXNoKG5vZGUpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuLyoqIEluc2VydCBvbmUgYW5jaG9yIGludG8gdGhlIHRyaWUsIGNyZWF0aW5nL3JldXNpbmcgZGlyZWN0b3J5IG5vZGVzIGluIGFycml2YWwgb3JkZXIuICovXG5mdW5jdGlvbiBpbnNlcnRBbmNob3Iocm9vdDogRGlyTm9kZSwgc2VnbWVudHM6IHN0cmluZ1tdLCBhbmNob3I6IFRyZWVBbmNob3IpOiB2b2lkIHtcbiAgbGV0IGN1ciA9IHJvb3Q7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgY3VyID0gZmluZE9yQ3JlYXRlRGlyKGN1ciwgc2VnbWVudHNbaV0pO1xuICB9XG4gIGN1ci5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXSwgYW5jaG9yIH0pO1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSB0b3AtbGV2ZWwgZm9yZXN0IGZyb20gYSBgVHJlZUFuY2hvcltdYCBhbHJlYWR5IGNvbGxhcHNlZCBieVxuICogYGNvbGxhcHNlQnlQYXRoYC4gU2libGluZyBvcmRlciBpcyBuZXZlciByZS1zb3J0ZWQgXHUyMDE0IGEgcGF0aCBlaXRoZXIgb3BlbnMgYVxuICogbmV3IG5vZGUgYXQgaXRzIGFycml2YWwgcG9zaXRpb24gb3IgaXMgbmVzdGVkIHVuZGVyIGEgZGlyZWN0b3J5IG5vZGVcbiAqIGNyZWF0ZWQvcmV1c2VkIGF0IHRoYXQgZGlyZWN0b3J5J3Mgb3duIGZpcnN0LW9jY3VycmVuY2UgcG9zaXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRm9yZXN0KGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IFBhdGhUcmVlTm9kZVtdIHtcbiAgY29uc3Qgcm9vdDogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWU6ICcnLCBjaGlsZHJlbjogW10gfTtcbiAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgIGNvbnN0IHNlZ21lbnRzID0gc3BsaXRTZWdtZW50cyhhbmNob3IucGF0aCk7XG4gICAgaWYgKHNlZ21lbnRzID09PSBudWxsKSB7XG4gICAgICByb290LmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IGFuY2hvci5wYXRoLCBhbmNob3IgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaW5zZXJ0QW5jaG9yKHJvb3QsIHNlZ21lbnRzLCBhbmNob3IpO1xuICB9XG4gIHJldHVybiByb290LmNoaWxkcmVuO1xufVxuXG4vKiogQSBub2RlIHBhaXJlZCB3aXRoIHRoZSAocG9zc2libHkgZm9sZGVkKSBuYW1lIGl0IGRpc3BsYXlzIG9uIGl0cyBvd24gbGluZS4gKi9cbmludGVyZmFjZSBEaXNwbGF5SXRlbSB7XG4gIG5hbWU6IHN0cmluZztcbiAgbm9kZTogUGF0aFRyZWVOb2RlO1xufVxuXG4vKipcbiAqIEZvbGQgYSBjaGFpbiBvZiBzaW5nbGUtY2hpbGQgbm9kZXMgaW50byBvbmUgY29tYmluZWQgbmFtZVxuICogKGBwdWJsaWMvY2xhdWRlL3J1bnRpbWUvc2tpbGxzL2NhcmRgLCBgZGlydHkvbW9kLnJzYCxcbiAqIGAuZGV2Y29udGFpbmVyL0RvY2tlcmZpbGVgKS4gRm9sZGluZyBjb250aW51ZXMgd2hpbGUgdGhlIGN1cnJlbnQgbm9kZSBpcyBhXG4gKiBkaXJlY3Rvcnkgd2l0aCAqKmV4YWN0bHkgb25lIGNoaWxkKiosIHJlZ2FyZGxlc3Mgb2Ygd2hldGhlciB0aGF0IGNoaWxkIGlzIGFcbiAqIGRpcmVjdG9yeSBvciBhIGxlYWY6IGEgbm9kZSB3aXRoIG9uZSBjaGlsZCBjb252ZXlzIG5vIGdyb3VwaW5nIGJ5XG4gKiBkZWZpbml0aW9uLCBzbyBmb2xkaW5nIGl0IGxvc2VzIG5vIHN0cnVjdHVyZSB3aGlsZSByZW1vdmluZyBhIGxpbmUgd2hvc2VcbiAqIG9ubHkgY29udGVudCBpcyBhIGNvbm5lY3Rvci4gU3RvcHMgYXQgdGhlIGZpcnN0IGRpcmVjdG9yeSB3aXRoIDIrIGNoaWxkcmVuXG4gKiAoZXhwYW5kIGZyb20gdGhlcmUpIG9yIGF0IGEgbGVhZiAod2hpY2ggdGhlbiByZW5kZXJzIHdpdGggdGhlIGZvbGRlZCBuYW1lKS5cbiAqXG4gKiBGb2xkaW5nIGxvbmUgKmxlYXZlcyogXHUyMDE0IG5vdCBqdXN0IGxvbmUgZGlyZWN0b3JpZXMgXHUyMDE0IGlzIHdoYXQga2VlcHMgdGhlIHRyZWVcbiAqIG5vIHRhbGxlciB0aGFuIHRoZSBmbGF0IGJ1bGxldCBsaXN0IGl0IHJlcGxhY2VzLCBhbmQgd2hhdCBtYWtlcyBhIHNpbmdsZVxuICogYW5jaG9yIHJlbmRlciBhcyB0aGUgb25lLWxpbmUgdHJlZSB0aGUgcGxhbiBwcm9taXNlcyBldmVuIHdoZW4gaXRzIHBhdGggaGFzXG4gKiBkaXJlY3RvcmllcyBpbiBpdC4gSXQgYWxzbyBrZWVwcyB0aGUgZGlzY3JpbWluYXRpbmcgc2VnbWVudCBvbiB0aGUgc2FtZVxuICogbGluZSBhcyBpdHMgcmFuZ2UgKGBkaXJ0eS9tb2QucnMgI0wzOTItTDM5OWApIGZvciBgbW9kLnJzYC9gaW5kZXgudHNgXG4gKiBsYXlvdXRzLCB3aGVyZSB0aGUgZmlsZW5hbWUgYWxvbmUgaWRlbnRpZmllcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBmb2xkQ2hhaW4obm9kZTogUGF0aFRyZWVOb2RlKTogRGlzcGxheUl0ZW0ge1xuICBsZXQgbmFtZSA9IG5vZGUubmFtZTtcbiAgbGV0IGN1ciA9IG5vZGU7XG4gIHdoaWxlIChjdXIua2luZCA9PT0gJ2RpcicgJiYgY3VyLmNoaWxkcmVuLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IGNoaWxkID0gY3VyLmNoaWxkcmVuWzBdO1xuICAgIG5hbWUgPSBgJHtuYW1lfS8ke2NoaWxkLm5hbWV9YDtcbiAgICBjdXIgPSBjaGlsZDtcbiAgfVxuICByZXR1cm4geyBuYW1lLCBub2RlOiBjdXIgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJhbmsgb2YgYSBzdGFja2VkIGVudHJ5J3MgcmFuZ2Uga2luZDogYHdob2xlLWZpbGVgIGZpcnN0LCB0aGVuIG51bWVyaWNcbiAqIGByYW5nZWBzLCB0aGVuIGB0cnVuY2F0ZWRgLiBBIHdob2xlLWZpbGUgYW5jaG9yIGlzIHRoZSBDTEkncyBgMC0wYCByb3cgXHUyMDE0IGl0XG4gKiBjb3ZlcnMgdGhlIGVudGlyZSBmaWxlLCBzbyBpdCBzb3J0cyBhaGVhZCBvZiBldmVyeSBsaW5lIHJhbmdlIG9uIHRoYXQgZmlsZVxuICogdGhlIHNhbWUgd2F5IGxpbmUgMCB3b3VsZC4gYHRydW5jYXRlZGAgY2FycmllcyBubyBwb3NpdGlvbiBhdCBhbGwgYW5kIHNvcnRzXG4gKiBsYXN0LlxuICovXG5mdW5jdGlvbiByYW5nZVJhbmsocmFuZ2U6IFJhbmdlTGFiZWwpOiBudW1iZXIge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiAwO1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiAxO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gMjtcbiAgfVxufVxuXG4vKipcbiAqIFN0YWNrZWQtcmFuZ2Ugb3JkZXIgaXMgYnkga2luZCByYW5rIHRoZW4gbnVtZXJpYyAoYHN0YXJ0YCB0aGVuIGBlbmRgKSxcbiAqIG92ZXJyaWRpbmcgYXJyaXZhbCBvciBjb2RlcG9pbnQgb3JkZXIgXHUyMDE0IHRoZSBvbmx5IHNvcnRpbmcgdGhpcyBtb2R1bGUgZG9lcyxcbiAqIGFuZCBzY29wZWQgc3RyaWN0bHkgdG8gcmFuZ2VzIHN0YWNrZWQgb24gb25lIHBhdGggKG5ldmVyIHRvIHNpYmxpbmcgcGF0aHNcbiAqIG9yIGRpcmVjdG9yeSBvcmRlcikuIEVxdWFsLXJhbmtlZCBlbnRyaWVzICh0d28gYHRydW5jYXRlZGBzLCBvciB0d29cbiAqIGlkZW50aWNhbCByYW5nZXMpIGtlZXAgdGhlaXIgb3duIHJlbGF0aXZlIGFycml2YWwgb3JkZXIsIHNpbmNlIHRoZSBzb3J0IGlzXG4gKiBzdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGNvbXBhcmVSYW5nZUVudHJpZXMoYTogUmFuZ2VFbnRyeSwgYjogUmFuZ2VFbnRyeSk6IG51bWJlciB7XG4gIGNvbnN0IHJhbmsgPSByYW5nZVJhbmsoYS5yYW5nZSkgLSByYW5nZVJhbmsoYi5yYW5nZSk7XG4gIGlmIChyYW5rICE9PSAwKSByZXR1cm4gcmFuaztcbiAgaWYgKGEucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJyAmJiBiLnJhbmdlLmtpbmQgPT09ICdyYW5nZScpIHtcbiAgICByZXR1cm4gYS5yYW5nZS5zdGFydCAtIGIucmFuZ2Uuc3RhcnQgfHwgYS5yYW5nZS5lbmQgLSBiLnJhbmdlLmVuZDtcbiAgfVxuICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBUaGUgcmFuZ2UgY29sdW1uJ3MgdGV4dCwgb3IgYG51bGxgIHdoZW4gdGhlIGVudHJ5IHByaW50cyBhcyBhIGJhcmUgcGF0aFxuICogd2l0aCBubyByYW5nZSBjb2x1bW4gYXQgYWxsLlxuICpcbiAqIEEgYHdob2xlLWZpbGVgIGVudHJ5IGlzIHRoZSBvbmUga2luZCB3aG9zZSByZW5kZXJpbmcgZGVwZW5kcyBvbiBjb250ZXh0LlxuICogQWxvbmUgb24gaXRzIHBhdGggaXQgc3RheXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciBcdTIwMTQgdGhhdCBpcyB3aGF0IHRoZVxuICogQ0xJJ3Mgb3duIGZsYXQgbGlzdCBwcmludHMgZm9yIGEgd2hvbGUtZmlsZSBhbmNob3IsIGFuZCBhZGRpbmcgYSBtYXJrZXJcbiAqIHRoZXJlIHdvdWxkIGFubm90YXRlIHRoZSBvdmVyd2hlbG1pbmdseSBjb21tb24gY2FzZSBmb3IgdGhlIGJlbmVmaXQgb2YgdGhlXG4gKiByYXJlIG9uZS4gKlN0YWNrZWQqIGJlaGluZCBvdGhlciByYW5nZXMgb24gdGhlIHNhbWUgcGF0aCBpdCBtdXN0IGNhcnJ5IGFuXG4gKiBleHBsaWNpdCBtYXJrZXI6IHdpdGhvdXQgb25lIGl0IHJlbmRlcnMgYXMgYSBjb250aW51YXRpb24gbGluZSBob2xkaW5nXG4gKiBub3RoaW5nIGJ1dCBpbmRlbnRhdGlvbiBhbmQgaXRzIGRyaWZ0IHN1ZmZpeCwgd2hpY2ggZXJhc2VzIHRoZSBhbmNob3JcbiAqIG91dHJpZ2h0IHdoZW4gdGhlIHN1ZmZpeCBpcyBlbXB0eSBhbmQgXHUyMDE0IHdvcnNlIFx1MjAxNCBoYW5ncyBpdHMgYCBcdTIwMTQgY2hhbmdlZGBcbiAqIHVuZGVyIGEgbmVpZ2hib3VyaW5nIHJhbmdlLCBleGFjdGx5IHRoZSB2aXN1YWwgZ3JhbW1hciB0aGF0IG1lYW5zIFwiYW5vdGhlclxuICogcmFuZ2Ugb24gdGhpcyBzYW1lIGZpbGVcIi4gVGhlIHJlYWRlciB3b3VsZCB0aGVuIHJlY29uY2lsZSB0aGUgcmFuZ2UgdGhhdFxuICogZGlkIG5vdCBkcmlmdC4gT2YgdGhlIHRocmVlIGZpeGVzIGF2YWlsYWJsZSAocHJpbnQgdGhlIHBhdGggb25cbiAqIGNvbnRpbnVhdGlvbiBsaW5lcywgc29ydCB3aG9sZS1maWxlIHRvIHBvc2l0aW9uIDAsIG9yIHNwbGl0IGl0IGludG8gaXRzIG93blxuICogbGVhZiksIGFuIGV4cGxpY2l0IG1hcmtlciBpcyB0aGUgb25seSBvbmUgdGhhdCBtYWtlcyB0aGUgZW50cnkgaWRlbnRpZmlhYmxlXG4gKiBpbiAqZXZlcnkqIHBvc2l0aW9uIHJhdGhlciB0aGFuIG9ubHkgaW4gdGhlIHBvc2l0aW9uIHRoZSBzb3J0IGhhcHBlbnMgdG9cbiAqIHB1dCBpdCBpbjsgc29ydGluZyBpdCBmaXJzdCAoc2VlIHtAbGluayByYW5nZVJhbmt9KSBpcyBrZXB0IGFzIHdlbGwgYmVjYXVzZVxuICogXCJ3aG9sZSBmaWxlLCB0aGVuIGl0cyByYW5nZXMgaW4gbGluZSBvcmRlclwiIGlzIHRoZSBvcmRlciBhIHJlYWRlciBleHBlY3RzLFxuICogbm90IGJlY2F1c2UgaWRlbnRpZmlhYmlsaXR5IGRlcGVuZHMgb24gaXQuXG4gKi9cbmZ1bmN0aW9uIGxhYmVsRm9yKHJhbmdlOiBSYW5nZUxhYmVsLCBzb2xlOiBib29sZWFuKTogc3RyaW5nIHwgbnVsbCB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiBgI0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiBzb2xlID8gbnVsbCA6ICcod2hvbGUgZmlsZSknO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gJyh0cnVuY2F0ZWQgaW4gc291cmNlIFx1MjAxNCBhbmNob3IgaW5jb21wbGV0ZSknO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29sdW1uIG1hdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBncmFwaGVtZSBzZWdtZW50ZXIsIGNvbnN0cnVjdGVkIG9uIGZpcnN0IHVzZSBhbmQgdGhlbiBjYWNoZWQgXHUyMDE0IGluY2x1ZGluZ1xuICogYSBjYWNoZWQgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIGNvbnN0cnVjdGVkIGF0IGFsbC5cbiAqXG4gKiBMYXp5IG9uIHB1cnBvc2UuIGBJbnRsYCBpcyBub3QgcGFydCBvZiB0aGUgSmF2YVNjcmlwdCBsYW5ndWFnZSBjb3JlOiBhIE5vZGVcbiAqIGJ1aWx0IGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCB3aGF0c29ldmVyLCBhbmQgYGhvb2tzLmpzb25gXG4gKiBpbnZva2VzIGEgYmFyZSBgbm9kZWAgb2ZmIHRoZSB1c2VyJ3MgYFBBVEhgLCBzbyBgZW5naW5lcy5ub2RlYCBjb25zdHJhaW5zXG4gKiBub3RoaW5nIGhlcmUuIENvbnN0cnVjdGluZyB0aGlzIGF0IG1vZHVsZSBzY29wZSBwdXQgYSBgUmVmZXJlbmNlRXJyb3JgIGluXG4gKiB0aGUgYnVuZGxlcycgdG9wLWxldmVsIHN0YXRlbWVudHMsIHdoZXJlIGl0IHRocm93cyBhdCAqaW1wb3J0KiBcdTIwMTQgYmVmb3JlIGFueVxuICogb2YgdGhlIGZhaWwtY2xvc2VkIGB0cnkvY2F0Y2hgIGJsb2NrcyBpbiBgcmVuZGVyQW5jaG9yUnVuYCwgYHJlbmRlclBhdGhSdW5gXG4gKiBhbmQgYGFuY2hvckJ1bGxldHNgIGV4aXN0IHRvIGNhdGNoIGl0LiBUaGUgaG9vayBwcm9jZXNzIHRoZW4gZGllZCB3aXRoIGV4aXRcbiAqIDEsIHdoaWNoIENsYXVkZSBDb2RlIHRyZWF0cyBhcyBhIG5vbi1ibG9ja2luZyBob29rIGVycm9yOiB0aGUgY29tbWl0IGdhdGVcbiAqIHNpbGVudGx5IGFsbG93ZWQgdGhlIGNvbW1pdCBhbmQgdGhlIGRyaWZ0IHJlbWluZGVyIHNpbGVudGx5IHZhbmlzaGVkLlxuICogQnVpbGRpbmcgaXQgaW5zaWRlIHRoZSByZW5kZXIgcGF0aCBwdXRzIGFueSBmYWlsdXJlIGJhY2sgaW5zaWRlIHRob3NlXG4gKiBjYXRjaGVzLlxuICpcbiAqIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IHRoZSBzYW1lIGNhdGVnb3J5IGFzXG4gKiB0aGUgbG9jYWwgYHRyeS9jYXRjaGAgYmxvY2tzIGF0IHRoaXMgbW9kdWxlJ3MgY2FsbCBzaXRlcywgYW5kIGxvYWQtYmVhcmluZ1xuICogZm9yIHRoZSBzYW1lIHJlYXNvbi4gTm90aGluZyBpbiB0aGUgY29sdW1uLWFsaWdubWVudCBwYXRoIG1heSBiZSBhYmxlIHRvXG4gKiBjb3N0IHRoZSBjb21taXQgZ2F0ZSBvciB0aGUgZHJpZnQgcmVtaW5kZXI6IGlmIGRpc3BsYXkgd2lkdGggY2Fubm90IGJlXG4gKiBtZWFzdXJlZCwgdGhlIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgZ2F0ZSBzdGlsbCBob2xkczsgb25seSBhbGlnbm1lbnQgaXNcbiAqIGxvc3QuXG4gKi9cbmxldCBjYWNoZWRTZWdtZW50ZXI6IHsgdmFsdWU6IEludGwuU2VnbWVudGVyIHwgbnVsbCB9IHwgdW5kZWZpbmVkO1xuXG5mdW5jdGlvbiBncmFwaGVtZVNlZ21lbnRlcigpOiBJbnRsLlNlZ21lbnRlciB8IG51bGwge1xuICBpZiAoY2FjaGVkU2VnbWVudGVyID09PSB1bmRlZmluZWQpIHtcbiAgICB0cnkge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbmV3IEludGwuU2VnbWVudGVyKCdlbicsIHsgZ3JhbnVsYXJpdHk6ICdncmFwaGVtZScgfSkgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG51bGwgfTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNhY2hlZFNlZ21lbnRlci52YWx1ZTtcbn1cblxuLyoqXG4gKiBDb2RlIHBvaW50IHJhbmdlcyByZW5kZXJlZCB0d28gY29sdW1ucyB3aWRlOiB0aGUgRWFzdCBBc2lhbiBXaWRlIChXKSBhbmRcbiAqIEZ1bGx3aWR0aCAoRikgYmxvY2tzIG9mIFVBWCAjMTEsIHBsdXMgdGhlIGVtb2ppIGJsb2NrcyB0aGF0IHRlcm1pbmFscyBhbmRcbiAqIHByb3BvcnRpb25hbCBhZ2VudC1mYWNpbmcgcmVuZGVyZXJzIGJvdGggZ2l2ZSBkb3VibGUgd2lkdGguIEV2ZXJ5dGhpbmcgZWxzZVxuICogY291bnRzIGFzIG9uZSBjb2x1bW4uXG4gKlxuICogU29ydGVkIGFzY2VuZGluZyBhbmQgbm9uLW92ZXJsYXBwaW5nIFx1MjAxNCB7QGxpbmsgaXNXaWRlQ29kZVBvaW50fSBzaG9ydC1jaXJjdWl0c1xuICogb24gdGhlIGZpcnN0IHJhbmdlIHN0YXJ0aW5nIHBhc3QgdGhlIGNvZGUgcG9pbnQuXG4gKi9cbmNvbnN0IFdJREVfUkFOR0VTOiByZWFkb25seSAocmVhZG9ubHkgW251bWJlciwgbnVtYmVyXSlbXSA9IFtcbiAgWzB4MTEwMCwgMHgxMTVmXSxcbiAgWzB4MjMyOSwgMHgyMzJhXSxcbiAgWzB4MjYwMCwgMHgyN2JmXSxcbiAgWzB4MmU4MCwgMHgzMDNlXSxcbiAgWzB4MzA0MSwgMHgzM2ZmXSxcbiAgWzB4MzQwMCwgMHg0ZGJmXSxcbiAgWzB4NGUwMCwgMHg5ZmZmXSxcbiAgWzB4YTAwMCwgMHhhNGNmXSxcbiAgWzB4YTk2MCwgMHhhOTdmXSxcbiAgWzB4YWMwMCwgMHhkN2EzXSxcbiAgWzB4ZjkwMCwgMHhmYWZmXSxcbiAgWzB4ZmUxMCwgMHhmZTE5XSxcbiAgWzB4ZmUzMCwgMHhmZTZmXSxcbiAgWzB4ZmYwMCwgMHhmZjYwXSxcbiAgWzB4ZmZlMCwgMHhmZmU2XSxcbiAgWzB4MTcwMDAsIDB4MThhZmZdLFxuICBbMHgxZjFlNiwgMHgxZjFmZl0sXG4gIFsweDFmMzAwLCAweDFmNjRmXSxcbiAgWzB4MWY2ODAsIDB4MWY2ZmZdLFxuICBbMHgxZjkwMCwgMHgxZjlmZl0sXG4gIFsweDFmYTcwLCAweDFmYWZmXSxcbiAgWzB4MjAwMDAsIDB4MmZmZmRdLFxuICBbMHgzMDAwMCwgMHgzZmZmZF1cbl07XG5cbmZ1bmN0aW9uIGlzV2lkZUNvZGVQb2ludChjcDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgW2xvLCBoaV0gb2YgV0lERV9SQU5HRVMpIHtcbiAgICBpZiAoY3AgPCBsbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChjcCA8PSBoaSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIERpc3BsYXkgd2lkdGggb2YgYSBuYW1lIGluIHRlcm1pbmFsIGNvbHVtbnMgXHUyMDE0IHRoZSB1bml0IHRoZSByYW5nZSBjb2x1bW4gaXNcbiAqIGFjdHVhbGx5IGFsaWduZWQgaW4uIE1lYXN1cmVkIG92ZXIgZ3JhcGhlbWUgY2x1c3RlcnMgKHNvIGEgZGVjb21wb3NlZCBgXHUwMEU5YFxuICogb3IgYSBjb21iaW5pbmctbWFyayBzZXF1ZW5jZSBjb3VudHMgb25jZSwgbm90IG9uY2UgcGVyIGNvZGUgcG9pbnQpLCB3aXRoXG4gKiBlYWNoIGNsdXN0ZXIgY29udHJpYnV0aW5nIHR3byBjb2x1bW5zIHdoZW4gaXRzIGJhc2UgY29kZSBwb2ludCBpcyBFYXN0XG4gKiBBc2lhbiBXaWRlL0Z1bGx3aWR0aCBvciBlbW9qaSBhbmQgb25lIG90aGVyd2lzZS5cbiAqXG4gKiBOZWl0aGVyIFVURi0xNiBgLmxlbmd0aGAgbm9yIGBBcnJheS5mcm9tKG5hbWUpLmxlbmd0aGAgaXMgdGhpcyB1bml0OiB0aGVcbiAqIGZpcnN0IG92ZXItY291bnRzIGEgc3Vycm9nYXRlIHBhaXIsIHRoZSBzZWNvbmQgdW5kZXItY291bnRzIGEgQ0pLIGlkZW9ncmFwaFxuICogYW5kIG92ZXItY291bnRzIGEgZGVjb21wb3NlZCBhY2NlbnQuXG4gKlxuICogV2hlbiB7QGxpbmsgZ3JhcGhlbWVTZWdtZW50ZXJ9IGlzIHVuYXZhaWxhYmxlIChhIE5vZGUgYnVpbHRcbiAqIGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCBhdCBhbGwpLCB0aGlzIGRlZ3JhZGVzIHRvIHRoZSBjcnVkZXJcbiAqIHBlci1jb2RlLXBvaW50IG1lYXN1cmUgcmF0aGVyIHRoYW4gdGhyb3dpbmcuIFRoYXQgbWVhc3VyZSBvdmVyLWNvdW50cyBhXG4gKiBkZWNvbXBvc2VkIGFjY2VudCBhbmQgYSByZWdpb25hbC1pbmRpY2F0b3IgZmxhZyBwYWlyLCBzbyBhbGlnbm1lbnQgY2FuIGJlIGFcbiAqIGNvbHVtbiBvciB0d28gb2ZmIFx1MjAxNCB3aGljaCBpcyB0aGUgZW50aXJlIGNvc3QsIGFuZCBpcyB0aGUgY29ycmVjdCBwcmljZSB0b1xuICogcGF5OiB0aGUgYW5jaG9yIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgY29tbWl0IGdhdGUgc3RpbGwgaG9sZHMuXG4gKi9cbmZ1bmN0aW9uIGRpc3BsYXlXaWR0aChuYW1lOiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCBzZWdtZW50ZXIgPSBncmFwaGVtZVNlZ21lbnRlcigpO1xuICBsZXQgd2lkdGggPSAwO1xuICBpZiAoc2VnbWVudGVyID09PSBudWxsKSB7XG4gICAgZm9yIChjb25zdCBjb2RlUG9pbnQgb2YgbmFtZSkge1xuICAgICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KGNvZGVQb2ludC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICAgIH1cbiAgICByZXR1cm4gd2lkdGg7XG4gIH1cbiAgZm9yIChjb25zdCB7IHNlZ21lbnQgfSBvZiBzZWdtZW50ZXIuc2VnbWVudChuYW1lKSkge1xuICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChzZWdtZW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gIH1cbiAgcmV0dXJuIHdpZHRoO1xufVxuXG4vKipcbiAqIEFsaWdubWVudCBjZWlsaW5nLiBBIHNpYmxpbmcgZ3JvdXAgd2hvc2Ugd2lkZXN0IHJhbmdlLWJlYXJpbmcgbmFtZSBleGNlZWRzXG4gKiB0aGlzIHdpZHRoIGRvZXMgbm90IGFsaWduIGF0IGFsbCBcdTIwMTQgZXZlcnkgbmFtZSBpbiBpdCB0YWtlcyBhIHNpbmdsZSBzcGFjZVxuICogYmVmb3JlIGl0cyByYW5nZS4gVGhlIGFsdGVybmF0aXZlIChwYWQgdGhlIHNob3J0IG5hbWVzIHRvIHRoZSBjZWlsaW5nIHdoaWxlXG4gKiB0aGUgbG9uZyBvbmUgc2l0cyBhdCBpdHMgb3duIG5hdHVyYWwgY29sdW1uKSBwYXlzIG1vc3Qgb2YgdGhlIHdpZHRoIGZvclxuICogYWxpZ25tZW50IHRoYXQgYWxpZ25zIHdpdGggbm90aGluZywgd2hpY2ggaXMgc3RyaWN0bHkgd29yc2UgdGhhbiBub3RcbiAqIGFsaWduaW5nLiBOYW1lcyB0aGVtc2VsdmVzIGFyZSBuZXZlciB0cnVuY2F0ZWQgb3IgZWxpZGVkIGF0IGFueSB3aWR0aC5cbiAqL1xuY29uc3QgTUFYX0FMSUdOX0NPTFVNTiA9IDQ4O1xuXG4vKipcbiAqIFRoZSBjb2x1bW4gZXZlcnkgcmFuZ2UtYmVhcmluZyBuYW1lIGluIHRoaXMgc2libGluZyBncm91cCBwYWRzIHRvLCBvciBgMGBcbiAqIHdoZW4gdGhlIGdyb3VwIGZvcmdvZXMgYWxpZ25tZW50IChubyByYW5nZS1iZWFyaW5nIG5hbWVzLCBvciBhIG5hbWUgcGFzdFxuICoge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59KS4gQWxpZ25tZW50IHNjb3BlIGlzIHRoZSBncm91cCdzIGRpcmVjdCBjaGlsZHJlblxuICogb25seSwgbmV2ZXIgdGhlIHdob2xlIHRyZWUgXHUyMDE0IHdob2xlLXRyZWUgYWxpZ25tZW50IHdvdWxkIGxldCBvbmUgZGVlcGx5XG4gKiBuZXN0ZWQgbG9uZyBuYW1lIHBhZCBldmVyeSB1bnJlbGF0ZWQgYnJhbmNoLlxuICovXG5mdW5jdGlvbiBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXM6IERpc3BsYXlJdGVtW10pOiBudW1iZXIge1xuICBsZXQgbWF4ID0gMDtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicgJiYgcHJpbnRzUmFuZ2VDb2x1bW4oaXRlbS5ub2RlLmFuY2hvcikpIHtcbiAgICAgIG1heCA9IE1hdGgubWF4KG1heCwgZGlzcGxheVdpZHRoKGl0ZW0ubmFtZSkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWF4ID4gTUFYX0FMSUdOX0NPTFVNTiA/IDAgOiBtYXg7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGlzIGFuY2hvciBwcmludHMgYSByYW5nZSBjb2x1bW4gYXQgYWxsIFx1MjAxNCB0aGUgZXhhY3QgY29uZGl0aW9uXG4gKiB7QGxpbmsgbGFiZWxGb3J9IGVuY29kZXMsIGhvaXN0ZWQgc28ge0BsaW5rIGNvbXB1dGVHcm91cFRhcmdldH0gbWVhc3VyZXMgdGhlXG4gKiBzYW1lIHNldCBvZiBuYW1lcyBpdCBwYWRzLiBBbiBhbmNob3Igd2l0aCBubyByYW5nZXMsIG9yIGEgKnNvbGUqIHdob2xlLWZpbGVcbiAqIGVudHJ5ICh3aGljaCByZW5kZXJzIGFzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIpLCBjb250cmlidXRlcyBubyByYW5nZVxuICogY29sdW1uIGFuZCBzbyBtdXN0IG5vdCBjb250cmlidXRlIHRvIHRoZSBncm91cCBtYXggZWl0aGVyOiBvdGhlcndpc2UgYVxuICogd2hvbGUtZmlsZSBhbmNob3Igb24gYSBwYXRoIHBhc3Qge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59IHNpbGVudGx5IHN1cHByZXNzZXNcbiAqIGFsaWdubWVudCBmb3IgaXRzIHJhbmdlLWJlYXJpbmcgc2libGluZ3Mgd2hpbGUgaXRzZWxmIHByaW50aW5nIG5vdGhpbmcgdG9cbiAqIGFsaWduLlxuICovXG5mdW5jdGlvbiBwcmludHNSYW5nZUNvbHVtbihhbmNob3I6IFRyZWVBbmNob3IpOiBib29sZWFuIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHJhbmdlcy5zb21lKChlbnRyeSkgPT4gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHJhbmdlcy5sZW5ndGggPT09IDEpICE9PSBudWxsKTtcbn1cblxuLyoqIFRoZSBzcGFjaW5nIGJldHdlZW4gYSBuYW1lIG9mIGBuYW1lV2lkdGhgIGNvbHVtbnMgYW5kIGl0cyByYW5nZSBjb2x1bW4uICovXG5mdW5jdGlvbiBjb21wdXRlUGFkKG5hbWVXaWR0aDogbnVtYmVyLCB0YXJnZXQ6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmIChuYW1lV2lkdGggPj0gdGFyZ2V0KSByZXR1cm4gJyAnO1xuICByZXR1cm4gJyAnLnJlcGVhdCh0YXJnZXQgLSBuYW1lV2lkdGggKyAxKTtcbn1cblxuLyoqXG4gKiBSZW5kZXIgb25lIGxlYWYncyBsaW5lKHMpLiBBbiBlbXB0eSBgcmFuZ2VzYCBhcnJheSBpcyBhIGJhcmUtcGF0aCBsZWFmIHdpdGhcbiAqIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwgKGRpc3RpbmN0IGZyb20gYSBgd2hvbGUtZmlsZWAgZW50cnksIHdoaWNoIGlzIGFuXG4gKiBleHBsaWNpdCBjbGFzc2lmaWNhdGlvbiB0aGF0IGFsc28gcHJpbnRzIHdpdGggemVybyBtYXJrZXIgd2hlbiBpdCBzdGFuZHNcbiAqIGFsb25lLCBidXQgdGhyb3VnaCB0aGUgcmFuZ2VzIHBpcGVsaW5lKS4gTXVsdGlwbGUgc3RhY2tlZCByYW5nZXMgcHJpbnRcbiAqIHVuZGVyIGEgY29udGludWF0aW9uIHByZWZpeCBpbnN0ZWFkIG9mIHJlcGVhdGluZyB0aGUgbmFtZTsgZWFjaCBjYXJyaWVzIGl0c1xuICogb3duIHN1ZmZpeCBpbmRlcGVuZGVudGx5LCBhbmQgZWFjaCBjYXJyaWVzIGEgbGFiZWwgaWRlbnRpZnlpbmcgd2hpY2ggYW5jaG9yXG4gKiB0aGUgc3VmZml4IGJlbG9uZ3MgdG8uXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckxlYWZMaW5lcyhcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3I6IFRyZWVBbmNob3IsXG4gIG93blByZWZpeDogc3RyaW5nLFxuICBjaGlsZFByZWZpeDogc3RyaW5nLFxuICBncm91cFRhcmdldDogbnVtYmVyXG4pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW2Ake293blByZWZpeH0ke25hbWV9YF07XG5cbiAgY29uc3Qgc29ydGVkID0gWy4uLnJhbmdlc10uc29ydChjb21wYXJlUmFuZ2VFbnRyaWVzKTtcbiAgY29uc3Qgc29sZSA9IHNvcnRlZC5sZW5ndGggPT09IDE7XG4gIGNvbnN0IG5hbWVXaWR0aCA9IGRpc3BsYXlXaWR0aChuYW1lKTtcbiAgY29uc3QgcGFkID0gY29tcHV0ZVBhZChuYW1lV2lkdGgsIGdyb3VwVGFyZ2V0KTtcbiAgY29uc3QgYmxhbmsgPSAnICcucmVwZWF0KG5hbWVXaWR0aCArIHBhZC5sZW5ndGgpO1xuXG4gIHJldHVybiBzb3J0ZWQubWFwKChlbnRyeSwgaSkgPT4ge1xuICAgIGNvbnN0IGxhYmVsID0gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHNvbGUpO1xuICAgIGlmIChsYWJlbCA9PT0gbnVsbCkgcmV0dXJuIGAke293blByZWZpeH0ke25hbWV9JHtlbnRyeS5zdWZmaXh9YDtcbiAgICBjb25zdCBiYXNlID0gaSA9PT0gMCA/IGAke293blByZWZpeH0ke25hbWV9JHtwYWR9YCA6IGAke2NoaWxkUHJlZml4fSR7Ymxhbmt9YDtcbiAgICByZXR1cm4gYCR7YmFzZX0ke2xhYmVsfSR7ZW50cnkuc3VmZml4fWA7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJOb2Rlcyhub2RlczogUGF0aFRyZWVOb2RlW10sIHByZWZpeDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgaXRlbXMgPSBub2Rlcy5tYXAoZm9sZENoYWluKTtcbiAgY29uc3QgZ3JvdXBUYXJnZXQgPSBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXMpO1xuICBpdGVtcy5mb3JFYWNoKChpdGVtLCBpKSA9PiB7XG4gICAgY29uc3QgaXNMYXN0ID0gaSA9PT0gaXRlbXMubGVuZ3RoIC0gMTtcbiAgICBjb25zdCBvd25QcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnXHUyNTE0XHUyNTAwICcgOiAnXHUyNTFDXHUyNTAwICd9YDtcbiAgICBjb25zdCBjaGlsZFByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICcgICAnIDogJ1x1MjUwMiAgJ31gO1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnKSB7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlckxlYWZMaW5lcyhpdGVtLm5hbWUsIGl0ZW0ubm9kZS5hbmNob3IsIG93blByZWZpeCwgY2hpbGRQcmVmaXgsIGdyb3VwVGFyZ2V0KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpbmVzLnB1c2goYCR7b3duUHJlZml4fSR7aXRlbS5uYW1lfS9gKTtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTm9kZXMoaXRlbS5ub2RlLmNoaWxkcmVuLCBjaGlsZFByZWZpeCkpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsaW5lcztcbn1cblxuLyoqXG4gKiBSZW5kZXIgYSBjb2xsYXBzZWQgYW5jaG9yIGxpc3QgYXMgYSBib3gtZHJhd2luZyB0cmVlLCBncm91cGVkIGJ5IHNoYXJlZFxuICogcGF0aCBwcmVmaXguIEV2ZXJ5IGFuY2hvciBsaXN0IHJlbmRlcnMgYXMgYSB0cmVlIHVuY29uZGl0aW9uYWxseSBcdTIwMTQgYSBzaW5nbGVcbiAqIGFuY2hvciBiZWNvbWVzIGEgb25lLWxpbmUgdHJlZSB3aGF0ZXZlciBpdHMgZGVwdGggKHNlZSB7QGxpbmsgZm9sZENoYWlufSk7XG4gKiB0aGVyZSBpcyBubyBmbGF0LWJ1bGxldCBwYXRoIG9yIHNpemUgZmxvb3IgaW4gdGhpcyBtb2R1bGUuXG4gKlxuICogSGVpZ2h0IGlzIGJvdW5kZWQgYnkge0BsaW5rIGZvbGRDaGFpbn06IGEgZGlyZWN0b3J5IGxpbmUgb25seSBldmVyIGFwcGVhcnNcbiAqIHdoZXJlIGl0IGdlbnVpbmVseSBncm91cHMgdHdvIG9yIG1vcmUgc2libGluZ3MsIHNvIHRoZSB0cmVlIGFkZHMgYXQgbW9zdFxuICogb25lIGxpbmUgcGVyIHJlYWwgZ3JvdXBpbmcgYW5kIG5ldmVyIG9uZSBwZXIgcGF0aCBzZWdtZW50LlxuICpcbiAqIFRvdGFsIGZvciBhbnkgd2VsbC1mb3JtZWQgYFRyZWVBbmNob3JbXWA6IGRlZ2VuZXJhdGUgcGF0aHMgKHJ1bGUgZW5mb3JjZWRcbiAqIGluIHtAbGluayBzcGxpdFNlZ21lbnRzfSkgYXJlIG5vcm1hbGl6ZWQgdG8gYXRvbWljIGxlYXZlcyByYXRoZXIgdGhhblxuICogdGhyb3duIG9uLCBzbyB0aGlzIGZ1bmN0aW9uIG5ldmVyIG5lZWRzIGFuIGludGVybmFsIHRyeS9jYXRjaC4gQ2FsbGVycyBhZGRcbiAqIHRoZWlyIG93biBjYXRjaCBhcm91bmQgdGhpcyBjYWxsIGluIGEgbGF0ZXIgcGhhc2UgKGZhaWwtb3BlbiBkaXNjaXBsaW5lXG4gKiBsaXZlcyBhdCB0aGUgY2FsbCBzaXRlLCBub3QgaGVyZSkuXG4gKlxuICogYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXMgYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlclxuICogZGlzdGluY3QgYHBhdGhgIFx1MjAxNCBwYXNzIGFuY2hvcnMgdGhyb3VnaCB7QGxpbmsgY29sbGFwc2VCeVBhdGh9IGZpcnN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQW5jaG9yVHJlZShhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGZvcmVzdCA9IGJ1aWxkRm9yZXN0KGFuY2hvcnMpO1xuICByZXR1cm4gcmVuZGVyTm9kZXMoZm9yZXN0LCAnJyk7XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgQmFzaCBzcGFuIFx1MjE5MiB0b3VjaCB0cmFuc2xhdGlvbiBhbmQgdGhlIGpvaW4tZ2F0aW5nIGRyaXZlciAocGxhbiBcdTAwQTcyLFxuICogXHUwMEE3MyBzdGVwIDIpLiBCb3RoIGFkYXB0ZXJzIGNvbnN1bWUgdGhpcyBtb2R1bGUgb25jZSB0aGVpciBkdXBsaWNhdGUgQmFzaFxuICogc3BhbiBsb29wcyBjb2xsYXBzZTogaXQgb3ducyB0aGUgcGVyLWNvbW1hbmQgdmVyZGljdCB0aHJlYWQgXHUyMDE0IHBhc3MgQVxuICogYGV2YWx1YXRlV3JpdGVHYXRlYCBzd2VlcCwgdGhlIGV4cGxhbmF0aW9uIG1hcCwgdGhlIGpvaW4gZmlsdGVyLCBhbmQgcGFzcyBCXG4gKiBwZXItc3Vydml2aW5nLXNwYW4gYHJ1blRvdWNoSG9va2AgXHUyMDE0IHBsdXMgdGhlIHdob2xlLWNvbW1hbmQgYGludGVycnVwdGVkYFxuICogZ2F0ZSAocGxhbiBcdTAwQTc0KS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFJlc29sdmVkU3BhbiwgU3Bhbk1hdGNoIH0gZnJvbSAnLi9wYXJzZS1jb21tYW5kLmpzJztcbmltcG9ydCB7IHR5cGUgTWVtb1N0b3JlLCByZXNvbHZlVG91Y2hTY29wZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7XG4gIGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlLFxuICBldmFsdWF0ZVdyaXRlR2F0ZSxcbiAgZmlsZUV4aXN0cyxcbiAgdHlwZSBSZWFsaXR5UHJvYmVDYWNoZSxcbiAgcnVuVG91Y2hIb29rLFxuICB0eXBlIFRvdWNoRXhlY3V0b3JzLFxuICB0eXBlIFRvdWNoSW5wdXQsXG4gIHR5cGUgV3JpdGVHYXRlT3V0Y29tZSxcbiAgd29ya2luZ1RyZWVDaGFuZ2VkXG59IGZyb20gJy4vdG91Y2gtY29yZS5qcyc7XG5cbi8qKlxuICogVHJhbnNsYXRlIG9uZSByZXNvbHZlZCBzcGFuIGludG8gYSBmdWxseS10eXBlZCB7QGxpbmsgVG91Y2hJbnB1dH0gcGVyIHRoZVxuICogcGxhbiBcdTAwQTcyIHRhYmxlLCBvciBgbnVsbGAgd2hlbiB0aGUgcGF0aCBmYWlscyBgcmVzb2x2ZVRvdWNoU2NvcGVgIFx1MjAxNCBjcm9zcy1cbiAqIHJlcG8sIGdpdGlnbm9yZWQsIGFuZCBzcGFuLWRvY3VtZW50IHBhdGhzIGZhaWwgY2xvc2VkLlxuICpcbiAqIFRoZSBwb3N0LXN0YXRlIGdhdGUgZmllbGRzIHRoZSBzcGFuIGNhbiBkZXRlcm1pbmUgKGB0YXJnZXRTdGF0ZWAsIGFuZFxuICogYHBvc3RTdGF0ZWAgZm9yIGFwcGVuZHMgYW5kIGRlbGV0ZXMpIGFyZSBzZXQgaGVyZTsgYSBsaXRlcmFsIG92ZXJ3cml0ZSBib2R5XG4gKiAoYHNwYW4ud3JpdHRlbmAgXHUyMDE0IHRoZSBmbGFnLWxlc3MgYGVjaG9gL2BwcmludGZgIGA+YCBjYXNlKSByaWRlcyBhcyB0aGVcbiAqIGBleGFjdGAgcG9zdC1jb250ZW50IGV4cGVjdGF0aW9uIHNvIHRoZSBnYXRlIHZlcmlmaWVzIHRoZSB3cml0ZSdzIGVmZmVjdFxuICogd2hpbGUgdGhlIHRvdWNoIGl0c2VsZiBzdGF5cyB3aG9sZS1maWxlIChwbGFuIFx1MDBBNzMgc3RlcCAxYikuIFRydW5jYXRlcyBtYXBcbiAqIHRoZSBzcGFuJ3Mgc3RhdGljYWxseSBldmFsdWF0ZWQgYWJzb2x1dGUgYC1zIE5gIHRvIHRoZSBgc2l6ZWAgcG9zdC1jb250ZW50XG4gKiAoYC1zIDBgIFx1MjE5MiBgZW1wdHlgKTsgYSB0cnVuY2F0ZSB3aXRob3V0IGEgc2l6ZSBnYXRlcyBleGlzdGVuY2Utb25seS4gVGhlXG4gKiBkcml2ZXIgcGFpcnMgY3AvaW5zdGFsbCBhbmQgbXYgc291cmNlcyBvbnRvIHRoZSBkZXN0aW5hdGlvbiB0b3VjaGVzXG4gKiBhZnRlcndhcmQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNoU3BhblRvVG91Y2goc3BhbjogUmVzb2x2ZWRTcGFuLCBzZXNzaW9uSWQ6IHN0cmluZywgY3dkOiBzdHJpbmcpOiBUb3VjaElucHV0IHwgbnVsbCB7XG4gIGlmICghcmVzb2x2ZVRvdWNoU2NvcGUoY3dkLCBzcGFuLmFic29sdXRlUGF0aCkpIHJldHVybiBudWxsO1xuICBzd2l0Y2ggKHNwYW4ub3BlcmF0aW9uKSB7XG4gICAgY2FzZSAncmVhZCc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAncmVhZCcsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIG9mZnNldDogc3Bhbi5saW5lU3RhcnQsXG4gICAgICAgIGxpbWl0OlxuICAgICAgICAgIHNwYW4ubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgJiYgc3Bhbi5saW5lRW5kICE9PSB1bmRlZmluZWQgPyBzcGFuLmxpbmVFbmQgLSBzcGFuLmxpbmVTdGFydCArIDEgOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnY3JlYXRlLW92ZXJ3cml0ZSc6XG4gICAgY2FzZSAncmVuYW1lLWNvcHknOlxuICAgICAgLy8gV2hvbGUtZmlsZSB3cml0ZXM6IGB3cml0dGVuOiAnJ2Agc2NvcGVzIHRoZSB0b3VjaCB0byBldmVyeSBjb3ZlcmluZ1xuICAgICAgLy8gc3BhbiBcdTIwMTQgdHJ1bmNhdGluZyB3cml0ZXMgZGVzdHJveSBhbmNob3JzIGJleW9uZCB0aGUgbmV3IEVPRiAodGhlXG4gICAgICAvLyBtYWluLTIwMCBGMiBsZXNzb24pLiBBIGxpdGVyYWwgYm9keSByaWRlcyBhcyB0aGUgZXhhY3QgcG9zdC1jb250ZW50XG4gICAgICAvLyBleHBlY3RhdGlvbiBzbyB0aGUgZ2F0ZSB2ZXJpZmllcyB0aGUgd3JpdGUncyBlZmZlY3QuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICBwb3N0U3RhdGU6IHNwYW4ud3JpdHRlbiAhPT0gdW5kZWZpbmVkID8geyBjb250ZW50OiB7IGV4YWN0OiBzcGFuLndyaXR0ZW4gfSB9IDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ3RydW5jYXRlJzpcbiAgICAgIC8vIFNhbWUgd2hvbGUtZmlsZSBzY29wZTsgdGhlIHNpemUgZ2F0ZSAocGxhbiBcdTAwQTcyLCBcdTAwQTczIHN0ZXAgMWIpIHZlcmlmaWVzXG4gICAgICAvLyB0aGUgcG9zdC1jb21tYW5kIGJ5dGUgY291bnQgd2hlbiB0aGUgc3BhbiBjYXJyaWVzIGEgc3RhdGljYWxseVxuICAgICAgLy8gZXZhbHVhdGVkIGFic29sdXRlIGAtcyBOYCAoYC1zIDBgIFx1MjE5MiBlbXB0eSk7IHdpdGhvdXQgb25lIHRoZSBnYXRlIGlzXG4gICAgICAvLyBleGlzdGVuY2Utb25seS5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHBvc3RTdGF0ZTpcbiAgICAgICAgICBzcGFuLnNpemUgPT09IDBcbiAgICAgICAgICAgID8geyBjb250ZW50OiB7IGVtcHR5OiB0cnVlIH0gfVxuICAgICAgICAgICAgOiBzcGFuLnNpemUgIT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgICA/IHsgY29udGVudDogeyBzaXplOiBzcGFuLnNpemUgfSB9XG4gICAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ2FwcGVuZCc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiBzcGFuLndyaXR0ZW4gPz8gJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcG9zdFN0YXRlOiBzcGFuLndyaXR0ZW4gIT09IHVuZGVmaW5lZCA/IHsgY29udGVudDogeyBzdWZmaXg6IHNwYW4ud3JpdHRlbiB9IH0gOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnbW9kaWZ5JzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHJhbmdlOiBzcGFuLmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkID8geyBzdGFydDogc3Bhbi5saW5lU3RhcnQsIGVuZDogc3Bhbi5saW5lRW5kID8/IHNwYW4ubGluZVN0YXJ0IH0gOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2Fic2VudCcsXG4gICAgICAgIHBvc3RTdGF0ZTogeyByZWFsRGVsZXRlOiB0cnVlIH1cbiAgICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSBCYXNoIGB0b29sX3Jlc3BvbnNlYCBzaWduYWxzIHRoYXQgdGhlIGNvbW1hbmQgd2FzIGludGVycnVwdGVkXG4gKiAocGxhbiBcdTAwQTc0KS4gVGhlIFNESyB0eXBlcyB0aGUgcmVzcG9uc2UgYHVua25vd25gIG9uIGJvdGggYWRhcHRlcnMsIHNvIHRoaXNcbiAqIGlzIGEgZGVmZW5zaXZlIHJ1bnRpbWUgc2hhcGUtcHJvYmU6IGFuIG9iamVjdCBjYXJyeWluZyBhIHRydXRoeVxuICogYGludGVycnVwdGVkYCBmaWVsZCBjbGFzc2lmaWVzIGFzIGludGVycnVwdGVkOyBhbnkgb3RoZXIgc2hhcGUgKHN0cmluZyxcbiAqIG51bGwsIG9iamVjdCB3aXRob3V0IHRoZSBmaWVsZCkgcHJvY2VlZHMgZmFpbC1vcGVuLCBtYXRjaGluZyB0b2RheSdzXG4gKiBiZWhhdmlvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhc2hSZXNwb25zZUludGVycnVwdGVkKHRvb2xSZXNwb25zZTogdW5rbm93bik6IGJvb2xlYW4ge1xuICBpZiAodG9vbFJlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIEJvb2xlYW4oKHRvb2xSZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuaW50ZXJydXB0ZWQpO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBUaGUgQmFzaCBgdG9vbF9yZXNwb25zZWAncyBwcm9jZXNzIGV4aXQgY29kZSwgd2hlbiB0aGUgaGFybmVzcyBzdXBwbGllc1xuICogb25lLiBUaGUgU0RLIHR5cGVzIHRoZSByZXNwb25zZSBgdW5rbm93bmAgb24gYm90aCBhZGFwdGVycyBhbmQgQ2xhdWRlJ3NcbiAqIEJhc2ggZW52ZWxvcGVzIGRvIG5vdCBjdXJyZW50bHkgY2FycnkgYW4gYGV4aXRfY29kZWAgZmllbGQsIHNvIHRoaXMgaXMgYVxuICogZGVmZW5zaXZlIHNoYXBlLXByb2JlIHdpdGggdGhlIHBsYW4gXHUwMEE3NCBmYWlsLW9wZW4gcG9zdHVyZTogcHJlc2VudCBcdTIxOTIgdGhlXG4gKiBpbnRlZ2VyIGNvZGUsIGFic2VudCBvciBhbnkgb3RoZXIgc2hhcGUgXHUyMTkyIHVuZGVmaW5lZCwgYW5kIHRoZSBjYWxsZXJcbiAqIHByb2NlZWRzIGV4YWN0bHkgYXMgdG9kYXkuIChUaGUgaG9vayBzdWJwcm9jZXNzJ3Mgb3duIGV4aXQgc3RhdHVzIFx1MjAxNCB0aGVcbiAqIFNESydzIGBTREtIb29rUmVzcG9uc2VNZXNzYWdlLmV4aXRfY29kZWAgXHUyMDE0IGlzIGEgZGlmZmVyZW50IGNoYW5uZWwgYW5kIGlzXG4gKiBuZXZlciByZWFkIGhlcmUuKVxuICpcbiAqIEdyYW51bGFyaXR5IGVkZ2UgKGRvY3VtZW50ZWQgcmVzaWR1ZSk6IHRoZSBjb2RlIGlzIHRoZSB3aG9sZSBjb21wb3VuZFxuICogY29tbWFuZCdzLCBub3Qgb25lIHNpbXBsZSBjb21tYW5kJ3MgXHUyMDE0IGEgbWFza2VkIGZhaWx1cmUgKGBnaXQgYXBwbHlcbiAqIHAuZGlmZiB8fCBlY2hvIG9rYCBleGl0aW5nIDApIHN1cHByZXNzZXMgbm90aGluZywgYW5kIGEgdHJhaWxpbmcgZmFpbHVyZVxuICogKGBzZWQgLWkgcy9hL2IvIGY7IGZhbHNlYCBleGl0aW5nIDEpIHN1cHByZXNzZXMgdGhlIGVhcmxpZXIgcmVhbCB3cml0ZS5cbiAqIEFuZCB0aGUgXCJmYWlsZWQsIHNvIHRoZSB3cml0ZSBkaWQgbm90IGhhcHBlblwiIHByZW1pc2UgYmVoaW5kIHRoZVxuICogc3VwcHJlc3Npb24gaG9sZHMgZm9yIGF0b21pYyBmYWlsdXJlcyAoYGdpdCBhcHBseWAgd2l0aG91dCBgLS1yZWplY3RgLFxuICogcHJldHRpZXIgb24gYSBzeW50YXggZXJyb3IpIGJ1dCBvdmVyLXN1cHByZXNzZXMgdGhlIG5vbi1hdG9taWMgd3JpdGVyc1xuICogdGhhdCBtb2RpZnkgYmVmb3JlIGZhaWxpbmcgXHUyMDE0IEdOVSBgcGF0Y2hgIGFwcGx5aW5nIGVhcmxpZXIgaHVua3MsIGBnaXRcbiAqIGFwcGx5IC0tcmVqZWN0YCB3cml0aW5nIHRoZSBhcHBsaWNhYmxlIGh1bmtzIHBsdXMgYC5yZWpgIGZpbGVzLCBhbmRcbiAqIGZvcm1hdHRlcnMgKGBlc2xpbnQgLS1maXhgLCBgcnVib2NvcCAtYWApIHdyaXRpbmcgdGhlaXIgZml4ZXMgYmVmb3JlXG4gKiBleGl0aW5nIG5vbnplcm8gb24gcmVtYWluaW5nIHZpb2xhdGlvbnMuIFRoYXQgd3JvdGUtYnV0LW5vbnplcm8gY29ybmVyIGlzXG4gKiBhY2NlcHRlZCBhbmQgcGlubmVkIGJ5IHRoZSBnYXRlJ3MgdGVzdHMgcmF0aGVyIHRoYW4gY2FydmVkIG91dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhc2hSZXNwb25zZUV4aXRDb2RlKHRvb2xSZXNwb25zZTogdW5rbm93bik6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICBjb25zdCBjb2RlID0gKHRvb2xSZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuZXhpdF9jb2RlO1xuICAgIGlmICh0eXBlb2YgY29kZSA9PT0gJ251bWJlcicgJiYgTnVtYmVyLmlzSW50ZWdlcihjb2RlKSkgcmV0dXJuIGNvZGU7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgcGVyLWNvbW1hbmQgdmVyZGljdCBkcml2ZXIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudHlwZSBSZXNvbHZlZE1hdGNoID0gRXh0cmFjdDxTcGFuTWF0Y2gsIHsgc3RhdHVzOiAncmVzb2x2ZWQnIH0+O1xudHlwZSBHdWFyZE1hdGNoID0gRXh0cmFjdDxTcGFuTWF0Y2gsIHsgc3RhdHVzOiAnYnVpbHRpbi1ndWFyZCcgfT47XG5cbnR5cGUgVmVyZGljdCA9ICdmYWlsZWQnIHwgJ3N1Y2NlZWRlZCcgfCAndW5rbm93bic7XG5cbi8qKlxuICogRmlsZS1wcm9kdWNpbmcgd3JpdGUgb3BlcmF0aW9ucyBcdTIwMTQgdGhlIG9ubHkgc3BhbnMgdGhhdCBjYW4gZXhwbGFpbiBhXG4gKiBkZWxldGUncyBkZWNpc2l2ZUZhaWwgYnkgcmUtY3JlYXRpbmcgaXRzIHBhdGggbGF0ZXIgaW4gdGhlIGNvbXBvdW5kIChwbGFuXG4gKiBcdTAwQTczIHN0ZXAgMiwgcm91bmQtMykuIGBtb2RpZnlgIChzZWQgLWkgYW5kIGZyaWVuZHMpIGRlbGliZXJhdGVseSBjYW5ub3Q6XG4gKiBpdCBuZXZlciBjcmVhdGVzIGEgbWlzc2luZyBmaWxlLCBzbyBhbiBlbmQtc3RhdGUtcHJlc2VudCBwYXRoIGFmdGVyIGFcbiAqIGZhaWxlZCBgcm1gIGlzIG5ldmVyIGl0cyBkb2luZy5cbiAqL1xuY29uc3QgRklMRV9QUk9EVUNJTkdfT1BTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbJ2NyZWF0ZS1vdmVyd3JpdGUnLCAncmVuYW1lLWNvcHknLCAndHJ1bmNhdGUnLCAnYXBwZW5kJ10pO1xuXG4vKiogT25lIHBhc3MtQSBldmFsdWF0aW9uOiB0aGUgc3BhbiwgaXRzIHRvdWNoLCBhbmQgdGhlIChwb3N0LXJlc29sdXRpb24pIGdhdGUgb3V0Y29tZS4gKi9cbmludGVyZmFjZSBTcGFuRXZhbCB7XG4gIG1hdGNoOiBSZXNvbHZlZE1hdGNoO1xuICAvKiogVGhlIHRyYW5zbGF0ZWQgdG91Y2gsIG9yIGBudWxsYCB3aGVuIHRoZSBzcGFuIGZhaWxlZCBgcmVzb2x2ZVRvdWNoU2NvcGVgLiAqL1xuICB0b3VjaDogVG91Y2hJbnB1dCB8IG51bGw7XG4gIC8qKiBUaGUgcGFzcy1BIGdhdGUgb3V0Y29tZSwgcG9zdC1yZXNvbHV0aW9uIGZvciBgJ3BlbmRpbmcnYCBhbmQgZXhwbGFpbmVkIGZhaWxzLiAqL1xuICBvdXRjb21lOiBXcml0ZUdhdGVPdXRjb21lO1xuICAvKiogQSBkZWNpc2l2ZUZhaWwgZG93bmdyYWRlZCBieSBhIGxhdGVyIHNhbWUtcGF0aCBkZWNpc2l2ZVBhc3MgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLiAqL1xuICBleHBsYWluZWQ6IGJvb2xlYW47XG4gIGNvbW1hbmRJbmRleDogbnVtYmVyO1xuICAvKiogVGhlIHNwYW4ncyBvd24gcGF0aCBcdTIwMTQgdGhlIGV4cGxhbmF0aW9uIGtleSBmb3IgZGVjaXNpdmUgZmFpbHMuICovXG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIGNwIGRlc3RpbmF0aW9uczogdGhlIHBhaXJlZCBzb3VyY2UgcGF0aCBcdTIwMTQgdGhlIGV4cGxhbmF0aW9uIGtleSBmb3IgcGVuZGluZ3MuICovXG4gIHNvdXJjZUtleTogc3RyaW5nIHwgbnVsbDtcbn1cblxuLyoqXG4gKiBFdmFsdWF0ZSBvbmUgc3BhbidzIGdhdGUuIFJlYWRzIGhhdmUgbm8gZ2F0ZSBcdTIxOTIgYCdpbmNvbmNsdXNpdmUnYCwgd2l0aCBvbmVcbiAqIGV4Y2VwdGlvbjogY3AvaW5zdGFsbCBzb3VyY2UgcmVhZHMgZ2F0ZSBvbiB0aGUgc291cmNlIGV4aXN0aW5nIHBvc3QtY29tbWFuZFxuICogKHBsYW4gXHUwMEE3MikgXHUyMDE0IGEgZmFpbGVkIGNvcHkgbmV2ZXIgcmVhZCBhbnl0aGluZy4gVGhlIHJlYWQgdmVyZGljdCBmbGlwcyBvbmx5XG4gKiB0aGUgY29tbWFuZCdzIGpvaW4gdmVyZGljdCwgbmV2ZXIgdGhlIHNhbWUgY29tbWFuZCdzIGRlc3Qgd3JpdGUuXG4gKi9cbmZ1bmN0aW9uIGV2YWxTcGFuR2F0ZShtYXRjaDogUmVzb2x2ZWRNYXRjaCwgdG91Y2g6IFRvdWNoSW5wdXQgfCBudWxsLCBwcm9iZUNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSk6IFdyaXRlR2F0ZU91dGNvbWUge1xuICBpZiAodG91Y2ggPT09IG51bGwpIHJldHVybiAnaW5jb25jbHVzaXZlJztcbiAgaWYgKHRvdWNoLmtpbmQgPT09ICdyZWFkJykge1xuICAgIGlmICgobWF0Y2guaWRpb20gPT09ICdjcC13cml0ZScgfHwgbWF0Y2guaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykgJiYgbWF0Y2guc3Bhbi5vcGVyYXRpb24gPT09ICdyZWFkJykge1xuICAgICAgcmV0dXJuIGZpbGVFeGlzdHMobWF0Y2guc3Bhbi5hYnNvbHV0ZVBhdGgpID8gJ2luY29uY2x1c2l2ZScgOiAnZGVjaXNpdmVGYWlsJztcbiAgICB9XG4gICAgcmV0dXJuICdpbmNvbmNsdXNpdmUnO1xuICB9XG4gIHJldHVybiBldmFsdWF0ZVdyaXRlR2F0ZSh0b3VjaCwgcHJvYmVDYWNoZSk7XG59XG5cbi8qKiBUaGUgb3BlcmF0b3IgcHJlY2VkaW5nIGEgY29tbWFuZCwgZnJvbSBpdHMgZmlyc3Qgc3BhbiAoYWxsIHNwYW5zIG9mIG9uZSBjb21tYW5kIHNoYXJlIGl0KSBcdTIwMTQgb3IgZnJvbSBpdHMgZ3VhcmQgbWF0Y2ggd2hlbiB0aGUgY29tbWFuZCBoYXMgbm8gc3BhbnMuICovXG5mdW5jdGlvbiBqb2luT2ZDb21tYW5kKFxuICBpZHg6IG51bWJlcixcbiAgZ3JvdXBzOiBNYXA8bnVtYmVyLCBSZXNvbHZlZE1hdGNoW10+LFxuICBndWFyZEJ5SW5kZXg6IE1hcDxudW1iZXIsIEd1YXJkTWF0Y2g+XG4pOiAnJiYnIHwgJ3x8JyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHNwYW5zID0gZ3JvdXBzLmdldChpZHgpO1xuICBpZiAoc3BhbnMgIT09IHVuZGVmaW5lZCkge1xuICAgIGZvciAoY29uc3QgbSBvZiBzcGFucykge1xuICAgICAgaWYgKG0uc3Bhbi5qb2luICE9PSB1bmRlZmluZWQpIHJldHVybiBtLnNwYW4uam9pbjtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gZ3VhcmRCeUluZGV4LmdldChpZHgpPy5qb2luO1xufVxuXG4vKipcbiAqIFNoYXJlZCBCYXNoIGRyaXZlciAocGxhbiBcdTAwQTczIHN0ZXAgMik6IG93bnMgdGhlIHBlci1jb21tYW5kIHZlcmRpY3QgdGhyZWFkIFx1MjAxNFxuICogcGFzcyBBIGBldmFsdWF0ZVdyaXRlR2F0ZWAgc3dlZXAgKGV2ZXJ5IHNwYW4sIGJlZm9yZSBhbnkgam9pbiBkZWNpc2lvbiksXG4gKiB0aGUgZXhwbGFuYXRpb24gbWFwLCBwZXItY29tbWFuZCB2ZXJkaWN0cywgdGhlIGpvaW4gZmlsdGVyIHdpdGggY2hhaW5lZFxuICogc2tpcHMsIGFuZCBwYXNzIEIgcGVyLXN1cnZpdmluZy1zcGFuIGBydW5Ub3VjaEhvb2tgIFx1MjAxNCBwbHVzIHRoZSB3aG9sZS1jb21tYW5kXG4gKiBgaW50ZXJydXB0ZWRgIGFuZCBleGl0LWNvZGUgZ2F0ZXMgKHBsYW4gXHUwMEE3NCkgYW5kIHRoZSBzcGFuLWxlc3MtZ3VhcmRcbiAqIGNvbW1hbmRzIChgZmFsc2VgL2B0cnVlYC9gOmAgam9pbiB2ZXJkaWN0cyB3aXRoIG5vIHNwYW5zIG9mIHRoZWlyIG93bikuXG4gKiBSZXR1cm5zIHRoZSBub24tbnVsbCBgYWRkaXRpb25hbENvbnRleHRgIGJsb2NrcyBmb3IgdGhlIGFkYXB0ZXIgdG8gam9pbjtcbiAqIHRoZSBzZXNzaW9uIG1lbW8gZGVkdXBzIHJlcGVhdGVkIHRhcmdldHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5CYXNoVG91Y2hlcyhcbiAgbWF0Y2hlczogU3Bhbk1hdGNoW10sXG4gIHNlc3Npb25JZDogc3RyaW5nLFxuICBjd2Q6IHN0cmluZyxcbiAgdG9vbFJlc3BvbnNlOiB1bmtub3duLFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmUsXG4gIHdhcm46IChtZXNzYWdlOiBzdHJpbmcpID0+IHZvaWQgPSBjb25zb2xlLndhcm5cbik6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgLy8gQSBjb21tYW5kIHRoYXQgZGlkIG5vdCBjb21wbGV0ZSBwcm9kdWNlcyBubyB0b3VjaGVzLCB3aGF0ZXZlciBpdHMgc3BhbnMuXG4gIGlmIChiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZCh0b29sUmVzcG9uc2UpKSByZXR1cm4gW107XG4gIGNvbnN0IGV4aXRDb2RlID0gYmFzaFJlc3BvbnNlRXhpdENvZGUodG9vbFJlc3BvbnNlKTtcbiAgY29uc3QgcmVzb2x2ZWQgPSBtYXRjaGVzLmZpbHRlcigobSk6IG0gaXMgUmVzb2x2ZWRNYXRjaCA9PiBtLnN0YXR1cyA9PT0gJ3Jlc29sdmVkJyk7XG4gIGNvbnN0IGd1YXJkcyA9IG1hdGNoZXMuZmlsdGVyKChtKTogbSBpcyBHdWFyZE1hdGNoID0+IG0uc3RhdHVzID09PSAnYnVpbHRpbi1ndWFyZCcpO1xuICBpZiAocmVzb2x2ZWQubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG5cbiAgLy8gU2VlZCB0aGUgcGVyLWNvbW1hbmQgcHJvYmUgY2FjaGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFjKSB3aXRoIGV2ZXJ5IGFic2VudFxuICAvLyB0YXJnZXQgYW5kIGNwL2luc3RhbGwgc291cmNlIG9mIHRoZSBjb21wb3VuZDsgdGhlIGZpcnN0IGdhdGUgdGhhdCBuZWVkc1xuICAvLyBpdCBydW5zIG9uZSBscy1maWxlcyArIG9uZSBzcGFuLWxpc3QgYmF0Y2ggZm9yIGFsbCBvZiB0aGVtLiBUaGVcbiAgLy8gbGF0ZXItcmVjcmVhdGUgZXhwbGFuYXRpb24ncyBwcm9iZSBzY29wZSAocm91bmQtMykgcmlkZXMgYWxvbmdzaWRlOiB0aGVcbiAgLy8gZGVsZXRlIHBhdGhzIGEgbGF0ZXIgY29tbWFuZCBjYW4gcmUtY3JlYXRlIHdpdGggYSBmaWxlLXByb2R1Y2luZyB3cml0ZSBcdTIwMTRcbiAgLy8gdGhlaXIgd29ya2luZy10cmVlLXZzLWluZGV4IHN0YXR1cyBpcyB0aGUgcmUtY3JlYXRlJ3MgbWFyaywgcmVhZCBvbmNlIGluXG4gIC8vIG9uZSBgZ2l0IHN0YXR1c2AgYmF0Y2guXG4gIGNvbnN0IHByb2JlUGF0aHM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGZpbGVQcm9kdWNpbmdCeVBhdGggPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyW10+KCk7XG4gIGZvciAoY29uc3QgbSBvZiByZXNvbHZlZCkge1xuICAgIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAnZGVsZXRlJykgcHJvYmVQYXRocy5wdXNoKG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIGVsc2UgaWYgKChtLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG0uaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykgJiYgbS5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlYWQnKSB7XG4gICAgICBwcm9iZVBhdGhzLnB1c2gobS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgfSBlbHNlIGlmIChGSUxFX1BST0RVQ0lOR19PUFMuaGFzKG0uc3Bhbi5vcGVyYXRpb24pKSB7XG4gICAgICBjb25zdCBsaXN0ID0gZmlsZVByb2R1Y2luZ0J5UGF0aC5nZXQobS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgICBpZiAobGlzdCAhPT0gdW5kZWZpbmVkKSBsaXN0LnB1c2gobS5zcGFuLnNpbXBsZUNvbW1hbmRJbmRleCk7XG4gICAgICBlbHNlIGZpbGVQcm9kdWNpbmdCeVBhdGguc2V0KG0uc3Bhbi5hYnNvbHV0ZVBhdGgsIFttLnNwYW4uc2ltcGxlQ29tbWFuZEluZGV4XSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IHJlY3JlYXRlUHJvYmVQYXRoczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBtIG9mIHJlc29sdmVkKSB7XG4gICAgaWYgKG0uc3Bhbi5vcGVyYXRpb24gIT09ICdkZWxldGUnKSBjb250aW51ZTtcbiAgICBjb25zdCBsYXRlciA9IChmaWxlUHJvZHVjaW5nQnlQYXRoLmdldChtLnNwYW4uYWJzb2x1dGVQYXRoKSA/PyBbXSkuc29tZSgoaSkgPT4gaSA+IG0uc3Bhbi5zaW1wbGVDb21tYW5kSW5kZXgpO1xuICAgIGlmIChsYXRlcikgcmVjcmVhdGVQcm9iZVBhdGhzLnB1c2gobS5zcGFuLmFic29sdXRlUGF0aCk7XG4gIH1cbiAgY29uc3QgcHJvYmVDYWNoZSA9IGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlKHByb2JlUGF0aHMsIHJlY3JlYXRlUHJvYmVQYXRocyk7XG5cbiAgLy8gR3JvdXAgYnkgc2ltcGxlIGNvbW1hbmQgaW4gd2Fsa2VyIG9yZGVyLiBTcGFuLWxlc3MgZ3VhcmQgY29tbWFuZHNcbiAgLy8gKGBmYWxzZWAvYHRydWVgL2A6YCkgam9pbiB0aGUgb3JkZXIgd2l0aCBubyBncm91cDogdGhlaXIgZGV0ZXJtaW5pc3RpY1xuICAvLyBleGl0IHN0YXR1cyBkcml2ZXMgdGhlIGpvaW4gZmlsdGVyLCBhbmQgdGhleSBuZXZlciB0b3VjaCBhbnl0aGluZy5cbiAgY29uc3QgZ3JvdXBzID0gbmV3IE1hcDxudW1iZXIsIFJlc29sdmVkTWF0Y2hbXT4oKTtcbiAgY29uc3QgZ3VhcmRCeUluZGV4ID0gbmV3IE1hcDxudW1iZXIsIEd1YXJkTWF0Y2g+KCk7XG4gIGNvbnN0IGNvbW1hbmRPcmRlcjogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChjb25zdCBtIG9mIHJlc29sdmVkKSB7XG4gICAgY29uc3QgaWR4ID0gbS5zcGFuLnNpbXBsZUNvbW1hbmRJbmRleDtcbiAgICBjb25zdCBsaXN0ID0gZ3JvdXBzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGxpc3QucHVzaChtKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZ3JvdXBzLnNldChpZHgsIFttXSk7XG4gICAgICBjb21tYW5kT3JkZXIucHVzaChpZHgpO1xuICAgIH1cbiAgfVxuICBmb3IgKGNvbnN0IGcgb2YgZ3VhcmRzKSB7XG4gICAgaWYgKGdyb3Vwcy5oYXMoZy5zaW1wbGVDb21tYW5kSW5kZXgpIHx8IGd1YXJkQnlJbmRleC5oYXMoZy5zaW1wbGVDb21tYW5kSW5kZXgpKSBjb250aW51ZTtcbiAgICBndWFyZEJ5SW5kZXguc2V0KGcuc2ltcGxlQ29tbWFuZEluZGV4LCBnKTtcbiAgICBjb21tYW5kT3JkZXIucHVzaChnLnNpbXBsZUNvbW1hbmRJbmRleCk7XG4gIH1cbiAgY29tbWFuZE9yZGVyLnNvcnQoKGEsIGIpID0+IGEgLSBiKTtcblxuICAvLyBQYXNzIEE6IHRyYW5zbGF0ZSBldmVyeSBzcGFuIG9uY2UgYW5kIGV2YWx1YXRlIGl0cyBnYXRlLCBwYWlyaW5nXG4gIC8vIGNwL2luc3RhbGwgc291cmNlcyB3aXRoIGRlc3RpbmF0aW9ucyBhbmQgbXYgZGVsZXRlcyB3aXRoIHJlbmFtZS1jb3BpZXMgYnlcbiAgLy8gZGVjbGFyYXRpb24gb3JkZXIgKHRoZSBwYXJzZXIgZW1pdHMgc291cmNlcyBiZWZvcmUgZGVzdGluYXRpb25zKS5cbiAgY29uc3QgZXZhbHMgPSBuZXcgTWFwPG51bWJlciwgU3BhbkV2YWxbXT4oKTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3Qgc3BhbnMgPSBncm91cHMuZ2V0KGlkeCk7XG4gICAgaWYgKHNwYW5zID09PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyBndWFyZC1vbmx5IGNvbW1hbmQgXHUyMDE0IG5vdGhpbmcgdG8gZXZhbHVhdGVcbiAgICBjb25zdCByZWFkUGF0aHMgPSBzcGFuc1xuICAgICAgLmZpbHRlcigobSkgPT4gKG0uaWRpb20gPT09ICdjcC13cml0ZScgfHwgbS5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSAmJiBtLnNwYW4ub3BlcmF0aW9uID09PSAncmVhZCcpXG4gICAgICAubWFwKChtKSA9PiBtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICBjb25zdCBkZWxldGVQYXRocyA9IHNwYW5zLmZpbHRlcigobSkgPT4gbS5zcGFuLm9wZXJhdGlvbiA9PT0gJ2RlbGV0ZScpLm1hcCgobSkgPT4gbS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgbGV0IHJlYWRDdXJzb3IgPSAwO1xuICAgIGxldCBkZWxldGVDdXJzb3IgPSAwO1xuICAgIGNvbnN0IGxpc3Q6IFNwYW5FdmFsW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IG0gb2Ygc3BhbnMpIHtcbiAgICAgIGNvbnN0IHRvdWNoID0gYmFzaFNwYW5Ub1RvdWNoKG0uc3Bhbiwgc2Vzc2lvbklkLCBjd2QpO1xuICAgICAgY29uc3QgZW50cnk6IFNwYW5FdmFsID0ge1xuICAgICAgICBtYXRjaDogbSxcbiAgICAgICAgdG91Y2gsXG4gICAgICAgIG91dGNvbWU6ICdpbmNvbmNsdXNpdmUnLFxuICAgICAgICBleHBsYWluZWQ6IGZhbHNlLFxuICAgICAgICBjb21tYW5kSW5kZXg6IGlkeCxcbiAgICAgICAgcGF0aDogbS5zcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgc291cmNlS2V5OiBudWxsXG4gICAgICB9O1xuICAgICAgaWYgKHRvdWNoICE9PSBudWxsICYmIHRvdWNoLmtpbmQgPT09ICd3cml0ZScpIHtcbiAgICAgICAgaWYgKG0uc3Bhbi5vcGVyYXRpb24gPT09ICdjcmVhdGUtb3ZlcndyaXRlJyAmJiAobS5pZGlvbSA9PT0gJ2NwLXdyaXRlJyB8fCBtLmlkaW9tID09PSAnaW5zdGFsbC13cml0ZScpKSB7XG4gICAgICAgICAgY29uc3Qgc291cmNlID0gcmVhZFBhdGhzW3JlYWRDdXJzb3JdO1xuICAgICAgICAgIGlmIChzb3VyY2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmVhZEN1cnNvciArPSAxO1xuICAgICAgICAgICAgLy8gYGluc3RhbGwgLXNgL2AtLXN0cmlwYCBpcyBkZWxpYmVyYXRlbHkgbmV2ZXIgcGFpcmVkOiBzdHJpcHBlZFxuICAgICAgICAgICAgLy8gb3V0cHV0IG5ldmVyIGVxdWFscyB0aGUgc291cmNlLCBzbyBpbnN0YWxsIGRlc3RzIGdhdGVcbiAgICAgICAgICAgIC8vIGV4aXN0ZW5jZS1vbmx5IChwbGFuIFx1MDBBNzMgc3RlcCAxYikuXG4gICAgICAgICAgICBpZiAobS5pZGlvbSA9PT0gJ2NwLXdyaXRlJykge1xuICAgICAgICAgICAgICB0b3VjaC5zb3VyY2VQYXRoID0gc291cmNlO1xuICAgICAgICAgICAgICBlbnRyeS5zb3VyY2VLZXkgPSBzb3VyY2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG0uc3Bhbi5vcGVyYXRpb24gPT09ICdyZW5hbWUtY29weScpIHtcbiAgICAgICAgICBjb25zdCBzb3VyY2UgPSBkZWxldGVQYXRoc1tkZWxldGVDdXJzb3JdO1xuICAgICAgICAgIGlmIChzb3VyY2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZGVsZXRlQ3Vyc29yICs9IDE7XG4gICAgICAgICAgICB0b3VjaC5yZW5hbWVTb3VyY2VQYXRoID0gc291cmNlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgZW50cnkub3V0Y29tZSA9IGV2YWxTcGFuR2F0ZShtLCB0b3VjaCwgcHJvYmVDYWNoZSk7XG4gICAgICBsaXN0LnB1c2goZW50cnkpO1xuICAgIH1cbiAgICBldmFscy5zZXQoaWR4LCBsaXN0KTtcbiAgfVxuXG4gIC8vIFRoZSBleHBsYW5hdGlvbiBtYXAgKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiB0aGUgaGlnaGVzdCBzaW1wbGVDb21tYW5kSW5kZXggd2l0aFxuICAvLyBhIGRlY2lzaXZlUGFzcyBvbiBlYWNoIHBhdGguXG4gIGNvbnN0IHBhc3NCeVBhdGggPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZVBhc3MnKSB7XG4gICAgICAgIGNvbnN0IHByZXYgPSBwYXNzQnlQYXRoLmdldChlLnBhdGgpO1xuICAgICAgICBpZiAocHJldiA9PT0gdW5kZWZpbmVkIHx8IGlkeCA+IHByZXYpIHBhc3NCeVBhdGguc2V0KGUucGF0aCwgaWR4KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBSZXNvbHZlIHRoZSBhYnNlbnQtc291cmNlIGhvbGRzIGFnYWluc3QgdGhlIG5vdy1jb21wbGV0ZSBtYXAsIGFuZFxuICAvLyBkb3duZ3JhZGUgZXhwbGFpbmVkIGZhaWxzOiBhIGRlY2lzaXZlRmFpbCBvbiBhIHBhdGggYSBsYXRlciBjb21tYW5kXG4gIC8vIGRlbW9uc3RyYWJseSByZXdyb3RlIG9yIGRlbGV0ZWQgaXMgdGhlIG92ZXJ3cml0ZSwgbm90IHRoZSBlYXJsaWVyIGNvbW1hbmRcbiAgLy8gZmFpbGluZyAocGxhbiBcdTAwQTczIHN0ZXAgMikuXG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBmb3IgKGNvbnN0IGUgb2YgbGlzdCkge1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ3BlbmRpbmcnKSB7XG4gICAgICAgIGNvbnN0IHBhc3NJZHggPSBlLnNvdXJjZUtleSAhPT0gbnVsbCA/IHBhc3NCeVBhdGguZ2V0KGUuc291cmNlS2V5KSA6IHVuZGVmaW5lZDtcbiAgICAgICAgZS5vdXRjb21lID0gcGFzc0lkeCAhPT0gdW5kZWZpbmVkICYmIHBhc3NJZHggPiBlLmNvbW1hbmRJbmRleCA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gICAgICB9IGVsc2UgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcpIHtcbiAgICAgICAgY29uc3QgcGFzc0lkeCA9IHBhc3NCeVBhdGguZ2V0KGUucGF0aCk7XG4gICAgICAgIGlmIChwYXNzSWR4ICE9PSB1bmRlZmluZWQgJiYgcGFzc0lkeCA+IGUuY29tbWFuZEluZGV4KSBlLmV4cGxhaW5lZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gVGhlIGxhdGVyLXJlY3JlYXRlIGV4cGxhbmF0aW9uIChyb3VuZC0zKTogYSBkZWxldGUncyBkZWNpc2l2ZUZhaWwgXHUyMDE0XG4gIC8vIFwiZmlsZSBwcmVzZW50LCBzbyB0aGUgZGVsZXRlIGRpZG4ndCBoYXBwZW5cIiBcdTIwMTQgaXMgYWxzbyBleHBsYWluZWQgd2hlbiBhXG4gIC8vIExBVEVSIGNvbW1hbmQgd3JpdGVzIHRoZSBzYW1lIHBhdGggd2l0aCBhIGZpbGUtcHJvZHVjaW5nIG9wZXJhdGlvbiB3aG9zZVxuICAvLyBvd24gZ2F0ZSBkaWQgbm90IGZhaWwgKGEgZGVjaXNpdmVGYWlsIHRoZXJlIHByb3ZlcyB0aGUgd3JpdGUgZGlkbid0XG4gIC8vIGhhcHBlbikgQU5EIHRoZSB3b3JraW5nIHRyZWUgYWN0dWFsbHkgZGlmZmVycyBmcm9tIHRoZSBpbmRleCBcdTIwMTQgdGhlXG4gIC8vIHJlLWNyZWF0ZSdzIG1hcmssIHJlYWQgZnJvbSB0aGUgcGVyLWNvbW1hbmQgcHJvYmUuIEEgZmlsZSB0aGF0IHN0aWxsXG4gIC8vIG1hdGNoZXMgdGhlIGluZGV4IG1lYW5zIHRoZSBjaGFpbiBzaG9ydC1jaXJjdWl0ZWQgYmVmb3JlIHRoZSB3cml0ZSAodGhlXG4gIC8vIHJtIGZhaWxlZCBhbmQgYCYmYCBkcm9wcGVkIHRoZSByZXN0KSwgc28gdGhlIGZhaWwgc3RhbmRzIGFuZCB0aGUgam9pblxuICAvLyBmaWx0ZXIgc3RpbGwgc3VwcHJlc3NlcyB0aGUgam9pbmVkIGNvbW1hbmQuIFRoaXMgaXMgdGhlIGV4aXN0ZW5jZS1nYXRlZFxuICAvLyBzaWJsaW5nIG9mIHRoZSBkZWNpc2l2ZVBhc3MgZXhwbGFuYXRpb24gYWJvdmU6IGBybSBmICYmIHBhdGNoIC1wMCA8XG4gIC8vIG5ldy5kaWZmYCBlbmRzIHdpdGggZiBwcmVzZW50IGJlY2F1c2UgdGhlIHBhdGNoIHJlLWNyZWF0ZWQgaXQsIG5vdFxuICAvLyBiZWNhdXNlIHRoZSBybSBmYWlsZWQsIGFuZCB0aGUgcGF0Y2gncyBnYXRlIGlzIGluY29uY2x1c2l2ZSBcdTIwMTQgb25seSB0aGlzXG4gIC8vIHJ1bGUgY2FuIHNlZSB0aGUgcmUtY3JlYXRlLiBDb250ZW50LXZlcmlmaWVkIHJlLWNyZWF0ZXMgKGVjaG8vY3AvXG4gIC8vIHRydW5jYXRlIHdpdGggYSBib2R5KSBuZXZlciBuZWVkIGl0IFx1MjAxNCB0aGVpciBkZWNpc2l2ZVBhc3MgZXhwbGFpbnMgdmlhXG4gIC8vIHRoZSBtYXAgYWJvdmUuIFJlc2lkdWFsOiBhIHByZS1leGlzdGluZyB1bmNvbW1pdHRlZCBjaGFuZ2Ugb24gdGhlXG4gIC8vIGRlbGV0ZWQgcGF0aCBtYXNrcyB0aGUgZGlzY3JpbWluYXRvciAodGhlIGZpbGUgZGlmZmVyZWQgZnJvbSB0aGUgaW5kZXhcbiAgLy8gYmVmb3JlIHRoZSBjb21wb3VuZCBldmVyIHJhbiksIHNvIGFuIHJtIHRoYXQgZmFpbGVkIG9uIGEgZGlydHkgcGF0aCBsZXRzXG4gIC8vIHRoZSBqb2luZWQgd3JpdGUgZmlyZSBhZHZpc29yeSBcdTIwMTQgc2FtZSBib3VuZGVkIGhhcm0gYXMgdGhlIHBsYW4nc1xuICAvLyBkb2N1bWVudGVkIFwiY29pbmNpZGVudGFsbHkgcGFzc2VzXCIgam9pbiBjb3JuZXIsIGFuZCBhIGhhcm5lc3Mtc3VwcGxpZWRcbiAgLy8gbm9uLXplcm8gZXhpdCBjb2RlIHN0aWxsIHN1cHByZXNzZXMgdGhlIGFkdmlzb3J5IGNsYXNzIGluIHBhc3MgQi5cbiAgY29uc3QgcmVjcmVhdGVCeVBhdGggPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnKSBjb250aW51ZTtcbiAgICAgIGlmIChlLnRvdWNoID09PSBudWxsIHx8IGUudG91Y2gua2luZCAhPT0gJ3dyaXRlJyB8fCBlLnRvdWNoLnRhcmdldFN0YXRlICE9PSAnZXhpc3RzJykgY29udGludWU7XG4gICAgICBpZiAoIUZJTEVfUFJPRFVDSU5HX09QUy5oYXMoZS5tYXRjaC5zcGFuLm9wZXJhdGlvbikpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgcHJldiA9IHJlY3JlYXRlQnlQYXRoLmdldChlLnBhdGgpO1xuICAgICAgaWYgKHByZXYgPT09IHVuZGVmaW5lZCB8fCBpZHggPiBwcmV2KSByZWNyZWF0ZUJ5UGF0aC5zZXQoZS5wYXRoLCBpZHgpO1xuICAgIH1cbiAgfVxuICBpZiAocmVjcmVhdGVCeVBhdGguc2l6ZSA+IDApIHtcbiAgICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgICAgaWYgKGUub3V0Y29tZSAhPT0gJ2RlY2lzaXZlRmFpbCcgfHwgZS5leHBsYWluZWQpIGNvbnRpbnVlO1xuICAgICAgICBpZiAoZS50b3VjaCA9PT0gbnVsbCB8fCBlLnRvdWNoLmtpbmQgIT09ICd3cml0ZScgfHwgZS50b3VjaC50YXJnZXRTdGF0ZSAhPT0gJ2Fic2VudCcpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCByZWNyZWF0ZUlkeCA9IHJlY3JlYXRlQnlQYXRoLmdldChlLnBhdGgpO1xuICAgICAgICBpZiAocmVjcmVhdGVJZHggIT09IHVuZGVmaW5lZCAmJiByZWNyZWF0ZUlkeCA+IGUuY29tbWFuZEluZGV4ICYmIHdvcmtpbmdUcmVlQ2hhbmdlZChwcm9iZUNhY2hlLCBjd2QsIGUucGF0aCkpIHtcbiAgICAgICAgICBlLmV4cGxhaW5lZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBQZXItY29tbWFuZCB2ZXJkaWN0czogJ2ZhaWxlZCcgb24gYW55IHVuZXhwbGFpbmVkIGRlY2lzaXZlRmFpbCwgZWxzZVxuICAvLyAnc3VjY2VlZGVkJyBvbiBhdCBsZWFzdCBvbmUgZGVjaXNpdmUgb3V0Y29tZSwgZWxzZSAndW5rbm93bicuIEFcbiAgLy8gZ3VhcmQtb25seSBjb21tYW5kJ3MgZGV0ZXJtaW5pc3RpYyBleGl0IHN0YXR1cyBJUyBpdHMgdmVyZGljdCAocGxhbiBcdTAwQTczXG4gIC8vIHN0ZXAgMidzIHNwYW4tbGVzcy1ndWFyZCBydWxlKS5cbiAgY29uc3QgY29tcHV0ZWQgPSBuZXcgTWFwPG51bWJlciwgVmVyZGljdD4oKTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IGd1YXJkID0gZ3VhcmRCeUluZGV4LmdldChpZHgpO1xuICAgICAgY29tcHV0ZWQuc2V0KGlkeCwgZ3VhcmQgIT09IHVuZGVmaW5lZCA/IChndWFyZC5leGl0U3RhdHVzID09PSAwID8gJ3N1Y2NlZWRlZCcgOiAnZmFpbGVkJykgOiAndW5rbm93bicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGxldCBmYWlsZWQgPSBmYWxzZTtcbiAgICBsZXQgcGFzc2VkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnICYmICFlLmV4cGxhaW5lZCkgZmFpbGVkID0gdHJ1ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZVBhc3MnKSBwYXNzZWQgPSB0cnVlO1xuICAgIH1cbiAgICBjb21wdXRlZC5zZXQoaWR4LCBmYWlsZWQgPyAnZmFpbGVkJyA6IHBhc3NlZCA/ICdzdWNjZWVkZWQnIDogJ3Vua25vd24nKTtcbiAgfVxuXG4gIC8vIFRoZSBqb2luIGZpbHRlciAocGxhbiBcdTAwQTczIHN0ZXAgMik6IGEgc2tpcHBlZCBjb21tYW5kJ3MgY2hhaW5lZCB2ZXJkaWN0IGlzXG4gIC8vIHRoZSBndWFyZCB0aGF0IHNraXBwZWQgaXQgXHUyMDE0ICdmYWlsZWQnIGFmdGVyIGFuICYmLXNraXAsICdzdWNjZWVkZWQnIGFmdGVyXG4gIC8vIGFuIHx8LXNraXAgXHUyMDE0IG1hdGNoaW5nIHRoZSBzaGVsbCBzaG9ydC1jaXJjdWl0IChhIHx8IGIgfHwgYyBzdG9wcyBhZnRlclxuICAvLyB0aGUgZmlyc3Qgc3VjY2VzcykuICd1bmtub3duJyBmYWlscyBvcGVuLlxuICBjb25zdCBlZmZlY3RpdmUgPSBuZXcgTWFwPG51bWJlciwgVmVyZGljdD4oKTtcbiAgY29uc3Qgc2tpcHBlZCA9IG5ldyBTZXQ8bnVtYmVyPigpO1xuICBsZXQgcHJldkluZGV4OiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3Qgam9pbiA9IGpvaW5PZkNvbW1hbmQoaWR4LCBncm91cHMsIGd1YXJkQnlJbmRleCk7XG4gICAgY29uc3QgcHJldlZlcmRpY3QgPSBwcmV2SW5kZXggIT09IG51bGwgPyBlZmZlY3RpdmUuZ2V0KHByZXZJbmRleCkgOiB1bmRlZmluZWQ7XG4gICAgaWYgKHByZXZWZXJkaWN0ICE9PSB1bmRlZmluZWQgJiYgam9pbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoKGpvaW4gPT09ICcmJicgJiYgcHJldlZlcmRpY3QgPT09ICdmYWlsZWQnKSB8fCAoam9pbiA9PT0gJ3x8JyAmJiBwcmV2VmVyZGljdCA9PT0gJ3N1Y2NlZWRlZCcpKSB7XG4gICAgICAgIGVmZmVjdGl2ZS5zZXQoaWR4LCBqb2luID09PSAnJiYnID8gJ2ZhaWxlZCcgOiAnc3VjY2VlZGVkJyk7XG4gICAgICAgIHNraXBwZWQuYWRkKGlkeCk7XG4gICAgICAgIHByZXZJbmRleCA9IGlkeDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIGVmZmVjdGl2ZS5zZXQoaWR4LCBjb21wdXRlZC5nZXQoaWR4KSEpO1xuICAgIHByZXZJbmRleCA9IGlkeDtcbiAgfVxuXG4gIC8vIFBhc3MgQjogcnVuIHRoZSB0b3VjaCBob29rIGZvciBzdXJ2aXZpbmcgc3BhbnMgb25seSBcdTIwMTQgZGVjaXNpdmVQYXNzLCBvclxuICAvLyBpbmNvbmNsdXNpdmUgd2l0aCBhbiAnZXhpc3RzJyB0YXJnZXQgKHRoZSBhZHZpc29yeSByZXNpZHVhbCBjbGFzczpcbiAgLy8gZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIGZpcmUgYW5kIGhlYWwvc3VyZmFjZTsgcGhhbnRvbSBkZWxldGVzIG5ldmVyXG4gIC8vIGZpcmUpLiBBIGhhcm5lc3Mtc3VwcGxpZWQgbm9uLXplcm8gZXhpdCBjb2RlIHN1cHByZXNzZXMgdGhlIGFkdmlzb3J5XG4gIC8vIGNsYXNzIHRvbywgYm91bmRlZCBieSB0d28gZG9jdW1lbnRlZC1yZXNpZHVlIGZhY2VzIChzZWVcbiAgLy8gYmFzaFJlc3BvbnNlRXhpdENvZGUpOiB0aGUgY29kZSBpcyB0aGUgY29tcG91bmQncywgc28gYSBtYXNrZWQgZmFpbHVyZVxuICAvLyAoYGdpdCBhcHBseSBwLmRpZmYgfHwgZWNobyBva2AgZXhpdGluZyAwKSBzdXBwcmVzc2VzIG5vdGhpbmcgYW5kIGFcbiAgLy8gdHJhaWxpbmcgZmFpbHVyZSAoYHNlZCAtaSBzL2EvYi8gZjsgZmFsc2VgKSBzdXBwcmVzc2VzIGFuIGVhcmxpZXIgcmVhbFxuICAvLyB3cml0ZSBcdTIwMTQgYW5kIGEgbm9uemVybyBjb2RlIGRvZXMgbm90IHByb3ZlIHRoZSB3cml0ZSBkaWQgbm90IGhhcHBlbiBmb3JcbiAgLy8gdGhlIG5vbi1hdG9taWMgd3JpdGVycyB0aGF0IG1vZGlmeSBiZWZvcmUgZmFpbGluZyAocGF0Y2ggYXBwbHlpbmdcbiAgLy8gZWFybGllciBodW5rcywgYGdpdCBhcHBseSAtLXJlamVjdGAsIGZvcm1hdHRlcnMgd3JpdGluZyBmaXhlcyB0aGVuXG4gIC8vIGV4aXRpbmcgbm9uemVybykuIEEgemVybyBvciBhYnNlbnQgY29kZSBwcm9jZWVkcywgYW5kIGNvbnRlbnQtdmVyaWZpZWRcbiAgLy8gZGVjaXNpdmUgcGFzc2VzIGZpcmUgcmVnYXJkbGVzcyAoZmFpbC1vcGVuLCBwbGFuIFx1MDBBNzQpLiBHdWFyZC1vbmx5XG4gIC8vIGNvbW1hbmRzIGhhdmUgbm8gdG91Y2hlcy4gRXhwbGFpbmVkIGZhaWxzIGFuZCBkZWNpc2l2ZSBmYWlscyBuZXZlclxuICAvLyByZWFjaCBhbiBleGVjdXRvci5cbiAgY29uc3QgYmxvY2tzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBpZiAoc2tpcHBlZC5oYXMoaWR4KSkgY29udGludWU7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGxldCB0b3VjaGVzID0gMDtcbiAgICBmb3IgKGNvbnN0IGUgb2YgbGlzdCkge1xuICAgICAgaWYgKGUudG91Y2ggPT09IG51bGwgfHwgZS5leHBsYWluZWQpIGNvbnRpbnVlO1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcpIGNvbnRpbnVlO1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2luY29uY2x1c2l2ZScgJiYgZS50b3VjaC5raW5kID09PSAnd3JpdGUnICYmIGUudG91Y2gudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnKSBjb250aW51ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdpbmNvbmNsdXNpdmUnICYmIGUudG91Y2gua2luZCA9PT0gJ3dyaXRlJyAmJiBleGl0Q29kZSAhPT0gdW5kZWZpbmVkICYmIGV4aXRDb2RlICE9PSAwKVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIGlmICh0b3VjaGVzID49IDMyKSB7XG4gICAgICAgIC8vIEhhcmQgcGVyLWNvbW1hbmQgdm9sdW1lIGNhcCAocGxhbiBcdTAwQTczIHN0ZXAgMik6IGRyb3AgdGhlIHN1cnBsdXMgd2l0aFxuICAgICAgICAvLyBhIHdhcm5pbmcgcmF0aGVyIHRoYW4gYmxvdyB0aGUgaG9vayB0aW1lb3V0IG9uIGEgNTAtY29weSBjaGFpbi5cbiAgICAgICAgd2FybihgQmFzaCB0b3VjaCBjYXAgKDMyKSByZWFjaGVkIGZvciBzaW1wbGUgY29tbWFuZCAke2lkeH07IGRyb3BwaW5nIHRoZSByZW1haW5pbmcgdG91Y2hlc2ApO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIHRvdWNoZXMgKz0gMTtcbiAgICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1blRvdWNoSG9vayhlLnRvdWNoLCBleGVjdXRvcnMsIG1lbW8sIHByb2JlQ2FjaGUpO1xuICAgICAgaWYgKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCkgYmxvY2tzLnB1c2gob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGJsb2Nrcztcbn1cbiIsICIvKipcbiAqIFN0YXRpYyBjbGFzc2lmaWNhdGlvbiBvZiBhIEJhc2ggdG9vbCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGVcbiAqIHBhdGgocykgKyBsaW5lIHJhbmdlKHMpIGl0IHJlYWRzIG9yIHdyaXRlcywgd2hlcmUgdGhhdCdzIHN0YXRpY2FsbHlcbiAqIGRldGVybWluYWJsZS4gQnVpbHQgZnJvbSBhbiBlbXBpcmljYWwgcGFzcyBvdmVyIH4zMWsgcmVhbCBDbGF1ZGUgQ29kZVxuICogQmFzaCBpbnZvY2F0aW9ucyAoc2VlIGFuYWx5emUtdHJhbnNjcmlwdHMubXRzKSBcdTIwMTQgdGhlIGlkaW9tcyBiZWxvdyBhcmVcbiAqIGV4YWN0bHkgdGhlIG9uZXMgdGhhdCB0dXJuZWQgb3V0IHRvIGJlIGNvbW1vbiBBTkQgcmVsaWFibGUgdGhlcmUuXG4gKlxuICogRGVsaWJlcmF0ZWx5IE5PVCBjb3ZlcmVkIChzZWUgdGhlIHJlc2VhcmNoIHJlcG9ydCk6IGF3ayBOUi10cmlja3MgKHJhcmUsXG4gKiB1bmNvbnN0cmFpbmVkIHN5bnRheCksIGdyZXAgLW4vLUEvLUIvLUMgKHRoZSB3aW5kb3cgaXMgYW5jaG9yZWQgdG8gbWF0Y2hcbiAqIHBvc2l0aW9uLCB3aGljaCBpcyBkYXRhLWRlcGVuZGVudCwgbm90IGluIHRoZSBjb21tYW5kIHRleHQpLCBlbWJlZGRlZFxuICogcHl0aG9uMy9ub2RlIGhlcmVkb2Mgc2NyaXB0cyAoYSBkaWZmZXJlbnQgbGFuZ3VhZ2UncyBBU1QsIG5vdCBhIHNoZWxsXG4gKiBjb25jZXJuKSwgYW5kIGBmaW5kIDxkaXI+IC1uYW1lLy1wYXRoIC4uLiAtZGVsZXRlYCAodGhlIGRlbGV0ZWQgcGF0aHMgYXJlXG4gKiB0aGUgZGlyZWN0b3J5J3MgY29udGVudHMgYXMgdGhlIGZpbmRlciB3YWxrcyBpdCBcdTIwMTQgZGF0YS1kZXBlbmRlbnQsIG5vdFxuICogc3RhdGljYWxseSBlbnVtZXJhYmxlOyB0aGUgcmVjdXJzaXZlLXJlbW92YWwgZmFpbC1jbG9zZWQgcnVsZSBhcHBsaWVzKS5cbiAqXG4gKiBUaGUgY2FyZCdzIHdyaXRlLXRvdWNoIGZhbWlsaWVzIFx1MjAxNCByZWRpcmVjdGlvbnMgYW5kIGhlcmVkb2NzIChcdTAwQTc1LjFcdTIwMTNcdTAwQTc1LjIpLFxuICogY3AgYW5kIGluc3RhbGwgKFx1MDBBNzUuMyksIG12IGFuZCBnaXQgbXYgKFx1MDBBNzUuNCksIHJtIGFuZCB0cnVuY2F0ZSAoXHUwMEE3NS41KSxcbiAqIHNlZCAtaSAoXHUwMEE3NS42KSwgcGF0Y2ggYW5kIGdpdCBhcHBseSAoXHUwMEE3NS43KSwgZm9ybWF0dGVyIHdyaXRlIGZsYWdzIChcdTAwQTc1LjgpLFxuICogYW5kIGdpdCByZXN0b3JlL2NoZWNrb3V0IHBhdGhzcGVjcyAoXHUwMEE3NS45KSBcdTIwMTQgYXJlIHRoZSBncmFtbWFycyBiZWxvdy4gRWFjaFxuICogZmFtaWx5IGZhaWxzIGNsb3NlZCBvbiB3aGF0IGl0IGNhbm5vdCBzdGF0aWNhbGx5IGF0dHJpYnV0ZTpcbiAqIHNoZWxsLWV4cGFuZGVkIG9yIGR5bmFtaWMgY29udGVudCwgcmVjdXJzaXZlIHJlbW92YWwgKGBybSAtcmApLFxuICogaGVyZS1zdHJpbmdzIChgPDw8YCksIGRpcmVjdG9yeS1zaGFwZWQgdGFyZ2V0cywgd3JhcHBlci13cmFwcGVkIGNvbW1hbmRzXG4gKiB3aG9zZSBhcmd2IGNhbm5vdCBiZSByZWNvdmVyZWQsIGFuZCB1bm1hdGNoZWQgcGF0aHNwZWNzIGVtaXQgbm8gc3BhbiBhdFxuICogYWxsIG9yIGFuIGV4cGxpY2l0IHVucmVzb2x2ZWQgZW50cnkgXHUyMDE0IG5ldmVyIGEgZ3Vlc3NlZCB3cml0ZS5cbiAqL1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGpvaW4gYXMgam9pblBhdGgsIHJlc29sdmUgYXMgcmVzb2x2ZVBhdGggfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgY291bnRGaWxlTGluZXMsIGNvdW50R2l0QmxvYkxpbmVzIH0gZnJvbSAnLi9jb21tYW5kLXJlc29sdmUuanMnO1xuaW1wb3J0IHsgdHlwZSBTaW1wbGVDb21tYW5kLCBzcGxpdFRvcExldmVsLCBzdHJpcExlYWRpbmdBc3NpZ25tZW50cywgdHlwZSBUb2tlbiwgdG9rZW5pemUgfSBmcm9tICcuL3NoZWxsLXNwbGl0LmpzJztcbmltcG9ydCB7IHR5cGUgUGF0aFN0cmlwLCBwYXJzZVVuaWZpZWREaWZmUmFuZ2UgfSBmcm9tICcuL3VuaWZpZWQtZGlmZi5qcyc7XG5cbi8qKlxuICogVGhlIGV4cGxpY2l0IG9wZXJhdGlvbiBraW5kIG9mIGEgcmVzb2x2ZWQgc3Bhbi4gVGhlIGFkYXB0ZXJzIHRyYW5zbGF0ZSBmcm9tXG4gKiB0aGlzLCBuZXZlciBmcm9tIGBpZGlvbSA9PT0gJ2hlcmVkb2Mtd3JpdGUnYC1zdHlsZSBjaGVja3MgKHBsYW4gXHUwMEE3MSkuXG4gKi9cbmV4cG9ydCB0eXBlIE9wZXJhdGlvbiA9XG4gIHwgJ3JlYWQnIC8vIHJlYWQgaWRpb21zOyBjcC9pbnN0YWxsIHNvdXJjZSBvcGVyYW5kc1xuICB8ICdjcmVhdGUtb3ZlcndyaXRlJyAvLyB0cnVuY2F0aW5nIGNvbnRlbnQgd3JpdGVzOiA+IHJlZGlyZWN0cywgdGVlLCBoZXJlZG9jID4sIGNwL212IGRlc3QsIHJlc3RvcmUvY2hlY2tvdXQsIHBhdGNoIGFkZFxuICB8ICdhcHBlbmQnIC8vID4+IHJlZGlyZWN0cywgdGVlIC1hLCBoZXJlZG9jID4+XG4gIHwgJ21vZGlmeScgLy8gaW4tcGxhY2UgZWRpdHMgd2l0aCB1bmtub3duIGNvbnRlbnQ6IHNlZCAtaSwgcGF0Y2ggaHVua3MsIGZvcm1hdHRlciB3cml0ZSBmbGFnc1xuICB8ICdyZW5hbWUtY29weScgLy8gbXYvZ2l0IG12L3BhdGNoLXJlbmFtZSBkZXN0aW5hdGlvbiAod2hvbGUtZmlsZSB3cml0ZSwgc2FtZSB0b3VjaCBhcyBjcmVhdGUtb3ZlcndyaXRlKVxuICB8ICd0cnVuY2F0ZScgLy8gOiA+IGYsIGJhcmUgPiBmLCB0cnVuY2F0ZVxuICB8ICdkZWxldGUnOyAvLyBybSwgbXYvZ2l0IG12IHNvdXJjZSwgcGF0Y2ggZGVsZXRlXG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb2x2ZWRTcGFuIHtcbiAgb3BlcmF0aW9uOiBPcGVyYXRpb247XG4gIGFic29sdXRlUGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogRXhhY3QgcmFuZ2U6IGV2ZXJ5IHJlYWQ7IG1vZGlmeSBvcGVyYXRpb25zIHdpdGggYSBzdGF0aWNhbGx5IGtub3duIHJhbmdlXG4gICAqIChzZWQgLWkgbnVtZXJpYyBhZGRyZXNzZXMsIHBhdGNoIGh1bmsgdW5pb25zKS4gQWJzZW50IGZvciB3cml0ZXMgXHUyMTkyXG4gICAqIHdob2xlLWZpbGUgc2NvcGUuXG4gICAqL1xuICBsaW5lU3RhcnQ/OiBudW1iZXI7XG4gIGxpbmVFbmQ/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBTdGF0aWNhbGx5IGtub3duIHdyaXR0ZW4gY29udGVudCBcdTIwMTQgYXBwZW5kIGJvZGllcyBhbmQgbGl0ZXJhbCBvdmVyd3JpdGVcbiAgICogYm9kaWVzIChoZXJlZG9jL2VjaG8vcHJpbnRmL3RlZSBsaXRlcmFscywgcGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBPbiBhcHBlbmRzIGl0XG4gICAqIGlzIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHk7IG9uIGBjcmVhdGUtb3ZlcndyaXRlYCBpdCBpcyB0aGUgZXhhY3QgZ2F0ZSdzXG4gICAqIHBvc3QtY29udGVudCBcdTIwMTQgdGhlIHRvdWNoIGl0c2VsZiBzdGF5cyB3aG9sZS1maWxlIChgd3JpdHRlbjogJydgKSBlaXRoZXJcbiAgICogd2F5LlxuICAgKi9cbiAgd3JpdHRlbj86IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBzdGF0aWNhbGx5IGV2YWx1YXRlZCBhYnNvbHV0ZSBgdHJ1bmNhdGUgLXMgTmAgc2l6ZSAocGxhbiBcdTAwQTc1LjUpOiB0aGVcbiAgICogXHUwMEE3MyBgc2l6ZWAgZ2F0ZSdzIHBvc3QtY29tbWFuZCBieXRlIGNvdW50IChgLXMgMGAgXHUyMTkyIHRoZSBlbXB0eSBnYXRlKS5cbiAgICogQWJzZW50IGZvciByZWxhdGl2ZSBzaXplcyAoYC1zICtOYC9gLXMgLU5gKSwgYC1yIHJlZmAsIGFuZCBldmVyeSBvdGhlclxuICAgKiBvcGVyYXRpb24gXHUyMDE0IHRob3NlIGdhdGUgZXhpc3RlbmNlLW9ubHkuXG4gICAqL1xuICBzaXplPzogbnVtYmVyO1xuICAvKipcbiAgICogT3JkaW5hbCBvZiB0aGUgc3BhbidzIHNpbXBsZSBjb21tYW5kIHdpdGhpbiB0aGUgY29tcG91bmQsIGluIHdhbGtlclxuICAgKiBvcmRlcjsgZ3JvdXBzIHRoZSBzcGFucyBvZiBvbmUgY29tbWFuZCBmb3Igam9pbiBnYXRpbmcgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLlxuICAgKi9cbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXI7XG4gIC8qKlxuICAgKiBUaGUgb3BlcmF0b3IgcHJlY2VkaW5nIHRoZSBzcGFuJ3Mgc2ltcGxlIGNvbW1hbmQ7IG9ubHkgYCcmJidgL2AnfHwnYCBnYXRlLlxuICAgKiBBYnNlbnQgZm9yIGBzdGFydGAvYDtgL25ld2xpbmUvYCZgL2B8YCBib3VuZGFyaWVzLlxuICAgKi9cbiAgam9pbj86ICcmJicgfCAnfHwnO1xuICBub3RlPzogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBJZGlvbSA9XG4gIHwgJ3NlZC1uLXJhbmdlJ1xuICB8ICdoZWFkLWZpbGUnXG4gIHwgJ3RhaWwtZmlsZSdcbiAgfCAnY2F0LWZpbGUnXG4gIHwgJ25sLWZpbGUnXG4gIHwgJ2dpdC1zaG93LXJldi1wYXRoJ1xuICB8ICdnaXQtbG9nLUwnXG4gIHwgJ2hlcmVkb2Mtd3JpdGUnXG4gIC8vIFRoZSB3cml0ZS10b3VjaCBmYW1pbGllcyAocGxhbiBcdTAwQTc1KS4gSWRpb20gc3RheXMgbWF0Y2ggbWV0YWRhdGEgZm9yIHRlc3RzXG4gIC8vIGFuZCB1bnJlc29sdmVkIHJlYXNvbnM7IGFkYXB0ZXIgYmVoYXZpb3Iga2V5cyBvbiBgb3BlcmF0aW9uYCwgbmV2ZXIgaWRpb20uXG4gIHwgJ3JlZGlyZWN0LXdyaXRlJyAvLyBcdTAwQTc1LjE6IGVjaG8vcHJpbnRmL3RlZSBjb250ZW50IHJlZGlyZWN0c1xuICB8ICd0cnVuY2F0ZS13cml0ZScgLy8gXHUwMEE3NS4xOiBiYXJlIGA+IGZgIC8gYDogPiBmYCB0cnVuY2F0aW9uc1xuICB8ICdjcC13cml0ZScgLy8gXHUwMEE3NS4zXG4gIHwgJ2luc3RhbGwtd3JpdGUnIC8vIFx1MDBBNzUuM1xuICB8ICdtdi13cml0ZScgLy8gXHUwMEE3NS40OiBtdiBhbmQgZ2l0IG12XG4gIHwgJ3JtLXdyaXRlJyAvLyBcdTAwQTc1LjU6IHJtIGFuZCBnaXQgcm1cbiAgfCAndHJ1bmNhdGUtY29tbWFuZCcgLy8gXHUwMEE3NS41OiB0aGUgdHJ1bmNhdGUgY29tbWFuZFxuICB8ICdzZWQtaW5wbGFjZScgLy8gXHUwMEE3NS42OiBzZWQgLWlcbiAgfCAncGF0Y2gtd3JpdGUnIC8vIFx1MDBBNzUuNzogcGF0Y2ggYW5kIGdpdCBhcHBseVxuICB8ICdmb3JtYXR0ZXItd3JpdGUnIC8vIFx1MDBBNzUuOFxuICB8ICdnaXQtcmVzdG9yZS13cml0ZScgLy8gXHUwMEE3NS45OiBnaXQgcmVzdG9yZSBwYXRoc3BlY3NcbiAgfCAnZ2l0LWNoZWNrb3V0LXdyaXRlJzsgLy8gXHUwMEE3NS45OiBnaXQgY2hlY2tvdXQgLS0gcGF0aHNwZWNzXG5cbmV4cG9ydCB0eXBlIFNwYW5NYXRjaCA9XG4gIHwgeyBzdGF0dXM6ICdyZXNvbHZlZCc7IGlkaW9tOiBJZGlvbTsgc3BhbjogUmVzb2x2ZWRTcGFuOyBub3RlPzogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VucmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IGZpbGVBcmc6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHtcbiAgICAgIC8qKlxuICAgICAgICogQSBzcGFuLWxlc3MgY29tbWFuZCB3aXRoIGEgZGV0ZXJtaW5pc3RpYyBleGl0IHN0YXR1cyBcdTIwMTQgYGZhbHNlYCAoMSksXG4gICAgICAgKiBgdHJ1ZWAgKDApLCBgOmAgKDApLiBObyBzcGFuIGFuZCBubyB0b3VjaCwgYnV0IHRoZSBqb2luIGRyaXZlciBuZWVkc1xuICAgICAgICogdGhlIHZlcmRpY3Q6IGBmYWxzZSAmJiBlY2hvIHggPiBmYCBza2lwcyB0aGUgZWNobywgYHRydWUgfHwgZWNobyB4ID5cbiAgICAgICAqIGZgIHNraXBzIGl0IHRvbywgYW5kIHdpdGhvdXQgdGhlIGd1YXJkIGJvdGggd291bGQgZmlyZSBhbiBleGFjdC1nYXRlXG4gICAgICAgKiB0b3VjaCBmb3IgYSB3cml0ZSB0aGF0IG5ldmVyIHJhbiAocGxhbiBcdTAwQTczIHN0ZXAgMidzIHNwYW4tbGVzcy1ndWFyZFxuICAgICAgICogcnVsZSkuIEZpbHRlcmVkIG91dCBvZiBgcGFyc2VDb21tYW5kYCdzIHNwYW4gbGlzdCB3aXRoIHRoZVxuICAgICAgICogdW5yZXNvbHZlZHMuXG4gICAgICAgKi9cbiAgICAgIHN0YXR1czogJ2J1aWx0aW4tZ3VhcmQnO1xuICAgICAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXI7XG4gICAgICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXTtcbiAgICAgIGV4aXRTdGF0dXM6IDAgfCAxO1xuICAgIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZS1yYW5nZSBzcGVjczogd2hhdCBhIG1hdGNoZWQgaWRpb20gc2F5cyBhYm91dCB0aGUgcmFuZ2UsIGJlZm9yZSB3ZSBrbm93XG4vLyB3aGV0aGVyIHJlc29sdmluZyBpdCBuZWVkcyB0byBjb25zdWx0IGEgcmVhbCBmaWxlL2dpdCBibG9iLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgTGluZVJhbmdlU3BlYyA9XG4gIHwgeyBraW5kOiAnbGl0ZXJhbCc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JzsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3RvRW9mJzsgc3RhcnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnbGFzdE5MaW5lcyc7IGNvdW50OiBudW1iZXIgfVxuICB8IHsga2luZDogJ2FwcGVuZExpbmVzJzsgY291bnQ6IG51bWJlciB9O1xuXG5mdW5jdGlvbiByZXNvbHZlU3BlYyhcbiAgc3BlYzogTGluZVJhbmdlU3BlYyxcbiAgdG90YWxMaW5lczogKCkgPT4gbnVtYmVyIHwgbnVsbFxuKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgc3dpdGNoIChzcGVjLmtpbmQpIHtcbiAgICBjYXNlICdsaXRlcmFsJzpcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogc3BlYy5zdGFydCwgbGluZUVuZDogc3BlYy5lbmQgfTtcbiAgICBjYXNlICd1cHBlckJvdW5kRnJvbVN0YXJ0Jzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IHRvdGFsICE9PSBudWxsID8gTWF0aC5taW4oc3BlYy5lbmQsIHRvdGFsKSA6IHNwZWMuZW5kIH07XG4gICAgfVxuICAgIGNhc2UgJ3RvRW9mJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBNYXRoLm1heChzcGVjLnN0YXJ0LCB0b3RhbCkgfTtcbiAgICB9XG4gICAgY2FzZSAnbGFzdE5MaW5lcyc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsIHx8IHRvdGFsID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogTWF0aC5tYXgoMSwgdG90YWwgLSBzcGVjLmNvdW50ICsgMSksIGxpbmVFbmQ6IHRvdGFsIH07XG4gICAgfVxuICAgIGNhc2UgJ2FwcGVuZExpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCkgPz8gMDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogdG90YWwgKyAxLCBsaW5lRW5kOiB0b3RhbCArIHNwZWMuY291bnQgfTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gaGFzU2hlbGxFeHBhbnNpb24oczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvWyRgXS8udGVzdChzKTtcbn1cblxuZnVuY3Rpb24gbG9va3NVbnJlc29sdmFibGUoczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBoYXNTaGVsbEV4cGFuc2lvbihzKSB8fCAvWyo/XS8udGVzdChzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJZGlvbSBtYXRjaGVyczogcHVyZSBmdW5jdGlvbnMgb3ZlciBvbmUgc2ltcGxlIGNvbW1hbmQncyBhcmd2LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBSYXdDYW5kaWRhdGUge1xuICBraW5kOiAnY2FuZGlkYXRlJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHNwZWM6IExpbmVSYW5nZVNwZWM7XG4gIHJlc29sdmVyS2luZDogJ2ZzJyB8IHsga2luZDogJ2dpdCc7IHJldjogc3RyaW5nIH07XG4gIGRpck92ZXJyaWRlPzogc3RyaW5nO1xufVxuaW50ZXJmYWNlIFJhd1VucmVzb2x2ZWQge1xuICBraW5kOiAndW5yZXNvbHZlZCc7XG4gIGlkaW9tOiBJZGlvbTtcbiAgZmlsZUFyZzogc3RyaW5nO1xuICByZWFzb246IHN0cmluZztcbn1cbnR5cGUgTWF0Y2hSZXN1bHQgPSBSYXdDYW5kaWRhdGUgfCBSYXdVbnJlc29sdmVkO1xuXG5jb25zdCBTRURfUkFOR0UgPSAvXihcXGQrKSg/OiwoXFxkK3xcXCQpKT9wJC87XG5cbi8qKiBTcGxpdCBhIGBzZWRgIHNjcmlwdCBhcmd1bWVudCBpbnRvIGl0cyBgO2Atc2VwYXJhdGVkIHNlZ21lbnRzLiAqL1xuZnVuY3Rpb24gc2VkU2NyaXB0U2VnbWVudHMoc2NyaXB0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBzY3JpcHQuc3BsaXQoJzsnKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hTZWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdzZWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAoIXJlc3QuaW5jbHVkZXMoJy1uJykpIHJldHVybiBbXTtcbiAgbGV0IHNjcmlwdElkeCA9IC0xO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAocmVzdFtpXSA9PT0gJy1uJykgY29udGludWU7XG4gICAgaWYgKHNlZFNjcmlwdFNlZ21lbnRzKHJlc3RbaV0pLnNvbWUoKHNlZykgPT4gU0VEX1JBTkdFLnRlc3Qoc2VnKSkpIHtcbiAgICAgIHNjcmlwdElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKHNjcmlwdElkeCA9PT0gLTEpIHJldHVybiBbXTtcbiAgY29uc3QgZmlsZUNhbmRpZGF0ZXMgPSByZXN0LmZpbHRlcigoYSwgaSkgPT4gaSAhPT0gc2NyaXB0SWR4ICYmIGEgIT09ICctbicgJiYgIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgaWYgKGZpbGVDYW5kaWRhdGVzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQXJnID0gZmlsZUNhbmRpZGF0ZXNbMF07XG4gIGNvbnN0IHJlc3VsdHM6IE1hdGNoUmVzdWx0W10gPSBbXTtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZFNjcmlwdFNlZ21lbnRzKHJlc3Rbc2NyaXB0SWR4XSkpIHtcbiAgICBjb25zdCBtYXRjaCA9IHNlZ21lbnQubWF0Y2goU0VEX1JBTkdFKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtYXRjaFsxXSwgMTApO1xuICAgIGNvbnN0IGVuZFRva2VuID0gbWF0Y2hbMl07XG4gICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9XG4gICAgICBlbmRUb2tlbiA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IHN0YXJ0IH1cbiAgICAgICAgOiBlbmRUb2tlbiA9PT0gJyQnXG4gICAgICAgICAgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0IH1cbiAgICAgICAgICA6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydCwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZW5kVG9rZW4sIDEwKSB9O1xuICAgIHJlc3VsdHMucHVzaCh7IGtpbmQ6ICdjYW5kaWRhdGUnLCBpZGlvbTogJ3NlZC1uLXJhbmdlJywgZmlsZUFyZywgc3BlYywgcmVzb2x2ZXJLaW5kOiAnZnMnIH0pO1xuICB9XG4gIHJldHVybiByZXN1bHRzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUhlYWRUYWlsRmxhZ3MocmVzdDogc3RyaW5nW10pOiB7XG4gIGNvdW50OiBudW1iZXIgfCBudWxsO1xuICBmcm9tU3RhcnQ6IGJvb2xlYW47XG4gIGRpc3F1YWxpZmllZDogYm9vbGVhbjtcbiAgZmlsZXM6IHN0cmluZ1tdO1xufSB7XG4gIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY291bnQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBsZXQgZnJvbVN0YXJ0ID0gZmFsc2U7XG4gIGxldCBkaXNxdWFsaWZpZWQgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctZicgfHwgYSA9PT0gJy1GJyB8fCBhID09PSAnLS1mb2xsb3cnIHx8IGEuc3RhcnRzV2l0aCgnLS1mb2xsb3c9JykpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICcteicgfHwgYSA9PT0gJy0temVyby10ZXJtaW5hdGVkJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJyB8fCBhID09PSAnLS1ieXRlcycpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eKC1jfC0tYnl0ZXM9KS8udGVzdChhKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1xJyB8fCBhID09PSAnLXYnIHx8IGEgPT09ICctLXF1aWV0JyB8fCBhID09PSAnLS1zaWxlbnQnIHx8IGEgPT09ICctLXZlcmJvc2UnKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLWxpbmVzPScpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgnLS1saW5lcz0nLmxlbmd0aCk7XG4gICAgICBpZiAoL15cXCs/XFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1uXFwrP1xcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgyKTtcbiAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eXFwrXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGZyb21TdGFydCA9IHRydWU7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLVxcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctJykge1xuICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgIGZpbGVzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaEhlYWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdoZWFkJykgcmV0dXJuIFtdO1xuICBjb25zdCB7IGNvdW50LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAnaGVhZC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWM6IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnLCBlbmQ6IG4gfSBhcyBMaW5lUmFuZ2VTcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoVGFpbChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3RhaWwnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoZGlzcXVhbGlmaWVkKSByZXR1cm4gW107XG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID0gZnJvbVN0YXJ0ID8geyBraW5kOiAndG9Fb2YnLCBzdGFydDogbiB9IDogeyBraW5kOiAnbGFzdE5MaW5lcycsIGNvdW50OiBuIH07XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAndGFpbC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gZmluZEdpdFN1YmNvbW1hbmQoXG4gIHJlc3Q6IHN0cmluZ1tdXG4pOiB7IHN1YklkeDogbnVtYmVyOyBzdWJjb21tYW5kOiBzdHJpbmc7IGNEaXI6IHN0cmluZyB8IG51bGw7IGNEaXJVbnJlc29sdmFibGU6IGJvb2xlYW4gfSB8IG51bGwge1xuICBsZXQgY0Rpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBjRGlyVW5yZXNvbHZhYmxlID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCByZXN0Lmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSByZXN0W2ldO1xuICAgIGlmIChhID09PSAnLUMnKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGlmIChoYXNTaGVsbEV4cGFuc2lvbih2KSkgY0RpclVucmVzb2x2YWJsZSA9IHRydWU7XG4gICAgICBlbHNlIGNEaXIgPSB2O1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSB7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcmV0dXJuIHsgc3ViSWR4OiBpLCBzdWJjb21tYW5kOiBhLCBjRGlyLCBjRGlyVW5yZXNvbHZhYmxlIH07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmNvbnN0IFJFVl9QQVRIID0gL14oW15cXHM6XSspOiguKykkLztcblxuZnVuY3Rpb24gbWF0Y2hHaXRTaG93KGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdzaG93JykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3ZcbiAgICAuc2xpY2UoMSlcbiAgICAuc2xpY2Uoc3ViLnN1YklkeCArIDEpXG4gICAgLmZpbHRlcigoYSkgPT4gIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgY29uc3QgcmV2UGF0aEFyZyA9IGFmdGVyLmZpbmQoKGEpID0+IFJFVl9QQVRILnRlc3QoYSkpO1xuICBpZiAoIXJldlBhdGhBcmcpIHJldHVybiBbXTtcbiAgY29uc3QgbSA9IHJldlBhdGhBcmcubWF0Y2goUkVWX1BBVEgpO1xuICBpZiAoIW0pIHJldHVybiBbXTtcbiAgY29uc3QgWywgcmV2LCBwYXRoXSA9IG07XG4gIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSB8fCBoYXNTaGVsbEV4cGFuc2lvbihyZXYpKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBvciByZXZpc2lvbiBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtcbiAgICB7XG4gICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgIHNwZWM6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSxcbiAgICAgIHJlc29sdmVyS2luZDogeyBraW5kOiAnZ2l0JywgcmV2IH0sXG4gICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgfVxuICBdO1xufVxuXG5mdW5jdGlvbiBtYXRjaEdpdExvZ0woYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2xvZycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhZnRlci5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhZnRlcltpXTtcbiAgICBsZXQgc3BlYzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGEgPT09ICctTCcpIHNwZWMgPSBhZnRlcltpICsgMV0gPz8gbnVsbDtcbiAgICBlbHNlIGlmIChhLnN0YXJ0c1dpdGgoJy1MJykpIHNwZWMgPSBhLnNsaWNlKDIpO1xuICAgIGlmICghc3BlYykgY29udGludWU7XG4gICAgY29uc3QgbSA9IHNwZWMubWF0Y2goL14oXFxkKyksKFxcZCspOiguKykkLyk7XG4gICAgaWYgKCFtKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBzLCBlLCBwYXRoXSA9IG07XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICB7XG4gICAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgICAgfVxuICAgICAgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgc3BlYzogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0OiBOdW1iZXIucGFyc2VJbnQocywgMTApLCBlbmQ6IE51bWJlci5wYXJzZUludChlLCAxMCkgfSxcbiAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnLFxuICAgICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW107XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVyZWRvYyB3cml0ZXMgKHBsYW4gXHUwMEE3NS4yKTogaGFuZGxlZCBhcyBhIGRlZGljYXRlZCByYXctdGV4dCBwYXNzIGJlY2F1c2UgdGhlXG4vLyBib2R5IGNhbiBpdHNlbGYgY29udGFpbiAmJi87L3wvbmV3bGluZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgY29uZnVzZVxuLy8gc3BsaXRUb3BMZXZlbC4gVGhlIG9wZW5lciBzY2FubmVyIGlzIHF1b3RlLWF3YXJlIGFuZCB2YWxpZGF0ZXMgdGhlIGNsb3Npbmdcbi8vIGRlbGltaXRlcjsgbWF0Y2hlZCBoZXJlZG9jcyBhcmUgbWFza2VkIG91dCBvZiB0aGUgc3RyaW5nIChyZXBsYWNlZCB3aXRoIGFuXG4vLyBpbmRleGVkIHBsYWNlaG9sZGVyIHNpbXBsZS1jb21tYW5kKSBiZWZvcmUgdGhlIHJlc3Qgb2YgdGhlIHBpcGVsaW5lIHJ1bnMsXG4vLyBhbmQgcmUtYXNzb2NpYXRlZCBieSBpbmRleCBkdXJpbmcgdGhlIG1haW4gd2FsayBzbyB0aGUgd3JpdGUgaXMgcmVzb2x2ZWRcbi8vIGFnYWluc3QgdGhlIGNvcnJlY3QgYGNkYC10cmFja2VkIGRpcmVjdG9yeS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIGhlcmVkb2MncyBjb250ZW50LWNhcnJ5aW5nIGZhY3RzLCByZS1hc3NvY2lhdGVkIGJ5IGluZGV4IGR1cmluZyB0aGUgd2Fsay4gKi9cbmludGVyZmFjZSBIZXJlZG9jV3JpdGUge1xuICAvKiogVGhlIG9wZW5lciBsaW5lIHZlcmJhdGltIChlLmcuIGBjYXQgPiBmIDw8J0VPRidgKSwgcmUtdG9rZW5pemVkIGR1cmluZyB0aGUgd2Fsay4gKi9cbiAgb3BlbmVyOiBzdHJpbmc7XG4gIC8qKiBUaGUgaGVyZWRvYyBib2R5OyBgPDwtYCBib2RpZXMgaGF2ZSBsZWFkaW5nIHRhYnMgc3RyaXBwZWQgcGVyIGxpbmUuICovXG4gIGJvZHk6IHN0cmluZztcbiAgLyoqIFdoZXRoZXIgdGhlIGRlbGltaXRlciB3YXMgcXVvdGVkL2VzY2FwZWQgKGA8PCdFT0YnYCwgYDw8XCJFT0ZcImAsIGA8PFxcRU9GYCk6IHRoZSBib2R5IHRoZW4gdW5kZXJnb2VzIG5vIHNoZWxsIGV4cGFuc2lvbi4gKi9cbiAgcXVvdGVkRGVsaW06IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBIZXJlZG9jT3BlbmVyIHtcbiAgLyoqIFdoZXJlIHRoZSBoZXJlZG9jJ3Mgc2ltcGxlIGNvbW1hbmQgc3RhcnRzIGluIHRoZSByYXcgc3RyaW5nLiAqL1xuICBjbWRTdGFydDogbnVtYmVyO1xuICAvKiogVGhlIG5ld2xpbmUgZW5kaW5nIHRoZSBvcGVuZXIgbGluZSwgb3IgcmF3Lmxlbmd0aCB3aGVuIGl0J3MgdGhlIGxhc3QgbGluZS4gKi9cbiAgb3BlbmVyTGluZUVuZDogbnVtYmVyO1xuICAvKiogVGhlIGNsb3NpbmcgZGVsaW1pdGVyIChxdW90ZXMgc3RyaXBwZWQpLiAqL1xuICBkZWxpbTogc3RyaW5nO1xuICAvKiogYDw8LWA6IHN0cmlwIGxlYWRpbmcgdGFicyBmcm9tIHRoZSBib2R5IGFuZCB0aGUgY2xvc2VyIGxpbmUuICovXG4gIHRhYlN0cmlwOiBib29sZWFuO1xuICAvKiogV2hldGhlciB0aGUgZGVsaW1pdGVyIHdhcyBxdW90ZWQvZXNjYXBlZCBcdTIwMTQgdGhlIHNoZWxsIHNraXBzIGJvZHkgZXhwYW5zaW9uIHRoZW4uICovXG4gIHF1b3RlZERlbGltOiBib29sZWFuO1xufVxuXG5jb25zdCBCQVJFX0RFTElNID0gL15bQS1aYS16X11bQS1aYS16MC05X10qJC87XG5cbi8qKlxuICogRmluZCB0aGUgbmV4dCBoZXJlZG9jIG9wZW5lciAoYDw8YC9gPDwtYCkgYXQgdG9wIGxldmVsLCBzY2FubmluZyBmcm9tXG4gKiBgZnJvbWAuIE1pcnJvcnMgc3BsaXRUb3BMZXZlbCdzIHNlcGFyYXRvciBoYW5kbGluZyBzbyBgY21kU3RhcnRgIG1hcmtzIHRoZVxuICogb3BlbmVyJ3Mgb3duIHNpbXBsZSBjb21tYW5kOiB0b3AtbGV2ZWwgYCYmYC9gfHxgL2A7YC9uZXdsaW5lL2AmYCBzdGFydCBhIG5ld1xuICogY29tbWFuZCAoYSBuZXdsaW5lIGFmdGVyIGEgcGlwZSBpcyBhIGxpbmUgY29udGludWF0aW9uKSwgYD5gLXJlZGlyZWN0cywgZHVwXG4gKiByZWRpcmVjdHMgKGAyPiYxYCkgYW5kIHBhcmVuIG5lc3Rpbmcgc3RheSBpbnNpZGUgdGhlIGNvbW1hbmQsIGFuZFxuICogaGVyZS1zdHJpbmdzIChgPDw8YCkgYXJlIG91dCBvZiBzY29wZS4gQW4gSU9fTlVNQkVSIGZkIGRpcmVjdGx5IGJlZm9yZSB0aGVcbiAqIG9wZXJhdG9yIChgMjw8RU9GYCkgcmVkaXJlY3RzIHRoYXQgZmQsIG5vdCBzdGRpbiBcdTIwMTQgbm90IGEgaGVyZWRvYy4gUmV0dXJuc1xuICogbnVsbCB3aGVuIG5vIG9wZW5lciBpcyBmb3VuZC5cbiAqL1xuZnVuY3Rpb24gZmluZEhlcmVkb2NPcGVuZXIocmF3OiBzdHJpbmcsIGZyb206IG51bWJlcik6IEhlcmVkb2NPcGVuZXIgfCBudWxsIHtcbiAgY29uc3QgbiA9IHJhdy5sZW5ndGg7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IGNtZFN0YXJ0ID0gZnJvbTtcbiAgbGV0IHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gIGxldCBpID0gZnJvbTtcblxuICAvKiogUmVhZCBvbmUgZGVsaW1pdGVyIHdvcmQgc3RhcnRpbmcgYXQgYHN0YXJ0YCAodGhlIGF0dGFjaGVkIHRhaWwgb2YgYDw8RU9GYC9gPDwnRU9GJ2AsIG9yIGEgc3RhbmRhbG9uZSBuZXh0IHdvcmQpLiBRdW90ZXMgY29udHJpYnV0ZSB0aGVpciBjb250ZW50OyBhIGJhY2tzbGFzaCBlc2NhcGVzIHRoZSBuZXh0IGNoYXIuIFJldHVybnMgbnVsbCBvbiBhbiB1bmJhbGFuY2VkIHF1b3RlIChmYWlsIGNsb3NlZCkuICovXG4gIGNvbnN0IHJlYWREZWxpbVdvcmQgPSAoc3RhcnQ6IG51bWJlcik6IHsgZGVsaW06IHN0cmluZzsgc2F3UXVvdGU6IGJvb2xlYW47IG5leHQ6IG51bWJlciB9IHwgbnVsbCA9PiB7XG4gICAgbGV0IGQgPSAnJztcbiAgICBsZXQgc2F3UXVvdGUgPSBmYWxzZTtcbiAgICBsZXQgayA9IHN0YXJ0O1xuICAgIHdoaWxlIChrIDwgbiAmJiAhL1xccy8udGVzdChyYXdba10pICYmIHJhd1trXSAhPT0gJzwnICYmIHJhd1trXSAhPT0gJz4nKSB7XG4gICAgICBjb25zdCBjID0gcmF3W2tdO1xuICAgICAgaWYgKGMgPT09IFwiJ1wiIHx8IGMgPT09ICdcIicpIHtcbiAgICAgICAgY29uc3QgcXVvdGUgPSBjO1xuICAgICAgICBsZXQgbSA9IGsgKyAxO1xuICAgICAgICB3aGlsZSAobSA8IG4gJiYgcmF3W21dICE9PSBxdW90ZSkge1xuICAgICAgICAgIGQgKz0gcmF3W21dO1xuICAgICAgICAgIG0gKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICAgICAgc2F3UXVvdGUgPSB0cnVlO1xuICAgICAgICBrID0gbSArIDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBrICsgMSA8IG4pIHtcbiAgICAgICAgLy8gQSBiYWNrc2xhc2gtZXNjYXBlZCBkZWxpbWl0ZXIgY2hhciBxdW90ZXMgdGhlIGRlbGltaXRlciBcdTIwMTQgdGhlIGJvZHlcbiAgICAgICAgLy8gaXMgbGl0ZXJhbCAoYDw8XFxFT0ZgKSwgc2FtZSBhcyBxdW90ZXMuXG4gICAgICAgIGQgKz0gcmF3W2sgKyAxXTtcbiAgICAgICAgc2F3UXVvdGUgPSB0cnVlO1xuICAgICAgICBrICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgZCArPSBjO1xuICAgICAgayArPSAxO1xuICAgIH1cbiAgICByZXR1cm4geyBkZWxpbTogZCwgc2F3UXVvdGUsIG5leHQ6IGsgfTtcbiAgfTtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gcmF3W2ldO1xuICAgIGlmIChpblNxdW90ZSkge1xuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSBpbkRxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TcXVvdGUgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBpbkRxdW90ZSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBkZXB0aCArPSAxO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScpIHtcbiAgICAgIGRlcHRoID0gTWF0aC5tYXgoMCwgZGVwdGggLSAxKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZGVwdGggPiAwKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHJhdy5zdGFydHNXaXRoKCcmJicsIGkpIHx8IHJhdy5zdGFydHNXaXRoKCd8fCcsIGkpKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAyO1xuICAgICAgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmF3LnN0YXJ0c1dpdGgoJ3wmJywgaSkpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IHRydWU7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICc7Jykge1xuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICd8Jykge1xuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgIC8vIEEgbmV3bGluZSBhZnRlciBhIHBpcGUgaXMgYSBsaW5lIGNvbnRpbnVhdGlvbiAobWlycm9yaW5nXG4gICAgICAvLyBzcGxpdFRvcExldmVsKTsgYW55dGhpbmcgZWxzZSBzdGFydHMgYSBuZXcgc2ltcGxlIGNvbW1hbmQuXG4gICAgICBpZiAoIXBlbmRpbmdQaXBlKSBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnJicpIHtcbiAgICAgIC8vIGAmPmAvYCY+PmAgYW5kIGR1cCByZWRpcmVjdHMgKGAyPiYxYCkgYXJlIHJlZGlyZWN0IG9wZXJhdG9ycywgbm90XG4gICAgICAvLyBjb21tYW5kIHNlcGFyYXRvcnMgKG1pcnJvcmluZyBzcGxpdFRvcExldmVsKS5cbiAgICAgIGNvbnN0IHRyaW1tZWQgPSByYXcuc2xpY2UoY21kU3RhcnQsIGkpLnRyaW1FbmQoKTtcbiAgICAgIGNvbnN0IGR1cFJlZGlyZWN0ID1cbiAgICAgICAgdHJpbW1lZC5lbmRzV2l0aCgnPicpICYmICh0cmltbWVkLmxlbmd0aCA9PT0gMSB8fCAvXFxzfFxcZC8udGVzdCh0cmltbWVkW3RyaW1tZWQubGVuZ3RoIC0gMl0gPz8gJycpKTtcbiAgICAgIGlmIChyYXdbaSArIDFdID09PSAnPicgfHwgZHVwUmVkaXJlY3QpIHtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnPCcgJiYgcmF3W2kgKyAxXSA9PT0gJzwnKSB7XG4gICAgICAvLyBgPDw8YCBpcyBhIGhlcmUtc3RyaW5nIChvdXQgb2Ygc2NvcGUpOyBgPDwtYCBzdHJpcHMgbGVhZGluZyB0YWJzLlxuICAgICAgaWYgKHJhd1tpICsgMl0gPT09ICc8Jykge1xuICAgICAgICBpICs9IDM7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgbGV0IGogPSBpIC0gMTtcbiAgICAgIHdoaWxlIChqID49IGZyb20gJiYgL1xcZC8udGVzdChyYXdbal0pKSBqIC09IDE7XG4gICAgICBjb25zdCBpb051bWJlciA9IGogPCBpIC0gMSAmJiAoaiA8IGZyb20gfHwgL1xcc3xbO3wmKF0vLnRlc3QocmF3W2pdKSk7XG4gICAgICBpZiAoaW9OdW1iZXIpIHtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRhYlN0cmlwID0gcmF3W2kgKyAyXSA9PT0gJy0nO1xuICAgICAgY29uc3Qgb3BMZW4gPSB0YWJTdHJpcCA/IDMgOiAyO1xuICAgICAgY29uc3QgbGluZUVuZCA9IHJhdy5pbmRleE9mKCdcXG4nLCBpKTtcbiAgICAgIGNvbnN0IG9wZW5lckxpbmVFbmQgPSBsaW5lRW5kID09PSAtMSA/IG4gOiBsaW5lRW5kO1xuICAgICAgY29uc3QgYXR0YWNoZWQgPSByZWFkRGVsaW1Xb3JkKGkgKyBvcExlbik7XG4gICAgICBsZXQgZGVsaW0gPSBhdHRhY2hlZCA9PT0gbnVsbCA/ICcnIDogYXR0YWNoZWQuZGVsaW07XG4gICAgICBsZXQgc2F3UXVvdGUgPSBhdHRhY2hlZCA9PT0gbnVsbCA/IGZhbHNlIDogYXR0YWNoZWQuc2F3UXVvdGU7XG4gICAgICBpZiAoZGVsaW0gPT09ICcnICYmIGF0dGFjaGVkICE9PSBudWxsKSB7XG4gICAgICAgIC8vIFN0YW5kYWxvbmUgb3BlcmF0b3I6IHRoZSBkZWxpbWl0ZXIgaXMgdGhlIG5leHQgd29yZC5cbiAgICAgICAgbGV0IGsgPSBhdHRhY2hlZC5uZXh0O1xuICAgICAgICB3aGlsZSAoayA8IG9wZW5lckxpbmVFbmQgJiYgL1xccy8udGVzdChyYXdba10pKSBrICs9IDE7XG4gICAgICAgIGNvbnN0IHdvcmQgPSByZWFkRGVsaW1Xb3JkKGspO1xuICAgICAgICBpZiAod29yZCA9PT0gbnVsbCkgZGVsaW0gPSAnJztcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgZGVsaW0gPSB3b3JkLmRlbGltO1xuICAgICAgICAgIHNhd1F1b3RlID0gd29yZC5zYXdRdW90ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGRlbGltID09PSAnJyB8fCAoIXNhd1F1b3RlICYmICFCQVJFX0RFTElNLnRlc3QoZGVsaW0pKSkge1xuICAgICAgICAvLyBObyBkZWxpbWl0ZXIsIG9yIGEgYmFyZSBmb3JtIG91dHNpZGUgdGhlIGlkZW50aWZpZXIgc2hhcGUgXHUyMDE0IGZhaWxcbiAgICAgICAgLy8gY2xvc2VkIGFuZCBrZWVwIHNjYW5uaW5nIHBhc3QgdGhlIG9wZXJhdG9yLlxuICAgICAgICBpICs9IG9wTGVuO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB7IGNtZFN0YXJ0LCBvcGVuZXJMaW5lRW5kLCBkZWxpbSwgdGFiU3RyaXAsIHF1b3RlZERlbGltOiBzYXdRdW90ZSB9O1xuICAgIH1cbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogVGhlIGJvZHkgb2YgYW4gb3BlbmVyIHJ1bnMgZnJvbSBhZnRlciB0aGUgb3BlbmVyIGxpbmUncyBuZXdsaW5lIHRvIHRoZSBsaW5lXG4gKiB0aGF0IGlzIGV4YWN0bHkgdGhlIGRlbGltaXRlciAoYDw8YCksIG9yIGl0cyBsZWFkaW5nLXRhYi1zdHJpcHBlZCBmb3JtXG4gKiAoYDw8LWApLCB0cmFpbGluZyB3aGl0ZXNwYWNlIGFsbG93ZWQuIFJldHVybnMgdGhlIGNsb3NlcidzIGxpbmUgYm91bmRzLCBvclxuICogbnVsbCB3aGVuIG5vIGNsb3NlciBleGlzdHMgKGZhaWwgY2xvc2VkKS5cbiAqL1xuZnVuY3Rpb24gaGVyZWRvY0Nsb3NlcihyYXc6IHN0cmluZywgb3BlbjogSGVyZWRvY09wZW5lcik6IHsgbGluZVN0YXJ0OiBudW1iZXI7IGxpbmVFbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG4gPSByYXcubGVuZ3RoO1xuICBjb25zdCBib2R5U3RhcnQgPSBvcGVuLm9wZW5lckxpbmVFbmQgPCBuID8gb3Blbi5vcGVuZXJMaW5lRW5kICsgMSA6IG47XG4gIGxldCBsaW5lUG9zID0gYm9keVN0YXJ0O1xuICB3aGlsZSAobGluZVBvcyA8IG4pIHtcbiAgICBjb25zdCBubCA9IHJhdy5pbmRleE9mKCdcXG4nLCBsaW5lUG9zKTtcbiAgICBjb25zdCBsaW5lRW5kID0gbmwgPT09IC0xID8gbiA6IG5sO1xuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IG9wZW4udGFiU3RyaXAgPyByYXcuc2xpY2UobGluZVBvcywgbGluZUVuZCkucmVwbGFjZSgvXlxcdCsvLCAnJykgOiByYXcuc2xpY2UobGluZVBvcywgbGluZUVuZCk7XG4gICAgaWYgKFxuICAgICAgY2FuZGlkYXRlID09PSBvcGVuLmRlbGltIHx8XG4gICAgICAoY2FuZGlkYXRlLnN0YXJ0c1dpdGgob3Blbi5kZWxpbSkgJiYgL15bIFxcdF0qJC8udGVzdChjYW5kaWRhdGUuc2xpY2Uob3Blbi5kZWxpbS5sZW5ndGgpKSlcbiAgICApIHtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogbGluZVBvcywgbGluZUVuZCB9O1xuICAgIH1cbiAgICBpZiAobmwgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICBsaW5lUG9zID0gbmwgKyAxO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIE1hc2sgZXZlcnkgaGVyZWRvYyBvdXQgb2YgdGhlIHJhdyBjb21tYW5kIHN0cmluZywgcmV0dXJuaW5nIHRoZSBib2RpZXMgYW5kXG4gKiBvcGVuZXJzIGZvciByZS1hc3NvY2lhdGlvbiBieSBpbmRleC4gVGhlIG1hc2sgY292ZXJzXG4gKiBgW2NtZFN0YXJ0LCBjbG9zZXJMaW5lRW5kKWAgXHUyMDE0IHRoZSBvcGVuZXIgbGluZSB0aHJvdWdoIHRoZSBjbG9zZXIgbGluZSwgdGhlXG4gKiBjbG9zZXIncyBuZXdsaW5lIGV4Y2x1ZGVkIFx1MjAxNCBzbyBhIGNvbW1hbmQgam9pbmVkIGJlZm9yZSB0aGUgb3BlbmVyXG4gKiAoYGNtZDEgJiYgY2F0IDw8RU9GYCkga2VlcHMgaXRzIHN0cnVjdHVyZSwgYW5kIHRoZSBwbGFjZWhvbGRlciBzdGFuZHMgYWxvbmVcbiAqIGFzIGl0cyBvd24gc2ltcGxlIGNvbW1hbmQuIEEgaGVyZWRvYyB3aXRob3V0IGEgY2xvc2VyIGZhaWxzIGNsb3NlZDogaXRzXG4gKiBvcGVuZXIgbGluZSBzdGF5cyB1bm1hc2tlZCBhbmQgc2Nhbm5pbmcgcmVzdW1lcyBhZnRlciBpdC5cbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEhlcmVkb2NXcml0ZXMocmF3OiBzdHJpbmcpOiB7IHdyaXRlczogSGVyZWRvY1dyaXRlW107IG1hc2tlZDogc3RyaW5nIH0ge1xuICBjb25zdCB3cml0ZXM6IEhlcmVkb2NXcml0ZVtdID0gW107XG4gIGxldCBtYXNrZWQgPSAnJztcbiAgbGV0IGN1cnNvciA9IDA7XG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBvcGVuID0gZmluZEhlcmVkb2NPcGVuZXIocmF3LCBjdXJzb3IpO1xuICAgIGlmIChvcGVuID09PSBudWxsKSBicmVhaztcbiAgICBjb25zdCBjbG9zZSA9IGhlcmVkb2NDbG9zZXIocmF3LCBvcGVuKTtcbiAgICBpZiAoY2xvc2UgPT09IG51bGwpIHtcbiAgICAgIGN1cnNvciA9IG9wZW4ub3BlbmVyTGluZUVuZCA8IHJhdy5sZW5ndGggPyBvcGVuLm9wZW5lckxpbmVFbmQgKyAxIDogcmF3Lmxlbmd0aDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBib2R5U3RhcnQgPSBvcGVuLm9wZW5lckxpbmVFbmQgPCByYXcubGVuZ3RoID8gb3Blbi5vcGVuZXJMaW5lRW5kICsgMSA6IHJhdy5sZW5ndGg7XG4gICAgbGV0IGJvZHkgPSByYXcuc2xpY2UoYm9keVN0YXJ0LCBjbG9zZS5saW5lU3RhcnQpLnJlcGxhY2UoL1xcbiQvLCAnJyk7XG4gICAgaWYgKG9wZW4udGFiU3RyaXApIGJvZHkgPSBib2R5LnJlcGxhY2UoL15cXHQrL2dtLCAnJyk7XG4gICAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IsIG9wZW4uY21kU3RhcnQpO1xuICAgIG1hc2tlZCArPSBgX19oZXJlZG9jXyR7d3JpdGVzLmxlbmd0aH1fX2A7XG4gICAgd3JpdGVzLnB1c2goeyBvcGVuZXI6IHJhdy5zbGljZShvcGVuLmNtZFN0YXJ0LCBvcGVuLm9wZW5lckxpbmVFbmQpLCBib2R5LCBxdW90ZWREZWxpbTogb3Blbi5xdW90ZWREZWxpbSB9KTtcbiAgICBjdXJzb3IgPSBjbG9zZS5saW5lRW5kO1xuICB9XG4gIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yKTtcbiAgcmV0dXJuIHsgd3JpdGVzLCBtYXNrZWQgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZWRpcmVjdC10b2tlbiBhbmFseXNpcyBhbmQgdGhlIHdyaXRlLXRvdWNoIGdyYW1tYXJzIChwbGFuIFx1MDBBNzUuMSwgXHUwMEE3NS4yKS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgUmVkaXJlY3RJbmZvIHtcbiAgLyoqIElPX05VTUJFUiBmZCAoYDE+YC9gMj5gKSwgb3IgbnVsbCB3aGVuIGltcGxpY2l0LiAqL1xuICBmZDogbnVtYmVyIHwgbnVsbDtcbiAgLyoqIFRoZSBvcGVyYXRvci4gKi9cbiAgb3A6ICc+JyB8ICc+PicgfCAnJj4nIHwgJyY+PicgfCAnPiYnIHwgJzwnIHwgJzw8JyB8ICc8PC0nIHwgJzw8PCc7XG4gIC8qKiBBdHRhY2hlZCB0YXJnZXQgdGV4dCwgb3IgbnVsbCBmb3IgYSBzdGFuZGFsb25lIG9wZXJhdG9yICh0YXJnZXQgPSBuZXh0IHRva2VuKS4gKi9cbiAgdGFyZ2V0OiBzdHJpbmcgfCBudWxsO1xufVxuXG5jb25zdCBSRURJUkVDVF9UT0tFTiA9IC9eKFxcZCopKDw8PHw8PC18Jj4+fDw8fD4+fCY+fD4mfDx8PikoLiopJC87XG5cbmZ1bmN0aW9uIGNsYXNzaWZ5UmVkaXJlY3RUb2tlbih0ZXh0OiBzdHJpbmcpOiBSZWRpcmVjdEluZm8gfCBudWxsIHtcbiAgY29uc3QgbSA9IHRleHQubWF0Y2goUkVESVJFQ1RfVE9LRU4pO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IFssIGZkVGV4dCwgb3AsIHRhcmdldF0gPSBtO1xuICByZXR1cm4ge1xuICAgIGZkOiBmZFRleHQgPT09ICcnID8gbnVsbCA6IE51bWJlci5wYXJzZUludChmZFRleHQsIDEwKSxcbiAgICBvcDogb3AgYXMgUmVkaXJlY3RJbmZvWydvcCddLFxuICAgIHRhcmdldDogdGFyZ2V0ID09PSAnJyA/IG51bGwgOiB0YXJnZXRcbiAgfTtcbn1cblxuLyoqXG4gKiBBIGNvbnRlbnQtcHJvZHVjaW5nIHJlZGlyZWN0IChwbGFuIFx1MDBBNzUuMSk6IGZkLTEgYD5gL2A+PmAgKGV4cGxpY2l0IGAxPmAvYDE+PmBcbiAqIGluY2x1ZGVkKSBhbmQgYCY+YC9gJj4+YC4gRkQtbnVtYmVyZWQgKGAyPmApLCBkdXAgKGAyPiYxYCwgYD4mZmApLFxuICogYCZgLWxlYWRpbmctdGFyZ2V0IGR1cCAoYD4mYCkgYW5kIHN0ZGluIChgPGApIGZvcm1zIG5ldmVyIHByb2R1Y2UgY29udGVudC5cbiAqL1xuZnVuY3Rpb24gaXNDb250ZW50UmVkaXJlY3QocjogUmVkaXJlY3RJbmZvKTogYm9vbGVhbiB7XG4gIGlmIChyLm9wID09PSAnPicgfHwgci5vcCA9PT0gJz4+Jykge1xuICAgIGlmIChyLmZkICE9PSBudWxsICYmIHIuZmQgIT09IDEpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoci50YXJnZXQ/LnN0YXJ0c1dpdGgoJyYnKSkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiByLm9wID09PSAnJj4nIHx8IHIub3AgPT09ICcmPj4nO1xufVxuXG4vKiogVGhlIGFyZ3Ygc3RyZWFtIGFuZCByZWRpcmVjdCBsaXN0IG9mIGEgc2ltcGxlIGNvbW1hbmQgKHBsYW4gXHUwMEE3NS4xMCk6IHdvcmRzIG1pbnVzIHJlZGlyZWN0IHRva2VucyBhbmQgdGhlaXIgdGFyZ2V0cy4gKi9cbmZ1bmN0aW9uIGFuYWx5emVUb2tlbnModG9rZW5zOiBUb2tlbltdKTogeyBhcmd2OiBzdHJpbmdbXTsgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSB9IHtcbiAgY29uc3QgYXJndjogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHRva2Vucy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHRva2VuID0gdG9rZW5zW2ldO1xuICAgIGlmICghdG9rZW4uaXNSZWRpcmVjdCkge1xuICAgICAgYXJndi5wdXNoKHRva2VuLnRleHQpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGluZm8gPSBjbGFzc2lmeVJlZGlyZWN0VG9rZW4odG9rZW4udGV4dCk7XG4gICAgaWYgKGluZm8gPT09IG51bGwpIHtcbiAgICAgIGFyZ3YucHVzaCh0b2tlbi50ZXh0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5mby50YXJnZXQgPT09IG51bGwpIHtcbiAgICAgIC8vIEEgc3RhbmRhbG9uZSBvcGVyYXRvciBjb25zdW1lcyB0aGUgbmV4dCB0b2tlbiBhcyBpdHMgdGFyZ2V0IChvclxuICAgICAgLy8gaGVyZWRvYyBkZWxpbWl0ZXIgLyBoZXJlLXN0cmluZyBjb250ZW50KSBcdTIwMTQgYXR0YWNoZWQgdG8gdGhlIHJlZGlyZWN0XG4gICAgICAvLyBzbyB0aGUgd3JpdGUgZ3JhbW1hcnMgc2VlIGl0LCBhbmQgZXhjbHVkZWQgZnJvbSBhcmd2LlxuICAgICAgY29uc3QgbmV4dCA9IHRva2Vuc1tpICsgMV07XG4gICAgICBpZiAobmV4dCAhPT0gdW5kZWZpbmVkICYmICFuZXh0LmlzUmVkaXJlY3QpIHtcbiAgICAgICAgcmVkaXJlY3RzLnB1c2goeyAuLi5pbmZvLCB0YXJnZXQ6IG5leHQudGV4dCB9KTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmVkaXJlY3RzLnB1c2goaW5mbyk7XG4gIH1cbiAgcmV0dXJuIHsgYXJndiwgcmVkaXJlY3RzIH07XG59XG5cbi8qKlxuICogTGl0ZXJhbCBgZWNob2AvYHByaW50ZmAgY29udGVudCAocGxhbiBcdTAwQTc1LjEpIGZvciBib2R5IHRocmVhZGluZzogbm9cbiAqIGZsYWdzLCBubyBzaGVsbCBleHBhbnNpb24sIG5vIGdsb2JzOyBgcHJpbnRmYCBvbmx5IHdoZW4gdGhlIGZvcm1hdCBoYXMgbm9cbiAqIGAlYC9iYWNrc2xhc2ggZGlyZWN0aXZlcyAodGhlbiB0aGUgZm9ybWF0IGl0c2VsZiBpcyB0aGUgbGl0ZXJhbCBjb250ZW50KS5cbiAqIFRocmVhZGVkIG9uIGFwcGVuZHMgYXMgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keSBhbmQgb24gc2luZ2xlIHBsYWluIGA+YFxuICogb3ZlcndyaXRlcyAoYW5kIHRlZSBvcGVyYW5kcyB3aXRoIGEgb25lLWhvcCBsaXRlcmFsIHBpcGUgc291cmNlKSBhcyB0aGVcbiAqIGV4YWN0IGdhdGUncyBwb3N0LWNvbnRlbnQuXG4gKi9cbmZ1bmN0aW9uIGxpdGVyYWxDb250ZW50KGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgaG9zdCA9IGFyZ3ZbMF07XG4gIGlmIChob3N0ICE9PSAnZWNobycgJiYgaG9zdCAhPT0gJ3ByaW50ZicpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IGFyZ3MgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAoYXJncy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gIGZvciAoY29uc3QgYSBvZiBhcmdzKSB7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpIHx8IGhhc1NoZWxsRXhwYW5zaW9uKGEpIHx8IC9bKj9dLy50ZXN0KGEpKSByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmIChob3N0ID09PSAncHJpbnRmJykge1xuICAgIGlmIChhcmdzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjb25zdCBmbXQgPSBhcmdzWzBdO1xuICAgIGlmIChmbXQuaW5jbHVkZXMoJyUnKSB8fCBmbXQuaW5jbHVkZXMoJ1xcXFwnKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICByZXR1cm4gZm10O1xuICB9XG4gIHJldHVybiBgJHthcmdzLmpvaW4oJyAnKX1cXG5gO1xufVxuXG4vKipcbiAqIFJlc29sdmUgYSByZWRpcmVjdCB0YXJnZXQgYWdhaW5zdCB0aGUgY3VycmVudCBkaXJlY3RvcnksIGVtaXR0aW5nIHRoZVxuICogdW5yZXNvbHZlZCB2ZXJkaWN0ICh0aGUgcmVhZCBpZGlvbXMnIHJlYXNvbikgd2hlbiB0aGUgcGF0aCBjYXJyaWVzIGFuXG4gKiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2IuIFJldHVybnMgdGhlIGFic29sdXRlIHBhdGgsIG9yIG51bGwuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVUYXJnZXQocmVzdWx0czogU3Bhbk1hdGNoW10sIGlkaW9tOiBJZGlvbSwgdGFyZ2V0OiBzdHJpbmcsIGN1cnJlbnREaXI6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBpZiAobG9va3NVbnJlc29sdmFibGUodGFyZ2V0KSkge1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgIGlkaW9tLFxuICAgICAgZmlsZUFyZzogdGFyZ2V0LFxuICAgICAgcmVhc29uOiAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InXG4gICAgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIHRhcmdldCk7XG59XG5cbi8qKiBUaGUgYHRlZWAgb3BlcmFuZCBncmFtbWFyOiBhcHBlbmQgbW9kZSBhbmQgb3BlcmFuZCBsaXN0OyB1bmtub3duIG9wdGlvbnMgcmV0dXJuIG51bGwgKGZhaWwgY2xvc2VkKS4gKi9cbmZ1bmN0aW9uIHRlZU9wZXJhbmRQYXJ0cyhhcmd2OiBzdHJpbmdbXSk6IHsgYXBwZW5kOiBib29sZWFuOyBvcGVyYW5kczogc3RyaW5nW10gfSB8IG51bGwge1xuICBsZXQgYXBwZW5kID0gZmFsc2U7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGEgb2YgYXJndi5zbGljZSgxKSkge1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1hJyB8fCBhID09PSAnLS1hcHBlbmQnKSB7XG4gICAgICBhcHBlbmQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgcmV0dXJuIG51bGw7XG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBhcHBlbmQsIG9wZXJhbmRzIH07XG59XG5cbi8qKlxuICogVGhlIGB0ZWVgIG9wZXJhbmQgd3JpdGVzIChwbGFuIFx1MDBBNzUuMSk6IGVhY2ggb3BlcmFuZCBpcyBhIHdob2xlLWZpbGVcbiAqIGNyZWF0ZS1vdmVyd3JpdGUgKHRydW5jYXRpbmcpLCBvciBhIHdob2xlLWZpbGUgYXBwZW5kIHVuZGVyIGAtYWAvYC0tYXBwZW5kYC5cbiAqIEEgb25lLWhvcCBsaXRlcmFsIGVjaG8vcHJpbnRmIHBpcGUgc291cmNlIChgZWNobyB4IHwgdGVlIGZgLCBgcHJpbnRmIHkgfFxuICogdGVlIC1hIGZgLCBwbGFuIFx1MDBBNzUuMikgdGhyZWFkcyBhcyB0aGUgd3JpdHRlbiBib2R5IFx1MjAxNCB0aGUgZXhhY3QgZ2F0ZSdzXG4gKiBwb3N0LWNvbnRlbnQgb24gdGhlIHRydW5jYXRpbmcgd3JpdGUsIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHkgb24gdGhlIGFwcGVuZDtcbiAqIHdpdGhvdXQgYSBrbm93biBzb3VyY2UgbmVpdGhlciBvcCBjYXJyaWVzIHdyaXR0ZW4gY29udGVudC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hUZWVPcGVyYW5kcyhcbiAgYXJndjogc3RyaW5nW10sXG4gIHBpcGVFY2hvQ29udGVudDogc3RyaW5nIHwgbnVsbCxcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcGFydHMgPSB0ZWVPcGVyYW5kUGFydHMoYXJndik7XG4gIGlmIChwYXJ0cyA9PT0gbnVsbCkgcmV0dXJuO1xuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2YgcGFydHMub3BlcmFuZHMpIHtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdyZWRpcmVjdC13cml0ZScsIG9wZXJhbmQsIGN1cnJlbnREaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3JlZGlyZWN0LXdyaXRlJyxcbiAgICAgIHNwYW46ICFwYXJ0cy5hcHBlbmRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAuLi4ocGlwZUVjaG9Db250ZW50ICE9PSBudWxsID8geyB3cml0dGVuOiBwaXBlRWNob0NvbnRlbnQgfSA6IHt9KVxuICAgICAgICAgIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgIC4uLihwaXBlRWNob0NvbnRlbnQgIT09IG51bGwgPyB7IHdyaXR0ZW46IHBpcGVFY2hvQ29udGVudCB9IDoge30pXG4gICAgICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHJlZGlyZWN0IGZhbWlseSBncmFtbWFyIChwbGFuIFx1MDBBNzUuMSksIHJ1biBmb3IgZXZlcnkgc2ltcGxlIGNvbW1hbmQgYWZ0ZXJcbiAqIHRoZSByZWFkIG1hdGNoZXJzOiBjb250ZW50LXByb2R1Y2luZyByZWRpcmVjdHMgb24gYGVjaG9gL2BwcmludGZgL2B0ZWVgXG4gKiB3cml0ZSB3aG9sZS1maWxlOyBhIGJhcmUgYD4gZmAgLyBgOiA+IGZgIHRydW5jYXRlcyAodGhlIG1haW4gd2FsayBoYW5kc1xuICogYXJndi1lbXB0eSBjb21tYW5kcyBkaXJlY3RseSBoZXJlKTsgYD4+YC1vbmx5IHRydW5jYXRpb24gZm9ybXMgYXBwZW5kXG4gKiBub3RoaW5nIGFuZCB0b3VjaCBub3RoaW5nLiBBbnkgb3RoZXIgaG9zdCB3aXRoIGEgY29udGVudCByZWRpcmVjdCAoYGxzID4gZmAsXG4gKiBgcHl0aG9uMyB4LnB5ID4gb3V0YCwgYGNhdCBmID4gZ2ApIGdldHMgbm8gd3JpdGUgdG91Y2ggXHUyMDE0IHRoZSByZWRpcmVjdCBpc1xuICogcmVhbCwgYnV0IGl0cyBjb250ZW50IGlzIGR5bmFtaWMgYW5kIG91dCBvZiBzY29wZS5cbiAqXG4gKiBCb2R5IHRocmVhZGluZzogZXhhY3RseSBvbmUgcGxhaW4gYD4+YCAob3IgYDE+PmApIGNvbnRlbnQgcmVkaXJlY3Qgb24gYVxuICogZnVsbHkgbGl0ZXJhbCBgZWNob2AvYHByaW50ZmAgdGhyZWFkcyB0aGUgd3JpdHRlbiBib2R5ICh0aGUgc3VmZml4IGdhdGUpLFxuICogYW5kIGV4YWN0bHkgb25lIHBsYWluIGA+YCAob3IgYDE+YCkgY29udGVudCByZWRpcmVjdCBvbiB0aGUgc2FtZSBsaXRlcmFsc1xuICogdGhyZWFkcyBpdCBhcyB0aGUgZXhhY3QgZ2F0ZSdzIHBvc3QtY29udGVudCAocGxhbiBcdTAwQTczIHN0ZXAgMWIgXHUyMDE0IHRoZVxuICogY29udGVudCBsYXllciBpcyB3aGF0IHN1cHByZXNzZXMgYGVjaG8gaGkgPiByZWFkLW9ubHktZmlsZWAsIHdoZXJlIHRoZVxuICogZmlsZSBzdGF5cyBwcmVzZW50IGJ1dCB1bmNoYW5nZWQpLiBgJj5gL2AmPj5gLCBtdWx0aS1yZWRpcmVjdCBjb21tYW5kcyxcbiAqIGFuZCBgdGVlYCdzIG93biByZWRpcmVjdHMgbmV2ZXIgdGhyZWFkLlxuICovXG5mdW5jdGlvbiBtYXRjaFJlZGlyZWN0RmFtaWx5KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSxcbiAgcGlwZUVjaG9Db250ZW50OiBzdHJpbmcgfCBudWxsLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBjb250ZW50UmVkaXJlY3RzID0gcmVkaXJlY3RzLmZpbHRlcihpc0NvbnRlbnRSZWRpcmVjdCk7XG4gIGNvbnN0IGhvc3QgPSBhcmd2WzBdO1xuICBpZiAoY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDApIHtcbiAgICBpZiAoaG9zdCA9PT0gJ3RlZScpIG1hdGNoVGVlT3BlcmFuZHMoYXJndiwgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCA9PT0gdW5kZWZpbmVkIHx8IGhvc3QgPT09ICc6JyB8fCBob3N0ID09PSAnZXhlYycpIHtcbiAgICAvLyBCYXJlIGA+IGZgLCBgOiA+IGZgIGFuZCBgZXhlYyA+IGZgIHRydW5jYXRlIChleGVjIGFwcGxpZXMgdGhlIHJlZGlyZWN0XG4gICAgLy8gdG8gdGhlIHNoZWxsJ3Mgb3duIGZkIDEgaW1tZWRpYXRlbHkgXHUyMDE0IHRoZSBmZC0xIHRhcmdldCBpcyBzdGF0aWMsIHNvIHRoZVxuICAgIC8vIHRydW5jYXRpb24gaGFwcGVucyBldmVuIHRob3VnaCB0aGUgY29tbWFuZCBuZXZlciB3cml0ZXMpO1xuICAgIC8vIGA+PmAvYCY+PmAgYXBwZW5kIG5vdGhpbmcgXHUyMTkyIG5vIHRvdWNoLlxuICAgIGZvciAoY29uc3QgciBvZiBjb250ZW50UmVkaXJlY3RzKSB7XG4gICAgICBpZiAoci5vcCA9PT0gJz4+JyB8fCByLm9wID09PSAnJj4+JyB8fCByLnRhcmdldCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICd0cnVuY2F0ZS13cml0ZScsIHIudGFyZ2V0LCBjdXJyZW50RGlyKTtcbiAgICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3RydW5jYXRlLXdyaXRlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICd0cnVuY2F0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGhvc3QgIT09ICdlY2hvJyAmJiBob3N0ICE9PSAncHJpbnRmJyAmJiBob3N0ICE9PSAndGVlJykgcmV0dXJuO1xuICBjb25zdCBzaW5nbGVQbGFpbkFwcGVuZCA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+Pic7XG4gIGNvbnN0IHNpbmdsZVBsYWluT3ZlcndyaXRlID0gY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDEgJiYgY29udGVudFJlZGlyZWN0c1swXS5vcCA9PT0gJz4nO1xuICBjb25zdCB0aHJlYWRlZEFwcGVuZCA9IHNpbmdsZVBsYWluQXBwZW5kICYmIGhvc3QgIT09ICd0ZWUnID8gbGl0ZXJhbENvbnRlbnQoYXJndikgOiB1bmRlZmluZWQ7XG4gIGNvbnN0IHRocmVhZGVkT3ZlcndyaXRlID0gc2luZ2xlUGxhaW5PdmVyd3JpdGUgJiYgaG9zdCAhPT0gJ3RlZScgPyBsaXRlcmFsQ29udGVudChhcmd2KSA6IHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCByIG9mIGNvbnRlbnRSZWRpcmVjdHMpIHtcbiAgICBpZiAoci50YXJnZXQgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3JlZGlyZWN0LXdyaXRlJywgci50YXJnZXQsIGN1cnJlbnREaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIGlmIChyLm9wID09PSAnPj4nIHx8IHIub3AgPT09ICcmPj4nKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAncmVkaXJlY3Qtd3JpdGUnLFxuICAgICAgICBzcGFuOiB7XG4gICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgLi4uKHRocmVhZGVkQXBwZW5kICE9PSB1bmRlZmluZWQgPyB7IHdyaXR0ZW46IHRocmVhZGVkQXBwZW5kIH0gOiB7fSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdyZWRpcmVjdC13cml0ZScsXG4gICAgICAgIHNwYW46IHtcbiAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgLi4uKHRocmVhZGVkT3ZlcndyaXRlICE9PSB1bmRlZmluZWQgPyB7IHdyaXR0ZW46IHRocmVhZGVkT3ZlcndyaXRlIH0gOiB7fSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIGlmIChob3N0ID09PSAndGVlJykgbWF0Y2hUZWVPcGVyYW5kcyhhcmd2LCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIGZpbGUtbXV0YXRpb24gZmFtaWx5IGdyYW1tYXJzIChwbGFuIFx1MDBBNzUuM1x1MjAxM1x1MDBBNzUuNyk6IGNwL2luc3RhbGwvbXYvZ2l0IG12LFxuLy8gcm0vZ2l0IHJtL3RydW5jYXRlLCBzZWQgLWkgaW4tcGxhY2UgZWRpdHMsIGFuZCBwYXRjaC9naXQgYXBwbHkuIFRoZXkgc2hhcmVcbi8vIHRoZSBcdTAwQTc1IGZhaWwtY2xvc2VkIHJ1bGVzOiBsZWFkaW5nIGVudiBhc3NpZ25tZW50cyAoc3RyaXBwZWQgYnkgdGhlIHdhbGspXG4vLyBhbmQgb25lIGBjb21tYW5kYC9gZW52YCB3cmFwcGVyIGFyZSBza2lwcGVkIChtZWNoYW5pY2FsbHkgY2VydGFpbik7IGFueVxuLy8gb3RoZXIgd3JhcHBlciBpcyB1bnJlc29sdmVkOyBhIGxlYWRpbmctYC1gIHRva2VuIHRoYXQgaXMgbm90IGEga25vd24gb3B0aW9uXG4vLyBpcyB0cmVhdGVkIGFzIGFuIG9wdGlvbjsgYC0tYCBtYWtlcyB0aGUgcmVzdCBvcGVyYW5kczsgZ2xvYmJlZCBvciB2YXJpYWJsZVxuLy8gcGF0aHMgYXJlIHVucmVzb2x2ZWQ7IGRpcmVjdG9yeS1zaGFwZWQgc291cmNlIG9wZXJhbmRzIGZhaWwgY2xvc2VkLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXcmFwcGVyIHdvcmRzIHRoYXQgb2JzY3VyZSB0aGUgd3JhcHBlZCBjb21tYW5kJ3MgYXJndiAocGxhbiBcdTAwQTc1KTogYSBmYW1pbHkgY29tbWFuZCBiZWhpbmQgb25lIGlzIHVucmVzb2x2ZWQsIG5ldmVyIGd1ZXNzZWQuICovXG5jb25zdCBGT1JFSUdOX1dSQVBQRVJTID0gbmV3IFNldChbJ3N1ZG8nLCAneGFyZ3MnLCAnbm9odXAnLCAndGltZScsICduaWNlJywgJ2RvYXMnXSk7XG5cbi8qKiBBIGxlYWRpbmcgYE5BTUU9dmFsdWVgIGFzc2lnbm1lbnQgdG9rZW4gKGBlbnYgRk9PPWJhciBjcCBhIGJgIGtlZXBzIG9uZSBhZnRlciB0aGUgd3JhcHBlciB3b3JkKS4gKi9cbmNvbnN0IEFTU0lHTk1FTlRfVE9LRU4gPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9LztcblxuLyoqXG4gKiBTdHJpcCBhdCBtb3N0IG9uZSBgY29tbWFuZGAvYGVudmAgd3JhcHBlciBcdTIwMTQgbWVjaGFuaWNhbGx5IHRyYW5zcGFyZW50IChwbGFuXG4gKiBcdTAwQTc1KSBcdTIwMTQgYW5kIGFueSBsZWFkaW5nIGFzc2lnbm1lbnRzIGFmdGVyIGl0OiBgZW52IEZPTz1iYXIgY3AgYSBiYCBzZXRzIEZPT1xuICogdGhlbiBydW5zIGNwLCBleGFjdGx5IHRoZSB0cmFuc3BhcmVudC1wcmVmaXggY2xhc3MgdGhlIHdhbGsgc3RyaXBzIGJlZm9yZVxuICogdG9rZW5pemluZyAoYEZPTz1iYXIgZW52IGNwIGEgYmAgYXJyaXZlcyBoZXJlIHdpdGggdGhlIGFzc2lnbm1lbnRzIGFscmVhZHlcbiAqIGdvbmUpLlxuICovXG5mdW5jdGlvbiBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3QgdW53cmFwcGVkID0gYXJndlswXSA9PT0gJ2NvbW1hbmQnIHx8IGFyZ3ZbMF0gPT09ICdlbnYnID8gYXJndi5zbGljZSgxKSA6IGFyZ3Y7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCB1bndyYXBwZWQubGVuZ3RoICYmIEFTU0lHTk1FTlRfVE9LRU4udGVzdCh1bndyYXBwZWRbaV0pKSBpICs9IDE7XG4gIHJldHVybiBpID4gMCA/IHVud3JhcHBlZC5zbGljZShpKSA6IHVud3JhcHBlZDtcbn1cblxuZnVuY3Rpb24gcHVzaFVucmVzb2x2ZWQocmVzdWx0czogU3Bhbk1hdGNoW10sIGlkaW9tOiBJZGlvbSwgZmlsZUFyZzogc3RyaW5nLCByZWFzb246IHN0cmluZyk6IHZvaWQge1xuICByZXN1bHRzLnB1c2goeyBzdGF0dXM6ICd1bnJlc29sdmVkJywgaWRpb20sIGZpbGVBcmcsIHJlYXNvbiB9KTtcbn1cblxuLyoqIFdoZXRoZXIgdGhlIHBhdGggaXMgYW4gZXhpc3RpbmcgZGlyZWN0b3J5ICh0aGUgZGVzdC1kaXIgZGVjaXNpb24sIHBsYW4gXHUwMEE3NS4zL1x1MDBBNzUuNDsgZnMgc3RhdCBsaWtlIHRoZSByZWFkIGlkaW9tcycgbGluZSBjb3VudHMpLiAqL1xuZnVuY3Rpb24gaXNFeGlzdGluZ0RpcmVjdG9yeShhYnNvbHV0ZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIHJldHVybiBzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRGlyZWN0b3J5KCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBzaGFyZWQgY3AvaW5zdGFsbC9tdiBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS4zL1x1MDBBNzUuNCk6IHBlci1mYW1pbHkgb3B0aW9uXG4gKiBzZXRzIGFuZCB0b3VjaCBvcGVyYXRpb25zIGJlaGluZCBvbmUgcGFyc2VyLlxuICovXG5pbnRlcmZhY2UgQ29weU1vdmVTcGVjIHtcbiAgaWRpb206ICdjcC13cml0ZScgfCAnaW5zdGFsbC13cml0ZScgfCAnbXYtd3JpdGUnO1xuICAvKiogS25vd24gbm8tdmFsdWUgZmxhZ3MgKGNvbnN1bWVkLCBuZXZlciBvcGVyYW5kcykuICovXG4gIG5vVmFsdWU6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKlxuICAgKiBOby1jbG9iYmVyIGZsYWdzIChgY3AgLW5gL2AtLW5vLWNsb2JiZXJgKTogY29uc3VtZWQgbGlrZSBuby12YWx1ZSBmbGFncyxcbiAgICogYnV0IHRoZSB3cml0ZSBzdGlsbCBwYXJzZXMgXHUyMDE0IHRoZSBza2lwIGlzIGludmlzaWJsZSB0byB0aGUgcG9zdC1jb21tYW5kXG4gICAqIGJ5dGUtY29tcGFyZSBnYXRlLCB3aGljaCBjYW5ub3QgZGlzdGluZ3Vpc2ggYSByZWFsIGNvcHkgZnJvbSBhIHByZS1leGlzdGluZ1xuICAgKiBlcXVhbCBkZXN0ICh0aGUgZG9jdW1lbnRlZCBuby1vcCByZXNpZHVlLCBwaW5uZWQgaW5cbiAgICogYmFzaC13cml0ZS1pbnRlZ3JhdGlvbi50ZXN0LnRzKS5cbiAgICovXG4gIG5vQ2xvYmJlcjogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqIEtub3duIHZhbHVlLXRha2luZyBmbGFncyAodGhlIG5leHQgd29yZCBpcyB0aGUgdmFsdWUgXHUyMDE0IGAtdCBESVJgLCBvciBhbiBpbnN0YWxsIG1vZGUvb3duZXIvZ3JvdXApLiAqL1xuICB2YWx1ZVRha2luZzogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqIEZsYWdzIHRoYXQgZmFpbCB0aGUgd2hvbGUgY29tbWFuZCBjbG9zZWQgKGBjcCAtYmAvYC0tYmFja3VwYCwgYGluc3RhbGwgLWRgLCBnaXQgbXYgZHJ5LXJ1biBgLW5gL2AtLWRyeS1ydW5gKS4gKi9cbiAgZXhjbHVkZWQ6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKiBUaGUgcGVyLXNvdXJjZSB0b3VjaDogY3AvaW5zdGFsbCByZWFkIHRoZWlyIHNvdXJjZXM7IG12IGRlbGV0ZXMgdGhlbS4gKi9cbiAgc291cmNlT3BlcmF0aW9uOiAncmVhZCcgfCAnZGVsZXRlJztcbiAgLyoqIFRoZSBwZXItZGVzdCB0b3VjaDogY3AvaW5zdGFsbCBvdmVyd3JpdGU7IG12IHJlbmFtZS1jb3BpZXMuICovXG4gIGRlc3RPcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyB8ICdyZW5hbWUtY29weSc7XG59XG5cbmNvbnN0IENQX1NQRUM6IENvcHlNb3ZlU3BlYyA9IHtcbiAgaWRpb206ICdjcC13cml0ZScsXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctcicsICctUicsICctcCcsICctZicsICctdicsICctaScsICctdScsICctYScsICctZCcsICctTCcsICctUCddKSxcbiAgbm9DbG9iYmVyOiBuZXcgU2V0KFsnLW4nLCAnLS1uby1jbG9iYmVyJ10pLFxuICB2YWx1ZVRha2luZzogbmV3IFNldChbJy10JywgJy0tdGFyZ2V0LWRpcmVjdG9yeSddKSxcbiAgZXhjbHVkZWQ6IG5ldyBTZXQoWyctYicsICctLWJhY2t1cCddKSxcbiAgc291cmNlT3BlcmF0aW9uOiAncmVhZCcsXG4gIGRlc3RPcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJ1xufTtcblxuY29uc3QgSU5TVEFMTF9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnaW5zdGFsbC13cml0ZScsXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctRCcsICctcycsICctdiddKSxcbiAgbm9DbG9iYmVyOiBuZXcgU2V0KCksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KFsnLXQnLCAnLS10YXJnZXQtZGlyZWN0b3J5JywgJy1tJywgJy1vJywgJy1nJ10pLFxuICBleGNsdWRlZDogbmV3IFNldChbJy1kJ10pLFxuICBzb3VyY2VPcGVyYXRpb246ICdyZWFkJyxcbiAgZGVzdE9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnXG59O1xuXG5jb25zdCBNVl9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnbXYtd3JpdGUnLFxuICAvLyBgbXYgLW5gIHN0YXlzIGluIG5vVmFsdWUsIG5vdCBub0Nsb2JiZXI6IGFuIG12IHNraXAgbGVhdmVzIHRoZSBzb3VyY2UgaW5cbiAgLy8gcGxhY2UsIGFuZCB0aGUgZGVsZXRlJ3Mgb3duIGFic2VuY2UgZ2F0ZSB0aGVuIGZhaWxzIHRoZSB0b3VjaCBcdTIwMTQgdGhlXG4gIC8vIG5vLWNsb2JiZXIgYmxpbmQgc3BvdCBpcyBjcCdzIGJ5dGUtY29tcGFyZSwgbm90IG12J3MuXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctZicsICctaScsICctbicsICctdicsICctdSddKSxcbiAgbm9DbG9iYmVyOiBuZXcgU2V0KCksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KFsnLXQnLCAnLS10YXJnZXQtZGlyZWN0b3J5J10pLFxuICBleGNsdWRlZDogbmV3IFNldCgpLFxuICBzb3VyY2VPcGVyYXRpb246ICdkZWxldGUnLFxuICBkZXN0T3BlcmF0aW9uOiAncmVuYW1lLWNvcHknXG59O1xuXG5jb25zdCBHSVRfTVZfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ212LXdyaXRlJyxcbiAgbm9WYWx1ZTogbmV3IFNldChbJy1mJywgJy1rJywgJy12J10pLFxuICBub0Nsb2JiZXI6IG5ldyBTZXQoKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoKSxcbiAgLy8gYGdpdCBtdiAtbmAvYC0tZHJ5LXJ1bmAgaXMgYSB0cmlhbCBydW4gdGhhdCBtb3ZlcyBub3RoaW5nICh0aGUgc2FtZVxuICAvLyByZWFkLW9ubHkgY2xhc3MgYXMgYHBhdGNoIC0tZHJ5LXJ1bmAsIHBsYW4gXHUwMEE3NS43KSBcdTIwMTQgZmFpbCBjbG9zZWQuXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KFsnLW4nLCAnLS1kcnktcnVuJ10pLFxuICBzb3VyY2VPcGVyYXRpb246ICdkZWxldGUnLFxuICBkZXN0T3BlcmF0aW9uOiAncmVuYW1lLWNvcHknXG59O1xuXG5pbnRlcmZhY2UgQ29weU1vdmVQYXJ0cyB7XG4gIC8qKiBPcGVyYW5kcyBpbiBvcmRlciAoc291cmNlczsgaW4gdGhlIG5vbi1gLXRgIGZvcm0gdGhlIGxhc3QgaXMgdGhlIGRlc3QpLiAqL1xuICBvcGVyYW5kczogc3RyaW5nW107XG4gIC8qKiBUaGUgYC10YC9gLS10YXJnZXQtZGlyZWN0b3J5YCB2YWx1ZSwgb3IgbnVsbC4gKi9cbiAgdGFyZ2V0RGlyOiBzdHJpbmcgfCBudWxsO1xufVxuXG4vKipcbiAqIFBhcnNlIHRoZSBvcGVyYW5kcyBvZiBhIGNwL2luc3RhbGwvbXYgY29tbWFuZDoga25vd24gb3B0aW9ucyBhcmUgY29uc3VtZWQsXG4gKiBgLS1gIG1ha2VzIHRoZSByZXN0IG9wZXJhbmRzLCBhbmQgYC10YC9gLS10YXJnZXQtZGlyZWN0b3J5Wz1ESVJdYCBpc1xuICogdmFsdWUtdGFraW5nIFx1MjAxNCB0aGUgbmV4dCB3b3JkIGlzIHRoZSB0YXJnZXQgZGlyZWN0b3J5LCBuZXZlciBhIHNvdXJjZS4gQVxuICogbGVhZGluZy1gLWAgdG9rZW4gdGhhdCBpcyBub3QgYSBrbm93biBvcHRpb24gaXMgdHJlYXRlZCBhcyBhbiBvcHRpb24gKG5vXG4gKiB0b3VjaCkuIFJldHVybnMgbnVsbCB3aGVuIGEgZmFpbC1jbG9zZWQgb3B0aW9uIGlzIHByZXNlbnQgb3IgYSB2YWx1ZS10YWtpbmdcbiAqIGZsYWcgaXMgbGVmdCB2YWx1ZWxlc3MuXG4gKi9cbmZ1bmN0aW9uIGNvcHlNb3ZlUGFydHMoYXJnczogc3RyaW5nW10sIHNwZWM6IENvcHlNb3ZlU3BlYyk6IENvcHlNb3ZlUGFydHMgfCBudWxsIHtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGxldCB0YXJnZXREaXI6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgaSA9IDA7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIHdoaWxlIChpIDwgYXJncy5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctdCcgfHwgYSA9PT0gJy0tdGFyZ2V0LWRpcmVjdG9yeScpIHtcbiAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgdGFyZ2V0RGlyID0gdjtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLXRhcmdldC1kaXJlY3Rvcnk9JykpIHtcbiAgICAgIHRhcmdldERpciA9IGEuc2xpY2UoJy0tdGFyZ2V0LWRpcmVjdG9yeT0nLmxlbmd0aCk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHNwZWMuZXhjbHVkZWQuaGFzKGEpKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoc3BlYy52YWx1ZVRha2luZy5oYXMoYSkpIHtcbiAgICAgIGlmIChhcmdzW2kgKyAxXSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoc3BlYy5ub1ZhbHVlLmhhcyhhKSB8fCBzcGVjLm5vQ2xvYmJlci5oYXMoYSkpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4geyBvcGVyYW5kcywgdGFyZ2V0RGlyIH07XG59XG5cbi8qKlxuICogVGhlIHBlci1zb3VyY2UgdG91Y2ggb2YgYSBjcC9pbnN0YWxsL212IGNvbW1hbmQuIGNwL2luc3RhbGwgc291cmNlcyBhcmVcbiAqIHdob2xlLWZpbGUgcmVhZHMgcmVzb2x2ZWQgYWdhaW5zdCBmcyBsaWtlIHRoZSByZWFkIGlkaW9tczsgYSBzb3VyY2Ugd2hvc2VcbiAqIGxpbmUgY291bnQgY2Fubm90IGJlIHJlYWQgYXQgcGFyc2UgdGltZSAobWlzc2luZyBvciB1bnJlYWRhYmxlIFx1MjAxNCB0aGUgcGFyc2VcbiAqIHJ1bnMgcG9zdC1jb21tYW5kLCBzbyBhIHNvdXJjZSB0aGUgY29tcG91bmQncyBvd24gZWFybGllciBgcm1gIGRlbGV0ZWQgaXNcbiAqIGV4YWN0bHkgdGhpcykgc3RpbGwgcmVzb2x2ZXMgYXMgYSByYW5nZS1sZXNzIHdob2xlLWZpbGUgcmVhZDogdGhlIGRyaXZlclxuICogcGFpcnMgdGhlIGRlc3RpbmF0aW9uIGFnYWluc3QgaXQsIHNvIHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHBsYW4gXHUwMEE3MyBzdGVwXG4gKiAxYikgYW5kIHRoZSByZWFkJ3MgcG9zdC1jb21tYW5kIGV4aXN0ZW5jZSBnYXRlIGFwcGx5IFx1MjAxNCBhbiB1bmV4cGxhaW5lZFxuICogYWJzZW5jZSBmYWlscyB0aGUgY29weSBkZWNpc2l2ZWx5IGFuZCBhIHBoYW50b20gc291cmNlIG5ldmVyIGZpcmVzIHRoZVxuICogZGVzdC4gVGhlIG12IHNvdXJjZSBpcyBhIGRlbGV0ZS5cbiAqL1xuZnVuY3Rpb24gZW1pdFNvdXJjZVNwYW4oXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdLFxuICBzcGVjOiBDb3B5TW92ZVNwZWMsXG4gIGFic29sdXRlUGF0aDogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ11cbik6IHZvaWQge1xuICBpZiAoc3BlYy5zb3VyY2VPcGVyYXRpb24gPT09ICdkZWxldGUnKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBzcGVjLmlkaW9tLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdkZWxldGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LCAoKSA9PiBjb3VudEZpbGVMaW5lcyhhYnNvbHV0ZVBhdGgpKTtcbiAgcmVzdWx0cy5wdXNoKHtcbiAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgaWRpb206IHNwZWMuaWRpb20sXG4gICAgc3BhbjpcbiAgICAgIHJhbmdlID09PSBudWxsXG4gICAgICAgID8geyBvcGVyYXRpb246ICdyZWFkJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgICA6IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ3JlYWQnLFxuICAgICAgICAgICAgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsXG4gICAgICAgICAgICBsaW5lRW5kOiByYW5nZS5saW5lRW5kLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pblxuICAgICAgICAgIH1cbiAgfSk7XG59XG5cbi8qKlxuICogVGhlIGNwL2luc3RhbGwvbXYgZmFtaWx5IChwbGFuIFx1MDBBNzUuMy9cdTAwQTc1LjQpOiBvcGVyYW5kcyByZXNvbHZlIHRvIHNvdXJjZS9kZXN0XG4gKiBwYWlycyBcdTIwMTQgZWFjaCBzb3VyY2UgaXMgYSByZWFkIChjcC9pbnN0YWxsKSBvciBkZWxldGUgKG12KSwgZWFjaCBkZXN0IGFcbiAqIGNyZWF0ZS1vdmVyd3JpdGUgKGNwL2luc3RhbGwpIG9yIHJlbmFtZS1jb3B5IChtdiksIHNvdXJjZXMgYmVmb3JlIGRlc3RzIGluXG4gKiBkZWNsYXJhdGlvbiBvcmRlci4gQSBkZXN0IHRoYXQgZW5kcyBpbiBgL2Agb3Igc3RhdHMgYXMgYW4gZXhpc3RpbmcgZGlyZWN0b3J5XG4gKiBtYXBzIHRvIGBkaXIvYmFzZW5hbWUoc291cmNlKWAgcGVyIHNvdXJjZTsgYC10IERJUmAvYC0tdGFyZ2V0LWRpcmVjdG9yeT1ESVJgXG4gKiBtYXBzIHRoZSBzYW1lIHdheSBhbmQgaXMgdW5yZXNvbHZlZCB3aGVuIGl0cyB2YWx1ZSBpcyBub3QgZGlyZWN0b3J5LXNoYXBlZC5cbiAqIE11bHRpLXNvdXJjZSBjb21tYW5kcyBuZWVkIGEgZGlyZWN0b3J5IGRlc3Q7IGEgZGlyZWN0b3J5LXNoYXBlZCBvclxuICogZ2xvYmJlZC92YXJpYWJsZSBzb3VyY2UsIGEgZ2xvYmJlZC92YXJpYWJsZSBkZXN0LCBvciBhIGZhaWwtY2xvc2VkIG9wdGlvblxuICogKGBjcCAtYmAsIGBpbnN0YWxsIC1kYCwgZ2l0IG12IGAtbmApIGVtaXRzIG5vIHRvdWNoZXMuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoQ29weU1vdmVGYW1pbHkoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgbGV0IHNwZWM6IENvcHlNb3ZlU3BlYyB8IG51bGwgPSBudWxsO1xuICBsZXQgYXJnczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGRpciA9IGRpckZvclJlc29sdXRpb247XG4gIGlmIChjb21tYW5kID09PSAnY3AnIHx8IGNvbW1hbmQgPT09ICdpbnN0YWxsJyB8fCBjb21tYW5kID09PSAnbXYnKSB7XG4gICAgc3BlYyA9IGNvbW1hbmQgPT09ICdjcCcgPyBDUF9TUEVDIDogY29tbWFuZCA9PT0gJ2luc3RhbGwnID8gSU5TVEFMTF9TUEVDIDogTVZfU1BFQztcbiAgICBhcmdzID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgIT09IG51bGwgJiYgc3ViLnN1YmNvbW1hbmQgPT09ICdtdicpIHtcbiAgICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnbXYtd3JpdGUnLCAnbXYnLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHNwZWMgPSBHSVRfTVZfU1BFQztcbiAgICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgICAgIGRpciA9IHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb247XG4gICAgfVxuICB9IGVsc2UgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgLy8gQSB3cmFwcGVyIG9ic2N1cmVzIHRoZSB3cmFwcGVkIGFyZ3YgXHUyMDE0IGZhaWwgY2xvc2VkIHJhdGhlciB0aGFuIG1pcy1wYXJzZS5cbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBjb25zdCB3cmFwcGVkU3BlYyA9XG4gICAgICB3cmFwcGVkID09PSAnY3AnID8gQ1BfU1BFQyA6IHdyYXBwZWQgPT09ICdpbnN0YWxsJyA/IElOU1RBTExfU1BFQyA6IHdyYXBwZWQgPT09ICdtdicgPyBNVl9TUEVDIDogbnVsbDtcbiAgICBpZiAod3JhcHBlZFNwZWMgIT09IG51bGwpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHdyYXBwZWRTcGVjLmlkaW9tLCB3cmFwcGVkLCBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoc3BlYyA9PT0gbnVsbCkgcmV0dXJuO1xuXG4gIGNvbnN0IHBhcnRzID0gY29weU1vdmVQYXJ0cyhhcmdzLCBzcGVjKTtcbiAgaWYgKHBhcnRzID09PSBudWxsIHx8IHBhcnRzLm9wZXJhbmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gIC8vIFJlc29sdmUgZXZlcnkgc291cmNlIGJlZm9yZSBlbWl0dGluZyBhbnl0aGluZzogYSBkaXJlY3Rvcnktc2hhcGVkLFxuICAvLyBnbG9iYmVkLCBvciB2YXJpYWJsZSBzb3VyY2UgZmFpbHMgdGhlIHdob2xlIGNvbW1hbmQgY2xvc2VkICh0aGUgZGVzdFxuICAvLyBtYXBwaW5nIGlzIHBlci1zb3VyY2UsIHNvIGFuIHVua25vd2FibGUgc291cmNlIG1ha2VzIHRoZSBkZXN0cyB1bmtub3dhYmxlKS5cbiAgY29uc3Qgc291cmNlUGF0aHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3Qgc291cmNlIG9mIHBhcnRzLm9wZXJhbmRzLnNsaWNlKDAsIHBhcnRzLnRhcmdldERpciA9PT0gbnVsbCA/IC0xIDogdW5kZWZpbmVkKSkge1xuICAgIGlmIChzb3VyY2UuZW5kc1dpdGgoJy8nKSkgcmV0dXJuO1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgc3BlYy5pZGlvbSwgc291cmNlLCBkaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAoaXNFeGlzdGluZ0RpcmVjdG9yeShhYnNvbHV0ZVBhdGgpKSByZXR1cm47XG4gICAgc291cmNlUGF0aHMucHVzaChhYnNvbHV0ZVBhdGgpO1xuICB9XG4gIGlmIChzb3VyY2VQYXRocy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICBsZXQgZGVzdFBhdGhzOiBzdHJpbmdbXTtcbiAgaWYgKHBhcnRzLnRhcmdldERpciAhPT0gbnVsbCkge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShwYXJ0cy50YXJnZXREaXIpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBwYXJ0cy50YXJnZXREaXIsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIXBhcnRzLnRhcmdldERpci5lbmRzV2l0aCgnLycpICYmICFpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpciwgcGFydHMudGFyZ2V0RGlyKSkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIHBhcnRzLnRhcmdldERpciwgJ3RoZSAtdCB0YXJnZXQgaXMgbm90IGFuIGV4aXN0aW5nIGRpcmVjdG9yeScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB0YXJnZXRBYnMgPSByZXNvbHZlUGF0aChkaXIsIHBhcnRzLnRhcmdldERpcik7XG4gICAgZGVzdFBhdGhzID0gc291cmNlUGF0aHMubWFwKChwKSA9PiBqb2luUGF0aCh0YXJnZXRBYnMsIGJhc2VuYW1lKHApKSk7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgZGVzdCA9IHBhcnRzLm9wZXJhbmRzW3BhcnRzLm9wZXJhbmRzLmxlbmd0aCAtIDFdO1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShkZXN0KSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgc3BlYy5pZGlvbSwgZGVzdCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGRlc3RBYnMgPSByZXNvbHZlUGF0aChkaXIsIGRlc3QpO1xuICAgIGNvbnN0IGRlc3RJc0RpciA9IGRlc3QuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KGRlc3RBYnMpO1xuICAgIGlmIChzb3VyY2VQYXRocy5sZW5ndGggPiAxICYmICFkZXN0SXNEaXIpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIGRlc3QsICdhIG11bHRpLXNvdXJjZSBjb3B5L21vdmUgbmVlZHMgYSBkaXJlY3RvcnkgZGVzdGluYXRpb24nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZGVzdFBhdGhzID0gZGVzdElzRGlyID8gc291cmNlUGF0aHMubWFwKChwKSA9PiBqb2luUGF0aChkZXN0QWJzLCBiYXNlbmFtZShwKSkpIDogW2Rlc3RBYnNdO1xuICB9XG5cbiAgZm9yIChsZXQgayA9IDA7IGsgPCBzb3VyY2VQYXRocy5sZW5ndGg7IGsrKykge1xuICAgIGVtaXRTb3VyY2VTcGFuKHJlc3VsdHMsIHNwZWMsIHNvdXJjZVBhdGhzW2tdLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4pO1xuICB9XG4gIGZvciAobGV0IGsgPSAwOyBrIDwgc291cmNlUGF0aHMubGVuZ3RoOyBrKyspIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IHNwZWMuaWRpb20sXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogc3BlYy5kZXN0T3BlcmF0aW9uLCBhYnNvbHV0ZVBhdGg6IGRlc3RQYXRoc1trXSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgfVxufVxuXG5jb25zdCBSTV9OT19WQUxVRSA9IG5ldyBTZXQoWyctZicsICctaScsICctdiddKTtcbi8qKiBgcm1gL2BnaXQgcm1gIGZsYWdzIHdob3NlIHNlbWFudGljcyBhcmUgb3V0IG9mIHNjb3BlOiByZWN1cnNpdmUgcmVtb3ZhbCBhbmQgcm1kaXIuICovXG5jb25zdCBSTV9FWENMVURFRCA9IG5ldyBTZXQoWyctcicsICctUicsICctLXJlY3Vyc2l2ZScsICctZCddKTtcbi8qKiBgZ2l0IHJtYCBhZGRzIHRoZSBkcnktcnVuIGZvcm0gdG8gdGhlIGV4Y2x1c2lvbnMuICovXG5jb25zdCBHSVRfUk1fRVhDTFVERUQgPSBuZXcgU2V0KFsnLXInLCAnLVInLCAnLS1yZWN1cnNpdmUnLCAnLWQnLCAnLW4nLCAnLS1kcnktcnVuJ10pO1xuXG4vKipcbiAqIFRoZSBzaGFyZWQgcm0vZ2l0IHJtIG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjUpOiBhIHJlY3Vyc2l2ZS9ybWRpciBmbGFnIChvclxuICogYC0tY2FjaGVkYCBmb3IgZ2l0IHJtIFx1MjAxNCB0aGUgd29ya3RyZWUgZmlsZSBzdXJ2aXZlcykgZXhjbHVkZXMgdGhlIHdob2xlXG4gKiBjb21tYW5kOyBlYWNoIHJlbWFpbmluZyBmaWxlLXNoYXBlZCBvcGVyYW5kIGlzIGEgZGVsZXRlLCBhbmQgYVxuICogZGlyZWN0b3J5LXNoYXBlZCBvcGVyYW5kIGZhaWxzIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSbU9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZXhjbHVkZWQ6IFJlYWRvbmx5U2V0PHN0cmluZz4sXG4gIGV4Y2x1ZGVDYWNoZWQ6IGJvb2xlYW4sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgYSBvZiBhcmdzKSB7XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChleGNsdWRlZC5oYXMoYSkgfHwgKGV4Y2x1ZGVDYWNoZWQgJiYgYSA9PT0gJy0tY2FjaGVkJykpIHJldHVybjtcbiAgICBpZiAoUk1fTk9fVkFMVUUuaGFzKGEpKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb25cbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3JtLXdyaXRlJywgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG9wZXJhbmQuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZCkpKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdybS13cml0ZScsXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2RlbGV0ZScsIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kKSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFN0YXRpY2FsbHkgZXZhbHVhdGUgYW4gYWJzb2x1dGUgYHRydW5jYXRlIC1zYCBzaXplIChwbGFuIFx1MDBBNzUuNSk6IGEgcGxhaW5cbiAqIGludGVnZXIgd2l0aCBhbiBvcHRpb25hbCBLL00vRyBzdWZmaXguIFJlbGF0aXZlIHNpemVzIChgLXMgK05gL2AtcyAtTmApLFxuICogYC1yIHJlZmAgdmFsdWVzLCBhbmQgc2hlbGwtZXhwYW5kZWQgdmFsdWVzIGRlcGVuZCBvbiBydW50aW1lIHN0YXRlIFx1MjE5MlxuICogdW5kZWZpbmVkICh0aG9zZSBzcGFucyBnYXRlIGV4aXN0ZW5jZS1vbmx5KS5cbiAqL1xuZnVuY3Rpb24gZXZhbHVhdGVTdGF0aWNTaXplKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgbSA9IHZhbHVlLm1hdGNoKC9eKFxcZCspKFtLTUddKT8kLyk7XG4gIGlmIChtID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBiYXNlID0gTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKTtcbiAgY29uc3QgbXVsdCA9IG1bMl0gPT09ICdLJyA/IDEwMjQgOiBtWzJdID09PSAnTScgPyAxMDI0ICoqIDIgOiBtWzJdID09PSAnRycgPyAxMDI0ICoqIDMgOiAxO1xuICByZXR1cm4gYmFzZSAqIG11bHQ7XG59XG5cbi8qKlxuICogVGhlIHRydW5jYXRlIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS41KTogYC1zIFNJWkVgL2AtciByZWZgIGFyZSB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZVxuICogc2l6ZSB2YWx1ZSBtYXkgaXRzZWxmIGxlYWQgd2l0aCBgLWAgKGB0cnVuY2F0ZSAtcyAtMTAgZmApIFx1MjAxNCBhbmQgYC1jYCBpc1xuICogY29tcGF0aWJsZS4gV2l0aG91dCBgLXNgL2AtcmAgdGhlIGNvbW1hbmQgY2hhbmdlcyBub3RoaW5nIFx1MjE5MiBubyB0b3VjaC4gRWFjaFxuICogZmlsZS1zaGFwZWQgb3BlcmFuZCBpcyBhIHRydW5jYXRlOyBhbiBhYnNvbHV0ZSBgLXMgTmAgY2FycmllcyB0aGUgc3RhdGljYWxseVxuICogZXZhbHVhdGVkIHNpemUgb24gdGhlIHNwYW4gKHRoZSBcdTAwQTczIGBzaXplYCBnYXRlJ3MgcG9zdC1jb21tYW5kIGJ5dGUgY291bnQsXG4gKiBgLXMgMGAgXHUyMTkyIGVtcHR5KSwgcmVsYXRpdmUgc2l6ZXMgYW5kIGAtciByZWZgIHN0YXkgZXhpc3RlbmNlLW9ubHkuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoVHJ1bmNhdGVPcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IHNhd1NpemVGbGFnID0gZmFsc2U7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGxldCBzdGF0aWNTaXplOiBudW1iZXIgfCB1bmRlZmluZWQ7XG4gIGNvbnN0IG9wZXJhbmRzOiBBcnJheTx7IHBhdGg6IHN0cmluZzsgc2l6ZTogbnVtYmVyIHwgdW5kZWZpbmVkIH0+ID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKHsgcGF0aDogYSwgc2l6ZTogc3RhdGljU2l6ZSB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcycpIHtcbiAgICAgIHNhd1NpemVGbGFnID0gdHJ1ZTtcbiAgICAgIHN0YXRpY1NpemUgPSBldmFsdWF0ZVN0YXRpY1NpemUoYXJnc1tpICsgMV0pO1xuICAgICAgaSArPSAxOyAvLyBjb25zdW1lIHRoZSBzaXplIHZhbHVlLCBldmVuIHdoZW4gaXQgbGVhZHMgd2l0aCBgLWBcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1yJykge1xuICAgICAgc2F3U2l6ZUZsYWcgPSB0cnVlO1xuICAgICAgc3RhdGljU2l6ZSA9IHVuZGVmaW5lZDsgLy8gdGhlIGxhc3Qgc2l6ZSBvcHRpb24gd2luczsgYSByZWYgaGFzIG5vIHN0YXRpYyB2YWx1ZVxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb25cbiAgICBvcGVyYW5kcy5wdXNoKHsgcGF0aDogYSwgc2l6ZTogc3RhdGljU2l6ZSB9KTtcbiAgfVxuICBpZiAoIXNhd1NpemVGbGFnKSByZXR1cm47XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kLnBhdGgpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAndHJ1bmNhdGUtY29tbWFuZCcsIG9wZXJhbmQucGF0aCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG9wZXJhbmQucGF0aC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkocmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kLnBhdGgpKSkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAndHJ1bmNhdGUtY29tbWFuZCcsXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogJ3RydW5jYXRlJyxcbiAgICAgICAgYWJzb2x1dGVQYXRoOiByZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQucGF0aCksXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgLi4uKG9wZXJhbmQuc2l6ZSAhPT0gdW5kZWZpbmVkID8geyBzaXplOiBvcGVyYW5kLnNpemUgfSA6IHt9KVxuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHJtL2dpdCBybS90cnVuY2F0ZSBmYW1pbHkgKHBsYW4gXHUwMEE3NS41KTogYHJtYC9gZ2l0IHJtYCBvcGVyYW5kcyBhcmVcbiAqIGRlbGV0ZXMsIGB0cnVuY2F0ZWAgb3BlcmFuZHMgYXJlIHRydW5jYXRpb25zIChvbmx5IHdoZW4gYC1zYC9gLXJgIGlzXG4gKiBwcmVzZW50KS4gYGdpdCBybSAtLWNhY2hlZGAgdG91Y2hlcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBtYXRjaFJtVHJ1bmNhdGUoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdybScpIHtcbiAgICBtYXRjaFJtT3BlcmFuZHMocmVzdC5zbGljZSgxKSwgUk1fRVhDTFVERUQsIGZhbHNlLCBkaXJGb3JSZXNvbHV0aW9uLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY29tbWFuZCA9PT0gJ3RydW5jYXRlJykge1xuICAgIG1hdGNoVHJ1bmNhdGVPcGVyYW5kcyhyZXN0LnNsaWNlKDEpLCBkaXJGb3JSZXNvbHV0aW9uLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViICE9PSBudWxsICYmIHN1Yi5zdWJjb21tYW5kID09PSAncm0nKSB7XG4gICAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3JtLXdyaXRlJywgJ3JtJywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBtYXRjaFJtT3BlcmFuZHMoXG4gICAgICAgIHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpLFxuICAgICAgICBHSVRfUk1fRVhDTFVERUQsXG4gICAgICAgIHRydWUsXG4gICAgICAgIHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb24sXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgcmVzdWx0c1xuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAncm0nIHx8IHdyYXBwZWQgPT09ICd0cnVuY2F0ZScpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICB3cmFwcGVkID09PSAncm0nID8gJ3JtLXdyaXRlJyA6ICd0cnVuY2F0ZS1jb21tYW5kJyxcbiAgICAgICAgd3JhcHBlZCxcbiAgICAgICAgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmBcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgYm9keSBvZiBhbiB1bnF1b3RlZCBoZXJlZG9jIGlzIHNoZWxsLWxpdGVyYWwuIFRoZSBzaGVsbCBleHBhbmRzXG4gKiBgJGAgYW5kIGJhY2t0aWNrIHN1YnN0aXR1dGlvbnMgYW5kIHByb2Nlc3NlcyBiYWNrc2xhc2ggZXNjYXBlcyAoYFxcJGAsIGBgIFxcYCBgYCxcbiAqIGBcXFxcYCwgYmFja3NsYXNoLW5ld2xpbmUpIGluIGFuIHVucXVvdGVkIGJvZHkgYmVmb3JlIHRoZSBob3N0IHJlYWRzIGl0OyBhXG4gKiBiYXJlIGJhY2tzbGFzaCBiZWZvcmUgYW55IG90aGVyIGNoYXIgc3Vydml2ZXMgbGl0ZXJhbGx5LiBBIHF1b3RlZCBkZWxpbWl0ZXJcbiAqIG1ha2VzIHRoZSBib2R5IGxpdGVyYWwgcmVnYXJkbGVzcyBcdTIwMTQgY2hlY2tlZCBieSB0aGUgY2FsbGVyLlxuICovXG5mdW5jdGlvbiBoZXJlZG9jQm9keUlzTGl0ZXJhbChib2R5OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgaWYgKGJvZHkuaW5jbHVkZXMoJyQnKSB8fCBib2R5LmluY2x1ZGVzKCdgJykpIHJldHVybiBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2R5Lmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGJvZHlbaV0gIT09ICdcXFxcJykgY29udGludWU7XG4gICAgY29uc3QgbmV4dCA9IGJvZHlbaSArIDFdO1xuICAgIGlmIChuZXh0ID09PSB1bmRlZmluZWQgfHwgbmV4dCA9PT0gJyQnIHx8IG5leHQgPT09ICdgJyB8fCBuZXh0ID09PSAnXFxcXCcgfHwgbmV4dCA9PT0gJ1xcbicpIHJldHVybiBmYWxzZTtcbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKlxuICogVGhlIGhlcmVkb2Mgd3JpdGUgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjIpIGZvciB0aGUgaG9zdCBmYW1pbGllcyB3aG9zZSBib2RpZXMgYXJlXG4gKiBjb250ZW50OiBgY2F0YCAoYm9keSBcdTIxOTIgdGhlIGNvbnRlbnQgcmVkaXJlY3RzKSwgYHRlZWAgKGJvZHkgXHUyMTkyIHRoZSBvcGVyYW5kcyksXG4gKiBhbmQgYHBhdGNoYC9gZ2l0IGFwcGx5YCAoYm9keSBcdTIxOTIgcGF0Y2ggdGV4dCwgXHUwMEE3NS43KS4gQW55IG90aGVyIGhvc3QncyBoZXJlZG9jXG4gKiBib2R5IGlzIG5vdCBhdHRyaWJ1dGFibGUgY29udGVudCBcdTIwMTQgc3RkaW4tb25seSBhbmQgbm9uLWZhbWlseSBjb21tYW5kc1xuICogKGBweXRob24zIC0gPDxFT0YgPiBvdXRgLCBgbHMgPiBvdXQgPDxFT0ZgKSBnZXQgbm8gd3JpdGUgdG91Y2gsIGFuZFxuICogcmVhZC1mYW1pbHkgY29tbWFuZHMgKGBzZWQgLW4gJzEsMnAnIDw8RU9GYCkgZmFsbCB0aHJvdWdoIHRvIHRoZSByZWFkXG4gKiBtYXRjaGVycy4gRW1wdHkgYD4+YC1ib2RpZXMgYXBwZW5kIG5vdGhpbmcgYW5kIHRvdWNoIG5vdGhpbmc7IGVtcHR5IGA+YC1ib2RpZXNcbiAqIHRydW5jYXRlICh3aG9sZS1maWxlLCB0aGUgRjIgcnVsZSkuXG4gKlxuICogQm9keSB0aHJlYWRpbmc6IGA+PmAgYXBwZW5kcyBhbmQgYD5gIG92ZXJ3cml0ZXMgdGhyZWFkIHRoZSBib2R5IHdoZW4gdGhlXG4gKiBjb250ZW50IHJlZGlyZWN0IGlzIHNpbmdsZSBhbmQgcGxhaW4gXHUyMDE0IHRoZSBleGFjdCBnYXRlJ3MgcG9zdC1jb250ZW50IG9uIHRoZVxuICogb3ZlcndyaXRlICh0aGUgdHJhaWxpbmcgYFxcbmAgdGhlIGV4dHJhY3Rpb24gc3RyaXBzIGlzIHJlc3RvcmVkLCBzaW5jZSB0aGVcbiAqIGdhdGUgY29tcGFyZXMgZnVsbCBmaWxlIGJ5dGVzKSwgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keSBvbiB0aGUgYXBwZW5kIChwbGFuXG4gKiBcdTAwQTczIHN0ZXAgMWIgbGlzdHMgXCJ0ZWUvaGVyZWRvYyB3aXRoIGEgbGl0ZXJhbCBib2R5XCIgaW4gdGhlIGV4YWN0IGNsYXNzKS5cbiAqIEFuIHVucXVvdGVkIGRlbGltaXRlciBsZXRzIHRoZSBzaGVsbCBleHBhbmQgdGhlIGJvZHkgYmVmb3JlIHRoZSBob3N0IHJlYWRzXG4gKiBpdCwgc28gb25seSBhIGxpdGVyYWwgYm9keSAobm8gYCRgLCBiYWNrdGljaywgb3Igc2hlbGwtcHJvY2Vzc2VkIGJhY2tzbGFzaClcbiAqIHRocmVhZHMgXHUyMDE0IGFuIGV4cGFuZGFibGUgb25lIGRlZ3JhZGVzIHRvIHRoZSBleGlzdGVuY2UtZ2F0ZWQgYWR2aXNvcnkgY2xhc3NcbiAqIHJhdGhlciB0aGFuIHJpc2sgYSBkZWNpc2l2ZS1mYWlsIG9uIGNvbnRlbnQgdGhhdCBuZXZlciByZWFjaGVkIHRoZSBmaWxlLlxuICovXG5mdW5jdGlvbiBjbGFzc2lmeUhlcmVkb2NPcGVuZXIoXG4gIG9wZW5lcjogc3RyaW5nLFxuICBib2R5OiBzdHJpbmcsXG4gIHF1b3RlZERlbGltOiBib29sZWFuLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBib2R5TGl0ZXJhbCA9IHF1b3RlZERlbGltIHx8IGhlcmVkb2NCb2R5SXNMaXRlcmFsKGJvZHkpO1xuICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhvcGVuZXIpLnRyaW0oKSk7XG4gIGlmICh0b2tlbnMgPT09IG51bGwpIHJldHVybjtcbiAgY29uc3QgeyBhcmd2LCByZWRpcmVjdHMgfSA9IGFuYWx5emVUb2tlbnModG9rZW5zKTtcbiAgY29uc3QgaG9zdCA9IGFyZ3ZbMF07XG4gIGNvbnN0IGNvbnRlbnRSZWRpcmVjdHMgPSByZWRpcmVjdHMuZmlsdGVyKGlzQ29udGVudFJlZGlyZWN0KTtcbiAgY29uc3Qgc2luZ2xlUGxhaW5BcHBlbmQgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPj4nO1xuICBjb25zdCBzaW5nbGVQbGFpbk92ZXJ3cml0ZSA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+JztcblxuICBjb25zdCBlbWl0Q29udGVudFJlZGlyZWN0cyA9ICgpOiB2b2lkID0+IHtcbiAgICBmb3IgKGNvbnN0IHIgb2YgY29udGVudFJlZGlyZWN0cykge1xuICAgICAgaWYgKHIudGFyZ2V0ID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ2hlcmVkb2Mtd3JpdGUnLCByLnRhcmdldCwgY3VycmVudERpcik7XG4gICAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGlmIChyLm9wID09PSAnPj4nIHx8IHIub3AgPT09ICcmPj4nKSB7XG4gICAgICAgIGlmIChib2R5Lmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3Bhbjoge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAuLi4oc2luZ2xlUGxhaW5BcHBlbmQgJiYgci5vcCA9PT0gJz4+JyAmJiBib2R5TGl0ZXJhbCA/IHsgd3JpdHRlbjogYm9keSB9IDoge30pXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3BhbjpcbiAgICAgICAgICAgIGJvZHkubGVuZ3RoID09PSAwXG4gICAgICAgICAgICAgID8geyBvcGVyYXRpb246ICd0cnVuY2F0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgICAgICAgICAgOiB7XG4gICAgICAgICAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAgICAgICAvLyBUaGUgZXhhY3QgZ2F0ZSBjb21wYXJlcyBmdWxsIGZpbGUgYnl0ZXMsIHNvIHRoZSB0cmFpbGluZ1xuICAgICAgICAgICAgICAgICAgLy8gYFxcbmAgdGhlIGV4dHJhY3Rpb24gc3RyaXBwZWQgY29tZXMgYmFjayBvbiB0aGUgb3ZlcndyaXRlLlxuICAgICAgICAgICAgICAgICAgLi4uKHNpbmdsZVBsYWluT3ZlcndyaXRlICYmIGJvZHlMaXRlcmFsID8geyB3cml0dGVuOiBgJHtib2R5fVxcbmAgfSA6IHt9KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIGlmIChob3N0ID09PSAnY2F0Jykge1xuICAgIGVtaXRDb250ZW50UmVkaXJlY3RzKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ID09PSAndGVlJykge1xuICAgIGNvbnN0IHBhcnRzID0gdGVlT3BlcmFuZFBhcnRzKGFyZ3YpO1xuICAgIGlmIChwYXJ0cyAhPT0gbnVsbCkge1xuICAgICAgZm9yIChjb25zdCBvcGVyYW5kIG9mIHBhcnRzLm9wZXJhbmRzKSB7XG4gICAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ2hlcmVkb2Mtd3JpdGUnLCBvcGVyYW5kLCBjdXJyZW50RGlyKTtcbiAgICAgICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICAgIGlmIChwYXJ0cy5hcHBlbmQpIHtcbiAgICAgICAgICBpZiAoYm9keS5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgICAgc3Bhbjoge1xuICAgICAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgICAgLi4uKGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAwICYmIGJvZHlMaXRlcmFsID8geyB3cml0dGVuOiBib2R5IH0gOiB7fSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICAgIHNwYW46XG4gICAgICAgICAgICAgIGJvZHkubGVuZ3RoID09PSAwXG4gICAgICAgICAgICAgICAgPyB7IG9wZXJhdGlvbjogJ3RydW5jYXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgICAgICAgICAgIDoge1xuICAgICAgICAgICAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAgICAgICAgIC8vIFNhbWUgcmVzdG9yZWQtYFxcbmAgZXhhY3QgYm9keSBhcyB0aGUgcmVkaXJlY3QgYnJhbmNoOyBhXG4gICAgICAgICAgICAgICAgICAgIC8vIHRlZSBvcGVyYW5kIHdpdGggYSBjb250ZW50IHJlZGlyZWN0IHByZXNlbnQga2VlcHMgdGhlXG4gICAgICAgICAgICAgICAgICAgIC8vIHJlZGlyZWN0J3MgdGhyZWFkaW5nIG9ubHkgKG1pcnJvciBvZiB0aGUgYXBwZW5kIGJyYW5jaCkuXG4gICAgICAgICAgICAgICAgICAgIC4uLihjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMCAmJiBib2R5TGl0ZXJhbCA/IHsgd3JpdHRlbjogYCR7Ym9keX1cXG5gIH0gOiB7fSlcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBlbWl0Q29udGVudFJlZGlyZWN0cygpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3BhdGNoJyB8fCBob3N0ID09PSAnZ2l0Jykge1xuICAgIGNsYXNzaWZ5UGF0Y2hIZXJlZG9jKGFyZ3YsIGJvZHksIGN1cnJlbnREaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE5vbi1mYW1pbHkgaG9zdDogdGhlIGJvZHkgaXMgbm90IGF0dHJpYnV0YWJsZSBjb250ZW50IFx1MjAxNCBubyB3cml0ZSB0b3VjaC5cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgc2VkIC1pIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS42KSwgdGhlIGZpcnN0IGNvbnN1bWVyIG9mIGV4YWN0IHJhbmdlczogYVxuLy8gc3Vic3RpdHV0aW9uLW9ubHkgc2NyaXB0IHdpdGggbnVtZXJpYyBhZGRyZXNzZXMgbW9kaWZpZXMgdGhlIGFkZHJlc3NlZFxuLy8gbGluZXM7IGFueXRoaW5nIGxlc3Mgc3RhdGljYWxseSBjZXJ0YWluIGlzIGEgd2hvbGUtZmlsZSBtb2RpZnkuIFRoZVxuLy8gc3VmZml4L3NjcmlwdCBkaXNhbWJpZ3VhdGlvbiBhbmQgdGhlIHNlZ21lbnQgY2xhc3NpZmljYXRpb24gYmVsb3cgYXJlIHRoZVxuLy8gd2hvbGUgb2YgaXQgXHUyMDE0IGV2ZXJ5dGhpbmcgZWxzZSBmb2xsb3dzIHRoZSBzaGFyZWQgXHUwMEE3NSBmYWlsLWNsb3NlZCBydWxlcy5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQSBudW1lcmljLWFkZHJlc3NlZCBzdWJzdGl0dXRpb24gc2VnbWVudCAoYE5gLCBgTixNYCkgXHUyMDE0IHRoZSBvbmx5IGZvcm0gd2l0aCBhbiBleGFjdCByYW5nZS4gKi9cbmNvbnN0IE5VTUVSSUNfU1VCU1RJVFVUSU9OID0gL14oXFxkKykoPzosKFxcZCspKT9bc3ldLztcblxuLyoqIEFuIHVuYWRkcmVzc2VkIHN1YnN0aXR1dGlvbiBzZWdtZW50IFx1MjAxNCBsaW5lLWNvdW50LXByZXNlcnZpbmcsIHdob2xlIGZpbGUgYWRkcmVzc2VkLiAqL1xuY29uc3QgVU5SRVNUUklDVEVEX1NVQlNUSVRVVElPTiA9IC9eW3N5XS87XG5cbmZ1bmN0aW9uIG1hdGNoU2VkSW5wbGFjZShcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ3NlZCcpIHtcbiAgICBtYXRjaFNlZElucGxhY2VBcmdzKHJlc3Quc2xpY2UoMSksIGRpckZvclJlc29sdXRpb24sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAnc2VkJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgd3JhcHBlZCwgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFRoZSBzZWQgLWkgb3BlcmFuZCBncmFtbWFyOiBgLWlgIGJhcmUsIGAtaVNVRkZJWGAgYXR0YWNoZWQsIG9yIGEgc2VwYXJhdGVcbiAqIHN1ZmZpeCB3b3JkIHJlc29sdmVkIGJ5IHRoZSBzdGFuZGFyZCBkaXNhbWJpZ3VhdGlvbiBcdTIwMTQgdGhlIHdvcmQgYWZ0ZXIgYC1pYFxuICogaXMgdGhlIHN1ZmZpeCBvbmx5IHdoZW4gaXQgZG9lcyBub3Qgc3RhcnQgd2l0aCBgLWAsIGlzIG5vdCBzY3JpcHQtc2hhcGVkXG4gKiAoYSBzZWQgY29tbWFuZCBsZXR0ZXIgb3IgYW4gYWRkcmVzcyBzdGFydCBcdTIwMTQgYHMvYS9iL2AsIGAyZGAsIGAveC9kYCksIGFuZCBhXG4gKiBzY3JpcHQgcGx1cyBhdCBsZWFzdCBvbmUgZmlsZSBvcGVyYW5kIHN0aWxsIGZvbGxvdyBpdCAodGhlIEJTRFxuICogc2VwYXJhdGUtc3VmZml4IHJlYWRpbmc7IEdOVSdzIGF0dGFjaGVkLW9ubHkgcmVhZGluZyBvdGhlcndpc2UpLiBBXG4gKiBzY3JpcHQtc2hhcGVkIHdvcmQgaXMgdGhlIHNjcmlwdCB1bmRlciBHTlUncyByZWFkaW5nOiBgc2VkIC1pIHMvYS9iLyBmIGdgXG4gKiB3b3VsZCBvdGhlcndpc2Ugc3RlYWwgdGhlIGZpcnN0IGZpbGUgb3BlcmFuZCBhcyBhIHN1ZmZpeCBhbmQgc2lsZW50bHkgbWlzc1xuICogaXRzIHdyaXRlICh0aGUgbXVsdGktZmlsZS1zZWQgbWlzcGFyc2UpLiBBbiBhdHRhY2hlZCBvciBkaXNhbWJpZ3VhdGVkXG4gKiBzdWZmaXggaXMgYSBiYWNrdXA6IGEgbm9uLWVtcHR5IHN1ZmZpeCBlbWl0cyBhbiBhZGRpdGlvbmFsIGNyZWF0ZS1vdmVyd3JpdGVcbiAqIHRvdWNoIG9uIGA8ZmlsZT48U1VGRklYPmA7IGFuIGVtcHR5IHN1ZmZpeCAod2hpY2ggdGhlIHF1b3RlLWF3YXJlIHRva2VuaXplclxuICogZHJvcHMgZW50aXJlbHkgXHUyMDE0IGBzZWQgLWkgJycgZmAgYW5kIGBzZWQgLWkgZmAgdG9rZW5pemUgYWxpa2UpIGNyZWF0ZXMgbm9cbiAqIGJhY2t1cC5cbiAqXG4gKiBUaGUgc2NyaXB0IGlzIHRoZSBzY3JpcHQgYXJndW1lbnQgcGx1cyBldmVyeSBgLWVgIGFyZ3VtZW50LCBzcGxpdCBvbiBgO2AuXG4gKiBTZWdtZW50cyB0aGF0IGFyZSBhbGwgbnVtZXJpYy1hZGRyZXNzZWQgc3Vic3RpdHV0aW9ucyB5aWVsZCB0aGUgZXhhY3QgcmFuZ2VcbiAqIFttaW4gc3RhcnQsIG1pbihtYXggZW5kLCBFT0YpXSAocGVyIGZpbGUsIEVPRiBmcm9tIHRoZSBwb3N0LWVkaXQgY291bnQpO1xuICogc2VnbWVudHMgdGhhdCBhcmUgYWxsIHN1YnN0aXR1dGlvbnMgXHUyMDE0IGFueSBudW1lcmljL3VuYWRkcmVzc2VkIG1peCBcdTIwMTQgYXJlXG4gKiBzdGlsbCBsaW5lLWNvdW50LXByZXNlcnZpbmcsIHNvIHRoZSB3aG9sZSBmaWxlIGlzIGFkZHJlc3NlZCAoWzEsIEVPRl0pO1xuICogYW55IGNvdW50LWNoYW5naW5nLCBwYXR0ZXJuLWFkZHJlc3NlZCwgc3RlcCwgb3IgYCRgLWFkZHJlc3NlZCBzZWdtZW50IGlzIGFcbiAqIHdob2xlLWZpbGUgbW9kaWZ5IHdpdGggbm8gcmFuZ2UuIEFuIGFic2VudCBzY3JpcHQgKG5vIHNjcmlwdCBhcmd1bWVudCwgbm9cbiAqIGAtZWApIGlzIHVucmVzb2x2ZWQuXG4gKi9cbi8qKlxuICogQSB3b3JkIHRoYXQgY2FuIG9ubHkgYmUgYSBzZWQgc2NyaXB0LCBuZXZlciBhIEJTRCBzZXBhcmF0ZSBzdWZmaXg6IGEgc2VkXG4gKiBjb21tYW5kIGxldHRlciAoYHNgL2B5YC9gZGAvXHUyMDI2KSwgb3IgYW4gYWRkcmVzcyBzdGFydCAoZGlnaXQsIGAvYCwgYFxcYCwgYCRgLFxuICogYH5gKS4gVGhlIG11bHRpLWZpbGUgZm9ybSBgc2VkIC1pIHMvYS9iLyBmIGdgIHB1dHMgdGhlIHNjcmlwdCBpbW1lZGlhdGVseVxuICogYWZ0ZXIgYmFyZSBgLWlgIChHTlUncyByZWFkaW5nOyB0aGUgQlNEIHJlYWRpbmcgbmVlZHMgYSBzZXBhcmF0ZSBzdWZmaXhcbiAqIHdvcmQgZmlyc3QsIGFuZCBhIGxldHRlci1sZWFkaW5nIG9yIGFkZHJlc3MtbGVhZGluZyB3b3JkIGlzIG5vdCBvbmUpLlxuICovXG5jb25zdCBTRURfU0NSSVBUX1NIQVBFID0gL14oPzpbQS1aYS16XXxcXGR8XFwvfFxcXFx8XFwkfH4pLztcblxuZnVuY3Rpb24gbWF0Y2hTZWRJbnBsYWNlQXJncyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IHN1ZmZpeDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBzYXdJbnBsYWNlID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgZVNjcmlwdHM6IHN0cmluZ1tdID0gW107XG4gIC8vIFRoZSBzY3JpcHQvZmlsZSBzcGxpdCBvZiB0aGUgcG9zaXRpb25hbHMgaXMgZGVyaXZlZCBhZnRlciB0aGUgc2NhbjogdGhlXG4gIC8vIGZpcnN0IHBvc2l0aW9uYWwgaXMgdGhlIHNjcmlwdCBhcmd1bWVudCBvbmx5IHdoZW4gbm8gYC1lYCBzY3JpcHQgZXhpc3RzIFx1MjAxNFxuICAvLyB3aXRoIGAtZWAgcHJlc2VudCBldmVyeSBwb3NpdGlvbmFsIGlzIGEgZmlsZSAoR05VIHNlZCByZWFkcyB0aGUgc2NyaXB0XG4gIC8vIGZyb20gYC1lYCB0aGVuLCBub3QgZnJvbSB0aGUgZmlyc3QgcG9zaXRpb25hbCkuXG4gIGNvbnN0IHBvc2l0aW9uYWxzOiBzdHJpbmdbXSA9IFtdO1xuICAvLyBGaWxlcyBwdXNoZWQgb3V0c2lkZSB0aGUgcG9zaXRpb25hbCBwYXRoOiBgc2VkIC1pIGZgIChzY3JpcHQgYWJzZW50KS5cbiAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG5cbiAgd2hpbGUgKGkgPCBhcmdzLmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBwb3NpdGlvbmFscy5wdXNoKGEpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWUnKSB7XG4gICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIGEsICd0aGUgLWUgZmxhZyBpcyBsZWZ0IHZhbHVlbGVzcycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBlU2NyaXB0cy5wdXNoKHYpO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWknKSB7XG4gICAgICBzYXdJbnBsYWNlID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHcgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh3ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgLy8gYHNlZCAtaWAgd2l0aCBub3RoaW5nIGFmdGVyOiBubyBzdWZmaXgsIG5vIHNjcmlwdCBcdTIwMTQgdGhlIGFic2VudC1zY3JpcHRcbiAgICAgICAgLy8gY2hlY2sgYmVsb3cgcmVzb2x2ZXMgdGhpcyB1bnJlc29sdmVkLlxuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKHcuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICAgIC8vIFRoZSB3b3JkIGFmdGVyIC1pIGlzIGFuIG9wdGlvbiwgbmV2ZXIgYSBzdWZmaXguXG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCByZXN0QWZ0ZXIgPSBhcmdzLnNsaWNlKGkgKyAyKTtcbiAgICAgIGlmIChyZXN0QWZ0ZXIubGVuZ3RoID49IDIgJiYgIVNFRF9TQ1JJUFRfU0hBUEUudGVzdCh3KSkge1xuICAgICAgICAvLyBUaGUgQlNEIHNlcGFyYXRlLXN1ZmZpeCByZWFkaW5nOiB3IGlzIHRoZSBzdWZmaXgsIGFuZCBhIHNjcmlwdCBwbHVzXG4gICAgICAgIC8vIGF0IGxlYXN0IG9uZSBmaWxlIG9wZXJhbmQgc3RpbGwgZm9sbG93IFx1MjAxNCBvbmx5IGZvciBhIHN1ZmZpeC1zaGFwZWRcbiAgICAgICAgLy8gd29yZCAoYC5iYWtgLCBgJydgKS4gQSBzY3JpcHQtc2hhcGVkIHdvcmQgaXMgdGhlIHNjcmlwdCB1bmRlciBHTlUnc1xuICAgICAgICAvLyByZWFkaW5nLCBzbyBgc2VkIC1pIHMvYS9iLyBmIGdgIHRyZWF0cyBgcy9hL2IvYCBhcyB0aGUgc2NyaXB0IGFuZFxuICAgICAgICAvLyBib3RoIGYgYW5kIGcgYXMgZmlsZXMuXG4gICAgICAgIHN1ZmZpeCA9IHc7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAocmVzdEFmdGVyLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBgc2VkIC1pIGZgOiB3IGlzIHRoZSBsYXN0IHRva2VuIFx1MjAxNCBubyBzY3JpcHQgY2FuIGZvbGxvdywgc28gdyBpcyB0aGVcbiAgICAgICAgLy8gZmlsZSBvcGVyYW5kIHdpdGggdGhlIHNjcmlwdCBhYnNlbnQgKEdOVSBpbnN0ZWFkIHJlYWRzIHcgYXMgYSBzY3JpcHRcbiAgICAgICAgLy8gYW5kIGVycm9yczsgZWl0aGVyIHdheSB0aGUgZWRpdCBkb2VzIG5vdCBoYXBwZW4pLlxuICAgICAgICBmaWxlcy5wdXNoKHcpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLy8gT25lIHRva2VuIGFmdGVyIHc6IHcgaXMgdGhlIHNjcmlwdCBhcmd1bWVudCAob3IgYSBmaWxlLCB3aGVuIGAtZWBcbiAgICAgIC8vIHNjcmlwdHMgYXJlIHByZXNlbnQpIGFuZCB0aGUgdG9rZW4gaXMgYSBmaWxlIFx1MjAxNCBjb25zdW1lIGJvdGgsIHNvXG4gICAgICAvLyBuZWl0aGVyIGZhbGxzIHRocm91Z2ggdG8gdGhlIHBvc2l0aW9uYWwgcGF0aCBhZ2Fpbi5cbiAgICAgIHBvc2l0aW9uYWxzLnB1c2godywgcmVzdEFmdGVyWzBdKTtcbiAgICAgIGkgKz0gMztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctaScpICYmIGEubGVuZ3RoID4gMikge1xuICAgICAgc2F3SW5wbGFjZSA9IHRydWU7XG4gICAgICBzdWZmaXggPSBhLnNsaWNlKDIpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgLy8gVW5rbm93biBvcHRpb24gXHUyMDE0IG5ldmVyIGEgc2NyaXB0IG9yIGZpbGUuXG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcG9zaXRpb25hbHMucHVzaChhKTtcbiAgICBpICs9IDE7XG4gIH1cblxuICBpZiAoIXNhd0lucGxhY2UpIHJldHVybjsgLy8gbm90IGFuIGluLXBsYWNlIGVkaXQgYXQgYWxsXG4gIGNvbnN0IHNjcmlwdEFyZyA9IGVTY3JpcHRzLmxlbmd0aCA9PT0gMCA/IChwb3NpdGlvbmFsc1swXSA/PyBudWxsKSA6IG51bGw7XG4gIGlmIChzY3JpcHRBcmcgIT09IG51bGwpIGZpbGVzLnB1c2goLi4ucG9zaXRpb25hbHMuc2xpY2UoMSkpO1xuICBlbHNlIGZpbGVzLnB1c2goLi4ucG9zaXRpb25hbHMpO1xuICBjb25zdCBzZWdtZW50czogc3RyaW5nW10gPSBbXTtcbiAgaWYgKHNjcmlwdEFyZyAhPT0gbnVsbCkgc2VnbWVudHMucHVzaCguLi5zY3JpcHRBcmcuc3BsaXQoJzsnKSk7XG4gIGZvciAoY29uc3QgcyBvZiBlU2NyaXB0cykgc2VnbWVudHMucHVzaCguLi5zLnNwbGl0KCc7JykpO1xuICBpZiAoc2VnbWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgZmlsZXNbMF0gPz8gJ3NlZCcsICdubyBzY3JpcHQgKGFic2VudCBvciBlbXB0eSBzY3JpcHQgYXJndW1lbnQpJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gU2VnbWVudCBjbGFzc2lmaWNhdGlvbjogZXhhY3Qgd2hlbiBldmVyeSBzZWdtZW50IGlzIGEgbnVtZXJpYy1hZGRyZXNzZWRcbiAgLy8gc3Vic3RpdHV0aW9uOyBleHBsaWNpdCB3aG9sZS1maWxlIFsxLCBFT0ZdIHdoZW4gZXZlcnkgc2VnbWVudCBpcyBzdGlsbCBhXG4gIC8vIHN1YnN0aXR1dGlvbiAoYW55IHVuYWRkcmVzc2VkL251bWVyaWMgbWl4KTsgbm8gcmFuZ2Ugb3RoZXJ3aXNlLlxuICBsZXQgYWxsTnVtZXJpYyA9IHRydWU7XG4gIGxldCBhbGxTdWJzdGl0dXRpb24gPSB0cnVlO1xuICBsZXQgbWluU3RhcnQgPSBJbmZpbml0eTtcbiAgbGV0IG1heEVuZCA9IDA7XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzZWdtZW50cykge1xuICAgIGNvbnN0IG0gPSBzZWdtZW50Lm1hdGNoKE5VTUVSSUNfU1VCU1RJVFVUSU9OKTtcbiAgICBpZiAobSA9PT0gbnVsbCkge1xuICAgICAgYWxsTnVtZXJpYyA9IGZhbHNlO1xuICAgICAgaWYgKCFVTlJFU1RSSUNURURfU1VCU1RJVFVUSU9OLnRlc3Qoc2VnbWVudCkpIGFsbFN1YnN0aXR1dGlvbiA9IGZhbHNlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBOdW1iZXIucGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGNvbnN0IGUgPSBtWzJdID09PSB1bmRlZmluZWQgPyBzIDogTnVtYmVyLnBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICBtaW5TdGFydCA9IE1hdGgubWluKG1pblN0YXJ0LCBzKTtcbiAgICBtYXhFbmQgPSBNYXRoLm1heChtYXhFbmQsIGUpO1xuICB9XG5cbiAgZm9yIChjb25zdCBmIG9mIGZpbGVzKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGYpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnc2VkLWlucGxhY2UnLCBmLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChkaXIsIGYpO1xuICAgIGlmIChhbGxOdW1lcmljIHx8IGFsbFN1YnN0aXR1dGlvbikge1xuICAgICAgY29uc3QgdG90YWwgPSBjb3VudEZpbGVMaW5lcyhhYnNvbHV0ZVBhdGgpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICAgIHJlc3VsdHMsXG4gICAgICAgICAgJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgJ2NvdWxkIG5vdCBkZXRlcm1pbmUgZW5kLW9mLWZpbGUgbGluZSBjb3VudCAoZmlsZSB1bnJlYWRhYmxlLCBlbXB0eSwgb3IgbWlzc2luZyknXG4gICAgICAgICk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc3RhcnQgPSBhbGxOdW1lcmljID8gbWluU3RhcnQgOiAxO1xuICAgICAgY29uc3QgZW5kID0gYWxsTnVtZXJpYyA/IE1hdGgubWluKG1heEVuZCwgdG90YWwpIDogdG90YWw7XG4gICAgICBpZiAoc3RhcnQgPiBlbmQpIGNvbnRpbnVlOyAvLyB0aGUgYWRkcmVzc2VkIHJhbmdlIGxpZXMgYmV5b25kIEVPRiBcdTIwMTQgbm90aGluZyBpcyBtb2RpZmllZFxuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdtb2RpZnknLCBsaW5lU3RhcnQ6IHN0YXJ0LCBsaW5lRW5kOiBlbmQsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnc2VkLWlucGxhY2UnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ21vZGlmeScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAoc3VmZml4ICE9PSBudWxsICYmIHN1ZmZpeCAhPT0gJycpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdzZWQtaW5wbGFjZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsIGFic29sdXRlUGF0aDogYCR7YWJzb2x1dGVQYXRofSR7c3VmZml4fWAsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgcGF0Y2ggLyBnaXQgYXBwbHkgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjcpLiBQYXRjaCB0ZXh0IHNvdXJjZXMsIGluIG9yZGVyIG9mXG4vLyByZWNvZ25pdGlvbjogYSBsaXRlcmFsIHBhdGNoLWZpbGUgb3BlcmFuZCAoYGdpdCBhcHBseSA8ZmlsZT5gIFx1MjAxNCBhIGBwYXRjaGBcbi8vIG9wZXJhbmQgaXMgYSB0YXJnZXQgZmlsZSwgbm90IGEgc291cmNlLCBhbmQgaXMgaWdub3JlZCksIHRoZSBzdGRpbiBgPGBcbi8vIHNvdXJjZSAoYHBhdGNoIC1wTiA8IGZpbGVgLCBgZ2l0IGFwcGx5IC0gPCBmaWxlYCksIG9yIGEgaGVyZWRvYyBib2R5XG4vLyAoY2xhc3NpZnlQYXRjaEhlcmVkb2MsIFx1MDBBNzUuMikuIFJlYWQtb25seSBtb2RlcyAoYC0tY2hlY2tgL2AtLXN0YXRgL1xuLy8gYC0tbnVtc3RhdGAvYC0tc3VtbWFyeWAsIGBwYXRjaCAtLWRyeS1ydW5gKSBhbmQgaW5kZXgtb25seSBgLS1jYWNoZWRgIHRvdWNoXG4vLyBub3RoaW5nOyBgLS1kaXJlY3RvcnlgIGZhaWxzIGNsb3NlZCAoaXQgcmV3cml0ZXMgcGF0Y2ggcGF0aHMpLiBBIGNvbW1hbmRcbi8vIHdpdGggbm8gc3RhdGljYWxseSBrbm93biBzb3VyY2UgKHBpcGVkIG9yIHRlcm1pbmFsIHN0ZGluLCBhIHZhcmlhYmxlIHBhdGNoXG4vLyBwYXRoKSBpcyB1bnJlc29sdmVkLiBUYXJnZXRzIGFuZCByYW5nZXMgY29tZSBmcm9tIHRoZSBuZXdcbi8vIHJhbmdlLXByZXNlcnZpbmcgdW5pZmllZC1kaWZmIHBhcnNlciAodW5pZmllZC1kaWZmLnRzKS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIHNoYXJlZCBgcGF0Y2hgL2BnaXQgYXBwbHlgIG9wdGlvbiBzdXJmYWNlIChwbGFuIFx1MDBBNzUuNyk6IHN0cmlwIGxldmVsLCByZWFkLW9ubHkgYW5kIGluZGV4LW9ubHkgbW9kZXMsIGAtLWRpcmVjdG9yeWAsIGFuZCBvcGVyYW5kcy4gKi9cbmludGVyZmFjZSBQYXRjaEFwcGx5UGFydHMge1xuICBzdHJpcDogUGF0aFN0cmlwO1xuICByZWFkT25seTogYm9vbGVhbjtcbiAgY2FjaGVkT25seTogYm9vbGVhbjtcbiAgZGlyZWN0b3J5OiBib29sZWFuO1xuICBvcGVyYW5kczogc3RyaW5nW107XG59XG5cbmZ1bmN0aW9uIHBhdGNoQXBwbHlQYXJ0cyhhcmdzOiBzdHJpbmdbXSwgaXNHaXRBcHBseTogYm9vbGVhbik6IFBhdGNoQXBwbHlQYXJ0cyB7XG4gIGxldCBzdHJpcDogUGF0aFN0cmlwID0gaXNHaXRBcHBseSA/IDEgOiAnYXV0byc7XG4gIGxldCByZWFkT25seSA9IGZhbHNlO1xuICBsZXQgY2FjaGVkT25seSA9IGZhbHNlO1xuICBsZXQgZGlyZWN0b3J5ID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGlzR2l0QXBwbHkpIHtcbiAgICAgIGlmIChhID09PSAnLS1jaGVjaycgfHwgYSA9PT0gJy0tc3RhdCcgfHwgYSA9PT0gJy0tbnVtc3RhdCcgfHwgYSA9PT0gJy0tc3VtbWFyeScpIHtcbiAgICAgICAgcmVhZE9ubHkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhID09PSAnLS1jYWNoZWQnKSB7XG4gICAgICAgIGNhY2hlZE9ubHkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhID09PSAnLS1pbmRleCcgfHwgYSA9PT0gJy1SJyB8fCBhID09PSAnLS1yZXZlcnNlJyB8fCBhID09PSAnLS11bnNhZmUtcGF0aHMnIHx8IGEgPT09ICctLXJlamVjdCcpIGNvbnRpbnVlO1xuICAgICAgaWYgKGEgPT09ICctLWRpcmVjdG9yeScpIHtcbiAgICAgICAgZGlyZWN0b3J5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYS5zdGFydHNXaXRoKCctLWRpcmVjdG9yeT0nKSkge1xuICAgICAgICBkaXJlY3RvcnkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhID09PSAnLXAnKSB7XG4gICAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQodiwgMTApO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICgvXi1wXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgyKSwgMTApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIHBhdGNoXG4gICAgaWYgKGEgPT09ICctLWRyeS1ydW4nKSB7XG4gICAgICByZWFkT25seSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctTicgfHwgYSA9PT0gJy0tZm9yd2FyZCcpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLXAnKSB7XG4gICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQodiwgMTApO1xuICAgICAgICBpICs9IDE7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLXBcXGQrJC8udGVzdChhKSkge1xuICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgyKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBzdHJpcCwgcmVhZE9ubHksIGNhY2hlZE9ubHksIGRpcmVjdG9yeSwgb3BlcmFuZHMgfTtcbn1cblxuLyoqIFRoZSBwYXRjaCB0ZXh0IGF0IGBhYnNvbHV0ZVBhdGhgLCBvciBudWxsIHdoZW4gaXQgY2FuJ3QgYmUgcmVhZC4gKi9cbmZ1bmN0aW9uIHJlYWRQYXRjaEZpbGUoYWJzb2x1dGVQYXRoOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBFbWl0IHRoZSB3cml0ZSB0b3VjaGVzIGZvciBhIGBwYXRjaGAvYGdpdCBhcHBseWAgY29tbWFuZCB3aXRoIGEgc3RhdGljYWxseVxuICoga25vd24gcGF0Y2gtdGV4dCBzb3VyY2UuIGB0YXJnZXREaXJgIGlzIHdoZXJlIHRoZSBwYXRjaCdzIHRhcmdldCBwYXRoc1xuICogcmVzb2x2ZSAodGhlIGdpdCBgLUNgIGRpcmVjdG9yeSBmb3IgYGdpdCBhcHBseWAsIHRoZSBjdXJyZW50IGRpcmVjdG9yeVxuICogb3RoZXJ3aXNlKTsgYHNoZWxsRGlyYCBpcyB3aGVyZSB0aGUgc2hlbGwncyBzdGRpbiBgPGAgcmVkaXJlY3QgdGFyZ2V0XG4gKiByZXNvbHZlcyBcdTIwMTQgYSByZWRpcmVjdCBpcyBzaGVsbC1zaWRlLCBzbyBgZ2l0IC1DYCBuZXZlciBhZmZlY3RzIGl0LlxuICovXG5mdW5jdGlvbiBlbWl0UGF0Y2hUYXJnZXRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgaXNHaXRBcHBseTogYm9vbGVhbixcbiAgaG9zdDogc3RyaW5nLFxuICB0YXJnZXREaXI6IHN0cmluZyxcbiAgc2hlbGxEaXI6IHN0cmluZyxcbiAgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHBhcnRzID0gcGF0Y2hBcHBseVBhcnRzKGFyZ3MsIGlzR2l0QXBwbHkpO1xuICBpZiAocGFydHMucmVhZE9ubHkgfHwgcGFydHMuY2FjaGVkT25seSkgcmV0dXJuOyAvLyByZWFkLW9ubHkgLyBpbmRleC1vbmx5IFx1MjAxNCBubyB0b3VjaGVzXG4gIGlmIChwYXJ0cy5kaXJlY3RvcnkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnLS1kaXJlY3RvcnknLCAnLS1kaXJlY3RvcnkgcmV3cml0ZXMgcGF0Y2ggcGF0aHMnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBsZXQgcGF0Y2hUZXh0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHNvdXJjZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIC8vIDEuIEEgbGl0ZXJhbCBwYXRjaC1maWxlIG9wZXJhbmQgKGdpdCBhcHBseSBvbmx5OyBhIHBhdGNoIG9wZXJhbmQgaXMgYVxuICAvLyAgICB0YXJnZXQgZmlsZSwgbm90IGEgc291cmNlIFx1MjAxNCBpZ25vcmVkKS5cbiAgaWYgKGlzR2l0QXBwbHkpIHtcbiAgICBjb25zdCBvcGVyYW5kID0gcGFydHMub3BlcmFuZHMuZmluZCgobykgPT4gbyAhPT0gJy0nKTtcbiAgICBpZiAob3BlcmFuZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHNvdXJjZSA9IHJlc29sdmVQYXRoKHRhcmdldERpciwgb3BlcmFuZCk7XG4gICAgICBwYXRjaFRleHQgPSByZWFkUGF0Y2hGaWxlKHNvdXJjZSk7XG4gICAgICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHNvdXJjZSwgJ3BhdGNoIGZpbGUgdW5yZWFkYWJsZSBvciBtaXNzaW5nJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgLy8gMi4gVGhlIHN0ZGluIGA8YCBzb3VyY2UgKHBhdGNoIGFuZCBnaXQgYXBwbHkpLlxuICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgY29uc3Qgc3RkaW4gPSByZWRpcmVjdHMuZmluZCgocikgPT4gci5vcCA9PT0gJzwnKTtcbiAgICBpZiAoc3RkaW4gIT09IHVuZGVmaW5lZCAmJiBzdGRpbi50YXJnZXQgIT09IG51bGwpIHtcbiAgICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShzdGRpbi50YXJnZXQpKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHN0ZGluLnRhcmdldCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHNvdXJjZSA9IHJlc29sdmVQYXRoKHNoZWxsRGlyLCBzdGRpbi50YXJnZXQpO1xuICAgICAgcGF0Y2hUZXh0ID0gcmVhZFBhdGNoRmlsZShzb3VyY2UpO1xuICAgICAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzb3VyY2UsICdwYXRjaCB0ZXh0IHVucmVhZGFibGUgb3IgbWlzc2luZycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8vIDMuIE5vIHN0YXRpY2FsbHkga25vd24gc291cmNlOiBzdGRpbiBpcyBkeW5hbWljICh0ZXJtaW5hbCwgcGlwZSwgdmFyaWFibGUpLlxuICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgaG9zdCwgJ25vIHN0YXRpY2FsbHkga25vd24gcGF0Y2ggdGV4dCBzb3VyY2UgKHN0ZGluIGlzIGR5bmFtaWMpJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgdGFyZ2V0cyA9IHBhcnNlVW5pZmllZERpZmZSYW5nZShwYXRjaFRleHQsIHBhcnRzLnN0cmlwKTtcbiAgaWYgKHRhcmdldHMgPT09IG51bGwpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzb3VyY2UgPz8gaG9zdCwgJ21hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB0ZXh0Jyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGZvciAoY29uc3QgdCBvZiB0YXJnZXRzKSB7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCB0LnBhdGgsIHRhcmdldERpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncGF0Y2gtd3JpdGUnLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246IHQub3BlcmF0aW9uLFxuICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgLi4uKHQubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgPyB7IGxpbmVTdGFydDogdC5saW5lU3RhcnQsIGxpbmVFbmQ6IHQubGluZUVuZCB9IDoge30pXG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcGF0Y2gvZ2l0IGFwcGx5IGdyYW1tYXIgaW4gdGhlIG1haW4gd2FsazogYHBhdGNoYCByZWFkcyBwYXRjaCB0ZXh0IGZyb21cbiAqIHN0ZGluIG9yIGEgYDxgIHJlZGlyZWN0OyBgZ2l0IGFwcGx5YCBhZGRpdGlvbmFsbHkgYWNjZXB0cyBhIHBhdGNoLWZpbGVcbiAqIG9wZXJhbmQgYW5kIHJlc29sdmVzIHRhcmdldHMgYWdhaW5zdCBpdHMgYC1DYCBkaXJlY3RvcnkuIEEgd3JhcHBlZFxuICogYHBhdGNoYC9gYXBwbHlgIGlzIHVucmVzb2x2ZWQgXHUyMDE0IHRoZSB3cmFwcGVyIG9ic2N1cmVzIHRoZSBhcmd2LlxuICovXG5mdW5jdGlvbiBtYXRjaFBhdGNoQXBwbHkoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdwYXRjaCcpIHtcbiAgICBlbWl0UGF0Y2hUYXJnZXRzKFxuICAgICAgcmVzdC5zbGljZSgxKSxcbiAgICAgIGZhbHNlLFxuICAgICAgJ3BhdGNoJyxcbiAgICAgIGRpckZvclJlc29sdXRpb24sXG4gICAgICBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgcmVkaXJlY3RzLFxuICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgam9pbixcbiAgICAgIHJlc3VsdHNcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViID09PSBudWxsIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnYXBwbHknKSByZXR1cm47XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnYXBwbHknLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGVtaXRQYXRjaFRhcmdldHMoXG4gICAgICByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKSxcbiAgICAgIHRydWUsXG4gICAgICAnYXBwbHknLFxuICAgICAgc3ViLmNEaXIgPz8gZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIGRpckZvclJlc29sdXRpb24sXG4gICAgICByZWRpcmVjdHMsXG4gICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICBqb2luLFxuICAgICAgcmVzdWx0c1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAncGF0Y2gnIHx8IHdyYXBwZWQgPT09ICdhcHBseScpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHdyYXBwZWQsIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgaGVyZWRvYyBwYXRjaC10ZXh0IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS43KTogYSBgcGF0Y2hgL2BnaXQgYXBwbHlgIGhlcmVkb2NcbiAqIGJvZHkgaXMgcGF0Y2ggdGV4dC4gVGhlIG9wZW5lcidzIG93biBvcHRpb25zIHN0aWxsIGFwcGx5IFx1MjAxNCBgLS1kcnktcnVuYC9cbiAqIGAtLWNoZWNrYC9gLS1zdGF0YC9gLS1udW1zdGF0YC9gLS1zdW1tYXJ5YC9gLS1jYWNoZWRgIG1ha2UgdGhlIGJvZHlcbiAqIHJlYWQtb25seSAobm8gdG91Y2hlcyksIGAtLWRpcmVjdG9yeWAgZmFpbHMgY2xvc2VkLCBhbmQgYC1wTmAgc2V0cyB0aGVcbiAqIGhlYWRlciBzdHJpcCBsZXZlbC5cbiAqL1xuZnVuY3Rpb24gY2xhc3NpZnlQYXRjaEhlcmVkb2MoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBib2R5OiBzdHJpbmcsXG4gIGN1cnJlbnREaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBsZXQgaXNHaXRBcHBseSA9IGZhbHNlO1xuICBsZXQgYXJnczogc3RyaW5nW107XG4gIGxldCBkaXIgPSBjdXJyZW50RGlyO1xuICBpZiAoY29tbWFuZCA9PT0gJ3BhdGNoJykge1xuICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpO1xuICB9IGVsc2UgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiA9PT0gbnVsbCB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2FwcGx5JykgcmV0dXJuO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJ2FwcGx5JywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpc0dpdEFwcGx5ID0gdHJ1ZTtcbiAgICBhcmdzID0gcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gICAgZGlyID0gc3ViLmNEaXIgPz8gY3VycmVudERpcjtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcGFydHMgPSBwYXRjaEFwcGx5UGFydHMoYXJncywgaXNHaXRBcHBseSk7XG4gIGlmIChwYXJ0cy5yZWFkT25seSB8fCBwYXJ0cy5jYWNoZWRPbmx5KSByZXR1cm47XG4gIGlmIChwYXJ0cy5kaXJlY3RvcnkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnLS1kaXJlY3RvcnknLCAnLS1kaXJlY3RvcnkgcmV3cml0ZXMgcGF0Y2ggcGF0aHMnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdGFyZ2V0cyA9IHBhcnNlVW5pZmllZERpZmZSYW5nZShib2R5LCBwYXJ0cy5zdHJpcCk7XG4gIGlmICh0YXJnZXRzID09PSBudWxsKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJ2hlcmVkb2MnLCAnbWFsZm9ybWVkIG9yIGVtcHR5IHBhdGNoIHRleHQnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZm9yIChjb25zdCB0IG9mIHRhcmdldHMpIHtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHQucGF0aCwgZGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdwYXRjaC13cml0ZScsXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogdC5vcGVyYXRpb24sXG4gICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luLFxuICAgICAgICAuLi4odC5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCA/IHsgbGluZVN0YXJ0OiB0LmxpbmVTdGFydCwgbGluZUVuZDogdC5saW5lRW5kIH0gOiB7fSlcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBmb3JtYXR0ZXIgLyBmaXhlciBncmFtbWFyIChwbGFuIFx1MDBBNzUuOCk6IGEgdGFibGUtZHJpdmVuIGZhbWlseSBvdmVyIHRoZVxuLy8gY29ycHVzLWRlcml2ZWQgMTYtdG9vbCBzZXQuIEZsYWcgbWF0Y2hpbmcgaXMgZXhhY3QtdG9rZW4gb24gZnVsbCBhcmd2IHdvcmRzIFx1MjAxNFxuLy8gbmV2ZXIgcHJlZml4IG9yIHN1YnN0cmluZyBcdTIwMTQgYW5kIHRoZSByZWFkLW9ubHkgbGlzdCBpcyBjb25zdWx0ZWQgZmlyc3QsIHNvXG4vLyBgLS1maXgtZHJ5LXJ1bmAgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCBgLS1maXhgIGFuZCBgYmxhY2sgLS1jaGVja2AgbmV2ZXJcbi8vIGhlYWxzLiBUb29scyB3aG9zZSB3cml0ZSBmb3JtIGlzIGEgYmFyZSBpbnZvY2F0aW9uIChibGFjaywgaXNvcnQsIHJ1c3RmbXQpXG4vLyBjYXJyeSB0aGUgZW1wdHkgZm9ybSBhbmQgZmlyZSBvbiB0aGUgd3JpdGUgZm9ybSBpdHNlbGYuIExlYWRpbmcgdHJhbnNwYXJlbnRcbi8vIHBhY2thZ2UtcnVubmVyIHdyYXBwZXJzIChucHgsIHlhcm4sIHBucG0gZXhlYy9kbHgsIGJ1bngsIG5wbSBleGVjKSBzdHJpcFxuLy8gdW5kZXIgYSBwaW5uZWQgb3B0aW9uIGdyYW1tYXI7IGEgd3JhcHBlciB0aGF0IGNvdWxkIHJld3JpdGUgYXJndiBmYWlsc1xuLy8gY2xvc2VkIGFzIHVucmVzb2x2ZWQuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIE9uZSBcdTAwQTc1LjggdGFibGUgcm93OiB0aGUgdG9vbCBjb21tYW5kIGFuZCBpdHMgd3JpdGUvcmVhZC1vbmx5IHRva2VuIGZvcm1zLiAqL1xuZXhwb3J0IGludGVyZmFjZSBGb3JtYXR0ZXJUb29sUm93IHtcbiAgY29tbWFuZDogc3RyaW5nO1xuICAvKiogVG9rZW4gc2VxdWVuY2VzIHdob3NlIGV4YWN0LXRva2VuIHByZXNlbmNlIG1hcmtzIHRoZSBpbnZvY2F0aW9uIGEgd3JpdGUuICovXG4gIHdyaXRlRm9ybXM6IHN0cmluZ1tdW107XG4gIC8qKiBUb2tlbiBzZXF1ZW5jZXMgY29uc3VsdGVkIGZpcnN0IFx1MjAxNCBwcmVzZW5jZSBzdXBwcmVzc2VzIHRoZSB3cml0ZSAodGhlIHJlYWQtb25seSBtb2RlIHdpbnMpLiAqL1xuICByZWFkT25seUZvcm1zOiBzdHJpbmdbXVtdO1xufVxuXG4vKipcbiAqIFRoZSBcdTAwQTc1LjggdGFibGUsIGV4cG9ydGVkIHNvIHRoZSBjb3JwdXMtY292ZXJhZ2UgZml4dHVyZSBjYW4gYXNzZXJ0IHR3by1zaWRlZFxuICogdG9vbC1zZXQgZXF1YWxpdHkgYW5kIHBlci10b29sIHJlYWQtb25seSBzdXBwcmVzc2lvbiAocGxhbiBcdTAwQTc1LjgsIFBoYXNlIDNcbiAqIHN0ZXAgOCkuXG4gKi9cbmV4cG9ydCBjb25zdCBGT1JNQVRURVJfVEFCTEU6IHJlYWRvbmx5IEZvcm1hdHRlclRvb2xSb3dbXSA9IFtcbiAge1xuICAgIGNvbW1hbmQ6ICdwcmV0dGllcicsXG4gICAgd3JpdGVGb3JtczogW1snLS13cml0ZSddLCBbJy13J11dLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2snXSwgWyctLWxpc3QtZGlmZmVyZW50J10sIFsnLS1kZWJ1Zy1jaGVjayddXVxuICB9LFxuICB7IGNvbW1hbmQ6ICdlc2xpbnQnLCB3cml0ZUZvcm1zOiBbWyctLWZpeCddXSwgcmVhZE9ubHlGb3JtczogW1snLS1maXgtZHJ5LXJ1biddXSB9LFxuICB7XG4gICAgY29tbWFuZDogJ2Jpb21lJyxcbiAgICB3cml0ZUZvcm1zOiBbXG4gICAgICBbJ2NoZWNrJywgJy0td3JpdGUnXSxcbiAgICAgIFsnY2hlY2snLCAnLS1maXgnXSxcbiAgICAgIFsnZm9ybWF0JywgJy0td3JpdGUnXVxuICAgIF0sXG4gICAgcmVhZE9ubHlGb3JtczogW11cbiAgfSxcbiAgeyBjb21tYW5kOiAnZ29mbXQnLCB3cml0ZUZvcm1zOiBbWyctdyddXSwgcmVhZE9ubHlGb3JtczogW1snLWwnXV0gfSxcbiAgeyBjb21tYW5kOiAnZ29pbXBvcnRzJywgd3JpdGVGb3JtczogW1snLXcnXV0sIHJlYWRPbmx5Rm9ybXM6IFtdIH0sXG4gIHsgY29tbWFuZDogJ2NsYW5nLWZvcm1hdCcsIHdyaXRlRm9ybXM6IFtbJy1pJ11dLCByZWFkT25seUZvcm1zOiBbWyctLWRyeS1ydW4nXV0gfSxcbiAgeyBjb21tYW5kOiAnc2hmbXQnLCB3cml0ZUZvcm1zOiBbWyctdyddXSwgcmVhZE9ubHlGb3JtczogW1snLWQnXV0gfSxcbiAgeyBjb21tYW5kOiAneWFwZicsIHdyaXRlRm9ybXM6IFtbJy1pJ11dLCByZWFkT25seUZvcm1zOiBbWyctLWRpZmYnXV0gfSxcbiAgeyBjb21tYW5kOiAnYXV0b3BlcDgnLCB3cml0ZUZvcm1zOiBbWyctaSddXSwgcmVhZE9ubHlGb3JtczogW1snLWQnXSwgWyctLWRpZmYnXV0gfSxcbiAgeyBjb21tYW5kOiAnYmxhY2snLCB3cml0ZUZvcm1zOiBbW11dLCByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrJ10sIFsnLS1kaWZmJ11dIH0sXG4gIHsgY29tbWFuZDogJ2lzb3J0Jywgd3JpdGVGb3JtczogW1tdXSwgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjay1vbmx5J10sIFsnLS1kaWZmJ11dIH0sXG4gIHtcbiAgICBjb21tYW5kOiAncnVmZicsXG4gICAgd3JpdGVGb3JtczogW1snZm9ybWF0J10sIFsnY2hlY2snLCAnLS1maXgnXV0sXG4gICAgcmVhZE9ubHlGb3JtczogW1xuICAgICAgWydjaGVjaycsICctLW5vLWZpeCddLFxuICAgICAgWydmb3JtYXQnLCAnLS1jaGVjayddXG4gICAgXVxuICB9LFxuICB7IGNvbW1hbmQ6ICdkZW5vJywgd3JpdGVGb3JtczogW1snZm10J11dLCByZWFkT25seUZvcm1zOiBbWydmbXQnLCAnLS1jaGVjayddXSB9LFxuICB7IGNvbW1hbmQ6ICdkcHJpbnQnLCB3cml0ZUZvcm1zOiBbWydmbXQnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJ2NoZWNrJ11dIH0sXG4gIHsgY29tbWFuZDogJ3J1c3RmbXQnLCB3cml0ZUZvcm1zOiBbW11dLCByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrJ10sIFsnLS1lbWl0JywgJ3N0ZG91dCddXSB9LFxuICB7XG4gICAgY29tbWFuZDogJ3RlcnJhZm9ybScsXG4gICAgd3JpdGVGb3JtczogW1snZm10J11dLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtcbiAgICAgIFsnZm10JywgJy1jaGVjayddLFxuICAgICAgWydmbXQnLCAnLWRpZmYnXVxuICAgIF1cbiAgfVxuXTtcblxuLyoqIFRoZSBwaW5uZWQgcGFja2FnZS1ydW5uZXIgbm8tYXJnIGZsYWdzIChwbGFuIFx1MDBBNzUuOCk6IGZsYWdzIHRoYXQgY2Fubm90IG1vdmUgb3IgcmV3cml0ZSBhcmd2LiAqL1xuY29uc3QgUlVOTkVSX05PX0FSR19GTEFHUyA9IG5ldyBTZXQoWycteScsICctLXllcycsICctLW5vLWluc3RhbGwnXSk7XG5cbi8qKiBUaGUgb3V0Y29tZSBvZiBzdHJpcHBpbmcgb25lIGxlYWRpbmcgcGFja2FnZS1ydW5uZXIgd3JhcHBlci4gKi9cbnR5cGUgUnVubmVyU3RyaXAgPSB7IGtpbmQ6ICdzdHJpcHBlZCc7IHN0cmlwcGVkOiBzdHJpbmdbXSB9IHwgeyBraW5kOiAnb2JzY3VyZWQnIH07XG5cbi8qKlxuICogU3RyaXAgb25lIGxlYWRpbmcgdHJhbnNwYXJlbnQgcGFja2FnZS1ydW5uZXIgd3JhcHBlciAocGxhbiBcdTAwQTc1LjgpOiBgbnB4YCxcbiAqIGB5YXJuYCwgYHBucG0gZXhlY2AvYHBucG0gZGx4YCwgYGJ1bnhgLCBhbmQgYG5wbSBleGVjYCBmb2xsb3dlZCBkaXJlY3RseSBieVxuICogdGhlIHdyYXBwZWQgY29tbWFuZCB3b3JkLCB3aXRoIG9ubHkgdGhlIHBpbm5lZCBuby1hcmcgZmxhZ3MgKGAteWAvYC0teWVzYCxcbiAqIGAtLW5vLWluc3RhbGxgKSBhbmQgYG5wbSBleGVjYCdzIGAtLWAgdGVybWluYXRvciBiZXR3ZWVuLiBBIHN0cmluZy1mb3JtXG4gKiBhcmd1bWVudCAoYG5weCBcInByZXR0aWVyIC0td3JpdGUgZlwiYCksIGFuIGFyZ3YtYWx0ZXJpbmcgcnVubmVyIGZsYWdcbiAqIChgLS1wYWNrYWdlPVhgIG9yIGEgZmxhZyBjb25zdW1pbmcgdGhlIG5leHQgd29yZCksIG9yIGEgd3JhcHBlciB3b3JkIHRoYXQgaXNcbiAqIGl0c2VsZiBhIHNjcmlwdCAoYC5gLXByZWZpeGVkKSBvYnNjdXJlcyB0aGUgd3JhcHBlZCBhcmd2IFx1MjAxNCB0aGUgd3JhcHBlciBpc1xuICogdHJhbnNwYXJlbnQgb25seSB3aGVuIHRoZSBwaW5uZWQgZ3JhbW1hciBwcm92ZXMgaXQgc28uIFJldHVybnMgJ25vdC1ydW5uZXInXG4gKiB3aGVuIHRoZSB3b3JkIGlzIG5vdCBhIHJ1bm5lciBhdCBhbGwgKGEgZGlmZmVyZW50IG5wbS9wbnBtIHN1YmNvbW1hbmQsIG9yIGFcbiAqIGJhcmUgcnVubmVyIHdpdGggbm8gY29tbWFuZCB3b3JkKSBcdTIwMTQgdGhlIHRhYmxlIG1hdGNoZXMgaXQgZGlyZWN0bHksIHdoaWNoXG4gKiBmYWlscyBjbG9zZWQgZm9yIG5vbi1mb3JtYXR0ZXIgcnVubmVycy5cbiAqL1xuZnVuY3Rpb24gc3RyaXBQYWNrYWdlUnVubmVyKGFyZ3Y6IHN0cmluZ1tdKTogUnVubmVyU3RyaXAgfCAnbm90LXJ1bm5lcicge1xuICBjb25zdCBydW5uZXIgPSBhcmd2WzBdO1xuICBsZXQgcmVzdCA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmIChydW5uZXIgPT09ICducHgnIHx8IHJ1bm5lciA9PT0gJ3lhcm4nIHx8IHJ1bm5lciA9PT0gJ2J1bngnKSB7XG4gICAgLy8gVGhlc2UgcnVubmVycyB0YWtlIHRoZSBjb21tYW5kIHdvcmQgZGlyZWN0bHkuXG4gIH0gZWxzZSBpZiAocnVubmVyID09PSAncG5wbScpIHtcbiAgICBpZiAocmVzdFswXSAhPT0gJ2V4ZWMnICYmIHJlc3RbMF0gIT09ICdkbHgnKSByZXR1cm4gJ25vdC1ydW5uZXInO1xuICAgIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICB9IGVsc2UgaWYgKHJ1bm5lciA9PT0gJ25wbScpIHtcbiAgICBpZiAocmVzdFswXSAhPT0gJ2V4ZWMnKSByZXR1cm4gJ25vdC1ydW5uZXInO1xuICAgIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiAnbm90LXJ1bm5lcic7XG4gIH1cbiAgd2hpbGUgKFJVTk5FUl9OT19BUkdfRkxBR1MuaGFzKHJlc3RbMF0pKSByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgaWYgKHJ1bm5lciA9PT0gJ25wbScgJiYgcmVzdFswXSA9PT0gJy0tJykgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuICdub3QtcnVubmVyJzsgLy8gYSBiYXJlIHJ1bm5lciBhdHRyaWJ1dGVzIG5vdGhpbmdcbiAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMF07XG4gIGlmICh3cmFwcGVkLnN0YXJ0c1dpdGgoJy0nKSB8fCB3cmFwcGVkLnN0YXJ0c1dpdGgoJy4nKSB8fCAvXFxzLy50ZXN0KHdyYXBwZWQpKSByZXR1cm4geyBraW5kOiAnb2JzY3VyZWQnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdzdHJpcHBlZCcsIHN0cmlwcGVkOiByZXN0IH07XG59XG5cbi8qKlxuICogVGhlIGZvcm1hdHRlci9maXhlciBmYW1pbHkgKHBsYW4gXHUwMEE3NS44KS4gVGhlIHJlYWQtb25seSBmb3JtcyBhcmUgY29uc3VsdGVkXG4gKiBmaXJzdCBhbmQgd2luIG92ZXIgYW55IHdyaXRlIGZvcm07IGEgd3JpdGUgZm9ybSB3aXRoIG5vIHJlYWQtb25seSBmb3JtIGFuZFxuICogZXZlcnkgb3BlcmFuZCBhbiBleHBsaWNpdCBmaWxlIGVtaXRzIGEgd2hvbGUtZmlsZSBgbW9kaWZ5YCBwZXIgb3BlcmFuZDtcbiAqIGRpcmVjdG9yeS9nbG9iL25vLW9wZXJhbmQgaW52b2NhdGlvbnMgdG91Y2ggbm90aGluZzsgdW5rbm93biBleGVjdXRhYmxlc1xuICogZmFpbCBjbG9zZWQuIEEgZm9ybSdzIGxlYWRpbmcgc3ViY29tbWFuZCB3b3JkIChgY2hlY2tgL2Bmb3JtYXRgL2BmbXRgKSBpc1xuICogcG9zaXRpb25hbCBcdTIwMTQgaXQgbXVzdCBsZWFkIHRoZSB0b29sJ3MgYXJncywgc28gYGRlbm8gdGFzayBmbXRgIGlzIGEgc2NyaXB0XG4gKiBydW5uZXIsIG5vdCBhIGZvcm1hdHRlci5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hGb3JtYXR0ZXIoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBsZXQgd29yZHMgPSByZXN0O1xuICBjb25zdCBzdHJpcCA9IHN0cmlwUGFja2FnZVJ1bm5lcihyZXN0KTtcbiAgaWYgKHN0cmlwID09PSAnbm90LXJ1bm5lcicpIHtcbiAgICAvLyByZXN0WzBdIGlzIG5vdCBhIHBhY2thZ2UgcnVubmVyIFx1MjAxNCB0aGUgdGFibGUgbWF0Y2hlcyBpdCBkaXJlY3RseS5cbiAgfSBlbHNlIGlmIChzdHJpcC5raW5kID09PSAnb2JzY3VyZWQnKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ2Zvcm1hdHRlci13cml0ZScsIHJlc3RbMF0sIGB0aGUgJHtyZXN0WzBdfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSB3cmFwcGVkIGFyZ3ZgKTtcbiAgICByZXR1cm47XG4gIH0gZWxzZSB7XG4gICAgd29yZHMgPSBzdHJpcC5zdHJpcHBlZDtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMod29yZHNbMF0pKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHdvcmRzWzFdO1xuICAgIGlmICh3cmFwcGVkICE9PSB1bmRlZmluZWQgJiYgRk9STUFUVEVSX1RBQkxFLnNvbWUoKHIpID0+IHIuY29tbWFuZCA9PT0gd3JhcHBlZCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdmb3JtYXR0ZXItd3JpdGUnLCB3cmFwcGVkLCBgdGhlICR7d29yZHNbMF19IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93ID0gRk9STUFUVEVSX1RBQkxFLmZpbmQoKHIpID0+IHIuY29tbWFuZCA9PT0gd29yZHNbMF0pO1xuICBpZiAocm93ID09PSB1bmRlZmluZWQpIHJldHVybjsgLy8gdW5rbm93biBleGVjdXRhYmxlIFx1MjAxNCBmYWlsIGNsb3NlZCwgbm8gdG91Y2hcbiAgY29uc3QgYXJncyA9IHdvcmRzLnNsaWNlKDEpO1xuICBjb25zdCBmb3JtUHJlc2VudCA9IChmb3JtOiBzdHJpbmdbXSk6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IGZpcnN0ID0gZm9ybVswXTtcbiAgICBpZiAoZmlyc3QgIT09IHVuZGVmaW5lZCAmJiAhZmlyc3Quc3RhcnRzV2l0aCgnLScpICYmIGFyZ3NbMF0gIT09IGZpcnN0KSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIGZvcm0uZXZlcnkoKHRva2VuKSA9PiBhcmdzLmluY2x1ZGVzKHRva2VuKSk7XG4gIH07XG4gIC8vIFRoZSByZWFkLW9ubHkgbGlzdCBpcyBjb25zdWx0ZWQgZmlyc3QgYW5kIHdpbnMgb3ZlciBhbnkgd3JpdGUgZm9ybTpcbiAgLy8gYGVzbGludCAtLWZpeCAtLWZpeC1kcnktcnVuIGZgIHdyaXRlcyBub3RoaW5nLCBgYmxhY2sgLS1jaGVjayBmYCBuZXZlciBoZWFscy5cbiAgaWYgKHJvdy5yZWFkT25seUZvcm1zLnNvbWUoZm9ybVByZXNlbnQpKSByZXR1cm47XG4gIGlmICghcm93LndyaXRlRm9ybXMuc29tZShmb3JtUHJlc2VudCkpIHJldHVybjsgLy8gYmFyZSBpbnZvY2F0aW9ucyBvZiBmbGFnLXJlcXVpcmVkIHRvb2xzIGFyZSByZWFkLW9ubHkgKHN0ZG91dC9saW50KVxuICAvLyBDb25zdW1lIHRoZSB0b29sJ3Mgc3ViY29tbWFuZCB3b3JkIGJlZm9yZSBjb2xsZWN0aW5nIG9wZXJhbmRzLlxuICBjb25zdCBzdWJjb21tYW5kV29yZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBmb3JtIG9mIHJvdy53cml0ZUZvcm1zKSB7XG4gICAgZm9yIChjb25zdCB0b2tlbiBvZiBmb3JtKSB7XG4gICAgICBpZiAoIXRva2VuLnN0YXJ0c1dpdGgoJy0nKSkgc3ViY29tbWFuZFdvcmRzLmFkZCh0b2tlbik7XG4gICAgfVxuICB9XG4gIGNvbnN0IGFmdGVyU3ViY29tbWFuZCA9IHN1YmNvbW1hbmRXb3Jkcy5oYXMoYXJnc1swXSkgPyBhcmdzLnNsaWNlKDEpIDogYXJncztcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgYSBvZiBhZnRlclN1YmNvbW1hbmQpIHtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChzaGFyZWQgXHUwMEE3NSlcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIGlmIChvcGVyYW5kcy5sZW5ndGggPT09IDApIHJldHVybjsgLy8gbm8tb3BlcmFuZCBpbnZvY2F0aW9ucyB0b3VjaCBub3RoaW5nXG4gIC8vIEV2ZXJ5IG9wZXJhbmQgbXVzdCBiZSBhbiBleHBsaWNpdCBmaWxlIFx1MjAxNCBhIGdsb2IsIHZhcmlhYmxlLCBkaXJlY3RvcnksIG9yXG4gIC8vIHRyYWlsaW5nLXNsYXNoIG9wZXJhbmQgZmFpbHMgdGhlIHdob2xlIGNvbW1hbmQgY2xvc2VkLlxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdmb3JtYXR0ZXItd3JpdGUnLCBvcGVyYW5kLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKG9wZXJhbmQuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpckZvclJlc29sdXRpb24sIG9wZXJhbmQpKSkgcmV0dXJuO1xuICB9XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ2Zvcm1hdHRlci13cml0ZScsXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ21vZGlmeScsIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZGlyRm9yUmVzb2x1dGlvbiwgb3BlcmFuZCksIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgZ2l0IHJlc3RvcmUgLyBnaXQgY2hlY2tvdXQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjkpLCB0aGUgbGFzdCBwdXJlLXBhcnNlclxuLy8gZmFtaWx5LiBSZXN0b3JlIGhhcyBubyByZXZpc2lvbiBvcGVyYW5kIGZvcm0gXHUyMDE0IGl0cyBwb3NpdGlvbmFsIGFyZ3MgYXJlXG4vLyBhbHdheXMgcGF0aHNwZWNzOyBjaGVja291dCBza2lwcyBhIHByZS1gLS1gIHJldmlzaW9uL3JlZiBvcGVyYW5kIGFuZCB0YWtlc1xuLy8gcGF0aHNwZWNzIG9ubHkgYWZ0ZXIgYC0tYC4gRXZlcnkgZXhwbGljaXQtZmlsZSBwYXRoc3BlYyBpcyBhIHdob2xlLWZpbGVcbi8vIGNyZWF0ZS1vdmVyd3JpdGUgdG91Y2g7IGEgZGlyZWN0b3J5LXNoYXBlZCBwYXRoc3BlYyAoYC5gL2AuLmAsIHRyYWlsaW5nIGAvYCxcbi8vIG9yIGEgcGF0aCB0aGF0IHN0YXRzIGFzIGEgZGlyZWN0b3J5KSwgYC0tc3RhZ2VkYC1vbmx5IHJlc3RvcmUsIGFuZFxuLy8gYC1wYC9gLS1wYXRjaGAgaW50ZXJhY3RpdmUgaHVuayBzZWxlY3Rpb24gYWxsIGZhaWwgY2xvc2VkLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBnaXQgcmVzdG9yZSBuby12YWx1ZSBmbGFncyAocGxhbiBcdTAwQTc1LjkpOyBgLXNgL2AtLXNvdXJjZWAsIGAtLXN0YWdlZGAsIGAtV2AvYC0td29ya3RyZWVgLCBgLW1gL2AtLW1lcmdlYCwgYW5kIGAtcGAvYC0tcGF0Y2hgIGFyZSBoYW5kbGVkIGV4cGxpY2l0bHkuICovXG5jb25zdCBSRVNUT1JFX05PX1ZBTFVFID0gbmV3IFNldChbJy1xJywgJy1mJywgJy11J10pO1xuXG4vKipcbiAqIFRoZSBzaGFyZWQgcmVzdG9yZS9jaGVja291dCBwYXRoc3BlYyBlbWlzc2lvbiAocGxhbiBcdTAwQTc1LjkpOiBhbiBleHBsaWNpdC1maWxlXG4gKiBwYXRoc3BlYyAobm8gZ2xvYnMsIG5vIGAuYC9gLi5gLCBubyBkaXJlY3RvcnksIG5vIHRyYWlsaW5nIGAvYCkgaXMgYVxuICogY3JlYXRlLW92ZXJ3cml0ZSB3aG9sZS1maWxlIHRvdWNoOyBhIGRpcmVjdG9yeS1zaGFwZWQgcGF0aHNwZWMgaXNcbiAqIHVucmVzb2x2ZWQgXHUyMDE0IGEgZGlyZWN0b3J5IHJlc3RvcmUvY2hlY2tvdXQgcmV3cml0ZXMgYXJiaXRyYXJ5IGZpbGVzIGJlbmVhdGhcbiAqIGl0IGFuZCBjYW5ub3QgYmUgYXR0cmlidXRlZCB0byBhIGZpbGUgd3JpdGUuXG4gKi9cbmZ1bmN0aW9uIGVtaXRSZXN0b3JlQ2hlY2tvdXRQYXRoc3BlYyhcbiAgcmVzdWx0czogU3Bhbk1hdGNoW10sXG4gIGlkaW9tOiAnZ2l0LXJlc3RvcmUtd3JpdGUnIHwgJ2dpdC1jaGVja291dC13cml0ZScsXG4gIG9wZXJhbmQ6IHN0cmluZyxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXVxuKTogdm9pZCB7XG4gIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIGlkaW9tLCBvcGVyYW5kLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kKTtcbiAgaWYgKG9wZXJhbmQgPT09ICcuJyB8fCBvcGVyYW5kID09PSAnLi4nIHx8IG9wZXJhbmQuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KGFic29sdXRlUGF0aCkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgIHJlc3VsdHMsXG4gICAgICBpZGlvbSxcbiAgICAgIG9wZXJhbmQsXG4gICAgICAnZGlyZWN0b3J5LXNoYXBlZCBwYXRoc3BlYyByZXdyaXRlcyBhcmJpdHJhcnkgZmlsZXMgYmVuZWF0aCBpdCBcdTIwMTQgbm90IGF0dHJpYnV0YWJsZSB0byBhIGZpbGUgd3JpdGUnXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcmVzdWx0cy5wdXNoKHtcbiAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgaWRpb20sXG4gICAgc3BhbjogeyBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICB9KTtcbn1cblxuLyoqXG4gKiBUaGUgZ2l0IHJlc3RvcmUgb3BlcmFuZCBncmFtbWFyIChwbGFuIFx1MDBBNzUuOSk6IGAtc2AvYC0tc291cmNlPTx0cmVlPmAgaXNcbiAqIHZhbHVlLXRha2luZyBcdTIwMTQgdGhlIHRyZWUgb3BlcmFuZCBuZXZlciByZXNvbHZlcyBhcyBhIHBhdGhzcGVjOyBgLXBgL2AtLXBhdGNoYFxuICogaW50ZXJhY3RpdmUgaHVuayBzZWxlY3Rpb24gaXMgdW5yZXNvbHZlZDsgYC1tYC9gLS1tZXJnZWAgKHRoZSBtZXJnZVxuICogbWFjaGluZXJ5LCBjb25kaXRpb25hbCBvbiB0aGUgaW5kZXggYmVpbmcgdW5tZXJnZWQpIGFuZCBgLS1zdGFnZWRgIHdpdGhvdXRcbiAqIGAtLXdvcmt0cmVlYCAoaW5kZXgtb25seSBcdTIwMTQgdGhlIHdvcmtpbmcgZmlsZSBzdXJ2aXZlcykgdG91Y2ggbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSZXN0b3JlT3BlcmFuZHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBzdGFnZWQgPSBmYWxzZTtcbiAgbGV0IHdvcmt0cmVlID0gZmFsc2U7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcCcgfHwgYSA9PT0gJy0tcGF0Y2gnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgJ2dpdC1yZXN0b3JlLXdyaXRlJyxcbiAgICAgICAgYSxcbiAgICAgICAgJ2ludGVyYWN0aXZlIHBhdGNoIG1vZGUgYXBwbGllcyB1c2VyLWNob3NlbiBodW5rcyBcdTIwMTQgbm8gc3RhdGljIHNwYW4nXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1zJyB8fCBhID09PSAnLS1zb3VyY2UnKSB7XG4gICAgICBpICs9IDE7IC8vIHRoZSB0cmVlIG9wZXJhbmQgaXMgbmV2ZXIgYSBwYXRoc3BlY1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tc291cmNlPScpKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1tJyB8fCBhID09PSAnLS1tZXJnZScpIHJldHVybjtcbiAgICBpZiAoYSA9PT0gJy0tc3RhZ2VkJykge1xuICAgICAgc3RhZ2VkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1XJyB8fCBhID09PSAnLS13b3JrdHJlZScpIHtcbiAgICAgIHdvcmt0cmVlID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoUkVTVE9SRV9OT19WQUxVRS5oYXMoYSkpIGNvbnRpbnVlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvbiAoZmFpbCBjbG9zZWQpXG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICBpZiAoc3RhZ2VkICYmICF3b3JrdHJlZSkgcmV0dXJuOyAvLyBpbmRleC1vbmx5IHJlc3RvcmUgZG9lcyBub3QgdG91Y2ggdGhlIHdvcmtpbmcgZmlsZVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBlbWl0UmVzdG9yZUNoZWNrb3V0UGF0aHNwZWMocmVzdWx0cywgJ2dpdC1yZXN0b3JlLXdyaXRlJywgb3BlcmFuZCwgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGdpdCBjaGVja291dCBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS45KTogYC1iYC9gLUJgL2AtLW9ycGhhbiA8YnJhbmNoPmBcbiAqIGFyZSB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZSBicmFuY2ggbmFtZSBuZXZlciByZXNvbHZlcyBhcyBhIHBhdGhzcGVjOyBgLXBgL1xuICogYC0tcGF0Y2hgIGludGVyYWN0aXZlIGh1bmsgc2VsZWN0aW9uIGlzIHVucmVzb2x2ZWQ7IGEgcHJlLWAtLWAgcG9zaXRpb25hbCBpc1xuICogYSByZXZpc2lvbi9yZWYgb3BlcmFuZCBhbmQgaXMgc2tpcHBlZC4gUGF0aHNwZWNzIG9ubHkgYWZ0ZXIgYC0tYC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hDaGVja291dE9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXAnIHx8IGEgPT09ICctLXBhdGNoJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICAgICAgICBhLFxuICAgICAgICAnaW50ZXJhY3RpdmUgcGF0Y2ggbW9kZSBhcHBsaWVzIHVzZXItY2hvc2VuIGh1bmtzIFx1MjAxNCBubyBzdGF0aWMgc3BhbidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChhID09PSAnLWInIHx8IGEgPT09ICctQicgfHwgYSA9PT0gJy0tb3JwaGFuJykge1xuICAgICAgaSArPSAxOyAvLyB0aGUgYnJhbmNoIG5hbWUgaXMgbmV2ZXIgYSBwYXRoc3BlY1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWYnIHx8IGEgPT09ICctcScgfHwgYSA9PT0gJy1tJyB8fCBhID09PSAnLXQnKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb24gKGZhaWwgY2xvc2VkKVxuICAgIC8vIEEgcHJlLWAtLWAgcG9zaXRpb25hbCBpcyBhIHJldmlzaW9uL3JlZiBvcGVyYW5kIFx1MjAxNCBuZXZlciBhIHBhdGhzcGVjLlxuICB9XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGVtaXRSZXN0b3JlQ2hlY2tvdXRQYXRoc3BlYyhyZXN1bHRzLCAnZ2l0LWNoZWNrb3V0LXdyaXRlJywgb3BlcmFuZCwgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGdpdCByZXN0b3JlIC8gZ2l0IGNoZWNrb3V0IGZhbWlseSAocGxhbiBcdTAwQTc1LjkpOiB2aWEgYGZpbmRHaXRTdWJjb21tYW5kYFxuICogKGhhbmRsZXMgYGdpdCAtQ2AvYC1jYCksIHRoZSB0d28gc3ViY29tbWFuZHMgcmVzb2x2ZSB0aGVpciBwYXRoc3BlY3MgdG9cbiAqIHdob2xlLWZpbGUgY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaGVzOyBhIHdyYXBwZWQgc3ViY29tbWFuZCBmYWlscyBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoR2l0UmVzdG9yZUNoZWNrb3V0KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgPT09IG51bGwgfHwgKHN1Yi5zdWJjb21tYW5kICE9PSAncmVzdG9yZScgJiYgc3ViLnN1YmNvbW1hbmQgIT09ICdjaGVja291dCcpKSByZXR1cm47XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgc3ViLnN1YmNvbW1hbmQgPT09ICdyZXN0b3JlJyA/ICdnaXQtcmVzdG9yZS13cml0ZScgOiAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgICAgICAgc3ViLnN1YmNvbW1hbmQsXG4gICAgICAgICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBkaXIgPSBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uO1xuICAgIGNvbnN0IGFyZ3MgPSByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgICBpZiAoc3ViLnN1YmNvbW1hbmQgPT09ICdyZXN0b3JlJykgbWF0Y2hSZXN0b3JlT3BlcmFuZHMoYXJncywgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIGVsc2UgbWF0Y2hDaGVja291dE9wZXJhbmRzKGFyZ3MsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgaWYgKHdyYXBwZWQgPT09ICdyZXN0b3JlJyB8fCB3cmFwcGVkID09PSAnY2hlY2tvdXQnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgd3JhcHBlZCA9PT0gJ3Jlc3RvcmUnID8gJ2dpdC1yZXN0b3JlLXdyaXRlJyA6ICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICAgICAgICB3cmFwcGVkLFxuICAgICAgICBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcmNoZXN0cmF0b3Jcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBMSU5FX1NFTEVDVE9SUyA9IFttYXRjaFNlZCwgbWF0Y2hIZWFkLCBtYXRjaFRhaWxdO1xuXG4vKipcbiAqIFNwYW4tbGVzcyBjb21tYW5kcyB3aG9zZSBleGl0IHN0YXR1cyBpcyBkZXRlcm1pbmlzdGljIFx1MjAxNCB1c2FibGUgYXMgZ3VhcmRzIGluXG4gKiBgJiZgL2B8fGAgam9pbnMgKHBsYW4gXHUwMEE3MyBzdGVwIDIncyBzcGFuLWxlc3MtZ3VhcmQgcnVsZSk6IGBmYWxzZWAgYWx3YXlzXG4gKiBleGl0cyAxLCBgdHJ1ZWAgYW5kIGA6YCBhbHdheXMgMCwgc28gYSBmb2xsb3dpbmcgam9pbmVkIGNvbW1hbmQncyBza2lwIGlzXG4gKiBrbm93YWJsZSBldmVuIHRob3VnaCBuZWl0aGVyIHByb2R1Y2VzIGEgc3Bhbi5cbiAqL1xuY29uc3QgQlVJTFRJTl9HVUFSRF9TVEFUVVMgPSBuZXcgTWFwPHN0cmluZywgMCB8IDE+KFtcbiAgWydmYWxzZScsIDFdLFxuICBbJ3RydWUnLCAwXSxcbiAgWyc6JywgMF1cbl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZDogc3RyaW5nLCBjd2Q6IHN0cmluZyA9IHByb2Nlc3MuY3dkKCkpOiBTcGFuTWF0Y2hbXSB7XG4gIGNvbnN0IHsgd3JpdGVzOiBoZXJlZG9jV3JpdGVzLCBtYXNrZWQgfSA9IGV4dHJhY3RIZXJlZG9jV3JpdGVzKGNvbW1hbmQpO1xuICBjb25zdCBzaW1wbGVDb21tYW5kcyA9IHNwbGl0VG9wTGV2ZWwobWFza2VkKTtcblxuICBjb25zdCByZXN1bHRzOiBTcGFuTWF0Y2hbXSA9IFtdO1xuICBjb25zdCBmc0xpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuICBjb25zdCBnaXRMaW5lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyIHwgbnVsbD4oKTtcblxuICBjb25zdCBjYWNoZWRGc1RvdGFsTGluZXMgPSAoYWJzUGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgaWYgKCFmc0xpbmVDYWNoZS5oYXMoYWJzUGF0aCkpIGZzTGluZUNhY2hlLnNldChhYnNQYXRoLCBjb3VudEZpbGVMaW5lcyhhYnNQYXRoKSk7XG4gICAgcmV0dXJuIGZzTGluZUNhY2hlLmdldChhYnNQYXRoKSA/PyBudWxsO1xuICB9O1xuICBjb25zdCBjYWNoZWRHaXRUb3RhbExpbmVzID0gKGdpdEN3ZDogc3RyaW5nLCByZXY6IHN0cmluZywgcGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gYCR7Z2l0Q3dkfVx1MDAwMCR7cmV2fVx1MDAwMCR7cGF0aH1gO1xuICAgIGlmICghZ2l0TGluZUNhY2hlLmhhcyhrZXkpKSBnaXRMaW5lQ2FjaGUuc2V0KGtleSwgY291bnRHaXRCbG9iTGluZXMoZ2l0Q3dkLCByZXYsIHBhdGgpKTtcbiAgICByZXR1cm4gZ2l0TGluZUNhY2hlLmdldChrZXkpID8/IG51bGw7XG4gIH07XG5cbiAgbGV0IGN1cnJlbnREaXIgPSBjd2Q7XG4gIGxldCBsYXN0UGxhaW5GaWxlU291cmNlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgLy8gVGhlIG9uZS1ob3AgbGl0ZXJhbCBlY2hvL3ByaW50ZiBwaXBlIHNvdXJjZSAocGxhbiBcdTAwQTc1LjIpOiBzZXQgYXQgdGhlIGVuZCBvZlxuICAvLyBlYWNoIHNpbXBsZSBjb21tYW5kLCBjbGVhcmVkIGF0IGFueSBub24tcGlwZSBib3VuZGFyeSwgdGhyZWFkZWQgYnkgdGVlIC1hXG4gIC8vIGFwcGVuZHMgaW4gdGhlIG5leHQgcGlwZSBzdGFnZSAoYGVjaG8geCB8IHRlZSAtYSBmYCkuXG4gIGxldCBwaXBlRWNob0NvbnRlbnQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuXG4gIC8qKiBUaGUgYGpvaW5gIHN0YW1wIGZvciBhIHNpbXBsZSBjb21tYW5kOiBvbmx5IHRoZSBjb25kaXRpb25hbCBvcGVyYXRvcnMgZ2F0ZSAocGxhbiBcdTAwQTczIHN0ZXAgMikuICovXG4gIGNvbnN0IGpvaW5PZiA9IChzaW1wbGU6IFNpbXBsZUNvbW1hbmQpOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSA9PlxuICAgIHNpbXBsZS5wcmVjZWRlZEJ5ID09PSAnJiYnIHx8IHNpbXBsZS5wcmVjZWRlZEJ5ID09PSAnfHwnID8gc2ltcGxlLnByZWNlZGVkQnkgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgZW1pdENhbmRpZGF0ZSA9IChcbiAgICBjOiBSYXdDYW5kaWRhdGUsXG4gICAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICAgIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICAgIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddXG4gICkgPT4ge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShjLmZpbGVBcmcpKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGMuZmlsZUFyZyxcbiAgICAgICAgcmVhc29uOiAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoZGlyRm9yUmVzb2x1dGlvbiwgYy5maWxlQXJnKTtcbiAgICBjb25zdCB0b3RhbExpbmVzID1cbiAgICAgIGMucmVzb2x2ZXJLaW5kID09PSAnZnMnXG4gICAgICAgID8gY2FjaGVkRnNUb3RhbExpbmVzKGFic29sdXRlUGF0aClcbiAgICAgICAgOiBjYWNoZWRHaXRUb3RhbExpbmVzKGMuZGlyT3ZlcnJpZGUgPz8gZGlyRm9yUmVzb2x1dGlvbiwgYy5yZXNvbHZlcktpbmQucmV2LCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoYy5zcGVjLCB0b3RhbExpbmVzKTtcbiAgICBpZiAocmFuZ2UgPT09IG51bGwpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYWJzb2x1dGVQYXRoLFxuICAgICAgICByZWFzb246ICdjb3VsZCBub3QgZGV0ZXJtaW5lIGVuZC1vZi1maWxlIGxpbmUgY291bnQgKGZpbGUgdW5yZWFkYWJsZSwgZW1wdHksIG9yIGdpdCByZXYvcGF0aCBub3QgZm91bmQpJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgIHNwYW46IHtcbiAgICAgICAgb3BlcmF0aW9uOiAncmVhZCcsXG4gICAgICAgIGxpbmVTdGFydDogcmFuZ2UubGluZVN0YXJ0LFxuICAgICAgICBsaW5lRW5kOiByYW5nZS5saW5lRW5kLFxuICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pblxuICAgICAgfVxuICAgIH0pO1xuICB9O1xuXG4gIC8qKlxuICAgKiBUaGUgcmVhZCBpZGlvbXMgZm9yIG9uZSBzaW1wbGUgY29tbWFuZCAodGhlIGV4aXN0aW5nIGNvcnB1cyBncmFtbWFyKTpcbiAgICogcGxhaW4gYGNhdGAvYG5sYCBzb3VyY2VzLCB0aGUgbGluZSBzZWxlY3RvcnMsIGFuZCB0aGUgZ2l0IG1hdGNoZXJzLCB3aXRoXG4gICAqIG9uZS1ob3AgcGlwZS1zb3VyY2UgcHJvcGFnYXRpb24gZm9yIGRvd25zdHJlYW0gYGhlYWRgL2B0YWlsYC9gc2VkIC1uYC5cbiAgICovXG4gIGNvbnN0IG1hdGNoUmVhZHMgPSAoc2ltcGxlOiBTaW1wbGVDb21tYW5kLCBhcmd2OiBzdHJpbmdbXSwgaTogbnVtYmVyKTogdm9pZCA9PiB7XG4gICAgbGV0IGlzUGxhaW5Tb3VyY2UgPSBmYWxzZTtcbiAgICBsZXQgcGxhaW5GaWxlQXJnOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICBpZiAoYXJndlswXSA9PT0gJ2NhdCcgJiYgYXJndi5sZW5ndGggPT09IDIgJiYgIWFyZ3ZbMV0uc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgIHBsYWluRmlsZUFyZyA9IGFyZ3ZbMV07XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gaGFzU2hlbGxFeHBhbnNpb24oYXJndlsxXSkgPyBudWxsIDogcmVzb2x2ZVBhdGgoY3VycmVudERpciwgYXJndlsxXSk7XG4gICAgfSBlbHNlIGlmIChhcmd2WzBdID09PSAnbmwnICYmIGFyZ3YubGVuZ3RoID49IDIgJiYgIWFyZ3ZbYXJndi5sZW5ndGggLSAxXS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGlzUGxhaW5Tb3VyY2UgPSB0cnVlO1xuICAgICAgY29uc3QgZiA9IGFyZ3ZbYXJndi5sZW5ndGggLSAxXTtcbiAgICAgIHBsYWluRmlsZUFyZyA9IGY7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gaGFzU2hlbGxFeHBhbnNpb24oZikgPyBudWxsIDogcmVzb2x2ZVBhdGgoY3VycmVudERpciwgZik7XG4gICAgfVxuXG4gICAgLy8gQSBiYXJlIGBjYXQgZmlsZWAvYG5sIGZpbGVgIHRoYXQgaXMgbm90IGZlZWRpbmcgYSBkb3duc3RyZWFtIHBpcGUgc3RhZ2VcbiAgICAvLyByZWFkcyB0aGUgd2hvbGUgZmlsZTogZW1pdCB0aGUgc2FtZSB3aG9sZS1maWxlIHNwYW4gYGdpdCBzaG93IHJldjpwYXRoYFxuICAgIC8vIHByb2R1Y2VzLiBXaGVuIGEgcGlwZSBmb2xsb3dzLCB0aGUgZG93bnN0cmVhbSBsaW5lLXNlbGVjdG9yIGFscmVhZHlcbiAgICAvLyBlbWl0cyB0aGUgcHJlY2lzZSByYW5nZSwgc28gdGhlIHNvdXJjZSBzdGF5cyBzb3VyY2Utb25seS5cbiAgICBpZiAocGxhaW5GaWxlQXJnICE9PSBudWxsKSB7XG4gICAgICBjb25zdCBuZXh0ID0gc2ltcGxlQ29tbWFuZHNbaSArIDFdO1xuICAgICAgaWYgKG5leHQgPT09IHVuZGVmaW5lZCB8fCBuZXh0LnByZWNlZGVkQnkgIT09ICd8Jykge1xuICAgICAgICBlbWl0Q2FuZGlkYXRlKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgICAgICAgaWRpb206IGFyZ3ZbMF0gPT09ICdjYXQnID8gJ2NhdC1maWxlJyA6ICdubC1maWxlJyxcbiAgICAgICAgICAgIGZpbGVBcmc6IHBsYWluRmlsZUFyZyxcbiAgICAgICAgICAgIHNwZWM6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSxcbiAgICAgICAgICAgIHJlc29sdmVyS2luZDogJ2ZzJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgY3VycmVudERpcixcbiAgICAgICAgICBpLFxuICAgICAgICAgIGpvaW5PZihzaW1wbGUpXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgWy4uLkxJTkVfU0VMRUNUT1JTLCBtYXRjaEdpdFNob3csIG1hdGNoR2l0TG9nTF0pIHtcbiAgICAgIGZvciAoY29uc3Qgb3V0Y29tZSBvZiBtYXRjaGVyKGFyZ3YpKSB7XG4gICAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgICAgICBpZiAob3V0Y29tZS5raW5kID09PSAndW5yZXNvbHZlZCcpIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgICBpZGlvbTogb3V0Y29tZS5pZGlvbSxcbiAgICAgICAgICAgIGZpbGVBcmc6IG91dGNvbWUuZmlsZUFyZyxcbiAgICAgICAgICAgIHJlYXNvbjogb3V0Y29tZS5yZWFzb25cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlbWl0Q2FuZGlkYXRlKG91dGNvbWUsIG91dGNvbWUuZGlyT3ZlcnJpZGUgPz8gY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSkpO1xuICAgICAgICAgIC8vIGBnaXQgc2hvdyByZXY6cGF0aGAgcHJpbnRzIHRoZSBibG9iIHZlcmJhdGltLCBzbyAodW5saWtlIGBnaXQgbG9nIC1MYCxcbiAgICAgICAgICAvLyB3aGljaCBwcmludHMgZGlmZi1mb3JtYXR0ZWQgaGlzdG9yeSkgaXQncyBhIHZhbGlkIG9uZS1ob3AgcGlwZSBzb3VyY2VcbiAgICAgICAgICAvLyBmb3IgYSBkb3duc3RyZWFtIGxpbmUtc2VsZWN0b3IsIHNhbWUgYXMgYGNhdGAvYG5sYC5cbiAgICAgICAgICBpZiAob3V0Y29tZS5pZGlvbSA9PT0gJ2dpdC1zaG93LXJldi1wYXRoJyAmJiAhbG9va3NVbnJlc29sdmFibGUob3V0Y29tZS5maWxlQXJnKSkge1xuICAgICAgICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICAgICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gcmVzb2x2ZVBhdGgob3V0Y29tZS5kaXJPdmVycmlkZSA/PyBjdXJyZW50RGlyLCBvdXRjb21lLmZpbGVBcmcpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghbWF0Y2hlZCAmJiBzaW1wbGUucHJlY2VkZWRCeSA9PT0gJ3wnICYmIGxhc3RQbGFpbkZpbGVTb3VyY2UpIHtcbiAgICAgIGNvbnN0IHdpdGhGaWxlID0gWy4uLmFyZ3YsIGxhc3RQbGFpbkZpbGVTb3VyY2VdO1xuICAgICAgZm9yIChjb25zdCBtYXRjaGVyIG9mIExJTkVfU0VMRUNUT1JTKSB7XG4gICAgICAgIGZvciAoY29uc3Qgb3V0Y29tZSBvZiBtYXRjaGVyKHdpdGhGaWxlKSkge1xuICAgICAgICAgIGlmIChvdXRjb21lLmtpbmQgPT09ICdjYW5kaWRhdGUnKSBlbWl0Q2FuZGlkYXRlKG91dGNvbWUsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpKTtcbiAgICAgICAgICBlbHNlXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgICAgaWRpb206IG91dGNvbWUuaWRpb20sXG4gICAgICAgICAgICAgIGZpbGVBcmc6IG91dGNvbWUuZmlsZUFyZyxcbiAgICAgICAgICAgICAgcmVhc29uOiBvdXRjb21lLnJlYXNvblxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzUGxhaW5Tb3VyY2UpIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICB9O1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2ltcGxlQ29tbWFuZHMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBzaW1wbGUgPSBzaW1wbGVDb21tYW5kc1tpXTtcblxuICAgIC8vIEEgcGlwZSBzdGFnZSBtYXkgaW5oZXJpdCB0aGUgcHJldmlvdXMgc3RhZ2UncyBsaXRlcmFsIGVjaG8gY29udGVudDsgYW55XG4gICAgLy8gb3RoZXIgYm91bmRhcnkgY2xlYXJzIGl0LlxuICAgIGlmIChzaW1wbGUucHJlY2VkZWRCeSAhPT0gJ3wnKSBwaXBlRWNob0NvbnRlbnQgPSBudWxsO1xuXG4gICAgY29uc3QgaGVyZWRvY1JlZiA9IHNpbXBsZS50ZXh0Lm1hdGNoKC9eX19oZXJlZG9jXyhcXGQrKV9fJC8pO1xuICAgIGlmIChoZXJlZG9jUmVmKSB7XG4gICAgICBjb25zdCB3ID0gaGVyZWRvY1dyaXRlc1tOdW1iZXIucGFyc2VJbnQoaGVyZWRvY1JlZlsxXSwgMTApXTtcbiAgICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHcub3BlbmVyKS50cmltKCkpO1xuICAgICAgaWYgKHRva2VucyA9PT0gbnVsbCkge1xuICAgICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBvcGVuZXJBcmd2ID0gYW5hbHl6ZVRva2Vucyh0b2tlbnMpLmFyZ3Y7XG4gICAgICBtYXRjaFJlYWRzKHNpbXBsZSwgb3BlbmVyQXJndiwgaSk7XG4gICAgICBjbGFzc2lmeUhlcmVkb2NPcGVuZXIody5vcGVuZXIsIHcuYm9keSwgdy5xdW90ZWREZWxpbSwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgICAgcGlwZUVjaG9Db250ZW50ID0gbGl0ZXJhbENvbnRlbnQob3BlbmVyQXJndikgPz8gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZS50ZXh0KS50cmltKCkpO1xuICAgIGlmICh0b2tlbnMgPT09IG51bGwpIHtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHsgYXJndiwgcmVkaXJlY3RzIH0gPSBhbmFseXplVG9rZW5zKHRva2Vucyk7XG4gICAgaWYgKGFyZ3YubGVuZ3RoID09PSAwKSB7XG4gICAgICAvLyBCYXJlIGA+IGZgIC8gYDogPiBmYDogbm8gYXJndiwgYnV0IHRoZSB0cnVuY2F0aW9uIGdyYW1tYXIgc3RpbGwgZmlyZXMuXG4gICAgICBtYXRjaFJlZGlyZWN0RmFtaWx5KGFyZ3YsIHJlZGlyZWN0cywgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChhcmd2WzBdID09PSAnY2QnKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnN0IHRhcmdldCA9IGFyZ3ZbMV07XG4gICAgICBpZiAodGFyZ2V0ICE9PSB1bmRlZmluZWQgJiYgdGFyZ2V0ICE9PSAnLScgJiYgIWhhc1NoZWxsRXhwYW5zaW9uKHRhcmdldCkpIHtcbiAgICAgICAgY3VycmVudERpciA9IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIHRhcmdldCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBiZWZvcmUgPSByZXN1bHRzLmxlbmd0aDtcbiAgICBtYXRjaFJlYWRzKHNpbXBsZSwgYXJndiwgaSk7XG4gICAgbWF0Y2hSZWRpcmVjdEZhbWlseShhcmd2LCByZWRpcmVjdHMsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoQ29weU1vdmVGYW1pbHkoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoUm1UcnVuY2F0ZShhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hTZWRJbnBsYWNlKGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaFBhdGNoQXBwbHkoYXJndiwgcmVkaXJlY3RzLCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hGb3JtYXR0ZXIoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoR2l0UmVzdG9yZUNoZWNrb3V0KGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPT09IGJlZm9yZSkge1xuICAgICAgLy8gTm8gc3BhbiBmb3IgdGhpcyBjb21tYW5kOiBhIGRldGVybWluaXN0aWMgYnVpbHRpbiBpcyBzdGlsbCBhIHVzYWJsZVxuICAgICAgLy8gam9pbiBndWFyZCAoYGZhbHNlICYmIGVjaG8geCA+IGZgIG11c3Qgc2tpcCB0aGUgZWNobykuIEFueSBvdGhlclxuICAgICAgLy8gY29tbWFuZCBzdGF5cyBzcGFuLWxlc3MgYW5kIHVua25vd2FibGUgXHUyMDE0IHRoZSBkcml2ZXIgZmFpbHMgb3Blbi5cbiAgICAgIGNvbnN0IHN0YXR1cyA9IEJVSUxUSU5fR1VBUkRfU1RBVFVTLmdldChhcmd2WzBdKTtcbiAgICAgIGlmIChzdGF0dXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ2J1aWx0aW4tZ3VhcmQnLFxuICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleDogaSxcbiAgICAgICAgICBqb2luOiBqb2luT2Yoc2ltcGxlKSxcbiAgICAgICAgICBleGl0U3RhdHVzOiBzdGF0dXNcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIHBpcGVFY2hvQ29udGVudCA9IGxpdGVyYWxDb250ZW50KGFyZ3YpID8/IG51bGw7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0cztcbn1cblxuLyoqIFBhcnNlcyBhIEJhc2ggYGNvbW1hbmRgIHN0cmluZyBpbnRvIHRoZSBmaWxlK2xpbmUtcmFuZ2Ugc3BhbnMgaXQgc3RhdGljYWxseSwgcmVsaWFibHkgcmVhZHMgb3Igd3JpdGVzLiBgY3dkYCBkZWZhdWx0cyB0byBgcHJvY2Vzcy5jd2QoKWAgXHUyMDE0IHBhc3MgdGhlIGhvb2sncyBvd24gYGN3ZGAgZmllbGQgZm9yIGNvcnJlY3QgcmVzb2x1dGlvbiBvZiByZWxhdGl2ZSBwYXRocyBhbmQgYGNkYC9gZ2l0IC1DYCB0YXJnZXRzLCBhbmQgb2YgYGdpdCBzaG93YC9gZ2l0IGxvZyAtTGAgcmV2aXNpb25zLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tbWFuZChjb21tYW5kOiBzdHJpbmcsIGN3ZDogc3RyaW5nID0gcHJvY2Vzcy5jd2QoKSk6IFJlc29sdmVkU3BhbltdIHtcbiAgY29uc3QgZGV0YWlsZWQgPSBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kLCBjd2QpO1xuICBjb25zdCBzcGFuczogUmVzb2x2ZWRTcGFuW10gPSBbXTtcbiAgZm9yIChjb25zdCBtIG9mIGRldGFpbGVkKSB7XG4gICAgaWYgKG0uc3RhdHVzID09PSAncmVzb2x2ZWQnKSBzcGFucy5wdXNoKG0uc3Bhbik7XG4gIH1cbiAgcmV0dXJuIHNwYW5zO1xufVxuIiwgIi8qKlxuICogVGhlIG9ubHkgaW1wdXJlIGJpdHM6IGNvdW50aW5nIGxpbmVzIG9mIGEgd29ya2luZy10cmVlIGZpbGUsIGFuZCBvZiBhIGZpbGVcbiAqIGFzIGl0IGV4aXN0ZWQgYXQgYSBnaXZlbiBnaXQgcmV2aXNpb24uIEJvdGggcmV0dXJuIG51bGwgb24gYW55IGZhaWx1cmVcbiAqIChtaXNzaW5nIGZpbGUsIGJhZCByZXYsIG5vdCBhIGdpdCByZXBvLCBldGMuKSBpbnN0ZWFkIG9mIHRocm93aW5nIFx1MjAxNCBhXG4gKiBjb21tYW5kIHRoYXQgc3RhdGljYWxseSBtYXRjaGVkIGFuIGlkaW9tIGJ1dCBwb2ludHMgYXQgc29tZXRoaW5nIHRoaXNcbiAqIG1hY2hpbmUgY2FuJ3QgY3VycmVudGx5IHJlc29sdmUgaXMgYSBub3JtYWwsIGV4cGVjdGVkIG91dGNvbWUsIG5vdCBhIGJ1Zy5cbiAqL1xuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHJlYWRGaWxlU3luYywgc3RhdFN5bmMgfSBmcm9tICdub2RlOmZzJztcblxuLyoqIE51bWJlciBvZiBsaW5lcyBpbiBhIHdvcmtpbmctdHJlZSBmaWxlLCBvciBudWxsIGlmIGl0IGNhbid0IGJlIHJlYWQuIFRyYWlsaW5nIG5ld2xpbmUgZG9lcyBub3QgY291bnQgYXMgYW4gZXh0cmEgZW1wdHkgbGluZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEZpbGVMaW5lcyhhYnNvbHV0ZVBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGlmICghc3RhdFN5bmMoYWJzb2x1dGVQYXRoKS5pc0ZpbGUoKSkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgY29udGVudCA9IHJlYWRGaWxlU3luYyhhYnNvbHV0ZVBhdGgsICd1dGY4Jyk7XG4gICAgaWYgKGNvbnRlbnQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gY29udGVudC5lbmRzV2l0aCgnXFxuJykgPyBjb250ZW50LnNsaWNlKDAsIC0xKSA6IGNvbnRlbnQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqIE51bWJlciBvZiBsaW5lcyBpbiBgcGF0aGAgYXMgaXQgZXhpc3RzIGF0IGByZXZgLCBydW4gZnJvbSBgY3dkYCwgb3IgbnVsbCBpZiB0aGUgcmV2L3BhdGgvcmVwbyBkb2Vzbid0IHJlc29sdmUuICovXG5leHBvcnQgZnVuY3Rpb24gY291bnRHaXRCbG9iTGluZXMoY3dkOiBzdHJpbmcsIHJldjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc2hvdycsIGAke3Jldn06JHtwYXRofWBdLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICBpZiAob3V0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIDA7XG4gICAgY29uc3Qgd2l0aG91dFRyYWlsaW5nTmV3bGluZSA9IG91dC5lbmRzV2l0aCgnXFxuJykgPyBvdXQuc2xpY2UoMCwgLTEpIDogb3V0O1xuICAgIHJldHVybiB3aXRob3V0VHJhaWxpbmdOZXdsaW5lLnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG4iLCAiLyoqXG4gKiBIZXVyaXN0aWMsIGRlcGVuZGVuY3ktZnJlZSBzaGVsbCBzcGxpdHRpbmcuIE5vdCBhIGZ1bGwgc2hlbGwgcGFyc2VyIFx1MjAxNCBnb29kXG4gKiBlbm91Z2ggdG8gbG9jYXRlIHNpbXBsZSBjb21tYW5kcyAoYW5kIHRoZWlyIGFyZ3YpIGluc2lkZSBhIGxhcmdlclxuICogJiYvfHwvOy98LWpvaW5lZCBCYXNoIHN0cmluZyB3aXRob3V0IHB1bGxpbmcgaW4gYSByZWFsIGJhc2ggQVNUIHBhcnNlci5cbiAqIFZhbGlkYXRlZCBkdXJpbmcgcmVzZWFyY2ggYWdhaW5zdCBiYXNobGV4IG9uIHRoZSByZWFsIHRyYW5zY3JpcHQgY29ycHVzO1xuICogdGhpcyBwb3J0cyB0aGUgc2FtZSBhbGdvcml0aG0uXG4gKlxuICogVGhlIHdvcmQtbGV2ZWwgdG9rZW5pemVyIChbdG9rZW5pemVdKSBpcyBxdW90ZS0gYW5kIHJlZGlyZWN0LWF3YXJlIChwbGFuXG4gKiBcdTAwQTc1LjEwKTogcmVkaXJlY3Qgb3BlcmF0b3JzIGFyZSBzcGxpdCBhcyBkaXN0aW5jdCB0b2tlbnMgd2l0aCBhdHRhY2hlZC10YXJnZXRcbiAqIGZvcm1zIHByZXNlcnZlZCAoYD5mYCksIHF1b3RlZCB0b2tlbnMgYXJlIHdvcmRzIGFuZCBuZXZlciBvcGVyYXRvcnMsIGFuZFxuICogW2FyZ3ZPZl0gZGVyaXZlcyBvcGVyYW5kcyBmcm9tIHRoZSB0b2tlbiBzdHJlYW0gbWludXMgcmVkaXJlY3QgdG9rZW5zIGFuZFxuICogdGhlaXIgdGFyZ2V0cy5cbiAqL1xuXG4vKiogT25lIGBzaW1wbGUgY29tbWFuZGAgZm91bmQgaW4gYSBsYXJnZXIgc2NyaXB0LCBwbHVzIHdoaWNoIG9wZXJhdG9yIHByZWNlZGVkIGl0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTaW1wbGVDb21tYW5kIHtcbiAgdGV4dDogc3RyaW5nO1xuICAvKipcbiAgICogVGhlIG9wZXJhdG9yIGltbWVkaWF0ZWx5IGJlZm9yZSB0aGlzIGNvbW1hbmQ6ICd8JyBmb3IgYSBwaXBlbGluZSBzdGFnZSxcbiAgICogJyYmJy8nfHwnIGZvciB0aGUgY29uZGl0aW9uYWwgb3BlcmF0b3JzICh0aGUgb25seSBvbmVzIHRoYXQgZ2F0ZSwgcGxhblxuICAgKiBcdTAwQTczIHN0ZXAgMiksICdvdGhlcicgZm9yICc7Jy9uZXdsaW5lLycmJywgb3IgJ3N0YXJ0JyBmb3IgdGhlIGZpcnN0IGNvbW1hbmQuXG4gICAqL1xuICBwcmVjZWRlZEJ5OiAnc3RhcnQnIHwgJ3wnIHwgJyYmJyB8ICd8fCcgfCAnb3RoZXInO1xufVxuXG4vKiogU3BsaXQgYSBjb21tYW5kIHN0cmluZyBpbnRvIHNpbXBsZS1jb21tYW5kIHN1YnN0cmluZ3MgYXQgdG9wLWxldmVsICYmLCB8fCwgOywgfCwgfCYsIGFuZCBuZXdsaW5lIGJvdW5kYXJpZXMuIFF1b3RlcyBhbmQgJCgpL2BgLygpIG5lc3RpbmcgYXJlIHJlc3BlY3RlZCAobm90IHNwbGl0IGluc2lkZSkuICovXG5leHBvcnQgZnVuY3Rpb24gc3BsaXRUb3BMZXZlbChjbWQ6IHN0cmluZyk6IFNpbXBsZUNvbW1hbmRbXSB7XG4gIGNvbnN0IHBhcnRzOiBTaW1wbGVDb21tYW5kW10gPSBbXTtcbiAgbGV0IGJ1ZiA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBjbWQubGVuZ3RoO1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgaW5TcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGluRHF1b3RlID0gZmFsc2U7XG4gIGxldCBwZW5kaW5nT3A6IFNpbXBsZUNvbW1hbmRbJ3ByZWNlZGVkQnknXSA9ICdzdGFydCc7XG5cbiAgY29uc3QgZmx1c2ggPSAobmV4dE9wOiBTaW1wbGVDb21tYW5kWydwcmVjZWRlZEJ5J10pID0+IHtcbiAgICBjb25zdCBzID0gYnVmLnRyaW0oKTtcbiAgICBpZiAocykgcGFydHMucHVzaCh7IHRleHQ6IHMsIHByZWNlZGVkQnk6IHBlbmRpbmdPcCB9KTtcbiAgICBidWYgPSAnJztcbiAgICBwZW5kaW5nT3AgPSBuZXh0T3A7XG4gIH07XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIG9wZXJhdG9yIGN1cnJlbnRseSBwZW5kaW5nIGlzIGEgcGlwZSAoYHxgL2B8JmApLiBBIGhlbHBlclxuICAgKiByYXRoZXIgdGhhbiBhbiBpbmxpbmUgY29tcGFyaXNvbjogVHlwZVNjcmlwdCdzIGNvbnRyb2wtZmxvdyBuYXJyb3dpbmdcbiAgICogY2Fubm90IHNlZSB0aGUgYXNzaWdubWVudHMgYGZsdXNoYCBtYWtlcyB0byBgcGVuZGluZ09wYCBmcm9tIGluc2lkZSBpdHNcbiAgICogY2xvc3VyZSwgYW5kIHdvdWxkIG90aGVyd2lzZSBuYXJyb3cgdGhlIGRpcmVjdCBjb21wYXJpc29uIHRvIHRoZVxuICAgKiBpbml0aWFsaXplciBgJ3N0YXJ0J2AuXG4gICAqL1xuICBjb25zdCBpc1BlbmRpbmdQaXBlID0gKCk6IGJvb2xlYW4gPT4gcGVuZGluZ09wID09PSAnfCc7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IGNtZFtpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgICBidWYgKz0gY21kW2kgKyAxXTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSBpbkRxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGluRHF1b3RlID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBidWYgKz0gYyArIGNtZFtpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcoJykge1xuICAgICAgZGVwdGggKz0gMTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScpIHtcbiAgICAgIGRlcHRoID0gTWF0aC5tYXgoMCwgZGVwdGggLSAxKTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICcmJicpIHtcbiAgICAgICAgZmx1c2goJyYmJyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJ3x8Jykge1xuICAgICAgICBmbHVzaCgnfHwnKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfCYnKSB7XG4gICAgICAgIGZsdXNoKCd8Jyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJzsnKSB7XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICd8Jykge1xuICAgICAgICBmbHVzaCgnfCcpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXG4nKSB7XG4gICAgICAgIC8vIEEgbmV3bGluZSBpbW1lZGlhdGVseSBhZnRlciBhIHBpcGUgb3BlcmF0b3IgaXMgYSBsaW5lIGNvbnRpbnVhdGlvblxuICAgICAgICAvLyAoYGNhdCBhLnR4dCB8XFxuc2VkIC4uLmAga2VlcHMgdGhlIHBpcGVsaW5lKSwgbm90IGEgc3RhdGVtZW50XG4gICAgICAgIC8vIHNlcGFyYXRvcjogc2tpcHBpbmcgaXQgcHJlc2VydmVzIGBwcmVjZWRlZEJ5OiAnfCdgIGZvciB0aGUgbmV4dFxuICAgICAgICAvLyBzdGFnZSBpbnN0ZWFkIG9mIGRlZ3JhZGluZyBpdCB0byAnb3RoZXInLlxuICAgICAgICBpZiAoaXNQZW5kaW5nUGlwZSgpKSB7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICcmJykge1xuICAgICAgICAvLyBgJj5gL2AmPj5gIChzdGRvdXQrc3RkZXJyIHJlZGlyZWN0KSBhbmQgYD4mYCAoZmQtZHVwIHJlZGlyZWN0LCBhcyBpblxuICAgICAgICAvLyBgMj4mMWApIGFyZSByZWRpcmVjdCBvcGVyYXRvcnMsIG5vdCBjb21tYW5kIHNlcGFyYXRvcnMgXHUyMDE0IGtlZXAgdGhlbVxuICAgICAgICAvLyBpbiB0aGUgY3VycmVudCBzaW1wbGUgY29tbWFuZCBzbyB0aGUgdG9rZW5pemVyIGNhbiBsZXggdGhlbSBhcyBvbmVcbiAgICAgICAgLy8gdG9rZW4uIEEgYD5gIGNvdW50cyBhcyBhIGR1cC1yZWRpcmVjdCBwcmVmaXggb25seSBhdCBhIHRva2VuXG4gICAgICAgIC8vIGJvdW5kYXJ5IChzdGFydCwgb3IgYWZ0ZXIgd2hpdGVzcGFjZS9kaWdpdHMpIFx1MjAxNCBgYT5iJmNgIHN0aWxsXG4gICAgICAgIC8vIGJhY2tncm91bmRzIHRoZSBgYT5iYCByZWRpcmVjdC5cbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGJ1Zi50cmltRW5kKCk7XG4gICAgICAgIGxldCBkdXBSZWRpcmVjdCA9IGZhbHNlO1xuICAgICAgICBpZiAodHJpbW1lZC5lbmRzV2l0aCgnPicpKSB7XG4gICAgICAgICAgY29uc3QgYmVmb3JlID0gdHJpbW1lZC5sZW5ndGggPj0gMiA/IHRyaW1tZWRbdHJpbW1lZC5sZW5ndGggLSAyXSA6ICcnO1xuICAgICAgICAgIGR1cFJlZGlyZWN0ID0gdHJpbW1lZC5sZW5ndGggPT09IDEgfHwgL1xcc3xcXGQvLnRlc3QoYmVmb3JlKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY21kW2kgKyAxXSA9PT0gJz4nIHx8IGR1cFJlZGlyZWN0KSB7XG4gICAgICAgICAgYnVmICs9IGM7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBidWYgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgZmx1c2goJ290aGVyJyk7XG4gIHJldHVybiBwYXJ0cztcbn1cblxuY29uc3QgTEVBRElOR19BU1NJR05NRU5UID0gL14oPzpbQS1aYS16X11bQS1aYS16MC05X10qPVxcUypcXHMrKSsvO1xuXG4vKiogU3RyaXAgbGVhZGluZyBGT089YmFyIFZBUj1iYXogZW52LXByZWZpeCBhc3NpZ25tZW50cyBmcm9tIGEgc2ltcGxlIGNvbW1hbmQuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2ltcGxlQ21kLnJlcGxhY2UoTEVBRElOR19BU1NJR05NRU5ULCAnJyk7XG59XG5cbi8qKiBPbmUgcXVvdGUtYXdhcmUgbGV4aWNhbCB0b2tlbiBmcm9tIGEgc2ltcGxlIGNvbW1hbmQncyB0ZXh0IChwbGFuIFx1MDBBNzUuMTApLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb2tlbiB7XG4gIC8qKlxuICAgKiBUaGUgdG9rZW4gdGV4dC4gV29yZCB0b2tlbnMgaGF2ZSBxdW90ZXMgc3RyaXBwZWQgYW5kIGVzY2FwZXMgcmVzb2x2ZWQ7XG4gICAqIHJlZGlyZWN0IHRva2VucyBrZWVwIHRoZSBvcGVyYXRvciB3aXRoIGFueSBhdHRhY2hlZCB0YXJnZXQgKGA+ZmAsXG4gICAqIGA+PmZgKSwgc2hlbGwtbGV4ZXIgc3R5bGUuXG4gICAqL1xuICB0ZXh0OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB0b2tlbiB3YXMgcXVvdGVkIG9yIGVzY2FwZWQgYW55d2hlcmUgaW4gdGhlIHNvdXJjZS4gQSBxdW90ZWRcbiAgICogdG9rZW4gaXMgYSB3b3JkLCBuZXZlciBhbiBvcGVyYXRvciAoYGVjaG8gJz4nYCBpcyBub3QgYSByZWRpcmVjdCkuXG4gICAqL1xuICBxdW90ZWQ6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB0b2tlbiBpcyBhIHJlZGlyZWN0IG9wZXJhdG9yIChgPmAsIGA+PmAsIGAxPmAsIGAyPmAsIGAmPmAsXG4gICAqIGAmPj5gLCBgPiZgLCBgPGAsIGA8PGAsIGA8PC1gLCBgPDw8YCksIHdpdGggYW55IGF0dGFjaGVkIHRhcmdldCBwcmVzZXJ2ZWRcbiAgICogaW4gYHRleHRgLlxuICAgKi9cbiAgaXNSZWRpcmVjdDogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBRdW90ZS1hd2FyZSB0b2tlbml6ZXIgdGhhdCBzcGxpdHMgcmVkaXJlY3Qgb3BlcmF0b3JzIGFzIGRpc3RpbmN0IHRva2VucyB3aXRoXG4gKiBhdHRhY2hlZC10YXJnZXQgZm9ybXMgcHJlc2VydmVkIChwbGFuIFx1MDBBNzUuMTApLiBXb3JkIHRva2VucyBjYXJyeSB0aGVcbiAqIGBxdW90ZWRgIGZsYWcgc28gY29uc3VtZXJzIGNhbiB0ZWxsIGEgcmVhbCBgPDxgIG9wZXJhdG9yIGZyb20gYSBxdW90ZWRcbiAqIGBcIjw8XCJgIGxpdGVyYWwuIFJldHVybnMgbnVsbCBvbiB1bmJhbGFuY2VkIHF1b3Rlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRva2VuaXplKHM6IHN0cmluZyk6IFRva2VuW10gfCBudWxsIHtcbiAgY29uc3QgdG9rZW5zOiBUb2tlbltdID0gW107XG4gIGxldCBidWYgPSAnJztcbiAgbGV0IHF1b3RlZCA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBzLmxlbmd0aDtcblxuICBjb25zdCBmbHVzaFdvcmQgPSAoKTogdm9pZCA9PiB7XG4gICAgaWYgKGJ1Zi5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICB0b2tlbnMucHVzaCh7IHRleHQ6IGJ1ZiwgcXVvdGVkLCBpc1JlZGlyZWN0OiBmYWxzZSB9KTtcbiAgICBidWYgPSAnJztcbiAgICBxdW90ZWQgPSBmYWxzZTtcbiAgfTtcblxuICAvKipcbiAgICogQXBwZW5kIHRoZSB1bnF1b3RlZCBjb250ZW50IG9mIHRoZSBxdW90ZWQgc2VjdGlvbiBvcGVuaW5nIGF0IGBzdGFydGBcbiAgICogKHRoZSBxdW90ZSBjaGFyKSB0byBgb3V0YCwgbWlycm9yaW5nIHNobGV4J3MgZXNjYXBlIHJ1bGVzIGZvciBkb3VibGVcbiAgICogcXVvdGVzLiBSZXR1cm5zIHRoZSBpbmRleCBhZnRlciB0aGUgY2xvc2luZyBxdW90ZSwgb3IgbnVsbCB3aGVuXG4gICAqIHVuYmFsYW5jZWQuXG4gICAqL1xuICBjb25zdCBhcHBlbmRRdW90ZWRDb250ZW50ID0gKG91dDogc3RyaW5nLCBzdGFydDogbnVtYmVyKTogeyBvdXQ6IHN0cmluZzsgbmV4dDogbnVtYmVyIH0gfCBudWxsID0+IHtcbiAgICBjb25zdCBxdW90ZSA9IHNbc3RhcnRdO1xuICAgIGxldCBqID0gc3RhcnQgKyAxO1xuICAgIHdoaWxlIChqIDwgbikge1xuICAgICAgY29uc3QgYyA9IHNbal07XG4gICAgICBpZiAocXVvdGUgPT09IFwiJ1wiKSB7XG4gICAgICAgIGlmIChjID09PSBcIidcIikgcmV0dXJuIHsgb3V0LCBuZXh0OiBqICsgMSB9O1xuICAgICAgICBvdXQgKz0gYztcbiAgICAgICAgaiArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaiArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXMoc1tqICsgMV0pKSB7XG4gICAgICAgIG91dCArPSBzW2ogKyAxXTtcbiAgICAgICAgaiArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSByZXR1cm4geyBvdXQsIG5leHQ6IGogKyAxIH07XG4gICAgICBvdXQgKz0gYztcbiAgICAgIGogKz0gMTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH07XG5cbiAgLyoqXG4gICAqIEFwcGVuZCB0aGUgcmF3IGF0dGFjaGVkLXRhcmdldCB0ZXh0IHN0YXJ0aW5nIGF0IGBzdGFydGAgdG8gYG91dGAgXHUyMDE0XG4gICAqIHZlcmJhdGltLCBxdW90ZWQgc2VjdGlvbnMgc3Bhbm5pbmcgc3BhY2VzIGluY2x1ZGVkIFx1MjAxNCBzdG9wcGluZyBhdFxuICAgKiB3aGl0ZXNwYWNlIG9yIGFub3RoZXIgcmVkaXJlY3Qgb3BlcmF0b3IuIFJldHVybnMgdGhlIG5leHQgaW5kZXgsIG9yIG51bGxcbiAgICogb24gdW5iYWxhbmNlZCBxdW90ZXMuXG4gICAqL1xuICBjb25zdCBhcHBlbmRBdHRhY2hlZFRhcmdldCA9IChvdXQ6IHN0cmluZywgc3RhcnQ6IG51bWJlcik6IHsgb3V0OiBzdHJpbmc7IG5leHQ6IG51bWJlciB9IHwgbnVsbCA9PiB7XG4gICAgbGV0IGogPSBzdGFydDtcbiAgICB3aGlsZSAoaiA8IG4pIHtcbiAgICAgIGNvbnN0IGMgPSBzW2pdO1xuICAgICAgaWYgKC9cXHMvLnRlc3QoYykgfHwgYyA9PT0gJzwnIHx8IGMgPT09ICc+JykgcmV0dXJuIHsgb3V0LCBuZXh0OiBqIH07XG4gICAgICBpZiAoYyA9PT0gXCInXCIgfHwgYyA9PT0gJ1wiJykge1xuICAgICAgICBjb25zdCBzZWN0aW9uID0gYXBwZW5kUXVvdGVkQ29udGVudCgnJywgaik7XG4gICAgICAgIGlmIChzZWN0aW9uID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICAgICAgb3V0ICs9IHMuc2xpY2Uoaiwgc2VjdGlvbi5uZXh0KTtcbiAgICAgICAgaiA9IHNlY3Rpb24ubmV4dDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGogKyAxIDwgbikge1xuICAgICAgICBvdXQgKz0gYyArIHNbaiArIDFdO1xuICAgICAgICBqICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgb3V0ICs9IGM7XG4gICAgICBqICs9IDE7XG4gICAgfVxuICAgIHJldHVybiB7IG91dCwgbmV4dDogaiB9O1xuICB9O1xuXG4gIC8qKiBFbWl0IGEgcmVkaXJlY3QgdG9rZW4gd2hvc2UgdGV4dCBwcmVmaXhlcyB0aGUgb3BlcmF0b3Igd2l0aCB0aGUgY3VycmVudCBkaWdpdCBidWZmZXIgKGFuIElPX05VTUJFUiBsaWtlIGAyPmApLiAqL1xuICBjb25zdCBlbWl0UmVkaXJlY3QgPSAob3BlcmF0b3I6IHN0cmluZywgYXR0YWNoZWRTdGFydDogbnVtYmVyKTogYm9vbGVhbiA9PiB7XG4gICAgY29uc3QgYXR0YWNoZWQgPSBhcHBlbmRBdHRhY2hlZFRhcmdldCgnJywgYXR0YWNoZWRTdGFydCk7XG4gICAgaWYgKGF0dGFjaGVkID09PSBudWxsKSByZXR1cm4gZmFsc2U7XG4gICAgdG9rZW5zLnB1c2goeyB0ZXh0OiBidWYgKyBvcGVyYXRvciArIGF0dGFjaGVkLm91dCwgcXVvdGVkOiBmYWxzZSwgaXNSZWRpcmVjdDogdHJ1ZSB9KTtcbiAgICBidWYgPSAnJztcbiAgICBxdW90ZWQgPSBmYWxzZTtcbiAgICBpID0gYXR0YWNoZWQubmV4dDtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gc1tpXTtcbiAgICBpZiAoL1xccy8udGVzdChjKSkge1xuICAgICAgZmx1c2hXb3JkKCk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiIHx8IGMgPT09ICdcIicpIHtcbiAgICAgIHF1b3RlZCA9IHRydWU7XG4gICAgICBjb25zdCBzZWN0aW9uID0gYXBwZW5kUXVvdGVkQ29udGVudChidWYsIGkpO1xuICAgICAgaWYgKHNlY3Rpb24gPT09IG51bGwpIHJldHVybiBudWxsO1xuICAgICAgYnVmID0gc2VjdGlvbi5vdXQ7XG4gICAgICBpID0gc2VjdGlvbi5uZXh0O1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBxdW90ZWQgPSB0cnVlO1xuICAgICAgYnVmICs9IHNbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnPCcgfHwgYyA9PT0gJz4nKSB7XG4gICAgICAvLyBBIGA8YC9gPmAgaXMgYSByZWRpcmVjdCBvcGVyYXRvciBhdCBhIHdvcmQgYm91bmRhcnksIG9yIGFmdGVyIGFuXG4gICAgICAvLyBJT19OVU1CRVIgZGlnaXQgcnVuIChgMT5gLCBgMj5gKTsgbWlkLXdvcmQgaXQgZW5kcyB0aGUgY3VycmVudCB3b3JkXG4gICAgICAvLyBmaXJzdCAoYGVjaG8gYT5iYCBcdTIxOTIgd29yZHMgYGVjaG9gLCBgYWA7IHJlZGlyZWN0IGA+YmApLlxuICAgICAgaWYgKGJ1ZiAhPT0gJycgJiYgIS9eXFxkKyQvLnRlc3QoYnVmKSkgZmx1c2hXb3JkKCk7XG4gICAgICBsZXQgb3BlcmF0b3I6IHN0cmluZztcbiAgICAgIGlmIChjID09PSAnPCcpIHtcbiAgICAgICAgaWYgKHMuc2xpY2UoaSwgaSArIDMpID09PSAnPDw8Jykgb3BlcmF0b3IgPSAnPDw8JztcbiAgICAgICAgZWxzZSBpZiAocy5zbGljZShpLCBpICsgMykgPT09ICc8PC0nKSBvcGVyYXRvciA9ICc8PC0nO1xuICAgICAgICBlbHNlIGlmIChzLnNsaWNlKGksIGkgKyAyKSA9PT0gJzw8Jykgb3BlcmF0b3IgPSAnPDwnO1xuICAgICAgICBlbHNlIG9wZXJhdG9yID0gJzwnO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3BlcmF0b3IgPSBzLnNsaWNlKGksIGkgKyAyKSA9PT0gJz4+JyA/ICc+PicgOiAnPic7XG4gICAgICB9XG4gICAgICBpZiAoIWVtaXRSZWRpcmVjdChvcGVyYXRvciwgaSArIG9wZXJhdG9yLmxlbmd0aCkpIHJldHVybiBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnJicpIHtcbiAgICAgIC8vIGAmPmAvYCY+PmAgXHUyMDE0IHRoZSBzdGRvdXQrc3RkZXJyIHJlZGlyZWN0IChrZXB0IHRvZ2V0aGVyIGJ5XG4gICAgICAvLyBzcGxpdFRvcExldmVsKS4gQSBiYXJlIGAmYCBoZXJlIGlzIGFuIG9yZGluYXJ5IHdvcmQgY2hhciAoYCYxYCBpblxuICAgICAgLy8gYDI+JjFgLCB3aGljaCB0aGUgYXR0YWNoZWQtdGFyZ2V0IHNjYW4gYWJvdmUgY29uc3VtZWQgYW55d2F5KS5cbiAgICAgIGlmIChzW2kgKyAxXSA9PT0gJz4nKSB7XG4gICAgICAgIGZsdXNoV29yZCgpO1xuICAgICAgICBjb25zdCBvcGVyYXRvciA9IHMuc2xpY2UoaSwgaSArIDMpID09PSAnJj4+JyA/ICcmPj4nIDogJyY+JztcbiAgICAgICAgaWYgKCFlbWl0UmVkaXJlY3Qob3BlcmF0b3IsIGkgKyBvcGVyYXRvci5sZW5ndGgpKSByZXR1cm4gbnVsbDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBidWYgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgZmx1c2hXb3JkKCk7XG4gIHJldHVybiB0b2tlbnM7XG59XG5cbi8qKlxuICogVGhlIGF0dGFjaGVkIHRhcmdldCBvZiBhIHJlZGlyZWN0IHRva2VuLCBvciBudWxsIHdoZW4gdGhlIG9wZXJhdG9yIGlzXG4gKiBzdGFuZGFsb25lIChgPmAgdnMgYD5mYDsgYDI+YCB2cyBgMj4mMWApLiBTcGxpdHMgYW4gb3B0aW9uYWwgSU9fTlVNQkVSXG4gKiBkaWdpdCBydW4gb2ZmIHRoZSBmcm9udCwgdGhlbiB0aGUgb3BlcmF0b3IsIGxlYXZpbmcgdGhlIHRhcmdldC5cbiAqL1xuZnVuY3Rpb24gcmVkaXJlY3RBdHRhY2hlZFRhcmdldCh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSB0ZXh0Lm1hdGNoKC9eKFxcZCopKDw8PHw8PC18Jj4+fDw8fD4+fCY+fD4mfDx8PikoLiopJC8pO1xuICBpZiAobWF0Y2ggPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBbLCAsICwgcmVzdF0gPSBtYXRjaDtcbiAgcmV0dXJuIHJlc3QubGVuZ3RoID4gMCA/IHJlc3QgOiBudWxsO1xufVxuXG4vKiogQmVzdC1lZmZvcnQgYXJndiBmb3IgYSBzaW1wbGUgY29tbWFuZDogbGVhZGluZyBhc3NpZ25tZW50cyBzdHJpcHBlZCwgcXVvdGUtYXdhcmUgdG9rZW5zIG1pbnVzIHJlZGlyZWN0IG9wZXJhdG9ycyBhbmQgdGhlaXIgdGFyZ2V0cy4gUmV0dXJucyBudWxsIGlmIHRoZSBjb21tYW5kIGRvZXNuJ3QgdG9rZW5pemUgY2xlYW5seSAodW5iYWxhbmNlZCBxdW90ZXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFyZ3ZPZihzaW1wbGVDbWQ6IHN0cmluZyk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGNvbnN0IHRva2VucyA9IHRva2VuaXplKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZUNtZCkudHJpbSgpKTtcbiAgaWYgKHRva2VucyA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFyZ3Y6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdG9rZW5zLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdG9rZW4gPSB0b2tlbnNbaV07XG4gICAgaWYgKCF0b2tlbi5pc1JlZGlyZWN0KSB7XG4gICAgICBhcmd2LnB1c2godG9rZW4udGV4dCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gQSBzdGFuZGFsb25lIHJlZGlyZWN0IG9wZXJhdG9yIGNvbnN1bWVzIHRoZSBuZXh0IHRva2VuIGFzIGl0cyB0YXJnZXQ7XG4gICAgLy8gYW4gYXR0YWNoZWQgZm9ybSAoYD5mYCwgYD4+ZmApIGlzIHNlbGYtY29udGFpbmVkLlxuICAgIGlmIChyZWRpcmVjdEF0dGFjaGVkVGFyZ2V0KHRva2VuLnRleHQpID09PSBudWxsKSBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIGFyZ3Y7XG59XG4iLCAiLyoqXG4gKiBUaGUgcmFuZ2UtcHJlc2VydmluZyB1bmlmaWVkLWRpZmYgcGFyc2VyIChwbGFuIFx1MDBBNzUuNyksIHNpYmxpbmcgdG9cbiAqIG1lY2hhbmljYWwtY2hhbmdlLnRzJ3MgcmFuZ2UtbGVzcyBgcGFyc2VVbmlmaWVkRGlmZmAuIFRoZSBwYXRjaC9naXQgYXBwbHlcbiAqIGdyYW1tYXIgbmVlZHMgdGhlIGBAQCAtYSxiICtjLGQgQEBgIGh1bmsgbnVtYmVycyB0aGF0IHBhcnNlVW5pZmllZERpZmZcbiAqIGRpc2NhcmRzLCBzbyB0aGlzIHBhcnNlcyB0aGUgc2FtZSBoZWFkZXIgZGlhbGVjdCBmcm9tIHNjcmF0Y2guXG4gKlxuICogQSBodW5rIHdob3NlIHByZS9wb3N0IGxpbmUgY291bnRzIG1hdGNoIHByZXNlcnZlcyBsaW5lIGNvb3JkaW5hdGVzLCBzbyBhXG4gKiBmaWxlIHdob3NlIGh1bmtzIGFyZSBhbGwgY291bnQtcHJlc2VydmluZyBnZXRzIGFuIGV4YWN0IHJhbmdlIFx1MjAxNCB0aGUgdW5pb24gb2ZcbiAqIGV2ZXJ5IGh1bmsncyByZWdpb24uIEFueSBjb3VudC1jaGFuZ2luZyBodW5rIChwdXJlIGFkZCwgcHVyZSBkZWxldGUsIHVuZXF1YWxcbiAqIGNvdW50cykgZGVncmFkZXMgdGhlIGZpbGUgdG8gYSB3aG9sZS1maWxlIG1vZGlmeTogcG9zaXRpb25zIGJlbG93IGl0IHNoaWZ0LFxuICogYW5kIGEgZGVsZXRlZCBsaW5lIG9jY3VwaWVzIG5vIHBvc3QtZWRpdCByYW5nZSBhdCBhbGwuXG4gKlxuICogUGVyLWZpbGUgY2xhc3NpZmljYXRpb25zOiBgbmV3IGZpbGUgbW9kZWAgXHUyMTkyIGNyZWF0ZS1vdmVyd3JpdGU7IGBkZWxldGVkIGZpbGVcbiAqIG1vZGVgIFx1MjE5MiBkZWxldGU7IGByZW5hbWUgZnJvbWAvYHJlbmFtZSB0b2AgXHUyMTkyIHNvdXJjZSBkZWxldGUgKyBkZXN0XG4gKiByZW5hbWUtY29weTsgYmluYXJ5IGRpZmZzIFx1MjE5MiB3aG9sZS1maWxlIG1vZGlmeTsgYSBgKysrIC9kZXYvbnVsbGAgdGFyZ2V0ICh0aGVcbiAqIHNoYXBlIGBkaWZmIC11YC1mb3JtYXQgZGVsZXRpb25zIHRha2UpIFx1MjE5MiBkZWxldGUsIGFuZCBhIGAtLS0gL2Rldi9udWxsYCBzaWRlXG4gKiAodGhlIGBkaWZmIC11YC1mb3JtYXQgY3JlYXRpb24gc2hhcGUsIHdpdGggbm8gYG5ldyBmaWxlIG1vZGVgIGhlYWRlcikgXHUyMTkyXG4gKiBjcmVhdGUtb3ZlcndyaXRlLlxuICpcbiAqIEdpdC1zdHlsZSBgYS9cdTIwMjZgL2BiL1x1MjAyNmAgcHJlZml4ZXMgYXJlIHN0cmlwcGVkIHBlciB0aGUgY2FsbGVyJ3MgYC1wTmAgc3RyaXBcbiAqIGxldmVsOiBhIG51bWJlciBzdHJpcHMgdGhhdCBtYW55IGxlYWRpbmcgcGF0aCBjb21wb25lbnRzLCBhbmQgYCdhdXRvJ2BcbiAqIChwYXRjaCdzIGRlZmF1bHQpIHN0cmlwcyBvbmUgd2hlbiB0aGUgcGF0aCBpcyBhLy0gb3IgYi8tcHJlZml4ZWQgYW5kIG5vbmVcbiAqIG90aGVyd2lzZS4gYC9kZXYvbnVsbGAgaXMgY2hlY2tlZCBiZWZvcmUgc3RyaXBwaW5nIFx1MjAxNCB0aGUgaGVhZGVyIG1hcmtlclxuICogd291bGQgb3RoZXJ3aXNlIGxvc2UgaXRzIGBkZXYvYCBjb21wb25lbnQuXG4gKlxuICogYGRpZmYgLXVgIGhlYWRlcnMgY2FycnkgYSB0YWItc2VwYXJhdGVkIHRpbWVzdGFtcCAoYC0tLSBmLnR4dFxcdDIwMjQtMDEtMDFcbiAqIDAwOjAwOjAwYCkgYW5kIG1heSBiZSBDUkxGLXRlcm1pbmF0ZWQ7IGJvdGggYXJlIHN0cmlwcGVkIGJlZm9yZSBwYXRoXG4gKiByZXNvbHV0aW9uLiBUaGUgdGFyZ2V0IG9mIGEgbW9kaWZ5IGh1bmsgaXMgdGhlIGAtLS1gIHNpZGU6IHBhdGNoIGFuZCBnaXRcbiAqIGFwcGx5IHJld3JpdGUgdGhlIGZpbGUgbmFtZWQgdGhlcmUgKGZvciBgZGlmZiAtdSBmLnR4dCBmLm5ld2AsIHRoZSBgKysrYFxuICogc2lkZSBpcyBvbmx5IGEgbGFiZWwpLCBzbyB0aGUgYCsrK2AgbGluZSBvdmVycmlkZXMgdGhlIHBhdGggb25seSBmb3IgdGhlXG4gKiBgL2Rldi9udWxsYCBtYXJrZXJzIFx1MjAxNCBhIGAtLS0gL2Rldi9udWxsYCBzaWRlIChhIG5ldyBmaWxlKSBuYW1lcyB0aGUgdGFyZ2V0XG4gKiBvbiBgKysrYCwgYW5kIGEgYCsrKyAvZGV2L251bGxgIHNpZGUgbWFya3MgYSBkZWxldGlvbi5cbiAqXG4gKiBNYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggdGV4dCByZXR1cm5zIG51bGwgKGZhaWwgY2xvc2VkIFx1MjAxNCB0aGUgY2FsbGVyIGVtaXRzXG4gKiB1bnJlc29sdmVkIHJhdGhlciB0aGFuIGd1ZXNzaW5nIGF0IHRhcmdldHMpLlxuICovXG5cbi8qKiBUaGUgYC1wTmAgaGVhZGVyIHN0cmlwIGxldmVsOiBhIGNvbXBvbmVudCBjb3VudCwgb3IgcGF0Y2gncyBgJ2F1dG8nYCBkZWZhdWx0LiAqL1xuZXhwb3J0IHR5cGUgUGF0aFN0cmlwID0gbnVtYmVyIHwgJ2F1dG8nO1xuXG4vKiogT25lIGZpbGUgYSBwYXRjaCB0b3VjaGVzOiB0aGUgdGFyZ2V0IHBhdGgsIHRoZSB0b3VjaCBraW5kLCBhbmQgdGhlIGV4YWN0IHJhbmdlIHdoZW4gdGhlIGh1bmtzIHByZXNlcnZlIGxpbmUgY291bnRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBVbmlmaWVkRGlmZlRhcmdldCB7XG4gIHBhdGg6IHN0cmluZztcbiAgb3BlcmF0aW9uOiAnbW9kaWZ5JyB8ICdjcmVhdGUtb3ZlcndyaXRlJyB8ICdkZWxldGUnIHwgJ3JlbmFtZS1jb3B5JztcbiAgbGluZVN0YXJ0PzogbnVtYmVyO1xuICBsaW5lRW5kPzogbnVtYmVyO1xufVxuXG5jb25zdCBIVU5LX0hFQURFUiA9IC9eQEAgLShcXGQrKSg/OiwoXFxkKykpPyBcXCsoXFxkKykoPzosKFxcZCspKT8gQEAvO1xuXG4vKiogU3RyaXAgdGhlIGZpcnN0IGBuYCBsZWFkaW5nIHBhdGggY29tcG9uZW50cyAoYC1wTmApLCBzdG9wcGluZyBhdCBhIGNvbXBvbmVudC1sZXNzIHBhdGguICovXG5mdW5jdGlvbiBzdHJpcFBhdGhDb21wb25lbnRzKHA6IHN0cmluZywgbjogbnVtYmVyKTogc3RyaW5nIHtcbiAgbGV0IHMgPSBwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykge1xuICAgIGNvbnN0IHNsYXNoID0gcy5pbmRleE9mKCcvJyk7XG4gICAgaWYgKHNsYXNoID09PSAtMSkgcmV0dXJuIHM7XG4gICAgcyA9IHMuc2xpY2Uoc2xhc2ggKyAxKTtcbiAgfVxuICByZXR1cm4gcztcbn1cblxuLyoqXG4gKiBUaGUgbGV2ZWwgdG8gc3RyaXAgZnJvbSBgcmF3YCB1bmRlciBgc3RyaXBgOiBhIG51bWJlciBwYXNzZXMgdGhyb3VnaDsgYCdhdXRvJ2BcbiAqIHJlc29sdmVzIHRvIHAxIHdoZW4gdGhlIHBhdGggaXMgYGEvYC9gYi9gLXByZWZpeGVkIGFuZCBwMCBvdGhlcndpc2UgXHUyMDE0IHBhdGNoJ3NcbiAqIGRlZmF1bHQgZm9yIGRpZmZzIHdob3NlIHByZWZpeGVzIGFyZSBgZGlmZiAtdWAtc3R5bGUgcmF0aGVyIHRoYW4gZ2l0J3MuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwTGV2ZWxGb3IocmF3OiBzdHJpbmcsIHN0cmlwOiBQYXRoU3RyaXApOiBudW1iZXIge1xuICByZXR1cm4gc3RyaXAgPT09ICdhdXRvJyA/IChyYXcuc3RhcnRzV2l0aCgnYS8nKSB8fCByYXcuc3RhcnRzV2l0aCgnYi8nKSA/IDEgOiAwKSA6IHN0cmlwO1xufVxuXG4vKipcbiAqIFRoZSByYXcgYC0tLWAvYCsrK2AgaGVhZGVyIHBhdGg6IHRoZSB0ZXh0IHVwIHRvIHRoZSBmaXJzdCB0YWIgKHRoZVxuICogYGRpZmYgLXVgIHRpbWVzdGFtcCBjb2x1bW4pLCBvciB0aGUgd2hvbGUgd29yZCB3aGVuIHRoZXJlIGlzIG5vbmUuIENSTEZcbiAqIGlzIGhhbmRsZWQgYXQgdGhlIGxpbmUgbGV2ZWwgKHNlZSBwYXJzZVVuaWZpZWREaWZmUmFuZ2UpLCB3aGljaCBhbHNvXG4gKiBjb3ZlcnMgaHVuayBoZWFkZXJzLlxuICovXG5mdW5jdGlvbiBoZWFkZXJQYXRoVGV4dChyYXc6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRhYiA9IHJhdy5pbmRleE9mKCdcXHQnKTtcbiAgcmV0dXJuIHRhYiA9PT0gLTEgPyByYXcgOiByYXcuc2xpY2UoMCwgdGFiKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlVW5pZmllZERpZmZSYW5nZShwYXRjaFRleHQ6IHN0cmluZywgc3RyaXA6IFBhdGhTdHJpcCk6IFVuaWZpZWREaWZmVGFyZ2V0W10gfCBudWxsIHtcbiAgY29uc3QgcmVzdWx0czogVW5pZmllZERpZmZUYXJnZXRbXSA9IFtdO1xuICBsZXQgc2F3QmxvY2sgPSBmYWxzZTtcbiAgbGV0IGN1cnJlbnQ6IHtcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAga2luZDogJ21vZGlmeScgfCAnbmV3JyB8ICdkZWxldGVkJztcbiAgICBodW5rczogQXJyYXk8eyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9PjtcbiAgICBjb3VudENoYW5naW5nOiBib29sZWFuO1xuICB9IHwgbnVsbCA9IG51bGw7XG4gIGxldCBwZW5kaW5nS2luZDogJ25ldycgfCAnZGVsZXRlZCcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHJlbmFtZUZyb206IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgcmVuYW1lVG86IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgYmluYXJ5ID0gZmFsc2U7XG5cbiAgLyoqIFRoZSBoZWFkZXIgcGF0aCwgdGFiL0NSLXN0cmlwcGVkLCB3aXRoIHRoZSBgLXBOYCBsZXZlbCBhcHBsaWVkIFx1MjAxNCBgL2Rldi9udWxsYCBrZXB0IHZlcmJhdGltICh0aGUgbWFya2VyIGlzIG5ldmVyIGEgcmVhbCBwYXRoKS4gKi9cbiAgY29uc3Qgc3RyaXBwZWQgPSAocmF3OiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICAgIGNvbnN0IHRleHQgPSBoZWFkZXJQYXRoVGV4dChyYXcpO1xuICAgIGlmICh0ZXh0ID09PSAnL2Rldi9udWxsJykgcmV0dXJuIHRleHQ7XG4gICAgcmV0dXJuIHN0cmlwUGF0aENvbXBvbmVudHModGV4dCwgc3RyaXBMZXZlbEZvcih0ZXh0LCBzdHJpcCkpO1xuICB9O1xuXG4gIGNvbnN0IGZpbmlzaCA9ICgpOiB2b2lkID0+IHtcbiAgICBpZiAoY3VycmVudCAhPT0gbnVsbCkge1xuICAgICAgaWYgKGN1cnJlbnQua2luZCA9PT0gJ25ldycpIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScgfSk7XG4gICAgICBlbHNlIGlmIChjdXJyZW50LmtpbmQgPT09ICdkZWxldGVkJykgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdkZWxldGUnIH0pO1xuICAgICAgZWxzZSBpZiAoYmluYXJ5KSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ21vZGlmeScgfSk7XG4gICAgICBlbHNlIGlmIChjdXJyZW50Lmh1bmtzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBBIGhlYWRlci1vbmx5IGJsb2NrIHdpdGggbm8gaHVua3M6IG5vdGhpbmcgc3RhdGljYWxseSBrbm93bi5cbiAgICAgIH0gZWxzZSBpZiAoY3VycmVudC5jb3VudENoYW5naW5nKSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ21vZGlmeScgfSk7XG4gICAgICBlbHNlIHtcbiAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbiguLi5jdXJyZW50Lmh1bmtzLm1hcCgoaCkgPT4gaC5zdGFydCkpO1xuICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heCguLi5jdXJyZW50Lmh1bmtzLm1hcCgoaCkgPT4gaC5lbmQpKTtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdtb2RpZnknLCBsaW5lU3RhcnQ6IHN0YXJ0LCBsaW5lRW5kOiBlbmQgfSk7XG4gICAgICB9XG4gICAgICBjdXJyZW50ID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHJlbmFtZUZyb20gIT09IG51bGwpIHJlc3VsdHMucHVzaCh7IHBhdGg6IHJlbmFtZUZyb20sIG9wZXJhdGlvbjogJ2RlbGV0ZScgfSk7XG4gICAgaWYgKHJlbmFtZVRvICE9PSBudWxsKSByZXN1bHRzLnB1c2goeyBwYXRoOiByZW5hbWVUbywgb3BlcmF0aW9uOiAncmVuYW1lLWNvcHknIH0pO1xuICAgIHJlbmFtZUZyb20gPSBudWxsO1xuICAgIHJlbmFtZVRvID0gbnVsbDtcbiAgICBiaW5hcnkgPSBmYWxzZTtcbiAgfTtcblxuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgcGF0Y2hUZXh0LnNwbGl0KCdcXG4nKSkge1xuICAgIC8vIEEgdHJhaWxpbmcgYFxccmAgKENSTEYgcGF0Y2ggdGV4dCBcdTIwMTQgV2luZG93cy1hdXRob3JlZCBkaWZmcykgcG9sbHV0ZXNcbiAgICAvLyBoZWFkZXJzLCBodW5rIGhlYWRlcnMsIGFuZCBwYXRoIGxpbmVzIGFsaWtlOyBib3RoIHBhdGNoIGFuZCBnaXQgYXBwbHlcbiAgICAvLyBzdHJpcCBpdCwgc28gdGhlIHBhcnNlciBkb2VzIHRvby5cbiAgICBjb25zdCBsaW5lID0gcmF3TGluZS5lbmRzV2l0aCgnXFxyJykgPyByYXdMaW5lLnNsaWNlKDAsIC0xKSA6IHJhd0xpbmU7XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnLS0tICcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBpZiAoY3VycmVudCAhPT0gbnVsbCkgZmluaXNoKCk7XG4gICAgICBjdXJyZW50ID0ge1xuICAgICAgICBwYXRoOiBzdHJpcHBlZChsaW5lLnNsaWNlKDQpKSxcbiAgICAgICAga2luZDogcGVuZGluZ0tpbmQgPz8gJ21vZGlmeScsXG4gICAgICAgIGh1bmtzOiBbXSxcbiAgICAgICAgY291bnRDaGFuZ2luZzogZmFsc2VcbiAgICAgIH07XG4gICAgICBwZW5kaW5nS2luZCA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnKysrICcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBjb25zdCBwYXRoID0gc3RyaXBwZWQobGluZS5zbGljZSg0KSk7XG4gICAgICBpZiAoY3VycmVudCA9PT0gbnVsbCkgY3VycmVudCA9IHsgcGF0aCwga2luZDogcGVuZGluZ0tpbmQgPz8gJ21vZGlmeScsIGh1bmtzOiBbXSwgY291bnRDaGFuZ2luZzogZmFsc2UgfTtcbiAgICAgIGVsc2UgaWYgKHBhdGggPT09ICcvZGV2L251bGwnKSBjdXJyZW50LmtpbmQgPSAnZGVsZXRlZCc7XG4gICAgICBlbHNlIGlmIChjdXJyZW50LnBhdGggPT09ICcvZGV2L251bGwnKSB7XG4gICAgICAgIC8vIEEgYC0tLSAvZGV2L251bGxgIHNpZGUgcmVwbGFjZWQgYnkgYSByZWFsIGArKytgIHBhdGggaXMgYSBuZXcgZmlsZVxuICAgICAgICAvLyAodGhlIGBkaWZmIC11YC1mb3JtYXQgY3JlYXRpb24gc2hhcGUgXHUyMDE0IG5vIGBuZXcgZmlsZSBtb2RlYCBoZWFkZXIpLlxuICAgICAgICAvLyBJdHMgYEBAIC0wLDAgK04gQEBgIGh1bmsgaGFzIG5vIHByZS1lZGl0IGxpbmVzLCBzbyB0aGVcbiAgICAgICAgLy8gY3JlYXRlLW92ZXJ3cml0ZSBpcyBkZWNpZGVkIGhlcmUsIG5vdCBmcm9tIGh1bmsgY292ZXJhZ2UuXG4gICAgICAgIGN1cnJlbnQucGF0aCA9IHBhdGg7XG4gICAgICAgIGN1cnJlbnQua2luZCA9ICduZXcnO1xuICAgICAgfVxuICAgICAgLy8gT3RoZXJ3aXNlIGtlZXAgdGhlIGAtLS1gIHNpZGU6IHBhdGNoIGFuZCBnaXQgYXBwbHkgcmV3cml0ZSB0aGUgZmlsZVxuICAgICAgLy8gbmFtZWQgb24gdGhlIGAtLS1gIGxpbmUsIGFuZCBgZGlmZiAtdSBmIGYubmV3YCBoZWFkZXJzIG5hbWUgdGhlXG4gICAgICAvLyBwcmUtaW1hZ2UgdGhlcmUgXHUyMDE0IHRoZSBgKysrYCBwYXRoIGlzIG9ubHkgYSBsYWJlbCAodGhlIGRpZmYtdXVcbiAgICAgIC8vIHBhdGNoLWhlYWRlciBtaXNzKS5cbiAgICAgIHBlbmRpbmdLaW5kID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCduZXcgZmlsZSBtb2RlJykpIHtcbiAgICAgIHBlbmRpbmdLaW5kID0gJ25ldyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnZGVsZXRlZCBmaWxlIG1vZGUnKSkge1xuICAgICAgcGVuZGluZ0tpbmQgPSAnZGVsZXRlZCc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgncmVuYW1lIGZyb20gJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGlmIChjdXJyZW50ICE9PSBudWxsKSBmaW5pc2goKTtcbiAgICAgIHJlbmFtZUZyb20gPSBzdHJpcHBlZChsaW5lLnNsaWNlKCdyZW5hbWUgZnJvbSAnLmxlbmd0aCkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ3JlbmFtZSB0byAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgcmVuYW1lVG8gPSBzdHJpcHBlZChsaW5lLnNsaWNlKCdyZW5hbWUgdG8gJy5sZW5ndGgpKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdCaW5hcnkgZmlsZXMgJykgfHwgbGluZS5zdGFydHNXaXRoKCdHSVQgYmluYXJ5IHBhdGNoJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGJpbmFyeSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgaHVuayA9IGxpbmUubWF0Y2goSFVOS19IRUFERVIpO1xuICAgIGlmIChodW5rKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBjb25zdCBwcmVTdGFydCA9IE51bWJlci5wYXJzZUludChodW5rWzFdLCAxMCk7XG4gICAgICBjb25zdCBwcmVDb3VudCA9IGh1bmtbMl0gPT09IHVuZGVmaW5lZCA/IDEgOiBOdW1iZXIucGFyc2VJbnQoaHVua1syXSwgMTApO1xuICAgICAgY29uc3QgcG9zdENvdW50ID0gaHVua1s0XSA9PT0gdW5kZWZpbmVkID8gMSA6IE51bWJlci5wYXJzZUludChodW5rWzRdLCAxMCk7XG4gICAgICBpZiAoY3VycmVudCA9PT0gbnVsbCkgcmV0dXJuIG51bGw7IC8vIGEgaHVuayB3aXRob3V0IGEgZmlsZSBoZWFkZXIgXHUyMTkyIG1hbGZvcm1lZFxuICAgICAgaWYgKHByZUNvdW50ICE9PSBwb3N0Q291bnQpIGN1cnJlbnQuY291bnRDaGFuZ2luZyA9IHRydWU7XG4gICAgICBpZiAocHJlQ291bnQgPiAwKSBjdXJyZW50Lmh1bmtzLnB1c2goeyBzdGFydDogcHJlU3RhcnQsIGVuZDogcHJlU3RhcnQgKyBwcmVDb3VudCAtIDEgfSk7XG4gICAgfVxuICB9XG4gIGZpbmlzaCgpO1xuICByZXR1cm4gc2F3QmxvY2sgPyByZXN1bHRzIDogbnVsbDtcbn1cbiIsICIvKipcbiAqIENvZGV4IGBhcHBseV9wYXRjaGAgZW52ZWxvcGUgcGFyc2VyLlxuICpcbiAqIFR1cm5zIGEgQ29kZXggYGFwcGx5X3BhdGNoYCBgdG9vbF9pbnB1dC5jb21tYW5kYCBwYXRjaCBzdHJpbmcgaW50byB0aGVcbiAqIGBBbmNob3JTcGVjW11gIHNoYXBlIHRoZSBzaGFyZWQgdG91Y2ggY29yZSBhbHJlYWR5IGNvbnN1bWVzIFx1MjAxNCB0aGUgb25lXG4gKiBnZW51aW5lbHkgbmV3IGFsZ29yaXRobSB0aGUgQ29kZXggYWRhcHRlciBuZWVkcy4gSXQgcmVwbGFjZXMgdGhlIHN0cnVjdHVyZWRcbiAqIGBmaWxlX3BhdGhgL2BvbGRfc3RyaW5nYC9gb2Zmc2V0YCByZWFkaW5nIHRoZSBDbGF1ZGUgUG9zdFRvb2xVc2UgdG91Y2ggaG9va1xuICogZG9lcywgYmVjYXVzZSBDb2RleCBkZWxpdmVycyBldmVyeSBlZGl0IGFzIGEgc2luZ2xlIGFwcGx5X3BhdGNoIGVudmVsb3BlXG4gKiByYXRoZXIgdGhhbiBhIHR5cGVkIHRvb2wgaW5wdXQuXG4gKlxuICogVGhlIG1vZHVsZSBpcyBwdXJlOiBpdCBpbXBvcnRzIG9ubHkgdGhlIGtlcm5lbCBhbmNob3IgdHlwZXMgYW5kIG5ldmVyIHRvdWNoZXNcbiAqIHRoZSBDb2RleCBTREssIHNvIGl0IGlzIERJLXRlc3RhYmxlIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlXG4gKiBzaGFyZWQga2VybmVsLiBSYW5nZSByZWNvdmVyeSBpcyBiZXN0LWVmZm9ydCBcdTIwMTQgdGhlIGFwcGx5X3BhdGNoIGZvcm1hdCBjYXJyaWVzXG4gKiBgQEBgIGNvbnRleHQgYW5kIGArYC9gLWAvc3BhY2UgY2hhbmdlIGxpbmVzIGJ1dCBubyBleHBsaWNpdCBsaW5lIG51bWJlcnMsIHNvIGFcbiAqIHJhbmdlIGNhbiBvbmx5IGJlIHJlY292ZXJlZCBieSBsb2NhdGluZyBhIGh1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGVcbiAqIG9uLWRpc2sgZmlsZS4gVGhhdCBmaWxlIHJlYWQgaXMgaW5qZWN0ZWQgKGByZWFkUHJlRWRpdEZpbGVgKSBzbyB0aGUgZnVuY3Rpb25cbiAqIHN0YXlzIHB1cmUgYW5kIHRlc3RhYmxlLiBPbiBBTlkgYW1iaWd1aXR5IChubyByZWFkZXIsIGZpbGUgbWlzc2luZywgY29udGV4dFxuICogbm90IGZvdW5kLCBmdXp6eS9kdXBsaWNhdGUgbWF0Y2gpIHRoZSBwYXJzZXIgZGVncmFkZXMgdG8gYSB3aG9sZS1maWxlIGFuY2hvclxuICogcmF0aGVyIHRoYW4gdGhyb3dpbmcgXHUyMDE0IHdob2xlLWZpbGUgYW5jaG9ycyBhcmUgZmlyc3QtY2xhc3MgYW5kIHRvdWNoIHRyYWNraW5nXG4gKiBtdXN0IG5ldmVyIGJlIGJsb2NrZWQuXG4gKlxuICogVGhlIGdyYW1tYXIgaXMgY3Jvc3MtY2hlY2tlZCBhZ2FpbnN0IENvZGV4J3Mgb3duIGFwcGx5X3BhdGNoIGNyYXRlXG4gKiAoY29kZXgtcnMvYXBwbHktcGF0Y2gvc3JjL3twYXJzZXIsc3RyZWFtaW5nX3BhcnNlcn0ucnMpLiBUd28gc3VidGxldGllcyBhcmVcbiAqIG1pcnJvcmVkIGRlbGliZXJhdGVseTogaHVuay1oZWFkZXIgbWFya2VycyBhcmUgb25seSByZWNvZ25pemVkIGF0IHRoZSBzdGFydCBvZlxuICogYSBsaW5lIHdpdGggbm8gbGVhZGluZyB3aGl0ZXNwYWNlIHdoaWxlIGluc2lkZSBhbiBVcGRhdGUgaHVuayAoYSBsZWFkaW5nIHNwYWNlXG4gKiBkZW1vdGVzIGEgbWFya2VyIHRvIGEgY29udGV4dCBsaW5lKSwgYW5kIGEgYmFyZSBlbXB0eSBsaW5lIGluc2lkZSBhbiBVcGRhdGVcbiAqIGh1bmsgaXMgdHJlYXRlZCBhcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgcHJlc2VudCBpbiBib3RoIG9sZCBhbmQgbmV3IGNvbnRlbnQuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgdHlwZSB7IEFuY2hvclNwZWMsIExpbmVSYW5nZSB9IGZyb20gJy4uL2NvbW1vbi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuXG4vKipcbiAqIEFuIGFuY2hvciBwYXJzZWQgZnJvbSBhbiBhcHBseV9wYXRjaCBlbnZlbG9wZTogYW4ge0BsaW5rIEFuY2hvclNwZWN9IHBsdXNcbiAqIHRoZSBkZWxldGUgY2xhc3NpZmljYXRpb24gKHBsYW4gXHUwMEE3MykuIGAqKiogRGVsZXRlIEZpbGU6YCBodW5rcyBrZWVwIHRoZVxuICogYHdob2xlLXdyaXRlYCBraW5kIChUb3VjaEtpbmQgaXMgZml4ZWQpIGFuZCBhZGQgdGhlIGBhYnNlbnRgIG1hcmtlciBzbyB0aGVcbiAqIGFwcGx5X3BhdGNoIGNhbGwgc2l0ZSBwYXNzZXMgYHRhcmdldFN0YXRlOiAnYWJzZW50J2AgXHUyMDE0IHdpdGhvdXQgaXQgdGhlXG4gKiBkZWxldGlvbiB0b3VjaCB3b3VsZCBiZSBnYXRlZCBhd2F5IGJ5IHRoZSBgJ2V4aXN0cydgIGRlZmF1bHQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQXBwbHlQYXRjaEFuY2hvciBleHRlbmRzIEFuY2hvclNwZWMge1xuICAvKiogdHJ1ZSBmb3IgYCoqKiBEZWxldGUgRmlsZTpgIGh1bmtzIFx1MjAxNCB0aGUgdG91Y2gncyB0YXJnZXRTdGF0ZSBpcyBgJ2Fic2VudCdgLiAqL1xuICBhYnNlbnQ/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFJlYWRzIHRoZSBwcmUtZWRpdCAob24tZGlzaywgYmVmb3JlIHRoZSBwYXRjaCBhcHBsaWVzKSBjb250ZW50IG9mIHRoZSBmaWxlIGF0XG4gKiBgcGF0aGAsIG9yIHJldHVybnMgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIHJlYWQuIEluamVjdGVkIHNvIHRoZSBwYXJzZXIgc3RheXNcbiAqIHB1cmU7IGNhbGwgc2l0ZXMgZGVmYXVsdCB0byBhIHJlYWwgZmlsZXN5c3RlbSByZWFkLlxuICovXG5leHBvcnQgdHlwZSBSZWFkUHJlRWRpdEZpbGUgPSAocGF0aDogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEdyYW1tYXIgbWFya2VycyAobWlycm9ycyBjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMvcGFyc2VyLnJzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IEVORF9QQVRDSF9NQVJLRVIgPSAnKioqIEVuZCBQYXRjaCc7XG5jb25zdCBBRERfRklMRV9NQVJLRVIgPSAnKioqIEFkZCBGaWxlOiAnO1xuY29uc3QgREVMRVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBEZWxldGUgRmlsZTogJztcbmNvbnN0IFVQREFURV9GSUxFX01BUktFUiA9ICcqKiogVXBkYXRlIEZpbGU6ICc7XG5jb25zdCBNT1ZFX1RPX01BUktFUiA9ICcqKiogTW92ZSB0bzogJztcbmNvbnN0IEVPRl9NQVJLRVIgPSAnKioqIEVuZCBvZiBGaWxlJztcbmNvbnN0IENIQU5HRV9DT05URVhUX01BUktFUiA9ICdAQCAnO1xuY29uc3QgRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbnRlcm1lZGlhdGUgaHVuayBtb2RlbFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBVcGRhdGVDaHVuayB7XG4gIC8qKiBPcHRpb25hbCBgQEAgPGNvbnRleHQ+YCBsaW5lIHVzZWQgdG8gZGlzYW1iaWd1YXRlIHRoZSBibG9jaydzIGxvY2F0aW9uLiAqL1xuICBjaGFuZ2VDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKiogUHJlLWVkaXQgbGluZXMgdGhpcyBjaHVuayBjb3ZlcnMgKGNvbnRleHQgYCBgICsgcmVtb3ZlZCBgLWApLCBpbiBvcmRlci4gKi9cbiAgb2xkTGluZXM6IHN0cmluZ1tdO1xuICAvKiogUG9zdC1lZGl0IGxpbmVzIChjb250ZXh0IGAgYCArIGFkZGVkIGArYCk7IHJldGFpbmVkIGZvciBjb21wbGV0ZW5lc3MuICovXG4gIG5ld0xpbmVzOiBzdHJpbmdbXTtcbn1cblxudHlwZSBIdW5rID1cbiAgfCB7IGtpbmQ6ICdhZGQnOyBwYXRoOiBzdHJpbmcgfVxuICB8IHsga2luZDogJ2RlbGV0ZSc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAndXBkYXRlJzsgcGF0aDogc3RyaW5nOyBtb3ZlUGF0aDogc3RyaW5nIHwgbnVsbDsgY2h1bmtzOiBVcGRhdGVDaHVua1tdIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCByZWFkZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlYWwtZmlsZXN5c3RlbSByZWFkZXIgdXNlZCB3aGVuIG5vIHJlYWRlciBpcyBpbmplY3RlZC4gQmVzdC1lZmZvcnQ6IGFueVxuICogZmFpbHVyZSAobWlzc2luZyBmaWxlLCBwZXJtaXNzaW9uIGVycm9yKSB5aWVsZHMgYG51bGxgLCB3aGljaCB0aGUgcGFyc2VyXG4gKiBkZWdyYWRlcyB0byBhIHdob2xlLWZpbGUgYW5jaG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFJlYWRQcmVFZGl0RmlsZShwYXRoOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZnMucmVhZEZpbGVTeW5jKHBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEVudmVsb3BlIHNjYW5uaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTY2FuIHRoZSBwYXRjaCB0ZXh0IGludG8gaHVua3MuIExlbmllbnQgYnkgZGVzaWduOiB1bnJlY29nbml6ZWQgbGluZXMgYXJlXG4gKiBpZ25vcmVkIHJhdGhlciB0aGFuIHJlamVjdGVkLCBhbmQgQmVnaW4vRW5kL0Vudmlyb25tZW50IGxpbmVzIGFyZSBza2lwcGVkLCBzb1xuICogYSBtYWxmb3JtZWQgZW52ZWxvcGUgZGVncmFkZXMgdG8gd2hhdGV2ZXIgaHVua3MgY291bGQgYmUgcmVjb3ZlcmVkIChvZnRlblxuICogbm9uZSBcdTIxOTIgYFtdYCkgaW5zdGVhZCBvZiB0aHJvd2luZy5cbiAqL1xuZnVuY3Rpb24gc2Nhbkh1bmtzKGNvbW1hbmQ6IHN0cmluZyk6IEh1bmtbXSB7XG4gIGNvbnN0IGh1bmtzOiBIdW5rW10gPSBbXTtcbiAgLy8gVGhlIGN1cnJlbnRseS1vcGVuIFVwZGF0ZSBodW5rLCBvciBudWxsLiBBZGQvRGVsZXRlIGh1bmtzIGhhdmUgbm8gYm9keSwgc29cbiAgLy8gdGhleSBjbG9zZSBpbW1lZGlhdGVseSBhbmQgcmVzZXQgdGhpcyB0byBudWxsLlxuICBsZXQgb3BlblVwZGF0ZTogKEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pIHwgbnVsbCA9IG51bGw7XG5cbiAgZm9yIChjb25zdCByYXcgb2YgY29tbWFuZC5zcGxpdCgnXFxuJykpIHtcbiAgICAvLyBIZWFkZXIgZGV0ZWN0aW9uIGlzIHdoaXRlc3BhY2Utc2Vuc2l0aXZlIGluc2lkZSBhbiBVcGRhdGUgaHVuazogQ29kZXggdXNlc1xuICAgIC8vIHRyaW1fZW5kIHRoZXJlIChsZWFkaW5nIHNwYWNlIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpIGFuZCBmdWxsXG4gICAgLy8gdHJpbSBlbHNld2hlcmUuIE1hdGNoIHRoYXQgc28gaW5kZW50ZWQgbWFya2VycyBpbnNpZGUgYSBodW5rIHN0YXkgY29udGVudC5cbiAgICBjb25zdCBoZWFkZXJMaW5lOiBzdHJpbmcgPSBvcGVuVXBkYXRlID8gcmF3LnJlcGxhY2UoL1sgXFx0XFxyXSskLywgJycpIDogcmF3LnRyaW0oKTtcblxuICAgIGlmIChoZWFkZXJMaW5lID09PSBFTkRfUEFUQ0hfTUFSS0VSKSB7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKEFERF9GSUxFX01BUktFUikpIHtcbiAgICAgIGh1bmtzLnB1c2goeyBraW5kOiAnYWRkJywgcGF0aDogaGVhZGVyTGluZS5zbGljZShBRERfRklMRV9NQVJLRVIubGVuZ3RoKSB9KTtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoREVMRVRFX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdkZWxldGUnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKERFTEVURV9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChVUERBVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBjb25zdCBodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9ID0ge1xuICAgICAgICBraW5kOiAndXBkYXRlJyxcbiAgICAgICAgcGF0aDogaGVhZGVyTGluZS5zbGljZShVUERBVEVfRklMRV9NQVJLRVIubGVuZ3RoKSxcbiAgICAgICAgbW92ZVBhdGg6IG51bGwsXG4gICAgICAgIGNodW5rczogW11cbiAgICAgIH07XG4gICAgICBodW5rcy5wdXNoKGh1bmspO1xuICAgICAgb3BlblVwZGF0ZSA9IGh1bms7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAob3BlblVwZGF0ZSkge1xuICAgICAgcHJvY2Vzc1VwZGF0ZUxpbmUob3BlblVwZGF0ZSwgcmF3KTtcbiAgICB9XG4gICAgLy8gQW55IG90aGVyIGxpbmUgb3V0c2lkZSBhbiBVcGRhdGUgaHVuayAoQmVnaW4gUGF0Y2gsIEVudmlyb25tZW50IElELCBBZGRcbiAgICAvLyBGaWxlIGArYCBjb250ZW50LCBzdHJheSB0ZXh0KSBpcyBpZ25vcmVkLlxuICB9XG5cbiAgcmV0dXJuIGh1bmtzO1xufVxuXG5mdW5jdGlvbiBlbnN1cmVDaHVuayhodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9KTogVXBkYXRlQ2h1bmsge1xuICBjb25zdCBsYXN0ID0gaHVuay5jaHVua3NbaHVuay5jaHVua3MubGVuZ3RoIC0gMV07XG4gIGlmIChsYXN0KSByZXR1cm4gbGFzdDtcbiAgY29uc3QgY2h1bms6IFVwZGF0ZUNodW5rID0geyBjaGFuZ2VDb250ZXh0OiBudWxsLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9O1xuICBodW5rLmNodW5rcy5wdXNoKGNodW5rKTtcbiAgcmV0dXJuIGNodW5rO1xufVxuXG4vKiogQXBwbHkgb25lIGJvZHkgbGluZSBvZiBhbiBVcGRhdGUgaHVuayB0byBpdHMgY2h1bmsgbGlzdC4gKi9cbmZ1bmN0aW9uIHByb2Nlc3NVcGRhdGVMaW5lKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0sIHJhdzogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHRyaW1tZWRFbmQgPSByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJyk7XG5cbiAgaWYgKHRyaW1tZWRFbmQgPT09IEVPRl9NQVJLRVIpIHJldHVybjsgLy8gZW5kLW9mLWZpbGUgaGludDsgbm90IG5lZWRlZCBmb3IgcmFuZ2VzXG5cbiAgLy8gYCoqKiBNb3ZlIHRvOmAgaXMgb25seSBtZWFuaW5nZnVsIGJlZm9yZSBhbnkgY2hhbmdlIGNvbnRlbnQuXG4gIGlmIChodW5rLmNodW5rcy5sZW5ndGggPT09IDAgJiYgaHVuay5tb3ZlUGF0aCA9PT0gbnVsbCAmJiB0cmltbWVkRW5kLnN0YXJ0c1dpdGgoTU9WRV9UT19NQVJLRVIpKSB7XG4gICAgaHVuay5tb3ZlUGF0aCA9IHRyaW1tZWRFbmQuc2xpY2UoTU9WRV9UT19NQVJLRVIubGVuZ3RoKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSB7XG4gICAgaHVuay5jaHVua3MucHVzaCh7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodHJpbW1lZEVuZC5zdGFydHNXaXRoKENIQU5HRV9DT05URVhUX01BUktFUikpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogdHJpbW1lZEVuZC5zbGljZShDSEFOR0VfQ09OVEVYVF9NQVJLRVIubGVuZ3RoKSwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gQSBiYXJlIGVtcHR5IGxpbmUgaXMgYW4gZW1wdHkgY29udGV4dCBsaW5lIChwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcpLlxuICBpZiAocmF3ID09PSAnJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaCgnJyk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaCgnJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZpcnN0ID0gcmF3WzBdO1xuICBpZiAoZmlyc3QgPT09ICcgJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY29uc3QgY29udGVudCA9IHJhdy5zbGljZSgxKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKGNvbnRlbnQpO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2goY29udGVudCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJysnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJy0nKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIFVucmVjb2duaXplZCBjb250ZW50IGxpbmUgXHUyMDE0IGlnbm9yZSBsZW5pZW50bHkgcmF0aGVyIHRoYW4gdGhyb3cuXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3BsaXQgZmlsZSBjb250ZW50IGludG8gbGluZXMgZm9yIG1hdGNoaW5nLiBBIHRyYWlsaW5nIG5ld2xpbmUgeWllbGRzIGFcbiAqIHRyYWlsaW5nIGVtcHR5IGVsZW1lbnQsIHdoaWNoIGlzIGhhcm1sZXNzIGZvciBzdWItc2xpY2UgbWF0Y2hpbmcuICovXG5mdW5jdGlvbiBzcGxpdExpbmVzKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIGNvbnRlbnQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKiogSW5kaWNlcyAoMC1iYXNlZCkgYXQgd2hpY2ggYHZhbHVlYCBhcHBlYXJzIGFzIGEgZnVsbCBsaW5lIGluIGBsaW5lc2AuICovXG5mdW5jdGlvbiBsaW5lSW5kaWNlcyhsaW5lczogc3RyaW5nW10sIHZhbHVlOiBzdHJpbmcpOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChsaW5lc1tpXSA9PT0gdmFsdWUpIG91dC5wdXNoKGkpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBTdGFydCBpbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgbmVlZGxlYCBtYXRjaGVzIGNvbnRpZ3VvdXNseSBpbiBgaGF5c3RhY2tgLiAqL1xuZnVuY3Rpb24gY29udGlndW91c01hdGNoZXMoaGF5c3RhY2s6IHN0cmluZ1tdLCBuZWVkbGU6IHN0cmluZ1tdKTogbnVtYmVyW10ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwIHx8IG5lZWRsZS5sZW5ndGggPiBoYXlzdGFjay5sZW5ndGgpIHJldHVybiBvdXQ7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBmb3IgKGxldCBpID0gMDsgaSA8PSBsYXN0OyBpKyspIHtcbiAgICBsZXQgb2sgPSB0cnVlO1xuICAgIGZvciAobGV0IGogPSAwOyBqIDwgbmVlZGxlLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaGF5c3RhY2tbaSArIGpdICE9PSBuZWVkbGVbal0pIHtcbiAgICAgICAgb2sgPSBmYWxzZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChvaykgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBMb2NhdGUgYSBzaW5nbGUgY2h1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGUgZmlsZSwgcmV0dXJuaW5nIGl0cyAxLWJhc2VkXG4gKiBsaW5lIHJhbmdlIG9yIG51bGwgd2hlbiBpdCBjYW5ub3QgYmUgbG9jYXRlZCB1bmFtYmlndW91c2x5LlxuICpcbiAqIC0gTm9uLWVtcHR5IGJsb2NrOiByZXF1aXJlIGEgdW5pcXVlIGNvbnRpZ3VvdXMgbWF0Y2gsIG9yIFx1MjAxNCB3aGVuIGR1cGxpY2F0ZWQgXHUyMDE0XG4gKiAgIGEgYEBAYCBjaGFuZ2UtY29udGV4dCBsaW5lIHRoYXQgc2VsZWN0cyB0aGUgb2NjdXJyZW5jZSBhZnRlciBpdC5cbiAqIC0gRW1wdHkgYmxvY2sgKHB1cmUgaW5zZXJ0aW9uKTogYW5jaG9yIG9uIGEgdW5pcXVlIGNoYW5nZS1jb250ZXh0IGxpbmUgaWYgb25lXG4gKiAgIGlzIGdpdmVuOyBvdGhlcndpc2UgaXQgaXMgdW5sb2NhdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGxvY2F0ZUNodW5rKHByZUxpbmVzOiBzdHJpbmdbXSwgY2h1bms6IFVwZGF0ZUNodW5rKTogTGluZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IGJsb2NrID0gY2h1bmsub2xkTGluZXM7XG5cbiAgaWYgKGJsb2NrLmxlbmd0aCA9PT0gMCkge1xuICAgIGNvbnN0IGN0eCA9IGNodW5rLmNoYW5nZUNvbnRleHQ7XG4gICAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgICBjb25zdCBjdHhJZHhzID0gbGluZUluZGljZXMocHJlTGluZXMsIGN0eCk7XG4gICAgICBpZiAoY3R4SWR4cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgY29uc3QgbGluZSA9IGN0eElkeHNbMF0gKyAxO1xuICAgICAgICByZXR1cm4geyBzdGFydDogbGluZSwgZW5kOiBsaW5lIH07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3Qgc3RhcnRzID0gY29udGlndW91c01hdGNoZXMocHJlTGluZXMsIGJsb2NrKTtcbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBzID0gc3RhcnRzWzBdO1xuICAgIHJldHVybiB7IHN0YXJ0OiBzICsgMSwgZW5kOiBzICsgYmxvY2subGVuZ3RoIH07XG4gIH1cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIER1cGxpY2F0ZWQgYmxvY2s6IHVzZSB0aGUgY2hhbmdlIGNvbnRleHQgdG8gc2VsZWN0IHRoZSBtYXRjaCBhZnRlciBpdC5cbiAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgZm9yIChjb25zdCBjIG9mIGxpbmVJbmRpY2VzKHByZUxpbmVzLCBjdHgpKSB7XG4gICAgICBjb25zdCBhZnRlciA9IHN0YXJ0cy5maW5kKChzKSA9PiBzID49IGMpO1xuICAgICAgaWYgKGFmdGVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IGFmdGVyICsgMSwgZW5kOiBhZnRlciArIGJsb2NrLmxlbmd0aCB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDsgLy8gYW1iaWd1b3VzIFx1MjE5MiBjYWxsZXIgZGVncmFkZXMgdG8gd2hvbGUtZmlsZVxufVxuXG4vKipcbiAqIFJlY292ZXIgYSBzaW5nbGUgbGluZSByYW5nZSBzcGFubmluZyBhbGwgb2YgYW4gdXBkYXRlJ3MgY2h1bmtzLiBSZXR1cm5zIG51bGxcbiAqIChcdTIxOTIgd2hvbGUtZmlsZSBmYWxsYmFjaykgaWYgYW55IGNodW5rIGNhbm5vdCBiZSBsb2NhdGVkLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2UocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVua3M6IFVwZGF0ZUNodW5rW10pOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgbGV0IHVuaW9uOiBMaW5lUmFuZ2UgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBjaHVuayBvZiBjaHVua3MpIHtcbiAgICBjb25zdCByID0gbG9jYXRlQ2h1bmsocHJlTGluZXMsIGNodW5rKTtcbiAgICBpZiAociA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgdW5pb24gPSB1bmlvbiA9PT0gbnVsbCA/IHIgOiB7IHN0YXJ0OiBNYXRoLm1pbih1bmlvbi5zdGFydCwgci5zdGFydCksIGVuZDogTWF0aC5tYXgodW5pb24uZW5kLCByLmVuZCkgfTtcbiAgfVxuICByZXR1cm4gdW5pb247XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIEFQSVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUGFyc2UgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGNvbW1hbmQgc3RyaW5nIGludG8gYW4gYW5jaG9yIHBlciB0b3VjaGVkIGZpbGUuXG4gKlxuICogLSBgKioqIEFkZCBGaWxlOmAgXHUyMTkyIGBjcmVhdGVgICh3aG9sZS1maWxlKVxuICogLSBgKioqIERlbGV0ZSBGaWxlOmAgXHUyMTkyIGB3aG9sZS13cml0ZWAgd2l0aCB0aGUgYGFic2VudGAgbWFya2VyICh3aG9sZS1maWxlO1xuICogICB0aGUgZmlsZSBubyBsb25nZXIgZXhpc3RzIFx1MjAxNCB0aGUgdG91Y2ggdGFyZ2V0cyBhYnNlbmNlLCBwbGFuIFx1MDBBNzMpXG4gKiAtIGAqKiogVXBkYXRlIEZpbGU6YCBcdTIxOTIgYHdyaXRlYCB3aXRoIGEgcmVjb3ZlcmVkIGxpbmUgcmFuZ2Ugd2hlbiB0aGUgaHVuaydzXG4gKiAgIHByZS1lZGl0IGJsb2NrIGNhbiBiZSBsb2NhdGVkIHZpYSBgcmVhZFByZUVkaXRGaWxlYCwgb3RoZXJ3aXNlIGB3aG9sZS13cml0ZWAuXG4gKiAgIEEgcmVuYW1lZCB1cGRhdGUgKGAqKiogTW92ZSB0bzpgKSBhbmNob3JzIHRoZSBkZXN0aW5hdGlvbiBwYXRoIGFzXG4gKiAgIGB3aG9sZS13cml0ZWAgc2luY2UgcHJlLWVkaXQgbGluZSBudW1iZXJzIGNhbm5vdCBiZSBtYXBwZWQgYWNyb3NzIGEgcmVuYW1lLlxuICpcbiAqIE5ldmVyIHRocm93czogYSBtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggeWllbGRzIGBbXWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUFwcGx5UGF0Y2goXG4gIGNvbW1hbmQ6IHN0cmluZyxcbiAgcmVhZFByZUVkaXRGaWxlOiBSZWFkUHJlRWRpdEZpbGUgPSBkZWZhdWx0UmVhZFByZUVkaXRGaWxlXG4pOiBBcHBseVBhdGNoQW5jaG9yW10ge1xuICBjb25zdCBhbmNob3JzOiBBcHBseVBhdGNoQW5jaG9yW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGh1bmsgb2Ygc2Nhbkh1bmtzKGNvbW1hbmQpKSB7XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2FkZCcpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ2NyZWF0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ3dob2xlLXdyaXRlJywgYWJzZW50OiB0cnVlIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlOiBhbmNob3Igb24gdGhlIGRlc3RpbmF0aW9uIHBhdGggKHBvc3QtZWRpdCBsb2NhdGlvbikuXG4gICAgY29uc3QgdGFyZ2V0UGF0aCA9IHRvUG9zaXgoaHVuay5tb3ZlUGF0aCA/PyBodW5rLnBhdGgpO1xuXG4gICAgLy8gQSByZW5hbWUgZGVmZWF0cyBwcmUtZWRpdCBsaW5lIG1hcHBpbmcgXHUyMDE0IGFuY2hvciB3aG9sZS1maWxlIG9uIHRoZSB0YXJnZXQuXG4gICAgaWYgKGh1bmsubW92ZVBhdGggIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBSYW5nZSByZWNvdmVyeSByZWFkcyB0aGUgcHJlLWVkaXQgY29udGVudCBhdCB0aGUgb3JpZ2luYWwgKHByZS1tb3ZlKSBwYXRoLlxuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkUHJlRWRpdEZpbGUoaHVuay5wYXRoKTtcbiAgICBjb25zdCByYW5nZSA9IGNvbnRlbnQgPT09IG51bGwgPyBudWxsIDogcmVjb3ZlclJhbmdlKHNwbGl0TGluZXMoY29udGVudCksIGh1bmsuY2h1bmtzKTtcbiAgICBpZiAocmFuZ2UgIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3cml0ZScsIHJhbmdlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhbmNob3JzO1xufVxuIiwgIi8qKlxuICogQ29kZXggUG9zdFRvb2xVc2UgdG91Y2ggaG9vayBcdTIwMTQgaGVhbCArIHN1cmZhY2UgYWZ0ZXIgYSBjb25maXJtZWQgYGFwcGx5X3BhdGNoYCxcbiAqIG9yIGEgc2hlbGwvZXhlYyBjYWxsIHdob3NlIGNvbW1hbmQgc3RhdGljYWxseSByZXNvbHZlcyB0byBmaWxlK2xpbmUgaWRpb21zLlxuICpcbiAqIFBvc3RUb29sVXNlIGZpcmVzIGFmdGVyIGBhcHBseV9wYXRjaGAgaGFzIHJ1biwgc28gdGhpcyBpcyB0aGUgYWNjdXJhdGUgaG9tZSBmb3JcbiAqIHRoZSB0b3VjaCBzaWduYWw6IHRoZSBmaWxlIGlzIGFscmVhZHkgd3JpdHRlbiwgc28gYSBzY29wZWQgYGdpdCBzcGFuIGRyaWZ0XG4gKiA8ZmlsZT4gLS1maXhgIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgYWdhaW5zdCByZWFsIGJ5dGVzIGFuZCB0aGUgc3VyZmFjZWQgYmxvY2tcbiAqIHJlZmxlY3RzIHRoZSBoZWFsZWQgYW5jaG9ycy4gVGhlIGhhbmRsZXIgbmFycm93cyB0aGUgYGFwcGx5X3BhdGNoYCBlbnZlbG9wZVxuICogKGB0b29sX2lucHV0LmNvbW1hbmRgLCBTREstdHlwZWQgYHVua25vd25gKSBpbnRvIHBlci1maWxlIGFuY2hvcnMgdmlhIHRoZVxuICogc2hhcmVkIFthcHBseS1wYXRjaCBwYXJzZXJdKC4vYXBwbHktcGF0Y2gudHMpLCBhbmQgcmVjb3ZlcnMgc2hlbGwgY29tbWFuZHNcbiAqIGZyb20gZWl0aGVyIENvZGV4IGVudmVsb3BlIChjbGFzc2ljIGBleGVjX2NvbW1hbmRgIEpTT04gYGFyZ3VtZW50c2AsIG9yXG4gKiBjb2RlLW1vZGUgYGV4ZWNgIHdyYXBwaW5nIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCkgdmlhIHRoZSBzaGFyZWRcbiAqIFtjb21tYW5kIHBhcnNlcl0oLi4vY29tbW9uL3BhcnNlLWNvbW1hbmQudHMpOyBlYWNoIHRvdWNoZWQgZmlsZSBpcyBzY29wZWQgdG9cbiAqIHRoZSBDV0QgcmVwbywgYW5kIGRyaXZlcyB0aGUgaGFybmVzcy1hZ25vc3RpYyB7QGxpbmsgcnVuVG91Y2hIb29rfSBjb3JlIFx1MjAxNCB0aGVcbiAqIHNhbWUgY29yZSB0aGUgQ2xhdWRlIGFkYXB0ZXIgdXNlcy5cbiAqXG4gKiBUd28gQ29kZXgtc3BlY2lmaWMgY29uY2VybnMgYXJlIHByZXNlcnZlZCBmcm9tIHRoaXMgZmlsZSdzIGpvdXJuYWxpbmdcbiAqIHByZWRlY2Vzc29yOlxuICpcbiAqIDEuICoqU3VjY2VzcyBjbGFzc2lmaWNhdGlvbi4qKiBUaGUgcGFyc2VkIGVudmVsb3BlIGRlc2NyaWJlcyAqaW50ZW50Kiwgbm90XG4gKiAgICAqb3V0Y29tZSouIENvZGV4IGNvcmUgZmlyZXMgUG9zdFRvb2xVc2Ugb25seSBvbiB0b29sIHN1Y2Nlc3MsIGJ1dCBhcyBhXG4gKiAgICBkdXJhYmlsaXR5IGJlbHQgd2UgY2xhc3NpZnkgYHRvb2xfcmVzcG9uc2VgIHZpYVxuICogICAge0BsaW5rIGNsYXNzaWZ5QXBwbHlQYXRjaFJlc3BvbnNlfTogYSBjb25maXJtZWQgcmVqZWN0aW9uIChgJ2ZhaWx1cmUnYClcbiAqICAgIHN1cHByZXNzZXMgdGhlIHRvdWNoIChubyBwaGFudG9tIGhlYWwvc3VyZmFjZSBvbiBhIHBhdGNoIHRoYXQgbmV2ZXJcbiAqICAgIGFwcGxpZWQpOyBhIHN1Y2Nlc3Mgb3IgYW4gdW5yZWNvZ25pemVkIHNoYXBlIChgJ3Vua25vd24nYCwgd2FybmVkKSBwcm9jZWVkcy5cbiAqIDIuICoqTm8gcG9zdC1lZGl0IHJhbmdlIHJlY292ZXJ5IGZyb20gdGhlIGVudmVsb3BlLioqIFBvc3RUb29sVXNlIHJ1bnMgYWZ0ZXJcbiAqICAgIHRoZSBwYXRjaCByZXdyb3RlIHRoZSBmaWxlLCBzbyB0aGUgaHVuaydzIHByZS1lZGl0IGJsb2NrIG5vIGxvbmdlciBzaXRzXG4gKiAgICB3aGVyZSB0aGUgZWRpdCBoYXBwZW5lZCBhbmQgY291bGQgbWlzLWFuY2hvciBhIGR1cGxpY2F0ZS4gVGhlIHRvdWNoIGlzXG4gKiAgICBzY29wZWQgZmlsZS13aWRlIChgd3JpdHRlbjogJydgIFx1MjE5MiB3aG9sZS1maWxlKSwgd2hpY2ggaXMgZXhhY3RseSB0aGVcbiAqICAgIGJlaGF2aW9yIHtAbGluayBydW5Ub3VjaEhvb2t9IHRha2VzIGZvciBhbiBlbXB0eSB3cml0ZS5cbiAqXG4gKiBUaGUgdGltZW91dCBpcyBtaWxsaXNlY29uZHMgaW4gdGhlIGhhbmRsZXIgY29uZmlnICh0aGUgQ0xJIGVtaXRzIGAxMGAgc2Vjb25kcylcbiAqIFx1MjAxNCBzZWUgdGhlIHRpbWVvdXQtdW5pdHMgc3Bpa2Ugbm90ZTsgdGhlIHNvdXJjZSB2YWx1ZSBtdXN0IHN0YXkgaW4gbXMgc28gdGhlXG4gKiBDb2RleCBidWlsZCdzIHNlY29uZHMgY29udmVyc2lvbiBhdCBlbWl0IHJlbWFpbnMgY29ycmVjdC5cbiAqL1xuXG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFBvc3RUb29sVXNlSW5wdXQsIHBvc3RUb29sVXNlSG9vaywgcG9zdFRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHsgYWJzcGF0aEFnYWluc3QgfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IGJhc2hSZXNwb25zZUludGVycnVwdGVkLCBydW5CYXNoVG91Y2hlcyB9IGZyb20gJy4uL2NvbW1vbi9iYXNoLXRvdWNoLmpzJztcbmltcG9ydCB7IHBhcnNlQ29tbWFuZERldGFpbGVkIH0gZnJvbSAnLi4vY29tbW9uL3BhcnNlLWNvbW1hbmQuanMnO1xuaW1wb3J0IHsgY3JlYXRlRGlza01lbW9TdG9yZSwgdHlwZSBNZW1vRmFjdG9yeSwgcmVzb2x2ZVRvdWNoU2NvcGUgfSBmcm9tICcuLi9jb21tb24vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7IGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycywgcnVuVG91Y2hIb29rLCB0eXBlIFRvdWNoRXhlY3V0b3JzIH0gZnJvbSAnLi4vY29tbW9uL3RvdWNoLWNvcmUuanMnO1xuaW1wb3J0IHsgcGFyc2VBcHBseVBhdGNoIH0gZnJvbSAnLi9hcHBseS1wYXRjaC5qcyc7XG5cbi8qKlxuICogVGhlIHByZWZpeCBhcHBseV9wYXRjaCdzIHN0ZG91dCBjYXJyaWVzIHdoZW4gXHUyMDE0IGFuZCBvbmx5IHdoZW4gXHUyMDE0IHRoZSBwYXRjaFxuICogYXBwbGllZCAoY29kZXgtcnMvYXBwbHktcGF0Y2ggYHByaW50X3N1bW1hcnlgKS4gQ29kZXggc3VyZmFjZXMgdGhhdCBzdGRvdXRcbiAqIHZlcmJhdGltIGFzIHRoZSBQb3N0VG9vbFVzZSBgdG9vbF9yZXNwb25zZWAgKGEgYmFyZSBzdHJpbmcgdG9kYXkpLiBGaXhlZFxuICogYWNyb3NzIEFkZC9Nb2RpZnkvRGVsZXRlOyB0aGUgaGVhZGVyIGlzIGZvbGxvd2VkIGJ5IGBBL00vRCA8cGF0aD5gIGxpbmVzLlxuICovXG5jb25zdCBBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWCA9ICdTdWNjZXNzLiBVcGRhdGVkIHRoZSBmb2xsb3dpbmcgZmlsZXM6JztcblxuLyoqXG4gKiBUaGUgY29tbW9uIGZpZWxkcyBhbiBvYmplY3Qtd3JhcHBlZCB0b29sX3Jlc3BvbnNlIG1pZ2h0IGNhcnJ5IHRoZSB0b29sJ3MgdGV4dFxuICogb3V0cHV0IHVuZGVyLCBpZiBDb2RleCBldmVyIHN0b3BzIHN1cmZhY2luZyBpdCBhcyBhIGJhcmUgc3RyaW5nLiBPcmRlcmVkIGJ5XG4gKiBsaWtlbGlob29kOyB0aGUgZmlyc3QgZmllbGQgd2hvc2UgdmFsdWUgaXMgYSBzdHJpbmcgd2lucy5cbiAqL1xuY29uc3QgUkVTUE9OU0VfVEVYVF9GSUVMRFMgPSBbJ291dHB1dCcsICdzdGRvdXQnLCAnY29udGVudCcsICd0ZXh0J10gYXMgY29uc3Q7XG5cbi8qKiBOYXJyb3cgdGhlIFNESydzIGB1bmtub3duYCB0b29sX2lucHV0IHRvIHRoZSBgYXBwbHlfcGF0Y2hgIGB7IGNvbW1hbmQgfWAgc2hhcGUuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93QXBwbHlQYXRjaENvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2NvbW1hbmQnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGNvbW1hbmQgPSAodG9vbElucHV0IGFzIHsgY29tbWFuZDogdW5rbm93biB9KS5jb21tYW5kO1xuICAgIGlmICh0eXBlb2YgY29tbWFuZCA9PT0gJ3N0cmluZycpIHJldHVybiBjb21tYW5kO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIE5hcnJvdyB0aGUgY2xhc3NpYyBgZXhlY19jb21tYW5kYCBlbnZlbG9wZSAoY2xpX3ZlcnNpb24gXHUyMjY0IDAuMTMwLjApOlxuICogYHRvb2xfaW5wdXQuYXJndW1lbnRzYCBpcyBhIEpTT04gKnN0cmluZyogb2Ygc2hhcGVcbiAqIGB7XCJjbWRcIjogXCIuLi5cIiwgXCJ3b3JrZGlyXCI6IFwiLi4uXCJ9YCBcdTIwMTQgcGFyc2UgaXQgYW5kIHJldHVybiB0aGUgYGNtZGAuIFJldHVybnNcbiAqIGBudWxsYCBmb3IgYW55IG90aGVyIHNoYXBlIChub3QgSlNPTiwgbm8gYGNtZGAgZmllbGQsIG9yIG5vdCB0aGlzIGVudmVsb3BlKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5hcnJvd0V4ZWNDb21tYW5kKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ICE9PSBudWxsICYmIHR5cGVvZiB0b29sSW5wdXQgPT09ICdvYmplY3QnICYmICdhcmd1bWVudHMnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGFyZ3MgPSAodG9vbElucHV0IGFzIHsgYXJndW1lbnRzOiB1bmtub3duIH0pLmFyZ3VtZW50cztcbiAgICBpZiAodHlwZW9mIGFyZ3MgPT09ICdzdHJpbmcnKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGFyZ3MpO1xuICAgICAgICBpZiAocGFyc2VkICE9PSBudWxsICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnICYmIHR5cGVvZiBwYXJzZWQuY21kID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIHJldHVybiBwYXJzZWQuY21kO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIFRoZSByZXN1bHQgb2YgbmFycm93aW5nIHRoZSBjb2RlLW1vZGUgYGV4ZWNgIGVudmVsb3BlLiBgbWF0Y2hlZGAgc2VwYXJhdGVzXG4gKiBcInRoZSBlbnZlbG9wZSB3YXMgYSBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgY2FsbCB3aG9zZSBhcmd1bWVudCBjb3VsZCBub3RcbiAqIGJlIHJlY292ZXJlZFwiIChhIHZhcmlhYmxlL3RlbXBsYXRlLWJ1aWx0IGNvbW1hbmQgXHUyMDE0IHN0YXRpY2FsbHkgdW5yZXNvbHZhYmxlKVxuICogZnJvbSBcInRoZSBlbnZlbG9wZSBpcyBub3QgY29kZS1tb2RlIGV4ZWMgYXQgYWxsXCIsIHNvIHRoZSBoYW5kbGVyIGNhbiB3YXJuIG9uXG4gKiB0aGUgZm9ybWVyIGluc3RlYWQgb2Ygc2lsZW50bHkgY29uZmxhdGluZyBpdCB3aXRoIHRoZSBsYXR0ZXIuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29kZU1vZGVFeGVjTmFycm93IHtcbiAgLyoqIFdoZXRoZXIgYHRvb2xfaW5wdXQuaW5wdXRgIGNvbnRhaW5lZCBhIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCBjYWxsLiAqL1xuICBtYXRjaGVkOiBib29sZWFuO1xuICAvKiogVGhlIHJlY292ZXJlZCBgY21kYCBzdHJpbmcsIG9yIGBudWxsYCB3aGVuIG1hdGNoZWQgYnV0IHVucGFyc2FibGUgLyBhYnNlbnQuICovXG4gIGNtZDogc3RyaW5nIHwgbnVsbDtcbn1cblxuLyoqXG4gKiBRdW90ZSBiYXJlIGlkZW50aWZpZXIga2V5cyBpbiBhIEpTIG9iamVjdCBsaXRlcmFsIHNvIGBKU09OLnBhcnNlYCBjYW4gcmVhZFxuICogaXQuIFJlYWwgY29kZS1tb2RlIGNhbGwgc2l0ZXMgZW1pdCBKUy1zdHlsZSB1bnF1b3RlZCBrZXlzXG4gKiAoYHtjbWQ6XCJzZWQgLW4gJzEsMjQwcCcgL3BhdGhcIiwuLi59YCksIHdoaWNoIGlzIHZhbGlkIEpTIGJ1dCBpbnZhbGlkIEpTT04uXG4gKiBTdHJpbmcgdmFsdWVzIChzaW5nbGUtIG9yIGRvdWJsZS1xdW90ZWQpIGFyZSBjb3BpZWQgdmVyYmF0aW0gXHUyMDE0IGluY2x1ZGluZyBhbnlcbiAqIGAsIGtleTpgLXNoYXBlZCB0ZXh0IGluc2lkZSB0aGVtIFx1MjAxNCBhbmQgYWxyZWFkeS1xdW90ZWQga2V5cyBwYXNzIHRocm91Z2hcbiAqIHVudG91Y2hlZC5cbiAqL1xuZnVuY3Rpb24gcXVvdGVPYmplY3RLZXlzKGxpdGVyYWw6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBvdXQgPSAnJztcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gbGl0ZXJhbC5sZW5ndGg7XG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBsaXRlcmFsW2ldO1xuICAgIGlmIChjID09PSAnXCInIHx8IGMgPT09IFwiJ1wiKSB7XG4gICAgICBjb25zdCBxdW90ZSA9IGM7XG4gICAgICBjb25zdCBzdGFydCA9IGk7XG4gICAgICBpICs9IDE7XG4gICAgICB3aGlsZSAoaSA8IG4pIHtcbiAgICAgICAgaWYgKGxpdGVyYWxbaV0gPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIGkgKz0gMjtcbiAgICAgICAgZWxzZSBpZiAobGl0ZXJhbFtpXSA9PT0gcXVvdGUpIHtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH0gZWxzZSBpICs9IDE7XG4gICAgICB9XG4gICAgICBvdXQgKz0gbGl0ZXJhbC5zbGljZShzdGFydCwgaSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3Qga2V5ID0gbGl0ZXJhbC5zbGljZShpKS5tYXRjaCgvXihcXHt8LClcXHMqKFtBLVphLXpfJF1bQS1aYS16MC05XyRdKilcXHMqOi8pO1xuICAgIGlmIChrZXkpIHtcbiAgICAgIG91dCArPSBgJHtrZXlbMV19XCIke2tleVsyXX1cIjpgO1xuICAgICAgaSArPSBrZXlbMF0ubGVuZ3RoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIG91dCArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIE5hcnJvdyB0aGUgY29kZS1tb2RlIGBleGVjYCBlbnZlbG9wZSAoY2xpX3ZlcnNpb24gXHUyMjY1IDAuMTQ0LjApOlxuICogYHRvb2xfaW5wdXQuaW5wdXRgIGlzIEpTIHNvdXJjZSB0aGF0IGNhbGxzIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCBcdTIwMTRcbiAqIHJlY292ZXIgdGhlIGxpdGVyYWwgb2JqZWN0IGFyZ3VtZW50IHZpYSBiYWxhbmNlZC1icmFjZSBtYXRjaGluZywgcXVvdGUgaXRzXG4gKiB1bnF1b3RlZCBKUyBrZXlzLCBhbmQgcGFyc2UgaXQuIEEgY29tbWFuZCBidWlsdCBmcm9tIHZhcmlhYmxlcyBvciB0ZW1wbGF0ZVxuICogbGl0ZXJhbHMgaXMgc3RhdGljYWxseSB1bnJlc29sdmFibGU6IHRoZSBjYWxsIHN0aWxsICptYXRjaGVkKiBidXQgeWllbGRzXG4gKiBgY21kOiBudWxsYCwgcmVwb3J0ZWQgZGlzdGluY3RseSBmcm9tIGEgbm9uLWNvZGUtbW9kZSBlbnZlbG9wZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5hcnJvd0NvZGVNb2RlRXhlYyh0b29sSW5wdXQ6IHVua25vd24pOiBDb2RlTW9kZUV4ZWNOYXJyb3cge1xuICBpZiAodG9vbElucHV0ICE9PSBudWxsICYmIHR5cGVvZiB0b29sSW5wdXQgPT09ICdvYmplY3QnICYmICdpbnB1dCcgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgaW5wdXQgPSAodG9vbElucHV0IGFzIHsgaW5wdXQ6IHVua25vd24gfSkuaW5wdXQ7XG4gICAgaWYgKHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIE1hdGNoIHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSkgXHUyMDE0IGV4dHJhY3QgdGhlIGxpdGVyYWwgb2JqZWN0IGFyZ3VtZW50XG4gICAgICBjb25zdCBtYXRjaCA9IGlucHV0Lm1hdGNoKC90b29sc1xcLmV4ZWNfY29tbWFuZFxcKFxccyooXFx7KD86W157fV18XFx7KD86W157fV18XFx7W157fV0qXFx9KSpcXH0pKlxcfSlcXHMqXFwpLyk7XG4gICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHF1b3RlT2JqZWN0S2V5cyhtYXRjaFsxXSkpO1xuICAgICAgICAgIGlmIChwYXJzZWQgIT09IG51bGwgJiYgdHlwZW9mIHBhcnNlZCA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHBhcnNlZC5jbWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IHBhcnNlZC5jbWQgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHsgbWF0Y2hlZDogdHJ1ZSwgY21kOiBudWxsIH07XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIG1hdGNoZWQsIGJ1dCB0aGUgbGl0ZXJhbCBkaWQgbm90IHBhcnNlIFx1MjAxNCB0aGUgY2FsbCBpcyBzdGlsbCBhXG4gICAgICAgICAgLy8gY29kZS1tb2RlIGV4ZWMgd2hvc2UgY29tbWFuZCBjYW5ub3QgYmUgcmVjb3ZlcmVkIHN0YXRpY2FsbHkuXG4gICAgICAgICAgcmV0dXJuIHsgbWF0Y2hlZDogdHJ1ZSwgY21kOiBudWxsIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgbWF0Y2hlZDogZmFsc2UsIGNtZDogbnVsbCB9O1xufVxuXG4vKipcbiAqIFRvbGVyYW50bHkgcHVsbCB0aGUgdG9vbCdzIHRleHR1YWwgb3V0cHV0IG91dCBvZiBhIGB0b29sX3Jlc3BvbnNlYCBvZlxuICogdW5jZXJ0YWluIHNoYXBlIChTREstdHlwZWQgYHVua25vd25gKTogYSBiYXJlIHN0cmluZyAodG9kYXkncyBDb2RleCkgaXNcbiAqIHJldHVybmVkIGFzLWlzOyBhbiBvYmplY3QgaXMgcHJvYmVkIGZvciB0aGUgZmlyc3Qge0BsaW5rIFJFU1BPTlNFX1RFWFRfRklFTERTfVxuICogZW50cnkgdGhhdCBob2xkcyBhIHN0cmluZy4gUmV0dXJucyBgbnVsbGAgd2hlbiBubyB0ZXh0IGNhbiBiZSByZWNvdmVyZWRcbiAqICh1bmtub3duIG9iamVjdCBzaGFwZSwgYG51bGxgLCBvciBhIG5vbi1zdHJpbmcvbm9uLW9iamVjdCksIHdoaWNoIHRoZSBjYWxsZXJcbiAqIHRyZWF0cyBhcyBhbiAqdW5yZWNvZ25pemVkKiBcdTIwMTQgbm90ICpmYWlsZWQqIFx1MjAxNCByZXNwb25zZS5cbiAqL1xuZnVuY3Rpb24gZXh0cmFjdFJlc3BvbnNlVGV4dCh0b29sUmVzcG9uc2U6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdzdHJpbmcnKSByZXR1cm4gdG9vbFJlc3BvbnNlO1xuICBpZiAodG9vbFJlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdvYmplY3QnKSB7XG4gICAgY29uc3QgcmVjb3JkID0gdG9vbFJlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGZvciAoY29uc3QgZmllbGQgb2YgUkVTUE9OU0VfVEVYVF9GSUVMRFMpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcmVjb3JkW2ZpZWxkXTtcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIENsYXNzaWZ5IGFuIGBhcHBseV9wYXRjaGAgYHRvb2xfcmVzcG9uc2VgIGZvciB0aGUgdG91Y2ggZ2F0ZTpcbiAqXG4gKiAtIGAnc3VjY2VzcydgIFx1MjAxNCB0ZXh0IHdhcyByZWNvdmVyZWQgYW5kIGNhcnJpZXMge0BsaW5rIEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYfS5cbiAqIC0gYCdmYWlsdXJlJ2AgXHUyMDE0IHRleHQgd2FzIHJlY292ZXJlZCBidXQgbGFja3MgdGhlIGhlYWRlcjogYSBnZW51aW5lIHJlamVjdGlvblxuICogICBvciBlcnJvci4gVGhlIE9OTFkgY2xhc3NpZmljYXRpb24gdGhhdCBzdXBwcmVzc2VzIHRoZSB0b3VjaC5cbiAqIC0gYCd1bmtub3duJ2AgXHUyMDE0IG5vIHRleHQgY291bGQgYmUgcmVjb3ZlcmVkICh1bnJlY29nbml6ZWQgc2hhcGUpLiBXZSBwcm9jZWVkXG4gKiAgIGRlZmVuc2l2ZWx5IGhlcmUgcmF0aGVyIHRoYW4gcmlzayBtaXNzaW5nIGEgcmVhbCBlZGl0J3MgaGVhbC9zdXJmYWNlOyBDb2RleFxuICogICBjb3JlIGZpcmVzIFBvc3RUb29sVXNlIG9ubHkgb24gc3VjY2Vzcywgc28gdGhpcyBjYW5ub3QgaGVhbC9zdXJmYWNlIGEgcGF0Y2hcbiAqICAgdGhhdCBuZXZlciBhcHBsaWVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2UodG9vbFJlc3BvbnNlOiB1bmtub3duKTogJ3N1Y2Nlc3MnIHwgJ2ZhaWx1cmUnIHwgJ3Vua25vd24nIHtcbiAgY29uc3QgdGV4dCA9IGV4dHJhY3RSZXNwb25zZVRleHQodG9vbFJlc3BvbnNlKTtcbiAgaWYgKHRleHQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gIHJldHVybiB0ZXh0LnN0YXJ0c1dpdGgoQVBQTFlfUEFUQ0hfU1VDQ0VTU19QUkVGSVgpID8gJ3N1Y2Nlc3MnIDogJ2ZhaWx1cmUnO1xufVxuXG4vKiogQSByZWFkZXIgdGhhdCBhbHdheXMgZGVjbGluZXMsIGZvcmNpbmcgdGhlIHBhcnNlciB0byB3aG9sZS1maWxlIGFuY2hvcnMuICovXG5jb25zdCBub1JhbmdlUmVjb3ZlcnkgPSAoKTogbnVsbCA9PiBudWxsO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSGFuZGxlcihcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyA9IGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycygpLFxuICBtZW1vRmFjdG9yeTogTWVtb0ZhY3RvcnkgPSBjcmVhdGVEaXNrTWVtb1N0b3JlXG4pIHtcbiAgcmV0dXJuIGFzeW5jIChpbnB1dDogUG9zdFRvb2xVc2VJbnB1dCwgY3R4OiBIb29rQ29udGV4dCkgPT4ge1xuICAgIGNvbnN0IHRvb2xfbmFtZSA9IGlucHV0LnRvb2xfbmFtZTtcbiAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgY29uc3Qgc2Vzc2lvbklkID0gaW5wdXQuc2Vzc2lvbl9pZDtcbiAgICBjb25zdCBtZW1vID0gbWVtb0ZhY3RvcnkoY3R4LmxvZ2dlcik7XG5cbiAgICAvLyBTaGVsbCB0b3VjaDogZXh0cmFjdCB0aGUgY29tbWFuZCBmcm9tIHdoaWNoZXZlciBlbnZlbG9wZSBzaGFwZSB0aGUgaGFybmVzc1xuICAgIC8vIGRlbGl2ZXJzLCBwYXJzZSwgYW5kIHJ1biBlYWNoIHJlc29sdmVkIHNwYW4gdGhyb3VnaCB0aGUgc2hhcmVkIHRvdWNoIGNvcmUuXG4gICAgLy9cbiAgICAvLyAtIGBCYXNoYDogdGhlIGhhcm5lc3MtdW53cmFwcGVkIHNoYXBlIENvZGV4IFx1MjI2NTAuMTQ0IGFjdHVhbGx5IHNlbmRzIFx1MjAxNFxuICAgIC8vICAgYHRvb2xfaW5wdXQuY29tbWFuZGAgaXMgdGhlIHJhdyBzaGVsbCBjb21tYW5kIHN0cmluZyAoc2FtZSBzaGFwZSB0aGVcbiAgICAvLyAgIENsYXVkZSBhZGFwdGVyIGhhbmRsZXMpLlxuICAgIC8vIC0gYGV4ZWNfY29tbWFuZGA6IGNsYXNzaWMgZnVuY3Rpb25fY2FsbCBlbnZlbG9wZSAoY2xpIFx1MjI2NDAuMTMwKSBcdTIwMTRcbiAgICAvLyAgIGB0b29sX2lucHV0LmFyZ3VtZW50c2AgaXMgYSBKU09OIHN0cmluZyB3aXRoIGEgYGNtZGAgZmllbGQuXG4gICAgLy8gLSBgZXhlY2A6IGRpcmVjdCBjb2RlLW1vZGUgZW52ZWxvcGUgKG1heSBzaGlwIGluIGEgZnV0dXJlIENMSSkgXHUyMDE0XG4gICAgLy8gICBgdG9vbF9pbnB1dC5pbnB1dGAgaXMgSlMgc291cmNlIHdyYXBwaW5nIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYC5cbiAgICAvL1xuICAgIC8vIEEgY29tbWFuZCB3aXRoIG5vIHJlY29nbml6ZWQgaWRpb20geWllbGRzIG5vIGJsb2NrcyBhbmQgcmV0dXJucyB1bmRlZmluZWQgXHUyMDE0XG4gICAgLy8gZmFpbC1vcGVuLCBzYW1lIGFzIHRoZSBhcHBseV9wYXRjaCBwYXRoIGJlbG93LlxuICAgIGlmICh0b29sX25hbWUgPT09ICdCYXNoJyB8fCB0b29sX25hbWUgPT09ICdleGVjX2NvbW1hbmQnIHx8IHRvb2xfbmFtZSA9PT0gJ2V4ZWMnKSB7XG4gICAgICBsZXQgY29tbWFuZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICBpZiAodG9vbF9uYW1lID09PSAnQmFzaCcpIHtcbiAgICAgICAgLy8gVGhlIGhhcm5lc3MgYWxyZWFkeSB1bndyYXBwZWQgdGhlIGNvZGUtbW9kZSBlbnZlbG9wZSBcdTIwMTQgdGhlIGNvbW1hbmQgaXNcbiAgICAgICAgLy8gaW4gYHRvb2xfaW5wdXQuY29tbWFuZGAsIGV4YWN0bHkgYXMgdGhlIENsYXVkZSBhZGFwdGVyIHJlY2VpdmVzIGl0LlxuICAgICAgICBjb25zdCByYXcgPSAoaW5wdXQudG9vbF9pbnB1dCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwpPy5jb21tYW5kO1xuICAgICAgICBjb21tYW5kID0gdHlwZW9mIHJhdyA9PT0gJ3N0cmluZycgPyByYXcgOiBudWxsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29tbWFuZCA9IG5hcnJvd0V4ZWNDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgICAgfVxuICAgICAgaWYgKGNvbW1hbmQgPT09IG51bGwgJiYgdG9vbF9uYW1lID09PSAnZXhlYycpIHtcbiAgICAgICAgLy8gQ29kZS1tb2RlIGBleGVjYCB3cmFwcyB0aGUgc2FtZSBjYWxsIGluIEpTIHNvdXJjZS4gQSBtYXRjaGVkIGNhbGxcbiAgICAgICAgLy8gd2hvc2UgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZCAodmFyaWFibGUvdGVtcGxhdGUtYnVpbHQgY29tbWFuZClcbiAgICAgICAgLy8gaXMgYSBkaXN0aW5jdCBvdXRjb21lIGZyb20gXCJub3QgYSBjb2RlLW1vZGUgZW52ZWxvcGUgYXQgYWxsXCI6IHdhcm4gc29cbiAgICAgICAgLy8gdGhlIGJsaW5kIHNwb3QgaXMgdmlzaWJsZSBpbnN0ZWFkIG9mIHNpbGVudGx5IGNvbmZsYXRlZCB3aXRoIG5vIG1hdGNoLlxuICAgICAgICBjb25zdCBjb2RlTW9kZSA9IG5hcnJvd0NvZGVNb2RlRXhlYyhpbnB1dC50b29sX2lucHV0KTtcbiAgICAgICAgaWYgKGNvZGVNb2RlLm1hdGNoZWQgJiYgY29kZU1vZGUuY21kID09PSBudWxsKSB7XG4gICAgICAgICAgY3R4LmxvZ2dlci53YXJuKFxuICAgICAgICAgICAgJ0NvZGV4IGNvZGUtbW9kZSBleGVjIGVudmVsb3BlIG1hdGNoZWQgYnV0IGl0cyBleGVjX2NvbW1hbmQgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZDsgbm8gc2hlbGwgdG91Y2gnLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0b29sSW5wdXRUeXBlOiB0eXBlb2YgaW5wdXQudG9vbF9pbnB1dCxcbiAgICAgICAgICAgICAgdG9vbElucHV0S2V5czpcbiAgICAgICAgICAgICAgICBpbnB1dC50b29sX2lucHV0ICE9PSBudWxsICYmIHR5cGVvZiBpbnB1dC50b29sX2lucHV0ID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX2lucHV0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGNvbW1hbmQgPSBjb2RlTW9kZS5jbWQ7XG4gICAgICB9XG4gICAgICBpZiAoIWNvbW1hbmQpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIC8vIEFuIGludGVycnVwdGVkIGNvbW1hbmQgcHJvZHVjZXMgbm8gdG91Y2hlcywgd2hhdGV2ZXIgaXRzIHNwYW5zOyB0aGVcbiAgICAgIC8vIGRyaXZlciByZS1jaGVja3MgZGVmZW5zaXZlbHkuXG4gICAgICBpZiAoYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQoaW5wdXQudG9vbF9yZXNwb25zZSkpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICBjb25zdCBtYXRjaGVzID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgY3dkKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IGF3YWl0IHJ1bkJhc2hUb3VjaGVzKG1hdGNoZXMsIHNlc3Npb25JZCwgY3dkLCBpbnB1dC50b29sX3Jlc3BvbnNlLCBleGVjdXRvcnMsIG1lbW8sIChtZXNzYWdlKSA9PlxuICAgICAgICBjdHgubG9nZ2VyLndhcm4obWVzc2FnZSlcbiAgICAgICk7XG4gICAgICBpZiAoYmxvY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IGNvbWJpbmVkID0gYmxvY2tzLmpvaW4oJycpO1xuICAgICAgcmV0dXJuIHBvc3RUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IGNvbWJpbmVkLCBzeXN0ZW1NZXNzYWdlOiBjb21iaW5lZCB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBjb21tYW5kID0gbmFycm93QXBwbHlQYXRjaENvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgaWYgKGNvbW1hbmQgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAvLyBTdXBwcmVzcyBvbmx5IGEgKmNvbmZpcm1lZCogbm9uLXN1Y2Nlc3MuIEFuIHVucmVjb2duaXplZCByZXNwb25zZSBzaGFwZVxuICAgIC8vIHByb2NlZWRzICh3aXRoIGEgd2FybmluZykgcmF0aGVyIHRoYW4gcmlzayBza2lwcGluZyBhIHJlYWwgZWRpdCdzIHRvdWNoLlxuICAgIGNvbnN0IGNsYXNzaWZpY2F0aW9uID0gY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2UoaW5wdXQudG9vbF9yZXNwb25zZSk7XG4gICAgaWYgKGNsYXNzaWZpY2F0aW9uID09PSAnZmFpbHVyZScpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKGNsYXNzaWZpY2F0aW9uID09PSAndW5rbm93bicpIHtcbiAgICAgIGN0eC5sb2dnZXIud2FybignQ29kZXggYXBwbHlfcGF0Y2ggdG9vbF9yZXNwb25zZSBzaGFwZSB1bnJlY29nbml6ZWQ7IHJ1bm5pbmcgdG91Y2ggZGVmZW5zaXZlbHknLCB7XG4gICAgICAgIHRvb2xSZXNwb25zZVR5cGU6IHR5cGVvZiBpbnB1dC50b29sX3Jlc3BvbnNlLFxuICAgICAgICB0b29sUmVzcG9uc2VLZXlzOlxuICAgICAgICAgIGlucHV0LnRvb2xfcmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIGlucHV0LnRvb2xfcmVzcG9uc2UgPT09ICdvYmplY3QnXG4gICAgICAgICAgICA/IE9iamVjdC5rZXlzKGlucHV0LnRvb2xfcmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gT25lIGVudmVsb3BlIG1heSB0b3VjaCBzZXZlcmFsIGZpbGVzOyBmb3JjZSB3aG9sZS1maWxlIGFuY2hvcnMgKENvZGV4IG5ldmVyXG4gICAgLy8gcmVjb3ZlcnMgYSBwb3N0LWVkaXQgcmFuZ2UpIGFuZCBydW4gdGhlIHNoYXJlZCB0b3VjaCBjb3JlIHBlciB0b3VjaGVkIGZpbGUuXG4gICAgLy8gVGhlIHNoYXJlZCBtZW1vIGRlZHVwZXMgc3BhbiByZW5kZXJzIGFjcm9zcyBhbmNob3JzIGFuZCB0aGUgc2Vzc2lvbi5cbiAgICBjb25zdCBhbmNob3JzID0gcGFyc2VBcHBseVBhdGNoKGNvbW1hbmQsIG5vUmFuZ2VSZWNvdmVyeSk7XG4gICAgY29uc3QgYmxvY2tzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcbiAgICAgIGNvbnN0IGFic1BhdGggPSBhYnNwYXRoQWdhaW5zdChjd2QsIGFuY2hvci5wYXRoKTtcbiAgICAgIGNvbnN0IHNjb3BlID0gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkLCBhYnNQYXRoKTtcbiAgICAgIGlmICghc2NvcGUpIGNvbnRpbnVlO1xuICAgICAgLy8gQSBgKioqIERlbGV0ZSBGaWxlOmAgYW5jaG9yIGNhcnJpZXMgdGhlIGFic2VudCBtYXJrZXIgKHBsYW4gXHUwMEE3Myk6IGl0c1xuICAgICAgLy8gdG91Y2ggdGFyZ2V0cyBhYnNlbmNlIFx1MjAxNCB0aGUgZGVsZXRlIGdhdGUgdmVyaWZpZXMgdGhlIHBhdGggaXMgZ29uZSBBTkRcbiAgICAgIC8vIHdhcyByZWFsIChpbmRleC10cmFja2VkIG9yIHNwYW5uZWQpIGJlZm9yZSBmaXJpbmcuIEV2ZXJ5dGhpbmcgZWxzZVxuICAgICAgLy8gdGFyZ2V0cyBleGlzdGVuY2UuXG4gICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2soXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICBjd2QsXG4gICAgICAgICAgZmlsZVBhdGg6IGFic1BhdGgsXG4gICAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgICAgdGFyZ2V0U3RhdGU6IGFuY2hvci5hYnNlbnQgPyAnYWJzZW50JyA6ICdleGlzdHMnLFxuICAgICAgICAgIC4uLihhbmNob3IuYWJzZW50ID8geyBwb3N0U3RhdGU6IHsgcmVhbERlbGV0ZTogdHJ1ZSB9IH0gOiB7fSlcbiAgICAgICAgfSxcbiAgICAgICAgZXhlY3V0b3JzLFxuICAgICAgICBtZW1vXG4gICAgICApO1xuICAgICAgaWYgKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCkgYmxvY2tzLnB1c2gob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjb25zdCBjb21iaW5lZCA9IGJsb2Nrcy5qb2luKCcnKTtcbiAgICByZXR1cm4gcG9zdFRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQsIHN5c3RlbU1lc3NhZ2U6IGNvbWJpbmVkIH0pO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBwb3N0VG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnYXBwbHlfcGF0Y2h8ZXhlY19jb21tYW5kfGV4ZWN8QmFzaCcsIHRpbWVvdXQ6IDEwXzAwMCB9LCBjcmVhdGVIYW5kbGVyKCkpO1xuIiwgImltcG9ydCBob29rIGZyb20gXCIuL3Bvc3QtdG9vbC11c2UudHNcIjtcbmltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tIFwiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L3J1bnRpbWUuanNcIjtcbmV4ZWN1dGUoaG9vayk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBNEJPLElBQU0sMEJBQTBCLG9CQUFJLElBQUksQ0FBQyxnQkFBZ0Isb0JBQW9CLGVBQWUsQ0FBQzs7O0FDNUJwRyxTQUFTLGVBQWUsZUFBZSxRQUFRLFNBQVM7QUFDcEQsUUFBTSxPQUFPO0FBQ2IsT0FBSyxnQkFBZ0I7QUFDckIsT0FBSyxVQUFVLE9BQU87QUFDdEIsT0FBSyxnQkFBZ0IsT0FBTztBQUM1QixNQUFJLGFBQWEsVUFBVSxPQUFPLE9BQU8sWUFBWSxVQUFVO0FBQzNELFNBQUssVUFBVSxPQUFPO0FBQUEsRUFDMUI7QUFDQSxTQUFPO0FBQ1g7QUFJTyxTQUFTLGdCQUFnQixRQUFRLFNBQVM7QUFDN0MsU0FBTyxlQUFlLGVBQWUsUUFBUSxPQUFPO0FBQ3hEOzs7QUNmQSxTQUFTLFdBQVcsWUFBWSxXQUFXLFVBQVUsaUJBQWlCO0FBQ3RFLFNBQVMsZUFBZTtBQUN4QixJQUFNLHNCQUFzQjtBQUNyQixJQUFNLFNBQU4sTUFBYTtBQUFBLEVBQ2hCLFdBQVcsb0JBQUksSUFBSTtBQUFBLEVBQ25CLGtCQUFrQjtBQUFBLEVBQ2xCLFlBQVk7QUFBQSxFQUNaLGNBQWM7QUFBQSxFQUNkO0FBQUEsRUFDQTtBQUFBLEVBQ0EsWUFBWSxTQUFTLENBQUMsR0FBRztBQUNyQixTQUFLLGNBQWMsT0FBTyxlQUFlLFFBQVEsSUFBSSxPQUFPLGFBQWEsbUJBQW1CLEtBQUs7QUFBQSxFQUNyRztBQUFBLEVBQ0EsV0FBVyxVQUFV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VUFBTSxTQUFtQixDQUFDO0FBQzFCLGVBQVcsVUFBVSxTQUFTO0FBQzVCLFlBQU0sVUFBVSxlQUFlLEtBQUssT0FBTyxJQUFJO0FBQy9DLFlBQU0sUUFBUSxrQkFBa0IsS0FBSyxPQUFPO0FBQzVDLFVBQUksQ0FBQyxNQUFPO0FBS1osWUFBTSxTQUFTLE1BQU07QUFBQSxRQUNuQjtBQUFBLFVBQ0UsTUFBTTtBQUFBLFVBQ047QUFBQSxVQUNBO0FBQUEsVUFDQSxVQUFVO0FBQUEsVUFDVixTQUFTO0FBQUEsVUFDVCxhQUFhLE9BQU8sU0FBUyxXQUFXO0FBQUEsVUFDeEMsR0FBSSxPQUFPLFNBQVMsRUFBRSxXQUFXLEVBQUUsWUFBWSxLQUFLLEVBQUUsSUFBSSxDQUFDO0FBQUEsUUFDN0Q7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFDQSxVQUFJLE9BQU8sa0JBQW1CLFFBQU8sS0FBSyxPQUFPLGlCQUFpQjtBQUFBLElBQ3BFO0FBRUEsUUFBSSxPQUFPLFdBQVcsRUFBRyxRQUFPO0FBQ2hDLFVBQU0sV0FBVyxPQUFPLEtBQUssRUFBRTtBQUMvQixXQUFPLGtCQUFrQixFQUFFLG1CQUFtQixVQUFVLGVBQWUsU0FBUyxDQUFDO0FBQUEsRUFDbkY7QUFDRjtBQUVBLElBQU8sd0JBQVEsZ0JBQWdCLEVBQUUsU0FBUyxzQ0FBc0MsU0FBUyxJQUFPLEdBQUcsY0FBYyxDQUFDOzs7QUM5VWxILFFBQVEscUJBQUk7IiwKICAibmFtZXMiOiBbInJlc29sdmUiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImxvZ2dlciIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAiYmFzZW5hbWUiLCAiam9pbiIsICJleGVjRmlsZVN5bmMiLCAiam9pbiIsICJiYXNlbmFtZSIsICJqb2luIiwgInJlYWRGaWxlU3luYyIsICJzdGF0U3luYyIsICJiYXNlbmFtZSIsICJleGVjRmlsZVN5bmMiLCAicmVhZEZpbGVTeW5jIiwgInN0YXRTeW5jIiwgImpvaW4iLCAic3RhdFN5bmMiLCAiYmFzZW5hbWUiLCAicmVhZEZpbGVTeW5jIiwgInRva2VucyIsICJmcyIsICJ0b1Bvc2l4IiwgImN0eCIsICJyZWNvdmVyUmFuZ2UiLCAiY29tbWFuZCIsICJibG9ja3MiLCAiY29tYmluZWQiXQp9Cg==
